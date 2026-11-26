// UNDERGROWTH: integrator.
// Owns the renderer, scene, camera, input, game state, mission flow and the frame loop.
// Every sibling module is loaded dynamically and created inside its own try/catch so a
// missing or broken file degrades the game instead of blanking it.

import * as THREE from 'three';
import { WORLD, events, clamp, rand } from './util.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FOV = 72;
const NEAR = 0.05;
const FAR = 600;
const MAX_PIXEL_RATIO = 1.5;      // Low/High cap (Ultra allows 2, see QUALITY)
const DT_MAX = 0.05;
const STEP_DT = 1 / 60;

const MODULES = [
  // name      file             factory          share of the loading bar
  ['audio', './audio.js', 'createAudio', 0.04],
  ['world', './world.js', 'createWorld', 0.52],
  ['tunnels', './tunnels.js', 'createTunnels', 0.1],
  ['player', './player.js', 'createPlayer', 0.04],
  ['weapons', './weapons.js', 'createWeapons', 0.08],
  ['enemies', './enemies.js', 'createEnemies', 0.08],
  ['hud', './hud.js', 'createHud', 0.04],
];
const UPDATE_ORDER = ['world', 'tunnels', 'player', 'weapons', 'enemies', 'hud', 'audio'];
const LOAD_LABELS = {
  audio: 'Sound', world: 'Jungle', tunnels: 'Tunnels', player: 'Guerrilla',
  weapons: 'Arms', enemies: 'Patrols', hud: 'Interface',
};

const OBJECTIVES = [
  { id: 'tunnel', text: 'Extend the tunnel toward the firebase' },
  { id: 'dump', text: 'Destroy the ammo dump' },
  { id: 'return', text: 'Return to the tunnels' },
];
const TUNNEL_REACH = 60;          // a dug cell this close to the firebase centre completes stage 0
const OBJECTIVE_GAP = 1.7;        // seconds between "done" tick and the next objective line
const RETURN_HOLD = 1.0;          // seconds underground (after the line shows) before the win
const WIN_END_DELAY = 2.2;        // gameOver(won) -> end screen
const LOSE_END_DELAY = 0.9;       // gameOver(lost) -> end screen (player already played its death)
const DEATH_FALLBACK = 7.0;       // playerDied without a gameOver -> end anyway

// Keys the browser should never act on while playing (scrolling, find-as-you-type, etc).
const PASSTHROUGH = new Set(['F5', 'F11', 'F12']);

// ---------------------------------------------------------------------------
// DOM + loading overlay
// ---------------------------------------------------------------------------

const doc = document;
const loadingEl = doc.getElementById('loading');
const loadingFill = loadingEl?.querySelector('.ld-fill');
const loadingLabel = loadingEl?.querySelector('.ld-label');
const loadingBtn = loadingEl?.querySelector('.ld-btn');

function setLoading(p, label) {
  if (!loadingEl) return;
  if (Number.isFinite(p)) loadingEl.style.setProperty('--p', clamp(p, 0, 1).toFixed(3));
  if (label != null && loadingLabel) loadingLabel.textContent = label;
}
function loadingError(text) {
  if (!loadingEl) return;
  loadingEl.classList.remove('done', 'ld-action');
  loadingEl.classList.add('ld-error');
  if (loadingLabel) loadingLabel.textContent = text;
}
function hideLoading() {
  if (!loadingEl) return;
  loadingEl.classList.remove('ld-action', 'ld-error');
  loadingEl.classList.add('done');
}
// Used only when hud.js failed to load: the loading card turns into a minimal screen.
function fallbackScreen(label, buttonText, onClick) {
  if (!loadingEl) return;
  loadingEl.classList.remove('done', 'ld-error');
  loadingEl.classList.add('ld-action');
  if (loadingLabel) loadingLabel.textContent = label || '';
  if (loadingBtn) {
    loadingBtn.textContent = buttonText;
    loadingBtn.onclick = (e) => { e.preventDefault(); onClick(); };
    setTimeout(() => { try { loadingBtn.focus({ preventScroll: true }); } catch (err) { /* */ } }, 50);
  }
}

function nextFrame() {
  // rAF does not fire in hidden tabs; the timeout keeps loading moving there.
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(fin);
    setTimeout(fin, 60);
  });
}

// ---------------------------------------------------------------------------
// Debug params: ?debug=1&pos=x,z&underground=1&seed=…  (also read from the #hash)
// ---------------------------------------------------------------------------

function parseDebug() {
  const params = new Map();
  try {
    for (const [k, v] of new URLSearchParams(location.search)) params.set(k, v);
    const h = (location.hash || '').replace(/^#/, '');
    if (h.includes('=')) for (const [k, v] of new URLSearchParams(h)) params.set(k, v);
  } catch (e) { /* ignore malformed URLs */ }
  if (!params.has('debug')) return null;
  const v = String(params.get('debug')).toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return null;
  const d = { enabled: true };
  for (const [k, val] of params) d[k] = val;
  d.debug = v === '' ? '1' : v;
  return d;
}
function truthy(v) {
  if (v === true) return true;
  if (v == null || v === false) return false;
  const s = String(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}
function hashSeed(s) {
  const str = String(s);
  if (/^-?\d+$/.test(str)) return (parseInt(str, 10) >>> 0) || 1;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

const debug = parseDebug();
const manualStep = !!debug && (truthy(debug.manual) || truthy(debug.step));
if (debug && debug.seed != null && debug.seed !== '') {
  // Deterministic runs for automation: every module's Math.random becomes the seeded PRNG.
  Math.random = rand(hashSeed(debug.seed));
}

// ---------------------------------------------------------------------------
// Settings (per-viewer convenience only)
// ---------------------------------------------------------------------------

const settings = { sensitivity: 1 };
try {
  const raw = localStorage.getItem('undergrowth.settings');
  if (raw) {
    const s = JSON.parse(raw);
    if (s && Number.isFinite(s.sensitivity)) settings.sensitivity = clamp(s.sensitivity, 0.1, 5);
  }
} catch (e) { /* storage unavailable */ }
if (debug && Number.isFinite(parseFloat(debug.sens))) settings.sensitivity = clamp(parseFloat(debug.sens), 0.1, 5);

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------

let canvas = doc.getElementById('game');
if (!canvas) {
  canvas = doc.createElement('canvas');
  canvas.id = 'game';
  doc.body.prepend(canvas);
}

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: !!debug, // lets automation read pixels back
  });
} catch (e) {
  console.error('[main] WebGL renderer could not be created', e);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, Math.max(1, innerWidth) / Math.max(1, innerHeight), NEAR, FAR);
camera.name = 'playerCamera';
camera.position.set(WORLD.playerStart.x, 2, WORLD.playerStart.z);
scene.add(camera);

if (renderer) {
  renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0a0c09, 1);
}

