// UNDERGROWTH: tunnels.js
// Free-form digging, hatches, tunnel rendering, punji traps.
//
// The ground is a sparse signed field: solid = min(terrain, carve), where terrain is
// (terrain mesh height - y) and carve is a quantised field stored per 4 m chunk of
// 0.25 m voxels (16^3, Int8), created only where digging happens. A shovel stroke
// smooth-unions one flattened scoop into the carve field; the chunks it touched are
// re-meshed with surface nets (shared border samples, gradient normals, so chunks meet
// without seams). Chunk meshes also draw the untouched ground around holes: a dig mask
// texture over the map tells the terrain shader where to discard, and the chunk shader
// discards its own ground-level fragments everywhere else, so the two surfaces partition
// the ground exactly. The terrain SDF uses the terrain mesh's own triangles (2 m grid,
// same diagonals), so the two surfaces meet at the same height.
//
// The player collides with the same field (floor/ceiling scans, capsule push-out), bullets
// and the dig cursor march it, and "underground" means earth above the eye.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, rand, noise2D, clamp, smoothstep, canvasTexture, events as sharedEvents } from './util.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CELL = WORLD.cell;              // 2 m cells: minimap, tunnelDug events, objective
const DEPTH = WORLD.tunnelDepth;      // camp network floor depth
const VS = 0.25;                      // voxel size
const IVS = 1 / VS;
const CN = 16;                        // voxels per chunk side
const CW = CN * VS;                   // chunk size in metres (4)
const QR = 1.0;                       // carve field is stored clamped to [-QR, QR] metres
const QSC = 127 / QR;
const MAX_CHUNKS = 7000;              // 4 KB of field each at most: ~28 MB cap
const REACH = 4.6;                    // shovel reach from the eye
const RADIUS = { small: 0.6, large: 1.0 };
const FLAT = 0.8;                     // scoops are this much flatter than wide
const SMOOTH = 0.16;                  // smooth-union width between strokes
const DEEP = 1.5;                     // carved this far below the surface counts as tunnel
const MASK_N = 1024;                  // dig mask texels per side (0.5 m)
const MASK_S = MASK_N / WORLD.size;
const LIMIT = WORLD.playable - 4;
const TRAP_HALF = 0.55;
const LAMP_R = 7.5;

const hash2 = (a, b) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ 0x5bd1e995) >>> 0;
const cellIndex = (v) => Math.floor(v / CELL);
const ckey = (ci, cj, ck) => ((ci + 512) * 1024 + (cj + 512)) * 1024 + (ck + 512);
const colKey = (ci, ck) => (ci + 512) * 1024 + (ck + 512);
const cellKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

const LAMP_COL = new THREE.Color(0xffc890);

// Dig mask lookup with a little noise so the edge between terrain and dug ground is ragged
// (the same code runs in the terrain and the chunk shaders, so both cut on the same line).
const MASK_GLSL = /* glsl */`
uniform sampler2D uDigMask;
uniform vec4 uDigCursor;
uniform vec4 uDigCursorCol;
uniform float uDigDebug;
float ugDigHash(vec2 p) { p = mod(p, 289.0); return fract(sin(dot(p, vec2(12.9898, 4.1414))) * 4375.85453); }
float ugDigNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ugDigHash(i), ugDigHash(i + vec2(1.0, 0.0)), f.x), mix(ugDigHash(i + vec2(0.0, 1.0)), ugDigHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ugDigMask(vec2 xz) {
  float m = texture2D(uDigMask, (xz + 256.0) / 512.0).r;
  if (m < 0.02) return 0.0;
  return m + (ugDigNoise(xz * 3.1) - 0.5) * 0.36 + (ugDigNoise(xz * 9.7 + 17.0) - 0.5) * 0.16;
}
vec3 ugDigCursor(vec3 col, vec3 wp) {
  if (uDigCursorCol.a <= 0.0) return col;
  float cd = distance(wp, uDigCursor.xyz);
  float r = uDigCursor.w;
  float aa = fwidth(cd) * 1.5 + 0.004;
  float ring = smoothstep(r - 0.03 - aa, r - 0.03, cd) * (1.0 - smoothstep(r - aa * 0.5, r + aa, cd));
  float fill = (1.0 - smoothstep(0.0, r, cd)) * 0.12;
  return mix(col, uDigCursorCol.rgb, clamp((ring * 0.85 + fill) * uDigCursorCol.a, 0.0, 1.0));
}
`;

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
// createTunnels
// ---------------------------------------------------------------------------
export function createTunnels(ctx = {}) {
  const ev = ctx.events || sharedEvents;
  const hatches = [];
  const traps = [];
  const lamps = [];
  const props = [];                    // AABB obstacles in carved rooms {x0, z0, x1, z1, y0, y1}
  let version = 0;
  let time = 0;

  const group = new THREE.Group();
  group.name = 'tunnels';
  const chunkGroup = new THREE.Group();
  chunkGroup.name = 'tunnelChunks';
  const interior = new THREE.Group();
  interior.name = 'tunnelInterior';
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = 'tunnelSurface';
  group.add(chunkGroup, interior, surfaceGroup);
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
  // Height of the rendered terrain mesh (2 m grid, alternating diagonals, see world.js
  // gridGeometry), so dug ground meets the terrain surface without a step.
  let mhX = NaN, mhZ = NaN, mhV = 0;
  function meshH(x, z) {
    if (x === mhX && z === mhZ) return mhV;
    const gx = (x + 256) * 0.5, gz = (z + 256) * 0.5;
    let h;
    if (!(gx >= 0 && gz >= 0 && gx < 255.999 && gz < 255.999)) h = terrainH(x, z);
    else {
      const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
      const x0 = i * 2 - 256, z0 = j * 2 - 256;
      const a = terrainH(x0, z0), b = terrainH(x0 + 2, z0), c = terrainH(x0, z0 + 2), d = terrainH(x0 + 2, z0 + 2);
      if ((i + j) & 1) h = tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
      else h = tx >= tz ? a + (b - a) * tx + (d - b) * tz : a + (c - a) * tz + (d - c) * tx;
    }
    mhX = x; mhZ = z; mhV = h;
    return h;
  }

  // ---------- carve field storage ----------
  const chunks = new Map();            // ckey -> chunk
  const chunkList = [];
  const colInfo = new Map();           // colKey -> {minY, maxY} of chunks holding carve data
  let dataChunks = 0;
  function getChunk(ci, cj, ck, create) {
    const k = ckey(ci, cj, ck);
    let c = chunks.get(k);
    if (!c && create) {
      c = {
        key: k, ci, cj, ck, data: null, mesh: null, surface: false, dirty: false, prio: 0,
        x0: ci * CW, y0: cj * CW, z0: ck * CW, cx: (ci + 0.5) * CW, cy: (cj + 0.5) * CW, cz: (ck + 0.5) * CW,
      };
      chunks.set(k, c);
      chunkList.push(c);
      qc.ci = 1e9;
    }
    return c;
  }
  function ensureData(c) {
    if (c.data) return c.data;
    c.data = new Int8Array(CN * CN * CN).fill(127);
    dataChunks++;
    const ck = colKey(c.ci, c.ck);
    let ci = colInfo.get(ck);
    if (!ci) { ci = { minY: c.y0, maxY: c.y0 + CW }; colInfo.set(ck, ci); }
    else { ci.minY = Math.min(ci.minY, c.y0); ci.maxY = Math.max(ci.maxY, c.y0 + CW); }
    return c.data;
  }
  // carve value at lattice point (i, j, k), with a one-chunk lookup cache
  const qc = { ci: 1e9, cj: 0, ck: 0, d: null };
  function qAt(i, j, k) {
    const ci = i >> 4, cj = j >> 4, ck = k >> 4;
    if (ci !== qc.ci || cj !== qc.cj || ck !== qc.ck) {
      qc.ci = ci; qc.cj = cj; qc.ck = ck;
      const c = chunks.get(ckey(ci, cj, ck));
      qc.d = c ? c.data : null;
    }
    const d = qc.d;
    return d ? d[((k & 15) * CN + (j & 15)) * CN + (i & 15)] / QSC : QR;
  }
  // Is there carve data in reach of (x, y, z)? (column test, then height band)
  function carvedNearY(x, y, z, pad) {
    const ci = Math.floor(x / CW), ck = Math.floor(z / CW);
    const c = colInfo.get(colKey(ci, ck));
    if (c && y > c.minY - pad && y < c.maxY + pad) return true;
    const fx = x / CW - ci, fz = z / CW - ck, e = pad / CW;
    const di = fx < e ? -1 : fx > 1 - e ? 1 : 0, dk = fz < e ? -1 : fz > 1 - e ? 1 : 0;
    if (di) { const o = colInfo.get(colKey(ci + di, ck)); if (o && y > o.minY - pad && y < o.maxY + pad) return true; }
    if (dk) { const o = colInfo.get(colKey(ci, ck + dk)); if (o && y > o.minY - pad && y < o.maxY + pad) return true; }
    if (di && dk) { const o = colInfo.get(colKey(ci + di, ck + dk)); if (o && y > o.minY - pad && y < o.maxY + pad) return true; }
    return false;
  }
  function carvedNear(x, z) {
    const ci = Math.floor(x / CW), ck = Math.floor(z / CW);
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!colInfo.has(colKey(ci + di, ck + dk))) continue;
      const nx = clamp(x, (ci + di) * CW, (ci + di + 1) * CW), nz = clamp(z, (ck + dk) * CW, (ck + dk + 1) * CW);
      if ((nx - x) * (nx - x) + (nz - z) * (nz - z) < 0.81) return true;
    }
    return false;
  }
  // trilinear carve value
  function qTri(x, y, z) {
    const fx = x * IVS, fy = y * IVS, fz = z * IVS;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const a = qAt(i, j, k), b = qAt(i + 1, j, k), c = qAt(i, j + 1, k), d = qAt(i + 1, j + 1, k);
    const e = qAt(i, j, k + 1), f = qAt(i + 1, j, k + 1), g = qAt(i, j + 1, k + 1), h = qAt(i + 1, j + 1, k + 1);
    const ab = a + (b - a) * tx, cd = c + (d - c) * tx, ef = e + (f - e) * tx, gh = g + (h - g) * tx;
    const l0 = ab + (cd - ab) * ty, l1 = ef + (gh - ef) * ty;
    return l0 + (l1 - l0) * tz;
  }
  // signed field: > 0 solid earth, <= 0 air
  function field(x, y, z) {
    const t = meshH(x, z) - y;
    if (t < -QR || !carvedNearY(x, y, z, 0.6)) return t;
    const q = qTri(x, y, z);
    return t < q ? t : q;
  }
  const _g = new THREE.Vector3();
  function fieldGrad(x, y, z, out, e = 0.08) {
    return out.set(
      field(x + e, y, z) - field(x - e, y, z),
      field(x, y + e, z) - field(x, y - e, z),
      field(x, y, z + e) - field(x, y, z - e));
  }

  // ---------- dig mask (where the terrain mesh gives way to chunk meshes) ----------
  const maskData = new Uint8Array(MASK_N * MASK_N);
  const maskTex = new THREE.DataTexture(maskData, MASK_N, MASK_N, THREE.RedFormat, THREE.UnsignedByteType);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.generateMipmaps = false;
  maskTex.needsUpdate = true;
  let maskDirty = false;
  const DIGU = {
    uDigMask: { value: maskTex },
    uDigCursor: { value: new THREE.Vector4(0, -1000, 0, 0.5) },
    uDigCursorCol: { value: new THREE.Vector4(1, 1, 1, 0) },
    uDigDebug: { value: 0 },
  };
  function maskAt(x, z) {
    const fx = (x + WORLD.half) * MASK_S - 0.5, fz = (z + WORLD.half) * MASK_S - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= MASK_N - 1 || j >= MASK_N - 1) return 0;
    const tx = fx - i, tz = fz - j, o = j * MASK_N + i;
    const a = maskData[o], b = maskData[o + 1], c = maskData[o + MASK_N], d = maskData[o + MASK_N + 1];
    return ((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz) / 255;
  }
  // Open the ground within `rad` of (x, z): ramp so the 0.5 contour sits at rad.
  function stampMask(x, z, rad) {
    const R = rad + 0.8;
    const i0 = Math.max(0, Math.floor((x - R + WORLD.half) * MASK_S)), i1 = Math.min(MASK_N - 1, Math.ceil((x + R + WORLD.half) * MASK_S));
    const j0 = Math.max(0, Math.floor((z - R + WORLD.half) * MASK_S)), j1 = Math.min(MASK_N - 1, Math.ceil((z + R + WORLD.half) * MASK_S));
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) / MASK_S - WORLD.half;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) / MASK_S - WORLD.half;
        const d = Math.hypot(wx - x, wz - z);
        const v = clamp((rad - d) / 0.7 + 0.5, 0, 1) * 255;
        const o = j * MASK_N + i;
        if (v > maskData[o]) maskData[o] = v;
      }
    }
    maskDirty = true;
    // chunk meshes must exist wherever the ground is now drawn by them
    const pad = 0.75;
    const ci0 = Math.floor((x - rad - pad) / CW), ci1 = Math.floor((x + rad + pad) / CW);
    const ck0 = Math.floor((z - rad - pad) / CW), ck1 = Math.floor((z + rad + pad) / CW);
    for (let ck = ck0; ck <= ck1; ck++) for (let ci = ci0; ci <= ci1; ci++) {
      const ax = Math.max(ci * CW, x - rad - pad), bx = Math.min((ci + 1) * CW, x + rad + pad);
      const az = Math.max(ck * CW, z - rad - pad), bz = Math.min((ck + 1) * CW, z + rad + pad);
      let lo = Infinity, hi = -Infinity;
      for (let s = 0; s <= 2; s++) for (let r = 0; r <= 2; r++) {
        const h = meshH(ax + (bx - ax) * r * 0.5, az + (bz - az) * s * 0.5);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      const cj0 = Math.floor((lo - 0.7) / CW), cj1 = Math.floor((hi + 0.7) / CW);
      for (let cj = cj0; cj <= cj1; cj++) markDirty(getChunk(ci, cj, ck, true), x, z);
    }
  }

  // ---------- materials ----------
  const clay = makeClayTextures();
  const bakeGain = { value: 1 };
  const earthMat = new THREE.MeshStandardMaterial({
    map: clay.map, normalMap: clay.normalMap, normalScale: new THREE.Vector2(1.15, 1.15),
    roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4,
  });
  earthMat.name = 'dugEarth';
  earthMat.customProgramCacheKey = () => 'ugDugEarth2';
  earthMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, DIGU);
    sh.uniforms.triScale = { value: 1 / 1.6 };
    sh.uniforms.bakeGain = bakeGain;
    sh.uniforms.uLampCol = { value: LAMP_COL };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aux;\nvarying vec4 vAux;\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux;\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vAux;
