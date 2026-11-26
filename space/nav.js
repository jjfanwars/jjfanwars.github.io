'use strict';
// YeShip navigation, Kerbal style (25 Nov 2026): burn nodes (maneuver nodes) planned in the map, the orbit after the burn,
// a burn marker + SAS "node" mode in flight, auto-burn, quick plans (circularise, transfer to the target), and a time warp bar.
// Loaded after world.js, before polish.js (which calls boot()). Uses PRED/predict/mkPred/drawPoint/MAPV/navTarget from mission.js.

let NODE = null; // {t, dv: V3(prograde, normal, radial) m/s, bv: inertial burn vector, b: body at the node, burn: seconds, auto, burning}
const PRED2 = mkPred(), NV3 = () => new V3();
const _q1 = new V3(), _q2 = new V3(), _q3 = new V3(), _q4 = new V3();
const NAV = {step: 10, upT: 0, warpSet: 0};

// coast from now to time t with the engine off (same physics as the map prediction)
function stateAt(t, pos, vel) {
  pos.copy(R.pos); vel.copy(R.vel); let tt = G.t; const a = gravAt(pos, tt, NV3()); let n = 0;
  while (tt < t - 1e-6 && n++ < 60000) { const rp = pos.length(); let hm = Math.sqrt(rp * rp * rp / PLANET.GM);
    for (const b of SATS) { const r = satPos(b, tt, _q3).distanceTo(pos); hm = Math.min(hm, Math.sqrt(r * r * r / b.GM)); }
    const h = Math.min(clamp(.004 * hm, .05, 600), t - tt); vel.addScaledVector(a, h / 2); pos.addScaledVector(vel, h); tt += h; gravAt(pos, tt, a); vel.addScaledVector(a, h / 2); }
}
// prograde / normal / radial-out directions at a point (relative to the body whose pull it is in)
function nodeBasis(pos, vel, t, pro, nrm, rad) { const b = BODIES[domAt(pos, t)], r = pos.clone().sub(satPos(b, t, _q3)), v = vel.clone().sub(satVel(b, t, _q3));
  pro.copy(v).normalize(); nrm.crossVectors(r, v).normalize(); rad.crossVectors(pro, nrm).normalize(); return b; }
function navRem() { return NODE ? _q4.copy(NODE.bv).sub(NAVACC || _q3.set(0, 0, 0)) : _q4.set(0, 0, 0); } // burn still to do (inertial)
function nodeUpdate() {
  if (!NODE) { PRED2.n = 0; return; }
  const p = NV3(), v = NV3(), pro = NV3(), nrm = NV3(), rad = NV3(), tn = Math.max(NODE.t, G.t); stateAt(tn, p, v); NODE.b = nodeBasis(p, v, tn, pro, nrm, rad);
  if (!NODE.burning) NODE.bv = pro.multiplyScalar(NODE.dv.x).addScaledVector(nrm, NODE.dv.y).addScaledVector(rad, NODE.dv.z);
  NODE.pos = p; NODE.vel = v; NODE.burn = burnTime(NODE.bv.length());
  predict(PRED2, p, v.clone().add(NODE.bv), tn);
}
function nodeMake(t, dv) { NODE = {t, dv: dv || NV3(), bv: NV3(), auto: false, burning: false, burn: 0}; NAVACC = NV3(); nodeUpdate(); nodePanel(); }
function nodeKill(why) { NODE = null; NAVACC = null; PRED2.n = 0; if (R.sas === 'node') R.sas = 'hold', R.hold.copy(R.q); if (why) showHint(why, 3000); nodePanel(); }