// Debug render accounting. three r170 resets renderer.info *after* the shadow pass inside
// render(), so the stock numbers miss every shadow draw. In debug the reset is done by hand
// just before the main render, and the shadow pass is bracketed to report it separately.
const frameInfo = {
  calls: 0, triangles: 0, points: 0, lines: 0,
  shadowCalls: 0, shadowTriangles: 0, shadowPasses: 0,
};
let shadowCallsAcc = 0, shadowTrisAcc = 0, shadowPassesAcc = 0;
if (debug && renderer) {
  renderer.info.autoReset = false;
  const sm = renderer.shadowMap;
  const shadowRender = typeof sm.render === 'function' ? sm.render : null;
  if (shadowRender) {
    sm.render = function (lights, sc, cam) {
      const r = renderer.info.render;
      const c0 = r.calls, t0 = r.triangles;
      const ran = sm.enabled && (sm.autoUpdate || sm.needsUpdate) && !!lights && lights.length > 0;
      shadowRender.call(this, lights, sc, cam);
      if (ran) shadowPassesAcc++;
      shadowCallsAcc += r.calls - c0;
      shadowTrisAcc += r.triangles - t0;
    };
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const input = {
  keys: new Set(),       // KeyboardEvent.code currently held
  pressed: new Set(),    // went down this frame (also 'Mouse0', 'Mouse1', 'Mouse2')
  released: new Set(),   // went up this frame
  mouse: { dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 },
  locked: false,         // true while the game owns the mouse (pointer lock, or the no-lock fallback)
};

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const stats = { kills: 0, headshots: 0, cellsDug: 0, shots: 0, time: 0 };

const ctx = {
  THREE, scene, camera, renderer, events, input,
  quality: 'high', setQuality: null,
  world: null, tunnels: null, player: null, weapons: null, enemies: null, audio: null, hud: null,
  time: 0, debug, settings, stats,
  state: 'loading',
  baseFov: FOV,
  alertLevel: 0,
  errors: {},
  mission: null,
  onDeploy: null, onResume: null, onRestart: null,
};

if (debug) window.__game = ctx;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let state = 'loading';
function setState(s) {
  if (s === state) return;
  const prev = state;
  state = s;
  ctx.state = s;
  doc.body.dataset.state = s;
  updateCaptureClass();
  events.emit('gameState', { state: s, prev });
}
const isSimState = (s) => s === 'playing' || s === 'dead' || s === 'won';

// ---------------------------------------------------------------------------
// Pointer lock (with a no-lock fallback for sandboxed frames)
// ---------------------------------------------------------------------------

let pointerLocked = false;
let lockEverWorked = false;
let fallbackCapture = false;   // pointer lock unavailable: capture the mouse without it
let fallbackActive = false;    // fallback capture currently engaged (false while paused)
let skipMoves = 0;
let lastLockRequest = -1e9;
let lockRetries = 0;
// Promise-based requestPointerLock reports its own failures, so 'pointerlockerror' events are
// only authoritative on browsers whose request returns nothing. Chrome on Linux rejects the
// unadjustedMovement option with NotSupportedError *and* fires pointerlockerror for it; that
// event belongs to the options attempt, not to a real refusal.
let lockViaPromise = false;
let unadjustedUnsupported = false;

function updateCaptureClass() {
  const on = state === 'playing' && input.locked;
  doc.body.classList.toggle('ug-capture', on);
}
function syncLocked() {
  input.locked = pointerLocked || (fallbackCapture && fallbackActive);
  updateCaptureClass();
}

function enableFallback(err) {
  if (pointerLocked) return;
  if (!fallbackCapture) {
    const why = err && err.name ? ' (' + err.name + ')' : '';
    console.warn('[main] pointer lock unavailable' + why + ', capturing the mouse without it');
  }
  fallbackCapture = true;
  if (state === 'playing' || state === 'paused') {
    fallbackActive = true;
    if (state === 'paused') { try { ctx.hud?.hidePause?.(); } catch (e) { /* */ } setState('playing'); }
    syncLocked();
  }
}

function onLockFailed(err) {
  if (pointerLocked) return;
  // Before the lock has ever worked a failure means the frame or browser forbids it.
  // After it has worked, failures are just the browser's re-lock cooldown: stay paused.
  if (!lockEverWorked && (state === 'playing' || state === 'paused')) enableFallback(err);
}

function requestLock() {
  if (!canvas || pointerLocked) return;
  if (typeof canvas.requestPointerLock !== 'function') { enableFallback(); return; }
  if (fallbackCapture) {
    // keep capturing without lock, but let a later click upgrade to a real lock
    enableFallback();
    if (lockRetries >= 3) return;
    lockRetries++;
  }
  const now = performance.now();
  if (now - lastLockRequest < 150) return;
  lastLockRequest = now;
  const plain = () => {
    let p2;
    try {
      p2 = canvas.requestPointerLock();
    } catch (e) { lockViaPromise = false; onLockFailed(e); return; }
    lockViaPromise = !!(p2 && typeof p2.then === 'function');
    if (lockViaPromise) p2.then(null, onLockFailed);
  };
  if (unadjustedUnsupported) { plain(); return; }
  let p;
  try {
    p = canvas.requestPointerLock({ unadjustedMovement: true });
  } catch (e) {
    unadjustedUnsupported = true; // old signature that throws on the options bag
    plain();
    return;
  }
  lockViaPromise = !!(p && typeof p.then === 'function');
  if (!lockViaPromise) return; // legacy: pointerlockchange / pointerlockerror decide
  p.then(null, (err) => {
    const name = err && err.name;
    if (name === 'NotSupportedError' || name === 'TypeError') {
      // the option, not the lock, was refused: remember it and ask plainly
      unadjustedUnsupported = true;
      plain();
    } else {
      onLockFailed(err);
    }
  });
}

doc.addEventListener('pointerlockchange', () => {
  pointerLocked = doc.pointerLockElement === canvas;
  if (pointerLocked) {
    lockEverWorked = true;
    fallbackCapture = false;
    fallbackActive = false;
    skipMoves = 1; // first event after locking often carries a jump
    syncLocked();
    if (state === 'paused') setState('playing');
  } else {
    syncLocked();
    if (state === 'playing' && !debug) pauseGame(false);
  }
});
doc.addEventListener('pointerlockerror', () => {
  if (lockViaPromise) return; // the request's promise settles the outcome
  onLockFailed();
});

function pauseGame(showPanel) {
  if (state !== 'playing') return;
  fallbackActive = false;
  syncLocked();
  clearInput();
  setState('paused');
  // With a real pointer lock the HUD opens its pause panel itself; the fallback has no lock event.
  if (showPanel) { try { ctx.hud?.showPause?.(); } catch (e) { /* */ } }
  renderDirty = true;
}

function clearInput() {
  input.keys.clear();
  input.pressed.clear();
  input.released.clear();
  const m = input.mouse;
  m.dx = 0; m.dy = 0; m.wheel = 0;
  m.left = false; m.right = false; m.middle = false;
  held.left.key = held.left.mouse = held.right.key = held.right.mouse = false;
  wheelAcc = 0;
}

// --- keyboard ---------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const code = e.code || e.key;
  if (!code) return;
  if (state === 'playing') {
    if (code === 'Escape' && fallbackCapture && fallbackActive) {
      e.preventDefault();
      pauseGame(true);
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !PASSTHROUGH.has(code)) e.preventDefault();
    if (e.ctrlKey || e.metaKey) return; // browser shortcuts are not game input
    if (!e.repeat || !input.keys.has(code)) {
      if (!input.keys.has(code)) input.pressed.add(code);
      input.keys.add(code);
    }
    keyButton(code, true);
  }
}, { capture: true });

// Space fires and Q aims, alongside the mouse buttons (touchpad friendly).
const KEY_BUTTONS = { Space: ['left', 'Mouse0'], KeyQ: ['right', 'Mouse2'] };
const held = { left: { key: false, mouse: false }, right: { key: false, mouse: false } };
function setButton(btn, src, down) {
  const m = input.mouse, h = held[btn], name = btn === 'left' ? 'Mouse0' : 'Mouse2';
  const was = h.key || h.mouse;
  h[src] = down;
  const now = h.key || h.mouse;
  if (now && !was) input.pressed.add(name);
  if (!now && was) input.released.add(name);
  m[btn] = now;
}
function keyButton(code, down) {
  const kb = KEY_BUTTONS[code];
  if (kb) setButton(kb[0], 'key', down);
}

window.addEventListener('keyup', (e) => {
  const code = e.code || e.key;
  if (!code) return;
  if (input.keys.delete(code)) input.released.add(code);
  keyButton(code, false);
  if (state === 'playing' && !e.ctrlKey && !e.metaKey && !PASSTHROUGH.has(code)) e.preventDefault();
}, { capture: true });

