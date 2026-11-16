'use strict';
// Camper Crew: co-op road trip in a camper with a walk-in inside. Everyone is on foot in first person: drive, ride, get out,
// carry things, winch, push, crank, blow things up. The host runs the camper and the world; each player runs their own body.
const V3 = THREE.Vector3, QT = THREE.Quaternion;
const LMAX = 42, TMAX = 62000, PH = 1 / 120;
const Q = new URLSearchParams(location.search);
const G = { on: false, S: null, set: null, cam: null, crew: [], poses: {}, avatars: {}, items: new Map(), meshes: new Map(), buf: [], t: 0, ev: [], tm: 0 };
const KEYS = new Set(), MB = [false, false, false];
const ME = { mode: 'in', p: new V3(), v: new V3(), yaw: 0, pitch: 0, crouch: false, ground: true, held: '', hold: '', holdT: 0, rT: 0, eT: 0, bob: 0, fallV: 0, tumble: 0 };
// shared state; the host owns it and sends it ~15 times a second
const W = { seats: ['', ''], hook: { st: 'stow', by: '', p: [0, 0, 0], at: null, L: 0.5 }, fuel: 0.34, flat: [0, 0, 0, 0], log: null, logGone: 0, br: { c: 0, a: 1 }, bo: 0, db: 0, fe: { p: 0, dir: 1 }, hp: {}, ph: 'run', tm: 0, pen: 0, tows: 0, radio: 0, prog: 0, dyn: 4, reel: 0, ten: 0, stats: { boom: 0, cans: 0, flats: 0, fell: 0, snap: 0 }, wet: 0 };
const isHost = () => Net.role !== 'guest';
const myId = () => Net.role === 'guest' ? Net.id : 'H';
let car = null; // host only
const RV = { pos: new V3(), q: new QT(), qi: new QT(), vel: new V3(), st: 0, rpm: 900, thr: 0, comp: [0, 0, 0, 0], speed: 0, g: 1, aL: new V3(), lastV: new V3(), up: 1, prog: 0, lat: 0, d: 0 };
const T1 = new V3(), T2 = new V3(), T3 = new V3(), TQ = new QT(), TE = new THREE.Euler(0, 0, 0, 'YXZ');
const toW = (l, out) => out.copy(l).applyQuaternion(RV.q).add(RV.pos);
const toL = (w, out) => out.copy(w).sub(RV.pos).applyQuaternion(RV.qi);
const lv = a => T3.set(a[0], a[1], a[2]);
const rvHeading = () => { T1.set(0, 0, 1).applyQuaternion(RV.q); return Math.atan2(T1.x, T1.z); };
const nameOf = id => (G.crew.find(c => c.id === id) || {}).name || 'Someone';
const colOf = id => CREW_COL[((G.crew.find(c => c.id === id) || {}).c || 0) % CREW_COL.length];
// ---------- menu ----------
function myName() { const n = ($('nm').value || '').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Camper'; try { localStorage.setItem('cc-name', n); } catch (e) {} return n; }
try { $('nm').value = localStorage.getItem('cc-name') || ''; } catch (e) {}
const show = id => { for (const s of ['menu', 'lobby', 'fin', 'pause']) $(s).classList.toggle('hidden', s !== id); };
const msg = (id, t) => { $(id).textContent = t; };
Net.tag = '[Camper]'; Net.late = true; Net.relayT = { pose: 1 };
$('bSolo').onclick = () => { Sfx.start(); Net.close(); G.crew = [{ id: 'H', name: myName(), c: 0 }]; startGame(); };
$('bHost').onclick = () => { Sfx.start(); const code = Net.host(myName(), s => msg('lmsg', s === 'open' ? 'Share the code. Up to 8 campers.' : 'Connection lost, retrying...')); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); msg('lmsg', 'Connecting...'); lobby(); };
$('bJoin').onclick = () => joinRoom($('jc').value.trim().toUpperCase());
function joinRoom(code) { if (!/^[A-Z]{5}$/.test(code)) { msg('msg', 'Enter the 5-letter code.'); return; } Sfx.start(); Net.join(code, myName(), why => { if (G.on) endToMenu(why); else { show('menu'); msg('msg', why); } }); $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); msg('lmsg', 'Connecting...'); $('crewL').innerHTML = ''; }
$('bLeave').onclick = () => { Net.close(); show('menu'); rooms(); };
function crewList() { const L = [{ id: 'H', name: Net.name || myName(), c: 0 }]; let c = 1; for (const [id, p] of Net.peers) L.push({ id, name: p.name, c: c++ }); return L; }
function lobby() { const L = crewList(); $('crewL').innerHTML = L.map(p => '<div><i style="background:#' + CREW_COL[p.c].toString(16).padStart(6, '0') + '"></i>' + p.name.replace(/[<>&]/g, '') + (p.id === 'H' ? ' <small>host</small>' : '') + '</div>').join(''); if (Net.role === 'host') Net.send({ t: 'lobby', crew: L }); }
$('bGo').onclick = () => { Net.started = true; Net.meta(false); G.crew = crewList(); Net.send({ t: 'start', crew: G.crew }); startGame(); };
Net.on('_lobby', () => { if (!G.on) lobby(); });
Net.on('_join', m => { if (G.on && Net.role === 'host') { G.crew = crewList(); Net.send1(m.id, { t: 'start', crew: G.crew }); Net.send({ t: 'crew', crew: G.crew }); toast(nameOf(m.id) + ' joined the trip', '', 2500); } });
Net.on('_left', m => { if (!G.on) { lobby(); return; } dropAllOf(m.id); delete G.poses[m.id]; G.crew = G.crew.filter(c => c.id !== m.id); Net.send({ t: 'crew', crew: G.crew }); toast((m.name || 'Someone') + ' left', '', 2500); });
Net.on('_hostgone', () => { if (G.on) endToMenu('The host left.'); else { show('menu'); msg('msg', 'The host left.'); } });
Net.on('lobby', m => { $('crewL').innerHTML = (m.crew || []).map(p => '<div><i style="background:#' + CREW_COL[p.c % 8].toString(16).padStart(6, '0') + '"></i>' + String(p.name).replace(/[<>&]/g, '') + '</div>').join(''); msg('lmsg', 'Waiting for the host to start the trip...'); });
Net.on('start', m => { G.crew = m.crew || []; if (!G.on) startGame(); });
Net.on('crew', m => { G.crew = m.crew || G.crew; });
async function rooms() { if ($('menu').classList.contains('hidden')) return; const r = await Net.rooms(), b = $('rooms'); b.innerHTML = ''; for (const x of r) { const e = document.createElement('button'); e.innerHTML = '<span>' + x.name.slice(9).replace(/[<>&]/g, '') + '</span><span>' + x.n + '/8</span>'; e.onclick = () => joinRoom(x.code); b.appendChild(e); } clearTimeout(G.rt); G.rt = setTimeout(rooms, 4000); }
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || Q.has('relay')) rooms();
function endToMenu(why) { G.on = false; Net.close(); $('hud').classList.add('hidden'); show('menu'); msg('msg', why || ''); try { document.exitPointerLock(); } catch (e) {} Radio.stop(); Sfx.mute(true); setTimeout(() => Sfx.mute(false), 50); rooms(); }
// ---------- start ----------
let MAPC = null;
function startGame() {
  show(null); $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('load').classList.remove('hidden');
  setTimeout(async () => {
    const gfx = $('sGfx').value; if (!World.R) World.init($('gl'), gfx);
    const S = MAPC || (MAPC = RVMAP.build()); G.S = S;
    await World.photos(S.B);
    const bp = World.buildProps; World.buildProps = () => {}; S.decks.length = 0; World.build(S, 0); World.buildProps = bp;
    World.scene.add(World.cam);
    G.set = buildSet(World.scene, S); G.cam = buildCamper(); World.scene.add(G.cam.g);
    applyCar(RVSPEC); G.items = new Map(); for (const m of G.meshes.values()) m.parent && m.parent.remove(m); G.meshes = new Map(); G.avatars = {}; G.poses = {}; G.buf = [];
    // dynamic surfaces: the drawbridge (only when it's down) and the raft
    const br = G.set.bridge, bfx = Math.sin(br.p.h), bfz = Math.cos(br.p.h), brx = -Math.cos(br.p.h), brz = Math.sin(br.p.h);
    S.decks.push({ at: (x, z) => { if (W.br.a > 0.03) return null; const dx = x - br.p.x, dz = z - br.p.z, u = dx * bfx + dz * bfz, v = dx * brx + dz * brz; return Math.abs(u) < br.half + 0.3 && Math.abs(v) < S.HW + 0.5 ? S.deckY : null; } });
    S.decks.push({ at: (x, z) => { const f = raftFrame(); const dx = x - f.x, dz = z - f.z, u = dx * f.fx + dz * f.fz, v = dx * -f.fz + dz * f.fx; return Math.abs(u) < 7 && Math.abs(v) < S.HW + 0.6 ? S.ferryY : null; } });
    Object.assign(W, { seats: ['', ''], hook: { st: 'stow', by: '', p: [0, 0, 0], at: null, L: 0.5 }, fuel: 0.4, flat: [0, 0, 0, 0], logGone: 0, br: { c: 0, a: 1 }, bo: 0, db: 0, fe: { p: 0, dir: 1 }, hp: {}, ph: 'run', tm: 0, pen: 0, tows: 0, radio: 0, prog: S.sAll.start, dyn: 4, reel: 0, ten: 0, stats: { boom: 0, cans: 0, flats: 0, fell: 0, snap: 0 }, wet: 0 });
    for (const b of S.boulders) b.on = true; S.log.ax = S.log0 ? S.log0[0] : S.log.ax; if (!S.log0) S.log0 = [S.log.ax, S.log.az, S.log.bx, S.log.bz]; [S.log.ax, S.log.az, S.log.bx, S.log.bz] = S.log0; S.logs = [S.log];
    if (isHost()) {
      car = new Car(S); car._real = false; car._sport = false; car._manual = false; car.punct = false; car._easy = false; car.place(S.sAll.start + 6, 0); W.log = S.log0.slice();
      const it = (k, f, p) => { const o = { id: 'i' + G.items.size, k, h: '', f, p: p.slice(), v: null, lit: 0 }; G.items.set(o.id, o); return o; };
      it('remote', 'r', [0.25, FL + 1.06, 3.92]); it('duck', 'r', [-0.5, FL + 1.06, 3.98]); it('tyre', 'r', RVL.spare);
      for (const p of G.set.shopSpots.slice(0, 3)) it('can', 'w', [p[0], p[1] + 0.21, p[2]]); { const p = G.set.shopSpots[3]; it('tyre', 'w', [p[0], p[1] + 0.47, p[2]]); }
      syncRV(true);
    }
    const k = Math.max(0, G.crew.findIndex(c => c.id === myId()));
    Object.assign(ME, { mode: 'in', seat: -1, p: new V3(k % 2 ? -0.2 : 0.25, FL, 1.9 - (k >> 1) * 1.1), v: new V3(), yaw: 0, pitch: -0.05, held: '', hold: '', holdT: 0, tumble: 0 });
    G.t = 0; G.tm = 0; G.on = true; G.ev = []; G.lastFrame = performance.now(); G.acc = 0; G.sendT = 0; G.poseT = 0; G.seen = {}; G.fin = false; G.statsMe = { walk: 0, roof: 0 };
    $('load').classList.add('hidden'); $('fin').classList.add('hidden'); $('lockmsg').classList.remove('hidden');
    toast("GRANDMA'S CAMPER", 'Get everyone to Lakeside Camp. Someone take the wheel (E at the driver seat).', 6000);
  }, 40);
}
// raft position from the ferry state
function raftFrame() { const S = G.S, a = S.at(S.sAll.dock0 + 7.6), b = S.at(S.sAll.dock1 - 7.6), p = W.fe.p, x = lerp(a.x, b.x, p), z = lerp(a.z, b.z, p), fx = b.x - a.x, fz = b.z - a.z, l = Math.hypot(fx, fz); return { x, z, fx: fx / l, fz: fz / l, h: Math.atan2(fx, fz) }; }
// ---------- input ----------
const cvs = $('gl');
addEventListener('keydown', e => {
  if (!G.on) return; if (e.code === 'Tab') e.preventDefault(); KEYS.add(e.code); Sfx.start();
  if (e.repeat) return;
  if (e.code === 'Escape') { pauseOpen(); return; }
  if (e.code === 'KeyQ') dropHeld();
  if (e.code === 'KeyH' || (e.code === 'KeyT')) { if (ME.mode === 'seat' && ME.seat === 0) act({ k: 'horn' }); }
  if (e.code === 'KeyC') ME.crouch = !ME.crouch;
  if (e.code === 'KeyM') { $('mapBox').classList.toggle('on'); }
});
addEventListener('keyup', e => { KEYS.delete(e.code); });
addEventListener('blur', () => KEYS.clear());
cvs.addEventListener('mousedown', e => { if (!G.on) return; Sfx.start(); if (!document.pointerLockElement) { try { cvs.requestPointerLock(); } catch (x) {} return; } MB[e.button] = true; if (e.button === 0) useHeld(); });
addEventListener('mouseup', e => { MB[e.button] = false; });
cvs.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => { if (!G.on || document.pointerLockElement !== cvs) return; const k = 0.0023 * (+$('sSens').value || 1); ME.yaw -= e.movementX * k; ME.pitch = clamp(ME.pitch - e.movementY * k, -1.45, 1.45); });
document.addEventListener('pointerlockchange', () => { $('lockmsg').classList.toggle('hidden', !!document.pointerLockElement || !G.on); });
function pauseOpen() { if (!G.on) return; $('pause').classList.remove('hidden'); try { document.exitPointerLock(); } catch (e) {} }
$('bResume').onclick = () => { $('pause').classList.add('hidden'); try { cvs.requestPointerLock(); } catch (e) {} };
$('bQuit').onclick = () => { $('pause').classList.add('hidden'); endToMenu(''); };
$('bAgain').onclick = () => { $('fin').classList.add('hidden'); if (Net.role === 'host') Net.send({ t: 'restart' }); startGame(); };
$('bMenu').onclick = () => endToMenu('');
Net.on('restart', () => { if (G.on) startGame(); });
// ---------- actions (guests send them, the host runs them) ----------
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({ t: 'act' }, m)); }
Net.on('act', (m, from) => { if (isHost() && G.on) hostAct(from, m); });
function heldBy(id) { for (const it of G.items.values()) if (it.h === id) return it; return null; }
function hostAct(id, m) {
  const S = G.S, H = W.hook;
  if (m.k === 'seat') { const s = m.s | 0; if (s < 0 || s > 1 || (W.seats[s] && W.seats[s] !== id)) return; W.seats = W.seats.map(x => x === id ? '' : x); W.seats[s] = id; }
  else if (m.k === 'unseat') W.seats = W.seats.map(x => x === id ? '' : x);
  else if (m.k === 'pick') { const it = G.items.get(m.id); if (!it || it.h || it.lit || heldBy(id) || (H.by === id && H.st === 'held')) return; it.h = id; it.v = null; }
  else if (m.k === 'drop') { const it = heldBy(id); if (!it) return; it.h = ''; it.f = m.f === 'r' ? 'r' : 'w'; it.p = m.p.map(Number); it.v = m.v ? m.v.map(Number) : null; if (it.k === 'dyn' && m.lit) it.lit = 4; }
  else if (m.k === 'take') { if (W.dyn <= 0 || heldBy(id)) return; W.dyn--; const o = { id: 'd' + (G.idn = (G.idn || 0) + 1), k: 'dyn', h: id, f: 'w', p: [0, 0, 0], v: null, lit: 0 }; G.items.set(o.id, o); }
  else if (m.k === 'hook') {
    if (m.op === 'take' && (H.st === 'stow' || H.st === 'free' || H.st === 'set') && !heldBy(id)) { H.st = 'held'; H.by = id; H.at = null; }
    else if (m.op === 'set' && H.st === 'held' && H.by === id && m.at) { H.st = 'set'; H.at = m.at; H.p = m.p.map(Number); H.L = Math.max(1.5, hookDist()); H.by = ''; say2('HOOKED', m.at.t === 'log' ? 'reel the tree in with the remote' : 'reel in with the remote'); }
    else if (m.op === 'stow' && H.st === 'held' && H.by === id) { H.st = 'stow'; H.by = ''; H.at = null; H.L = 0.5; }
    else if (m.op === 'drop' && H.st === 'held' && H.by === id) { H.st = 'free'; H.by = ''; H.p = m.p.map(Number); }
  }
  else if (m.k === 'horn') ev({ k: 'horn' });
  else if (m.k === 'quack') ev({ k: 'quack', p: m.p });
  else if (m.k === 'radio') { W.radio = (W.radio + 1) % 4; }
  else if (m.k === 'tow') tow();
}
function dropAllOf(id) { for (const it of G.items.values()) if (it.h === id) { it.h = ''; const ps = G.poses[id]; it.f = 'w'; it.p = ps && ps.m === 'out' ? [ps.p[0], G.S.heightAt(ps.p[0], ps.p[2]) + 0.2, ps.p[2]] : (() => { const w = toW(T1.set(0, FL + 0.2, 0), new V3()); return [w.x, w.y, w.z]; })(); if (ps && ps.m !== 'out') { it.f = 'r'; it.p = [0, FL + 0.2, 0]; } } if (W.hook.by === id) { W.hook.st = 'stow'; W.hook.by = ''; } W.seats = W.seats.map(x => x === id ? '' : x); }
function ev(e) { G.ev.push(e); onEvent(e); }
function say2(a, b) { ev({ k: 'say', a, b }); }
// ---------- camper state (host: from the physics; guests: interpolated snapshots) ----------
function syncRV(hard) {
  if (isHost()) { RV.pos.copy(car.pos); RV.q.copy(car.q); RV.vel.copy(car.v); RV.st = car.steer; RV.rpm = car.rpm; RV.thr = car.thr; RV.comp = car.wh.map(w => w.comp); RV.speed = car.speed; RV.g = car.gear; RV.prog = car.prog; RV.lat = car.lat; RV.d = car.roadD; }
  RV.qi.copy(RV.q).invert(); RV.up = T1.set(0, 1, 0).applyQuaternion(RV.q).y;
}
function interpRV() {
  const B = G.buf; if (!B.length) return; const rt = performance.now() - 110; let i = B.length - 1; while (i > 0 && B[i - 1].rt > rt) i--;
  const a = B[Math.max(0, i - 1)], b = B[i], t = a === b ? 0 : clamp((rt - a.rt) / Math.max(1, b.rt - a.rt), 0, 1), ex = b.rt < rt ? Math.min(0.2, (rt - b.rt) / 1000) : 0, A = a.rv, Bv = b.rv;
  RV.pos.set(lerp(A[0], Bv[0], t) + Bv[7] * ex, lerp(A[1], Bv[1], t) + Bv[8] * ex, lerp(A[2], Bv[2], t) + Bv[9] * ex);
  TQ.set(A[3], A[4], A[5], A[6]).normalize(); RV.q.set(Bv[3], Bv[4], Bv[5], Bv[6]).normalize(); RV.q.slerpQuaternions(TQ, RV.q.clone(), t);
  RV.vel.set(lerp(A[7], Bv[7], t), lerp(A[8], Bv[8], t), lerp(A[9], Bv[9], t)); RV.st = lerp(a.st, b.st, t); RV.rpm = b.rpm; RV.thr = b.th; RV.comp = b.c; RV.speed = RV.vel.length(); RV.g = b.g; RV.prog = b.pr; RV.lat = b.lat; RV.d = b.rd;
}
// ---------- host simulation ----------
const hookDist = () => { const b = toW(lv(RVL.bumper), new V3()), h = hookPos(); return h ? b.distanceTo(h) : 0; };
function hookPos(out) {
  out = out || new V3(); const H = W.hook;
  if (H.st === 'stow') return toW(lv(RVL.bumper), out);
  if (H.st === 'held') { if (H.by === myId()) return handWorld(out); const ps = G.poses[H.by]; if (!ps) return toW(lv(RVL.bumper), out); return poseHand(ps, out); }
  if (H.st === 'set' && H.at && H.at.t === 'log') { const L = G.S.log, u = H.at.u; return out.set(lerp(L.ax, L.bx, u), L.top - L.rad * 0.4, lerp(L.az, L.bz, u)); }
  return out.set(H.p[0], H.p[1], H.p[2]);
}
function poseHand(ps, out) { if (ps.m === 'out') return out.set(ps.p[0] + Math.sin(ps.y) * 0.45, ps.p[1] + 1.05, ps.p[2] + Math.cos(ps.y) * 0.45); return toW(T1.set(ps.p[0] + Math.sin(ps.y) * 0.45, ps.p[1] + 1.05, ps.p[2] + Math.cos(ps.y) * 0.45), out); }
function handWorld(out) { const e = eyeWorld(T2); T1.set(-0.28, -0.32, 0.55); TE.set(ME.pitch, ME.yaw, 0); T1.applyEuler(TE); if (ME.mode !== 'out') T1.applyQuaternion(RV.q); return out.copy(e).add(T1); }
function hostStep(dt) {
  const S = G.S, c = car; W.tm += W.ph === 'run' ? dt : 0;
  // driver input
  const drv = W.seats[0], ps = drv === myId() ? myPose() : G.poses[drv];
  let inp = ps && ps.in ? { steer: ps.in[0], thr: ps.in[1], brk: ps.in[2], hb: !!ps.in[3] } : { steer: 0, thr: 0, brk: 0, hb: 1 };
  if (!drv) inp = { steer: 0, thr: 0, brk: 0, hb: 1 }; // nobody at the wheel: handbrake on
  if (W.fuel <= 0) { inp.thr = 0; if (!G.dry) { G.dry = 1; say2('OUT OF FUEL', W.prog < S.sAll.gas ? "push it, or fetch a can from Pete's Gas" : 'find a jerry can'); } } else G.dry = 0;
  W.reel = 0; for (const id in Object.assign({ [myId()]: 1 }, G.poses)) { const p = id === myId() ? myPose() : G.poses[id], it = heldBy(id); if (p && it && it.k === 'remote' && p.r) W.reel = p.r; }
  const f0 = raftFrame(), onR = onRaft(c.pos), rel = onR ? [(c.pos.x - f0.x) * f0.fx + (c.pos.z - f0.z) * f0.fz, (c.pos.x - f0.x) * -f0.fz + (c.pos.z - f0.z) * f0.fx] : null;
  stepHolds(dt); updLog(); for (let i = 0; i < 4; i++) c.wh[i].flat = W.flat[i];
  const bum = new V3(), hp = new V3(); let n = Math.max(1, Math.min(12, Math.round(dt / PH)));
  for (let k = 0; k < n; k++) {
    c.step(PH, inp);
    // winch
    const H = W.hook; W.ten = 0;
    if (H.st === 'set') {
      c.toWorld(lv(RVL.bumper), bum).add(c.pos); hookPos(hp); const d = bum.distanceTo(hp);
      if (W.reel) H.L = clamp(H.L - W.reel * 1.5 * PH, 1.2, LMAX);
      if (d > H.L) { const T = Math.min(TMAX, 42000 * (d - H.L)); W.ten = T / TMAX; const dir = T1.subVectors(hp, bum).normalize();
        if (H.at && H.at.t === 'log' && !W.logGone) { // the tree slides toward the camper, dragged by the hooked point
          const L = S.log, u = H.at.u, ax = lerp(L.ax, L.bx, u), az = lerp(L.az, L.bz, u), mv = Math.min(d - H.L, 1.5 * PH) * (W.reel > 0 ? 1 : 0.1), nx = ax - dir.x * mv, nz = az - dir.z * mv;
          // drag a straight, rigid trunk by one point: its far end trails behind, the rest stays in line
          const len = Math.hypot(L.bx - L.ax, L.bz - L.az), fa = u > 0.5, fx = fa ? L.ax : L.bx, fz = fa ? L.az : L.bz, dF = Math.hypot(fx - ax, fz - az), kx = fx - nx, kz = fz - nz, kl = Math.hypot(kx, kz) || 1;
          const Fx = nx + kx / kl * dF, Fz = nz + kz / kl * dF, ux = (nx - Fx) / (dF || 1), uz = (nz - Fz) / (dF || 1), Nx = Fx + ux * len, Nz = Fz + uz * len;
          if (fa) { L.ax = Fx; L.az = Fz; L.bx = Nx; L.bz = Nz; } else { L.bx = Fx; L.bz = Fz; L.ax = Nx; L.az = Nz; }
          c.impulse(bum, dir.multiplyScalar(T * 0.05 * PH));
        } else c.impulse(bum, dir.multiplyScalar(T * PH));
        if (d > H.L + 4.5 && !W.reel) { H.st = 'free'; H.p = [hp.x, S.heightAt(hp.x, hp.z) + 0.1, hp.z]; H.at = null; W.stats.snap++; ev({ k: 'snap' }); say2('THE CABLE SLIPPED', "don't drive away from the hook"); }
      }
    }
    // the crew pushing
    for (const id in G.poses) pushBy(G.poses[id], PH); pushBy(myPose(), PH);
    // thick brush around the puzzles: the camper can't take a shortcut
    if (c.roadD < 99) { const side = c.lat > 0 ? 1 : -1, lim = S.corridor(c.prog, side); if (Math.abs(c.lat) > lim) { const q = S.near(c.pos.x, c.pos.z, 60); if (q) { const rx = -Math.cos(q.h) * side, rz = Math.sin(q.h) * side, over = Math.abs(c.lat) - lim, vn = c.v.x * rx + c.v.z * rz; c.v.x -= rx * (over * 30 + Math.max(0, vn) * 8) * PH; c.v.z -= rz * (over * 30 + Math.max(0, vn) * 8) * PH; } } }
    // ride the raft
    if (G.raftD && onRaft(c.pos)) { c.pos.x += G.raftD[0] / n; c.pos.z += G.raftD[1] / n; }
  }
  // parked on a moving raft: stay put on the deck
  if (onR && G.raftD && c.speed < 2.5) { const f = raftFrame(); c.pos.x = f.x + f.fx * rel[0] - f.fz * rel[1]; c.pos.z = f.z + f.fz * rel[0] + f.fx * rel[1]; c.v.x *= 0.5; c.v.z *= 0.5; }
  // the crew helping it back on its wheels
  let flip = 0; for (const id of holders('flip')) flip++;
  if (flip) { const up = T1.set(0, 1, 0).applyQuaternion(c.q), ax = T2.crossVectors(up, T3.set(0, 1, 0)); if (ax.lengthSq() > 1e-4 && up.y < 0.9) { ax.normalize(); c.w.addScaledVector(ax, dt * (G.crew.length < 2 ? 2.2 : 1.4) * Math.min(3, flip)); c.v.y += dt * 2; } }
  for (const e of c.events) { if (e.k === 'crash' && e.v > 4) ev({ k: 'crash', v: Math.round(e.v) }); if (e.k === 'land' && e.v > 0.7 && Math.random() < 0.35) flatTyre(Math.random() * 4 | 0, 'hard landing'); } c.events.length = 0; c.wrecked = false;
  // fuel
  if (W.fuel > 0) W.fuel = Math.max(0, W.fuel - dt * (0.00025 + c.thr * 0.0019));
  // sharp rocks after the blast
  if (W.db && !W.flat.some(f => f) && c.speed > 4.2 && c.prog > S.debris.s0 && c.prog < S.debris.s1 && Math.abs(c.lat) < S.HW + 1) for (let i = 0; i < 4; i++) if (!W.flat[i] && c.wh[i].contact && Math.random() < dt * 0.45 * (c.speed / 6)) flatTyre(i, 'sharp rocks');
  // in the water?
  const wl = waterAt(c.pos.x, c.pos.z); if (wl !== null && c.pos.y < wl - 0.1 && !onRaft(c.pos)) { G.sunk = (G.sunk || 0) + dt; if (G.sunk > 2.5) { G.sunk = 0; ev({ k: 'splash', p: [c.pos.x, wl, c.pos.z] }); say2('THE CAMPER WENT FOR A SWIM', 'the tow truck fished it out (+60 s)'); tow(true); } } else G.sunk = 0;
  W.prog = Math.max(W.prog, Math.abs(c.prog - W.prog) < 60 ? c.prog : W.prog);
  stepItems(dt); G.raftD = null;
  // finish: the camper at camp and everybody there
  if (W.ph === 'run') { const cc = G.set.campC, inCamp = (x, z) => Math.hypot(x - cc.x, z - cc.z) < 40; if (inCamp(c.pos.x, c.pos.z)) { const away = G.crew.filter(m => { const p = m.id === myId() ? myPose() : G.poses[m.id]; if (!p) return false; if (p.m !== 'out') return false; return !inCamp(p.p[0], p.p[2]); }); W.wait = away.map(m => m.name).join(', '); if (!away.length) { W.ph = 'fin'; ev({ k: 'fin' }); } } else W.wait = ''; }
  syncRV();
}
function pushBy(p, dt) { if (!p || p.m !== 'out' || !p.pu || car.speed > 5) return; T1.set(p.p[0], car.pos.y, p.p[2]); car.impulse(T1, T2.set(p.pu[0], 0.05, p.pu[1]).multiplyScalar((G.crew.length < 2 ? 5200 : 2600) * dt)); }
function holders(key) { const out = []; const mp = myPose(); if (mp && mp.h === key) out.push(myId()); for (const id in G.poses) if (G.poses[id].h === key) out.push(id); return out; }
function flatTyre(i, why) { if (W.flat[i]) return; W.flat[i] = 1; W.stats.flats++; ev({ k: 'pop', i }); say2('FLAT TYRE!', why + ': swap it for the spare (on the back of the camper)'); }
function tow(free) {
  const S = G.S, c = car; let s = S.checks[0]; for (const k of S.checks) if (k <= W.prog + 5) s = k;
  // carry the people inside along
  c.place(s, 0); c.w.set(0, 0, 0); if (!free) W.pen += 60; else W.pen += 60; W.tows++; if (W.fuel < 0.08) W.fuel = 0.12;
  if (W.hook.st === 'set') { W.hook.st = 'stow'; W.hook.at = null; } ev({ k: 'tow' }); if (!free) say2('TOW TRUCK', 'back on the road (+60 s)');
}
function stepItems(dt) {
  const S = G.S, aL = RV.aL;
  for (const it of G.items.values()) {
    if (it.h) continue;
    if (it.f === 'r') { // loose things in the camper slide about when it brakes and corners
      if (it.p[2] < -4.4 || Math.abs(it.p[0]) > 1.4 || (it.p[1] > FL + 0.4 && RV.up > 0.3)) continue; // the spare on the back and things on the dash stay put
      it.v = it.v || [0, 0, 0]; it.v[0] -= aL.x * dt * 0.55; it.v[2] -= aL.z * dt * 0.55; const fr = Math.exp(-dt * 3); it.v[0] *= fr; it.v[2] *= fr;
      it.p[0] = clamp(it.p[0] + it.v[0] * dt, RVL.box[0], RVL.box[1]); it.p[2] = clamp(it.p[2] + it.v[2] * dt, RVL.box[2], RVL.box[3] + 0.2);
      if (RV.up < 0.3) { it.f = 'w'; const w = toW(lv(it.p), new V3()); it.p = [w.x, w.y, w.z]; it.v = [RV.vel.x, 2, RV.vel.z]; }
      continue;
    }
    if (it.v) { it.v[1] -= 18 * dt; for (let i = 0; i < 3; i++) it.p[i] += it.v[i] * dt; const gy = S.heightAt(it.p[0], it.p[2]) + 0.12, wl = waterAt(it.p[0], it.p[2]);
      if (wl !== null && it.p[1] < wl && gy < wl) { it.v = null; it.p[1] = wl + 0.05; it.wet = 1; if (it.lit) { it.lit = 0; ev({ k: 'fizz', p: it.p }); } }
      else if (it.p[1] < gy) { it.p[1] = gy; if (Math.abs(it.v[1]) > 3) { it.v[1] *= -0.3; it.v[0] *= 0.5; it.v[2] *= 0.5; } else it.v = null; }
      // thrown back into the camper through the door? it lands inside
      if (it.v) { const l = toL(lv(it.p), T1); if (Math.abs(l.x) < 1.15 && l.z > -4.3 && l.z < 3.8 && l.y > FL - 0.2 && l.y < RT - 0.2) { it.f = 'r'; it.p = [l.x, FL + 0.1, l.z]; it.v = [0, 0, 0]; } }
    } else if (G.raftD && onRaft(lv(it.p))) { it.p[0] += G.raftD[0]; it.p[2] += G.raftD[1]; }
    if (it.lit) { it.lit -= dt; if (it.lit <= 0) { G.items.delete(it.id); boom(it.p[0], it.p[1], it.p[2]); } }
  }
}
function boom(x, y, z) {
  const S = G.S; W.stats.boom++; ev({ k: 'boom', p: [x, y, z] });
  let any = 0; S.boulders.forEach((b, i) => { if (b.on && Math.hypot(b.x - x, b.z - z) < 9) { b.on = false; W.bo |= 1 << i; any++; } });
  if (any) { W.db = 1; if (S.boulders.every(b => !b.on)) say2('ROAD CLEAR!', 'watch the sharp rocks: go slow'); }
  if (!W.logGone) { const L = S.log; for (let u = 0; u <= 1; u += 0.1) if (Math.hypot(lerp(L.ax, L.bx, u) - x, lerp(L.az, L.bz, u) - z) < 5) { W.logGone = 1; S.logs = []; if (W.hook.at && W.hook.at.t === 'log') { W.hook.st = 'free'; W.hook.at = null; } say2('KABOOM', "that's one way to clear a tree"); break; } }
  const d = car.pos.distanceTo(T1.set(x, y, z)); if (d < 12) { const dir = T2.subVectors(car.pos, T1).normalize(); dir.y += 0.6; car.impulse(T1.copy(car.pos).addScaledVector(dir, -1), dir.multiplyScalar((12 - d) * 2600)); car.dmg = Math.min(1, car.dmg + (12 - d) * 0.02); }
  for (const it of G.items.values()) if (!it.h && it.f === 'w') { const dd = Math.hypot(it.p[0] - x, it.p[2] - z); if (dd < 7) it.v = [(it.p[0] - x) / dd * (7 - dd) * 2, 4 + (7 - dd), (it.p[2] - z) / dd * (7 - dd) * 2]; }
}
function stepHolds(dt) {
  const S = G.S, set = G.set;
  // the bridge crank (on the far bank)
  const cr = holders('crank').length; if (cr && W.br.c < 1) { W.br.c = Math.min(1, W.br.c + dt / 7 * Math.min(2, cr)); W.hp.crank = W.br.c; if (W.br.c >= 1) say2('BRIDGE COMING DOWN', 'stand clear'); }
  if (W.br.c >= 1) W.br.a = Math.max(0, W.br.a - dt / 3.5);
  // the ferry crank
  const fr = holders('ferry').length;
  if (fr && !G.frWas) W.fe.dir = W.fe.p < 0.5 ? 1 : -1; G.frWas = fr;
  if (fr) { const a = raftFrame(); W.fe.p = clamp(W.fe.p + W.fe.dir * dt * 1.6 * Math.min(2, fr) / (S.sAll.dock1 - S.sAll.dock0 - 15.2), 0, 1); const b = raftFrame(); G.raftD = [b.x - a.x, b.z - a.z]; ev2raft(G.raftD); }
  // pouring fuel, changing a wheel
  for (const key of ['pour', 'tyre0', 'tyre1', 'tyre2', 'tyre3']) {
    const hs = holders(key); if (!hs.length) { if (W.hp[key]) W.hp[key] = Math.max(0, W.hp[key] - dt); continue; }
    const it = heldBy(hs[0]); if (!it || it.k !== (key === 'pour' ? 'can' : 'tyre')) continue;
    W.hp[key] = (W.hp[key] || 0) + dt / (key === 'pour' ? 2.6 : 3.6);
    if (W.hp[key] >= 1) { W.hp[key] = 0; G.items.delete(it.id); if (key === 'pour') { W.fuel = Math.min(1, W.fuel + 0.42); W.stats.cans++; say2('GLUG GLUG GLUG', 'fuel ' + Math.round(W.fuel * 100) + '%'); } else { W.flat[+key[4]] = 0; say2('WHEEL CHANGED', 'good as new'); } }
  }
}
function ev2raft(d) { G.raftMove = d; }
function updLog() { const S = G.S, L = S.log, cx = (L.ax + L.bx) / 2, cz = (L.az + L.bz) / 2; L.top = S.terrainAt(cx, cz) + L.rad * 2; L.len = Math.hypot(L.bx - L.ax, L.bz - L.az); }
function onRaft(p) { const f = raftFrame(), dx = p.x - f.x, dz = p.z - f.z, u = dx * f.fx + dz * f.fz, v = dx * -f.fz + dz * f.fx; return Math.abs(u) < 7.4 && Math.abs(v) < G.S.HW + 1 && Math.abs(p.y - G.S.ferryY) < 3.5; }
function waterAt(x, z) { const S = G.S, r = S.riverD(x, z); if (r.d < S.river.w + 5 && Math.abs(r.u) < 900) return S.river.water; if (S.lakeD(x, z) < 0.25) return S.lake.water; return null; }
// ---------- snapshots ----------
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
function packSnap() {
  const c = car, H = W.hook;
  return { t: 'snap', rv: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), r3(c.q.x), r3(c.q.y), r3(c.q.z), r3(c.q.w), r2(c.v.x), r2(c.v.y), r2(c.v.z)], st: r2(c.steer), rpm: c.rpm | 0, th: r2(c.thr), c: c.wh.map(w => r2(w.comp)), g: c.gear, pr: r2(c.prog), lat: r2(c.lat), rd: r2(c.roadD),
    it: [...G.items.values()].map(i => [i.id, i.k, i.h, i.f, r2(i.p[0]), r2(i.p[1]), r2(i.p[2]), i.lit ? r2(i.lit) : 0]),
    w: { seats: W.seats, hook: { st: H.st, by: H.by, p: H.p.map(r2), at: H.at, L: r2(H.L) }, fuel: r3(W.fuel), flat: W.flat, logGone: W.logGone, log: [r2(G.S.log.ax), r2(G.S.log.az), r2(G.S.log.bx), r2(G.S.log.bz)], br: { c: r2(W.br.c), a: r2(W.br.a) }, bo: W.bo, db: W.db, fe: { p: r3(W.fe.p), dir: W.fe.dir }, hp: W.hp, ph: W.ph, tm: r2(W.tm), pen: W.pen, tows: W.tows, radio: W.radio, prog: r2(W.prog), dyn: W.dyn, reel: W.reel, ten: r2(W.ten), stats: W.stats, wait: W.wait || '' },
    ev: G.ev.splice(0) };
}
Net.on('snap', m => {
  if (!G.on || isHost()) return; m.rt = performance.now(); G.buf.push(m); if (G.buf.length > 30) G.buf.shift();
  const old = W.fe.p; Object.assign(W, m.w); const S = G.S; [S.log.ax, S.log.az, S.log.bx, S.log.bz] = m.w.log; S.logs = W.logGone ? [] : [S.log]; S.boulders.forEach((b, i) => { b.on = !(W.bo & (1 << i)); });
  updLog(); if (W.fe.p !== old) { const a = raftAt(old), b = raftAt(W.fe.p); G.raftMove = [b.x - a.x, b.z - a.z]; }
  const seen = new Set(); for (const a of m.it) { seen.add(a[0]); let it = G.items.get(a[0]); if (!it) G.items.set(a[0], it = { id: a[0] }); Object.assign(it, { k: a[1], h: a[2], f: a[3], p: [a[4], a[5], a[6]], lit: a[7] }); }
  for (const id of [...G.items.keys()]) if (!seen.has(id)) G.items.delete(id);
  for (const e of m.ev || []) onEvent(e);
});
function raftAt(p) { const o = W.fe.p; W.fe.p = p; const f = raftFrame(); W.fe.p = o; return f; }
Net.on('pose', (m, from) => { if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId()) return; G.poses[id] = m; m.rt = performance.now(); });
function myPose() {
  const p = { t: 'pose', m: ME.mode, p: [r2(ME.p.x), r2(ME.p.y), r2(ME.p.z)], y: r2(ME.yaw), pi: r2(ME.pitch), h: ME.hold, cr: ME.crouch ? 1 : 0, s: ME.seat, wk: ME.walk || 0 };
  if (ME.mode === 'seat' && ME.seat === 0) p.in = ME.inp;
  const it = heldBy(myId()); if (it && it.k === 'remote') p.r = MB[0] ? 1 : MB[2] ? -1 : 0;
  if (ME.push) p.pu = ME.push;
  return p;
}
function driveInput(dt) { const st = (KEYS.has('KeyA') || KEYS.has('ArrowLeft') ? 1 : 0) - (KEYS.has('KeyD') || KEYS.has('ArrowRight') ? 1 : 0); G.steerS = lerp(G.steerS || 0, st, 1 - Math.exp(-dt * 9)); return [r2(G.steerS), KEYS.has('KeyW') || KEYS.has('ArrowUp') ? 1 : 0, KEYS.has('KeyS') || KEYS.has('ArrowDown') ? 1 : 0, KEYS.has('Space') ? 1 : 0]; }
// ---------- events (all clients) ----------
function onEvent(e) {
  if (e.k === 'say') toast(e.a, e.b, 3800);
  else if (e.k === 'horn') { Sfx.horn(); }
  else if (e.k === 'quack') quack(e.p);
  else if (e.k === 'crash') { Sfx.crash(e.v); if (ME.mode !== 'out') { G.shake = Math.min(1, e.v / 10); ME.v.z += 0; } }
  else if (e.k === 'pop') { Sfx.crash(6); Sfx.burst(0.6, 2400, 0.3, 'highpass'); G.shake = 0.4; }
  else if (e.k === 'snap') { Sfx.crash(8); }
  else if (e.k === 'tow') { G.buf.length = 0; G.shake = 0.3; $('fade').style.opacity = 0.8; setTimeout(() => $('fade').style.opacity = 0, 700); }
  else if (e.k === 'splash') { for (let i = 0; i < 40; i++) World.puff(e.p[0] + (Math.random() - 0.5) * 4, e.p[1], e.p[2] + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 5, 3 + Math.random() * 5, (Math.random() - 0.5) * 5, 1.2, 1.4, 0.85, 0.9, 0.95); Sfx.burst(0.6, 600, 0.8); }
  else if (e.k === 'fizz') Sfx.burst(0.2, 3000, 0.4, 'highpass');
  else if (e.k === 'boom') {
    const [x, y, z] = e.p; Sfx.crash(22); Sfx.burst(0.9, 120, 1.4); Sfx.burst(0.7, 700, 0.6);
    for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, sp = 2 + Math.random() * 9; World.puff(x, y + 0.5, z, Math.cos(a) * sp, 2 + Math.random() * 8, Math.sin(a) * sp, 1.5 + Math.random() * 2, 1.6 + Math.random() * 1.6, 0.45, 0.42, 0.38); }
    for (let i = 0; i < 18; i++) World.puff(x, y + 0.6, z, (Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6, 1.2, 0.35, 1.6, 1.0, 0.4);
    const me = myWorld(T1), d = me.distanceTo(T2.set(x, y, z)); G.shake = Math.max(G.shake || 0, clamp(1.4 - d / 30, 0, 1)); G.flash = clamp(1 - d / 40, 0, 0.8);
    if (d < 10) { if (ME.mode === 'roof') toOut(); if (ME.mode === 'out') { const dir = T3.subVectors(me, T2).setY(0).normalize(); ME.v.x += dir.x * (10 - d) * 2.2; ME.v.z += dir.z * (10 - d) * 2.2; ME.v.y += 3 + (10 - d) * 1.2; ME.ground = false; ME.tumble = 1; } }
  }
  else if (e.k === 'fin') { setTimeout(showFinish, 2500); toast('WE MADE IT!', 'Lakeside Camp', 4000); }
}
// ---------- the local player ----------
function eyeWorld(out) {
  const eh = ME.mode === 'seat' ? 1.32 : ME.crouch ? 1.05 : 1.62;
  if (ME.mode === 'out') return out.set(ME.p.x, ME.p.y + eh, ME.p.z);
  return toW(T3.set(ME.p.x, ME.p.y + eh, ME.p.z), out);
}
function myWorld(out) { return ME.mode === 'out' ? out.copy(ME.p) : toW(ME.p, out); }
function toOut(vel) { // leave the camper's frame (fall off the roof, get thrown out)
  const w = toW(ME.p, new V3()), pv = T2.crossVectors(car ? car.w : new V3(), T3.subVectors(w, RV.pos)).add(RV.vel);
  ME.mode = 'out'; ME.p.copy(w); ME.v.copy(vel || pv); ME.yaw += rvHeading(); ME.ground = false; ME.seat = -1;
}
function toLocal(mode, lp) { const h = rvHeading(); ME.mode = mode; ME.p.copy(lp); ME.v.set(0, 0, 0); ME.yaw -= h; }
function stepMe(dt) {
  const S = G.S, run = KEYS.has('ShiftLeft') || KEYS.has('ShiftRight'), it = heldBy(myId()), heavy = it && (it.k === 'tyre' || it.k === 'can') ? 0.78 : 1;
  let mx = (KEYS.has('KeyA') ? 1 : 0) - (KEYS.has('KeyD') ? 1 : 0), mz = (KEYS.has('KeyW') ? 1 : 0) - (KEYS.has('KeyS') ? 1 : 0); const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
  const spd = (ME.crouch ? 1.8 : run ? 6.4 : 3.9) * heavy, fx = Math.sin(ME.yaw), fz = Math.cos(ME.yaw), wx = fx * mz + Math.cos(ME.yaw) * mx, wz = fz * mz - Math.sin(ME.yaw) * mx;
  ME.push = null; ME.walk = Math.hypot(mx, mz) > 0.1 ? 1 : 0;
  if (ME.mode === 'seat') { const sp = RVL.seats[ME.seat]; ME.p.set(sp[0], FL + 0.08, sp[1]); ME.yaw = clamp(ME.yaw, -2.2, 2.2); return; }
  if (ME.mode === 'in' || ME.mode === 'roof') {
    const roof = ME.mode === 'roof', aL = RV.aL, grip = roof ? (ME.crouch ? 0.35 : 1.0) : 0.7;
    // the camper's acceleration throws you about: brake hard and everyone stumbles forward
    ME.v.x -= aL.x * dt * grip; ME.v.z -= aL.z * dt * grip;
    if (roof) ME.v.z -= Math.max(0, RV.speed - 12) ** 2 * 0.004 * dt * (ME.crouch ? 0.3 : 1); // wind on the roof
    const k = 1 - Math.exp(-dt * (ME.ground ? 10 : 1)); ME.v.x += (wx * spd - ME.v.x) * k * (ME.walk || ME.ground ? 1 : 0); ME.v.z += (wz * spd - ME.v.z) * k * (ME.walk || ME.ground ? 1 : 0);
    let nx = ME.p.x + ME.v.x * dt, nz = ME.p.z + ME.v.z * dt;
    if (!roof) {
      const B = RVL.box, R = 0.25; nx = clamp(nx, B[0] + R, B[1] - R); nz = clamp(nz, B[2] + R, B[3] - R);
      // furniture: step onto low things, bump into tall ones
      let fy = FL; for (const f of RVL.furn) { if (nx > f[0] - R && nx < f[1] + R && nz > f[2] - R && nz < f[3] + R) { if (f[4] - ME.p.y < 0.52) fy = Math.max(fy, f[4]); else { const ox = Math.min(nx - (f[0] - R), f[1] + R - nx), oz = Math.min(nz - (f[2] - R), f[3] + R - nz); if (ox < oz) nx = nx - (f[0] + f[1]) / 2 > 0 ? f[1] + R : f[0] - R; else nz = nz - (f[2] + f[3]) / 2 > 0 ? f[3] + R : f[2] - R; } } }
      ME.p.x = nx; ME.p.z = nz; if (KEYS.has('Space') && ME.ground) { ME.v.y = 3.6; ME.ground = false; }
      ME.v.y -= 18 * dt; ME.p.y += ME.v.y * dt; if (ME.p.y <= fy) { ME.p.y = fy; ME.v.y = 0; ME.ground = true; } if (ME.p.y > RT - 1.75) { ME.p.y = RT - 1.75; ME.v.y = Math.min(0, ME.v.y); }
      if (RV.up < 0.35) { ME.tumble = 1; }
    } else {
      ME.p.x = nx; ME.p.z = nz; if (KEYS.has('Space') && ME.ground) { ME.v.y = 4.5; ME.ground = false; } ME.v.y -= 18 * dt; ME.p.y += ME.v.y * dt; if (ME.p.y <= RT) { ME.p.y = RT; ME.v.y = 0; ME.ground = true; }
      G.statsMe.roof += dt;
      if (Math.abs(ME.p.x) > 1.3 || ME.p.z < -4.6 || ME.p.z > 4.4 || RV.up < 0.5) { toOut(); W2.fell++; if (RV.speed > 5) toast('WHOOPS', 'you fell off the roof', 1800); }
    }
    return;
  }
  // ---- on foot outside ----
  const wl = waterAt(ME.p.x, ME.p.z), gy = groundFor(ME.p.x, ME.p.z, ME.p.y), swim = wl !== null && gy < wl - 1.2 && ME.p.y < wl - 1.0;
  const mud = S.zoneAt && (() => { const q = S.near(ME.p.x, ME.p.z, 8); return q && S.zoneAt(q.s) && q.d < S.HW + 2; })();
  const sp2 = swim ? 2.1 : mud ? spd * 0.6 : spd, k = 1 - Math.exp(-dt * (ME.ground || swim ? 9 : 0.8));
  if (ME.tumble > 0) ME.tumble -= dt;
  else { ME.v.x += (wx * sp2 - ME.v.x) * k; ME.v.z += (wz * sp2 - ME.v.z) * k; }
  if (KEYS.has('Space') && (ME.ground || swim)) { ME.v.y = swim ? 3 : 6.2; ME.ground = false; }
  ME.v.y -= 18 * dt; if (swim) { ME.v.y += (wl - 1.25 - ME.p.y) * 30 * dt; ME.v.y *= 1 - dt * 4; }
  let nx = ME.p.x + ME.v.x * dt, nz = ME.p.z + ME.v.z * dt, ny = ME.p.y + ME.v.y * dt;
  // things in the way: trees, boulders, buildings, the fallen tree
  const R = 0.32;
  for (const t of S.treesNear(nx, nz, G.tn || (G.tn = []))) { if (t.kind === 6 || (t.kind === 8 && !t.post)) continue; const dx = nx - t.x, dz = nz - t.z, rr = t.r + R, d = Math.hypot(dx, dz); if (d < rr && d > 1e-3 && ny < t.y + 6) { nx = t.x + dx / d * rr; nz = t.z + dz / d * rr; } }
  for (const b of S.boulders) if (b.on) { const dx = nx - b.x, dz = nz - b.z, rr = b.r + R, d = Math.hypot(dx, dz); if (d < rr && d > 1e-3 && ny < b.y + b.r * 1.1) { nx = b.x + dx / d * rr; nz = b.z + dz / d * rr; } }
  for (const b of S.pbox) { const dx = nx - b.x, dz = nz - b.z, a = dx * Math.sin(b.h) + dz * Math.cos(b.h), c = dx * -Math.cos(b.h) + dz * Math.sin(b.h), A = b.a + R, Bb = b.b + R; if (Math.abs(a) < A && Math.abs(c) < Bb && ny < b.y1 - 0.45 && ny + 1.7 > b.y0) { const oa = A - Math.abs(a), oc = Bb - Math.abs(c); let na = a, nc = c; if (oa < oc) na = Math.sign(a) * A; else nc = Math.sign(c) * Bb; nx = b.x + Math.sin(b.h) * na - Math.cos(b.h) * nc; nz = b.z + Math.cos(b.h) * na + Math.sin(b.h) * nc; } }
  if (!W.logGone) { const L = S.log, ex = L.bx - L.ax, ez = L.bz - L.az, ll = ex * ex + ez * ez, t = clamp(((nx - L.ax) * ex + (nz - L.az) * ez) / ll, 0, 1), px = L.ax + ex * t, pz = L.az + ez * t, d = Math.hypot(nx - px, nz - pz), top = S.terrainAt(px, pz) + L.rad * 2; if (d < L.rad + R && ny < top - 0.4 && d > 1e-3) { nx = px + (nx - px) / d * (L.rad + R); nz = pz + (nz - pz) / d * (L.rad + R); } }
  // the camper: you can't walk through it, it shoves you if it drives into you, and you can push it
  { const l = toL(T1.set(nx, ny, nz), new V3()), hx = 1.3 + R, z0 = -4.55 - R, z1 = 5.1 + R, bot = -1.1, top = RT + 0.1;
    if (Math.abs(l.x) < hx && l.z > z0 && l.z < z1 && l.y > bot - 1.6 && l.y < top) {
      if (l.y > top - 0.6 && ME.v.y <= 0) { toLocal('roof', T2.set(l.x, RT, l.z)); return; } // landed on the roof
      const ox = hx - Math.abs(l.x), o0 = l.z - z0, o1 = z1 - l.z; if (ox < Math.min(o0, o1)) l.x = Math.sign(l.x) * hx; else if (o0 < o1) l.z = z0; else l.z = z1;
      const w = toW(l, T2); nx = w.x; nz = w.z;
      const pv = T3.crossVectors(car ? car.w : new V3(), T1.set(nx - RV.pos.x, 0, nz - RV.pos.z)).add(RV.vel); if (pv.length() > 2.5) { ME.v.x = pv.x * 1.15; ME.v.z = pv.z * 1.15; ME.v.y = Math.max(ME.v.y, 2); ME.tumble = 0.6; G.shake = 0.3; }
      else if (ME.walk) ME.push = [r2(wx), r2(wz)];
    } }
  // ride the raft
  if (G.raftMove && onRaft(ME.p)) { nx += G.raftMove[0]; nz += G.raftMove[1]; }
  const g2 = groundFor(nx, nz, ny);
  if (ny <= g2) { if (ME.v.y < -11) { G.shake = 0.5; toast('OOF', '', 900); } ny = g2; ME.v.y = 0; ME.ground = true; } else ME.ground = ny - g2 < 0.05;
  // too far from the road: the brush is too thick
  const q = S.near(nx, nz, 120); if (!q) { const p0 = S.at(RV.prog); nx += (p0.x - nx) * dt; nz += (p0.z - nz) * dt; }
  // the hook's cable only reaches so far
  if (W.hook.st === 'held' && W.hook.by === myId()) { const b = toW(lv(RVL.bumper), T1), dx = nx - b.x, dz = nz - b.z, d = Math.hypot(dx, dz); if (d > LMAX) { nx = b.x + dx / d * LMAX; nz = b.z + dz / d * LMAX; if (!G.cableSaid) { G.cableSaid = 1; toast('END OF THE CABLE', LMAX + ' m is all there is', 1500); } } else G.cableSaid = 0; }
  G.statsMe.walk += Math.hypot(nx - ME.p.x, nz - ME.p.z);
  ME.p.set(nx, ny, nz);
}
const W2 = { fell: 0 };
function groundFor(x, z, feet) {
  const S = G.S; let y = S.heightAt(x, z);
  const F = G.set.foot, ex = F.x1 - F.x0, ez = F.z1 - F.z0, ll = ex * ex + ez * ez, t = ((x - F.x0) * ex + (z - F.z0) * ez) / ll;
  if (t > 0 && t < 1) { const px = F.x0 + ex * t, pz = F.z0 + ez * t; if (Math.hypot(x - px, z - pz) < F.w) { const yb = lerp(F.y0, F.y1, t) - Math.sin(t * Math.PI) * 0.5 + 0.04; if (yb < feet + 0.6) y = Math.max(y, yb); } }
  if (!W.logGone) { const L = S.log, lx = L.bx - L.ax, lz = L.bz - L.az, tl = clamp(((x - L.ax) * lx + (z - L.az) * lz) / (lx * lx + lz * lz), 0, 1), px = L.ax + lx * tl, pz = L.az + lz * tl; if (Math.hypot(x - px, z - pz) < L.rad + 0.1) { const top = S.terrainAt(px, pz) + L.rad * 2; if (top < feet + 0.6) y = Math.max(y, top); } }
  for (const b of S.pbox) { const dx = x - b.x, dz = z - b.z, a = dx * Math.sin(b.h) + dz * Math.cos(b.h), c = dx * -Math.cos(b.h) + dz * Math.sin(b.h); if (Math.abs(a) < b.a && Math.abs(c) < b.b && b.y1 < feet + 0.55 && b.y1 > y) y = b.y1; }
  for (const b of S.boulders) if (b.on && Math.hypot(x - b.x, z - b.z) < b.r * 0.7 && b.y + b.r * 1.05 < feet + 0.6) y = Math.max(y, b.y + b.r * 1.05);
  return y;
}
// ---------- interactions ----------
// candidates near the player: the one you look at and stand closest to is shown as the prompt (E)
function targets() {
  const S = G.S, L = [], H = W.hook, it = heldBy(myId()), me = myWorld(new V3()), out = ME.mode === 'out', add = (key, label, p, r, fn, hold) => L.push({ key, label, p, r: r || 2, fn, hold });
  const rvp = l => toW(lv(l), new V3());
  if (ME.mode === 'seat') { add('up', 'Get up', eyeWorld(new V3()), 99, () => { act({ k: 'unseat' }); ME.mode = 'in'; ME.p.set(0, FL, 2.7); ME.seat = -1; }); if (ME.seat === 1) add('radio', 'Radio: ' + RADIO_NAMES[(W.radio + 1) % 4], rvp(RVL.radio), 1.4, () => act({ k: 'radio' })); return L; }
  if (ME.mode === 'in') {
    RVL.seats.forEach((sp, i) => { if (!W.seats[i] || W.seats[i] === myId()) add('seat' + i, i ? 'Sit in the passenger seat' : 'Drive', rvp([sp[0], FL + 0.6, sp[1]]), 1.6, () => { act({ k: 'seat', s: i }); ME.mode = 'seat'; ME.seat = i; ME.yaw = 0; }); });
    add('door', 'Get out', rvp([-1.1, FL + 1, RVL.door[0]]), 1.5, () => { const l = T1.set(-1.85, 0, RVL.door[0]); const w = toW(l, new V3()); w.y = groundFor(w.x, w.z, w.y + 1); ME.mode = 'out'; ME.p.copy(w); ME.v.copy(RV.vel); ME.yaw += rvHeading(); });
    add('radio', 'Radio: ' + RADIO_NAMES[(W.radio + 1) % 4], rvp(RVL.radio), 1.3, () => act({ k: 'radio' }));
  }
  if (out) {
    if (RV.speed < 6) add('door', 'Get in', rvp([-1.6, FL + 0.5, RVL.door[0]]), 1.8, () => { if (H.st === 'held' && H.by === myId()) act({ k: 'hook', op: 'drop', p: [me.x, S.heightAt(me.x, me.z) + 0.1, me.z] }); toLocal('in', T2.set(-0.75, FL, RVL.door[0])); });
    if (RV.speed < 6) add('ladder', 'Climb onto the roof', rvp([RVL.ladder[0], FL + 0.6, RVL.ladder[1] - 0.2]), 1.6, () => { toLocal('roof', T2.set(RVL.ladder[0], RT, -4.1)); });
    // winch hook
    if (H.st === 'stow' && !it) add('hook', 'Take the winch hook', rvp(RVL.bumper), 1.8, () => act({ k: 'hook', op: 'take' }));
    if ((H.st === 'free' || H.st === 'set') && !it) add('hook', H.st === 'set' ? 'Unhook' : 'Pick up the winch hook', hookPos(new V3()), 1.8, () => act({ k: 'hook', op: 'take' }));
    if (H.st === 'held' && H.by === myId()) {
      add('stow', 'Put the hook back', rvp(RVL.bumper), 1.8, () => act({ k: 'hook', op: 'stow' }));
      for (const t of S.treesNear(me.x, me.z, [])) if ((t.kind <= 3 || t.post) && Math.hypot(t.x - me.x, t.z - me.z) < 3) add('tree', t.post ? 'Hook it to the winch post' : 'Hook it round the tree', new V3(t.x, t.y + 1, t.z), 2.2 + t.r, () => act({ k: 'hook', op: 'set', at: { t: t.post ? 'post' : 'tree' }, p: [r2(t.x), r2(t.y + 0.9), r2(t.z)] }));
      if (!W.logGone) { const Lg = S.log; for (const u of [0.04, 0.5, 0.96]) add('log' + u, 'Hook the fallen tree', new V3(lerp(Lg.ax, Lg.bx, u), S.terrainAt(lerp(Lg.ax, Lg.bx, u), lerp(Lg.az, Lg.bz, u)) + 0.6, lerp(Lg.az, Lg.bz, u)), 2.4, () => act({ k: 'hook', op: 'set', at: { t: 'log', u }, p: [0, 0, 0] })); }
      S.boulders.forEach((b, i) => { if (b.on) add('bo' + i, 'Hook the boulder (it will not budge)', new V3(b.x, b.y + b.r, b.z), b.r + 1.8, () => act({ k: 'hook', op: 'set', at: { t: 'rock' }, p: [b.x, b.y + b.r * 0.6, b.z] })); });
    }
    if (G.set.crate && W.dyn > 0 && !it) add('crate', 'Take dynamite (' + W.dyn + ' left)', new V3(G.set.crate.x, G.set.crate.y + 0.6, G.set.crate.z), 1.8, () => act({ k: 'take' }));
    if (W.br.c < 1) add('crank', 'Crank the bridge down', new V3(G.set.crank.x, G.set.crank.y, G.set.crank.z), 1.8, null, 'crank');
    { const f = raftFrame(), cw = new V3(f.x + Math.cos(f.h) * (S.HW - 0.2), S.ferryY + 1.1, f.z - Math.sin(f.h) * (S.HW - 0.2)); add('ferry', 'Crank the ferry', cw, 1.8, null, 'ferry'); }
    if (it && it.k === 'can') add('pour', 'Pour in the fuel', rvp(RVL.cap), 1.8, null, 'pour');
    if (it && it.k === 'tyre') W.flat.forEach((f, i) => { if (f) add('tyre' + i, 'Change the flat wheel', rvp(CAR.wheels[i]), 1.9, null, 'tyre' + i); });
    if (RV.up < 0.6) add('flip', 'Heave it back on its wheels', rvp([0, FL + 0.8, 0]), 4.5, null, 'flip');
  }
  if (ME.mode === 'roof') add('ladder', 'Climb down', rvp([RVL.ladder[0], RT + 0.3, -4.3]), 1.4, () => { const w = toW(T1.set(RVL.ladder[0], 0, RVL.ladder[1] - 0.5), new V3()); ME.mode = 'out'; ME.p.set(w.x, groundFor(w.x, w.z, 999), w.z); ME.v.copy(RV.vel); ME.yaw += rvHeading(); });
  // loose items
  if (!it && !(H.st === 'held' && H.by === myId())) for (const x of G.items.values()) { if (x.h || x.lit) continue; const p = x.f === 'r' ? rvp(x.p) : new V3(...x.p); if (x.f === 'r' && x.p[2] < -4.4 && ME.mode !== 'out') continue; add('it' + x.id, 'Pick up the ' + ITEM_NAME[x.k], p, 1.9, () => act({ k: 'pick', id: x.id })); }
  return L;
}
function pickTarget() {
  const e = eyeWorld(new V3()), dir = new V3(0, 0, 1); TE.set(ME.pitch, ME.yaw, 0); dir.applyEuler(TE); if (ME.mode !== 'out') dir.applyQuaternion(RV.q);
  let best = null, bs = 1e9; const me = myWorld(new V3());
  for (const t of targets()) { if (t.r >= 99) { if (!best) { best = t; bs = 50; } continue; } const d = t.p.distanceTo(me.clone().setY(me.y + 1)), d2 = Math.hypot(t.p.x - me.x, t.p.z - me.z); if (Math.min(d, d2 + Math.max(0, Math.abs(t.p.y - me.y - 0.9) - 1.3)) > t.r) continue; const to = T1.subVectors(t.p, e).normalize(), dot = to.dot(dir); if (dot < 0.35 && d > 1.0) continue; const sc = d * (1.6 - dot); if (sc < bs) { bs = sc; best = t; } }
  return best;
}
function useHeld() {
  const it = heldBy(myId()); if (!it) return;
  if (it.k === 'duck') { const w = handWorld(new V3()); act({ k: 'quack', p: [r2(w.x), r2(w.y), r2(w.z)] }); return; }
  if (it.k === 'remote') return; // held: reel
  throwHeld(it.k === 'dyn');
}
function throwHeld(lit) {
  const it = heldBy(myId()); if (!it) return; const h = handWorld(new V3()), d = new V3(0, 0, 1); TE.set(ME.pitch + 0.25, ME.yaw, 0); d.applyEuler(TE); if (ME.mode !== 'out') d.applyQuaternion(RV.q);
  const sp = it.k === 'dyn' ? 13 : 7, base = ME.mode === 'out' ? ME.v : RV.vel; act({ k: 'drop', f: 'w', p: [r2(h.x), r2(h.y), r2(h.z)], v: [r2(d.x * sp + base.x), r2(d.y * sp + base.y + 1), r2(d.z * sp + base.z)], lit: lit ? 1 : 0 });
  if (lit) { Sfx.burst(0.3, 3500, 0.5, 'highpass'); toast('FIRE IN THE HOLE', 'run!', 1500); }
}
function dropHeld() {
  const H = W.hook; if (H.st === 'held' && H.by === myId()) { const w = handWorld(new V3()); act({ k: 'hook', op: 'drop', p: [r2(w.x), r2(G.S.heightAt(w.x, w.z) + 0.1), r2(w.z)] }); return; }
  const it = heldBy(myId()); if (!it) return;
  if (ME.mode === 'in') { T1.set(ME.p.x + Math.sin(ME.yaw) * 0.5, FL + 0.12, ME.p.z + Math.cos(ME.yaw) * 0.5); T1.x = clamp(T1.x, RVL.box[0], RVL.box[1]); T1.z = clamp(T1.z, RVL.box[2], RVL.box[3]); act({ k: 'drop', f: 'r', p: [r2(T1.x), r2(T1.y), r2(T1.z)] }); }
  else if (ME.mode === 'roof' || ME.mode === 'seat') { const l = ME.mode === 'roof' ? T1.set(ME.p.x, RT + 0.1, ME.p.z) : T1.set(0, FL + 0.12, 2.7); act({ k: 'drop', f: 'r', p: [r2(l.x), r2(l.y), r2(l.z)] }); }
  else { const x = ME.p.x + Math.sin(ME.yaw) * 0.6, z = ME.p.z + Math.cos(ME.yaw) * 0.6; act({ k: 'drop', f: 'w', p: [r2(x), r2(groundFor(x, z, ME.p.y + 0.5) + 0.12), r2(z)] }); }
}
function stepInteract(dt) {
  const t = pickTarget(), e = KEYS.has('KeyE');
  G.tgt = t;
  if (t && t.hold) { ME.hold = e ? t.hold : ''; } else ME.hold = '';
  if (e && !ME.eDown && t && t.fn) t.fn();
  ME.eDown = e;
  // R: respawn at the camper when you are lost, or call the tow truck
  if (KEYS.has('KeyR')) { ME.rT += dt; if (ME.rT > 1.4) { ME.rT = -99; if (ME.mode === 'out' && myWorld(T1).distanceTo(RV.pos) > 25) { toLocal('in', T2.set(0, FL, 0.5)); toast('BACK AT THE CAMPER', '', 1500); } else act({ k: 'tow' }); } } else ME.rT = 0;
}
// ---------- audio extras: winch motor, quack, radio ----------
const RADIO_NAMES = ['off', 'Country Roads FM', 'Lo-fi Trucker', 'Polka Power'];
function quack(p) { if (!Sfx.on) return; const C = Sfx.ctx, t = C.currentTime, d = p ? myWorld(T1).distanceTo(T2.set(p[0], p[1], p[2])) : 0, v = clamp(1 - d / 40, 0.05, 1); for (const [f, dt] of [[620, 0], [560, 0.09]]) { const o = C.createOscillator(), g = C.createGain(), bp = C.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t + dt); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dt + 0.12); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3; g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.25 * v, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.14); o.connect(bp); bp.connect(g); g.connect(Sfx.out); o.start(t + dt); o.stop(t + dt + 0.2); } }
const Winch = { g: null, o: null, update(on, ten) { if (!Sfx.on) return; const C = Sfx.ctx; if (!this.o) { this.o = C.createOscillator(); this.o.type = 'sawtooth'; const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; this.g = C.createGain(); this.g.gain.value = 0; this.o.connect(lp); lp.connect(this.g); this.g.connect(Sfx.out); this.o.start(); } this.g.gain.setTargetAtTime(on ? 0.05 + ten * 0.05 : 0, C.currentTime, 0.05); this.o.frequency.setTargetAtTime(110 - ten * 40, C.currentTime, 0.05); } };
const Radio = {
  st: 0, nt: 0, i: 0, g: null,
  songs: [null, { bpm: 104, ch: [[57, 61, 64], [62, 66, 69], [57, 61, 64], [64, 68, 71]], w: 'triangle', bass: 1 }, { bpm: 78, ch: [[60, 63, 67, 70], [58, 62, 65, 69], [56, 60, 63, 67], [55, 59, 62, 65]], w: 'sine', bass: 1 }, { bpm: 132, ch: [[60, 64, 67], [55, 59, 62], [60, 64, 67], [55, 59, 62]], w: 'square', oom: 1 }],
  stop() { this.st = 0; },
  update(want, vol) {
    if (!Sfx.on) return; const C = Sfx.ctx; if (!this.g) { this.g = C.createGain(); this.g.connect(Sfx.out); }
    this.g.gain.setTargetAtTime(want ? 0.11 * vol : 0, C.currentTime, 0.2);
    if (want !== this.st) { this.st = want; this.nt = C.currentTime + 0.05; this.i = 0; }
    const S = this.songs[this.st]; if (!S) return; const b = 60 / S.bpm / 2;
    while (this.nt < C.currentTime + 0.25) {
      const bar = Math.floor(this.i / 8) % 4, st = this.i % 8, ch = S.ch[bar], t = this.nt, f = n => 440 * Math.pow(2, (n - 69) / 12);
      const note = (n, d, v, w) => { const o = C.createOscillator(), g = C.createGain(); o.type = w; o.frequency.value = f(n); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.g); o.start(t); o.stop(t + d + 0.05); };
      if (S.oom) { if (st % 2 === 0) note(ch[0] - 24, b * 0.9, 0.5, 'triangle'); else ch.forEach(n => note(n, b * 0.5, 0.12, 'square')); if (st === 3 || st === 7) note(ch[(st >> 1) % 3] + 12, b * 0.8, 0.15, 'square'); }
      else { if (S.bass && st % 4 === 0) note(ch[0] - 24, b * 3, 0.45, 'triangle'); note(ch[[0, 1, 2, 1, 0, 2, 1, 2][st] % ch.length] + (st > 5 ? 12 : 0), b * 1.6, 0.2, S.w); if (this.st === 2 && st % 4 === 2) { const nb = C.createBufferSource(); nb.buffer = Sfx.noiseBuf; const g = C.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); nb.connect(g); g.connect(this.g); nb.start(t); nb.stop(t + 0.1); } }
      this.nt += b; this.i++;
    }
  },
};
// ---------- rendering ----------
function render(dt) {
  const S = G.S, set = G.set, cm = G.cam, me = myId();
  cm.g.position.copy(RV.pos); cm.g.quaternion.copy(RV.q);
  cm.wheels.forEach((w, i) => { const a = w.userData.a; w.position.set(a[0], a[1] - (CAR.rest - (RV.comp[i] || 0)) - (W.flat[i] ? 0.17 : 0), a[2]); w.rotation.y = i < 2 ? RV.st : 0; w.userData.sp.rotation.x += RV.vel.dot(T1.set(0, 0, 1).applyQuaternion(RV.q)) / CAR.r * dt; w.userData.sp.scale.y = W.flat[i] ? 0.8 : 1; });
  cm.steer.rotation.z = -RV.st * 4; cm.rled.material.emissiveIntensity = W.radio ? 2.5 : 0.1;
  // the door opens when someone is near it
  let near = false; const dw = toW(T1.set(-1.3, FL + 1, RVL.door[0]), new V3()); for (const p of allBodies()) if (p.distanceTo(dw) < 2.2) near = true; cm.door.rotation.y = lerp(cm.door.rotation.y, near ? 1.7 : 0, 1 - Math.exp(-dt * 6));
  // set pieces
  const L = S.log; set.log.visible = !W.logGone; if (!W.logGone) { const cx = (L.ax + L.bx) / 2, cz = (L.az + L.bz) / 2; set.log.position.set(cx, S.terrainAt(cx, cz) + L.rad * 0.95, cz); set.log.rotation.y = Math.atan2(-(L.az - L.bz), L.ax - L.bx); }
  S.boulders.forEach((b, i) => set.boulders[i].visible = b.on); set.debris.visible = !!W.db;
  set.bridge.hinge.rotation.x = 0; set.bridge.leaf.rotation.x = W.br.a * 1.25; set.crank.wh.rotation.z = W.br.c * 40;
  { const f = raftFrame(); set.raft.position.set(f.x, S.ferryY, f.z); set.raft.rotation.y = f.h; set.raftWheel.rotation.z = W.fe.p * 60; }
  if (set.fire) { set.fire.m.scale.y = 0.85 + Math.sin(G.t * 13) * 0.1 + Math.sin(G.t * 7.3) * 0.08; set.fire.l.intensity = 2.6 + Math.sin(G.t * 11) * 0.5; if (Math.random() < dt * 8) World.puff(set.fire.x, set.fire.y + 0.9, set.fire.z, (Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4, 0.5, 2.2, 0.5, 0.5, 0.52); }
  // items
  const seen = new Set();
  for (const it of G.items.values()) {
    seen.add(it.id); let m = G.meshes.get(it.id); if (!m) { m = itemMesh(it.k); G.meshes.set(it.id, m); World.scene.add(m); }
    if (it.h === me) { if (m.parent !== World.cam) World.cam.add(m); m.position.set(0.26, -0.3, -0.55); m.rotation.set(0.2, it.k === 'tyre' ? 0.9 : Math.PI, 0); }
    else if (it.h) { const av = G.avatars[it.h]; if (av) { if (m.parent !== av.hand) av.hand.add(m); m.position.set(0, -0.05, 0.08); m.rotation.set(0, 0, 0); } else m.visible = false; }
    else { if (m.parent !== World.scene) World.scene.add(m); if (it.f === 'r') { toW(lv(it.p), m.position); m.position.y += 0.05; m.quaternion.copy(RV.q); if (it.k === 'tyre' && it.p[2] < -4.4) m.rotation.y = 0; } else { m.position.set(it.p[0], it.p[1] + (it.k === 'tyre' ? 0.3 : 0.05), it.p[2]); m.rotation.set(it.k === 'tyre' ? Math.PI / 2 : 0, it.id.charCodeAt(1), 0); if (it.wet) m.position.y += Math.sin(G.t * 2 + it.p[0]) * 0.05; } }
    m.visible = true;
    if (it.k === 'dyn' && m.userData.spark) { m.userData.spark.visible = !!it.lit; if (it.lit && Math.random() < 0.5) { const w = m.getWorldPosition(T1); World.puff(w.x, w.y + 0.25, w.z, (Math.random() - 0.5) * 1.5, 1.5, (Math.random() - 0.5) * 1.5, 0.08, 0.3, 1.6, 1.1, 0.4); if (Math.random() < 0.1) Sfx.burst(0.04, 4000, 0.05, 'highpass'); } }
  }
  for (const [id, m] of G.meshes) if (!seen.has(id)) { m.parent && m.parent.remove(m); G.meshes.delete(id); }
  // the winch hook and its cable
  { let hm = G.hookM; if (!hm) { hm = G.hookM = itemMesh('hook'); World.scene.add(hm); } const H = W.hook, hp = hookPos(new V3()); const mine = H.st === 'held' && H.by === me;
    if (mine) { if (hm.parent !== World.cam) World.cam.add(hm); hm.position.set(0.24, -0.28, -0.5); } else { if (hm.parent !== World.scene) World.scene.add(hm); hm.position.copy(hp); hm.quaternion.copy(H.st === 'stow' ? RV.q : TQ.identity()); }
    const b = toW(lv(RVL.bumper), new V3()), cab = set.cable; if (H.st === 'stow') cab.count = 0; else { const e = mine ? hm.getWorldPosition(new V3()) : hp, d = b.distanceTo(e), slack = H.st === 'set' ? Math.max(0, H.L - d) : 0.3 + d * 0.04, sag = Math.min(d * 0.25, slack * 0.45 + d * 0.012), n = cab.instanceMatrix.count, m4 = new THREE.Matrix4(), prev = b.clone(), cur = new V3(), q = new QT(), sc = new V3(), up = new V3(0, 1, 0);
      cab.count = n; for (let i = 1; i <= n; i++) { const t = i / n; cur.lerpVectors(b, e, t); cur.y -= Math.sin(t * Math.PI) * sag; const gy = S.heightAt(cur.x, cur.z) + 0.03; if (cur.y < gy) cur.y = gy; const mid = prev.clone().add(cur).multiplyScalar(0.5), dir = cur.clone().sub(prev), len = dir.length(); q.setFromUnitVectors(up, dir.normalize()); sc.set(1, len, 1); m4.compose(mid, q, sc); cab.setMatrixAt(i - 1, m4); prev.copy(cur); } cab.instanceMatrix.needsUpdate = true; } }
  // other crew
  for (const c of G.crew) { if (c.id === me) continue; const ps = G.poses[c.id]; let av = G.avatars[c.id]; if (!ps) { if (av) av.g.visible = false; continue; }
    if (!av) { av = G.avatars[c.id] = buildAvatar(CREW_COL[c.c % 8], c.name); World.scene.add(av.g); }
    av.g.visible = true; const tgt = ps.m === 'out' ? T1.set(ps.p[0], ps.p[1], ps.p[2]) : toW(T1.set(ps.p[0], ps.p[1] - (ps.m === 'seat' ? 0.45 : 0), ps.p[2]), T1);
    if (!av.at || av.at.distanceTo(tgt) > 5 || av.mode !== ps.m) av.at = tgt.clone(); else av.at.lerp(tgt, 1 - Math.exp(-dt * 14)); av.mode = ps.m;
    av.g.position.copy(av.at); TE.set(0, ps.y, 0); av.g.quaternion.setFromEuler(TE); if (ps.m !== 'out') av.g.quaternion.premultiply(RV.q);
    av.ph += dt * (ps.wk ? 9 : 0); const sw = ps.m === 'seat' ? 0 : Math.sin(av.ph) * 0.6 * (ps.wk ? 1 : 0); av.legL.rotation.x = ps.m === 'seat' ? -1.4 : sw; av.legR.rotation.x = ps.m === 'seat' ? -1.4 : -sw; av.armL.rotation.x = -sw * 0.8; av.armR.rotation.x = heldBy(c.id) || (W.hook.by === c.id && W.hook.st === 'held') ? -1.1 : sw * 0.8; av.head.rotation.x = -ps.pi * 0.6; av.g.scale.y = ps.cr ? 0.72 : 1;
    av.tag.visible = av.at.distanceTo(World.cam.position) < 120; }
  // my camera
  const eye = eyeWorld(new V3()); World.cam.position.copy(eye); TE.set(ME.pitch, ME.yaw + Math.PI, ME.tumble > 0 ? Math.sin(G.t * 9) * 0.3 * ME.tumble : 0); World.cam.quaternion.setFromEuler(TE); if (ME.mode !== 'out') World.cam.quaternion.premultiply(RV.q);
  if (G.shake > 0) { World.cam.position.x += (Math.random() - 0.5) * G.shake * 0.12; World.cam.position.y += (Math.random() - 0.5) * G.shake * 0.12; G.shake = Math.max(0, G.shake - dt * 2); }
  if (ME.mode === 'out' && ME.walk && ME.ground) { ME.bob += dt * 10; World.cam.position.y += Math.sin(ME.bob) * 0.035; }
}
function allBodies() { const L = [myWorld(new V3())]; for (const id in G.poses) { const p = G.poses[id]; L.push(p.m === 'out' ? new V3(p.p[0], p.p[1], p.p[2]) : toW(new V3(p.p[0], p.p[1], p.p[2]), new V3())); } return L; }
// ---------- HUD ----------
function toast(a, b, ms) { const el = $('toast'); el.innerHTML = '<b>' + a + '</b>' + (b ? '<span>' + b + '</span>' : ''); el.classList.add('on'); clearTimeout(G.toT); G.toT = setTimeout(() => el.classList.remove('on'), ms || 3000); }
function objective() {
  const S = G.S, A = S.sAll, s = Math.max(W.prog, RV.prog), it = heldBy(myId());
  if (W.ph === 'fin') return 'You made it to Lakeside Camp!';
  if (RV.up < 0.5) return 'The camper is on its side! Get out and hold E next to it to heave it back up (or hold R for the tow truck).';
  if (W.flat.some(f => f)) return 'Flat tyre! Take the spare wheel off the back of the camper and hold E at the flat.' + (W.flat.filter(f => f).length > 1 ? " Pete's Gas sells spares too." : '');
  if (W.fuel < 0.1) return W.fuel <= 0 ? "Out of fuel! Push the camper, or carry a jerry can from Pete's Gas and hold E at the filler cap (rear left)." : "Fuel is nearly gone. Pete's Gas is up ahead.";
  if (!W.seats[0] && RV.speed < 1 && s < A.start + 30) return 'Someone take the wheel: walk to the driver seat (front left) and press E.';
  if (!W.logGone && s < A.log + 4) return s < A.log - 70 ? 'Drive to Lakeside Camp. Bumpy road ahead.' : 'A tree is down! Back into the logging yard, take the winch hook off the front bumper, hook the tree, then hold the remote (on the dashboard) and click to reel it in.';
  if (s < A.mud0 - 30) return 'Keep going. The road climbs ahead.';
  if (s < A.mud1 + 4) return 'Too muddy to climb! Carry the winch hook up to a yellow post (or any tree) and reel the camper up. The driver can hold the remote too.';
  if (s < A.gas - 40) return "On to Pete's Gas.";
  if (s < A.gas + 40) return W.fuel < 0.5 ? "Pete's pumps are broken. Grab jerry cans from the shop and pour them in at the filler cap (rear left)." : "Pete's Gas: fill up if you need to, there's a spare wheel in the shop.";
  if (s < A.br - 40) return 'Down to the river.';
  if (W.br.c < 1 && s < A.br + 12) return 'The bridge is up! Cross the footbridge upstream (left) and hold E on the red crank on the far side.';
  if (s < A.rk - 160) return 'Up onto the cliff road.';
  if (S.boulders.some(b => b.on) && s < A.rk + 8) return "Rockslide! There's dynamite at the work site: take a stick, click to light and throw it at the rocks. Then get clear!";
  if (W.db && s < S.debris.s1) return 'Sharp rocks on the road: crawl through slowly or pop a tyre.';
  if (s < A.dock0 - 30) return 'Down the switchbacks to the lake.';
  if (W.fe.p < 0.98 && s < A.dock1) return 'Drive onto the ferry, then stand at the red wheel and hold E to crank it across.';
  if (W.wait) return 'Almost there! Waiting for: ' + W.wait;
  return 'Lakeside Camp is just ahead!';
}
function hud(dt) {
  const t = G.tgt, it = heldBy(myId()), H = W.hook;
  let pr = ''; if (t) { pr = '<kbd>E</kbd> ' + (t.hold ? 'hold: ' : '') + t.label; const hp = t.hold ? (t.hold === 'crank' ? W.br.c : W.hp[t.hold]) : 0; if (t.hold && hp > 0) pr += ' <u><i style="width:' + Math.round(hp * 100) + '%"></i></u>'; }
  if ($('prompt').innerHTML !== pr) $('prompt').innerHTML = pr;
  let hd = ''; if (it) hd = '<b>' + ITEM_NAME[it.k] + '</b> ' + (it.k === 'remote' ? 'hold <kbd>LMB</kbd> reel in · <kbd>RMB</kbd> let out' : it.k === 'dyn' ? '<kbd>LMB</kbd> light and throw' : it.k === 'duck' ? '<kbd>LMB</kbd> squeeze' : '<kbd>LMB</kbd> throw') + ' · <kbd>Q</kbd> drop'; else if (H.st === 'held' && H.by === myId()) hd = '<b>winch hook</b> E on a tree, post or the fallen tree · <kbd>Q</kbd> drop';
  if ($('held').innerHTML !== hd) $('held').innerHTML = hd;
  $('obj').textContent = objective();
  const drv = ME.mode === 'seat' && ME.seat === 0; $('spd').style.display = drv ? '' : 'none'; if (drv) $('spd').firstChild.textContent = Math.round(RV.speed * 3.6);
  $('fuelB').style.width = Math.round(W.fuel * 100) + '%'; $('fuel').classList.toggle('low', W.fuel < 0.12);
  const wn = H.st === 'set'; $('winch').style.display = wn ? '' : 'none'; if (wn) { $('winchT').style.width = Math.round(W.ten * 100) + '%'; $('winchL').textContent = H.L.toFixed(1) + ' m'; }
  $('tm').textContent = fmtT(W.tm + W.pen) + (W.pen ? '  (+' + W.pen + ' s tows)' : '');
  const A = G.S.sAll, len = A.camp - A.start; $('progF').style.width = clamp((Math.max(W.prog, RV.prog) - A.start) / len, 0, 1) * 100 + '%';
  // crew list
  if ((G.crT = (G.crT || 0) - dt) <= 0) { G.crT = 0.3; $('crew').innerHTML = G.crew.map(c => { const p = c.id === myId() ? { m: ME.mode, s: ME.seat } : G.poses[c.id] || {}; const st = W.seats[0] === c.id ? 'driving' : W.seats[1] === c.id ? 'riding shotgun' : p.m === 'roof' ? 'on the roof' : p.m === 'in' ? 'in the camper' : p.m === 'out' ? 'outside' : '...'; return '<div><i style="background:#' + CREW_COL[c.c % 8].toString(16).padStart(6, '0') + '"></i>' + c.name.replace(/[<>&]/g, '') + ' <small>' + st + '</small></div>'; }).join(''); }
  $('flash').style.opacity = G.flash || 0; G.flash = Math.max(0, (G.flash || 0) - dt * 1.5);
  if ((G.mapT = (G.mapT || 0) - dt) <= 0 && $('mapBox').classList.contains('on')) { G.mapT = 0.25; drawMap(); }
}
function drawMap() {
  const S = G.S, c = $('mapC'), x = c.getContext('2d'), W0 = c.width, H0 = c.height; x.fillStyle = '#2c3a2a'; x.fillRect(0, 0, W0, H0);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; for (const p of S.P) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
  const sc = Math.min((W0 - 40) / (mxx - mnx), (H0 - 40) / (mxz - mnz)), X = px => W0 / 2 - (px - (mnx + mxx) / 2) * sc, Y = pz => H0 / 2 + (pz - (mnz + mxz) / 2) * sc;
  x.fillStyle = '#3d6c78'; x.save(); x.translate(X(S.lake.x), Y(S.lake.z)); x.rotate(Math.atan2(S.lake.fx, S.lake.fz)); x.beginPath(); x.ellipse(0, 0, 520 * sc, S.lake.half * sc, 0, 0, 7); x.fill(); x.restore();
  x.strokeStyle = '#3d6c78'; x.lineWidth = 6; x.beginPath(); x.moveTo(X(S.river.x - S.river.dx * 700), Y(S.river.z - S.river.dz * 700)); x.lineTo(X(S.river.x + S.river.dx * 700), Y(S.river.z + S.river.dz * 700)); x.stroke();
  x.strokeStyle = '#d8c8a0'; x.lineWidth = 3; x.beginPath(); S.P.forEach((p, i) => i ? x.lineTo(X(p.x), Y(p.z)) : x.moveTo(X(p.x), Y(p.z))); x.stroke();
  const A = S.sAll, mark = (s, t, col) => { const p = S.at(s); x.fillStyle = col; x.beginPath(); x.arc(X(p.x), Y(p.z), 6, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 11px system-ui'; x.fillText(t, X(p.x) + 9, Y(p.z) + 4); };
  mark(A.start, "Grandma's", '#c84'); mark(A.log, 'fallen tree', W.logGone || W.prog > A.log + 5 ? '#4a4' : '#e44'); mark((A.mud0 + A.mud1) / 2, 'mud hill', W.prog > A.mud1 ? '#4a4' : '#e44'); mark(A.gas, "Pete's Gas", '#e93'); mark(A.br, 'bridge', W.br.c >= 1 ? '#4a4' : '#e44'); mark(A.rk, 'rockslide', S.boulders.every(b => !b.on) ? '#4a4' : '#e44'); mark(A.dock0, 'ferry', '#48c'); mark(A.camp, 'LAKESIDE CAMP', '#fc4');
  const me = myWorld(new V3()); x.fillStyle = '#fff'; x.beginPath(); x.arc(X(RV.pos.x), Y(RV.pos.z), 5, 0, 7); x.fill(); x.strokeStyle = '#' + colOf(myId()).toString(16).padStart(6, '0'); x.lineWidth = 3; x.beginPath(); x.arc(X(me.x), Y(me.z), 7, 0, 7); x.stroke();
}
function showFinish() {
  if (G.fin) return; G.fin = true; try { document.exitPointerLock(); } catch (e) {}
  const s = W.stats, rows = [['Trip time', fmtT(W.tm + W.pen)], ['Tow trucks', W.tows], ['Dynamite lit', s.boom], ['Jerry cans poured', s.cans], ['Flat tyres', s.flats], ['Cables slipped', s.snap], ['You walked', Math.round(G.statsMe.walk) + ' m'], ['You rode the roof', Math.round(G.statsMe.roof) + ' s'], ['You fell off', W2.fell + ' times']];
  $('finT').innerHTML = rows.map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
  let best = 0; try { best = +localStorage.getItem('cc-best') || 0; } catch (e) {} const t = W.tm + W.pen; if (!best || t < best) { try { localStorage.setItem('cc-best', t); } catch (e) {} $('finB').textContent = 'New best trip!'; } else $('finB').textContent = 'Best trip: ' + fmtT(best);
  $('bAgain').classList.toggle('hidden', Net.role === 'guest'); show('fin');
}
// ---------- frame ----------
function frame(now) {
  requestAnimationFrame(frame); if (!G.on) return;
  const dt = clamp((now - G.lastFrame) / 1000, 0, 0.05); G.lastFrame = now; if (dt <= 0) return; G.t += dt;
  const lastV = RV.vel.clone(); ME.inp = driveInput(dt);
  if (isHost()) { if (car) hostStep(dt); } else interpRV();
  syncRV();
  // the camper's acceleration in its own frame (what the people inside feel)
  { const a = T1.subVectors(RV.vel, lastV).divideScalar(Math.max(dt, 1e-3)); if (a.length() > 60) a.setLength(60); a.applyQuaternion(RV.qi); RV.aL.lerp(T2.set(a.x, 0, a.z), 1 - Math.exp(-dt * 10)); }
  if (W.ph === 'run' || true) { stepMe(dt); stepInteract(dt); }
  G.raftMove = null;
  // poses and snapshots
  if ((G.poseT -= dt) <= 0) { G.poseT = 0.05; if (Net.role !== 'solo') { const p = myPose(); if (isHost()) p.from = 'H'; Net.send(p); } }
  if (isHost() && Net.role === 'host' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 15; Net.send(packSnap()); } else if (isHost() && Net.role !== 'host') G.ev.length = 0;
  for (const id in G.poses) if (performance.now() - G.poses[id].rt > 8000) delete G.poses[id];
  render(dt);
  World.stepDust(dt); World.update(World.cam.position, RV.pos);
  // sound: the engine is loud inside, fades with distance outside
  { const d = myWorld(T1).distanceTo(RV.pos), inside = ME.mode !== 'out', k = inside ? 1 : clamp(1 - d / 70, 0, 1);
    Sfx.update({ rpm: RV.rpm, thr: RV.thr * k, speed: RV.speed * (inside ? 0.6 : k), slide: 0, offroad: 0, air: 0, inside: inside ? 1 : 0 }, dt); if (Sfx.on) Sfx.eg.gain.setTargetAtTime((0.08 + RV.thr * 0.2) * k * (W.fuel > 0 ? 1 : 0.1), Sfx.ctx.currentTime, 0.05);
    Winch.update(W.hook.st === 'set' && W.reel !== 0, W.ten); Radio.update(W.radio, inside ? 1 : clamp(1 - d / 25, 0, 1)); }
  // mud flung off the back wheels on the mud hill
  { const z = G.S.zoneAt(RV.prog); if (z && RV.thr > 0.3 && RV.speed < 6) for (let k = 0; k < 3; k++) { const p = toW(T1.set((Math.random() < 0.5 ? 1 : -1) * 1.06, -0.6, -2.3), new V3()); World.puff(p.x, p.y, p.z, (Math.random() - 0.5) * 3 - RV.vel.x, 2 + Math.random() * 3, (Math.random() - 0.5) * 3 - RV.vel.z, 0.35, 0.8, 0.28, 0.2, 0.12); } }
  // dust from the wheels
  if (RV.speed > 5 && Math.random() < dt * RV.speed * 0.6) { const p = toW(T1.set((Math.random() - 0.5) * 2, -0.7, -2.6), new V3()); World.puff(p.x, p.y, p.z, RV.vel.x * 0.2, 0.5, RV.vel.z * 0.2, 0.8, 1.4, ...World.B.dust); }
  hud(dt);
  World.render({ spd: 0, hurt: 0 });
}
requestAnimationFrame(frame);
window.__CC = { G, W, ME, RV, get car() { return car; }, hostStep, stepMe, syncRV, boom, tow, hookPos, raftFrame, heldBy, updLog, startGame, act, hostAct, KEYS, MB, targets, pickTarget, objective, toLocal, toOut };
if (Q.has('solo')) setTimeout(() => $('bSolo').click(), 100);
