'use strict';
// YeShip navigation, KSP style (rework 26 Nov 2026; first version 25 Nov): manoeuvre (burn) nodes planned in the map,
// up to 3 chained nodes (each one plans from the path after the one before), a drag gizmo on the selected node
// (prograde / retrograde, normal / anti-normal, radial out / in; drag the diamond to slide it along the path),
// the path after each burn, the burn marker on screen and on the attitude dial, SAS 6 = point at the node,
// auto-burn, quick plans (circularise, transfer), and time warp: pick a rate, see why it is capped, "Warp to…" menu,
// "Warp here" on any point of the path. Alt frees the mouse in flight so the bars can be clicked.
// Loaded after world.js, before station.js. Uses PRED/predict/mkPred/drawPoint/MAPV/navTarget from mission.js.

let NODE = null; // the next node = NODES[0] (other files read NODE): {t, dv: V3(prograde, normal, radial) m/s, bv: inertial burn vector, b: body, burn: s, auto, burning, pred, pos, vel, basis}
const NODES = [], NODE_MAX = 3, NV3 = () => new V3();
const _q1 = new V3(), _q2 = new V3(), _q3 = new V3(), _q4 = new V3(), _q5 = new V3();
const NAV = {step: 10, upT: 0, upAt: 0, dirty: false, warpSet: 0, sel: 0, drag: null, hov: null, scr: [], handles: [], pop: null, free: false, capKey: ''};

// coast from a state to time t with the engine off (same physics as the map prediction)
function stateFrom(p0, v0, t0, t, pos, vel) {
  pos.copy(p0); vel.copy(v0); let tt = t0; const a = gravAt(pos, tt, NV3()); let n = 0;
  while (tt < t - 1e-6 && n++ < 60000) { const rp = pos.length(); let hm = Math.sqrt(rp * rp * rp / PLANET.GM);
    for (const b of SATS) { const r = satPos(b, tt, _q3).distanceTo(pos); hm = Math.min(hm, Math.sqrt(r * r * r / b.GM)); }
    const h = Math.min(clamp(.004 * hm, .05, 600), t - tt); vel.addScaledVector(a, h / 2); pos.addScaledVector(vel, h); tt += h; gravAt(pos, tt, a); vel.addScaledVector(a, h / 2); }
}
function stateAt(t, pos, vel) { stateFrom(R.pos, R.vel, G.t, t, pos, vel); }
// prograde / normal / radial-out directions at a point (relative to the body whose pull it is in)
function nodeBasis(pos, vel, t, pro, nrm, rad) { const b = BODIES[domAt(pos, t)], r = pos.clone().sub(satPos(b, t, _q3)), v = vel.clone().sub(satVel(b, t, _q3));
  pro.copy(v).normalize(); nrm.crossVectors(r, v).normalize(); rad.crossVectors(pro, nrm).normalize(); return b; }
function navRem() { return NODE ? _q4.copy(NODE.bv).sub(NAVACC || _q3.set(0, 0, 0)) : _q4.set(0, 0, 0); } // burn still to do (inertial)

// ---------------- the node list
function newNode(t, dv, pred) { return {t, dv: dv || NV3(), bv: NV3(), auto: false, burning: false, burn: 0, pred: pred || mkPred(), pos: null, vel: null, basis: [NV3(), NV3(), NV3()]}; }
function syncN() { NODE = NODES[0] || null; if (!NODE) NAVACC = null; else if (!NAVACC) NAVACC = NV3(); NAV.sel = clamp(NAV.sel, 0, Math.max(0, NODES.length - 1)); }
function nodeUpdate() { // every node plans from the path after the one before it
  syncN(); NAV.dirty = false; NAV.upAt = performance.now(); let p0 = null, v0 = null, t0 = G.t;
  NODES.forEach((N, k) => { const p = NV3(), v = NV3(), tn = Math.max(N.t, k ? t0 : G.t);
    if (k === 0) stateAt(tn, p, v); else stateFrom(p0, v0, t0, tn, p, v);
    const [pro, nrm, rad] = N.basis; N.b = nodeBasis(p, v, tn, pro, nrm, rad);
    if (!N.burning) N.bv.copy(pro).multiplyScalar(N.dv.x).addScaledVector(nrm, N.dv.y).addScaledVector(rad, N.dv.z);
    N.pos = p; N.vel = v; N.burn = burnTime(N.bv.length()); predict(N.pred, p, v.clone().add(N.bv), tn); p0 = p; v0 = v.clone().add(N.bv); t0 = tn; }); }
function nodeMake(t, dv) { nodeMakeQuiet(t, dv); NAV.sel = 0; nodePanel(); } // a fresh plan: replaces all nodes
function nodeMakeQuiet(t, dv) { const pr = NODES[0] ? NODES[0].pred : null; NODES.length = 0; NODES.push(newNode(t, dv || NV3(), pr)); NAVACC = NV3(); nodeUpdate(); }
function nodeAdd(t, dv) { if (NODES.length >= NODE_MAX) { showHint('Up to ' + NODE_MAX + ' burn nodes', 1800); return null; } const N = newNode(t, dv); let k = NODES.findIndex(o => o.t > t); if (k < 0) k = NODES.length;
  if (k === 0 && NODE && NODE.burning) { showHint('Finish the burn first', 1800); return null; } NODES.splice(k, 0, N); if (k === 0) NAVACC = NV3(); NAV.sel = k; nodeUpdate(); nodePanel(); return N; }
function nodeDel(k) { if (!NODES[k]) return; NODES.splice(k, 1); if (k === 0) NAVACC = NODES.length ? NV3() : null; if (!NODES.length && R.sas === 'node') { R.sas = 'hold'; R.hold.copy(R.q); } nodeUpdate(); nodePanel(); }
function nodeKill(why) { NODES.length = 0; syncN(); if (R.sas === 'node') { R.sas = 'hold'; R.hold.copy(R.q); } if (why) showHint(why, 3000); nodePanel(); } // all nodes gone (reset, crash, sync)
function nodeDone(why) { NODES.shift(); NAV.sel = 0; NAV.warpSet = 0; NAVACC = NODES.length ? NV3() : null; syncN(); if (!NODE && R.sas === 'node') { R.sas = 'hold'; R.hold.copy(R.q); }
  if (NODE) nodeUpdate(); showHint(why + (NODE ? ' · next node in ' + fmtS(NODE.t - G.t) : ''), 3000); nodePanel(); }