// --- mouse -------------------------------------------------------------------

const MOVE_SPIKE = 900;
doc.addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  const free = !!debug && !input.locked && e.buttons !== 0; // debug: drag to look without lock
  if (!input.locked && !free) return;
  if (skipMoves > 0) { skipMoves--; return; }
  const mx = e.movementX || 0, my = e.movementY || 0;
  if (Math.abs(mx) > MOVE_SPIKE || Math.abs(my) > MOVE_SPIKE) return; // browser lock jitter
  input.mouse.dx += mx;
  input.mouse.dy += my;
});

function isUiTarget(t) {
  return !!(t && t.closest && t.closest('button, a, input, select, textarea, [role="button"], #loading'));
}

doc.addEventListener('mousedown', (e) => {
  if (state === 'paused') {
    // a click on the bare canvas resumes; the HUD's own buttons handle themselves
    if (e.target === canvas) { e.preventDefault(); resumeGame(); }
    return;
  }
  if (state !== 'playing') return;
  if (isUiTarget(e.target)) return;
  if (fallbackCapture && fallbackActive && !pointerLocked) requestLock();
  if (!input.locked) {
    requestLock();
    if (!debug) { e.preventDefault(); return; } // the click that captures the mouse is not a shot
  }
  e.preventDefault();
  const m = input.mouse;
  if (e.button === 0) setButton('left', 'mouse', true);
  else if (e.button === 2) setButton('right', 'mouse', true);
  else if (e.button === 1) { if (!m.middle) input.pressed.add('Mouse1'); m.middle = true; }
});

doc.addEventListener('mouseup', (e) => {
  const m = input.mouse;
  if (e.button === 0) setButton('left', 'mouse', false);
  else if (e.button === 2) setButton('right', 'mouse', false);
  else if (e.button === 1 && m.middle) { m.middle = false; input.released.add('Mouse1'); }
});

doc.addEventListener('contextmenu', (e) => { if (state !== 'menu' || e.target === canvas) e.preventDefault(); });

// Wheel: one step per notch, trackpads accumulate into steps instead of flooding.
let wheelAcc = 0, wheelLast = 0;
window.addEventListener('wheel', (e) => {
  if (state !== 'playing') return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelLast > 250) wheelAcc = 0;
  wheelLast = now;
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  wheelAcc += e.deltaY * scale;
  const STEP = 40;
  while (wheelAcc >= STEP) { input.mouse.wheel += 1; wheelAcc -= STEP * 2.5; }
  while (wheelAcc <= -STEP) { input.mouse.wheel -= 1; wheelAcc += STEP * 2.5; }
}, { passive: false });

window.addEventListener('blur', () => {
  clearInput();
  if (state === 'playing' && fallbackCapture && fallbackActive && !debug) pauseGame(true);
});
doc.addEventListener('visibilitychange', () => {
  if (doc.hidden) {
    clearInput();
    if (state === 'playing' && fallbackCapture && fallbackActive && !debug) pauseGame(true);
  }
});

// ---------------------------------------------------------------------------
// Resize + context loss
// ---------------------------------------------------------------------------

let renderDirty = true;
let contextLost = false;

function onResize() {
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  if (renderer) {
    const cap = QUALITY[quality]?.pixelRatio ?? MAX_PIXEL_RATIO;
    renderer.setPixelRatio(Math.min(cap, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post?.resize();
  renderDirty = true;
  events.emit('resize', { width: w, height: h });
}
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener?.('resize', onResize);

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  console.warn('[main] WebGL context lost');
  loadingError('Graphics context lost');
});
canvas.addEventListener('webglcontextrestored', () => { location.reload(); });

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const dugSeen = new Set();
let ended = false;

events.on('enemyKilled', (d) => {
  if (ended) return;
  if (d && (d.by === 'enemy' || d.byPlayer === false)) return;
  stats.kills++;
  if (d?.headshot) stats.headshots++;
});
events.on('tunnelDug', (d) => {
  if (ended) return;
  if (d && Number.isFinite(d.cellX) && Number.isFinite(d.cellZ)) {
    const key = d.cellX + ',' + d.cellZ;
    if (!dugSeen.has(key)) { dugSeen.add(key); stats.cellsDug++; }
    noteDugPoint((d.cellX + 0.5) * WORLD.cell, (d.cellZ + 0.5) * WORLD.cell);
  } else {
    stats.cellsDug++;
  }
  const p = d?.pos || d?.point;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) noteDugPoint(p.x, p.z);
  tunnelScanDirty = true;
});
events.on('hatchCreated', (d) => {
  if (d && Number.isFinite(d.x) && Number.isFinite(d.z)) noteDugPoint(d.x, d.z);
});
events.on('shot', (d) => { if (d?.by === 'player') stats.shots++; });
events.on('alert', (d) => { if (d && Number.isFinite(d.level)) ctx.alertLevel = d.level | 0; });

// ---------------------------------------------------------------------------
// Mission: tunnel -> dump -> return -> win
// ---------------------------------------------------------------------------

const mission = {
  stage: -1,           // index into OBJECTIVES of the active objective (3 = complete)
  shown: -1,           // objective index currently on the HUD line
  showAt: -1,          // sim time to show `stage` after a completion tick
  shownSince: 0,       // sim time the current line appeared
  dumpDestroyed: false,
  nearestDug: Infinity, // closest dug point to the firebase so far (m)
  undergroundFor: 0,
  started: false,
  objectives: OBJECTIVES,
  get current() { return this.stage >= 0 && this.stage < OBJECTIVES.length ? OBJECTIVES[this.stage] : null; },
};
ctx.mission = mission;

let tunnelScanDirty = true;
let tunnelScanT = 0;
let tunnelScanVersion = -1;

function distToFirebase(x, z) {
  const dx = x - WORLD.firebase.x, dz = z - WORLD.firebase.z;
  return Math.sqrt(dx * dx + dz * dz);
}
function noteDugPoint(x, z) {
  const d = distToFirebase(x, z);
  if (d < mission.nearestDug) mission.nearestDug = d;
}
function emitObjective(i, done) {
  const o = OBJECTIVES[i];
  if (!o) return;
  events.emit('objective', { id: o.id, text: o.text, done: !!done, index: i, total: OBJECTIVES.length });
}

function startMission() {
  if (mission.started) return;
  mission.started = true;
  mission.stage = 0;
  mission.shown = 0;
  mission.showAt = -1;
  mission.shownSince = ctx.time;
  emitObjective(0, false);
  tunnelScanDirty = true;
}

// Advance the active objective to `target`, ticking off the line that is showing.
function advanceTo(target) {
  if (target <= mission.stage) return;
  if (mission.shown >= 0 && mission.shown < target) emitObjective(mission.shown, true);
  mission.stage = target;
  if (target >= OBJECTIVES.length) { mission.showAt = -1; return; }
  mission.showAt = ctx.time + OBJECTIVE_GAP;
  mission.undergroundFor = 0;
}

events.on('dumpDestroyed', () => {
  if (mission.dumpDestroyed) return;
  mission.dumpDestroyed = true;
  if (!mission.started || ended) return;
  if (mission.stage < 2) advanceTo(2);
});

