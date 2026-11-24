// Whisperpine: first-person survival horror. World, creature AI, audio and UI.
'use strict';
const $ = id => document.getElementById(id);
const TEST = /[?&]test/.test(location.search);
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let R = mulberry(7311);          // world layout (fixed)
let WR = mulberry(Date.now());   // per run (items, creature)
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }

// ---------------- settings
const SET = Object.assign({diff: 'normal', sens: 1, bright: 1, gfx: 'high', voice: '1'}, (() => { try { return JSON.parse(localStorage.getItem('wp-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('wp-set', JSON.stringify(SET)); } catch (e) {} };
const DIFF = {
  easy:      {chase: 4.5, sight: 22, hear: .7,  checkP: .3,  breathHear: .1, lost: 2.5, escape: 120, roam: 70, hint: 0,  react: .7},
  normal:    {chase: 5.2, sight: 30, hear: 1,   checkP: .55, breathHear: .3, lost: 4,   escape: 150, roam: 55, hint: 16, react: .45},
  nightmare: {chase: 5.8, sight: 38, hear: 1.35, checkP: .8, breathHear: .6, lost: 6,   escape: 180, roam: 40, hint: 9,  react: .28},
};
let D = DIFF.normal;

// ---------------- world layout
const WS = 170, GS = 2, GN = WS * 2 / GS + 1;
const LAKE = {x: 96, z: 20, r: 26, y: -1.1};
const ROAD = [[2, -172], [2, -150], [1, -136], [-4, -112], [5, -88], [-2, -60], [1, -36], [0, -14]];
const GATE = {x: 1, z: -136};
const PADS = [];
const padC = (x, z, r, f, h) => PADS.push({c: 1, x, z, r, f, h});
const padR = (x0, x1, z0, z1, f, h) => PADS.push({c: 0, x0, x1, z0, z1, f, h});
function padW(p, x, z) {
  let d; if (p.c) d = Math.hypot(x - p.x, z - p.z) - p.r;
  else { const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1); d = Math.hypot(dx, dz); }
  return d <= 0 ? 1 : d >= p.f ? 0 : smooth(1 - d / p.f);
}
function rawH(x, z) { return (fbm(x * .011 + 3, z * .011 - 7) - .5) * 14 + (fbm(x * .045, z * .045) - .5) * 2.2; }
function segD(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, l = vx * vx + vz * vz; const t = l ? clamp(((px - ax) * vx + (pz - az) * vz) / l, 0, 1) : 0; return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
function roadD(x, z) { let d = 1e9; for (let i = 0; i < ROAD.length - 1; i++) d = Math.min(d, segD(x, z, ROAD[i][0], ROAD[i][1], ROAD[i + 1][0], ROAD[i + 1][1])); return d; }
function baseH(x, z) {
  let h = rawH(x, z);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 14) {
    const tgt = dl < LAKE.r ? LAKE.y - .3 - 2.4 * Math.sqrt(1 - dl / LAKE.r) : LAKE.y + .35 + (dl - LAKE.r) * .12;
    h = mix(h, tgt, smooth((LAKE.r + 14 - dl) / 14));
  }
  const rd = roadD(x, z); if (rd < 9) h = mix(h, rawH(x, z) * .6, smooth((9 - rd) / 9) * .7);
  for (const p of PADS) { const w = padW(p, x, z); if (w > 0) h += (p.h - h) * w; }
  return h;
}
let HG = null;
function gH(x, z) {
  const fx = clamp((x + WS) / GS, 0, GN - 1.001), fz = clamp((z + WS) / GS, 0, GN - 1.001), i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const a = HG[j * GN + i], b = HG[j * GN + i + 1], c = HG[(j + 1) * GN + i], d = HG[(j + 1) * GN + i + 1];
  // match the mesh triangulation (PlaneGeometry splits a-c-b / c-d-b)
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

// solids: WALLS block bodies, sight and the creature; SOL block the player only; OBST = rects the creature routes round
const WALLS = [], SOL = [], OBST = [], BLD = [], TREES = [], HIDES = [], SPOTS = {}, INTER = [];
const ROT = {s: 0, w: PI / 2, n: PI, e: -PI / 2};
const L2W = (b, lx, lz) => { const c = Math.cos(b.th), s = Math.sin(b.th); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };
const W2L = (b, x, z) => { const c = Math.cos(b.th), s = Math.sin(b.th), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
function rectW(b, x0, x1, z0, z1) { const p = [L2W(b, x0, z0), L2W(b, x1, z1)]; return {x0: Math.min(p[0][0], p[1][0]), x1: Math.max(p[0][0], p[1][0]), z0: Math.min(p[0][1], p[1][1]), z1: Math.max(p[0][1], p[1][1])}; }
function zoneOf(x, z, m = 0) { for (let i = 0; i < BLD.length; i++) { const b = BLD[i], l = W2L(b, x, z); if (Math.abs(l[0]) < b.w / 2 - m && Math.abs(l[1]) < b.d / 2 - m) return i; } return -1; }
function floorY(x, z, zone) { return zone >= 0 ? BLD[zone].fy + .1 : gH(x, z); }

// geometry buckets, merged per material at the end
const BK = {};
const bucket = k => BK[k] || (BK[k] = []);
function boxUV(g, sx, sy, sz, t) {
  const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); }
  return g;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function put(k, g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g; }
// local box in a building frame
function lbox(b, k, lx, ly, lz, sx, sy, sz, ry = 0, tile = 1.2) {
  const g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile);
  _e.set(0, ry, 0); g.applyMatrix4(_m4.compose(_v.set(lx, ly, lz), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  bucket(k).push(g); return g;
}
function wbox(k, x, y, z, sx, sy, sz, ry = 0, tile = 1.2) { return put(k, boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile), x, y, z, ry); }
function lsolid(b, lx, lz, sx, sz, list = SOL) { const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); list.push(r); return r; }
function spot(name, x, y, z) { (SPOTS[name] = SPOTS[name] || []).push({x, y, z}); }
function lspot(b, name, lx, ly, lz) { const [x, z] = L2W(b, lx, lz); spot(name, x, b.fy + ly, z); }

const BTYPES = {
  cabin: {w: 6, d: 7, dx: 1.6, dw: 1.3, wh: 2.6},
  mess:  {w: 14, d: 9, dx: 0, dw: 1.7, wh: 3},
  shed:  {w: 4.2, d: 4.2, dx: 0, dw: 1.3, wh: 2.5},
  ranger:{w: 6.5, d: 6, dx: -1.6, dw: 1.3, wh: 2.7},
  boat:  {w: 6, d: 8, dx: 0, dw: 1.6, wh: 3},
  out:   {w: 1.7, d: 1.7, dx: 0, dw: .9, wh: 2.3},
};
function building(kind, name, x, z, door, extra = {}) {
  const T = BTYPES[kind], b = Object.assign({kind, name, x, z, th: ROT[door], w: T.w, d: T.d, wh: T.wh, door}, extra);
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
  // open door leaf swung inward against the wall
  lbox(b, 'door', dr + .02, 1.02, -hd + T.dw / 2 + .1, .05, 2.02, T.dw - .04);
  // floor, step, ceiling beams
  lbox(b, 'floor', 0, .05, 0, b.w, .1, b.d, 0, 1.6);
  lbox(b, 'trim', T.dx, .04, -hd - .45, T.dw + .4, .08, .6);
  for (let z0 = -hd + 1.2; z0 < hd; z0 += 1.6) lbox(b, 'trim', 0, wh - .08, z0, b.w, .12, .12);
  // windows (glass pokes out both faces)
  const win = (lx, lz, alongX) => { lbox(b, 'glass', lx, 1.45, lz, alongX ? .8 : t + .05, .62, alongX ? t + .05 : .8); lbox(b, 'trim', lx, 1.1, lz, alongX ? 1 : t + .12, .07, alongX ? t + .12 : 1); lbox(b, 'trim', lx, 1.8, lz, alongX ? 1 : t + .12, .07, alongX ? t + .12 : 1); };
  if (kind !== 'out') {
    for (let s = -hd + 1.6; s < hd - 1; s += 2.8) { win(-hw, s, false); win(hw, s, false); }
    if (b.w > 5) for (let s = -hw + 1.8; s < hw - 1.2; s += 3.2) win(s, hd, true);
    b.lights = [L2W(b, 0, 0)];
  } else lbox(b, 'glass', 0, 2.0, -hd, .3, .12, t + .05);
  // gable roof along local z
  const rise = kind === 'out' ? .45 : Math.min(1.6, b.w * .25), oh = .45, span = hw + oh, len = Math.hypot(span, rise) + .05;
  const ang = Math.atan2(rise, span);
  for (const sgn of [-1, 1]) {
    const g = boxUV(new THREE.BoxGeometry(len, .12, b.d + oh * 2), len, .12, b.d + oh * 2, 1.5);
    _e.set(0, 0, sgn * -ang); g.applyMatrix4(_m4.compose(_v.set(sgn * span / 2, wh + rise / 2 + .05, 0), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    bucket('roof').push(g);
  }
  for (const sz of [-hd, hd]) { // gable ends
    const g = new THREE.BufferGeometry(), y0 = wh;
    const p = [-hw - .09, y0, sz, hw + .09, y0, sz, 0, y0 + rise, sz];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.concat([p[3], p[4], p[5], p[0], p[1], p[2], p[6], p[7], p[8]]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, b.w / 1.2, 0, b.w / 2.4, rise / 1.2, b.w / 1.2, 0, 0, 0, b.w / 2.4, rise / 1.2], 2));
    g.computeVertexNormals();
    _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    bucket('wall').push(g);
  }
  // door path points for the creature (inside / outside)
  b.din = L2W(b, T.dx, -hd + 1.0); b.dout = L2W(b, T.dx, -hd - 1.4); b.dfront = L2W(b, T.dx, -hd - 3.2);
  const pad = .9; OBST.push({x0: Math.min(...[L2W(b, -hw, -hd)[0], L2W(b, hw, hd)[0]]) - pad, x1: Math.max(L2W(b, -hw, -hd)[0], L2W(b, hw, hd)[0]) + pad,
    z0: Math.min(L2W(b, -hw, -hd)[1], L2W(b, hw, hd)[1]) - pad, z1: Math.max(L2W(b, -hw, -hd)[1], L2W(b, hw, hd)[1]) + pad, b: b.i});
  b.hides = [];
  furnish(b);
  return b;
}
function hide(b, lx, lz, face, kind) { // face = local yaw the hider looks
  const [x, z] = L2W(b, lx, lz), th = face + b.th, fx = -Math.sin(th), fz = -Math.cos(th);
  const h = {x, z, y: b.fy + .1, yaw: th, b: b.i, ex: x + fx * .9, ez: z + fz * .9, kind, i: HIDES.length};
  HIDES.push(h); b.hides.push(h);
  INTER.push({kind: 'hide', h, x: x + fx * .35, y: b.fy + 1.2, z: z + fz * .35, r: 2, label: () => P.hidden === h ? 'Get out' : 'Hide in the ' + kind});
}
function wardrobe(b, lx, lz, face, kind = 'wardrobe') {
  // face: local yaw it opens toward (0 = local -z)
  const w = kind === 'locker' ? .6 : 1.05, dp = .6, hgt = kind === 'locker' ? 1.95 : 2.0;
  lbox(b, kind === 'locker' ? 'metal' : 'wood', lx, hgt / 2, lz, w, hgt, dp, face);
  const fx = -Math.sin(face), fz = -Math.cos(face);
  // slatted doors on the front face
  for (let y = .3; y < hgt - .2; y += .16) lbox(b, 'dark', lx + fx * (dp / 2 + .005), y, lz + fz * (dp / 2 + .005), w - .1, .04, .02, face);
  const sx = Math.abs(fx) > .5 ? dp : w, sz = Math.abs(fx) > .5 ? w : dp;
  lsolid(b, lx, lz, sx, sz);
  hide(b, lx, lz, face, kind);
}
function bunk(b, lx, lz) {
  lbox(b, 'wood', lx, .35, lz, 1, .14, 2);
  lbox(b, 'fabric', lx, .47, lz, .9, .12, 1.9);
  lbox(b, 'wood', lx, 1.35, lz, 1, .14, 2);
  lbox(b, 'fabric', lx, 1.47, lz, .9, .12, 1.9);
  for (const sx of [-.45, .45]) for (const sz of [-.95, .95]) lbox(b, 'wood', lx + sx, .9, lz + sz, .08, 1.8, .08);
  lsolid(b, lx, lz, 1, 2);
}
function table(b, lx, lz, sx, sz, h = .76) {
  lbox(b, 'wood', lx, h, lz, sx, .06, sz);
  for (const ax of [-1, 1]) for (const az of [-1, 1]) lbox(b, 'wood', lx + ax * (sx / 2 - .08), h / 2, lz + az * (sz / 2 - .08), .07, h, .07);
  lsolid(b, lx, lz, sx, sz);
}
function furnish(b) {
  const hw = b.w / 2, hd = b.d / 2;
  if (b.kind === 'cabin') {
    bunk(b, -hw + .65, 1.6); bunk(b, hw - .65, 2.2);
    table(b, -1.5, -1.6, 1.1, .8); lspot(b, 'table', -1.5, .82, -1.6);
    lbox(b, 'wood', -1.5, .45, -.95, .45, .05, .45); // stool
    wardrobe(b, hw - .4, -.6, PI / 2);
    lbox(b, 'fabric', -hw + .9, .02, -1.5, 1.4, .02, 1, .3); // rug
    lspot(b, 'floor', -hw + .65, .2, 2.8);
  } else if (b.kind === 'mess') {
    for (const tx of [-4, 0, 4]) { table(b, tx, .2, 1.1, 5); lbox(b, 'wood', tx - .8, .45, .2, .35, .06, 4.6); lbox(b, 'wood', tx + .8, .45, .2, .35, .06, 4.6); }
    lsolid(b, 4.8, 3.95, 4.4, .7); lbox(b, 'metal', 4.8, .47, 3.95, 4.4, .94, .7); lspot(b, 'counter', 4, 1, 3.95);
    lbox(b, 'metal', 6.4, .9, 1.2, .8, 1.8, .7); lsolid(b, 6.4, 1.2, .8, .7); // fridge
    wardrobe(b, -hw + .35, 2.6, -PI / 2, 'locker'); wardrobe(b, -hw + .35, 1.6, -PI / 2, 'locker');
    lspot(b, 'table', 0, .82, 2.2); lspot(b, 'table', -4, .82, -1.6);
  } else if (b.kind === 'shed') {
    lbox(b, 'metal', 0, .5, 1.2, 1.4, 1, .8); lsolid(b, 0, 1.2, 1.4, .8);
    lbox(b, 'dark', 0, 1.02, 1.2, 1.2, .04, .6); lbox(b, 'metal', .55, 1.15, 1.0, .12, .25, .12);
    lbox(b, 'metal', -1.2, 1.45, hd - .12, .7, .5, .12); // fuse panel
    lbox(b, 'wood', -1.4, .4, -1.2, .9, .8, .6); lsolid(b, -1.4, -1.2, .9, .6);
    b.gen = L2W(b, 0, .6); b.panel = L2W(b, -1.2, hd - .3);
  } else if (b.kind === 'ranger') {
    table(b, 1.4, hd - .55, 2.2, .8); lbox(b, 'metal', 1.6, 1.0, hd - .55, .6, .32, .35); lbox(b, 'dark', 1.6, 1.02, hd - .37, .5, .2, .02);
    lbox(b, 'metal', 1.85, 1.35, hd - .6, .02, .5, .02); b.radio = L2W(b, 1.6, hd - .9); lspot(b, 'desk', .6, .82, hd - .55);
    wardrobe(b, -hw + .35, 1.6, -PI / 2, 'locker');
    table(b, -1.6, -1.2, .9, .9); lspot(b, 'table', -1.6, .82, -1.2);
    lbox(b, 'wood', hw - .3, 1.0, -1, .4, 2, 1.6); lsolid(b, hw - .3, -1, .4, 1.6); // shelf
  } else if (b.kind === 'boat') {
    lbox(b, 'wood', -hw + .45, .45, 1.5, .8, .9, 2.4); lsolid(b, -hw + .45, 1.5, .8, 2.4); lspot(b, 'bench', -hw + .45, .95, 1.2);
    for (const y of [.9, 1.7]) { lbox(b, 'boat', hw - .55, y, .5, .7, .3, 4.5); }
    lbox(b, 'wood', hw - .3, 1.0, .5, .1, 2, 5); lsolid(b, hw - .55, .5, .8, 4.6);
    wardrobe(b, -hw + .35, -1.6, -PI / 2, 'locker');
    lspot(b, 'floor', 0, .2, 3);
  } else if (b.kind === 'out') {
    lbox(b, 'wood', 0, .25, .45, 1.2, .5, .6); hide(b, 0, .3, 0, 'outhouse'); b.lights = null;
  }
}

// outdoor bits
function solidR(x, z, sx, sz, list = SOL) { const r = {x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2}; list.push(r); return r; }
function landmarks() {
  // gate
  const gy = baseH(GATE.x, GATE.z);
  for (const s of [-1, 1]) { wbox('log', GATE.x + s * 4, gy + 2.2, GATE.z, .35, 4.4, .35, 0, 2); solidR(GATE.x + s * 4, GATE.z, .4, .4); }
  wbox('log', GATE.x, gy + 4.2, GATE.z, 8.6, .32, .32, 0, 2);
  put('sign', new THREE.BoxGeometry(5, .8, .06), GATE.x, gy + 3.55, GATE.z - .1);
  wbox('metal', GATE.x - 1.8, gy + 1, GATE.z + 1.7, .08, .08, 3.6, .35); // gate bar swung open
  // the car you broke down in
  const cx = 3.2, cz = -152, cy = baseH(cx, cz), carRy = .06;
  wbox('car', cx, cy + .7, cz, 1.8, .7, 4.3, carRy); wbox('car', cx, cy + 1.25, cz - .2, 1.6, .5, 2.1, carRy); wbox('dark', cx, cy + 1.26, cz - .2, 1.62, .4, 1.9, carRy);
  for (const ax of [-.85, .85]) for (const az of [-1.35, 1.35]) wbox('tyre', cx + ax, cy + .35, cz + az, .25, .7, .7, carRy);
  wbox('car', cx, cy + 1.4, cz - 2.05, 1.6, .06, .8, carRy); // trunk lid up
  solidR(cx, cz, 2, 4.5, WALLS); OBST.push({x0: cx - 1.9, x1: cx + 1.9, z0: cz - 3.1, z1: cz + 3.1});
  spot('trunk', cx, cy + .95, cz - 1.9);
  // old school bus
  const bx = 62, bz = -58, by = baseH(bx, bz);
  wbox('bus', bx, by + 1.6, bz, 2.5, 2.4, 10, 0, 3); wbox('dark', bx, by + 2.1, bz, 2.52, .7, 9, 0); wbox('tyre', bx, by + .45, bz - 3.3, 2.3, .9, .9); wbox('tyre', bx, by + .45, bz + 3.3, 2.3, .9, .9);
  solidR(bx, bz, 2.6, 10.1, WALLS); OBST.push({x0: bx - 2.3, x1: bx + 2.3, z0: bz - 6, z1: bz + 6});
  spot('bus', bx + .3, by + .1, bz - 5.6); padR(bx - 4, bx + 4, bz - 7, bz + 7, 6, by);
  // collapsed tent site
  const tx = -62, tz = -66, ty = baseH(tx, tz);
  put('tent', new THREE.ConeGeometry(1.7, 1.5, 4, 1, true), tx, ty + .75, tz, PI / 4 + .2, .15);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; wbox('rock', tx + 2.6 + Math.cos(a) * .55, ty + .1, tz + 1.6 + Math.sin(a) * .55, .25, .2, .25, a); }
  spot('tent', tx + 1.3, ty + .1, tz - .2); padC(tx, tz, 4, 6, ty);
  // watchtower
  const wx = -72, wz = 58, wy = baseH(wx, wz);
  for (const ax of [-1.3, 1.3]) for (const az of [-1.3, 1.3]) { wbox('log', wx + ax, wy + 3.6, wz + az, .22, 7.2, .22); solidR(wx + ax, wz + az, .25, .25); }
  wbox('wood', wx, wy + 7.2, wz, 3.4, .2, 3.4); wbox('wood', wx, wy + 7.8, wz + 1.65, 3.4, 1, .08); wbox('wood', wx, wy + 7.8, wz - 1.65, 3.4, 1, .08);
  put('roof', new THREE.ConeGeometry(2.6, 1.3, 4), wx, wy + 9.4, wz, PI / 4);
  for (let y = .4; y < 7; y += .45) wbox('wood', wx, wy + y, wz - 1.6, .7, .06, .06);
  wbox('wood', wx + 2.1, wy + .3, wz + .4, .7, .6, .6); solidR(wx + 2.1, wz + .4, .7, .6); spot('tower', wx + 2.1, wy + .62, wz + .4);
  padC(wx, wz, 4, 6, wy);
  // archery range
  const ax0 = 42, az0 = -24, ay = baseH(ax0, az0);
  for (let i = 0; i < 3; i++) { const z = az0 + (i - 1) * 4; put('straw', new THREE.CylinderGeometry(.6, .6, .25, 16), ax0 + 6, ay + 1.1, z, PI / 2, PI / 2 - .2); wbox('wood', ax0 + 6.2, ay + .6, z, .1, 1.2, .1); }
  wbox('wood', ax0 - 2, ay + .45, az0, .5, .08, 3); solidR(ax0 - 2, az0, .5, 3); spot('archery', ax0 - 2, ay + .52, az0 + .8);
  padC(ax0 + 2, az0, 8, 6, ay);
  // old well
  const lx = -28, lz = 60, ly = baseH(lx, lz);
  put('rock', new THREE.CylinderGeometry(.95, 1, .8, 14, 1, true), lx, ly + .4, lz); put('dark', new THREE.CircleGeometry(.9, 14), lx, ly + .3, lz, 0, -PI / 2);
  for (const s of [-1, 1]) wbox('log', lx + s * .95, ly + 1.1, lz, .12, 2.2, .12);
  put('roof', new THREE.ConeGeometry(1.4, .7, 4), lx, ly + 2.4, lz, PI / 4);
  solidR(lx, lz, 2, 2, WALLS); spot('well', lx + .7, ly + .82, lz + .5); padC(lx, lz, 4, 6, ly);
  // fire pit and lamp posts in camp
  const cy0 = baseH(0, 4);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; wbox('rock', Math.cos(a) * 1.2, cy0 + .12, 4 + Math.sin(a) * 1.2, .35, .25, .3, a); }
  for (let i = 0; i < 3; i++) wbox('log', 0, cy0 + .15, 4, .18, .18, 1.6, i * 1.1);
  LAMPS.length = 0;
  for (const [x, z] of [[10, -6], [-10, -6], [12, 14], [-12, 14], [0, 30], [3, -48], [-34, 10]]) {
    const y = baseH(x, z); wbox('log', x, y + 2.3, z, .16, 4.6, .16); wbox('metal', x, y + 4.55, z + .3, .3, .1, .5);
    put('bulb', new THREE.SphereGeometry(.09, 8, 6), x, y + 4.45, z + .4); solidR(x, z, .2, .2); LAMPS.push([x, y + 4.3, z + .4]);
  }
  // dock
  wbox('wood', LAKE.x - LAKE.r + 4, LAKE.y + .35, 20, 9, .12, 2, 0, 1.5);
  for (let i = 0; i < 4; i++) wbox('log', LAKE.x - LAKE.r + 1 + i * 2.6, LAKE.y - .4, 20 + (i % 2 ? 1 : -1), .15, 1.8, .15);
}
const LAMPS = [];

function buildLayout() {
  PADS.length = 0;
  const campH = rawH(0, 4);
  padC(0, 4, 38, 12, campH);
  padR(-6, 8, -60, -30, 8, campH); // camp entrance lane
  const ang = [-130, -82, -36, 36, 82, 130];
  ang.forEach((a, i) => {
    const r = a * PI / 180, x = Math.sin(r) * 25, z = 4 + Math.cos(r) * 25;
    const door = Math.abs(x) > Math.abs(z - 4) ? (x > 0 ? 'w' : 'e') : (z > 4 ? 's' : 'n');
    building('cabin', 'Cabin ' + (i + 1), Math.round(x), Math.round(z), door);
  });
  building('mess', 'Mess hall', 0, 46, 's');
  building('shed', 'Generator shed', -46, 8, 'e');
  building('ranger', 'Ranger station', 14, -76, 'w');
  building('boat', 'Boathouse', 63, 21, 'w');
  building('out', 'Outhouse', -30, -22, 'e');
  landmarks();
}

// ---------------- three setup
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.15;
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = 0x060910;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, .03);
const cam = new THREE.PerspectiveCamera(70, 1, .05, 600);
scene.add(cam);
function resize() { const w = innerWidth, h = innerHeight; RND.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0x52648c, 0x0b0906, .5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa9bce6, .55); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, {left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220});
moon.shadow.bias = -.0006; moon.shadow.normalBias = .04; moon.shadow.autoUpdate = false;
scene.add(moon, moon.target);
const MOONDIR = new THREE.Vector3(-.45, .75, .48).normalize();
const flash = new THREE.SpotLight(0xffeccc, 0, 45, .44, .6, 1.4); flash.castShadow = true;
flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = .25; flash.shadow.camera.far = 42; flash.shadow.bias = -.0004; flash.shadow.normalBias = .03;
scene.add(flash, flash.target);
const POOL = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffc27a, 0, 16, 1.6); scene.add(l); return l; });
const FLL = [0, 1].map(() => { const l = new THREE.PointLight(0xff2a14, 0, 22, 1.4); scene.add(l); return l; });
const truckL = new THREE.SpotLight(0xfff2d0, 0, 60, .5, .5, 1.2); scene.add(truckL, truckL.target);

