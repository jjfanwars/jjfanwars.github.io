'use strict';
// Game flow: menu, lobby, stage build, countdown, run, finish. Driver input, navigator map and callouts, HUD.
const Q = new URLSearchParams(location.search);
const G = { on: false };
const KEYS = new Set();
const look = { yaw: 0, pitch: -0.05, map: false, idle: 0 };
let pad = null;

// ---------- menu ----------
STAGES.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.name + '  (' + (s.len / 1000).toFixed(1) + ' km, ' + s.tod + ')'; $('sStage').appendChild(o); });
try { $('nm').value = localStorage.getItem('pn-name') || ''; $('sGfx').value = localStorage.getItem('pn-gfx') || 'med'; } catch (e) {}
const myName = () => { const n = ($('nm').value || '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 14) || 'Player' + (1 + Math.random() * 99 | 0); try { localStorage.setItem('pn-name', n); localStorage.setItem('pn-gfx', $('sGfx').value); } catch (e) {} return n; };
const show = id => { for (const s of ['menu', 'lobby', 'fin']) $(s).classList.toggle('hidden', s !== id); };
const msg = (id, t) => { $(id).textContent = t || ''; };
const readCfg = () => ({ stage: +$('sStage').value, fog: +$('sFog').value, hostRole: $('sRole').value });

$('bSolo').onclick = () => { Sfx.start(); Net.close(); const c = readCfg(); c.hostRole = 'drv'; startStage(c, 'drv', true); };
$('bHost').onclick = () => {
  Sfx.start(); const name = myName(); G.cfg = readCfg(); const code = Net.host(name, s => msg('lmsg', s === 'open' ? 'Share the code. Your partner can also pick it from the room list.' : 'Connection lost, retrying...'));
  $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('bSwap').classList.remove('hidden'); msg('lmsg', 'Connecting...'); renderLobby();
};
$('bJoin').onclick = () => joinRoom($('jc').value.trim().toUpperCase());
function joinRoom(code) {
  if (!/^[A-Z]{5}$/.test(code)) { msg('msg', 'Enter the 5-letter room code.'); return; }
  Sfx.start(); Net.join(code, myName(), why => { if (G.on) { endToMenu(why); } else { show('menu'); msg('msg', why); } });
  $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); $('bSwap').classList.add('hidden'); msg('lmsg', 'Connecting...'); $('lcfg').textContent = '';
}
$('bSwap').onclick = () => { G.cfg.hostRole = G.cfg.hostRole === 'drv' ? 'nav' : 'drv'; renderLobby(); };
$('bLeave').onclick = () => { Net.close(); show('menu'); refreshRooms(); };
$('bGo').onclick = () => { if (!Net.peer) { msg('lmsg', 'Wait for your partner to join first (or play solo practice).'); return; } Net.started = true; Net.meta(false); Net.send({ t: 'start', cfg: G.cfg }); startStage(G.cfg, G.cfg.hostRole, false); };
function lobbyState() { const c = G.cfg, h = Net.name, p = Net.peer ? Net.peer.name : '(waiting...)'; return { t: 'lobby', cfg: c, drv: c.hostRole === 'drv' ? h : p, nav: c.hostRole === 'drv' ? p : h }; }
function renderLobby(s) {
  s = s || lobbyState(); const st = STAGES[s.cfg.stage];
  $('rDrv').textContent = s.drv; $('rNav').textContent = s.nav; $('lcfg').textContent = st.name + ' · ' + (st.len / 1000).toFixed(1) + ' km · ' + ['light', 'medium', 'heavy'][s.cfg.fog] + ' fog · ' + st.tod;
  if (Net.role === 'host') Net.send(s);
}
Net.on('_lobby', () => renderLobby());
Net.on('_left', () => { if (G.on) { say('PARTNER LEFT', '', 3000); setTimeout(() => endToMenu('Your partner left.'), 1500); } else renderLobby(); });
Net.on('_hostgone', () => { if (G.on) endToMenu('The host left.'); else { show('menu'); msg('msg', 'The host left.'); } });
Net.on('lobby', m => { renderLobby(m); msg('lmsg', 'Waiting for the host to start...'); });
Net.on('start', m => { Net.started = true; startStage(m.cfg, m.cfg.hostRole === 'drv' ? 'nav' : 'drv', false); });
async function refreshRooms() {
  if ($('menu').classList.contains('hidden')) return;
  const r = await Net.rooms(), box = $('rooms'); box.innerHTML = '';
  for (const x of r) { const b = document.createElement('button'); b.innerHTML = '<span>' + x.name.slice(8).replace(/[<>&]/g, '') + '</span><span>' + x.n + '/2</span>'; b.onclick = () => joinRoom(x.code); box.appendChild(b); }
  clearTimeout(G.rt); G.rt = setTimeout(refreshRooms, 4000);
}
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || Q.has('relay')) refreshRooms();

