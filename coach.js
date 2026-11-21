/* Gym Tracker — coach.js v8 (AI layer + small UI patches). Loaded after app.js + dash.js. Wraps existing functions only.
   AI toggle rule: Sync switch ON → every AI feature shows. OFF → none of it (no Coach card, Ask, plan, finder, "next", ✨, finish notes).
   "next" kg/reps are written by the AI (Suggestions tab) after every Finish. Needs Coach.gs v9 (SERVER.ai). Without it SERVER.ai is missing and the AI part stays out of the way.
   v8 UI patches (work with AI off too; fold into app.js at its next edit): mid/core reminder = 2× a week · "Who is this?" is mandatory, asked once per phone
   (the phone is tagged with that person; Sync → Change) · Sync Refresh button uses the pill style · "+ New exercise" gets the same finder. */
(function(){
const hasAi = () => !!(SERVER && SERVER.ai);
const aiOn = () => hasAi() && SERVER.ai.enabled;
const hm = s => s && s.slice(0, 10) === today() ? s.slice(11, 16) : '';          // HH:mm only if it happened today (older AI content shows no time)
const tm = s => { const t = hm(s); return t ? ' · ' + t : ''; };
let askDraft = '', planOpen = false, insOpen = {}, busyOps = {};

/* ---------- backend ---------- */
async function coachCall(r){
  try{
    const j = await call(Object.assign({action:'coach'}, r));
    if (!j.ok) throw new Error(j.error);
    if (j.ai && SERVER) { SERVER.ai = j.ai; LS.set('data', SERVER); rebuild(); }
    return j;
  }catch(e){ toast('⚠️ ' + (e.message === 'NO_URL' ? 'No connection' : String(e.message || e)), 3200); return null; }
}
/** lock a button (disabled + "…") while an AI call runs */
async function lockBtn(b, fn){
  if (!b || b.disabled) return;
  const t = b.textContent; b.disabled = true; b.textContent = '…';
  try { return await fn(); } finally { if (b.isConnected) { b.disabled = false; b.textContent = t; } }
}

/* ---------- "next" target: only from the AI (nothing when AI is off or has no suggestion) ---------- */
let sugSrc = null, sugMap = {};
function sugFor(name, person){
  if (!aiOn()) return null;
  if (sugSrc !== SERVER.ai.sug) { sugSrc = SERVER.ai.sug; sugMap = {}; sugSrc.forEach(r => sugMap[r[0] + '|' + r[1].toLowerCase()] = r); }   // [person, ex, equipment, kg, reps, reason, based on, run id, created]; later rows win
  return sugMap[person + '|' + String(name).toLowerCase()] || null;
}
targetFor = function(name, person){
  const g = sugFor(name, person); if (!g) return null;
  const kg = Number(g[3]) || 0, reps = Number(g[4]) || 0; if (!reps) return null;
  if (D.isIso(name)) return { iso:true, sec:reps, ai:true };
  const s = D.stats[String(name).toLowerCase() + '|' + person];
  if (kg <= 0) return { bw:true, kg:0, reps, ai:true };
  return { kg, reps, ai:true, up: s && kg > (s.lastKg || 0) ? kg - (s.lastKg || 0) : 0 };
};
const _tgtText = tgtText;
tgtText = t => _tgtText(t) + (t && t.ai ? ' ✨' : '');

const _exCard = exCard;
exCard = function(it, w){
  let h = _exCard(it, w);
  if (!aiOn() || w === EDIT) return h;
  const g = sugFor(it.ex, w.people[0]); if (!g) return h;
  if (g[2]) h = h.replace(/(<span class="tag s-\w+">\w+<\/span>)/, m => m + `<span class="tag ai" title="equipment the coach assumed">${esc(g[2])}</span>`);
  if (g[5]) h = h.replace(/(<div class="pp-h">[\s\S]*?<\/div>)/, m => m + `<div class="small aic" style="margin:-2px 0 6px">✨ ${esc(g[5])}${tm(g[8])}</div>`);
  return h;
};

/* ---------- Sync screen: AI On/Off switch + pill-style Refresh + "This phone" ---------- */
function statusText(){
  const A = SERVER.ai, q = A.q || {};
  if (!A.enabled) return 'Off — nothing is sent to the coach' + (q.held ? ` · ${q.held} held` : '');
  const b = [];
  if (q.running) b.push('Coach is working…'); else if (q.pending) b.push(`${q.pending} waiting · catching up`); else b.push('Idle');
  if (q.last) b.push('last run ' + (hm(q.last) || q.last.slice(5, 10)));
  if (q.error) b.push('⚠ ' + (q.err || 'last run failed'));
  return b.join(' · ');
}
const _drawSync = drawSync;
drawSync = function(){
  _drawSync();
  const rb = $('#syRefresh');                                              // Refresh = same pill style as the switches
  if (rb && !rb.parentNode.classList.contains('sw')) { const w = document.createElement('div'); w.className = 'sw'; rb.replaceWith(w); rb.className = ''; w.appendChild(rb); }
  const me = LS.get('me', null);
  if (me && DATA) {
    $('#shBody').insertAdjacentHTML('beforeend', `<div class="card" style="padding:12px"><div class="row"><div style="flex:1;min-width:0"><b>📱 This phone</b><div class="small muted">${pn(me)}</div></div><div class="sw"><button id="whoBtn">Change</button></div></div></div>`);
    $('#whoBtn').onclick = () => { LS.del('me'); closeSheet(); askWho(); };
  }
  if (!hasAi()) return;
  const on = SERVER.ai.enabled;
  $('#shBody').insertAdjacentHTML('afterbegin', `<div class="card ai" style="padding:12px"><div class="row"><div style="flex:1;min-width:0"><b>✨ AI coach</b><div class="small muted">${esc(statusText())}</div></div>
    <div class="sw" id="aiSeg"><button data-v="1" class="${on ? 'on' : ''}">On</button><button data-v="0" class="${on ? '' : 'on'}">Off</button></div></div></div>`);
  $('#aiSeg').onclick = async e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const want = b.dataset.v === '1'; if (want === SERVER.ai.enabled) return;
    SERVER.ai.enabled = want; drawSync(); render();                          // instant, then the sheet confirms
    const j = await coachCall({op:'toggle', enabled: want});
    if (!j) { SERVER.ai.enabled = !want; LS.set('data', SERVER); } else toast(want ? '✨ AI on' : 'AI off');
    if (syncOpen) drawSync(); render();
  };
};

/* ---------- "Who is this?": mandatory, once per phone (this phone is tagged with that person) ---------- */
let whoOpen = false;
const _closeSheet = closeSheet;
closeSheet = function(){ whoOpen = false; const x = $('#shClose'); if (x) x.hidden = false; _closeSheet(); };
$('#shClose').onclick = () => { if (!whoOpen) closeSheet(); };
$('#scrim').onclick = () => { if (!whoOpen) closeSheet(); };
const _askWho = askWho;
askWho = function(){
  const me = LS.get('me', null);
  if (me && DATA && DATA.people.indexOf(me) >= 0) { LS.del('askWho'); return; }      // already tagged: never ask again
  _askWho();
  if ($('#shBody [data-who]')) {
    whoOpen = true; $('#shTitle').textContent = 'Who is this?'; $('#shClose').hidden = true;
    $('#shBody').insertAdjacentHTML('afterbegin', '<p class="small muted" style="margin:0 0 10px">This phone gets tagged with the person you pick.</p>');
  }
};

/* ---------- header line ---------- */
const _renderHeader = renderHeader;
renderHeader = function(){
  _renderHeader();
  if (!aiOn()) return;
  const q = SERVER.ai.q || {}, el = $('#titleSub');
  if (q.pending || q.running) el.textContent = (el.textContent ? el.textContent + ' · ' : '') + '✨ Coach is catching up…';
};

/* ---------- Dashboard: one purple Coach + Ask card, after Body split ---------- */
document.addEventListener('input', e => { if (e.target.id === 'aiQ') askDraft = e.target.value; });
const CHIPS = ['What should I improve?', 'What are my weak points?'];
function coachCard(){
  const A = SERVER.ai, p = SEL[0];
  const all = A.ins.filter(x => x[2] === p), fresh = all.filter(x => x[8] === 'new').length;
  const newest = all.reduce((m, x) => x[1] > m ? x[1] : m, ''), recent = newest && daysAgo(newest.slice(0, 10)) <= 1;
  const asks = A.asks.filter(x => x[2] === p).slice(-3).reverse(), t = hm((A.q || {}).last || '');
  const rows = all.slice(-4).reverse().map(x => { const open = insOpen[x[0]];
    return `<div class="sub" data-ins="${x[0]}" data-new="${x[8] === 'new' ? 1 : ''}" style="cursor:pointer"><div class="row"><div class="grow" style="flex:1;min-width:0;font-weight:600;font-size:14px">${x[8] === 'new' ? '<span class="aic">●</span> ' : ''}${esc(x[5])}</div><span class="small dim">${hm(x[1])}</span><span class="dim">${open ? '▴' : '▾'}</span></div>
      ${open ? `<div class="small muted" style="margin-top:6px;white-space:pre-wrap">${esc(x[6])}</div>${x[7] ? `<div class="small aic" style="margin-top:4px;white-space:pre-wrap">→ ${esc(x[7])}</div>` : ''}` : ''}</div>`; }).join('');
  return `<div class="card ai" id="aiCoach"><h3><span class="sp aic">✨ Coach</span><span class="small aic" style="text-transform:none;letter-spacing:0">${fresh ? fresh + ' new' : ''}${fresh && t ? ' • ' : ''}${t}</span></h3>
    ${recent ? rows : `<button class="btn ai full" id="aiIns">My Workout Insights</button>`}
    <div class="aisep"><div class="row" style="gap:8px;margin-bottom:8px;flex-wrap:wrap">${CHIPS.map(c => `<button class="tag ai" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="row" style="gap:8px"><input id="aiQ" maxlength="300" placeholder="Ask your coach…" value="${esc(askDraft)}"><button class="btn sm ai" id="aiAsk">Ask</button></div>
    ${asks.map(x => `<div class="small" style="margin-top:8px"><b>${esc(x[3])}</b>${x[4] ? `<span class="dim">${tm(x[5])}</span>` : ''}<div class="muted" style="white-space:pre-wrap">${x[4] ? esc(x[4]) : '✨ queued'}</div></div>`).join('')}</div></div>`;
}
const _renderDash = renderDash;
renderDash = function(){
  _renderDash();
  if (!aiOn()) return;
  const cards = document.querySelectorAll('#v-dash .card'); if (cards.length < 2) return;
  cards[1].insertAdjacentHTML('afterend', coachCard());
  const box = $('#aiCoach');
  box.onclick = async e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) { askDraft = chip.dataset.chip; $('#aiQ').value = askDraft; return; }                // chips only fill the input
    const ins = e.target.closest('[data-ins]');
    if (ins) { const k = ins.dataset.ins; insOpen[k] = !insOpen[k]; if (insOpen[k] && ins.dataset.new) coachCall({op:'insight', row:k, status:'seen'}); return renderDash(); }
    if (e.target.id === 'aiIns') return lockBtn(e.target, async () => { if (await coachCall({op:'insights', person: SEL[0]})) toast('✨ Queued — tap Dashboard in a minute'); });
    if (e.target.id === 'aiAsk') return lockBtn(e.target, async () => {
      const q = askDraft.trim(); if (!q) return toast('Type a question');
      if (await coachCall({op:'ask', person: SEL[0], q})) { askDraft = ''; toast('✨ Queued'); renderDash(); }
    });
  };
};

/* ---------- Workout start screen: AI plan card (persists until a finished workout advances the rotation) + Create with AI ---------- */
function planRows(p){
  const all = SERVER.ai.plan.filter(r => r[0] === p); if (!all.length) return [];
  const day = all[all.length - 1][1];
  return all.filter(r => r[1] === day).sort((a, b) => a[2] - b[2]).slice(0, 6).map(r => ({day:r[1], ex:r[3], sets:r[4], kg:r[5], reps:r[6], role:r[7], reason:r[8], at:r[9] || ''}));
}
const inMenu = n => DATA.menu.some(m => m[0].toLowerCase() === n.toLowerCase());
function planLive(p, rows){                                                 // shown until nextPlanIndex moves past the value seen with this plan
  const key = p + '|' + rows.map(r => r.ex).join(','), seen = LS.get('aiPlanSeen', {});
  if (!seen[p] || seen[p].key !== key) { seen[p] = {key, idx: nextPlanIndex(p)}; LS.set('aiPlanSeen', seen); return true; }
  return seen[p].idx === nextPlanIndex(p);
}
async function acceptPlan(p, rows){
  const type = /lower|leg/i.test(rows[0].day) ? 'lower' : 'upper', idx = planIdxFor(p, type);
  const miss = rows.filter(r => !inMenu(r.ex)), hidn = miss.filter(r => SERVER.ai.hid && DATA.hid[r.ex.toLowerCase()]);
  startDraft(idx, [], cap(type), type);
  DRAFT.planIdxBy = {[p]: idx}; DRAFT.ai = true;
  rows.forEach(r => {
    const it = newItem(r.ex), n = Math.max(1, Number(r.sets) || 3), kg = Number(r.kg) > 0 && !D.isIso(r.ex) ? r.kg : '';
    it.sets[p] = Array.from({length:n}, () => ({kg:'', reps:'', done:false, pk:kg, pr:r.reps, tag:'next'}));
    DRAFT.items.push(it);
  });
  saveDraft(); render(); window.scrollTo(0, 0); toast('✨ AI plan loaded');
  miss.filter(r => hidn.indexOf(r) < 0).forEach(r => {                      // unlisted exercises join the Menu automatically
    const sp = /^(upper|mid|lower)$/.test(r.role) ? r.role : type, ty = D.isIso(r.ex) || /static/i.test(r.role) ? 'static' : '';
    (SERVER ? SERVER.menu : DATA.menu).push([r.ex, sp, ty]);
    write({action:'addExercise', name:r.ex, split:sp, type:ty}, 'Added ' + r.ex);
  });
  if (hidn.length) coachCall({op:'activate', names: hidn.map(r => r.ex)});
}
/** workouts of this person this week (Mon–Sun) that had a mid/core exercise */
function midThisWeek(p){
  const now = parseYmd(today()), ws = new Date(now); ws.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const from = ymd(ws), days = {};
  D.logs.forEach(l => { if (l.person === p && l.date && l.date >= from && l.split === 'mid') days[l.date] = 1; });
  return Object.keys(days).length;
}
const _renderWork = renderWork;
renderWork = function(){
  _renderWork();
  const note = [...document.querySelectorAll('#v-work p.small.muted')].find(x => /^Remember: add 1 mid/.test(x.textContent));
  if (note) { const n = midThisWeek(SEL[0]); note.textContent = n >= 2 ? 'Mid/core: 2 of 2 done this week ✓ · optional today. Add 1 static hold.' : `Mid/core this week: ${n} of 2. Add 1 static hold.`; }
  if (!aiOn() || (DRAFT && !NEWW)) return;
  const p = SEL[0], rows = planRows(p), box = $('#savedNotes'); if (!box) return;
  const live = rows.length && planLive(p, rows);
  box.insertAdjacentHTML('beforebegin', `${live ? `<div class="card ai" id="aiPlan"><h3><span class="sp aic">✨ Coach plan · ${esc(rows[0].day)}${tm(rows[0].at)}</span></h3>
    <div class="list">${rows.map(r => `<div class="li"><div class="grow"><div class="t">${esc(r.ex)}${inMenu(r.ex) ? '' : ' <span class="tag ai">new</span>'}</div><div class="small muted" style="text-transform:none">${esc(r.reason || r.role || '')}</div></div>
      <span class="small"><b>${r.sets}×</b> ${Number(r.kg) > 0 ? fkg(r.kg) + ' kg × ' : ''}${esc(r.reps)}</span></div>`).join('')}</div>
    <button class="btn ai full" id="aiAccept" style="margin-top:10px">Accept & start</button></div>` : ''}
    <div class="card ai" id="aiMake" style="padding:12px"><button class="btn ai full" id="aiMakeBtn">✨ Create workout with AI</button>
      ${planOpen ? `<div class="aisep" style="margin-top:10px"><input id="aiPref" maxlength="200" placeholder="e.g. full body, focus on glutes"><button class="btn ai full" id="aiPrefGo" style="margin-top:8px">Create</button>
        <p class="small dim" style="margin:8px 0 0">Max 6 exercises, 1 static. The plan appears above after the next coach run — tap Workout again in a minute.</p></div>` : ''}</div>`);
  const a = $('#aiAccept'); if (a) a.onclick = () => acceptPlan(p, rows);
  $('#aiMakeBtn').onclick = () => { planOpen = !planOpen; renderWork(); };
  const g = $('#aiPrefGo'); if (g) g.onclick = () => lockBtn(g, async () => {
    const q = ($('#aiPref').value || '').trim(); if (!q) return toast('Type a preference');
    if (await coachCall({op:'plan', person: p, q})) { planOpen = false; toast('✨ Queued'); renderWork(); }
  });
};
const _wTabs = wTabs;
wTabs = function(){
  let h = _wTabs();
  if (aiOn()) wips(SEL[0]).forEach(d => { if (d.ai) h = h.replace(`data-w="${didOf(d)}">`, `data-w="${didOf(d)}">✨ `); });
  return h;
};

/* ---------- Finish: notes + RIR for the coach, sent with the sets (the backend then queues a "targets" run) ---------- */
const _showSummary = showSummary;
showSummary = function(S, onDone, sub){
  _showSummary(S, onDone, sub);
  const ok = $('#smOk'); if (!ok || !DRAFT || !aiOn()) return;
  const exs = [...new Set(S.rows.map(r => r.ex))], did = didOf(DRAFT), person = DRAFT.people[0], date = DRAFT.date;
  ok.insertAdjacentHTML('beforebegin', `<details id="aiNotes" class="card ai" style="padding:9px 11px;margin:10px 0 0"><summary class="aic" style="cursor:pointer;font-weight:600">✨ Notes for the coach <span class="small muted">(optional)</span></summary>
    <div class="small muted" style="margin:8px 0 4px">RIR = reps you had left in the tank on the last set.</div>
    ${exs.map(x => `<div class="row" style="gap:6px;margin-bottom:6px"><span class="small" style="width:34%;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x)}</span>
      <select data-rir="${esc(x)}" style="width:76px;flex:none;padding:8px"><option value="">RIR</option>${[0,1,2,3,4].map(n => `<option>${n}</option>`).join('')}</select>
      <input data-note="${esc(x)}" maxlength="200" placeholder="note" style="padding:8px 10px"></div>`).join('')}
    <input id="aiWNote" maxlength="300" placeholder="How did the workout feel?" style="margin-top:4px"></details>`);
  ok.onclick = () => {
    const notes = exs.map(x => ({ex:x, rir:($(`#aiNotes [data-rir="${CSS.escape(x)}"]`) || {}).value || '', note:(($(`#aiNotes [data-note="${CSS.escape(x)}"]`) || {}).value || '').trim()}))
      .filter(n => n.rir !== '' || n.note);
    const wnote = ($('#aiWNote') || {value:''}).value.trim();
    const all = LS.get('aiNotes', {}); all[did] = {did, person, date, notes, wnote, at: Date.now()};
    Object.keys(all).forEach(k => { if (Date.now() - (all[k].at || 0) > 14 * 864e5) delete all[k]; });
    LS.set('aiNotes', all);
    onDone();
  };
};
/* every addLogs request carries one coach item per workout (the backend writes Notes + a "targets" Queue row, then fires the routine) */
const _call = call;
call = function(req){
  if (req && req.action === 'addLogs' && req.entries && !req.coach && aiOn()) {
    const stored = LS.get('aiNotes', {}), by = {};
    req.entries.forEach(e => { const did = String(e.cid).split(':')[0]; if (did && !by[did]) by[did] = {did, person:e.person, date:e.date}; });
    req.coach = Object.keys(by).map(d => Object.assign(by[d], {notes: (stored[d] || {}).notes || [], wnote: (stored[d] || {}).wnote || ''}));
  }
  return _call(req);
};
/* History edits / deletes refresh the "next" targets too (one waiting run per person) */
const _write = write;
write = async function(req, okMsg){
  const ok = await _write(req, okMsg);
  if (ok && aiOn() && (req.action === 'saveDay' || req.action === 'deleteLogs')) coachCall({op:'queue', type:'edit', person: SEL[0], ref:'h' + Date.now().toString(36)});
  return ok;
};

