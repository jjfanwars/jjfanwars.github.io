// UNDERGROWTH: enemies.
// US Army infantry (1968) built from primitives on a small bone rig (one skinned draw call
// per soldier and LOD), squad AI (patrol, suspicious, combat with cover and flanking, search),
// firebase garrison with a searchlight tower sentry, hatch grenading, punji traps and the
// UH-1 reinforcement flight after the ammo dump goes up.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, rand, clamp, lerp, smoothstep, canvasTexture, events as sharedEvents } from './util.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const MAX_ACTIVE = 40;
const HELI_TROOPS = 6;
const QUIET_TIME = 30;            // s: nothing reaches the camp before this
const QUIET_RADIUS = 150;         // m around the camp kept free during QUIET_TIME
const VISION_RANGE = 90;
const VISION_COS = Math.cos(55 * Math.PI / 180); // 110 degree cone
const RAY_BUDGET = 20;            // line-of-sight checks per frame, all enemies
const LOD_NEAR = 80;              // full detail inside this
const LOD_HIDE = 235;             // not drawn beyond this
const MAX_TOKENS = 3;             // soldiers allowed to fire hit-capable bursts at once
const CLOSE_SHOOTER_R = 8;        // one extra non-token shooter may land hits inside this
const HIT_CAP = 0.2;              // per-round hit chance ceiling (after the close-range bonus)
const HIT_GAP = 0.2;              // s between hits on the player, across all shooters...
const HIT_GAP_HEAT = 0.1;         // ...plus this per recent hit (decays ~1.2 per s)
const SPOT_HIDE_R = 160;          // searchlight spot off beyond this camera distance
const MAX_CORPSES = 14;
const SPEED = { patrol: 1.45, cautious: 1.25, walk: 1.6, jog: 2.6, run: 4.1 };

// rig proportions
const UA = 0.31, FA = 0.27, TH = 0.43, SH = 0.43;

// ---------------------------------------------------------------------------
// Scratch (no allocations in the frame loop)
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const _s1 = new THREE.Vector3();
const V_DOWN = new THREE.Vector3(0, -1, 0);
const V_UP = new THREE.Vector3(0, 1, 0);
const V_Z = new THREE.Vector3(0, 0, 1);
const V_X = new THREE.Vector3(1, 0, 0);
const IDENTITY = new THREE.Matrix4();

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const yawTo = (dx, dz) => Math.atan2(dx, dz);
const rnd = (a, b) => a + (b - a) * Math.random();
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
function turnToward(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  return wrapAngle(cur + clamp(d, -maxStep, maxStep));
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------
// Texture atlas, 512 x 1024. Top half: 4 x 4 tiles of 128 px (fatigues, Mitchell camo
// cover, webbing, skin, rolled sleeve, sleeve creases, boots, rifle finish, canvas, radio).
// Bottom half: 256 px tiles for the three faces and the sweat-stained jacket body.
// ---------------------------------------------------------------------------

const ATLAS_W = 512, ATLAS_H = 1024, TILE = 128, BIG_TILE = 256, PAD = 3;
const T = {
  CLOTH: 0, TROUSER: 1, CAMO: 2, WEB: 3, SKIN0: 4, SKIN1: 5, SKIN2: 6,
  SLEEVE: 7, ARM: 8, BOOT: 10, METAL: 11, PACK: 12, BAND: 13, RADIO: 14, LIGHT: 15,
  FACE0: 100, FACE1: 101, FACE2: 102, TORSO: 103,
};
const BIG = [[0, 512], [256, 512], [0, 768], [256, 768]];
function tileRect(t) {
  if (t >= 100) { const b = BIG[t - 100]; return [b[0], b[1], BIG_TILE]; }
  return [(t % 4) * TILE, ((t / 4) | 0) * TILE, TILE];
}
// [base, shade, hair, eye]
const SKINS = [
  ['#c49274', '#94664c', '#3b2619', '#4d5b66'],
  ['#9a6847', '#6c452e', '#24170e', '#3a2716'],
  ['#5d3c29', '#3d271a', '#140c07', '#1c120a'],
];

// Head uv: the face (within HEAD_A0 radians of straight ahead) gets most of the tile, so
// features painted in unit-sphere coordinates land on the shapes the head geometry gives them.
const HEAD_A0 = 0.95, HEAD_U0 = 0.34;
function headU(a) {
  const m = Math.abs(a), s = a < 0 ? -1 : 1;
  const k = m < HEAD_A0 ? (m / HEAD_A0) * HEAD_U0 : HEAD_U0 + ((m - HEAD_A0) / (Math.PI - HEAD_A0)) * (0.5 - HEAD_U0);
  return 0.5 + s * k;
}
function headV(y) { return 0.5 + Math.asin(clamp(y, -1, 1)) / Math.PI; }
// facial landmarks on the unit head sphere (x right of the face, y up, +z forward)
const FACE = { eyeX: 0.335, eyeY: 0.035, browY: 0.165, noseTop: 0.11, noseTip: -0.25, mouthY: -0.48, chinY: -0.76 };

function buildAtlas() {
  return canvasTexture(ATLAS_W, ATLAS_H, (g) => {
    const r = rand(19680131);
    const R = (a, b) => a + (b - a) * r();
    let S = TILE;
    const tile = (i, fn) => {
      const [ox, oy, size] = tileRect(i);
      S = size;
      g.save();
      g.beginPath(); g.rect(ox, oy, S, S); g.clip();
      g.translate(ox, oy);
      fn();
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    };
    const fill = (c) => { g.globalAlpha = 1; g.fillStyle = c; g.fillRect(0, 0, S, S); };
    const speck = (n, cols, a0, a1, s0 = 1, s1 = 2, y0 = 0, y1 = S) => {
      for (let i = 0; i < n; i++) {
        g.globalAlpha = R(a0, a1);
        g.fillStyle = cols[(r() * cols.length) | 0];
        const s = R(s0, s1);
        g.fillRect(r() * S, R(y0, y1), s, s);
      }
      g.globalAlpha = 1;
    };
    const blob = (x, y, rad, col, a) => {
      if (rad <= 0.5) return;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    const weave = (dark, light, a = 0.07) => {
      g.globalAlpha = a; g.fillStyle = dark;
      for (let y = 0; y < S; y += 2) g.fillRect(0, y, S, 1);
      g.globalAlpha = a * 0.7; g.fillStyle = light;
      for (let x = 0; x < S; x += 3) g.fillRect(x, 0, 1, S);
      g.globalAlpha = 1;
    };
    // a fabric fold: soft dark trough with a lit ridge just below it
    const crease = (y, amp, lw, a, dark, light, x0 = 0, x1 = S, slope = 0) => {
      const c1 = R(-amp, amp), c2 = R(-amp, amp), e = slope + R(-amp, amp) * 0.4;
      const w = x1 - x0;
      g.lineCap = 'round';
      g.strokeStyle = rgba(dark, a); g.lineWidth = lw;
      g.beginPath(); g.moveTo(x0, y); g.bezierCurveTo(x0 + w * 0.33, y + c1, x0 + w * 0.66, y + c2, x1, y + e); g.stroke();
      g.strokeStyle = rgba(dark, a * 0.45); g.lineWidth = lw * 2.2;
      g.beginPath(); g.moveTo(x0, y - lw * 0.6); g.bezierCurveTo(x0 + w * 0.33, y + c1 - lw * 0.6, x0 + w * 0.66, y + c2 - lw * 0.6, x1, y + e - lw * 0.6); g.stroke();
      g.strokeStyle = rgba(light, a * 0.7); g.lineWidth = lw * 0.7;
      g.beginPath(); g.moveTo(x0, y + lw * 1.1); g.bezierCurveTo(x0 + w * 0.33, y + c1 + lw * 1.1, x0 + w * 0.66, y + c2 + lw * 1.1, x1, y + e + lw * 1.1); g.stroke();
    };
    const cloth = (base, dark, light) => {
      const k = S / TILE;
      fill(base);
      speck(900 * k * k, [dark, light], 0.05, 0.2, 1, 2);
      weave(dark, light);
      for (let i = 0; i < 7; i++) blob(R(0, S), R(0, S), R(10, 30) * k, dark, R(0.1, 0.24));
      for (let i = 0; i < 5; i++) blob(R(0, S), R(0, S), R(8, 22) * k, light, R(0.05, 0.12));
      // seams
      g.globalAlpha = 0.25; g.fillStyle = dark;
      g.fillRect(0, R(0.08, 0.23) * S | 0, S, 1); g.fillRect(R(0.47, 0.78) * S | 0, 0, 1, S);
      g.globalAlpha = 1;
    };
    const OG = ['#5a6141', '#394029', '#7d8559'];

    // OG-107 tropical combat uniform, sun-faded, with soft folds
    tile(T.CLOTH, () => {
      cloth(...OG);
      for (let i = 0; i < 6; i++) crease(R(8, S - 8), 5, R(1.6, 2.6), R(0.14, 0.22), OG[1], OG[2], R(-10, 30), R(S - 30, S + 10), R(-8, 8));
    });
    // trousers: a touch darker, knee and hip creases, laterite mud working up from the boots
    tile(T.TROUSER, () => {
      cloth('#525a3a', '#353b24', '#737a51');
      for (let i = 0; i < 4; i++) crease(R(4, S * 0.22), 4, R(1.6, 2.4), R(0.16, 0.24), '#30361f', '#788056');
      for (let i = 0; i < 4; i++) crease(R(S * 0.78, S - 4), 4, R(1.6, 2.4), R(0.16, 0.24), '#30361f', '#788056');
      const gr = g.createLinearGradient(0, S, 0, S * 0.45);
      gr.addColorStop(0, 'rgba(98,58,34,0.6)');
      gr.addColorStop(1, 'rgba(98,58,34,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      speck(260, ['#6a3f24', '#4e301c', '#7a4a2a'], 0.25, 0.6, 1, 4, S * 0.6, S);
    });
    // Mitchell leaf pattern helmet cover, green side
    tile(T.CAMO, () => {
      fill('#7b8452');
      speck(500, ['#5d673a', '#959c6a'], 0.1, 0.3, 1, 2);
      const cols = ['#4a5a2d', '#3a4323', '#6a5233', '#5b6a35', '#2f3520'];
      for (let c = 0; c < 26; c++) {
        const cx = R(-8, S + 8), cy = R(-8, S + 8);
        const col = cols[(r() * cols.length) | 0];
        const n = 3 + ((r() * 5) | 0);
        g.fillStyle = col;
        for (let k = 0; k < n; k++) {
          g.save();
          g.translate(cx + R(-9, 9), cy + R(-9, 9));
          g.rotate(R(0, TAU));
          g.globalAlpha = R(0.75, 1);
          g.beginPath(); g.ellipse(0, 0, R(3, 10), R(1.6, 4), 0, 0, TAU); g.fill();
          g.restore();
        }
      }
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = 0.5; g.fillStyle = '#a8a87a';
        g.beginPath(); g.ellipse(R(0, S), R(0, S), R(1, 2.5), R(0.6, 1.2), R(0, TAU), 0, TAU); g.fill();
      }
      weave('#2f3520', '#a6ab7c', 0.05);
    });
    // M1956 webbing, olive drab canvas
    tile(T.WEB, () => {
      fill('#615d3e');
      speck(700, ['#45422b', '#7c7752'], 0.08, 0.25);
      g.globalAlpha = 0.12; g.fillStyle = '#3b3824';
      for (let x = 0; x < S; x += 2) g.fillRect(x, 0, 1, S);
      g.globalAlpha = 0.35;
      for (let x = 4; x < S; x += 22) g.fillRect(x, 0, 1, S);
      g.globalAlpha = 1;
      for (let i = 0; i < 5; i++) blob(R(0, S), R(0, S), R(8, 20), '#2e2b1c', 0.18);
    });
    // skin tones (neck, hands, forearms, ears)
    for (let s = 0; s < 3; s++) {
      tile(T.SKIN0 + s, () => {
        const [base, shade] = SKINS[s];
        fill(base);
        speck(500, [shade, '#e6c2a0'], 0.03, 0.09);
        for (let i = 0; i < 6; i++) blob(R(0, S), R(0, S), R(10, 26), shade, 0.15);
        for (let i = 0; i < 3; i++) blob(R(0, S), R(0, S), R(6, 14), '#3a2a1a', 0.1);
        // sweat-dark grime in the creases
        for (let i = 0; i < 4; i++) crease(R(10, S - 10), 3, 1.2, 0.1, shade, '#e6c2a0');
      });
    }
    // rolled sleeve: the paler inside of the cloth, folded twice
    tile(T.SLEEVE, () => {
      fill('#727957');
      speck(700, ['#4c5338', '#8f9672'], 0.06, 0.2);
      weave('#454c32', '#959b76', 0.06);
      const bands = 3;
      for (let b = 0; b < bands; b++) {
        const y0 = (b / bands) * S, h = S / bands;
        const gr = g.createLinearGradient(0, y0, 0, y0 + h);
        gr.addColorStop(0, 'rgba(160,166,128,0.28)');
        gr.addColorStop(0.45, 'rgba(0,0,0,0)');
        gr.addColorStop(0.85, 'rgba(30,34,20,0.32)');
        gr.addColorStop(1, 'rgba(22,25,14,0.55)');
        g.fillStyle = gr; g.fillRect(0, y0, S, h);
        for (let i = 0; i < 5; i++) {
          const x = R(0, S);
          g.strokeStyle = 'rgba(40,44,26,0.25)'; g.lineWidth = R(1, 2);
          g.beginPath(); g.moveTo(x, y0 + h * 0.15); g.lineTo(x + R(-6, 6), y0 + h * 0.9); g.stroke();
        }
      }
      for (let i = 0; i < 4; i++) blob(R(0, S), R(0, S), R(8, 18), '#3a3f27', 0.15);
    });
    // jacket sleeve: elbow creases at both ends (upper arm bottom, forearm top), a few twists
    tile(T.ARM, () => {
      cloth(...OG);
      for (let i = 0; i < 5; i++) crease(R(3, S * 0.24), 5, R(1.8, 2.8), R(0.18, 0.28), '#323922', OG[2], R(-20, 10), R(S - 10, S + 20), R(-10, 10));
      for (let i = 0; i < 5; i++) crease(R(S * 0.76, S - 3), 5, R(1.8, 2.8), R(0.18, 0.28), '#323922', OG[2], R(-20, 10), R(S - 10, S + 20), R(-10, 10));
      for (let i = 0; i < 3; i++) crease(R(S * 0.35, S * 0.65), 8, R(1.4, 2), R(0.1, 0.16), '#323922', OG[2], R(-10, 40), R(S - 40, S + 10), R(-24, 24));
      blob(S * 0.5, S * 0.5, S * 0.4, '#2c3320', 0.12);
    });
    // jacket body: folds from the armpits, blousing at the belt and a big sweat stain on
    // chest and back (box faces all sample the whole tile)
    tile(T.TORSO, () => {
      cloth(...OG);
      for (const sd of [0, 1]) {
        for (let i = 0; i < 4; i++) {
          const y = R(S * 0.06, S * 0.3);
          const x0 = sd ? S + 10 : -10, x1 = sd ? R(S * 0.45, S * 0.7) : R(S * 0.3, S * 0.55);
          crease(y, 6, R(2.2, 3.4), R(0.12, 0.2), '#323922', OG[2], Math.min(x0, x1), Math.max(x0, x1), (sd ? -1 : 1) * R(10, 30));
        }
      }
      for (let i = 0; i < 6; i++) crease(R(S * 0.8, S - 4), 6, R(2.4, 3.6), R(0.18, 0.28), '#30371f', OG[2], R(-20, 20), R(S - 20, S + 20), R(-6, 6));
      // side seams
      g.globalAlpha = 0.3; g.fillStyle = '#2d3320';
      g.fillRect(5, 0, 2, S); g.fillRect(S - 7, 0, 2, S);
      g.globalAlpha = 1;
      // sweat: soaked core, ragged edge, a faint dried-salt rim
      const cx = S * 0.5, cy = S * 0.44;
      for (let i = 0; i < 22; i++) {
        const a = R(0, TAU), d = R(0, 0.24) * S;
        blob(cx + Math.cos(a) * d * 1.1, cy + Math.sin(a) * d * 0.9, R(0.07, 0.16) * S, '#232a17', R(0.12, 0.22));
      }
      blob(cx, cy, S * 0.27, '#1c2213', 0.36);
      blob(cx, cy - S * 0.05, S * 0.12, '#161b0f', 0.22);
      g.lineWidth = 3.2; g.strokeStyle = 'rgba(160,162,128,0.08)';
      g.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        const rr = S * (0.31 + 0.035 * Math.sin(a * 3 + 1.3) + 0.025 * Math.sin(a * 7 + 0.4) + 0.012 * Math.sin(a * 13));
        const x = cx + Math.cos(a) * rr * 1.08, y = cy + Math.sin(a) * rr * 0.92;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
      // armpit stains reach the side faces
      for (const x of [0, S]) for (let i = 0; i < 5; i++) blob(x + R(-8, 8), S * R(0.15, 0.4), R(0.08, 0.14) * S, '#232a17', 0.16);
    });

    // faces (256 px): landmarks placed with headU/headV so they sit on the sculpted head
    for (let s = 0; s < 3; s++) {
      tile(T.FACE0 + s, () => {
        const [base, shade, hair, eye] = SKINS[s];
        const span = S - 2 * PAD;
        const fp = (x, y, out) => {
          const z = Math.sqrt(Math.max(1e-4, 1 - x * x - y * y));
          out[0] = PAD + headU(Math.atan2(x, z)) * span;
          out[1] = PAD + (1 - headV(y)) * span;
          return out;
        };
        const U = (u) => PAD + u * span, V = (v) => PAD + (1 - v) * span;
        const sx = (HEAD_U0 / HEAD_A0) * span, sy = span / Math.PI; // px per unit near the face centre
        const q = [0, 0], q2 = [0, 0];
        fill(base);
        speck(2600, [shade, '#e6c2a0'], 0.03, 0.08, 1, 2);
        for (let i = 0; i < 8; i++) blob(R(0, S), R(0, S), R(20, 50), shade, 0.12);
        // short "high and tight" hair: dark crown and back, stubbly sides
        g.globalAlpha = 0.55; g.fillStyle = hair;
        g.fillRect(0, V(0.98), U(0.5 - 0.28), V(headV(-0.32)) - V(0.98));
        g.fillRect(U(0.5 + 0.28), V(0.98), S, V(headV(-0.32)) - V(0.98));
        g.fillRect(0, 0, S, V(headV(0.55)));
        g.globalAlpha = 1;
        for (let i = 0; i < 1400; i++) {
          const u = r() < 0.5 ? R(0, 0.24) : R(0.76, 1);
          g.globalAlpha = R(0.15, 0.4); g.fillStyle = hair;
          g.fillRect(U(u), V(R(headV(-0.3), 0.95)), 1, R(1, 2.5));
        }
        g.globalAlpha = 1;
        // sideburns
        for (const sd of [-1, 1]) {
          const u = headU(sd * 1.12);
          for (let i = 0; i < 4; i++) blob(U(u), V(headV(0.1 - i * 0.07)), 0.06 * sx, hair, 0.3);
        }
        // cheeks, nose tip and ears a little warmer
        for (const sd of [-1, 1]) { fp(sd * 0.47, -0.2, q); blob(q[0], q[1], 0.2 * sx, '#c0705a', 0.13); }
        fp(0, FACE.noseTip, q); blob(q[0], q[1], 0.12 * sx, '#c27a62', 0.15);
        // stubble / five o'clock shadow over jaw, chin and upper lip
        fp(0, -0.62, q); blob(q[0], q[1], 0.75 * sx, shade, 0.28);
        for (let i = 0; i < 2600; i++) {
          // sampled in (angle, height) so the density stays even out to the jaw line
          const a = R(-1.35, 1.35), y = R(-0.98, -0.34);
          const x = Math.sin(a) * Math.sqrt(Math.max(0, 1 - y * y));
          if (Math.abs(y - FACE.mouthY) < 0.05 && Math.abs(x) < 0.17) continue;
          if (y > -0.4 && Math.abs(x) > 0.35) continue;
          const fade = 1 - smoothstep(1.0, 1.35, Math.abs(a));
          g.globalAlpha = R(0.06, 0.2) * fade; g.fillStyle = hair;
          g.fillRect(U(headU(a)), V(headV(y)), 1, 1);
        }
        g.globalAlpha = 1;
        // eye sockets
        for (const sd of [-1, 1]) {
          fp(sd * FACE.eyeX, FACE.eyeY + 0.01, q);
          blob(q[0], q[1], 0.17 * sx, shade, 0.5);
          blob(q[0] - sd * 0.06 * sx, q[1] + 0.02 * sy, 0.1 * sx, '#000000', 0.18);
        }
        // shadow under the helmet rim: forehead and brows in shade
        {
          const y0 = V(headV(0.42)), y1 = V(headV(-0.02));
          const gr = g.createLinearGradient(0, y0, 0, y1);
          gr.addColorStop(0, 'rgba(14,9,6,0.72)');
          gr.addColorStop(0.55, 'rgba(14,9,6,0.38)');
          gr.addColorStop(1, 'rgba(14,9,6,0)');
          g.fillStyle = gr; g.fillRect(0, y0, S, y1 - y0);
          g.fillStyle = 'rgba(14,9,6,0.72)'; g.fillRect(0, 0, S, y0);
        }
        // eyes
        for (const sd of [-1, 1]) {
          fp(sd * FACE.eyeX, FACE.eyeY, q);
          const ew = 0.11 * sx, eh = 0.042 * sy;
          g.fillStyle = 'rgba(214,198,178,0.62)';
          g.beginPath(); g.ellipse(q[0], q[1], ew, eh, 0, 0, TAU); g.fill();
          g.fillStyle = eye;
          g.beginPath(); g.arc(q[0] - sd * 0.012 * sx, q[1] + 0.2, eh * 1.05, 0, TAU); g.fill();
          g.fillStyle = '#060403';
          g.beginPath(); g.arc(q[0] - sd * 0.012 * sx, q[1] + 0.2, eh * 0.5, 0, TAU); g.fill();
          // lids and lashes
          g.strokeStyle = rgba('#140c08', 0.85); g.lineWidth = 1.6; g.lineCap = 'round';
          g.beginPath(); g.ellipse(q[0], q[1] + eh * 0.35, ew * 1.05, eh * 1.4, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
          g.strokeStyle = rgba(shade, 0.6); g.lineWidth = 1;
          g.beginPath(); g.ellipse(q[0], q[1] - eh * 0.2, ew * 0.95, eh * 1.25, 0, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
          // bag under the eye
          blob(q[0], q[1] + eh * 2.6, ew * 0.9, shade, 0.22);
        }
        // brows
        for (const sd of [-1, 1]) {
          g.strokeStyle = rgba(hair, 0.9); g.lineWidth = 0.034 * sy * 1.6; g.lineCap = 'round';
          fp(sd * 0.12, FACE.browY - 0.01, q); fp(sd * 0.5, FACE.browY - 0.025, q2);
          const mx = (q[0] + q2[0]) / 2, my = Math.min(q[1], q2[1]) - 0.035 * sy;
          g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(mx, my, q2[0], q2[1]); g.stroke();
          for (let i = 0; i < 26; i++) {
            const t = r();
            const x = (1 - t) * (1 - t) * q[0] + 2 * (1 - t) * t * mx + t * t * q2[0];
            const y = (1 - t) * (1 - t) * q[1] + 2 * (1 - t) * t * my + t * t * q2[1];
            g.strokeStyle = rgba(hair, R(0.4, 0.8)); g.lineWidth = 0.8;
            g.beginPath(); g.moveTo(x, y + R(-1.5, 1.5)); g.lineTo(x + sd * R(1.5, 3.5), y + R(-2.5, -0.5)); g.stroke();
          }
        }
        // nose: lit bridge, shaded flanks, nostrils, cast shadow under the tip
        fp(0, FACE.noseTop - 0.05, q); fp(0, FACE.noseTip + 0.02, q2);
        g.strokeStyle = 'rgba(236,196,164,0.22)'; g.lineWidth = 0.05 * sx;
        g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q2[0], q2[1]); g.stroke();
        for (const sd of [-1, 1]) {
          fp(sd * 0.1, FACE.noseTop - 0.04, q); fp(sd * 0.115, FACE.noseTip + 0.03, q2);
          g.strokeStyle = rgba(shade, 0.3); g.lineWidth = 0.06 * sx;
          g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q2[0], q2[1]); g.stroke();
          fp(sd * 0.068, FACE.noseTip - 0.05, q);
          g.fillStyle = rgba('#1a0e09', 0.75);
          g.beginPath(); g.ellipse(q[0], q[1], 0.03 * sx, 0.018 * sy, sd * 0.4, 0, TAU); g.fill();
          blob(q[0] + sd * 0.04 * sx, q[1] - 0.01 * sy, 0.06 * sx, shade, 0.3);
          // smile lines
          fp(sd * 0.15, -0.24, q); fp(sd * 0.25, -0.52, q2);
          g.strokeStyle = rgba(shade, 0.3); g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(q2[0] + sd * 0.02 * sx, (q[1] + q2[1]) / 2, q2[0], q2[1]); g.stroke();
        }
        fp(0, FACE.noseTip - 0.09, q); blob(q[0], q[1], 0.1 * sx, '#1a0e09', 0.22);
        // mouth
        fp(-0.18, FACE.mouthY + 0.005, q); fp(0.18, FACE.mouthY + 0.005, q2);
        const mcx = (q[0] + q2[0]) / 2, mcy = (q[1] + q2[1]) / 2;
        g.fillStyle = rgba('#8a4a3a', 0.4);
        g.beginPath(); g.ellipse(mcx, mcy - 0.025 * sy, 0.16 * sx, 0.03 * sy, 0, 0, TAU); g.fill();
        g.fillStyle = rgba('#a05c48', 0.32);
        g.beginPath(); g.ellipse(mcx, mcy + 0.035 * sy, 0.13 * sx, 0.035 * sy, 0, 0, TAU); g.fill();
        g.strokeStyle = rgba('#2a130c', 0.8); g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(mcx, mcy + 0.02 * sy, q2[0], q2[1]); g.stroke();
        blob(mcx, mcy + 0.09 * sy, 0.12 * sx, '#1a0e09', 0.2);
        // chin highlight, dark under the jaw
        fp(0, FACE.chinY + 0.04, q); blob(q[0], q[1], 0.12 * sx, '#e0b090', 0.1);
        {
          const y0 = V(headV(-0.8)), y1 = V(headV(-1));
          const gr = g.createLinearGradient(0, y0, 0, y1);
          gr.addColorStop(0, 'rgba(12,8,5,0)'); gr.addColorStop(1, 'rgba(12,8,5,0.55)');
          g.fillStyle = gr; g.fillRect(0, y0, S, S - y0);
        }
        // grime and sweat streaks
        for (let i = 0; i < 7; i++) blob(R(0, S), R(S * 0.3, S), R(8, 22), '#3a2a1a', R(0.05, 0.1));
        for (let i = 0; i < 5; i++) {
          fp(R(-0.7, 0.7), R(0.05, 0.25), q);
          g.strokeStyle = rgba(shade, 0.12); g.lineWidth = R(1, 2);
          g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] + R(-3, 3), q[1] + R(12, 30)); g.stroke();
        }
      });
    }
    // jungle boots: black leather
    tile(T.BOOT, () => {
      fill('#1c1b18');
      speck(600, ['#2c2a25', '#0e0d0b', '#4a3a2a'], 0.15, 0.4);
      for (let i = 0; i < 5; i++) blob(R(0, S), R(0, S), R(6, 18), '#5a3a24', 0.25);
      for (let i = 0; i < 6; i++) blob(R(0, S), R(0, S), R(4, 10), '#5c5a52', 0.12);
    });
    // rifle: matte black furniture, parkerized steel
    tile(T.METAL, () => {
      fill('#232422');
      speck(800, ['#2f302d', '#171816', '#3b3b36'], 0.2, 0.5);
      g.globalAlpha = 0.18; g.fillStyle = '#5a5a52';
      for (let i = 0; i < 10; i++) g.fillRect(R(0, S), R(0, S), R(10, 40), 1);
      g.globalAlpha = 1;
    });
    // rucksack canvas
    tile(T.PACK, () => {
      cloth('#5b5a3a', '#3b3a25', '#79775a');
      g.globalAlpha = 0.35; g.fillStyle = '#2f2e1d';
      g.fillRect(20, 0, 3, S); g.fillRect(100, 0, 3, S); g.fillRect(0, 70, S, 2);
      g.globalAlpha = 1;
    });
    // elastic helmet band, liner, dark details
    tile(T.BAND, () => {
      fill('#1d1e18');
      g.globalAlpha = 0.3; g.fillStyle = '#34352c';
      for (let y = 0; y < S; y += 3) g.fillRect(0, y, S, 1);
      g.globalAlpha = 1;
      speck(300, ['#2c2d24', '#101109'], 0.2, 0.5);
    });
    // AN/PRC-25
    tile(T.RADIO, () => {
      fill('#4d5337');
      speck(500, ['#3a3f28', '#5f6646'], 0.1, 0.3);
      g.strokeStyle = 'rgba(30,32,20,0.7)'; g.lineWidth = 2;
      g.strokeRect(10, 10, 108, 108); g.strokeRect(24, 22, 40, 26);
      g.fillStyle = '#1a1c12';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(80 + (i % 2) * 18, 30 + ((i / 2) | 0) * 18, 4, 0, TAU); g.fill(); }
    });
    // light olive drab plastic (insect repellent bottle, cigarette pack)
    tile(T.LIGHT, () => {
      fill('#b9b28e');
      speck(300, ['#8f896a', '#d6d0ad'], 0.1, 0.3);
      g.fillStyle = 'rgba(60,60,40,0.5)'; g.fillRect(30, 40, 68, 10); g.fillRect(30, 60, 50, 6);
    });
  }, { srgb: true, repeat: false });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function X(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m1.compose(_v1.set(x, y, z), _q1.setFromEuler(_e1.set(rx, ry, rz)), _s1.set(sx, sy, sz));
  geo.applyMatrix4(_m1);
  return geo;
}
function XM(geo, m) { geo.applyMatrix4(m); return geo; }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r, ws = 10, hs = 8, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, tl);

function taperBox(w, h, d, topX = 1, topZ = 1) {
  const g = box(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * topX); p.setZ(i, p.getZ(i) * topZ); }
  g.computeVertexNormals();
  return g;
}
function taperBoxZ(w, h, d, frontX = 1, frontY = 1) {
  const g = box(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) { p.setX(i, p.getX(i) * frontX); p.setY(i, p.getY(i) * frontY); }
  g.computeVertexNormals();
  return g;
}
// Tapered box with rounded vertical edges (superellipse cross-section) and smooth side
// normals, so a torso reads as a body under cloth rather than a crate.
function roundBox(w, h, d, topX = 1, topZ = 1, p = 4) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 1, 3);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const hw = w / 2, hd = d / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = x / hw, nz = z / hd;
    const ax = Math.abs(nx), az = Math.abs(nz);
    const se = Math.pow(Math.pow(ax, p) + Math.pow(az, p), 1 / p);
    const f = se > 1e-6 ? Math.max(ax, az) / se : 1;
    const k = y / h + 0.5;
    const sx = lerp(1, topX, k), sz = lerp(1, topZ, k);
    pos.setXYZ(i, x * f * sx, y, z * f * sz);
    if (Math.abs(nrm.getY(i)) < 0.5) {
      const gx = Math.sign(nx) * Math.pow(ax, p - 1) / (hw * sx), gz = Math.sign(nz) * Math.pow(az, p - 1) / (hd * sz);
      const l = Math.hypot(gx, gz) || 1;
      nrm.setXYZ(i, gx / l, 0, gz / l);
    }
  }
  return g;
}

