// Procedural PBR textures (albedo / normal / roughness) drawn on 2D canvases.
// No external assets. Everything is deterministic (seeded) and seamlessly tileable.
import * as THREE from 'three';

/* ------------------------------------------------------------------ helpers */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/** Tileable fbm value noise. fx/fy = lattice cells across the tile at octave 0. Result in [0,1]. */
function fbm(w, h, fx, fy, oct, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  const rnd = mulberry32(seed);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const px = fx << o, py = fy << o;
    if (px > w || py > h) break;
    const lat = new Float32Array(px * py);
    const row = new Float32Array(px);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let x = 0; x < w; x++) {
      const u = (x / w) * px, i = Math.floor(u), f = u - i;
      tx[x] = f * f * (3 - 2 * f); x0[x] = i % px; x1[x] = (i + 1) % px;
    }
    let k = 0;
    for (let y = 0; y < h; y++) {
      const v = (y / h) * py, j = Math.floor(v), f = v - j, g = f * f * (3 - 2 * f);
      const r0 = (j % py) * px, r1 = ((j + 1) % py) * px;
      for (let i = 0; i < px; i++) { const a = lat[r0 + i]; row[i] = (a + (lat[r1 + i] - a) * g) * amp; }
      for (let x = 0; x < w; x++) {
        const a = row[x0[x]];
        out[k++] += a + (row[x1[x]] - a) * tx[x];
      }
    }
    tot += amp; amp *= gain;
  }
  const inv = 1 / tot;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

// One shared white-noise buffer; each texture reads it from a different (seeded) offset.
let WHITE = null;
function white(n, seed) {
  const N = 1 << 19;
  if (!WHITE) { const rnd = mulberry32(977); WHITE = new Float32Array(N * 2); for (let i = 0; i < N; i++) WHITE[i] = WHITE[i + N] = rnd(); }
  const o = (Math.imul(seed, 40503) >>> 0) % N;
  return WHITE.subarray(o, o + n);
}

/** Rasterise vector shapes (white on black) with canvas 2D and return coverage as floats. */
function mask(w, h, draw, blur = 0, wrap = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const r = wrap ? 1 : 0;
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    ctx.save(); ctx.translate(ox * w, oy * h); draw(ctx); ctx.restore();
  }
  const d = ctx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  for (let p = 0; p < 2 && blur >= 1; p++) boxBlur(out, w, h, Math.round(blur));
  return out;
}

/** In-place separable wrapped box blur (radius r px). */
function boxBlur(a, w, h, r) {
  const n = 2 * r + 1, inv = 1 / n, tmp = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let k = -r; k <= r; k++) s += a[o + ((k + w) % w)];
    for (let x = 0; x < w; x++) { tmp[x] = s * inv; s += a[o + ((x + r + 1) % w)] - a[o + ((x - r + w) % w)]; }
    for (let x = 0; x < w; x++) a[o + x] = tmp[x];
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[((k + h) % h) * w + x];
    for (let y = 0; y < h; y++) { tmp[y] = s * inv; s += a[((y + r + 1) % h) * w + x] - a[((y - r + h) % h) * w + x]; }
    for (let y = 0; y < h; y++) a[y * w + x] = tmp[y];
  }
}

function scratchList(rnd, n, w, h, maxLen, angSpread) {
  const L = [];
  for (let i = 0; i < n; i++) {
    const ang = (rnd() - 0.5) * angSpread + (rnd() < 0.25 ? Math.PI / 2 : 0);
    L.push({ x: rnd() * w, y: rnd() * h, len: 8 + rnd() * rnd() * maxLen, ang, a: 0.25 + rnd() * 0.75, lw: 0.6 + rnd() * 0.9, bend: (rnd() - 0.5) * 0.3 });
  }
  return L;
}
function drawScratches(ctx, L) {
  for (const s of L) {
    const dx = Math.cos(s.ang) * s.len, dy = Math.sin(s.ang) * s.len;
    ctx.strokeStyle = `rgba(255,255,255,${s.a})`; ctx.lineWidth = s.lw;
    ctx.beginPath(); ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + dx / 2 - dy * s.bend, s.y + dy / 2 + dx * s.bend, s.x + dx, s.y + dy);
    ctx.stroke();
  }
}
function drawDiscs(ctx, L) {
  for (const d of L) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fill(); }
}

