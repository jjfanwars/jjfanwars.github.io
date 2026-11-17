// Black Hollow: online co-op survival horror in a mountain valley. World, creature AI, net, audio, UI.
'use strict';
const $ = id => document.getElementById(id);
const TEST = /[?&]test/.test(location.search);
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = mulberry(4411);       // world layout (same on every client)
let WR = mulberry(1);           // per run (items), seeded by the host
let CR = Math.random;           // creature decisions (host only)
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }

// ---------------- settings
const SET = Object.assign({diff: 'normal', sens: 1, bright: 1, gfx: 'high', name: ''}, (() => { try { return JSON.parse(localStorage.getItem('bh-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('bh-set', JSON.stringify(SET)); } catch (e) {} };
const DIFF = {
  easy:      {chase: 4.6, sight: 24, hear: .7,  checkP: .3,  breathHear: .1, lost: 2.5, escape: 90,  roam: 70, hint: 0,  react: .7,  bleed: 60, down: 14},
  normal:    {chase: 5.3, sight: 32, hear: 1,   checkP: .55, breathHear: .3, lost: 4,   escape: 110, roam: 55, hint: 15, react: .45, bleed: 45, down: 10},
  nightmare: {chase: 5.9, sight: 40, hear: 1.3, checkP: .8,  breathHear: .6, lost: 6,   escape: 130, roam: 40, hint: 9,  react: .28, bleed: 30, down: 7},
};
let D = DIFF.normal;
const CREW_COL = [0xd0542a, 0x2f7fd8, 0xd8b02a, 0x3aa04a, 0x9a5ad8, 0xd84a9a];
const hexS = c => '#' + c.toString(16).padStart(6, '0');

// ---------------- net (jjfanwars relay; frames as in rally/js/net.js)
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const Net = {
  tag: '[Hollow]', role: 'solo', ws: null, peers: new Map(), code: '', relayT: {pose: 1}, id: '', name: '', handlers: {}, retry: 0, started: false, late: true,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) {
    if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} }
    else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} }
  },
  send1(id, o) { const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s group", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.started = false; this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(true); this.onStatus && this.onStatus('open'); this.emit({t: '_lobby'}); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') { if (!this.peers.has(id) && this.peers.size >= 5) { this.send1(id, {t: 'full'}); return; } const used = new Set([0, ...[...this.peers.values()].map(p => p.c)]); let c = 1; while (used.has(c)) c++; const p = {id, c, name: String(m.name || 'Hiker').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Hiker'}; if (!this.peers.has(id)) this.peers.set(id, p); this.emit({t: '_join', id}); this.emit({t: '_lobby'}); return; }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id);
      if (this.relayT[m.t]) this.send(m);
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
      if (m.t === 'full') { this.close(); onFail('That group is full.'); return; }
      if (m.from && m.from === this.id) return;
      this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such room.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null; this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(); const bare = this.tag.replace(/[\[\]]/g, ''); return r.filter(x => x.open && (x.name.startsWith(this.tag + ' ') || x.name.startsWith(bare + ' '))); } catch (e) { return []; } },
};
const isHost = () => Net.role !== 'guest';
const myId = () => Net.role === 'guest' ? Net.id : 'H';

// ---------------- world layout
const WS = 200, GS = 2, GN = WS * 2 / GS + 1;
const RIVER = [[-215, 28], [-160, 50], [-110, 36], [-62, 50], [-22, 34], [18, 44], [58, 24], [100, 34], [150, 10], [215, 20]];
const CAMP = {x: 0, z: -30};
const HELI = {x: -34, z: -118};
const BEA_POS = [[18, 148, 'North ridge'], [150, -6, 'East outcrop'], [-148, 74, 'Old lookout'], [104, -140, 'Quarry rim']];
const PADS = [];
const padC = (x, z, r, f, h) => PADS.push({c: 1, x, z, r, f, h});
const padR = (x0, x1, z0, z1, f, h) => PADS.push({c: 0, x0, x1, z0, z1, f, h});
function padW(p, x, z) {
  let d; if (p.c) d = Math.hypot(x - p.x, z - p.z) - p.r;
  else { const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1); d = Math.hypot(dx, dz); }
  return d <= 0 ? 1 : d >= p.f ? 0 : smooth(1 - d / p.f);
}
function segT(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, l = vx * vx + vz * vz; return l ? clamp(((px - ax) * vx + (pz - az) * vz) / l, 0, 1) : 0; }
function riverQ(x, z) { let d = 1e9, cx = 0, cz = 0; for (let i = 0; i < RIVER.length - 1; i++) { const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1], t = segT(x, z, ax, az, bx, bz), qx = ax + (bx - ax) * t, qz = az + (bz - az) * t, e = Math.hypot(x - qx, z - qz); if (e < d) { d = e; cx = qx; cz = qz; } } return {d, cx, cz}; }
function hills(x, z) { const r = Math.hypot(x, z * 1.08); return (fbm(x * .009 + 3, z * .009 - 7) - .5) * 22 + (fbm(x * .04, z * .04) - .5) * 2.5 + smooth((r - 135) / 60) * 46; }
function rawH(x, z) { const q = riverQ(x, z); let h = hills(x, z); if (q.d < 7) h -= smooth(1 - q.d / 7) * 1.8; return h; }
function waterY(cx, cz) { return hills(cx, cz) - 1.15; }
function baseH(x, z) { let h = rawH(x, z); for (const p of PADS) { const w = padW(p, x, z); if (w > 0) h += (p.h - h) * w; } return h; }
let HG = null;
function gH(x, z) {
  const fx = clamp((x + WS) / GS, 0, GN - 1.001), fz = clamp((z + WS) / GS, 0, GN - 1.001), i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const a = HG[j * GN + i], b = HG[j * GN + i + 1], c = HG[(j + 1) * GN + i], d = HG[(j + 1) * GN + i + 1];
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
const BRIDGES = [];
function bridgeY(x, z) { for (const b of BRIDGES) { const dx = x - b.x, dz = z - b.z, u = dx * b.nx + dz * b.nz, v = dx * b.tx + dz * b.tz; if (Math.abs(u) < b.hl && Math.abs(v) < 1.15) return b.y; } return -1e9; }
function wading(x, z) { if (bridgeY(x, z) > -1e8) return 0; const q = riverQ(x, z); return q.d < 3.6 ? 1 - q.d / 3.6 : 0; }

const WALLS = [], SOL = [], OBST = [], BLD = [], TREES = [], BUSHES = [], HIDES = [], SPOTS = [], INTER = [];
const ROT = {s: 0, w: PI / 2, n: PI, e: -PI / 2};
const L2W = (b, lx, lz) => { const c = Math.cos(b.th), s = Math.sin(b.th); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };
const W2L = (b, x, z) => { const c = Math.cos(b.th), s = Math.sin(b.th), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
function rectW(b, x0, x1, z0, z1) { const p = [L2W(b, x0, z0), L2W(b, x1, z1)]; return {x0: Math.min(p[0][0], p[1][0]), x1: Math.max(p[0][0], p[1][0]), z0: Math.min(p[0][1], p[1][1]), z1: Math.max(p[0][1], p[1][1])}; }
function zoneOf(x, z, m = 0) { for (let i = 0; i < BLD.length; i++) { const b = BLD[i], l = W2L(b, x, z); if (Math.abs(l[0]) < b.w / 2 - m && Math.abs(l[1]) < b.d / 2 - m) return i; } return -1; }
function floorY(x, z, zone) { return zone >= 0 ? BLD[zone].fy + .1 : Math.max(gH(x, z), bridgeY(x, z)); }

const BK = {};
const bucket = k => BK[k] || (BK[k] = []);
function boxUV(g, sx, sy, sz, t) {
  const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); }
  return g;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function put(k, g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g; }
function lbox(b, k, lx, ly, lz, sx, sy, sz, ry = 0, tile = 1.2) {
  const g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile);
  _e.set(0, ry, 0); g.applyMatrix4(_m4.compose(_v.set(lx, ly, lz), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  bucket(k).push(g); return g;
}
function wbox(k, x, y, z, sx, sy, sz, ry = 0, tile = 1.2) { return put(k, boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile), x, y, z, ry); }
function lsolid(b, lx, lz, sx, sz, list = SOL) { const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); list.push(r); return r; }
function spot(tag, x, y, z) { SPOTS.push({tag, x, y, z, i: SPOTS.length}); }
function lspot(b, tag, lx, ly, lz) { const [x, z] = L2W(b, lx, lz); spot(tag, x, b.fy + ly, z); }
function solidR(x, z, sx, sz, list = SOL) { const r = {x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2}; list.push(r); return r; }

const BTYPES = {
  cabin: {w: 6.5, d: 7, dx: 1.6, dw: 1.3, wh: 2.7},
  shed:  {w: 5, d: 4.4, dx: 0, dw: 1.3, wh: 2.5},
  out:   {w: 1.7, d: 1.7, dx: 0, dw: .9, wh: 2.3},
};
function building(kind, name, x, z, door) {
  const T = BTYPES[kind], b = {kind, name, x, z, th: ROT[door], w: T.w, d: T.d, wh: T.wh, door};
  const big = Math.max(b.w, b.d) / 2 + 3.5;
  b.fy = baseH(x, z);
  padR(x - big, x + big, z - big, z + big, 7, b.fy);
  b.i = BLD.length; BLD.push(b);
  const t = .18, hw = b.w / 2, hd = b.d / 2, wh = b.wh, dl = T.dx - T.dw / 2, dr = T.dx + T.dw / 2;
  const wall = (lx, lz, sx, sz) => { lbox(b, 'wall', lx, wh / 2, lz, sx, wh, sz); WALLS.push(rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2)); };
  wall(0, hd, b.w + t, t); wall(-hw, 0, t, b.d); wall(hw, 0, t, b.d);
  wall((-hw - t / 2 + dl) / 2, -hd, dl + hw + t / 2, t); wall((hw + t / 2 + dr) / 2, -hd, hw + t / 2 - dr, t);
  lbox(b, 'wall', T.dx, (2.08 + wh) / 2, -hd, T.dw, wh - 2.08, t);
  lbox(b, 'trim', T.dx, 2.08, -hd, T.dw + .2, .1, t + .08); lbox(b, 'trim', dl - .05, 1.04, -hd, .1, 2.08, t + .08); lbox(b, 'trim', dr + .05, 1.04, -hd, .1, 2.08, t + .08);
  lbox(b, 'door', dr + .02, 1.02, -hd + T.dw / 2 + .1, .05, 2.02, T.dw - .04);
  lbox(b, 'floor', 0, .05, 0, b.w, .1, b.d, 0, 1.6);
  lbox(b, 'trim', T.dx, .04, -hd - .45, T.dw + .4, .08, .6);
  const win = (lx, lz, alongX) => { lbox(b, 'glass', lx, 1.45, lz, alongX ? .8 : t + .05, .62, alongX ? t + .05 : .8); };
  if (kind !== 'out') { for (let s = -hd + 1.6; s < hd - 1; s += 2.8) { win(-hw, s, false); win(hw, s, false); } }
  const rise = kind === 'out' ? .45 : Math.min(1.6, b.w * .25), oh = .45, span = hw + oh, len = Math.hypot(span, rise) + .05, ang = Math.atan2(rise, span);
  for (const sgn of [-1, 1]) {
    const g = boxUV(new THREE.BoxGeometry(len, .12, b.d + oh * 2), len, .12, b.d + oh * 2, 1.5);
    _e.set(0, 0, sgn * -ang); g.applyMatrix4(_m4.compose(_v.set(sgn * span / 2, wh + rise / 2 + .05, 0), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    bucket('roof').push(g);
  }
  for (const sz of [-hd, hd]) {
    const g = new THREE.BufferGeometry(), y0 = wh, p = [-hw - .09, y0, sz, hw + .09, y0, sz, 0, y0 + rise, sz];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.concat([p[3], p[4], p[5], p[0], p[1], p[2], p[6], p[7], p[8]]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, b.w / 1.2, 0, b.w / 2.4, rise / 1.2, b.w / 1.2, 0, 0, 0, b.w / 2.4, rise / 1.2], 2));
    g.computeVertexNormals(); _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket('wall').push(g);
  }
  b.din = L2W(b, T.dx, -hd + 1.0); b.dout = L2W(b, T.dx, -hd - 1.4); b.dfront = L2W(b, T.dx, -hd - 3.2);
  const c0 = L2W(b, -hw, -hd), c1 = L2W(b, hw, hd), pad = .9;
  OBST.push({x0: Math.min(c0[0], c1[0]) - pad, x1: Math.max(c0[0], c1[0]) + pad, z0: Math.min(c0[1], c1[1]) - pad, z1: Math.max(c0[1], c1[1]) + pad, b: b.i});
  b.hides = [];
  furnish(b);
  return b;
}
function hide(b, lx, lz, face, kind) {
  const [x, z] = L2W(b, lx, lz), th = face + b.th, fx = -Math.sin(th), fz = -Math.cos(th);
  const h = {x, z, y: b.fy + .1, yaw: th, b: b.i, ex: x + fx * .9, ez: z + fz * .9, kind, i: HIDES.length};
  HIDES.push(h); b.hides.push(h);
  INTER.push({kind: 'hide', h, x: x + fx * .35, y: b.fy + 1.2, z: z + fz * .35, r: 2, label: () => P.hd === h.i ? 'Get out' : 'Hide in the ' + kind, on: () => !hideTaken(h)});
}
function wardrobe(b, lx, lz, face, kind = 'wardrobe') {
  const w = kind === 'locker' ? .6 : 1.05, dp = .6, hgt = kind === 'locker' ? 1.95 : 2.0;
  lbox(b, kind === 'locker' ? 'metal' : 'wood', lx, hgt / 2, lz, w, hgt, dp, face);
  const fx = -Math.sin(face), fz = -Math.cos(face);
  for (let y = .3; y < hgt - .2; y += .16) lbox(b, 'dark', lx + fx * (dp / 2 + .005), y, lz + fz * (dp / 2 + .005), w - .1, .04, .02, face);
  lsolid(b, lx, lz, Math.abs(fx) > .5 ? dp : w, Math.abs(fx) > .5 ? w : dp);
  hide(b, lx, lz, face, kind);
}
function table(b, lx, lz, sx, sz, h = .76) {
  lbox(b, 'wood', lx, h, lz, sx, .06, sz);
  for (const ax of [-1, 1]) for (const az of [-1, 1]) lbox(b, 'wood', lx + ax * (sx / 2 - .08), h / 2, lz + az * (sz / 2 - .08), .07, h, .07);
  lsolid(b, lx, lz, sx, sz);
}
function furnish(b) {
  const hw = b.w / 2, hd = b.d / 2;
  if (b.kind === 'cabin') {
    lbox(b, 'wood', -hw + .55, .35, 1.8, 1, .14, 2); lbox(b, 'fabric', -hw + .55, .47, 1.8, .9, .12, 1.9); lsolid(b, -hw + .55, 1.8, 1, 2);
    table(b, -1.5, -1.5, 1.1, .8); lspot(b, 'table', -1.5, .82, -1.5);
    wardrobe(b, hw - .4, -.6, PI / 2); wardrobe(b, hw - .35, 2.4, PI / 2, 'locker');
    lbox(b, 'metal', .4, .5, hd - .5, 1.2, 1, .6); lsolid(b, .4, hd - .5, 1.2, .6); lspot(b, 'shelf', .4, 1.02, hd - .5); // stove
  } else if (b.kind === 'shed') {
    lbox(b, 'wood', -hw + .45, .45, .5, .8, .9, 2.4); lsolid(b, -hw + .45, .5, .8, 2.4); lspot(b, 'bench', -hw + .45, .95, .2);
    wardrobe(b, hw - .35, 1.2, PI / 2, 'locker');
    lspot(b, 'floor', .6, .12, hd - .6);
  } else if (b.kind === 'out') {
    lbox(b, 'wood', 0, .25, .45, 1.2, .5, .6); hide(b, 0, .3, 0, 'outhouse');
  }
}
const BEA = [], CANS = [], ITEMS = [], FIRES = [];
function landmarks() {
  // campsite: fire, tents, logs
  const cy = baseH(CAMP.x, CAMP.z);
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; wbox('rock', CAMP.x + Math.cos(a) * 1, cy + .1, CAMP.z + Math.sin(a) * 1, .3, .22, .26, a); }
  for (let i = 0; i < 3; i++) wbox('log', CAMP.x, cy + .14, CAMP.z, .16, .16, 1.4, i * 1.1);
  FIRES.push({x: CAMP.x, y: cy + .3, z: CAMP.z, lit: true, s: .7});
  const tents = [[-6, 3, .4, 0x8a3a20], [5, 5, -.5, 0x2a5a7a], [7, -4, 2.3, 0x4a6a2a], [-6, -5, 3.6, 0x8a7a2a]];
  for (const [dx, dz, r, c] of tents) { const g = new THREE.ConeGeometry(1.5, 1.4, 4, 1, true); put('tent' + c, g, CAMP.x + dx, cy + .7, CAMP.z + dz, r + PI / 4); MATX['tent' + c] = c; }
  for (const [dx, dz, r] of [[-3, -2, .3], [3, 2, -.4]]) wbox('log', CAMP.x + dx, cy + .22, CAMP.z + dz, .4, .4, 2.2, r);
  spot('camp', CAMP.x + 2.5, cy + .05, CAMP.z - 1.5); spot('camp', CAMP.x - 7.2, cy + .05, CAMP.z + 1);
  // helipad
  const hy = baseH(HELI.x, HELI.z);
  put('pad', new THREE.CircleGeometry(9, 32), HELI.x, hy + .03, HELI.z, 0, -PI / 2);
  wbox('paint', HELI.x - 1.6, hy + .05, HELI.z, .5, .02, 5); wbox('paint', HELI.x + 1.6, hy + .05, HELI.z, .5, .02, 5); wbox('paint', HELI.x, hy + .05, HELI.z, 3.2, .02, .5);
  wbox('log', HELI.x + 11, hy + 2.5, HELI.z, .1, 5, .1); put('sock', new THREE.ConeGeometry(.35, 1.6, 8, 1, true), HELI.x + 11.8, hy + 4.9, HELI.z, 0, 0, PI / 2);
  // beacons
  for (const [x, z, name] of BEA_POS) {
    const y = baseH(x, z);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; put('log', new THREE.CylinderGeometry(.11, .14, 2.6, 6), x + Math.cos(a) * .55, y + 1.1, z + Math.sin(a) * .55, a, .35 * Math.cos(a + PI / 2), .35); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; wbox('rock', x + Math.cos(a) * 1.5, y + .15, z + Math.sin(a) * 1.5, .45, .3, .4, a); }
    wbox('metal', x + 2.2, y + .55, z, .5, 1.1, .5); wbox('sign', x + 2.2, y + 1.3, z, .8, .5, .05);
    BEA.push({x, y, z, name, lit: false, p: 0}); FIRES.push({x, y: y + 1.6, z, lit: false, s: 2.2, bea: BEA.length - 1});
    solidR(x, z, 1.6, 1.6, WALLS);
  }
  // lookout tower at the west beacon
  { const [x0, z0] = BEA_POS[2], x = x0 - 6, z = z0 + 4, y = baseH(x, z);
    for (const ax of [-1.3, 1.3]) for (const az of [-1.3, 1.3]) { wbox('log', x + ax, y + 4.2, z + az, .22, 8.4, .22); solidR(x + ax, z + az, .25, .25); }
    wbox('wood', x, y + 8.4, z, 3.4, .2, 3.4); wbox('wood', x, y + 9, z + 1.65, 3.4, 1, .08); put('roof', new THREE.ConeGeometry(2.6, 1.3, 4), x, y + 10.6, z, PI / 4);
    for (let yy = .4; yy < 8.2; yy += .45) wbox('wood', x, y + yy, z - 1.6, .7, .06, .06); spot('tower', x + 1.8, y + .1, z - 1.8); }
  // crashed plane
  { const x = -112, z = 122, y = baseH(x, z);
    wbox('plane', x, y + .9, z, 1.6, 1.5, 7, .5); wbox('plane', x + 3.2, y + .5, z + 1.2, 6, .12, 1.4, .9); wbox('plane', x - 2.6, y + .4, z - 1.5, 4.2, .12, 1.3, .2, ); wbox('plane', x - 2, y + 1.6, z + 3, .1, 1.4, 1, .5);
    wbox('dark', x + .15, y + 1.2, z - 2.8, 1.3, .7, .2, .5); solidR(x, z, 3, 6, WALLS); OBST.push({x0: x - 3.4, x1: x + 3.4, z0: z - 4.6, z1: z + 4.6});
    spot('plane', x + 2, y + .05, z - 3.5); padC(x, z, 6, 6, y); }
  // logging camp: log piles, old truck
  { const x = 72, z = -54, y = baseH(x, z);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 4 - i; k++) put('log', new THREE.CylinderGeometry(.3, .3, 7, 8), x + 8, y + .3 + i * .55, z - 4 + k * .62 + i * .31, 0, 0, PI / 2);
    solidR(x + 8, z - 3, 7, 2.6, WALLS); OBST.push({x0: x + 4, x1: x + 12, z0: z - 5.4, z1: z - .4});
    wbox('truck', x - 6, y + 1.1, z + 6, 2.2, 1.2, 5.5, .2); wbox('truck', x - 6.3, y + 1.9, z + 7.8, 2, .9, 1.6, .2); for (const s of [-1, 1]) for (const a of [-1.8, 1.8]) wbox('tyre', x - 6 + s * 1.05 + a * .2, y + .45, z + 6 + a, .3, .9, .9, .2);
    solidR(x - 6, z + 6, 2.6, 6, WALLS); OBST.push({x0: x - 8, x1: x - 4, z0: z + 2.4, z1: z + 9.6});
    spot('logging', x + 4, y + .05, z + 2); padC(x, z, 14, 8, y); }
  // cemetery
  { const x = 96, z = 98, y = baseH(x, z);
    for (let i = 0; i < 14; i++) { const gx = x - 6 + (i % 5) * 3, gz = z - 9 + Math.floor(i / 5) * 3.2; wbox('rock', gx, y + .45, gz, .6, .9, .14, (h2(i, 3) - .5) * .3); }
    for (let i = 0; i < 12; i++) wbox('log', x - 9 + i * 1.6, y + .5, z - 12, .08, 1, .08); spot('cemetery', x + 6, y + .05, z - 4); padC(x, z, 12, 8, y); }
  // old mine entrance in the east hillside
  { const x = 160, z = -78, y = baseH(x, z);
    wbox('rock', x + 3, y + 3, z, 4, 7, 9, 0, 3); wbox('dark', x + .95, y + 1.3, z, .1, 2.4, 2.4); wbox('log', x + .9, y + 1.3, z - 1.35, .25, 2.6, .25); wbox('log', x + .9, y + 1.3, z + 1.35, .25, 2.6, .25); wbox('log', x + .9, y + 2.65, z, .3, .3, 3.1);
    for (let i = 0; i < 6; i++) wbox('log', x - 1 - i * 1.4, y + .05, z, .18, .1, 1.6);
    solidR(x + 3, z, 4, 9, WALLS); spot('mine', x - 1.5, y + .05, z + 1.4); padC(x - 4, z, 8, 7, y); }
  // stumps and boulders scattered in the woods (extra item spots)
  for (let k = 0, n = 0; k < 400 && n < 16; k++) {
    const x = (R() * 2 - 1) * 160, z = (R() * 2 - 1) * 160; if (Math.hypot(x - CAMP.x, z - CAMP.z) < 30 || riverQ(x, z).d < 9 || Math.hypot(x, z) > 165) continue;
    if (SPOTS.some(q => Math.hypot(q.x - x, q.z - z) < 25)) continue;
    const y = rawH(x, z); n++;
    if (n % 2) { put('log', new THREE.CylinderGeometry(.42, .5, .55, 9), x, y + .27, z); spot('stump', x, y + .56, z); }
    else { wbox('rock', x, y + .5, z, 1.6, 1.2, 1.3, R() * 3, 1.5); spot('rock', x + .9, y + .05, z + .2); }
    solidR(x, z, .9, .9);
  }
  // bridges
  for (const k of [3, 6]) {
    const [ax, az] = RIVER[k], [bx, bz] = RIVER[k + 1], cx = (ax + bx) / 2, cz = (az + bz) / 2; let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz); tx /= l; tz /= l; const nx = -tz, nz = tx;
    const y = Math.max(hills(cx + nx * 8, cz + nz * 8), hills(cx - nx * 8, cz - nz * 8)) + .25;
    const br = {x: cx, z: cz, nx, nz, tx, tz, hl: 9, y}; BRIDGES.push(br);
    const ry = Math.atan2(nx, nz);
    wbox('wood', cx, y - .08, cz, 2.2, .16, 18, ry, 1.5);
    for (const s of [-1, 1]) { wbox('log', cx + tx * 1.1 * s, y + .5, cz + tz * 1.1 * s, .1, .1, 18, ry); for (let i = -4; i <= 4; i++) wbox('log', cx + tx * 1.1 * s + nx * i * 2, y + .25, cz + tz * 1.1 * s + nz * i * 2, .1, .9, .1); }
    spot('bridge', cx + nx * 9.5 + tx * 1.5, y + .02, cz + nz * 9.5 + tz * 1.5);
    padC(cx + nx * 10, cz + nz * 10, 2, 4, y - .1); padC(cx - nx * 10, cz - nz * 10, 2, 4, y - .1);
  }
}
const MATX = {};
function buildLayout() {
  PADS.length = 0;
  padC(CAMP.x, CAMP.z, 12, 10, hills(CAMP.x, CAMP.z));
  padC(HELI.x, HELI.z, 13, 10, hills(HELI.x, HELI.z));
  for (const [x, z] of BEA_POS) padC(x, z, 4, 18, hills(x, z));
  building('cabin', 'Ranger cabin', -72, -42, 'e');
  building('shed', 'Logging shed', 64, -46, 'w');
  building('out', 'Outhouse', 13, -24, 'w');
  building('shed', 'Chapel shed', 96, 82, 's');
  landmarks();
}