const selNode = () => NODES[NAV.sel] || null;

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
  const want = Math.max(25000, T.R * .25), score = (t, dv, dn) => { nodeMakeQuiet(t, new V3(dv, dn, 0)); const P2 = NODE.pred;
    if (P2.enc) return P2.enc.b === T ? Math.abs(P2.moonPe - want) * .001 + (P2.moonPe < 3000 ? 500 : 0) : 1e8; if (P2.imp && P2.imp.b === T) return 800; return P2.close ? 1e4 + (P2.close.d - T.R) * .001 : 1e9; };
  let t0 = G.t + Math.max(60, wait); const p = NV3(), v = NV3(); stateAt(t0, p, v); const r = p.length(), dv0 = Math.sqrt(PLANET.GM * (2 / r - 2 / (r + T.orbit))) - v.length();
  let best = {s: Infinity, t: t0, dv: dv0, dn: 0};
  for (const dt of [-.03, -.015, 0, .015, .03]) for (const k of [.99, 1, 1.01]) for (const dn of [-60, 0, 60]) { const sc = score(t0 + dt * o.period, dv0 * k, dn); if (sc < best.s) best = {s: sc, t: t0 + dt * o.period, dv: dv0 * k, dn}; }
  const st = {t: o.period * .01, dv: dv0 * .005, dn: 30}; // then refine each knob in turn, halving the step when neither direction helps
  for (let it = 0; it < 40; it++) { let moved = false; for (const k of ['t', 'dv', 'dn']) for (const sg of [1, -1]) { const c = {...best}; c[k] += sg * st[k]; c.s = score(c.t, c.dv, c.dn); if (c.s < best.s) { best = c; moved = true; break; } }
    if (!moved) { st.t *= .5; st.dv *= .5; st.dn *= .5; } if (st.dv < .05 && st.t < 1) break; }
  nodeMake(best.t, new V3(best.dv, best.dn, 0)); NAVT.b = T; const P2 = NODE.pred;
  showHint(P2.enc && P2.enc.b === T ? 'Transfer to ' + T.name + ': ' + Math.round(NODE.bv.length()) + ' m/s · meets it in ' + fmtS(P2.enc.t - NODE.t) + ' · Auto-burn or fly it' : 'Transfer node made: drag the handles until the path meets ' + T.name, 5000); }

// ---------------- burning: manual (the node cuts the throttle when the burn is done) or auto (point, warp, burn, stop on target)
function autoStep() {
  if (!NODE || !R.on || R.st !== 'fly') return;
  const rem = navRem(), rl = rem.length(), tStart = NODE.t - NODE.burn / 2;
  if (NODE.burning || G.t >= tStart - .5) { if (rl < .2 || (NODE.burning && rem.dot(NODE.bv) < 0)) { if (NODE.auto || NODE.burning) R.thr = 0; nodeDone('Burn done'); sfx && SND.c && warnTone(1100, 1); return; } }
  if (!NODE.auto) { if (R.F > 0 && G.t > tStart - 30) NODE.burning = true; return; }
  if (R.sas !== 'node') { R.sas = 'node'; R.hold.copy(R.q); }
  const ang = Math.acos(clamp(nose(_q1).dot(_q2.copy(rem).normalize()), -1, 1));
  if (!NODE.burning && G.t < tStart - 20) { if (!R.warpTo && ang < .1 && R.F === 0 && NAV.warpSet !== NODE.t) { NAV.warpSet = NODE.t; warpToT(tStart - 15, 'the burn'); } R.thr = 0; return; }
  if (G.t >= tStart || NODE.burning) {
    if (ang < (NODE.burning ? .2 : .06)) { const S = STAGES[R.bot];
      if (!(R.fuel[R.bot] > 0) || !S.thrust) { if (R.bot < STAGES.length - 1 && STAGES.slice(R.bot + 1).some(x => x.thrust)) { stage(); showHint('Auto-burn: staged', 1500); } else { NODE.auto = false; showHint('Out of fuel: burn not finished', 3000); } return; }
      if (!R.lit) { R.lit = true; R.shut = false; } const am = Math.max(.01, maxAcc()); R.thr = clamp(rl / (am * 1.5), .02, 1); NODE.burning = true; } // throttles down over the last ~1.5 s
    else R.thr = NODE.burning ? R.thr * .5 : 0; } }