function buf(w, h) {
  const n = w * h;
  return { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), hh: new Float32Array(n), ro: new Float32Array(n) };
}

let ANISO = 8;

function toTexture(w, h, img, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Colour + Sobel normal (from height field, wrapped) + greyscale roughness. */
function finalize(t, strength) {
  const { w, h, r, g, b, hh, ro } = t, n = w * h;
  const ci = new ImageData(w, h), ni = new ImageData(w, h), ri = new ImageData(w, h);
  const cd = ci.data, nd = ni.data, rd = ri.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    cd[j] = r[i]; cd[j + 1] = g[i]; cd[j + 2] = b[i]; cd[j + 3] = 255; // Uint8Clamped handles range
    const q = ro[i] * 255;
    rd[j] = q; rd[j + 1] = q; rd[j + 2] = q; rd[j + 3] = 255;
  }
  const s = strength / 8;
  for (let y = 0; y < h; y++) {
    const ym = ((y + h - 1) % h) * w, yc = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x + w - 1) % w, xp = (x + 1) % w;
      const tl = hh[ym + xm], tc = hh[ym + x], tr = hh[ym + xp];
      const ml = hh[yc + xm], mr = hh[yc + xp];
      const bl = hh[yp + xm], bc = hh[yp + x], br = hh[yp + xp];
      const gx = (tr + 2 * mr + br - tl - 2 * ml - bl) * s;
      const gy = (bl + 2 * bc + br - tl - 2 * tc - tr) * s;
      // canvas y runs down while v runs up (flipY), so +gy maps to +green (OpenGL convention)
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const j = (yc + x) * 4;
      nd[j] = (-gx * inv * 0.5 + 0.5) * 255;
      nd[j + 1] = (gy * inv * 0.5 + 0.5) * 255;
      nd[j + 2] = (inv * 0.5 + 0.5) * 255;
      nd[j + 3] = 255;
    }
  }
  return { map: toTexture(w, h, ci, true), normalMap: toTexture(w, h, ni, false), roughnessMap: toTexture(w, h, ri, false) };
}

/* ----------------------------------------------------------------- textures */

function concrete() {
  const S = 512, t = buf(S, S);
  const big = fbm(S, S, 3, 3, 5, 11), fine = fbm(S, S, 48, 48, 3, 12), stain = fbm(S, S, 2, 2, 4, 13);
  const drip = fbm(S, S, 24, 2, 3, 14), pore = fbm(S, S, 170, 170, 1, 15), wn = white(S * S, 16);
  for (let y = 0, i = 0; y < S; y++) {
    const dy = y & 255, ly = Math.max(0, 1 - Math.min(dy, 256 - dy) / 1.6);
    for (let x = 0; x < S; x++, i++) {
      const lx = Math.max(0, 1 - Math.min(x, S - x) / 1.6);
      const L = Math.max(lx, ly) * (0.5 + fine[i]);
      const st = sstep(0.5, 0.8, stain[i]) * 0.5 + sstep(0.55, 0.85, drip[i]) * sstep(0.4, 0.7, stain[i]) * 0.35;
      const p = sstep(0.88, 0.97, pore[i]);
      const v = 142 + (big[i] - 0.5) * 46 + (fine[i] - 0.5) * 22 + (wn[i] - 0.5) * 9 - st * 28 - p * 48 - L * 13;
      t.r[i] = v + 3; t.g[i] = v + 1; t.b[i] = v - 4;
      t.hh[i] = big[i] * 0.35 + fine[i] * 0.35 - p * 0.6 - L * 0.3;
      t.ro[i] = clamp01(0.86 - (big[i] - 0.5) * 0.18 + p * 0.1 + st * 0.06);
    }
  }
  return finalize(t, 3.5);
}

