/* Gym Tracker — app.js v7 (core). Loaded by Index.html, then dash.js, then coach.js (optional AI layer), then boot().
   One person at a time · each person has their own workout · typing stays on the phone ·
   ☁️ Save progress → sheet (Drafts) · 🏁 Finish → Log (closes it) · 🗑 Discard closes it too (queued when offline)
   v7: AI toggle hides every AI UI · next targets come only from the AI (coach.js) · History search + Recent PRs + Due-for-comeback removed
       · "Who is training?" on login · gender locks once chosen · Sync restyled · hidden-Menu cache filter · tag rows wrap */
const API_URL_DEFAULT = '';
const PROG = { topReps: 10, stuckAfter: 3, deload: 0.9, warmup: 0.35 };     // stuck tips + warm-up hint only (no progression rules)

/* ---------------- storage ---------------- */
const LS = {
  get(k, d){ try{ const v = localStorage.getItem('gt_'+k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('gt_'+k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem('gt_'+k); }catch(e){} }
};

const IS_GAS = typeof google !== 'undefined' && google.script && google.script.run;
let SERVER = LS.get('data', null);          // last data from server
let DATA = null;                             // SERVER + pending queue overlay
let QUEUE = LS.get('queue', []);             // [{cid, entries, tried?}] · [{cid, del:[ids]}] · [{cid, discard:[{person, did}]}]
let DRAFTS = LS.get('drafts', null);         // {workout id: workout in progress} — several per person
let DRAFT = null;                            // the workout shown for the selected person
let EDIT = LS.get('edit', null);             // a past workout being edited (History → tap a day)
let SEL = LS.get('sel', null);               // selected person: always exactly one code
let VIEW = LS.get('view', 'dash');
if (VIEW === 'edit' && !EDIT) VIEW = 'hist';
let RANGE = LS.get('range', 30);
let NAMES = {}, bootSel = true;              // person code → display name
const fixCode = x => x == null ? '' : Array.isArray(x) ? String(x[0]) : String(x).split(',')[0].trim();
SEL = SEL == null ? null : [...new Set((Array.isArray(SEL) ? SEL : [SEL]).map(fixCode).filter(Boolean))].slice(0, 1);
const newDid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
/** make one saved workout well-formed (older pages: list-shaped people, typed = ticked, no parts) */
function repairDraft(d){
  d.people = (d.people || []).map(fixCode).filter(Boolean);
  (d.items || []).forEach(it => { const s = {}; Object.keys(it.sets || {}).forEach(k => s[fixCode(k)] = it.sets[k]); it.sets = s;
    Object.values(s).forEach(a => a.forEach(x => { if (x.done === undefined) x.done = x.kg !== '' || x.reps !== ''; })); });
  if (!d.parts) { d.parts = {}; d.people.forEach(p => d.parts[p] = {did: newDid(), rev: 0}); d.unsaved = true; }
  return d;
}
/* a person can have several workouts. DRAFTS = {workout id: workout}; ACT = {person: id of the workout shown}. */
let ACT = LS.get('act', {}), NEWW = false;     // NEWW: showing the start screen although a workout is open ("+ New")
const didOf = d => d.parts[d.people[0]].did;
const NUM = '①②③④⑤⑥⑦⑧⑨⑩';
const numOf = i => NUM[i] || String(i + 1);
{
  const out = {}, put = d => { repairDraft(d); if (!d.t) d.t = Date.now(); out[didOf(d)] = d; };
  if (DRAFTS && typeof DRAFTS === 'object') Object.keys(DRAFTS).forEach(k => { const d = DRAFTS[k]; if (d && d.items && d.people && d.people.length === 1) put(d); });
  const old = LS.get('draft', null);
  if (old) {
    const d = repairDraft(old);
    d.people.forEach(p => {
      const c = JSON.parse(JSON.stringify(d));
      c.people = [p];
      c.items = c.items.filter(it => it.sets[p]).map(it => ({id: it.id, ex: it.ex, sets: {[p]: it.sets[p]}}));
      c.parts = c.parts[p] ? {[p]: c.parts[p]} : {[p]: {did: newDid(), rev: 0}};
      if (c.planIdxBy) c.planIdxBy = c.planIdxBy[p] != null ? {[p]: c.planIdxBy[p]} : undefined;
      put(c);
    });
  }
  DRAFTS = out; LS.del('draft'); LS.set('drafts', DRAFTS);
}
LS.del('dsync');
/** this person's workouts on this phone, oldest first */
const wips = p => Object.values(DRAFTS).filter(d => d.people[0] === p).sort((a, b) => a.t - b.t);
/** DRAFT = the workout shown for the selected person */
function syncDraft(){
  const p = SEL && SEL[0], l = p ? wips(p) : [];
  DRAFT = l.find(d => didOf(d) === ACT[p]) || l[0] || null;
  if (DRAFT) ACT[p] = didOf(DRAFT);
}
/** d = a new workout (it becomes the shown one) · null = remove the shown one */
function setDraft(d){
  const p = SEL[0];
  if (d) { if (!d.t) d.t = Date.now(); DRAFTS[didOf(d)] = d; ACT[p] = didOf(d); NEWW = false; }
  else if (DRAFT) delete DRAFTS[didOf(DRAFT)];
  LS.set('act', ACT); syncDraft(); storeDraft();
}
syncDraft();
let syncState = 'ok';

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const ymd = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today = () => ymd(new Date());
const parseYmd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtD = s => { if(!s) return 'No date'; const d = parseYmd(s); return DOW[d.getDay()]+', '+d.getDate()+' '+MON[d.getMonth()]; };
const fmtShort = s => { if(!s) return '—'; const d = parseYmd(s); return d.getDate()+' '+MON[d.getMonth()]; };
const daysAgo = s => Math.round((parseYmd(today()) - parseYmd(s)) / 864e5);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const titleCase = s => String(s).trim().replace(/\s+/g, ' ').replace(/(^|[\s-])\S/g, c => c.toUpperCase());
const nf = n => n >= 10000 ? (n/1000).toFixed(1)+'k' : Math.round(n).toLocaleString();
function toast(msg, ms, action){
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? `<button id="toastAct">${esc(action.label)}</button>` : '');
  if (action) $('#toastAct').onclick = () => { t.classList.remove('on'); action.fn(); };
  t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('on'), ms || (action ? 6000 : 2200));
}
const r5 = x => Math.round(x * 2) / 2;
const fkg = n => String(Math.round(Number(n) * 10) / 10);

/** blur + spinner while the user waits for an outcome (Save, Finish, Move here, Discard, first open without cache). 150 ms delay, ≥ 250 ms, 15 s watchdog. */
let busyN = 0, busyT = 0, busyW = 0, busyAt = 0, progN = 0;
function busy(on){
  busyN = Math.max(0, busyN + (on ? 1 : -1)); const el = $('#busy');
  if (busyN) { if (!busyT && !el.classList.contains('on')) {
    busyT = setTimeout(() => { el.classList.add('on'); busyAt = Date.now(); }, 150);
    busyW = setTimeout(() => { busyN = 0; busy(false); }, 15000); } return; }
  clearTimeout(busyT); clearTimeout(busyW); busyT = 0;
  setTimeout(() => { if (!busyN) el.classList.remove('on'); }, Math.max(0, 250 - (Date.now() - busyAt)));
}
/** thin line under the top bar for quiet refreshes */
function prog(on){ progN = Math.max(0, progN + (on ? 1 : -1)); $('#prog').classList.toggle('on', progN > 0); }

const ISO_RE = /plank|wall ?sit|dead ?hang|hold|isometric|l-?sit|hollow|static|superman/i;

/* ---------------- API ---------------- */
function apiUrl(){ return LS.get('url', API_URL_DEFAULT); }
function call(req){
  if (IS_GAS) {
    return new Promise((res, rej) => google.script.run
      .withSuccessHandler(s => res(JSON.parse(s)))
      .withFailureHandler(e => rej(e))
      .api(JSON.stringify(req)));
  }
  const url = apiUrl();
  if (!url) return Promise.reject(new Error('NO_URL'));
  return fetch(url, { method:'POST', body: JSON.stringify(Object.assign({key: LS.get('key','')}, req)), redirect:'follow' })
    .then(r => r.json())
    .then(j => { if (j.error === 'BAD_KEY') throw new Error('BAD_KEY'); return j; });
}

