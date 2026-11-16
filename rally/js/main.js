'use strict';
// Game flow: menu, lobby, stage build, countdown, run, finish. Driver input, navigator map and callouts, HUD.
const Q = new URLSearchParams(location.search);
const G = { on: false };
try { G.chase = localStorage.getItem('pn-cam') === 'chase'; } catch (e) {}
const KEYS = new Set();
const look = { yaw: 0, pitch: -0.05, map: false, idle: 0 };
let pad = null;

// ---------- medals: target average speeds over the stage's nominal length ----------
const MEDALS = [['GOLD', 74, '#f2c94c'], ['SILVER', 63, '#c9d1d9'], ['BRONZE', 52, '#d08a4a']];
const medalT = (i, k) => STAGES[i].len / (MEDALS[k][1] / 3.6);
const medalOf = (i, t) => { for (let k = 0; k < 3; k++) if (t <= medalT(i, k)) return k; return -1; };
const medalDot = k => k < 0 ? '' : '<i class="md" style="--m:' + MEDALS[k][2] + '" title="' + MEDALS[k][0] + '"></i>';
// ---------- menu ----------
STAGES.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = BIOMES[s.biome].name + ' · ' + s.name + (s.berms ? ' · berms & jumps' : '') + '  (' + (s.len / 1000).toFixed(1) + ' km)'; $('sStage').appendChild(o); });
try { $('nm').value = localStorage.getItem('pn-name') || ''; $('sGfx').value = localStorage.getItem('pn-gfx') || 'med'; for (const k of ['sStage', 'sFog', 'sRole', 'sBots']) { const v = localStorage.getItem('pn-' + k); if (v !== null && [...$(k).options].some(o => o.value === v)) $(k).value = v; } } catch (e) {}
const myName = () => { const n = ($('nm').value || '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 14) || 'Player' + (1 + Math.random() * 99 | 0); try { localStorage.setItem('pn-name', n); localStorage.setItem('pn-gfx', $('sGfx').value); } catch (e) {} return n; };
const show = id => { for (const s of ['menu', 'lobby', 'fin', 'pause', 'champ']) $(s).classList.toggle('hidden', s !== id); Garage3D.on = id === 'menu'; };
// ---- stage cards (drive the hidden select) ----
const BIO_COL = { forest: '#3f8a52', autumn: '#d0742a', snow: '#9cc8e4', desert: '#d8914c', park: '#74b85a', city: '#8a93a6' };
const todName = t => /dusk|evening/i.test(t) ? 'Dusk' : /noon/i.test(t) ? 'Midday' : /morning/i.test(t) ? 'Morning' : /overcast/i.test(t) ? 'Overcast' : 'Day';
function renderStages() {
  const box = $('stages'), cur = +$('sStage').value, fog = +$('sFog').value; box.innerHTML = '';
  STAGES.forEach((s, i) => {
    let best = null; try { best = JSON.parse(localStorage.getItem('pn-best-' + i + '-' + fog) || 'null'); } catch (e) {}
    const b = document.createElement('button'); b.className = 'stc' + (i === cur ? ' sel' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === cur);
    b.style.setProperty('--b', BIO_COL[s.biome] || '#777');
    b.innerHTML = (s.berms ? '<em>JUMPS</em>' : '') + '<b>' + s.name + '</b><small>' + BIOMES[s.biome].name + ' · ' + todName(s.tod) + ' · ' + (s.len / 1000).toFixed(1) + ' km</small>' + '<small class="bt">' + (best ? medalDot(medalOf(i, best.t)) + 'Best ' + fmtT2(best.t) : 'Gold ' + fmtT(medalT(i, 0))) + '</small>';
    b.onclick = () => { $('sStage').value = i; $('sStage').onchange(); renderStages(); };
    box.appendChild(b);
  });
  const st = STAGES[cur]; $('stInfo').textContent = BIOMES[st.biome].name + ' · ' + st.name;
}
// ---- segmented controls (drive the hidden selects) ----
function renderSegs() {
  for (const seg of document.querySelectorAll('.seg')) {
    const sel = $(seg.dataset.for); seg.innerHTML = '';
    for (const o of sel.options) { const b = document.createElement('button'); b.textContent = o.textContent; b.className = o.value === sel.value ? 'on' : ''; b.onclick = () => { sel.value = o.value; if (sel.onchange) sel.onchange(); renderSegs(); if (sel.id === 'sFog') renderStages(); try { localStorage.setItem('pn-' + sel.id, sel.value); } catch (e) {} }; seg.appendChild(b); }
  }
}
const msg = (id, t) => { $(id).textContent = t || ''; };
const readCfg = () => ({ stage: +$('sStage').value, fog: +$('sFog').value, hostRole: $('sRole').value });

const CAR_COL = [0x1d4fbf, 0xc62828, 0x2e7d32, 0xf2b632], CAR_NAME = ['Blue', 'Red', 'Green', 'Yellow'], hex = c => '#' + c.toString(16).padStart(6, '0');
// ---- garage: cars unlock with stage finishes (any seat, any mode) ----
const Garage = { fin: 0, sel: 0 };
try { Garage.fin = +localStorage.getItem('pn-fin') || 0; Garage.sel = clamp(+localStorage.getItem('pn-car') || 0, 0, CARS.length - 1); } catch (e) {}
try { Garage.all = localStorage.getItem('pn-all') === '1'; } catch (e) {}
const carOpen = i => Garage.all || Garage.fin >= CARS[i].need;
function renderGarage() {
  const i = Garage.sel, c = CARS[i], open = carOpen(i), el = $('gInfo');
  el.className = open ? '' : 'lock';
  const left = c.need - Garage.fin;
  el.innerHTML = '<div><h4>' + c.name + '</h4><p>' + c.cls + ' · ' + c.vmax + ' km/h · ' + c.m + ' kg</p>' + (open ? '<span class="ok">' + (i === 0 ? 'Ready' : 'Unlocked') + '</span>' : '<span class="lk">&#128274; Finish ' + left + ' more stage' + (left > 1 ? 's' : '') + '</span>') + '</div><div class="st">' + carStats(c).map(([n, v]) => '<span>' + n + '</span><i><u style="width:' + v * 10 + '%"></u></i>').join('') + '</div>';
  $('gCount').textContent = CARS.filter((_, k) => carOpen(k)).length + ' / ' + CARS.length + ' unlocked · ' + Garage.fin + ' stage' + (Garage.fin === 1 ? '' : 's') + ' finished';
  $('gDots').innerHTML = CARS.map((_, k) => '<i class="' + (k === i ? 's' : carOpen(k) ? 'o' : '') + '" data-k="' + k + '"></i>').join('');
  if (Garage.shown !== i) { Garage.shown = i; Garage3D.show(c.look, open ? CAR_COL[0] : 0x3a3d40); }
  Net.car = open ? i : 0;
  try { if (open) localStorage.setItem('pn-car', i); } catch (e) {}
}
$('gPrev').onclick = () => { Garage.sel = (Garage.sel + CARS.length - 1) % CARS.length; renderGarage(); };
$('gNext').onclick = () => { Garage.sel = (Garage.sel + 1) % CARS.length; renderGarage(); };
$('gDots').onclick = e => { const k = e.target.dataset && e.target.dataset.k; if (k !== undefined) { Garage.sel = +k; renderGarage(); } };
Garage3D.init($('gCar'));
renderGarage(); renderStages(); renderSegs();
// code box (bottom of the menu)
$('bCheat').onclick = () => { const v = $('cheat').value.trim().toLowerCase(); $('cheat').value = '';
  if (v === 'rally67') { Garage.all = true; try { localStorage.setItem('pn-all', '1'); } catch (e) {} Garage.shown = -1; renderGarage(); msg('msg', 'All cars unlocked.'); } else msg('msg', v ? 'Unknown code.' : ''); };
$('cheat').onkeydown = e => { if (e.key === 'Enter') $('bCheat').click(); };
addEventListener('keydown', e => { if ($('menu').classList.contains('hidden') || /INPUT|SELECT/.test(document.activeElement.tagName)) return; if (e.code === 'ArrowLeft') $('gPrev').click(); if (e.code === 'ArrowRight') $('gNext').click(); });
const carLocked = () => { if (carOpen(Garage.sel)) return false; msg('msg', CARS[Garage.sel].name + ' is locked. Pick an unlocked car.'); return true; };
const myId = () => Net.role === 'host' ? 'H' : Net.id;
const nameOf = id => id === 'H' ? Net.name : (Net.peers.get(id) || {}).name || 'Player';
$('bSolo').onclick = () => { if (carLocked()) return; Champ.run = null; Sfx.start(); Net.close(); const c = readCfg(); c.bots = +$('sBots').value; startStage(c, 'drv', true, 0, [[{ id: 'me', name: myName(), car: Net.car | 0 }, null]]); };
$('bHost').onclick = () => {
  if (carLocked()) return; Sfx.start(); const name = myName(); G.cfg = readCfg(); const code = Net.host(name, s => msg('lmsg', s === 'open' ? 'Share the code (up to 8 players, two per car).' : 'Connection lost, retrying...'));
  G.seats = [[null, null], [null, null], [null, null], [null, null]]; G.seats[0][G.cfg.hostRole === 'nav' ? 1 : 0] = 'H';
  $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); msg('lmsg', 'Connecting...'); renderLobby();
};
$('bJoin').onclick = () => !carLocked() && joinRoom($('jc').value.trim().toUpperCase());
function joinRoom(code) {
  if (!/^[A-Z]{5}$/.test(code)) { msg('msg', 'Enter the 5-letter room code.'); return; }
  Sfx.start(); Net.join(code, myName(), why => { if (G.on) { endToMenu(why); } else { show('menu'); msg('msg', why); } });
  $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); msg('lmsg', 'Connecting...'); $('lcfg').textContent = ''; $('seats').innerHTML = '';
}
$('bLeave').onclick = () => { Net.close(); show('menu'); refreshRooms(); };
// host: seat bookkeeping
function unseat(id) { for (const c of G.seats) for (let r = 0; r < 2; r++) if (c[r] === id) c[r] = null; }
function seatOf(id, seats) { for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) { const x = seats[c][r]; if (x && (x === id || x.id === id)) return [c, r]; } return null; }
// fill navigator seats in cars that already have a driver first (two players = co-op), then start a new car
function autoSeat(id) { if (seatOf(id, G.seats)) return; for (let c = 0; c < 4; c++) if (G.seats[c][0] && !G.seats[c][1]) { G.seats[c][1] = id; return; } for (let c = 0; c < 4; c++) if (!G.seats[c][0] && !G.seats[c][1]) { G.seats[c][0] = id; return; } }
function takeSeat(id, c, r) { if (G.seats[c][r]) return; unseat(id); G.seats[c][r] = id; renderLobby(); }
function lobbyState() { return { t: 'lobby', cfg: G.cfg, seats: G.seats.map(c => c.map(id => id ? { id, name: nameOf(id), car: id === 'H' ? Net.car | 0 : (Net.peers.get(id) || {}).car | 0 } : null)) }; }
function renderLobby(s) {
  s = s || lobbyState(); const st = STAGES[s.cfg.stage], me = myId();
  const cars = s.seats.filter(c => c[0] || c[1]).length;
  $('lcfg').textContent = BIOMES[st.biome].name + ' · ' + st.name + ' · ' + (st.len / 1000).toFixed(1) + ' km · ' + ['light', 'medium', 'heavy'][s.cfg.fog] + ' fog · ' + (cars > 1 ? cars + '-car RACE' : 'co-op stage');
  const box = $('seats'); box.innerHTML = '';
  s.seats.forEach((car, c) => {
    const d = document.createElement('div'); d.className = 'car'; d.style.setProperty('--c', hex(CAR_COL[c])); d.innerHTML = '<h5>' + CAR_NAME[c] + ' car</h5>' + (car[0] ? '<div style="font-size:12px;color:var(--dim)">' + CARS[car[0].car | 0].name + '</div>' : '');
    ['Driver', 'Navigator'].forEach((lab, r) => { const x = car[r], b = document.createElement('button'); b.innerHTML = '<i>' + lab + '</i>' + (x ? x.name.replace(/[<>&]/g, '') : 'Take seat'); if (!x) b.className = 'free'; if (x && x.id === me) b.className = 'me'; b.onclick = () => { if (x) return; if (Net.role === 'host') takeSeat('H', c, r); else Net.send({ t: 'seat', c, r }); }; d.appendChild(b); });
    box.appendChild(d);
  });
  G.lobby = s;
  if (Net.role === 'host') Net.send(s);
}
$('sStage').onchange = $('sFog').onchange = () => { try { localStorage.setItem('pn-sStage', $('sStage').value); } catch (e) {} if (Net.role === 'host' && G.seats && !G.on) { G.cfg = Object.assign(G.cfg, { stage: +$('sStage').value, fog: +$('sFog').value }); renderLobby(); } };
$('bGo').onclick = () => {
  const ss = G.seats, cars = ss.filter(c => c[0]).length;
  if (!cars) { msg('lmsg', 'Someone has to drive.'); return; }
  if (ss.some(c => c[1] && !c[0])) { msg('lmsg', 'A car has a navigator but no driver.'); return; }
  if (cars === 1 && !Net.peers.size) { msg('lmsg', 'Wait for someone to join (or play solo practice).'); return; }
  Net.started = true; Net.meta(false); const seats = lobbyState().seats; Net.send({ t: 'start', cfg: G.cfg, seats }); begin(G.cfg, seats);
};
function begin(cfg, seats) { const me = seatOf(myId(), seats); if (!me) { endToMenu('You had no seat.'); return; } startStage(cfg, me[1] ? 'nav' : 'drv', false, me[0], seats); }
Net.on('_join', m => { if (G.seats && !G.on) autoSeat(m.id); });
Net.on('_lobby', () => { if (G.seats) renderLobby(); });
Net.on('seat', (m, from) => { if (G.seats && !G.on && m.c >= 0 && m.c < 4 && (m.r === 0 || m.r === 1)) takeSeat(from, m.c | 0, m.r | 0); });
Net.on('_left', m => {
  if (!G.on) { if (G.seats) { unseat(m.id); renderLobby(); } return; }
  const s0 = seatOf(m.id, G.seats); if (!s0) return; say((m.name || 'A player') + ' LEFT', '', 3000);
  if (s0[0] === G.myCar && G.role === 'nav' && s0[1] === 0) setTimeout(() => endToMenu('Your driver left.'), 1500);
});
Net.on('_hostgone', () => { if (G.on) endToMenu('The host left.'); else { show('menu'); msg('msg', 'The host left.'); } });
Net.on('lobby', m => { G.lobby = m; renderLobby(m); msg('lmsg', 'Waiting for the host to start...'); });
Net.on('start', m => { Net.started = true; $('fin').classList.add('hidden'); begin(m.cfg, m.seats); });
async function refreshRooms() {
  if ($('menu').classList.contains('hidden')) return;
  const r = await Net.rooms(), box = $('rooms'); box.innerHTML = '';
  for (const x of r) { const b = document.createElement('button'); b.innerHTML = '<span>' + x.name.slice(8).replace(/[<>&]/g, '') + '</span><span>' + x.n + '/8</span>'; b.onclick = () => joinRoom(x.code); box.appendChild(b); }
  clearTimeout(G.rt); G.rt = setTimeout(refreshRooms, 4000);
}
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || Q.has('relay')) refreshRooms();

