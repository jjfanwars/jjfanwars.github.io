'use strict';
// Stage generation: a single dirt road through forest, from a seed. Both players build the identical stage.
// Heading h: forward = (sin h, 0, cos h); right = (-cos h, 0, sin h). Increasing h turns LEFT.
// Biomes: generation, grip and look. grip/off = tyre friction on the road / off it; offDrag slows you on the verge.
const BIOMES = {
  forest: { name: 'Forest', hw: 3.7, grip: 1.5, off: 0.9, offDrag: 55, hills: 34, canyon: 0, jumps: 1, crests: 1, obs: 'log', flora: 'fir', road: 'gravel', ground: 'floor', dust: [0.72, 0.64, 0.52], fogK: 1 },
  autumn: { name: 'Autumn', hw: 3.7, grip: 1.45, off: 0.85, offDrag: 55, hills: 30, canyon: 0, jumps: 1, crests: 1.2, obs: 'log', flora: 'autumn', road: 'leafroad', ground: 'leaves', dust: [0.62, 0.52, 0.4], fogK: 0.9 },
  snow: { name: 'Snow', hw: 3.9, grip: 1.08, off: 0.7, offDrag: 120, hills: 30, canyon: 0, jumps: 0.8, crests: 1, obs: 'log', flora: 'snow', road: 'snowroad', ground: 'snow', banks: true, dust: [0.95, 0.97, 1], fogK: 1.1 },
  desert: { name: 'Desert', hw: 4.3, grip: 1.3, off: 0.95, offDrag: 30, hills: 18, canyon: 16, jumps: 1.8, crests: 1.4, obs: 'rock', flora: 'desert', road: 'sandroad', ground: 'dryground', dust: [0.86, 0.73, 0.56], fogK: 0.5 },
  park: { name: 'Park', hw: 4.2, grip: 1.55, off: 1.0, offDrag: 35, hills: 20, canyon: 0, jumps: 2.6, crests: 1, obs: 'log', flora: 'park', road: 'dirtroad', ground: 'grass', dust: [0.62, 0.5, 0.38], fogK: 0.6 },
  alpine: { name: 'Mountain', hw: 3.9, grip: 1.75, off: 1.0, offDrag: 40, hills: 70, canyon: 0, jumps: 0.25, crests: 0.8, obs: 'rock', flora: 'alpine', road: 'asphalt', ground: 'floor', dust: [0.6, 0.6, 0.58], dustK: 0.25, fogK: 0.7, cliffs: 1, tunnels: 2, rails: 1, maxG: 0.1 },
  city: { name: 'City', hw: 4.6, grip: 1.8, off: 1.4, offDrag: 0, hills: 7, canyon: 0, jumps: 0, crests: 0.6, obs: 'barrier', flora: 'city', road: 'asphalt', ground: 'pavers', dust: [0.55, 0.55, 0.55], dustK: 0.15, fogK: 0.75, city: true },
};
const STAGES = [
  { name: 'Pinewood Ridge', seed: 1207, len: 3000, tod: 'morning', biome: 'forest' },
  { name: 'Black Spruce Run', seed: 4421, len: 3500, tod: 'overcast', biome: 'forest' },
  { name: 'Mossback Hollow', seed: 9182, len: 3900, tod: 'evening', biome: 'forest' },
  { name: 'Goldleaf Pass', seed: 2718, len: 3200, tod: 'autumnDay', biome: 'autumn' },
  { name: 'Copper Birches', seed: 6060, len: 2800, tod: 'evening', biome: 'autumn' },
  { name: 'Frostbite Ridge', seed: 3141, len: 3000, tod: 'snowDay', biome: 'snow' },
  { name: 'Polar Dusk', seed: 5151, len: 2600, tod: 'snowDusk', biome: 'snow' },
  { name: 'Red Mesa Canyon', seed: 8080, len: 3600, tod: 'desertNoon', biome: 'desert' },
  { name: 'Sidewinder Wash', seed: 4242, len: 3000, tod: 'desertDusk', biome: 'desert' },
  { name: 'Old Town Streets', seed: 1999, len: 2600, tod: 'cityDay', biome: 'city' },
  { name: 'Harbour Lights', seed: 7777, len: 2800, tod: 'cityDusk', biome: 'city' },
  { name: 'Kettle Creek Sprint', seed: 7310, len: 2400, tod: 'noon', biome: 'forest' },
  { name: 'Berm Valley', seed: 5309, len: 2800, tod: 'noon', biome: 'park', berms: 1, jumpK: 1.3 },
  { name: 'Kicker Ridge', seed: 8128, len: 3200, tod: 'morning', biome: 'forest', berms: 1, jumpK: 2.4 },
  { name: 'Sandpit Berms', seed: 6464, len: 3000, tod: 'desertNoon', biome: 'desert', berms: 1, jumpK: 1.2 },
  { name: 'Eagle Pass', seed: 3307, len: 3400, tod: 'morning', biome: 'alpine' },
  { name: 'Devil\'s Balcony', seed: 9011, len: 3000, tod: 'evening', biome: 'alpine' },
  { name: 'Tunnel Run', seed: 4580, len: 3600, tod: 'noon', biome: 'alpine', tunnels: 4 },
  { name: 'Canyon Tunnels', seed: 2626, len: 3400, tod: 'desertDusk', biome: 'desert', cliffs: 1, tunnels: 2, maxG: 0.1 },
  { name: 'Ledge Road', seed: 7171, len: 3100, tod: 'overcast', biome: 'forest', cliffs: 1, rails: 1, maxG: 0.1 },
];
let ROAD_HW = 3.7; const STEP = 2, CELL = 2;
const GRADE_R = [0, 10, 19, 31, 50, 82, 140];