const pendingSets = () => QUEUE.reduce((n, q) => n + (q.entries ? q.entries.length : 0), 0);
const pendingDisc = () => QUEUE.filter(q => q.discard).length;
/** discards waiting to reach the sheet for this person */
const pendingDiscards = p => QUEUE.filter(q => q.discard).reduce((a, q) => a.concat(q.discard.filter(d => d.person === p)), []);
function setSync(s){
  syncState = s;
  const d = $('#dot'), n = pendingSets() + pendingDisc(), b = $('#syncN');
  d.className = 'dot' + (s==='busy' ? ' busy' : s==='err' ? ' err' : QUEUE.length ? ' pend' : '');
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  if (syncOpen) drawSync();
}
let syncOpen = false;
function agoText(ts){
  if (!ts) return 'never';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const d = new Date(ts); return (ymd(d) === today() ? '' : fmtShort(ymd(d)) + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function drawSync(){
  const n = pendingSets(), u = QUEUE.filter(q => q.del).length, dc = pendingDisc(), online = navigator.onLine !== false;
  const waiting = [n && `${n} set${n===1?'':'s'}`, u && `${u} undo${u===1?'':'s'}`, dc && `${dc} discard${dc===1?'':'s'}`].filter(Boolean).join(' + ');
  const [title, col] = syncState === 'busy' ? ['Syncing…', 'var(--warn)']
    : waiting ? [`${waiting} waiting to sync`, 'var(--warn)']
    : syncState === 'err' ? ['Last sync failed', 'var(--bad)'] : ['All synced', 'var(--ok)'];
  const th = LS.get('theme', 'dark');
  $('#shBody').innerHTML = `
    <div class="card" style="padding:12px"><div class="row" style="gap:12px">
      <span style="width:12px;height:12px;border-radius:50%;background:${col};flex:none"></span>
      <div style="flex:1"><b>${title}</b><div class="small muted">${online ? 'Online' : 'Offline — saved on this phone'} · last synced ${agoText(LS.get('lastSync', null))}</div></div>
      <button class="btn sm" id="syRefresh" ${syncState==='busy'?'disabled':''}>↻ Refresh</button></div>
      ${waiting ? '<p class="small dim" style="margin:8px 0 0">Nothing is lost: waiting items are stored on this phone and send automatically when you\'re back online.</p>' : ''}
      ${!IS_GAS ? '<button class="btn full sm" id="syConn" style="margin-top:10px">Connection settings</button>' : ''}</div>
    <div class="card" style="padding:12px"><div class="row"><b style="flex:1">Theme</b>
      <div class="sw" id="themeSeg"><button data-t="dark" class="${th==='dark'?'on':''}" aria-label="Dark">🌙</button><button data-t="light" class="${th==='light'?'on':''}" aria-label="Light">☀️</button></div></div></div>`;
  $('#syRefresh').onclick = async () => { await Promise.all([refresh(true), flushQueue()]); if (syncOpen) drawSync(); };
  const c = $('#syConn'); if (c) c.onclick = () => openSettings();
  $('#themeSeg').onclick = e => { const b = e.target.closest('[data-t]'); if (b) setTheme(b.dataset.t); };
}
function openSync(){ openSheet('Sync', ''); syncOpen = true; drawSync(); }

function applyServer(data){
  SERVER = data; LS.set('data', data); LS.set('lastSync', Date.now());
  rebuild();
}

/** loud = blur (only the first open without cached data); otherwise the quiet line under the top bar */
async function refresh(force, loud){
  setSync('busy'); if (loud) busy(true); else prog(true);
  try{
    const j = await call({action:'load', force: !!force});
    if (!j.ok) throw new Error(j.error);
    applyServer(j.data);
    setSync('ok');
    flushQueue();
    if (LS.get('askWho', false)) askWho();
  }catch(e){
    setSync('err');
    if (e.message === 'NO_URL' || e.message === 'BAD_KEY') openSettings(e.message);
    else if (!SERVER) toast('📴 Offline');
  }finally{ if (loud) busy(false); else prog(false); }
}
/** new session: who is training on this phone? (saves gt_me + the selected person) */
function askWho(){
  LS.del('askWho');
  if (!DATA) return;
  const set = p => { LS.set('me', p); SEL = [p]; LS.set('sel', SEL); NEWW = false; syncDraft(); };
  if (DATA.people.length < 2) return set(DATA.people[0]);
  openSheet('Who is training in this session?', DATA.people.map(p => `<button class="btn full" data-who="${esc(p)}" style="margin-bottom:8px">${pn(p)}</button>`).join(''));
  $('#shBody').onclick = e => { const b = e.target.closest('[data-who]'); if (!b) return; set(b.dataset.who); closeSheet(); render(); };
}

/* Offline queue: every save goes to the phone first (localStorage), then syncs in order.
   Sets carry a unique id (cid) so a retry can never create duplicates. loud = the user is waiting on it (Finish, Discard). */
let flushing = false, inflight = null, undoAfterFlush = false;
const saveQueue = () => LS.set('queue', QUEUE);
async function flushQueue(loud){
  if (flushing) return;
  if (!QUEUE.length) { setSync(syncState==='busy'?'ok':syncState); return; }
  flushing = true; setSync('busy'); if (loud) busy(true);
  try{
    while (QUEUE.length){
      const item = QUEUE[0]; inflight = item;
      item.tried = true; saveQueue();          // from now on the sheet *may* have these rows
      const req = item.del ? {action:'deleteLogs', items:item.del.map(id => ({id}))}
        : item.discard ? {action:'discardDraft', items:item.discard, dev:DEV, by:devName()}
        : {action:'addLogs', entries:item.entries, done:item.done, plan:item.plan, dev:DEV, by:devName()};
      const j = await call(req);
      if (!j.ok) {
        if (item.del) { QUEUE = QUEUE.filter(q => q !== item); saveQueue(); toast('⚠️ Undo failed: ' + j.error, 3500); continue; }
        throw new Error(j.error);
      }
      QUEUE = QUEUE.filter(q => q !== item); saveQueue();
      if (item.discard) { gotDrafts(j.drafts); discardSent(item); continue; }
      applyServer(j.data);
      if (j.closed && j.closed.length) { showClosed(j.closed, item.entries.filter(e => j.closed.some(c => String(e.cid).split(':')[0] === c.did))); continue; }
      const lb = LS.get('lastBatch', null);
      const hasLast = !item.del && lb && item.entries.some(e => lb.ids.indexOf(e.cid) >= 0);
      toast(item.del ? '↩️ Undone' : '✅ ' + j.msg, hasLast ? 6000 : 2200, hasLast ? {label:'Undo', fn:undoLast} : null);
    }
    setSync('ok');
  }catch(e){
    setSync('err');
    if (inflight && inflight.discard) { inflight.off = true; saveQueue(); toast('📴 Discard waits for a connection'); }
    else toast('📴 Saved offline');
    render();
  }finally{
    flushing = false; inflight = null; if (loud) busy(false);
    if (undoAfterFlush) { undoAfterFlush = false; undoLast(); }
  }
}
/** a queued discard reached the sheet: closed, or (if the workout was finished elsewhere first) refused */
function discardSent(item){
  const late = item.discard.map(d => ({d, x: SDD(d.did)})).filter(o => o.x && o.x.status === 'done');
  if (late.length) {
    const x = late[0].x;
    openSheet('🏁 Couldn\'t discard', `<p style="margin:0 0 6px">${pn(late[0].d.person)}'s workout was already <b>finished</b> on <b>${esc(x.by || 'other phone')}</b> at ${hhmm(x.at)}.</p>
      <p class="small muted" style="margin:0 0 12px">Its sets are in your Log. Nothing was discarded.</p>
      <div class="row"><button class="btn" id="ldHist" style="flex:1">Open in History</button><button class="btn pri" id="ldOk" style="flex:1">OK</button></div>`);
    $('#ldHist').onclick = () => { closeSheet(); go('hist'); }; $('#ldOk').onclick = closeSheet;
  } else if (item.off) toast('🗑 Discard sent · saved copy closed');
  render();
}
const inflightHas = cid => !!(inflight && inflight.entries && inflight.entries.some(e => e.cid === cid));

/** Remove sets from the phone queue. Returns the ids that may already be on the sheet. */
function dropFromQueue(ids){
  const maybe = [];
  QUEUE.forEach(q => { if (!q.entries) return; q.entries = q.entries.filter(e => { if (ids.indexOf(e.cid) < 0) return true; if (q.tried) maybe.push(e.cid); return false; }); });
  QUEUE = QUEUE.filter(q => q.del || q.discard || (q.entries && q.entries.length));
  return maybe;
}
function queueDelete(ids){ if (ids.length) QUEUE.push({cid: uid(), del: ids}); saveQueue(); }

function undoLast(){
  const lb = LS.get('lastBatch', null);
  if (!lb || !lb.ids.length) return toast('Nothing to undo');
  if (flushing) { undoAfterFlush = true; return toast('⏳ Undo after sync'); }
  const ids = lb.ids;
  const onSheet = ids.filter(id => D.logs.some(l => !l.pending && l.id === id));
  queueDelete(onSheet.concat(dropFromQueue(ids)));
  LS.del('lastBatch');
  rebuild();
  toast(`↩️ ${ids.length} set${ids.length===1?'':'s'} removed`);
  flushQueue();
}
function setLastBatch(ids){ LS.set('lastBatch', {ids, at: Date.now()}); }

async function write(req, okMsg){
  setSync('busy');
  try{
    const j = await call(req);
    if (!j.ok) throw new Error(j.error);
    applyServer(j.data); setSync('ok');
    toast('✅ ' + (okMsg || j.msg || 'Saved'));
    return true;
  }catch(e){
    setSync('err');
    const m = String(e.message||e);
    toast(m.startsWith('STALE') ? '🔄 Changed elsewhere — refreshed' : m.startsWith('NOT_FOUND') ? '🔄 Already gone — refreshed' : '⚠️ ' + m, 3200);
    if (m.startsWith('STALE') || m.startsWith('NOT_FOUND')) refresh(true);
    return false;
  }
}

/* ---------------- saved workouts (Drafts tab, one row per workout) ----------------
   The workout is kept on this phone as you type; ☁️ Save progress uploads it. The phone that saved it is its owner (🔒):
   another phone can't save or finish it, but can "Move here" (first tap wins). The phone also checks who owns it (lost) after every load / save. */
const DEV = LS.get('dev', '') || (() => { const d = uid(); LS.set('dev', d); return d; })();
const devName = () => { const me = LS.get('me', null); return me ? (NAMES[me] || me) + "'s phone" : 'other phone'; };
const fromTxt = x => x.dev === DEV ? 'this phone' : (x.by || 'other phone');
const hhmm = ts => { const d = new Date(ts); return (ymd(d) === today() ? '' : fmtShort(ymd(d)) + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const SDD = did => (SERVER && SERVER.drafts && SERVER.drafts[did]) || null;       // {person, rev, at, dev, by, status, did, draft}
const savedOf = did => { const x = SDD(did); return x && x.status === 'saved' && x.draft ? x : null; };
const savedFor = p => Object.values((SERVER && SERVER.drafts) || {}).filter(x => x.person === p && x.status === 'saved' && x.draft).sort((a, b) => a.at - b.at);
function ensureParts(){ const p = DRAFT.people[0]; DRAFT.parts = DRAFT.parts || {}; DRAFT.parts[p] = DRAFT.parts[p] || {did: uid(), rev: 0}; }
/** 📲 this workout (saved from here before) now belongs to another phone, or was finished / discarded there → {how, by, at}; else null. */
function lost(d){
  const pt = d && d.parts && d.parts[d.people[0]], x = pt && SDD(pt.did);
  if (!x || !(pt.rev > 0)) return null;
  if (x.status === 'done' || x.status === 'discarded') return {how: x.status, by: x.by, at: x.at};
  if (x.status === 'saved' && x.dev !== DEV) return {how: 'moved', by: x.by, at: x.at};
  return null;
}
const lostTxt = l => l.how === 'moved' ? '📲 Moved to ' + (l.by || 'other phone')
  : (l.how === 'done' ? '🏁 Finished on ' : '🗑 Discarded on ') + (l.by || 'other phone');
/** the workout as it is saved in the sheet */
function partOf(p){
  return { did: DRAFT.parts[p].did, date: DRAFT.date, split: DRAFT.split, name: DRAFT.name, planIdx: (DRAFT.planIdxBy || {})[p],
    items: DRAFT.items.filter(it => it.sets[p]).map(it => ({ex: it.ex, sets: it.sets[p]})) };
}
/** put a saved version into the open workout (replaces its sets) */
function loadPart(p, x){
  const d = x.draft;
  DRAFT.items = d.items.map(si => ({id: uid(), ex: si.ex, sets: {[p]: si.sets}}));
  DRAFT.date = d.date || DRAFT.date; DRAFT.split = d.split || DRAFT.split; DRAFT.name = d.name || DRAFT.name;
  if (d.planIdx != null) (DRAFT.planIdxBy = DRAFT.planIdxBy || {})[p] = d.planIdx;
  DRAFT.parts[p] = {did: x.did, rev: x.rev, at: x.at, from: x.dev !== DEV ? {by: x.by || 'other phone', at: x.at} : null};
}
function gotDrafts(d){ if (SERVER && d) { SERVER.drafts = d; LS.set('data', SERVER); } }
/** 'ok' | 'fail' | 'blocked' (blocked = moved / closed / conflict: it is shown, nothing was written).
    again = save even when nothing changed (the 🏁 tap): it doubles as the ownership check. */
async function saveProgress(force, again){
  force = force === true;
  if (!DRAFT) return 'fail';
  if (lost(DRAFT)) return 'blocked';
  if (!force && !again && !DRAFT.unsaved) return 'ok';
  const d0 = DRAFT, p = d0.people[0], did = didOf(d0);
  const part = {person: p, draft: partOf(p), base: d0.parts[p].rev || 0};
  const b = $('#finish'); if (b) { b.dataset.saving = '1'; b.disabled = true; b.textContent = '🔥 Saving…'; }
  busy(true);
  try{
    const j = await call({action:'saveDraft', parts:[part], force, dev: DEV, by: devName()});
    if (!j.ok) throw new Error(j.error);
    gotDrafts(j.drafts);
    const closed = j.closed || [], moved = j.moved || [], conf = j.conflict || [];
    if (!conf.length && !closed.length && !moved.length) {
      const x = j.drafts[did]; if (x) Object.assign(d0.parts[p], {rev: x.rev, at: x.at});
      d0.unsaved = false; d0.unsavedAt = 0; storeDraft();
    }
    render();
    if (closed.length || moved.length) { const L = lost(d0); toast((L ? lostTxt(L) : '📲 Moved') + ' · your changes stay here', 3200); return 'blocked'; }
    if (conf.length) { if (DRAFT === d0) { if (savedOf(did)) openCompare(did); else showDeleted(did); } return 'blocked'; }
    if (force) toast('☁️ Saved');
    return 'ok';
  }catch(e){ render(); toast('📴 Not saved — try again'); return 'fail'; }
  finally { busy(false); const b2 = $('#finish'); if (b2) delete b2.dataset.saving; saveUi(); }
}
/** 🗑 Discard: a sheet shows what will be lost. A ☁️ saved copy that this phone owns is closed too (queued when offline). */
function discardWorkout(){
  const p = DRAFT.people[0], did = didOf(DRAFT), x = savedOf(did), saved = !!(x && x.dev === DEV), L = lost(DRAFT);
  const its = DRAFT.items.filter(it => it.sets[p]);
  const done = its.reduce((s, it) => s + it.sets[p].filter(z => z.done).length, 0);
  const n = Math.max(1, ...its.map(it => it.sets[p].length));
  const rows = its.map(it => `<tr><td class="nm">${esc(it.ex)}</td>${Array.from({length: n}, (_, k) => { const s = it.sets[p][k];
    return `<td class="${k ? '' : 'gl'}${s && s.done ? '' : ' e'}">${s && isFilled(s) ? (Number(s.kg) ? `${fkg(s.kg)}<i>×${s.reps}${s.done ? ' ✓' : ''}</i>` : '×' + s.reps + (s.done ? ' ✓' : '')) : '·'}</td>`; }).join('')}</tr>`).join('');
  const offline = navigator.onLine === false;
  openSheet(`Discard ${NAMES[p] || p}'s workout?`, `
    <div class="small muted" style="margin:-4px 0 10px">${cap(DRAFT.split || DRAFT.name || 'workout')} · ${L ? lostTxt(L) : saved ? '☁️ saved ' + hhmm(x.at) : 'not saved to the sheet'}</div>
    ${rows ? `<table class="ht" style="margin-bottom:10px"><tr><th></th>${Array.from({length: n}, (_, k) => `<th class="${k ? '' : 'gl'}">${k+1}</th>`).join('')}</tr>${rows}</table>` : ''}
    ${done ? `<p class="small" style="color:var(--warn);margin:0 0 8px">⚠️ ${done} done set${done===1?'':'s'} ${done===1?"isn't":"aren't"} in your Log. ${done===1?"It'll":"They'll"} be gone.</p>` : '<p class="small muted" style="margin:0 0 8px">No done sets yet.</p>'}
    ${saved ? '<p class="small muted" style="margin:0 0 8px">☁️ The saved copy is closed: no phone can continue, save or finish it.</p>' : ''}
    ${saved && offline ? '<p class="small" style="color:var(--warn);margin:0 0 8px">📴 You\'re offline. The saved copy is closed as soon as you\'re back online.</p>' : ''}
    <button class="btn full danger" id="dcGo" style="margin-top:4px">🗑 Discard</button><button class="btn full" id="dcNo" style="margin-top:8px">Keep training</button>`);
  $('#dcNo').onclick = closeSheet;
  $('#dcGo').onclick = () => { closeSheet(); doDiscard(p, saved); };
}
function doDiscard(p, saved){
  const did = didOf(DRAFT);
  setDraft(null);
  if (saved) { QUEUE.push({cid: uid(), discard: [{person: p, did}]}); saveQueue(); setSync(syncState); }
  render();
  toast(saved && navigator.onLine === false ? '🗑 Discarded · 📴 closes when online' : '🗑 Discarded');
  if (saved) flushQueue(true);
}
/** 🏁 finished / 🗑 discarded / 📲 moved on another phone: nothing from this phone was saved (refused = its sets, after Finish) */
function showClosed(list, refused, then){
  const dids = list.map(c => c.did), all = h => list.every(c => c.how === h);
  openSheet(all('moved') ? '📲 Workout moved' : all('discarded') ? '🗑 Workout discarded' : '🏁 Workout already done', list.map(c => {
    const mine = (refused || []).filter(e => String(e.cid).split(':')[0] === c.did), by = {};
    mine.forEach(e => (by[e.exercise] = by[e.exercise] || []).push(e));
    const what = c.how === 'moved' ? 'moved to' : c.how === 'discarded' ? 'discarded on' : 'finished on';
    return `<p style="margin:0 0 6px">${pn(c.person)}'s workout was ${what} <b>${esc(c.by || 'other phone')}</b> at ${hhmm(c.at)}.</p>`
      + (mine.length ? `<div class="small muted" style="margin-bottom:4px">These sets from this phone weren't saved:</div><table class="ht" style="margin-bottom:10px">${Object.keys(by).map(ex =>
          `<tr><td class="nm">${esc(ex)}</td>${by[ex].map((e, i) => `<td class="${i ? '' : 'gl'}">${Number(e.kg) ? `${fkg(e.kg)}<i>×${e.reps}</i>` : '×' + e.reps}</td>`).join('')}</tr>`).join('')}</table>`
        : `<p class="small muted" style="margin:0 0 10px">${c.how === 'moved' ? "Changes typed here that weren't saved are gone from this phone." : 'Nothing from this phone was saved.'}</p>`);
  }).join('') + `${refused ? '<p class="small muted" style="margin:0 0 12px">Missed a set? Add it in History → ✎ Edit.</p>' : ''}
    ${all('moved') ? '<p class="small dim" style="margin:0 0 12px">To take it back: Workout → Move here.</p>' : ''}
    <div class="row">${all('moved') ? '' : '<button class="btn" id="clHist" style="flex:1">Open in History</button>'}<button class="btn pri" id="clOk" style="flex:1">OK</button></div>`);
  const done = hist => { dropWorkouts(dids); closeSheet(); if (hist) go('hist'); else { render(); if (then) then(); } };
  const h = $('#clHist'); if (h) h.onclick = () => done(true);
  $('#clOk').onclick = () => done(false);
}
/** 🗑 the saved copy was deleted on another phone: Save again / OK (keep it here, unsaved) */
function showDeleted(did){
  const x = SDD(did) || {}, p = x.person || (DRAFT && DRAFT.people[0]);
  openSheet('🗑 Saved workout deleted', `<p style="margin:0 0 6px">${pn(p)}'s saved workout was deleted on <b>${esc(fromTxt(x))}</b> at ${hhmm(x.at)}.</p>
    <p class="small muted" style="margin:0 0 12px">Your copy is still on this phone.</p>
    <div class="row"><button class="btn" id="dlOk" style="flex:1">OK</button><button class="btn pri" id="dlAgain" style="flex:1">☁️ Save again</button></div>`);
  $('#dlOk').onclick = () => { if (DRAFT && SDD(did)) DRAFT.parts[DRAFT.people[0]].rev = SDD(did).rev; storeDraft(); closeSheet(); render(); };
  $('#dlAgain').onclick = () => { closeSheet(); saveProgress(true); };
}
/** remove these workouts from this phone (closed or moved elsewhere) */
function dropWorkouts(dids){
  dids.forEach(d => delete DRAFTS[d]);
  syncDraft(); storeDraft();
}
/* Compare: Saved | Mine, one row per set, differences highlighted → Use saved / Keep mine */
const setTxt = (ex, s) => !s || !isFilled(s) ? '—' : (D.isIso(ex) && !Number(s.kg) ? s.reps + 's' : Number(s.kg) ? fkg(s.kg) + '×' + (s.reps === '' ? '?' : s.reps) : '×' + s.reps) + (s.done ? ' ✓' : '');
function cmpTable(did){
  const p = DRAFT.people[0], saved = SDD(did).draft.items, mine = DRAFT.items.filter(it => it.sets[p]).map(it => ({ex: it.ex, sets: it.sets[p]}));
  const names = []; mine.concat(saved).forEach(i => { if (!names.some(n => n.toLowerCase() === i.ex.toLowerCase())) names.push(i.ex); });
  const find = (arr, n) => (arr.find(i => i.ex.toLowerCase() === n.toLowerCase()) || {sets: []}).sets;
  const rows = names.map(n => { const a = find(saved, n), b = find(mine, n), k = Math.max(1, a.length, b.length);
    return Array.from({length: k}, (_, i) => { const x = setTxt(n, a[i]), y = setTxt(n, b[i]), df = x !== y ? ' df' : '';
      return `<tr class="${i ? '' : 'top'}">${i ? '' : `<td class="nm" rowspan="${k}">${esc(n)}</td>`}<td class="sn">${i+1}</td><td class="gl${df}">${x}</td><td class="gl${df}">${y}</td></tr>`; }).join(''); }).join('');
  return `<table class="ht cmp"><tr><th></th><th></th><th class="gl">Saved</th><th class="gl">Mine</th></tr>${rows}</table>`;
}
function openCompare(did){
  const x = savedOf(did); if (!x || !DRAFT || didOf(DRAFT) !== did) return;
  const p = DRAFT.people[0];
  openSheet('Changed on other phone', `<div class="small muted" style="margin:-4px 0 8px"><b style="color:var(--text)">${pn(p)}</b> · Saved ${hhmm(x.at)} ${esc(fromTxt(x))} · Mine unsaved</div>${cmpTable(did)}
    <p class="small dim">Highlighted = different.</p>
    <div class="row" style="margin-top:6px"><button class="btn pri" id="cmpSaved" style="flex:1">Use saved</button><button class="btn" id="cmpMine" style="flex:1">Keep mine</button></div>
    <p class="small dim" style="margin:8px 0 0">Keep mine saves your version over it.</p>`);
  $('#cmpSaved').onclick = () => {
    loadPart(p, SDD(did)); closeSheet();
    DRAFT.unsaved = false; DRAFT.unsavedAt = 0;
    storeDraft(); render(); toast('📥 Loaded');
  };
  $('#cmpMine').onclick = () => { closeSheet(); saveProgress(true); };
}
/** Put a saved workout on this phone as an open workout. from = the phone it came from (blue "Continued" look). */
function openSaved(x, from){
  const p = x.person, d = x.draft;
  const w = { date: d.date || today(), planIdx: null, split: d.split || '', name: d.name || 'Workout', people: [p],
    items: d.items.map(si => ({id: uid(), ex: si.ex, sets: {[p]: si.sets}})), parts: {[p]: {did: x.did, rev: x.rev, at: x.at, from: from || null}} };
  if (d.planIdx != null) w.planIdxBy = {[p]: d.planIdx};
  SEL = [p]; LS.set('sel', SEL);
  setDraft(w); DRAFT.unsaved = false; storeDraft();
  render();
}
function continueSaved(did){
  const x = savedOf(did); if (!x) return;
  openSaved(x, null); toast('📲 Continued');
}
function setsTable(d){
  const n = Math.max(1, ...d.items.map(i => i.sets.length));
  const rows = d.items.map(i => `<tr><td class="nm">${esc(i.ex)}</td>${Array.from({length: n}, (_, k) => { const s = i.sets[k];
    return `<td class="${k ? '' : 'gl'}${s && s.done ? '' : ' e'}">${s && isFilled(s) ? (Number(s.kg) ? `${fkg(s.kg)}<i>×${s.reps}${s.done ? ' ✓' : ''}</i>` : '×' + s.reps + (s.done ? ' ✓' : '')) : '·'}</td>`; }).join('')}</tr>`).join('');
  return `<table class="ht" style="margin-bottom:10px"><tr><th></th>${Array.from({length: n}, (_, k) => `<th class="${k ? '' : 'gl'}">${k+1}</th>`).join('')}</tr>${rows}</table>`;
}
function openMove(did){
  const x = savedOf(did); if (!x) return;
  const mine = DRAFTS[did], typed = !!(mine && mine.unsaved);
  openSheet('Move to this phone?', `<div class="small muted" style="margin:-4px 0 10px">${pn(x.person)} · ${cap(x.draft.split || x.draft.name || 'workout')} · 🔒 on ${esc(x.by || 'other phone')} · saved ${hhmm(x.at)}</div>
    ${setsTable(x.draft)}
    ${typed ? '<p class="small" style="color:var(--warn);margin:0 0 10px">⚠️ Sets typed on this phone and not saved will be replaced by this saved version.</p>' : ''}
    <p class="small muted" style="margin:0 0 10px">You get it exactly as it was last saved. Sets typed on ${esc(x.by || 'the other phone')} but not saved don't come along, and that phone can't save or finish it any more.</p>
    <button class="btn pri full" id="mvGoHere">📲 Move here</button><button class="btn full" id="mvNo" style="margin-top:8px">Cancel</button>`);
  $('#mvNo').onclick = closeSheet;
  $('#mvGoHere').onclick = async () => {
    closeSheet(); busy(true);
    try{
      const j = await call({action:'moveDraft', did, from: x.dev, dev: DEV, by: devName()});
      if (!j.ok) throw new Error(j.error);
      gotDrafts(j.drafts);
      if (j.gone) { toast('🗑 That workout is no longer saved'); return render(); }
      if (j.taken) { toast('🔒 Someone moved it first — now on ' + ((SDD(did) || {}).by || 'another phone')); return render(); }
      openSaved(SDD(did), {by: x.by || 'other phone', at: x.at}); toast('📲 Moved here');
    }catch(e){ toast('📴 Needs a connection to move'); }
    finally { busy(false); }
  };
}
function openDeleteSaved(did){
  const x = savedOf(did); if (!x) return;
  const d = x.draft, done = d.items.reduce((s, i) => s + i.sets.filter(z => z.done).length, 0);
  openSheet('Delete saved workout?', `<div class="small muted" style="margin:-4px 0 10px">${pn(x.person)} · ${cap(d.split || d.name || 'workout')} · saved ${hhmm(x.at)} ${esc(fromTxt(x))}</div>
    ${setsTable(d)}
    ${done ? `<p class="small" style="color:var(--warn);margin:0 0 10px">⚠️ ${done} done set${done===1?'':'s'} ${done===1?"isn't":"aren't"} in your Log yet. ${done===1?"It'll":"They'll"} be gone on every phone.</p>` : ''}
    <button class="btn full danger" id="dsDel">🗑 Delete</button><button class="btn full" id="dsNo" style="margin-top:8px">Cancel</button>`);
  $('#dsNo').onclick = closeSheet;
  $('#dsDel').onclick = async () => {
    closeSheet();
    try{ const j = await call({action:'deleteDraft', did, dev: DEV, by: devName()}); if (!j.ok) throw new Error(j.error); gotDrafts(j.drafts); toast('🗑 Deleted'); }
    catch(e){ toast('📴 Not deleted — try again'); }
    render();
  };
}
const isOld = x => daysAgo(ymd(new Date(x.at))) >= 2;              // saved more than 2 days ago
/** saved workouts of the selected person that are not open on this phone */
const closedHere = p => savedFor(p).filter(x => !DRAFTS[x.did]);
function savedNotes(){
  const p = SEL[0];
  return closedHere(p).map(x => { const d = x.draft;
    if (pendingDiscards(p).some(q => q.did === x.did))
      return `<div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;opacity:.6;border-style:dashed"><span style="font-size:18px">🗑</span>
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px;text-decoration:line-through">${cap(d.split || d.name || 'workout')}</div><div class="small muted">discarding… waiting for connection</div></div></div>`;
    const old = isOld(x), mine = x.dev === DEV, n = d.items.reduce((s, i) => s + i.sets.length, 0), k = d.items.reduce((s, i) => s + i.sets.filter(z => z.done).length, 0);
    return `<div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;${old ? 'opacity:.55' : ''}"><span style="font-size:18px">${mine ? '⚡' : '🔒'}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">${mine ? 'Saved workout' : 'On ' + esc(x.by || 'another phone')}${old ? ' · from ' + DOW[new Date(x.at).getDay()] : ''}</div>
      <div class="small muted">${cap(d.split || d.name || 'workout')} · ${k} of ${n} sets done · ${old ? 'not finished' : 'saved ' + hhmm(x.at)}</div></div>
      ${old ? '' : mine ? `<button class="btn sm" data-cont="${esc(x.did)}">Continue</button>` : `<button class="btn sm" data-move="${esc(x.did)}">Move here</button>`}<button class="icon-btn" data-dels="${esc(x.did)}" title="Delete" style="color:var(--bad)">🗑</button></div>`; }).join('');
}
/* Continued = this phone took over a saved workout from another phone (blue band, card and ring) */
const contPeople = () => DRAFT && DRAFT.parts ? DRAFT.people.filter(p => DRAFT.parts[p] && DRAFT.parts[p].from) : [];
function contBand(){
  const ps = contPeople(); if (!ps.length) return '';
  const one = p => { const P = DRAFT.parts[p], here = P.at > P.from.at;
    return 'Moved from ' + `<b>${esc(P.from.by)}</b>` + ` · saved ${hhmm(here ? P.at : P.from.at)}${here ? ' here' : ''}`; };
  return `<div class="cband">📲 ${ps.map(one).join(' · ')}</div>`;
}
/** ⚡: this person has a recent saved workout that isn't open here (and isn't waiting to be discarded) */
const savedBadgeFor = p => closedHere(p).some(x => !isOld(x) && !pendingDiscards(p).some(q => q.did === x.did));
const savedBadge = () => SEL.some(savedBadgeFor);

/* ---------------- derived data ---------------- */
let D = {}; // computed indexes
function rebuild(){
  const base = SERVER || {logs:[], menu:[], plans:[], people:['B','Z']};
  const hidden = {}; QUEUE.forEach(q => (q.del||[]).forEach(id => hidden[id] = 1));   // queued undos
  const logs = base.logs
    .map(r => ({row:r[0], date:r[1], person:r[2], ex:r[3], kg:r[4], reps:r[5], id:r[6]||'', phone:r[7]||'', did:String(r[6]||'').indexOf(':') > 0 ? String(r[6]).split(':')[0] : '', fp:r.slice(1,6).join('|')}))
    .filter(l => !(l.id && hidden[l.id]));
  QUEUE.forEach(q => (q.entries||[]).forEach(e => logs.push({row:null, pending:true, cid:e.cid, id:e.cid, date:e.date, person:e.person, ex:e.exercise, kg:e.kg, reps:e.reps, phone:devName(), did:String(e.cid).indexOf(':') > 0 ? String(e.cid).split(':')[0] : ''})));
  const pinfo = (base.people && base.people.length ? base.people : ['B']).map(x => Array.isArray(x) ? x : [x, x, false]);
  /* Menu rows with Status "hidden" are the AI finder's cache: kept out of the app's menu (Coach.gs sends their names in ai.hid) */
  const hid = {}; ((base.ai && base.ai.hid) || []).forEach(h => hid[h[0].toLowerCase()] = h);
  DATA = { logs, menu: base.menu.filter(m => !hid[m[0].toLowerCase()]), hid, plans: base.plans && base.plans.length ? base.plans : defaultPlans(), pinfo,
    people: pinfo.filter(x => !x[2]).map(x => x[0]) };
  if (!DATA.people.length) DATA.people = [pinfo[0][0]];
  DATA.plog = {}; pinfo.forEach(x => DATA.plog[x[0]] = x[3] && typeof x[3] === 'object' ? x[3] : {});
  NAMES = {}; pinfo.forEach(x => NAMES[x[0]] = x[1] || x[0]);
  const me = LS.get('me', null);
  if (bootSel && me && DATA.people.indexOf(me) >= 0) SEL = [me];      // this phone opens on its owner
  bootSel = false;
  if (!SEL || !SEL.length || SEL.some(p => DATA.people.indexOf(p) < 0)) SEL = DATA.people.slice(0, 1);
  SEL = SEL.slice(0, 1); syncDraft();

  const splitOf = {}, typeOf = {};
  base.menu.forEach(m => { splitOf[m[0].toLowerCase()] = m[1]; typeOf[m[0].toLowerCase()] = m[2] || ''; });
  logs.forEach(l => l.split = splitOf[l.ex.toLowerCase()] || 'upper');

  const stats = {}, exCount = {}, exLast = {};
  logs.forEach(l => {
    const k = l.ex.toLowerCase();
    exCount[k] = (exCount[k]||0) + 1;
    if (l.date && (!exLast[k] || l.date > exLast[k])) exLast[k] = l.date;
    const sk = k + '|' + l.person;
    const s = stats[sk] || (stats[sk] = {best:null, bestReps:null, last:null, lastKg:null, lastReps:null, bestHold:0});
    const kg = Number(l.kg)||0, reps = Number(l.reps)||0;
    if (s.best === null || kg > s.best || (kg === s.best && reps > s.bestReps)) { s.best = kg; s.bestReps = reps; }
    if (reps > s.bestHold) s.bestHold = reps;
    if (l.date) {
      if (!s.last || l.date > s.last) { s.last = l.date; s.lastKg = kg; s.lastReps = reps; }
      else if (l.date === s.last && (kg > s.lastKg || (kg === s.lastKg && reps > s.lastReps))) { s.lastKg = kg; s.lastReps = reps; }
    }
  });
  const isIso = name => { const k = String(name).toLowerCase(), t = typeOf[k]; return t ? t === 'static' : ISO_RE.test(k); };
  D = { logs, splitOf, typeOf, stats, exCount, exLast, isIso };
  D.stuck = stuckMap();
  render();
}

/* ---------------- next target: only the AI gives one (coach.js replaces this; null = no "next" shown) ---------------- */
let targetFor = () => null;
function tgtText(t){
  if (!t) return '';
  if (t.iso) return `next ${t.sec}s`;
  if (t.bw) return `next ${t.reps} reps`;
  return `next ${fkg(t.kg)}×${t.reps}${t.up ? ' ▲' : ''}`;
}
function statLine(name, p){
  const s = D.stats[String(name).toLowerCase() + '|' + p];
  if (!s) return `<b>${pn(p)}</b> new`;
  const best = bestText(name, s);
  const t = tgtText(targetFor(name, p));
  return `<b>${pn(p)}</b> best ${best}${t ? ` · <span class="tgt">${t}</span>` : ''}`;
}
const bestText = (name, s) => D.isIso(name) ? `${s.bestHold}s` : s.best > 0 ? `${fkg(s.best)}×${s.bestReps}` : `${s.bestReps} reps`;
const statLines = (name, sep) => SEL.map(p => statLine(name, p)).join(sep || '<br>');
function defaultPlans(){ return ['Upper','Lower','Lower','Upper'].map((name, i) => ({day:i+1, name})); }
const pn = code => esc(NAMES[code] || code);
const PCOL = ['var(--accent)', '#60a5fa', '#ec4899', '#14b8a6'];
const pcol = code => PCOL[Math.max(0, DATA.pinfo.findIndex(x => x[0] === code)) % PCOL.length];
const selLogs = () => D.logs.filter(l => SEL.indexOf(l.person) >= 0);
const splitOfEx = n => D.splitOf[String(n).toLowerCase()] || 'upper';

/* ---------------- stalled exercises (data; the Dashboard card is in dash.js) ---------------- */
function stuckMap(){
  const m = {}, out = {};
  D.logs.forEach(l => { if (!l.date) return;
    const k = l.ex.toLowerCase() + '|' + l.person, s = m[k] || (m[k] = {}), kg = Number(l.kg)||0, r = Number(l.reps)||0, c = s[l.date];
    if (!c || kg > c.kg || (kg === c.kg && r > c.reps)) s[l.date] = {kg, reps:r}; });
  Object.keys(m).forEach(k => {
    const dates = Object.keys(m[k]).sort(); if (dates.length <= PROG.stuckAfter || daysAgo(dates[dates.length-1]) >= 30) return;
    let best = null, at = 0;
    dates.forEach((d, i) => { const v = m[k][d]; if (!best || v.kg > best.kg || (v.kg === best.kg && v.reps > best.reps)) { best = v; at = i; } });
    const n = dates.length - 1 - at;
    if (n >= PROG.stuckAfter) out[k] = { n, since: dates[at], best };
  });
  return out;
}
function stuckTip(ex, b){
  if (D.isIso(ex)) return `Try ${Math.max(10, b.reps - 10)}s × 2`;
  if (!b.kg) return 'Try slow 3-s lowering';
  return `Try ${fkg(r5(b.kg * PROG.deload))} kg × ${PROG.topReps}`;
}
const stuckBest = (ex, b) => D.isIso(ex) ? b.reps + 's' : b.kg ? `${fkg(b.kg)} kg × ${b.reps}` : b.reps + ' reps';

/* ---------------- rotation (which split is next) ---------------- */
const planType = p => /lower|leg/i.test(p.name) ? 'lower' : 'upper';
function workoutDays(logs){
  const m = {};
  logs.forEach(l => { if (!l.date) return; const d = m[l.date] || (m[l.date] = {date:l.date, upper:0, mid:0, lower:0, sets:0, vol:0, ex:{}}); d[l.split]++; d.sets++; d.ex[l.ex.toLowerCase()] = l.split; d.vol += (Number(l.kg)||0)*(Number(l.reps)||0); });
  return Object.values(m).sort((a,b) => a.date < b.date ? 1 : -1);
}
function nextPlanIndex(person){
  person = person || SEL[0];
  const plans = DATA.plans; const P = plans.length; if (!P) return 0;
  const days = workoutDays(D.logs.filter(l => l.person === person));
  const li = v => Array.isArray(v) ? v[v.length - 1] : v;      // last rotation day logged for that date
  const hist = LS.get('planlog', {}), mine = Object.assign({}, hist[person] || {}, DATA.plog[person] || {}), last = days.length ? days[0].date : null;
  if (last && typeof li(mine[last]) === 'number') return (li(mine[last]) + 1) % P;
  if (last && typeof li(hist[last]) === 'number') return (li(hist[last]) + 1) % P;
  const seq = days.slice(0, 4).reverse().map(d => d.lower > d.upper ? 'lower' : 'upper');
  if (!seq.length) return 0;
  const types = plans.map(planType);
  let best = 0, bestScore = -1;
  for (let o = 0; o < P; o++){
    let s = 0; seq.forEach((t, i) => { if (types[(o+i)%P] === t) s += 1 + i*0.5; });
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return (best + seq.length) % P;
}
/* ---------------- header / nav ---------------- */
function renderHeader(){
  $('#ppl').innerHTML = DATA.people.map(p => { const on = SEL.indexOf(p) >= 0, open = !on && wips(p).length, sv = !on && !open && savedBadgeFor(p);
    return `<button class="chip pchip ${on?'on':''}" data-p="${esc(p)}"><span class="pnm">${pn(p)}</span>${open ? '<span class="wip" title="workout open on this phone"></span>' : sv ? '<span class="bd">⚡</span>' : ''}</button>`; }).join('')
    + `<button class="chip" id="pplMgr" title="People"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/></svg></button>`;
  $('#title').textContent = {dash:'Dashboard', work:'Workout', hist:'History', edit:'Edit workout'}[VIEW];
  $('#titleSub').textContent = VIEW === 'work' ? (NAMES[SEL[0]] || SEL[0] || '') : '';
  $('#midLbl').textContent = !DRAFT || NEWW ? 'Start workout' : contPeople().length ? 'Continued' : 'In progress';
  $('.tab-mid .fab').classList.toggle('cont', !!(DRAFT && contPeople().length));
  const fab = $('.tab-mid .fab'), bd = fab.querySelector('.bdg'), show = savedBadge();
  if (show && !bd) fab.insertAdjacentHTML('beforeend', '<span class="bdg">⚡</span>'); else if (!show && bd) bd.remove();
  document.querySelectorAll('.tab,.tab-mid').forEach(b => b.classList.toggle('on', b.dataset.v === VIEW || (VIEW === 'edit' && b.dataset.v === 'hist')));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-'+VIEW));
}
/* One person at a time: tapping a name switches to that person (and their own workout) */
$('#ppl').addEventListener('click', e => {
  if (e.target.closest('#pplMgr')) return openPeople();
  const b = e.target.closest('[data-p]'); if (!b) return;
  const p = b.dataset.p; if (SEL[0] === p) return tapRefresh();
  tapRefresh();
  NEWW = false; SEL = [p]; LS.set('sel', SEL); syncDraft();
  if (VIEW === 'edit') { EDIT = null; LS.del('edit'); VIEW = 'hist'; LS.set('view', VIEW); }
  render();
});
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  go(b.dataset.v);
});
/** refresh on tap: cached data first, fresh data swaps in later (quiet line). Skipped when the last refresh was < 3 s ago, offline, or while typing in a workout field. */
let lastTap = 0;
function tapRefresh(){
  const ae = document.activeElement;
  if (Date.now() - lastTap < 3000 || navigator.onLine === false || (ae && ae.tagName === 'INPUT' && ae.dataset.f)) return;
  lastTap = Date.now(); refresh(false);
}
function go(v){ if (v === 'dash' || v === 'hist' || v === 'work') tapRefresh(); if (v !== 'work') NEWW = false; VIEW = v; LS.set('view', v); render(); window.scrollTo(0, 0); }
$('#syncBtn').addEventListener('click', () => { if (!IS_GAS && !apiUrl()) return openSettings(); openSync(); });
window.addEventListener('offline', () => setSync(syncState));
$('#syncBtn').addEventListener('contextmenu', e => { e.preventDefault(); openSettings(); });

function render(){
  if (!DATA) return;
  const ae = document.activeElement;
  if (((VIEW === 'work' && DRAFT) || VIEW === 'edit') && ae && ae.tagName === 'INPUT' && ae.closest('#v-work,#v-edit') && ae.dataset.f) { renderHeader(); saveUi(); return; }
  const keepId = ae && ae.id && ae.tagName === 'INPUT' ? ae.id : null, pos = keepId ? ae.selectionStart : 0;
  renderHeader();
  if (VIEW === 'dash') renderDash();
  else if (VIEW === 'work') renderWork();
  else if (VIEW === 'edit') renderEdit();
  else renderHist();
  if (keepId) { const n = document.getElementById(keepId); if (n && n.closest('main')) { n.focus(); try{ n.setSelectionRange(pos, pos); }catch(e){} } }
}
function setTheme(t){
  LS.set('theme', t);
  document.documentElement.classList.toggle('light', t === 'light');
  const m = document.getElementById('themeColor'); if (m) m.content = t === 'light' ? '#f3f4f6' : '#0f1115';
  if (syncOpen) drawSync();
  render();
}

let hapticEl = null;
function haptic(){
  try {
    if (navigator.vibrate) return navigator.vibrate(12);
    if (!hapticEl) { hapticEl = document.createElement('label'); hapticEl.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none'; hapticEl.innerHTML = '<input type="checkbox" switch>'; document.body.appendChild(hapticEl); }
    hapticEl.click();
  } catch (e) {}
}

/* ---------------- WORKOUT ---------------- */
/** storeDraft = keep all workouts on this phone · saveDraft = a change: keep on this phone, mark ● unsaved (☁️ Save progress uploads) */
function storeDraft(){ LS.set('drafts', DRAFTS); }
function saveDraft(){
  storeDraft(); if (!DRAFT) return;
  if (!DRAFT.unsaved || !DRAFT.unsavedAt) DRAFT.unsavedAt = Date.now();
  DRAFT.unsaved = true; storeDraft(); saveUi();
}
const saveTag = () => { if (!DRAFT) return '';
  if (DRAFT.unsaved) { const m = Math.floor((Date.now() - (DRAFT.unsavedAt || Date.now())) / 60000); return `<span style="color:var(--warn)">● unsaved${m >= 10 ? ' · ' + m + ' min' : ''}</span>`; }
  const at = Math.max(0, ...Object.values(DRAFT.parts || {}).map(x => x.at || 0));
  return at ? `<span style="color:var(--accent)">☁️ saved ${hhmm(at)}</span>` : ''; };
/** one button: unsaved changes → amber 🔥 Save Progress · saved with nothing changed → green 🏁 Finish Workout · moved / closed → disabled, says so */
const savedAtOf = d => Math.max(0, ...Object.values(d.parts || {}).map(x => x.at || 0));
const isSaved = d => !!d && !d.unsaved && savedAtOf(d) > 0;
const saveBtn = () => isSaved(DRAFT) ? ['pri', '🏁 Finish Workout'] : ['s-need', '🔥 Save Progress'];
function saveUi(){
  const s = $('#wState'), b = $('#finish'); if (!DRAFT) return;
  const L = lost(DRAFT);
  if (s) s.innerHTML = saveTag();
  const m = $('#wLost'); if (m) { m.hidden = !L; if (L) { m.querySelector('b').textContent = lostTxt(L); $('#wBack').hidden = L.how !== 'moved'; } }
  if (b && !b.dataset.saving) { const [k, t] = L ? ['', lostTxt(L)] : saveBtn(); b.className = 'btn full ' + k; b.textContent = t; b.disabled = !!L; }
}
setInterval(saveUi, 30000);
const saveW = w => w === EDIT ? LS.set('edit', EDIT) : saveDraft();
const redraw = w => w === EDIT ? renderEdit() : renderWork();
/** a new exercise starts with its last session as a hint plus blank sets; with an AI target (coach.js) the hint is followed by two "next" sets */
function planSets(ex, p){
  const s = D.stats[String(ex).toLowerCase() + '|' + p], t = targetFor(ex, p);
  if (!s || !s.last) return [{kg:'', reps:'', done:false}];
  const last = {kg:'', reps:'', done:false, pk: D.isIso(ex) || !(s.lastKg > 0) ? '' : s.lastKg, pr: s.lastReps, tag:'last'};
  if (!t) return [last, {kg:'', reps:'', done:false}, {kg:'', reps:'', done:false}];
  const next = t.iso ? {pk:'', pr:t.sec} : {pk: t.bw ? '' : t.kg, pr: t.reps};
  return [last, next, next].map((x, i) => i ? {kg:'', reps:'', done:false, pk:x.pk, pr:x.pr, tag:'next'} : x);
}
function blankSets(ex, people){ const o = {}; people.forEach(p => o[p] = planSets(ex, p)); return o; }
const newItem = (ex, people) => ({ id: uid(), ex, sets: blankSets(ex, people || SEL) });
const isFilled = st => st.kg !== '' || st.reps !== '';
const countDone = w => { let n = 0; w.items.forEach(it => w.people.forEach(p => (it.sets[p] || []).forEach(s => { if (s.done) n++; }))); return n; };
const anyDone = (it, w) => (w || DRAFT || {people: []}).people.some(p => (it.sets[p] || []).some(s => s.done));
/** planIdx: rotation day (or null); names: exercises to pre-add (only "Repeat this workout" uses it) */
function startDraft(planIdx, names, name, split){
  const p = SEL[0];
  setDraft({ date: today(), planIdx, split: split || '', name: name || 'Workout', people: [p], items: (names || []).map(n => newItem(n)), parts: {[p]: {did: newDid(), rev: 0}} });
  saveDraft();
}
/** the rotation day this person is on, or the next one of that split type (null if the rotation has none) */
function planIdxFor(p, type){
  const P = DATA.plans.length, ni = nextPlanIndex(p);
  for (let k = 0; k < P; k++) { const i = (ni + k) % P; if (planType(DATA.plans[i]) === type) return i; }
  return null;
}
/** Start an empty Upper / Lower workout for the selected person (their own next day of that split). */
function startSplit(type){
  const p = SEL[0], i = planIdxFor(p, type);
  startDraft(i, [], cap(type), type);
  DRAFT.planIdxBy = {[p]: i}; saveDraft();
}
/** tabs: one per open workout of the selected person + "+ New" */
function wTabs(){
  const l = wips(SEL[0]); if (!l.length) return '';
  return `<div class="wtabs" id="wTabs">${l.map((d, i) => { const n = countDone(d);
    return `<button class="chip ${!NEWW && d === DRAFT ? 'on' : ''}" data-w="${didOf(d)}">${numOf(i)} ${cap(d.split || d.name || 'workout')}${n ? ' · ' + n : ''}${d.unsaved ? ' ●' : ''}${lost(d) ? ' 📲' : ''}</button>`; }).join('')}<button class="chip ${NEWW ? 'on' : ''}" data-w="new">+ New</button></div>`;
}
$('#v-work').addEventListener('click', e => {
  const b = e.target.closest('[data-w]'); if (!b) return;
  if (b.dataset.w === 'new') NEWW = true; else { NEWW = false; ACT[SEL[0]] = b.dataset.w; LS.set('act', ACT); syncDraft(); }
  render(); window.scrollTo(0, 0);
});
const recSplit = p => DATA.plans.length ? planType(DATA.plans[nextPlanIndex(p)]) : 'upper';
function renderWork(){
  const el = $('#v-work');
  if (!DRAFT || NEWW){
    const rec = recSplit(), type = LS.get('pickType', rec);
    el.innerHTML = wTabs() + `
      <div class="card">
        <h3><span class="sp">Today's split</span><button class="chip" id="editEx">Exercises</button><button class="chip" id="editPlans">Rotation</button></h3>
        <div class="big" style="margin-bottom:10px">${cap(type)}${type === rec ? ' <span style="color:var(--accent)">★</span>' : ''}</div>
        <div class="plan-chips" id="planChips">${['upper','lower'].map(t => `<button class="chip ${t===type?'on':''}" data-t="${t}">${cap(t)}${t===rec?' ★':''}</button>`).join('')}</div>
        <p class="small muted" style="margin:10px 0 0">Remember: add 1 mid/core move and 1 static hold.</p>
        <button class="btn pri full" id="goPlan" style="margin-top:12px">Start ${cap(type)}</button>
      </div>
      <div id="savedNotes">${savedNotes()}</div>
      <p class="small dim" style="text-align:center;margin-top:14px">★ = what your rotation says to do today.</p>`;
    $('#savedNotes').onclick = e => { const c = e.target.closest('[data-cont]'), m = e.target.closest('[data-move]'), d = e.target.closest('[data-dels]');
      if (c) continueSaved(c.dataset.cont); else if (m) openMove(m.dataset.move); else if (d) openDeleteSaved(d.dataset.dels); };
    $('#planChips').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; LS.set('pickType', b.dataset.t); renderWork(); };
    $('#goPlan').onclick = () => { LS.del('pickType'); startSplit(type); render(); };
    $('#editPlans').onclick = () => openPlans();
    $('#editEx').onclick = () => openMenuMgr();
    return;
  }
  const filled = countDone(DRAFT);
  el.innerHTML = wTabs() + `
    <div class="card ${contPeople().length ? 'contc' : ''}" style="padding:12px">${contBand()}
      <div class="row">
        <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:17px">${contPeople().length ? 'Continued workout' : DRAFT.date === today() ? "Today's workout" : 'Workout · ' + fmtShort(DRAFT.date)}</div>
          <div class="small muted">${DRAFT.people.map(pn).join(' + ')} · ${DRAFT.items.length} exercise${DRAFT.items.length===1?'':'s'} · <span class="nDone">${filled}</span> set${filled===1?'':'s'} done</div></div>
        <input type="date" id="wDate" class="wdate" value="${DRAFT.date}">
      </div>
      <div class="row" style="margin-top:8px"><span class="small" id="wState" style="flex:1">${saveTag()}</span></div>
      <div class="lostbar" id="wLost" hidden><b></b><button class="btn sm" id="wBack">Move Back</button></div>
    </div>
    <div>${DRAFT.items.map(it => exCard(it, DRAFT)).join('')}</div>
    <button class="btn full" id="addEx" style="margin-bottom:10px">+ Add exercise</button>
    <button class="btn full danger" id="discard" style="margin-bottom:70px">Discard workout</button>
    <div class="stickybar"><div class="in"><button class="btn full ${saveBtn()[0]}" id="finish">${saveBtn()[1]}</button></div></div>`;
  $('#wDate').onchange = e => { DRAFT.date = e.target.value || today(); saveDraft(); renderWork(); };
  $('#addEx').onclick = () => openPicker({ title:'Add exercise', multi:true, split: DRAFT.split || 'all', star: DRAFT.split, onPick: names => { names.forEach(n => DRAFT.items.push(newItem(n, DRAFT.people))); saveDraft(); renderWork(); } });
  $('#discard').onclick = discardWorkout;
  $('#finish').onclick = mainBtn;
  $('#wBack').onclick = () => openMove(didOf(DRAFT));
  saveUi();
}
function exCard(it, w){
  const iso = D.isIso(it.ex), k = it.ex.toLowerCase(), past = w === EDIT;
  return `<div class="ex ${anyDone(it, w)?'done':''}" data-id="${it.id}">
    <div class="ex-h">
      ${w.items.length > 1 ? '<span class="grip" title="Drag to reorder"><svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.6"/><circle cx="9" cy="3" r="1.6"/><circle cx="3" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="3" cy="15" r="1.6"/><circle cx="9" cy="15" r="1.6"/></svg></span>' : ''}
      <div class="grow"><div class="t">${esc(it.ex)}</div>
        <div class="tags">${past ? '' : `<span class="tag nm">${esc(NAMES[w.people[0]] || w.people[0])}</span>`}<span class="tag s-${splitOfEx(it.ex)}">${splitOfEx(it.ex)}</span>${iso?'<span class="tag iso">static</span>':''}</div></div>
      <button class="icon-btn" data-act="prog" title="Progress"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></button>
      <button class="icon-btn" data-act="swap" title="Swap">⇄</button>
      <button class="icon-btn" data-act="rm" title="Remove">✕</button>
    </div>
    ${w.people.map(p => {
      const s = D.stats[k+'|'+p]; const sets = it.sets[p] || (it.sets[p] = planSets(it.ex, p));
      const t = targetFor(it.ex, p);
      const hint = s ? `best ${bestText(it.ex, s)}${t && !past ? ` · <button class="tgt" data-act="fill" data-p="${esc(p)}">${tgtText(t)}</button>` : ''}` : 'first time';
      const wu = !past && !iso && s && s.lastKg > 0 ? r5(s.lastKg * PROG.warmup) : 0;
      return `<div class="pp">${w.people.length > 1 ? `<div class="pp-h"><b style="color:var(--text)">${pn(p)}</b><span>${hint}</span></div>` : `<div class="pp-h"><span>${hint}</span></div>`}
        ${(st => st && !past ? `<div class="small" style="color:var(--bad);margin:-2px 0 4px">⚠ Stuck ${st.n} sessions — ${stuckTip(it.ex, st.best)}</div>` : '')(D.stuck[k + '|' + p])}
        ${wu ? `<div class="small" style="color:var(--warn);margin:-2px 0 6px">Warm-up ~${fkg(wu)} kg <span class="dim">(35% of ${fkg(s.lastKg)} kg)</span></div>` : ''}
        ${sets.map((st, i) => {
          const at = `data-p="${esc(p)}" data-i="${i}"`, has = st.pr != null;
          const num = `<button class="n ${st.done?'ok':''}" data-act="done" ${at}>${i+1}</button>`;
          const kgPh = has ? (st.pk !== '' ? fkg(st.pk) + ' kg' : 'kg') : (t && !t.bw && !past ? fkg(t.kg) + ' kg' : 'kg');
          const rPh = has ? st.pr + (iso ? ' sec' : ' reps') : (t && !past ? (iso ? t.sec + ' sec' : t.reps + ' reps') : (iso ? 'seconds' : 'reps'));
          return (iso
            ? `<div class="set iso">${num}<input inputmode="numeric" placeholder="${rPh}" value="${esc(st.reps)}" ${at} data-f="reps">`
            : `<div class="set">${num}<input inputmode="decimal" placeholder="${kgPh}" value="${esc(st.kg)}" ${at} data-f="kg"><input inputmode="numeric" placeholder="${rPh}" value="${esc(st.reps)}" ${at} data-f="reps">`)
            + `<button class="x" data-act="rmset" ${at}>×</button></div>` + (st.tag ? `<div class="tg">${st.tag === 'last' ? 'last time' : 'next target'}</div>` : '');
        }).join('')}
        <button class="addset" data-act="addset" data-p="${esc(p)}">+ set</button></div>`;
    }).join('')}
  </div>`;
}
document.addEventListener('input', e => {
  const t = e.target; if (!t.dataset.f) return;
  const w = t.closest('#v-edit') ? EDIT : DRAFT; if (!w) return;
  const card = t.closest('.ex'); if (!card) return;
  const it = w.items.find(x => x.id === card.dataset.id); if (!it) return;
  it.sets[t.dataset.p][Number(t.dataset.i)][t.dataset.f] = t.value.replace(',', '.').trim();
  saveW(w);
});
function workClick(e){
  const w = e.currentTarget.id === 'v-edit' ? EDIT : DRAFT;
  const b = e.target.closest('[data-act]'); if (!b || !w) return;
  const card = b.closest('.ex'); if (!card) return;
  const it = w.items.find(x => x.id === card.dataset.id);
  const a = b.dataset.act;
  if (a === 'rm') { w.items = w.items.filter(x => x !== it); }
  else if (a === 'addset') { const arr = it.sets[b.dataset.p]; const prev = arr[arr.length-1] || {}; arr.push({kg:'', reps:'', done:false, pk: prev.kg !== '' && prev.kg != null ? prev.kg : prev.pk, pr: prev.reps !== '' && prev.reps != null ? prev.reps : prev.pr}); }
  else if (a === 'done') {
    const st = it.sets[b.dataset.p][Number(b.dataset.i)];
    if (st.done) st.done = false;
    else {
      if (st.kg === '' && st.pk !== '' && st.pk != null) st.kg = String(st.pk);
      if (st.reps === '' && st.pr != null && st.pr !== '') st.reps = String(st.pr);
      if (!isFilled(st)) return toast('Type the weight and reps first');
      st.done = true; haptic();
    }
  }
  else if (a === 'rmset') { const arr = it.sets[b.dataset.p]; arr.splice(Number(b.dataset.i), 1); if (!arr.length) arr.push({kg:'', reps:'', done:false}); }
  else if (a === 'fill') {
    const t = targetFor(it.ex, b.dataset.p); if (!t) return;
    const arr = it.sets[b.dataset.p] || (it.sets[b.dataset.p] = []);
    let st = arr.find(x => !x.done && x.kg === '' && x.reps === ''); if (!st) { st = {kg:'', reps:'', done:false}; arr.push(st); }
    if (t.iso) st.reps = String(t.sec); else { st.kg = t.bw ? '' : String(t.kg); st.reps = String(t.reps); }
  }
  else if (a === 'prog') return openProgress(it.ex);
  else if (a === 'swap') { return openPicker({ title:'Swap ' + it.ex, split: splitOfEx(it.ex), star: w.split, onPick: n => { it.ex = n[0]; if (!anyDone(it, w) && w === DRAFT) it.sets = blankSets(n[0], w.people); saveW(w); redraw(w); } }); }
  saveW(w); redraw(w);
}
$('#v-work').addEventListener('click', workClick);
$('#v-edit').addEventListener('click', workClick);
let DRG = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest && e.target.closest('.grip'); if (!g) return;
  const sec = g.closest('#v-work,#v-edit'), w = sec && (sec.id === 'v-edit' ? EDIT : DRAFT); if (!w) return;
  e.preventDefault();
  if (document.activeElement) document.activeElement.blur();
  const card = g.closest('.ex'), cards = [...sec.querySelectorAll('.ex')], from = cards.indexOf(card);
  DRG = { w, card, cards, from, to: from, y0: e.clientY, sy: scrollY, rects: cards.map(c => c.getBoundingClientRect()) };
  card.classList.add('drag'); cards.forEach(c => c !== card && c.classList.add('shift'));
  try { g.setPointerCapture(e.pointerId); } catch (x) {}
  haptic();
});
document.addEventListener('pointermove', e => {
  if (!DRG) return;
  if (e.clientY < 140) scrollBy(0, -10); else if (e.clientY > innerHeight - 190) scrollBy(0, 10);
  const dy = e.clientY - DRG.y0 + (scrollY - DRG.sy), R = DRG.rects, f = DRG.from;
  DRG.card.style.transform = `translateY(${dy}px)`;
  const mid = R[f].top + R[f].height / 2 + dy; let to = f;
  R.forEach((q, i) => { const m = q.top + q.height / 2; if (i < f && mid < m) to = Math.min(to, i); if (i > f && mid > m) to = Math.max(to, i); });
  if (to !== DRG.to) haptic();
  DRG.to = to;
  const h = R[f].height + 10;
  DRG.cards.forEach((c, i) => { if (c === DRG.card) return;
    const s = f < to && i > f && i <= to ? -h : f > to && i >= to && i < f ? h : 0;
    c.style.transform = s ? `translateY(${s}px)` : ''; });
});
const dragEnd = () => {
  if (!DRG) return;
  const { w, from, to } = DRG; DRG = null;
  if (from !== to) { const [it] = w.items.splice(from, 1); w.items.splice(to, 0, it); saveW(w); }
  redraw(w);
};
document.addEventListener('pointerup', dragEnd);
document.addEventListener('pointercancel', dragEnd);
/** the one button. 🔥 Save Progress only saves; 🏁 Finish Workout (saved, nothing changed) re-saves first (ownership check), then opens "Finish Workout?". */
async function mainBtn(){
  if (!DRAFT || lost(DRAFT)) return;
  const d0 = DRAFT, wasSaved = isSaved(d0);
  const r = await saveProgress(false, wasSaved);
  if (r !== 'ok' || DRAFT !== d0) return;
  if (!wasSaved) return toast('☁️ Saved');
  if (!countDone(d0)) return toast('Tick at least one set first');
  finishWorkout();
}
function finishWorkout(){
  const entries = [];
  ensureParts();
  DRAFT.items.forEach(it => DRAFT.people.forEach(p => (it.sets[p] || []).forEach(s => {
    if (!s.done) return;
    entries.push({ cid: DRAFT.parts[p].did + ':' + uid(), date: DRAFT.date, person: p, exercise: it.ex, split: splitOfEx(it.ex), kg: s.kg === '' ? 0 : Number(s.kg), reps: s.reps === '' ? '' : Number(s.reps) });
  })));
  if (!entries.length) return toast('Tick at least one set first');
  const p0 = DRAFT.people[0], was = (DRAFT.planIdxBy || {})[p0] != null ? DRAFT.planIdxBy[p0] : DRAFT.planIdx;
  const fresh = was != null && (DRAFT.split === 'upper' || DRAFT.split === 'lower') ? planIdxFor(p0, DRAFT.split) : was;   // rotation moves once per finished workout
  const by = fresh != null ? {[p0]: fresh} : null;
  const at = savedAtOf(DRAFT), age = Date.now() - at;
  showSummary(workoutSummary(entries, DRAFT.name, DRAFT.people), () => saveWorkout(entries, by), `Progress Saved 🔥 ${age < 60000 ? 'just now' : hhmm(at)}`);
}
function saveWorkout(entries, by){
  if (by) { const h = LS.get('planlog', {});
    Object.keys(by).forEach(p => { if (by[p] == null) return; if (!h[p] || typeof h[p] !== 'object') h[p] = {}; const v = h[p][DRAFT.date], a = Array.isArray(v) ? v : v == null ? [] : [v]; a.push(by[p]); h[p][DRAFT.date] = a.length === 1 ? a[0] : a; });
    LS.set('planlog', h); }
  const ps = DRAFT.people.filter(p => entries.some(e => e.person === p));
  QUEUE.push({ cid: uid(), entries, done: ps.map(p => ({person: p, did: DRAFT.parts[p].did})),
    plan: by ? {date: DRAFT.date, by} : null }); saveQueue();
  setLastBatch(entries.map(e => e.cid));
  setDraft(null);
  closeSheet(); rebuild(); go('hist');
  haptic(); toast('Workout saved 💪');
  flushQueue(true);
}
/* ---------------- finish summary ---------------- */
function workoutSummary(entries, name, people){
  const g = {}, better = (a, b) => a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps);
  entries.forEach(e => { const k = e.exercise.toLowerCase() + '|' + e.person, kg = Number(e.kg)||0, r = Number(e.reps)||0, c = g[k];
    if (!c) g[k] = {ex:e.exercise, p:e.person, kg, reps:r}; else if (kg > c.kg || (kg === c.kg && r > c.reps)) { c.kg = kg; c.reps = r; } });
  const rows = Object.values(g).map(x => {
    const s = D.stats[x.ex.toLowerCase() + '|' + x.p], cur = {kg:x.kg, reps:x.reps};
    const last = s && {kg:s.lastKg||0, reps:s.lastReps||0}, best = s && {kg:s.best||0, reps:s.bestReps||0};
    x.tag = !s ? 'new' : better(cur, best) ? 'pr' : better(cur, last) ? 'up' : better(last, cur) ? 'down' : 'same';
    x.prev = last; return x;
  });
  const order = {pr:0, up:1, new:2, same:3, down:4};
  rows.sort((a, b) => order[a.tag] - order[b.tag]);
  return { name, people, rows, sets: entries.length, vol: entries.reduce((s, e) => s + (Number(e.kg)||0) * (Number(e.reps)||0), 0) };
}
function showSummary(S, onDone, sub){
  const val = x => D.isIso(x.ex) ? x.reps + 's' : x.kg > 0 ? fkg(x.kg) + '×' + x.reps : x.reps + ' reps';
  const dl = (d, unit) => d > 0 ? `<span class="up">▲ +${fkg(d)}${unit}</span>` : d < 0 ? `<span class="down">▼ -${fkg(-d)}${unit}</span>` : '';
  const delta = x => { const p = x.prev;
    if (D.isIso(x.ex)) return dl(x.reps - p.reps, 's');
    return [dl(x.kg - p.kg, ' kg'), dl(x.reps - p.reps, ' reps')].filter(Boolean).join(' &nbsp;'); };
  const badge = x => x.tag === 'new' ? '<span class="small dim">first time</span>'
    : `<span class="small" style="text-align:right">${x.tag === 'pr' ? '<span class="tag" style="color:var(--pr);border-color:#5a4216;margin-right:6px">🏆 PR</span>' : ''}${delta(x) || '<span class="same" title="same as last time">=</span>'}</span>`;
  const prs = S.rows.filter(x => x.tag === 'pr').length, ups = S.rows.filter(x => x.tag === 'up').length;
  openSheet('Finish Workout?', `
    <div class="small muted" style="margin:-4px 0 10px">${sub || S.people.map(pn).join(' + ')}</div>
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="v">${S.sets}</div><div class="l">sets</div></div>
      <div class="tile"><div class="v">${nf(S.vol)}</div><div class="l">kg volume</div></div>
      <div class="tile"><div class="v" style="color:var(--pr)">${prs}</div><div class="l">new PRs${ups ? ` · ${ups} up` : ''}</div></div>
    </div>
    <div class="list">${S.rows.map(x => `<div class="li"><div class="grow"><div class="t">${esc(x.ex)}</div><div class="small muted">${S.people.length > 1 ? pn(x.p) + ' · ' : ''}${val(x)}</div></div>${badge(x)}</div>`).join('')}</div>
    <div class="card" style="padding:9px 11px;margin:12px 0 0;border-color:#5a4216;background:rgba(251,191,36,.08)"><span class="small" style="color:var(--warn)">⚠️ Finish saves to your Log and <b>closes this workout</b>.</span></div>
    <button class="btn pri full" id="smOk" style="margin-top:10px">🏁 Finish Workout</button><button class="btn full" id="smNo" style="margin-top:8px">Keep Training</button>`);
  $('#smOk').onclick = onDone; $('#smNo').onclick = closeSheet;
}