// Pull points out of whatever tunnel representation tunnels.js exposes (grid v1 or graph v2).
function pointXZ(o) {
  if (!o) return null;
  if (Number.isFinite(o.x) && Number.isFinite(o.z)) return o;
  return null;
}
function scanTunnels() {
  const t = ctx.tunnels;
  if (!t) return;
  const ver = Number.isFinite(t.version) ? t.version : -1;
  if (!tunnelScanDirty && ver !== -1 && ver === tunnelScanVersion) return;
  tunnelScanDirty = false;
  tunnelScanVersion = ver;
  try {
    const segs = t.segments;
    if (segs && typeof segs[Symbol.iterator] === 'function') {
      for (const s of segs) {
        const a = pointXZ(s?.end) || pointXZ(s?.b) || pointXZ(s?.to) || pointXZ(s?.p1);
        const b = pointXZ(s?.start) || pointXZ(s?.a) || pointXZ(s?.from) || pointXZ(s?.p0);
        if (a) noteDugPoint(a.x, a.z);
        if (b) noteDugPoint(b.x, b.z);
      }
    }
    const chambers = t.chambers;
    if (chambers && typeof chambers[Symbol.iterator] === 'function') {
      for (const c of chambers) {
        const p = pointXZ(c?.center) || pointXZ(c?.pos) || pointXZ(c?.position) || pointXZ(c);
        if (p) noteDugPoint(p.x, p.z);
      }
    }
    const cells = typeof t.dugCells === 'function' ? t.dugCells() : null;
    if (cells && typeof cells[Symbol.iterator] === 'function') {
      const C = Number.isFinite(t.cellSize) ? t.cellSize : WORLD.cell;
      for (const c of cells) {
        if (c && Number.isFinite(c.cx) && Number.isFinite(c.cz)) noteDugPoint((c.cx + 0.5) * C, (c.cz + 0.5) * C);
      }
    }
  } catch (e) {
    reportError('mission', e);
  }
}

function updateMission(dt) {
  if (!mission.started || ended) return;
  const p = ctx.player;
  const alive = !p || p.alive !== false;
  if (!alive) return;

  // show the next objective line after the completion tick has been on screen a moment
  if (mission.showAt >= 0 && ctx.time >= mission.showAt) {
    mission.showAt = -1;
    mission.shown = mission.stage;
    mission.shownSince = ctx.time;
    emitObjective(mission.stage, false);
  }

  if (mission.stage === 0) {
    tunnelScanT -= dt;
    if (tunnelScanT <= 0) { tunnelScanT = 1.0; scanTunnels(); }
    if (p?.underground && p.position) noteDugPoint(p.position.x, p.position.z);
    if (mission.nearestDug <= TUNNEL_REACH) advanceTo(1);
  } else if (mission.stage === 2 && mission.shown === 2) {
    let back;
    if (ctx.tunnels) back = !!p?.underground;
    else back = !!p?.position && distToFirebase(p.position.x, p.position.z) > WORLD.firebase.radius + 60;
    mission.undergroundFor = back ? mission.undergroundFor + dt : 0;
    if (mission.undergroundFor >= RETURN_HOLD) {
      advanceTo(3);
      events.emit('gameOver', { won: true, reason: 'The firebase burns. You are gone into the earth.' });
    }
  }
}

// ---------------------------------------------------------------------------
// End of run
// ---------------------------------------------------------------------------

let endAt = -1, endWon = false, endReason = '', endShown = false;
let deathAt = -1;

events.on('playerDied', () => {
  if (ended) return;
  deathAt = ctx.time;
  if (state === 'playing' || state === 'paused') setState('dead');
  clearInput();
});
events.on('gameOver', (d) => {
  if (ended) return;
  ended = true;
  endWon = !!d?.won;
  let reason = d?.reason ? String(d.reason) : '';
  if (/^killed in action$/i.test(reason) || /^mission complete$/i.test(reason)) reason = '';
  endReason = reason;
  endAt = ctx.time + (endWon ? WIN_END_DELAY : LOSE_END_DELAY);
  setState(endWon ? 'won' : 'dead');
  clearInput();
});

function updateEnd() {
  if (!ended && deathAt >= 0 && ctx.time - deathAt > DEATH_FALLBACK) {
    events.emit('gameOver', { won: false, reason: '' });
  }
  if (!ended || endShown || ctx.time < endAt) return;
  endShown = true;
  fallbackActive = false;
  syncLocked();
  try { if (doc.pointerLockElement) doc.exitPointerLock?.(); } catch (e) { /* */ }
  const hud = ctx.hud;
  if (hud && typeof hud.showEnd === 'function') {
    try { hud.showEnd(endWon, endReason); return; } catch (e) { reportError('hud', e); }
  }
  fallbackScreen(endWon ? 'Mission complete' : 'Killed in action', 'Again', () => ctx.onRestart());
}

// ---------------------------------------------------------------------------
// Callbacks used by hud.js
// ---------------------------------------------------------------------------

function deploy() {
  if (state !== 'menu') return;
  try { ctx.audio?.unlock?.(); } catch (e) { reportError('audio', e); }
  try { ctx.hud?.hideMenu?.(); } catch (e) { reportError('hud', e); }
  hideLoading();
  clearInput();
  setState('playing');
  if (fallbackCapture) enableFallback(); else requestLock();
  startMission();
}
function resumeGame() {
  if (state !== 'paused') return;
  try { ctx.audio?.unlock?.(); } catch (e) { /* */ }
  if (fallbackCapture || typeof canvas.requestPointerLock !== 'function') {
    try { ctx.hud?.hidePause?.(); } catch (e) { /* */ }
    setState('playing');
    fallbackCapture = true;
    fallbackActive = true;
    syncLocked();
    requestLock(); // quiet upgrade attempt; capture already works without it
    return;
  }
  requestLock(); // state flips to playing on pointerlockchange
}
ctx.onDeploy = deploy;
ctx.onResume = resumeGame;
ctx.onRestart = () => {
  try { if (doc.pointerLockElement) doc.exitPointerLock?.(); } catch (e) { /* */ }
  location.reload();
};

// ---------------------------------------------------------------------------
// Error isolation
// ---------------------------------------------------------------------------

const errorCounts = Object.create(null);
function reportError(name, e) {
  const n = (errorCounts[name] = (errorCounts[name] || 0) + 1);
  ctx.errors[name] = String(e?.message || e);
  if (n <= 3) console.error(`[main] ${name} failed:`, e);
  else if (n === 4) console.error(`[main] ${name} keeps failing; further errors suppressed`);
}

// ---------------------------------------------------------------------------
// Fallback world: keeps the game playable if world.js is missing or throws.
// ---------------------------------------------------------------------------