/* ---------- exercise finder: one search box serves the menu and the AI (results only after a click, cleared when the sheet closes) ---------- */
function finder(slot, qInput, opt){
  const box = $(slot), p = SEL[0], sel = new Set(); let asked = '';
  const ready = () => SERVER.ai.ideas.filter(x => x[2] === p && x[4] && x[3] === asked);
  const draw = () => {
    const ql = ($(qInput).value || '').trim(), match = DATA.menu.some(m => m[0].toLowerCase().includes(ql.toLowerCase()));
    const rs = asked ? ready() : [], wait = asked && SERVER.ai.ideas.some(x => x[2] === p && !x[4] && x[3] === asked);
    box.innerHTML = (ql && !match && !asked ? `<button class="btn ai full" id="fnGo" style="margin-top:8px">✨ Suggest workout with AI</button>` : '')
      + (asked ? `<div class="small aic" style="margin:8px 0 4px">✨ “${esc(asked)}”${rs.length ? tm(rs[rs.length - 1][12]) : ''} <button class="small aic" id="fnRef" style="float:right">↻</button></div>` : '')
      + (wait ? '<div class="small muted">Queued — tap ↻ in a minute</div>' : '')
      + rs.map(x => `<div class="pick ${sel.has(x[0]) ? 'sel' : ''}" data-ir="${x[0]}"><span class="chk">${sel.has(x[0]) ? '✓' : ''}</span>
        <span class="t">${esc(x[4])}<div class="small muted" style="text-transform:none">${esc(x[7])}${x[8] ? ' · ' + esc(x[8]) : ''}</div></span>${x[9] === 'yes' ? '' : '<span class="tag ai">new</span>'}<span class="tag s-${esc(x[5] || 'upper')}">${esc(x[5] || 'upper')}</span></div>`).join('')
      + (sel.size ? `<button class="btn ai full" id="fnAdd" style="margin-top:8px">Add ${sel.size} selected</button>` : '');
  };
  $(qInput).addEventListener('input', () => { if (asked && $(qInput).value.trim() !== asked) { asked = ''; sel.clear(); } draw(); });
  box.onclick = async e => {
    if (e.target.id === 'fnGo') return lockBtn(e.target, async () => { const q = $(qInput).value.trim(); if (await coachCall({op:'suggest', person:p, q})) { asked = q; draw(); toast('✨ Queued'); } });
    if (e.target.id === 'fnRef') return lockBtn(e.target, async () => { await refresh(true); draw(); });
    if (e.target.id === 'fnAdd') return lockBtn(e.target, async () => {
      const picks = ready().filter(x => sel.has(x[0]));
      const j = await coachCall({op:'ideasAdded', rows: picks.map(x => x[0]), items: picks.map(x => ({name: titleCase(x[4]), split: x[5] || 'upper', type: x[6] === 'static' ? 'static' : ''}))});
      if (!j) return;
      await refresh(true);
      closeSheet(); if (opt && opt.onPick) opt.onPick(picks.map(x => titleCase(x[4]))); else render();
    });
    const r = e.target.closest('[data-ir]'); if (!r) return;
    const k = Number(r.dataset.ir); if (sel.has(k)) sel.delete(k); else sel.add(k); draw();
  };
  draw();
}
const _openPicker = openPicker;
openPicker = function(opt){
  _openPicker(opt);
  if (aiOn() && opt && opt.multi && opt.title === 'Add exercise') finder('#pkAi', '#pkQ', opt);
};
const _openMenuMgr = openMenuMgr;
openMenuMgr = function(){
  _openMenuMgr();
  if (aiOn()) finder('#mmAi', '#mmQ', null);
};
/* "+ New exercise" is the same function as Add exercise: the name field is the search box, the finder sits under it */
const _openExEdit = openExEdit;
openExEdit = function(name){
  _openExEdit(name);
  if (name == null && aiOn() && $('#xeN')) { $('#xeN').insertAdjacentHTML('afterend', '<div id="xeAi"></div>'); finder('#xeAi', '#xeN', null); }
};

if (SERVER) render();
})();
