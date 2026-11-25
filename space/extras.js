'use strict';
// YeShip extras: save + continue a flight, bigger explosions with burning wreckage, extra sounds (RCS hiss, cabin hum, sonic boom,
// warning beeps), the Moon mystery (an old lander to find) with its own mission and target marker, burn-time hints.
// Loaded after mission.js; polish.js (loaded next) calls boot().

// ---------------- save / continue the current flight (localStorage 'ye-flight')
const SAVE_K = 'ye-flight';
function flightSave() {
  if (!G.on || FLOG.test || !(R.st === 'fly' || R.st === 'landed') || (!R.on && R.body === PLANET)) return;
  const d = {v: 1, at: Date.now(), t: G.t, st: R.st, body: R.body === MOON ? 'm' : 'p', bot: R.bot, fuel: R.fuel, lit: R.lit, thr: R.thr, chute: R.chute, chA: R.chA, sas: R.sas, legs: R.legT,
    t0: R.t0, pos: R.pos.toArray(), vel: R.vel.toArray(), q: R.q.toArray(), w: R.w.toArray(), lp: R.lp.toArray(), lq: R.lq.toArray(), seat: R.on ? C.seat : -1, view: C.view, flog: FLOG, ship: {name: SHIP.name, parts: SHIP.parts},
    where: R.st === 'landed' ? (R.body === MOON ? 'Landed on the Moon' : 'Landed') : domBody(R.pos) === MOON ? 'Near the Moon' : orbitEl(PLANET).pe > PLANET.atmo ? 'In orbit' : 'In flight'};
  try { localStorage.setItem(SAVE_K, JSON.stringify(d)); } catch (e) {} }
function flightSaved() { try { const d = JSON.parse(localStorage.getItem(SAVE_K) || 'null'); return d && d.v === 1 ? d : null; } catch (e) { return null; } }
function flightClear() { try { localStorage.removeItem(SAVE_K); } catch (e) {} }
function flightLoad(d) {
  G.t = d.t; for (const b of BODIES) bodyState(b, G.t);
  if (d.ship && Array.isArray(d.ship.parts) && d.ship.parts.every(p => PARTS[p.k])) shipApply(d.ship.parts, d.ship.name);
  resetRocket(); for (let i = 0; i < d.bot; i++) dropStage(); clearDebris(); PT.n = PT.head = 0;
  Object.assign(R, {fuel: d.fuel, lit: d.lit, thr: d.thr, chute: d.chute, chA: d.chA, legT: d.legs, legs: d.legs, t0: d.t0, body: d.body === 'm' ? MOON : PLANET, st: d.st, spool: d.lit && d.thr > 0 ? 1 : 0});
  R.pos.fromArray(d.pos); R.vel.fromArray(d.vel); R.q.fromArray(d.q); R.w.fromArray(d.w); R.lp.fromArray(d.lp); R.lq.fromArray(d.lq); if (R.st === 'landed') latch(G.t);
  R.hold.copy(R.q); R.sas = d.sas; board(); if (d.seat === 0) toPilot(); C.view = d.view || 'in';
  newFlight(); Object.assign(FLOG, d.flog, {t0: R.t0, lastT: G.t}); prevSt = R.st; G.wi = 0; G.warp = 1;
  showHint('Welcome back. ' + d.where + '. ' + (d.seat === 0 ? 'You are in the Pilot seat.' : 'Walk to the middle seat and press F to fly.'), 6000); }
let saveT = 0;
function saveStep(dt) { if ((saveT -= dt) > 0 || !G.on) return; saveT = 4; if (R.st === 'dead' || (!R.on && R.st === 'landed' && R.body === PLANET)) { flightClear(); return; } if (R.st !== 'pad') flightSave(); } // done or crashed: nothing to continue
addEventListener('visibilitychange', () => { if (document.hidden) flightSave(); });
addEventListener('pagehide', flightSave);

