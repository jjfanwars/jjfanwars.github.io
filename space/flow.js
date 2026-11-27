'use strict';
// YeShip flight flow (26 Nov 2026; owner: "fix like all the mission and mode and return/cancel flight all that stuff").
// KSP-style ways out of a flight: Revert to launch (time, stations and ship go back to the moment you left the pad), Revert to builder,
// Recover vessel (landed or splashed on Home), End flight (back to the Space Centre, the ship is lost), Quit to the main menu (the flight is saved).
// They sit in the pause card (Esc) and on the flight report after a landing or a crash. Test-menu jumps stay "test" until a real launch.
// Also: docked flights can be saved and continued, completion toasts queue up, test stations never count. Loaded after inside.js.

let LAUNCH = null; // {t, ves, ship} taken when a real flight leaves the pad
const FLW = {prev: R.st, arm: '', armT: 0};
const canBoss = () => !online() || Net.role === 'host' || NET.own; // in a crew only the host rewinds or ends the crew flight; a guest's own ship is theirs to end
const ownShip = () => online() && NET.own; // own ships never rewind the shared clock
function flowSnap() { LAUNCH = {t: Math.max(0, (R.t0 || G.t) - .5), ves: vesPack(), ship: {parts: cloneParts(SHIP.parts), name: SHIP.name, paint: Object.assign({}, SHIP.paint)}}; }
function flowStep() { const st = R.st; if (FLW.prev === 'pad' && st === 'fly' && R.on && !R.test) flowSnap(); FLW.prev = st; if (FLW.arm && performance.now() > FLW.armT) { FLW.arm = ''; flowPause(); } }
function takeControls() { if (online() && Net.role === 'host' && !isAuth()) { NET.auth = 'H'; Net.send({t: 'auth', id: 'H'}); if (typeof onAuth === 'function') onAuth(); } }
function flowClean() { if (typeof SI !== 'undefined' && SI.on) siLeave(false); if (typeof DK !== 'undefined') { if (DK.V && DK.port && DK.V.mods[DK.port.mi]) DK.V.mods[DK.port.mi].used[DK.port.j] = false; DK.ap = null; DK.V = null; }
  if (typeof NODE !== 'undefined' && NODE) nodeKill(); setWarp(0); R.warpTo = 0; clearDebris(); if (typeof TAA !== 'undefined') TAA.reset = true; }
function flowClose() { setPause(false, true); repHide(); }

function revertLaunch(toBld) { if (!LAUNCH || !canBoss()) return; const L = LAUNCH; takeControls(); flowClean();
  if (!ownShip()) { G.t = L.t; for (const b of BODIES) bodyState(b, G.t); vesUnpack(L.ves); vesSave(); } if (L.ship.parts.every(partOk)) shipApply(L.ship.parts, L.ship.name, L.ship.paint);
  resetRocket(); newFlight(); flightClear(); if (typeof HIST !== 'undefined') HIST.length = 0;
  if (toBld) { onFoot(); P.body = PLANET; spawnPlayer(); flowClose(); setPause(false, false); bldOpen(); showHint(ownShip() ? 'Back in the builder' : 'Reverted: back in the builder (the clock went back too)', 3500); }
  else { onFoot(); board(); toPilot(); flowClose(); showHint(ownShip() ? 'A fresh rocket on the pad. Space to launch' : 'Reverted to launch: on the pad in the Pilot seat. Space to launch', 4000); } }
function recoverOk() { return R.st === 'landed' && R.body === PLANET; }
function recoverVessel() { if (!recoverOk() || !canBoss()) return; takeControls(); const d = R.lp.distanceTo(site.p), t = G.t - (R.t0 || G.t), wet = (() => { const n = R.lp.clone().normalize(); return heightAt(PLANET, n.x, n.y, n.z) < -.5; })();
  flowClean(); onFoot(); resetRocket(); newFlight(); FLOG.recovered = true; P.body = PLANET; spawnPlayer(); flightClear(); LAUNCH = null; flowClose();
  flowToast('Vessel recovered', (wet ? 'Fished out of the sea ' : 'Picked up ') + (d < 2000 ? Math.round(d) + ' m' : fmtD(d)) + ' from the pad · flight time ' + fmtS(t)); }