// ---------------- three
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.15;
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = 0x070a10;
scene.background = new THREE.Color(FOG); scene.fog = new THREE.FogExp2(FOG, .026);
const cam = new THREE.PerspectiveCamera(70, 1, .05, 700); scene.add(cam);
function resize() { const w = innerWidth, h = innerHeight; RND.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const hemi = new THREE.HemisphereLight(0x52648c, 0x0b0906, .5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa9bce6, .6); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, {left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260});
moon.shadow.bias = -.0006; moon.shadow.normalBias = .04; moon.shadow.autoUpdate = false; scene.add(moon, moon.target);
const MOONDIR = new THREE.Vector3(.4, .7, -.55).normalize();
const flash = new THREE.SpotLight(0xffeccc, 0, 45, .44, .6, 1.4); flash.castShadow = true;
flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = .25; flash.shadow.camera.far = 45; flash.shadow.bias = -.0004; flash.shadow.normalBias = .03;
scene.add(flash, flash.target);
const RSPOT = [0, 1, 2, 3, 4].map(() => { const l = new THREE.SpotLight(0xffeccc, 0, 38, .44, .6, 1.4); scene.add(l, l.target); return l; });
const POOL = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff9a40, 0, 30, 1.5); scene.add(l); return l; });
const FLL = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff2a14, 0, 22, 1.4); scene.add(l); return l; });
const heliL = new THREE.SpotLight(0xf2f6ff, 0, 90, .32, .4, 1); scene.add(heliL, heliL.target);

function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, n) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r * .8; } g.putImageData(im, 0, 0); }
const TX = {}, MAT = {};
function textures() {
  TX.ground = tex(cv(512, 512, (g, w, h) => {
    g.fillStyle = '#272c1c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const x = Math.random() * w, y = Math.random() * h, r = 3 + Math.random() * 26; g.fillStyle = `rgba(${Math.random() < .5 ? '58,48,32' : '26,38,20'},${.08 + Math.random() * .15})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 5000; i++) { g.strokeStyle = `rgba(${40 + Math.random() * 40},${50 + Math.random() * 40},${20 + Math.random() * 20},.5)`; const x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 4, y - 3 - Math.random() * 5); g.stroke(); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(70,50,30,${Math.random() * .6})`; g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 1 + Math.random() * 2); }
    noiseFill(g, w, h, 24);
  }), 80);
  const planks = (base, gap) => cv(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { const sh = (Math.random() - .5) * 30; g.fillStyle = `rgba(${sh > 0 ? 255 : 0},${sh > 0 ? 240 : 0},${sh > 0 ? 220 : 0},${Math.abs(sh) / 255})`; g.fillRect(0, y, w, 32);
      for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${.05 + Math.random() * .12})`; g.beginPath(); const yy = y + Math.random() * 32; g.moveTo(0, yy); g.bezierCurveTo(w * .3, yy + (Math.random() - .5) * 6, w * .6, yy + (Math.random() - .5) * 6, w, yy); g.stroke(); }
      g.fillStyle = gap; g.fillRect(0, y, w, 2); g.fillRect((y * 7) % w, y, 2, 32); }
    noiseFill(g, w, h, 18);
  });
  TX.wall = tex(planks('#5a4a3a', '#1c140e')); TX.floor = tex(planks('#6a5038', '#20160e'));
  TX.roof = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#2b2622'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = -(y % 32 ? 16 : 0); x < w; x += 32) { g.fillStyle = `rgb(${32 + Math.random() * 18},${28 + Math.random() * 14},${26 + Math.random() * 12})`; g.fillRect(x + 1, y + 1, 30, 14); } noiseFill(g, w, h, 14); }));
  TX.rock = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4c4a46'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '20,20,20' : '120,118,110'},${Math.random() * .2})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, TAU); g.fill(); } noiseFill(g, w, h, 30); }));
  TX.sign = tex(cv(256, 160, (g, w, h) => { g.fillStyle = '#5a3a1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#e0d0a8'; g.font = 'bold 34px Georgia'; g.textAlign = 'center'; g.fillText('SIGNAL', w / 2, 62); g.fillText('BEACON', w / 2, 104); g.font = '16px Georgia'; g.fillText('fuel only - forest service', w / 2, 140); noiseFill(g, w, h, 40); }));
  TX.paper = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#d6ccb0'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4030'; for (let y = 14; y < h - 10; y += 9) g.fillRect(12, y, 70 + Math.random() * 30, 2); noiseFill(g, w, h, 20); }));
  TX.glow = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  TX.flame = new THREE.CanvasTexture(cv(64, 128, (g, w, h) => { const gr = g.createRadialGradient(32, 92, 2, 32, 80, 60); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(.3, 'rgba(255,150,40,.85)'); gr.addColorStop(.7, 'rgba(200,50,10,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(60, 70, 50, 110); g.quadraticCurveTo(32, 128, 14, 110); g.quadraticCurveTo(4, 70, 32, 2); g.fill(); }));
  TX.water = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { g.strokeStyle = `rgba(255,255,255,${Math.random() * .25})`; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + 2, y + 10 + Math.random() * 20); g.stroke(); } }));
  TX.water.colorSpace = THREE.NoColorSpace; TX.water.repeat.set(1, 1);
}
function materials() {
  const S = (o) => new THREE.MeshStandardMaterial(Object.assign({roughness: .9, metalness: 0}, o));
  MAT.wall = S({map: TX.wall, side: THREE.DoubleSide}); MAT.floor = S({map: TX.floor}); MAT.roof = S({map: TX.roof});
  MAT.trim = S({color: 0x3a2d22}); MAT.door = S({map: TX.wall, color: 0x9a8a78}); MAT.wood = S({map: TX.floor, color: 0xb8a088});
  MAT.dark = S({color: 0x0b0a09}); MAT.fabric = S({color: 0x4a3c34}); MAT.metal = S({color: 0x55585a, roughness: .55, metalness: .6});
  MAT.glass = S({color: 0x101820, roughness: .15, metalness: .3});
  MAT.log = S({color: 0x3b2c20}); MAT.sign = S({map: TX.sign}); MAT.tyre = S({color: 0x121212}); MAT.truck = S({color: 0x4a5a3a, roughness: .7, metalness: .3});
  MAT.rock = S({map: TX.rock, color: 0x9a968e}); MAT.plane = S({color: 0x8a8a84, roughness: .5, metalness: .6}); MAT.pad = S({color: 0x3a3a36}); MAT.paint = S({color: 0x9a9480});
  MAT.sock = S({color: 0xb85a20, side: THREE.DoubleSide});
  for (const k in MATX) MAT[k] = S({color: MATX[k], side: THREE.DoubleSide});
  MAT.ground = S({map: TX.ground});
  MAT.water = new THREE.MeshStandardMaterial({color: 0x0a1218, roughness: .1, metalness: .5, bumpMap: TX.water, bumpScale: .4});
}
function mergeGeos(list) {
  let n = 0; const qs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); const hasC = qs.some(q => q.attributes.color); const col = hasC ? new Float32Array(n * 3).fill(1) : null;
  let o = 0; for (const q of qs) { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2); if (hasC && q.attributes.color) col.set(q.attributes.color.array, o * 3); o += c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
function buildGround() {
  HG = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) HG[j * GN + i] = baseH(-WS + i * GS, -WS + j * GS);
  const g = new THREE.PlaneGeometry(WS * 2, WS * 2, GN - 1, GN - 1); g.rotateX(-PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const i = Math.round((p.getX(k) + WS) / GS), j = Math.round((p.getZ(k) + WS) / GS); p.setY(k, HG[j * GN + i]); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, MAT.ground); m.receiveShadow = true; scene.add(m);
  const sk = new THREE.Mesh(new THREE.RingGeometry(WS * 1.38, 650, 32, 1), MAT.ground); sk.rotation.x = -PI / 2; sk.position.y = 40; scene.add(sk);
  // creek ribbon
  const pts = []; for (let i = 0; i < RIVER.length - 1; i++) { const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2); for (let k = 0; k < n; k++) pts.push([mix(ax, bx, k / n), mix(az, bz, k / n)]); }
  pts.push(RIVER[RIVER.length - 1]);
  const sm = pts.map((q, i) => { let sx = 0, sz = 0, c = 0; for (let k = -4; k <= 4; k++) { const r = pts[clamp(i + k, 0, pts.length - 1)]; sx += r[0]; sz += r[1]; c++; } return [sx / c, sz / c]; });
  const vs = [], uvs = [], idx = []; let acc = 0;
  for (let i = 0; i < sm.length; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i) acc += Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
    const q = riverQ(sm[i][0], sm[i][1]), wy = waterY(q.cx, q.cz);
    for (const s of [-1, 1]) { vs.push(sm[i][0] - tz * 5 * s, wy, sm[i][1] + tx * 5 * s); uvs.push(s < 0 ? 0 : 1, acc / 10); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); rg.setIndex(idx); rg.computeVertexNormals();
  scene.add(new THREE.Mesh(rg, MAT.water));
}
function buildSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {md: {value: MOONDIR}},
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform vec3 md;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec3 d = normalize(vD); float y = max(d.y, 0.);
        vec3 c = mix(vec3(.026,.036,.06), vec3(.006,.009,.02), pow(y,.5));
        float m = max(dot(d, md), 0.); c += vec3(.25,.3,.42) * pow(m, 60.) * .5 + vec3(.06,.08,.13) * pow(m, 6.);
        float cl = n(d.xz / (y + .15) * 3.) * .6 + n(d.xz / (y + .15) * 7.) * .4; c = mix(c, c * .45 + vec3(.012,.014,.02), smoothstep(.45,.8,cl) * smoothstep(0.,.3,y));
        gl_FragColor = vec4(c, 1.); }`}));
  sky.renderOrder = -2; scene.add(sky); scene.userData.sky = sky;
  const n = 1400, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const u = Math.random() * TAU, v = Math.random() * .95 + .05, r = 580; p[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r; p[i * 3 + 1] = v * r; p[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const st = new THREE.Points(sg, new THREE.PointsMaterial({color: 0x9aa4c0, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: .7, depthWrite: false}));
  st.renderOrder = -1; scene.add(st); scene.userData.stars = st;
  const mn = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xdfe6ff, fog: false, depthWrite: false, transparent: true})); mn.scale.set(46, 46, 1); mn.renderOrder = -1; scene.add(mn); scene.userData.moon = mn;
}
function treeGeo() {
  const parts = [];
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const k = .7 + .3 * Math.min(1, y / 8); a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tr = new THREE.CylinderGeometry(.12, .3, 10, 6); tr.translate(0, 5, 0); parts.push(col(tr, [.22, .16, .11]));
  for (let i = 0; i < 6; i++) { const r = 2.3 - i * .34, y = 2.4 + i * 1.45; const c = new THREE.ConeGeometry(r, 2.6, 7, 1); c.translate(0, y + 1.3, 0); const p = c.attributes.position; for (let k = 0; k < p.count; k++) { p.setX(k, p.getX(k) * (.85 + h2(k, i) * .3)); p.setZ(k, p.getZ(k) * (.85 + h2(i, k) * .3)); } parts.push(col(c, [.08, .14, .1])); }
  return mergeGeos(parts);
}
function deadGeo() {
  const parts = []; const col = (g) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 3) { a[i] = .2; a[i + 1] = .16; a[i + 2] = .13; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tr = new THREE.CylinderGeometry(.08, .26, 8, 5); tr.translate(0, 4, 0); parts.push(col(tr));
  for (let i = 0; i < 6; i++) { const b = new THREE.CylinderGeometry(.02, .06, 2.4, 4); b.translate(0, 1.2, 0); b.rotateZ(1.0 + h2(i, 3) * .5); b.rotateY(i * 2.1); b.translate(0, 2.5 + i * .9, 0); parts.push(col(b)); }
  return mergeGeos(parts);
}
const TH = new Map(), BH = new Map(); const thKey = (i, j) => i * 1000 + j;
function hashAdd(H, t) { const k = thKey(Math.floor(t.x / 8), Math.floor(t.z / 8)); if (!H.has(k)) H.set(k, []); H.get(k).push(t); }
function near(H, x, z, f) { const i0 = Math.floor((x - 2) / 8), i1 = Math.floor((x + 2) / 8), j0 = Math.floor((z - 2) / 8), j1 = Math.floor((z + 2) / 8); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = H.get(thKey(i, j)); if (l) for (const t of l) f(t); } }
const treesNear = (x, z, f) => near(TH, x, z, f);
function inRect(x, z, r, m) { return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
function buildTrees() {
  const ok = (x, z, m) => {
    if (riverQ(x, z).d < 6 + m) return false;
    for (const o of OBST) if (inRect(x, z, o, 3 + m)) return false;
    for (const s of SOL) if (inRect(x, z, s, 2.5)) return false;
    for (const s of WALLS) if (inRect(x, z, s, 2.5)) return false;
    for (const p of PADS) if (padW(p, x, z) > .6) return false;
    for (const b of BRIDGES) if (Math.hypot(x - b.x, z - b.z) < 13) return false;
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < 16 || Math.hypot(x - HELI.x, z - HELI.z) < 16) return false;
    for (const [bx, bz] of BEA_POS) if (Math.hypot(x - bx, z - bz) < 11) return false;
    return true;
  };
  const pine = [], dead = [], bush = [];
  for (let k = 0; k < 16000 && pine.length + dead.length < 4200; k++) {
    const x = (R() * 2 - 1) * (WS - 3), z = (R() * 2 - 1) * (WS - 3);
    const dens = .3 + .7 * fbm(x * .018 + 9, z * .018); if (R() > dens) continue;
    if (!ok(x, z, 0)) continue;
    let nr = false; treesNear(x, z, t => { if (Math.hypot(t.x - x, t.z - z) < 2.7) nr = true; }); if (nr) continue;
    const s = .75 + R() * .75, t = {x, z, r: .32 * s}; (R() < .1 ? dead : pine).push([x, z, s, R() * TAU]); TREES.push(t); hashAdd(TH, t);
  }
  for (let k = 0; k < 4000; k++) { const x = (R() * 2 - 1) * WS, z = (R() * 2 - 1) * WS; if (!ok(x, z, -2)) continue; const s = .6 + R() * .8; bush.push([x, z, s, R() * TAU]); const b = {x, z, r: .8 * s}; BUSHES.push(b); hashAdd(BH, b); }
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, flatShading: true});
  const inst = (geo, list, cast) => {
    const tiles = new Map();
    for (const t of list) { const k = Math.floor((t[0] + WS) / 50) * 100 + Math.floor((t[1] + WS) / 50); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(t); }
    for (const l of tiles.values()) {
      const m = new THREE.InstancedMesh(geo, mat, l.length); const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
      l.forEach((t, i) => { Q.setFromAxisAngle(UP, t[3]); M4.compose(V.set(t[0], gH(t[0], t[1]) - .2, t[1]), Q, S3.set(t[2], t[2] * (.9 + h2(t[0], t[1]) * .3), t[2])); m.setMatrixAt(i, M4); });
      m.castShadow = cast; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m);
    }
  };
  inst(treeGeo(), pine, true); inst(deadGeo(), dead, true);
  const bg = new THREE.IcosahedronGeometry(.9, 0); bg.scale(1, .7, 1); bg.translate(0, .35, 0); { const n = bg.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 3) { a[i] = .07; a[i + 1] = .12; a[i + 2] = .06; } bg.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  inst(bg, bush, false);
}
function inBush(x, z) { let r = false; near(BH, x, z, b => { if (Math.hypot(b.x - x, b.z - z) < b.r + .3) r = true; }); return r; }