// ---------------- textures
function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, base, n, a = 1) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r * .8; } g.putImageData(im, 0, 0); }
const TX = {};
function textures() {
  TX.ground = tex(cv(512, 512, (g, w, h) => {
    g.fillStyle = '#2a2e1c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const x = Math.random() * w, y = Math.random() * h, r = 3 + Math.random() * 26; g.fillStyle = `rgba(${Math.random() < .5 ? '60,48,30' : '28,40,20'},${.08 + Math.random() * .15})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 5000; i++) { g.strokeStyle = `rgba(${40 + Math.random() * 40},${50 + Math.random() * 40},${20 + Math.random() * 20},.5)`; const x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 4, y - 3 - Math.random() * 5); g.stroke(); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(70,50,30,${Math.random() * .6})`; g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 1 + Math.random() * 2); } // needles, twigs
    noiseFill(g, w, h, 0, 24);
  }), 70);
  TX.road = tex(cv(256, 512, (g, w, h) => {
    g.fillStyle = '#3f3326'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '90,75,55' : '30,25,18'},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 3); }
    for (const x of [.28, .72]) { const gr = g.createLinearGradient((x - .1) * w, 0, (x + .1) * w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, 'rgba(20,15,10,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    const e = g.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(42,46,28,1)'); e.addColorStop(.12, 'rgba(42,46,28,0)'); e.addColorStop(.88, 'rgba(42,46,28,0)'); e.addColorStop(1, 'rgba(42,46,28,1)'); g.fillStyle = e; g.fillRect(0, 0, w, h);
    noiseFill(g, w, h, 0, 20);
  }));
  TX.road.repeat.set(1, 1);
  const planks = (base, gap, wear) => cv(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { const sh = (Math.random() - .5) * 30; g.fillStyle = `rgba(${sh > 0 ? 255 : 0},${sh > 0 ? 240 : 0},${sh > 0 ? 220 : 0},${Math.abs(sh) / 255})`; g.fillRect(0, y, w, 32);
      for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${.05 + Math.random() * .12})`; g.beginPath(); const yy = y + Math.random() * 32; g.moveTo(0, yy); g.bezierCurveTo(w * .3, yy + (Math.random() - .5) * 6, w * .6, yy + (Math.random() - .5) * 6, w, yy); g.stroke(); }
      g.fillStyle = gap; g.fillRect(0, y, w, 2); g.fillRect((y * 7) % w, y, 2, 32); }
    for (let i = 0; i < wear; i++) { g.fillStyle = `rgba(30,40,20,${Math.random() * .2})`; g.beginPath(); g.arc(Math.random() * w, h - Math.random() * 60, 4 + Math.random() * 20, 0, TAU); g.fill(); }
    noiseFill(g, w, h, 0, 18);
  });
  TX.wall = tex(planks('#5a4a3a', '#1c140e', 40));
  TX.floor = tex(planks('#6a5038', '#20160e', 0));
  TX.roof = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#2b2622'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = -(y % 32 ? 16 : 0); x < w; x += 32) { g.fillStyle = `rgb(${32 + Math.random() * 18},${28 + Math.random() * 14},${26 + Math.random() * 12})`; g.fillRect(x + 1, y + 1, 30, 14); } noiseFill(g, w, h, 0, 14); }));
  TX.sign = tex(cv(512, 96, (g, w, h) => { g.fillStyle = '#4a3726'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c9a8'; g.font = 'bold 46px Georgia'; g.textAlign = 'center'; g.fillText('CAMP WHISPERPINE', w / 2, 60); g.font = '18px Georgia'; g.fillText('est. 1961', w / 2, 86); noiseFill(g, w, h, 0, 40); }));
  TX.sign.repeat.set(1, 1);
  TX.paper = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#d6ccb0'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4030'; for (let y = 14; y < h - 10; y += 9) g.fillRect(12, y, 70 + Math.random() * 30, 2); noiseFill(g, w, h, 0, 20); }));
  TX.glow = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
}
const MAT = {};
function materials() {
  const S = (o) => new THREE.MeshStandardMaterial(Object.assign({roughness: .9, metalness: 0}, o));
  MAT.wall = S({map: TX.wall, side: THREE.DoubleSide}); MAT.floor = S({map: TX.floor}); MAT.roof = S({map: TX.roof});
  MAT.trim = S({color: 0x3a2d22}); MAT.door = S({map: TX.wall, color: 0x9a8a78}); MAT.wood = S({map: TX.floor, color: 0xb8a088});
  MAT.dark = S({color: 0x0b0a09}); MAT.fabric = S({color: 0x4a3c34}); MAT.metal = S({color: 0x55585a, roughness: .55, metalness: .6});
  MAT.glass = S({color: 0x101820, roughness: .15, metalness: .3, emissive: 0xff8a2a, emissiveIntensity: 0});
  MAT.log = S({color: 0x3b2c20}); MAT.sign = S({map: TX.sign}); MAT.car = S({color: 0x3b4a5a, roughness: .45, metalness: .5}); MAT.tyre = S({color: 0x121212});
  MAT.bus = S({color: 0x6e5a24, roughness: .8, metalness: .3}); MAT.tent = S({color: 0x7a4a26, side: THREE.DoubleSide}); MAT.rock = S({color: 0x55534e, side: THREE.DoubleSide});
  MAT.straw = S({color: 0x8a7a48}); MAT.boat = S({color: 0x5a2a20}); MAT.bulb = S({color: 0x222018, emissive: 0xffd49a, emissiveIntensity: 0});
  MAT.ground = S({map: TX.ground}); MAT.road = S({map: TX.road, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  MAT.water = new THREE.MeshStandardMaterial({color: 0x05080c, roughness: .08, metalness: .6});
}
function mergeGeos(list) {
  let n = 0; const qs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); const hasC = qs.some(q => q.attributes.color); const col = hasC ? new Float32Array(n * 3).fill(1) : null;
  let o = 0; for (const q of qs) { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2); if (hasC && q.attributes.color) col.set(q.attributes.color.array, o * 3); o += c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}

// ---------------- terrain, road, sky, trees
function buildGround() {
  HG = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) HG[j * GN + i] = baseH(-WS + i * GS, -WS + j * GS);
  const g = new THREE.PlaneGeometry(WS * 2, WS * 2, GN - 1, GN - 1); g.rotateX(-PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const i = Math.round((p.getX(k) + WS) / GS), j = Math.round((p.getZ(k) + WS) / GS); p.setY(k, HG[j * GN + i]); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, MAT.ground); m.receiveShadow = true; scene.add(m);
  // outer skirt so the fog never shows the edge
  const sk = new THREE.Mesh(new THREE.RingGeometry(WS * 1.38, 520, 32, 1), MAT.ground); sk.rotation.x = -PI / 2; sk.position.y = -3; scene.add(sk);
  // road ribbon
  const pts = []; for (let i = 0; i < ROAD.length - 1; i++) { const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2); for (let k = 0; k < n; k++) pts.push([mix(ax, bx, k / n), mix(az, bz, k / n)]); }
  pts.push(ROAD[ROAD.length - 1]);
  const sm = pts.map((p, i) => { let sx = 0, sz = 0, c = 0; for (let k = -3; k <= 3; k++) { const q = pts[clamp(i + k, 0, pts.length - 1)]; sx += q[0]; sz += q[1]; c++; } return [sx / c, sz / c]; });
  const vs = [], uvs = [], idx = []; let acc = 0;
  for (let i = 0; i < sm.length; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i) acc += Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
    for (const s of [-1, 1]) { const x = sm[i][0] - tz * 3 * s, z = sm[i][1] + tx * 3 * s; vs.push(x, gH(x, z) + .04, z); uvs.push(s < 0 ? 0 : 1, acc / 6); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); rg.setIndex(idx); rg.computeVertexNormals();
  const rm = new THREE.Mesh(rg, MAT.road); rm.receiveShadow = true; scene.add(rm);
  // lake
  const wm = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 8, 48), MAT.water); wm.rotation.x = -PI / 2; wm.position.set(LAKE.x, LAKE.y, LAKE.z); scene.add(wm);
}
function buildSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {md: {value: MOONDIR}},
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform vec3 md;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec3 d = normalize(vD); float y = max(d.y, 0.);
        vec3 c = mix(vec3(.024,.035,.06), vec3(.006,.009,.02), pow(y,.5));
        float m = max(dot(d, md), 0.); c += vec3(.25,.3,.42) * pow(m, 60.) * .5 + vec3(.06,.08,.13) * pow(m, 6.);
        float cl = n(d.xz / (y + .15) * 3.) * .6 + n(d.xz / (y + .15) * 7.) * .4; c = mix(c, c * .45 + vec3(.012,.014,.02), smoothstep(.45,.8,cl) * smoothstep(0.,.3,y));
        gl_FragColor = vec4(c, 1.); }`}));
  sky.renderOrder = -2; scene.add(sky); scene.userData.sky = sky;
  const n = 1400, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const u = Math.random() * TAU, v = Math.random() * .95 + .05; const r = 480; p[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r; p[i * 3 + 1] = v * r; p[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const st = new THREE.Points(sg, new THREE.PointsMaterial({color: 0x9aa4c0, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: .7, depthWrite: false}));
  st.renderOrder = -1; scene.add(st); scene.userData.stars = st;
  const mn = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xdfe6ff, fog: false, depthWrite: false, transparent: true}));
  mn.scale.set(40, 40, 1); mn.renderOrder = -1; scene.add(mn); scene.userData.moon = mn;
}
function treeGeo() {
  const parts = [];
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const k = .7 + .3 * Math.min(1, y / 8); a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tr = new THREE.CylinderGeometry(.12, .3, 9, 6); tr.translate(0, 4.5, 0); parts.push(col(tr, [.22, .16, .11]));
  for (let i = 0; i < 5; i++) { const r = 2.2 - i * .38, y = 2.6 + i * 1.5; const c = new THREE.ConeGeometry(r, 2.6, 7, 1); c.translate(0, y + 1.3, 0); const p = c.attributes.position; for (let k = 0; k < p.count; k++) { p.setX(k, p.getX(k) * (.85 + h2(k, i) * .3)); p.setZ(k, p.getZ(k) * (.85 + h2(i, k) * .3)); } parts.push(col(c, [.09, .15, .1])); }
  return mergeGeos(parts);
}
function deadGeo() {
  const parts = []; const col = (g) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 3) { a[i] = .2; a[i + 1] = .16; a[i + 2] = .13; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tr = new THREE.CylinderGeometry(.08, .26, 8, 5); tr.translate(0, 4, 0); parts.push(col(tr));
  for (let i = 0; i < 6; i++) { const b = new THREE.CylinderGeometry(.02, .06, 2.4, 4); b.translate(0, 1.2, 0); b.rotateZ(1.0 + h2(i, 3) * .5); b.rotateY(i * 2.1); b.translate(0, 2.5 + i * .9, 0); parts.push(col(b)); }
  return mergeGeos(parts);
}
const TH = new Map(); const thKey = (i, j) => i * 1000 + j;
function treeAdd(x, z, r) { const t = {x, z, r}; TREES.push(t); const k = thKey(Math.floor(x / 8), Math.floor(z / 8)); if (!TH.has(k)) TH.set(k, []); TH.get(k).push(t); }
function treesNear(x, z, f) { const i0 = Math.floor((x - 2) / 8), i1 = Math.floor((x + 2) / 8), j0 = Math.floor((z - 2) / 8), j1 = Math.floor((z + 2) / 8); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = TH.get(thKey(i, j)); if (l) for (const t of l) f(t); } }
function inRect(x, z, r, m) { return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
function buildTrees() {
  const ok = (x, z, m) => {
    if (roadD(x, z) < 5 + m) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3) return false;
    for (const o of OBST) if (inRect(x, z, o, 3 + m)) return false;
    for (const s of SOL) if (inRect(x, z, s, 2.5)) return false;
    for (const l of LAMPS) if (Math.hypot(x - l[0], z - l[2]) < 3) return false;
    const dc = Math.hypot(x, z - 4); if (dc < 31 && dc > 4) return R() < .08; if (dc <= 4) return false;
    return true;
  };
  const pine = [], dead = [], bush = [];
  for (let k = 0; k < 9000 && pine.length < 2600; k++) {
    const x = (R() * 2 - 1) * (WS - 4), z = (R() * 2 - 1) * (WS - 4);
    const dens = .35 + .65 * fbm(x * .02 + 9, z * .02); if (R() > dens) continue;
    if (!ok(x, z, 0)) continue;
    let near = false; treesNear(x, z, t => { if (Math.hypot(t.x - x, t.z - z) < 2.6) near = true; }); if (near) continue;
    const s = .75 + R() * .7; (R() < .1 ? dead : pine).push([x, z, s, R() * TAU]); treeAdd(x, z, .32 * s);
  }
  for (let k = 0; k < 2500; k++) { const x = (R() * 2 - 1) * WS, z = (R() * 2 - 1) * WS; if (ok(x, z, -2) && Math.hypot(x, z - 4) > 6) bush.push([x, z, .5 + R() * .8, R() * TAU]); }
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, flatShading: true});
  const inst = (geo, list, cast) => {
    const tiles = new Map();
    for (const t of list) { const k = Math.floor((t[0] + WS) / 40) * 100 + Math.floor((t[1] + WS) / 40); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(t); }
    for (const l of tiles.values()) {
      const m = new THREE.InstancedMesh(geo, mat, l.length); const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3();
      l.forEach((t, i) => { const y = gH(t[0], t[1]) - .2; Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[3]); M4.compose(V.set(t[0], y, t[1]), Q, S3.set(t[2], t[2] * (.9 + h2(t[0], t[1]) * .3), t[2])); m.setMatrixAt(i, M4); });
      m.castShadow = cast; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m);
    }
  };
  inst(treeGeo(), pine, true); inst(deadGeo(), dead, true);
  const bg = new THREE.IcosahedronGeometry(.8, 0); bg.scale(1, .6, 1); bg.translate(0, .3, 0); { const n = bg.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 3) { a[i] = .08; a[i + 1] = .13; a[i + 2] = .07; } bg.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  inst(bg, bush, false);
}

