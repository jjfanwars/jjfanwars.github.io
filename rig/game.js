// Station Nine: online co-op boat + oil rig survival horror in a storm. World, boat, creatures, net, audio, UI.
'use strict';
const $ = id => document.getElementById(id);
const TEST = /[?&]test/.test(location.search);
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = mulberry(9001);
let WR = mulberry(1), CR = Math.random;
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }

// ---------------- settings
const SET = Object.assign({diff: 'normal', sens: 1, bright: 1, gfx: 'high', name: ''}, (() => { try { return JSON.parse(localStorage.getItem('s9-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('s9-set', JSON.stringify(SET)); } catch (e) {} };
const DIFF = {
  easy:      {chase: 4.4, sight: 20, hear: .7,  checkP: .3,  breathHear: .1, lost: 2.5, roam: 30, react: .7,  bleed: 60, down: 14, drown: 14, ram: 16},
  normal:    {chase: 5.1, sight: 26, hear: 1,   checkP: .55, breathHear: .3, lost: 4,   roam: 24, react: .45, bleed: 45, down: 10, drown: 9,  ram: 11},
  nightmare: {chase: 5.7, sight: 32, hear: 1.3, checkP: .8,  breathHear: .6, lost: 6,   roam: 18, react: .28, bleed: 30, down: 7,  drown: 6,  ram: 8},
};
let D = DIFF.normal;
const CREW_COL = [0xe0602a, 0x2f7fd8, 0xd8b02a, 0x3aa04a, 0x9a5ad8, 0xd84a9a];
const hexS = c => '#' + c.toString(16).padStart(6, '0');

// ---------------- net (jjfanwars relay)
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const Net = {
  tag: '[Rig]', role: 'solo', ws: null, peers: new Map(), code: '', relayT: {pose: 1}, id: '', name: '', handlers: {}, retry: 0, started: false,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) { if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} } else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} } },
  send1(id, o) { const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s crew", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.started = false; this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(true); this.onStatus && this.onStatus('open'); this.emit({t: '_lobby'}); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') { if (!this.peers.has(id) && this.peers.size >= 5) { this.send1(id, {t: 'full'}); return; } const used = new Set([0, ...[...this.peers.values()].map(p => p.c)]); let c = 1; while (used.has(c)) c++; if (!this.peers.has(id)) this.peers.set(id, {id, c, name: String(m.name || 'Deckhand').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Deckhand'}); this.emit({t: '_join', id}); this.emit({t: '_lobby'}); return; }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id); if (this.relayT[m.t]) this.send(m);
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) {
    this.close(); this.role = 'guest'; this.code = code; this.name = name; this.id = Math.random().toString(36).slice(2, 11);
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.send({t: 'hello', name});
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostgone'}); else if (m.c === 'host' && m.up) this.send({t: 'hello', name}); return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      if (m.t === 'full') { this.close(); onFail('That crew is full.'); return; }
      if (m.from && m.from === this.id) return; this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such room.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null; this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(); return r.filter(x => x.open && x.name.indexOf(this.tag + ' ') === 0); } catch (e) { return []; } },
};
const isHost = () => Net.role !== 'guest';
const myId = () => Net.role === 'guest' ? Net.id : 'H';

// ---------------- world data
// Rig centred on (0, 0). Levels: dock 1.8, main deck 10, upper deck 17. Lighthouse jetty to the south.
const LV = [1.8, 10, 17];
const JETTY = {x: 0, z: -238};
const ISLE = {x: 0, z: -276, r: 30};
const LEGS = [[-11, -11], [11, -11], [-11, 11], [11, 11]];
const SURF = [];   // {k:'slab'|'ramp', x0,x1,z0,z1, y | y0,y1,ax}
const WALLS = [];  // {x0,x1,z0,z1,y0,y1,see}
const OBST = [];   // creature-irrelevant; boat obstacles: {c:1,x,z,r} | rects
const BLD = [], HIDES = [], SPOTS = [], INTER = [], LAMPS = [];
const BK = {}; const bucket = k => BK[k] || (BK[k] = []);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function boxUV(g, sx, sy, sz, t) { const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } return g; }
function put(k, g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g; }
function wbox(k, x, y, z, sx, sy, sz, ry = 0, tile = 1.5) { return put(k, boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile), x, y, z, ry); }
function bx(k, x0, x1, y0, y1, z0, z1, tile) { return wbox(k, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, 0, tile); }
function slab(x0, x1, z0, z1, y, k = 'grate') { SURF.push({k: 'slab', x0, x1, z0, z1, y}); bx(k, x0, x1, y - .3, y, z0, z1, 2); bx('steel', x0, x1, y - .9, y - .3, z0 - .01, z0 + .25); bx('steel', x0, x1, y - .9, y - .3, z1 - .25, z1 + .01); }
function wallR(x0, x1, z0, z1, y0, y1, k = 'plate', see = true) { WALLS.push({x0, x1, z0, z1, y0, y1, see}); if (k) bx(k, x0, x1, y0, y1, z0, z1, 2); }
function rail(x0, x1, z0, z1, y) { // thin railing with posts
  WALLS.push({x0, x1, z0, z1, y0: y, y1: y + 1.15, see: false});
  const along = x1 - x0 > z1 - z0, L = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.6));
  bx('yellow', x0, x1, y + 1.02, y + 1.1, z0, z1); bx('yellow', x0, x1, y + .52, y + .57, z0, z1);
  for (let i = 0; i <= n; i++) { const t = i / n; const x = along ? mix(x0, x1, t) : (x0 + x1) / 2, z = along ? (z0 + z1) / 2 : mix(z0, z1, t); bx('yellow', x - .04, x + .04, y, y + 1.1, z - .04, z + .04); }
}
function ramp(x0, x1, z0, z1, y0, y1, ax) { // ax 'x+' rises along +x, 'z+' along +z
  SURF.push({k: 'ramp', x0, x1, z0, z1, y0, y1, ax});
  const L = ax === 'x+' ? x1 - x0 : z1 - z0, n = Math.ceil(L / .32), rise = (y1 - y0) / n;
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n, y = y0 + rise * (i + 1);
    if (ax === 'x+') bx('grate', mix(x0, x1, a), mix(x0, x1, b), y - .08, y, z0, z1); else bx('grate', x0, x1, y - .08, y, mix(z0, z1, a), mix(z0, z1, b)); }
  // stringers + handrails keep you on the stairs and others off them
  const yy0 = Math.min(y0, y1), yy1 = Math.max(y0, y1) + 1.1;
  if (ax === 'x+') { for (const z of [z0 - .08, z1 + .08]) { WALLS.push({x0: x0 + 1.2, x1: x1 - .2, z0: z - .05, z1: z + .05, y0: yy0 + .4, y1: yy1, see: false, ramp: 1}); } }
  else for (const x of [x0 - .08, x1 + .08]) WALLS.push({x0: x - .05, x1: x + .05, z0: z0 + 1.2, z1: z1 - .2, y0: yy0 + .4, y1: yy1, see: false, ramp: 1});
  // visible handrail lines
  if (ax === 'x+') for (const z of [z0, z1]) { const q = new THREE.CylinderGeometry(.035, .035, Math.hypot(x1 - x0, y1 - y0), 5); q.rotateZ(-PI / 2 + Math.atan2(y1 - y0, x1 - x0)); put('yellow', q, (x0 + x1) / 2, (y0 + y1) / 2 + 1.05, z); }
  else for (const x of [x0, x1]) { const q = new THREE.CylinderGeometry(.035, .035, Math.hypot(z1 - z0, y1 - y0), 5); q.rotateX(PI / 2 - Math.atan2(y1 - y0, z1 - z0)); put('yellow', q, x, (y0 + y1) / 2 + 1.05, (z0 + z1) / 2); }
}
function rampY(s, x, z) { const t = s.ax === 'x+' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0); return mix(s.y0, s.y1, clamp(t, 0, 1)); }
function spot(tag, x, y, z) { SPOTS.push({tag, x, y, z, i: SPOTS.length}); }
const ROT = {s: 0, w: PI / 2, n: PI, e: -PI / 2};
const L2W = (b, lx, lz) => { const c = Math.cos(b.th), s = Math.sin(b.th); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };
const W2L = (b, x, z) => { const c = Math.cos(b.th), s = Math.sin(b.th), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
function rectW(b, x0, x1, z0, z1) { const p = [L2W(b, x0, z0), L2W(b, x1, z1)]; return {x0: Math.min(p[0][0], p[1][0]), x1: Math.max(p[0][0], p[1][0]), z0: Math.min(p[0][1], p[1][1]), z1: Math.max(p[0][1], p[1][1])}; }
function lbox(b, k, lx, ly, lz, sx, sy, sz, ry = 0, tile = 1.5) {
  const g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile);
  _e.set(0, ry, 0); g.applyMatrix4(_m4.compose(_v.set(lx, ly, lz), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g;
}
function zoneOf(x, z, y, m = 0) { for (let i = 0; i < BLD.length; i++) { const b = BLD[i]; if (Math.abs(y - b.fy) > 2) continue; const l = W2L(b, x, z); if (Math.abs(l[0]) < b.w / 2 - m && Math.abs(l[1]) < b.d / 2 - m) return i; } return -1; }
const BT = {quarters: {w: 8, d: 6, dx: 0, dw: 1.3, wh: 2.8}, gen: {w: 7, d: 6, dx: 1.5, dw: 1.6, wh: 3}, ctrl: {w: 8, d: 5.5, dx: 2, dw: 1.3, wh: 2.8}};
function building(kind, name, x, z, y, door) {
  const T = BT[kind], b = {kind, name, x, z, th: ROT[door], w: T.w, d: T.d, wh: T.wh, fy: y, i: BLD.length}; BLD.push(b);
  const t = .16, hw = b.w / 2, hd = b.d / 2, wh = b.wh, dl = T.dx - T.dw / 2, dr = T.dx + T.dw / 2;
  const wall = (lx, lz, sx, sz) => { lbox(b, 'plate', lx, wh / 2, lz, sx, wh, sz); const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: y, y1: y + wh, see: true})); };
  wall(0, hd, b.w + t, t); wall(-hw, 0, t, b.d); wall(hw, 0, t, b.d);
  wall((-hw - t / 2 + dl) / 2, -hd, dl + hw + t / 2, t); wall((hw + t / 2 + dr) / 2, -hd, hw + t / 2 - dr, t);
  lbox(b, 'plate', T.dx, (2.1 + wh) / 2, -hd, T.dw, wh - 2.1, t);
  lbox(b, 'hazard', T.dx, 2.12, -hd, T.dw + .3, .12, t + .06);
  lbox(b, 'door', dr + .03, 1.02, -hd + T.dw / 2 + .1, .05, 2.02, T.dw - .04);
  lbox(b, 'plate', 0, wh + .08, 0, b.w + .3, .16, b.d + .3); // flat roof
  lbox(b, 'floorP', 0, .03, 0, b.w, .06, b.d, 0, 1.2);
  for (const s of [-1, 1]) lbox(b, 'glass', s * hw, 1.6, -.6, t + .05, .5, 1.4);
  b.lamp = L2W(b, 0, 0); LAMPS.push([b.lamp[0], y + wh - .3, b.lamp[1], 1]);
  b.din = L2W(b, T.dx, -hd + 1.0); b.dout = L2W(b, T.dx, -hd - 1.4);
  b.hides = []; furnish(b); return b;
}
function hide(b, lx, lz, face) {
  const [x, z] = L2W(b, lx, lz), th = face + b.th, fx = -Math.sin(th), fz = -Math.cos(th);
  const h = {x, z, y: b.fy, yaw: th, b: b.i, ex: x + fx * .9, ez: z + fz * .9, i: HIDES.length}; HIDES.push(h); b.hides.push(h);
  INTER.push({kind: 'hide', h, x: x + fx * .35, y: b.fy + 1.2, z: z + fz * .35, r: 2, label: () => P.hd === h.i ? 'Get out' : 'Hide in the locker', on: () => !hideTaken(h)});
}
function locker(b, lx, lz, face) {
  lbox(b, 'locker', lx, .975, lz, .6, 1.95, .55, face);
  const fx = -Math.sin(face), fz = -Math.cos(face);
  for (let y = .3; y < 1.8; y += .16) lbox(b, 'dark', lx + fx * .285, y, lz + fz * .285, .5, .04, .02, face);
  const r = rectW(b, lx - .3, lx + .3, lz - .3, lz + .3); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + 1.95, see: false, sol: 1}));
  hide(b, lx, lz, face);
}
function furnish(b) {
  const hw = b.w / 2, hd = b.d / 2, L = (lx, ly, lz) => { const [x, z] = L2W(b, lx, lz); return [x, b.fy + ly, z]; };
  const solid = (lx, lz, sx, sz, h) => { const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + h, see: false, sol: 1})); };
  if (b.kind === 'quarters') {
    for (const s of [-1, 1]) { lbox(b, 'steel', s * (hw - .55), .4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), .5, 1.6, .9, .12, 1.9); lbox(b, 'steel', s * (hw - .55), 1.4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), 1.5, 1.6, .9, .12, 1.9); solid(s * (hw - .55), 1.6, 1, 2, 1.6); }
    locker(b, -1.2, hd - .35, PI); locker(b, -.5, hd - .35, PI); locker(b, 1.2, hd - .35, PI);
    lbox(b, 'steel', -2.4, .75, -1.4, 1.2, .06, .8); solid(-2.4, -1.4, 1.2, .8, .8); spot('table', ...L(-2.4, .8, -1.4)); spot('bunk', ...L(hw - .55, .58, 1.2));
  } else if (b.kind === 'gen') {
    lbox(b, 'genM', -.8, .8, 1.2, 3.2, 1.6, 1.6); solid(-.8, 1.2, 3.2, 1.6, 1.6); lbox(b, 'dark', -.8, 1.62, 1.2, 2.6, .05, 1.1);
    for (let i = 0; i < 3; i++) lbox(b, 'steel', -2 + i * .6, 1.9, 1.2, .18, .6, .18);
    lbox(b, 'panel', 2.6, 1.3, 1.6, .9, 1.4, .3); b.genP = L(-.8, 1.2, -.2); b.genPanel = L(2.6, 1.3, 1.3);
    locker(b, -hw + .35, -1.2, -PI / 2); spot('bench', ...L(2.6, .9, -1.6)); lbox(b, 'steel', 2.6, .45, -1.6, 1, .9, .6); solid(2.6, -1.6, 1, .6, .9);
  } else if (b.kind === 'ctrl') {
    lbox(b, 'panel', 0, .55, hd - .5, 6, 1.1, .7); solid(0, hd - .5, 6, .7, 1.1); lbox(b, 'screen', 0, 1.2, hd - .7, 5, .35, .05);
    for (let i = 0; i < 4; i++) lbox(b, 'screen', -2.4 + i * 1.6, 1.13, hd - .78, .9, .4, .03, 0);
    b.console = L(-1, 1.1, hd - 1.1); locker(b, -hw + .35, -1.2, -PI / 2); spot('desk', ...L(2.6, 1.12, hd - .55)); spot('floor', ...L(-2, .1, -1.6));
  }
}
const VALVES = [];
function valve(x, y, z, name, ry) {
  put('red', new THREE.TorusGeometry(.32, .05, 6, 16), x, y + 1.15, z, ry); put('steel', new THREE.CylinderGeometry(.12, .12, 1.2, 8), x, y + .55, z);
  wbox('pipe', x, y + .85, z + .1, .3, .3, 2.6, ry); VALVES.push({x, y, z, name, open: false});
}
function buildRig() {
  // legs and bracing
  for (const [x, z] of LEGS) { put('leg', new THREE.CylinderGeometry(1.4, 1.6, 50, 14), x, -15, z); OBST.push({c: 1, x, z, r: 2.1}); }
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) for (const y of [-2, 5]) { const [x0, z0] = LEGS[a], [x1, z1] = LEGS[b]; wbox('leg', (x0 + x1) / 2, y, (z0 + z1) / 2, x0 === x1 ? .5 : 22, .5, z0 === z1 ? .5 : 22); }
  // L0 dock (south) with ladder down to the sea
  slab(-8, 8, -23, -16, LV[0], 'wood'); slab(4, 8, -16, -14.4, LV[0], 'wood'); for (const x of [-7.5, 0, 7.5]) for (const z of [-22.5, -16.5]) put('leg', new THREE.CylinderGeometry(.35, .35, 6, 8), x, LV[0] - 3.2, z);
  OBST.push({x0: -8.4, x1: 8.4, z0: -22.4, z1: -14});
  rail(-8, -8, -23, -16, LV[0]); rail(8, 8, -23, -16, LV[0]); rail(-8, 4, -16, -16, LV[0]); rail(4, 8, -14.4, -14.4, LV[0]); rail(4, 4, -16, -14.4, LV[0]);
  for (const x of [-6, -2, 2, 6]) put('dark', new THREE.CylinderGeometry(.18, .22, .5, 8), x, LV[0] + .25, -22.7);
  for (let y = -1.2; y < LV[0]; y += .35) wbox('yellow', 0, y, -23.2, .6, .05, .05); INTER.push({kind: 'ladder', x: 0, y: 0, z: -23.6, r: 3.5, top: [0, LV[0], -22], label: () => 'Climb the ladder', on: () => P.sw});
  valve(-6, LV[0], -18.2, 'Dock fuel valve', 0); spot('crate', 4, LV[0] + .8, -18.5); wbox('crate', 4, LV[0] + .4, -18.5, 1.2, .8, 1); WALLS.push({x0: 3.4, x1: 4.6, z0: -19, z1: -18, y0: LV[0], y1: LV[0] + .8, see: false, sol: 1});
  // stair 1: dock -> landing (east)
  ramp(8, 20, -16, -14.4, LV[0], LV[1], 'x+');
  slab(20, 24, -18, -9, LV[1]); slab(14, 20, -13, -9, LV[1]);
  rail(24, 24, -18, -9, LV[1]); rail(20, 24, -18, -18, LV[1]); rail(14, 24, -9, -9, LV[1]); rail(14, 20, -13, -13, LV[1]); rail(20, 20, -18, -16, LV[1]);
  // L1 main deck
  slab(-14, 14, -13, 13, LV[1]);
  rail(-14, 14, -13, -13, LV[1]); rail(-14, 14, 13, 13, LV[1]); rail(-14, -14, -13, 13, LV[1]); rail(14, 14, -9, 13, LV[1]);
  // stair 2: main -> upper (north side)
  ramp(1, 2.6, -9, 2, LV[1], LV[2], 'z+');
  // L2 upper deck
  slab(-14, 3, 2, 13, LV[2]);
  rail(-14, 3, 13, 13, LV[2]); rail(-14, -14, 2, 13, LV[2]); rail(3, 3, 2, 13, LV[2]); rail(-14, .9, 2, 2, LV[2]);
  for (const [x, z] of [[-13.5, 2.5], [2.5, 2.5], [-13.5, 12.5], [2.5, 12.5], [-6, 2.5]]) wbox('steel', x, (LV[1] + LV[2]) / 2 - .15, z, .35, LV[2] - LV[1] - .3, .35);
  for (const [x, z] of [[-6, 2.5], [-13.5, 2.5]]) WALLS.push({x0: x - .2, x1: x + .2, z0: z - .2, z1: z + .2, y0: LV[1], y1: LV[2] - .3, see: true});
  // buildings
  building('quarters', 'Crew quarters', 8, 6, LV[1], 'w');
  building('gen', 'Generator room', -8, -5.5, LV[1], 'e');
  building('ctrl', 'Control room', -6.5, 9.6, LV[2], 's');
  valve(-12.4, LV[1], 7, 'Main deck fuel valve', PI / 2);
  // derrick, flare boom, containers, pipes, crane
  const dx = 6, dz = -6, dy = LV[1];
  for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const g = new THREE.CylinderGeometry(.12, .16, 28, 6); g.translate(0, 14, 0); g.rotateX(b * -.035); g.rotateZ(a * .035); put('steel', g, dx + a, dy, dz + b); }
  for (let y = 2; y < 27; y += 3) { const w = 4 - y * .1; wbox('steel', dx, dy + y, dz - w / 2, w, .1, .1); wbox('steel', dx, dy + y, dz + w / 2, w, .1, .1); wbox('steel', dx - w / 2, dy + y, dz, .1, .1, w); wbox('steel', dx + w / 2, dy + y, dz, .1, .1, w); }
  WALLS.push({x0: dx - 2.2, x1: dx + 2.2, z0: dz - 2.2, z1: dz + 2.2, y0: dy, y1: dy + 3, see: false, sol: 1}); bx('steel', dx - 2.2, dx + 2.2, dy, dy + .6, dz - 2.2, dz + 2.2);
  wbox('pipe', dx, dy + 1.8, dz, .5, 3.6, .5); spot('derrick', dx - 2.6, dy + .05, dz + 2.6);
  G.avi = [dx, dy + 28.5, dz];
  wbox('steel', 20, LV[1] + 6, 4, 18, .5, .5, -.3); wbox('steel', 28, LV[1] + 10, 6, .8, .8, .8);
  for (const [x, z, c, r] of [[-9, -11.6, 'cont', 0], [10, -11.4, 'cont2', 0], [12, -3, 'cont', PI / 2]]) { wbox(c, x, LV[1] + 1.3, z, 6, 2.6, 2.4, r, 3); const w = r ? 2.4 : 6, d = r ? 6 : 2.4; WALLS.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: LV[1], y1: LV[1] + 2.6, see: true}); }
  spot('cont', -5.5, LV[1] + .05, -10); spot('cont', 12.8, LV[1] + .05, 6);
  for (let i = 0; i < 4; i++) { wbox('pipe', -2 + i * .55, LV[1] + .4, 0, .4, .4, 9); } WALLS.push({x0: -2.3, x1: 0, z0: -4.5, z1: 4.5, y0: LV[1], y1: LV[1] + .8, see: false, sol: 1});
  // lifeboat station on the upper deck
  wbox('orange', -11, LV[2] + 1, 4, 2.4, 1.6, 4.6, 0); WALLS.push({x0: -12.2, x1: -9.8, z0: 1.7, z1: 6.3, y0: LV[2], y1: LV[2] + 2, see: true}); spot('lifeboat', -9.2, LV[2] + .05, 3);
  spot('upper', 1.5, LV[2] + .05, 12.2); spot('landing', 20.8, LV[1] + .05, -10.2); spot('dock', -7, LV[0] + .05, -21);
  // floodlight lamps (light up with the power)
  for (const [x, y, z] of [[13.5, LV[1] + 3, -12.5], [-13.5, LV[1] + 3, -12.5], [13.5, LV[1] + 3, 12.5], [-13.5, LV[2] + 3, 12.5], [0, LV[0] + 3, -16.5], [20, LV[1] + 3, -17.5], [0, LV[1] + 3, 0]]) { wbox('steel', x, y - 1.5, z, .12, 3, .12); put('bulb', new THREE.BoxGeometry(.6, .3, .3), x, y + .1, z); LAMPS.push([x, y, z, 1.6]); }
}
function buildIsle() {
  put('rock', new THREE.CylinderGeometry(ISLE.r * .7, ISLE.r, 14, 18, 2), ISLE.x, -5, ISLE.z);
  OBST.push({c: 1, x: ISLE.x, z: ISLE.z, r: ISLE.r + 1});
  SURF.push({k: 'slab', x0: -2.5, x1: 2.5, z0: -250, z1: -233, y: 1.6}); bx('wood', -2.5, 2.5, 1.3, 1.6, -250, -233, 1.5);
  OBST.push({x0: -2, x1: 2, z0: -250, z1: -232.6});
  for (const z of [-249, -245, -241, -237, -233.5]) for (const x of [-1.4, 1.4]) put('log', new THREE.CylinderGeometry(.15, .15, 4, 6), x, -.5, z);
  
  INTER.push({kind: 'ladder', x: 0, y: 0, z: -232.3, r: 3.5, top: [0, 1.6, -234], label: () => 'Climb the ladder', on: () => P.sw});
  // lighthouse
  const lx = 6, lz = -284; put('white', new THREE.CylinderGeometry(2.2, 3.4, 26, 18), lx, 15, lz); for (let y = 6; y < 26; y += 6) put('red', new THREE.CylinderGeometry(3.4 - y * .05, 3.5 - y * .05, 1.6, 18), lx, 2 + y, lz);
  put('glassL', new THREE.CylinderGeometry(1.8, 1.8, 2.2, 12), lx, 29.2, lz); put('dark', new THREE.ConeGeometry(2.3, 1.6, 12), lx, 31.1, lz);
  G.lh = [lx, 29.2, lz];
  wbox('white', -6, 4.5, -262, 6, 4, 5); wbox('dark', -6, 7, -262, 6.4, .3, 5.4);
}

