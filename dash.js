/* Gym Tracker — dash.js v7 (Dashboard + exercise progress chart). v7: "Recent personal records" and "Due for a comeback" removed. */
function inRange(l){ return l.date && (RANGE === 0 || daysAgo(l.date) < RANGE); }
function renderDash(){
  const all = selLogs(), L = all.filter(inRange), tot = L.length || 1;
  const cnt = {upper:0, mid:0, lower:0}; L.forEach(l => cnt[l.split] = (cnt[l.split]||0) + 1);
  const pct = k => Math.round(cnt[k] / tot * 100);
  const mx = Math.max(cnt.upper, cnt.mid, cnt.lower, 1);
  const op = k => (0.12 + 0.88 * cnt[k] / mx).toFixed(2);
  const days = workoutDays(all);
  const nextIdx = nextPlanIndex(SEL[0]), nextPlan = DATA.plans[nextIdx];
  const last = days[0], since = last ? daysAgo(last.date) : null;
  const now = parseYmd(today()), dow = (now.getDay()+6)%7;
  const wkStart = new Date(now); wkStart.setDate(now.getDate()-dow);
  const pwStart = new Date(wkStart); pwStart.setDate(wkStart.getDate()-7);
  const wk = {s:0,sets:0,vol:0}, pw = {s:0,sets:0,vol:0};
  days.forEach(d => { const dt = parseYmd(d.date), t = dt >= wkStart ? wk : (dt >= pwStart ? pw : null); if (t){ t.s++; t.sets += d.sets; t.vol += d.vol; } });
  const delta = (a, b) => b === 0 ? (a ? '<span class="up">new</span>' : '<span class="dim">–</span>') : (a >= b ? `<span class="up">▲ ${Math.round((a-b)/b*100)}%</span>` : `<span class="down">▼ ${Math.round((b-a)/b*100)}%</span>`);
  const ranges = [[7,'7D'],[30,'30D'],[90,'90D'],[0,'All']];
  $('#v-dash').innerHTML = `
  <div class="card">
    <h3><span class="sp">Next up</span>${since===null?'':`<span class="small" style="text-transform:none;letter-spacing:0">${since===0?'trained today':since===1?'last trained yesterday':`last trained ${since} days ago`}</span>`}</h3>
    <div class="row">
      <div style="flex:1"><div class="big">${nextPlan ? cap(planType(nextPlan)) + ' <span style="color:var(--accent)">★</span>' : '—'}</div>
      <div class="muted small">Rotation: ${DATA.plans.map((p,i)=> i===nextIdx ? `<b style="color:var(--accent)">${cap(planType(p))}</b>` : cap(planType(p))).join(' → ')}</div></div>
      <button class="btn pri" id="dStart">${DRAFT?'Resume':'Start'}</button>
    </div>
  </div>
  <div class="seg" id="rangeSeg" style="margin-bottom:12px">${ranges.map(r=>`<button data-r="${r[0]}" class="${RANGE===r[0]?'on':''}">${r[1]}</button>`).join('')}</div>
  <div class="card">
    <h3><span class="sp">Body split</span><span class="small" style="text-transform:none;letter-spacing:0">${L.length} sets</span></h3>
    <div class="body-wrap">
      ${bodySvg(op('upper'), op('mid'), op('lower'))}
      <div class="legend">
        ${['upper','mid','lower'].map(k => `<div class="lg"><div class="top"><span>${cap(k)}</span><span><b>${L.length?pct(k):0}%</b> <span class="dim small">${cnt[k]} sets</span></span></div><div class="bar"><i style="width:${L.length?pct(k):0}%;background:#ff7a33;opacity:${op(k)}"></i></div></div>`).join('')}
        <div class="small dim">${balanceNote(cnt)}</div>
      </div>
    </div>
  </div>
  <div class="card">
    <h3><span class="sp">Activity</span><span class="small" style="text-transform:none;letter-spacing:0">${activitySummary(days)}</span></h3>
    ${activityGrid(days)}
  </div>
  <div class="card">
    <h3>This week vs last</h3>
    <div class="tiles">
      <div class="tile"><div class="v">${wk.s}</div><div class="l">workouts ${delta(wk.s,pw.s)}</div></div>
      <div class="tile"><div class="v">${wk.sets}</div><div class="l">sets ${delta(wk.sets,pw.sets)}</div></div>
      <div class="tile"><div class="v">${nf(wk.vol)}</div><div class="l">kg volume ${delta(wk.vol,pw.vol)}</div></div>
    </div>
  </div>
  <div class="card">
    <h3><span class="sp">Stuck lately</span><span class="small" style="text-transform:none;letter-spacing:0">${PROG.stuckAfter}+ sessions, no new best</span></h3>
    ${stuckList()}
  </div>
  <div class="card">
    <h3><span class="sp">Exercise progress</span></h3>
    <div id="pgCard"></div>
  </div>`;
  $('#v-dash').onclick = e => { const r = e.target.closest('.li[data-prog]'); if (r) openProgress(r.dataset.prog); };
  $('#dStart').onclick = () => { if (!DRAFT) startSplit(nextPlan ? planType(nextPlan) : 'upper'); go('work'); };
  drawPg();
  $('#rangeSeg').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; RANGE = Number(b.dataset.r); LS.set('range', RANGE); renderDash(); };
}
function balanceNote(c){
  const t = c.upper + c.mid + c.lower; if (!t) return 'No sets in this range yet.';
  if (c.mid / t < 0.1) return 'Mid/core is under 10% — add one core move per session.';
  const r = c.upper / Math.max(c.lower, 1);
  if (r > 1.6) return 'Upper-heavy lately — next lower day will balance it.';
  if (r < 0.6) return 'Lower-heavy lately — upper day is due.';
  return 'Nicely balanced.';
}
function bodySvg(u, m, l){
  const P = (o, ds) => ds.map(d => `<path fill="#ff7a33" fill-opacity="${o}" style="stroke:var(--card)" stroke-width="1.2" stroke-linejoin="round" d="${d}"/>`).join('');
  const UP = ['M42 27 Q50 31 58 27 L70 34 Q50 37 30 34 Z',
    'M30 34 Q17 34 14 46 Q14 54 19 57 L26 50 Q30 42 33 38 Z', 'M70 34 Q83 34 86 46 Q86 54 81 57 L74 50 Q70 42 67 38 Z',
    'M33 37 Q44 35 49.5 37 L49.5 53 Q40 57 30 51 Q27 44 33 37 Z', 'M67 37 Q56 35 50.5 37 L50.5 53 Q60 57 70 51 Q73 44 67 37 Z',
    'M19 58 Q14 66 15 76 Q18 80 22 78 Q27 68 27 52 Z', 'M81 58 Q86 66 85 76 Q82 80 78 78 Q73 68 73 52 Z',
    'M15 79 Q10 90 12 101 Q14 105 17 103 Q22 92 22 80 Z', 'M85 79 Q90 90 88 101 Q86 105 83 103 Q78 92 78 80 Z'];
  const MID = ['M41.5 56 L58.5 56 L57.5 91 Q50 95 42.5 91 Z',
    'M30 53 Q36 56 41 56 L42 91 Q36 89 33 83 Q30 70 30 53 Z', 'M70 53 Q64 56 59 56 L58 91 Q64 89 67 83 Q70 70 70 53 Z'];
  const LOW = ['M33 86 Q50 97 67 86 L69 99 Q60 104 50 104 Q40 104 31 99 Z',
    'M31 100 Q27 122 32 146 Q37 152 44 148 Q49.5 128 49.5 105 Q40 105 31 100 Z', 'M69 100 Q73 122 68 146 Q63 152 56 148 Q50.5 128 50.5 105 Q60 105 69 100 Z',
    'M33 152 Q29 166 32 182 Q35 195 38 199 L44 199 Q46 186 45 170 Q45 158 43 152 Z', 'M67 152 Q71 166 68 182 Q65 195 62 199 L56 199 Q54 186 55 170 Q55 158 57 152 Z',
    'M37 200 L45 200 L46 206 L33 206 Z', 'M63 200 L55 200 L54 206 L67 206 Z'];
  return `<svg viewBox="0 0 100 210" aria-label="Body heatmap">
    <circle cx="50" cy="13" r="10" fill="#2a2e37"/>
    <rect x="45" y="21" width="10" height="8" rx="2" fill="#2a2e37"/>
    ${P(u, UP)}${P(m, MID)}${P(l, LOW)}
    <path d="M50 58 V91 M43 66 H57 M43 74.5 H57 M43 83 H57" stroke="#0e0f13" stroke-opacity=".3" stroke-width="1" fill="none"/>
  </svg>`;
}
function activityGrid(days){
  const set = {}; days.forEach(d => set[d.date] = d);
  const kind = d => { const v = Object.values(d.ex), u = v.indexOf('upper') >= 0, l = v.indexOf('lower') >= 0; return u && l ? 'full' : u ? 'upper' : l ? 'lower' : 'mid'; };
  const cell = (d, isToday, k) => {
    if (!d) return `<span class="c ${isToday?'today':''}" title="${k}: rest"></span>`;
    const t = kind(d);
    return `<span class="c ${isToday?'today':''}" style="background:var(--${t})" title="${k}: ${t}"></span>`;
  };
  const t = parseYmd(today());
  const month = (y, m) => {
    const first = new Date(y, m, 1), dim = new Date(y, m+1, 0).getDate(), off = (first.getDay()+6)%7, rows = Math.ceil((off + dim) / 7);
    let h = `<div class="cal"><div class="cal-t">${MON[m]} ${y !== t.getFullYear() ? y : ''}</div><div class="cal-g"><span></span>`;
    h += ['M','T','W','T','F','S','S'].map(d => `<span class="cal-d">${d}</span>`).join('');
    for (let r = 0; r < rows; r++){
      h += `<span class="cal-w">${r+1}</span>`;
      for (let c = 0; c < 7; c++){
        const day = r*7 + c - off + 1;
        if (day < 1 || day > dim) { h += '<span class="c blank"></span>'; continue; }
        const dt = new Date(y, m, day), k = ymd(dt);
        if (dt > t) { h += '<span class="c future"></span>'; continue; }
        h += cell(set[k], k===today(), k);
      }
    }
    return h + '</div></div>';
  };
  const pm = new Date(t.getFullYear(), t.getMonth()-1, 1);
  return `<div class="cals">${month(pm.getFullYear(), pm.getMonth())}${month(t.getFullYear(), t.getMonth())}</div>
    <div class="act-key"><span class="c" style="background:var(--upper)"></span> Upper <span class="c" style="background:var(--lower);margin-left:8px"></span> Lower <span class="c" style="background:var(--full);margin-left:8px"></span> Full body <span class="c" style="background:var(--mid);margin-left:8px"></span> Mid only</div>`;
}
function activitySummary(days){
  const t = parseYmd(today()), dow = (t.getDay()+6)%7, wk = new Date(t); wk.setDate(t.getDate()-dow);
  const has = {}; days.forEach(d => { const x = parseYmd(d.date), s = new Date(x); s.setDate(x.getDate()-((x.getDay()+6)%7)); has[ymd(s)] = (has[ymd(s)]||0)+1; });
  let streak = 0; const c = new Date(wk);
  if (!has[ymd(c)]) c.setDate(c.getDate()-7);
  while (has[ymd(c)]) { streak++; c.setDate(c.getDate()-7); }
  return `${days.filter(d => daysAgo(d.date) < 30).length} days / 30d · ${streak} wk streak`;
}
/* ---------------- exercise progress chart (plain SVG, no library) ---------------- */
function sessions(ex, people, win){
  const k = ex.toLowerCase(), m = {};
  D.logs.forEach(l => {
    if (!l.date || l.ex.toLowerCase() !== k || people.indexOf(l.person) < 0 || (win && (l.date < win.from || l.date > win.to))) return;
    const d = m[l.date] || (m[l.date] = {date:l.date}), kg = Number(l.kg)||0, reps = Number(l.reps)||0, c = d[l.person];
    if (!c || kg > c.kg || (kg === c.kg && reps > c.reps)) d[l.person] = {kg, reps};
  });
  return Object.values(m).sort((a,b) => a.date < b.date ? -1 : 1).slice(win ? -40 : -12);
}
function progressHtml(ex, win){
  const people = SEL.slice(), S = sessions(ex, people, win);
  if (!S.length) return '<div class="muted small" style="padding:8px 0">No sets in this range.</div>';
  const iso = D.isIso(ex), bw = !iso && S.every(s => people.every(p => !s[p] || !s[p].kg));
  const val = v => iso || bw ? v.reps : v.kg;
  const lbl = v => iso ? v.reps + 's' : bw ? v.reps + ' reps' : fkg(v.kg) + '×' + v.reps;
  const unit = iso ? 's' : bw ? ' reps' : ' kg';
  const vals = []; S.forEach(s => people.forEach(p => s[p] && vals.push(val(s[p]))));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pd = (hi - lo) * .15; lo = Math.max(0, lo - pd); hi += pd;
  const W = 320, H = 150, L = 30, R = 12, T = 10, B = 20;
  const x = i => S.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (S.length - 1);
  const y = v => T + (hi - v) * (H - T - B) / (hi - lo);
  const cp = s => esc(fmtD(s.date) + ' · ' + people.filter(p => s[p]).map(p => (NAMES[p] || p) + ' ' + lbl(s[p])).join(' · '));
  let g = '';
  for (let j = 0; j <= 2; j++) { const v = lo + (hi - lo) * j / 2;
    g += `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#2a2f3a" stroke-width="1"/><text x="${L-5}" y="${y(v)+3}" text-anchor="end" font-size="9" fill="#646b7a">${fkg(Math.round(v*2)/2)}</text>`; }
  g += `<text x="${x(0)}" y="${H-5}" font-size="9" fill="#646b7a" text-anchor="${S.length>1?'start':'middle'}">${fmtShort(S[0].date)}</text>`;
  if (S.length > 1) g += `<text x="${x(S.length-1)}" y="${H-5}" font-size="9" fill="#646b7a" text-anchor="end">${fmtShort(S[S.length-1].date)}</text>`;
  const leg = [];
  people.forEach(p => {
    const col = pcol(p), pts = S.map((s, i) => s[p] ? [x(i), y(val(s[p])), i] : null).filter(Boolean);
    if (!pts.length) return;
    g += `<polyline points="${pts.map(q => q[0] + ',' + q[1]).join(' ')}" fill="none" style="stroke:${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(q => g += `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" style="fill:${col}"/><circle cx="${q[0]}" cy="${q[1]}" r="13" fill="transparent" data-cap="${cp(S[q[2]])}"/>`);
    const first = S[pts[0][2]][p], last = S[pts[pts.length-1][2]][p], d = val(last) - val(first);
    leg.push(`<span><i style="background:${col}"></i><b>${pn(p)}</b> ${lbl(last)} ${pts.length > 1 ? (d > 0 ? `<span class="up">▲ ${fkg(d)}${unit}</span>` : d < 0 ? `<span class="down">▼ ${fkg(-d)}${unit}</span>` : '<span class="dim">=</span>') : ''}</span>`);
  });
  return `<div class="pg"><div class="pg-leg">${leg.join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" class="pg-svg">${g}</svg>
    <div class="pg-cap">${cp(S[S.length-1])}</div>
    <div class="small dim">${iso ? 'Longest hold' : bw ? 'Most reps' : 'Heaviest set'} per session · ${S.length} session${S.length===1?'':'s'} · tap a dot</div></div>`;
}
function pgWindow(){
  const now = today().slice(0, 7);
  let a = LS.get('pgFromM', now), b = LS.get('pgToM', now);
  if (a > b) [a, b] = [b, a];
  const [y, mo] = b.split('-').map(Number);
  return { from: a + '-01', to: ymd(new Date(y, mo, 0)), fromM: a, toM: b };
}
const fmtMon = m => MON[Number(m.slice(5)) - 1] + ' ' + m.slice(0, 4);
const pgLabel = W => W.fromM === W.toM ? fmtMon(W.fromM) : W.fromM.slice(0, 4) === W.toM.slice(0, 4)
  ? MON[Number(W.fromM.slice(5)) - 1] + ' – ' + fmtMon(W.toM) : fmtMon(W.fromM) + ' – ' + fmtMon(W.toM);