// ---------------- the creature
const MON = new THREE.Group();
const MJ = {};
function buildCreature() {
  const skin = new THREE.MeshLambertMaterial({color: 0x050403});
  const pale = new THREE.MeshLambertMaterial({color: 0x5e584e});
  const hole = new THREE.MeshBasicMaterial({color: 0x000000});
  const eye = new THREE.MeshBasicMaterial({color: 0xff3a22});
  const cap = (r, l) => { const g = new THREE.CapsuleGeometry(r, l, 4, 8); g.translate(0, -l / 2 - r * .4, 0); return g; };
  const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
  const hips = new THREE.Group(); hips.position.y = 1.32; MON.add(hips); MJ.hips = hips;
  const torso = new THREE.Group(); hips.add(torso); MJ.torso = torso;
  const tg = new THREE.CapsuleGeometry(.17, .72, 4, 10); tg.scale(1.15, 1, .72); tg.translate(0, .5, 0); torso.add(mesh(tg, skin));
  for (let i = 0; i < 5; i++) { const rib = new THREE.TorusGeometry(.17, .012, 4, 12, PI); rib.rotateX(PI / 2); rib.scale(1.2, 1, .8); const m = mesh(rib, skin); m.position.set(0, .45 + i * .08, .02); torso.add(m); }
  const neck = new THREE.Group(); neck.position.y = .98; torso.add(neck); MJ.neck = neck;
  neck.add(mesh(cap(.05, .22).translate(0, .3, 0), skin));
  const head = new THREE.Group(); head.position.set(0, .3, .03); neck.add(head); MJ.head = head;
  const hg = new THREE.SphereGeometry(.15, 16, 12); hg.scale(.85, 1.45, .95); hg.translate(0, .12, 0); head.add(mesh(hg, pale));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 6), hole); e.scale.set(1, 1.4, .5); e.position.set(s * .052, .18, .125); head.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(.009, 6, 4), eye); p.position.set(s * .052, .175, .138); head.add(p); }
  const mo = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 6), hole); mo.scale.set(.6, 1.7, .4); mo.position.set(0, -.02, .125); head.add(mo); MJ.mouth = mo;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .25, .9, 0); torso.add(sh); MJ['sh' + s] = sh;
    sh.add(mesh(cap(.05, .62), skin));
    const el = new THREE.Group(); el.position.y = -.74; sh.add(el); MJ['el' + s] = el;
    el.add(mesh(cap(.04, .66), skin));
    const hand = new THREE.Group(); hand.position.y = -.78; el.add(hand);
    for (let f = 0; f < 4; f++) { const fg = mesh(cap(.011, .2), pale); fg.position.set((f - 1.5) * .022, 0, .01); fg.rotation.z = (f - 1.5) * .12; hand.add(fg); }
    const hip = new THREE.Group(); hip.position.set(s * .13, 0, 0); hips.add(hip); MJ['hp' + s] = hip;
    hip.add(mesh(cap(.065, .55), skin));
    const kn = new THREE.Group(); kn.position.y = -.68; hip.add(kn); MJ['kn' + s] = kn;
    kn.add(mesh(cap(.05, .56), skin));
    const ft = mesh(new THREE.BoxGeometry(.08, .04, .22), skin); ft.position.set(0, -.68, .06); kn.add(ft);
  }
  MON.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
  scene.add(MON);
}
function animCreature(dt) {
  const sp = M.spd, k = clamp(sp / 5, 0, 1.3);
  M.ph += dt * (2.2 + sp * 1.25);
  const s = Math.sin(M.ph), c = Math.cos(M.ph);
  const ch = M.state === 'chase';
  for (const g of [-1, 1]) {
    const sw = s * g;
    MJ['hp' + g].rotation.x = -sw * .55 * k - .05;
    MJ['kn' + g].rotation.x = Math.max(0, (g * c + .3)) * .9 * k + .08;
    MJ['sh' + g].rotation.x = ch ? -1.1 + sw * .35 : sw * .35 * k + .05;
    MJ['sh' + g].rotation.z = g * (ch ? .25 : .08);
    MJ['el' + g].rotation.x = ch ? -.5 : -.15 - k * .2;
  }
  MJ.hips.position.y = 1.3 + Math.abs(c) * .05 * k;
  MJ.torso.rotation.x = .28 + k * .2 + (M.state === 'check' ? .4 : 0);
  M.jit -= dt; if (M.jit < 0) { M.jit = .15 + Math.random() * 1.2; M.jr = (Math.random() - .5) * (ch ? 1.2 : .6); }
  MJ.head.rotation.z = mix(MJ.head.rotation.z, M.jr, dt * 18);
  MJ.neck.rotation.x = -.35 - k * .1 + (M.look || 0);
  MJ.mouth.scale.y = 1.7 + (ch ? 1.6 + Math.sin(G.t * 30) * .3 : 0);
  MON.position.set(M.x, M.y, M.z); MON.rotation.y = M.yaw;
}