/* ---------------- exercise picker (search; #pkAi = AI finder slot, filled by coach.js) ---------------- */
function openPicker(opt){
  let q = '', split = opt.split || 'all', newStatic = false; const chosen = [];
  const draw = () => {
    const ql = q.toLowerCase().trim();
    let rows = DATA.menu.filter(m => (split === 'all' || m[1] === split) && (!ql || m[0].toLowerCase().includes(ql)));
    rows.sort((a,b) => a[0].localeCompare(b[0], undefined, {sensitivity:'base'}));
    const exact = DATA.menu.some(m => m[0].toLowerCase() === ql);
    $('#pkList').innerHTML = rows.map(m => { const on = chosen.indexOf(m[0]) >= 0; const pl = D.exCount[m[0].toLowerCase()] ? statLines(m[0], ' · ') : ''; return `<div class="pick ${on?'sel':''}" data-n="${esc(m[0])}">${opt.multi?`<span class="chk">${on?'✓':''}</span>`:''}<span class="t">${hl(m[0], ql)}${pl ? `<div class="small muted" style="text-transform:none">${pl}</div>` : ''}</span>${D.isIso(m[0])?'<span class="tag iso">static</span>':''}<span class="tag s-${m[1]}">${m[1]}</span></div>`; }).join('')
      + (ql && !exact ? `<div style="padding:12px 0"><div class="small muted" style="margin-bottom:6px">Not in your menu — add “${esc(titleCase(q))}” as:</div>
          <label class="row small" style="margin-bottom:8px;gap:8px"><input type="checkbox" id="pkStatic" ${newStatic?'checked':''} style="width:auto"> Static hold (log seconds)</label>
          <div class="row">${['upper','mid','lower'].map(s => `<button class="btn sm" data-new="${s}">${cap(s)}</button>`).join('')}</div></div>` : '')
      + (!rows.length && !ql ? '<div class="empty">No exercises</div>' : '');
    $('#pkDone').style.display = opt.multi ? '' : 'none';
    $('#pkDone').textContent = chosen.length ? `Add ${chosen.length}` : 'Done';
  };
  openSheet(opt.title, `
    <div class="search" style="margin-bottom:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pkQ" placeholder="Search exercise…" autocomplete="off"></div>
    <div class="seg" id="pkSeg" style="margin-bottom:6px">${['all','upper','mid','lower'].map(s=>`<button data-s="${s}" class="${s===split?'on':''}">${cap(s)}${s===opt.star?' ★':''}</button>`).join('')}</div>
    <div id="pkList"></div><div id="pkAi"></div>
    <button class="btn pri full" id="pkDone" style="position:sticky;bottom:0;margin-top:10px">Done</button>`, openMenuMgr);
  $('#pkQ').oninput = e => { q = e.target.value; draw(); };
  $('#pkSeg').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; split = b.dataset.s; $('#pkSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#pkList').onclick = async e => {
    if (e.target.id === 'pkStatic') { newStatic = e.target.checked; return; }
    const nb = e.target.closest('[data-new]');
    if (nb) {
      const name = titleCase(q); const s = nb.dataset.new; const type = newStatic ? 'static' : '';
      (SERVER ? SERVER.menu : DATA.menu).push([name, s, type]); D.splitOf[name.toLowerCase()] = s; D.typeOf[name.toLowerCase()] = type;
      write({action:'addExercise', name, split:s, type}, 'Added to menu');
      if (opt.multi) { chosen.push(name); q = ''; $('#pkQ').value = ''; draw(); } else { closeSheet(); opt.onPick([name]); }
      return;
    }
    const r = e.target.closest('[data-n]'); if (!r) return;
    const n = r.dataset.n;
    if (!opt.multi) { closeSheet(); return opt.onPick([n]); }
    const i = chosen.indexOf(n); if (i >= 0) chosen.splice(i, 1); else chosen.push(n); draw();
  };
  $('#pkDone').onclick = () => { closeSheet(); if (chosen.length) opt.onPick(chosen); };
  draw();
}
function hl(s, q){ if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); if (i < 0) return esc(s); return esc(s.slice(0,i)) + '<mark>' + esc(s.slice(i, i+q.length)) + '</mark>' + esc(s.slice(i+q.length)); }