const gauss = (d, s) => Math.exp(-(d * d) / (s * s));
// Sculpted head on the unit sphere (x across, y up, +z forward): brow ridge, eye sockets,
// nose, cheekbones, mouth, chin and a jaw that narrows into the neck. uv comes from
// headU/headV so the painted face sits on the shapes. Returns the geometry and a per-vertex
// occlusion term for the vertex colours (sockets, under the helmet rim, nose, jaw).
function buildHead(near) {
  const g = new THREE.SphereGeometry(1, near ? 40 : 12, near ? 24 : 8, -Math.PI / 2, TAU, 0, Math.PI);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const x0 = x, y0 = y;
    uv.setXY(i, headU(Math.atan2(x, z)), headV(y));
    const ax = Math.abs(x);
    const front = smoothstep(0.25, 0.75, z);
    const sock = Math.exp(-(((ax - FACE.eyeX) / 0.14) ** 2 + ((y - FACE.eyeY) / 0.09) ** 2)) * front;
    let rr = 1;
    if (near) {
      rr += 0.06 * gauss(y - FACE.browY, 0.07) * front * (1 - smoothstep(0.45, 0.72, ax));
      rr -= 0.055 * sock;
      const nb = clamp((FACE.noseTop - y) / (FACE.noseTop - FACE.noseTip), 0, 1);
      const nose = (0.045 + 0.15 * nb * nb) * smoothstep(FACE.noseTop + 0.05, FACE.noseTop - 0.03, y)
        * (1 - smoothstep(FACE.noseTip - 0.02, FACE.noseTip - 0.1, y));
      rr += nose * gauss(x, 0.085 + 0.06 * nb) * front;
      rr += 0.035 * Math.exp(-(((ax - 0.5) / 0.17) ** 2 + ((y + 0.12) / 0.12) ** 2)) * front;
      rr += 0.03 * Math.exp(-((x / 0.32) ** 2 + ((y - FACE.mouthY) / 0.16) ** 2)) * front;
      rr += 0.018 * gauss(x, 0.16) * gauss(y - FACE.mouthY + 0.045, 0.03) * front;
      rr -= 0.012 * gauss(x, 0.2) * gauss(y - FACE.mouthY, 0.02) * front;
      rr += 0.05 * Math.exp(-((x / 0.2) ** 2 + ((y - FACE.chinY) / 0.11) ** 2)) * front;
      rr += 0.04 * smoothstep(-0.1, -0.7, z) * gauss(y - 0.1, 0.45);
    }
    x *= rr; y *= rr; z *= rr;
    x *= 1 - 0.2 * smoothstep(-0.12, -0.9, y0);
    if (z < 0) z *= 1 - 0.25 * smoothstep(-0.2, -0.85, y0);
    pos.setXYZ(i, x, y, z);
    let o = 1 - 0.38 * sock;
    o *= 1 - 0.32 * smoothstep(-0.02, 0.28, y0) * smoothstep(-0.3, 0.4, z);
    o *= 1 - 0.3 * gauss(x0, 0.12) * gauss(y0 - (FACE.noseTip - 0.08), 0.06) * front;
    o *= 1 - 0.2 * gauss(x0, 0.18) * gauss(y0 - FACE.mouthY + 0.1, 0.05) * front;
    o *= 1 - 0.4 * smoothstep(-0.7, -0.98, y0);
    ao[i] = o;
  }
  g.computeVertexNormals();
  return { geo: g, ao };
}

function flipGeo(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
function tubeBetween(ax, ay, az, bx, by, bz, r, seg = 6) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = cyl(r, r, len, seg);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V_UP, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// Normalise a primitive for merging: atlas uv remap, tint * fake AO in vertex colour,
// optional rigid skin binding to one bone.
function prep(geo, tile, tint, bone) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  if (tile >= 0 && geo.attributes.uv) {
    const uv = geo.attributes.uv;
    const [tx, ty, ts] = tileRect(tile);
    const span = ts - 2 * PAD;
    for (let i = 0; i < n; i++) {
      const u = clamp(uv.getX(i), 0, 1), v = clamp(uv.getY(i), 0, 1);
      uv.setXY(i, (tx + PAD + u * span) / ATLAS_W, 1 - (ty + PAD + (1 - v) * span) / ATLAS_H);
    }
  }
  const tr = Array.isArray(tint) ? tint[0] : tint;
  const tg = Array.isArray(tint) ? tint[1] : tint;
  const tb = Array.isArray(tint) ? tint[2] : tint;
  const col = new Float32Array(n * 3);
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const ao = 0.78 + 0.22 * (nrm.getY(i) * 0.5 + 0.5);
    col[i * 3] = tr * ao; col[i * 3 + 1] = tg * ao; col[i * 3 + 2] = tb * ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (bone >= 0) {
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  return geo;
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const BN = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'rifle'];
const B = Object.fromEntries(BN.map((n, i) => [n, i]));
const BONE_PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13, 1, 15, 16, 3];
const BONE_ABS = [
  [0, 0, 0], [0, 0.98, 0], [0, 1.08, 0], [0, 1.28, 0], [0, 1.47, 0], [0, 1.55, 0.01],
  [0.19, 1.43, -0.01], [0.19, 1.43 - UA, -0.01], [0.19, 1.43 - UA - FA, -0.01],
  [-0.19, 1.43, -0.01], [-0.19, 1.43 - UA, -0.01], [-0.19, 1.43 - UA - FA, -0.01],
  [0.1, 0.92, 0], [0.1, 0.92 - TH, 0], [0.1, 0.92 - TH - SH, 0],
  [-0.1, 0.92, 0], [-0.1, 0.92 - TH, 0], [-0.1, 0.92 - TH - SH, 0],
  [-0.05, 1.03, 0.3],
];
const RIFLE_ABS = BONE_ABS[B.rifle];
const MUZZLE_LOCAL = new THREE.Vector3(0, 0.03, 0.71);
const GRIP_R = new THREE.Vector3(-0.014, -0.035, -0.07);
const GRIP_L = new THREE.Vector3(0.028, -0.05, 0.16);
const SHOULDER_R = new THREE.Vector3(-0.19, 0.15, -0.01); // chest space

function mkPose(x, y, z, rx, ry, rz) {
  return { p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)) };
}
// rifle bone poses in chest space
const POSE_LOW = mkPose(-0.05, -0.17, 0.23, 0.45, 0.42, 0.2);    // patrol low ready
const POSE_PORT = mkPose(-0.03, -0.07, 0.25, -0.95, 0.55, 0.35); // running, port arms
const POSE_AIM = mkPose(0.012, 0.2, 0.41, 0, 0.42, 0);           // shouldered, chest bladed -0.42
const POSE_SIT = mkPose(-0.02, -0.22, 0.27, -1.15, 0.15, 0.1);   // upright between the knees
// final death leg pose per fall: thighL, shinL, footL, thighR, shinR, footR (x rotations)
const DEATH_LEGS = {
  back: [-0.35, 0.6, -0.2, -0.08, 0.12, 0.3],
  forward: [0.08, 0.45, 0.5, 0.02, 0.15, 0.6],
  side: [-0.55, 0.9, -0.2, -0.25, 0.45, 0.1],
};
const POLE_R = new THREE.Vector3(-0.75, -1, -0.35).normalize();
const POLE_R_AIM = new THREE.Vector3(-1, -0.55, -0.15).normalize();
const POLE_L = new THREE.Vector3(0.75, -1, -0.15).normalize();
const POLE_L_AIM = new THREE.Vector3(0.45, -1, 0.0).normalize();

// Build one soldier variant. lod 0 = near (detailed), 1 = far.
function buildSoldierGeometry(v) {
  const P = [];
  const near = v.lod === 0;
  const seg = near ? 8 : 5;
  const add = (geo, tile, tint, bone) => P.push(prep(geo, tile, tint, bone));
  const skinT = T.SKIN0 + v.skin, faceT = T.FACE0 + v.skin;

  // ---- hips: trousers seat, pistol belt, pouches, canteens
  add(X(roundBox(0.33, 0.2, 0.21, 1.03, 1.0, 4), 0, 0.95, 0), T.TROUSER, 1, B.hips);
  add(X(box(0.34, 0.05, 0.225), 0, 1.035, 0), T.WEB, 0.95, B.hips);
  if (near) {
    add(X(box(0.2, 0.1, 0.17), 0, 0.865, 0), T.TROUSER, 0.95, B.hips);
    add(X(box(0.05, 0.035, 0.01), 0, 1.035, 0.115), T.METAL, 1.6, B.hips);
    for (const s of [1, -1]) add(X(box(0.09, 0.11, 0.065), 0.1 * s, 1.0, 0.13), T.WEB, 1, B.hips);
    add(X(cyl(0.05, 0.05, 0.16, 10), -0.15, 0.975, -0.08), T.WEB, 0.85, B.hips);
    add(X(cyl(0.018, 0.018, 0.03, 6), -0.15, 1.065, -0.08), T.BAND, 1, B.hips);
    if (v.loadout !== 'ruck') {
      add(X(box(0.21, 0.13, 0.1), 0, 0.99, -0.16), T.PACK, 1, B.hips);
      add(X(cyl(0.05, 0.05, 0.16, 10), 0.15, 0.975, -0.08), T.WEB, 0.85, B.hips);
    }
  }

  // ---- spine: jacket skirt with lower pockets
  add(X(roundBox(0.32, 0.2, 0.2, 1.04, 1.04, 4), 0, 1.13, 0), T.CLOTH, 1, B.spine);
  if (near) {
    for (const s of [1, -1]) add(X(box(0.12, 0.12, 0.022), 0.085 * s, 1.11, 0.105), T.CLOTH, 0.9, B.spine);
    // jacket bloused over the pistol belt
    add(X(roundBox(0.338, 0.036, 0.218, 1, 1, 4), 0, 1.072, 0), T.ARM, 0.84, B.spine);
  }

  // ---- chest
  add(X(roundBox(0.34, 0.3, 0.21, 1.15, 1.05, 5), 0, 1.33, 0), T.TORSO, 1, B.chest);
  if (near) {
    add(X(roundBox(0.4, 0.06, 0.21, 0.96, 0.92, 4), 0, 1.45, 0), T.TORSO, 0.97, B.chest);
    add(X(cyl(0.075, 0.09, 0.05, 10), 0, 1.48, -0.005), T.CLOTH, 0.93, B.chest);
    // open collar points
    for (const s of [1, -1]) add(X(box(0.075, 0.008, 0.06), 0.045 * s, 1.474, 0.082, 0.55, 0, -0.55 * s), T.CLOTH, 0.9, B.chest);
    for (const s of [1, -1]) {
      add(X(box(0.11, 0.11, 0.022), 0.087 * s, 1.36, 0.109, 0, 0, -0.22 * s), T.CLOTH, 0.88, B.chest);
      add(X(box(0.12, 0.035, 0.028), 0.087 * s, 1.415, 0.112, 0, 0, -0.22 * s), T.CLOTH, 0.82, B.chest);
      add(X(box(0.045, 0.36, 0.012), 0.1 * s, 1.31, 0.116, 0, 0, -0.08 * s), T.WEB, 0.95, B.chest);
      if (v.loadout !== 'ruck' && v.loadout !== 'rto') add(X(box(0.045, 0.36, 0.012), 0.08 * s, 1.31, -0.116, 0, 0, 0.15 * s), T.WEB, 0.95, B.chest);
    }
    add(X(box(0.07, 0.06, 0.04), 0.1, 1.41, 0.135), T.WEB, 1, B.chest);
    add(X(sph(0.032, 8, 6), -0.105, 1.255, 0.14, 0, 0, 0, 1, 1.25, 1), T.WEB, 0.7, B.chest);
    add(X(box(0.012, 0.03, 0.012), -0.105, 1.3, 0.14), T.METAL, 1.4, B.chest);
  }
  if (v.loadout === 'ruck') {
    add(X(box(0.32, 0.38, 0.17), 0, 1.29, -0.205), T.PACK, 1, B.chest);
    if (near) {
      for (const s of [1, -1]) {
        add(X(box(0.06, 0.15, 0.12), 0.19 * s, 1.22, -0.2), T.PACK, 0.9, B.chest);
        add(X(box(0.035, 0.4, 0.01), 0.08 * s, 1.3, -0.292), T.WEB, 0.85, B.chest);
        add(X(box(0.045, 0.3, 0.012), 0.1 * s, 1.32, 0.116, 0, 0, -0.08 * s), T.WEB, 0.9, B.chest);
      }
      add(X(box(0.33, 0.05, 0.18), 0, 1.495, -0.205), T.PACK, 0.85, B.chest);
      add(X(cyl(0.065, 0.065, 0.38, 10), 0, 1.565, -0.2, 0, 0, Math.PI / 2), T.CLOTH, [0.85, 0.92, 0.72], B.chest);
    }
  } else if (v.loadout === 'rto') {
    add(X(box(0.26, 0.3, 0.12), 0, 1.29, -0.18), T.RADIO, 1, B.chest);
    add(X(cyl(0.006, 0.004, 1.3, 4), 0.09, 2.08, -0.2), T.BAND, 1, B.chest);
    if (near) {
      add(X(cyl(0.016, 0.016, 0.06, 6), 0.09, 1.46, -0.2), T.BAND, 1, B.chest);
      add(X(box(0.05, 0.12, 0.04), 0.13, 1.44, 0.125, 0.2, 0, 0.3), T.BAND, 1.2, B.chest);
      add(X(box(0.27, 0.05, 0.13), 0, 1.13, -0.17), T.PACK, 1, B.chest);
    }
  } else if (near) {
    // light: cloth bandolier across the chest, OD towel around the neck
    add(X(box(0.07, 0.62, 0.03), 0.0, 1.27, 0.128, 0, 0, -0.72), T.CLOTH, [0.85, 0.8, 0.62], B.chest);
    add(X(box(0.07, 0.62, 0.03), 0.0, 1.27, -0.128, 0, 0, 0.72), T.CLOTH, [0.85, 0.8, 0.62], B.chest);
    for (const s of [1, -1]) add(X(box(0.075, 0.2, 0.025), 0.085 * s, 1.39, 0.118, 0.05, 0, 0.12 * s), T.CLOTH, [0.75, 0.86, 0.6], B.chest);
    add(X(box(0.26, 0.07, 0.06), 0, 1.47, -0.09), T.CLOTH, [0.75, 0.86, 0.6], B.chest);
  }

  // ---- neck and head
  add(X(cyl(0.052, 0.056, 0.12, seg), 0, 1.52, 0.0), skinT, 0.92, B.neck);
  {
    const head = buildHead(near);
    const g = prep(X(head.geo, 0, 1.645, 0.012, 0, 0, 0, 0.0945, 0.112, 0.105), faceT, 1, B.head);
    const col = g.attributes.color.array;
    for (let i = 0; i < head.ao.length; i++) { col[i * 3] *= head.ao[i]; col[i * 3 + 1] *= head.ao[i]; col[i * 3 + 2] *= head.ao[i]; }
    P.push(g);
  }
  if (near) for (const s of [1, -1]) add(X(sph(0.03, 8, 6), 0.093 * s, 1.643, 0.006, 0, 0.25 * s, 0, 0.42, 1, 0.66), skinT, 0.88, B.head);
  // M1 helmet with cover and band, tipped back a little
  const hm = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.665, -0.005),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.09 - v.tilt * 0.08, 0, 0)), new THREE.Vector3(1, 1, 1));
  const HR = 0.15, HSY = 0.85, HSZ = 1.1, HT = 0.53 * Math.PI;
  add(XM(X(sph(HR, near ? 16 : 8, near ? 8 : 4, HT), 0, 0, 0, 0, 0, 0, 1, HSY, HSZ), hm), T.CAMO, 1, B.head);
  if (near) {
    add(XM(flipGeo(X(sph(HR * 0.97, 12, 6, HT), 0, 0, 0, 0, 0, 0, 1, HSY, HSZ)), hm), T.BAND, 0.6, B.head);
    const rimY = HR * Math.cos(HT) * HSY;
    add(XM(X(cyl(HR * Math.sin(HT) + 0.001, HR * Math.sin(HT) + 0.009, 0.016, 16, true), 0, rimY - 0.006, 0, 0, 0, 0, 1, 1, HSZ), hm), T.CAMO, 0.85, B.head);
    const bh = 0.045, br = Math.sqrt(HR * HR - (bh / HSY) * (bh / HSY)) + 0.003;
    add(XM(X(cyl(br - 0.002, br + 0.002, 0.026, 16, true), 0, bh, 0, 0, 0, 0, 1, 1, HSZ), hm), T.BAND, 1, B.head);
    if (v.band) add(XM(X(box(0.034, 0.062, 0.016), 0.128, bh + 0.01, 0.06, 0, 0.75, 0.12), hm), T.LIGHT, 1, B.head);
    for (const s of [1, -1]) add(XM(X(box(0.006, 0.09, 0.012), 0.146 * s, -0.05, 0.02, 0, 0, 0.1 * s), hm), T.WEB, 0.8, B.head);
  }

  // ---- arms and legs
  for (const s of [1, -1]) {
    const L = s > 0;
    const ua = L ? B.uArmL : B.uArmR, fa = L ? B.fArmL : B.fArmR, hd = L ? B.handL : B.handR;
    const th = L ? B.thighL : B.thighR, sh = L ? B.shinL : B.shinR, ft = L ? B.footL : B.footR;
    const ax = 0.19 * s, sy = 1.43, ey = sy - UA, wy = ey - FA;
    add(X(cyl(0.06, 0.05, UA, near ? 10 : seg), ax, sy - UA / 2, -0.01), T.ARM, 1, ua);
    if (near) add(X(sph(0.066, 10, 6), ax, sy - 0.005, -0.01), T.TORSO, 1, ua);
    if (v.rolled) {
      add(X(cyl(0.045, 0.036, FA - 0.03, seg), ax, ey - FA / 2 - 0.015, -0.01), skinT, 1, fa);
      if (near) {
        // sleeve rolled twice above the elbow joint: two fat rolls of the paler inside cloth
        add(X(new THREE.TorusGeometry(0.044, 0.015, 6, 14), ax, ey - 0.016, -0.01, Math.PI / 2), T.SLEEVE, 1, fa);
        add(X(new THREE.TorusGeometry(0.042, 0.013, 6, 14), ax, ey - 0.042, -0.01, Math.PI / 2), T.SLEEVE, 0.92, fa);
      } else add(X(cyl(0.056, 0.054, 0.06, seg), ax, ey - 0.03, -0.01), T.SLEEVE, 0.92, fa);
    } else {
      add(X(cyl(0.05, 0.042, FA, near ? 10 : seg), ax, ey - FA / 2, -0.01), T.ARM, 0.97, fa);
      if (near) add(X(cyl(0.046, 0.046, 0.03, seg), ax, wy + 0.02, -0.01), T.CLOTH, 0.85, fa);
    }
    add(X(box(0.072, 0.09, 0.052), ax, wy - 0.045, 0.0), skinT, 1, hd);
    if (near) add(X(box(0.022, 0.045, 0.022), ax - 0.03 * s, wy - 0.03, 0.03), skinT, 0.95, hd);

    const lx = 0.1 * s, hy = 0.92, ky = hy - TH, ay = ky - SH;
    add(X(cyl(0.088, 0.066, TH, seg), lx, hy - TH / 2, 0), T.TROUSER, 1, th);
    if (near) add(X(box(0.026, 0.15, 0.13), lx + 0.075 * s, hy - 0.22, 0.01), T.TROUSER, 0.9, th);
    add(X(cyl(0.064, 0.052, SH - 0.1, seg), lx, ky - (SH - 0.1) / 2, 0), T.TROUSER, 1, sh);
    add(X(cyl(0.056, 0.06, 0.15, seg), lx, ay + 0.065, 0), T.WEB, [0.8, 0.82, 0.7], sh);
    add(X(box(0.1, 0.085, 0.26), lx, 0.035, 0.055), T.BOOT, 1, ft);
    if (near) add(X(box(0.106, 0.025, 0.27), lx, 0.0125, 0.055), T.BAND, 0.7, ft);
  }

  // ---- M16A1 (rifle bone)
  const rx = RIFLE_ABS[0], ry = RIFLE_ABS[1], rz = RIFLE_ABS[2];
  const R = (geo, x, y, z, a = 0, b = 0, c = 0) => X(geo, rx + x, ry + y, rz + z, a, b, c);
  add(R(box(0.034, 0.055, 0.17), 0, -0.012, 0.0), T.METAL, 1, B.rifle);
  add(R(box(0.03, 0.045, 0.25), 0, 0.035, 0.03), T.METAL, 1.1, B.rifle);
  add(R(box(0.024, 0.12, 0.06), 0, -0.095, 0.06, 0.1), T.METAL, 0.9, B.rifle);
  add(R(taperBoxZ(0.04, 0.115, 0.27, 0.85, 0.52), 0, -0.005, -0.215), T.METAL, 1, B.rifle);
  add(R(cyl(0.0085, 0.0085, 0.24, 6), 0, 0.03, 0.53, Math.PI / 2), T.METAL, 1.2, B.rifle);
  add(R(cyl(0.032, 0.032, 0.27, 3), 0, 0.028, 0.285, Math.PI / 2, 0, Math.PI), T.METAL, 1, B.rifle);
  add(R(box(0.018, 0.014, 0.15), 0, 0.1, 0.005), T.METAL, 1.1, B.rifle);
  if (near) {
    add(R(box(0.022, 0.04, 0.035), 0, 0.08, -0.075), T.METAL, 1.1, B.rifle);
    add(R(box(0.016, 0.04, 0.02), 0, 0.075, 0.07), T.METAL, 1.1, B.rifle);
    add(R(box(0.028, 0.095, 0.038), 0, -0.065, -0.05, -0.35), T.METAL, 0.95, B.rifle);
    add(R(box(0.006, 0.006, 0.05), 0, -0.045, -0.005), T.METAL, 1.2, B.rifle);
    add(R(box(0.042, 0.12, 0.012), 0, -0.008, -0.352), T.BAND, 1, B.rifle);
    add(R(box(0.022, 0.065, 0.025), 0, 0.06, 0.44), T.METAL, 1.1, B.rifle);
    add(R(box(0.006, 0.03, 0.006), 0, 0.1, 0.44), T.METAL, 1.1, B.rifle);
    add(R(cyl(0.012, 0.012, 0.055, 6), 0, 0.03, 0.675, Math.PI / 2), T.METAL, 1.25, B.rifle);
    add(R(box(0.004, 0.012, 0.6), 0.02, -0.085, 0.1, 0.08), T.WEB, 0.85, B.rifle);
  }

  const geo = mergeGeometries(P, false);
  for (const g of P) g.dispose();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
  return geo;
}

// ---------------------------------------------------------------------------
// Soldier surface maps, derived from the painted atlas: a normal map from its luminance (weave,
// folds, creases, stitching), roughness/metalness per tile (cotton and canvas matte, skin
// slightly oily, rifle and radio steel), and a sheen colour for the fabric tiles so the
// uniforms catch grazing light like cloth instead of plastic.
// ---------------------------------------------------------------------------
const FABRIC_TILES = [T.CLOTH, T.TROUSER, T.CAMO, T.WEB, T.SLEEVE, T.ARM, T.PACK, T.TORSO];
const TILE_SURF = (() => {
  const m = new Map();
  for (const t of FABRIC_TILES) m.set(t, { r: 0.93, m: 0, sheen: t === T.WEB || t === T.PACK ? 0.5 : 0.85, n: 2.2 });
  for (const t of [T.SKIN0, T.SKIN1, T.SKIN2, T.FACE0, T.FACE1, T.FACE2]) m.set(t, { r: 0.56, m: 0, sheen: 0, n: 0.8 });
  m.set(T.BOOT, { r: 0.62, m: 0, sheen: 0.15, n: 1.6 });
  m.set(T.METAL, { r: 0.46, m: 0.55, sheen: 0, n: 1.0 });
  m.set(T.BAND, { r: 0.72, m: 0, sheen: 0.2, n: 1.2 });
  m.set(T.RADIO, { r: 0.6, m: 0.25, sheen: 0, n: 1.2 });
  m.set(T.LIGHT, { r: 0.5, m: 0, sheen: 0, n: 0.8 });
  return m;
})();

function buildAtlasSurface(atlas) {
  const c = atlas?.image;
  if (!c || !c.getContext) return null;
  const W = c.width, H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255;
  const nrm = new Uint8ClampedArray(W * H * 4), orm = new Uint8ClampedArray(W * H * 4), sh = new Uint8ClampedArray(W * H * 4);
  const tiles = [];
  for (const [t, surf] of TILE_SURF) { const [x, y, s] = tileRect(t); tiles.push([x, y, s, surf]); }
  const def = { r: 0.85, m: 0, sheen: 0.3, n: 1.5 };
  const surfAt = (x, y) => {
    for (const [tx, ty, ts, surf] of tiles) if (x >= tx && y >= ty && x < tx + ts && y < ty + ts) return surf;
    return def;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const surf = surfAt(x, y), k = y * W + x;
      const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
      const dx = (L[y * W + xr] - L[y * W + xl]) * surf.n, dy = (L[yd * W + x] - L[yu * W + x]) * surf.n;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      // canvas texture is flipped on upload: +v runs up the image
      nrm[k * 4] = (-dx * l * 0.5 + 0.5) * 255; nrm[k * 4 + 1] = (dy * l * 0.5 + 0.5) * 255; nrm[k * 4 + 2] = (l * 0.5 + 0.5) * 255; nrm[k * 4 + 3] = 255;
      // darker (dirtier, sweat-soaked) cloth is a touch less rough
      const r = clamp(surf.r + (L[k] - 0.3) * 0.18, 0.3, 1);
      orm[k * 4] = 255; orm[k * 4 + 1] = r * 255; orm[k * 4 + 2] = surf.m * 255; orm[k * 4 + 3] = 255;
      const sv = surf.sheen * 255;
      sh[k * 4] = sv * 0.78; sh[k * 4 + 1] = sv * 0.82; sh[k * 4 + 2] = sv * 0.66; sh[k * 4 + 3] = 255;
    }
  }
  const mk = (data, srgb) => canvasTexture(W, H, (g) => g.putImageData(new ImageData(data, W, H), 0, 0), { srgb });
  return { normal: mk(nrm, false), orm: mk(orm, false), sheen: mk(sh, true) };
}

function createSoldierKit(ctx) {
  const atlas = buildAtlas();
  let material;
  try {
    const surf = buildAtlasSurface(atlas);
    material = new THREE.MeshPhysicalMaterial({
      map: atlas, vertexColors: true, roughness: 1, metalness: 1,
      normalMap: surf?.normal || null, normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: surf?.orm || null, metalnessMap: surf?.orm || null,
      sheen: surf ? 1 : 0, sheenColor: new THREE.Color(0.3, 0.3, 0.3), sheenColorMap: surf?.sheen || null, sheenRoughness: 0.55,
    });
    if (!surf) { material.roughness = 0.9; material.metalness = 0; }
  } catch (e) {
    material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9, metalness: 0 });
  }
  // ambient from the world's bake: darker and greener under the canopy, like everything else
  try { ctx?.world?.bakePatch?.(material, { sky: 0.85 }); } catch (e) { /* world without bake */ }
  const bakeAO = (g) => {
    try {
      ctx?.world?.bakeVertexAO?.([{ geometry: g }], { voxel: 0.022, maxDist: 0.28, strength: 0.85, multiply: true, budget: 6e5 });
    } catch (e) { /* unbaked geometry still renders */ }
    return g;
  };
  const cache = new Map();
  return {
    material,
    hitGeo: new THREE.BoxGeometry(1, 1, 1),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
    sphere: new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2),
    geometry(variant, lod) {
      const key = `${lod}|${variant.skin}|${variant.loadout}|${variant.rolled ? 1 : 0}|${lod === 0 && variant.band ? 1 : 0}|${variant.tilt}`;
      let g = cache.get(key);
      if (!g) { g = bakeAO(buildSoldierGeometry({ ...variant, lod })); cache.set(key, g); }
      return g;
    },
  };
}

// ---------------------------------------------------------------------------
// Soldier: skinned model + procedural animation (gait IK, rifle IK, aim, crouch, death)
// ---------------------------------------------------------------------------

class Soldier {
  constructor(kit, variant) {
    this.group = new THREE.Group();
    this.group.name = 'usSoldier';
    this.bones = new Array(BN.length);
    for (let i = 0; i < BN.length; i++) {
      const b = new THREE.Bone();
      b.name = BN[i];
      const p = BONE_ABS[i], pi = BONE_PARENT[i];
      if (pi < 0) b.position.set(p[0], p[1], p[2]);
      else {
        const q = BONE_ABS[pi];
        b.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        this.bones[pi].add(b);
      }
      this.bones[i] = b;
    }
    this.group.add(this.bones[0]);
    this.bones[0].updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);