function plaster() {
  const S = 512, t = buf(S, S);
  const peel = fbm(S, S, 110, 110, 2, 21), dirt = fbm(S, S, 8, 8, 3, 22), roll = fbm(S, S, 16, 96, 2, 23), wn = white(S * S, 24);
  for (let i = 0; i < S * S; i++) {
    const v = (peel[i] - 0.5) * 9 + (dirt[i] - 0.5) * 7 + (roll[i] - 0.5) * 4 + (wn[i] - 0.5) * 3;
    t.r[i] = 228 + v; t.g[i] = 222 + v; t.b[i] = 207 + v * 1.1;
    t.hh[i] = peel[i] * 0.6 + roll[i] * 0.3 + wn[i] * 0.1;
    t.ro[i] = 0.88 + (dirt[i] - 0.5) * 0.08;
  }
  return finalize(t, 1.6);
}

function brick() {
  const S = 512, t = buf(S, S), ROWS = 24, rh = S / ROWS;
  const fine = fbm(S, S, 64, 64, 3, 31), grain = fbm(S, S, 24, 48, 4, 32), big = fbm(S, S, 3, 3, 4, 33), wn = white(S * S, 34);
  for (let y = 0, i = 0; y < S; y++) {
    const row = Math.floor(y / rh), fy = y - row * rh, xo = (row & 1) ? 32 : 0;
    for (let x = 0; x < S; x++, i++) {
      const xx = (x + xo) & 511, col = xx >> 6, fx = xx & 63;
      const d = Math.min(fx, 63 - fx, fy, rh - fy) + (fine[i] - 0.5) * 1.8;
      const m = sstep(0.9, 2.6, d);
      const tone = hash(col, row, 3), hue = hash(col, row, 4), burnt = hash(col, row, 5) > 0.88 ? 0.72 : 1;
      const k = (0.8 + 0.38 * tone) * (0.82 + 0.36 * grain[i]) * burnt * (0.88 + 0.24 * big[i]) + (wn[i] - 0.5) * 0.08;
      const br = mix(136, 104, hue) * k, bg = mix(68, 58, hue) * k, bb = mix(52, 50, hue) * k;
      const mk = (0.8 + 0.3 * fine[i]) * (0.85 + 0.3 * big[i]);
      t.r[i] = mix(150 * mk, br, m); t.g[i] = mix(144 * mk, bg, m); t.b[i] = mix(132 * mk, bb, m);
      t.hh[i] = mix(0.15 + fine[i] * 0.15, 0.62 + grain[i] * 0.3 + tone * 0.08, m);
      t.ro[i] = mix(0.96, 0.8 + grain[i] * 0.12, m);
    }
  }
  return finalize(t, 5);
}

function woodFloor() {
  const S = 512, t = buf(S, S);
  const ringN = fbm(S, S, 2, 24, 3, 41), fine = fbm(S, S, 6, 200, 2, 42), big = fbm(S, S, 3, 3, 3, 43);
  for (let y = 0, i = 0; y < S; y++) {
    const row = y >> 5, dy = y & 31, off = Math.floor(hash(row, 0, 7) * S), L1 = 190 + Math.floor(hash(row, 9, 7) * 130);
    const seamY = dy === 0 ? 1 : (dy === 1 || dy === 31) ? 0.4 : 0;
    for (let x = 0; x < S; x++, i++) {
      const xx = (x + off) & 511, pl = xx < L1 ? 0 : 1, id = row * 2 + pl;
      const dj = Math.min(Math.abs(xx - L1), xx, S - xx);
      const seam = Math.max(seamY, dj < 1 ? 1 : dj < 2 ? 0.4 : 0);
      const gi = (((y + ((hash(id, 3, 7) * 16) | 0) * 32) & 511) << 9) + ((x + ((hash(id, 2, 7) * S) | 0)) & 511);
      const rings = 0.5 + 0.5 * Math.sin(ringN[gi] * 55 + hash(id, 4, 7) * 6);
      const f = fine[gi], tone = hash(id, 1, 7);
      const k = (0.8 + 0.3 * tone) * (0.9 + 0.1 * rings) * (0.9 + 0.2 * f) * (0.96 + 0.08 * big[i]) * (1 - seam * 0.72);
      const warm = hash(id, 5, 7) * 14;
      t.r[i] = (154 + warm) * k; t.g[i] = (108 + warm * 0.5) * k; t.b[i] = 62 * k;
      t.hh[i] = 0.5 + f * 0.12 + rings * 0.04 - seam * 0.5;
      t.ro[i] = 0.3 + 0.12 * f + 0.05 * tone + seam * 0.45;
    }
  }
  return finalize(t, 2.5);
}