/* ---------------- rotation editor ---------------- */
function openPlans(){
  const days = DATA.plans.map(planType);
  openSheet('Rotation', `<p class="small muted" style="margin-top:0">Days run in this order, then repeat. ★ shows which one is due.</p><div id="plBody"></div><button class="btn pri full" id="plSave">Save rotation</button>`);
  const body = $('#plBody');
  const draw = () => {
    body.innerHTML = days.map((t, i) => `<div class="row" style="margin-bottom:8px" data-i="${i}"><span class="dim small" style="width:16px">${i+1}</span>
      <div class="seg" style="flex:1">${['upper','lower'].map(x => `<button data-a="set" data-t="${x}" class="${x===t?'on':''}">${cap(x)}</button>`).join('')}</div>
      <button class="icon-btn" data-a="up" title="Move up">↑</button><button class="icon-btn" data-a="del" title="Remove">✕</button></div>`).join('')
      + `<button class="btn full" data-a="add" style="margin:4px 0 10px">+ Add day</button>`;
  };
  body.onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'add') { days.push('upper'); return draw(); }
    const i = Number(b.closest('[data-i]').dataset.i);
    if (a === 'set') days[i] = b.dataset.t;
    else if (a === 'del') { if (days.length > 1) days.splice(i, 1); }
    else if (a === 'up') { if (i > 0) [days[i-1], days[i]] = [days[i], days[i-1]]; }
    draw();
  };
  $('#plSave').onclick = () => {
    const clean = days.map((t, i) => ({day:i+1, name:cap(t)}));
    DATA.plans = clean; if (SERVER) { SERVER.plans = clean; LS.set('data', SERVER); }
    LS.del('planlog'); LS.del('pickType'); closeSheet(); rebuild();
    write({action:'savePlans', plans:clean}, 'Rotation saved');
  };
  draw();
}

