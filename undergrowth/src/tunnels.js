// UNDERGROWTH: tunnels.js
// Underground grid, digging, hatches, tunnel rendering, punji traps.
//
// Geometry approach: every dug cell (2 m) is sampled on a 0.125 m grid. Floor,
// walls, arched ceiling, lintels and hatch shafts are emitted per cell, but
// every vertex position, normal, uv and colour is a pure function of its
// undisplaced world position, so neighbouring cells meet without cracks.
// Cells are merged into 8x8-cell chunk meshes. A cell's mesh depends only on
// a small signature (floor values and relevant wall state of its 3x3
// neighbourhood, baked lamp visibility), so a dig rebuilds just the cells
// whose signature changed, within a per-frame time budget, and chunk buffers
// are rewritten in place.
//
// Tunnels may pass under the river: cover is measured from the river/paddy
// bed (world.heightAt) and tunnels near deep water pre-dip so they can get
// underneath within the per-cell step limit.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, rand, noise2D, clamp, smoothstep, canvasTexture, events as sharedEvents } from './util.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CELL = WORLD.cell;              // 2 m
const DEPTH = WORLD.tunnelDepth;      // 3.2 m below terrain
const CRAWL_W = 1.0;
const CRAWL_H = 1.4;
const CHAMBER_H = 2.0;
const MAX_STEP = 0.6;                 // max floor difference between adjacent cells
const MIN_COVER = 0.9;                // earth kept above a tunnel ceiling
const RIVER_COVER = 1.6;              // earth kept between a tunnel ceiling and a river bed
const DEEP_WATER = 0.5;               // water shallower than this (paddies) counts as ground
const LOOK = 8;                       // cells scanned ahead for deep water when choosing a floor
const CONE = 0.5;                     // floor rise allowed per cell away from deep water (< MAX_STEP)
const SUB = 16;                      // grid subdivisions per cell
const SS = CELL / SUB;                // 0.125 m
const G = SUB + 3;                    // grid points per side incl. border (-1 .. SUB+1)
const GG = G * G;
const M = SUB + 2;                    // mask side incl. ring (-1 .. SUB)
const CHUNK = 8;                      // cells per chunk side
const TEX_SCALE = 1.6;                // metres per clay texture repeat
const LIMIT = WORLD.playable - 3;
const KCRAWL = 4, KCHAMBER = 6, KMAX = 6, KSHAFT = 14;
const SHAFT_TAPER = 0.84;
const TRAP_HALF = 0.55;
const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];
const OPP = [1, 0, 3, 2];
const BIT = [1, 2, 4, 8];             // +x, -x, +z, -z
const DIG_TIME = Object.freeze({ cell: 1.2, hatch: 3.0, chamber: 4.0 });

const keyOf = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const cellIndex = (v) => Math.floor(v / CELL);
const hash2 = (a, b) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ 0x5bd1e995) >>> 0;

// ---------------------------------------------------------------------------
// Shape functions (pure functions of world position)
// ---------------------------------------------------------------------------
const DA = 0.055, DF = 0.85;
function dispX(x, y, z) { return DA * (0.7 * noise2D(z * DF + 13.1, y * DF - 2.3) + 0.3 * noise2D(x * 0.5 - 4.1, z * 0.5 + 7.7)); }
function dispY(x, y, z) { return DA * 0.6 * (0.65 * noise2D(x * DF + 41.3, z * DF - 3.3) + 0.35 * noise2D(x * 2.1 - 9.2, z * 2.1 + y * 0.8)); }
function dispZ(x, y, z) { return DA * (0.7 * noise2D(x * DF - 29.4, y * DF + 5.2) + 0.3 * noise2D(z * 0.5 + 3.3, x * 0.5 - 1.9)); }
function bump(x, z) { return 0.028 * noise2D(x * 1.9 + 3.1, z * 1.9 - 7.3) + 0.01 * noise2D(x * 6.1, z * 6.1 + 11.0); }
function ceilNoise(x, z) { return 0.045 * noise2D(x * 0.8 - 17.0, z * 0.8 + 4.0); }
function archDrop(d, chamber) {
  const W = chamber ? 0.85 : 0.5, D = chamber ? 0.6 : 0.33;
  if (d >= W) return 0;
  const t = 1 - d / W;
  return D * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
}
function ceilY(fs, d, x, z, chamber) {
  return fs + (chamber ? CHAMBER_H : CRAWL_H) - archDrop(d, chamber) + ceilNoise(x, z);
}

const COL = [0, 0, 0];
// Height-independent colour terms, cacheable per (x, z) lattice point.
const CXZ = [0, 0, 0];
function earthColorXZ(x, z, out) {
  out[0] = noise2D(x * 0.31 + 2.7, z * 0.31 - 8.1);
  out[1] = smoothstep(0.35, 0.8, noise2D(x * 0.42 + 90, z * 0.42 - 30));
  out[2] = smoothstep(0.2, 0.75, noise2D(x * 0.17 - 40, z * 0.17 + 12));
  return out;
}
function earthColor(x, y, z, k) {
  earthColorXZ(x, z, CXZ);
  earthColorY(x, y, z, k, CXZ[0], CXZ[1], CXZ[2]);
}
function earthColorY(x, y, z, k, n1, wet, pale) {
  const n2 = noise2D(x * 1.3 - 5.0 + y * 0.9, z * 1.3 + y * 0.4);
  const strata = Math.sin(y * 6.5 + n1 * 2.4) * 0.5 + 0.5;
  const m = k * (1 - 0.26 * wet) * (0.93 + 0.07 * n1 + 0.05 * strata + 0.025 * n2);
  // near-neutral: the clay map carries the ochre hue, this only varies value
  // and drifts some patches toward paler, greyer clay
  COL[0] = m * (0.97 + 0.03 * pale);
  COL[1] = m * (0.95 + 0.04 * pale + 0.015 * strata);
  COL[2] = m * (0.9 + 0.07 * pale) * (1 - 0.05 * wet);
}