function createFallbackWorld() {
  const group = new THREE.Group();
  group.name = 'fallbackWorld';
  scene.add(group);
  scene.background = new THREE.Color(0x56664c);
  scene.fog = new THREE.FogExp2(0x56664c, 0.012);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 1 }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  const hemi = new THREE.HemisphereLight(0xc9d6b0, 0x2a2416, 1.1);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.2);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 250;
  group.add(sun, sun.target);

  const fbC = new THREE.Vector3(WORLD.firebase.x, 0, WORLD.firebase.z);
  const dump = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 2), new THREE.MeshStandardMaterial({ color: 0x4b4a2c, roughness: 0.9 }));
  dump.position.set(WORLD.ammoDump.x, 0.8, WORLD.ammoDump.z);
  dump.castShadow = true;
  group.add(dump);

  const up = new THREE.Vector3(0, 1, 0);
  return {
    heightAt: () => 0,
    normalAt: () => up,
    waterLevel: -100,
    isWater: () => false,
    colliders: [],
    boxColliders: [],
    coverAt: () => 0,
    raycastMeshes: [ground, dump],
    sun, hemi,
    update() {
      const p = ctx.player?.position;
      if (p) { sun.target.position.set(p.x, 0, p.z); sun.position.set(p.x + 60, 90, p.z + 40); }
    },
    setUnderground(u) { hemi.intensity = u ? 0.08 : 1.1; sun.intensity = u ? 0 : 2.2; },
    firebase: { dumpMesh: dump, center: fbC },
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Graphics quality + post-processing
//   Low:   direct render (MSAA canvas, ACES), half the ground cover, small shadow map
//   High:  EffectComposer: HDR MSAA scene -> depth AO + canopy light shafts (side passes)
//          -> bloom -> grade pass (AO, height fog, shafts, exposure, ACES, colour grade,
//          vignette, grain, sRGB)
//   Ultra: High with more AO samples, a sharper pixel ratio and denser foliage
// ---------------------------------------------------------------------------

const QUALITY = {
  low: { post: false, pixelRatio: 1, aoSamples: 0, bloom: false },
  high: { post: true, pixelRatio: 1.5, aoSamples: 10, aoScale: 0.5, bloom: true },
  ultra: { post: true, pixelRatio: 2, aoSamples: 16, aoScale: 0.75, bloom: true },
};
const QUALITY_NAMES = ['low', 'high', 'ultra'];
const QUALITY_LABEL = { low: 'Low', high: 'High', ultra: 'Ultra' };

function readQuality() {
  if (debug && QUALITY[String(debug.gfx || '').toLowerCase()]) return String(debug.gfx).toLowerCase();
  try {
    const q = localStorage.getItem('undergrowth.quality');
    if (q && QUALITY[q]) return q;
  } catch (e) { /* storage unavailable */ }
  return 'high';
}
function saveQuality(q) {
  try { localStorage.setItem('undergrowth.quality', q); } catch (e) { /* storage unavailable */ }
}

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const VIEWPOS_GLSL = /* glsl */`
uniform mat4 uInvProj;
vec3 viewPosAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * c;
  return v.xyz / v.w;
}
`;

// Scalable ambient occlusion from the depth buffer alone (no extra scene pass, so alpha-tested
// leaves occlude exactly as they are drawn). Normals come from depth derivatives.
const AO_FRAG = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uTexel;          // depth texel size
uniform float uProjY;         // projection[1][1]
uniform float uRadius;        // metres
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
${VIEWPOS_GLSL}
#ifndef AO_SAMPLES
#define AO_SAMPLES 10
#endif
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPosAt(vUv, d);
  // the first-person viewmodel is drawn with squashed depth: never occlude it
  if (-P.z < 0.45) { gl_FragColor = vec4(1.0, -P.z, 0.0, 1.0); return; }
  vec3 Pr = viewPosAt(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x);
  vec3 Pl = viewPosAt(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x);
  vec3 Pu = viewPosAt(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x);
  vec3 Pd = viewPosAt(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x);
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  float rad = uRadius * (1.0 + smoothstep(8.0, 60.0, -P.z) * 2.0);
  float rS = rad * uProjY * 0.5 / max(-P.z, 0.1);
  rS = min(rS, 0.12);
  float a0 = ign(gl_FragCoord.xy + uTime * 37.0) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = a0 + float(i) * 2.3999632;
    vec2 off = vec2(cos(a), sin(a)) * rS * sqrt(t);
    vec2 su = vUv + off * vec2(uTexel.x / uTexel.y, 1.0);
    float sd = texture2D(tDepth, su).x;
    vec3 S = viewPosAt(su, sd);
    vec3 v = S - P;
    float dist = length(v);
    float f = 1.0 - smoothstep(rad * 0.5, rad, dist);
    occ += max(dot(N, v) / (dist + 1e-3) - 0.12, 0.0) * f;
  }
  float ao = clamp(1.0 - uIntensity * occ / float(AO_SAMPLES), 0.0, 1.0);
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}
`;
// Depth-aware blur of the AO term (separable).
const AO_BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float sum = c.r, wsum = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 s = texture2D(tAO, vUv + uDir * float(i)).rg;
    float w = exp(-float(i * i) * 0.18) * (1.0 - smoothstep(0.0, 0.08 * c.g + 0.15, abs(s.g - c.g)));
    sum += s.r * w; wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
}
`;

// Light shafts: radial blur toward the sun of the sky that shows through the canopy.
const SHAFT_FRAG = /* glsl */`
uniform sampler2D tDepth;
uniform sampler2D tSrc;
uniform vec2 uSun;            // sun in uv space (may be off screen)
uniform float uAspect;
uniform float uStep;
uniform float uFirst;         // 1: build the mask from depth, 0: blur tSrc
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float maskAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float sky = step(0.99999, texture2D(tDepth, uv).x);
  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
  return sky * (0.18 + exp(-dot(d, d) * 7.0) * 1.6);
}
void main() {
  vec2 delta = (uSun - vUv) * uStep;
  vec2 uv = vUv + delta * ign(gl_FragCoord.xy);
  float sum = 0.0, decay = 1.0, wsum = 0.0;
  for (int i = 0; i < 20; i++) {
    float m = uFirst > 0.5 ? maskAt(uv) : texture2D(tSrc, uv).r;
    sum += m * decay; wsum += decay;
    decay *= 0.955;
    uv += delta;
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`;

const GRADE_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tShafts;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uFogCol;
uniform vec4 uFog;            // density, base height, falloff (m), max
uniform float uExposure;
uniform float uAOStrength;
uniform float uShafts;
uniform float uUnder;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
${VIEWPOS_GLSL}
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6);
  c = RRTAndODTFit(c);
  return clamp(OUT * c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // small-scale occlusion: mostly in the shade, little on sunlit and emissive surfaces
  float ao = texture2D(tAO, vUv).r;
  col *= mix(1.0, ao, uAOStrength * (1.0 - 0.6 * smoothstep(0.35, 1.6, lum0)));
  // humid height fog: dense over the river and in the valleys, thin on the hilltops
  if (d < 0.99999 && uFog.x > 0.0) {
    vec3 vp = viewPosAt(vUv, d);
    vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
    vec3 ray = wp - uCamPos;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-3);
    float k = ray.y / uFog.z;
    float shape = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0;
    float integral = uFog.x * exp(-(uCamPos.y - uFog.y) / uFog.z) * dist * shape;
    float f = min(1.0 - exp(-integral), uFog.w);
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    vec3 fogC = mix(uFogCol, uSunCol * 0.55, sunAmt * 0.55);
    col = mix(col, fogC, f);
  }
  // god rays through the canopy
  col += texture2D(tShafts, vUv).r * uSunCol * uShafts;
  col *= uExposure;
  col = acesFilmic(col);
  // grade: humid green shadows, warm late-afternoon highlights, a touch of haze in the blacks
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, mix(0.9, 0.82, uUnder));
  vec3 shadowTint = mix(vec3(0.93, 1.0, 0.95), vec3(1.05, 0.96, 0.88), uUnder);
  vec3 lightTint = mix(vec3(1.05, 1.0, 0.9), vec3(1.08, 0.97, 0.84), uUnder);
  col *= mix(shadowTint, lightTint, smoothstep(0.08, 0.75, l));
  col = col * col * (3.0 - 2.0 * col) * 0.15 + col * 0.85;      // gentle S-curve
  col = mix(vec3(0.012, 0.016, 0.012), vec3(1.0), col);          // lifted blacks
  // vignette
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(mix(0.42, 0.2, uUnder), mix(1.15, 0.85, uUnder), length(q));
  col *= 1.0 - vig * mix(0.32, 0.72, uUnder);
  col = toSRGB(clamp(col, 0.0, 1.0));
  // film grain, stronger in the shadows
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0) - 0.5;
  col += g * mix(0.035, 0.012, l);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Dust motes floating in the lamp light underground: a small box of points that follows the
// camera and wraps in the shader.
function createDustMotes() {
  const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  const r = rand(4711);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = r() * 6 - 3; pos[i * 3 + 1] = r() * 3 - 1.5; pos[i * 3 + 2] = r() * 6 - 3;
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 300 } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime; uniform vec3 uCam; uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position + vec3(sin(uTime * 0.13 + aSeed * 40.0), sin(uTime * 0.07 + aSeed * 17.0) * 0.6 - uTime * 0.02, cos(uTime * 0.11 + aSeed * 23.0)) * 0.35;
        p = mod(p - uCam + vec3(3.0, 1.5, 3.0), vec3(6.0, 3.0, 6.0)) - vec3(3.0, 1.5, 3.0) + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = length(p - uCam);
        vA = (1.0 - smoothstep(0.6, 2.9, dist)) * smoothstep(0.15, 0.4, dist) * (0.4 + 0.6 * fract(aSeed * 13.7));
        gl_PointSize = uScale * (0.008 + 0.01 * aSeed) / max(-mv.z, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a * 0.55, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 2000;
  pts.name = 'dustMotes';
  return pts;
}