// ---------- stage ----------
let stageCache = {};
function startStage(cfg, role, solo, myCar, seats) {
  show(null); $('hud').classList.remove('hidden'); $('fade').style.opacity = 1;
  msg('big', 'BUILDING STAGE...');
  setTimeout(async () => {
    const gfx = $('sGfx').value;
    if (!World.R) World.init($('gl'), gfx);
    await World.photos(BIOMES[STAGES[cfg.stage].biome]);
    const key = cfg.stage; const S = stageCache[key] || (stageCache = { [key]: makeStage(STAGES[cfg.stage]) })[key];
    World.build(S, cfg.fog);
    const notes = Notes.build(S); MapDraw.init(S, notes);
    myCar = myCar || 0; seats = seats || [[{ id: 'me', name: 'You' }, null]];
    const cars = []; seats.forEach((c, i) => { if (c && c[0]) cars.push(i); });
    const mdl = c => clamp((seats[c] && seats[c][0] && seats[c][0].car) | 0, 0, CARS.length - 1);
    const view = new CarView(World.scene, { color: CAR_COL[myCar], look: CARS[mdl(myCar)].look }); applyCar(mdl(myCar));
    const views = {}, tags = {};
    for (const c of cars) if (c !== myCar) {
      const v = views[c] = new CarView(World.scene, { color: CAR_COL[c], remote: true, look: CARS[mdl(c)].look }); v.g.visible = false;
      const tc = document.createElement('canvas'); tc.width = 256; tc.height = 64; const x = tc.getContext('2d'); x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, 256, 64); x.fillStyle = hex(CAR_COL[c]); x.fillRect(0, 0, 10, 64); x.fillStyle = '#fff'; x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(seats[c][0].name + (seats[c][1] ? ' / ' + seats[c][1].name : ''), 133, 33);
      const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace; const sp = tags[c] = new THREE.Sprite(new THREE.SpriteMaterial({ map: tt, depthTest: false, transparent: true })); sp.scale.set(2.6, 0.65, 1); sp.renderOrder = 9; World.scene.add(sp);
    }
    const k = cars.indexOf(myCar), n = cars.length, grid = { s: World.startS - 3 - Math.floor(Math.max(0, k) / 2) * 9, lat: n > 1 ? (k % 2 ? 1.9 : -1.9) : 0 };
    { const p0 = S.at(World.startS); MapDraw.draw(view.mapC.getContext('2d'), { x: p0.x, z: p0.z, h: p0.h, prog: World.startS }, { grades: true, vis: [140, 90, 55][cfg.fog] }); view.mapT.needsUpdate = true; }
    Object.assign(G, { on: true, S, cfg, role, solo, notes, view, views, tags, seats, cars, myCar, grid, race: n > 1, autoNav: solo || (role === 'drv' && !seats[myCar][1]), bufs: {}, results: {}, finShown: false, counted: false, unlockMsg: '', final: 0, car: null, phase: 'count', t: -3.5, pen: 0, splits: [], splitS: [S.L / 3, S.L * 2 / 3], nextSplit: 0, auto: {}, buf: [], other: { yaw: 0, pitch: 0, map: false }, callT: 0, finT: 0, crashes: 0, trace: [], style: { dT: 0, dA: 0, aT: 0, pts: 0, drift: 0, air: 0 }, paused: false, wasLocked: !!document.pointerLockElement, sendT: 0, lookT: 0, lastBeep: 4, startS: World.startS, finishS: World.finishS });
    for (const c of cars) G.bufs[c] = [];
    // AI rivals on the road (solo only): you start at the back of the grid
    G.bots = []; G.rivals = null;
    if (solo && role === 'drv') {
      let names = [];
      if (Champ.run) { const pool = Champ.run.riv.slice().sort(() => Math.random() - 0.5); names = pool.slice(0, 3); }
      else if (cfg.bots) names = RIVALS.map(([n, s]) => ({ n, s })).sort(() => Math.random() - 0.5).slice(0, cfg.bots);
      if (names.length) { G.bots = Bots.spawn(S, names, World.startS, names.length); const k2 = names.length; G.grid = { s: World.startS - 3 - Math.floor(k2 / 2) * 9, lat: k2 % 2 ? 1.9 : -1.9 }; G.rivals = G.bots.map(b => b.adapt); }
    }
    if (role === 'drv') { G.car = new Car(S); G.car.place(G.grid.s, G.grid.lat); G.meAdapt = { pos: G.car.pos, q: G.car.q, vel: G.car.v }; }
    look.yaw = 0; look.pitch = role === 'nav' ? -0.14 : -0.1; look.map = false; G.sw = [1, 1, 0, 0, /dusk|evening/i.test(STAGES[cfg.stage].tod) ? 1 : 0, 0];
    $('role').textContent = CARS[mdl(myCar)].name.toUpperCase() + ' · ' + (solo ? 'SOLO PRACTICE · AUTO CO-DRIVER' : (role === 'drv' ? 'DRIVER' : 'NAVIGATOR') + ' · ' + CAR_NAME[myCar].toUpperCase() + ' CAR' + (G.autoNav ? ' · AUTO CO-DRIVER' : '')) + ' · ' + STAGES[cfg.stage].name.toUpperCase(); msg('pos', '');
    if (Champ.run) $('role').textContent = Champ.run.c.name.toUpperCase() + ' · STAGE ' + (Champ.run.i + 1) + ' / ' + Champ.run.c.st.length + ' · ' + STAGES[cfg.stage].name.toUpperCase();
    $('tip').innerHTML = role === 'drv' ? 'W/S throttle · brake, A/D steer, Space handbrake, R recover (+5 s), V chase cam, G ghost, Esc pause · click dash switches · mouse looks' : 'Hold <b>right mouse</b> or <b>Tab</b> for the map · callouts: A/D + 1-6, J jump, C crest, L log, K keep middle, F flat, B brake';
    $('spd').style.display = role === 'drv' ? '' : 'none'; $('dmg').style.display = role === 'drv' ? '' : 'none'; $('call').classList.remove('on');
    bigMsg(''); msg('split', ''); $('fade').style.opacity = 0; $('lockmsg').classList.toggle('hidden', !!document.pointerLockElement); $('tip').style.opacity = 1;
    G.bestRec = bestOf(); buildProg(); ghostSetup(); CH.init = false; $('style').innerHTML = ''; $('cross').style.display = G.chase ? 'none' : '';
    G.lastFrame = performance.now(); G.acc = 0;
    setTimeout(() => $('tip').style.opacity = 0.5, 9000);
  }, 30);
}
function endToMenu(why) {
  G.on = false; G.paused = false; renderStages(); Net.close(); $('hud').classList.add('hidden'); $('lockmsg').classList.add('hidden'); show('menu'); msg('msg', why || ''); try { document.exitPointerLock(); } catch (e) {} if (window.speechSynthesis) speechSynthesis.cancel(); Sfx.mute(true); setTimeout(() => Sfx.mute(false), 50); refreshRooms();
}
$('bMenu').onclick = () => { Champ.run = null; endToMenu(''); };
function restart() { $('fin').classList.add('hidden'); $('pause').classList.add('hidden'); G.paused = false; if (G.solo) startStage(G.cfg, 'drv', true, 0, G.seats); else if (Net.role === 'host') { Net.started = true; Net.send({ t: 'start', cfg: G.cfg, seats: G.seats }); begin(G.cfg, G.seats); } }
$('bAgain').onclick = restart;
$('bNext').onclick = () => { if (Champ.run) { $('fin').classList.add('hidden'); if (Champ.run.done) { Champ.run = null; endToMenu(''); renderChamps(); show('champ'); } else { Champ.run.i++; champStage(); } return; }
  G.cfg = Object.assign({}, G.cfg, { stage: (G.cfg.stage + 1) % STAGES.length }); $('sStage').value = G.cfg.stage; renderStages(); restart(); };
