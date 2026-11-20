'use strict';
// world: Fort Brine. A big island with a ruined fort on its plateau (0, -30), two arms that close a bay to the south,
// a red dock on the west arm and a blue dock on the east arm, watchtowers on the arm tips, a pillbox on the back beach.
// x east, z south, y up, sea level 0. Colliders: axis-aligned boxes (BOX), vertical cylinders (CIRC), ladders (LAD).
const ARENA = {R: 235, FY: 9}; // play radius, fort ground height
const BOX = [], CIRC = [], LAD = [], BKT = {};
const bucket = k => BKT[k] || (BKT[k] = []);

// ---------------- terrain (analytic, baked into a 2 m grid that the mesh and every height query share)
function terrRaw(x, z) {
  const d = Math.hypot(x / 92, (z + 30) / 66);
  let h = mix(-16, 9.4, 1 - smooth((d - .36) / .74));
  for (const s of [-1, 1]) { const ax = s * 60, az = -2, bx = s * 55, bz = 88, L2 = (bx - ax) ** 2 + (bz - az) ** 2, t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2, 0, 1);
    const da = Math.hypot(x - mix(ax, bx, t), z - mix(az, bz, t)) / (19 - 6 * t); h = Math.max(h, mix(-16, mix(4.6, 2.6, t), 1 - smooth((da - .25) / .95))); }
  const db = Math.hypot(x / 40, (z - 58) / 38); if (db < 1.3) h = mix(Math.min(h, -7.5), h, smooth((db - .75) / .55));
  h += (fbm(x * .045 + 3, z * .045) - .5) * 3.4 * clamp((h + 3) / 8, 0, 1);
  // the fort plateau and the dock landings are flat
  const fd = Math.max(Math.abs(x) - 21, Math.abs(z + 30) - 19, 0); h = mix(h, ARENA.FY, 1 - smooth((fd - 1) / 9));
  for (const s of [-1, 1]) { const e = Math.hypot(x - s * 56, z - 40); h = mix(h, 1.7, (1 - smooth((e - 5) / 6)) * (h > -2 ? 1 : 0)); }
  const r = Math.hypot(x, z + 10); if (r > 170) h = mix(h, -22, smooth((r - 170) / 60));
  return h;
}
const TG = {x0: -280, z0: -280, s: 2, n: 281, h: null};
function bakeTerrain() { const n = TG.n, H = TG.h = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = terrRaw(TG.x0 + i * TG.s, TG.z0 + j * TG.s); }
function groundH(x, z) {
  const fx = (x - TG.x0) / TG.s, fz = (z - TG.z0) / TG.s; if (fx < 0 || fz < 0 || fx >= TG.n - 1 || fz >= TG.n - 1) return -22;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, n = TG.n, H = TG.h, a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v); // same triangles as the mesh
}

// ---------------- colliders + their meshes
const GC = 8, GRID = new Map(); // 8 m cells
function gridAdd(o, x0, x1, z0, z1) { for (let i = Math.floor(x0 / GC); i <= Math.floor(x1 / GC); i++) for (let j = Math.floor(z0 / GC); j <= Math.floor(z1 / GC); j++) { const k = i * 1000 + j; let a = GRID.get(k); if (!a) GRID.set(k, a = []); a.push(o); } }
function near(x, z) { return GRID.get(Math.floor(x / GC) * 1000 + Math.floor(z / GC)) || []; }
// a solid box (collider + mesh). see: false = doesn't block bullets (railings)
function box(x0, x1, y0, y1, z0, z1, mk = 'stone', o = {}) {
  const b = Object.assign({x0, x1, y0, y1, z0, z1, see: true}, o); if (!o.nocol) { BOX.push(b); gridAdd(b, x0, x1, z0, z1); }
  if (mk) { const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0, g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, o.tile || 1.6); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); bucket(mk).push(g); }
  return b;
}
const boxC = (x, y, z, sx, sy, sz, mk, o) => box(x - sx / 2, x + sx / 2, y, y + sy, z - sz / 2, z + sz / 2, mk, o);
function circ(x, z, r, y0, y1) { const c = {x, z, r, y0, y1}; CIRC.push(c); gridAdd(c, x - r, x + r, z - r, z + r); return c; }
function geo(mk, g, x, y, z, ry = 0) { g.rotateY(ry); g.translate(x, y, z); bucket(mk).push(g); return g; }
function ladder(x0, x1, z0, z1, y0, y1, face, mk = 'woodD') { LAD.push({x0, x1, z0, z1, y0, y1, face}); // visual rails + rungs along y
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ax = Math.abs(x1 - x0) > Math.abs(z1 - z0), w = ax ? x1 - x0 : z1 - z0;
  for (const s of [-.5, .5]) geo(mk, new THREE.BoxGeometry(.08, y1 - y0, .08), ax ? cx + s * w : cx, (y0 + y1) / 2, ax ? cz : cz + s * w);
  for (let y = y0 + .3; y < y1; y += .35) geo(mk, ax ? new THREE.BoxGeometry(w, .05, .05) : new THREE.BoxGeometry(.05, .05, w), cx, y, cz);
}