// ---------------- the creature: upright stalker, drops to all fours to run
const MON = new THREE.Group(), MJ = {};
function buildCreature() {
  const skin = new THREE.MeshLambertMaterial({color: 0x060504});
  const pale = new THREE.MeshLambertMaterial({color: 0x6a6458});
  const hole = new THREE.MeshBasicMaterial({color: 0x000000});
  const eye = new THREE.MeshBasicMaterial({color: 0xffd8a0});
  const cap = (r, l) => { const g = new THREE.CapsuleGeometry(r, l, 4, 8); g.translate(0, -l / 2 - r * .4, 0); return g; };
  const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
  const hips = new THREE.Group(); hips.position.y = 1.45; MON.add(hips); MJ.hips = hips;
  const torso = new THREE.Group(); hips.add(torso); MJ.torso = torso;
  const tg = new THREE.CapsuleGeometry(.16, .8, 4, 10); tg.scale(1.1, 1, .7); tg.translate(0, .55, 0); torso.add(mesh(tg, skin));
  for (let i = 0; i < 6; i++) { const v = new THREE.SphereGeometry(.035, 6, 4); const m = mesh(v, skin); m.position.set(0, .3 + i * .12, -.13); torso.add(m); } // spine knobs
  const neck = new THREE.Group(); neck.position.y = 1.08; torso.add(neck); MJ.neck = neck;
  neck.add(mesh(cap(.045, .3).translate(0, .38, 0), skin));
  const head = new THREE.Group(); head.position.set(0, .38, .02); neck.add(head); MJ.head = head;
  const hg = new THREE.SphereGeometry(.14, 16, 12); hg.scale(.75, 1.7, .9); hg.translate(0, .14, .02); head.add(mesh(hg, pale));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.036, 8, 6), hole); e.scale.set(1, 1.3, .5); e.position.set(s * .045, .22, .115); head.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(.008, 6, 4), eye); p.position.set(s * .045, .215, .128); head.add(p); }
  const mo = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 6), hole); mo.scale.set(.5, 2.2, .4); mo.position.set(0, -.02, .118); head.add(mo); MJ.mouth = mo;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .24, .98, 0); torso.add(sh); MJ['sh' + s] = sh;
    sh.add(mesh(cap(.045, .72), skin));
    const el = new THREE.Group(); el.position.y = -.84; sh.add(el); MJ['el' + s] = el;
    el.add(mesh(cap(.036, .78), skin));
    const hand = new THREE.Group(); hand.position.y = -.9; el.add(hand);
    for (let f = 0; f < 4; f++) { const fg = mesh(cap(.01, .26), pale); fg.position.set((f - 1.5) * .02, 0, .01); fg.rotation.z = (f - 1.5) * .12; hand.add(fg); }
    const hip = new THREE.Group(); hip.position.set(s * .12, 0, 0); hips.add(hip); MJ['hp' + s] = hip;
    hip.add(mesh(cap(.06, .62), skin));
    const kn = new THREE.Group(); kn.position.y = -.74; hip.add(kn); MJ['kn' + s] = kn;
    kn.add(mesh(cap(.045, .62), skin));
    const ft = mesh(new THREE.BoxGeometry(.07, .04, .24), skin); ft.position.set(0, -.74, .07); kn.add(ft);
  }
  scene.add(MON);
}
function animCreature(dt, st, spd) {
  const k = clamp(spd / 5, 0, 1.3), four = st === 'chase' && spd > 2.5;
  M.ph += dt * (2.2 + spd * (four ? 1.5 : 1.25)); M.four = mix(M.four || 0, four ? 1 : 0, Math.min(1, dt * 5));
  const s = Math.sin(M.ph), c = Math.cos(M.ph), q = M.four;
  for (const g of [-1, 1]) {
    const sw = s * g;
    MJ['hp' + g].rotation.x = mix(-sw * .55 * k - .05, -1.2 + sw * .7, q);
    MJ['kn' + g].rotation.x = mix(Math.max(0, g * c + .3) * .9 * k + .08, 1.3 + Math.max(0, g * c) * .6, q);
    MJ['sh' + g].rotation.x = mix(sw * .35 * k + .05, -1.75 - sw * .8, q);
    MJ['sh' + g].rotation.z = g * mix(.08, .18, q);
    MJ['el' + g].rotation.x = mix(-.15 - k * .2, -.25 + Math.max(0, -g * c) * .5, q);
  }
  MJ.hips.position.y = mix(1.45 + Math.abs(c) * .05 * k, .95 + Math.abs(s) * .12, q);
  MJ.torso.rotation.x = mix(.25 + k * .2 + (st === 'check' ? .4 : 0), 1.25, q);
  M.jit -= dt; if (M.jit < 0) { M.jit = .15 + Math.random() * 1.2; M.jr = (Math.random() - .5) * (st === 'chase' ? 1.2 : .6); }
  MJ.head.rotation.z = mix(MJ.head.rotation.z, M.jr, dt * 18);
  MJ.neck.rotation.x = mix(-.3 - k * .1 + (M.look || 0), -1.15, q);
  MJ.mouth.scale.y = 2.2 + (st === 'chase' ? 1.6 + Math.sin(performance.now() / 33) * .3 : 0);
  MON.position.set(M.x, M.y, M.z); MON.rotation.y = M.yaw;
}

// ---------------- hikers
function buildHiker(col) {
  const g = new THREE.Group(), j = {};
  const jacket = new THREE.MeshStandardMaterial({color: col, roughness: .85}), dark = new THREE.MeshStandardMaterial({color: 0x23262a, roughness: .9}), skin = new THREE.MeshStandardMaterial({color: 0xb08a6a, roughness: .8}), pack = new THREE.MeshStandardMaterial({color: 0x3a3a2a, roughness: .9});
  const m = (geo, mat, x, y, z, p = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  const body = new THREE.Group(); body.position.y = .95; g.add(body); j.body = body;
  m(new THREE.CapsuleGeometry(.2, .42, 4, 8), jacket, 0, .32, 0, body);
  m(new THREE.BoxGeometry(.34, .44, .2), pack, 0, .38, .2, body);
  const hd = new THREE.Group(); hd.position.y = .74; body.add(hd); j.head = hd;
  m(new THREE.SphereGeometry(.12, 12, 10), skin, 0, .02, 0, hd); m(new THREE.CylinderGeometry(.125, .12, .1, 12), jacket, 0, .1, 0, hd);
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * .1, .95, 0); g.add(leg); j['l' + s] = leg; m(new THREE.CapsuleGeometry(.075, .72, 4, 8), dark, 0, -.47, 0, leg);
    const arm = new THREE.Group(); arm.position.set(s * .26, .55, 0); body.add(arm); j['a' + s] = arm; m(new THREE.CapsuleGeometry(.06, .5, 4, 8), jacket, 0, -.3, 0, arm);
  }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 20, 1, true), new THREE.MeshBasicMaterial({color: 0xfff0d0, transparent: true, opacity: .045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false}));
  beam.geometry.translate(0, -7, 0); beam.geometry.rotateX(PI / 2); beam.position.set(0, -.6, -.15); j.a1.add(beam); j.beam = beam;
  const canM = mkCanMesh(); canM.position.set(-.05, -.62, .05); j['a-1'].add(canM); j.can = canM;
  g.userData = j; scene.add(g); return g;
}
let canGeo = null;
function mkCanMesh() {
  const g = new THREE.Group(); const red = new THREE.MeshStandardMaterial({color: 0xa8241a, roughness: .5, metalness: .3}), blk = new THREE.MeshStandardMaterial({color: 0x151515});
  const b = new THREE.Mesh(new THREE.BoxGeometry(.18, .3, .12), red); b.castShadow = true; g.add(b);
  const h = new THREE.Mesh(new THREE.BoxGeometry(.04, .06, .1), blk); h.position.set(0, .18, 0); g.add(h);
  const s = new THREE.Mesh(new THREE.CylinderGeometry(.015, .02, .12, 6), blk); s.position.set(.06, .19, 0); s.rotation.z = -.6; g.add(s);
  return g;
}
function animHiker(p, dt) {
  const g = p.av, j = g.userData; const ty = p.down ? 0 : 1;
  g.visible = !p.dead && !p.esc && p.hd < 0 && p.ready;
  if (!g.visible) return;
  g.position.set(p.rx, p.ry, p.rz); g.rotation.y = p.ryaw;
  p.anim = (p.anim || 0) + dt * p.rspd * 2.2;
  const s = Math.sin(p.anim) * clamp(p.rspd / 3, 0, 1);
  j.l1.rotation.x = s * .6; j['l-1'].rotation.x = -s * .6; j['a-1'].rotation.x = -s * .5;
  j.a1.rotation.x = -.6 - p.rpitch * .8; // flashlight arm follows the view
  j.body.rotation.x = p.cr ? .35 : 0; j.body.position.y = p.cr ? .7 : .95; j.l1.position.y = j['l-1'].position.y = p.cr ? .7 : .95;
  if (p.down) { g.rotation.x = -PI / 2 + .15; g.position.y += .25; } else g.rotation.x = 0;
  j.head.rotation.x = -p.rpitch * .5;
  j.beam.visible = !!p.l && !p.down; j.can.visible = carrierOf(p.id) >= 0;
}

// ---------------- state
const G = {on: false, over: false, t: 0, ph: 0, timer: 0, heli: null, seed: 1, crew: [], evq: [], holdP: {}, flares: [], msgT: 0, noteOpen: false, map: false, paused: false, spec: 0};
const PL = new Map();   // id -> player (me included)
let P = null;            // me
const M = {x: 0, z: 0, y: 0, yaw: 0, state: 'roam', path: [], rep: 0, goal: null, spd: 0, ph: 0, jit: 0, jr: 0, aware: 0, lostT: 0, lx: 0, lz: 0, idle: 0, flee: 0, zone: -1, sawHide: -1, far: 0, chk: [], chkT: 0, stalkT: 40, stuck: 0, sx: 0, sz: 0, screamT: 0, hintT: 10, look: 0, seenAt: -99, tgt: null, preyT: 0, prey: null};
function mkPlayer(id, name, c) {
  return {id, name, c, x: CAMP.x, z: CAMP.z, y: 0, yaw: 0, pitch: 0, cr: 0, l: 1, run: 0, h: '', hd: -1, hb: 0, w: 0, down: false, bleed: 0, dead: false, esc: false, ready: false, sd: 0, lx: 0, lz: 0, spd: 0,
    rx: 0, ry: 0, rz: 0, ryaw: 0, rpitch: 0, rspd: 0, av: null, tag: null, heat: 0};
}
function ensurePlayer(id, name, c) {
  let p = PL.get(id); if (!p) { p = mkPlayer(id, name, c); PL.set(id, p); } p.name = name; p.c = c;
  if (!p.av) { p.av = buildHiker(CREW_COL[c % CREW_COL.length]); const t = document.createElement('div'); t.className = 'tag'; $('tags').appendChild(t); p.tag = t; }
  return p;
}
function syncCrew(crew) {
  const ids = new Set(crew.map(c => c.id));
  for (const [id, p] of PL) if (!ids.has(id)) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); PL.delete(id); dropCanOf(id); }
  for (const c of crew) ensurePlayer(c.id, c.name, c.c);
  P = PL.get(myId());
}
const alive = () => [...PL.values()].filter(p => p.ready && !p.down && !p.dead && !p.esc);