// ---------------- quick plans
function circAt(which) { // circularise at the next Ap or Pe (or at the closest point of a coming encounter)
  if (R.st !== 'fly') return; let t, b;
  if (which === 'pe' && PRED.enc && PRED.start === 0) { const k = SATS.indexOf(PRED.enc.b) + 1; let best = Infinity, bi = -1; for (let i = PRED.enc.i; i < PRED.n; i++) { if (PRED.f[i] !== k) break; const d = satPos(PRED.enc.b, PRED.t[i], _q3).distanceTo(_q1.set(PRED.p[i * 3], PRED.p[i * 3 + 1], PRED.p[i * 3 + 2])); if (d < best) { best = d; bi = i; } } if (bi < 0) return; t = PRED.t[bi]; b = PRED.enc.b; }
  else { b = domBody(R.pos); const o = orbitEl(b); t = G.t + (which === 'ap' ? o.tAp : o.tPe); if (!isFinite(t) || (which === 'ap' && o.ap === Infinity)) { showHint('No Ap: you are escaping', 2000); return; } }
  const p = NV3(), v = NV3(); stateAt(t, p, v); const r = p.distanceTo(satPos(b, t, _q3)), vr = v.clone().sub(satVel(b, t, _q3)).length();
  nodeMake(t, new V3(Math.sqrt(b.GM / r) - vr, 0, 0)); showHint('Burn node: circularise at ' + (which === 'ap' ? 'Ap' : 'Pe') + ' · ' + Math.round(Math.abs(NODE.dv.x)) + ' m/s', 3000); }
function transferTo(T) { // Hohmann-style burn from an orbit around Home to a satellite, then tuned until the predicted path meets it
  if (R.st !== 'fly') return; if (domBody(R.pos) !== PLANET) { showHint('Plan transfers from an orbit around ' + PLANET.name, 2500); return; }
  const o = orbitEl(PLANET); if (!(o.ap < T.orbit * .5) || o.pe < PLANET.atmo) { showHint('Get into a low, round orbit first', 2500); return; }
  const ph = satPhase(T), rate = 360 / o.period - 360 / T.period, wait = (((ph.now - ph.want) % 360 + 360) % 360) / rate;
  const want = Math.max(25000, T.R * .25), score = (t, dv, dn) => { nodeMakeQuiet(t, new V3(dv, dn, 0)); const P2 = PRED2;
    if (P2.enc) return P2.enc.b === T ? Math.abs(P2.moonPe - want) * .001 + (P2.moonPe < 3000 ? 500 : 0) : 1e8; if (P2.imp && P2.imp.b === T) return 800; return P2.close ? 1e4 + (P2.close.d - T.R) * .001 : 1e9; };
  let t0 = G.t + Math.max(60, wait); const p = NV3(), v = NV3(); stateAt(t0, p, v); const r = p.length(), dv0 = Math.sqrt(PLANET.GM * (2 / r - 2 / (r + T.orbit))) - v.length();
  let best = {s: Infinity, t: t0, dv: dv0, dn: 0};
  for (const dt of [-.03, -.015, 0, .015, .03]) for (const k of [.99, 1, 1.01]) for (const dn of [-60, 0, 60]) { const sc = score(t0 + dt * o.period, dv0 * k, dn); if (sc < best.s) best = {s: sc, t: t0 + dt * o.period, dv: dv0 * k, dn}; }
  // then refine each knob in turn, halving the step when neither direction helps
  const st = {t: o.period * .01, dv: dv0 * .005, dn: 30};
  for (let it = 0; it < 40; it++) { let moved = false; for (const k of ['t', 'dv', 'dn']) for (const sg of [1, -1]) { const c = {...best}; c[k] += sg * st[k]; c.s = score(c.t, c.dv, c.dn); if (c.s < best.s) { best = c; moved = true; break; } }
    if (!moved) { st.t *= .5; st.dv *= .5; st.dn *= .5; } if (st.dv < .05 && st.t < 1) break; }
  nodeMake(best.t, new V3(best.dv, best.dn, 0)); NAVT.b = T;
  showHint(PRED2.enc && PRED2.enc.b === T ? 'Transfer to ' + T.name + ': ' + Math.round(NODE.bv.length()) + ' m/s · meets it in ' + fmtS(PRED2.enc.t - NODE.t) + ' · Auto-burn or fly it' : 'Transfer node made: tweak prograde / normal until the path meets ' + T.name, 5000); }
function nodeMakeQuiet(t, dv) { NODE = {t, dv, bv: NV3(), auto: false, burning: false, burn: 0}; NAVACC = NV3(); nodeUpdate(); }