// ---------------- state
const G = {on: false, paused: false, over: false, t: 0, obj: 'radio0', phase: 0, power: false, inserted: 0, timer: 0, truck: null, fuseTot: 3, noteOpen: false, map: false, msgT: 0, hold: 0, holdT: null, items: [], flares: [], radioDone: false, radioQ: [], run: 0};
const P = {x: 0, z: 0, y: 0, yaw: PI, pitch: 0, vx: 0, vz: 0, crouch: false, stam: 1, bat: 1, light: true, flares: 0, fuses: 0, hidden: null, breath: 1, holdBreath: false, gasp: 0, bob: 0, stepD: 0, zone: -1, eye: 1.62, lastNoise: 0, fear: 0, moved: 0};
const M = {x: 0, z: 0, y: 0, yaw: 0, state: 'roam', path: [], rep: 0, goal: null, spd: 0, ph: 0, jit: 0, jr: 0, aware: 0, lostT: 0, lx: 0, lz: 0, idle: 0, flee: 0, zone: -1, sawHide: null, far: 0, chk: [], chkT: 0, stalkT: 40, stuck: 0, sx: 0, sz: 0, screamT: 0, stalkSeen: 0, hintT: 10, look: 0, seenAt: -99};

// ---------------- collisions
function pushCircle(o, r, walls, solids, trees) {
  const lists = solids ? [WALLS, SOL] : [WALLS];
  for (const L of lists) for (const w of L) {
    if (o.x < w.x0 - r || o.x > w.x1 + r || o.z < w.z0 - r || o.z > w.z1 + r) continue;
    const cx = clamp(o.x, w.x0, w.x1), cz = clamp(o.z, w.z0, w.z1); let dx = o.x - cx, dz = o.z - cz; const d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) { o.x = cx + dx / d * r; o.z = cz + dz / d * r; } }
    else { const l = o.x - w.x0, rr = w.x1 - o.x, t = o.z - w.z0, b = w.z1 - o.z, m = Math.min(l, rr, t, b); if (m === l) o.x = w.x0 - r; else if (m === rr) o.x = w.x1 + r; else if (m === t) o.z = w.z0 - r; else o.z = w.z1 + r; }
  }
  if (trees) treesNear(o.x, o.z, t => { const dx = o.x - t.x, dz = o.z - t.z, d = Math.hypot(dx, dz), m = r + t.r; if (d < m && d > 1e-4) { o.x = t.x + dx / d * m; o.z = t.z + dz / d * m; } });
  const dl = Math.hypot(o.x - LAKE.x, o.z - LAKE.z), lr = LAKE.r - 1.5; if (dl < lr) { o.x = LAKE.x + (o.x - LAKE.x) / dl * lr; o.z = LAKE.z + (o.z - LAKE.z) / dl * lr; }
  o.x = clamp(o.x, -WS + 6, WS - 6); o.z = clamp(o.z, -WS + 6, WS - 6);
}
function segRect(ax, az, bx, bz, r) { // slab test, true if segment hits rect
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, r.x0, r.x1], [az, dz, r.z0, r.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}
function losClear(ax, az, bx, bz) { for (const w of WALLS) if (segRect(ax, az, bx, bz, w)) return false; return true; }
function foliage(ax, az, bx, bz) { // fraction of sight left through trees
  const d = Math.hypot(bx - ax, bz - az), n = Math.floor(d / 2.5); let v = 1; const seen = new Set();
  for (let i = 1; i < n; i++) { const x = mix(ax, bx, i / n), z = mix(az, bz, i / n); treesNear(x, z, t => { if (!seen.has(t) && Math.hypot(t.x - x, t.z - z) < 1.3) { seen.add(t); v *= .78; } }); }
  return v;
}

// ---------------- creature navigation
function detour(ax, az, bx, bz, skip) {
  const out = []; let cx = ax, cz = az;
  for (let it = 0; it < 5; it++) {
    let hit = null, hd = 1e9;
    for (const o of OBST) { if (o.b === skip) continue; if (inRect(cx, cz, o, -.05) || inRect(bx, bz, o, -.05)) continue; if (segRect(cx, cz, bx, bz, o)) { const d = Math.hypot((o.x0 + o.x1) / 2 - cx, (o.z0 + o.z1) / 2 - cz); if (d < hd) { hd = d; hit = o; } } }
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
  const pts = []; const fz = M.zone; let cx = M.x, cz = M.z;
  const dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]), me = [M.x, M.z];
  const axis = b => { const ax = b.din[0] - b.dout[0], az = b.din[1] - b.dout[1], l = Math.hypot(ax, az); return Math.abs(((M.x - b.dout[0]) * az - (M.z - b.dout[1]) * ax) / l); };
  if (fz >= 0 && fz !== tzone) { const b = BLD[fz]; if (!(axis(b) < .45 && dd(me, b.dout) < dd(b.din, b.dout) - .2)) pts.push(b.din); pts.push(b.dout); cx = b.dout[0]; cz = b.dout[1]; }
  let ex = tx, ez = tz; const tail = [];
  if (tzone >= 0 && tzone !== fz) { const b = BLD[tzone]; tail.push(b.dfront, b.dout, b.din); ex = b.dfront[0]; ez = b.dfront[1]; }
  if (fz < 0 && tail.length) { const b = BLD[tzone]; if (dd(me, b.dout) < dd(b.dfront, b.dout)) { tail.shift(); if (axis(b) < .45 && dd(me, b.din) < dd(b.dout, b.din)) tail.shift(); } ex = tail[0][0]; ez = tail[0][1]; }
  if (fz < 0 || fz !== tzone) pts.push(...detour(cx, cz, ex, ez, -1));
  pts.push(...tail, [tx, tz]);
  M.path = pts;
}
function goTo(x, z, zone) { M.goal = [x, z, zone == null ? zoneOf(x, z) : zone]; plan(x, z, M.goal[2]); }
function moveAlong(dt, speed) {
  while (M.path.length && Math.hypot(M.path[0][0] - M.x, M.path[0][1] - M.z) < (M.path.length > 1 ? .55 : .3)) M.path.shift();
  if (!M.path.length) { M.spd = mix(M.spd, 0, dt * 6); return true; }
  const [wx, wz] = M.path[0]; const dx = wx - M.x, dz = wz - M.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz); M.yaw += clamp(angD(M.yaw, want), -dt * 7, dt * 7);
  const turnK = 1 - Math.min(.6, Math.abs(angD(M.yaw, want)) / PI);
  M.spd = mix(M.spd, speed * turnK, dt * 3);
  const st = Math.min(d, M.spd * dt); M.x += dx / d * st; M.z += dz / d * st;
  pushCircle(M, .32, true, false, true);
  return false;
}

// ---------------- items
const ITEMG = {};
function itemMeshes() {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .5}, o));
  const fuse = new THREE.Group(); const fg = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .14, 10), S({color: 0xd4a050, emissive: 0x6a4010, emissiveIntensity: .5, roughness: .2, transparent: true, opacity: .85}));
  fuse.add(fg); for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .035, 10), S({color: 0xb08850, metalness: .9, roughness: .3})); c.position.y = s * .07; fuse.add(c); } fuse.rotation.z = PI / 2; ITEMG.fuse = fuse;
  const bat = new THREE.Group(); bat.add(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .1, 10), S({color: 0x2a5a2a, metalness: .4}))); const t = new THREE.Mesh(new THREE.CylinderGeometry(.026, .026, .025, 10), S({color: 0xb8b8b0, metalness: .9})); t.position.y = .05; bat.add(t); bat.rotation.z = PI / 2; ITEMG.battery = bat;
  const fl = new THREE.Group(); fl.add(new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .26, 8), S({color: 0xb0201a, emissive: 0x300000}))); const fc = new THREE.Mesh(new THREE.CylinderGeometry(.024, .024, .04, 8), S({color: 0x222222})); fc.position.y = .13; fl.add(fc); fl.rotation.z = PI / 2; ITEMG.flare = fl;
  const nt = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), S({map: TX.paper, side: THREE.DoubleSide, roughness: 1})); nt.rotation.x = -PI / 2; const ng = new THREE.Group(); ng.add(nt); ITEMG.note = ng;
}
function addItem(kind, s, extra = {}) {
  const m = ITEMG[kind].clone(); m.position.set(s.x, s.y + (kind === 'note' ? .005 : .03), s.z); m.rotation.y = WR() * TAU; m.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(m);
  const it = Object.assign({kind, mesh: m, x: s.x, y: s.y, z: s.z, r: 2.2}, extra);
  it.label = () => ({fuse: 'Pick up the fuse', battery: 'Pick up batteries', flare: 'Pick up the flare', note: 'Read the note'})[kind];
  it.item = true; INTER.push(it); G.items.push(it); return it;
}
const NOTES = [
  ['desk', 'Ranger log, Oct 12 1989.\n\nThird camper this month says something stands at the treeline and watches the cabins. Tall. Too tall. Counselor Ames swears it only comes close when it is quiet.\n\nCounty still has not sent the new fuses. Generator is running on prayers.'],
  ['table', 'Dear Mom,\n\nThe counselors make us whisper after dark now. Tommy says if you hear it breathing outside the wardrobe you hold your breath and it goes away.\n\nI don\'t want to play that game anymore. Please come get me.\n\n- Danny, Cabin 3'],
  ['counter', 'KITCHEN STAFF\n\nDO NOT leave the generator shed open. Somebody keeps pulling the fuses and leaving them all over the woods. The tent site, the old bus, the tower. It isn\'t funny.\n\n- Management'],
  ['bench', 'It doesn\'t like the flares. The red light keeps it off you for a while. Throw one and run.\n\nIf anyone finds this: the radio in the ranger station still works. It just needs power.'],
  ['tower', 'Counted the cabins from up here tonight. Every window dark, like they told us.\n\nThen one lit up. Then it went dark again. Nobody is supposed to be in there.\n\nIt was standing in the doorway, looking at the tower.'],
];
function placeItems() {
  for (const it of G.items) scene.remove(it.mesh); G.items.length = 0;
  for (let i = INTER.length - 1; i >= 0; i--) if (INTER[i].item) INTER.splice(i, 1);
  const all = []; for (const k in SPOTS) for (const s of SPOTS[k]) all.push(Object.assign({k}, s));
  const used = new Set(); const take = s => used.add(s);
  // notes in fixed spots (first matching spot)
  for (const [k, txt] of NOTES) { const s = all.find(q => q.k === k && !used.has(q)); if (s) { take(s); addItem('note', {x: s.x + .15, y: s.y, z: s.z - .1}, {text: txt}); } }
  const fuseK = ['table', 'counter', 'bench', 'tent', 'bus', 'tower', 'archery', 'well', 'floor'];
  const cand = all.filter(s => fuseK.includes(s.k) && !used.has(s)).sort(() => WR() - .5);
  const fz = [];
  for (const s of cand) { if (fz.length >= 3) break; if (fz.every(f => Math.hypot(f.x - s.x, f.z - s.z) > 38)) { fz.push(s); take(s); } }
  for (const s of cand) { if (fz.length >= 3) break; if (!used.has(s)) { fz.push(s); take(s); } }
  fz.forEach(s => addItem('fuse', s));
  const trunk = all.find(s => s.k === 'trunk'); take(trunk); addItem('flare', trunk);
  const rest = all.filter(s => !used.has(s) && s.k !== 'trunk').sort(() => WR() - .5);
  rest.slice(0, 6).forEach(s => addItem('battery', s));
  if (rest[6]) addItem('flare', rest[6]);
}