const SCOL = ['#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];
function progressCard(){
  const W = pgWindow(), SP = LS.get('pgSplit', 'all');
  const L = selLogs().filter(l => l.date && l.date >= W.from && l.date <= W.to && (SP === 'all' || l.split === SP));
  const cnt = {}, name = {};
  L.forEach(l => { const k = l.ex.toLowerCase(); cnt[k] = (cnt[k] || 0) + 1; name[k] = name[k] || l.ex; });
  const keys = Object.keys(cnt).sort((a,b) => cnt[b] - cnt[a] || a.localeCompare(b));
  const filters = `<div class="grid2" style="margin-bottom:8px"><div class="fld" style="margin:0"><label>From</label><input type="month" id="pgFromM" value="${W.fromM}" style="padding:9px 8px;font-size:15px"></div><div class="fld" style="margin:0"><label>To</label><input type="month" id="pgToM" value="${W.toM}" style="padding:9px 8px;font-size:15px"></div></div>
    <div class="seg" id="pgS" style="margin-bottom:10px">${['all','upper','lower','mid'].map(s => `<button data-s="${s}" class="${SP===s?'on':''}">${cap(s)}</button>`).join('')}</div>`;
  if (!keys.length) return filters + '<div class="muted small">No sets in this period.</div>';
  let cur = String(LS.get('pgEx', '')).toLowerCase();
  if (!cnt[cur]) cur = keys[0];
  const top = keys.slice(0, 5), rest = keys.slice(5), open = LS.get('pgMore', false);
  const col = k => { const i = top.indexOf(k); return i >= 0 ? SCOL[i] : '#4b5563'; };
  const pc = n => n / L.length * 100, pct = n => Math.round(pc(n)) || '<1';
  const restN = rest.reduce((s, k) => s + cnt[k], 0);
  const seg = (k, n, c, on) => `<i class="${on?'on':''}" ${k ? `data-ex="${esc(k)}"` : 'data-other="1"'} style="width:${pc(n)}%;background:${c}" title="${esc(k ? name[k] : 'Others')} ${pct(n)}%"></i>`;
  const stack = `<div class="pg-stack ${cnt[cur]?'sel':''}">${top.map(k => seg(k, cnt[k], col(k), k === cur)).join('')}${restN ? seg('', restN, '#4b5563', rest.indexOf(cur) >= 0) : ''}</div>`;
  const row = k => `<div class="pg-ex ${k===cur?'on':''}" data-ex="${esc(k)}"><span class="dot" style="background:${col(k)}"></span><span class="t">${esc(name[k])}</span><span class="tag s-${splitOfEx(k)}">${splitOfEx(k)}</span><span style="width:76px;text-align:right"><b>${pct(cnt[k])}%</b> <span class="dim small">${cnt[k]}</span></span></div>`;
  const bars = stack + top.map(row).join('')
    + (rest.length ? `<div class="pg-ex" data-other="1"><span class="dot" style="background:#4b5563"></span><span class="t">Others (${rest.length}) <span class="dim">${open ? '▴' : '▾'}</span></span><span style="width:76px;text-align:right"><b>${pct(restN)}%</b> <span class="dim small">${restN}</span></span></div>`
      + (open ? `<div style="padding-left:18px">${rest.map(row).join('')}</div>` : '') : '');
  const opts = keys.slice().sort((a,b) => a.localeCompare(b)).map(k => `<option value="${esc(k)}" ${k===cur?'selected':''}>${esc(cap(name[k]))}</option>`).join('');
  return filters + `<div class="small muted" style="margin-bottom:4px">${L.length} sets · ${pgLabel(W)} · tap to chart</div>${bars}
    <select id="pgEx" style="margin:10px 0 4px;text-transform:capitalize">${opts}</select>${progressHtml(name[cur], W)}`;
}
function drawPg(){
  const box = $('#pgCard'); if (!box) return;
  box.innerHTML = progressCard();
  box.onclick = e => {
    const s = e.target.closest('#pgS [data-s]'), x = e.target.closest('[data-ex]');
    if (s) LS.set('pgSplit', s.dataset.s);
    else if (x) LS.set('pgEx', x.dataset.ex);
    else if (e.target.closest('[data-other]')) LS.set('pgMore', !LS.get('pgMore', false));
    else return;
    drawPg();
  };
  const sel = $('#pgEx'); if (sel) sel.onchange = e => { LS.set('pgEx', e.target.value); drawPg(); };
  ['pgFromM', 'pgToM'].forEach(id => { const n = $('#' + id); if (n) n.onchange = e => { if (e.target.value) { LS.set(id, e.target.value); drawPg(); } }; });
}
function openProgress(ex){ openSheet(cap(ex), progressHtml(ex)); }
document.addEventListener('click', e => {
  const c = e.target.closest && e.target.closest('[data-cap]'); if (!c) return;
  const box = c.closest('.pg'); if (box) box.querySelector('.pg-cap').textContent = c.getAttribute('data-cap');
});
function stuckList(){
  const sm = D.stuck, rows = Object.keys(sm).filter(k => SEL.indexOf(k.split('|')[1]) >= 0).sort((a,b) => sm[b].n - sm[a].n).slice(0, 5);
  if (!rows.length) return '<div class="muted small">Nothing stuck — every exercise is still moving up. 💪</div>';
  return `<div class="list">${rows.map(k => { const ex = k.split('|')[0], s = sm[k], name = (DATA.menu.find(m => m[0].toLowerCase() === ex) || [ex])[0];
    return `<div class="li" data-prog="${esc(name)}"><div class="grow"><div class="t">${esc(name)}</div><div class="small muted">${stuckBest(name, s.best)} since ${fmtShort(s.since)} — <span style="color:var(--warn)">${stuckTip(name, s.best)}</span></div></div><span class="tag" style="color:var(--bad);border-color:#5a2424">${s.n} sessions</span></div>`; }).join('')}</div>`;
}