// ---------------- auto-burn: point at the node, warp to it, burn, stop on target
function autoStep() {
  if (!NODE || !R.on || R.st !== 'fly') return;
  const rem = navRem(), rl = rem.length(), tStart = NODE.t - NODE.burn / 2;
  if (NODE.burning || G.t >= tStart - .5) { if (rl < .35 || rem.dot(NODE.bv) < 0) { if (NODE.auto || NODE.burning) R.thr = 0; nodeKill('Burn done'); sfx && SND.c && warnTone(1100, 1); return; } }
  if (!NODE.auto) { if (R.F > 0 && G.t > tStart - 5) NODE.burning = true; return; }
  if (R.sas !== 'node') { R.sas = 'node'; R.hold.copy(R.q); }
  const ang = Math.acos(clamp(nose(_q1).dot(_q2.copy(rem).normalize()), -1, 1));
  if (!NODE.burning && G.t < tStart - 20) { if (!R.warpTo && ang < .1 && R.F === 0 && NAV.warpSet !== NODE.t) { NAV.warpSet = NODE.t; R.warpTo = tStart - 15; showHint('Auto-burn: warping to the burn', 2500); } R.thr = 0; return; }
  if (G.t >= tStart || NODE.burning) {
    if (ang < (NODE.burning ? .2 : .06)) { const S = STAGES[R.bot];
      if (!(R.fuel[R.bot] > 0) || !S.thrust) { if (R.bot < STAGES.length - 1 && STAGES.slice(R.bot + 1).some(x => x.thrust)) { stage(); showHint('Auto-burn: staged', 1500); } else { NODE.auto = false; showHint('Out of fuel: burn not finished', 3000); } return; }
      if (!R.lit) R.lit = true; const am = Math.max(.01, maxAcc()); R.thr = clamp(rl / (am * 1.2), .03, 1); NODE.burning = true; }
    else R.thr = NODE.burning ? R.thr * .5 : 0; } }

// ---------------- map: path after the burn, the node marker, clicking to add nodes
const _np = new V3(), _nq = {};
function nodeMapPos(out) { let bi = 0, bd = Infinity; for (let i = 0; i < PRED.n; i++) { const d = Math.abs(PRED.t[i] - NODE.t); if (d < bd) { bd = d; bi = i; } } return drawPoint(bi, out); }
{ const mr = mapRender; mapRender = function (dt) { mr(dt); if (!NODE) return; const M = MAPV, x = M.x, W = innerWidth, H = innerHeight, cam2 = M.cam;
    if ((NAV.upT -= dt) <= 0) { NAV.upT = .5; nodeUpdate(); }
    const prj = (p, o) => { _q3.copy(p).project(cam2); o.x = (_q3.x * .5 + .5) * W; o.y = (-_q3.y * .5 + .5) * H; o.ok = _q3.z < 1 && _q3.z > -1; return o; };
    x.save(); x.setLineDash([7, 5]); x.lineWidth = 2.2; let pf = -1, open = false;
    for (let i = 0; i < PRED2.n; i++) { drawPoint(i, _np, PRED2); prj(_np, _nq); const f = PRED2.f[i]; if (open && f !== pf) { x.stroke(); open = false; }
      if (!open) { x.beginPath(); x.strokeStyle = f > 0 ? '#ff7ad9' : '#c9b4ff'; x.moveTo(_nq.x, _nq.y); open = true; pf = f; } else if (_nq.ok) x.lineTo(_nq.x, _nq.y); }
    if (open) x.stroke(); x.restore();
    const lab = (p, txt, col) => { prj(p, _nq); if (!_nq.ok) return; x.font = '600 12px Archivo, sans-serif'; const w = x.measureText(txt).width; x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(_nq.x - w / 2 - 6, _nq.y - 28, w + 12, 17); x.fillStyle = col; x.textAlign = 'center'; x.fillText(txt, _nq.x, _nq.y - 15.5); x.textAlign = 'left'; };
    nodeMapPos(_np); prj(_np, _nq); if (_nq.ok) { x.fillStyle = '#c9b4ff'; x.strokeStyle = '#1a1030'; x.lineWidth = 2; x.beginPath(); x.moveTo(_nq.x, _nq.y - 9); x.lineTo(_nq.x + 9, _nq.y); x.lineTo(_nq.x, _nq.y + 9); x.lineTo(_nq.x - 9, _nq.y); x.closePath(); x.stroke(); x.fill(); NAV.nx = _nq.x; NAV.ny = _nq.y; }
    lab(_np, 'Burn ' + Math.round(NODE.bv.length()) + ' m/s · ' + fmtS(NODE.t - G.t), '#c9b4ff');
    if (PRED2.enc && PRED2.start === 0) lab(drawPoint(PRED2.enc.i, _np, PRED2), PRED2.enc.b.name + ' · pass ' + (PRED2.moonPe < 0 ? 'hits' : fmtD(PRED2.moonPe)), '#ff7ad9');
    else if (PRED2.close && PRED2.close.d < PRED2.close.b.orbit * .6) lab(drawPoint(PRED2.close.i, _np, PRED2), 'Closest to ' + PRED2.close.b.name + ' ' + fmtD(PRED2.close.d - PRED2.close.b.R), '#c9b4ff');
    if (PRED2.imp) lab(drawPoint(PRED2.imp.i, _np, PRED2), 'Hits ' + (PRED2.imp.b === PLANET ? 'the ground' : PRED2.imp.b.name), '#ff5a4a');
    nodeInfo(); }; }