// ---------------- map: paths after each burn, node markers, the gizmo, clicks on the path
const _np = new V3(), _nq = {}, _nm = new V3();
const COL = {x: '#4d7a12', y: '#7c3aa8', z: '#1a6f99'};
function nodeBase(k) { return k === 0 ? PRED : NODES[k - 1].pred; } // the path a node sits on
function nodeMapPos(k, out) { const N = NODES[k], P_ = nodeBase(k); let bi = 0, bd = Infinity; for (let i = 0; i < P_.n; i++) { const d = Math.abs(P_.t[i] - N.t); if (d < bd) { bd = d; bi = i; } } return P_.n ? drawPoint(bi, out, P_) : out.copy(N.pos || R.pos).multiplyScalar(.001); }
const mprj = (p, o) => { _q3.copy(p).project(MAPV.cam); o.x = (_q3.x * .5 + .5) * innerWidth; o.y = (-_q3.y * .5 + .5) * innerHeight; o.ok = _q3.z < 1 && _q3.z > -1; return o; };
function navMap(dt) {
  NAV.scr.length = 0; NAV.handles.length = 0; if (!NODES.length || R.st !== 'fly') return;
  const x = MAPV.x, now = performance.now();
  const d = NAV.drag, N0 = d && NODES[d.k]; if (d && d.ax && N0 && !N0.burning) { const pl = Math.abs(d.pull) < 5 ? 0 : Math.sign(d.pull) * Math.pow(Math.min(1, (Math.abs(d.pull) - 5) / 110), 2) * 250 * (d.fine ? .1 : 1); if (pl) { N0.dv[d.ax] += d.s * pl * Math.min(dt, .1); NAV.dirty = true; } }
  if ((NAV.dirty && now - NAV.upAt > 90) || now - NAV.upAt > 500) nodeUpdate();
  // paths: each node's path runs until the next node
  NODES.forEach((N, k) => { const P2 = N.pred, tEnd = NODES[k + 1] ? NODES[k + 1].t : Infinity, sel = k === NAV.sel; x.save(); x.setLineDash([7, 5]); x.lineWidth = sel ? 2.4 : 1.6; x.globalAlpha = sel ? 1 : .7; let pf = -1, open = false;
    for (let i = 0; i < P2.n; i++) { if (P2.t[i] > tEnd) break; drawPoint(i, _np, P2); mprj(_np, _nq); const f = P2.f[i]; if (open && f !== pf) { x.stroke(); open = false; }
      if (!open) { x.beginPath(); x.strokeStyle = f > 0 ? '#ff7ad9' : '#c9b4ff'; x.moveTo(_nq.x, _nq.y); open = true; pf = f; } else if (_nq.ok) x.lineTo(_nq.x, _nq.y); }
    if (open) x.stroke(); x.restore(); });
  const lab = (p, txt, col, dy = 0) => { mprj(p, _nq); if (!_nq.ok) return; x.font = '600 12px Archivo, sans-serif'; const w = x.measureText(txt).width, yy = _nq.y - 29 + dy; x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(_nq.x - w / 2 - 13, yy + 2, w + 24, 18); x.fillStyle = '#F3F3F0'; x.fillRect(_nq.x - w / 2 - 14, yy, w + 24, 18); x.fillStyle = col; x.fillRect(_nq.x - w / 2 - 8, yy + 6, 6, 6); x.fillStyle = '#121314'; x.textAlign = 'center'; x.fillText(txt, _nq.x + 4, yy + 13.5); x.textAlign = 'left'; };
  NODES.forEach((N, k) => { nodeMapPos(k, _nm); mprj(_nm, _nq); if (!_nq.ok) return; const sel = k === NAV.sel, s = sel ? 10 : 8; NAV.scr[k] = {x: _nq.x, y: _nq.y};
    x.fillStyle = sel ? '#D8342A' : '#c9b4ff'; x.strokeStyle = '#121314'; x.lineWidth = 2; x.beginPath(); x.moveTo(_nq.x, _nq.y - s); x.lineTo(_nq.x + s, _nq.y); x.lineTo(_nq.x, _nq.y + s); x.lineTo(_nq.x - s, _nq.y); x.closePath(); x.stroke(); x.fill();
    lab(_nm, (NODES.length > 1 ? (k + 1) + ' · ' : '') + Math.round(N.bv.length()) + ' m/s · ' + (N.t > G.t ? 'in ' + fmtS(N.t - G.t) : 'now'), sel ? '#D8342A' : '#c9b4ff', sel ? -50 : 0); });
  const L = NODES[NODES.length - 1], P2 = L.pred;
  if (P2.enc && P2.start === 0) lab(drawPoint(P2.enc.i, _np, P2), P2.enc.b.name + ' · pass ' + (P2.moonPe < 0 ? 'hits' : fmtD(P2.moonPe)), '#ff7ad9');
  else if (P2.close && P2.close.d < P2.close.b.orbit * .6) lab(drawPoint(P2.close.i, _np, P2), 'Closest to ' + P2.close.b.name + ' ' + fmtD(P2.close.d - P2.close.b.R), '#c9b4ff');
  if (P2.imp) lab(drawPoint(P2.imp.i, _np, P2), 'Hits ' + (P2.imp.b === PLANET ? 'the ground' : P2.imp.b.name), '#ff5a4a');
  // gizmo on the selected node: six handles along its burn directions, as seen from the map camera
  const S = selNode(), sc = NAV.scr[NAV.sel]; if (S && sc && !S.burning) { nodeMapPos(NAV.sel, _nm); const ds = MAPV.cam.position.distanceTo(_nm) * .04;
    let ang0 = 0; for (const [ax, i] of [['x', 0], ['y', 1], ['z', 2]]) for (const s of [1, -1]) { _q5.copy(S.basis[i]).multiplyScalar(s * ds).add(_nm); mprj(_q5, _nq); let ux = _nq.x - sc.x, uy = _nq.y - sc.y, l = Math.hypot(ux, uy);
      if (l < 3) { ang0 += 1.05; ux = Math.cos(ang0); uy = Math.sin(ang0); l = 1; } ux /= l; uy /= l; const pull = d && d.ax === ax && d.s === s ? clamp(d.pull, -40, 70) : 0, r = 50 + pull, hx = sc.x + ux * r, hy = sc.y + uy * r;
      NAV.handles.push({ax, s, x: hx, y: hy, ux, uy});
      const hot = (NAV.hov && NAV.hov.ax === ax && NAV.hov.s === s) || pull; x.strokeStyle = COL[ax]; x.globalAlpha = .55; x.lineWidth = 1; x.beginPath(); x.moveTo(sc.x + ux * 12, sc.y + uy * 12); x.lineTo(hx, hy); x.stroke(); x.globalAlpha = 1;
      x.lineWidth = hot ? 2.6 : 2; x.fillStyle = s > 0 ? COL[ax] : '#F3F3F0'; x.beginPath();
      if (ax === 'y') { const a = Math.atan2(uy, ux); for (let q = 0; q < 3; q++) { const aa = a + q * 2.094; x[q ? 'lineTo' : 'moveTo'](hx + Math.cos(aa) * 9, hy + Math.sin(aa) * 9); } x.closePath(); }
      else x.arc(hx, hy, hot ? 9 : 8, 0, 7);
      x.fill(); x.stroke(); x.fillStyle = s > 0 ? '#F3F3F0' : COL[ax];
      if (ax === 'x') { if (s > 0) { x.beginPath(); x.arc(hx, hy, 2.4, 0, 7); x.fill(); } else { x.beginPath(); x.moveTo(hx - 4, hy - 4); x.lineTo(hx + 4, hy + 4); x.moveTo(hx + 4, hy - 4); x.lineTo(hx - 4, hy + 4); x.stroke(); } }
      if (ax === 'z') { x.beginPath(); for (let q = 0; q < 4; q++) { const aa = q * Math.PI / 2 + .785; x.moveTo(hx + Math.cos(aa) * (s > 0 ? 3 : 8), hy + Math.sin(aa) * (s > 0 ? 3 : 8)); x.lineTo(hx + Math.cos(aa) * (s > 0 ? 8 : 4), hy + Math.sin(aa) * (s > 0 ? 8 : 4)); } x.stroke(); } }
    if (d && d.ax) { const h = NAV.handles.find(q => q.ax === d.ax && q.s === d.s); if (h) { x.font = '700 12px Archivo, sans-serif'; x.fillStyle = '#121314'; x.fillText((d.s > 0 ? '+' : '−') + ' ' + {x: 'prograde', y: 'normal', z: 'radial'}[d.ax] + ' ' + Math.round(S.dv[d.ax]) + ' m/s', h.x + 14, h.y - 10); } } }
  nodeInfo(); }