    this.near = new THREE.SkinnedMesh(kit.geometry(variant, 0), kit.material);
    this.far = new THREE.SkinnedMesh(kit.geometry(variant, 1), kit.material);
    for (const m of [this.near, this.far]) {
      m.bind(this.skeleton, IDENTITY);
      m.boundingSphere = kit.sphere;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.near.castShadow = true;
    this.far.visible = false;
    this.lod = 0;

    this.hitboxes = [];
    const hb = (bone, sx, sy, sz, x, y, z, part) => {
      const m = new THREE.Mesh(kit.hitGeo, kit.hitMat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData.part = part;
      this.bones[bone].add(m);
      this.hitboxes.push(m);
    };
    hb(B.head, 0.25, 0.3, 0.29, 0, 0.1, 0.0, 'head');
    hb(B.spine, 0.46, 0.44, 0.36, 0, 0.19, -0.02, 'body');
    hb(B.hips, 0.36, 0.22, 0.26, 0, -0.03, 0, 'body');
    hb(B.thighL, 0.17, 0.46, 0.19, 0, -0.21, 0, 'body');
    hb(B.thighR, 0.17, 0.46, 0.19, 0, -0.21, 0, 'body');
    hb(B.shinL, 0.14, 0.46, 0.18, 0, -0.22, 0.02, 'body');
    hb(B.shinR, 0.14, 0.46, 0.18, 0, -0.22, 0.02, 'body');

    this.anim = {
      speed: 0, speedS: 0, phase: Math.random(), t: Math.random() * 10,
      crouch: 0, crouchT: 0, aim: 0, aimT: 0, sitW: 0, sit: false,
      aimYaw: 0, aimPitch: 0, lookYaw: 0, lookPitch: 0, lean: 0,
      recoil: 0, flinch: 0, flinchSide: 1, throwT: 0,
    };
    this.dead = false;
    this.death = null;
    this.frozen = false;
  }

  setLOD(level, shadow) {
    if (level === this.lod && this.near.castShadow === shadow) return;
    this.lod = level;
    this.group.visible = level < 2;
    this.near.visible = level === 0;
    this.far.visible = level === 1;
    this.near.castShadow = shadow;
  }

  muzzleWorld(out) { return out.copy(MUZZLE_LOCAL).applyMatrix4(this.bones[B.rifle].matrixWorld); }
  headWorld(out) { return out.set(0, 0.1, 0.02).applyMatrix4(this.bones[B.head].matrixWorld); }

  animate(dt) {
    if (this.dead) { this._death(dt); return; }
    const A = this.anim, b = this.bones;
    A.crouch = damp(A.crouch, A.crouchT, 5, dt);
    A.aim = damp(A.aim, A.aimT, 7, dt);
    A.sitW = damp(A.sitW, A.sit ? 1 : 0, 10, dt);
    A.recoil = Math.max(0, A.recoil - dt * 10);
    A.flinch = Math.max(0, A.flinch - dt * 3.5);
    A.throwT = Math.max(0, A.throwT - dt);
    A.speedS = damp(A.speedS, A.speed, 8, dt);
    A.t += dt;
    const s = Math.abs(A.speedS);
    const sit = A.sitW;
    const run = smoothstep(2.3, 3.8, s) * (1 - sit);
    const amp = clamp(s / 0.7, 0, 1) * (1 - sit);
    const crouch = A.crouch * (1 - sit);
    const strideLen = lerp(1.3, 2.3, run) * lerp(1, 0.72, crouch);
    A.phase = (A.phase + (A.speedS / strideLen) * dt) % 1;
    if (A.phase < 0) A.phase += 1;
    const ph = A.phase;

    // pelvis
    const bob = amp * lerp(0.018, 0.04, run) * Math.cos(ph * TAU * 2);
    let hipsY = 0.97 - run * 0.05 - crouch * lerp(0.42, 0.3, amp) - bob;
    hipsY = lerp(hipsY, 0.52, sit);
    const lean = lerp(0.05, 0.3, run) * amp + crouch * 0.3 + A.lean;
    const twist = amp * 0.11 * Math.sin(ph * TAU) * (1 - A.aim * 0.7);
    const hips = b[B.hips];
    hips.position.set(0, hipsY, 0);
    hips.rotation.set(lean * 0.3, twist, amp * 0.03 * Math.sin(ph * TAU + 1.2));

    // legs: planted-foot gait through 2-bone IK
    const stanceFrac = lerp(0.62, 0.42, run);
    const half = strideLen * 0.25 * amp;
    const lift = lerp(0.09, 0.2, run) * amp;
    const kneel = crouch * (1 - amp);
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      const p = (ph + side * 0.5) % 1;
      let fz, fy = 0, toe = 0;
      if (p < stanceFrac) fz = lerp(half, -half, p / stanceFrac);
      else {
        const u = (p - stanceFrac) / (1 - stanceFrac);
        fz = lerp(-half, half, u * u * (3 - 2 * u));
        fy = Math.sin(u * Math.PI) * lift;
        toe = Math.sin(u * Math.PI) * 0.35 * amp;
      }
      fz += kneel * (side === 0 ? 0.3 : -0.24);
      fy += side === 1 ? kneel * 0.05 : 0;
      if (side === 1) toe -= kneel * 0.6;
      const fx = sg * (0.1 + 0.05 * crouch + 0.02 * sit);
      fz = lerp(fz, 0.42, sit);
      fy = lerp(fy, 0.0, sit);
      this._leg(side, fx, 0.06 + fy, fz, toe);
    }

    // torso, aim and breathing
    const blade = -0.42 * A.aim;
    const aimYaw = A.aimYaw * A.aim, aimPitch = A.aimPitch * A.aim;
    const breathe = Math.sin(A.t * 1.7) * 0.012;
    const fl = A.flinch;
    b[B.spine].rotation.set(lean * 0.35 - aimPitch * 0.4 - fl * 0.12, -twist * 0.6 + blade * 0.4 + aimYaw * 0.45, fl * 0.08 * A.flinchSide);
    b[B.chest].rotation.set(lean * 0.3 - aimPitch * 0.6 + breathe - A.recoil * 0.05 - fl * 0.22, -twist * 0.4 + blade * 0.6 + aimYaw * 0.55, fl * 0.1 * A.flinchSide);
    const bodyPitch = hips.rotation.x + b[B.spine].rotation.x + b[B.chest].rotation.x;
    const bodyYaw = hips.rotation.y + b[B.spine].rotation.y + b[B.chest].rotation.y;
    const headPitch = lerp(A.lookPitch, -A.aimPitch, A.aim) + A.aim * 0.22;
    const headYaw = clamp(lerp(A.lookYaw, A.aimYaw - 0.06, A.aim), -1.3, 1.3);
    const dp = headPitch - bodyPitch, dy = wrapAngle(headYaw - bodyYaw);
    b[B.neck].rotation.set(dp * 0.4, dy * 0.4, 0);
    b[B.head].rotation.set(dp * 0.6, dy * 0.6, A.aim * 0.16);

    // rifle: blend low ready / port arms / shouldered
    const rf = b[B.rifle];
    rf.position.lerpVectors(POSE_LOW.p, POSE_PORT.p, run);
    rf.quaternion.slerpQuaternions(POSE_LOW.q, POSE_PORT.q, run);
    if (sit > 0.001) { rf.position.lerp(POSE_SIT.p, sit); rf.quaternion.slerp(POSE_SIT.q, sit); }
    rf.position.lerp(POSE_AIM.p, A.aim);
    rf.quaternion.slerp(POSE_AIM.q, A.aim);
    // keep the shouldered rifle on the aim line whatever the torso lean (pivot at the shoulder)
    const extra = (bodyPitch + aimPitch - breathe) * A.aim;
    if (Math.abs(extra) > 1e-4) {
      _q3.setFromAxisAngle(V_X, -extra);
      rf.position.sub(SHOULDER_R).applyQuaternion(_q3).add(SHOULDER_R);
      rf.quaternion.premultiply(_q3);
    }
    rf.position.z -= A.recoil * 0.03;

    // arms reach the rifle
    _v7.copy(GRIP_R).applyQuaternion(rf.quaternion).add(rf.position);
    _v8.lerpVectors(POLE_R, POLE_R_AIM, A.aim).normalize();
    this._arm(B.uArmR, B.fArmR, _v7, _v8);
    if (A.throwT > 0) {
      // underarm lob with the left hand
      const k = 1 - A.throwT / 0.6;
      _v7.set(0.22, lerp(-0.3, 0.2, Math.sin(k * Math.PI)), lerp(-0.1, 0.45, k));
      this._arm(B.uArmL, B.fArmL, _v7, POLE_L);
    } else {
      _v7.copy(GRIP_L).applyQuaternion(rf.quaternion).add(rf.position);
      _v8.lerpVectors(POLE_L, POLE_L_AIM, A.aim).normalize();
      this._arm(B.uArmL, B.fArmL, _v7, _v8);
    }
    b[B.handL].rotation.set(0, 0, 0);
    b[B.handR].rotation.set(0, 0, 0);
  }

  _leg(side, fx, fy, fz, toe) {
    const b = this.bones, hips = b[B.hips];
    const th = b[side === 0 ? B.thighL : B.thighR];
    const sh = b[side === 0 ? B.shinL : B.shinR];
    const ft = b[side === 0 ? B.footL : B.footR];
    _v1.set(fx, fy, fz).sub(hips.position).applyQuaternion(_q1.copy(hips.quaternion).invert());
    _v1.sub(th.position);
    const dy = Math.max(0.05, -_v1.y), dz = _v1.z;
    let d = Math.hypot(dy, dz);
    d = clamp(d, 0.12, TH + SH - 0.002);
    const a0 = Math.atan2(-dz, dy);
    const alpha = Math.acos(clamp((TH * TH + d * d - SH * SH) / (2 * TH * d), -1, 1));
    const beta = Math.acos(clamp((TH * TH + SH * SH - d * d) / (2 * TH * SH), -1, 1));
    const tx = a0 - alpha, kx = Math.PI - beta;
    const roll = Math.atan2(_v1.x, dy);
    th.rotation.set(tx, 0, roll);
    sh.rotation.set(kx, 0, 0);
    ft.rotation.set(-(tx + kx) - hips.rotation.x + toe, 0, -roll);
  }

  _arm(iu, ifa, target, pole) {
    const b = this.bones, ua = b[iu], fa = b[ifa];
    const S = ua.position;
    _v2.subVectors(target, S);
    let d = _v2.length();
    if (d < 1e-5) { _v2.set(0, -1, 0); d = 0.1; } else _v2.multiplyScalar(1 / d);
    d = clamp(d, 0.1, UA + FA - 0.003);
    const cosA = clamp((UA * UA + d * d - FA * FA) / (2 * UA * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _v3.copy(pole).addScaledVector(_v2, -pole.dot(_v2));
    if (_v3.lengthSq() < 1e-6) _v3.set(0, -1, 0);
    _v3.normalize();
    // elbow
    _v4.copy(S).addScaledVector(_v2, UA * cosA).addScaledVector(_v3, UA * sinA);
    _v5.subVectors(_v4, S).normalize();
    ua.quaternion.setFromUnitVectors(V_DOWN, _v5);
    _v6.copy(S).addScaledVector(_v2, d).sub(_v4).normalize();
    _v6.applyQuaternion(_q2.copy(ua.quaternion).invert());
    fa.quaternion.setFromUnitVectors(V_DOWN, _v6);
  }

  // type: 'forward' | 'back' | 'side' | 'pit'; slope: ground angle along the fall
  die(type, sideSign, slope) {
    if (this.dead) return;
    this.dead = true;
    const b = this.bones, rf = b[B.rifle];
    const dir = type === 'forward' ? 1 : -1;
    this.death = {
      type, dir, side: sideSign || 1, t: 0, done: false,
      delay: type === 'side' ? 0.3 : type === 'pit' ? 0.05 : 0.08,
      dur: type === 'side' ? 0.75 : 0.62,
      maxAng: clamp(1.5 - slope, 1.05, 1.8),
      hipsY0: b[B.hips].position.y,
      sink: type === 'pit' ? 0.75 : 0,
      rifleP0: rf.position.clone(), rifleQ0: rf.quaternion.clone(),
      // dropped rifle ends flat on the ground beside the torso
      rifleP1: type === 'side'
        ? new THREE.Vector3(rnd(-0.1, 0.1), rnd(-0.35, -0.1), rnd(0.32, 0.45))
        : new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * rnd(0.38, 0.5), rnd(-0.3, 0.05), dir * 0.12),
      rifleQ1: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + rnd(-0.5, 0.5), rnd(-0.25, 0.25), type === 'side' ? 0 : Math.PI / 2)),
      spine0: b[B.spine].rotation.x, chest0: b[B.chest].rotation.x,
      armSpread: rnd(0.4, 1.0), legSplay: rnd(-0.2, 0.25),
    };
  }

  _death(dt) {
    const D = this.death;
    if (!D || D.done) return;
    D.t += dt;
    const b = this.bones, t = D.t;
    const buckle = smoothstep(0, 0.35, t);
    const k = clamp((t - D.delay) / D.dur, 0, 1);
    const fall = D.type === 'pit' ? 0.25 * smoothstep(0, 1, k) : k * k;
    const after = t - D.delay - D.dur;
    const settle = after > 0 ? Math.exp(-after * 9) * Math.sin(after * 24) * 0.05 : 0;
    const ang = D.maxAng * fall + settle;
    const root = b[B.root];
    if (D.type === 'side') root.rotation.set(0, 0, D.side * ang);
    else root.rotation.set(D.dir * ang, 0, 0);
    root.position.y = (D.type === 'pit' ? 0 : D.type === 'side' ? 0.13 * fall : 0.05 * fall) - D.sink * smoothstep(0, 0.45, t);
    const hips = b[B.hips];
    hips.position.set(0, lerp(D.hipsY0, D.type === 'side' || D.type === 'pit' ? 0.5 : 0.84, buckle), 0);
    hips.rotation.set(0, 0, 0);
    // knees buckle, then the legs settle into a pose that lies on the ground plane
    const L = D.type === 'back' ? DEATH_LEGS.back : D.type === 'forward' ? DEATH_LEGS.forward : DEATH_LEGS.side;
    const sideF = D.type === 'side' ? 0 : 1;
    const sp = D.legSplay * sideF;
    b[B.thighL].rotation.set(lerp(-0.55 * buckle, L[0], fall), 0, (0.06 * sideF + sp * 0.5) * fall);
    b[B.shinL].rotation.set(lerp(1.15 * buckle, L[1], fall), 0, 0);
    b[B.footL].rotation.set(lerp(-0.3 * buckle, L[2], fall), 0, 0);
    b[B.thighR].rotation.set(lerp(-0.3 * buckle, L[3], fall), 0, -(0.08 * sideF + sp * 0.4) * fall);
    b[B.shinR].rotation.set(lerp(0.8 * buckle, L[4], fall), 0, 0);
    b[B.footR].rotation.set(lerp(0, L[5], fall), 0, 0);
    const curl = D.type === 'forward' ? 0.25 : D.type === 'back' ? -0.2 : 0.3;
    b[B.spine].rotation.set(lerp(D.spine0, curl, buckle), 0, 0);
    b[B.chest].rotation.set(lerp(D.chest0, curl * 0.8, buckle), 0.1 * D.side * fall, 0);
    b[B.neck].rotation.set(0.2 * buckle, 0, 0);
    b[B.head].rotation.set((D.type === 'back' ? -0.5 : 0.45) * fall, 0.5 * D.side * fall, 0.2 * fall);
    // arms trail the fall and end up lying on the ground beside the body
    const up = D.type === 'back' ? 0.3 : D.type === 'forward' ? 0.15 : -0.7;
    const spread = D.type === 'side' ? 0.08 : D.armSpread;
    b[B.uArmL].rotation.set(lerp(-0.35, up, fall), 0, lerp(0.15, sideF * (0.15 + spread), fall));
    b[B.uArmR].rotation.set(lerp(-0.45, up * 0.8, fall), 0, -lerp(0.12, sideF * (0.12 + spread * 0.8), fall));
    b[B.uArmL].quaternion.setFromEuler(b[B.uArmL].rotation);
    b[B.uArmR].quaternion.setFromEuler(b[B.uArmR].rotation);
    b[B.fArmL].rotation.set(-0.4 * fall - 0.3, 0, 0);
    b[B.fArmR].rotation.set(-0.7 * fall - 0.2, 0, 0);
    const rk = smoothstep(0, 0.8, t);
    b[B.rifle].position.lerpVectors(D.rifleP0, D.rifleP1, rk);
    b[B.rifle].quaternion.slerpQuaternions(D.rifleQ0, D.rifleQ1, rk);
    if (after > 0.6) { D.done = true; if (D.type !== 'pit') this._settle(); }
  }

  // lift a fallen body so the torso rests on the ground instead of sinking into it
  // (pivoting at the feet, so heels stay down when a rucksack props the shoulders up)
  _settle() {
    const D = this.death, root = this.bones[B.root];
    const m = this.near, pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex;
    for (let pass = 0; pass < 2; pass++) {
      root.updateMatrixWorld(true);
      let minY = Infinity;
      for (let i = 0; i < pos.count; i += 2) {
        const bi = si.getX(i);
        if (bi < B.spine || bi > B.head) continue;
        _v1.fromBufferAttribute(pos, i);
        m.applyBoneTransform(i, _v1);
        if (_v1.y < minY) minY = _v1.y;
      }
      if (!Number.isFinite(minY)) return;
      const lift = 0.02 - minY;
      if (Math.abs(lift) < 0.015) return;
      const d = clamp(Math.atan2(lift, 1.15), -0.25, 0.45);
      if (D.type === 'side') root.rotation.z -= D.side * d; else root.rotation.x -= D.dir * d;
    }
  }
}

// ---------------------------------------------------------------------------
// Collision grid (circles + AABBs) for steering, cover and line of sight
// ---------------------------------------------------------------------------

class Grid {
  constructor(cs) { this.cs = cs; this.inv = 1 / cs; this.cells = new Map(); this.stamp = 1; this.items = []; }
  key(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); }
  clear() { this.cells.clear(); this.items.length = 0; }
  insert(it) {
    this.items.push(it);
    const x0 = Math.floor(it.minx * this.inv), x1 = Math.floor(it.maxx * this.inv);
    const z0 = Math.floor(it.minz * this.inv), z1 = Math.floor(it.maxz * this.inv);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      let c = this.cells.get(k);
      if (!c) { c = []; this.cells.set(k, c); }
      c.push(it);
    }
  }
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const st = ++this.stamp;
    const x0 = Math.floor(minx * this.inv), x1 = Math.floor(maxx * this.inv);
    const z0 = Math.floor(minz * this.inv), z1 = Math.floor(maxz * this.inv);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const c = this.cells.get(this.key(ix, iz));
      if (!c) continue;
      for (let i = 0; i < c.length; i++) { const it = c[i]; if (it.s !== st) { it.s = st; out.push(it); } }
    }
    return out;
  }
  // true if the segment passes through a blocking collider
  segmentBlocked(ax, ay, az, bx, by, bz) {
    const cs = this.cs, st = ++this.stamp;
    const dx = bx - ax, dz = bz - az, dy = by - ay;
    const len2 = dx * dx + dz * dz;
    let ix = Math.floor(ax * this.inv), iz = Math.floor(az * this.inv);
    const ex = Math.floor(bx * this.inv), ez = Math.floor(bz * this.inv);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(cs / dx) : Infinity, tdz = dz !== 0 ? Math.abs(cs / dz) : Infinity;
    let tmx = dx !== 0 ? (stepX > 0 ? (ix + 1) * cs - ax : ax - ix * cs) / Math.abs(dx) : Infinity;
    let tmz = dz !== 0 ? (stepZ > 0 ? (iz + 1) * cs - az : az - iz * cs) / Math.abs(dz) : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      const c = this.cells.get(this.key(ix, iz));
      if (c) {
        for (let i = 0; i < c.length; i++) {
          const it = c[i];
          if (it.s === st) continue;
          it.s = st;
          if (it.kind === 0) {
            // circle: skip low cover the viewer is hugging
            const vx = ax - it.x, vz = az - it.z;
            if (it.low && vx * vx + vz * vz < (it.r + 1.3) * (it.r + 1.3)) continue;
            let t = len2 > 0 ? ((it.x - ax) * dx + (it.z - az) * dz) / len2 : 0;
            if (t <= 0.0 || t >= 1) continue;
            const px = ax + dx * t - it.x, pz = az + dz * t - it.z;
            const rr = it.r * 0.9;
            if (px * px + pz * pz > rr * rr) continue;
            if (ay + dy * t > it.top) continue;
            return true;
          } else {
            if (it.low) {
              const cx = clamp(ax, it.minx, it.maxx) - ax, cz = clamp(az, it.minz, it.maxz) - az;
              if (cx * cx + cz * cz < 1.6) continue;
            }
            if (segAabb(ax, ay, az, dx, dy, dz, it)) return true;
          }
        }
      }
      if (ix === ex && iz === ez) break;
      if (Math.min(tmx, tmz) > 1) break;
      if (tmx < tmz) { tmx += tdx; ix += stepX; } else { tmz += tdz; iz += stepZ; }
    }
    return false;
  }
}

function segAabb(ax, ay, az, dx, dy, dz, b) {
  let t0 = 0.001, t1 = 0.999;
  const o = [ax, ay, az], d = [dx, dy, dz];
  const mn = [b.minx, b.miny, b.minz], mx = [b.maxx, b.maxy, b.maxz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn[k] || o[k] > mx[k]) return false; continue; }
    let ta = (mn[k] - o[k]) / d[k], tb = (mx[k] - o[k]) / d[k];
    if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Effects: tracers, muzzle flashes, dust puffs, thrown grenades
// ---------------------------------------------------------------------------

// Instanced unit quad with per-instance attributes (one draw call per effect system).
function instancedQuad(max, attrs) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const out = {};
  for (const [name, size] of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { geo: g, attrs: out };
}
function flushAttr(a, n) {
  if (typeof a.clearUpdateRanges === 'function') { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); }
  a.needsUpdate = true;
}

const FOG_FACTOR_GLSL = /* glsl */`
  float ff = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      ff = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif`;

// Tracers: camera-facing ribbons, a thin hot core inside a wider, fainter red sheath, drawn
// with normal blending so the red survives against a bright sky. Width is held near a
// constant 1.5-2 px at range and thins right next to the eye.
const EN_TRACER_VS = /* glsl */`
attribute vec3 iA;
attribute vec3 iD;
attribute vec4 iS; // tail, head, max core width, alpha
varying float vT;
varying float vX;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float along = position.y + 0.5;
  vec3 P = iA + iD * mix(iS.x, iS.y, along);
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 side = cross(iD, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = clamp(dist * 0.0024, 0.004, iS.z);
  P += side * position.x * w * 2.6;
  vT = along; vX = position.x * 2.0; vA = iS.w;
  vec4 mvPosition = viewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const EN_TRACER_FS = /* glsl */`
uniform vec3 uCore;
uniform vec3 uGlow;
varying float vT;
varying float vX;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float x = abs(vX);
  float core = 1.0 - smoothstep(0.28, 0.5, x);
  float glow = 1.0 - x;
  float lenF = smoothstep(0.0, 0.4, vT) * (0.75 + 0.25 * vT);
  float a = max(core * 0.92, glow * glow * 0.42) * lenF * vA;
  ${FOG_FACTOR_GLSL}
  a *= 1.0 - 0.55 * ff;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uGlow, uCore, core), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Puffs (alpha) and muzzle flashes (additive) share one instanced billboard draw through
// premultiplied blending: puffs write alpha, flashes write zero alpha and simply add.
const EN_BB_VS = /* glsl */`
attribute vec4 iP; // xyz, size
attribute vec4 iC; // rgb, alpha
attribute vec2 iR; // rotation, kind (0 puff, 1 flash)
varying vec2 vUv;
varying vec4 vC;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(iP.xyz, 1.0);
  float c = cos(iR.x), s = sin(iR.x);
  vec2 q = position.xy * iP.w;
  mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vUv = vec2((uv.x + iR.y) * 0.5, uv.y);
  vC = iC; vKind = iR.y;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const EN_BB_FS = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vC;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  vec4 tx = texture2D(uMap, vUv);
  vec3 col = tx.rgb * vC.rgb;
  float a = tx.a * vC.a;
  ${FOG_FACTOR_GLSL}
  #ifdef USE_FOG
    col = mix(col, fogColor, ff * (1.0 - vKind));
  #endif
  a *= 1.0 - 0.5 * ff * vKind;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vKind));
}`;

const TRACER_MAX = 96, BB_MAX = 128;
const TRACER_SPEED = 620, TRACER_TAIL = 4.5, TRACER_TAIL_NEAR = 2;

// fxLight: a light shared with weapons.js (its muzzle/explosion light). Enemy muzzle flashes
// borrow it for a frame or two when they outshine whatever weapons.js put in it this frame,
// so the scene never carries a second dynamic point light for them.
function createFx(scene, camera = null, fxLight = null) {
  const _camP = new THREE.Vector3();
  const _c = new THREE.Color();
  const tex = canvasTexture(128, 64, (g) => {
    // left: dust puff
    const r = rand(77);
    for (let i = 0; i < 9; i++) {
      const x = 20 + r() * 24, y = 20 + r() * 24, rad = 10 + r() * 14;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    // right: muzzle flash star
    g.save();
    g.beginPath(); g.rect(64, 0, 64, 64); g.clip();
    g.translate(64, 0);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,245,215,1)');
    gr.addColorStop(0.22, 'rgba(255,200,110,0.85)');
    gr.addColorStop(0.55, 'rgba(255,140,40,0.25)');
    gr.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,215,150,0.55)'; g.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29); g.stroke();
    }
    g.restore();
  }, { repeat: false });
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;

  // ---- tracers
  const tr = instancedQuad(TRACER_MAX, [['iA', 3], ['iD', 3], ['iS', 4]]);
  const trMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uCore: { value: new THREE.Color(1.6, 0.18, 0.05) },
      uGlow: { value: new THREE.Color(0.85, 0.045, 0.012) },
    }]),
    vertexShader: EN_TRACER_VS, fragmentShader: EN_TRACER_FS,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: true, side: THREE.DoubleSide,
  });
  const trMesh = new THREE.Mesh(tr.geo, trMat);
  trMesh.frustumCulled = false; trMesh.renderOrder = 5; trMesh.name = 'enemyTracers';
  scene.add(trMesh);
  // per tracer: ax ay az dx dy dz len tail age
  const TRS = 9;
  const trData = new Float32Array(TRACER_MAX * TRS);
  let trN = 0, trWrap = 0;

  // ---- billboards (puffs + flashes)
  const bb = instancedQuad(BB_MAX, [['iP', 4], ['iC', 4], ['iR', 2]]);
  const bbMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]),
    vertexShader: EN_BB_VS, fragmentShader: EN_BB_FS,
    transparent: true, depthWrite: false, fog: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  bbMat.uniforms.uMap.value = tex;
  const bbMesh = new THREE.Mesh(bb.geo, bbMat);
  bbMesh.frustumCulled = false; bbMesh.renderOrder = 6; bbMesh.name = 'enemyPuffs';
  scene.add(bbMesh);
  // per billboard: x y z vx vy vz age life size0 size1 r g b alpha rot kind
  const BBS = 16;
  const bbData = new Float32Array(BB_MAX * BBS);
  let bbN = 0, bbWrap = 0;
  function bbSlot() {
    if (bbN < BB_MAX) return bbN++;
    bbWrap = (bbWrap + 1) % BB_MAX;
    return bbWrap;
  }

  // ---- muzzle light
  let ownLight = null;
  if (!fxLight) {
    ownLight = new THREE.PointLight(0xffb060, 0, 11, 2);
    ownLight.castShadow = false; ownLight.name = 'enemyFxLight';
    scene.add(ownLight);
  }
  const light = fxLight || ownLight;
  const lightPos = new THREE.Vector3();
  let lightT = 0, lightSet = -1;
  const LIGHT_I = 11, LIGHT_RANGE = 11;

  // ---- thrown grenades (rare: plain meshes)
  const gGeo = new THREE.SphereGeometry(0.035, 8, 6);
  gGeo.scale(1, 1.25, 1);
  const gMat = new THREE.MeshStandardMaterial({ color: 0x3c4428, roughness: 0.7 });
  const grenades = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(gGeo, gMat);
    m.visible = false;
    scene.add(m);
    grenades.push({ m, a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, dur: 0.7, active: false, arc: 1 });
  }

  function puffAt(pos, size, life, color, rise) {
    const i = bbSlot(), o = i * BBS, d = bbData;
    d[o] = pos.x; d[o + 1] = pos.y; d[o + 2] = pos.z;
    d[o + 3] = rnd(-0.3, 0.3); d[o + 4] = rise; d[o + 5] = rnd(-0.3, 0.3);
    d[o + 6] = 0; d[o + 7] = Math.max(0.05, life); d[o + 8] = size * 0.35; d[o + 9] = size;
    _c.setHex(color ?? 0x8a7458);
    d[o + 10] = _c.r; d[o + 11] = _c.g; d[o + 12] = _c.b; d[o + 13] = 0.55;
    d[o + 14] = Math.random() * TAU; d[o + 15] = 0;
    return o;
  }

  _c.setHex(0xffd8a0);
  const FLASH_R = _c.r, FLASH_G = _c.g, FLASH_B = _c.b;

  return {
    tracer(from, to) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 2) return;
      const ix = dx / len, iy = dy / len, iz = dz / len;
      let tail = TRACER_TAIL;
      if (camera) {
        camera.getWorldPosition(_camP);
        const rx = _camP.x - from.x, ry = _camP.y - from.y, rz = _camP.z - from.z;
        const along = rx * ix + ry * iy + rz * iz;
        const r2 = rx * rx + ry * ry + rz * rz;
        // a round aimed at the player would streak straight through the lens: end it short of the eye
        if (along > 0 && along < len + 2 && r2 - along * along < 2.25) len = Math.min(len, along - 3);
        if (len < 2) return;
        const ca = clamp(along, 0, len);
        const mx = rx - ix * ca, my = ry - iy * ca, mz = rz - iz * ca;
        if (mx * mx + my * my + mz * mz < 25) tail = TRACER_TAIL_NEAR;
      }
      let i;
      if (trN < TRACER_MAX) i = trN++;
      else { trWrap = (trWrap + 1) % TRACER_MAX; i = trWrap; }
      const o = i * TRS, d = trData;
      d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z;
      d[o + 3] = ix; d[o + 4] = iy; d[o + 5] = iz;
      d[o + 6] = len; d[o + 7] = tail; d[o + 8] = 0;
    },
    flash(pos, near) {
      const i = bbSlot(), o = i * BBS, d = bbData;
      d[o] = pos.x; d[o + 1] = pos.y; d[o + 2] = pos.z;
      d[o + 3] = 0; d[o + 4] = 0; d[o + 5] = 0;
      const sc = rnd(0.32, 0.5);
      d[o + 6] = 0; d[o + 7] = 0.05; d[o + 8] = sc; d[o + 9] = sc;
      d[o + 10] = FLASH_R; d[o + 11] = FLASH_G; d[o + 12] = FLASH_B; d[o + 13] = 1;
      d[o + 14] = Math.random() * TAU; d[o + 15] = 1;
      if (near) { lightPos.copy(pos); lightT = 0.05; }
    },
    puff(pos, size, life, color, rise = 0.5) { puffAt(pos, size, life, color, rise); },
    puffWind(pos, size, life, color, vx, vz) {
      const o = puffAt(pos, size, life, color, 0.6);
      bbData[o + 3] = vx; bbData[o + 5] = vz; bbData[o + 13] = 0.4;
    },
    throwGrenade(from, to, dur = 0.75, arc = 1.2) {
      const g = grenades.find((x) => !x.active) || grenades[0];
      g.a.copy(from); g.b.copy(to); g.t = 0; g.dur = dur; g.arc = arc; g.active = true;
      g.m.visible = true; g.m.position.copy(from);
    },
    update(dt) {
      // tracers
      {
        const d = trData, A = tr.attrs.iA.array, D = tr.attrs.iD.array, Sv = tr.attrs.iS.array;
        let n = trN;
        for (let i = 0; i < n;) {
          const o = i * TRS;
          d[o + 8] += dt;
          const len = d[o + 6];
          const head = Math.min(len, d[o + 8] * TRACER_SPEED);
          const tail = Math.max(0, head - d[o + 7]);
          if (tail >= len - 0.01) {
            n--;
            if (i !== n) d.copyWithin(o, n * TRS, n * TRS + TRS);
            continue;
          }
          const p3 = i * 3, p4 = i * 4;
          A[p3] = d[o]; A[p3 + 1] = d[o + 1]; A[p3 + 2] = d[o + 2];
          D[p3] = d[o + 3]; D[p3 + 1] = d[o + 4]; D[p3 + 2] = d[o + 5];
          Sv[p4] = tail; Sv[p4 + 1] = Math.max(head, tail + 0.05); Sv[p4 + 2] = 0.22; Sv[p4 + 3] = 1;
          i++;
        }
        trN = n;
        if (trWrap >= n) trWrap = 0;
        tr.geo.instanceCount = n;
        if (n) { flushAttr(tr.attrs.iA, n); flushAttr(tr.attrs.iD, n); flushAttr(tr.attrs.iS, n); }
        trMesh.visible = n > 0;
      }
      // puffs and flashes
      {
        const d = bbData, Pv = bb.attrs.iP.array, C = bb.attrs.iC.array, Rv = bb.attrs.iR.array;
        let n = bbN;
        for (let i = 0; i < n;) {
          const o = i * BBS;
          d[o + 6] += dt;
          const k = d[o + 6] / d[o + 7];
          if (k >= 1) {
            n--;
            if (i !== n) d.copyWithin(o, n * BBS, n * BBS + BBS);
            continue;
          }
          let size, alpha;
          if (d[o + 15] > 0.5) { size = d[o + 8]; alpha = d[o + 13]; }
          else {
            d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
            d[o + 4] *= 1 - dt * 1.5;
            size = lerp(d[o + 8], d[o + 9], 1 - (1 - k) * (1 - k));
            alpha = d[o + 13] * (1 - k) * Math.min(1, k * 8);
          }
          const p4 = i * 4, p2 = i * 2;
          Pv[p4] = d[o]; Pv[p4 + 1] = d[o + 1]; Pv[p4 + 2] = d[o + 2]; Pv[p4 + 3] = size;
          C[p4] = d[o + 10]; C[p4 + 1] = d[o + 11]; C[p4 + 2] = d[o + 12]; C[p4 + 3] = alpha;
          Rv[p2] = d[o + 14]; Rv[p2 + 1] = d[o + 15];
          i++;
        }
        bbN = n;
        if (bbWrap >= n) bbWrap = 0;
        bb.geo.instanceCount = n;
        if (n) { flushAttr(bb.attrs.iP, n); flushAttr(bb.attrs.iC, n); flushAttr(bb.attrs.iR, n); }
        bbMesh.visible = n > 0;
      }
      // muzzle light: runs after weapons.update, so it only takes the shared light when it
      // is brighter than what weapons.js set this frame, and hands it back afterwards
      if (light) {
        if (lightT > 0) {
          lightT -= dt;
          const I = LIGHT_I * clamp(lightT / 0.05 + 0.35, 0, 1);
          if (light.intensity <= I || light.intensity === lightSet) {
            light.position.copy(lightPos);
            light.intensity = I; light.distance = LIGHT_RANGE;
            light.color.setHex(0xffb060);
            lightSet = I;
          }
        } else if (lightSet >= 0) {
          if (light.intensity === lightSet) light.intensity = 0;
          lightSet = -1;
        }
      }
      // grenades
      for (let i = 0; i < grenades.length; i++) {
        const g = grenades[i];
        if (!g.active) continue;
        g.t += dt;
        const k = Math.min(1, g.t / g.dur);
        g.m.position.lerpVectors(g.a, g.b, k);
        g.m.position.y += Math.sin(k * Math.PI) * g.arc;
        g.m.rotation.x += dt * 9; g.m.rotation.z += dt * 5;
        if (k >= 1) { g.active = false; g.m.visible = false; }
      }
    },
    get tracerCount() { return trN; },
    get billboardCount() { return bbN; },
  };
}

// ---------------------------------------------------------------------------
// UH-1 Huey
// ---------------------------------------------------------------------------

function linTint(hex, texMean = 0.5) {
  const c = new THREE.Color(hex);
  return [c.r / texMean, c.g / texMean, c.b / texMean];
}