// ---------------- audio
const A = {ctx: null, on: false};
function aInit() {
  if (A.ctx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const c = A.ctx = new C(); A.out = c.createGain(); A.out.gain.value = .9; const comp = c.createDynamicsCompressor();
  A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 20000; A.lp.Q.value = .5; A.out.connect(A.lp); A.lp.connect(comp); comp.connect(c.destination); // muffles the world while you hide
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
  const loop = (f, q, g0, type = 'bandpass') => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl); fl.connect(g); s.start(); return {s, f: fl, g}; };
  A.wind = loop(380, .6, .05); A.wind.g.connect(A.out);
  A.wind2 = loop(900, 1.5, .012); A.wind2.g.connect(A.out);
  // crickets
  const o = c.createOscillator(); o.frequency.value = 4400; const og = c.createGain(); og.gain.value = 0; const am = c.createOscillator(); am.frequency.value = 28; am.type = 'square'; const amg = c.createGain(); amg.gain.value = .5; am.connect(amg); amg.connect(og.gain);
  const cr = c.createGain(); cr.gain.value = .006; o.connect(og); og.connect(cr); cr.connect(A.out); o.start(); am.start(); A.crick = cr;
  // creature voice (positional)
  const mp = A.mPan = c.createPanner(); Object.assign(mp, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, rolloffFactor: 1.4, maxDistance: 200}); mp.connect(A.out);
  const v1 = loop(260, 3, 0, 'bandpass'); v1.g.connect(mp); A.mBreath = v1;
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 46; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 220; const sg = c.createGain(); sg.gain.value = 0; saw.connect(sf); sf.connect(sg); sg.connect(mp); saw.start(); A.mGrowl = sg; A.mSaw = saw;
  // chase drone
  const dg = c.createGain(); dg.gain.value = 0; dg.connect(A.out); A.drone = dg; const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 300; df.connect(dg); A.droneF = df;
  for (const f of [55, 58.3, 82.4, 110.6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.connect(df); x.start(); }
  // generator hum (positional)
  const gp = A.gPan = c.createPanner(); Object.assign(gp, {distanceModel: 'inverse', refDistance: 3, rolloffFactor: 1.2}); gp.connect(A.out);
  const gg = A.genG = c.createGain(); gg.gain.value = 0; gg.connect(gp); for (const f of [50, 100, 150]) { const x = c.createOscillator(); x.type = f === 50 ? 'sawtooth' : 'sine'; x.frequency.value = f; const g = c.createGain(); g.gain.value = f === 50 ? .05 : .03; x.connect(g); g.connect(gg); x.start(); }
  // radio static
  A.stat = loop(2200, .8, 0); A.stat.g.connect(A.out);
  // truck engine
  const tp = A.tPan = c.createPanner(); Object.assign(tp, {distanceModel: 'inverse', refDistance: 5, rolloffFactor: 1}); tp.connect(A.out);
  const te = c.createOscillator(); te.type = 'sawtooth'; te.frequency.value = 38; const tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 260; const tg = A.truckG = c.createGain(); tg.gain.value = 0; te.connect(tf); tf.connect(tg); tg.connect(tp); te.start();
  A.on = true;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1) {
  if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); env(g, t, .005, peak, dec); s.connect(fl); fl.connect(g); g.connect(dest || A.out); s.start(t, Math.random()); s.stop(t + dec + .1);
}
function tone(f, peak, dec, type = 'sine', dest, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
const Snd = {
  step(wood, k) { burst(wood ? 500 : 1100, wood ? 1.2 : .7, .05 * k, wood ? .09 : .07, 'bandpass'); if (wood) tone(140 + Math.random() * 30, .025 * k, .06); },
  mStep(k) { if (!A.on) return; burst(160, 1, .35 * k, .16, 'lowpass', A.mPan); },
  heart(k) { tone(58, .25 * k, .12); setTimeout(() => tone(52, .18 * k, .14), 170); },
  pickup() { tone(660, .05, .25); setTimeout(() => tone(990, .04, .3), 90); },
  clunk() { burst(300, 2, .3, .12); tone(90, .2, .2, 'square'); },
  click() { burst(3000, 3, .05, .02); },
  stinger() { if (!A.on) return; for (const f of [233, 247, 311, 466]) tone(f, .06, 1.6, 'sawtooth'); burst(3000, .4, .25, 1.4, 'highpass'); },
  scream() { if (!A.on) return; for (const f of [520, 560, 790]) tone(f, .22, 1.2, 'sawtooth', null, f * .4); burst(1800, .5, .9, 1.4, 'bandpass'); },
  creak() { tone(90, .06, .7, 'sawtooth', A.mPan, 60); burst(700, 6, .1, .6, 'bandpass', A.mPan, .4); },
  gasp() { burst(1300, 1.5, .25, .45, 'bandpass'); },
  flare() { burst(2500, .5, .3, 1.2, 'highpass'); },
  pull() { burst(400, 1, .25, .35, 'bandpass', null, .6); },
  horn() { tone(300, .2, 1.1, 'square'); tone(377, .16, 1.1, 'square'); },
  staticHit() { burst(2400, .6, .2, .5); },
  call(x, y, z) { // a long wail far off in the woods, from wherever it is
    if (!A.on) return; const c = A.ctx, t = c.currentTime, p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 30, rolloffFactor: 1}); setPan(p, x, y, z);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(p); p.connect(A.out);
    const f0 = 280 + Math.random() * 120;
    for (const [f, a] of [[f0, .16], [f0 * 1.49, .07], [f0 * 1.007, .1]]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.12, t + .9); o.frequency.exponentialRampToValueAtTime(f * .42, t + 3.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + .7); g.gain.exponentialRampToValueAtTime(.0001, t + 3.4); o.connect(g); g.connect(lp); o.start(t); o.stop(t + 3.5); }
    burst(600, 2, .1, 2.4, 'bandpass', lp, .5); setTimeout(() => { p.disconnect(); lp.disconnect(); }, 4500);
  },
};
function quietLoops(sec) { if (!A.on) return; const t = A.ctx.currentTime; for (const g of [A.drone, A.mGrowl, A.mBreath.g, A.genG, A.truckG, A.stat.g]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, sec); } }
let VOICE = null;
function hush() { if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {} }
function say(txt, who) {
  showMsg(txt, who, 4 + txt.length * .045);
  if (SET.voice === '1' && window.speechSynthesis && !TEST) { try { const u = new SpeechSynthesisUtterance(txt); u.rate = 1.02; u.pitch = .8; u.volume = .9; speechSynthesis.speak(u); } catch (e) {} }
}

// ---------------- UI helpers
function showMsg(txt, who, dur = 4) { $('msg').innerHTML = (who ? `<b>${who}</b>` : '') + txt; $('msg').style.opacity = 1; G.msgT = dur; }
const OBJ = {
  radio0: 'Find a phone or a radio. The camp had a ranger station by the road.',
  gen: 'Get the power back on. The generator shed is on the west side of camp.',
  fuse: () => `Find fuses for the generator (${P.fuses + G.inserted} of 3). Bring them to the shed.`,
  start: 'Start the generator.',
  call: 'Go back to the ranger station and call for help on the radio.',
  escape: () => G.timer > 0 ? `Stay alive. The truck reaches the gate in ${Math.ceil(G.timer)} s.` : 'The truck is at the gate. GET IN.',
};
let objLast = '';
function setObj(k) { G.obj = k; objLast = ''; $('obj').style.opacity = 1; G.objT = 8; }
function objText() { const o = OBJ[G.obj]; return typeof o === 'function' ? o() : o; }

// ---------------- noise events for the creature
function noise(x, z, r, zone) {
  r *= D.hear; const d = Math.hypot(x - M.x, z - M.z);
  const blocked = !losClear(x, z, M.x, M.z); if (blocked) r *= .6;
  if (d > r) return;
  if (M.state === 'chase' || M.state === 'flee') return;
  const fuzz = d * .12; const tx = x + (WR() - .5) * fuzz, tz = z + (WR() - .5) * fuzz;
  M.state = 'inv'; M.idle = 0; goTo(tx, tz, zone == null ? zoneOf(tx, tz) : zone); M.invZone = zone == null ? zoneOf(x, z) : zone;
}

// ---------------- game flow
let BUILT = false;
function buildWorld() {
  if (BUILT) return; BUILT = true;
  textures(); materials(); buildLayout(); buildGround(); buildSky(); buildTrees(); itemMeshes(); buildCreature();
  for (const k in BK) { const m = new THREE.Mesh(mergeGeos(BK[k]), MAT[k]); m.castShadow = k !== 'glass' && k !== 'bulb'; m.receiveShadow = true; scene.add(m); }
  // generator interaction + radio
  const shed = BLD.find(b => b.kind === 'shed'), rng = BLD.find(b => b.kind === 'ranger');
  G.shed = shed; G.rng = rng;
  INTER.push({kind: 'gen', x: shed.gen[0], y: shed.fy + 1, z: shed.gen[1], r: 2.4, hold: () => G.obj === 'start' ? 3 : 0,
    label: () => G.power ? 'The generator is running' : G.obj === 'start' ? 'Hold E to pull the starter cord' : P.fuses ? `Put the fuse${P.fuses > 1 ? 's' : ''} in (${G.inserted}/3)` : `Generator. Fuses missing (${G.inserted}/3)`});
  INTER.push({kind: 'radio', x: rng.radio[0], y: rng.fy + 1.1, z: rng.radio[1], r: 2.2, hold: () => G.power && G.obj === 'call' ? 5 : 0,
    label: () => G.radioDone ? 'Static' : G.power ? (G.obj === 'call' ? 'Hold E to call for help' : 'Radio') : 'Radio (no power)'});
  INTER.push({kind: 'truck', x: 0, y: 0, z: 0, r: 4.5, label: () => 'Get in the truck', on: () => G.truck && G.truck.arrived});
  // fuse panel slots
  G.slots = [0, 1, 2].map(i => { const m = ITEMG.fuse.clone(); const [x, z] = L2W(shed, -1.4 + i * .2, shed.d / 2 - .2); m.position.set(x, shed.fy + 1.45, z); m.visible = false; scene.add(m); return m; });
  // truck
  const tk = new THREE.Group(); const tm = new THREE.MeshStandardMaterial({color: 0x5a6650, roughness: .6, metalness: .3}); const dm = new THREE.MeshStandardMaterial({color: 0x0b0d10, roughness: .2});
  const bx = (sx, sy, sz, x, y, z, m = tm) => { const k = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); k.position.set(x, y, z); k.castShadow = true; tk.add(k); };
  bx(2.1, .9, 5.2, 0, 1.0, 0); bx(2, 1, 1.8, 0, 1.9, .9); bx(1.9, .6, 1.6, 0, 2.05, .9, dm); bx(2.1, .5, 2.6, 0, 1.7, -1.3);
  for (const ax of [-1, 1]) for (const az of [-1.7, 1.7]) bx(.3, .8, .8, ax * 1, .4, az, MAT.tyre);
  for (const ax of [-.7, .7]) { const l = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), new THREE.MeshBasicMaterial({color: 0xfff4d0})); l.position.set(ax, 1.15, 2.62); tk.add(l); }
  tk.visible = false; scene.add(tk); G.truckM = tk;
  G.lampGlow = LAMPS.map(l => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffb46a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .55})); s.scale.set(2.2, 2.2, 1); s.position.set(l[0], l[1] + .1, l[2]); s.visible = false; scene.add(s); return s; });
  $('load').classList.add('hidden');
}
function reset() {
  D = DIFF[SET.diff] || DIFF.normal; WR = mulberry((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  hush(); G.run = (G.run || 0) + 1;
  Object.assign(G, {radioQ: [], stingAt: 0, over: false, paused: false, t: 0, obj: 'radio0', power: false, inserted: 0, timer: 0, truck: null, noteOpen: false, map: false, radioDone: false, holdT: null, hold: 0, ending: 0, deathT: 0, objT: 10, flares: [], endShown: false, won: false, deathHow: null});
  Object.assign(P, {x: .6, z: -147, yaw: PI - .05, pitch: -.02, vx: 0, vz: 0, crouch: false, stam: 1, bat: 1, light: true, flares: 0, fuses: 0, hidden: null, breath: 1, holdBreath: false, holdBreathK: false, tired: false, batWarned: false, gasp: 0, bob: 0, stepD: 0, fear: 0});
  Object.assign(M, {x: -10, z: 120, yaw: 0, state: 'roam', path: [], idle: 2, aware: 0, lostT: 0, flee: 0, sawHide: null, far: 0, stalkT: 45 + WR() * 30, stuck: 0, screamT: 0, hintT: 20, spd: 0, look: 0, callT: 35 + WR() * 30});
  M.y = gH(M.x, M.z);
  for (const l of FLL) l.intensity = 0; for (const f of G.flaresM || []) scene.remove(f); G.flaresM = [];
  G.slots.forEach(s => s.visible = false);
  MAT.glass.emissiveIntensity = 0; MAT.bulb.emissiveIntensity = 0; G.lampGlow.forEach(s => s.visible = false); POOL.forEach(l => l.intensity = 0);
  G.truckM.visible = false; truckL.intensity = 0;
  placeItems();
  setObj('radio0');
  ['slats', 'breath', 'map', 'note', 'end', 'pause'].forEach(id => $(id).classList.add('hidden'));
  $('black').style.opacity = 0; $('flash').style.opacity = 0;
  moon.shadow.needsUpdate = true; G.shadowAt = [P.x, P.z];
  if (A.on) { const t = A.ctx.currentTime; for (const g of [A.genG, A.truckG, A.stat.g, A.drone, A.mGrowl]) { g.gain.cancelScheduledValues(t); g.gain.value = 0; } A.lp.frequency.value = 20000; }
}
function start() {
  aInit(); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  RND.shadowMap.enabled = SET.gfx === 'high'; flash.castShadow = moon.castShadow = SET.gfx === 'high';
  RND.setPixelRatio(SET.gfx === 'high' ? Math.min(devicePixelRatio || 1, 1.5) : 1); resize();
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  canvas.style.filter = SET.bright !== 1 ? `brightness(${SET.bright})` : '';
  reset();
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  G.on = true; lockMouse();
  const it = $('intro'); it.innerHTML = 'Your car died on the county road a mile past the old camp.<br>No signal. No lights for miles.<br><br>The ranger station is just past the gate.';
  it.classList.remove('hidden'); it.style.opacity = 1; setTimeout(() => it.style.opacity = 0, TEST ? 0 : 4200); setTimeout(() => it.classList.add('hidden'), TEST ? 0 : 6400);
}
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function die(how) {
  if (G.over) return; G.over = true; G.deathT = 0; G.deathHow = how;
  P.hidden = null; $('slats').classList.add('hidden'); $('breath').classList.add('hidden');
  if (A.on) { A.lp.frequency.cancelScheduledValues(A.ctx.currentTime); A.lp.frequency.value = 20000; } // the door is torn open
  Snd.scream(); M.state = 'kill'; hush(); G.radioQ = [];
  // put it right in your face
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  if (how !== 'pulled') { M.x = P.x + fx * .75; M.z = P.z + fz * .75; } else { M.x = P.x + fx * .7; M.z = P.z + fz * .7; }
  M.yaw = Math.atan2(fx, fz); M.spd = 0;
}
function win() { if (G.over) return; G.over = true; G.won = true; hush(); G.radioQ = []; $('black').style.opacity = 1; const run = G.run; setTimeout(() => { if (run === G.run && G.over) endScreen(true); }, 1400); }
function endScreen(won) {
  try { document.exitPointerLock(); } catch (e) {}
  const t = G.t, mm = Math.floor(t / 60), ss = Math.floor(t % 60).toString().padStart(2, '0');
  $('end').className = 'scr' + (won ? '' : ' dead');
  $('endT').textContent = won ? 'You got out' : 'You were taken';
  let best = ''; if (won) { const k = 'wp-best-' + SET.diff, b = +localStorage.getItem(k) || 0; if (!b || t < b) { try { localStorage.setItem(k, t); } catch (e) {} best = ' · new best'; } }
  $('endS').textContent = won ? `Escaped Whisperpine in ${mm}:${ss} on ${SET.diff}${best}.` : `Survived ${mm}:${ss}. ${G.inserted}/3 fuses in, ${G.power ? 'power on' : 'no power'}${G.radioDone ? ', help was coming' : ''}.`;
  $('hud').classList.add('hidden'); G.on = false; quietLoops(.6);
}

// ---------------- input
const K = {}; let mouseR = false, eDown = false, ePress = false;
addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (!G.on || G.over) return;
  if (e.repeat) { if (e.code === 'Tab') return; }
  K[e.code] = true;
  if (G.noteOpen) { if (e.code === 'KeyE' || e.code === 'Escape') closeNote(); return; }
  if (e.code === 'KeyE' && !e.repeat) { eDown = true; ePress = true; }
  if (e.code === 'KeyF' && !P.hidden && !e.repeat) { Snd.click(); if (P.bat > 0) P.light = !P.light; else showMsg('Click. Nothing. The batteries are dead.', '', 2.5); }
  if (e.code === 'KeyC' && !e.repeat) P.crouch = !P.crouch;
  if (e.code === 'KeyG' && !e.repeat) throwFlare();
  if (e.code === 'Tab') { G.map = true; $('map').classList.remove('hidden'); drawMap(); }
  if (e.code === 'Space') P.holdBreathK = true;
});
addEventListener('keyup', e => { K[e.code] = false; if (e.code === 'KeyE') eDown = false; if (e.code === 'Tab') { G.map = false; $('map').classList.add('hidden'); } if (e.code === 'Space') P.holdBreathK = false; });
addEventListener('mousemove', e => {
  if (!G.on || G.paused || G.over || document.pointerLockElement !== canvas) return;
  const s = .0022 * SET.sens; P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.45, 1.45);
  if (P.hidden) { const h = P.hidden; const d = angD(h.yaw, P.yaw); P.yaw = h.yaw + clamp(d, -.7, .7); P.pitch = clamp(P.pitch, -.5, .4); }
});
canvas.addEventListener('mousedown', e => { if (!G.on) return; if (document.pointerLockElement !== canvas && !G.over) { lockMouse(); return; } if (G.noteOpen) { closeNote(); return; } if (e.button === 2) mouseR = true; });
addEventListener('mouseup', e => { if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && G.on && !G.over && !TEST) pause(true); });
addEventListener('blur', () => { for (const k in K) K[k] = false; eDown = false; mouseR = false; });
function pause(p) { G.paused = p; $('pause').classList.toggle('hidden', !p); if (A.ctx) p ? A.ctx.suspend() : A.ctx.resume(); if (!p) lockMouse(); }
function closeNote() { G.noteOpen = false; $('note').classList.add('hidden'); }