// ---------- stage ----------
let stageCache = {};
function startStage(cfg, role, solo) {
  show(null); $('hud').classList.remove('hidden'); $('fade').style.opacity = 1;
  msg('big', 'BUILDING STAGE...');
  setTimeout(() => {
    const gfx = $('sGfx').value;
    if (!World.R) World.init($('gl'), gfx);
    const key = cfg.stage; const S = stageCache[key] || (stageCache = { [key]: makeStage(STAGES[cfg.stage]) })[key];
    World.build(S, cfg.fog);
    const notes = Notes.build(S); MapDraw.init(S, notes);
    const view = new CarView(World.scene);
    Object.assign(G, { on: true, S, cfg, role, solo, notes, view, car: null, phase: 'count', t: -3.5, pen: 0, splits: [], splitS: [S.L / 3, S.L * 2 / 3], nextSplit: 0, auto: {}, buf: [], other: { yaw: 0, pitch: 0, map: false }, callT: 0, finT: 0, crashes: 0, sendT: 0, lookT: 0, lastBeep: 4, startS: World.startS, finishS: World.finishS });
    if (role === 'drv') { G.car = new Car(S); G.car.place(World.startS - 3, 0); }
    look.yaw = 0; look.pitch = role === 'nav' ? -0.12 : -0.05; look.map = false;
    $('role').textContent = solo ? 'SOLO PRACTICE · AUTO CO-DRIVER' : role === 'drv' ? 'DRIVER · ' + STAGES[cfg.stage].name.toUpperCase() : 'NAVIGATOR · ' + STAGES[cfg.stage].name.toUpperCase();
    $('tip').innerHTML = role === 'drv' ? 'W/S throttle · brake, A/D steer, Space handbrake, R recover (+5 s) · mouse looks' : 'Hold <b>right mouse</b> or <b>Tab</b> for the map · callouts: A/D + 1-6, J jump, C crest, L log, K keep middle, F flat, B brake';
    $('spd').style.display = role === 'drv' ? '' : 'none'; $('dmg').style.display = role === 'drv' ? '' : 'none';
    msg('big', ''); msg('split', ''); $('fade').style.opacity = 0; $('lockmsg').classList.remove('hidden');
    G.lastFrame = performance.now(); G.acc = 0;
    setTimeout(() => $('tip').style.opacity = 0.5, 9000);
  }, 30);
}
function endToMenu(why) {
  G.on = false; Net.close(); $('hud').classList.add('hidden'); $('lockmsg').classList.add('hidden'); show('menu'); msg('msg', why || ''); try { document.exitPointerLock(); } catch (e) {} if (window.speechSynthesis) speechSynthesis.cancel(); Sfx.mute(true); setTimeout(() => Sfx.mute(false), 50); refreshRooms();
}
$('bMenu').onclick = () => endToMenu('');
$('bAgain').onclick = () => { if (G.solo || Net.role === 'host') { if (!G.solo) Net.send({ t: 'start', cfg: G.cfg }); startStage(G.cfg, G.role, G.solo); } };