// path picking: nearest drawn point to the mouse on the base path (before the first node) or on a node's own stretch
function pathPick(mx, my, only) { let best = null, bd = 196; const W = innerWidth, H = innerHeight, cam2 = MAPV.cam;
  const scan = (P_, k, t0, t1) => { for (let i = 1; i < P_.n; i++) { const t = P_.t[i]; if (t <= t0) continue; if (t >= t1) break; drawPoint(i, _np, P_); _q3.copy(_np).project(cam2); if (_q3.z > 1 || _q3.z < -1) continue;
      const dd = ((_q3.x * .5 + .5) * W - mx) ** 2 + ((-_q3.y * .5 + .5) * H - my) ** 2; if (dd < bd) { bd = dd; best = {k, t, i}; } } };
  if (only === undefined || only === -1) scan(PRED, -1, G.t + 5, NODES[0] ? NODES[0].t : Infinity);
  NODES.forEach((N, k) => { if (only === undefined || only === k) scan(N.pred, k, N.t + 5, NODES[k + 1] ? NODES[k + 1].t : Infinity); }); return best; }
function navPop(show, mx, my, pk) { const el = $('navPop'); if (!el) return; if (!show) { el.classList.add('hidden'); NAV.pop = null; return; } NAV.pop = pk;
  el.innerHTML = '<div class="pt">' + fmtS(pk.t - G.t) + ' from now</div><button data-p="add"' + (NODES.length >= NODE_MAX ? ' disabled' : '') + '>Add burn node</button><button data-p="warp">Warp here</button>';
  el.style.left = Math.min(innerWidth - 170, mx + 12) + 'px'; el.style.top = Math.min(innerHeight - 110, my + 8) + 'px'; el.classList.remove('hidden');
  el.querySelector('[data-p="add"]').onclick = e => { e.stopPropagation(); navPop(false); nodeAdd(pk.t); };
  el.querySelector('[data-p="warp"]').onclick = e => { e.stopPropagation(); navPop(false); warpToT(pk.t, 'that point'); }; }
{ const near = (e, list, r) => { let b = null, bd = r * r; list.forEach((h, i) => { if (!h) return; const dd = (h.x - e.clientX) ** 2 + (h.y - e.clientY) ** 2; if (dd < bd) { bd = dd; b = i; } }); return b; };
  const mapHit = e => MAPV.on && G.on && R.st === 'fly' && e.target === canvas;
  let down = null;
  addEventListener('pointerdown', e => { if (!mapHit(e)) return; navPop(false); down = {x: e.clientX, y: e.clientY, m: 0};
    const hi = near(e, NAV.handles, 13); if (hi !== null && selNode() && !selNode().burning) { const h = NAV.handles[hi]; NAV.drag = {k: NAV.sel, ax: h.ax, s: h.s, ux: h.ux, uy: h.uy, x0: e.clientX, y0: e.clientY, pull: 0, fine: e.altKey}; e.stopImmediatePropagation(); return; }
    const ni = near(e, NAV.scr, 12); if (ni !== null) { NAV.sel = ni; NAV.drag = {k: ni, move: true, x0: e.clientX, y0: e.clientY, m: 0}; nodePanel(); e.stopImmediatePropagation(); } }, true);
  addEventListener('mousemove', e => { if (NAV.drag) e.stopImmediatePropagation(); }, true); // no map turning while dragging the gizmo
  addEventListener('pointermove', e => { if (down) down.m += Math.abs(e.movementX) + Math.abs(e.movementY); const d = NAV.drag;
    if (d) { e.stopImmediatePropagation(); if (d.ax) d.pull = (e.clientX - d.x0) * d.ux + (e.clientY - d.y0) * d.uy;
      else { d.m += Math.abs(e.movementX) + Math.abs(e.movementY); const N = NODES[d.k]; if (d.m > 4 && N && !N.burning) { const pk = pathPick(e.clientX, e.clientY, d.k - 1); if (pk) { N.t = clamp(pk.t, d.k ? NODES[d.k - 1].t + 5 : G.t + 5, NODES[d.k + 1] ? NODES[d.k + 1].t - 5 : Infinity); NAV.dirty = true; } } } return; }
    if (!MAPV.on || e.buttons) return; const hi = near(e, NAV.handles, 13); NAV.hov = hi !== null ? NAV.handles[hi] : null; canvas.style.cursor = NAV.hov || near(e, NAV.scr, 12) !== null ? 'grab' : ''; }, true);
  addEventListener('pointerup', e => { const d = NAV.drag, dn = down; down = null; if (d) { NAV.drag = null; NAV.dirty = true; e.stopImmediatePropagation(); return; }
    if (!dn || dn.m > 6 || !mapHit(e)) return; const pk = pathPick(e.clientX, e.clientY); if (pk) navPop(true, e.clientX, e.clientY, pk); }, true);
  addEventListener('wheel', e => { if (!MAPV.on || !NAV.hov || !selNode() || selNode().burning) return; e.preventDefault(); e.stopImmediatePropagation(); const N = selNode(); N.dv[NAV.hov.ax] += NAV.hov.s * (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? .1 : 1); NAV.dirty = true; }, {capture: true, passive: false}); }
{ const mr = mapRender; mapRender = function (dt) { mr(dt); navMap(dt); }; }

