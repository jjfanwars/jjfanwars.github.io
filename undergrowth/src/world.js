// UNDERGROWTH: world.js
// Terrain, water, sky, lighting, foliage, firebase and camp structures.
// Everything is generated in code: canvases for textures, BufferGeometry for models.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, rand, noise2D, fbm, clamp, lerp, smoothstep, events as sharedEvents } from './util.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HALF = WORLD.half;               // 256
const GN = HALF * 2 + 1;               // height samples per side (1 m spacing)
const WATER_Y = 0;                     // river surface
const SQ = Math.SQRT1_2;
const TAU = Math.PI * 2;
const FBX = WORLD.firebase.x, FBZ = WORLD.firebase.z, FBR = WORLD.firebase.radius;
const CPX = WORLD.playerStart.x, CPZ = WORLD.playerStart.z;
const U_FORD = -40;                    // river ford, in river-aligned u coordinate

// Paddy terraces live in river-aligned coordinates (u along the river, v across).
const PU0 = -50, PU1 = 92, PV0 = -108, PV1 = -42;
const ROWH = 11, COLW = 15.8, PROWS = 6;

// Foliage streaming tiles.
const TILE = 32, TILE_MIN = -416, NT = 26;

const FOG_DENSITY = 0.0082;
const STREAM_STEP = 18;              // foliage refills after the eye moves this far (m)
const CULL_MARGIN = 24 * Math.PI / 180; // view frustum widening per side for foliage culling
const CULL_TURN = Math.cos(13 * Math.PI / 180); // refill when the view turns more than this
const CULL_FLICK = Math.cos(CULL_MARGIN * 0.8);
const CULL_SIDE = 9;                  // ... or steps this far sideways
const CULL_KEEP = 28;                 // tiles nearer than this are never view-culled
const SUN_DIR = new THREE.Vector3(-0.80, 0.40, 0.42).normalize();

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// Graphics presets (main.js picks one; Low also drops post-processing there).
//   density: foliage draw-distance scale, thin: keep every n-th ground-cover instance,
//   shadow: sun shadow map size, shadowR: half extent of the realtime shadow box (m)
const PRESETS = {
  low: { density: 0.72, thin: 2, shadow: 1024, shadowR: 46 },
  high: { density: 1.0, thin: 1, shadow: 2048, shadowR: 62 },
  ultra: { density: 1.16, thin: 1, shadow: 4096, shadowR: 70 },
};
const DENSITY_MAX = 1.16;

function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}

// ---------------------------------------------------------------------------
// River
// ---------------------------------------------------------------------------

function riverV(u) {
  return 24 * Math.sin(u * 0.0105 + 0.6) + 10 * Math.sin(u * 0.027 + 2.1) + 4 * Math.sin(u * 0.061 + 0.3);
}
function riverDV(u) {
  return 0.252 * Math.cos(u * 0.0105 + 0.6) + 0.27 * Math.cos(u * 0.027 + 2.1) + 0.244 * Math.cos(u * 0.061 + 0.3);
}
function riverHW(u) {
  return 9.5 + 2.5 * Math.sin(u * 0.019 + 1.0) + 1.5 * noise2D(u * 0.021, 7.3);
}
const RV = { u: 0, v: 0, vc: 0, dist: 0, hw: 0, dd: 0, side: 0, slope: 0 };
function riverEval(x, z) {
  const u = (x + z) * SQ, v = (x - z) * SQ;
  const vc = riverV(u), s = riverDV(u);
  RV.u = u; RV.v = v; RV.vc = vc; RV.slope = s;
  RV.dist = Math.abs(v - vc) / Math.sqrt(1 + s * s);
  RV.hw = riverHW(u);
  RV.dd = RV.dist - RV.hw;
  RV.side = v > vc ? 1 : -1;
  return RV;
}
function uvToXZ(u, v, out) { out.x = (u + v) * SQ; out.z = (u - v) * SQ; return out; }

// ---------------------------------------------------------------------------
// Terrain height function (analytic). The 1 m grid built from it is the truth
// for gameplay; meshes are built from the same function so they agree.
// ---------------------------------------------------------------------------

function hills(x, z) {
  return 6.5 + 9.5 * fbm(x * 0.0052 + 3.1, z * 0.0052 - 1.7, 4)
    + 2.6 * fbm(x * 0.019 + 11.3, z * 0.019 + 5.1, 3)
    + 0.45 * noise2D(x * 0.07, z * 0.07);
}

function naturalHeight(x, z) {
  const r = riverEval(x, z);
  let h = smax(hills(x, z), WATER_Y + 1.8, 2.5);
  const dd = r.dd;
  const ford = lerp(0.25, 1, smoothstep(5, 18, Math.abs(r.u - U_FORD)));
  if (dd < 5) {
    if (dd < 0) {
      const t = clamp(-dd / r.hw, 0, 1);
      h = WATER_Y - 0.4 - 2.1 * Math.sqrt(t) * ford;
    } else {
      h = WATER_Y - 0.4 + 1.4 * smoothstep(0, 5, dd);
    }
    h += 0.14 * noise2D(x * 0.31, z * 0.31);
  } else {
    const vb = smoothstep(4, 72 + 20 * noise2D(r.u * 0.01, 3.3), dd);
    h = lerp(WATER_Y + 1.0, h, vb);
  }
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 196) {
    const ed = smoothstep(196, 300, e);
    const gap = smoothstep(r.hw + 3, r.hw + 42, r.dist);
    h += ed * ed * (26 + 10 * noise2D(x * 0.009 + 5, z * 0.009 - 2) + (e > 256 ? (e - 256) * 0.05 : 0)) * gap;
  }
  return h;
}

const FB_H = naturalHeight(FBX, FBZ) + 15.5;
const CAMP_H = naturalHeight(CPX, CPZ);

// --- paddies --------------------------------------------------------------
function padWob(u) { return 1.8 * Math.sin(u * 0.045 + 0.5) + 0.7 * Math.sin(u * 0.13 + 1.1); }
function rowOff(k) { return hash2(k + 31, 77) * COLW; }
const _padLevels = new Map();
const PAD_MEAN = naturalHeight(((PU0 + PU1) * 0.5 + (PV0 + PV1) * 0.5) * SQ, ((PU0 + PU1) * 0.5 - (PV0 + PV1) * 0.5) * SQ);
const _tmpXZ = { x: 0, z: 0 };
function padLevel(k, j) {
  const key = (k + 16) * 512 + (j + 16);
  let lv = _padLevels.get(key);
  if (lv !== undefined) return lv;
  const vw = PV0 + (k + 0.5) * ROWH;
  const u = PU0 - rowOff(k) + (j + 0.5) * COLW;
  const uu = clamp(u, PU0 + 2, PU1 - 2);
  uvToXZ(uu, vw + padWob(uu), _tmpXZ);
  const h = naturalHeight(_tmpXZ.x, _tmpXZ.z);
  lv = Math.round((PAD_MEAN + (h - PAD_MEAN) * 0.45) / 0.38) * 0.38 + 0.02;
  _padLevels.set(key, lv);
  return lv;
}
function padCol(k, uc) { return Math.floor((uc - PU0 + rowOff(k)) / COLW); }

const PD = { inZone: false, inPlot: false, level: 0, edge: 0, k: 0, j: 0, zoneD: 99, plant: 0 };
// Returns paddy-shaped height, or NaN when (x, z) is outside the paddy zone + margin.
function paddyEval(x, z, withBunds) {
  PD.inZone = false; PD.inPlot = false; PD.zoneD = 99;
  const u = (x + z) * SQ, v = (x - z) * SQ;
  if (u < PU0 - 10 || u > PU1 + 10) return NaN;
  const vw = v - padWob(u);
  if (vw < PV0 - 10 || vw > PV1 + 10) return NaN;
  const uc = clamp(u, PU0, PU1 - 1e-3), vc = clamp(vw, PV0, PV1 - 1e-3);
  const k = Math.floor((vc - PV0) / ROWH);
  const j = padCol(k, uc);
  const level = padLevel(k, j);
  const outside = Math.hypot(u - uc, vw - vc);
  PD.zoneD = outside; PD.level = level; PD.k = k; PD.j = j;
  if (outside > 0) {
    const nat = naturalHeight(x, z);
    return lerp(level + 0.32, nat, smoothstep(0, 9, outside));
  }
  PD.inZone = true;
  const plotU0 = PU0 - rowOff(k) + j * COLW;
  const eU0 = uc - Math.max(plotU0, PU0), eU1 = Math.min(plotU0 + COLW, PU1) - uc;
  const lv = vc - PV0 - k * ROWH;
  let e = eU0, nl = (plotU0 > PU0) ? padLevel(k, j - 1) : level;
  if (eU1 < e) { e = eU1; nl = (plotU0 + COLW < PU1) ? padLevel(k, j + 1) : level; }
  if (lv < e) { e = lv; nl = k > 0 ? padLevel(k - 1, padCol(k - 1, uc)) : level; }
  if (ROWH - lv < e) { e = ROWH - lv; nl = k < PROWS - 1 ? padLevel(k + 1, padCol(k + 1, uc)) : level; }
  PD.edge = e;
  PD.inPlot = e > 0.6;
  PD.plant = hash2(k * 13 + 5, j * 7 + 3);
  const floor = level - 0.12;
  if (withBunds && e < 0.7) {
    const top = Math.max(level, nl) + 0.32;
    return lerp(floor, top, smoothstep(0.7, 0.15, e));
  }
  return floor;
}

function terrainHeight(x, z, withBunds) {
  const ph = paddyEval(x, z, withBunds);
  let h = Number.isNaN(ph) ? naturalHeight(x, z) : ph;
  const fx = x - FBX, fz = z - FBZ, rf2 = fx * fx + fz * fz;
  if (rf2 < 200 * 200) {
    h += 15.5 * Math.max(0, Math.exp(-rf2 / 8100) - 0.0071);
    if (rf2 < 72 * 72) {
      const rf = Math.sqrt(rf2);
      h = lerp(FB_H + 0.05 * noise2D(x * 0.21, z * 0.21), h, smoothstep(44, 71, rf));
    }
  }
  const cx = x - CPX, cz = z - CPZ, rc2 = cx * cx + cz * cz;
  if (rc2 < 46 * 46) {
    const rc = Math.sqrt(rc2);
    h = lerp(CAMP_H + 0.12 * noise2D(x * 0.15, z * 0.15), h, smoothstep(17, 44, rc));
  }
  return h;
}

// --- 1 m height grid ------------------------------------------------------
const HG = new Float32Array(GN * GN);
function buildHeightGrid() {
  for (let j = 0; j < GN; j++) {
    const z = j - HALF;
    for (let i = 0; i < GN; i++) HG[j * GN + i] = terrainHeight(i - HALF, z, true);
  }
}
function heightAt(x, z) {
  const fx = x + HALF, fz = z + HALF;
  if (!(fx >= 0 && fz >= 0 && fx <= 512 && fz <= 512)) return terrainHeight(x, z, true);
  let i = fx | 0, j = fz | 0;
  if (i > 511) i = 511;
  if (j > 511) j = 511;
  const tx = fx - i, tz = fz - j, k = j * GN + i;
  const a = HG[k], b = HG[k + 1], c = HG[k + GN], d = HG[k + GN + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
function normalAt(x, z, out) {
  const o = out || new THREE.Vector3();
  const hl = heightAt(x - 1, z), hr = heightAt(x + 1, z), hd = heightAt(x, z - 1), hu = heightAt(x, z + 1);
  o.set((hl - hr) * 0.5, 1, (hd - hu) * 0.5).normalize();
  return o;
}
function slopeAt(x, z) {
  const hl = heightAt(x - 1, z), hr = heightAt(x + 1, z), hd = heightAt(x, z - 1), hu = heightAt(x, z + 1);
  const gx = (hr - hl) * 0.5, gz = (hu - hd) * 0.5;
  return Math.sqrt(gx * gx + gz * gz);
}

// ---------------------------------------------------------------------------
// Water queries
// ---------------------------------------------------------------------------
function waterHeightAt(x, z) {
  riverEval(x, z);
  if (RV.dd < 1.5) {
    const h = heightAt(x, z);
    if (h < WATER_Y) return WATER_Y;
  }
  const ph = paddyEval(x, z, true);
  if (!Number.isNaN(ph) && PD.inPlot) return PD.level;
  return -Infinity;
}
function waterDepthAt(x, z) {
  const w = waterHeightAt(x, z);
  if (w === -Infinity) return 0;
  return Math.max(0, w - heightAt(x, z));
}
function isWater(x, z) { return waterDepthAt(x, z) > 0.05; }

// ---------------------------------------------------------------------------
// Trails (footpaths; also exported as patrol routes)
// ---------------------------------------------------------------------------
const TG = new Float32Array(GN * GN).fill(50);

function catmull(pts, step, loop) {
  const out = [];
  const n = pts.length;
  const P = (i) => (loop ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const segs = loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < m; s++) {
      const t = s / m, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!loop) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

function riverBankPoint(u, offset, side = 1) {
  const vc = riverV(u), s = riverDV(u), hw = riverHW(u);
  const l = Math.sqrt(1 + s * s);
  const du = -s / l, dv = 1 / l;
  const o = side * (hw + offset);
  return [((u + du * o) + (vc + dv * o)) * SQ, ((u + du * o) - (vc + dv * o)) * SQ];
}

function buildTrails() {
  const fordSW = riverBankPoint(U_FORD, 8, -1), fordNE = riverBankPoint(U_FORD, 8, 1);
  const defs = [
    { name: 'campFirebase', pts: [[-166, 140], [-152, 112], [-134, 80], [-121, 50], [-108, 22], [-86, -4], [-58, -26], fordSW, fordNE,
      [2, -54], [30, -68], [62, -80], [95, -84], [120, -79], [137, -82], [140, -90], [140, -102]] },
    { name: 'campPaddies', pts: [[-160, 152], [-138, 147], [-112, 135], [-86, 121], [-62, 109], [-50, 104]] },
    { name: 'campWest', pts: [[-180, 146], [-200, 128], [-214, 100], [-222, 66], [-215, 30]] },
  ];
  // NE bank patrol path
  const bank = [];
  for (let u = -330; u <= 330; u += 20) {
    const p = riverBankPoint(u, 13);
    if (Math.abs(p[0]) < 232 && Math.abs(p[1]) < 232) bank.push(p);
  }
  defs.push({ name: 'riverBank', pts: bank });
  const ring = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    ring.push([FBX + Math.cos(a) * 55, FBZ + Math.sin(a) * 55]);
  }
  defs.push({ name: 'firebaseRing', pts: ring, loop: true });

  const trails = [];
  for (const d of defs) {
    const dense = catmull(d.pts, 0.7, !!d.loop);
    for (const p of dense) {
      const ci = Math.round(p[0] + HALF), cj = Math.round(p[1] + HALF);
      for (let dj = -5; dj <= 5; dj++) {
        const jj = cj + dj; if (jj < 0 || jj >= GN) continue;
        for (let di = -5; di <= 5; di++) {
          const ii = ci + di; if (ii < 0 || ii >= GN) continue;
          const dd = Math.hypot(ii - HALF - p[0], jj - HALF - p[1]);
          const k = jj * GN + ii;
          if (dd < TG[k]) TG[k] = dd;
        }
      }
    }
    const coarse = catmull(d.pts, 7, !!d.loop).map((p) => ({ x: p[0], z: p[1] }));
    trails.push({ name: d.name, loop: !!d.loop, points: coarse });
  }
  return trails;
}
function trailDist(x, z) {
  const i = Math.round(x + HALF), j = Math.round(z + HALF);
  if (i < 0 || j < 0 || i >= GN || j >= GN) return 50;
  return TG[j * GN + i];
}

// Paddy zone distance (0 inside, metres outside) without evaluating heights.
function paddyZoneDist(x, z) {
  const u = (x + z) * SQ, v = (x - z) * SQ;
  const vw = v - padWob(u);
  const du = Math.max(PU0 - u, 0, u - PU1), dv = Math.max(PV0 - vw, 0, vw - PV1);
  return Math.hypot(du, dv);
}

// Structure footprints that vegetation must avoid (1 m grid).
const BLOCK = new Uint8Array(GN * GN);
function blockCircle(x, z, r) {
  const i0 = Math.max(0, Math.floor(x - r + HALF)), i1 = Math.min(GN - 1, Math.ceil(x + r + HALF));
  const j0 = Math.max(0, Math.floor(z - r + HALF)), j1 = Math.min(GN - 1, Math.ceil(z + r + HALF));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = i - HALF - x, dz = j - HALF - z;
    if (dx * dx + dz * dz <= r * r) BLOCK[j * GN + i] = 1;
  }
}
function blocked(x, z) {
  const i = Math.round(x + HALF), j = Math.round(z + HALF);
  if (i < 0 || j < 0 || i >= GN || j >= GN) return false;
  return BLOCK[j * GN + i] === 1;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

// Canvas texture (like util.canvasTexture, but with a readback-friendly context).
function ctex(w, h, drawFn, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  drawFn(g, w, h, c);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeTileNoise(seed) {
  const r = rand(seed);
  const T = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) T[i] = r();
  return function (x, y, per) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = x - xi, ty = y - yi;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ((xi % per) + per) % per, y0 = ((yi % per) + per) % per;
    const x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
    const a = T[(y0 & 255) * 256 + (x0 & 255)], b = T[(y0 & 255) * 256 + (x1 & 255)];
    const c = T[(y1 & 255) * 256 + (x0 & 255)], d = T[(y1 & 255) * 256 + (x1 & 255)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
const TN1 = makeTileNoise(11), TN2 = makeTileNoise(23), TN3 = makeTileNoise(37);
function tfbm(nf, u, v, per, oct) {
  let s = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * nf(u * per, v * per, per); norm += amp; amp *= 0.5; per *= 2; }
  return s / norm;
}
const _px = [0, 0, 0, 255];
function pixelFill(g, x0, y0, w, h, fn) {
  // getImageData/putImageData ignore the transform, so apply the current translation.
  const tr = g.getTransform();
  x0 += Math.round(tr.e); y0 += Math.round(tr.f);
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      _px[3] = 255;
      fn(x / w, y / h, x, y, _px);
      const k = (y * w + x) * 4;
      d[k] = _px[0]; d[k + 1] = _px[1]; d[k + 2] = _px[2]; d[k + 3] = _px[3];
    }
  }
  g.putImageData(img, x0, y0);
}
function wrapDraw(W, H, x, y, r, fn) {
  for (let ox = -W; ox <= W; ox += W) {
    if (x + ox < -r || x + ox > W + r) continue;
    for (let oy = -H; oy <= H; oy += H) {
      if (y + oy < -r || y + oy > H + r) continue;
      fn(x + ox, y + oy);
    }
  }
}
const hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a})`;

function leafPath(g, L, W) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(L * 0.2, -W * 0.62, L * 0.6, -W * 0.56, L, 0);
  g.bezierCurveTo(L * 0.6, W * 0.56, L * 0.2, W * 0.62, 0, 0);
  g.closePath();
}
// A single leaf pointing along +x from (x, y).
function drawLeaf(g, x, y, ang, L, W, h, s, l, opt = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  leafPath(g, L, W);
  const gr = g.createLinearGradient(0, -W * 0.5, 0, W * 0.5);
  gr.addColorStop(0, hsl(h, s, l * 1.18));
  gr.addColorStop(0.45, hsl(h, s, l));
  gr.addColorStop(1, hsl(h + 4, s * 0.9, l * 0.7));
  g.fillStyle = gr;
  g.fill();
  if (opt.tip) {
    g.save(); g.clip();
    g.fillStyle = hsl(32, 45, 30, 0.85);
    g.fillRect(L * (1 - opt.tip), -W, L * opt.tip + 2, W * 2);
    g.restore();
  }
  if (L > 14) {
    g.strokeStyle = hsl(h + 10, s * 0.6, Math.min(l * 1.7, 72), 0.55);
    g.lineWidth = Math.max(0.8, W * 0.06);
    g.beginPath(); g.moveTo(L * 0.02, 0); g.quadraticCurveTo(L * 0.5, W * 0.04, L * 0.93, 0); g.stroke();
    if (L > 34) {
      g.lineWidth = Math.max(0.5, W * 0.025);
      g.strokeStyle = hsl(h + 8, s * 0.6, Math.min(l * 1.5, 65), 0.28);
      const n = Math.min(9, Math.floor(L / 12));
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1), x0 = L * t, ww = W * 0.38 * (1 - t * 0.55);
        g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + L * 0.1, -ww); g.moveTo(x0, 0); g.lineTo(x0 + L * 0.1, ww); g.stroke();
      }
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Foliage atlas (2048 x 2048, alpha-tested)
// ---------------------------------------------------------------------------
const AS = 2048;
const REG = {
  leafA: [0, 0, 512, 512], leafB: [512, 0, 512, 512], leafBig: [1024, 0, 512, 512], bambooLeaf: [1536, 0, 512, 512],
  cocoFrond: [0, 512, 256, 1024], arecaFrond: [256, 512, 256, 1024],
  banana: [512, 512, 256, 512], fern: [768, 512, 256, 512],
  grass: [1024, 512, 512, 256], rice: [1024, 768, 512, 256],
  barkPale: [1536, 512, 256, 512], barkPalm: [1792, 512, 256, 512],
  elephant: [512, 1024, 256, 256],
  coconut: [512, 1280, 128, 128], bud: [640, 1280, 128, 128], fruit: [512, 1408, 128, 128], woodRing: [640, 1408, 128, 128],
  vine: [768, 1024, 128, 512], bananaStem: [896, 1024, 128, 512],
  tallGrass: [1024, 1024, 512, 512],
  bamboo: [1536, 1024, 128, 512], barkDark: [1664, 1024, 256, 512],
  litter: [0, 1536, 512, 512], rock: [512, 1536, 512, 512],
};
function reg(name) {
  const [x, y, w, h] = REG[name];
  const p = 3;
  return { u0: (x + p) / AS, u1: (x + w - p) / AS, vt: (y + p) / AS, vb: (y + h - p) / AS };
}

function drawCluster(g, w, h, rng, o) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46;
  // twigs
  g.lineCap = 'round';
  for (let i = 0; i < o.twigs; i++) {
    const a = rng() * TAU, len = R * (0.5 + rng() * 0.45);
    g.strokeStyle = hsl(25, 25, 18 + rng() * 10, 0.95);
    g.lineWidth = 2.5 + rng() * 2;
    g.beginPath(); g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a + 0.3) * len * 0.5, cy + Math.sin(a + 0.3) * len * 0.5, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.stroke();
  }
  const list = [];
  for (let i = 0; i < o.count; i++) {
    const rr = R * Math.pow(rng(), 0.62) * 0.86, a = rng() * TAU;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * o.squash;
    const ang = a + (rng() - 0.5) * 1.3;
    const L = o.Lmin + rng() * (o.Lmax - o.Lmin);
    const W = L * (o.wr + rng() * 0.12);
    // fit inside region: shorten when tip would leave the disc
    const tx = x + Math.cos(ang) * L - cx, ty = y + Math.sin(ang) * L - cy;
    const sc = Math.hypot(tx, ty) > R ? 0.65 : 1;
    const top = 1 - y / h;
    list.push({ x, y, ang, L: L * sc, W: W * sc, depth: rng() + top * 0.8 });
  }
  list.sort((a, b) => a.depth - b.depth);
  for (const lf of list) {
    const lit = o.l + lf.depth * o.lRange + (rng() - 0.5) * 4;
    drawLeaf(g, lf.x, lf.y, lf.ang, lf.L, lf.W, o.h + (rng() - 0.5) * o.hRange, o.s + (rng() - 0.5) * 10, lit,
      { tip: rng() < o.brown ? 0.25 + rng() * 0.3 : 0 });
  }
}

function drawFrond(g, w, h, rng, o) {
  // rachis bottom-centre to top-centre, leaflets angled toward the tip
  const cx = w / 2;
  const leaflets = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < o.n; i++) {
      const t = (i + rng() * 0.6) / o.n;
      if (rng() < o.gap) continue;
      const y = h * 0.985 - t * h * 0.97;
      const env = Math.pow(Math.sin(Math.PI * (0.06 + t * 0.94)), 0.55) * (1 - t * 0.25);
      const L = (w * 0.5 - 6) * env * (0.82 + rng() * 0.18);
      const a = -Math.PI / 2 + side * (Math.PI / 2 - o.angle - t * 0.25);
      leaflets.push({ x: cx + side * 2, y, a, L, side, t });
    }
  }
  for (const lf of leaflets) {
    const light = o.l + (rng() - 0.5) * 8 - lf.t * 3;
    drawLeaf(g, lf.x, lf.y, lf.a + (lf.side > 0 ? 0.0 : 0) , lf.L, o.leafW * (0.8 + rng() * 0.4), o.h + (rng() - 0.5) * 8, o.s, light,
      { tip: rng() < o.brown ? 0.15 + rng() * 0.3 : 0 });
  }
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = k === 0 ? hsl(60, 35, 28) : hsl(62, 40, 40, 0.6);
    g.lineWidth = (k === 0 ? 7 : 3) - k;
    g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + 3, h * 0.5, cx, 2); g.stroke();
  }
}

function drawBanana(g, w, h, rng) {
  const cx = w / 2;
  g.save();
  g.beginPath();
  g.moveTo(cx, h - 2);
  g.bezierCurveTo(cx - w * 0.52, h * 0.85, cx - w * 0.5, h * 0.15, cx - 6, 4);
  g.quadraticCurveTo(cx, 0, cx + 6, 4);
  g.bezierCurveTo(cx + w * 0.5, h * 0.15, cx + w * 0.52, h * 0.85, cx, h - 2);
  g.closePath();
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, hsl(88, 50, 30)); gr.addColorStop(0.45, hsl(92, 55, 38)); gr.addColorStop(0.55, hsl(90, 52, 36)); gr.addColorStop(1, hsl(86, 48, 27));
  g.fillStyle = gr; g.fill();
  g.clip();
  // lateral veins
  for (let y = 6; y < h; y += 4) {
    g.strokeStyle = hsl(90, 45, 25 + rng() * 15, 0.18 + rng() * 0.1);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, y); g.lineTo(0, y - 26); g.moveTo(cx, y); g.lineTo(w, y - 26); g.stroke();
  }
  // brown dry patches along the edge
  for (let i = 0; i < 7; i++) {
    const y = rng() * h, side = rng() < 0.5 ? -1 : 1;
    g.fillStyle = hsl(34, 40, 30, 0.6);
    g.beginPath(); g.ellipse(cx + side * w * 0.48, y, 16 + rng() * 14, 24 + rng() * 30, 0, 0, TAU); g.fill();
  }
  g.restore();
  // tears
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 11; i++) {
    const y = 40 + rng() * (h - 90), side = rng() < 0.5 ? -1 : 1;
    const len = w * (0.2 + rng() * 0.28);
    g.lineWidth = 2 + rng() * 3;
    g.beginPath(); g.moveTo(cx + side * w * 0.52, y); g.lineTo(cx + side * (w * 0.5 - len), y + 26 * len / (w * 0.5)); g.stroke();
  }
  g.restore();
  // midrib
  g.strokeStyle = hsl(70, 40, 52, 0.9); g.lineWidth = 7;
  g.beginPath(); g.moveTo(cx, h); g.lineTo(cx, 6); g.stroke();
  g.strokeStyle = hsl(80, 35, 32, 0.6); g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx + 3, h); g.lineTo(cx + 2, 6); g.stroke();
}

function drawFern(g, w, h, rng) {
  const cx = w / 2;
  const n = 24;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const t = (i + (side > 0 ? 0.5 : 0)) / n;
      const y = h * 0.97 - t * h * 0.93;
      const L = (w * 0.5 - 6) * (1 - t * 0.82) * (t < 0.08 ? 0.6 : 1);
      const a = -Math.PI / 2 + side * (Math.PI / 2 - 0.25 - t * 0.35);
      const lobes = Math.max(3, Math.floor(L / 7));
      const hue = 98 + (rng() - 0.5) * 10, lit = 29 + rng() * 6 + t * 6;
      g.save(); g.translate(cx, y); g.rotate(a);
      for (let k = 0; k < lobes; k++) {
        const s = k / lobes, x = s * L;
        const rw = (1 - s * 0.85) * Math.max(4, L * 0.13);
        g.fillStyle = hsl(hue, 45, lit * (0.85 + s * 0.3));
        g.beginPath(); g.ellipse(x + rw * 0.4, 0, rw * 0.9, rw, 0.5, 0, TAU); g.fill();
      }
      g.strokeStyle = hsl(80, 30, 30, 0.7); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(L, 0); g.stroke();
      g.restore();
    }
  }
  g.strokeStyle = hsl(50, 35, 22); g.lineWidth = 4;
  g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + 2, h * 0.5, cx, 6); g.stroke();
}

function drawElephantEar(g, w, h, rng) {
  // attach point at the bottom (base of card), tip at the top
  const cx = w / 2, by = h * 0.86;
  g.save();
  g.beginPath();
  g.moveTo(cx, by - 10);
  g.bezierCurveTo(cx - w * 0.18, h + 6, cx - w * 0.5, h * 0.9, cx - w * 0.46, h * 0.55);
  g.bezierCurveTo(cx - w * 0.4, h * 0.25, cx - w * 0.1, h * 0.08, cx, 4);
  g.bezierCurveTo(cx + w * 0.1, h * 0.08, cx + w * 0.4, h * 0.25, cx + w * 0.46, h * 0.55);
  g.bezierCurveTo(cx + w * 0.5, h * 0.9, cx + w * 0.18, h + 6, cx, by - 10);
  g.closePath();
  const gr = g.createRadialGradient(cx, by - 20, 10, cx, h * 0.4, w * 0.7);
  gr.addColorStop(0, hsl(100, 38, 30)); gr.addColorStop(1, hsl(108, 42, 20));
  g.fillStyle = gr; g.fill();
  g.clip();
  g.strokeStyle = hsl(85, 30, 50, 0.55); g.lineWidth = 2.5;
  const veins = [-1.25, -0.8, -0.42, 0, 0.42, 0.8, 1.25, 2.2, -2.2];
  for (const v of veins) {
    const a = -Math.PI / 2 + v;
    g.beginPath(); g.moveTo(cx, by - 14);
    g.quadraticCurveTo(cx + Math.cos(a) * w * 0.25, by - 14 + Math.sin(a) * h * 0.3, cx + Math.cos(a) * w * 0.55, by - 14 + Math.sin(a) * h * 0.7);
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = hsl(40, 35, 32, 0.35);
    g.beginPath(); g.ellipse(rng() * w, rng() * h * 0.6, 10 + rng() * 10, 6 + rng() * 8, rng() * 3, 0, TAU); g.fill();
  }
  g.restore();
}

function drawVine(g, w, h, rng) {
  const cx = w / 2;
  g.strokeStyle = hsl(30, 30, 22); g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, 0);
  for (let y = 0; y <= h; y += 16) g.lineTo(cx + Math.sin(y * 0.05) * 10, y);
  g.stroke();
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = hsl(28, 25, 26, 0.8); g.lineWidth = 1;
    const x0 = cx + (rng() - 0.5) * 30;
    g.beginPath(); g.moveTo(x0, rng() * 100); g.quadraticCurveTo(x0 + (rng() - 0.5) * 30, h * 0.5, x0 + (rng() - 0.5) * 20, h); g.stroke();
  }
  for (let y = 10; y < h - 10; y += 17) {
    const side = (Math.floor(y / 17) % 2) ? 1 : -1;
    const x = cx + Math.sin(y * 0.05) * 10;
    drawLeaf(g, x, y, side > 0 ? 0.5 + rng() * 0.4 : Math.PI - 0.5 - rng() * 0.4, 26 + rng() * 22, 20 + rng() * 8, 100 + rng() * 15, 40, 22 + rng() * 10);
  }
}

// Grass blades rising from the bottom edge. Blades are narrow and tapered, their feet are
// staggered (o.ragged) and the bottom band is eaten away (o.fadeBase) so a clump never ends
// in a straight opaque edge on the ground.
function drawBlades(g, w, h, rng, o) {
  const list = [];
  for (let i = 0; i < o.n; i++) {
    // blades cluster in a few tillers instead of a uniform comb
    const tiller = Math.floor(rng() * (o.tillers || 1));
    const tc = (o.tillers ? ((tiller + 0.5) / o.tillers - 0.5) * w * o.spread : 0);
    const bx = w / 2 + tc + (rng() - 0.5) * w * o.spread * (o.tillers ? 0.45 : 1);
    const by = h - (o.ragged ? rng() * h * o.ragged : 0);
    const ht = by * (o.hMin + rng() * (1 - o.hMin)) * 0.98;
    list.push({ bx, by, ht, depth: rng() });
  }
  list.sort((a, b) => a.depth - b.depth);
  for (const bl of list) {
    const { bx, by, ht } = bl;
    const lean = (rng() - 0.5) * o.lean + (bx - w / 2) / w * o.lean;
    const bw = o.bw * (0.65 + rng() * 0.6);
    const tx = bx + lean * ht, ty = by - ht;
    const mx = bx + lean * ht * 0.35, my = by - ht * 0.55;
    const dry = rng() < o.dry;
    const gr = g.createLinearGradient(0, by, 0, ty);
    const hue = dry ? 40 + rng() * 10 : o.h + (rng() - 0.5) * 18;
    const sat = dry ? 30 : o.s;
    const lit = dry ? 36 + rng() * 10 : o.l + (rng() - 0.5) * 12 + bl.depth * 5;
    gr.addColorStop(0, hsl(hue + 6, sat * 0.7, lit * 0.5));
    gr.addColorStop(0.45, hsl(hue, sat * 0.95, lit * 0.95));
    gr.addColorStop(1, hsl(hue - 4, sat, lit * 1.2));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(bx - bw, by);
    g.quadraticCurveTo(mx - bw * 0.45, my, tx, ty);
    g.quadraticCurveTo(mx + bw * 0.45, my, bx + bw, by);
    g.closePath(); g.fill();
    // pale midrib catches the light
    if (ht > h * 0.35) {
      g.strokeStyle = hsl(hue, sat * 0.6, Math.min(lit * 1.5, 70), 0.35); g.lineWidth = Math.max(0.6, bw * 0.3);
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(mx, my, lerp(mx, tx, 0.8), lerp(my, ty, 0.8)); g.stroke();
    }
    if (o.plumes && rng() < o.plumes) {
      g.strokeStyle = hsl(38, 22, 52, 0.45); g.lineWidth = 0.8;
      for (let k = 0; k < 12; k++) {
        g.beginPath(); g.moveTo(tx, ty);
        g.lineTo(tx + (rng() - 0.5) * 18 + lean * 16, ty + 8 + rng() * 30);
        g.stroke();
      }
    }
  }
  if (o.fadeBase) {
    const fb = h * o.fadeBase;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const gr = g.createLinearGradient(0, h, 0, h - fb);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, h - fb, w, fb);
    // ragged notches so the base dissolves unevenly
    for (let i = 0; i < 90; i++) {
      const x = rng() * w, hh = fb * (0.4 + rng() * 1.1);
      g.fillStyle = `rgba(0,0,0,${0.5 + rng() * 0.5})`;
      g.beginPath(); g.moveTo(x - 2 - rng() * 4, h); g.lineTo(x + (rng() - 0.5) * 4, h - hh); g.lineTo(x + 2 + rng() * 4, h); g.fill();
    }
    g.restore();
  }
}

function drawBark(g, w, h, rng, o) {
  pixelFill(g, 0, 0, w, h, (u, v, x, y, out) => {
    const n = tfbm(TN1, u, v * o.vs, 8, 5);
    const s = tfbm(TN2, u * 3, v * o.vs * 0.25, 16, 3);
    const k = o.base;
    let f = 0.75 + n * 0.5 + (s - 0.5) * o.streak;
    if (o.rings) { const rv = (v * o.rings) % 1; f *= rv < 0.12 ? 0.72 : rv < 0.22 ? 1.12 : 1; }
    const moss = o.moss ? smoothstep(0.65, 1.0, v) * smoothstep(0.35, 0.7, tfbm(TN3, u, v * 2, 8, 3)) : 0;
    out[0] = clamp(lerp(k[0] * f, 70, moss * 0.6), 0, 255);
    out[1] = clamp(lerp(k[1] * f, 92, moss * 0.6), 0, 255);
    out[2] = clamp(lerp(k[2] * f, 40, moss * 0.6), 0, 255);
  });
  if (o.lichen) {
    for (let i = 0; i < o.lichen; i++) {
      const c = [hsl(60, 8, 78, 0.5), hsl(80, 22, 62, 0.45), hsl(30, 45, 55, 0.35)][Math.floor(rng() * 3)];
      g.fillStyle = c;
      const x = rng() * w, y = rng() * h, r = 4 + rng() * 14;
      wrapDraw(w, h, x, y, r, (px, py) => { g.beginPath(); g.ellipse(px, py, r, r / o.vs * 1.4, 0, 0, TAU); g.fill(); });
    }
  }
  if (o.fissures) {
    for (let i = 0; i < o.fissures; i++) {
      g.strokeStyle = `rgba(20,15,10,${0.2 + rng() * 0.3})`;
      g.lineWidth = 1 + rng() * 2;
      const x = rng() * w;
      g.beginPath(); g.moveTo(x, rng() * h);
      g.lineTo(x + (rng() - 0.5) * 6, rng() * h); g.stroke();
    }
  }
}

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = AS; c.height = AS;
  const g = c.getContext('2d', { willReadFrequently: true });
  const rng = rand(4242);
  const inReg = (name, fn) => {
    const [x, y, w, h] = REG[name];
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
    fn(w, h);
    g.restore();
  };
  inReg('leafA', (w, h) => drawCluster(g, w, h, rng, { count: 150, Lmin: 46, Lmax: 82, wr: 0.36, h: 104, hRange: 16, s: 44, l: 21, lRange: 14, squash: 0.9, twigs: 6, brown: 0.06 }));
  inReg('leafB', (w, h) => drawCluster(g, w, h, rng, { count: 300, Lmin: 26, Lmax: 46, wr: 0.42, h: 92, hRange: 18, s: 46, l: 24, lRange: 15, squash: 0.95, twigs: 8, brown: 0.04 }));
  inReg('leafBig', (w, h) => drawCluster(g, w, h, rng, { count: 34, Lmin: 120, Lmax: 175, wr: 0.38, h: 108, hRange: 12, s: 42, l: 20, lRange: 12, squash: 1, twigs: 4, brown: 0.12 }));
  inReg('bambooLeaf', (w, h) => {
    g.lineCap = 'round';
    for (let t = 0; t < 7; t++) {
      const x0 = 60 + rng() * (w - 120), y0 = 40 + rng() * 120;
      const a0 = Math.PI * (0.3 + rng() * 0.4);
      g.strokeStyle = hsl(60, 30, 35); g.lineWidth = 2;
      const x1 = x0 + Math.cos(a0) * 160, y1 = y0 + Math.sin(a0) * 160;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      for (let k = 0; k < 11; k++) {
        const s = rng(), px = lerp(x0, x1, s), py = lerp(y0, y1, s);
        drawLeaf(g, px, py, a0 + (rng() - 0.5) * 1.8, 80 + rng() * 60, 12 + rng() * 6, 84 + rng() * 14, 46, 30 + rng() * 10, { tip: rng() < 0.15 ? 0.3 : 0 });
      }
    }
  });
  inReg('cocoFrond', (w, h) => drawFrond(g, w, h, rng, { n: 62, gap: 0.05, angle: 0.42, leafW: 8.5, h: 78, s: 46, l: 30, brown: 0.12 }));
  inReg('arecaFrond', (w, h) => drawFrond(g, w, h, rng, { n: 70, gap: 0.02, angle: 0.62, leafW: 10, h: 86, s: 50, l: 33, brown: 0.05 }));
  inReg('banana', (w, h) => drawBanana(g, w, h, rng));
  inReg('fern', (w, h) => drawFern(g, w, h, rng));
  inReg('elephant', (w, h) => drawElephantEar(g, w, h, rng));
  inReg('vine', (w, h) => drawVine(g, w, h, rng));
  inReg('grass', (w, h) => drawBlades(g, w, h, rng, { n: 120, spread: 0.72, tillers: 5, hMin: 0.4, lean: 0.9, bw: 2.6, h: 88, s: 42, l: 30, dry: 0.07, ragged: 0.1, fadeBase: 0.14 }));
  inReg('rice', (w, h) => {
    for (let t = 0; t < 7; t++) {
      g.save(); g.translate((t - 3) * 72, 0);
      drawBlades(g, w, h, rng, { n: 16, spread: 0.06, hMin: 0.6, lean: 0.75, bw: 3, h: 90, s: 36, l: 31, dry: 0.03 });
      g.restore();
    }
  });
  inReg('tallGrass', (w, h) => drawBlades(g, w, h, rng, { n: 140, spread: 0.78, tillers: 6, hMin: 0.45, lean: 0.8, bw: 2.8, h: 80, s: 38, l: 31, dry: 0.1, plumes: 0.04, ragged: 0.12, fadeBase: 0.12 }));
  inReg('barkPale', (w, h) => drawBark(g, w, h, rng, { base: [150, 144, 128], vs: 0.35, streak: 0.35, lichen: 160, fissures: 30, moss: true }));
  inReg('barkPalm', (w, h) => drawBark(g, w, h, rng, { base: [118, 108, 92], vs: 0.4, streak: 0.25, rings: 34, lichen: 30, moss: true }));
  inReg('barkDark', (w, h) => drawBark(g, w, h, rng, { base: [92, 78, 62], vs: 0.4, streak: 0.5, lichen: 60, fissures: 90, moss: true }));
  inReg('bamboo', (w, h) => {
    drawBark(g, w, h, rng, { base: [110, 138, 60], vs: 0.5, streak: 0.3 });
    // fine vertical fibres
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? '200,215,140' : '40,55,18'},${0.06 + rng() * 0.08})`;
      g.fillRect(rng() * w, 0, 1 + rng() * 2, h);
    }
    for (let y = 8; y < h; y += 30 + rng() * 6) {
      // raised node: soft swelling, pale sheath scar, dark ring below
      const sw = g.createLinearGradient(0, y - 7, 0, y + 9);
      sw.addColorStop(0, 'rgba(0,0,0,0)'); sw.addColorStop(0.4, 'rgba(230,235,180,0.22)');
      sw.addColorStop(0.62, 'rgba(20,25,8,0.3)'); sw.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sw; g.fillRect(0, y - 7, w, 16);
      g.fillStyle = hsl(54, 28, 66, 0.95); g.fillRect(0, y, w, 2.5);
      g.fillStyle = hsl(44, 30, 52, 0.7); g.fillRect(0, y + 2.5, w, 2);
      g.fillStyle = 'rgba(28,32,10,0.8)'; g.fillRect(0, y + 4.5, w, 1.5);
    }
    for (let i = 0; i < 8; i++) { g.fillStyle = hsl(40, 35, 45, 0.4); g.fillRect(rng() * w, rng() * h, 6 + rng() * 20, 30 + rng() * 60); }
  });
  inReg('bananaStem', (w, h) => {
    drawBark(g, w, h, rng, { base: [104, 134, 62], vs: 0.3, streak: 0.6 });
    for (let i = 0; i < 18; i++) { g.fillStyle = hsl(30 + rng() * 15, 35, 30 + rng() * 15, 0.45); g.fillRect(rng() * w, rng() * h, 3 + rng() * 10, 40 + rng() * 140); }
  });
  inReg('coconut', (w, h) => { const gr = g.createRadialGradient(w * 0.4, h * 0.4, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, hsl(70, 35, 40)); gr.addColorStop(1, hsl(45, 40, 24)); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  inReg('bud', (w, h) => { g.fillStyle = hsl(340, 35, 24); g.fillRect(0, 0, w, h); });
  inReg('fruit', (w, h) => { g.fillStyle = hsl(78, 45, 34); g.fillRect(0, 0, w, h); });
  inReg('woodRing', (w, h) => {
    g.fillStyle = hsl(35, 35, 52); g.fillRect(0, 0, w, h);
    for (let r = 4; r < w * 0.7; r += 5 + rng() * 3) { g.strokeStyle = hsl(30, 35, 36, 0.5); g.lineWidth = 1.5; g.beginPath(); g.arc(w / 2, h / 2, r, 0, TAU); g.stroke(); }
  });
  inReg('rock', (w, h) => {
    pixelFill(g, 0, 0, w, h, (u, v, x, y, out) => {
      const n = tfbm(TN1, u, v, 6, 5), m = tfbm(TN3, u, v, 4, 4);
      const crack = Math.abs(tfbm(TN2, u, v, 5, 3) - 0.5) < 0.018 ? 0.6 : 1;
      const moss = smoothstep(0.55, 0.75, m) * smoothstep(0.6, 0.15, v);
      const base = 95 + n * 70;
      out[0] = lerp(base * 0.98, 62, moss) * crack; out[1] = lerp(base * 0.93, 84, moss) * crack; out[2] = lerp(base * 0.85, 36, moss) * crack;
    });
  });
  inReg('litter', (w, h) => {
    for (let i = 0; i < 300; i++) {
      const rr = (w * 0.47) * Math.sqrt(rng()), a = rng() * TAU;
      if (rr > w * 0.33 && rng() < (rr - w * 0.33) / (w * 0.14)) continue;
      const x = w / 2 + Math.cos(a) * rr, y = h / 2 + Math.sin(a) * rr;
      const L = 20 + rng() * 30;
      const hue = rng() < 0.12 ? 70 + rng() * 20 : 18 + rng() * 22;
      g.save(); g.globalAlpha = 0.3; drawLeaf(g, x + 2, y + 2, rng() * TAU, L, L * 0.45, 20, 20, 8); g.restore();
      drawLeaf(g, x, y, rng() * TAU, L, L * (0.32 + rng() * 0.2), hue, 32 + rng() * 24, 28 + rng() * 24);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      g.strokeStyle = hsl(28, 30, 20 + rng() * 10); g.lineWidth = 2 + rng() * 2;
      const x = w * 0.25 + rng() * w * 0.5, y = h * 0.25 + rng() * h * 0.5, a = rng() * TAU, l = 40 + rng() * 80;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });

  // Fill transparent texels with nearby leaf colour so mipmaps don't darken edges.
  const img = g.getImageData(0, 0, AS, AS);
  const d = img.data, B = 16, NB = AS / B;
  const avg = new Float32Array(NB * NB * 3);
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = by * B; y < by * B + B; y += 2) for (let x = bx * B; x < bx * B + B; x += 2) {
      const k = (y * AS + x) * 4;
      if (d[k + 3] > 140) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
    }
    const o = (by * NB + bx) * 3;
    if (n > 0) { avg[o] = r / n; avg[o + 1] = gg / n; avg[o + 2] = b / n; } else { avg[o] = -1; }
  }
  // spread block averages into empty blocks (two passes)
  for (let pass = 0; pass < 3; pass++) {
    for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
      const o = (by * NB + bx) * 3;
      if (avg[o] >= 0) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx, yy = by + dy;
        if (xx < 0 || yy < 0 || xx >= NB || yy >= NB) continue;
        const q = (yy * NB + xx) * 3;
        if (avg[q] >= 0) { r += avg[q]; gg += avg[q + 1]; b += avg[q + 2]; n++; }
      }
      if (n) { avg[o] = r / n; avg[o + 1] = gg / n; avg[o + 2] = b / n; }
    }
  }
  for (let y = 0; y < AS; y++) {
    const by = (y / B) | 0;
    for (let x = 0; x < AS; x++) {
      const k = (y * AS + x) * 4;
      if (d[k + 3] < 24) {
        const o = (by * NB + ((x / B) | 0)) * 3;
        if (avg[o] >= 0) { d[k] = avg[o]; d[k + 1] = avg[o + 1]; d[k + 2] = avg[o + 2]; } else { d[k] = 40; d[k + 1] = 52; d[k + 2] = 24; }
        d[k + 3] = 0;
      }
    }
  }
  const tex = new THREE.DataTexture(d, AS, AS, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Atlas normal map (half resolution) from the albedo luminance: raised leaf veins, bark
// fissures, grass blades. Alpha holds a roughness scale per region (waxy leaves are glossy,
// bark and stone are rough). Same layout and orientation as the atlas (flipY false).
const ATLAS_ROUGH = {
  leafA: 0.7, leafB: 0.72, leafBig: 0.64, bambooLeaf: 0.72, cocoFrond: 0.72, arecaFrond: 0.7, banana: 0.6,
  fern: 0.78, elephant: 0.6, vine: 0.75, grass: 0.8, tallGrass: 0.82, rice: 0.76,
  barkPale: 0.92, barkPalm: 0.9, barkDark: 0.95, bamboo: 0.55, bananaStem: 0.6,
  coconut: 0.6, bud: 0.6, fruit: 0.5, woodRing: 0.9, litter: 0.8, rock: 0.74,
};
function buildAtlasNormal(atlas) {
  const src = atlas?.image?.data;
  if (!src) return null;
  const N = AS >> 1, H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let l = 0;
    for (let q = 0; q < 4; q++) {
      const k = ((y * 2 + (q >> 1)) * AS + x * 2 + (q & 1)) * 4;
      l += 0.3 * src[k] + 0.59 * src[k + 1] + 0.11 * src[k + 2];
    }
    H[y * N + x] = l / (4 * 255);
  }
  const rough = new Uint8Array(N * N).fill(204);
  for (const name in REG) {
    const r = ATLAS_ROUGH[name];
    if (r === undefined) continue;
    const [x, y, w, h] = REG[name], v = Math.round(r * 255);
    for (let yy = y >> 1; yy < (y + h) >> 1; yy++) rough.fill(v, yy * N + (x >> 1), yy * N + ((x + w) >> 1));
  }
  const out = new Uint8Array(N * N * 4), st = 2.6;
  for (let y = 0; y < N; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < N - 1 ? y + 1 : y;
    for (let x = 0; x < N; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < N - 1 ? x + 1 : x;
      const dx = (H[y * N + xr] - H[y * N + xl]) * st, dy = (H[yd * N + x] - H[yu * N + x]) * st;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), k = (y * N + x) * 4;
      out[k] = (-dx * l * 0.5 + 0.5) * 255; out[k + 1] = (-dy * l * 0.5 + 0.5) * 255; out[k + 2] = (l * 0.5 + 0.5) * 255;
      out[k + 3] = rough[y * N + x];
    }
  }
  const tex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Tileable tangent-space normal map from a canvas texture's luminance (height = luma).