// ---- pause (Esc releases the mouse; solo practice actually stops the clock) ----
function pauseOpen() { if (!G.on || G.phase === 'fin' || !$('fin').classList.contains('hidden')) return; G.paused = G.solo; $('pSub').textContent = G.solo ? 'The clock is stopped.' : 'Online: the stage keeps running.'; $('pause').classList.remove('hidden'); $('bRestart').classList.toggle('hidden', !!Champ.run || !(G.solo || Net.role === 'host')); }
function pauseClose() { $('pause').classList.add('hidden'); G.paused = false; G.lastFrame = performance.now(); G.acc = 0; try { cvs.requestPointerLock(); } catch (x) {} }
$('bResume').onclick = pauseClose; $('pause').onclick = e => { if (e.target.id === 'pause') pauseClose(); };
$('bRestart').onclick = () => { $('pause').classList.add('hidden'); G.paused = false; restart(); };
$('bQuit').onclick = () => { Champ.run = null; $('pause').classList.add('hidden'); G.paused = false; endToMenu(''); };

// ---------- callouts ----------
function say(txt, words, ms) {
  const el = $('call'), T = String(txt), h = T.split('\u203A')[0], obs = /^(LOG|ROCK|BARRIER)/.test(h) || /!/.test(h), L = !obs && /\bLEFT\b/.test(h), R = !obs && /\bRIGHT\b/.test(h), hp = /HAIRPIN/.test(h);
  $('callA').textContent = obs ? '!' : R ? (hp ? '\u21B7' : '\u2794') : L ? (hp ? '\u21B6' : '\u2794') : /JUMP|CREST|TABLETOP|STEP DOWN/.test(h) ? '\u25B2' : '';
  $('callA').style.transform = L && !hp ? 'scaleX(-1)' : '';
  $('callT').textContent = T; el.classList.toggle('warn', obs || /BRAKE|WRECK|PRESS R/.test(T)); el.classList.add('on');
  clearTimeout(G.callHide); G.callHide = setTimeout(() => el.classList.remove('on'), ms || 2200); if (words) Sfx.say(words);
}
function bigMsg(t) { const b = $('big'); b.textContent = t || ''; b.classList.remove('pop'); if (t) { void b.offsetWidth; b.classList.add('pop'); } }
const CALLS = { KeyJ: ['JUMP', 'jump'], KeyC: ['OVER CREST', 'over crest'], KeyL: ['LOG!', 'log'], KeyK: ['KEEP MIDDLE', 'keep middle'], KeyF: ['FLAT OUT', 'flat out'], KeyB: ['BRAKE!', 'brake brake'] };
let pendDir = null, pendT = 0;
function navKey(code) {
  if (code === 'KeyA' || code === 'ArrowLeft') { pendDir = 'L'; pendT = performance.now(); return; }
  if (code === 'KeyD' || code === 'ArrowRight') { pendDir = 'R'; pendT = performance.now(); return; }
  const dg = /^Digit([1-6])$/.exec(code);
  let c = null;
  if (dg) { const n = +dg[1], dir = performance.now() - pendT < 1500 ? pendDir : null, side = dir === 'L' ? 'left' : dir === 'R' ? 'right' : '';
    c = n === 1 ? ['HAIRPIN ' + side.toUpperCase(), 'hairpin ' + side] : [(side.toUpperCase() + ' ' + n).trim(), (side + ' ' + NUM[n]).trim()]; pendDir = null; }
  else if (code === 'KeyL') { const o = (World.B && World.B.obs) || 'log'; c = [o.toUpperCase() + '!', o]; }
  else if (CALLS[code]) c = CALLS[code];
  if (!c) return;
  Net.send({ t: 'call', c: G.myCar, txt: c[0], w: c[1] }); say(c[0], '', 1200);
}
Net.on('call', m => { if (G.on && G.role === 'drv' && m.c === G.myCar) say(String(m.txt).slice(0, 40), String(m.w || '').slice(0, 60)); });