// ---------------- node panel (map) + quick plan bar
function nodePanel() { const el = $('nodeP'); el.classList.toggle('hidden', !NODES.length || !MAPV.on); $('navQ').classList.toggle('hidden', !MAPV.on || R.st !== 'fly'); if (!MAPV.on) navPop(false); if (NODES.length) nodeInfo(true); }
let niT = 0;
function nodeInfo(force) { const N = selNode(); if (!N || (!force && (niT -= G.dt || .016) > 0)) return; niT = .15;
  $('nPx').textContent = Math.round(N.dv.x); $('nPn').textContent = Math.round(N.dv.y); $('nPr').textContent = Math.round(N.dv.z);
  $('nTitle').textContent = NODES.length > 1 ? 'Burn node ' + (NAV.sel + 1) + ' of ' + NODES.length : 'Burn node'; $('nPrev').disabled = NAV.sel === 0; $('nNext').disabled = NAV.sel >= NODES.length - 1;
  const dv = N.bv.length(), L = ['Δv <b>' + Math.round(dv) + ' m/s</b> · burn <b>' + fmtS(N.burn) + '</b>' + (NAV.sel === 0 && stageDv() < dv ? ' <span class="warn">(this stage has ' + Math.round(stageDv()) + ')</span>' : ''), 'Start burning in <b>' + fmtS(Math.max(0, N.t - N.burn / 2 - G.t)) + '</b>'];
  { const tm = $('nTm'); if (tm) tm.textContent = 'in ' + fmtS(Math.max(0, N.t - G.t)); }
  const P2 = N.pred; if (P2.n && N.vel) { const b2 = BODIES[P2.f[0]] || PLANET, o2 = orbitEl(b2, _q1.set(P2.p[0], P2.p[1], P2.p[2]), N.vel.clone().add(N.bv), N.t); L.push('After: Ap <b>' + (o2.ap === Infinity ? 'escape' : fmtD(o2.ap)) + '</b> · Pe <b>' + fmtD(o2.pe) + '</b>'); }
  if (P2.enc) L.push('<b>Meets ' + P2.enc.b.name + '</b> · passes <b>' + (P2.moonPe < 0 ? 'into it' : fmtD(P2.moonPe)) + '</b>');
  if (NODES.length > 1) L.push('All nodes <b>' + Math.round(NODES.reduce((a, o) => a + o.bv.length(), 0)) + ' m/s</b>');
  $('nInfo').innerHTML = L.map(l => '<div>' + l + '</div>').join(''); const A = $('nAuto'); A.classList.toggle('on', !!(NODE && NODE.auto)); A.textContent = NODE && NODE.auto ? 'Auto-burn on' : 'Auto-burn'; }
{ const P = $('nodeP'), bump = (ax, s) => { const N = selNode(); if (!N || N.burning) return; N.dv[ax] += s * NAV.step; nodeUpdate(); nodeInfo(true); };
  // header: which node (when there are several)
  const nh = P.querySelector('.nh'); nh.querySelector('b').id = 'nTitle'; const mkB = (id, ico, lab) => { const b = document.createElement('button'); b.id = id; b.setAttribute('aria-label', lab); b.innerHTML = '<span class="ico ' + ico + '"></span>'; nh.insertBefore(b, $('nX')); return b; };
  mkB('nPrev', 'i-l', 'Previous node').onclick = e => { e.stopPropagation(); NAV.sel = Math.max(0, NAV.sel - 1); nodeInfo(true); };
  mkB('nNext', 'i-r', 'Next node').onclick = e => { e.stopPropagation(); NAV.sel = Math.min(NODES.length - 1, NAV.sel + 1); nodeInfo(true); };
  let rep = null; const stop = () => { clearTimeout(rep); clearInterval(rep); rep = null; };
  P.querySelectorAll('[data-a]').forEach(b => { b.onpointerdown = e => { e.preventDefault(); e.stopPropagation(); bump(b.dataset.a, +b.dataset.s); stop(); rep = setTimeout(() => { rep = setInterval(() => bump(b.dataset.a, +b.dataset.s), 70); }, 350); }; b.onpointerup = b.onpointerleave = stop; });
  P.querySelectorAll('[data-a]').forEach(b => b.onwheel = e => { e.preventDefault(); bump(b.dataset.a, e.deltaY < 0 ? 1 : -1); });
  P.querySelectorAll('[data-st]').forEach(b => b.onclick = e => { e.stopPropagation(); NAV.step = +b.dataset.st; P.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); });
  P.querySelectorAll('[data-tt]').forEach(b => b.onpointerdown = e => { e.preventDefault(); e.stopPropagation(); const N = selNode(), k = NAV.sel; if (!N || N.burning) return; const o = orbitEl(domBody(R.pos)); const stp = isFinite(o.period) ? o.period / 120 : 60;
    N.t = clamp(N.t + +b.dataset.tt * stp * NAV.step / 10, k ? NODES[k - 1].t + 5 : G.t + 5, NODES[k + 1] ? NODES[k + 1].t - 5 : Infinity); nodeUpdate(); nodeInfo(true); });
  $('nDel').onclick = e => { e.stopPropagation(); nodeDel(NAV.sel); };
  $('nWarp').onclick = e => { e.stopPropagation(); const N = selNode(); if (N) warpToT(N.t - N.burn / 2 - 20, 'the burn'); };
  $('nAuto').onclick = e => { e.stopPropagation(); if (!NODE) return; NODE.auto = !NODE.auto; NAV.warpSet = 0; nodeInfo(true); showHint(NODE.auto ? 'Auto-burn: points at the next node, warps there, burns and stops on target. Stay in the Pilot seat' : 'Auto-burn off', 4000); };
  $('nX').onclick = e => { e.stopPropagation(); P.classList.add('hidden'); };
  $('qAp').onclick = () => circAt('ap'); $('qPe').onclick = () => circAt('pe'); $('qTr').onclick = () => transferTo(navTarget());
  $('qWAp').onclick = () => warpApPe('ap'); $('qWPe').onclick = () => warpApPe('pe');
  $('qWS').onclick = () => { const e2 = nextSoi(); if (!e2) { showHint('No change of pull ahead', 1800); return; } warpToT(e2.t + 1, e2.lab); };
  const pop = document.createElement('div'); pop.id = 'navPop'; pop.className = 'hidden'; $('mapUI').appendChild(pop); }