function tiles() {
  const S = 512, t = buf(S, S);
  const mott = fbm(S, S, 8, 8, 4, 51), fine = fbm(S, S, 96, 96, 2, 52), wn = white(S * S, 53);
  for (let y = 0, i = 0; y < S; y++) {
    const dy = y & 127;
    for (let x = 0; x < S; x++, i++) {
      const dx = x & 127, d = Math.min(dx, 127 - dx, dy, 127 - dy);
      const g = sstep(1.2, 2.8, d), bev = sstep(1.5, 5.5, d);
      const tone = (hash(x >> 7, y >> 7, 5) - 0.5) * 12;
      const v = tone + (mott[i] - 0.5) * 14 + (fine[i] - 0.5) * 5 - (1 - bev) * 14;
      const gk = 0.8 + 0.4 * fine[i] + (wn[i] - 0.5) * 0.2;
      t.r[i] = mix(60 * gk, 206 + v, g); t.g[i] = mix(56 * gk, 201 + v, g); t.b[i] = mix(52 * gk, 190 + v, g);
      t.hh[i] = mix(0.1 + fine[i] * 0.1, 0.25 + bev * 0.75 + (mott[i] - 0.5) * 0.04, g);
      t.ro[i] = mix(0.92, 0.2 + mott[i] * 0.14 + fine[i] * 0.05, g);
    }
  }
  return finalize(t, 3.5);
}

function carpet() {
  const S = 512, t = buf(S, S);
  const f1 = fbm(S, S, 256, 256, 1, 61), f2 = fbm(S, S, 64, 64, 2, 62), big = fbm(S, S, 4, 4, 3, 63), wn = white(S * S, 64);
  for (let i = 0; i < S * S; i++) {
    const n = wn[i] * 0.4 + f1[i] * 0.4 + f2[i] * 0.2;
    const k = (0.6 + 0.75 * n) * (0.94 + 0.12 * big[i]);
    t.r[i] = 50 * k; t.g[i] = 58 * k; t.b[i] = 71 * k;
    t.hh[i] = n;
    t.ro[i] = 0.93 + n * 0.07;
  }
  return finalize(t, 3);
}

function ceiling() {
  const S = 512, t = buf(S, S);
  const fine = fbm(S, S, 64, 64, 3, 71), fis = fbm(S, S, 128, 128, 1, 72), patch = fbm(S, S, 12, 12, 2, 73), wn = white(S * S, 74);
  for (let y = 0, i = 0; y < S; y++) {
    const dy = y & 255;
    for (let x = 0; x < S; x++, i++) {
      const dx = x & 255, d = Math.min(dx, 255 - dx, dy, 255 - dy);
      if (d < 3) {
        const v = 204 + (fine[i] - 0.5) * 6;
        t.r[i] = v; t.g[i] = v; t.b[i] = v + 1; t.hh[i] = 0.75; t.ro[i] = 0.5;
      } else {
        const pin = wn[i] > 0.972 ? 1 : 0, fs = sstep(0.8, 0.9, fis[i]) * sstep(0.35, 0.6, patch[i]);
        const sh = d < 5 ? 34 : 0;
        const v = 233 + (fine[i] - 0.5) * 9 - pin * 62 - fs * 48 - sh;
        t.r[i] = v; t.g[i] = v; t.b[i] = v - 5;
        t.hh[i] = 0.5 + fine[i] * 0.08 - pin * 0.3 - fs * 0.35;
        t.ro[i] = 0.93;
      }
    }
  }
  return finalize(t, 3);
}

