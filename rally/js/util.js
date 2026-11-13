'use strict';
// Shared helpers: seeded random, value noise, small math.
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 2D value noise with smooth interpolation, seeded by a permutation table
function makeNoise(seed) {
  const r = mulberry(seed), P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = V[P[X + P[Y]]], b = V[P[X + 1 + P[Y]]], c = V[P[X + P[Y + 1]]], d = V[P[X + 1 + P[Y + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  n2.fbm = (x, y, oct) => { let s = 0, amp = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += n2(x * f, y * f) * amp; n += amp; amp *= 0.5; f *= 2.03; } return s / n; };
  return n2;
}
const fmtT = t => { if (t < 0) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
const fmtT2 = t => { if (t < 0) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