function throwFlare() {
  if (P.flares <= 0 || P.hidden) return; P.flares--;
  const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
  const m = new THREE.Group(); const stick = ITEMG.flare.clone(); m.add(stick);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff3018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); glow.scale.set(1.4, 1.4, 1); m.add(glow);
  const ey = P.y + P.eye; m.position.set(P.x + fx * .4, ey - .2, P.z + fz * .4); scene.add(m);
  const f = {m, glow, vx: fx * 10 + P.vx, vy: fy * 10 + 3, vz: fz * 10 + P.vz, t: 32, x: m.position.x, y: m.position.y, z: m.position.z, rest: false};
  G.flares.push(f); G.flaresM.push(m); Snd.flare();
  if (G.flares.length > 2) { const o = G.flares.shift(); scene.remove(o.m); }
}

// ---------------- player update
const _fw = new THREE.Vector3();
function stepPlayer(dt) {
  if (P.hidden) {
    const h = P.hidden; P.x = h.x; P.z = h.z; P.y = h.y; P.vx = P.vz = 0;
    const want = (mouseR || P.holdBreathK) && P.gasp <= 0;
    if (want && P.breath > 0) { P.holdBreath = true; P.breath -= dt / 10; if (P.breath <= 0) { P.breath = 0; P.holdBreath = false; P.gasp = 2.2; Snd.gasp(); noise(P.x, P.z, 9, h.b); } }
    else { P.holdBreath = false; P.breath = Math.min(1, P.breath + dt / 6); }
    P.gasp -= dt;
    $('breath').querySelector('i').style.width = P.breath * 100 + '%';
    return;
  }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  const mag = Math.hypot(fw, st) || 1;
  let run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && P.stam > .02 && !P.crouch;
  if (P.tired && P.stam < .3) run = false; if (P.stam > .3) P.tired = false;
  const sp = P.crouch ? 1.6 : run ? 6.0 : 3.0;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp;
  const acc = (fw || st) ? 9 : 12; P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * acc)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * acc));
  const ox = P.x, oz = P.z; P.x += P.vx * dt; P.z += P.vz * dt;
  pushCircle(P, .33, true, true, true);
  const moved = Math.hypot(P.x - ox, P.z - oz); const v = moved / Math.max(dt, 1e-4);
  if (run && v > 1) { P.stam -= dt / 7; if (P.stam <= 0) { P.stam = 0; P.tired = true; } } else P.stam = Math.min(1, P.stam + dt / (v > .5 ? 11 : 7));
  P.zone = zoneOf(P.x, P.z, -.05);
  const fy = floorY(P.x, P.z, P.zone); P.y = mix(P.y || fy, fy, Math.min(1, dt * 14));
  P.eye = mix(P.eye, P.crouch ? 1.0 : 1.62, Math.min(1, dt * 8));
  // footsteps
  P.stepD += moved; const stride = run ? 1.0 : P.crouch ? .55 : .75;
  P.bob += moved * (run ? 1.25 : 1.6);
  if (P.stepD > stride) { P.stepD = 0; const wood = P.zone >= 0; const k = run ? 1.4 : P.crouch ? .35 : .8; Snd.step(wood, k); noise(P.x, P.z, (run ? 24 : P.crouch ? 2.2 : 8.5) * (wood ? 1.35 : 1), P.zone); }
  // flashlight battery
  if (P.light) { P.bat -= dt / 260; if (P.bat <= 0) { P.bat = 0; P.light = false; showMsg('The flashlight died. Find batteries.', '', 3); } else if (P.bat < .2 && !P.batWarned) { P.batWarned = true; showMsg('The flashlight is getting dim. Turn it off (F) when you can.', '', 3.5); } }
  if (P.bat > .3) P.batWarned = false;
  $('stam').style.opacity = P.stam < .99 ? 1 : 0; $('stam').firstChild.style.width = P.stam * 100 + '%';
}

// ---------------- interaction
function targetInter() {
  const ey = P.y + P.eye; cam.getWorldDirection(_fw); let best = null, bs = 1e9;
  for (const it of INTER) {
    if (it.on && !it.on()) continue; if (it.got) continue;
    if (P.hidden) { if (it.kind !== 'hide' || it.h !== P.hidden) continue; return it; }
    const dx = it.x - P.x, dy = it.y - ey, dz = it.z - P.z, d = Math.hypot(dx, dy, dz); if (d > it.r) continue;
    const dot = (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d; const lim = d < .9 ? .55 : .86; if (dot < lim) continue;
    if (!losClear(P.x, P.z, it.x - dx / d * .3, it.z - dz / d * .3)) continue;
    const sc = (1 - dot) * 4 + d * .15; if (sc < bs) { bs = sc; best = it; }
  }
  return best;
}
function stepInteract(dt) {
  const it = targetInter(); const pr = $('prompt');
  if (!it) { pr.style.opacity = 0; G.hold = 0; G.holdT = null; ePress = false; return; }
  const hold = it.hold ? it.hold() : 0;
  $('pTxt').innerHTML = `<kbd>E</kbd>${it.label()}`; pr.style.opacity = 1;
  $('pBar').style.display = hold ? 'block' : 'none';
  if (hold) {
    if (eDown && !P.hidden) {
      if (G.holdT !== it) { G.holdT = it; G.hold = 0; }
      G.hold += dt; $('pBar').firstChild.style.width = Math.min(100, G.hold / hold * 100) + '%';
      holdTick(it, dt);
      if (G.hold >= hold) { G.hold = 0; G.holdT = null; eDown = false; use(it); }
    } else { G.hold = Math.max(0, G.hold - dt * 2); $('pBar').firstChild.style.width = G.hold / hold * 100 + '%'; if (A.on) A.stat.g.gain.value = 0; }
  } else if (ePress) use(it);
  ePress = false;
}
function holdTick(it, dt) {
  if (it.kind === 'gen' && Math.random() < dt * 2.2) { Snd.pull(); noise(P.x, P.z, 14, P.zone); }
  if (it.kind === 'radio' && A.on) { A.stat.g.gain.value = .05 + Math.random() * .04; if (Math.random() < dt * .8) noise(P.x, P.z, 22, P.zone); }
}
function use(it) {
  const k = it.kind;
  if (it.item) {
    if (k === 'note') { G.noteOpen = true; $('noteT').textContent = it.text; $('note').classList.remove('hidden'); return; }
    it.got = true; scene.remove(it.mesh); Snd.pickup(); noise(P.x, P.z, 3, P.zone);
    if (k === 'fuse') { P.fuses++; showMsg(`Picked up a fuse (${P.fuses + G.inserted} of 3)`); if (G.obj === 'fuse' || G.obj === 'gen') setObj('fuse'); }
    if (k === 'battery') { P.bat = Math.min(1, P.bat + .5); showMsg('Fresh batteries. The flashlight is brighter.'); }
    if (k === 'flare') { P.flares++; showMsg('Picked up a road flare. Throw it with G.'); }
    return;
  }
  if (k === 'hide') {
    if (P.hidden) { const h = P.hidden; P.hidden = null; P.x = h.ex; P.z = h.ez; P.light = P.lightWas && P.bat > 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); Snd.creak(); noise(P.x, P.z, 5, h.b); }
    else {
      const h = it.h; P.hidden = h; P.lightWas = P.light; P.light = false; P.yaw = h.yaw; P.pitch = 0; P.crouch = false;
      $('slats').classList.remove('hidden'); $('breath').classList.remove('hidden'); Snd.creak();
      // did it see you get in?
      if (M.state === 'chase' && G.t - M.seenAt < 1.2) M.sawHide = h; else noise(P.x, P.z, 4, h.b);
    }
    return;
  }
  if (k === 'gen') {
    if (G.power) return;
    if (G.obj === 'start') { startPower(); return; }
    if (P.fuses > 0) { while (P.fuses > 0 && G.inserted < 3) { P.fuses--; G.slots[G.inserted].visible = true; G.inserted++; } Snd.clunk(); noise(P.x, P.z, 10, P.zone);
      if (G.inserted >= 3) { setObj('start'); showMsg('All three fuses are in.'); } else { setObj('fuse'); showMsg(`${G.inserted} of 3 fuses in.`); } }
    else { if (G.obj === 'radio0' || G.obj === 'gen') setObj('fuse'); showMsg('The fuse panel is empty. Somebody pulled all three.'); }
    return;
  }
  if (k === 'radio') {
    if (!G.power) { Snd.click(); showMsg('Dead. No power. There has to be a generator somewhere in the camp.'); if (G.obj === 'radio0') setObj('gen'); return; }
    if (G.obj === 'call') { callRadio(); return; }
    Snd.staticHit(); return;
  }
  if (k === 'truck') win();
}
function startPower() {
  G.power = true; setObj('call'); Snd.clunk();
  MAT.glass.emissiveIntensity = .75; MAT.bulb.emissiveIntensity = 3; for (const s of G.lampGlow) s.visible = true;
  showMsg('The generator coughs, then roars. Lights flicker on across the camp.');
  if (A.on) { A.genG.gain.value = .5; }
  noise(P.x, P.z, 90, P.zone);
  G.stingAt = G.t + 1.8;
  // it comes for the noise, fast
  M.hintT = 4;
}
function callRadio() {
  G.radioDone = true; if (A.on) A.stat.g.gain.value = 0;
  const lines = ['This is County Dispatch. Who is on this channel?', 'Whisperpine? Nobody is supposed to be up there. That place has been shut since eighty nine.', 'Okay. Okay, hold on. I am sending a truck up the county road. Get to the main gate.', 'And keep quiet out there. Whatever you do, do not let it hear you.'];
  G.radioQ = lines.map((l, i) => [G.t + i * 5.2, l]);
  G.timer = D.escape; setObj('escape');
  noise(P.x, P.z, 40, P.zone);
}