let quality = readQuality();
ctx.quality = quality;
let post = null;          // created in boot (needs the addons)
let dust = null;
const exposureState = { v: 1, target: 1 };
const _sunNdc = new THREE.Vector3(), _camFwd = new THREE.Vector3(), _sunW = new THREE.Vector3();
const SUN_FALLBACK = new THREE.Vector3(-0.8, 0.4, 0.42).normalize();

async function createPost() {
  if (!renderer) return null;
  let mods;
  try {
    const [ec, rp, ub, pp] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/Pass.js'),
    ]);
    mods = { EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass, UnrealBloomPass: ub.UnrealBloomPass, Pass: pp.Pass, FullScreenQuad: pp.FullScreenQuad };
  } catch (e) {
    console.warn('[main] post-processing unavailable', e);
    return null;
  }
  const { EffectComposer, RenderPass, UnrealBloomPass, Pass, FullScreenQuad } = mods;

  const dbs = new THREE.Vector2();
  renderer.getDrawingBufferSize(dbs);
  const W0 = Math.max(1, dbs.x), H0 = Math.max(1, dbs.y);
  const depthTex = new THREE.DepthTexture(W0, H0);
  depthTex.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(W0, H0, { type: THREE.HalfFloatType, samples: 4, depthTexture: depthTex, depthBuffer: true });
  sceneRT.texture.name = 'scene.hdr';
  const composer = new EffectComposer(renderer, sceneRT);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const proj = { uInvProj: { value: new THREE.Matrix4() } };
  const mk = (frag, uniforms, defines) => new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: frag, uniforms: { ...uniforms, ...proj }, defines: defines || {},
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const lowRT = (w, h, type = THREE.HalfFloatType) => {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type, depthBuffer: false });
    rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
    return rt;
  };

  // --- AO side pass (half or 3/4 resolution + separable bilateral blur)
  const aoUniforms = {
    tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uProjY: { value: 1 },
    uRadius: { value: 0.7 }, uIntensity: { value: 1.35 }, uTime: { value: 0 },
  };
  const aoMats = {};
  const aoMat = (n) => aoMats[n] || (aoMats[n] = mk(AO_FRAG, aoUniforms, { AO_SAMPLES: n }));
  const blurUniforms = { tAO: { value: null }, uDir: { value: new THREE.Vector2() } };
  const blurMat = mk(AO_BLUR_FRAG, blurUniforms);
  const aoA = lowRT(1, 1), aoB = lowRT(1, 1);
  const quad = new FullScreenQuad(null);
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  class AOPass extends Pass {
    constructor() { super(); this.needsSwap = false; this.samples = 10; this.scale = 0.5; this.enabled = true; }
    setSize(w, h) {
      const aw = Math.max(1, Math.round(w * this.scale)), ah = Math.max(1, Math.round(h * this.scale));
      aoA.setSize(aw, ah); aoB.setSize(aw, ah);
      aoUniforms.uTexel.value.set(1 / aw, 1 / ah);
    }
    render(r, writeBuffer, readBuffer) {
      aoUniforms.tDepth.value = readBuffer.depthTexture;
      aoUniforms.uProjY.value = camera.projectionMatrix.elements[5];
      quad.material = aoMat(this.samples);
      r.setRenderTarget(aoA); quad.render(r);
      blurUniforms.tAO.value = aoA.texture; blurUniforms.uDir.value.set(aoUniforms.uTexel.value.x, 0);
      quad.material = blurMat; r.setRenderTarget(aoB); quad.render(r);
      blurUniforms.tAO.value = aoB.texture; blurUniforms.uDir.value.set(0, aoUniforms.uTexel.value.y);
      r.setRenderTarget(aoA); quad.render(r);
      gradeUniforms.tAO.value = aoA.texture;
    }
  }

  // --- light shafts side pass (quarter resolution, two radial blurs)
  const shaftUniforms = {
    tDepth: { value: null }, tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 }, uStep: { value: 0.05 }, uFirst: { value: 1 },
  };
  const shaftMat = mk(SHAFT_FRAG, shaftUniforms);
  const shA = lowRT(1, 1), shB = lowRT(1, 1);
  class ShaftPass extends Pass {
    constructor() { super(); this.needsSwap = false; this.strength = 0; }
    setSize(w, h) {
      const sw = Math.max(1, Math.round(w / 4)), sh = Math.max(1, Math.round(h / 4));
      shA.setSize(sw, sh); shB.setSize(sw, sh);
    }
    render(r, writeBuffer, readBuffer) {
      if (this.strength <= 0.001) { gradeUniforms.tShafts.value = black; return; }
      shaftUniforms.tDepth.value = readBuffer.depthTexture;
      quad.material = shaftMat;
      shaftUniforms.uFirst.value = 1; shaftUniforms.uStep.value = 0.045; shaftUniforms.tSrc.value = black;
      r.setRenderTarget(shA); quad.render(r);
      shaftUniforms.uFirst.value = 0; shaftUniforms.tSrc.value = shA.texture; shaftUniforms.uStep.value = 0.018;
      r.setRenderTarget(shB); quad.render(r);
      gradeUniforms.tShafts.value = shB.texture;
    }
  }

  const aoPass = new AOPass();
  const shaftPass = new ShaftPass();
  composer.addPass(aoPass);
  composer.addPass(shaftPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(W0, H0), 0.32, 0.55, 1.35);
  bloom.threshold = 1.35;
  composer.addPass(bloom);

  // --- grade pass (to screen)
  const gradeUniforms = {
    tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: white }, tShafts: { value: black },
    uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: SUN_FALLBACK.clone() }, uSunCol: { value: new THREE.Color(1.0, 0.78, 0.52) },
    uFogCol: { value: new THREE.Color(0.36, 0.4, 0.31) }, uFog: { value: new THREE.Vector4(0.0042, 0.0, 7.5, 0.6) },
    uExposure: { value: 1 }, uAOStrength: { value: 1 }, uShafts: { value: 0 }, uUnder: { value: 0 },
    uTime: { value: 0 }, uAspect: { value: 1 },
  };
  const gradeMat = mk(GRADE_FRAG, gradeUniforms);
  class GradePass extends Pass {
    constructor() { super(); this.needsSwap = false; this.renderToScreen = true; this.fs = new FullScreenQuad(gradeMat); }
    render(r, writeBuffer, readBuffer) {
      gradeUniforms.tDiffuse.value = readBuffer.texture;
      gradeUniforms.tDepth.value = readBuffer.depthTexture;
      r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.fs.render(r);
    }
  }
  const grade = new GradePass();
  composer.addPass(grade);

  let under = 0;
  const api = {
    composer, aoPass, shaftPass, bloom, enabled: true,
    setQuality(q) {
      const Q = QUALITY[q] || QUALITY.high;
      api.enabled = !!Q.post;
      aoPass.samples = Q.aoSamples || 8;
      aoPass.scale = Q.aoScale || 0.5;
      bloom.enabled = !!Q.bloom;
      api.resize();
    },
    resize() {
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      gradeUniforms.uAspect.value = w / h;
      shaftUniforms.uAspect.value = w / h;
    },
    // per frame, before render: camera matrices, sun on screen, underground blend, exposure
    update(dt) {
      camera.updateMatrixWorld();
      proj.uInvProj.value.copy(camera.projectionMatrixInverse);
      gradeUniforms.uCamWorld.value.copy(camera.matrixWorld);
      camera.getWorldPosition(gradeUniforms.uCamPos.value);
      const w = ctx.world;
      const sunDir = w?.sunDir || SUN_FALLBACK;
      gradeUniforms.uSunDir.value.copy(sunDir);
      if (w?.fog?.color) gradeUniforms.uFogCol.value.copy(w.fog.color);
      const ug = !!(ctx.player?.underground || w?.underground);
      under += ((ug ? 1 : 0) - under) * Math.min(1, dt * 4);
      if (Math.abs(under - (ug ? 1 : 0)) < 0.01) under = ug ? 1 : 0;
      gradeUniforms.uUnder.value = under;
      gradeUniforms.uTime.value = ctx.time + performance.now() * 0.001;
      aoUniforms.uTime.value = 0;
      // sun position on screen and how much of it the view faces
      camera.getWorldDirection(_camFwd);
      const facing = _camFwd.dot(sunDir);
      _sunW.copy(sunDir).multiplyScalar(500).add(gradeUniforms.uCamPos.value);
      _sunNdc.copy(_sunW).project(camera);
      shaftUniforms.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
      const shafts = smoothstep01(0.05, 0.55, facing) * (1 - under);
      shaftPass.strength = shafts;
      gradeUniforms.uShafts.value = shafts * 0.42;
      gradeUniforms.uFog.value.x = 0.0042 * (1 - under);
      gradeUniforms.uAOStrength.value = 1;
      gradeUniforms.uExposure.value = exposureState.v;
      bloom.strength = ug ? 0.5 : 0.32;
      bloom.threshold = ug ? 0.9 : 1.35;
    },
  };
  return api;
}