function buildLoft(sections, ringN) {
  const pos = [], uv = [], idx = [];
  const S = sections.length;
  for (let s = 0; s < S; s++) {
    const sec = sections[s];
    const hw = sec.w / 2, hh = (sec.yt - sec.yb) / 2, yc = (sec.yt + sec.yb) / 2;
    const ex = 2 / (sec.n || 3.2);
    for (let k = 0; k <= ringN; k++) {
      const a = (k / ringN) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(hw * Math.sign(c) * Math.pow(Math.abs(c), ex), yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), ex), sec.z);
      uv.push(k / ringN, s / (S - 1));
    }
  }
  const rn = ringN + 1;
  for (let s = 0; s < S - 1; s++) for (let k = 0; k < ringN; k++) {
    const a = s * rn + k, b = a + 1, c = a + rn, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // end caps
  for (const s of [0, S - 1]) {
    const sec = sections[s];
    const ci = pos.length / 3;
    pos.push(0, (sec.yt + sec.yb) / 2, sec.z + (s === 0 ? 0.05 : -0.02));
    uv.push(0.5, s / (S - 1));
    for (let k = 0; k < ringN; k++) {
      const a = s * rn + k;
      if (s === 0) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outward (side vertex normal should point +x)
  const n = g.attributes.normal;
  const test = Math.floor(S / 2) * rn;
  if (n.getX(test) < 0) { flipGeo(g); }
  return g;
}

// Split a smooth loft into body / glass / dark-interior pieces by face centroid.
function splitLoft(g, classify) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, idx = g.index.array;
  const out = [{ p: [], n: [], u: [] }, { p: [], n: [], u: [] }, { p: [], n: [], u: [] }];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const cls = classify(cx, cy, cz);
    const o = out[cls];
    const off = cls === 1 ? 0.012 : cls === 2 ? -0.004 : 0;
    for (const v of [a, b, c]) {
      o.p.push(pos.getX(v) + nrm.getX(v) * off, pos.getY(v) + nrm.getY(v) * off, pos.getZ(v) + nrm.getZ(v) * off);
      o.n.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
      o.u.push(uv.getX(v), uv.getY(v));
    }
  }
  return out.map((o) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
    return geo;
  });
}

function buildHuey() {
  const tex = canvasTexture(256, 256, (g) => {
    const r = rand(1965);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 100 + r() * 60 | 0;
      g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    g.strokeStyle = 'rgba(30,30,30,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const x = r() * 256 | 0; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let i = 0; i < 5; i++) { const y = r() * 256 | 0; g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.fillStyle = 'rgba(40,40,40,0.5)';
    for (let i = 0; i < 160; i++) g.fillRect(r() * 256, r() * 256, 1.2, 1.2);
    for (let i = 0; i < 14; i++) {
      const x = r() * 256, y = r() * 256, l = 20 + r() * 70;
      const gr = g.createLinearGradient(x, y, x, y + l);
      gr.addColorStop(0, 'rgba(50,45,35,0.35)'); gr.addColorStop(1, 'rgba(50,45,35,0)');
      g.fillStyle = gr; g.fillRect(x, y, 4 + r() * 8, l);
    }
  });
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.78, metalness: 0.12 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2a2c, roughness: 0.1, metalness: 0.35 });

  const OD = linTint(0x3c4129, 0.22);
  const OD_DARK = linTint(0x2c3020, 0.22);
  const BLACK = linTint(0x101110, 0.22);
  const INSIDE = linTint(0x0b0c0a, 0.22);
  const METAL = linTint(0x3a3a36, 0.22);
  const parts = [];
  const add = (geo, tint) => parts.push(prep(geo, -1, tint, -1));

  const loft = buildLoft([
    { z: 2.78, w: 0.3, yb: 1.12, yt: 1.42 },
    { z: 2.62, w: 0.95, yb: 0.76, yt: 1.86 },
    { z: 2.38, w: 1.62, yb: 0.56, yt: 2.16 },
    { z: 2.02, w: 2.12, yb: 0.46, yt: 2.36 },
    { z: 1.5, w: 2.42, yb: 0.41, yt: 2.46 },
    { z: 0.8, w: 2.5, yb: 0.4, yt: 2.5 },
    { z: -0.4, w: 2.5, yb: 0.4, yt: 2.52 },
    { z: -1.6, w: 2.5, yb: 0.42, yt: 2.52 },
    { z: -2.2, w: 2.3, yb: 0.52, yt: 2.48 },
    { z: -2.8, w: 1.7, yb: 0.82, yt: 2.38 },
    { z: -3.35, w: 1.05, yb: 1.36, yt: 2.26 },
    { z: -3.75, w: 0.78, yb: 1.56, yt: 2.2 },
  ], 32);
  const [lBody, lGlass, lDark] = splitLoft(loft, (x, y, z) => {
    const ax = Math.abs(x);
    if (z > 1.72 && y > 1.28) return 1;                          // windshield
    if (z > 2.05 && y < 0.98 && ax < 0.75) return 1;              // chin bubbles
    if (ax > 1.05 && z > 1.0 && z < 1.68 && y > 1.32 && y < 2.2) return 1; // pilot door window
    if (ax > 1.05 && z > -1.45 && z < 0.95 && y > 0.58 && y < 2.18) return 2; // open cargo doors
    return 0;
  });
  loft.dispose();
  add(lBody, OD);
  add(lDark, INSIDE);
  // window frames
  add(box(0.05, 1.0, 0.05).translate(0, 1.82, 2.2).rotateX(0), OD_DARK);
  // cabin floor lip and door posts
  for (const s of [1, -1]) {
    add(X(box(0.06, 1.6, 0.06), 1.24 * s, 1.38, 0.97), OD);
    add(X(box(0.06, 1.6, 0.06), 1.24 * s, 1.38, -1.47), OD);
    add(X(box(0.08, 0.05, 2.45), 1.23 * s, 0.58, -0.25), OD_DARK);
    add(X(box(0.03, 0.03, 2.4), 1.26 * s, 2.15, -0.25), METAL);
  }
  // seats and pilots' backs visible through the glass
  for (const s of [1, -1]) add(X(box(0.5, 0.7, 0.12), 0.5 * s, 1.0, 1.25), BLACK);
  // tail boom, fin, elevators, tail skid
  add(X(cyl(0.38, 0.22, 5.9, 14), 0, 1.92, -6.65, Math.PI / 2 + 0.03), OD);
  add(X(taperBox(0.09, 1.55, 0.95, 0.7, 0.6), 0, 2.55, -9.3, -0.38), OD);
  add(X(box(2.1, 0.045, 0.42), 0, 1.96, -6.35), OD_DARK);
  add(tubeBetween(0, 1.35, -9.4, 0, 1.05, -9.7, 0.025, 5), METAL);
  // engine, transmission fairing, exhaust, mast
  add(X(taperBox(1.05, 0.6, 2.5, 0.8, 0.95), 0, 2.78, -1.25), OD);
  add(X(box(0.9, 0.3, 0.6), 0, 2.62, 0.4), OD);
  add(X(cyl(0.22, 0.25, 0.55, 12), 0, 2.86, -2.75, Math.PI / 2), BLACK);
  add(X(cyl(0.09, 0.11, 0.65, 10), 0, 3.15, 0.15), METAL);
  for (const s of [1, -1]) add(X(box(0.02, 0.24, 1.0), 0.5 * s, 2.78, -1.4), BLACK);
  // skids
  for (const s of [1, -1]) {
    add(X(cyl(0.045, 0.045, 3.7, 8), 1.22 * s, 0.05, 0.05, Math.PI / 2), METAL);
    add(tubeBetween(1.22 * s, 0.05, 1.9, 1.22 * s, 0.32, 2.3, 0.045, 8), METAL);
    for (const z of [1.0, -1.05]) {
      add(tubeBetween(1.22 * s, 0.05, z, 1.1 * s, 0.36, z, 0.05, 8), METAL);
      add(tubeBetween(1.1 * s, 0.36, z, 0.72 * s, 0.46, z, 0.05, 8), METAL);
    }
  }
  // door guns (M60) on the rear posts
  for (const s of [1, -1]) {
    add(X(box(0.5, 0.07, 0.06), 1.48 * s, 1.35, -1.55), BLACK);
    add(X(cyl(0.012, 0.012, 0.45, 6), 1.9 * s, 1.37, -1.55, 0, 0, Math.PI / 2), BLACK);
    add(X(box(0.1, 0.1, 0.16), 1.28 * s, 1.24, -1.55), OD_DARK);
  }
  // antenna, steps
  add(X(cyl(0.008, 0.008, 0.7, 4), 0, 2.85, 1.2, -0.6), BLACK);
  for (const s of [1, -1]) add(X(box(0.12, 0.03, 0.3), 1.27 * s, 0.38, 1.4), METAL);

  const body = new THREE.Mesh(mergeGeometries(parts, false), bodyMat);
  for (const p of parts) p.dispose();
  body.castShadow = true;
  const glass = new THREE.Mesh(lGlass, glassMat);

  // tail boom lettering
  const letters = canvasTexture(256, 48, (g) => {
    g.clearRect(0, 0, 256, 48);
    g.fillStyle = 'rgba(12,12,10,0.92)';
    g.font = 'bold 34px Arial, Helvetica, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('U.S. ARMY', 128, 26);
  }, { repeat: false });
  const decalMat = new THREE.MeshStandardMaterial({ map: letters, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const decals = [];
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.32), decalMat);
    m.position.set(0.335 * s, 1.93, -5.4);
    m.rotation.y = s * Math.PI / 2;
    decals.push(m);
  }

  // rotors
  const rotorParts = [];
  const addR = (geo, tint) => rotorParts.push(prep(geo, -1, tint, -1));
  addR(box(14.6, 0.05, 0.53), linTint(0x1a1b19, 0.22));
  addR(X(box(0.35, 0.052, 0.535), 7.1, 0, 0), linTint(0x8a7a30, 0.22));
  addR(X(box(0.35, 0.052, 0.535), -7.1, 0, 0), linTint(0x8a7a30, 0.22));
  addR(X(cyl(0.02, 0.02, 2.6, 5), 0, 0.12, 0, Math.PI / 2), METAL);
  addR(X(cyl(0.06, 0.06, 0.25, 8), 0, 0.12, 1.3, Math.PI / 2), METAL);
  addR(X(cyl(0.06, 0.06, 0.25, 8), 0, 0.12, -1.3, Math.PI / 2), METAL);
  addR(X(cyl(0.14, 0.14, 0.25, 10), 0, 0, 0), METAL);
  const mainRotor = new THREE.Mesh(mergeGeometries(rotorParts, false), bodyMat);
  for (const p of rotorParts) p.dispose();
  mainRotor.position.set(0, 3.52, 0.15);
  mainRotor.castShadow = true;

  const tailParts = [prep(box(0.04, 2.6, 0.2), -1, linTint(0x1a1b19, 0.22), -1), prep(X(cyl(0.07, 0.07, 0.12, 8), 0, 0, 0, 0, 0, Math.PI / 2), -1, METAL, -1)];
  const tailRotor = new THREE.Mesh(mergeGeometries(tailParts, false), bodyMat);
  for (const p of tailParts) p.dispose();
  tailRotor.position.set(0.14, 2.58, -9.42);

  const discTex = canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(20,20,18,0)');
    gr.addColorStop(0.15, 'rgba(20,20,18,0.35)');
    gr.addColorStop(0.9, 'rgba(25,25,22,0.5)');
    gr.addColorStop(0.95, 'rgba(120,110,60,0.45)');
    gr.addColorStop(1, 'rgba(20,20,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }, { repeat: false });
  const discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.5 });
  const mainDisc = new THREE.Mesh(new THREE.CircleGeometry(7.3, 40).rotateX(-Math.PI / 2), discMat);
  mainDisc.position.set(0, 3.54, 0.15);
  const tailDisc = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24).rotateY(Math.PI / 2), discMat);
  tailDisc.position.copy(tailRotor.position);

  const group = new THREE.Group();
  group.name = 'uh1';
  group.rotation.order = 'YXZ';
  group.add(body, glass, mainRotor, tailRotor, mainDisc, tailDisc, ...decals);
  return { group, mainRotor, tailRotor, mainDisc, tailDisc };
}

// ---------------------------------------------------------------------------
// Searchlight
// ---------------------------------------------------------------------------

function buildSearchlight(scene, withStand) {
  const group = new THREE.Group();
  group.name = 'searchlight';
  const parts = [];
  const tint = linTint(0x3a3f2a, 0.5);
  const add = (geo, t) => parts.push(prep(geo, -1, t, -1));
  if (withStand) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      add(tubeBetween(Math.cos(a) * 0.7, -2.4, Math.sin(a) * 0.7, 0, -0.35, 0, 0.035, 5), tint);
    }
    add(X(cyl(0.05, 0.05, 0.4, 6), 0, -0.2, 0), tint);
  } else {
    add(X(cyl(0.05, 0.07, 0.7, 6), 0, -0.4, 0), tint);
  }
  add(X(box(0.5, 0.06, 0.08), 0, -0.05, 0), tint);
  const baseMesh = new THREE.Mesh(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  for (const p of parts) p.dispose();
  group.add(baseMesh);

  const head = new THREE.Group();
  const hParts = [prep(X(cyl(0.24, 0.22, 0.5, 14), 0, 0, 0, Math.PI / 2), -1, tint, -1),
    prep(X(cyl(0.255, 0.255, 0.05, 14, true), 0, 0, 0.25, Math.PI / 2), -1, linTint(0x202018, 0.5), -1)];
  const headMesh = new THREE.Mesh(mergeGeometries(hParts, false), baseMesh.material);
  for (const p of hParts) p.dispose();
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.21, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.2) }));
  lens.position.z = 0.252;
  head.add(headMesh, lens);
  group.add(head);

  const glowTex = canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,248,225,0.9)'); gr.addColorStop(0.3, 'rgba(255,236,190,0.3)'); gr.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, { repeat: false });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(2.2, 2.2, 2.2);
  glow.position.z = 0.4;
  head.add(glow);

  const L = 72, ANG = 0.15;
  const beamGeo = new THREE.CylinderGeometry(0.22, Math.tan(ANG) * L, L, 24, 1, true);
  beamGeo.translate(0, -L / 2, 0);
  beamGeo.rotateX(-Math.PI / 2);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.93, 0.78) }, uI: { value: 0.11 } },
    vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){ vAlong = 1.0 - uv.y; vec4 wp = modelMatrix * vec4(position,1.0);
      vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float a = uI * pow(f, 1.6) * pow(1.0 - vAlong, 1.3) * smoothstep(0.0, 0.04, vAlong);
      gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 4;

  const spot = new THREE.SpotLight(0xfff0d8, 260, 115, ANG * 1.15, 0.45, 1.3);
  spot.castShadow = false;
  scene.add(spot, spot.target, beam, group);
  return { group, head, beam, spot, angle: ANG, length: L, aim: new THREE.Vector3(), lampPos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), yaw: 0, pitch: -0.3 };
}

// ---------------------------------------------------------------------------
// Enemy (AI state around a Soldier)
// ---------------------------------------------------------------------------

let ENEMY_ID = 0;

class Enemy {
  constructor(sys, soldier, role) {
    this.id = ++ENEMY_ID;
    this.sys = sys;
    this.soldier = soldier;
    this.group = soldier.group;
    this.position = soldier.group.position;
    this.yaw = 0;
    this.health = 100;
    this.alive = true;
    this.state = 'patrol';
    this.role = role;
    this.squad = null;
    this.slot = 0;
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.hasTarget = false;
    this.speedWanted = 0;
    this.arrive = 0.8;
    this.faceMode = 'move';
    this.faceYaw = 0;
    this.facePoint = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.awareness = 0;
    this.glimpse = new THREE.Vector3();
    this.glimpseT = -999;
    this.lastSeenT = -999;
    this.lastVisionT = 0;
    this.nextVisionT = Math.random() * 0.3;
    this.exposure = 0;
    this.suppress = 0;
    this.suspT = 0;
    this.suspPos = new THREE.Vector3();
    this.cover = { valid: false, ix: 0, iz: 0, hx: 0, hz: 0, px: 0, pz: 0, low: false, item: null, brush: false };
    this.atCover = false;
    this.peeking = false;
    this.peekT = 0;
    this.coverSearchT = 0;
    this.reaction = 0;
    this.burstLeft = 0;
    this.shotT = 0;
    this.fireCd = rnd(0.5, 1.5);
    this.mag = 14 + ((Math.random() * 5) | 0);
    this.reloadT = 0;
    this.hasToken = false;
    this.lastShotT = -99;
    this.task = null;
    this.taskT = 0;
    this.taskPt = new THREE.Vector3();
    this.taskHatch = null;
    this.taskFlag = false;
    this.home = new THREE.Vector3();
    this.homeYaw = 0;
    this.leashR = Infinity;
    this.searchPt = new THREE.Vector3();
    this.searchPause = 0;
    this.hasSearchPt = false;
    this.idleT = rnd(1, 6);
    this.thinkAcc = 0;
    this.animAcc = 0;
    this.dist = 999;
    this.stuckT = 0;
    this.sidestepT = 0;
    this.sidestepDir = 1;
    this.progressPos = new THREE.Vector3();
    this.progressT = 0;
    this.fixedY = null;
    this.static = false;
    this.visionMul = 1;
    this.deadT = 0;
    this.shoutT = 0;
    this.riding = null;
    this.seat = null;
    this.fling = null;
    this.hatchCheckT = 0;
    this.taskStage = 0;
    this.thrown = false;
    this.hatchLob = false;      // wall guard lobbing over the sandbags instead of walking up
    this.hatchThrowing = false; // reached throwing distance, winding up
    this.hatchBestD = Infinity; // closest approach so far (stall watch)
    this.hatchStallT = 0;
    this.hatchWind = 0.9;       // s from reaching the hatch to letting the grenade go
    this.gateLeg = 0;           // 0 free, 2 committed to passing through the firebase gate
    this.gateOut = false;       // gate passage direction: true = leaving the base
    this.wallAngle = 0;
    this.coverMoveT = 0;
    this.badCover = null;
    this.lod = 0;
    this.lookPhase = Math.random() * 10;
    this.inView = true;
    this.hitboxes = soldier.hitboxes;
    for (const h of this.hitboxes) h.userData.enemy = this;
  }
  damage(amount, part = 'body', fromPos = null, opts = null) { this.sys.damageEnemy(this, amount, part, fromPos, opts); }
  get knowsPlayer() { return this.alive && this.sys.now - this.lastSeenT < 8; }
  get crouching() { return this.soldier.anim.crouch > 0.5; }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEnemies(ctx) {
  const scene = ctx.scene;
  const ev = ctx.events || sharedEvents;
  const kit = createSoldierKit(ctx);
  // Enemy muzzle flashes light the scene through the weapons module's pooled fx light
  // (one light for every muzzle flash and explosion) rather than adding their own.
  let sharedFxLight = null;
  try {
    const wl = ctx.weapons?.fxLight;
    sharedFxLight = wl && wl.isLight ? wl : scene?.getObjectByName?.('weaponsFxLight') || null;
    if (sharedFxLight && !sharedFxLight.isPointLight) sharedFxLight = null;
  } catch (e) { sharedFxLight = null; }
  const fx = scene ? createFx(scene, ctx.camera, sharedFxLight) : null;
  const list = [];
  const hitboxes = [];
  const squads = [];
  const sys = { now: 0, damageEnemy: null };
  let T = 0, frame = 0;
  let rr = 0;
  let rayBudget = RAY_BUDGET;
  let tokens = 0;
  let over = false;
  let dumpDown = false;
  let heli = null;
  let hueyModel = null;
  const troopPool = [];
  let heliPending = -1;
  let respawnQueue = [];
  let lastShoutT = -10;
  let alertShown = 0;
  let alertHold = 0;
  let alertCandidate = 0;
  let searchlight = null;
  let sentry = null;
  let garrisonSquad = null;
  let gridCheckT = 0;
  let gridCount = -1;
  let losRefreshT = 10;
  let losMeshes = [];
  const rng = rand(((ctx.debug && Number(ctx.debug.seed)) || 1968) + 77);

  // -------------------------------------------------------------------------
  // World access (defensive)
  // -------------------------------------------------------------------------

  function heightAt(x, z) {
    const w = ctx.world;
    if (w && typeof w.heightAt === 'function') { const h = w.heightAt(x, z); if (Number.isFinite(h)) return h; }
    return 0;
  }
  function isWater(x, z) { const w = ctx.world; return !!(w && typeof w.isWater === 'function' && w.isWater(x, z)); }
  function waterLevel() { const l = ctx.world?.waterLevel; return Number.isFinite(l) ? l : -1e9; }
  function deepWater(x, z) { return isWater(x, z) && heightAt(x, z) < waterLevel() - 1.15; }
  function coverAt(x, z) { const w = ctx.world; if (w && typeof w.coverAt === 'function') { const c = w.coverAt(x, z); if (Number.isFinite(c)) return clamp(c, 0, 1); } return 0; }

  const FB = new THREE.Vector3(WORLD.firebase.x, 0, WORLD.firebase.z);
  const DUMP = new THREE.Vector3(WORLD.ammoDump.x, 0, WORLD.ammoDump.z);
  const CAMP = new THREE.Vector3(WORLD.playerStart.x, 0, WORLD.playerStart.z);
  const LZ = new THREE.Vector3();
  let wallR = WORLD.firebase.radius - 2;
  let walled = false;
  let gate = null; // {angle, inner: Vector3, outer: Vector3}

  function initWorldRefs() {
    const wf = ctx.world?.firebase;
    const c = wf?.center;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) FB.set(c.x, 0, c.z);
    try {
      const dm = wf?.dumpMesh;
      if (dm && dm.isObject3D) {
        dm.updateWorldMatrix(true, false);
        dm.getWorldPosition(_v1);
        if (Math.hypot(_v1.x - FB.x, _v1.z - FB.z) < 30) DUMP.set(_v1.x, 0, _v1.z);
      }
    } catch (e) { /* keep default */ }
    FB.y = heightAt(FB.x, FB.z);
    DUMP.y = heightAt(DUMP.x, DUMP.z);
    CAMP.y = heightAt(CAMP.x, CAMP.z);
  }

  // -------------------------------------------------------------------------
  // Collision grid from world colliders
  // -------------------------------------------------------------------------

  const grid = new Grid(8);
  const _items = [];
  const _items2 = [];