// ---------------- collisions
function pushCircle(o, r, solids, trees) {
  const lists = solids ? [WALLS, SOL] : [WALLS];
  for (const L of lists) for (const w of L) {
    if (o.x < w.x0 - r || o.x > w.x1 + r || o.z < w.z0 - r || o.z > w.z1 + r) continue;
    const cx = clamp(o.x, w.x0, w.x1), cz = clamp(o.z, w.z0, w.z1); const dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) { o.x = cx + dx / d * r; o.z = cz + dz / d * r; } }
    else { const l = o.x - w.x0, rr = w.x1 - o.x, t = o.z - w.z0, b = w.z1 - o.z, m = Math.min(l, rr, t, b); if (m === l) o.x = w.x0 - r; else if (m === rr) o.x = w.x1 + r; else if (m === t) o.z = w.z0 - r; else o.z = w.z1 + r; }
  }
  if (trees) treesNear(o.x, o.z, t => { const dx = o.x - t.x, dz = o.z - t.z, d = Math.hypot(dx, dz), m = r + t.r; if (d < m && d > 1e-4) { o.x = t.x + dx / d * m; o.z = t.z + dz / d * m; } });
  o.x = clamp(o.x, -WS + 8, WS - 8); o.z = clamp(o.z, -WS + 8, WS - 8);
}
function segRect(ax, az, bx, bz, r) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, r.x0, r.x1], [az, dz, r.z0, r.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}
function losClear(ax, az, bx, bz) { for (const w of WALLS) if (segRect(ax, az, bx, bz, w)) return false; return true; }
function terrClear(ax, ay, az, bx, by, bz) { const d = Math.hypot(bx - ax, bz - az), n = Math.min(12, Math.floor(d / 6)); for (let i = 1; i < n; i++) { const t = i / n; if (gH(mix(ax, bx, t), mix(az, bz, t)) > mix(ay, by, t) + .2) return false; } return true; }
function foliage(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.floor(d / 2.5); let v = 1; const seen = new Set();
  for (let i = 1; i < n; i++) { const x = mix(ax, bx, i / n), z = mix(az, bz, i / n); treesNear(x, z, t => { if (!seen.has(t) && Math.hypot(t.x - x, t.z - z) < 1.3) { seen.add(t); v *= .8; } }); }
  return v;
}

// ---------------- creature navigation (as in Whisperpine)
function detour(ax, az, bx, bz) {
  const out = []; let cx = ax, cz = az;
  for (let it = 0; it < 5; it++) {
    let hit = null, hd = 1e9;
    for (const o of OBST) { if (inRect(cx, cz, o, -.05) || inRect(bx, bz, o, -.05)) continue; if (segRect(cx, cz, bx, bz, o)) { const d = Math.hypot((o.x0 + o.x1) / 2 - cx, (o.z0 + o.z1) / 2 - cz); if (d < hd) { hd = d; hit = o; } } }
    if (!hit) break;
    const m = .6, cs = [[hit.x0 - m, hit.z0 - m], [hit.x1 + m, hit.z0 - m], [hit.x0 - m, hit.z1 + m], [hit.x1 + m, hit.z1 + m]];
    let best = null, bd = 1e9;
    for (const c of cs) { if (segRect(cx, cz, c[0], c[1], {x0: hit.x0 + .05, x1: hit.x1 - .05, z0: hit.z0 + .05, z1: hit.z1 - .05})) continue; const d = Math.hypot(c[0] - cx, c[1] - cz) + Math.hypot(bx - c[0], bz - c[1]); if (d < bd) { bd = d; best = c; } }
    if (!best || (Math.abs(best[0] - cx) < .01 && Math.abs(best[1] - cz) < .01)) break;
    out.push(best); cx = best[0]; cz = best[1];
  }
  return out;
}
function plan(tx, tz, tzone) {
  const pts = [], fz = M.zone; let cx = M.x, cz = M.z;
  const dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]), me = [M.x, M.z];
  const axis = b => { const ax = b.din[0] - b.dout[0], az = b.din[1] - b.dout[1], l = Math.hypot(ax, az); return Math.abs(((M.x - b.dout[0]) * az - (M.z - b.dout[1]) * ax) / l); };
  if (fz >= 0 && fz !== tzone) { const b = BLD[fz]; if (!(axis(b) < .45 && dd(me, b.dout) < dd(b.din, b.dout) - .2)) pts.push(b.din); pts.push(b.dout); cx = b.dout[0]; cz = b.dout[1]; }
  let ex = tx, ez = tz; const tail = [];
  if (tzone >= 0 && tzone !== fz) { const b = BLD[tzone]; tail.push(b.dfront, b.dout, b.din); ex = b.dfront[0]; ez = b.dfront[1]; }
  if (fz < 0 && tail.length) { const b = BLD[tzone]; if (dd(me, b.dout) < dd(b.dfront, b.dout)) { tail.shift(); if (axis(b) < .45 && dd(me, b.din) < dd(b.dout, b.din)) tail.shift(); } ex = tail[0][0]; ez = tail[0][1]; }
  if (fz < 0 || fz !== tzone) pts.push(...detour(cx, cz, ex, ez));
  pts.push(...tail, [tx, tz]); M.path = pts;
}
function goTo(x, z, zone) { M.goal = [x, z, zone == null ? zoneOf(x, z) : zone]; plan(x, z, M.goal[2]); }
function moveAlong(dt, speed) {
  while (M.path.length && Math.hypot(M.path[0][0] - M.x, M.path[0][1] - M.z) < (M.path.length > 1 ? .55 : .3)) M.path.shift();
  if (!M.path.length) { M.spd = mix(M.spd, 0, dt * 6); return true; }
  const [wx, wz] = M.path[0], dx = wx - M.x, dz = wz - M.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz); M.yaw += clamp(angD(M.yaw, want), -dt * 7, dt * 7);
  const turnK = 1 - Math.min(.6, Math.abs(angD(M.yaw, want)) / PI), wade = wading(M.x, M.z) > .3 ? .8 : 1;
  M.spd = mix(M.spd, speed * turnK * wade, dt * 3);
  const st = Math.min(d, M.spd * dt); M.x += dx / d * st; M.z += dz / d * st;
  pushCircle(M, .32, false, true);
  return false;
}

// ---------------- items, cans, beacons
function itemMesh(kind) {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .5}, o));
  const g = new THREE.Group();
  if (kind === 'battery') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .1, 10), S({color: 0x2a5a2a, metalness: .4})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'flare') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .26, 8), S({color: 0xb0201a, emissive: 0x300000})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'note') { const n = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), S({map: TX.paper, side: THREE.DoubleSide, roughness: 1})); n.rotation.x = -PI / 2; g.add(n); }
  else if (kind === 'can') { const c = mkCanMesh(); c.position.y = .15; g.add(c); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}
const NOTES = [
  ['Forest Service notice\n\nIn an emergency, light the signal beacons on the ridges. Each takes one can of fuel.\n\nWhen four are burning, the county helicopter will set down at the landing clearing south of the campground.\n\nDo not hike alone after dark.'],
  ['Day 3. Lost Ben at the creek. We heard him shout once and then nothing.\n\nIt walks like a man until it sees you. Then it gets down on its hands and it is FAST.\n\nIt heard us splashing. Use the bridges.'],
  ['To whoever finds this,\n\nI hid in the cabin locker and held my breath while it stood right there. It went away.\n\nThe flares work. It will not go near the red light.\n\nIt always goes for whoever is on their own.'],
  ['Old logging camp. Keep out.\n\nGas cans in the shed are for the beacons only. Bring back what you do not use.'],
];
function placeItems() {
  for (const it of ITEMS) scene.remove(it.mesh); ITEMS.length = 0;
  for (const c of CANS) scene.remove(c.mesh); CANS.length = 0;
  const pool = SPOTS.slice().sort(() => WR() - .5);
  const take = (pred) => { const i = pool.findIndex(pred); return i >= 0 ? pool.splice(i, 1)[0] : null; };
  // one can right at camp so the first beacon is quick to understand
  const fixedNotes = [take(s => s.tag === 'camp'), take(s => s.tag === 'bridge'), take(s => s.tag === 'table'), take(s => s.tag === 'logging' || s.tag === 'bench')];
  fixedNotes.forEach((s, i) => { if (s) addItem('note', s, {text: NOTES[i][0]}); });
  const c0 = take(s => s.tag === 'camp'); if (c0) addCan(c0);
  for (let k = 0; k < 6; k++) { const s = take(s => s.tag !== 'camp' && CANS.every(c => Math.hypot(c.x - s.x, c.z - s.z) > 30)) || pool.pop(); if (s) addCan(s); }
  for (let k = 0; k < 6 && pool.length; k++) addItem('battery', pool.pop());
  for (let k = 0; k < 3 && pool.length; k++) addItem('flare', pool.pop());
}
function addItem(kind, s, extra = {}) {
  const m = itemMesh(kind); m.position.set(s.x, s.y + .03, s.z); m.rotation.y = WR() * TAU;
  const it = Object.assign({kind, mesh: m, x: s.x, y: s.y, z: s.z, taken: false, i: ITEMS.length}, extra); ITEMS.push(it); return it;
}
function addCan(s) { const m = itemMesh('can'); const c = {i: CANS.length, x: s.x, y: s.y, z: s.z, carrier: null, used: false, mesh: m}; m.position.set(c.x, c.y, c.z); CANS.push(c); }
function carrierOf(id) { for (const c of CANS) if (c.carrier === id && !c.used) return c.i; return -1; }
function dropCanOf(id) { const ci = carrierOf(id); if (ci < 0) return; const c = CANS[ci], p = PL.get(id); c.carrier = null; if (p) { c.x = p.x; c.z = p.z; c.y = floorY(p.x, p.z, zoneOf(p.x, p.z)); } }
function hideTaken(h) { for (const p of PL.values()) if (p.hd === h.i && p !== P) return true; return false; }

// ---------------- audio
const A = {ctx: null, on: false};
function aInit() {
  if (A.ctx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const c = A.ctx = new C(); A.out = c.createGain(); A.out.gain.value = .9; const comp = c.createDynamicsCompressor(); A.out.connect(comp); comp.connect(c.destination);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
  const loop = (f, q, g0, type = 'bandpass') => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl); fl.connect(g); s.start(); return {s, f: fl, g}; };
  const pan = (ref, roll) => { const p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 300}); p.connect(A.out); return p; };
  A.wind = loop(380, .6, .05); A.wind.g.connect(A.out);
  A.water = loop(1400, .4, 0, 'highpass'); A.water.g.connect(A.out);
  const o = c.createOscillator(); o.frequency.value = 4400; const og = c.createGain(); og.gain.value = 0; const am = c.createOscillator(); am.frequency.value = 28; am.type = 'square'; const amg = c.createGain(); amg.gain.value = .5; am.connect(amg); amg.connect(og.gain);
  const cr = c.createGain(); cr.gain.value = .006; o.connect(og); og.connect(cr); cr.connect(A.out); o.start(); am.start(); A.crick = cr;
  A.mPan = pan(2.5, 1.4);
  A.mBreath = loop(260, 3, 0); A.mBreath.g.connect(A.mPan);
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 46; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 220; const sg = c.createGain(); sg.gain.value = 0; saw.connect(sf); sf.connect(sg); sg.connect(A.mPan); saw.start(); A.mGrowl = sg; A.mSaw = saw;
  const dg = c.createGain(); dg.gain.value = 0; dg.connect(A.out); A.drone = dg; const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 300; df.connect(dg); A.droneF = df;
  for (const f of [55, 58.3, 82.4, 110.6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.connect(df); x.start(); }
  A.fPan = pan(4, 1.2); A.fire = loop(900, .5, 0); A.fire.g.connect(A.fPan);
  A.hPan = pan(12, .7); A.rotor = loop(120, 1, 0, 'lowpass'); A.rotor.g.connect(A.hPan); A.rotorLfo = c.createOscillator(); A.rotorLfo.frequency.value = 17; const lg = c.createGain(); lg.gain.value = 0; A.rotorLfo.connect(lg); lg.connect(A.rotor.g.gain); A.rotorLfoG = lg; A.rotorLfo.start();
  A.on = true;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1) { if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); env(g, t, .005, peak, dec); s.connect(fl); fl.connect(g); g.connect(dest || A.out); s.start(t, Math.random()); s.stop(t + dec + .1); }
function tone(f, peak, dec, type = 'sine', dest, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
function at(x, y, z, ref = 3) { if (!A.on) return null; const p = A.ctx.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.1}); setPan(p, x, y, z); p.connect(A.out); setTimeout(() => p.disconnect(), 4000); return p; }
const Snd = {
  step(wood, k, wet) { if (wet) { burst(700, .5, .09 * k, .2, 'bandpass', null, .7); return; } burst(wood ? 500 : 1100, wood ? 1.2 : .7, .05 * k, wood ? .09 : .07); if (wood) tone(140 + Math.random() * 30, .025 * k, .06); },
  rStep(x, y, z, k, wet) { const p = at(x, y, z, 2); if (p) burst(wet ? 700 : 900, .7, (wet ? .12 : .05) * k, wet ? .2 : .08, 'bandpass', p); },
  mStep(k) { burst(160, 1, .35 * k, .16, 'lowpass', A.mPan); },
  heart(k) { tone(58, .25 * k, .12); setTimeout(() => tone(52, .18 * k, .14), 170); },
  pickup() { tone(660, .05, .25); setTimeout(() => tone(990, .04, .3), 90); },
  click() { burst(3000, 3, .05, .02); },
  stinger() { for (const f of [233, 247, 311, 466]) tone(f, .06, 1.6, 'sawtooth'); burst(3000, .4, .25, 1.4, 'highpass'); },
  scream(dest) { for (const f of [520, 560, 790]) tone(f, .22, 1.2, 'sawtooth', dest, f * .4); burst(1800, .5, .9, 1.4, 'bandpass', dest); },
  creak() { tone(90, .06, .7, 'sawtooth', A.mPan, 60); burst(700, 6, .1, .6, 'bandpass', A.mPan, .4); },
  gasp() { burst(1300, 1.5, .25, .45); },
  flare(p) { burst(2500, .5, .3, 1.2, 'highpass', p); },
  pour() { burst(600, 2, .06, .25, 'bandpass', null, .5); },
  whoosh(p) { burst(300, .4, .8, 2.2, 'lowpass', p); burst(1200, .5, .3, 1.6, 'bandpass', p); },
  whistle(p) { tone(2600, .12, .5, 'sine', p, 2900); setTimeout(() => tone(2900, .1, .6, 'sine', p, 2400), 380); },
  hurt(p) { burst(500, 1, .5, .5, 'lowpass', p); tone(160, .2, .5, 'sawtooth', p, 70); },
  revive() { tone(440, .06, .3); setTimeout(() => tone(660, .06, .4), 140); },
};
function setPan(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }

// ---------------- UI helpers
function showMsg(txt, who, dur = 4) { $('msg').innerHTML = (who ? `<b>${who}</b>` : '') + txt; $('msg').style.opacity = 1; G.msgT = dur; }
let objLast = '';
function objText() {
  const lit = BEA.filter(b => b.lit).length;
  if (G.ph === 0) return lit ? `Light the signal beacons: ${lit} of 4 burning. Carry fuel cans to the ridges.` : 'Find fuel cans and light the four signal beacons on the ridges. There is a can at the campsite.';
  if (G.ph === 1) return `All four beacons are burning. Get to the landing clearing: the helicopter lands in ${Math.ceil(G.timer)} s.`;
  if (G.ph === 2) return `The helicopter is down! Get aboard (it leaves in ${Math.ceil(G.timer)} s).`;
  return '';
}