function buildStage(cfg) {
  const B = BIOMES[cfg.biome] || BIOMES.forest; ROAD_HW = B.hw;
  const rnd = mulberry(cfg.seed), nz = makeNoise(cfg.seed * 7 + 3);
  const baseH = (x, z) => B.hills * nz.fbm(x / 430, z / 430, 4) + B.hills * 0.15 * nz(x / 85 + 50, z / 85 - 20);
  const P = [{ x: 0, z: 0, h: 0 }];
  const HC = 20, hash = new Map(), hk = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
  const addHash = i => { const k = hk(Math.floor(P[i].x / HC), Math.floor(P[i].z / HC)); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(i); };
  addHash(0);
  const clear = (x, z, n) => {
    const cx = Math.floor(x / HC), cz = Math.floor(z / HC);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const a = hash.get(hk(cx + dx, cz + dz)); if (!a) continue;
      for (const i of a) { if (i > n - 14) continue; const lim = i > n - 160 ? 21 : 46; const ex = P[i].x - x, ez = P[i].z - z; if (ex * ex + ez * ez < lim * lim) return false; }
    }
    return true;
  };
  // simulate a list of curvatures (per STEP) from the end of P; return points or null if they hit older road
  const sim = ks => {
    let { x, z, h } = P[P.length - 1]; const out = [];
    for (const k of ks) { h += k * STEP; x += Math.sin(h) * STEP; z += Math.cos(h) * STEP; if (!clear(x, z, P.length + out.length)) return null; out.push({ x, z, h }); }
    return out;
  };
  const commit = pts => { for (const p of pts) { P.push(p); addHash(P.length - 1); } };
  const corners = [];
  let goal = 0, forceSw = 0, lastDir = 0;
  commit(sim(new Array(40).fill(0))); // start straight (80 m)
  const GW8 = B.city ? [0.07, 0.4, 0.75, 0.92, 1, 1] : cfg.biome === 'desert' ? [0.06, 0.16, 0.32, 0.55, 0.8, 1] : [0.11, 0.27, 0.47, 0.67, 0.85, 1];
  const pickGrade = () => { const r = rnd(); let g = 1; while (g < 6 && r > GW8[g - 1]) g++; return g; };
  let fails = 0;
  while (P.length * STEP < cfg.len && fails < 60) {
    goal += (rnd() - 0.5) * 0.5;
    let done = false;
    for (let t = 0; t < 40 && !done; t++) {
      const r = rnd();
      let st = forceSw ? 18 + rnd() * 30 : B.city ? 30 + rnd() * 110 : r < 0.2 ? rnd() * 14 : r < 0.72 ? 30 + rnd() * 90 : 120 + rnd() * 150;
      let g = forceSw ? (rnd() < 0.7 ? 1 : 2) : pickGrade();
      let ang = g === 1 ? (150 + rnd() * 35) : g === 2 ? (70 + rnd() * 55) : g === 6 ? (18 + rnd() * 30) : (35 + rnd() * 65);
      if (B.city && g >= 2 && g <= 4) ang = 82 + rnd() * 14; // street junctions
      ang *= Math.PI / 180;
      const h = P[P.length - 1].h, off = wrapA(h - goal);
      let dir = forceSw ? -lastDir : (Math.abs(off) > 0.5 && rnd() < 0.8 ? -Math.sign(off) : (rnd() < 0.5 ? 1 : -1));
      if (t > 15) dir = rnd() < 0.5 ? 1 : -1;
      if (!forceSw && g === 1 && Math.abs(wrapA(h + dir * ang - goal)) > 2.4) g = 2, ang = Math.min(ang, 1.9);
      const R = GRADE_R[g] * (0.9 + rnd() * 0.2), kMax = dir / R, nCorner = Math.max(3, Math.round(ang * R / STEP)), nTr = Math.min(6, Math.floor(nCorner / 3));
      const ks = new Array(Math.round(st / STEP)).fill(0);
      const c0 = ks.length;
      for (let i = 0; i < nCorner + nTr; i++) { const a = i < nTr ? (i + 0.5) / (nTr + 1) : i >= nCorner ? (nCorner + nTr - i - 0.5) / (nTr + 1) : 1; ks.push(kMax * a); }
      const pts = sim(ks);
      if (!pts) continue;
      const s0 = (P.length + c0) * STEP; commit(pts);
      corners.push({ s0, s1: P.length * STEP, dir: dir > 0 ? 'L' : 'R', g, ang, R });
      lastDir = dir; forceSw = (g === 1 && !forceSw && rnd() < 0.75) ? 1 : 0;
      done = true;
    }
    if (!done) { fails++; forceSw = 0; const pts = sim(new Array(8).fill(0)); if (pts) commit(pts); else { goal += Math.PI / 2; if (fails > 8) break; } }
  }
  const fin = sim(new Array(45).fill(0)); if (fin) commit(fin); else commit(sim(new Array(10).fill(0)) || []);
  const N = P.length, L = (N - 1) * STEP;
  // elevation along road: smoothed ground + crests + jumps
  const raw = P.map(p => baseH(p.x, p.z)), Y = new Float32Array(N), W = 22;
  for (let i = 0; i < N; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(N - 1, i + W); j++) { s += raw[j]; n++; } Y[i] = s / n; }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N - 1; i++) Y[i] = (Y[i - 1] + Y[i] * 2 + Y[i + 1]) / 4;
  // mountain roads are engineered: cap the gradient (newer stages only, older ones generate exactly as before)
  const maxG = cfg.maxG || B.maxG; if (maxG) for (let rep = 0; rep < 3; rep++) {
    for (let i = 1; i < N; i++) Y[i] = clamp(Y[i], Y[i - 1] - maxG * STEP, Y[i - 1] + maxG * STEP);
    for (let i = N - 2; i >= 0; i--) Y[i] = clamp(Y[i], Y[i + 1] - maxG * STEP, Y[i + 1] + maxG * STEP);
    for (let i = 1; i < N - 1; i++) Y[i] = (Y[i - 1] + Y[i] * 2 + Y[i + 1]) / 4;
  }
  if (maxG) for (let i = 1; i < Math.min(N, 60); i++) Y[i] = lerp(Y[0], Y[i], sstep(30, 120, i * STEP)); // flat start area
  // hazards on straights
  const straights = []; let prev = 80;
  for (const c of corners) { if (c.s0 - prev > 0) straights.push({ a: prev, b: c.s0 }); prev = c.s1; }
  straights.push({ a: prev, b: L - 90 });
  const jumps = [], crests = [], logs = [], tunnels = [], xr = mulberry(cfg.seed * 31 + 7);
  const nT = cfg.tunnels !== undefined ? cfg.tunnels : (B.tunnels || 0);
  for (let t = 0; t < 400 && tunnels.length < nT; t++) {
    const len = 70 + xr() * 90, s0 = 220 + xr() * (L - 420 - len), s1 = s0 + len;
    if (corners.some(c => c.g <= 3 && c.s1 > s0 - 40 && c.s0 < s1 + 30)) continue;
    if (tunnels.some(q => q.s0 < s1 + 250 && s0 < q.s1 + 250)) continue;
    tunnels.push({ s0, s1, cap: 8 + xr() * 4 });
  }
  tunnels.sort((a, b) => a.s0 - b.s0);
  const inTun = (s, m) => tunnels.some(q => s > q.s0 - m && s < q.s1 + m);
  const busy = (s, r) => jumps.some(j => Math.abs(j.s - s) < r) || crests.some(c => Math.abs(c.s - s) < r) || logs.some(l => Math.abs(l.s - s) < r) || inTun(s, r);
  const longS = straights.filter(q => q.b - q.a > 85).sort(() => rnd() - 0.5);
  const nJ = Math.round(L / 750 * B.jumps * (cfg.jumpK || 1)), nC = Math.round(L / 650 * B.crests);
  const jtype = () => { const r = rnd(); return !cfg.berms ? 'kick' : r < 0.35 ? 'kick' : r < 0.6 ? 'table' : r < 0.8 ? 'double' : 'step'; };
  // each jump (ramp + flight + landing) must fit inside its straight with a run-out before the next corner
  const JEXT = { kick: 40, table: 50, double: 76, step: 40 };
  for (let pass = 0; pass < 4 && jumps.length < nJ; pass++) for (const q of straights.slice().sort(() => rnd() - 0.5)) {
    if (jumps.length >= nJ) break; const type = jtype(), room = q.b - q.a - 20 - JEXT[type] - 25; if (room < 0) continue;
    const s = q.a + 20 + 18 + rnd() * room; if (!jumps.some(j => s < j.s + JEXT[j.type] + 30 && j.s < s + JEXT[type] + 30) && s < L - 140 && !inTun(s, JEXT[type] + 30)) jumps.push({ s, k: 'jump', big: rnd() < 0.4, type });
  }
  for (const q of straights.filter(q => q.b - q.a > 70).sort(() => rnd() - 0.5)) { if (crests.length >= nC) break; const s = q.a + 30 + rnd() * Math.max(1, q.b - q.a - 60); if (!busy(s, 70)) crests.push({ s, k: 'crest' }); }
  // a few obstacles, each on a straight bit you can see from a way back (not just past a tight corner or crest)
  const nL = Math.max(2, Math.round(L / 750));
  for (let t = 0; t < 300 && logs.length < nL; t++) {
    const s = 150 + rnd() * (L - 280); if (busy(s, 60) || logs.some(l => Math.abs(l.s - s) < 400)) continue;
    const inC = corners.find(c => s > c.s0 - 30 && s < c.s1 + 6); if (inC && inC.g <= 4) continue;
    if (corners.some(c => c.g <= 3 && s > c.s1 && s - c.s1 < 40)) continue;
    logs.push({ s, k: 'log', side: rnd() < 0.5 ? 'L' : 'R' });
  }
  const profJ = (u, big) => { const hgt = big ? 1.35 : 0.9, dn = big ? 1.6 : 1.1; if (u < -18 || u > 64) return 0; if (u < 0) return hgt * ((u + 18) / 18) ** 2; if (u < 26) return lerp(hgt, -dn, sstep(0, 26, u)); return -dn * (1 - sstep(26, 64, u)); };
  const ch = B.city ? 0.9 : 1.7, profC = u => u < -38 || u > 38 ? 0 : ch * (0.5 + 0.5 * Math.cos(u / 38 * Math.PI)) ** 1.3;
  // tabletop: ramp, flat deck, ramp down; double: two kickers; step: launch over a drop to lower ground
  const profT = u => u < -16 || u > 46 ? 0 : u < 0 ? 1.8 * ((u + 16) / 16) ** 1.6 : u < 18 ? 1.8 : 1.8 * (1 - sstep(18, 46, u));
  const profS = u => u < -16 ? 0 : u < 0 ? 1.0 * ((u + 16) / 16) ** 2 : u < 30 ? lerp(1.0, -2.4, sstep(0, 30, u)) : -2.4;
  const jumpH = (j, u) => j.type === 'table' ? profT(u) : j.type === 'double' ? profJ(u, false) + profJ(u - 34, j.big) : j.type === 'step' ? profS(u) : profJ(u, j.big);
  for (let i = 0; i < N; i++) { const s = i * STEP; for (const j of jumps) Y[i] += jumpH(j, s - j.s); for (const c of crests) Y[i] += profC(s - c.s); }
  // berms: bank every corner (outside edge raised) on berm stages
  const BK = new Float32Array(N);
  if (cfg.berms) for (const c of corners) { const mag = [0, 0.3, 0.27, 0.22, 0.15, 0.08, 0.04][c.g], sg = c.dir === 'L' ? 1 : -1; for (let i = 0; i < N; i++) { const s = i * STEP, w = sstep(c.s0 - 16, c.s0 + 4, s) * (1 - sstep(c.s1 - 4, c.s1 + 16, s)); if (w > 0) BK[i] += sg * mag * w; } }
  const CS = new Float32Array(N), CH = new Float32Array(N);
  if (cfg.cliffs || B.cliffs) {
    const raw = new Float32Array(N); let i = 0;
    while (i < N) { const n = Math.round((140 + xr() * 260) / STEP), r = xr(), sd = r < 0.15 ? 0 : r < 0.575 ? -1 : 1; for (let k = 0; k < n && i < N; k++, i++) raw[i] = i * STEP < 70 ? 0 : sd; }
    for (let k = 0; k < N; k++) { let a = 0, m = 0; for (let j = Math.max(0, k - 12); j <= Math.min(N - 1, k + 12); j++) { a += raw[j]; m++; } CS[k] = a / m; CH[k] = 9 + 6 * (0.5 + 0.5 * nz(k * 0.02, 31.7)); }
  }
  const cliffAt = s => { const f = clamp(s / STEP, 0, N - 1.001), i = Math.floor(f); return CS[i] + (CS[i + 1] - CS[i]) * (f - i); };
  const tunAt = s => { for (const q of tunnels) { if (s > q.s0 - 28 && s < q.s1 + 28) return { q, f: sstep(q.s0 - 28, q.s0 - 2, s) * (1 - sstep(q.s1 + 2, q.s1 + 28, s)) }; } return null; };
  const bankAt = s => { const f = clamp(s / STEP, 0, N - 1.001), i = Math.floor(f); return BK[i] + (BK[i + 1] - BK[i]) * (f - i); };
  jumps.sort((a, b) => a.s - b.s); crests.sort((a, b) => a.s - b.s); logs.sort((a, b) => a.s - b.s);
  // nearest road query
  const near = (x, z, maxD) => {
    const cx = Math.floor(x / HC), cz = Math.floor(z / HC), rr = Math.ceil(maxD / HC); let best = -1, bd = maxD * maxD;
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) { const a = hash.get(hk(cx + dx, cz + dz)); if (!a) continue; for (const i of a) { const ex = P[i].x - x, ez = P[i].z - z, d = ex * ex + ez * ez; if (d < bd) { bd = d; best = i; } } }
    if (best < 0) return null;
    // refine on the segment toward the closer neighbour
    let i0 = best, i1 = best + 1;
    if (best > 0 && (best === N - 1 || (P[best - 1].x - x) ** 2 + (P[best - 1].z - z) ** 2 < (P[best + 1].x - x) ** 2 + (P[best + 1].z - z) ** 2)) { i0 = best - 1; i1 = best; }
    const A = P[i0], B = P[i1], sx = B.x - A.x, sz = B.z - A.z, t = clamp(((x - A.x) * sx + (z - A.z) * sz) / (sx * sx + sz * sz), 0, 1);
    const px = A.x + sx * t, pz = A.z + sz * t, h = A.h + wrapA(B.h - A.h) * t, rx = -Math.cos(h), rz = Math.sin(h);
    const lat = (x - px) * rx + (z - pz) * rz, s = (i0 + t) * STEP;
    return { s, lat, d: Math.abs(lat), y: Y[i0] + (Y[i1] - Y[i0]) * t, h, px, pz };
  };
  const at = s => { const f = clamp(s / STEP, 0, N - 1.001), i = Math.floor(f), t = f - i, A = P[i], B = P[i + 1]; return { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t, y: Y[i] + (Y[i + 1] - Y[i]) * t, h: A.h + wrapA(B.h - A.h) * t }; };
  // heightfield grid
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; for (const p of P) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
  const M = 110, x0 = Math.floor((mnx - M) / CELL) * CELL, z0 = Math.floor((mnz - M) / CELL) * CELL, GW = Math.ceil((mxx + M - x0) / CELL) + 1, GH = Math.ceil((mxz + M - z0) / CELL) + 1;
  const H = new Float32Array(GW * GH), RF = new Float32Array(GW * GH), RU = new Float32Array(GW * GH), RV = new Float32Array(GW * GH), RD = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = x0 + i * CELL, z = z0 + j * CELL, k = j * GW + i, b = baseH(x, z), q = near(x, z, 46);
    let y = b, rf = 0, d = 999;
    if (q) {
      d = q.d;
      const bk = bankAt(q.s), lc = clamp(q.lat, -ROAD_HW - 1.5, ROAD_HW + 1.5), outside = bk * q.lat > 0;
      const lip = outside ? Math.abs(bk) / 0.3 * 0.9 * Math.exp(-(((d - ROAD_HW - 1.6) / 1.1) ** 2)) : 0, yr = q.y + bk * lc + lip;
      if (d < ROAD_HW + 1.5) y = yr; // flat (or banked) road and verges, no ditches
      else { const t = sstep(ROAD_HW + 1.5, ROAD_HW + 20, d); y = lerp(yr, b, t) + B.canyon * sstep(ROAD_HW + 9, ROAD_HW + 42, d) * (0.7 + 0.5 * nz(x * 0.02, z * 0.02));
        const cs = cliffAt(q.s);
        if (cs !== 0) {
          const w = Math.abs(cs), up = q.lat * cs > 0, ii = Math.min(N - 1, Math.round(q.s / STEP)), jag = 1.6 * nz(x * 0.35, z * 0.35) + 0.8 * nz(x * 1.1 + 3, z * 1.1);
          if (up) y = Math.max(y, yr + w * (CH[ii] * sstep(ROAD_HW + 1.6, ROAD_HW + 4.6, d) + (d - ROAD_HW) * 0.35 + jag * sstep(ROAD_HW + 2, ROAD_HW + 5, d)));
          else y = Math.min(y, yr - w * ((CH[ii] * 0.9) * sstep(ROAD_HW + 2.6, ROAD_HW + 11, d) + Math.max(0, d - ROAD_HW - 11) * 0.25) + jag * 0.4 * sstep(ROAD_HW + 3, ROAD_HW + 8, d));
        }
        const tn = tunAt(q.s);
        if (tn && tn.f > 0) y = Math.max(y, yr + tn.f * (tn.q.cap + 1.5 * nz(x * 0.2, z * 0.2)) * sstep(ROAD_HW + (tn.f > 0.97 ? 3.6 : 1.4), ROAD_HW + (tn.f > 0.97 ? 5.6 : 3.4), d) * (1 - sstep(ROAD_HW + 22, ROAD_HW + 44, d)));
      }
      rf = 1 - sstep(ROAD_HW - 0.5, ROAD_HW + 0.9, d + 0.5 * nz(x * 0.9 + 9, z * 0.9));
      RU[k] = q.lat; RV[k] = q.s;
    }
    H[k] = y; RF[k] = rf; RD[k] = d;
  }
  const heightAt = (x, z) => {
    const fx = clamp((x - x0) / CELL, 0, GW - 1.001), fz = clamp((z - z0) / CELL, 0, GH - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * GW + i;
    const a = H[k], b = H[k + 1], c = H[k + GW], d = H[k + GW + 1];
    return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
  const normalAt = (x, z, out) => { const e = 0.6, hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e); out.set(-hx, 2 * e, -hz).normalize(); return out; };
  // trees (jittered grid in the forest band), spatial hash for collisions
  const clearings = jumps.map(j => j.s).concat(corners.filter(c => c.g === 1).map(c => (c.s0 + c.s1) / 2), crests.slice(0, 2).map(c => c.s));
  const trees = [], TC = 8, thash = new Map(), tr = mulberry(cfg.seed * 13 + 1);
  const addT = t => { trees.push(t); const k = hk(Math.floor(t.x / TC), Math.floor(t.z / TC)); let a = thash.get(k); if (!a) thash.set(k, a = []); a.push(t); };
  // kinds: 0 fir, 1 tall pine, 2 young fir, 3 birch, 4 cactus, 5 boulder, 6 dry bush, 7 street lamp, 8 wall (collider only), 9 snowbank (soft collider only)
  const buildings = [], parked = [], lights = [];
  if (B.city) {
    // buildings along both sides, fronts set back behind the pavement; colliders along each footprint edge
    for (const sd of [-1, 1]) {
      let s = 10;
      while (s < L - 10) {
        const w = 12 + tr() * 16, dep = 10 + tr() * 12, ht = 8 + tr() * 20, gap = tr() < 0.15 ? 8 + tr() * 6 : 0.5, sm = s + w / 2, p = at(sm);
        const front = ROAD_HW + 3.4, rx = -Math.cos(p.h), rz = Math.sin(p.h), fx = Math.sin(p.h), fz = Math.cos(p.h);
        const cx = p.x + rx * sd * (front + dep / 2), cz = p.z + rz * sd * (front + dep / 2);
        // footprint corners must stay clear of the road everywhere
        let ok = true;
        // the whole footprint (every ~2 m, plus a margin) must stay clear of the road and its pavement
        for (let u = -0.5; u <= 0.501 && ok; u += 2 / w) for (let v = -0.5; v <= 0.501; v += 2 / dep) { const x = cx + fx * u * (w + 2) + rx * sd * v * (dep + 2), z = cz + fz * u * (w + 2) + rz * sd * v * (dep + 2), q = near(x, z, 40); if (q && q.d < ROAD_HW + 2) { ok = false; break; } }
        if (ok && (s > 30 || true)) {
          const bld = { x: cx, z: cz, y: Math.min(heightAt(cx, cz), p.y) - 0.5, h: p.h, w, d: dep, ht, style: (tr() * 4) | 0, sd, fx: p.x + rx * sd * front, fz: p.z + rz * sd * front };
          buildings.push(bld);
          for (let u = -0.5; u <= 0.5001; u += 1.2 / w) for (const v of [-0.5, 0.5]) addT({ x: cx + fx * u * w + rx * sd * v * dep, z: cz + fz * u * w + rz * sd * v * dep, y: p.y, kind: 8, r: 0.7 });
          for (let v = -0.5; v <= 0.5001; v += 1.2 / dep) for (const u of [-0.5, 0.5]) addT({ x: cx + fx * u * w + rx * sd * v * dep, z: cz + fz * u * w + rz * sd * v * dep, y: p.y, kind: 8, r: 0.7 });
        }
        s += w + gap;
      }
      // concrete barriers line the outside of every junction
      for (const c of corners) { const sg = c.dir === 'L' ? 1 : -1; if (sd !== sg) continue; for (let s2 = c.s0 - 6; s2 < c.s1 + 6; s2 += 2) { const p = at(s2), d = ROAD_HW + 1.0, x = p.x - Math.cos(p.h) * sg * d, z = p.z + Math.sin(p.h) * sg * d, q = near(x, z, 20); if (q && q.d > ROAD_HW + 0.7) addT({ x, z, y: heightAt(x, z), kind: 11, sc: 1, rot: p.h, r: 0.5 }); } }
      // street life (own random stream, so the older street layouts are unchanged): trees in the pavement, cars parked at the kerb, traffic lights at junctions
      const cr = mulberry(cfg.seed * 17 + sd * 5 + 11), nearC = (s2, m) => corners.some(c => s2 > c.s0 - m && s2 < c.s1 + m), nearLamp = s2 => Math.abs(((s2 - 30) % 32 + 32) % 32) < 3 || Math.abs(((s2 - 30) % 32 + 32) % 32) > 29;
      for (let s2 = 40; s2 < L - 40; s2 += 16) { if (nearC(s2, 14) || nearLamp(s2) || cr() < 0.3) continue; const p = at(s2), d = ROAD_HW + 2.1, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d, q = near(x, z, 20); if (q && q.d > ROAD_HW + 1.6) addT({ x, z, y: heightAt(x, z), kind: 3, sc: 0.5 + cr() * 0.15, rot: cr() * 6.28, r: 0.28 }); }
      for (let s2 = 60; s2 < L - 60; s2 += 9) { if (nearC(s2, 26) || logs.some(l => Math.abs(l.s - s2) < 45) || cr() > 0.16) continue; let ok = true; for (let k = -3; k <= 3; k++) if (nearLamp(s2 + k)) ok = false; if (!ok) continue;
        const p = at(s2), d = ROAD_HW + 0.55, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; parked.push({ x, z, y: heightAt(x, z), h: p.h, col: cr() });
        for (const o of [-1.4, 0, 1.4]) addT({ x: x + Math.sin(p.h) * o, z: z + Math.cos(p.h) * o, y: p.y, kind: 8, r: 0.88 }); s2 += 12; }
      for (const c of corners) { if (c.g < 2 || c.g > 4) continue; const p = at(c.s0 - 3), d = ROAD_HW + 1.0, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; lights.push({ x, z, y: heightAt(x, z), h: p.h, sd }); addT({ x, z, y: p.y, kind: 8, r: 0.16 }); }
      for (let s2 = 30; s2 < L - 20; s2 += 32) { const p = at(s2), d = ROAD_HW + 1.2, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d, q = near(x, z, 20); if (q && q.d > ROAD_HW + 0.6) addT({ x, z, y: heightAt(x, z), kind: 7, sc: 1, rot: p.h + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), r: 0.22 }); }
    }
  } else {
    const SP = B.flora === 'desert' ? 4.2 : 3.3;
    for (let z = z0 + 2; z < z0 + (GH - 2) * CELL; z += SP) for (let x = x0 + 2; x < x0 + (GW - 2) * CELL; x += SP) {
      const px = x + (tr() - 0.5) * SP * 0.9, pz = z + (tr() - 0.5) * SP * 0.9, q = near(px, pz, 46); if (!q) { tr(); tr(); tr(); continue; }
      const edge = ROAD_HW + (B.banks ? 3.2 : 1.9) + 2.2 * (0.5 + 0.5 * nz(px * 0.15, pz * 0.15)), r1 = tr(), r2 = tr(), r3 = tr();
      if (q.d < edge || q.d > 44) continue;
      if (q.d < edge + 4 && r1 < 0.2) continue; // a little thinner at the edge
      if (q.s < 30 && q.d < 14) continue; // start area
      if (q.d < ROAD_HW + 11 && clearings.some(c => Math.abs(q.s - c) < 20)) continue; // spectator areas
      if (inTun(q.s, 30) && q.d < ROAD_HW + 26) continue; // tunnel hills stay bare above the tube
      { const cs = cliffAt(q.s); if (cs * q.lat > 0 && Math.abs(cs) > 0.2 && q.d < ROAD_HW + 9) continue; if (cs * q.lat < 0 && Math.abs(cs) > 0.2 && q.d < ROAD_HW + 4) continue; }
      let kind, sc = 0.75 + r3 * 0.6, r;
      if (B.flora === 'park') { if (r1 > 0.12 + 0.25 * Math.max(0, nz(px * 0.02, pz * 0.02))) continue; kind = r2 < 0.5 ? 0 : 3; r = (kind === 3 ? 0.17 : 0.24) * sc + 0.1; }
      else if (B.flora === 'desert') { if (r1 > 0.16) continue; kind = r2 < 0.4 ? 4 : r2 < 0.75 ? 5 : 6; sc = kind === 5 ? 0.6 + r3 * 1.6 : 0.7 + r3 * 0.6; r = kind === 4 ? 0.35 * sc : kind === 5 ? 0.95 * sc : 0.3; }
      else if (B.flora === 'alpine') { if (r1 > 0.45) continue; kind = r2 < 0.55 ? 1 : r2 < 0.8 ? 0 : 5; sc = kind === 5 ? 0.5 + r3 * 1.2 : sc; r = kind === 5 ? 0.95 * sc : 0.24 * sc + 0.1; }
      else if (B.flora === 'autumn') { kind = r2 < 0.6 ? 3 : r2 < 0.85 ? 0 : 2; r = (kind === 3 ? 0.17 : kind === 2 ? 0.16 : 0.24) * sc + 0.1; }
      else { kind = B.flora === 'snow' ? (r2 < 0.75 ? 0 : 2) : r2 < 0.62 ? 0 : r2 < 0.9 ? 1 : 2; r = (kind === 2 ? 0.16 : 0.24) * sc + 0.1; }
      addT({ x: px, z: pz, y: heightAt(px, pz), kind, sc, rot: r1 * 6.28 + r3, r });
    }
    // hay bales on the outside of berms (soft: you bounce off them)
    if (cfg.berms) for (const c of corners) if (c.g <= 4) { const sg = c.dir === 'L' ? 1 : -1; for (let s2 = c.s0 + 2; s2 < c.s1 - 2; s2 += 2.6) { const p = at(s2), d = ROAD_HW + 3.4, x = p.x - Math.cos(p.h) * sg * d, z = p.z + Math.sin(p.h) * sg * d, q = near(x, z, 20); if (q && q.d > ROAD_HW + 2.6) addT({ x, z, y: heightAt(x, z), kind: 10, sc: 1, rot: p.h + Math.PI / 2, r: 0.75, soft: true }); } }
    // snowbanks: soft walls along both edges
    if (B.banks) for (let s2 = 6; s2 < L; s2 += 2.4) for (const sd of [-1, 1]) { const p = at(s2), d = ROAD_HW + 2.1, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d, q = near(x, z, 20); if (q && q.d > ROAD_HW + 1.4 && !logs.some(l => Math.abs(l.s - s2) < 5)) addT({ x, z, y: heightAt(x, z), kind: 9, r: 0.75, soft: true }); }
  }
  // cliff wall and tunnel wall colliders, armco guardrail on the drop side (with the odd gap on straights)
  const rails = [];
  const sideP = (s2, sd, d) => { const p = at(s2); return { x: p.x - Math.cos(p.h) * sd * d, z: p.z + Math.sin(p.h) * sd * d, h: p.h }; };
  for (const q of tunnels) for (let s2 = q.s0 - 2; s2 <= q.s1 + 2; s2 += 1.2) for (const sd of [-1, 1]) { const o = sideP(s2, sd, ROAD_HW + 1.25); addT({ x: o.x, z: o.z, y: at(s2).y, kind: 8, r: 0.5 }); }
  if (cfg.cliffs || B.cliffs) {
    for (let s2 = 4; s2 < L; s2 += 1.4) { const cs = cliffAt(s2); if (Math.abs(cs) < 0.45 || inTun(s2, 0)) continue; const o = sideP(s2, Math.sign(cs), ROAD_HW + 3.0), qq = near(o.x, o.z, 20); if (qq && qq.d > ROAD_HW + 2.4) addT({ x: o.x, z: o.z, y: at(s2).y, kind: 8, r: 0.75 }); }
    if (cfg.rails || B.rails) {
      let cur = null;
      for (let s2 = 30; s2 < L - 20; s2 += 2) {
        const cs = cliffAt(s2), drop = Math.abs(cs) > 0.5 && !inTun(s2, 4), chunk = Math.floor(s2 / 90), gap = !corners.some(c => s2 > c.s0 - 40 && s2 < c.s1 + 30) && mulberry(cfg.seed + chunk * 7)() < 0.22;
        const sd = -Math.sign(cs);
        if (drop && !gap) { if (!cur || cur.sd !== sd) { cur = { s0: s2, s1: s2, sd }; rails.push(cur); } cur.s1 = s2; } else cur = null;
      }
      for (const r of rails) for (let s2 = r.s0; s2 <= r.s1; s2 += 1.3) { const o = sideP(s2, r.sd, ROAD_HW + 1.35), qq = near(o.x, o.z, 20); if (qq && qq.d > ROAD_HW + 1.0) addT({ x: o.x, z: o.z, y: at(s2).y, kind: 12, r: 0.22 }); }
    }
  }
  const treesNear = (x, z, out) => { out.length = 0; const cx = Math.floor(x / TC), cz = Math.floor(z / TC); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = thash.get(hk(cx + dx, cz + dz)); if (a) for (const t of a) out.push(t); } return out; };
  // log objects: a log lying across one half of the road
  for (const l of logs) {
    const p = at(l.s), rx = -Math.cos(p.h), rz = Math.sin(p.h), sd = l.side === 'R' ? 1 : -1, ang = (tr() - 0.5) * 0.35;
    const cx = p.x + rx * sd * 2.4, cz = p.z + rz * sd * 2.4, ca = Math.cos(ang), sa = Math.sin(ang);
    const dx = rx * ca - Math.sin(p.h) * sa * 0, dz = rz * ca; // mostly perpendicular to the road
    const hl = B.obs === 'rock' ? 1.0 : 2.7; l.ax = cx - dx * hl * sd; l.az = cz - dz * hl * sd; l.bx = cx + dx * hl * sd + Math.sin(p.h) * sa * hl; l.bz = cz + dz * hl * sd + Math.cos(p.h) * sa * hl;
    l.rad = B.obs === 'rock' ? 0.85 + tr() * 0.2 : B.obs === 'barrier' ? 0.42 : 0.3 + tr() * 0.06; l.y = p.y;
    const mx = (l.ax + l.bx) / 2, mz = (l.az + l.bz) / 2; l.cy = Math.max(heightAt(l.ax, l.az), heightAt(l.bx, l.bz), heightAt(mx, mz)) + l.rad * 0.8; l.top = l.cy + l.rad;
  }
  return { cfg, B, buildings, parked, lights, bankAt, cliffAt, tunnels, rails, inTun, P, Y, N, L, corners, jumps, crests, logs, near, at, heightAt, normalAt, trees, treesNear, grid: { x0, z0, GW, GH, H, RF, RU, RV, RD }, baseH, noise: nz };
}
// some seeds box themselves in; nudge the seed until the stage is long enough
function makeStage(cfg) { let best = null; for (let k = 0; k < 8; k++) { const S = buildStage(Object.assign({}, cfg, { seed: cfg.seed + k * 101 })); if (!best || S.L > best.L) best = S; if (S.L >= cfg.len * 0.88) return S; } return best; }