function nextSoi() { const e2 = PRED.enc && PRED.enc.t > G.t ? PRED.enc : PRED.exit && PRED.exit.t > G.t ? PRED.exit : null; return e2 && {t: e2.t, lab: PRED.enc === e2 ? e2.b.name + "'s pull" : 'leaving ' + e2.b.name}; }
function warpApPe(w) { const o = orbitEl(domBody(R.pos)), dt = w === 'ap' ? o.tAp : o.tPe; if (!isFinite(dt) || dt < 20) { showHint('Nothing to warp to', 1500); return; } warpToT(G.t + dt - 15, w === 'ap' ? 'Ap' : 'Pe'); }
{ const tg = mapToggle; mapToggle = function (on) { tg(on); nodePanel(); }; }
{ const wn = warpNext; warpNext = function () { if (NODE && R.on && R.st === 'fly' && NODE.t - NODE.burn / 2 - G.t > 30) { warpToT(NODE.t - NODE.burn / 2 - 20, 'the burn node'); return; } wn(); }; }
{ const rr = resetRocket; resetRocket = function () { rr(); R.shut = false; R.warpLbl = ''; if (NODES.length) nodeKill(); }; }

// ---------------- flight HUD: node line with a Δv bar, burn marker on screen and on the attitude dial, throttle + TWR cells
const _mk2 = new V3();
function navHud() { const el = $('fN'), mk = $('mNd'); if (!NODE || R.st !== 'fly' || !R.on) { el.classList.add('hidden'); mk.classList.add('hidden'); return; }
  if ((NAV.upT -= G.dt || .016) <= 0 && !NODE.burning) { NAV.upT = .5; nodeUpdate(); }
  const rem = navRem(), rl = rem.length(), tS = NODE.t - NODE.burn / 2 - G.t, full = Math.max(1, NODE.bv.length()); el.classList.remove('hidden');
  const txt = (NODE.burning ? 'Burning · <b>' + rl.toFixed(rl < 10 ? 1 : 0) + ' m/s</b> left' : (tS > 0 ? 'Burn in <b>T−' + fmtS(tS) + '</b>' : '<b>Burn now</b>') + ' · ' + Math.round(rl) + ' m/s · ' + fmtS(NODE.burn))
    + (NODE.auto ? ' · auto' : R.sas === 'node' ? '' : ' · <span class="key">6</span> point') + '<i class="nbar"><u style="width:' + clamp(100 - rl / full * 100, 0, 100).toFixed(1) + '%"></u></i>';
  if (el._t !== txt) { el._t = txt; el.innerHTML = txt; } el.classList.toggle('now', tS <= 0 || NODE.burning);
  _mk2.copy(rem).normalize(); const vis = rem.lengthSq() > .01 && _mk2.dot(cam.getWorldDirection(_q1)) > .05; mk.classList.toggle('hidden', !vis); // the camera sits at the origin (floating origin)
  if (vis) { _mk2.multiplyScalar(1e4).project(cam); mk.style.left = ((_mk2.x * .5 + .5) * innerWidth) + 'px'; mk.style.top = ((-_mk2.y * .5 + .5) * innerHeight) + 'px'; } }
function engHud() { if (R.st === 'dead') return; const dg = HUDE.fDg || (HUDE.fDg = document.querySelector('#fl .dg')); if (!dg) return;
  if (!$('fTh')) dg.insertAdjacentHTML('beforeend', '<div><span>Throttle</span><b id="fTh"></b></div><div><span>TWR</span><b id="fTw"></b></div>');
  const S = actS(), b = domBody(R.pos), gl = b.GM / R.pos.distanceToSquared(b.c), twr = S.thrust ? maxAcc() / gl : 0;
  setTxt('fTh', Math.round(R.thr * 100) + '%' + (!S.thrust ? '' : !R.lit && R.st !== 'pad' ? ' · off' : ''));
  setTxt('fTw', S.thrust ? twr.toFixed(2) + (R.lit && R.thr < .995 && R.thr > 0 ? ' (' + (twr * R.thr).toFixed(2) + ')' : '') : '—');
  const dv = stageDv(); setTxt('fDv', dv ? Math.round(dv).toLocaleString('en') + ' m/s · ' + fmtS(burnTime(dv)) : '—'); }