// ---------------- creature senses
function eyeDir(p) { return [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)]; }
function beamHits(p, x, y, z) { const ey = p.y + 1.55, dx = x - p.x, dy = y - ey, dz = z - p.z, d = Math.hypot(dx, dy, dz), f = eyeDir(p); return (dx * f[0] + dy * f[1] + dz * f[2]) / d > Math.cos(.4); }
function seesP(p) {
  if (p.hd >= 0 || !p.ready || p.down || p.dead || p.esc) return 0;
  const dx = p.x - M.x, dz = p.z - M.z, d = Math.hypot(dx, dz);
  let range = D.sight * (p.l ? 1 : .42) * (p.cr ? .65 : 1) * (p.spd < .3 ? .75 : 1);
  if (p.cr && !p.l && inBush(p.x, p.z)) range *= .4;
  for (const f of FIRES) if (f.lit && Math.hypot(p.x - f.x, p.z - f.z) < (f.bea != null ? 14 : 7)) { range = Math.max(range, D.sight * .9); break; }
  const beam = p.l && d < 42 && beamHits(p, M.x, M.y + 2, M.z);
  if (beam) range = Math.max(range, 44);
  if (d > range) return 0;
  const fa = Math.atan2(-dx, -dz); if (d > 3.5 && !beam && Math.abs(angD(M.yaw, fa)) > 1.25) return 0;
  if (!losClear(M.x, M.z, p.x, p.z)) return 0;
  if (!terrClear(M.x, M.y + 2.3, M.z, p.x, p.y + 1.3, p.z)) return 0;
  const f = foliage(M.x, M.z, p.x, p.z); if (f < .3) return 0;
  return clamp(1.4 - d / range, .1, 1.4) * f * (beam ? 1.6 : 1);
}
function pSeesMon(p) {
  const ey = p.y + 1.55, dx = M.x - p.x, dz = M.z - p.z, d = Math.hypot(dx, dz), f = eyeDir(p), dy = M.y + 1.8 - ey;
  const dot = (dx * f[0] + dy * f[1] + dz * f[2]) / Math.hypot(dx, dy, dz);
  if (dot < .8 || !losClear(p.x, p.z, M.x, M.z)) return 0;
  const lit = (p.l && d < 36 && dot > Math.cos(.42)) || d < 10;
  return lit ? 1 : d < 18 ? .5 : 0;
}
function noise(x, z, r, zone) {
  if (!isHost()) return;
  r *= D.hear; const d = Math.hypot(x - M.x, z - M.z);
  if (!losClear(x, z, M.x, M.z)) r *= .6;
  if (d > r || M.state === 'chase' || M.state === 'flee' || M.state === 'kill') return;
  const fuzz = d * .12, tx = x + (CR() - .5) * fuzz, tz = z + (CR() - .5) * fuzz;
  M.state = 'inv'; M.idle = 0; const zz = zone == null ? zoneOf(tx, tz) : zone; goTo(tx, tz, zz); M.invZone = zone == null ? zoneOf(x, z) : zone;
}
function pickRoam() {
  const prey = M.prey && PL.get(M.prey) && !PL.get(M.prey).down ? PL.get(M.prey) : alive()[0]; if (!prey) return;
  const R0 = D.roam * (G.ph ? .6 : 1) * (M.avoidT > 0 ? 1.4 : 1);
  for (let k = 0; k < 20; k++) {
    const a = CR() * TAU, r = (M.avoidT > 0 ? 30 : 10) + CR() * R0, x = prey.x + Math.cos(a) * r, z = prey.z + Math.sin(a) * r;
    if (Math.abs(x) > WS - 12 || Math.abs(z) > WS - 12 || zoneOf(x, z, -1) >= 0) continue;
    if (M.avoidT > 0 && alive().some(p => Math.hypot(p.x - x, p.z - z) < 28)) continue;
    goTo(x, z, -1); return;
  }
  if (CR() < .3) { const b = BLD[Math.floor(CR() * BLD.length)]; goTo(b.din[0], b.din[1], b.i); }
}
function teleportNear(p, minR, maxR, front) {
  for (let k = 0; k < 40; k++) {
    const a = p.yaw + (front ? 0 : PI) + (CR() - .5) * (front ? 1.4 : 2.2), r = minR + CR() * (maxR - minR);
    const x = p.x - Math.sin(a) * r, z = p.z - Math.cos(a) * r;
    if (Math.abs(x) > WS - 12 || Math.abs(z) > WS - 12 || zoneOf(x, z, -1.5) >= 0 || wading(x, z) > 0) continue;
    let bad = false; for (const o of OBST) if (inRect(x, z, o, .5)) bad = true; if (bad) continue;
    if (alive().some(q => Math.hypot(q.x - x, q.z - z) < minR * .8)) continue;
    const y = gH(x, z), vis = losClear(p.x, p.z, x, z) && terrClear(p.x, p.y + 1.6, p.z, x, y + 2, z) && foliage(p.x, p.z, x, z) > .35;
    if (front && !vis) continue;
    if (!front && alive().some(q => { const f = eyeDir(q), dx = x - q.x, dz = z - q.z, dd = Math.hypot(dx, dz); return (dx * f[0] + dz * f[2]) / dd > .2 && dd < 70; })) continue;
    M.x = x; M.z = z; M.y = y; M.zone = -1; M.path = []; return true;
  }
  return false;
}
function downPlayer(p, how) {
  if (p.down || p.dead) return;
  p.down = true; p.bleed = D.bleed; p.hd = -1; dropCanOf(p.id);
  emit({k: 'down', id: p.id, how});
  M.state = 'flee'; M.flee = D.down; M.tgt = null; M.sawHide = -1; M.aware = 0;
  const ax = M.x - p.x, az = M.z - p.z, l = Math.hypot(ax, az) || 1; goTo(clamp(M.x + ax / l * 40, -WS + 12, WS - 12), clamp(M.z + az / l * 40, -WS + 12, WS - 12), -1);
}
function stepCreature(dt) {
  if (M.state === 'kill') return;
  M.zone = zoneOf(M.x, M.z, -.1);
  M.y = mix(M.y, floorY(M.x, M.z, M.zone), Math.min(1, dt * 10));
  M.avoidT = (M.avoidT || 0) - dt;
  const ps = alive(); if (!ps.length) { M.spd = 0; return; }
  let tgt = M.tgt && PL.get(M.tgt); if (tgt && (tgt.down || tgt.dead || tgt.esc)) { tgt = null; M.tgt = null; }
  const dOf = p => Math.hypot(p.x - M.x, p.z - M.z);
  const prog = BEA.filter(b => b.lit).length * .025 + (G.ph ? .08 : 0);
  // prey: the most isolated hiker
  M.preyT -= dt; if (M.preyT <= 0) { M.preyT = 25; let best = null, bv = -1; for (const p of ps) { let m = 1e9; for (const q of ps) if (q !== p) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)); if (ps.length === 1) m = 0; const v = m + p.heat * 20 + CR() * 10; if (v > bv) { bv = v; best = p; } } M.prey = best ? best.id : null; }
  for (const p of PL.values()) p.heat = Math.max(0, p.heat - dt * .05);
  for (const f of G.flares) if (f.t > 0 && Math.hypot(f.x - M.x, f.z - M.z) < 9.5 && M.state !== 'flee') { M.state = 'flee'; M.flee = 6; M.tgt = null; const ax = M.x - f.x, az = M.z - f.z, l = Math.hypot(ax, az) || 1; goTo(clamp(M.x + ax / l * 30, -WS + 12, WS - 12), clamp(M.z + az / l * 30, -WS + 12, WS - 12), -1); emit({k: 'snd', s: 'creak'}); break; }
  M.senseT = (M.senseT || 0) - dt;
  if (M.senseT <= 0) { M.senseT = .12; let bs = 0, bp = null; for (const p of ps) { const s = seesP(p) * (p.id === M.prey ? 1.25 : 1); if (s > bs) { bs = s; bp = p; } } M.see = bs; M.seeP = bp ? bp.id : null; }
  const see = M.state === 'stalk' || M.state === 'flee' ? 0 : M.see, seeP = PL.get(M.seeP);
  if (see > 0) M.aware = Math.min(1.5, M.aware + dt * see / D.react); else M.aware = Math.max(0, M.aware - dt * .25);
  if (see > 0 && seeP && (M.aware >= 1 || dOf(seeP) < 5)) {
    if (M.state !== 'chase') { M.state = 'chase'; if (G.t - M.screamT > 9) { M.screamT = G.t; emit({k: 'snd', s: 'stinger'}); } }
    if (!tgt || tgt.id === seeP.id || dOf(seeP) < dOf(tgt) - 6) tgt = seeP;
    M.tgt = tgt.id; M.lx = tgt.x; M.lz = tgt.z; M.lzone = tgt.zone; M.lostT = 0; M.seenAt = G.t; M.sawHide = -1;
  }
  if (G.ph && D.hint) { M.hintT -= dt; if (M.hintT <= 0) { M.hintT = D.hint * (.7 + CR() * .6); const q = PL.get(M.prey) || ps[0]; if (M.state === 'roam' || M.state === 'inv') noise(q.x + (CR() - .5) * 16, q.z + (CR() - .5) * 16, 999); } }
  let speed = 1.7;
  switch (M.state) {
    case 'roam': {
      if (!M.path.length) { M.idle -= dt; M.look = Math.sin(G.t * 1.3) * .3; if (M.idle <= 0) { pickRoam(); M.idle = 1.5 + CR() * 4; } }
      speed = (M.avoidT > 0 ? 2.6 : 1.7) + prog * 4;
      if (BEA.every(b => !b.lit)) { M.stalkT -= dt; if (M.stalkT <= 0) { M.stalkT = 55 + CR() * 40; const q = ps[Math.floor(CR() * ps.length)]; if (dOf(q) > 40 && q.zone < 0 && teleportNear(q, 30, 42, true)) { M.state = 'stalk'; M.stalkTime = 0; M.stalkSeen = 0; M.path = []; M.stalkOf = q.id; } } }
      if (ps.every(p => dOf(p) > 80) && G.t > 90) { M.far += dt; if (M.far > 22) { M.far = 0; const q = PL.get(M.prey) || ps[0]; teleportNear(q, 42, 58, false); } } else M.far = 0;
      break;
    }
    case 'inv': {
      speed = 3.1 + prog * 5;
      if (moveAlong(dt, speed)) { if (M.invZone >= 0 && BLD[M.invZone].hides.length) { startSearch(M.invZone); break; } M.idle += dt; M.look = Math.sin(G.t * 2) * .5; if (M.idle > 3.5) { M.state = 'roam'; M.idle = 1; M.avoidT = 10; } }
      return finish(dt);
    }
    case 'chase': {
      speed = D.chase * (1 + prog);
      if (!tgt) { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx, M.lz); break; }
      if (tgt.hd >= 0 && M.sawHide === tgt.hd) { const h = HIDES[tgt.hd]; M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .3; goTo(h.ex, h.ez, h.b); } if (Math.hypot(M.x - h.ex, M.z - h.ez) < 1.1 || Math.hypot(M.x - h.x, M.z - h.z) < 1.3) { emit({k: 'snd', s: 'creak'}); downPlayer(tgt, 'pulled'); return finish(dt); } }
      else if (tgt.hd >= 0 && G.t - M.seenAt < 1.2) { M.sawHide = tgt.hd; }
      else {
        if (see > 0 && M.seeP === tgt.id) { M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .25; goTo(tgt.x, tgt.z, tgt.zone); } }
        else { M.lostT += dt; if (!M.path.length || M.lostT < .1) goTo(M.lx, M.lz, M.lzone); if (M.lostT > D.lost) { const z = M.lzone; M.tgt = null; if (z >= 0 && BLD[z].hides.length) startSearch(z, true); else { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx + clamp(tgt.x - M.lx, -8, 8), M.lz + clamp(tgt.z - M.lz, -8, 8)); } } }
        if (dOf(tgt) < 1.3 && Math.abs(tgt.y - M.y) < 1.6 && losClear(M.x, M.z, tgt.x, tgt.z)) { downPlayer(tgt, 'caught'); return finish(dt); }
      }
      break;
    }
    case 'search': {
      speed = 2.4 + prog * 4;
      if (M.chkT > 0) {
        M.chkT -= dt; M.spd = 0; const h = M.chkH; M.yaw += angD(M.yaw, Math.atan2(-(h.x - M.x), -(h.z - M.z))) * Math.min(1, dt * 6);
        if (M.chkT <= .9 && !M.chkDone) { M.chkDone = true; emit({k: 'snd', s: 'creak'}); for (const p of PL.values()) if (p.hd === h.i && !p.hb && !p.down) { downPlayer(p, 'pulled'); return finish(dt); } }
        if (M.chkT <= 0) nextCheck();
        return finish(dt);
      }
      if (moveAlong(dt, speed)) { if (M.chkH) { M.chkT = 1.8; M.chkDone = false; } else nextCheck(); }
      for (const p of PL.values()) if (p.hd >= 0 && !p.hb && Math.hypot(p.x - M.x, p.z - M.z) < 3.2 && CR() < dt * D.breathHear * 2 && M.chkH !== HIDES[p.hd]) { M.chk.unshift(HIDES[p.hd]); nextCheck(); break; }
      return finish(dt);
    }
    case 'stalk': {
      const q = PL.get(M.stalkOf) || ps[0];
      M.spd = 0; M.yaw += angD(M.yaw, Math.atan2(-(q.x - M.x), -(q.z - M.z))) * Math.min(1, dt * 4); M.stalkTime += dt;
      let s = 0; for (const p of ps) s = Math.max(s, pSeesMon(p)); M.stalkSeen += dt * s;
      if (M.stalkSeen > 1.1 || M.stalkTime > 16 || ps.some(p => dOf(p) < 20)) { if (M.stalkSeen > 1.1) emit({k: 'snd', s: 'stinger'}); M.state = 'roam'; teleportNear(q, 60, 80, false); M.path = []; M.idle = 6; }
      return finish(dt);
    }
    case 'flee': { speed = 5.4; M.flee -= dt; if (M.flee <= 0 || !M.path.length) { M.state = 'roam'; M.idle = 3; M.avoidT = 8; } break; }
  }
  moveAlong(dt, speed);
  return finish(dt);
}
function startSearch(z, fast) {
  const b = BLD[z]; M.state = 'search'; M.chk = b.hides.filter(() => CR() < D.checkP * (fast ? 1.3 : 1));
  for (const p of PL.values()) if (p.hd >= 0 && HIDES[p.hd].b === z && fast && !M.chk.includes(HIDES[p.hd]) && CR() < D.checkP) M.chk.push(HIDES[p.hd]);
  M.chk.sort(() => CR() - .5); M.chkH = null; M.chkT = 0; M.searchZ = z;
  goTo(b.din[0], b.din[1], z);
  if (M.chk.length) nextCheck();
}
function nextCheck() {
  M.chkT = 0; M.chkH = M.chk.shift() || null; M.chkDone = false;
  if (M.chkH) goTo(M.chkH.ex, M.chkH.ez, M.chkH.b); else { M.state = 'roam'; M.idle = 0; M.avoidT = 25; M.path = []; pickRoam(); }
}
function finish(dt) {
  M.stuck += dt; if (M.stuck > 2.5) { if (Math.hypot(M.x - M.sx, M.z - M.sz) < .6 && M.path.length && M.state !== 'stalk') { M.path = []; if (M.goal) { M.x += (CR() - .5) * .6; M.z += (CR() - .5) * .6; plan(M.goal[0], M.goal[1], M.goal[2]); } } M.stuck = 0; M.sx = M.x; M.sz = M.z; }
  if (M.state !== 'flee' && M.state !== 'stalk') for (const p of alive()) if (p.hd < 0 && Math.hypot(p.x - M.x, p.z - M.z) < 1.0 && Math.abs(p.y - M.y) < 1.6) { downPlayer(p, 'caught'); break; }
}

// ---------------- events (host emits, everyone applies)
function emit(e) { applyEv(e); if (Net.role === 'host') G.evq.push(e); }
function applyEv(e) {
  const me = myId();
  switch (e.k) {
    case 'snd': if (e.s === 'stinger') Snd.stinger(); else if (e.s === 'creak') Snd.creak(); break;
    case 'down': { const p = PL.get(e.id); if (p) { p.down = true; p.hd = -1; }
      if (e.id === me) { Snd.scream(); $('flash').style.opacity = .7; setTimeout(() => $('flash').style.opacity = 0, 300); P.hd = -1; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); showMsg('It got you. Crawl toward your group, they can pick you up.', '', 5); }
      else if (p) { Snd.hurt(at(p.x, p.y + 1, p.z, 6)); showMsg(`${p.name} is down! Hold E on them to pick them up.`, '', 5); } break; }
    case 'rev': { const p = PL.get(e.id); if (p) p.down = false; Snd.revive(); if (e.id === me) showMsg('You are back on your feet.'); else if (p) showMsg(`${p.name} is back up.`); break; }
    case 'dead': { const p = PL.get(e.id); if (p) { p.dead = true; p.down = false; } showMsg(e.id === me ? 'You bled out.' : `${p ? p.name : 'Someone'} bled out.`, '', 5); break; }
    case 'give': if (e.id === me) { if (e.kind === 'battery') { P.bat = Math.min(1, P.bat + .5); showMsg('Fresh batteries.'); } if (e.kind === 'flare') { P.flares++; showMsg('Picked up a road flare. Throw it with G.'); } Snd.pickup(); } break;
    case 'lit': { const b = BEA[e.i]; b.lit = true; FIRES.find(f => f.bea === e.i).lit = true; Snd.whoosh(at(b.x, b.y + 1, b.z, 10)); const n = BEA.filter(q => q.lit).length; showMsg(`${b.name} beacon is burning (${n} of 4).` + (n < 4 ? ' It will have heard that.' : ''), '', 5); break; }
    case 'fl': if (e.id !== me) spawnFlare(e); break;
    case 'wh': { const p = PL.get(e.id); if (p) { p.pingT = 6; Snd.whistle(at(p.x, p.y + 1.6, p.z, 8)); } break; }
    case 'ph': G.ph = e.ph; G.timer = e.timer; if (e.ph === 1) { showMsg('Radio crackle: "We see your fires. Chopper is on its way to the landing clearing. Hold on."', 'RESCUE', 7); Snd.stinger(); } if (e.ph === 2) showMsg('The helicopter is landing at the clearing. GET ABOARD!', '', 6); break;
    case 'esc': { const p = PL.get(e.id); if (p) p.esc = true; if (e.id === me) showMsg('You made it aboard. Watch the others.', '', 5); break; }
    case 'over': gameOver(e); break;
  }
}