function endFlight() { if (!canBoss()) return; takeControls(); const lost = R.st === 'fly' || R.st === 'docked' || (R.st === 'landed' && R.body !== PLANET);
  flowClean(); onFoot(); resetRocket(); newFlight(); P.body = PLANET; spawnPlayer(); flightClear(); LAUNCH = null; flowClose(); showHint(lost ? 'Flight ended. Back at the Space Centre' : 'Back at the Space Centre', 3500); }
function toMenu() { flightSave(); if (online()) { Net.close(); if (typeof netBar === 'function') netBar(); } flowClean(); onFoot(); resetRocket(); P.body = PLANET; spawnPlayer(); LAUNCH = null;
  setPause(false, false); G.on = false; if (document.pointerLockElement) document.exitPointerLock(); FLIGHT.hideHud();
  for (const id of ['hud', 'cross', 'fl', 'mis', 'stInfo', 'stTag', 'act', 'hint', 'rep', 'netBar']) { const el = $(id); if (el) el.classList.add('hidden'); }
  menuRefresh(); $('menu').classList.remove('hidden'); }
function backToPad() { if (!canBoss()) return; takeControls(); flowClean(); onFoot(); resetRocket(); board(); toPilot(); newFlight(); flowClose(); showHint('A fresh rocket on the pad', 2500); }
// two clicks for anything that throws a flight away
function armed(key, label, fn) { if (FLW.arm === key) { FLW.arm = ''; fn(); return; } FLW.arm = key; FLW.armT = performance.now() + 3000; flowPause(); }