// ---------- input ----------
const cvs = $('gl');
addEventListener('keydown', e => {
  if (!G.on) return; if (e.code === 'Tab') e.preventDefault(); if (e.code === 'Space') e.preventDefault();
  KEYS.add(e.code);
  if (e.repeat) return;
  if (G.role === 'nav') { if (e.code === 'Tab') look.map = !look.map; else navKey(e.code); }
  if (G.role === 'drv' && e.code === 'KeyR' && G.car && G.phase === 'run') recover();
  if (e.code === 'KeyQ' && !document.pointerLockElement) endToMenu('');
  if (e.code === 'Escape' && !$('pause').classList.contains('hidden')) { pauseClose(); return; }
  if (e.code === 'Backspace' && !Champ.run && (G.solo || Net.role === 'host')) { e.preventDefault(); restart(); }
  if (e.code === 'KeyN') G.noGrades = !G.noGrades;
  if (e.code === 'KeyV' && G.role === 'drv') { G.chase = !G.chase; CH.init = false; $('cross').style.display = G.chase ? 'none' : ''; try { localStorage.setItem('pn-cam', G.chase ? 'chase' : 'in'); } catch (x) {} say(G.chase ? 'CHASE CAM' : 'COCKPIT CAM', '', 900); }
  if (e.code === 'KeyG' && G.role === 'drv') { G.showGhost = G.showGhost === false; say(G.ghost ? (G.showGhost ? 'GHOST ON' : 'GHOST OFF') : 'NO GHOST YET: SET A BEST TIME', '', 1200); }
});
addEventListener('keyup', e => KEYS.delete(e.code));
addEventListener('blur', () => KEYS.clear());
cvs.addEventListener('mousedown', e => { if (!G.on) return; Sfx.start(); if (document.pointerLockElement && e.button === 0) { const k = aimedSwitch(); if (k >= 0) flipSwitch(k); } if (!document.pointerLockElement) { try { cvs.requestPointerLock(); } catch (x) {} } if (e.button === 2 && G.role === 'nav') look.map = true; });
addEventListener('mouseup', e => { if (e.button === 2 && G.role === 'nav' && !KEYS.has('Tab')) look.map = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { const l = !!document.pointerLockElement; if (l) G.wasLocked = true; $('lockmsg').classList.toggle('hidden', l || !G.on || !!G.wasLocked); if (!l && G.on && G.wasLocked) pauseOpen(); });
addEventListener('mousemove', e => { if (!document.pointerLockElement || !G.on) return; look.yaw -= e.movementX * 0.0022; look.pitch -= e.movementY * 0.0022; look.yaw = clamp(look.yaw, -2.5, 2.5); look.pitch = clamp(look.pitch, -1.0, 0.8); look.idle = 0; });
addEventListener('gamepadconnected', e => { pad = e.gamepad.index; });

// dash switches: aim the centre dot at one and click
const RC = new THREE.Raycaster(), C0 = new THREE.Vector2(0, 0);
function aimedSwitch() { if (!G.view || !G.view.hits) return -1; RC.setFromCamera(C0, World.cam); RC.far = 1.4; const h = RC.intersectObjects(G.view.hits, false)[0]; return h ? h.object.userData.sw : -1; }
function flipSwitch(k) { Sfx.click(); if (G.role === 'drv') G.sw[k] ^= 1; else Net.send({ t: 'sw', c: G.myCar, k }); }
Net.on('sw', m => { if (G.on && G.role === 'drv' && m.c === G.myCar && m.k >= 0 && m.k < 6) { G.sw[m.k] ^= 1; Sfx.click(); } });
const inp = { steer: 0, thr: 0, brk: 0, hb: 0 };
function readInput(dt) {
  const L = KEYS.has('KeyA') || KEYS.has('ArrowLeft'), R = KEYS.has('KeyD') || KEYS.has('ArrowRight');
  let target = (L ? 1 : 0) - (R ? 1 : 0);
  // keyboard steering ramps in (faster when reversing direction)
  // a quick tap only nudges the wheel; holding builds to full lock in about 0.4 s
  inp.held = target && target === inp.dir ? (inp.held || 0) + dt : 0; inp.dir = target;
  inp.raw = inp.raw || 0; const rate = target === 0 ? 9 : Math.sign(target) !== Math.sign(inp.raw) && Math.abs(inp.raw) > 0.05 ? 12 : Math.min(7, 2 + inp.held * 14);
  inp.raw += clamp(target - inp.raw, -rate * dt, rate * dt);
  inp.steer = Math.sign(inp.raw) * Math.abs(inp.raw) ** 1.5;
  inp.thr = KEYS.has('KeyW') || KEYS.has('ArrowUp') ? 1 : 0; inp.brk = KEYS.has('KeyS') || KEYS.has('ArrowDown') ? 1 : 0; inp.hb = KEYS.has('Space') ? 1 : 0;
  const gp = pad !== null && navigator.getGamepads ? navigator.getGamepads()[pad] : null;
  if (gp) { const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.08) inp.steer = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4; const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0; if (rt > 0.05) inp.thr = rt; if (lt > 0.05) inp.brk = lt; if (gp.buttons[0] && gp.buttons[0].pressed) inp.hb = 1; if (gp.buttons[3] && gp.buttons[3].pressed && !G.padY && G.phase === 'run') recover(); G.padY = gp.buttons[3] && gp.buttons[3].pressed; }
  return inp;
}
function recover() {
  const c = G.car, up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.q).y;
  if (up > 0.5 && c.speed > 8 && c.roadD < ROAD_HW + 1) return; // upright and driving on the road: nothing to recover from (upside down always works)
  G.stuckT = 0; G.stuckSaid = false;
  $('fade').style.opacity = 0.8; setTimeout(() => $('fade').style.opacity = 0, 250);
  c.place(Math.max(World.startS, c.prog - 5), 0); G.pen += 5; say('RECOVERED +5 s', '', 1500);
}

// ---------- driver: physics, timing, sending ----------
const botClock = () => G.phase === 'fin' ? G.final - G.pen + G.finT : G.t;
function driverStep(dt) {
  if (G.bots && G.bots.length) Bots.step(dt, G.phase, botClock(), G.meAdapt);
  const c = G.car, i = G.phase === 'count' ? { steer: inp.steer, thr: 0, brk: 1, hb: 1 } : readInput(dt);
  if (G.phase === 'count') readInput(dt);
  if (G.phase !== 'count') { c.step(dt, i); if (G.rivals && G.rivals.length) c.bump(G.rivals); } else { c.step(dt, { steer: 0, thr: KEYS.has('KeyW') ? 1 : 0, brk: 0, hb: 1 }); c.v.multiplyScalar(0); c.place(G.grid.s, G.grid.lat); c.rpm = KEYS.has('KeyW') ? 6500 : CAR.idle; }
}
function stagePhase(dt) {
  if (G.phase === 'count') {
    G.t += dt; const n = Math.ceil(-G.t);
    if (n !== G.lastBeep && n >= 1 && n <= 3) { G.lastBeep = n; Sfx.beep(false); bigMsg(String(n)); }
    if (G.t >= 0) { G.phase = 'run'; G.t = 0; Sfx.beep(true); bigMsg('GO'); setTimeout(() => G.phase === 'run' && msg('big', ''), 900); if (G.autoNav) Notes.auto(G.auto, G.notes, G.car.prog, 0, (t, w) => say(t, w)); }
  } else if (G.phase === 'run') {
    G.t += dt; const c = G.car;
    if (G.nextSplit < 2 && c.prog >= G.splitS[G.nextSplit]) { G.splits.push(G.t + G.pen); const best = bestOf(); const ref = best && best.splits ? best.splits[G.nextSplit] : null; { const d = ref ? G.t + G.pen - ref : null; $('split').innerHTML = 'SPLIT ' + (G.nextSplit + 1) + ' &nbsp;' + fmtT(G.t + G.pen) + (d !== null ? ' &nbsp;<span class="' + (d >= 0 ? 'up' : 'dn') + '">' + (d >= 0 ? '+' : '\u2212') + Math.abs(d).toFixed(1) + '</span>' : ''); } setTimeout(() => msg('split', ''), 4000); G.nextSplit++; }
    if (c.prog >= G.finishS) { G.phase = 'fin'; G.finT = 0; G.final = G.t + G.pen; msg('big', fmtT2(G.final)); Sfx.beep(true); finishRecord(); }
    if (G.autoNav) Notes.auto(G.auto, G.notes, c.prog, c.speed, (t, w) => say(t, w));
  } else if (G.phase === 'fin') {
    G.finT += dt; if (G.finT > 3.2 && !G.finShown) { G.finShown = true; showFinish(); }
  }
}
const bestKey = () => 'pn-best-' + G.cfg.stage + '-' + G.cfg.fog;
function bestOf() { try { return JSON.parse(localStorage.getItem(bestKey()) || 'null'); } catch (e) { return null; } }
function finishRecord() {
  if (!G.counted) { G.counted = true; const before = CARS.filter((_, k) => carOpen(k)).length; Garage.fin++; try { localStorage.setItem('pn-fin', Garage.fin); } catch (e) {} const now = CARS.filter((_, k) => carOpen(k)); G.unlockMsg = now.length > before ? 'NEW CAR UNLOCKED: ' + now[now.length - 1].name.toUpperCase() : ''; renderGarage(); } const b = bestOf(); G.wasBest = !b || G.final < b.t; if (G.wasBest) try { localStorage.setItem(bestKey(), JSON.stringify({ t: G.final, splits: G.splits, tr: G.trace }));
  if (G.role === 'drv' && G.rec && G.rec.length > 10 && (!G.ghost || G.final < G.ghost.t)) try { localStorage.setItem(ghostKey(), JSON.stringify({ t: G.final, car: Garage.sel, p: G.rec })); } catch (e) {}; } catch (e) {} G.prevBest = b; }
