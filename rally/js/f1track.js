'use strict';
// James Racing: circuit geometry. A closed centripetal Catmull-Rom loop sampled every 2 m, plus surfaces (kerbs, run-off, barriers),
// a minimum-curvature racing line (elastic band) and a speed profile along it for the AI and the racing-line assist.
const F1T = (() => {
  const STEP = 2;
  // Original circuits. Points run clockwise seen from above (x east, z south). hw = half width of the tarmac.
  const CIRCUITS = [
    { id: 'kestrel', name: 'Kestrel Park', hw: 7, laps: 5, pts: [
      [-250, 0], [100, 0], [500, 0], [820, 0], [900, 12], [936, 62], [946, 140], [950, 300], [926, 400], [966, 482], [928, 566],
      [936, 700], [906, 800], [836, 836], [772, 800], [756, 720], [744, 560], [700, 420], [640, 300], [560, 240], [400, 214], [200, 214],
      [112, 230], [72, 270], [22, 252], [-30, 214], [-200, 232], [-330, 182], [-382, 92], [-334, 20]] },
    { id: 'harbour', name: 'Marina Bay Loop', hw: 6.5, laps: 5, pts: [
      [0, 0], [420, 0], [700, 0], [760, 30], [770, 100], [720, 150], [640, 160], [600, 210], [610, 300], [680, 330], [760, 330],
      [830, 380], [840, 470], [790, 520], [560, 530], [330, 530], [250, 500], [230, 430], [280, 370], [270, 300], [190, 270],
      [100, 300], [40, 380], [-40, 400], [-120, 360], [-140, 260], [-100, 170], [-140, 90], [-110, 20], [-60, 0]] },
  ];

  function catmull(P, n) { // centripetal, closed
    const out = [], L = P.length;
    for (let i = 0; i < L; i++) {
      const p0 = P[(i - 1 + L) % L], p1 = P[i], p2 = P[(i + 1) % L], p3 = P[(i + 2) % L];
      const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
      const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      for (let k = 0; k < n; k++) {
        const t = t1 + (t2 - t1) * k / n;
        const lp = (a, b, ta, tb) => [a[0] * (tb - t) / (tb - ta) + b[0] * (t - ta) / (tb - ta), a[1] * (tb - t) / (tb - ta) + b[1] * (t - ta) / (tb - ta)];
        const A1 = lp(p0, p1, t0, t1), A2 = lp(p1, p2, t1, t2), A3 = lp(p2, p3, t2, t3), B1 = lp(A1, A2, t0, t2), B2 = lp(A2, A3, t1, t3);
        out.push(lp(B1, B2, t1, t2));
      }
    }
    return out;
  }
  // resample a closed polyline at an even spacing
  function resample(Q, step) {
    const cum = [0]; for (let i = 1; i <= Q.length; i++) { const a = Q[i - 1], b = Q[i % Q.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const len = cum[Q.length], N = Math.round(len / step), out = []; let j = 0;
    for (let k = 0; k < N; k++) {
      const s = k * len / N; while (cum[j + 1] < s) j++;
      const a = Q[j], b = Q[(j + 1) % Q.length], t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return { pts: out, len };
  }

  // physical constants shared with the car model (f1car.js reads these too)
  const AERO = { rho: 1.2, ClA: 5.0, CdA: 1.3, mass: 880, g: 9.81, mu: 1.75 };

  function build(ci) {
    const C = CIRCUITS[ci], hw = C.hw;
    const { pts, len } = resample(catmull(C.pts, 24), STEP), N = pts.length, ds = len / N;
    const X = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N), K = new Float32Array(N);
    for (let i = 0; i < N; i++) { X[i] = pts[i][0]; Z[i] = pts[i][1]; }
    const wi = i => (i % N + N) % N;
    for (let i = 0; i < N; i++) { const a = wi(i - 1), b = wi(i + 1); H[i] = Math.atan2(Z[b] - Z[a], X[b] - X[a]); }
    for (let i = 0; i < N; i++) K[i] = wrapA(H[wi(i + 3)] - H[wi(i - 3)]) / (6 * ds); // signed curvature, + = right turn
    // smoothed |curvature| decides kerbs and run-off
    const KS = new Float32Array(N); for (let i = 0; i < N; i++) { let m = 0; for (let j = -10; j <= 10; j++) m = Math.max(m, Math.abs(K[wi(i + j)])); KS[i] = m; }
    const kerb = new Uint8Array(N), gravel = new Uint8Array(N), barL = new Float32Array(N), barR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = KS[i]; kerb[i] = k > 1 / 320 ? 1 : 0;
      const ks = K[wi(i + 8)] || K[i]; // outside of the corner (looking a little ahead)
      const out = Math.min(34, 10 + k * 4200), inn = 6 + Math.min(6, k * 600);
      // gravel on the outside of slow/medium corners
      if (k > 1 / 150) gravel[i] = ks > 0 ? 1 : 2; // 1 = gravel on the left (outside of a right turn), 2 = on the right
      barL[i] = hw + (ks > 0 ? out : inn); barR[i] = hw + (ks > 0 ? inn : out);
    }
    // smooth barrier distances so walls don't zig-zag
    for (let it = 0; it < 30; it++) for (const B of [barL, barR]) { const c = B.slice(); for (let i = 0; i < N; i++) B[i] = Math.max(hw + 5, (c[wi(i - 1)] + c[i] * 2 + c[wi(i + 1)]) / 4); }
    // keep barriers from crossing another part of the track: clamp by the distance to the nearest non-local sample
    for (let i = 0; i < N; i += 1) {
      let best = 1e9, bestSide = 0;
      for (let j = 0; j < N; j += 2) { const dj = Math.abs(((j - i) % N + N + N / 2) % N - N / 2); if (dj * ds < 120) continue; const dx = X[j] - X[i], dz = Z[j] - Z[i], d2 = dx * dx + dz * dz; if (d2 < best) { best = d2; bestSide = -Math.sin(H[i]) * dx + Math.cos(H[i]) * dz; } }
      const room = Math.sqrt(best) / 2 - 1;
      if (bestSide > 0) barR[i] = Math.max(hw + 2.5, Math.min(barR[i], room)); else barL[i] = Math.max(hw + 2.5, Math.min(barL[i], room));
    }
    // pit wall on the left of the main straight (index 0 is the start line)
    const pitA = wi(-Math.round(220 / ds)), pitB = Math.round(260 / ds);
    // pit lane on the left from pitA to pitB; the pit wall stands between the entry and exit gaps (60 m each)
    const pit = new Uint8Array(N), lane = new Uint8Array(N), gap = Math.round(60 / ds);
    for (let i = pitA, k = 0; i !== pitB; i = wi(i + 1), k++) { lane[i] = 1; gravel[i] = 0; const inWall = k >= gap && wi(pitB - i) > gap; if (inWall) { barL[i] = hw + 4; pit[i] = 1; } else barL[i] = Math.max(barL[i], hw + 19); }

    const T = { C, name: C.name, hw, N, len, ds, X, Z, H, K, KS, kerb, gravel, barL, barR, wi, pit, lane, pitA, pitB, pitS0: -((N - pitA) % N) * ds, pitS1: pitB * ds };
    T.at = s => { const f = ((s / ds) % N + N) % N, i = Math.floor(f), t = f - i, j = wi(i + 1); return { x: X[i] + (X[j] - X[i]) * t, z: Z[i] + (Z[j] - Z[i]) * t, h: H[i] + wrapA(H[j] - H[i]) * t, i }; };
    // nearest sample around a hint (hint < 0: full search)
    T.query = (x, z, hint, out) => {
      out = out || {}; let bi = 0, bd = 1e18;
      if (hint < 0) { for (let i = 0; i < N; i += 4) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } } hint = bi; }
      for (let k = -24; k <= 24; k++) { const i = wi(hint + k), d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
      const h = H[bi], fx = Math.cos(h), fz = Math.sin(h), dx = x - X[bi], dz = z - Z[bi];
      const along = dx * fx + dz * fz; out.i = bi; out.s = bi * ds + along; out.d = -dx * fz + dz * fx; out.h = h; return out;
    };
    // surface at a lateral offset: 0 tarmac, 1 kerb, 2 grass, 3 gravel, 4 tarmac run-off
    T.surf = (i, d) => {
      const a = Math.abs(d); if (a <= hw) return 0;
      if (kerb[i] && a <= hw + 1.3) return 1;
      const g = gravel[i]; if ((g === 1 && d < 0) || (g === 2 && d > 0)) return a < hw + 2.5 ? 4 : 3;
      return a < hw + 3.5 ? 4 : 2;
    };

    // ---- racing line: elastic band towards minimum curvature ----
    const lim = hw - 1.25, L = new Float32Array(N), nx = new Float32Array(N), nz = new Float32Array(N);
    for (let i = 0; i < N; i++) { nx[i] = -Math.sin(H[i]); nz[i] = Math.cos(H[i]); }
    for (const st of [16, 8, 4]) for (let it = 0; it < 350; it++) for (let i = 0; i < N; i++) {
      const a = wi(i - st), b = wi(i + st);
      const mx = (X[a] + nx[a] * L[a] + X[b] + nx[b] * L[b]) / 2, mz = (Z[a] + nz[a] * L[a] + Z[b] + nz[b] * L[b]) / 2;
      const t = (mx - X[i]) * nx[i] + (mz - Z[i]) * nz[i]; L[i] = clamp(L[i] + (t - L[i]) * 0.5, -lim, lim);
    }
    const LX = new Float32Array(N), LZ = new Float32Array(N); for (let i = 0; i < N; i++) { LX[i] = X[i] + nx[i] * L[i]; LZ[i] = Z[i] + nz[i] * L[i]; }
    const LS = new Float32Array(N); // arc length between line points
    for (let i = 0; i < N; i++) { const j = wi(i + 1); LS[i] = Math.hypot(LX[j] - LX[i], LZ[j] - LZ[i]); }
    const LK = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = wi(i - 4), b = wi(i + 4), ax = LX[i] - LX[a], az = LZ[i] - LZ[a], bx = LX[b] - LX[i], bz = LZ[b] - LZ[i];
      const cr = ax * bz - az * bx, la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(LX[b] - LX[a], LZ[b] - LZ[a]);
      LK[i] = 2 * cr / (la * lb * lc || 1);
    }
    Object.assign(T, { L, LX, LZ, LS, LK, nx, nz });
    // speed profile for a grip factor (AI skill scales it)
    T.profile = (gripK, pw) => {
      const { rho, ClA, CdA, mass, g, mu } = AERO, m = mu * gripK * 0.95, k = 0.5 * rho * ClA / mass, kd = 0.5 * rho * CdA / mass, V = new Float32Array(N);
      for (let i = 0; i < N; i++) { let c = 0; for (let j = -6; j <= 6; j++) c = Math.max(c, Math.abs(LK[wi(i + j)]) * (1 - Math.abs(j) * 0.03)); V[i] = c > m * k + 1e-5 ? Math.min(96, Math.sqrt(m * g / (c - m * k))) : 96; }
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < N; i++) { const j = wi(i + 1), v = Math.max(V[i], 5), acc = Math.min((pw || 640000) / (mass * v), m * (g + k * v * v) * 0.55) - kd * v * v; V[j] = Math.min(V[j], Math.sqrt(v * v + 2 * Math.max(acc, 0) * LS[i])); }
        for (let i = N - 1; i >= 0; i--) { const j = wi(i + 1), v = V[j], dec = Math.min(m * (g + k * v * v) * 0.92, 50000 / mass) + kd * v * v; V[i] = Math.min(V[i], Math.sqrt(v * v + 2 * dec * LS[i])); }
      }
      return V;
    };
    T.V = T.profile(0.97);
    // heavy braking points (for braking boards): where the profile drops by > 25 m/s within 200 m
    T.brakes = []; for (let i = 0; i < N; i++) { const a = T.V[i], j = wi(i + Math.round(150 / ds)); if (a > 70 && a - T.V[j] > 28 && a >= T.V[wi(i - 1)] - 0.01 && a >= T.V[wi(i + 1)] - 0.01) { if (!T.brakes.some(b => Math.abs(wi(b - i + N / 2) - N / 2) < 150)) T.brakes.push(i); } }
    // DRS zones: the two longest full-throttle stretches; detection 60 m before each
    const runs = []; { let st = -1; for (let k = 0; k < N * 2; k++) { const i = wi(k), fast = KS[i] < 1 / 900; if (fast && st < 0) st = k; if ((!fast || k === N * 2 - 1) && st >= 0) { if (k - st > 120 && st < N) runs.push({ a: st, b: k }); st = -1; } } }
    runs.sort((p, q) => (q.b - q.a) - (p.b - p.a)); T.drs = runs.slice(0, 2).map(r => ({ a: wi(r.a + 20), b: wi(r.b - 30), det: wi(r.a - Math.round(60 / ds)) }));
    T.sectors = [0, Math.round(N / 3), Math.round(2 * N / 3)];
    return T;
  }
  return { CIRCUITS, build, AERO, STEP };
})();