// click your predicted path to put a node there (or click the node to select it)
{ let down = null;
  addEventListener('pointerdown', e => { if (MAPV.on && G.on && e.target === canvas) down = {x: e.clientX, y: e.clientY, m: 0}; });
  addEventListener('pointermove', e => { if (down) down.m += Math.abs(e.movementX) + Math.abs(e.movementY); });
  addEventListener('pointerup', e => { const d = down; down = null; if (!d || d.m > 6 || !MAPV.on || R.st !== 'fly') return;
    const W = innerWidth, H = innerHeight, cam2 = MAPV.cam; let bi = -1, bd = 196;
    if (NODE && NAV.nx !== undefined && Math.hypot(e.clientX - NAV.nx, e.clientY - NAV.ny) < 14) { nodePanel(); return; }
    for (let i = 1; i < PRED.n; i++) { drawPoint(i, _np); _q3.copy(_np).project(cam2); if (_q3.z > 1 || _q3.z < -1) continue; const sx = (_q3.x * .5 + .5) * W, sy = (-_q3.y * .5 + .5) * H, dd = (sx - e.clientX) ** 2 + (sy - e.clientY) ** 2; if (dd < bd) { bd = dd; bi = i; } }
    if (bi < 0) return; if (NODE && !NODE.burning) { NODE.t = PRED.t[bi]; nodeUpdate(); nodePanel(); } else nodeMake(PRED.t[bi]); }); }