function metalPlate() {
  const W = 512, H = 768, t = buf(W, H), rnd = mulberry32(81), E = 28;
  const mott = fbm(W, H, 3, 4, 5, 82), brush = fbm(W, H, 2, 384, 2, 83), grime = fbm(W, H, 4, 6, 4, 84), wn = white(W * H, 85);
  const ribs = mask(W, H, (c) => {
    c.lineCap = 'butt'; c.lineJoin = 'miter';
    c.lineWidth = 30; c.strokeRect(E, E, W - 2 * E, H - 2 * E);
    c.lineWidth = 26; c.beginPath();
    c.moveTo(E, E); c.lineTo(W - E, H - E); c.moveTo(W - E, E); c.lineTo(E, H - E); c.stroke();
    c.fillRect(W / 2 - 34, H / 2 - 34, 68, 68);
  }, 2, false);
  const rv = [];
  for (let k = 0; k <= 6; k++) { const x = E + (k * (W - 2 * E)) / 6; rv.push({ x, y: E, r: 5.5 }, { x, y: H - E, r: 5.5 }); }
  for (let k = 1; k < 10; k++) { const y = E + (k * (H - 2 * E)) / 10; rv.push({ x: E, y, r: 5.5 }, { x: W - E, y, r: 5.5 }); }
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rv.push({ x: W / 2 + sx * 22, y: H / 2 + sy * 22, r: 6 });
  const riv = mask(W, H, (c) => drawDiscs(c, rv), 1, false);
  const sl = scratchList(rnd, 90, W, H, 150, 1.2);
  const scr = mask(W, H, (c) => drawScratches(c, sl));
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const rb = ribs[i], edge = 4 * rb * (1 - rb), r = riv[i], sc = scr[i] * (0.5 + wn[i] * 0.5);
      const border = Math.min(x, W - 1 - x, y, H - 1 - y) < 2 ? 1 : 0;
      const gr = sstep(0.52, 0.8, grime[i] + edge * 0.15) * (1 - rb * 0.4);
      let k = 1 + (mott[i] - 0.5) * 0.36 + (brush[i] - 0.5) * 0.2 + (wn[i] - 0.5) * 0.05;
      k = k * (1 - edge * 0.3) * (1 - border * 0.5) + rb * 0.14 + r * 0.3 + sc * 0.8;
      t.r[i] = mix(58 * k, 60 * k, gr * 0.5); t.g[i] = mix(63 * k, 50 * k, gr * 0.5); t.b[i] = mix(70 * k, 40 * k, gr * 0.5);
      t.hh[i] = rb + r * 0.5 + (mott[i] - 0.5) * 0.08 + brush[i] * 0.03 - sc * 0.12 - border * 0.4;
      t.ro[i] = clamp01(0.42 + (mott[i] - 0.5) * 0.25 + brush[i] * 0.1 + gr * 0.3 - sc * 0.15 - r * 0.1);
    }
  }
  return finalize(t, 6);
}