function lumaHeights(src, invert, blur) {
  const c = src.image, w = c.width, h = c.height;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255;
    H[i] = invert ? 1 - l : l;
  }
  for (let b = 0; b < (blur || 0); b++) {
    const O = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) a += H[((y + oy + h) % h) * w + ((x + ox + w) % w)];
      O[y * w + x] = a / 9;
    }
    H = O;
  }
  return { H, w, h };
}
function lumaNormal(src, strength, o = {}) {
  const { H, w, h } = lumaHeights(src, o.invert, o.blur);
  return ctex(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (H[y * w + xr] - H[y * w + xl]) * strength, dy = (H[yd * w + x] - H[yu * w + x]) * strength;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1), k = (y * w + x) * 4;
      d[k] = (-dx * l * 0.5 + 0.5) * 255; d[k + 1] = (dy * l * 0.5 + 0.5) * 255; d[k + 2] = (l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
// Roughness map (green channel, as three reads it) from luminance: base +- amp.
function lumaRough(src, base, amp, o = {}) {
  const { H, w, h } = lumaHeights(src, o.invert, 0);
  return ctex(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < w * h; i++) {
      const r = clamp(base + amp * (H[i] - 0.5) * 2, 0.04, 1);
      d[i * 4] = 255; d[i * 4 + 1] = r * 255; d[i * 4 + 2] = (o.metal ?? 0) * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

// ---------------------------------------------------------------------------
// Terrain textures (tileable, 512 px)
// ---------------------------------------------------------------------------
function terrainTextures() {
  const S = 512;
  const T = {};
  T.litter = ctex(S, S, (g, w, h) => {
    const rng = rand(71);
    // Albedo kept in the sRGB 70-140 range (linear ~0.08-0.25): leaf litter is mid-toned,
    // the darkness of the forest floor comes from the lighting, not the texture.
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN1, u, v, 8, 5), m = tfbm(TN2, u, v, 3, 3);
      o[0] = 76 + n * 48 + m * 18; o[1] = 58 + n * 36 + m * 12; o[2] = 38 + n * 22;
    });
    for (let i = 0; i < 1100; i++) {
      const x = rng() * w, y = rng() * h, L = 9 + rng() * 22, a = rng() * TAU;
      const green = rng() < 0.08;
      const hue = green ? 70 + rng() * 25 : 16 + rng() * 26;
      const lw = L * (0.3 + rng() * 0.22), ls = 28 + rng() * 26, ll = 28 + rng() * 24;
      wrapDraw(w, h, x, y, L, (px, py) => {
        g.save(); g.globalAlpha = 0.25; drawLeaf(g, px + 1.5, py + 1.5, a, L, L * 0.42, 20, 20, 10); g.restore();
        drawLeaf(g, px, py, a, L, lw, hue, ls, ll);
      });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 50; i++) {
      const x = rng() * w, y = rng() * h, a = rng() * TAU, l = 14 + rng() * 40;
      g.strokeStyle = hsl(26, 26, 22 + rng() * 16); g.lineWidth = 1 + rng() * 2;
      wrapDraw(w, h, x, y, l, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
    }
  });
  // Rough wild grass: clumps of uneven height, bare soil between them, scattered dead leaves.
  T.grass = ctex(S, S, (g, w, h) => {
    const rng = rand(72);
    const clump = (u, v) => 0.62 * tfbm(TN3, u, v, 5, 3) + 0.38 * tfbm(TN1, u + 0.37, v + 0.11, 2, 2);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN2, u, v, 8, 5), c = smoothstep(0.38, 0.62, clump(u, v));
      const f = 0.85 + n * 0.3;
      o[0] = lerp(104, 74, c) * f; o[1] = lerp(84, 92, c) * f; o[2] = lerp(56, 40, c) * f;
    });
    // dead leaves on the bare patches
    for (let i = 0; i < 160; i++) {
      const x = rng() * w, y = rng() * h;
      if (clump(x / w, y / h) > 0.5) continue;
      const L = 7 + rng() * 12, a = rng() * TAU;
      wrapDraw(w, h, x, y, L, (px, py) => drawLeaf(g, px, py, a, L, L * 0.4, 22 + rng() * 18, 34, 30 + rng() * 16));
    }
    g.lineCap = 'round';
    for (let i = 0; i < 14000; i++) {
      const x = rng() * w, y = rng() * h;
      const c = clump(x / w, y / h);
      if (rng() > smoothstep(0.32, 0.66, c) * 0.95 + 0.04) continue;
      // blades in a clump lean the same way and are longer in the middle of the clump
      const lean = TN1(x / w * 6, y / h * 6, 6) * TAU;
      const a = lean + (rng() - 0.5) * 1.4, l = 4 + rng() * 9 * (0.5 + c);
      const dry = rng() < 0.12;
      g.strokeStyle = dry ? hsl(44, 28, 46 + rng() * 12, 0.8) : hsl(68 + rng() * 34, 30 + rng() * 22, 28 + rng() * 22, 0.85);
      g.lineWidth = 0.8 + rng() * 1.2;
      wrapDraw(w, h, x, y, l, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
    }
  });
  T.mud = ctex(S, S, (g, w, h) => {
    const rng = rand(73);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN3, u, v, 6, 5), m = tfbm(TN1, u, v, 3, 4);
      const wet = smoothstep(0.55, 0.62, m);
      const f = lerp(0.85 + n * 0.4, 0.66 + n * 0.12, wet);
      o[0] = 128 * f; o[1] = 92 * f; o[2] = 58 * f;
    });
    for (let i = 0; i < 500; i++) {
      const x = rng() * w, y = rng() * h, r = 1 + rng() * 2.5;
      g.fillStyle = rng() < 0.5 ? 'rgba(48,36,24,0.45)' : 'rgba(156,132,100,0.4)';
      wrapDraw(w, h, x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
    }
    // footprints and scuffs of a trampled floor
    for (let i = 0; i < 26; i++) {
      const x = rng() * w, y = rng() * h, a = rng() * TAU;
      wrapDraw(w, h, x, y, 14, (px, py) => {
        g.save(); g.translate(px, py); g.rotate(a);
        g.fillStyle = 'rgba(52,38,24,0.28)'; g.beginPath(); g.ellipse(0, 0, 11, 4.5, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(160,136,104,0.18)'; g.beginPath(); g.ellipse(-1, -2, 9, 2, 0, 0, TAU); g.fill();
        g.restore();
      });
    }
  });
  T.laterite = ctex(S, S, (g, w, h) => {
    const rng = rand(74);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN1, u + 0.3, v, 6, 5), m = tfbm(TN2, u, v + 0.2, 3, 3);
      o[0] = 88 + n * 46 + m * 12; o[1] = 56 + n * 26 + m * 8; o[2] = 40 + n * 18;
    });
    for (let i = 0; i < 2200; i++) {
      const x = rng() * w, y = rng() * h, r = 0.8 + rng() * 2.6;
      wrapDraw(w, h, x, y, r + 1, (px, py) => {
        g.fillStyle = 'rgba(70,30,18,0.75)'; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
        g.fillStyle = 'rgba(190,120,80,0.35)'; g.beginPath(); g.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, TAU); g.fill();
      });
    }
  });
  T.moss = ctex(S, S, (g, w, h) => {
    const rng = rand(75);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN2, u + 0.5, v, 10, 5), m = tfbm(TN3, u, v, 4, 3);
      o[0] = 50 + n * 38 + m * 12; o[1] = 70 + n * 46 + m * 14; o[2] = 30 + n * 18;
    });
    for (let i = 0; i < 3000; i++) {
      const x = rng() * w, y = rng() * h, r = 0.8 + rng() * 1.6;
      g.fillStyle = hsl(80 + rng() * 20, 42, 34 + rng() * 18, 0.7);
      wrapDraw(w, h, x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
    }
  });
  // Detail normal map from a height field of leaf shapes + noise.
  T.normal = ctex(S, S, (g, w, h) => {
    const rng = rand(76);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => { const n = tfbm(TN1, u, v, 16, 4) * 120; o[0] = o[1] = o[2] = n; });
    for (let i = 0; i < 900; i++) {
      const x = rng() * w, y = rng() * h, L = 9 + rng() * 22, a = rng() * TAU;
      const l = 30 + rng() * 40;
      wrapDraw(w, h, x, y, L, (px, py) => drawLeaf(g, px, py, a, L, L * 0.4, 0, 0, l));
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const H = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) H[i] = d[i * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (H[y * w + xr] - H[y * w + xl]) * 3.2, dy = (H[yd * w + x] - H[yu * w + x]) * 3.2;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
  T.nMud = lumaNormal(T.mud, 3.2, { blur: 1 });
  T.nLat = lumaNormal(T.laterite, 4.0, { blur: 1 });
  T.nGra = lumaNormal(T.grass, 2.4);
  T.nMos = lumaNormal(T.moss, 2.0);
  T.macro = ctex(256, 256, (g, w, h) => {
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      o[0] = tfbm(TN1, u, v, 4, 4) * 255; o[1] = tfbm(TN2, u, v, 8, 4) * 255; o[2] = tfbm(TN3, u, v, 2, 3) * 255;
    });
  }, { srgb: false });
  return T;
}