function smoothstep01(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// Eye adaptation from the baked light where the camera stands (no GPU readback): brighter
// under the closed canopy and in tunnels, a little darker looking up into open sky.
function updateExposure(dt) {
  const w = ctx.world, p = ctx.player;
  let target = 1;
  const ug = !!(p?.underground || w?.underground);
  if (ug) target = 1.45;
  else if (w?.bake?.skyAt) {
    camera.getWorldPosition(_sunW);
    const sky = w.bake.skyAt(_sunW.x, _sunW.z), sun = w.bake.sunAt(_sunW.x, _sunW.z);
    target = 1 + 0.75 * (1 - sky) * (1 - 0.4 * sun);
    camera.getWorldDirection(_camFwd);
    target *= 1 - 0.18 * clamp(_camFwd.y * 1.6, 0, 1);
  }
  exposureState.target = target;
  const k = Math.min(1, dt * (target > exposureState.v ? 1.1 : 2.2));
  exposureState.v += (target - exposureState.v) * k;
  if (!post?.enabled && renderer) renderer.toneMappingExposure = exposureState.v;
  else if (renderer) renderer.toneMappingExposure = 1;
}

function applyQuality(q, persist) {
  if (!QUALITY[q]) q = 'high';
  quality = q;
  ctx.quality = q;
  const Q = QUALITY[q];
  if (renderer) {
    renderer.setPixelRatio(Math.min(Q.pixelRatio, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), false);
  }
  try { ctx.world?.setPreset?.(q); } catch (e) { reportError('world.setPreset', e); }
  if (post) post.setQuality(q);
  if (persist) saveQuality(q);
  syncQualityControl();
  renderDirty = true;
  events.emit('quality', { quality: q });
}
ctx.setQuality = (q) => { applyQuality(String(q || '').toLowerCase(), true); return quality; };

// --- the menu's quality selector: a small segmented control injected into #menu ----------
let qualityEl = null;
function syncQualityControl() {
  if (!qualityEl) return;
  for (const b of qualityEl.querySelectorAll('button')) {
    const on = b.dataset.q === quality;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
}
function mountQualityControl() {
  const menu = doc.getElementById('menu');
  if (!menu) return;
  if (!doc.getElementById('ug-quality-style')) {
    const st = doc.createElement('style');
    st.id = 'ug-quality-style';
    st.textContent = `
#ug-quality{position:absolute;left:max(24px,env(safe-area-inset-left));bottom:max(22px,env(safe-area-inset-bottom));z-index:5;
  display:none;pointer-events:auto;padding:2px;border:1px solid rgba(215,209,188,.18);border-radius:3px;
  background:rgba(10,12,9,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
body[data-state="menu"] #ug-quality{display:inline-flex}
#ug-quality button{appearance:none;border:0;margin:0;padding:5px 11px;min-width:44px;border-radius:2px;cursor:pointer;
  background:transparent;color:rgba(215,209,188,.5);font:600 10px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  letter-spacing:.18em;text-transform:uppercase;transition:color .15s ease,background-color .15s ease}
#ug-quality button:hover{color:rgba(215,209,188,.85)}
#ug-quality button[aria-checked="true"]{background:rgba(215,209,188,.13);color:#d7d1bc}
#ug-quality button:focus-visible{outline:1px solid rgba(215,209,188,.6);outline-offset:1px}`;
    doc.head.appendChild(st);
  }
  if (!qualityEl) {
    qualityEl = doc.createElement('div');
    qualityEl.id = 'ug-quality';
    qualityEl.setAttribute('role', 'radiogroup');
    qualityEl.setAttribute('aria-label', 'Graphics');
    for (const q of QUALITY_NAMES) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.q = q;
      b.setAttribute('role', 'radio');
      b.textContent = QUALITY_LABEL[q];
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ctx.setQuality(q); });
      qualityEl.appendChild(b);
    }
    qualityEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = QUALITY_NAMES.indexOf(quality), n = QUALITY_NAMES.length;
      const q = QUALITY_NAMES[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
      ctx.setQuality(q);
      qualityEl.querySelector(`button[data-q="${q}"]`)?.focus();
    });
  }
  if (qualityEl.parentNode !== menu) menu.appendChild(qualityEl);
  syncQualityControl();
  // hud.js rebuilds #menu's contents (restart, screens): put the control back when it goes
  if (!mountQualityControl.observer && typeof MutationObserver === 'function') {
    mountQualityControl.observer = new MutationObserver(() => {
      if (qualityEl && qualityEl.parentNode !== menu) menu.appendChild(qualityEl);
    });
    mountQualityControl.observer.observe(menu, { childList: true });
  }
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function updateModule(name, dt) {
  const m = ctx[name];
  if (!m || typeof m.update !== 'function') return;
  try { m.update(dt); } catch (e) { reportError(name + '.update', e); }
}

function tick(dt) {
  const s = state;
  if (isSimState(s) && !endShown) {
    ctx.time += dt;
    if (s === 'playing') stats.time += dt;
    for (let i = 0; i < UPDATE_ORDER.length; i++) updateModule(UPDATE_ORDER[i], dt);
    if (s === 'playing') updateMission(dt);
    updateEnd();
  } else if (s === 'menu' || endShown) {
    // behind the menu / end screen: keep the jungle breathing, freeze the fight
    updateModule('world', dt);
    updateModule('hud', dt);
    updateModule('audio', dt);
  } else if (s === 'paused') {
    updateModule('hud', dt);
    updateModule('audio', dt);
  }
  lastTickDt = dt;
  updateExposure(dt);
  if (dust) {
    const ug = !!(ctx.player?.underground || ctx.world?.underground);
    dust.visible = ug;
    if (ug) {
      dust.material.uniforms.uTime.value += dt;
      camera.getWorldPosition(dust.material.uniforms.uCam.value);
      dust.material.uniforms.uScale.value = (renderer?.getDrawingBufferSize?.(_dbs).y || 720) * 0.9;
    }
  }
  // per-frame input is consumed
  const m = input.mouse;
  m.dx = 0; m.dy = 0; m.wheel = 0;
  input.pressed.clear();
  input.released.clear();
}