function planks() {
  const S = 512, t = buf(S, S), rnd = mulberry32(91);
  const ringN = fbm(S, S, 2, 10, 3, 92), fine = fbm(S, S, 5, 160, 3, 93), big = fbm(S, S, 4, 4, 3, 94), wn = white(S * S, 95);
  const knots = [], nails = [];
  for (let b = 0; b < 4; b++) {
    for (let k = 0; k < 2; k++) if (rnd() < 0.8) knots.push({ x: rnd() * S, y: b * 128 + 30 + rnd() * 68, r: 5 + rnd() * 8 });
    for (const nx of [44, 468]) for (const ny of [34, 94]) nails.push({ x: nx + (rnd() - 0.5) * 8, y: b * 128 + ny + (rnd() - 0.5) * 8, r: 4.2 });
  }
  const kn = mask(S, S, (c) => drawDiscs(c, knots), 3);
  const nl = mask(S, S, (c) => drawDiscs(c, nails), 0);
  for (let y = 0, i = 0; y < S; y++) {
    const row = y >> 7, dy = y & 127, e = Math.min(dy, 127 - dy);
    const gap = 1 - sstep(1.5, 3.5, e), bev = sstep(2.5, 8, e);
    const tone = hash(row, 1, 9), ox = (hash(row, 2, 9) * S) | 0, oy = (hash(row, 3, 9) * S) | 0, ph = hash(row, 4, 9) * 6;
    for (let x = 0; x < S; x++, i++) {
      const gi = (((y + oy) & 511) << 9) + ((x + ox) & 511);
      const kq = kn[i], n = nl[i];
      const rings = 0.5 + 0.5 * Math.sin(ringN[gi] * 46 + ph + kq * 9), f = fine[gi];
      let k = (0.74 + 0.36 * tone) * (0.76 + 0.24 * rings) * (0.78 + 0.44 * f) * (0.9 + 0.2 * big[i]) + (wn[i] - 0.5) * 0.06;
      k *= (1 - kq * 0.5) * (0.82 + 0.18 * bev) * (1 - gap * 0.85);
      const rust = sstep(0.05, 0.6, n) * (1 - n);
      t.r[i] = mix(mix(134, 120, rust) * k, 58, n); t.g[i] = mix(mix(108, 82, rust) * k, 56, n); t.b[i] = mix(80 * k * (1 - rust * 0.4), 55, n);
      t.hh[i] = (0.55 + f * 0.3 + rings * 0.12 - kq * 0.15) * (0.6 + 0.4 * bev) * (1 - gap) - n * 0.12;
      t.ro[i] = mix(0.86 + f * 0.1, 0.5, n);
    }
  }
  return finalize(t, 5);
}

function asphalt() {
  const S = 512, t = buf(S, S), rnd = mulberry32(101);
  const agg = fbm(S, S, 170, 170, 1, 102), big = fbm(S, S, 3, 3, 5, 103), med = fbm(S, S, 32, 32, 3, 104), wn = white(S * S, 105);
  const cracks = [];
  for (let c = 0; c < 5; c++) {
    let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28; const pts = [[x, y]], n = 10 + (rnd() * 14 | 0);
    for (let k = 0; k < n; k++) { a += (rnd() - 0.5) * 1.3; x += Math.cos(a) * (8 + rnd() * 16); y += Math.sin(a) * (8 + rnd() * 16); pts.push([x, y]); }
    cracks.push({ pts, lw: 0.8 + rnd() * 0.9 });
  }
  const cr = mask(S, S, (c) => {
    for (const k of cracks) { c.lineWidth = k.lw; c.beginPath(); c.moveTo(k.pts[0][0], k.pts[0][1]); for (const p of k.pts) c.lineTo(p[0], p[1]); c.stroke(); }
  });
  for (let i = 0; i < S * S; i++) {
    const s = sstep(0.7, 0.9, agg[i]), c = cr[i];
    const v = 47 + (big[i] - 0.5) * 24 + (med[i] - 0.5) * 14 + (wn[i] - 0.5) * 16 + s * (22 + wn[i] * 42) - c * 30;
    t.r[i] = v; t.g[i] = v; t.b[i] = v + 2;
    t.hh[i] = med[i] * 0.3 + s * 0.45 + wn[i] * 0.2 - c * 0.9;
    t.ro[i] = clamp01(0.93 - s * 0.14 + (big[i] - 0.5) * 0.08);
  }
  return finalize(t, 4);
}