let attHook = false;
function navAttHook() { if (attHook || typeof attDial !== 'function') return; attHook = true; const a0 = attDial;
  attDial = function (dt) { a0(dt); if (ATT.t !== .1 || !NODE || R.st !== 'fly') return; const rem = navRem(); if (rem.lengthSq() < .01) return; // redrawn this call: add the burn marker
    const cv = HUDE.fAtt, x = cv.getContext('2d'), S = 96, c = S / 2, Rr = S / 2 - 4, p = attPolar(_q5.copy(rem).normalize()), px = c + Math.sin(p.az) * p.r * Rr, py = c - Math.cos(p.az) * p.r * Rr;
    x.strokeStyle = '#1a6f99'; x.fillStyle = 'rgba(26,111,153,.18)'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(px, py - 6); x.lineTo(px + 6, py); x.lineTo(px, py + 6); x.lineTo(px - 6, py); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(px, py - 9); x.lineTo(px, py - 6); x.moveTo(px, py + 6); x.lineTo(px, py + 9); x.moveTo(px - 9, py); x.lineTo(px - 6, py); x.moveTo(px + 6, py); x.lineTo(px + 9, py); x.stroke(); }; }
// ascent guide (5) as a launch autopilot: stages when a stage runs dry, cuts the engine once Ap reaches 80 km, then plans and flies the circularise burn
function guideAuto() {
  if (R.sas !== 'guide' || !R.on || R.st !== 'fly' || domBody(R.pos) !== PLANET) { if (R.st !== 'fly') GUIDE.coast = false; return; }
  if (STAGES[R.bot].thrust && !(R.fuel[R.bot] > 0) && R.bot < STAGES.length - 1 && STAGES[R.bot + 1].thrust) { stage(); showHint('Guide: stage dropped, next engine lit', 2000); return; }
  const o = orbitEl(PLANET);
  if (!GUIDE.coast && o.ap > GUIDE.ap && R.thr > 0 && o.pe < PLANET.atmo) { R.thr = 0; GUIDE.coast = true; showHint('Ap is at ' + Math.round(GUIDE.ap / 1000) + ' km: engine off. Coasting out of the air, then the guide makes a circularise burn', 5000); }
  if (GUIDE.coast && !srbBurning()) { if (R.p > 0 && o.ap < GUIDE.ap - 1500) R.thr = .3; else if (R.thr > 0 && o.ap > GUIDE.ap) R.thr = 0; } // drag eats Ap on the way out of the air: top it up
  // R.F === 0: wait for solids (they can't be throttled) to burn out, else the burn is planned on an Ap that is still growing
  if (GUIDE.coast && altAbove() > PLANET.atmo + 500 && !NODE && R.F === 0) { GUIDE.coast = false; if (o.pe < PLANET.atmo) { circAt('ap'); if (NODE) { NODE.auto = true; NAV.warpSet = 0; showHint('Circularise burn planned at Ap · Auto-burn on (turn it off in the map, M)', 4000); } } } }
{ const s0 = FLIGHT.step; FLIGHT.step = dt => { s0(dt); guideAuto(); autoStep(); }; }
{ const h0 = FLIGHT.hud; FLIGHT.hud = dt => { navAttHook(); h0(dt); navHud(); if (!$('fl').classList.contains('hidden')) engHud(); }; }
{ const hh = FLIGHT.hideHud; FLIGHT.hideHud = () => { hh(); $('mNd').classList.add('hidden'); }; }

// ---------------- time warp: pick a rate (click a step, , . keys, / for ×1), see the cap and why, "Warp to…" menu
function warpToT(t, lbl) { if (!(t > G.t + 2)) { showHint('Nothing to warp to', 1500); return false; }
  if (R.on && R.st === 'fly' && R.F > 0) { showHint('Cut the engine first (X): no time warp while burning', 2200); return false; }
  if (typeof online === 'function' && online() && !isAuth()) { Net.send({t: 'warp', i: G.wi, to: NET.auth, wt: t, wl: lbl}); showHint('Asked the pilot to warp to ' + lbl, 2000); return false; }
  R.warpTo = t; R.warpLbl = lbl; showHint('Warping to ' + lbl + ' · ' + fmtS(t - G.t) + ' · any time key stops', 2500); return true; }
function warpTargets() { const L = [], fly = R.on && R.st === 'fly';
  if (fly) { NODES.forEach((N, k) => L.push([NODES.length > 1 ? 'Burn node ' + (k + 1) : 'Next burn', N.t - N.burn / 2 - 20]));
    const b = domBody(R.pos), o = orbitEl(b); if (o.ap !== Infinity && isFinite(o.tAp)) L.push(['Apoapsis (Ap)', G.t + o.tAp - 15]); if (isFinite(o.tPe) && o.pe > -b.R * .5) L.push(['Periapsis (Pe)', G.t + o.tPe - 15]);
    const e2 = nextSoi(); if (e2) L.push([e2.lab[0].toUpperCase() + e2.lab.slice(1), e2.t + 1]); }
  L.push(['Morning at the Space Centre', G.t + ((6 - hourNow()) % 24 + 24) % 24 / 24 * PLANET.day]);
  for (const [l, s] of [['+10 min', 600], ['+1 h', 3600], ['+6 h', 21600], ['+24 h', 86400]]) L.push([l, G.t + s]);
  return L.filter(([, t]) => t > G.t + 5); }
function warpMenu(show) { const m = $('wwM'); show = show ?? m.classList.contains('hidden'); m.classList.toggle('hidden', !show); if (!show) return;
  if (document.pointerLockElement) { NAV.free = true; document.exitPointerLock(); }
  const L = warpTargets(); m.innerHTML = L.map(([l, t], i) => '<button data-w="' + i + '"><span>' + l + '</span><b>' + fmtS(t - G.t) + '</b></button>').join('');
  m.querySelectorAll('[data-w]').forEach(b => b.onclick = e => { e.stopPropagation(); const [l, t] = L[+b.dataset.w]; warpMenu(false); warpToT(t, l.startsWith('+') ? l + ' from now' : l.replace(/ \(.*\)/, '')); }); }