// ---------- callouts ----------
function say(txt, words, ms) { const el = $('call'); el.textContent = txt; el.style.opacity = 1; clearTimeout(G.callHide); G.callHide = setTimeout(() => el.style.opacity = 0, ms || 2200); if (words) Sfx.say(words); }
const CALLS = { KeyJ: ['JUMP', 'jump'], KeyC: ['OVER CREST', 'over crest'], KeyL: ['LOG!', 'log'], KeyK: ['KEEP MIDDLE', 'keep middle'], KeyF: ['FLAT OUT', 'flat out'], KeyB: ['BRAKE!', 'brake brake'] };
let pendDir = null, pendT = 0;
function navKey(code) {
  if (code === 'KeyA' || code === 'ArrowLeft') { pendDir = 'L'; pendT = performance.now(); return; }
  if (code === 'KeyD' || code === 'ArrowRight') { pendDir = 'R'; pendT = performance.now(); return; }
  const dg = /^Digit([1-6])$/.exec(code);
  let c = null;
  if (dg) { const n = +dg[1], dir = performance.now() - pendT < 1500 ? pendDir : null, side = dir === 'L' ? 'left' : dir === 'R' ? 'right' : '';
    c = n === 1 ? ['HAIRPIN ' + side.toUpperCase(), 'hairpin ' + side] : [(side.toUpperCase() + ' ' + n).trim(), (side + ' ' + NUM[n]).trim()]; pendDir = null; }
  else if (CALLS[code]) c = CALLS[code];
  if (!c) return;
  Net.send({ t: 'call', txt: c[0], w: c[1] }); say(c[0], '', 1200);
}
Net.on('call', m => { if (G.on && G.role === 'drv') say(String(m.txt).slice(0, 40), String(m.w || '').slice(0, 60)); });

// ---------- input ----------
const cvs = $('gl');
addEventListener('keydown', e => {
  if (!G.on) return; if (e.code === 'Tab') e.preventDefault(); if (e.code === 'Space') e.preventDefault();
  KEYS.add(e.code);
  if (e.repeat) return;
  if (G.role === 'nav') { if (e.code === 'Tab') look.map = !look.map; else navKey(e.code); }
  if (G.role === 'drv' && e.code === 'KeyR' && G.car && G.phase === 'run') recover();
  if (e.code === 'KeyQ' && !document.pointerLockElement) endToMenu('');
  if (e.code === 'KeyN') G.noGrades = !G.noGrades;
});
addEventListener('keyup', e => KEYS.delete(e.code));
addEventListener('blur', () => KEYS.clear());
cvs.addEventListener('mousedown', e => { if (!G.on) return; Sfx.start(); if (!document.pointerLockElement) { try { cvs.requestPointerLock(); } catch (x) {} } if (e.button === 2 && G.role === 'nav') look.map = true; });
addEventListener('mouseup', e => { if (e.button === 2 && G.role === 'nav' && !KEYS.has('Tab')) look.map = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { const l = !!document.pointerLockElement; $('lockmsg').classList.toggle('hidden', l || !G.on); $('lockmsg').innerHTML = 'Click to look around' + (G.on ? ' · <b>Q</b> quits to menu' : ''); });
addEventListener('mousemove', e => { if (!document.pointerLockElement || !G.on) return; look.yaw -= e.movementX * 0.0022; look.pitch -= e.movementY * 0.0022; look.yaw = clamp(look.yaw, -2.5, 2.5); look.pitch = clamp(look.pitch, -1.0, 0.8); look.idle = 0; });
addEventListener('gamepadconnected', e => { pad = e.gamepad.index; });

const inp = { steer: 0, thr: 0, brk: 0, hb: 0 };
function readInput(dt) {
  const L = KEYS.has('KeyA') || KEYS.has('ArrowLeft'), R = KEYS.has('KeyD') || KEYS.has('ArrowRight');
  let target = (L ? 1 : 0) - (R ? 1 : 0);
  // keyboard steering ramps in (faster when reversing direction)
  const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(inp.steer) ? 9 : 4.5;
  inp.steer += clamp(target - inp.steer, -rate * dt, rate * dt);
  inp.thr = KEYS.has('KeyW') || KEYS.has('ArrowUp') ? 1 : 0; inp.brk = KEYS.has('KeyS') || KEYS.has('ArrowDown') ? 1 : 0; inp.hb = KEYS.has('Space') ? 1 : 0;
  const gp = pad !== null && navigator.getGamepads ? navigator.getGamepads()[pad] : null;
  if (gp) { const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.08) inp.steer = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4; const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0; if (rt > 0.05) inp.thr = rt; if (lt > 0.05) inp.brk = lt; if (gp.buttons[0] && gp.buttons[0].pressed) inp.hb = 1; if (gp.buttons[3] && gp.buttons[3].pressed && !G.padY && G.phase === 'run') recover(); G.padY = gp.buttons[3] && gp.buttons[3].pressed; }
  return inp;
}
function recover() {
  const c = G.car; if (c.speed > 8 && c.roadD < ROAD_HW + 1) return; // only when stuck or off the road
  $('fade').style.opacity = 0.8; setTimeout(() => $('fade').style.opacity = 0, 250);
  c.place(Math.max(World.startS, c.prog - 5), 0); G.pen += 5; say('RECOVERED +5 s', '', 1500);
}