varying vec3 vTriPos;
varying vec3 vTriNrm;
uniform float triScale;
uniform float bakeGain;
uniform vec3 uLampCol;
${MASK_GLSL}
vec3 triW;
vec2 triUvX; vec2 triUvY; vec2 triUvZ;
float ugDeep;`)
      .replace('#include <clipping_planes_fragment>', `
if (uDigDebug < 0.5 && vAux.x < 0.12 && ugDigMask(vTriPos.xz) <= 0.42) discard;
if (uDigDebug > 1.5) { gl_FragColor = vec4(vAux.x < 0.12 ? 1.0 : 0.0, 0.0, 1.0, 1.0); return; }
#include <clipping_planes_fragment>`)
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
  vec3 tex = mix(tc, tc2, 0.36).rgb;
  float dep = vAux.x;
  float nz = ugDigNoise(vTriPos.xz * 0.9 + vec2(vTriPos.y * 0.6, 0.0));
  // dark humus topsoil over red laterite clay, with pale mottles and faint bedding
  float topK = 1.0 - smoothstep(0.12, 0.55, dep + (nz - 0.5) * 0.3);
  vec3 lat = vec3(1.2, 0.8, 0.62);
  vec3 humus = vec3(0.56, 0.45, 0.36);
  vec3 tint = mix(lat, humus, topK);
  float band = 0.5 + 0.5 * sin(vTriPos.y * 4.3 + nz * 4.0);
  tint *= 0.93 + 0.1 * band;
  float mott = smoothstep(0.58, 0.82, ugDigNoise(vTriPos.xz * 1.9 + vec2(0.0, vTriPos.y * 1.7)));
  tint = mix(tint, tint * vec3(1.1, 1.04, 0.92), mott * (1.0 - topK) * 0.7);
  // loose, scuffed earth on the ground around a hole
  float flatUp = smoothstep(0.75, 0.95, vTriNrm.y) * (1.0 - smoothstep(0.05, 0.2, dep));
  tint = mix(tint, vec3(0.78, 0.6, 0.48), flatUp * 0.55);
  // damper and darker with depth
  ugDeep = smoothstep(0.6, 4.0, dep);
  tint *= mix(1.0, 0.68, ugDeep);
  diffuseColor.rgb *= tex * tint;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.96, 0.72, ugDeep);')
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
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float ugAmb = vAux.y * mix(0.16, 1.0, vAux.z);
  reflectedLight.indirectDiffuse *= ugAmb;
  reflectedLight.indirectSpecular *= ugAmb;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uLampCol * (vAux.w * bakeGain);`)
      .replace('#include <opaque_fragment>', `{
  float lumO = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = max(mix(vec3(lumO), outgoingLight, mix(0.6, 0.9, smoothstep(0.0, 0.35, lumO))), vec3(0.0));
  outgoingLight = ugDigCursor(outgoingLight, vTriPos);
}
#include <opaque_fragment>`);
  };
  try { ctx.world?.bakePatch?.(earthMat); } catch (e) { /* optional */ }

  // Terrain: discard where the ground has been dug open, and draw the dig cursor.
  function patchTerrain(mat) {
    if (!mat || !mat.isMaterial || mat.userData.ugDig) return;
    mat.userData.ugDig = true;
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, sh, r);
      if (!/varying vec3 vTW;/.test(sh.fragmentShader)) return;
      Object.assign(sh.uniforms, DIGU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + MASK_GLSL)
        .replace('#include <clipping_planes_fragment>', 'if (ugDigMask(vTW.xz) > 0.5) discard;\n#include <clipping_planes_fragment>')
        .replace('#include <opaque_fragment>', 'outgoingLight = ugDigCursor(outgoingLight, vTW);\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|ugdig'; };
    mat.needsUpdate = true;
  }
  patchTerrain(ctx.world?.terrainMaterial);
  const terrainDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  terrainDepth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, DIGU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\n' + MASK_GLSL)
      .replace('#include <clipping_planes_fragment>', 'if (ugDigMask(vTW.xz) > 0.5) discard;\n#include <clipping_planes_fragment>');
  };
  terrainDepth.customProgramCacheKey = () => 'ugTerrainDepthDig';
  ctx.world?.group?.traverse?.((o) => { if (o.isMesh && o.name === 'terrain' && o.castShadow) o.customDepthMaterial = terrainDepth; });
  if (ctx.world?.digMask) ctx.world.digMask.value = maskTex;

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
  const _ya = new THREE.Vector3(0, 1, 0);
  const _tq = new THREE.Quaternion();
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

  // ---------- carving ----------
  const dirtyChunks = new Set();
  function markDirty(c, px, pz) {
    if (!c) return;
    c.prio = Math.hypot(c.cx - px, c.cz - pz);
    if (!c.dirty) { c.dirty = true; dirtyChunks.add(c); }
  }
  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  // Smooth-union an air shape into the carve field. sd(x, y, z) is the shape's signed
  // distance (negative inside). Returns the number of lattice points that changed.
  function carve(x0, y0, z0, x1, y1, z1, sd, px, pz) {
    const m = SMOOTH + 0.1;
    const i0 = Math.floor((x0 - m) * IVS), i1 = Math.ceil((x1 + m) * IVS);
    const j0 = Math.floor((y0 - m) * IVS), j1 = Math.ceil((y1 + m) * IVS);
    const k0 = Math.floor((z0 - m) * IVS), k1 = Math.ceil((z1 + m) * IVS);
    let changed = 0;
    for (let ck = k0 >> 4; ck <= k1 >> 4; ck++) for (let cj = j0 >> 4; cj <= j1 >> 4; cj++) for (let ci = i0 >> 4; ci <= i1 >> 4; ci++) {
      const c = getChunk(ci, cj, ck, true);
      const ia = Math.max(i0, ci * CN), ib = Math.min(i1, ci * CN + CN - 1);
      const ja = Math.max(j0, cj * CN), jb = Math.min(j1, cj * CN + CN - 1);
      const ka = Math.max(k0, ck * CN), kb = Math.min(k1, ck * CN + CN - 1);
      let data = c.data, n = 0;
      for (let k = ka; k <= kb; k++) {
        const z = k * VS;
        for (let i = ia; i <= ib; i++) {
          const x = i * VS;
          const h = meshH(x, z);
          for (let j = ja; j <= jb; j++) {
            const y = j * VS;
            if (y > h + QR) continue;                 // open air: nothing to carve
            const d = sd(x, y, z);
            if (d >= QR + SMOOTH) continue;
            if (!data) data = ensureData(c);
            const o = ((k & 15) * CN + (j & 15)) * CN + (i & 15);
            const old = data[o] / QSC;
            const nv = clamp(smin(old, d, SMOOTH), -QR, QR);
            const qv = Math.round(nv * QSC);
            if (qv < data[o]) { data[o] = qv; n++; }
          }
        }
      }
      if (n) changed += n;
    }
    if (!changed) return 0;
    // every chunk whose mesh reads a changed sample (meshes read 2 samples past their edge)
    const ci0 = (i0 - 3) >> 4, ci1 = (i1 + 2) >> 4, cj0 = (j0 - 3) >> 4, cj1 = (j1 + 2) >> 4, ck0 = (k0 - 3) >> 4, ck1 = (k1 + 2) >> 4;
    for (let ck = ck0; ck <= ck1; ck++) for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      markDirty(getChunk(ci, cj, ck, true), px, pz);
    }
    version++;
    return changed;
  }
  // small 3D noise for scoop walls (made from two 2D noises)
  const scoopNoise = (x, y, z) => 0.5 * noise2D(x * 2.3 + y * 1.7, z * 2.3 - y * 1.1) + 0.3 * noise2D(x * 5.3 - z * 0.7 + 11.0, y * 5.3 + z * 0.9 - 3.0);

  // One shovel scoop: flattened ball of radius r at c; with a floor level `fy`, the scoop is
  // stretched down to it and cut flat there (digging ahead keeps a level floor).
  function carveScoop(cx, cy, cz, r, fy, px, pz) {
    const assist = Number.isFinite(fy);
    const yLow = assist ? Math.min(cy, fy + r * FLAT * 0.3) : cy;
    const cut = assist ? fy - 0.03 : -Infinity;
    const ifl = 1 / FLAT;
    const sd = (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      const yy = y < yLow ? y - yLow : y > cy ? y - cy : 0;
      const dy = yy * ifl;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      d += scoopNoise(x, y, z) * 0.07;
      return cut - y > d ? cut - y : d;
    };
    return carve(cx - r - 0.1, Math.max(cut, yLow - r * FLAT) - 0.1, cz - r - 0.1, cx + r + 0.1, cy + r * FLAT + 0.1, cz + r + 0.1, sd, px, pz);
  }
  // Crawl tunnel between two floor points: arched profile w wide, h high, flat floor.
  function carveTunnel(ax, af, az, bx, bf, bz, w, h) {
    const lx = bx - ax, lz = bz - az, L2 = lx * lx + lz * lz || 1;
    const rr = w * 0.5;
    const sd = (x, y, z) => {
      const t = clamp(((x - ax) * lx + (z - az) * lz) / L2, 0, 1);
      const px = ax + lx * t, pz = az + lz * t, fl = af + (bf - af) * t;
      const dh = Math.hypot(x - px, z - pz);
      const lo = fl + 0.1, hi = fl + h - rr;
      const yy = y < lo ? y - lo : y > hi ? y - hi : 0;
      let d = Math.sqrt(dh * dh + yy * yy) - rr;
      d += scoopNoise(x, y, z) * 0.06;
      return fl - 0.02 - y > d ? fl - 0.02 - y : d;
    };
    return carve(Math.min(ax, bx) - rr, Math.min(af, bf) - 0.2, Math.min(az, bz) - rr,
      Math.max(ax, bx) + rr, Math.max(af, bf) + h + 0.1, Math.max(az, bz) + rr, sd, ax, az);
  }
  // Room: rounded box hx * hz, height h above a flat floor.
  function carveRoom(cx, fl, cz, hx, hz, h, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const rad = 0.75;
    const cy = fl + (h - 0.5) * 0.5, hy = (h + 0.5) * 0.5;
    const sd = (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      const u = Math.abs(dx * c + dz * s) - (hx - rad), v = Math.abs(-dx * s + dz * c) - (hz - rad), w = Math.abs(y - cy) - (hy - rad);
      const ou = Math.max(u, 0), ov = Math.max(v, 0), ow = Math.max(w, 0);
      let d = Math.sqrt(ou * ou + ov * ov + ow * ow) + Math.min(Math.max(u, v, w), 0) - rad;
      d += scoopNoise(x, y, z) * 0.08;
      return fl - 0.02 - y > d ? fl - 0.02 - y : d;
    };
    const e = Math.max(hx, hz) + 0.2;
    return carve(cx - e, fl - 0.2, cz - e, cx + e, fl + h + 0.1, cz + e, sd, cx, cz);
  }
  // Vertical shaft from a floor up to `top`.
  function carveShaft(cx, fl, cz, top, r) {
    const sd = (x, y, z) => {
      const dh = Math.hypot(x - cx, z - cz);
      const yy = y < fl + r ? y - (fl + r) : y > top ? y - top : 0;
      const d = Math.sqrt(dh * dh + yy * yy) - r + scoopNoise(x, y, z) * 0.04;
      return y - top > d ? y - top : d;
    };
    return carve(cx - r, fl - 0.1, cz - r, cx + r, top + 0.1, cz + r, sd, cx, cz);
  }

  // ---------- surface nets mesher ----------
  const SN = CN + 4;                 // samples per axis: lattice i0-2 .. i0+CN+1
  const SN2 = SN * SN;
  const NC = CN + 1;                 // cells per axis with a vertex: min corner i0-1 .. i0+CN-1
  const S = new Float32Array(SN * SN2);
  const colH = new Float32Array(SN2);
  const colOpen = new Float32Array(SN2);
  const cellVi = new Int32Array(NC * NC * NC);
  const MAXV = NC * NC * NC;
  const vPos = new Float32Array(MAXV * 3), vNor = new Float32Array(MAXV * 3), vAux = new Float32Array(MAXV * 4);
  const idxBuf = new Uint16Array(3 * CN * CN * CN * 6);
  const EDGES = [];
  for (let k = 0; k < 8; k++) for (const bit of [1, 2, 4]) if (!(k & bit)) EDGES.push(k, k | bit);
  const sI = (a, b, c) => (c * SN + b) * SN + a;
  function sTri(fx, fy, fz) {
    fx = clamp(fx, 0, SN - 1.001); fy = clamp(fy, 0, SN - 1.001); fz = clamp(fz, 0, SN - 1.001);
    const a = fx | 0, b = fy | 0, c = fz | 0, tx = fx - a, ty = fy - b, tz = fz - c;
    const o = sI(a, b, c);
    const s000 = S[o], s100 = S[o + 1], s010 = S[o + SN], s110 = S[o + SN + 1];
    const s001 = S[o + SN2], s101 = S[o + SN2 + 1], s011 = S[o + SN2 + SN], s111 = S[o + SN2 + SN + 1];
    const x00 = s000 + (s100 - s000) * tx, x10 = s010 + (s110 - s010) * tx, x01 = s001 + (s101 - s001) * tx, x11 = s011 + (s111 - s011) * tx;
    const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }
  const meshStats = { builds: 0, ms: 0, last: 0, verts: 0, tris: 0, fill: 0, sky: 0, cells: 0, lamp: 0, stroke: 0 };
  function buildChunk(ch) {
    const t0 = performance.now();
    const ib = ch.ci * CN - 2, jb = ch.cj * CN - 2, kb = ch.ck * CN - 2;
    let any = false, solid = false, air = false;
    for (let c = 0; c < SN; c++) for (let a = 0; a < SN; a++) colH[c * SN + a] = meshH((ib + a) * VS, (kb + c) * VS);
    for (let c = 0; c < SN; c++) {
      const k = kb + c;
      for (let b = 0; b < SN; b++) {
        const j = jb + b, y = j * VS;
        for (let a = 0; a < SN; a++) {
          const t = colH[c * SN + a] - y;
          let v = t;
          if (t > -QR) { const q = qAt(ib + a, j, k); if (q < v) v = q; }
          S[(c * SN + b) * SN + a] = v;
          if (v > 0) solid = true; else air = true;
        }
      }
    }
    any = solid && air;
    let nv = 0, ni = 0;
    const t1 = performance.now();
    meshStats.fill += t1 - t0;
    if (any) {
      // sky: per column, the height down to which it is open to the sky
      const yBot = (jb - 4) * VS;
      for (let c = 0; c < SN; c++) for (let a = 0; a < SN; a++) {
        const h = colH[c * SN + a];
        const i = ib + a, k = kb + c;
        let j = Math.floor(h * IVS) + 1, prevF = h - j * VS, open = yBot;
        if (carvedNearY(i * VS, h - 0.5, k * VS, 1.0)) {
          for (; j * VS > yBot; j--) {
            const y = j * VS;
            let f = h - y;
            if (f > -QR) { const q = qAt(i, j, k); if (q < f) f = q; }
            if (f > 0) { open = y + VS * (f / (f - prevF)); break; }
            prevF = f;
          }
        } else open = h;
        colOpen[c * SN + a] = open;
      }
      meshStats.sky += performance.now() - t1;
      // vertices
      for (let c = 1; c <= NC; c++) for (let b = 1; b <= NC; b++) for (let a = 1; a <= NC; a++) {
        const o = sI(a, b, c);
        const v0 = S[o], v1 = S[o + 1], v2 = S[o + SN], v3 = S[o + SN + 1];
        const v4 = S[o + SN2], v5 = S[o + SN2 + 1], v6 = S[o + SN2 + SN], v7 = S[o + SN2 + SN + 1];
        const m = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0) | (v4 > 0 ? 16 : 0) | (v5 > 0 ? 32 : 0) | (v6 > 0 ? 64 : 0) | (v7 > 0 ? 128 : 0);
        const ci = ((c - 1) * NC + (b - 1)) * NC + (a - 1);
        if (m === 0 || m === 255) { cellVi[ci] = -1; continue; }
        const cv = CV; cv[0] = v0; cv[1] = v1; cv[2] = v2; cv[3] = v3; cv[4] = v4; cv[5] = v5; cv[6] = v6; cv[7] = v7;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 24; e += 2) {
          const p = EDGES[e], q = EDGES[e + 1];
          const fp = cv[p], fq = cv[q];
          if ((fp > 0) === (fq > 0)) continue;
          const t = fp / (fp - fq);
          sx += (p & 1) + ((q & 1) - (p & 1)) * t;
          sy += ((p >> 1) & 1) + (((q >> 1) & 1) - ((p >> 1) & 1)) * t;
          sz += ((p >> 2) & 1) + (((q >> 2) & 1) - ((p >> 2) & 1)) * t;
          n++;
        }
        const ux = sx / n, uy = sy / n, uz = sz / n;
        // gradient: trilinear blend of corner central differences
        let gx = 0, gy = 0, gz = 0;
        for (let k = 0; k < 8; k++) {
          const ox = k & 1, oy = (k >> 1) & 1, oz = (k >> 2) & 1;
          const w = (ox ? ux : 1 - ux) * (oy ? uy : 1 - uy) * (oz ? uz : 1 - uz);
          const so = sI(a + ox, b + oy, c + oz);
          gx += w * (S[so + 1] - S[so - 1]);
          gy += w * (S[so + SN] - S[so - SN]);
          gz += w * (S[so + SN2] - S[so - SN2]);
        }
        const gl = Math.hypot(gx, gy, gz) || 1;
        const nx = -gx / gl, ny = -gy / gl, nz = -gz / gl;
        const lx = a + ux, ly = b + uy, lz = c + uz;            // sample-grid coordinates
        const wx = (ib + lx) * VS, wy = (jb + ly) * VS, wz = (kb + lz) * VS;
        vPos[nv * 3] = wx; vPos[nv * 3 + 1] = wy; vPos[nv * 3 + 2] = wz;
        vNor[nv * 3] = nx; vNor[nv * 3 + 1] = ny; vNor[nv * 3 + 2] = nz;
        // depth below the original surface (bilinear over the column heights)
        const ca = lx | 0, cc = lz | 0, fa = lx - ca, fc = lz - cc;
        const h00 = colH[cc * SN + ca], h10 = colH[cc * SN + ca + 1], h01 = colH[(cc + 1) * SN + ca], h11 = colH[(cc + 1) * SN + ca + 1];
        const hh = (h00 + (h10 - h00) * fa) * (1 - fc) + (h01 + (h11 - h01) * fa) * fc;
        const depth = hh - wy;
        // ambient occlusion from the field along the normal
        let occ = 0;
        for (let s = 1; s <= 2; s++) {
          const d = s * 0.2;
          const fv = sTri(lx + nx * d * IVS, ly + ny * d * IVS, lz + nz * d * IVS);
          occ += Math.max(0, d + fv) / d * 0.5;
        }
        // crease darkening toward the floor of walls
        const ao = clamp(1 - occ * 0.85, 0.22, 1);
        // sky: own column and four neighbours half a metre away seen 45 degrees up
        let sky = 0;
        {
          const ia2 = clamp(Math.round(lx), 0, SN - 1), ic2 = clamp(Math.round(lz), 0, SN - 1);
          sky += 2 * smoothstep(-0.25, 0.25, wy + 0.3 - colOpen[ic2 * SN + ia2]);
          const nb = [[2, 0], [-2, 0], [0, 2], [0, -2]];
          for (let q = 0; q < 4; q++) {
            const xa = clamp(ia2 + nb[q][0], 0, SN - 1), xc = clamp(ic2 + nb[q][1], 0, SN - 1);
            sky += smoothstep(-0.25, 0.25, wy + 0.55 - colOpen[xc * SN + xa]);
          }
          sky /= 6;
        }
        vAux[nv * 4] = depth; vAux[nv * 4 + 1] = ao; vAux[nv * 4 + 2] = sky; vAux[nv * 4 + 3] = 0;
        cellVi[ci] = nv++;
      }
      const cvi = (a, b, c) => cellVi[((c - 1) * NC + (b - 1)) * NC + (a - 1)];
      const quad = (s0, q0, q1, q2, q3) => {
        if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) return;
        if (s0) { idxBuf[ni++] = q0; idxBuf[ni++] = q1; idxBuf[ni++] = q2; idxBuf[ni++] = q0; idxBuf[ni++] = q2; idxBuf[ni++] = q3; }
        else { idxBuf[ni++] = q0; idxBuf[ni++] = q3; idxBuf[ni++] = q2; idxBuf[ni++] = q0; idxBuf[ni++] = q2; idxBuf[ni++] = q1; }
      };
      for (let c = 2; c <= CN + 1; c++) for (let b = 2; b <= CN + 1; b++) for (let a = 2; a <= CN + 1; a++) {
        const o = sI(a, b, c);
        const s0 = S[o] > 0;
        if (s0 !== (S[o + 1] > 0)) quad(s0, cvi(a, b - 1, c - 1), cvi(a, b, c - 1), cvi(a, b, c), cvi(a, b - 1, c));
        if (s0 !== (S[o + SN] > 0)) quad(s0, cvi(a - 1, b, c - 1), cvi(a - 1, b, c), cvi(a, b, c), cvi(a, b, c - 1));
        if (s0 !== (S[o + SN2] > 0)) quad(s0, cvi(a - 1, b - 1, c), cvi(a, b - 1, c), cvi(a, b, c), cvi(a - 1, b, c));
      }
    }
    // swap the mesh
    if (ch.mesh) {
      chunkGroup.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      ch.mesh = null;
    }
    ch.surface = false;
    if (ni > 0) {
      // compact: only vertices referenced by this chunk's quads
      const remap = REMAP;
      remap.fill(-1, 0, nv);
      let n2 = 0;
      for (let i = 0; i < ni; i++) { const v = idxBuf[i]; if (remap[v] < 0) remap[v] = n2++; idxBuf[i] = remap[v]; }
      const P = new Float32Array(n2 * 3), N = new Float32Array(n2 * 3), A = new Float32Array(n2 * 4);
      for (let v = 0; v < nv; v++) {
        const d = remap[v];
        if (d < 0) continue;
        P[d * 3] = vPos[v * 3]; P[d * 3 + 1] = vPos[v * 3 + 1]; P[d * 3 + 2] = vPos[v * 3 + 2];
        N[d * 3] = vNor[v * 3]; N[d * 3 + 1] = vNor[v * 3 + 1]; N[d * 3 + 2] = vNor[v * 3 + 2];
        A[d * 4] = vAux[v * 4]; A[d * 4 + 1] = vAux[v * 4 + 1]; A[d * 4 + 2] = vAux[v * 4 + 2]; A[d * 4 + 3] = 0;
        if (vAux[v * 4] < 0.6 || vAux[v * 4 + 2] > 0.05) ch.surface = true;
      }
      const tl = performance.now();
      bakeLamps(ch, P, N, A, n2);
      meshStats.lamp += performance.now() - tl;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('aux', new THREE.BufferAttribute(A, 4));
      geo.setIndex(new THREE.BufferAttribute(idxBuf.slice(0, ni), 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(ch.cx, ch.cy, ch.cz), CW * 0.9 + 0.6);
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(ch.x0 - 0.3, ch.y0 - 0.3, ch.z0 - 0.3), new THREE.Vector3(ch.x0 + CW + 0.3, ch.y0 + CW + 0.3, ch.z0 + CW + 0.3));
      const mesh = new THREE.Mesh(geo, earthMat);
      mesh.name = 'dugEarth';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.castShadow = ch.surface;
      mesh.userData.chunk = ch;
      chunkGroup.add(mesh);
      ch.mesh = mesh;
      meshStats.verts += n2; meshStats.tris += ni / 3;
      visTimer = 0;
    }
    ch.dirty = false;
    const dt = performance.now() - t0;
    meshStats.builds++; meshStats.ms += dt; meshStats.last = dt;
  }
  const CV = new Float32Array(8);
  const REMAP = new Int32Array(MAXV);

  // Baked oil-lamp light: warm light from the fixed lamps, blocked by earth.
  function bakeLamps(ch, P, N, A, n) {
    for (let li = 0; li < lamps.length; li++) {
      const l = lamps[li];
      const dx0 = l.x - ch.cx, dy0 = l.y - ch.cy, dz0 = l.z - ch.cz;
      if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > (LAMP_R + CW) * (LAMP_R + CW)) continue;
      for (let v = 0; v < n; v++) {
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > LAMP_R * LAMP_R) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const ndl = (dx * N[v * 3] + dy * N[v * 3 + 1] + dz * N[v * 3 + 2]) / d;
        if (ndl <= 0) continue;
        // march toward the lamp
        let vis = 1;
        const steps = Math.ceil(d / 0.22);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const f = field(px + dx * t + N[v * 3] * 0.06, py + dy * t + N[v * 3 + 1] * 0.06, pz + dz * t + N[v * 3 + 2] * 0.06);
          if (f > 0.02) { vis = 0; break; }
        }
        if (!vis) continue;
        const fall = Math.pow(1 - d / LAMP_R, 2) / (1 + d2 * 0.35);
        A[v * 4 + 3] += l.power * 0.85 * fall * (0.35 + 0.65 * ndl);
      }
    }
  }

  function processDirty(budgetMs, focusX, focusZ) {
    if (!dirtyChunks.size) return;
    const t0 = performance.now();
    while (dirtyChunks.size) {
      let best = null;
      for (const c of dirtyChunks) if (!best || c.prio < best.prio) best = c;
      dirtyChunks.delete(best);
      buildChunk(best);
      if (budgetMs >= 0 && performance.now() - t0 > budgetMs) break;
    }
  }

  // ---------- queries ----------
  // March from o along unit d; distance to the first solid earth, or -1.
  function raycast(o, d, maxT) {
    if (!o || !d) return -1;
    let f = field(o.x, o.y, o.z);
    if (f > 0.02) return -1;
    let t = 0, prevT = 0;
    for (let n = 0; n < 500 && t < maxT; n++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      f = field(x, y, z);
      if (f > 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 7; k++) {
          const m = (a + b) * 0.5;
          if (field(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m) > 0) b = m; else a = m;
        }
        return b;
      }
      prevT = t;
      const near = carvedNearY(x, y, z, 1.2);
      t += near ? clamp(-f * 0.7, 0.04, 0.35) : clamp(-f * 0.6, 0.15, 6);
    }
    return -1;
  }
  // Floor under (x, y + up, z) in carved ground; null where nothing is carved nearby.
  function groundAt(x, y, z, up = 0.45) {
    if (!carvedNearY(x, y, z, 1.5)) return null;
    let yy = y + up;
    let f = field(x, yy, z);
    if (f > 0) {
      // start in earth: the top of that earth, if it is within the step
      for (let n = 0; n < 12 && yy > y - 0.3; n++) {
        const ny = yy - 0.07, nf = field(x, ny, z);
        if (nf <= 0) return ny + 0.07 * (nf / (nf - f));
        yy = ny; f = nf;
      }
      return y;
    }
    for (let n = 0; n < 240; n++) {
      const st = clamp(-f * 0.8, 0.05, 0.5);
      const ny = yy - st;
      const nf = field(x, ny, z);
      if (nf > 0) return yy - st * (f / (f - nf));
      yy = ny; f = nf;
    }
    return meshH(x, z) - 40;
  }
  // Earth above (x, y, z): the first solid going up, or y + 50 when open to the sky.
  function ceilingAbove(x, y, z) {
    const top = meshH(x, z) + 0.05;
    let yy = y, f = field(x, yy, z);
    if (f > 0) return y;
    for (let n = 0; n < 200 && yy < top; n++) {
      const st = clamp(-f * 0.8, 0.05, 0.4);
      const ny = yy + st;
      const nf = field(x, ny, z);
      if (nf > 0) return yy + st * (f / (f - nf));
      yy = ny; f = nf;
    }
    return y + 50;
  }
  // Is there earth between (x, y, z) and the sky?
  function coveredAt(x, y, z) {
    if (meshH(x, z) - y < 0.25) return false;
    if (!carvedNearY(x, y, z, 0.5)) return true;
    return ceilingAbove(x, y, z) < y + 49;
  }
  // Floor of the carved pocket in this column (the one at height y, or the first one down).
  function floorAt(x, z, y) {
    if (!carvedNear(x, z)) return null;
    if (Number.isFinite(y)) {
      if (field(x, y + 0.3, z) > 0) return null;
      return groundAt(x, y, z, 0.3);
    }
    const h = meshH(x, z);
    let yy = h - 0.3;
    for (let n = 0; n < 70; n++, yy -= 0.2) {
      if (field(x, yy, z) <= 0) return groundAt(x, yy, z, 0);
    }
    return null;
  }
  function ceilingAt(x, z, y) {
    const f = Number.isFinite(y) ? y : floorAt(x, z);
    if (f === null || f === undefined) return null;
    return ceilingAbove(x, f + 0.2, z);
  }
  // Push a standing capsule (feet at pos, radius r, height h) out of earth walls; xz only.
  const _hits = [0, 0, 0];
  function collide(pos, r = 0.3, h = 1.2) {
    if (!pos || !carvedNearY(pos.x, pos.y + h * 0.5, pos.z, 1.5)) return false;
    let hit = false;
    const lo = Math.min(0.5, h * 0.6);
    const hi = Math.max(lo, h - r);
    _hits[0] = lo; _hits[1] = (lo + hi) * 0.5; _hits[2] = hi;
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (let s = 0; s < 3; s++) {
        if (s === 1 && hi - lo < 0.3) continue;
        const cy = pos.y + _hits[s];
        const f = field(pos.x, cy, pos.z);
        if (f <= -r) continue;
        fieldGrad(pos.x, cy, pos.z, _g);
        const gh = Math.hypot(_g.x, _g.z), gl = Math.hypot(_g.x, _g.y, _g.z);
        if (gl < 1e-6 || gh < 0.35 * gl) continue;          // floor or ceiling, not a wall
        // a wall only if there is earth beside the body at this height (not just a rim below it)
        if (field(pos.x + _g.x / gh * r, cy, pos.z + _g.z / gh * r) <= 0) continue;
        const pen = Math.min((r + f) * gl / gh, r + 0.2);
        pos.x -= _g.x / gh * (pen + 1e-3);
        pos.z -= _g.z / gh * (pen + 1e-3);
        moved = hit = true;
      }
      if (!moved) break;
    }
    // props standing in rooms
    for (let i = 0; i < props.length; i++) {
      const b = props[i];
      if (pos.y + h < b.y0 || pos.y > b.y1 - 0.3) continue;
      const qx = clamp(pos.x, b.x0, b.x1), qz = clamp(pos.z, b.z0, b.z1);
      const dx = pos.x - qx, dz = pos.z - qz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x += dx / d * (r - d); pos.z += dz / d * (r - d); }
      else {
        const l = pos.x - b.x0, rr = b.x1 - pos.x, t = pos.z - b.z0, bb = b.z1 - pos.z, m = Math.min(l, rr, t, bb);
        if (m === l) pos.x = b.x0 - r; else if (m === rr) pos.x = b.x1 + r; else if (m === t) pos.z = b.z0 - r; else pos.z = b.z1 + r;
      }
      hit = true;
    }
    return hit;
  }
  // legacy: keep a position inside dug space (used by older callers)
  function constrain(pos, radius = 0.3, height = 1.2) {
    if (!pos) return pos;
    collide(pos, radius, height);
    const g = groundAt(pos.x, pos.y, pos.z, 0.45);
    if (g !== null) pos.y = g;
    return pos;
  }

  // ---------- dug cells (2 m) for the minimap, stats and the objective ----------
  const cells = new Map();
  function noteCells(cx, cy, cz, r, deep, emit) {
    const x0 = cellIndex(cx - r * 0.7), x1 = cellIndex(cx + r * 0.7);
    const z0 = cellIndex(cz - r * 0.7), z1 = cellIndex(cz + r * 0.7);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = cellKey(x, z);
      let c = cells.get(k);
      let fire = false;
      if (!c) { c = { cx: x, cz: z, deep: false, y: cy }; cells.set(k, c); fire = true; }
      if (deep && !c.deep) { c.deep = true; c.y = cy; fire = true; }
      if (fire && emit) ev.emit('tunnelDug', { cellX: x, cellZ: z, deep: c.deep, pos: new THREE.Vector3((x + 0.5) * CELL, cy, (z + 0.5) * CELL) });
    }
  }
  function isDug(cx, cz) { return cells.has(cellKey(cx, cz)); }
  function cellOf(x, z) { return { cx: cellIndex(x), cz: cellIndex(z) }; }
  function cellCenter(cx, cz) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    const c = cells.get(cellKey(cx, cz));
    const f = c ? floorAt(x, z, c.y) ?? floorAt(x, z) : null;
    return new THREE.Vector3(x, f ?? terrainH(x, z), z);
  }
  function dugCells() { return cells.values(); }

  // ---------- spoil heaps ----------
  const HEAP_MAX = 96;
  const heapGeo = (() => {
    const g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const a = Math.atan2(z, x);
      const lump = 1 + 0.1 * Math.sin(a * 5 + 1.3) + 0.07 * Math.sin(a * 9 + y * 4) + 0.05 * noise2D(x * 3, z * 3 + y * 2);
      const yy = y * (1 + 0.15 * noise2D(x * 2.1 + 7, z * 2.1)) - 0.12;
      pa.setXYZ(i, x * lump, yy, z * lump);
    }
    g.computeVertexNormals();
    return g;
  })();
  const heapMat = new THREE.MeshStandardMaterial({ map: clay.map, normalMap: clay.normalMap, color: 0xd8a088, roughness: 1 });
  heapMat.map = clay.map;
  try { ctx.world?.bakePatch?.(heapMat); } catch (e) { /* optional */ }
  const heapMesh = new THREE.InstancedMesh(heapGeo, heapMat, HEAP_MAX);
  heapMesh.name = 'spoilHeaps';
  heapMesh.count = 0;
  heapMesh.receiveShadow = true;
  heapMesh.castShadow = true;
  heapMesh.frustumCulled = false;
  surfaceGroup.add(heapMesh);
  const heaps = [];
  const mouths = [];                   // surface openings dug so far (spoil goes there)
  const _hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hs = new THREE.Vector3(), _hp = new THREE.Vector3();
  function writeHeap(hp) {
    const r = clamp(0.3 + Math.cbrt(hp.vol) * 0.5, 0.3, 1.35);
    const gone = maskAt(hp.x, hp.z) > 0.3;
    terrainNormal(hp.x, hp.z, _nrm);
    _hq.setFromUnitVectors(_ya, _nrm).multiply(new THREE.Quaternion().setFromAxisAngle(_ya, hp.rot));
    _hs.set(gone ? 0 : r, gone ? 0 : r * 0.42, gone ? 0 : r * 0.82);
    _hp.set(hp.x, meshH(hp.x, hp.z) - 0.02, hp.z);
    _hm.compose(_hp, _hq, _hs);
    heapMesh.setMatrixAt(hp.i, _hm);
    heapMesh.instanceMatrix.needsUpdate = true;
  }
  function addSpoil(x, z, vol, awayX, awayZ, rad) {
    // put the spoil beside the hole, on the side toward (awayX, awayZ)
    let dx = awayX - x, dz = awayZ - z;
    let dl = Math.hypot(dx, dz);
    if (dl < 1e-3) { dx = 1; dz = 0; dl = 1; }
    dx /= dl; dz /= dl;
    let sx = 0, sz = 0, ok = false;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const ux = dx * c - dz * s, uz = dx * s + dz * c;
      sx = x + ux * (rad + 0.9); sz = z + uz * (rad + 0.9);
      if (maskAt(sx, sz) > 0.2 || waterAt(sx, sz) || blockedAt(sx, sz, 0.3)) continue;
      ok = true; break;
    }
    if (!ok) return;
    let best = null, bd = 1.6;
    for (const hp of heaps) { const d = Math.hypot(hp.x - sx, hp.z - sz); if (d < bd) { bd = d; best = hp; } }
    if (!best && heaps.length >= HEAP_MAX) {
      bd = Infinity;
      for (const hp of heaps) { const d = Math.hypot(hp.x - sx, hp.z - sz); if (d < bd) { bd = d; best = hp; } }
    }
    if (!best) {
      best = { x: sx, z: sz, vol: 0, rot: Math.random() * Math.PI * 2, i: heaps.length };
      heaps.push(best);
      heapMesh.count = heaps.length;
    }
    best.vol += vol;
    writeHeap(best);
  }
  function refreshHeaps() { for (const hp of heaps) writeHeap(hp); }

  // ---------- aiming and strokes ----------
  const aim = {
    hit: false, valid: false, reason: '', point: new THREE.Vector3(), normal: new THREE.Vector3(),
    dir: new THREE.Vector3(), center: new THREE.Vector3(), radius: RADIUS.large, floorY: NaN,
    under: false, dist: 0, origin: new THREE.Vector3(),
  };
  let digSize = 'large';
  let aimShown = false;
  const COL_OK = new THREE.Vector4(0.93, 0.84, 0.66, 0.55);
  const COL_BAD = new THREE.Vector4(0.85, 0.16, 0.1, 0.7);
  function showCursor(on) {
    aimShown = on;
    if (!on) DIGU.uDigCursorCol.value.w = 0;
  }
  function checkSite(cx, cy, cz, r) {
    if (Math.abs(cx) > LIMIT || Math.abs(cz) > LIMIT) return 'edge';
    const fb = WORLD.firebase;
    if (Math.hypot(cx - fb.x, cz - fb.z) < fb.radius + 3) return 'firebase';
    const h = meshH(cx, cz);
    if (cy < h - 14) return 'deep';
    if (waterAt(cx, cz)) return 'water';
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, rr = r + 1.4;
      if (waterAt(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) return 'water';
    }
    const nearSurface = cy + r * FLAT > h - 1.3;
    if (nearSurface) {
      if (blockedAt(cx, cz, r * 0.6)) return 'blocked';
      for (const hh of hatches) if (Math.hypot(hh.x - cx, hh.z - cz) < r + 0.9) return 'blocked';
      for (const t of traps) if (t.armed && Math.hypot(t.x - cx, t.z - cz) < r + 0.7) return 'blocked';
    }
    if (chunks.size > MAX_CHUNKS) return 'limit';
    return '';
  }
  // Where would a stroke land? origin = eye, dir = unit view direction.
  // opts: { feetY, size }
  function aimDig(origin, dir, opts = {}) {
    aim.hit = false; aim.valid = false; aim.reason = '';
    if (!origin || !dir) { showCursor(false); return aim; }
    const t = raycast(origin, dir, REACH);
    if (t < 0) { aim.reason = 'far'; showCursor(false); return aim; }
    aim.hit = true;
    aim.dist = t;
    aim.origin.copy(origin);
    aim.dir.copy(dir);
    aim.point.copy(origin).addScaledVector(dir, t);
    fieldGrad(aim.point.x, aim.point.y, aim.point.z, aim.normal).negate();
    if (aim.normal.lengthSq() < 1e-8) aim.normal.set(0, 1, 0); else aim.normal.normalize();
    const r = RADIUS[opts.size || digSize] || RADIUS.large;
    aim.radius = r;
    aim.center.copy(aim.point).addScaledVector(dir, r * 0.42);
    // level floor when digging ahead (scoop above the feet, aim not steeply down)
    aim.floorY = NaN;
    const fy = opts.feetY;
    if (Number.isFinite(fy) && dir.y > -0.5 && aim.center.y - r * FLAT > fy - 0.1 && aim.center.y < fy + 1.9) aim.floorY = fy;
    const h = meshH(aim.center.x, aim.center.z);
    aim.under = aim.center.y < h - DEEP;
    aim.reason = checkSite(aim.center.x, aim.center.y, aim.center.z, r);
    aim.valid = !aim.reason;
    DIGU.uDigCursor.value.set(aim.point.x, aim.point.y, aim.point.z, r * 0.78);
    DIGU.uDigCursorCol.value.copy(aim.valid ? COL_OK : COL_BAD);
    showCursor(true);
    return aim;
  }
  // One shovel stroke: carve the scoop the last aimDig() (or `target`) describes.
  function digStroke(target, opts = {}) {
    const a = target || aim;
    if (!a.hit) return { ok: false, carved: 0, reason: a.reason || 'far' };
    const reason = checkSite(a.center.x, a.center.y, a.center.z, a.radius);
    if (reason) { ev.emit('digRefused', { reason }); return { ok: false, carved: 0, reason }; }
    const c = a.center, r = a.radius;
    const px = Number.isFinite(opts.playerX) ? opts.playerX : a.origin.x;
    const pz = Number.isFinite(opts.playerZ) ? opts.playerZ : a.origin.z;
    const ts = performance.now();
    const n = carveScoop(c.x, c.y, c.z, r, a.floorY, c.x, c.z);
    if (!n) return { ok: false, carved: 0, reason: 'none' };
    // did it open the ground (or come within a hand's breadth of it)?
    let lo = Infinity;
    for (let k = 0; k < 9; k++) {
      const a2 = k * 0.785, rr = k === 0 ? 0 : r;
      lo = Math.min(lo, meshH(c.x + Math.cos(a2) * rr, c.z + Math.sin(a2) * rr));
    }
    const surface = c.y + r * FLAT > lo - 0.22;
    let openR = 0;
    if (surface) {
      const Y = lo - 0.16;
      openR = Y <= c.y ? r : Math.sqrt(Math.max(0, r * r - ((Y - c.y) / FLAT) ** 2));
      stampMask(c.x, c.z, Math.max(openR, 0.2) + 0.3);
      if (mouths.length > 64) mouths.shift();
      mouths.push({ x: c.x, z: c.z });
    }
    processDirty(6, c.x, c.z);
    meshStats.stroke = performance.now() - ts;
    const h = meshH(c.x, c.z);
    const under = c.y < h - DEEP;
    noteCells(c.x, c.y, c.z, r, under, true);
    // spoil
    const vol = r * r * r * 0.35;
    if (surface) addSpoil(c.x, c.z, vol, 2 * c.x - px, 2 * c.z - pz, Math.max(openR, 0.2) + 0.3);
    else {
      let best = null, bd = 90;
      for (const m of mouths) { const d = Math.hypot(m.x - c.x, m.z - c.z); if (d < bd) { bd = d; best = m; } }
      for (const hh of hatches) { const d = Math.hypot(hh.x - c.x, hh.z - c.z); if (d < bd) { bd = d; best = hh; } }
      if (best) addSpoil(best.x, best.z, vol * 0.25, 2 * best.x - c.x + 0.01, 2 * best.z - c.z, 0.9);
    }
    const pos = new THREE.Vector3().copy(a.point);
    ev.emit('digStroke', { pos, normal: a.normal.clone(), under, surface, radius: r });
    ev.emit('noise', { pos: pos.clone(), loudness: under ? 0.07 : 0.2, source: 'player', kind: 'dig' });
    refreshHeapsNear(c.x, c.z);
    return { ok: true, carved: n, surface, under };
  }
  function refreshHeapsNear(x, z) {
    for (const hp of heaps) if (Math.abs(hp.x - x) < 3 && Math.abs(hp.z - z) < 3) writeHeap(hp);
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
    hinge.add(planks, lidLitter, lidLeaves);
    tilt.add(hole, hinge);
    root.add(skirt, skirtLeaves, tilt);
    root.updateMatrixWorld(true);
    surfaceGroup.add(root);

    // shaft dressing: bamboo ladder, the lid's underside with daylight leaking round it
    const shaft = new THREE.Group();
    shaft.name = 'hatchShaft';
    const fy = h.floorY, ty = h.topY;
    const parts = [];
    const lr = rand(hash2(h.cx, h.cz) + 17);
    for (const sx of [-0.17, 0.17]) {
      parts.push(tint(cylinderBetween(h.x + sx, fy - 0.05, h.z - 0.24, h.x + sx * 0.95, ty, h.z - 0.3, 0.026, 0.022, 6), 0.36, 0.29, 0.17, 0.2, lr));
    }
    for (let y = fy + 0.28; y < ty - 0.12; y += 0.28) {
      const t = (y - fy) / Math.max(0.1, ty - fy);
      const z = h.z - 0.24 - 0.06 * t;
      parts.push(tint(cylinderBetween(h.x - 0.2, y, z, h.x + 0.2, y + (lr() - 0.5) * 0.02, z, 0.017, 0.017, 5), 0.33, 0.26, 0.15, 0.25, lr));
    }
    const ladder = new THREE.Mesh(mergeGeometries(parts), rootMat);
    parts.forEach((p) => p.dispose());
    const under = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18).rotateX(Math.PI / 2), plankMat);
    under.position.set(h.x, ty - 0.02, h.z);
    const leak = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(Math.PI / 2), leakMat);
    leak.position.set(h.x, ty - 0.03, h.z);
    const coneLen = Math.max(0.6, ty - fy - 0.1);
    const coneGeo = new THREE.CylinderGeometry(0.3, 0.42, coneLen, 16, 1, true);
    {
      const pa = coneGeo.attributes.position, n = pa.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = clamp(pa.getY(i) / coneLen + 0.5, 0, 1);
        const k = Math.pow(t, 2.5) * 0.06;
        col[i * 3] = k * 0.92; col[i * 3 + 1] = k * 1.0; col[i * 3 + 2] = k * 0.72;
      }
      coneGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(h.x, fy + 0.05 + coneLen * 0.5, h.z);
    cone.renderOrder = 2;
    shaft.add(ladder, under, leak, cone);
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
  // Hatch at (x, z) over a carved floor at floorY: shaft up to just under the lid.
  function addHatch(x, z, floorY, announce = false) {
    const y = terrainH(x, z);
    const h = {
      x, z, cx: cellIndex(x), cz: cellIndex(z), y, floorY, topY: meshH(x, z) - 0.3, mesh: null, discovered: false,
      id: hatches.length, animT: -1, _disc: false,
    };
    carveShaft(x, floorY, z, h.topY, 0.44);
    hatches.push(h);
    buildHatchVisual(h);
    noteCells(x, floorY, z, 0.5, true, false);
    version++;
    if (announce) ev.emit('hatchCreated', { x, z });
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
  // Legacy API: a hatch over carved space below (x, z).
  function createHatch(x, z) {
    const f = floorAt(x, z);
    if (f === null || checkSite(x, f + 1, z, 0.5) || nearestHatch({ x, z }, 3)) return false;
    addHatch(x, z, f, true);
    processDirty(-1, x, z);
    return true;
  }

  // ---------- punji traps ----------
  function canPlaceTrap(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return false;
    if (waterAt(x, z) || waterAt(x + 0.5, z) || waterAt(x - 0.5, z) || waterAt(x, z + 0.5) || waterAt(x, z - 0.5)) return false;
    if (maskAt(x, z) > 0.15) return false;
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
  // One realtime PointLight follows the nearest fixed lamp; all lamps also bake light
  // into nearby dug earth.
  const lampLight = new THREE.PointLight(0xffc890, 0, 9, 1.8);
  lampLight.castShadow = false;
  group.add(lampLight);
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
    g.visible = false;
    interior.add(g);
    const l = { x, y: baseY + 0.13, z, power, group: g, flame, halo, phase: lamps.length * 2.37 + 0.5, visible: false };
    lamps.push(l);
    return l;
  }
  // a lamp on a clay ledge left standing against a wall
  function addLedgeLamp(x, fy, z, rot) {
    const LH = 0.34;
    const geo = new THREE.SphereGeometry(0.25, 12, 8);
    {
      const pa = geo.attributes.position, n = pa.count;
      for (let i = 0; i < n; i++) {
        let px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
        const wob = 1 + 0.12 * noise2D(px * 9 + x * 3, pz * 9 + z * 3) + 0.05 * noise2D(py * 14, px * 14 + z);
        py = (py + 0.25) / 0.5 * (LH + 0.14) - 0.12;
        const top = py >= LH;
        if (top) py = LH + 0.006 * noise2D(px * 30, pz * 30);
        const sh = top ? 0.82 : 1 - 0.18 * clamp((py - LH * 0.5) / LH, 0, 1);
        pa.setXYZ(i, px * wob * sh, py, pz * wob * sh * 0.85);
      }
      geo.computeVertexNormals();
    }
    geo.rotateY(rot);
    const ledge = new THREE.Mesh(geo, heapMat);
    ledge.position.set(x, fy, z);
    interior.add(ledge);
    props.push({ x0: x - 0.22, z0: z - 0.22, x1: x + 0.22, z1: z + 0.22, y0: fy, y1: fy + LH });
    const l = addLamp(x, fy + LH, z, 1.2);
    l.extra = ledge;
    return l;
  }

  function buildStorage(X0, Z0, floorY) {
    const r = rand(6868);
    const sg = new THREE.Group();
    sg.name = 'storage';
    const fl = (lx, lz) => groundAt(X0 + lx, floorY + 0.4, Z0 + lz, 0.2) ?? floorY;
    const addProp = (minx, minz, maxx, maxz, h) => props.push({ x0: minx, z0: minz, x1: maxx, z1: maxz, y0: floorY - 0.2, y1: floorY + h });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const crates = [
      [0.72, 0.42, 0.46, 0.75, 3.35, 0.05, 0],
      [0.66, 0.38, 0.42, 0.77, 3.37, -0.14, 1],
      [0.6, 0.4, 0.42, 1.5, 3.4, 0.22, 0],
      [0.56, 0.44, 0.5, 3.3, 3.3, -0.32, 0],
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
      if (!onTop) { const e = Math.max(w, d) * 0.5 + 0.04; addProp(X0 + lx - e, Z0 + lz - e, X0 + lx + e, Z0 + lz + e, h + (i === 0 ? 0.38 : 0)); }
    }
    const crateMesh = new THREE.Mesh(mergeGeometries(crateParts), crateMat);
    crateParts.forEach((p) => p.dispose());
    const sackSpots = [[2.15, 3.35, 0, 0.3], [2.62, 3.4, 0, -0.4], [2.38, 2.92, 0, 1.2], [1.98, 2.9, 0, 0.7], [2.4, 3.2, 0.22, 0.1]];
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
    addProp(X0 + 1.68, Z0 + 2.62, X0 + 2.95, Z0 + 3.68, 0.45);
    const jarPts = [[0, 0], [0.11, 0], [0.17, 0.07], [0.2, 0.19], [0.18, 0.31], [0.11, 0.4], [0.085, 0.44], [0.1, 0.47], [0.088, 0.48], [0.07, 0.46]]
      .map(([a, b]) => new THREE.Vector2(a, b));
    const jarGeo = new THREE.LatheGeometry(jarPts, 18);
    jarGeo.translate(X0 + 3.45, fl(3.45, 2.6), Z0 + 2.6);
    const jarMesh = new THREE.Mesh(jarGeo, jarMat);
    addProp(X0 + 3.23, Z0 + 2.38, X0 + 3.67, Z0 + 2.82, 0.5);
    const matGeo = new THREE.PlaneGeometry(1.7, 0.75, 10, 4);
    matGeo.rotateX(-Math.PI / 2);
    matGeo.rotateY(0.04);
    {
      const pa = matGeo.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        const wx = X0 + 1.2 + pa.getX(k), wz = Z0 + 1.2 + pa.getZ(k);
        pa.setXYZ(k, wx, (groundAt(wx, floorY + 0.4, wz, 0.2) ?? floorY) + 0.025, wz);
      }
      matGeo.computeVertexNormals();
      matGeo.computeBoundingSphere();
    }
    const matMesh = new THREE.Mesh(matGeo, weaveMat);
    sg.add(crateMesh, sackMesh, jarMesh, matMesh);
    const lt = lampTop || [X0 + 3.3, fl(3.3, 3.3) + 0.44, Z0 + 3.3];
    addLamp(lt[0], lt[1], lt[2], 1.5);
    sg.visible = false;
    interior.add(sg);
    storage = { group: sg, x: X0 + 2, z: Z0 + 2 };
  }

  // ---------- starting camp network ----------
  function buildStartNetwork() {
    const sx = cellIndex(WORLD.playerStart.x), sz = cellIndex(WORLD.playerStart.z);
    const wx = (dx) => (sx + dx + 0.5) * CELL, wz = (dz) => (sz + dz + 0.5) * CELL;
    const floors = new Map();
    const floorOf = (dx, dz, prev, height) => {
      const k = dx + ',' + dz;
      if (floors.has(k)) return floors.get(k);
      const x = wx(dx), z = wz(dz);
      let f = meshH(x, z) - DEPTH;
      if (prev !== null) f = clamp(f, prev - 0.5, prev + 0.5);
      let mn = Infinity;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) mn = Math.min(mn, meshH(x + i * 0.9, z + j * 0.9));
      f = Math.min(f, mn - height - 0.8);
      floors.set(k, f);
      return f;
    };
    const chamberRel = [[7, 3], [8, 3], [7, 4], [8, 4]];
    const isCh = (dx, dz) => chamberRel.some(([a, b]) => a === dx && b === dz);
    const paths = [
      [[2, 0], [2, 1], [2, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [10, 2]],
      [[2, 0], [2, -1], [2, -2], [1, -2], [1, -3], [0, -3], [-1, -3], [-2, -3]],
      [[2, 3], [1, 3], [0, 3], [-1, 3], [-1, 4], [-1, 5]],
    ];
    // room floor first, level
    let roomF = 0;
    for (const [a, b] of chamberRel) roomF += floorOf(a, b, null, 2.2);
    roomF /= chamberRel.length;
    for (const [a, b] of chamberRel) floors.set(a + ',' + b, roomF);
    const TW = 1.05, TH = 1.5;
    for (const path of paths) {
      let prev = null, px = 0, pz = 0;
      for (const [dx, dz] of path) {
        const f = floorOf(dx, dz, prev, isCh(dx, dz) ? 2.2 : TH);
        const x = wx(dx), z = wz(dz);
        if (prev !== null) carveTunnel(px, prev, pz, x, f, z, TW, TH);
        prev = f; px = x; pz = z;
        noteCells(x, f, z, 0.8, true, false);
      }
    }
    const rcx = (wx(7) + wx(8)) * 0.5, rcz = (wz(3) + wz(4)) * 0.5;
    carveRoom(rcx, roomF, rcz, 2.15, 2.15, 2.2, 0.06);
    for (const [a, b] of chamberRel) noteCells(wx(a), roomF, wz(b), 1, true, false);
    // hatches at the three ends
    for (const [dx, dz] of [[2, 0], [-2, -3], [-1, 5]]) {
      const f = floors.get(dx + ',' + dz);
      if (Number.isFinite(f)) addHatch(wx(dx), wz(dz), f);
    }
    buildStorage(rcx - 2.15, rcz - 2.15, roomF);
    // a niche lamp where the north branch meets the main tunnel
    {
      const f = floors.get('2,3');
      if (Number.isFinite(f)) addLedgeLamp(wx(2) + 0.42, f, wz(3) + 0.42, 0.8);
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
    const near2 = under ? 48 * 48 : 16 * 16, far2 = 170 * 170;
    for (let i = 0; i < chunkList.length; i++) {
      const ch = chunkList[i];
      if (!ch.mesh) continue;
      const dx = ch.cx - cam.x, dy = ch.cy - cam.y, dz = ch.cz - cam.z;
      const d2 = dx * dx + dy * dy * 0.5 + dz * dz;
      ch.mesh.visible = d2 < near2 || (!under && ch.surface && d2 < far2);
    }
    if (storage) {
      const dx = storage.x - cam.x, dz = storage.z - cam.z;
      storage.group.visible = dx * dx + dz * dz < (under ? 45 * 45 : 12 * 12);
    }
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const dx = l.x - cam.x, dz = l.z - cam.z;
      const vis = dx * dx + dz * dz < (under ? 45 * 45 : 10 * 10);
      l.visible = vis;
      l.group.visible = vis;
      if (l.extra) l.extra.visible = vis;
    }
    for (let i = 0; i < hatches.length; i++) {
      const h = hatches[i];
      const dx = h.x - cam.x, dz = h.z - cam.z, d2 = dx * dx + dz * dz;
      const anim = h.animT >= 0;
      if (h.mesh) h.mesh.visible = anim || (under ? d2 < 16 * 16 : d2 < 150 * 150);
      if (h.shaft) h.shaft.visible = under ? d2 < 45 * 45 : d2 < 8 * 8;
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
    heapMesh.visible = !under;
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
    if (!lamps.length) { lampLight.intensity = 0; return; }
    let best = null, bd = (under ? 30 : 8) * (under ? 30 : 8);
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

  function undergroundAt(pos) {
    const p = ctx.player;
    if (p && typeof p.underground === 'boolean') return p.underground;
    if (!pos) return false;
    return coveredAt(pos.x, pos.y, pos.z);
  }

  function update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0.016;
    time += dt;
    const cam = viewerPos();
    processDirty(4, cam.x, cam.z);
    if (maskDirty) { maskDirty = false; maskTex.needsUpdate = true; }
    if (!aimShown) DIGU.uDigCursorCol.value.w = 0;
    aimShown = false;
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
  const onTunnelMove = (d) => {
    if (d?.walk) return;
    const pos = ctx.player?.position || viewerPos();
    const h = d?.hatch || nearestHatch(pos, 3);
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
  try { buildStartNetwork(); } catch (e) { console.error('[tunnels] start network', e); }
  processDirty(-1, WORLD.playerStart.x, WORLD.playerStart.z);
  if (maskDirty) { maskDirty = false; maskTex.needsUpdate = true; }

  // Nearest point on a carved floor below the surface (debug spawn).
  function spawnPoint(x, z) {
    let best = null, bd = Infinity;
    for (const c of cells.values()) {
      if (!c.deep) continue;
      const cx = (c.cx + 0.5) * CELL, cz = (c.cz + 0.5) * CELL;
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < bd) {
        const f = floorAt(cx, cz, c.y);
        if (f !== null && ceilingAbove(cx, f + 0.2, cz) - f > 1.1) { bd = d; best = new THREE.Vector3(cx, f, cz); }
      }
    }
    return best;
  }
  // Legacy grid-era API, kept working on the new field.
  const _eyeL = new THREE.Vector3();
  function digTarget(pos, dir) {
    const eye = _eyeL.set(pos.x, pos.y + 1.0, pos.z);
    const a = aimDig(eye, dir, { feetY: pos.y });
    return { type: a.valid ? 'stroke' : null, reason: a.reason, x: a.point.x, y: a.point.y, z: a.point.z, cx: cellIndex(a.point.x), cz: cellIndex(a.point.z) };
  }
  function dig(fromPos, dir) {
    if (!fromPos || !dir) return false;
    const eye = new THREE.Vector3(fromPos.x, fromPos.y + 1.0, fromPos.z);
    const a = aimDig(eye, dir, { feetY: fromPos.y });
    return a.valid ? digStroke(a).ok : false;
  }

  return {
    group,
    hatches,
    traps,
    lamps,
    heaps,
    cellSize: CELL,
    voxelSize: VS,
    reach: REACH,
    get version() { return version; },
    get cellCount() { return cells.size; },
    get chunkCount() { return chunks.size; },
    get dataChunkCount() { return dataChunks; },
    get digSize() { return digSize; },
    set digSize(v) { if (RADIUS[v]) digSize = v; },
    digSizes: Object.keys(RADIUS),
    get aim() { return aim; },
    debugUniforms: DIGU,
    stats: meshStats,
    // field queries
    field, raycast, groundAt, ceilingAbove, coveredAt, carvedNear, collide, constrain, meshHeight: meshH,
    maskAt,
    isDug, cellOf, cellCenter, cellAt: (cx, cz) => cells.get(cellKey(cx, cz)), dugCells, spawnPoint,
    isChamber: () => false,
    isFree: (x, z) => carvedNear(x, z),
    floorAt, ceilingAt,
    // digging
    aimDig, digStroke, dig, digTarget, applyDig: dig, digChamber: () => false, createHatch,
    // hatches, traps
    nearestHatch, openHatch, placeTrap, canPlaceTrap,
    isUndergroundAt: undergroundAt,
    update,
  };
}
