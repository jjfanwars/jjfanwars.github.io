// Station Nine: Open Sea. Online co-op exploration on a night sea: islands, wrecks, salvage, boat upgrades,
// an abandoned oil rig with something living on it, and something much bigger under the water.
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
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }

// ---------------- settings
const SET = Object.assign({diff: 'normal', sens: 1, bright: 1, gfx: 'high', name: ''}, (() => { try { return JSON.parse(localStorage.getItem('s9-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('s9-set', JSON.stringify(SET)); } catch (e) {} };
const DIFF = {
  easy:      {chase: 4.4, sight: 20, hear: .7,  checkP: .3,  breathHear: .1, lost: 2.5, roam: 30, react: .7,  bleed: 60, down: 14, drown: 20, ramDmg: 14, deep: .2, mhp: 100},
  normal:    {chase: 5.1, sight: 26, hear: 1,   checkP: .55, breathHear: .3, lost: 4,   roam: 24, react: .45, bleed: 45, down: 10, drown: 14, ramDmg: 22, deep: .3, mhp: 140},
  nightmare: {chase: 5.7, sight: 32, hear: 1.3, checkP: .8,  breathHear: .6, lost: 6,   roam: 18, react: .28, bleed: 30, down: 7,  drown: 9,  ramDmg: 32, deep: .45, mhp: 200},
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
// Rig (Station Nine) on (0, 0), home lighthouse island to the south, islands and wrecks scattered over about 1.6 km.
const LV = [1.8, 10, 17];
const JETTY = {x: 0, z: -238};
const HOME = {x: 0, z: -276, r: 30};
const LEGS = [[-11, -11], [11, -11], [-11, 11], [11, 11]];
const ISLES = [
  {n: 'Gull Rock', x: -420, z: -140, r: 42, top: 10, trees: 'pine'},
  {n: 'Palm Key', x: 380, z: -330, r: 48, top: 5, trees: 'palm'},
  {n: "Hermit's Isle", x: -300, z: 440, r: 56, top: 12, trees: 'pine', hut: 1},
  {n: 'Skull Reef', x: 540, z: 290, r: 34, top: 3.5, trees: 'palm', skull: 1},
  {n: 'Lantern Isle', x: -640, z: -470, r: 44, top: 8, trees: 'pine', ruin: 1},
  {n: 'Ashen Atoll', x: 170, z: 690, r: 62, top: 5, trees: 'dead', ring: 1},
  {n: 'Black Sands', x: -1350, z: 320, r: 72, top: 14, trees: 'pine', hut: 1},
  {n: 'Coral Crown', x: 1280, z: -720, r: 64, top: 5, trees: 'palm', ring: 1},
  {n: "Widow's Spire", x: 950, z: 1320, r: 52, top: 22, trees: 'dead', ruin: 1},
  {n: 'Frostbite Isle', x: -950, z: -1500, r: 82, top: 18, trees: 'pine'},
  {n: 'Sunken Bell Key', x: 1900, z: 620, r: 46, top: 4, trees: 'palm', hut: 1},
  {n: 'Ossuary Reef', x: -2000, z: -320, r: 40, top: 3.5, trees: 'dead', skull: 1},
];
const WRECKS = [
  {n: 'The Marguerite', x: -200, z: 250},
  {n: 'Trawler Sorrow', x: 650, z: -90},
  {n: 'The Grey Lady', x: -560, z: 170, ghost: 1},
  {n: 'Iron Maiden', x: 1520, z: 120},
  {n: 'The Lost Hope', x: -1120, z: 1020, ghost: 1},
  {n: 'SS Carthage', x: 320, z: -1700},
];
const SURF = [], WALLS = [], OBST = [], PCIRC = [], BLD = [], HIDES = [], SPOTS = [], INTER = [], LAMPS = [], DIGS = [], BUOYS = [], POIS = [];
const BK = {}; const bucket = k => BK[k] || (BK[k] = []);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function boxUV(g, sx, sy, sz, t) { const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } return g; }
function put(k, g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g; }
function wbox(k, x, y, z, sx, sy, sz, ry = 0, tile = 1.5) { return put(k, boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile), x, y, z, ry); }
function bx(k, x0, x1, y0, y1, z0, z1, tile) { return wbox(k, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, 0, tile); }
function slab(x0, x1, z0, z1, y, k = 'grate') { SURF.push({k: 'slab', x0, x1, z0, z1, y}); bx(k, x0, x1, y - .3, y, z0, z1, 2); bx('steel', x0, x1, y - .9, y - .3, z0 - .01, z0 + .25); bx('steel', x0, x1, y - .9, y - .3, z1 - .25, z1 + .01); }
function rail(x0, x1, z0, z1, y, k = 'yellow') {
  WALLS.push({x0, x1, z0, z1, y0: y, y1: y + 1.15, see: false});
  const along = x1 - x0 > z1 - z0, L = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.6));
  bx(k, x0, x1, y + 1.02, y + 1.1, z0, z1); bx(k, x0, x1, y + .52, y + .57, z0, z1);
  for (let i = 0; i <= n; i++) { const t = i / n, x = along ? mix(x0, x1, t) : (x0 + x1) / 2, z = along ? (z0 + z1) / 2 : mix(z0, z1, t); bx(k, x - .04, x + .04, y, y + 1.1, z - .04, z + .04); }
}
function ramp(x0, x1, z0, z1, y0, y1, ax, k = 'grate') {
  SURF.push({k: 'ramp', x0, x1, z0, z1, y0, y1, ax});
  const L = ax === 'x+' ? x1 - x0 : z1 - z0, n = Math.ceil(L / .32), rise = (y1 - y0) / n;
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n, y = y0 + rise * (i + .5) + .04;
    if (ax === 'x+') bx(k, mix(x0, x1, a), mix(x0, x1, b), y - .08, y, z0, z1); else bx(k, x0, x1, y - .08, y, mix(z0, z1, a), mix(z0, z1, b)); }
  for (let i = 1; i < n; i++) { const a = i / n, y = y0 + rise * i - .04; if (ax === 'x+') bx(k, mix(x0, x1, a) - .02, mix(x0, x1, a) + .02, y - Math.abs(rise), y, z0, z1); else bx(k, x0, x1, y - Math.abs(rise), y, mix(z0, z1, a) - .02, mix(z0, z1, a) + .02); }
  const sl = Math.hypot(L, y1 - y0), sa = Math.atan2(y1 - y0, L), lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  if (ax === 'x+') for (const z of [z0 - .05, z1 + .05]) { put('leg', new THREE.BoxGeometry(sl, .3, .08), (x0 + x1) / 2, (y0 + y1) / 2 - .1, z, 0, 0, sa); }
  else for (const x of [x0 - .05, x1 + .05]) { put('leg', new THREE.BoxGeometry(.08, .3, sl), x, (y0 + y1) / 2 - .1, (z0 + z1) / 2, 0, -sa, 0); }
  if (hi - lo > 1.2) for (const t of [.5, .97]) { const yt = mix(y0, y1, t) - .25, h = Math.max(0, mix(y0, y1, t) - lo - .25); if (h < .3) continue; const px = ax === 'x+' ? mix(x0, x1, t) : null, pz = ax === 'x+' ? null : mix(z0, z1, t);
    for (const sd of [0, 1]) { const x = ax === 'x+' ? px : (sd ? x1 + .05 : x0 - .05), z = ax === 'x+' ? (sd ? z1 + .05 : z0 - .05) : pz; put('leg', new THREE.BoxGeometry(.12, h, .12), x, lo + h / 2, z); } }
  for (let t = 0; t <= 1.001; t += 1 / Math.max(2, Math.round(sl / 1.2))) for (const sd of [0, 1]) { const x = ax === 'x+' ? mix(x0, x1, t) : (sd ? x1 : x0), z = ax === 'x+' ? (sd ? z1 : z0) : mix(z0, z1, t), y = mix(y0, y1, t); put('yellow', new THREE.CylinderGeometry(.025, .025, 1.05, 5), x, y + .52, z); }
  const yy0 = Math.min(y0, y1), yy1 = Math.max(y0, y1) + 1.1;
  if (ax === 'x+') for (const z of [z0 - .08, z1 + .08]) WALLS.push({x0: x0 + .6, x1: x1 - .6, z0: z - .05, z1: z + .05, y0: yy0 + .4, y1: yy1, see: false});
  else for (const x of [x0 - .08, x1 + .08]) WALLS.push({x0: x - .05, x1: x + .05, z0: z0 + .6, z1: z1 - .6, y0: yy0 + .4, y1: yy1, see: false});
  if (ax === 'x+') for (const z of [z0, z1]) for (const hh of [1.05, .55]) { const q = new THREE.CylinderGeometry(hh > 1 ? .035 : .022, hh > 1 ? .035 : .022, Math.hypot(x1 - x0, y1 - y0), 5); q.rotateZ(-PI / 2 + Math.atan2(y1 - y0, x1 - x0)); put('yellow', q, (x0 + x1) / 2, (y0 + y1) / 2 + hh, z); }
  else for (const x of [x0, x1]) for (const hh of [1.05, .55]) { const q = new THREE.CylinderGeometry(hh > 1 ? .035 : .022, hh > 1 ? .035 : .022, Math.hypot(z1 - z0, y1 - y0), 5); q.rotateX(PI / 2 - Math.atan2(y1 - y0, z1 - z0)); put('yellow', q, x, (y0 + y1) / 2 + hh, (z0 + z1) / 2); }
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
const BT = {quarters: {w: 8, d: 6, dx: 0, dw: 1.3, wh: 2.8}, gen: {w: 7, d: 6, dx: 1.5, dw: 1.6, wh: 3}, ctrl: {w: 8, d: 5.5, dx: 2, dw: 1.3, wh: 2.8}, hut: {w: 6, d: 5, dx: 1.2, dw: 1.2, wh: 2.5, wood: 1}, state: {w: 5.4, d: 8.4, dx: 0, dw: 1.1, wh: 3.4, wm: 'wallp', fm: 'carpet'}, bridge: {w: 14, d: 6, dx: 0, dw: 1.4, wh: 3.2, wm: 'white'}, cabin: {w: 5, d: 4.4, dx: 0, dw: 1.2, wh: 2.3, wood: 1}, shed: {w: 7, d: 5, dx: 0, dw: 1.6, wh: 3, wood: 1}};
function building(kind, name, x, z, y, door) {
  const T = BT[kind], b = {kind, name, x, z, th: ROT[door], w: T.w, d: T.d, wh: T.wh, fy: y, i: BLD.length}; BLD.push(b);
  const t = .16, hw = b.w / 2, hd = b.d / 2, wh = b.wh, dl = T.dx - T.dw / 2, dr = T.dx + T.dw / 2, wm = T.wm || (T.wood ? 'planks' : 'plate');
  const wall = (lx, lz, sx, sz) => { lbox(b, wm, lx, wh / 2, lz, sx, wh, sz); const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: y, y1: y + wh, see: true})); };
  wall(0, hd, b.w + t, t); wall(-hw, 0, t, b.d); wall(hw, 0, t, b.d);
  wall((-hw - t / 2 + dl) / 2, -hd, dl + hw + t / 2, t); wall((hw + t / 2 + dr) / 2, -hd, hw + t / 2 - dr, t);
  lbox(b, wm, T.dx, (2.1 + wh) / 2, -hd, T.dw, wh - 2.1, t);
  lbox(b, T.wood ? 'log' : 'hazard', T.dx, 2.12, -hd, T.dw + .3, .12, t + .06);
  lbox(b, 'door', dr + .03, 1.02, -hd + T.dw / 2 + .1, .05, 2.02, T.dw - .04);
  lbox(b, T.wood ? 'roofW' : 'plate', 0, wh + .08, 0, b.w + .5, .16, b.d + .5);
  lbox(b, T.fm || (T.wood ? 'planks' : 'floorP'), 0, .03, 0, b.w, .06, b.d, 0, 1.2);
  for (const s of [-1, 1]) lbox(b, 'glass', s * hw, 1.6, -.6, t + .05, .5, 1.1);
  b.lamp = L2W(b, 0, 0); if (!T.wood && !T.wm) LAMPS.push([b.lamp[0], y + wh - .3, b.lamp[1], 1]);
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
  const r = rectW(b, lx - .3, lx + .3, lz - .3, lz + .3); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + 1.95, see: false}));
  hide(b, lx, lz, face);
}
function furnish(b) {
  const hw = b.w / 2, hd = b.d / 2, L = (lx, ly, lz) => { const [x, z] = L2W(b, lx, lz); return [x, b.fy + ly, z]; };
  const solid = (lx, lz, sx, sz, h) => { const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + h, see: false})); };
  if (b.kind === 'state') {
    lbox(b, 'white', -hw + 1.2, .35, 1.6, 1.9, .5, 2.4); lbox(b, 'fabric', -hw + 1.2, .62, 1.6, 1.8, .1, 2.3); solid(-hw + 1.2, 1.6, 1.9, 2.4, .7);
    lbox(b, 'wood', hw - .6, .4, 2.6, .9, .8, .5); solid(hw - .6, 2.6, .9, .5, .8); spot(b.capt ? 'capt' : 'cruise', ...L(hw - .6, .82, 2.6)); spot('cruise', ...L(-hw + 1.2, .7, 2.4));
    locker(b, hw - .45, .6, -PI / 2); lbox(b, 'glass', 0, 1.7, hd - .1, 1.6, 1, .05);
  } else if (b.kind === 'bridge') {
    lbox(b, 'dark', 0, .55, hd - .9, 5, 1.1, .8); solid(0, hd - .9, 5, .8, 1.1); b.console = L(0, 1.2, hd - 1.5); lbox(b, 'glass', 0, 1.8, hd - .02, b.w - .6, 1.2, .05);
    const wg = new THREE.Mesh(new THREE.TorusGeometry(.42, .04, 8, 24), MAT.brass); const [wx, wz] = L2W(b, 0, hd - 1.38); wg.position.set(wx, b.fy + 1.25, wz); wg.rotation.set(0, b.th, 0); scene.add(wg);
    locker(b, -hw + .5, 0, PI / 2); locker(b, hw - .5, 0, -PI / 2);
  } else if (b.kind === 'quarters') {
    for (const s of [-1, 1]) { lbox(b, 'steel', s * (hw - .55), .4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), .5, 1.6, .9, .12, 1.9); lbox(b, 'steel', s * (hw - .55), 1.4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), 1.5, 1.6, .9, .12, 1.9); solid(s * (hw - .55), 1.6, 1, 2, 1.6); }
    locker(b, -1.2, hd - .35, PI); locker(b, -.5, hd - .35, PI); locker(b, 1.2, hd - .35, PI);
    lbox(b, 'steel', -2.4, .75, -1.4, 1.2, .06, .8); solid(-2.4, -1.4, 1.2, .8, .8); spot('rig', ...L(-2.4, .8, -1.4)); spot('rig', ...L(hw - .55, .58, 1.2));
  } else if (b.kind === 'gen') {
    lbox(b, 'genM', -.8, .8, 1.2, 3.2, 1.6, 1.6); solid(-.8, 1.2, 3.2, 1.6, 1.6); lbox(b, 'dark', -.8, 1.62, 1.2, 2.6, .05, 1.1);
    for (let i = 0; i < 3; i++) lbox(b, 'steel', -2 + i * .6, 1.9, 1.2, .18, .6, .18);
    lbox(b, 'panel', 2.6, 1.3, 1.6, .9, 1.4, .3); b.genP = L(-.8, 1.2, -.2);
    locker(b, -hw + .35, -1.2, -PI / 2); spot('rig', ...L(2.6, .9, -1.6)); lbox(b, 'steel', 2.6, .45, -1.6, 1, .9, .6); solid(2.6, -1.6, 1, .6, .9);
  } else if (b.kind === 'ctrl') {
    lbox(b, 'panel', 0, .55, hd - .5, 6, 1.1, .7); solid(0, hd - .5, 6, .7, 1.1); lbox(b, 'screen', 0, 1.2, hd - .7, 5, .35, .05);
    for (let i = 0; i < 4; i++) lbox(b, 'screen', -2.4 + i * 1.6, 1.13, hd - .78, .9, .4, .03, 0);
    b.console = L(-1, 1.1, hd - 1.1); locker(b, -hw + .35, -1.2, -PI / 2); spot('rig', ...L(2.6, 1.12, hd - .55)); spot('rig', ...L(-2, .1, -1.6));
  } else if (b.kind === 'hut') {
    lbox(b, 'log', -hw + .55, .3, 1, 1, .5, 2); lbox(b, 'fabric', -hw + .55, .6, 1, .9, .1, 1.9); solid(-hw + .55, 1, 1, 2, .7);
    lbox(b, 'log', 1.4, .4, 1.4, 1.4, .8, .8); solid(1.4, 1.4, 1.4, .8, .8); spot('hut', ...L(1.4, .82, 1.4)); spot('hut', ...L(-1, .1, -1.2));
    locker(b, hw - .35, -1, PI / 2);
  } else if (b.kind === 'cabin') {
    lbox(b, 'log', 0, .35, hd - .5, 3, .7, .8); solid(0, hd - .5, 3, .8, .7); spot('wreck', ...L(.6, .72, hd - .5)); locker(b, hw - .35, -.6, PI / 2);
  } else if (b.kind === 'shed') {
    lbox(b, 'log', 0, .5, hd - .5, 5, 1, .8); solid(0, hd - .5, 5, .8, 1); lbox(b, 'paper', 0, 1.4, hd - .1, 3, 1.2, .03);
    b.shop = L(0, 1.1, hd - 1.2);
    for (const s of [-1, 1]) { lbox(b, 'crate', s * 2.6, .4, 0, .8, .8, .8); solid(s * 2.6, 0, .8, .8, .8); }
  }
}
const VALVES = [];
function valve(x, y, z, name, ry) { put('red', new THREE.TorusGeometry(.32, .05, 6, 16), x, y + 1.15, z, ry); put('steel', new THREE.CylinderGeometry(.12, .12, 1.2, 8), x, y + .55, z); wbox('pipe', x, y + .85, z + .1, .3, .3, 2.6, ry); VALVES.push({x, y, z, name, open: false}); }
function buildRig() {
  for (const [x, z] of LEGS) { put('leg', new THREE.CylinderGeometry(1.4, 1.6, 50, 14), x, -15, z); OBST.push({c: 1, x, z, r: 2.1}); PCIRC.push({x, z, r: 1.6}); }
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) for (const y of [-2, 5]) { const [x0, z0] = LEGS[a], [x1, z1] = LEGS[b]; wbox('leg', (x0 + x1) / 2, y, (z0 + z1) / 2, x0 === x1 ? .5 : 22, .5, z0 === z1 ? .5 : 22); }
  slab(-8, 8, -23, -16, LV[0], 'wood'); slab(4, 8, -16, -14.4, LV[0], 'wood'); for (const x of [-7.5, 0, 7.5]) for (const z of [-22.5, -16.5]) put('leg', new THREE.CylinderGeometry(.35, .35, 6, 8), x, LV[0] - 3.2, z);
  OBST.push({x0: -8.4, x1: 8.4, z0: -22.4, z1: -14});
  rail(-8, -8, -23, -16, LV[0]); rail(8, 8, -23, -16, LV[0]); rail(-8, 4, -16, -16, LV[0]); rail(4, 8, -14.4, -14.4, LV[0]); rail(4, 4, -16, -14.4, LV[0]);
  for (const x of [-6, -2, 2, 6]) put('dark', new THREE.CylinderGeometry(.18, .22, .5, 8), x, LV[0] + .25, -22.7);
  for (let y = -1.2; y < LV[0]; y += .35) wbox('yellow', 0, y, -23.2, .6, .05, .05); INTER.push({kind: 'ladder', x: 0, y: 0, z: -23.6, r: 3.5, top: [0, LV[0], -22], label: () => 'Climb the ladder', on: () => P.sw});
  valve(-6, LV[0], -18.2, 'dock fuel valve', 0); wbox('crate', 4, LV[0] + .4, -18.5, 1.2, .8, 1); WALLS.push({x0: 3.4, x1: 4.6, z0: -19, z1: -18, y0: LV[0], y1: LV[0] + .8, see: false}); spot('rig', 4, LV[0] + .8, -18.5);
  ramp(8, 20, -16, -14.4, LV[0], LV[1], 'x+');
  slab(20, 24, -18, -9, LV[1]); slab(14, 20, -13, -9, LV[1]);
  rail(24, 24, -18, -9, LV[1]); rail(20, 24, -18, -18, LV[1]); rail(14, 24, -9, -9, LV[1]); rail(14, 20, -13, -13, LV[1]); rail(20, 20, -18, -16, LV[1]);
  slab(-14, 14, -13, 13, LV[1]);
  rail(-14, 14, -13, -13, LV[1]); rail(-14, 14, 13, 13, LV[1]); rail(-14, -14, -13, 13, LV[1]); rail(14, 14, -9, 13, LV[1]);
  ramp(1, 2.6, -9, 2, LV[1], LV[2], 'z+');
  slab(-14, 3, 2, 13, LV[2]);
  rail(-14, 3, 13, 13, LV[2]); rail(-14, -14, 2, 13, LV[2]); rail(3, 3, 2, 13, LV[2]); rail(-14, .9, 2, 2, LV[2]);
  for (const [x, z] of [[-13.5, 2.5], [2.5, 2.5], [-13.5, 12.5], [2.5, 12.5], [-6, 2.5]]) wbox('steel', x, (LV[1] + LV[2]) / 2 - .15, z, .35, LV[2] - LV[1] - .3, .35);
  for (const [x, z] of [[-6, 2.5], [-13.5, 2.5]]) WALLS.push({x0: x - .2, x1: x + .2, z0: z - .2, z1: z + .2, y0: LV[1], y1: LV[2] - .3, see: true});
  building('quarters', 'Crew quarters', 8, 6, LV[1], 'w');
  building('gen', 'Generator room', -8, -5.5, LV[1], 'e');
  building('ctrl', 'Control room', -6.5, 9.6, LV[2], 's');
  valve(-12.4, LV[1], 7, 'main deck fuel valve', PI / 2);
  const dx = 6, dz = -6, dy = LV[1];
  for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const g = new THREE.CylinderGeometry(.12, .16, 28, 6); g.translate(0, 14, 0); g.rotateX(b * -.035); g.rotateZ(a * .035); put('steel', g, dx + a, dy, dz + b); }
  for (let y = 2; y < 27; y += 3) { const w = 4 - y * .1; wbox('steel', dx, dy + y, dz - w / 2, w, .1, .1); wbox('steel', dx, dy + y, dz + w / 2, w, .1, .1); wbox('steel', dx - w / 2, dy + y, dz, .1, .1, w); wbox('steel', dx + w / 2, dy + y, dz, .1, .1, w); }
  WALLS.push({x0: dx - 2.2, x1: dx + 2.2, z0: dz - 2.2, z1: dz + 2.2, y0: dy, y1: dy + 3, see: false}); bx('steel', dx - 2.2, dx + 2.2, dy, dy + .6, dz - 2.2, dz + 2.2);
  wbox('pipe', dx, dy + 1.8, dz, .5, 3.6, .5); spot('rig', dx - 2.6, dy + .05, dz + 2.6); G.avi = [dx, dy + 28.5, dz];
  wbox('steel', 20, LV[1] + 6, 4, 18, .5, .5, -.3); wbox('steel', 28, LV[1] + 10, 6, .8, .8, .8);
  for (const [x, z, c, r] of [[-9, -11.6, 'cont', 0], [10, -11.4, 'cont2', 0], [12, -3, 'cont', PI / 2]]) { wbox(c, x, LV[1] + 1.3, z, 6, 2.6, 2.4, r, 3); const w = r ? 2.4 : 6, d = r ? 6 : 2.4; WALLS.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: LV[1], y1: LV[1] + 2.6, see: true}); }
  spot('rig', -5.5, LV[1] + .05, -10); spot('rig', 12.8, LV[1] + .05, 6);
  for (let i = 0; i < 4; i++) wbox('pipe', -2 + i * .55, LV[1] + .4, 0, .4, .4, 9); WALLS.push({x0: -2.3, x1: 0, z0: -4.5, z1: 4.5, y0: LV[1], y1: LV[1] + .8, see: false});
  wbox('orange', -11, LV[2] + 1, 4, 2.4, 1.6, 4.6, 0); WALLS.push({x0: -12.2, x1: -9.8, z0: 1.7, z1: 6.3, y0: LV[2], y1: LV[2] + 2, see: true}); spot('rig', -9.2, LV[2] + .05, 3);
  spot('rig', 1.5, LV[2] + .05, 12.2); spot('rig', 20.8, LV[1] + .05, -10.2); spot('rig', -7, LV[0] + .05, -21);
  for (const [x, y, z] of [[13.5, LV[1] + 3, -12.5], [-13.5, LV[1] + 3, -12.5], [13.5, LV[1] + 3, 12.5], [-13.5, LV[2] + 3, 12.5], [0, LV[0] + 3, -16.5], [20, LV[1] + 3, -17.5], [0, LV[1] + 3, 0]]) { wbox('steel', x, y - 1.5, z, .12, 3, .12); put('bulb', new THREE.BoxGeometry(.6, .3, .3), x, y + .1, z); LAMPS.push([x, y, z, 1.6]); }
  POIS.push({n: 'Station Nine', x: 0, z: 0, r: 40, rig: 1});
}
function buildHome() {
  put('rock', new THREE.CylinderGeometry(HOME.r * .7, HOME.r, 14, 22, 2), HOME.x, -5, HOME.z);
  OBST.push({c: 1, x: HOME.x, z: HOME.z, r: HOME.r + 1});
  SURF.push({k: 'disc', x: HOME.x, z: HOME.z, r: HOME.r * .7 - .2, y: 2, x0: HOME.x - 21, x1: HOME.x + 21, z0: HOME.z - 21, z1: HOME.z + 21});
  SURF.push({k: 'slab', x0: -2.5, x1: 2.5, z0: -256, z1: -233, y: 1.6}); bx('wood', -2.5, 2.5, 1.3, 1.6, -256, -233, 1.5);
  OBST.push({x0: -2, x1: 2, z0: -256, z1: -232.6});
  for (const z of [-249, -245, -241, -237, -233.5]) for (const x of [-2.2, 2.2]) put('log', new THREE.CylinderGeometry(.15, .15, 4, 6), x, -.5, z);
  INTER.push({kind: 'ladder', x: 0, y: 0, z: -232.3, r: 3.5, top: [0, 1.6, -234], label: () => 'Climb the ladder', on: () => P.sw});
  const lx = 6, lz = -284; put('white', new THREE.CylinderGeometry(2.2, 3.4, 26, 18), lx, 15, lz); for (let y = 6; y < 26; y += 6) put('red', new THREE.CylinderGeometry(3.4 - y * .05, 3.5 - y * .05, 1.6, 18), lx, 2 + y, lz);
  put('glassL', new THREE.CylinderGeometry(1.8, 1.8, 2.2, 12), lx, 29.2, lz); put('dark', new THREE.ConeGeometry(2.3, 1.6, 12), lx, 31.1, lz); PCIRC.push({x: lx, z: lz, r: 3.6});
  G.lh = [lx, 29.2, lz];
  G.shed = building('shed', 'Harbour shed', -9, -265, 2, 'e');
  POIS.push({n: 'Lighthouse station', x: HOME.x, z: HOME.z, r: 40, home: 1});
}
// islands: noisy domes (an atoll is a ring) walkable from the beach
const IPADS = [];
function isleH(I, x, z, clean) {
  const d = Math.hypot(x - I.x, z - I.z) / I.r; if (d > 1.4) return -9;
  let h;
  if (I.ring) { const p = Math.exp(-((d - .75) ** 2) / .03); h = d < .75 ? mix(-1.4, I.top, p) : mix(-4.5, I.top, p); }
  else h = mix(-4.5, I.top, 1 - smooth((d - .3) / .85));
  if (!clean) { const k = clamp((h + 1) / 3, 0, 1); h += (fbm(x * .035 + I.x * .01, z * .035) - .5) * (2 + I.top * .6) * k; }
  for (const p of IPADS) { if (p.I !== I) continue; const e = Math.hypot(x - p.x, z - p.z); if (e < p.r + p.f) { const w = e < p.r ? 1 : smooth(1 - (e - p.r) / p.f); h = mix(h, p.h, w); } }
  return h;
}
function seaBed(x, z) { const h = landH(x, z); if (h > -9) return h; let d = Math.min(Math.hypot(x, z) - 45, Math.hypot(x - HOME.x, z - HOME.z) - 60); for (const I of ISLES) d = Math.min(d, Math.hypot(x - I.x, z - I.z) - I.r * 1.4); let b = -9 - 21 * smooth(clamp(d / 150, 0, 1)) - 25 * smooth(clamp((Math.hypot(x, z + 60) - 900) / 900, 0, 1)) + (fbm(x * .02, z * .02) - .5) * 3; for (const q of DSITES) { const e = Math.hypot(x - q.x, z - q.z) / q.r; if (e < 2) b = Math.min(b, -q.d * (1 - smooth(clamp(e - .3, 0, 1)))); } return b; }
const SUNK = [];
function placeSunk(seed) { for (const q of SUNK) scene.remove(q.m); SUNK.length = 0; const r = mulberry(seed ^ 0x51ab);
  const put = (x, z, kind) => { const y = seaBed(x, z), m = itemMesh(kind); m.scale.setScalar(1.6); m.position.set(x, y + .2, z); m.rotation.set(.3, r() * TAU, .2);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x7affd0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); gl.scale.setScalar(5); gl.position.set(0, .6, 0); m.add(gl); scene.add(m); SUNK.push({x, z, y, kind, m, got: false}); };
  for (const q of DSITES) for (let i = 0; i < 12; i++) { const a = r() * TAU, d = Math.sqrt(r()) * q.r * .8; put(q.x + Math.sin(a) * d, q.z + Math.cos(a) * d, ['gold', 'pearl', 'pearl', 'chest', 'relic', 'gold'][Math.floor(r() * 6)]); }
  for (let k = 0; k < 900 && SUNK.length < 36 + 22; k++) { const a = r() * TAU, d = 150 + r() * 2200, x = Math.sin(a) * d, z = -60 + Math.cos(a) * d; if (Math.hypot(x, z + 60) > 2550 || seaBed(x, z) > -17 || SUNK.some(q => Math.hypot(q.x - x, q.z - z) < 90)) continue;
    const kind = r() < .45 ? 'chest' : r() < .5 ? 'blackbox' : 'relic', y = seaBed(x, z), m = itemMesh(kind); m.scale.setScalar(1.6); m.position.set(x, y + .2, z); m.rotation.set(.3, r() * TAU, .2);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x7affd0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); gl.scale.setScalar(5); gl.position.set(0, .6, 0); m.add(gl); scene.add(m); SUNK.push({x, z, y, kind, m, got: false}); } }
function landH(x, z) { let h = -9; for (const I of ISLES) { if (Math.abs(x - I.x) > I.r * 1.4 || Math.abs(z - I.z) > I.r * 1.4) continue; h = Math.max(h, isleH(I, x, z)); } return h; }
function colGeo(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = .75 + .25 * h2(i, 7); a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function mergeC(list) { const qs = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; qs.forEach(q => n += q.attributes.position.count); const p = new Float32Array(n * 3), no = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0; for (const q of qs) { p.set(q.attributes.position.array, o * 3); no.set(q.attributes.normal.array, o * 3); c.set(q.attributes.color.array, o * 3); o += q.attributes.position.count; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(no, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
function palmGeo() {
  const parts = []; let x = 0, y = 0;
  for (let i = 0; i < 6; i++) { const s = new THREE.CylinderGeometry(.14 - i * .01, .17 - i * .01, 1.3, 6); s.rotateZ(-.08 * i); s.translate(x, y + .65, 0); parts.push(colGeo(s, [.35, .27, .18])); x += Math.sin(.08 * i) * 1.3; y += 1.25; }
  for (let i = 0; i < 8; i++) { const f = new THREE.BoxGeometry(.5, .04, 3); f.translate(0, 0, 1.5); f.rotateX(.45 + (i % 2) * .2); f.rotateY(i / 8 * TAU); f.translate(x, y, 0); parts.push(colGeo(f, [.14, .3, .1])); }
  return mergeC(parts);
}
function pineGeo() { const parts = []; const tr = new THREE.CylinderGeometry(.12, .3, 9, 6); tr.translate(0, 4.5, 0); parts.push(colGeo(tr, [.22, .16, .11])); for (let i = 0; i < 5; i++) { const c = new THREE.ConeGeometry(2.2 - i * .38, 2.6, 7); c.translate(0, 2.6 + i * 1.5 + 1.3, 0); parts.push(colGeo(c, [.08, .15, .1])); } return mergeC(parts); }
function deadGeo() { const parts = []; const tr = new THREE.CylinderGeometry(.08, .26, 7, 5); tr.translate(0, 3.5, 0); parts.push(colGeo(tr, [.18, .16, .15])); for (let i = 0; i < 6; i++) { const b = new THREE.CylinderGeometry(.02, .06, 2.2, 4); b.translate(0, 1.1, 0); b.rotateZ(1 + h2(i, 3) * .5); b.rotateY(i * 2.1); b.translate(0, 2.2 + i * .8, 0); parts.push(colGeo(b, [.18, .16, .15])); } return mergeC(parts); }
function buildIsleSites() {
  for (const I of ISLES) {
    if (I.hut) { const x = I.x + 6, z = I.z + 4; IPADS.push({I, x, z, r: 5, f: 5, h: isleH(I, x, z) + .1}); }
    for (let k = 0, c = 0; k < 60 && c < Math.round(I.r / 12) + 1; k++) { const a = R() * TAU, d = (.2 + R() * .6) * I.r, x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, h = isleH(I, x, z); if (h < .6) continue; c++; spot('isle', x, h + .05, z); }
    if (I.hut) { const p = IPADS.find(q => q.I === I); building('hut', "Hermit's hut", p.x, p.z, p.h, 'w'); }
    if (I.ruin) { const x = I.x - 4, z = I.z + 3, y = isleH(I, x, z); put('white', new THREE.CylinderGeometry(2.6, 3.2, 9, 14, 1, true), x, y + 4, z); put('dark', new THREE.CylinderGeometry(2.4, 2.4, .3, 14), x, y + 8.4, z); PCIRC.push({x, z, r: 3.3}); spot('isle', x + 4, y + .05, z); }
    if (I.skull) { for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, x = I.x + Math.cos(a) * 9, z = I.z + Math.sin(a) * 9; wbox('rock', x, isleH(I, x, z) + .8, z, 1.6, 2, 1.4, a, 1.5); } put('white', new THREE.SphereGeometry(1.4, 10, 8), I.x, isleH(I, I.x, I.z) + .8, I.z); }
  }
  // buried treasure: cairns of stones on three islands
  for (const [ii, dx, dz] of [[3, 4, -6], [1, -12, 10], [4, 10, 8]]) { const I = ISLES[ii], x = I.x + dx, z = I.z + dz, y = isleH(I, x, z); DIGS.push({x, y, z, isle: I.n, dug: false, rev: false}); for (let k = 0; k < 5; k++) wbox('rock', x + Math.cos(k * 1.3) * .5, y + .15, z + Math.sin(k * 1.3) * .5, .4, .3, .35, k); }
}
function buildIsles() {
  for (const W of WRECKS) ISLES.push({n: W.n, x: W.x + 12, z: W.z, r: 24, top: .5, bar: 1, w: W});
  for (const I of ISLES) {
    let lo = 0, hi = 1.4; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (isleH(I, I.x + m * I.r, I.z, true) > -.9) lo = m; else hi = m; } I.shore = lo * I.r;
    OBST.push({c: 1, x: I.x, z: I.z, r: I.shore, isle: I});
    if (!I.bar) POIS.push({n: I.n, x: I.x, z: I.z, r: I.shore + 10, isle: I});
  }
  const rings = 30, segs = 80, pos = [], col = [], idx = [];
  for (const I of ISLES) {
    const base = pos.length / 3;
    for (let i = 0; i <= rings; i++) { const d = 1.4 * Math.pow(i / rings, .85) * I.r; for (let j = 0; j < segs; j++) { const a = j / segs * TAU, x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, h = isleH(I, x, z); pos.push(x, h, z);
      const n = h2(x * .3, z * .3) * .08; let c; if (h < .2) c = [.32, .29, .22]; else if (h < 1.4) c = [.55 + n, .49 + n, .36]; else if (I.trees === 'dead') c = [.18 + n, .17, .16]; else if (h > I.top * .8 && I.top > 6) c = [.33 + n, .32 + n, .3]; else c = [.16 + n, .24 + n, .12]; col.push(...c); } }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs, c = a + segs, d = b + segs; idx.push(a, b, c, b, d, c); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, side: THREE.DoubleSide})); m.receiveShadow = true; scene.add(m);
  const T = {palm: [], pine: [], dead: []};
  for (const I of ISLES) { if (I.bar) continue; const n = Math.round(I.r * I.r / 55);
    for (let k = 0, c = 0; k < n * 6 && c < n; k++) { const a = R() * TAU, d = Math.sqrt(R()) * I.r, x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, h = isleH(I, x, z); if (h < 1.3) continue; if (IPADS.some(p => p.I === I && Math.hypot(x - p.x, z - p.z) < p.r + 2)) continue; if (DIGS.some(q => Math.hypot(x - q.x, z - q.z) < 4) || SPOTS.some(q => Math.hypot(x - q.x, z - q.z) < 2)) continue; c++; T[I.trees].push([x, h - .2, z, .7 + R() * .6, R() * TAU]); PCIRC.push({x, z, r: .35, tree: 1}); } }
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, flatShading: true});
  const inst = (geo, list) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0); list.forEach((t, i) => { Q.setFromAxisAngle(UP, t[4]); M4.compose(V.set(t[0], t[1], t[2]), Q, S3.setScalar(t[3])); im.setMatrixAt(i, M4); }); im.castShadow = true; im.computeBoundingSphere(); scene.add(im); };
  inst(palmGeo(), T.palm); inst(pineGeo(), T.pine); inst(deadGeo(), T.dead);
}
function buildWrecks() {
  G.ghostLights = [];
  for (const W of WRECKS) {
    const x = W.x, z = W.z, dy = 2.2;
    const sh = new THREE.Shape(); sh.moveTo(-3.6, 13); sh.lineTo(3.6, 13); sh.lineTo(3.8, -6); sh.quadraticCurveTo(2.5, -13, 0, -16); sh.quadraticCurveTo(-2.5, -13, -3.8, -6); sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, {depth: 5.5, bevelEnabled: false}); hg.rotateX(PI / 2); hg.translate(0, dy, 0); put(W.ghost ? 'ghostH' : 'rustH', hg, x, -.3, z, 0, .02, .06);
    slab(x - 3.4, x + 3.4, z - 10, z + 12, dy, 'planks');
    for (let i = 0; i < 6; i++) if (i !== 2 && i !== 4) rail(x - 3.5, x - 3.4, z - 10 + i * 3.7, z - 10 + i * 3.7 + 3.5, dy, 'rustR');
    for (let i = 0; i < 6; i++) if (i !== 3) rail(x + 3.4, x + 3.5, z - 10 + i * 3.7, z - 10 + i * 3.7 + 3.5, dy, 'rustR');
    WALLS.push({x0: x - 3.6, x1: x + 3.6, z0: z - 16, z1: z - 10, y0: dy - .2, y1: dy + 2.5, see: true});
    ramp(x + 3.4, x + 10, z + 1, z + 3, dy, .4, 'x+', 'planks');
    wbox('log', x, dy + 5, z - 4, .3, 10, .3, 0); wbox('log', x, dy + 8, z - 4, 6, .2, .2, .3); PCIRC.push({x, z: z - 4, r: .3});
    const cab = building('cabin', W.n + ' cabin', x, z + 8.5, dy, 'n'); cab.wreck = W;
    spot('wreck', x - 2, dy + .05, z - 6); spot('wreck', x + 2.2, dy + .05, z + 2); spot('wreck', x + 7, .5, z + 6);
    POIS.push({n: W.n, x, z, r: 30, wreck: W});
    if (W.ghost) for (let i = 0; i < 5; i++) G.ghostLights.push([x + (i % 2 ? 3.7 : -3.7), dy - 1, z - 8 + i * 4]);
  }
}
function buildBuoys() {
  for (let k = 0; k < 300 && BUOYS.length < 16; k++) {
    const x = (R() * 2 - 1) * 720, z = (R() * 2 - 1) * 720 - 60;
    if (OBST.some(o => o.c && Math.hypot(x - o.x, z - o.z) < o.r + 50) || Math.hypot(x, z) < 70 || BUOYS.some(b => Math.hypot(b.x - x, b.z - z) < 140)) continue;
    BUOYS.push({x, z, c: [0xff2a1a, 0x2aff4a, 0xffd02a][BUOYS.length % 3]}); OBST.push({c: 1, x, z, r: 1.2});
  }
}

// ---------------- three
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25)); RND.shadowMap.autoUpdate = false; RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.15;
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0e14); scene.fog = new THREE.FogExp2(0x0a0e14, .01);
const cam = new THREE.PerspectiveCamera(70, 1, .05, 1600); scene.add(cam);
function resize() { RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0a0c10, .5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9aaccc, .5); scene.add(moon, moon.target);
moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, {left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400}); moon.shadow.bias = -.0005; moon.shadow.normalBias = .05;
const MOONDIR = new THREE.Vector3(-.4, .55, .7).normalize(), SUNDIR = new THREE.Vector3(0, .2, 1), KEYDIR = new THREE.Vector3(0, 1, 0);
// time of day: 0 golden hour, .16 sunset, .26 dusk, .36-.72 night, .82 dawn, .9 sunrise, 1 = golden hour again (16 minute loop)
const TODK = [
  [0, 14, 235, 0x3d66aa, 0xe8a07a, 0x9a8a92, .0011, 0xffc48a, 2.8, 0x8aa0c8, 0x3a3028, .85, 0],
  [.16, 2.5, 252, 0x23397a, 0xff5a24, 0xb8705a, .0013, 0xff7a40, 2.2, 0x6a74a8, 0x3a2420, .7, 0],
  [.26, -5, 262, 0x0d1236, 0x7a3048, 0x2a1e2c, .0022, 0xc06070, .5, 0x3a4878, 0x181418, .55, .45],
  [.36, -24, 300, 0x020309, 0x0c121e, 0x06090f, .0048, 0x9aaccc, .55, 0x4a5a78, 0x0a0c10, .5, 1],
  [.72, -24, 400, 0x020309, 0x0c121e, 0x06090f, .0048, 0x9aaccc, .55, 0x4a5a78, 0x0a0c10, .5, 1],
  [.82, -5, 440, 0x18224c, 0xa86680, 0x38303e, .0022, 0xd08080, .5, 0x3a4878, 0x181418, .55, .45],
  [.9, 3.5, 455, 0x3a5aa0, 0xffa070, 0x9a8890, .0014, 0xffa060, 2.2, 0x7a88b8, 0x3a2a22, .7, 0],
  [1, 14, 595, 0x3d66aa, 0xe8a07a, 0x9a8a92, .0011, 0xffc48a, 2.8, 0x8aa0c8, 0x3a3028, .85, 0]];
const _ca = new THREE.Color(), _cb = new THREE.Color();
const TOD = {zen: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), el: 0, az: 0, fd: 0, sI: 0, hI: 0, st: 0, day: 1, night: 0};
function todAt(t, storm) {
  t = ((t % 1) + 1) % 1; let i = 0; while (TODK[i + 1][0] < t) i++;
  const a = TODK[i], b = TODK[i + 1], u = (t - a[0]) / (b[0] - a[0]), k = u * u * (3 - 2 * u), L = (x, y) => x + (y - x) * k;
  const C = (o, j) => o.copy(_ca.setHex(a[j])).lerp(_cb.setHex(b[j]), k);
  TOD.el = L(a[1], b[1]); TOD.az = L(a[2], b[2]); C(TOD.zen, 3); C(TOD.hor, 4); C(TOD.fog, 5); TOD.fd = L(a[6], b[6]); C(TOD.sun, 7); TOD.sI = L(a[8], b[8]); C(TOD.hs, 9); C(TOD.hg, 10); TOD.hI = L(a[11], b[11]); TOD.st = L(a[12], b[12]);
  const e = TOD.el * PI / 180, z = TOD.az * PI / 180; SUNDIR.set(Math.sin(z) * Math.cos(e), Math.sin(e), Math.cos(z) * Math.cos(e));
  MOONDIR.set(-SUNDIR.x * .8, Math.max(.3, -SUNDIR.y * .9 + .12), -SUNDIR.z * .8).normalize();
  TOD.day = clamp((TOD.el + 8) / 16, 0, 1); TOD.night = 1 - clamp((TOD.el + 22) / 18, 0, 1);
  if (storm > 0) {
    _ca.setRGB(.028, .04, .06).lerp(_cb.setRGB(.13, .15, .17), TOD.day); TOD.fog.lerp(_ca, storm); TOD.hor.lerp(_ca, storm * .9); TOD.zen.lerp(_cb.copy(_ca).multiplyScalar(.6), storm * .9);
    TOD.fd = mix(TOD.fd, mix(.02, .011, TOD.day), storm); TOD.sI *= 1 - .78 * storm; TOD.st *= 1 - storm; TOD.sun.lerp(_ca.setRGB(.7, .75, .8), storm * .6); TOD.hI *= 1 - .2 * storm;
  }
  // key light: the sun while it is up, the moon after dark; it fades through zero where they swap so the shadows never jump
  if (TOD.el > -3) { KEYDIR.copy(SUNDIR); KEYDIR.y = Math.max(KEYDIR.y, .06); KEYDIR.normalize(); TOD.kI = TOD.sI * clamp((TOD.el + 3) / 4, 0, 1); }
  else { KEYDIR.copy(MOONDIR); TOD.kI = TOD.sI * clamp((-3 - TOD.el) / 5, 0, 1); }
  return TOD;
}
const flash = new THREE.SpotLight(0xffeccc, 0, 45, .44, .6, 1.4); flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = .25; flash.shadow.camera.far = 45; flash.shadow.bias = -.0004; flash.shadow.normalBias = .03; scene.add(flash, flash.target);
const RSPOT = [0, 1].map(() => { const l = new THREE.SpotLight(0xffeccc, 0, 38, .44, .6, 1.4); scene.add(l, l.target); return l; });
const POOL = [0, 1].map(() => { const l = new THREE.PointLight(0xffe2b0, 0, 30, 1.4); scene.add(l); return l; });
const FLL = [0, 1].map(() => { const l = new THREE.PointLight(0xff2a14, 0, 22, 1.4); scene.add(l); return l; });
const boatL = new THREE.SpotLight(0xf4f8ff, 0, 90, .3, .5, 1.1); scene.add(boatL, boatL.target);
const lhL = new THREE.SpotLight(0xfff6dc, 0, 700, .09, .6, .35); scene.add(lhL, lhL.target);

function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, n) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r * .8; } g.putImageData(im, 0, 0); }
const TX = {}, MAT = {};
function rust(g, w, h, n) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${90 + Math.random() * 50},${40 + Math.random() * 20},${15},${Math.random() * .25})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 18, 0, TAU); g.fill(); } for (let i = 0; i < n / 2; i++) { g.fillStyle = `rgba(60,30,10,${Math.random() * .3})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 10 + Math.random() * 40); } }
function textures() {
  TX.grate = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#2a2c2c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#5a5c58'; g.lineWidth = 3; for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } g.lineWidth = 1.5; for (let i = 0; i <= h; i += 8) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } rust(g, w, h, 30); noiseFill(g, w, h, 20); }));
  TX.plate = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a5254'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2e30'; g.lineWidth = 2; for (let i = 0; i < w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } for (let i = 0; i < h; i += 128) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } g.fillStyle = '#2a2e30'; for (let x = 6; x < w; x += 64) for (let y = 6; y < h; y += 20) g.fillRect(x, y, 3, 3); rust(g, w, h, 80); noiseFill(g, w, h, 20); }));
  TX.wood = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = `rgba(0,0,0,${.1 + Math.random() * .2})`; g.fillRect(x, 0, 3, h); } noiseFill(g, w, h, 30); }));
  TX.planks = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#5a4634'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) { g.fillStyle = `rgba(0,0,0,${.15 + Math.random() * .2})`; g.fillRect(0, y, w, 2); for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(20,30,20,${Math.random() * .15})`; g.beginPath(); g.arc(Math.random() * w, y + Math.random() * 32, 3 + Math.random() * 10, 0, TAU); g.fill(); } } noiseFill(g, w, h, 30); }));
  TX.hazard = tex(cv(64, 64, (g, w, h) => { g.fillStyle = '#d8a820'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = -64; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); } noiseFill(g, w, h, 30); }));
  TX.cont = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#6a2418'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.cont2 = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#1e4a6a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.rock = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#3c3a36'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '10,10,10' : '100,98,90'},${Math.random() * .2})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, TAU); g.fill(); } noiseFill(g, w, h, 30); }), 3);
  TX.rustH = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#3a2c22'; g.fillRect(0, 0, w, h); rust(g, w, h, 200); noiseFill(g, w, h, 30); }), 2);
  TX.screen = tex(cv(128, 64, (g, w, h) => { g.fillStyle = '#04100a'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a8a50'; for (let y = 6; y < h; y += 7) g.fillRect(6, y, 20 + Math.random() * 90, 2); }));
  TX.paper = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#d6ccb0'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4030'; for (let y = 14; y < h - 10; y += 9) g.fillRect(12, y, 70 + Math.random() * 30, 2); noiseFill(g, w, h, 20); }));
  TX.board = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#2a2018'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c8a0'; g.font = 'bold 26px Georgia'; g.textAlign = 'center'; g.fillText('SALVAGE BOUGHT', w / 2, 44); g.font = '17px Georgia'; g.fillText('repairs · fuel · upgrades', w / 2, 76); g.fillText('ask inside', w / 2, 104); noiseFill(g, w, h, 30); }));
  TX.glow = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  TX.ripple = new THREE.CanvasTexture(cv(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 2 + Math.random() * 4, Math.random() * .4, 0, TAU); g.fill(); } }));
  TX.ripple.wrapS = TX.ripple.wrapT = THREE.RepeatWrapping; TX.ripple.repeat.set(60, 60);
}
const WAVES = [[.42, 34, .8, .3, .95], [.3, 22, 1.1, -.6, .8], [.2, 15, 1.5, .9, .4], [.12, 9, 2.0, -.2, -1]];
function waveH(x, z, t) { let h = 0; for (const [a, l, s, dx, dz] of WAVES) { const k = TAU / l, n = Math.hypot(dx, dz); h += a * Math.sin(k * (x * dx + z * dz) / n + t * s); } return h * G.sea; }
function materials() {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .8, metalness: .2}, o));
  MAT.grate = S({map: TX.grate, metalness: .5, roughness: .6}); MAT.plate = S({map: TX.plate, metalness: .5, roughness: .55, side: THREE.DoubleSide}); MAT.steel = S({color: 0x5a5e60, metalness: .6, roughness: .5});
  MAT.leg = S({map: TX.plate, color: 0xb0a080, metalness: .5}); MAT.yellow = S({color: 0xc8a020, roughness: .6}); MAT.wood = S({map: TX.wood}); MAT.hazard = S({map: TX.hazard}); MAT.planks = S({map: TX.planks, metalness: 0, side: THREE.DoubleSide}); MAT.roofW = S({map: TX.planks, color: 0x6a6a6a, metalness: 0});
  MAT.door = S({color: 0x3a4a4a, metalness: .5}); MAT.floorP = S({map: TX.grate, color: 0x9a9a9a}); MAT.glass = S({color: 0x0a1014, roughness: .1, metalness: .4}); MAT.dark = S({color: 0x0b0b0b});
  MAT.fabric = S({color: 0x3a4048, metalness: 0}); MAT.locker = S({color: 0x4a5a5a, metalness: .6, roughness: .45}); MAT.genM = S({color: 0x2a4a3a, metalness: .5}); MAT.panel = S({color: 0x3a3e40, metalness: .5});
  MAT.screen = S({map: TX.screen, emissive: 0x2a8a50, emissiveMap: TX.screen, emissiveIntensity: 0}); MAT.red = S({color: 0x9a1a14}); MAT.pipe = S({color: 0x6a5a40, metalness: .5}); MAT.crate = S({map: TX.wood, color: 0x9a8a6a});
  MAT.cont = S({map: TX.cont}); MAT.cont2 = S({map: TX.cont2}); MAT.orange = S({color: 0xd05a10}); MAT.bulb = S({color: 0x222018, emissive: 0xfff0c0, emissiveIntensity: 0});
  MAT.rock = S({map: TX.rock, metalness: 0, roughness: .95}); MAT.white = S({color: 0xc8c4b8, metalness: 0}); MAT.log = S({color: 0x2a2018, metalness: 0}); MAT.glassL = S({color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.5});
  MAT.rustH = S({map: TX.rustH, metalness: .4, side: THREE.DoubleSide}); MAT.ghostH = S({map: TX.rustH, color: 0x8a9a9a, metalness: .2, emissive: 0x0a2a20, side: THREE.DoubleSide}); MAT.rustR = S({color: 0x5a3a24, metalness: .4}); MAT.paper = S({map: TX.board, metalness: 0});
  TX.carpet = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#5a1418'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a6a2a'; g.lineWidth = 2; for (let i = 0; i < w; i += 32) for (let j = 0; j < h; j += 32) { g.beginPath(); g.arc(i + 16, j + 16, 9, 0, TAU); g.stroke(); } for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(20,10,5,${.15 + Math.random() * .3})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 20, 0, TAU); g.fill(); } noiseFill(g, w, h, 18); }), 1);
  TX.wallp = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#2a3a30'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a4a3a'; for (let i = 0; i < w; i += 22) for (let j = 0; j < h; j += 30) { g.beginPath(); g.ellipse(i + 11, j + 15, 5, 11, 0, 0, TAU); g.fill(); } const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,30,10,.5)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 16); }), 1);
  MAT.carpet = new THREE.MeshStandardMaterial({map: TX.carpet, roughness: .95}); MAT.wallp = new THREE.MeshStandardMaterial({map: TX.wallp, roughness: .85}); MAT.brass = new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3});
  MAT.sea = new THREE.MeshStandardMaterial({color: 0x031820, roughness: .07, metalness: 0, bumpMap: TX.ripple, bumpScale: .5, envMapIntensity: .9, side: THREE.DoubleSide});
  MAT.sea.onBeforeCompile = sh => {
    sh.uniforms.uT = {value: 0}; sh.uniforms.uA = {value: 1}; MAT.sea.userData.sh = sh;
    const W = WAVES.map(([a, l, s, dx, dz]) => { const n = Math.hypot(dx, dz), k = (TAU / l).toFixed(4), d = `vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})`; return `{ float ph = ${k} * dot(p, ${d}) + uT * ${s.toFixed(2)}; w += vec3(${a.toFixed(3)} * sin(ph), ${(a * TAU / l * dx / n).toFixed(4)} * cos(ph), ${(a * TAU / l * dz / n).toFixed(4)} * cos(ph)); }`; }).join('\n');
    sh.vertexShader = 'uniform float uT; uniform float uA;\nvec3 seaW(vec2 p){ vec3 w = vec3(0.);\n' + W + '\n return w * uA; }\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 wpN = (modelMatrix * vec4(position, 1.)).xyz; vec3 sw = seaW(wpN.xz); vec3 objectNormal = normalize(vec3(-sw.y, 1., -sw.z));')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += sw.x; vWH = sw.x; vWP = wpN;');
    sh.vertexShader = 'varying float vWH; varying vec3 vWP;\n' + sh.vertexShader; sh.uniforms.uFoam = {value: .3};
    sh.fragmentShader = 'uniform float uT; uniform float uA; uniform float uFoam; varying float vWH; varying vec3 vWP;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cr = clamp(vWH / max(uA, .3), -1., 1.5); diffuseColor.rgb *= 1. + smoothstep(.1, .9, cr) * vec3(.6, 1.1, 1.0);
        float fn = sin(vWP.x * .9 + vWP.z * 1.3 + uT * .7) * sin(vWP.z * .7 - vWP.x * .4 - uT * .5) * .5 + .5;
        float fo = smoothstep(.62, 1.05, cr + fn * .35) * uFoam; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62, .68, .7), fo);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .85, fo);');
  };
}
function mergeGeos(list) {
  let n = 0; const qs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0; for (const q of qs) { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2); o += c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeBoundingSphere(); return g;
}
let SEA = null, RAIN = null, SEABED = null;
function seabedAt(cx, cz) { cx = Math.round(cx / 10) * 10; cz = Math.round(cz / 10) * 10; SEABED.userData.cx = cx; SEABED.userData.cz = cz; const p = SEABED.geometry.attributes.position, b = SEABED.userData.base; for (let i = 0; i < p.count; i++) { const x = b[i * 2] + cx, z = b[i * 2 + 1] + cz; p.setXYZ(i, x, seaBed(x, z), z); } p.needsUpdate = true; SEABED.geometry.computeVertexNormals(); SEABED.geometry.computeBoundingSphere(); }
function buildSea() {
  const g = new THREE.PlaneGeometry(1500, 1500, 250, 250); g.rotateX(-PI / 2);
  { const sg = new THREE.PlaneGeometry(420, 420, 60, 60); sg.rotateX(-PI / 2); const base = new Float32Array(sg.attributes.position.count * 2); for (let i = 0; i < sg.attributes.position.count; i++) { base[i * 2] = sg.attributes.position.getX(i); base[i * 2 + 1] = sg.attributes.position.getZ(i); }
    const sbm = new THREE.MeshStandardMaterial({map: TX.rock, color: 0x8a8068, roughness: 1});
    sbm.onBeforeCompile = sh => { sh.uniforms.uT = {value: 0}; sh.uniforms.uC = {value: 1}; sbm.userData.sh = sh;
      sh.vertexShader = 'varying vec3 vWq;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWq = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = 'uniform float uT, uC; varying vec3 vWq;\nfloat cau(vec2 p, float t){ vec2 i = p; float c = 1.; for (int k = 0; k < 4; k++) { float tt = t * (1. - 3.5 / float(k + 1)); i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)); c += 1. / length(vec2(p.x / (sin(i.x + tt) / .005), p.y / (cos(i.y + tt) / .005))); } c /= 4.; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.); }\n' + sh.fragmentShader
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(.7, 1., .95) * clamp(cau(mod(vWq.xz * .12, 6.2831), uT * .5), 0., 1.) * uC * exp(vWq.y / 45.) * 2.4;'); };
    SEABED = new THREE.Mesh(sg, sbm); SEABED.userData.base = base; SEABED.userData.cx = 1e9; SEABED.frustumCulled = false; SEABED.visible = false; scene.add(SEABED); }
  SEA = new THREE.Mesh(g, MAT.sea); SEA.receiveShadow = true; SEA.frustumCulled = false; scene.add(SEA);
  const n = 2600, p = new Float32Array(n * 6); for (let i = 0; i < n; i++) { const x = (Math.random() - .5) * 50, y = Math.random() * 30, z = (Math.random() - .5) * 50; p.set([x, y, z, x + .15, y + .7, z + .05], i * 6); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  RAIN = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({color: 0x9aa8b8, transparent: true, opacity: .32, depthWrite: false})); RAIN.frustumCulled = false; scene.add(RAIN);
  const U = {aur: {value: 0}, zen: {value: new THREE.Color()}, hor: {value: new THREE.Color()}, fogC: {value: new THREE.Color()}, sunC: {value: new THREE.Color()}, sunD: {value: SUNDIR}, moonD: {value: MOONDIR}, sunI: {value: 1}, uS: {value: 0}, uF: {value: 0}, stars: {value: 0}, uT: {value: 0}};
  const skyM = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w * .99999; }',
    fragmentShader: `varying vec3 vD; uniform vec3 zen, hor, fogC, sunC, sunD, moonD; uniform float sunI, uS, uF, stars, uT, aur;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); } float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
      void main(){ vec3 d = normalize(vD); float y = d.y, yy = max(y, 0.);
        vec3 col = mix(hor * mix(.62, 1., pow(max(dot(normalize(d.xz + 1e-4), normalize(sunD.xz + 1e-4)), 0.) * .5 + .5, 1.5)), zen, pow(yy, .48));
        float sd = max(dot(d, sunD), 0.), up = smoothstep(-.06, .02, sunD.y), ab = smoothstep(-.05, .03, y);
        col += sunC * (pow(sd, 14.) * .3 + pow(sd, 120.) * .9) * sunI * .4 * ab * (1. - uS * .7);
        col += sunC * exp(-yy * 9.) * pow(sd, 2.5) * sunI * .22 * ab * (1. - uS * .8);
        col += sunC * smoothstep(.99955, .99975, sd) * 26. * up * ab * (1. - uS);
        vec2 uv = d.xz / (yy + .1) * .9 + uT * vec2(.006, .002); float c = fbm(uv), c2 = fbm(uv * 2.6 + 4.);
        float cov = mix(.47, .28, uS), cl = smoothstep(cov, cov + .2, c * .75 + c2 * .25) * smoothstep(0., .08, yy);
        vec3 cc = mix(zen * .7, hor * 1.15, .35 + .65 * pow(1. - yy, 3.)) * (.75 + .5 * (1. - c2));
        cc += sunC * (pow(sd, 3.) * .9 + .15) * sunI * .22 * (1. - smoothstep(.45, .8, c)) * (1. - uS);
        cc = mix(cc, fogC * (.65 + .5 * c2), uS * .85);
        col = mix(col, cc, cl * .92);
        vec3 sp = d * 260.; vec3 id = floor(sp); float r = h3(id); float s = step(.986, r) * smoothstep(.34, .06, length(fract(sp) - .5));
        col += vec3(.8, .86, 1.) * s * stars * (1. - cl) * smoothstep(.0, .15, y) * (.55 + .45 * sin(uT * 2.3 + r * 90.)) * 1.6;
        float md = dot(d, moonD); float mdisc = smoothstep(.99935, .99955, md);
        col = mix(col, vec3(.9, .93, 1.) * 1.8, mdisc * stars * (1. - uS * .9) * (1. - cl * .8)); col += vec3(.06, .08, .13) * pow(max(md, 0.), 30.) * stars;
        if (aur > .01) { vec2 q = d.xz / (yy + .3); float b1 = n(vec2(q.x * 1.3 + uT * .02, q.y * .35 - uT * .01)), b2 = n(vec2(q.x * 2.7 - uT * .015, q.y * .6 + 3.)), cur = smoothstep(.52, .78, b1 * .7 + b2 * .3) * smoothstep(.04, .3, yy) * smoothstep(.95, .4, yy);
          float rays = .45 + .55 * n(vec2(q.x * 7. + n(q * 2.) * 2., uT * .15)) * (.75 + .25 * sin(q.x * 9. + uT * .2)); col += (vec3(.08, 1., .5) * (1. - yy * 1.2) + vec3(.7, .2, 1.) * yy * 1.6) * cur * rays * aur * (1. - cl * .7) * 1.3; }
        col = mix(col, fogC, smoothstep(.03, -.015, y));
        col += uF * vec3(.5, .55, .7) * (.4 + c);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), skyM); sky.frustumCulled = false; sky.renderOrder = -2; scene.add(sky); scene.userData.sky = sky;
  ENV.scene = new THREE.Scene(); ENV.scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), skyM)); ENV.pm = new THREE.PMREMGenerator(RND);
  buildFoam(); buildBirds();
}
const ENV = {scene: null, pm: null, rt: null, t: 0, key: ''};
function envUpdate(dt, force) {
  if (!ENV.pm) return; ENV.t -= dt; const key = (G.tod || 0).toFixed(3) + '|' + G.storm.toFixed(2);
  if (!force && (ENV.t > 0 || key === ENV.key) && Math.abs((G.tod || 0) - (ENV.td || 0)) < .01) return; ENV.td = G.tod || 0; ENV.t = 6; ENV.key = key;
  const rt = ENV.pm.fromScene(ENV.scene, 0, .1, 100); scene.environment = rt.texture; if (ENV.rt) ENV.rt.dispose(); ENV.rt = rt;
}
let FOAM = null, BIRDS = null;
function buildFoam() {
  // a soft foam ring at every island's waterline
  const t = tex(cv(256, 32, (g, w, h) => { for (let i = 0; i < 900; i++) { const x = Math.random() * w, y = Math.pow(Math.random(), 1.6) * h; g.fillStyle = `rgba(255,255,255,${.25 + Math.random() * .5})`; g.beginPath(); g.arc(x, y, .6 + Math.random() * 1.8, 0, TAU); g.fill(); } }), 1);
  t.repeat.set(1, 1); FOAM = new THREE.Group(); scene.add(FOAM);
  const mat = new THREE.MeshBasicMaterial({map: t, transparent: true, opacity: .5, depthWrite: false, color: 0xe8f0f0});
  for (const I of ISLES) {
    const N = 96, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * TAU, c = Math.cos(a), sn = Math.sin(a); let r0 = 0;
      for (let r = 4; r < 260; r += 1.5) { if (landH(I.x + c * r, I.z + sn * r) < .05) { r0 = r; break; } }
      if (!r0) r0 = I.r || 40;
      for (const [dr, v] of [[-1.2, 1], [3.5, 0]]) { pos.push(I.x + c * (r0 + dr), .08, I.z + sn * (r0 + dr)); uv.push(i / N * 12, v); }
    }
    for (let i = 0; i < N; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.renderOrder = 1; FOAM.add(m);
  }
  FOAM.userData.mat = mat;
}
function buildBirds() {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-.7, .12, -.1, 0, 0, .25, 0, 0, -.15, .7, .12, -.1, 0, 0, .25, 0, 0, -.15], 3)); g.computeVertexNormals();
  BIRDS = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({color: 0x101014, side: THREE.DoubleSide, fog: true}), 14); BIRDS.frustumCulled = false; scene.add(BIRDS);
  BIRDS.userData.ph = [...Array(14)].map(() => [Math.random() * TAU, 14 + Math.random() * 26, 14 + Math.random() * 14, .12 + Math.random() * .1, Math.random() * TAU]);
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(1, 1, 1), _be = new THREE.Euler();
function stepBirds(t, ex, ez) {
  if (!BIRDS) return; let best = null, bd = 1e9; for (const I of ISLES) { const d = Math.hypot(I.x - ex, I.z - ez); if (d < bd) { bd = d; best = I; } }
  const vis = best && bd < 420 && TOD.day > .2 && G.storm < .5; BIRDS.visible = vis; if (!vis) return;
  BIRDS.userData.ph.forEach((p, i) => {
    const a = p[0] + t * p[3], r = p[1], x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r, y = p[2] + Math.sin(t * .7 + p[4]) * 3, fl = Math.sin(t * 9 + p[4]) * .5;
    _be.set(0, -a, Math.sin(t * .5 + i) * .3); _bq.setFromEuler(_be); _bs.set(1, 1 + fl * .6, 1).multiplyScalar(.9);
    _bm.compose(_v.set(x, y, z), _bq, _bs); BIRDS.setMatrixAt(i, _bm);
  }); BIRDS.instanceMatrix.needsUpdate = true;
}

// ---------------- boat
const UPG = {
  engine: {n: 'Engine', d: 'Top speed', cost: [150, 320, 600]},
  hull: {n: 'Hull plating', d: 'Takes more hits', cost: [160, 340]},
  light: {n: 'Searchlight', d: 'Brighter, longer beam', cost: [90, 200]},
  sonar: {n: 'Sonar', d: 'Compass and map show unfound places, floating cargo and sunken treasure', cost: [220]},
  hold: {n: 'Hold racks', d: 'Fit more salvage in the hold', cost: [140, 320]},
  crane: {n: 'Cargo crane', d: 'Haul floating cargo aboard from twice as far', cost: [180]},
};
const B = {x: 0, z: 0, yaw: PI, v: 0, thr: 0, st: 0, driver: null, heave: 0, pitch: 0, roll: 0, fuel: 100, hull: 100, up: {engine: 0, tank: 0, hull: 0, light: 0, sonar: 0, hold: 0, crane: 0, cls: 0}, hold: [], sink: 0, dep: 0, dtar: 0};
// hull classes: buy any of them at the shed while the boat is at the jetty
const HULLS = [
  {n: 'Salvage launch', d: 'The boat everyone starts with', cost: 0, L: 12.2, W: 4.4, fb: 1.3, spd: 1, turn: 1, hold: 8, hp: 1, fuel: 1, col: 0x1e3a4a, wh: [.18, .42]},
  {n: 'Fishing trawler', d: 'Long work deck, stern gantry, twice the hold', cost: 900, L: 17, W: 5.6, fb: 1.45, spd: .95, turn: .85, hold: 16, hp: 1.6, fuel: 1.4, col: 0x7a1e16, wh: [.12, .34]},
  {n: 'Patrol cutter', d: 'Fast and tough, radar mast, big searchlight', cost: 1900, L: 22, W: 6, fb: 1.6, spd: 1.45, turn: .9, hold: 20, hp: 2.2, fuel: 1.8, col: 0x2e333a, wh: [.2, .4]},
  {n: 'Cargo freighter', d: 'A massive ship: container deck, huge hold, very tough, slow to turn', cost: 3800, L: 38, W: 10, fb: 1.9, spd: .9, turn: .42, hold: 60, hp: 4, fuel: 3, col: 0x1c2c3e, wh: [.66, .84]},
  {n: 'Research submarine', d: 'Glass dome cabin, dives under the waves (at the wheel: C down, Space up), reaches sunken treasure on the sea bed', cost: 5200, L: 24, W: 5.4, fb: 1.4, spd: 1.15, turn: .8, hold: 28, hp: 3, fuel: 2, col: 0xd8a020, sub: 1},
  {n: 'Dive support vessel', d: 'A 48 m work ship: helipad, deck crane, a huge hold. Divers go over the side from her stern platform', cost: 7500, L: 48, W: 12, fb: 1.9, spd: 1.05, turn: .4, hold: 90, hp: 5, fuel: 4, col: 0x24486a, wh: [.12, .24], eye: 5.5, big: 1},
  {n: 'Icebreaker', d: 'A 64 m red giant with an armoured bow and two funnels. Rams barely scratch her', cost: 12500, L: 64, W: 14, fb: 2, spd: 1.12, turn: .34, hold: 120, hp: 9, fuel: 5, col: 0x9a1a12, wh: [.16, .28], eye: 9, big: 1},
  {n: 'MS Serenade', d: 'The 120 m cruise liner from the far north. Start her engines on the derelict to claim her. Something still lives aboard', cost: 0, L: 120, W: 26, fb: 2.2, spd: 1.25, turn: .24, hold: 260, hp: 15, fuel: 9, col: 0xd8d4c8, wh: [.1, .2], eye: 24, big: 1, cruise: 1},
];
const HC = () => HULLS[B.up.cls || 0];
const tankMax = () => Math.round([100, 160, 240][B.up.tank] * HC().fuel), hullMax = () => Math.round([100, 150, 220][B.up.hull] * HC().hp), holdMax = () => Math.round(HC().hold * [1, 1.5, 2][B.up.hold || 0]);
const BDECK = {x0: -2, x1: 2, z0: -5, z1: 5.2, y: 1.3}, BW = [], BHELM = [0, -2.6];
const BSPOT = {hold: [0, 3], fuel: [1.5, 4.6], patch: [-1.5, 4.6]};
const BG = {zs: 5.4, zb: -6.8, W: 4.4, L: 12.2, hw: 2.2};
function bL2W(lx, lz) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw); return [B.x + lx * c + lz * s, B.z - lx * s + lz * c]; }
function bW2L(x, z) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw), dx = x - B.x, dz = z - B.z; return [dx * c - dz * s, dx * s + dz * c]; }
let BOAT = null;
function hullHW(z) { const t = clamp((z - BG.zb) / (BG.zs - BG.zb), 0, 1); return BG.hw * (t < .45 ? Math.pow(Math.sin(t / .45 * PI / 2), .75) : 1 - (t - .45) * .06); }
function buildBoat() {
  const cls = B.up.cls || 0, H = HULLS[cls];
  if (BOAT) { scene.remove(BOAT); BOAT.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  for (let i = INTER.length - 1; i >= 0; i--) if (INTER[i].boat) INTER.splice(i, 1);
  BW.length = 0;
  const L = H.L, W = H.W, hw = W / 2, fb = H.fb, zs = L * .44, zb = -L * .56;
  Object.assign(BG, {zs, zb, W, L, hw, sub: !!H.sub});
  const g = new THREE.Group(), S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .55, metalness: .15}, o));
  const whiteM = S({color: 0xd0d0c8, roughness: .45}), deckM = S({map: TX.wood, color: 0x9a8a70, roughness: .8}), redM = S({color: 0x8a1a14}), steel = S({color: 0x5a6068, metalness: .6, roughness: .4}), darkM = S({color: 0x1a1c1e}), yel = S({color: 0xd8b020});
  const glass = new THREE.MeshStandardMaterial({color: 0x9ac0d0, roughness: .03, metalness: .1, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4});
  const add = (geo, m, x, y, z, p = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = m !== glass; o.receiveShadow = true; p.add(o); return o; };
  const box = (m, x0, x1, y0, y1, z0, z1, wall) => { const o = add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); if (wall) BW.push({x0, x1, z0, z1, y0: y0 - fb, y1: y1 - fb}); return o; };
  const cyl = (m, r0, r1, h, x, y, z, rx = 0, rz = 0, seg = 12) => { const o = add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z); o.rotation.set(rx, 0, rz); return o; };
  const hc = new THREE.Color((PAINTS[B.up.paint || 0] || PAINTS[0]).c || H.col), wc = new THREE.Color(0xe8e8e0), rc = new THREE.Color(0x7a1812);
  if (!H.sub) {
    // lofted hull: flared topsides, chine, V bottom, sheer rising to the bow, boot stripe and antifouling
    const d = .6 + fb * .7 + (H.big ? L * .045 : 0), NZ = H.big ? 40 : 28, ring = [[1, 'top'], [1, fb], [.99, .36], [.985, .3], [.98, .06], [.975, .02], [.82, -d * .55], [.42, -d * .92], [0, -d]];
    const pos = [], col = [], idx = [], nr = ring.length * 2 - 1;
    for (let i = 0; i <= NZ; i++) { const z = mix(zb, zs, i / NZ), w = hullHW(z), t = i / NZ, top = fb + .32 + .9 * Math.pow(1 - t, 2.2) * Math.min(1.6, L / 14);
      const pts = []; for (const [f, y] of ring) pts.push([-w * f, y === 'top' ? top : y]); for (let k = ring.length - 2; k >= 0; k--) { const [f, y] = ring[k]; pts.push([w * f, y === 'top' ? top : y]); }
      for (const [x, y] of pts) { pos.push(x, y, z); const c = y > .33 ? hc : y > .04 ? wc : rc; col.push(c.r, c.g, c.b); } }
    for (let i = 0; i < NZ; i++) for (let k = 0; k < nr - 1; k++) { const a = i * nr + k, b = a + 1, c = a + nr, e = c + 1; idx.push(a, c, b, b, c, e); }
    const tc = pos.length / 3; pos.push(0, fb * .4, zs); col.push(hc.r, hc.g, hc.b); for (let k = 0; k < nr - 1; k++) idx.push(tc, NZ * nr + k, NZ * nr + k + 1);
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hg.setIndex(idx); hg.computeVertexNormals();
    add(hg, S({vertexColors: true, roughness: .45, metalness: .1, side: THREE.DoubleSide}), 0, 0, 0);
    const sh = new THREE.Shape(); for (let i = 0; i <= NZ; i++) { const z = mix(zs, zb, i / NZ); sh.lineTo(hullHW(z) - .05, -z); } for (let i = NZ; i >= 0; i--) { const z = mix(zs, zb, i / NZ); sh.lineTo(-hullHW(z) + .05, -z); }
    const dk = new THREE.ShapeGeometry(sh); dk.rotateX(-PI / 2); dk.translate(0, fb + .005, 0); add(dk, deckM, 0, 0, 0);
    // gunwale cap and rails
    for (const sd of [-1, 1]) for (let i = 0; i < NZ; i++) { const za = mix(zb, zs, i / NZ), zz = mix(zb, zs, (i + 1) / NZ), xa = sd * hullHW(za), xz = sd * hullHW(zz), ta = fb + .32 + .9 * Math.pow(1 - i / NZ, 2.2) * Math.min(1.6, L / 14), tz = fb + .32 + .9 * Math.pow(1 - (i + 1) / NZ, 2.2) * Math.min(1.6, L / 14);
      const l = Math.hypot(xz - xa, zz - za, tz - ta), cap = add(new THREE.BoxGeometry(.12, .06, l + .02), whiteM, (xa + xz) / 2, (ta + tz) / 2 + .03, (za + zz) / 2); cap.rotation.set(-Math.atan2(tz - ta, zz - za), Math.atan2(xz - xa, zz - za), 0, 'YXZ');
      if (i % 2 === 0 && i > NZ * .2) { cyl(whiteM, .025, .025, .75, xa, ta + .4, za, 0, 0, 6); } }
    for (const sd of [-1, 1]) { const zz = zb + L * .3; const r = add(new THREE.CylinderGeometry(.025, .025, zs - zz, 6), whiteM, sd * (hw - .06), fb + 1.08, (zz + zs) / 2); r.rotation.x = PI / 2; }
    BDECK.x0 = -hw + .3; BDECK.x1 = hw - .3; BDECK.z0 = zb + (zs - zb) * .32; BDECK.z1 = zs - .25; BDECK.y = fb;
    for (const sd of [-1, 1]) BW.push({x0: sd < 0 ? -hw - .5 : hw - .28, x1: sd < 0 ? -hw + .28 : hw + .5, z0: BDECK.z0 - 1, z1: zs + .3, y0: 0, y1: 1.1});
    BW.push({x0: -hw, x1: hw, z0: BDECK.z0 - 2, z1: BDECK.z0 + .05, y0: 0, y1: 2});
    BW.push({x0: -hw, x1: -.6, z0: zs - .12, z1: zs + .4, y0: 0, y1: 1}); BW.push({x0: .6, x1: hw, z0: zs - .12, z1: zs + .4, y0: 0, y1: 1});
    // wheelhouse with real walls and windows
    const sft = cls === 3 || H.big ? 0 : L * .12, wz0 = mix(zb, zs, H.wh[0]) + sft, wz1 = mix(zb, zs, H.wh[1]) + sft, ww = Math.min(hullHW(wz0), hullHW(wz1)) * .82, hh = 2.25, y0 = fb;
    const wallM = cls === 2 ? S({color: 0x8a9098}) : whiteM;
    box(wallM, -ww, ww, y0, y0 + 1.05, wz0, wz0 + .12, 1); box(wallM, -ww, ww, y0 + 1.9, y0 + hh, wz0, wz0 + .12); add(new THREE.BoxGeometry(ww * 2, .85, .04), glass, 0, y0 + 1.48, wz0 + .06);
    for (const sd of [-1, 1]) { const x0 = sd < 0 ? -ww : ww - .12, x1 = x0 + .12; box(wallM, x0, x1, y0, y0 + 1.05, wz0, wz1, 1); box(wallM, x0, x1, y0 + 1.9, y0 + hh, wz0, wz1); box(wallM, x0, x1, y0, y0 + hh, wz1 - .5, wz1); add(new THREE.BoxGeometry(.04, .85, wz1 - wz0 - .6), glass, sd * (ww - .06), y0 + 1.48, (wz0 + wz1) / 2 - .25);
      for (let z = wz0 + .1; z < wz1 - .5; z += (wz1 - wz0) / 3) box(wallM, x0, x1, y0 + 1.05, y0 + 1.9, z, z + .08); }
    box(wallM, -ww, -.55, y0, y0 + hh, wz1 - .12, wz1, 1); box(wallM, .55, ww, y0, y0 + hh, wz1 - .12, wz1, 1); box(wallM, -.55, .55, y0 + 2, y0 + hh, wz1 - .12, wz1);
    box(wallM, -ww - .15, ww + .15, y0 + hh, y0 + hh + .12, wz0 - .3, wz1 + .2);
    // helm console against the windscreen, wheel on its back face
    box(darkM, -.55, .55, y0, y0 + 1.05, wz0 + .12, wz0 + .62, 1); const hz = wz0 + .62;
    const wg = new THREE.Group(); wg.position.set(0, y0 + 1.12, hz + .08); wg.rotation.x = -.45; g.add(wg);
    const wm = S({color: 0x4a3018, roughness: .5}); wg.add(new THREE.Mesh(new THREE.TorusGeometry(.3, .028, 8, 24), wm));
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .62, 5), wm); sp.rotation.z = i / 6 * PI; wg.add(sp); const hd = new THREE.Mesh(new THREE.CylinderGeometry(.02, .016, .14, 6), wm); hd.position.set(Math.cos(i / 6 * TAU) * .37, Math.sin(i / 6 * TAU) * .37, 0); hd.rotation.z = i / 6 * TAU + PI / 2; wg.add(hd); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .22, 10), steel); hub.rotation.x = PI / 2; hub.position.z = -.08; wg.add(hub);
    g.userData.wheel = wg;
    cyl(steel, .015, .015, .25, .38, y0 + 1.2, hz - .1, -.4); add(new THREE.SphereGeometry(.035, 8, 6), redM, .38, y0 + 1.33, hz - .05);
    add(new THREE.SphereGeometry(.11, 12, 8), S({color: 0x8a6a30, metalness: .7, roughness: .3}), -.35, y0 + 1.15, hz - .25);
    const scr = add(new THREE.BoxGeometry(.32, .22, .03), S({color: 0x103020, emissive: 0x2a8a50, emissiveIntensity: .6}), 0, y0 + 1.18, hz - .22); scr.rotation.x = -.6;
    BHELM[0] = 0; BHELM[1] = hz + .55;
    cyl(whiteM, .04, .04, 1.4, 0, y0 + hh + .8, (wz0 + wz1) / 2);
    for (const sd of [-1, 1]) { const nl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: sd < 0 ? 0xff2020 : 0x20ff40, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); nl.scale.setScalar(.8); nl.position.set(sd * (ww + .1), y0 + hh + .1, wz0); g.add(nl); }
    g.userData.lightZ = wz0 - .2; g.userData.lightY = y0 + hh + .3; g.userData.wz = [wz0, wz1];
    const aft = (wz1 + zs) / 2;
    BSPOT.hold[0] = 0; BSPOT.hold[1] = Math.min(zs - 2.2, wz1 + 1.8 + (cls === 3 ? 0 : 0)); BSPOT.fuel[0] = hw - .9; BSPOT.fuel[1] = zs - .8; BSPOT.patch[0] = -hw + .9; BSPOT.patch[1] = zs - .8;
    if (cls === 3) { BSPOT.hold[1] = zb + L * .42; }
    const hz2 = BSPOT.hold[1]; box(S({map: TX.wood, color: 0x6a5a44}), -.9, .9, fb, fb + .22, hz2 - .7, hz2 + .7); box(steel, -.95, .95, fb, fb + .08, hz2 - .75, hz2 + .75); BW.push({x0: -.9, x1: .9, z0: hz2 - .7, z1: hz2 + .7, y0: 0, y1: .2});
    cyl(redM, .13, .13, .32, BSPOT.fuel[0], fb + .16, BSPOT.fuel[1]); box(yel, BSPOT.patch[0] - .3, BSPOT.patch[0] + .3, fb, fb + .4, BSPOT.patch[1] - .2, BSPOT.patch[1] + .2);
    // stern ladder down the transom
    for (let y = -.8; y < fb; y += .3) box(steel, -.32, .32, y, y + .04, zs + .05, zs + .1); for (const sd of [-1, 1]) box(steel, sd * .32 - .02, sd * .32 + .02, -.9, fb + .9, zs + .04, zs + .1);
    // class extras
    if (cls === 1) { for (const sd of [-1, 1]) box(steel, sd * (hw - .6) - .1, sd * (hw - .6) + .1, fb, fb + 3.4, zs - .9, zs - .7, 1); box(steel, -hw + .5, hw - .5, fb + 3.3, fb + 3.5, zs - .9, zs - .7); const dr = cyl(S({color: 0x3a6a3a}), .55, .55, 2.4, 0, fb + .6, aft - 1, 0, PI / 2, 16); BW.push({x0: -1.2, x1: 1.2, z0: aft - 1.6, z1: aft - .4, y0: 0, y1: 1.2}); }
    if (cls === 2) { cyl(steel, .06, .08, 3.2, 0, fb + hh + 1.6, (wz0 + wz1) / 2 + .4); const rad = add(new THREE.BoxGeometry(1.6, .12, .25), darkM, 0, fb + hh + 3.2, (wz0 + wz1) / 2 + .4); g.userData.radar = rad;
      cyl(steel, .25, .35, .5, 0, fb + .25, wz0 - 2.2); const gun = cyl(darkM, .06, .06, 1.6, 0, fb + .6, wz0 - 2.9, PI / 2); g.userData.gun = gun; }
    if (cls === 3) { const ss = S({color: 0xe0e0d8}); box(ss, -ww, ww, fb + hh + .12, fb + hh + 5.6, wz0 + .2, wz1 - .2); for (let lv = 0; lv < 2; lv++) add(new THREE.BoxGeometry(ww * 2 + .02, .5, .02), glass, 0, fb + hh + 1.2 + lv * 2.2, wz0 + .19);
      box(ss, -ww - 1.6, ww + 1.6, fb + hh + 5.6, fb + hh + 7.4, wz0 - .3, wz1 - 1); add(new THREE.BoxGeometry(ww * 2 + 3.2, .7, .02), glass, 0, fb + hh + 6.6, wz0 - .32);
      cyl(S({color: 0x9a2a1a}), 1.1, 1.3, 4.5, 0, fb + hh + 8, wz1 - 2.2); cyl(darkM, 1.12, 1.12, .7, 0, fb + hh + 10, wz1 - 2.2);
      const CM = [MAT.cont, MAT.cont2, S({color: 0x2a5a8a}), S({color: 0x8a3a1a}), S({color: 0x3a7a3a})];
      for (let r = 0; r < 4; r++) for (let c = -1; c <= 1; c++) { const z0 = zb + L * .2 + r * 6.4; if (z0 + 6 > wz0 - 1) continue; const h = 1 + ((r + c + 3) % 3); for (let k = 0; k < h; k++) box(CM[(r * 3 + c + k + 6) % 5], c * 2.6 - 1.2, c * 2.6 + 1.2, fb + k * 2.5, fb + k * 2.5 + 2.45, z0, z0 + 6, k === 0); }
      for (const sd of [-1, 1]) { cyl(S({color: 0xd8a020}), .25, .3, 7, sd * (hw - 1), fb + 3.5, zb + L * .3); cyl(S({color: 0xd8a020}), .5, .5, .4, sd * (hw - 1), fb + 7.1, zb + L * .3); }
      BSPOT.fuel[1] = zs - .8; BSPOT.patch[1] = zs - .8; }
    if (H.big) { const ss = S({color: 0xe8e6de, roughness: .5}), wm = new THREE.MeshStandardMaterial({color: 0x101418, emissive: 0xffc070, emissiveIntensity: .1, roughness: .2}); g.userData.winM = wm;
      const lv = cls === 7 ? 7 : cls === 6 ? 3 : 2, sz0 = wz0, sz1 = cls === 7 ? zs - 14 : wz1 + L * .12;
      for (let i = 0; i < lv; i++) { const k = 1 - i * (cls === 7 ? .05 : .08), w = ww * k, y = fb + hh + .12 + i * 2.8, z0 = sz0 + i * (cls === 7 ? 1.6 : .8), z1 = sz1 - i * (cls === 7 ? 3.5 : 1);
        box(ss, -w, w, y, y + 2.8, z0, z1); for (const sd of [-1, 1]) add(new THREE.BoxGeometry(.04, .8, z1 - z0 - 1), wm, sd * (w + .02), y + 1.5, (z0 + z1) / 2); add(new THREE.BoxGeometry(w * 2 - 1, .8, .04), wm, 0, y + 1.5, z0 - .02); }
      if (cls === 7) { BW.push({x0: -ww, x1: ww, z0: wz1, z1: sz1, y0: 0, y1: 3}); box(ss, -ww, ww, fb, fb + hh, wz1, sz1); for (const sd of [-1, 1]) for (let i = 0; i < 8; i++) { const z = wz1 + 4 + i * (sz1 - wz1 - 8) / 7; cyl(S({color: 0xe06018}), .9, .9, 5, sd * (ww + .9), fb + hh + 4, z, PI / 2); }
        const fz = sz1 - (lv - 1) * 3.5 - 5; cyl(S({color: 0xc8c4b8}), 3, 3.6, 9, 0, fb + hh + lv * 2.8 + 4, fz); cyl(S({color: 0x1a3a6a}), 3.02, 3.02, 2, 0, fb + hh + lv * 2.8 + 7.5, fz);
        const pool = add(new THREE.BoxGeometry(ww, .1, 10), S({color: 0x2a8ab0, roughness: .05}), 0, fb + hh + lv * 2.8 + .2, (sz0 + sz1) / 2); }
      if (cls === 6) { for (const z of [sz1 - 5, sz1 - 1]) { cyl(S({color: 0x9a1a12}), 1.3, 1.5, 7, 0, fb + hh + lv * 2.8 + 3.5, z); cyl(darkM, 1.32, 1.32, 1, 0, fb + hh + lv * 2.8 + 6.5, z); } cyl(steel, .12, .15, 6, 0, fb + hh + lv * 2.8 + 3, sz0 + 2); const rad = add(new THREE.BoxGeometry(2.4, .15, .35), darkM, 0, fb + hh + lv * 2.8 + 6, sz0 + 2); g.userData.radar = rad; }
      if (cls === 5) { const hp = add(new THREE.CylinderGeometry(6, 6, .25, 32), S({color: 0x2a5a3a}), 0, fb + hh + lv * 2.8 + .3, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(.5, .05, 3.6), whiteM, -1, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(.5, .05, 3.6), whiteM, 1, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(2, .05, .5), whiteM, 0, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2);
        cyl(yel, .6, .8, 6, -hw + 2, fb + 3, zs - 8); const boom = add(new THREE.BoxGeometry(.6, .6, 16), yel, -hw + 2, fb + 9, zs - 14); boom.rotation.x = .6; BW.push({x0: -hw + 1.2, x1: -hw + 2.8, z0: zs - 8.8, z1: zs - 7.2, y0: 0, y1: 3});
        for (const sd of [-1, 1]) box(yel, sd * (hw - 1.5) - .2, sd * (hw - 1.5) + .2, fb, fb + 5, zs - 1.2, zs - .8, 1); box(yel, -hw + 1.3, hw - 1.3, fb + 4.8, fb + 5.2, zs - 1.2, zs - .8); }
    }
    INTER.push({kind: 'ladder', boat: 1, lx: 0, lz: zs + 1, ly: -fb, r: 3.5, top: 'boat', label: () => 'Climb aboard', on: () => P.sw});
  } else {
    // research sub: a long yellow pressure hull, a glass dome over a flat cabin floor, dive planes, rudder, shrouded prop
    const R = hw, cy = fb - R * .52, sm = S({color: (PAINTS[B.up.paint || 0] || PAINTS[0]).c || H.col, roughness: .35, metalness: .3}), dl = zs - 2.6, df = zb + 4;
    const body = add(new THREE.CapsuleGeometry(R, L - R * 2, 10, 24), sm, 0, cy, (zb + zs) / 2); body.rotation.x = PI / 2;
    for (const z of [zb + 3, zs - 3]) { const b = add(new THREE.TorusGeometry(R * 1.005, .07, 6, 32), darkM, 0, cy, z); }
    const fl = R * .86; add(new THREE.BoxGeometry(fl * 2, .14, dl - df), S({map: TX.grate || TX.wood, color: 0x8a8a8a}), 0, fb - .07, (df + dl) / 2);
    const dome = add(new THREE.CylinderGeometry(fl, fl, dl - df, 28, 1, true, -PI / 2, PI), glass, 0, fb, (df + dl) / 2); dome.rotation.x = PI / 2; dome.rotation.z = 0; dome.rotation.y = 0; dome.rotation.order = 'XYZ'; dome.rotation.set(PI / 2, 0, PI / 2 * 0);
    dome.geometry.rotateY(PI / 2); const cap = add(new THREE.SphereGeometry(fl, 24, 12, 0, PI, 0, PI / 2), glass, 0, fb, df); cap.rotation.set(-PI / 2, 0, 0); cap.geometry.rotateX(0);
    for (let z = df; z <= dl; z += (dl - df) / 5) { const rib = add(new THREE.TorusGeometry(fl, .04, 6, 24, PI), steel, 0, fb, z); }
    box(sm, -fl, fl, fb - .1, fb + 2.4, dl, dl + .25); box(darkM, -.5, .5, fb, fb + 2, dl + .2, dl + .3);
    BW.push({x0: -fl - 1, x1: -fl + .25, z0: df - 2, z1: dl + .3, y0: 0, y1: 3}, {x0: fl - .25, x1: fl + 1, z0: df - 2, z1: dl + .3, y0: 0, y1: 3}, {x0: -fl, x1: fl, z0: df - 2, z1: df + .3, y0: 0, y1: 3}, {x0: -fl, x1: -.55, z0: dl, z1: dl + .3, y0: 0, y1: 3}, {x0: .55, x1: fl, z0: dl, z1: dl + .3, y0: 0, y1: 3});
    BW.push({x0: -.55, x1: .55, z0: dl, z1: dl + .3, y0: 0, y1: 3, hatch: 1});
    BDECK.x0 = -fl + .3; BDECK.x1 = fl - .3; BDECK.z0 = df + .3; BDECK.z1 = dl + 1.6; BDECK.y = fb;
    add(new THREE.BoxGeometry(1.2, .1, 1.4), steel, 0, fb - .05, dl + .9);
    for (const sd of [-1, 1]) { const pl = add(new THREE.BoxGeometry(2.6, .1, 1.2), darkM, sd * (R + 1.1), cy, zb + 5); g.userData['pl' + sd] = pl; const fn = add(new THREE.BoxGeometry(.1, 2.2, 1.6), darkM, 0, cy + sd * 1.6, zs - .4); fn.rotation.z = sd < 0 ? 0 : 0; add(new THREE.BoxGeometry(2.2, .1, 1.6), darkM, sd * 1.4, cy, zs - .4); }
    const shroud = add(new THREE.TorusGeometry(1.1, .12, 8, 24), darkM, 0, cy, zs + .5); const prop = new THREE.Group(); prop.position.set(0, cy, zs + .5); g.add(prop); for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.18, 1, .05), steel); b.rotation.z = i * PI / 2; b.position.set(Math.sin(i * PI / 2) * .45, Math.cos(i * PI / 2) * .45, 0); prop.add(b); } g.userData.prop = prop;
    for (const sd of [-1, 1]) add(new THREE.SphereGeometry(.25, 10, 8), S({color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 2}), sd * 1.2, cy - .4, zb + .9);
    const hz = df + 1.5; box(darkM, -.6, .6, fb, fb + 1, hz - .5, hz, 1);
    const wg = new THREE.Group(); wg.position.set(0, fb + 1.05, hz + .08); wg.rotation.x = -.45; g.add(wg); const ym = S({color: 0x222222}); wg.add(new THREE.Mesh(new THREE.TorusGeometry(.22, .03, 8, 20, PI), ym)); const yb = new THREE.Mesh(new THREE.BoxGeometry(.46, .05, .05), ym); wg.add(yb); g.userData.wheel = wg;
    const scr = add(new THREE.BoxGeometry(.9, .45, .04), S({color: 0x102030, emissive: 0x2a70a0, emissiveIntensity: .25}), 0, fb + 1.35, hz - .3); scr.rotation.x = -.5;
    BHELM[0] = 0; BHELM[1] = hz + .6; g.userData.lightZ = zb + .9; g.userData.lightY = cy - .4; g.userData.wz = [df, dl];
    BSPOT.hold[0] = 0; BSPOT.hold[1] = dl - 2.4; BSPOT.fuel[0] = fl - .6; BSPOT.fuel[1] = dl - .8; BSPOT.patch[0] = -fl + .6; BSPOT.patch[1] = dl - .8;
    box(S({map: TX.wood, color: 0x6a5a44}), -.9, .9, fb, fb + .22, BSPOT.hold[1] - .7, BSPOT.hold[1] + .7); BW.push({x0: -.9, x1: .9, z0: BSPOT.hold[1] - .7, z1: BSPOT.hold[1] + .7, y0: 0, y1: .2});
    cyl(redM, .13, .13, .32, BSPOT.fuel[0], fb + .16, BSPOT.fuel[1]); box(yel, BSPOT.patch[0] - .3, BSPOT.patch[0] + .3, fb, fb + .4, BSPOT.patch[1] - .2, BSPOT.patch[1] + .2);
    for (let y = -.8; y < fb; y += .3) box(steel, -.32, .32, y, y + .04, dl + 1.65, dl + 1.7);
    INTER.push({kind: 'ladder', boat: 1, lx: 0, lz: dl + 2.2, ly: -fb, r: 3.5, top: 'boat', label: () => 'Climb aboard', on: () => P.sw && (B.dep || 0) < .6});
  }
  const cargo = new THREE.Group(); g.add(cargo); g.userData.cargo = cargo; g.userData.cls = cls; g.userData.sig = cls + ':' + (B.up.paint || 0);
  { const gc = cv(128, 256, (q, w, h) => { const gr = q.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, w, h); });
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(W + 5, L + 6), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0})); gm.rotation.x = -PI / 2; gm.position.set(0, .12, (zb + zs) / 2); gm.renderOrder = 3; g.add(gm); g.userData.glow = gm; }
  INTER.push({kind: 'helm', boat: 1, lx: BHELM[0], lz: BHELM[1] - .4, ly: 1, r: 2, label: () => P.seat ? 'Let go of the wheel' : 'Take the wheel', on: () => !P.sw && (P.seat || !B.driver)});
  INTER.push({kind: 'hold', boat: 1, lx: BSPOT.hold[0], lz: BSPOT.hold[1], ly: .2, r: 2.4, label: () => { const v = sackVal(P.sack); return v ? `Stow your salvage in the hold ($${v})` + (B.hold.length >= holdMax() ? ' (hold full)' : '') : `Cargo hold: ${B.hold.length}/${holdMax()}, worth $${holdValue()}`; }, on: () => !P.sw});
  if (0) INTER.push({kind: 'fuelcap', boat: 1, lx: BSPOT.fuel[0], lz: BSPOT.fuel[1], ly: .2, r: 1.8, label: () => (P.sack || []).includes('fuel') ? 'Pour a fuel drum into the tank' : `Fuel tank: ${Math.round(B.fuel)}/${tankMax()}`, on: () => !P.sw});
  INTER.push({kind: 'patchbox', boat: 1, lx: BSPOT.patch[0], lz: BSPOT.patch[1], ly: .2, r: 1.8, label: () => (P.sack || []).includes('patch') ? 'Patch the hull' : `Hull: ${Math.round(B.hull)}/${hullMax()} (bring a patch kit)`, on: () => !P.sw});
  scene.add(g); BOAT = g;
}
function boatStep(dt) {
  if (B.sink > 0) { B.sink -= dt; B.v *= .95; if (B.sink <= 0) resetBoat(true); return; }
  const drv = B.driver && PL.get(B.driver); let thr = 0, st = 0;
  if (drv && drv.seat && !drv.down && !drv.dead) { thr = drv.in ? drv.in[0] : 0; st = drv.in ? drv.in[1] : 0; } else if (B.driver) B.driver = null;
  const lv = B.up.engine, empty = B.fuel <= 0, H = HC();
  B.thr = mix(B.thr, thr * (empty ? .18 : 1), Math.min(1, dt * 1.2)); B.st = mix(B.st, st, Math.min(1, dt * 2.5));
  B.fuel = tankMax();
  const acc = (B.thr > 0 ? B.thr * (2.4 + lv * .7) : B.thr * 1.2) * H.spd, drag = .028 / (1 + lv * .25) / H.spd;
  B.v += (acc - drag * B.v * Math.abs(B.v) - (Math.abs(B.thr) < .05 ? .25 * B.v : 0)) * dt;
  B.yaw += -B.st * clamp(B.v / 3.5, -1, 1) * .5 * H.turn * dt;
  if (H.sub) { const dv = drv && drv.seat && drv.in ? drv.in[2] || 0 : 0, mx = Math.max(0, Math.min(26, -seaBed(B.x, B.z) - 4)); B.dtar = clamp((B.dtar || 0) + dv * dt * 2.2, 0, mx); B.dep = (B.dep || 0) + clamp(B.dtar - (B.dep || 0), -dt * 1.6, dt * 1.6); } else B.dep = B.dtar = 0;
  B.x += -Math.sin(B.yaw) * B.v * dt; B.z += -Math.cos(B.yaw) * B.v * dt;
  let hit = 0;
  const r = BG.hw * .95, n = Math.max(3, Math.ceil((BG.zs - BG.zb - r * 2) / 3));
  for (let ci = 0; ci <= n; ci++) { const lz = mix(BG.zb + r * .9, BG.zs - r * .6, ci / n);
    const [cx, cz] = bL2W(0, lz);
    for (const o of OBST) {
      let d, nx, nz;
      if (o.c) { if (Math.abs(cx - o.x) > o.r + r || Math.abs(cz - o.z) > o.r + r) continue; const px = cx - o.x, pz = cz - o.z, e = Math.hypot(px, pz); if (e >= o.r + r) continue; nx = px / e; nz = pz / e; d = o.r + r - e; }
      else { const qx = clamp(cx, o.x0, o.x1), qz = clamp(cz, o.z0, o.z1), px = cx - qx, pz = cz - qz, e = Math.hypot(px, pz); if (e >= r) continue; if (e < 1e-4) { nx = 0; nz = -1; d = r; } else { nx = px / e; nz = pz / e; d = r - e; } }
      B.x += nx * d; B.z += nz * d; hit = Math.max(hit, Math.abs(B.v));
    }
  }
  const rr = Math.hypot(B.x, B.z + 60); if (rr > 2600) { B.x *= 2600 / rr; B.z = (B.z + 60) * 2600 / rr - 60; hit = Math.max(hit, Math.abs(B.v)); }
  if (hit) { if (hit > 2.5) { emit({k: 'bump', s: Math.min(1, hit / 7)}); if (hit > 3.5) damageBoat((hit - 3) * 4); } B.v *= .4; }
  if (Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 30 + BG.L * .5 && Math.abs(B.v) < 2) { B.fuel = Math.min(tankMax(), B.fuel + dt * 10); B.hull = Math.min(hullMax(), B.hull + dt * 6); }
}
function damageBoat(n) { if (B.sink > 0) return; B.hull = Math.max(0, B.hull - n); if (B.hull <= 0) { B.sink = 4.5; B.driver = null; emit({k: 'sink'}); } }
function resetBoat(sunk) {
  const wasX = B.x, wasZ = B.z;
  Object.assign(B, {x: JETTY.x - 2.1 - BG.hw, z: JETTY.z + 3 + Math.max(0, BG.L - 12) * .5, yaw: PI, v: 0, thr: 0, st: 0, driver: null, sink: 0, dep: 0, dtar: 0}); B.hull = Math.max(B.hull, hullMax() * .6); B.fuel = Math.max(B.fuel, tankMax() * .4);
  if (sunk) { B.hold = []; emit({k: 'boatback', x: wasX, z: wasZ}); }
}

// ---------------- rig creature navigation
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
function nodeNear(x, z, l, rad = 6) { const n = NG.n, ci = Math.floor(x - NG.x0), cj = Math.floor(z - NG.z0); let best = -1, bd = 1e9; for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(l, i, j); if (!NG.cells[k]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; } } return best; }
function levelOf(y) { let b = 0, bd = 1e9; for (let l = 0; l < LV.length; l++) { const d = Math.abs(y - LV[l]); if (d < bd) { bd = d; b = l; } } return b; }
function astar(s, g) {
  if (s < 0 || g < 0) return null; if (s === g) return [s];
  const n = NG.n, open = [s], came = new Map(), gs = new Map([[s, 0]]), closed = new Set(); const [gx, gz, gl] = nPos(g);
  const hh = k => { const [x, z, l] = nPos(k); return Math.hypot(x - gx, z - gz) + Math.abs(l - gl) * 10; };
  const fs = new Map([[s, hh(s)]]); let it = 0;
  while (open.length && it++ < 9000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (fs.get(open[i]) < fs.get(open[bi])) bi = i;
    const c = open.splice(bi, 1)[0]; if (c === g) { const path = [c]; let k = c; while (came.has(k)) { k = came.get(k); path.unshift(k); } return path; }
    closed.add(c); const [cx, cz, cl] = nPos(c), ci = Math.floor(cx - NG.x0), cj = Math.floor(cz - NG.z0); const nb = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(cl, i, j); if (!NG.cells[k]) continue; if (di && dj && (!NG.cells[nIdx(cl, ci + di, cj)] || !NG.cells[nIdx(cl, ci, cj + dj)])) continue; nb.push([k, Math.hypot(di, dj)]); }
    for (const lk of NG.links.get(c) || []) nb.push([lk.to, 12]);
    for (const [k, w] of nb) { if (closed.has(k)) continue; const t = gs.get(c) + w; if (t < (gs.get(k) ?? 1e9)) { came.set(k, c); gs.set(k, t); fs.set(k, t + hh(k)); if (!open.includes(k)) open.push(k); } }
  }
  return null;
}
function navPath(fx, fy, fz, tx, ty, tz) {
  const s = nodeNear(fx, fz, levelOf(fy)), g = nodeNear(tx, tz, levelOf(ty), 10); const p = astar(s, g); if (!p) return null;
  const out = []; for (let i = 0; i < p.length; i++) { const a = p[i]; out.push(nPos(a)); if (i < p.length - 1) { const lk = (NG.links.get(a) || []).find(q => q.to === p[i + 1]); if (lk) for (const v of lk.via) out.push([v[0], v[1], -1]); } }
  const sm = [out[0]]; let i = 0;
  while (i < out.length - 1) { let j = i + 1; while (j + 1 < out.length && out[j + 1][2] === out[i][2] && out[i][2] >= 0 && clearLine(out[i][0], out[i][1], out[j + 1][0], out[j + 1][1], LV[out[i][2]] + 1)) j++; sm.push(out[j]); i = j; }
  sm.push([tx, tz, levelOf(ty)]); return sm;
}
function clearLine(ax, az, bx, bz, y) { for (const w of WALLS) { if (w.y1 < y - .7 || w.y0 > y + .5) continue; if (segRect(ax, az, bx, bz, {x0: w.x0 - .35, x1: w.x1 + .35, z0: w.z0 - .35, z1: w.z1 + .35})) return false; } return true; }

// ---------------- physics helpers
function floorAt(x, z, y, noBoat) {
  let best = null;
  for (const s of SURF) { if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue; let h; if (s.k === 'slab') h = s.y; else if (s.k === 'ramp') h = rampY(s, x, z); else { if (Math.hypot(x - s.x, z - s.z) > s.r) continue; h = s.y; } if (h <= y + .75 && (!best || h > best.y)) best = {y: h, s}; }
  const lh = landH(x, z); if (lh > -8 && lh <= y + .75 && (!best || lh > best.y)) best = {y: lh, s: {k: 'land'}};
  if (!noBoat && BOAT && B.sink <= 0) { const [lx, lz] = bW2L(x, z); if (lx > BDECK.x0 && lx < BDECK.x1 && lz > BDECK.z0 && lz < BDECK.z1) { const h = BDECK.y; if (h <= y + .75 && (!best || h > best.y)) best = {y: h, s: {k: 'boat'}}; } }
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
  for (const c of PCIRC) { if (Math.abs(o.x - c.x) > c.r + 1 || Math.abs(o.z - c.z) > c.r + 1) continue; const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz); if (d < c.r + r && d > 1e-4 && y < 25) { o.x = c.x + dx / d * (c.r + r); o.z = c.z + dz / d * (c.r + r); } }
  if (BOAT && Math.hypot(o.x - B.x, o.z - B.z) < 9) { const [lx, lz] = bW2L(o.x, o.z), q = {x: lx, z: lz}; pushRects(q, r, BW.filter(w => !w.hatch || (B.dep || 0) > .6), y - BDECK.y + .2, y - BDECK.y + 1.7); if (q.x !== lx || q.z !== lz) { const [wx, wz] = bL2W(q.x, q.z); o.x = wx; o.z = wz; } }
}
function seeLine(ax, ay, az, bx, by, bz) { if (Math.abs(ay - by) > 3.8) return false; const h = (ay + by) / 2 + 1.3; for (const w of WALLS) { if (!w.see || w.y0 > h || w.y1 < h) continue; if (segRect(ax, az, bx, bz, w)) return false; } return true; }
const nearRig = (x, z) => Math.hypot(x, z) < 45;

// ---------------- creature on the rig
const MON = new THREE.Group(), MJ = {fing: []};
function buildCreature() { makeCreature(MON, MJ); }
function makeCreature(MON, MJ, o = {}) {
  // a gaunt, wet, eyeless thing: lathe torso with ribs, long three-joint arms with clawed fingers, digitigrade legs, a skull that splits open
  const skT = tex(cv(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5e58'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) { g.fillStyle = `rgba(${18 + Math.random() * 40 | 0},${20 + Math.random() * 38 | 0},${20 + Math.random() * 30 | 0},${.18 + Math.random() * .4})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 16, 0, TAU); g.fill(); }
    g.lineWidth = 1.3; for (let i = 0; i < 46; i++) { let x = Math.random() * w, y = Math.random() * h; g.strokeStyle = `rgba(${60 + Math.random() * 40 | 0},20,30,.4)`; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (Math.random() - .5) * 26; y += Math.random() * 18; g.lineTo(x, y); } g.stroke(); }
    noiseFill(g, w, h, 34);
  }), 2);
  const skin = new THREE.MeshStandardMaterial({map: skT, bumpMap: skT, bumpScale: 2.5, color: o.col || 0x4a504a, roughness: .38, metalness: 0, envMapIntensity: .35});
  const bone = new THREE.MeshStandardMaterial({color: 0xc8bea0, roughness: .3}), gum = new THREE.MeshStandardMaterial({color: 0x3a0a0c, roughness: .25}), hole = new THREE.MeshBasicMaterial({color: 0x020202});
  const eye = new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(.75, .85, .7)});
  const mesh = (g, m = skin) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
  const seg = (r0, r1, l, m = skin, rs = 9) => { const g = new THREE.CylinderGeometry(r0 * 1.4, r1 * 1.4, l, rs, 2); g.translate(0, -l / 2, 0); return mesh(g, m); };
  const knob = (r, p, y = 0) => { const s = mesh(new THREE.SphereGeometry(r, 9, 7)); s.position.y = y; p.add(s); return s; };
  const hips = new THREE.Group(); hips.position.y = 1.2; MON.add(hips); MJ.hips = hips;
  const pel = mesh(new THREE.SphereGeometry(.14, 12, 8)); pel.scale.set(1.15, .7, .75); hips.add(pel);
  const torso = new THREE.Group(); hips.add(torso); MJ.torso = torso;
  const prof = [[.02, -.04], [.12, 0], [.12, .08], [.08, .22], [.085, .3], [.15, .42], [.185, .55], [.195, .66], [.175, .76], [.11, .82], [.04, .86]].map(([r, y]) => new THREE.Vector2(r, y));
  const tg = new THREE.LatheGeometry(prof, 16); tg.scale(1.15, 1, .7); const tm = mesh(tg); torso.add(tm); MJ.chest = tm;
  for (let i = 0; i < 6; i++) { const y = .43 + i * .062, r = [.155, .175, .188, .195, .19, .18][i]; const rb = mesh(new THREE.TorusGeometry(r * 1.03, .012, 4, 16, PI * 1.1), skin); rb.rotation.set(PI / 2, 0, -.05 * PI); rb.scale.set(1, .62, 1); rb.position.y = y; torso.add(rb); }
  for (let i = 0; i < 9; i++) { const s = mesh(new THREE.SphereGeometry(.03, 6, 4)); s.position.set(0, .12 + i * .085, -(i < 4 ? .07 : .1)); torso.add(s); }
  for (const s of [-1, 1]) { const b = mesh(new THREE.SphereGeometry(.09, 8, 6)); b.scale.set(1, 1.3, .35); b.position.set(s * .1, .64, -.1); torso.add(b); }
  const neck = new THREE.Group(); neck.position.y = .83; torso.add(neck); MJ.neck = neck;
  const ng = new THREE.CylinderGeometry(.045, .06, .26, 8); ng.translate(0, .13, 0); neck.add(mesh(ng));
  const head = new THREE.Group(); head.position.set(0, .27, .02); neck.add(head); MJ.head = head;
  const cr = mesh(new THREE.SphereGeometry(.12, 18, 14)); cr.scale.set(.92, .88, 1.55); cr.position.set(0, .07, -.05); head.add(cr);
  const sn = mesh(new THREE.SphereGeometry(.09, 14, 10)); sn.scale.set(.85, .55, 1.45); sn.position.set(0, .01, .1); head.add(sn);
  for (const s of [-1, 1]) {
    const so = new THREE.Mesh(new THREE.SphereGeometry(.026, 8, 6), hole); so.position.set(s * .05, .06, .155); so.scale.set(1, .8, .5); head.add(so);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.008, 6, 4), eye); e.position.set(s * .05, .06, .163); head.add(e);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(.005, 6, 4), eye); e2.position.set(s * .075, .085, .13); head.add(e2);
    const ch = mesh(new THREE.SphereGeometry(.04, 8, 6)); ch.scale.set(.6, 1, 1.4); ch.position.set(s * .07, -.01, .06); head.add(ch);
  }
  const tooth = (p, x, y, z, l, down) => { const t = new THREE.Mesh(new THREE.ConeGeometry(.0065, l, 4), bone); t.position.set(x, y, z); t.rotation.x = down ? PI : 0; p.add(t); };
  for (let i = 0; i < 13; i++) { const a = -1.25 + i / 12 * 2.5; tooth(head, Math.sin(a) * .068, -.04, .1 + Math.cos(a) * .1, .03 + Math.random() * .03, true); }
  const jaw = new THREE.Group(); jaw.position.set(0, -.03, -.03); head.add(jaw); MJ.jaw = jaw;
  const jm = mesh(new THREE.SphereGeometry(.08, 12, 8)); jm.scale.set(.9, .38, 1.75); jm.position.set(0, -.035, .12); jaw.add(jm);
  const mi = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), gum); mi.scale.set(.8, .5, 1.6); mi.position.set(0, -.005, .1); jaw.add(mi);
  for (let i = 0; i < 12; i++) { const a = -1.2 + i / 11 * 2.4; tooth(jaw, Math.sin(a) * .062, -.002, .13 + Math.cos(a) * .09, .028 + Math.random() * .028, false); }
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .2, .76, -.01); torso.add(sh); MJ['sh' + s] = sh; knob(.055, sh); sh.add(seg(.05, .034, .52));
    const el = new THREE.Group(); el.position.y = -.52; sh.add(el); MJ['el' + s] = el; knob(.036, el); el.add(seg(.038, .024, .62));
    const wr = new THREE.Group(); wr.position.y = -.62; el.add(wr); MJ['wr' + s] = wr;
    const pm = mesh(new THREE.BoxGeometry(.065, .1, .025)); pm.position.y = -.05; wr.add(pm); const fs = [];
    for (let f = 0; f < 4; f++) {
      const f0 = new THREE.Group(); f0.position.set((f - 1.5) * .019, -.1, 0); f0.rotation.z = (f - 1.5) * .09; wr.add(f0); f0.add(seg(.009, .008, .11, skin, 5));
      const f1 = new THREE.Group(); f1.position.y = -.11; f0.add(f1); f1.add(seg(.008, .006, .1, skin, 5));
      const f2 = new THREE.Group(); f2.position.y = -.1; f1.add(f2); f2.add(seg(.006, .004, .08, skin, 5));
      const cl = new THREE.Mesh(new THREE.ConeGeometry(.005, .07, 4), bone); cl.rotation.x = PI + .3; cl.position.set(0, -.11, .01); f2.add(cl); fs.push([f0, f1, f2]);
    }
    MJ.fing.push(fs);
    const hp = new THREE.Group(); hp.position.set(s * .1, 0, 0); hips.add(hp); MJ['hp' + s] = hp; hp.add(seg(.075, .045, .5));
    const kn = new THREE.Group(); kn.position.y = -.5; hp.add(kn); MJ['kn' + s] = kn; knob(.045, kn); kn.add(seg(.045, .03, .48));
    const an = new THREE.Group(); an.position.y = -.48; kn.add(an); MJ['an' + s] = an; knob(.03, an); an.add(seg(.03, .022, .3));
    const toe = new THREE.Group(); toe.position.y = -.3; an.add(toe); MJ['to' + s] = toe;
    for (let f = 0; f < 3; f++) { const tg2 = new THREE.CylinderGeometry(.012, .008, .14, 5); tg2.rotateX(PI / 2); tg2.translate(0, 0, .07); const t = mesh(tg2); t.position.x = (f - 1) * .025; t.rotation.y = (f - 1) * .25; toe.add(t); const c = new THREE.Mesh(new THREE.ConeGeometry(.006, .05, 4), bone); c.rotation.x = PI / 2 + .4; c.position.set((f - 1) * .03, -.01, .16); toe.add(c); }
  }
  if (o.mask) { // a cracked porcelain face with a painted smile, a rotten steward's jacket
    const pm = new THREE.MeshStandardMaterial({color: 0xe8e2d4, roughness: .25}), bk = new THREE.MeshBasicMaterial({color: 0x050505});
    const mk = new THREE.Mesh(new THREE.SphereGeometry(.125, 18, 12, 0, PI * 2, 0, PI * .62), pm); mk.rotation.x = PI / 2; mk.scale.set(1, 1, .75); mk.position.set(0, .06, .1); MJ.head.add(mk);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), bk); e.scale.set(1, 1.6, .4); e.position.set(sx * .045, .09, .2); MJ.head.add(e); }
    const sm = new THREE.Mesh(new THREE.TorusGeometry(.06, .007, 4, 16, PI), bk); sm.rotation.z = PI; sm.position.set(0, .03, .2); MJ.head.add(sm);
    const cr = new THREE.Mesh(new THREE.BoxGeometry(.004, .09, .004), bk); cr.rotation.z = .5; cr.position.set(.05, .12, .195); MJ.head.add(cr);
    const jm = new THREE.MeshStandardMaterial({color: 0x161c2a, roughness: .9}); const jk = new THREE.Mesh(new THREE.CylinderGeometry(.23, .19, .62, 10), jm); jk.scale.set(1.15, 1, .75); jk.position.y = .5; MJ.torso.add(jk);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.015, 6, 4), new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3})); b.position.set(.05, .3 + i * .12, .16); MJ.torso.add(b); }
  }
  MON.scale.setScalar(o.s || 1);
  MON.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(MON);
}
const _mh = new THREE.Vector3();
function animCreature(dt, st, spd) { animBody(MON, MJ, M, dt, st, spd); }
function animBody(MON, MJ, M, dt, st, spd) {
  MON.visible = st !== 'gone'; if (st === 'gone') return;
  const t = G.wt, js = G.js && G.js.t > 0 && G.js.mon === MON;
  if (st === 'dead' && !js) { MON.position.set(M.x, M.y + .2, M.z); MON.rotation.set(-1.45, M.yaw + PI, 0, 'YXZ'); MJ.jaw.rotation.x = .9; return; }
  MON.rotation.set(0, M.yaw + PI, 0, 'YXZ');
  const chase = st === 'chase', four = chase && spd > 2.5, k = clamp(spd / 2.6, 0, 1.25);
  M.four = mix(M.four || 0, four ? 1 : 0, Math.min(1, dt * 4)); const q = M.four;
  // the step cycle advances with distance covered, so the feet never slide
  M.ph += spd * dt / mix(1.6, 3.4, q) * TAU; if (spd < .15) M.ph += (Math.round(M.ph / PI) * PI - M.ph) * Math.min(1, dt * 4);
  M.frz = (M.frz || 0) - dt; if (!chase && spd < .3 && M.frz <= 0 && Math.random() < dt * .12) M.frz = .9 + Math.random() * 1.6;
  const yr = angD(M.pyaw ?? M.yaw, M.yaw) / Math.max(dt, 1e-3); M.pyaw = M.yaw; M.lean = mix(M.lean || 0, clamp(yr * Math.max(spd, 1) * .045, -.3, .3), Math.min(1, dt * 5));
  const ph = M.ph, s = Math.sin(ph), c = Math.cos(ph);
  if (M.frz <= 0 || chase || js) for (const g of [-1, 1]) {
    const lp = ph + (g > 0 ? 0 : PI), sw = Math.sin(lp), lift = Math.max(0, Math.cos(lp + .55));
    const gp = ph + (g > 0 ? 0 : .4), gs = Math.sin(gp), gl = Math.max(0, Math.cos(gp + .5)), ap = gp + PI * .8, as = Math.sin(ap), al = Math.max(0, Math.cos(ap + .5));
    MJ['hp' + g].rotation.x = mix(-.33 - sw * .45 * k, -1.2 + gs * .8, q); MJ['kn' + g].rotation.x = mix(.82 + lift * 1.05 * k, 1.4 + gl * .9, q);
    MJ['an' + g].rotation.x = mix(-.72 - lift * .5 * k + sw * .16 * k, -.95 - gl * .55, q); MJ['to' + g].rotation.x = mix(.25 + lift * .35 * k, .55 + gl * .3, q);
    MJ['sh' + g].rotation.x = mix(.12 + sw * .3 * k, -1.7 - as * .85, q); MJ['sh' + g].rotation.z = g * mix(.1 + .04 * k, .22, q); MJ['el' + g].rotation.x = mix(-.22 - k * .2 - Math.max(0, -sw) * .2 * k, -.3 + al * .7, q); MJ['wr' + g].rotation.x = mix(-.15, .45 + al * .3, q);
  }
  const curl = chase ? .55 + Math.sin(t * 9) * .1 : .35 + Math.sin(t * 1.7) * .1;
  MJ.fing.forEach(fs => fs.forEach(([a, b, d], i) => { a.rotation.x = curl * .6; b.rotation.x = curl; d.rotation.x = curl * .8 + Math.sin(t * 3 + i) * .05; }));
  if (M.frz <= 0 || chase || js) { MJ.hips.position.y = mix(1.14 + Math.abs(c) * .07 * k, .88 + Math.max(0, Math.sin(ph + 1.2)) * .14, q); MJ.hips.rotation.set(0, 0, s * .07 * k * (1 - q) + M.lean * .4);
    MJ.torso.rotation.set(mix(.36 + k * .14, 1.18 + Math.sin(ph + 2.4) * .16, q), -s * .14 * k * (1 - q), -s * .05 * k * (1 - q) + M.lean * .6, 'YXZ'); }
  const br = 1 + Math.sin(t * (chase ? 7 : 1.8)) * (chase ? .05 : .03); MJ.chest.scale.set(br, 1, br);
  // head: snaps and twitches; within 30 m and not chasing, it turns (too far) to stare at you
  M.jit -= dt; if (M.jit < 0) { M.jit = .12 + Math.random() * 1.1; M.jr = (Math.random() - .5) * (chase ? 1.2 : .9); }
  let hy = 0, hx = 0;
  if (P && !P.dead && !chase) { const dx = cam.position.x - M.x, dz = cam.position.z - M.z, d = Math.hypot(dx, dz); if (d < 30) { const want = angD(M.yaw, Math.atan2(-dx, -dz)); hy = clamp(want, -2.3, 2.3); hx = clamp(-Math.atan2(cam.position.y - (M.y + 2.1), d), -.6, .6); } }
  M.sq = (M.sq || 0) - dt; if (M.sq <= 0 || chase) { M.sq = chase ? 0 : .18 + Math.random() * .3; M.hyQ = hy; M.hxQ = hx; }
  MJ.head.rotation.set(mix(0, M.hxQ || 0, 1 - q), (M.hyQ || 0) * (1 - q), mix(MJ.head.rotation.z, mix(M.jr, 1.85 + Math.sin(t * 6) * .12, q), Math.min(1, dt * 22)), 'YXZ');
  MJ.neck.rotation.x = mix(-.42 - k * .1 + (M.look || 0) - Math.abs(c) * .05 * k, -1.1 - Math.sin(ph + 2.4) * .14, q);
  MJ.jaw.rotation.x = chase ? .75 + Math.sin(t * 30) * .08 + Math.random() * .05 : .12 + Math.max(0, Math.sin(t * .7)) * .25;
  MON.position.set(M.x, M.y, M.z);
  if (js) {
    // jumpscare: it is in your face, upright, arms up, jaw wide
    const u = 1 - G.js.t / G.js.L; cam.getWorldDirection(_mh); _mh.y = 0; _mh.normalize();
    const sc = MON.scale.x; MON.position.set(cam.position.x + _mh.x * 1.05 * sc, cam.position.y - 2.1 * sc + Math.sin(u * 30) * .02, cam.position.z + _mh.z * 1.05 * sc);
    MON.rotation.set(0, Math.atan2(-_mh.x, -_mh.z), 0, 'YXZ');
    MJ.hips.position.y = 1.2; MJ.torso.rotation.x = .55 + Math.sin(t * 40) * .03; MJ.neck.rotation.x = -.6; MJ.head.rotation.set(-.15, Math.sin(t * 23) * .08, Math.sin(t * 17) * .25, 'YXZ');
    for (const g of [-1, 1]) { MJ['sh' + g].rotation.set(-2.3 + Math.sin(t * 31 + g) * .1, 0, g * .45); MJ['el' + g].rotation.x = -.5; MJ['hp' + g].rotation.x = -.35; MJ['kn' + g].rotation.x = .85; MJ['an' + g].rotation.x = -.75; }
    MJ.jaw.rotation.x = 1.05 + Math.random() * .08;
  }
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
  const box = m(new THREE.SphereGeometry(.26, 10, 8), new THREE.MeshStandardMaterial({color: 0x8a7a5a, roughness: .95}), 0, .45, .26, body); box.scale.set(1, 1.15, .75); j.box = box;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 20, 1, true), new THREE.MeshBasicMaterial({color: 0xfff0d0, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false}));
  beam.geometry.translate(0, -7, 0); beam.geometry.rotateX(PI / 2); beam.position.set(0, -.6, -.15); j.a1.add(beam); j.beam = beam;
  const blk = new THREE.MeshStandardMaterial({color: 0x1a1c1e, metalness: .6, roughness: .4});
  j.it = [null, m(new THREE.CylinderGeometry(.012, .02, 1.8, 5), new THREE.MeshStandardMaterial({color: 0x3a2a1a}), 0, -1.2, -.6, j.a1), m(new THREE.BoxGeometry(.05, .12, .2), blk, 0, -.62, -.1, j.a1), m(new THREE.BoxGeometry(.06, .08, .8), blk, 0, -.6, -.25, j.a1)];
  j.it[1].rotation.x = -1.1;
  g.userData = j; scene.add(g); return g;
}
function animCrew(p, dt) {
  const g = p.av, j = g.userData; g.visible = !p.dead && p.hd < 0 && p.ready; if (!g.visible) return;
  g.position.set(p.rx, p.ry + (p.sw ? -1.1 : 0), p.rz); g.rotation.y = p.ryaw;
  p.anim = (p.anim || 0) + dt * p.rspd * 2.2; const s = Math.sin(p.anim) * clamp(p.rspd / 3, 0, 1);
  j.l1.rotation.x = s * .6; j['l-1'].rotation.x = -s * .6; j['a-1'].rotation.x = p.sw ? -2.5 + Math.sin(G.t * 4) : -s * .5; j.a1.rotation.x = -.6 - p.rpitch * .8;
  j.body.rotation.x = p.cr ? .35 : 0; j.body.position.y = p.cr ? .7 : .95; j.box.visible = !!(p.sack && p.sack.length); j.box.scale.setScalar(.7 + Math.min(1, sackUsed(p.sack) / 8) * .5);
  if (p.down) { g.rotation.x = -PI / 2 + .15; g.position.y += .25; } else g.rotation.x = 0;
  j.head.rotation.x = -p.rpitch * .5; j.beam.visible = !!p.l && !p.down && !p.sw;
  for (let i = 1; i < 4; i++) j.it[i].visible = p.eq === i + 1 && !p.down && !p.sw; if (p.eq >= 2) j.a1.rotation.x = -1.3 - p.rpitch * .8;
}

// ---------------- state
const TOD_LEN = 960;
const G = {wt: 0, tod: .015, on: false, t: 0, seed: 1, evq: [], holdP: {}, flares: [], msgT: 0, noteOpen: false, map: false, paused: false, spec: 0, sea: 1, power: false, lightT: 8, storm: 0, cash: 0, earned: 0, disc: [], goals: [], bbOut: false, floats: [], shopOpen: false};
const PL = new Map(); let P = null;
const M = {hp: 140, x: 0, z: 0, y: LV[2], yaw: 0, state: 'roam', path: [], rep: 0, goal: null, spd: 0, ph: 0, jit: 0, jr: 0, aware: 0, lostT: 0, idle: 0, flee: 0, sawHide: -1, chk: [], chkT: 0, stuck: 0, sx: 0, sz: 0, screamT: 0, look: 0, seenAt: -99, tgt: null, preyT: 0, prey: null, vy: 0, wet: 0};
function mkPlayer(id, name, c) { return {id, name, c, sack: [], sc: 0, x: 0, z: 0, y: BDECK.y, yaw: 0, pitch: 0, cr: 0, l: 1, run: 0, h: '', hd: -1, hb: 0, down: false, bleed: 0, dead: false, deadT: 0, ready: false, sd: 0, lx: 0, lz: 0, spd: 0, rx: 0, ry: 0, rz: 0, ryaw: 0, rpitch: 0, rspd: 0, av: null, tag: null, heat: 0, ob: 0, bl: [0, 0], sw: 0, deep: 0, swT: 0, seat: 0, in: [0, 0], carry: null, cooler: [], eq: 0}; }
function ensurePlayer(id, name, c) { let p = PL.get(id); if (!p) { p = mkPlayer(id, name, c); PL.set(id, p); } p.name = name; p.c = c; if (!p.av) { p.av = buildCrew(CREW_COL[c % 6]); const t = document.createElement('div'); t.className = 'tag'; $('tags').appendChild(t); p.tag = t; } return p; }
function syncCrew(crew) { const ids = new Set(crew.map(c => c.id)); for (const [id, p] of PL) if (!ids.has(id)) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); PL.delete(id); if (B.driver === id) B.driver = null; } for (const c of crew) ensurePlayer(c.id, c.name, c.c); P = PL.get(myId()); }
const alive = () => [...PL.values()].filter(p => p.ready && !p.down && !p.dead);
const onRig = p => !p.ob && !p.sw && p.y > 1 && nearRig(p.x, p.z);

// ---------------- items and salvage
const NAMES = {pearl: 'black pearl', gold: 'gold bar', key: "captain's key card", crate: 'cargo crate', scrap: 'scrap metal', fuel: 'fuel drum', patch: 'patch kit', relic: 'ghostly relic', chest: 'treasure chest', blackbox: 'black box', fang: 'creature fang', bottle: 'bottle', battery: 'batteries', flare: 'flare', note: 'note'};
const VALUE = {crate: 40, scrap: 25, relic: 180, chest: 260, blackbox: 450, fang: 140, fuel: 35, pearl: 90, gold: 320};
const CARRY = new Set(['crate', 'scrap', 'fuel', 'patch', 'relic', 'chest', 'blackbox', 'fang', 'pearl', 'gold', 'key']);
const KINDS = ['crate', 'scrap', 'fuel', 'patch', 'relic', 'chest', 'blackbox', 'bottle', 'battery', 'flare', 'note', 'fang', 'pearl', 'gold', 'key'];
const holdValue = () => B.hold.reduce((s, k) => s + (VALUE[k] || 0), 0);
// the sack: several things at once, each takes slots by size
const SZ = {crate: 2, scrap: 1, fuel: 2, patch: 1, relic: 1, chest: 3, blackbox: 2, fang: 1, pearl: 1, gold: 2, key: 1};
const sackCap = p => [4, 7, 10][(p === P ? (P.own && P.own.sack) : p.sc) || 0] || 4;
const sackUsed = q => (q || []).reduce((a, k) => a + (SZ[k] || 1), 0);
const sackVal = q => (q || []).reduce((a, k) => a + (VALUE[k] || 0), 0);
const sackFits = (p, k) => sackUsed(p.sack) + (SZ[k] || 1) <= sackCap(p);
function sackSet(p) { p.carry = p.sack.length ? p.sack[p.sack.length - 1] : null; emit({k: 'sack', id: p.id, s: p.sack.map(k => KINDS.indexOf(k))}); }
function itemMesh(kind) {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .5}, o)); const g = new THREE.Group();
  if (kind === 'battery') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .1, 10), S({color: 0x2a5a2a, metalness: .4})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'flare') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .26, 8), S({color: 0xb0201a, emissive: 0x300000})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'note') { const n = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), S({map: TX.paper, side: THREE.DoubleSide, roughness: 1})); n.rotation.x = -PI / 2; g.add(n); }
  else if (kind === 'bottle') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .3, 10), S({color: 0x4a8a5a, transparent: true, opacity: .7, roughness: .1, emissive: 0x0a2a10})); b.rotation.z = PI / 2.3; b.position.y = .05; g.add(b); }
  else if (kind === 'crate') { const b = new THREE.Mesh(new THREE.BoxGeometry(.7, .5, .55), S({map: TX.wood, color: 0xa08a64})); b.position.y = .25; g.add(b); }
  else if (kind === 'scrap') { for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.6 - i * .1, .08, .3), S({map: TX.rustH, metalness: .6})); b.position.set(0, .05 + i * .08, 0); b.rotation.y = i; g.add(b); } }
  else if (kind === 'fuel') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .7, 12), S({color: 0x9a2418, metalness: .4})); b.position.y = .35; g.add(b); }
  else if (kind === 'patch') { const b = new THREE.Mesh(new THREE.BoxGeometry(.45, .3, .3), S({color: 0xd8b020})); b.position.y = .15; g.add(b); }
  else if (kind === 'relic') { const b = new THREE.Mesh(new THREE.OctahedronGeometry(.18), S({color: 0x9affd0, emissive: 0x2aff9a, emissiveIntensity: .8, roughness: .2})); b.position.y = .25; g.add(b); }
  else if (kind === 'chest') { const b = new THREE.Mesh(new THREE.BoxGeometry(.8, .5, .5), S({map: TX.wood, color: 0x7a5a2a})); b.position.y = .25; g.add(b); const l = new THREE.Mesh(new THREE.BoxGeometry(.82, .06, .52), S({color: 0xd8a830, metalness: .8})); l.position.y = .45; g.add(l); }
  else if (kind === 'fang') { const b = new THREE.Mesh(new THREE.ConeGeometry(.08, .45, 6), S({color: 0xe8e0c8, roughness: .3})); b.rotation.z = PI / 2.2; b.position.y = .08; g.add(b); }
  else if (kind === 'pearl') { const b = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), S({color: 0x1a1c24, metalness: .6, roughness: .08})); b.position.y = .07; g.add(b); const sh = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 6, 0, TAU, 0, PI / 2), S({color: 0x8a8070, side: THREE.DoubleSide})); sh.scale.y = .4; g.add(sh); }
  else if (kind === 'gold') { const b = new THREE.Mesh(new THREE.BoxGeometry(.32, .1, .14), S({color: 0xe0b030, metalness: 1, roughness: .2})); b.position.y = .05; g.add(b); const c = b.clone(); c.position.set(.05, .15, 0); c.rotation.y = .3; g.add(c); }
  else if (kind === 'key') { const b = new THREE.Mesh(new THREE.BoxGeometry(.09, .005, .055), S({color: 0xc8a030, metalness: .8, roughness: .3})); b.position.y = .01; g.add(b); }
  else if (kind === 'blackbox') { const b = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, .5), S({color: 0xd05a10})); b.position.y = .15; g.add(b); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}
const ITEMS = [];
const NOTES = [
  'DRILL LOG, STATION NINE\n\n03:10 Bit dropped into a void at 3,100 m.\n03:40 Mud returns warm. Smells like a fish market.\n04:15 Something on the drill floor camera. Climbing the pipe.\n04:16 Camera down.',
  'Both fuel valves are shut, one on the dock and one on the main deck under the top deck. The generator will not turn over until they are open. The flight recorder is in the control room and needs power to eject.\n\nIt hears the valves. It hears everything.',
  'Mikkel saw it hanging off the derrick upside down. It goes for whoever is on their own. We stopped splitting up. Then we stopped being enough to stay together.',
  "HERMIT'S LOG\n\nForty years on this rock. The big one circles boats out past the buoys when it is dark and the sea is rough. It hates red light. Drop a flare in the water and it sinks away.\n\nIt never comes into the shallows.",
  "MS SERENADE, purser's note, pinned inside the ballroom piano\n\nThe passengers went ashore at the last port and never came back aboard. Only the Steward stayed. It still makes up the cabins every night. It still wears the face.\n\nThe captain locked his key card in his quarters, the first cabin by the bow. Without it the engines on the bridge will not start.\n\nDo not let it hear you on the stairs.",
  "GREY LADY, ship's log, last page\n\nThe lights in the hold glow green at night now. The crew will not go below. I sealed the relics in the cabin. Whoever finds them, sell them far from here.",
];
function placeItems() {
  for (const it of ITEMS) scene.remove(it.mesh); ITEMS.length = 0;
  const by = t => SPOTS.filter(s => s.tag === t).sort(() => WR() - .5);
  const rig = by('rig'), isle = by('isle'), wreck = by('wreck'), hut = by('hut');
  const N = (s, i) => s && addItem('note', s, {text: NOTES[i]});
  N(rig.pop(), 0); N(rig.pop(), 1); N(rig.pop(), 2); N(hut.pop(), 3);
  const gl = BLD.find(b => b.wreck && b.wreck.ghost); if (gl) { const [x, z] = L2W(gl, -1, -1); addItem('note', {x, y: gl.fy + .1, z}, {text: NOTES[5]}); }
  for (const s of rig) addItem(['scrap', 'crate', 'fuel', 'patch', 'battery', 'flare', 'scrap'][Math.floor(WR() * 7)], s);
  for (const s of hut) addItem('bottle', s);
  for (const s of by('cruise')) addItem(['relic', 'gold', 'chest', 'relic', 'pearl', 'flare', 'battery'][Math.floor(WR() * 7)], s);
  for (const s of by('key')) addItem('key', s); const cz = by('cruise'); if (cz.length) addItem('note', cz[0], {text: NOTES[4]});
  isle.forEach((s, i) => addItem(i % 5 === 0 ? 'bottle' : ['crate', 'fuel', 'flare', 'battery', 'crate', 'patch', 'scrap'][Math.floor(WR() * 7)], s));
  for (const s of wreck) { const near = WRECKS.find(w => Math.hypot(s.x - w.x, s.z - w.z) < 30); addItem(near && near.ghost && WR() < .7 ? 'relic' : ['crate', 'scrap', 'patch', 'crate'][Math.floor(WR() * 4)], s); }
}
function addItem(kind, s, extra = {}) { const m = itemMesh(kind); m.position.set(s.x, s.y + .03, s.z); m.rotation.y = WR() * TAU; const it = Object.assign({kind, mesh: m, x: s.x, y: s.y, z: s.z, taken: false, i: ITEMS.length}, extra); ITEMS.push(it); return it; }
function hideTaken(h) { for (const p of PL.values()) if (p.hd === h.i && p !== P) return true; return false; }
const FLM = [];
function spawnFloat(i) {
  for (let k = 0; k < 30; k++) { const a = CR() * TAU, r = 120 + Math.pow(CR(), 1.3) * 2300, x = Math.sin(a) * r, z = -60 + Math.cos(a) * r; if (OBST.some(o => o.c && Math.hypot(x - o.x, z - o.z) < o.r + 12) || nearRig(x, z) || inCruise(x, z)) continue; const roll = CR(); G.floats[i] = [x, z, roll < .5 ? 0 : roll < .72 ? 1 : roll < .87 ? 2 : roll < .93 ? 3 : 7]; return; }
}
function floatMesh(i) { const f = G.floats[i]; const kind = f ? KINDS[f[2]] : null; if (FLM[i] && FLM[i].kind === kind) return FLM[i]; if (FLM[i]) scene.remove(FLM[i].m); if (!kind) { FLM[i] = null; return null; } FLM[i] = {kind, m: itemMesh(kind)}; return FLM[i]; }

// ---------------- audio
const A = {ctx: null, on: false};
function aInit() {
  if (A.ctx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const c = A.ctx = new C(); A.out = c.createGain(); A.out.gain.value = .9; const comp = c.createDynamicsCompressor(); A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 20000; A.out.connect(A.lp); A.lp.connect(comp); comp.connect(c.destination);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
  const loop = (f, q, g0, type = 'bandpass') => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl); fl.connect(g); s.start(); return {s, f: fl, g}; };
  const pan = (ref, roll) => { const p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 400}); p.connect(A.out); return p; };
  A.rain = loop(3500, .3, .05, 'highpass'); A.rain.g.connect(A.out);
  A.wind = loop(420, .6, .06); A.wind.g.connect(A.out);
  A.surf = loop(300, .5, .08, 'lowpass'); A.surf.g.connect(A.out);
  A.mPan = pan(2.5, 1.4); A.mBreath = loop(260, 3, 0); A.mBreath.g.connect(A.mPan);
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 46; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 220; const sg = c.createGain(); sg.gain.value = 0; saw.connect(sf); sf.connect(sg); sg.connect(A.mPan); saw.start(); A.mGrowl = sg; A.mSaw = saw;
  const dg = c.createGain(); dg.gain.value = 0; dg.connect(A.out); A.drone = dg; const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 300; df.connect(dg); A.droneF = df;
  { const pg = c.createGain(); pg.gain.value = 0; pg.connect(A.out); A.pad = pg; const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 380; pf.connect(pg); A.padF = pf;
    for (const [f, ty] of [[36.7, 'sawtooth'], [55, 'triangle'], [77.8, 'sine'], [110.2, 'triangle'], [116.5, 'sine']]) { const x = c.createOscillator(); x.type = ty; x.frequency.value = f; x.detune.value = (Math.random() - .5) * 14; x.connect(pf); x.start(); } }
  for (const f of [55, 58.3, 82.4, 110.6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.connect(df); x.start(); }
  A.bPan = pan(5, 1); const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 40; const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300; const eg = c.createGain(); eg.gain.value = .12; eng.connect(ef); ef.connect(eg); eg.connect(A.bPan); eng.start(); A.eng = eng; A.engG = eg; A.engF = ef;
  A.gPan = pan(4, 1.2); const gen = c.createOscillator(); gen.type = 'sawtooth'; gen.frequency.value = 50; const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180; const gg = c.createGain(); gg.gain.value = 0; gen.connect(gf); gf.connect(gg); gg.connect(A.gPan); gen.start(); A.genG = gg;
  A.aPan = pan(10, .8); const al = c.createOscillator(); al.type = 'square'; al.frequency.value = 600; const ag = c.createGain(); ag.gain.value = 0; al.connect(ag); ag.connect(A.aPan); al.start(); A.alarm = al; A.alarmG = ag;
  A.deepG = c.createGain(); A.deepG.gain.value = 0; A.deepG.connect(A.out); const dO = c.createOscillator(); dO.type = 'sine'; dO.frequency.value = 31; dO.connect(A.deepG); dO.start();
  A.on = true;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1) { if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); env(g, t, .005, peak, dec); s.connect(fl); fl.connect(g); g.connect(dest || A.out); s.start(t, Math.random()); s.stop(t + dec + .1); }
function tone(f, peak, dec, type = 'sine', dest, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
function at(x, y, z, ref = 3) { if (!A.on) return null; const p = A.ctx.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.1}); setPan(p, x, y, z); p.connect(A.out); setTimeout(() => p.disconnect(), 5000); return p; }
function setPan(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
const Snd = {
  step(kind, k) { if (kind === 'wet') burst(700, .5, .1 * k, .25, 'bandpass', null, .7); else if (kind === 'metal') { burst(2200, 4, .05 * k, .08); tone(320 + Math.random() * 60, .02 * k, .08, 'triangle'); } else if (kind === 'sand') burst(500, .6, .06 * k, .12, 'lowpass'); else burst(600, 1.2, .06 * k, .09); },
  rStep(x, y, z, k) { const p = at(x, y, z, 2); if (p) burst(1800, 3, .05 * k, .08, 'bandpass', p); },
  mStep(k) { burst(160, 1, .35 * k, .16, 'lowpass', A.mPan); tone(140, .05 * k, .2, 'triangle', A.mPan); },
  heart(k) { tone(58, .25 * k, .12); setTimeout(() => tone(52, .18 * k, .14), 170); },
  pickup() { tone(660, .05, .25); setTimeout(() => tone(990, .04, .3), 90); },
  coin() { tone(1320, .05, .15, 'triangle'); setTimeout(() => tone(1760, .05, .3, 'triangle'), 80); },
  discover() { tone(392, .06, 1.2, 'triangle'); setTimeout(() => tone(523, .05, 1.2, 'triangle'), 180); setTimeout(() => tone(659, .05, 1.6, 'triangle'), 360); },
  click() { burst(3000, 3, .05, .02); },
  stinger() { for (const f of [233, 247, 311, 466]) tone(f, .06, 1.6, 'sawtooth'); burst(3000, .4, .25, 1.4, 'highpass'); },
  scream(dest) { for (const f of [520, 560, 790]) tone(f, .22, 1.2, 'sawtooth', dest, f * .4); burst(1800, .5, .9, 1.4, 'bandpass', dest); },
  creak() { tone(90, .06, .7, 'sawtooth', A.mPan, 60); burst(700, 6, .1, .6, 'bandpass', A.mPan, .4); },
  metal(p) { tone(180 + Math.random() * 300, .05, 2.5, 'triangle', p, 120); burst(500, 8, .04, 2, 'bandpass', p, .3); },
  gasp() { burst(1300, 1.5, .25, .45); },
  flare(p) { burst(2500, .5, .3, 1.2, 'highpass', p); },
  valve(p) { tone(1200 + Math.random() * 400, .03, .4, 'sawtooth', p, 900); },
  dig() { burst(400, .8, .12, .25, 'lowpass', null, .6); },
  thunder(k) { burst(90, .5, .9 * k, 3.5, 'lowpass', null, .5); burst(300, .5, .4 * k, 1.5, 'lowpass', null, .7); },
  splash(p) { burst(900, .5, .5, .8, 'bandpass', p, .6); },
  ram() { burst(70, 1, 1, 1.5, 'lowpass', null, .4); tone(45, .6, 1.2, 'sine'); burst(1500, .5, .25, 1, 'bandpass', null, .6); },
  deep() { tone(32, .5, 3, 'sawtooth', null, 24); burst(200, 1, .3, 2.5, 'lowpass', null, .3); },
  whale(p) { tone(180, .12, 2.5, 'sine', p, 90); setTimeout(() => tone(240, .08, 2, 'sine', p, 140), 900); },
  bubbles() { for (let i = 0; i < 6; i++) setTimeout(() => tone(500 + Math.random() * 500, .05, .08, 'sine', null, 1200), i * 90); },
  whistle(p) { tone(2600, .12, .5, 'sine', p, 2900); setTimeout(() => tone(2900, .1, .6, 'sine', p, 2400), 380); },
  horn(p) { tone(110, .25, 2.2, 'sawtooth', p); tone(112, .2, 2.2, 'sawtooth', p); },
  hurt(p) { burst(500, 1, .5, .5, 'lowpass', p); tone(160, .2, .5, 'sawtooth', p, 70); },
  revive() { tone(440, .06, .3); setTimeout(() => tone(660, .06, .4), 140); },
  power() { tone(60, .3, 3, 'sawtooth', null, 120); burst(400, .5, .5, 1.5, 'lowpass'); },
  gun(w, p) { if (w === 'g') { burst(2600, .7, .55, .12, 'bandpass', p); burst(180, .6, .7, .3, 'lowpass', p); } else { burst(1400, .5, .8, .25, 'bandpass', p); burst(90, .6, 1, .6, 'lowpass', p); setTimeout(() => { burst(900, 3, .12, .08, 'bandpass', p); setTimeout(() => burst(700, 3, .12, .08, 'bandpass', p), 140); }, 300); } },
  reload() { burst(1800, 4, .08, .05); setTimeout(() => burst(1200, 4, .1, .06), 250); },
  cast() { burst(1400, .5, .12, .4, 'highpass', null, 1.6); },
  bite() { burst(900, 1, .35, .3, 'bandpass', null, .7); tone(220, .08, .2, 'sine', null, 120); },
  hook() { tone(330, .08, .15, 'square'); },
  tick() { burst(4000, 6, .03, .02); },
  snap() { tone(900, .12, .3, 'sawtooth', null, 200); },
  sStep(p, k) { burst(120, 1, .5 * k, .25, 'lowpass', p); tone(70, .12 * k, .3, 'triangle', p); setTimeout(() => burst(900, 3, .06 * k, .08, 'bandpass', p), 120); },
  fwUp(p) { burst(2400, 2, .25, 1.4, 'bandpass', p, 1.6); tone(1200, .04, 1.3, 'sine', p, 2600); },
  fwBoom(p) { burst(90, .6, 1, 2.2, 'lowpass', p, .5); burst(600, .5, .5, 1, 'lowpass', p, .6); for (let i = 0; i < 14; i++) setTimeout(() => burst(3500 + Math.random() * 2000, 6, .12, .05, 'bandpass', p), 500 + Math.random() * 900); },
  inhale(k) { burst(900, .8, .05 * k, .9, 'bandpass', null, .8); },
  exhale(k) { burst(500, .6, .07 * k, 1.1, 'bandpass', null, .6); for (let i = 0; i < 8; i++) setTimeout(() => tone(400 + Math.random() * 600, .02 * k, .06, 'sine', null, 1100), 300 + i * 70); },
  roar(p, k = 1) { tone(62, .55 * k, 2.6, 'sawtooth', p, 38); tone(93, .35 * k, 2.2, 'sawtooth', p, 50); tone(140, .15 * k, 1.8, 'square', p, 70); burst(380, .6, .8 * k, 2.4, 'bandpass', p, .45); burst(1600, .5, .25 * k, 1.6, 'bandpass', p, .6); },
  click(p) { const n = 5 + (Math.random() * 6 | 0), g = 40 + Math.random() * 50; for (let i = 0; i < n; i++) setTimeout(() => burst(2600 + Math.random() * 900, 9, .16, .012, 'bandpass', p), i * g); },
  shriek(p) { tone(780, .25, .6, 'sawtooth', p, 1500); tone(1180, .12, .5, 'sawtooth', p, 2100); burst(3000, .6, .5, .7, 'bandpass', p, 1.4); },
};
function showMsg(txt, who, dur = 4) { $('msg').innerHTML = (who ? `<b>${who}</b>` : '') + txt; $('msg').style.opacity = 1; G.msgT = dur; }
function toast(t, sub) { const e = $('toast'); e.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); e.style.opacity = 1; clearTimeout(G.toastT); G.toastT = setTimeout(() => e.style.opacity = 0, 3500); }
const GOALS = ['Find every place on the sea', "Recover Station Nine's black box", 'Dig up a buried treasure chest', 'Earn $1500 from salvage', 'Fully upgrade the engine', 'Land a giant squid', 'Put down the thing on the rig', 'Start the engines of the MS Serenade', 'Dive deeper than 100 m'];
function hint() {
  if (!P) return '';
  if (G.disc.length <= 1) return 'Take the wheel (E at the front of the wheelhouse) and explore. Haul floating cargo aboard and stow it in the hold.';
  if (B.hull < 30) return 'The hull is badly damaged. Patch it with a kit or limp home to the lighthouse.';
  if (holdValue() >= 150) return `The hold is worth $${holdValue()}. Sell it at the harbour shed by the lighthouse.`;
  const nxt = GOALS.findIndex((g, i) => !G.goals.includes(i)); return nxt >= 0 ? 'Goal: ' + GOALS[nxt] + '. Tab for the chart.' : 'Every goal done. The sea is yours.';
}

// ---------------- rig creature senses + brain (host)
function eyeDir(p) { return [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)]; }
function beamHits(p, x, y, z) { const ey = p.y + 1.55, dx = x - p.x, dy = y - ey, dz = z - p.z, d = Math.hypot(dx, dy, dz), f = eyeDir(p); return (dx * f[0] + dy * f[1] + dz * f[2]) / d > Math.cos(.4); }
function seesP(p) {
  if (p.hd >= 0 || !p.ready || p.down || p.dead || p.sw || !nearRig(p.x, p.z)) return 0;
  const dx = p.x - M.x, dz = p.z - M.z, d = Math.hypot(dx, dz);
  let range = D.sight * (p.l ? 1 : .42) * (p.cr ? .65 : 1) * (p.spd < .3 ? .75 : 1);
  if (G.power) range = Math.max(range, D.sight * .85);
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
  if (isHost() && inCruise(x, z, y)) stwHear(x, y, z, r);
  if (!isHost() || !nearRig(x, z)) return;
  r *= D.hear; const d = Math.hypot(x - M.x, z - M.z) + Math.abs(y - M.y) * 1.5;
  if (d > r || M.state === 'chase' || M.state === 'flee' || M.state === 'dead' || M.state === 'gone') return;
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
function pickRoam() { const prey = PL.get(M.prey); const q = prey && onRig(prey) && !prey.down ? randNode(prey, D.roam * (M.avoidT > 0 ? 2 : 1)) : randNode(null); if (q) { if (M.avoidT > 0 && alive().some(p => Math.hypot(p.x - q[0], p.z - q[2]) < 14)) return; goTo(q[0], q[1], q[2]); } }
function downPlayer(p, how) {
  if (p.down || p.dead) return; p.down = true; p.bleed = D.bleed; p.hd = -1; p.seat = 0; if (B.driver === p.id) B.driver = null; dropCarry(p);
  M.yaw = Math.atan2(-(p.x - M.x), -(p.z - M.z)); emit({k: 'down', id: p.id, how}); M.state = 'flee'; M.flee = D.down; M.tgt = null; M.sawHide = -1; M.aware = 0;
  const q = randNode(null); if (q) goTo(q[0], q[1], q[2]);
}
function stepSunk(dt) {
  if (!HC().sub || (B.dep || 0) < 3) return;
  for (let i = 0; i < SUNK.length; i++) { const q = SUNK[i]; if (q.got || Math.hypot(q.x - B.x, q.z - B.z) > 9 || B.hold.length >= holdMax()) continue; q.got = true; B.hold.push(q.kind); emit({k: 'sunk', i, kind: q.kind}); }
}
function stepCreature(dt) {
  if (M.state === 'dead') { M.spd = 0; M.deadT -= dt; if (M.deadT <= 0) { M.state = 'gone'; M.goneT = 120; M.x = 0; M.z = 900; M.y = -50; } return; }
  if (M.state === 'gone') { M.goneT -= dt; if (M.goneT <= 0) { const n = randNode(null); if (n) { M.x = n[0]; M.y = n[1]; M.z = n[2]; } M.hp = D.mhp; M.state = 'roam'; M.path = []; M.idle = 4; } return; }
  const f = floorAt(M.x, M.z, M.y);
  if (f && M.y - f.y < .8) { M.y = mix(M.y, f.y, Math.min(1, dt * 12)); M.vy = 0; } else { M.vy -= 20 * dt; M.y += M.vy * dt; if (f && M.y < f.y) { M.y = f.y; M.vy = 0; } }
  if (M.y < -.5 || !nearRig(M.x, M.z)) { M.wet += dt; M.spd = 0; if (M.wet > 3) { M.wet = 0; const n = randNode(null); if (n) { M.x = n[0]; M.y = n[1]; M.z = n[2]; M.vy = 0; M.path = []; M.state = 'roam'; } } return; }
  M.avoidT = (M.avoidT || 0) - dt;
  const ps = alive().filter(p => nearRig(p.x, p.z) && !p.sw);
  if (!ps.length) { if (M.state === 'chase' || M.state === 'search') M.state = 'roam'; if (!M.path.length && (M.idle -= dt) <= 0) { const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); M.idle = 3 + CR() * 6; } moveAlong(dt, 1.4); return; }
  let tgt = M.tgt && PL.get(M.tgt); if (tgt && (tgt.down || tgt.dead || tgt.sw || !nearRig(tgt.x, tgt.z))) { tgt = null; M.tgt = null; }
  const dOf = p => Math.hypot(p.x - M.x, p.z - M.z) + Math.abs(p.y - M.y);
  M.preyT -= dt; if (M.preyT <= 0) { M.preyT = 20; let best = null, bv = -1; for (const p of ps) { let m = 1e9; for (const q of ps) if (q !== p) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(p.y - q.y)); if (ps.length === 1) m = 0; const v = m + p.heat * 20 + CR() * 8; if (v > bv) { bv = v; best = p; } } M.prey = best ? best.id : null; }
  for (const p of PL.values()) p.heat = Math.max(0, p.heat - dt * .05);
  for (const hp of PL.values()) if (hp.eq === 5 && !hp.down && !hp.dead && Math.hypot(hp.x - M.x, hp.z - M.z) < 6.5 && Math.abs(hp.y - M.y) < 3 && M.state !== 'flee') { M.state = 'flee'; M.flee = 4; M.tgt = null; const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); emit({k: 'snd', s: 'lunge'}); break; }
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
  let speed = 1.7; const prog = G.power ? .08 : 0;
  switch (M.state) {
    case 'roam': { if (!M.path.length) { M.idle -= dt; M.look = Math.sin(G.t * 1.3) * .3; if (M.idle <= 0) { pickRoam(); M.idle = 1.5 + CR() * 4; } } speed = (M.avoidT > 0 ? 2.6 : 1.7) + prog * 4; break; }
    case 'inv': { speed = 3.1 + prog * 5; if (moveAlong(dt, speed)) { if (M.invZone >= 0 && BLD[M.invZone].hides.length) { startSearch(M.invZone); break; } M.idle += dt; M.look = Math.sin(G.t * 2) * .5; if (M.idle > 3.5) { M.state = 'roam'; M.idle = 1; M.avoidT = 10; } } return finish(dt); }
    case 'chase': {
      speed = D.chase * (1 + prog) * (1 + .08 * TOD.night);
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
  if (M.state === 'chase' && tgt) { M.lcd = (M.lcd || 0) - dt; const dd = Math.hypot(tgt.x - M.x, tgt.z - M.z);
    if (M.lunge > 0) { M.lunge -= dt; speed *= 2; M.spd = Math.max(M.spd, speed); }
    else if (M.lcd <= 0 && dd < 6 && dd > 1.8 && Math.abs(tgt.y - M.y) < 1 && clearLine(M.x, M.z, tgt.x, tgt.z, M.y + 1)) { M.lunge = .6; M.lcd = 5; M.path = [[tgt.x, tgt.z]]; emit({k: 'snd', s: 'lunge'}); } }
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
    case 'tod': { const L = {1: ['The sun is going down. Make the most of the light.', 'SUNSET'], 2: ['Night is coming. Something stirs under the water.', 'DUSK'], 3: ['Full dark. Stay close to land and keep a flare handy.', 'NIGHT'], 4: ['First light. Whatever was out there is sinking back down.', 'DAWN']}[e.p]; if (L) { showMsg(L[0], L[1], 6); if (e.p >= 2 && e.p < 4) Snd.deep(); } break; }
    case 'snd': if (e.s === 'stinger') Snd.stinger(); else if (e.s === 'creak') Snd.creak(); else if (e.s === 'lunge') Snd.shriek(A.mPan); else if (e.s === 'stwSee') { if (inCruise(cam.position.x, cam.position.z, cam.position.y)) { Snd.stinger(); Snd.shriek(at(STS.x, STS.y + 2.6, STS.z, 6)); } } else if (e.s === 'shriekS') Snd.shriek(at(STS.x, STS.y + 2.6, STS.z, 6)); else if (e.s[0] === 'g' && e.s[1] === 'u') { if (G.uw > .3 && Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < 80) { if (e.s === 'gulL') Snd.roar(at(e.x, e.y, e.z, 8), .35); else Snd.whale(at(e.x, e.y, e.z, 10)); } } break;
    case 'mstep': { const d = Math.hypot(cam.position.x - M.x, cam.position.z - M.z) + Math.abs(cam.position.y - M.y); if (d < 40) Snd.mStep(clamp(1.2 - d / 40, .1, 1) * (M.state === 'chase' ? 1.5 : 1)); break; }
    case 'down': { const p = PL.get(e.id); if (p) { p.down = true; p.hd = -1; p.seat = 0; }
      if (e.id === me) { const jsc = e.how === 'caught' || e.how === 'pulled'; if (jsc) { G.js = {t: 1.4, L: 1.4, mon: e.st ? STW : MON, J: e.st ? SJ : MJ}; G.shake = 1.5; } Snd.scream(); $('flash').style.opacity = jsc ? .3 : .7; setTimeout(() => $('flash').style.opacity = 0, 300); P.hd = -1; P.seat = 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); showMsg('It got you. Crawl toward your crew, they can pick you up.', '', 5); }
      else if (p) { Snd.hurt(at(p.x, p.y + 1, p.z, 6)); showMsg(`${p.name} is down! Hold E on them to pick them up.`, '', 5); } break; }
    case 'rev': { const p = PL.get(e.id); if (p) p.down = false; Snd.revive(); showMsg(e.id === me ? 'You are back on your feet.' : `${p ? p.name : ''} is back up.`); break; }
    case 'dead': { const p = PL.get(e.id); if (p) { p.dead = true; p.down = false; p.drowned = !!e.drown; p.sw = 0; } if (e.drown) Snd.deep(); if (e.id === me) { if (e.drown === 2) showMsg('Your air runs out. The dark closes in.', '', 5); if (e.drown === 1) { if (!G.maw) G.maw = {t: 3, x: P.x, z: P.z}; G.maw.bite = G.maw.t + .9; G.drownCam = {t: 0, x: P.x, z: P.z, yaw: P.yaw}; } P.dead = true; P.sw = 0; P.seat = 0; P.drowned = !!e.drown; showMsg(e.drown ? 'Something huge wraps around your legs and pulls you under.' : 'You bled out.', '', 5); } else showMsg(`${p ? p.name : 'Someone'} ${e.drown ? 'was pulled under' : 'bled out'}. They will wash up at the lighthouse.`, '', 5); break; }
    case 'resp': { const p = PL.get(e.id); if (p) { p.dead = false; p.down = false; p.drowned = false; } if (e.id === me) { Object.assign(P, {dead: false, down: false, sw: 0, ob: 0, seat: 0, x: e.x, y: 2, z: e.z, vy: 0, hd: -1, bat: Math.max(P.bat, .6), drowned: false}); showMsg('You wash up at the lighthouse, coughing seawater.', '', 4); } break; }
    case 'deepw': if (e.id === me) { G.maw = {t: 0, x: P.x, z: P.z}; Snd.bubbles(); showMsg('Something is circling beneath you. GET OUT OF THE WATER.', '', 3); } break;
    case 'give': if (e.id === me) { if (e.kind === 'battery') { P.bat = Math.min(1, P.bat + .5); showMsg('Fresh batteries.'); } if (e.kind === 'flare') { P.flares += e.n || 1; showMsg(`Picked up ${e.n > 1 ? e.n + ' flares' : 'a flare'}. Throw them with G.`); } Snd.pickup(); } break;
    case 'sack': { const p = PL.get(e.id), q = e.s.map(i => KINDS[i]); if (p) { const more = q.length > (p.sack || []).length; p.sack = q; p.carry = q[q.length - 1] || null;
      if (e.id === me) { P.sack = q; P.carry = p.carry; if (more) { const k = q[q.length - 1]; Snd.pickup(); showMsg(`+ ${NAMES[k]}${VALUE[k] ? ' · $' + VALUE[k] : ''}`, '', 1.6); } } } break; }
    case 'item': if (!isHost() && !ITEMS[e.i]) addItem(e.kind, {x: e.x, y: e.y, z: e.z}); break;
    case 'stow': Snd.coin(); if (e.id === me) showMsg(`Stowed. The hold is worth $${e.v}.`); break;
    case 'sold': Snd.coin(); showMsg(`Sold salvage for $${e.v}.`, 'HARBOUR SHED', 3); break;
    case 'bought': Snd.coin(); showMsg(`${e.n} upgraded.`, 'HARBOUR SHED', 3); break;
    case 'boatuse': Snd.pickup(); showMsg(e.what === 'fuel' ? 'Fuel poured into the tank.' : 'Hull patched.'); break;
    case 'bottle': { Snd.pickup(); const d = DIGS[e.i]; if (d) { d.rev = true; showMsg(`A map in a bottle! An X is marked on ${d.isle}. It is on your compass now.`, '', 6); } else showMsg('A bottle with a note inside: "Whoever reads this: the shallows are safe."'); break; }
    case 'dug': { const d = DIGS[e.i]; d.dug = true; Snd.dig(); showMsg('Treasure! A chest was buried here.', '', 4); break; }
    case 'valve': { const v = VALVES[e.i]; v.open = true; Snd.valve(at(v.x, v.y + 1, v.z, 8)); showMsg(`The ${v.name} is open (${VALVES.filter(q => q.open).length} of 2).`); break; }
    case 'power': G.power = true; Snd.power(); MAT.bulb.emissiveIntensity = 2.5; MAT.screen.emissiveIntensity = 1; showMsg('The generator coughs and catches. Floodlights flare across the rig. An alarm starts wailing.', '', 6); G.alarmT = 22; break;
    case 'bb': showMsg('The flight recorder ejects with a clunk. A black box, worth a fortune to the right people.', '', 5); break;
    case 'disc': if (!G.disc.includes(e.i)) G.disc.push(e.i); Snd.discover(); toast(POIS[e.i].n, 'Discovered'); break;
    case 'goal': if (!G.goals.includes(e.i)) G.goals.push(e.i); Snd.discover(); toast('Goal complete', GOALS[e.i]); break;
    case 'helm': { const p = PL.get(e.id); for (const q of PL.values()) q.seat = 0; if (p) p.seat = e.on ? 1 : 0; if (e.id === me) P.seat = e.on ? 1 : 0; B.driver = e.on ? e.id : null; break; }
    case 'bump': G.shake = Math.max(G.shake || 0, e.s); burst(120, 1, .6 * e.s, .6, 'lowpass'); break;
    case 'circle': Snd.deep(); showMsg('Something huge is circling the boat. Shoot it when it rears up, or throw a flare into the water!', '', 5); if (LEV.on && !G.maw) LEV.hide(); G.spines = {t: 0, a: e.a, L: e.L || 9, circle: 1}; break;
    case 'deepgone': showMsg(e.dead ? 'It shrieks and sinks, trailing black blood. Something glints where it went down.' : 'The shape sinks away from the red light.', '', 4); if (e.dead) { Snd.roar(at(LEV.hp.x, 0, LEV.hp.z, 25)); spray(LEV.hp.x, .2, LEV.hp.z, 40, 6); } if (G.spines) { G.spines.leave = G.spines.t; G.spines.circle = 0; } break;
    case 'ram': G.shake = 1.4; Snd.ram(); showMsg(['It slams into the hull!', 'The boat lurches. It is under us.', 'Wood splinters below the waterline!'][Math.floor(Math.random() * 3)], '', 2.5);
      if (P && P.ob && !P.seat && Math.random() < .3) { const [lx, lz] = P.bl; const s = lx >= 0 ? 1 : -1; P.ob = 0; const [wx, wz] = bL2W(lx + s * 3, lz); P.x = wx; P.z = wz; P.vy = 3; showMsg('You are thrown overboard!', '', 3); } break;
    case 'sink': G.shake = 2; Snd.ram(); Snd.deep(); showMsg('The boat is going down! Abandon ship!', '', 5); if (P && P.ob) { P.ob = 0; P.seat = 0; P.y = .1; } break;
    case 'boatback': showMsg('A tug drags your boat back to the lighthouse. The cargo is lost.', '', 5); if (P && !P.dead && (P.sw || P.y < 1) && Math.hypot(P.x - e.x, P.z - e.z) < 80) { P.sw = 0; P.ob = 1; P.bl = [0, BSPOT.hold[1] + (BG.sub ? -1.6 : 1.6)]; P.y = BDECK.y; } break;
    case 'storm': if (e.on) showMsg('The wind picks up. A storm is rolling in.', '', 4); else showMsg('The storm passes. The moon comes out.', '', 4); break;
    case 'fl': if (e.id !== me) spawnFlare(e); break;
    case 'gear': if (e.id === me) gotGear(e.g); else Snd.coin(); break;
    case 'cooler': if (e.id === me) { P.coolerN = e.n; P.coolerV = e.v; } break;
    case 'catch': { const p = PL.get(e.id); if (e.id !== me && p) showMsg(`${p.name} landed a ${FISH[e.f].n} (${e.kg} kg)!`, '', 3); break; }
    case 'shot': if (e.id !== me) gunFx([e.x, e.y, e.z], e.w, false); break;
    case 'mhit': hitFx(e.x, e.y, e.z, e.head); break;
    case 'mdown': Snd.scream(A.mPan); showMsg('The thing shrieks and collapses on the deck. Then it drags itself over the edge into the sea.', '', 5); break;
    case 'sunk': { const q = SUNK[e.i]; if (q) q.got = true; Snd.pickup(); Snd.discover(); showMsg(`The claw grabs a sunken ${NAMES[e.kind]} off the sea bed! It goes in the hold ($${VALUE[e.kind]}).`, '', 4); break; }
    case 'holdfull': if (e.id === myId()) showMsg(`The hold is full (${holdMax()}). Sell at the jetty or buy hold racks / a bigger hull.`, '', 3); break;
    case 'fw': spawnRocket(e); break;
    case 'sunkp': { const q = SUNK[e.i]; if (q) q.got = true; break; }
    case 'bite': { const p = PL.get(e.id); if (e.id === me) { P.air = Math.max(0, (P.air ?? 1) - .45); G.shake = 1.6; $('flash').style.opacity = .6; setTimeout(() => $('flash').style.opacity = 0, 250); Snd.scream(); Snd.bubbles(); showMsg('Something tore at you in the dark. Your air hose is leaking. Get up, or burn a flare (6).', '', 4); } else if (p) Snd.hurt(at(p.rx, p.ry, p.rz, 8)); break; }
    case 'claim': Snd.horn(at(CRZ.x, 20, CRZ.z, 200)); Snd.power(); showMsg('Deep in the hull the engines cough and turn over. The MS Serenade is yours: switch to her at the harbour shed. The Steward is still aboard.', 'SERENADE', 8); G.cruise = 1; break;
    case 'sstep': { const d = Math.hypot(cam.position.x - STS.x, cam.position.z - STS.z) + Math.abs(cam.position.y - STS.y); if (d < 45) Snd.sStep(at(STS.x, STS.y, STS.z, 4), clamp(1.3 - d / 45, .1, 1)); break; }
    case 'shit': hitFx(e.x, e.y, e.z, e.head); if (Math.random() < .5) Snd.shriek(at(STS.x, STS.y + 2.5, STS.z, 6)); break;
    case 'sdown': Snd.scream(at(STS.x, STS.y + 2, STS.z, 10)); showMsg('The Steward folds over, then crawls away into the dark below decks. It will be back.', '', 5); break;
    case 'dhit': Snd.splash(at(e.x, 0, e.z, 20)); burst(80, 1, .4, 1, 'lowpass'); hitFx(e.x, (e.y || 0) + 1, e.z, e.h); if (e.h) Snd.roar(at(e.x, e.y || 0, e.z, 25), .5); break;
    case 'wh': { const p = PL.get(e.id); if (p) { p.pingT = 6; Snd.whistle(at(p.x, p.y + 1.6, p.z, 8)); } break; }
  }
}

// ---------------- host simulation
function dropCarry(p, all = true) { if (!p.sack || !p.sack.length) return; const L = all ? p.sack.splice(0) : [p.sack.pop()]; sackSet(p); L.forEach((k, i) => dropOne(p, k, i)); }
function dropOne(p, k, i) {
  p = {x: p.x + (i % 3 - 1) * .5, y: p.y, z: p.z + Math.floor(i / 3) * .5};
  const f = floorAt(p.x, p.z, p.y + .5);
  if (f && f.y > -.5 && f.s.k !== 'boat') { const it = addItem(k, {x: p.x, y: f.y, z: p.z}); emit({k: 'item', i: it.i, kind: k, x: p.x, y: f.y, z: p.z}); }
  else if (f && f.s.k === 'boat' && VALUE[k] && B.hold.length < holdMax()) B.hold.push(k);
  else { let i = G.floats.findIndex(q => !q); if (i < 0) i = G.floats.length; G.floats[i] = [p.x, p.z, KINDS.indexOf(k)]; }
}
function hostStep(dt) {
  G.t += dt;
  boatStep(dt);
  for (const p of PL.values()) {
    if (!p.ready) continue;
    if (p.ob && p !== P) { const [wx, wz] = bL2W(p.bl[0], p.bl[1]); p.x = wx; p.z = wz; }
    const mv = Math.hypot(p.x - p.lx, p.z - p.lz); p.lx = p.x; p.lz = p.z; p.spd = mix(p.spd, mv / Math.max(dt, 1e-3), Math.min(1, dt * 5));
    if (p !== P && !p.down && mv < 3 && !p.ob) { p.sd += mv; if (p.sd > (p.run ? 1 : .75)) { p.sd = 0; noise(p.x, p.y, p.z, p.run ? 22 : p.cr ? 2 : 8); if (p.run) p.heat += .02; } }
    if (p.l) p.heat = Math.min(1, p.heat + dt * .004);
    if (p.down && !p.dead) { p.bleed -= dt; if (p.bleed <= 0) { p.down = false; p.dead = true; p.deadT = 0; emit({k: 'dead', id: p.id}); } }
    if (p.dead) { p.deadT = (p.deadT || 0) + dt; if (p.deadT > 12) { p.deadT = 0; p.dead = false; p.x = -4 + CR() * 4; p.z = -262; p.y = 2; p.sw = 0; p.ob = 0; emit({k: 'resp', id: p.id, x: p.x, z: p.z}); } }
    if (p.sw && p.deep && !p.dead && !(p.su && (p.dv || 0) > 1.5)) { p.swT += dt; if (p.swT > D.drown - 4 && !p.warned) { p.warned = true; emit({k: 'deepw', id: p.id}); } if (p.swT > D.drown) { p.dead = true; p.deadT = 0; p.swT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 1}); } } else { p.swT = Math.max(0, p.swT - dt * 2); p.warned = false; }
  }
  // holds: valves, generator, console, digging, reviving
  const hold = {};
  for (const p of PL.values()) {
    if (!p.ready || !p.h || p.down || p.dead || p.sw) continue;
    const k = p.h, near = (x, y, z, r) => Math.hypot(p.x - x, p.z - z) < r && Math.abs(p.y - y) < 2;
    let ok = false;
    if (k[0] === 'v') { const v = VALVES[+k[1]]; ok = v && !v.open && near(v.x, v.y, v.z, 3); }
    else if (k === 'g') { const b = BLD.find(q => q.kind === 'gen'); ok = !G.power && VALVES.every(v => v.open) && near(b.genP[0], b.fy, b.genP[2], 3.2); }
    else if (k === 'cz') { const b = CRZ.bridge; ok = !G.cruise && p.sack.includes('key') && near(b.console[0], b.fy, b.console[2], 3); if (ok && STS.state !== 'chase' && STS.state !== 'dead' && STS.state !== 'gone') { STS.state = 'inv'; stwGo(p.x, p.y, p.z); } }
    else if (k === 'c') { const b = BLD.find(q => q.kind === 'ctrl'); ok = G.power && !G.bbOut && near(b.console[0], b.fy, b.console[2], 3); }
    else if (k[0] === 'd') { const d = DIGS[+k[1]]; ok = d && !d.dug && near(d.x, d.y, d.z, 2.6); }
    else if (k[0] === 'r') { const q = PL.get(k.slice(1)); ok = q && q.down && near(q.x, q.y, q.z, 2.6); }
    if (ok) (hold[k] = hold[k] || []).push(p);
  }
  for (const k in G.holdP) if (!hold[k]) { G.holdP[k] -= dt * (k[0] === 'r' ? .5 : .1); if (G.holdP[k] <= 0) delete G.holdP[k]; }
  const dur = {v: 5, g: 4, c: 6, r: 4, d: 5}; if (hold.cz) G.holdP.cz = (G.holdP.cz || 0) + dt / 12 - dt / 6 * Math.min(2, .6 + .4 * hold.cz.length);
  for (const k in hold) {
    const n = hold[k].length; G.holdP[k] = (G.holdP[k] || 0) + dt / dur[k[0]] * Math.min(2, .6 + .4 * n + (n > 1 ? .2 : 0));
    G.noiseT = (G.noiseT || 0) - dt; if (G.noiseT <= 0) { G.noiseT = 1; const q = hold[k][0]; noise(q.x, q.y, q.z, k[0] === 'r' ? 14 : 24); }
    if (G.holdP[k] >= 1) {
      delete G.holdP[k]; const q = hold[k][0];
      if (k[0] === 'v') emit({k: 'valve', i: +k[1]});
      else if (k === 'g') { emit({k: 'power'}); const b = BLD.find(z => z.kind === 'gen'); noise(b.x, b.fy, b.z, 70); }
      else if (k === 'cz') { G.cruise = 1; q.sack.splice(q.sack.indexOf('key'), 1); sackSet(q); emit({k: 'claim'}); goal(7); save(); }
      else if (k === 'c') { G.bbOut = true; emit({k: 'bb'}); giveCarry(q, 'blackbox'); goal(1); const b = BLD.find(z => z.kind === 'ctrl'); noise(b.x, b.fy, b.z, 50); }
      else if (k[0] === 'd') { emit({k: 'dug', i: +k[1]}); giveCarry(q, 'chest'); goal(2); }
      else { const t = PL.get(k.slice(1)); if (t) { t.down = false; emit({k: 'rev', id: t.id}); } }
    }
  }
  // discovery
  G.discT = (G.discT || 0) - dt; if (G.discT <= 0) { G.discT = .5; POIS.forEach((q, i) => { if (G.disc.includes(i)) return; if (alive().some(p => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 40)) { emit({k: 'disc', i}); save(); if (POIS.every((_, j) => G.disc.includes(j))) goal(0); } }); }
  // floating cargo drifts; keep 16 of them out there
  for (let i = 0; i < 16; i++) { const f = G.floats[i]; if (!f) { if (CR() < dt * .05) spawnFloat(i); continue; } f[0] += Math.sin(G.t * .05 + i) * dt * .25; f[1] += Math.cos(G.t * .04 + i * 2) * dt * .25; }
  // weather
  G.stormT = (G.stormT ?? 200) - dt; if (G.stormT <= 0) { G.stormOn = !G.stormOn; G.stormT = G.stormOn ? 120 + CR() * 80 : 200 + CR() * 120; emit({k: 'storm', on: G.stormOn}); }
  G.storm = mix(G.storm, G.stormOn ? 1 : 0, Math.min(1, dt / 25));
  G.tod = (G.tod + dt / TOD_LEN) % 1; const ph = G.tod < .14 ? 0 : G.tod < .24 ? 1 : G.tod < .34 ? 2 : G.tod < .8 ? 3 : G.tod < .9 ? 4 : 0;
  if (ph !== G.todPh) { if (G.todPh >= 0 && ph) emit({k: 'tod', p: ph}); G.todPh = ph; }
  // the thing in the deep
  const homeD = Math.hypot(B.x - HOME.x, B.z - HOME.z), nearLand = OBST.some(o => o.c && o.r > 5 && Math.hypot(B.x - o.x, B.z - o.z) < o.r + 70) || Math.hypot(B.x, B.z) < 80;
  G.deepT = (G.deepT ?? 40) - dt;
  if (!G.enc && B.sink <= 0 && homeD > 280 && !nearLand && G.deepT <= 0) { G.deepT = 20 + CR() * 25; if (CR() < D.deep + .35 * G.storm + .3 * TOD.night) { const a = CR() * TAU; G.enc = {t: 9, L: 9, a, el: 0, hp: 90}; emit({k: 'circle', a, L: 9}); } }
  if (G.enc) {
    G.enc.t -= dt; G.enc.el = (G.enc.el || 0) + dt;
    if (G.flares.some(f => f.t > 0 && f.sea && Math.hypot(f.x - B.x, f.z - B.z) < 32)) { G.enc = null; G.deepT = 60; emit({k: 'deepgone'}); }
    else if (G.enc.t <= 0 || nearLand) { if (!nearLand) { damageBoat(D.ramDmg / [1, 1.5, 2.2][B.up.hull]); B.v *= .35; B.yaw += (CR() - .5) * .5; emit({k: 'ram'}); if (CR() < .35) { const a = CR() * TAU; G.enc = {t: 8, L: 8, a, el: 0, hp: 70}; emit({k: 'circle', a, L: 8}); } else G.enc = null; } else G.enc = null; }
  }
  if (G.earned >= 1500) goal(3); if (B.up.engine >= 3) goal(4);
  stepSunk(dt); stepCreature(dt); stepSteward(dt); stepGulpers(dt);
  for (const p of PL.values()) if (p.sw && (p.dv || 0) > 100 && !G.goals.includes(8)) goal(8);
}
function goal(i) { if (G.goals.includes(i)) return; emit({k: 'goal', i}); save(); }
function giveCarry(p, kind) { if (!sackFits(p, kind)) { const f = floorAt(p.x, p.z, p.y + .5); const it = addItem(kind, {x: p.x + .6, y: f ? f.y : p.y, z: p.z}); emit({k: 'item', i: it.i, kind, x: p.x + .6, y: f ? f.y : p.y, z: p.z}); return; } p.sack.push(kind); sackSet(p); }
function hostAct(id, m) {
  const p = PL.get(id); if (!p || !G.on) return;
  if (m.px != null && p !== P && !m.ob && Math.hypot(m.px - p.x, m.pz - p.z) < 25) { p.x = m.px; p.z = m.pz; }
  const nearBoat = (pt, r) => { const [x, z] = bL2W(pt[0], pt[1]); return Math.hypot(p.x - x, p.z - z) < r; };
  if (m.a === 'pick') { const it = ITEMS[m.i]; if (!it || it.taken || it.kind === 'note' || Math.hypot(p.x - it.x, p.z - it.z) > 3.5) return;
    if (CARRY.has(it.kind)) { if (!sackFits(p, it.kind)) return; it.taken = true; p.sack.push(it.kind); sackSet(p); }
    else if (it.kind === 'bottle') { it.taken = true; const d = DIGS.findIndex(q => !q.rev); if (d >= 0) DIGS[d].rev = true; emit({k: 'bottle', i: d}); }
    else { it.taken = true; emit({k: 'give', id, kind: it.kind}); } }
  else if (m.a === 'float') { const f = G.floats[m.i]; if (!f || Math.hypot(p.x - f[0], p.z - f[1]) > (B.up.crane ? 14 : 7) + (p.ob ? BG.hw : 0)) return; const kind = KINDS[f[2]];
    if (kind === 'bottle') { G.floats[m.i] = null; const d = DIGS.findIndex(q => !q.rev); if (d >= 0) DIGS[d].rev = true; emit({k: 'bottle', i: d}); }
    else { if (!sackFits(p, kind)) return; G.floats[m.i] = null; p.sack.push(kind); sackSet(p); } }
  else if (m.a === 'stow') { if (nearBoat(BSPOT.hold, 3.2)) { let n = 0; for (let i = 0; i < p.sack.length; i++) { const k = p.sack[i]; if (VALUE[k] && B.hold.length < holdMax()) { B.hold.push(k); p.sack.splice(i--, 1); n++; } } if (n) { sackSet(p); emit({k: 'stow', id, v: holdValue()}); } else if (B.hold.length >= holdMax()) emit({k: 'holdfull', id}); } }
  else if (m.a === 'fuel') { const i = p.sack.indexOf('fuel'); if (i >= 0 && nearBoat(BSPOT.fuel, 3)) { B.fuel = Math.min(tankMax(), B.fuel + 45 * HC().fuel); p.sack.splice(i, 1); sackSet(p); emit({k: 'boatuse', what: 'fuel'}); } }
  else if (m.a === 'patch') { const i = p.sack.indexOf('patch'); if (i >= 0 && nearBoat(BSPOT.patch, 3)) { B.hull = Math.min(hullMax(), B.hull + 35 * HC().hp); p.sack.splice(i, 1); sackSet(p); emit({k: 'boatuse', what: 'patch'}); } }
  else if (m.a === 'drop') dropCarry(p, false);
  else if (m.a === 'fw') emit({k: 'fw', x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, c: m.c});
  else if (m.a === 'buya') { const A = AURAS[m.i]; if (A && G.cash >= (ALL ? 0 : A.cost)) { G.cash -= ALL ? 0 : A.cost; emit({k: 'gear', id, g: 'aura' + m.i}); save(); } }
  else if (m.a === 'buyc') { const L = m.k === 'paint' ? PAINTS : m.k === 'glow' ? GLOWS : null, c = ALL ? 0 : STYLE_COST[m.k]; if (L && L[m.v] && G.cash >= c) { G.cash -= c; B.up[m.k] = m.v; emit({k: 'bought', n: L[m.v].n}); save(); } }
  else if (m.a === 'dpick') { const q = SUNK[m.i]; if (q && !q.got && p.sw && Math.hypot(q.x - p.x, q.z - p.z) < 5 && Math.abs(q.y + (p.dv || 0)) < 5 && sackFits(p, q.kind)) { q.got = true; p.sack.push(q.kind); sackSet(p); emit({k: 'sunkp', i: m.i}); } }
  else if (m.a === 'drown') { if (!p.dead && p.sw) { p.dead = true; p.deadT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 2}); } }
  else if (m.a === 'sell') { let v = 0; if (Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 60 + BG.L * .5) { v += holdValue(); B.hold = []; } { const sv = sackVal(p.sack); if (sv) { v += sv; p.sack = p.sack.filter(k => !VALUE[k]); sackSet(p); } } if (p.cooler.length) { v += p.cooler.reduce((a, k) => a + FISH[k].v, 0); p.cooler = []; emit({k: 'cooler', id, n: 0, v: 0}); } if (v) { G.cash += v; G.earned += v; emit({k: 'sold', v}); if (G.earned >= 1500) goal(3); save(); } }
  else if (m.a === 'buyh') { const H = HULLS[m.k]; if (H && m.k !== (B.up.cls || 0) && G.cash >= hullCost(H) && (!H.cruise || G.cruise) && Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 60 + BG.L * .5 && !B.driver) { G.cash -= hullCost(H); B.up.cls = m.k; buildBoat(); resetBoat(false); B.fuel = tankMax(); B.hull = hullMax(); B.hold = B.hold.slice(0, holdMax()); emit({k: 'bought', n: H.n}); save(); } }
  else if (m.a === 'buy') { const U = UPG[m.k]; if (U) { const lv = B.up[m.k] || 0, c = U.cost[lv]; if (c != null && G.cash >= c) { G.cash -= c; B.up[m.k] = lv + 1; if (m.k === 'tank') B.fuel = tankMax(); if (m.k === 'hull') B.hull = hullMax(); emit({k: 'bought', n: U.n}); if (B.up.engine >= 3) goal(4); save(); } }
    else if (m.k === 'flares' && G.cash >= 30) { G.cash -= 30; emit({k: 'give', id, kind: 'flare', n: 3}); save(); }
    else if (m.k === 'battery' && G.cash >= 20) { G.cash -= 20; emit({k: 'give', id, kind: 'battery'}); save(); } }
  else if (m.a === 'fl') { spawnFlare(Object.assign({}, m, {id})); if (Net.role === 'host') G.evq.push(Object.assign({}, m, {k: 'fl', id})); }
  else if (m.a === 'wh') { emit({k: 'wh', id}); noise(p.x, p.y, p.z, 45); p.heat += .1; }
  else if (m.a === 'helm') { if (!B.driver || B.driver === id || !PL.get(B.driver)) emit({k: 'helm', id, on: 1}); }
  else if (m.a === 'unhelm') { if (B.driver === id) emit({k: 'helm', id, on: 0}); }
  else if (m.a === 'gasp') noise(p.x, p.y, p.z, 9);
  else if (m.a === 'buyg') { const g = GEAR[m.k]; if (g && G.cash >= g.cost) { G.cash -= g.cost; emit({k: 'gear', id, g: m.k}); save(); } }
  else if (m.a === 'fish') { const f = FISH[m.f]; if (!f) return; if (m.f === 'bottle') { const d = DIGS.findIndex(q => !q.rev); if (d >= 0) DIGS[d].rev = true; emit({k: 'bottle', i: d}); return; } p.cooler.push(m.f); emit({k: 'cooler', id, n: p.cooler.length, v: p.cooler.reduce((a, k) => a + FISH[k].v, 0)}); emit({k: 'catch', id, f: m.f, kg: m.kg}); if (m.f === 'squid') goal(5); }
  else if (m.a === 'shoot') hostShoot(p, m);
}
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({t: 'act', px: +P.x.toFixed(2), pz: +P.z.toFixed(2), ob: P.ob}, m)); }

// ---------------- save (host)
function save() { if (!isHost() || TEST) return; try { localStorage.setItem('s9-save2', JSON.stringify({cash: G.cash, earned: G.earned, up: B.up, disc: G.disc, goals: G.goals, cruise: G.cruise || 0})); } catch (e) {} }
function loadSave() { try { return JSON.parse(localStorage.getItem('s9-save2')) || null; } catch (e) { return null; } }

// ---------------- snapshots
function packSnap() {
  const ps = {}; for (const p of PL.values()) ps[p.id] = [p.down ? 1 : 0, Math.ceil(p.bleed), p.dead ? 1 : 0, p.seat ? 1 : 0, (p.sack || []).map(k => KINDS.indexOf(k))];
  const s = {t: 'snap', m: [+M.x.toFixed(2), +M.y.toFixed(2), +M.z.toFixed(2), +M.yaw.toFixed(2), M.state, +M.spd.toFixed(2), +(M.look || 0).toFixed(2)],
    b: [+B.x.toFixed(2), +B.z.toFixed(3), +B.yaw.toFixed(4), +B.v.toFixed(2), +B.thr.toFixed(2), B.driver || '', +B.fuel.toFixed(1), +B.hull.toFixed(1), B.sink > 0 ? 1 : 0, +(B.dep || 0).toFixed(2)], up: B.up, sk: SUNK.map(q => q.got ? 1 : 0).join(''), hold: B.hold.map(k => KINDS.indexOf(k)),
    ps, it: ITEMS.map(i => i.taken ? 1 : 0).join(''), fl: G.floats.map(f => f ? [+f[0].toFixed(1), +f[1].toFixed(1), f[2]] : 0), va: VALVES.map(v => v.open ? 1 : 0), pw: G.power ? 1 : 0, bo: G.bbOut ? 1 : 0,
    dg: DIGS.map(d => (d.rev ? 1 : 0) + (d.dug ? 2 : 0)), cash: G.cash, earned: G.earned, disc: G.disc, goals: G.goals, st: +G.storm.toFixed(3), td: +G.tod.toFixed(4), hp: G.holdP, gt: +G.t.toFixed(1), sw: [+STS.x.toFixed(2), +STS.y.toFixed(2), +STS.z.toFixed(2), +STS.yaw.toFixed(2), STS.state, +STS.spd.toFixed(2)], gu: GUL.map(g => g.on ? [+g.x.toFixed(1), +g.y.toFixed(1), +g.z.toFixed(1), +g.yaw.toFixed(2), +g.pitch.toFixed(2), g.st] : 0), cz: G.cruise ? 1 : 0, ev: G.evq};
  G.evq = []; return s;
}
function applySnap(s) {
  for (const e of s.ev || []) applyEv(e);
  const [x, y, z, yaw, st, spd, look] = s.m; M.tx = x; M.ty = y; M.tz = z; M.tyaw = yaw; M.state = st; M.spd = spd; M.look = look;
  B.tx = s.b[0]; B.tz = s.b[1]; B.tyaw = s.b[2]; B.v = s.b[3]; B.thr = s.b[4]; B.driver = s.b[5] || null; B.fuel = s.b[6]; B.hull = s.b[7]; B.sink = s.b[8] ? 1 : 0; B.dep = s.b[9] || 0; if (s.sk) SUNK.forEach((q, i) => q.got = s.sk[i] === '1'); if (!B.got) { B.got = 1; B.x = B.tx; B.z = B.tz; B.yaw = B.tyaw; }
  B.up = s.up; B.hold = s.hold.map(i => KINDS[i]);
  for (const id in s.ps) { const p = PL.get(id); if (!p) continue; const [d, bl, de, , ca] = s.ps[id]; p.down = !!d; p.bleed = bl; p.dead = !!de; if (Array.isArray(ca)) { p.sack = ca.map(i => KINDS[i]); p.carry = p.sack[p.sack.length - 1] || null; if (p === P) P.sack = p.sack; } }
  for (let i = 0; i < ITEMS.length; i++) ITEMS[i].taken = s.it[i] === '1';
  G.floats = s.fl.map(f => f || null);
  s.va.forEach((v, i) => VALVES[i].open = !!v); if (s.pw && !G.power) applyEv({k: 'power'}); G.bbOut = !!s.bo;
  s.dg.forEach((v, i) => { DIGS[i].rev = !!(v & 1); DIGS[i].dug = !!(v & 2); });
  G.cash = s.cash; G.earned = s.earned; G.disc = s.disc; G.goals = s.goals; G.storm = s.st; if (s.td != null && (G.tod == null || Math.abs(s.td - G.tod) > .002)) G.tod = s.td;
  G.holdP = s.hp || {}; G.t = s.gt; G.cruise = s.cz || 0;
  if (s.sw) { const [x, y, z, yaw, st, spd] = s.sw; Object.assign(STS, {tx: x, ty: y, tz: z, tyaw: yaw, state: st, spd}); if (STS.x == null || Math.hypot(STS.x - x, STS.z - z) > 20) Object.assign(STS, {x, y, z, yaw}); }
  if (s.gu) s.gu.forEach((q, i) => { const g = GUL[i] || (GUL[i] = {}); if (!q) { g.on = 0; return; } const was = g.on; Object.assign(g, {on: 1, tx: q[0], ty: q[1], tz: q[2], tyaw: q[3], tpitch: q[4], st: q[5]}); if (!was) Object.assign(g, {x: q[0], y: q[1], z: q[2], yaw: q[3], pitch: q[4]}); }); for (let i = (s.gu || []).length; i < GUL.length; i++) GUL[i].on = 0;
}
Net.on('snap', m => { if (G.on && !isHost()) applySnap(m); });
Net.on('pose', (m, from) => {
  if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId()) return; const p = PL.get(id); if (!p) return;
  p.x = m.x; p.z = m.z; p.y = m.y; p.yaw = m.yw; p.pitch = m.pt; p.cr = m.cr; p.l = m.l; p.run = m.rn; p.h = m.h || ''; p.hd = m.hd; p.hb = m.hb; p.ob = m.ob; p.bl = m.bl || p.bl; p.sw = m.sw; p.deep = m.dp; p.in = m.in || [0, 0]; p.eq = m.eq || 0; p.sc = m.sc || 0; p.dv = m.dv || 0; p.su = m.su || 0; p.au = m.au || 0;
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
function lightOn() { return !!(P && P.l && (P.eq === 1 || P.eq === 3 || P.eq === 4 || (P.sw && P.own && P.own.suit && P.dv > .5))); }
function throwFlare() {
  if (P.flares <= 0 || P.hd >= 0 || P.down || P.seat || !alivePlay()) return; P.flares--; if (P.flares <= 0 && P.eq === 5) P.eq = 0;
  const f = eyeDir(P), e = {a: 'fl', x: P.x + f[0] * .4, y: P.y + P.eye - .2, z: P.z + f[2] * .4, vx: f[0] * 10 + P.vx, vy: f[1] * 10 + 3, vz: f[2] * 10 + P.vz};
  spawnFlare(e); if (isHost()) { if (Net.role === 'host') G.evq.push(Object.assign({}, e, {k: 'fl', id: myId()})); } else Net.send(Object.assign({t: 'act'}, e));
}
function stepFlares(dt) {
  for (let i = 0; i < G.flares.length; i++) {
    const f = G.flares[i];
    if (!f.rest) { f.vy -= 9.8 * dt; f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt; const fl = floorAt(f.x, f.z, f.y + .3); const gy = fl && fl.y > -.1 ? fl.y + .03 : -.1;
      if (f.y < gy) { f.y = gy; f.vy *= -.25; f.vx *= .5; f.vz *= .5; if (Math.hypot(f.vx, f.vz) < .5) { f.rest = true; f.sea = !(fl && fl.y > -.1); f.surf = fl && fl.s.k === 'boat' ? bW2L(f.x, f.z) : null; noise(f.x, f.y, f.z, 10); } } }
    else if (f.surf) { const [wx, wz] = bL2W(f.surf[0], f.surf[1]); f.x = wx; f.z = wz; }
    f.t -= f.sea ? dt * 2 : dt; f.m.position.set(f.x, f.y + (f.sea ? waveH(f.x, f.z, G.wt) + .1 : 0), f.z); f.m.rotation.set(0, 0, f.rest ? 0 : G.t * 9);
    const on = f.t > 0, k = .8 + Math.random() * .4; if (FLL[i]) FLL[i].intensity = on ? 16 * k * Math.min(1, f.t / 3) : 0; FLL[i] && FLL[i].position.set(f.x, f.m.position.y + .35, f.z); f.glow.material.opacity = on ? .8 * k : 0;
  }
  for (let i = G.flares.length; i < FLL.length; i++) FLL[i].intensity = 0;
}

// ---------------- local player
const K = {}; let mouseR = false, eDown = false, ePress = false;
const alivePlay = () => P && !P.dead;
function stepPlayer(dt) {
  if (!alivePlay()) return;
  const bdy = B.yaw - (P.lastBY ?? B.yaw); P.lastBY = B.yaw;
  if (P.ob) { P.yaw += bdy; const [wx, wz] = bL2W(P.bl[0], P.bl[1]); P.x = wx; P.z = wz; }
  if (P.seat) {
    P.bl = [BHELM[0], BHELM[1]]; const [wx, wz] = bL2W(BHELM[0], BHELM[1]); P.x = wx; P.z = wz; P.y = BDECK.y; P.ob = 1;
    const d = angD(B.yaw, P.yaw); P.yaw = B.yaw + clamp(d, -1.3, 1.3);
    P.in = [(K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0)];
    P.in.push((K.KeyC || K.ControlLeft ? 1 : 0) - (K.Space ? 1 : 0)); P.vx = P.vz = 0; P.eye = mix(P.eye, HC().eye || ((B.up.cls || 0) === 3 ? 8.9 : 1.62), dt * 4); return;
  }
  P.in = [0, 0];
  if (P.hd >= 0) {
    const h = HIDES[P.hd]; P.x = h.x; P.z = h.z; P.y = h.y; P.vx = P.vz = 0;
    const want = (mouseR || K.Space) && P.gasp <= 0;
    if (want && P.breath > 0) { P.hb = 1; P.breath -= dt / 10; if (P.breath <= 0) { P.breath = 0; P.hb = 0; P.gasp = 2.2; Snd.gasp(); act({a: 'gasp'}); } } else { P.hb = 0; P.breath = Math.min(1, P.breath + dt / 6); }
    P.gasp -= dt; $('breath').querySelector('i').style.width = P.breath * 100 + '%'; return;
  }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mag = Math.hypot(fw, st) || 1;
  const wade = !P.sw && P.y < -.05;
  let run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && P.stam > .02 && !P.cr && !P.down && !P.sw && !wade && sackUsed(P.sack) < 7;
  if (P.tired && P.stam < .3) run = false; if (P.stam > .3) P.tired = false;
  let sp = P.sw ? ((P.own && P.own.suit) ? 2.6 : 1.6) * (P.dv > 1 && (P.own && P.own.suit) ? Math.cos(P.pitch) : 1) : P.down ? .55 : P.cr ? 1.6 : run ? 5.8 : 3.0; if (wade) sp *= .6; sp *= 1 - .3 * sackUsed(P.sack) / 10;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp, acc = (fw || st) ? 9 : 12;
  P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * acc)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * acc));
  const ox = P.x, oz = P.z; P.x += P.vx * dt; P.z += P.vz * dt;
  pushBody(P, .33, P.y);
  const f = floorAt(P.x, P.z, P.sw ? 0 : P.y);
  const stand = f && f.y > -1.3;
  if (P.sw) { if (stand) { P.sw = 0; P.y = f.y; P.dv = 0; } else { P.y = 0; P.deep = !f || f.y < -3 ? 1 : 0; } }
  const su = (P.own && P.own.suit) || 0, SU = SUIT[su]; let vy = 0;
  if (P.sw && !P.down) { if (K.KeyC || K.ControlLeft) vy += 1; if (K.Space) vy -= 1; if (su && fw) vy += -Math.sin(P.pitch) * fw; }
  const lim = Math.max(0, Math.min(SU.max, -seaBed(P.x, P.z) - 1.2)); P.dv = P.sw ? clamp((P.dv || 0) + (vy ? vy * (su ? 2.4 : 1.4) : su ? 0 : -2.2) * dt, 0, lim) : 0;
  if (P.sw && P.dv >= SU.max - .5 && vy > 0 && !G.pressT) { G.pressT = 1; showMsg(su ? `Too deep for the ${SU.n}. The pressure crushes in on your chest.` : 'You need diving gear to go deeper. The harbour shed sells it.', '', 3); } if (P.dv < SU.max - 3) G.pressT = 0;
  P.air = clamp((P.air ?? 1) + (P.dv > .4 ? -dt / SU.air : dt / 4), 0, 1);
  if (P.air <= 0 && P.dv > .3) { if (su) { if (!P.drownSent) { P.drownSent = 1; act({a: 'drown'}); } } else if (!P.gaspT) { P.gaspT = 1; Snd.gasp(); } } if (P.dv < .1) { P.gaspT = 0; P.drownSent = 0; }
  if (P.dv > .4 && Math.random() < dt * .6) Snd.bubbles();
  if (!P.sw) {
    P.deep = 0;
    if (stand && P.y - f.y < .6) { P.y = mix(P.y, f.y, Math.min(1, dt * 14)); P.vy = 0; }
    else { P.vy = (P.vy || 0) - 20 * dt; P.y += P.vy * dt; if (stand && P.y < f.y) { P.y = f.y; P.vy = 0; } if (!stand && P.y < .1) { P.sw = 1; P.y = 0; P.vy = 0; P.ob = 0; Snd.splash(); showMsg('You are in the water! Swim to land or a ladder (E). Do not stay out in deep water.', '', 3); } }
  }
  if (!P.sw && f && f.s.k === 'boat' && Math.abs(P.y - BDECK.y) < .3) { P.ob = 1; P.bl = bW2L(P.x, P.z); } else P.ob = 0;
  const moved = Math.hypot(P.x - ox, P.z - oz), v = moved / Math.max(dt, 1e-4); P.run = run && v > 1 ? 1 : 0;
  if (P.run) { P.stam -= dt / 7; if (P.stam <= 0) { P.stam = 0; P.tired = true; } } else P.stam = Math.min(1, P.stam + dt / (v > .5 ? 11 : 7));
  P.eye = mix(P.eye, P.sw ? .25 : P.down ? .45 : P.cr ? 1.0 : 1.62, Math.min(1, dt * 8));
  P.stepD += moved; P.bob += moved * (run ? 1.25 : 1.6);
  if (P.stepD > (run ? 1 : P.cr ? .55 : .75)) { P.stepD = 0; const k = run ? 1.4 : P.cr ? .35 : .8, kind = P.sw || wade ? 'wet' : f && f.s.k === 'land' ? 'sand' : f && (f.s.k === 'slab' || f.s.k === 'ramp') && nearRig(P.x, P.z) ? 'metal' : 'wood'; Snd.step(kind, k); if (isHost() && !P.ob) { noise(P.x, P.y, P.z, run ? 22 : P.cr ? 2 : 8); if (run) P.heat += .02; } }
  if (P.l) { P.bat -= dt / 360; if (P.bat <= 0) { P.bat = 0; P.l = 0; showMsg('Your flashlight died. Buy batteries at the harbour shed.', '', 3); } }
  $('stam').style.opacity = P.stam < .99 ? 1 : 0; $('stam').firstChild.style.width = P.stam * 100 + '%';
}
function interWorld(it) { if (!it.boat) return it; const [x, z] = bL2W(it.lx, it.lz); return {x, y: BDECK.y + it.ly, z}; }
function targets() {
  const L = [];
  for (const it of ITEMS) if (!it.taken) L.push({x: it.x, y: it.y + .2, z: it.z, r: 2.4, label: it.kind === 'note' ? 'Read the note' : CARRY.has(it.kind) && !sackFits(P, it.kind) ? `Sack full (${sackUsed(P.sack)}/${sackCap(P)}, X drops the last thing)` : `Pick up the ${NAMES[it.kind]}` + (VALUE[it.kind] ? ` ($${VALUE[it.kind]})` : ''), go: () => it.kind === 'note' ? openNote(it.text) : act({a: 'pick', i: it.i})});
  G.floats.forEach((f, i) => { if (!f) return; const kind = KINDS[f[2]]; L.push({x: f[0], y: (P.ob ? BDECK.y : 0) + .2, z: f[1], r: (B.up.crane && P.ob ? 12 : 5.5) + (P.ob ? BG.hw * .6 : 0), flat: 1, label: kind !== 'bottle' && !sackFits(P, kind) ? 'Sack full' : (P.ob ? 'Haul the ' : 'Grab the ') + NAMES[kind] + (P.ob ? ' aboard' : '') + (VALUE[kind] ? ` ($${VALUE[kind]})` : ''), go: () => act({a: 'float', i})}); });
  VALVES.forEach((v, i) => { if (!v.open) L.push({x: v.x, y: v.y + 1.1, z: v.z, r: 2.6, hold: 'v' + i, label: 'Hold E to open the ' + v.name}); });
  const gb = BLD.find(q => q.kind === 'gen'), cb = BLD.find(q => q.kind === 'ctrl');
  if (gb) L.push({x: gb.genP[0], y: gb.genP[1], z: gb.genP[2], r: 3, hold: !G.power && VALVES.every(v => v.open) ? 'g' : '', label: G.power ? 'The generator is running' : VALVES.every(v => v.open) ? 'Hold E to start the generator' : 'Generator. No fuel: two valves are shut.'});
  if (CRZ.bridge && CRZ.bridge.console) { const c = CRZ.bridge.console; L.push({x: c[0], y: c[1], z: c[2], r: 2.8, hold: !G.cruise && P.sack.includes('key') ? 'cz' : '', label: G.cruise ? 'The Serenade is yours. Switch to her at the harbour shed.' : P.sack.includes('key') ? 'Hold E to start the engines (it will hear)' : "Engine start. Needs the captain's key card."}); }
  for (let i = 0; i < SUNK.length; i++) { const q = SUNK[i]; if (q.got || !P.sw || (P.dv || 0) < 1) continue; if (Math.hypot(q.x - P.x, q.z - P.z) > 4) continue; L.push({x: q.x, y: q.y + .4, z: q.z, r: 4.5, dive: 1, label: `Grab the sunken ${NAMES[q.kind]} ($${VALUE[q.kind] || 0})`, go: () => act({a: 'dpick', i})}); }
  if (cb) L.push({x: cb.console[0], y: cb.console[1], z: cb.console[2], r: 2.8, hold: G.power && !G.bbOut ? 'c' : '', label: !G.power ? 'Control console. No power.' : G.bbOut ? 'Static on every channel' : 'Hold E to eject the flight recorder'});
  DIGS.forEach((d, i) => { if (!d.dug) L.push({x: d.x, y: d.y + .3, z: d.z, r: 2.6, hold: 'd' + i, label: d.rev ? 'Hold E to dig where the X is' : 'A cairn of stones. Hold E to dig.'}); });
  if (G.shed) L.push({x: G.shed.shop[0], y: G.shed.shop[1], z: G.shed.shop[2], r: 3, label: 'Harbour shed: sell salvage, buy upgrades', go: openShop});
  for (const p of PL.values()) if (p !== P && p.down && !p.dead && p.ready) L.push({x: p.x, y: p.y + .3, z: p.z, r: 2.4, hold: 'r' + p.id, label: `Hold E to pick up ${p.name}`});
  for (const it of INTER) { if (it.on && !it.on()) continue; const w = interWorld(it); L.push(Object.assign({}, it, {x: w.x, y: it.boat ? w.y : it.y, z: w.z, label: it.label(), hide: it.h, src: it})); }
  return L;
}
function stepInteract(dt) {
  const pr = $('prompt'); P.h = '';
  if (TEST && G.forceH) { P.h = G.forceH; return; }
  if (!alivePlay() || P.down || G.shopOpen || G.helpOpen) { pr.style.opacity = 0; ePress = false; return; }
  const ey = P.y + P.eye; cam.getWorldDirection(_fw); let best = null, bs = 1e9;
  for (const it of targets()) {
    if (P.hd >= 0) { if (it.hide && it.hide.i === P.hd) { best = it; break; } continue; }
    if (P.seat) { if (it.kind === 'helm') { best = it; break; } continue; }
    if (P.sw && it.kind !== 'ladder' && !it.flat && !it.dive) continue;
    const dx = it.x - P.x, dy = (it.kind === 'ladder' || it.flat ? 0 : it.dive ? it.y - cam.position.y : it.y - ey), dz = it.z - P.z, d = Math.hypot(dx, dy, dz); if (d > it.r) continue;
    if (it.kind !== 'ladder') { const hd = Math.hypot(dx, dz) || 1, dot = it.flat ? (dx * _fw.x + dz * _fw.z) / hd / Math.max(.2, Math.hypot(_fw.x, _fw.z)) : (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d, lim = d < 1.2 ? .4 : it.flat ? .6 : .84; if (dot < lim) continue; }
    if (d < bs) { bs = d; best = it; }
  }
  if (!best) { pr.style.opacity = 0; ePress = false; return; }
  $('pTxt').innerHTML = `<kbd>E</kbd>${best.label}`; pr.style.opacity = 1;
  const hp = best.hold ? (G.holdP[best.hold] || 0) : 0; $('pBar').style.display = best.hold ? 'block' : 'none'; $('pBar').firstChild.style.width = hp * 100 + '%';
  if (best.hold && eDown) { P.h = best.hold; if (best.hold[0] === 'v' && Math.random() < dt * 2) Snd.valve(); if (best.hold[0] === 'd' && Math.random() < dt * 3) Snd.dig(); }
  else if (ePress) {
    if (best.hide) toggleHide(best.hide);
    else if (best.kind === 'helm') act({a: P.seat ? 'unhelm' : 'helm'});
    else if (best.kind === 'ladder') { const s = best.src; P.sw = 0; P.vy = 0; if (s.top === 'boat') { P.ob = 1; const lz = BG.sub ? BDECK.z1 - .6 : BG.zs - 1, [wx, wz] = bL2W(0, lz); P.bl = [0, lz]; P.x = wx; P.z = wz; P.y = BDECK.y; } else { P.x = s.top[0]; P.y = s.top[1]; P.z = s.top[2]; } Snd.splash(); }
    else if (best.kind === 'hold') { if (sackVal(P.sack)) act({a: 'stow'}); }
    else if (best.kind === 'fuelcap') { if (P.sack.includes('fuel')) act({a: 'fuel'}); }
    else if (best.kind === 'patchbox') { if (P.sack.includes('patch')) act({a: 'patch'}); }
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
function openShop() { G.shopOpen = true; $('shop').classList.remove('hidden'); try { document.exitPointerLock(); } catch (e) {} drawShop(); }
function closeShop() { G.shopOpen = false; $('shop').classList.add('hidden'); lockMouse(); }
function drawShop() {
  if (!G.shopOpen) return;
  const docked = Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 60 + BG.L * .5, v = (docked ? holdValue() : 0) + sackVal(P.sack) + (P.coolerV || 0);
  $('shopCash').textContent = `Crew cash: $${G.cash} · earned so far: $${G.earned}` + (docked ? '' : ' · bring the boat to the jetty to sell the hold');
  $('bSell').textContent = v ? `Sell salvage for $${v}` : 'Nothing to sell'; $('bSell').disabled = !v;
  const rows = Object.entries(UPG).map(([k, U]) => { const lv = B.up[k] || 0, c = U.cost[lv]; return `<div class="up"><div>${U.n} ${'●'.repeat(lv)}${'○'.repeat(U.cost.length - lv)}<small>${U.d}</small></div><button data-k="${k}" ${c == null || G.cash < c ? 'disabled' : ''}>${c == null ? 'Maxed' : '$' + c}</button></div>`; });
  rows.unshift('<div class="shopH">YOUR BOAT: UPGRADES</div>');
  rows.unshift(...HULLS.map((H, i) => `<div class="up"><div>${H.n}${i === (B.up.cls || 0) ? ' (yours)' : ''}<small>${H.d} · ${H.L} m, hold ${H.hold}</small></div><button data-h="${i}" ${i === (B.up.cls || 0) || G.cash < hullCost(H) || !docked || (H.cruise && !G.cruise) ? 'disabled' : ''}>${i === (B.up.cls || 0) ? 'Owned' : H.cruise && !G.cruise ? 'Unclaimed' : (hullCost(H) ? '$' + hullCost(H) : 'Free')}</button></div>`)); rows.unshift('<div class="shopH">HULL (boat must be at the jetty)</div>');
  rows.push('<div class="shopH">STYLE</div>');
  rows.push(`<div class="up"><div>Aura<small>Glowing motes that follow you. Your crew sees it</small></div><div class="sw">${AURAS.map((a, i) => { const own = !i || ((P.own.auras || []).includes(i)) || ALL; return `<button data-a="${i}" class="${(P.own.aura || 0) === i ? 'on' : ''}" title="${a.n}" ${!own && G.cash < a.cost ? 'disabled' : ''}>${a.n}${own ? '' : ' $' + a.cost}</button>`; }).join('')}</div></div>`);
  rows.push(`<div class="up"><div>Hull paint<small>$${ALL ? 0 : STYLE_COST.paint} to repaint</small></div><div class="sw">${PAINTS.map((a, i) => `<button data-c="paint" data-v="${i}" class="${(B.up.paint || 0) === i ? 'on' : ''}">${a.n}</button>`).join('')}</div></div>`);
  rows.push(`<div class="up"><div>Underglow<small>Neon under the hull, best at night ($${ALL ? 0 : STYLE_COST.glow})</small></div><div class="sw">${GLOWS.map((a, i) => `<button data-c="glow" data-v="${i}" class="${(B.up.glow || 0) === i ? 'on' : ''}">${a.n}</button>`).join('')}</div></div>`);
  rows.push('<div class="shopH">YOUR GEAR</div>');
  for (const [k, g] of Object.entries(GEAR)) if (g.need(P.own)) rows.push(`<div class="up"><div>${g.n}<small>${g.d}</small></div><button data-g="${k}" ${G.cash < g.cost ? 'disabled' : ''}>$${g.cost}</button></div>`);
  rows.push(`<div class="up"><div>How to fish<small>A quick guide to casting and reeling</small></div><button data-help="1">Read</button></div>`);
  rows.push(`<div class="up"><div>Three flares<small>Red light keeps things away</small></div><button data-k="flares" ${G.cash < 30 ? 'disabled' : ''}>$30</button></div>`);
  rows.push(`<div class="up"><div>Batteries<small>Recharge your flashlight</small></div><button data-k="battery" ${G.cash < 20 ? 'disabled' : ''}>$20</button></div>`);
  $('shopL').innerHTML = rows.join('');
  $('shopL').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.help) { closeShop(); showFishHelp(true); return; } if (b.dataset.a) { const i = +b.dataset.a; if (!i || (P.own.auras || []).includes(i) || ALL) { P.own.aura = i; saveGear(); } else act({a: 'buya', i}); setTimeout(drawShop, 150); return; } if (b.dataset.c) { act({a: 'buyc', k: b.dataset.c, v: +b.dataset.v}); setTimeout(drawShop, 150); return; } if (b.dataset.h) act({a: 'buyh', k: +b.dataset.h}); else if (b.dataset.g) act({a: 'buyg', k: b.dataset.g}); else act({a: 'buy', k: b.dataset.k}); setTimeout(drawShop, 150); });
}
function myPose() { return {t: 'pose', x: +P.x.toFixed(2), z: +P.z.toFixed(2), y: +P.y.toFixed(2), yw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.cr ? 1 : 0, rn: P.run, h: P.h, hd: P.hd, hb: P.hb, ob: P.ob, bl: P.ob ? [+P.bl[0].toFixed(2), +P.bl[1].toFixed(2)] : 0, sw: P.sw, dp: P.deep, in: P.seat ? P.in : 0, eq: P.eq, sc: (P.own && P.own.sack) || 0, dv: +(P.dv || 0).toFixed(2), su: (P.own && P.own.suit) || 0, au: (P.own && P.own.aura) || 0, l: lightOn() ? 1 : 0}; }

// ---------------- input
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!G.on) return; K[e.code] = true;
  if (G.noteOpen) { if (e.code === 'KeyE' || e.code === 'Escape') closeNote(); return; }
  if (G.shopOpen) { if ((e.code === 'KeyE' || e.code === 'Escape') && !e.repeat) closeShop(); return; }
  if (G.helpOpen) { if (['KeyE', 'Escape', 'KeyH', 'Enter'].includes(e.code) && !e.repeat) showFishHelp(false); return; }
  if (e.repeat) return;
  if (e.code === 'KeyE') { eDown = true; ePress = true; }
  if (!alivePlay()) return;
  if (e.code === 'KeyF' && P.hd < 0 && P.bat > 0) { P.l = P.l ? 0 : 1; Snd.click(); }
  if (e.code === 'KeyC' && !P.down && !P.seat) P.cr = P.cr ? 0 : 1;
  if (e.code === 'KeyG') throwFlare();
  if (e.code === 'KeyX' && P.sack.length) act({a: 'drop'});
  if (/^Digit[1-7]$/.test(e.code)) equip(+e.code[5] - 1);
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyH') showFishHelp(true);
  if (e.code === 'KeyQ' && !P.down && (G.whT || 0) <= 0) { G.whT = 3; act({a: 'wh'}); }
  if (e.code === 'Tab') { G.map = true; $('map').classList.remove('hidden'); drawMap(); }
});
addEventListener('keyup', e => { K[e.code] = false; if (e.code === 'KeyE') eDown = false; if (e.code === 'Tab') { G.map = false; $('map').classList.add('hidden'); } });
addEventListener('mousemove', e => {
  if (!G.on || G.paused || document.pointerLockElement !== canvas || !P) return;
  const s = .0022 * SET.sens; P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.45, 1.45);
  if (P.hd >= 0) { const h = HIDES[P.hd], d = angD(h.yaw, P.yaw); P.yaw = h.yaw + clamp(d, -.7, .7); P.pitch = clamp(P.pitch, -.5, .4); }
});
canvas.addEventListener('mousedown', e => { if (!G.on || G.shopOpen) return; if (document.pointerLockElement !== canvas) { lockMouse(); return; } if (G.noteOpen) { closeNote(); return; } if (e.button === 2) mouseR = true; if (e.button === 0 && !alivePlay()) G.spec++; if (e.button === 0 && alivePlay()) { G.lmb = true; toolDown(); } });
addEventListener('mouseup', e => { if (e.button === 2) mouseR = false; if (e.button === 0) { G.lmb = false; toolUp(); } });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && G.on && !TEST && !G.shopOpen && !G.helpOpen) pause(true); });
addEventListener('blur', () => { for (const k in K) K[k] = false; eDown = false; mouseR = false; G.lmb = false; });
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function pause(p) { G.paused = p; $('pause').classList.toggle('hidden', !p); $('pauseN').textContent = Net.role === 'solo' ? 'The sea waits for you. Progress is saved.' : 'Online games keep running.'; if (Net.role === 'solo' && A.ctx) p ? A.ctx.suspend() : A.ctx.resume(); if (!p) lockMouse(); }

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
const VMF = new THREE.Group(); cam.add(VMF); VMF.position.set(.2, -.24, -.45); VMF.rotation.set(.5, 0, -.25); VMF.visible = false;
{ const st = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .3, 8), new THREE.MeshStandardMaterial({color: 0xb01a10, roughness: .6})); VMF.add(st); const tp = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(6, 1.2, .5)})); tp.position.y = .16; VMF.add(tp); VMF.userData.tip = tp; }
const VMC = new THREE.Group(); cam.add(VMC); VMC.position.set(-.05, -.42, -.75);
function boatPose(dt) {
  if (!isHost() && B.tx != null) { const k = Math.min(1, dt * 6); const px = B.tx - Math.sin(B.tyaw) * B.v * .05, pz = B.tz - Math.cos(B.tyaw) * B.v * .05; B.x = mix(B.x, px, k); B.z = mix(B.z, pz, k); B.yaw += angD(B.yaw, B.tyaw) * k; B.x += -Math.sin(B.yaw) * B.v * dt * (1 - k); B.z += -Math.cos(B.yaw) * B.v * dt * (1 - k); }
  const t = G.wt, fx = -Math.sin(B.yaw), fz = -Math.cos(B.yaw), sx = Math.cos(B.yaw), sz = -Math.sin(B.yaw);
  if (BOAT.userData.sig !== (B.up.cls || 0) + ':' + (B.up.paint || 0)) { const same = BOAT.userData.cls === (B.up.cls || 0); buildBoat(); if (same) { /* repaint only */ } else if (P && P.ob) { P.bl = [0, Math.min(BG.zs - .8, BSPOT.hold[1] + 1.8)]; } }
  const hl2 = BG.L * .32, hw2 = BG.hw * .9, hf = waveH(B.x + fx * hl2, B.z + fz * hl2, t), hb = waveH(B.x - fx * hl2, B.z - fz * hl2, t), hl = waveH(B.x - sx * hw2, B.z - sz * hw2, t), hr = waveH(B.x + sx * hw2, B.z + sz * hw2, t);
  B.sinkY = B.sink > 0 ? Math.max(-6, (B.sinkY || 0) - dt * 1.2) : 0;
  const dk = clamp(1 - (B.dep || 0), 0, 1); B.heave = (hf + hb + hl + hr) / 4 * dk + B.sinkY - (B.dep || 0); B.pitch = (Math.atan2(hf - hb, hl2 * 2) * .8 * dk + (B.sink > 0 ? .25 : 0)) + clamp((B.dtar - B.dep) * .06, -.12, .12); B.roll = Math.atan2(hl - hr, hw2 * 2) * .8 * dk + (G.shake || 0) * Math.sin(G.t * 23) * .05 - B.st * clamp(B.v / 12, -1, 1) * .05;
  { const gl = GLOWS[B.up.glow || 0], gm = BOAT.userData.glow; if (gl && gl.c) { if (gl.c < 0) gm.material.color.setHSL((G.wt * .1) % 1, 1, .55); else gm.material.color.setHex(gl.c); gm.material.opacity = (.55 - .35 * TOD.day) * (B.dep > .5 ? 0 : 1); } else gm.material.opacity = 0; }
  if (BOAT.userData.winM) BOAT.userData.winM.emissiveIntensity = .05 + TOD.night * .9 * (.85 + Math.random() * .15);
  if (BOAT.userData.prop) BOAT.userData.prop.rotation.z += B.thr * dt * 20; if (BOAT.userData.radar) BOAT.userData.radar.rotation.y += dt * 1.6;
  BOAT.position.set(B.x, B.heave, B.z); BOAT.rotation.set(B.pitch, B.yaw, B.roll, 'YXZ');
  BOAT.userData.wheel.rotation.z = -B.st * 2;
  const cg = BOAT.userData.cargo; while (cg.children.length > Math.min(8, B.hold.length)) cg.remove(cg.children[cg.children.length - 1]);
  while (cg.children.length < Math.min(8, B.hold.length)) { const i = cg.children.length, m = itemMesh(B.hold[i] || 'crate'); scene.remove(m); m.position.set(-1.3 + (i % 4) * .85, BDECK.y + .25 + Math.floor(i / 4) * .45, BSPOT.hold[1] + (BG.sub ? -1.4 : 1.4)); cg.add(m); }
  const lv = B.up.light, [lx, lz] = bL2W(0, BOAT.userData.lightZ); boatL.position.set(lx, BOAT.userData.lightY + B.heave, lz); boatL.target.position.set(B.x + fx * 40, -1, B.z + fz * 40); boatL.intensity = [160, 300, 500][lv] * (1 - .85 * TOD.day * (B.dep > 1 ? 0 : 1)) * ((B.up.cls || 0) === 2 ? 1.6 : 1); boatL.distance = [90, 160, 220][lv];
}
function specTarget() { const L = [...PL.values()].filter(p => p !== P && p.ready && !p.dead); return L.length ? L[G.spec % L.length] : null; }
function updateCamera(dt) {
  let ex, ey, ez, yaw, pitch, own = alivePlay(), roll = 0;
  if (own && P.ob) { [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); }
  if (own) { ex = P.x; ey = P.y + P.eye; ez = P.z; yaw = P.yaw; pitch = P.pitch; if (P.ob) { ey += B.heave; roll = B.roll * .7; pitch += B.pitch * .5; } if (P.sw) ey = waveH(P.x, P.z, G.wt) + .25 - (P.dv || 0) * 1.0; else if (P.y < 0) ey = Math.max(ey, waveH(P.x, P.z, G.wt) + .25); }
  else if (G.drownCam) { const dc = G.drownCam; dc.t += dt; ex = dc.x; ez = dc.z; ey = waveH(ex, ez, G.wt) + .2 - Math.min(5.5, dc.t * 2.2); yaw = dc.yaw; pitch = mix(.1, -1.35, clamp(dc.t / 1.2, 0, 1)); roll = Math.sin(dc.t * 3) * .15; if (dc.t > 4) G.drownCam = null; }
  else { const s = specTarget(); if (s) { ex = s.rx; ey = s.ry + (s.down ? .5 : 1.6) + (s.ob ? B.heave : 0); ez = s.rz; yaw = s.ryaw; pitch = s.rpitch; } else { ex = HOME.x; ey = 30; ez = HOME.z + 40; yaw = PI; pitch = -.3; } }
  const sp = own ? Math.hypot(P.vx, P.vz) : 0, bobA = own && P.hd < 0 && !P.seat ? clamp(sp / 6, 0, 1) * .05 : 0, shk = (own && P.fear > .5 ? (P.fear - .5) * .006 : 0) + (G.shake || 0) * .02;
  G.shake = Math.max(0, (G.shake || 0) - dt * 1.2);
  if (own) { const sv = P.vx * Math.cos(P.yaw) - P.vz * Math.sin(P.yaw); G.rollS = mix(G.rollS || 0, -sv * .006, Math.min(1, dt * 6)); roll += G.rollS; }
  if (G.js && G.js.t > 0) { G.js.t -= dt; (G.js.J || MJ).head.getWorldPosition(_mh); const dx = _mh.x - ex, dy = _mh.y + .05 - ey, dz = _mh.z - ez, k = clamp((G.js.L - G.js.t) * 9, 0, 1);
    yaw += angD(yaw, Math.atan2(-dx, -dz)) * k; pitch = mix(pitch, Math.atan2(dy, Math.hypot(dx, dz)), k); }
  cam.position.set(ex + Math.sin(G.t * 37) * shk, ey + Math.sin((P.bob || 0) * 2) * bobA * .6, ez);
  cam.rotation.set(pitch + Math.sin(G.t * 31) * shk, yaw + Math.sin(P.bob || 0) * bobA * .05, roll + (own && P.down ? .35 : Math.sin(P.bob || 0) * bobA * .08), 'YXZ'); cam.updateMatrixWorld();
  VM.visible = own && P.hd < 0 && !P.down && !P.sw && !P.seat && P.eq === 1; VMF.visible = own && P.hd < 0 && !P.down && !P.sw && !P.seat && P.eq === 5 && P.flares > 0;
  VM.position.set(.22 + Math.sin(P.bob || 0) * bobA * .3, -.21 - Math.abs(Math.cos(P.bob || 0)) * bobA * .3, -.42);
  if (false) { VMC.clear(); VMC.userData.k = P.carry; if (P.carry) { const m = itemMesh(P.carry); scene.remove(m); m.traverse(o => { if (o.isMesh) o.castShadow = false; }); VMC.add(m); } }
  VMC.visible = false;
  cam.getWorldDirection(_fw); swayV.lerp(_fw, Math.min(1, dt * 14));
  const on = own && (lightOn() || (G.js && G.js.t > 0)) && P.hd < 0 && (!P.sw || P.dv > .5); let k = on ? .55 + .45 * Math.min(1, P.bat * 3) : 0;
  const nearM = Math.hypot(ex - M.x, ez - M.z) + Math.abs(ey - M.y);
  if (G.js && G.js.t > 0) k = Math.random() < .3 ? .25 : 1; else if (on && (P.bat < .15 || nearM < 13 || M.state === 'chase' && nearM < 22) && Math.random() < .25) k *= Math.random() < .5 ? .05 : .5;
  flash.intensity = 70 * k; VM.userData.lens.material.color.setScalar(on ? .4 + k : .05);
  _v.set(.2, -.19, -.62).applyQuaternion(cam.quaternion).add(cam.position); flash.position.copy(_v); flash.target.position.copy(_v).addScaledVector(swayV, 10);
  scene.userData.sky.position.copy(cam.position); stepBirds(G.wt, ex, ez);
  SEA.position.set(Math.round(ex / 6) * 6, 0, Math.round(ez / 6) * 6);
  RAIN.position.set(ex, ey - 12, ez); RAIN.visible = G.storm > .15 && !(P && P.ob && P.bl && P.bl[1] < -1.2 && P.bl[1] > -4.2) && zoneOf(ex, ez, ey - 1.6) < 0; RAIN.material.opacity = .32 * G.storm;
  if (RAIN.visible) { const ra = RAIN.geometry.attributes.position.array, fall = dt * 24; for (let i = 0; i < ra.length; i += 6) { ra[i + 1] -= fall; ra[i + 4] -= fall; ra[i] -= fall * .1; ra[i + 3] -= fall * .1; if (ra[i + 1] < 0) { const x = (Math.random() - .5) * 50, y = 30, z = (Math.random() - .5) * 50; ra[i] = x; ra[i + 1] = y; ra[i + 2] = z; ra[i + 3] = x + .15; ra[i + 4] = y + .7; ra[i + 5] = z + .05; } } RAIN.geometry.attributes.position.needsUpdate = true; }
}
// ---------------- the deep: a 45 m serpent. Its body follows the path its head took.
const LEV = {NS: 46, NR: 14, LEN: 45, trail: [], g: null, body: null, spk: null, dots: null, head: null, jaw: null, U: new THREE.Vector3(0, 1, 0), on: false, hp: new THREE.Vector3(), ht: new THREE.Vector3(0, 0, 1)};
function levR(u) { return u < .05 ? 1.25 + u / .05 * .75 : 2.0 * Math.pow(1 - (u - .05) / .95, .8) + .12; }
// choreography shared by host (hit tests) and clients (drawing): circle, rear up out of the sea, strike, pass under
function levPose(a, el, L, o) {
  const tB = L - 3.4, tS = L - 1.2, ab = a + tB * .45;
  if (el < tB) { const ang = a + el * .45; o.x = B.x + Math.sin(ang) * 19; o.z = B.z + Math.cos(ang) * 19; o.y = mix(-14, -1.25, clamp(el / 1.8, 0, 1)) + Math.sin(el * 1.3) * .35; o.jaw = .08; o.ph = 0; o.u = 0; }
  else if (el < tS) { const u = (el - tB) / (tS - tB), e = Math.sin(Math.min(1, u * 1.5) * PI / 2), r = 19 + e * 5; o.x = B.x + Math.sin(ab) * r; o.z = B.z + Math.cos(ab) * r; o.y = mix(-1.25, 8, e) - Math.max(0, u - .82) * 10; o.jaw = clamp((u - .1) * 3, 0, 1); o.ph = 1; o.u = u; }
  else if (el < L) { const u = (el - tS) / (L - tS); o.x = B.x + Math.sin(ab) * 24 * (1 - u); o.z = B.z + Math.cos(ab) * 24 * (1 - u); o.y = mix(6.2, -3.5, Math.min(1, u * 1.3)); o.jaw = 1 - u * .6; o.ph = 2; o.u = u; }
  else { const u = el - L; o.x = B.x - Math.sin(ab) * u * 9; o.z = B.z - Math.cos(ab) * u * 9; o.y = -3.5 - u * 6; o.jaw = .2; o.ph = 3; o.u = u; }
  return o;
}
function buildLev() {
  const {NS, NR} = LEV, n = NS * NR, g = new THREE.BufferGeometry(), col = new Float32Array(n * 3), idx = [];
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const k = i * NR + j, a = j / NR * TAU, belly = Math.max(0, -Math.cos(a)), m = .6 + .4 * h2(i * 1.7, j * 3.1), str = .85 + .15 * Math.sin(i * 1.3 + j * .4);
    col.set([mix(.018, .11, belly) * m * str, mix(.026, .12, belly) * m * str, mix(.03, .11, belly) * m * str], k * 3); }
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR; idx.push(a, c, b, b, c, d); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const skin = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .42, metalness: 0, envMapIntensity: .45, side: THREE.DoubleSide});
  LEV.body = new THREE.Mesh(g, skin); LEV.body.frustumCulled = false; LEV.body.castShadow = true; scene.add(LEV.body);
  const bone = new THREE.MeshStandardMaterial({color: 0x1a1d1a, roughness: .5}), tooth = new THREE.MeshStandardMaterial({color: 0xd8d0b4, roughness: .25});
  LEV.spk = new THREE.InstancedMesh(new THREE.ConeGeometry(.28, 1.8, 5), bone, 24); LEV.spk.frustumCulled = false; scene.add(LEV.spk);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  LEV.dots = new THREE.Points(dg, new THREE.PointsMaterial({map: TX.glow, color: new THREE.Color().setRGB(1.4, 4, 3.4), size: .9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); LEV.dots.frustumCulled = false; scene.add(LEV.dots);
  const h = new THREE.Group(); LEV.head = h; scene.add(h);
  const sk = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, p = h) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; p.add(o); return o; };
  const hm = new THREE.MeshStandardMaterial({color: 0x0c1012, roughness: .4, metalness: 0, envMapIntensity: .45});
  sk(new THREE.SphereGeometry(1.5, 22, 16), hm, 0, .2, .4, 1.15, .8, 1.5); sk(new THREE.SphereGeometry(1.2, 18, 12), hm, 0, -.05, 2.6, .85, .55, 2.3); sk(new THREE.SphereGeometry(1, 16, 12), hm, 0, .55, .2, 1.1, .5, 1.6);
  for (const s of [-1, 1]) { sk(new THREE.SphereGeometry(.4, 10, 8), hm, s * .9, .55, 1.7, 1, .5, 2.2);
    [[2.6, .22], [2.1, .16], [1.65, .12]].forEach(([z, r]) => { const e = sk(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(7, 4.5, 1)}), s * (z > 2.4 ? .85 : 1.15), .42, z); e.castShadow = false; });
    for (let i = 0; i < 3; i++) { const t = sk(new THREE.CylinderGeometry(.05, .01, 3.5, 5), hm, s * (.5 + i * .25), -.9, 2.2 - i * .7); t.geometry.translate(0, -1.6, 0); t.rotation.x = .5; LEV['tn' + s + i] = t; } }
  for (let i = 0; i < 7; i++) sk(new THREE.ConeGeometry(.22 - i * .02, 1.4 - i * .12, 5), bone, 0, 1.05 - i * .04, 1.2 - i * .55, 1, 1, 1).rotation.x = -.7;
  for (let i = 0; i < 17; i++) { const a = -1.35 + i / 16 * 2.7, t = sk(new THREE.ConeGeometry(.11, .8 + Math.random() * .5, 5), tooth, Math.sin(a) * 1.15, -.42, 1.2 + Math.cos(a) * 1.9); t.rotation.x = PI; }
  const jaw = new THREE.Group(); jaw.position.set(0, -.35, -.3); h.add(jaw); LEV.jaw = jaw;
  sk(new THREE.SphereGeometry(1.4, 18, 12), hm, 0, -.32, 1.9, .92, .36, 1.75, jaw); sk(new THREE.SphereGeometry(1.2, 14, 10), new THREE.MeshStandardMaterial({color: 0x3a0808, roughness: .2, emissive: 0x9a1010}), 0, -.05, 1.8, .85, .3, 1.6, jaw);
  for (let i = 0; i < 15; i++) { const a = -1.3 + i / 14 * 2.6; sk(new THREE.ConeGeometry(.1, .7 + Math.random() * .45, 5), tooth, Math.sin(a) * 1.05, .08, 1.95 + Math.cos(a) * 1.65, 1, 1, 1, jaw); }
  for (const s of [-1, 1]) { const fin = sk(new THREE.PlaneGeometry(2, .9), new THREE.MeshStandardMaterial({color: 0x101618, roughness: .4, side: THREE.DoubleSide, transparent: true, opacity: .85}), s * 1.7, -.7, -1.9); fin.rotation.set(0, s * 1.0, s * .5); LEV['fin' + s] = fin; }
  LEV.hide = () => { LEV.on = false; LEV.body.visible = LEV.spk.visible = LEV.dots.visible = LEV.head.visible = false; LEV.trail.length = 0; };
  LEV.hide();
}
const _lt = new THREE.Vector3(), _lu = new THREE.Vector3(), _ls = new THREE.Vector3(), _lp = new THREE.Vector3(), _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion();
const _lpts = [], _lc = new THREE.Vector3(), _lc2 = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3(), _lsc = new THREE.Vector3();
// place the serpent with its head at hp, the head looking along look (or along its path when look is null)
function levDraw(hp, jaw, look, t) {
  const {NS, NR, LEN} = LEV, tr = LEV.trail;
  if (!LEV.on) { LEV.on = true; LEV.body.visible = LEV.spk.visible = LEV.dots.visible = LEV.head.visible = true; tr.length = 0; }
  const last = tr[tr.length - 1]; if (!last || Math.hypot(hp.x - last[0], hp.y - last[1], hp.z - last[2]) > .45) { tr.push([hp.x, hp.y, hp.z]); if (tr.length > 260) tr.shift(); }
  // resample the path back from the head every LEN/(NS-1) metres; straight on past its end
  const sp = LEN / (NS - 1); let pi = tr.length - 1, px = hp.x, py = hp.y, pz = hp.z, rem = 0;
  let bx = 0, by = -.15, bz = -1; if (tr.length > 1) { const a = tr[tr.length - 1], b = tr[Math.max(0, tr.length - 6)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; bx = (b[0] - a[0]) / l; by = (b[1] - a[1]) / l; bz = (b[2] - a[2]) / l; }
  for (let i = 0; i < NS; i++) {
    let need = i ? sp : 0;
    while (need > 0) {
      if (pi > 0) { const q = tr[pi - 1], l = Math.hypot(q[0] - px, q[1] - py, q[2] - pz); if (l <= need) { need -= l; px = q[0]; py = q[1]; pz = q[2]; pi--; if (pi === 0) { const a = tr[0], b = tr[Math.min(tr.length - 1, 4)], ll = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) || 1; bx = (a[0] - b[0]) / ll; by = (a[1] - b[1]) / ll; bz = (a[2] - b[2]) / ll; } } else { const f = need / l; px += (q[0] - px) * f; py += (q[1] - py) * f; pz += (q[2] - pz) * f; need = 0; } }
      else { px += bx * need; py += by * need; pz += bz * need; py = Math.max(py, -40); need = 0; }
    }
    (_lpts[i] || (_lpts[i] = new THREE.Vector3())).set(px, py, pz);
  }
  const pos = LEV.body.geometry.attributes.position.array, nor = LEV.body.geometry.attributes.normal.array, dp = LEV.dots.geometry.attributes.position.array;
  let si = 0, di = 0;
  for (let i = 0; i < NS; i++) {
    const u = i / (NS - 1), r = levR(u), a = _lpts[Math.max(0, i - 1)], b = _lpts[Math.min(NS - 1, i + 1)];
    _lt.subVectors(a, b); if (_lt.lengthSq() < 1e-6) _lt.set(0, 0, 1); _lt.normalize();
    _lu.set(0, 1, 0).addScaledVector(_lt, -_lt.y); if (_lu.lengthSq() < .01) _lu.copy(LEV.U); _lu.normalize(); if (i === 0) LEV.U.copy(_lu); _ls.crossVectors(_lt, _lu);
    const wv = Math.sin(i * .32 - t * 2.6) * .45 * u; const c = _lc.copy(_lpts[i]).addScaledVector(_ls, wv);
    for (let j = 0; j < NR; j++) { const an = j / NR * TAU, ca = Math.cos(an), sa = Math.sin(an), k = (i * NR + j) * 3;
      pos[k] = c.x + (_lu.x * ca * .85 + _ls.x * sa) * r; pos[k + 1] = c.y + (_lu.y * ca * .85 + _ls.y * sa) * r; pos[k + 2] = c.z + (_lu.z * ca * .85 + _ls.z * sa) * r;
      nor[k] = _lu.x * ca + _ls.x * sa; nor[k + 1] = _lu.y * ca + _ls.y * sa; nor[k + 2] = _lu.z * ca + _ls.z * sa; }
    if (i >= 2 && i % 2 === 0 && si < 24) { const sz = Math.max(.25, 1.4 - si * .05); _ly.copy(_lu).addScaledVector(_lt, -.6).normalize(); _lz.crossVectors(_ls, _ly); _lm.makeBasis(_ls, _ly, _lz); _lq.setFromRotationMatrix(_lm);
      _lm.compose(_lc2.copy(c).addScaledVector(_lu, r * .8), _lq, _lsc.set(sz, sz, sz)); LEV.spk.setMatrixAt(si++, _lm); }
    if (i >= 1 && i < 33 && di < 64) for (const sd of [-1, 1]) { const an = PI * .62 * sd; dp[di * 3] = c.x + (_lu.x * Math.cos(an) * .85 + _ls.x * Math.sin(an)) * r * 1.03; dp[di * 3 + 1] = c.y + (_lu.y * Math.cos(an) * .85 + _ls.y * Math.sin(an)) * r * 1.03; dp[di * 3 + 2] = c.z + (_lu.z * Math.cos(an) * .85 + _ls.z * Math.sin(an)) * r * 1.03; di++; }
  }
  LEV.body.geometry.attributes.position.needsUpdate = LEV.body.geometry.attributes.normal.needsUpdate = true; LEV.body.geometry.computeBoundingSphere();
  LEV.spk.instanceMatrix.needsUpdate = true; LEV.dots.geometry.attributes.position.needsUpdate = true; LEV.dots.geometry.setDrawRange(0, di);
  // head: placed on the first ring, facing along the body or toward the target
  _lt.subVectors(_lpts[0], _lpts[2]).normalize(); if (look) _lt.lerp(look, look.w ?? 1).normalize();
  _lu.set(0, 1, 0).addScaledVector(_lt, -_lt.y); if (_lu.lengthSq() < .01) _lu.copy(LEV.U); _lu.normalize(); _ls.crossVectors(_lu, _lt);
  _lm.makeBasis(_ls, _lu, _lt); LEV.head.quaternion.setFromRotationMatrix(_lm); LEV.head.position.copy(_lpts[0]).addScaledVector(_lt, -.6);
  LEV.ht.copy(_lt); LEV.hp.copy(LEV.head.position).addScaledVector(_lt, 1.6);
  LEV.jaw.rotation.x = jaw * .85 + Math.sin(t * 13) * .03 * jaw;
  for (const s of [-1, 1]) { LEV['fin' + s].rotation.z = s * (.5 + Math.sin(t * 2.4) * .35); for (let i = 0; i < 3; i++) LEV['tn' + s + i].rotation.set(.5 + Math.sin(t * 1.7 + i) * .3, 0, s * Math.sin(t * 1.3 + i * 2) * .3); }
  const uw = cam.position.y < 0 ? 1 : 0; LEV.dots.material.opacity = clamp(TOD.night * .85 + (1 - TOD.day) * .3 + uw * .6, 0, 1);
}
// ---------------- wake behind the boat and spray
const WAKE = {n: 70, pts: [], mesh: null, acc: 0}, SPRAY = {n: 140, p: [], pts: null, i: 0};
function buildWake() {
  const n = WAKE.n, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
  const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } g.setIndex(idx);
  WAKE.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({map: FOAM.userData.mat.map, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide})); WAKE.mesh.frustumCulled = false; WAKE.mesh.renderOrder = 2; scene.add(WAKE.mesh);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY.n * 3).fill(-999), 3));
  SPRAY.pts = new THREE.Points(sg, new THREE.PointsMaterial({map: TX.glow, color: 0xdfeaf0, size: .55, transparent: true, depthWrite: false, opacity: .55})); SPRAY.pts.frustumCulled = false; scene.add(SPRAY.pts);
  for (let i = 0; i < SPRAY.n; i++) SPRAY.p.push({x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0});
}
function bubbles(x, y, z, n) { for (let k = 0; k < n; k++) { const p = SPRAY.p[SPRAY.i++ % SPRAY.n]; Object.assign(p, {x: x + (Math.random() - .5) * .4, y: y - Math.random() * .3, z: z + (Math.random() - .5) * .4, vx: (Math.random() - .5) * .3, vy: 1 + Math.random(), vz: (Math.random() - .5) * .3, b: 1}); } }
function spray(x, y, z, n, s, up = 1) { for (let k = 0; k < n; k++) { const p = SPRAY.p[SPRAY.i++ % SPRAY.n], a = Math.random() * TAU, v = s * (.4 + Math.random() * .6); Object.assign(p, {b: 0, x: x + (Math.random() - .5), y, z: z + (Math.random() - .5), vx: Math.cos(a) * v * .6, vy: (2 + Math.random() * 3) * up * s / 4, vz: Math.sin(a) * v * .6}); } }
function stepWake(dt) {
  if (!WAKE.mesh) return; const t = G.wt, v = Math.abs(B.v);
  WAKE.acc += dt; if (WAKE.acc > .12) { WAKE.acc = 0; const [x, z] = bL2W(0, 5.4); if (v > .8 && B.sink <= 0) WAKE.pts.unshift({x, z, a: 0, w: 1.2, k: clamp(v / 10, .2, 1), dx: Math.cos(B.yaw), dz: -Math.sin(B.yaw)}); if (WAKE.pts.length > WAKE.n) WAKE.pts.pop(); }
  const pa = WAKE.mesh.geometry.attributes.position.array, ca = WAKE.mesh.geometry.attributes.color.array, ua = WAKE.mesh.geometry.attributes.uv.array;
  for (let i = 0; i < WAKE.n; i++) { const p = WAKE.pts[i] || WAKE.pts[WAKE.pts.length - 1];
    if (!p) { ca.fill(0); break; }
    if (WAKE.pts[i]) { p.a += dt; p.w += dt * 1.6; }
    const al = WAKE.pts[i] ? Math.max(0, 1 - p.a / 8) * p.k * (.6 + .4 * TOD.day) : 0;
    for (const s of [0, 1]) { const sg = s ? 1 : -1, x = p.x + p.dx * p.w * sg, z = p.z + p.dz * p.w * sg, o = (i * 2 + s); pa[o * 3] = x; pa[o * 3 + 1] = waveH(x, z, t) + .06; pa[o * 3 + 2] = z; ca.set([1, 1, 1, al * (s ? .9 : .9)], o * 4); ua[o * 2] = s; ua[o * 2 + 1] = i * .25; }
  }
  WAKE.mesh.material.color.setRGB(mix(1, .3, TOD.night), mix(1, 1.8, TOD.night), mix(1, 1.6, TOD.night)); WAKE.mesh.material.blending = TOD.night > .5 ? THREE.AdditiveBlending : THREE.NormalBlending; SPRAY.pts.material.color.setRGB(mix(.87, .4, TOD.night), mix(.92, 1.4, TOD.night), mix(.94, 1.3, TOD.night));
  WAKE.mesh.geometry.attributes.position.needsUpdate = WAKE.mesh.geometry.attributes.color.needsUpdate = WAKE.mesh.geometry.attributes.uv.needsUpdate = true;
  // bow spray grows with speed and slamming into waves
  B.slam = (B.slam || 0) * Math.exp(-dt * 3); const dp = (B.pitch - (B.lp ?? B.pitch)) / Math.max(dt, 1e-3); B.lp = B.pitch;
  if (v > 5 && B.sink <= 0 && Math.random() < dt * (v / 3 + Math.max(0, -dp) * 4 + G.storm * 4)) { for (const s of [-1, 1]) { const [x, z] = bL2W(s * 1.3, -5.6); spray(x, waveH(x, z, t) + .3, z, 3 + (v > 9 ? 3 : 0), v * .35); } }
  const sa = SPRAY.pts.geometry.attributes.position.array;
  for (let i = 0; i < SPRAY.n; i++) { const p = SPRAY.p[i]; if (p.y < -900) { sa[i * 3 + 1] = -999; continue; } if (p.b) { p.vy = Math.min(p.vy + dt, 2.2); p.x += p.vx * dt + Math.sin(t * 9 + i) * dt * .2; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y > waveH(p.x, p.z, t)) p.y = -999; } else { p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < waveH(p.x, p.z, t) - .3) p.y = -999; } sa[i * 3] = p.x; sa[i * 3 + 1] = p.y; sa[i * 3 + 2] = p.z; }
  SPRAY.pts.geometry.attributes.position.needsUpdate = true; SPRAY.pts.material.opacity = .25 + .25 * TOD.day;
}
// ---------------- client side of the deep: draw it from the encounter state
const _lo = {}, _lk = new THREE.Vector4();
function stepLev(dt) {
  if (!LEV.body) return; const t = G.wt;
  const mw = G.maw, s = G.spines;
  if (mw) {
    mw.t += dt; const u = clamp(mw.t / 4.2, 0, 1), y = mix(-48, -4, u * u);
    _lp.set(mw.x, y, mw.z + Math.sin(t) * .5); _lk.set(0, 1, 0, 1); levDraw(_lp, clamp(u * 1.4 - .3, 0, 1) * (mw.bite ? Math.max(0, 1 - (mw.t - mw.bite) * 4) : 1), _lk, t);
    if (mw.t > 9) { G.maw = null; LEV.hide(); } return;
  }
  if (!s) { if (LEV.on) LEV.hide(); return; }
  s.t += dt;
  if (s.leave != null) { const u = s.t - s.leave; s.lx = s.lx ?? LEV.hp.x; s.lz = s.lz ?? LEV.hp.z; s.ly = (s.ly ?? Math.min(LEV.hp.y, -1)) - dt * (4 + u * 6); _lp.set(s.lx += LEV.ht.x * dt * 8, s.ly, s.lz += LEV.ht.z * dt * 8); levDraw(_lp, .1, null, t); if (u > 4) { G.spines = null; LEV.hide(); } return; }
  const o = levPose(s.a, s.t, s.L || 9, _lo); _lp.set(o.x, o.y, o.z);
  let look = null; if (o.ph === 1) { _lk.set(B.x - o.x, B.heave + 1 - o.y * 1.6 - 4, B.z - o.z, clamp(o.u * 2.2, 0, 1)); const l = Math.hypot(_lk.x, _lk.y, _lk.z); _lk.x /= l; _lk.y /= l; _lk.z /= l; look = _lk; }
  levDraw(_lp, o.jaw, look, t);
  if (o.ph !== s.ph) { s.ph = o.ph;
    if (o.ph === 1) { Snd.roar(at(o.x, 2, o.z, 30)); G.shake = Math.max(G.shake || 0, .8); spray(o.x, .2, o.z, 40, 7); G.cine = 2.4; }
    if (o.ph === 2) { Snd.splash(at(o.x, 0, o.z, 20)); } }
  if (o.ph === 1 && o.u > .82 && !s.sp2) { s.sp2 = 1; spray(o.x, .2, o.z, 30, 6); }
  if (o.ph === 0 && Math.random() < dt * 6) { const k = 3 + (Math.random() * 18 | 0); if (_lpts[k] && _lpts[k].y > -3) spray(_lpts[k].x, .1, _lpts[k].z, 2, 2.5, .6); }
  if (o.ph === 3 && o.u > 4) { G.spines = null; LEV.hide(); }
}
// ---------------- the derelict MS Serenade, far to the north. Two decks you can explore, and the Steward.
const CRZ = {x: -250, z: 2350, D1: 9, D2: 13}, CN = [], CWL = [];
const inCruise = (x, z, y = 99) => Math.abs(x - CRZ.x) < 15 && z > CRZ.z - 68 && z < CRZ.z + 62 && y > 6;
function buildCruise() {
  const X = CRZ.x, Z = CRZ.z, D1 = CRZ.D1, D2 = CRZ.D2, w0 = WALLS.length;
  // hull: plan shape extruded, dirty white topsides over a rusted lower hull (caps hidden so the deck shows)
  const sh = new THREE.Shape(); sh.moveTo(-14, 60); sh.lineTo(14, 60); sh.lineTo(14, -28); sh.quadraticCurveTo(12, -58, 0, -68); sh.quadraticCurveTo(-12, -58, -14, -28); sh.closePath();
  const hull = (y0, y1, m) => { const g = new THREE.ExtrudeGeometry(sh, {depth: y1 - y0, bevelEnabled: false}); g.rotateX(PI / 2); g.translate(X, y1, Z); const o = new THREE.Mesh(g, [new THREE.MeshBasicMaterial({visible: false}), m]); o.receiveShadow = true; o.castShadow = true; scene.add(o); };
  hull(-8, 2.5, new THREE.MeshStandardMaterial({map: TX.rustH, color: 0x5a3a30, roughness: .8, metalness: .3, side: THREE.DoubleSide}));
  hull(2.5, D1 + 1.1, new THREE.MeshStandardMaterial({color: 0xb8b4aa, roughness: .6, metalness: .05, side: THREE.DoubleSide}));
  for (let i = 0; i < 3; i++) { const g = new THREE.BoxGeometry(18 - i * 3, 2.6, 30 - i * 5); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: 0xa8a49a, roughness: .7})); m.position.set(X, D2 + 13.3 + i * 2.6, Z - 25.5); m.castShadow = true; scene.add(m); for (const sx of [-1, 1]) wbox('dark', X + sx * (9 - i * 1.5 + .02), D2 + 13.5 + i * 2.6, Z - 25.5, .04, .7, 28 - i * 5); }
  for (let i = 0; i < 26; i++) { const z = Z - 24 + i * 3.2; for (const sx of [-1, 1]) wbox('dark', X + sx * 14.05, 6.4, z, .05, .5, .5); }
  // deck 1 (main), with a narrowing bow
  slab(X - 13.6, X + 13.6, Z - 28, Z + 59.5, D1, 'planks'); slab(X - 11.5, X + 11.5, Z - 46, Z - 28, D1, 'planks'); slab(X - 7, X + 7, Z - 60, Z - 46, D1, 'planks');
  for (const sx of [-1, 1]) { rail(X + sx * 13.6 - .05, X + sx * 13.6 + .05, Z - 28, Z + 59.5, D1, 'white'); rail(X + sx * 11.5 - .05, X + sx * 11.5 + .05, Z - 46, Z - 28, D1, 'white'); rail(X + sx * 7 - .05, X + sx * 7 + .05, Z - 60, Z - 46, D1, 'white'); }
  rail(X - 13.6, X - 1.1, Z + 59.4, Z + 59.6, D1, 'white'); rail(X + 1.1, X + 13.6, Z + 59.4, Z + 59.6, D1, 'white'); rail(X - 7, X + 7, Z - 60.1, Z - 59.9, D1, 'white');
  rail(X - 13.6, X - 11.5, Z - 28.1, Z - 27.9, D1, 'white'); rail(X + 11.5, X + 13.6, Z - 28.1, Z - 27.9, D1, 'white'); rail(X - 11.5, X - 7, Z - 46.1, Z - 45.9, D1, 'white'); rail(X + 7, X + 11.5, Z - 46.1, Z - 45.9, D1, 'white');
  // superstructure shell on deck 1: x -10..10, z -45..45, doors fore and aft only
  const sw = (x0, x1, z0, z1, k = 'white') => { bx(k, x0, x1, D1, D2 - .3, z0, z1); WALLS.push({x0, x1, z0, z1, y0: D1, y1: D2, see: true}); };
  for (const sx of [-1, 1]) sw(X + (sx < 0 ? -10.2 : 10), X + (sx < 0 ? -10 : 10.2), Z - 45, Z + 45);
  sw(X - 10, X - 1.1, Z - 45.2, Z - 45); sw(X + 1.1, X + 10, Z - 45.2, Z - 45); sw(X - 10, X - 1.1, Z + 45, Z + 45.2); sw(X + 1.1, X + 10, Z + 45, Z + 45.2);
  bx('white', X - 1.1, X + 1.1, D1 + 2.3, D2 - .3, Z - 45.2, Z - 45); bx('white', X - 1.1, X + 1.1, D1 + 2.3, D2 - .3, Z + 45, Z + 45.2);
  for (let i = 0; i < 18; i++) for (const sx of [-1, 1]) wbox('glass', X + sx * 10.22, D1 + 2, Z - 42 + i * 5, .04, .8, 1.6);
  // twelve staterooms off a carpeted corridor; the one nearest the bow is the captain's
  bx('carpet', X - 1.4, X + 1.4, D1, D1 + .02, Z - 45, Z - 8);
  for (let i = 0; i < 6; i++) { const z = Z - 41.9 + i * 5.6; const a = building('state', i === 0 ? "Captain's quarters" : 'Stateroom ' + (101 + i * 2), X - 5.7, z, D1, 'e'); a.cruise = 1; if (i === 0) a.capt = 1; const b = building('state', 'Stateroom ' + (102 + i * 2), X + 5.7, z, D1, 'w'); b.cruise = 1; }
  // atrium: open two decks, twin grand staircases up to deck 2
  bx('carpet', X - 10, X + 10, D1, D1 + .02, Z - 8, Z + 45);
  for (const sx of [-1, 1]) ramp(X + sx * 8.6 - 1, X + sx * 8.6 + 1, Z - 8, Z + 8, D1, D2, 'z+', 'carpet');
  wbox('brass', X, D1 + 3.6, Z, .1, 1.2, .1); { const ch = new THREE.Mesh(new THREE.TorusGeometry(1.4, .08, 6, 24), new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3})); ch.rotation.x = PI / 2.3; ch.position.set(X + .6, D1 + .3, Z + 1); scene.add(ch); }
  // ballroom: tables, a grand piano, the stage with the music box
  for (let i = 0; i < 8; i++) { const tx = X + (i % 2 ? 4.5 : -4.5), tz = Z + 14 + Math.floor(i / 2) * 6; wbox('wood', tx, D1 + .75, tz, 1.6, .06, 1.6); wbox('dark', tx, D1 + .38, tz, .12, .75, .12); WALLS.push({x0: tx - .8, x1: tx + .8, z0: tz - .8, z1: tz + .8, y0: D1, y1: D1 + .8, see: false}); spot('cruise', tx + .3, D1 + .8, tz - .2); for (const c of [-1, 1]) wbox('red', tx + c * 1.1, D1 + .45, tz, .45, .9, .45, .4 * c); }
  wbox('dark', X, D1 + .5, Z + 39, 8, 1, 4); WALLS.push({x0: X - 4, x1: X + 4, z0: Z + 37, z1: Z + 41, y0: D1, y1: D1 + 1, see: false});
  wbox('dark', X - 2.5, D1 + 1.5, Z + 38.5, 2.2, .5, 1.5); wbox('wood', X + 2.2, D1 + 1.15, Z + 38.5, .3, .3, .3); spot('cruise', X + 2.6, D1 + 1, Z + 37.5); CRZ.box = [X + 2.2, D1 + 1.3, Z + 38.5];
  // deck 2: open lido deck around a hole over the atrium, a tower, the pool and the funnel
  slab(X - 12, X + 12, Z - 46, Z - 8, D2, 'planks'); slab(X - 12, X + 12, Z + 8, Z + 48, D2, 'planks'); slab(X - 12, X - 10, Z - 8, Z + 8, D2, 'planks'); slab(X + 10, X + 12, Z - 8, Z + 8, D2, 'planks');
  rail(X - 10, X - 9.6, Z - 8.1, Z - 7.9, D2, 'white'); rail(X - 7.6, X + 7.6, Z - 8.1, Z - 7.9, D2, 'white'); rail(X + 9.6, X + 10, Z - 8.1, Z - 7.9, D2, 'white'); rail(X - 7.6, X + 7.6, Z + 7.9, Z + 8.1, D2, 'white');
  for (const sx of [-1, 1]) { rail(X + sx * 10 - .05, X + sx * 10 + .05, Z - 8, Z + 8, D2, 'white'); rail(X + sx * 12 - .05, X + sx * 12 + .05, Z - 46, Z + 48, D2, 'white'); }
  rail(X - 12, X + 12, Z + 47.9, Z + 48.1, D2, 'white');
  const tw = (x0, x1, z0, z1, y1, k = 'white') => { bx(k, x0, x1, D2, y1, z0, z1); WALLS.push({x0, x1, z0, z1, y0: D2, y1, see: true}); };
  tw(X - 7, X + 7, Z - 37, Z - 14, D2 + 12); for (let r = 0; r < 4; r++) for (const sx of [-1, 1]) wbox('glass', X + sx * 7.02, D2 + 1.8 + r * 2.8, Z - 25.5, .04, .9, 21);
  tw(X - 3.5, X + 3.5, Z + 36, Z + 44, D2 + 15, 'red'); bx('dark', X - 3.6, X + 3.6, D2 + 13, D2 + 15.2, Z + 35.9, Z + 44.1);
  bx('dark', X - 5, X + 5, D2 - .9, D2 + .02, Z + 16, Z + 30); for (const [x0, x1, z0, z1] of [[-5.2, 5.2, 15.8, 16], [-5.2, 5.2, 30, 30.2], [-5.2, -5, 16, 30], [5, 5.2, 16, 30]]) { bx('white', X + x0, X + x1, D2, D2 + .5, Z + z0, Z + z1); WALLS.push({x0: X + x0, x1: X + x1, z0: Z + z0, z1: Z + z1, y0: D2, y1: D2 + 1, see: false}); }
  WALLS.push({x0: X - 5, x1: X + 5, z0: Z + 16, z1: Z + 30, y0: D2, y1: D2 + 1, see: false});
  { const w = new THREE.Mesh(new THREE.PlaneGeometry(10, 14), new THREE.MeshStandardMaterial({color: 0x1a2a10, roughness: .1})); w.rotation.x = -PI / 2; w.position.set(X, D2 - .5, Z + 23); scene.add(w); }
  for (let i = 0; i < 10; i++) { const x = X + (i % 2 ? 7.8 : -7.8), z = Z + 12 + Math.floor(i / 2) * 4.5; wbox('white', x, D2 + .3, z, .7, .1, 1.8, (i % 3) * .3); }
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const z = Z - 34 + i * 6; wbox('orange', X + sx * 12.9, D2 + 2.2, z, 1.3, 1.1, 4.5); wbox('steel', X + sx * 12.2, D2 + 2.9, z - 1.5, .15, .15, .15); }
  const br = building('bridge', 'Bridge', X, Z - 43, D2, 'n'); br.cruise = 1; CRZ.bridge = br;
  spot('key', X - 5.7 - 1.5, D1 + .8, Z - 41.9 + 1);
  // the way up from the sea
  for (let y = -1.2; y < D1; y += .35) wbox('yellow', X, y, Z + 60.4, .6, .05, .05);
  INTER.push({kind: 'ladder', x: X, y: 0, z: Z + 61, r: 3.5, top: [X, D1, Z + 58.2], label: () => 'Climb the boarding ladder', on: () => P.sw});
  POIS.push({n: 'MS Serenade', x: X, z: Z, r: 90, cruise: 1});
  OBST.push({c: 1, x: X, z: Z - 40, r: 20}, {c: 1, x: X, z: Z - 5, r: 15}, {c: 1, x: X, z: Z + 25, r: 15}, {c: 1, x: X, z: Z + 50, r: 13});
  for (let i = 0; i < 9; i++) CRZ.reds = (CRZ.reds || []).concat([[X + (i % 3 - 1) * 6, (i < 6 ? D1 : D2) + 3, Z - 40 + i * 10]]);
  for (let i = w0; i < WALLS.length; i++) CWL.push(WALLS[i]);
  // nav nodes for the Steward: a 2.5 m grid on both decks and the stairs, joined where nothing is in the way
  const key = new Set();
  for (const py of [D1 + .6, D2 + .6]) for (let x = -12; x <= 12; x += 2.5) for (let z = -58; z <= 58; z += 2.5) {
    const wx = X + x, wz = Z + z, f = floorAt(wx, wz, py, true); if (!f || f.y < py - 2) continue;
    if (CWL.some(w => wx > w.x0 - .15 && wx < w.x1 + .15 && wz > w.z0 - .15 && wz < w.z1 + .15 && w.y0 < f.y + 1.6 && w.y1 > f.y + .2)) continue;
    const k = x + ',' + z + ',' + Math.round(f.y); if (key.has(k)) continue; key.add(k); CN.push({x: wx, y: f.y, z: wz, nb: []}); }
  for (const sx of [-1, 1]) for (let z = -9.2; z <= 9.3; z += 1.6) { const y = z < -8 ? D1 : z > 8 ? D2 : mix(D1, D2, (z + 8) / 16); CN.push({x: X + sx * 8.6, y, z: Z + z, nb: [], st: 1}); }
  for (let i = 0; i < CN.length; i++) for (let j = i + 1; j < CN.length; j++) { const a = CN[i], b = CN[j]; if (Math.abs(a.y - b.y) > 1.3 || Math.abs(a.x - b.x) > 2.6 || Math.abs(a.z - b.z) > 2.6) continue;
    if ((a.st || b.st) && !(a.st && b.st) && Math.abs(a.y - b.y) > .35) continue;
    const y = Math.max(a.y, b.y) + 1; if (CWL.some(w => !(w.y1 < y - .7 || w.y0 > y + .5) && segRect(a.x, a.z, b.x, b.z, {x0: w.x0 - .25, x1: w.x1 + .25, z0: w.z0 - .25, z1: w.z1 + .25}))) continue; a.nb.push(j); b.nb.push(i); }
  { const r0 = cNear(X, D1, Z + 20), seen = new Set([r0]), q = [r0]; while (q.length) { const c = q.pop(); for (const k of CN[c].nb) if (!seen.has(k)) { seen.add(k); q.push(k); } } CN.forEach((n, i) => { if (!seen.has(i)) n.nb = []; }); CN.ok = [...seen]; }
}
function cNear(x, y, z) { let b = -1, bd = 1e9; for (let i = 0; i < CN.length; i++) { const n = CN[i], d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3; if (d < bd && n.nb.length) { bd = d; b = i; } } return b; }
function cPath(a, b) {
  if (a < 0 || b < 0) return null; const g = new Map([[a, 0]]), from = new Map(), open = [a], h = i => Math.hypot(CN[i].x - CN[b].x, CN[i].z - CN[b].z) + Math.abs(CN[i].y - CN[b].y);
  let it = 0; while (open.length && it++ < 3000) { let bi = 0; for (let k = 1; k < open.length; k++) if (g.get(open[k]) + h(open[k]) < g.get(open[bi]) + h(open[bi])) bi = k; const c = open.splice(bi, 1)[0];
    if (c === b) { const p = [c]; let q = c; while (from.has(q)) { q = from.get(q); p.unshift(q); } return p.map(i => [CN[i].x, CN[i].y, CN[i].z]); }
    for (const n of CN[c].nb) { const ng = g.get(c) + Math.hypot(CN[n].x - CN[c].x, CN[n].z - CN[c].z) + Math.abs(CN[n].y - CN[c].y); if (!g.has(n) || ng < g.get(n)) { g.set(n, ng); from.set(n, c); if (!open.includes(n)) open.push(n); } } }
  return null;
}
// the Steward: host brain
const STW = new THREE.Group(), SJ = {fing: []};
const STS = {x: CRZ.x, y: CRZ.D1, z: CRZ.z + 30, yaw: 0, state: 'roam', spd: 0, path: [], hp: 300, idle: 2, rep: 0, aware: 0, ph: 0};
function stwGo(x, y, z) { const p = cPath(cNear(STS.x, STS.y, STS.z), cNear(x, y, z)); STS.path = p ? p.slice(1) : []; STS.goal = [x, y, z]; }
function stwDown(p) { if (p.down || p.dead) return; p.down = true; p.bleed = D.bleed; p.hd = -1; p.seat = 0; if (B.driver === p.id) B.driver = null; dropCarry(p); STS.yaw = Math.atan2(-(p.x - STS.x), -(p.z - STS.z)); emit({k: 'down', id: p.id, how: 'caught', st: 1}); STS.state = 'flee'; STS.flee = 7; const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; if (n) stwGo(n.x, n.y, n.z); }
function stwHear(x, y, z, r) { if (!inCruise(x, z, y) || ['chase', 'flee', 'dead', 'gone'].includes(STS.state)) return; if (Math.hypot(x - STS.x, z - STS.z) + Math.abs(y - STS.y) * 2 > r * 1.4) return; STS.state = 'inv'; STS.idle = 0; stwGo(x, y, z); }
function stepSteward(dt) {
  const S = STS; if (!CN.length) return;
  const near = alive().some(p => Math.hypot(p.x - CRZ.x, p.z - CRZ.z) < 260); if (!near && S.state !== 'gone') { S.spd = 0; return; }
  if (S.state === 'dead') { S.spd = 0; S.deadT -= dt; if (S.deadT <= 0) { S.state = 'gone'; S.goneT = 150; } return; }
  if (S.state === 'gone') { S.goneT -= dt; if (S.goneT <= 0) { const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; Object.assign(S, {x: n.x, y: n.y, z: n.z, state: 'roam', hp: 300, path: []}); } return; }
  const ps = alive().filter(p => inCruise(p.x, p.z, p.y) && !p.sw);
  for (const p of PL.values()) if (p.eq === 5 && !p.down && !p.dead && Math.hypot(p.x - S.x, p.z - S.z) < 6.5 && Math.abs(p.y - S.y) < 3 && S.state !== 'flee') { S.state = 'flee'; S.flee = 5; const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; stwGo(n.x, n.y, n.z); emit({k: 'snd', s: 'shriekS'}); }
  for (const fl of G.flares) if (fl.t > 0 && Math.hypot(fl.x - S.x, fl.z - S.z) < 9 && Math.abs(fl.y - S.y) < 4 && S.state !== 'flee') { S.state = 'flee'; S.flee = 6; const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; stwGo(n.x, n.y, n.z); }
  // senses
  S.senseT = (S.senseT || 0) - dt; if (S.senseT <= 0) { S.senseT = .15; S.see = null; let bd = 1e9;
    for (const p of ps) { if (p.hd >= 0) continue; const d = Math.hypot(p.x - S.x, p.z - S.z) + Math.abs(p.y - S.y); const rng = p.l ? 30 : p.cr ? 8 : p.run ? 22 : 14; if (d > rng || d > bd) continue;
      const fa = Math.atan2(-(p.x - S.x), -(p.z - S.z)); if (d > 4 && Math.abs(angD(S.yaw, fa)) > 1.4 && !p.l) continue; if (!seeLine(S.x, S.y + 1.2, S.z, p.x, p.y, p.z)) continue; bd = d; S.see = p; } }
  let speed = 1.5 + TOD.night * .3;
  if (S.see && S.state !== 'flee') { if (S.state !== 'chase') { S.state = 'chase'; emit({k: 'snd', s: 'stwSee'}); } S.tgt = S.see.id; S.lx = S.see.x; S.ly = S.see.y; S.lz = S.see.z; S.lost = 0; S.sawHide = -1; }
  const tgt = S.tgt && PL.get(S.tgt);
  if (S.state === 'chase') {
    speed = 4.6 + TOD.night * .6;
    if (!tgt || tgt.down || tgt.dead || !inCruise(tgt.x, tgt.z, tgt.y) || tgt.sw) { S.state = 'search'; S.idle = 6; stwGo(S.lx, S.ly, S.lz); }
    else if (tgt.hd >= 0) { if (S.sawHide === tgt.hd || (S.see === tgt)) { const h = HIDES[tgt.hd]; S.sawHide = tgt.hd; if (Math.hypot(S.x - h.ex, S.z - h.ez) < 1.3) { emit({k: 'snd', s: 'creak'}); stwDown(tgt); } else { S.rep -= dt; if (S.rep <= 0) { S.rep = .5; stwGo(h.ex, h.y, h.ez); } } } else { S.state = 'search'; S.idle = 8; stwGo(S.lx, S.ly, S.lz); } }
    else { if (!S.see) { S.lost += dt; if (S.lost > 4) { S.state = 'search'; S.idle = 8; } }
      S.rep -= dt; if (S.rep <= 0) { S.rep = .45; if (S.see && Math.abs(tgt.y - S.y) < 1 && Math.hypot(tgt.x - S.x, tgt.z - S.z) < 9) S.path = [[tgt.x, tgt.y, tgt.z]]; else stwGo(S.lx, S.ly, S.lz); }
      if (Math.hypot(tgt.x - S.x, tgt.z - S.z) < 1.4 && Math.abs(tgt.y - S.y) < 1.5) stwDown(tgt); }
  } else if (S.state === 'flee') { speed = 5; S.flee -= dt; if (S.flee <= 0) { S.state = 'roam'; S.idle = 3; } }
  else if (S.state === 'search' || S.state === 'inv') { speed = 2.6; if (!S.path.length) { S.idle -= dt; if (S.idle <= 0) S.state = 'roam'; } }
  else { if (!S.path.length) { S.idle -= dt; if (S.idle <= 0) { S.idle = 2 + CR() * 5; const pr = ps[Math.floor(CR() * ps.length)]; const n = pr && CR() < .55 ? CN[cNear(pr.x + (CR() - .5) * 16, pr.y, pr.z + (CR() - .5) * 16)] : CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; if (n) stwGo(n.x, n.y, n.z); } } }
  // move along the path
  while (S.path.length && Math.hypot(S.path[0][0] - S.x, S.path[0][2] - S.z) < .45) S.path.shift();
  if (!S.path.length) S.spd = mix(S.spd, 0, dt * 6);
  else { const [wx, wy, wz] = S.path[0], dx = wx - S.x, dz = wz - S.z, d = Math.hypot(dx, dz) || 1, want = Math.atan2(-dx, -dz); S.yaw += clamp(angD(S.yaw, want), -dt * 6, dt * 6); S.spd = mix(S.spd, speed * (1 - Math.min(.6, Math.abs(angD(S.yaw, want)) / PI)), dt * 3);
    const st = Math.min(d, S.spd * dt); S.x += dx / d * st; S.z += dz / d * st; const f = floorAt(S.x, S.z, S.y + .9, true); if (f) S.y = mix(S.y, f.y, Math.min(1, dt * 10)); }
  S.stepAcc = (S.stepAcc || 0) + S.spd * dt; if (S.stepAcc > 1.6) { S.stepAcc = 0; emit({k: 'sstep'}); }
}
// ---------------- deep dive sites, and the gulpers that hunt divers in the dark
const DSITES = [
  {n: 'The Abyssal Trench', x: -1500, z: -950, r: 170, d: 125},
  {n: 'Wreck of the Aurelia', x: 700, z: 1750, r: 110, d: 72, liner: 1},
  {n: 'The Drowned Garden', x: 2000, z: -1300, r: 130, d: 58, kelp: 1},
];
const SUIT = [{n: 'no suit', max: 4, air: 22}, {n: 'Scuba gear', max: 45, air: 180}, {n: 'Saturation suit', max: 160, air: 540}];
let DEEPG = null;
function buildDeep() {
  // things that only show underwater: the sunken liner and the kelp forest
  DEEPG = new THREE.Group(); DEEPG.visible = false; scene.add(DEEPG);
  const rm = new THREE.MeshStandardMaterial({map: TX.rustH, color: 0x5a4a40, roughness: .9, metalness: .2, side: THREE.DoubleSide});
  for (const s of DSITES) {
    POIS.push({n: s.n, x: s.x, z: s.z, r: s.r, dive: s});
    if (s.liner) { const sh = new THREE.Shape(); sh.moveTo(-10, 45); sh.lineTo(10, 45); sh.lineTo(10, -20); sh.quadraticCurveTo(8, -40, 0, -48); sh.quadraticCurveTo(-8, -40, -10, -20); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, {depth: 14, bevelEnabled: false}); g.rotateX(PI / 2); const m = new THREE.Mesh(g, rm); const y = seaBed(s.x, s.z); m.position.set(s.x, y + 9, s.z); m.rotation.set(.12, .7, .38); DEEPG.add(m);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(16 - i * 3, 3, 30 - i * 6), rm); b.position.set(0, -14 + 3 * i, 0); b.position.applyEuler(m.rotation).add(m.position); b.position.y = m.position.y + 1.5 + i * 2.6; b.rotation.copy(m.rotation); DEEPG.add(b); }
      const fn = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 9, 14), rm); fn.position.set(s.x + 6, y + 6, s.z - 4); fn.rotation.set(.3, 0, 1.2); DEEPG.add(fn); }
    if (s.kelp) { const kg = new THREE.PlaneGeometry(.8, 14, 1, 6); kg.translate(0, 7, 0); const km = new THREE.MeshStandardMaterial({color: 0x2a4a1a, roughness: .8, side: THREE.DoubleSide}); const im = new THREE.InstancedMesh(kg, km, 260), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
      for (let i = 0; i < 260; i++) { const a = R() * TAU, r = Math.sqrt(R()) * s.r, x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r; E.set((R() - .5) * .2, R() * TAU, (R() - .5) * .2); M4.compose(_v.set(x, seaBed(x, z), z), Q.setFromEuler(E), _s.set(1 + R(), .6 + R() * 1.2, 1)); im.setMatrixAt(i, M4); }
      im.frustumCulled = false; DEEPG.add(im); }
  }
}
// gulper: long pale eel body, a jaw full of needles, and a glowing lure in front of its face
const GUL = [], GN = 5;
function gulMesh() {
  const NS = 16, NR = 8, n = NS * NR, g = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR; idx.push(a, a + NR, b, b, a + NR, b + NR); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setIndex(idx);
  const body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: 0x4a3c40, roughness: .35, side: THREE.DoubleSide})); body.frustumCulled = false; scene.add(body);
  const h = new THREE.Group(); scene.add(h); const hm = new THREE.MeshStandardMaterial({color: 0x3a2e32, roughness: .35}), tm = new THREE.MeshStandardMaterial({color: 0xd8d0c0, roughness: .2});
  const sk = new THREE.Mesh(new THREE.SphereGeometry(.75, 14, 10), hm); sk.scale.set(1, .8, 1.3); sk.position.z = .3; h.add(sk);
  const jaw = new THREE.Group(); jaw.position.set(0, -.25, -.3); h.add(jaw); const jm = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 8), hm); jm.scale.set(1.05, .35, 1.5); jm.position.set(0, -.2, .6); jaw.add(jm);
  for (let i = 0; i < 14; i++) { const a = -1.3 + i / 13 * 2.6; const t = new THREE.Mesh(new THREE.ConeGeometry(.035, .5 + Math.random() * .4, 4), tm); t.position.set(Math.sin(a) * .62, .05, .6 + Math.cos(a) * .9); jaw.add(t);
    const u = new THREE.Mesh(new THREE.ConeGeometry(.03, .4 + Math.random() * .3, 4), tm); u.rotation.x = PI; u.position.set(Math.sin(a) * .66, -.25, .3 + Math.cos(a) * .95); h.add(u); }
  const inner = new THREE.Mesh(new THREE.SphereGeometry(.55, 10, 8), new THREE.MeshBasicMaterial({color: 0x0a0204})); inner.scale.set(1, .5, 1.3); inner.position.set(0, -.35, .5); h.add(inner);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(.9, .95, .85)})); e.position.set(sx * .5, .35, .75); h.add(e); }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, 1.6, 5), hm); st.geometry.translate(0, .8, 0); st.position.set(0, .5, .6); st.rotation.x = .9; h.add(st);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(2, 6, 5)})); bulb.position.set(0, .5 + Math.cos(.9) * 1.6, .6 + Math.sin(.9) * 1.6); h.add(bulb);
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x60ffe0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9})); gl.scale.setScalar(3); gl.position.copy(bulb.position); h.add(gl);
  return {body, h, jaw, bulb, gl, trail: [], NS, NR};
}
const _gp = [], _gt = new THREE.Vector3(), _gu = new THREE.Vector3(), _gs = new THREE.Vector3(), _gm = new THREE.Matrix4();
function gulDraw(o, x, y, z, yaw, pitch, jaw, t) {
  const tr = o.trail, LEN = 7, sp = LEN / (o.NS - 1); const last = tr[tr.length - 1]; if (!last || Math.hypot(x - last[0], y - last[1], z - last[2]) > .25) { tr.push([x, y, z]); if (tr.length > 80) tr.shift(); }
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  let pi = tr.length - 1, px = x, py = y, pz = z;
  for (let i = 0; i < o.NS; i++) { let need = i ? sp : 0; while (need > 0) { if (pi > 0) { const q = tr[pi - 1], l = Math.hypot(q[0] - px, q[1] - py, q[2] - pz); if (l <= need) { need -= l; px = q[0]; py = q[1]; pz = q[2]; pi--; } else { const f = need / l; px += (q[0] - px) * f; py += (q[1] - py) * f; pz += (q[2] - pz) * f; need = 0; } } else { px -= fx * need; py -= fy * need; pz -= fz * need; need = 0; } }
    (_gp[i] || (_gp[i] = new THREE.Vector3())).set(px, py, pz); }
  const pos = o.body.geometry.attributes.position.array, nor = o.body.geometry.attributes.normal.array;
  for (let i = 0; i < o.NS; i++) { const u = i / (o.NS - 1), r = (u < .1 ? .55 + u * 2 : .75 * Math.pow(1 - (u - .1) / .9, 1.2) + .03), a = _gp[Math.max(0, i - 1)], b = _gp[Math.min(o.NS - 1, i + 1)];
    _gt.subVectors(a, b); if (_gt.lengthSq() < 1e-6) _gt.set(fx, fy, fz); _gt.normalize(); _gu.set(0, 1, 0).addScaledVector(_gt, -_gt.y).normalize(); _gs.crossVectors(_gt, _gu);
    const wv = Math.sin(i * .6 - t * 6) * .35 * u, cx = _gp[i].x + _gs.x * wv, cy = _gp[i].y + _gs.y * wv, cz = _gp[i].z + _gs.z * wv;
    for (let j = 0; j < o.NR; j++) { const an = j / o.NR * TAU, ca = Math.cos(an), sa = Math.sin(an), k = (i * o.NR + j) * 3; nor[k] = _gu.x * ca + _gs.x * sa; nor[k + 1] = _gu.y * ca + _gs.y * sa; nor[k + 2] = _gu.z * ca + _gs.z * sa; pos[k] = cx + nor[k] * r; pos[k + 1] = cy + nor[k + 1] * r * .8; pos[k + 2] = cz + nor[k + 2] * r; } }
  o.body.geometry.attributes.position.needsUpdate = o.body.geometry.attributes.normal.needsUpdate = true;
  _gt.set(fx, fy, fz); _gu.set(0, 1, 0).addScaledVector(_gt, -_gt.y).normalize(); _gs.crossVectors(_gu, _gt); _gm.makeBasis(_gs, _gu, _gt); o.h.quaternion.setFromRotationMatrix(_gm); o.h.position.set(x, y, z).addScaledVector(_gt, .4);
  o.jaw.rotation.x = jaw; const pl = .8 + Math.sin(t * 3 + x) * .2; o.gl.material.opacity = pl; o.bulb.scale.setScalar(.9 + pl * .2);
}
// host brain
function stepGulpers(dt) {
  const divers = alive().filter(p => p.sw && (p.dv || 0) > 5);
  G.gulT = (G.gulT ?? 4) - dt;
  if (G.gulT <= 0) { G.gulT = 5; const on = GUL.filter(g => g.on).length; const p = divers[Math.floor(CR() * divers.length)];
    if (p && on < Math.min(GN, 1 + Math.floor(p.dv / 25))) { const a = CR() * TAU, r = 38 + CR() * 14, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, bed = seaBed(x, z);
      if (bed < -12) { let g = GUL.find(q => !q.on); if (!g) { g = {}; GUL.push(g); } Object.assign(g, {on: 1, x, z, y: clamp(-p.dv + (CR() - .5) * 8, bed + 2, -4), yaw: CR() * TAU, pitch: 0, st: 0, t: 0, tgt: null, vx: 0, vy: 0, vz: 0}); } } }
  for (const g of GUL) { if (!g.on) continue; g.t += dt;
    let best = null, bd = 1e9; for (const p of divers) { const d = Math.hypot(p.x - g.x, -p.dv - g.y, p.z - g.z); if (d < bd) { bd = d; best = p; } }
    if (!best || bd > 130) { g.on = 0; continue; }
    const scared = [...PL.values()].some(p => p.eq === 5 && p.sw && Math.hypot(p.x - g.x, -p.dv - g.y, p.z - g.z) < 11) || G.flares.some(f => f.t > 0 && f.sea && Math.hypot(f.x - g.x, f.z - g.z) < 14 && g.y > -20);
    if (scared && g.st !== 3) { g.st = 3; g.t = 0; emit({k: 'snd', s: 'gulF', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); }
    const px = best.x, py = -best.dv - .3, pz = best.z; let tx, ty, tz, spd;
    if (g.st === 0) { const sense = best.l ? 42 : 26, ra = g.t * .12 + g.yaw; tx = px + Math.sin(ra) * 22; ty = py + Math.sin(g.t * .5) * 3; tz = pz + Math.cos(ra) * 22; spd = 3; if (bd < sense) { g.st = 1; g.t = 0; g.lt = 4 + CR() * 5; g.ang = Math.atan2(g.x - px, g.z - pz); emit({k: 'snd', s: 'gulS', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); } }
    else if (g.st === 1) { g.ang += dt * .55; const r = mix(14, 8, clamp(g.t / g.lt, 0, 1)); tx = px + Math.sin(g.ang) * r; tz = pz + Math.cos(g.ang) * r; ty = py + Math.sin(g.t) * 2; spd = 4.2; if (g.t > g.lt) { g.st = 2; g.t = 0; g.lx = px; g.ly = py; g.lz = pz; emit({k: 'snd', s: 'gulL', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); } }
    else if (g.st === 2) { tx = mix(g.lx, px, .6); ty = mix(g.ly, py, .6); tz = mix(g.lz, pz, .6); spd = 13; if (bd < 1.9) { g.st = 3; g.t = 0; const p = best; if (p.biteT && G.t - p.biteT < 15) { p.dead = true; p.deadT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 2}); } else { p.biteT = G.t; emit({k: 'bite', id: p.id}); } } else if (g.t > 1.8) { g.st = 1; g.t = 0; g.lt = 3 + CR() * 3; } }
    else { tx = g.x + (g.x - px) * 2; ty = g.y - 3; tz = g.z + (g.z - pz) * 2; spd = 7; if (g.t > 6) { g.st = 0; g.t = 0; } }
    const dx = tx - g.x, dy = ty - g.y, dz = tz - g.z, d = Math.hypot(dx, dy, dz) || 1, k = Math.min(1, dt * (g.st === 2 ? 4 : 1.6));
    g.vx = mix(g.vx, dx / d * spd, k); g.vy = mix(g.vy, dy / d * spd, k); g.vz = mix(g.vz, dz / d * spd, k);
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt; const bed = seaBed(g.x, g.z); g.y = clamp(g.y, bed + 1.2, -2.5);
    const hs = Math.hypot(g.vx, g.vz); if (hs > .2) g.yaw = Math.atan2(-g.vx, -g.vz); g.pitch = Math.atan2(g.vy, Math.max(hs, .1)) * .8;
  }
}
// clients: draw from snapshot state
const GULM = [];
function drawGulpers(dt) {
  const t = G.wt;
  for (let i = 0; i < GN; i++) { const g = GUL[i], o = GULM[i]; const on = g && g.on && (G.uw > .3 || Math.hypot(g.x - cam.position.x, g.z - cam.position.z) < 60);
    if (!on) { if (o) { o.body.visible = o.h.visible = false; o.trail.length = 0; } continue; }
    const m = o || (GULM[i] = gulMesh()); m.body.visible = m.h.visible = true;
    if (!isHost() && g.tx != null) { const k = Math.min(1, dt * 8); g.x = mix(g.x, g.tx, k); g.y = mix(g.y, g.ty, k); g.z = mix(g.z, g.tz, k); g.yaw += angD(g.yaw, g.tyaw) * k; g.pitch = mix(g.pitch, g.tpitch, k); }
    gulDraw(m, g.x, g.y, g.z, g.yaw, g.pitch, g.st === 2 ? .9 : g.st === 1 ? .35 + Math.sin(t * 2) * .1 : .15, t);
  }
}
// ---------------- style: auras, boat paint and underglow, fireworks, fireflies
let ALL = (() => { try { return localStorage.getItem('s9-all') === '1'; } catch (e) { return false; } })();
const AURAS = [{n: 'No aura', c: 0, cost: 0}, {n: 'Sea glass', c: 0x60ffe0, cost: 300}, {n: 'Gold rush', c: 0xffc040, cost: 600}, {n: 'Void', c: 0xa050ff, cost: 900}, {n: 'Blood moon', c: 0xff3a2a, cost: 1200}, {n: 'Prism', c: -1, cost: 2500}];
const PAINTS = [{n: 'Factory', c: 0}, {n: 'Midnight', c: 0x0c1016}, {n: 'Racing red', c: 0xb01818}, {n: 'Gold', c: 0xd8a828}, {n: 'Pearl', c: 0xe4e4e0}, {n: 'Emerald', c: 0x16604a}, {n: 'Ultraviolet', c: 0x3a1a6a}];
const GLOWS = [{n: 'No underglow', c: 0}, {n: 'Cyan', c: 0x30f0ff}, {n: 'Magenta', c: 0xff30d0}, {n: 'Toxic', c: 0x70ff30}, {n: 'Sunset', c: 0xff8a20}, {n: 'Prism', c: -1}];
const STYLE_COST = {paint: 150, glow: 250};
function applyAll() {
  if (!ALL || !P) return;
  Object.assign(P.own, {rod: 3, glock: 1, sg: 1, suit: 2, sack: 2, fw: Math.max(P.own.fw || 0, 30), auras: AURAS.map((a, i) => i)}); if (!P.own.aura) P.own.aura = 5;
  Object.assign(P.ammo, {g: Math.max(P.ammo.g, 170), gm: 17, s: Math.max(P.ammo.s, 60), sm: 6}); P.flares = Math.max(P.flares, 12); P.bat = 1;
  if (isHost()) { Object.assign(B.up, {engine: 3, hull: 2, light: 2, sonar: 1, hold: 2, crane: 1}); G.cruise = 1; G.cash = Math.max(G.cash, 250000); B.hull = hullMax(); }
}
const hullCost = H => ALL ? 0 : H.cost;
// auras: a slow spiral of motes around a player
const AURM = new Map(), _ac = new THREE.Color();
function auraOf(p) { const q = AURM.get(p.id); if (q) return q; const n = 40, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size: .22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); m.frustumCulled = false; scene.add(m); const o = {m, ph: [...Array(n)].map(() => [Math.random() * TAU, Math.random(), .35 + Math.random() * .4, .6 + Math.random()])}; AURM.set(p.id, o); return o; }
function updateAuras(dt) {
  const t = G.wt;
  for (const p of PL.values()) {
    const au = p === P ? (P.own && P.own.aura) || 0 : p.au || 0, A = AURAS[au]; const q = AURM.get(p.id);
    if (!au || !p.ready || p.dead || (p === P && P.hd >= 0)) { if (q) q.m.visible = false; continue; }
    const o = auraOf(p); o.m.visible = true; const x = p === P ? P.x : p.rx, z = p === P ? P.z : p.rz, y = p === P ? P.y + (P.ob ? B.heave : 0) - (P.sw ? P.dv || 0 : 0) : p.ry;
    const pa = o.m.geometry.attributes.position.array, ca = o.m.geometry.attributes.color.array;
    o.m.material.size = p === P ? .09 : .22; o.ph.forEach(([a0, h0, r, s], i) => { const h = (h0 + t * .25 * s) % 1, a = a0 + t * s * 1.3 + h * 4, rr = r * (1.1 - h * .5) + (p === P ? .45 : 0); pa[i * 3] = x + Math.cos(a) * rr; pa[i * 3 + 1] = y + .1 + h * (p === P ? .9 : 2); pa[i * 3 + 2] = z + Math.sin(a) * rr;
      if (A.c < 0) _ac.setHSL((t * .15 + i / 40) % 1, 1, .6); else _ac.setHex(A.c); const f = Math.sin(h * PI) * (1.3 + Math.sin(t * 5 + i) * .3); ca[i * 3] = _ac.r * f; ca[i * 3 + 1] = _ac.g * f; ca[i * 3 + 2] = _ac.b * f; });
    o.m.geometry.attributes.position.needsUpdate = o.m.geometry.attributes.color.needsUpdate = true;
  }
}
// fireworks
const FWK = {rk: [], sp: null, n: 900, i: 0, p: []};
function buildFw() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FWK.n * 3).fill(-9999), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FWK.n * 3), 3));
  FWK.sp = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); FWK.sp.frustumCulled = false; scene.add(FWK.sp);
  for (let i = 0; i < FWK.n; i++) FWK.p.push({x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, l: 0, L: 1, c: new THREE.Color()});
  FWK.fl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); FWK.fl.scale.setScalar(40); scene.add(FWK.fl); }
function spawnRocket(e) { FWK.rk.push({x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, t: 0, c: e.c}); Snd.fwUp(at(e.x, e.y, e.z, 6)); }
function launchFw() {
  if (!P.own.fw || P.hd >= 0 || P.down || !alivePlay()) { if (!P.own.fw) showMsg('Out of fireworks', '', 1.5); return; } P.own.fw--; saveGear();
  const f = eyeDir(P), up = Math.max(.55, f[1] + .6), e = {a: 'fw', x: +cam.position.x.toFixed(1), y: +(cam.position.y - .3).toFixed(1), z: +cam.position.z.toFixed(1), vx: +(f[0] * 7).toFixed(2), vy: +(up * 26).toFixed(2), vz: +(f[2] * 7).toFixed(2), c: Math.floor(Math.random() * 6)};
  if (isHost()) emit(Object.assign({}, e, {k: 'fw'})); else Net.send(Object.assign({t: 'act'}, e));
}
const FWC = [[1, .3, .2], [.3, .8, 1], [1, .85, .3], [.7, .35, 1], [.4, 1, .5], [-1]];
function stepFw(dt) {
  if (!FWK.sp) return; const t = G.wt;
  for (let k = FWK.rk.length - 1; k >= 0; k--) { const r = FWK.rk[k]; r.t += dt; r.vy -= 9 * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    { const p = FWK.p[FWK.i++ % FWK.n]; Object.assign(p, {x: r.x, y: r.y, z: r.z, vx: (Math.random() - .5), vy: -1, vz: (Math.random() - .5), l: .5, L: .5}); p.c.setRGB(1, .6, .3); }
    if (r.t > 1.5 || r.vy < 2) { FWK.rk.splice(k, 1); const C = FWC[r.c], multi = C[0] < 0, n = 160, s = 13 + Math.random() * 6;
      for (let i = 0; i < n; i++) { const p = FWK.p[FWK.i++ % FWK.n], u = Math.random() * 2 - 1, a = Math.random() * TAU, q = Math.sqrt(1 - u * u), v = s * (.85 + Math.random() * .15);
        Object.assign(p, {x: r.x, y: r.y, z: r.z, vx: q * Math.cos(a) * v, vy: u * v, vz: q * Math.sin(a) * v, l: 2 + Math.random() * .8, L: 2.8}); if (multi) p.c.setHSL(Math.random(), 1, .6); else p.c.setRGB(C[0], C[1], C[2]); p.c.multiplyScalar(4); }
      FWK.fl.position.set(r.x, r.y, r.z); FWK.fl.material.color.setRGB(...(multi ? [1, 1, 1] : C)); FWK.fl.material.opacity = 1; Snd.fwBoom(at(r.x, r.y, r.z, 40)); }
  }
  FWK.fl.material.opacity = Math.max(0, FWK.fl.material.opacity - dt * 3);
  const pa = FWK.sp.geometry.attributes.position.array, ca = FWK.sp.geometry.attributes.color.array;
  for (let i = 0; i < FWK.n; i++) { const p = FWK.p[i]; if (p.l <= 0) { pa[i * 3 + 1] = -9999; continue; } p.l -= dt; const dr = Math.exp(-dt * 1.4); p.vx *= dr; p.vy = p.vy * dr - 4 * dt; p.vz *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.z; const f = Math.max(0, p.l / p.L) * (Math.random() < .08 ? .2 : 1); ca[i * 3] = p.c.r * f; ca[i * 3 + 1] = p.c.g * f; ca[i * 3 + 2] = p.c.b * f; }
  FWK.sp.geometry.attributes.position.needsUpdate = FWK.sp.geometry.attributes.color.needsUpdate = true;
}
// fireflies over the nearest island at night
let FFLY = null;
function stepFireflies(dt) {
  if (!FFLY) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(220 * 3), 3)); FFLY = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, color: new THREE.Color().setRGB(1.6, 2, .5), size: .35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); FFLY.frustumCulled = false; FFLY.userData.base = []; scene.add(FFLY); }
  const cp = cam.position; let I = null, bd = 1e9; for (const q of ISLES) { if (q.bar) continue; const d = Math.hypot(q.x - cp.x, q.z - cp.z) - q.r; if (d < bd) { bd = d; I = q; } }
  const on = TOD.night > .3 && G.storm < .5 && I && bd < 150 && (G.uw || 0) < .5; FFLY.visible = on; if (!on) return;
  if (FFLY.userData.I !== I) { FFLY.userData.I = I; FFLY.userData.base = []; for (let i = 0; i < 220; i++) { let x, z, h, k = 0; do { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * I.r; x = I.x + Math.sin(a) * r; z = I.z + Math.cos(a) * r; h = landH(x, z); } while (h < .5 && k++ < 20); FFLY.userData.base.push([x, h + .6 + Math.random() * 2.5, z, Math.random() * TAU]); } }
  const pa = FFLY.geometry.attributes.position.array, t = G.wt; FFLY.userData.base.forEach(([x, y, z, ph], i) => { pa[i * 3] = x + Math.sin(t * .4 + ph) * 1.2; pa[i * 3 + 1] = y + Math.sin(t * .7 + ph * 2) * .5; pa[i * 3 + 2] = z + Math.cos(t * .35 + ph) * 1.2; });
  FFLY.geometry.attributes.position.needsUpdate = true; FFLY.material.opacity = TOD.night * (.6 + .4 * Math.sin(t * 3));
}
const FX = {dol: null, whale: null};
function buildFauna() {
  const m = new THREE.MeshStandardMaterial({color: 0x3a4650, roughness: .4, metalness: .1});
  const dg = new THREE.CapsuleGeometry(.32, 1.6, 4, 10); dg.rotateX(PI / 2); dg.scale(1, .8, 1); const fin = new THREE.ConeGeometry(.18, .5, 4); fin.translate(0, .45, .1);
  FX.dol = [0, 1, 2].map(() => { const g = new THREE.Group(); g.add(new THREE.Mesh(dg, m)); g.add(new THREE.Mesh(fin, m)); g.visible = false; scene.add(g); return g; });
  const wm = new THREE.MeshStandardMaterial({color: 0x252c34, roughness: .5}); const wg = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 12, 6, 14), wm); body.rotation.x = PI / 2; wg.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(5, .3, 1.6), wm); tail.position.z = 8.5; wg.add(tail); wg.visible = false; scene.add(wg); FX.whale = wg;
  FX.spout = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xb0c8e0, transparent: true, depthWrite: false, opacity: 0})); FX.spout.scale.set(4, 10, 1); scene.add(FX.spout);
  buildLev(); buildWake();
}
function stepFauna(dt) {
  const calm = G.storm < .4;
  FX.dolT = (FX.dolT ?? 25) - dt;
  if (FX.dolT <= 0 && calm && Math.abs(B.v) > 4 && P && P.ob) { FX.dolT = 50 + Math.random() * 60; FX.dolA = {t: 0, s: Math.random() < .5 ? -1 : 1}; }
  if (FX.dolA) { const a = FX.dolA; a.t += dt; FX.dol.forEach((d, i) => { const ph = a.t * 2.4 + i * 1.3, j = Math.sin(ph); const [x, z] = bL2W(a.s * (4.5 + i * 1.6), -3 - i * 2.5 + Math.sin(a.t + i) * 2); d.visible = a.t < 12; d.position.set(x, Math.max(-1.2, j * 1.4 - .3), z); d.rotation.set(-Math.cos(ph) * .8, B.yaw, 0, 'YXZ'); if (j > .9 && Math.random() < .1) Snd.splash(at(x, 0, z, 4)); }); if (a.t > 12) FX.dolA = null; }
  FX.whT = (FX.whT ?? 40) - dt;
  if (FX.whT <= 0 && calm) { FX.whT = 70 + Math.random() * 80; const a = Math.random() * TAU, r = 70 + Math.random() * 60, cp = cam.position, x = cp.x + Math.sin(a) * r, z = cp.z + Math.cos(a) * r; if (landH(x, z) < -4 && !nearRig(x, z)) { FX.whA = {t: 0, x, z, a: Math.random() * TAU}; Snd.whale(at(x, 0, z, 40)); } }
  if (FX.whA) { const w = FX.whA; w.t += dt; const u = w.t / 7; FX.whale.visible = u < 1; FX.whale.position.set(w.x + Math.sin(w.a) * (u - .5) * 30, -6 + Math.sin(u * PI) * 6.5, w.z + Math.cos(w.a) * (u - .5) * 30); FX.whale.rotation.set(-Math.cos(u * PI) * .5, w.a + PI, 0, 'YXZ'); FX.spout.position.set(FX.whale.position.x, 4, FX.whale.position.z); FX.spout.material.opacity = u > .3 && u < .55 ? .5 : 0; if (u > .62 && !w.splash) { w.splash = 1; Snd.splash(at(w.x, 0, w.z, 30)); } if (u >= 1) FX.whA = null; }
  stepLev(dt); stepWake(dt);
}
function updateWorldFx(dt) {
  G.wt = performance.now() / 1000; G.sea = mix(.5, 1.25, G.storm);
  if (MAT.sea.userData.sh) { const u = MAT.sea.userData.sh.uniforms; u.uT.value = G.wt; u.uA.value = G.sea; u.uFoam.value = .25 + .75 * G.storm; }
  TX.ripple.offset.set(G.wt * .01, G.wt * .013);
  const st = G.storm; if (Net.role !== 'host' && Net.role !== 'solo' && G.on) G.tod = ((G.tod || 0) + dt / TOD_LEN) % 1;
  todAt(G.tod || 0, st); scene.fog.density = TOD.fd; scene.fog.color.copy(TOD.fog); scene.background.copy(TOD.fog);
  G.lightT -= dt; const sky = scene.userData.sky.material.uniforms; sky.uS.value = st; sky.uT.value = G.wt;
  sky.zen.value.copy(TOD.zen); sky.hor.value.copy(TOD.hor); sky.fogC.value.copy(TOD.fog); sky.sunC.value.copy(TOD.sun); sky.sunI.value = TOD.sI; sky.stars.value = TOD.st; sky.aur.value = TOD.night * (1 - st) * .9;
  const cw = waveH(cam.position.x, cam.position.z, G.wt); G.uw = mix(G.uw || 0, cam.position.y < cw - .08 ? 1 : 0, Math.min(1, dt * 12));
  if (G.uw > .5) { const dl = .25 + .75 * TOD.day; scene.fog.color.setRGB(.012 * dl, .07 * dl, .08 * dl); scene.background.copy(scene.fog.color); scene.fog.density = .085; }
  scene.userData.sky.visible = G.uw < .5;
  if (G.uw > .5) { const dpt = clamp((cw - cam.position.y) / 80, 0, 1); scene.fog.color.multiplyScalar(1 - dpt * .92); scene.background.copy(scene.fog.color); scene.fog.density = mix(.06, .045, dpt); }
  const sbv = G.uw > .3 || (B.dep || 0) > .5; if (SEABED && SEABED.material.userData.sh) { const u = SEABED.material.userData.sh.uniforms; u.uT.value = G.wt; u.uC.value = TOD.day * (1 - G.storm * .7); } if (SEABED) { SEABED.visible = sbv; if (sbv && Math.hypot(cam.position.x - SEABED.userData.cx, cam.position.z - SEABED.userData.cz) > 40) seabedAt(cam.position.x, cam.position.z); }
  for (const q of SUNK) q.m.visible = sbv && !q.got; if (DEEPG) DEEPG.visible = sbv;
  if (CRZ.reds && !CRZ.redS) { CRZ.redS = CRZ.reds.map(([x, y, z]) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.scale.setScalar(1.6); s.position.set(x, y, z); scene.add(s); return s; }); }
  if (CRZ.redS) CRZ.redS.forEach((s, i) => s.material.opacity = Math.sin(G.wt * 1.7 + i * 2.3) > -.2 || Math.random() < .03 ? .7 : .05);
  envUpdate(dt); if (FOAM) FOAM.userData.mat.opacity = (.35 + .15 * Math.sin(G.wt * 1.3)) * (.4 + .6 * TOD.day) * (1 - st * .4);
  if (POST.on) { POST.ex = mix(1.15, .95, TOD.night); }
  if (G.lightT <= 0) { G.lightT = 8 + Math.random() * 20; if (st > .6) { G.bolt = .35; setTimeout(() => Snd.thunder(.6 + Math.random() * .4), 600 + Math.random() * 2500); } }
  G.bolt = Math.max(0, (G.bolt || 0) - dt); const fl = G.bolt > 0 ? (Math.random() < .6 ? 1 : .2) * G.bolt * 3 : 0;
  sky.uF.value = fl; hemi.color.copy(TOD.hs); hemi.groundColor.copy(TOD.hg); hemi.intensity = TOD.hI * 1.15 + fl * 3; moon.color.copy(TOD.sun); moon.intensity = TOD.kI + fl * 2;
  const sc = _v.set(Math.round(cam.position.x / 4) * 4, 0, Math.round(cam.position.z / 4) * 4); moon.position.copy(sc).addScaledVector(KEYDIR, 200); moon.target.position.copy(sc);
  moon.castShadow = SET.gfx === 'high' && TOD.kI > .15;
  if (G.aviS) G.aviS.material.opacity = Math.sin(G.wt * 3) > .4 ? 1 : .05;
  const ang = G.wt * .45; lhL.position.set(G.lh[0], G.lh[1], G.lh[2]); lhL.target.position.set(G.lh[0] + Math.sin(ang) * 100, G.lh[1] - 6, G.lh[2] + Math.cos(ang) * 100); lhL.intensity = 30;
  G.lhBeam.position.set(G.lh[0], G.lh[1], G.lh[2]); G.lhBeam.rotation.set(0, ang, 0);
  const cp = cam.position;
  if ((G.power && nearRig(cp.x, cp.z)) || Math.hypot(cp.x - HOME.x, cp.z - HOME.z) < 60) { const L = LAMPS.filter(() => G.power).concat(G.homeLamps).sort((a, b) => Math.hypot(a[0] - cp.x, a[1] - cp.y, a[2] - cp.z) - Math.hypot(b[0] - cp.x, b[1] - cp.y, b[2] - cp.z)); POOL.forEach((l, i) => { const s = L[i]; if (!s) { l.intensity = 0; return; } l.position.set(s[0], s[1] - .3, s[2]); l.intensity = 22 * s[3] * (Math.random() < .015 ? .3 : 1); }); }
  else POOL.forEach(l => l.intensity = 0);
  for (const b of BUOYS) { b.m.position.y = waveH(b.x, b.z, G.wt); b.l.material.opacity = Math.sin(G.wt * 2 + b.x) > .6 ? 1 : .1; }
  if (G.ghostS) G.ghostS.forEach((s, i) => s.material.opacity = .4 + Math.sin(G.wt * 1.3 + i) * .3);
  G.floats.forEach((f, i) => { const o = floatMesh(i); if (!o) return; o.m.position.set(f[0], waveH(f[0], f[1], G.wt) - .15, f[1]); o.m.rotation.set(Math.sin(G.wt + i) * .2, i, Math.cos(G.wt * .8 + i) * .2); });
  for (let i = 0; i < FLM.length; i++) if (FLM[i] && !G.floats[i]) { scene.remove(FLM[i].m); FLM[i] = null; }
  stepFauna(dt);
}
function updateRemotes(dt) {
  let si = 0; const cp = cam.position;
  const L = [...PL.values()].filter(p => p !== P && p.ready); L.sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z));
  for (const p of PL.values()) {
    if (p === P) { if (p.av) p.av.visible = false; if (p.tag) p.tag.style.display = 'none'; continue; }
    if (!p.ready) continue;
    let tx = p.x, tz = p.z, ty = p.y - (p.sw ? p.dv || 0 : 0); if (p.ob && p.bl) { [tx, tz] = bL2W(p.bl[0], p.bl[1]); ty = BDECK.y + B.heave; }
    const k = Math.min(1, dt * 12), ox = p.rx, oz = p.rz; p.rx = p.ob ? tx : mix(p.rx, tx, k); p.ry = mix(p.ry, ty, k); p.rz = p.ob ? tz : mix(p.rz, tz, k); p.ryaw += angD(p.ryaw, p.yaw) * k; p.rpitch = mix(p.rpitch, p.pitch, k);
    p.rspd = mix(p.rspd, Math.hypot(p.rx - ox, p.rz - oz) / Math.max(dt, 1e-3) - (p.ob ? Math.abs(B.v) : 0), Math.min(1, dt * 6));
    animCrew(p, dt);
    if ((p.stepD || 0) > (p.run ? 1 : .75)) { p.stepD = 0; if (!p.ob && Math.hypot(p.x - cp.x, p.z - cp.z) < 30 && !p.down) Snd.rStep(p.x, p.y, p.z, p.run ? 1.4 : .8); }
    p.pingT = Math.max(0, (p.pingT || 0) - dt);
    const t = p.tag, d = Math.hypot(p.rx - cp.x, p.rz - cp.z); let show = !p.dead && (d < 40 || p.down || p.pingT > 0 || p.sw);
    if (show) { _v.set(p.rx, p.ry + (p.down ? .8 : 2.15), p.rz).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) show = false; }
    t.style.display = show ? 'block' : 'none';
    if (show) { t.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; t.className = 'tag' + (p.down || p.sw ? ' down' : p.pingT > 0 ? ' ping' : ''); t.textContent = p.down ? `${p.name} DOWN ${Math.max(0, p.bleed | 0)}s · ${d | 0}m` : p.sw ? `${p.name} IN THE WATER · ${d | 0}m` : p.pingT > 0 ? `${p.name} · ${d | 0}m` : p.name; t.style.opacity = p.down || p.pingT > 0 || p.sw ? 1 : clamp(1.4 - d / 40, .2, .9); }
  }
  for (const p of L) { if (si >= RSPOT.length) break; if (!p.l || p.down || p.dead || p.hd >= 0 || p.sw) continue; const l = RSPOT[si++], f = eyeDir({yaw: p.ryaw, pitch: p.rpitch}); l.position.set(p.rx + f[0] * .4, p.ry + 1.35, p.rz + f[2] * .4); l.target.position.set(l.position.x + f[0] * 10, l.position.y + f[1] * 10, l.position.z + f[2] * 10); l.intensity = 55; }
  for (; si < RSPOT.length; si++) RSPOT[si].intensity = 0;
  for (const it of ITEMS) it.mesh.visible = !it.taken;
}
let heartT = 0;
function stepFear(dt) {
  const cp = cam.position, d = Math.hypot(cp.x - M.x, cp.z - M.z) + Math.abs(cp.y - M.y - 1.5), me = alivePlay() ? P : null, s = me ? pSeesMon(me) : 0;
  let f = clamp(1 - d / 30, 0, 1) * .6 + (M.state === 'chase' ? (M.tgt === myId() ? .5 : .25) : 0) + s * clamp(1 - d / 45, 0, 1) * .4 + (me && me.sw && me.deep ? .5 : 0) + (G.spines && G.spines.circle ? .5 : 0);
  P.fear = mix(P.fear || 0, clamp(f, 0, 1), Math.min(1, dt * (f > (P.fear || 0) ? 3 : .6)));
  heartT -= dt; if (P.fear > .2 && heartT <= 0) { heartT = 60 / (60 + P.fear * 110); Snd.heart(P.fear); }
  $('fearV').style.opacity = G.js && G.js.t > 0 ? .2 : clamp((P.fear - .25) * 1.2, 0, .9); $('downV').style.opacity = P.down ? (G.js && G.js.t > 0 ? .1 : .55 + .35 * (1 - P.bleed / D.bleed)) : 0;
  if (A.on) {
    const c = A.ctx, t = c.currentTime, ch = M.state === 'chase', rigNear = nearRig(cp.x, cp.z);
    A.drone.gain.setTargetAtTime(ch && d < 60 ? .05 : 0, t, ch ? .3 : 1.5); A.droneF.frequency.setTargetAtTime(ch ? 900 : 300, t, 1);
    A.mBreath.g.gain.setTargetAtTime(rigNear ? .25 * (ch ? 1.6 : 1) * (.5 + .5 * Math.sin(G.t * (ch ? 9 : 2.5))) : 0, t, .05); A.mGrowl.gain.setTargetAtTime(!rigNear ? 0 : ch ? .5 : M.state === 'search' ? .25 : .08 * clamp(1 - d / 25, 0, 1), t, .2); A.mSaw.frequency.setTargetAtTime(ch ? 62 : 44, t, .3);
    setPan(A.mPan, M.x, M.y + 2, M.z);
    const L = c.listener; cam.getWorldDirection(_fw);
    if (L.positionX) { L.positionX.value = cp.x; L.positionY.value = cp.y; L.positionZ.value = cp.z; L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(cp.x, cp.y, cp.z); L.setOrientation(_fw.x, _fw.y, _fw.z, 0, 1, 0); }
    const inside = zoneOf(cp.x, cp.z, cp.y - 1.6) >= 0 || (P.hd >= 0), st = G.storm;
    A.pad.gain.setTargetAtTime(.028 * Math.max(TOD.night * .9 + (1 - TOD.day) * .3, G.storm * .7), t, 2); A.padF.frequency.setTargetAtTime(260 + 300 * TOD.night + Math.sin(G.wt * .11) * 90, t, 2);
    A.rain.g.gain.value = (inside ? .015 : .05) * st; A.wind.g.gain.value = ((inside ? .02 : .06) + Math.sin(G.t * .13) * .02) * (.3 + st * .7); A.wind.f.frequency.value = 380 + Math.sin(G.t * .21) * 140; A.surf.g.gain.value = clamp(.14 - cp.y * .006, .02, .14) * (.5 + st * .5);
    setPan(A.bPan, B.x, 1.5, B.z); A.eng.frequency.value = 38 + Math.abs(B.thr) * 30 + B.up.engine * 6; A.engF.frequency.value = 250 + Math.abs(B.thr) * 300; A.engG.gain.value = B.sink > 0 ? 0 : .08 + Math.abs(B.thr) * .12;
    const gb = BLD.find(q => q.kind === 'gen'); if (gb) setPan(A.gPan, gb.x, gb.fy + 1, gb.z); A.genG.gain.value = G.power ? .35 : 0;
    if (G.alarmT > 0) { G.alarmT -= dt; A.alarm.frequency.value = Math.sin(G.wt * 4) > 0 ? 620 : 470; A.alarmG.gain.value = .05; setPan(A.aPan, 0, LV[1] + 4, 0); } else A.alarmG.gain.value = 0;
    A.deepG.gain.setTargetAtTime(G.spines && G.spines.circle ? .3 : 0, t, .8);
    A.lp.frequency.setTargetAtTime(G.uw > .5 ? 520 : 20000, t, .08);
    if (P.sw && (P.dv || 0) > .6) { G.brT = (G.brT ?? 0) - dt; if (G.brT <= 0) { G.brT = 3.6 - P.fear * 1.6; Snd.inhale(1); setTimeout(() => { Snd.exhale(1); bubbles(cam.position.x, cam.position.y - .2, cam.position.z, 8); }, 1300); } }
    G.mbT = (G.mbT ?? 0) - dt; if (G.mbT <= 0 && CRZ.box && Math.hypot(cp.x - CRZ.box[0], cp.z - CRZ.box[2]) < 45) { const N = [659, 587, 523, 494, 523, 587, 440, 0, 659, 698, 659, 587, 523, 0, 494, 523]; G.mbI = ((G.mbI || 0) + 1) % N.length; G.mbT = .42; if (N[G.mbI]) tone(N[G.mbI] * 2, .05, .9, 'sine', at(CRZ.box[0], CRZ.box[1], CRZ.box[2], 3)); }
    G.mimT = (G.mimT ?? 60) - dt; if (G.mimT <= 0) { G.mimT = 70 + Math.random() * 90; if (rigNear && d > 10 && d < 45 && M.state === 'roam' && PL.size > 0) Snd.whistle(at(M.x, M.y + 2, M.z, 8)); }
    G.clickT = (G.clickT || 3) - dt; if (G.clickT <= 0) { G.clickT = 1.6 + Math.random() * 4; if (rigNear && d < 34 && ['roam', 'search', 'inv'].includes(M.state)) Snd.click(at(M.x, M.y + 2.2, M.z, 3)); }
    G.creakT = (G.creakT || 4) - dt; if (G.creakT <= 0) { G.creakT = 4 + Math.random() * 9; if (rigNear) Snd.metal(at((Math.random() - .5) * 28, LV[Math.floor(Math.random() * 3)] + 2, (Math.random() - .5) * 28, 6)); }
    G.hornT = (G.hornT || 20) - dt; if (G.hornT <= 0) { G.hornT = 45; Snd.horn(at(G.lh[0], G.lh[1], G.lh[2], 60)); }
  }
}
function bearing(x, z) { return Math.atan2(-(x - cam.position.x), -(z - cam.position.z)); }
function drawCompass() {
  const c = $('compass'), g = c.getContext('2d'), W = c.width, H = c.height; g.clearRect(0, 0, W, H);
  _v.set(0, 0, -1).applyQuaternion(cam.quaternion); const yaw = Math.atan2(-_v.x, -_v.z), span = PI * .9, X = a => W / 2 + angD(yaw, a) / span * W;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 12, W, 22); g.fillStyle = '#c8c0b0'; g.font = '11px ui-monospace,monospace'; g.textAlign = 'center';
  for (let i = 0; i < 24; i++) { const a = -i / 24 * TAU + PI, x = X(a); if (x < 0 || x > W) continue; const big = i % 6 === 0; g.fillRect(x, 12, 1, big ? 8 : 4); if (big) g.fillText(['N', 'E', 'S', 'W'][i / 6], x, 30); }
  const mark = (x, z, label, col, sym = '▼') => { const a = bearing(x, z); if (Math.abs(angD(yaw, a)) > span / 2) return; const px = X(a), d = Math.hypot(x - cam.position.x, z - cam.position.z); g.fillStyle = col; g.fillText(sym, px, 10); const da = Math.abs(angD(yaw, a)); if ((da < .12 || sym === '!') && (!lab || da < lab.da)) lab = {da, px, col, t: `${label} ${d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km'}`}; }; let lab = null;
  mark(HOME.x, HOME.z, 'HOME', '#ffd880');
  if (P && !P.ob && !P.dead) mark(B.x, B.z, 'BOAT', '#7ad0ff');
  POIS.forEach((q, i) => { if (q.home) return; if (G.disc.includes(i)) { if (Math.hypot(q.x - cam.position.x, q.z - cam.position.z) > 60) mark(q.x, q.z, q.n, 'rgba(220,210,190,.75)', '·'); } else if (B.up.sonar) mark(q.x, q.z, '?', '#9affd0', '◆'); });
  DIGS.forEach(d => { if (d.rev && !d.dug) mark(d.x, d.z, 'X', '#ff7050', '✕'); });
  if (B.up.sonar && HC().sub) SUNK.forEach(q => { if (!q.got) mark(q.x, q.z, 'WRECKAGE', '#7affd0', '◆'); });
  if (B.up.sonar) G.floats.forEach(f => { if (f && Math.hypot(f[0] - cam.position.x, f[1] - cam.position.z) < 400) { const a = bearing(f[0], f[1]); if (Math.abs(angD(yaw, a)) < span / 2) { g.fillStyle = '#9affd0'; g.fillRect(X(a) - 1.5, 21, 3, 3); } } });
  for (const p of PL.values()) if (p !== P && p.ready && !p.dead && (p.sw || p.down)) mark(p.rx, p.rz, p.name, '#ff7050', '!');
  if (lab) { g.fillStyle = lab.col; g.fillText(lab.t, lab.px, 45); }
}
function hud() {
 const lb = G.cine > 0 || (G.js && G.js.t > 0) || !!G.drownCam; if (lb !== G.lbOn) { G.lbOn = lb; $('lbox').classList.toggle('on', lb); }
  const b = $('bat'); for (let i = 0; i < 4; i++) b.children[i].className = P.bat > i * .25 + .02 ? '' : 'off'; b.classList.toggle('low', P.bat < .25);
  $('nFlare').textContent = P.flares; $('nSpd').textContent = Math.abs(B.v * 1.94).toFixed(0); $('nCash').textContent = '$' + G.cash;
  { const dv = P.sw ? P.dv || 0 : 0, show = dv > .3; if (show !== G.diveShow) { G.diveShow = show; $('dive').style.opacity = show ? 1 : 0; } if (show) { const su = (P.own && P.own.suit) || 0; $('diveD').textContent = `${dv.toFixed(dv < 10 ? 1 : 0)} m`; $('diveA').style.width = (P.air ?? 1) * 100 + '%'; $('diveA').style.background = P.air < .25 ? '#e04030' : '#7ad0ff'; $('diveS').textContent = SUIT[su].n + ' · max ' + SUIT[su].max + ' m'; } }
  $('hullB').style.width = clamp(B.hull / hullMax(), 0, 1) * 100 + '%'; $('hullB').style.background = B.hull < 30 ? '#e06040' : '#8ac080';
  $('holdT').textContent = `HOLD ${B.hold.length} · $${holdValue()}`;
  { const q = P.sack || [], key = q.join(); if (key !== G.sackKey) { G.sackKey = key; $('carry').innerHTML = q.length ? `🎒 ${sackUsed(q)}/${sackCap(P)}${sackVal(q) ? ' · $' + sackVal(q) : ''}<small>${q.map(k => NAMES[k]).join(', ')}</small>` : ''; G.sackShowT = 3.5; } G.sackShowT = (G.sackShowT || 0) - 1 / 30; const sm = $('carry').querySelector('small'); if (sm) sm.style.opacity = G.sackShowT > 0 ? 1 : 0; }
  const ot = hint(); if (ot !== G.objLast) { G.objLast = ot; $('obj').innerHTML = ot; $('obj').style.opacity = 1; G.objT = 7; }
  if (G.objT > 0) { G.objT -= 1 / 30; if (G.objT <= 0) $('obj').style.opacity = 0; }
  G.teamT = (G.teamT || 0) - 1; if (PL.size > 1 && G.teamT <= 0) { G.teamT = 10; $('team').innerHTML = [...PL.values()].map(p => `<div class="${p.dead ? 'dead' : p.down || p.sw ? 'down' : ''}">${p.name}${p.down ? ' · DOWN ' + Math.max(0, p.bleed | 0) + 's' : p.dead ? '' : p.sw ? ' · IN THE WATER' : p.seat ? ' · at the wheel' : p.ob ? ' · aboard' : ''}<i style="background:${hexS(CREW_COL[p.c % 6])}"></i></div>`).join(''); }
  const st = $('state');
  if (P.dead) st.innerHTML = (P.drowned ? 'Pulled under' : 'You are dead') + '<small>You will wash up at the lighthouse in a few seconds.</small>';
  else if (P.down) st.innerHTML = `You are down<small>Bleeding out in ${Math.max(0, P.bleed | 0)} s. Crawl to your crew or wait for help.</small>`;
  else if (P.seat) { G.seatT = (G.seatT ?? 0) + 1 / 30; st.innerHTML = G.seatT < 6 ? `<small style="font-size:12px">W/S throttle · A/D rudder${HC().sub ? ' · C/Space dive' : ''} · E let go</small>` : ''; }
  else if (P.sw && P.deep && !(P.own && P.own.suit)) st.innerHTML = '<small style="font-size:13px;color:#ff9a7a">Deep water</small>';
  else st.innerHTML = '';
  if (!P.seat) G.seatT = 0;
  { const nb = P.ob || P.seat || Math.hypot(B.x - P.x, B.z - P.z) < 30; if (nb !== G.bhOn) { G.bhOn = nb; $('boatHud').style.opacity = nb ? 1 : 0; $('nSpd').parentElement.style.display = nb ? '' : 'none'; } }
  drawCompass(); if (G.shopOpen && (G.shopT = (G.shopT || 0) - 1) <= 0) { G.shopT = 15; drawShop(); }
}
let grainT = 0; const gctx = $('grain').getContext('2d'), gimg = gctx.createImageData(200, 120);
function grain() { const d = gimg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gctx.putImageData(gimg, 0, 0); $('grain').style.opacity = .05 + (P ? P.fear || 0 : 0) * .12; }
function drawMap() {
  const c = $('map'), g = c.getContext('2d'), W = c.width, S = W / 5400, X = x => W / 2 + x * S, Z = z => W / 2 - (z + 60) * S;
  g.fillStyle = '#8a9a9c'; g.fillRect(0, 0, W, W); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(30,50,60,${Math.random() * .08})`; g.fillRect(Math.random() * W, Math.random() * W, 2, 2); }
  g.textAlign = 'center'; g.font = '13px Georgia';
  for (const b of BUOYS) { g.fillStyle = hexS(b.c); g.beginPath(); g.arc(X(b.x), Z(b.z), 2.5, 0, TAU); g.fill(); }
  POIS.forEach((q, i) => { const known = G.disc.includes(i); if (!known) { if (B.up.sonar) { g.fillStyle = 'rgba(30,60,50,.6)'; g.fillText('?', X(q.x), Z(q.z) + 4); } return; }
    g.fillStyle = q.isle ? '#6a6a52' : q.home ? '#5a5248' : '#3a3a3a'; if (q.isle || q.home) { g.beginPath(); g.arc(X(q.x), Z(q.z), Math.max(4, (q.isle ? q.isle.shore : HOME.r) * S), 0, TAU); g.fill(); } else g.fillRect(X(q.x) - 5, Z(q.z) - 5, 10, 10);
    g.fillStyle = '#1a1a1a'; g.fillText(q.n, X(q.x), Z(q.z) - 12); });
  DIGS.forEach(d => { if (d.rev) { g.fillStyle = d.dug ? '#666' : '#a01a10'; g.font = 'bold 16px Georgia'; g.fillText('✕', X(d.x), Z(d.z) + 5); g.font = '13px Georgia'; } });
  G.floats.forEach(f => { if (f && B.up.sonar) { g.fillStyle = '#2a6a5a'; g.fillRect(X(f[0]) - 1.5, Z(f[1]) - 1.5, 3, 3); } });
  g.save(); g.translate(X(B.x), Z(B.z)); g.rotate(-B.yaw + PI); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(4, 6); g.lineTo(-4, 6); g.closePath(); g.fill(); g.restore();
  for (const p of PL.values()) { if (!p.ready || p.dead) continue; const yaw = p === P ? P.yaw : p.ryaw, x = p === P ? P.x : p.rx, z = p === P ? P.z : p.rz; g.save(); g.translate(X(x), Z(z)); g.rotate(-yaw + PI); g.fillStyle = hexS(CREW_COL[p.c % 6]); g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.restore(); }
  g.fillStyle = 'rgba(20,20,20,.75)'; g.fillRect(12, 12, 360, 70 + GOALS.length * 20); g.fillStyle = '#e8e0cc'; g.textAlign = 'left'; g.font = 'italic 18px Georgia'; g.fillText('Logbook', 24, 36); g.font = '13px Georgia';
  GOALS.forEach((t, i) => { g.fillStyle = G.goals.includes(i) ? '#8fc08f' : '#e8e0cc'; g.fillText((G.goals.includes(i) ? '✔ ' : '○ ') + t + (i === 0 ? ` (${G.disc.length}/${POIS.length})` : i === 3 ? ` ($${G.earned})` : ''), 24, 60 + i * 20); });
  g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.font = '12px Georgia'; g.fillText('Tab: close', W / 2, W - 12);
}

// ---------------- gear: guns and fishing
const GEAR = {
  rod1: {n: 'Fishing rod', d: 'Learn to fish! Cast off the boat, a dock or a beach (key 2)', cost: 40, need: o => !o.rod},
  rod2: {n: 'Carbon rod', d: 'Quicker bites, gentler fights, better fish', cost: 150, need: o => o.rod === 1},
  rod3: {n: 'Deep-sea rod', d: 'Tuna, anglerfish and giant squid', cost: 350, need: o => o.rod === 2},
  glock: {n: 'Glock', d: '17-round pistol with a spare magazine (key 3)', cost: 120, need: o => !o.glock},
  ammo: {n: '9mm rounds x34', d: 'For the Glock', cost: 20, need: o => o.glock},
  sg: {n: 'Pump shotgun', d: 'Six in the tube plus 12 shells, hits hard up close (key 4)', cost: 260, need: o => !o.sg},
  shells: {n: 'Shotgun shells x12', d: 'For the shotgun', cost: 30, need: o => o.sg},
  scuba: {n: 'Scuba gear', d: 'Dive to 45 m with 3 minutes of air (hold C to dive, Space to rise, swim where you look)', cost: 260, need: o => !o.suit},
  sat: {n: 'Saturation suit', d: 'Hard-hat suit with a helmet lamp: 160 m and 9 minutes of air. The trenches are dark', cost: 1400, need: o => o.suit === 1},
  fw: {n: 'Firework rockets x5', d: 'Slot 7. Light up the night sky', cost: 60, need: o => true},
  sack1: {n: 'Big sack', d: 'Carry 7 slots of salvage instead of 4', cost: 90, need: o => !o.sack},
  sack2: {n: "Hauler's pack", d: 'Carry 10 slots of salvage', cost: 220, need: o => o.sack === 1},
};
const FISH = {
  boot: {n: 'old boot', v: 1, s: .4, kg: [.6, 1.2]}, sard: {n: 'sardine', v: 8, s: .55, kg: [.1, .3]}, mack: {n: 'mackerel', v: 15, s: .75, kg: [.4, 1.2]},
  bass: {n: 'sea bass', v: 28, s: 1, kg: [1, 4]}, cod: {n: 'cod', v: 35, s: 1.15, kg: [2, 8]}, eel: {n: 'moray eel', v: 45, s: 1.35, kg: [2, 6]},
  tuna: {n: 'bluefin tuna', v: 90, s: 1.8, kg: [40, 120]}, angler: {n: 'glowing anglerfish', v: 150, s: 1.6, kg: [3, 9]}, squid: {n: 'giant squid', v: 280, s: 2.4, kg: [90, 200]},
  bottle: {n: 'message in a bottle', v: 0, s: .4, kg: [.5, .6]},
};
function pickFish(x, z, rod) {
  const land = OBST.filter(o => o.c && o.r > 5).reduce((m, o) => Math.min(m, Math.hypot(x - o.x, z - o.z) - o.r), 1e9), deep = land > 150;
  const wreck = POIS.some(q => (q.wreck || q.rig) && Math.hypot(x - q.x, z - q.z) < 70), storm = G.storm > .5;
  const w = {boot: [0, 8, 4, 2][rod], sard: 30, mack: 22, bass: land < 60 ? 22 : 4, cod: deep ? 18 : 5, eel: wreck ? 20 : 1, tuna: deep && rod >= 2 ? 9 + rod * 2 : 0, angler: (storm || deep) && rod >= 2 ? 3 + rod : 0, squid: deep && rod >= 3 ? 3 : 0, bottle: DIGS.some(d => !d.rev) ? 2 : 0};
  let sum = 0; for (const k in w) sum += w[k]; let r = Math.random() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'sard';
}
function loadGear() { let g = null; try { g = JSON.parse(localStorage.getItem('s9-gear')); } catch (e) {} g = g || {}; P.own = Object.assign({rod: 0, glock: 0, sg: 0}, g.own || {}); P.ammo = Object.assign({g: 0, gm: 0, s: 0, sm: 0}, g.ammo || {}); }
function saveGear() { if (TEST) return; try { localStorage.setItem('s9-gear', JSON.stringify({own: P.own, ammo: P.ammo})); } catch (e) {} }
function gotGear(k) {
  const o = P.own, a = P.ammo; Snd.coin();
  if (k === 'fw') o.fw = (o.fw || 0) + 5; if (k.startsWith('aura')) { const i = +k.slice(4); o.auras = (o.auras || [0]).concat([i]); o.aura = i; }
  if (k === 'scuba') o.suit = 1; else if (k === 'sat') o.suit = 2;
  if (k === 'sack1') o.sack = 1; else if (k === 'sack2') o.sack = 2;
  if (k === 'rod1') o.rod = 1; else if (k === 'rod2') o.rod = 2; else if (k === 'rod3') o.rod = 3;
  else if (k === 'glock') { o.glock = 1; a.gm = 17; a.g += 17; } else if (k === 'ammo') a.g += 34;
  else if (k === 'sg') { o.sg = 1; a.sm = 6; a.s += 12; } else if (k === 'shells') a.s += 12;
  saveGear(); showMsg(`Bought: ${GEAR[k].n}.` + (k === 'rod1' ? ' Press 2 to take it out.' : k === 'glock' ? ' Press 3 to draw it.' : k === 'sg' ? ' Press 4 to take it out.' : ''), 'HARBOUR SHED', 3);
  setTimeout(drawShop, 50);
}
function showFishHelp(on) { G.helpOpen = on; $('fishHelp').classList.toggle('hidden', !on); if (on) { try { document.exitPointerLock(); } catch (e) {} try { localStorage.setItem('s9-fishhelp', '1'); } catch (e) {} } else if (G.on && !G.shopOpen) lockMouse(); }
function equip(i) {
  if (i === 6 && !P.own.fw) { showMsg('No fireworks. The harbour shed sells them.', '', 2); return; }
  if (i === 5 && P.flares <= 0) { showMsg('No flares left. The harbour shed sells them.', '', 2.5); return; }
  if (i === 2 && !P.own.rod) { showMsg('You need a fishing rod. Buy one at the harbour shed.', '', 2.5); return; }
  if (i === 3 && !P.own.glock) { showMsg('You do not own a Glock. The harbour shed sells them.', '', 2.5); return; }
  if (i === 4 && !P.own.sg) { showMsg('You do not own a shotgun. The harbour shed sells them.', '', 2.5); return; }
  const eq = i; if (eq === P.eq) return; P.eq = eq; P.reload = 0; F.st = 'idle'; Snd.click();
  if (eq === 2) { try { if (!localStorage.getItem('s9-fishhelp')) showFishHelp(true); } catch (e) {} }
}
// key slots: 1 hands, 2 rod (eq 2), 3 glock (eq 3), 4 shotgun (eq 4)
function toolDown() { if (!P) return;
  if (G.shopOpen || G.helpOpen || P.hd >= 0 || P.seat || P.down) return;
  if (P.eq === 5) { throwFlare(); return; }
  if (P.eq === 6) { launchFw(); return; }
  if (P.eq === 3 || P.eq === 4) fire();
  else if (P.eq === 2) { if (F.st === 'idle') { if (P.sw) return; F.st = 'charge'; F.pow = 0; } else if (F.st === 'bite') hook(); else if (F.st === 'wait') { F.st = 'idle'; showMsg('You reel the line back in.', '', 1.5); } }
}
function toolUp() { if (!P) return; if (P.eq === 2 && F.st === 'charge') castLine(); }
function fire() {
  const w = P.eq === 3 ? 'g' : 's', A = P.ammo;
  if ((G.fireT || 0) > 0 || P.reload > 0 || P.sw) return;
  if (w === 'g' ? A.gm <= 0 : A.sm <= 0) { Snd.click(); if ((w === 'g' ? A.g : A.s) > 0) reload(); else showMsg('Out of ammo. The harbour shed sells more.', '', 2); return; }
  if (w === 'g') { A.gm--; G.fireT = .13; } else { A.sm--; G.fireT = .85; }
  saveGear();
  cam.getWorldDirection(_fw); const o = [cam.position.x, cam.position.y, cam.position.z];
  gunFx(o, w, true); P.pitch = clamp(P.pitch + (w === 'g' ? .02 : .06), -1.45, 1.45); G.recoil = 1;
  act({a: 'shoot', w, o: o.map(v => +v.toFixed(2)), d: [+_fw.x.toFixed(3), +_fw.y.toFixed(3), +_fw.z.toFixed(3)]});
}
function reload() {
  const A = P.ammo; if (P.reload > 0) return;
  if (P.eq === 3 && A.g > 0 && A.gm < 17) { P.reload = 1.4; P.rk = 'g'; Snd.reload(); }
  else if (P.eq === 4 && A.s > 0 && A.sm < 6) { P.reload = .55; P.rk = 's'; Snd.reload(); }
}
const gunL = new THREE.PointLight(0xffd090, 0, 18, 1.6); scene.add(gunL);
function gunFx(o, w, own) {
  gunL.position.set(o[0], o[1], o[2]); gunL.intensity = w === 'g' ? 30 : 60; G.gunFlash = .06;
  Snd.gun(w, own ? null : at(o[0], o[1], o[2], 8));
}
const HITS = [];
function hitFx(x, y, z, head) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x6aff9a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.position.set(x, y, z); s.scale.setScalar(head ? .9 : .6); scene.add(s); HITS.push({s, t: .25});
  Snd.hurt(A.mPan);
}
const _lo2 = {};
function hostShoot(p, m) {
  const o = m.o, d = m.d; if (!o || !d || p.down || p.dead) return;
  emit({k: 'shot', id: p.id, x: o[0], y: o[1], z: o[2], w: m.w}); noise(o[0], o[1] - 1.5, o[2], m.w === 'g' ? 60 : 80);
  const pel = m.w === 'g' ? [[0, 0, 0]] : Array.from({length: 8}, () => [(CR() - .5) * .1, (CR() - .5) * .1, (CR() - .5) * .1]);
  let dm = 0, hp = null, head = false, dd = 0;
  for (const j of pel) {
    let ux = d[0] + j[0], uy = d[1] + j[1], uz = d[2] + j[2]; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
    if (M.state !== 'dead' && M.state !== 'gone' && nearRig(M.x, M.z)) {
      const hh = ux * ux + uz * uz, t = hh > 1e-6 ? ((M.x - o[0]) * ux + (M.z - o[2]) * uz) / hh : 0;
      if (t > 0 && t < 70) {
        const px = o[0] + ux * t, py = o[1] + uy * t, pz = o[2] + uz * t, lo = M.y + .2, hi = M.y + ((M.four || 0) > .5 ? 1.5 : 2.75);
        if (Math.hypot(px - M.x, pz - M.z) < .45 && py > lo - .15 && py < hi + .15) {
          let blocked = false; for (const w of WALLS) { if (!w.see || w.y0 > py || w.y1 < py) continue; if (segRect(o[0], o[2], px, pz, w)) { blocked = true; break; } }
          if (!blocked) { const isHead = py > hi - .35, base = m.w === 'g' ? 10 : 7 * (t > 20 ? .4 : 1); dm += base * (isHead ? 2 : 1); head = head || isHead; hp = [px, py, pz]; }
        }
      }
    }
    if (G.enc) { const lp = levPose(G.enc.a, G.enc.el, G.enc.L || 9, _lo2), far = Math.hypot(lp.x - o[0], lp.z - o[2]) > 15;
      const hitS = (cx, cy, cz, r) => { const tt = (cx - o[0]) * ux + (cy - o[1]) * uy + (cz - o[2]) * uz; return tt > 0 && tt < 90 && Math.hypot(o[0] + ux * tt - cx, o[1] + uy * tt - cy, o[2] + uz * tt - cz) < r; };
      const pd = m.w === 'g' ? 10 : far ? 3 : 6;
      if (lp.y > -1.2 && hitS(lp.x, lp.y + .5, lp.z, 3.2)) { dd += pd * (lp.ph === 1 ? 2.5 : 1); G.enc.hh = 1; }
      else if (lp.ph === 0) { for (let k = 1; k < 7; k++) { const an = G.enc.a + G.enc.el * .45 - k * .32; if (hitS(B.x + Math.sin(an) * 19, -.3, B.z + Math.cos(an) * 19, 2.6)) { dd += pd * .6; break; } } } }
  }
  if (STS.state !== 'dead' && STS.state !== 'gone' && Math.hypot(STS.x - o[0], STS.z - o[2]) < 70) {
    let sd = 0, sh = false, shp = null; for (const j of pel) { let ux = d[0] + j[0], uy = d[1] + j[1], uz = d[2] + j[2]; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l; const hh = ux * ux + uz * uz, t = hh > 1e-6 ? ((STS.x - o[0]) * ux + (STS.z - o[2]) * uz) / hh : 0;
      if (t <= 0 || t > 70) continue; const px = o[0] + ux * t, py = o[1] + uy * t, pz = o[2] + uz * t, hi = STS.y + 3.4; if (Math.hypot(px - STS.x, pz - STS.z) < .55 && py > STS.y && py < hi + .1 && seeLine(o[0], o[1] - 1.5, o[2], px, py - 1, pz)) { const head = py > hi - .45; sd += (m.w === 'g' ? 10 : 7 * (t > 20 ? .4 : 1)) * (head ? 2 : 1); sh = sh || head; shp = [px, py, pz]; } }
    if (sd) { STS.hp -= sd; emit({k: 'shit', x: +shp[0].toFixed(2), y: +shp[1].toFixed(2), z: +shp[2].toFixed(2), head: sh}); if (STS.hp <= 0) { STS.state = 'dead'; STS.deadT = 4; emit({k: 'sdown'}); const it = addItem('relic', {x: STS.x + .5, y: STS.y, z: STS.z}); emit({k: 'item', i: it.i, kind: 'relic', x: STS.x + .5, y: STS.y, z: STS.z}); } else if (STS.state !== 'chase') { STS.state = 'chase'; STS.tgt = p.id; STS.lx = p.x; STS.ly = p.y; STS.lz = p.z; STS.lost = 0; } }
  }
  if (dm) {
    M.hp -= dm; emit({k: 'mhit', x: +hp[0].toFixed(2), y: +hp[1].toFixed(2), z: +hp[2].toFixed(2), head});
    if (M.hp <= 0) { M.state = 'dead'; M.deadT = 3.5; M.tgt = null; emit({k: 'mdown'}); const it = addItem('fang', {x: M.x + .5, y: M.y, z: M.z}); emit({k: 'item', i: it.i, kind: 'fang', x: M.x + .5, y: M.y, z: M.z}); goal(6); }
    else if (nearRig(p.x, p.z) && M.state !== 'chase') { M.state = 'chase'; M.tgt = p.id; M.aware = 1.5; M.lx = p.x; M.ly = p.y; M.lz = p.z; M.lostT = 0; M.seenAt = G.t; emit({k: 'snd', s: 'stinger'}); }
  }
  if (dd && G.enc) { G.enc.hp -= dd; const lp = levPose(G.enc.a, G.enc.el, G.enc.L || 9, _lo2); emit({k: 'dhit', x: +lp.x.toFixed(1), y: +Math.max(0, lp.y).toFixed(1), z: +lp.z.toFixed(1), h: G.enc.hh ? 1 : 0}); G.enc.hh = 0;
    if (G.enc.hp <= 0) { G.enc = null; G.deepT = 90; emit({k: 'deepgone', dead: 1}); let i = G.floats.findIndex((q, j) => !q && j < 16); if (i < 0) { let bd = -1; for (let j = 0; j < 16; j++) { const q = G.floats[j], d = q ? Math.hypot(q[0] - B.x, q[1] - B.z) : 1e9; if (d > bd) { bd = d; i = j; } } } if (i >= 0) G.floats[i] = [lp.x, lp.z, KINDS.indexOf('relic')]; } }
}
// fishing (each player fishes on their own screen; the host only records the catch)
const F = {st: 'idle', pow: 0, t: 0, ten: 0, prog: 0, k: null, slack: 0, bob: null, surge: 0, surgeT: 0};
function castLine() {
  cam.getWorldDirection(_fw); const sp = 5 + F.pow * 15;
  F.bob = {x: cam.position.x + _fw.x, y: cam.position.y, z: cam.position.z + _fw.z, vx: _fw.x * sp, vy: _fw.y * sp + 4, vz: _fw.z * sp}; F.st = 'cast'; Snd.cast();
}
function hook() { F.k = pickFish(F.bob.x, F.bob.z, P.own.rod); F.st = 'reel'; F.ten = 45; F.prog = 8; F.slack = 0; F.surgeT = 1; F.surge = 0; F.ph = Math.random() * 6; F.sx = F.bob.x; F.sz = F.bob.z; Snd.hook(); }
function stepGear(dt) {
  if (!P || !P.own) return;
  G.fireT = (G.fireT || 0) - dt;
  if (P.reload > 0) { P.reload -= dt; if (P.reload <= 0) { const A = P.ammo; if (P.rk === 'g') { const n = Math.min(17 - A.gm, A.g); A.gm += n; A.g -= n; } else if (A.s > 0) { A.sm++; A.s--; if (A.sm < 6 && A.s > 0 && P.eq === 4) { P.reload = .55; Snd.reload(); } } saveGear(); } }
  if (P.eq !== 2 || P.seat || P.down || P.dead) { if (F.st !== 'idle') F.st = 'idle'; return; }
  const rod = P.own.rod;
  switch (F.st) {
    case 'charge': F.pow = Math.min(1, F.pow + dt / 1.2); break;
    case 'cast': { const b = F.bob; b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const fl = floorAt(b.x, b.z, b.y);
      if (fl && fl.y > -1.3 && b.y <= fl.y + .05) { F.st = 'idle'; showMsg(fl.s.k === 'boat' ? 'That landed on the deck. Cast out over the rail.' : 'That landed on dry ground. Cast into open water.', '', 2.5); break; }
      if (b.y <= 0) { if (fl && fl.y > -1.6) { F.st = 'idle'; showMsg('Too shallow here. Cast further out.', '', 2.5); break; } F.st = 'wait'; F.t = (5 + Math.random() * 9) / (1 + .35 * (rod - 1)); Snd.splash(at(b.x, 0, b.z, 3)); }
      if (Math.hypot(b.x - P.x, b.z - P.z) > 45) F.st = 'idle'; break; }
    case 'wait': F.t -= dt; if (F.t <= 0) { F.st = 'bite'; F.t = 1.1 + .2 * rod; Snd.bite(); } break;
    case 'bite': F.t -= dt; if (F.t <= 0) { F.st = 'wait'; F.t = 4 + Math.random() * 6; showMsg('It took the bait and got away. Click faster when you see !', '', 2.5); } break;
    case 'reel': {
      const f = FISH[F.k], kf = [1, 1, .72, .52][rod];
      F.surgeT -= dt; if (F.surgeT <= 0) { F.surge = .5 + Math.random() * .8; F.surgeT = (1.5 + Math.random() * 2.5) / f.s; }
      F.surge = Math.max(0, F.surge - dt);
      const pull = f.s * (.5 + .5 * Math.sin(G.wt * 2.3 + F.ph)) + (F.surge > 0 ? f.s * 1.6 : 0);
      if (G.lmb) F.ten += dt * (50 + pull * 30) * kf; else F.ten -= dt * 48;
      if (F.surge > 0) F.ten += dt * 40 * f.s * kf;
      const inZ = F.ten >= 30 && F.ten <= 75;
      F.prog += dt * (inZ ? (G.lmb ? 24 : 7) / f.s : F.ten > 75 ? 3 / f.s : -7);
      F.prog = Math.max(0, F.prog);
      if (G.lmb && Math.random() < dt * 8) Snd.tick();
      if (F.ten >= 100) { F.st = 'idle'; Snd.snap(); showMsg('SNAP! The line broke. Ease off when the needle jumps.', '', 3); }
      else if (F.ten <= 0) { F.ten = 0; F.slack += dt; if (F.slack > 1.6) { F.st = 'idle'; showMsg('Too much slack. It slipped the hook.', '', 2.5); } } else F.slack = 0;
      if (F.prog >= 100) { F.st = 'idle'; const kg = +(f.kg[0] + Math.random() * (f.kg[1] - f.kg[0])).toFixed(1); act({a: 'fish', f: F.k, kg}); Snd.discover(); if (F.k !== 'bottle') toast(`${f.n}`, `${kg} kg · $${f.v} · in your cooler`); }
      const k = Math.min(1, F.prog / 100); F.bob.x = mix(F.sx, P.x, k * .9); F.bob.z = mix(F.sz, P.z, k * .9);
      break;
    }
  }
}
// viewmodels: glock, shotgun, rod + line + bobber
const VMG = new THREE.Group(), VMS = new THREE.Group(), VMR = new THREE.Group(); cam.add(VMG, VMS, VMR);
let ROD_TIP = null, LINE = null, BOB = null, MFLASH = null;
(function toolModels() {
  const blk = new THREE.MeshStandardMaterial({color: 0x1a1c1e, metalness: .6, roughness: .35}), glove = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .6}), wood = new THREE.MeshStandardMaterial({color: 0x5a3a22, roughness: .6});
  const add = (g, geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  add(VMG, new THREE.BoxGeometry(.032, .036, .19), blk, 0, .02, -.05); add(VMG, new THREE.BoxGeometry(.03, .1, .045), blk, 0, -.04, .02, -.25); add(VMG, new THREE.SphereGeometry(.04, 8, 6), glove, 0, -.05, .04);
  VMG.position.set(.16, -.16, -.34); VMG.scale.setScalar(1.35); VMS.scale.setScalar(1.15);
  add(VMS, new THREE.CylinderGeometry(.013, .013, .75, 8), blk, 0, .02, -.3, PI / 2); add(VMS, new THREE.CylinderGeometry(.02, .02, .2, 8), wood, 0, -.012, -.3, PI / 2); add(VMS, new THREE.BoxGeometry(.045, .07, .25), wood, 0, -.03, .12); add(VMS, new THREE.BoxGeometry(.04, .05, .14), blk, 0, 0, -.02);
  add(VMS, new THREE.SphereGeometry(.04, 8, 6), glove, 0, -.04, -.32); add(VMS, new THREE.SphereGeometry(.04, 8, 6), glove, .01, -.05, .02);
  VMS.position.set(.17, -.19, -.38);
  const rod = new THREE.Group(); VMR.add(rod); rod.rotation.x = -.95; const fib = new THREE.MeshStandardMaterial({color: 0xd8b040, roughness: .4, metalness: .2});
  add(rod, new THREE.CylinderGeometry(.018, .022, .3, 8), wood, 0, 0, 0); add(rod, new THREE.CylinderGeometry(.005, .011, 1.7, 6), fib, 0, .98, 0); add(rod, new THREE.CylinderGeometry(.035, .035, .04, 10), blk, .04, .08, 0, 0).rotation.z = PI / 2;
  ROD_TIP = new THREE.Object3D(); ROD_TIP.position.set(0, 1.83, 0); rod.add(ROD_TIP); VMR.userData.rod = rod;
  add(VMR, new THREE.SphereGeometry(.045, 8, 6), glove, 0, -.02, 0);
  VMR.position.set(.3, -.34, -.45);
  MFLASH = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow || null, color: 0xffd080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); MFLASH.scale.setScalar(.25); MFLASH.visible = false; cam.add(MFLASH);
  for (const g of [VMG, VMS, VMR]) { g.visible = false; g.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  LINE = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color: 0xdddddd, transparent: true, opacity: .6})); LINE.frustumCulled = false; scene.add(LINE);
  BOB = new THREE.Group(); const bw = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshStandardMaterial({color: 0xeeeeee})), br = new THREE.Mesh(new THREE.SphereGeometry(.071, 10, 8, 0, TAU, 0, PI / 2), new THREE.MeshStandardMaterial({color: 0xd02010, emissive: 0x300000})); BOB.add(bw, br); scene.add(BOB);
})();
function updateTools(dt) {
  const own = alivePlay() && P.hd < 0 && !P.seat && !P.down && !P.sw;
  VMG.visible = own && P.eq === 3; VMS.visible = own && P.eq === 4; VMR.visible = own && P.eq === 2;
  G.recoil = Math.max(0, (G.recoil || 0) - dt * 6); const rc = G.recoil || 0, rl = P.reload > 0 ? Math.sin(Math.min(1, P.reload) * PI) : 0;
  VMG.position.set(.16, -.16 - rl * .12, -.34 + rc * .05); VMG.rotation.x = rc * .3 - rl * .6;
  VMS.position.set(.17, -.19 - rl * .08, -.38 + rc * .1); VMS.rotation.x = rc * .25;
  const aim = mouseR && own && P.eq >= 3; G.aimK = mix(G.aimK || 0, aim ? 1 : 0, Math.min(1, dt * 10));
  if (G.aimK > .01) { VMG.position.x = mix(.16, 0, G.aimK); VMG.position.y += G.aimK * .05; VMS.position.x = mix(.17, 0, G.aimK); VMS.position.y += G.aimK * .07; }
  G.runK = mix(G.runK || 0, P && P.run ? 1 : 0, Math.min(1, dt * 4)); const fov = mix(70 + G.runK * 6 - (G.js && G.js.t > 0 ? 12 : 0), 52, G.aimK); if (Math.abs(cam.fov - fov) > .05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  $('xhair').classList.toggle('hidden', !(own && P.eq >= 3));
  G.gunFlash = (G.gunFlash || 0) - dt; gunL.intensity = G.gunFlash > 0 ? gunL.intensity : 0;
  if (VMF.visible && G.gunFlash <= 0) { VMF.userData.tip.getWorldPosition(gunL.position); gunL.color.setHex(0xff3018); gunL.intensity = 14 * (.8 + Math.random() * .4); gunL.distance = 22; VMF.userData.tip.scale.setScalar(.8 + Math.random() * .5); if (Math.random() < dt * 3) Snd.flare && Math.random() < .3 && Snd.flare(null); }
  else if (G.gunFlash > 0) gunL.color.setHex(0xffd090);
  if (!MFLASH.material.map && TX.glow) { MFLASH.material.map = TX.glow; MFLASH.material.needsUpdate = true; }
  MFLASH.visible = G.gunFlash > 0 && own && P.eq >= 3; if (MFLASH.visible) MFLASH.position.copy(P.eq === 3 ? VMG.position : VMS.position).add(_v.set(0, .02, P.eq === 3 ? -.17 : -.7));
  for (let i = HITS.length - 1; i >= 0; i--) { const h = HITS[i]; h.t -= dt; h.s.material.opacity = Math.max(0, h.t * 4); if (h.t <= 0) { scene.remove(h.s); HITS.splice(i, 1); } }
  // rod, bobber and line
  const fishing = own && P.eq === 2 && F.st !== 'idle' && F.st !== 'charge' && F.bob;
  VMR.userData.rod.rotation.x = -.95 + (F.st === 'charge' ? F.pow * .9 : 0) + (F.st === 'reel' ? -.25 - Math.sin(G.wt * 20) * .02 * F.ten / 50 : 0);
  BOB.visible = !!fishing; LINE.visible = !!fishing && VMR.visible;
  if (fishing) {
    const b = F.bob, wy = F.st === 'cast' ? b.y : waveH(b.x, b.z, G.wt) - (F.st === 'bite' ? .18 + Math.sin(G.wt * 18) * .06 : F.st === 'reel' ? .1 : 0);
    BOB.position.set(b.x, wy, b.z); cam.updateMatrixWorld(); ROD_TIP.getWorldPosition(_v);
    const pa = LINE.geometry.attributes.position; pa.setXYZ(0, _v.x, _v.y, _v.z); pa.setXYZ(1, b.x, wy, b.z); pa.needsUpdate = true;
  }
  const ui = $('fishUI'), show = own && P.eq === 2 && F.st !== 'idle' && F.st !== 'cast';
  ui.classList.toggle('hidden', !show);
  if (show) {
    const t = $('fishT'); t.className = F.st === 'bite' ? 'bite' : '';
    t.textContent = F.st === 'charge' ? 'Casting power: let go to cast' : F.st === 'wait' ? 'Waiting for a bite… (click to reel in)' : F.st === 'bite' ? '! CLICK !' : 'Hold to reel, let go to ease off. Keep it in the green.';
    $('tenBar').style.display = F.st === 'reel' ? 'block' : 'none';
    $('progBar').style.display = F.st === 'reel' || F.st === 'charge' ? 'block' : 'none';
    $('progFill').style.width = (F.st === 'charge' ? F.pow * 100 : Math.min(100, F.prog)) + '%';
    $('tenNeedle').style.left = clamp(F.ten, 0, 100) + '%';
  }
  // hud tool line
  const A = P.ammo || {}, own2 = P.own || {};
  const S7 = [['✋', 'Hands', 1, ''], ['🔦', 'Flashlight', 1, P.l ? '' : 'off'], ['🎣', ['', 'Rod', 'Carbon rod', 'Deep-sea rod'][own2.rod || 0], own2.rod, ''], ['🔫', 'Glock', own2.glock, `${A.gm}/${A.g}`], ['💥', 'Shotgun', own2.sg, `${A.sm}/${A.s}`], ['🔥', 'Flare', P.flares > 0, P.flares], ['🎆', 'Fireworks', own2.fw > 0, own2.fw]];
  const hk = P.eq + '|' + S7.map(q => q[2] ? 1 : 0).join('') + '|' + S7[P.eq][3] + '|' + (P.reload > 0) + '|' + (P.coolerN || 0);
  if (hk !== G.toolK) { G.toolK = hk; $('tool').innerHTML = S7.map((q, i) => q[2] ? `<b class="${P.eq === i ? 'on' : ''}"><em>${i + 1}</em>${q[0]}${P.eq === i ? ` <span>${q[1]}${q[3] !== '' ? ' ' + q[3] : ''}</span>` : ''}</b>` : '').join('') + (P.reload > 0 ? '<span class="rl">reloading</span>' : '') + (P.coolerN ? `<span class="rl">🐟 ${P.coolerN}</span>` : ''); }
}

// ---------------- game flow
let BUILT = false;
function buildWorld() {
  if (BUILT) return; BUILT = true;
  textures(); materials(); buildRig(); buildHome(); buildIsleSites(); buildWrecks(); buildIsles(); buildBuoys(); buildSea(); buildBoat(); buildCreature(); buildNav(); buildFauna(); buildCruise(); buildDeep(); buildFw(); makeCreature(STW, SJ, {col: 0xa8a49a, s: 1.3, mask: 1});
  for (const k in BK) { const m = new THREE.Mesh(mergeGeos(BK[k]), MAT[k]); m.castShadow = !['glass', 'bulb', 'glassL', 'screen'].includes(k); m.receiveShadow = true; scene.add(m); }
  const avi = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); avi.scale.setScalar(3); avi.position.set(...G.avi); scene.add(avi); G.aviS = avi;
  const lg = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xfff0c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .8})); lg.scale.setScalar(14); lg.position.set(...G.lh); scene.add(lg);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(14, 160, 16, 1, true), new THREE.MeshBasicMaterial({color: 0xfff4d0, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false}));
  beam.geometry.translate(0, -80, 0); beam.geometry.rotateX(-PI / 2 + .04); const bg = new THREE.Group(); bg.add(beam); scene.add(bg); G.lhBeam = bg;
  for (const b of BUOYS) { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({color: b.c, roughness: .5}); g.add(new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.1, .8, 12), m)); const cage = new THREE.Mesh(new THREE.CylinderGeometry(.15, .3, 3, 6), m); cage.position.y = 1.8; g.add(cage); const l = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: b.c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); l.scale.setScalar(3); l.position.y = 3.6; g.add(l); g.position.set(b.x, 0, b.z); scene.add(g); b.m = g; b.l = l; }
  G.ghostS = G.ghostLights.map(p => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x6affb0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); s.scale.setScalar(2.4); s.position.set(...p); scene.add(s); return s; });
  G.homeLamps = [[G.shed.x + 4, 5, G.shed.z, 1], [0, 4.5, -236, 1.2]];
  $('load').classList.add('hidden');
}
function startGame(seed, crew, sv) {
  buildWorld(); aInit(); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  D = DIFF[G.diff || SET.diff] || DIFF.normal;
  RND.shadowMap.enabled = SET.gfx === 'high'; flash.castShadow = SET.gfx === 'high'; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  POST.on = SET.gfx === 'high'; if (POST.on) postInit(); RND.toneMappingExposure = POST.on ? 1 : 1.15;
  canvas.style.filter = SET.bright !== 1 ? `brightness(${SET.bright})` : '';
  G.seed = seed; WR = mulberry(seed); CR = mulberry(seed ^ 0x5bd1e995); placeSunk(seed);
  Object.assign(G, {on: true, t: 0, evq: [], holdP: {}, noteOpen: false, paused: false, spec: 0, whT: 0, poseT: 0, sendT: 0, power: false, bbOut: false, spines: null, alarmT: 0, objLast: '', shake: 0, storm: 0, stormOn: false, stormT: 200, tod: .015, todPh: -1, enc: null, deepT: 40, shopOpen: false, cash: 0, earned: 0, disc: [], goals: [], floats: []});
  for (const f of G.flares) scene.remove(f.m); G.flares = []; VALVES.forEach(v => v.open = false); MAT.bulb.emissiveIntensity = 0; MAT.screen.emissiveIntensity = 0;
  DIGS.forEach(d => { d.dug = false; d.rev = false; });
  B.up = {engine: 0, tank: 0, hull: 0, light: 0, sonar: 0, hold: 0, crane: 0, cls: 0}; B.hold = []; B.dep = B.dtar = 0;
  G.cruise = 0; if (sv) { G.cruise = sv.cruise || 0; G.cash = sv.cash || 0; G.earned = sv.earned || 0; Object.assign(B.up, sv.up || {}); G.disc = (sv.disc || []).slice(); G.goals = (sv.goals || []).slice(); }
  if (!BOAT || BOAT.userData.cls !== (B.up.cls || 0)) buildBoat();
  Object.assign(B, {x: JETTY.x - 2.1 - BG.hw, z: JETTY.z + 3 + Math.max(0, BG.L - 12) * .5, yaw: PI, v: 0, thr: 0, st: 0, driver: null, got: 0, sink: 0, sinkY: 0, dep: 0, dtar: 0}); B.fuel = tankMax(); B.hull = hullMax();
  for (const p of PL.values()) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); } PL.clear();
  syncCrew(crew);
  [...PL.values()].forEach((p, i) => { p.ob = 1; p.bl = [(i % 2 ? .9 : -.9), BSPOT.hold[1] + (BG.sub ? -1.6 : 1.8) + Math.floor(i / 2) * (BG.sub ? -1 : 1)]; const [x, z] = bL2W(p.bl[0], p.bl[1]); p.x = x; p.z = z; p.y = BDECK.y; p.rx = x; p.ry = p.y; p.rz = z; p.lx = x; p.lz = z; p.yaw = B.yaw; });
  loadGear(); Object.assign(P, {eq: 1, sack: [], heldF: 0, reload: 0, coolerN: 0, coolerV: 0, ready: true, vx: 0, vz: 0, vy: 0, stam: 1, bat: 1, flares: 2, breath: 1, gasp: 0, bob: 0, stepD: 0, fear: 0, eye: 1.62, l: 1, cr: 0, hd: -1, sw: 0, seat: 0, lastBY: B.yaw, drowned: false, carry: null});
  F.st = 'idle'; placeItems(); applyAll();
  for (let i = 0; i < FLM.length; i++) if (FLM[i]) { scene.remove(FLM[i].m); FLM[i] = null; }
  G.floats = []; for (let i = 0; i < 16; i++) spawnFloat(i);
  Object.assign(M, {hp: D.mhp, x: -4, z: 6, y: LV[2], state: 'roam', path: [], idle: 2, aware: 0, lostT: 0, flee: 0, sawHide: -1, stuck: 0, screamT: 0, spd: 0, look: 0, tgt: null, preyT: 0, avoidT: 0, vy: 0, wet: 0});
  M.tx = M.x; M.ty = M.y; M.tz = M.z; M.tyaw = 0;
  ['slats', 'breath', 'map', 'note', 'end', 'pause', 'menu', 'lobby', 'shop'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); lockMouse();
  const hi = POIS.findIndex(q => q.home); if (!G.disc.includes(hi)) G.disc.push(hi);
  const it = $('intro'); it.innerHTML = sv && sv.disc && sv.disc.length > 1 ? `Back at the lighthouse.<br>$${G.cash} in the tin, ${G.disc.length} places on the chart.<br><br>The sea is waiting.` : 'A boat, a lighthouse, and a long night of open sea.<br>Find salvage. Sell it. Fix up the boat.<br><br>And stay out of deep water.';
  it.classList.remove('hidden'); it.style.opacity = 1; setTimeout(() => it.style.opacity = 0, TEST ? 0 : 4000); setTimeout(() => it.classList.add('hidden'), TEST ? 0 : 6000);
}
function step(dt) {
  if (isHost()) hostStep(dt);
  else { const k = Math.min(1, dt * 10); if (STS.tx != null) { STS.x = mix(STS.x, STS.tx, k); STS.y = mix(STS.y, STS.ty, k); STS.z = mix(STS.z, STS.tz, k); STS.yaw += angD(STS.yaw, STS.tyaw) * k; } if (M.tx != null) { M.x = mix(M.x, M.tx, k); M.y = mix(M.y, M.ty, k); M.z = mix(M.z, M.tz, k); M.yaw += angD(M.yaw, M.tyaw) * k; } G.t += dt; }
  stepPlayer(dt); stepInteract(dt); stepFlares(dt); stepGear(dt);
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
  if (G.on && !(G.paused && Net.role === 'solo') && !((G.noteOpen || G.shopOpen) && Net.role === 'solo')) step(dt);
  render(dt);
}
// ---------------- post (High): HDR scene -> bloom -> grade -> ACES
const POST = {on: false, ex: 1.1};
function postInit() {
  const w = Math.max(2, innerWidth), h = Math.max(2, innerHeight), pr = RND.getPixelRatio();
  if (!POST.rt) {
    POST.rt = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 2}); POST.a = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType}); POST.b = POST.a.clone();
    const V = 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const mk = (u, f) => new THREE.ShaderMaterial({uniforms: u, vertexShader: V, fragmentShader: f, depthTest: false, depthWrite: false, toneMapped: false});
    POST.bright = mk({t: {value: null}}, 'varying vec2 vU; uniform sampler2D t; void main(){ vec3 c = texture2D(t, vU).rgb; float l = dot(c, vec3(.3,.59,.11)); gl_FragColor = vec4(c * smoothstep(.85, 2.2, l) / max(l, 1e-3) * min(l, 6.), 1.); }');
    POST.blur = mk({t: {value: null}, d: {value: new THREE.Vector2()}}, 'varying vec2 vU; uniform sampler2D t; uniform vec2 d; void main(){ vec3 c = texture2D(t, vU).rgb * .227; c += (texture2D(t, vU + d * 1.385).rgb + texture2D(t, vU - d * 1.385).rgb) * .316; c += (texture2D(t, vU + d * 3.23).rgb + texture2D(t, vU - d * 3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }');
    POST.rays = mk({t: {value: null}, sp: {value: new THREE.Vector2(.5, .5)}}, 'varying vec2 vU; uniform sampler2D t; uniform vec2 sp; void main(){ vec2 d = (sp - vU) / 36.; vec2 p = vU; vec3 s = vec3(0.); float w = 1.; for (int i = 0; i < 36; i++) { s += texture2D(t, p).rgb * w; w *= .93; p += d; } gl_FragColor = vec4(s / 9., 1.); }');
    POST.c = POST.a.clone();
    POST.comp = mk({t: {value: null}, bl: {value: null}, rays: {value: null}, ex: {value: 1}, fear: {value: 0}, ti: {value: 0}, uw: {value: 0}, ca: {value: 0}, sunV: {value: 0}},
      `varying vec2 vU; uniform sampler2D t, bl, rays; uniform float ex, fear, ti, uw, ca, sunV;
      vec3 aces(vec3 v){ v *= .6; return clamp((v * (2.51 * v + .03)) / (v * (2.43 * v + .59) + .14), 0., 1.); }
      void main(){ vec2 uv = vU; if (uw > 0.) uv += vec2(sin(vU.y * 23. + ti * 2.1), cos(vU.x * 19. + ti * 1.7)) * .004 * uw;
        vec2 dc = uv - .5; float cb = ca * dot(dc, dc);
        vec3 c = vec3(texture2D(t, uv - dc * cb).r, texture2D(t, uv).g, texture2D(t, uv + dc * cb).b) + texture2D(bl, uv).rgb * .55;
        c += texture2D(rays, uv).rgb * sunV * vec3(1., .85, .65);
        if (sunV > 0.) { c += texture2D(bl, dc * -.7 + .5).rgb * vec3(.09, .06, .03) * sunV; c += texture2D(bl, dc * -1.4 + .5).rgb * vec3(.03, .06, .09) * sunV; c += texture2D(bl, dc * .45 + .5).rgb * vec3(.06, .05, .02) * sunV; }
        c = mix(c, c * vec3(.32, .78, .82) + vec3(0., .004, .006), uw);
        c *= ex; float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c, c * vec3(.92, 1.0, 1.12), smoothstep(.25, 0., l) * .6); c = mix(c, c * vec3(1.08, 1., .9), smoothstep(.3, 1.5, l) * .5);
        c = aces(c); float g = dot(c, vec3(.2126,.7152,.0722)); c = mix(vec3(g), c, 1.22 - fear * .55);
        vec2 q = vU - .5; c *= 1. - dot(q, q) * (.55 + fear * .6);
        c = pow(c, vec3(1. / 2.2)); c += (fract(sin(dot(vU * 917. + ti, vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255.;
        gl_FragColor = vec4(c, 1.); }`);
    POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), POST.bright); POST.quad.frustumCulled = false; POST.qs = new THREE.Scene(); POST.qs.add(POST.quad); POST.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  POST.rt.setSize(w * pr, h * pr); const bw = Math.max(2, Math.round(w * pr / 4)), bh = Math.max(2, Math.round(h * pr / 4)); POST.a.setSize(bw, bh); POST.b.setSize(bw, bh); POST.c.setSize(bw, bh); POST.bw = bw; POST.bh = bh;
}
const _sv = new THREE.Vector3();
function sunVis() { if (!POST.sp) POST.sp = new THREE.Vector2(); if ((G.uw || 0) > .5) return 0; _sv.copy(SUNDIR).multiplyScalar(1000).add(cam.position).project(cam); if (_sv.z > 1 || cam.getWorldDirection(_fw).dot(SUNDIR) < 0) return 0;
  const e = Math.max(Math.abs(_sv.x), Math.abs(_sv.y)); POST.sp.set(_sv.x * .5 + .5, _sv.y * .5 + .5); return clamp(1.5 - e, 0, 1) * clamp((TOD.el + 2) / 5, 0, 1) * (1 - G.storm) * .7; }
function postPass(m, src, dst) { POST.quad.material = m; m.uniforms.t.value = src; RND.setRenderTarget(dst); RND.render(POST.qs, POST.qc); }
function postRender() {
  RND.setRenderTarget(POST.rt); RND.render(scene, cam);
  postPass(POST.bright, POST.rt.texture, POST.a);
  for (let i = 0; i < 2; i++) { POST.blur.uniforms.d.value.set(1 / POST.bw, 0); postPass(POST.blur, POST.a.texture, POST.b); POST.blur.uniforms.d.value.set(0, 1 / POST.bh); postPass(POST.blur, POST.b.texture, POST.a); }
  const sv = sunVis(); if (sv > 0) { POST.rays.uniforms.sp.value.copy(POST.sp); postPass(POST.rays, POST.a.texture, POST.c); }
  const u = POST.comp.uniforms; u.rays.value = POST.c.texture; u.sunV.value = sv; u.uw.value = G.uw || 0; u.ca.value = .012 + (P ? clamp(P.fear || 0, 0, 1) : 0) * .03 + (G.shake || 0) * .02 + (G.uw || 0) * .02; u.bl.value = POST.a.texture; u.ex.value = POST.ex; u.fear.value = P ? clamp(P.fear || 0, 0, 1) : 0; u.ti.value = G.wt % 10; postPass(POST.comp, POST.rt.texture, null);
}
addEventListener('resize', () => { if (POST.rt) postInit(); });
const DYN = {pr: Math.min(devicePixelRatio || 1, 1.25), max: Math.min(devicePixelRatio || 1, 1.25), ft: 1 / 60, t: 0, n: 0};
function dynRes(dt) {
  // adaptive resolution: drop the render scale when frames get slow, raise it back when there is headroom
  DYN.ft = mix(DYN.ft, dt, .05); DYN.t += dt; if (DYN.t < 1.5 || G.prLock) return; DYN.t = 0;
  let pr = DYN.pr; if (DYN.ft > 1 / 42 && pr > .55) pr = Math.max(.55, pr - .1); else if (DYN.ft < 1 / 57 && pr < DYN.max) pr = Math.min(DYN.max, pr + .05);
  if (pr !== DYN.pr) { DYN.pr = pr; RND.setPixelRatio(pr); resize(); if (POST.rt) postInit(); }
}
function render(dt) {
  dynRes(dt); G.fr = (G.fr || 0) + 1; if (RND.shadowMap.enabled) RND.shadowMap.needsUpdate = G.fr % 2 === 0 || G.fr < 5;
  G.cine = Math.max(0, (G.cine || 0) - dt);
  if (!G.on) { if (!G.drawn) { G.drawn = true; RND.render(scene, cam); } return; }
  updateWorldFx(dt); boatPose(dt); updateRemotes(dt); animCreature(dt, M.state, M.spd);
  { const sd = Math.hypot(cam.position.x - STS.x, cam.position.z - STS.z); STW.visible = sd < 160; if (sd < 160) animBody(STW, SJ, STS, dt, STS.state, STS.spd); } drawGulpers(dt); updateAuras(dt); stepFw(dt); stepFireflies(dt); updateCamera(dt); updateTools(dt); stepFear(dt); hud();
  if (G.map) drawMap(); if ((grainT += dt) > .05) { grainT = 0; grain(); }
  if (POST.on) postRender(); else RND.render(scene, cam);
}

// ---------------- menu, lobby
const myName = () => (SET.name || 'Deckhand').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Deckhand';
function crewList() { return [{id: 'H', name: myName(), c: 0}, ...[...Net.peers.values()].map(p => ({id: p.id, name: p.name, c: p.c}))]; }
function show(id) { ['menu', 'lobby', 'end', 'pause', 'shop'].forEach(k => $(k).classList.toggle('hidden', k !== id)); }
function lobby() { const L = crewList(); $('crew').innerHTML = L.map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === 'H' ? ' <small style="color:var(--dim)">host</small>' : ''}</div>`).join(''); if (Net.role === 'host') Net.send({t: 'lobby', crew: L}); }
function hostStart() { G.diff = SET.diff; const seed = (Math.random() * 1e9) | 0, crew = crewList(), sv = loadSave(); Net.started = true; Net.meta(true); Net.send({t: 'start', seed, crew, diff: G.diff, sv}); startGame(seed, crew, sv); }
Net.on('_lobby', () => { if (!G.on) lobby(); });
Net.on('_join', m => { if (G.on && Net.role === 'host') { const crew = crewList(); syncCrew(crew); const np = PL.get(m.id); if (np) { np.ob = 1; np.bl = [0, 3.8]; } Net.send1(m.id, {t: 'start', seed: G.seed, crew, diff: G.diff, late: 1, sv: {cash: G.cash, earned: G.earned, up: B.up, disc: G.disc, goals: G.goals}}); Net.send({t: 'crew', crew}); showMsg(`${np ? np.name : 'Someone'} joined the crew.`); } });
Net.on('_left', m => { if (!G.on) { lobby(); return; } const crew = crewList(); syncCrew(crew); Net.send({t: 'crew', crew}); showMsg(`${m.name || 'Someone'} left.`); });
Net.on('_hostgone', () => toMenu('The host left.'));
Net.on('lobby', m => { $('crew').innerHTML = (m.crew || []).map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${String(p.name).replace(/[<>&]/g, '')}</div>`).join(''); $('lmsg').textContent = 'Waiting for the captain to cast off…'; });
Net.on('start', m => { G.diff = m.diff; startGame(m.seed, m.crew, m.sv); if (m.late) showMsg('You came aboard late.'); });
Net.on('crew', m => { if (G.on) syncCrew(m.crew); });
function toMenu(why) {
  if (G.on) save(); Net.close(); G.on = false; show('menu'); $('hud').classList.add('hidden'); $('fearV').style.opacity = 0; $('downV').style.opacity = 0; $('slats').classList.add('hidden');
  if (A.ctx) { A.ctx.resume(); for (const g of [A.pad, A.drone, A.mGrowl, A.mBreath.g, A.genG, A.alarmG, A.deepG, A.engG]) g.gain.value = 0; }
  try { document.exitPointerLock(); } catch (e) {} $('err').textContent = why || ''; refreshRooms(); saveInfo();
}
function saveInfo() { const s = loadSave(); $('saveInfo').textContent = s && (s.disc || []).length > 1 ? `Saved voyage: $${s.cash} cash, ${(s.disc || []).length} places charted, ${(s.goals || []).length}/${GOALS.length} goals.` : ''; }
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
  $('bSolo').onclick = () => { Net.close(); G.diff = SET.diff; startGame((Math.random() * 1e9) | 0, [{id: 'H', name: myName(), c: 0}], loadSave()); };
  $('bHost').onclick = () => { aInit(); buildWorld(); const code = Net.host(myName(), s => { $('lmsg').textContent = s === 'open' ? 'Share the code. Up to 6 crew. Friends can join mid-voyage.' : 'Connection lost, retrying…'; }); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('lmsg').textContent = 'Connecting…'; lobby(); };
  $('bJoin').onclick = () => joinRoom($('joinC').value); $('joinC').onkeydown = e => { if (e.key === 'Enter') joinRoom($('joinC').value); };
  $('bGo').onclick = hostStart; $('bLeave').onclick = () => toMenu(); $('resume').onclick = () => pause(false); $('quit').onclick = () => toMenu(); $('endMenu').onclick = () => toMenu();
  $('again').onclick = () => toMenu();
  $('bSell').onclick = () => { act({a: 'sell'}); setTimeout(drawShop, 150); }; $('shopX').onclick = closeShop;
  $('resetSave').onclick = e => { e.preventDefault(); if (confirm('Wipe your saved voyage (cash, upgrades, chart)?')) { try { localStorage.removeItem('s9-save2'); } catch (x) {} saveInfo(); } };
  $('bCheat').onclick = () => { const v = $('cheat').value.trim().toLowerCase(); if (v === 'rig67') { ALL = true; try { localStorage.setItem('s9-all', '1'); } catch (e) {} $('cheatM').textContent = 'Everything unlocked. Every hull, upgrade, suit, gun, aura and style is yours.'; if (G.on) applyAll(); Snd.coin && A.on && Snd.coin(); } else $('cheatM').textContent = v ? 'Nothing happens.' : ''; $('cheat').value = ''; };
  $('cheat').onkeydown = e => { if (e.key === 'Enter') $('bCheat').click(); };
  $('note').onclick = closeNote; $('fishHelpX').onclick = () => showFishHelp(false);
  refreshRooms(); saveInfo(); setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshRooms(); }, 8000);
}
menuInit();
setTimeout(() => { buildWorld(); requestAnimationFrame(frame); }, 30);
if (TEST) window.__S = {AURAS, applyAll, launchFw, FWK, get ALL() { return ALL; }, CN, CRZ, STS, GUL, DSITES, stepSteward, HULLS, SUNK, BG, BDECK, buildBoat, seaBed, render, levPose, LEV, MJ, TODd: () => SUNDIR, TOD, F, FISH, GEAR, equip, toolDown, toolUp, gotGear, pickFish, hostShoot, G, PL, M, B, K, SET, VALVES, ITEMS, HIDES, BLD, SPOTS, NG, SURF, POIS, DIGS, ISLES, Net, get P() { return P; }, startGame, step, hostStep, hostAct, act, targets, toggleHide, cam, scene, RND, noise, downPlayer, floorAt, navPath, applyEv, boatPose, landH, openShop, set eDown(v) { eDown = v; }, crewList, hostStart, joinRoom};