// ---------- driver: physics, timing, sending ----------
function driverStep(dt) {
  const c = G.car, i = G.phase === 'count' ? { steer: inp.steer, thr: 0, brk: 1, hb: 1 } : readInput(dt);
  if (G.phase === 'count') readInput(dt);
  if (G.phase !== 'count') c.step(dt, i); else { c.step(dt, { steer: 0, thr: KEYS.has('KeyW') ? 1 : 0, brk: 0, hb: 1 }); c.v.multiplyScalar(0); c.place(World.startS - 3, 0); c.rpm = KEYS.has('KeyW') ? 6500 : CAR.idle; }
}
function stagePhase(dt) {
  if (G.phase === 'count') {
    G.t += dt; const n = Math.ceil(-G.t);
    if (n !== G.lastBeep && n >= 1 && n <= 3) { G.lastBeep = n; Sfx.beep(false); msg('big', String(n)); }
    if (G.t >= 0) { G.phase = 'run'; G.t = 0; Sfx.beep(true); msg('big', 'GO'); setTimeout(() => G.phase === 'run' && msg('big', ''), 900); if (G.solo) Notes.auto(G.auto, G.notes, G.car.prog, 0, (t, w) => say(t, w)); }
  } else if (G.phase === 'run') {
    G.t += dt; const c = G.car;
    if (G.nextSplit < 2 && c.prog >= G.splitS[G.nextSplit]) { G.splits.push(G.t + G.pen); const best = bestOf(); const ref = best && best.splits ? best.splits[G.nextSplit] : null; msg('split', 'SPLIT ' + (G.nextSplit + 1) + '  ' + fmtT(G.t + G.pen) + (ref ? '  (' + (G.t + G.pen - ref >= 0 ? '+' : '') + (G.t + G.pen - ref).toFixed(1) + ')' : '')); setTimeout(() => msg('split', ''), 4000); G.nextSplit++; }
    if (c.prog >= G.finishS) { G.phase = 'fin'; G.finT = 0; G.final = G.t + G.pen; msg('big', fmtT2(G.final)); Sfx.beep(true); finishRecord(); }
    if (G.solo) Notes.auto(G.auto, G.notes, c.prog, c.speed, (t, w) => say(t, w));
  } else if (G.phase === 'fin') {
    G.finT += dt; if (G.finT > 3.2 && !G.finShown) { G.finShown = true; showFinish(); }
  }
}
const bestKey = () => 'pn-best-' + G.cfg.stage + '-' + G.cfg.fog;
function bestOf() { try { return JSON.parse(localStorage.getItem(bestKey()) || 'null'); } catch (e) { return null; } }
function finishRecord() { const b = bestOf(); G.wasBest = !b || G.final < b.t; if (G.wasBest) try { localStorage.setItem(bestKey(), JSON.stringify({ t: G.final, splits: G.splits })); } catch (e) {} G.prevBest = b; }
function showFinish() {
  try { document.exitPointerLock(); } catch (e) {}
  const st = STAGES[G.cfg.stage], rows = [['Stage', st.name + ' (' + (G.S.L / 1000).toFixed(2) + ' km)'], ['Time', fmtT2(G.final)], ['Penalties', '+' + G.pen + ' s'], ['Average', (G.S.L / Math.max(1, G.final) * 3.6).toFixed(1) + ' km/h'], ['Damage', Math.round((G.dmg || 0) * 100) + '%'], ['Best', G.wasBest ? 'NEW BEST' : fmtT2(G.prevBest.t)]];
  $('finTab').innerHTML = rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
  $('finT').innerHTML = G.wasBest ? 'NEW <b>BEST</b>' : 'STAGE <b>COMPLETE</b>';
  $('bAgain').classList.toggle('hidden', !(G.solo || Net.role === 'host')); msg('finMsg', G.solo || Net.role === 'host' ? '' : 'Waiting for the host to restart...');
  $('fin').classList.remove('hidden');
}
function sendCar(dt) {
  G.sendT -= dt; if (G.sendT > 0 || G.solo) return; G.sendT = 1 / 30; const c = G.car;
  const ev = c.netEv || []; c.netEv = [];
  Net.send(Object.assign(c.pack({ ph: G.phase, tm: Math.round(G.t * 100) / 100, pn: G.pen, fin: G.final || 0 }), { ev, hb: inp.hb, sp: c.wh.map(w => Math.round(w.spin)) }));
}
Net.on('car', m => { if (!G.on || G.role !== 'nav') return; m.rt = performance.now(); G.buf.push(m); if (G.buf.length > 40) G.buf.shift(); for (const e of m.ev || []) carEvent(e); });
Net.on('look', m => { if (G.on) { G.other.yaw = clamp(+m.y || 0, -3, 3); G.other.pitch = clamp(+m.p || 0, -1.2, 1); G.other.map = !!m.m; } });
function carEvent(e) { if (e.k === 'wreck') { Sfx.crash(20); G.view.shake = 1; say('WRECKED  +10 s', '', 2200); $('fade').style.opacity = 0.9; if (G.role === 'drv') setTimeout(() => { if (G.car && G.car.wrecked && G.phase === 'run') { G.car.place(Math.max(World.startS, G.car.prog - 5), 0); G.pen += 10; } $('fade').style.opacity = 0; }, 1300); else setTimeout(() => $('fade').style.opacity = 0, 1300); } else if (e.k === 'crash') { Sfx.crash(e.v); G.view.shake = Math.min(1, e.v / 12); } else if (e.k === 'thud') { Sfx.thud(e.v); G.view.shake = Math.min(0.6, e.v / 15); } else if (e.k === 'shift') Sfx.shift(); }