// ---------------- explosions: fireball flash, ground shock ring, burning wreckage trailing smoke
const FXM = {ball: new THREE.SphereGeometry(1, 24, 14), ring: new THREE.RingGeometry(.82, 1, 64)};
const FX = [], FXPOOL = [];
function fxMesh(kind) { let m = FXPOOL.find(x => !x.visible && x.userData.kind === kind); if (m) return m;
  m = new THREE.Mesh(FXM[kind], new THREE.MeshBasicMaterial({color: kind === 'ball' ? 0xffb066 : 0xfff0dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
  m.userData.kind = kind; m.frustumCulled = false; m.renderOrder = 7; m.visible = false; scene.add(m); FXPOOL.push(m); return m; }
fxMesh('ball'); fxMesh('ring'); // made up front so the warm-up compiles them
function fxAdd(kind, at, size, life, up) { const m = fxMesh(kind); m.visible = true; const f = {m, p: at.clone(), size, life, t: 0}; if (up) m.quaternion.setFromUnitVectors(new V3(0, 0, 1), up); FX.push(f); }
function fxStep(dt) { for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; f.t += dt; const u = f.t / f.life; if (u >= 1) { f.m.visible = false; FX.splice(i, 1); continue; }
    f.m.position.copy(f.p).sub(G.O); const ball = f.m.userData.kind === 'ball', s = f.size * (ball ? .35 + .65 * Math.sqrt(u) : u); f.m.scale.setScalar(Math.max(.01, s));
    f.m.material.opacity = ball ? Math.pow(1 - u, 2) * 1.6 : (1 - u) * .55; if (ball) f.m.material.color.setRGB(1, lerp(.85, .35, u), lerp(.55, .12, u)); }
  // burning pieces of a wreck
  for (const d of R.debris) if (d.burn > 0) { d.burn -= dt * Math.min(G.warp, 4); d.smk = (d.smk || 0) + dt * 30 * Math.min(1, G.warp);
    const air = d.pos.length() - PLANET.R < PLANET.atmo && domBody(d.pos) === PLANET; while (d.smk > 1) { d.smk--; const fire = Math.random() < .35;
      puff(d.pos, d.vel.clone().multiplyScalar(.6).add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(3)), fire ? {life: .5 + Math.random() * .4, s: 1.5, gr: 2, heat: 1, hk: 1, drag: air ? 1 : 0, tone: .3} : {life: air ? 6 + Math.random() * 4 : 2, s: 2, gr: 2.5, heat: .15, hk: 2, drag: air ? 1 : 0, tone: .16, rise: air ? 1 : 0}); } } }
{ const b0 = boom; boom = function (at, k) { b0(at, k); const b = domBody(at), up = at.clone().sub(b.c).normalize(); fxAdd('ball', at, 14 * k, .9);
    const bf = at.clone().sub(b.c).applyQuaternion(b.q.clone().invert()); if (bf.length() - groundR(b, bf) < 25) fxAdd('ring', at.clone().addScaledVector(up, 1), 90 * k, 1.4, up); }; }
{ const e0 = explode; explode = function () { const n0 = R.debris.length; e0(); for (let i = n0; i < R.debris.length; i++) R.debris[i].burn = 5 + Math.random() * 6; flightClear(); }; }

// ---------------- sound: RCS hiss when steering, cabin air hum, a sonic boom through Mach 1, warning beeps
const SX = {lastM: 0, beepT: 0};
function sndExtra(dt) { const c = SND.c; if (!c) return; const t = c.currentTime;
  if (!SX.hiss) { const loop = (buf, type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(SND.out); s.start(0, Math.random()); return {g, fl}; };
    SX.hiss = loop(SND.wh, 'highpass', 3200, .4); SX.hum = loop(SND.br, 'lowpass', 140, .9); }
  const steer = R.on && R.st === 'fly' ? Math.min(1, R.inp.length()) + (R.sas !== 'off' && R.w.length() > .03 ? .25 : 0) : 0;
  SX.hiss.g.gain.setTargetAtTime(steer * .05, t, .05); SX.hum.g.gain.setTargetAtTime(R.on && C.in && (C.view === 'in' || C.seat < 0) ? .16 : 0, t, .4);
  // the sonic boom (heard outside, a muffled thump inside)
  const M = R.st === 'fly' ? R.mach || 0 : 0; if (R.p > .15 && (SX.lastM - 1) * (M - 1) < 0 && Math.abs(M - SX.lastM) < .2) { boomTwice(R.on && C.view === 'in' ? .5 : 1); } SX.lastM = M;
  // beeps when the landing readout says BURN NOW
  const red = HUDE.fW && HUDE.fW._c === 'red' && R.on && !$('fl').classList.contains('hidden'); if (red && (SX.beepT -= dt) <= 0) { SX.beepT = .55; beep(1320, .12); } else if (!red) SX.beepT = 0; }
function beep(f, len) { const c = SND.c, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(SND.out);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .01); g.gain.setValueAtTime(.05, t + len - .02); g.gain.linearRampToValueAtTime(0, t + len); o.start(t); o.stop(t + len + .02); }
function boomTwice(k) { const c = SND.c, t0 = c.currentTime; for (const dtb of [0, .14]) { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = SND.br; f.type = 'lowpass'; f.frequency.value = 180 * k + 60;
    s.connect(f); f.connect(g); g.connect(SND.out); g.gain.setValueAtTime(1.6 * k, t0 + dtb); g.gain.exponentialRampToValueAtTime(.001, t0 + dtb + .7); s.start(t0 + dtb, Math.random()); s.stop(t0 + dtb + .8); } }
{ const s0 = stage; stage = function () { const b = R.bot; s0(); if (R.bot !== b) sfx('thud'); }; } // a solid clunk when a stage lets go