// ---------------------------------------------------------------------------
// Structure textures
// ---------------------------------------------------------------------------
function structureTextures() {
  const T = {};
  T.sandbag = ctex(512, 256, (g, w, h) => {
    const rng = rand(81);
    g.fillStyle = '#2a2618'; g.fillRect(0, 0, w, h);
    const rows = 4, bh = h / rows, bw = 256;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5 + (rng() - 0.5) * 10;
      for (let i = -1; i <= w / bw; i++) {
        const x = i * bw + off + (rng() - 0.5) * 6, y = r * bh + (rng() - 0.5) * 3;
        const hue = rng() < 0.3 ? 66 + rng() * 10 : 40 + rng() * 12, sat = 11 + rng() * 9, lit = 33 + rng() * 10;
        wrapDraw(w, h, x + bw / 2, y + bh / 2, bw, (px, py) => {
          const x0 = px - bw / 2 + 2, y0 = py - bh / 2 + 2, ww = bw - 4, hh = bh - 4;
          const gr = g.createLinearGradient(0, y0, 0, y0 + hh);
          gr.addColorStop(0, hsl(hue, sat, lit * 1.25)); gr.addColorStop(0.55, hsl(hue, sat, lit)); gr.addColorStop(1, hsl(hue, sat, lit * 0.55));
          g.fillStyle = gr;
          g.beginPath();
          g.moveTo(x0 + 14, y0); g.lineTo(x0 + ww - 14, y0); g.quadraticCurveTo(x0 + ww, y0, x0 + ww, y0 + hh * 0.5);
          g.quadraticCurveTo(x0 + ww, y0 + hh, x0 + ww - 14, y0 + hh); g.lineTo(x0 + 14, y0 + hh);
          g.quadraticCurveTo(x0, y0 + hh, x0, y0 + hh * 0.5); g.quadraticCurveTo(x0, y0, x0 + 14, y0); g.fill();
          g.strokeStyle = 'rgba(20,18,10,0.35)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x0 + ww - 26, y0 + 5); g.lineTo(x0 + ww - 28, y0 + hh - 5); g.stroke();
          g.strokeStyle = 'rgba(255,245,220,0.12)'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(x0 + 18, y0 + 6); g.quadraticCurveTo(x0 + ww * 0.5, y0 + 2, x0 + ww - 18, y0 + 6); g.stroke();
        });
      }
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4, weave = ((x + y) % 4 < 2 ? 1.06 : 0.95) * (0.9 + TN1(x / 8, y / 8, 64) * 0.2);
      d[k] *= weave; d[k + 1] *= weave; d[k + 2] *= weave;
    }
    g.putImageData(img, 0, 0);
  });
  T.wood = ctex(256, 256, (g, w, h) => {
    const rng = rand(82);
    const planks = 5, ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const base = 0.75 + rng() * 0.35;
      pixelFill(g, 0, Math.floor(p * ph), w, Math.ceil(ph), (u, v, x, y, o) => {
        const grain = tfbm(TN2, u * 0.25 + p * 0.13, v * 2 + p * 0.21, 8, 4);
        const f = base * (0.8 + grain * 0.45);
        o[0] = 112 * f; o[1] = 96 * f; o[2] = 76 * f;
      });
      g.fillStyle = 'rgba(25,18,12,0.8)'; g.fillRect(0, p * ph, w, 2);
    }
  });
  T.canvas = ctex(256, 256, (g, w, h) => {
    const rng = rand(83);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN3, u, v, 4, 4), weave = ((x % 3) === 0 || (y % 3) === 0) ? 0.94 : 1;
      const f = (0.82 + n * 0.32) * weave;
      o[0] = 74 * f; o[1] = 78 * f; o[2] = 52 * f;
    });
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(40,35,20,${0.08 + rng() * 0.1})`;
      g.beginPath(); g.ellipse(rng() * w, rng() * h, 10 + rng() * 30, 6 + rng() * 20, rng() * 3, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(30,30,18,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  T.metal = ctex(256, 256, (g, w, h) => {
    const rng = rand(84);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const cor = 0.75 + 0.25 * Math.sin(u * TAU * 12);
      const n = tfbm(TN1, u, v, 8, 4);
      const rust = smoothstep(0.55, 0.75, tfbm(TN2, u * 0.5, v, 4, 4));
      o[0] = lerp(132 * cor * (0.85 + n * 0.3), 118 * cor, rust); o[1] = lerp(134 * cor * (0.85 + n * 0.3), 70 * cor, rust); o[2] = lerp(128 * cor * (0.85 + n * 0.3), 42 * cor, rust);
    });
    for (let i = 0; i < 20; i++) { g.fillStyle = 'rgba(110,60,30,0.25)'; g.fillRect(rng() * w, rng() * h * 0.6, 3, 30 + rng() * 80); }
  });
  T.psp = ctex(256, 256, (g, w, h) => {
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN3, u, v, 8, 4);
      const rust = smoothstep(0.6, 0.8, tfbm(TN1, u, v, 3, 3));
      o[0] = lerp(78, 96, rust) * (0.85 + n * 0.3); o[1] = lerp(80, 70, rust) * (0.85 + n * 0.3); o[2] = lerp(74, 52, rust) * (0.85 + n * 0.3);
    });
    for (let r = 0; r < 4; r++) {
      g.fillStyle = 'rgba(20,18,14,0.9)';
      for (let c = 0; c < 8; c++) { g.beginPath(); g.ellipse(c * 32 + 16 + (r % 2) * 16, r * 64 + 32, 10, 6, 0, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * 64, w, 3);
    }
  });
  T.thatch = ctex(512, 256, (g, w, h) => {
    const rng = rand(85);
    g.fillStyle = '#3a2e1c'; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let row = 0; row < 8; row++) {
      const y0 = row * (h / 8);
      for (let i = 0; i < 520; i++) {
        const x = rng() * w, y = y0 + rng() * (h / 8) * 0.6, l = 18 + rng() * 26;
        const lit = 34 + rng() * 24, hue = 38 + rng() * 10;
        g.strokeStyle = hsl(hue, 30 + rng() * 15, lit, 0.9); g.lineWidth = 1 + rng() * 1.5;
        const sk = (rng() - 0.5) * 6;
        wrapDraw(w, h, x, y, l, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + sk, py + l); g.stroke(); });
      }
      g.fillStyle = 'rgba(20,14,6,0.35)'; g.fillRect(0, y0 + (h / 8) * 0.92, w, 3);
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4, f = 0.7 + tfbm(TN2, x / w, y / h, 4, 3) * 0.5;
      d[k] *= f; d[k + 1] *= f; d[k + 2] *= f * 0.95;
    }
    g.putImageData(img, 0, 0);
  });
  T.weave = ctex(256, 256, (g, w, h) => {
    const s = 16;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      const odd = ((x + y) / s) % 2 === 0;
      const gr = odd ? g.createLinearGradient(x, 0, x + s, 0) : g.createLinearGradient(0, y, 0, y + s);
      gr.addColorStop(0, hsl(40, 30, 30)); gr.addColorStop(0.5, hsl(42, 38, 50)); gr.addColorStop(1, hsl(38, 30, 30));
      g.fillStyle = gr; g.fillRect(x, y, s, s);
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < w * h; i++) { const f = 0.8 + TN1((i % w) / 6, (i / w | 0) / 6, 42) * 0.35; d[i * 4] *= f; d[i * 4 + 1] *= f; d[i * 4 + 2] *= f; }
    g.putImageData(img, 0, 0);
  });
  T.crate = ctex(256, 256, (g, w, h) => {
    const rng = rand(86);
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const grain = tfbm(TN2, u * 0.3, v * 3, 8, 3);
      const f = 0.82 + grain * 0.3;
      o[0] = 66 * f; o[1] = 72 * f; o[2] = 44 * f;
    });
    g.fillStyle = 'rgba(20,22,12,0.8)';
    for (let i = 1; i < 4; i++) g.fillRect(0, i * 64 - 1, w, 2);
    g.strokeStyle = 'rgba(30,32,18,0.9)'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = 'rgba(214,190,90,0.85)';
    g.font = 'bold 34px monospace'; g.textAlign = 'center';
    g.fillText('105MM', w / 2, 92);
    g.font = 'bold 22px monospace';
    g.fillText('HE M1', w / 2, 132);
    g.font = '14px monospace';
    g.fillText('LOT 21-' + Math.floor(rng() * 900 + 100), w / 2, 170);
  });
  T.tarp = ctex(256, 256, (g, w, h) => {
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => {
      const n = tfbm(TN1, u, v, 3, 4), crease = 1 - 0.18 * Math.pow(Math.abs(Math.sin(u * 9 + n * 4)), 6);
      const f = (0.8 + n * 0.35) * crease;
      o[0] = 58 * f; o[1] = 66 * f; o[2] = 40 * f;
    });
  });
  T.clay = ctex(128, 128, (g, w, h) => {
    pixelFill(g, 0, 0, w, h, (u, v, x, y, o) => { const n = tfbm(TN3, u, v, 4, 4); o[0] = 140 * (0.8 + n * 0.4); o[1] = 82 * (0.8 + n * 0.4); o[2] = 52 * (0.8 + n * 0.4); });
  });
  // PBR detail: normal maps from each albedo's luminance, roughness where it varies
  T.n = {
    sandbag: lumaNormal(T.sandbag, 5.5, { blur: 1 }), wood: lumaNormal(T.wood, 3.0), canvas: lumaNormal(T.canvas, 2.4),
    thatch: lumaNormal(T.thatch, 5.0), weave: lumaNormal(T.weave, 4.0), crate: lumaNormal(T.crate, 1.6),
    tarp: lumaNormal(T.tarp, 3.5, { blur: 1 }), clay: lumaNormal(T.clay, 2.6), metal: lumaNormal(T.metal, 1.6), psp: lumaNormal(T.psp, 3.2),
  };
  T.r = {
    sandbag: lumaRough(T.sandbag, 0.93, 0.07), wood: lumaRough(T.wood, 0.8, 0.14, { invert: true }),
    canvas: lumaRough(T.canvas, 0.86, 0.1, { invert: true }), tarp: lumaRough(T.tarp, 0.6, 0.18, { invert: true }),
    metal: lumaRough(T.metal, 0.5, 0.3, { invert: true, metal: 1 }), psp: lumaRough(T.psp, 0.56, 0.28, { invert: true, metal: 1 }),
    crate: lumaRough(T.crate, 0.78, 0.12, { invert: true }), thatch: lumaRough(T.thatch, 0.92, 0.08, { invert: true }),
  };
  return T;
}

// ---------------------------------------------------------------------------
// Geometry builder for plants (position, normal, uv, color, aFol)
// aFol = (wind weight, flutter weight, translucency)
// ---------------------------------------------------------------------------
const WHITE = [1, 1, 1];
const UP = [0, 1, 0];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vsc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vmad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class GB {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.F = []; this.I = []; this.n = 0; }
  v(p, n, u, v, c, f) {
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.U.push(u, v);
    this.C.push(c[0], c[1], c[2]); this.F.push(f[0], f[1], f[2]);
    return this.n++;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aFol', new THREE.Float32BufferAttribute(this.F, 3));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function card(gb, c, a, b, n, R, col, fol) {
  const nn = vnorm(n);
  const i0 = gb.v([c[0] - a[0] - b[0], c[1] - a[1] - b[1], c[2] - a[2] - b[2]], nn, R.u0, R.vb, col, fol);
  const i1 = gb.v([c[0] + a[0] - b[0], c[1] + a[1] - b[1], c[2] + a[2] - b[2]], nn, R.u1, R.vb, col, fol);
  const i2 = gb.v([c[0] + a[0] + b[0], c[1] + a[1] + b[1], c[2] + a[2] + b[2]], nn, R.u1, R.vt, col, fol);
  const i3 = gb.v([c[0] - a[0] + b[0], c[1] - a[1] + b[1], c[2] - a[2] + b[2]], nn, R.u0, R.vt, col, fol);
  gb.quad(i0, i1, i2, i3);
}

// Leaf / frond strip from base along dir, bending down by `droop` at the tip.
function bentStrip(gb, base, dir, len, wid, droop, segs, R, o = {}) {
  const fold = o.fold || 0, upB = o.up ?? 0.45, taper = o.taper || 0;
  let side = o.side || vcross(dir, UP);
  if (vlen(side) < 1e-4) side = [1, 0, 0];
  side = vnorm(side);
  const um = (R.u0 + R.u1) * 0.5;
  let prev = null;
  for (let k = 0; k <= segs; k++) {
    const s = k / segs;
    const p = [base[0] + dir[0] * len * s, base[1] + dir[1] * len * s - droop * s * s, base[2] + dir[2] * len * s];
    const T = vnorm([dir[0] * len, dir[1] * len - 2 * droop * s, dir[2] * len]);
    let N = vnorm(vcross(side, T));
    if (o.flipN) N = vsc(N, -1);
    const hw = wid * 0.5 * (1 - taper * s);
    const ln = vnorm(vadd(vsc(N, 1 - upB), vsc(UP, upB)));
    const f = o.fol ? o.fol(s) : [s, s, 1];
    const c = typeof o.col === 'function' ? o.col(s) : (o.col || WHITE);
    const v = lerp(R.vb, R.vt, s);
    let row;
    if (!fold) {
      row = [gb.v(vmad(p, side, -hw), ln, R.u0, v, c, f), gb.v(vmad(p, side, hw), ln, R.u1, v, c, f)];
    } else {
      const cf = Math.cos(fold), sf = Math.sin(fold);
      const l = [p[0] - side[0] * hw * cf - N[0] * hw * sf, p[1] - side[1] * hw * cf - N[1] * hw * sf, p[2] - side[2] * hw * cf - N[2] * hw * sf];
      const r = [p[0] + side[0] * hw * cf - N[0] * hw * sf, p[1] + side[1] * hw * cf - N[1] * hw * sf, p[2] + side[2] * hw * cf - N[2] * hw * sf];
      row = [gb.v(l, ln, R.u0, v, c, f), gb.v(p, ln, um, v, c, f), gb.v(r, ln, R.u1, v, c, f)];
    }
    if (prev) {
      for (let q = 0; q < row.length - 1; q++) gb.quad(prev[q], prev[q + 1], row[q + 1], row[q]);
    }
    prev = row;
  }
}

// Tube along a polyline with parallel-transported frames.
function tube(gb, pts, radii, sides, R, o = {}) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
  const total = cum[n - 1] || 1;
  const vSpan = o.vSpan ?? 1;
  let A = null;
  const rings = [];
  for (let k = 0; k < n; k++) {
    const T = vnorm(vsub(pts[Math.min(k + 1, n - 1)], pts[Math.max(k - 1, 0)]));
    if (!A) {
      const ref = Math.abs(T[1]) < 0.9 ? UP : [1, 0, 0];
      A = vnorm(vcross(T, ref));
    } else {
      A = vnorm(vsub(A, vsc(T, vdot(A, T))));
    }
    const B = vcross(T, A);
    const t = cum[k] / total;
    const v = lerp(R.vb, R.vt, t * vSpan);
    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      const d = vadd(vsc(A, Math.cos(a)), vsc(B, Math.sin(a)));
      const c = o.colN ? o.colN(t, d) : (o.col ? o.col(t) : WHITE);
      const f = o.fol ? o.fol(t) : [0, 0, 0];
      ring.push(gb.v(vmad(pts[k], d, radii[k]), d, lerp(R.u0, R.u1, j / sides), v, c, f));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < sides; j++) gb.quad(rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]);
  }
  if (o.cap) {
    const Rc = o.cap, p = pts[n - 1];
    const T = vnorm(vsub(pts[n - 1], pts[n - 2]));
    const B = vcross(T, A);
    const cu = (Rc.u0 + Rc.u1) / 2, cv = (Rc.vt + Rc.vb) / 2, ru = (Rc.u1 - Rc.u0) / 2, rv = (Rc.vb - Rc.vt) / 2;
    const f = o.fol ? o.fol(1) : [0, 0, 0];
    const ci = gb.v(p, T, cu, cv, WHITE, f);
    const ids = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      const d = vadd(vsc(A, Math.cos(a)), vsc(B, Math.sin(a)));
      ids.push(gb.v(vmad(p, d, radii[n - 1]), T, cu + Math.cos(a) * ru, cv + Math.sin(a) * rv, WHITE, f));
    }
    for (let j = 0; j < sides; j++) gb.tri(ci, ids[j], ids[j + 1]);
  }
}

function octa(gb, c, sx, sy, sz, R, col, fol) {
  const u = (R.u0 + R.u1) / 2, v = (R.vt + R.vb) / 2;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const ids = dirs.map((d) => gb.v([c[0] + d[0] * sx, c[1] + d[1] * sy, c[2] + d[2] * sz], d, u + d[0] * 0.01, v + d[2] * 0.01, col, fol));
  const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  for (const f of F) gb.tri(ids[f[0]], ids[f[1]], ids[f[2]]);
}

function crownCluster(gb, rng, c, rad, n, size, R, crown, o = {}) {
  const t0 = o.tilt0 ?? 0.25, t1 = o.tilt1 ?? 1.0, yr = o.yr ?? 0.45, ch = o.crownH ?? 4;
  for (let i = 0; i < n; i++) {
    const p = [c[0] + (rng() - 0.5) * 1.6 * rad, c[1] + (rng() - 0.5) * 2 * rad * yr, c[2] + (rng() - 0.5) * 1.6 * rad];
    const yaw = rng() * TAU, tilt = lerp(t0, t1, rng());
    const hs = size * (0.78 + rng() * 0.44) * 0.5;
    const ax = [Math.cos(yaw) * hs, 0, -Math.sin(yaw) * hs];
    const bx = [Math.sin(yaw) * Math.cos(tilt) * hs, Math.sin(tilt) * hs, Math.cos(yaw) * Math.cos(tilt) * hs];
    const nrm = [p[0] - crown[0], (p[1] - crown[1]) * 1.4 + (o.upN ?? ch * 0.7), p[2] - crown[2]];
    const ao = clamp(0.5 + 0.5 * ((p[1] - (crown[1] - ch)) / (2 * ch)), 0.45, 1.05);
    const tint = o.tint || WHITE;
    card(gb, p, ax, bx, nrm, (o.alt && rng() < o.altP) ? o.alt : R, [ao * tint[0], ao * tint[1], ao * tint[2]], [o.w ?? 1, 1, 1]);
  }
}

function hangingVine(gb, rng, top, len, R) {
  const yaw = rng() * Math.PI;
  for (let k = 0; k < 2; k++) {
    const a = yaw + k * Math.PI / 2;
    bentStrip(gb, top, [0, -1, 0], len, 0.75, 0, 4, R, {
      side: [Math.cos(a), 0, Math.sin(a)], up: 0.5,
      fol: (s) => [0.35 + s * 0.9, 0.6, 0.6], col: (s) => { const v = 0.75 + 0.2 * s; return [v, v, v]; },
    });
  }
}

// --- trees -------------------------------------------------------------------

// Buttress roots: solid wedges that start inside the trunk at full thickness and taper to a
// thin edge, with a concave top profile, a sinuous path in plan and smooth normals. The lower
// metre and a half is darker and green-stained.
function buildButtresses(gb, rng) {
  const bark = reg('barkDark'), f0 = [0, 0, 0];
  // cross-section (side, height fraction): bottom-left .. ridge .. bottom-right
  const PROF = [[-1, 0], [-1, 0.38], [-0.82, 0.72], [-0.42, 0.93], [0, 1], [0.42, 0.93], [0.82, 0.72], [1, 0.38], [1, 0]];
  const NC = PROF.length, NR = 8, Y0 = -0.65;
  const nf = 5;
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * TAU + (rng() - 0.5) * 0.7;
    const ca = Math.cos(a), sa = Math.sin(a), perp = [-sa, 0, ca];
    const reach = 2.4 + rng() * 1.6, top = 2.7 + rng() * 1.7, ripple = rng() * TAU;
    const wav = (0.16 + rng() * 0.24) * (rng() < 0.5 ? -1 : 1), wph = rng() * 0.8;
    const th0 = 0.3 + rng() * 0.08;
    const G = [], C = [];
    for (let k = 0; k <= NR; k++) {
      const t = k / NR;
      const r = lerp(0.3, reach, t);
      // the ridge dives just below the soil at the tip and the foot goes deeper, so fins
      // stay grounded on sloping terrain
      const yTop = -0.42 + (top + 0.42) * Math.pow(1 - t, 2.1) + 0.12 * Math.sin(t * 6.5 + ripple) * t * (1 - t) * 4;
      const yBot = Y0 - 1.1 * t;
      const th = lerp(th0, 0.03, Math.pow(t, 0.75));
      const lat = wav * Math.sin(t * Math.PI * 1.15 + wph) * t;
      const cx = ca * r + perp[0] * lat, cz = sa * r + perp[2] * lat;
      const row = [];
      for (const [s, q] of PROF) {
        const y = lerp(yBot, yTop, q);
        const w = th * (1 - 0.5 * q) * s;
        row.push([cx + perp[0] * w, y, cz + perp[2] * w]);
      }
      G.push(row);
      C.push([cx, lerp(yBot, yTop, 0.35), cz]);
    }
    const ids = [];
    for (let k = 0; k <= NR; k++) {
      const row = [];
      const t = k / NR;
      for (let c = 0; c < NC; c++) {
        const p = G[k][c];
        const dr = vsub(G[Math.min(k + 1, NR)][c], G[Math.max(k - 1, 0)][c]);
        const dc = vsub(G[k][Math.min(c + 1, NC - 1)], G[k][Math.max(c - 1, 0)]);
        let n = vnorm(vcross(dc, dr));
        const out = vsub(p, C[k]);
        if (vdot(n, out) < 0) n = vsc(n, -1);
        // bottom row: bend normals outward so the crease with the ground is soft
        if (c === 0 || c === NC - 1) n = vnorm(vadd(n, vsc(vnorm([out[0], 0, out[2]]), 0.4)));
        const y = p[1];
        const m = 1 - smoothstep(-0.2, 1.6, y);      // moss / damp band near the ground
        const ao = 0.8 + 0.2 * smoothstep(Y0, Y0 + 1.2, y);
        const col = [lerp(0.86, 0.5, m) * ao, lerp(0.84, 0.56, m) * ao, lerp(0.8, 0.4, m) * ao];
        const u = lerp(bark.u0, bark.u1, clamp(0.06 + t * 0.62 * (reach / 3.8) + (c / (NC - 1)) * 0.12, 0, 1));
        const v = lerp(bark.vb, bark.vt, clamp((y - Y0) / 7.5, 0, 1));
        row.push(gb.v(p, n, u, v, col, f0));
      }
      ids.push(row);
    }
    for (let k = 0; k < NR; k++) for (let c = 0; c < NC - 1; c++) gb.quad(ids[k][c], ids[k + 1][c], ids[k + 1][c + 1], ids[k][c + 1]);
  }
}

function buildEmergent(lod) {
  const gb = new GB(), rng = rand(lod ? 202 : 201);
  const bark = reg('barkPale'), leafA = reg('leafA'), leafB = reg('leafB');
  const ys = [-0.7, 1.8, 5, 10, 16, 21.5, 25.5];
  const rs = [1.05, 0.74, 0.62, 0.55, 0.48, 0.41, 0.34];
  const pts = ys.map((y, i) => [Math.sin(i * 1.3) * 0.28 * (i / 6), y, Math.cos(i * 0.9) * 0.22 * (i / 6)]);
  // Lower trunk is darker and moss-stained where it meets the buttresses.
  tube(gb, pts, rs, lod ? 6 : 9, bark, {
    col: (t) => {
      const a = lerp(0.56, 1.0, smoothstep(0.0, 0.32, t)), m = 1 - smoothstep(0.02, 0.11, t);
      return [a * lerp(1, 0.86, m), a * lerp(1, 0.97, m), a * lerp(1, 0.74, m)];
    },
    fol: (t) => [t * t * 0.22, 0, 0],
  });
  if (!lod) buildButtresses(gb, rng);
  const crownC = [0, 30.5, 0];
  const limbs = lod ? 5 : 6;
  const clusters = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * TAU + rng() * 0.6, R = 5 + rng() * 3.6, ey = 28.3 + rng() * 3;
    const start = [pts[5][0], 21 + i * 0.7, pts[5][2]];
    const end = [Math.cos(a) * R, ey, Math.sin(a) * R];
    const mid = [Math.cos(a) * R * 0.42, (start[1] + ey) / 2 + 1.8, Math.sin(a) * R * 0.42];
    if (!lod || i % 2 === 0) tube(gb, [start, mid, end], [0.36, 0.22, 0.1], lod ? 4 : 5, bark, { fol: (t) => [0.2 + 0.5 * t, 0, 0], vSpan: 0.3 });
    clusters.push(end);
    if (!lod && i % 2 === 1) clusters.push([Math.cos(a + 0.5) * R * 0.55, ey + 1.6, Math.sin(a + 0.5) * R * 0.55]);
  }
  clusters.push([0.4, 32.6, -0.3]);
  for (const c of clusters) {
    crownCluster(gb, rng, c, lod ? 3.8 : 3.4, lod ? 5 : 8, lod ? 7.0 : 5.4, leafA, crownC,
      { crownH: 3, tilt0: 0.15, tilt1: 0.9, yr: 0.4, alt: leafB, altP: 0.3, upN: 3.5 });
  }
  if (!lod) {
    for (let i = 0; i < 4; i++) {
      const c = clusters[i];
      hangingVine(gb, rng, [c[0] * 0.7, c[1] - 2.5, c[2] * 0.7], 10 + rng() * 9, reg('vine'));
    }
    const fern = reg('fern');
    for (const ey of [12.5, 18.5]) {
      const b = rng() * TAU;
      const base = [Math.cos(b) * 0.55, ey, Math.sin(b) * 0.55];
      for (let k = 0; k < 6; k++) {
        const a = b + (k - 2.5) * 0.45;
        bentStrip(gb, base, vnorm([Math.cos(a) * 0.8, 0.7, Math.sin(a) * 0.8]), 1.4, 0.45, 0.55, 2, fern, { fol: (s) => [0.15 + s * 0.2, s, 0.7] });
      }
    }
  }
  return gb.build();
}

function buildCanopyA(lod) {
  const gb = new GB(), rng = rand(lod ? 212 : 211);
  const bark = reg('barkDark'), leafA = reg('leafA'), leafB = reg('leafB');
  const pts = [[0, -0.5, 0], [0.2, 3, 0], [0.5, 6.5, 0.1], [0.4, 9.5, 0.1], [0.15, 11.6, 0]];
  tube(gb, pts, [0.46, 0.3, 0.25, 0.2, 0.15], lod ? 5 : 7, bark, {
    col: (t) => { const a = 0.75 + 0.25 * t; return [a, a, a]; }, fol: (t) => [t * t * 0.3, 0, 0], vSpan: 0.7,
  });
  const crownC = [0.2, 12.6, 0];
  const nc = lod ? 6 : 9;
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * TAU + rng() * 0.6, r = 1.8 + rng() * 2.0;
    const c = [crownC[0] + Math.cos(a) * r, crownC[1] + (rng() - 0.45) * 3.6, crownC[2] + Math.sin(a) * r];
    if (!lod ? i < 6 : i < 2) tube(gb, [[pts[3][0], 8 + i * 0.3, pts[3][2]], [c[0] * 0.5, (8.5 + c[1]) * 0.5 + 0.5, c[2] * 0.5], c], [0.14, 0.09, 0.04], lod ? 3 : 4, bark, { fol: (t) => [0.3 + 0.5 * t, 0, 0], vSpan: 0.3 });
    crownCluster(gb, rng, c, 2.3, lod ? 4 : 7, lod ? 4.8 : 3.8, leafB, crownC, { crownH: 3.6, tilt0: 0.2, tilt1: 1.45, yr: 0.6, alt: leafA, altP: 0.3 });
  }
  crownCluster(gb, rng, [crownC[0], crownC[1] + 2.6, crownC[2]], 1.9, lod ? 3 : 5, lod ? 4.6 : 3.6, leafB, crownC, { crownH: 3.6, tilt0: 0.15, tilt1: 0.9 });
  for (let i = 0; i < (lod ? 2 : 3); i++) {
    const a = rng() * TAU;
    crownCluster(gb, rng, [Math.cos(a) * 1.6, 8.4 + rng() * 1.2, Math.sin(a) * 1.6], 1.6, lod ? 2 : 3, lod ? 3.8 : 3.0, leafA, crownC, { crownH: 3.6, tilt0: 0.4, tilt1: 1.4, yr: 0.5, alt: leafB, altP: 0.4 });
  }
  if (!lod) hangingVine(gb, rng, [crownC[0] + 2, 11.5, crownC[2] - 1], 6 + rng() * 3, reg('vine'));
  return gb.build();
}

function buildCanopyB(lod) {
  const gb = new GB(), rng = rand(lod ? 222 : 221);
  const bark = reg('barkDark'), leafA = reg('leafA'), leafBig = reg('leafBig');
  const pts = [[0, -0.5, 0], [0.1, 4, 0.1], [-0.1, 9, 0], [0.05, 14, -0.1], [0, 17.8, 0]];
  tube(gb, pts, [0.55, 0.36, 0.3, 0.23, 0.16], lod ? 5 : 7, bark, {
    col: (t) => { const a = 0.85 + 0.25 * t; return [a, a * 0.98, a * 0.95]; }, fol: (t) => [t * t * 0.3, 0, 0], vSpan: 0.8,
  });
  const crownC = [0, 14, 0];
  const tiers = [{ y: 8.5, r: 4.7, n: 5 }, { y: 11.4, r: 4.0, n: 5 }, { y: 14.2, r: 3.1, n: 4 }, { y: 16.6, r: 1.9, n: 3 }];
  let k = 0;
  for (const t of tiers) {
    const off = rng() * TAU;
    for (let i = 0; i < t.n; i++, k++) {
      const a = off + (i / t.n) * TAU + (rng() - 0.5) * 0.4;
      const end = [Math.cos(a) * t.r, t.y + 0.5, Math.sin(a) * t.r];
      if (!lod) tube(gb, [[0, t.y - 0.6, 0], [end[0] * 0.5, t.y + 0.1, end[2] * 0.5], end], [0.15, 0.09, 0.04], 4, bark, { fol: (q) => [0.25 + q * 0.5, 0, 0], vSpan: 0.3 });
      crownCluster(gb, rng, end, 2.4, lod ? 3 : 6, lod ? 4.8 : 3.8, leafA, crownC, { crownH: 4.5, tilt0: 0.12, tilt1: 0.95, yr: 0.34, alt: leafBig, altP: 0.2, upN: 4 });
    }
  }
  crownCluster(gb, rng, [0, 18.4, 0], 1.4, lod ? 2 : 4, 3.4, leafA, crownC, { crownH: 4.5, tilt0: 0.1, tilt1: 0.7, yr: 0.3 });
  return gb.build();
}

function buildShrub(lod) {
  const gb = new GB(), rng = rand(231);
  if (lod) {
    const big = reg('leafBig'), leafB = reg('leafB');
    for (const c of [[0.2, 0.9, 0], [-0.25, 1.5, 0.15], [0.05, 2.0, -0.2]]) {
      crownCluster(gb, rng, c, 0.4, 2, 1.8, big, [0, 1.3, 0], { crownH: 1, tilt0: 0.5, tilt1: 1.4, yr: 0.4, alt: leafB, altP: 0.3, w: 0.8, upN: 0.8 });
    }
    return gb.build();
  }
  const bark = reg('barkDark'), big = reg('leafBig'), leafB = reg('leafB');
  const crown = [0, 1.3, 0];
  const pts = [[0, 0.7, 0], [0.35, 1.2, 0.1], [-0.3, 1.7, -0.2], [0.1, 2.1, 0.3]];
  for (const p of pts) tube(gb, [[0, -0.1, 0], [p[0] * 0.5, p[1] * 0.5, p[2] * 0.5], p], [0.04, 0.03, 0.015], 3, bark, { fol: (t) => [t * 0.5, 0, 0], vSpan: 0.2 });
  for (let i = 0; i < pts.length; i++) {
    crownCluster(gb, rng, pts[i], 0.5, i === 3 ? 3 : 4, 1.25, big, crown, { crownH: 1, tilt0: 0.35, tilt1: 1.3, yr: 0.4, alt: leafB, altP: 0.2, w: 0.8, upN: 0.8 });
  }
  return gb.build();
}

function buildCoconut(lod) {
  const gb = new GB(), rng = rand(lod ? 242 : 241);
  const bark = reg('barkPalm'), frond = reg('cocoFrond');
  const H = 11.5, segs = lod ? 4 : 7;
  const pts = [], radii = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    pts.push([2.4 * Math.pow(t, 1.5) - 0.6 * t * t * t, -0.4 + H * t, 0.25 * Math.sin(t * 3)]);
    radii.push(k === 0 ? 0.32 : lerp(0.24, 0.165, t));
  }
  tube(gb, pts, radii, lod ? 5 : 7, bark, { fol: (t) => [t * t * 0.75, 0, 0], col: (t) => { const a = 0.8 + 0.2 * t; return [a, a, a]; } });
  const top = pts[segs];
  const C = [top[0] + 0.05, top[1] + 0.15, top[2]];
  const nf = lod ? 10 : 16;
  for (let i = 0; i < nf; i++) {
    const a = i * 2.39996 + rng() * 0.2, age = i / nf;
    const e = lerp(1.0, -0.55, age) + (rng() - 0.5) * 0.2;
    const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    const cg = lerp(1.0, 0.82, age);
    bentStrip(gb, C, dir, 4.3 + rng() * 0.9, 1.75, lerp(0.8, 2.1, age), lod ? 3 : 5, frond, {
      fold: 0.45, up: 0.4, col: [cg, cg, lerp(0.95, 0.7, age)], fol: (s) => [0.8 + 0.4 * s, s, 0.9],
    });
  }
  if (!lod) {
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU;
      bentStrip(gb, [C[0], C[1] - 0.2, C[2]], vnorm([Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3]), 3.4, 1.0, 0.2, 2, frond, {
        fold: 0.9, col: [0.62, 0.47, 0.28], fol: (s) => [0.7 + 0.4 * s, 0.3, 0.3],
      });
    }
    const cr = reg('coconut');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rng() * 0.5;
      octa(gb, [C[0] + Math.cos(a) * 0.3, C[1] - 0.35 - rng() * 0.25, C[2] + Math.sin(a) * 0.3], 0.17, 0.2, 0.17, cr, WHITE, [0.75, 0, 0]);
    }
  }
  return gb.build();
}

function buildAreca(lod) {
  const gb = new GB(), rng = rand(lod ? 252 : 251);
  const bark = reg('barkPalm'), frond = reg('arecaFrond');
  const H = 13, segs = lod ? 3 : 6;
  const pts = [], radii = [];
  for (let k = 0; k <= segs; k++) { const t = k / segs; pts.push([0.55 * t * t, -0.3 + H * t, 0.1 * t]); radii.push(lerp(0.15, 0.105, t)); }
  const shaft = 1 - 1.5 / H;
  tube(gb, pts, radii, lod ? 4 : 6, bark, {
    fol: (t) => [t * t * 0.9, 0, 0],
    col: (t) => (t > shaft ? [0.62, 0.98, 0.42] : [1.05, 1.02, 0.95]),
  });
  if (!lod) {
    const s0 = pts[segs - 1], s1 = pts[segs];
    const sp = [lerp(s0[0], s1[0], 0.6), H - 1.6, lerp(s0[2], s1[2], 0.6)];
    tube(gb, [vmad(sp, UP, -0.01), vmad(sp, UP, 1.4)], [0.135, 0.12], 6, bark, { col: () => [0.55, 0.95, 0.38], fol: () => [0.9, 0, 0] });
  }
  const C = [pts[segs][0], pts[segs][1] + 0.1, pts[segs][2]];
  const nf = lod ? 6 : 9;
  for (let i = 0; i < nf; i++) {
    const a = i * 2.39996 + rng() * 0.3, age = i / nf;
    const e = lerp(1.15, 0.05, age) + (rng() - 0.5) * 0.15;
    const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    bentStrip(gb, C, dir, 3.1 + rng() * 0.5, 1.5, lerp(0.9, 1.7, age), lod ? 3 : 5, frond, {
      fold: 0.6, up: 0.4, col: [1, 1, lerp(1, 0.8, age)], fol: (s) => [0.85 + 0.4 * s, s, 0.9],
    });
  }
  return gb.build();
}

function buildBanana() {
  const gb = new GB(), rng = rand(261);
  const stem = reg('bananaStem'), leaf = reg('banana');
  tube(gb, [[0, -0.2, 0], [0, 0.8, 0], [0.02, 1.6, 0], [0.03, 2.4, 0.02]], [0.17, 0.155, 0.14, 0.12], 6, stem, { fol: (t) => [t * 0.25, 0, 0] });
  const nl = 8;
  for (let i = 0; i < nl; i++) {
    const a = i * 2.4 + rng() * 0.4, age = i / nl;
    const e = lerp(1.25, 0.12, age) + (rng() - 0.5) * 0.2;
    const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    const base = [dir[0] * 0.15, 2.2 + rng() * 0.35, dir[2] * 0.15];
    const old = age > 0.75;
    bentStrip(gb, base, dir, 2.0 + rng() * 0.6, 0.64, lerp(0.5, 1.6, age), 4, leaf, {
      fold: 0.18, up: 0.35, col: old ? [0.92, 0.82, 0.55] : [1, 1, 1], fol: (s) => [0.45 + 0.55 * s, 0.6 + 0.4 * s, 1],
    });
  }
  bentStrip(gb, [0.1, 2.3, 0], vnorm([0.3, -1, 0.2]), 1.6, 0.55, 0.1, 2, leaf, { fold: 0.5, col: [0.6, 0.45, 0.28], fol: (s) => [0.4 + 0.3 * s, 0.2, 0.4] });
  const fr = reg('fruit');
  tube(gb, [[0.02, 2.45, 0], [0.35, 2.5, 0.08], [0.48, 2.05, 0.1]], [0.04, 0.035, 0.03], 4, stem, { fol: () => [0.3, 0, 0] });
  tube(gb, [[0.48, 2.05, 0.1], [0.49, 1.75, 0.11], [0.5, 1.45, 0.12]], [0.17, 0.16, 0.11], 6, fr, { fol: () => [0.35, 0, 0] });
  octa(gb, [0.51, 1.28, 0.12], 0.1, 0.18, 0.1, reg('bud'), WHITE, [0.4, 0, 0]);
  return gb.build();
}

function buildBamboo(lod) {
  const gb = new GB(), rng = rand(lod ? 272 : 271);
  const culm = reg('bamboo'), leaf = reg('bambooLeaf');
  const n = lod ? 9 : 16;
  for (let i = 0; i < n; i++) {
    const ang = rng() * TAU, br = 0.15 + rng() * 0.75;
    const base = [Math.cos(ang) * br, -0.4, Math.sin(ang) * br];
    const H = 8 + rng() * 6.5, lean = (0.14 + rng() * 0.34) * (0.6 + br);
    const out = [Math.cos(ang), 0, Math.sin(ang)];
    const segs = lod ? 3 : 5;
    const pts = [], radii = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      pts.push([base[0] + out[0] * H * Math.sin(lean) * Math.pow(t, 1.7), base[1] + H * t * Math.cos(lean * 0.6), base[2] + out[2] * H * Math.sin(lean) * Math.pow(t, 1.7)]);
      radii.push(lerp(0.058, 0.03, t));
    }
    const tint = 0.9 + rng() * 0.18;
    tube(gb, pts, radii, lod ? 5 : 8, culm, { fol: (t) => [Math.pow(t, 1.5), 0, 0], col: (t) => { const a = tint * lerp(0.82, 1.04, smoothstep(0, 0.25, t)); return [a, a, a * 0.92]; } });
    const nl = lod ? 4 : 8;
    for (let k = 0; k < nl; k++) {
      const t = 0.3 + (k / nl) * 0.7 + rng() * 0.05;
      const fi = t * segs, k0 = Math.min(segs - 1, Math.floor(fi)), q = fi - k0;
      const ap = [lerp(pts[k0][0], pts[k0 + 1][0], q), lerp(pts[k0][1], pts[k0 + 1][1], q), lerp(pts[k0][2], pts[k0 + 1][2], q)];
      const yaw = ang + (rng() - 0.5) * 2.2;
      const o2 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const side = [-o2[2], 0, o2[0]];
      const sz = lod ? 1.6 : 1.2;
      const ctr = [ap[0] + o2[0] * 0.7 * sz, ap[1] - 0.25 * sz, ap[2] + o2[2] * 0.7 * sz];
      const b = vsc(vnorm([o2[0], 0.35, o2[2]]), 0.6 * sz);
      card(gb, ctr, vsc(side, 0.95 * sz), b, [o2[0] * 0.4, 1, o2[2] * 0.4], leaf, [0.9 + t * 0.15, 0.9 + t * 0.15, 0.9 + t * 0.1], [Math.pow(t, 1.5) + 0.1, 1, 1]);
    }
  }
  return gb.build();
}

// --- ground cover -------------------------------------------------------------

function buildFern() {
  const gb = new GB(), rng = rand(281);
  const fern = reg('fern');
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.4, e = 0.35 + rng() * 0.65;
    const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    bentStrip(gb, [0, 0.03, 0], dir, 1.0 + rng() * 0.5, 0.52, 0.35 + rng() * 0.35, 3, fern, {
      up: 0.6, fol: (s) => [s * 0.8, s, 0.7], col: (s) => { const v = 0.7 + 0.3 * s; return [v, v, v]; },
    });
  }
  return gb.build();
}

function buildElephantEar() {
  const gb = new GB(), rng = rand(291);
  const stem = reg('bananaStem'), leaf = reg('elephant');
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.5, h = 0.85 + rng() * 0.5;
    const P = [Math.cos(a) * 0.35, h, Math.sin(a) * 0.35];
    bentStrip(gb, [0, 0, 0], vnorm(P), vlen(P), 0.07, 0, 1, stem, { up: 0.3, fol: (s) => [s * 0.5, 0, 0.3] });
    const e = -0.25 - rng() * 0.45;
    const dir = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    bentStrip(gb, vmad(P, dir, -0.08), dir, 0.95 + rng() * 0.3, 0.9, 0.12, 2, leaf, {
      fold: -0.2, up: 0.55, fol: (s) => [0.5 + 0.4 * s, 0.4 + 0.6 * s, 0.9],
    });
  }
  return gb.build();
}

function buildGrass(R, w, h) {
  const gb = new GB();
  for (let k = 0; k < 3; k++) {
    const yaw = k * Math.PI / 3 + 0.2;
    const a = [Math.cos(yaw) * w / 2, 0, -Math.sin(yaw) * w / 2];
    let prev = null;
    for (const t of [0, 0.5, 1]) {
      const y = t * (h + 0.08) - 0.1, v = lerp(R.vb, R.vt, t);
      const b = lerp(0.5, 1.08, Math.sqrt(t));
      const c = [b, b, b * lerp(0.9, 1, t)], f = [Math.pow(t, 1.5), t, 0.7];
      const row = [gb.v([-a[0], y, -a[2]], UP, R.u0, v, c, f), gb.v([a[0], y, a[2]], UP, R.u1, v, c, f)];
      if (prev) gb.quad(prev[0], prev[1], row[1], row[0]);
      prev = row;
    }
  }
  return gb.build();
}

function buildRice() {
  const gb = new GB(), R = reg('rice');
  const quad = (x0, z0, x1, z1, h) => {
    const c0 = [0.6, 0.6, 0.6], c1 = WHITE, f0 = [0, 0, 0.5], f1 = [1, 1, 0.5];
    const i0 = gb.v([x0, -0.05, z0], UP, R.u0, R.vb, c0, f0), i1 = gb.v([x1, -0.05, z1], UP, R.u1, R.vb, c0, f0);
    const i2 = gb.v([x1, h, z1], UP, R.u1, R.vt, c1, f1), i3 = gb.v([x0, h, z0], UP, R.u0, R.vt, c1, f1);
    gb.quad(i0, i1, i2, i3);
  };
  quad(-0.75, -0.2, 0.75, -0.2, 0.55);
  quad(-0.75, 0.2, 0.75, 0.2, 0.5);
  for (const x of [-0.5, 0, 0.5]) quad(x, -0.32, x + 0.05, 0.32, 0.5);
  return gb.build();
}

function buildLitter() {
  const gb = new GB(), R = reg('litter');
  const f = [0, 0, 0];
  const i0 = gb.v([-0.5, 0.035, -0.5], UP, R.u0, R.vb, WHITE, f), i1 = gb.v([0.5, 0.035, -0.5], UP, R.u1, R.vb, WHITE, f);
  const i2 = gb.v([0.5, 0.035, 0.5], UP, R.u1, R.vt, WHITE, f), i3 = gb.v([-0.5, 0.035, 0.5], UP, R.u0, R.vt, WHITE, f);
  gb.quad(i0, i3, i2, i1);
  return gb.build();
}

function buildLog() {
  const gb = new GB(), rng = rand(301);
  const bark = reg('barkDark'), ring = reg('woodRing');
  const mossy = (t, n) => (n[1] > 0.3 ? [0.75, 1.0, 0.6] : [0.8, 0.8, 0.8]);
  tube(gb, [[-0.5, 0, 0], [0, 0.04, 0.02], [0.5, 0, 0]], [1, 1, 0.9], 7, bark, { colN: mossy, cap: ring });
  tube(gb, [[-0.499, 0, 0], [-0.5, 0, 0]], [1, 1], 7, bark, { colN: mossy, cap: ring, vSpan: 0.01 });
  tube(gb, [[0.1, 0.5, 0], [0.14, 1.4, 0.3]], [0.25, 0.12], 4, bark, { colN: mossy });
  return gb.build();
}

function buildRock() {
  const gb = new GB(), R = reg('rock');
  const src = new THREE.IcosahedronGeometry(1, 1);
  const p = src.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.22 * noise2D(x * 1.7 + z * 0.6, y * 1.7 - z * 1.1) + 0.1 * noise2D(x * 4 + 3, z * 4 - y * 2);
    const pos = [x * d, y * d * 0.62 - 0.18, z * d];
    const nrm = vnorm([x, y * 1.3, z]);
    const u = lerp(R.u0, R.u1, Math.atan2(z, x) / TAU + 0.5), v = lerp(R.vb, R.vt, 0.5 + y * 0.5);
    const m = smoothstep(0.35, 0.8, nrm[1]);
    gb.v(pos, nrm, u, v, [lerp(0.9, 0.7, m), lerp(0.9, 0.95, m), lerp(0.88, 0.55, m)], [0, 0, 0]);
  }
  for (let i = 0; i < p.count; i += 3) gb.tri(i, i + 1, i + 2);
  src.dispose();
  return gb.build();
}

function buildStump() {
  const gb = new GB();
  const bark = reg('barkDark');
  tube(gb, [[0, -0.35, 0], [0, 0.45, 0], [0.02, 0.9, 0]], [0.48, 0.4, 0.36], 8, bark, { cap: reg('woodRing'), vSpan: 0.12, col: () => [0.85, 0.85, 0.85] });
  return gb.build();
}

// ---------------------------------------------------------------------------
// Layout of man-made things (needed before vegetation so plants avoid them)
// ---------------------------------------------------------------------------
const HUTS = [
  { a: 15, r: 15.5, w: 4.6, d: 3.6 }, { a: 72, r: 17, w: 5.2, d: 3.8 }, { a: 128, r: 14.5, w: 4.4, d: 3.4 },
  { a: 196, r: 16.5, w: 6.2, d: 4.0 }, { a: 250, r: 15, w: 4.6, d: 3.6 }, { a: 310, r: 17.5, w: 4.8, d: 3.6 },
].map((h, i) => {
  const a = h.a * Math.PI / 180;
  const x = CPX + Math.cos(a) * h.r, z = CPZ + Math.sin(a) * h.r;
  return { ...h, x, z, rot: Math.atan2(-Math.cos(a), -Math.sin(a)) + (hash2(i, 9) - 0.5) * 0.3 };
});
const CAMP_SHELTER = { x: CPX + 8.9, z: CPZ - 3.2, rot: 0.35 };
const CAMP_FIRE = { x: CPX - 5.1, z: CPZ - 6.1 };

// Worn footpaths in the camp: centre to each hut door, the fire pit, the shelter and the
// starting tunnel hatches (tunnels.js puts them about 2-10 m from the centre), plus a loose
// ring between neighbouring huts.
const CAMP_PATHS = (() => {
  const door = (h) => {
    const c = Math.cos(h.rot), s = Math.sin(h.rot), lx = 0.3, lz = h.d / 2 + 1.4;
    return [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
  };
  const C = [CPX, CPZ], fire = [CAMP_FIRE.x, CAMP_FIRE.z], shel = [CAMP_SHELTER.x, CAMP_SHELTER.z];
  const segs = [];
  for (const h of HUTS) segs.push([C, door(h)]);
  segs.push([C, fire], [C, shel], [fire, shel]);
  for (const [dx, dz] of [[5, 1], [-3, -5], [-1, 11]]) segs.push([C, [CPX + dx, CPZ + dz]]);
  for (let i = 0; i < HUTS.length; i += 2) segs.push([door(HUTS[i]), door(HUTS[(i + 1) % HUTS.length])]);
  return segs.map(([a, b]) => ({ ax: a[0], az: a[1], dx: b[0] - a[0], dz: b[1] - a[1], l2: (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 }));
})();
function campPathDist(x, z) {
  if ((x - CPX) * (x - CPX) + (z - CPZ) * (z - CPZ) > 34 * 34) return 99;
  let best = 99;
  for (const s of CAMP_PATHS) {
    const t = clamp(((x - s.ax) * s.dx + (z - s.az) * s.dz) / (s.l2 || 1), 0, 1);
    const ex = x - s.ax - s.dx * t, ez = z - s.az - s.dz * t;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

const FBL = {
  dump: [WORLD.ammoDump.x - FBX, WORLD.ammoDump.z - FBZ],
  toc: [-9, -3], tents: [[-15, 8, 0], [-8, 13, 0], [14, -4, 1]],
  guns: [[9, 19], [19, 6], [-10, -19]], helipad: [4, -15], tower: [-20, -14],
  bunkers: [120, 180, 240, 300, 0, 60], drums: [-5, -10], trailer: [-2, 6],
  gateAngle: Math.PI / 2, wallR: 31, wireR: [36, 40],
};
function inGate(a, halfW, r) {
  let d = Math.abs(((a - FBL.gateAngle + Math.PI * 3) % TAU) - Math.PI);
  return d * r < halfW;
}

function planBlockers() {
  for (const h of HUTS) blockCircle(h.x, h.z, Math.max(h.w, h.d) * 0.5 + 1.4);
  blockCircle(CAMP_SHELTER.x, CAMP_SHELTER.z, 3.2);
  blockCircle(CAMP_FIRE.x, CAMP_FIRE.z, 2.2);
  blockCircle(CPX, CPZ, 6);
}

// ---------------------------------------------------------------------------
// Colliders + raycast solids
// ---------------------------------------------------------------------------
const colliders = [];
const boxColliders = [];
const solids = [];
function addCyl(x, z, r, y0, y1, surface, collide = true) {
  if (collide && r > 0.05) colliders.push({ x, z, r });
  const s = { k: 0, x, z, r, y0, y1, s: surface, on: true };
  solids.push(s);
  return s;
}
// Box centred at (cx, cy, cz) with half extents, rotated by yaw about Y.
function addBox(cx, cy, cz, hx, hy, hz, yaw, surface, collide = true) {
  const s = { k: 1, x: cx, y: cy, z: cz, hx, hy, hz, c: Math.cos(yaw), sn: Math.sin(yaw), s: surface, on: true, col: null };
  solids.push(s);
  if (collide) {
    const ac = Math.abs(s.c), as = Math.abs(s.sn);
    if (ac < 0.03 || as < 0.03) {
      const ex = as < 0.03 ? hx : hz, ez = as < 0.03 ? hz : hx;
      const b = { min: new THREE.Vector3(cx - ex, cy - hy, cz - ez), max: new THREE.Vector3(cx + ex, cy + hy, cz + ez) };
      boxColliders.push(b);
      s.col = b;
    }
    // inscribed circles along the long axis (for modules that only read circles)
    const L = Math.max(hx, hz), S = Math.min(hx, hz);
    const n = Math.max(1, Math.round(L / Math.max(S, 0.2)));
    const ax = hx >= hz ? [s.c, -s.sn] : [s.sn, s.c];
    const list = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * (L - S);
      const c = { x: cx + ax[0] * t, z: cz + ax[1] * t, r: S * 1.02 };
      colliders.push(c);
      list.push(c);
    }
    s.circles = list;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Grids: cover (2 m) and canopy shade (4 m)
// ---------------------------------------------------------------------------
const COV_N = 256, COV = new Float32Array(COV_N * COV_N);
const SH_N = 128, SHADE = new Float32Array(SH_N * SH_N);
function stampGrid(G, N, cell, x, z, r, a) {
  const fx = (x + HALF) / cell, fz = (z + HALF) / cell, rr = r / cell;
  const i0 = Math.max(0, Math.floor(fx - rr)), i1 = Math.min(N - 1, Math.ceil(fx + rr));
  const j0 = Math.max(0, Math.floor(fz - rr)), j1 = Math.min(N - 1, Math.ceil(fz + rr));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i + 0.5 - fx, j + 0.5 - fz) / rr;
    if (d < 1) G[j * N + i] += a * (1 - d * d);
  }
}
function sampleGrid(G, N, cell, x, z, outside) {
  const fx = (x + HALF) / cell - 0.5, fz = (z + HALF) / cell - 0.5;
  if (fx < -1 || fz < -1 || fx > N || fz > N) return outside;
  const i = clamp(Math.floor(fx), 0, N - 2), j = clamp(Math.floor(fz), 0, N - 2);
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  const k = j * N + i;
  const a = G[k], b = G[k + 1], c = G[k + N], d = G[k + N + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
const stampCover = (x, z, r, a) => stampGrid(COV, COV_N, 2, x, z, r, a);
const stampShade = (x, z, r, a) => stampGrid(SHADE, SH_N, 4, x, z, r, a);
function coverAt(x, z) { return clamp(sampleGrid(COV, COV_N, 2, x, z, 1), 0, 1); }
function shadeAt(x, z) { return clamp(sampleGrid(SHADE, SH_N, 4, x, z, 0.6), 0, 1); }

// ---------------------------------------------------------------------------
// Baked lighting (computed once at load)
// One 512 x 512 lightmap with 1 m texels covers the map:
//   R  sky visibility   terrain horizon occlusion x canopy and undergrowth cover
//   G  sun visibility   terrain self-shadow x canopy transmittance along the sun ray
//   B  puddle potential (hollows in the ground)
//   A  wetness          river banks, paddy margins
// The same data is sampled in JS for per-instance foliage occlusion and by any material
// patched with bakePatch() (structures, soldiers), so everything under the canopy agrees.
// ---------------------------------------------------------------------------
const BKN = 512;
const BK_SKY = new Float32Array(BKN * BKN).fill(1);
const BK_SUN = new Float32Array(BKN * BKN).fill(1);
const SUN_HL = Math.hypot(SUN_DIR.x, SUN_DIR.z);
const SUN_HX = SUN_DIR.x / SUN_HL, SUN_HZ = SUN_DIR.z / SUN_HL, SUN_TAN = SUN_DIR.y / SUN_HL;

// Crown volumes per plant type, in instance-local units (scaled by the instance transform).
// L = canopy layer, (ox, y) = crown centre, r = radius, d = leaf density.
const CROWN = {
  emergent: { L: 0, ox: 0, y: 30.0, r: 9.2, d: 1.0 },
  canopyA: { L: 1, ox: 0.2, y: 12.2, r: 4.7, d: 0.95 },
  canopyB: { L: 1, ox: 0, y: 13.0, r: 5.3, d: 0.95 },
  coconut: { L: 1, ox: 1.85, y: 11.4, r: 4.8, d: 0.42 },
  areca: { L: 1, ox: 0, y: 10.6, r: 2.7, d: 0.38 },
  bamboo: { L: 1, ox: 0, y: 6.4, r: 3.7, d: 0.72 },
  banana: { L: 2, ox: 0, y: 2.3, r: 1.9, d: 0.5 },
  shrub: { L: 2, ox: 0, y: 1.4, r: 1.15, d: 0.45 },
};
// Per layer: crown thickness (m), sun extinction per metre of crown, sky-occlusion blur
// radius (m) and weight. Calibrated so a full emergent or mid-storey crown lets ~4% of the
// direct sun through and a closed two-layer canopy leaves ~15% of the open-sky light.
const CLAYER = [
  { th: 8.5, sig: 0.2, blur: 12, sky: 1.15 },
  { th: 7.5, sig: 0.4, blur: 6, sky: 1.1 },
  { th: 2.4, sig: 0.95, blur: 2, sky: 0.55 },
];

// Clamped bilinear height lookup on the 1 m grid (no analytic fallback: bake hot loop).
function hgClamp(x, z) {
  let fx = x + HALF, fz = z + HALF;
  if (fx < 0) fx = 0; else if (fx > 511.999) fx = 511.999;
  if (fz < 0) fz = 0; else if (fz > 511.999) fz = 511.999;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * GN + i;
  const a = HG[k], b = HG[k + 1], c = HG[k + GN], d = HG[k + GN + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
function gridBilerp(G, x, z) {
  let fx = x + HALF - 0.5, fz = z + HALF - 0.5;
  if (fx < 0) fx = 0; else if (fx > BKN - 1.001) fx = BKN - 1.001;
  if (fz < 0) fz = 0; else if (fz > BKN - 1.001) fz = BKN - 1.001;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * BKN + i;
  const a = G[k], b = G[k + 1], c = G[k + BKN], d = G[k + BKN + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
// Separable running-sum box blur of an N x N grid (in place via a scratch buffer).
function boxBlur(G, N, r, tmp) {
  if (r < 1) return G;
  const w = 2 * r + 1;
  for (let j = 0; j < N; j++) {
    let s = 0; const row = j * N;
    for (let i = -r; i <= r; i++) s += G[row + clamp(i, 0, N - 1)];
    for (let i = 0; i < N; i++) {
      tmp[row + i] = s / w;
      s += G[row + Math.min(i + r + 1, N - 1)] - G[row + Math.max(i - r, 0)];
    }
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[clamp(j, 0, N - 1) * N + i];
    for (let j = 0; j < N; j++) {
      G[j * N + i] = s / w;
      s += tmp[Math.min(j + r + 1, N - 1) * N + i] - tmp[Math.max(j - r, 0) * N + i];
    }
  }
  return G;
}

// Rasterise every crown into per-layer density + mean height grids (1 m). Leaf density is
// broken up by noise so the baked canopy has gaps and sunflecks instead of solid discs.
function bakeCanopy(V) {
  const N = BKN, NN = N * N;
  const D = CLAYER.map(() => new Float32Array(NN)), HS = CLAYER.map(() => new Float32Array(NN));
  const leaf = new Float32Array(NN);
  for (let j = 0; j < N; j++) {
    const z = j - HALF + 0.5;
    for (let i = 0; i < N; i++) {
      const x = i - HALF + 0.5;
      const n = 0.6 * noise2D(x * 0.21 + 13.1, z * 0.21 - 4.7) + 0.4 * noise2D(x * 0.53 - 2.2, z * 0.53 + 8.9);
      leaf[j * N + i] = clamp(0.62 + 0.95 * n, 0.05, 1.45);
    }
  }
  for (const name in CROWN) {
    const T = V[name];
    if (!T || !T.count) continue;
    const c = CROWN[name], M = T.mat, Dk = D[c.L], Hk = HS[c.L];
    for (let q = 0; q < T.count; q++) {
      const o = q * 16;
      const sx = Math.hypot(M[o], M[o + 1], M[o + 2]) || 1;
      // crown centre through the full instance transform (palms lean, trees tilt)
      const lx = c.ox, ly = c.y;
      const wx = M[o] * lx + M[o + 4] * ly + M[o + 12];
      const wy = M[o + 1] * lx + M[o + 5] * ly + M[o + 13];
      const wz = M[o + 2] * lx + M[o + 6] * ly + M[o + 14];
      const r = c.r * sx;
      const fx = wx + HALF, fz = wz + HALF;
      const i0 = Math.max(0, Math.floor(fx - r)), i1 = Math.min(N - 1, Math.ceil(fx + r));
      const j0 = Math.max(0, Math.floor(fz - r)), j1 = Math.min(N - 1, Math.ceil(fz + r));
      if (i0 > i1 || j0 > j1) continue;
      const ir2 = 1 / (r * r);
      for (let j = j0; j <= j1; j++) {
        const dz = j + 0.5 - fz;
        for (let i = i0; i <= i1; i++) {
          const dx = i + 0.5 - fx, d2 = (dx * dx + dz * dz) * ir2;
          if (d2 >= 1) continue;
          const k = j * N + i;
          const w = c.d * Math.pow(1 - d2, 0.65) * leaf[k];
          Dk[k] += w; Hk[k] += w * wy;
        }
      }
    }
  }
  for (let L = 0; L < CLAYER.length; L++) {
    const Dk = D[L], Hk = HS[L];
    for (let k = 0; k < NN; k++) {
      if (Dk[k] > 1e-4) Hk[k] /= Dk[k]; else Hk[k] = -1e3;
      if (Dk[k] > 1.6) Dk[k] = 1.6;
    }
  }
  return { D, H: HS };
}

// Ground contact occlusion from everything registered as a solid: dark ground under huts on
// stilts and bunkers, soft creases along sandbag walls, a ring of shade around trunks and rocks.
function bakeContact() {
  const N = BKN, C = new Float32Array(N * N);
  for (const sd of solids) {
    if (sd.k === 1) {
      if (sd.hy < 0.2) continue;
      const k = Math.min(0.62, 0.22 + sd.hy * 0.28), m = 1.6, ex = Math.max(sd.hx, sd.hz) + m;
      const i0 = Math.max(0, Math.floor(sd.x - ex + HALF)), i1 = Math.min(N - 1, Math.ceil(sd.x + ex + HALF));
      const j0 = Math.max(0, Math.floor(sd.z - ex + HALF)), j1 = Math.min(N - 1, Math.ceil(sd.z + ex + HALF));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = i - HALF + 0.5 - sd.x, dz = j - HALF + 0.5 - sd.z;
        const lx = Math.abs(dx * sd.c - dz * sd.sn) - sd.hx, lz = Math.abs(dx * sd.sn + dz * sd.c) - sd.hz;
        const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
        const o = k * Math.exp(-d / 0.75);
        const q = j * N + i;
        if (o > C[q]) C[q] = o;
      }
    } else {
      if (sd.r < 0.14 || Math.abs(sd.x) > HALF || Math.abs(sd.z) > HALF) continue;
      const k = Math.min(0.45, 0.18 + sd.r * 0.25), fall = 0.5 + sd.r * 1.3, ex = sd.r + fall * 2.5;
      const i0 = Math.max(0, Math.floor(sd.x - ex + HALF)), i1 = Math.min(N - 1, Math.ceil(sd.x + ex + HALF));
      const j0 = Math.max(0, Math.floor(sd.z - ex + HALF)), j1 = Math.min(N - 1, Math.ceil(sd.z + ex + HALF));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.max(0, Math.hypot(i - HALF + 0.5 - sd.x, j - HALF + 0.5 - sd.z) - sd.r);
        const o = k * Math.exp(-d / fall);
        const q = j * N + i;
        if (o > C[q]) C[q] = o;
      }
    }
  }
  return C;
}

let BAKE_DATA = null;
function bakeLightmap(V) {
  const N = BKN, NN = N * N;
  const can = bakeCanopy(V);
  const tmp = new Float32Array(NN);
  // sky occlusion uses the canopy density blurred over roughly the solid angle it covers
  const blurred = CLAYER.map((L, k) => boxBlur(can.D[k].slice(), N, L.blur, tmp));
  // crown heights are smoothed a little so sun rays find a crown between sparse samples
  const data = new Uint8Array(NN * 4);
  const DIRS = [];
  for (let a = 0; a < 8; a++) DIRS.push(Math.cos(a * TAU / 8 + 0.2), Math.sin(a * TAU / 8 + 0.2));
  const HOR = [1.5, 3, 6, 12, 24, 48];
  const SUNT = [2, 4, 7, 12, 20, 32, 52, 85, 140];
  const RING8 = [];
  for (let a = 0; a < 8; a++) RING8.push(Math.cos(a * TAU / 8) * 2.6, Math.sin(a * TAU / 8) * 2.6);
  // canopy sun-ray samples per layer (jittered per texel, then the result is blurred a little)
  const LS = [10, 9, 5];
  const OUT_D = [0.55, 0.6, 0.2], OUT_H = [29, 12, 1.8];   // forest beyond the map edge
  const contact = bakeContact();
  for (let j = 0; j < N; j++) {
    const z = j - HALF + 0.5;
    for (let i = 0; i < N; i++) {
      const x = i - HALF + 0.5, k = j * N + i;
      const h = HG[(j) * GN + i] * 0.25 + HG[j * GN + i + 1] * 0.25 + HG[(j + 1) * GN + i] * 0.25 + HG[(j + 1) * GN + i + 1] * 0.25;
      // --- terrain horizon (8 azimuths, cosine-weighted occluded fraction)
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d * 2], dz = DIRS[d * 2 + 1];
        let ms = 0;
        for (let t = 0; t < HOR.length; t++) {
          const r = HOR[t], dh = hgClamp(x + dx * r, z + dz * r) - h - 0.15;
          if (dh > 0) { const s = dh / Math.sqrt(dh * dh + r * r); if (s > ms) ms = s; }
        }
        occ += ms * ms;
      }
      let sky = 1 - occ / 8;
      // --- terrain self-shadow toward the sun (soft penumbra)
      let sun = 1;
      for (let t = 0; t < SUNT.length && sun > 0; t++) {
        const r = SUNT[t], hs = hgClamp(x + SUN_HX * r, z + SUN_HZ * r), yr = h + r * SUN_TAN + 0.2;
        const s = clamp((yr - hs) / (0.05 * r + 0.25) + 0.5, 0, 1);
        if (s < sun) sun = s;
      }
      // --- canopy along the sun ray
      let od = 0;
      for (let L = 0; L < CLAYER.length; L++) {
        const C = CLAYER[L], Dk = can.D[L], Hk = can.H[L];
        const lo = L === 0 ? 20 : L === 1 ? 4.5 : 0.4, hi = L === 0 ? 40 : L === 1 ? 21 : 4.2;
        const t0 = Math.max(0.5, lo / SUN_TAN), t1 = hi / SUN_TAN, n = LS[L], dt = (t1 - t0) / n;
        const inv = 1 / (C.th * 0.5);
        const jit = hash2(i * 7 + L, j * 13 + 3);
        for (let s = 0; s < n; s++) {
          const t = t0 + (s + jit) * dt, px = x + SUN_HX * t, pz = z + SUN_HZ * t;
          const outside = px < -HALF || px > HALF || pz < -HALF || pz > HALF;
          const dd = outside ? OUT_D[L] : gridBilerp(Dk, px, pz);
          if (dd < 0.01) continue;
          const hc = outside ? hgClamp(px, pz) + OUT_H[L] : gridBilerp(Hk, px, pz);
          const e = (h + t * SUN_TAN - hc) * inv;
          od += dd * Math.exp(-e * e) * dt * C.sig;
        }
      }
      sun *= Math.exp(-od);
      // --- canopy + undergrowth over the sky dome
      let co = 0;
      for (let L = 0; L < CLAYER.length; L++) co += blurred[L][k] * CLAYER[L].sky;
      sky *= Math.exp(-co);
      sky *= 1 - 0.32 * coverAt(x, z);
      sky *= 1 - contact[k];
      sky = clamp(sky, 0.04, 1);
      // --- puddle potential: how far this point sits below its 2.6 m ring
      let ring = 0;
      for (let q = 0; q < 8; q++) ring += hgClamp(x + RING8[q * 2], z + RING8[q * 2 + 1]);
      const pud = smoothstep(0.025, 0.2, ring / 8 - h);
      // --- wetness: river margins, paddies, low ground by the water
      riverEval(x, z);
      let wet = 1 - smoothstep(0.0, 6.5, RV.dd);
      wet = Math.max(wet, 1 - smoothstep(WATER_Y + 0.4, WATER_Y + 1.6, h));
      if (paddyZoneDist(x, z) < 2) wet = Math.max(wet, 0.75);
      BK_SKY[k] = sky; BK_SUN[k] = sun;
      data[k * 4] = Math.round(sky * 255);
      data[k * 4 + 2] = Math.round(pud * 255);
      data[k * 4 + 3] = Math.round(clamp(wet, 0, 1) * 255);
    }
  }
  // soften the canopy sun term: penumbrae of crowns 20-40 m up are a metre or more wide
  boxBlur(BK_SUN, N, 1, tmp);
  for (let k = 0; k < NN; k++) data[k * 4 + 1] = Math.round(clamp(BK_SUN[k], 0, 1) * 255);
  BAKE_DATA = data;
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'bakedLight';
  return tex;
}

// Baked sky / sun visibility at a ground point (bilinear). Outside the map: dense forest.
function bakeSkyAt(x, z) { return Math.abs(x) > HALF || Math.abs(z) > HALF ? 0.3 : gridBilerp(BK_SKY, x, z); }
function bakeSunAt(x, z) { return Math.abs(x) > HALF || Math.abs(z) > HALF ? 0.25 : gridBilerp(BK_SUN, x, z); }

// Per-instance foliage occlusion: the ground-level bake at the plant, darker still deep in
// dense undergrowth (cover) and for low ground cover. Written in the tile-sorted order.
function bakeVegInstances(V) {
  for (const name in V) {
    const T = V[name];
    if (!T.count) { T.bake = new Float32Array(2); continue; }
    const M = T.mat, B = new Float32Array(T.count * 2);
    const low = name === 'grass' || name === 'tallGrass' || name === 'fern' || name === 'litter' || name === 'elephant' || name === 'rice';
    for (let q = 0; q < T.count; q++) {
      const x = M[q * 16 + 12], z = M[q * 16 + 14];
      let sky = bakeSkyAt(x, z), sun = bakeSunAt(x, z);
      const cov = Math.abs(x) < HALF && Math.abs(z) < HALF ? coverAt(x, z) : 0.8;
      sky *= low ? 1 - 0.28 * cov : 1 - 0.18 * cov;
      B[q * 2] = clamp(sky, 0.04, 1);
      B[q * 2 + 1] = clamp(sun, 0, 1);
    }
    T.bake = B;
  }
}

// Shared uniforms for every material that reads the bake.
const BK = {
  tBake: { value: null },
  uBakeFade: { value: new THREE.Vector4(0, 0, 40, 56) },   // xy shadow centre, zw fade radii
  uLeafGlow: { value: new THREE.Color(0.13, 0.18, 0.075) }, // light that filters through leaves
  uBakeMix: { value: 1 },
};
const BAKE_GLSL = /* glsl */`
uniform sampler2D tBake;
uniform vec4 uBakeFade;
uniform vec3 uLeafGlow;
uniform float uBakeMix;
vec4 ugBakeAt(vec3 wp) { return texture2D(tBake, wp.xz * (1.0 / 512.0) + 0.5); }
float ugShadowFar(vec3 wp) { return smoothstep(uBakeFade.z, uBakeFade.w, distance(wp.xz, uBakeFade.xy)); }
vec3 ugSkyLight(float sky) { return mix(uLeafGlow, vec3(1.0), sky); }
`;

// Patch a MeshStandard/Physical material so its ambient comes from the bake at its world
// position (canopy darkening + green filtered light) and its sun fades from the realtime
// shadow to the baked term with distance. opts.vertexAO: the material's vertex colour red
// channel is baked AO (affects indirect fully, direct partly) instead of an albedo tint.
function bakePatch(mat, opts = {}) {
  if (!mat || mat.userData.ugBaked) return mat;
  mat.userData.ugBaked = true;
  const vao = !!opts.vertexAO, skyK = opts.sky ?? 1;
  if (vao) mat.vertexColors = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
    Object.assign(sh.uniforms, BK);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBkW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 bkp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    bkp = instanceMatrix * bkp;
  #endif
  vBkW = (modelMatrix * bkp).xyz;
}`);
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBkW;\n' + BAKE_GLSL);
    if (vao) fs = fs.replace('#include <color_fragment>', '');
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec4 bk = ugBakeAt(vBkW);
  float bSky = mix(1.0, bk.r, uBakeMix * ${skyK.toFixed(3)});
  vec3 amb = ugSkyLight(bSky);
  float bSun = mix(1.0, bk.g, uBakeMix * ugShadowFar(vBkW));
  ${vao ? 'float vao = vColor.r; amb *= vao; bSun *= mix(1.0, vao, 0.45);' : ''}
  reflectedLight.indirectDiffuse *= amb;
  reflectedLight.indirectSpecular *= amb;
  reflectedLight.directDiffuse *= bSun;
  reflectedLight.directSpecular *= bSun;
}`);
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|ugbake' + (vao ? 'v' : '') + skyK;
  mat.needsUpdate = true;
  return mat;
}

// ---------------------------------------------------------------------------
// Baked vertex AO by voxel ray casting. All items share one occupancy grid (their
// triangles, sampled densely, plus the terrain when asked), then every vertex casts 14
// cosine-weighted rays a couple of metres into it. Writes / multiplies a 'color' attribute.
// items: [{ geometry, matrix? }]  opts: { voxel, maxDist, strength, terrain, multiply, budget }
// ---------------------------------------------------------------------------
const AO_DIRS = (() => {
  const out = [], n = 14, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(1 - (i + 0.5) / n);           // cosine-weighted elevation
    const r = Math.sqrt(1 - z * z), a = i * ga;
    out.push(Math.cos(a) * r, Math.sin(a) * r, z);
  }
  return out;
})();
const _aoV = new THREE.Vector3(), _aoN = new THREE.Vector3(), _aoM3 = new THREE.Matrix3();
function bakeVertexAO(items, o = {}) {
  const t0 = performance.now();
  const list = items.filter((it) => it && it.geometry && it.geometry.attributes.position);
  if (!list.length) return 0;
  // world-space copies of positions and normals
  const W = list.map((it) => {
    const g = it.geometry, P = g.attributes.position, Nn = g.attributes.normal, n = P.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const m = it.matrix || null;
    if (m) _aoM3.getNormalMatrix(m);
    for (let i = 0; i < n; i++) {
      _aoV.fromBufferAttribute(P, i); if (m) _aoV.applyMatrix4(m);
      pos[i * 3] = _aoV.x; pos[i * 3 + 1] = _aoV.y; pos[i * 3 + 2] = _aoV.z;
      if (Nn) { _aoN.fromBufferAttribute(Nn, i); if (m) _aoN.applyMatrix3(_aoM3); _aoN.normalize(); } else _aoN.set(0, 1, 0);
      nor[i * 3] = _aoN.x; nor[i * 3 + 1] = _aoN.y; nor[i * 3 + 2] = _aoN.z;
    }
    return { g, pos, nor, idx: g.index ? g.index.array : null, n };
  });
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const w of W) for (let i = 0; i < w.n; i++) {
    const x = w.pos[i * 3], y = w.pos[i * 3 + 1], z = w.pos[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const maxD = o.maxDist ?? 2.2, pad = maxD + 0.5;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const vol = (x1 - x0) * (y1 - y0) * (z1 - z0);
  const vs = Math.max(o.voxel ?? 0.22, Math.cbrt(vol / (o.budget ?? 5e6)));
  const nx = Math.ceil((x1 - x0) / vs) + 1, ny = Math.ceil((y1 - y0) / vs) + 1, nz = Math.ceil((z1 - z0) / vs) + 1;
  const occ = new Uint8Array(nx * ny * nz);
  const inv = 1 / vs, sxy = nx * ny;
  const mark = (x, y, z) => {
    const i = ((x - x0) * inv) | 0, j = ((y - y0) * inv) | 0, k = ((z - z0) * inv) | 0;
    occ[k * sxy + j * nx + i] = 1;
  };
  // triangles -> voxels
  for (const w of W) {
    const P = w.pos, I = w.idx, nt = I ? I.length / 3 : w.n / 3;
    for (let t = 0; t < nt; t++) {
      const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ex = P[b * 3] - ax, ey = P[b * 3 + 1] - ay, ez = P[b * 3 + 2] - az;
      const fx = P[c * 3] - ax, fy = P[c * 3 + 1] - ay, fz = P[c * 3 + 2] - az;
      const L = Math.max(Math.hypot(ex, ey, ez), Math.hypot(fx, fy, fz), Math.hypot(ex - fx, ey - fy, ez - fz));
      const s = Math.min(160, Math.ceil(L / (vs * 0.6)) || 1);
      for (let u = 0; u <= s; u++) for (let v = 0; v <= s - u; v++) {
        const pu = u / s, pv = v / s;
        mark(ax + ex * pu + fx * pv, ay + ey * pu + fy * pv, az + ez * pu + fz * pv);
      }
    }
  }
  // terrain: fill each column below the ground
  if (o.terrain) {
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const gy = heightAt(x0 + (i + 0.5) * vs, z0 + (k + 0.5) * vs);
      const top = Math.min(ny, Math.floor((gy - y0) * inv));
      for (let j = 0; j < top; j++) occ[k * sxy + j * nx + i] = 1;
    }
  }
  // rays
  const strength = o.strength ?? 1, steps = Math.ceil(maxD / vs), D = AO_DIRS, nd = D.length / 3;
  let verts = 0;
  for (const w of W) {
    const g = w.g, n = w.n, P = w.pos, Nn = w.nor;
    let col = g.attributes.color;
    if (!col || !o.multiply) {
      if (!col) { col = new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3); g.setAttribute('color', col); }
      else col.array.fill(1);
    }
    const C = col.array;
    for (let v = 0; v < n; v++) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      const nx0 = Nn[v * 3], ny0 = Nn[v * 3 + 1], nz0 = Nn[v * 3 + 2];
      // tangent frame
      let tx, ty, tz;
      if (Math.abs(ny0) < 0.9) { tx = nz0; ty = 0; tz = -nx0; } else { tx = 0; ty = -nz0; tz = ny0; }
      const tl = 1 / (Math.hypot(tx, ty, tz) || 1); tx *= tl; ty *= tl; tz *= tl;
      const bx = ny0 * tz - nz0 * ty, by = nz0 * tx - nx0 * tz, bz = nx0 * ty - ny0 * tx;
      const ox = px + nx0 * vs * 1.05, oy = py + ny0 * vs * 1.05, oz = pz + nz0 * vs * 1.05;
      let sum = 0;
      for (let d = 0; d < nd; d++) {
        const a = D[d * 3], b = D[d * 3 + 1], c = D[d * 3 + 2];
        const dx = tx * a + bx * b + nx0 * c, dy = ty * a + by * b + ny0 * c, dz = tz * a + bz * b + nz0 * c;
        for (let s = 1; s <= steps; s++) {
          const r = s * vs;
          const i = ((ox + dx * r - x0) * inv) | 0, j = ((oy + dy * r - y0) * inv) | 0, k = ((oz + dz * r - z0) * inv) | 0;
          if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
          if (occ[k * sxy + j * nx + i]) { sum += 1 - 0.55 * (r / maxD); break; }
        }
      }
      const ao = clamp(1 - strength * sum / nd, 0.18, 1);
      if (o.multiply) { C[v * 3] *= ao; C[v * 3 + 1] *= ao; C[v * 3 + 2] *= ao; } else { C[v * 3] = ao; C[v * 3 + 1] = ao; C[v * 3 + 2] = ao; }
    }
    col.needsUpdate = true;
    verts += n;
  }
  const ms = performance.now() - t0;
  return { verts, ms, voxel: vs, grid: [nx, ny, nz] };
}

// ---------------------------------------------------------------------------
// Vegetation instances, binned into streaming tiles
// ---------------------------------------------------------------------------
const NTT = NT * NT;
const _m4 = new THREE.Matrix4(), _p3 = new THREE.Vector3(), _q4 = new THREE.Quaternion(), _e3 = new THREE.Euler(), _s3 = new THREE.Vector3();
class VegType {
  constructor(name) { this.name = name; this.tmp = []; this.start = null; this.mat = null; this.col = null; this.count = 0; }
  add(x, y, z, ry, sx, sy, sz, rx, rz, r, g, b) { this.tmp.push(x, y, z, ry, sx, sy, sz, rx, rz, r, g, b); }
  finalize() {
    const t = this.tmp, n = t.length / 12;
    this.count = n;
    const tileOf = new Int32Array(n), start = new Uint32Array(NTT + 1);
    for (let i = 0; i < n; i++) {
      const tx = clamp(Math.floor((t[i * 12] - TILE_MIN) / TILE), 0, NT - 1);
      const tz = clamp(Math.floor((t[i * 12 + 2] - TILE_MIN) / TILE), 0, NT - 1);
      tileOf[i] = tz * NT + tx;
      start[tileOf[i] + 1]++;
    }
    for (let i = 0; i < NTT; i++) start[i + 1] += start[i];
    const fill = start.slice(0, NTT);
    this.mat = new Float32Array(n * 16);
    this.col = new Float32Array(n * 3);
    // per-tile vertical range and largest scale, for frustum tests on tile bounds
    this.tyMin = new Float32Array(NTT).fill(1e9);
    this.tyMax = new Float32Array(NTT).fill(-1e9);
    this.tsY = new Float32Array(NTT);
    this.tsXZ = new Float32Array(NTT);
    for (let i = 0; i < n; i++) {
      const o = i * 12, tl = tileOf[i];
      if (t[o + 1] < this.tyMin[tl]) this.tyMin[tl] = t[o + 1];
      if (t[o + 1] > this.tyMax[tl]) this.tyMax[tl] = t[o + 1];
      this.tsY[tl] = Math.max(this.tsY[tl], Math.abs(t[o + 5]));
      this.tsXZ[tl] = Math.max(this.tsXZ[tl], Math.abs(t[o + 4]), Math.abs(t[o + 6]));
    }
    for (let i = 0; i < n; i++) {
      const o = i * 12, dst = fill[tileOf[i]]++;
      _p3.set(t[o], t[o + 1], t[o + 2]);
      _q4.setFromEuler(_e3.set(t[o + 7], t[o + 3], t[o + 8], 'YXZ'));
      _s3.set(t[o + 4], t[o + 5], t[o + 6]);
      _m4.compose(_p3, _q4, _s3).toArray(this.mat, dst * 16);
      this.col[dst * 3] = t[o + 9]; this.col[dst * 3 + 1] = t[o + 10]; this.col[dst * 3 + 2] = t[o + 11];
    }
    this.start = start;
    this.tmp = null;
  }
}

// Tilt (rx, rz) so that local up maps to normal n under yaw ry (Euler order YXZ).
function alignTilt(nx, ny, nz, ry, k, out) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const lx = nx * c - nz * s, lz = nx * s + nz * c;
  const ax = lx * k, az = lz * k, ay = Math.sqrt(Math.max(0.01, 1 - ax * ax - az * az));
  out[0] = Math.atan2(az, ay); out[1] = Math.asin(clamp(-ax, -1, 1));
  return out;
}

const E = { h: 0, slope: 0, dd: 0, side: 0, ru: 0, rf: 0, rc: 0, tr: 0, pz: 0, bl: false, patch: 0, inMap: true, j: 1, shade: 0 };
function env(x, z) {
  E.h = heightAt(x, z);
  E.slope = slopeAt(x, z);
  riverEval(x, z); E.dd = RV.dd; E.side = RV.side; E.ru = RV.u;
  E.rf = Math.hypot(x - FBX, z - FBZ);
  E.rc = Math.hypot(x - CPX, z - CPZ);
  E.tr = trailDist(x, z);
  E.pz = paddyZoneDist(x, z);
  E.bl = blocked(x, z);
  E.patch = noise2D(x * 0.013 + 40, z * 0.013 - 12);
  E.inMap = Math.abs(x) < HALF && Math.abs(z) < HALF;
  E.j = smoothstep(20, 32, E.rc) * smoothstep(60, 74, E.rf) * smoothstep(3, 12, E.pz) * smoothstep(1, 6, E.dd);
  return E;
}

function placeVegetation() {
  const V = {};
  for (const n of ['emergent', 'canopyA', 'canopyB', 'coconut', 'areca', 'bamboo', 'banana', 'shrub', 'fern', 'elephant',
    'grass', 'tallGrass', 'rice', 'litter', 'log', 'rock', 'stump']) V[n] = new VegType(n);
  const R = rand(9001);
  const grid = (cell, ext, fn) => {
    for (let z = -ext; z < ext; z += cell) for (let x = -ext; x < ext; x += cell) fn(x + R() * cell, z + R() * cell);
  };
  const tgrid = new Map();
  const tkey = (cx, cz) => (cx + 300) * 1000 + (cz + 300);
  const trunkFree = (x, z, d) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const arr = tgrid.get(tkey(cx + dx, cz + dz));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 3) if (Math.hypot(arr[i] - x, arr[i + 1] - z) < d + arr[i + 2]) return false;
    }
    return true;
  };
  const trunkAdd = (x, z, r) => {
    const k = tkey(Math.floor(x / 4), Math.floor(z / 4));
    let arr = tgrid.get(k); if (!arr) tgrid.set(k, arr = []);
    arr.push(x, z, r);
  };
  const tint = (a, b) => [lerp(a, b, R()), lerp(a, b, R()) * 1.0, lerp(a * 0.92, b * 0.95, R())];
  const tilt = [0, 0];

  // --- emergent trees
  grid(24, 400, (x, z) => {
    const e = env(x, z);
    if (e.dd < 7 || e.rf < 68 || e.rc < 23 || e.pz < 7 || e.tr < 3.5 || e.slope > (e.inMap ? 0.75 : 1.4) || e.bl) return;
    const p = e.inMap ? 0.5 + 0.25 * e.patch : 0.72;
    if (R() > p || !trunkFree(x, z, 3)) return;
    const s = 0.82 + R() * 0.42, c = tint(0.9, 1.08);
    V.emergent.add(x, e.h, z, R() * TAU, s, s * (0.9 + R() * 0.2), s, (R() - 0.5) * 0.04, (R() - 0.5) * 0.04, c[0], c[1], c[2]);
    trunkAdd(x, z, 1.4 * s);
    if (e.inMap) { addCyl(x, z, 1.05 * s, e.h - 1, e.h + 25 * s, 'wood'); stampShade(x, z, 10 * s, 0.6); stampCover(x, z, 2.6 * s, 0.35); }
  });
  // --- mid-storey canopy trees
  for (const [name, cell, base] of [['canopyA', 8.5, 0.46], ['canopyB', 11.5, 0.36]]) {
    grid(cell, 400, (x, z) => {
      const e = env(x, z);
      if (e.dd < 4 || e.rf < 64 || e.rc < 21 || e.pz < 4 || e.tr < 2.6 || e.slope > (e.inMap ? 0.9 : 1.4) || e.bl) return;
      const p = e.inMap ? base * (0.85 + 0.3 * e.patch) : base * 1.3;
      if (R() > p || !trunkFree(x, z, 1.6)) return;
      const s = (name === 'canopyA' ? 0.55 + R() * 0.7 : 0.72 + R() * 0.55), c = tint(0.82, 1.12);
      V[name].add(x, e.h, z, R() * TAU, s, s * (0.85 + R() * 0.3), s, (R() - 0.5) * 0.06, (R() - 0.5) * 0.06, c[0], c[1], c[2]);
      trunkAdd(x, z, 0.5 * s);
      if (e.inMap) { addCyl(x, z, 0.34 * s, e.h - 0.5, e.h + 10 * s, 'wood'); stampShade(x, z, 5.5 * s, 0.45); }
    });
  }
  // --- coconut palms (village, river banks, paddy margins)
  grid(8, 248, (x, z) => {
    const e = env(x, z);
    if (e.dd < -0.5 || e.rf < 62 || e.tr < 2 || e.bl || e.pz < 1.5 || e.rc < 8) return;
    let p = 0.012;
    if (e.rc < 58) p = Math.max(p, 0.34 * (1 - smoothstep(38, 58, e.rc)) + 0.04);
    if (e.dd < 18) p = Math.max(p, 0.2);
    if (e.pz < 12) p = Math.max(p, 0.16);
    if (R() > p || !trunkFree(x, z, 1.2)) return;
    let ry;
    if (e.dd < 22) { const dx = e.side > 0 ? -SQ : SQ, dz = e.side > 0 ? SQ : -SQ; ry = Math.atan2(-dz, dx) + (R() - 0.5) * 0.8; }
    else if (e.rc < 60) ry = Math.atan2(-(z - CPZ), x - CPX) + (R() - 0.5) * 1.2;
    else ry = R() * TAU;
    const s = 0.8 + R() * 0.42, c = tint(0.88, 1.1);
    V.coconut.add(x, e.h, z, ry, s, s * (0.85 + R() * 0.3), s, 0, 0, c[0], c[1], c[2]);
    trunkAdd(x, z, 0.4);
    addCyl(x, z, 0.27, e.h - 0.5, e.h + 3.5, 'wood');
    stampShade(x, z, 4 * s, 0.18);
  });
  // --- areca palms (planted around the camp)
  grid(6, 248, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0 || e.rf < 62 || e.tr < 1.8 || e.bl || e.pz < 2 || e.rc < 8) return;
    let p = 0.006;
    if (e.rc < 46) p = 0.38 * (1 - smoothstep(30, 46, e.rc));
    if (e.dd < 12) p = Math.max(p, 0.04);
    if (R() > p || !trunkFree(x, z, 0.9)) return;
    const s = 0.8 + R() * 0.4, c = tint(0.9, 1.1);
    V.areca.add(x, e.h, z, R() * TAU, s, s * (0.85 + R() * 0.3), s, (R() - 0.5) * 0.05, (R() - 0.5) * 0.05, c[0], c[1], c[2]);
    trunkAdd(x, z, 0.25);
    addCyl(x, z, 0.17, e.h - 0.5, e.h + 11 * s, 'wood');
    stampShade(x, z, 3 * s, 0.12);
  });
  // --- bamboo clumps (river banks, camp hedge)
  grid(13, 248, (x, z) => {
    const e = env(x, z);
    if (e.dd < 2 || e.rf < 62 || e.rc < 24 || e.tr < 3.5 || e.pz < 4 || e.bl) return;
    let p = 0.035;
    if (e.dd < 30) p = 0.36;
    if (e.rc < 46) p = 0.42;
    if (R() > p || !trunkFree(x, z, 2.4)) return;
    const s = 0.8 + R() * 0.4, c = tint(0.88, 1.1);
    V.bamboo.add(x, e.h, z, R() * TAU, s, s * (0.85 + R() * 0.3), s, (R() - 0.5) * 0.04, (R() - 0.5) * 0.04, c[0], c[1], c[2]);
    trunkAdd(x, z, 1.2 * s);
    addCyl(x, z, 1.0 * s, e.h - 0.5, e.h + 9, 'wood');
    stampShade(x, z, 4.5 * s, 0.3);
    stampCover(x, z, 3.2 * s, 0.8);
  });

  // --- understory (uses canopy shade for ambient darkening)
  // light albedo variation only: canopy darkening comes from the baked lighting
  const ao = (x, z, k) => 1 - k * 0.25 * shadeAt(x, z);
  grid(5, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.5 || e.rf < 56 || e.tr < 1.6 || e.bl || e.pz < 2 || e.rc < 7) return;
    let p = 0.015;
    if (e.rc < 40) p = 0.3;
    else if (e.dd < 14) p = 0.1;
    else if (e.patch > 0.25) p = 0.07;
    if (R() > p || !trunkFree(x, z, 0.5)) return;
    const s = 0.75 + R() * 0.5, a = ao(x, z, 0.35), c = tint(0.88 * a, 1.08 * a);
    V.banana.add(x, e.h, z, R() * TAU, s, s * (0.85 + R() * 0.3), s, (R() - 0.5) * 0.08, (R() - 0.5) * 0.08, c[0], c[1], c[2]);
    stampCover(x, z, 1.8 * s, 0.45);
  });
  grid(3.1, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.5 || e.rf < 52 || e.tr < 1.3 || e.bl || e.pz < 1.5 || e.rc < 12) return;
    let p = 0.4 * (0.45 + 0.55 * e.j) + (e.patch > 0.3 ? 0.08 : 0);
    if (e.rc < 24) p = 0.12;
    if (R() > p || !trunkFree(x, z, 0.3)) return;
    const s = 0.6 + R() * 0.9, a = ao(x, z, 0.45), c = tint(0.82 * a, 1.1 * a);
    V.shrub.add(x, e.h, z, R() * TAU, s, s * (0.8 + R() * 0.4), s, (R() - 0.5) * 0.1, (R() - 0.5) * 0.1, c[0], c[1], c[2]);
    stampCover(x, z, 1.5 * s, 0.55);
  });
  grid(2.1, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.3 || e.rf < 56 || e.tr < 1.0 || e.bl || e.pz < 1 || e.rc < 10 || e.slope > 1.2) return;
    const wet = 1 - smoothstep(0, 25, e.dd);
    let p = 0.45 * e.j * (0.7 + 0.5 * wet);
    if (e.rc < 24) p = Math.max(p, 0.05);
    if (R() > p) return;
    const ry = R() * TAU, n = normalAt(x, z, _p3);
    alignTilt(n.x, n.y, n.z, ry, 0.6, tilt);
    const s = 0.7 + R() * 0.7, a = ao(x, z, 0.4), c = tint(0.8 * a, 1.1 * a);
    V.fern.add(x, e.h, z, ry, s, s * (0.8 + R() * 0.4), s, tilt[0], tilt[1], c[0], c[1], c[2]);
    stampCover(x, z, 1.1 * s, 0.4);
  });
  grid(3.4, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < -0.2 || e.rf < 56 || e.tr < 1.2 || e.bl || e.pz < 1) return;
    let p = 0.02;
    if (e.dd < 12) p = 0.42;
    else if (e.patch < -0.3) p = 0.08;
    if (e.rc > 8 && e.rc < 25) p = Math.max(p, 0.06);
    if (R() > p) return;
    const s = 0.7 + R() * 0.8, a = ao(x, z, 0.35), c = tint(0.85 * a, 1.1 * a);
    V.elephant.add(x, e.h, z, R() * TAU, s, s * (0.8 + R() * 0.4), s, 0, 0, c[0], c[1], c[2]);
    stampCover(x, z, 1.0 * s, 0.4);
  });
  // Grass grows in stands: a low-frequency clump field gates the density, so tufts merge into
  // patches with bare ground between them instead of an even lawn of round tufts.
  const clumpAt = (x, z) => noise2D(x * 0.11 + 5.3, z * 0.11 - 9.1) * 0.7 + noise2D(x * 0.37 - 2, z * 0.37 + 4) * 0.3;
  grid(1.5, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.5 || e.rf < 46 || e.bl || e.pz < 0.5 || e.tr < 0.9) return;
    const sh = shadeAt(x, z);
    let p = 0.03;
    if (e.tr < 3) p = Math.max(p, 0.3);
    if (e.rf < 62) p = Math.max(p, 0.28);
    if (sh < 0.3 && e.j > 0.5) p = Math.max(p, 0.22);
    if (e.dd < 6) p = Math.max(p, 0.25);
    if (e.rc < 30) {
      // trampled camp: grass only at the sunny edge, never on the footpaths
      p = e.rc > 13 && sh < 0.35 ? 0.2 * smoothstep(13, 22, e.rc) : 0.02;
      if (campPathDist(x, z) < 1.6) p = 0;
    }
    p *= clamp(0.45 + 1.5 * clumpAt(x, z), 0.04, 1.9);
    if (R() > p) return;
    const s = 0.7 + R() * 0.8, a = 1 - 0.08 * sh, c = tint(0.85 * a, 1.1 * a);
    V.grass.add(x, e.h, z, R() * TAU, s, s * (0.75 + R() * 0.5), s, (R() - 0.5) * 0.15, (R() - 0.5) * 0.15, c[0], c[1], c[2]);
    stampCover(x, z, 0.7 * s, 0.22);
  });
  grid(2.0, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.2 || e.rf < 48 || e.tr < 1.4 || e.bl || e.pz < 0.5) return;
    let p = 0.012;
    if (e.dd < 10) p = 0.36;
    if (e.rf < 74) p = Math.max(p, 0.38 * (1 - smoothstep(64, 74, e.rf)));
    if (e.pz < 10) p = Math.max(p, 0.26);
    if (e.patch > 0.3 && shadeAt(x, z) < 0.25) p = Math.max(p, 0.13);
    if (e.rc < 30 && campPathDist(x, z) < 2.2) p = 0;
    const cl = clumpAt(x * 0.8 + 31, z * 0.8 - 17);
    p *= clamp(0.35 + 1.7 * cl, 0, 1.6);
    if (R() > p) return;
    const sat = 1 + Math.floor(R() * 2.6 * smoothstep(-0.1, 0.5, cl));
    for (let q = 0; q <= sat; q++) {
      // the first tuft sits on the grid point; satellites fill in around it
      const ang = R() * TAU, rr = q ? 0.45 + R() * 0.55 : 0;
      const px = x + Math.cos(ang) * rr, pz = z + Math.sin(ang) * rr;
      if (q && (blocked(px, pz) || trailDist(px, pz) < 1.2)) continue;
      const py = q ? heightAt(px, pz) : e.h;
      const s = (0.7 + R() * 0.6) * (q ? 0.85 : 1), c = tint(0.85, 1.1);
      V.tallGrass.add(px, py, pz, R() * TAU, s, s * (0.75 + R() * 0.5), s, (R() - 0.5) * 0.12, (R() - 0.5) * 0.12, c[0], c[1], c[2]);
      stampCover(px, pz, 1.1 * s, 0.6);
    }
  });
  // --- rice: each plot is at its own growth stage
  for (let k = 0; k < PROWS; k++) {
    const j0 = padCol(k, PU0), j1 = padCol(k, PU1 - 1e-3);
    for (let j = j0; j <= j1; j++) {
      const stage = hash2(k * 13 + 5, j * 7 + 3);
      const lv = padLevel(k, j);
      const pu0 = Math.max(PU0 - rowOff(k) + j * COLW, PU0) + 1.0, pu1 = Math.min(PU0 - rowOff(k) + (j + 1) * COLW, PU1) - 1.0;
      const pv0 = PV0 + k * ROWH + 1.0, pv1 = PV0 + (k + 1) * ROWH - 1.0;
      const rot = -Math.PI / 4;
      if (stage < 0.15) {
        // flooded fallow: open water with a scatter of old stubble
        for (let vw = pv0; vw < pv1; vw += 1.1) {
          for (let u = pu0 + R() * 0.6; u < pu1 - 0.4; u += 1.3) {
            if (R() > 0.3) continue;
            uvToXZ(u + (R() - 0.5) * 0.5, vw + (R() - 0.5) * 0.4 + padWob(u), _tmpXZ);
            const b = 0.62 + R() * 0.15;
            V.rice.add(_tmpXZ.x, lv - 0.03, _tmpXZ.z, rot + (R() - 0.5) * 0.6, 0.4, 0.12 + R() * 0.06, 0.4, 0, 0, b * 1.05, b * 0.85, b * 0.5);
          }
        }
      } else if (stage < 0.45) {
        // freshly transplanted: small seedlings in clean straight lines, mostly water
        const vStep = 0.46, uStep = 0.95;
        for (let vw = pv0; vw < pv1; vw += vStep) {
          for (let u = pu0 + 0.1; u < pu1 - 0.4; u += uStep) {
            if (R() < 0.04) continue;
            uvToXZ(u, vw + padWob(u), _tmpXZ);
            const c = tint(0.92, 1.08);
            V.rice.add(_tmpXZ.x, lv - 0.02, _tmpXZ.z, rot + (R() - 0.5) * 0.03, 0.6, 0.26 + R() * 0.08, 0.3, 0, 0, c[0] * 0.95, c[1] * 1.05, c[2] * 0.8);
          }
        }
      } else {
        // growing / mature rice: rows with water still visible between them
        const g = (stage - 0.45) / 0.55, hs = 0.7 + g * 0.55;
        const tone = lerp(1.0, 0.86, g);
        for (let vw = pv0; vw < pv1; vw += 0.86) {
          for (let u = pu0 + R() * 0.4; u < pu1 - 0.6; u += 1.55) {
            if (R() < 0.12) continue;
            uvToXZ(u, vw + padWob(u), _tmpXZ);
            const c = tint(0.86 * tone, 1.0 * tone);
            V.rice.add(_tmpXZ.x, lv - 0.02, _tmpXZ.z, rot + (R() - 0.5) * 0.08, 1, hs * (0.88 + R() * 0.24), 0.8, 0, 0, c[0] * lerp(0.9, 1.0, g), c[1], c[2] * 0.85);
          }
        }
      }
    }
  }
  // --- leaf litter decals (also between the huts, off the footpaths)
  grid(2.6, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 0.5 || e.rf < 60 || e.tr < 1 || e.bl || e.pz < 2 || e.rc < 8) return;
    if (e.rc < 30) { if (e.rc < 23 || campPathDist(x, z) < 2.2 || R() > 0.25) return; }
    else if (R() > 0.6 * e.j) return;
    const ry = R() * TAU, n = normalAt(x, z, _p3);
    alignTilt(n.x, n.y, n.z, ry, 1, tilt);
    const s = 1.4 + R() * 1.4, b = 0.75 + R() * 0.35;
    V.litter.add(x, e.h, z, ry, s, 1, s, tilt[0], tilt[1], b, b * (0.95 + R() * 0.1), b * 0.95);
  });
  // --- fallen logs
  grid(26, 246, (x, z) => {
    const e = env(x, z);
    if (e.dd < 3 || e.rf < 60 || e.rc < 22 || e.tr < 3 || e.bl || e.pz < 4) return;
    if (R() > 0.4 * e.j) return;
    const L = 5 + R() * 4, r = 0.28 + R() * 0.22, ry = R() * TAU;
    const dx = Math.cos(ry) * L * 0.5, dz = -Math.sin(ry) * L * 0.5;
    if (!trunkFree(x, z, L * 0.5)) return;
    const h1 = heightAt(x - dx, z - dz), h2 = heightAt(x + dx, z + dz);
    const cy = (h1 + h2) * 0.5 + r * 0.55;
    V.log.add(x, cy, z, ry, L, r, r, 0, Math.atan2(h2 - h1, L), 0.9, 0.9, 0.9);
    const n = Math.ceil(L / (r * 1.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5, px = x + dx * 2 * t, pz = z + dz * 2 * t;
      addCyl(px, pz, r + 0.08, Math.min(h1, h2) - 0.3, lerp(h1, h2, t + 0.5) + r * 1.5, 'wood');
    }
    stampCover(x, z, L * 0.5, 0.25);
  });
  // --- rocks
  grid(15, 246, (x, z) => {
    const e = env(x, z);
    if (e.rf < 60 || e.rc < 20 || e.tr < 2.5 || e.bl || e.pz < 3) return;
    let p = 0.08 * e.j;
    if (e.dd > -2 && e.dd < 10) p = 0.42;
    if (e.slope > 0.45) p = Math.max(p, 0.3);
    if (R() > p) return;
    const s = 0.4 + Math.pow(R(), 2) * 1.7;
    const sx = s * (0.8 + R() * 0.5), sy = s * (0.6 + R() * 0.4), sz = s * (0.8 + R() * 0.5);
    const b = 0.8 + R() * 0.3;
    V.rock.add(x, e.h - 0.08 * s, z, R() * TAU, sx, sy, sz, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3, b, b, b * 0.95);
    if (s > 0.65) addCyl(x, z, Math.min(sx, sz) * 0.85, e.h - 0.5, e.h + sy * 0.45, 'stone');
  });
  // --- stumps on the cleared firebase glacis and at the camp edge
  grid(5.5, 246, (x, z) => {
    const e = env(x, z);
    let p = 0;
    if (e.rf > 46 && e.rf < 66 && e.tr > 2.5 && !inGate(Math.atan2(z - FBZ, x - FBX), 6, e.rf)) p = 0.3;
    if (e.rc > 24 && e.rc < 34 && e.tr > 2) p = 0.04;
    if (R() > p || e.bl) return;
    const s = 0.6 + R() * 0.7, sy = 0.5 + R() * 0.7;
    V.stump.add(x, e.h, z, R() * TAU, s, sy, s, (R() - 0.5) * 0.08, (R() - 0.5) * 0.08, 1, 1, 1);
    addCyl(x, z, 0.38 * s, e.h - 0.3, e.h + 0.9 * sy, 'wood');
  });

  for (const k in V) V[k].finalize();
  return V;
}

// ---------------------------------------------------------------------------
// Foliage material: MeshStandardMaterial + wind, distance fade, translucency,
// mip-aware alpha test, un-flipped back-face normals.
// ---------------------------------------------------------------------------
const FOL = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 1, 0) },
  uEye: { value: new THREE.Vector3() },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
  uWaterY: { value: WATER_Y },
};

const FOL_VERT_PARS = /* glsl */`
attribute vec3 aFol;
attribute vec2 aBake;
uniform float uTime;
uniform vec4 uWind;
uniform vec3 uEye;
uniform vec3 uSway;
uniform vec2 uFade;
uniform vec3 uBakeH;
varying float vFolTrans;
varying float vFolFade;
varying vec2 vFolBk;
varying vec3 vFolW;
#ifdef FOL_NEAR
varying float vFolNear;
#endif
`;
const FOL_VERT = /* glsl */`
{
  vec3 iPos = vec3(0.0);
  vec3 wdir = vec3(uWind.x, 0.0, uWind.y);
  #ifdef USE_INSTANCING
    iPos = instanceMatrix[3].xyz;
    mat3 im = mat3(instanceMatrix);
    wdir = (wdir * im) / vec3(max(dot(im[0], im[0]), 1e-4), max(dot(im[1], im[1]), 1e-4), max(dot(im[2], im[2]), 1e-4));
  #endif
  float ph = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float gust = 0.55 + 0.45 * sin(dot(iPos.xz, uWind.xy) * 0.035 - uTime * 0.9 + ph * 0.15);
  float str = uWind.z * gust;
  float sway = (sin(uTime * 1.1 + ph) * 0.55 + sin(uTime * 2.3 + ph * 1.7) * 0.25 + 0.45) * str;
  transformed += wdir * (sway * uSway.x * aFol.x);
  float fl = sin(uTime * (4.5 + ph * 0.5) + position.x * 2.3 + position.y * 1.9 + position.z * 2.1) * uSway.y * aFol.y * (0.35 + str);
  transformed += normal * fl;
  float camD = distance(iPos.xz, uEye.xz);
  vFolFade = 1.0 - smoothstep(uFade.x, uFade.y, camD);
  #ifdef FOL_SHRINK
    transformed *= max(vFolFade, 0.0);
  #endif
  vec4 fwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fwp = instanceMatrix * fwp;
  #endif
  vFolW = (modelMatrix * fwp).xyz;
  #ifdef FOL_NEAR
    // cards right in front of the eye dissolve instead of filling the screen
    vFolNear = smoothstep(0.32, 0.95, distance(vFolW, uEye));
  #endif
  // baked occlusion: the instance's ground-level term, opening up toward the crown top
  vFolBk = mix(aBake, vec2(1.0), smoothstep(uBakeH.x, uBakeH.y, position.y) * uBakeH.z);
  vFolTrans = aFol.z;
}
`;
const FOL_FRAG_PARS = /* glsl */`
uniform vec3 uSunView;
uniform vec3 uSunCol;
uniform vec3 uSway;
uniform float uWaterY;
varying float vFolTrans;
varying float vFolFade;
varying vec2 vFolBk;
varying vec3 vFolW;
#ifdef FOL_NEAR
varying float vFolNear;
#endif
float folIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
${BAKE_GLSL}
`;
// Near-camera dissolve for ground cover. Far fading is done by shrinking (ground cover) or by
// blending into the fog colour (trees, see FOL_FOG), so no screen-door pattern shows at range.
const FOL_DITHER = /* glsl */`
#ifdef FOL_NEAR
  if (vFolNear < 0.999 && folIGN(gl_FragCoord.xy) > vFolNear) discard;