// ---------------- host simulation
function hostStep(dt) {
  G.t += dt;
  for (const p of PL.values()) {
    if (!p.ready) continue;
    p.zone = zoneOf(p.x, p.z, -.05);
    const mv = Math.hypot(p.x - p.lx, p.z - p.lz); p.lx = p.x; p.lz = p.z; p.spd = mix(p.spd, mv / Math.max(dt, 1e-3), Math.min(1, dt * 5));
    if (p !== P && !p.down && mv < 3) { p.sd += mv; const stride = p.run ? 1 : p.cr ? .55 : .75; if (p.sd > stride) { p.sd = 0; const wet = wading(p.x, p.z) > .2; noise(p.x, p.z, (p.run ? 24 : p.cr ? 2.2 : 8.5) * (wet ? 1.8 : 1) * (p.zone >= 0 ? 1.35 : 1), p.zone); if (p.run || wet) p.heat += .02; } }
    if (p.l) p.heat = Math.min(1, p.heat + dt * .004);
    if (p.down && !p.dead) { p.bleed -= dt; if (p.bleed <= 0) { p.down = false; p.dead = true; dropCanOf(p.id); emit({k: 'dead', id: p.id}); } }
  }
  // holds: pour fuel / revive
  const hold = {};
  for (const p of PL.values()) {
    if (!p.ready || !p.h || p.down || p.dead || p.esc) continue;
    if (p.h[0] === 'b') { const i = +p.h.slice(1), b = BEA[i]; if (b && !b.lit && carrierOf(p.id) >= 0 && Math.hypot(p.x - b.x, p.z - b.z) < 3.6) (hold[p.h] = hold[p.h] || []).push(p); }
    else if (p.h[0] === 'r') { const q = PL.get(p.h.slice(1)); if (q && q.down && Math.hypot(p.x - q.x, p.z - q.z) < 2.6) (hold[p.h] = hold[p.h] || []).push(p); }
  }
  for (const k in G.holdP) if (!hold[k]) { G.holdP[k] -= dt * (k[0] === 'r' ? .5 : .1); if (G.holdP[k] <= 0) delete G.holdP[k]; }
  for (const k in hold) {
    const n = hold[k].length; G.holdP[k] = (G.holdP[k] || 0) + dt * (k[0] === 'b' ? 1 / 5 : 1 / 4) * Math.min(2, .6 + .4 * n + (n > 1 ? .2 : 0));
    G.noiseT = (G.noiseT || 0) - dt; if (G.noiseT <= 0) { G.noiseT = 1; noise(hold[k][0].x, hold[k][0].z, k[0] === 'b' ? 18 : 14); }
    if (G.holdP[k] >= 1) {
      delete G.holdP[k];
      if (k[0] === 'b') { const i = +k.slice(1); const ci = carrierOf(hold[k][0].id); if (ci >= 0) { CANS[ci].used = true; CANS[ci].carrier = null; } emit({k: 'lit', i}); noise(BEA[i].x, BEA[i].z, 80); for (const p of hold[k]) p.heat += .4; if (BEA.every(b => b.lit) && G.ph === 0) emit({k: 'ph', ph: 1, timer: D.escape}); }
      else { const q = PL.get(k.slice(1)); if (q) { q.down = false; emit({k: 'rev', id: q.id}); } }
    }
  }
  // phases
  if (G.ph === 1) { G.timer -= dt; if (G.timer <= 0) emit({k: 'ph', ph: 2, timer: 35}); }
  else if (G.ph === 2) { if (!G.heli) G.heli = {y: 70}; G.heli.y = Math.max(0, G.heli.y - dt * 9); G.heliDown = G.heli.y < .2; G.timer -= dt; for (const p of alive()) if (p.boardReq) { p.boardReq = false; if (G.heliDown && Math.hypot(p.x - HELI.x, p.z - HELI.z) < 10) { p.esc = true; dropCanOf(p.id); emit({k: 'esc', id: p.id}); } } if (G.timer <= 0) endRun(); }
  if (!G.overSent) { if (!alive().length) { G.allDownT = (G.allDownT || 0) + dt; if (G.allDownT > 4) endRun(); } else G.allDownT = 0; }
  stepCreature(dt);
}
function endRun() { if (G.overSent) return; G.overSent = true; const res = [...PL.values()].filter(p => p.ready).map(p => [p.name, p.esc ? 'esc' : p.dead ? 'dead' : p.down ? 'left' : 'left', p.c]); emit({k: 'over', win: res.some(r => r[1] === 'esc'), res, t: Math.round(G.t)}); }
function hostAct(id, m) {
  const p = PL.get(id); if (!p || !G.on || G.over) return;
  if (m.px != null && p !== P && Math.hypot(m.px - p.x, m.pz - p.z) < 25) { p.x = m.px; p.z = m.pz; }
  if (m.a === 'pick') { const it = ITEMS[m.i]; if (it && !it.taken && it.kind !== 'note' && Math.hypot(p.x - it.x, p.z - it.z) < 3.5) { it.taken = true; emit({k: 'give', id, kind: it.kind}); } }
  else if (m.a === 'can') { const c = CANS[m.i]; if (c && !c.used && !c.carrier && carrierOf(id) < 0 && !p.down && Math.hypot(p.x - c.x, p.z - c.z) < 3.5) c.carrier = id; }
  else if (m.a === 'drop') dropCanOf(id);
  else if (m.a === 'fl') { spawnFlare(Object.assign({}, m, {id})); if (Net.role === 'host') G.evq.push(Object.assign({k: 'fl'}, m, {id})); }
  else if (m.a === 'wh') { emit({k: 'wh', id}); noise(p.x, p.z, 45); p.heat += .1; }
  else if (m.a === 'board') p.boardReq = true;
  else if (m.a === 'gasp') noise(p.x, p.z, 9, p.hd >= 0 ? HIDES[p.hd].b : null);
}
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({t: 'act', px: +P.x.toFixed(2), pz: +P.z.toFixed(2)}, m)); }

// ---------------- snapshots
function packSnap() {
  const ps = {}; for (const p of PL.values()) ps[p.id] = [p.down ? 1 : 0, Math.ceil(p.bleed), p.dead ? 1 : 0, p.esc ? 1 : 0];
  const s = {t: 'snap', m: [+M.x.toFixed(2), +M.y.toFixed(2), +M.z.toFixed(2), +M.yaw.toFixed(2), M.state, +M.spd.toFixed(2), +(M.look || 0).toFixed(2)],
    ps, b: BEA.map(b => b.lit ? 1 : 0), c: CANS.map(c => c.used ? 0 : [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2), c.carrier || '']), it: ITEMS.map(i => i.taken ? 1 : 0).join(''),
    hp: G.holdP, ph: G.ph, tm: +G.timer.toFixed(1), gt: +G.t.toFixed(1), hl: G.heli ? [+G.heli.y.toFixed(2), G.heliDown ? 1 : 0] : 0, ev: G.evq};
  G.evq = []; return s;
}
function applySnap(s) {
  const [x, y, z, yaw, st, spd, look] = s.m; M.tx = x; M.ty = y; M.tz = z; M.tyaw = yaw; M.state = st; M.spd = spd; M.look = look;
  for (const id in s.ps) { const p = PL.get(id); if (!p) continue; const [d, bl, de, es] = s.ps[id]; p.down = !!d; p.bleed = bl; p.dead = !!de; p.esc = !!es; }
  s.b.forEach((v, i) => { if (v && !BEA[i].lit) { BEA[i].lit = true; FIRES.find(f => f.bea === i).lit = true; } });
  s.c.forEach((c, i) => { const k = CANS[i]; if (!k) return; if (!c) { k.used = true; k.carrier = null; return; } k.used = false; k.x = c[0]; k.y = c[1]; k.z = c[2]; k.carrier = c[3] || null; });
  for (let i = 0; i < ITEMS.length; i++) ITEMS[i].taken = s.it[i] === '1';
  G.holdP = s.hp || {}; G.ph = s.ph; G.timer = s.tm; G.t = s.gt;
  if (s.hl) { if (!G.heli) G.heli = {y: 60}; G.heli.ty = s.hl[0]; G.heliDown = !!s.hl[1]; }
  for (const e of s.ev || []) applyEv(e);
}
Net.on('snap', m => { if (G.on && !isHost()) applySnap(m); });
Net.on('pose', (m, from) => {
  if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId()) return; const p = PL.get(id); if (!p) return;
  p.x = m.x; p.z = m.z; p.y = m.y; p.yaw = m.yw; p.pitch = m.pt; p.cr = m.cr; p.l = m.l; p.run = m.rn; p.h = m.h || ''; p.hd = m.hd; p.hb = m.hb; if (!p.ready) { p.ready = true; p.rx = p.x; p.ry = p.y; p.rz = p.z; p.lx = p.x; p.lz = p.z; }
  if (!isHost() || true) { p.stepD = (p.stepD || 0) + Math.hypot(m.x - (p.px || m.x), m.z - (p.pz || m.z)); p.px = m.x; p.pz = m.z; }
});
Net.on('act', (m, from) => { if (isHost() && G.on) hostAct(from, m); });

// ---------------- flares (simulated on every client from the throw)
function spawnFlare(e) {
  const m = new THREE.Group(); m.add(itemMesh('flare'));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff3018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); glow.scale.set(1.4, 1.4, 1); m.add(glow);
  scene.add(m); const f = {m, glow, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, t: 32, rest: false}; G.flares.push(f);
  Snd.flare(at(e.x, e.y, e.z, 4)); if (G.flares.length > 3) { const o = G.flares.shift(); scene.remove(o.m); }
}
function throwFlare() {
  if (P.flares <= 0 || P.hd >= 0 || P.down || !alivePlay()) return; P.flares--;
  const f = eyeDir(P), e = {a: 'fl', x: P.x + f[0] * .4, y: P.y + P.eye - .2, z: P.z + f[2] * .4, vx: f[0] * 10 + P.vx, vy: f[1] * 10 + 3, vz: f[2] * 10 + P.vz};
  spawnFlare(e); if (isHost()) { if (Net.role === 'host') G.evq.push(Object.assign({k: 'fl', id: myId()}, e)); } else Net.send(Object.assign({t: 'act'}, e));
}
function stepFlares(dt) {
  for (let i = 0; i < G.flares.length; i++) {
    const f = G.flares[i];
    if (!f.rest) { f.vy -= 9.8 * dt; const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt; if (!losClear(f.x, f.z, nx, nz)) { f.vx *= -.3; f.vz *= -.3; } else { f.x = nx; f.z = nz; } f.y += f.vy * dt;
      const gy = floorY(f.x, f.z, zoneOf(f.x, f.z)) + .03; if (f.y < gy) { f.y = gy; f.vy *= -.25; f.vx *= .5; f.vz *= .5; if (Math.hypot(f.vx, f.vz) < .5) { f.rest = true; noise(f.x, f.z, 10); } } }
    f.t -= dt; f.m.position.set(f.x, f.y, f.z); f.m.rotation.set(0, 0, f.rest ? 0 : G.t * 9);
    const on = f.t > 0, fl = .8 + Math.random() * .4; FLL[i].intensity = on ? 16 * fl * Math.min(1, f.t / 3) : 0; FLL[i].position.set(f.x, f.y + .35, f.z);
    f.glow.material.opacity = on ? .8 * fl : 0;
  }
  for (let i = G.flares.length; i < FLL.length; i++) FLL[i].intensity = 0;
}

// ---------------- local player
const K = {}; let mouseR = false, eDown = false, ePress = false;
const alivePlay = () => P && !P.dead && !P.esc;
function stepPlayer(dt) {
  if (!alivePlay()) return;
  if (P.hd >= 0) {
    const h = HIDES[P.hd]; P.x = h.x; P.z = h.z; P.y = h.y; P.vx = P.vz = 0;
    const want = (mouseR || K.Space) && P.gasp <= 0;
    if (want && P.breath > 0) { P.hb = 1; P.breath -= dt / 10; if (P.breath <= 0) { P.breath = 0; P.hb = 0; P.gasp = 2.2; Snd.gasp(); if (isHost()) noise(P.x, P.z, 9, h.b); else P.gaspN = true; } }
    else { P.hb = 0; P.breath = Math.min(1, P.breath + dt / 6); }
    P.gasp -= dt; $('breath').querySelector('i').style.width = P.breath * 100 + '%';
    return;
  }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mag = Math.hypot(fw, st) || 1;
  const carry = carrierOf(P.id) >= 0, wet = wading(P.x, P.z);
  let run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && P.stam > .02 && !P.cr && !carry && !P.down;
  if (P.tired && P.stam < .3) run = false; if (P.stam > .3) P.tired = false;
  let sp = P.down ? .55 : P.cr ? 1.6 : run ? 6.0 : 3.0; if (carry) sp *= .8; if (wet > .2) sp *= mix(1, .5, wet);
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp, acc = (fw || st) ? 9 : 12;
  P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * acc)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * acc));
  const ox = P.x, oz = P.z; P.x += P.vx * dt; P.z += P.vz * dt;
  pushCircle(P, .33, true, true);
  const moved = Math.hypot(P.x - ox, P.z - oz), v = moved / Math.max(dt, 1e-4); P.run = run && v > 1 ? 1 : 0;
  if (P.run) { P.stam -= dt / 7; if (P.stam <= 0) { P.stam = 0; P.tired = true; } } else P.stam = Math.min(1, P.stam + dt / (v > .5 ? 11 : 7));
  P.zone = zoneOf(P.x, P.z, -.05);
  const fy = floorY(P.x, P.z, P.zone); P.y = mix(P.y || fy, fy, Math.min(1, dt * 14));
  P.eye = mix(P.eye, P.down ? .45 : P.cr ? 1.0 : 1.62, Math.min(1, dt * 8));
  P.stepD += moved; const stride = run ? 1.0 : P.cr ? .55 : .75; P.bob += moved * (run ? 1.25 : 1.6);
  if (P.stepD > stride) { P.stepD = 0; const wood = P.zone >= 0 || bridgeY(P.x, P.z) > -1e8, k = run ? 1.4 : P.cr ? .35 : .8; Snd.step(wood, k, wet > .2); if (isHost()) { noise(P.x, P.z, (run ? 24 : P.cr ? 2.2 : 8.5) * (wet > .2 ? 1.8 : 1) * (wood ? 1.35 : 1), P.zone); if (run || wet > .2) P.heat += .02; } }
  if (P.l) { P.bat -= dt / 280; if (P.bat <= 0) { P.bat = 0; P.l = 0; showMsg('Your flashlight died.', '', 3); } }
  $('stam').style.opacity = P.stam < .99 ? 1 : 0; $('stam').firstChild.style.width = P.stam * 100 + '%';
}
// interaction targets built per frame
function targets() {
  const L = [];
  for (const it of ITEMS) if (!it.taken) L.push({x: it.x, y: it.y + .1, z: it.z, r: 2.2, label: ({battery: 'Pick up batteries', flare: 'Pick up the flare', note: 'Read the note'})[it.kind], go: () => it.kind === 'note' ? openNote(it.text) : act({a: 'pick', i: it.i})});
  const mine = carrierOf(P.id);
  for (const c of CANS) if (!c.used && !c.carrier && mine < 0) L.push({x: c.x, y: c.y + .2, z: c.z, r: 2.3, label: 'Pick up the fuel can', go: () => act({a: 'can', i: c.i})});
  for (let i = 0; i < BEA.length; i++) { const b = BEA[i]; if (!b.lit) L.push({x: b.x, y: b.y + 1, z: b.z, r: 3.4, hold: mine >= 0 ? 'b' + i : '', label: mine >= 0 ? 'Hold E to pour the fuel and light it' : 'Signal beacon. Needs a can of fuel.'}); }
  for (const p of PL.values()) if (p !== P && p.down && !p.dead && p.ready) L.push({x: p.x, y: p.y + .3, z: p.z, r: 2.4, hold: 'r' + p.id, label: `Hold E to pick up ${p.name}`});
  for (const it of INTER) if (!it.on || it.on()) L.push({x: it.x, y: it.y, z: it.z, r: it.r, label: it.label(), hide: it.h});
  if (G.ph === 2 && G.heliDown) L.push({x: HELI.x, y: gH(HELI.x, HELI.z) + 1.2, z: HELI.z, r: 9, label: 'Get aboard the helicopter', go: () => act({a: 'board'})});
  return L;
}
function stepInteract(dt) {
  const pr = $('prompt'); P.h = '';
  if (TEST && G.forceH) { P.h = G.forceH; return; }
  if (!alivePlay() || P.down) { pr.style.opacity = 0; ePress = false; return; }
  const ey = P.y + P.eye; cam.getWorldDirection(_fw); let best = null, bs = 1e9;
  for (const it of targets()) {
    if (P.hd >= 0) { if (it.hide && it.hide.i === P.hd) { best = it; break; } continue; }
    const dx = it.x - P.x, dy = it.y - ey, dz = it.z - P.z, d = Math.hypot(dx, dy, dz); if (d > it.r) continue;
    const dot = (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d, lim = d < 1.2 ? .4 : it.r > 5 ? .5 : .84; if (dot < lim) continue;
    if (!losClear(P.x, P.z, it.x - dx / d * .3, it.z - dz / d * .3)) continue;
    const sc = (1 - dot) * 4 + d * .15; if (sc < bs) { bs = sc; best = it; }
  }
  if (!best) { pr.style.opacity = 0; ePress = false; return; }
  $('pTxt').innerHTML = `<kbd>E</kbd>${best.label}`; pr.style.opacity = 1;
  const hp = best.hold ? (G.holdP[best.hold] || 0) : 0; $('pBar').style.display = best.hold ? 'block' : 'none'; $('pBar').firstChild.style.width = hp * 100 + '%';
  if (best.hold && eDown) { P.h = best.hold; if (best.hold[0] === 'b' && Math.random() < dt * 3) Snd.pour(); }
  else if (ePress) { if (best.hide) toggleHide(best.hide); else if (best.go) best.go(); }
  ePress = false;
}
function toggleHide(h) {
  if (P.hd >= 0) { P.hd = -1; P.x = h.ex; P.z = h.ez; P.l = P.lightWas && P.bat > 0 ? 1 : 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); Snd.creak(); if (isHost()) noise(P.x, P.z, 5, h.b); }
  else { P.hd = h.i; P.lightWas = P.l; P.l = 0; P.yaw = h.yaw; P.pitch = 0; P.cr = 0; $('slats').classList.remove('hidden'); $('breath').classList.remove('hidden'); Snd.creak(); if (isHost()) { if (M.state === 'chase' && M.tgt === P.id && G.t - M.seenAt < 1.2) M.sawHide = h.i; else noise(P.x, P.z, 4, h.b); } }
}
function openNote(t) { G.noteOpen = true; $('noteT').textContent = t; $('note').classList.remove('hidden'); }
function closeNote() { G.noteOpen = false; $('note').classList.add('hidden'); }
function myPose() { return {t: 'pose', x: +P.x.toFixed(2), z: +P.z.toFixed(2), y: +P.y.toFixed(2), yw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.cr ? 1 : 0, l: P.l ? 1 : 0, rn: P.run, h: P.h, hd: P.hd, hb: P.hb}; }