// ---------- navigator: interpolate the driver's car ----------
const IP = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), a: new THREE.Quaternion(), b: new THREE.Quaternion() };
function navState() {
  const B = G.buf; if (!B.length) return null;
  const rt = performance.now() - 120; let i = B.length - 1; while (i > 0 && B[i - 1].rt > rt) i--;
  const a = B[Math.max(0, i - 1)], b = B[i]; let t = a === b ? 0 : clamp((rt - a.rt) / Math.max(1, b.rt - a.rt), 0, 1);
  const ex = b.rt < rt ? Math.min(0.25, (rt - b.rt) / 1000) : 0;
  IP.pos.set(lerp(a.p[0], b.p[0], t) + b.v[0] * ex, lerp(a.p[1], b.p[1], t) + b.v[1] * ex, lerp(a.p[2], b.p[2], t) + b.v[2] * ex);
  IP.a.set(...a.q).normalize(); IP.b.set(...b.q).normalize(); IP.q.slerpQuaternions(IP.a, IP.b, t);
  IP.vel.set(lerp(a.v[0], b.v[0], t), lerp(a.v[1], b.v[1], t), lerp(a.v[2], b.v[2], t));
  return { pos: IP.pos, q: IP.q, vel: IP.vel, steer: lerp(a.st, b.st, t), comp: b.c, speed: IP.vel.length(), speedF: IP.vel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(IP.q)), rpm: lerp(a.rpm, b.rpm, t), gear: b.g, thr: b.th, slide: b.sl, offroad: b.of, air: b.air, hb: b.hb, prog: b.pr, dmg: b.dm, ph: b.ph, tm: b.tm, pn: b.pn, fin: b.fin };
}

