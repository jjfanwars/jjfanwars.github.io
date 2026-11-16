'use strict';
// James Racing graphics: lofted car bodies with liveries, airfoil wings, lathe tyres with sidewall print, suspension,
// the cockpit (steering wheel, gloved hands with fingers, arms solved by two-bone IK), HDR post (bloom, speed blur,
// ACES, vignette, grain), cloud sky, environment map, sparks and tyre smoke, and the procedural PBR textures.
const JRG = (() => {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rnd = mulberry(91);
  // ---------- textures ----------
  const canvasTex = (w, h, fn, srgb = true, rep = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn(x, w, h, c); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  // tileable multi-octave value noise into a Float32 height field
  function heightField(n, octs, seed) {
    const r = mulberry(seed), H = new Float32Array(n * n);
    for (const [cells, amp] of octs) {
      const G = new Float32Array(cells * cells); for (let i = 0; i < G.length; i++) G[i] = r();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = x / n * cells, fy = y / n * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const g = (a, b) => G[((b % cells) * cells) + (a % cells)];
        H[y * n + x] += amp * lerp(lerp(g(x0, y0), g(x0 + 1, y0), sx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), sx), sy);
      }
    }
    return H;
  }
  function normalFrom(H, n, k) { return canvasTex(n, n, (x) => { const id = x.createImageData(n, n), d = id.data; for (let y = 0; y < n; y++) for (let i = 0; i < n; i++) { const h = (a, b) => H[((b + n) % n) * n + ((a + n) % n)], dx = (h(i + 1, y) - h(i - 1, y)) * k, dy = (h(i, y + 1) - h(i, y - 1)) * k, l = Math.hypot(dx, dy, 1), o = (y * n + i) * 4; d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255; } x.putImageData(id, 0, 0); }, false); }
  function colorFrom(H, n, fn) { return canvasTex(n, n, (x) => { const id = x.createImageData(n, n), d = id.data; for (let i = 0; i < n * n; i++) { const c = fn(H[i], i); d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); }); }
  const TX = {};
  function textures() {
    if (TX.tar) return TX;
    // asphalt: aggregate (fine noise + stones), slight large-scale blotches
    { const n = 512, H = heightField(n, [[4, 0.25], [32, 0.25], [128, 0.3], [256, 0.35]], 3); for (let i = 0; i < 2200; i++) { const cx = rnd() * n | 0, cy = rnd() * n | 0, r = 1 + rnd() * 2; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (a * a + b * b <= r * r) H[((cy + b + n) % n) * n + ((cx + a + n) % n)] += 0.35 * (1 - (a * a + b * b) / (r * r + 0.1)); }
      TX.tar = colorFrom(H, n, (h) => { const v = clamp(150 + (h - 0.75) * 120, 60, 255); return [v, v, v * 1.02]; }); TX.tarN = normalFrom(H, n, 3.2);
      TX.tarR = colorFrom(H, n, (h) => { const v = clamp(215 - (h - 0.7) * 120, 120, 255); return [v, v, v]; }); TX.tarR.colorSpace = THREE.NoColorSpace; }
    // grass with clumps and blades
    { const n = 512, H = heightField(n, [[6, 0.4], [40, 0.3], [160, 0.3], [512, 0.25]], 5);
      TX.grass = colorFrom(H, n, (h, i) => { const b = (i % 7 === 0 ? 14 : 0); return [clamp(70 + h * 70 + b, 0, 255), clamp(110 + h * 80 + b, 0, 255), clamp(42 + h * 36, 0, 255)]; }); TX.grassN = normalFrom(H, n, 2.5); }
    { const n = 256, H = heightField(n, [[64, 0.4], [256, 0.6]], 9);
      TX.gravel = colorFrom(H, n, (h) => { const v = 130 + h * 110; return [v, v * 0.93, v * 0.8]; }); TX.gravelN = normalFrom(H, n, 6); }
    // carbon weave
    TX.carbon = canvasTex(128, 128, (x) => { for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const g = x.createLinearGradient(i * 8, j * 8, i * 8 + ((i + j) % 2 ? 8 : 0), j * 8 + ((i + j) % 2 ? 0 : 8)); g.addColorStop(0, '#1d1e22'); g.addColorStop(0.5, '#3a3c42'); g.addColorStop(1, '#17181b'); x.fillStyle = g; x.fillRect(i * 8, j * 8, 8, 8); } });
    TX.carbon.repeat.set(10, 10);
    // armco: horizontal W-profile ridges
    TX.armco = canvasTex(64, 64, (x) => { const g = x.createLinearGradient(0, 0, 0, 64); [[0, '#7c8188'], [0.18, '#d3d7dc'], [0.33, '#8b9097'], [0.5, '#6a6f75'], [0.66, '#cfd3d8'], [0.82, '#868b92'], [1, '#6d7278']].forEach(([o, c]) => g.addColorStop(o, c)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.fillStyle = 'rgba(60,40,20,.15)'; for (let i = 0; i < 40; i++) x.fillRect(rnd() * 64, rnd() * 64, 2, 1); });
    // soft round puff and the contact shadow
    TX.puff = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, true, false);
    TX.ao = canvasTex(64, 128, (x) => { const id = x.createImageData(64, 128), d = id.data; for (let j = 0; j < 128; j++) for (let i = 0; i < 64; i++) { const u = Math.abs(i / 63 * 2 - 1), v = Math.abs(j / 127 * 2 - 1), a = Math.pow(clamp(1 - Math.max(Math.pow(u, 3), Math.pow(v, 4)), 0, 1), 1.4); d[(j * 64 + i) * 4 + 3] = a * 235; } x.putImageData(id, 0, 0); }, false, false);
    // deciduous tree card
    TX.tree = canvasTex(256, 256, (x) => {
      x.clearRect(0, 0, 256, 256); x.fillStyle = '#4b3a2a'; x.fillRect(122, 150, 12, 106);
      for (let i = 0; i < 1600; i++) { const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * 100, cx = 128 + Math.cos(a) * rr * 0.95, cy = 105 + Math.sin(a) * rr * 0.85; const sh = clamp(0.5 + (cx - cy) / 400 + (rnd() - 0.5) * 0.4, 0.15, 1); x.fillStyle = `rgb(${30 + sh * 50 | 0},${60 + sh * 70 | 0},${22 + sh * 25 | 0})`; x.beginPath(); x.ellipse(cx, cy, 5 + rnd() * 6, 4 + rnd() * 4, rnd() * 3, 0, 7); x.fill(); }
    }, true, false);
    TX.pine = canvasTex(128, 256, (x) => {
      x.clearRect(0, 0, 128, 256); x.fillStyle = '#3d2e22'; x.fillRect(60, 200, 8, 56);
      for (let i = 0; i < 1300; i++) { const t = rnd(), y = 10 + t * 200, w = t * 56, cx = 64 + (rnd() * 2 - 1) * w, sh = clamp(0.4 + (cx - 64) / 160 + (rnd() - 0.5) * 0.4, 0.1, 1); x.fillStyle = `rgb(${20 + sh * 30 | 0},${48 + sh * 50 | 0},${28 + sh * 26 | 0})`; x.fillRect(cx - 4, y, 8 + rnd() * 6, 3); }
    }, true, false);
    return TX;
  }

  // ---------- geometry helpers ----------
  const crI = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  // smooth body from cross-section keys {x, w, yb, yt, n (squareness), zc}; uv u along the car, v around
  function loft(keys, steps, ring, uX) {
    const K = keys, P = ['x', 'w', 'yb', 'yt', 'n', 'zc'], secs = [];
    for (let k = 0; k < K.length - 1; k++) for (let j = 0; j < steps + (k === K.length - 2 ? 1 : 0); j++) {
      const t = j / steps, a = K[Math.max(0, k - 1)], b = K[k], c = K[k + 1], d = K[Math.min(K.length - 1, k + 2)], s = {};
      for (const p of P) s[p] = crI(a[p] || 0, b[p] || 0, c[p] || 0, d[p] || 0, t); secs.push(s);
    }
    const pos = [], uv = [], idx = [], R1 = ring + 1;
    for (const s of secs) for (let i = 0; i <= ring; i++) {
      const a = i / ring * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), e = 2 / Math.max(s.n, 1.2);
      const z = s.zc + s.w * Math.sign(c) * Math.pow(Math.abs(c), e), y = (s.yb + s.yt) / 2 + (s.yt - s.yb) / 2 * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos.push(s.x, y, z); uv.push(uX(s.x), i / ring);
    }
    for (let k = 0; k < secs.length - 1; k++) for (let i = 0; i < ring; i++) { const a = k * R1 + i, b = a + 1, c = a + R1, d = c + 1; idx.push(a, c, b, b, c, d); }
    // end caps
    for (const [k, flip] of [[0, false], [secs.length - 1, true]]) { const s = secs[k], ci = pos.length / 3; pos.push(s.x, (s.yb + s.yt) / 2, s.zc); uv.push(uX(s.x), 0.5); for (let i = 0; i < ring; i++) { const a = k * R1 + i; flip ? idx.push(ci, a + 1, a) : idx.push(ci, a, a + 1); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    // make the winding face outwards
    const p = g.attributes.position, A = V3().fromBufferAttribute(p, idx[0]), B = V3().fromBufferAttribute(p, idx[1]), C = V3().fromBufferAttribute(p, idx[2]);
    const nrm = B.clone().sub(A).cross(C.clone().sub(A)), mid = A.clone().add(B).add(C).divideScalar(3), s0 = secs[0], out = V3(0, mid.y - (s0.yb + s0.yt) / 2, mid.z - s0.zc);
    if (nrm.dot(out) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
    g.computeVertexNormals(); return g;
  }
  // NACA-style cambered airfoil, leading edge at x = 0 pointing +x, extruded across the car (z)
  function wing(chord, thick, camber, span, aoa) {
    const sh = new THREE.Shape(), N = 14, up = [], lo = [];
    for (let i = 0; i <= N; i++) { const x = (1 - Math.cos(i / N * Math.PI)) / 2, yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4), yc = -camber * 4 * x * (1 - x); up.push([-x * chord, (yc + yt) * chord]); lo.push([-x * chord, (yc - yt) * chord]); }
    sh.moveTo(up[0][0], up[0][1]); for (const p of up.slice(1)) sh.lineTo(p[0], p[1]); for (const p of lo.reverse()) sh.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, curveSegments: 2 }); g.translate(0, 0, -span / 2); g.rotateZ(aoa); return g;
  }
  function plate(pts, th) { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]); const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); g.translate(0, 0, -th / 2); return g; }
  function rod(a, b, r, flat) { const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r, r, L, 6); if (flat) g.scale(1, 1, flat); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()); g.applyQuaternion(q); const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return g; }
  // merge non-indexed copies of geometries with position/normal/uv
  function merge(list) {
    const parts = list.map(g => { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.normal) n.computeVertexNormals(); return n; });
    let cnt = 0; for (const g of parts) cnt += g.attributes.position.count;
    const P = new Float32Array(cnt * 3), Nn = new Float32Array(cnt * 3), U = new Float32Array(cnt * 2); let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); m.setAttribute('uv', new THREE.BufferAttribute(U, 2)); m.computeBoundingSphere(); return m;
  }
  const mirrorZ = g => { const c = g.clone(); c.scale(1, 1, -1); const ix = c.index; if (ix) { const a = ix.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } } else { const p = c.attributes.position, n = c.attributes.normal, u = c.attributes.uv; for (let i = 0; i < p.count; i += 3) for (const at of [p, n, u].filter(Boolean)) { const sz = at.itemSize; for (let k = 0; k < sz; k++) { const t = at.array[(i + 1) * sz + k]; at.array[(i + 1) * sz + k] = at.array[(i + 2) * sz + k]; at.array[(i + 2) * sz + k] = t; } } } c.computeVertexNormals(); return c; };

  // ---------- the car (shared geometry, per-team materials) ----------
  const uX = x => (x + 2.7) / 5.9;
  let CARG = null;
  function carGeometry(CA, CB) {
    if (CARG) return CARG;
    const paint = [], dark = [], carbon = [], metal = [], red = [];
    // monocoque + nose (one loft so the join is smooth)
    paint.push(loft([
      { x: 3.04, w: 0.05, yb: 0.15, yt: 0.2, n: 2.2 }, { x: 2.85, w: 0.1, yb: 0.13, yt: 0.27, n: 2.4 }, { x: 2.4, w: 0.15, yb: 0.12, yt: 0.37, n: 2.6 },
      { x: 1.85, w: 0.21, yb: 0.1, yt: 0.48, n: 2.8 }, { x: 1.2, w: 0.3, yb: 0.08, yt: 0.6, n: 3.2 }, { x: 0.6, w: 0.37, yb: 0.07, yt: 0.64, n: 3.6 },
      { x: -0.1, w: 0.4, yb: 0.07, yt: 0.62, n: 3.6 }, { x: -0.45, w: 0.38, yb: 0.07, yt: 0.6, n: 3.6 }], 7, 28, uX));
    // sidepods with inlets, undercut, coke-bottle taper
    for (const s of [-1, 1]) {
      const g = loft([{ x: 0.68, w: 0.2, yb: 0.2, yt: 0.6, n: 3, zc: 0.62 }, { x: 0.45, w: 0.25, yb: 0.13, yt: 0.64, n: 3.2, zc: 0.62 }, { x: -0.2, w: 0.25, yb: 0.12, yt: 0.6, n: 3, zc: 0.6 },
        { x: -0.9, w: 0.19, yb: 0.13, yt: 0.5, n: 2.6, zc: 0.52 }, { x: -1.5, w: 0.1, yb: 0.15, yt: 0.38, n: 2.4, zc: 0.4 }, { x: -1.8, w: 0.06, yb: 0.16, yt: 0.3, n: 2.2, zc: 0.3 }], 6, 22, uX);
      paint.push(s > 0 ? g : mirrorZ(g));
      const inlet = new THREE.CircleGeometry(1, 20).scale(0.3, 0.21, 1).rotateY(Math.PI / 2).translate(0.7, 0.4, s * 0.62); dark.push(inlet);
    }
    // engine cover rising into the airbox over the driver's head
    paint.push(loft([{ x: -0.2, w: 0.2, yb: 0.55, yt: 0.95, n: 2.4 }, { x: -0.45, w: 0.27, yb: 0.3, yt: 1.02, n: 2.8 }, { x: -0.8, w: 0.3, yb: 0.25, yt: 0.92, n: 3 },
      { x: -1.3, w: 0.25, yb: 0.2, yt: 0.72, n: 2.8 }, { x: -1.85, w: 0.13, yb: 0.2, yt: 0.5, n: 2.4 }, { x: -2.1, w: 0.07, yb: 0.25, yt: 0.42, n: 2.2 }], 6, 24, uX));
    dark.push(new THREE.CircleGeometry(1, 16).scale(0.12, 0.09, 1).rotateY(Math.PI / 2).translate(-0.19, 0.83, 0)); // airbox intake
    dark.push(new THREE.CircleGeometry(1, 12).scale(0.05, 0.05, 1).rotateY(-Math.PI / 2).translate(-2.11, 0.33, 0)); // exhaust
    metal.push(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 14, 1, true).rotateZ(Math.PI / 2).translate(-2.06, 0.33, 0));
    carbon.push(plate([[-0.6, 0.95], [-1.8, 0.72], [-2.1, 0.86], [-1.0, 1.0]], 0.012)); // spine fin
    // cockpit opening rim and headrest
    { const pts = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(V3(0.1 + Math.cos(a) * 0.42 * (Math.cos(a) > 0 ? 1 : 0.78), 0.625, Math.sin(a) * 0.29)); } dark.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.035, 8, true)); }
    dark.push(new THREE.CircleGeometry(1, 24).scale(0.38, 0.27, 1).rotateX(-Math.PI / 2).translate(0.08, 0.618, 0));
    for (const s of [-1, 1]) dark.push(loft([{ x: -0.05, w: 0.05, yb: 0.6, yt: 0.66, n: 2.5, zc: s * 0.25 }, { x: -0.25, w: 0.08, yb: 0.6, yt: 0.78, n: 3, zc: s * 0.22 }, { x: -0.4, w: 0.08, yb: 0.6, yt: 0.82, n: 3, zc: s * 0.18 }], 4, 12, uX));
    // floor: plank, edges and diffuser
    { const sh = [[1.55, -0.55], [1.2, -0.95], [-1.45, -0.95], [-1.95, -0.55], [-1.95, 0.55], [-1.45, 0.95], [1.2, 0.95], [1.55, 0.55]];
      const g = plate(sh, 0.025).rotateX(Math.PI / 2).translate(0, 0.07, 0); carbon.push(g);
      for (const s of [-1, 1]) { carbon.push(plate([[1.1, 0], [-1.4, 0], [-1.4, 0.07], [1.1, 0.04]], 0.01).translate(0, 0.07, s * 0.96)); carbon.push(plate([[-1.5, 0.07], [-2.05, 0.3], [-2.05, 0.08]], 0.01).translate(0, 0, s * 0.55)); }
      carbon.push(plate([[-1.5, 0.07], [-2.06, 0.3], [-2.06, 0.32], [-1.5, 0.09]], 1.1).rotateY(0)); // diffuser roof
      for (let k = -2; k <= 2; k++) carbon.push(plate([[-1.6, 0.07], [-2.05, 0.28], [-2.05, 0.08]], 0.008).translate(0, 0, k * 0.17));
      metal.push(new THREE.BoxGeometry(2.2, 0.012, 0.3).translate(-0.1, 0.05, 0)); }
    // front wing: main plane, three flaps, endplates, nose pillars
    carbon.push(wing(0.34, 0.09, 0.05, 1.95, -0.06).translate(3.12, 0.1, 0));
    const flapCol = [paint, carbon, paint];
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { const span = 0.62, g = wing(0.13 - k * 0.012, 0.1, 0.05, span, -0.32 - k * 0.22).translate(2.86 - k * 0.1, 0.13 + k * 0.045, s * (0.36 + span / 2)); flapCol[k].push(g); }
    for (const s of [-1, 1]) { paint.push(plate([[3.14, 0.07], [2.62, 0.07], [2.56, 0.28], [2.82, 0.3], [3.14, 0.16]], 0.014).translate(0, 0, s * 0.98)); carbon.push(plate([[3.0, 0.12], [2.8, 0.12], [2.78, 0.22], [2.95, 0.2]], 0.01).translate(0, 0, s * 0.08)); }
    // rear wing: main plane, beam wing, endplates, swan-neck pylon (the DRS flap is separate)
    carbon.push(wing(0.3, 0.1, 0.06, 1.0, -0.12).translate(-2.1, 0.79, 0));
    carbon.push(wing(0.14, 0.12, 0.05, 0.85, -0.1).translate(-2.0, 0.42, 0)); carbon.push(wing(0.12, 0.12, 0.05, 0.85, -0.25).translate(-2.15, 0.47, 0));
    for (const s of [-1, 1]) paint.push(plate([[-2.02, 0.4], [-2.02, 0.96], [-2.18, 1.0], [-2.56, 0.97], [-2.56, 0.6], [-2.4, 0.42]], 0.014).translate(0, 0, s * 0.51));
    carbon.push(plate([[-2.05, 0.3], [-2.18, 0.3], [-2.3, 0.85], [-2.22, 0.88]], 0.03));
    // halo with a fairing on the centre pillar
    { const loop = new THREE.CatmullRomCurve3([V3(-0.36, 0.62, -0.31), V3(-0.24, 0.9, -0.3), V3(0.12, 0.965, -0.26), V3(0.38, 0.965, -0.11), V3(0.44, 0.965, 0), V3(0.38, 0.965, 0.11), V3(0.12, 0.965, 0.26), V3(-0.24, 0.9, 0.3), V3(-0.36, 0.62, 0.31)]);
      paint.push(new THREE.TubeGeometry(loop, 48, 0.02, 10)); paint.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.44, 0.965, 0), V3(0.54, 0.82, 0), V3(0.68, 0.6, 0)]), 12, 0.019, 10).scale(1, 1, 1.6)); }
    // mirrors on stalks, T-cam, camera pods
    for (const s of [-1, 1]) { paint.push(new THREE.SphereGeometry(1, 16, 10).scale(0.04, 0.05, 0.095).translate(0.5, 0.67, s * 0.42)); carbon.push(rod(V3(0.52, 0.6, s * 0.34), V3(0.5, 0.66, s * 0.4), 0.008, 2.5)); carbon.push(rod(V3(1.5, 0.52, s * 0.2), V3(1.5, 0.57, s * 0.25), 0.006)); paint.push(new THREE.CapsuleGeometry(0.02, 0.06, 4, 8).rotateZ(Math.PI / 2).translate(1.5, 0.57, s * 0.27)); }
    paint.push(new THREE.BoxGeometry(0.12, 0.04, 0.1).translate(-0.33, 1.06, 0)); carbon.push(new THREE.BoxGeometry(0.03, 0.04, 0.03).translate(-0.33, 1.03, 0));
    red.push(new THREE.BoxGeometry(0.03, 0.06, 0.1).translate(-2.21, 0.3, 0));
    // suspension: wishbones, push/pull rods, track rods, uprights (inside the wheels)
    for (const [ax, w0] of [[CA, 0.8], [-CB, 0.78]]) for (const s of [-1, 1]) {
      const z = s * (w0 - 0.13), ch = s * 0.24;
      for (const [yu, yc] of [[0.5, 0.48], [0.22, 0.17]]) { carbon.push(rod(V3(ax, yu, z), V3(ax + 0.3, yc, ch), 0.016, 2.2)); carbon.push(rod(V3(ax, yu, z), V3(ax - 0.28, yc, ch), 0.016, 2.2)); }
      carbon.push(rod(V3(ax + 0.02, 0.22, z * 0.95), V3(ax - 0.1, 0.5, s * 0.22), 0.014)); carbon.push(rod(V3(ax + 0.12, 0.36, z), V3(ax + 0.14, 0.34, ch), 0.011));
    }
    // DRS flap pivots at its leading edge
    const flap = wing(0.24, 0.1, 0.07, 1.0, 0);
    CARG = { paint: merge(paint), dark: merge(dark), carbon: merge(carbon), metal: merge(metal), red: merge(red), flap };
    return CARG;
  }
  // tyres: lathe with sidewall bulge; uv v runs across the profile so the print sits on the sidewalls
  const TYG = {};
  function tyreGeo(w) {
    if (TYG[w]) return TYG[w];
    const h = w / 2, pts = [[0.234, -h * 0.9], [0.27, -h * 1.0], [0.315, -h * 1.03], [0.345, -h * 0.97], [0.358, -h * 0.82], [0.362, -h * 0.4], [0.362, h * 0.4], [0.358, h * 0.82], [0.345, h * 0.97], [0.315, h * 1.03], [0.27, h * 1.0], [0.234, h * 0.9]].map(p => new THREE.Vector2(p[0], p[1]));
    const g = new THREE.LatheGeometry(pts, 48); g.rotateX(Math.PI / 2); TYG[w] = g; return g;
  }
  const TYT = {};
  function tyreTex(col) {
    if (TYT[col]) return TYT[col];
    TYT[col] = canvasTex(1024, 128, (x) => {
      const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#202022'); g.addColorStop(0.3, '#1a1a1b'); g.addColorStop(0.42, '#141415'); g.addColorStop(0.58, '#141415'); g.addColorStop(0.7, '#1a1a1b'); g.addColorStop(1, '#202022'); x.fillStyle = g; x.fillRect(0, 0, 1024, 128);
      for (let i = 0; i < 900; i++) { x.fillStyle = 'rgba(255,255,255,.03)'; x.fillRect(rnd() * 1024, 44 + rnd() * 40, 3 + rnd() * 10, 1); }
      for (const y0 of [16, 104]) { x.fillStyle = col; x.fillRect(0, y0 - 3, 1024, 6); x.fillStyle = 'rgba(255,255,255,.88)'; x.font = 'bold 13px system-ui'; for (let k = 0; k < 4; k++) { x.save(); x.translate(k * 256 + 40, y0 + (y0 < 64 ? 22 : -10)); if (y0 > 64) x.scale(1, -1); x.fillText('J R   S L I C K', 0, y0 > 64 ? 0 : 0); x.restore(); } }
    }, true, true);
    return TYT[col];
  }
  const COVT = {};
  function coverTex(blur) {
    const k = blur ? 'b' : 's'; if (COVT[k]) return COVT[k];
    COVT[k] = canvasTex(256, 256, (x) => {
      const g = x.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, '#3a3c41'); g.addColorStop(0.75, '#1c1d20'); g.addColorStop(1, '#0d0d0e'); x.fillStyle = g; x.beginPath(); x.arc(128, 128, 128, 0, 7); x.fill();
      if (!blur) { x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 3; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; x.beginPath(); x.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30); x.lineTo(128 + Math.cos(a + 0.25) * 110, 128 + Math.sin(a + 0.25) * 110); x.stroke(); } x.fillStyle = '#ffffff'; x.font = 'bold 18px system-ui'; x.textAlign = 'center'; x.fillText('JR', 128, 74); }
      else { x.strokeStyle = 'rgba(255,255,255,.07)'; for (let r = 30; r < 120; r += 6) { x.beginPath(); x.arc(128, 128, r, 0, 7); x.stroke(); } }
      x.fillStyle = '#d0a020'; x.beginPath(); x.arc(128, 128, 16, 0, 7); x.fill();
    }, true, false);
    return COVT[k];
  }
  // livery: u = along the car (nose on the right), v = around the section (0 right side, .25 top, .5 left, .75 bottom)
  function livery(team) {
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    return canvasTex(1024, 512, (x, W, H) => {
      x.fillStyle = hex(team.c); x.fillRect(0, 0, W, H);
      const vy = v => H * (1 - v);
      // dark lower body
      x.fillStyle = 'rgba(12,12,14,.85)'; x.fillRect(0, vy(0.92), W, H * 0.25); x.fillStyle = 'rgba(12,12,14,.55)'; x.fillRect(0, vy(0.97), W, H * 0.05);
      // swooshes along both sides, widening towards the rear
      for (const v0 of [0.02, 0.5]) { x.fillStyle = hex(team.c2); x.beginPath(); x.moveTo(W, vy(v0 + 0.01)); x.bezierCurveTo(W * 0.7, vy(v0 + 0.02), W * 0.45, vy(v0 + 0.12), 0, vy(v0 + 0.13)); x.lineTo(0, vy(v0 + 0.05)); x.bezierCurveTo(W * 0.4, vy(v0 + 0.05), W * 0.7, vy(v0 - 0.0), W, vy(v0 - 0.015)); x.fill(); }
      x.fillStyle = hex(team.c2); x.fillRect(W * 0.55, vy(0.265), W * 0.45, H * 0.03); x.fillRect(0, vy(0.262), W * 0.3, H * 0.024);
      x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(W * 0.6, vy(0.285), W * 0.4, H * 0.006); x.fillRect(W * 0.6, vy(0.235), W * 0.4, H * 0.006);
      // team name on the flanks (left side drawn rotated)
      x.font = 'italic 900 34px system-ui'; x.fillStyle = '#fff'; x.textAlign = 'center';
      x.fillText(team.name.toUpperCase(), W * 0.36, vy(0.075)); x.save(); x.translate(W * 0.36, vy(0.425)); x.rotate(Math.PI); x.fillText(team.name.toUpperCase(), 0, 0); x.restore();
      x.font = '700 16px system-ui'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText('JR · ' + team.name.split(' ')[0].toUpperCase() + ' · POWER UNIT', W * 0.18, vy(0.1)); x.save(); x.translate(W * 0.18, vy(0.4)); x.rotate(Math.PI); x.fillText('JR · ' + team.name.split(' ')[0].toUpperCase() + ' · POWER UNIT', 0, 0); x.restore();
    }, true, false);
  }
  const MAT = {};
  function materials(team, comp) {
    const k = team.name; textures();
    if (!MAT[k]) MAT[k] = {
      paint: new THREE.MeshPhysicalMaterial({ map: livery(team), roughness: 0.38, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 }),
      helm: new THREE.MeshPhysicalMaterial({ color: team.c2, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    };
    if (!MAT.carbon) {
      MAT.carbon = new THREE.MeshPhysicalMaterial({ map: TX.carbon, color: 0xbbbbbb, roughness: 0.42, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.15 });
      MAT.dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85 });
      MAT.metal = new THREE.MeshStandardMaterial({ color: 0x8c8f94, roughness: 0.25, metalness: 1 });
      MAT.red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a00, emissiveIntensity: 0 });
      MAT.visor = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, metalness: 0.9, clearcoat: 1 });
      MAT.coverS = new THREE.MeshStandardMaterial({ map: coverTex(false), roughness: 0.4, metalness: 0.6 }); MAT.coverB = new THREE.MeshStandardMaterial({ map: coverTex(true), roughness: 0.4, metalness: 0.6 });
      MAT.rim = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
    }
    const tk = 'ty' + comp; if (!MAT[tk]) MAT[tk] = new THREE.MeshStandardMaterial({ map: tyreTex(F1.COMP[comp].col), roughness: 0.88 });
    return Object.assign({}, MAT, MAT[k], { tyre: MAT[tk] });
  }
  function helmetTex(team) {
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    return canvasTex(256, 128, (x) => { x.fillStyle = hex(team.c2); x.fillRect(0, 0, 256, 128); x.fillStyle = hex(team.c); x.fillRect(0, 50, 256, 26); x.fillStyle = '#fff'; x.fillRect(0, 46, 256, 4); x.fillRect(0, 76, 256, 4); for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? hex(team.c) : '#fff'; x.beginPath(); x.moveTo(i * 44, 0); x.lineTo(i * 44 + 22, 40); x.lineTo(i * 44 + 44, 0); x.fill(); } }, true, false);
  }
  function makeCar(team, num, comp, mine, F) {
    const G0 = carGeometry(F.CA, F.CB), Mt = materials(team, comp), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const add = (geo, m, par) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; (par || body).add(o); return o; };
    add(G0.paint, Mt.paint); add(G0.dark, Mt.dark); add(G0.carbon, Mt.carbon); add(G0.metal, Mt.metal); const light = add(G0.red, Mt.red.clone());
    const flapP = new THREE.Group(); flapP.position.set(-2.32, 0.87, 0); body.add(flapP); const flap = add(G0.flap, Mt.paint, flapP); flap.rotation.z = -0.5;
    // driver: helmet in team colours, visor, shoulders in the suit
    if (!Mt.helmT) Mt.helmT = MAT[team.name].helmT = new THREE.MeshPhysicalMaterial({ map: helmetTex(team), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    const helm = add(new THREE.SphereGeometry(0.13, 24, 16).scale(1.08, 1, 0.95), Mt.helmT); helm.position.set(-0.08, 0.81, 0); helm.rotation.z = 0.2;
    const visor = add(new THREE.SphereGeometry(0.132, 20, 8, -1.0, 2.0, 1.25, 0.42).scale(1.08, 1, 0.95), Mt.visor); visor.position.copy(helm.position); visor.rotation.y = Math.PI / 2 * 0; visor.rotation.set(0, -Math.PI / 2, 0.2);
    if (mine) { helm.visible = false; visor.visible = false; }
    // race number on the nose
    { const t = canvasTex(128, 64, (x) => { x.clearRect(0, 0, 128, 64); x.fillStyle = '#fff'; x.font = 'italic 900 50px system-ui'; x.textAlign = 'center'; x.fillText(num, 64, 50); }, true, false);
      const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4 })); nm.position.set(2.15, 0.455, 0); nm.rotation.z = -0.2; body.add(nm); }
    // wheels: tyre, rim barrel, cover (sharp or speed-blurred), wheel-wake winglets on the fronts
    const wheels = [];
    for (const [x, z, w, fr] of [[F.CA, -0.8, 0.3, 1], [F.CA, 0.8, 0.3, 1], [-F.CB, -0.78, 0.4, 0], [-F.CB, 0.78, 0.4, 0]]) {
      const piv = new THREE.Group(); piv.position.set(x, 0.362, z); g.add(piv); const spin = new THREE.Group(); piv.add(spin);
      add(tyreGeo(w), Mt.tyre, spin); const barrel = add(new THREE.CylinderGeometry(0.232, 0.232, w * 0.86, 24, 1, true).rotateX(Math.PI / 2), Mt.rim, spin);
      const covers = [];
      for (const sd of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(0.232, 32), Mt.coverS); c.position.z = sd * w * 0.43; if (sd < 0) c.rotation.y = Math.PI; spin.add(c); covers.push(c); }
      if (fr) { const wl = add(new THREE.TorusGeometry(0.39, 0.012, 4, 16, 1.4).rotateZ(0.85), Mt.carbon, piv); wl.scale.set(1, 1, 4); }
      wheels.push({ piv, spin, fr, covers });
    }
    // soft contact shadow
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.9).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.ao, color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false }));
    ao.position.set(0.2, 0.045, 0); ao.renderOrder = 1; g.add(ao);
    g.userData = { wheels, flap, body, spin: 0, helm: [helm, visor], light, Mt };
    return g;
  }
  function updateCar(c, dt) {
    const u = c.mesh.userData, blur = Math.abs(c.vx) > 18;
    for (const w of u.wheels) for (const cv of w.covers) cv.material = blur ? u.Mt.coverB : u.Mt.coverS;
    // rear light flashes while harvesting under braking or in harvest mode
    const on = (c.brk > 0.2 && c.v > 20) || c.ersMode === 0 ? ((performance.now() / 120 | 0) % 2) : 0; u.light.material.emissiveIntensity = on ? 3 : 0;
  }

  // ---------- cockpit: steering wheel, hands, arms ----------
  function steeringWheel(team) {
    const grp = new THREE.Group(), cf = MAT.carbon, rub = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 }), alu = MAT.metal;
    const sh = new THREE.Shape(); // face outline in (lateral, up)
    sh.moveTo(-0.1, -0.055); sh.quadraticCurveTo(0, -0.075, 0.1, -0.055); sh.lineTo(0.105, 0.05); sh.quadraticCurveTo(0.09, 0.075, 0.06, 0.07); sh.quadraticCurveTo(0, 0.085, -0.06, 0.07); sh.quadraticCurveTo(-0.09, 0.075, -0.105, 0.05); sh.lineTo(-0.1, -0.055);
    const body = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 8 }); body.rotateY(Math.PI / 2); body.translate(-0.015, 0, 0);
    const bm = new THREE.Mesh(body, cf); grp.add(bm);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.1, 6, 12), rub); grip.position.set(0.004, -0.005, s * 0.124); grip.rotation.x = s * 0.12; grp.add(grip);
      const join = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), cf); join.position.set(0, 0.045, s * 0.112); grp.add(join);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.06), cf); pad.position.set(0.03, 0.0, s * 0.07); pad.rotation.y = s * 0.15; grp.add(pad); // shift paddles
      // rotaries and buttons
      for (let k = 0; k < 3; k++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 14).rotateZ(Math.PI / 2), alu); r.position.set(-0.024, -0.03 + k * 0.0 - 0.0, s * (0.03 + k * 0.022)); r.position.y = -0.035; grp.add(r); }
      const cols = s < 0 ? [0xd02020, 0xe0e0e0, 0x2060e0] : [0x20b040, 0xf0c020, 0xe0e0e0];
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: cols[k], roughness: 0.4 })); b.position.set(-0.022, 0.035 - k * 0.022, s * 0.085); grp.add(b); }
    }
    return grp;
  }
  // a gloved hand wrapped round a grip. Grip axis is local y; side s: +1 right hand
  function hand(s, glove, palm, accent) {
    const h = new THREE.Group(), R = 0.035, fr = [0.0105, 0.0098, 0.0094, 0.0085];
    { const pm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12).scale(0.03, 0.05, 0.026), glove); pm.position.set(-0.026, -0.005, s * 0.024); h.add(pm); } // back of the hand / palm block
    for (let f = 0; f < 4; f++) {
      const y = 0.03 - f * 0.021, segs = [[100, 40], [40, -40], [-40, -115]], r = fr[f];
      for (let k = 0; k < 3; k++) {
        const a0 = segs[k][0] * Math.PI / 180, a1 = segs[k][1] * Math.PI / 180, rr = R - k * 0.002;
        const p0 = V3(Math.cos(a0) * rr, y, s * Math.sin(a0) * rr), p1 = V3(Math.cos(a1) * rr, y - 0.002 * k, s * Math.sin(a1) * rr), d = p1.clone().sub(p0), L = d.length();
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r - k * 0.0006, L, 4, 8), k === 2 ? palm : glove); m.position.copy(p0.clone().add(p1).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); h.add(m);
      }
    }
    // thumb lying on the face of the wheel, pointing in towards the buttons
    const t0 = V3(-0.028, 0.008, s * 0.01), t1 = V3(-0.032, 0.014, -s * 0.01), t2 = V3(-0.03, 0.017, -s * 0.026);
    for (const [a, b] of [[t0, t1], [t1, t2]]) { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, d.length(), 4, 8), glove); m.position.copy(a.clone().add(b).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); h.add(m); }
    // cuff
    // knuckle pad and the brand strip on the back of the glove
    const kn = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.022), accent); kn.position.set(-0.04, 0.0, s * 0.03); kn.rotation.y = s * 0.6; h.add(kn);
    const wrist = new THREE.Object3D(); wrist.position.set(-0.045, -0.05, s * 0.034); h.add(wrist);
    h.userData.wrist = wrist; return h;
  }
  function buildCockpit(g, team) {
    textures(); materials(team, 'M');
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    const sw = new THREE.Group(); sw.position.set(0.37, 0.645, 0); sw.rotation.order = 'ZXY'; sw.rotation.z = -0.3; g.add(sw);
    const inner = new THREE.Group(); sw.add(inner); inner.add(steeringWheel(team));
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10).rotateZ(Math.PI / 2), MAT.carbon); col.position.set(0.1, 0, 0); sw.add(col);
    const dc = document.createElement('canvas'); dc.width = 256; dc.height = 140; const dt = new THREE.CanvasTexture(dc); dt.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.066), new THREE.MeshBasicMaterial({ map: dt, toneMapped: false })); disp.rotation.y = -Math.PI / 2; disp.position.set(-0.0215, 0.012, 0); inner.add(disp);
    // gloves: team accent with dark palms and grip pads
    const glove = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.78, map: canvasTex(64, 64, (x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 64; i += 4) { x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(0, i, 64, 1); } }) }), palm = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.95 }), accent = new THREE.MeshStandardMaterial({ color: team.c2, roughness: 0.6 });
    const hands = [-1, 1].map(s => { const h = hand(s, glove, palm, accent); h.position.set(0.004, -0.005, s * 0.124); inner.add(h); return h; });
    // arms in the race suit, solved each frame from shoulder to wrist
    const suitT = canvasTex(64, 64, (x) => { x.fillStyle = hex(team.c); x.fillRect(0, 0, 64, 64); x.fillStyle = hex(team.c2); x.fillRect(0, 28, 64, 8); for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(255,255,255,.04)'; x.fillRect(rnd() * 64, rnd() * 64, 1, 2); } }, true, true);
    const suit = new THREE.MeshStandardMaterial({ map: suitT, roughness: 0.92 });
    const seg = (r0, r1) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 14, 1, true), suit); m.castShadow = true; g.add(m); const cap = new THREE.Mesh(new THREE.SphereGeometry(r0, 12, 8), suit); g.add(cap); return { m, cap }; };
    const arms = [-1, 1].map(s => { const cf = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.036, 1, 14), glove); g.add(cf); const band = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 1, 14, 1, true), accent); g.add(band); return { s, up: seg(0.05, 0.045), lo: seg(0.045, 0.038), cf, band, sh: V3(-0.2, 0.6, s * 0.2) }; });
    // mirrors: rear camera into a render target; each mirror shows its half
    const rt = new THREE.WebGLRenderTarget(512, 160, { type: THREE.HalfFloatType });
    const mcam = new THREE.PerspectiveCamera(22, 512 / 160, 0.3, 1500); mcam.position.set(-0.25, 1.16, 0); mcam.rotation.order = 'YXZ'; mcam.rotation.y = Math.PI / 2; mcam.rotation.x = -0.05; g.add(mcam);
    for (const s of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.15, 0.058), uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) { const u = uv.getX(k); uv.setX(k, s < 0 ? 0.5 + (1 - u) * 0.5 : (1 - u) * 0.5); }
      const mm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture })); mm.rotation.y = -Math.PI / 2; mm.position.set(0.455, 0.67, s * 0.42); g.add(mm);
    }
    const tmp = V3(), wv = V3(), dir = V3(), pole = V3(), E = V3(), up = V3(0, 1, 0);
    const place = (o, a, b) => { dir.copy(b).sub(a); const L = dir.length(); o.m.position.copy(a).add(b).multiplyScalar(0.5); o.m.quaternion.setFromUnitVectors(up, dir.normalize()); o.m.scale.set(1, L, 1); o.cap.position.copy(a); };
    function update(car) {
      g.updateMatrixWorld(true);
      for (let k = 0; k < 2; k++) {
        const A = arms[k], h = hands[k]; h.userData.wrist.getWorldPosition(tmp); g.worldToLocal(wv.copy(tmp));
        const S = A.sh, la = 0.3, lb = 0.3; dir.copy(wv).sub(S); let d = dir.length(); d = Math.min(d, la + lb - 0.005); dir.normalize();
        const along = (la * la - lb * lb + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, la * la - along * along));
        pole.set(-0.2, -1, A.s * 1.2); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
        E.copy(S).addScaledVector(dir, along).addScaledVector(pole, hh);
        place(A.up, S, E); place(A.lo, E, wv);
        dir.copy(wv).sub(E).normalize(); const c0 = wv.clone().addScaledVector(dir, -0.075);
        A.cf.position.copy(c0).add(wv).multiplyScalar(0.5); A.cf.quaternion.setFromUnitVectors(up, dir); A.cf.scale.set(1, 0.08, 1);
        A.band.position.copy(c0).addScaledVector(dir, 0.004); A.band.quaternion.copy(A.cf.quaternion); A.band.scale.set(1, 0.012, 1);
      }
    }
    return { sw, inner, dc, dx: dc.getContext('2d'), dt, rt, mcam, t: 0, update, arms };
  }

  // ---------- sky with clouds ----------
  function skyMaterial(H, Z, S) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { h: { value: H }, z: { value: Z }, s: { value: S }, t: { value: 0 } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform vec3 h; uniform vec3 z; uniform vec3 s; uniform float t; varying vec3 vp;
        float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hs(i), hs(i+vec2(1,0)), f.x), mix(hs(i+vec2(0,1)), hs(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float a = .5, r = 0.; for (int i = 0; i < 6; i++){ r += a * n2(p); p *= 2.03; a *= .5; } return r; }
        void main(){
          float y = clamp(vp.y, 0., 1.); vec3 c = mix(h, z, pow(y, .5));
          float d = max(dot(vp, s), 0.);
          if (vp.y > 0.) {
            vec2 uv = vp.xz / (vp.y + .12) * 1.6 + vec2(t * .004, 0.);
            float cl = smoothstep(.5, .78, fbm(uv)) * smoothstep(0., .25, vp.y);
            float sh = fbm(uv + s.xz * .08);
            vec3 cc = mix(vec3(1.02, 1.0, .98) * 1.25, vec3(.62, .66, .72), clamp((sh - .45) * 2.2, 0., 1.));
            c = mix(c, cc + vec3(1., .9, .7) * pow(d, 8.) * .6, cl * .9);
          }
          c += vec3(1., .92, .75) * (pow(d, 900.) * 40. + pow(d, 30.) * .35 + pow(d, 4.) * .08);
          if (vp.y < 0.) c = h * .95;
          gl_FragColor = vec4(c, 1.);
        }` });
  }
  function envMap(R, skyMat) {
    const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const gr = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4f5a45 })); gr.position.y = -2; sc.add(gr);
    const pm = new THREE.PMREMGenerator(R), rt = pm.fromScene(sc, 0.02); pm.dispose(); return rt.texture;
  }

  // ---------- HDR post: bloom, speed blur, chromatic edges, ACES, vignette, grain ----------
  function Post(R) {
    const mk = (w, h, ms) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: ms || 0, depthBuffer: !!ms });
    const P = { a: mk(4, 4, 4), b1: mk(2, 2), b2: mk(2, 2), on: true };
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), sc = new THREE.Scene(), oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); sc.add(quad); quad.frustumCulled = false;
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const bright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.3,.59,.11)); gl_FragColor = vec4(c * smoothstep(1.1, 2.6, l), 1.); }' });
    const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d).rgb + texture2D(t, vUv - d).rgb) * .195; c += (texture2D(t, vUv + d*2.).rgb + texture2D(t, vUv - d*2.).rgb) * .122; c += (texture2D(t, vUv + d*3.).rgb + texture2D(t, vUv - d*3.).rgb) * .054; c += (texture2D(t, vUv + d*4.).rgb + texture2D(t, vUv - d*4.).rgb) * .016; gl_FragColor = vec4(c, 1.); }' });
    const comp = new THREE.ShaderMaterial({ uniforms: { tC: { value: null }, tB: { value: null }, spd: { value: 0 }, time: { value: 0 }, res: { value: new THREE.Vector2() }, expo: { value: 1 }, hit: { value: 0 } }, vertexShader: vs,
      fragmentShader: `uniform sampler2D tC; uniform sampler2D tB; uniform float spd; uniform float time; uniform vec2 res; uniform float expo; uniform float hit; varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
        void main(){
          vec2 d = vUv - .5; float r = length(d * vec2(res.x/res.y, 1.));
          float k = spd * smoothstep(.25, .9, r);
          vec3 c = vec3(0.); for (int i = 0; i < 8; i++){ float tt = float(i) / 7.; c += texture2D(tC, vUv - d * k * tt).rgb; } c /= 8.;
          float ca = .0012 * r * r + hit * .006; c.r = mix(c.r, texture2D(tC, vUv + d * ca).r, .7); c.b = mix(c.b, texture2D(tC, vUv - d * ca).b, .7);
          c += texture2D(tB, vUv).rgb * .6;
          c *= expo; c = aces(c);
          c = pow(c, vec3(1./2.2));
          c = mix(vec3(dot(c, vec3(.299,.587,.114))), c, 1.08); c = (c - .5) * 1.04 + .5;
          c *= 1. - .38 * smoothstep(.45, 1.15, r);
          c += (fract(sin(dot(vUv * res + time, vec2(12.9898, 78.233))) * 43758.5453) - .5) * .022;
          gl_FragColor = vec4(c, 1.);
        }` });
    P.size = (w, h) => { P.a.setSize(w, h); const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2); P.b1.setSize(bw, bh); P.b2.setSize(bw, bh); comp.uniforms.res.value.set(w, h); };
    P.begin = () => R.setRenderTarget(P.a);
    P.end = (spd, hit) => {
      quad.material = bright; bright.uniforms.t.value = P.a.texture; R.setRenderTarget(P.b1); R.render(sc, oc);
      quad.material = blur; for (let i = 0; i < 2; i++) { blur.uniforms.t.value = P.b1.texture; blur.uniforms.d.value.set(1.5 / P.b1.width, 0); R.setRenderTarget(P.b2); R.render(sc, oc); blur.uniforms.t.value = P.b2.texture; blur.uniforms.d.value.set(0, 1.5 / P.b1.height); R.setRenderTarget(P.b1); R.render(sc, oc); }
      quad.material = comp; comp.uniforms.tC.value = P.a.texture; comp.uniforms.tB.value = P.b1.texture; comp.uniforms.spd.value = spd; comp.uniforms.hit.value = hit || 0; comp.uniforms.time.value = performance.now() % 1000;
      R.setRenderTarget(null); R.render(sc, oc);
    };
    P.comp = comp; return P;
  }

  // ---------- sparks and tyre smoke ----------
  function FX(scene) {
    textures();
    const NS = 260, sp = [], pos = new Float32Array(NS * 6), col = new Float32Array(NS * 6);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); lines.frustumCulled = false; scene.add(lines);
    for (let i = 0; i < NS; i++) sp.push({ l: 0 });
    const puffs = []; for (let i = 0; i < 60; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.puff, color: 0xdddddd, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); puffs.push({ s, l: 0 }); }
    let si = 0, pi = 0;
    return {
      spark(x, y, z, vx, vz) { const p = sp[si = (si + 1) % NS]; p.x = x; p.y = y; p.z = z; p.vx = vx * (0.75 + Math.random() * 0.3) + (Math.random() - 0.5) * 6; p.vz = vz * (0.75 + Math.random() * 0.3) + (Math.random() - 0.5) * 6; p.vy = 1 + Math.random() * 3; p.l = p.L = 0.25 + Math.random() * 0.35; },
      smoke(x, y, z, vx, vz, a) { const p = puffs[pi = (pi + 1) % puffs.length]; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vz = vz; p.l = p.L = 1.2 + Math.random(); p.a = a; p.s.visible = true; },
      step(dt) {
        for (let i = 0; i < NS; i++) { const p = sp[i], o = i * 6; if (p.l > 0) { p.l -= dt; p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.3; } const f = Math.max(0, p.l / p.L);
            pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z; pos[o + 3] = p.x - p.vx * 0.018; pos[o + 4] = p.y - p.vy * 0.018; pos[o + 5] = p.z - p.vz * 0.018; col[o] = 3 * f; col[o + 1] = 1.7 * f; col[o + 2] = 0.6 * f; col[o + 3] = 1.5 * f; col[o + 4] = 0.5 * f; col[o + 5] = 0.1 * f; }
          else { col[o] = col[o + 1] = col[o + 2] = col[o + 3] = col[o + 4] = col[o + 5] = 0; pos[o + 1] = pos[o + 4] = -10; } }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
        for (const p of puffs) { if (p.l <= 0) { p.s.visible = false; continue; } p.l -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 1 - dt * 2.5; p.vz *= 1 - dt * 2.5; p.y += dt * 0.5; const k = 1 - p.l / p.L; p.s.position.set(p.x, p.y, p.z); p.s.scale.setScalar(0.6 + k * 3.5); p.s.material.opacity = (1 - k) * 0.45 * p.a; }
      },
    };
  }
  return { textures, TX, makeCar, updateCar, buildCockpit, skyMaterial, envMap, Post, FX, canvasTex, merge };
})();
