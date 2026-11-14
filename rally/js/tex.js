'use strict';
// Procedural textures (canvas): gravel road, forest floor, bark, needles, undergrowth, dust. Each has an albedo and, where useful, a normal map.
const TEX = (() => {
  const R = mulberry(77), N = makeNoise(5);
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // normal map from a height array (wraps)
  function normalFrom(hgt, w, h, str) {
    const c = cv(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = hgt[y * w + (x + w - 1) % w], r = hgt[y * w + (x + 1) % w], u = hgt[((y + h - 1) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
      let nx = (l - r) * str, ny = (u - dn) * str, nz = 1; const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      const k = (y * w + x) * 4; d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  const tnoise = (x, y, w, h, f) => { // tileable fbm by blending four samples
    const u = x / w, v = y / h, a = N.fbm(x * f, y * f, 4), b = N.fbm((x - w) * f, y * f, 4), c = N.fbm(x * f, (y - h) * f, 4), d = N.fbm((x - w) * f, (y - h) * f, 4);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  function tex(c, rep, srgb) { const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
  // road surface overlay: u across 12 m (lat -6..6), v along 16 m. Ruts, loose berms, verge colour; alpha = 1 - road paint.
  const VERGE = { gravel: [70, 82, 44], leaf: [120, 72, 30], snow: [236, 240, 248], sand: [205, 172, 128], tarmac: [150, 150, 148] };
  function road(kind, hw) {
    const w = 256, h = 512, c = cv(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data, hg = new Float32Array(w * h);
    const ruts = kind === 'tarmac' ? 0.25 : kind === 'sand' ? 0.6 : 1, vg = VERGE[kind] || VERGE.gravel, berms = kind === 'tarmac' ? 0 : 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const lat = (x / w - 0.5) * 12, al = Math.abs(lat);
      const rut = (Math.exp(-((al - 0.85) ** 2) / 0.09) + 0.55 * Math.exp(-((al - 2.25) ** 2) / 0.12)) * ruts;
      const berm = (Math.exp(-((al - 1.6) ** 2) / 0.1) * 0.6 + sstep(hw - 0.8, hw - 0.1, al) * 0.9) * berms;
      const n1 = tnoise(x, y, w, h, 0.05), n2 = tnoise(x + 99, y, w, h, 0.18), grain = R();
      let stone = 0; if (grain > 0.93) stone = 1; else if (grain > 0.82) stone = 0.5;
      const loose = clamp(berm + n1 * 0.4, 0, 1);
      let r = 128 + n1 * 26 + n2 * 14, gg = 108 + n1 * 22 + n2 * 12, b = 84 + n1 * 18 + n2 * 10;
      const comp = rut * (1 - loose * 0.6); r -= comp * 30; gg -= comp * 28; b -= comp * 22; // compacted, darker
      const sv = (grain - 0.5) * 60 * (0.4 + loose) * (berms ? 1 : 0.3); r += sv + stone * 30 * loose; gg += sv + stone * 26 * loose; b += sv + stone * 22 * loose;
      const vgT = sstep(hw - 0.5, hw + 1.1, al + n2 * (berms ? 0.6 : 0)); r = lerp(r, vg[0] + n2 * 20, vgT); gg = lerp(gg, vg[1] + n2 * 22, vgT); b = lerp(b, vg[2] + n2 * 10, vgT);
      let paint = 0;
      if (kind === 'tarmac') { const vv = (y / h) * 16; if (al < 0.07 && (vv % 8) < 3.5) paint = 1; if (Math.abs(al - (hw - 0.35)) < 0.07) paint = 1; paint *= 0.85 + 0.15 * R(); }
      const k = (y * w + x) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255 - paint * 170;
      hg[y * w + x] = n2 * 0.6 + (grain - 0.5) * (0.4 + loose * 1.6) * (berms ? 1 : 0.3) + stone * loose * 1.5 - rut * 0.8 + berm * 0.8;
    }
    g.putImageData(im, 0, 0);
    const map = tex(c, true, true), nrm = tex(normalFrom(hg, w, h, 1.6), true, false);
    map.wrapS = nrm.wrapS = THREE.ClampToEdgeWrapping; map.premultiplyAlpha = false; return { map, nrm };
  }
  // birch bark: white with dark horizontal lenticels
  function birch() {
    const w = 128, h = 256, c = cv(w, h), g = c.getContext('2d'); g.fillStyle = '#e8e4da'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${20 + R() * 30 | 0},${20 + R() * 25 | 0},${18 + R() * 20 | 0},${0.5 + R() * 0.5})`; g.fillRect(R() * w, R() * h, 4 + R() * 26, 1 + R() * 3); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(150,140,125,${R() * 0.25})`; g.fillRect(R() * w, R() * h, 2, 2); }
    return tex(c, true, true);
  }
  // autumn leaf clusters (alpha) for deciduous crowns
  function leaves() {
    const w = 256, h = 256, c = cv(w, h), g = c.getContext('2d');
    const cols = [[214, 150, 30], [230, 110, 25], [190, 60, 25], [240, 190, 60], [150, 140, 40], [200, 90, 30]];
    for (let i = 0; i < 700; i++) {
      const a = R() * 6.28, rr = Math.sqrt(R()) * 118, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr, cc = cols[R() * cols.length | 0], s = 0.7 + R() * 0.45;
      g.save(); g.translate(x, y); g.rotate(R() * 6.28); g.fillStyle = `rgb(${cc[0] * s | 0},${cc[1] * s | 0},${cc[2] * s | 0})`; g.beginPath(); g.ellipse(0, 0, 7 + R() * 4, 3.5 + R() * 2, 0, 0, 7); g.fill(); g.restore();
    }
    return tex(c, false, true);
  }
  // forest floor: needles, moss, dirt, twigs (world space, 6 m tile)
  function floor() {
    const w = 512, h = 512, c = cv(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data, hg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = tnoise(x, y, w, h, 0.012), n = tnoise(x + 300, y + 7, w, h, 0.06), gr = R();
      const moss = sstep(0.0, 0.35, m + n * 0.3);
      let r = lerp(92, 58, moss) + n * 18 + (gr - 0.5) * 26, gg = lerp(70, 80, moss) + n * 16 + (gr - 0.5) * 22, b = lerp(46, 38, moss) + n * 10 + (gr - 0.5) * 14;
      const k = (y * w + x) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255; hg[y * w + x] = n * 1.2 + (gr - 0.5) * 0.7 + moss * 0.5;
    }
    g.putImageData(im, 0, 0);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) { // needles and twigs
      const x = R() * w, y = R() * h, a = R() * 6.28, l = 3 + R() * 9, t = R();
      g.strokeStyle = t < 0.7 ? `rgba(${120 + R() * 50 | 0},${80 + R() * 30 | 0},${40 + R() * 20 | 0},${0.5 + R() * 0.4})` : `rgba(60,48,34,.7)`; g.lineWidth = t < 0.7 ? 0.8 : 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return { map: tex(c, true, true), nrm: tex(normalFrom(hg, w, h, 2.2), true, false) };
  }
  function bark() {
    const w = 128, h = 256, c = cv(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data, hg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ridge = Math.abs(Math.sin((x / w) * Math.PI * 9 + tnoise(x, y, w, h, 0.04) * 3)), n = tnoise(x, y * 0.3, w, h, 0.08);
      const v = 0.55 + ridge * 0.35 + n * 0.2, k = (y * w + x) * 4;
      d[k] = 74 * v + 10; d[k + 1] = 56 * v + 6; d[k + 2] = 42 * v + 4; d[k + 3] = 255; hg[y * w + x] = ridge + n;
    }
    g.putImageData(im, 0, 0); return { map: tex(c, true, true), nrm: tex(normalFrom(hg, w, h, 2.5), true, false) };
  }
  // needle clumps for foliage cones (alpha cut-out at the bottom edge so layers look ragged)
  function needles() {
    const w = 256, h = 256, c = cv(w, h), g = c.getContext('2d');
    g.fillStyle = '#1f3a22'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const x = R() * w, y = R() * h, a = Math.PI / 2 + (R() - 0.5) * 1.4, l = 4 + R() * 8, s = 0.6 + R() * 0.6; g.strokeStyle = `rgb(${(30 + R() * 30) * s | 0},${(60 + R() * 50) * s | 0},${(30 + R() * 25) * s | 0})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    // ragged lower edge
    const id = g.getImageData(0, 0, w, h), d = id.data;
    for (let x = 0; x < w; x++) { const cut = h - 6 - (N(x * 0.15, 3) * 0.5 + 0.5) * 46 - R() * 10; for (let y = Math.floor(cut); y < h; y++) d[(y * w + x) * 4 + 3] = 0; }
    g.putImageData(id, 0, 0);
    return tex(c, true, true);
  }
  // undergrowth atlas: left half fern, right half grass tuft (alpha)
  function plants() {
    const w = 512, h = 256, c = cv(w, h), g = c.getContext('2d');
    g.lineCap = 'round';
    for (let f = 0; f < 9; f++) { // fern fronds
      const a = -Math.PI / 2 + (f - 4) * 0.33, len = 95 + R() * 30; let x = 128, y = 250;
      for (let s = 0; s < 1; s += 0.04) {
        const px = x + Math.cos(a) * len * s + (f - 4) * s * s * 25, py = y + Math.sin(a) * len * s + s * s * 40, wl = (1 - s) * 22;
        g.strokeStyle = `rgb(${50 + R() * 20 | 0},${100 + R() * 30 | 0},${40 + R() * 15 | 0})`; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px - Math.sin(a) * wl, py + Math.cos(a) * wl * 0.4 - 4); g.stroke();
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(a) * wl, py - Math.cos(a) * wl * 0.4 - 4); g.stroke();
      }
    }
    for (let i = 0; i < 160; i++) { // grass blades
      const x = 300 + R() * 170, a = -Math.PI / 2 + (R() - 0.5) * 0.9, l = 70 + R() * 150, s = R();
      g.strokeStyle = `rgb(${90 + s * 60 | 0},${110 + s * 50 | 0},${50 + s * 20 | 0})`; g.lineWidth = 1.5 + R() * 1.5;
      g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5, 256 + Math.sin(a) * l * 0.5, x + Math.cos(a) * l + (R() - 0.5) * 30, 256 + Math.sin(a) * l); g.stroke();
    }
    return tex(c, false, true);
  }
  // a fir branch spray (alpha): stem left to right, side twigs angled to the tip, dense needles
  function branch() {
    const w = 256, h = 128, c = cv(w, h), g = c.getContext('2d'); g.lineCap = 'round';
    const needle = (x, y, a, l, t) => { const s = 0.55 + t * 0.6 + R() * 0.25; g.strokeStyle = `rgb(${(28 + R() * 18) * s | 0},${(58 + R() * 34) * s | 0},${(30 + R() * 16) * s | 0})`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); };
    const stemY = x => 64 + Math.sin(x / w * 2.4) * 6;
    g.strokeStyle = '#3a2a1c'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= 246; x += 6) x ? g.lineTo(x, stemY(x)) : g.moveTo(x, stemY(x)); g.stroke();
    for (let x = 6; x < 236; x += 7) for (const sd of [-1, 1]) {
      const t = x / w, len = (1 - t * 0.75) * (34 + R() * 14), a = sd * (0.75 + R() * 0.3), x0 = x, y0 = stemY(x);
      g.strokeStyle = '#3d2e1f'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); g.stroke();
      for (let k = 0; k < len; k += 2.2) { const px = x0 + Math.cos(a) * k, py = y0 + Math.sin(a) * k, tt = Math.min(1, t + k / 80); needle(px, py, a - 0.9 + R() * 0.3, 6 + R() * 4, tt); needle(px, py, a + 0.9 - R() * 0.3, 6 + R() * 4, tt); }
    }
    for (let x = 0; x < 246; x += 2) { needle(x, stemY(x), -1.2 + R() * 0.4, 7, x / w); needle(x, stemY(x), 1.2 - R() * 0.4, 7, x / w); }
    return tex(c, false, true);
  }
  function dust() { const c = cv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c, false, false); }
  let cache = null;
  const roads = {};
  return (kind, hw) => { if (!cache) cache = { floor: floor(), bark: bark(), needles: needles(), branch: branch(), plants: plants(), dust: dust(), birch: birch(), leaves: leaves() }; const k = (kind || 'gravel') + (hw || 3.7); cache.road = roads[k] || (roads[k] = road(kind || 'gravel', hw || 3.7)); return cache; };
})();