function warpBar() { const el = $('warpW'); if (!G.on) { el.classList.add('hidden'); return; } el.classList.remove('hidden');
  const cap = warpCap(), dots = el.querySelectorAll('i'); dots.forEach((d, i) => { d.classList.toggle('on', i <= G.wi); d.classList.toggle('no', i > cap.mx); });
  setTxt('wwT', '×' + G.warp.toLocaleString('en') + (R.warpTo ? ' →' : ''));
  const cw = R.warpTo ? 'to ' + (R.warpLbl || 'target') + ' · ' + fmtS(R.warpTo - G.t) : cap.mx < WARPS.length - 1 ? 'max ×' + WARPS[cap.mx].toLocaleString('en') + ' · ' + cap.why : '';
  if (NAV.capKey !== cw) { NAV.capKey = cw; setTxt('wwC', cw); $('wwC').classList.toggle('hidden', !cw); }
  const m = $('wwM'); if (!m.classList.contains('hidden') && (NAV.mT = (NAV.mT || 0) + (G.dt || .016)) > .5) { NAV.mT = 0; const L = warpTargets(); m.querySelectorAll('[data-w] b').forEach((b, i) => { if (L[i]) b.textContent = fmtS(L[i][1] - G.t); }); } }
{ const el = $('warpW'); el.innerHTML = '<button id="wwD" title="Slower (,)" aria-label="Slower"><span class="ico i-l"></span></button><span id="wwT">×1</span>' + WARPS.map((w, i) => '<i data-i="' + i + '" data-l="×' + w.toLocaleString('en') + '" title="×' + w.toLocaleString('en') + '"></i>').join('')
    + '<button id="wwU" title="Faster (.)" aria-label="Faster"><span class="ico i-r"></span></button><button id="wwN" title="Warp to the next event: burn node, Ap or Pe (N)"><span class="key">N</span>Next</button><button id="wwTo" title="Warp to a time or event">Warp to <span class="ico i-r" style="transform:rotate(90deg)"></span></button>'
    + '<div id="wwC" class="hidden"></div><div id="wwM" class="hidden"></div>';
  $('wwD').onclick = e => { e.stopPropagation(); setWarp(G.wi - 1); }; $('wwU').onclick = e => { e.stopPropagation(); setWarp(G.wi + 1); }; $('wwN').onclick = e => { e.stopPropagation(); warpNext(); }; $('wwTo').onclick = e => { e.stopPropagation(); warpMenu(); };
  el.querySelectorAll('i').forEach(d => d.onclick = e => { e.stopPropagation(); setWarp(+d.dataset.i); });
  addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('#warpW')) warpMenu(false); }); }
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = dt => { v0(dt); warpBar(); }; }
// keys: / back to ×1; Alt frees the mouse in flight (click the view to grab it again) so the warp bar and buttons can be clicked
addEventListener('keydown', e => { if (!G.on || G.paused || e.repeat) return;
  if (e.code === 'Slash') { setWarp(0); showHint('Time ×1', 1000); }
  if ((e.code === 'AltLeft' || e.code === 'AltRight') && !MAPV.on) { e.preventDefault(); if (document.pointerLockElement) { NAV.free = true; document.exitPointerLock(); showHint('Mouse free: click the bars · click the view to grab the mouse again', 3000); } else lockPointer(); } });
addEventListener('keyup', e => { if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); });
// losing the mouse on purpose must not pause the game (mission.js pauses on any pointer-lock loss)
addEventListener('pointerlockchange', e => { if (document.pointerLockElement) { NAV.free = false; return; } if (NAV.free) e.stopImmediatePropagation(); }, true);
{ const st = document.createElement('style'); st.textContent = `
#warpW { flex-wrap:wrap; justify-content:center; }
#warpW i { position:relative; } #warpW i.no { border-style:dashed; opacity:.45; cursor:not-allowed; }
#warpW i:hover::after { content:attr(data-l); position:absolute; top:19px; left:50%; transform:translateX(-50%); background:var(--ink); color:var(--plate); font:700 11px Archivo, sans-serif; padding:2px 5px; white-space:nowrap; pointer-events:none; z-index:2; }
#warpW #wwTo { display:flex; align-items:center; gap:2px; border-left:1px solid var(--hair); }
#wwC { flex-basis:100%; text-align:center; font-size:11px; font-weight:600; color:var(--redt); padding:1px 0 2px; letter-spacing:.02em; }
#wwM { position:absolute; top:100%; right:0; margin-top:4px; background:var(--plate); box-shadow:var(--sh); min-width:230px; display:flex; flex-direction:column; }
#wwM.hidden, #wwC.hidden, #navPop.hidden { display:none; }
#wwM button { display:flex; justify-content:space-between; gap:16px; border:0; border-bottom:1px solid var(--hair); padding:8px 12px; font-size:13px; text-align:left; }
#wwM button b { font-variant-numeric:tabular-nums; } #wwM button:hover { background:var(--ink); color:var(--plate); }
#navPop { position:fixed; z-index:9; background:var(--plate); color:var(--ink); box-shadow:var(--sh); border:1px solid var(--ink); display:flex; flex-direction:column; min-width:150px; pointer-events:auto; }
#navPop .pt { padding:6px 10px; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ink2); border-bottom:1px solid var(--hair); }
#navPop button { border:0; border-bottom:1px solid var(--hair); padding:7px 10px; text-align:left; font-size:13px; } #navPop button:disabled { opacity:.4; }
#fN .nbar { display:block; height:3px; background:var(--hair, rgba(18,19,20,.15)); margin-top:5px; } #fN .nbar u { display:block; height:100%; background:var(--red); text-decoration:none; }
#fN .key { font-size:10px; padding:0 4px; }
#nodeP .nh button:disabled { opacity:.3; }`; document.head.appendChild(st); }
Object.assign(window.YE, {nodeMake, nodeAdd, nodeDel, nodeKill, nodeUpdate, circAt, transferTo, stateAt, stateFrom, navRem, SATS, NAVT, NODES, NAV, warpToT, warpTargets, warpMenu});
Object.defineProperty(window.YE, 'NODE', {get: () => NODE}); Object.defineProperty(window.YE, 'PRED2', {get: () => NODE ? NODE.pred : PRED});