function grass() {
  const S = 512, t = buf(S, S);
  const big = fbm(S, S, 3, 3, 5, 111), med = fbm(S, S, 24, 24, 4, 112), blades = fbm(S, S, 220, 70, 2, 113), hue = fbm(S, S, 6, 6, 3, 114), wn = white(S * S, 115);
  for (let i = 0; i < S * S; i++) {
    const gm = sstep(0.36, 0.62, big[i] + (med[i] - 0.5) * 0.5), bl = blades[i];
    const dk = 0.78 + 0.4 * med[i] + (wn[i] - 0.5) * 0.18;
    const gk = 0.62 + 0.62 * bl + (wn[i] - 0.5) * 0.2, h = hue[i];
    t.r[i] = mix(104 * dk, mix(82, 126, h) * gk, gm);
    t.g[i] = mix(88 * dk, mix(98, 122, h) * gk, gm);
    t.b[i] = mix(64 * dk, mix(52, 72, h) * gk, gm);
    t.hh[i] = mix(med[i] * 0.4 + wn[i] * 0.1, 0.3 + bl * 0.6 + wn[i] * 0.2, gm);
    t.ro[i] = 0.94 + (med[i] - 0.5) * 0.08;
  }
  return finalize(t, 4);
}

function crate() {
  const S = 512, t = buf(S, S), F = 56, BW = (S - 2 * F) / 5, HB = 30;
  const ringN = fbm(S, S, 2, 14, 3, 121), fine = fbm(S, S, 5, 170, 3, 122), big = fbm(S, S, 4, 4, 3, 123), wn = white(S * S, 124);
  const nails = [];
  for (const a of [F / 2, S - F / 2]) for (const b of [18, 40, S / 2, S - 40, S - 18]) nails.push({ x: a, y: b, r: 3.6 }, { x: b, y: a, r: 3.6 });
  nails.push({ x: F + 22, y: S - F - 22, r: 3.6 }, { x: S - F - 22, y: F + 22, r: 3.6 }, { x: S / 2, y: S / 2, r: 3.6 });
  const nl = mask(S, S, (c) => drawDiscs(c, nails), 0, false);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const tb = y < F || y >= S - F, side = !tb && (x < F || x >= S - F);
      const dd = Math.abs(x + y - S) * 0.7071;
      let gi, id, hgt, shade = 1, line = 0;
      if (tb) {                                   // top / bottom rails, grain along x
        id = y < F ? 1 : 2; gi = (y << 9) + x; hgt = 1;
        const e = Math.min(y, S - 1 - y, x, S - 1 - x); if (e < 2) line = 0.6;
        if (y === F - 1 || y === S - F) line = 0.5;
      } else if (side) {                          // side rails, grain along y
        id = x < F ? 3 : 4; gi = (x << 9) + y; hgt = 1;
        if (Math.min(x, S - 1 - x) < 2) line = 0.6;
        if (y === F || y === S - F - 1) line = 0.8;
        if (x === F - 1 || x === S - F) line = 0.5;
      } else if (dd < HB) {                       // diagonal brace
        id = 5; gi = (((x + y) & 511) << 9) + ((x - y) & 511); hgt = 0.82;
        if (dd > HB - 1.5) line = 0.5;
      } else {                                    // back boards, grain along y
        const bx = x - F, bi = Math.floor(bx / BW), fx = bx - bi * BW;
        id = 6 + bi; gi = (((x + bi * 97) & 511) << 9) + y; hgt = 0.45;
        if (fx < 1.5 || fx > BW - 1.5) { line = 0.75; hgt = 0.25; }
        const e = Math.min(x - F, S - F - 1 - x, y - F, S - F - 1 - y);
        shade = (1 - 0.4 * (1 - sstep(0, 12, e))) * (1 - 0.36 * (1 - sstep(0, 10, dd - HB)));
      }
      const tone = hash(id, 1, 12), n = nl[i];
      const rings = 0.5 + 0.5 * Math.sin(ringN[gi] * 44 + tone * 6), f = fine[gi];
      const k = (0.8 + 0.28 * tone) * (0.82 + 0.18 * rings) * (0.82 + 0.36 * f) * (0.9 + 0.2 * big[i]) * shade * (1 - line * 0.7) + (wn[i] - 0.5) * 0.05;
      t.r[i] = mix(166 * k, 52, n); t.g[i] = mix(127 * k, 50, n); t.b[i] = mix(80 * k, 48, n);
      t.hh[i] = hgt + f * 0.1 + rings * 0.04 - line * 0.12 - n * 0.08;
      t.ro[i] = mix(0.78 + f * 0.14, 0.45, n);
    }
  }
  return finalize(t, 5);
}