#endif
#include <clipping_planes_fragment>
`;
const FOL_FOG = /* glsl */`
#include <fog_fragment>
#if defined( FOL_FOGFADE ) && defined( USE_FOG )
  gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, clamp(vFolFade, 0.0, 1.0));
#endif
`;
// Alpha test that keeps distant cards from thinning out; with MSAA it becomes alpha-to-coverage
// so leaf edges are antialiased instead of stair-stepped.
const FOL_ALPHA = /* glsl */`
#ifdef USE_ALPHATEST
  #ifdef USE_MAP
  {
    vec2 dx = dFdx(vMapUv * 2048.0), dy = dFdy(vMapUv * 2048.0);
    float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-6));
    diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.24;
  }
  #endif
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a = smoothstep(alphaTest, alphaTest + fwidth(diffuseColor.a), diffuseColor.a);
    if (diffuseColor.a == 0.0) discard;
  #else
    if (diffuseColor.a < alphaTest) discard;
  #endif
#endif
`;
// Wet bark and stone near the water line: darker and glossier.
const FOL_COLOR = /* glsl */`
#include <color_fragment>
#ifdef FOL_WET
  float fWet = smoothstep(uWaterY + 1.4, uWaterY + 0.15, vFolW.y);
  diffuseColor.rgb *= mix(1.0, 0.52, fWet);