// ---------------- three
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.15;
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); const FOG = 0x0a0e14; scene.background = new THREE.Color(FOG); scene.fog = new THREE.FogExp2(FOG, .02);
const cam = new THREE.PerspectiveCamera(70, 1, .05, 1200); scene.add(cam);
function resize() { RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0a0c10, .45); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8a9ab8, .35); scene.add(moon, moon.target);
const flash = new THREE.SpotLight(0xffeccc, 0, 45, .44, .6, 1.4); flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = .25; flash.shadow.camera.far = 45; flash.shadow.bias = -.0004; flash.shadow.normalBias = .03; scene.add(flash, flash.target);
const RSPOT = [0, 1, 2, 3].map(() => { const l = new THREE.SpotLight(0xffeccc, 0, 38, .44, .6, 1.4); scene.add(l, l.target); return l; });
const POOL = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffe2b0, 0, 30, 1.4); scene.add(l); return l; });
const FLL = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff2a14, 0, 22, 1.4); scene.add(l); return l; });
const boatL = new THREE.SpotLight(0xf4f8ff, 0, 90, .3, .5, 1.1); scene.add(boatL, boatL.target);
const lhL = new THREE.SpotLight(0xfff6dc, 0, 700, .09, .6, .35); scene.add(lhL, lhL.target);