function fabric() {
  const S = 256, t = buf(S, S);
  const big = fbm(S, S, 6, 6, 3, 131), wn = white(S * S, 132);
  for (let y = 0, i = 0; y < S; y++) {
    const cy = y >> 2, b = Math.sin((Math.PI * ((y & 3) + 0.5)) / 4), ty = hash(cy, 1, 13);
    for (let x = 0; x < S; x++, i++) {
      const cx = x >> 2, a = Math.sin((Math.PI * ((x & 3) + 0.5)) / 4), tx = hash(cx, 2, 13);
      const over = (cx + cy) & 1;
      const h = over ? a * (0.6 + 0.4 * b) : b * (0.6 + 0.4 * a) * 0.85;
      const v = 172 + h * 30 + ((over ? tx : ty) - 0.5) * 10 + (wn[i] - 0.5) * 8 + (big[i] - 0.5) * 8;
      t.r[i] = v; t.g[i] = v; t.b[i] = v - 2;
      t.hh[i] = h + wn[i] * 0.1;
      t.ro[i] = 0.9 + h * 0.06;
    }
  }
  return finalize(t, 2.5);
}

function metal() {
  const S = 512, t = buf(S, S), rnd = mulberry32(141);
  const mott = fbm(S, S, 4, 4, 4, 142), brush = fbm(S, S, 2, 256, 2, 143), b2 = fbm(S, S, 8, 128, 2, 144), wn = white(S * S, 145);
  const sl = scratchList(rnd, 45, S, S, 110, 0.8);
  const scr = mask(S, S, (c) => drawScratches(c, sl));
  for (let i = 0; i < S * S; i++) {
    const sc = scr[i] * (0.5 + wn[i] * 0.5), br = brush[i] * 0.6 + b2[i] * 0.4;
    const k = 1 + (mott[i] - 0.5) * 0.22 + (br - 0.5) * 0.26 + (wn[i] - 0.5) * 0.04 + sc * 0.6;
    t.r[i] = 56 * k; t.g[i] = 60 * k; t.b[i] = 66 * k;
    t.hh[i] = br * 0.25 + mott[i] * 0.1 - sc * 0.3;
    t.ro[i] = clamp01(0.46 + (mott[i] - 0.5) * 0.2 + (br - 0.5) * 0.16 - sc * 0.12);
  }
  return finalize(t, 2);
}

/* --------------------------------------------------------------------- API */

/**
 * Build the whole texture set. Each entry is { map, normalMap, roughnessMap } (CanvasTextures,
 * RepeatWrapping, repeat (1,1) - clone and set repeat per use).
 * Real-world size of one tile (metres): concrete/plaster/brick/woodFloor/tiles/ceiling 2x2,
 * carpet/planks/crate/metal 1x1, metalPlate 2x3, asphalt/grass 4x4, fabric 0.5x0.5.
 */
export function makeTextures(anisotropy = 8) {
  ANISO = anisotropy;
  return {
    concrete: concrete(),
    plaster: plaster(),
    brick: brick(),
    woodFloor: woodFloor(),
    tiles: tiles(),
    carpet: carpet(),
    ceiling: ceiling(),
    metalPlate: metalPlate(),
    planks: planks(),
    asphalt: asphalt(),
    grass: grass(),
    crate: crate(),
    fabric: fabric(),
    metal: metal(),
  };
}
