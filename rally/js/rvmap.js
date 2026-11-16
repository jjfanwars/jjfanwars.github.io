'use strict';
// Camper Crew: one handmade map. A road from Grandma's farm to Lakeside Camp, with set pieces the crew has to get past:
// a fallen tree (winch it into the logging yard), a mud hill (winch up from tree to tree), Pete's Gas (pumps are dead: jerry cans),
// a raised bridge (cross the footbridge, crank it down), a rockslide on the cliff road (dynamite), and a hand-cranked ferry.
// Builds an object with the same shape as buildStage's result, so Car physics and the World terrain/forest renderer work on it.
const RVMAP = (() => {
  // control points: x, z, road height, tag
  const CP = [
    [0, -70, 20], [0, -20, 20, 'start'], [4, 60, 20.3], [30, 160, 21.5], [14, 260, 23], [-8, 350, 24, 'forest'], [6, 440, 25], [30, 520, 25.5, 'log'],
    [44, 600, 26.5], [42, 690, 28.5], [60, 770, 30, 'mud0'], [74, 830, 41], [88, 895, 54, 'mud1'], [118, 965, 56], [180, 1020, 56.5],
    [262, 1046, 56.5, 'gas'], [345, 1060, 55], [416, 1092, 46], [470, 1130, 40.5], [512, 1160, 40, 'br'], [556, 1190, 40.5], [600, 1240, 43],
    [622, 1320, 47, 'cl0'], [628, 1420, 49], [618, 1520, 50, 'rk'], [630, 1610, 50], [660, 1690, 49, 'cl1'], [712, 1730, 45], [760, 1772, 40],
    [742, 1840, 34], [692, 1880, 30], [690, 1940, 26], [740, 1985, 21], [800, 2010, 16], [846, 2046, 12, 'dock0'], [884, 2170, 12, 'dock1'],
    [905, 2228, 12.5], [930, 2290, 13.5, 'camp'], [950, 2340, 14],
  ];
  const STEP = 2, HC = 16, hk = (a, b) => a * 73856093 ^ b * 19349663;
  function build() {
    const B = Object.assign({}, BIOMES.park, { hw: 3.8, fogK: 0.55 }); ROAD_HW = B.hw; const HW = B.hw;
    const nz = makeNoise(4711), rnd = mulberry(99);
    // ---- centreline: Catmull-Rom through the points, resampled every 2 m ----
    const fine = [];
    for (let i = 0; i < CP.length - 1; i++) {
      const p0 = CP[Math.max(0, i - 1)], p1 = CP[i], p2 = CP[i + 1], p3 = CP[Math.min(CP.length - 1, i + 2)];
      for (let k = 0; k < 40; k++) { const t = k / 40, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); fine.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]), cp: k === 0 ? i : -1 }); }
    }
    fine.push({ x: CP[CP.length - 1][0], z: CP[CP.length - 1][1], cp: CP.length - 1 });
    const P = [], cpS = new Array(CP.length).fill(0); let acc = 0, next = 0;
    for (let i = 0; i < fine.length; i++) {
      if (i > 0) acc += Math.hypot(fine[i].x - fine[i - 1].x, fine[i].z - fine[i - 1].z);
      if (fine[i].cp >= 0) cpS[fine[i].cp] = acc;
      while (acc >= next && i > 0) { const a = fine[i - 1], b = fine[i], seg = Math.hypot(b.x - a.x, b.z - a.z), t = seg > 0 ? 1 - (acc - next) / seg : 0; P.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) }); next += STEP; }
    }
    const N = P.length, L = (N - 1) * STEP;
    for (let i = 0; i < N; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)]; P[i].h = Math.atan2(b.x - a.x, b.z - a.z); }
    const tag = {}; CP.forEach((c, i) => { if (c[3]) tag[c[3]] = cpS[i]; });
    // ---- height profile: Hermite through the keyed heights, flat over the bridge and the ferry ----
    const Y = new Float32Array(N), ks = CP.map((c, i) => [cpS[i], c[2]]);
    for (let i = 0; i < N; i++) {
      const s = i * STEP; let j = 0; while (j < ks.length - 2 && ks[j + 1][0] < s) j++;
      const a = ks[Math.max(0, j - 1)], b = ks[j], c = ks[j + 1], d = ks[Math.min(ks.length - 1, j + 2)], t = clamp((s - b[0]) / Math.max(1, c[0] - b[0]), 0, 1);
      const m1 = (c[1] - a[1]) / Math.max(1, c[0] - a[0]) * (c[0] - b[0]), m2 = (d[1] - b[1]) / Math.max(1, d[0] - b[0]) * (c[0] - b[0]);
      const t2 = t * t, t3 = t2 * t; Y[i] = (2 * t3 - 3 * t2 + 1) * b[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * c[1] + (t3 - t2) * m2;
    }
    const sBr = tag.br, deckY = 40, sD0 = tag.dock0, sD1 = tag.dock1, ferryY = 12;
    const flatOver = (s0, s1, y, bl) => { for (let i = 0; i < N; i++) { const s = i * STEP, w = s >= s0 && s <= s1 ? 1 : s < s0 ? sstep(s0 - bl, s0, s) : 1 - sstep(s1, s1 + bl, s); Y[i] = lerp(Y[i], y, w); } };
    flatOver(sBr - 34, sBr + 34, deckY, 40); flatOver(sD0 - 6, sD1 + 6, ferryY, 30);
    const yAt = s => { const f = clamp(s / STEP, 0, N - 1.001), i = Math.floor(f); return Y[i] + (Y[i + 1] - Y[i]) * (f - i); };
    const at = s => { const f = clamp(s / STEP, 0, N - 1.001), i = Math.floor(f), t = f - i, A = P[i], Bp = P[i + 1]; return { x: A.x + (Bp.x - A.x) * t, z: A.z + (Bp.z - A.z) * t, y: Y[i] + (Y[i + 1] - Y[i]) * t, h: A.h + wrapA(Bp.h - A.h) * t }; };
    // lat > 0 is the right-hand side of the road
    const sideP = (s, lat) => { const p = at(s); return { x: p.x - Math.cos(p.h) * lat, z: p.z + Math.sin(p.h) * lat, y: p.y, h: p.h }; };
    const hash = new Map(); for (let i = 0; i < N; i++) { const k = hk(Math.floor(P[i].x / HC), Math.floor(P[i].z / HC)); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(i); }
    const near = (x, z, maxD) => {
      const cx = Math.floor(x / HC), cz = Math.floor(z / HC), rr = Math.ceil(maxD / HC); let best = -1, bd = maxD * maxD;
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) { const a = hash.get(hk(cx + dx, cz + dz)); if (!a) continue; for (const i of a) { const ex = P[i].x - x, ez = P[i].z - z, d = ex * ex + ez * ez; if (d < bd) { bd = d; best = i; } } }
      if (best < 0) return null;
      let i0 = best, i1 = best + 1;
      if (best > 0 && (best === N - 1 || (P[best - 1].x - x) ** 2 + (P[best - 1].z - z) ** 2 < (P[best + 1].x - x) ** 2 + (P[best + 1].z - z) ** 2)) { i0 = best - 1; i1 = best; }
      const A = P[i0], Bp = P[i1], sx = Bp.x - A.x, sz = Bp.z - A.z, t = clamp(((x - A.x) * sx + (z - A.z) * sz) / (sx * sx + sz * sz), 0, 1);
      const px = A.x + sx * t, pz = A.z + sz * t, h = A.h + wrapA(Bp.h - A.h) * t, rx = -Math.cos(h), rz = Math.sin(h);
      const lat = (x - px) * rx + (z - pz) * rz, s = (i0 + t) * STEP;
      return { s, lat, d: Math.abs(lat), y: Y[i0] + (Y[i1] - Y[i0]) * t, h, px, pz };
    };
    // ---- set pieces (positions) ----
    const sLog = tag.log, sM0 = tag.mud0, sM1 = tag.mud1, sGas = tag.gas, sC0 = tag.cl0, sC1 = tag.cl1, sRk = tag.rk, sCamp = tag.camp;
    const brP = at(sBr), brF = [Math.sin(brP.h), Math.cos(brP.h)], brR = [-Math.cos(brP.h), Math.sin(brP.h)];
    const river = { x: brP.x, z: brP.z, dx: brR[0], dz: brR[1], water: deckY - 5.5, w: 7 }; // runs across the road (along the road's right vector)
    const riverD = (x, z) => { const u = (x - river.x) * river.dx + (z - river.z) * river.dz, wig = 9 * Math.sin(u * 0.011) + 5 * Math.sin(u * 0.027 + 1); return { u, d: Math.abs((x - river.x) * river.dz - (z - river.z) * river.dx - wig * sstep(30, 120, Math.abs(u))) }; };
    const d0 = at(sD0), d1 = at(sD1), lake = { x: (d0.x + d1.x) / 2, z: (d0.z + d1.z) / 2, fx: (d1.x - d0.x), fz: (d1.z - d0.z), water: ferryY - 0.55 };
    { const l = Math.hypot(lake.fx, lake.fz); lake.fx /= l; lake.fz /= l; lake.half = l / 2; }
    const lakeD = (x, z) => { const a = (x - lake.x) * lake.fx + (z - lake.z) * lake.fz, b = (x - lake.x) * lake.fz - (z - lake.z) * lake.fx; return Math.hypot(a / (lake.half - 3), b / 520) - 1; }; // < 0 = water
    // flat pads: farm yard, logging yard, gas station, work site, camp
    const pads = [];
    const pad = (s, lat, hl, hw, bl, extra) => { const p = sideP(s, lat); const o = Object.assign({ x: p.x, z: p.z, h: p.h, hl, hw, bl, y: yAt(s) }, extra || {}); pads.push(o); return o; };
    const farm = pad(tag.start + 6, -20, 30, 16, 14), yard = pad(sLog - 23, 15, 17, 11, 10, { yard: 1 }), gas = pad(sGas + 2, -24, 30, 18, 14), work = pad(sRk - 115, -11, 15, 7.5, 6, { cut: 1 }), camp = pad(sCamp + 10, 0, 34, 26, 16);
    const W0 = { w: 0, a: 0, b: 0 };
    const padW = (x, z, pd) => { const rr = pd.hl + pd.hw + pd.bl; if ((x - pd.x) ** 2 + (z - pd.z) ** 2 > rr * rr) return W0; const a = (x - pd.x) * Math.sin(pd.h) + (z - pd.z) * Math.cos(pd.h), b = (x - pd.x) * -Math.cos(pd.h) + (z - pd.z) * Math.sin(pd.h), o = Math.max(Math.abs(a) - pd.hl, Math.abs(b) - pd.hw, 0); return { w: 1 - sstep(0, pd.bl, o), a, b }; };
    // cliff road: rock wall on the left, a drop to the valley on the right
    const cliffK = s => sstep(sC0 - 20, sC0 + 20, s) * (1 - sstep(sC1 - 20, sC1 + 20, s));
    // where the crew can't take the camper (thick brush): half widths per side
    const corridor = (s, side) => {
      if (Math.abs(s - sLog) < 70) { if (side > 0 && s > sLog - 42 && s < sLog - 5) return 27; return HW + 1.2; }
      if (s > sM0 - 25 && s < sM1 + 12) return HW + 2.5;
      if (cliffK(s) > 0.3) return HW + 3;
      if (Math.abs(s - sGas) < 40 && side < 0) return 44;
      if (s > sD0 - 30 && s < sD1 + 10) return HW + 3;
      if (s > sCamp - 10) return 40;
      if (s < tag.start + 40 && side < 0) return 38;
      return 22;
    };
    // ---- coarse height field: road heights spread out, so hills follow the road's climb ----
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; for (const p of P) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
    const M = 140, x0 = Math.floor((mnx - M) / CELL) * CELL, z0 = Math.floor((mnz - M) / CELL) * CELL, GW = Math.ceil((mxx + M - x0) / CELL) + 1, GH = Math.ceil((mxz + M - z0) / CELL) + 1;
    const CC = 16, cw = Math.ceil(GW * CELL / CC) + 2, ch = Math.ceil(GH * CELL / CC) + 2, C = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = x0 + i * CC, z = z0 + j * CC, cx = Math.floor(x / HC), cz = Math.floor(z / HC); let sw = 0, sy = 0;
      for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) { const a = hash.get(hk(cx + dx, cz + dz)); if (a) for (let k = 0; k < a.length; k += 3) { const p = P[a[k]], d2 = (p.x - x) ** 2 + (p.z - z) ** 2, w = 1 / (d2 + 900); sw += w; sy += w * Y[a[k]]; } }
      C[j * cw + i] = sw > 0 ? sy / sw : 30;
    }
    const cAt = (x, z) => { const fx = clamp((x - x0) / CC, 0, cw - 1.001), fz = clamp((z - z0) / CC, 0, ch - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * cw + i; return (C[k] * (1 - u) + C[k + 1] * u) * (1 - v) + (C[k + cw] * (1 - u) + C[k + cw + 1] * u) * v; };
    const natural = (x, z, d) => cAt(x, z) + (nz.fbm(x * 0.006 + 3, z * 0.006, 4) * 26 + nz(x * 0.03, z * 0.03) * 2.2) * sstep(16, 130, d) + Math.min(d, 220) * 0.035;
    const HV = new Float32Array(GW * GH), H = new Float32Array(GW * GH), RF = new Float32Array(GW * GH), RU = new Float32Array(GW * GH), RVv = new Float32Array(GW * GH), RD = new Float32Array(GW * GH);
    const shape = (x, z, q) => { // the drawn ground at a point (the drawbridge gap and the ferry crossing are open water)
      const d = q ? q.d : 999; let y = natural(x, z, d), rf = 0;
      if (q) {
        const yr = q.y, bw = q.s < tag.forest ? 22 : 14;
        y = lerp(yr, y, sstep(HW + 0.8, HW + 0.8 + bw, d));
        const ck = cliffK(q.s);
        if (ck > 0) { const lw = -q.lat, wall = yr + (15 + 5 * nz(x * 0.05, z * 0.05)) * sstep(HW + 1.2, HW + 3.4, lw) + Math.max(0, lw - HW - 3.4) * 0.6, drop = yr - 18 * sstep(HW + 3, HW + 13, q.lat);
          if (lw > HW + 1.2) y = lerp(y, Math.max(y, wall), ck); else if (q.lat > HW + 3) y = lerp(y, Math.min(y, drop), ck); }
        rf = 1 - sstep(HW - 0.5, HW + 0.9, d + 0.5 * nz(x * 0.9 + 9, z * 0.9));
      }
      for (const pd of pads) { const r = padW(x, z, pd); if (r.w > 0) { y = lerp(y, pd.y, r.w); if (pd.cut && r.w > 0.99) y = pd.y; } }
      // mud hill: steep walls of brush either side
      if (q && q.s > sM0 - 20 && q.s < sM1 + 10) y += sstep(HW + 3, HW + 12, q.d) * 7 * sstep(sM0 - 20, sM0, q.s) * (1 - sstep(sM1, sM1 + 10, q.s));
      const keep = q && q.d < HW + 2.6 && ((Math.abs(q.s - sBr) > 10.2 && Math.abs(q.s - sBr) < 45) || (q.s > sD0 - 45 && q.s < sD0 + 0.6) || (q.s > sD1 - 0.6 && q.s < sD1 + 45)); // abutments and piers keep the road
      const rv = riverD(x, z);
      if (!keep && rv.d < 26 && Math.abs(rv.u) < 900) { const bed = river.water - 1.9 + 0.6 * sstep(0, river.w, rv.d), bank = lerp(bed, y, sstep(river.w - 1, 22, rv.d)); if (bank < y) { y = bank; if (rv.d < river.w + 2) rf = 0; } }
      const lk = lakeD(x, z);
      if (!keep && lk < 0.35) { const bed = lake.water - 0.6 - 3.5 * sstep(-0.02, -0.3, lk), sh = lerp(bed, y, sstep(-0.02, 0.35, lk)); if (sh < y) { y = sh; if (lk < 0) rf = 0; } }
      return { y, rf };
    };
    const t0 = performance.now();
    // nearest road point per 8 m lattice node, so each grid cell only searches a few short windows of the road
    const LC = 8, lw = Math.ceil(GW * CELL / LC) + 2, lh = Math.ceil(GH * CELL / LC) + 2, LN = new Int32Array(lw * lh).fill(-1);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) { const q = near(x0 + i * LC, z0 + j * LC, 150); if (q) LN[j * lw + i] = Math.round(q.s / STEP); }
    const PX = new Float64Array(N), PZ = new Float64Array(N); for (let k = 0; k < N; k++) { PX[k] = P[k].x; PZ[k] = P[k].z; }
    const nearG = (x, z) => {
      const fi = Math.floor((x - x0) / LC), fj = Math.floor((z - z0) / LC); let best = -1, bd = 130 * 130;
      const c0 = LN[Math.min(lh - 1, fj) * lw + Math.min(lw - 1, fi)], c1 = LN[Math.min(lh - 1, fj) * lw + Math.min(lw - 1, fi + 1)], c2 = LN[Math.min(lh - 1, fj + 1) * lw + Math.min(lw - 1, fi)], c3 = LN[Math.min(lh - 1, fj + 1) * lw + Math.min(lw - 1, fi + 1)];
      for (let n = 0; n < 4; n++) { const c = n === 0 ? c0 : n === 1 ? c1 : n === 2 ? c2 : c3; if (c < 0 || (n > 0 && c === c0) || (n > 1 && c === c1) || (n > 2 && c === c2)) continue;
        for (let k = Math.max(0, c - 7), ke = Math.min(N - 1, c + 7); k <= ke; k++) { const ex = PX[k] - x, ez = PZ[k] - z, d = ex * ex + ez * ez; if (d < bd) { bd = d; best = k; } } }
      if (best < 0) return null;
      let i0 = best, i1 = best + 1;
      if (best > 0 && (best === N - 1 || (P[best - 1].x - x) ** 2 + (P[best - 1].z - z) ** 2 < (P[best + 1].x - x) ** 2 + (P[best + 1].z - z) ** 2)) { i0 = best - 1; i1 = best; }
      const A = P[i0], Bp = P[i1], sx = Bp.x - A.x, sz = Bp.z - A.z, t = clamp(((x - A.x) * sx + (z - A.z) * sz) / (sx * sx + sz * sz), 0, 1);
      const px = A.x + sx * t, pz = A.z + sz * t, h = A.h + wrapA(Bp.h - A.h) * t, lat = (x - px) * -Math.cos(h) + (z - pz) * Math.sin(h);
      return { s: (i0 + t) * STEP, lat, d: Math.abs(lat), y: Y[i0] + (Y[i1] - Y[i0]) * t, h };
    };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i, x = x0 + i * CELL, z = z0 + j * CELL, q = nearG(x, z);
      const r = shape(x, z, q); HV[k] = H[k] = r.y; RF[k] = r.rf; RD[k] = q ? q.d : 999; if (q) { RU[k] = q.lat; RVv[k] = q.s; }
    }
    S0.buildMs = performance.now() - t0;
    const gridAt = (A, x, z) => { const fx = clamp((x - x0) / CELL, 0, GW - 1.001), fz = clamp((z - z0) / CELL, 0, GH - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * GW + i; const a = A[k], b = A[k + 1], c = A[k + GW], d = A[k + GW + 1]; return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v); };
    // dynamic surfaces (drawbridge deck, ferry raft) are added by the game through S.decks
    const S = { L, P, Y, at, near, sideP, yAt, tag, cfg: { tod: 'autumnDay' }, B, noise: nz, logs: [], zones: [], pads, farm, yard, gas, work, camp, river, riverD, lake, lakeD, corridor, cliffK, deckY, ferryY, HW, decks: [] };
    const heightAt = (x, z) => { let y = gridAt(H, x, z); for (const dk of S.decks) { const v = dk.at(x, z); if (v !== null && v > y) y = v; } return y; };
    S.heightAt = heightAt; S.terrainAt = (x, z) => gridAt(H, x, z);
    S.vAt = (x, z) => gridAt(HV, x, z);
    S.groundAt = (x, z) => { const i = Math.round((x - x0) / CELL), j = Math.round((z - z0) / CELL); if (i >= 0 && j >= 0 && i < GW && j < GH) return gridAt(HV, x, z); return natural(x, z, 300); };
    S.normalAt = (x, z, out) => { const e = 0.6, hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e); out.set(-hx, 2 * e, -hz).normalize(); return out; };
    S.grid = { x0, z0, GW, GH, H, HV, RF, RU, RV: RVv, RD };
    S.zoneAt = s => (s > sM0 - 6 && s < sM1 + 2 ? MUD : null);
    // ---- trees and colliders ----
    const trees = [], TC = 8, thash = new Map();
    const addT = t => { trees.push(t); const k = hk(Math.floor(t.x / TC), Math.floor(t.z / TC)); let a = thash.get(k); if (!a) thash.set(k, a = []); a.push(t); return t; };
    S.trees = trees; S.addT = addT; S.treesNear = (x, z, out) => { out.length = 0; const cx = Math.floor(x / TC), cz = Math.floor(z / TC); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = thash.get(hk(cx + dx, cz + dz)); if (a) for (const t of a) out.push(t); } return out; };
    const onPad = (x, z, m) => pads.some(pd => { const a = (x - pd.x) * Math.sin(pd.h) + (z - pd.z) * Math.cos(pd.h), b = (x - pd.x) * -Math.cos(pd.h) + (z - pd.z) * Math.sin(pd.h); return Math.abs(a) < pd.hl + (m || 3) && Math.abs(b) < pd.hw + (m || 3); });
    const keepOut = (x, z, q) => { if (onPad(x, z, 4)) return true; const rv = riverD(x, z); if (rv.d < river.w + 3) return true; if (lakeD(x, z) < 0.04) return true; if (q && cliffK(q.s) > 0.2 && (q.lat < -(HW + 1) && q.lat > -(HW + 9) || q.lat > HW + 2 && q.lat < HW + 14)) return true; return false; };
    for (let gx = x0 + 3; gx < x0 + GW * CELL - 3; gx += 4.2) for (let gz = z0 + 3; gz < z0 + GH * CELL - 3; gz += 4.2) {
      const x = gx + (rnd() - 0.5) * 3.6, z = gz + (rnd() - 0.5) * 3.6, q = nearG(x, z); if (q && q.d > 110) continue; if (!q) continue;
      if (q.d < HW + 2.8 || keepOut(x, z, q)) continue;
      const s = q.s, forest = s > tag.forest - 30 && s < sGas - 120, river2 = s > sBr - 200 && s < sBr + 120, cliff = cliffK(s) > 0.2, lakeSide = s > sD0 - 260;
      let dens = forest ? 0.62 : cliff ? 0.42 : river2 ? 0.36 : lakeSide ? 0.32 : s < tag.forest ? 0.07 : 0.26;
      if (q.d < 14) dens *= forest ? 1.25 : 0.7;
      if (Math.abs(s - sLog) < 70 || (s > sM0 - 20 && s < sM1 + 12)) dens = 0.9; // walls of trees around the puzzles
      if (q.d > 75) dens *= 0.6;
      if (rnd() > dens) continue;
      const y = S.vAt(x, z); let kind;
      if (s < tag.forest) kind = rnd() < 0.55 ? 3 : rnd() < 0.5 ? 6 : 10;
      else if (forest) kind = rnd() < 0.5 ? 0 : rnd() < 0.6 ? 1 : 2;
      else if (lakeSide) kind = rnd() < 0.55 ? 1 : rnd() < 0.5 ? 3 : 0;
      else if (cliff) kind = rnd() < 0.6 ? 2 : 0;
      else kind = rnd() < 0.4 ? 3 : rnd() < 0.5 ? 0 : rnd() < 0.5 ? 6 : 2;
      if (kind === 10 && (q.d < 9 || onPad(x, z, 12))) kind = 6;
      const sc = kind === 6 ? 0.8 + rnd() * 0.6 : 0.75 + rnd() * 0.5;
      addT({ x, z, y, kind, r: kind === 6 ? 0.5 : kind === 10 ? 0.85 : 0.32 * sc + 0.12, sc, rot: rnd() * 6.28, soft: kind === 6 });
    }
    // invisible brush walls along the corridor (only around the set pieces; elsewhere the camper is free to wander)
    S.wallsAt = []; const wallStretch = (s0, s1, side) => { for (let s = s0; s <= s1; s += 1.4) { const o = sideP(s, side * corridor(s, side)); addT({ x: o.x, z: o.z, y: o.y, kind: 8, r: 0.8 }); } };
    wallStretch(sLog - 70, sLog + 70, -1); wallStretch(sLog - 5, sLog + 70, 1); wallStretch(sLog - 70, sLog - 42, 1);
    for (const s of [sLog - 42, sLog - 5]) for (let l = HW + 1.2; l < 27; l += 1.4) { const o = sideP(s, l); addT({ x: o.x, z: o.z, y: o.y, kind: 8, r: 0.8 }); } // yard ends
    { const pd = yard; for (let u = -pd.hl; u <= pd.hl; u += 1.4) { const x = pd.x + Math.sin(pd.h) * u - Math.cos(pd.h) * (pd.hw + 1), z = pd.z + Math.cos(pd.h) * u + Math.sin(pd.h) * (pd.hw + 1); addT({ x, z, y: pd.y, kind: 8, r: 0.8 }); } }
    wallStretch(sM0 - 25, sM1 + 12, -1); wallStretch(sM0 - 25, sM1 + 12, 1);
    // cliff wall base and a low fence on the drop side
    for (let s = sC0; s <= sC1; s += 1.4) { if (cliffK(s) < 0.4) continue; const w = padW(sideP(s, -(HW + 1.6)).x, sideP(s, -(HW + 1.6)).z, work).w; if (w < 0.5) { const o = sideP(s, -(HW + 1.6)); addT({ x: o.x, z: o.z, y: o.y, kind: 8, r: 0.6 }); } }
    // ---- the fallen tree: root ball in the forest on the left, crown end on the right edge ----
    { const a = sideP(sLog, -10), b = sideP(sLog + 2, 5.8); S.log = { ax: a.x, az: a.z, bx: b.x, bz: b.z, rad: 0.55, top: 0, s: sLog, len: Math.hypot(b.x - a.x, b.z - a.z) }; S.logs.push(S.log); }
    // ---- winch anchors: the posts on the mud hill (trees work too) ----
    S.posts = [sideP(sM0 + 0.42 * (sM1 - sM0), -(HW + 2.2)), sideP(sM0 + 0.75 * (sM1 - sM0), HW + 2.2), sideP(sM1 + 12, -(HW + 2.4))].map(p => ({ x: p.x, z: p.z, y: heightAt(p.x, p.z) }));
    for (const p of S.posts) addT({ x: p.x, z: p.z, y: p.y, kind: 8, r: 0.35, post: 1 });
    // ---- rockslide ----
    S.boulders = []; { const r2 = mulberry(5); for (let i = 0; i < 7; i++) { const p = sideP(sRk + (r2() - 0.5) * 9, -HW + 0.6 + i * (2 * HW - 1.2) / 6 + (r2() - 0.5)); S.boulders.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z), r: 1.25 + r2() * 0.7, on: true, vx: 0, vz: 0 }); } }
    S.dynNear = (x, z, t, out) => { out.length = 0; for (const b of S.boulders) if (b.on && (b.x - x) ** 2 + (b.z - z) ** 2 < 64) out.push(b); return out; };
    S.debris = { s0: sRk - 18, s1: sRk + 22, on: false };
    // checkpoints the tow truck can drop you at (only once the camper has got past them)
    S.checks = [tag.start + 4, sLog + 16, sM1 + 20, sGas + 30, sBr + 40, sRk + 30, sD0 - 14, sD1 + 14];
    S.sAll = { start: tag.start, log: sLog, mud0: sM0, mud1: sM1, gas: sGas, br: sBr, cl0: sC0, cl1: sC1, rk: sRk, dock0: sD0, dock1: sD1, camp: sCamp };
    return S;
  }
  const MUD = { mu: 0.2, drag: 260 };
  const S0 = {};
  return { build, info: S0 };
})();