// ---------------- the Flight section of the pause card
function flowPause() { const el = $('pFlow'); if (!el) return; const inFlight = R.st === 'fly' || R.st === 'docked' || R.st === 'dead' || (R.st === 'landed' && R.on), test = FLOG.test || R.test, b = [];
  const btn = (key, label, sub, fn, cls = '', danger) => b.push({key, label: FLW.arm === key ? 'Click again to confirm' : label, sub: FLW.arm === key ? sub : '', fn: danger ? () => armed(key, label, fn) : fn, cls: cls + (FLW.arm === key ? ' arm' : '')});
  if (!canBoss()) { el.innerHTML = '<div class="tl">Flight</div><div class="fx">Only the host can revert, recover or end the flight.</div><div class="fb"><button id="pfQuit">Leave the crew and quit to the main menu</button></div>'; $('pfQuit').onclick = () => toMenu(); return; }
  if (test) { if (R.st !== 'pad') btn('pad', 'Back to the pad', 'fresh rocket, Pilot seat', backToPad); btn('test', 'Test menu', '', () => { setPause(false, false); testMenu(true); }); }
  else if (inFlight && LAUNCH && ownShip()) { btn('rev', 'Back to the pad', 'a fresh rocket; the crew clock keeps running', () => revertLaunch(false), '', true); btn('revB', 'Back to the builder', '', () => revertLaunch(true), '', true); }
  else if (inFlight && LAUNCH) { btn('rev', 'Revert to launch', 'Time, stations and ship go back to ' + fmtS(G.t - LAUNCH.t) + ' ago', () => revertLaunch(false), '', true); btn('revB', 'Revert to builder', '', () => revertLaunch(true), '', true); }
  if (recoverOk()) btn('rec', 'Recover vessel', '', recoverVessel, 'go');
  else if (R.st !== 'pad' && R.st !== 'dead' && (R.on || R.st === 'landed')) btn('end', 'End flight', R.st === 'landed' ? 'leave the ship where it is' : 'the ship is lost', endFlight, '', true);
  btn('menu', 'Quit to main menu', '', toMenu, '', inFlight && !test && !(R.st === 'landed'));
  const where = test ? 'Test flight: nothing here counts for missions' : R.st === 'pad' ? (R.on ? 'On the pad' : 'At the Space Centre') : R.st === 'dead' ? 'Vehicle lost' : R.st === 'docked' ? 'Docked' + (DK.V ? ' at ' + DK.V.name : '') : R.st === 'landed' ? 'Landed' + (R.body !== PLANET ? ' on ' + R.body.name : '') : 'In flight';
  el.innerHTML = '<div class="tl">Flight<span>' + where + (R.t0 && R.st !== 'pad' ? ' · T+' + fmtS(G.t - R.t0) : '') + '</span></div><div class="fb">' + b.map((x, i) => '<button data-i="' + i + '" class="' + x.cls + '">' + x.label + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</button>').join('') + '</div>';
  el.querySelectorAll('button[data-i]').forEach(e => e.onclick = ev => { ev.stopPropagation(); b[+e.dataset.i].fn(); }); }
{ const pc = document.querySelector('#pause .tcard'), d = document.createElement('div'); d.id = 'pFlow'; pc.querySelector('.pb').after(d); }
{ const sp0 = setPause; setPause = function (on, relock) { sp0(on, relock); if (G.paused) { FLW.arm = ''; flowPause(); } }; window.YE.setPause = setPause; }

// ---------------- flight report: the same choices, as buttons
function flowRep() { const rs0 = repShow; repShow = function (kind) { rs0(kind); const el = $('rep'), f = el.querySelector('.rf'); if (!f || !FLOG.launched) return; const acts = [];
    if (FLOG.test) acts.push(['Back to the pad', backToPad]); else if (LAUNCH && canBoss()) acts.push([ownShip() ? 'Back to the pad' : 'Revert to launch', () => revertLaunch(false)], ['Builder', () => revertLaunch(true)]);
    if (kind !== 'crash' && recoverOk() && canBoss()) acts.unshift(['Recover', recoverVessel]);
    f.innerHTML = (kind === 'crash' ? 'Back to the Space Centre in a moment' : R.body !== PLANET ? 'F: get up · F at the hatch to step out' : 'F: get up') + ' · <span class="key">Esc</span> for all choices';
    if (acts.length) { const row = document.createElement('div'); row.className = 'rb'; acts.forEach(([t, fn]) => { const bt = document.createElement('button'); bt.textContent = t; bt.onclick = e => { e.stopPropagation(); fn(); }; row.appendChild(bt); }); el.appendChild(row); }
    clearTimeout(REP.hideT); REP.hideT = setTimeout(repHide, kind === 'crash' ? 9000 : 14000); }; }

// ---------------- saves: remember the launch snapshot, and save / continue while docked
{ const fs0 = flightSave; flightSave = function () { if (R.st === 'docked' && typeof DK !== 'undefined' && DK.V && DK.port && !DK.ap) { const V = DK.V, port = DK.port; R.st = 'fly'; DK.V = null;
      try { fs0(); } finally { R.st = 'docked'; DK.V = V; } flowPatch(d => { d.dock = {id: V.id, mi: port.mi, j: port.j}; d.where = 'Docked at ' + V.name; }); }
    else fs0(); flowPatch(d => { d.launch = LAUNCH; }); }; }
function flowPatch(f) { try { const d = JSON.parse(localStorage.getItem(SAVE_K) || 'null'); if (!d) return; f(d); localStorage.setItem(SAVE_K, JSON.stringify(d)); } catch (e) {} }
{ const fl0 = flightLoad; flightLoad = function (d) { fl0(d); LAUNCH = d.launch || null; FLW.prev = R.st;
    if (d.dock && typeof VES !== 'undefined') { const V = VES.list.find(v => v.id === d.dock.id), m = V && V.mods[d.dock.mi];
      if (m && modPorts(m.k)[d.dock.j]) { const P_ = new V3(), D_ = new V3(); portWorld(V, m, d.dock.j, P_, D_); DK.V = V; DK.port = {mi: d.dock.mi, j: d.dock.j, P: P_, D: D_}; m.used[d.dock.j] = true; R.st = 'docked'; dockStep(0, G.t); FLW.prev = 'docked'; } } }; }

// ---------------- modes: test jumps stay "test" (on foot too) until a real launch; a fresh real flight forgets test stations
{ const SKY = ['sunrise', 'noon', 'sunset', 'night', 'cloudsMore', 'cloudsLess']; for (const k of Object.keys(TESTS)) { if (SKY.includes(k)) continue; const f = TESTS[k]; TESTS[k] = function (...a) { const r = f.apply(this, a); FLOG.test = true; LAUNCH = null; return r; }; } }
{ const nf0 = newFlight; newFlight = function () { nf0(); if (!R.test && typeof VES !== 'undefined' && VES.list.some(V => V.test)) { for (let i = VES.list.length - 1; i >= 0; i--) { const V = VES.list[i]; if (!V.test) continue; if (V.g) scene.remove(V.g); if (VES.tgt === V) VES.tgt = null; VES.list.splice(i, 1); } } }; }
// main menu: with a saved flight, Continue is the big button and Play says what it does
function menuRefresh() { const d = flightSaved(), cb = $('cont'), pl = $('play');
  if (d && Date.now() - d.at < 14 * 864e5) { const ago = (Date.now() - d.at) / 6e4; cb.classList.remove('hidden'); cb.innerHTML = '<b>Continue flight</b><small>' + d.where + ' · ' + (ago < 60 ? Math.max(1, Math.round(ago)) + ' min ago' : ago < 1440 ? Math.round(ago / 60) + ' h ago' : Math.round(ago / 1440) + ' days ago') + '</small>';
    cb.onclick = () => { $('play').click(); flightLoad(flightSaved() || d); }; cb.classList.add('main'); pl.textContent = 'Play from the Space Centre'; pl.title = 'Your saved flight stays until you launch again'; }
  else { cb.classList.add('hidden'); cb.classList.remove('main'); pl.textContent = 'Play'; } }
{ const b0 = boot; boot = function () { b0(); flowRep(); menuRefresh(); }; } // repShow comes from polish.js, which loads after this file

// ---------------- completion toasts queue up (two missions at once both get their moment)
const TQ = [];
function flowToast(head, sub) { TQ.push([head, sub]); if (TQ.length === 1) toastNext(); }
function toastShow(it) { const t = $('toast'); t.innerHTML = '<b><span class="ico i-ok"></span> ' + it[0] + '</b>' + (it[1] ? '<span>' + it[1] + '</span>' : ''); t.classList.add('on'); }
function toastNext() { const t = $('toast'), it = TQ[0]; if (!it) return; toastShow(it); const t0 = performance.now();
  clearInterval(toastNext.t); toastNext.t = setInterval(() => { if (performance.now() - t0 < (TQ.length > 1 ? 3000 : 5000)) return; clearInterval(toastNext.t); t.classList.remove('on'); setTimeout(() => { TQ.shift(); toastNext(); }, 350); }, 200); } // the next one shortens the wait
{ const mc0 = misComplete; misComplete = function (m) { const was = MIS.cur === m.id; mc0(m); clearTimeout(misComplete.t); const nx = MISD.find(x => x.id === MIS.cur && !MIS.done[x.id]); flowToast(m.name + ' complete', was && nx ? 'Next: ' + nx.name : m.bonus ? 'Bonus mission' : ''); if (TQ.length > 1) toastShow(TQ[0]); }; } // the old code wrote straight into the toast

{ const s0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { s0(dt); flowStep(); }; }
{ const st = document.createElement('style'); st.textContent = `
#pFlow .tl { display:flex; justify-content:space-between; align-items:baseline; } #pFlow .tl span { font-weight:500; letter-spacing:0; text-transform:none; color:var(--ink2); font-size:12px; }
#pFlow .fb { display:flex; flex-wrap:wrap; padding:0 22px; } #pFlow .fb button { flex:1 1 30%; display:flex; flex-direction:column; align-items:flex-start; gap:2px; margin:0 -1px -1px 0; text-align:left; min-height:44px; }
#pFlow .fb button small { font-weight:500; color:var(--ink2); font-size:11px; } #pFlow .fb button.go { background:var(--ink); color:var(--plate); border-color:var(--ink); }
#pFlow .fb button.arm { background:var(--red); color:#fff; border-color:var(--red); } #pFlow .fb button.arm small { color:#fff; } #pFlow .fx { padding:0 22px 8px; color:var(--ink2); font-size:13px; }
#rep .rb { display:flex; border-top:1px solid var(--rule); } #rep .rb button { flex:1; border:0; border-right:1px solid var(--rule); padding:10px 8px; } #rep .rb button:last-child { border-right:0; } #rep .rb button:hover { background:var(--ink); color:var(--plate); }
.card .more button#cont.main { order:-1; background:var(--red); color:#fff; border-color:var(--red); display:flex; flex-direction:column; gap:2px; padding:12px 14px; } .card .more button#cont.main small { font-weight:500; opacity:.85; }
#mis .md { display:block; padding:6px 12px 0; color:var(--ink2); font-size:12px; } #mis .md.test { color:var(--redt); font-weight:600; } #mis .mt em { font-style:normal; font-size:10px; border:1px solid var(--rule); padding:0 4px; margin-left:4px; color:var(--ink2); } #mis.mini .md { display:none; }`; document.head.appendChild(st); }
Object.assign(window.YE, {revertLaunch, recoverVessel, endFlight, toMenu, backToPad, flowPause, menuRefresh, flowToast}); Object.defineProperty(window.YE, 'LAUNCH', {get: () => LAUNCH});