function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, n) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r * .8; } g.putImageData(im, 0, 0); }
const TX = {}, MAT = {};
function rust(g, w, h, n) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${90 + Math.random() * 50},${40 + Math.random() * 20},${15},${Math.random() * .25})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 18, 0, TAU); g.fill(); } for (let i = 0; i < n / 2; i++) { g.fillStyle = `rgba(60,30,10,${Math.random() * .3})`; const x = Math.random() * w; g.fillRect(x, Math.random() * h, 1 + Math.random() * 2, 10 + Math.random() * 40); } }
function textures() {
  TX.grate = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#2a2c2c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#5a5c58'; g.lineWidth = 3; for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } g.lineWidth = 1.5; for (let i = 0; i <= h; i += 8) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } rust(g, w, h, 30); noiseFill(g, w, h, 20); }));
  TX.plate = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a5254'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2e30'; g.lineWidth = 2; for (let i = 0; i < w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } for (let i = 0; i < h; i += 128) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } g.fillStyle = '#2a2e30'; for (let x = 6; x < w; x += 64) for (let y = 6; y < h; y += 20) g.fillRect(x, y, 3, 3); rust(g, w, h, 80); noiseFill(g, w, h, 20); }));
  TX.wood = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = `rgba(0,0,0,${.1 + Math.random() * .2})`; g.fillRect(x, 0, 3, h); } noiseFill(g, w, h, 30); }));
  TX.hazard = tex(cv(64, 64, (g, w, h) => { g.fillStyle = '#d8a820'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = -64; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); } noiseFill(g, w, h, 30); }));
  TX.cont = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#6a2418'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.cont2 = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#1e4a6a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.rock = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#3c3a36'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '10,10,10' : '100,98,90'},${Math.random() * .2})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, TAU); g.fill(); } noiseFill(g, w, h, 30); }), 3);
  TX.screen = tex(cv(128, 64, (g, w, h) => { g.fillStyle = '#04100a'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a8a50'; for (let y = 6; y < h; y += 7) g.fillRect(6, y, 20 + Math.random() * 90, 2); }));
  TX.paper = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#d6ccb0'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4030'; for (let y = 14; y < h - 10; y += 9) g.fillRect(12, y, 70 + Math.random() * 30, 2); noiseFill(g, w, h, 20); }));
  TX.glow = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  TX.ripple = new THREE.CanvasTexture(cv(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 2 + Math.random() * 4, Math.random() * .4, 0, TAU); g.fill(); } }));
  TX.ripple.wrapS = TX.ripple.wrapT = THREE.RepeatWrapping; TX.ripple.repeat.set(60, 60);
}
const WAVES = [[.42, 34, .8, .3, .95], [.3, 22, 1.1, -.6, .8], [.2, 15, 1.5, .9, .4], [.12, 9, 2.0, -.2, -1]];
function waveH(x, z, t) { let h = 0; for (const [a, l, s, dx, dz] of WAVES) { const k = TAU / l, n = Math.hypot(dx, dz); h += a * Math.sin(k * (x * dx + z * dz) / n + t * s); } return h * G.sea; }
function materials() {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .8, metalness: .2}, o));
  MAT.grate = S({map: TX.grate, metalness: .5, roughness: .6}); MAT.plate = S({map: TX.plate, metalness: .5, roughness: .55, side: THREE.DoubleSide}); MAT.steel = S({color: 0x5a5e60, metalness: .6, roughness: .5});
  MAT.leg = S({map: TX.plate, color: 0xb0a080, metalness: .5}); MAT.yellow = S({color: 0xc8a020, roughness: .6}); MAT.wood = S({map: TX.wood}); MAT.hazard = S({map: TX.hazard});
  MAT.door = S({color: 0x3a4a4a, metalness: .5}); MAT.floorP = S({map: TX.grate, color: 0x9a9a9a}); MAT.glass = S({color: 0x0a1014, roughness: .1, metalness: .4}); MAT.dark = S({color: 0x0b0b0b});
  MAT.fabric = S({color: 0x3a4048, metalness: 0}); MAT.locker = S({color: 0x4a5a5a, metalness: .6, roughness: .45}); MAT.genM = S({color: 0x2a4a3a, metalness: .5}); MAT.panel = S({color: 0x3a3e40, metalness: .5});
  MAT.screen = S({map: TX.screen, emissive: 0x2a8a50, emissiveMap: TX.screen, emissiveIntensity: 0}); MAT.red = S({color: 0x9a1a14}); MAT.pipe = S({color: 0x6a5a40, metalness: .5}); MAT.crate = S({map: TX.wood, color: 0x9a8a6a});
  MAT.cont = S({map: TX.cont}); MAT.cont2 = S({map: TX.cont2}); MAT.orange = S({color: 0xd05a10}); MAT.bulb = S({color: 0x222018, emissive: 0xfff0c0, emissiveIntensity: 0});
  MAT.rock = S({map: TX.rock, metalness: 0, roughness: .95}); MAT.white = S({color: 0xc8c4b8, metalness: 0}); MAT.log = S({color: 0x2a2018, metalness: 0}); MAT.glassL = S({color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.5});
  // the sea: waves in the vertex shader, ripples in a scrolling bump map
  MAT.sea = new THREE.MeshStandardMaterial({color: 0x081218, roughness: .12, metalness: .55, bumpMap: TX.ripple, bumpScale: .6});
  MAT.sea.onBeforeCompile = sh => {
    sh.uniforms.uT = {value: 0}; sh.uniforms.uA = {value: 1}; MAT.sea.userData.sh = sh;
    const W = WAVES.map(([a, l, s, dx, dz]) => { const n = Math.hypot(dx, dz); return `w += vec3(${(a).toFixed(3)} * sin(${(TAU / l).toFixed(4)} * dot(p, vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})) + uT * ${s.toFixed(2)}), ${(a * TAU / l * dx / n).toFixed(4)} * cos(${(TAU / l).toFixed(4)} * dot(p, vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})) + uT * ${s.toFixed(2)}), ${(a * TAU / l * dz / n).toFixed(4)} * cos(${(TAU / l).toFixed(4)} * dot(p, vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})) + uT * ${s.toFixed(2)}));`; }).join('\n');
    sh.vertexShader = 'uniform float uT; uniform float uA;\nvec3 seaW(vec2 p){ vec3 w = vec3(0.);\n' + W + '\n return w * uA; }\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 wpN = (modelMatrix * vec4(position, 1.)).xyz; vec3 sw = seaW(wpN.xz); vec3 objectNormal = normalize(vec3(-sw.y, 1., -sw.z));')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += sw.x;');
  };
}
function mergeGeos(list) {
  let n = 0; const qs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0; for (const q of qs) { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2); o += c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeBoundingSphere(); return g;
}
let SEA = null, RAIN = null;
function buildSea() {
  const g = new THREE.PlaneGeometry(1200, 1200, 200, 200); g.rotateX(-PI / 2);
  SEA = new THREE.Mesh(g, MAT.sea); SEA.receiveShadow = true; SEA.frustumCulled = false; scene.add(SEA);
  // rain streaks around the camera
  const n = 2600, p = new Float32Array(n * 6); for (let i = 0; i < n; i++) { const x = (Math.random() - .5) * 50, y = Math.random() * 30, z = (Math.random() - .5) * 50; p.set([x, y, z, x + .15, y + .7, z + .05], i * 6); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  RAIN = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({color: 0x9aa8b8, transparent: true, opacity: .32, depthWrite: false})); RAIN.frustumCulled = false; scene.add(RAIN);
  // the sky: dark storm dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {uF: {value: 0}},
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform float uF; float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); } float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec3 d = normalize(vD); float y = max(d.y, 0.); float c = n(d.xz/(y+.2)*2.5)*.6 + n(d.xz/(y+.2)*6.)*.4; vec3 col = mix(vec3(.03,.04,.055), vec3(.012,.015,.02), pow(y,.4)); col = mix(col, vec3(.05,.06,.075), smoothstep(.4,.8,c)*.6); col += uF * vec3(.5,.55,.7) * (.4 + c); gl_FragColor = vec4(col,1.); }`}));
  sky.renderOrder = -2; scene.add(sky); scene.userData.sky = sky;
}

// ---------------- boat (host simulates; everyone draws it)
const B = {x: JETTY.x - 2.6, z: JETTY.z + 5, yaw: PI, v: 0, thr: 0, st: 0, driver: null, tx: 0, tz: 0, tyaw: 0, heave: 0, pitch: 0, roll: 0, dyaw: 0};
const BDECK = {x0: -2, x1: 2, z0: -5, z1: 5.2, y: 1.3};
const BW = [];
const BHELM = [0, -2.6];
function bL2W(lx, lz) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw); return [B.x + lx * c + lz * s, B.z - lx * s + lz * c]; }
function bW2L(x, z) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw), dx = x - B.x, dz = z - B.z; return [dx * c - dz * s, dx * s + dz * c]; }
let BOAT = null;
function buildBoat() {
  const g = new THREE.Group(), S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .6, metalness: .2}, o));
  const hullM = S({color: 0x1e3a4a}), whiteM = S({color: 0xc8c8c0}), deckM = S({map: TX.wood, color: 0x8a7a64}), redM = S({color: 0x8a1a14});
  const add = (geo, m, x, y, z, p = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  const sh = new THREE.Shape(); sh.moveTo(-2.1, 5.4); sh.lineTo(2.1, 5.4); sh.lineTo(2.2, -2); sh.quadraticCurveTo(1.6, -5.4, 0, -6.8); sh.quadraticCurveTo(-1.6, -5.4, -2.2, -2); sh.closePath();
  const hg = new THREE.ExtrudeGeometry(sh, {depth: 2.3, bevelEnabled: false}); hg.rotateX(PI / 2); hg.translate(0, 1.3, 0); add(hg, hullM, 0, 0, 0);
  const red = new THREE.ExtrudeGeometry(sh, {depth: .25, bevelEnabled: false}); red.rotateX(PI / 2); red.translate(0, -.6, 0); add(red, redM, 0, 0, 0);
  const dk = new THREE.ShapeGeometry(sh); dk.rotateX(-PI / 2); dk.translate(0, 1.31, 0); add(dk, deckM, 0, 0, 0);
  // wheelhouse: walls with a door at the back
  const wh = (x0, x1, z0, z1, h = 2.2) => { add(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), whiteM, (x0 + x1) / 2, 1.3 + h / 2, (z0 + z1) / 2); BW.push({x0, x1, z0, z1, y0: 0, y1: h}); };
  wh(-1.7, -1.55, -4.2, -1.2); wh(1.55, 1.7, -4.2, -1.2); wh(-1.7, 1.7, -4.35, -4.2, 1); wh(-1.7, -.5, -1.35, -1.2); wh(.5, 1.7, -1.35, -1.2);
  add(new THREE.BoxGeometry(3.6, .12, 3.4), whiteM, 0, 3.55, -2.7); const glass = new THREE.MeshStandardMaterial({color: 0x8ab0c0, roughness: .05, metalness: .2, transparent: true, opacity: .14, depthWrite: false}); add(new THREE.BoxGeometry(3.3, .9, .06), glass, 0, 2.9, -4.25).castShadow = false;
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(.06, .7, 2.2), glass, s * 1.72, 2.8, -2.8).castShadow = false;
  add(new THREE.BoxGeometry(1.4, 1, .5), whiteM, 0, 1.8, -3.9);
  const wheel = add(new THREE.TorusGeometry(.32, .03, 6, 16), S({color: 0x3a2a1a}), BHELM[0], 2.35, BHELM[1] - .4); wheel.rotation.x = -.5; g.userData.wheel = wheel;
  // rails with gates on both sides (z 0.3..2) and at the stern ladder
  const rl = (x0, x1, z0, z1) => { add(new THREE.BoxGeometry(Math.max(.05, x1 - x0), .06, Math.max(.05, z1 - z0)), whiteM, (x0 + x1) / 2, 2.3, (z0 + z1) / 2); BW.push({x0, x1, z0, z1, y0: 0, y1: 1}); for (let t = 0; t <= 1; t += .25) add(new THREE.BoxGeometry(.05, 1, .05), whiteM, mix(x0, x1, t), 1.8, mix(z0, z1, t)); };
  for (const s of [-1, 1]) { rl(s * 2.05 - .03, s * 2.05 + .03, -1.2, .3); rl(s * 2.05 - .03, s * 2.05 + .03, 2, 5.3); }
  rl(-2.05, -.55, 5.3, 5.36); rl(.55, 2.05, 5.3, 5.36);
  for (let y = -.6; y < 1.3; y += .3) add(new THREE.BoxGeometry(.6, .04, .04), whiteM, 0, y, 5.45);
  // bow (sloped, no walking past the wheelhouse front)
  BW.push({x0: -2.2, x1: 2.2, z0: -6.8, z1: -4.3, y0: 0, y1: 2});
  // nav lights + searchlight housing
  const nl = (c, x) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.scale.setScalar(.9); s.position.set(x, 3.7, -2.7); g.add(s); };
  nl(0xff2020, -1.8); nl(0x20ff40, 1.8); add(new THREE.CylinderGeometry(.18, .22, .35, 10), S({color: 0x222}), 0, 3.8, -3.9).rotation.x = PI / 2;
  INTER.push({kind: 'helm', boat: 1, lx: BHELM[0], lz: BHELM[1] - .5, ly: 2.2, r: 2, label: () => P.seat ? 'Let go of the wheel' : 'Take the wheel', on: () => !P.sw && (P.seat || !B.driver)});
  INTER.push({kind: 'ladder', boat: 1, lx: 0, lz: 5.9, ly: 0, r: 3.5, top: 'boat', label: () => 'Climb aboard', on: () => P.sw});
  scene.add(g); BOAT = g;
}
function boatStep(dt) {
  const drv = B.driver && PL.get(B.driver); let thr = 0, st = 0;
  if (drv && drv.seat && !drv.down && !drv.dead) { thr = drv.in ? drv.in[0] : 0; st = drv.in ? drv.in[1] : 0; } else if (B.driver) B.driver = null;
  B.thr = mix(B.thr, thr, Math.min(1, dt * 1.2)); B.st = mix(B.st, st, Math.min(1, dt * 2.5));
  const acc = B.thr > 0 ? B.thr * 2.4 : B.thr * 1.2;
  B.v += (acc - .028 * B.v * Math.abs(B.v) - (Math.abs(B.thr) < .05 ? .25 * B.v : 0)) * dt;
  const yr = -B.st * clamp(B.v / 3.5, -1, 1) * .5; B.yaw += yr * dt;
  B.x += -Math.sin(B.yaw) * B.v * dt; B.z += -Math.cos(B.yaw) * B.v * dt;
  // hull circles vs obstacles
  let hit = 0;
  for (const lz of [-4.6, -1.5, 1.6, 4.4]) {
    const [cx, cz] = bL2W(0, lz), r = 2.15;
    for (const o of OBST) {
      let px, pz, d, nx, nz;
      if (o.c) { px = cx - o.x; pz = cz - o.z; d = Math.hypot(px, pz); if (d >= o.r + r) continue; nx = px / d; nz = pz / d; d = o.r + r - d; }
      else { const qx = clamp(cx, o.x0, o.x1), qz = clamp(cz, o.z0, o.z1); px = cx - qx; pz = cz - qz; const e = Math.hypot(px, pz); if (e >= r) continue; if (e < 1e-4) { nx = 0; nz = -1; d = r; } else { nx = px / e; nz = pz / e; d = r - e; } }
      B.x += nx * d; B.z += nz * d; hit = Math.max(hit, Math.abs(B.v));
    }
  }
  const rr = Math.hypot(B.x, B.z + 120); if (rr > 430) { B.x *= 430 / rr; B.z = (B.z + 120) * 430 / rr - 120; hit = Math.max(hit, Math.abs(B.v)); }
  if (hit) { if (hit > 2.5) emit({k: 'bump', s: Math.min(1, hit / 7)}); B.v *= .4; }
}

// ---------------- navigation grid for the rig creature
const NG = {x0: -24, z0: -24, n: 48, cells: null};
function buildNav() {
  const n = NG.n, L = LV.length; NG.cells = new Uint8Array(L * n * n);
  for (let l = 0; l < L; l++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = NG.x0 + i + .5, z = NG.z0 + j + .5, f = floorAt(x, z, LV[l] + .1, true);
    if (!f || Math.abs(f.y - LV[l]) > .05 || f.s.k !== 'slab') continue;
    let bad = false; for (const w of WALLS) { if (w.y1 < LV[l] + .3 || w.y0 > LV[l] + 1.6) continue; if (x > w.x0 - .45 && x < w.x1 + .45 && z > w.z0 - .45 && z < w.z1 + .45) { bad = true; break; } }
    if (!bad) NG.cells[l * n * n + j * n + i] = 1;
  }
  NG.links = new Map();
  const link = (a, b, via) => { if (a < 0 || b < 0) return; (NG.links.get(a) || NG.links.set(a, []).get(a)).push({to: b, via}); (NG.links.get(b) || NG.links.set(b, []).get(b)).push({to: a, via: via.slice().reverse()}); };
  for (const s of SURF) if (s.k === 'ramp') {
    const la = LV.indexOf(s.y0), lb = LV.indexOf(s.y1); if (la < 0 || lb < 0) continue;
    const pts = []; let a, b;
    if (s.ax === 'x+') { const z = (s.z0 + s.z1) / 2; a = nodeNear(s.x0 - .8, z, la, 3); b = nodeNear(s.x1 + .8, z, lb, 3); for (let t = 0; t <= 1; t += .25) pts.push([mix(s.x0, s.x1, t), z]); }
    else { const x = (s.x0 + s.x1) / 2; a = nodeNear(x, s.z0 - .8, la, 3); b = nodeNear(x, s.z1 + .8, lb, 3); for (let t = 0; t <= 1; t += .25) pts.push([x, mix(s.z0, s.z1, t)]); }
    link(a, b, pts);
  }
}
const nIdx = (l, i, j) => l * NG.n * NG.n + j * NG.n + i;
const nPos = k => { const n = NG.n, l = Math.floor(k / (n * n)), r = k % (n * n), j = Math.floor(r / n), i = r % n; return [NG.x0 + i + .5, NG.z0 + j + .5, l]; };
function nodeNear(x, z, l, rad = 6) {
  const n = NG.n, ci = Math.floor(x - NG.x0), cj = Math.floor(z - NG.z0); let best = -1, bd = 1e9;
  for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(l, i, j); if (!NG.cells[k]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; } }
  return best;
}
function levelOf(y) { let b = 0, bd = 1e9; for (let l = 0; l < LV.length; l++) { const d = Math.abs(y - LV[l]); if (d < bd) { bd = d; b = l; } } return b; }
function astar(s, g) {
  if (s < 0 || g < 0) return null; if (s === g) return [s];
  const n = NG.n, open = [s], came = new Map(), gs = new Map([[s, 0]]), closed = new Set(); const [gx, gz, gl] = nPos(g);
  const hh = k => { const [x, z, l] = nPos(k); return Math.hypot(x - gx, z - gz) + Math.abs(l - gl) * 10; };
  const fs = new Map([[s, hh(s)]]); let it = 0;
  while (open.length && it++ < 9000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (fs.get(open[i]) < fs.get(open[bi])) bi = i;
    const c = open.splice(bi, 1)[0]; if (c === g) { const path = [c]; let k = c; while (came.has(k)) { k = came.get(k); path.unshift(k); } return path; }
    closed.add(c); const [cx, cz, cl] = nPos(c), ci = Math.floor(cx - NG.x0), cj = Math.floor(cz - NG.z0);
    const nb = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(cl, i, j); if (!NG.cells[k]) continue; if (di && dj && (!NG.cells[nIdx(cl, ci + di, cj)] || !NG.cells[nIdx(cl, ci, cj + dj)])) continue; nb.push([k, Math.hypot(di, dj)]); }
    for (const lk of NG.links.get(c) || []) nb.push([lk.to, 12]);
    for (const [k, w] of nb) { if (closed.has(k)) continue; const t = gs.get(c) + w; if (t < (gs.get(k) ?? 1e9)) { came.set(k, c); gs.set(k, t); fs.set(k, t + hh(k)); if (!open.includes(k)) open.push(k); } }
  }
  return null;
}
function navPath(fx, fy, fz, tx, ty, tz) {
  const s = nodeNear(fx, fz, levelOf(fy)), g = nodeNear(tx, tz, levelOf(ty), 10); const p = astar(s, g); if (!p) return null;
  const out = []; for (let i = 0; i < p.length; i++) { const a = p[i]; out.push(nPos(a)); if (i < p.length - 1) { const lk = (NG.links.get(a) || []).find(q => q.to === p[i + 1]); if (lk) for (const v of lk.via) out.push([v[0], v[1], -1]); } }
  // shortcut straight runs on one level
  const sm = [out[0]]; let i = 0;
  while (i < out.length - 1) { let j = i + 1; while (j + 1 < out.length && out[j + 1][2] === out[i][2] && out[i][2] >= 0 && clearLine(out[i][0], out[i][1], out[j + 1][0], out[j + 1][1], LV[out[i][2]] + 1)) j++; sm.push(out[j]); i = j; }
  sm.push([tx, tz, levelOf(ty)]);
  return sm;
}
function clearLine(ax, az, bx, bz, y) { for (const w of WALLS) { if (w.y1 < y - .7 || w.y0 > y + .5) continue; if (segRect(ax, az, bx, bz, {x0: w.x0 - .35, x1: w.x1 + .35, z0: w.z0 - .35, z1: w.z1 + .35})) return false; } return true; }

// ---------------- physics helpers
function floorAt(x, z, y, noBoat) {
  let best = null;
  for (const s of SURF) { if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue; const h = s.k === 'slab' ? s.y : rampY(s, x, z); if (h <= y + .75 && (!best || h > best.y)) best = {y: h, s}; }
  if (!noBoat && BOAT) { const [lx, lz] = bW2L(x, z); if (lx > BDECK.x0 && lx < BDECK.x1 && lz > BDECK.z0 && lz < BDECK.z1) { const h = BDECK.y; if (h <= y + .75 && (!best || h > best.y)) best = {y: h, s: {k: 'boat'}}; } }
  return best;
}
function segRect(ax, az, bx, bz, r) { let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az; for (const [p, d, lo, hi] of [[ax, dx, r.x0, r.x1], [az, dz, r.z0, r.z1]]) { if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; } let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false; } return true; }
function pushRects(o, r, list, y0, y1) {
  for (const w of list) {
    if (w.y1 < y0 || w.y0 > y1) continue;
    if (o.x < w.x0 - r || o.x > w.x1 + r || o.z < w.z0 - r || o.z > w.z1 + r) continue;
    const cx = clamp(o.x, w.x0, w.x1), cz = clamp(o.z, w.z0, w.z1), dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) { o.x = cx + dx / d * r; o.z = cz + dz / d * r; } }
    else { const l = o.x - w.x0, rr = w.x1 - o.x, t = o.z - w.z0, b = w.z1 - o.z, m = Math.min(l, rr, t, b); if (m === l) o.x = w.x0 - r; else if (m === rr) o.x = w.x1 + r; else if (m === t) o.z = w.z0 - r; else o.z = w.z1 + r; }
  }
}
function pushBody(o, r, y) {
  pushRects(o, r, WALLS, y + .2, y + 1.7);
  for (const c of OBST) if (c.c) { const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz); if (d < c.r - .5 + r && d > 1e-4 && y < 25) { o.x = c.x + dx / d * (c.r - .5 + r); o.z = c.z + dz / d * (c.r - .5 + r); } }
  if (BOAT && Math.hypot(o.x - B.x, o.z - B.z) < 9) { const [lx, lz] = bW2L(o.x, o.z), q = {x: lx, z: lz}; pushRects(q, r, BW, y - BDECK.y + .2, y - BDECK.y + 1.7); if (q.x !== lx || q.z !== lz) { const [wx, wz] = bL2W(q.x, q.z); o.x = wx; o.z = wz; } }
}
function seeLine(ax, ay, az, bx, by, bz) {
  if (Math.abs(ay - by) > 3.8) return false;
  const h = (ay + by) / 2 + 1.3;
  for (const w of WALLS) { if (!w.see || w.y0 > h || w.y1 < h) continue; if (segRect(ax, az, bx, bz, w)) return false; }
  // the upper deck slab blocks sight between the main deck and the top
  return true;
}

// ---------------- creature (the thing on the rig)
const MON = new THREE.Group(), MJ = {};
function buildCreature() {
  const skin = new THREE.MeshLambertMaterial({color: 0x07090a}), pale = new THREE.MeshLambertMaterial({color: 0x56605c}), hole = new THREE.MeshBasicMaterial({color: 0}), eye = new THREE.MeshBasicMaterial({color: 0x9affe0});
  const cap = (r, l) => { const g = new THREE.CapsuleGeometry(r, l, 4, 8); g.translate(0, -l / 2 - r * .4, 0); return g; };
  const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
  const hips = new THREE.Group(); hips.position.y = 1.45; MON.add(hips); MJ.hips = hips;
  const torso = new THREE.Group(); hips.add(torso); MJ.torso = torso;
  const tg = new THREE.CapsuleGeometry(.17, .8, 4, 10); tg.scale(1.1, 1, .7); tg.translate(0, .55, 0); torso.add(mesh(tg, skin));
  for (let i = 0; i < 7; i++) { const m = mesh(new THREE.SphereGeometry(.035, 6, 4), skin); m.position.set(0, .25 + i * .11, -.13); torso.add(m); }
  for (let i = 0; i < 9; i++) { const k = mesh(new THREE.CylinderGeometry(.006, .01, .5 + Math.random() * .4, 3), pale); k.position.set((Math.random() - .5) * .3, .2 + Math.random() * .6, (Math.random() - .5) * .2); k.rotation.set(Math.random() - .5, 0, Math.random() - .5); torso.add(k); } // kelp strands
  const neck = new THREE.Group(); neck.position.y = 1.08; torso.add(neck); MJ.neck = neck; neck.add(mesh(cap(.045, .3).translate(0, .38, 0), skin));
  const head = new THREE.Group(); head.position.set(0, .38, .02); neck.add(head); MJ.head = head;
  const hg = new THREE.SphereGeometry(.14, 16, 12); hg.scale(.8, 1.6, .9); hg.translate(0, .14, .02); head.add(mesh(hg, pale));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 6), hole); e.scale.set(1, 1.2, .5); e.position.set(s * .05, .2, .115); head.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(.012, 6, 4), eye); p.position.set(s * .05, .198, .13); head.add(p); }
  const mo = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 6), hole); mo.scale.set(.6, 2.2, .4); mo.position.set(0, -.02, .118); head.add(mo); MJ.mouth = mo;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .25, .98, 0); torso.add(sh); MJ['sh' + s] = sh; sh.add(mesh(cap(.045, .72), skin));
    const el = new THREE.Group(); el.position.y = -.84; sh.add(el); MJ['el' + s] = el; el.add(mesh(cap(.036, .78), skin));
    const hand = new THREE.Group(); hand.position.y = -.9; el.add(hand); for (let f = 0; f < 4; f++) { const fg = mesh(cap(.01, .28), pale); fg.position.set((f - 1.5) * .02, 0, .01); fg.rotation.z = (f - 1.5) * .12; hand.add(fg); }
    const hip = new THREE.Group(); hip.position.set(s * .12, 0, 0); hips.add(hip); MJ['hp' + s] = hip; hip.add(mesh(cap(.06, .62), skin));
    const kn = new THREE.Group(); kn.position.y = -.74; hip.add(kn); MJ['kn' + s] = kn; kn.add(mesh(cap(.045, .62), skin));
    const ft = mesh(new THREE.BoxGeometry(.07, .04, .24), skin); ft.position.set(0, -.74, .07); kn.add(ft);
  }
  scene.add(MON);
}
function animCreature(dt, st, spd) {
  const k = clamp(spd / 5, 0, 1.3), four = st === 'chase' && spd > 2.5;
  M.ph += dt * (2.2 + spd * (four ? 1.5 : 1.25)); M.four = mix(M.four || 0, four ? 1 : 0, Math.min(1, dt * 5));
  const s = Math.sin(M.ph), c = Math.cos(M.ph), q = M.four;
  for (const g of [-1, 1]) { const sw = s * g;
    MJ['hp' + g].rotation.x = mix(-sw * .55 * k - .05, -1.2 + sw * .7, q); MJ['kn' + g].rotation.x = mix(Math.max(0, g * c + .3) * .9 * k + .08, 1.3 + Math.max(0, g * c) * .6, q);
    MJ['sh' + g].rotation.x = mix(sw * .35 * k + .05, -1.75 - sw * .8, q); MJ['sh' + g].rotation.z = g * mix(.08, .18, q); MJ['el' + g].rotation.x = mix(-.15 - k * .2, -.25 + Math.max(0, -g * c) * .5, q); }
  MJ.hips.position.y = mix(1.45 + Math.abs(c) * .05 * k, .95 + Math.abs(s) * .12, q); MJ.torso.rotation.x = mix(.25 + k * .2 + (st === 'search' && M.chkT > 0 ? .4 : 0), 1.25, q);
  M.jit -= dt; if (M.jit < 0) { M.jit = .15 + Math.random() * 1.2; M.jr = (Math.random() - .5) * (st === 'chase' ? 1.2 : .6); }
  MJ.head.rotation.z = mix(MJ.head.rotation.z, M.jr, dt * 18); MJ.neck.rotation.x = mix(-.3 - k * .1 + (M.look || 0), -1.15, q);
  MJ.mouth.scale.y = 2.2 + (st === 'chase' ? 1.6 + Math.sin(performance.now() / 33) * .3 : 0);
  MON.position.set(M.x, M.y, M.z); MON.rotation.y = M.yaw;
}

// ---------------- crew avatars
function buildCrew(col) {
  const g = new THREE.Group(), j = {};
  const vest = new THREE.MeshStandardMaterial({color: col, roughness: .7}), coat = new THREE.MeshStandardMaterial({color: 0x2a2e30, roughness: .6, metalness: .1}), skin = new THREE.MeshStandardMaterial({color: 0xb08a6a, roughness: .8}), hood = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .5});
  const m = (geo, mat, x, y, z, p = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  const body = new THREE.Group(); body.position.y = .95; g.add(body); j.body = body;
  m(new THREE.CapsuleGeometry(.21, .42, 4, 8), hood, 0, .32, 0, body); m(new THREE.BoxGeometry(.46, .38, .3), vest, 0, .42, 0, body);
  const hd = new THREE.Group(); hd.position.y = .74; body.add(hd); j.head = hd; m(new THREE.SphereGeometry(.12, 12, 10), skin, 0, .02, 0, hd); m(new THREE.SphereGeometry(.14, 12, 8, 0, TAU, 0, 1.6), hood, 0, .04, -.02, hd);
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * .1, .95, 0); g.add(leg); j['l' + s] = leg; m(new THREE.CapsuleGeometry(.075, .72, 4, 8), coat, 0, -.47, 0, leg);
    const arm = new THREE.Group(); arm.position.set(s * .27, .55, 0); body.add(arm); j['a' + s] = arm; m(new THREE.CapsuleGeometry(.06, .5, 4, 8), hood, 0, -.3, 0, arm);
  }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 20, 1, true), new THREE.MeshBasicMaterial({color: 0xfff0d0, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false}));
  beam.geometry.translate(0, -7, 0); beam.geometry.rotateX(PI / 2); beam.position.set(0, -.6, -.15); j.a1.add(beam); j.beam = beam;
  g.userData = j; scene.add(g); return g;
}
function animCrew(p, dt) {
  const g = p.av, j = g.userData; g.visible = !p.dead && !p.esc && p.hd < 0 && p.ready && !p.drowned; if (!g.visible) return;
  g.position.set(p.rx, p.ry + (p.sw ? -1.1 : 0), p.rz); g.rotation.y = p.ryaw;
  p.anim = (p.anim || 0) + dt * p.rspd * 2.2; const s = Math.sin(p.anim) * clamp(p.rspd / 3, 0, 1);
  j.l1.rotation.x = s * .6; j['l-1'].rotation.x = -s * .6; j['a-1'].rotation.x = p.sw ? -2.5 + Math.sin(G.t * 4) : -s * .5; j.a1.rotation.x = -.6 - p.rpitch * .8;
  j.body.rotation.x = p.cr ? .35 : 0; j.body.position.y = p.cr ? .7 : .95;
  if (p.down) { g.rotation.x = -PI / 2 + .15; g.position.y += .25; } else g.rotation.x = 0;
  j.head.rotation.x = -p.rpitch * .5; j.beam.visible = !!p.l && !p.down && !p.sw;
}

// ---------------- state
const G = {wt: 0, on: false, over: false, t: 0, ph: 0, seed: 1, evq: [], holdP: {}, flares: [], msgT: 0, noteOpen: false, map: false, paused: false, spec: 0, sea: 1, power: false, lightT: 8};
const PL = new Map(); let P = null;
const M = {x: 0, z: 0, y: LV[2], yaw: 0, state: 'roam', path: [], rep: 0, goal: null, spd: 0, ph: 0, jit: 0, jr: 0, aware: 0, lostT: 0, idle: 0, flee: 0, sawHide: -1, chk: [], chkT: 0, stuck: 0, sx: 0, sz: 0, screamT: 0, look: 0, seenAt: -99, tgt: null, preyT: 0, prey: null, vy: 0, wet: 0};
function mkPlayer(id, name, c) { return {id, name, c, x: 0, z: 0, y: BDECK.y, yaw: 0, pitch: 0, cr: 0, l: 1, run: 0, h: '', hd: -1, hb: 0, down: false, bleed: 0, dead: false, esc: false, ready: false, sd: 0, lx: 0, lz: 0, spd: 0, rx: 0, ry: 0, rz: 0, ryaw: 0, rpitch: 0, rspd: 0, av: null, tag: null, heat: 0, ob: 0, bl: [0, 0], sw: 0, swT: 0, seat: 0, in: [0, 0]}; }
function ensurePlayer(id, name, c) { let p = PL.get(id); if (!p) { p = mkPlayer(id, name, c); PL.set(id, p); } p.name = name; p.c = c; if (!p.av) { p.av = buildCrew(CREW_COL[c % 6]); const t = document.createElement('div'); t.className = 'tag'; $('tags').appendChild(t); p.tag = t; } return p; }
function syncCrew(crew) { const ids = new Set(crew.map(c => c.id)); for (const [id, p] of PL) if (!ids.has(id)) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); PL.delete(id); if (B.driver === id) B.driver = null; } for (const c of crew) ensurePlayer(c.id, c.name, c.c); P = PL.get(myId()); }
const alive = () => [...PL.values()].filter(p => p.ready && !p.down && !p.dead && !p.esc);
const onRig = p => !p.ob && !p.sw && p.y > 1;

// ---------------- items
function itemMesh(kind) {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .5}, o)); const g = new THREE.Group();
  if (kind === 'battery') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .1, 10), S({color: 0x2a5a2a, metalness: .4})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'flare') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .26, 8), S({color: 0xb0201a, emissive: 0x300000})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'note') { const n = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), S({map: TX.paper, side: THREE.DoubleSide, roughness: 1})); n.rotation.x = -PI / 2; g.add(n); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}
const ITEMS = [];
const NOTES = [
  'DRILL LOG, STATION NINE\n\n03:10 Bit dropped into a void at 3,100 m. Pressure fell to nothing.\n03:40 Mud returns warm. Smells like a fish market.\n04:15 Something on the drill floor camera. Climbing the pipe.\n04:16 Camera down.',
  'Whoever reads this,\n\nBoth fuel valves are shut, one on the dock and one on the main deck under the top deck. The generator will not turn over until they are open.\n\nIt hears the valves. It hears everything.',
  'Mikkel saw it hanging off the derrick upside down. It came down the crane like a spider.\n\nIt goes for whoever is on their own. We stopped splitting up. Then we stopped being enough to stay together.',
  'Do NOT go in the water. There is something under the rig, much bigger. It took the supply boat\'s lines and pulled the whole stern under.\n\nThe flares in the lifeboat station keep the small one back. Nothing keeps the big one back.',
  'MAYDAY drafted, never sent.\nRadio is in the control room, top deck.\nIt needs the generator running.\n\nIf you send it, they will tell you to get off the rig. Do it. Do not wait for anyone who is not at the boat.',
];
function placeItems() {
  for (const it of ITEMS) scene.remove(it.mesh); ITEMS.length = 0;
  const pool = SPOTS.slice().sort(() => WR() - .5), take = pred => { const i = pool.findIndex(pred); return i >= 0 ? pool.splice(i, 1)[0] : null; };
  const nt = [take(s => s.tag === 'dock' || s.tag === 'crate'), take(s => s.tag === 'bench'), take(s => s.tag === 'table' || s.tag === 'bunk'), take(s => s.tag === 'lifeboat'), take(s => s.tag === 'desk')];
  nt.forEach((s, i) => { if (s) addItem('note', s, {text: NOTES[i]}); });
  const lb = SPOTS.find(s => s.tag === 'lifeboat'); if (lb) addItem('flare', {x: lb.x + .3, y: lb.y, z: lb.z + .5});
  for (let k = 0; k < 4 && pool.length; k++) addItem('battery', pool.pop());
  for (let k = 0; k < 2 && pool.length; k++) addItem('flare', pool.pop());
}
function addItem(kind, s, extra = {}) { const m = itemMesh(kind); m.position.set(s.x, s.y + .03, s.z); m.rotation.y = WR() * TAU; const it = Object.assign({kind, mesh: m, x: s.x, y: s.y, z: s.z, taken: false, i: ITEMS.length}, extra); ITEMS.push(it); return it; }
function hideTaken(h) { for (const p of PL.values()) if (p.hd === h.i && p !== P) return true; return false; }

// ---------------- audio
const A = {ctx: null, on: false};
function aInit() {
  if (A.ctx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const c = A.ctx = new C(); A.out = c.createGain(); A.out.gain.value = .9; const comp = c.createDynamicsCompressor(); A.out.connect(comp); comp.connect(c.destination);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
  const loop = (f, q, g0, type = 'bandpass') => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl); fl.connect(g); s.start(); return {s, f: fl, g}; };
  const pan = (ref, roll) => { const p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 400}); p.connect(A.out); return p; };
  A.rain = loop(3500, .3, .05, 'highpass'); A.rain.g.connect(A.out);
  A.wind = loop(420, .6, .06); A.wind.g.connect(A.out);
  A.surf = loop(300, .5, .08, 'lowpass'); A.surf.g.connect(A.out);
  A.mPan = pan(2.5, 1.4); A.mBreath = loop(260, 3, 0); A.mBreath.g.connect(A.mPan);
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 46; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 220; const sg = c.createGain(); sg.gain.value = 0; saw.connect(sf); sf.connect(sg); sg.connect(A.mPan); saw.start(); A.mGrowl = sg; A.mSaw = saw;
  const dg = c.createGain(); dg.gain.value = 0; dg.connect(A.out); A.drone = dg; const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 300; df.connect(dg); A.droneF = df;
  for (const f of [55, 58.3, 82.4, 110.6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.connect(df); x.start(); }
  A.bPan = pan(5, 1); const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 40; const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300; const eg = c.createGain(); eg.gain.value = .12; eng.connect(ef); ef.connect(eg); eg.connect(A.bPan); eng.start(); A.eng = eng; A.engG = eg; A.engF = ef;
  A.gPan = pan(4, 1.2); const gen = c.createOscillator(); gen.type = 'sawtooth'; gen.frequency.value = 50; const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180; const gg = c.createGain(); gg.gain.value = 0; gen.connect(gf); gf.connect(gg); gg.connect(A.gPan); gen.start(); A.genG = gg;
  A.aPan = pan(10, .8); const al = c.createOscillator(); al.type = 'square'; al.frequency.value = 600; const ag = c.createGain(); ag.gain.value = 0; al.connect(ag); ag.connect(A.aPan); al.start(); A.alarm = al; A.alarmG = ag;
  A.on = true;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1) { if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); env(g, t, .005, peak, dec); s.connect(fl); fl.connect(g); g.connect(dest || A.out); s.start(t, Math.random()); s.stop(t + dec + .1); }
function tone(f, peak, dec, type = 'sine', dest, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
function at(x, y, z, ref = 3) { if (!A.on) return null; const p = A.ctx.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.1}); setPan(p, x, y, z); p.connect(A.out); setTimeout(() => p.disconnect(), 5000); return p; }
function setPan(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
const Snd = {
  step(metal, k, wet) { if (wet) { burst(700, .5, .1 * k, .25, 'bandpass', null, .7); return; } if (metal) { burst(2200, 4, .05 * k, .08); tone(320 + Math.random() * 60, .02 * k, .08, 'triangle'); } else burst(600, 1.2, .06 * k, .09); },
  rStep(x, y, z, k) { const p = at(x, y, z, 2); if (p) burst(1800, 3, .05 * k, .08, 'bandpass', p); },
  mStep(k) { burst(160, 1, .35 * k, .16, 'lowpass', A.mPan); tone(140, .05 * k, .2, 'triangle', A.mPan); },
  heart(k) { tone(58, .25 * k, .12); setTimeout(() => tone(52, .18 * k, .14), 170); },
  pickup() { tone(660, .05, .25); setTimeout(() => tone(990, .04, .3), 90); },
  click() { burst(3000, 3, .05, .02); },
  stinger() { for (const f of [233, 247, 311, 466]) tone(f, .06, 1.6, 'sawtooth'); burst(3000, .4, .25, 1.4, 'highpass'); },
  scream(dest) { for (const f of [520, 560, 790]) tone(f, .22, 1.2, 'sawtooth', dest, f * .4); burst(1800, .5, .9, 1.4, 'bandpass', dest); },
  creak() { tone(90, .06, .7, 'sawtooth', A.mPan, 60); burst(700, 6, .1, .6, 'bandpass', A.mPan, .4); },
  metal(p) { tone(180 + Math.random() * 300, .05, 2.5, 'triangle', p, 120); burst(500, 8, .04, 2, 'bandpass', p, .3); },
  gasp() { burst(1300, 1.5, .25, .45); },
  flare(p) { burst(2500, .5, .3, 1.2, 'highpass', p); },
  valve(p) { tone(1200 + Math.random() * 400, .03, .4, 'sawtooth', p, 900); },
  thunder(k) { burst(90, .5, .9 * k, 3.5, 'lowpass', null, .5); burst(300, .5, .4 * k, 1.5, 'lowpass', null, .7); },
  splash(p) { burst(900, .5, .5, .8, 'bandpass', p, .6); },
  ram() { burst(70, 1, 1, 1.5, 'lowpass', null, .4); tone(45, .6, 1.2, 'sine'); burst(1500, .5, .25, 1, 'bandpass', null, .6); },
  deep() { tone(32, .5, 3, 'sawtooth', null, 24); burst(200, 1, .3, 2.5, 'lowpass', null, .3); },
  bubbles() { for (let i = 0; i < 6; i++) setTimeout(() => tone(500 + Math.random() * 500, .05, .08, 'sine', null, 1200), i * 90); },
  whistle(p) { tone(2600, .12, .5, 'sine', p, 2900); setTimeout(() => tone(2900, .1, .6, 'sine', p, 2400), 380); },
  horn(p) { tone(110, .25, 2.2, 'sawtooth', p); tone(112, .2, 2.2, 'sawtooth', p); },
  hurt(p) { burst(500, 1, .5, .5, 'lowpass', p); tone(160, .2, .5, 'sawtooth', p, 70); },
  revive() { tone(440, .06, .3); setTimeout(() => tone(660, .06, .4), 140); },
  power() { tone(60, .3, 3, 'sawtooth', null, 120); burst(400, .5, .5, 1.5, 'lowpass'); },
};
function say(txt, who) { showMsg(txt, who, 4 + txt.length * .05); }

// ---------------- UI helpers
function showMsg(txt, who, dur = 4) { $('msg').innerHTML = (who ? `<b>${who}</b>` : '') + txt; $('msg').style.opacity = 1; G.msgT = dur; }
function objText() {
  switch (G.ph) {
    case 0: return 'Take the boat out to Station Nine. Someone take the wheel at the front of the wheelhouse (E).';
    case 1: return `Tie up at the rig dock and climb up. Open both fuel valves (${VALVES.filter(v => v.open).length} of 2): one on the dock, one on the main deck under the top deck.`;
    case 2: return 'Start the generator in the generator room on the main deck.';
    case 3: return 'Climb to the top deck. Radio for help from the control room.';
    case 4: return 'Everyone back to the boat! Sail for the lighthouse jetty. Whoever is not aboard stays behind.';
  }
  return '';
}

// ---------------- creature senses + brain (host)
function eyeDir(p) { return [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)]; }
function beamHits(p, x, y, z) { const ey = p.y + 1.55, dx = x - p.x, dy = y - ey, dz = z - p.z, d = Math.hypot(dx, dy, dz), f = eyeDir(p); return (dx * f[0] + dy * f[1] + dz * f[2]) / d > Math.cos(.4); }
function seesP(p) {
  if (p.hd >= 0 || !p.ready || p.down || p.dead || p.esc || p.sw) return 0;
  const dx = p.x - M.x, dz = p.z - M.z, d = Math.hypot(dx, dz);
  let range = D.sight * (p.l ? 1 : .42) * (p.cr ? .65 : 1) * (p.spd < .3 ? .75 : 1);
  if (G.power && onRig(p)) range = Math.max(range, D.sight * .85);
  const beam = p.l && d < 40 && beamHits(p, M.x, M.y + 2, M.z); if (beam) range = Math.max(range, 40);
  if (d > range) return 0;
  const fa = Math.atan2(-dx, -dz); if (d > 3.5 && !beam && Math.abs(angD(M.yaw, fa)) > 1.25) return 0;
  if (!seeLine(M.x, M.y, M.z, p.x, p.y, p.z)) return 0;
  return clamp(1.4 - d / range, .1, 1.4) * (beam ? 1.6 : 1);
}
function pSeesMon(p) {
  const ey = p.y + 1.55, dx = M.x - p.x, dz = M.z - p.z, d = Math.hypot(dx, dz), f = eyeDir(p), dy = M.y + 1.8 - ey;
  const dot = (dx * f[0] + dy * f[1] + dz * f[2]) / Math.hypot(dx, dy, dz);
  if (dot < .8 || !seeLine(p.x, p.y, p.z, M.x, M.y, M.z)) return 0;
  return (p.l && d < 36 && dot > Math.cos(.42)) || d < 10 || (G.power && d < 25) ? 1 : d < 18 ? .5 : 0;
}
function noise(x, y, z, r) {
  if (!isHost()) return;
  r *= D.hear; const d = Math.hypot(x - M.x, z - M.z) + Math.abs(y - M.y) * 1.5;
  if (d > r || M.state === 'chase' || M.state === 'flee') return;
  if (Math.hypot(x, z) > 40) return; // it does not leave the rig to chase sounds at sea
  M.state = 'inv'; M.idle = 0; goTo(x + (CR() - .5) * d * .1, y, z + (CR() - .5) * d * .1); M.invZone = zoneOf(x, z, y);
}
function goTo(x, y, z) { M.goal = [x, y, z]; const p = navPath(M.x, M.y, M.z, x, y, z); M.path = p ? p.map(q => [q[0], q[1]]) : [[x, z]]; }
function moveAlong(dt, speed) {
  while (M.path.length && Math.hypot(M.path[0][0] - M.x, M.path[0][1] - M.z) < (M.path.length > 1 ? .5 : .3)) M.path.shift();
  if (!M.path.length) { M.spd = mix(M.spd, 0, dt * 6); return true; }
  const [wx, wz] = M.path[0], dx = wx - M.x, dz = wz - M.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz); M.yaw += clamp(angD(M.yaw, want), -dt * 7, dt * 7);
  M.spd = mix(M.spd, speed * (1 - Math.min(.6, Math.abs(angD(M.yaw, want)) / PI)), dt * 3);
  const st = Math.min(d, M.spd * dt); M.x += dx / d * st; M.z += dz / d * st;
  pushBody(M, .32, M.y); return false;
}
function randNode(near, r) { for (let k = 0; k < 40; k++) { const l = Math.floor(CR() * LV.length), i = Math.floor(CR() * NG.n), j = Math.floor(CR() * NG.n), id = nIdx(l, i, j); if (!NG.cells[id]) continue; const [x, z] = nPos(id); if (near && Math.hypot(x - near.x, z - near.z) + Math.abs(LV[l] - near.y) > r) continue; return [x, LV[l], z]; } return null; }
function pickRoam() {
  const prey = PL.get(M.prey); const q = prey && onRig(prey) && !prey.down ? randNode(prey, D.roam * (M.avoidT > 0 ? 2 : 1)) : randNode(null);
  if (q) { if (M.avoidT > 0 && alive().some(p => Math.hypot(p.x - q[0], p.z - q[2]) < 14)) return; goTo(q[0], q[1], q[2]); }
}
function downPlayer(p, how) {
  if (p.down || p.dead) return; p.down = true; p.bleed = D.bleed; p.hd = -1; p.seat = 0; if (B.driver === p.id) B.driver = null;
  emit({k: 'down', id: p.id, how}); M.state = 'flee'; M.flee = D.down; M.tgt = null; M.sawHide = -1; M.aware = 0;
  const q = randNode(null); if (q) goTo(q[0], q[1], q[2]);
}
function stepCreature(dt) {
  // gravity / the sea
  const f = floorAt(M.x, M.z, M.y);
  if (f && M.y - f.y < .8) { M.y = mix(M.y, f.y, Math.min(1, dt * 12)); M.vy = 0; } else { M.vy -= 20 * dt; M.y += M.vy * dt; if (f && M.y < f.y) { M.y = f.y; M.vy = 0; } }
  if (M.y < -.5) { M.wet += dt; M.spd = 0; if (M.wet > 3) { M.wet = 0; const n = randNode(null); if (n) { M.x = n[0]; M.y = n[1]; M.z = n[2]; M.path = []; M.state = 'roam'; emit({k: 'snd', s: 'creak'}); } } return; }
  M.avoidT = (M.avoidT || 0) - dt;
  const ps = alive(); if (!ps.length) { M.spd = 0; return; }
  let tgt = M.tgt && PL.get(M.tgt); if (tgt && (tgt.down || tgt.dead || tgt.esc || tgt.sw)) { tgt = null; M.tgt = null; }
  const dOf = p => Math.hypot(p.x - M.x, p.z - M.z) + Math.abs(p.y - M.y);
  M.preyT -= dt; if (M.preyT <= 0) { M.preyT = 20; let best = null, bv = -1; for (const p of ps) { if (!onRig(p)) continue; let m = 1e9; for (const q of ps) if (q !== p) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(p.y - q.y)); if (ps.length === 1) m = 0; const v = m + p.heat * 20 + CR() * 8; if (v > bv) { bv = v; best = p; } } M.prey = best ? best.id : null; }
  for (const p of PL.values()) p.heat = Math.max(0, p.heat - dt * .05);
  for (const fl of G.flares) if (fl.t > 0 && Math.hypot(fl.x - M.x, fl.z - M.z) < 9.5 && Math.abs(fl.y - M.y) < 4 && M.state !== 'flee') { M.state = 'flee'; M.flee = 6; M.tgt = null; const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); emit({k: 'snd', s: 'creak'}); break; }
  M.senseT = (M.senseT || 0) - dt;
  if (M.senseT <= 0) { M.senseT = .12; let bs = 0, bp = null; for (const p of ps) { const s = seesP(p) * (p.id === M.prey ? 1.25 : 1); if (s > bs) { bs = s; bp = p; } } M.see = bs; M.seeP = bp ? bp.id : null; }
  const see = M.state === 'flee' ? 0 : M.see, seeP = PL.get(M.seeP);
  if (see > 0) M.aware = Math.min(1.5, M.aware + dt * see / D.react); else M.aware = Math.max(0, M.aware - dt * .25);
  if (see > 0 && seeP && (M.aware >= 1 || dOf(seeP) < 5)) {
    if (M.state !== 'chase') { M.state = 'chase'; if (G.t - M.screamT > 9) { M.screamT = G.t; emit({k: 'snd', s: 'stinger'}); } }
    if (!tgt || tgt.id === seeP.id || dOf(seeP) < dOf(tgt) - 6) tgt = seeP;
    M.tgt = tgt.id; M.lx = tgt.x; M.ly = tgt.y; M.lz = tgt.z; M.lostT = 0; M.seenAt = G.t; M.sawHide = -1;
  }
  let speed = 1.7; const prog = (G.power ? .08 : 0) + (G.ph >= 4 ? .08 : 0);
  switch (M.state) {
    case 'roam': {
      if (!M.path.length) { M.idle -= dt; M.look = Math.sin(G.t * 1.3) * .3; if (M.idle <= 0) { pickRoam(); M.idle = 1.5 + CR() * 4; } }
      speed = (M.avoidT > 0 ? 2.6 : 1.7) + prog * 4; break;
    }
    case 'inv': { speed = 3.1 + prog * 5; if (moveAlong(dt, speed)) { if (M.invZone >= 0 && BLD[M.invZone].hides.length) { startSearch(M.invZone); break; } M.idle += dt; M.look = Math.sin(G.t * 2) * .5; if (M.idle > 3.5) { M.state = 'roam'; M.idle = 1; M.avoidT = 10; } } return finish(dt); }
    case 'chase': {
      speed = D.chase * (1 + prog);
      if (!tgt) { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx, M.ly, M.lz); break; }
      if (tgt.hd >= 0 && M.sawHide === tgt.hd) { const h = HIDES[tgt.hd]; M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .4; goTo(h.ex, h.y, h.ez); } if (Math.hypot(M.x - h.ex, M.z - h.ez) < 1.1 && Math.abs(M.y - h.y) < 1.5) { emit({k: 'snd', s: 'creak'}); downPlayer(tgt, 'pulled'); return finish(dt); } }
      else if (tgt.hd >= 0 && G.t - M.seenAt < 1.2) M.sawHide = tgt.hd;
      else {
        if (see > 0 && M.seeP === tgt.id) { M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .3; if (Math.abs(tgt.y - M.y) < 1 && clearLine(M.x, M.z, tgt.x, tgt.z, M.y + 1)) M.path = [[tgt.x, tgt.z]]; else goTo(tgt.x, tgt.y, tgt.z); } }
        else { M.lostT += dt; if (!M.path.length) goTo(M.lx, M.ly, M.lz); if (M.lostT > D.lost) { M.tgt = null; const z = zoneOf(M.lx, M.lz, M.ly); if (z >= 0 && BLD[z].hides.length) startSearch(z, true); else { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx, M.ly, M.lz); } } }
        if (Math.hypot(tgt.x - M.x, tgt.z - M.z) < 1.3 && Math.abs(tgt.y - M.y) < 1.4) { downPlayer(tgt, 'caught'); return finish(dt); }
      }
      break;
    }
    case 'search': {
      speed = 2.4 + prog * 4;
      if (M.chkT > 0) { M.chkT -= dt; M.spd = 0; const h = M.chkH; M.yaw += angD(M.yaw, Math.atan2(-(h.x - M.x), -(h.z - M.z))) * Math.min(1, dt * 6);
        if (M.chkT <= .9 && !M.chkDone) { M.chkDone = true; emit({k: 'snd', s: 'creak'}); for (const p of PL.values()) if (p.hd === h.i && !p.hb && !p.down) { downPlayer(p, 'pulled'); return finish(dt); } }
        if (M.chkT <= 0) nextCheck(); return finish(dt); }
      if (moveAlong(dt, speed)) { if (M.chkH) { M.chkT = 1.8; M.chkDone = false; } else nextCheck(); }
      for (const p of PL.values()) if (p.hd >= 0 && !p.hb && Math.hypot(p.x - M.x, p.z - M.z) < 3.2 && Math.abs(p.y - M.y) < 2 && CR() < dt * D.breathHear * 2 && M.chkH !== HIDES[p.hd]) { M.chk.unshift(HIDES[p.hd]); nextCheck(); break; }
      return finish(dt);
    }
    case 'flee': { speed = 5.2; M.flee -= dt; if (M.flee <= 0 || !M.path.length) { M.state = 'roam'; M.idle = 3; M.avoidT = 8; } break; }
  }
  moveAlong(dt, speed); return finish(dt);
}
function startSearch(z, fast) { const b = BLD[z]; M.state = 'search'; M.chk = b.hides.filter(() => CR() < D.checkP * (fast ? 1.3 : 1)); M.chk.sort(() => CR() - .5); M.chkH = null; M.chkT = 0; M.searchZ = z; goTo(b.din[0], b.fy, b.din[1]); if (M.chk.length) nextCheck(); }
function nextCheck() { M.chkT = 0; M.chkH = M.chk.shift() || null; M.chkDone = false; if (M.chkH) goTo(M.chkH.ex, M.chkH.y, M.chkH.ez); else { M.state = 'roam'; M.idle = 0; M.avoidT = 25; M.path = []; pickRoam(); } }
function finish(dt) {
  M.stuck += dt; if (M.stuck > 2.5) { if (Math.hypot(M.x - M.sx, M.z - M.sz) < .5 && M.path.length) { M.path = []; if (M.goal) goTo(M.goal[0], M.goal[1], M.goal[2]); } M.stuck = 0; M.sx = M.x; M.sz = M.z; }
  if (M.state !== 'flee') for (const p of alive()) if (p.hd < 0 && Math.hypot(p.x - M.x, p.z - M.z) < 1.0 && Math.abs(p.y - M.y) < 1.4) { downPlayer(p, 'caught'); break; }
  M.stepAcc = (M.stepAcc || 0) + M.spd * dt; if (M.stepAcc > 1.3) { M.stepAcc = 0; emit({k: 'mstep'}); }
}

// ---------------- events
function emit(e) { applyEv(e); if (Net.role === 'host') G.evq.push(e); }
function applyEv(e) {
  const me = myId();
  switch (e.k) {
    case 'snd': if (e.s === 'stinger') Snd.stinger(); else if (e.s === 'creak') Snd.creak(); break;
    case 'mstep': { const d = Math.hypot(cam.position.x - M.x, cam.position.z - M.z) + Math.abs(cam.position.y - M.y); if (d < 40) Snd.mStep(clamp(1.2 - d / 40, .1, 1) * (M.state === 'chase' ? 1.5 : 1)); break; }
    case 'down': { const p = PL.get(e.id); if (p) { p.down = true; p.hd = -1; p.seat = 0; }
      if (e.id === me) { Snd.scream(); $('flash').style.opacity = .7; setTimeout(() => $('flash').style.opacity = 0, 300); P.hd = -1; P.seat = 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); showMsg('It got you. Crawl toward your crew, they can pick you up.', '', 5); }
      else if (p) { Snd.hurt(at(p.x, p.y + 1, p.z, 6)); showMsg(`${p.name} is down! Hold E on them to pick them up.`, '', 5); } break; }
    case 'rev': { const p = PL.get(e.id); if (p) p.down = false; Snd.revive(); showMsg(e.id === me ? 'You are back on your feet.' : `${p ? p.name : ''} is back up.`); break; }
    case 'dead': { const p = PL.get(e.id); if (p) { p.dead = true; p.down = false; } showMsg(e.id === me ? 'You bled out.' : `${p ? p.name : 'Someone'} bled out.`, '', 5); break; }
    case 'drag': { const p = PL.get(e.id); if (p) { p.dead = true; p.drowned = true; p.sw = 0; } Snd.deep(); if (e.id === me) { P.dead = true; P.sw = 0; $('flash').style.opacity = .8; setTimeout(() => $('flash').style.opacity = 0, 600); showMsg('Something huge wraps around your legs and pulls you under.', '', 6); } else showMsg(`${p ? p.name : 'Someone'} was pulled under.`, '', 5); break; }
    case 'deepw': if (e.id === me) { Snd.bubbles(); showMsg('Something is circling beneath you. GET OUT OF THE WATER.', '', 3); } break;
    case 'give': if (e.id === me) { if (e.kind === 'battery') { P.bat = Math.min(1, P.bat + .5); showMsg('Fresh batteries.'); } if (e.kind === 'flare') { P.flares++; showMsg('Picked up a flare. Throw it with G.'); } Snd.pickup(); } break;
    case 'valve': { const v = VALVES[e.i]; v.open = true; Snd.valve(at(v.x, v.y + 1, v.z, 8)); showMsg(`${v.name} is open (${VALVES.filter(q => q.open).length} of 2).`); break; }
    case 'power': G.power = true; Snd.power(); MAT.bulb.emissiveIntensity = 2.5; MAT.screen.emissiveIntensity = 1; showMsg('The generator coughs and catches. Floodlights flare across the rig. An alarm starts wailing.', '', 6); G.alarmT = 22; break;
    case 'mayday': { const lines = ['Coast Guard Sector, receiving. Station Nine, we have had no contact for six days. Who is this?', 'Say again? ... Negative, nothing is flying in this weather.', 'Get off that rig. Get back to the lighthouse station and we will meet you there at first light.']; lines.forEach((l, i) => setTimeout(() => say(l, 'RADIO'), i * 5000)); break; }
    case 'ph': G.ph = e.ph; break;
    case 'helm': { const p = PL.get(e.id); for (const q of PL.values()) q.seat = 0; if (p) p.seat = e.on ? 1 : 0; if (e.id === me) P.seat = e.on ? 1 : 0; B.driver = e.on ? e.id : null; break; }
    case 'bump': G.shake = Math.max(G.shake || 0, e.s); burst(120, 1, .6 * e.s, .6, 'lowpass'); break;
    case 'ram': G.shake = 1.4; Snd.ram(); showMsg(['Something slams into the hull!', 'The boat lurches. It is under us.', 'A grey shape rolls past the stern.'][Math.floor(Math.random() * 3)], '', 2.5); G.spines = {t: 0, a: Math.random() * TAU}; break;
    case 'shape': G.spines = {t: 0, a: e.a}; Snd.deep(); break;
    case 'fl': if (e.id !== me) spawnFlare(e); break;
    case 'wh': { const p = PL.get(e.id); if (p) { p.pingT = 6; Snd.whistle(at(p.x, p.y + 1.6, p.z, 8)); } break; }
    case 'esc': break;
    case 'over': gameOver(e); break;
  }
}

// ---------------- host simulation
function hostStep(dt) {
  G.t += dt;
  boatStep(dt);
  for (const p of PL.values()) {
    if (!p.ready) continue;
    if (p.ob && p !== P) { const [wx, wz] = bL2W(p.bl[0], p.bl[1]); p.x = wx; p.z = wz; }
    const mv = Math.hypot(p.x - p.lx, p.z - p.lz); p.lx = p.x; p.lz = p.z; p.spd = mix(p.spd, mv / Math.max(dt, 1e-3), Math.min(1, dt * 5));
    if (p !== P && !p.down && mv < 3 && !p.ob) { p.sd += mv; if (p.sd > (p.run ? 1 : .75)) { p.sd = 0; noise(p.x, p.y, p.z, p.run ? 22 : p.cr ? 2 : 8); if (p.run) p.heat += .02; } }
    if (p.l) p.heat = Math.min(1, p.heat + dt * .004);
    if (p.down && !p.dead) { p.bleed -= dt; if (p.bleed <= 0) { p.down = false; p.dead = true; emit({k: 'dead', id: p.id}); } }
    // the thing in the water
    if (p.sw && !p.dead) { p.swT += dt; if (p.swT > D.drown - 3 && !p.warned) { p.warned = true; emit({k: 'deepw', id: p.id}); } if (p.swT > D.drown) emit({k: 'drag', id: p.id}); } else { p.swT = Math.max(0, p.swT - dt * 2); p.warned = false; }
  }
  // holds
  const hold = {};
  for (const p of PL.values()) {
    if (!p.ready || !p.h || p.down || p.dead || p.sw) continue;
    const k = p.h, near = (x, y, z, r) => Math.hypot(p.x - x, p.z - z) < r && Math.abs(p.y - y) < 2;
    let ok = false;
    if (k[0] === 'v') { const v = VALVES[+k[1]]; ok = v && !v.open && G.ph >= 1 && near(v.x, v.y, v.z, 3); }
    else if (k === 'g') { const b = BLD.find(q => q.kind === 'gen'); ok = G.ph === 2 && near(b.genP[0], b.fy, b.genP[2], 3.2); }
    else if (k === 'c') { const b = BLD.find(q => q.kind === 'ctrl'); ok = G.ph === 3 && near(b.console[0], b.fy, b.console[2], 3); }
    else if (k[0] === 'r') { const q = PL.get(k.slice(1)); ok = q && q.down && near(q.x, q.y, q.z, 2.6); }
    if (ok) (hold[k] = hold[k] || []).push(p);
  }
  for (const k in G.holdP) if (!hold[k]) { G.holdP[k] -= dt * (k[0] === 'r' ? .5 : .1); if (G.holdP[k] <= 0) delete G.holdP[k]; }
  const dur = {v: 5, g: 4, c: 6, r: 4};
  for (const k in hold) {
    const n = hold[k].length; G.holdP[k] = (G.holdP[k] || 0) + dt / dur[k[0]] * Math.min(2, .6 + .4 * n + (n > 1 ? .2 : 0));
    G.noiseT = (G.noiseT || 0) - dt; if (G.noiseT <= 0) { G.noiseT = 1; const q = hold[k][0]; noise(q.x, q.y, q.z, k[0] === 'r' ? 14 : 24); }
    if (G.holdP[k] >= 1) {
      delete G.holdP[k];
      if (k[0] === 'v') { emit({k: 'valve', i: +k[1]}); if (VALVES.every(v => v.open)) emit({k: 'ph', ph: 2}); }
      else if (k === 'g') { emit({k: 'power'}); emit({k: 'ph', ph: 3}); const b = BLD.find(q => q.kind === 'gen'); noise(b.x, b.fy, b.z, 70); }
      else if (k === 'c') { emit({k: 'mayday'}); emit({k: 'ph', ph: 4}); const b = BLD.find(q => q.kind === 'ctrl'); noise(b.x, b.fy, b.z, 50); G.ramT = 20; }
      else { const q = PL.get(k.slice(1)); if (q) { q.down = false; emit({k: 'rev', id: q.id}); } }
    }
  }
  // phases and the deep
  if (G.ph === 0 && (Math.hypot(B.x, B.z) < 50 || [...PL.values()].some(p => onRig(p) && Math.hypot(p.x, p.z) < 30))) emit({k: 'ph', ph: 1});
  if (G.ph === 0 && !G.shapeDone && B.z > -150) { G.shapeDone = true; emit({k: 'shape', a: B.yaw + PI / 2}); }
  if (G.ph >= 4) {
    const far = Math.hypot(B.x, B.z) > 45 && Math.hypot(B.x - JETTY.x, B.z - JETTY.z) > 40;
    if (far && Math.abs(B.v) > 1) { G.ramT -= dt; if (G.ramT <= 0) { G.ramT = D.ram * (.7 + CR() * .6); B.v *= .35; B.yaw += (CR() - .5) * .5; emit({k: 'ram'}); } }
    if (Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 24 && Math.abs(B.v) < 3) endRun();
  }
  if (!G.overSent) { if (!alive().length) { G.allDownT = (G.allDownT || 0) + dt; if (G.allDownT > 4) endRun(); } else G.allDownT = 0; }
  stepCreature(dt);
}
function endRun() { if (G.overSent) return; G.overSent = true; const res = [...PL.values()].filter(p => p.ready).map(p => [p.name, p.dead ? (p.drowned ? 'drowned' : 'dead') : (G.ph >= 4 && Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 30 && p.ob) ? 'esc' : 'left', p.c]); emit({k: 'over', win: res.some(r => r[1] === 'esc'), res, t: Math.round(G.t)}); }
function hostAct(id, m) {
  const p = PL.get(id); if (!p || !G.on || G.over) return;
  if (m.px != null && p !== P && !m.ob && Math.hypot(m.px - p.x, m.pz - p.z) < 25) { p.x = m.px; p.z = m.pz; }
  if (m.a === 'pick') { const it = ITEMS[m.i]; if (it && !it.taken && it.kind !== 'note' && Math.hypot(p.x - it.x, p.z - it.z) < 3.5) { it.taken = true; emit({k: 'give', id, kind: it.kind}); } }
  else if (m.a === 'fl') { spawnFlare(Object.assign({}, m, {id})); if (Net.role === 'host') G.evq.push(Object.assign({}, m, {k: 'fl', id})); }
  else if (m.a === 'wh') { emit({k: 'wh', id}); noise(p.x, p.y, p.z, 45); p.heat += .1; }
  else if (m.a === 'helm') { if (!B.driver || B.driver === id || !PL.get(B.driver)) emit({k: 'helm', id, on: 1}); }
  else if (m.a === 'unhelm') { if (B.driver === id) emit({k: 'helm', id, on: 0}); }
  else if (m.a === 'gasp') noise(p.x, p.y, p.z, 9);
  else if (m.a === 'splash') noise(p.x, p.y, p.z, 12);
}
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({t: 'act', px: +P.x.toFixed(2), pz: +P.z.toFixed(2), ob: P.ob}, m)); }

// ---------------- snapshots
function packSnap() {
  const ps = {}; for (const p of PL.values()) ps[p.id] = [p.down ? 1 : 0, Math.ceil(p.bleed), p.dead ? 1 : 0, p.seat ? 1 : 0];
  const s = {t: 'snap', m: [+M.x.toFixed(2), +M.y.toFixed(2), +M.z.toFixed(2), +M.yaw.toFixed(2), M.state, +M.spd.toFixed(2), +(M.look || 0).toFixed(2)],
    b: [+B.x.toFixed(2), +B.z.toFixed(3), +B.yaw.toFixed(4), +B.v.toFixed(2), +B.thr.toFixed(2), B.driver || ''],
    ps, it: ITEMS.map(i => i.taken ? 1 : 0).join(''), va: VALVES.map(v => v.open ? 1 : 0), pw: G.power ? 1 : 0, hp: G.holdP, ph: G.ph, gt: +G.t.toFixed(1), ev: G.evq};
  G.evq = []; return s;
}
function applySnap(s) {
  const [x, y, z, yaw, st, spd, look] = s.m; M.tx = x; M.ty = y; M.tz = z; M.tyaw = yaw; M.state = st; M.spd = spd; M.look = look;
  B.tx = s.b[0]; B.tz = s.b[1]; B.tyaw = s.b[2]; B.v = s.b[3]; B.thr = s.b[4]; B.driver = s.b[5] || null; if (!B.got) { B.got = 1; B.x = B.tx; B.z = B.tz; B.yaw = B.tyaw; }
  for (const id in s.ps) { const p = PL.get(id); if (!p) continue; const [d, bl, de] = s.ps[id]; p.down = !!d; p.bleed = bl; p.dead = !!de; }
  for (let i = 0; i < ITEMS.length; i++) ITEMS[i].taken = s.it[i] === '1';
  s.va.forEach((v, i) => VALVES[i].open = !!v); if (s.pw && !G.power) applyEv({k: 'power'});
  G.holdP = s.hp || {}; G.ph = s.ph; G.t = s.gt; for (const e of s.ev || []) applyEv(e);
}
Net.on('snap', m => { if (G.on && !isHost()) applySnap(m); });
Net.on('pose', (m, from) => {
  if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId()) return; const p = PL.get(id); if (!p) return;
  p.x = m.x; p.z = m.z; p.y = m.y; p.yaw = m.yw; p.pitch = m.pt; p.cr = m.cr; p.l = m.l; p.run = m.rn; p.h = m.h || ''; p.hd = m.hd; p.hb = m.hb; p.ob = m.ob; p.bl = m.bl || p.bl; p.sw = m.sw; p.in = m.in || [0, 0]; p.byaw = m.by || 0;
  if (!p.ready) { p.ready = true; p.rx = p.x; p.ry = p.y; p.rz = p.z; p.lx = p.x; p.lz = p.z; }
  p.stepD = (p.stepD || 0) + Math.hypot(m.x - (p.px ?? m.x), m.z - (p.pz ?? m.z)); p.px = m.x; p.pz = m.z;
});
Net.on('act', (m, from) => { if (isHost() && G.on) hostAct(from, m); });

// ---------------- flares
function spawnFlare(e) {
  const m = new THREE.Group(); m.add(itemMesh('flare'));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff3018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); glow.scale.set(1.4, 1.4, 1); m.add(glow);
  scene.add(m); const f = {m, glow, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, t: 32, rest: false, sea: false}; G.flares.push(f);
  Snd.flare(at(e.x, e.y, e.z, 4)); if (G.flares.length > 3) { const o = G.flares.shift(); scene.remove(o.m); }
}
function throwFlare() {
  if (P.flares <= 0 || P.hd >= 0 || P.down || P.seat || !alivePlay()) return; P.flares--;
  const f = eyeDir(P), e = {a: 'fl', x: P.x + f[0] * .4, y: P.y + P.eye - .2, z: P.z + f[2] * .4, vx: f[0] * 10 + P.vx, vy: f[1] * 10 + 3, vz: f[2] * 10 + P.vz};
  spawnFlare(e); if (isHost()) { if (Net.role === 'host') G.evq.push(Object.assign({}, e, {k: 'fl', id: myId()})); } else Net.send(Object.assign({t: 'act'}, e));
}
function stepFlares(dt) {
  for (let i = 0; i < G.flares.length; i++) {
    const f = G.flares[i];
    if (!f.rest) { f.vy -= 9.8 * dt; f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt; const fl = floorAt(f.x, f.z, f.y + .3); const gy = fl ? fl.y + .03 : -.1;
      if (f.y < gy) { f.y = gy; f.vy *= -.25; f.vx *= .5; f.vz *= .5; if (Math.hypot(f.vx, f.vz) < .5) { f.rest = true; f.sea = !fl; f.surf = fl && fl.s.k === 'boat' ? bW2L(f.x, f.z) : null; noise(f.x, f.y, f.z, 10); } } }
    else if (f.surf) { const [wx, wz] = bL2W(f.surf[0], f.surf[1]); f.x = wx; f.z = wz; }
    f.t -= f.sea ? dt * 3 : dt; f.m.position.set(f.x, f.y + (f.sea ? waveH(f.x, f.z, G.wt) : 0), f.z); f.m.rotation.set(0, 0, f.rest ? 0 : G.t * 9);
    const on = f.t > 0, k = .8 + Math.random() * .4; FLL[i].intensity = on ? 16 * k * Math.min(1, f.t / 3) : 0; FLL[i].position.set(f.x, f.m.position.y + .35, f.z); f.glow.material.opacity = on ? .8 * k : 0;
  }
  for (let i = G.flares.length; i < FLL.length; i++) FLL[i].intensity = 0;
}

// ---------------- local player
const K = {}; let mouseR = false, eDown = false, ePress = false;
const alivePlay = () => P && !P.dead && !P.esc;
function stepPlayer(dt) {
  if (!alivePlay()) return;
  const bdy = B.yaw - (P.lastBY ?? B.yaw); P.lastBY = B.yaw;
  if (P.ob) { P.yaw += bdy; const [wx, wz] = bL2W(P.bl[0], P.bl[1]); P.x = wx; P.z = wz; }
  if (P.seat) { // at the wheel
    P.bl = [BHELM[0], BHELM[1]]; const [wx, wz] = bL2W(BHELM[0], BHELM[1]); P.x = wx; P.z = wz; P.y = BDECK.y; P.ob = 1;
    const by = B.yaw, d = angD(by, P.yaw); P.yaw = by + clamp(d, -1.3, 1.3);
    P.in = [(K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0)];
    P.vx = P.vz = 0; P.eye = mix(P.eye, 1.62, dt * 8); return;
  }
  P.in = [0, 0];
  if (P.hd >= 0) {
    const h = HIDES[P.hd]; P.x = h.x; P.z = h.z; P.y = h.y; P.vx = P.vz = 0;
    const want = (mouseR || K.Space) && P.gasp <= 0;
    if (want && P.breath > 0) { P.hb = 1; P.breath -= dt / 10; if (P.breath <= 0) { P.breath = 0; P.hb = 0; P.gasp = 2.2; Snd.gasp(); act({a: 'gasp'}); } } else { P.hb = 0; P.breath = Math.min(1, P.breath + dt / 6); }
    P.gasp -= dt; $('breath').querySelector('i').style.width = P.breath * 100 + '%'; return;
  }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mag = Math.hypot(fw, st) || 1;
  let run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && P.stam > .02 && !P.cr && !P.down && !P.sw;
  if (P.tired && P.stam < .3) run = false; if (P.stam > .3) P.tired = false;
  const sp = P.sw ? 1.5 : P.down ? .55 : P.cr ? 1.6 : run ? 5.8 : 3.0, sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp, acc = (fw || st) ? 9 : 12;
  P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * acc)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * acc));
  const ox = P.x, oz = P.z; P.x += P.vx * dt; P.z += P.vz * dt;
  pushBody(P, .33, P.y);
  // floor, gravity, the sea
  const f = floorAt(P.x, P.z, P.y);
  if (f && P.y - f.y < .6) { P.y = mix(P.y, f.y, Math.min(1, dt * 14)); if (P.vy < -9) Snd.step(1, 2); P.vy = 0; if (P.sw) { P.sw = 0; } }
  else if (!P.sw) { P.vy = (P.vy || 0) - 20 * dt; P.y += P.vy * dt; if (f && P.y < f.y) { P.y = f.y; P.vy = 0; } if (!f && P.y < .2) { P.sw = 1; P.y = 0; P.vy = 0; P.ob = 0; Snd.splash(); act({a: 'splash'}); showMsg('You are in the water! Swim to a ladder (E).', '', 3); } }
  if (P.sw) { P.y = 0; }
  // on the boat?
  if (!P.sw && f && f.s.k === 'boat' && Math.abs(P.y - BDECK.y) < .3) { P.ob = 1; P.bl = bW2L(P.x, P.z); } else P.ob = 0;
  const moved = Math.hypot(P.x - ox, P.z - oz), v = moved / Math.max(dt, 1e-4); P.run = run && v > 1 ? 1 : 0;
  if (P.run) { P.stam -= dt / 7; if (P.stam <= 0) { P.stam = 0; P.tired = true; } } else P.stam = Math.min(1, P.stam + dt / (v > .5 ? 11 : 7));
  P.eye = mix(P.eye, P.sw ? .25 : P.down ? .45 : P.cr ? 1.0 : 1.62, Math.min(1, dt * 8));
  P.stepD += moved; P.bob += moved * (run ? 1.25 : 1.6);
  if (P.stepD > (run ? 1 : P.cr ? .55 : .75)) { P.stepD = 0; const k = run ? 1.4 : P.cr ? .35 : .8; Snd.step(!P.ob && P.y > 1, k, P.sw); if (isHost() && !P.ob) { noise(P.x, P.y, P.z, run ? 22 : P.cr ? 2 : 8); if (run) P.heat += .02; } }
  if (P.l) { P.bat -= dt / 280; if (P.bat <= 0) { P.bat = 0; P.l = 0; showMsg('Your flashlight died.', '', 3); } }
  $('stam').style.opacity = P.stam < .99 ? 1 : 0; $('stam').firstChild.style.width = P.stam * 100 + '%';
}
function interWorld(it) { if (!it.boat) return it; const [x, z] = bL2W(it.lx, it.lz); return {x, y: BDECK.y + it.ly, z}; }
function targets() {
  const L = [];
  for (const it of ITEMS) if (!it.taken) L.push({x: it.x, y: it.y + .1, z: it.z, r: 2.2, label: ({battery: 'Pick up batteries', flare: 'Pick up the flare', note: 'Read the note'})[it.kind], go: () => it.kind === 'note' ? openNote(it.text) : act({a: 'pick', i: it.i})});
  if (G.ph >= 1) VALVES.forEach((v, i) => { if (!v.open) L.push({x: v.x, y: v.y + 1.1, z: v.z, r: 2.6, hold: 'v' + i, label: 'Hold E to open the ' + v.name.toLowerCase()}); });
  const gb = BLD.find(q => q.kind === 'gen'), cb = BLD.find(q => q.kind === 'ctrl');
  if (gb) L.push({x: gb.genP[0], y: gb.genP[1], z: gb.genP[2], r: 3, hold: G.ph === 2 ? 'g' : '', label: G.power ? 'The generator is running' : G.ph === 2 ? 'Hold E to start the generator' : G.ph < 2 ? 'Generator. No fuel: the valves are shut.' : 'Generator'});
  if (cb) L.push({x: cb.console[0], y: cb.console[1], z: cb.console[2], r: 2.8, hold: G.ph === 3 ? 'c' : '', label: G.ph === 3 ? 'Hold E to send the mayday' : G.ph < 3 ? 'Radio console. No power.' : 'Static'});
  for (const p of PL.values()) if (p !== P && p.down && !p.dead && p.ready) L.push({x: p.x, y: p.y + .3, z: p.z, r: 2.4, hold: 'r' + p.id, label: `Hold E to pick up ${p.name}`});
  for (const it of INTER) { if (it.on && !it.on()) continue; const w = interWorld(it); L.push(Object.assign({}, it, {x: w.x, y: it.boat ? w.y : it.y, z: w.z, label: it.label(), hide: it.h, src: it})); }
  return L;
}
function stepInteract(dt) {
  const pr = $('prompt'); P.h = '';
  if (TEST && G.forceH) { P.h = G.forceH; return; }
  if (!alivePlay() || P.down) { pr.style.opacity = 0; ePress = false; return; }
  const ey = P.y + P.eye; cam.getWorldDirection(_fw); let best = null, bs = 1e9;
  for (const it of targets()) {
    if (P.hd >= 0) { if (it.hide && it.hide.i === P.hd) { best = it; break; } continue; }
    if (P.seat) { if (it.kind === 'helm') { best = it; break; } continue; }
    if (P.sw && it.kind !== 'ladder') continue;
    const dx = it.x - P.x, dy = (it.kind === 'ladder' ? 0 : it.y - ey), dz = it.z - P.z, d = Math.hypot(dx, dy, dz); if (d > it.r) continue;
    if (it.kind !== 'ladder') { const dot = (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d, lim = d < 1.2 ? .4 : .84; if (dot < lim) continue; }
    const sc = d; if (sc < bs) { bs = sc; best = it; }
  }
  if (!best) { pr.style.opacity = 0; ePress = false; return; }
  $('pTxt').innerHTML = `<kbd>E</kbd>${best.label}`; pr.style.opacity = 1;
  const hp = best.hold ? (G.holdP[best.hold] || 0) : 0; $('pBar').style.display = best.hold ? 'block' : 'none'; $('pBar').firstChild.style.width = hp * 100 + '%';
  if (best.hold && eDown) { P.h = best.hold; if (best.hold[0] === 'v' && Math.random() < dt * 2) Snd.valve(); }
  else if (ePress) {
    if (best.hide) toggleHide(best.hide);
    else if (best.kind === 'helm') act({a: P.seat ? 'unhelm' : 'helm'});
    else if (best.kind === 'ladder') { const s = best.src; P.sw = 0; P.vy = 0; if (s.top === 'boat') { P.ob = 1; P.bl = [0, 4.6]; const [wx, wz] = bL2W(0, 4.6); P.x = wx; P.z = wz; P.y = BDECK.y; } else { P.x = s.top[0]; P.y = s.top[1]; P.z = s.top[2]; } Snd.splash(); }
    else if (best.go) best.go();
  }
  ePress = false;
}
function toggleHide(h) {
  if (P.hd >= 0) { P.hd = -1; P.x = h.ex; P.z = h.ez; P.l = P.lightWas && P.bat > 0 ? 1 : 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); Snd.creak(); }
  else { P.hd = h.i; P.lightWas = P.l; P.l = 0; P.yaw = h.yaw; P.pitch = 0; P.cr = 0; $('slats').classList.remove('hidden'); $('breath').classList.remove('hidden'); Snd.creak(); if (isHost() && M.state === 'chase' && M.tgt === P.id && G.t - M.seenAt < 1.2) M.sawHide = h.i; }
}
function openNote(t) { G.noteOpen = true; $('noteT').textContent = t; $('note').classList.remove('hidden'); }
function closeNote() { G.noteOpen = false; $('note').classList.add('hidden'); }
function myPose() { return {t: 'pose', x: +P.x.toFixed(2), z: +P.z.toFixed(2), y: +P.y.toFixed(2), yw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.cr ? 1 : 0, l: P.l ? 1 : 0, rn: P.run, h: P.h, hd: P.hd, hb: P.hb, ob: P.ob, bl: P.ob ? [+P.bl[0].toFixed(2), +P.bl[1].toFixed(2)] : 0, sw: P.sw, in: P.seat ? P.in : 0}; }

// ---------------- input
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!G.on) return; K[e.code] = true;
  if (G.noteOpen) { if (e.code === 'KeyE' || e.code === 'Escape') closeNote(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyE') { eDown = true; ePress = true; }
  if (!alivePlay()) return;
  if (e.code === 'KeyF' && P.hd < 0 && P.bat > 0) { P.l = P.l ? 0 : 1; Snd.click(); }
  if (e.code === 'KeyC' && !P.down && !P.seat) P.cr = P.cr ? 0 : 1;
  if (e.code === 'KeyG') throwFlare();
  if (e.code === 'KeyQ' && !P.down && (G.whT || 0) <= 0) { G.whT = 3; act({a: 'wh'}); }
  if (e.code === 'Tab') { G.map = true; $('map').classList.remove('hidden'); drawMap(); }
});
addEventListener('keyup', e => { K[e.code] = false; if (e.code === 'KeyE') eDown = false; if (e.code === 'Tab') { G.map = false; $('map').classList.add('hidden'); } });
addEventListener('mousemove', e => {
  if (!G.on || G.paused || document.pointerLockElement !== canvas || !P) return;
  const s = .0022 * SET.sens; P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.45, 1.45);
  if (P.hd >= 0) { const h = HIDES[P.hd], d = angD(h.yaw, P.yaw); P.yaw = h.yaw + clamp(d, -.7, .7); P.pitch = clamp(P.pitch, -.5, .4); }
});
canvas.addEventListener('mousedown', e => { if (!G.on) return; if (document.pointerLockElement !== canvas) { lockMouse(); return; } if (G.noteOpen) { closeNote(); return; } if (e.button === 2) mouseR = true; if (e.button === 0 && !alivePlay()) G.spec++; });
addEventListener('mouseup', e => { if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && G.on && !TEST) pause(true); });
addEventListener('blur', () => { for (const k in K) K[k] = false; eDown = false; mouseR = false; });
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function pause(p) { G.paused = p; $('pause').classList.toggle('hidden', !p); $('pauseN').textContent = Net.role === 'solo' ? 'The sea waits for you.' : 'Online games keep running.'; if (Net.role === 'solo' && A.ctx) p ? A.ctx.suspend() : A.ctx.resume(); if (!p) lockMouse(); }

// ---------------- rendering
const _fw = new THREE.Vector3(), swayV = new THREE.Vector3();
const VM = new THREE.Group(); cam.add(VM);
(function viewModel() {
  const m = new THREE.MeshStandardMaterial({color: 0x1d1f22, roughness: .4, metalness: .7});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.022, .02, .2, 12), m); body.rotation.x = PI / 2; VM.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.034, .024, .05, 14), m); head.rotation.x = PI / 2; head.position.z = -.12; VM.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.03, 14), new THREE.MeshBasicMaterial({color: 0xfff2d8})); lens.position.z = -.146; VM.add(lens); VM.userData.lens = lens;
  const glove = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .6}); const fist = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), glove); fist.scale.set(1, .85, 1.5); fist.position.set(0, -.012, .02); VM.add(fist);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .4, 10), glove); arm.rotation.x = PI / 2 - .25; arm.position.set(.03, -.06, .22); VM.add(arm);
  VM.scale.setScalar(.8); VM.traverse(o => { if (o.isMesh) o.castShadow = false; });
})();
function boatPose(dt) {
  if (!isHost() && B.tx != null) { const k = Math.min(1, dt * 6); const px = B.tx - Math.sin(B.tyaw) * B.v * .05, pz = B.tz - Math.cos(B.tyaw) * B.v * .05; B.x = mix(B.x, px, k); B.z = mix(B.z, pz, k); B.yaw += angD(B.yaw, B.tyaw) * k; B.x += -Math.sin(B.yaw) * B.v * dt * (1 - k); B.z += -Math.cos(B.yaw) * B.v * dt * (1 - k); }
  const t = G.wt, fx = -Math.sin(B.yaw), fz = -Math.cos(B.yaw), sx = Math.cos(B.yaw), sz = -Math.sin(B.yaw);
  const hf = waveH(B.x + fx * 4, B.z + fz * 4, t), hb = waveH(B.x - fx * 4, B.z - fz * 4, t), hl = waveH(B.x - sx * 2, B.z - sz * 2, t), hr = waveH(B.x + sx * 2, B.z + sz * 2, t);
  B.heave = (hf + hb + hl + hr) / 4; B.pitch = Math.atan2(hf - hb, 8) * .8; B.roll = Math.atan2(hl - hr, 4) * .8 + (G.shake || 0) * Math.sin(G.t * 23) * .05;
  BOAT.position.set(B.x, B.heave, B.z); BOAT.rotation.set(B.pitch, B.yaw, B.roll, 'YXZ');
  BOAT.userData.wheel.rotation.z = -B.st * 2;
  const [lx, lz] = bL2W(0, -6.2); boatL.position.set(lx, 2.6 + B.heave, lz); boatL.target.position.set(B.x + fx * 40, -1, B.z + fz * 40); boatL.intensity = 160;
}
function specTarget() { const L = [...PL.values()].filter(p => p !== P && p.ready && !p.dead && !p.esc); return L.length ? L[G.spec % L.length] : null; }
function updateCamera(dt) {
  let ex, ey, ez, yaw, pitch, own = alivePlay(), roll = 0;
  if (own && P.ob) { [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); }
  if (own) { ex = P.x; ey = P.y + P.eye; ez = P.z; yaw = P.yaw; pitch = P.pitch; if (P.ob) { ey += B.heave; roll = B.roll * .7; pitch += B.pitch * .5; } if (P.sw) ey = waveH(P.x, P.z, G.wt) + .25; }
  else { const s = specTarget(); if (s) { ex = s.rx; ey = s.ry + (s.down ? .5 : 1.6) + (s.ob ? B.heave : 0); ez = s.rz; yaw = s.ryaw; pitch = s.rpitch; } else { ex = B.x; ey = 12; ez = B.z + 18; yaw = 0; pitch = -.4; } }
  const sp = own ? Math.hypot(P.vx, P.vz) : 0, bobA = own && P.hd < 0 && !P.seat ? clamp(sp / 6, 0, 1) * .05 : 0, shk = (own && P.fear > .5 ? (P.fear - .5) * .006 : 0) + (G.shake || 0) * .02;
  G.shake = Math.max(0, (G.shake || 0) - dt * 1.2);
  cam.position.set(ex + Math.sin(G.t * 37) * shk, ey + Math.sin((P.bob || 0) * 2) * bobA * .6, ez);
  cam.rotation.set(pitch + Math.sin(G.t * 31) * shk, yaw + Math.sin(P.bob || 0) * bobA * .05, roll + (own && P.down ? .35 : Math.sin(P.bob || 0) * bobA * .08), 'YXZ'); cam.updateMatrixWorld();
  VM.visible = own && P.hd < 0 && !P.down && !P.sw && !P.seat;
  VM.position.set(.22 + Math.sin(P.bob || 0) * bobA * .3, -.21 - Math.abs(Math.cos(P.bob || 0)) * bobA * .3, -.42);
  cam.getWorldDirection(_fw); swayV.lerp(_fw, Math.min(1, dt * 14));
  const on = own && P.l && P.hd < 0 && !P.sw; let k = on ? .55 + .45 * Math.min(1, P.bat * 3) : 0;
  const nearM = Math.hypot(ex - M.x, ez - M.z) + Math.abs(ey - M.y);
  if (on && (P.bat < .15 || nearM < 13 || M.state === 'chase' && nearM < 22) && Math.random() < .25) k *= Math.random() < .5 ? .05 : .5;
  flash.intensity = 70 * k; VM.userData.lens.material.color.setScalar(on ? .4 + k : .05);
  _v.set(.2, -.19, -.62).applyQuaternion(cam.quaternion).add(cam.position); flash.position.copy(_v); flash.target.position.copy(_v).addScaledVector(swayV, 10);
  const sky = scene.userData.sky; sky.position.copy(cam.position);
  SEA.position.set(Math.round(ex / 6) * 6, 0, Math.round(ez / 6) * 6);
  // rain follows the camera
  RAIN.position.set(ex, ey - 12, ez); RAIN.visible = !(P && P.ob && P.bl && P.bl[1] < -1.2 && P.bl[1] > -4.2) && zoneOf(ex, ez, ey - 1.6) < 0;
  const ra = RAIN.geometry.attributes.position.array, fall = dt * 24;
  for (let i = 0; i < ra.length; i += 6) { ra[i + 1] -= fall; ra[i + 4] -= fall; ra[i] -= fall * .1; ra[i + 3] -= fall * .1; if (ra[i + 1] < 0) { const x = (Math.random() - .5) * 50, y = 30, z = (Math.random() - .5) * 50; ra[i] = x; ra[i + 1] = y; ra[i + 2] = z; ra[i + 3] = x + .15; ra[i + 4] = y + .7; ra[i + 5] = z + .05; } }
  RAIN.geometry.attributes.position.needsUpdate = true;
}
function updateWorldFx(dt) {
  G.wt = performance.now() / 1000;
  if (MAT.sea.userData.sh) MAT.sea.userData.sh.uniforms.uT.value = G.wt;
  TX.ripple.offset.set(G.wt * .01, G.wt * .013);
  // lightning
  G.lightT -= dt; const sky = scene.userData.sky.material.uniforms;
  if (G.lightT <= 0) { G.lightT = 10 + Math.random() * 25; G.bolt = .35; setTimeout(() => Snd.thunder(.6 + Math.random() * .4), 600 + Math.random() * 2500); }
  G.bolt = Math.max(0, (G.bolt || 0) - dt); const fl = G.bolt > 0 ? (Math.random() < .6 ? 1 : .2) * G.bolt * 3 : 0;
  sky.uF.value = fl; hemi.intensity = .45 + fl * 3; moon.intensity = .35 + fl * 2;
  // aviation light, alarm, lighthouse
  if (G.aviS) G.aviS.material.opacity = Math.sin(G.wt * 3) > .4 ? 1 : .05;
  const ang = G.wt * .45; lhL.position.set(G.lh[0], G.lh[1], G.lh[2]); lhL.target.position.set(G.lh[0] + Math.sin(ang) * 100, G.lh[1] - 6, G.lh[2] + Math.cos(ang) * 100); lhL.intensity = 30;
  G.lhBeam.position.set(G.lh[0], G.lh[1], G.lh[2]); G.lhBeam.rotation.set(0, ang, 0);
  // floodlights after power
  if (G.power) { const cp = cam.position; const L = LAMPS.slice().sort((a, b) => Math.hypot(a[0] - cp.x, a[1] - cp.y, a[2] - cp.z) - Math.hypot(b[0] - cp.x, b[1] - cp.y, b[2] - cp.z)); POOL.forEach((l, i) => { const s = L[i]; l.position.set(s[0], s[1] - .3, s[2]); l.intensity = 22 * s[3] * (Math.random() < .015 ? .3 : 1); }); }
  else POOL.forEach(l => l.intensity = 0);
  // spines of the thing in the deep
  if (G.spines) { const s = G.spines; s.t += dt; const lift = Math.sin(clamp(s.t / 6, 0, 1) * PI); G.spineM.visible = s.t < 6; const cx = B.x + Math.sin(s.a) * 14, cz = B.z + Math.cos(s.a) * 14; G.spineM.position.set(cx + Math.cos(s.a) * (s.t - 3) * 4, -2.4 + lift * 2.6, cz - Math.sin(s.a) * (s.t - 3) * 4); G.spineM.rotation.y = s.a + PI / 2; if (s.t > 6) G.spines = null; }
}
function updateRemotes(dt) {
  let si = 0; const cp = cam.position;
  const L = [...PL.values()].filter(p => p !== P && p.ready); L.sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z));
  for (const p of PL.values()) {
    if (p === P) { if (p.av) p.av.visible = false; if (p.tag) p.tag.style.display = 'none'; continue; }
    if (!p.ready) continue;
    let tx = p.x, tz = p.z, ty = p.y; if (p.ob && p.bl) { [tx, tz] = bL2W(p.bl[0], p.bl[1]); ty = BDECK.y + B.heave; }
    const k = Math.min(1, dt * 12), ox = p.rx, oz = p.rz; p.rx = p.ob ? tx : mix(p.rx, tx, k); p.ry = mix(p.ry, ty, k); p.rz = p.ob ? tz : mix(p.rz, tz, k); p.ryaw += angD(p.ryaw, p.yaw) * k; p.rpitch = mix(p.rpitch, p.pitch, k);
    p.rspd = mix(p.rspd, Math.hypot(p.rx - ox, p.rz - oz) / Math.max(dt, 1e-3) - (p.ob ? Math.abs(B.v) : 0), Math.min(1, dt * 6));
    animCrew(p, dt);
    if ((p.stepD || 0) > (p.run ? 1 : .75)) { p.stepD = 0; if (!p.ob && Math.hypot(p.x - cp.x, p.z - cp.z) < 30 && !p.down) Snd.rStep(p.x, p.y, p.z, p.run ? 1.4 : .8); }
    p.pingT = Math.max(0, (p.pingT || 0) - dt);
    const t = p.tag, d = Math.hypot(p.rx - cp.x, p.rz - cp.z); let show = !p.dead && !p.esc && (d < 30 || p.down || p.pingT > 0);
    if (show) { _v.set(p.rx, p.ry + (p.down ? .8 : 2.15), p.rz).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) show = false; }
    t.style.display = show ? 'block' : 'none';
    if (show) { t.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; t.className = 'tag' + (p.down ? ' down' : p.pingT > 0 ? ' ping' : ''); t.textContent = p.down ? `${p.name} DOWN ${Math.max(0, p.bleed | 0)}s · ${d | 0}m` : p.sw ? `${p.name} IN THE WATER` : p.pingT > 0 ? `${p.name} · ${d | 0}m` : p.name; t.style.opacity = p.down || p.pingT > 0 || p.sw ? 1 : clamp(1.4 - d / 30, .2, .9); }
  }
  for (const p of L) { if (si >= RSPOT.length) break; if (!p.l || p.down || p.dead || p.hd >= 0 || p.sw) continue; const l = RSPOT[si++], f = eyeDir({yaw: p.ryaw, pitch: p.rpitch}); l.position.set(p.rx + f[0] * .4, p.ry + 1.35, p.rz + f[2] * .4); l.target.position.set(l.position.x + f[0] * 10, l.position.y + f[1] * 10, l.position.z + f[2] * 10); l.intensity = 55; }
  for (; si < RSPOT.length; si++) RSPOT[si].intensity = 0;
  for (const it of ITEMS) it.mesh.visible = !it.taken;
}
let heartT = 0;
function stepFear(dt) {
  const cp = cam.position, d = Math.hypot(cp.x - M.x, cp.z - M.z) + Math.abs(cp.y - M.y - 1.5), me = alivePlay() ? P : null, s = me ? pSeesMon(me) : 0;
  let f = clamp(1 - d / 30, 0, 1) * .6 + (M.state === 'chase' ? (M.tgt === myId() ? .5 : .25) : 0) + s * clamp(1 - d / 45, 0, 1) * .4 + (me && me.sw ? .6 : 0);
  P.fear = mix(P.fear || 0, clamp(f, 0, 1), Math.min(1, dt * (f > (P.fear || 0) ? 3 : .6)));
  heartT -= dt; if (P.fear > .2 && heartT <= 0) { heartT = 60 / (60 + P.fear * 110); Snd.heart(P.fear); }
  $('fearV').style.opacity = clamp((P.fear - .25) * 1.2, 0, .9); $('downV').style.opacity = P.down ? .55 + .35 * (1 - P.bleed / D.bleed) : 0;
  if (A.on) {
    const c = A.ctx, t = c.currentTime, ch = M.state === 'chase';
    A.drone.gain.setTargetAtTime(ch && d < 60 ? .05 : 0, t, ch ? .3 : 1.5); A.droneF.frequency.setTargetAtTime(ch ? 900 : 300, t, 1);
    A.mBreath.g.gain.setTargetAtTime(.25 * (ch ? 1.6 : 1) * (.5 + .5 * Math.sin(G.t * (ch ? 9 : 2.5))), t, .05); A.mGrowl.gain.setTargetAtTime(ch ? .5 : M.state === 'search' ? .25 : .08 * clamp(1 - d / 25, 0, 1), t, .2); A.mSaw.frequency.setTargetAtTime(ch ? 62 : 44, t, .3);
    setPan(A.mPan, M.x, M.y + 2, M.z);
    const L = c.listener; cam.getWorldDirection(_fw);
    if (L.positionX) { L.positionX.value = cp.x; L.positionY.value = cp.y; L.positionZ.value = cp.z; L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(cp.x, cp.y, cp.z); L.setOrientation(_fw.x, _fw.y, _fw.z, 0, 1, 0); }
    const inside = zoneOf(cp.x, cp.z, cp.y - 1.6) >= 0 || (P.hd >= 0);
    A.rain.g.gain.value = inside ? .015 : .05; A.wind.g.gain.value = (inside ? .02 : .06) + Math.sin(G.t * .13) * .02; A.wind.f.frequency.value = 380 + Math.sin(G.t * .21) * 140; A.surf.g.gain.value = clamp(.14 - cp.y * .006, .02, .14);
    setPan(A.bPan, B.x, 1.5, B.z); A.eng.frequency.value = 38 + Math.abs(B.thr) * 30; A.engF.frequency.value = 250 + Math.abs(B.thr) * 300; A.engG.gain.value = .08 + Math.abs(B.thr) * .12;
    const gb = BLD.find(q => q.kind === 'gen'); if (gb) setPan(A.gPan, gb.x, gb.fy + 1, gb.z); A.genG.gain.value = G.power ? .35 : 0;
    if (G.alarmT > 0) { G.alarmT -= dt; A.alarm.frequency.value = Math.sin(G.wt * 4) > 0 ? 620 : 470; A.alarmG.gain.value = .05; setPan(A.aPan, 0, LV[1] + 4, 0); } else A.alarmG.gain.value = 0;
    G.creakT = (G.creakT || 4) - dt; if (G.creakT <= 0) { G.creakT = 4 + Math.random() * 9; Snd.metal(at((Math.random() - .5) * 28, LV[Math.floor(Math.random() * 3)] + 2, (Math.random() - .5) * 28, 6)); }
    G.hornT = (G.hornT || 20) - dt; if (G.hornT <= 0) { G.hornT = 40; Snd.horn(at(G.lh[0], G.lh[1], G.lh[2], 60)); }
  }
}
function hud() {
  const b = $('bat'); for (let i = 0; i < 4; i++) b.children[i].className = P.bat > i * .25 + .02 ? '' : 'off'; b.classList.toggle('low', P.bat < .25);
  $('nFlare').textContent = P.flares; $('nSpd').textContent = Math.abs(B.v * 1.94).toFixed(0);
  const ot = objText(); if (ot !== G.objLast) { G.objLast = ot; $('obj').innerHTML = '<small>Objective</small>' + ot; $('obj').style.opacity = 1; G.objT = 9; }
  if (G.objT > 0) { G.objT -= 1 / 30; if (G.objT <= 0) $('obj').style.opacity = .45; }
  G.teamT = (G.teamT || 0) - 1; if ((PL.size > 1 || TEST) && G.teamT <= 0) { G.teamT = 10; $('team').innerHTML = [...PL.values()].map(p => `<div class="${p.dead ? 'dead' : p.down ? 'down' : ''}">${p.name}${p.down ? ' · DOWN ' + Math.max(0, p.bleed | 0) + 's' : p.sw ? ' · IN THE WATER' : p.seat ? ' · at the wheel' : p.ob ? ' · aboard' : ''}<i style="background:${hexS(CREW_COL[p.c % 6])}"></i></div>`).join(''); }
  const st = $('state');
  if (P.dead) { const s = specTarget(); st.innerHTML = (P.drowned ? 'You were pulled under' : 'You are dead') + `<small>${s ? 'Watching ' + s.name + ' · click to switch' : ''}</small>`; }
  else if (P.down) st.innerHTML = `You are down<small>Bleeding out in ${Math.max(0, P.bleed | 0)} s. Crawl to your crew or wait for help.</small>`;
  else if (P.seat) st.innerHTML = `<small style="font-size:12px">W/S throttle · A/D rudder · E let go · ${Math.abs(B.v * 1.94).toFixed(0)} kn</small>`;
  else if (P.sw) st.innerHTML = `In the water<small>Swim to a ladder: the rig dock, the boat's stern or the jetty end.</small>`;
  else st.innerHTML = '';
}
let grainT = 0; const gctx = $('grain').getContext('2d'), gimg = gctx.createImageData(200, 120);
function grain() { const d = gimg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gctx.putImageData(gimg, 0, 0); $('grain').style.opacity = .06 + (P ? P.fear || 0 : 0) * .12; }
function drawMap() {
  const c = $('map'), g = c.getContext('2d'), W = c.width, S = W / 360, X = x => W / 2 + x * S, Z = z => W * .18 - z * S;
  g.fillStyle = '#9aa8a8'; g.fillRect(0, 0, W, W); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(30,50,60,${Math.random() * .08})`; g.fillRect(Math.random() * W, Math.random() * W, 2, 2); }
  g.fillStyle = '#5a5248'; g.beginPath(); g.arc(X(ISLE.x), Z(ISLE.z), ISLE.r * S, 0, TAU); g.fill(); g.fillStyle = '#3a2a1c'; g.fillRect(X(-1.6), Z(-233), 3.2 * S, 17 * S);
  g.fillStyle = '#3a3a3a'; g.fillRect(X(-14), Z(13), 28 * S, 26 * S); g.fillRect(X(-8), Z(-16), 16 * S, 6 * S);
  g.font = '14px Georgia'; g.textAlign = 'center'; g.fillStyle = '#1a1a1a'; g.fillText('STATION NINE', X(0), Z(20)); g.fillText('Lighthouse station', X(ISLE.x), Z(ISLE.z) + 4); g.fillText('Jetty', X(10), Z(-240));
  g.font = 'italic 22px Georgia'; g.fillText('THE SOUND', W / 2, W - 30); g.font = '12px Georgia'; g.fillText('Tab: close', W / 2, W - 12);
  g.save(); g.translate(X(B.x), Z(B.z)); g.rotate(-B.yaw + PI); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -7 * S); g.lineTo(2.2 * S, 5 * S); g.lineTo(-2.2 * S, 5 * S); g.closePath(); g.fill(); g.restore();
  for (const p of PL.values()) { if (!p.ready || p.dead) continue; const yaw = p === P ? P.yaw : p.ryaw, x = p === P ? P.x : p.rx, z = p === P ? P.z : p.rz; g.save(); g.translate(X(x), Z(z)); g.rotate(-yaw + PI); g.fillStyle = hexS(CREW_COL[p.c % 6]); g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill(); g.restore(); }
}

// ---------------- game flow
let BUILT = false;
function buildWorld() {
  if (BUILT) return; BUILT = true;
  textures(); materials(); buildRig(); buildIsle(); buildSea(); buildBoat(); buildCreature(); buildNav();
  for (const k in BK) { const m = new THREE.Mesh(mergeGeos(BK[k]), MAT[k]); m.castShadow = !['glass', 'bulb', 'glassL', 'screen'].includes(k); m.receiveShadow = true; scene.add(m); }
  const avi = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); avi.scale.setScalar(3); avi.position.set(...G.avi); scene.add(avi); G.aviS = avi;
  const lg = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xfff0c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .8})); lg.scale.setScalar(12); lg.position.set(...G.lh); scene.add(lg);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(14, 160, 16, 1, true), new THREE.MeshBasicMaterial({color: 0xfff4d0, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false}));
  beam.geometry.translate(0, -80, 0); beam.geometry.rotateX(-PI / 2 + .04); const bg = new THREE.Group(); bg.add(beam); scene.add(bg); G.lhBeam = bg;
  // spines for the deep
  const sp = new THREE.Group(), sm = new THREE.MeshLambertMaterial({color: 0x0a0c0c}); for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(.5 + Math.sin(i / 8 * PI) * .5, 2 + Math.sin(i / 8 * PI) * 3, 6), sm); c.position.set(i * 2.4 - 10, 0, 0); c.rotation.z = -.4; sp.add(c); }
  const back = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 22, 4, 8), sm); back.rotation.z = PI / 2; back.position.y = -1.2; sp.add(back); sp.visible = false; scene.add(sp); G.spineM = sp;
  $('load').classList.add('hidden');
}
function startGame(seed, crew) {
  buildWorld(); aInit(); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  D = DIFF[G.diff || SET.diff] || DIFF.normal;
  RND.shadowMap.enabled = SET.gfx === 'high'; flash.castShadow = SET.gfx === 'high'; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  canvas.style.filter = SET.bright !== 1 ? `brightness(${SET.bright})` : '';
  G.seed = seed; WR = mulberry(seed); CR = mulberry(seed ^ 0x5bd1e995);
  Object.assign(G, {on: true, over: false, t: 0, ph: 0, evq: [], holdP: {}, overSent: false, allDownT: 0, noteOpen: false, paused: false, spec: 0, whT: 0, poseT: 0, sendT: 0, power: false, shapeDone: false, ramT: 20, spines: null, alarmT: 0, objLast: '', shake: 0});
  for (const f of G.flares) scene.remove(f.m); G.flares = []; VALVES.forEach(v => v.open = false); MAT.bulb.emissiveIntensity = 0; MAT.screen.emissiveIntensity = 0;
  Object.assign(B, {x: JETTY.x - 4.3, z: JETTY.z + 3, yaw: PI, v: 0, thr: 0, st: 0, driver: null, got: 0});
  for (const p of PL.values()) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); } PL.clear();
  syncCrew(crew);
  [...PL.values()].forEach((p, i) => { p.ob = 1; p.bl = [(i % 2 ? .9 : -.9), 1 + Math.floor(i / 2) * 1.2]; const [x, z] = bL2W(p.bl[0], p.bl[1]); p.x = x; p.z = z; p.y = BDECK.y; p.rx = x; p.ry = p.y; p.rz = z; p.lx = x; p.lz = z; p.yaw = B.yaw; });
  Object.assign(P, {ready: true, vx: 0, vz: 0, vy: 0, stam: 1, bat: 1, flares: 1, breath: 1, gasp: 0, bob: 0, stepD: 0, fear: 0, eye: 1.62, l: 1, cr: 0, hd: -1, sw: 0, seat: 0, lastBY: B.yaw, drowned: false});
  placeItems();
  Object.assign(M, {x: -4, z: 6, y: LV[2], state: 'roam', path: [], idle: 2, aware: 0, lostT: 0, flee: 0, sawHide: -1, stuck: 0, screamT: 0, spd: 0, look: 0, tgt: null, preyT: 0, avoidT: 0, vy: 0, wet: 0});
  M.tx = M.x; M.ty = M.y; M.tz = M.z; M.tyaw = 0;
  ['slats', 'breath', 'map', 'note', 'end', 'pause', 'menu', 'lobby'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); lockMouse();
  const it = $('intro'); it.innerHTML = 'Station Nine went quiet six days ago.<br>One distress call. Then nothing.<br><br>The storm is getting worse. Cast off.';
  it.classList.remove('hidden'); it.style.opacity = 1; setTimeout(() => it.style.opacity = 0, TEST ? 0 : 4000); setTimeout(() => it.classList.add('hidden'), TEST ? 0 : 6000);
}
function gameOver(e) {
  G.over = true; setTimeout(() => {
    try { document.exitPointerLock(); } catch (x) {}
    const mine = e.res.find(r => r[0] === P.name), iWon = mine && mine[1] === 'esc';
    $('end').className = 'scr' + (iWon ? '' : ' dead'); $('endT').textContent = iWon ? 'Made it back' : e.win ? 'Left behind' : 'Lost at sea';
    $('endS').textContent = `${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, '0')} · ${G.diff || SET.diff}`;
    $('endL').innerHTML = e.res.map(r => `<div><span style="color:${hexS(CREW_COL[r[2] % 6])}">■</span> ${r[0]} — ${({esc: 'made it back', dead: 'killed on the rig', drowned: 'pulled under', left: 'left behind'})[r[1]]}</div>`).join('');
    $('again').classList.toggle('hidden', Net.role === 'guest'); $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); G.on = false;
  }, 2500);
}
function step(dt) {
  if (isHost()) hostStep(dt);
  else { const k = Math.min(1, dt * 10); if (M.tx != null) { M.x = mix(M.x, M.tx, k); M.y = mix(M.y, M.ty, k); M.z = mix(M.z, M.tz, k); M.yaw += angD(M.yaw, M.tyaw) * k; } G.t += dt; }
  stepPlayer(dt); stepInteract(dt); stepFlares(dt);
  if (isHost() && P.ready) { P.lx = P.lx ?? P.x; }
  G.whT -= dt;
  if (Net.role !== 'solo') {
    if ((G.poseT -= dt) <= 0) { G.poseT = .05; const p = myPose(); if (isHost()) p.from = 'H'; Net.send(p); }
    if (Net.role === 'host' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 15; Net.send(packSnap()); }
  } else G.evq.length = 0;
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').style.opacity = 0; }
}
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, Math.max(0, (t - last) / 1000)); last = t;
  if (!BUILT) return;
  if (G.on && !(G.paused && Net.role === 'solo') && !(G.noteOpen && Net.role === 'solo')) step(dt);
  render(dt);
}
function render(dt) {
  if (!G.on && !G.over) { if (!G.drawn) { G.drawn = true; RND.render(scene, cam); } return; }
  updateWorldFx(dt); boatPose(dt); updateRemotes(dt); animCreature(dt, M.state, M.spd); updateCamera(dt); stepFear(dt); hud();
  if (G.map) drawMap(); if ((grainT += dt) > .05) { grainT = 0; grain(); }
  RND.render(scene, cam);
}

// ---------------- menu, lobby
const myName = () => (SET.name || 'Deckhand').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Deckhand';
function crewList() { return [{id: 'H', name: myName(), c: 0}, ...[...Net.peers.values()].map(p => ({id: p.id, name: p.name, c: p.c}))]; }
function show(id) { ['menu', 'lobby', 'end', 'pause'].forEach(k => $(k).classList.toggle('hidden', k !== id)); }
function lobby() { const L = crewList(); $('crew').innerHTML = L.map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === 'H' ? ' <small style="color:var(--dim)">host</small>' : ''}</div>`).join(''); if (Net.role === 'host') Net.send({t: 'lobby', crew: L}); }
function hostStart() { G.diff = SET.diff; const seed = (Math.random() * 1e9) | 0, crew = crewList(); Net.started = true; Net.meta(false); Net.send({t: 'start', seed, crew, diff: G.diff}); startGame(seed, crew); }
Net.on('_lobby', () => { if (!G.on) lobby(); });
Net.on('_join', m => { if (G.on && Net.role === 'host') { const crew = crewList(); syncCrew(crew); const np = PL.get(m.id); if (np) { np.ob = 1; np.bl = [0, 3.5]; } Net.send1(m.id, {t: 'start', seed: G.seed, crew, diff: G.diff, late: 1}); Net.send({t: 'crew', crew}); showMsg(`${np ? np.name : 'Someone'} joined the crew.`); } });
Net.on('_left', m => { if (!G.on) { lobby(); return; } const crew = crewList(); syncCrew(crew); Net.send({t: 'crew', crew}); showMsg(`${m.name || 'Someone'} left.`); });
Net.on('_hostgone', () => toMenu('The host left.'));
Net.on('lobby', m => { $('crew').innerHTML = (m.crew || []).map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${String(p.name).replace(/[<>&]/g, '')}</div>`).join(''); $('lmsg').textContent = 'Waiting for the host to cast off…'; });
Net.on('start', m => { G.diff = m.diff; startGame(m.seed, m.crew); if (m.late) { showMsg('You came aboard late.'); } });
Net.on('crew', m => { if (G.on) syncCrew(m.crew); });
Net.on('restart', m => { G.diff = m.diff; startGame(m.seed, m.crew); });
function toMenu(why) {
  Net.close(); G.on = false; G.over = false; show('menu'); $('hud').classList.add('hidden'); $('fearV').style.opacity = 0; $('downV').style.opacity = 0; $('slats').classList.add('hidden');
  if (A.ctx) { A.ctx.resume(); for (const g of [A.drone, A.mGrowl, A.mBreath.g, A.genG, A.alarmG]) g.gain.value = 0; }
  try { document.exitPointerLock(); } catch (e) {} $('err').textContent = why || ''; refreshRooms();
}
async function refreshRooms() { const L = await Net.rooms(), el = $('rooms'); el.innerHTML = L.length ? '' : '<small style="color:var(--dim)">No open crews right now. Host one and share the code.</small>'; for (const r of L) { const d = document.createElement('div'); d.textContent = r.name.replace(Net.tag + ' ', '') + (r.n ? ` · ${r.n}/6` : ''); d.onclick = () => joinRoom(r.code); el.appendChild(d); } }
function joinRoom(code) {
  code = String(code || '').toUpperCase(); if (!/^[A-Z]{5}$/.test(code)) { $('err').textContent = 'Enter the 5-letter code.'; return; }
  aInit(); buildWorld(); Net.join(code, myName(), why => { if (G.on) toMenu(why); else { show('menu'); $('err').textContent = why; } });
  $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); $('lmsg').textContent = 'Connecting…'; $('crew').innerHTML = '';
}
function menuInit() {
  document.querySelectorAll('.seg').forEach(s => { const k = s.dataset.k, upd = () => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === SET[k])); s.querySelectorAll('button').forEach(b => b.onclick = () => { SET[k] = b.dataset.v; saveSet(); upd(); }); upd(); });
  $('sens').value = SET.sens; $('sens').oninput = e => { SET.sens = +e.target.value; saveSet(); };
  $('bright').value = SET.bright; $('bright').oninput = e => { SET.bright = +e.target.value; saveSet(); };
  $('name').value = SET.name; $('name').oninput = e => { SET.name = e.target.value; saveSet(); };
  $('bSolo').onclick = () => { Net.close(); G.diff = SET.diff; startGame((Math.random() * 1e9) | 0, [{id: 'H', name: myName(), c: 0}]); };
  $('bHost').onclick = () => { aInit(); buildWorld(); const code = Net.host(myName(), s => { $('lmsg').textContent = s === 'open' ? 'Share the code. Up to 6 crew.' : 'Connection lost, retrying…'; }); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('lmsg').textContent = 'Connecting…'; lobby(); };
  $('bJoin').onclick = () => joinRoom($('joinC').value); $('joinC').onkeydown = e => { if (e.key === 'Enter') joinRoom($('joinC').value); };
  $('bGo').onclick = hostStart; $('bLeave').onclick = () => toMenu(); $('resume').onclick = () => pause(false); $('quit').onclick = () => toMenu(); $('endMenu').onclick = () => toMenu();
  $('again').onclick = () => { if (Net.role === 'guest') return; const seed = (Math.random() * 1e9) | 0, crew = Net.role === 'host' ? crewList() : [{id: 'H', name: myName(), c: 0}]; if (Net.role === 'host') Net.send({t: 'restart', seed, crew, diff: G.diff}); startGame(seed, crew); };
  $('note').onclick = closeNote;
  refreshRooms(); setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshRooms(); }, 8000);
}
menuInit();
setTimeout(() => { buildWorld(); requestAnimationFrame(frame); }, 30);
if (TEST) window.__S = {G, PL, M, B, K, SET, VALVES, ITEMS, HIDES, BLD, SPOTS, NG, SURF, Net, get P() { return P; }, startGame, step, hostStep, hostAct, act, targets, toggleHide, cam, scene, RND, noise, downPlayer, floorAt, navPath, applyEv, boatPose, set eDown(v) { eDown = v; }, crewList, hostStart, joinRoom};