// ---------------- map pieces
const SPAWNS = [], PICKS = [], DOCKS = [];
function crate(x, z, s = 1.2, ry = 0, y) { const gy = y ?? groundH(x, z); box(x - s / 2, x + s / 2, gy - .3, gy + s, z - s / 2, z + s / 2, 'crate', {tile: s}); }
function bags(x, z, len, alongX, y) { const gy = y ?? groundH(x, z), hx = alongX ? len / 2 : .4, hz = alongX ? .4 : len / 2; box(x - hx, x + hx, gy - .4, gy + 1.05, z - hz, z + hz, 'bag', {tile: 1.2}); }
function rock(x, z, s, k = 0) { const gy = groundH(x, z), g = new THREE.DodecahedronGeometry(1, 0); g.scale(s * (1 + h2(k, 1) * .4), s * (.55 + h2(k, 2) * .3), s * (1 + h2(k, 3) * .4)); geo('rock', g, x, gy + s * .2, z, h2(k, 4) * 6); circ(x, z, s * .95, gy - 2, gy + s * .75); }
function palm(x, z, k) { const gy = groundH(x, z), lean = .25 + h2(k, 5) * .25, ry = h2(k, 6) * TAU, segs = 6, H = 7 + h2(k, 7) * 3;
  let px = 0, py = 0, pz = 0; for (let i = 0; i < segs; i++) { const t0 = i / segs, t1 = (i + 1) / segs, y0 = H * t0, y1 = H * t1, o0 = lean * H * t0 * t0, o1 = lean * H * t1 * t1, L = Math.hypot(y1 - y0, o1 - o0), g = new THREE.CylinderGeometry(.18 - .07 * t1, .22 - .07 * t0, L, 7, 1, true);
    g.rotateZ(-Math.atan2(o1 - o0, y1 - y0)); g.translate((o0 + o1) / 2, (y0 + y1) / 2, 0); g.rotateY(ry); g.translate(x, gy, z); bucket('trunk').push(g); px = o1; py = y1; }
  const tx = x + Math.cos(ry) * px, tz = z - Math.sin(ry) * px;
  for (let f = 0; f < 8; f++) { const a = f / 8 * TAU + h2(k, f) * .4, g = new THREE.PlaneGeometry(1, 4.2, 1, 4), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = (p.getY(i) + 2.1) / 4.2; p.setY(i, v * 4.2); p.setZ(i, -v * v * 1.8); p.setX(i, p.getX(i) * (1 - v * .7)); } g.computeVertexNormals(); g.rotateX(-PI / 2 + .55); g.rotateY(a); g.translate(tx, gy + py, tz); bucket('leaf').push(g); }
  circ(x, z, .3, gy - 1, gy + H);
}
function buildFort() {
  const Y = ARENA.FY, T = Y + 5, X0 = -20, X1 = 20, Z0 = -48, Z1 = -12, th = 2.4;
  const wall = (x0, x1, z0, z1) => box(x0, x1, Y - 1.5, T, z0, z1, 'stone');
  // curtain walls with gates and breaches
  wall(X0, -3, Z1 - th, Z1); wall(3, X1, Z1 - th, Z1); box(-3, 3, T - 1.4, T, Z1 - th, Z1, 'stone'); // south gate + lintel the walk goes over
  wall(X0, 5, Z0, Z0 + th); wall(11, X1, Z0, Z0 + th); box(5, 11, Y - 1.5, Y + 1.2, Z0, Z0 + th, 'stoneD'); // north breach (rubble you can step over with a jump)
  wall(X0, X0 + th, Z0 + th, -31); wall(X0, X0 + th, -26, Z1 - th); // west side gate
  wall(X1 - th, X1, Z0 + th, -37); wall(X1 - th, X1, -31, Z1 - th); box(X1 - th, X1, Y - 1.5, Y + .9, -37, -31, 'stoneD'); // east breach
  box(X0, X0 + th, T - 1.4, T, -31, -26, 'stone'); // lintel over the west gate
  // parapets with merlons on the outside edge of the wall walk
  const merl = (x0, x1, z0, z1, alongX) => { const L = alongX ? x1 - x0 : z1 - z0; for (let s = 0; s < L - .1; s += 1.6) { const a = s, b = Math.min(L, s + .9); if (alongX) box(x0 + a, x0 + b, T, T + 1.1, z0, z1, 'stone'); else box(x0, x1, T, T + 1.1, z0 + a, z0 + b, 'stone'); } };
  merl(X0 + 3.5, X1 - 3.5, Z1 - .5, Z1, 1); merl(X0 + 3.5, X1 - 3.5, Z0, Z0 + .5, 1); merl(X0, X0 + .5, Z0 + 3.5, Z1 - 3.5, 0); merl(X1 - .5, X1, Z0 + 3.5, Z1 - 3.5, 0);
  // corner bastions: square towers, walk level, a higher lookout on the north-west one
  for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) { box(cx - 3.5, cx + 3.5, Y - 1.5, T, cz - 3.5, cz + 3.5, 'stone'); for (const [a, b, c, d] of [[-3.5, 3.5, -3.5, -3], [-3.5, 3.5, 3, 3.5], [-3.5, -3, -3, 3], [3, 3.5, -3, 3]]) box(cx + a, cx + b, T, T + 1.2, cz + c, cz + d, 'stone', {}); }
  // stairs up to the walk (inside the south and north walls)
  const stairs = (xs, dir, zA, zB) => { for (let i = 0; i < 14; i++) { const xa = xs + dir * i * .55, xb = xa + dir * .55; box(Math.min(xa, xb), Math.max(xa, xb), Y - .5, Y + (i + 1) * .36, zA, zB, 'stoneD', {tile: 1}); } };
  stairs(-4.5, -1, Z1 - th - 2, Z1 - th); stairs(4.5, 1, Z1 - th - 2, Z1 - th); stairs(-4, -1, Z0 + th, Z0 + th + 2); stairs(13, 1, Z0 + th, Z0 + th + 2);
  // the keep: two doors, a ladder to the roof, a hole in the roof
  const kx0 = -6, kx1 = 6, kz0 = -35.5, kz1 = -26.5, kt = .6, KH = Y + 4.2;
  box(kx0, -1.1, Y - .5, KH, kz1 - kt, kz1, 'stone'); box(1.1, kx1, Y - .5, KH, kz1 - kt, kz1, 'stone'); box(-1.1, 1.1, Y + 2.4, KH, kz1 - kt, kz1, 'stone');
  box(kx0, 1.5, Y - .5, KH, kz0, kz0 + kt, 'stone'); box(3.7, kx1, Y - .5, KH, kz0, kz0 + kt, 'stone'); box(1.5, 3.7, Y + 2.4, KH, kz0, kz0 + kt, 'stone');
  box(kx0, kx0 + kt, Y - .5, KH, kz0, kz1, 'stone'); box(kx1 - kt, kx1, Y - .5, Y + 1.1, kz0, kz1, 'stone'); box(kx1 - kt, kx1, Y + 2.2, KH, kz0, kz1, 'stone'); // east window slot
  box(kx0, 1, KH, KH + .4, kz0, kz1, 'woodD'); box(1, kx1, KH, KH + .4, kz0, -30, 'woodD'); box(3.6, kx1, KH, KH + .4, -30, kz1, 'woodD'); box(1, 3.6, KH, KH + .4, -27.4, kz1, 'woodD'); // roof, a hatch at (1..3.6, -30..-27.4)
  for (const [a, b, c, d] of [[kx0, kx1, kz0, kz0 + .4], [kx0, kx1, kz1 - .4, kz1], [kx0, kx0 + .4, kz0, kz1], [kx1 - .4, kx1, kz0, kz1]]) box(a, b, KH + .4, KH + 1.2, c, d, 'stone');
  ladder(1.4, 1.4, -29.4, -28.4, Y, KH + .4, 'e');
  // courtyard cover
  crate(-12, -20); crate(-10.8, -20); crate(-11.4, -20, 1.2, 0, Y + 1.2); crate(12, -42); crate(13.2, -42.3); crate(-14, -40, 1.4);
  bags(-9, -40, 4, true); bags(10, -21, 4, true); bags(-14, -28, 3, false); bags(14, -30, 3, false);
  crate(8, -33, 1.1); crate(-9, -32, 1.1); bags(0, -17.5, 3.5, true);
  // old cannons on the walk
  for (const [x, z, ry] of [[-10, -13, 0], [10, -13, 0], [-19, -38, PI / 2], [19, -20, -PI / 2]]) { const g = new THREE.CylinderGeometry(.22, .3, 2.2, 10); g.rotateX(PI / 2 - .1); geo('dark', g, x, T + .7, z + (ry ? 0 : -.6), ry); boxC(x, T, z + (ry ? 0 : -.8), ry ? 1.6 : 1, .5, ry ? 1 : 1.6, 'woodD'); }
  // a flag pole
  geo('metal', new THREE.CylinderGeometry(.06, .08, 9, 6), 0, KH + 5, -33); circ(0, -33, .1, KH, KH + 9.5);
  const fl = new THREE.PlaneGeometry(2.6, 1.5); fl.translate(1.3, 0, 0); geo('flagN', fl, 0, KH + 8.6, -33); ARENA.flag = fl;
  ARENA.flagGeo = fl;
}
function buildDocks() {
  for (const s of [-1, 1]) { const x0 = s < 0 ? -54 : 30, x1 = s < 0 ? -30 : 54, Y = 1.3, zA = 41, zB = 44.2;
    box(x0, x1, Y - .3, Y, zA, zB, 'wood', {tile: 2});
    for (let x = x0 + .6; x < x1; x += 3) for (const z of [zA + .2, zB - .2]) { geo('woodD', new THREE.CylinderGeometry(.16, .16, 11, 6), x, Y - 5, z); circ(x, z, .2, -12, Y - .3); }
    for (const z of [zA + .1, zB - .1]) for (let x = x0 + 2; x < x1 - 1; x += 4) geo('dark', new THREE.CylinderGeometry(.13, .16, .45, 8), x, Y + .2, z); // bollards
    const ex = s < 0 ? x1 : x0; ladder(ex - s * .2, ex - s * .2, 42.2, 43, -2.5, Y, s < 0 ? 'e' : 'w'); ladder(x0 + 8, x0 + 8.8, s < 0 ? zA - .1 : zB + .1, s < 0 ? zA - .1 : zB + .1, -2.5, Y, s < 0 ? 'n' : 's');
    ladder(x1 - 8.8, x1 - 8, zB + .1, zB + .1, -2.5, Y, 's'); ladder(x1 - 8.8, x1 - 8, zA - .1, zA - .1, -2.5, Y, 'n');
    // boathouse on the landing
    const hx = s * 58, hz = 36; box(hx - 3, hx + 3, 1.2, 4.6, hz - 3.2, hz - 2.8, 'woodD'); box(hx - 3, hx - 2.6, 1.2, 4.6, hz - 3, hz + 2, 'woodD'); box(hx + 2.6, hx + 3, 1.2, 4.6, hz - 3, hz + 2, 'woodD');
    box(hx - 3.2, hx + 3.2, 4.6, 4.9, hz - 3.4, hz + 2.2, 'rust'); crate(hx - 1.5, hz - 1.6); crate(hx + 1.6, hz - 1.6, 1);
    bags(s * 46, 37, 3, true); crate(s * 40, 42.6, 1, 0, Y); crate(s * 33, 42.6, 1.1, 0, Y);
    // team flag on the boathouse
    const fp = new THREE.CylinderGeometry(.05, .06, 4, 6); geo('metal', fp, hx, 6.8, hz - 3); const ff = new THREE.PlaneGeometry(1.8, 1.1); ff.translate(.9, 0, 0); geo(s < 0 ? 'flag0' : 'flag1', ff, hx, 8.2, hz - 3);
    DOCKS.push({s, x: (x0 + x1) / 2, z: 42.6, team: s < 0 ? 0 : 1, moor: [[s * 40, 48.6, s < 0 ? -PI / 2 : PI / 2], [s * 40, 36.6, s < 0 ? -PI / 2 : PI / 2]]});
  }
}
function buildTowers() {
  for (const s of [-1, 1]) { const x = s * 55.5, z = 84, gy = groundH(x, z), P = 11.5;
    for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) { geo('woodD', new THREE.BoxGeometry(.3, P - gy + 1, .3), x + a, (P + gy - 1) / 2, z + b); circ(x + a, z + b, .25, gy - 1, P); }
    box(x - 2.2, x + 2.2, P - .3, P, z - 2.2, z + 2.2, 'wood', {tile: 2});
    for (const [a, b, c, d] of [[-2.2, 2.2, -2.2, -2.05], [-2.2, 2.2, 2.05, 2.2], [-2.2, -2.05, -2.2, 2.2], [2.05, 2.2, -2.2, .6]]) box(x + a, x + b, P, P + 1.05, z + c, z + d, 'woodD');
    box(x - 2.4, x + 2.4, P + 2.6, P + 2.8, z - 2.4, z + 2.4, 'rust', {nocol: 1});
    for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) geo('woodD', new THREE.BoxGeometry(.12, 2.6, .12), x + a, P + 1.3, z + b);
    ladder(x + 2.3, x + 2.3, z + .8, z + 1.6, gy, P + .2, 'e');
    PICKS.push({k: 'sniper', x, y: P + .1, z: z - 1});
  }
}
function buildBits() {
  // pillbox on the back beach
  const px = 34, pz = -78, gy = groundH(px, pz);
  box(px - 4, px + 4, gy - 1, gy + 2.4, pz - 4, pz - 3.4, 'stoneD'); box(px - 4, px - 3.4, gy - 1, gy + 2.4, pz - 3.4, pz + 3.4, 'stoneD'); box(px + 3.4, px + 4, gy - 1, gy + 2.4, pz - 3.4, pz + 3.4, 'stoneD');
  box(px - 4, -1 + px, gy - 1, gy + 2.4, pz + 3.4, pz + 4, 'stoneD'); box(px + 1, px + 4, gy - 1, gy + 2.4, pz + 3.4, pz + 4, 'stoneD'); box(px - 4, px + 4, gy + 1.5, gy + 2.4, pz + 3.4, pz + 4, 'stoneD');
  box(px - 4.2, px + 4.2, gy + 2.4, gy + 2.9, pz - 4.2, pz + 4.2, 'stoneD');
  PICKS.push({k: 'rocket', x: px, y: gy + .1, z: pz});
  // a wrecked fishing boat on the west beach
  const wx = -64, wz = -18, wy = groundH(wx, wz); { const g = new THREE.CylinderGeometry(2, 2, 9, 12, 1, true, 0, PI); g.rotateZ(PI / 2); g.rotateX(.25); geo('rust', g, wx, wy + 1.2, wz, .6); box(wx - 3, wx + 3, wy - .5, wy + 1.4, wz - 1, wz + 1, null); }
  // beach and arm cover
  const C = [[-24, 16], [-12, 20], [6, 21], [22, 17], [-40, 2], [40, -2], [-50, 22], [52, 20], [-58, 60], [58, 62], [-56, 74], [54, 72], [-44, -64], [-10, -82], [12, -86], [-60, -40], [62, -44], [70, -12]];
  C.forEach(([x, z], i) => { const k = i % 3; if (k === 0) { crate(x, z, 1.2, i); crate(x + 1.25, z + .2, 1.1); } else if (k === 1) bags(x, z, 3.5, i % 2 === 0); else rock(x, z, 1.4 + h2(i, 9), i); });
  for (let i = 0; i < 40; i++) { const a = h2(i, 21) * TAU, r = 30 + h2(i, 22) * 55, x = Math.sin(a) * r * 1.2, z = -30 + Math.cos(a) * r; const g = groundH(x, z); if (g < 1.2 || g > 8.8 || (Math.abs(x) < 25 && Math.abs(z + 30) < 22)) continue; rock(x, z, .8 + h2(i, 23) * 1.8, i + 50); }
  let k = 0; for (let i = 0; i < 90 && k < 46; i++) { const a = h2(i, 31) * TAU, r = 25 + h2(i, 32) * 75, x = Math.sin(a) * r * 1.25, z = -30 + Math.cos(a) * r; const g = groundH(x, z); if (g < .9 || g > 8.5 || (Math.abs(x) < 26 && Math.abs(z + 30) < 23) || Math.hypot(Math.abs(x) - 56, z - 38) < 9) continue; palm(x, z, i); k++; }
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const z = 52 + i * 7, x = s * (57 + h2(i, s) * 3), g = groundH(x, z); if (g > .8) palm(x, z, 200 + i + s * 10); }
  // pickups
  PICKS.push({k: 'rocket', x: -3, y: ARENA.FY + 4.6, z: -33.5}, {k: 'lmg', x: 0, y: ARENA.FY, z: -44.5}, {k: 'magnum', x: -30, z: 12}, {k: 'magnum', x: 30, z: 12});
  PICKS.push({k: 'hp', x: -15, y: ARENA.FY, z: -16}, {k: 'hp', x: 15, y: ARENA.FY, z: -44}, {k: 'hp', x: -46, y: 1.3, z: 42.6}, {k: 'hp', x: 46, y: 1.3, z: 42.6}, {k: 'hp', x: 0, z: -80}, {k: 'hp', x: -58, z: 64}, {k: 'hp', x: 58, z: 64});
  PICKS.push({k: 'ammo', x: 15, y: ARENA.FY, z: -16}, {k: 'ammo', x: -15, y: ARENA.FY, z: -44}, {k: 'ammo', x: -36, z: 6}, {k: 'ammo', x: 36, z: 6}, {k: 'ammo', x: 0, z: 18});
  PICKS.push({k: 'nade', x: 0, y: ARENA.FY, z: -22}, {k: 'nade', x: -62, z: -30}, {k: 'nade', x: 62, z: -30});
  for (const p of PICKS) if (p.y == null) p.y = groundH(p.x, p.z);
  // spawn points: [x, z, yaw] (y from the floor), team 0 west, 1 east, null either
  const S = [[-14, -18, PI, 0], [14, -18, PI, 1], [-14, -42, 0, 0], [14, -42, 0, 1], [-30, 10, PI * .1, 0], [30, 10, -PI * .1, 1], [-58, 36, -PI / 2, 0], [58, 36, PI / 2, 1], [-50, 41.2, -PI / 2, 0], [50, 41.2, PI / 2, 1],
    [-57, 66, 0, 0], [57, 66, 0, 1], [-40, -60, PI * .8, 0], [40, -60, -PI * .8, 1], [-66, -20, PI / 2, 0], [66, -20, -PI / 2, 1], [0, -84, PI, null], [0, 19, 0, null], [-36, -30, PI / 2, 0], [36, -30, -PI / 2, 1]];
  for (const [x, z, yaw, t] of S) SPAWNS.push({x, z, yaw, t});
}