#endif
`;
const FOL_ROUGH = /* glsl */`
float roughnessFactor = roughness;
#ifdef USE_NORMALMAP
  roughnessFactor *= texture2D(normalMap, vNormalMapUv).a * 1.25;
#endif
#ifdef FOL_WET
  roughnessFactor = mix(roughnessFactor, 0.22, fWet);
#endif
`;
const FOL_TRANS = /* glsl */`
#include <lights_fragment_end>
{
  // baked canopy occlusion: ambient everywhere, sun beyond the realtime shadow range
  float fFar = ugShadowFar(vFolW) * uBakeMix;
  float fSunB = mix(1.0, vFolBk.y, fFar);
  vec3 amb = ugSkyLight(mix(1.0, vFolBk.x, uBakeMix));
  reflectedLight.indirectDiffuse *= amb;
  reflectedLight.indirectSpecular *= amb;
  reflectedLight.directDiffuse *= fSunB;
  reflectedLight.directSpecular *= fSunB;
  float folSh = fSunB;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec4 fsc = vDirectionalShadowCoord[0];
    fsc.xyz /= fsc.w;
    if (receiveShadow && fsc.x > 0.0 && fsc.x < 1.0 && fsc.y > 0.0 && fsc.y < 1.0 && fsc.z < 1.0)
      folSh *= texture2DCompare(directionalShadowMap[0], fsc.xy, fsc.z - 0.003);
  #endif
  // translucency: sun through the leaf when it is behind the leaf, strongest looking into it
  vec3 fvd = normalize(-vViewPosition);
  vec3 gn = normalize(vNormal);
  gn = dot(gn, fvd) < 0.0 ? -gn : gn;
  float back = max(-dot(gn, uSunView), 0.0);
  float fbl = pow(max(-dot(fvd, uSunView), 0.0), 4.0);
  // light that crossed the leaf is filtered by it twice over: deeper, more saturated green
  vec3 tcol = mix(diffuseColor.rgb, diffuseColor.rgb * diffuseColor.rgb * 7.0, 0.55) * vec3(1.0, 1.04, 0.7);
  reflectedLight.directDiffuse += tcol * uSunCol * ((0.35 * back + 0.16 + fbl * 1.9) * uSway.z * vFolTrans * folSh);
}
`;

function patchFolVert(src) {
  return src.replace('#include <common>', '#include <common>\n' + FOL_VERT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FOL_VERT);
}
function patchFolFrag(src, full) {
  let s = src.replace('#include <common>', '#include <common>\n' + FOL_FRAG_PARS)
    .replace('#include <clipping_planes_fragment>', FOL_DITHER)
    .replace('#include <alphatest_fragment>', FOL_ALPHA);
  if (full) {
    s = s.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <color_fragment>', FOL_COLOR)
      .replace('#include <roughnessmap_fragment>', FOL_ROUGH)
      .replace('#include <lights_fragment_end>', FOL_TRANS)
      .replace('#include <fog_fragment>', FOL_FOG);
  }
  return s;
}

function makeFoliageMaterial(atlas, o, atlasN) {
  const bh = o.bakeH || [0, 1, 0];
  const local = {
    uSway: { value: new THREE.Vector3(o.sway ?? 0.2, o.flutter ?? 0.04, o.trans ?? 0.5) },
    uFade: { value: new THREE.Vector2(o.fade[0], o.fade[1]) },
    uBakeH: { value: new THREE.Vector3(bh[0], bh[1], bh[2]) },
  };
  const defines = o.shrink ? { FOL_SHRINK: '' } : {};
  const at = o.alphaTest ?? 0.45;
  const mat = new THREE.MeshStandardMaterial({
    map: atlas, alphaTest: at, side: o.double === false ? THREE.FrontSide : THREE.DoubleSide,
    vertexColors: true, roughness: o.rough ?? 0.8, metalness: 0,
  });
  if (atlasN) { mat.normalMap = atlasN; mat.normalScale.set(o.nScale ?? 0.7, o.nScale ?? 0.7); }
  mat.alphaToCoverage = true;
  mat.defines = { ...defines };
  if (!o.shrink) mat.defines.FOL_FOGFADE = '';
  if (o.near) mat.defines.FOL_NEAR = '';
  if (o.wet) mat.defines.FOL_WET = '';
  const key = 'ugfol' + (o.shrink ? 's' : 'd') + (o.near ? 'n' : '') + (o.wet ? 'w' : '') + (atlasN ? 'm' : '');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FOL, local, BK);
    sh.vertexShader = patchFolVert(sh.vertexShader);
    sh.fragmentShader = patchFolFrag(sh.fragmentShader, true);
  };
  mat.customProgramCacheKey = () => key;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: at });
  depth.defines = { ...defines };
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FOL, local, BK);
    sh.vertexShader = patchFolVert(sh.vertexShader);
    sh.fragmentShader = patchFolFrag(sh.fragmentShader, false);
  };
  depth.customProgramCacheKey = () => 'ugfold' + (o.shrink ? 's' : 'd');
  return { mat, depth, local };
}

// ---------------------------------------------------------------------------
// Streaming foliage layers: one InstancedMesh per type (and per near/far band),
// refilled from per-tile instance arrays when the camera moves.
// ---------------------------------------------------------------------------
const RING = [];
for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) RING.push([dx, dz, Math.hypot(dx, dz) * TILE]);
RING.sort((a, b) => a[2] - b[2]);

function tileDist(tx, tz, cx, cz) {
  const x0 = TILE_MIN + tx * TILE, z0 = TILE_MIN + tz * TILE;
  const ddx = Math.max(x0 - cx, 0, cx - (x0 + TILE)), ddz = Math.max(z0 - cz, 0, cz - (z0 + TILE));
  return Math.sqrt(ddx * ddx + ddz * ddz);
}
// Distance from (cx, cz) to the farthest corner of a tile.
function tileFarDist(tx, tz, cx, cz) {
  const x0 = TILE_MIN + tx * TILE, z0 = TILE_MIN + tz * TILE;
  const ddx = Math.max(Math.abs(x0 - cx), Math.abs(x0 + TILE - cx)), ddz = Math.max(Math.abs(z0 - cz), Math.abs(z0 + TILE - cz));
  return Math.sqrt(ddx * ddx + ddz * ddz);
}

// Scratch objects for the per-tile visibility test.
const _tileBox = new THREE.Box3(), _tileBoxS = new THREE.Box3();

class FoliageLayer {
  constructor(type, geo, mats, rMin, rMax, shadow) {
    this.type = type; this.rMin = rMin; this.rMax = rMax; this.mats = mats;
    this.shadow = !!shadow;
    this.thin = 1;                // keep every n-th instance (Low preset halves ground cover)
    // capacity: worst case over the playable area (whole tiles, no culling)
    let cap = 0;
    for (let cz = -HALF; cz <= HALF; cz += 16) for (let cx = -HALF; cx <= HALF; cx += 16) {
      let n = 0;
      const tcx = Math.floor((cx - TILE_MIN) / TILE), tcz = Math.floor((cz - TILE_MIN) / TILE);
      for (const o of RING) {
        if (o[2] - 46 > rMax) break;
        const tx = tcx + o[0], tz = tcz + o[1];
        if (tx < 0 || tz < 0 || tx >= NT || tz >= NT) continue;
        const d = tileDist(tx, tz, cx, cz);
        if (d > rMax || tileFarDist(tx, tz, cx, cz) <= rMin) continue;
        const t = tz * NT + tx;
        n += type.start[t + 1] - type.start[t];
      }
      if (n > cap) cap = n;
    }
    this.cap = Math.max(1, Math.ceil(cap * 1.04) + 8);
    // instance bounds relative to the instance origin (used to grow tile boxes)
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    this.gyMin = Math.min(0, bb.min.y); this.gyMax = Math.max(0.5, bb.max.y);
    this.gxz = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z), 0.5);
    const mesh = new THREE.InstancedMesh(geo, mats.mat, this.cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.bakeAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 2).fill(1), 2);
    this.bakeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBake', this.bakeAttr);
    mesh.count = 0;
    mesh.frustumCulled = false;   // culled per tile and per instance in fill()
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = mats.depth;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'foliage:' + type.name;
    this.mesh = mesh;
  }
  // Refill around the stream centre (cx, cz). `view` is a widened camera frustum (or null for
  // no view culling); `sun` is the shadow camera frustum, used for shadow-casting layers so
  // trees behind the player still throw their shadows forward.
  fill(cx, cz, view, sun) {
    const T = this.type, M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array, BB = this.bakeAttr.array;
    const SM = T.mat, SC = T.col, SB = T.bake, thin = this.thin;
    const cap = this.cap, rMax = this.rMax, rMin = this.rMin;
    const rMax2 = rMax * rMax, rMin2 = rMin > 0 ? rMin * rMin : -1;
    const tcx = Math.floor((cx - TILE_MIN) / TILE), tcz = Math.floor((cz - TILE_MIN) / TILE);
    const sunT = this.shadow ? sun : null;
    let n = 0;
    for (let r = 0; r < RING.length && n < cap; r++) {
      const o = RING[r];
      if (o[2] - 46 > rMax) break;
      const tx = tcx + o[0], tz = tcz + o[1];
      if (tx < 0 || tz < 0 || tx >= NT || tz >= NT) continue;
      const t = tz * NT + tx, a = T.start[t], b = T.start[t + 1];
      if (a === b) continue;
      const dNear = tileDist(tx, tz, cx, cz);
      if (dNear > rMax) continue;
      const far = tileFarDist(tx, tz, cx, cz);
      if (far <= rMin) continue;
      const inside = far <= rMax && dNear > rMin;
      // tiles close to the stream centre are always kept: a sideways step can bring them into view
      if (view && dNear > CULL_KEEP) {
        const gx = this.gxz * T.tsXZ[t], x0 = TILE_MIN + tx * TILE, z0 = TILE_MIN + tz * TILE;
        _tileBox.min.set(x0 - gx, T.tyMin[t] + this.gyMin * T.tsY[t] - 0.5, z0 - gx);
        _tileBox.max.set(x0 + TILE + gx, T.tyMax[t] + this.gyMax * T.tsY[t] + 0.5, z0 + TILE + gx);
        if (!view.intersectsBox(_tileBox)) {
          if (!sunT) continue;
          // the shadow box follows the player between refills, so test a grown box
          _tileBoxS.copy(_tileBox).expandByScalar(22);
          if (!sunT.intersectsBox(_tileBoxS)) continue;
        }
      }
      if (inside && thin === 1) {
        // whole tile in range: one block copy
        const cnt = Math.min(b - a, cap - n);
        M.set(SM.subarray(a * 16, (a + cnt) * 16), n * 16);
        C.set(SC.subarray(a * 3, (a + cnt) * 3), n * 3);
        BB.set(SB.subarray(a * 2, (a + cnt) * 2), n * 2);
        n += cnt;
        continue;
      }
      if (thin > 1) {
        // thinned: per instance, every thin-th one (stable across refills)
        for (let i = a; i < b && n < cap; i++) {
          if (i % thin) continue;
          const dx = SM[i * 16 + 12] - cx, dz = SM[i * 16 + 14] - cz, d2 = dx * dx + dz * dz;
          if (d2 > rMax2 || d2 <= rMin2) continue;
          M.set(SM.subarray(i * 16, i * 16 + 16), n * 16);
          C[n * 3] = SC[i * 3]; C[n * 3 + 1] = SC[i * 3 + 1]; C[n * 3 + 2] = SC[i * 3 + 2];
          BB[n * 2] = SB[i * 2]; BB[n * 2 + 1] = SB[i * 2 + 1];
          n++;
        }
        continue;
      }
      // partial tile: copy runs of instances whose own position is inside [rMin, rMax]
      let run = -1;
      for (let i = a; i <= b; i++) {
        let ok = false;
        if (i < b) {
          const dx = SM[i * 16 + 12] - cx, dz = SM[i * 16 + 14] - cz, d2 = dx * dx + dz * dz;
          ok = d2 <= rMax2 && d2 > rMin2;
        }
        if (ok) { if (run < 0) run = i; continue; }
        if (run >= 0) {
          const cnt = Math.min(i - run, cap - n);
          M.set(SM.subarray(run * 16, (run + cnt) * 16), n * 16);
          C.set(SC.subarray(run * 3, (run + cnt) * 3), n * 3);
          BB.set(SB.subarray(run * 2, (run + cnt) * 2), n * 2);
          n += cnt;
          run = -1;
          if (n >= cap) break;
        }
      }
    }
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor;
    this.mesh.count = n;
    im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(16, n * 16)); im.needsUpdate = true;
    ic.clearUpdateRanges(); ic.addUpdateRange(0, Math.max(3, n * 3)); ic.needsUpdate = true;
    const ba = this.bakeAttr;
    ba.clearUpdateRanges(); ba.addUpdateRange(0, Math.max(2, n * 2)); ba.needsUpdate = true;
  }
}

const VEG_SPEC = [
  { name: 'emergent', build: buildEmergent, lod: true, nearR: 90, fade: [196, 216], sway: 0.45, flutter: 0.05, trans: 0.55, shadow: true, bakeH: [4, 28, 1], crownAO: 0.42 },
  { name: 'canopyA', build: buildCanopyA, lod: true, nearR: 90, fade: [186, 206], sway: 0.35, flutter: 0.05, trans: 0.5, shadow: true, bakeH: [2, 13, 0.9], crownAO: 0.4 },
  { name: 'canopyB', build: buildCanopyB, lod: true, nearR: 90, fade: [186, 206], sway: 0.35, flutter: 0.05, trans: 0.5, shadow: true, bakeH: [2, 16, 0.9], crownAO: 0.4 },
  { name: 'coconut', build: buildCoconut, lod: true, nearR: 90, fade: [168, 190], sway: 0.5, flutter: 0.06, trans: 0.55, shadow: true, bakeH: [2, 11, 0.85], crownAO: 0.25 },
  { name: 'areca', build: buildAreca, lod: true, nearR: 90, fade: [160, 182], sway: 0.55, flutter: 0.06, trans: 0.55, shadow: true, bakeH: [2, 10, 0.8], crownAO: 0.25 },
  { name: 'bamboo', build: buildBamboo, lod: true, nearR: 90, fade: [148, 170], sway: 0.9, flutter: 0.05, trans: 0.6, shadow: true, bakeH: [1, 9, 0.7], crownAO: 0.3 },
  { name: 'banana', build: buildBanana, lod: true, nearR: 62, fade: [98, 116], shrink: true, near: true, sway: 0.12, flutter: 0.05, trans: 0.7, shadow: true, bakeH: [0.3, 3, 0.3], crownAO: 0.25, thin: true },
  { name: 'shrub', build: buildShrub, lod: true, nearR: 46, fade: [102, 124], shrink: true, near: true, sway: 0.1, flutter: 0.05, trans: 0.5, shadow: true, bakeH: [0.2, 2.2, 0.3], crownAO: 0.35, thin: true },
  { name: 'fern', build: buildFern, fade: [50, 62], shrink: true, near: true, sway: 0.08, flutter: 0.04, trans: 0.5, bakeH: [0, 1.5, 0.15], thin: true },
  { name: 'elephant', build: buildElephantEar, fade: [58, 72], shrink: true, near: true, sway: 0.06, flutter: 0.05, trans: 0.6, bakeH: [0, 1.5, 0.15], thin: true },
  { name: 'grass', build: () => buildGrass(reg('grass'), 1.1, 0.85), fade: [36, 48], shrink: true, near: true, sway: 0.22, flutter: 0.02, trans: 0.45, bakeH: [0, 1.2, 0.15], thin: true },
  { name: 'tallGrass', build: () => buildGrass(reg('tallGrass'), 1.5, 2.0), fade: [62, 78], shrink: true, near: true, sway: 0.4, flutter: 0.03, trans: 0.45, bakeH: [0, 2, 0.15], thin: true },
  { name: 'rice', build: buildRice, fade: [55, 70], shrink: true, near: true, sway: 0.1, flutter: 0.02, trans: 0.3, bakeH: [0, 1, 0.1], thin: true },
  { name: 'litter', build: buildLitter, fade: [30, 40], shrink: true, sway: 0, flutter: 0, trans: 0, double: false, alphaTest: 0.5, rough: 0.95, thin: true },
  { name: 'log', build: buildLog, fade: [108, 126], shrink: true, sway: 0, flutter: 0, trans: 0, double: false, shadow: true, rough: 0.95, wet: true, bakeH: [0, 1, 0.1] },
  { name: 'rock', build: buildRock, fade: [118, 138], shrink: true, sway: 0, flutter: 0, trans: 0, double: false, shadow: true, rough: 0.9, wet: true, bakeH: [0, 1, 0.1] },
  { name: 'stump', build: buildStump, fade: [108, 126], shrink: true, sway: 0, flutter: 0, trans: 0, double: false, shadow: true, rough: 0.95, wet: true, bakeH: [0, 1, 0.1] },
];

// Per-vertex AO inside a crown: leaf cards near the middle of the leaf mass and on its
// underside are darker than the outer shell (multiplied into the vertex colour).
function crownAO(geo, strength) {
  if (!strength) return geo;
  const P = geo.attributes.position, F = geo.attributes.aFol, C = geo.attributes.color;
  if (!P || !F || !C) return geo;
  let cx = 0, cy = 0, cz = 0, n = 0, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < P.count; i++) {
    if (F.getZ(i) <= 0) continue;
    const y = P.getY(i);
    cx += P.getX(i); cy += y; cz += P.getZ(i); n++;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  if (n < 8) return geo;
  cx /= n; cy /= n; cz /= n;
  let rmax = 1e-3;
  for (let i = 0; i < P.count; i++) {
    if (F.getZ(i) <= 0) continue;
    rmax = Math.max(rmax, Math.hypot(P.getX(i) - cx, (P.getY(i) - cy) * 1.4, P.getZ(i) - cz));
  }
  const span = Math.max(ymax - ymin, 1e-3);
  for (let i = 0; i < P.count; i++) {
    if (F.getZ(i) <= 0) continue;
    const d = Math.hypot(P.getX(i) - cx, (P.getY(i) - cy) * 1.4, P.getZ(i) - cz) / rmax;
    const up = (P.getY(i) - ymin) / span;
    const ao = 1 - strength * (1 - smoothstep(0.15, 0.9, d)) * (1.15 - 0.5 * up);
    C.setXYZ(i, C.getX(i) * ao, C.getY(i) * ao, C.getZ(i) * ao);
  }
  C.needsUpdate = true;
  return geo;
}

function buildFoliageLayers(V, atlas, group, atlasN) {
  const layers = [];
  for (const sp of VEG_SPEC) {
    const T = V[sp.name];
    if (!T || !T.count) continue;
    const mats = makeFoliageMaterial(atlas, sp, atlasN);
    const rFar = sp.fade[1] * DENSITY_MAX + STREAM_STEP;   // capacity for the densest preset
    if (sp.lod) {
      const near = new FoliageLayer(T, crownAO(sp.build(0), sp.crownAO), mats, -1, sp.nearR, sp.shadow);
      const far = new FoliageLayer(T, crownAO(sp.build(1), sp.crownAO), mats, sp.nearR, rFar, false);
      layers.push(near, far);
    } else {
      layers.push(new FoliageLayer(T, crownAO(sp.build(0), sp.crownAO), mats, -1, rFar, sp.shadow));
    }
    sp.mats = mats;
  }
  for (const l of layers) group.add(l.mesh);
  return layers;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
const TERRAIN_PARS = /* glsl */`
uniform sampler2D tLitter;
uniform sampler2D tGrass;
uniform sampler2D tMud;
uniform sampler2D tLat;
uniform sampler2D tMoss;
uniform sampler2D tSplat;
uniform sampler2D tMacro;
uniform sampler2D tNMud;
uniform sampler2D tNLat;
uniform sampler2D tNGra;
uniform sampler2D tNMos;
uniform float uWaterY;
varying vec3 vTW;
${BAKE_GLSL}
`;
// Albedo from five splatted layers (height-blended), plus the material state the lighting
// needs: per-layer roughness, wetness (darker, glossier soil at the river and in mud) and
// standing water in hollows (mirror-smooth, flat normals).
const TERRAIN_MAP = /* glsl */`
vec2 wp = vTW.xz;
vec4 sp = texture2D(tSplat, (wp + 256.0) / 512.0);
vec4 bk0 = ugBakeAt(vTW);
vec3 mac = texture2D(tMacro, wp * 0.0037).rgb;
float mac2 = texture2D(tMacro, wp * 0.021 + 0.37).g;
vec2 uvA = wp / 3.1;
vec2 uvB = vec2(wp.x * 0.8 - wp.y * 0.6, wp.x * 0.6 + wp.y * 0.8) / 7.3;
vec3 cLit = mix(texture2D(tLitter, uvA).rgb, texture2D(tLitter, uvB).rgb, 0.3 + 0.35 * mac2);
vec3 cGra = mix(texture2D(tGrass, uvA * 1.15).rgb, texture2D(tGrass, uvB * 1.3).rgb, 0.4);
vec3 cMud = texture2D(tMud, wp / 4.3).rgb;
vec3 cLat = mix(texture2D(tLat, wp / 4.1).rgb, texture2D(tLat, uvB * 0.9).rgb, 0.35);
vec3 cMos = texture2D(tMoss, wp / 3.3).rgb;
float wL = max(0.0, 1.0 - sp.r - sp.g - sp.b - sp.a);
vec4 hh = sqrt(vec4(dot(cLat, vec3(0.333)), dot(cMud, vec3(0.333)), dot(cGra, vec3(0.333)), dot(cMos, vec3(0.333))));
float hL = sqrt(dot(cLit, vec3(0.333)));
vec4 b4 = sp + hh * 0.7 * step(0.002, sp);
float bL = wL + hL * 0.7 * step(0.002, wL);
float bm = max(max(max(b4.x, b4.y), max(b4.z, b4.w)), bL) - 0.18;
b4 = max(b4 - bm, 0.0);
bL = max(bL - bm, 0.0);
float bs = b4.x + b4.y + b4.z + b4.w + bL + 1e-4;
b4 /= bs; bL /= bs;
vec3 tcol = cLat * b4.x + cMud * b4.y + cGra * b4.z + cMos * b4.w + cLit * bL;
float outer = smoothstep(250.0, 330.0, max(abs(vTW.x), abs(vTW.z)));
float tWet = clamp(max(smoothstep(uWaterY + 1.15, uWaterY + 0.05, vTW.y), bk0.a * 0.85) + b4.y * 0.3, 0.0, 1.0) * (1.0 - outer);
// standing water in hollows of bare soil (trails, camp paths, river margins)
float pudN = smoothstep(0.3, 0.75, mac.b + mac2 * 0.35);
float puddle = smoothstep(0.32, 0.6, bk0.b * (b4.y + b4.x * 0.8) * (0.55 + 0.9 * pudN)) * (1.0 - outer);
tcol *= mix(1.0, 0.6, tWet);
tcol *= 0.9 + 0.2 * mac.r;
tcol = mix(tcol, tcol * vec3(0.5, 0.48, 0.44), puddle);
tcol = mix(tcol, vec3(0.03, 0.05, 0.02) * (0.7 + 0.6 * mac.g), outer);
diffuseColor.rgb *= tcol;
float tRough = b4.x * 0.9 + b4.y * 0.74 + b4.z * 0.84 + b4.w * 0.78 + bL * 0.86;
tRough = mix(tRough, 0.34, tWet * 0.85);
tRough = mix(tRough, 0.05, puddle);
`;
const TERRAIN_NORMAL = /* glsl */`
{
  vec3 nLit = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  vec3 nMud = texture2D(tNMud, wp / 4.3).xyz * 2.0 - 1.0;
  vec3 nLat = texture2D(tNLat, wp / 4.1).xyz * 2.0 - 1.0;
  vec3 nGra = texture2D(tNGra, uvA * 1.15).xyz * 2.0 - 1.0;
  vec3 nMos = texture2D(tNMos, wp / 3.3).xyz * 2.0 - 1.0;
  vec3 mapN = nLit * bL + nMud * b4.y + nLat * b4.x + nGra * b4.z + nMos * b4.w;
  mapN.xy *= normalScale * (1.0 - puddle) * mix(1.0, 0.55, tWet);
  normal = normalize(tbn * normalize(mapN));
}
`;
// Baked light: canopy and terrain occlusion darken (and green) the ambient everywhere; beyond the
// realtime shadow range the baked sun term stands in for the canopy's and the hills' shadows.
const TERRAIN_LIGHT = /* glsl */`
#include <lights_fragment_end>
{
  float bSky = mix(1.0, mix(bk0.r, 0.2, outer), uBakeMix);
  vec3 amb = ugSkyLight(bSky);
  reflectedLight.indirectDiffuse *= amb;
  reflectedLight.indirectSpecular *= mix(amb, vec3(bSky), 0.5);
  float bSun = mix(1.0, mix(bk0.g, 0.2, outer), uBakeMix * max(ugShadowFar(vTW), outer));
  reflectedLight.directDiffuse *= bSun;
  reflectedLight.directSpecular *= bSun;
}
`;

function makeTerrainMaterial(TT, splatTex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0,
    normalMap: TT.normal, normalScale: new THREE.Vector2(1.0, 1.0),
  });
  const U = {
    tLitter: { value: TT.litter }, tGrass: { value: TT.grass }, tMud: { value: TT.mud }, tLat: { value: TT.laterite },
    tMoss: { value: TT.moss }, tSplat: { value: splatTex }, tMacro: { value: TT.macro }, uWaterY: { value: WATER_Y },
    tNMud: { value: TT.nMud }, tNLat: { value: TT.nLat }, tNGra: { value: TT.nGra }, tNMos: { value: TT.nMos },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, BK);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_PARS)
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
      .replace('#include <lights_fragment_end>', TERRAIN_LIGHT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;');
  };
  mat.customProgramCacheKey = () => 'ugterrain2';
  return mat;
}

// Visual height: paddy floors without bunds (bunds are a separate mesh), and
// edge vertices matched to the 8 m outer mesh so there are no cracks.
function visualHeightRaw(x, z) {
  if (paddyZoneDist(x, z) < 11) return terrainHeight(x, z, false);
  return heightAt(x, z);
}
function visualHeight(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > HALF || az > HALF) return terrainHeight(x, z, true);
  if (ax === HALF) {
    const z0 = Math.floor((z + HALF) / 8) * 8 - HALF;
    if (z0 !== z) return lerp(visualHeightRaw(x, z0), visualHeightRaw(x, z0 + 8), (z - z0) / 8);
  } else if (az === HALF) {
    const x0 = Math.floor((x + HALF) / 8) * 8 - HALF;
    if (x0 !== x) return lerp(visualHeightRaw(x0, z), visualHeightRaw(x0 + 8, z), (x - x0) / 8);
  }
  return visualHeightRaw(x, z);
}

function gridGeometry(x0, z0, nx, nz, res, hfn, skip) {
  const vx = nx + 1, vz = nz + 1;
  const H = new Float32Array((vx + 2) * (vz + 2));
  for (let j = -1; j <= vz; j++) for (let i = -1; i <= vx; i++) H[(j + 1) * (vx + 2) + (i + 1)] = hfn(x0 + i * res, z0 + j * res);
  const pos = new Float32Array(vx * vz * 3), nor = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2);
  for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
    const k = j * vx + i, x = x0 + i * res, z = z0 + j * res;
    const hc = H[(j + 1) * (vx + 2) + (i + 1)];
    const hl = H[(j + 1) * (vx + 2) + i], hr = H[(j + 1) * (vx + 2) + i + 2];
    const hd = H[j * (vx + 2) + i + 1], hu = H[(j + 2) * (vx + 2) + i + 1];
    let nx2 = (hl - hr) / (2 * res), nz2 = (hd - hu) / (2 * res);
    const l = Math.hypot(nx2, 1, nz2);
    pos[k * 3] = x; pos[k * 3 + 1] = hc; pos[k * 3 + 2] = z;
    nor[k * 3] = nx2 / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz2 / l;
    uv[k * 2] = x / 3.1; uv[k * 2 + 1] = z / 3.1;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (skip && skip(x0 + i * res, z0 + j * res)) continue;
    const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
    if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(vx * vz > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function buildTerrainMeshes(mat, group) {
  const meshes = [];
  const CH = 128;
  for (let cz = -HALF; cz < HALF; cz += CH) for (let cx = -HALF; cx < HALF; cx += CH) {
    const m = new THREE.Mesh(gridGeometry(cx, cz, CH / 2, CH / 2, 2, visualHeight), mat);
    m.receiveShadow = true; m.castShadow = true; m.matrixAutoUpdate = false; m.name = 'terrain';
    group.add(m); meshes.push(m);
  }
  const OUT = 640;
  const outer = new THREE.Mesh(gridGeometry(-OUT, -OUT, OUT / 4, OUT / 4, 8, (x, z) => terrainHeight(x, z, true),
    (x, z) => x >= -HALF && x + 8 <= HALF && z >= -HALF && z + 8 <= HALF), mat);
  outer.receiveShadow = false; outer.castShadow = false; outer.matrixAutoUpdate = false; outer.name = 'terrainOuter';
  group.add(outer); meshes.push(outer);
  return meshes;
}

// Raised earth bunds between paddy plots.
function buildBundMesh(mat) {
  const P = [], N = [], UVs = [], I = [];
  const lines = [];
  for (let k = 0; k <= PROWS; k++) lines.push({ h: true, vw: PV0 + k * ROWH, u0: PU0, u1: PU1 });
  for (let k = 0; k < PROWS; k++) {
    const j0 = padCol(k, PU0), j1 = padCol(k, PU1 - 1e-3);
    const vw0 = PV0 + k * ROWH, vw1 = vw0 + ROWH;
    lines.push({ h: false, u: PU0, vw0, vw1 });
    lines.push({ h: false, u: PU1, vw0, vw1 });
    for (let j = j0; j < j1; j++) lines.push({ h: false, u: PU0 - rowOff(k) + (j + 1) * COLW, vw0, vw1 });
  }
  const offs = [-1.0, -0.42, 0, 0.42, 1.0];
  const pt = { x: 0, z: 0 };
  for (const L of lines) {
    const len = L.h ? L.u1 - L.u0 : L.vw1 - L.vw0;
    const n = Math.max(2, Math.ceil(len / 1.0));
    const base = P.length / 3;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      for (let q = 0; q < offs.length; q++) {
        let u, vw;
        if (L.h) { u = lerp(L.u0, L.u1, t); vw = L.vw + offs[q]; } else { u = L.u + offs[q]; vw = lerp(L.vw0, L.vw1, t); }
        uvToXZ(u, vw + padWob(u), pt);
        let y = terrainHeight(pt.x, pt.z, true);
        if (q === 0 || q === 4) y -= 0.1;
        P.push(pt.x, y, pt.z); N.push(0, 1, 0); UVs.push(pt.x / 3.1, pt.z / 3.1);
      }
    }
    for (let s = 0; s < n; s++) for (let q = 0; q < offs.length - 1; q++) {
      const a = base + s * 5 + q, b = a + 1, c = a + 5, d = c + 1;
      I.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  // keep normals facing up regardless of winding
  const nn = g.attributes.normal;
  for (let i = 0; i < nn.count; i++) if (nn.getY(i) < 0) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = 'bunds';
  return m;
}

// Splat weights: R laterite, G mud, B grass, A moss; litter is the remainder.
let SPLAT = null;
function buildSplat() {
  const N = 512, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const z = -HALF + j + 0.5;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i + 0.5;
      const n1 = noise2D(x * 0.08, z * 0.08), n2 = noise2D(x * 0.021 + 7, z * 0.021);
      riverEval(x, z);
      const dd = RV.dd;
      const rf = Math.hypot(x - FBX, z - FBZ), rc = Math.hypot(x - CPX, z - CPZ);
      const tr = trailDist(x, z), pz = paddyZoneDist(x, z), sl = slopeAt(x, z);
      let lat = 0, mud = 0, gra = 0, mos = 0;
      lat = Math.max(lat, 1 - smoothstep(47 + 5 * n1, 60 + 6 * n1, rf));
      if (rf < 50) mud = Math.max(mud, smoothstep(0.1, 0.6, noise2D(x * 0.045 + 11, z * 0.045 - 4)) * 0.55);
      lat = Math.max(lat, (1 - smoothstep(0.5, 1.7 + 0.6 * n1, tr)) * (0.62 + 0.2 * n2));
      if (rc < 34) {
        // trampled camp floor: bare earth and leaf litter, worn paths between huts, fire and
        // hatches; grass only in sunny gaps toward the edge
        const k = 1 - smoothstep(14, 28 + 4 * n2, rc);
        const pd = campPathDist(x, z), pw = 0.9 + 0.45 * n1;
        const path = 1 - smoothstep(pw * 0.55, pw * 1.6, pd);
        mud = Math.max(mud, k * clamp(0.24 + 0.34 * n1 + 0.2 * n2, 0, 0.72));
        mud = Math.max(mud, (1 - smoothstep(4, 9, rc)) * 0.7);
        mud = Math.max(mud, path * 0.92);
        lat = Math.max(lat, path * 0.22 * (0.6 + 0.4 * n2));
        const shC = shadeAt(x, z);
        const gap = smoothstep(0.32, 0.12, shC) * smoothstep(13, 22, rc) * (1 - path);
        gra = Math.max(gra, gap * clamp(0.3 + 0.5 * n2 + 0.3 * n1, 0, 0.8));
      }
      if (Math.max(Math.abs(x), Math.abs(z)) < 236) lat = Math.max(lat, smoothstep(0.6, 1.0, sl) * 0.6);
      if (dd < 9) mud = Math.max(mud, 1 - smoothstep(1 + 2 * n1, 7 + 2 * n1, dd));
      if (dd > 3 && dd < 16) gra = Math.max(gra, smoothstep(3, 6, dd) * (1 - smoothstep(11, 16, dd)) * (0.5 + 0.4 * n2));
      if (pz < 10) {
        paddyEval(x, z, true);
        if (PD.inZone) {
          lat = 0;
          if (PD.edge < 0.85) { gra = 0.75; mud = 0.25; } else { mud = 1; gra = 0; }
        } else gra = Math.max(gra, (1 - smoothstep(0, 10, pz)) * 0.6);
      }
      gra = Math.max(gra, smoothstep(50, 58, rf) * (1 - smoothstep(66, 80, rf)) * 0.75);
      const sh = shadeAt(x, z);
      const jungle = smoothstep(22, 32, rc) * smoothstep(60, 74, rf) * smoothstep(3, 12, pz);
      gra = Math.max(gra, smoothstep(0.35, 0.08, sh) * smoothstep(0.05, 0.5, n2) * 0.6 * jungle);
      mos = smoothstep(0.15, 0.7, noise2D(x * 0.05 + 3, z * 0.05 - 8)) * 0.5 * jungle * smoothstep(0.2, 0.5, sh);
      const sum = lat + mud + gra + mos;
      if (sum > 1) { lat /= sum; mud /= sum; gra /= sum; mos /= sum; }
      const k = (j * N + i) * 4;
      data[k] = lat * 255; data[k + 1] = mud * 255; data[k + 2] = gra * 255; data[k + 3] = mos * 255;
    }
  }
  SPLAT = data;
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function surfaceAt(x, z) {
  if (isWater(x, z)) return 'water';
  if (!SPLAT) return 'leaves';
  const i = clamp(Math.floor(x + HALF), 0, 511), j = clamp(Math.floor(z + HALF), 0, 511), k = (j * 512 + i) * 4;
  const lat = SPLAT[k], mud = SPLAT[k + 1], gra = SPLAT[k + 2] + SPLAT[k + 3], lit = 255 - lat - mud - SPLAT[k + 2] - SPLAT[k + 3];
  const m = Math.max(lat, mud, gra, lit);
  if (m === mud) return 'mud';
  if (m === lat) return 'dirt';
  if (m === gra) return 'grass';
  return 'leaves';
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */`
attribute float aDepth;
attribute float aFlow;
varying vec3 vW;
varying vec2 vWUv;
varying float vDepth;
varying float vFlow;
varying float vFogD;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vWUv = uv; vDepth = aDepth; vFlow = aFlow;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const NOISE_GLSL = /* glsl */`
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uTreeCol;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uLight;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec3 vW;
varying vec2 vWUv;
varying float vDepth;
varying float vFlow;
varying float vFogD;
${NOISE_GLSL}
${BAKE_GLSL}
float wh(vec2 p, float t, float fl) {
  float h = vnoise(p * vec2(0.18, 0.3) + vec2(-t * fl * 0.2, t * 0.03)) * 0.5;
  h += vnoise(p * vec2(0.5, 0.75) + vec2(-t * fl * 0.55, -t * 0.07)) * 0.3;
  h += vnoise(p * 1.4 + vec2(-t * fl * 1.1 + t * 0.12, t * 0.15)) * 0.14;
  return h;
}
void main() {
  vec2 p = vWUv;
  float e = 0.12;
  float h0 = wh(p, uTime, vFlow), hx = wh(p + vec2(e, 0.0), uTime, vFlow), hy = wh(p + vec2(0.0, e), uTime, vFlow);
  float camDist = length(cameraPosition - vW);
  float k = (vFlow > 0.01 ? 0.32 : 0.12) / (1.0 + camDist * 0.03);
  vec3 n = normalize(vec3(-(hx - h0) / e * k, 1.0, -(hy - h0) / e * k));
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  bool still = vFlow < 0.01;
  // flooded paddies: a still, silty mirror that mostly shows the sky and the tree line
  if (still) fres = max(fres, 0.36);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyHor, uSkyZen, smoothstep(0.0, 0.7, R.y));
  vec3 refl = mix(uTreeCol, sky, smoothstep(0.02, 0.45, R.y + (h0 - 0.5) * 0.04));
  // baked light: under overhanging canopy the water mirrors leaves, not sky, and gets no glint
  vec4 bk = ugBakeAt(vW);
  float wSky = mix(1.0, bk.r, uBakeMix);
  refl = mix(uTreeCol * 0.7, refl, smoothstep(0.08, 0.75, wSky));
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunCol * (pow(sd, 260.0) * 4.0 + pow(sd, 30.0) * 0.12) * mix(1.0, bk.g, uBakeMix);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.8, vDepth)) * uLight;
  if (still) body = mix(uDeep, uShallow, 0.3) * uLight * 0.8;
  body *= mix(0.55, 1.0, wSky);
  vec3 col = mix(body, refl * uLight, fres) + spec;
  float shore = 1.0 - smoothstep(0.0, 0.25, vDepth);
  col = mix(col, uShallow * 1.5 * uLight, shore * 0.3);
  float alpha = smoothstep(-0.02, 0.3, vDepth);
  alpha = clamp(mix(0.62, 0.95, smoothstep(0.1, 1.2, vDepth)) * alpha + fres * 0.2 * alpha, 0.0, 1.0);
  if (still) alpha = max(alpha, 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);
}
`;
function makeWaterMaterial() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: new THREE.Color() },
    uSkyZen: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() }, uTreeCol: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uLight: { value: 1 },
  }]);
  Object.assign(uniforms, BK);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true, depthWrite: true });
  return mat;
}
function buildRiverMesh(mat) {
  const P = [], UV = [], D = [], F = [], I = [];
  const across = 22, uStep = 3;
  let acc = 0, rows = 0;
  for (let u = -380; u <= 380; u += uStep) {
    const vc = riverV(u), s = riverDV(u), hw = riverHW(u), l = Math.sqrt(1 + s * s);
    const du = -s / l, dv = 1 / l, W = hw + 5;
    for (let k = 0; k <= across; k++) {
      const o = -W + (2 * W * k) / across;
      const uu = u + du * o, vv = vc + dv * o;
      const x = (uu + vv) * SQ, z = (uu - vv) * SQ;
      P.push(x, WATER_Y, z); UV.push(acc, o); D.push(WATER_Y - heightAt(x, z)); F.push(0.55);
    }
    if (rows > 0) {
      const b = (rows - 1) * (across + 1);
      for (let k = 0; k < across; k++) { const a = b + k, c = a + across + 1; I.push(a, c, a + 1, a + 1, c, c + 1); }
    }
    rows++;
    acc += uStep * l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(D, 1));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = 'river'; m.matrixAutoUpdate = false; m.renderOrder = 1;
  return m;
}
function buildPaddyWater(mat) {
  const P = [], UV = [], D = [], F = [], I = [];
  const pt = { x: 0, z: 0 };
  for (let k = 0; k < PROWS; k++) {
    const j0 = padCol(k, PU0), j1 = padCol(k, PU1 - 1e-3);
    for (let j = j0; j <= j1; j++) {
      const lv = padLevel(k, j);
      const u0 = Math.max(PU0 - rowOff(k) + j * COLW, PU0), u1 = Math.min(PU0 - rowOff(k) + (j + 1) * COLW, PU1);
      const w0 = PV0 + k * ROWH, w1 = w0 + ROWH;
      const nu = Math.max(1, Math.ceil((u1 - u0) / 2)), nw = Math.max(1, Math.ceil((w1 - w0) / 2));
      const base = P.length / 3;
      for (let b = 0; b <= nw; b++) for (let a = 0; a <= nu; a++) {
        const u = lerp(u0, u1, a / nu), vw = lerp(w0, w1, b / nw);
        uvToXZ(u, vw + padWob(u), pt);
        P.push(pt.x, lv, pt.z); UV.push(u, vw); D.push(0.35); F.push(0);
      }
      for (let b = 0; b < nw; b++) for (let a = 0; a < nu; a++) {
        const i0 = base + b * (nu + 1) + a, i1 = i0 + 1, i2 = i0 + nu + 1, i3 = i2 + 1;
        // (u, v) -> (x, z) is a mirror map, so this winding faces up
        I.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(D, 1));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = 'paddyWater'; m.matrixAutoUpdate = false; m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------------------
// Sky dome (drawn at the far plane, follows the camera)
// ---------------------------------------------------------------------------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99999;
}
`;
const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uSunCol;
uniform float uTime;
uniform float uFogMix;
uniform float uDisc;
uniform float uGroundMix;
uniform vec3 uGround;
uniform vec3 uTreeLine;
uniform vec3 fogColor;
varying vec3 vDir;
${NOISE_GLSL}
float cfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uHor, uZen, pow(smoothstep(-0.05, 0.62, h), 0.75));
  col += uSunCol * (pow(sd, 5.0) * 0.22 + pow(sd, 42.0) * 0.55);
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.16) * 1.25 + vec2(uTime * 0.0035, uTime * 0.0012);
    float c = cfbm(cp * 1.4);
    float cov = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.2, h);
    float thick = smoothstep(0.5, 0.9, c);
    vec3 lit = vec3(1.0, 0.9, 0.78) * (1.2 + 1.4 * pow(sd, 3.0));
    vec3 ccol = mix(lit, uHor * 0.75, thick * 0.6);
    col = mix(col, ccol, cov * 0.88);
  }
  col += uSunCol * smoothstep(0.99935, 0.99968, sd) * 22.0 * uDisc;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float hz = 1.0 - smoothstep(-0.02, 0.3, h);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(hz, uFogMix));
  if (uGroundMix > 0.0) {
    // environment-map only: a ragged forest skyline and dim ground below the horizon
    float az = atan(d.z, d.x);
    float tl = 0.09 + 0.05 * sin(az * 5.0 + 1.3) + 0.03 * sin(az * 13.0 + 0.4) + 0.02 * vnoise(vec2(az * 9.0, 2.0));
    vec3 tree = uTreeLine * (1.0 + 0.8 * pow(sd, 2.0));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, tree, smoothstep(tl + 0.03, tl - 0.03, h) * uGroundMix);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uGround, smoothstep(0.0, -0.35, h) * uGroundMix);
  }
}
`;
function buildSky() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uSunDir: { value: SUN_DIR.clone() }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uTime: { value: 0 }, uFogMix: { value: 0 },
    uDisc: { value: 1 }, uGroundMix: { value: 0 }, uGround: { value: new THREE.Color() }, uTreeLine: { value: new THREE.Color() },
  }]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: true });
  const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  // Drawn after all opaque geometry (it sits on the far plane), so early-z rejects every
  // pixel already covered by canopy, terrain or foliage; transparents still come after it.
  m.frustumCulled = false; m.renderOrder = 1000; m.name = 'sky';
  return m;
}