/* ---------------- exercise menu (#mmAi = AI finder slot, filled by coach.js) ---------------- */
const TYPES = [['', 'Auto'], ['reps', 'Weight × reps'], ['static', 'Hold (sec)']];
function openMenuMgr(){
  let q = '', split = 'all';
  openSheet('Exercises', `
    <button class="btn pri full" id="mmNew" style="margin-bottom:10px">+ New exercise</button>
    <div class="search" style="margin-bottom:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="mmQ" placeholder="Search exercise…" autocomplete="off"></div>
    <div class="seg" id="mmSeg" style="margin-bottom:6px">${['all','upper','mid','lower'].map(s=>`<button data-s="${s}" class="${s===split?'on':''}">${cap(s)}</button>`).join('')}</div>
    <div id="mmList"></div><div id="mmAi"></div>`);
  const draw = () => {
    const ql = q.toLowerCase().trim();
    const rows = DATA.menu.filter(m => (split === 'all' || m[1] === split) && (!ql || m[0].toLowerCase().includes(ql)))
      .sort((a,b) => a[0].localeCompare(b[0], undefined, {sensitivity:'base'}));
    $('#mmList').innerHTML = rows.map(m => { const k = m[0].toLowerCase(), n = D.exCount[k] || 0;
      return `<div class="pick" data-n="${esc(m[0])}"><span class="t">${hl(m[0], ql)}<div class="small muted" style="text-transform:none">${n ? `${n} set${n===1?'':'s'} · last ${fmtShort(D.exLast[k])}` : 'never logged'}</div></span>${D.isIso(m[0])?'<span class="tag iso">static</span>':''}<span class="tag s-${m[1]}">${m[1]}</span><span class="dim">›</span></div>`; }).join('')
      || '<div class="empty">No exercises</div>';
  };
  $('#mmQ').oninput = e => { q = e.target.value; draw(); };
  $('#mmSeg').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; split = b.dataset.s; $('#mmSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#mmList').onclick = e => { const r = e.target.closest('[data-n]'); if (r) openExEdit(r.dataset.n); };
  $('#mmNew').onclick = () => openExEdit(null);
  draw();
}
function openExEdit(name){
  const m = name != null ? DATA.menu.find(x => x[0] === name) : null;
  let split = m ? m[1] : 'upper', type = m ? (m[2] || '') : '';
  const n = m ? (D.exCount[m[0].toLowerCase()] || 0) : 0;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v===cur?'on':''}">${l}</button>`).join('')}</div>`;
  openSheet(m ? 'Edit exercise' : 'New exercise', `
    <div class="fld"><label>Name</label><input id="xeN" value="${esc(m ? m[0] : '')}" autocomplete="off"></div>
    <div class="fld"><label>Split</label>${seg('xeS', [['upper','Upper'],['mid','Mid'],['lower','Lower']], split)}</div>
    <div class="fld"><label>Type</label>${seg('xeT', TYPES, type)}</div>
    <p class="small dim" style="margin-top:0">Auto = static if the name looks like a hold (plank, wall sit, dead hang…).${n ? ` ${n} logged set${n===1?'':'s'} — renaming renames them too.` : ''}</p>
    <button class="btn pri full" id="xeSave">${m ? 'Save' : 'Add'}</button>
    ${m ? '<button class="btn full danger" id="xeDel" style="margin-top:8px">Delete from menu</button>' : ''}
    <button class="btn full" id="xeBack" style="margin-top:8px">Back</button>`);
  const pick = (id, set) => $('#' + id).onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; set(b.dataset.v); $('#' + id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  pick('xeS', v => split = v); pick('xeT', v => type = v);
  $('#xeBack').onclick = openMenuMgr;
  $('#xeSave').onclick = () => {
    const nm = titleCase($('#xeN').value); if (!nm) return toast('Type a name');
    const other = DATA.menu.find(x => x !== m && x[0].toLowerCase() === nm.toLowerCase());
    if (!m) {
      if (other) return toast('Already in the menu');
      DATA.menu.push([nm, split, type]);
      menuChanged({action:'addExercise', name:nm, split, type}, 'Added ' + nm);
    } else {
      if (other && !confirm(`"${nm}" already exists. Merge "${m[0]}" into it? Its ${n} set${n===1?'':'s'} move over.`)) return;
      const old = m[0];
      if (nm !== old) renameLocal(old, nm);
      if (other) DATA.menu.splice(DATA.menu.indexOf(m), 1); else { m[0] = nm; m[1] = split; m[2] = type; }
      menuChanged({action:'editExercise', old, name:nm, split, type}, other ? 'Merged into ' + nm : 'Saved');
    }
  };
  const del = $('#xeDel');
  if (del) del.onclick = () => {
    if (!confirm(n ? `Remove "${m[0]}" from the menu?\nIts ${n} logged set${n===1?'':'s'} stay in History.` : `Delete "${m[0]}"?`)) return;
    DATA.menu.splice(DATA.menu.indexOf(m), 1);
    menuChanged({action:'deleteExercise', name:m[0]}, 'Deleted ' + m[0]);
  };
}
function menuChanged(req, msg){
  if (SERVER) LS.set('data', SERVER);
  rebuild(); openMenuMgr();
  write(req, msg);
}
/** Rename an exercise in everything kept on the phone: cached logs, unsynced sets, every workout in progress. */
function renameLocal(old, nm){
  const o = old.toLowerCase();
  if (SERVER) SERVER.logs.forEach(r => { if (String(r[3]).toLowerCase() === o) r[3] = nm; });
  QUEUE.forEach(q => (q.entries||[]).forEach(e => { if (String(e.exercise).toLowerCase() === o) e.exercise = nm; }));
  saveQueue();
  Object.values(DRAFTS).forEach(d => d.items.forEach(it => { if (it.ex.toLowerCase() === o) it.ex = nm; }));
  if (DRAFT) saveDraft(); else storeDraft();
}