// ---------------- meshes
const MESH = {};
function buildTerrainMesh() {
  const n = TG.n, g = new THREE.PlaneGeometry((n - 1) * TG.s, (n - 1) * TG.s, n - 1, n - 1); g.rotateX(-PI / 2); g.translate(TG.x0 + (n - 1) * TG.s / 2, 0, TG.z0 + (n - 1) * TG.s / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = g.attributes.uv, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), h = groundH(x, z); p.setY(i, h); uv.setXY(i, x / 6, z / 6);
    const sl = Math.min(1, Math.hypot(groundH(x + 1.5, z) - groundH(x - 1.5, z), groundH(x, z + 1.5) - groundH(x, z - 1.5)) / 3), nz = fbm(x * .08, z * .08);
    if (h < -1) c.setRGB(.55, .5, .38).multiplyScalar(.75 + clamp((h + 16) / 16, 0, 1) * .3);
    else if (h < 1.6) c.setRGB(.86, .78, .58);
    else c.setRGB(mix(.4, .55, nz), mix(.55, .62, nz), mix(.25, .3, nz));
    if (h > 1 && h < 2.2) c.lerp(new THREE.Color(.8, .74, .55), 1 - (h - 1) / 1.2);
    if (sl > .45 && h > 0) c.lerp(new THREE.Color(.5, .47, .42), smooth((sl - .45) / .3));
    if (Math.max(Math.abs(x) - 21, Math.abs(z + 30) - 19) < 0) c.lerp(new THREE.Color(.55, .52, .44), .6); // trampled courtyard
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const det = ctex(cv(128, 128, (q, w, h) => { q.fillStyle = '#c8c8c8'; q.fillRect(0, 0, w, h); noiseFill(q, w, h, 60); }));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({vertexColors: true, map: det, roughness: .95})); m.receiveShadow = true; scene.add(m); MESH.terr = m;
}
function buildStatic() {
  for (const k in BKT) { if (!BKT[k].length) continue; const m = new THREE.Mesh(mergeGeos(BKT[k]), MAT[k] || (k === 'flag0' ? MAT.flag[0] : k === 'flag1' ? MAT.flag[1] : MAT.stone)); m.castShadow = k !== 'leaf' || true; m.receiveShadow = true; scene.add(m); MESH[k] = m; BKT[k].forEach(q => q.dispose()); BKT[k] = []; }
}
// the sea: one shader plane; depth colour from the terrain height texture, waves, sky reflection, sun glint, its own fog
const WAVE = [[.18, 23, 1.1, .8, .6], [.12, 14, 1.5, -.5, .85], [.07, 8, 2.1, .3, -.95]];
function waterY(x, z, t = G.wt) { let y = 0; for (const [a, l, s, dx, dz] of WAVE) { const k = TAU / l; y += a * Math.sin((x * dx + z * dz) * k + t * s); } return y; }
function buildWater() {
  const n = TG.n, hd = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) hd[i] = clamp(Math.round((TG.h[i] + 24) * 8), 0, 255);
  const ht = new THREE.DataTexture(hd, n, n, THREE.RedFormat); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
  const g = new THREE.PlaneGeometry(1800, 1800, 160, 160); g.rotateX(-PI / 2);
  const U = {t: {value: 0}, sd: {value: SUNDIR}, ht: {value: ht}, hp: {value: new THREE.Vector4(TG.x0, TG.z0, (n - 1) * TG.s, 0)}, fc: {value: FOGC}, fd: {value: scene.fog.density}, W: {value: WAVE.map(w => new THREE.Vector4(...w.slice(0, 4)))}, WZ: {value: new THREE.Vector3(...WAVE.map(w => w[4]))}};
  const m = new THREE.ShaderMaterial({uniforms: U, transparent: true, fog: false,
    vertexShader: `uniform float t; uniform vec4 W[3]; uniform vec3 WZ; varying vec3 vP;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.); float y = 0.; for(int i=0;i<3;i++){ float k = 6.2831853/W[i].y; y += W[i].x*sin((wp.x*W[i].w + wp.z*WZ[i])*k + t*W[i].z); } wp.y += y; vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float t; uniform vec3 sd; uniform sampler2D ht; uniform vec4 hp; uniform vec3 fc; uniform float fd; uniform vec4 W[3]; uniform vec3 WZ; varying vec3 vP;
      void main(){ vec2 dd = vec2(0.); for(int i=0;i<3;i++){ float k = 6.2831853/W[i].y; float c = W[i].x*k*cos((vP.x*W[i].w + vP.z*WZ[i])*k + t*W[i].z); dd += c*vec2(W[i].w, WZ[i]); }
        dd += .06*vec2(sin(vP.x*1.3+t*2.1+sin(vP.z*.9)), cos(vP.z*1.1-t*1.7+sin(vP.x*.7)));
        vec3 n = normalize(vec3(-dd.x, 1., -dd.y)); vec3 v = normalize(cameraPosition - vP); bool under = cameraPosition.y < vP.y; if (under) n = -n;
        vec2 uv = (vP.xz - hp.xy) / hp.z; float h = (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? -24. : texture2D(ht, uv).r*255./8. - 24.; float dep = max(0., -h);
        float fr = pow(1. - max(dot(n, v), 0.), 4.); vec3 sky = mix(vec3(.62,.76,.86), vec3(.25,.48,.78), clamp(reflect(-v,n).y*2.,0.,1.));
        vec3 shal = vec3(.25,.72,.68), deep = vec3(.02,.16,.24); vec3 body = mix(shal, deep, smoothstep(.5, 9., dep));
        vec3 c = mix(body, sky, .15 + .7*fr); float sp = pow(max(dot(reflect(-sd, n), v), 0.), 180.); c += vec3(1.,.9,.7)*sp*2.2;
        float foam = smoothstep(1.1, .1, dep) * (.6 + .4*sin(t*2. + vP.x*.7 + vP.z*.5)); c = mix(c, vec3(.95), foam*.55);
        float a = clamp(mix(.35, .97, smoothstep(.0, 4., dep)) + fr*.3 + foam*.5, 0., 1.);
        if (under) { c = vec3(.15,.4,.45); a = .85; }
        float dist = length(vP - cameraPosition); float f = 1. - exp(-fd*fd*dist*dist); c = mix(c, fc, f);
        gl_FragColor = vec4(c, a); }`});
  const w = new THREE.Mesh(g, m); w.renderOrder = 2; scene.add(w); MESH.water = w;
}
function waterFrame(dt) { G.wt += dt; MESH.water.material.uniforms.t.value = G.wt; MESH.water.position.x = Math.round(cam.position.x / 11.25) * 11.25; MESH.water.position.z = Math.round(cam.position.z / 11.25) * 11.25; }