// Image-based light: the sky dome (with a forest skyline and dim ground) rendered once into a
// PMREM cube for scene.environment. Returns the texture or null.
function buildEnvironment(renderer, sky, fogCol) {
  if (!renderer || typeof THREE.PMREMGenerator !== 'function') return null;
  let pm = null, mat = null, geo = null;
  try {
    mat = sky.material.clone();
    mat.fog = false;
    mat.depthTest = false;
    const u = mat.uniforms;
    u.fogColor.value.copy(fogCol);
    u.uFogMix.value = 0;
    u.uDisc.value = 0.12;
    u.uGroundMix.value = 1;
    u.uGround.value.setRGB(0.028, 0.03, 0.016);
    u.uTreeLine.value.setRGB(0.055, 0.075, 0.032);
    geo = new THREE.SphereGeometry(100, 48, 24);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const envScene = new THREE.Scene();
    envScene.add(mesh);
    pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(envScene, 0.035, 0.1, 1000);
    rt.texture.name = 'skyEnvironment';
    return rt.texture;
  } catch (e) {
    console.warn('[world] environment map unavailable', e);
    return null;
  } finally {
    pm?.dispose();
    mat?.dispose();
    geo?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Structures: static geometry merged per material
// ---------------------------------------------------------------------------
const BATCH_MESHES = [];
class Batch {
  constructor() { this.parts = new Map(); }
  add(key, geo, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m) g.applyMatrix4(m);
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, list = []);
    list.push(g);
    if (geo !== g && !geo.userData.keep) geo.dispose();
  }
  build(mats, group, opt = {}) {
    const out = [];
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      // baked AO goes into the colour attribute (white until bakeStructureAO runs)
      merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(merged.attributes.position.count * 3).fill(1), 3));
      const mesh = new THREE.Mesh(merged, mats[key]?.userData?.ao || mats[key]);
      BATCH_MESHES.push(mesh);
      mesh.castShadow = opt.shadow !== false && key !== 'dark' && key !== 'paint';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = (opt.name || 'struct') + ':' + key;
      group.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