function showFinish() { $('call').classList.remove('on'); clearTimeout(G.callHide);
  try { document.exitPointerLock(); } catch (e) {}
  const st = STAGES[G.cfg.stage], rows = [['Stage', st.name + ' (' + (G.S.L / 1000).toFixed(2) + ' km)'], ['Time', fmtT2(G.final)], ['Penalties', '+' + G.pen + ' s'], ['Average', (G.S.L / Math.max(1, G.final) * 3.6).toFixed(1) + ' km/h'], ['Damage', Math.round((G.dmg || 0) * 100) + '%'], ['Best', G.wasBest || !G.prevBest ? 'NEW BEST' : fmtT2(G.prevBest.t)]];
  rows.splice(1, 1); rows.splice(4, 1);
  const st2 = G.style || {}; if (G.role === 'drv') { rows.push(['Style', (st2.pts || 0) + ' pts']); if (st2.drift) rows.push(['Longest drift', st2.drift.toFixed(1) + ' s']); if (st2.air) rows.push(['Biggest air', st2.air.toFixed(1) + ' s']); }
  const mk = medalOf(G.cfg.stage, G.final), nx = mk === 0 ? null : mk < 0 ? 2 : mk - 1;
  rows.push(['Medal', mk >= 0 ? medalDot(mk) + MEDALS[mk][0] : 'none'], ...(nx !== null ? [[MEDALS[nx][0].charAt(0) + MEDALS[nx][0].slice(1).toLowerCase() + ' time', fmtT2(medalT(G.cfg.stage, nx))]] : []));
  $('finTab').innerHTML = rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
  $('finTime').textContent = fmtT2(G.final);
  const d = G.prevBest ? G.final - G.prevBest.t : null, fd = $('finDelta');
  fd.className = 'fdelta' + (d === null ? '' : d < 0 ? ' dn' : ' up');
  fd.textContent = d === null ? 'First run on this stage' : (d < 0 ? 'NEW BEST  \u2212' : '+') + Math.abs(d).toFixed(2) + (d < 0 ? '' : '  vs best ' + fmtT2(G.prevBest.t));
  $('finK').textContent = G.race ? 'RACE RESULTS' : G.wasBest ? 'NEW BEST TIME' : 'STAGE COMPLETE';
  if (G.race) G.resT = 0;
  $('finUnlock').classList.toggle('hidden', !G.unlockMsg); $('finUnlock').textContent = G.unlockMsg ? '\u2605 ' + G.unlockMsg : '';
  const ctl = G.solo || Net.role === 'host'; $('bAgain').classList.toggle('hidden', !ctl); $('bNext').classList.toggle('hidden', !ctl);
  msg('finMsg', ctl ? '' : 'Waiting for the host to restart...');
  $('bNext').textContent = 'Next stage'; $('bMenu').textContent = 'Menu';
  if (Champ.run && G.solo) champFinish();
  $('fin').classList.remove('hidden');
}
function resultsTable(prog) {
  const crew = c => G.seats[c].filter(Boolean).map(x => x.name.replace(/[<>&]/g, '')).join(' / ');
  $('finTab').innerHTML = G.order.map((c, i) => '<tr><td><b style="color:' + hex(CAR_COL[c]) + '">P' + (i + 1) + ' ' + CAR_NAME[c] + '</b> ' + crew(c) + (c === G.myCar ? ' (you)' : '') + '</td><td>' + (G.results[c] ? fmtT2(G.results[c]) : 'running ' + (Math.max(0, prog(c) - World.startS) / 1000).toFixed(2) + ' km') + '</td></tr>').join('');
}
function sendCar(dt) {
  G.sendT -= dt; if (G.sendT > 0 || G.solo) return; G.sendT = 1 / 30; const c = G.car;
  const ev = c.netEv || []; c.netEv = [];
  Net.send(Object.assign(c.pack({ c: G.myCar, sw: G.sw.join(''), ph: G.phase, tm: Math.round(G.t * 100) / 100, pn: G.pen, fin: G.final || 0 }), { ev, hb: inp.hb, sp: c.wh.map(w => Math.round(w.spin)) }));
}
Net.on('car', m => { if (!G.on || !G.bufs || !G.bufs[m.c] || (m.c === G.myCar && G.role === 'drv')) return; m.rt = performance.now(); const B = G.bufs[m.c]; B.push(m); if (B.length > 40) B.shift(); if (m.c === G.myCar) for (const e of m.ev || []) carEvent(e); });
Net.on('look', m => { if (G.on && m.c === G.myCar) { G.other.yaw = clamp(+m.y || 0, -3, 3); G.other.pitch = clamp(+m.p || 0, -1.2, 1); G.other.map = !!m.m; } });
function carEvent(e) { if (e.k === 'crash' || e.k === 'wreck') G.hurt = Math.min(1, (G.hurt || 0) + e.v / 14); if (e.k === 'wreck') { Sfx.crash(20); G.view.shake = 1; say('WRECKED  +10 s', '', 2200); $('fade').style.opacity = 0.9; if (G.role === 'drv') setTimeout(() => { if (G.car && G.car.wrecked && G.phase === 'run') { G.car.place(Math.max(World.startS, G.car.prog - 5), 0); G.pen += 10; } $('fade').style.opacity = 0; }, 1300); else setTimeout(() => $('fade').style.opacity = 0, 1300); } else if (e.k === 'crash') { Sfx.crash(e.v); G.view.shake = Math.min(1, e.v / 12); } else if (e.k === 'thud') { Sfx.thud(e.v); G.view.shake = Math.min(0.6, e.v / 15); } else if (e.k === 'shift') Sfx.shift(); else if (e.k === 'land') { Sfx.thud(2 + e.v * 6); G.view.shake = Math.max(G.view.shake || 0, 0.15 + e.v * 0.35); } }

// ---------- navigator: interpolate the driver's car ----------
const IP = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), a: new THREE.Quaternion(), b: new THREE.Quaternion() };
function navState() { return interp(G.bufs[G.myCar]); }
function interp(B) {
  if (!B || !B.length) return null;
  const rt = performance.now() - 120; let i = B.length - 1; while (i > 0 && B[i - 1].rt > rt) i--;
  const a = B[Math.max(0, i - 1)], b = B[i]; let t = a === b ? 0 : clamp((rt - a.rt) / Math.max(1, b.rt - a.rt), 0, 1);
  const ex = b.rt < rt ? Math.min(0.25, (rt - b.rt) / 1000) : 0;
  IP.pos.set(lerp(a.p[0], b.p[0], t) + b.v[0] * ex, lerp(a.p[1], b.p[1], t) + b.v[1] * ex, lerp(a.p[2], b.p[2], t) + b.v[2] * ex);
  IP.a.set(...a.q).normalize(); IP.b.set(...b.q).normalize(); IP.q.slerpQuaternions(IP.a, IP.b, t);
  IP.vel.set(lerp(a.v[0], b.v[0], t), lerp(a.v[1], b.v[1], t), lerp(a.v[2], b.v[2], t));
  return { pos: IP.pos.clone(), q: IP.q.clone(), vel: IP.vel.clone(), steer: lerp(a.st, b.st, t), comp: b.c, speed: IP.vel.length(), speedF: IP.vel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(IP.q)), rpm: lerp(a.rpm, b.rpm, t), gear: b.g, thr: b.th, slide: b.sl, offroad: b.of, air: b.air, hb: b.hb, prog: b.pr, dmg: b.dm, ph: b.ph, tm: b.tm, pn: b.pn, fin: b.fin, sw: String(b.sw || '110000').split('').map(Number), hl: (b.sw || '')[4] === '1', wp: (b.sw || '')[3] === '1', spot: (b.sw || '')[5] === '1', clock: b.ph === 'fin' ? b.fin : b.ph === 'run' ? b.tm + b.pn : 0 };
}