// ---------- frame ----------
const PH = 1 / 120;
const fwdV = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  if (!G.on) return;
  let dt = Math.min(0.1, (now - G.lastFrame) / 1000); G.lastFrame = now;
  let st;
  if (G.role === 'drv') {
    G.acc += dt; let n = 0;
    while (G.acc >= PH && n < 12) { driverStep(PH); stagePhase(PH); G.acc -= PH; n++; }
    const c = G.car; for (const e of c.events) { carEvent(e); (c.netEv = c.netEv || []).push(e.v ? { k: e.k, v: Math.round(e.v * 10) / 10 } : { k: e.k }); } c.events.length = 0;
    sendCar(dt); G.dmg = c.dmg;
    fwdV.set(0, 0, 1).applyQuaternion(c.q);
    st = { pos: c.pos, q: c.q, vel: c.v, steer: c.steer, comp: c.wh.map(w => w.comp), spinW: 0, speed: c.speed, speedF: c.v.dot(fwdV), rpm: c.rpm, gear: c.gear, thr: c.thr, slide: c.slide, offroad: c.offroad, air: c.air > 0, hb: inp.hb, prog: c.prog };
    st.spinW = c.wh[2].spin;
    // driver's view drifts back to centre when the mouse is idle
    look.idle += dt; if (look.idle > 1.2) { look.yaw *= Math.exp(-dt * 2.5); look.pitch += (-0.05 - look.pitch) * (1 - Math.exp(-dt * 2.5)); }
  } else {
    st = navState();
    if (!st) { World.render(); return; }
    G.phase = st.ph === 'count' ? 'count' : st.ph; G.t = st.tm; G.pen = st.pn; G.dmg = st.dmg;
    if (G.phase === 'count') { const n = Math.ceil(-st.tm); if (n !== G.lastBeep && n >= 1 && n <= 3) { G.lastBeep = n; Sfx.beep(false); msg('big', String(n)); } }
    if (G.phase === 'run' && G.lastBeep !== 0) { G.lastBeep = 0; Sfx.beep(true); msg('big', 'GO'); setTimeout(() => msg('big', ''), 900); }
    if (G.phase === 'fin' && !G.finShown) { if (!G.finT) { G.final = st.fin; msg('big', fmtT2(st.fin)); finishRecord(); } G.finT += dt; if (G.finT > 3.2) { G.finShown = true; showFinish(); } }
    G.lookT -= dt; if (G.lookT <= 0) { G.lookT = 0.1; Net.send({ t: 'look', y: Math.round(look.yaw * 100) / 100, p: Math.round(look.pitch * 100) / 100, m: look.map ? 1 : 0 }); }
  }
  if (G.role === 'drv' && !G.solo) { G.lookT -= dt; if (G.lookT <= 0) { G.lookT = 0.1; Net.send({ t: 'look', y: Math.round(look.yaw * 100) / 100, p: Math.round(look.pitch * 100) / 100, m: 0 }); } }
  // visuals
  G.view.update(st, dt, G.role, look, G.solo ? null : G.other);
  G.view.camera(World.cam, st, G.role, look, dt);
  if (G.role === 'nav' || G.view.mapUp > 0.02 || G.solo) {
    G.mapTk = (G.mapTk || 0) - dt;
    if (G.mapTk <= 0 && (G.role === 'nav' || G.view.mapUp > 0.02)) { G.mapTk = 0.1; fwdV.set(0, 0, 1).applyQuaternion(st.q); MapDraw.draw(G.view.mapC.getContext('2d'), { x: st.pos.x, z: st.pos.z, h: Math.atan2(fwdV.x, fwdV.z), prog: st.prog }, { grades: !G.noGrades, vis: [140, 90, 55][G.cfg.fog] }); G.view.mapT.needsUpdate = true; }
  }
  // dust and gravel spray from the rear wheels
  if (st.speed > 4 && !st.air) {
    const n = (st.slide * 3 + st.speed / 25) * (st.offroad > 0.5 ? 0.4 : 1) * dt * 30;
    for (let k = 0; k < n; k++) if (Math.random() < 0.7) {
      const side = Math.random() < 0.5 ? 0.8 : -0.8, p = new THREE.Vector3(side, -0.6, -1.4).applyQuaternion(st.q).add(st.pos), v = st.vel;
      const off = st.offroad > 0.5, c = off ? [0.45, 0.4, 0.3] : [0.72, 0.64, 0.52];
      World.puff(p.x, p.y, p.z, v.x * 0.25 + (Math.random() - 0.5) * 2, 0.6 + Math.random(), v.z * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 0.8, 1.6 + Math.random() * 1.6, c[0], c[1], c[2]);
    }
  }
  World.stepDust(dt);
  World.update(World.cam.position, st.pos);
  Sfx.update({ rpm: st.rpm, thr: st.thr, speed: st.speed, slide: st.slide, offroad: st.offroad, air: st.air, inside: 1 }, dt);
  hud(st);
  World.render();
  perf(dt);
}
function hud(st) {
  $('tm').textContent = G.phase === 'count' ? fmtT(0) : fmtT((G.phase === 'fin' ? G.final - G.pen : G.t) + G.pen);
  if (G.role === 'drv') {
    $('spd').querySelector('b').textContent = Math.round(st.speed * 3.6); $('gear').textContent = st.gear < 0 ? 'R' : st.gear;
    $('rpm').firstElementChild.style.width = (clamp((st.rpm - 900) / (CAR.red - 900), 0, 1) * 100) + '%'; $('rpm').firstElementChild.style.background = st.rpm > CAR.red - 500 ? '#e0483a' : '';
    $('dmg').querySelector('u').style.width = Math.round((G.dmg || 0) * 100) + '%';
  }
  $('net').textContent = G.solo ? '' : (Net.role === 'host' ? 'ping ' + Math.round(Net.ping) + ' ms' : (performance.now() - Net.lastRx > 2500 ? 'NO SIGNAL' : 'online'));
}
// resolution governor: keep the frame rate up on slow machines
const PF = { t: 0, n: 0, scale: 1 };
function perf(dt) {
  PF.t += dt; PF.n++; if (PF.t < 2) return; const ms = PF.t / PF.n * 1000; PF.t = 0; PF.n = 0;
  const R = World.R, pr = R.getPixelRatio();
  if (ms > 24 && pr > 0.6) { R.setPixelRatio(Math.max(0.6, pr - 0.15)); World.resize(); }
  else if (ms < 13 && pr < Math.min(devicePixelRatio || 1, 2) - 0.1) { R.setPixelRatio(pr + 0.1); World.resize(); }
}
requestAnimationFrame(frame);
// test hooks
window.__PN = { G, World, startStage, Net, look, KEYS };
if (Q.has('solo')) setTimeout(() => $('bSolo').click(), 100);