  function rebuildGrid() {
    grid.clear();
    const w = ctx.world;
    const circles = Array.isArray(w?.colliders) ? w.colliders : [];
    const boxes = Array.isArray(w?.boxColliders) ? w.boxColliders : [];
    for (const c of circles) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z) || !(c.r > 0)) continue;
      const base = heightAt(c.x, c.z);
      const inFB = Math.hypot(c.x - FB.x, c.z - FB.z) < WORLD.firebase.radius + 10;
      let h;
      if (Number.isFinite(c.h)) h = c.h;
      else if (Number.isFinite(c.height)) h = c.height;
      else if (inFB) h = c.r < 1.8 ? 1.35 : 2.6;
      else h = c.r <= 1.8 ? 25 : 4;
      grid.insert({ kind: 0, x: c.x, z: c.z, r: c.r, minx: c.x - c.r, maxx: c.x + c.r, minz: c.z - c.r, maxz: c.z + c.r, top: base + h, base, low: h < 1.7, fb: inFB, s: 0 });
    }
    for (const b of boxes) {
      const mn = b?.min, mx = b?.max;
      if (!mn || !mx || !Number.isFinite(mn.x) || !Number.isFinite(mx.x)) continue;
      if (mx.x - mn.x > 80 || mx.z - mn.z > 80) continue;
      const base = heightAt((mn.x + mx.x) / 2, (mn.z + mx.z) / 2);
      const miny = Number.isFinite(mn.y) ? mn.y : base - 1;
      const maxy = Number.isFinite(mx.y) ? mx.y : base + 2;
      grid.insert({ kind: 1, minx: mn.x, maxx: mx.x, minz: mn.z, maxz: mx.z, miny, maxy, x: (mn.x + mx.x) / 2, z: (mn.z + mx.z) / 2, r: 0, top: maxy, base, low: maxy - base < 1.7, fb: Math.hypot((mn.x + mx.x) / 2 - FB.x, (mn.z + mx.z) / 2 - FB.z) < WORLD.firebase.radius + 10, s: 0 });
    }
    gridCount = circles.length + boxes.length;
  }

  function refreshLosMeshes() {
    losMeshes = [];
    const arr = ctx.world?.raycastMeshes;
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      if (!m || !m.isMesh || !m.geometry) continue;
      if (/terrain|ground|water|river|paddy|sky/i.test(m.name || '')) continue;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) continue;
      const tris = (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
      m.updateWorldMatrix?.(true, false);
      const sc = m.matrixWorld.getMaxScaleOnAxis();
      const rad = g.boundingSphere.radius * sc;
      if (rad > 90) continue;
      if (tris > 6000 && rad > 25) continue;
      if (m.isInstancedMesh && m.count > 150) continue;
      losMeshes.push(m);
      if (losMeshes.length >= 160) break;
    }
  }

  const ray = new THREE.Raycaster();
  const _hits = [];
  function losClear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.5) return true;
    const steps = Math.ceil(dist / 2.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (heightAt(a.x + dx * t, a.z + dz * t) > a.y + dy * t + 0.05) return false;
    }
    if (grid.segmentBlocked(a.x, a.y, a.z, b.x, b.y, b.z)) return false;
    if (losMeshes.length) {
      _v9.set(dx / dist, dy / dist, dz / dist);
      ray.set(a, _v9);
      ray.near = 0.4; ray.far = dist - 0.6;
      _hits.length = 0;
      ray.intersectObjects(losMeshes, false, _hits);
      const blocked = _hits.length > 0;
      _hits.length = 0;
      if (blocked) return false;
    }
    return true;
  }

  function insideCollider(x, z, rad) {
    grid.query(x - rad, z - rad, x + rad, z + rad, _items2);
    for (const it of _items2) {
      if (it.kind === 0) { const dx = x - it.x, dz = z - it.z, rr2 = it.r + rad; if (dx * dx + dz * dz < rr2 * rr2) return true; }
      else if (x > it.minx - rad && x < it.maxx + rad && z > it.minz - rad && z < it.maxz + rad && it.maxy > it.base + 0.4) return true;
    }
    return false;
  }

  function collide(p, rad, y) {
    grid.query(p.x - rad - 0.5, p.z - rad - 0.5, p.x + rad + 0.5, p.z + rad + 0.5, _items);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < _items.length; i++) {
        const it = _items[i];
        if (it.kind === 0) {
          const dx = p.x - it.x, dz = p.z - it.z, rr2 = it.r + rad;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr2 * rr2) {
            const d = Math.sqrt(d2) || 1e-4;
            const push = rr2 - d;
            p.x += (dx / d) * push; p.z += (dz / d) * push;
          }
        } else {
          if (it.maxy < y + 0.35 || it.miny > y + 1.7) continue;
          const cx = clamp(p.x, it.minx, it.maxx), cz = clamp(p.z, it.minz, it.maxz);
          const dx = p.x - cx, dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 1e-8) {
            if (d2 < rad * rad) { const d = Math.sqrt(d2); p.x += (dx / d) * (rad - d); p.z += (dz / d) * (rad - d); }
          } else {
            // inside: leave by the nearest face
            const l = p.x - it.minx, r = it.maxx - p.x, b = p.z - it.minz, f = it.maxz - p.z;
            const m = Math.min(l, r, b, f);
            if (m === l) p.x = it.minx - rad; else if (m === r) p.x = it.maxx + rad; else if (m === b) p.z = it.minz - rad; else p.z = it.maxz + rad;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Firebase layout discovery (wall ring, gate, tower, helipad)
  // -------------------------------------------------------------------------

  function detectWall() {
    const bins = new Float32Array(40);
    for (const it of grid.items) {
      const d = Math.hypot(it.x - FB.x, it.z - FB.z);
      if (d < 16 || d >= 16 + 40 * 1.2) continue;
      const w = it.kind === 0 ? Math.min(it.r * 2, 4) : Math.min(Math.max(it.maxx - it.minx, it.maxz - it.minz), 12);
      bins[Math.floor((d - 16) / 1.2)] += w;
    }
    let best = -1, bv = 0;
    for (let i = 0; i < bins.length; i++) {
      const v = bins[i] + (i > 0 ? bins[i - 1] * 0.5 : 0) + (i < bins.length - 1 ? bins[i + 1] * 0.5 : 0);
      if (v > bv) { bv = v; best = i; }
    }
    if (best >= 0 && bv > 25) { wallR = 16 + (best + 0.5) * 1.2; walled = true; }
    else { wallR = WORLD.firebase.radius - 2; walled = false; }
    gate = null;
    if (!walled) return;
    const N = 180;
    const free = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      let ok = true;
      for (const rr2 of [wallR - 1.2, wallR, wallR + 1.2]) {
        if (insideCollider(FB.x + Math.cos(a) * rr2, FB.z + Math.sin(a) * rr2, 0.45)) { ok = false; break; }
      }
      free[i] = ok ? 1 : 0;
    }
    let freeCount = 0;
    for (let i = 0; i < N; i++) freeCount += free[i];
    if (freeCount > N * 0.6 || freeCount === 0) { if (freeCount > N * 0.6) walled = false; return; }
    let bestLen = 0, bestStart = 0;
    for (let i = 0; i < N; i++) {
      if (!free[i] || free[(i + N - 1) % N]) continue;
      let l = 0;
      while (l < N && free[(i + l) % N]) l++;
      if (l > bestLen) { bestLen = l; bestStart = i; }
    }
    const arc = (bestLen / N) * TAU * wallR;
    if (arc < 2.5) return;
    const a = ((bestStart + bestLen / 2) / N) * TAU;
    gate = {
      angle: a,
      inner: new THREE.Vector3(FB.x + Math.cos(a) * (wallR - 4.5), 0, FB.z + Math.sin(a) * (wallR - 4.5)),
      outer: new THREE.Vector3(FB.x + Math.cos(a) * (wallR + 5), 0, FB.z + Math.sin(a) * (wallR + 5)),
    };
  }

  function findNamed(re) {
    let found = null;
    scene?.traverse?.((o) => { if (!found && o !== scene && re.test(o.name || '')) found = o; });
    return found;
  }

  function vecFrom(o) {
    if (!o) return null;
    if (o.isObject3D) { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); }
    if (Number.isFinite(o.x) && Number.isFinite(o.z)) return new THREE.Vector3(o.x, Number.isFinite(o.y) ? o.y : NaN, o.z);
    return null;
  }

  // -> {pos: Vector3 (platform floor), found: bool}
  function findTower() {
    const wf = ctx.world?.firebase || {};
    const top = vecFrom(wf.towerTop || wf.towerPlatform);
    if (top && Number.isFinite(top.y)) return { pos: top, found: true };
    let obj = wf.tower?.isObject3D ? wf.tower : wf.watchtower?.isObject3D ? wf.watchtower : null;
    if (!obj) obj = findNamed(/watch\s*tower|watchtower|guard\s*tower|^tower/i);
    if (!obj && wf.tower && Number.isFinite(wf.tower.x)) {
      const p = vecFrom(wf.tower);
      return { pos: new THREE.Vector3(p.x, heightAt(p.x, p.z) + (Number.isFinite(wf.tower.height) ? wf.tower.height : 6), p.z), found: true };
    }
    if (!obj) return { pos: null, found: false };
    obj.updateWorldMatrix(true, true);
    const bb = new THREE.Box3().setFromObject(obj);
    if (bb.isEmpty()) return { pos: null, found: false };
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const heights = [];
    const rc = new THREE.Raycaster();
    const offs = [[0, 0], [0.5, 0.3], [-0.4, -0.5], [0.3, -0.6], [-0.6, 0.4]];
    for (const [ox, oz] of offs) {
      rc.set(new THREE.Vector3(cx + ox, bb.max.y + 1, cz + oz), V_DOWN);
      const hits = rc.intersectObject(obj, true);
      for (const h of hits) {
        if (!h.face) continue;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y > 0.6 && h.point.y > bb.min.y + 2) heights.push(h.point.y);
      }
    }
    heights.sort((a, b) => b - a);
    const uniq = [];
    for (const h of heights) if (!uniq.length || uniq[uniq.length - 1] - h > 0.35) uniq.push(h);
    let y;
    if (uniq.length >= 2 && uniq[0] - uniq[1] > 1.8) y = uniq[1];
    else if (uniq.length) y = uniq[0];
    else y = bb.max.y - Math.min(2.2, (bb.max.y - bb.min.y) * 0.3);
    return { pos: new THREE.Vector3(cx, y, cz), found: true };
  }

  function findLZ() {
    const wf = ctx.world?.firebase || {};
    let p = vecFrom(wf.helipad || wf.helipadPos || wf.lz);
    if (!p) { const o = findNamed(/heli\s*pad|helipad|landing\s*zone/i); if (o) p = vecFrom(o); }
    if (p) { LZ.set(p.x, heightAt(p.x, p.z), p.z); return; }
    // search for a clear flat spot near the firebase, preferring the gate side
    let best = null, bestScore = Infinity;
    const prefA = gate ? gate.angle : Math.atan2(CAMP.z - FB.z, CAMP.x - FB.x) + Math.PI;
    for (const r of [wallR + 18, wallR + 26, wallR + 34, 16, 22]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        const x = FB.x + Math.cos(a) * r, z = FB.z + Math.sin(a) * r;
        if (Math.abs(x) > 225 || Math.abs(z) > 225 || isWater(x, z)) continue;
        if (insideCollider(x, z, 8)) continue;
        const h0 = heightAt(x, z);
        let slope = 0;
        for (let k = 0; k < 4; k++) slope = Math.max(slope, Math.abs(heightAt(x + Math.cos(k * 1.57) * 6, z + Math.sin(k * 1.57) * 6) - h0));
        if (slope > 2.2) continue;
        const score = slope * 6 + Math.abs(wrapAngle(a - prefA)) * 8 + r * 0.2;
        if (score < bestScore) { bestScore = score; best = [x, z]; }
      }
    }
    if (!best) best = [FB.x + Math.cos(prefA) * (wallR + 20), FB.z + Math.sin(prefA) * (wallR + 20)];
    LZ.set(best[0], heightAt(best[0], best[1]), best[1]);
  }

  function insideBase(x, z) { return walled && Math.hypot(x - FB.x, z - FB.z) < wallR - 0.6; }

  // -------------------------------------------------------------------------
  // Walkable points and routes
  // -------------------------------------------------------------------------

  function validPoint(x, z, allowBase) {
    if (Math.abs(x) > 228 || Math.abs(z) > 228) return false;
    if (isWater(x, z)) return false;
    if (!allowBase && Math.hypot(x - FB.x, z - FB.z) < wallR + 6) return false;
    if (insideCollider(x, z, 0.7)) return false;
    return true;
  }
  function fixPoint(x, z, out, allowBase = false, maxR = 44) {
    x = clamp(x, -226, 226); z = clamp(z, -226, 226);
    if (validPoint(x, z, allowBase)) return out.set(x, heightAt(x, z), z);
    for (let r = 3; r <= maxR; r += 3) {
      const n = Math.max(6, Math.round(r * 1.2));
      const a0 = rng() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (validPoint(px, pz, allowBase)) return out.set(px, heightAt(px, pz), pz);
      }
    }
    return null;
  }

  // River axis: NW -> SE. Trace water spans across it.
  const UAX = new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2);
  const VAX = new THREE.Vector2(Math.SQRT1_2, -Math.SQRT1_2); // camp side negative, firebase side positive
  const river = [];
  function traceRiver() {
    river.length = 0;
    for (let s = -300; s <= 300; s += 14) {
      let best = null;
      let runStart = null;
      for (let t = -170; t <= 172; t += 3) {
        const x = UAX.x * s + VAX.x * t, z = UAX.y * s + VAX.y * t;
        const inMap = Math.abs(x) < 232 && Math.abs(z) < 232;
        const wet = inMap && isWater(x, z);
        if (wet && runStart === null) runStart = t;
        if ((!wet || t >= 171) && runStart !== null) {
          const run = { a: runStart, b: t - 3 };
          if (run.b - run.a >= 3 && (!best || Math.abs((run.a + run.b) / 2) < Math.abs((best.a + best.b) / 2) || run.b - run.a > (best.b - best.a) * 2)) best = run;
          runStart = null;
        }
      }
      if (best) river.push({ s, a: best.a, b: best.b });
    }
  }
  function riverPoint(s, side, off, out) {
    // interpolate river span at axis coordinate s
    if (!river.length) return null;
    let lo = river[0], hi = river[river.length - 1];
    for (let i = 0; i < river.length - 1; i++) if (river[i].s <= s && river[i + 1].s >= s) { lo = river[i]; hi = river[i + 1]; break; }
    const k = hi.s === lo.s ? 0 : clamp((s - lo.s) / (hi.s - lo.s), 0, 1);
    const edge = side > 0 ? lerp(lo.b, hi.b, k) + off : lerp(lo.a, hi.a, k) - off;
    return out.set(UAX.x * s + VAX.x * edge, 0, UAX.y * s + VAX.y * edge);
  }

  function makeLoop(cx, cz, radius, n, jitter, allowBase = false) {
    const pts = [];
    const a0 = rng() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU;
      const r = radius * (1 + (rng() - 0.5) * jitter);
      const p = fixPoint(cx + Math.cos(a) * r, cz + Math.sin(a) * r, new THREE.Vector3(), allowBase);
      if (p) pts.push(p);
    }
    return pts;
  }

  function buildRoutes() {
    const routes = {};
    traceRiver();
    const tmp = new THREE.Vector3();
    // firebase-side river bank, out and back further from the water
    if (river.length > 4) {
      const out = [], back = [];
      for (let s = -150; s <= 150; s += 30) {
        if (riverPoint(s, 1, 9, tmp)) { const p = fixPoint(tmp.x, tmp.z, new THREE.Vector3()); if (p) out.push(p); }
      }
      for (let s = 150; s >= -150; s -= 37) {
        if (riverPoint(s, 1, 38, tmp)) { const p = fixPoint(tmp.x, tmp.z, new THREE.Vector3()); if (p) back.push(p); }
      }
      routes.riverFar = out.concat(back);
      // camp-side bank: the patrol that can stumble into the camp's jungle
      const out2 = [], back2 = [];
      for (let s = -40; s <= 170; s += 30) {
        if (riverPoint(s, -1, 9, tmp)) { const p = fixPoint(tmp.x, tmp.z, new THREE.Vector3()); if (p) out2.push(p); }
      }
      for (let s = 170; s >= -40; s -= 35) {
        if (riverPoint(s, -1, 34, tmp)) { const p = fixPoint(tmp.x, tmp.z, new THREE.Vector3()); if (p) back2.push(p); }
      }
      routes.riverNear = out2.concat(back2);
    }
    // fallbacks when there is no river data
    if (!routes.riverFar || routes.riverFar.length < 4) routes.riverFar = makeLoop(20, -40, 60, 8, 0.3);
    if (!routes.riverNear || routes.riverNear.length < 4) routes.riverNear = makeLoop(-60, 60, 50, 7, 0.3);
    // jungle loop on the firebase side, north-west
    const jx = UAX.x * -90 + VAX.x * 70, jz = UAX.y * -90 + VAX.y * 70;
    routes.jungle = makeLoop(jx, jz, 48, 7, 0.4);
    // camp approach: an elongated loop from the river side in to ~70 m of the camp and back
    {
      let ux = FB.x - CAMP.x, uz = FB.z - CAMP.z;
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const px = -uz, pz = ux;
      const spec = [[205, 0], [170, 24], [132, 32], [98, 20], [72, -4], [96, -28], [134, -32], [172, -20]];
      routes.campRing = [];
      for (const [d, l] of spec) {
        const p = fixPoint(CAMP.x + ux * d + px * l, CAMP.z + uz * d + pz * l, new THREE.Vector3(), false, 24);
        if (p) routes.campRing.push(p);
      }
    }
    // firebase perimeter outside the wire
    routes.perimeter = makeLoop(FB.x, FB.z, wallR + 30, 9, 0.18);
    for (const k of Object.keys(routes)) if (routes[k].length < 3) routes[k] = makeLoop(FB.x - 80, FB.z + 60, 40, 6, 0.3);
    return routes;
  }

  // -------------------------------------------------------------------------
  // Player snapshot (once per frame)
  // -------------------------------------------------------------------------

  const P = { ok: false, pos: new THREE.Vector3(), chest: new THREE.Vector3(), under: false, alive: false, vis: 0, cover: 0, speed: 0, stance: 'stand' };
  function readPlayer() {
    const p = ctx.player;
    if (!p || !p.position) { P.ok = false; P.alive = false; return; }
    P.ok = true;
    P.pos.copy(p.position);
    P.alive = p.alive !== false;
    P.under = !!p.underground;
    P.stance = p.stance || 'stand';
    const eh = Number.isFinite(p.eyeHeight) ? p.eyeHeight : P.stance === 'prone' ? 0.4 : P.stance === 'crouch' ? 1.0 : 1.65;
    P.chest.set(P.pos.x, P.pos.y + Math.max(0.25, eh - 0.32), P.pos.z);
    let vis;
    if (typeof p.visibility === 'function') vis = p.visibility();
    else vis = P.stance === 'prone' ? 0.3 : P.stance === 'crouch' ? 0.6 : 1;
    P.vis = P.under || !P.alive ? 0 : clamp(Number.isFinite(vis) ? vis : 1, 0, 1);
    P.cover = coverAt(P.pos.x, P.pos.z);
    P.speed = p.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  function aliveCount() { let n = 0; for (const e of list) if (e.alive) n++; return n; }

  function pickVariant(role, rto) {
    const r = Math.random();
    const skin = r < 0.62 ? 0 : r < 0.86 ? 1 : 2;
    let loadout;
    if (rto) loadout = 'rto';
    else if (role === 'patrol' || role === 'heli') loadout = Math.random() < 0.6 ? 'ruck' : 'light';
    else loadout = 'light';
    return {
      skin, loadout,
      rolled: Math.random() < (role === 'patrol' ? 0.25 : 0.5),
      band: Math.random() < 0.55,
      tilt: Math.random() < 0.4 ? 1 : 0,
    };
  }

  function createEnemy(role, x, z, yaw, squad, rto = false, prebuilt = null) {
    if (!scene) return null;
    const soldier = prebuilt || new Soldier(kit, pickVariant(role, rto));
    const e = new Enemy(sys, soldier, role);
    const sc = rnd(0.95, 1.05);
    e.group.scale.setScalar(sc);
    e.position.set(x, heightAt(x, z), z);
    e.yaw = yaw;
    e.group.rotation.y = yaw;
    e.squad = squad;
    e.home.set(x, e.position.y, z);
    e.homeYaw = yaw;
    e.progressPos.copy(e.position);
    if (squad) squad.members.push(e);
    scene.add(e.group);
    list.push(e);
    for (const h of e.hitboxes) hitboxes.push(h);
    soldier.animate(0.016);
    return e;
  }

  function newSquad(kind, route) {
    const sq = {
      id: squads.length + 1, kind, members: [], route: route || [], wp: 0,
      mode: kind === 'garrison' ? 'calm' : 'patrol', modeT: 0, combatT: 0,
      lastKnown: new THREE.Vector3(), lastSeenT: -999, focus: new THREE.Vector3(),
      trail: Array.from({ length: 48 }, () => new THREE.Vector3()), trailHead: 0, trailCount: 0,
      spacing: rnd(5.5, 7.5), haltT: rnd(40, 90), haltLeft: 0, heading: 0, maxLag: 0,
      flankCd: 8, searchDur: 50, leader: null, waitT: 0, dead: false, deadT: 0,
      respawn: kind === 'patrol', routeName: '', arrivedT: 0, deployT: 0,
    };
    squads.push(sq);
    return sq;
  }

  function pushTrail(sq, p) {
    sq.trailHead = (sq.trailHead + 1) % sq.trail.length;
    sq.trail[sq.trailHead].copy(p);
    sq.trailCount = Math.min(sq.trail.length, sq.trailCount + 1);
  }
  function trailPoint(sq, dist, out) {
    const k = Math.min(sq.trailCount - 1, Math.round(dist / 1.5));
    if (k < 0) return out.copy(sq.leader ? sq.leader.position : sq.focus);
    return out.copy(sq.trail[(sq.trailHead - k + sq.trail.length * 4) % sq.trail.length]);
  }

  function spawnPatrol(routeName, n, startFar = true) {
    const route = routes[routeName];
    if (!route || route.length < 2) return null;
    n = Math.min(n, MAX_ACTIVE - aliveCount() - (dumpDown ? 0 : HELI_TROOPS));
    if (n <= 0) return null;
    const sq = newSquad('patrol', route);
    sq.routeName = routeName;
    // start at the waypoint farthest from the player and the camp
    let bi = -1, bd = -Infinity, fi = 0, fd = -1;
    for (let i = 0; i < route.length; i++) {
      const p = route[i];
      const dCamp = Math.hypot(p.x - CAMP.x, p.z - CAMP.z);
      const dPl = P.ok ? Math.hypot(p.x - P.pos.x, p.z - P.pos.z) : dCamp;
      if (dCamp > fd) { fd = dCamp; fi = i; }
      if (T < QUIET_TIME && dCamp < QUIET_RADIUS + 20) continue;
      const d = startFar ? Math.min(dCamp, dPl) : -dPl;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi < 0) bi = fi;
    const start = route[bi];
    const next = route[(bi + 1) % route.length];
    const dirx = next.x - start.x, dirz = next.z - start.z;
    const dl = Math.hypot(dirx, dirz) || 1;
    const yaw = yawTo(dirx, dirz);
    sq.wp = (bi + 1) % route.length;
    sq.heading = yaw;
    for (let i = 0; i < n; i++) {
      const bx = start.x - (dirx / dl) * i * sq.spacing, bz = start.z - (dirz / dl) * i * sq.spacing;
      const p = fixPoint(bx, bz, _v1) || _v1.set(start.x, 0, start.z);
      createEnemy('patrol', p.x, p.z, yaw, sq, i === 1 && n >= 4);
    }
    sq.leader = sq.members[0];
    // seed the breadcrumb trail behind the leader
    for (let k = 40; k >= 0; k--) {
      _v2.set(start.x - (dirx / dl) * k * 1.5, 0, start.z - (dirz / dl) * k * 1.5);
      pushTrail(sq, _v2);
    }
    sq.slotDirty = true;
    return sq;
  }

  function spawnSquad(x, z, n = 5) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    n = Math.max(1, Math.min(Math.round(n) || 5, MAX_ACTIVE - aliveCount()));
    if (n <= 0) return null;
    const route = makeLoop(x, z, rnd(30, 50), 6, 0.35);
    if (route.length < 3) return null;
    const sq = newSquad('patrol', route);
    sq.respawn = false;
    sq.wp = 0;
    const yaw = yawTo(route[0].x - x, route[0].z - z);
    for (let i = 0; i < n; i++) {
      const p = fixPoint(x - Math.sin(yaw) * i * 5, z - Math.cos(yaw) * i * 5, _v1) || _v1.set(x, 0, z);
      createEnemy('patrol', p.x, p.z, yaw, sq, i === 1 && n >= 4);
    }
    sq.leader = sq.members[0];
    for (let k = 30; k >= 0; k--) { _v2.set(x - Math.sin(yaw) * k * 1.5, 0, z - Math.cos(yaw) * k * 1.5); pushTrail(sq, _v2); }
    return sq;
  }

  function setupGarrison() {
    const sq = newSquad('garrison', routes.perimeter);
    garrisonSquad = sq;
    sq.respawn = false;
    // wall guards
    const start = gate ? gate.angle + Math.PI / 8 : 0.35;
    for (let i = 0; i < 8; i++) {
      let a = start + (i / 8) * TAU;
      if (gate && Math.abs(wrapAngle(a - gate.angle)) < 0.2) a += 0.25;
      _v1.set(FB.x + Math.cos(a) * (wallR - 1.7), 0, FB.z + Math.sin(a) * (wallR - 1.7));
      collide(_v1, 0.4, heightAt(_v1.x, _v1.z));
      const yaw = yawTo(Math.cos(a), Math.sin(a));
      const e = createEnemy('wall', _v1.x, _v1.z, yaw, sq);
      if (e) { e.wallAngle = a; e.leashR = 4; }
    }
    // tower sentry + searchlight
    const tw = findTower();
    let lampPos, sweepFull = false, baseYaw = 0;
    if (tw.found && tw.pos) {
      const outward = Math.atan2(tw.pos.z - FB.z, tw.pos.x - FB.x);
      sweepFull = Math.hypot(tw.pos.x - FB.x, tw.pos.z - FB.z) < 8;
      baseYaw = sweepFull ? 0 : yawTo(Math.cos(outward), Math.sin(outward));
      const sx = tw.pos.x - Math.sin(baseYaw) * 0.5, sz = tw.pos.z - Math.cos(baseYaw) * 0.5;
      const e = createEnemy('sentry', sx, sz, baseYaw, sq);
      if (e) { e.fixedY = tw.pos.y; e.position.y = tw.pos.y; e.static = true; e.visionMul = 1.3; sentry = e; }
      lampPos = new THREE.Vector3(tw.pos.x + Math.sin(baseYaw) * 0.45, tw.pos.y + 1.35, tw.pos.z + Math.cos(baseYaw) * 0.45);
      searchlight = buildSearchlight(scene, false);
    } else {
      // no tower in the world: lamp on a tripod behind the wall, facing the river
      const a = Math.atan2(CAMP.z - FB.z, CAMP.x - FB.x);
      _v1.set(FB.x + Math.cos(a) * (wallR - 3.5), 0, FB.z + Math.sin(a) * (wallR - 3.5));
      collide(_v1, 0.8, heightAt(_v1.x, _v1.z));
      baseYaw = yawTo(Math.cos(a), Math.sin(a));
      const gy = heightAt(_v1.x, _v1.z);
      lampPos = new THREE.Vector3(_v1.x, gy + 2.6, _v1.z);
      const e = createEnemy('sentry', _v1.x - Math.sin(baseYaw) * 0.9 + Math.cos(baseYaw) * 0.5, _v1.z - Math.cos(baseYaw) * 0.9, baseYaw, sq);
      if (e) { e.static = true; sentry = e; }
      searchlight = buildSearchlight(scene, true);
    }
    if (searchlight) {
      searchlight.group.position.copy(lampPos);
      searchlight.lampPos.copy(lampPos);
      searchlight.baseYaw = baseYaw;
      searchlight.sweepFull = sweepFull;
      searchlight.yaw = baseYaw;
      searchlight.pitch = -0.32;
      searchlight.manned = true;
    }
    // ammo dump guards
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.7;
      _v1.set(DUMP.x + Math.cos(a) * 4.5, 0, DUMP.z + Math.sin(a) * 4.5);
      collide(_v1, 0.45, heightAt(_v1.x, _v1.z));
      const e = createEnemy('dump', _v1.x, _v1.z, yawTo(Math.cos(a), Math.sin(a)), sq);
      if (e) e.leashR = wallR + 6;
    }
    // interior roamers
    for (let i = 0; i < 3; i++) {
      const p = randomInterior(_v1);
      const e = createEnemy('roam', p.x, p.z, rng() * TAU, sq);
      if (e) e.leashR = wallR + 8;
    }
    sq.leader = sq.members[0];
  }

  function randomInterior(out) {
    for (let k = 0; k < 30; k++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * (wallR - 6);
      const x = FB.x + Math.cos(a) * r, z = FB.z + Math.sin(a) * r;
      if (!insideCollider(x, z, 0.8)) return out.set(x, heightAt(x, z), z);
    }
    return out.set(FB.x + 5, heightAt(FB.x + 5, FB.z + 5), FB.z + 5);
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  function setMove(e, x, z, speed, arrive = 0.8) {
    e.target.set(x, 0, z);
    e.hasTarget = true;
    e.speedWanted = speed;
    e.arrive = arrive;
  }
  function stop(e) { e.hasTarget = false; e.speedWanted = 0; }
  function faceAt(e, p) { e.faceMode = 'point'; e.facePoint.copy(p); }
  function faceYaw(e, y) { e.faceMode = 'yaw'; e.faceYaw = y; }

  // resolve the next steering point, routing through the firebase gate when needed
  // Crossing the wall is committed: once a soldier reaches the gate (or is already in the
  // gap) he keeps going to the far gate point before heading for the target, so he never
  // cuts the corner into the sandbags beside the opening.
  function navPoint(e, out) {
    const tx = e.target.x, tz = e.target.z;
    if (!(walled && gate)) { e.gateLeg = 0; return out.set(tx, 0, tz); }
    const ex = e.position.x, ez = e.position.z;
    const inE = Math.hypot(ex - FB.x, ez - FB.z) < wallR;
    const inT = Math.hypot(tx - FB.x, tz - FB.z) < wallR;
    if (e.gateLeg === 2) {
      const exit = e.gateOut ? gate.outer : gate.inner;
      if (e.gateOut === !inT && Math.hypot(ex - exit.x, ez - exit.z) > 1.4) return out.set(exit.x, 0, exit.z);
      e.gateLeg = 0;
    }
    if (inE === inT) return out.set(tx, 0, tz);
    const entry = inE ? gate.inner : gate.outer, exit = inE ? gate.outer : gate.inner;
    // distance from the gate corridor (entry -> exit segment)
    const sx = exit.x - entry.x, sz = exit.z - entry.z;
    const sl2 = sx * sx + sz * sz || 1;
    const k = clamp(((ex - entry.x) * sx + (ez - entry.z) * sz) / sl2, 0, 1);
    const corridor = Math.hypot(ex - entry.x - sx * k, ez - entry.z - sz * k);
    if (Math.hypot(ex - entry.x, ez - entry.z) < 2.2 || (corridor < 1.6 && k > 0)) {
      e.gateLeg = 2; e.gateOut = inE;
      return out.set(exit.x, 0, exit.z);
    }
    return out.set(entry.x, 0, entry.z);
  }

  function moveEnemy(e, dt) {
    if (e.static) {
      e.vel.set(0, 0, 0);
      e.soldier.anim.speed = 0;
      if (e.fixedY !== null) e.position.y = e.fixedY;
      updateFacing(e, dt);
      return;
    }
    let desiredX = 0, desiredZ = 0, speed = 0;
    if (e.hasTarget) {
      navPoint(e, _v1);
      const dx = _v1.x - e.position.x, dz = _v1.z - e.position.z;
      const d = Math.hypot(dx, dz);
      const finalD = Math.hypot(e.target.x - e.position.x, e.target.z - e.position.z);
      if (finalD < e.arrive) {
        e.hasTarget = false;
      } else if (d > 1e-3) {
        desiredX = dx / d; desiredZ = dz / d;
        speed = e.speedWanted * (finalD < 2 ? clamp(finalD / 2, 0.4, 1) : 1);
        // sidestep when stuck
        if (e.sidestepT > 0) {
          e.sidestepT -= dt;
          const sx = -desiredZ * e.sidestepDir, sz = desiredX * e.sidestepDir;
          desiredX = desiredX * 0.25 + sx; desiredZ = desiredZ * 0.25 + sz;
        }
        // look-ahead avoidance of trunks
        grid.query(e.position.x - 3.2, e.position.z - 3.2, e.position.x + 3.2, e.position.z + 3.2, _items);
        let ax = 0, az = 0;
        for (let i = 0; i < _items.length; i++) {
          const it = _items[i];
          if (it.kind === 1) {
            // boxes (bunkers, tents, sandbag runs): slab test along the heading, then slide
            // off to the side of the box the heading already favours
            const px = e.position.x, pz = e.position.z;
            const x0 = it.minx - 0.45, x1 = it.maxx + 0.45, z0 = it.minz - 0.45, z1 = it.maxz + 0.45;
            if (px > x0 && px < x1 && pz > z0 && pz < z1) continue;
            let tn = 0, tf = 3.2;
            if (Math.abs(desiredX) < 1e-6) { if (px < x0 || px > x1) continue; }
            else {
              let ta = (x0 - px) / desiredX, tb = (x1 - px) / desiredX;
              if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
              tn = Math.max(tn, ta); tf = Math.min(tf, tb);
            }
            if (Math.abs(desiredZ) < 1e-6) { if (pz < z0 || pz > z1) continue; }
            else {
              let ta = (z0 - pz) / desiredZ, tb = (z1 - pz) / desiredZ;
              if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
              tn = Math.max(tn, ta); tf = Math.min(tf, tb);
            }
            if (tn > tf) continue;
            const rx = (it.minx + it.maxx) * 0.5 - px, rz = (it.minz + it.maxz) * 0.5 - pz;
            const lat = rx * -desiredZ + rz * desiredX;
            const sign = lat > 0 ? 1 : -1;
            const s = (1 - tn / 3.2) * 2.2;
            ax += desiredZ * sign * s; az += -desiredX * sign * s;
            continue;
          }
          if (it.kind !== 0 || it.r > 4) continue;
          const rx = it.x - e.position.x, rz = it.z - e.position.z;
          const along = rx * desiredX + rz * desiredZ;
          if (along <= 0 || along > 3.2) continue;
          const lat = rx * -desiredZ + rz * desiredX;
          const clear = it.r + 0.6;
          if (Math.abs(lat) > clear) continue;
          const s = (1 - along / 3.2) * (1 - Math.abs(lat) / clear) * 1.8;
          const sign = lat > 0 ? 1 : -1;
          ax += desiredZ * sign * s; az += -desiredX * sign * s;
        }
        desiredX += ax; desiredZ += az;
      }
    }
    // separation from nearby soldiers
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === e || !o.alive || o.riding) continue;
      const dx = e.position.x - o.position.x, dz = e.position.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.3 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const s = (1.15 - d) / 1.15;
        desiredX += (dx / d) * s * 1.2; desiredZ += (dz / d) * s * 1.2;
        if (speed < 0.3) speed = Math.max(speed, 0.6 * s);
      }
    }
    const dl = Math.hypot(desiredX, desiredZ);
    if (dl > 1e-4) { desiredX /= dl; desiredZ /= dl; }
    const inWater = isWater(e.position.x, e.position.z);
    if (inWater) speed *= 0.55;
    const accel = speed > Math.hypot(e.vel.x, e.vel.z) ? 6 : 9;
    e.vel.x = damp(e.vel.x, desiredX * speed, accel, dt);
    e.vel.z = damp(e.vel.z, desiredZ * speed, accel, dt);
    const ox = e.position.x, oz = e.position.z;
    const nx = ox + e.vel.x * dt, nz = oz + e.vel.z * dt;
    if (deepWater(nx, nz) && !deepWater(ox, oz)) {
      e.vel.multiplyScalar(0.2);
      e.sidestepT = 0.8; e.sidestepDir = Math.random() < 0.5 ? 1 : -1;
    } else {
      e.position.x = nx; e.position.z = nz;
    }
    const gy = heightAt(e.position.x, e.position.z);
    collide(e.position, 0.34, gy);
    e.position.x = clamp(e.position.x, -236, 236);
    e.position.z = clamp(e.position.z, -236, 236);
    e.position.y = e.fixedY !== null ? e.fixedY : heightAt(e.position.x, e.position.z);
    const mx = e.position.x - ox, mz = e.position.z - oz;
    const actual = dt > 0 ? Math.hypot(mx, mz) / dt : 0;
    const back = mx * Math.sin(e.yaw) + mz * Math.cos(e.yaw) < -0.5 * Math.hypot(mx, mz);
    e.soldier.anim.speed = Math.min(actual, 5.5) * (back ? -1 : 1);
    // stuck detection
    e.progressT += dt;
    if (e.progressT > 1.4) {
      const moved = Math.hypot(e.position.x - e.progressPos.x, e.position.z - e.progressPos.z);
      if (e.hasTarget && e.speedWanted > 0.5 && moved < 0.35) {
        e.stuckT += 1;
        e.sidestepT = 1.1 + Math.random() * 0.6;
        e.sidestepDir = Math.random() < 0.5 ? 1 : -1;
        if (e.stuckT >= 4) { e.hasTarget = false; e.stuckT = 0; e.taskFlag = true; }
      } else if (moved > 0.8) e.stuckT = 0;
      e.progressPos.copy(e.position);
      e.progressT = 0;
    }
    updateFacing(e, dt);
  }

  function updateFacing(e, dt) {
    const A = e.soldier.anim;
    let want = e.yaw;
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (e.faceMode === 'point') {
      want = yawTo(e.facePoint.x - e.position.x, e.facePoint.z - e.position.z);
    } else if (e.faceMode === 'yaw') {
      want = e.faceYaw;
    } else if (sp > 0.25) {
      want = yawTo(e.vel.x, e.vel.z);
    }
    const rate = A.aim > 0.5 ? 4.5 : sp > 3 ? 5 : 3;
    // upper body takes up the first part of the turn while aiming
    const diff = wrapAngle(want - e.yaw);
    e.yaw = turnToward(e.yaw, want, rate * dt);
    e.group.rotation.y = e.yaw;
    if (e.faceMode === 'point') {
      A.aimYaw = clamp(wrapAngle(want - e.yaw), -0.7, 0.7);
      const eyeY = e.position.y + (e.crouching ? 1.05 : 1.45);
      const hd = Math.hypot(e.facePoint.x - e.position.x, e.facePoint.z - e.position.z);
      A.aimPitch = clamp(Math.atan2(e.facePoint.y - eyeY, Math.max(1, hd)), -0.9, 0.9);
      A.lookYaw = A.aimYaw;
      A.lookPitch = -A.aimPitch;
    } else {
      A.aimYaw = damp(A.aimYaw, 0, 4, dt);
      A.aimPitch = damp(A.aimPitch, 0, 4, dt);
      // idle scanning of the jungle
      e.lookPhase += dt;
      const scan = e.state === 'patrol' ? 0.55 : 0.9;
      A.lookYaw = clamp(diff * 0.6, -0.8, 0.8) + Math.sin(e.lookPhase * 0.45 + e.id) * scan * (sp < 2.5 ? 1 : 0.3);
      A.lookPitch = Math.sin(e.lookPhase * 0.3 + e.id * 2) * 0.08;
    }
  }

  // -------------------------------------------------------------------------
  // Shouts, alerts, squad knowledge
  // -------------------------------------------------------------------------

  const shoutPayload = { pos: new THREE.Vector3(), kind: '', phrase: '', enemy: null };
  const SHOUT_PHRASE = {
    contact: ['contact', 'contact', 'overthere', 'charlie'], suspicious: ['hey', 'whatwas'], hit: ['medic', 'getdown'],
    grenade: 'grenade', mandown: ['mandown', 'medic'], search: ['move', 'gogo'], reload: 'cover', flank: ['move', 'gogo'],
  };
  function shout(e, kind) {
    if (!e || !e.alive) return;
    if (T - e.shoutT < 2.5 || T - lastShoutT < 0.5) return;
    e.shoutT = T; lastShoutT = T;
    e.soldier.headWorld(shoutPayload.pos);
    shoutPayload.kind = kind; shoutPayload.enemy = e;
    const ph = SHOUT_PHRASE[kind];
    const phrase = Array.isArray(ph) ? ph[(Math.random() * ph.length) | 0] : ph || 'contact';
    shoutPayload.phrase = phrase;
    try { ctx.audio?.play?.('shout', shoutPayload.pos, { kind, phrase, voice: e.id % 5 }); } catch (err) { /* audio optional */ }
    ev.emit('enemyShout', shoutPayload);
  }

  function squadCombat(sq, pos, spotter, seen) {
    if (!sq || sq.dead) return;
    if (pos) sq.lastKnown.copy(pos);
    if (seen) sq.lastSeenT = T;
    if (sq.mode === 'combat') return;
    const prev = sq.mode;
    sq.mode = 'combat'; sq.modeT = 0; sq.combatT = 0; sq.flankCd = rnd(6, 10);
    for (const m of sq.members) {
      if (!m.alive || m.riding) continue;
      m.reaction = m === spotter ? 0.15 : rnd(0.4, 1.3);
      m.cover.valid = false; m.atCover = false;
      if (m.task !== 'hatch' && m.task !== 'guardHatch') m.task = null;
      m.awareness = Math.max(m.awareness, 0.8);
      m.suspT = 0;
    }
    if (spotter) shout(spotter, prev === 'search' ? 'contact' : 'contact');
    // radio: nearby squads converge, garrison stands to
    for (const o of squads) {
      if (o === sq || o.dead) continue;
      const c = squadCenter(o, _v3);
      if (!c) continue;
      const d = Math.hypot(c.x - sq.lastKnown.x, c.z - sq.lastKnown.z);
      if (o.kind === 'garrison') {
        if (Math.hypot(sq.lastKnown.x - FB.x, sq.lastKnown.z - FB.z) < wallR + 70) { o.lastKnown.copy(sq.lastKnown); if (o.mode !== 'combat') { o.mode = 'search'; o.modeT = 0; o.searchDur = 40; } }
      } else if (d < 200 && (o.mode === 'patrol' || o.mode === 'halt')) {
        o.focus.copy(sq.lastKnown); o.mode = 'investigate'; o.modeT = 0; o.arrivedT = 0;
      }
    }
  }

  function squadInvestigate(sq, pos, delay = 1.0) {
    if (!sq || sq.dead || sq.mode === 'combat') return;
    sq.focus.copy(pos);
    if (sq.mode === 'search') { sq.lastKnown.copy(pos); sq.modeT = Math.min(sq.modeT, 10); return; }
    if (sq.mode !== 'investigate') { sq.mode = 'investigate'; sq.modeT = -delay; sq.arrivedT = 0; }
  }

  function squadSearch(sq, pos, dur = 50) {
    if (!sq || sq.dead) return;
    sq.lastKnown.copy(pos);
    sq.mode = 'search'; sq.modeT = 0; sq.searchDur = dur;
    for (const m of sq.members) { m.hasSearchPt = false; m.cover.valid = false; if (m.task === 'flank') m.task = null; }
  }

  function squadCenter(sq, out) {
    let n = 0; out.set(0, 0, 0);
    for (const m of sq.members) if (m.alive && !m.riding) { out.add(m.position); n++; }
    if (!n) return null;
    return out.multiplyScalar(1 / n);
  }

  function makeSuspicious(e, pos, amount) {
    e.awareness = Math.max(e.awareness, amount);
    const sq = e.squad;
    if (!sq || sq.mode === 'combat') return;
    if (e.suspT <= 0 && sq.mode !== 'search') shout(e, 'suspicious');
    e.suspT = rnd(1.2, 2.2);
    e.suspPos.copy(pos);
    squadInvestigate(sq, pos, 1.2);
  }

  // -------------------------------------------------------------------------
  // Vision
  // -------------------------------------------------------------------------

  const _eye = new THREE.Vector3();
  function eyePos(e, out) {
    return out.set(e.position.x, e.position.y + lerp(1.58, 1.05, e.soldier.anim.crouch) * e.group.scale.y, e.position.z);
  }

  function inSearchlight(p) {
    const sl = searchlight;
    if (!sl || !sl.manned) return false;
    _v4.subVectors(p, sl.lampPos);
    const d = _v4.length();
    if (d > sl.length || d < 1) return false;
    return _v4.dot(sl.dir) / d > Math.cos(sl.angle * 1.4);
  }

  function visionPass() {
    const n = list.length;
    if (!n || !P.ok || !P.alive) return;
    let k = 0;
    for (; k < n; k++) {
      const idx = (rr + k) % n;
      const e = list[idx];
      if (!e.alive || e.riding || T < e.nextVisionT) continue;
      if (!visionCheck(e)) { rr = idx; return; }
    }
    rr = (rr + 1) % n;
  }

  // returns false if the frame's ray budget ran out before this check
  function visionCheck(e) {
    const sq = e.squad;
    const hot = sq && (sq.mode === 'combat' || sq.mode === 'search');
    if (P.under) { e.nextVisionT = T + 0.3; e.lastVisionT = T; return true; }
    if (T < QUIET_TIME && Math.hypot(e.position.x - CAMP.x, e.position.z - CAMP.z) < QUIET_RADIUS) { e.nextVisionT = T + 0.5; e.lastVisionT = T; return true; }
    eyePos(e, _eye);
    const dx = P.chest.x - _eye.x, dy = P.chest.y - _eye.y, dz = P.chest.z - _eye.z;
    const hd = Math.hypot(dx, dz);
    const d = Math.hypot(hd, dy);
    if (d > 170) { e.nextVisionT = T + 0.6; e.lastVisionT = T; return true; }
    const vy = e.yaw + e.soldier.anim.lookYaw;
    const cos = hd > 0.01 ? (dx * Math.sin(vy) + dz * Math.cos(vy)) / hd : 1;
    const inCone = cos > VISION_COS;
    const lit = e === sentry && inSearchlight(P.chest);
    let range = VISION_RANGE * P.vis * (1 - 0.3 * P.cover) * e.visionMul;
    if (hot) range *= 1.3;
    if (lit) range = Math.max(range * 2.2, 70);
    if (!inCone) range = Math.min(range, hot ? 9 : 5);
    range = Math.max(range, P.vis > 0.02 ? (inCone ? 4 : 1.8) : 0);
    if (d > range) { e.nextVisionT = T + (d > range * 2 ? 0.35 : 0.18); e.lastVisionT = T; return true; }
    if (rayBudget <= 0) return false;
    rayBudget--;
    const elapsed = Math.min(0.6, T - e.lastVisionT);
    e.lastVisionT = T;
    e.nextVisionT = T + (hot ? 0.12 : 0.2) + Math.random() * 0.05;
    if (!losClear(_eye, P.chest)) return true;
    const closeness = 1 - d / range;
    const central = inCone ? lerp(0.45, 1, (cos - VISION_COS) / (1 - VISION_COS)) : 0.5;
    const rate = (0.35 + 3.4 * closeness * closeness) * central * (0.4 + 0.6 * P.vis) * (hot ? 3 : 1) * (lit ? 2.5 : 1);
    e.awareness = Math.min(1.5, e.awareness + rate * elapsed);
    e.glimpse.copy(P.pos);
    e.glimpseT = T;
    if (e.awareness >= 1 || (sq && sq.mode === 'combat')) {
      e.lastSeenT = T;
      if (sq) { sq.lastSeenT = T; sq.lastKnown.copy(P.pos); }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Shooting
  // -------------------------------------------------------------------------

  const shotPool = Array.from({ length: 16 }, () => ({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), end: new THREE.Vector3(), by: 'enemy', weapon: 'm16', enemy: null, hit: false }));
  let shotIdx = 0;
  const _mz = new THREE.Vector3(), _end = new THREE.Vector3(), _dir = new THREE.Vector3(), _perp = new THREE.Vector3();
  const _hitFrom = Array.from({ length: 8 }, () => new THREE.Vector3());
  let hitFromIdx = 0;

  function acquireToken(e) { if (!e.hasToken && tokens < MAX_TOKENS) { e.hasToken = true; tokens++; e.lastShotT = T; } }
  function releaseToken(e) { if (e.hasToken) { e.hasToken = false; tokens = Math.max(0, tokens - 1); } }

  // Only token holders land hits; inside CLOSE_SHOOTER_R one extra soldier at a time may too,
  // so a room full of garrison can't all hit at once at point-blank range.
  let closeShooter = null;
  let lastPlayerHitT = -99, hitHeat = 0;
  function canLandHits(e) {
    if (e.hasToken) return true;
    if (e.dist >= CLOSE_SHOOTER_R) return false;
    const c = closeShooter;
    if (c && c !== e && c.alive && c.burstLeft > 0 && c.dist < CLOSE_SHOOTER_R) return false;
    closeShooter = e;
    return true;
  }

  function hitChance(e, d) {
    const ramp = smoothstep(0.25, 4.5, e.exposure);
    let p = lerp(0.03, 0.2, ramp);
    p *= d < 12 ? 1.3 : lerp(1, 0.3, clamp((d - 12) / 85, 0, 1));
    p = Math.min(p, HIT_CAP);
    if (P.stance === 'prone') p *= 0.5; else if (P.stance === 'crouch') p *= 0.75;
    if (P.speed > 4) p *= 0.6; else if (P.speed > 1) p *= 0.85;
    p *= 1 - 0.6 * clamp(e.suppress, 0, 1);
    if (Math.hypot(e.vel.x, e.vel.z) > 2) p *= 0.4;
    p *= 1 - 0.35 * P.cover;
    if (e.role === 'heliGun') p *= 0.35;
    return p;
  }

  // muzzle: world pos, tgt: aim point, seeing: has LOS to the player right now
  function fireShot(shooter, muzzle, tgt, seeing, canHit) {
    const d = muzzle.distanceTo(tgt);
    let hit = false;
    const pl = ctx.player;
    // a short shared grace window between hits gives the player time to react and break contact
    if (canHit && seeing && P.alive && !P.under && pl && !over && T - lastPlayerHitT >= HIT_GAP + HIT_GAP_HEAT * hitHeat) {
      hit = Math.random() < hitChance(shooter, d);
    }
    shooter.lastShotT = T;
    _dir.subVectors(tgt, muzzle).normalize();
    if (hit) {
      _end.copy(P.chest);
      _end.x += rnd(-0.12, 0.12); _end.y += rnd(-0.2, 0.15); _end.z += rnd(-0.12, 0.12);
      const dmg = Math.round(lerp(25, 18, clamp((d - 10) / 90, 0, 1)));
      lastPlayerHitT = T;
      hitHeat = Math.min(4, hitHeat + 1);
      const from = _hitFrom[hitFromIdx]; hitFromIdx = (hitFromIdx + 1) % _hitFrom.length;
      from.copy(muzzle);
      try { pl.damage?.(dmg, from); } catch (err) { console.error(err); }
    } else {
      _perp.set(-_dir.z, 0, _dir.x).normalize();
      const spread = (seeing ? 1 : 2.2) * rnd(0.6, 2.4) * (Math.random() < 0.5 ? -1 : 1);
      _end.copy(tgt).addScaledVector(_perp, spread);
      _end.y += rnd(-1.0, 1.4) * (seeing ? 0.7 : 1.2);
      _v5.subVectors(_end, muzzle).normalize();
      // run on until it meets the ground (or 35 m)
      let landed = false;
      _v6.copy(_end);
      for (let i = 0; i < 24; i++) {
        _v6.addScaledVector(_v5, 1.5);
        if (_v6.y < heightAt(_v6.x, _v6.z)) { landed = true; break; }
      }
      _end.copy(_v6);
      if (landed && fx && P.ok && _end.distanceTo(P.pos) < 45) {
        _v6.y = heightAt(_v6.x, _v6.z) + 0.05;
        fx.puff(_v6, rnd(0.5, 0.9), rnd(0.6, 1.0), 0x7a6248, 0.6);
      }
    }
    _dir.subVectors(_end, muzzle).normalize();
    if (fx) {
      const camD = ctx.camera ? muzzle.distanceTo(ctx.camera.position) : 50;
      if (camD < 180) fx.flash(muzzle, camD < 60);
      if (Math.random() < 0.38) fx.tracer(muzzle, _end);
    }
    const s = shotPool[shotIdx]; shotIdx = (shotIdx + 1) % shotPool.length;
    s.pos.copy(muzzle); s.dir.copy(_dir); s.end.copy(_end);
    s.by = 'enemy'; s.weapon = shooter.role === 'heliGun' ? 'm60' : 'm16'; s.enemy = shooter.role === 'heliGun' ? null : shooter; s.hit = hit;
    ev.emit('shot', s);
  }

  function fireControl(e, dt, tgt, seeing) {
    if (over || e.reloadT > 0) return;
    const sq = e.squad;
    const want = yawTo(tgt.x - e.position.x, tgt.z - e.position.z);
    if (Math.abs(wrapAngle(want - e.yaw)) > 0.55 || e.soldier.anim.aim < 0.8) return;
    if (e.burstLeft > 0) {
      e.shotT -= dt;
      if (e.shotT <= 0) {
        e.aimPoint.copy(tgt);
        if (e.lod < 2 && e.inView) e.soldier.muzzleWorld(_mz);
        else _mz.set(e.position.x + Math.sin(e.yaw) * 0.7, e.position.y + (e.crouching ? 1.0 : 1.4), e.position.z + Math.cos(e.yaw) * 0.7);
        fireShot(e, _mz, tgt, seeing, canLandHits(e));
        e.soldier.anim.recoil = 1;
        e.burstLeft--; e.mag--;
        e.shotT += rnd(0.075, 0.115);
        if (e.mag <= 0) {
          e.burstLeft = 0; e.reloadT = rnd(2.2, 2.9); e.mag = 18;
          if (Math.random() < 0.4) shout(e, 'reload');
        }
        if (e.burstLeft <= 0) {
          releaseToken(e);
          if (closeShooter === e) closeShooter = null;
          e.fireCd = rnd(0.45, 1.3) + e.suppress * 0.8;
        }
      }
      return;
    }
    e.fireCd -= dt;
    if (e.fireCd > 0) return;
    const recent = sq && T - sq.lastSeenT < 6;
    if (!seeing && !(recent && Math.random() < 0.5)) { e.fireCd = rnd(0.6, 1.6); return; }
    e.burstLeft = 2 + ((Math.random() * 4) | 0);
    e.shotT = 0;
    if (seeing) acquireToken(e);
  }

  // -------------------------------------------------------------------------
  // Cover
  // -------------------------------------------------------------------------

  function findCover(e, threat) {
    const c = e.cover;
    c.valid = false;
    grid.query(e.position.x - 16, e.position.z - 16, e.position.x + 16, e.position.z + 16, _items);
    let best = Infinity;
    let n = 0;
    for (let i = 0; i < _items.length && n < 40; i++) {
      const it = _items[i];
      if (it === e.badCover) continue;
      let ux = it.x - threat.x, uz = it.z - threat.z;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul; uz /= ul;
      let ext, perpExt;
      if (it.kind === 0) {
        if (it.r < 0.18 || it.r > 3) continue;
        ext = it.r; perpExt = it.r;
      } else {
        const hx = (it.maxx - it.minx) / 2, hz = (it.maxz - it.minz) / 2;
        if (hx > 8 || hz > 8 || it.maxy - it.base < 0.8) continue;
        ext = Math.abs(ux) * hx + Math.abs(uz) * hz;
        perpExt = Math.abs(uz) * hx + Math.abs(ux) * hz;
      }
      n++;
      const hx = it.x + ux * (ext + 0.55), hz = it.z + uz * (ext + 0.55);
      const dT = Math.hypot(hx - threat.x, hz - threat.z);
      if (dT < 8) continue;
      if (e.leashR < Infinity && Math.hypot(hx - e.home.x, hz - e.home.z) > e.leashR && Math.hypot(hx - FB.x, hz - FB.z) > e.leashR) continue;
      if (isWater(hx, hz)) continue;
      const dE = Math.hypot(hx - e.position.x, hz - e.position.z);
      let score = dE + Math.abs(dT - 28) * 0.25 - Math.min(it.r || 1, 1.5) * 0.8;
      // keep squad mates apart
      for (const o of list) {
        if (o === e || !o.alive || !o.cover.valid) continue;
        if (Math.hypot(o.cover.hx - hx, o.cover.hz - hz) < 2.2) score += 40;
      }
      if (score < best) {
        best = score;
        c.valid = true; c.item = it; c.hx = hx; c.hz = hz;
        c.low = it.low; c.brush = false;
        const side = Math.random() < 0.5 ? 1 : -1;
        const pd = perpExt + 0.7;
        c.px = it.low ? hx : hx - uz * pd * side + ux * 0.25;
        c.pz = it.low ? hz : hz + ux * pd * side + uz * 0.25;
      }
    }
    if (!c.valid) {
      // concealment in dense undergrowth
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * TAU, r = rnd(2, 10);
        const x = e.position.x + Math.cos(a) * r, z = e.position.z + Math.sin(a) * r;
        if (Math.hypot(x - threat.x, z - threat.z) < 8 || isWater(x, z)) continue;
        if (coverAt(x, z) > 0.6) { c.valid = true; c.item = null; c.hx = c.px = x; c.hz = c.pz = z; c.low = true; c.brush = true; break; }
      }
    }
    return c.valid;
  }

  function coverValid(e, threat) {
    const c = e.cover;
    if (!c.valid) return false;
    if (Math.hypot(c.hx - threat.x, c.hz - threat.z) < 6) return false;
    if (!c.item) return true;
    const ax = c.item.x - threat.x, az = c.item.z - threat.z;
    const bx = c.hx - c.item.x, bz = c.hz - c.item.z;
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    return (ax * bx + az * bz) / (la * lb) > 0.55;
  }

  // -------------------------------------------------------------------------
  // Behaviours
  // -------------------------------------------------------------------------

  const _tgt = new THREE.Vector3();

  function combatTarget(e, sq, out) {
    const seeing = T - e.lastSeenT < 0.45 && P.alive && !P.under;
    if (seeing) return out.copy(P.chest);
    return out.set(sq.lastKnown.x, sq.lastKnown.y + 1.0, sq.lastKnown.z);
  }

  function thinkCombat(e, sq, dt) {
    e.state = 'combat';
    const seeing = T - e.lastSeenT < 0.45 && P.alive && !P.under;
    const tgt = combatTarget(e, sq, _tgt);
    const A = e.soldier.anim;
    if (e.reaction > 0) {
      e.reaction -= dt;
      stop(e); faceAt(e, tgt);
      A.aimT = 0.5; A.crouchT = 0.2;
      return;
    }
    if (e.reloadT > 0) e.reloadT -= dt;
    const dist = Math.hypot(tgt.x - e.position.x, tgt.z - e.position.z);

    // flanking run
    if (e.task === 'flank') {
      e.taskT -= dt;
      const dF = Math.hypot(e.taskPt.x - e.position.x, e.taskPt.z - e.position.z);
      if (e.taskT <= 0 || dF < 2.5 || (seeing && dist < 32) || e.taskFlag) {
        e.task = null; e.taskFlag = false; e.cover.valid = false; e.coverSearchT = 0;
      } else {
        setMove(e, e.taskPt.x, e.taskPt.z, SPEED.run, 1.5);
        e.faceMode = 'move';
        A.aimT = 0.15; A.crouchT = 0.25;
        return;
      }
    }

    if (dist < 7 && seeing) {
      // too close for cover: fight it out, backing off
      e.cover.valid = false;
      const ax = e.position.x - tgt.x, az = e.position.z - tgt.z, al = Math.hypot(ax, az) || 1;
      setMove(e, e.position.x + (ax / al) * 3, e.position.z + (az / al) * 3, 1.2, 0.3);
      faceAt(e, tgt);
      A.aimT = 1; A.crouchT = 0;
      fireControl(e, dt, tgt, seeing);
      return;
    }

    e.coverSearchT -= dt;
    if ((!e.cover.valid || !coverValid(e, sq.lastKnown)) && e.coverSearchT <= 0) {
      findCover(e, sq.lastKnown);
      e.coverSearchT = rnd(1.4, 2.4);
      e.atCover = false;
      e.coverMoveT = 0;
    }
    const c = e.cover;
    if (c.valid) {
      if (!e.atCover) {
        const dC = Math.hypot(c.hx - e.position.x, c.hz - e.position.z);
        e.coverMoveT += dt;
        if (e.taskFlag || e.coverMoveT > 9) {
          // unreachable: drop it and look again
          e.taskFlag = false; e.badCover = c.item; c.valid = false; e.coverSearchT = 0.3; e.coverMoveT = 0;
          stop(e);
          return;
        }
        setMove(e, c.hx, c.hz, dC > 5 ? SPEED.run : SPEED.jog, 0.5);
        if (seeing && dC > 6 && dist < 30 && Math.random() < dt * 0.4) {
          // stop and snap off a burst in the open
          e.atCover = false;
        }
        e.faceMode = seeing && dC < 4 ? 'point' : 'move';
        if (e.faceMode === 'point') e.facePoint.copy(tgt);
        A.aimT = seeing && dC < 4 ? 0.7 : 0.15;
        A.crouchT = 0.25;
        if (dC < 0.8 || (!e.hasTarget && dC < 2.5)) { e.atCover = true; e.peeking = false; e.peekT = rnd(0.5, 1.2); }
      } else {
        e.peekT -= dt;
        if (e.peekT <= 0) {
          e.peeking = !e.peeking;
          if (e.peeking && (e.suppress > 0.9 && Math.random() < 0.5)) e.peeking = false;
          e.peekT = e.peeking ? rnd(1.5, 3.2) : rnd(0.9, 2.2) + e.suppress * 2.5;
        }
        if (e.reloadT > 0) e.peeking = false;
        const tx = e.peeking ? c.px : c.hx, tz = e.peeking ? c.pz : c.hz;
        if (Math.hypot(tx - e.position.x, tz - e.position.z) > 0.35) setMove(e, tx, tz, 1.5, 0.25); else stop(e);
        faceAt(e, tgt);
        if (c.low) A.crouchT = e.peeking ? (c.brush ? 0.6 : 0.0) : 1;
        else A.crouchT = e.peeking ? 0.5 : 0.9;
        A.aimT = e.peeking ? 1 : 0.35;
        if (e.peeking) fireControl(e, dt, tgt, seeing);
      }
    } else {
      // nothing nearby: kneel and fight
      stop(e);
      faceAt(e, tgt);
      A.crouchT = e.suppress > 0.6 ? 1 : 0.65;
      A.aimT = e.reloadT > 0 ? 0.3 : 1;
      fireControl(e, dt, tgt, seeing);
    }
  }

  function thinkPatrol(e, sq, dt) {
    e.state = 'patrol';
    const A = e.soldier.anim;
    A.aimT = 0; A.crouchT = 0;
    if (e.suspT > 0) {
      e.suspT -= dt;
      e.state = 'suspicious';
      stop(e);
      _v1.set(e.suspPos.x, e.suspPos.y + 1, e.suspPos.z);
      faceAt(e, _v1);
      A.aimT = 0.6;
      return;
    }
    if (sq.mode === 'halt') {
      stop(e);
      A.crouchT = 1;
      faceYaw(e, sq.heading + (e.slot % 2 === 0 ? 1.1 : -1.1) + (e.slot === 0 ? -1.1 : 0));
      return;
    }
    if (e === sq.leader) {
      let wp = sq.route[sq.wp];
      if (!wp) { stop(e); return; }
      if (Math.hypot(wp.x - e.position.x, wp.z - e.position.z) < 2.6 || e.taskFlag) {
        e.taskFlag = false;
        nextWaypoint(sq);
        wp = sq.route[sq.wp];
      }
      // wait for stragglers, but never for long
      if (sq.maxLag > 14 && sq.waitT < 7) { sq.waitT += dt; stop(e); faceYaw(e, sq.heading); return; }
      if (sq.maxLag < 8) sq.waitT = 0;
      setMove(e, wp.x, wp.z, SPEED.patrol, 1.0);
      e.faceMode = 'move';
    } else {
      trailPoint(sq, e.slot * sq.spacing, _v1);
      // a straggler that keeps getting stuck heads straight for the leader instead
      if (e.stuckT >= 2 && sq.leader) _v1.copy(sq.leader.position);
      const d = Math.hypot(_v1.x - e.position.x, _v1.z - e.position.z);
      if (d > 1.2) setMove(e, _v1.x, _v1.z, d > 6 ? SPEED.jog : SPEED.patrol * clamp(d / 3, 0.6, 1.15), 0.9);
      else stop(e);
      e.faceMode = 'move';
      if (d <= 1.2) faceYaw(e, sq.heading + (e.slot % 2 ? 0.5 : -0.5));
    }
  }

  function nextWaypoint(sq) {
    const n = sq.route.length;
    if (!n) return;
    for (let k = 0; k < n; k++) {
      sq.wp = (sq.wp + 1) % n;
      const p = sq.route[sq.wp];
      if (T >= QUIET_TIME || Math.hypot(p.x - CAMP.x, p.z - CAMP.z) > QUIET_RADIUS) break;
    }
    const p = sq.route[sq.wp];
    if (sq.leader) sq.heading = yawTo(p.x - sq.leader.position.x, p.z - sq.leader.position.z);
  }

  function nearestWaypoint(sq) {
    if (!sq.leader || !sq.route.length) return;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < sq.route.length; i++) {
      const p = sq.route[i];
      const d = Math.hypot(p.x - sq.leader.position.x, p.z - sq.leader.position.z);
      if (T < QUIET_TIME && Math.hypot(p.x - CAMP.x, p.z - CAMP.z) < QUIET_RADIUS) continue;
      if (d < bd) { bd = d; bi = i; }
    }
    sq.wp = bi;
  }

  function thinkInvestigate(e, sq, dt) {
    e.state = 'suspicious';
    const A = e.soldier.anim;
    A.aimT = 0.55; A.crouchT = 0;
    if (e.suspT > 0) {
      e.suspT -= dt;
      stop(e);
      _v1.set(e.suspPos.x, e.suspPos.y + 1, e.suspPos.z);
      faceAt(e, _v1);
      return;
    }
    if (sq.modeT < 0) { stop(e); _v1.set(sq.focus.x, sq.focus.y + 1, sq.focus.z); faceAt(e, _v1); return; }
    if (e === sq.leader) {
      const d = Math.hypot(sq.focus.x - e.position.x, sq.focus.z - e.position.z);
      if (d > 4 && !e.taskFlag) {
        setMove(e, sq.focus.x, sq.focus.z, d > 40 ? SPEED.jog : SPEED.cautious, 3.5);
        e.faceMode = 'move';
      } else {
        stop(e);
        sq.arrivedT += dt;
        faceYaw(e, e.yaw + Math.sin(T * 0.7) * 0.02);
        e.taskFlag = false;
      }
    } else {
      trailPoint(sq, e.slot * Math.min(sq.spacing, 5), _v1);
      const d = Math.hypot(_v1.x - e.position.x, _v1.z - e.position.z);
      if (d > 1.5) setMove(e, _v1.x, _v1.z, d > 8 ? SPEED.jog : SPEED.cautious, 1.0); else stop(e);
      e.faceMode = 'move';
      if (d <= 1.5) faceYaw(e, sq.heading + (e.slot % 2 ? 0.9 : -0.9));
    }
    hatchSpotCheck(e, dt);
  }

  function thinkSearch(e, sq, dt) {
    e.state = 'search';
    const A = e.soldier.anim;
    A.aimT = 0.6; A.crouchT = 0;
    if (e.searchPause > 0) {
      e.searchPause -= dt;
      stop(e);
      faceYaw(e, e.faceYaw + Math.sin(T * 0.9 + e.id) * dt * 0.9);
      if (e.searchPause <= 0) e.hasSearchPt = false;
      hatchSpotCheck(e, dt);
      return;
    }
    if (!e.hasSearchPt) {
      const r = lerp(6, 40, clamp(sq.modeT / 45, 0, 1));
      const allowBase = sq.kind === 'garrison' || insideBase(sq.lastKnown.x, sq.lastKnown.z);
      let ok = false;
      for (let k = 0; k < 6 && !ok; k++) {
        const a = Math.random() * TAU, rr2 = rnd(r * 0.3, r);
        let x = sq.lastKnown.x + Math.cos(a) * rr2, z = sq.lastKnown.z + Math.sin(a) * rr2;
        if (e.leashR < Infinity && Math.hypot(x - FB.x, z - FB.z) > e.leashR) {
          const l = Math.hypot(x - FB.x, z - FB.z);
          x = FB.x + ((x - FB.x) / l) * e.leashR * 0.9; z = FB.z + ((z - FB.z) / l) * e.leashR * 0.9;
        }
        if (validPoint(x, z, allowBase || e.leashR < Infinity)) { e.searchPt.set(x, heightAt(x, z), z); ok = true; }
      }
      if (!ok) e.searchPt.copy(sq.lastKnown);
      e.hasSearchPt = true;
    }
    const d = Math.hypot(e.searchPt.x - e.position.x, e.searchPt.z - e.position.z);
    if (d < 1.5 || e.taskFlag) {
      e.taskFlag = false;
      e.searchPause = rnd(2, 4.5);
      e.faceYaw = e.yaw;
      stop(e);
    } else {
      setMove(e, e.searchPt.x, e.searchPt.z, d > 25 ? SPEED.jog : SPEED.cautious, 1.2);
      e.faceMode = 'move';
    }
    hatchSpotCheck(e, dt);
  }

  function thinkWall(e, sq, dt) {
    const A = e.soldier.anim;
    if (sq.mode === 'combat') {
      const lk = sq.lastKnown;
      if (insideBase(lk.x, lk.z) || !walled) {
        const saved = e.leashR;
        e.leashR = wallR + 2;
        thinkCombat(e, sq, dt);
        e.leashR = saved;
        return;
      }
      e.state = 'combat';
      if (e.reaction > 0) { e.reaction -= dt; stop(e); combatTarget(e, sq, _tgt); faceAt(e, _tgt); A.aimT = 0.5; return; }
      if (e.reloadT > 0) e.reloadT -= dt;
      // hold the post behind the sandbags, pop up to fire
      const dH = Math.hypot(e.home.x - e.position.x, e.home.z - e.position.z);
      if (dH > 0.8) setMove(e, e.home.x, e.home.z, SPEED.jog, 0.4); else stop(e);
      const tgt = combatTarget(e, sq, _tgt);
      const seeing = T - e.lastSeenT < 0.45 && P.alive && !P.under;
      e.peekT -= dt;
      if (e.peekT <= 0) {
        e.peeking = !e.peeking;
        e.peekT = e.peeking ? rnd(1.6, 3.4) : rnd(0.8, 2) + e.suppress * 2.5;
      }
      if (e.reloadT > 0) e.peeking = false;
      faceAt(e, tgt);
      A.crouchT = e.peeking ? 0 : 1;
      A.aimT = e.peeking ? 1 : 0.3;
      if (e.peeking) fireControl(e, dt, tgt, seeing);
      return;
    }
    if (sq.mode === 'search' || sq.mode === 'investigate') {
      e.state = sq.mode === 'search' ? 'search' : 'suspicious';
      const dH = Math.hypot(e.home.x - e.position.x, e.home.z - e.position.z);
      if (dH > 0.8) setMove(e, e.home.x, e.home.z, SPEED.walk, 0.4); else stop(e);
      const f = sq.mode === 'search' ? sq.lastKnown : sq.focus;
      const fy = yawTo(f.x - e.position.x, f.z - e.position.z);
      // keep watching outward if the focus is behind
      faceYaw(e, Math.abs(wrapAngle(fy - e.homeYaw)) < 1.6 ? fy : e.homeYaw + Math.sin(T * 0.4 + e.id) * 0.8);
      A.aimT = 0.55; A.crouchT = 0;
      return;
    }
    // calm: stroll a few metres along the wall, lean on the sandbags, look out
    e.state = 'patrol';
    if (e.suspT > 0) { e.suspT -= dt; e.state = 'suspicious'; stop(e); _v1.set(e.suspPos.x, e.suspPos.y + 1, e.suspPos.z); faceAt(e, _v1); A.aimT = 0.6; return; }
    A.aimT = 0; A.crouchT = 0;
    e.idleT -= dt;
    if (e.idleT <= 0) {
      e.idleT = rnd(8, 20);
      if (Math.random() < 0.55) {
        const a = (e.wallAngle ?? 0) + rnd(-0.12, 0.12);
        _v1.set(FB.x + Math.cos(a) * (wallR - 1.7), 0, FB.z + Math.sin(a) * (wallR - 1.7));
        e.taskPt.copy(_v1);
      } else e.taskPt.copy(e.home);
      e.task = 'stroll';
    }
    if (e.task === 'stroll') {
      const d = Math.hypot(e.taskPt.x - e.position.x, e.taskPt.z - e.position.z);
      if (d > 0.6 && !e.taskFlag) { setMove(e, e.taskPt.x, e.taskPt.z, 1.1, 0.5); e.faceMode = 'move'; }
      else { e.task = null; e.taskFlag = false; stop(e); }
    } else {
      faceYaw(e, e.homeYaw + Math.sin(T * 0.15 + e.id * 1.7) * 0.6);
    }
  }

  function thinkSentry(e, sq, dt) {
    const A = e.soldier.anim;
    stop(e);
    const sl = searchlight;
    if (sq.mode === 'combat') {
      e.state = 'combat';
      if (e.reaction > 0) { e.reaction -= dt; }
      if (e.reloadT > 0) e.reloadT -= dt;
      const tgt = combatTarget(e, sq, _tgt);
      const seeing = T - e.lastSeenT < 0.45 && P.alive && !P.under;
      faceAt(e, tgt);
      e.peekT -= dt;
      if (e.peekT <= 0) { e.peeking = !e.peeking; e.peekT = e.peeking ? rnd(2, 4) : rnd(0.6, 1.5) + e.suppress * 2; }
      A.crouchT = e.peeking ? 0 : 0.9;
      A.aimT = e.peeking && e.reaction <= 0 ? 1 : 0.3;
      if (e.peeking && e.reaction <= 0) fireControl(e, dt, tgt, seeing);
      return;
    }
    e.state = sq.mode === 'search' ? 'search' : sq.mode === 'investigate' ? 'suspicious' : 'patrol';
    A.crouchT = 0;
    A.aimT = sq.mode === 'calm' ? 0 : 0.5;
    if (sl) faceYaw(e, sl.yaw); else faceYaw(e, e.homeYaw + Math.sin(T * 0.2) * 1.2);
  }

  function thinkRoam(e, sq, dt) {
    const A = e.soldier.anim;
    if (sq.mode === 'combat') { thinkCombat(e, sq, dt); return; }
    if (sq.mode === 'search') { thinkSearch(e, sq, dt); return; }
    e.state = sq.mode === 'investigate' ? 'suspicious' : 'patrol';
    if (e.suspT > 0) { e.suspT -= dt; stop(e); _v1.set(e.suspPos.x, e.suspPos.y + 1, e.suspPos.z); faceAt(e, _v1); A.aimT = 0.6; return; }
    if (sq.mode === 'investigate' && Math.hypot(sq.focus.x - FB.x, sq.focus.z - FB.z) < e.leashR) {
      const d = Math.hypot(sq.focus.x - e.position.x, sq.focus.z - e.position.z);
      A.aimT = 0.55;
      if (d > 3 && !e.taskFlag) { setMove(e, sq.focus.x, sq.focus.z, SPEED.cautious, 2.5); e.faceMode = 'move'; }
      else { e.taskFlag = false; stop(e); faceYaw(e, e.yaw + dt * 0.4); }
      hatchSpotCheck(e, dt);
      return;
    }
    A.aimT = sq.mode === 'investigate' ? 0.5 : 0;
    A.crouchT = 0;
    if (e.role === 'dump') {
      const dH = Math.hypot(e.home.x - e.position.x, e.home.z - e.position.z);
      if (dH > 0.7) { setMove(e, e.home.x, e.home.z, 1.2, 0.4); e.faceMode = 'move'; }
      else { stop(e); faceYaw(e, e.homeYaw + Math.sin(T * 0.12 + e.id) * 1.1); }
      return;
    }
    e.idleT -= dt;
    if (e.idleT <= 0 && !e.hasTarget) {
      randomInterior(e.taskPt);
      e.idleT = rnd(6, 16);
      e.task = 'stroll';
    }
    if (e.task === 'stroll') {
      const d = Math.hypot(e.taskPt.x - e.position.x, e.taskPt.z - e.position.z);
      if (d > 1 && !e.taskFlag) { setMove(e, e.taskPt.x, e.taskPt.z, 1.25, 0.8); e.faceMode = 'move'; }
      else { e.task = null; e.taskFlag = false; stop(e); e.faceYaw = e.yaw; }
    } else faceYaw(e, e.faceYaw + Math.sin(T * 0.3 + e.id) * dt * 0.3);
  }

  function thinkDeploy(e, sq, dt) {
    e.state = 'combat';
    const A = e.soldier.anim;
    const d = Math.hypot(e.taskPt.x - e.position.x, e.taskPt.z - e.position.z);
    A.aimT = 0.3; A.crouchT = 0.2;
    if (d > 1.5 && !e.taskFlag) { setMove(e, e.taskPt.x, e.taskPt.z, SPEED.run, 1.2); e.faceMode = 'move'; }
    else {
      e.taskFlag = false;
      stop(e);
      A.crouchT = 1; A.aimT = 0.7;
      faceYaw(e, yawTo(e.position.x - LZ.x, e.position.z - LZ.z));
    }
  }

  // -------------------------------------------------------------------------
  // Hatches and grenades
  // -------------------------------------------------------------------------

  const pendingBlasts = [];
  const hatchGrenadeT = new Map();

  function tunnelFloorY(x, z) {
    const t = ctx.tunnels;
    const f = t?.floorAt?.(x, z);
    if (Number.isFinite(f)) return f;
    return heightAt(x, z) - (WORLD.tunnelDepth || 3.2);
  }

  // Per discovered hatch: who already failed to reach it, and until when to keep trying.
  const hatchJobs = new Map(); // hatch -> { tried: Set<id>, hotUntil, retryAt, triedReset }
  const HATCH_RANGE = 110;     // m (route length) a soldier will cover to grenade a hatch
  const HATCH_LOB_R = 16;      // wall guards lob over the sandbags from this close
  let hatchRetryT = 0;

  function hatchJob(h) {
    let j = hatchJobs.get(h);
    if (!j) { j = { tried: new Set(), hotUntil: 0, retryAt: -1, triedReset: 0 }; hatchJobs.set(h, j); }
    return j;
  }

  // Walking distance to (x, z): through the gate when the wall is between, as navPoint goes.
  function routeLen(e, x, z) {
    const ex = e.position.x, ez = e.position.z;
    if (walled && gate) {
      const inT = Math.hypot(x - FB.x, z - FB.z) < wallR;
      if (e.gateLeg === 2 && e.gateOut === !inT) {
        const g2 = e.gateOut ? gate.outer : gate.inner;
        return Math.hypot(ex - g2.x, ez - g2.z) + Math.hypot(g2.x - x, g2.z - z);
      }
      const inE = Math.hypot(ex - FB.x, ez - FB.z) < wallR;
      if (inE !== inT) {
        const g1 = inE ? gate.inner : gate.outer, g2 = inE ? gate.outer : gate.inner;
        return Math.hypot(ex - g1.x, ez - g1.z) + Math.hypot(g1.x - g2.x, g1.z - g2.z) + Math.hypot(g2.x - x, g2.z - z);
      }
    }
    return Math.hypot(ex - x, ez - z);
  }

  // Route length to the hatch (through the gate when the wall is in the way), with role
  // preferences folded in. Infinity = can't or shouldn't go.
  function hatchScore(e, h, hIn, job) {
    if (!e.alive || e.riding || e.static || e.task === 'hatch' || e.role === 'sentry' || e.role === 'heliGun') return Infinity;
    if (job.tried.has(e.id)) return Infinity;
    const ex = e.position.x, ez = e.position.z;
    const direct = Math.hypot(ex - h.x, ez - h.z);
    const eIn = insideBase(ex, ez);
    if (e.role === 'wall') {
      // guards hold their posts: they take inside hatches, or lob over the wall at close ones
      if (hIn) return direct;
      return direct <= HATCH_LOB_R ? direct + 4 : Infinity;
    }
    let d;
    if (!walled || eIn === hIn) d = direct;
    else if (!gate) return Infinity;
    else d = routeLen(e, h.x, h.z) + 25; // crossing the wire: only when nobody on that side can
    // outside the wire, patrols and the perimeter squad are the natural responders
    if (!hIn && e.squad && e.squad.kind !== 'garrison') d *= 0.75;
    // a soldier in the middle of a firefight is a poor pick
    if (e.state === 'combat' && T - e.lastSeenT < 2) d += 20;
    return d;
  }

  function assignHatch(h) {
    const job = hatchJob(h);
    const hIn = insideBase(h.x, h.z);
    let best = null, bs = HATCH_RANGE;
    for (const e of list) {
      const sc = hatchScore(e, h, hIn, job);
      if (sc < bs) { bs = sc; best = e; }
    }
    if (!best) { job.retryAt = T + 3; return false; }
    job.retryAt = -1;
    hatchGrenadeT.set(h, T);
    const d = Math.hypot(best.position.x - h.x, best.position.z - h.z);
    best.task = 'hatch'; best.taskHatch = h; best.taskFlag = false; best.taskStage = 0;
    best.thrown = false; best.hatchThrowing = false;
    best.hatchLob = best.role === 'wall' && !hIn;
    // a lob over the wall takes a moment to line up; the shout gives the player a beat to crawl off
    best.hatchWind = best.hatchLob ? 0.9 + rnd(1.2, 2.2) : 0.9 + rnd(0, 0.4);
    best.hatchBestD = routeLen(best, h.x, h.z); best.hatchStallT = 0;
    best.taskT = clamp(6 + bs / 3, 10, 34);
    best.cover.valid = false;
    shout(best, 'grenade');
    return true;
  }

  function discoverHatch(h, by, silent = false) {
    if (!h) return;
    const first = !h.discovered;
    h.discovered = true;
    if (first && !silent) {
      ev.emit('hatchDiscovered', { hatch: h, x: h.x, z: h.z, enemy: by || null });
      ev.emit('message', { text: 'Hatch spotted' });
    }
    const job = hatchJob(h);
    if (!silent) job.hotUntil = Math.max(job.hotUntil, T + 60);
    // one grenadier at a time per hatch, and a breather after each assignment
    for (const e of list) if (e.alive && e.task === 'hatch' && e.taskHatch === h) return;
    if (T - (hatchGrenadeT.get(h) ?? -99) < 14) return;
    assignHatch(h);
  }

  // The grenadier couldn't get there (wall, river, stuck) or ran out of time: hand the job
  // to the next best soldier straight away.
  function failHatch(e, h) {
    e.task = null; e.taskHatch = null; e.thrown = false; e.hatchThrowing = false; e.hatchLob = false;
    e.taskFlag = false;
    stop(e);
    if (!h) return;
    const job = hatchJob(h);
    job.tried.add(e.id);
    job.triedReset = T + 30;
    hatchGrenadeT.delete(h);
    if (T < job.hotUntil) assignHatch(h);
  }

  // Discovered hatches that still have no grenadier keep looking for one while hot.
  function updateHatchJobs(dt) {
    hatchRetryT -= dt;
    if (hatchRetryT > 0 || !hatchJobs.size) return;
    hatchRetryT = 1;
    for (const [h, job] of hatchJobs) {
      if (job.triedReset > 0 && T > job.triedReset) { job.tried.clear(); job.triedReset = 0; }
      if (job.retryAt < 0 || T < job.retryAt) continue;
      if (T > job.hotUntil) { job.retryAt = -1; continue; }
      let busy = false;
      for (const e of list) if (e.alive && e.task === 'hatch' && e.taskHatch === h) { busy = true; break; }
      if (busy) { job.retryAt = -1; continue; }
      assignHatch(h);
    }
  }

  function thinkHatch(e, dt) {
    const h = e.taskHatch;
    const A = e.soldier.anim;
    e.state = 'search';
    if (!h) { e.task = null; return; }
    e.taskT -= dt;
    const d = Math.hypot(h.x - e.position.x, h.z - e.position.z);
    if (e.task === 'hatch') {
      if (!e.hatchThrowing) {
        if (e.taskT <= 0) { failHatch(e, h); return; }
        const reach = e.hatchLob ? HATCH_LOB_R : 2.6;
        if (d > reach) {
          // stall watch: route not shrinking for ~4 s (the sidestep unstick gets a go first)
          // means a wall, the river or a jam
          const rl = routeLen(e, h.x, h.z);
          if (rl < e.hatchBestD - 0.5) { e.hatchBestD = rl; e.hatchStallT = 0; }
          else e.hatchStallT += dt;
          if (e.taskFlag || e.hatchStallT > 4) {
            e.taskFlag = false;
            // close enough for an overhand lob into the shaft: do that instead of giving up
            if (d < 14 && losClear(eyePos(e, _v7), _v8.set(h.x, heightAt(h.x, h.z) + 0.4, h.z))) e.hatchThrowing = true;
            else { failHatch(e, h); return; }
          } else {
            if (e.hatchLob) {
              // guard: step to the sandbags nearest the hatch and throw from there
              const a = Math.atan2(h.z - FB.z, h.x - FB.x);
              setMove(e, FB.x + Math.cos(a) * (wallR - 1.7), FB.z + Math.sin(a) * (wallR - 1.7), SPEED.jog, 0.6);
              if (!e.hasTarget || Math.hypot(e.target.x - e.position.x, e.target.z - e.position.z) < 0.8) e.hatchThrowing = true;
            } else setMove(e, h.x, h.z, d > 8 ? SPEED.run : SPEED.walk, 2.4);
            e.faceMode = 'move';
            A.aimT = 0.4; A.crouchT = 0.2;
            if (!e.hatchThrowing) return;
          }
        }
        e.hatchThrowing = true;
        e.taskStage = 0;
      }
      e.taskFlag = false;
      stop(e);
      _v1.set(h.x, heightAt(h.x, h.z), h.z);
      faceAt(e, _v1);
      A.crouchT = d < 4 ? 1 : 0.2; A.aimT = 0;
      e.taskStage = (e.taskStage || 0) + dt;
      if (e.taskStage > e.hatchWind && !e.thrown) {
        e.thrown = true;
        A.throwT = 0.6;
        shout(e, 'grenade');
        e.soldier.headWorld(_v2);
        _v2.y -= d < 4 ? 0.5 : 0.1;
        _v3.set(h.x, heightAt(h.x, h.z) - 0.6, h.z);
        fx?.throwGrenade(_v2, _v3, 0.55 + d * 0.04, 0.5 + d * 0.22);
        pendingBlasts.push({ t: 2.8 + d * 0.04, x: h.x, z: h.z, hatch: h });
        hatchGrenadeT.set(h, T);
        const job = hatchJobs.get(h);
        if (job) { job.retryAt = -1; job.tried.clear(); job.triedReset = 0; }
      }
      if (e.taskStage > e.hatchWind + 0.9) {
        // back off and cover the hole (a guard just goes back to his post)
        e.thrown = false; e.hatchThrowing = false;
        if (e.hatchLob) { e.hatchLob = false; e.task = null; e.taskHatch = null; return; }
        e.task = 'guardHatch'; e.taskT = rnd(20, 30);
        const a = Math.atan2(e.position.z - h.z, e.position.x - h.x);
        e.taskPt.set(h.x + Math.cos(a) * 7, 0, h.z + Math.sin(a) * 7);
      }
      return;
    }
    // guardHatch
    if (e.taskT <= 0) { e.task = null; e.taskHatch = null; return; }
    const dP = Math.hypot(e.taskPt.x - e.position.x, e.taskPt.z - e.position.z);
    if (dP > 1 && !e.taskFlag) { setMove(e, e.taskPt.x, e.taskPt.z, SPEED.jog, 0.8); e.faceMode = 'move'; }
    else { e.taskFlag = false; stop(e); _v1.set(h.x, heightAt(h.x, h.z) + 0.5, h.z); faceAt(e, _v1); }
    A.crouchT = 0.9; A.aimT = 0.9;
    e.awareness = Math.max(e.awareness, 0.6);
    // anyone popping out of this hatch is seen at once
    if (P.ok && P.alive && !P.under && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < 4) {
      e.awareness = 1.2;
      e.lastSeenT = T;
      if (e.squad) squadCombat(e.squad, P.pos, e, true);
      e.task = null;
    }
    // if the squad is fighting, rejoin it
    if (e.squad && e.squad.mode === 'combat' && T - e.squad.lastSeenT < 2) e.task = null;
  }

  function updateBlasts(dt) {
    for (let i = pendingBlasts.length - 1; i >= 0; i--) {
      const b = pendingBlasts[i];
      b.t -= dt;
      if (b.t > 0) continue;
      pendingBlasts.splice(i, 1);
      const pos = new THREE.Vector3(b.x, tunnelFloorY(b.x, b.z) + 0.3, b.z);
      ev.emit('explosion', { pos, radius: 5.5, damage: 160, by: 'enemy', kind: 'grenade', underground: true, hatch: b.hatch });
      if (fx) {
        const gy = heightAt(b.x, b.z);
        for (let k = 0; k < 7; k++) {
          _v1.set(b.x + rnd(-0.6, 0.6), gy + rnd(0.1, 1.4), b.z + rnd(-0.6, 0.6));
          fx.puff(_v1, rnd(1.6, 3.2), rnd(1.4, 2.6), 0x6e5a44, rnd(1.5, 3.5));
        }
      }
    }
  }

  function hatchSpotCheck(e, dt) {
    e.hatchCheckT -= dt;
    if (e.hatchCheckT > 0) return;
    e.hatchCheckT = 0.6;
    const t = ctx.tunnels;
    if (!t || typeof t.nearestHatch !== 'function') return;
    const h = t.nearestHatch(e.position, 3);
    if (h && !h.discovered && Math.random() < 0.18) discoverHatch(h, e);
  }

  function witnesses(pos, maxD) {
    let w = null;
    for (const e of list) {
      if (!e.alive || e.riding) continue;
      const recent = T - e.lastSeenT < 1.6 || (T - e.glimpseT < 1.0 && e.awareness > 0.45);
      if (!recent) continue;
      if (Math.hypot(e.position.x - pos.x, e.position.z - pos.z) > maxD) continue;
      if (!w || e.dist < w.dist) w = e;
    }
    return w;
  }

  function onHatchUse(payload, entering) {
    if (!P.ok) return;
    const t = ctx.tunnels;
    let h = payload?.hatch || null;
    const pos = payload?.pos || P.pos;
    if (!h && t && typeof t.nearestHatch === 'function') h = t.nearestHatch(pos, 4);
    const w = witnesses(pos, 80);
    if (!w || !h) return;
    if (w.squad) { w.squad.lastKnown.set(h.x, heightAt(h.x, h.z), h.z); if (entering) w.squad.lastSeenT = T; }
    if (!h.discovered || entering) discoverHatch(h, w);
  }

  // -------------------------------------------------------------------------
  // Damage and death
  // -------------------------------------------------------------------------

  const killPayload = { enemy: null, pos: null, headshot: false };

  sys.damageEnemy = function damageEnemy(e, amount, part, fromPos, opts) {
    amount = Number(amount) || 0;
    if (!e.alive || amount <= 0) return;
    if (part === 'trap') { part = 'body'; opts = { ...(opts || {}), trap: true, by: 'trap' }; }
    if (e.riding && !(opts && opts.explosion)) amount *= 0.6;
    e.health -= amount;
    const sq = e.squad;
    const src = fromPos && Number.isFinite(fromPos.x) ? fromPos : P.ok ? P.pos : null;
    if (e.health <= 0) { killEnemy(e, part === 'head', src, opts); return; }
    const A = e.soldier.anim;
    A.flinch = 1;
    A.flinchSide = Math.random() < 0.5 ? -1 : 1;
    e.suppress = Math.min(1.5, e.suppress + 0.7);
    e.awareness = 1.2;
    if (sq && src && !(opts && opts.trap)) {
      if (!(opts && opts.explosion) || (opts.by === 'player')) {
        _v1.copy(src);
        _v1.x += rnd(-3, 3); _v1.z += rnd(-3, 3);
        squadCombat(sq, _v1, e, false);
        sq.lastSeenT = Math.max(sq.lastSeenT, T - 3);
      }
    }
    if (opts && opts.trap && sq) squadSearch(sq, e.position, 40);
    shout(e, 'hit');
  };

  function killEnemy(e, headshot, src, opts) {
    e.alive = false;
    e.health = 0;
    e.state = 'dead';
    e.deadT = T;
    releaseToken(e);
    if (closeShooter === e) closeShooter = null;
    // a grenadier killed on his way: someone else picks the hatch up
    if (e.task === 'hatch' && e.taskHatch && !e.thrown) {
      const job = hatchJobs.get(e.taskHatch);
      if (job && T < job.hotUntil) { job.retryAt = T + 1.5; hatchGrenadeT.delete(e.taskHatch); }
    }
    e.cover.valid = false;
    e.hasTarget = false;
    for (const h of e.hitboxes) {
      const i = hitboxes.indexOf(h);
      if (i >= 0) hitboxes.splice(i, 1);
    }
    if (e.riding) {
      const idx = e.riding.troops.indexOf(e);
      if (idx >= 0) e.riding.troops.splice(idx, 1);
      e.riding = null;
      e.position.y = heightAt(e.position.x, e.position.z);
      e.group.quaternion.setFromAxisAngle(V_UP, e.yaw);
    }
    // fall direction from the hit
    let type = 'back';
    let side = Math.random() < 0.5 ? 1 : -1;
    if (opts && opts.trap) type = 'pit';
    else {
      const fromFront = src ? (src.x - e.position.x) * Math.sin(e.yaw) + (src.z - e.position.z) * Math.cos(e.yaw) > 0 : true;
      if (opts && opts.explosion) type = fromFront ? 'back' : 'forward';
      else if (headshot && Math.random() < 0.6) type = 'side';
      else type = fromFront ? (Math.random() < 0.75 ? 'back' : 'side') : 'forward';
      if (src) {
        const sideDot = (src.x - e.position.x) * Math.cos(e.yaw) - (src.z - e.position.z) * Math.sin(e.yaw);
        side = sideDot > 0 ? -1 : 1;
      }
    }
    // ground slope along the fall
    let fx0 = 0, fz0 = 0;
    if (type === 'forward') { fx0 = Math.sin(e.yaw); fz0 = Math.cos(e.yaw); }
    else if (type === 'back') { fx0 = -Math.sin(e.yaw); fz0 = -Math.cos(e.yaw); }
    else if (type === 'side') { fx0 = -Math.cos(e.yaw) * side; fz0 = Math.sin(e.yaw) * side; }
    const h0 = heightAt(e.position.x, e.position.z);
    const h1 = heightAt(e.position.x + fx0 * 1.6, e.position.z + fz0 * 1.6);
    const slope = type === 'pit' ? 0 : Math.atan2(h1 - h0, 1.6);
    e.soldier.die(type, side, slope);
    e.soldier.setLOD(e.soldier.lod, false);
    if (opts && opts.explosion && src) {
      const ax = e.position.x - src.x, az = e.position.z - src.z, al = Math.hypot(ax, az) || 1;
      const f = clamp((opts.force || 1) * 2.2, 0.5, 3.5);
      e.fling = { t: 0, dur: 0.5, x0: e.position.x, z0: e.position.z, dx: (ax / al) * f, dz: (az / al) * f, h: f * 0.25 };
    }
    killPayload.enemy = e;
    killPayload.pos = e.position.clone();
    killPayload.headshot = !!headshot;
    killPayload.by = opts?.by || (opts?.trap ? 'trap' : 'player');
    ev.emit('enemyKilled', killPayload);
    const sq = e.squad;
    if (sq) {
      let mate = null;
      for (const m of sq.members) if (m.alive && !m.riding && (!mate || m.position.distanceTo(e.position) < mate.position.distanceTo(e.position))) mate = m;
      if (mate) {
        if (mate.position.distanceTo(e.position) < 60) shout(mate, 'mandown');
        if (src && !(opts && opts.trap)) {
          _v1.copy(src); _v1.x += rnd(-4, 4); _v1.z += rnd(-4, 4);
          squadCombat(sq, _v1, null, false);
          sq.lastSeenT = Math.max(sq.lastSeenT, T - 3);
        } else if (sq.mode !== 'combat') squadSearch(sq, e.position, 45);
      }
      if (sq.leader === e) sq.leader = null;
      sq.slotDirty = true;
    }
    if (e === sentry && searchlight) searchlight.manned = false;
  }

  // -------------------------------------------------------------------------
  // Events in
  // -------------------------------------------------------------------------

  function onShot(s) {
    if (!s || !s.pos) return;
    const pos = s.pos;
    if (s.by === 'enemy') {
      // comrades firing: investigate where they are shooting
      for (const sq of squads) {
        if (sq.dead || sq.mode === 'combat' || sq.mode === 'search') continue;
        const c = squadCenter(sq, _v3);
        if (!c) continue;
        if (Math.hypot(c.x - pos.x, c.z - pos.z) < 150) {
          const tgt = s.end && Number.isFinite(s.end.x) ? s.end : pos;
          if (sq.kind === 'garrison') { sq.lastKnown.copy(tgt); sq.mode = 'search'; sq.modeT = 0; sq.searchDur = 35; }
          else squadInvestigate(sq, tgt, 0.6);
        }
      }
      return;
    }
    if (s.by !== 'player') return;
    const dir = s.dir;
    for (const e of list) {
      if (!e.alive || e.riding) continue;
      const dx = e.position.x - pos.x, dz = e.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 280) continue;
      const sq = e.squad;
      // near miss: suppression and an exact fix on the shooter
      let nearMiss = false;
      if (dir) {
        const ty = e.position.y + 1.2 - pos.y;
        const t = dx * dir.x + ty * dir.y + dz * dir.z;
        if (t > 0 && t < 220) {
          const cx = dx - dir.x * t, cy = ty - dir.y * t, cz = dz - dir.z * t;
          const miss = Math.sqrt(cx * cx + cy * cy + cz * cz);
          if (miss < 3) { e.suppress = Math.min(1.5, e.suppress + 0.45 * (1 - miss / 3) + 0.15); nearMiss = true; }
        }
      }
      const err = nearMiss ? 1.5 : d * 0.12;
      _v1.set(pos.x + rnd(-err, err), pos.y, pos.z + rnd(-err, err));
      if (d < 90 || nearMiss) {
        e.awareness = Math.max(e.awareness, 0.9);
        if (sq) { squadCombat(sq, _v1, null, false); if (nearMiss) sq.lastKnown.copy(_v1); }
      } else if (sq) {
        if (sq.mode === 'patrol' || sq.mode === 'halt' || sq.mode === 'calm') squadInvestigate(sq, _v1, rnd(0.8, 2));
        else if (sq.mode === 'search') sq.lastKnown.copy(_v1);
      }
    }
  }

  function onNoise(n) {
    if (!n || !n.pos) return;
    if (n.source && n.source !== 'player') return;
    const loud = clamp(Number(n.loudness) || 0, 0, 1);
    if (loud <= 0.01) return;
    const r = loud * 42;
    for (const e of list) {
      if (!e.alive || e.riding) continue;
      const d = e.position.distanceTo(n.pos);
      if (d > r) continue;
      const k = 1 - d / r;
      const sq = e.squad;
      if (sq && sq.mode === 'combat') {
        if (k > 0.5) { sq.lastKnown.copy(n.pos); }
        continue;
      }
      e.awareness = Math.min(1.2, e.awareness + loud * k * 0.9);
      if (e.awareness >= 0.3) {
        _v1.copy(n.pos);
        _v1.x += rnd(-2, 2) * (1 - k); _v1.z += rnd(-2, 2) * (1 - k);
        makeSuspicious(e, _v1, e.awareness);
      }
    }
  }

  function onExplosion(x) {
    if (!x || !x.pos) return;
    const pos = x.pos;
    const R = Number.isFinite(x.radius) ? x.radius : 6;
    const dmg = Number.isFinite(x.damage) ? x.damage : 100;
    const under = pos.y < heightAt(pos.x, pos.z) - 1.2;
    const effR = under ? R * 0.35 : R;
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.position.x - pos.x, dy = e.position.y + 1.0 - pos.y, dz = e.position.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < effR) {
        const f = Math.pow(1 - d / effR, 1.15);
        const amount = dmg * f * (under ? 0.4 : 1);
        if (amount > 1) e.damage(amount, 'body', pos, { explosion: true, by: x.by, force: f * (R / 6) });
      }
    }
    // everyone in earshot reacts
    for (const sq of squads) {
      if (sq.dead) continue;
      const c = squadCenter(sq, _v3);
      if (!c) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d > 380) continue;
      if (x.by === 'enemy') continue;
      if (d < 90) {
        if (sq.mode !== 'combat') squadSearch(sq, pos, 55);
        for (const m of sq.members) m.awareness = Math.max(m.awareness, 0.9);
      } else if (sq.mode === 'patrol' || sq.mode === 'halt' || sq.mode === 'calm') squadInvestigate(sq, pos, rnd(1, 3));
    }
  }

  function onTrap(p) {
    if (!p || p.by === 'enemies') return;
    const e = p.enemy;
    if (e && e.alive && typeof e.damage === 'function') e.damage(100, 'body', null, { trap: true, by: 'trap' });
  }

  function onDumpDestroyed() {
    if (dumpDown) return;
    dumpDown = true;
    try { ctx.audio?.play?.('alarm', FB, { loop: false }); } catch (err) { /* optional */ }
    ev.emit('alarm', { pos: FB.clone() });
    // garrison hunts around the dump; patrols converge on the firebase
    if (garrisonSquad && !garrisonSquad.dead) {
      if (P.ok && Math.hypot(P.pos.x - FB.x, P.pos.z - FB.z) < wallR + 30 && !P.under) squadCombat(garrisonSquad, P.pos, null, false);
      else squadSearch(garrisonSquad, DUMP, 70);
      for (const e of garrisonSquad.members) if (e.role === 'roam' || e.role === 'dump') e.leashR = wallR + 45;
    }
    for (const sq of squads) {
      if (sq.kind !== 'patrol' || sq.dead) continue;
      const c = squadCenter(sq, _v3);
      if (!c) continue;
      const a = Math.atan2(c.z - FB.z, c.x - FB.x);
      _v4.set(FB.x + Math.cos(a) * (wallR + 25), 0, FB.z + Math.sin(a) * (wallR + 25));
      if (sq.mode !== 'combat') squadInvestigate(sq, _v4, rnd(2, 6));
    }
    heliPending = 4;
  }

  function onGameOver() { over = true; }

  const handlers = {
    shot: onShot, noise: onNoise, explosion: onExplosion, trapTriggered: onTrap,
    dumpDestroyed: onDumpDestroyed, gameOver: onGameOver,
    hatch: (p) => onHatchUse(p, !!p?.entering),
    enterTunnel: (p) => onHatchUse(p, true),
    exitTunnel: (p) => onHatchUse(p, false),
    hatchCreated: (p) => { if (p && Number.isFinite(p.x)) onHatchUse({ pos: _v8.set(p.x, heightAt(p.x, p.z), p.z) }, false); },
  };
  for (const k of Object.keys(handlers)) ev.on(k, handlers[k]);

  // -------------------------------------------------------------------------
  // Traps
  // -------------------------------------------------------------------------

  let trapT = 0;
  const trapPayload = { trap: null, enemy: null, pos: new THREE.Vector3(), by: 'enemies' };
  function checkTraps(dt) {
    trapT -= dt;
    if (trapT > 0) return;
    trapT = 0.08;
    const traps = ctx.tunnels?.traps;
    if (!Array.isArray(traps) || !traps.length) return;
    for (const tr of traps) {
      // tunnels.js springs its own traps (they carry a 'sprung' flag); this is the fallback
      if (!tr || !tr.armed || !Number.isFinite(tr.x) || 'sprung' in tr) continue;
      for (const e of list) {
        if (!e.alive || e.riding || e.static) continue;
        const dx = e.position.x - tr.x, dz = e.position.z - tr.z;
        if (dx * dx + dz * dz > 0.6) continue;
        tr.armed = false;
        tr.triggered = true;
        try { tr.trigger?.(e); } catch (err) { /* optional */ }
        trapPayload.trap = tr; trapPayload.enemy = e;
        trapPayload.pos.set(tr.x, heightAt(tr.x, tr.z), tr.z);
        ev.emit('trapTriggered', trapPayload);
        e.position.x = lerp(e.position.x, tr.x, 0.7); e.position.z = lerp(e.position.z, tr.z, 0.7);
        e.damage(100, 'body', null, { trap: true, by: 'trap' });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helicopter
  // -------------------------------------------------------------------------

  const SEATS = [
    [1, 0.55], [1, 0.0], [1, -0.55], [-1, 0.55], [-1, 0.0], [-1, -0.55],
  ];

  function callHelicopter() {
    if (heli || !scene) return heli;
    findLZ();
    if (!hueyModel) hueyModel = buildHuey();
    const H = hueyModel;
    H.group.rotation.set(0, 0, 0);
    // come in over the firebase from the side away from the player
    let ax = FB.x - (P.ok ? P.pos.x : CAMP.x), az = FB.z - (P.ok ? P.pos.z : CAMP.z);
    let al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const rot = 0.5;
    const bx = ax * Math.cos(rot) - az * Math.sin(rot), bz = ax * Math.sin(rot) + az * Math.cos(rot);
    const entry = new THREE.Vector3(clamp(LZ.x + bx * 320, -300, 300), 0, clamp(LZ.z + bz * 320, -300, 300));
    const exitDir = Math.atan2(bz, bx) + 1.4;
    const exit = new THREE.Vector3(LZ.x + Math.cos(exitDir) * 420, 0, LZ.z + Math.sin(exitDir) * 420);
    entry.y = Math.max(heightAt(entry.x, entry.z), LZ.y) + 55;
    H.group.position.copy(entry);
    const yaw = yawTo(LZ.x - entry.x, LZ.z - entry.z);
    heli = {
      ...H, state: 'inbound', t: 0, vel: new THREE.Vector3(Math.sin(yaw) * 38, 0, Math.cos(yaw) * 38),
      position: H.group.position, active: true, rotorSpeed: 1,
      yaw, pitch: 0, roll: 0, rpm: 1, entry, exit, troops: [], unloadT: 0, landYaw: yaw,
      audio: null, gunCd: 2, prevYaw: yaw, dustT: 0,
      gunner: { role: 'heliGun', exposure: 1.5, suppress: 0, vel: new THREE.Vector3() },
    };
    scene.add(H.group);
    // troops on the cabin floor, legs out of the doors
    const sq = newSquad('heli', routes.perimeter);
    sq.mode = 'riding';
    sq.respawn = false;
    heli.squad = sq;
    const n = Math.max(0, Math.min(HELI_TROOPS, MAX_ACTIVE - aliveCount()));
    for (let i = 0; i < n; i++) {
      const e = createEnemy('heli', entry.x, entry.z, yaw, sq, i === 2, troopPool.pop() || null);
      if (!e) continue;
      e.riding = heli;
      e.seat = SEATS[i];
      e.soldier.anim.sit = true;
      e.soldier.anim.sitW = 1;
      heli.troops.push(e);
      e.state = 'riding';
    }
    sq.leader = sq.members[0] || null;
    try { heli.audio = ctx.audio?.play?.('helicopter', H.group.position, { loop: true, object: H.group }) || null; } catch (err) { heli.audio = null; }
    ev.emit('helicopter', { state: 'inbound', pos: H.group.position, object: H.group });
    ev.emit('message', { text: 'Helicopter inbound' });
    return heli;
  }

  function placeTroop(e, H) {
    const side = e.seat[0], z = e.seat[1];
    _v1.set(side * 1.12, 0.1, z);
    _v1.applyMatrix4(H.group.matrixWorld);
    e.position.copy(_v1);
    _q1.setFromAxisAngle(V_UP, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    e.group.quaternion.copy(H.group.quaternion).multiply(_q1);
    e.yaw = H.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  function updateHeli(dt) {
    const H = heli;
    if (!H) return;
    H.t += dt;
    const g = H.group;
    const p = g.position;
    const toX = LZ.x - p.x, toZ = LZ.z - p.z;
    const dLZ = Math.hypot(toX, toZ);
    const groundY = Math.max(heightAt(p.x, p.z), heightAt(p.x + H.vel.x * 2, p.z + H.vel.z * 2), isWater(p.x, p.z) ? waterLevel() : -1e9);
    let wantVX = 0, wantVZ = 0, wantY = p.y, maxAcc = 7, headYaw = H.yaw;
    const sp = Math.hypot(H.vel.x, H.vel.z);
    if (H.state === 'inbound' || H.state === 'approach') {
      const dirX = toX / (dLZ || 1), dirZ = toZ / (dLZ || 1);
      const cruise = H.state === 'inbound' ? 40 : clamp(dLZ * 0.3, 1.5, 40);
      if (H.state === 'inbound' && dLZ < 160) H.state = 'approach';
      wantVX = dirX * cruise; wantVZ = dirZ * cruise;
      const agl = H.state === 'inbound' ? 42 : lerp(3.2, 42, clamp((dLZ - 12) / 140, 0, 1));
      wantY = Math.max(groundY + Math.min(agl, 42), LZ.y + agl);
      headYaw = dLZ > 6 ? yawTo(dirX, dirZ) : H.landYaw;
      if (H.state === 'approach' && dLZ < 18) H.landYaw = H.yaw;
      if (H.state === 'approach' && dLZ < 2.5 && sp < 2.5) { H.state = 'land'; H.t = 0; }
    } else if (H.state === 'land') {
      wantVX = toX * 1.2; wantVZ = toZ * 1.2;
      wantY = LZ.y;
      headYaw = H.landYaw;
      maxAcc = 4;
      if (p.y - LZ.y < 0.06) {
        H.state = 'unload'; H.t = 0; H.unloadT = 0.6;
        ev.emit('helicopter', { state: 'landed', pos: p, object: g });
      }
    } else if (H.state === 'unload') {
      wantVX = toX; wantVZ = toZ; wantY = LZ.y; headYaw = H.landYaw;
      H.unloadT -= dt;
      if (H.unloadT <= 0 && H.troops.length) {
        H.unloadT = 0.45;
        const e = H.troops.shift();
        deployTroop(e, H);
      }
      if (!H.troops.length && H.t > 3.2) { H.state = 'liftoff'; H.t = 0; }
    } else if (H.state === 'liftoff') {
      wantY = LZ.y + 16;
      headYaw = H.landYaw;
      maxAcc = 3;
      if (p.y > LZ.y + 12) {
        const ex = H.exit.x - p.x, ez = H.exit.z - p.z, el = Math.hypot(ex, ez) || 1;
        wantVX = (ex / el) * 8; wantVZ = (ez / el) * 8;
        headYaw = yawTo(ex, ez);
        if (p.y > LZ.y + 15) { H.state = 'outbound'; H.t = 0; }
      }
    } else if (H.state === 'outbound') {
      const ex = H.exit.x - p.x, ez = H.exit.z - p.z, el = Math.hypot(ex, ez) || 1;
      wantVX = (ex / el) * 44; wantVZ = (ez / el) * 44;
      wantY = Math.max(groundY + 55, LZ.y + 55);
      headYaw = yawTo(ex, ez);
      if (Math.abs(p.x) > 330 || Math.abs(p.z) > 330 || el < 20) {
        scene.remove(g);
        try { H.audio?.stop?.(); } catch (err) { /* optional */ }
        H.active = false;
        ev.emit('helicopter', { state: 'gone', pos: p, object: null, active: false });
        heli = null;
        return;
      }
    }
    // velocity / altitude dynamics
    const dvx = wantVX - H.vel.x, dvz = wantVZ - H.vel.z;
    const dvl = Math.hypot(dvx, dvz);
    const step = Math.min(dvl, maxAcc * dt);
    let ax = 0, az = 0;
    if (dvl > 1e-4) { ax = (dvx / dvl) * step / dt; az = (dvz / dvl) * step / dt; H.vel.x += (dvx / dvl) * step; H.vel.z += (dvz / dvl) * step; }
    p.x += H.vel.x * dt; p.z += H.vel.z * dt;
    const vyMax = H.state === 'land' ? 1.9 : 6;
    let vy = clamp((wantY - p.y) * 0.9, -vyMax, vyMax);
    if (H.state === 'land' && p.y - LZ.y < 1.2) vy = Math.max(vy, -0.9);
    p.y += vy * dt;
    if (H.state === 'land' || H.state === 'unload') p.y = Math.max(p.y, LZ.y);
    const minY = heightAt(p.x, p.z) + (H.state === 'land' || H.state === 'unload' ? 0 : 2.5);
    if (p.y < minY && H.state !== 'land' && H.state !== 'unload') p.y = minY;
    // attitude
    const prevYaw = H.yaw;
    H.yaw = turnToward(H.yaw, headYaw, (sp > 10 ? 0.45 : 0.6) * dt);
    const yawRate = wrapAngle(H.yaw - prevYaw) / Math.max(dt, 1e-4);
    const fwdX = Math.sin(H.yaw), fwdZ = Math.cos(H.yaw);
    const fwdSpeed = H.vel.x * fwdX + H.vel.z * fwdZ;
    const fwdAcc = ax * fwdX + az * fwdZ;
    const latAcc = ax * fwdZ - az * fwdX;
    const grounded = H.state === 'unload' || (H.state === 'land' && p.y - LZ.y < 0.3);
    const wantPitch = grounded ? 0 : clamp(0.1 * (fwdSpeed / 40) + fwdAcc * 0.035, -0.28, 0.3);
    const wantRoll = grounded ? 0 : clamp(-yawRate * 0.9 + latAcc * 0.02, -0.4, 0.4);
    H.pitch = damp(H.pitch, wantPitch, 2.5, dt);
    H.roll = damp(H.roll, wantRoll, 2.5, dt);
    g.rotation.set(H.pitch, H.yaw, H.roll);
    // rotors: blades fade into a blur disc
    H.mainRotor.rotation.y += dt * 33 * H.rpm;
    H.tailRotor.rotation.x += dt * 150 * H.rpm;
    H.mainDisc.material.opacity = 0.38;
    g.updateMatrixWorld(true);
    for (const e of H.troops) placeTroop(e, H);
    // downwash dust
    const agl = p.y - heightAt(p.x, p.z);
    if (fx && agl < 16 && agl > -1) {
      H.dustT -= dt;
      if (H.dustT <= 0) {
        H.dustT = 0.06;
        const a = Math.random() * TAU, r = rnd(3, 9);
        const gx = p.x + Math.cos(a) * r, gz = p.z + Math.sin(a) * r;
        _v1.set(gx, heightAt(gx, gz) + 0.4, gz);
        fx.puffWind(_v1, rnd(2.5, 4.5) * (1 - agl / 20), rnd(1.2, 2), isWater(gx, gz) ? 0xc8ccc4 : 0x8c6a4c, Math.cos(a) * 6, Math.sin(a) * 6);
      }
    }
    // door gunner: suppressive M60 bursts when the player has been seen
    H.gunCd -= dt;
    if (!over && P.ok && P.alive && !P.under && (H.state === 'approach' || H.state === 'outbound' || H.state === 'liftoff') && H.gunCd <= 0) {
      const d = p.distanceTo(P.pos);
      const known = squads.some((s) => !s.dead && T - s.lastSeenT < 5);
      if (d < 160 && known) {
        const side = ((P.pos.x - p.x) * Math.cos(H.yaw) - (P.pos.z - p.z) * Math.sin(H.yaw)) > 0 ? 1 : -1;
        _mz.set(side * 2.1, 1.37, -1.55).applyMatrix4(g.matrixWorld);
        let los = false;
        if (rayBudget > 0) { rayBudget--; los = losClear(_mz, P.chest); }
        H.gunner.exposure = Math.min(H.gunner.exposure + 0.4, 4);
        _tgt.copy(los ? P.chest : P.pos);
        if (!los) { _tgt.x += rnd(-6, 6); _tgt.z += rnd(-6, 6); }
        for (let k = 0; k < 4; k++) fireShot(H.gunner, _mz, _tgt, los, los && k === 0);
        H.gunCd = rnd(0.9, 1.8);
      } else H.gunCd = 1;
    }
  }

  function deployTroop(e, H) {
    if (!e || !e.alive) return;
    const side = e.seat[0];
    e.riding = null;
    e.soldier.anim.sit = false;
    // hop out beside the skid
    _v1.set(side * 2.2, 0, e.seat[1]).applyMatrix4(H.group.matrixWorld);
    _v1.y = heightAt(_v1.x, _v1.z);
    collide(_v1, 0.4, _v1.y);
    e.position.copy(_v1);
    e.yaw = H.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    e.group.quaternion.setFromAxisAngle(V_UP, e.yaw);
    e.group.rotation.set(0, e.yaw, 0);
    e.progressPos.copy(e.position);
    // fan out from the aircraft
    const ox = Math.sin(e.yaw), oz = Math.cos(e.yaw);
    const fwdX = Math.sin(H.yaw), fwdZ = Math.cos(H.yaw);
    const r = rnd(14, 24);
    const tx = _v1.x + ox * r + fwdX * e.seat[1] * 14, tz = _v1.z + oz * r + fwdZ * e.seat[1] * 14;
    const p = fixPoint(tx, tz, _v2, true, 20) || _v2.set(tx, 0, tz);
    e.taskPt.copy(p);
    e.task = null;
    const sq = e.squad;
    if (sq) {
      if (sq.mode === 'riding') { sq.mode = 'deploy'; sq.modeT = 0; }
    }
  }

  // -------------------------------------------------------------------------
  // Searchlight update
  // -------------------------------------------------------------------------

  // The spot light only matters near the firebase: every lit fragment pays for it, so it is
  // switched off when the camera is far away or underground (the programs for both light
  // sets are compiled at load, see warmLightSets).
  function spotWanted(sl) {
    if (P.ok && P.under) return false;
    const d = Math.hypot(_camPos.x - sl.lampPos.x, _camPos.z - sl.lampPos.z);
    return d < (sl.spot.visible ? SPOT_HIDE_R + 6 : SPOT_HIDE_R - 6);
  }

  function updateSearchlight(dt) {
    const sl = searchlight;
    if (!sl) return;
    const on = spotWanted(sl);
    if (on !== sl.spot.visible) { sl.spot.visible = on; sl.beam.visible = on; }
    let wantYaw, wantPitch;
    const sq = garrisonSquad;
    const alertMode = sq && (sq.mode === 'combat' || sq.mode === 'search');
    if (sl.manned && alertMode) {
      const seeing = sentry && T - sentry.lastSeenT < 1.5 && P.alive && !P.under;
      const p = seeing ? P.pos : sq.lastKnown;
      _v1.set(p.x - sl.lampPos.x, p.y + 0.5 - sl.lampPos.y, p.z - sl.lampPos.z);
      if (sq.mode === 'search' && !seeing) { _v1.x += Math.sin(T * 0.6) * 10; _v1.z += Math.cos(T * 0.47) * 10; }
      wantYaw = yawTo(_v1.x, _v1.z);
      wantPitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
      sl.yaw = turnToward(sl.yaw, wantYaw, (seeing ? 1.3 : 0.6) * dt);
      sl.pitch = damp(sl.pitch, clamp(wantPitch, -0.9, 0.15), 3, dt);
    } else if (sl.manned) {
      wantYaw = sl.sweepFull ? sl.baseYaw + T * 0.16 : sl.baseYaw + Math.sin(T * 0.23) * 1.25;
      sl.yaw = turnToward(sl.yaw, wrapAngle(wantYaw), 0.5 * dt);
      // aim at the ground ~45 m out
      const d = 38 + Math.sin(T * 0.37) * 10;
      const gx = sl.lampPos.x + Math.sin(sl.yaw) * d, gz = sl.lampPos.z + Math.cos(sl.yaw) * d;
      wantPitch = Math.atan2(heightAt(gx, gz) - sl.lampPos.y, d);
      sl.pitch = damp(sl.pitch, clamp(wantPitch, -0.9, 0.1), 2, dt);
    }
    const cp = Math.cos(sl.pitch);
    sl.dir.set(Math.sin(sl.yaw) * cp, Math.sin(sl.pitch), Math.cos(sl.yaw) * cp);
    sl.aim.copy(sl.lampPos).addScaledVector(sl.dir, 40);
    sl.head.rotation.set(-sl.pitch, sl.yaw, 0, 'YXZ');
    sl.beam.position.copy(sl.lampPos).addScaledVector(sl.dir, 0.3);
    sl.beam.lookAt(sl.aim);
    sl.spot.position.copy(sl.lampPos);
    sl.spot.target.position.copy(sl.aim);
    sl.spot.target.updateMatrixWorld();
  }

  // -------------------------------------------------------------------------
  // Squad update
  // -------------------------------------------------------------------------

  function updateSquad(sq, dt) {
    if (sq.dead) return;
    let alive = 0;
    let slot = 0;
    if (!sq.leader || !sq.leader.alive) sq.leader = null;
    for (const m of sq.members) {
      if (!m.alive) continue;
      alive++;
      if (!sq.leader && !m.riding) sq.leader = m;
    }
    if (!alive) {
      sq.dead = true; sq.deadT = T;
      if (sq.respawn) respawnQueue.push({ t: T + rnd(70, 110), route: sq.routeName });
      return;
    }
    if (sq.leader) {
      sq.leader.slot = 0;
      for (const m of sq.members) if (m.alive && m !== sq.leader) m.slot = ++slot;
    }
    sq.modeT += dt;
    if (sq.mode === 'riding') return;
    if (sq.mode === 'deploy') {
      let done = true;
      for (const m of sq.members) if (m.alive && (m.riding || Math.hypot(m.taskPt.x - m.position.x, m.taskPt.z - m.position.z) > 2)) done = false;
      if (done || sq.modeT > 14) {
        if (T - sq.lastSeenT < 10 || (heli == null && P.ok && T - lastAnySeen() < 10)) { sq.mode = 'patrol'; squadCombat(sq, sq.lastSeenT > 0 ? sq.lastKnown : P.pos, null, false); }
        else squadSearch(sq, garrisonSquad && T - garrisonSquad.lastSeenT < 30 ? garrisonSquad.lastKnown : DUMP, 70);
      }
      return;
    }
    if (sq.mode === 'combat') {
      sq.combatT += dt;
      let anySee = false;
      for (const m of sq.members) if (m.alive && T - m.lastSeenT < 0.6) anySee = true;
      if (anySee) sq.lastSeenT = T;
      if (T - sq.lastSeenT > 11 && sq.combatT > 6) {
        squadSearch(sq, sq.lastKnown, sq.kind === 'garrison' ? 45 : rnd(45, 65));
        shout(sq.leader, 'search');
        return;
      }
      // flanking
      sq.flankCd -= dt;
      if (sq.flankCd <= 0 && sq.kind !== 'garrison' && alive >= 3) {
        sq.flankCd = rnd(16, 24);
        let fl = null;
        for (let i = sq.members.length - 1; i >= 0; i--) { const m = sq.members[i]; if (m.alive && m !== sq.leader && !m.task && m.reaction <= 0) { fl = m; break; } }
        if (fl) {
          const c = squadCenter(sq, _v3);
          const tx = sq.lastKnown.x - c.x, tz = sq.lastKnown.z - c.z, tl = Math.hypot(tx, tz) || 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          const px = -tz / tl * side, pz = tx / tl * side;
          const fx0 = sq.lastKnown.x + px * 24 - (tx / tl) * 8, fz0 = sq.lastKnown.z + pz * 24 - (tz / tl) * 8;
          const p = fixPoint(fx0, fz0, _v4, false, 15);
          if (p) {
            fl.task = 'flank'; fl.taskPt.copy(p); fl.taskT = 25; fl.taskFlag = false;
            fl.cover.valid = false;
            shout(fl, 'flank');
          }
        }
      }
      return;
    }
    if (sq.mode === 'search') {
      if (sq.modeT > sq.searchDur) {
        if (sq.kind === 'garrison') { sq.mode = 'calm'; }
        else { sq.mode = 'patrol'; nearestWaypoint(sq); }
        sq.modeT = 0;
        for (const m of sq.members) { m.awareness = Math.min(m.awareness, 0.2); m.hasSearchPt = false; }
      }
      return;
    }
    if (sq.mode === 'investigate') {
      if (sq.kind === 'garrison') { if (sq.modeT > 25) { sq.mode = 'calm'; sq.modeT = 0; } return; }
      if (sq.arrivedT > 6 || sq.modeT > 50) {
        // nothing there: sweep a little, then carry on
        if (sq.arrivedT > 6 && Math.random() < 0.5) squadSearch(sq, sq.focus, rnd(20, 30));
        else { sq.mode = 'patrol'; sq.modeT = 0; nearestWaypoint(sq); }
      }
      recordTrail(sq);
      computeLag(sq);
      return;
    }
    if (sq.mode === 'calm') return;
    // patrol / halt
    if (sq.mode === 'halt') {
      sq.haltLeft -= dt;
      if (sq.haltLeft <= 0) { sq.mode = 'patrol'; sq.haltT = rnd(50, 100); }
      return;
    }
    sq.haltT -= dt;
    if (sq.haltT <= 0 && sq.kind === 'patrol') { sq.mode = 'halt'; sq.haltLeft = rnd(6, 11); return; }
    // quiet start: hold short of the camp area
    if (sq.leader && T < QUIET_TIME) {
      const wp = sq.route[sq.wp];
      if (wp && Math.hypot(wp.x - CAMP.x, wp.z - CAMP.z) < QUIET_RADIUS) nextWaypoint(sq);
    }
    recordTrail(sq);
    computeLag(sq);
  }

  function lastAnySeen() { let t = -999; for (const s of squads) if (!s.dead && s.lastSeenT > t) t = s.lastSeenT; return t; }

  function recordTrail(sq) {
    const L = sq.leader;
    if (!L) return;
    const last = sq.trail[sq.trailHead];
    if (sq.trailCount === 0 || Math.hypot(L.position.x - last.x, L.position.z - last.z) > 1.5) pushTrail(sq, L.position);
    if (Math.hypot(L.vel.x, L.vel.z) > 0.3) sq.heading = yawTo(L.vel.x, L.vel.z);
  }

  function computeLag(sq) {
    let lag = 0;
    for (const m of sq.members) {
      if (!m.alive || m === sq.leader) continue;
      trailPoint(sq, m.slot * sq.spacing, _v5);
      lag = Math.max(lag, Math.hypot(_v5.x - m.position.x, _v5.z - m.position.z));
    }
    sq.maxLag = lag;
  }

  // -------------------------------------------------------------------------
  // Per-enemy update
  // -------------------------------------------------------------------------

  function think(e, dt) {
    const sq = e.squad;
    if (!sq) { stop(e); return; }
    const seeing = T - e.lastSeenT < 0.45;
    e.exposure = seeing ? Math.min(8, e.exposure + dt) : Math.max(0, e.exposure - dt * 0.6);
    e.suppress = Math.max(0, e.suppress - dt * 0.35);
    if (T - e.glimpseT > 1.5) e.awareness = Math.max(sq.mode === 'combat' ? 0.5 : 0, e.awareness - dt * 0.06);
    // perception thresholds
    if (e.awareness >= 1 && T - e.glimpseT < 0.6 && sq.mode !== 'combat') {
      e.lastSeenT = T;
      squadCombat(sq, e.glimpse, e, true);
    } else if (e.awareness >= 0.3 && T - e.glimpseT < 0.6 && (sq.mode === 'patrol' || sq.mode === 'halt' || sq.mode === 'calm')) {
      makeSuspicious(e, e.glimpse, e.awareness);
    }
    if (e.task === 'hatch' || e.task === 'guardHatch') { thinkHatch(e, dt); return; }
    switch (e.role) {
      case 'sentry': thinkSentry(e, sq, dt); return;
      case 'wall': thinkWall(e, sq, dt); return;
      case 'roam': case 'dump': thinkRoam(e, sq, dt); return;
      default: break;
    }
    switch (sq.mode) {
      case 'combat': thinkCombat(e, sq, dt); break;
      case 'search': thinkSearch(e, sq, dt); break;
      case 'investigate': thinkInvestigate(e, sq, dt); break;
      case 'deploy': thinkDeploy(e, sq, dt); break;
      default: thinkPatrol(e, sq, dt); break;
    }
  }

  const _frustum = new THREE.Frustum();
  const _sphere = new THREE.Sphere();
  const _camPos = new THREE.Vector3();

  function updateEnemy(e, dt) {
    const s = e.soldier;
    if (!e.alive) {
      if ((frame + e.id) % 20 === 0) {
        const cdd = _camPos.distanceTo(e.position);
        s.setLOD(cdd < LOD_NEAR ? 0 : cdd < LOD_HIDE ? 1 : 2, false);
      }
      if (e.fling) {
        const f = e.fling;
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        e.position.x = f.x0 + f.dx * k; e.position.z = f.z0 + f.dz * k;
        e.position.y = heightAt(e.position.x, e.position.z) + Math.sin(k * Math.PI) * f.h;
        if (k >= 1) e.fling = null;
      }
      if (!s.death?.done) s.animate(dt);
      return;
    }
    // a soldier pulled away mid-burst (hatch task, lost sight, reaction) hands his token back
    if (e.hasToken && T - e.lastShotT > 2) releaseToken(e);
    // distance / LOD
    e.dist = P.ok ? Math.hypot(e.position.x - P.pos.x, e.position.z - P.pos.z) : 100;
    const cd = _camPos.distanceTo(e.position);
    const lod = cd < LOD_NEAR ? 0 : cd < LOD_HIDE ? 1 : 2;
    s.setLOD(lod, lod === 0 && cd < 50);
    e.lod = lod;
    _sphere.center.set(e.position.x, e.position.y + 0.9, e.position.z);
    _sphere.radius = 1.3;
    e.inView = lod < 2 && _frustum.intersectsSphere(_sphere);
    if (e.riding) {
      if (e.inView) s.animate(dt);
      return;
    }
    const farAI = e.dist > 120 && !(e.squad && e.squad.mode === 'combat');
    e.thinkAcc += dt;
    if (!farAI || e.thinkAcc >= 0.2) {
      const step = e.thinkAcc;
      e.thinkAcc = 0;
      think(e, step);
      moveEnemy(e, step);
    }
    if (lod === 2) return;
    e.animAcc += dt;
    const interval = e.inView ? (lod === 0 ? 0 : cd > 150 ? 0.1 : 0.05) : 0.25;
    if (e.animAcc >= interval) { s.animate(Math.min(e.animAcc, 0.25)); e.animAcc = 0; }
  }

  // -------------------------------------------------------------------------
  // Alert level
  // -------------------------------------------------------------------------

  const alertPayload = { level: 0 };
  function updateAlert(dt) {
    let lvl = 0;
    for (const sq of squads) {
      if (sq.dead) continue;
      if (sq.mode === 'combat' || sq.mode === 'deploy') { lvl = 2; break; }
      if (sq.mode === 'search' || sq.mode === 'investigate') lvl = Math.max(lvl, 1);
    }
    if (lvl < 2) for (const e of list) if (e.alive && (e.suspT > 0 || e.task === 'hatch' || e.task === 'guardHatch')) lvl = Math.max(lvl, 1);
    if (lvl >= alertShown) { alertShown = lvl; alertHold = lvl === 2 ? 4 : 3; alertCandidate = lvl; }
    else {
      if (lvl !== alertCandidate) { alertCandidate = lvl; alertHold = alertShown === 2 ? 4 : 3; }
      alertHold -= dt;
      if (alertHold <= 0) alertShown = lvl;
    }
    if (alertShown !== api.alertLevel) {
      api.alertLevel = alertShown;
      alertPayload.level = alertShown;
      ev.emit('alert', alertPayload);
    }
  }

  // -------------------------------------------------------------------------
  // Spawning over time, corpses
  // -------------------------------------------------------------------------

  function updateSpawns(dt) {
    if (heliPending >= 0) {
      heliPending -= dt;
      if (heliPending <= 0) { heliPending = -1; callHelicopter(); }
    }
    if (!respawnQueue.length) return;
    for (let i = respawnQueue.length - 1; i >= 0; i--) {
      const r = respawnQueue[i];
      if (T < r.t) continue;
      const reserve = dumpDown ? 0 : HELI_TROOPS;
      const room = MAX_ACTIVE - aliveCount() - reserve;
      if (room < 3) { r.t = T + 20; continue; }
      const names = ['riverFar', 'jungle', 'riverNear', 'campRing', 'perimeter'];
      const name = r.route && Math.random() < 0.6 ? r.route : names[(Math.random() * names.length) | 0];
      const sq = spawnPatrol(name, Math.min(room, 4 + ((Math.random() * 2) | 0)), true);
      respawnQueue.splice(i, 1);
      if (sq && dumpDown) squadInvestigate(sq, FB, 2);
    }
  }

  function cleanupCorpses() {
    if (frame % 30 !== 0) return;
    let corpses = 0;
    for (const e of list) if (!e.alive) corpses++;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive) continue;
      const age = T - e.deadT;
      const far = !P.ok || e.position.distanceTo(P.pos) > 35;
      if ((age > 90 && far) || (corpses > MAX_CORPSES && age > 10 && far)) {
        scene.remove(e.group);
        e.soldier.skeleton.dispose();
        list.splice(i, 1); i--;
        corpses--;
        if (e.squad) {
          const k = e.squad.members.indexOf(e);
          if (k >= 0) e.squad.members.splice(k, 1);
        }
      }
    }
    for (let i = squads.length - 1; i >= 0; i--) if (squads[i].dead && squads[i].members.length === 0) squads.splice(i, 1);
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    T += dt; frame++;
    sys.now = T;
    gridCheckT -= dt;
    if (gridCheckT <= 0) {
      gridCheckT = 2;
      const w = ctx.world;
      const n = (w?.colliders?.length || 0) + (w?.boxColliders?.length || 0);
      if (n !== gridCount) rebuildGrid();
      losRefreshT -= 2;
      if (losRefreshT <= 0) { losRefreshT = 10; refreshLosMeshes(); }
    }
    readPlayer();
    rayBudget = RAY_BUDGET;
    hitHeat = Math.max(0, hitHeat - dt * 1.2);
    const cam = ctx.camera;
    if (cam) {
      cam.getWorldPosition(_camPos);
      _m1.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_m1);
    } else _camPos.copy(P.pos);
    visionPass();
    for (let i = 0; i < squads.length; i++) updateSquad(squads[i], dt);
    for (let i = 0; i < list.length; i++) updateEnemy(list[i], dt);
    updateHeli(dt);
    updateSearchlight(dt);
    updateBlasts(dt);
    updateHatchJobs(dt);
    fx?.update(dt);
    checkTraps(dt);
    updateAlert(dt);
    updateSpawns(dt);
    cleanupCorpses();
  }

  function nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const e of list) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function dispose() {
    for (const k of Object.keys(handlers)) ev.off(k, handlers[k]);
  }

  // three keys every lit program on the scene's light counts, so toggling the spot (or a
  // module switching its lamp lights on underground) would recompile every material the
  // first time. Compile the light sets main.js will not see (main warms the starting one
  // after all modules load), then restore the starting state. compile() builds every
  // program synchronously (compileAsync only waits on them afterwards), so the temporary
  // visibility changes never reach a rendered frame. The Huey is not in the scene until the
  // alarm; it rides along in the first pass so its materials don't hitch the climax.
  const _warmHidden = [];
  function compileNow(r, cam) {
    try {
      const parallel = !!r.extensions?.has?.('KHR_parallel_shader_compile');
      if (parallel && typeof r.compileAsync === 'function') r.compileAsync(scene, cam).catch(() => {});
      else r.compile(scene, cam);
    } catch (e) { console.warn('[enemies] light-set warm-up skipped', e); }
  }
  function warmLightSets() {
    const sl = searchlight, r = ctx.renderer, cam = ctx.camera;
    if (!sl || !scene) return;
    const pp = ctx.player?.position;
    const px = pp && Number.isFinite(pp.x) ? pp.x : cam ? cam.position.x : CAMP.x;
    const pz = pp && Number.isFinite(pp.z) ? pp.z : cam ? cam.position.z : CAMP.z;
    const under = !!ctx.player?.underground;
    const startOn = !under && Math.hypot(px - sl.lampPos.x, pz - sl.lampPos.z) < SPOT_HIDE_R;
    if (r && cam && typeof r.compile === 'function') {
      // pass 1: the other searchlight state (plus the helicopter)
      const huey = hueyModel?.group && !hueyModel.group.parent ? hueyModel.group : null;
      if (huey) scene.add(huey);
      sl.spot.visible = !startOn; sl.beam.visible = !startOn;
      compileNow(r, cam);
      if (huey) scene.remove(huey);
      // pass 2: surface start -> the underground set: spot off, every switched-off point light
      // (tunnel/oil lamps hidden on the surface, directly or through a hidden parent) on
      if (!under) {
        _warmHidden.length = 0;
        const fxL = fx ? sharedFxLight : null;
        scene.traverse((o) => {
          if (!o.isPointLight || o === fxL) return;
          for (let a = o; a && a !== scene; a = a.parent) if (!a.visible && !_warmHidden.includes(a)) _warmHidden.push(a);
        });
        if (_warmHidden.length) {
          sl.spot.visible = false; sl.beam.visible = false;
          for (const o of _warmHidden) o.visible = true;
          compileNow(r, cam);
          for (const o of _warmHidden) o.visible = false;
        }
        _warmHidden.length = 0;
      }
    }
    sl.spot.visible = startOn; sl.beam.visible = startOn;
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  const api = {
    list, hitboxes, alertLevel: 0, update, spawnSquad,
    squads, nearest, callHelicopter, dispose, warmLightSets,
    get helicopter() { return heli; },
    get searchlight() { return searchlight; },
    get activeCount() { return aliveCount(); },
    firebase: { center: FB, lz: LZ, get wallRadius() { return wallR; }, get gate() { return gate; } },
  };

  let routes = {};
  try {
    initWorldRefs();
    rebuildGrid();
    refreshLosMeshes();
    detectWall();
    routes = buildRoutes();
    api.routes = routes;
    if (scene) {
      setupGarrison();
      // patrols: none within reach of the camp for the first 30 s
      spawnPatrol('riverFar', 5);
      spawnPatrol('jungle', 4);
      spawnPatrol('campRing', 5);
      spawnPatrol('perimeter', 4);
      findLZ();
      hueyModel = buildHuey();
      // build the reinforcement squad's models now so the alarm doesn't hitch
      for (let i = 0; i < HELI_TROOPS; i++) troopPool.push(new Soldier(kit, pickVariant('heli', i === HELI_TROOPS - 1 - 2)));
      warmLightSets();
    }
  } catch (err) {
    console.error('[enemies] init failed', err);
  }

  return api;
}