// ---------------- node panel (map) + quick plan bar
function nodePanel() { const el = $('nodeP'); el.classList.toggle('hidden', !NODE || !MAPV.on); $('navQ').classList.toggle('hidden', !MAPV.on || R.st !== 'fly'); if (NODE) nodeInfo(true); }
let niT = 0;
function nodeInfo(force) { if (!NODE || (!force && (niT -= G.dt || .016) > 0)) return; niT = .15;
  $('nPx').textContent = Math.round(NODE.dv.x); $('nPn').textContent = Math.round(NODE.dv.y); $('nPr').textContent = Math.round(NODE.dv.z);
  const dv = NODE.bv.length(), L = ['Δv <b>' + Math.round(dv) + ' m/s</b> · burn <b>' + fmtS(NODE.burn) + '</b>' + (stageDv() < dv ? ' <span style="color:#ff8a6a">(this stage has ' + Math.round(stageDv()) + ')</span>' : ''), 'In <b>' + fmtS(NODE.t - G.t) + '</b> · start <b>' + fmtS(NODE.t - NODE.burn / 2 - G.t) + '</b> before'];
  const P2 = PRED2, b2 = P2.n ? BODIES[P2.f[0]] : PLANET; if (P2.n) { const o2 = orbitEl(b2, _q1.set(P2.p[0], P2.p[1], P2.p[2]), NODE.vel.clone().add(NODE.bv), NODE.t); L.push('After: Ap <b>' + (o2.ap === Infinity ? 'escape' : fmtD(o2.ap)) + '</b> · Pe <b>' + fmtD(o2.pe) + '</b>'); }
  if (P2.enc) L.push('<span style="color:#ff7ad9">Meets ' + P2.enc.b.name + '</span> · passes <b>' + (P2.moonPe < 0 ? 'into it' : fmtD(P2.moonPe)) + '</b>');
  $('nInfo').innerHTML = L.join('<br>'); $('nAuto').classList.toggle('on', NODE.auto); $('nAuto').textContent = NODE.auto ? 'Auto-burn on' : 'Auto-burn'; }
{ const P = $('nodeP'), bump = (ax, s) => { if (!NODE || NODE.burning) return; NODE.dv[ax] += s * NAV.step; nodeUpdate(); nodeInfo(true); };
  let rep = null; const stop = () => { clearTimeout(rep); clearInterval(rep); rep = null; };
  P.querySelectorAll('[data-a]').forEach(b => { b.onpointerdown = e => { e.preventDefault(); e.stopPropagation(); bump(b.dataset.a, +b.dataset.s); stop(); rep = setTimeout(() => { rep = setInterval(() => bump(b.dataset.a, +b.dataset.s), 70); }, 350); }; b.onpointerup = b.onpointerleave = stop; });
  P.querySelectorAll('[data-a]').forEach(b => b.onwheel = e => { e.preventDefault(); bump(b.dataset.a, e.deltaY < 0 ? 1 : -1); });
  P.querySelectorAll('[data-st]').forEach(b => b.onclick = e => { e.stopPropagation(); NAV.step = +b.dataset.st; P.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); });
  P.querySelectorAll('[data-tt]').forEach(b => b.onpointerdown = e => { e.preventDefault(); e.stopPropagation(); if (!NODE || NODE.burning) return; const o = orbitEl(domBody(R.pos)); const stp = isFinite(o.period) ? o.period / 120 : 60; NODE.t = Math.max(G.t + 5, NODE.t + +b.dataset.tt * stp * NAV.step / 10); nodeUpdate(); nodeInfo(true); });
  $('nDel').onclick = e => { e.stopPropagation(); nodeKill(); };
  $('nWarp').onclick = e => { e.stopPropagation(); if (NODE) { R.warpTo = NODE.t - NODE.burn / 2 - 20; showHint('Warping to the burn · any time key stops', 2000); } };
  $('nAuto').onclick = e => { e.stopPropagation(); if (!NODE) return; NODE.auto = !NODE.auto; NAV.warpSet = 0; nodeInfo(true); showHint(NODE.auto ? 'Auto-burn: the ship points at the node, warps there, burns and stops on target. Stay in the Pilot seat' : 'Auto-burn off', 4000); };
  $('nX').onclick = e => { e.stopPropagation(); P.classList.add('hidden'); };
  $('qAp').onclick = () => circAt('ap'); $('qPe').onclick = () => circAt('pe'); $('qTr').onclick = () => transferTo(navTarget());
  $('qWAp').onclick = () => warpApPe('ap'); $('qWPe').onclick = () => warpApPe('pe');
  $('qWS').onclick = () => { const e2 = PRED.enc && PRED.enc.t > G.t ? PRED.enc : PRED.exit && PRED.exit.t > G.t ? PRED.exit : null; if (!e2) { showHint('No change of pull ahead', 1800); return; } R.warpTo = e2.t + 1; showHint('Warping to ' + (PRED.enc === e2 ? e2.b.name + "'s pull" : 'leaving ' + e2.b.name), 2000); }; }
function warpApPe(w) { const o = orbitEl(domBody(R.pos)), dt = w === 'ap' ? o.tAp : o.tPe; if (!isFinite(dt) || dt < 20) { showHint('Nothing to warp to', 1500); return; } if (R.F > 0) { showHint('Cut the engine first (X)', 2000); return; } R.warpTo = G.t + dt - 15; showHint('Warping to ' + (w === 'ap' ? 'Ap' : 'Pe'), 1800); }
{ const tg = mapToggle; mapToggle = function (on) { tg(on); nodePanel(); }; }
{ const wn = warpNext; warpNext = function () { if (NODE && R.on && R.st === 'fly' && NODE.t - NODE.burn / 2 - G.t > 30) { if (R.F > 0) { showHint('Cut the engine first (X)', 2000); return; } R.warpTo = NODE.t - NODE.burn / 2 - 20; showHint('Warping to the burn node · any time key stops', 2500); return; } wn(); }; }