// ---------------- input
addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!G.on) return; K[e.code] = true;
  if (G.noteOpen) { if (e.code === 'KeyE' || e.code === 'Escape') closeNote(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyE') { eDown = true; ePress = true; }
  if (!alivePlay()) return;
  if (e.code === 'KeyF' && P.hd < 0 && P.bat > 0) { P.l = P.l ? 0 : 1; Snd.click(); }
  if (e.code === 'KeyC' && !P.down) P.cr = P.cr ? 0 : 1;
  if (e.code === 'KeyG') throwFlare();
  if (e.code === 'KeyX' && carrierOf(P.id) >= 0) act({a: 'drop'});
  if (e.code === 'KeyQ' && !P.down && (G.whT || 0) <= 0) { G.whT = 3; act({a: 'wh'}); }
  if (e.code === 'Tab') { G.map = true; $('map').classList.remove('hidden'); drawMap(); }
});
addEventListener('keyup', e => { K[e.code] = false; if (e.code === 'KeyE') eDown = false; if (e.code === 'Tab') { G.map = false; $('map').classList.add('hidden'); } });
addEventListener('mousemove', e => {
  if (!G.on || G.paused || document.pointerLockElement !== canvas) return;
  const s = .0022 * SET.sens; P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.45, 1.45);
  if (P.hd >= 0) { const h = HIDES[P.hd], d = angD(h.yaw, P.yaw); P.yaw = h.yaw + clamp(d, -.7, .7); P.pitch = clamp(P.pitch, -.5, .4); }
});
canvas.addEventListener('mousedown', e => { if (!G.on) return; if (document.pointerLockElement !== canvas) { lockMouse(); return; } if (G.noteOpen) { closeNote(); return; } if (e.button === 2) mouseR = true; if (e.button === 0 && !alivePlay()) G.spec++; });
addEventListener('mouseup', e => { if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && G.on && !TEST) pause(true); });
addEventListener('blur', () => { for (const k in K) K[k] = false; eDown = false; mouseR = false; });
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function pause(p) { G.paused = p; $('pause').classList.toggle('hidden', !p); $('pauseN').textContent = Net.role === 'solo' ? 'The valley waits for you.' : 'Online games keep running.'; if (Net.role === 'solo' && A.ctx) p ? A.ctx.suspend() : A.ctx.resume(); if (!p) lockMouse(); }