// ---------------- queries
const STEP = .55;
// highest floor at or below y + STEP (static only)
function floorStatic(x, z, y, r = .2) {
  let best = groundH(x, z); if (best > y + STEP) best = -1e9;
  const L = near(x, z); for (let i = 0; i < L.length; i++) { const b = L[i]; if (b.r != null) continue; if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue; if (b.y1 <= y + STEP && b.y1 > best) best = b.y1; }
  return best;
}
// lowest ceiling above y (head room)
function ceilStatic(x, z, y, r = .2) { let best = 1e9; const L = near(x, z); for (let i = 0; i < L.length; i++) { const b = L[i]; if (b.r != null) continue; if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue; if (b.y0 >= y && b.y0 < best) best = b.y0; } return best; }
// push a body (o.x, o.z, feet y, height h, radius r) out of static boxes and cylinders
function pushStatic(o, r, h) {
  const L = near(o.x, o.z), y = o.y;
  for (let k = 0; k < 2; k++) for (let i = 0; i < L.length; i++) { const b = L[i];
    if (b.r != null) { if (b.y1 < y + .3 || b.y0 > y + h) continue; const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz), m = b.r + r; if (d < m && d > 1e-5) { o.x = b.x + dx / d * m; o.z = b.z + dz / d * m; } continue; }
    if (b.y1 <= y + STEP || b.y0 >= y + h) continue; if (o.x < b.x0 - r || o.x > b.x1 + r || o.z < b.z0 - r || o.z > b.z1 + r) continue;
    const cx = clamp(o.x, b.x0, b.x1), cz = clamp(o.z, b.z0, b.z1), dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) { o.x = cx + dx / d * r; o.z = cz + dz / d * r; } }
    else { const l = o.x - b.x0, rr = b.x1 - o.x, t = o.z - b.z0, bb = b.z1 - o.z, m = Math.min(l, rr, t, bb); if (m === l) o.x = b.x0 - r; else if (m === rr) o.x = b.x1 + r; else if (m === t) o.z = b.z0 - r; else o.z = b.z1 + r; } }
}
function ladderAt(x, z, y) { for (const l of LAD) if (x > Math.min(l.x0, l.x1) - .55 && x < Math.max(l.x0, l.x1) + .55 && z > Math.min(l.z0, l.z1) - .55 && z < Math.max(l.z0, l.z1) + .55 && y > l.y0 - 1.3 && y < l.y1 + .2) return l; return null; }
// ray vs the static world: boxes, cylinders, terrain, optionally the sea surface. returns distance (Infinity if none) and RAYN (normal)
const RAYN = [0, 1, 0];
function rayStatic(o, d, max, water = true) {
  let tb = max;
  for (let i = 0; i < BOX.length; i++) { const b = BOX[i]; if (!b.see) continue; let t0 = 0, t1 = tb, ax = -1;
    for (let a = 0; a < 3; a++) { const oa = o[a], da = d[a], lo = a === 0 ? b.x0 : a === 1 ? b.y0 : b.z0, hi = a === 0 ? b.x1 : a === 1 ? b.y1 : b.z1;
      if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) { t0 = 1e9; break; } continue; }
      let ta = (lo - oa) / da, tc = (hi - oa) / da; if (ta > tc) { const q = ta; ta = tc; tc = q; } if (ta > t0) { t0 = ta; ax = a; } if (tc < t1) t1 = tc; if (t0 > t1) { t0 = 1e9; break; } }
    if (t0 < tb && t0 > 0) { tb = t0; RAYN[0] = RAYN[1] = RAYN[2] = 0; if (ax >= 0) RAYN[ax] = -Math.sign(d[ax]); } }
  for (let i = 0; i < CIRC.length; i++) { const c = CIRC[i], fx = o[0] - c.x, fz = o[2] - c.z, A2 = d[0] * d[0] + d[2] * d[2]; if (A2 < 1e-9) continue; const B2 = fx * d[0] + fz * d[2], C2 = fx * fx + fz * fz - c.r * c.r, D = B2 * B2 - A2 * C2; if (D < 0) continue; const t = (-B2 - Math.sqrt(D)) / A2; if (t > 0 && t < tb) { const y = o[1] + d[1] * t; if (y > c.y0 && y < c.y1) { tb = t; RAYN[0] = (fx + d[0] * t) / c.r; RAYN[1] = 0; RAYN[2] = (fz + d[2] * t) / c.r; } } }
  // terrain: march then bisect
  let prev = 0, st = 1; for (let t = st; t <= tb + st; t += st) { const tt = Math.min(t, tb), x = o[0] + d[0] * tt, y = o[1] + d[1] * tt, z = o[2] + d[2] * tt; if (y < groundH(x, z)) { let a = prev, b = tt; for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (o[1] + d[1] * m < groundH(o[0] + d[0] * m, o[2] + d[2] * m)) b = m; else a = m; } if (b < tb) { tb = b; RAYN[0] = 0; RAYN[1] = 1; RAYN[2] = 0; } break; } prev = tt; if (tt >= tb) break; if (t > 60) st = 2; }
  if (water && o[1] > 0 && d[1] < 0) { const t = -o[1] / d[1]; if (t < tb) { tb = t; RAYN[0] = 0; RAYN[1] = 1; RAYN[2] = 0; RAYN.water = 1; return tb; } }
  RAYN.water = 0; return tb < max ? tb : Infinity;
}
function losStatic(a, b) { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]); if (L < .01) return true; d[0] /= L; d[1] /= L; d[2] /= L; return rayStatic(a, d, L - .05, false) === Infinity; }