// ---------------- the Moon mystery: an old lander from the first (unlucky) probe, on the near side
const MYS = {dir: null, pos: new V3(), found: false, g: new THREE.Group()};
function mysBuild() {
  // pick the flattest of a few spots near the middle of the near side (the face that always points at Home)
  const near = MOON.c.clone().negate().normalize().applyQuaternion(MOON.q.clone().invert()), e = new V3(0, 1, 0).cross(near).normalize(), n = near.clone().cross(e).normalize(); let best = null, bs = 1e9;
  for (let i = 0; i < 40; i++) { const a = .1 + (i % 8) * .025, bb = -.12 + Math.floor(i / 8) * .06, d = near.clone().addScaledVector(e, a).addScaledVector(n, bb).normalize(), h0 = heightAt(MOON, d.x, d.y, d.z);
    let sl = 0; for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = d.clone().addScaledVector(e, x * 4e-5).addScaledVector(n, y * 4e-5).normalize(); sl += Math.abs(heightAt(MOON, q.x, q.y, q.z) - h0); } if (sl < bs) { bs = sl; best = d; } }
  MYS.dir = best; MYS.pos.copy(best).multiplyScalar(MOON.R + heightAt(MOON, best.x, best.y, best.z)); MOON.group.add(MYS.g); MYS.g.position.copy(MYS.pos).addScaledVector(best, -.15); MYS.g.quaternion.setFromUnitVectors(new V3(0, 1, 0), best);
  const foil = new THREE.MeshStandardMaterial({color: 0xc9962e, roughness: .35, metalness: .9}), grey = new THREE.MeshStandardMaterial({color: 0x8a8d92, roughness: .55, metalness: .6}), dark = new THREE.MeshStandardMaterial({color: 0x26282c, roughness: .6, metalness: .3});
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; MYS.g.add(o); return o; };
  const body = add(new THREE.CylinderGeometry(1.5, 1.5, 1.4, 8), foil, 0, 1.9, 0); body.rotation.y = Math.PI / 8; add(new THREE.CylinderGeometry(1.1, 1.3, .25, 8), grey, 0, 2.72, 0);
  add(new THREE.CylinderGeometry(.35, .55, .7, 16, 1, true), dark, 0, .95, 0); // descent engine bell
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, cx = Math.cos(a), cz = Math.sin(a), top = new V3(cx * 1.45, 2.2, cz * 1.45), foot = new V3(cx * 2.9, .12, cz * 2.9), dl = foot.clone().sub(top);
    const leg = add(new THREE.CylinderGeometry(.07, .07, dl.length(), 8), grey, 0, 0, 0); leg.position.copy(top).addScaledVector(dl, .5); leg.quaternion.setFromUnitVectors(new V3(0, 1, 0), dl.normalize());
    add(new THREE.CylinderGeometry(.42, .48, .08, 16), grey, foot.x, .05, foot.z); }
  // a dish that never phoned home, a flag faded to white, and a plaque
  const dish = add(new THREE.SphereGeometry(.7, 20, 8, 0, Math.PI * 2, 0, .9), grey, 1.0, 3.5, .3); dish.rotation.set(.9, 0, -.5); add(new THREE.CylinderGeometry(.04, .04, .8, 6), grey, .8, 3.0, .2);
  add(new THREE.CylinderGeometry(.03, .03, 2.4, 6), grey, -3.4, 1.2, 1.2); const fl = add(new THREE.PlaneGeometry(1.2, .75), new THREE.MeshStandardMaterial({color: 0xe8e2d6, roughness: .9, side: THREE.DoubleSide}), -2.8, 2.0, 1.2); fl.rotation.y = .3;
  const pc = document.createElement('canvas'); pc.width = 256; pc.height = 128; const x = pc.getContext('2d'); x.fillStyle = '#b8b2a4'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#3a3428'; x.font = '600 22px monospace'; x.textAlign = 'center';
  x.fillText('YESHIP PROBE 1', 128, 44); x.font = '16px monospace'; x.fillText('SET DOWN SAFELY.', 128, 76); x.fillText('NEVER PHONED HOME.', 128, 100); const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace;
  const pl = add(new THREE.PlaneGeometry(.9, .45), new THREE.MeshStandardMaterial({map: pt, roughness: .5, metalness: .4}), 0, 1.75, 1.47); pl.rotation.y = 0;
  // footprints circling it
  const fp = new THREE.InstancedMesh(new THREE.BoxGeometry(.13, .02, .3), new THREE.MeshStandardMaterial({color: 0x232426, roughness: 1}), 60), M4 = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2.4, r = 5.2 + Math.sin(i * .7) * .6, side = i % 2 ? .12 : -.12; M4.makeRotationY(-a); M4.setPosition(Math.cos(a) * (r + side), .02, Math.sin(a) * (r + side)); fp.setMatrixAt(i, M4); }
  fp.receiveShadow = true; MYS.g.add(fp); }