const _mt = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _et = new THREE.Euler(), _vt = new THREE.Vector3(), _st = new THREE.Vector3();
function TM(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_vt.set(x, y, z), _qt.setFromEuler(_et.set(rx, ry, rz, 'YXZ')), _st.set(sx, sy, sz));
}
// Box with UVs in metres (divided by tile size us x vs).
function bx(w, h, d, us = 1, vs = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / us, uv.getY(k) * dims[f][1] / vs);
  }
  return g;
}
function cyl(r0, r1, h, seg = 10, open = false) { return new THREE.CylinderGeometry(r0, r1, h, seg, 1, open); }
// Beam (box) between two points.
function beamM(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  const m = new THREE.Matrix4();
  const up = Math.abs(dy) / len > 0.98 ? _st.set(1, 0, 0) : _st.set(0, 1, 0);
  m.lookAt(a, b, up);
  m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return { m, len };
}
function beam(B, key, a, b, t, t2 = t) {
  const { m, len } = beamM(a, b);
  B.add(key, bx(t, t2, len, 0.5, 1), m);
}
// Local-to-world helper for a structure placed at (x, y, z) with yaw.
function frame(x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    x, y, z, yaw,
    p(lx, ly, lz) { return new THREE.Vector3(x + lx * c + lz * s, y + ly, z - lx * s + lz * c); },
    m(lx, ly, lz, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      return TM(x + lx * c + lz * s, y + ly, z - lx * s + lz * c, yaw + ry, rx, rz, sx, sy, sz);
    },
  };
}

function structureMaterials(ST) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    sandbag: std({ map: ST.sandbag, roughness: 1, metalness: 0 }),
    wood: std({ map: ST.wood, roughness: 0.9, metalness: 0 }),
    timber: std({ map: ST.wood, color: 0x8a7a66, roughness: 0.92, metalness: 0 }),
    canvas: std({ map: ST.canvas, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    metal: std({ map: ST.metal, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
    psp: std({ map: ST.psp, roughness: 0.65, metalness: 0.5 }),
    thatch: std({ map: ST.thatch, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    weave: std({ map: ST.weave, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    crate: std({ map: ST.crate, roughness: 0.85, metalness: 0 }),
    tarp: std({ map: ST.tarp, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }),
    clay: std({ map: ST.clay, roughness: 0.85, metalness: 0 }),
    steel: std({ color: 0x4b5034, roughness: 0.55, metalness: 0.35 }),
    drum: std({ color: 0x485030, roughness: 0.6, metalness: 0.3 }),
    rubber: std({ color: 0x151515, roughness: 0.9, metalness: 0 }),
    dark: std({ color: 0x080706, roughness: 1, metalness: 0 }),
    paint: std({ color: 0xcfcbb8, roughness: 0.8, metalness: 0 }),
    brass: std({ color: 0xa8843a, roughness: 0.35, metalness: 0.85 }),
    sock: std({ color: 0xc0602a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    stone: std({ color: 0x6d665a, roughness: 0.95, metalness: 0 }),
    lamp: std({ color: 0x222018, emissive: 0xffe2a8, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.2 }),
    char: std({ color: 0x1a1612, roughness: 1, metalness: 0 }),
  };
  const N = ST.n || {}, R = ST.r || {};
  const nmap = { sandbag: 'sandbag', wood: 'wood', timber: 'wood', canvas: 'canvas', thatch: 'thatch', weave: 'weave', crate: 'crate', tarp: 'tarp', clay: 'clay', metal: 'metal', psp: 'psp' };
  for (const key in nmap) {
    const m = M[key], k = nmap[key];
    if (N[k]) { m.normalMap = N[k]; m.normalScale.set(0.9, 0.9); }
    if (R[k]) { m.roughnessMap = R[k]; m.roughness = 1; if (k === 'metal' || k === 'psp') { m.metalnessMap = R[k]; } }
  }
  M.sandbag.normalScale.set(1.2, 1.2);
  M.thatch.normalScale.set(1.3, 1.3);
  // every structure reads the bake (canopy over the camp, hollows); batched meshes use a
  // variant whose vertex colour is their baked AO
  for (const key in M) {
    const m = M[key];
    m.userData.ao = bakePatch(m.clone(), { vertexAO: true });
    bakePatch(m);
  }
  return M;
}

// Bake vertex AO into every batched structure mesh, one voxel grid per site.
function bakeStructureAO(group) {
  group.updateMatrixWorld(true);
  const sites = new Map();
  for (const m of BATCH_MESHES) {
    if (!m.geometry?.attributes?.position) continue;
    let root = m;
    while (root.parent && root.parent !== group) root = root.parent;
    // the wreck replaces the dump: it must not be occluded by the crates it stands in for
    const key = m.name.startsWith('wreck') ? 'wreck' : (root.name || 'site');
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push({ geometry: m.geometry, matrix: m.matrixWorld });
  }
  const out = {};
  for (const [key, items] of sites) {
    // geometry is in group space already for most sites; matrixWorld covers offset groups (dump)
    out[key] = bakeVertexAO(items, { voxel: 0.17, maxDist: 1.7, strength: 1.05, terrain: true, budget: 2.2e7 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
function buildFirebase(M, ST, group) {
  const B = new Batch();
  const H = FB_H;
  const W = (lx, lz) => [FBX + lx, FBZ + lz];
  const info = { bunkers: [], guardPosts: [], gunPits: [] };

  // --- perimeter berm of sandbags with a gate gap
  const wr = FBL.wallR;
  const segLen = 1.62, nSeg = Math.round((TAU * wr) / segLen);
  for (let i = 0; i < nSeg; i++) {
    const th = (i + 0.5) / nSeg * TAU;
    if (inGate(th, 3.2, wr)) continue;
    const x = FBX + Math.cos(th) * wr, z = FBZ + Math.sin(th) * wr, h = heightAt(x, z);
    const ry = Math.atan2(-Math.cos(th), -Math.sin(th));
    const jit = hash2(i, 3) - 0.5;
    B.add('sandbag', bx(segLen + 0.12, 1.05, 1.2, 2.4, 0.6), TM(x, h + 0.5, z, ry + jit * 0.04));
    B.add('sandbag', bx(segLen - 0.05, 0.42, 0.85, 2.4, 0.6), TM(x + Math.cos(th) * 0.12, h + 1.24 + jit * 0.04, z + Math.sin(th) * 0.12, ry + jit * 0.08));
    addBox(x, h + 0.72, z, segLen * 0.5 + 0.05, 0.74, 0.6, ry, 'sandbag');
  }
  // guard positions just inside the wall
  for (let i = 0; i < 12; i++) {
    const th = FBL.gateAngle + 0.26 + (i / 12) * (TAU - 0.52);
    info.guardPosts.push(new THREE.Vector3(FBX + Math.cos(th) * (wr - 1.6), H, FBZ + Math.sin(th) * (wr - 1.6)));
  }
  // gate posts + raised barrier
  {
    const th = FBL.gateAngle, gx = FBX + Math.cos(th) * (wr + 0.4), gz = FBZ + Math.sin(th) * (wr + 0.4);
    const tx = -Math.sin(th), tz = Math.cos(th);
    for (const s of [-1, 1]) {
      const px = gx + tx * 3.3 * s, pz = gz + tz * 3.3 * s;
      B.add('timber', bx(0.25, 2.4, 0.25), TM(px, H + 1.2, pz));
      addCyl(px, pz, 0.2, H, H + 2.4, 'wood');
    }
    const a = new THREE.Vector3(gx - tx * 3.3, H + 1.6, gz - tz * 3.3);
    const b = new THREE.Vector3(gx - tx * 1.0, H + 6.2, gz - tz * 1.0);
    beam(B, 'paint', a, b, 0.12);
  }

  // --- bunkers on the perimeter
  for (const deg of FBL.bunkers) {
    const th = deg * Math.PI / 180;
    const x = FBX + Math.cos(th) * 27.4, z = FBZ + Math.sin(th) * 27.4, h = heightAt(x, z);
    const yaw = Math.atan2(Math.cos(th), Math.sin(th));
    const F = frame(x, h, z, yaw), w = 3.8, d = 3.6;
    B.add('sandbag', bx(w, 1.5, d, 2.4, 0.6), F.m(0, 0.75, 0));
    B.add('timber', bx(w + 0.5, 0.22, d + 0.5, 1, 1), F.m(0, 1.61, 0));
    B.add('sandbag', bx(w + 0.1, 0.5, d + 0.1, 2.4, 0.6), F.m(0, 1.97, 0));
    B.add('sandbag', bx(w * 0.8, 0.3, d * 0.8, 2.4, 0.6), F.m(0, 2.36, 0, 0.05));
    B.add('dark', bx(w * 0.62, 0.24, 0.08), F.m(0, 1.12, d / 2 + 0.01));
    B.add('dark', bx(0.9, 1.25, 0.08), F.m(0.6, 0.63, -d / 2 - 0.01));
    B.add('metal', bx(w + 0.7, 0.04, 1.2, 1, 1), F.m(0, 1.72, d / 2 + 0.6, 0, 0.15));
    addBox(x, h + 1.25, z, w / 2 + 0.05, 1.25, d / 2 + 0.05, yaw, 'sandbag');
    info.bunkers.push(new THREE.Vector3(x, h, z));
  }

  // --- tactical operations centre
  {
    const [x, z] = W(FBL.toc[0], FBL.toc[1]), h = heightAt(x, z);
    B.add('sandbag', bx(7, 2.0, 5, 2.4, 0.6), TM(x, h + 1.0, z));
    B.add('timber', bx(7.6, 0.25, 5.6), TM(x, h + 2.12, z));
    B.add('sandbag', bx(7.2, 0.55, 5.2, 2.4, 0.6), TM(x, h + 2.52, z));
    B.add('dark', bx(1.0, 1.6, 0.08), TM(x + 1.5, h + 0.8, z + 2.51));
    B.add('sandbag', bx(2.6, 1.3, 0.8, 2.4, 0.6), TM(x + 1.5, h + 0.65, z + 3.6));
    for (const [ax, az, ht] of [[-3.1, -2.1, 9], [2.9, -2.0, 7]]) {
      B.add('steel', cyl(0.05, 0.07, ht, 6), TM(x + ax, h + 2.6 + ht / 2, z + az));
      B.add('steel', bx(1.2, 0.04, 0.04), TM(x + ax, h + 2.6 + ht - 0.4, z + az));
    }
    addBox(x, h + 1.4, z, 3.6, 1.4, 2.6, 0, 'sandbag');
  }

  // --- GP medium tents with sandbag skirts
  for (const [lx, lz, alongX] of FBL.tents) {
    const [x, z] = W(lx, lz), h = heightAt(x, z);
    const yaw = alongX ? 0 : Math.PI / 2;
    const F = frame(x, h, z, yaw), L = 8, hw = 2.3, eave = 1.5, ridge = 3.1;
    const run = hw + 0.15, rise = ridge - eave + 0.1, a = Math.atan2(rise, run), rl = Math.hypot(run, rise);
    for (const s of [-1, 1]) {
      B.add('canvas', bx(L + 0.4, 0.04, rl + 0.1, 2, 2), F.m(0, (eave + ridge) / 2, s * run / 2, 0, s * a));
      B.add('canvas', bx(L, eave, 0.04, 2, 2), F.m(0, eave / 2, s * hw));
      B.add('sandbag', bx(L + 0.6, 0.55, 0.6, 2.4, 0.6), F.m(0, 0.27, s * (hw + 0.45)));
    }
    const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(hw, eave), new THREE.Vector2(0, ridge), new THREE.Vector2(-hw, eave)]);
    const sg = new THREE.ShapeGeometry(shape);
    sg.userData.keep = true;
    for (const s of [-1, 1]) B.add('canvas', sg, F.m(s * L / 2, 0, 0, Math.PI / 2));
    sg.dispose();
    B.add('dark', bx(0.05, 1.7, 1.1), F.m(L / 2 + 0.03, 0.85, 0));
    addBox(x, h + 1.55, z, alongX ? L / 2 : hw + 0.7, 1.55, alongX ? hw + 0.7 : L / 2, 0, 'canvas');
  }

  // --- 105 mm howitzers in sandbag pits
  for (const [lx, lz] of FBL.guns) {
    const [x, z] = W(lx, lz), h = heightAt(x, z);
    const out = Math.atan2(lx, lz);
    const nb = 13, pr = 4.3;
    for (let i = 0; i < nb; i++) {
      const th = (i + 0.5) / nb * TAU;
      const px = x + Math.cos(th) * pr, pz = z + Math.sin(th) * pr;
      const toC = Math.atan2(FBX - x, FBZ - z);
      const dirAng = Math.atan2(Math.cos(th), Math.sin(th));
      if (Math.abs(((dirAng - toC + Math.PI * 3) % TAU) - Math.PI) < 0.35) continue;
      const ry = Math.atan2(-Math.cos(th), -Math.sin(th));
      B.add('sandbag', bx(2.15, 0.95, 0.95, 2.4, 0.6), TM(px, h + 0.47, pz, ry));
      addBox(px, h + 0.48, pz, 1.05, 0.48, 0.48, ry, 'sandbag');
    }
    const F = frame(x, h, z, out);
    for (const s of [-1, 1]) {
      B.add('rubber', cyl(0.55, 0.55, 0.24, 14).rotateZ(Math.PI / 2), F.m(s * 1.0, 0.55, 0));
      B.add('steel', cyl(0.2, 0.2, 0.28, 8).rotateZ(Math.PI / 2), F.m(s * 1.02, 0.55, 0));
      beam(B, 'steel', F.p(s * 0.32, 0.55, -0.1), F.p(s * 1.0, 0.07, -2.9), 0.17, 0.15);
    }
    B.add('steel', bx(2.0, 0.2, 0.4), F.m(0, 0.62, 0));
    B.add('steel', bx(2.1, 1.1, 0.06), F.m(0, 1.12, 0.35, 0, -0.12));
    B.add('steel', bx(0.42, 0.38, 1.3), F.m(0, 1.0, 0.45, 0, -0.14));
    B.add('steel', cyl(0.065, 0.075, 2.7, 10).rotateX(Math.PI / 2), F.m(0, 1.3, 1.65, 0, -0.14));
    B.add('steel', cyl(0.095, 0.095, 1.5, 10).rotateX(Math.PI / 2), F.m(0, 1.08, 1.0, 0, -0.14));
    B.add('steel', cyl(0.1, 0.1, 0.18, 10).rotateX(Math.PI / 2), F.m(0, 1.68, 2.95, 0, -0.14));
    for (let i = 0; i < 4; i++) B.add('crate', bx(0.8, 0.32, 0.5), F.m(-2.3 + (i % 2) * 0.85, 0.16 + Math.floor(i / 2) * 0.33, -1.4, 0.1 * i));
    for (let i = 0; i < 7; i++) B.add('brass', cyl(0.06, 0.06, 0.45, 8).rotateZ(Math.PI / 2), F.m(1.8 + hash2(i, 1) * 1.2, 0.06, -1.6 + hash2(i, 2) * 2, hash2(i, 3) * 3));
    addBox(x, h + 0.75, z, 1.2, 0.75, 1.4, out, 'metal', true);
    info.gunPits.push(new THREE.Vector3(x, h, z));
  }

  // --- helipad (PSP with painted H, marker tyres, windsock)
  {
    const [x, z] = W(FBL.helipad[0], FBL.helipad[1]), h = heightAt(x, z);
    const pad = cyl(7, 7.1, 0.1, 40);
    const uv = pad.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
    B.add('psp', pad, TM(x, h + 0.04, z));
    B.add('paint', bx(0.5, 0.02, 4.2), TM(x - 1.3, h + 0.1, z));
    B.add('paint', bx(0.5, 0.02, 4.2), TM(x + 1.3, h + 0.1, z));
    B.add('paint', bx(2.1, 0.02, 0.5), TM(x, h + 0.1, z));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      B.add('rubber', new THREE.TorusGeometry(0.36, 0.13, 6, 12).rotateX(Math.PI / 2), TM(x + Math.cos(a) * 7.6, h + 0.08, z + Math.sin(a) * 7.6));
    }
    const sx = x + 9, sz = z - 1, sh = heightAt(sx, sz);
    B.add('steel', cyl(0.05, 0.06, 6, 6), TM(sx, sh + 3, sz));
    B.add('sock', new THREE.ConeGeometry(0.38, 1.9, 10, 1, true).rotateZ(Math.PI / 2), TM(sx + 0.9, sh + 5.8, sz, 0.6, 0, 0.12));
    addCyl(sx, sz, 0.1, sh, sh + 6, 'metal');
    info.helipad = new THREE.Vector3(x, h, z);
  }

  // --- watchtower
  {
    const [x, z] = W(FBL.tower[0], FBL.tower[1]), h = heightAt(x, z);
    const top = 9.2, bs = 1.7, ts = 1.35;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cx, cz] of corners) {
      beam(B, 'timber', new THREE.Vector3(x + cx * bs, h - 0.3, z + cz * bs), new THREE.Vector3(x + cx * ts, h + top, z + cz * ts), 0.24);
      addCyl(x + cx * bs, z + cz * bs, 0.2, h - 0.3, h + top, 'wood');
    }
    for (let s = 0; s < 4; s++) {
      const c0 = corners[s], c1 = corners[(s + 1) % 4];
      for (const [y0, y1] of [[0.6, 4.6], [4.6, 8.6]]) {
        const r0 = lerp(bs, ts, y0 / top), r1 = lerp(bs, ts, y1 / top);
        beam(B, 'timber', new THREE.Vector3(x + c0[0] * r0, h + y0, z + c0[1] * r0), new THREE.Vector3(x + c1[0] * r1, h + y1, z + c1[1] * r1), 0.11);
        beam(B, 'timber', new THREE.Vector3(x + c1[0] * r0, h + y0, z + c1[1] * r0), new THREE.Vector3(x + c0[0] * r1, h + y1, z + c0[1] * r1), 0.11);
      }
    }
    B.add('wood', bx(3.6, 0.2, 3.6), TM(x, h + top, z));
    for (let s = 0; s < 4; s++) {
      const a = s * Math.PI / 2;
      B.add('sandbag', bx(3.6, 0.95, 0.38, 2.4, 0.6), TM(x + Math.sin(a) * 1.62, h + top + 0.57, z + Math.cos(a) * 1.62, a));
      addBox(x + Math.sin(a) * 1.62, h + top + 0.57, z + Math.cos(a) * 1.62, 1.8, 0.48, 0.19, a, 'sandbag', false);
    }
    for (const [cx, cz] of corners) B.add('timber', bx(0.1, 2.0, 0.1), TM(x + cx * 1.6, h + top + 1.1, z + cz * 1.6));
    B.add('metal', bx(4.3, 0.05, 4.3, 1, 1), TM(x, h + top + 2.15, z, 0, 0.06));
    for (let i = 0; i < 12; i++) {
      const y = 0.5 + i * 0.74;
      B.add('timber', bx(0.06, 0.06, 0.6), TM(x + lerp(2.05, 1.85, y / top), h + y, z));
    }
    beam(B, 'timber', new THREE.Vector3(x + 2.1, h - 0.2, z - 0.32), new THREE.Vector3(x + 1.82, h + top, z - 0.32), 0.08);
    beam(B, 'timber', new THREE.Vector3(x + 2.1, h - 0.2, z + 0.32), new THREE.Vector3(x + 1.82, h + top, z + 0.32), 0.08);
    const lx = x - 1.4, lz = z - 1.4;
    B.add('steel', cyl(0.27, 0.22, 0.5, 12).rotateX(Math.PI / 2), TM(lx, h + top + 1.35, lz, -Math.PI * 0.75, -0.15));
    B.add('lamp', new THREE.CircleGeometry(0.24, 12), TM(lx - 0.18, h + top + 1.38, lz - 0.18, -Math.PI * 0.75, -0.15));
    B.add('steel', cyl(0.04, 0.04, 1.1, 6), TM(lx, h + top + 0.65, lz));
    addBox(x, h + top, z, 1.8, 0.12, 1.8, 0, 'wood', false);
    info.towerTop = new THREE.Vector3(x, h + top + 1.6, z);
    info.searchlight = new THREE.Vector3(lx, h + top + 1.35, lz);
  }

  // --- fuel drums, water trailer, jeep, crates
  {
    const [x, z] = W(FBL.drums[0], FBL.drums[1]);
    for (let i = 0; i < 14; i++) {
      const px = x + (i % 4) * 0.66 + (Math.floor(i / 4) % 2) * 0.3, pz = z + Math.floor(i / 4) * 0.66, h = heightAt(px, pz);
      if (i === 13) {
        B.add('drum', cyl(0.29, 0.29, 0.88, 12).rotateZ(Math.PI / 2), TM(px + 1.6, h + 0.29, pz - 1.2, 0.7));
        addCyl(px + 1.6, pz - 1.2, 0.45, h, h + 0.6, 'metal');
        continue;
      }
      B.add('drum', cyl(0.29, 0.29, 0.88, 12), TM(px, h + 0.44, pz, hash2(i, 7) * 3));
      B.add('dark', cyl(0.295, 0.295, 0.04, 12), TM(px, h + 0.62, pz));
      addCyl(px, pz, 0.3, h, h + 0.9, 'metal');
    }
  }
  {
    const [x, z] = W(FBL.trailer[0], FBL.trailer[1]), h = heightAt(x, z);
    B.add('drum', cyl(0.6, 0.6, 2.4, 14).rotateZ(Math.PI / 2), TM(x, h + 1.1, z));
    for (const s of [-1, 1]) B.add('rubber', cyl(0.38, 0.38, 0.2, 12).rotateX(Math.PI / 2), TM(x, h + 0.38, z + s * 0.72));
    beam(B, 'steel', new THREE.Vector3(x + 1.1, h + 0.5, z), new THREE.Vector3(x + 2.6, h + 0.35, z), 0.08);
    addBox(x, h + 0.85, z, 1.25, 0.85, 0.65, 0, 'metal');
  }
  {
    const x = FBX - 4.5, z = FBZ + 20, h = heightAt(x, z);
    const F = frame(x, h, z, 0.05);
    B.add('drum', bx(1.55, 0.55, 3.3), F.m(0, 0.82, 0));
    B.add('drum', bx(1.5, 0.35, 1.1), F.m(0, 1.25, 0.95));
    B.add('steel', bx(1.45, 0.05, 0.5), F.m(0, 1.6, 0.25, 0, -0.25));
    B.add('dark', bx(1.3, 0.25, 0.8), F.m(0, 1.12, -0.25));
    for (const [sx2, sz2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.add('rubber', cyl(0.36, 0.36, 0.24, 12).rotateZ(Math.PI / 2), F.m(sx2 * 0.78, 0.36, sz2 * 1.1));
    addBox(x, h + 0.8, z, 0.85, 0.8, 1.7, 0, 'metal');
  }
  for (const [lx, lz, n] of [[-12.5, -6.8, 5], [17, 9, 3], [-2, -24, 4]]) {
    const [x, z] = W(lx, lz), h = heightAt(x, z);
    for (let i = 0; i < n; i++) B.add('crate', bx(0.9, 0.5, 0.6), TM(x + (i % 3) * 0.95, h + 0.25 + Math.floor(i / 3) * 0.5, z, (hash2(i, n) - 0.5) * 0.2));
    addBox(x + 0.95, h + 0.5, z, 1.45, 0.5, 0.4, 0, 'wood');
  }

  // --- ammo dump revetment (sandbags, part of the static base)
  const [dx, dz] = [WORLD.ammoDump.x, WORLD.ammoDump.z], dh = heightAt(dx, dz);
  B.add('sandbag', bx(7.4, 1.4, 0.9, 2.4, 0.6), TM(dx + 0.4, dh + 0.7, dz - 2.9));
  B.add('sandbag', bx(7.4, 1.4, 0.9, 2.4, 0.6), TM(dx + 0.4, dh + 0.7, dz + 2.9));
  B.add('sandbag', bx(0.9, 1.4, 5.0, 2.4, 0.6), TM(dx + 3.65, dh + 0.7, dz));
  addBox(dx + 0.4, dh + 0.7, dz - 2.9, 3.7, 0.7, 0.45, 0, 'sandbag');
  addBox(dx + 0.4, dh + 0.7, dz + 2.9, 3.7, 0.7, 0.45, 0, 'sandbag');
  addBox(dx + 3.65, dh + 0.7, dz, 0.45, 0.7, 2.5, 0, 'sandbag');

  // --- concertina wire: positions first, so the steel pickets go into the static batch
  const wirePos = [];
  for (const r of FBL.wireR) {
    const n = Math.round((TAU * r) / 1.9);
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5) / n * TAU;
      if (inGate(th, 3.6, r)) continue;
      wirePos.push([FBX + Math.cos(th) * r, FBZ + Math.sin(th) * r, Math.atan2(-Math.cos(th), -Math.sin(th))]);
    }
  }
  wirePos.forEach(([x, z, ry], i) => {
    const h = heightAt(x, z);
    // U-section picket at the coil joint, leaning a touch
    const px = x + Math.cos(ry) * 0.95, pz = z - Math.sin(ry) * 0.95;
    B.add('steel', bx(0.045, 1.55, 0.03), TM(px, heightAt(px, pz) + 0.55, pz, ry + 0.4, (hash2(i, 11) - 0.5) * 0.12, (hash2(i, 12) - 0.5) * 0.12));
    for (let k = -1; k <= 1; k++) colliders.push({ x: x + Math.cos(ry) * k * 0.65, z: z - Math.sin(ry) * k * 0.65, r: 0.62 });
    wirePos[i].push(h);
  });

  const meshes = B.build(M, group, { name: 'firebase' });

  // Razor wire as real strands: three stacked helical coils per 1.9 m bay, drawn as 1 px
  // lines (a 2-3 mm wire is sub-pixel beyond a couple of metres anyway). Barbs are small
  // kinks along the strand; shading is baked per vertex (top of each loop catches the sky).
  {
    const wrng = rand(87);
    const P = [], Cc = [], I = [];
    const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
    const coils = [[0.45, -0.46, 0.46], [0.45, 0.46, 0.46], [1.18, 0, 0.44]];
    const SEG = 18;
    for (let w = 0; w < wirePos.length; w++) {
      const [x, z, ry, h] = wirePos[w];
      _m.copy(TM(x, h, z, ry + (hash2(w, 5) - 0.5) * 0.05));
      for (let c = 0; c < coils.length; c++) {
        const [cy, cz, rr] = coils[c];
        const pitch = 0.2 + wrng() * 0.05, len = 1.96;
        const turns = len / pitch, steps = Math.ceil(turns * SEG);
        const ph = wrng() * TAU, sag = 0.03 + wrng() * 0.05;
        const base = P.length / 3;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, ang = ph + t * turns * TAU;
          const loopJ = 1 + 0.07 * Math.sin(Math.floor(t * turns) * 2.3 + c * 1.7 + w);
          const barb = (k % 3 === 1) ? 0.022 : 0;
          const r = rr * loopJ + barb;
          const lx = -len / 2 + t * len + (barb ? 0.012 : 0);
          const ly = cy + Math.sin(ang) * r * 0.97 - sag * Math.sin(t * Math.PI);
          const lz = cz + Math.cos(ang) * r;
          _v.set(lx, ly, lz).applyMatrix4(_m);
          P.push(_v.x, _v.y, _v.z);
          // brightness: upper arc lit by the sky, underside in shade, odd glints
          const up = 0.5 + 0.5 * Math.sin(ang);
          let b = 0.26 + 0.4 * up + (wrng() < 0.05 ? 0.3 : 0);
          if (barb) b *= 1.15;
          Cc.push(b * 0.95, b * 0.97, b);
          if (k > 0) I.push(base + k - 1, base + k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    g.setIndex(new THREE.BufferAttribute(P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I), 1));
    g.computeBoundingSphere();
    const wireMat = new THREE.LineBasicMaterial({ color: 0x8d908a, vertexColors: true, fog: true });
    const wire = new THREE.LineSegments(g, wireMat);
    wire.name = 'firebase:wire'; wire.matrixAutoUpdate = false;
    group.add(wire);
    meshes.push(wire);
  }

  // --- ammo dump: crates under a tarp (dumpMesh), and the wreck shown after it blows
  const dump = new THREE.Group();
  dump.name = 'ammoDump';
  dump.position.set(dx, dh, dz);
  const DB = new Batch();
  let ci = 0;
  for (let ly = 0; ly < 3; ly++) {
    const nx = 4 - (ly === 2 ? 1 : 0), nz = 3 - (ly === 2 ? 1 : 0);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++, ci++) {
      if (ly === 1 && hash2(ix, iz + 9) < 0.15) continue;
      const x = (ix - (nx - 1) / 2) * 0.88 - 0.4, z = (iz - (nz - 1) / 2) * 0.66;
      DB.add('crate', bx(0.84, 0.54, 0.62), TM(x + (hash2(ci, 1) - 0.5) * 0.06, 0.27 + ly * 0.55, z, (hash2(ci, 2) - 0.5) * 0.12));
    }
  }
  for (let i = 0; i < 6; i++) DB.add('crate', bx(1.6, 0.36, 0.42), TM(1.7, 0.18 + Math.floor(i / 2) * 0.37, -0.4 + (i % 2) * 0.46, Math.PI / 2 + (hash2(i, 4) - 0.5) * 0.1));
  for (const [px, pz] of [[-2.4, -1.85], [2.4, -1.85], [2.4, 1.85], [-2.4, 1.85]]) DB.add('timber', bx(0.12, 2.0, 0.12), TM(px, 1.0, pz));
  DB.add('timber', bx(0.14, 2.75, 0.14), TM(-2.4, 1.37, 0)); DB.add('timber', bx(0.14, 2.75, 0.14), TM(2.4, 1.37, 0));
  DB.add('timber', bx(5.0, 0.1, 0.1), TM(0, 2.72, 0));
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(5.3, 2.25, 10, 4);
    const pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const u = pp.getX(i) / 2.65, v = pp.getY(i) / 1.125;
      pp.setZ(i, s * (-0.12 * (1 - u * u) * (1 - v * v) + 0.03 * Math.sin(u * 9 + v * 3)));
    }
    pg.computeVertexNormals();
    DB.add('tarp', pg, TM(0, 2.33, s * 1.0, 0, s * (0.37 - Math.PI / 2), 0));
  }
  DB.build(M, dump, { name: 'dump' });
  group.add(dump);
  const dumpSolid = addBox(dx - 0.3, dh + 1.0, dz, 2.0, 1.0, 1.45, 0, 'wood');

  const wreck = new THREE.Group();
  wreck.name = 'ammoDumpWreck';
  wreck.position.copy(dump.position);
  wreck.visible = false;
  const WB = new Batch();
  const wr2 = rand(555);
  for (let i = 0; i < 26; i++) {
    const a = wr2() * TAU, r = 0.5 + wr2() * 6;
    WB.add('char', bx(0.15 + wr2() * 0.7, 0.04 + wr2() * 0.08, 0.1 + wr2() * 0.25), TM(Math.cos(a) * r, 0.05, Math.sin(a) * r, wr2() * 3, (wr2() - 0.5) * 0.4, (wr2() - 0.5) * 0.4));
  }
  for (let i = 0; i < 5; i++) WB.add('char', bx(0.84, 0.3, 0.62), TM((wr2() - 0.5) * 2.5, 0.12, (wr2() - 0.5) * 2, wr2() * 3, 0.2, 0.1));
  WB.add('timber', bx(0.12, 1.4, 0.12), TM(-2.4, 0.7, -1.85, 0, 0.3));
  WB.add('timber', bx(0.12, 0.8, 0.12), TM(2.4, 0.4, 1.85));
  WB.build(M, wreck, { name: 'wreck' });
  const scorchTex = ctex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(8,6,4,0.95)'); gr.addColorStop(0.6, 'rgba(18,12,8,0.7)'); gr.addColorStop(1, 'rgba(20,14,8,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: scorchTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  scorch.position.y = 0.06;
  scorch.receiveShadow = true;
  wreck.add(scorch);
  group.add(wreck);

  info.dump = dump; info.wreck = wreck; info.dumpSolid = dumpSolid;
  return { meshes, info };
}

// ---------------------------------------------------------------------------
// VC camp: thatched huts on stilts, shelter, fire pit, props
// ---------------------------------------------------------------------------
function lathe(points, seg = 12) { return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

function buildCamp(M, group) {
  const B = new Batch();
  const info = { huts: [] };
  const rng = rand(777);
  for (const hut of HUTS) {
    const g0 = heightAt(hut.x, hut.z);
    const F = frame(hut.x, g0, hut.z, hut.rot);
    const w = hut.w, d = hut.d, fy = 1.25, wallH = 1.6;
    for (const px of [-w / 2 + 0.15, 0, w / 2 - 0.15]) for (const pz of [-d / 2 + 0.15, 0, d / 2 - 0.15]) {
      const p = F.p(px, 0, pz), gy = heightAt(p.x, p.z);
      const len = g0 + fy - gy + 0.35;
      B.add('timber', cyl(0.08, 0.09, len, 6), TM(p.x, gy - 0.3 + len / 2, p.z));
    }
    for (const pz of [-d / 2 + 0.15, d / 2 - 0.15]) B.add('timber', bx(w + 0.2, 0.14, 0.14), F.m(0, fy - 0.12, pz));
    B.add('wood', bx(w + 0.3, 0.1, d + 0.3, 1, 1), F.m(0, fy, 0));
    B.add('weave', bx(w, wallH, 0.05, 1, 1), F.m(0, fy + wallH / 2, -d / 2));
    for (const s of [-1, 1]) B.add('weave', bx(0.05, wallH, d, 1, 1), F.m(s * w / 2, fy + wallH / 2, 0));
    const door = 0.95, dc = 0.3, aw = (w / 2 + dc - door / 2), bw = (w / 2 - dc - door / 2);
    B.add('weave', bx(aw, wallH, 0.05, 1, 1), F.m(-w / 2 + aw / 2, fy + wallH / 2, d / 2));
    B.add('weave', bx(bw, wallH, 0.05, 1, 1), F.m(w / 2 - bw / 2, fy + wallH / 2, d / 2));
    B.add('weave', bx(door, 0.35, 0.05, 1, 1), F.m(dc, fy + wallH - 0.17, d / 2));
    B.add('dark', bx(door, wallH - 0.35, 0.02), F.m(dc, fy + (wallH - 0.35) / 2, d / 2 - 0.2));
    const ridgeY = fy + wallH + 1.25, eaveY = fy + wallH - 0.15, run = d / 2 + 0.75, rise = ridgeY - eaveY;
    const a = Math.atan2(rise, run), rl = Math.hypot(run, rise);
    for (const s of [-1, 1]) B.add('thatch', bx(w + 1.3, 0.24, rl + 0.15, 1.6, 0.8), F.m(0, (ridgeY + eaveY) / 2 + 0.1, s * run / 2, 0, s * a));
    B.add('thatch', cyl(0.2, 0.2, w + 1.4, 8).rotateZ(Math.PI / 2), F.m(0, ridgeY + 0.12, 0));
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, ridgeY - fy - wallH)]);
    const tg = new THREE.ShapeGeometry(tri); tg.userData.keep = true;
    for (const s of [-1, 1]) B.add('weave', tg, F.m(s * w / 2, fy + wallH, 0, Math.PI / 2));
    tg.dispose();
    // ladder to the door
    const l0 = F.p(dc - 0.28, 0, d / 2 + 1.1), l1 = F.p(dc + 0.28, 0, d / 2 + 1.1);
    const t0 = F.p(dc - 0.28, fy + 0.05, d / 2 + 0.2), t1 = F.p(dc + 0.28, fy + 0.05, d / 2 + 0.2);
    l0.y = heightAt(l0.x, l0.z); l1.y = heightAt(l1.x, l1.z);
    beam(B, 'timber', l0, t0, 0.07); beam(B, 'timber', l1, t1, 0.07);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      beam(B, 'timber', l0.clone().lerp(t0, t), l1.clone().lerp(t1, t), 0.05);
    }
    // props by the hut
    const jp = F.p(-w / 2 - 0.5, 0, d / 2 + 0.3);
    B.add('clay', lathe([[0.01, 0], [0.22, 0.05], [0.3, 0.3], [0.24, 0.55], [0.13, 0.62], [0.15, 0.68], [0.01, 0.68]]), TM(jp.x, heightAt(jp.x, jp.z) - 0.02, jp.z));
    addCyl(jp.x, jp.z, 0.3, heightAt(jp.x, jp.z), heightAt(jp.x, jp.z) + 0.68, 'stone');
    const totalH = ridgeY + 0.3;
    addBox(hut.x, g0 + totalH / 2, hut.z, w / 2 + 0.2, totalH / 2, d / 2 + 0.2, hut.rot, 'wood');
    info.huts.push({ x: hut.x, z: hut.z, y: g0, rot: hut.rot, w, d, door: F.p(dc, 0, d / 2 + 1.4) });
  }
  // open-sided shelter with table and benches
  {
    const S = CAMP_SHELTER, g0 = heightAt(S.x, S.z), F = frame(S.x, g0, S.z, S.rot);
    for (const [px, pz] of [[-1.7, -1.3], [1.7, -1.3], [1.7, 1.3], [-1.7, 1.3]]) {
      B.add('timber', cyl(0.07, 0.08, 2.5, 6), F.m(px, 1.15, pz));
      const p = F.p(px, 0, pz); addCyl(p.x, p.z, 0.1, g0, g0 + 2.4, 'wood');
    }
    const a = Math.atan2(0.9, 1.9), rl = Math.hypot(1.9, 0.9);
    for (const s of [-1, 1]) B.add('thatch', bx(4.2, 0.2, rl + 0.2, 1.6, 0.8), F.m(0, 2.75, s * 0.95, 0, s * a));
    B.add('wood', bx(2.2, 0.07, 0.9), F.m(0, 0.76, 0));
    for (const [px, pz] of [[-0.95, -0.35], [0.95, -0.35], [0.95, 0.35], [-0.95, 0.35]]) B.add('timber', bx(0.07, 0.74, 0.07), F.m(px, 0.37, pz));
    for (const s of [-1, 1]) B.add('timber', cyl(0.12, 0.12, 2.0, 7).rotateZ(Math.PI / 2), F.m(0, 0.32, s * 0.85));
    B.add('weave', bx(1.8, 0.02, 1.4), F.m(0, 0.02, 2.4, 0.3));
  }
  // fire pit
  {
    const P = CAMP_FIRE, g0 = heightAt(P.x, P.z);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const s = 0.16 + rng() * 0.08;
      B.add('stone', new THREE.DodecahedronGeometry(s), TM(P.x + Math.cos(a) * 0.55, g0 + s * 0.4, P.z + Math.sin(a) * 0.55, rng() * 3, rng(), rng(), 1, 0.7, 1));
    }
    B.add('char', cyl(0.45, 0.48, 0.05, 14), TM(P.x, g0 + 0.01, P.z));
    const top = new THREE.Vector3(P.x, g0 + 1.25, P.z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.3;
      beam(B, 'timber', new THREE.Vector3(P.x + Math.cos(a) * 0.75, g0 - 0.05, P.z + Math.sin(a) * 0.75), top, 0.05);
    }
    B.add('steel', lathe([[0.01, 0], [0.2, 0.02], [0.24, 0.15], [0.2, 0.3], [0.21, 0.32], [0.01, 0.32]], 10), TM(P.x, g0 + 0.42, P.z));
    B.add('timber', cyl(0.006, 0.006, 0.55, 3), TM(P.x, g0 + 0.98, P.z));
    for (let i = 0; i < 2; i++) B.add('timber', cyl(0.15, 0.15, 1.6, 7).rotateZ(Math.PI / 2), TM(P.x + (i ? 1.6 : -1.6), g0 + 0.15, P.z + 0.3, Math.PI / 2 + i * 0.4));
  }
  // woodpile, baskets, drying rack, rice mat
  {
    const h0 = HUTS[1], F = frame(h0.x, heightAt(h0.x, h0.z), h0.z, h0.rot);
    for (let i = 0; i < 14; i++) {
      const row = Math.floor(i / 5), k = i % 5;
      B.add('timber', cyl(0.07, 0.075, 1.0, 6).rotateZ(Math.PI / 2), F.m(0, 0.08 + row * 0.13, -h0.d / 2 - 0.55 + (k - 2) * 0.15 + row * 0.07));
    }
    const wp = F.p(0, 0, -h0.d / 2 - 0.55);
    addBox(wp.x, F.y + 0.3, wp.z, 0.55, 0.3, 0.45, h0.rot, 'wood');
    for (let i = 0; i < 3; i++) {
      const p = F.p(h0.w / 2 + 0.6, 0, -0.6 + i * 0.6), gy = heightAt(p.x, p.z);
      B.add('weave', cyl(0.26, 0.2, 0.38, 10, true), TM(p.x, gy + 0.19, p.z));
      B.add('weave', new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2), TM(p.x, gy + 0.02, p.z));
    }
    const h3 = HUTS[4], F3 = frame(h3.x, heightAt(h3.x, h3.z), h3.z, h3.rot);
    for (const s of [-1, 1]) {
      beam(B, 'timber', F3.p(s * 1.5, 0, h3.d / 2 + 2.6), F3.p(s * 1.5, 1.7, h3.d / 2 + 2.9), 0.06);
      beam(B, 'timber', F3.p(s * 1.5, 0, h3.d / 2 + 3.2), F3.p(s * 1.5, 1.7, h3.d / 2 + 2.9), 0.06);
    }
    beam(B, 'timber', F3.p(-1.6, 1.68, h3.d / 2 + 2.9), F3.p(1.6, 1.68, h3.d / 2 + 2.9), 0.05);
    for (let i = 0; i < 3; i++) B.add('canvas', bx(0.6, 0.9, 0.02), F3.m(-0.9 + i * 0.8, 1.2, h3.d / 2 + 2.9, 0, 0, (rng() - 0.5) * 0.1));
    const mp = F3.p(0, 0, h3.d / 2 + 5.2);
    B.add('weave', bx(2.2, 0.02, 1.6), TM(mp.x, heightAt(mp.x, mp.z) + 0.02, mp.z, h3.rot + 0.2));
  }
  const meshes = B.build(M, group, { name: 'camp' });
  info.center = new THREE.Vector3(CPX, heightAt(CPX, CPZ), CPZ);
  return { meshes, info };
}

// ---------------------------------------------------------------------------
// Ray queries: heightfield march + solids grid DDA (no triangle soup)
// ---------------------------------------------------------------------------
const SCELL = 8, SN = 64;
let solidGrid = null;
let rayStamp = 1;
const _rn = new THREE.Vector3();
let _hitSolid = null;

function buildSolidGrid() {
  solidGrid = new Array(SN * SN).fill(null);
  for (const s of solids) {
    const r = s.k === 0 ? s.r : Math.hypot(s.hx, s.hz);
    const i0 = clamp(Math.floor((s.x - r + HALF) / SCELL), 0, SN - 1), i1 = clamp(Math.floor((s.x + r + HALF) / SCELL), 0, SN - 1);
    const j0 = clamp(Math.floor((s.z - r + HALF) / SCELL), 0, SN - 1), j1 = clamp(Math.floor((s.z + r + HALF) / SCELL), 0, SN - 1);
    s.stamp = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * SN + i;
      (solidGrid[k] || (solidGrid[k] = [])).push(s);
    }
  }
}

function rayCyl(o, d, s, nOut) {
  const ox = o.x - s.x, oz = o.z - s.z;
  const a = d.x * d.x + d.z * d.z, c = ox * ox + oz * oz - s.r * s.r;
  let best = Infinity;
  if (c < 0 && o.y >= s.y0 && o.y <= s.y1) return Infinity; // starting inside
  if (a > 1e-10 && c >= 0) {
    const b = ox * d.x + oz * d.z, disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = o.y + d.y * t;
        if (y >= s.y0 && y <= s.y1) { best = t; nOut.set((ox + d.x * t) / s.r, 0, (oz + d.z * t) / s.r); }
      }
    }
  }
  if (d.y < -1e-6 && o.y > s.y1) {
    const t = (s.y1 - o.y) / d.y;
    if (t < best) {
      const x = ox + d.x * t, z = oz + d.z * t;
      if (x * x + z * z <= s.r * s.r) { best = t; nOut.set(0, 1, 0); }
    }
  }
  return best;
}
function rayBox(o, d, s, nOut) {
  const px = o.x - s.x, py = o.y - s.y, pz = o.z - s.z, c = s.c, sn = s.sn;
  const lo0 = px * c - pz * sn, lo1 = py, lo2 = px * sn + pz * c;
  const ld0 = d.x * c - d.z * sn, ld1 = d.y, ld2 = d.x * sn + d.z * c;
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  const lo = [lo0, lo1, lo2], ld = [ld0, ld1, ld2], hh = [s.hx, s.hy, s.hz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-9) { if (Math.abs(lo[a]) > hh[a]) return Infinity; continue; }
    let t1 = (-hh[a] - lo[a]) / ld[a], t2 = (hh[a] - lo[a]) / ld[a], sg = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (tmax < 0 || tmin < 0) return Infinity;
  const nx = axis === 0 ? sign : 0, ny = axis === 1 ? sign : 0, nz = axis === 2 ? sign : 0;
  nOut.set(nx * c + nz * sn, ny, -nx * sn + nz * c);
  return tmin;
}
const _nTmp = new THREE.Vector3();
function solidHitT(o, d, near, far) {
  _hitSolid = null;
  if (!solidGrid) return Infinity;
  rayStamp++;
  let ox = o.x, oz = o.z, t0 = 0;
  // clip to the grid square
  const lim = HALF - 0.001;
  if (Math.abs(ox) > lim || Math.abs(oz) > lim) {
    let tmin = 0, tmax = far;
    for (const [p, dd] of [[o.x, d.x], [o.z, d.z]]) {
      if (Math.abs(dd) < 1e-9) { if (Math.abs(p) > lim) return Infinity; continue; }
      let t1 = (-lim - p) / dd, t2 = (lim - p) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    }
    if (tmin > tmax) return Infinity;
    t0 = tmin; ox = o.x + d.x * t0; oz = o.z + d.z * t0;
  }
  const gx = (ox + HALF) / SCELL, gz = (oz + HALF) / SCELL;
  let ix = clamp(Math.floor(gx), 0, SN - 1), iz = clamp(Math.floor(gz), 0, SN - 1);
  const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const adx = Math.abs(d.x), adz = Math.abs(d.z);
  const tdx = adx > 1e-9 ? SCELL / adx : Infinity, tdz = adz > 1e-9 ? SCELL / adz : Infinity;
  let tmx = adx > 1e-9 ? t0 + ((sx > 0 ? ix + 1 - gx : gx - ix) * SCELL) / adx : Infinity;
  let tmz = adz > 1e-9 ? t0 + ((sz > 0 ? iz + 1 - gz : gz - iz) * SCELL) / adz : Infinity;
  let best = Infinity;
  for (let guard = 0; guard < 256; guard++) {
    const list = solidGrid[iz * SN + ix];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.stamp === rayStamp || !s.on) continue;
        s.stamp = rayStamp;
        const t = s.k === 0 ? rayCyl(o, d, s, _nTmp) : rayBox(o, d, s, _nTmp);
        if (t >= near && t <= far && t < best) { best = t; _hitSolid = s; _rn.copy(_nTmp); }
      }
    }
    const tn = Math.min(tmx, tmz);
    if (best <= tn || tn > far) break;
    if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
    if (ix < 0 || iz < 0 || ix >= SN || iz >= SN) break;
  }
  return best;
}
function terrainHitT(o, d, near, far) {
  let t = near;
  let above = o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
  if (above < 0) return Infinity;
  let prev = t;
  far = Math.min(far, 900);
  while (t < far) {
    t = Math.min(far, t + clamp(above * 0.5, 0.35, 8));
    above = o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
    if (above <= 0) {
      let a = prev, b = t;
      for (let i = 0; i < 9; i++) {
        const m = (a + b) * 0.5;
        if (o.y + d.y * m - heightAt(o.x + d.x * m, o.z + d.z * m) > 0) a = m; else b = m;
      }
      return b;
    }
    prev = t;
  }
  return Infinity;
}