// ---------- frame ----------
const PH = 1 / 120;
const fwdV = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  if (!G.on) return;
  let dt = Math.min(0.1, (now - G.lastFrame) / 1000); G.lastFrame = now;
  if (G.paused) return;
  let st;
  if (G.role === 'drv') {
    G.acc += dt; let n = 0;
    while (G.acc >= PH && n < 12) { driverStep(PH); stagePhase(PH); G.acc -= PH; n++; }
    const c = G.car; for (const e of c.events) { carEvent(e); (c.netEv = c.netEv || []).push(e.v ? { k: e.k, v: Math.round(e.v * 10) / 10 } : { k: e.k }); } c.events.length = 0;
    sendCar(dt); G.dmg = c.dmg;
    fwdV.set(0, 0, 1).applyQuaternion(c.q);
    st = { pos: c.pos, q: c.q, vel: c.v, steer: c.steer, comp: c.wh.map(w => w.comp), spinW: 0, speed: c.speed, speedF: c.v.dot(fwdV), rpm: c.rpm, gear: c.gear, thr: c.thr, slide: c.slide, offroad: c.offroad, air: c.air > 0, hb: inp.hb, prog: c.prog, dmg: c.dmg, sw: G.sw, hl: G.sw[4], wp: G.sw[3], spot: G.sw[5], clock: G.phase === 'fin' ? G.final : G.phase === 'run' ? G.t + G.pen : 0 };
    st.spinW = c.wh[2].spin;
    ghostRecord(dt); styleStep(st, dt);
    // driver's view drifts back to centre when the mouse is idle
    look.idle += dt; if (look.idle > 1.2) { look.yaw *= Math.exp(-dt * 2.5); look.pitch += (-0.1 - look.pitch) * (1 - Math.exp(-dt * 2.5)); }
  } else {
    st = navState();
    if (!st) { World.render(); return; }
    G.phase = st.ph === 'count' ? 'count' : st.ph; G.t = st.tm; G.pen = st.pn; G.dmg = st.dmg;
    if (G.phase === 'count') { const n = Math.ceil(-st.tm); if (n !== G.lastBeep && n >= 1 && n <= 3) { G.lastBeep = n; Sfx.beep(false); bigMsg(String(n)); } }
    if (G.phase === 'run' && G.lastBeep !== 0) { G.lastBeep = 0; Sfx.beep(true); bigMsg('GO'); setTimeout(() => msg('big', ''), 900); }
    if (G.phase === 'fin' && !G.finShown) { if (!G.finT) { G.final = st.fin; msg('big', fmtT2(st.fin)); finishRecord(); } G.finT += dt; if (G.finT > 3.2) { G.finShown = true; showFinish(); } }
    G.lookT -= dt; if (G.lookT <= 0) { G.lookT = 0.1; Net.send({ t: 'look', c: G.myCar, y: Math.round(look.yaw * 100) / 100, p: Math.round(look.pitch * 100) / 100, m: look.map ? 1 : 0 }); }
  }
  if (G.role === 'drv' && !G.solo) { G.lookT -= dt; if (G.lookT <= 0) { G.lookT = 0.1; Net.send({ t: 'look', c: G.myCar, y: Math.round(look.yaw * 100) / 100, p: Math.round(look.pitch * 100) / 100, m: 0 }); } }
  // rival cars: draw them interpolated; drivers also collide with their latest pose
  if (G.race) {
    const now2 = performance.now(), riv = [];
    for (const c of G.cars) {
      if (c === G.myCar) continue; const B = G.bufs[c], v = G.views[c], tg = G.tags[c], s2 = interp(B);
      if (!s2) { v.g.visible = false; tg.visible = false; continue; }
      v.g.visible = true; v.update(s2, dt, 'x', look, null); tg.visible = s2.pos.distanceTo(st.pos) < 140; tg.position.copy(s2.pos).y += 1.9;
      const L = B[B.length - 1], age = Math.min(0.3, (now2 - L.rt) / 1000); riv.push({ pos: new THREE.Vector3(L.p[0] + L.v[0] * age, L.p[1] + L.v[1] * age, L.p[2] + L.v[2] * age), q: new THREE.Quaternion(...L.q).normalize(), vel: new THREE.Vector3(...L.v) });
      if (L.fin) G.results[c] = L.fin;
    }
    G.rivals = riv;
    if (G.final) G.results[G.myCar] = G.final;
    // standings: finishers by time, then everyone else by distance
    const prog = c => c === G.myCar ? st.prog : ((G.bufs[c] || []).slice(-1)[0] || { pr: 0 }).pr;
    G.order = G.cars.slice().sort((a, b) => (G.results[a] || 1e9) - (G.results[b] || 1e9) || prog(b) - prog(a));
    $('pos').textContent = 'P' + (G.order.indexOf(G.myCar) + 1) + ' / ' + G.cars.length;
    if (G.finShown && (G.resT = (G.resT || 0) - dt) <= 0) { G.resT = 0.5; resultsTable(prog); }
  }
  // visuals
  G.view.update(st, dt, G.chase ? 'x' : G.role, look, G.solo ? null : G.other);
  if (G.chase) chaseCam(World.cam, st, dt); else G.view.camera(World.cam, st, G.role, look, dt);
  if (G.role === 'drv') ghostStep(dt);
  if (G.bots && G.bots.length) { Bots.render(dt, look, World.cam.position); botStandings(st); }
  if (G.role === 'nav' || G.view.mapUp > 0.02 || G.solo) {
    G.mapTk = (G.mapTk || 0) - dt;
    if (G.mapTk <= 0 && (G.role === 'nav' || G.view.mapUp > 0.02)) { G.mapTk = 0.1; fwdV.set(0, 0, 1).applyQuaternion(st.q); MapDraw.draw(G.view.mapC.getContext('2d'), { x: st.pos.x, z: st.pos.z, h: Math.atan2(fwdV.x, fwdV.z), prog: st.prog }, { grades: !G.noGrades, vis: [140, 90, 55][G.cfg.fog], others: G.race ? G.cars.filter(c => c !== G.myCar).map(c => { const L = (G.bufs[c] || []).slice(-1)[0]; return L ? { x: L.p[0], z: L.p[2], col: hex(CAR_COL[c]) } : null; }).filter(Boolean) : [] }); G.view.mapT.needsUpdate = true; }
  }
  // dust and gravel spray from the rear wheels
  if (st.speed > 4 && !st.air) {
    const n = (st.slide * 1.6 + st.speed / 50) * (st.offroad > 0.5 ? 0.4 : 1) * dt * 30 * (World.B.dustK || 1);
    for (let k = 0; k < n; k++) if (Math.random() < 0.6) {
      const side = Math.random() < 0.5 ? 0.8 : -0.8, p = new THREE.Vector3(side, -0.6, -1.4).applyQuaternion(st.q).add(st.pos), v = st.vel;
      const off = st.offroad > 0.5, c = off ? [0.45, 0.4, 0.3] : World.B.dust;
      World.puff(p.x, p.y, p.z, v.x * 0.25 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.6, v.z * 0.25 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.6, 1.0 + Math.random() * 1.0, c[0], c[1], c[2]);
    }
  }
  if (G.role === 'drv' && G.car) skids(G.car);
  World.stepDust(dt);
  World.update(World.cam.position, st.pos);
  if (World.gfx !== 'low' && (G.mirT = (G.mirT || 0) + 1) % 2 === 0) G.view.renderMirror(World.R, World.scene, st);
  Sfx.update({ rpm: st.rpm, thr: st.thr, speed: st.speed, slide: st.slide, offroad: st.offroad, air: st.air, inside: 1 }, dt);
  hud(st);
  // spectators cheer as you pass
  for (const cr of World.crowds || []) { const d = Math.hypot(cr.x - st.pos.x, cr.z - st.pos.z); if (d < 40 && !cr.cheered) { cr.cheered = true; Sfx.cheer(Math.min(1, st.speed / 25)); } if (d < 60) World.wave(cr, now / 1000); }
  // stuck or upside down: tell the driver how to recover
  if (G.role === 'drv' && G.phase === 'run') { const up = fwdV.set(0, 1, 0).applyQuaternion(st.q).y; G.stuckT = (up < 0.35 || (st.speed < 1.2 && G.car.roadD > ROAD_HW + 1)) ? (G.stuckT || 0) + dt : 0; if (G.stuckT > 1.5 && !G.stuckSaid) { G.stuckSaid = true; say('PRESS R TO RECOVER', '', 2500); } if (G.stuckT > 4) { G.stuckT = 0; recover(); } if (G.stuckT === 0) G.stuckSaid = false; }
  G.hurt = Math.max(0, (G.hurt || 0) - dt * 1.2);
  perf(dt);
  World.render({ spd: clamp((st.speed - 14) / 34, 0, 1), hurt: G.hurt });
}
// tyre marks from every sliding wheel in contact, one strip per ~0.6 m
function skids(c) {
  const P = G.skP || (G.skP = [null, null, null, null]);
  for (let i = 0; i < 4; i++) {
    const w = c.wh[i], p = w.cp, L = P[i];
    if (!w.contact || w.slip < 0.42 || c.speed < 3) { P[i] = null; continue; }
    if (!L) { P[i] = p.clone(); continue; }
    const dx = p.x - L.x, dz = p.z - L.z, d = Math.hypot(dx, dz); if (d < 0.6) continue;
    if (d < 3) World.skidMark((p.x + L.x) / 2, (p.y + L.y) / 2, (p.z + L.z) / 2, Math.atan2(dx, dz), d, 0.21);
    L.copy(p);
  }
}
function hud(st) {
  if ((G.hovT = (G.hovT || 0) - 1) <= 0) { G.hovT = 6; const k = document.pointerLockElement ? aimedSwitch() : -1, sw = st.sw || G.sw || []; $('hov').textContent = k >= 0 ? SWITCH_NAMES[k] + (sw[k] ? ' · ON' : ' · OFF') + '  (click)' : ''; }
  const done = Math.max(0, st.prog - World.startS), len = Math.max(1, G.finishS - G.startS), clk = G.phase === 'count' ? 0 : (G.phase === 'fin' ? G.final - G.pen : G.t) + G.pen;
  $('trip').textContent = (done / 1000).toFixed(2) + ' / ' + (len / 1000).toFixed(2) + ' km';
  $('tm').textContent = fmtT(clk);
  $('progF').style.width = clamp(done / len, 0, 1) * 100 + '%';
  // live delta against the best run, sampled every 50 m
  const k = Math.floor(done / 50);
  if (G.phase === 'run' && G.trace[k] === undefined) G.trace[k] = Math.round(clk * 100) / 100;
  if ((G.dlT = (G.dlT || 0) - 1) <= 0) { G.dlT = 8; const ref = G.bestRec && G.bestRec.tr && G.bestRec.tr[k], dl = $('dl');
    if (G.phase === 'run' && ref !== undefined && ref !== null && k > 0) { const d = G.trace[k] - ref; dl.textContent = (d >= 0 ? '+' : '\u2212') + Math.abs(d).toFixed(1); dl.className = d >= 0 ? 'up' : 'dn'; }
    else { dl.textContent = G.bestRec ? 'BEST ' + fmtT(G.bestRec.t) : ''; dl.className = ''; } }
  // car dots on the progress bar (rivals in a race)
  if (G.progDots) for (const [c, el] of G.progDots) { const p = typeof c === 'string' ? G.bots[+c.slice(1)].car.prog : c === G.myCar ? st.prog : ((G.bufs[c] || []).slice(-1)[0] || { pr: G.startS }).pr; el.style.left = clamp((p - G.startS) / len, 0, 1) * 100 + '%'; }
  if (G.role === 'drv') {
    $('spd').querySelector('b').textContent = Math.round(st.speed * 3.6); $('gear').textContent = st.gear < 0 ? 'R' : st.gear || 'N';
    drawRev(st.rpm);
    const dm = Math.round((G.dmg || 0) * 100); $('dmg').querySelector('u').style.width = dm + '%'; $('dmgP').textContent = dm + '%'; $('dmg').classList.toggle('hi', dm >= 50);
  }
  $('net').textContent = G.solo ? '' : (Net.role === 'host' ? 'ping ' + Math.round(Net.ping) + ' ms' : (performance.now() - Net.lastRx > 2500 ? 'NO SIGNAL' : 'online'));
}
function buildProg() {
  const box = $('progDots'); box.innerHTML = ''; G.progDots = [];
  const cs = (G.race ? G.cars.filter(c => c !== G.myCar) : []).concat((G.bots || []).map((b, k) => 'b' + k), [G.myCar]);
  for (const c of cs) { const i = document.createElement('i'); i.style.setProperty('--c', typeof c === 'string' ? hex(G.bots[+c.slice(1)].col) : hex(CAR_COL[c])); if (c === G.myCar) i.className = 'me'; box.appendChild(i); G.progDots.push([c, i]); }
}
// rev counter ring around the speed readout
let revLast = -1;
function drawRev(rpm) {
  const r = Math.round(rpm / 50); if (r === revLast) return; revLast = r;
  const c = $('rev'), x = c.getContext('2d'), W = 200, cx = 100, cy = 100, R0 = 88, a0 = Math.PI * 0.75, span = Math.PI * 1.5, max = 8000, red = CAR.red, f = clamp(rpm / max, 0, 1);
  x.clearRect(0, 0, W, W);
  x.beginPath(); x.arc(cx, cy, R0 + 8, 0, Math.PI * 2); x.fillStyle = 'rgba(8,10,9,.55)'; x.fill();
  x.lineCap = 'butt'; x.lineWidth = 9;
  x.beginPath(); x.arc(cx, cy, R0 - 2, a0, a0 + span); x.strokeStyle = 'rgba(255,255,255,.12)'; x.stroke();
  x.beginPath(); x.arc(cx, cy, R0 - 2, a0 + span * red / max, a0 + span); x.strokeStyle = 'rgba(224,72,58,.45)'; x.stroke();
  const hot = rpm > red - 400, g = x.createLinearGradient(0, 200, 200, 0); g.addColorStop(0, '#f2b632'); g.addColorStop(1, hot ? '#ff4a3a' : '#ffd36a');
  x.beginPath(); x.arc(cx, cy, R0 - 2, a0, a0 + span * f); x.strokeStyle = g; x.stroke();
  x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i <= 8; i++) { const a = a0 + span * i / 8; x.beginPath(); x.moveTo(cx + Math.cos(a) * (R0 - 9), cy + Math.sin(a) * (R0 - 9)); x.lineTo(cx + Math.cos(a) * (R0 - 15), cy + Math.sin(a) * (R0 - 15)); x.stroke(); }
}
// ---------- championships: a run of stages against AI rivals, total time decides ----------
const CHAMPS = [
  { id: 'forest', name: 'Forest Cup', d: 'Three gravel sprints under the pines', st: [11, 0, 1] },
  { id: 'jumps', name: 'Jump Masters', d: 'Berms, kickers and big air', st: [12, 14, 13] },
  { id: 'seasons', name: 'Four Seasons', d: 'Autumn, snow, desert and city', st: [3, 5, 7, 9] },
  { id: 'grand', name: 'Grand Tour', d: 'Six stages, every surface, night finish', st: [2, 4, 6, 8, 13, 10] }
];
// fictional drivers; skill scales the silver-medal time (lower is faster)
const RIVALS = [['Lasse Moos', 0.86], ['Petra Kova', 0.89], ['Jules Ferrand', 0.92], ['Dai Hughes', 0.95], ['Marco Ventisei', 0.98], ['Ines Duarte', 1.02], ['Sven Aalto', 1.06], ['Bodge Mulligan', 1.13]];
const Champ = { run: null };
const champBest = id => { try { return +localStorage.getItem('pn-champ-' + id) || 0; } catch (e) { return 0; } };
function renderChamps() {
  $('chList').innerHTML = CHAMPS.map((c, k) => { const b = champBest(c.id), km = c.st.reduce((a, i) => a + STAGES[i].len, 0) / 1000;
    return '<button class="chc" data-k="' + k + '"><b>' + c.name + '</b><small>' + c.d + '</small><small>' + c.st.length + ' stages · ' + km.toFixed(1) + ' km · ' + c.st.map(i => BIOMES[STAGES[i].biome].name).filter((v, j, a) => a.indexOf(v) === j).join(', ') + '</small>' + (b ? '<em class="' + (b === 1 ? 'win' : '') + '">' + (b === 1 ? '★ CHAMPION' : 'Best P' + b) + '</em>' : '') + '</button>'; }).join('');
}
$('bChamp').onclick = () => { if (carLocked()) return; renderChamps(); show('champ'); };
$('chBack').onclick = () => show('menu');
$('chList').onclick = e => { const b = e.target.closest('.chc'); if (!b) return; champStart(CHAMPS[+b.dataset.k]); };
function champStart(c) {
  Sfx.start(); Net.close();
  Champ.run = { c, i: 0, mine: [], riv: RIVALS.map(([n, s]) => ({ n, s: s * (0.97 + Math.random() * 0.06), t: [] })) };
  champStage();
}
function champStage() { const R = Champ.run, cfg = { stage: R.c.st[R.i], fog: +$('sFog').value, hostRole: 'drv' }; startStage(cfg, 'drv', true, 0, [[{ id: 'me', name: myName(), car: Net.car | 0 }, null]]); }
function rivalTime(r, stage) { // silver pace times skill, with a bad-luck spin now and then
  let t = medalT(stage, 1) * r.s * (0.97 + Math.random() * 0.06); if (Math.random() < 0.08) t += 8 + Math.random() * 20; return Math.round(t * 100) / 100;
}
function champFinish() {
  const R = Champ.run, stage = R.c.st[R.i]; if (R.mine.length > R.i) return; R.mine.push(G.final);
  for (const r of R.riv) { const b = (G.bots || []).find(x => x.ref === r); r.t.push(b ? Math.round(Bots.eta(b, botClock()) * 100) / 100 : rivalTime(r, stage)); }
  const sum = a => a.reduce((x, y) => x + y, 0), me = { n: myName() + ' (you)', tot: sum(R.mine), st: G.final, me: 1 };
  const all = R.riv.map(r => ({ n: r.n, tot: sum(r.t), st: r.t[R.i] })).concat([me]).sort((a, b) => a.tot - b.tot);
  const stPos = all.slice().sort((a, b) => a.st - b.st).indexOf(me) + 1, pos = all.indexOf(me) + 1, last = R.i === R.c.st.length - 1, lead = all[0].tot;
  $('finK').textContent = R.c.name.toUpperCase() + ' · STAGE ' + (R.i + 1) + ' / ' + R.c.st.length;
  $('finDelta').className = 'fdelta' + (stPos === 1 ? ' dn' : ''); $('finDelta').textContent = 'Stage ' + ordinal(stPos) + ' · ' + (last ? 'Final' : 'Overall') + ' ' + ordinal(pos);
  $('finTab').innerHTML = '<tr><td colspan=2 style="color:var(--dim);font-size:12px;letter-spacing:.12em">' + (last ? 'FINAL STANDINGS' : 'STANDINGS') + '</td></tr>' + all.map((x, k) => '<tr class="' + (x.me ? 'me' : '') + '"><td>' + (k + 1) + '. ' + x.n.replace(/[<>&]/g, '') + '</td><td>' + (k ? '+' + fmtT2(x.tot - lead) : fmtT2(x.tot)) + '</td></tr>').join('');
  $('bAgain').classList.add('hidden'); $('bNext').classList.remove('hidden'); $('bNext').textContent = last ? 'Finish' : 'Next stage (' + (R.i + 2) + '/' + R.c.st.length + ')';
  $('bMenu').textContent = last ? 'Menu' : 'Retire';
  if (last) {
    const b = champBest(R.c.id); if (!b || pos < b) try { localStorage.setItem('pn-champ-' + R.c.id, pos); } catch (e) {}
    $('finK').textContent = R.c.name.toUpperCase() + ' · FINAL';
    $('finUnlock').classList.remove('hidden'); $('finUnlock').textContent = pos === 1 ? '★ CHAMPION! You won the ' + R.c.name : pos <= 3 ? 'Podium: ' + ordinal(pos) + ' overall' : ordinal(pos) + ' overall. Go again?';
    R.done = true;
  }
}
const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
// ---------- race against the AI cars: live position and results ----------
function botOrder(st) {
  const clk = botClock(), me = { me: 1, name: myName() + ' (you)', fin: G.final ? G.final : 0, prog: st ? st.prog : G.car.prog, col: CAR_COL[0] };
  const all = G.bots.map(b => ({ name: b.name, fin: b.fin, prog: b.car.prog, eta: Bots.eta(b, clk), col: b.col })).concat([me]);
  return all.sort((a, b) => (a.fin || 1e9) - (b.fin || 1e9) || b.prog - a.prog);
}
function botStandings(st) {
  if ((G.bsT = (G.bsT || 0) - 1) > 0) return; G.bsT = 10;
  const o = botOrder(st); $('pos').textContent = 'P' + (o.findIndex(x => x.me) + 1) + ' / ' + o.length;
  if (G.finShown && !Champ.run) {
    $('finTab').innerHTML = o.map((x, i) => '<tr class="' + (x.me ? 'me' : '') + '"><td><b style="color:' + hex(x.col) + '">P' + (i + 1) + '</b> ' + x.name.replace(/[<>&]/g, '') + '</td><td>' + (x.fin ? fmtT2(x.fin) : 'running ' + (Math.max(0, x.prog - G.startS) / 1000).toFixed(2) + ' km') + '</td></tr>').join('');
    const p = o.findIndex(x => x.me) + 1; $('finK').textContent = 'RACE RESULTS · ' + ordinal(p).toUpperCase() + ' PLACE';
  }
}
// ---------- chase camera (V) ----------
const CH = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), f: new THREE.Vector3(), want: new THREE.Vector3(), init: false };
function chaseCam(cam, st, dt) {
  const f = CH.f.set(0, 0, 1).applyQuaternion(st.q); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, 1); f.normalize();
  const a = look.yaw, cs = Math.cos(a), sn = Math.sin(a), bx = f.x * cs + f.z * sn, bz = -f.x * sn + f.z * cs;
  const want = CH.want.set(st.pos.x - bx * 6.4, st.pos.y + 2.3 - look.pitch * 3, st.pos.z - bz * 6.4);
  const gy = G.S.heightAt(want.x, want.z) + 0.8; if (want.y < gy) want.y = gy;
  if (!CH.init) { CH.pos.copy(want); CH.init = true; } CH.pos.lerp(want, 1 - Math.exp(-dt * 7));
  CH.tgt.set(st.pos.x + f.x * 3, st.pos.y + 0.9, st.pos.z + f.z * 3);
  cam.position.copy(CH.pos); if (G.view.shake) cam.position.y += (Math.random() - 0.5) * G.view.shake * 0.15; cam.lookAt(CH.tgt);
  cam.fov = lerp(cam.fov, 62 + Math.min(18, st.speed * 3.6 / 10), Math.min(1, dt * 3)); cam.updateProjectionMatrix();
}
// ---------- ghost of your best run (driver only; G toggles) ----------
const ghostKey = () => 'pn-ghost-' + G.cfg.stage; // one ghost per stage (any fog) keeps localStorage small
function ghostSetup() {
  if (G.ghost) { World.scene.remove(G.ghost.v.g); }
  G.rec = []; G.ghost = null; if (G.role !== 'drv') return;
  let d = null; try { d = JSON.parse(localStorage.getItem(ghostKey()) || 'null'); } catch (e) {}
  if (!d || !d.p || d.p.length < 10) return;
  const v = new CarView(World.scene, { color: 0xbfd6ff, remote: true, look: CARS[clamp(d.car | 0, 0, CARS.length - 1)].look });
  for (const k of ['drv', 'nav']) if (v.crew && v.crew[k]) v.crew[k].g.visible = false;
  v.g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.3; o.material.depthWrite = false; o.castShadow = false; } if (o.isLight) o.intensity = 0; });
  v.g.visible = false; G.ghost = { v, d: d.p, t: d.t };
}
const GQ = [new THREE.Quaternion(), new THREE.Quaternion()], GS = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), steer: 0, comp: [0.1, 0.1, 0.1, 0.1], speedF: 0, spinW: 0, hb: 0, dmg: 0, sw: [0, 0, 0, 0, 0, 0] };
function ghostStep(dt) {
  const g = G.ghost; if (!g) return; g.v.g.visible = false; if (G.phase !== 'run' || G.showGhost === false) return;
  const f = G.t / 0.1, i = Math.floor(f); if (i >= g.d.length - 1) return; const a = g.d[i], b = g.d[i + 1], t = f - i;
  GS.pos.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)); GQ[0].set(a[3], a[4], a[5], a[6]).normalize(); GQ[1].set(b[3], b[4], b[5], b[6]).normalize(); GS.q.slerpQuaternions(GQ[0], GQ[1], t);
  GS.speedF = Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.1;
  g.v.g.visible = GS.pos.distanceTo(G.car.pos) > 2.5; g.v.update(GS, dt, 'x', look, null);
}
function ghostRecord() {
  if (G.phase !== 'run' || !G.rec) return; const c = G.car, n = Math.floor(G.t / 0.1); if (n < G.rec.length || G.rec.length > 9000) return;
  const r = x => Math.round(x * 100) / 100, q = x => Math.round(x * 1000) / 1000; G.rec.push([r(c.pos.x), r(c.pos.y), r(c.pos.z), q(c.q.x), q(c.q.y), q(c.q.z), q(c.q.w)]);
}
// ---------- style: drifts and big air ----------
function styleStep(st, dt) {
  const S = G.style; if (!S || G.phase !== 'run') return;
  fwdV.set(0, 0, 1).applyQuaternion(st.q); const vF = st.vel.x * fwdV.x + st.vel.z * fwdV.z, sp = Math.hypot(st.vel.x, st.vel.z), fl = Math.hypot(fwdV.x, fwdV.z) || 1, ang = sp > 1 ? Math.acos(clamp(vF / sp / fl, -1, 1)) : 0;
  if (G.car.air < 0.2 && sp > 11 && ang > 0.2 && ang < 1.6) { S.dT += dt; S.dA = Math.max(S.dA, ang); } else if (S.dT > 0 && (G.car.air >= 0.2 || ang < 0.12 || sp < 8)) {
    if (S.dT >= 1) { const pts = Math.round(S.dT * S.dA * 57 * 6); S.pts += pts; S.drift = Math.max(S.drift, S.dT); pop((S.dT > 3 ? 'MEGA DRIFT ' : 'DRIFT ') + S.dT.toFixed(1) + ' s', '+' + pts); }
    S.dT = 0; S.dA = 0;
  }
  if (G.car.air > 0) S.aT = G.car.air; else if (S.aT > 0) { if (S.aT >= 0.55) { const pts = Math.round(S.aT * 300); S.pts += pts; S.air = Math.max(S.air, S.aT); pop((S.aT > 1.2 ? 'HUGE AIR ' : 'BIG AIR ') + S.aT.toFixed(1) + ' s', '+' + pts); } S.aT = 0; }
}
function pop(t, p) { const el = $('style'); const d = document.createElement('div'); d.innerHTML = '<b>' + t + '</b><span>' + p + '</span>'; el.prepend(d); while (el.children.length > 3) el.lastChild.remove(); setTimeout(() => d.classList.add('out'), 1800); setTimeout(() => d.remove(), 2300); Sfx.click(); }
// resolution governor: keep the frame rate up on slow machines
// (runs before the frame is drawn: resizing the canvas clears it, which used to flash black; slow to raise again so it can't oscillate)
const PF = { t: 0, n: 0, calm: 0 };
function perf(dt) {
  PF.t += dt; PF.n++; if (PF.t < 3) return; const ms = PF.t / PF.n * 1000; PF.t = 0; PF.n = 0;
  const R = World.R, pr = R.getPixelRatio(), cap = Math.min(devicePixelRatio || 1, World.gfx === 'high' ? 2 : World.gfx === 'med' ? 1.5 : 1);
  if (ms > 26 && pr > 0.6) { R.setPixelRatio(Math.max(0.6, pr - 0.15)); World.resize(); PF.calm = 0; }
  else if (ms < 12 && pr < cap - 0.05) { if (++PF.calm >= 4) { R.setPixelRatio(Math.min(cap, pr + 0.1)); World.resize(); PF.calm = 0; } }
  else PF.calm = 0;
}
requestAnimationFrame(frame);
// test hooks
window.__PN = { G, World, startStage, Net, look, KEYS, say, showFinish, pauseOpen, pop, ghostSetup, Champ, champStart, CHAMPS, Bots };
if (Q.has('solo')) setTimeout(() => $('bSolo').click(), 100);