// ---------------- bot navigation: a 3 m grid over the ground level (bots don't climb onto the walks)
const NAV = {s: 3, x0: -120, z0: -120, n: 81, f: null, ok: null};
function buildNav() {
  const n = NAV.n, F = NAV.f = new Float32Array(n * n), OK = NAV.ok = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = NAV.x0 + i * NAV.s, z = NAV.z0 + j * NAV.s, g = groundH(x, z), fy = floorStatic(x, z, Math.max(g, -.5) + 1.2, .3);
    let ok = fy > -.6; if (ok) { const o = {x, z, y: fy}; pushStatic(o, .45, 1.7); if (Math.hypot(o.x - x, o.z - z) > .05) ok = false; }
    if (Math.hypot(x, z + 10) > 150) ok = false; F[j * n + i] = fy; OK[j * n + i] = ok ? 1 : 0; }
}
const navIdx = (x, z) => { const i = Math.round((x - NAV.x0) / NAV.s), j = Math.round((z - NAV.z0) / NAV.s); return i < 0 || j < 0 || i >= NAV.n || j >= NAV.n ? -1 : j * NAV.n + i; };
const navPos = k => [NAV.x0 + (k % NAV.n) * NAV.s, NAV.z0 + Math.floor(k / NAV.n) * NAV.s];
function navNear(x, z) { const k = navIdx(x, z); if (k >= 0 && NAV.ok[k]) return k; let best = -1, bd = 1e9; const n = NAV.n, ci = Math.round((x - NAV.x0) / NAV.s), cj = Math.round((z - NAV.z0) / NAV.s); for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n || !NAV.ok[j * n + i]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = j * n + i; } } return best; }
function navPath(ax, az, bx, bz) {
  const s = navNear(ax, az), g = navNear(bx, bz); if (s < 0 || g < 0) return null; if (s === g) return [[bx, bz]];
  const n = NAV.n, N = n * n, gs = navPath.gs || (navPath.gs = new Float32Array(N)), from = navPath.fr || (navPath.fr = new Int32Array(N)), seen = navPath.sn || (navPath.sn = new Uint32Array(N)); navPath.id = (navPath.id || 0) + 1; const id = navPath.id;
  const open = [s]; gs[s] = 0; seen[s] = id; from[s] = -1; const gi = g % n, gj = (g / n) | 0, hf = k => Math.hypot(k % n - gi, ((k / n) | 0) - gj); let it = 0;
  while (open.length && it++ < 4000) { let bi = 0, bf = 1e9; for (let q = 0; q < open.length; q++) { const f = gs[open[q]] + hf(open[q]); if (f < bf) { bf = f; bi = q; } } const c = open[bi]; open[bi] = open[open.length - 1]; open.pop(); if (c === g) break;
    const ci = c % n, cj = (c / n) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = j * n + i; if (!NAV.ok[k] || Math.abs(NAV.f[k] - NAV.f[c]) > 1.3) continue; if (di && dj && (!NAV.ok[cj * n + i] || !NAV.ok[j * n + ci])) continue; const ng = gs[c] + (di && dj ? 1.414 : 1); if (seen[k] !== id || ng < gs[k]) { if (seen[k] !== id) open.push(k); seen[k] = id; gs[k] = ng; from[k] = c; } } }
  if (seen[g] !== id) return null; const out = []; for (let k = g; k >= 0 && k !== s; k = from[k]) out.push(navPos(k)); out.reverse(); out.push([bx, bz]); return out;
}

function buildWorld() {
  if (MESH.terr) return; buildMats(); bakeTerrain(); buildFort(); buildDocks(); buildTowers(); buildBits(); buildTerrainMesh(); buildStatic(); buildWater(); buildNav();
}