// on-screen target diamond + distance when it matters (mission picked, or near the Moon)
const tgtEl = document.createElement('div'); tgtEl.id = 'mTgt'; tgtEl.className = 'hidden'; document.body.appendChild(tgtEl);
const _mw = new V3();
function mysStep(dt) {
  if (!MYS.dir || !G.on) return; const mw = _mw.copy(MYS.pos).applyQuaternion(MOON.q).add(MOON.c), me = R.on ? R.pos : _xq.copy(P.pos).applyQuaternion(P.body.q).add(P.body.c), dist = me.distanceTo(mw);
  const show = !MAPV.on && (MIS.cur === 'mystery' && !MIS.done.mystery || domBody(me) === MOON && dist < 3e5) && dist > 12;
  if (show) { const p = _xq.copy(mw).sub(G.O).project(cam), ok = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; tgtEl.classList.toggle('hidden', !ok);
    if (ok) { tgtEl.style.transform = 'translate(' + ((p.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-p.y * .5 + .5) * innerHeight).toFixed(1) + 'px)'; const t = '? ' + fmtD(dist); if (tgtEl._t !== t) { tgtEl._t = t; tgtEl.textContent = t; } } }
  else tgtEl.classList.add('hidden');
  if (!R.on && P.body === MOON) { const d = P.pos.distanceTo(MYS.pos); if (d < 300 && !MYS.near) { MYS.near = true; showHint('Something metal glints nearby...', 3000); }
    if (d < 7 && !MYS.read) { MYS.read = true; showHint('The plaque reads: "YeShip Probe 1. Set down safely. Never phoned home."', 7000); } if (d < 9) FLOG.mystery = true; if (d > 400) MYS.near = MYS.read = false; } }
MISD.splice(MISD.findIndex(m => m.id === 'back') + 1, 0, {id: 'mystery', name: 'Moon mystery', d: 'Something old sits on the Moon\'s near side. Land close and walk up to it.', steps: [
  ['Open the map (M): the pink ? on the Moon\'s near side marks it. A ? marker also shows in flight', F => F.moonSOI || F.mysLand || F.mystery], ['Land on the Moon within 2 km of the ?', F => F.mysLand || F.mystery], ['Get out and walk up to it', F => F.mystery]], done: F => F.mystery});
const _xq = new V3();

// ---------------- the map: mark the mystery site; mission card hint for the landing target
{ const mr = mapRender; mapRender = function (dt) { mr(dt); if (!MYS.dir || (MIS.done.mystery && MIS.cur !== 'mystery')) return; const x = MAPV.x, p = _xq.copy(MYS.pos).applyQuaternion(MOON.q).multiplyScalar(.001).add(MAPV.mo.position).project(MAPV.cam);
    if (p.z > 1) return; const sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight; x.fillStyle = '#ff7ad9'; x.beginPath(); x.moveTo(sx, sy - 7); x.lineTo(sx + 6, sy); x.lineTo(sx, sy + 7); x.lineTo(sx - 6, sy); x.fill();
    x.font = '600 12px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillText('?', sx, sy - 11); x.textAlign = 'left'; }; }
{ const mp = misPoll; misPoll = function (dt) { mp(dt); if (R.st === 'landed' && R.body === MOON && MYS.dir && R.lp.distanceTo(MYS.pos) < 2000) FLOG.mysLand = true; }; }

// ---------------- hooks
{ const vis = FLIGHT.visuals; FLIGHT.visuals = dt => { vis(dt); fxStep(dt); sndExtra(dt); mysStep(dt); saveStep(dt); }; }
const _bootX = boot;
boot = function () { _bootX(); mysBuild(); const was = FXPOOL.map(m => m.visible); FXPOOL.forEach(m => m.visible = true); MYS.g.visible = true; try { RND.compile(scene, cam); } catch (e) {} FXPOOL.forEach((m, i) => m.visible = was[i]);
  const d = flightSaved(), cb = $('cont'); if (d && Date.now() - d.at < 14 * 864e5) { const ago = (Date.now() - d.at) / 6e4; cb.classList.remove('hidden'); cb.textContent = 'Continue flight · ' + d.where + ' · ' + (ago < 60 ? Math.max(1, Math.round(ago)) + ' min ago' : ago < 1440 ? Math.round(ago / 60) + ' h ago' : Math.round(ago / 1440) + ' days ago');
    cb.onclick = () => { $('play').click(); flightLoad(d); }; } };
Object.assign(window.YE, {flightSave, flightLoad, flightSaved, MYS, FX, boomTwice});
// boot() is called at the end of polish.js