// ---------------- flight HUD: node line + burn marker
const _mk2 = new V3();
function navHud() { const el = $('fN'), mk = $('mNd'); if (!NODE || R.st !== 'fly' || !R.on) { el.classList.add('hidden'); mk.classList.add('hidden'); return; }
  if ((NAV.upT -= G.dt || .016) <= 0 && !NODE.burning) { NAV.upT = .5; nodeUpdate(); }
  const rem = navRem(), tS = NODE.t - NODE.burn / 2 - G.t; el.classList.remove('hidden');
  setTxt('fN', (NODE.burning ? 'Burning · ' + Math.round(rem.length()) + ' m/s left' : 'Node ' + (tS > 0 ? 'start in ' + fmtS(tS) : 'BURN NOW') + ' · ' + Math.round(rem.length()) + ' m/s · ' + fmtS(NODE.burn)) + (NODE.auto ? ' · AUTO' : ' · 6 point · N warp'));
  el.classList.toggle('now', tS <= 0 || NODE.burning);
  _mk2.copy(rem).normalize(); const vis = rem.lengthSq() > .01 && _mk2.dot(cam.getWorldDirection(_q1)) > .05; mk.classList.toggle('hidden', !vis); // the camera sits at the origin (floating origin)
  if (vis) { _mk2.multiplyScalar(1e4).project(cam); mk.style.left = ((_mk2.x * .5 + .5) * innerWidth) + 'px'; mk.style.top = ((-_mk2.y * .5 + .5) * innerHeight) + 'px'; } }
// ascent guide (5) as a launch autopilot: stages when a stage runs dry, cuts the engine once Ap reaches 80 km, then plans and flies the circularise burn
function guideAuto() {
  if (R.sas !== 'guide' || !R.on || R.st !== 'fly' || domBody(R.pos) !== PLANET) { if (R.st !== 'fly') GUIDE.coast = false; return; }
  if (STAGES[R.bot].thrust && !(R.fuel[R.bot] > 0) && R.bot < STAGES.length - 1 && STAGES[R.bot + 1].thrust) { stage(); showHint('Guide: stage dropped, next engine lit', 2000); return; }
  const o = orbitEl(PLANET);
  if (!GUIDE.coast && o.ap > GUIDE.ap && R.thr > 0 && o.pe < PLANET.atmo) { R.thr = 0; GUIDE.coast = true; showHint('Ap is at ' + Math.round(GUIDE.ap / 1000) + ' km: engine off. Coasting out of the air, then the guide makes a circularise burn', 5000); }
  if (GUIDE.coast && altAbove() > PLANET.atmo + 500 && !NODE) { GUIDE.coast = false; if (o.pe < PLANET.atmo) { circAt('ap'); if (NODE) { NODE.auto = true; NAV.warpSet = 0; showHint('Circularise burn planned at Ap · Auto-burn on (turn it off in the map, M)', 4000); } } } }
{ const s0 = FLIGHT.step; FLIGHT.step = dt => { s0(dt); guideAuto(); autoStep(); }; }
{ const h0 = FLIGHT.hud; FLIGHT.hud = dt => { h0(dt); navHud(); }; }
{ const hh = FLIGHT.hideHud; FLIGHT.hideHud = () => { hh(); $('mNd').classList.add('hidden'); }; }

// ---------------- time warp bar (click it, or , . keys) with the reason it is capped
function warpBar() { const el = $('warpW'); if (!G.on) { el.classList.add('hidden'); return; } el.classList.remove('hidden');
  const dots = el.querySelectorAll('i'); dots.forEach((d, i) => d.classList.toggle('on', i <= G.wi)); setTxt('wwT', '×' + G.warp.toLocaleString('en') + (R.warpTo ? ' →' : '')); }
{ const el = $('warpW'); el.innerHTML = '<button id="wwD" title="Slower (,)" aria-label="Slower"><span class="ico i-l"></span></button><span id="wwT">×1</span>' + WARPS.map((w, i) => '<i data-i="' + i + '" title="×' + w + '"></i>').join('') + '<button id="wwU" title="Faster (.)" aria-label="Faster"><span class="ico i-r"></span></button><button id="wwN" title="Warp to the next event: burn node, Ap or Pe (N)">N</button>';
  $('wwD').onclick = e => { e.stopPropagation(); setWarp(G.wi - 1); }; $('wwU').onclick = e => { e.stopPropagation(); setWarp(G.wi + 1); }; $('wwN').onclick = e => { e.stopPropagation(); warpNext(); };
  el.querySelectorAll('i').forEach(d => d.onclick = e => { e.stopPropagation(); setWarp(+d.dataset.i); }); }
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = dt => { v0(dt); warpBar(); }; }
Object.assign(window.YE, {nodeMake, nodeKill, circAt, transferTo, stateAt, PRED2, navRem, SATS, NAVT}); Object.defineProperty(window.YE, 'NODE', {get: () => NODE});
