/* Gym Tracker — coach.js v10 (AI layer + UI patches). Loaded after app.js + dash.js. Wraps existing functions only.
   AI toggle (default OFF, Sync screen): ON = every AI feature shows. OFF = basic UI only (no Coach card, Ask, plan, Create with AI, ✨).
   Exception: "next" kg/reps always come from the AI (Suggestions tab, refreshed after every Finish, also when the toggle is Off); "next -" = no value yet.
   Needs Coach.gs v11 (SERVER.ai). Without it SERVER.ai is missing and the AI part stays out of the way.
   v10: waiting boxes + locked buttons while the AI works (Ask, Insights, Regenerate, Create workout, Finder) · 30 s refresh only while something waits ·
        "Create workout with AI" lives in Today's split, opens an in-progress workout that fills itself · purple AI workout tab · Coach plan card disappears once used ·
        "Empty" workout (Add exercise then shows All ★) · Add exercise has no search bar · AI finder only inside "+ New exercise" · History tag counts exercises ·
        Sync order: status, AI coach, theme, this phone.
   UI patches that work with AI off too: mid/core reminder 2× a week · "Who is this?" mandatory once per phone + "+ New person" · pill-style Refresh. */
(function(){
const hasAi = () => !!(SERVER && SERVER.ai);
const aiOn = () => hasAi() && SERVER.ai.enabled;
const hm = s => s && s.slice(0, 10) === today() ? s.slice(11, 16) : '';          // HH:mm only if it happened today
const tm = s => { const t = hm(s); return t ? ' · ' + t : ''; };
const tsOf = s => { const t = s ? new Date(String(s).replace(' ', 'T')).getTime() : 0; return t || 0; };
const mf = t => Math.floor(t / 60000) * 60000;                                    // sheet times have minute precision
const WAIT = 20 * 60000;                                                          // a request older than this no longer locks anything
let askDraft = '', planOpen = false, insOpen = {}, aiBusy = false, finWait = false, manual = false;
const waitBox = (t, sub) => `<div class="aiw"><div class="row" style="gap:8px"><i></i><b>${esc(t)}</b></div><div class="small">${esc(sub || "Might take a while… You can leave your question here. It's still in process and will appear when it's ready.")}</div></div>`;

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
/** the AI On/Off switch (Sync screen): instant, then the sheet confirms */
async function setAi(want){
  if (!hasAi() || aiBusy || want === SERVER.ai.enabled) return;
  aiBusy = true; SERVER.ai.enabled = want; if (syncOpen) drawSync(); render();
  const j = await coachCall({op:'toggle', enabled: want});
  if (!j) { SERVER.ai.enabled = !want; LS.set('data', SERVER); } else toast(want ? '✨ AI on' : 'AI off');
  aiBusy = false; if (syncOpen) drawSync(); render();
}

/* ---------- what is still waiting for the AI (each lock ends when the answer arrives, or after 20 min) ---------- */
const askWait = p => hasAi() && SERVER.ai.asks.some(x => x[2] === p && !x[4] && x[6] === 'pending' && Date.now() - tsOf(x[1]) < WAIT);
const insWait = p => { const t = (LS.get('insReq', {}) || {})[p]; if (!t || Date.now() - t > WAIT) return false; return !SERVER.ai.ins.some(x => x[2] === p && tsOf(x[1]) >= mf(t)); };
const planWait = d => !!(d && d.aiReq && !d.aiReq.done && Date.now() - d.aiReq.at < WAIT);

/* ---------- "next" target: always from the AI (Suggestions tab); nothing in the sheet yet → "next -" ---------- */
let sugSrc = null, sugMap = {};
function sugFor(name, person){
  if (!hasAi()) return null;
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
tgtText = t => _tgtText(t) + (t && t.ai && aiOn() ? ' ✨' : '');

const _exCard = exCard;
exCard = function(it, w){
  let h = _exCard(it, w);
  if (w === EDIT) return h;
  const k = it.ex.toLowerCase();
  w.people.forEach(p => { if (D.stats[k + '|' + p] && !targetFor(it.ex, p))                                          // no AI value yet → "next -"
    h = h.replace(/(<div class="pp-h">(?:<b[^>]*>[^<]*<\/b>)?<span>best [^<]*)(<\/span>)/, '$1 · <span class="dim">next -</span>$2'); });
  if (!aiOn()) return h;
  const g = sugFor(it.ex, w.people[0]); if (!g) return h;
  if (g[2]) h = h.replace(/(<span class="tag s-\w+">\w+<\/span>)/, m => m + `<span class="tag ai" title="equipment the coach assumed">${esc(g[2])}</span>`);
  if (g[5]) h = h.replace(/(<div class="pp-h">[\s\S]*?<\/div>)/, m => m + `<div class="small aic" style="margin:-2px 0 6px">✨ ${esc(g[5])}${tm(g[8])}</div>`);
  return h;
};

/* ---------- Sync screen: status → AI coach → theme → this phone (✕ closes) ---------- */
function statusText(){
  const A = SERVER.ai, q = A.q || {};
  if (!A.enabled) return 'Off — only the "next" targets update after Finish' + (q.held ? ` · ${q.held} held` : '');
  const b = [];
  if (q.running) b.push('Coach is working…'); else if (q.pending) b.push(`${q.pending} waiting · catching up`); else b.push('Idle');
  if (q.last) b.push('last run ' + (hm(q.last) || q.last.slice(5, 10)));
  if (q.error) b.push('⚠ ' + (q.err || 'last run failed'));
  return b.join(' · ');
}
const _drawSync = drawSync;
drawSync = function(){
  _drawSync();
  const x = $('#shClose'); if (x) x.hidden = false;
  const rb = $('#syRefresh');                                              // Refresh = same pill style as the switches
  if (rb && !rb.parentNode.classList.contains('sw')) { const w = document.createElement('div'); w.className = 'sw'; rb.replaceWith(w); rb.className = ''; w.appendChild(rb); }
  const first = $('#shBody').firstElementChild;
  if (hasAi() && first) {
    const on = SERVER.ai.enabled;
    first.insertAdjacentHTML('afterend', `<div class="card ai" style="padding:12px"><div class="row"><div style="flex:1;min-width:0"><b>✨ AI coach</b><div class="small muted">${esc(statusText())}</div></div>
      <div class="sw" id="aiSeg"><button data-v="1" class="${on ? 'on' : ''}">On</button><button data-v="0" class="${on ? '' : 'on'}">Off</button></div></div></div>`);
    $('#aiSeg').onclick = e => { const b = e.target.closest('[data-v]'); if (b) setAi(b.dataset.v === '1'); };
  }
  const me = LS.get('me', null);
  if (me && DATA) {
    $('#shBody').insertAdjacentHTML('beforeend', `<div class="card" style="padding:12px"><div class="row"><div style="flex:1;min-width:0"><b>📱 This phone</b><div class="small muted">${pn(me)}</div></div><div class="sw"><button id="whoBtn">Change</button></div></div></div>`);
    $('#whoBtn').onclick = () => { LS.del('me'); closeSheet(); askWho(); };
  }
};

/* ---------- "Who is this?": mandatory, once per phone (this phone is tagged with that person) + "+ New person" ---------- */
let whoOpen = false;
const _closeSheet = closeSheet;
closeSheet = function(){ whoOpen = false; finWait = false; const x = $('#shClose'); if (x) x.hidden = false; _closeSheet(); };
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
    $('#shBody').insertAdjacentHTML('beforeend', '<button class="btn full" id="whoNew" style="margin-top:4px;border-style:dashed">+ New person</button>');
    $('#whoNew').onclick = newPersonForm;
  }
};
/** new user on the first page: name + optional gender → creates the profile in the sheet and tags this phone with it */
function newPersonForm(){
  let gender = '';
  $('#shTitle').textContent = 'New person';
  $('#shBody').innerHTML = `<p class="small muted" style="margin:0 0 10px">New here? Add yourself. This phone will be tagged with you.</p>
    <div class="fld"><label>Name</label><input id="nwN" maxlength="20" placeholder="e.g. Bayu" autocomplete="off"></div>
    <div class="small muted" style="margin-bottom:4px">Gender (optional · locked once chosen)</div>
    <div class="gx" id="nwG"><button class="m" data-g="m" aria-label="Male">${gSym('m')}</button><button class="f" data-g="f" aria-label="Female">${gSym('f')}</button></div>
    <button class="btn pri full" id="nwGo">Add &amp; start</button><button class="btn full" id="nwBack" style="margin-top:8px">Back</button>`;
  $('#nwG').onclick = e => { const b = e.target.closest('[data-g]'); if (!b) return; gender = b.dataset.g;
    $('#nwG').querySelectorAll('button').forEach(z => z.classList.toggle('on', z.dataset.g === gender)); };
  $('#nwBack').onclick = () => askWho();
  $('#nwGo').onclick = () => {
    const name = titleCase($('#nwN').value); if (!name) return toast('Type your name');
    if (!DATA || !SERVER) return toast('📴 Needs a connection');
    if (DATA.pinfo.some(y => String(y[1]).toLowerCase() === name.toLowerCase())) return toast('That name exists — pick it from the list');
    let c = name.charAt(0).toUpperCase(); const base = c; let n = 2;
    while (DATA.pinfo.some(y => y[0] === c)) c = base + n++;
    DATA.pinfo.push([c, name, false, {}, gender]);
    SERVER.people = DATA.pinfo; LS.set('data', SERVER);
    LS.set('me', c); rebuild();
    SEL = [c]; LS.set('sel', SEL); NEWW = false; syncDraft();
    closeSheet(); render();
    write({action:'savePerson', code:c, name, hidden:false, gender}, 'Welcome ' + name + ' 💪');
  };
}

/* ---------- header line ---------- */
const _renderHeader = renderHeader;
renderHeader = function(){
  _renderHeader();
  if (!aiOn()) return;
  const q = SERVER.ai.q || {}, el = $('#titleSub');
  if (q.pending || q.running) el.textContent = (el.textContent ? el.textContent + ' · ' : '') + '✨ Coach is catching up…';
};

/* ---------- History: the U/M/L tag counts different exercises, not sets ---------- */
const _dayCard = dayCard;
dayCard = function(date, logs){
  const ex = {upper:new Set(), mid:new Set(), lower:new Set()};
  logs.forEach(l => ex[l.split].add(l.ex.toLowerCase()));
  return _dayCard(date, logs).replace(/(<span class="tag s-(upper|mid|lower)">[UML] )\d+/g, (m, a, k) => a + ex[k].size);
};

/* ---------- Dashboard: one purple Coach + Ask card after Body split ---------- */
document.addEventListener('input', e => { if (e.target.id === 'aiQ') askDraft = e.target.value; });
const CHIPS = ['What should I improve?', 'What are my weak points?'];
function coachCard(){
  const A = SERVER.ai, p = SEL[0];
  const all = A.ins.filter(x => x[2] === p), fresh = all.filter(x => x[8] === 'new').length;
  const newest = all.reduce((m, x) => x[1] > m ? x[1] : m, ''), recent = newest && daysAgo(newest.slice(0, 10)) <= 1;
  const asks = A.asks.filter(x => x[2] === p).slice(-3).reverse(), t = hm((A.q || {}).last || ''), iw = insWait(p), aw = askWait(p);
  const rows = all.slice(-4).reverse().map(x => { const open = insOpen[x[0]];
    return `<div class="sub" data-ins="${x[0]}" data-new="${x[8] === 'new' ? 1 : ''}" style="cursor:pointer"><div class="row"><div class="grow" style="flex:1;min-width:0;font-weight:600;font-size:14px">${x[8] === 'new' ? '<span class="aic">●</span> ' : ''}${esc(x[5])}</div><span class="small dim">${hm(x[1])}</span><span class="dim">${open ? '▴' : '▾'}</span></div>
      ${open ? `<div class="small muted" style="margin-top:6px;white-space:pre-wrap">${esc(x[6])}</div>${x[7] ? `<div class="small aic" style="margin-top:4px;white-space:pre-wrap">→ ${esc(x[7])}</div>` : ''}` : ''}</div>`; }).join('');
  const body = (iw ? waitBox('Building your insights') : '') + (recent ? rows : '')
    + (recent ? `<button class="btn aio full" id="aiRegen" ${iw ? 'disabled' : ''}>↻ Regenerate insights</button>` : `<button class="btn ai full" id="aiIns" ${iw ? 'disabled' : ''}>My Workout Insights</button>`);
  const ans = x => x[4] ? `<span class="dim">${tm(x[5])}</span></b><div class="muted" style="white-space:pre-wrap">${esc(x[4])}</div>`
    : '</b>' + (Date.now() - tsOf(x[1]) < WAIT ? waitBox('Thinking about your question') : '<div class="muted">No answer yet.</div>');
  return `<div class="card ai" id="aiCoach"><h3><span class="sp aic">✨ Coach</span><span class="small aic" style="text-transform:none;letter-spacing:0">${fresh ? fresh + ' new' : ''}${fresh && t ? ' • ' : ''}${t}</span></h3>
    ${body}
    <div class="aisep"><div class="row" style="gap:8px;margin-bottom:8px;flex-wrap:wrap">${CHIPS.map(c => `<button class="tag ai" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="row" style="gap:8px"><input id="aiQ" maxlength="300" placeholder="Ask your coach…" value="${esc(askDraft)}"><button class="btn sm ai" id="aiAsk" ${aw ? 'disabled' : ''}>Ask</button></div>
    ${asks.map(x => `<div class="small" style="margin-top:8px"><b>${esc(x[3])}${ans(x)}</div>`).join('')}</div></div>`;
}
function mountCoach(){
  const cards = document.querySelectorAll('#v-dash .card'); if (cards.length < 2) return;
  cards[1].insertAdjacentHTML('afterend', coachCard());
  $('#aiCoach').onclick = async e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) { askDraft = chip.dataset.chip; $('#aiQ').value = askDraft; return; }                // chips only fill the input
    const ins = e.target.closest('[data-ins]');
    if (ins) { const k = ins.dataset.ins; insOpen[k] = !insOpen[k]; if (insOpen[k] && ins.dataset.new) coachCall({op:'insight', row:k, status:'seen'}); return renderDash(); }
    const p = SEL[0];
    if (e.target.id === 'aiIns' || e.target.id === 'aiRegen') return lockBtn(e.target, async () => {
      if (insWait(p)) return;
      const j = await coachCall({op:'insights', person: p, force: e.target.id === 'aiRegen'}); if (!j) return;
      if (!/up to date/i.test(j.msg || '')) LS.set('insReq', Object.assign({}, LS.get('insReq', {}), {[p]: Date.now()}));
      toast('✨ Queued'); renderDash();
    });
    if (e.target.id === 'aiAsk') return lockBtn(e.target, async () => {
      const q = askDraft.trim(); if (!q) return toast('Type a question');
      if (askWait(p)) return;
      if (await coachCall({op:'ask', person: p, q})) { askDraft = ''; toast('✨ Queued'); renderDash(); }
    });
  };
}
const _renderDash = renderDash;
renderDash = function(){
  _renderDash();
  if (aiOn()) mountCoach();
};

/* ---------- Workout: AI plan card (gone once used) · Create with AI (in Today's split) · Empty · purple AI tab ---------- */
function planRows(p, since){
  const all = SERVER.ai.plan.filter(r => r[0] === p && (!since || tsOf(r[9]) >= since)); if (!all.length) return [];
  const day = all[all.length - 1][1];
  return all.filter(r => r[1] === day).sort((a, b) => a[2] - b[2]).slice(0, 6).map(r => ({day:r[1], ex:r[3], sets:r[4], kg:r[5], reps:r[6], role:r[7], reason:r[8], at:r[9] || ''}));
}
const inMenu = n => DATA.menu.some(m => m[0].toLowerCase() === n.toLowerCase());
const planKey = (p, rows) => p + '|' + rows.map(r => r.ex).join(',') + '|' + rows[0].at;
const planUsed = (p, rows) => (LS.get('aiPlanUsed', {}) || {})[p] === planKey(p, rows);
const markUsed = (p, rows) => { const u = LS.get('aiPlanUsed', {}) || {}; u[p] = planKey(p, rows); LS.set('aiPlanUsed', u); };
/** put plan rows into the open workout (skips exercises already there); unlisted ones join the Menu, hidden ones are activated */
function addPlanItems(p, rows, type){
  const miss = rows.filter(r => !inMenu(r.ex)), hidn = miss.filter(r => SERVER.ai.hid && DATA.hid[r.ex.toLowerCase()]);
  rows.forEach(r => {
    if (DRAFT.items.some(i => i.ex.toLowerCase() === r.ex.toLowerCase())) return;
    const it = newItem(r.ex, [p]), n = Math.max(1, Number(r.sets) || 3), kg = Number(r.kg) > 0 && !D.isIso(r.ex) ? r.kg : '';
    it.sets[p] = Array.from({length:n}, () => ({kg:'', reps:'', done:false, pk:kg, pr:r.reps, tag:'next'}));
    DRAFT.items.push(it);
  });
  miss.filter(r => hidn.indexOf(r) < 0).forEach(r => {
    const sp = /^(upper|mid|lower)$/.test(r.role) ? r.role : (type || 'upper'), ty = D.isIso(r.ex) || /static/i.test(r.role) ? 'static' : '';
    (SERVER ? SERVER.menu : DATA.menu).push([r.ex, sp, ty]);
    write({action:'addExercise', name:r.ex, split:sp, type:ty}, 'Added ' + r.ex);
  });
  if (hidn.length) coachCall({op:'activate', names: hidn.map(r => r.ex)});
}
function acceptPlan(p, rows){
  const type = /lower|leg/i.test(rows[0].day) ? 'lower' : 'upper', idx = planIdxFor(p, type);
  startDraft(idx, [], cap(type), type);
  DRAFT.planIdxBy = {[p]: idx}; DRAFT.ai = true;
  addPlanItems(p, rows, type); markUsed(p, rows);
  saveDraft(); render(); window.scrollTo(0, 0); toast('✨ AI plan loaded');
}
/** an in-progress "Create with AI" workout fills itself when its plan reaches the sheet (no Accept step) */
function fillAi(d){
  const r = d.aiReq; if (!r || r.done || !aiOn()) return;
  if (Date.now() - r.at > WAIT) { r.done = true; storeDraft(); return; }
  const p = d.people[0], rows = planRows(p, mf(r.at)); if (!rows.length) return;
  r.done = true; addPlanItems(p, rows, ''); markUsed(p, rows); saveDraft(); toast('✨ Workout ready');
}
/** workouts of this person this week (Mon–Sun) that had a mid/core exercise */
function midThisWeek(p){
  const now = parseYmd(today()), ws = new Date(now); ws.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const from = ymd(ws), days = {};
  D.logs.forEach(l => { if (l.person === p && l.date && l.date >= from && l.split === 'mid') days[l.date] = 1; });
  return Object.keys(days).length;
}
function startExtras(){
  const p = SEL[0], type = LS.get('pickType', recSplit()), chips = $('#planChips'); if (!chips) return;
  chips.insertAdjacentHTML('beforeend', `<button class="chip ${type === 'empty' ? 'on' : ''}" data-t="empty">Empty</button>`);
  const note = [...document.querySelectorAll('#v-work p.small.muted')].find(x => /^Remember: add 1 mid/.test(x.textContent));
  if (note) { const n = midThisWeek(p); if (type === 'empty') note.hidden = true; else note.textContent = n >= 2 ? 'Mid/core: 2 of 2 done this week ✓ · optional today. Add 1 static hold.' : `Mid/core this week: ${n} of 2. Add 1 static hold.`; }
  if (type === 'empty') $('#goPlan').onclick = () => { LS.del('pickType'); startDraft(null, [], 'Empty', ''); render(); };   // no rotation day: Add exercise shows everything
  if (!aiOn()) return;
  const rows = planRows(p), box = $('#savedNotes');
  $('#goPlan').insertAdjacentHTML('afterend', `<button class="btn ai full" id="aiMakeBtn" style="margin-top:8px">✨ Create workout with AI</button>
    ${planOpen ? `<div class="aisep" style="margin-top:10px"><input id="aiPref" maxlength="200" placeholder="e.g. full body, focus on glutes"><button class="btn ai full" id="aiPrefGo" style="margin-top:8px">Create</button></div>` : ''}`);
  if (rows.length && !planUsed(p, rows)) box.insertAdjacentHTML('beforebegin', `<div class="card ai" id="aiPlan"><h3><span class="sp aic">✨ Coach plan · ${esc(rows[0].day)}${tm(rows[0].at)}</span></h3>
    <div class="list">${rows.map(r => `<div class="li"><div class="grow"><div class="t">${esc(r.ex)}${inMenu(r.ex) ? '' : ' <span class="tag ai">new</span>'}</div><div class="small muted" style="text-transform:none">${esc(r.reason || r.role || '')}</div></div>
      <span class="small"><b>${r.sets}×</b> ${Number(r.kg) > 0 ? fkg(r.kg) + ' kg × ' : ''}${esc(r.reps)}</span></div>`).join('')}</div>
    <button class="btn ai full" id="aiAccept" style="margin-top:10px">Accept & start</button></div>`);
  const a = $('#aiAccept'); if (a) a.onclick = () => acceptPlan(p, rows);
  $('#aiMakeBtn').onclick = () => { planOpen = !planOpen; renderWork(); };
  const g = $('#aiPrefGo'); if (g) g.onclick = () => lockBtn(g, async () => {
    const q = ($('#aiPref').value || '').trim(); if (!q) return toast('Type a preference');
    if (!await coachCall({op:'plan', person: p, q})) return;
    planOpen = false; startDraft(null, [], 'Custom', ''); DRAFT.ai = true; DRAFT.aiReq = {at: Date.now(), q}; saveDraft();   // opens "in progress", fills itself
    render(); window.scrollTo(0, 0);
  });
}
const _renderWork = renderWork;
renderWork = function(){
  if (DRAFT && !NEWW) fillAi(DRAFT);
  _renderWork();
  if (!DRAFT || NEWW) return startExtras();
  const c = $('#wDate'); if (aiOn() && planWait(DRAFT) && c) c.closest('.card').insertAdjacentHTML('afterend', waitBox('Building your workout', "Might take a while… You can leave this open or come back later. The exercises with weight and reps fill in here when they're ready."));
};
const _wTabs = wTabs;
wTabs = function(){
  let h = _wTabs();
  if (aiOn()) wips(SEL[0]).forEach(d => { if (d.ai) h = h.replace(new RegExp(`class="chip( on)?" data-w="${didOf(d)}">`), (m, o) => `class="chip ai${o || ''}" data-w="${didOf(d)}">✨ `); });
  return h;
};

/* ---------- Finish: notes + RIR for the coach (AI on); every Finish also queues the "next" targets run (AI on or off) ---------- */
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
  if (req && req.action === 'addLogs' && req.entries && !req.coach && hasAi()) {
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
  if (ok && hasAi() && (req.action === 'saveDay' || req.action === 'deleteLogs')) coachCall({op:'queue', type:'edit', person: SEL[0], ref:'h' + Date.now().toString(36)});
  return ok;
};

/* ---------- Add exercise: no search bar (gear kept; Empty workout → "All ★") ---------- */
const _openPicker = openPicker;
openPicker = function(opt){
  if (opt && opt.title === 'Add exercise' && !opt.star && VIEW === 'work' && DRAFT && !DRAFT.split) opt.star = 'all';
  _openPicker(opt);
  const q = $('#pkQ'); if (q && opt && opt.title === 'Add exercise') q.closest('.search').remove();
};

/* ---------- "+ New exercise": AI finder or manual ---------- */
function finder(slot, qInput){
  const box = $(slot), p = SEL[0], sel = new Set(); let asked = '';
  const ready = () => SERVER.ai.ideas.filter(x => x[2] === p && x[4] && x[3] === asked);
  const draw = () => {
    const ql = ($(qInput).value || '').trim(), rs = asked ? ready() : [], wait = !!asked && !rs.length;
    finWait = wait;
    box.innerHTML = (!asked && ql ? `<button class="btn ai full" id="fnGo" style="margin-top:8px">✨ Find exercises</button>` : '')
      + (asked ? `<div class="small aic" style="margin:8px 0 4px">✨ “${esc(asked)}”${rs.length ? tm(rs[rs.length - 1][12]) : ''} <button class="small aic" id="fnRef" style="float:right">↻</button></div>` : '')
      + (wait ? waitBox('Finding exercises') : '')
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
      closeSheet(); openMenuMgr();
    });
    const r = e.target.closest('[data-ir]'); if (!r) return;
    const k = Number(r.dataset.ir); if (sel.has(k)) sel.delete(k); else sel.add(k); draw();
  };
  draw();
}
function newChooser(){
  openSheet('New exercise', `<button class="btn ai full" id="ncAi">✨ Find exercise with AI</button><button class="btn full" id="ncMan" style="margin-top:8px">Add manually</button><button class="btn full" id="ncBack" style="margin-top:8px">Back</button>`);
  $('#ncAi').onclick = findScreen; $('#ncMan').onclick = () => { manual = true; openExEdit(null); }; $('#ncBack').onclick = openMenuMgr;
}
function findScreen(){
  openSheet('Find exercise with AI', `<div class="fld"><input id="fnQ" maxlength="200" placeholder="e.g. glute exercises with dumbbells" autocomplete="off"></div><div id="fnBox"></div><button class="btn full" id="fnBack" style="margin-top:8px">Back</button>`);
  finder('#fnBox', '#fnQ'); $('#fnBack').onclick = newChooser;
}
const _openExEdit = openExEdit;
openExEdit = function(name){
  if (name != null || !aiOn() || manual) { manual = false; return _openExEdit(name); }       // AI off → straight to the manual form
  newChooser();
};

/* ---------- refresh every 30 s, only while something waits for the AI ---------- */
const anyWait = () => aiOn() && SEL && SEL[0] && (askWait(SEL[0]) || insWait(SEL[0]) || planWait(DRAFT) || finWait);
setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false && anyWait()) refresh(false); }, 30000);

if (SERVER) render();
})();