const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
function makeProxy(name, surface, fn) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), proxyMat);
  m.name = name; m.userData.surface = surface; m.visible = false; m.matrixAutoUpdate = false; m.frustumCulled = false;
  m.raycast = fn;
  return m;
}
function makeHit(obj, t, o, d, normal, surface) {
  const point = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  const n = normal.clone();
  return { distance: t, point, normal: n, face: { a: 0, b: 0, c: 0, normal: n, materialIndex: 0 }, faceIndex: 0, object: obj, surface };
}

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------
export async function createWorld(ctx = {}) {
  const t0 = performance.now();
  const scene = ctx.scene || null, renderer = ctx.renderer || null;
  const events = ctx.events || sharedEvents;
  const progress = (t, label) => { try { events.emit?.('loadProgress', { t, label }); } catch (e) { /* */ } };
  const timings = {};
  let tMark = performance.now();
  const mark = (name) => { const n = performance.now(); timings[name] = Math.round(n - tMark); tMark = n; };
  let preset = PRESETS[ctx.quality] ? ctx.quality : 'high';
  const group = new THREE.Group();
  group.name = 'world';

  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (renderer.toneMapping === THREE.NoToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; }
  }

  // --- ground truth
  progress(0.02, 'Terrain');
  buildHeightGrid();
  const trails = buildTrails();
  planBlockers();
  mark('terrain');
  await yieldFrame();

  // --- structures (register colliders before vegetation)
  const ST = structureTextures();
  const SM = structureMaterials(ST);
  const fbGroup = new THREE.Group(); fbGroup.name = 'firebase';
  const campGroup = new THREE.Group(); campGroup.name = 'camp';
  const fb = buildFirebase(SM, ST, fbGroup);
  const camp = buildCamp(SM, campGroup);
  group.add(fbGroup, campGroup);
  mark('structures');
  progress(0.15, 'Jungle');
  await yieldFrame();

  // --- vegetation
  const V = placeVegetation();
  mark('vegetation');
  await yieldFrame();
  const atlas = buildAtlas();
  if (renderer) atlas.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() || 4);
  const atlasN = buildAtlasNormal(atlas);
  mark('atlas');
  progress(0.35, 'Light');
  await yieldFrame();

  // --- baked lighting: lightmap, per-instance foliage occlusion, structure AO
  BK.tBake.value = bakeLightmap(V);
  bakeVegInstances(V);
  mark('bakeLight');
  await yieldFrame();
  const aoStats = bakeStructureAO(group);
  mark('bakeAO');
  progress(0.6, 'Ground');
  await yieldFrame();

  // --- terrain
  const TT = terrainTextures();
  const splat = buildSplat();
  const terrainMat = makeTerrainMaterial(TT, splat);
  buildTerrainMeshes(terrainMat, group);
  group.add(buildBundMesh(terrainMat));
  await yieldFrame();

  // --- water
  const waterMat = makeWaterMaterial();
  group.add(buildRiverMesh(waterMat), buildPaddyWater(waterMat));

  // --- foliage
  const folGroup = new THREE.Group(); folGroup.name = 'foliage';
  const layers = buildFoliageLayers(V, atlas, folGroup, atlasN);
  group.add(folGroup);
  for (const l of layers) {
    l.spec = VEG_SPEC.find((s) => s.name === l.type.name);
    l.isFar = l.rMin > 0;
  }
  mark('foliage');

  // --- sky, fog, lights
  const sky = buildSky();
  const fogCol = new THREE.Color(0xa3ab97);
  const fog = new THREE.FogExp2(fogCol.clone(), FOG_DENSITY);
  const sunCol = new THREE.Color(0xffd5a2), SUN_I = 3.1;
  // ambient comes mostly from the PMREM sky (ENV_I); the hemisphere light is a weak fill
  // that keeps the scene readable if the environment map cannot be built
  const ENV_I = 0.78;
  const sun = new THREE.DirectionalLight(sunCol, SUN_I);
  sun.name = 'sun';
  sun.castShadow = true;
  let SHH = PRESETS[preset].shadowR;
  sun.shadow.mapSize.set(PRESETS[preset].shadow, PRESETS[preset].shadow);
  Object.assign(sun.shadow.camera, { left: -SHH, right: SHH, top: SHH, bottom: -SHH, near: 60, far: 420 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  const hemiSky = new THREE.Color(0xb3c6d4), hemiGround = new THREE.Color(0x3b3d22);
  let HEMI_I = 1.15;
  const hemi = new THREE.HemisphereLight(hemiSky.clone(), hemiGround.clone(), HEMI_I);
  hemi.name = 'hemi';

  const su = sky.material.uniforms;
  su.uZen.value.set(0x5d84ad); su.uHor.value.set(0xc4cbbb); su.uSunCol.value.set(0xffd09a).multiplyScalar(1.5);
  const wu = waterMat.uniforms;
  wu.uSunCol.value.set(0xffd7a0).multiplyScalar(2.2);
  wu.uSkyZen.value.set(0x6a8cad); wu.uSkyHor.value.set(0xb3baa6); wu.uTreeCol.value.set(0x1b2613);
  wu.uDeep.value.set(0x26270f); wu.uShallow.value.set(0x5d5032);
  FOL.uSunCol.value.copy(sunCol).multiplyScalar(SUN_I * 0.3);

  // image-based ambient light from the procedural sky
  const envTex = buildEnvironment(renderer, sky, fogCol);
  if (envTex) {
    HEMI_I = 0.42;
    hemi.intensity = HEMI_I;
  }

  if (scene) {
    scene.add(group, sky, sun, sun.target, hemi);
    scene.fog = fog;
    scene.background = fogCol.clone();
    if (envTex) { scene.environment = envTex; scene.environmentIntensity = ENV_I; }
  }

  // --- ray proxies + spatial index
  buildSolidGrid();
  const terrainProxy = makeProxy('terrain', 'dirt', function (raycaster, intersects) {
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const t = terrainHitT(o, d, raycaster.near, raycaster.far);
    if (t === Infinity) return;
    const px = o.x + d.x * t, pz = o.z + d.z * t;
    // shots into water: report the water surface
    const wl = waterHeightAt(px, pz);
    if (wl > -Infinity && d.y < -1e-4) {
      const tw = (wl - o.y) / d.y;
      if (tw >= raycaster.near && tw < t) { intersects.push(makeHit(this, tw, o, d, _nTmp.set(0, 1, 0), 'water')); return; }
    }
    normalAt(px, pz, _nTmp);
    intersects.push(makeHit(this, t, o, d, _nTmp, surfaceAt(px, pz)));
  });
  terrainProxy.userData.isTerrain = true;
  const solidsProxy = makeProxy('solids', 'wood', function (raycaster, intersects) {
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const t = solidHitT(o, d, raycaster.near, raycaster.far);
    if (t === Infinity || !_hitSolid) return;
    intersects.push(makeHit(this, t, o, d, _rn, _hitSolid.s));
  });

  // collider spatial hash for collidersNear()
  const CG = 16, CGN = 32;
  let colGrid = null;
  function rebuildColGrid() {
    colGrid = new Array(CGN * CGN).fill(null);
    for (const c of colliders) {
      const i0 = clamp(Math.floor((c.x - c.r + HALF) / CG), 0, CGN - 1), i1 = clamp(Math.floor((c.x + c.r + HALF) / CG), 0, CGN - 1);
      const j0 = clamp(Math.floor((c.z - c.r + HALF) / CG), 0, CGN - 1), j1 = clamp(Math.floor((c.z + c.r + HALF) / CG), 0, CGN - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * CGN + i; (colGrid[k] || (colGrid[k] = [])).push(c); }
    }
  }
  rebuildColGrid();
  let nearStamp = 0;
  function collidersNear(x, z, r, out = []) {
    out.length = 0;
    nearStamp++;
    const i0 = clamp(Math.floor((x - r + HALF) / CG), 0, CGN - 1), i1 = clamp(Math.floor((x + r + HALF) / CG), 0, CGN - 1);
    const j0 = clamp(Math.floor((z - r + HALF) / CG), 0, CGN - 1), j1 = clamp(Math.floor((z + r + HALF) / CG), 0, CGN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = colGrid[j * CGN + i];
      if (!list) continue;
      for (let q = 0; q < list.length; q++) {
        const c = list[q];
        if (c._ns === nearStamp) continue;
        c._ns = nearStamp;
        const dx = c.x - x, dz = c.z - z, rr = r + c.r;
        if (dx * dx + dz * dz <= rr * rr) out.push(c);
      }
    }
    return out;
  }

  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function castRay(origin, dir, far = 600, out = {}) {
    _d.copy(dir).normalize();
    const tt = terrainHitT(origin, _d, 0, far);
    const ts = solidHitT(origin, _d, 0, Math.min(far, tt));
    const t = Math.min(tt, ts);
    if (t === Infinity) return null;
    out.distance = t;
    out.point = (out.point || new THREE.Vector3()).copy(_d).multiplyScalar(t).add(origin);
    if (ts <= tt) { out.normal = (out.normal || new THREE.Vector3()).copy(_rn); out.surface = _hitSolid?.s || 'wood'; }
    else { out.normal = normalAt(out.point.x, out.point.z, out.normal || new THREE.Vector3()); out.surface = surfaceAt(out.point.x, out.point.z); }
    return out;
  }
  function lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.01) return true;
    _d.set(dx / dist, dy / dist, dz / dist);
    _o.copy(a);
    if (terrainHitT(_o, _d, 0, dist) < dist - 0.25) return false;
    if (solidHitT(_o, _d, 0, dist - 0.25) < dist - 0.25) return false;
    return true;
  }

  // --- initial foliage fill
  let sx0 = CPX, sz0 = CPZ;
  const dp = ctx.debug?.pos;
  if (dp) {
    const arr = typeof dp === 'string' ? dp.split(',').map(Number) : Array.isArray(dp) ? dp : [dp.x, dp.z];
    if (Number.isFinite(arr[0]) && Number.isFinite(arr[1])) { sx0 = arr[0]; sz0 = arr[1]; }
  }
  for (const l of layers) l.fill(sx0, sz0, null, null);
  let streamX = sx0, streamZ = sz0, qi = layers.length, urgent = false;

  // --- firebase / camp public info
  const fbInfo = fb.info;
  const dumpMesh = fbInfo.dump;
  dumpMesh.userData.destroyed = false;
  const gate = new THREE.Vector3(FBX + Math.cos(FBL.gateAngle) * (FBL.wallR + 7), 0, FBZ + Math.sin(FBL.gateAngle) * (FBL.wallR + 7));
  gate.y = heightAt(gate.x, gate.z);
  const firebase = {
    dumpMesh, center: new THREE.Vector3(FBX, FB_H, FBZ), radius: FBR, height: FB_H,
    dump: new THREE.Vector3(WORLD.ammoDump.x, heightAt(WORLD.ammoDump.x, WORLD.ammoDump.z), WORLD.ammoDump.z),
    helipad: fbInfo.helipad, towerTop: fbInfo.towerTop, searchlight: fbInfo.searchlight, gate,
    bunkers: fbInfo.bunkers, guardPosts: fbInfo.guardPosts, gunPits: fbInfo.gunPits, wreck: fbInfo.wreck, destroyed: false,
  };
  const campInfo = {
    center: camp.info.center, huts: camp.info.huts,
    shelter: new THREE.Vector3(CAMP_SHELTER.x, heightAt(CAMP_SHELTER.x, CAMP_SHELTER.z), CAMP_SHELTER.z),
    fire: new THREE.Vector3(CAMP_FIRE.x, heightAt(CAMP_FIRE.x, CAMP_FIRE.z), CAMP_FIRE.z),
  };

  function removeCollidersOf(s) {
    if (!s) return;
    s.on = false;
    if (s.col) { const i = boxColliders.indexOf(s.col); if (i >= 0) boxColliders.splice(i, 1); }
    if (s.circles) for (const c of s.circles) { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); }
    rebuildColGrid();
  }
  function onDumpDestroyed() {
    if (firebase.destroyed) return;
    firebase.destroyed = true;
    dumpMesh.userData.destroyed = true;
    dumpMesh.visible = false;
    fbInfo.wreck.visible = true;
    removeCollidersOf(fbInfo.dumpSolid);
  }
  events.on?.('dumpDestroyed', onDumpDestroyed);

  // --- runtime state
  let time = 0, quality = 1, ema = 1 / 60, slowT = 0, fastT = 0, warm = 0;
  const autoQuality = !(ctx.debug && ctx.debug.quality !== undefined);
  const ug = { v: 0, target: 0 };
  const ugFog = new THREE.Color(0x0a0806), ugSky = new THREE.Color(0x3b3024), ugGround = new THREE.Color(0x120d09);
  const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _fc = new THREE.Vector3(), _sv = new THREE.Vector3();
  const LR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const LU = new THREE.Vector3().crossVectors(SUN_DIR, LR).normalize();
  let texel = (SHH * 2) / sun.shadow.mapSize.x;
  const _fogC = new THREE.Color();
  // foliage view culling state
  const cullFr = new THREE.Frustum(), _cullProj = new THREE.Matrix4(), _cullInv = new THREE.Matrix4();
  const _lastFwd = new THREE.Vector3(), _cf = new THREE.Vector3();
  let fillView = null, fillSun = null;
  function snapshotCull(cam) {
    fillView = null; fillSun = null;
    if (!cam || !cam.isPerspectiveCamera) return;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / (cam.zoom || 1);
    const halfV = Math.min(Math.atan(tanV) + CULL_MARGIN, 1.45);
    const halfH = Math.min(Math.atan(tanV * (cam.aspect || 1)) + CULL_MARGIN, 1.45);
    const n = 0.1, top = n * Math.tan(halfV), right = n * Math.tan(halfH);
    _cullProj.makePerspective(-right, right, top, -top, n, 2000);
    _cullInv.copy(cam.matrixWorld).invert();
    cullFr.setFromProjectionMatrix(_cullProj.multiply(_cullInv));
    fillView = cullFr;
    try { sun.shadow.updateMatrices(sun); fillSun = sun.shadow.getFrustum(); } catch (e) { fillSun = null; }
    cam.getWorldDirection(_lastFwd);
  }

  function setQuality(q) {
    quality = clamp(q, 0.4, 1);
    const dens = PRESETS[preset].density;
    for (const sp of VEG_SPEC) {
      if (!sp.mats) continue;
      const k = (sp.shrink ? quality : lerp(1, quality, 0.5)) * dens;
      sp.mats.local.uFade.value.set(sp.fade[0] * k, sp.fade[1] * k);
      sp.curFar = sp.fade[1] * k + STREAM_STEP;
    }
    for (const l of layers) if (l.isFar || !l.spec.lod) l.rMax = l.spec.curFar ?? l.rMax;
    qi = 0;
  }
  if (!autoQuality && Number.isFinite(Number(ctx.debug.quality))) setQuality(Number(ctx.debug.quality) || 1);

  // Graphics preset: foliage density, ground-cover thinning and the sun shadow map.
  function setPreset(name) {
    if (!PRESETS[name]) return preset;
    preset = name;
    const P = PRESETS[name];
    for (const l of layers) l.thin = l.spec?.thin ? P.thin : 1;
    SHH = P.shadowR;
    Object.assign(sun.shadow.camera, { left: -SHH, right: SHH, top: SHH, bottom: -SHH });
    sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== P.shadow) {
      sun.shadow.mapSize.set(P.shadow, P.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    texel = (SHH * 2) / P.shadow;
    sun.shadow.radius = name === 'low' ? 1 : 1.5;
    setQuality(quality);
    qi = 0; urgent = true;
    if (renderer) renderer.shadowMap.needsUpdate = true;
    return preset;
  }
  setPreset(preset);

  function updateShadow(focus, cam) {
    _fc.copy(focus);
    if (cam) { cam.getWorldDirection(_fwd); _fc.x += _fwd.x * 20; _fc.z += _fwd.z * 20; }
    const a = _fc.dot(LR), b = _fc.dot(LU);
    _fc.addScaledVector(LR, Math.round(a / texel) * texel - a).addScaledVector(LU, Math.round(b / texel) * texel - b);
    sun.target.position.copy(_fc);
    sun.position.copy(_fc).addScaledVector(SUN_DIR, 230);
    // realtime sun shadow fades into the baked sun term toward the edge of the shadow box
    BK.uBakeFade.value.set(_fc.x, _fc.z, SHH * 0.66, SHH * 0.92);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
  }

  function applyUnderground(v) {
    _fogC.copy(fogCol).lerp(ugFog, v);
    fog.color.copy(_fogC);
    fog.density = lerp(FOG_DENSITY, 0.11, v);
    if (scene && scene.background && scene.background.isColor) scene.background.copy(_fogC);
    sun.intensity = SUN_I * (1 - v);
    hemi.intensity = lerp(HEMI_I, 0.08, v);
    hemi.color.copy(hemiSky).lerp(ugSky, v);
    hemi.groundColor.copy(hemiGround).lerp(ugGround, v);
    if (scene && envTex) scene.environmentIntensity = lerp(ENV_I, 0.05, v);
    su.uFogMix.value = v;
    FOL.uSunCol.value.copy(sunCol).multiplyScalar(SUN_I * 0.3 * (1 - v));
    wu.uLight.value = 1 - v;
  }

  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    time += dt;
    const cam = ctx.camera;
    if (cam) cam.getWorldPosition(_eye); else _eye.set(streamX, 0, streamZ);

    // wind
    FOL.uTime.value = time;
    const ws = 0.85 + 0.3 * Math.sin(time * 0.11) + 0.18 * Math.sin(time * 0.37 + 1.3);
    const wa = 0.6 + 0.25 * Math.sin(time * 0.023);
    FOL.uWind.value.set(Math.cos(wa), Math.sin(wa), ws, 0);
    FOL.uEye.value.copy(_eye);
    if (cam) { _sv.copy(SUN_DIR).transformDirection(cam.matrixWorldInverse); FOL.uSunView.value.copy(_sv); }
    wu.uTime.value = time;
    su.uTime.value = time;
    sky.position.copy(_eye);

    // shadows follow the player
    const focus = ctx.player?.position || _eye;
    updateShadow(focus, cam);

    // foliage streaming + view culling. A refill starts when the eye has moved STREAM_STEP
    // (spread over a few frames), or at once when the view turned or stepped sideways enough
    // to leave the widened frustum the last fill used.
    if (ug.target === 0) {
      const dx = _eye.x - streamX, dz = _eye.z - streamZ;
      let start = false, allNow = false;
      if (dx * dx + dz * dz > STREAM_STEP * STREAM_STEP) start = true;
      if (cam) {
        cam.getWorldDirection(_cf);
        const hl = Math.hypot(_lastFwd.x, _lastFwd.z);
        const side = hl > 1e-3 ? Math.abs(dx * _lastFwd.z - dz * _lastFwd.x) / hl : 0;
        const dot = _cf.dot(_lastFwd);
        if (dot < CULL_TURN || side > CULL_SIDE) { start = true; urgent = true; }
        // a flick past the frustum margin leaves holes on screen: refill everything this frame
        if (dot < CULL_FLICK) allNow = true;
      }
      if (start) {
        streamX = _eye.x; streamZ = _eye.z; qi = 0;
        snapshotCull(cam);
      }
      const per = allNow ? layers.length : urgent ? Math.ceil(layers.length / 2) : 6;
      for (let n = 0; n < per && qi < layers.length; n++) layers[qi++].fill(streamX, streamZ, fillView, fillSun);
      if (qi >= layers.length) urgent = false;
    }


    // underground transition
    if (ug.v !== ug.target) {
      ug.v = ug.target > ug.v ? Math.min(ug.target, ug.v + dt * 3) : Math.max(ug.target, ug.v - dt * 3);
      applyUnderground(ug.v);
    }

    // adaptive foliage density
    if (autoQuality && dt > 0) {
      warm += dt;
      ema += (dt - ema) * 0.05;
      if (warm > 6) {
        if (ema > 1 / 42) { slowT += dt; if (slowT > 4 && quality > 0.6) { setQuality(quality - 0.15); slowT = 0; } } else slowT = 0;
        if (ema < 1 / 57) { fastT += dt; if (fastT > 12 && quality < 1) { setQuality(quality + 0.1); fastT = 0; } } else fastT = 0;
      }
    }
  }

  function setUnderground(b) {
    ug.target = b ? 1 : 0;
    group.visible = !b;
    sky.visible = !b;
    if (renderer) {
      renderer.shadowMap.autoUpdate = !b;
      if (!b) renderer.shadowMap.needsUpdate = true;
    }
    if (!b && ug.v === 0) applyUnderground(0);
    if (!b) { qi = 0; urgent = true; _lastFwd.set(0, 0, 0); }
  }

  updateShadow(_eye.set(sx0, heightAt(sx0, sz0), sz0), null);

  const world = {
    heightAt, normalAt, slopeAt,
    waterLevel: WATER_Y, isWater, waterHeightAt, waterDepthAt, surfaceAt,
    colliders, boxColliders, collidersNear,
    coverAt, canopyAt: shadeAt,
    raycastMeshes: [terrainProxy, solidsProxy],
    terrainProxy, solidsProxy, castRay, lineOfSight,
    sun, hemi, sky, fog, group,
    update, setUnderground, setQuality, setPreset,
    get quality() { return quality; },
    get preset() { return preset; },
    // baked lighting for other modules: lightmap texture, ground-level sky/sun visibility,
    // a material patch that reads it, and the voxel AO baker for their own geometry
    bake: {
      texture: BK.tBake.value,
      uniforms: BK,
      skyAt: bakeSkyAt,
      sunAt: bakeSunAt,
      patch: bakePatch,
      vertexAO: bakeVertexAO,
      timings,
    },
    bakePatch, bakeVertexAO,
    sunDir: SUN_DIR.clone(),
    get underground() { return ug.target === 1; },
    firebase, camp: campInfo, trails,
    playable: WORLD.playable,
    stats() {
      let inst = 0, tris = 0;
      for (const l of layers) {
        inst += l.mesh.count;
        const idx = l.mesh.geometry.index;
        tris += l.mesh.count * (idx ? idx.count / 3 : 0);
      }
      return { foliageLayers: layers.length, instances: inst, foliageTriangles: tris, colliders: colliders.length, solids: solids.length, quality, preset, bakeMs: timings };
    },
  };
  if (ctx.debug?.debug) console.info(`[world] ready in ${Math.round(performance.now() - t0)} ms ` + JSON.stringify({ timings, ao: aoStats }));
  return world;
}