// ---------------- render helpers
const _fw = new THREE.Vector3(), swayV = new THREE.Vector3();
const VM = new THREE.Group(); cam.add(VM);
(function viewModel() {
  const m = new THREE.MeshStandardMaterial({color: 0x1d1f22, roughness: .4, metalness: .7});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.022, .02, .2, 12), m); body.rotation.x = PI / 2; VM.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.034, .024, .05, 14), m); head.rotation.x = PI / 2; head.position.z = -.12; VM.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.03, 14), new THREE.MeshBasicMaterial({color: 0xfff2d8})); lens.position.z = -.146; VM.add(lens); VM.userData.lens = lens;
  const glove = new THREE.MeshStandardMaterial({color: 0x2c241c, roughness: .9});
  const fist = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), glove); fist.scale.set(1, .85, 1.5); fist.position.set(0, -.012, .02); VM.add(fist);
  VM.userData.arm = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, .4, 10), new THREE.MeshStandardMaterial({color: 0x30363c, roughness: .95})); VM.userData.arm.rotation.x = PI / 2 - .25; VM.userData.arm.position.set(.03, -.06, .22); VM.add(VM.userData.arm);
  VM.scale.setScalar(.8); VM.traverse(o => { if (o.isMesh) o.castShadow = false; });
})();
const VMC = mkCanMesh(); VMC.position.set(-.3, -.32, -.5); VMC.rotation.set(.2, .5, 0); cam.add(VMC); VMC.traverse(o => { if (o.isMesh) o.castShadow = false; });
function specTarget() { const L = [...PL.values()].filter(p => p !== P && p.ready && !p.dead && !p.esc); return L.length ? L[G.spec % L.length] : null; }
function updateCamera(dt) {
  let ex, ey, ez, yaw, pitch, own = alivePlay();
  if (own) { ex = P.x; ey = P.y + P.eye; ez = P.z; yaw = P.yaw; pitch = P.pitch; }
  else { const s = specTarget(); if (s) { ex = s.rx; ey = s.ry + (s.down ? .5 : 1.6); ez = s.rz; yaw = s.ryaw; pitch = s.rpitch; } else { ex = HELI.x; ey = gH(HELI.x, HELI.z) + 8; ez = HELI.z + 14; yaw = 0; pitch = -.3; } }
  const sp = own ? Math.hypot(P.vx, P.vz) : 0, bobA = own && P.hd < 0 ? clamp(sp / 6, 0, 1) * .05 : 0, shake = own && P.fear > .5 ? (P.fear - .5) * .006 : 0;
  cam.position.set(ex, ey + Math.sin((P.bob || 0) * 2) * bobA * .6, ez);
  cam.rotation.set(pitch + Math.sin(G.t * 31) * shake, yaw + Math.sin(P.bob || 0) * bobA * .05, own && P.down ? .35 : Math.sin(P.bob || 0) * bobA * .08, 'YXZ');
  cam.updateMatrixWorld();
  VM.visible = own && P.hd < 0 && !P.down; VMC.visible = own && P.hd < 0 && carrierOf(P.id) >= 0;
  VM.position.set(.22 + Math.sin(P.bob || 0) * bobA * .3, -.21 - Math.abs(Math.cos(P.bob || 0)) * bobA * .3, -.42);
  cam.getWorldDirection(_fw); swayV.lerp(_fw, Math.min(1, dt * 14));
  const on = own && P.l && P.hd < 0; let k = on ? .55 + .45 * Math.min(1, P.bat * 3) : 0;
  const nearM = Math.hypot(ex - M.x, ez - M.z);
  if (on && (P.bat < .15 || nearM < 13 || M.state === 'chase' && nearM < 22) && Math.random() < .25) k *= Math.random() < .5 ? .05 : .5;
  flash.intensity = 70 * k; VM.userData.lens.material.color.setScalar(on ? .4 + k : .05);
  _v.set(.2, -.19, -.62).applyQuaternion(cam.quaternion).add(cam.position); flash.position.copy(_v); flash.target.position.copy(_v).addScaledVector(swayV, 10);
  moon.position.set(ex + MOONDIR.x * 120, ey + MOONDIR.y * 120, ez + MOONDIR.z * 120); moon.target.position.set(ex, ey, ez);
  if (!G.shadowAt || Math.hypot(ex - G.shadowAt[0], ez - G.shadowAt[1]) > 6) { G.shadowAt = [ex, ez]; moon.shadow.needsUpdate = true; }
  scene.userData.sky.position.copy(cam.position); scene.userData.stars.position.copy(cam.position); scene.userData.moon.position.copy(cam.position).addScaledVector(MOONDIR, 540);
}
// fires (campfire + beacons): flame sprites and the 3 pooled lights
function buildFires() {
  for (const f of FIRES) {
    f.sp = []; for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.flame, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: f.bea == null})); s.visible = false; scene.add(s); f.sp.push(s); }
    f.glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff7a20, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: f.bea != null ? .35 : .5, fog: f.bea == null})); f.glow.scale.setScalar(f.s * (f.bea != null ? 9 : 6)); f.glow.position.set(f.x, f.y + f.s * .3, f.z); f.glow.visible = false; scene.add(f.glow);
  }
}
function stepFires(dt, ex, ez) {
  const t = performance.now() / 1000;
  for (const f of FIRES) { f.glow.visible = f.lit; f.sp.forEach((s, i) => { s.visible = f.lit; if (!f.lit) return; const ph = t * (5 + i) + i * 1.7; s.scale.set(f.s * (.7 + .2 * Math.sin(ph)), f.s * (1.5 + .4 * Math.sin(ph * 1.3)), 1); s.position.set(f.x + Math.sin(i * 2.1) * f.s * .2, f.y + f.s * .55, f.z + Math.cos(i * 2.1) * f.s * .2); }); }
  const lit = FIRES.filter(f => f.lit).sort((a, b) => Math.hypot(a.x - ex, a.z - ez) - Math.hypot(b.x - ex, b.z - ez));
  POOL.forEach((l, i) => { const f = lit[i]; if (!f) { l.intensity = 0; return; } l.position.set(f.x, f.y + f.s * .6, f.z); l.intensity = (f.bea != null ? 60 : 14) * (.8 + Math.random() * .3); l.distance = f.bea != null ? 45 : 18; });
  if (A.on && lit[0]) { setPan(A.fPan, lit[0].x, lit[0].y, lit[0].z); A.fire.g.gain.value = .12; }
}
function stepHeli(dt) {
  if (G.ph < 2) { if (G.heliM) G.heliM.visible = false; heliL.intensity = 0; if (A.on) A.rotor.g.gain.value = 0; return; }
  if (!G.heliM) G.heliM = buildHeli();
  if (!G.heli) G.heli = {y: 70};
  if (!isHost()) G.heli.y = mix(G.heli.y, G.heli.ty ?? G.heli.y, Math.min(1, dt * 5));
  const gy = gH(HELI.x, HELI.z), h = G.heliM; h.visible = true; h.position.set(HELI.x, gy + G.heli.y + .1, HELI.z - G.heli.y * .4); h.userData.rot.rotation.y += dt * 25; h.userData.tail.rotation.x += dt * 40;
  heliL.intensity = 400; heliL.position.set(h.position.x, h.position.y + .6, h.position.z - 2); heliL.target.position.set(HELI.x + Math.sin(G.t * .7) * 8, gy, HELI.z + Math.cos(G.t * .5) * 8);
  if (A.on) { setPan(A.hPan, h.position.x, h.position.y + 2, h.position.z); A.rotor.g.gain.value = .6; A.rotorLfoG.gain.value = .3; }
}
function buildHeli() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({color: 0xc8c0a8, roughness: .5, metalness: .3}), r = new THREE.MeshStandardMaterial({color: 0x9a2a1a, roughness: .5}), d = new THREE.MeshStandardMaterial({color: 0x101418, roughness: .2, metalness: .5});
  const add = (geo, mat, x, y, z, p = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  const body = add(new THREE.SphereGeometry(1.4, 16, 12), m, 0, 1.7, 0); body.scale.set(1, .9, 1.6);
  add(new THREE.SphereGeometry(1.1, 14, 10), d, 0, 1.9, -1.2).scale.set(.95, .7, .9);
  add(new THREE.CylinderGeometry(.18, .35, 6, 8), r, 0, 2, 4.4).rotation.x = PI / 2;
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(.1, .1, 4), m, s * 1.1, .1, 0);
  const rot = new THREE.Group(); rot.position.y = 3.1; g.add(rot); for (let i = 0; i < 4; i++) { const b = add(new THREE.BoxGeometry(.3, .04, 10), d, 0, 0, 0, rot); b.rotation.y = i * PI / 2; }
  const tail = new THREE.Group(); tail.position.set(.3, 2.3, 7.3); g.add(tail); for (let i = 0; i < 2; i++) { const b = add(new THREE.BoxGeometry(.04, 1.8, .2), d, 0, 0, 0, tail); b.rotation.x = i * PI / 2; }
  g.rotation.y = PI; g.userData = {rot, tail}; scene.add(g); return g;
}
function updateRemotes(dt) {
  let si = 0; const cp = cam.position;
  const L = [...PL.values()].filter(p => p !== P && p.ready);
  L.sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z));
  for (const p of PL.values()) {
    if (p === P) { p.rx = P.x; p.ry = P.y; p.rz = P.z; p.ryaw = P.yaw; p.rpitch = P.pitch; if (p.av) p.av.visible = false; if (p.tag) p.tag.style.display = 'none'; continue; }
    if (!p.ready) continue;
    const k = Math.min(1, dt * 12), ox = p.rx, oz = p.rz; p.rx = mix(p.rx, p.x, k); p.ry = mix(p.ry, p.y, k); p.rz = mix(p.rz, p.z, k); p.ryaw += angD(p.ryaw, p.yaw) * k; p.rpitch = mix(p.rpitch, p.pitch, k);
    p.rspd = mix(p.rspd, Math.hypot(p.rx - ox, p.rz - oz) / Math.max(dt, 1e-3), Math.min(1, dt * 6));
    animHiker(p, dt);
    // remote footsteps you can hear
    if ((p.stepD || 0) > (p.run ? 1 : .75)) { p.stepD = 0; const d = Math.hypot(p.x - cp.x, p.z - cp.z); if (d < 30 && !p.down) Snd.rStep(p.x, p.y, p.z, p.run ? 1.4 : p.cr ? .35 : .8, wading(p.x, p.z) > .2); }
    p.pingT = Math.max(0, (p.pingT || 0) - dt);
    // name tag
    const t = p.tag, d = Math.hypot(p.rx - cp.x, p.rz - cp.z); let show = !p.dead && !p.esc && (d < 30 || p.down || p.pingT > 0);
    if (show) { _v.set(p.rx, p.ry + (p.down ? .8 : 2.15), p.rz).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) show = false; }
    t.style.display = show ? 'block' : 'none';
    if (show) { t.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; t.className = 'tag' + (p.down ? ' down' : p.pingT > 0 ? ' ping' : ''); t.textContent = p.down ? `${p.name} DOWN ${Math.max(0, p.bleed | 0)}s · ${d | 0}m` : p.pingT > 0 ? `${p.name} · ${d | 0}m` : p.name; t.style.opacity = p.down || p.pingT > 0 ? 1 : clamp(1.4 - d / 30, .2, .9); }
  }
  // remote flashlights
  for (const p of L) { if (si >= RSPOT.length) break; if (!p.l || p.down || p.dead || p.esc || p.hd >= 0) continue; const l = RSPOT[si++], f = eyeDir({yaw: p.ryaw, pitch: p.rpitch}); l.position.set(p.rx + f[0] * .4, p.ry + 1.35, p.rz + f[2] * .4); l.target.position.set(l.position.x + f[0] * 10, l.position.y + f[1] * 10, l.position.z + f[2] * 10); l.intensity = 55; }
  for (; si < RSPOT.length; si++) RSPOT[si].intensity = 0;
  // cans and items
  for (const c of CANS) { c.mesh.visible = !c.used && !c.carrier; if (c.mesh.visible) c.mesh.position.set(c.x, c.y, c.z); }
  for (const it of ITEMS) it.mesh.visible = !it.taken;
}
// fear + audio mix
let heartT = 0;
function stepFear(dt) {
  const cp = cam.position, d = Math.hypot(cp.x - M.x, cp.z - M.z), me = alivePlay() ? P : null;
  const s = me ? pSeesMon(me) : 0;
  let f = clamp(1 - d / 30, 0, 1) * .6 + (M.state === 'chase' ? (M.tgt === myId() ? .5 : .25) : 0) + s * clamp(1 - d / 45, 0, 1) * .4;
  if (M.state === 'stalk') f = Math.max(f, s * .5);
  P.fear = mix(P.fear || 0, clamp(f, 0, 1), Math.min(1, dt * (f > (P.fear || 0) ? 3 : .6)));
  heartT -= dt; if (P.fear > .2 && heartT <= 0) { heartT = 60 / (60 + P.fear * 110); Snd.heart(P.fear); }
  $('fearV').style.opacity = clamp((P.fear - .25) * 1.2, 0, .9);
  $('downV').style.opacity = P.down ? .55 + .35 * (1 - P.bleed / D.bleed) : 0;
  if (A.on) {
    const c = A.ctx, t = c.currentTime, ch = M.state === 'chase';
    A.crick.gain.setTargetAtTime(d < 35 || G.ph ? 0 : .006, t, .8);
    A.drone.gain.setTargetAtTime(ch && d < 60 ? .05 : 0, t, ch ? .3 : 1.5); A.droneF.frequency.setTargetAtTime(ch ? 900 : 300, t, 1);
    A.mBreath.g.gain.setTargetAtTime(.25 * (ch ? 1.6 : 1) * (.5 + .5 * Math.sin(G.t * (ch ? 9 : 2.5))), t, .05);
    A.mGrowl.gain.setTargetAtTime(ch ? .5 : M.state === 'search' ? .25 : .08 * clamp(1 - d / 25, 0, 1), t, .2);
    A.mSaw.frequency.setTargetAtTime(ch ? 62 : 44, t, .3);
    setPan(A.mPan, M.x, M.y + 2, M.z);
    const L = c.listener; cam.getWorldDirection(_fw);
    if (L.positionX) { L.positionX.value = cp.x; L.positionY.value = cp.y; L.positionZ.value = cp.z; L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cp.x, cp.y, cp.z); L.setOrientation(_fw.x, _fw.y, _fw.z, 0, 1, 0); }
    A.wind.f.frequency.value = 340 + Math.sin(G.t * .21) * 120; A.wind.g.gain.value = (P.zone >= 0 || P.hd >= 0 ? .02 : .055) + Math.sin(G.t * .13) * .02;
    A.water.g.gain.value = .05 * clamp(1 - (riverQ(cp.x, cp.z).d - 3) / 25, 0, 1);
  }
}
function hud() {
  const b = $('bat'); for (let i = 0; i < 4; i++) b.children[i].className = P.bat > i * .25 + .02 ? '' : 'off'; b.classList.toggle('low', P.bat < .25);
  $('nFlare').textContent = P.flares; $('nCan').textContent = carrierOf(P.id) >= 0 ? 'CAN' : '-'; $('nBea').textContent = BEA.filter(q => q.lit).length + '/4';
  const ot = objText(); if (ot !== objLast) { objLast = ot; $('obj').innerHTML = '<small>Objective</small>' + ot; $('obj').style.opacity = 1; G.objT = 8; }
  if (G.objT > 0) { G.objT -= 1 / 30; if (G.objT <= 0 && G.ph === 0) $('obj').style.opacity = .4; }
  G.teamT = (G.teamT || 0) - 1; if ((PL.size > 1 || TEST) && G.teamT <= 0) G.teamT = 10, $('team').innerHTML = [...PL.values()].map(p => `<div class="${p.dead ? 'dead' : p.esc ? 'esc' : p.down ? 'down' : ''}">${p.name}${p.down ? ' · DOWN ' + Math.max(0, p.bleed | 0) + 's' : p.dead ? '' : p.esc ? ' · aboard' : ''}<i style="background:${hexS(CREW_COL[p.c % 6])}"></i></div>`).join('');
  const st = $('state');
  if (P.dead || P.esc) { const s = specTarget(); st.innerHTML = (P.dead ? 'You are dead' : 'You are aboard') + `<small>${s ? 'Watching ' + s.name + ' · click to switch' : ''}</small>`; }
  else if (P.down) st.innerHTML = `You are down<small>Bleeding out in ${Math.max(0, P.bleed | 0)} s. Crawl to your group or wait for a teammate.</small>`;
  else st.innerHTML = '';
}
let grainT = 0; const gctx = $('grain').getContext('2d'), gimg = gctx.createImageData(200, 120);
function grain() { const d = gimg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gctx.putImageData(gimg, 0, 0); $('grain').style.opacity = .06 + (P ? P.fear || 0 : 0) * .12; }
function drawMap() {
  const c = $('map'), g = c.getContext('2d'), W = c.width, S = W / 400, X = x => W / 2 + x * S, Z = z => W / 2 - z * S;
  g.fillStyle = '#c9bc9a'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(80,60,30,${Math.random() * .08})`; g.fillRect(Math.random() * W, Math.random() * W, 2, 2); }
  for (let j = 0; j < GN; j += 3) for (let i = 0; i < GN; i += 3) { const h = HG[j * GN + i]; if (h > 12) { g.fillStyle = `rgba(90,70,50,${Math.min(.35, (h - 12) / 60)})`; g.fillRect(X(-WS + i * GS) - 3, Z(-WS + j * GS) - 3, 6, 6); } }
  g.fillStyle = 'rgba(60,80,50,.3)'; for (const t of TREES) if ((t.x * 7 + t.z) % 3 < 1) { g.beginPath(); g.arc(X(t.x), Z(t.z), 2, 0, TAU); g.fill(); }
  g.strokeStyle = '#6a8696'; g.lineWidth = 6 * S; g.beginPath(); RIVER.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke();
  g.strokeStyle = '#6a4a2a'; g.lineWidth = 4; for (const b of BRIDGES) { g.beginPath(); g.moveTo(X(b.x - b.nx * 9), Z(b.z - b.nz * 9)); g.lineTo(X(b.x + b.nx * 9), Z(b.z + b.nz * 9)); g.stroke(); }
  g.fillStyle = '#3a2a1c'; g.font = '13px Georgia'; g.textAlign = 'center';
  for (const b of BLD) { g.save(); g.translate(X(b.x), Z(b.z)); g.rotate(-b.th); g.fillRect(-b.w / 2 * S, -b.d / 2 * S, b.w * S, b.d * S); g.restore(); g.fillText(b.name, X(b.x), Z(b.z) - 10); }
  const lab = (t, x, z) => g.fillText(t, X(x), Z(z));
  lab('Campsite', CAMP.x, CAMP.z - 8); lab('Landing clearing', HELI.x, HELI.z - 12); lab('Crashed plane', -112, 112); lab('Logging camp', 72, -66); lab('Cemetery', 96, 112); lab('Old mine', 152, -90);
  g.beginPath(); g.arc(X(HELI.x), Z(HELI.z), 9 * S, 0, TAU); g.stroke();
  for (const b of BEA) { g.fillStyle = b.lit ? '#d0601a' : '#3a2a1c'; g.beginPath(); g.moveTo(X(b.x), Z(b.z) - 9); g.lineTo(X(b.x) + 7, Z(b.z) + 6); g.lineTo(X(b.x) - 7, Z(b.z) + 6); g.fill(); g.fillStyle = '#3a2a1c'; g.fillText(b.name + (b.lit ? ' (burning)' : ''), X(b.x), Z(b.z) + 20); }
  g.font = 'italic 22px Georgia'; g.fillText('BLACK HOLLOW', W / 2, 30); g.font = '12px Georgia'; g.fillText('Tab: close', W / 2, W - 12);
  for (const p of PL.values()) { if (!p.ready || p.dead || p.esc) continue; const yaw = p === P ? P.yaw : p.ryaw; g.save(); g.translate(X(p.rx), Z(p.rz)); g.rotate(-yaw + PI); g.fillStyle = hexS(CREW_COL[p.c % 6]); if (p.down) { g.fillRect(-6, -2, 12, 4); g.fillRect(-2, -6, 4, 12); } else { g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill(); } g.restore(); g.fillStyle = '#2a1a10'; g.fillText(p.name, X(p.rx), Z(p.rz) + 18); }
}

// ---------------- game flow
let BUILT = false;
function buildWorld() {
  if (BUILT) return; BUILT = true;
  textures(); buildLayout(); materials(); buildGround(); buildSky(); buildTrees(); buildCreature(); buildFires();
  for (const k in BK) { const m = new THREE.Mesh(mergeGeos(BK[k]), MAT[k]); m.castShadow = k !== 'glass' && k !== 'pad' && k !== 'paint'; m.receiveShadow = true; scene.add(m); }
  $('load').classList.add('hidden');
}
function startGame(seed, crew) {
  buildWorld(); aInit(); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  D = DIFF[G.diff || SET.diff] || DIFF.normal;
  RND.shadowMap.enabled = SET.gfx === 'high'; flash.castShadow = moon.castShadow = SET.gfx === 'high';
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  canvas.style.filter = SET.bright !== 1 ? `brightness(${SET.bright})` : '';
  G.seed = seed; WR = mulberry(seed); CR = mulberry(seed ^ 0x5bd1e995);
  Object.assign(G, {on: true, over: false, t: 0, ph: 0, timer: 0, heli: null, heliDown: false, evq: [], holdP: {}, overSent: false, allDownT: 0, noteOpen: false, paused: false, spec: 0, whT: 0, poseT: 0, sendT: 0});
  for (const f of G.flares) scene.remove(f.m); G.flares = [];
  for (const b of BEA) { b.lit = false; b.p = 0; } for (const f of FIRES) f.lit = f.bea == null;
  for (const p of PL.values()) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); } PL.clear();
  syncCrew(crew);
  // spread round the campfire
  [...PL.values()].forEach((p, i) => { const a = i / Math.max(1, PL.size) * TAU + .3; p.x = CAMP.x + Math.cos(a) * 3.2; p.z = CAMP.z + Math.sin(a) * 3.2; p.y = gH(p.x, p.z); p.rx = p.x; p.ry = p.y; p.rz = p.z; p.lx = p.x; p.lz = p.z; p.yaw = Math.atan2(p.x - CAMP.x, p.z - CAMP.z); });
  Object.assign(P, {ready: true, vx: 0, vz: 0, stam: 1, bat: 1, flares: 1, breath: 1, gasp: 0, bob: 0, stepD: 0, fear: 0, eye: 1.62, l: 1, cr: 0, hd: -1});
  placeItems();
  Object.assign(M, {x: 20, z: 150, state: 'roam', path: [], idle: 2, aware: 0, lostT: 0, flee: 0, sawHide: -1, far: 0, stalkT: 45 + CR() * 30, stuck: 0, screamT: 0, hintT: 20, spd: 0, look: 0, tgt: null, preyT: 0, avoidT: 0});
  M.y = gH(M.x, M.z); M.tx = M.x; M.ty = M.y; M.tz = M.z; M.tyaw = 0;
  if (G.heliM) G.heliM.visible = false;
  ['slats', 'breath', 'map', 'note', 'end', 'pause', 'menu', 'lobby'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); objLast = ''; moon.shadow.needsUpdate = true; G.shadowAt = null;
  lockMouse();
  const it = $('intro'); it.innerHTML = PL.size > 1 ? 'The trail markers stopped making sense an hour ago.<br>The fire is all you have.<br><br>Light the beacons. Stay together.' : 'The trail markers stopped making sense an hour ago.<br>Your group scattered when the screaming started.<br><br>Light the beacons. Get out.';
  it.classList.remove('hidden'); it.style.opacity = 1; setTimeout(() => it.style.opacity = 0, TEST ? 0 : 4000); setTimeout(() => it.classList.add('hidden'), TEST ? 0 : 6000);
}
function gameOver(e) {
  G.over = true; setTimeout(() => {
    try { document.exitPointerLock(); } catch (x) {}
    const iWon = P.esc;
    $('end').className = 'scr' + (iWon ? '' : ' dead'); $('endT').textContent = iWon ? 'Rescued' : e.win ? 'Left behind' : 'Nobody made it';
    $('endS').textContent = `${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, '0')} in the valley · ${BEA.filter(b => b.lit).length}/4 beacons lit · ${G.diff || SET.diff}`;
    $('endL').innerHTML = e.res.map(r => `<div><span style="color:${hexS(CREW_COL[r[2] % 6])}">■</span> ${r[0]} — ${r[1] === 'esc' ? 'rescued' : r[1] === 'dead' ? 'bled out' : 'left behind'}</div>`).join('');
    $('again').classList.toggle('hidden', Net.role === 'guest');
    $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); G.on = false;
    if (iWon) { const k = 'bh-best-' + (G.diff || SET.diff), b = +localStorage.getItem(k) || 0; if (!b || e.t < b) try { localStorage.setItem(k, e.t); } catch (x) {} }
  }, 2500);
}

function step(dt) {
  if (isHost()) { if (P && alivePlay()) {} hostStep(dt); }
  else { // guests smooth the creature toward the host's numbers
    const k = Math.min(1, dt * 10); if (M.tx != null) { M.x = mix(M.x, M.tx, k); M.y = mix(M.y, M.ty, k); M.z = mix(M.z, M.tz, k); M.yaw += angD(M.yaw, M.tyaw) * k; }
    if (P.gaspN) { P.gaspN = false; Net.send({t: 'act', a: 'gasp'}); }
    G.t += dt;
  }
  stepPlayer(dt); stepInteract(dt); stepFlares(dt);
  if (isHost() && P.ready) { P.zone = zoneOf(P.x, P.z, -.05); }
  G.whT -= dt;
  // net
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
  updateRemotes(dt); animCreature(dt, M.state, M.spd); stepHeli(dt); updateCamera(dt); stepFires(dt, cam.position.x, cam.position.z); stepFear(dt); hud();
  if (G.map) drawMap();
  if ((grainT += dt) > .05) { grainT = 0; grain(); }
  RND.render(scene, cam);
}

// ---------------- menu, lobby
const myName = () => (SET.name || 'Hiker').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Hiker';
function crewList() { return [{id: 'H', name: myName(), c: 0}, ...[...Net.peers.values()].map(p => ({id: p.id, name: p.name, c: p.c}))]; }
function show(id) { ['menu', 'lobby', 'end', 'pause'].forEach(k => $(k).classList.toggle('hidden', k !== id)); }
function lobby() { const L = crewList(); $('crew').innerHTML = L.map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === 'H' ? ' <small style="color:var(--dim)">host</small>' : ''}</div>`).join(''); if (Net.role === 'host') Net.send({t: 'lobby', crew: L}); }
function hostStart() { G.diff = SET.diff; const seed = (Math.random() * 1e9) | 0, crew = crewList(); Net.started = true; Net.meta(false); Net.send({t: 'start', seed, crew, diff: G.diff}); startGame(seed, crew); }
Net.on('_lobby', () => { if (!G.on) lobby(); });
Net.on('_join', m => { if (G.on && Net.role === 'host') { const crew = crewList(); G.crew = crew; syncCrew(crew); const np = PL.get(m.id); if (np) { np.x = CAMP.x + 2; np.z = CAMP.z + 2; } Net.send1(m.id, {t: 'start', seed: G.seed, crew, diff: G.diff, late: 1}); Net.send({t: 'crew', crew}); showMsg(`${PL.get(m.id).name} joined the group.`); } });
Net.on('_left', m => { if (!G.on) { lobby(); return; } const crew = crewList(); syncCrew(crew); Net.send({t: 'crew', crew}); showMsg(`${m.name || 'Someone'} left.`); });
Net.on('_hostgone', () => toMenu('The host left.'));
Net.on('lobby', m => { $('crew').innerHTML = (m.crew || []).map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${String(p.name).replace(/[<>&]/g, '')}</div>`).join(''); $('lmsg').textContent = 'Waiting for the host to start…'; });
Net.on('start', m => { G.diff = m.diff; startGame(m.seed, m.crew); if (m.late) showMsg('You caught up with the group.'); });
Net.on('crew', m => { if (G.on) syncCrew(m.crew); });
Net.on('restart', m => { G.diff = m.diff; startGame(m.seed, m.crew); });
function toMenu(why) {
  Net.close(); G.on = false; G.over = false; show('menu'); $('hud').classList.add('hidden'); $('fearV').style.opacity = 0; $('downV').style.opacity = 0; $('slats').classList.add('hidden');
  if (A.ctx) { A.ctx.resume(); for (const g of [A.drone, A.mGrowl, A.mBreath.g, A.fire.g, A.rotor.g]) g.gain.value = 0; }
  try { document.exitPointerLock(); } catch (e) {} $('err').textContent = why || ''; refreshRooms();
}
async function refreshRooms() {
  const L = await Net.rooms(); const el = $('rooms');
  el.innerHTML = L.length ? '' : '<small style="color:var(--dim)">No open groups right now. Host one and share the code.</small>';
  for (const r of L) { const d = document.createElement('div'); d.textContent = r.name.replace(Net.tag + ' ', '').replace(new RegExp('^' + Net.tag.replace(/[\[\]]/g, '') + ' '), '') + (r.n ? ` · ${r.n}/6` : ''); d.onclick = () => joinRoom(r.code); el.appendChild(d); }
}
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
  $('bHost').onclick = () => { aInit(); buildWorld(); const code = Net.host(myName(), s => { $('lmsg').textContent = s === 'open' ? 'Share the code. Up to 6 hikers.' : 'Connection lost, retrying…'; }); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('lmsg').textContent = 'Connecting…'; lobby(); };
  $('bJoin').onclick = () => joinRoom($('joinC').value);
  $('joinC').onkeydown = e => { if (e.key === 'Enter') joinRoom($('joinC').value); };
  $('bGo').onclick = hostStart;
  $('bLeave').onclick = () => toMenu();
  $('resume').onclick = () => pause(false);
  $('quit').onclick = () => toMenu(); $('endMenu').onclick = () => toMenu();
  $('again').onclick = () => { if (Net.role === 'guest') return; const seed = (Math.random() * 1e9) | 0, crew = Net.role === 'host' ? crewList() : [{id: 'H', name: myName(), c: 0}]; if (Net.role === 'host') Net.send({t: 'restart', seed, crew, diff: G.diff}); startGame(seed, crew); };
  $('note').onclick = closeNote;
  refreshRooms(); setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshRooms(); }, 8000);
}
menuInit();
setTimeout(() => { buildWorld(); requestAnimationFrame(frame); }, 30);
if (TEST) window.__H = {G, PL, M, K, SET, BEA, FIRES, applyEv, CANS, ITEMS, HIDES, BLD, SPOTS, Net, get P() { return P; }, startGame, step, hostStep, hostAct, act, targets, toggleHide, cam, scene, RND, noise, downPlayer, set eDown(v) { eDown = v; }, set mouseR(v) { mouseR = v; }, crewList, hostStart, joinRoom};