let lastTickDt = STEP_DT;
const _dbs = new THREE.Vector2();
function render() {
  if (!renderer || contextLost) return;
  if (debug) {
    renderer.info.autoReset = false; // re-asserted: tools may flip it back between frames
    renderer.info.reset();
    shadowCallsAcc = 0; shadowTrisAcc = 0; shadowPassesAcc = 0;
  }
  try {
    if (post && post.enabled) {
      post.update(lastTickDt);
      post.composer.render(lastTickDt);
    } else {
      renderer.render(scene, camera);
    }
  } catch (e) {
    reportError('render', e);
    if (post && post.enabled && (errorCounts.render || 0) > 2) {
      // a broken post chain must not blank the game: fall back to the direct render
      post.enabled = false;
      console.warn('[main] post-processing disabled after errors');
    }
  }
  if (debug) {
    // snapshot this frame so later offscreen renders cannot skew __stats()
    const r = renderer.info.render;
    frameInfo.calls = r.calls;
    frameInfo.triangles = r.triangles;
    frameInfo.points = r.points;
    frameInfo.lines = r.lines;
    frameInfo.shadowCalls = shadowCallsAcc;
    frameInfo.shadowTriangles = shadowTrisAcc;
    frameInfo.shadowPasses = shadowPassesAcc;
  }
  renderDirty = false;
}

// fps over a sliding half-second window
let fps = 0, fpsFrames = 0, fpsT0 = performance.now(), frameMs = 0;
let lastT = -1;
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (lastT < 0) lastT = now;
  const raw = Math.max(0, (now - lastT) / 1000);
  lastT = now;
  frameMs = frameMs ? frameMs * 0.9 + raw * 100 : raw * 1000;
  fpsFrames++;
  if (now - fpsT0 >= 500) { fps = (fpsFrames * 1000) / (now - fpsT0); fpsFrames = 0; fpsT0 = now; }

  if (manualStep) {
    if (renderDirty) render();
    return;
  }
  const dt = Math.min(raw, DT_MAX);
  tick(dt);
  if (state !== 'paused' || renderDirty) render();
}

// ---------------------------------------------------------------------------
// Debug / automation hooks
// ---------------------------------------------------------------------------

if (debug) {
  // __step(n, dt, draw = true): n fixed ticks, then one render unless draw === false
  window.__step = (n = 1, stepDt = STEP_DT, draw = true) => {
    const count = clamp(Math.floor(Number(n) || 1), 1, 100000);
    const d = clamp(Number(stepDt) || STEP_DT, 0.001, DT_MAX);
    for (let i = 0; i < count; i++) tick(d);
    if (draw !== false) render();
    const p = ctx.player;
    return {
      state, time: +ctx.time.toFixed(4), frames: count,
      pos: p?.position ? { x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3) } : null,
      underground: !!p?.underground, health: p?.health ?? null,
      objective: mission.current?.id || null,
    };
  };
  window.__stats = () => {
    const info = renderer?.info;
    return {
      // full frame (shadow + main pass); main = without the shadow pass
      calls: frameInfo.calls,
      triangles: frameInfo.triangles,
      points: frameInfo.points,
      lines: frameInfo.lines,
      mainCalls: frameInfo.calls - frameInfo.shadowCalls,
      mainTriangles: frameInfo.triangles - frameInfo.shadowTriangles,
      shadowCalls: frameInfo.shadowCalls,
      shadowTriangles: frameInfo.shadowTriangles,
      shadowPass: frameInfo.shadowPasses > 0,
      fps: Math.round(fps * 10) / 10,
      frameMs: Math.round(frameMs * 100) / 100,
      geometries: info?.memory?.geometries ?? 0,
      textures: info?.memory?.textures ?? 0,
      programs: info?.programs?.length ?? 0,
      quality,
      post: !!(post && post.enabled),
      exposure: +exposureState.v.toFixed(3),
      state,
      time: +ctx.time.toFixed(3),
    };
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function importModule(name, path) {
  try {
    return await import(path);
  } catch (e) {
    reportError(name + ' (import)', e);
    return null;
  }
}

async function boot() {
  doc.body.dataset.state = 'loading';
  if (!renderer) {
    loadingError('WebGL unavailable');
    return;
  }
  onResize();
  setLoading(0.02, 'Loading');

  // fetch every module in parallel; a missing or broken file only loses that module
  const imported = await Promise.all(MODULES.map(([name, path]) => importModule(name, path)));
  let progress = 0.1;
  setLoading(progress);

  // world.js may report its own build progress
  let worldSpan = 0, worldBase = 0;
  const onLoadProgress = (d) => {
    if (!worldSpan || !d) return;
    const t = Number.isFinite(d.t) ? d.t : Number.isFinite(d.progress) ? d.progress : null;
    if (t != null) setLoading(worldBase + clamp(t, 0, 1) * worldSpan, d.label || undefined);
  };
  events.on('loadProgress', onLoadProgress);

  for (let i = 0; i < MODULES.length; i++) {
    const [name, , factoryName, share] = MODULES[i];
    setLoading(progress, LOAD_LABELS[name] || name);
    await nextFrame();
    const mod = imported[i];
    const factory = mod && (mod[factoryName] || mod.default);
    let instance = null;
    if (typeof factory === 'function') {
      if (name === 'world') { worldBase = progress; worldSpan = share; }
      try {
        instance = await factory(ctx);
      } catch (e) {
        reportError(name, e);
        instance = null;
      }
      worldSpan = 0;
    } else if (mod) {
      reportError(name, new Error(`${factoryName}() not exported`));
    }
    if (!instance && name === 'world') {
      try { instance = createFallbackWorld(); } catch (e) { reportError('fallbackWorld', e); }
    }
    ctx[name] = instance || null;
    progress += share;
    setLoading(progress);
  }
  events.off('loadProgress', onLoadProgress);

  // post-processing chain + quality preset (world was built for ctx.quality already)
  setLoading(0.95, 'Light');
  post = await createPost();
  applyQuality(quality, false);
  try { dust = createDustMotes(); scene.add(dust); } catch (e) { console.warn('[main] dust motes skipped', e); }

  // warm up shaders so the first real frame does not hitch
  setLoading(0.97, 'Shaders');
  await nextFrame();
  // enemies compiles its alternate light sets (searchlight, underground) now that every
  // module's lamps and materials exist, so toggling them later never recompiles
  try { ctx.enemies?.warmLightSets?.(); } catch (e) { console.warn('[main] light-set warm-up skipped', e); }
  try {
    const parallel = !!renderer.extensions?.has?.('KHR_parallel_shader_compile');
    if (parallel && typeof renderer.compileAsync === 'function') {
      await Promise.race([
        renderer.compileAsync(scene, camera),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } else {
      renderer.compile(scene, camera);
    }
  } catch (e) {
    console.warn('[main] shader warm-up skipped', e);
  }
  // one settling update so every module has placed itself before the first frame
  try { updateModule('world', 0.0001); updateModule('player', 0.0001); } catch (e) { /* isolated above */ }
  render();
  setLoading(1, '');
  mountQualityControl();
  const failed = Object.keys(ctx.errors);
  if (failed.length) console.warn('[main] running without:', failed.join(', '));

  // first state (debug skips the menu unless ?menu=1 asks for it)
  if (debug && !truthy(debug.menu)) {
    setState('playing');
    hideLoading();
    try { ctx.hud?.hideMenu?.(); } catch (e) { /* */ }
    startMission();
  } else {
    setState('menu');
    if (ctx.hud && typeof ctx.hud.showMenu === 'function') {
      try { ctx.hud.showMenu(); } catch (e) { reportError('hud', e); }
      hideLoading();
    } else {
      fallbackScreen('', 'Deploy', () => deploy());
    }
  }

  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

boot().catch((e) => {
  console.error('[main] boot failed', e);
  loadingError('Failed to start');
});