/* ---------------- people ---------------- */
/** gender symbol: ♂ blue · ♀ pink (text form, so the colour applies); '' when not set */
const gSym = g => g === 'm' ? '♂︎' : g === 'f' ? '♀︎' : '';
function openPeople(){
  const me = LS.get('me', null);
  openSheet('People', `
    <button class="btn pri full" id="pAdd" style="margin-bottom:8px">+ Add person</button>
    ${DATA.pinfo.map(x => { const n = D.logs.filter(l => l.person === x[0]).length;
      return `<div class="pick" data-code="${esc(x[0])}"><span style="width:10px;height:10px;border-radius:50%;flex:none;background:${pcol(x[0])}"></span>
        <span class="t" style="${x[2]?'opacity:.5':''}">${pn(x[0])}<div class="small muted" style="text-transform:none">code ${esc(x[0])} · ${n} set${n===1?'':'s'}${x[2] ? ' · hidden' : ''}</div></span>
        ${x[4] ? `<span class="gs ${x[4]}">${gSym(x[4])}</span>` : ''}${x[0] === me ? '<span class="tag" style="color:var(--accent);border-color:#4a5a17">this phone</span>' : ''}<span class="dim">›</span></div>`; }).join('')}
    <p class="small dim">The code is what's saved in the Log, so renaming never breaks your history.</p>`);
  $('#pAdd').onclick = () => openPerson(null);
  $('#shBody').onclick = e => { const r = e.target.closest('[data-code]'); if (r) openPerson(r.dataset.code); };
}
function openPerson(code){
  const x = code ? DATA.pinfo.find(y => y[0] === code) : null;
  let gender = x && x[4] ? x[4] : '';
  const locked = !!gender;                                                     // once chosen, gender is the default and stays
  openSheet(x ? 'Edit person' : 'Add person', `
    <div class="fld"><label>Name</label><input id="pnN" value="${esc(x ? x[1] : '')}" placeholder="e.g. Bayu" autocomplete="off"></div>
    <div class="small muted" style="margin-bottom:4px">Gender${locked ? ' · locked' : ''}</div>
    <div class="gx" id="pnG"><button class="m ${gender==='m'?'on':''}" data-g="m" aria-label="Male" ${locked?'disabled':''}>${gSym('m')}</button><button class="f ${gender==='f'?'on':''}" data-g="f" aria-label="Female" ${locked?'disabled':''}>${gSym('f')}</button></div>
    ${x ? `<label class="row small" style="gap:8px;margin:12px 0"><input type="checkbox" id="pnHide" style="width:auto" ${x[2] ? 'checked' : ''}> Hide (their history is kept)</label>` : ''}
    ${x ? `<p class="small dim">Code: ${esc(x[0])} — stays the same when you rename.</p>` : ''}
    <button class="btn pri full" id="pnSave">${x ? 'Save' : 'Add'}</button>
    <button class="btn full" id="pnBack" style="margin-top:8px">Back</button>`);
  $('#pnG').onclick = e => { const b = e.target.closest('[data-g]'); if (!b || locked) return;
    gender = b.dataset.g;
    $('#pnG').querySelectorAll('button').forEach(z => z.classList.toggle('on', z.dataset.g === gender)); };
  $('#pnBack').onclick = openPeople;
  $('#pnSave').onclick = () => {
    const name = $('#pnN').value.trim(); if (!name) return toast('Type a name');
    const hide = x && $('#pnHide').checked;
    if (x && hide && DATA.people.length === 1 && !x[2]) return toast("Can't hide the only person");
    let c = x ? x[0] : name.charAt(0).toUpperCase();
    if (!x) { const base = c; let n = 2; while (DATA.pinfo.some(y => y[0] === c)) c = base + n++; }
    const row = x || [c, name, false, {}, '']; row[1] = name; row[2] = !!hide; row[4] = gender; if (!x) DATA.pinfo.push(row);
    if (SERVER) { SERVER.people = DATA.pinfo; LS.set('data', SERVER); }
    if (hide) SEL = SEL.filter(p => p !== c);
    rebuild(); openPeople();
    write({action:'savePerson', code:c, name, hidden:!!hide, gender}, x ? 'Saved ' + name : 'Added ' + name);
  };
}