// ---------------- creature brain
function seesPlayer() {
  if (P.hidden) return 0;
  const dx = P.x - M.x, dz = P.z - M.z, d = Math.hypot(dx, dz);
  let range = D.sight * (P.light ? 1 : .42) * (P.crouch ? .65 : 1) * (Math.hypot(P.vx, P.vz) < .3 ? .75 : 1);
  if (G.power) for (const l of LAMPS) if (Math.hypot(P.x - l[0], P.z - l[2]) < 9) { range = Math.max(range, D.sight * .8); break; }
  const beam = P.light && d < 40 && beamHits(M.x, M.y + 2, M.z);
  if (beam) range = Math.max(range, 42);
  if (d > range) return 0;
  const fa = Math.atan2(-dx, -dz); if (d > 3.5 && !beam && Math.abs(angD(M.yaw, fa)) > 1.25) return 0;
  if (!losClear(M.x, M.z, P.x, P.z)) return 0;
  const f = foliage(M.x, M.z, P.x, P.z); if (f < .3) return 0;
  return clamp(1.4 - d / range, .1, 1.4) * f * (beam ? 1.6 : 1);
}
function beamHits(x, y, z) {
  const ey = P.y + P.eye, dx = x - P.x, dy = y - ey, dz = z - P.z, d = Math.hypot(dx, dy, dz); cam.getWorldDirection(_fw);
  return (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d > Math.cos(.4);
}
function playerSeesMon() {
  const ey = P.y + P.eye, dx = M.x - P.x, dz = M.z - P.z, d = Math.hypot(dx, dz);
  cam.getWorldDirection(_fw); const dot = (dx * _fw.x + (M.y + 1.8 - ey) * _fw.y + dz * _fw.z) / Math.hypot(dx, M.y + 1.8 - ey, dz);
  if (dot < .8) return 0; if (!losClear(P.x, P.z, M.x, M.z)) return 0;
  const lit = (P.light && d < 36 && dot > Math.cos(.42)) || d < 10 || G.power && d < 22;
  return lit ? 1 : d < 18 ? .5 : 0;
}
function pickRoam() {
  const pts = []; for (const b of BLD) pts.push([...b.dfront, -1], [...b.din, b.i]);
  for (const k of ['tent', 'bus', 'tower', 'archery', 'well']) for (const s of SPOTS[k] || []) pts.push([s.x + 2, s.z + 2, -1]);
  const R0 = D.roam * (G.radioDone ? .6 : G.power ? .8 : 1);
  const away = M.avoidT > 0;
  const near = pts.filter(p => { const d = Math.hypot(p[0] - P.x, p[1] - P.z); return away ? d > 30 && d < 70 : d < R0; });
  if (!away && (WR() < .5 || !near.length)) { // random spot near the player
    for (let k = 0; k < 20; k++) { const a = WR() * TAU, r = 10 + WR() * R0; const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r; if (Math.abs(x) < WS - 10 && Math.abs(z) < WS - 10 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 2 && zoneOf(x, z, -1) < 0) { goTo(x, z, -1); return; } }
  }
  const p = (near.length ? near : pts)[Math.floor(WR() * (near.length || pts.length))]; goTo(p[0], p[1], p[2]);
}
function teleportNear(minR, maxR, front) {
  for (let k = 0; k < 40; k++) {
    const a = front ? P.yaw + PI + (WR() - .5) * 1.4 : WR() * TAU, r = minR + WR() * (maxR - minR);
    const x = P.x - Math.sin(a) * r * (front ? -1 : 1), z = P.z - Math.cos(a) * r * (front ? -1 : 1);
    if (Math.abs(x) > WS - 10 || Math.abs(z) > WS - 10 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3 || zoneOf(x, z, -1.5) >= 0) continue;
    let bad = false; for (const o of OBST) if (inRect(x, z, o, .5)) bad = true; if (bad) continue;
    const vis = losClear(P.x, P.z, x, z) && foliage(P.x, P.z, x, z) > .35;
    if (front ? !vis : vis && !front) continue;
    if (!front) { cam.getWorldDirection(_fw); const dd = Math.hypot(x - P.x, z - P.z); if (((x - P.x) * _fw.x + (z - P.z) * _fw.z) / dd > .2) continue; }
    M.x = x; M.z = z; M.y = gH(x, z); M.zone = -1; M.path = []; return true;
  }
  return false;
}
function stepCreature(dt) {
  if (M.state === 'kill') return;
  M.zone = zoneOf(M.x, M.z, -.1);
  M.y = mix(M.y, floorY(M.x, M.z, M.zone), Math.min(1, dt * 10));
  const dP = Math.hypot(P.x - M.x, P.z - M.z);
  const prog = G.inserted * .03 + (G.power ? .06 : 0) + (G.radioDone ? .06 : 0);
  // flares
  for (const f of G.flares) if (f.t > 0 && Math.hypot(f.x - M.x, f.z - M.z) < 9.5 && M.state !== 'flee') { M.state = 'flee'; M.flee = 6; const ax = M.x - f.x, az = M.z - f.z, l = Math.hypot(ax, az) || 1; goTo(clamp(M.x + ax / l * 30, -WS + 10, WS - 10), clamp(M.z + az / l * 30, -WS + 10, WS - 10), -1); Snd.creak(); break; }
  // senses
  let see = 0; M.senseT = (M.senseT || 0) - dt;
  if (M.senseT <= 0) { M.senseT = .12; M.lastSee = seesPlayer(); }
  see = M.state === 'stalk' || M.state === 'flee' ? 0 : M.lastSee;
  if (see > 0) { M.aware = Math.min(1.5, M.aware + dt * see / D.react); } else M.aware = Math.max(0, M.aware - dt * .25);
  if (see > 0 && (M.aware >= 1 || dP < 5)) {
    if (M.state !== 'chase') { M.state = 'chase'; if (G.t - M.screamT > 9) { M.screamT = G.t; Snd.stinger(); burst(900, 1, .4, .8, 'bandpass', A.mPan, .5); } }
    M.lx = P.x; M.lz = P.z; M.lzone = P.zone; M.lostT = 0; M.seenAt = G.t; M.sawHide = null;
  }
  // final phase hints: it always drifts toward you
  if (G.obj === 'escape' && D.hint) { M.hintT -= dt; if (M.hintT <= 0) { M.hintT = D.hint * (.7 + WR() * .6); if (M.state === 'roam' || M.state === 'inv') noise(P.x + (WR() - .5) * 16, P.z + (WR() - .5) * 16, 999); } }
  else if (G.power && M.hintT > 0) { M.hintT -= dt; if (M.hintT <= 0 && (M.state === 'roam')) { M.hintT = -1; noise(G.shed.dout[0], G.shed.dout[1], 999, -1); } }
  let speed = 1.7; M.avoidT = (M.avoidT || 0) - dt;
  switch (M.state) {
    case 'roam': {
      if (!M.path.length) { M.idle -= dt; M.look = Math.sin(G.t * 1.3) * .3; if (M.idle <= 0) { pickRoam(); M.idle = 1.5 + WR() * 4; } }
      speed = (M.avoidT > 0 ? 2.6 : 1.6) + prog * 4;
      // stalking glimpses early in the night
      if (!G.power && G.inserted < 2) { M.stalkT -= dt; if (M.stalkT <= 0) { M.stalkT = 55 + WR() * 40; if (dP > 40 && P.zone < 0 && !P.hidden && teleportNear(30, 42, true)) { M.state = 'stalk'; M.stalkTime = 0; M.stalkSeen = 0; M.path = []; } } }
      // too far for too long: move in behind
      if (dP > 80 && G.t > 90) { M.far += dt; if (M.far > 22) { M.far = 0; if (teleportNear(42, 58, false)) M.path = []; } } else M.far = 0;
      break;
    }
    case 'inv': {
      speed = 3.1 + prog * 5;
      if (moveAlongDone(dt, speed)) {
        if (M.invZone >= 0 && BLD[M.invZone].hides.length) { startSearch(M.invZone); break; }
        M.idle += dt; M.look = Math.sin(G.t * 2) * .5; if (M.idle > 3.5) { M.state = 'roam'; M.idle = 1; M.avoidT = 12; }
      }
      return finish(dt);
    }
    case 'chase': {
      speed = D.chase * (1 + prog);
      if (P.hidden && M.sawHide === P.hidden) { const h = P.hidden; M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .3; goTo(h.ex, h.ez, h.b); } if (Math.hypot(M.x - h.ex, M.z - h.ez) < 1.1 || Math.hypot(M.x - h.x, M.z - h.z) < 1.3) { die('pulled'); return; } }
      else {
        if (see > 0) { M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .25; goTo(P.x, P.z, P.zone); } }
        else { M.lostT += dt; if (!M.path.length || M.lostT < .1) goTo(M.lx, M.lz, M.lzone); if (M.lostT > D.lost) { // lost you: search around where you went
          const z = M.lzone; if (z >= 0 && BLD[z].hides.length) startSearch(z, true); else { M.state = 'inv'; M.idle = 0; M.invZone = -1; const vx = P.x - M.lx, vz = P.z - M.lz; goTo(M.lx + clamp(vx, -8, 8), M.lz + clamp(vz, -8, 8)); } } }
        if (dP < 1.25 && !P.hidden && Math.abs((P.y) - M.y) < 1.5 && losClear(M.x, M.z, P.x, P.z)) { die('caught'); return; }
      }
      break;
    }
    case 'search': {
      speed = 2.4 + prog * 4;
      if (M.chkT > 0) { // opening a wardrobe
        M.chkT -= dt; M.spd = 0; const h = M.chkH; M.yaw += angD(M.yaw, Math.atan2(-(h.x - M.x), -(h.z - M.z))) * Math.min(1, dt * 6);
        if (M.chkT <= .9 && !M.chkDone) { M.chkDone = true; Snd.creak(); if (P.hidden === h && !P.holdBreath) { die('pulled'); return; } }
        if (M.chkT <= 0) nextCheck();
        return finish(dt);
      }
      if (moveAlongDone(dt, speed)) { if (M.chkH) { M.chkT = 1.8; M.chkDone = false; } else nextCheck(); }
      // breathing gives you away
      if (P.hidden && !P.holdBreath && Math.hypot(P.x - M.x, P.z - M.z) < 3.2 && WR() < dt * D.breathHear * 2 && M.chkH !== P.hidden) { M.chk.unshift(P.hidden); nextCheck(); }
      return finish(dt);
    }
    case 'stalk': {
      M.spd = 0; M.yaw += angD(M.yaw, Math.atan2(-(P.x - M.x), -(P.z - M.z))) * Math.min(1, dt * 4); M.stalkTime += dt;
      const s = playerSeesMon(); if (s) M.stalkSeen += dt * s;
      if (M.stalkSeen > 1.1 || M.stalkTime > 16 || dP < 20) { if (M.stalkSeen > 1.1) Snd.stinger(); M.state = 'roam'; teleportNear(60, 80, false); M.path = []; M.idle = 6; }
      return finish(dt);
    }
    case 'flee': {
      speed = 5.4; M.flee -= dt; if (M.flee <= 0) { M.state = 'roam'; M.idle = 3; }
      break;
    }
  }
  moveAlong(dt, speed);
  return finish(dt);
}
function moveAlongDone(dt, speed) { return moveAlong(dt, speed); }
function startSearch(z, fast) {
  const b = BLD[z]; M.state = 'search'; M.chk = b.hides.filter(h => (M.sawHide === h) || WR() < D.checkP * (fast ? 1.3 : 1));
  if (P.hidden && P.hidden.b === z && fast && !M.chk.includes(P.hidden) && WR() < D.checkP) M.chk.push(P.hidden);
  M.chk.sort(() => WR() - .5); M.chkH = null; M.chkT = 0;
  goTo(...b.din, z); M.path.push([b.x + (WR() - .5) * b.w * .4, b.z + (WR() - .5) * b.d * .4]);
  M.searchZ = z; M.firstLeg = true;
  if (!M.chk.length) { M.chkH = null; } else nextCheck();
}
function nextCheck() {
  M.chkT = 0; M.chkH = M.chk.shift() || null; M.chkDone = false;
  if (M.chkH) goTo(M.chkH.ex, M.chkH.ez, M.chkH.b); else { M.state = 'roam'; M.idle = 0; M.avoidT = 25; M.path = []; pickRoam(); }
}
function finish(dt) {
  // stuck detection
  M.stuck += dt; if (M.stuck > 2.5) { if (Math.hypot(M.x - M.sx, M.z - M.sz) < .6 && M.path.length && M.state !== 'stalk') { M.path = []; if (M.goal) { M.x += (WR() - .5) * .6; M.z += (WR() - .5) * .6; plan(M.goal[0], M.goal[1], M.goal[2]); } } M.stuck = 0; M.sx = M.x; M.sz = M.z; }
  // bumped into you without chasing
  if (!P.hidden && Math.hypot(P.x - M.x, P.z - M.z) < 1.0 && M.state !== 'flee' && M.state !== 'stalk') die('caught');
  // footsteps
  M.stepAcc = (M.stepAcc || 0) + M.spd * dt; if (M.stepAcc > 1.3) { M.stepAcc = 0; const d = Math.hypot(P.x - M.x, P.z - M.z); if (d < 40) Snd.mStep(clamp(1.2 - d / 40, .1, 1) * (M.state === 'chase' ? 1.5 : 1)); }
}

// ---------------- world step
function stepWorld(dt) {
  G.t += dt;
  // radio lines and the power-on stinger run on game time (they pause with the game and never leak into the next run)
  while (G.radioQ.length && G.t >= G.radioQ[0][0]) { Snd.staticHit(); say(G.radioQ.shift()[1], 'RADIO'); }
  if (G.stingAt && G.t >= G.stingAt) { G.stingAt = 0; Snd.stinger(); }
  // it calls out from far away now and then: you hear roughly where it is
  M.callT -= dt; if (M.callT <= 0) { M.callT = 50 + WR() * 50; const d = Math.hypot(P.x - M.x, P.z - M.z); if ((M.state === 'roam' || M.state === 'inv') && d > 45 && d < 140) Snd.call(M.x, M.y + 2.5, M.z); else M.callT = 12; }
  // flares
  for (let i = 0; i < G.flares.length; i++) {
    const f = G.flares[i];
    if (!f.rest) { f.vy -= 9.8 * dt; const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt; if (!losClear(f.x, f.z, nx, nz)) { f.vx *= -.3; f.vz *= -.3; } else { f.x = nx; f.z = nz; } f.y += f.vy * dt;
      const zz = zoneOf(f.x, f.z), gy = floorY(f.x, f.z, zz) + .03; if (f.y < gy) { f.y = gy; f.vy *= -.25; f.vx *= .5; f.vz *= .5; if (Math.hypot(f.vx, f.vz) < .5) { f.rest = true; noise(f.x, f.z, 10); } } }
    f.t -= dt; f.m.position.set(f.x, f.y, f.z); f.m.rotation.set(0, 0, f.rest ? PI / 2 : G.t * 9);
    const on = f.t > 0, fl = .8 + Math.random() * .4; FLL[i].intensity = on ? 16 * fl * Math.min(1, f.t / 3) : 0; FLL[i].position.set(f.x, f.y + .35, f.z);
    f.glow.material.opacity = on ? .8 * fl : 0; f.glow.position.y = .1;
  }
  for (let i = G.flares.length; i < 2; i++) FLL[i].intensity = 0;
  // escape timer + truck
  if (G.obj === 'escape') {
    if (G.timer > 0) { G.timer -= dt; if (G.timer <= 14 && !G.truck) { G.truck = {z: -175, arrived: false}; G.truckM.visible = true; } if (G.timer <= 0) { G.timer = 0; } }
    if (G.truck) { const tr = G.truck; const stop = -143; if (!tr.arrived) { tr.z = Math.min(stop, tr.z + dt * Math.max(2, (stop - tr.z) * .35 + 2)); if (stop - tr.z < .05 && G.timer <= 0) { tr.arrived = true; Snd.horn(); noise(GATE.x, GATE.z, 70); showMsg('Headlights at the gate. The truck is here!'); } }
      const x = 1.6, y = gH(x, tr.z); G.truckM.position.set(x, y, tr.z); truckL.position.set(x, y + 1.2, tr.z + 2.7); truckL.target.position.set(x, y, tr.z + 30); truckL.intensity = 140;
      const ti = INTER.find(i => i.kind === 'truck'); ti.x = x - 1.2; ti.y = y + 1.4; ti.z = tr.z + .9;
      if (A.on) { A.truckG.gain.value = .25; setPan(A.tPan, x, y + 1, tr.z); }
    }
  }
  // camp lights: nearest powered sources get the real point lights
  if (G.power) {
    G.poolT = (G.poolT || 0) - dt;
    if (G.poolT <= 0) { G.poolT = .4; const src = []; for (const b of BLD) if (b.lights) for (const l of b.lights) src.push([l[0], b.fy + b.wh - .4, l[1], 1]); for (const l of LAMPS) src.push([l[0], l[1], l[2], 1.4]);
      src.sort((a, b) => Math.hypot(a[0] - P.x, a[2] - P.z) - Math.hypot(b[0] - P.x, b[2] - P.z));
      POOL.forEach((l, i) => { const s = src[i]; if (!s) { l.intensity = 0; return; } l.position.set(s[0], s[1], s[2]); l.userData.k = s[3]; });
    }
    const fl = 1 - (Math.random() < .02 ? .5 : 0);
    POOL.forEach(l => l.intensity = 28 * (l.userData.k || 1) * fl);
    if (A.on) setPan(A.gPan, G.shed.gen[0], G.shed.fy + .6, G.shed.gen[1]);
  }
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').style.opacity = 0; }
  if (G.objT > 0) { G.objT -= dt; if (G.objT <= 0 && G.obj !== 'escape') $('obj').style.opacity = .35; }
  const ot = objText(); if (ot !== objLast) { objLast = ot; $('obj').innerHTML = '<small>Objective</small>' + ot; }
}
function setPan(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }

// ---------------- fear, audio mix, HUD
let heartT = 0;
function stepFear(dt) {
  const d = Math.hypot(P.x - M.x, P.z - M.z);
  const s = playerSeesMon();
  let f = clamp(1 - d / 30, 0, 1) * .6 + (M.state === 'chase' ? .45 : 0) + s * clamp(1 - d / 45, 0, 1) * .4;
  if (M.state === 'stalk') f = Math.max(f, s * .5);
  P.fear = mix(P.fear, clamp(f, 0, 1), Math.min(1, dt * (f > P.fear ? 3 : .6)));
  heartT -= dt; if (P.fear > .2 && heartT <= 0) { heartT = 60 / (60 + P.fear * 110); Snd.heart(P.fear); }
  $('fearV').style.opacity = clamp((P.fear - .25) * 1.2, 0, .9);
  if (A.on) {
    const c = A.ctx, t = c.currentTime;
    A.crick.gain.setTargetAtTime(d < 35 || G.obj === 'escape' ? 0 : .006, t, .8);
    A.drone.gain.setTargetAtTime(M.state === 'chase' ? .05 : 0, t, M.state === 'chase' ? .3 : 1.5);
    A.droneF.frequency.setTargetAtTime(M.state === 'chase' ? 900 : 300, t, 1);
    const near = clamp(1 - d / 25, 0, 1);
    A.mBreath.g.gain.setTargetAtTime(.25 * (M.state === 'chase' ? 1.6 : 1) * (.5 + .5 * Math.sin(G.t * (M.state === 'chase' ? 9 : 2.5))), t, .05);
    A.mGrowl.gain.setTargetAtTime(M.state === 'chase' ? .5 : M.state === 'search' ? .25 : .08 * near, t, .2);
    A.mSaw.frequency.setTargetAtTime(M.state === 'chase' ? 62 : 44, t, .3);
    setPan(A.mPan, M.x, M.y + 2.3, M.z);
    const L = c.listener, ey = P.y + P.eye; cam.getWorldDirection(_fw);
    if (L.positionX) { L.positionX.value = P.x; L.positionY.value = ey; L.positionZ.value = P.z; L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(P.x, ey, P.z); L.setOrientation(_fw.x, _fw.y, _fw.z, 0, 1, 0); }
    A.lp.frequency.setTargetAtTime(P.hidden ? (P.holdBreath ? 480 : 1000) : 20000, t, P.hidden ? .12 : .25);
    A.wind.f.frequency.value = 340 + Math.sin(G.t * .21) * 120; A.wind.g.gain.value = (P.zone >= 0 || P.hidden ? .02 : .05) + Math.sin(G.t * .13) * .02;
  }
}
function hud() {
  const b = $('bat'); const segs = b.children; for (let i = 0; i < 4; i++) segs[i].className = P.bat > i * .25 + .02 ? '' : 'off'; b.classList.toggle('low', P.bat < .25);
  $('nFlare').textContent = P.flares; $('nFuse').textContent = P.fuses;
}

// ---------------- camera, flashlight, render
const VM = new THREE.Group(); cam.add(VM);
(function viewModel() {
  const m = new THREE.MeshStandardMaterial({color: 0x1d1f22, roughness: .4, metalness: .7});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.022, .02, .2, 12), m); body.rotation.x = PI / 2; VM.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.034, .024, .05, 14), m); head.rotation.x = PI / 2; head.position.z = -.12; VM.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.03, 14), new THREE.MeshBasicMaterial({color: 0xfff2d8})); lens.position.z = -.146; VM.add(lens); VM.userData.lens = lens;
  const glove = new THREE.MeshStandardMaterial({color: 0x2c241c, roughness: .9});
  const fist = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), glove); fist.scale.set(1, .85, 1.5); fist.position.set(0, -.012, .02); VM.add(fist);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, .4, 10), new THREE.MeshStandardMaterial({color: 0x30363c, roughness: .95})); arm.rotation.x = PI / 2 - .25; arm.position.set(.03, -.06, .22); VM.add(arm);
  VM.scale.setScalar(.8); VM.position.set(.22, -.21, -.42); VM.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
})();
const swayV = new THREE.Vector3();
function updateCamera(dt) {
  if (G.over && G.deathHow) { deathCam(dt); return; }
  const ey = P.y + P.eye;
  const sp = Math.hypot(P.vx, P.vz);
  const bobA = P.hidden ? 0 : clamp(sp / 6, 0, 1) * .05;
  const shake = P.fear > .5 ? (P.fear - .5) * .006 : 0;
  cam.position.set(P.x, ey + Math.sin(P.bob * 2) * bobA * .6, P.z);
  cam.rotation.set(P.pitch + Math.sin(G.t * 31) * shake, P.yaw + Math.sin(P.bob) * bobA * .05, Math.sin(P.bob) * bobA * .08, 'YXZ');
  cam.fov = mix(cam.fov, 70 + (sp > 4.5 ? 4 : 0), dt * 3); cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  VM.visible = !P.hidden;
  VM.position.set(.22 + Math.sin(P.bob) * bobA * .3, -.21 - Math.abs(Math.cos(P.bob)) * bobA * .3, -.42);
  // flashlight: lags the view a little
  cam.getWorldDirection(_fw);
  swayV.lerp(_fw, Math.min(1, dt * 14));
  const on = P.light && !P.hidden;
  let k = on ? .55 + .45 * Math.min(1, P.bat * 3) : 0;
  const near = Math.hypot(P.x - M.x, P.z - M.z);
  if (on && (P.bat < .15 || near < 13 || M.state === 'chase' && near < 22)) { if (Math.random() < .25) k *= Math.random() < .5 ? .05 : .5; }
  flash.intensity = 70 * k;
  VM.userData.lens.material.color.setScalar(on ? .4 + k : .05);
  _v.set(.2, -.19, -.62).applyQuaternion(cam.quaternion).add(cam.position);
  flash.position.copy(_v); flash.target.position.copy(_v).addScaledVector(swayV, 10);
  // moon follows the player; shadow refresh every few metres
  moon.position.set(P.x + MOONDIR.x * 100, P.y + MOONDIR.y * 100, P.z + MOONDIR.z * 100); moon.target.position.set(P.x, P.y, P.z);
  if (!G.shadowAt || Math.hypot(P.x - G.shadowAt[0], P.z - G.shadowAt[1]) > 6) { G.shadowAt = [P.x, P.z]; moon.shadow.needsUpdate = true; }
  const sky = scene.userData.sky; sky.position.copy(cam.position); scene.userData.stars.position.copy(cam.position);
  scene.userData.moon.position.copy(cam.position).addScaledVector(MOONDIR, 450);
}
function deathCam(dt) {
  G.deathT += dt; const t = G.deathT;
  const hx = M.x, hy = M.y + 2.45, hz = M.z;
  const ey = P.y + (G.deathHow === 'pulled' ? 1.2 : 1.45);
  cam.position.set(P.x + Math.sin(t * 40) * .02 * Math.max(0, 1 - t), ey - t * .15, P.z);
  _v.set(hx, hy - .25, hz); const q0 = cam.quaternion.clone(); cam.lookAt(_v); const q1 = cam.quaternion.clone(); cam.quaternion.copy(q0).slerp(q1, Math.min(1, dt * 14));
  flash.intensity = Math.random() < .5 ? 60 : 0; flash.position.copy(cam.position); flash.target.position.set(hx, hy, hz);
  MJ.sh1.rotation.x = MJ['sh-1'].rotation.x = -1.6; MJ.head.rotation.z = Math.sin(t * 25) * .2; MJ.mouth.scale.y = 4;
  M.y = floorY(M.x, M.z, zoneOf(M.x, M.z)) - Math.min(.5, t * .4);
  $('flash').style.opacity = Math.max(0, .6 - t * .5) * (Math.random() < .5 ? 1 : .4);
  if (t > 1.3) $('black').style.opacity = 1;
  if (t > 2.8 && !G.endShown) { G.endShown = true; endScreen(false); }
  VM.visible = false;
}
let grainT = 0; const gctx = $('grain').getContext('2d'), gimg = gctx.createImageData(200, 120);
function grain() { const d = gimg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gctx.putImageData(gimg, 0, 0); $('grain').style.opacity = .06 + P.fear * .12; }

function step(dt) {
  stepPlayer(dt);
  if (!G.over) stepInteract(dt);
  stepCreature(dt); animCreature(dt);
  stepWorld(dt); stepFear(dt); hud();
}
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, Math.max(0, (t - last) / 1000)); last = t;
  if (!BUILT) return;
  if (G.on && !G.paused && !G.noteOpen) { if (!G.over) step(dt); else { G.deathT !== undefined && animCreature(dt * .3); } }
  if (G.on || G.over) updateCamera(dt);
  if (G.map) drawMap();
  if ((grainT += dt) > .05) { grainT = 0; grain(); }
  if (G.on || G.over || !G.drawn) { G.drawn = true; RND.render(scene, cam); }
}

// ---------------- camp map (Tab)
function drawMap() {
  const c = $('map'), g = c.getContext('2d'), W = c.width, S = W / 300, X = x => W / 2 + x * S, Z = z => W / 2 - (z + 20) * S;
  g.fillStyle = '#c9bc9a'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(80,60,30,${Math.random() * .08})`; g.fillRect(Math.random() * W, Math.random() * W, 2, 2); }
  g.fillStyle = 'rgba(60,80,50,.35)'; for (const t of TREES) if ((t.x * 7 + t.z) % 3 < 1) { g.beginPath(); g.arc(X(t.x), Z(t.z), 2.2, 0, TAU); g.fill(); }
  g.fillStyle = '#7a8c96'; g.beginPath(); g.arc(X(LAKE.x), Z(LAKE.z), LAKE.r * S, 0, TAU); g.fill();
  g.strokeStyle = '#8a6a44'; g.lineWidth = 6 * S; g.beginPath(); ROAD.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke();
  g.fillStyle = '#3a2a1c'; g.font = '13px Georgia'; g.textAlign = 'center';
  for (const b of BLD) { g.save(); g.translate(X(b.x), Z(b.z)); g.rotate(b.th); g.fillRect(-b.w / 2 * S, -b.d / 2 * S, b.w * S, b.d * S); g.restore(); g.fillText(b.name, X(b.x), Z(b.z) - Math.max(b.w, b.d) / 2 * S - 4); }
  const lab = (t, x, z) => g.fillText(t, X(x), Z(z));
  lab('Gate', GATE.x - 14, GATE.z); lab('Lake', LAKE.x, LAKE.z); lab('Old bus', 62, -50); lab('Tent site', -62, -60); lab('Watchtower', -72, 64); lab('Archery', 44, -16); lab('Well', -28, 65); lab('Fire pit', 0, 8);
  g.font = 'italic 22px Georgia'; g.fillText('CAMP WHISPERPINE', W / 2, 34); g.font = '12px Georgia'; g.fillText('Tab: close', W / 2, W - 14);
  // you
  const tg = {radio0: G.rng.dout, call: G.rng.dout, gen: G.shed.dout, fuse: P.fuses ? G.shed.dout : null, start: G.shed.dout, escape: [GATE.x, GATE.z]}[G.obj];
  if (tg) { const pu = 1 + Math.sin(performance.now() / 260) * .18; g.strokeStyle = '#8a1a10'; g.lineWidth = 2.5; g.beginPath(); g.arc(X(tg[0]), Z(tg[1]), 15 * pu, 0, TAU); g.stroke(); g.fillStyle = '#8a1a10'; g.font = 'italic 12px Georgia'; g.fillText('objective', X(tg[0]), Z(tg[1]) + 30); }
  g.save(); g.translate(X(P.x), Z(P.z)); g.rotate(P.yaw + PI); g.fillStyle = '#8a1a10'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore();
}

// ---------------- menu
function menuInit() {
  document.querySelectorAll('.seg').forEach(s => {
    const k = s.dataset.k; const upd = () => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === SET[k]));
    s.querySelectorAll('button').forEach(b => b.onclick = () => { SET[k] = b.dataset.v; saveSet(); upd(); bestLine(); }); upd();
  });
  $('sens').value = SET.sens; $('sens').oninput = e => { SET.sens = +e.target.value; saveSet(); };
  $('bright').value = SET.bright; $('bright').oninput = e => { SET.bright = +e.target.value; saveSet(); };
  $('play').onclick = () => { buildWorld(); start(); };
  $('resume').onclick = () => pause(false);
  $('quit').onclick = toMenu; $('endMenu').onclick = toMenu;
  $('again').onclick = () => { $('end').classList.add('hidden'); start(); };
  $('note').onclick = closeNote;
  bestLine();
}
function bestLine() { const b = +localStorage.getItem('wp-best-' + SET.diff) || 0; $('best').textContent = b ? `Best escape on ${SET.diff}: ${Math.floor(b / 60)}:${String(Math.floor(b % 60)).padStart(2, '0')}` : ''; }
function toMenu() { G.run = (G.run || 0) + 1; G.radioQ = []; G.on = false; G.paused = false; G.over = false; $('pause').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); $('slats').classList.add('hidden'); $('fearV').style.opacity = 0; if (A.ctx) { A.ctx.resume(); A.drone.gain.value = 0; A.mGrowl.gain.value = 0; A.mBreath.g.gain.value = 0; A.genG.gain.value = 0; A.truckG.gain.value = 0; } hush(); try { document.exitPointerLock(); } catch (e) {} bestLine(); }

menuInit();
setTimeout(() => { buildWorld(); requestAnimationFrame(frame); }, 30);
if (TEST) window.__WP = {G, P, M, K, SET, BLD, HIDES, INTER, SPOTS, WALLS, start, step, buildWorld, use, die, cam, scene, RND, noise, startPower, callRadio, goTo, zoneOf, flash, set eDown(v) { eDown = v; }, set mouseR(v) { mouseR = v; }};