const LAMP_COL = new THREE.Color(0xffc890);   // oil lamp light (linear after Color management)

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function fbmTile(size, periods, weights, seed) {
  const r = rand(seed);
  const out = new Float32Array(size * size);
  let wsum = 0;
  for (let k = 0; k < periods.length; k++) {
    const p = periods[k], w = weights[k];
    wsum += w;
    const grid = new Float32Array(p * p);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    const sc = p / size;
    for (let y = 0; y < size; y++) {
      const gy = y * sc, y0 = gy | 0;
      let ty = gy - y0; ty = ty * ty * (3 - 2 * ty);
      const r0 = y0 * p, r1 = ((y0 + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const gx = x * sc, x0 = gx | 0;
        let tx = gx - x0; tx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % p;
        const a = grid[r0 + x0], b = grid[r0 + x1], c = grid[r1 + x0], d = grid[r1 + x1];
        const top = a + (b - a) * tx, bot = c + (d - c) * tx;
        out[y * size + x] += w * (top + (bot - top) * ty);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= wsum;
  return out;
}

// Calls fn(ox, oy) for every wrapped copy of a bbox that touches the tile.
function wrapCopies(x0, y0, x1, y1, S, fn) {
  for (let oy = -S; oy <= S; oy += S) {
    for (let ox = -S; ox <= S; ox += S) {
      if (x1 + ox < 0 || x0 + ox > S || y1 + oy < 0 || y0 + oy > S) continue;
      fn(ox, oy);
    }
  }
}

function makeClayTextures() {
  const S = 512;
  const base = fbmTile(S, [4, 8, 16, 32, 64, 128], [1, 0.7, 0.48, 0.32, 0.2, 0.1], 71);
  const hue = fbmTile(S, [3, 6, 12, 24, 48], [1, 0.6, 0.4, 0.25, 0.12], 913);
  const dc = document.createElement('canvas');
  dc.width = dc.height = S;
  const g = dc.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  const r = rand(4242);
  g.lineCap = 'round';
  // hand-dug scallops: shallow concave scoops, darker on the deep side, a soft
  // lit rim on the other; random orientation so nothing lines up across tiles
  for (let i = 0; i < 64; i++) {
    const x = r() * S, y = r() * S, rx = 14 + r() * 22, ry = rx * (0.45 + r() * 0.3), rot = r() * Math.PI * 2;
    const dark = 0.05 + r() * 0.06, lite = 0.035 + r() * 0.04;
    wrapCopies(x - rx * 1.3, y - rx * 1.3, x + rx * 1.3, y + rx * 1.3, S, (ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(rot);
      g.scale(1, ry / rx);
      const gr = g.createRadialGradient(-rx * 0.25, 0, rx * 0.1, 0, 0, rx);
      gr.addColorStop(0, `rgba(0,0,0,${dark})`);
      gr.addColorStop(0.7, `rgba(0,0,0,${dark * 0.5})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(255,255,255,${lite})`;
      g.lineWidth = 2 + rx * 0.08;
      g.beginPath(); g.arc(0, 0, rx * 0.92, -0.9, 0.9); g.stroke();
      g.restore();
    });
  }
  // tool marks: small groups of short, slightly curved hoe/shovel cuts with a
  // faint lit lip; each group has its own random direction and bend
  for (let grp = 0; grp < 110; grp++) {
    const gx = r() * S, gy = r() * S;
    const a = r() * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const bendDir = r() < 0.5 ? -1 : 1;
    const n = 2 + ((r() * 3) | 0), gap = 5 + r() * 6;
    for (let k = 0; k < n; k++) {
      const off = (k - n * 0.5) * gap + (r() - 0.5) * 3;
      const len = 10 + r() * 22, w = 2.5 + r() * 3.5;
      const aa = a + (r() - 0.5) * 0.35;
      const c2 = Math.cos(aa), s2 = Math.sin(aa);
      const x = gx - sa * off + ca * (r() - 0.5) * 8, y = gy + ca * off + sa * (r() - 0.5) * 8;
      const ex = x + c2 * len, ey = y + s2 * len;
      const bend = bendDir * len * (0.12 + r() * 0.22);
      const qx = (x + ex) * 0.5 - s2 * bend, qy = (y + ey) * 0.5 + c2 * bend;
      const dark = 0.07 + r() * 0.07, lite = 0.035 + r() * 0.045;
      const lx = -s2 * w * 0.6, ly = c2 * w * 0.6;
      const pad = w + Math.abs(bend);
      wrapCopies(Math.min(x, ex) - pad, Math.min(y, ey) - pad, Math.max(x, ex) + pad, Math.max(y, ey) + pad, S, (ox, oy) => {
        g.lineCap = 'round';
        g.lineWidth = w;
        g.strokeStyle = `rgba(0,0,0,${dark})`;
        g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(qx + ox, qy + oy, ex + ox, ey + oy); g.stroke();
        g.lineWidth = w * 0.3;
        g.strokeStyle = `rgba(255,255,255,${lite})`;
        g.beginPath(); g.moveTo(x + ox + lx, y + oy + ly); g.quadraticCurveTo(qx + ox + lx, qy + oy + ly, ex + ox + lx, ey + oy + ly); g.stroke();
      });
    }
  }
  // clods: broad soft bumps
  for (let i = 0; i < 46; i++) {
    const x = r() * S, y = r() * S, rad = 8 + r() * 18, al = 0.05 + r() * 0.07;
    wrapCopies(x - rad, y - rad, x + rad, y + rad, S, (ox, oy) => {
      g.fillStyle = `rgba(255,255,255,${al})`;
      g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + ox - rad * 0.15, y + oy - rad * 0.15, rad * 0.6, 0, Math.PI * 2); g.fill();
    });
  }
  // pebbles: small sharp bumps (also mark them bright so albedo can grey them)
  for (let i = 0; i < 130; i++) {
    const x = r() * S, y = r() * S, rad = 0.8 + r() * r() * 3.2;
    const sx = 1 + r() * 0.8, rot = r() * Math.PI;
    wrapCopies(x - rad * 2, y - rad * 2, x + rad * 2, y + rad * 2, S, (ox, oy) => {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.beginPath(); g.ellipse(x + ox, y + oy, rad * sx, rad, rot, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(x + ox + rad * 0.5, y + oy + rad * 0.6, rad * sx * 0.8, rad * 0.5, rot, 0, Math.PI * 2); g.fill();
    });
  }
  // fine crumbly grain
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)';
    g.fillRect((r() * S) | 0, (r() * S) | 0, 1 + (r() < 0.3 ? 1 : 0), 1 + (r() < 0.3 ? 1 : 0));
  }
  const det = g.getImageData(0, 0, S, S).data;
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = base[i] * 0.75 + (det[i * 4] / 255 - 0.5) * 0.55;

  const grey = fbmTile(S, [5, 10, 20, 40], [1, 0.55, 0.3, 0.15], 2718);
  const map = canvasTexture(S, S, (c) => {
    const img = c.createImageData(S, S);
    const d = img.data;
    for (let i = 0; i < S * S; i++) {
      const t = hue[i];
      const shade = clamp(0.86 + (h[i] - 0.375) * 1.2, 0.48, 1.22);
      // ochre / tan-brown Cu Chi clay (laterite-poor), low red dominance
      let R = 146 + 30 * t, Gc = 113 + 24 * t, B = 78 + 17 * t;
      // patches of paler, greyer clay
      const gk = smoothstep(0.52, 0.72, grey[i]) * 0.35;
      R += (150 - R) * gk; Gc += (132 - Gc) * gk; B += (108 - B) * gk;
      const p = det[i * 4];
      if (p > 165) {
        const k = Math.min(1, (p - 165) / 70) * 0.3;
        R += (150 - R) * k; Gc += (140 - Gc) * k; B += (122 - B) * k;
      }
      d[i * 4] = clamp(R * shade, 0, 255);
      d[i * 4 + 1] = clamp(Gc * shade, 0, 255);
      d[i * 4 + 2] = clamp(B * shade, 0, 255);
      d[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    // root fibres and hair roots
    const rr = rand(88);
    c.lineCap = 'round';
    for (let i = 0; i < 15; i++) {
      const pts = [];
      let x = rr() * S, y = rr() * S, a = rr() * Math.PI * 2;
      for (let k = 0; k < 7; k++) { pts.push(x, y); a += (rr() - 0.5) * 0.9; const st = 8 + rr() * 16; x += Math.cos(a) * st; y += Math.sin(a) * st; }
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < pts.length; k += 2) { bx0 = Math.min(bx0, pts[k]); bx1 = Math.max(bx1, pts[k]); by0 = Math.min(by0, pts[k + 1]); by1 = Math.max(by1, pts[k + 1]); }
      const lw = 0.6 + rr() * 1.2, al = 0.22 + rr() * 0.25;
      wrapCopies(bx0, by0, bx1, by1, S, (ox, oy) => {
        c.strokeStyle = `rgba(34,21,12,${al})`;
        c.lineWidth = lw;
        c.beginPath(); c.moveTo(pts[0] + ox, pts[1] + oy);
        for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k] + ox, pts[k + 1] + oy);
        c.stroke();
        c.strokeStyle = `rgba(150,110,72,${al * 0.35})`;
        c.lineWidth = lw * 0.4;
        c.stroke();
      });
    }
    for (let i = 0; i < 700; i++) {
      const x = (rr() * S) | 0, y = (rr() * S) | 0, l = rr() < 0.5;
      c.fillStyle = l ? 'rgba(200,170,130,0.35)' : 'rgba(30,18,10,0.35)';
      c.fillRect(x, y, 1 + (rr() < 0.2 ? 1 : 0), 1);
    }
  });

  const normalMap = canvasTexture(S, S, (c) => {
    const img = c.createImageData(S, S);
    const d = img.data;
    const STR = 5.0;
    for (let y = 0; y < S; y++) {
      const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, yr = y * S;
      for (let x = 0; x < S; x++) {
        const xm = (x - 1 + S) % S, xp = (x + 1) % S;
        let nx = -(h[yr + xp] - h[yr + xm]) * STR;
        let ny = (h[yp + x] - h[ym + x]) * STR;
        let nz = 1;
        const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= il; ny *= il; nz *= il;
        const o = (yr + x) * 4;
        d[o] = (nx * 0.5 + 0.5) * 255;
        d[o + 1] = (ny * 0.5 + 0.5) * 255;
        d[o + 2] = (nz * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  }, { srgb: false });
  return { map, normalMap };
}

function drawLeafShape(g, len, wid) {
  g.beginPath();
  g.moveTo(0, len);
  g.bezierCurveTo(wid, len * 0.5, wid * 0.9, -len * 0.5, 0, -len);
  g.bezierCurveTo(-wid * 0.9, -len * 0.5, -wid, len * 0.5, 0, len);
}

function makeLeafAtlas() {
  return canvasTexture(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    const r = rand(1212);
    const pal = [['#80552f', '#553719'], ['#a07d45', '#6c5026'], ['#4f5c2b', '#30391a'], ['#7c401d', '#4b2611']];
    for (let k = 0; k < 4; k++) {
      const cx = (k % 2) * 128 + 64, cy = ((k / 2) | 0) * 128 + 64;
      g.save();
      g.translate(cx, cy);
      g.rotate((r() - 0.5) * 0.15);
      const grad = g.createLinearGradient(0, 56, 0, -58);
      grad.addColorStop(0, pal[k][1]);
      grad.addColorStop(1, pal[k][0]);
      g.fillStyle = grad;
      drawLeafShape(g, 56, 38);
      g.fill();
      // mottling
      for (let i = 0; i < 40; i++) {
        const x = (r() - 0.5) * 50, y = (r() - 0.5) * 100;
        g.fillStyle = r() < 0.5 ? 'rgba(25,15,6,0.16)' : 'rgba(190,150,90,0.12)';
        g.beginPath(); g.arc(x, y, 1 + r() * 4, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      g.strokeStyle = 'rgba(25,16,8,0.55)';
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(0, 58); g.lineTo(0, -54); g.stroke();
      g.lineWidth = 1;
      for (let v = 0; v < 7; v++) {
        const y = 42 - v * 14;
        const w = 30 * (1 - Math.abs(y) / 70);
        g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(w * 0.5, y - 6, w, y - 16); g.stroke();
        g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(-w * 0.5, y - 6, -w, y - 16); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      if (k !== 2) {
        // decay holes and ragged edges
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 6; i++) {
          g.beginPath(); g.arc((r() - 0.5) * 50, (r() - 0.5) * 90, 1.5 + r() * 4.5, 0, Math.PI * 2); g.fill();
        }
        for (let i = 0; i < 4; i++) {
          const s = r() < 0.5 ? -1 : 1;
          g.beginPath(); g.arc(s * (26 + r() * 10), (r() - 0.5) * 70, 4 + r() * 6, 0, Math.PI * 2); g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      }
      g.strokeStyle = pal[k][1];
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 54); g.lineTo(1, 63); g.stroke();
      g.restore();
    }
  }, { repeat: false });
}

function makeLitterTexture() {
  return canvasTexture(256, 256, (g) => {
    const r = rand(99);
    g.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 78;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rad = 18 + r() * 30;
      g.fillStyle = `rgba(${(84 + r() * 22) | 0},${(70 + r() * 15) | 0},${(54 + r() * 10) | 0},0.45)`;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    const pal = [[128, 100, 68], [150, 122, 84], [112, 88, 62], [100, 100, 66], [138, 96, 62], [92, 80, 64], [172, 146, 104]];
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 118;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
      const c = pal[(r() * pal.length) | 0], s = 0.75 + r() * 0.4;
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.fillStyle = `rgb(${(c[0] * s) | 0},${(c[1] * s) | 0},${(c[2] * s) | 0})`;
      drawLeafShape(g, 5 + r() * 9, 3 + r() * 4);
      g.fill();
      g.strokeStyle = 'rgba(20,12,6,0.45)';
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(0, 7); g.lineTo(0, -7); g.stroke();
      g.restore();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 90;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, b = r() * Math.PI, l = 14 + r() * 34;
      g.strokeStyle = `rgba(${(70 + r() * 30) | 0},${(52 + r() * 20) | 0},${(34 + r() * 12) | 0},0.95)`;
      g.lineWidth = 1 + r() * 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke();
    }
  }, { repeat: false });
}

function makePlankTexture() {
  return canvasTexture(256, 64, (g) => {
    const r = rand(311);
    g.fillStyle = '#5b452f';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 46; i++) {
      const y = r() * 64, light = r() < 0.4;
      g.strokeStyle = light ? `rgba(130,104,74,${0.12 + r() * 0.15})` : `rgba(24,15,8,${0.15 + r() * 0.22})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 16; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.025 + i) * 2.2 + (r() - 0.5) * 1.2);
      g.stroke();
    }
    for (let i = 0; i < 2; i++) {
      const x = 30 + r() * 196, y = 12 + r() * 40;
      g.fillStyle = 'rgba(30,18,10,0.7)';
      g.beginPath(); g.ellipse(x, y, 5 + r() * 4, 3 + r() * 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(30,18,10,0.35)';
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(x, y, 10, 6, 0, 0, Math.PI * 2); g.stroke();
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(150,140,120,${0.05 + r() * 0.08})`;
      g.fillRect(r() * 256, r() * 64, 4 + r() * 30, 1 + r() * 3);
    }
    g.fillStyle = 'rgba(15,9,5,0.6)';
    g.fillRect(0, 0, 256, 2);
    g.fillRect(0, 62, 256, 2);
  }, { repeat: false });
}

function makeCrateTexture() {
  return canvasTexture(256, 256, (g) => {
    const r = rand(5150);
    g.fillStyle = '#625c3a';
    g.fillRect(0, 0, 256, 256);
    for (let b = 0; b < 3; b++) {
      const y0 = b * 85;
      g.fillStyle = `rgb(${(84 + r() * 16) | 0},${(78 + r() * 14) | 0},${(48 + r() * 10) | 0})`;
      g.fillRect(0, y0 + 2, 256, 81);
      for (let i = 0; i < 18; i++) {
        const y = y0 + 4 + r() * 77;
        g.strokeStyle = `rgba(20,18,10,${0.1 + r() * 0.15})`;
        g.lineWidth = 0.8 + r();
        g.beginPath(); g.moveTo(0, y); for (let x = 32; x <= 256; x += 32) g.lineTo(x, y + (r() - 0.5) * 2); g.stroke();
      }
      g.fillStyle = 'rgba(14,12,6,0.85)';
      g.fillRect(0, y0, 256, 2.5);
    }
    // worn paint revealing wood
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${110 + r() * 30},${88 + r() * 20},${58 + r() * 14},${0.2 + r() * 0.35})`;
      const edge = r() < 0.6;
      const x = edge ? (r() < 0.5 ? r() * 20 : 236 + r() * 20) : r() * 256;
      g.fillRect(x, r() * 256, 2 + r() * 10, 1 + r() * 5);
    }
    // frame battens
    g.strokeStyle = 'rgba(28,26,14,0.9)';
    g.lineWidth = 12;
    g.strokeRect(6, 6, 244, 244);
    g.strokeStyle = 'rgba(90,84,52,0.5)';
    g.lineWidth = 2;
    g.strokeRect(12, 12, 232, 232);
    // nails
    g.fillStyle = 'rgba(20,18,16,0.9)';
    for (const [x, y] of [[8, 8], [248, 8], [8, 248], [248, 248], [128, 8], [128, 248], [8, 128], [248, 128]]) {
      g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
    // abstract stencil blocks
    g.fillStyle = 'rgba(16,15,10,0.6)';
    let x = 66;
    for (let k = 0; k < 5; k++) {
      const w = 18 + r() * 6;
      for (let j = 0; j < 4; j++) if (r() < 0.7) g.fillRect(x + (r() < 0.5 ? 0 : w * 0.5), 104 + j * 10, w * (r() < 0.5 ? 1 : 0.5), 6);
      x += w + 8;
    }
    g.fillRect(70, 150, 116, 5);
  }, { repeat: false });
}

function makeBurlapTexture() {
  return canvasTexture(128, 128, (g) => {
    const img = g.createImageData(128, 128);
    const d = img.data;
    const r = rand(61);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const over = (((x >> 2) + (y >> 2)) & 1) === 0;
        const tx = Math.sin((x % 4) / 4 * Math.PI), ty = Math.sin((y % 4) / 4 * Math.PI);
        const t = over ? 0.72 + 0.28 * tx : 0.72 + 0.28 * ty;
        const n = 0.88 + r() * 0.2;
        const o = (y * 128 + x) * 4;
        d[o] = clamp(148 * t * n, 0, 255);
        d[o + 1] = clamp(121 * t * n, 0, 255);
        d[o + 2] = clamp(82 * t * n, 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,44,24,${0.08 + r() * 0.1})`;
      g.beginPath(); g.arc(r() * 128, r() * 128, 4 + r() * 12, 0, Math.PI * 2); g.fill();
    }
  });
}

function makeWeaveTexture() {
  return canvasTexture(128, 128, (g) => {
    const img = g.createImageData(128, 128);
    const d = img.data;
    const r = rand(77);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const a = Math.floor((x + y) / 8), b = Math.floor((x - y + 128) / 8);
        const over = ((a + b) & 1) === 0;
        const along = over ? (x - y + 128) % 8 : (x + y) % 8;
        const edge = Math.sin(along / 8 * Math.PI);
        const t = 0.62 + 0.38 * edge * (over ? 1 : 0.86);
        const n = 0.9 + r() * 0.14;
        const o = (y * 128 + x) * 4;
        d[o] = clamp(172 * t * n, 0, 255);
        d[o + 1] = clamp(140 * t * n, 0, 255);
        d[o + 2] = clamp(84 * t * n, 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

function makeCrackTexture() {
  return canvasTexture(128, 128, (g) => {
    const r = rand(404);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    const gaps = [0.186, 0.395, 0.605, 0.814];
    for (const v of gaps) {
      const y = (1 - v) * 128;
      for (let x = 2; x < 126; x += 3) {
        const a = Math.max(0, 0.25 + 0.75 * Math.sin(x * 0.11 + v * 20) * r());
        g.fillStyle = `rgba(255,236,190,${a * 0.9})`;
        g.fillRect(x, y - 0.7, 3, 1.4);
        g.fillStyle = `rgba(255,220,160,${a * 0.18})`;
        g.fillRect(x, y - 3, 3, 6);
      }
    }
    g.fillStyle = 'rgba(255,230,180,0.35)';
    g.fillRect(0, 0, 128, 2); g.fillRect(0, 126, 128, 2);
    g.fillRect(0, 0, 2, 128); g.fillRect(126, 0, 2, 128);
  }, { repeat: false });
}

function makeHaloTexture() {
  return canvasTexture(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,215,0.9)');
    gr.addColorStop(0.18, 'rgba(255,214,160,0.42)');
    gr.addColorStop(0.5, 'rgba(255,190,120,0.1)');
    gr.addColorStop(1, 'rgba(255,180,110,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }, { repeat: false });
}

function makePitTexture() {
  return canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, 'rgba(6,4,3,1)');
    grad.addColorStop(0.55, 'rgba(14,10,7,0.97)');
    grad.addColorStop(0.78, 'rgba(40,28,18,0.75)');
    grad.addColorStop(1, 'rgba(50,36,24,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }, { repeat: false });
}

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------
function tint(geo, r, g, b, jitter, rng) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rng() - 0.5) * jitter;
    a[i * 3] = r * j; a[i * 3 + 1] = g * j; a[i * 3 + 2] = b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

const _ya = new THREE.Vector3(0, 1, 0);
const _tv = new THREE.Vector3();
const _tq = new THREE.Quaternion();
function cylinderBetween(ax, ay, az, bx, by, bz, r0, r1, seg) {
  _tv.set(bx - ax, by - ay, bz - az);
  const len = _tv.length() || 0.001;
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  _tq.setFromUnitVectors(_ya, _tv.multiplyScalar(1 / len));
  geo.applyQuaternion(_tq);
  geo.translate((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  return geo;
}

function buildGeometry(pos, nor, uv, col, idx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos instanceof Float32Array ? pos : new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor instanceof Float32Array ? nor : new Float32Array(nor), 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv instanceof Float32Array ? uv : new Float32Array(uv), 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col instanceof Float32Array ? col : new Float32Array(col), 3));
  const n = pos.length / 3;
  const I = idx instanceof Uint32Array || idx instanceof Uint16Array ? idx : (n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Leaf card quad lying roughly flat; atlas cell 0..3.
function pushLeaf(L, x, y, z, yaw, len, wid, curl, tilt, cell) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const u0 = (cell % 2) * 0.5, v0 = cell < 2 ? 0.5 : 0;
  const base = L.p.length / 3;
  const corners = [[-wid, -len, 0, 0], [wid, -len, 0.5, 0], [wid, len, 0.5, 0.5], [-wid, len, 0, 0.5]];
  for (const [lx, lz, uu, vv] of corners) {
    const wx = lx * c - lz * s, wz = lx * s + lz * c;
    const wy = Math.abs(lx) * curl + lz * tilt;
    L.p.push(x + wx, y + wy, z + wz);
    L.n.push(0, 1, 0);
    L.u.push(u0 + uu, v0 + vv);
  }
  L.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createTunnels(ctx = {}) {
  const ev = ctx.events || sharedEvents;
  const cells = new Map();
  const chunks = new Map();
  const chunkList = [];
  const dirty = new Set();
  const dirtyChunks = new Set();
  const hatches = [];
  const traps = [];
  let version = 0;
  let time = 0;

  const group = new THREE.Group();
  group.name = 'tunnels';
  const interior = new THREE.Group();
  interior.name = 'tunnelInterior';
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = 'tunnelSurface';
  group.add(interior, surfaceGroup);
  ctx.scene?.add?.(group);

  // ---------- world access ----------
  function terrainH(x, z) {
    const w = ctx.world;
    if (w && typeof w.heightAt === 'function') {
      const h = w.heightAt(x, z);
      if (Number.isFinite(h)) return h;
    }
    return 0;
  }
  function waterAt(x, z) {
    const w = ctx.world;
    if (!w || typeof w.isWater !== 'function') return false;
    try { return !!w.isWater(x, z); } catch { return false; }
  }
  const _nrm = new THREE.Vector3();
  function terrainNormal(x, z, out) {
    const w = ctx.world;
    if (w && typeof w.normalAt === 'function') {
      const n = w.normalAt(x, z);
      if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) return out.set(n.x, n.y, n.z).normalize();
    }
    const e = 0.5;
    return out.set(terrainH(x - e, z) - terrainH(x + e, z), 2 * e, terrainH(x, z - e) - terrainH(x, z + e)).normalize();
  }
  function blockedAt(x, z, pad) {
    const w = ctx.world;
    const cols = w?.colliders;
    if (Array.isArray(cols)) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c) continue;
        const dx = c.x - x, dz = c.z - z, rr = (c.r || 0) + pad;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    const boxes = w?.boxColliders;
    if (Array.isArray(boxes)) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!b?.min || !b?.max) continue;
        if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true;
      }
    }
    return false;
  }
  function minTerrainOverCell(cx, cz) {
    const x0 = cx * CELL, z0 = cz * CELL;
    let m = Infinity;
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
      const h = terrainH(x0 + 0.1 + i * 0.9, z0 + 0.1 + j * 0.9);
      if (h < m) m = h;
    }
    return m;
  }

  // ---------- materials ----------
  const clay = makeClayTextures();
  clay.map.repeat.set(1, 1);
  const earthMat = new THREE.MeshStandardMaterial({
    map: clay.map, normalMap: clay.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    vertexColors: true, roughness: 0.95, metalness: 0,
    emissive: new THREE.Color(0x15120e), emissiveIntensity: 0.1,
  });
  earthMat.name = 'tunnelEarth';
  // Baked oil-lamp light arrives per vertex in the `bake` attribute and is
  // added as albedo-weighted emission (so the clay texture and vertex AO still
  // show); bakeGain carries a gentle shared flicker.
  const bakeGain = { value: 1 };
  // World-space triplanar mapping: no uv seams where walls bend into the arched
  // ceiling, no stretching on slopes. Chunk meshes sit at the origin, so object
  // space is world space. A second, larger and rotated projection is blended
  // in to break up the tile repeat.
  earthMat.customProgramCacheKey = () => 'tunnelEarthTriplanarBaked';
  earthMat.onBeforeCompile = (sh) => {
    sh.uniforms.triScale = { value: 1 / TEX_SCALE };
    sh.uniforms.bakeGain = bakeGain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTriPos;
varying vec3 vTriNrm;
varying vec3 vBake;
uniform float triScale;
uniform float bakeGain;
vec3 triW;
vec2 triUvX; vec2 triUvY; vec2 triUvZ;`)
      .replace('#include <map_fragment>', `
{
  vec3 an = abs(normalize(vTriNrm));
  triW = pow(an, vec3(4.0));
  triW /= (triW.x + triW.y + triW.z);
  triUvX = vTriPos.zy * triScale;
  triUvY = vTriPos.xz * triScale * 0.85 + vec2(0.37, 0.61);
  triUvZ = vTriPos.xy * triScale + vec2(0.71, 0.19);
  vec4 tc = texture2D(map, triUvX) * triW.x + texture2D(map, triUvY) * triW.y + texture2D(map, triUvZ) * triW.z;
  float s2 = triScale * 0.383;
  vec4 tc2 = texture2D(map, vec2(vTriPos.y, -vTriPos.z) * s2 + vec2(0.23, 0.41)) * triW.x
           + texture2D(map, vec2(vTriPos.z, -vTriPos.x) * s2 + vec2(0.57, 0.11)) * triW.y
           + texture2D(map, vec2(vTriPos.y, -vTriPos.x) * s2 + vec2(0.13, 0.87)) * triW.z;
  diffuseColor *= mix(tc, tc2, 0.36);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vBake * bakeGain;`)
      // Dim lamp-lit clay is seen with mesopic vision: colour saturation drops
      // as light falls, so warm lamps read as tan-brown rather than neon.
      .replace('#include <opaque_fragment>', `{
  float lumO = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = max(mix(vec3(lumO), outgoingLight, mix(0.58, 0.86, smoothstep(0.0, 0.35, lumO))), vec3(0.0));
}
#include <opaque_fragment>`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 wn = normalize(vTriNrm);
  vec3 tX = texture2D(normalMap, triUvX).xyz * 2.0 - 1.0;
  vec3 tY = texture2D(normalMap, triUvY).xyz * 2.0 - 1.0;
  vec3 tZ = texture2D(normalMap, triUvZ).xyz * 2.0 - 1.0;
  tX.xy *= normalScale; tY.xy *= normalScale; tZ.xy *= normalScale;
  tX = vec3(tX.xy + wn.zy, abs(tX.z) * wn.x);
  tY = vec3(tY.xy + wn.xz, abs(tY.z) * wn.y);
  tZ = vec3(tZ.xy + wn.xy, abs(tZ.z) * wn.z);
  vec3 pw = normalize(tX.zyx * triW.x + tY.xzy * triW.y + tZ.xyz * triW.z);
  normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);
}`);
  };
  const rootMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: new THREE.Color(0x1a100a), emissiveIntensity: 0.25 });
  rootMat.name = 'tunnelRoots';
  const leafTex = makeLeafAtlas();
  const litterTex = makeLitterTexture();
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, color: 0xd0c4ac, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  const litterMat = new THREE.MeshStandardMaterial({
    map: litterTex, color: 0xe2dacb, alphaTest: 0.4, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const plankMat = new THREE.MeshStandardMaterial({ map: makePlankTexture(), roughness: 0.9 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
  const leakMat = new THREE.MeshBasicMaterial({
    map: makeCrackTexture(), color: new THREE.Color(1.0, 0.95, 0.75), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false,
  });
  const coneMat = new THREE.MeshBasicMaterial({
    vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const pitMat = new THREE.MeshStandardMaterial({
    map: makePitTexture(), transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const crateMat = new THREE.MeshStandardMaterial({ map: makeCrateTexture(), roughness: 0.85 });
  const burlapTex = makeBurlapTexture();
  burlapTex.repeat.set(3, 2);
  const burlapMat = new THREE.MeshStandardMaterial({ map: burlapTex, roughness: 1 });
  const weaveMat = new THREE.MeshStandardMaterial({ map: makeWeaveTexture(), roughness: 0.9 });
  const jarMat = new THREE.MeshStandardMaterial({ color: 0x7c4a2a, roughness: 0.55 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x4d4130, metalness: 0.65, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d8, transparent: true, opacity: 0.32, roughness: 0.08,
    emissive: new THREE.Color(0xffc890), emissiveIntensity: 0.7, depthWrite: false,
  });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const haloMat = new THREE.SpriteMaterial({
    map: makeHaloTexture(), color: 0xffc890, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity: 0.5, fog: false,
  });

  // ---------- shared surface geometries ----------
  const lidPlankGeo = (() => {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.BoxGeometry(0.9, 0.035, 0.168);
      if (i % 2) b.rotateY(Math.PI);
      b.translate(0, 0.0175, -0.36 + i * 0.18 + 0.45);
      parts.push(b);
    }
    for (const sx of [-0.3, 0.3]) {
      const b = new THREE.BoxGeometry(0.07, 0.04, 0.86);
      b.translate(sx, -0.02, 0.45);
      parts.push(b);
    }
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return geo;
  })();
  const lidLitterGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2).translate(0, 0.037, 0.45);
  const holeGeo = new THREE.PlaneGeometry(0.84, 0.84).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
  const leakGeo = new THREE.PlaneGeometry(0.86, 0.86).rotateX(Math.PI / 2).translate(0, -0.003, 0.45);
  const lidLeafGeos = [];
  for (let v = 0; v < 3; v++) {
    const r = rand(500 + v);
    const L = { p: [], n: [], u: [], i: [] };
    for (let k = 0; k < 13; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.52;
      pushLeaf(L, Math.cos(a) * d, 0.042 + r() * 0.02, Math.sin(a) * d + 0.45, r() * Math.PI * 2,
        0.07 + r() * 0.06, 0.045 + r() * 0.03, 0.15 + r() * 0.25, (r() - 0.5) * 0.15, (r() * 4) | 0);
    }
    lidLeafGeos.push(buildGeometry(L.p, L.n, L.u, null, L.i));
  }
  const stakeGeo = (() => {
    const r = rand(9090);
    const parts = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = i * 0.27 + (r() - 0.5) * 0.08, z = j * 0.27 + (r() - 0.5) * 0.08;
      const h = 0.48 + r() * 0.18;
      const geo = new THREE.ConeGeometry(0.028, h, 6, 1);
      geo.translate(0, h * 0.5 - 0.3, 0);
      geo.rotateX((r() - 0.5) * 0.25);
      geo.rotateZ((r() - 0.5) * 0.25);
      geo.translate(x, 0, z);
      // bamboo body, fire-hardened dark tips
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      const pa = geo.attributes.position;
      for (let k = 0; k < n; k++) {
        const t = clamp((pa.getY(k) + 0.3) / h, 0, 1);
        const dark = smoothstep(0.65, 1, t);
        col[k * 3] = 0.44 * (1 - dark * 0.7);
        col[k * 3 + 1] = 0.37 * (1 - dark * 0.75);
        col[k * 3 + 2] = 0.21 * (1 - dark * 0.7);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(geo);
    }
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return geo;
  })();

  // Terrain-conforming square patch in local coords relative to (ox, oy, oz).
  function conformPlane(ox, oy, oz, size, segs, lift, rot, mound, aspect = 1) {
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    if (aspect !== 1) geo.scale(1, 1, aspect);
    geo.rotateY(rot);
    const pa = geo.attributes.position;
    const half = size * 0.5;
    for (let i = 0; i < pa.count; i++) {
      const lx = pa.getX(i), lz = pa.getZ(i);
      const rr = Math.min(1, Math.sqrt(lx * lx + lz * lz) / half);
      pa.setY(i, terrainH(ox + lx, oz + lz) - oy + lift + mound * (1 - rr * rr));
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
  function leafScatter(ox, oy, oz, count, rMin, rMax, rng, lift) {
    const L = { p: [], n: [], u: [], i: [] };
    for (let k = 0; k < count; k++) {
      const a = rng() * Math.PI * 2, d = rMin + Math.sqrt(rng()) * (rMax - rMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      pushLeaf(L, x, terrainH(ox + x, oz + z) - oy + lift + rng() * 0.015, z, rng() * Math.PI * 2,
        0.06 + rng() * 0.08, 0.04 + rng() * 0.035, 0.1 + rng() * 0.3, (rng() - 0.5) * 0.2, (rng() * 4) | 0);
    }
    return buildGeometry(L.p, L.n, L.u, null, L.i);
  }

  // ---------- cell records ----------
  function getCell(cx, cz) { return cells.get(keyOf(cx, cz)); }
  function getChunk(cx, cz) {
    const kx = Math.floor(cx / CHUNK), kz = Math.floor(cz / CHUNK);
    const k = keyOf(kx, kz);
    let ch = chunks.get(k);
    if (!ch) {
      ch = { key: k, kx, kz, cells: new Set(), earthMesh: null, rootMesh: null,
        wx: (kx + 0.5) * CHUNK * CELL, wz: (kz + 0.5) * CHUNK * CELL };
      chunks.set(k, ch);
      chunkList.push(ch);
    }
    return ch;
  }
  function addCellRaw(cx, cz, floor) {
    const k = keyOf(cx, cz);
    let c = cells.get(k);
    if (c) return c;
    c = { cx, cz, key: k, floor, chamber: false, links: 0, strips: 0, hatch: null, props: null,
      earth: null, roots: null, chunk: null, room: -1, sig: null };
    cells.set(k, c);
    c.chunk = getChunk(cx, cz);
    c.chunk.cells.add(c);
    refreshStripsAround(cx, cz);
    markAround(cx, cz);
    return c;
  }
  function linkRaw(a, b) {
    for (let d = 0; d < 4; d++) {
      if (a.cx + DX[d] === b.cx && a.cz + DZ[d] === b.cz) {
        a.links |= BIT[d];
        b.links |= BIT[OPP[d]];
        refreshStrips(a); refreshStrips(b);
        markAround(a.cx, a.cz);
        markAround(b.cx, b.cz);
        return true;
      }
    }
    return false;
  }
  function refreshStrips(c) {
    let s = 0;
    if (c.chamber) {
      for (let d = 0; d < 4; d++) {
        const nb = getCell(c.cx + DX[d], c.cz + DZ[d]);
        if (nb && nb.chamber && !(c.links & BIT[d])) s |= BIT[d];
      }
    }
    c.strips = s;
  }
  function refreshStripsAround(cx, cz) {
    const c = getCell(cx, cz);
    if (c) refreshStrips(c);
    for (let d = 0; d < 4; d++) {
      const nb = getCell(cx + DX[d], cz + DZ[d]);
      if (nb) refreshStrips(nb);
    }
  }
  // Candidate cells whose mesh may depend on (cx, cz): a cell's mesh reads the
  // floor values of its 3x3 neighbourhood, and an undug cell's floor value is
  // the mean of its dug 4-neighbours, so influence reaches two cells. Most
  // candidates are rejected cheaply by their signature in processDirty.
  function markAround(cx, cz) {
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) dirty.add(keyOf(cx + i, cz + j));
    version++;
  }

  // ---------- chamber rooms (connected chamber cells) ----------
  let roomCount = 0;
  function recomputeRooms() {
    for (const c of cells.values()) c.room = -1;
    roomCount = 0;
    const stack = [];
    for (const c of cells.values()) {
      if (!c.chamber || c.room >= 0) continue;
      const id = roomCount++;
      c.room = id;
      stack.push(c);
      while (stack.length) {
        const a = stack.pop();
        for (let d = 0; d < 4; d++) {
          if (!(a.links & BIT[d])) continue;
          const nb = getCell(a.cx + DX[d], a.cz + DZ[d]);
          if (nb && nb.chamber && nb.room < 0) { nb.room = id; stack.push(nb); }
        }
      }
    }
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      l.room = getCell(l.cx, l.cz)?.room ?? -1;
    }
  }

  // ---------- baked lamps ----------
  // Fixed oil lamps bake warm light into the vertex `bake` attribute of nearby
  // cells. Light reaches the lamp's room (its connected chamber cells) fully
  // and the tunnel mouths linked to it partly; earth walls block the rest.
  const lamps = [];
  const LAMP_R = 7.5;
  function cellLampVis(l, c) {
    if (c.chamber && c.room >= 0 && c.room === l.room) return 1;
    if (l.room < 0) return c.cx === l.cx && c.cz === l.cz ? 1 : 0;
    for (let d = 0; d < 4; d++) {
      if (!(c.links & BIT[d])) continue;
      const nb = getCell(c.cx + DX[d], c.cz + DZ[d]);
      if (nb && nb.chamber && nb.room === l.room) return 0.55;
    }
    return 0;
  }
  function lampVis(l, cx, cz) {
    const c = getCell(cx, cz);
    if (c) return cellLampVis(l, c);
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nb = getCell(cx + DX[d], cz + DZ[d]);
      if (nb) { const v = cellLampVis(l, nb); if (v > m) m = v; }
    }
    return m;
  }
  function lampNear(l, cx, cz) {
    const dx = (cx + 0.5) * CELL - l.x, dz = (cz + 0.5) * CELL - l.z;
    const rr = LAMP_R + CELL * 1.5;
    return dx * dx + dz * dz < rr * rr;
  }

  // ---------- mesh signature ----------
  // Everything buildCell reads, reduced to what can actually reach the cell:
  // floor values of the 3x3 block, the wall state of each neighbour on the
  // sides facing this cell, baked lamp visibility, and the cell's own hatch.
  const SIG_N = 9 * 3 + 2;
  const sigTmp = new Float64Array(SIG_N);
  function relMask(i, j) {
    if (i === 0 && j === 0) return 15;
    if (i === 0 || j === 0) {
      // 4-neighbour: everything except its far side
      return 15 & ~(i > 0 ? 1 : i < 0 ? 2 : j > 0 ? 4 : 8);
    }
    // diagonal: only the two sides facing this cell
    return (i > 0 ? 2 : 1) | (j > 0 ? 8 : 4);
  }
  function stateCode(n, i, j) {
    if (!n) return 0;
    const m = relMask(i, j);
    return 1 + (n.chamber ? 2 : 0) + (n.links & m) * 4 + (n.strips & m) * 64;
  }
  function computeSig(c, out) {
    let o = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = c.cx + i, cz = c.cz + j;
        out[o++] = cellFloorValue(cx, cz);
        out[o++] = stateCode(getCell(cx, cz), i, j);
        let lc = 0;
        for (let l = 0; l < lamps.length; l++) {
          const L = lamps[l];
          if (!lampNear(L, c.cx, c.cz)) continue;
          lc += lampVis(L, cx, cz) * (1 + l * 0.7071);
        }
        out[o++] = lc;
      }
    }
    out[o++] = c.hatch ? 1 : 0;
    out[o++] = c.hatch ? c.hatch.y : 0;
    return out;
  }
  function sigChanged(c) {
    computeSig(c, sigTmp);
    const s = c.sig;
    if (!s) return true;
    for (let i = 0; i < SIG_N; i++) if (s[i] !== sigTmp[i]) return true;
    return false;
  }

  // ---------- floor field ----------
  function cellFloorValue(cx, cz) {
    const c = cells.get(keyOf(cx, cz));
    if (c) return c.floor;
    let s = 0, n = 0;
    for (let d = 0; d < 4; d++) {
      const nb = cells.get(keyOf(cx + DX[d], cz + DZ[d]));
      if (nb) { s += nb.floor; n++; }
    }
    if (n) return s / n;
    return terrainH((cx + 0.5) * CELL, (cz + 0.5) * CELL) - DEPTH;
  }
  // Bilinear between cell centres: continuous everywhere, linear along straight runs.
  function floorSmooth(x, z) {
    const u = x / CELL - 0.5, w = z / CELL - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(w);
    const fu = u - i0, fw = w - j0;
    const a = cellFloorValue(i0, j0), b = cellFloorValue(i0 + 1, j0);
    const c = cellFloorValue(i0, j0 + 1), d = cellFloorValue(i0 + 1, j0 + 1);
    const top = a + (b - a) * fu, bot = c + (d - c) * fu;
    return top + (bot - top) * fw;
  }

  // ---------- solids (AABBs in XZ) ----------
  const SOLMAX = 200;
  const SOL = new Float64Array(SOLMAX * 4);
  let solN = 0, solKey = NaN, solVer = -1, solProps = false;
  function pushBox(a, b, c, d) {
    if (solN >= SOLMAX) return;
    const o = solN * 4;
    SOL[o] = a; SOL[o + 1] = b; SOL[o + 2] = c; SOL[o + 3] = d;
    solN++;
  }
  function cellSolids(cx, cz, props) {
    const x0 = cx * CELL, z0 = cz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const c = cells.get(keyOf(cx, cz));
    if (!c) { pushBox(x0, z0, x1, z1); return; }
    if (c.chamber) {
      const s = c.strips;
      if (s & 1) pushBox(x1 - 0.25, z0, x1, z1);
      if (s & 2) pushBox(x0, z0, x0 + 0.25, z1);
      if (s & 4) pushBox(x0, z1 - 0.25, x1, z1);
      if (s & 8) pushBox(x0, z0, x1, z0 + 0.25);
    } else {
      const a = x0 + 0.5, b = x0 + 1.5, e = z0 + 0.5, f = z0 + 1.5;
      const L = c.links;
      if (!(L & 1)) pushBox(b, z0, x1, z1);
      if (!(L & 2)) pushBox(x0, z0, a, z1);
      if (!(L & 4)) pushBox(x0, f, x1, z1);
      if (!(L & 8)) pushBox(x0, z0, x1, e);
      if ((L & 1) && (L & 8)) pushBox(b, z0, x1, e);
      if ((L & 1) && (L & 4)) pushBox(b, f, x1, z1);
      if ((L & 2) && (L & 8)) pushBox(x0, z0, a, e);
      if ((L & 2) && (L & 4)) pushBox(x0, f, a, z1);
    }
    if (props && c.props) {
      const p = c.props;
      for (let i = 0; i < p.length; i += 4) pushBox(p[i], p[i + 1], p[i + 2], p[i + 3]);
    }
  }
  function gather(cx, cz, props) {
    const k = keyOf(cx, cz);
    if (k === solKey && solVer === version && solProps === props) return;
    solN = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) cellSolids(cx + i, cz + j, props);
    solKey = k; solVer = version; solProps = props;
  }
  function distSolid(x, z) {
    let best2 = 1.0;
    for (let i = 0; i < solN; i++) {
      const o = i * 4;
      const dx = SOL[o] - x > 0 ? SOL[o] - x : (x - SOL[o + 2] > 0 ? x - SOL[o + 2] : 0);
      const dz = SOL[o + 1] - z > 0 ? SOL[o + 1] - z : (z - SOL[o + 3] > 0 ? z - SOL[o + 3] : 0);
      const d2 = dx * dx + dz * dz;
      if (d2 < best2) { best2 = d2; if (d2 === 0) return 0; }
    }
    return Math.sqrt(best2);
  }

  // Free-space test at a point (walls only, props excluded).
  function isFreeAt(x, z) {
    const cx = cellIndex(x), cz = cellIndex(z);
    const c = cells.get(keyOf(cx, cz));
    if (!c) return false;
    const lx = x - cx * CELL, lz = z - cz * CELL;
    if (c.chamber) {
      const s = c.strips;
      if ((s & 1) && lx > CELL - 0.25) return false;
      if ((s & 2) && lx < 0.25) return false;
      if ((s & 4) && lz > CELL - 0.25) return false;
      if ((s & 8) && lz < 0.25) return false;
      return true;
    }
    const inX = lx >= 0.5 && lx <= 1.5, inZ = lz >= 0.5 && lz <= 1.5;
    if (inX && inZ) return true;
    if (inZ) return !!(lx > 1.5 ? (c.links & 1) : (c.links & 2));
    if (inX) return !!(lz > 1.5 ? (c.links & 4) : (c.links & 8));
    return false;
  }
  // Sub-cell class: 0 solid, 1 crawl, 2 chamber. li/lj may spill one ring into neighbours.
  function subClass(cx, cz, li, lj) {
    if (li < 0) { cx--; li += SUB; } else if (li >= SUB) { cx++; li -= SUB; }
    if (lj < 0) { cz--; lj += SUB; } else if (lj >= SUB) { cz++; lj -= SUB; }
    const c = cells.get(keyOf(cx, cz));
    if (!c) return 0;
    if (c.chamber) {
      const s = c.strips;
      if ((s & 1) && li >= SUB - 2) return 0;
      if ((s & 2) && li < 2) return 0;
      if ((s & 4) && lj >= SUB - 2) return 0;
      if ((s & 8) && lj < 2) return 0;
      return 2;
    }
    const inX = li >= 4 && li < 12, inZ = lj >= 4 && lj < 12;
    if (inX && inZ) return 1;
    if (inZ) return (li >= 12 ? (c.links & 1) : (c.links & 2)) ? 1 : 0;
    if (inX) return (lj >= 12 ? (c.links & 4) : (c.links & 8)) ? 1 : 0;
    return 0;
  }

  // ---------- public spatial queries ----------
  function isDug(cx, cz) { return cells.has(keyOf(cx, cz)); }
  function cellOf(x, z, out) {
    const o = out || {};
    o.cx = cellIndex(x); o.cz = cellIndex(z);
    return o;
  }
  function floorAt(x, z) {
    if (!cells.has(keyOf(cellIndex(x), cellIndex(z)))) return null;
    const fy = floorSmooth(x, z) + bump(x, z);
    return fy + dispY(x, fy, z);
  }
  function cellCenter(cx, cz, out) {
    const o = out || new THREE.Vector3();
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    const f = floorAt(x, z);
    return o.set(x, f === null ? cellFloorValue(cx, cz) : f, z);
  }
  function ceilingAt(x, z) {
    const cx = cellIndex(x), cz = cellIndex(z);
    const c = cells.get(keyOf(cx, cz));
    if (!c) return null;
    if (c.hatch) {
      const lx = x - cx * CELL, lz = z - cz * CELL;
      if (lx >= 0.5 && lx <= 1.5 && lz >= 0.5 && lz <= 1.5) return c.hatch.y - 0.15;
    }
    gather(cx, cz, false);
    const fs = floorSmooth(x, z);
    const y = ceilY(fs, distSolid(x, z), x, z, c.chamber);
    return y + dispY(x, y, z) - 0.03;
  }

  // ---------- cell mesh builder ----------
  // Grid samples are evaluated lazily (only points a free sub-cell or its
  // normal stencil touches) and stamped per build; displaced wall positions
  // are cached per (grid point, wall level) so tangents reuse noise samples.
  const gFs = new Float64Array(GG), gFy = new Float64Array(GG), gD = new Float64Array(GG), gCy = new Float64Array(GG);
  const gFP = new Float64Array(GG * 3), gCP = new Float64Array(GG * 3);
  const gStamp = new Int32Array(GG);
  // per grid point: y-independent noise terms of the displacement and colour
  const gNX = new Float64Array(GG), gNY = new Float64Array(GG), gNZ = new Float64Array(GG);
  const gC = new Float64Array(GG * 3), gCStamp = new Int32Array(GG);
  const KW = KMAX + 3;                  // wall levels -1 .. KMAX+1
  const wPos = new Float64Array(GG * KW * 3);
  const wStamp = new Int32Array(GG * KW);
  let buildId = 0;
  const mask = new Int8Array(M * M);
  const fMap = new Int32Array(GG), cMap = new Int32Array(GG);
  const wMap = new Int32Array(4 * GG * (KMAX + 1));
  const sMap = new Int32Array(4 * GG * (KSHAFT + 1));
  const P = [], N = [], U = [], Cl = [], Bk = [], I = [];
  const RP = [], RN = [], RC = [], RI = [];
  let bx = 0, bz = 0, bcx = 0, bcz = 0, bChamber = false, bK = KCRAWL, bShaftK = 2, bSx = 0, bSz = 0;
  const bFv = new Float64Array(9);      // floor values of the 3x3 block around the cell
  const MAX_BL = 6;
  const bLamp = new Array(MAX_BL).fill(null);
  const bVis = new Float64Array(9 * MAX_BL);
  let bLampN = 0;

  const gIdx = (i, j) => (i + 1) + (j + 1) * G;

  // Same lattice and arithmetic as floorSmooth, reading the cached 3x3 block.
  function floorLocal(x, z) {
    const u = x / CELL - 0.5, w = z / CELL - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(w);
    const fu = u - i0, fw = w - j0;
    const o = (i0 - bcx + 1) + (j0 - bcz + 1) * 3;
    const a = bFv[o], b = bFv[o + 1], c = bFv[o + 3], d = bFv[o + 4];
    const top = a + (b - a) * fu, bot = c + (d - c) * fu;
    return top + (bot - top) * fw;
  }
  function ensureG(g) {
    if (gStamp[g] === buildId) return;
    gStamp[g] = buildId;
    const i = (g % G) - 1, j = ((g / G) | 0) - 1;
    const X = bx + i * SS, Z = bz + j * SS;
    const fs = floorLocal(X, Z);
    const fy = fs + bump(X, Z);
    const d = distSolid(X, Z);
    const cy = ceilY(fs, d, X, Z, bChamber);
    gFs[g] = fs; gFy[g] = fy; gD[g] = d; gCy[g] = cy;
    gNX[g] = noise2D(X * 0.5 - 4.1, Z * 0.5 + 7.7);
    gNY[g] = noise2D(X * DF + 41.3, Z * DF - 3.3);
    gNZ[g] = noise2D(Z * 0.5 + 3.3, X * 0.5 - 1.9);
    const g3 = g * 3;
    gFP[g3] = X + gDispX(g, X, fy, Z); gFP[g3 + 1] = fy + gDispY(g, X, fy, Z); gFP[g3 + 2] = Z + gDispZ(g, X, fy, Z);
    gCP[g3] = X + gDispX(g, X, cy, Z); gCP[g3 + 1] = cy + gDispY(g, X, cy, Z); gCP[g3 + 2] = Z + gDispZ(g, X, cy, Z);
  }
  // dispX/Y/Z at a grid point, reusing the cached (x, z) noise; same arithmetic.
  function gDispX(g, x, y, z) { return DA * (0.7 * noise2D(z * DF + 13.1, y * DF - 2.3) + 0.3 * gNX[g]); }
  function gDispY(g, x, y, z) { return DA * 0.6 * (0.65 * gNY[g] + 0.35 * noise2D(x * 2.1 - 9.2, z * 2.1 + y * 0.8)); }
  function gDispZ(g, x, y, z) { return DA * (0.7 * noise2D(x * DF - 29.4, y * DF + 5.2) + 0.3 * gNZ[g]); }
  function gColor(g, x, y, z, k) {
    const o = g * 3;
    if (gCStamp[g] !== buildId) { gCStamp[g] = buildId; earthColorXZ(x, z, CXZ); gC[o] = CXZ[0]; gC[o + 1] = CXZ[1]; gC[o + 2] = CXZ[2]; }
    earthColorY(x, y, z, k, gC[o], gC[o + 1], gC[o + 2]);
  }

  // Baked lamp light for a vertex: inverse-distance falloff, wrapped Lambert,
  // scaled by the lamp's visibility interpolated over the 3x3 cell block.
  function pushBake(x, y, z, nx, ny, nz, X, Z) {
    let r = 0, gg = 0, b = 0;
    if (bLampN) {
      const u = X / CELL - 0.5, w = Z / CELL - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(w);
      const fu = u - i0, fw = w - j0;
      const o0 = (i0 - bcx + 1) + (j0 - bcz + 1) * 3;
      for (let l = 0; l < bLampN; l++) {
        const o = l * 9 + o0;
        const va = bVis[o], vb = bVis[o + 1], vc = bVis[o + 3], vd = bVis[o + 4];
        const top = va + (vb - va) * fu, bot = vc + (vd - vc) * fu;
        const vis = top + (bot - top) * fw;
        if (vis <= 0.002) continue;
        const L = bLamp[l];
        const dx = L.x - x, dy = L.y - y, dz = L.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= LAMP_R * LAMP_R) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const ndl = (nx * dx + ny * dy + nz * dz) / d;
        const wrap = ndl > -0.3 ? (ndl + 0.3) / 1.3 : 0;
        const t = d2 / (LAMP_R * LAMP_R), win = (1 - t * t);
        const e = L.power * vis * (0.82 * wrap + 0.18) * win * win / (Math.pow(d, 1.6) + 0.35);
        r += e * LAMP_COL.r; gg += e * LAMP_COL.g; b += e * LAMP_COL.b;
      }
    }
    Bk.push(r < 2 ? r : 2, gg < 2 ? gg : 2, b < 2 ? b : 2);
  }

  function pushVert(x, y, z, nx, ny, nz, u, v, k, cx, cy, cz, g) {
    const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= il; ny *= il; nz *= il;
    P.push(x, y, z);
    N.push(nx, ny, nz);
    U.push(u, v);
    gColor(g, cx, cy, cz, k);
    Cl.push(COL[0], COL[1], COL[2]);
    pushBake(x, y, z, nx, ny, nz, cx, cz);
    return P.length / 3 - 1;
  }

  function floorVert(i, j) {
    const g = gIdx(i, j);
    let v = fMap[g];
    if (v >= 0) return v;
    ensureG(g); ensureG(g + 1); ensureG(g - 1); ensureG(g + G); ensureG(g - G);
    const g3 = g * 3, ga = (g + 1) * 3, gb = (g - 1) * 3, gc = (g + G) * 3, gd = (g - G) * 3;
    const tx0 = gFP[ga] - gFP[gb], tx1 = gFP[ga + 1] - gFP[gb + 1], tx2 = gFP[ga + 2] - gFP[gb + 2];
    const tz0 = gFP[gc] - gFP[gd], tz1 = gFP[gc + 1] - gFP[gd + 1], tz2 = gFP[gc + 2] - gFP[gd + 2];
    const X = bx + i * SS, Z = bz + j * SS;
    const ao = 0.5 + 0.24 * smoothstep(0, 0.42, gD[g]);
    v = pushVert(gFP[g3], gFP[g3 + 1], gFP[g3 + 2],
      tz1 * tx2 - tz2 * tx1, tz2 * tx0 - tz0 * tx2, tz0 * tx1 - tz1 * tx0,
      X / TEX_SCALE * 0.8, Z / TEX_SCALE * 0.8, ao, X, gFy[g], Z, g);
    fMap[g] = v;
    return v;
  }
  function ceilVert(i, j) {
    const g = gIdx(i, j);
    let v = cMap[g];
    if (v >= 0) return v;
    ensureG(g); ensureG(g + 1); ensureG(g - 1); ensureG(g + G); ensureG(g - G);
    const g3 = g * 3, ga = (g + 1) * 3, gb = (g - 1) * 3, gc = (g + G) * 3, gd = (g - G) * 3;
    const tx0 = gCP[ga] - gCP[gb], tx1 = gCP[ga + 1] - gCP[gb + 1], tx2 = gCP[ga + 2] - gCP[gb + 2];
    const tz0 = gCP[gc] - gCP[gd], tz1 = gCP[gc + 1] - gCP[gd + 1], tz2 = gCP[gc + 2] - gCP[gd + 2];
    const X = bx + i * SS, Z = bz + j * SS;
    const ao = 0.62 + 0.26 * smoothstep(0, 0.5, gD[g]);
    v = pushVert(gCP[g3], gCP[g3 + 1], gCP[g3 + 2],
      tx1 * tz2 - tx2 * tz1, tx2 * tz0 - tx0 * tz2, tx0 * tz1 - tx1 * tz0,
      X / TEX_SCALE, Z / TEX_SCALE, ao, X, gCy[g], Z, g);
    cMap[g] = v;
    return v;
  }
  function wallY(g, f) { return gFy[g] * (1 - f) + gCy[g] * f; }
  // Displaced wall point at grid point g, level k (k may be -1 or K+1 for tangents).
  function wallPos(g, k) {
    const s = g * KW + k + 1, o = s * 3;
    if (wStamp[s] !== buildId) {
      wStamp[s] = buildId;
      ensureG(g);
      const i = (g % G) - 1, j = ((g / G) | 0) - 1;
      const X = bx + i * SS, Z = bz + j * SS;
      const y = wallY(g, k / bK);
      wPos[o] = X + gDispX(g, X, y, Z); wPos[o + 1] = y + gDispY(g, X, y, Z); wPos[o + 2] = Z + gDispZ(g, X, y, Z);
    }
    return o;
  }
  function wallVert(d, i, j, k) {
    const g = gIdx(i, j);
    const key = (d * GG + g) * (KMAX + 1) + k;
    let v = wMap[key];
    if (v >= 0) return v;
    const f = k / bK;
    const X = bx + i * SS, Z = bz + j * SS;
    // tangent along the wall
    const pa = wallPos(d < 2 ? g + G : g + 1, k), pb = wallPos(d < 2 ? g - G : g - 1, k);
    const t0 = wPos[pa] - wPos[pb], t1 = wPos[pa + 1] - wPos[pb + 1], t2 = wPos[pa + 2] - wPos[pb + 2];
    // vertical tangent
    const pu = wallPos(g, k + 1), pd = wallPos(g, k - 1);
    const b0 = wPos[pu] - wPos[pd], b1 = wPos[pu + 1] - wPos[pd + 1], b2 = wPos[pu + 2] - wPos[pd + 2];
    let nx = t1 * b2 - t2 * b1, ny = t2 * b0 - t0 * b2, nz = t0 * b1 - t1 * b0;
    if (nx * -DX[d] + nz * -DZ[d] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const ao = 0.5 + 0.45 * smoothstep(0, 0.3, f) - 0.33 * smoothstep(0.7, 1, f);
    const p = wallPos(g, k);
    const y = wallY(g, f);
    v = pushVert(wPos[p], wPos[p + 1], wPos[p + 2], nx, ny, nz,
      (d < 2 ? Z : X) / TEX_SCALE, y / TEX_SCALE, ao, X, y, Z, g);
    wMap[key] = v;
    return v;
  }
  function edgeEnds(d, si, sj, out) {
    switch (d) {
      case 0: out[0] = si + 1; out[1] = sj; out[2] = si + 1; out[3] = sj + 1; break;
      case 1: out[0] = si; out[1] = sj; out[2] = si; out[3] = sj + 1; break;
      case 2: out[0] = si; out[1] = sj + 1; out[2] = si + 1; out[3] = sj + 1; break;
      default: out[0] = si; out[1] = sj; out[2] = si + 1; out[3] = sj; break;
    }
    return out;
  }
  const EE = [0, 0, 0, 0];
  function quad(A, B, C, D, flip) {
    if (!flip) I.push(A, B, C, A, C, D);
    else I.push(A, C, B, A, D, C);
  }
  function emitWall(d, si, sj) {
    edgeEnds(d, si, sj, EE);
    const flip = d === 1 || d === 2;
    for (let k = 0; k < bK; k++) {
      quad(wallVert(d, EE[0], EE[1], k), wallVert(d, EE[2], EE[3], k),
        wallVert(d, EE[2], EE[3], k + 1), wallVert(d, EE[0], EE[1], k + 1), flip);
    }
  }
  // Step between a crawl ceiling and a higher chamber ceiling.
  const LID = [0, 0, 0, 0, 0, 0];
  function emitLintel(d, si, sj) {
    edgeEnds(d, si, sj, EE);
    const flip = d === 1 || d === 2;
    const nx = -DX[d], nz = -DZ[d];
    for (let e = 0; e < 2; e++) {
      const i = EE[e * 2], j = EE[e * 2 + 1], g = gIdx(i, j);
      ensureG(g);
      const X = bx + i * SS, Z = bz + j * SS;
      const lo = ceilY(gFs[g], gD[g], X, Z, false), hi = gCy[g];
      for (let k = 0; k <= 2; k++) {
        const f = k / 2, y = lo * (1 - f) + hi * f;
        LID[e * 3 + k] = pushVert(X + gDispX(g, X, y, Z), y + gDispY(g, X, y, Z), Z + gDispZ(g, X, y, Z), nx, 0, nz,
          (d < 2 ? Z : X) / TEX_SCALE, y / TEX_SCALE, 0.7, X, y, Z, g);
      }
    }
    for (let k = 0; k < 2; k++) quad(LID[k], LID[3 + k], LID[3 + k + 1], LID[k + 1], flip);
  }
  function shaftVert(d, i, j, k) {
    const g = gIdx(i, j);
    const key = (d * GG + g) * (KSHAFT + 1) + k;
    let v = sMap[key];
    if (v >= 0) return v;
    ensureG(g);
    const f = k / bShaftK;
    const X = bx + i * SS, Z = bz + j * SS;
    const tX = bSx + (X - bSx) * SHAFT_TAPER, tZ = bSz + (Z - bSz) * SHAFT_TAPER;
    const tY = terrainH(tX, tZ) - 0.05;
    const px = X * (1 - f) + tX * f, py = gCy[g] * (1 - f) + tY * f, pz = Z * (1 - f) + tZ * f;
    const amp = 1 - f * f * f;
    const qx = px + amp * dispX(px, py, pz), qy = py + amp * dispY(px, py, pz), qz = pz + amp * dispZ(px, py, pz);
    P.push(qx, qy, qz);
    N.push(0, 0, 0);
    U.push((d < 2 ? pz : px) / TEX_SCALE, py / TEX_SCALE);
    earthColor(px, py, pz, 0.62 + 0.38 * f);
    Cl.push(COL[0], COL[1], COL[2]);
    pushBake(qx, qy, qz, 0, 0, 0, X, Z);
    v = P.length / 3 - 1;
    sMap[key] = v;
    return v;
  }

  const _rd = [0, 0, 0];
  function addRoot(ox, oy, oz, len, r0, rng) {
    const segs = 7, sides = 4;
    let dx = (rng() - 0.5) * 0.6, dy = -1, dz = (rng() - 0.5) * 0.6;
    let il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz); dx *= il; dy *= il; dz *= il;
    let px = ox, py = oy + 0.05, pz = oz;
    const base = RP.length / 3;
    const shade = 0.7 + rng() * 0.45;
    const cr = 0.22 * shade, cg = 0.17 * shade, cb = 0.115 * shade;
    const step = (len + 0.05) / segs;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = r0 * Math.pow(1 - t, 0.75) + 0.0012;
      // frame: u = dir x Z (or X), w = dir x u
      let ux, uy, uz;
      if (Math.abs(dz) < 0.9) { ux = dy; uy = -dx; uz = 0; } else { ux = 0; uy = dz; uz = -dy; }
      il = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1); ux *= il; uy *= il; uz *= il;
      const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
      for (let q = 0; q < sides; q++) {
        const a = q / sides * Math.PI * 2 + s * 0.5;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = ux * ca + wx * sa, ny = uy * ca + wy * sa, nz = uz * ca + wz * sa;
        RP.push(px + nx * r, py + ny * r, pz + nz * r);
        RN.push(nx, ny, nz);
        const tip = 1 + t * 0.2;
        RC.push(cr * tip, cg * tip, cb * tip);
      }
      if (s < segs) {
        dx += (rng() - 0.5) * 0.9; dz += (rng() - 0.5) * 0.9; dy -= 0.15;
        il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz); dx *= il; dy *= il; dz *= il;
        px += dx * step; py += dy * step; pz += dz * step;
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let q = 0; q < sides; q++) {
        const a = base + s * sides + q, b = base + s * sides + (q + 1) % sides;
        const c = a + sides, d = b + sides;
        RI.push(a, b, c, b, d, c);
      }
    }
    _rd[0] = px; _rd[1] = py; _rd[2] = pz;
  }
  const CLOD_F = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
  const CLOD_V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function addClod(x, y, z, s, rng) {
    const base = RP.length / 3;
    const sh = 0.55 + rng() * 0.3;
    for (let q = 0; q < 6; q++) {
      const v = CLOD_V[q];
      const k = s * (0.7 + rng() * 0.6);
      RP.push(x + v[0] * k, y + v[1] * k * 0.6 + s * 0.25, z + v[2] * k);
      RN.push(v[0], v[1], v[2]);
      RC.push(0.55 * sh, 0.43 * sh, 0.3 * sh);
    }
    for (let i = 0; i < CLOD_F.length; i++) RI.push(base + CLOD_F[i]);
  }

  function prepareBuildLamps(c) {
    bLampN = 0;
    for (let l = 0; l < lamps.length && bLampN < MAX_BL; l++) {
      const L = lamps[l];
      if (!lampNear(L, c.cx, c.cz)) continue;
      const o = bLampN * 9;
      let any = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const v = lampVis(L, c.cx + i, c.cz + j);
        bVis[o + (i + 1) + (j + 1) * 3] = v;
        any += v;
      }
      if (any > 0) bLamp[bLampN++] = L;
    }
  }

  function buildCell(c) {
    c.sig = computeSig(c, c.sig || new Float64Array(SIG_N));
    buildId++;
    bx = c.cx * CELL; bz = c.cz * CELL; bcx = c.cx; bcz = c.cz;
    bChamber = c.chamber;
    bK = c.chamber ? KCHAMBER : KCRAWL;
    P.length = N.length = U.length = Cl.length = Bk.length = I.length = 0;
    RP.length = RN.length = RC.length = RI.length = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) bFv[(i + 1) + (j + 1) * 3] = cellFloorValue(c.cx + i, c.cz + j);
    prepareBuildLamps(c);
    gather(c.cx, c.cz, false);
    for (let j = -1; j <= SUB; j++) for (let i = -1; i <= SUB; i++) mask[(i + 1) + (j + 1) * M] = subClass(c.cx, c.cz, i, j);
    fMap.fill(-1); cMap.fill(-1); wMap.fill(-1); sMap.fill(-1);
    const hatch = c.hatch;
    const inShaft = (i, j) => i >= 4 && i < 12 && j >= 4 && j < 12;

    for (let sj = 0; sj < SUB; sj++) {
      for (let si = 0; si < SUB; si++) {
        const cls = mask[(si + 1) + (sj + 1) * M];
        if (!cls) continue;
        const a = floorVert(si, sj), b = floorVert(si + 1, sj), cc = floorVert(si + 1, sj + 1), d = floorVert(si, sj + 1);
        if ((si + sj) & 1) I.push(a, cc, b, a, d, cc); else I.push(a, d, b, b, d, cc);
        if (!(hatch && inShaft(si, sj))) {
          const ca = ceilVert(si, sj), cb = ceilVert(si + 1, sj), c2 = ceilVert(si + 1, sj + 1), cd = ceilVert(si, sj + 1);
          if ((si + sj) & 1) I.push(ca, cb, c2, ca, c2, cd); else I.push(ca, cb, cd, cb, c2, cd);
        }
        for (let dd = 0; dd < 4; dd++) {
          const ncls = mask[(si + DX[dd] + 1) + (sj + DZ[dd] + 1) * M];
          if (ncls === 0) emitWall(dd, si, sj);
          else if (cls === 2 && ncls === 1) emitLintel(dd, si, sj);
        }
      }
    }

    if (hatch) {
      bSx = bx + CELL * 0.5; bSz = bz + CELL * 0.5;
      const len = hatch.y - (c.floor + (c.chamber ? CHAMBER_H : CRAWL_H));
      bShaftK = clamp(Math.ceil(len / 0.28), 2, KSHAFT);
      const start = P.length / 3, istart = I.length;
      for (let sj = 4; sj < 12; sj++) {
        for (let si = 4; si < 12; si++) {
          for (let dd = 0; dd < 4; dd++) {
            if (inShaft(si + DX[dd], sj + DZ[dd])) continue;
            edgeEnds(dd, si, sj, EE);
            const flip = dd === 1 || dd === 2;
            for (let k = 0; k < bShaftK; k++) {
              quad(shaftVert(dd, EE[0], EE[1], k), shaftVert(dd, EE[2], EE[3], k),
                shaftVert(dd, EE[2], EE[3], k + 1), shaftVert(dd, EE[0], EE[1], k + 1), flip);
            }
          }
        }
      }
      // accumulate face normals for shaft vertices
      for (let t = istart; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, cI = I[t + 2] * 3;
        const e0 = P[b] - P[a], e1 = P[b + 1] - P[a + 1], e2 = P[b + 2] - P[a + 2];
        const f0 = P[cI] - P[a], f1 = P[cI + 1] - P[a + 1], f2 = P[cI + 2] - P[a + 2];
        const nx = e1 * f2 - e2 * f1, ny = e2 * f0 - e0 * f2, nz = e0 * f1 - e1 * f0;
        N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
        N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
        N[cI] += nx; N[cI + 1] += ny; N[cI + 2] += nz;
      }
      for (let v = start; v < P.length / 3; v++) {
        const o = v * 3, l = 1 / (Math.hypot(N[o], N[o + 1], N[o + 2]) || 1);
        N[o] *= l; N[o + 1] *= l; N[o + 2] *= l;
      }
    }

    // roots hanging from the ceiling + loose spoil on the floor
    const rng = rand(hash2(c.cx, c.cz) ^ (c.chamber ? 0x9e3779b9 : 0));
    const nRoots = c.chamber ? 7 + ((rng() * 6) | 0) : 2 + ((rng() * 4) | 0);
    for (let n = 0; n < nRoots; n++) {
      for (let tries = 0; tries < 12; tries++) {
        const si = 1 + ((rng() * (SUB - 1)) | 0), sj = 1 + ((rng() * (SUB - 1)) | 0);
        if (!mask[(si + 1) + (sj + 1) * M] || !mask[si + sj * M]) continue;
        if (hatch && inShaft(si, sj)) continue;
        const g = gIdx(si, sj);
        ensureG(g);
        if (!c.chamber && gD[g] > 0.3) continue;
        const g3 = g * 3;
        const len = c.chamber ? 0.25 + rng() * 0.7 : 0.1 + rng() * 0.3;
        addRoot(gCP[g3], gCP[g3 + 1], gCP[g3 + 2], len, 0.005 + rng() * 0.009, rng);
        const extra = (rng() * 3) | 0;
        for (let e = 0; e < extra; e++) addRoot(gCP[g3] + (rng() - 0.5) * 0.12, gCP[g3 + 1], gCP[g3 + 2] + (rng() - 0.5) * 0.12, len * (0.3 + rng() * 0.4), 0.003, rng);
        break;
      }
    }
    const nClods = 3 + ((rng() * 5) | 0);
    for (let n = 0; n < nClods; n++) {
      for (let tries = 0; tries < 8; tries++) {
        const si = (rng() * SUB) | 0, sj = (rng() * SUB) | 0;
        if (!mask[(si + 1) + (sj + 1) * M]) continue;
        const g = gIdx(si, sj);
        ensureG(g);
        if (gD[g] > 0.22) continue;
        const g3 = g * 3;
        addClod(gFP[g3] + (rng() - 0.5) * 0.1, gFP[g3 + 1], gFP[g3 + 2] + (rng() - 0.5) * 0.1, 0.02 + rng() * 0.035, rng);
        break;
      }
    }

    // bounds (earth + roots) for the chunk's bounding volume
    const box = c.box || (c.box = new Float64Array(6));
    box[0] = box[1] = box[2] = Infinity; box[3] = box[4] = box[5] = -Infinity;
    const growBox = (arr) => {
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2];
        if (x < box[0]) box[0] = x; if (x > box[3]) box[3] = x;
        if (y < box[1]) box[1] = y; if (y > box[4]) box[4] = y;
        if (z < box[2]) box[2] = z; if (z > box[5]) box[5] = z;
      }
    };
    growBox(P); growBox(RP);

    c.earth = {
      pos: new Float32Array(P), nor: new Float32Array(N), uv: new Float32Array(U),
      col: new Float32Array(Cl), bake: new Float32Array(Bk), idx: new Uint32Array(I),
    };
    c.roots = { pos: new Float32Array(RP), nor: new Float32Array(RN), col: new Float32Array(RC), idx: new Uint32Array(RI) };
  }

  // ---------- chunk meshes ----------
  // Each chunk owns one earth and one root mesh whose buffers have spare
  // capacity; a rebuild rewrites them in place (uploading only the used range)
  // and only reallocates when a chunk outgrows its buffers.
  const chunkGroup = new THREE.Group();
  chunkGroup.name = 'tunnelChunks';
  interior.add(chunkGroup);

  function dropChunkMesh(ch, field) {
    const old = ch[field];
    if (old) { chunkGroup.remove(old); old.geometry.dispose(); ch[field] = null; }
  }
  function chunkGeo(ch, field, mat, nv, ni, earth) {
    let mesh = ch[field];
    let geo = mesh ? mesh.geometry : null;
    if (geo && geo.userData.capV >= nv && geo.userData.capI >= ni) return geo;
    const capV = Math.ceil(nv * 1.5) + 512, capI = Math.ceil(ni * 1.5) + 1536;
    geo = new THREE.BufferGeometry();
    const mk = (s) => new THREE.BufferAttribute(new Float32Array(capV * s), s).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', mk(3));
    geo.setAttribute('normal', mk(3));
    geo.setAttribute('color', mk(3));
    if (earth) { geo.setAttribute('uv', mk(2)); geo.setAttribute('bake', mk(3)); }
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(capI), 1).setUsage(THREE.DynamicDrawUsage));
    geo.userData.capV = capV; geo.userData.capI = capI;
    geo.boundingBox = new THREE.Box3();
    geo.boundingSphere = new THREE.Sphere();
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = lastUnder === true;
      chunkGroup.add(mesh);
      ch[field] = mesh;
    }
    return geo;
  }
  function touchAttr(attr, n) {
    if (typeof attr.clearUpdateRanges === 'function') { attr.clearUpdateRanges(); attr.addUpdateRange(0, n); }
    attr.needsUpdate = true;
  }
  const _bmin = new THREE.Vector3(), _bmax = new THREE.Vector3();
  function finishGeo(geo, nv, ni, b) {
    const A = geo.attributes;
    for (const k in A) touchAttr(A[k], nv * A[k].itemSize);
    touchAttr(geo.index, ni);
    geo.setDrawRange(0, ni);
    geo.boundingBox.set(_bmin.set(b[0], b[1], b[2]), _bmax.set(b[3], b[4], b[5]));
    geo.boundingBox.getBoundingSphere(geo.boundingSphere);
  }
  const _cb = new Float64Array(6);
  function rebuildChunk(ch) {
    let nv = 0, ni = 0, rnv = 0, rni = 0;
    _cb[0] = _cb[1] = _cb[2] = Infinity; _cb[3] = _cb[4] = _cb[5] = -Infinity;
    for (const c of ch.cells) {
      if (!c.earth) continue;
      nv += c.earth.pos.length / 3; ni += c.earth.idx.length;
      rnv += c.roots.pos.length / 3; rni += c.roots.idx.length;
      const b = c.box;
      if (b) for (let k = 0; k < 3; k++) { if (b[k] < _cb[k]) _cb[k] = b[k]; if (b[k + 3] > _cb[k + 3]) _cb[k + 3] = b[k + 3]; }
    }
    if (nv === 0) { dropChunkMesh(ch, 'earthMesh'); dropChunkMesh(ch, 'rootMesh'); return; }
    {
      const geo = chunkGeo(ch, 'earthMesh', earthMat, nv, ni, true);
      const A = geo.attributes;
      const pos = A.position.array, nor = A.normal.array, col = A.color.array, uv = A.uv.array, bk = A.bake.array;
      const idx = geo.index.array;
      let vo = 0, io = 0;
      for (const c of ch.cells) {
        const e = c.earth;
        if (!e) continue;
        pos.set(e.pos, vo * 3); nor.set(e.nor, vo * 3); col.set(e.col, vo * 3); bk.set(e.bake, vo * 3); uv.set(e.uv, vo * 2);
        const src = e.idx, n = src.length;
        for (let k = 0; k < n; k++) idx[io + k] = src[k] + vo;
        vo += e.pos.length / 3; io += n;
      }
      finishGeo(geo, nv, ni, _cb);
    }
    if (rnv === 0) { dropChunkMesh(ch, 'rootMesh'); return; }
    {
      const geo = chunkGeo(ch, 'rootMesh', rootMat, rnv, rni, false);
      const A = geo.attributes;
      const pos = A.position.array, nor = A.normal.array, col = A.color.array;
      const idx = geo.index.array;
      let vo = 0, io = 0;
      for (const c of ch.cells) {
        const r = c.roots;
        if (!r) continue;
        pos.set(r.pos, vo * 3); nor.set(r.nor, vo * 3); col.set(r.col, vo * 3);
        const src = r.idx, n = src.length;
        for (let k = 0; k < n; k++) idx[io + k] = src[k] + vo;
        vo += r.pos.length / 3; io += n;
      }
      finishGeo(geo, rnv, rni, _cb);
    }
  }

  // Cells are rebuilt only when their signature changed. With a budget, a
  // build is only started if the running estimate says it fits (at least one
  // per frame so work always drains); chunks are merged once every dirty cell
  // is built, as many as fit in what is left of the budget.
  let estBuild = 0.5, estMerge = 0.4;
  const stats = { builds: 0, skipped: 0, merges: 0, buildMs: 0, mergeMs: 0 };
  function processDirty(budgetMs) {
    const limited = budgetMs > 0;
    const t0 = limited ? performance.now() : 0;
    let work = 0;
    if (dirty.size) {
      for (const k of dirty) {
        const c = cells.get(k);
        if (!c || !sigChanged(c)) { if (c) stats.skipped++; dirty.delete(k); continue; }
        if (limited && work > 0 && performance.now() - t0 + estBuild > budgetMs) return;
        const tb = performance.now();
        buildCell(c);
        const bt = performance.now() - tb;
        stats.builds++; stats.buildMs += bt;
        if (limited) estBuild = estBuild * 0.75 + bt * 0.25;
        dirty.delete(k);
        dirtyChunks.add(c.chunk);
        work++;
      }
    }
    if (dirtyChunks.size) {
      for (const ch of dirtyChunks) {
        if (limited && work > 0 && performance.now() - t0 + estMerge > budgetMs) break;
        const tm = performance.now();
        rebuildChunk(ch);
        const mt = performance.now() - tm;
        stats.merges++; stats.mergeMs += mt;
        if (limited) estMerge = estMerge * 0.75 + mt * 0.25;
        dirtyChunks.delete(ch);
        work++;
      }
      visTimer = 0;
    }
  }

  // ---------- hatches ----------
  function buildHatchVisual(h) {
    const rng = rand(hash2(h.cx * 7 + 3, h.cz * 13 + 5));
    const root = new THREE.Group();
    root.name = 'hatch';
    root.position.set(h.x, h.y, h.z);
    const skirt = new THREE.Mesh(conformPlane(h.x, h.y, h.z, 2.1, 7, 0.022, rng() * Math.PI * 2, 0, 0.7 + rng() * 0.25), litterMat);
    skirt.receiveShadow = true;
    const skirtLeaves = new THREE.Mesh(leafScatter(h.x, h.y, h.z, 16, 0.42, 1.1, rng, 0.03), leafMat);
    skirtLeaves.receiveShadow = true;
    const tilt = new THREE.Group();
    tilt.position.set(0, 0.02, 0);
    terrainNormal(h.x, h.z, _nrm);
    _tq.setFromUnitVectors(_ya, _nrm);
    const qy = new THREE.Quaternion().setFromAxisAngle(_ya, rng() * Math.PI * 2);
    tilt.quaternion.copy(_tq).multiply(qy);
    const hole = new THREE.Mesh(holeGeo, holeMat);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, -0.45);
    const planks = new THREE.Mesh(lidPlankGeo, plankMat);
    planks.receiveShadow = true;
    const lidLitter = new THREE.Mesh(lidLitterGeo, litterMat);
    lidLitter.receiveShadow = true;
    const lidLeaves = new THREE.Mesh(lidLeafGeos[(rng() * lidLeafGeos.length) | 0], leafMat);
    lidLeaves.receiveShadow = true;
    const leak = new THREE.Mesh(leakGeo, leakMat);
    leak.visible = false;
    hinge.add(planks, lidLitter, lidLeaves, leak);
    tilt.add(hole, hinge);
    root.add(skirt, skirtLeaves, tilt);
    root.updateMatrixWorld(true);
    surfaceGroup.add(root);

    // shaft dressing: bamboo ladder and a faint shaft of daylight
    const shaft = new THREE.Group();
    shaft.name = 'hatchShaft';
    const fy = h.floorY, ty = h.y - 0.1;
    const parts = [];
    const lr = rand(hash2(h.cx, h.cz) + 17);
    for (const sx of [-0.17, 0.17]) {
      parts.push(tint(cylinderBetween(h.x + sx, fy - 0.05, h.z - 0.24, h.x + sx * 0.95, ty, h.z - 0.35, 0.026, 0.022, 6), 0.36, 0.29, 0.17, 0.2, lr));
    }
    for (let y = fy + 0.28; y < ty - 0.12; y += 0.28) {
      const t = (y - fy) / Math.max(0.1, ty - fy);
      const z = h.z - 0.24 - 0.11 * t;
      parts.push(tint(cylinderBetween(h.x - 0.2, y, z, h.x + 0.2, y + (lr() - 0.5) * 0.02, z, 0.017, 0.017, 5), 0.33, 0.26, 0.15, 0.25, lr));
    }
    const ladderGeo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    const ladder = new THREE.Mesh(ladderGeo, rootMat);
    const coneLen = Math.max(0.6, h.y - fy - 0.1);
    const coneGeo = new THREE.CylinderGeometry(0.32, 0.46, coneLen, 16, 1, true);
    {
      const pa = coneGeo.attributes.position, n = pa.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = clamp(pa.getY(i) / coneLen + 0.5, 0, 1);
        const k = Math.pow(t, 2.5) * 0.075;
        col[i * 3] = k * 0.92; col[i * 3 + 1] = k * 1.0; col[i * 3 + 2] = k * 0.72;
      }
      coneGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(h.x, fy + 0.05 + coneLen * 0.5, h.z);
    cone.renderOrder = 2;
    shaft.add(ladder, cone);
    shaft.visible = false;
    interior.add(shaft);

    h.mesh = root;
    h.hinge = hinge;
    h.lidLeaves = lidLeaves;
    h.skirtLeaves = skirtLeaves;
    h.leak = leak;
    h.shaft = shaft;
    h.cone = cone;
  }
  function addHatch(c) {
    const x = (c.cx + 0.5) * CELL, z = (c.cz + 0.5) * CELL;
    const h = {
      x, z, cx: c.cx, cz: c.cz, y: terrainH(x, z), floorY: 0, mesh: null, discovered: false,
      id: hatches.length, animT: -1, _disc: false,
    };
    h.floorY = floorAt(x, z) ?? c.floor;
    c.hatch = h;
    hatches.push(h);
    buildHatchVisual(h);
    dirty.add(c.key);
    version++;
    return h;
  }
  function nearestHatch(pos, maxDist = 1.5) {
    if (!pos) return null;
    let best = null, bd = maxDist * maxDist;
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i];
      const dx = h.x - pos.x, dz = h.z - pos.z, d2 = dx * dx + dz * dz;
      if (d2 <= bd) { bd = d2; best = h; }
    }
    return best;
  }
  function openHatch(h) {
    if (!h) return;
    h.animT = 0;
    if (h.mesh) h.mesh.visible = true;
  }

  // ---------- dig rules ----------
  const chk = { ok: false, floor: 0, reason: '', existing: null };
  function fail(reason) { chk.ok = false; chk.reason = reason; chk.existing = null; return chk; }
  function inBounds(cx, cz) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    return Math.abs(x) < LIMIT && Math.abs(z) < LIMIT;
  }
  // Water depth over a point (0 on land). world.heightAt is the bed height.
  function waterDepth(x, z, bed) {
    const w = ctx.world;
    if (!w) return 0;
    if (typeof w.waterDepthAt === 'function') {
      try { const d = +w.waterDepthAt(x, z); return Number.isFinite(d) ? d : 0; } catch { return 0; }
    }
    if (!waterAt(x, z)) return 0;
    const wl = w.waterLevel;
    return Number.isFinite(wl) ? Math.max(0, wl - bed) : 1;
  }
  // Highest allowed ceiling in a cell: the lowest surface (or river bed) sample
  // minus the earth it needs above it. Shallow paddy water counts as ground;
  // under deep water the cover is thicker. Terrain is static, so it is cached.
  const roofCache = new Map();
  const deepCells = new Set();
  function roofOf(cx, cz) {
    const k = keyOf(cx, cz);
    const r0 = roofCache.get(k);
    if (r0 !== undefined) return r0;
    const x0 = cx * CELL, z0 = cz * CELL;
    let r = Infinity, deep = false;
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
      const x = x0 + 0.1 + i * 0.9, z = z0 + 0.1 + j * 0.9;
      const h = terrainH(x, z);
      const wet = waterDepth(x, z, h) > DEEP_WATER;
      if (wet) deep = true;
      const v = h - (wet ? RIVER_COVER : MIN_COVER);
      if (v < r) r = v;
    }
    roofCache.set(k, r);
    if (deep) deepCells.add(k);
    return r;
  }
  // Offsets scanned around a cell, with the floor rise allowed at that distance.
  const CONE_OFF = [];
  for (let j = -LOOK; j <= LOOK; j++) for (let i = -LOOK; i <= LOOK; i++) {
    const dd = Math.hypot(i, j);
    if (dd > 0 && dd <= LOOK + 1e-6) CONE_OFF.push(i, j, dd * CONE);
  }
  // Floor a fresh crawl tunnel would like here: terrain-following, but dipped
  // early near deep water so the tunnel can get under a river bed without ever
  // stepping more than MAX_STEP between cells (CONE < MAX_STEP).
  function plannedFloor(cx, cz) {
    let f = terrainH((cx + 0.5) * CELL, (cz + 0.5) * CELL) - DEPTH;
    const own = roofOf(cx, cz) - CRAWL_H;
    if (own < f) f = own;
    for (let o = 0; o < CONE_OFF.length; o += 3) {
      const v = roofOf(cx + CONE_OFF[o], cz + CONE_OFF[o + 1]) - CRAWL_H + CONE_OFF[o + 2];
      if (v < f) f = v;
    }
    return f;
  }
  // Floor for a new cell: follows the plan, stays within MAX_STEP of its neighbours, keeps cover.
  let floorFailWet = false;
  function newCellFloor(cx, cz, from, height) {
    floorFailWet = false;
    const want = plannedFloor(cx, cz);
    let lo = -Infinity, hi = Infinity;
    if (from) { lo = from.floor - MAX_STEP; hi = from.floor + MAX_STEP; }
    for (let d = 0; d < 4; d++) {
      const nb = getCell(cx + DX[d], cz + DZ[d]);
      if (!nb || nb === from) continue;
      const nlo = Math.max(lo, nb.floor - MAX_STEP), nhi = Math.min(hi, nb.floor + MAX_STEP);
      if (nlo <= nhi) { lo = nlo; hi = nhi; }
    }
    let f = clamp(want, lo, hi);
    const top = roofOf(cx, cz) - height;
    if (f > top) {
      if (top < lo) { floorFailWet = deepCells.has(keyOf(cx, cz)); return NaN; }
      f = top;
    }
    return f;
  }
  function checkCellDig(from, d) {
    chk.existing = null;
    if (!from) return fail('none');
    if (from.links & BIT[d]) return fail('open');
    const tx = from.cx + DX[d], tz = from.cz + DZ[d];
    if (!inBounds(tx, tz)) return fail('edge');
    const t = getCell(tx, tz);
    if (t) {
      if (Math.abs(t.floor - from.floor) > MAX_STEP + 0.15) return fail('steep');
      chk.ok = true; chk.floor = t.floor; chk.reason = ''; chk.existing = t;
      return chk;
    }
    const f = newCellFloor(tx, tz, from, CRAWL_H);
    if (!Number.isFinite(f)) return fail(floorFailWet ? 'water' : 'shallow');
    chk.ok = true; chk.floor = f; chk.reason = '';
    return chk;
  }
  function checkHatch(cx, cz) {
    chk.existing = null;
    if (!inBounds(cx, cz)) return fail('edge');
    const c = getCell(cx, cz);
    if (c?.hatch) return fail('exists');
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i], dx = h.x - x, dz = h.z - z;
      if (dx * dx + dz * dz < 3.5 * 3.5) return fail('near');
    }
    if (waterAt(x, z) || waterAt(x + 0.5, z) || waterAt(x - 0.5, z) || waterAt(x, z + 0.5) || waterAt(x, z - 0.5)) return fail('water');
    const hc = terrainH(x, z);
    let mn = hc, mx = hc;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, hh = terrainH(x + Math.cos(a) * 0.65, z + Math.sin(a) * 0.65);
      if (hh < mn) mn = hh; if (hh > mx) mx = hh;
    }
    if (mx - mn > 0.75) return fail('slope');
    if (blockedAt(x, z, 0.75)) return fail('blocked');
    if (c) {
      const len = hc - (c.floor + (c.chamber ? CHAMBER_H : CRAWL_H));
      if (len < 0.35 || len > 5.5) return fail('depth');
      chk.ok = true; chk.floor = c.floor; chk.reason = ''; chk.existing = c;
      return chk;
    }
    const f = newCellFloor(cx, cz, null, CRAWL_H);
    if (!Number.isFinite(f)) return fail('shallow');
    chk.ok = true; chk.floor = f; chk.reason = '';
    return chk;
  }
  function checkChamber(c) {
    chk.existing = c || null;
    if (!c) return fail('none');
    if (c.chamber) return fail('exists');
    if (roofOf(c.cx, c.cz) + MIN_COVER * 0.3 - (c.floor + CHAMBER_H) < 0) return fail(deepCells.has(c.key) ? 'water' : 'shallow');
    chk.ok = true; chk.floor = c.floor; chk.reason = '';
    return chk;
  }
  function dirIndex(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax < 1e-6 && az < 1e-6) return -1;
    if (ax >= az) return x > 0 ? 0 : 1;
    return z > 0 ? 2 : 3;
  }
  function emitNoise(x, y, z, loudness) {
    ev.emit('noise', { pos: new THREE.Vector3(x, y, z), loudness });
  }

  function dig(fromPos, dir) {
    if (!fromPos || !dir) return false;
    const from = getCell(cellIndex(fromPos.x), cellIndex(fromPos.z));
    if (!from) return false;
    const d = dirIndex(dir.x, dir.z);
    if (d < 0) return false;
    const r = checkCellDig(from, d);
    if (!r.ok) return false;
    const tx = from.cx + DX[d], tz = from.cz + DZ[d];
    let t = r.existing;
    const fresh = !t;
    if (!t) t = addCellRaw(tx, tz, r.floor);
    linkRaw(from, t);
    const x = (tx + 0.5) * CELL, z = (tz + 0.5) * CELL;
    if (fresh) ev.emit('tunnelDug', { cellX: tx, cellZ: tz });
    emitNoise(x, t.floor + 0.5, z, 0.3);
    return true;
  }
  function digChamber(cx, cz) {
    const c = getCell(cx, cz);
    if (!checkChamber(c).ok) return false;
    c.chamber = true;
    for (let d = 0; d < 4; d++) {
      const nb = getCell(cx + DX[d], cz + DZ[d]);
      if (nb && nb.chamber && Math.abs(nb.floor - c.floor) <= MAX_STEP) linkRaw(c, nb);
    }
    refreshStripsAround(cx, cz);
    recomputeRooms();
    markAround(cx, cz);
    // every cell of the (possibly merged) room may now see a lamp
    const room = c.room;
    for (const rc of cells.values()) if (rc !== c && rc.chamber && rc.room === room) markAround(rc.cx, rc.cz);
    let lit = false;
    for (let i = 0; i < lamps.length; i++) if (lamps[i].room === room) { lit = true; break; }
    if (!lit) placeChamberLamp(c);
    ev.emit('chamberDug', { cellX: cx, cellZ: cz });
    emitNoise((cx + 0.5) * CELL, c.floor + 0.8, (cz + 0.5) * CELL, 0.35);
    return true;
  }
  function createHatch(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const cx = cellIndex(x), cz = cellIndex(z);
    const r = checkHatch(cx, cz);
    if (!r.ok) return false;
    let c = r.existing;
    if (!c) {
      c = addCellRaw(cx, cz, r.floor);
      for (let d = 0; d < 4; d++) {
        const nb = getCell(cx + DX[d], cz + DZ[d]);
        if (nb && Math.abs(nb.floor - c.floor) <= MAX_STEP) linkRaw(c, nb);
      }
      ev.emit('tunnelDug', { cellX: cx, cellZ: cz });
    }
    const h = addHatch(c);
    ev.emit('hatchCreated', { x: h.x, z: h.z, hatch: h });
    emitNoise(h.x, h.y, h.z, 0.4);
    return true;
  }

  // ---------- dig targeting (what the shovel would dig right now) ----------
  const target = { type: null, cx: 0, cz: 0, x: 0, y: 0, z: 0, time: 0, reason: '' };
  function undergroundAt(pos) {
    const p = ctx.player;
    if (p && typeof p.underground === 'boolean') return p.underground;
    if (!pos) return false;
    if (!cells.has(keyOf(cellIndex(pos.x), cellIndex(pos.z)))) return false;
    return pos.y < terrainH(pos.x, pos.z) - 0.8;
  }
  function setTarget(type, cx, cz, y) {
    target.type = type; target.cx = cx; target.cz = cz;
    target.x = (cx + 0.5) * CELL; target.z = (cz + 0.5) * CELL; target.y = y;
    target.time = DIG_TIME[type] || 0; target.reason = '';
    return target;
  }
  // Short HUD toast when the shovel is refused for a reason the player can act
  // on; throttled so holding the button on the same spot does not spam.
  const REFUSAL_TEXT = {
    water: 'Water above', shallow: 'Too shallow', steep: 'Too steep', edge: 'Too far out',
    slope: 'Ground too steep', blocked: 'Blocked', near: 'Hatch too close', depth: 'Too deep',
  };
  const refusal = { reason: '', text: '', time: -1e9 };
  function noteRefusal(reason) {
    const text = REFUSAL_TEXT[reason];
    if (!text) return;
    const inp = ctx.input;
    if (!inp?.mouse?.left) return;
    const fresh = reason !== refusal.reason;
    if (time - refusal.time < (fresh ? 0.4 : 3.2)) return;
    refusal.reason = reason; refusal.text = text; refusal.time = time;
    ev.emit('message', { text });
    ev.emit('digRefused', { reason, text });
  }
  function digTarget(pos, dir) {
    const t = findDigTarget(pos, dir);
    if (!t.type) noteRefusal(t.reason);
    return t;
  }
  function findDigTarget(pos, dir) {
    target.type = null; target.reason = ''; target.time = 0;
    if (!pos || !dir) { target.reason = 'none'; return target; }
    const cx = cellIndex(pos.x), cz = cellIndex(pos.z);
    if (undergroundAt(pos)) {
      const c = getCell(cx, cz);
      if (!c) { target.reason = 'none'; return target; }
      if (dir.y > 0.62) {
        const r = checkHatch(cx, cz);
        if (r.ok) return setTarget('hatch', cx, cz, terrainH((cx + 0.5) * CELL, (cz + 0.5) * CELL));
        target.reason = r.reason; return target;
      }
      if (dir.y < -0.62) {
        const r = checkChamber(c);
        if (r.ok) return setTarget('chamber', cx, cz, c.floor);
        target.reason = r.reason; return target;
      }
      const d = dirIndex(dir.x, dir.z);
      if (d < 0) { target.reason = 'none'; return target; }
      const r = checkCellDig(c, d);
      if (r.ok) return setTarget('cell', cx + DX[d], cz + DZ[d], r.floor);
      target.reason = r.reason;
      return target;
    }
    if (dir.y > -0.3) { target.reason = 'aim'; return target; }
    const hl = Math.hypot(dir.x, dir.z);
    let px = pos.x, pz = pos.z;
    if (hl > 1e-4) {
      const dist = clamp(1.5 * hl / Math.max(0.3, -dir.y), 0.6, 2.0);
      px += dir.x / hl * dist; pz += dir.z / hl * dist;
    }
    const tcx = cellIndex(px), tcz = cellIndex(pz);
    const r = checkHatch(tcx, tcz);
    if (r.ok) return setTarget('hatch', tcx, tcz, terrainH((tcx + 0.5) * CELL, (tcz + 0.5) * CELL));
    target.reason = r.reason;
    return target;
  }
  function applyDig(pos, dir) {
    const t = findDigTarget(pos, dir);
    if (t.type === 'cell') return dig(pos, dir);
    if (t.type === 'hatch') return createHatch(t.x, t.z);
    if (t.type === 'chamber') return digChamber(t.cx, t.cz);
    return false;
  }

  // ---------- constrain ----------
  const lastValid = new THREE.Vector3();
  let hasLast = false;
  function recover(pos) {
    if (hasLast) {
      const dx = lastValid.x - pos.x, dz = lastValid.z - pos.z;
      if (dx * dx + dz * dz < 9 && isFreeAt(lastValid.x, lastValid.z)) { pos.x = lastValid.x; pos.z = lastValid.z; return true; }
    }
    const cx = cellIndex(pos.x), cz = cellIndex(pos.z);
    let best = null, bd = Infinity;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const c = getCell(cx + i, cz + j);
      if (!c) continue;
      const dx = (c.cx + 0.5) * CELL - pos.x, dz = (c.cz + 0.5) * CELL - pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = c; }
    }
    if (!best) return false;
    const x0 = best.cx * CELL, z0 = best.cz * CELL;
    pos.x = clamp(pos.x, x0 + 0.6, x0 + 1.4);
    pos.z = clamp(pos.z, z0 + 0.6, z0 + 1.4);
    return true;
  }
  function constrain(pos, radius = 0.3, height = 0) {
    if (!pos) return pos;
    const r = clamp(Number.isFinite(radius) ? radius : 0.3, 0.05, 0.45);
    if (!isFreeAt(pos.x, pos.z) && !recover(pos)) return pos;
    const cx = cellIndex(pos.x), cz = cellIndex(pos.z);
    gather(cx, cz, true);
    const r2 = r * r;
    for (let it = 0; it < 6; it++) {
      let bestPen = 0, bnx = 0, bnz = 0;
      for (let b = 0; b < solN; b++) {
        const o = b * 4, x0 = SOL[o], z0 = SOL[o + 1], x1 = SOL[o + 2], z1 = SOL[o + 3];
        const qx = pos.x < x0 ? x0 : (pos.x > x1 ? x1 : pos.x);
        const qz = pos.z < z0 ? z0 : (pos.z > z1 ? z1 : pos.z);
        const dx = pos.x - qx, dz = pos.z - qz, d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        let pen, nx, nz;
        if (d2 > 1e-12) {
          const dd = Math.sqrt(d2);
          pen = r - dd; nx = dx / dd; nz = dz / dd;
        } else {
          const l = pos.x - x0, rr = x1 - pos.x, t = pos.z - z0, bb = z1 - pos.z;
          let m = l; nx = -1; nz = 0;
          if (rr < m) { m = rr; nx = 1; nz = 0; }
          if (t < m) { m = t; nx = 0; nz = -1; }
          if (bb < m) { m = bb; nx = 0; nz = 1; }
          pen = r + m;
        }
        if (pen > bestPen) { bestPen = pen; bnx = nx; bnz = nz; }
      }
      if (bestPen <= 0) break;
      pos.x += bnx * (bestPen + 1e-4);
      pos.z += bnz * (bestPen + 1e-4);
    }
    if (!isFreeAt(pos.x, pos.z) && hasLast && isFreeAt(lastValid.x, lastValid.z)) {
      pos.x = lastValid.x; pos.z = lastValid.z;
    }
    const fl = floorAt(pos.x, pos.z);
    if (fl === null) return pos;
    let ce = ceilingAt(pos.x, pos.z);
    const a = r * 0.55;
    for (let s = 0; s < 4; s++) {
      const sx = pos.x + (s === 0 ? a : s === 1 ? -a : 0), sz = pos.z + (s === 2 ? a : s === 3 ? -a : 0);
      if (!isFreeAt(sx, sz)) continue;
      const v = ceilingAt(sx, sz);
      if (v !== null && v < ce) ce = v;
    }
    if (pos.y < fl) pos.y = fl;
    const top = ce - Math.max(0, height || 0);
    if (pos.y > top) pos.y = Math.max(fl, top);
    lastValid.copy(pos);
    hasLast = true;
    return pos;
  }

  // ---------- punji traps ----------
  function canPlaceTrap(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return false;
    if (waterAt(x, z) || waterAt(x + 0.5, z) || waterAt(x - 0.5, z) || waterAt(x, z + 0.5) || waterAt(x, z - 0.5)) return false;
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i], dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < 1.3 * 1.3) return false;
    }
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i], dx = h.x - x, dz = h.z - z;
      if (dx * dx + dz * dz < 1.6 * 1.6) return false;
    }
    const y = terrainH(x, z);
    let mn = y, mx = y;
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, hh = terrainH(x + Math.cos(a) * 0.55, z + Math.sin(a) * 0.55);
      if (hh < mn) mn = hh; if (hh > mx) mx = hh;
    }
    if (mx - mn > 0.6) return false;
    if (blockedAt(x, z, 0.5)) return false;
    return true;
  }
  function placeTrap(x, z) {
    if (!canPlaceTrap(x, z)) return false;
    const y = terrainH(x, z);
    const t = { x, z, y, armed: true, sprung: false, id: traps.length, group: null, cover: null, sprungGroup: null };
    buildTrapVisual(t);
    traps.push(t);
    version++;
    ev.emit('noise', { pos: new THREE.Vector3(x, y, z), loudness: 0.12 });
    return true;
  }
  function buildTrapVisual(t) {
    const rng = rand(hash2(Math.round(t.x * 10), Math.round(t.z * 10)) + 99);
    const root = new THREE.Group();
    root.name = 'punji';
    root.position.set(t.x, t.y, t.z);
    const cover = new THREE.Group();
    const mat = new THREE.Mesh(conformPlane(t.x, t.y, t.z, 1.3, 6, 0.028, rng() * Math.PI * 2, 0.03), litterMat);
    mat.receiveShadow = true;
    const lv = new THREE.Mesh(leafScatter(t.x, t.y, t.z, 9, 0, 0.6, rng, 0.05), leafMat);
    lv.receiveShadow = true;
    cover.add(mat, lv);
    const sprung = new THREE.Group();
    sprung.visible = false;
    const pit = new THREE.Mesh(conformPlane(t.x, t.y, t.z, 1.15, 5, 0.02, rng() * 0.4, 0), pitMat);
    const stakes = new THREE.Mesh(stakeGeo, rootMat);
    stakes.rotation.y = rng() * Math.PI;
    const debris = new THREE.Mesh(leafScatter(t.x, t.y, t.z, 12, 0.45, 1.15, rng, 0.03), leafMat);
    debris.receiveShadow = true;
    sprung.add(pit, stakes, debris);
    root.add(cover, sprung);
    root.visible = lastUnder !== true;
    surfaceGroup.add(root);
    t.group = root; t.cover = cover; t.sprungGroup = sprung;
  }
  function enemyPos(e) {
    return e.position || e.pos || e.root?.position || e.group?.position || e.mesh?.position || e.object?.position || null;
  }
  function enemyAlive(e) {
    if (!e) return false;
    if (e.alive === false || e.dead === true || e.state === 'dead') return false;
    if (typeof e.health === 'number' && e.health <= 0) return false;
    return true;
  }
  function springTrap(t, enemy) {
    if (!t.armed) return;
    t.armed = false;
    t.sprung = true;
    if (t.cover) t.cover.visible = false;
    if (t.sprungGroup) t.sprungGroup.visible = true;
    version++;
    let damaged = false;
    if (enemy && typeof enemy.damage === 'function') {
      try { enemy.damage(100, 'trap'); damaged = true; } catch (err) { console.warn('[tunnels] trap damage failed', err); }
    }
    ev.emit('trapTriggered', { enemy: enemy || null, x: t.x, z: t.z, damaged, trap: t });
    ev.emit('noise', { pos: new THREE.Vector3(t.x, t.y + 0.5, t.z), loudness: enemy ? 0.55 : 0.2 });
    if (enemy) ev.emit('message', { text: 'Trap sprung' });
  }
  function checkTraps() {
    const list = ctx.enemies?.list;
    if (!traps.length || !Array.isArray(list) || !list.length) return;
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i];
      if (!t.armed) continue;
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!enemyAlive(e)) continue;
        const p = enemyPos(e);
        if (!p) continue;
        if (Math.abs(p.x - t.x) < TRAP_HALF && Math.abs(p.z - t.z) < TRAP_HALF && Math.abs(p.y - t.y) < 1.2) {
          springTrap(t, e);
          break;
        }
      }
    }
  }

  // ---------- oil lamps ----------
  // One realtime PointLight follows the nearest lamp (fixed light count); all
  // lamps also bake their light into nearby tunnel vertices.
  const lampLight = new THREE.PointLight(0xffc890, 0, 9, 1.8);
  lampLight.castShadow = false;
  group.add(lampLight); // kept permanently visible so the scene light count never changes
  let storage = null;
  const lampBaseGeo = (() => {
    const parts = [new THREE.CylinderGeometry(0.05, 0.06, 0.025, 12), new THREE.CylinderGeometry(0.04, 0.05, 0.05, 12)];
    parts[0].translate(0, 0.0125, 0);
    parts[1].translate(0, 0.05, 0);
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return geo;
  })();
  const lampGlassGeo = new THREE.CylinderGeometry(0.026, 0.036, 0.11, 12, 1, true).translate(0, 0.13, 0);
  const lampFlameGeo = new THREE.ConeGeometry(0.011, 0.04, 8).translate(0, 0.11, 0);
  // base: (x, baseY, z) is where the lamp foot stands
  function addLamp(x, baseY, z, power) {
    const g = new THREE.Group();
    g.name = 'oilLamp';
    g.position.set(x, baseY, z);
    const base = new THREE.Mesh(lampBaseGeo, metalMat);
    const glass = new THREE.Mesh(lampGlassGeo, glassMat);
    glass.renderOrder = 3;
    const flame = new THREE.Mesh(lampFlameGeo, flameMat);
    flame.renderOrder = 4;
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(0, 0.125, 0);
    halo.scale.setScalar(0.34);
    halo.renderOrder = 5;
    g.add(base, glass, flame, halo);
    g.visible = lastUnder === true;
    interior.add(g);
    const cx = cellIndex(x), cz = cellIndex(z);
    const l = {
      x, y: baseY + 0.13, z, cx, cz, power, room: getCell(cx, cz)?.room ?? -1,
      group: g, flame, halo, phase: lamps.length * 2.37 + 0.5, visible: false,
    };
    lamps.push(l);
    return l;
  }
  // A lamp on a clay ledge against a solid wall of a freshly dug chamber cell.
  function placeChamberLamp(c) {
    const rng = rand(hash2(c.cx * 3 + 1, c.cz * 5 + 2) + 4040);
    let side = -1, best = -1;
    const start = (rng() * 4) | 0;
    for (let q = 0; q < 4; q++) {
      const d = (start + q) & 3;
      if (c.links & BIT[d]) continue;
      const nb = getCell(c.cx + DX[d], c.cz + DZ[d]);
      const score = nb ? 1 : 2;
      if (score > best) { best = score; side = d; }
    }
    const cxw = (c.cx + 0.5) * CELL, czw = (c.cz + 0.5) * CELL;
    let x, z;
    if (side >= 0) {
      const along = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.3);
      x = cxw + DX[side] * 0.66 + (DX[side] === 0 ? along : 0);
      z = czw + DZ[side] * 0.66 + (DZ[side] === 0 ? along : 0);
    } else {
      x = cxw + 0.6; z = czw + 0.6;
    }
    const fy = floorAt(x, z) ?? c.floor;
    const LH = 0.34;
    // lumpy, flat-topped clay mound left standing when the room was dug out
    const geo = new THREE.SphereGeometry(0.25, 12, 8);
    {
      const pa = geo.attributes.position, n = pa.count;
      const col = new Float32Array(n * 3), bk = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        let px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
        const wob = 1 + 0.12 * noise2D(px * 9 + x * 3, pz * 9 + z * 3) + 0.05 * noise2D(py * 14, px * 14 + z);
        py = (py + 0.25) / 0.5 * (LH + 0.14) - 0.12;          // -0.12 .. LH + 0.02
        const top = py >= LH;
        if (top) py = LH + 0.006 * noise2D(px * 30, pz * 30);
        const sh = top ? 0.82 : 1 - 0.18 * clamp((py - LH * 0.5) / LH, 0, 1);
        pa.setXYZ(i, px * wob * sh, py, pz * wob * sh * 0.85);
        const t = clamp(py / LH, 0, 1);
        const k = top ? 0.4 : 0.6 + 0.25 * t;            // soot-darkened top
        col[i * 3] = k * 0.97; col[i * 3 + 1] = k * 0.95; col[i * 3 + 2] = k * 0.9;
        const e = top ? 0.14 : 0.06 + 0.3 * t * t;
        bk[i * 3] = e * LAMP_COL.r; bk[i * 3 + 1] = e * LAMP_COL.g; bk[i * 3 + 2] = e * LAMP_COL.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('bake', new THREE.BufferAttribute(bk, 3));
      geo.computeVertexNormals();
    }
    if (side >= 0) geo.rotateY(side < 2 ? Math.PI / 2 : 0);
    geo.translate(x, fy, z);
    geo.computeBoundingSphere();
    const ledge = new THREE.Mesh(geo, earthMat);
    ledge.matrixAutoUpdate = false;
    interior.add(ledge);
    (c.props || (c.props = [])).push(x - 0.22, z - 0.22, x + 0.22, z + 0.22);
    const l = addLamp(x, fy + LH, z, 1.25);
    l.extra = ledge;
    ledge.visible = l.group.visible;
    markAround(c.cx, c.cz);
    return l;
  }

  function buildStorage(ccx, ccz) {
    const X0 = ccx * CELL, Z0 = ccz * CELL;
    const ccells = [getCell(ccx, ccz), getCell(ccx + 1, ccz), getCell(ccx, ccz + 1), getCell(ccx + 1, ccz + 1)].filter(Boolean);
    const r = rand(6868);
    const sg = new THREE.Group();
    sg.name = 'storage';
    const fl = (lx, lz) => floorAt(X0 + lx, Z0 + lz) ?? (getCell(ccx, ccz)?.floor ?? 0);
    const addProp = (minx, minz, maxx, maxz) => {
      const c = getCell(cellIndex((minx + maxx) * 0.5), cellIndex((minz + maxz) * 0.5));
      if (!c) return;
      (c.props || (c.props = [])).push(minx, minz, maxx, maxz);
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    // crates
    const crates = [
      [0.72, 0.42, 0.46, 0.7, 3.45, 0.05, 0],
      [0.66, 0.38, 0.42, 0.72, 3.47, -0.14, 1],
      [0.6, 0.4, 0.42, 1.48, 3.5, 0.22, 0],
      [0.56, 0.44, 0.5, 3.4, 3.38, -0.32, 0],
    ];
    const crateParts = [];
    let lampTop = null;
    let stackY = 0;
    for (let i = 0; i < crates.length; i++) {
      const [w, h, d, lx, lz, ry, onTop] = crates[i];
      const base = onTop ? stackY : fl(lx, lz);
      const geo = new THREE.BoxGeometry(w, h, d);
      q.setFromAxisAngle(_ya, ry);
      m4.compose(v.set(X0 + lx, base + h * 0.5, Z0 + lz), q, s1);
      geo.applyMatrix4(m4);
      crateParts.push(geo);
      if (!onTop) stackY = base + h;
      if (i === 3) lampTop = [X0 + lx, base + h, Z0 + lz];
      if (!onTop) { const e = Math.max(w, d) * 0.5 + 0.04; addProp(X0 + lx - e, Z0 + lz - e, X0 + lx + e, Z0 + lz + e); }
    }
    const crateMesh = new THREE.Mesh(mergeGeometries(crateParts), crateMat);
    crateParts.forEach((p) => p.dispose());
    // rice sacks
    const sackSpots = [[2.15, 3.45, 0, 0.3], [2.62, 3.5, 0, -0.4], [2.38, 3.02, 0, 1.2], [1.98, 3.0, 0, 0.7], [2.4, 3.3, 0.22, 0.1]];
    const sackParts = [];
    for (const [lx, lz, up, ry] of sackSpots) {
      const sph = new THREE.SphereGeometry(0.3, 14, 10);
      const pa = sph.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        let x = pa.getX(k), y = pa.getY(k) * 0.55, z = pa.getZ(k) * 0.72;
        if (y < -0.09) y = -0.09 + (y + 0.09) * 0.25;
        const bulge = 1 + 0.06 * Math.sin(x * 21 + z * 13) + (r() - 0.5) * 0.03;
        pa.setXYZ(k, x * bulge, y + 0.1, z * bulge);
      }
      const neck = new THREE.CylinderGeometry(0.045, 0.085, 0.12, 8, 1);
      neck.rotateZ(-Math.PI * 0.36);
      neck.translate(0.3, 0.13, 0);
      const parts = [sph, neck];
      const sack = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      sack.computeVertexNormals();
      q.setFromAxisAngle(_ya, ry);
      m4.compose(v.set(X0 + lx, fl(lx, lz) + up, Z0 + lz), q, s1);
      sack.applyMatrix4(m4);
      sackParts.push(sack);
    }
    const sackMesh = new THREE.Mesh(mergeGeometries(sackParts), burlapMat);
    sackParts.forEach((p) => p.dispose());
    addProp(X0 + 1.68, Z0 + 2.72, X0 + 2.95, Z0 + 3.78);
    // water jar
    const jarPts = [[0, 0], [0.11, 0], [0.17, 0.07], [0.2, 0.19], [0.18, 0.31], [0.11, 0.4], [0.085, 0.44], [0.1, 0.47], [0.088, 0.48], [0.07, 0.46]]
      .map(([a, b]) => new THREE.Vector2(a, b));
    const jarGeo = new THREE.LatheGeometry(jarPts, 18);
    jarGeo.translate(X0 + 3.55, fl(3.55, 2.6), Z0 + 2.6);
    const jarMesh = new THREE.Mesh(jarGeo, jarMat);
    addProp(X0 + 3.33, Z0 + 2.38, X0 + 3.77, Z0 + 2.82);
    // sleeping mat conforming to the floor
    const matGeo = new THREE.PlaneGeometry(1.7, 0.75, 10, 4);
    matGeo.rotateX(-Math.PI / 2);
    matGeo.rotateY(0.04);
    {
      const pa = matGeo.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        const wx = X0 + 1.15 + pa.getX(k), wz = Z0 + 2.45 + pa.getZ(k);
        pa.setXYZ(k, wx, (floorAt(wx, wz) ?? 0) + 0.025, wz);
      }
      matGeo.computeVertexNormals();
      matGeo.computeBoundingSphere();
    }
    const matMesh = new THREE.Mesh(matGeo, weaveMat);
    sg.add(crateMesh, sackMesh, jarMesh, matMesh);
    // oil lamp on the far crate
    const lt = lampTop || [X0 + 3.4, fl(3.4, 3.38) + 0.44, Z0 + 3.38];
    addLamp(lt[0], lt[1], lt[2], 1.5);
    sg.visible = false;
    interior.add(sg);
    for (const c of ccells) markAround(c.cx, c.cz);
    version++;
    storage = { group: sg, x: X0 + 2, z: Z0 + 2 };
  }

  // ---------- starting camp network ----------
  function buildStartNetwork() {
    const sx = cellIndex(WORLD.playerStart.x), sz = cellIndex(WORLD.playerStart.z);
    const rel = (dx, dz) => getCell(sx + dx, sz + dz);
    const make = (dx, dz, prev, height) => {
      const cx = sx + dx, cz = sz + dz;
      let c = getCell(cx, cz);
      if (c) return c;
      let f = terrainH((cx + 0.5) * CELL, (cz + 0.5) * CELL) - DEPTH;
      if (prev) f = clamp(f, prev.floor - MAX_STEP, prev.floor + MAX_STEP);
      f = Math.min(f, minTerrainOverCell(cx, cz) - height - 0.7);
      return addCellRaw(cx, cz, f);
    };
    const chamberRel = [[7, 3], [8, 3], [7, 4], [8, 4]];
    const isCh = (dx, dz) => chamberRel.some(([a, b]) => a === dx && b === dz);
    const paths = [
      [[2, 0], [2, 1], [2, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 2]],
      [[2, 0], [2, -1], [2, -2], [1, -2], [1, -3], [0, -3], [-1, -3], [-2, -3]],
      [[2, 3], [1, 3], [0, 3], [-1, 3], [-1, 4], [-1, 5]],
      [[7, 3], [7, 4]],
      [[8, 3], [8, 4]],
    ];
    for (const path of paths) {
      let prev = null;
      for (const [dx, dz] of path) {
        const c = make(dx, dz, prev, isCh(dx, dz) ? CHAMBER_H : CRAWL_H);
        if (prev) linkRaw(prev, c);
        prev = c;
      }
    }
    // storage chamber: level floor, all four cells opened into one room
    const ch = chamberRel.map(([a, b]) => rel(a, b)).filter(Boolean);
    let avg = 0;
    for (const c of ch) avg += c.floor;
    avg /= Math.max(1, ch.length);
    for (const c of ch) {
      c.floor = Math.min(avg, minTerrainOverCell(c.cx, c.cz) - CHAMBER_H - 0.7);
      c.chamber = true;
    }
    for (const a of ch) for (const b of ch) if (a !== b) linkRaw(a, b);
    for (const c of ch) refreshStripsAround(c.cx, c.cz);
    recomputeRooms();

    const hatchSets = [
      [[2, 0], [2, 1], [2, -1], [2, 2]],
      [[-2, -3], [-1, -3], [0, -3], [1, -3]],
      [[-1, 5], [-1, 4], [-1, 3], [0, 3]],
    ];
    for (const set of hatchSets) {
      let chosen = null;
      for (const [dx, dz] of set) {
        const c = rel(dx, dz);
        if (c && !c.hatch && checkHatch(c.cx, c.cz).ok) { chosen = c; break; }
      }
      if (!chosen) {
        for (const [dx, dz] of set) {
          const c = rel(dx, dz);
          if (c && !c.hatch && !hatches.some((h) => Math.abs(h.cx - c.cx) + Math.abs(h.cz - c.cz) < 2)) { chosen = c; break; }
        }
      }
      if (chosen) addHatch(chosen);
    }
  }

  // ---------- visibility / animation ----------
  let lastUnder = null;
  let visTimer = 0;
  const _cam = new THREE.Vector3();
  function viewerPos() {
    const cam = ctx.camera;
    if (cam) { cam.getWorldPosition ? cam.getWorldPosition(_cam) : _cam.copy(cam.position); return _cam; }
    const p = ctx.player?.position;
    if (p) return _cam.copy(p);
    return _cam.set(WORLD.playerStart.x, 0, WORLD.playerStart.z);
  }
  function refreshVisibility(under, cam) {
    const VIS2 = 52 * 52;
    for (let i = 0; i < chunkList.length; i++) {
      const ch = chunkList[i];
      const dx = ch.wx - cam.x, dz = ch.wz - cam.z;
      const vis = under && dx * dx + dz * dz < VIS2;
      if (ch.earthMesh) ch.earthMesh.visible = vis;
      if (ch.rootMesh) ch.rootMesh.visible = vis;
    }
    if (storage) {
      const dx = storage.x - cam.x, dz = storage.z - cam.z;
      storage.group.visible = under && dx * dx + dz * dz < 45 * 45;
    }
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const dx = l.x - cam.x, dz = l.z - cam.z;
      const vis = under && dx * dx + dz * dz < 45 * 45;
      l.visible = vis;
      l.group.visible = vis;
      if (l.extra) l.extra.visible = vis;
    }
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i];
      const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
      const anim = h.animT >= 0;
      if (h.mesh) h.mesh.visible = anim || (under ? d2 < 16 * 16 : d2 < 150 * 150);
      if (h.shaft) h.shaft.visible = under ? d2 < 45 * 45 : (anim && d2 < 30 * 30);
      if (h.leak) h.leak.visible = under;
      if (h.discovered !== h._disc) {
        h._disc = h.discovered;
        if (h.lidLeaves) h.lidLeaves.visible = !h.discovered;
        if (h.skirtLeaves) h.skirtLeaves.visible = !h.discovered;
      }
    }
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i];
      const dx = t.x - cam.x, dz = t.z - cam.z;
      if (t.group) t.group.visible = !under && dx * dx + dz * dz < 95 * 95;
    }
  }
  function animateHatches(dt) {
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i];
      if (h.animT < 0) continue;
      h.animT += dt;
      const t = h.animT;
      let a;
      if (t < 0.35) { const k = t / 0.35; a = 1 - (1 - k) * (1 - k); }
      else if (t < 1.1) a = 1;
      else if (t < 1.6) { const k = (t - 1.1) / 0.5; a = 1 - k * k * (3 - 2 * k); }
      else { a = 0; h.animT = -1; visTimer = 0; }
      if (h.hinge) h.hinge.rotation.x = -a * 1.85;
    }
  }
  function updateLamp(under, cam) {
    const gf = 0.955 + 0.03 * Math.sin(time * 7.3) + 0.015 * noise2D(time * 2.9, 3.1);
    bakeGain.value = gf;
    if (!under || !lamps.length) { lampLight.intensity = 0; return; }
    let best = null, bd = 30 * 30;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (!l.visible) continue;
      const dx = l.x - cam.x, dy = l.y - cam.y, dz = l.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = l; }
      const f = 0.9 + 0.07 * Math.sin(time * 13.1 + l.phase) + 0.05 * noise2D(time * 5.3, l.phase);
      l.flame.scale.set(1, 0.9 + 0.25 * f, 1);
      l.flame.position.x = noise2D(time * 3.1, l.phase + 1.3) * 0.0015;
      l.halo.scale.setScalar(0.3 + 0.05 * f);
    }
    if (!best) { lampLight.intensity = 0; return; }
    lampLight.position.set(best.x, best.y + 0.3, best.z);
    const f = 0.86 + 0.08 * Math.sin(time * 13.1 + best.phase) + 0.06 * noise2D(time * 5.3, best.phase) + 0.03 * Math.sin(time * 31.7);
    lampLight.intensity = 2.6 * f;
  }

  function update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0.016;
    time += dt;
    processDirty(4);
    const cam = viewerPos();
    const p = ctx.player;
    const under = p && typeof p.underground === 'boolean' ? p.underground : undergroundAt(cam);
    visTimer -= dt;
    if (under !== lastUnder || visTimer <= 0) {
      lastUnder = under;
      visTimer = 0.2;
      refreshVisibility(under, cam);
    }
    animateHatches(dt);
    updateLamp(under, cam);
    checkTraps();
  }

  // ---------- events ----------
  const onTunnelMove = () => {
    const pos = ctx.player?.position || viewerPos();
    const h = nearestHatch(pos, 3);
    if (h) openHatch(h);
    visTimer = 0;
  };
  ev.on?.('enterTunnel', onTunnelMove);
  ev.on?.('exitTunnel', onTunnelMove);
  ev.on?.('explosion', (e) => {
    const p = e?.pos;
    if (!p) return;
    const rad = Math.max(1.5, (e.radius || 4) * 0.5);
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i];
      if (!t.armed) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      if (dx * dx + dz * dz < rad * rad && Math.abs(t.y - p.y) < 3) springTrap(t, null);
    }
  });

  // ---------- init ----------
  buildStartNetwork();
  {
    const sx = cellIndex(WORLD.playerStart.x), sz = cellIndex(WORLD.playerStart.z);
    if (getCell(sx + 7, sz + 3)?.chamber) buildStorage(sx + 7, sz + 3);
  }
  processDirty(0);

  function dugCells() { return cells.values(); }

  return {
    group,
    hatches,
    traps,
    cellSize: CELL,
    crawlWidth: CRAWL_W,
    crawlHeight: CRAWL_H,
    chamberHeight: CHAMBER_H,
    digTime: DIG_TIME,
    get version() { return version; },
    get cellCount() { return cells.size; },
    stats,
    lamps,
    isDug,
    cellOf,
    cellCenter,
    cellAt: getCell,
    isChamber: (cx, cz) => !!getCell(cx, cz)?.chamber,
    isFree: isFreeAt,
    floorAt,
    ceilingAt,
    dig,
    digChamber,
    createHatch,
    digTarget,
    applyDig,
    nearestHatch,
    openHatch,
    placeTrap,
    canPlaceTrap,
    constrain,
    isUndergroundAt: undergroundAt,
    update,
    dugCells,
  };
}