/* ---------------- HISTORY (no search bar) ---------------- */
function renderHist(){
  const el = $('#v-hist'), groups = {};
  selLogs().forEach(l => { const k = l.date || ''; (groups[k] = groups[k] || []).push(l); });
  const keys = Object.keys(groups).sort((a,b) => a === '' ? 1 : b === '' ? -1 : a < b ? 1 : -1);
  const LIMIT = LS.get('histLimit', 12), shown = keys.slice(0, LIMIT);
  el.innerHTML = `
    ${!keys.length ? '<div class="empty">No workouts yet.<br>Tap the big button to start one.</div>' : ''}
    ${shown.map(k => dayCard(k, groups[k])).join('')}
    ${keys.length > shown.length ? `<button class="btn full" id="more">Show older (${keys.length - shown.length} more days)</button>` : ''}`;
  const m = $('#more'); if (m) m.onclick = () => { LS.set('histLimit', LIMIT + 12); renderHist(); };
}
const cellTxt = l => { const r = l.reps === '' ? '?' : l.reps;
  return D.isIso(l.ex) && !Number(l.kg) ? r + 's' : Number(l.kg) ? `${fkg(l.kg)}<i>×${r}</i>` : '×' + r; };
function dayCard(date, logs){
  const c = {upper:0, mid:0, lower:0}; logs.forEach(l => c[l.split]++);
  const vol = logs.reduce((s, l) => s + (Number(l.kg)||0)*(Number(l.reps)||0), 0);
  const byEx = {}, order = [];
  logs.forEach(l => { const k = l.ex.toLowerCase(); if (!byEx[k]) { byEx[k] = {name:l.ex, sets:[]}; order.push(k); } byEx[k].sets.push(l); });
  const n = Math.max(1, ...order.map(k => byEx[k].sets.length)), cols = Array.from({length: n}, (_, i) => i);
  const table = `<table class="ht"><tr><th></th>${cols.map(i => `<th class="${i ? '' : 'gl'}">${i+1}</th>`).join('')}</tr>`
    + order.map(k => `<tr><td class="nm">${esc(byEx[k].name)}</td>${cols.map(i => { const l = byEx[k].sets[i];
      return `<td class="${i ? '' : 'gl'}${l ? (l.pending ? ' pend' : '') : ' e'}">${l ? cellTxt(l) : '·'}</td>`; }).join('')}</tr>`).join('') + '</table>';
  return `<div class="card${date && date === today() ? ' tdy' : ''}" data-date="${date}">
    <div class="day-h"><span class="d">${fmtD(date)}${date && date === today() ? '<span class="tag today">Today</span>' : ''}</span>
      ${['upper','mid','lower'].filter(k => c[k]).map(k => `<span class="tag s-${k}">${k[0].toUpperCase()} ${c[k]}</span>`).join('')}
      <button class="icon-btn" data-day="${date}" title="Day options">⋯</button></div>
    <div class="small dim" style="margin-bottom:4px">${logs.length} sets · ${nf(vol)} kg volume${date ? ` · ${daysAgo(date)===0?'today':daysAgo(date)+'d ago'}`:''} · tap to edit</div>
    ${table}
  </div>`;
}
$('#v-hist').addEventListener('click', e => {
  const d = e.target.closest('[data-day]'); if (d) return openDayMenu(d.dataset.day);
  const c = e.target.closest('.card[data-date]'); if (c) openEdit(c.dataset.date);
});
function openDayMenu(date){
  const logs = selLogs().filter(l => (l.date||'') === date);
  openSheet(fmtD(date), `
    <button class="btn full" id="dmEdit" style="margin-bottom:8px">✎ Edit this workout</button>
    <button class="btn full" id="dmRepeat" style="margin-bottom:8px">↻ Repeat this workout</button>
    <button class="btn full" id="dmDate" style="margin-bottom:8px">Change date of whole day</button>
    <button class="btn full danger" id="dmDel">Delete whole day (${logs.length} sets)</button>`);
  $('#dmEdit').onclick = () => { closeSheet(); openEdit(date); };
  $('#dmRepeat').onclick = () => {
    const names = [...new Set(logs.map(l => l.ex))];
    startDraft(null, names, 'Repeat of ' + fmtShort(date)); closeSheet(); go('work');
  };
  $('#dmDate').onclick = () => {
    openSheet('Move ' + fmtD(date), `<div class="fld"><label>New date</label><input type="date" id="mvD" value="${date||today()}"></div><button class="btn pri full" id="mvGo">Move ${logs.length} sets</button>`);
    $('#mvGo').onclick = () => {
      const nd = $('#mvD').value; if (!nd) return; closeSheet();
      if (nd === date) return;
      logs.filter(x => x.pending).forEach(l => editPending(l.cid, {date:nd, person:l.person, exercise:l.ex, split:l.split, kg:l.kg, reps:l.reps}, true));
      saveQueue(); rebuild(); flushQueue();
      const synced = logs.filter(x => x.row);
      if (synced.length) write({action:'saveDay', deletes:[], adds:[], updates: synced.map(l => ({id:l.id, row:l.row, fp:l.fp,
        entry:{date:nd, person:l.person, exercise:l.ex, kg:l.kg, reps:l.reps}}))}, `Moved ${synced.length} set${synced.length===1?'':'s'}`);
    };
  };
  $('#dmDel').onclick = () => {
    if (!confirm(`Delete all ${logs.length} sets on ${fmtD(date)}?`)) return;
    closeSheet();
    const pend = logs.filter(l => l.pending).map(l => l.cid);
    if (pend.length) { queueDelete(dropFromQueue(pend)); rebuild(); flushQueue(); }
    const synced = logs.filter(l => l.row);
    if (synced.length) write({action:'deleteLogs', items: synced.map(l => ({row:l.row, fp:l.fp, id:l.id}))}, 'Day deleted');
    else toast('Day deleted');
  };
}
function editPending(cid, entry, quiet){
  if (inflightHas(cid)) return toast('Syncing — try again in a second');
  const q = QUEUE.find(x => x.entries && x.entries.some(e => e.cid === cid)); if (!q) return quiet || toast('Already synced — refresh and edit again');
  const en = q.entries.find(e => e.cid === cid);
  Object.assign(en, {date:entry.date, person:entry.person, exercise:entry.exercise, split:entry.split, kg:entry.kg, reps:entry.reps});
  if (q.tried) {
    en.cid = uid();
    const lb = LS.get('lastBatch', null);
    if (lb) { const i = lb.ids.indexOf(cid); if (i >= 0) { lb.ids[i] = en.cid; LS.set('lastBatch', lb); } }
    queueDelete([cid]);
  }
  saveQueue();
  if (!quiet) { rebuild(); toast('Updated'); flushQueue(); }
}

/* ---------------- EDIT a past workout (same cards as the workout page) ---------------- */
function openEdit(date){
  const logs = selLogs().filter(l => (l.date||'') === date);
  if (logs.some(l => l.pending)) return toast('This day is still syncing — try again in a moment');
  const items = [], by = {}, orig = [];
  logs.forEach(l => { const k = l.ex.toLowerCase(); let it = by[k];
    if (!it) { it = by[k] = {id: uid(), ex: l.ex, sets: {}}; items.push(it); }
    const o = {key: logKey(l), id: l.id, row: l.row, fp: l.fp, ex: l.ex, kg: Number(l.kg)||0, reps: l.reps}; orig.push(o);
    (it.sets[l.person] = it.sets[l.person] || []).push({kg: Number(l.kg) ? String(l.kg) : '', reps: l.reps === '' ? '' : String(l.reps), done: true, o}); });
  const people = SEL.filter(p => logs.some(l => l.person === p)); if (!people.length) people.push(SEL[0]);
  items.forEach(it => people.forEach(p => { if (!it.sets[p]) it.sets[p] = [{kg:'', reps:'', done:false}]; }));
  EDIT = {date, from: date, people, items, orig}; LS.set('edit', EDIT);
  go('edit');
}
const logKey = l => l.id ? 'i' + l.id : 'r' + l.row;
function renderEdit(){
  const el = $('#v-edit');
  if (!EDIT) { el.innerHTML = '<div class="empty">Nothing to edit</div>'; return; }
  const n = countDone(EDIT);
  el.innerHTML = `
    <div class="card" style="padding:12px">
      <div class="row">
        <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:17px">${fmtD(EDIT.from)}</div>
          <div class="small muted">${EDIT.people.map(pn).join(' + ')} · ${EDIT.items.length} exercise${EDIT.items.length===1?'':'s'} · ${n} set${n===1?'':'s'}</div></div>
        <input type="date" id="edDate" class="wdate" value="${EDIT.date}">
      </div>
    </div>
    <div>${EDIT.items.map(it => exCard(it, EDIT)).join('')}</div>
    <button class="btn full" id="edAdd" style="margin-bottom:10px">+ Add exercise</button>
    <button class="btn full" id="edCancel" style="margin-bottom:70px">Cancel</button>
    <div class="stickybar"><div class="in"><button class="btn pri full" id="edSave">Save changes</button></div></div>`;
  $('#edDate').onchange = e => { EDIT.date = e.target.value || EDIT.from; saveW(EDIT); };
  $('#edAdd').onclick = () => openPicker({ title:'Add exercise', multi:true, split:'all', onPick: names => {
    names.forEach(nm => { const it = {id: uid(), ex: nm, sets: {}}; EDIT.people.forEach(p => it.sets[p] = [{kg:'', reps:'', done:false}]); EDIT.items.push(it); }); saveW(EDIT); renderEdit(); } });
  $('#edCancel').onclick = () => { EDIT = null; LS.del('edit'); go('hist'); };
  $('#edSave').onclick = saveEdit;
}
async function saveEdit(){
  const E = EDIT, keep = {}, updates = [], adds = [];
  E.items.forEach(it => Object.keys(it.sets).forEach(p => it.sets[p].forEach(s => {
    if (!s.done) return;
    const entry = {date: E.date, person: p, exercise: it.ex, split: splitOfEx(it.ex), kg: s.kg === '' ? 0 : Number(s.kg), reps: s.reps === '' ? '' : Number(s.reps)};
    const o = s.o;
    if (!o) return adds.push(Object.assign({cid: uid()}, entry));
    keep[o.key] = 1;
    if (E.date !== E.from || o.ex !== entry.exercise || o.kg !== entry.kg || String(o.reps) !== String(entry.reps)) updates.push({id: o.id, row: o.row, fp: o.fp, entry});
  })));
  const deletes = E.orig.filter(o => !keep[o.key]).map(o => ({id: o.id, row: o.row, fp: o.fp}));
  if (!updates.length && !adds.length && !deletes.length) { EDIT = null; LS.del('edit'); go('hist'); return toast('No changes'); }
  const b = $('#edSave'); b.disabled = true; b.textContent = 'Saving…';
  const ok = await write({action:'saveDay', updates, deletes, adds}, 'Workout updated');
  if (ok) { EDIT = null; LS.del('edit'); go('hist'); }
  else if (VIEW === 'edit') renderEdit();
}

/* ---------------- sheet / settings ---------------- */
function openSheet(title, html, onGear){ syncOpen = false; $('#shTitle').textContent = title; const g = $('#shGear'); g.hidden = !onGear; g.onclick = onGear || null; $('#shBody').innerHTML = html; $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#shBody').scrollTop = 0; }
function closeSheet(){ syncOpen = false; $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
$('#shClose').onclick = closeSheet; $('#scrim').onclick = closeSheet;

function openSettings(reason){
  if (IS_GAS) { return openSheet('Sync', `<p class="muted">Connected to your sheet. ${QUEUE.length} unsynced item(s).</p><button class="btn pri full" id="stSync">Sync now</button>`), $('#stSync').onclick = () => { closeSheet(); refresh(true); flushQueue(); }; }
  openSheet('Connect to your sheet', `
    ${reason==='BAD_KEY' ? '<p style="color:var(--bad)">Secret key was wrong.</p>' : ''}
    <div class="fld"><label>Apps Script web app URL (ends with /exec)</label><input id="stU" value="${esc(apiUrl())}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></div>
    <div class="fld"><label>Secret key (APP_KEY in Code.gs)</label><input id="stK" value="${esc(LS.get('key',''))}" autocomplete="off"></div>
    <button class="btn pri full" id="stSave">Save & sync</button>
    <p class="small dim">${QUEUE.length} unsynced item(s) waiting on this phone. After syncing you'll be asked who is training in this session.</p>`);
  $('#stSave').onclick = () => { LS.set('url', $('#stU').value.trim()); LS.set('key', $('#stK').value.trim()); LS.set('askWho', true); closeSheet(); refresh(true); };
}

/* ---------------- lifecycle: never lose data ---------------- */
let lastFg = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { storeDraft(); LS.set('queue', QUEUE); }
  else { flushQueue(); if (SERVER && Date.now() - lastFg > 3000) { lastFg = Date.now(); refresh(false); } }
});
window.addEventListener('pagehide', () => { storeDraft(); LS.set('queue', QUEUE); });
window.addEventListener('online', flushQueue);

/* ---------------- boot (called by Index.html after every script has loaded) ---------------- */
function boot(){
  if (!LS.get('me', null) && (IS_GAS || apiUrl())) LS.set('askWho', true);   // no owner chosen on this phone yet
  if (SERVER) rebuild();
  else { DATA = null; $('#v-'+VIEW).classList.add('on'); $('#v-'+VIEW).innerHTML = '<div class="skel"></div><div class="skel" style="height:160px"></div><div class="skel"></div>'; }
  refresh(false, !SERVER);
  if ('serviceWorker' in navigator && !IS_GAS && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
}
