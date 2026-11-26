// weapons.js — UNDERGROWTH
// First-person viewmodels (Type 56 rifle, entrenching tool, satchel charge, stick grenade,
// punji stakes, oil lamp), all weapon mechanics (hitscan, recoil, ADS, reload, digging, melee,
// demolition, grenades, trap placement) and every combat effect (muzzle flash, tracers, shells,
// impacts, explosions, fire and smoke). Everything is built from primitives and canvas textures.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WORLD, rand, noise2D, fbm, clamp, lerp, smoothstep, canvasTexture, events as utilEvents } from './util.js';

const TAU = Math.PI * 2;
const ITEMS = ['rifle', 'shovel', 'satchel', 'grenade', 'trap'];
const LABELS = {
  rifle: 'Type 56', shovel: 'Entrenching tool', satchel: 'Satchel charge',
  grenade: 'Stick grenade', trap: 'Punji stakes',
};

const CFG = {
  magSize: 30, startReserve: 120, startGrenades: 3, startSatchels: 1, startTraps: 3,
  fireInterval: 60 / 600, dmgBody: 34, dmgHead: 100, range: 420,
  adsFov: 50, adsTime: 0.17,
  reloadTime: 2.35, reloadEmptyTime: 2.95,
  tracerEvery: 4, tracerSpeed: 520, tracerLen: 7,
  spreadHip: 0.026, spreadAds: 0.0022, spreadMove: 0.035, spreadMoveAds: 0.006, bloomMax: 0.045,
  kickPitch: 0.0135, kickYaw: 0.0055,
  meleeRange: 2.3, meleeDamage: 110,
  digTimes: { cell: 1.2, hatch: 3.0, chamber: 4.0 },
  plantTime: 2.0, plantRange: 3.0, plantReach: 2.8, satchelFuse: 10,
  satchelRadius: 25, satchelDamage: 300,
  grenadeFuse: 4.0, grenadeRadius: 10, grenadeDamage: 160,
  trapTime: 0.9, trapRange: 4.2,
  switchDown: 0.17, switchUp: 0.26,
};

// ---------------------------------------------------------------------------------------------
// Small math helpers (allocation free)
// ---------------------------------------------------------------------------------------------

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler(), _m1 = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0), _ZAX = new THREE.Vector3(0, 0, 1);

const easeInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t));
const easeIn = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t);
// 0 → 1 → 0 bump over [a, b]
function bump(t, a, b) { if (t <= a || t >= b) return 0; const u = (t - a) / (b - a); return Math.sin(u * Math.PI); }
// segment ramp: 0 before a, 1 after b, smooth in between
function seg(t, a, b) { return easeInOut((t - a) / (b - a)); }
function damp(k, dt) { return 1 - Math.exp(-k * dt); }

// Critically-damped-ish spring on one scalar.
class Spring {
  constructor(k = 120, z = 0.75) { this.x = 0; this.v = 0; this.k = k; this.c = 2 * Math.sqrt(k) * z; }
  step(target, dt) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt;
    if (!Number.isFinite(this.x)) { this.x = 0; this.v = 0; }
    return this.x;
  }
  kick(v) { this.v += v; }
}

// ---------------------------------------------------------------------------------------------
// Procedural canvas textures
// ---------------------------------------------------------------------------------------------

function pixelFill(g, w, h, fn) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = clamp(out[0], 0, 255); d[i + 1] = clamp(out[1], 0, 255); d[i + 2] = clamp(out[2], 0, 255); d[i + 3] = clamp(out[3], 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
}

function blot(g, x, y, r, color, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${color},${a})`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function makeTextures() {
  const R = rand(56056);
  const T = {};

  // Reddish Chinese hardwood with satin varnish, grain running along U.
  T.wood = canvasTexture(512, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const band = fbm(x * 0.0035, y * 0.045, 4);
      const fine = noise2D(x * 0.02, y * 0.6) * 0.5 + noise2D(x * 0.05, y * 1.7) * 0.25;
      const l = 0.55 + band * 0.32 + fine * 0.16;
      o[0] = 92 * l + 18; o[1] = 40 * l + 8; o[2] = 20 * l + 4; o[3] = 255;
    });
    for (let i = 0; i < 260; i++) {
      const y0 = R() * h, amp = 0.6 + R() * 3.2, f = 0.002 + R() * 0.006, ph = R() * TAU;
      const dark = R() < 0.72;
      g.strokeStyle = dark ? `rgba(28,9,3,${0.12 + R() * 0.3})` : `rgba(170,96,52,${0.06 + R() * 0.12})`;
      g.lineWidth = 0.4 + R() * 1.6;
      g.beginPath();
      for (let x = -8; x <= w + 8; x += 8) {
        const y = y0 + Math.sin(x * f * TAU + ph) * amp + noise2D(x * 0.008, y0 * 0.05) * 4;
        if (x === -8) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(18,6,2,${R() * 0.28})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1); }
    for (let k = 0; k < 2; k++) {
      const kx = 80 + R() * (w - 160), ky = 40 + R() * (h - 80);
      for (let r = 14; r > 1; r -= 2) {
        g.strokeStyle = `rgba(30,10,4,${0.18 + (14 - r) * 0.03})`; g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(kx, ky, r * 2.4, r * 0.8, 0, 0, TAU); g.stroke();
      }
    }
    for (let i = 0; i < 40; i++) blot(g, R() * w, R() * h, 12 + R() * 46, '196,128,80', 0.08);
    for (let i = 0; i < 25; i++) blot(g, R() * w, R() * h, 8 + R() * 30, '20,8,3', 0.12);
  });

  // Blued / parkerised steel: dark, faint brushing, worn speckle.
  T.steel = canvasTexture(256, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = fbm(x * 0.03, y * 0.03, 3) * 10 + (R() - 0.5) * 16 + noise2D(x * 0.6, y * 0.02) * 4;
      o[0] = 62 + n; o[1] = 64 + n; o[2] = 70 + n; o[3] = 255;
    });
    for (let i = 0; i < 60; i++) blot(g, R() * w, R() * h, 3 + R() * 14, '150,150,150', 0.12);
    for (let i = 0; i < 20; i++) blot(g, R() * w, R() * h, 2 + R() * 6, '96,58,32', 0.25);
  });
  T.steelRough = canvasTexture(128, 128, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = 150 + fbm(x * 0.06, y * 0.06, 3) * 60 + (R() - 0.5) * 30;
      o[0] = o[1] = o[2] = n; o[3] = 255;
    });
  }, { srgb: false });

  // Black cotton weave, sun faded, with dust.
  const weave = (x, y) => (((x >> 1) + (y >> 1)) & 1 ? 1 : -1) * (((x + y) & 1) ? 0.6 : 1);
  T.cloth = canvasTexture(256, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const fade = fbm(x * 0.012, y * 0.012, 4) * 8;
      const n = 25 + weave(x, y) * 5 + fade + (R() - 0.5) * 6;
      o[0] = n + 1; o[1] = n + 1; o[2] = n + 4; o[3] = 255;
    });
    for (let i = 0; i < 40; i++) blot(g, R() * w, R() * h, 10 + R() * 40, '92,70,48', 0.12);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const x = R() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 20, h * 0.3, x - 20, h * 0.6, x + 10, h); g.stroke(); }
  });
  T.clothBump = canvasTexture(128, 128, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => { const n = 128 + weave(x, y) * 60; o[0] = o[1] = o[2] = n; o[3] = 255; });
  }, { srgb: false });

  // Sun-darkened skin with dirt from digging.
  T.skin = canvasTexture(128, 128, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = fbm(x * 0.05, y * 0.05, 3) * 12 + (R() - 0.5) * 8;
      o[0] = 150 + n; o[1] = 101 + n * 0.8; o[2] = 70 + n * 0.6; o[3] = 255;
    });
    for (let i = 0; i < 26; i++) blot(g, R() * w, R() * h, 4 + R() * 18, '74,52,34', 0.32);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(60,40,25,${R() * 0.3})`; g.fillRect(R() * w, R() * h, 1, 1); }
  });

  // Olive canvas for the satchel, straps.
  T.canvas = canvasTexture(256, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = weave(x, y) * 6 + fbm(x * 0.015, y * 0.015, 4) * 14 + (R() - 0.5) * 8;
      o[0] = 96 + n; o[1] = 92 + n; o[2] = 58 + n * 0.7; o[3] = 255;
    });
    for (let i = 0; i < 30; i++) blot(g, R() * w, R() * h, 10 + R() * 40, '50,40,24', 0.22);
  });

  // Bamboo: fibres along V (cylinder length), nodes at intervals, fire-hardened tip at the top.
  T.bamboo = canvasTexture(64, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const fib = noise2D(x * 0.9, y * 0.01) * 10 + (R() - 0.5) * 8;
      const tip = smoothstep(0.24, 0.03, y / h);
      const node = Math.exp(-Math.pow((y - h * 0.4) / 2.2, 2)) + Math.exp(-Math.pow((y - h * 0.78) / 2.2, 2));
      const l = 1 - tip * 0.72 - node * 0.35;
      o[0] = (178 + fib) * l; o[1] = (152 + fib) * l; o[2] = (92 + fib * 0.6) * l; o[3] = 255;
    });
  });

  // Chicom grenade head: olive drab paint, chipped.
  T.grenade = canvasTexture(128, 128, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = fbm(x * 0.06, y * 0.06, 3) * 10 + (R() - 0.5) * 6;
      o[0] = 58 + n; o[1] = 68 + n; o[2] = 46 + n; o[3] = 255;
    });
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,118,112,${0.4 + R() * 0.4})`;
      g.beginPath(); const x = R() * w, y = R() * h;
      g.moveTo(x, y); for (let k = 0; k < 5; k++) g.lineTo(x + (R() - 0.5) * 6, y + (R() - 0.5) * 6); g.fill();
    }
    g.fillStyle = 'rgba(150,40,30,0.8)'; g.fillRect(0, 54, w, 5);
  });

  // Spade blade: grey steel, bright scratches, caked mud toward the tip (top of canvas).
  T.blade = canvasTexture(256, 256, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = fbm(x * 0.02, y * 0.02, 3) * 14 + (R() - 0.5) * 12;
      const mud = smoothstep(0.62, 0.05, y / h + fbm(x * 0.02, y * 0.03, 3) * 0.25);
      o[0] = lerp(104 + n, 84 + n * 0.6, mud); o[1] = lerp(106 + n, 62 + n * 0.5, mud); o[2] = lerp(110 + n, 40 + n * 0.4, mud); o[3] = 255;
    });
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(200,200,195,${0.08 + R() * 0.25})`; g.lineWidth = 0.6;
      const x = R() * w, y = h * 0.3 + R() * h * 0.7, l = 10 + R() * 40, a = -1.2 + R() * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });

  // Rusty tin for the lamp.
  T.tin = canvasTexture(128, 128, (g, w, h) => {
    pixelFill(g, w, h, (x, y, o) => {
      const n = fbm(x * 0.05, y * 0.05, 3) * 18 + (R() - 0.5) * 10;
      const rust = smoothstep(0.1, 0.6, fbm(x * 0.03 + 9, y * 0.03, 4));
      o[0] = lerp(122 + n, 112 + n, rust); o[1] = lerp(118 + n, 62 + n * 0.6, rust); o[2] = lerp(104 + n, 34 + n * 0.4, rust); o[3] = 255;
    });
  });

  // Particle atlas 4x2 tiles of 256 px:
  // 0 smoke A, 1 smoke B, 2 flame, 3 spark, 4 leaf A, 5 leaf B, 6 debris, 7 droplets
  T.atlas = canvasTexture(1024, 512, (g) => {
    const tile = document.createElement('canvas'); tile.width = tile.height = 256;
    const t = tile.getContext('2d');
    const put = (i) => { g.drawImage(tile, (i % 4) * 256, Math.floor(i / 4) * 256); t.clearRect(0, 0, 256, 256); t.globalCompositeOperation = 'source-over'; };
    const smoke = (seed) => {
      const r = rand(seed);
      for (let k = 0; k < 46; k++) {
        const a = r() * TAU, d = Math.pow(r(), 0.7) * 70;
        const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rr = 26 + r() * 46;
        const gr = t.createRadialGradient(x, y, 0, x, y, rr);
        const v = 215 + r() * 40 | 0;
        gr.addColorStop(0, `rgba(${v},${v},${v},${0.16 + r() * 0.18})`);
        gr.addColorStop(0.6, `rgba(${v},${v},${v},${0.06 + r() * 0.05})`);
        gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        t.fillStyle = gr; t.fillRect(0, 0, 256, 256);
      }
      t.globalCompositeOperation = 'destination-in';
      const m = t.createRadialGradient(128, 128, 20, 128, 128, 126);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.65, 'rgba(0,0,0,0.75)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      t.fillStyle = m; t.fillRect(0, 0, 256, 256);
    };
    smoke(11); put(0);
    smoke(23); put(1);
    { // flame: turbulent hot core
      const r = rand(77);
      for (let k = 0; k < 30; k++) {
        const a = r() * TAU, d = Math.pow(r(), 1.3) * 56;
        const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rr = 30 + r() * 50;
        const gr = t.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, `rgba(255,255,255,${0.22 + r() * 0.2})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        t.fillStyle = gr; t.fillRect(0, 0, 256, 256);
      }
      t.globalCompositeOperation = 'destination-in';
      const m = t.createRadialGradient(128, 128, 10, 128, 128, 124);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      t.fillStyle = m; t.fillRect(0, 0, 256, 256);
      put(2);
    }
    { // spark
      const gr = t.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      t.fillStyle = gr; t.fillRect(0, 0, 256, 256); put(3);
    }
    const leaf = (broad, seed) => {
      const r = rand(seed);
      t.save(); t.translate(128, 128); t.rotate(0.5);
      const L = 110, W = broad ? 52 : 30;
      t.beginPath(); t.moveTo(-L, 0);
      t.bezierCurveTo(-L * 0.4, -W * 1.2, L * 0.5, -W, L, 0);
      t.bezierCurveTo(L * 0.5, W, -L * 0.4, W * 1.2, -L, 0);
      t.fillStyle = '#e4e8dc'; t.fill();
      if (broad) { t.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 4; k++) { t.beginPath(); t.arc(-L * 0.6 + r() * L * 1.4, (r() - 0.5) * W * 1.6, 8 + r() * 14, 0, TAU); t.fill(); } t.globalCompositeOperation = 'source-over'; }
      t.strokeStyle = 'rgba(120,130,100,0.9)'; t.lineWidth = 3;
      t.beginPath(); t.moveTo(-L, 0); t.lineTo(L * 0.95, 0); t.stroke();
      t.lineWidth = 1.2;
      for (let k = -4; k <= 4; k++) { if (!k) continue; const x = k * L * 0.2; t.beginPath(); t.moveTo(x, 0); t.lineTo(x + L * 0.18, Math.sign(k) * W * 0.7); t.stroke(); }
      t.restore();
    };
    leaf(false, 5); put(4);
    leaf(true, 9); put(5);
    { // debris chunks
      const r = rand(31);
      for (let k = 0; k < 9; k++) {
        const cx = 40 + r() * 176, cy = 40 + r() * 176, s = 10 + r() * 26;
        t.beginPath();
        for (let j = 0; j < 7; j++) { const a = j / 7 * TAU, rr = s * (0.6 + r() * 0.5); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (j) t.lineTo(px, py); else t.moveTo(px, py); }
        t.closePath();
        const v = 150 + r() * 90 | 0;
        t.fillStyle = `rgb(${v},${v},${v})`; t.fill();
        t.strokeStyle = 'rgba(60,60,60,0.8)'; t.lineWidth = 2; t.stroke();
      }
      put(6);
    }
    { // droplets
      const r = rand(41);
      for (let k = 0; k < 26; k++) {
        const a = r() * TAU, d = Math.pow(r(), 0.6) * 100;
        const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rr = 3 + r() * 11;
        const gr = t.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        t.fillStyle = gr; t.beginPath(); t.arc(x, y, rr, 0, TAU); t.fill();
      }
      put(7);
    }
  }, { repeat: false });

  // Bullet hole / chip decal.
  T.hole = canvasTexture(128, 128, (g) => {
    const r = rand(3);
    blot(g, 64, 64, 60, '20,16,12', 0.55);
    for (let k = 0; k < 14; k++) blot(g, 64 + (r() - 0.5) * 50, 64 + (r() - 0.5) * 50, 6 + r() * 12, '18,14,10', 0.35);
    blot(g, 64, 64, 14, '5,4,3', 1);
    blot(g, 64, 64, 8, '0,0,0', 1);
  }, { repeat: false });

  // Scorch mark.
  T.scorch = canvasTexture(256, 256, (g) => {
    const r = rand(17);
    blot(g, 128, 128, 128, '10,8,6', 0.85);
    for (let k = 0; k < 40; k++) {
      const a = r() * TAU, d = 30 + r() * 80;
      blot(g, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 10 + r() * 30, '12,10,8', 0.45);
    }
    g.strokeStyle = 'rgba(6,5,4,0.5)';
    for (let k = 0; k < 30; k++) { const a = r() * TAU; g.lineWidth = 1 + r() * 4; g.beginPath(); g.moveTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40); g.lineTo(128 + Math.cos(a) * (90 + r() * 36), 128 + Math.sin(a) * (90 + r() * 36)); g.stroke(); }
  }, { repeat: false });

  // Muzzle flash: front star and side petals.
  T.flashStar = canvasTexture(256, 256, (g) => {
    const r = rand(91);
    g.globalCompositeOperation = 'lighter';
    g.translate(128, 128);
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU + r() * 0.4, L = 80 + r() * 46, W = 12 + r() * 10;
      g.save(); g.rotate(a);
      const gr = g.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.5, 'rgba(255,170,70,0.45)'); gr.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -W); g.quadraticCurveTo(L * 0.4, -W * 0.4, L, 0); g.quadraticCurveTo(L * 0.4, W * 0.4, 0, W); g.fill();
      g.restore();
    }
    const c = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    c.addColorStop(0, 'rgba(255,255,240,1)'); c.addColorStop(0.35, 'rgba(255,210,120,0.8)'); c.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = c; g.fillRect(-128, -128, 256, 256);
  }, { repeat: false });
  T.flashSide = canvasTexture(256, 128, (g) => {
    const r = rand(92);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) {
      const L = 150 + r() * 100, W = 18 + r() * 22, off = (r() - 0.5) * 18;
      const gr = g.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, 'rgba(255,245,210,0.95)'); gr.addColorStop(0.4, 'rgba(255,170,70,0.6)'); gr.addColorStop(1, 'rgba(255,100,20,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 64 - W * 0.5 + off); g.quadraticCurveTo(L * 0.45, 64 - W + off, L, 64 + off * 2); g.quadraticCurveTo(L * 0.45, 64 + W + off, 0, 64 + W * 0.5 + off); g.fill();
    }
  }, { repeat: false });

  // Oil-lamp flame.
  T.lampFlame = canvasTexture(64, 128, (g) => {
    const gr = g.createRadialGradient(32, 84, 2, 32, 74, 40);
    gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.35, 'rgba(255,196,96,0.9)');
    gr.addColorStop(0.7, 'rgba(255,120,30,0.35)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(32, 6); g.bezierCurveTo(52, 50, 54, 92, 32, 116); g.bezierCurveTo(10, 92, 12, 50, 32, 6); g.fill();
    blot(g, 32, 110, 9, '120,150,255', 0.45);
  }, { repeat: false });

  return T;
}

// Equirect "jungle sky" used to give the viewmodel metal believable reflections.
function makeEnvMap(renderer) {
  if (!renderer || typeof THREE.PMREMGenerator !== 'function') return null;
  try {
    const tex = canvasTexture(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#d8e4c8'); gr.addColorStop(0.32, '#9fb486'); gr.addColorStop(0.5, '#59683f');
      gr.addColorStop(0.56, '#2e2c1f'); gr.addColorStop(1, '#141310');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = rand(8);
      for (let i = 0; i < 70; i++) blot(g, r() * w, r() * h * 0.5, 6 + r() * 20, '34,52,24', 0.55);
      blot(g, w * 0.3, h * 0.18, 16, '255,244,214', 0.9);
    }, { repeat: false });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromEquirectangular(tex);
    pm.dispose(); tex.dispose();
    return rt.texture;
  } catch (e) {
    console.warn('[weapons] env map unavailable', e);
    return null;
  }
}

// Viewmodel depth squeeze: keeps the hands and weapon in front of walls without a second pass.
const VM_DEPTH = 0.06;

// Viewmodel-only lamp lighting. Underground the hands and tools sit centimetres from the oil
// lamp, where a physical point light either blows them out or (when it has to be pulled in front
// of a close tunnel face) backlights them into silhouettes. Viewmodel materials therefore scale
// the scene's direct light by uVmDirect and add their own soft, wrapped lamp term evaluated in
// view space from the real flame position.
function makeVmLampUniforms() {
  return {
    uVmLampPos: { value: new THREE.Vector3(-0.145, -0.1, -0.32) }, // view space
    uVmLampCol: { value: new THREE.Color(0, 0, 0) },              // linear, 0 = off
    uVmLampK: { value: 14.0 },                                     // inverse-square softness
    uVmLampBounce: { value: 0.25 },                                // light returned by nearby clay
    uVmDirect: { value: 1.0 },                                     // scene direct-light scale
  };
}
const VM_LAMP_PARS = /* glsl */`
uniform vec3 uVmLampPos;
uniform vec3 uVmLampCol;
uniform float uVmLampK;
uniform float uVmLampBounce;
uniform float uVmDirect;
`;
const VM_LAMP_FRAG = /* glsl */`
{
  vec3 lv = uVmLampPos + vViewPosition; // fragment -> flame (fragment sits at -vViewPosition)
  float ld = max(length(lv), 1e-3);
  vec3 ll = lv / ld;
  float wrapD = max(dot(normal, ll) * 0.6 + 0.4, 0.0) + uVmLampBounce;
  float att = 1.0 / (1.0 + ld * ld * uVmLampK);
  vec3 hv = normalize(ll + normalize(vViewPosition));
  float sp = pow(max(dot(normal, hv), 0.0), mix(48.0, 6.0, roughnessFactor)) * (0.05 + metalnessFactor * 0.6) * (1.15 - roughnessFactor);
  totalEmissiveRadiance += uVmLampCol * att * (diffuseColor.rgb * (1.0 - metalnessFactor * 0.55) * wrapD + sp);
}
`;

function applyViewmodelDepth(m, lampU = null) {
  const lit = !!lampU && m.isMeshStandardMaterial;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>',
      `#include <project_vertex>\n  gl_Position.z = mix(-gl_Position.w, gl_Position.z, ${VM_DEPTH.toFixed(3)});`);
    if (lit) {
      Object.assign(sh.uniforms, lampU);
      sh.fragmentShader = VM_LAMP_PARS + sh.fragmentShader
        .replace('#include <lights_physical_fragment>', VM_LAMP_FRAG + '#include <lights_physical_fragment>')
        .replace('#include <aomap_fragment>',
          'reflectedLight.directDiffuse *= uVmDirect;\n  reflectedLight.directSpecular *= uVmDirect;\n  #include <aomap_fragment>');
    }
  };
  m.customProgramCacheKey = () => (lit ? 'undergrowth-vm-depth-lamp' : 'undergrowth-vm-depth');
  return m;
}

function makeMaterials(T, envMap, vm, lampU = null) {
  const list = [];
  const std = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    if (envMap) { m.envMap = envMap; m.envMapIntensity = o.envMapIntensity ?? 0.5; }
    m.userData.baseEnv = m.envMapIntensity;
    if (vm) applyViewmodelDepth(m, lampU);
    list.push(m);
    return m;
  };
  const M = {
    wood: std({ map: T.wood, roughness: 0.48, metalness: 0.0, envMapIntensity: 0.35 }),
    woodDark: std({ map: T.wood, color: 0x9a7a68, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.3 }),
    steel: std({ map: T.steel, roughnessMap: T.steelRough, color: 0xb4b4b8, roughness: 0.58, metalness: 0.7, envMapIntensity: 0.6 }),
    blackSteel: std({ map: T.steel, roughnessMap: T.steelRough, color: 0x7a7a80, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.6 }),
    black: std({ color: 0x0b0b0c, roughness: 0.85, metalness: 0.2, envMapIntensity: 0.2 }),
    skin: std({ map: T.skin, roughness: 0.72, metalness: 0.0, envMapIntensity: 0.25 }),
    sleeve: std({ map: T.cloth, bumpMap: T.clothBump, bumpScale: 0.35, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.12 }),
    canvas: std({ map: T.canvas, bumpMap: T.clothBump, bumpScale: 0.3, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.15 }),
    strap: std({ map: T.canvas, color: 0x837a5a, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.12 }),
    brass: std({ color: 0x9c8452, roughness: 0.38, metalness: 0.85, envMapIntensity: 1.0 }),
    caseSteel: std({ color: 0x7d6a3e, roughness: 0.35, metalness: 0.8, envMapIntensity: 1.0 }),
    grenade: std({ map: T.grenade, roughness: 0.62, metalness: 0.25, envMapIntensity: 0.4 }),
    blade: std({ map: T.blade, roughness: 0.6, metalness: 0.55, envMapIntensity: 0.6 }),
    bamboo: std({ map: T.bamboo, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.3 }),
    cord: std({ color: 0x8b7a55, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.1 }),
    tin: std({ map: T.tin, roughness: 0.6, metalness: 0.5, envMapIntensity: 0.6 }),
    wick: std({ color: 0x241c14, roughness: 1.0, metalness: 0.0, emissive: 0x3a1a05, emissiveIntensity: 1.0, envMapIntensity: 0 }),
  };
  M.list = list;
  return M;
}

// ---------------------------------------------------------------------------------------------
// Geometry builder: transforms many primitive parts and merges them into one mesh per material.
// ---------------------------------------------------------------------------------------------

function toPNU(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

function mergeList(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

function mirrorX(geo) {
  geo.scale(-1, 1, 1);
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name]; const s = a.itemSize; const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < s; k++) { const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
    }
    a.needsUpdate = true;
  }
  geo.computeBoundingSphere();
  return geo;
}

class Builder {
  constructor() { this.parts = new Map(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); }
  _push(mat, g) { if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, uvs = 1) {
    this._e.set(rx, ry, rz); this._q.setFromEuler(this._e);
    return this.addQ(mat, geo, x, y, z, this._q, sx, sy, sz, uvs);
  }
  addQ(mat, geo, x, y, z, q, sx = 1, sy = 1, sz = 1, uvs = 1) {
    const g = toPNU(geo);
    if (uvs !== 1) {
      const a = g.attributes.uv.array; const su = Array.isArray(uvs) ? uvs[0] : uvs, sv = Array.isArray(uvs) ? uvs[1] : uvs;
      for (let i = 0; i < a.length; i += 2) { a[i] *= su; a[i + 1] *= sv; }
    }
    this._m.compose(this._p.set(x, y, z), q, this._s.set(sx, sy, sz));
    g.applyMatrix4(this._m);
    this._push(mat, g);
    return this;
  }
  // Axis-aligned box from coordinate ranges.
  box(mat, x0, x1, y0, y1, z0, z1, uvs = 1) {
    return this.add(mat, new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, uvs);
  }
  // Cylinder between two points (radius r0 at a, r1 at b).
  rod(mat, r0, r1, ax, ay, az, bx, by, bz, seg = 10, uvs = 1) {
    const d = _v1.set(bx - ax, by - ay, bz - az); const L = d.length() || 1e-4; d.divideScalar(L);
    _q1.setFromUnitVectors(_UP, d);
    return this.addQ(mat, new THREE.CylinderGeometry(r1, r0, L, seg, 1), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, _q1, 1, 1, 1, uvs);
  }
  capsule(mat, r, ax, ay, az, bx, by, bz, seg = 8) {
    const d = _v1.set(bx - ax, by - ay, bz - az); const L = d.length() || 1e-4; d.divideScalar(L);
    _q1.setFromUnitVectors(_UP, d);
    return this.addQ(mat, new THREE.CapsuleGeometry(r, L, 3, seg), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, _q1);
  }
  ring(mat, R, tube, x, y, z, nx, ny, nz, seg = 16, arc = TAU) {
    _q1.setFromUnitVectors(_ZAX, _v1.set(nx, ny, nz).normalize());
    return this.addQ(mat, new THREE.TorusGeometry(R, tube, 6, seg, arc), x, y, z, _q1);
  }
  geometries(mirror = false) {
    const out = new Map();
    for (const [mat, list] of this.parts) { const g = mergeList(list); if (mirror) mirrorX(g); out.set(mat, g); }
    this.parts.clear();
    return out;
  }
}

function meshGroup(geos, mats, { shadow = false, receive = true, name = '' } = {}) {
  const grp = new THREE.Group(); grp.name = name;
  for (const [key, g] of geos) {
    const mat = mats[key] || mats.steel;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = receive;
    grp.add(m);
  }
  return grp;
}

// Profile in (z, y) extruded across X, with rounded edges. pts: [[z,y],...]
function profileGeo(pts, width, bevel = 0.006, curveSeg = 3) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const depth = Math.max(0.002, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: curveSeg, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // extrude axis → X, profile u → +Z
  return g;
}

// Rounded rectangle (w × h in XY) extruded along +Z over len, centred on origin in z.
function roundedBarGeo(w, h, len, r, bevel = 0.002) {
  const s = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  s.moveTo(x0, -h / 2);
  s.lineTo(x1, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, y0);
  s.lineTo(w / 2, y1); s.quadraticCurveTo(w / 2, h / 2, x1, h / 2);
  s.lineTo(x0, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y1);
  s.lineTo(-w / 2, y0); s.quadraticCurveTo(-w / 2, -h / 2, x0, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -len / 2);
  return g;
}

function roundedBoxGeo(w, h, d, r) {
  const iw = Math.max(0.002, w - r * 2), ih = Math.max(0.002, h - r * 2);
  return roundedBarGeo(iw, ih, Math.max(0.001, d - r * 2), Math.min(iw, ih) * 0.25, r);
}

// Apply a per-vertex warp function to a geometry's positions (and recompute normals).
function warp(geo, fn) {
  const p = geo.attributes.position; const v = _v2;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Curved 30-round magazine swept along an arc. Origin = front-top lip (rocking pivot).
function magazineGeo(builder, mat, opt = {}) {
  const R = opt.R ?? 0.3, span = opt.span ?? 0.66, seg = 14;
  const w = 0.0265, d0 = 0.06, d1 = 0.068;
  const sides = [[], [], [], []]; // front, back, left, right: arrays of [x,y,z]
  const pt = (a, back, x) => {
    const d = lerp(d0, d1, a / span) * back;
    const z = -R + R * Math.cos(a) + d * Math.cos(a);
    const y = -R * Math.sin(a) - d * Math.sin(a);
    return [x, y + 0.012, z];
  };
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * span;
    sides[0].push(pt(a, 0, -w / 2), pt(a, 0, w / 2));
    sides[1].push(pt(a, 1, w / 2), pt(a, 1, -w / 2));
    sides[2].push(pt(a, 0, -w / 2), pt(a, 1, -w / 2));
    sides[3].push(pt(a, 1, w / 2), pt(a, 0, w / 2));
  }
  const expect = [(a) => [0, Math.sin(a), -Math.cos(a)], (a) => [0, -Math.sin(a), Math.cos(a)], () => [-1, 0, 0], () => [1, 0, 0]];
  for (let s = 0; s < 4; s++) {
    const verts = sides[s];
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      for (let k = 0; k < 2; k++) { const v = verts[i * 2 + k]; pos.push(v[0], v[1], v[2]); uv.push(k, i / seg * 3); }
    }
    for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // fix winding if the computed normal points inward
    const n = g.attributes.normal; const e = expect[s](span * 0.5);
    const mid = Math.floor(seg / 2) * 2;
    if (n.getX(mid) * e[0] + n.getY(mid) * e[1] + n.getZ(mid) * e[2] < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }
    builder.add(mat, g);
  }
  // floor plate
  const aE = span, dE = d1;
  const cz = -R + R * Math.cos(aE) + dE * 0.5 * Math.cos(aE), cy = -R * Math.sin(aE) - dE * 0.5 * Math.sin(aE) + 0.012;
  const tz = -Math.sin(aE), ty = -Math.cos(aE);
  builder.add(mat, new THREE.BoxGeometry(w + 0.004, 0.007, dE + 0.006), 0, cy + ty * 0.0025, cz + tz * 0.0025, aE, 0, 0);
  // reinforcing ribs on the side
  for (let i = 0; i < 2; i++) {
    const a = span * (0.35 + i * 0.35);
    const z = -R + R * Math.cos(a) + d0 * 0.5 * Math.cos(a), y = -R * Math.sin(a) - d0 * 0.5 * Math.sin(a) + 0.012;
    builder.add(mat, new THREE.BoxGeometry(w + 0.0022, 0.004, d0 * 0.7), 0, y, z, a, 0, 0);
  }
  // locking lugs
  builder.box(mat, -0.006, 0.006, 0.004, 0.012, -0.004, 0.004);
  builder.box(mat, -0.008, 0.008, 0.002, 0.012, 0.054, 0.062);
}

// ---------------------------------------------------------------------------------------------
// Hands and forearms
// ---------------------------------------------------------------------------------------------

// Right hand closed around a cylinder of radius gripR whose axis is local +Y (index finger on
// top). Palm sits on +X, fingers wrap through -Z to -X, wrist behind on +Z. `fore` is the
// forearm direction in this local frame.
function handParts(B, fore, gripR = 0.017) {
  const R = gripR, px = R + 0.0105;
  B.add('skin', new THREE.SphereGeometry(1, 14, 10), px + 0.002, -0.002, 0.034, 0, 0, 0, 0.0145, 0.041, 0.046);
  B.add('skin', new THREE.SphereGeometry(1, 12, 8), px - 0.004, 0.0, 0.03, 0, 0, 0, 0.012, 0.038, 0.04);
  B.capsule('skin', 0.0098, px - 0.001, -0.03, -0.004, px - 0.001, 0.03, -0.004, 8);
  B.capsule('skin', 0.012, px + 0.002, -0.026, 0.05, px + 0.002, 0.026, 0.05, 8);
  const fingers = [[0.0292, 0.0083, 1.0], [0.0095, 0.0088, 1.05], [-0.0105, 0.0084, 0.98], [-0.0292, 0.0073, 0.86]];
  for (const [fy, fr, L] of fingers) {
    const rr = R + fr * 0.92;
    let ax = px - 0.002, ay = fy, az = -0.008;
    const angs = [60, 116 * L, 166 * L];
    for (let i = 0; i < 3; i++) {
      const a = angs[i] * Math.PI / 180;
      const bx = rr * Math.cos(a), by = fy - (i + 1) * 0.0016, bz = -rr * Math.sin(a);
      B.capsule('skin', fr * (1 - i * 0.07), ax, ay, az, bx, by, bz, 7);
      ax = bx; ay = by; az = bz;
    }
  }
  // thumb
  B.capsule('skin', 0.0108, px - 0.004, 0.026, 0.062, 0.008, 0.044, 0.04, 7);
  B.capsule('skin', 0.0098, 0.008, 0.044, 0.04, -0.013, 0.047, 0.021, 7);
  B.capsule('skin', 0.0089, -0.013, 0.047, 0.021, -0.025, 0.042, 0.0, 7);
  // heel of the hand
  B.capsule('skin', 0.0135, px - 0.004, 0.016, 0.072, px - 0.006, -0.028, 0.072, 7);
  // wrist + sleeve
  const f = _v3.copy(fore).normalize();
  const wx = px - 0.003, wy = -0.004, wz = 0.084;
  B.rod('skin', 0.0235, 0.0265, wx - f.x * 0.004, wy - f.y * 0.004, wz - f.z * 0.004, wx + f.x * 0.07, wy + f.y * 0.07, wz + f.z * 0.07, 12);
  const sx = wx + f.x * 0.04, sy = wy + f.y * 0.04, sz = wz + f.z * 0.04;
  B.rod('sleeve', 0.0335, 0.048, sx, sy, sz, sx + f.x * 0.34, sy + f.y * 0.34, sz + f.z * 0.34, 14, [2, 2]);
  B.ring('sleeve', 0.0335, 0.0058, sx, sy, sz, f.x, f.y, f.z, 14);
  B.ring('sleeve', 0.0395, 0.0048, sx + f.x * 0.12, sy + f.y * 0.12 - 0.002, sz + f.z * 0.12, f.x, f.y + 0.15, f.z, 14);
  B.ring('sleeve', 0.0435, 0.0045, sx + f.x * 0.22, sy + f.y * 0.22, sz + f.z * 0.22, f.x + 0.1, f.y, f.z, 14);
}

// Builds an arm whose hand grips at the group origin.
//  gripAxis: direction in the PARENT (tool) frame from little finger to index finger.
//  palmSide: direction in CAMERA space from the grip axis toward the palm.
//  forearm:  direction in CAMERA space from the wrist toward the elbow.
//  parentRot: the tool's resting rotation in camera space (Euler XYZ) used to convert.
function makeArm(mats, side, gripAxis, palmSide, forearm, parentRot = [0, 0, 0], gripR = 0.017, twist = 0) {
  const inv = new THREE.Quaternion().setFromEuler(new THREE.Euler(parentRot[0], parentRot[1], parentRot[2])).invert();
  const Y = new THREE.Vector3(...gripAxis).normalize();
  const X = new THREE.Vector3(...palmSide).applyQuaternion(inv);
  X.addScaledVector(Y, -X.dot(Y)).normalize();
  if (side === 'left') X.negate();
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), twist));
  const fLocal = new THREE.Vector3(...forearm).normalize().applyQuaternion(inv).applyQuaternion(q.clone().invert());
  if (side === 'left') fLocal.x = -fLocal.x;
  const B = new Builder();
  handParts(B, fLocal, gripR);
  const grp = meshGroup(B.geometries(side === 'left'), mats, { name: side + 'Arm' });
  grp.quaternion.copy(q);
  grp.userData.baseQuat = q.clone();
  grp.userData.hand = { side, fLocal: fLocal.clone(), gripR };
  return grp;
}

// Sleeve only, for arms that use the scanned hand model (assets/hand.glb). The model's wrist sits
// at HAND_WRIST in the same hand frame as handParts.
const HAND_WRIST = new THREE.Vector3(0.0059, -0.0205, 0.1045);
const HAND_REF_R = 0.017;
function sleeveParts(B, fore) {
  const f = _v3.copy(fore).normalize();
  const sx = HAND_WRIST.x - f.x * 0.004, sy = HAND_WRIST.y - f.y * 0.004, sz = HAND_WRIST.z - f.z * 0.004;
  B.rod('sleeve', 0.039, 0.05, sx, sy, sz, sx + f.x * 0.34, sy + f.y * 0.34, sz + f.z * 0.34, 16, [2, 2]);
  B.ring('sleeve', 0.039, 0.0062, sx, sy, sz, f.x, f.y, f.z, 16);
  B.ring('sleeve', 0.042, 0.005, sx + f.x * 0.12, sy + f.y * 0.12 - 0.002, sz + f.z * 0.12, f.x, f.y + 0.15, f.z, 16);
  B.ring('sleeve', 0.046, 0.0047, sx + f.x * 0.22, sy + f.y * 0.22, sz + f.z * 0.22, f.x + 0.1, f.y, f.z, 16);
}

// ---------------------------------------------------------------------------------------------
// Type 56 assault rifle. Origin = rear sight notch (sight line), bore 5 cm below, muzzle -Z.
// ---------------------------------------------------------------------------------------------

const BORE = -0.05;
const RIFLE_MAG_PIVOT = new THREE.Vector3(0, -0.086, 0.076);

function buildRifleGeos() {
  const B = new Builder();
  // barrel, muzzle nut, bore
  B.rod('blackSteel', 0.0108, 0.0104, 0, BORE, -0.03, 0, BORE, -0.272, 14, [1, 3]);
  B.rod('blackSteel', 0.0096, 0.0094, 0, BORE, -0.272, 0, BORE, -0.474, 14, [1, 3]);
  B.rod('blackSteel', 0.0118, 0.0112, 0, BORE, -0.472, 0, BORE, -0.491, 14);
  B.rod('black', 0.0048, 0.0048, 0, BORE, -0.488, 0, BORE, -0.4925, 10);
  // gas block + gas tube
  B.box('steel', -0.0128, 0.0128, BORE - 0.012, -0.015, -0.306, -0.272);
  B.add('steel', new THREE.BoxGeometry(0.02, 0.014, 0.018), 0, -0.02, -0.268, 0.5, 0, 0);
  B.rod('steel', 0.0094, 0.0094, 0, -0.0225, -0.03, 0, -0.0225, -0.292, 12, [1, 3]);
  // upper handguard (wood over the gas tube)
  B.add('wood', new THREE.CylinderGeometry(0.0146, 0.0158, 0.156, 18), 0, -0.0218, -0.111, Math.PI / 2, 0, 0, 1.22, 1, 1, [2, 1]);
  B.ring('steel', 0.0172, 0.0022, 0, -0.022, -0.19, 0, 0, 1, 18);
  // lower handguard: rounded, tapered, with a palm swell
  {
    const g = roundedBarGeo(0.044, 0.035, 0.2, 0.012, 0.003);
    warp(g, (v) => {
      const t = (v.z + 0.1) / 0.2; // 0 front → 1 rear
      v.x *= 1 + 0.08 * t;
      if (v.y < 0) v.y *= 1 + 0.12 * t + 0.18 * Math.sin(Math.PI * clamp(t * 1.15, 0, 1));
    });
    B.add('wood', g, 0, -0.066, -0.136, 0, 0, 0, 1, 1, 1, 7);
  }
  B.box('steel', -0.0245, 0.0245, -0.088, -0.047, -0.252, -0.236);
  // front sight: base, tower, closed hood, post
  B.box('steel', -0.0122, 0.0122, BORE - 0.014, BORE + 0.008, -0.399, -0.361);
  B.box('steel', -0.0076, 0.0076, BORE + 0.008, -0.019, -0.391, -0.367);
  B.add('steel', new THREE.CylinderGeometry(0.0122, 0.0122, 0.013, 20, 1, true), 0, -0.0085, -0.377, Math.PI / 2, 0, 0);
  B.add('steel', new THREE.CylinderGeometry(0.0106, 0.0106, 0.013, 20, 1, true), 0, -0.0085, -0.377, Math.PI / 2, 0, 0);
  B.ring('steel', 0.0114, 0.0009, 0, -0.0085, -0.3705, 0, 0, 1, 20);
  B.ring('steel', 0.0114, 0.0009, 0, -0.0085, -0.3835, 0, 0, 1, 20);
  B.box('blackSteel', -0.0009, 0.0009, -0.017, 0.0, -0.3795, -0.3765);
  // folding spike bayonet + cleaning rod
  B.box('steel', -0.0085, 0.0085, BORE - 0.032, BORE - 0.012, -0.402, -0.37);
  B.rod('steel', 0.0044, 0.0011, 0, -0.078, -0.386, 0, -0.093, -0.168, 8);
  B.rod('steel', 0.0068, 0.0068, -0.009, -0.075, -0.387, 0.009, -0.075, -0.387, 8);
  B.rod('steel', 0.0026, 0.0026, 0, -0.0655, -0.25, 0, -0.0655, -0.47, 6);
  // front trunnion + rear sight
  B.box('steel', -0.0175, 0.0175, -0.088, -0.03, -0.046, 0.028);
  B.box('steel', -0.013, 0.013, -0.03, -0.0145, -0.06, 0.006);
  B.add('blackSteel', new THREE.BoxGeometry(0.021, 0.004, 0.062), 0, -0.0105, -0.029, -0.06, 0, 0);
  B.box('blackSteel', -0.0083, -0.0045, -0.0095, 0.0, -0.0035, 0.004);
  B.box('blackSteel', 0.0045, 0.0083, -0.0095, 0.0, -0.0035, 0.004);
  B.box('steel', -0.0127, 0.0127, -0.016, -0.0062, -0.038, -0.027);
  // receiver
  B.box('steel', -0.0165, 0.0165, -0.092, -0.034, 0.026, 0.29, [4, 4]);
  B.add('steel', new THREE.CylinderGeometry(0.0164, 0.0164, 0.262, 16), 0, -0.035, 0.16, Math.PI / 2, 0, 0, 1, 1, 0.42);
  B.box('steel', -0.0178, 0.0178, -0.096, -0.03, 0.284, 0.298);
  B.box('steel', -0.0042, 0.0042, -0.034, -0.025, 0.287, 0.299);
  B.box('black', 0.0162, 0.0172, -0.051, -0.036, 0.06, 0.136);
  B.box('steel', -0.0175, 0.0175, -0.091, -0.068, 0.07, 0.15);
  // selector lever (right side)
  B.add('steel', new THREE.BoxGeometry(0.0024, 0.015, 0.118), 0.0178, -0.049, 0.142, 0.07, 0, 0);
  B.add('steel', new THREE.BoxGeometry(0.006, 0.007, 0.012), 0.02, -0.057, 0.086, 0, 0.3, 0);
  // rivets
  for (const z of [0.04, 0.1, 0.165, 0.255]) for (const s of [-1, 1]) B.rod('steel', 0.0022, 0.0022, s * 0.0163, -0.084, z, s * 0.0178, -0.084, z, 6);
  // trigger group
  B.box('steel', -0.0034, 0.0034, -0.118, -0.092, 0.126, 0.133);
  B.box('steel', -0.0034, 0.0034, -0.12, -0.1145, 0.126, 0.214);
  B.add('steel', new THREE.BoxGeometry(0.0048, 0.022, 0.0048), 0, -0.103, 0.168, -0.28, 0, 0);
  B.box('steel', -0.0062, 0.0062, -0.105, -0.093, 0.149, 0.156);
  // pistol grip
  B.add('woodDark', profileGeo([[0.204, -0.088], [0.247, -0.088], [0.262, -0.118], [0.289, -0.186], [0.283, -0.198], [0.25, -0.199], [0.238, -0.162], [0.214, -0.112]], 0.028, 0.006), 0, 0, 0, 0, 0, 0, 1, 1, 1, 6);
  // stock
  {
    const g = profileGeo([[0.29, -0.033], [0.305, -0.036], [0.5, -0.067], [0.547, -0.073], [0.552, -0.1], [0.552, -0.205], [0.537, -0.213], [0.47, -0.19], [0.36, -0.134], [0.316, -0.113], [0.29, -0.098]], 0.034, 0.0075, 4);
    warp(g, (v) => { const t = clamp((v.z - 0.29) / 0.26, 0, 1); v.x *= lerp(0.86, 1.12, t); });
    B.add('wood', g, 0, 0, 0, 0, 0, 0, 1, 1, 1, 4);
  }
  B.box('steel', -0.0205, 0.0205, -0.214, -0.072, 0.552, 0.559);
  B.ring('steel', 0.0075, 0.0016, -0.0185, -0.198, 0.44, 1, 0, 0, 10);
  return B.geometries();
}

function buildBoltGeos() {
  const B = new Builder();
  B.box('steel', 0.0166, 0.0176, -0.05, -0.037, 0.063, 0.076);
  B.rod('steel', 0.0036, 0.0036, 0.0165, -0.0435, 0.052, 0.029, -0.0435, 0.052, 8);
  B.rod('steel', 0.0056, 0.005, 0.027, -0.0435, 0.052, 0.035, -0.0435, 0.052, 10);
  B.box('steel', 0.0166, 0.0182, -0.047, -0.04, 0.03, 0.06);
  return B.geometries();
}

function buildMagGeos() {
  const B = new Builder();
  magazineGeo(B, 'blackSteel');
  return B.geometries();
}

function buildFlash(T, vm) {
  const mk = (map, rgb) => {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    m.color.setRGB(rgb[0], rgb[1], rgb[2]);
    if (vm) applyViewmodelDepth(m);
    return m;
  };
  const grp = new THREE.Group();
  const star = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), mk(T.flashStar, [5.5, 4.2, 2.6]));
  const sideG = new THREE.PlaneGeometry(0.3, 0.11); sideG.translate(0.15, 0, 0); sideG.rotateY(Math.PI / 2);
  const sideM = mk(T.flashSide, [4.5, 3.2, 1.8]);
  const s1 = new THREE.Mesh(sideG, sideM);
  const s2 = new THREE.Mesh(sideG, sideM); s2.rotation.z = Math.PI / 2;
  const s3 = new THREE.Mesh(sideG, sideM); s3.rotation.z = Math.PI / 4;
  grp.add(star, s1, s2, s3);
  for (const m of grp.children) { m.frustumCulled = false; m.renderOrder = 20; }
  grp.userData.star = star; grp.userData.sides = [s1, s2, s3];
  grp.visible = false;
  return grp;
}

// ---------------------------------------------------------------------------------------------
// Entrenching tool. Origin = butt of the handle, handle along +Y, blade face normal ±Z.
// ---------------------------------------------------------------------------------------------

function buildShovelGeos() {
  const B = new Builder();
  B.rod('wood', 0.0163, 0.0158, 0, 0, 0, 0, 0.4, 0, 14, [1, 3]);
  B.rod('wood', 0.0188, 0.0172, 0, -0.012, 0, 0, 0.014, 0, 14);
  B.rod('steel', 0.0186, 0.0205, 0, 0.382, 0, 0, 0.47, 0, 14);
  B.ring('steel', 0.0208, 0.0032, 0, 0.398, 0, 0, 1, 0, 16);
  B.rod('steel', 0.0035, 0.0035, -0.026, 0.398, 0, 0.026, 0.398, 0, 6);
  B.add('blade', new THREE.CylinderGeometry(0.0105, 0.017, 0.11, 10), 0, 0.515, 0.0035, 0, 0, 0, 1, 1, 0.45);
  {
    const s = new THREE.Shape();
    s.moveTo(-0.068, 0); s.lineTo(-0.075, 0.118);
    s.quadraticCurveTo(-0.072, 0.168, 0, 0.192);
    s.quadraticCurveTo(0.072, 0.168, 0.075, 0.118);
    s.lineTo(0.068, 0); s.quadraticCurveTo(0, -0.012, -0.068, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0026, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.0013);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      uv.setXY(i, (x + 0.08) / 0.16, y / 0.2);
      p.setZ(i, p.getZ(i) - 0.011 * (x / 0.075) * (x / 0.075) + 0.004 * (y / 0.19));
    }
    g.computeVertexNormals();
    B.add('blade', g, 0, 0.462, 0);
  }
  return B.geometries();
}

// ---------------------------------------------------------------------------------------------
// Satchel charge. Origin = carrying handle.
// ---------------------------------------------------------------------------------------------

function buildSatchelGeos() {
  const B = new Builder();
  B.add('canvas', roundedBoxGeo(0.24, 0.16, 0.088, 0.014), 0, -0.112, 0, 0, 0, 0, 1, 1, 1, 6);
  B.add('canvas', roundedBoxGeo(0.236, 0.075, 0.014, 0.005), 0, -0.064, -0.046, 0.06, 0, 0, 1, 1, 1, 6);
  for (const x of [-0.065, 0.065]) {
    B.box('strap', x - 0.012, x + 0.012, -0.196, -0.03, -0.05, -0.044, 4);
    B.box('strap', x - 0.012, x + 0.012, -0.196, -0.03, 0.044, 0.05, 4);
    B.box('brass', x - 0.014, x + 0.014, -0.122, -0.11, -0.054, -0.049);
    B.box('strap', x - 0.012, x + 0.012, -0.197, -0.19, -0.05, 0.05);
  }
  B.ring('strap', 0.042, 0.0065, 0, -0.034, 0, 0, 0, 1, 14, Math.PI);
  // pull igniter + cord + wooden toggle
  B.rod('steel', 0.0068, 0.0062, 0.092, -0.04, 0.01, 0.094, 0.012, 0.012, 10);
  B.rod('steel', 0.0082, 0.0082, 0.094, 0.006, 0.012, 0.094, 0.014, 0.012, 10);
  let px = 0.094, py = 0.014, pz = 0.012;
  const cord = [[0.1, 0.03, 0.006], [0.112, 0.036, -0.006], [0.122, 0.026, -0.018], [0.124, 0.006, -0.026]];
  for (const c of cord) { B.rod('cord', 0.0019, 0.0019, px, py, pz, c[0], c[1], c[2], 5); px = c[0]; py = c[1]; pz = c[2]; }
  B.rod('wood', 0.0058, 0.0058, 0.104, 0.002, -0.026, 0.144, 0.002, -0.026, 8);
  return B.geometries();
}

// ---------------------------------------------------------------------------------------------
// Stick grenade (Chicom). Origin = middle of the wooden handle, head toward +Y.
// ---------------------------------------------------------------------------------------------

function buildGrenadeGeos() {
  const B = new Builder();
  B.rod('wood', 0.0124, 0.0132, 0, -0.06, 0, 0, 0.056, 0, 12, [1, 2]);
  B.rod('steel', 0.0143, 0.0143, 0, -0.073, 0, 0, -0.058, 0, 12);
  B.rod('grenade', 0.0145, 0.0262, 0, 0.054, 0, 0, 0.066, 0, 16);
  B.rod('grenade', 0.0262, 0.0262, 0, 0.066, 0, 0, 0.13, 0, 16, [1, 1]);
  B.rod('grenade', 0.0262, 0.019, 0, 0.13, 0, 0, 0.139, 0, 16);
  B.ring('grenade', 0.0265, 0.0013, 0, 0.088, 0, 0, 1, 0, 18);
  B.ring('grenade', 0.0265, 0.0013, 0, 0.108, 0, 0, 1, 0, 18);
  B.ring('cord', 0.007, 0.0012, 0, -0.084, 0, 1, 0, 0, 10);
  return B.geometries();
}

// ---------------------------------------------------------------------------------------------
// Punji stake bundle. Origin = bundle centre, stakes along +X (points toward +X).
// ---------------------------------------------------------------------------------------------

function buildTrapGeos() {
  const B = new Builder();
  const rr = rand(404);
  const offs = [[0, 0], [0.013, 0.004], [-0.012, 0.006], [0.004, 0.014], [-0.004, -0.013], [0.012, -0.009], [-0.013, -0.007]];
  for (const [oy, oz] of offs) {
    const l0 = -0.17 - rr() * 0.03, l1 = 0.17 + rr() * 0.05;
    B.rod('bamboo', 0.0066, 0.0058, l0, oy, oz, l1 - 0.06, oy * 0.9, oz * 0.9, 7);
    B.rod('bamboo', 0.0058, 0.0004, l1 - 0.06, oy * 0.9, oz * 0.9, l1, oy * 0.8, oz * 0.8, 7);
  }
  B.ring('cord', 0.022, 0.0032, -0.085, 0, 0, 1, 0, 0, 14);
  B.ring('cord', 0.021, 0.0032, 0.035, 0, 0, 1, 0, 0, 14);
  return B.geometries();
}

function buildTrapGhostGeo() {
  const B = new Builder();
  B.box('g', -0.55, 0.55, 0, 0.02, -0.55, -0.48);
  B.box('g', -0.55, 0.55, 0, 0.02, 0.48, 0.55);
  B.box('g', -0.55, -0.48, 0, 0.02, -0.48, 0.48);
  B.box('g', 0.48, 0.55, 0, 0.02, -0.48, 0.48);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = -0.33 + i * 0.22, z = -0.33 + j * 0.22;
    B.rod('g', 0.012, 0.001, x, -0.05, z, x + 0.01, 0.22, z - 0.01, 5);
  }
  return B.geometries().get('g');
}

// ---------------------------------------------------------------------------------------------
// Tin oil lamp. Origin = top of the wire bail (where the hand holds it).
// ---------------------------------------------------------------------------------------------

function buildLampGeos() {
  const B = new Builder();
  B.ring('steel', 0.031, 0.0014, 0, -0.036, 0, 0, 0, 1, 14, Math.PI);
  B.rod('tin', 0.0305, 0.0305, 0, -0.106, 0, 0, -0.064, 0, 18);
  B.ring('tin', 0.0305, 0.0022, 0, -0.106, 0, 0, 1, 0, 18);
  B.ring('tin', 0.0305, 0.0018, 0, -0.064, 0, 0, 1, 0, 18);
  B.rod('tin', 0.0305, 0.0165, 0, -0.064, 0, 0, -0.054, 0, 18);
  B.rod('tin', 0.0082, 0.0072, 0, -0.054, 0, 0, -0.041, 0, 10);
  B.rod('wick', 0.0034, 0.0028, 0, -0.042, 0, 0, -0.034, 0, 6);
  B.rod('steel', 0.002, 0.002, -0.031, -0.036, 0, -0.031, -0.066, 0, 5);
  B.rod('steel', 0.002, 0.002, 0.031, -0.036, 0, 0.031, -0.066, 0, 5);
  return B.geometries();
}

// ---------------------------------------------------------------------------------------------
// Pooled billboard particles (one draw call per blend mode)
// ---------------------------------------------------------------------------------------------

const PS = 25;
const P_X = 0, P_Y = 1, P_Z = 2, P_VX = 3, P_VY = 4, P_VZ = 5, P_AGE = 6, P_LIFE = 7, P_S0 = 8, P_S1 = 9,
  P_R = 10, P_G = 11, P_B = 12, P_A = 13, P_TILE = 14, P_ROT = 15, P_RV = 16, P_DRAG = 17, P_GRAV = 18,
  P_EMIT = 19, P_FLAGS = 20, P_FADEIN = 21, P_FADEPOW = 22, P_SEED = 23, P_SOFT = 24;
// F_SOFT: big volumetric billboards (smoke, dust). Without a scene depth texture they get a cheap
// soft-particle treatment: the quad is slid toward the camera along the view ray (same screen
// footprint, so it stops slicing through walls and ground behind its centre) and its alpha thins
// where the volume overlaps the terrain or a box collider (sandbag walls, bunkers).
const F_COLLIDE = 1, F_FLUTTER = 2, F_WIND = 4, F_SPLASHY = 8, F_SOFT = 16;

const PARTICLE_VS = /* glsl */`
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec4 iPar; // size, rotation, tile, emissive
varying vec2 vUv;
varying vec4 vCol;
varying float vEmit;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iPar.y), s = sin(iPar.y);
  vec2 p = position.xy * iPar.x;
  // slide the billboard toward the eye by ~0.4 of its size, keeping its screen footprint
  float vd = max(-mvPosition.z, 1e-3);
  float push = min(iPar.x * 0.42, max(vd - 0.6, 0.0));
  float pk = (vd - push) / vd;
  mvPosition.xyz *= pk;
  p *= pk;
  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mvPosition;
  float tx = mod(iPar.z, 4.0), ty = floor(iPar.z / 4.0 + 0.001);
  vUv = vec2((tx + uv.x) * 0.25, 0.5 * (1.0 - ty + uv.y));
  vCol = iCol;
  vEmit = iPar.w;
  #include <fog_vertex>
}`;

const PARTICLE_FS_ALPHA = /* glsl */`
uniform sampler2D map;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec4 vCol;
varying float vEmit;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  float a = vCol.a * t.a;
  if (a < 0.004) discard;
  vec3 lit = mix(uAmbient, vec3(1.0), clamp(vEmit, 0.0, 1.0)) + max(vEmit - 1.0, 0.0);
  gl_FragColor = vec4(vCol.rgb * t.rgb * lit, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const PARTICLE_FS_ADD = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
varying float vEmit;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  float a = vCol.a * t.a;
  if (a < 0.003) discard;
  float ff = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      ff = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  gl_FragColor = vec4(vCol.rgb * t.rgb, a * (1.0 - ff * 0.85));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function quadInstancedGeo(max, attrs) {
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

function uploadAttr(a, n) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

class Particles {
  constructor(max, additive, atlas, renderOrder) {
    this.max = max; this.n = 0;
    this.data = new Float32Array(max * PS);
    const { geo, attrs } = quadInstancedGeo(max, [['iPos', 3], ['iCol', 4], ['iPar', 4]]);
    this.geo = geo; this.aPos = attrs.iPos; this.aCol = attrs.iCol; this.aPar = attrs.iPar;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uAmbient: { value: new THREE.Color(1, 1, 1) } }]);
    this.uniforms.map.value = atlas;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PARTICLE_VS,
      fragmentShader: additive ? PARTICLE_FS_ADD : PARTICLE_FS_ALPHA,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = additive ? 'fxAdditive' : 'fxAlpha';
    this.windX = 0.7; this.windZ = 0.35;
    this.frame = 0;
    this.spec = {};
    this.reset();
  }
  reset() {
    const s = this.spec;
    s.x = s.y = s.z = 0; s.vx = s.vy = s.vz = 0; s.life = 1; s.s0 = 0.2; s.s1 = 0.5;
    s.r = s.g = s.b = 1; s.a = 1; s.tile = 0; s.rot = Math.random() * TAU; s.rv = 0; s.drag = 0;
    s.grav = 0; s.emit = 0; s.flags = 0; s.fadeIn = 0.05; s.fadePow = 1;
    return s;
  }
  color(c, mul = 1) { this.spec.r = c.r * mul; this.spec.g = c.g * mul; this.spec.b = c.b * mul; return this.spec; }
  emit() {
    const s = this.spec;
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; // recycle a random live particle
    else this.n++;
    const d = this.data, o = i * PS;
    d[o + P_X] = s.x; d[o + P_Y] = s.y; d[o + P_Z] = s.z; d[o + P_VX] = s.vx; d[o + P_VY] = s.vy; d[o + P_VZ] = s.vz;
    d[o + P_AGE] = 0; d[o + P_LIFE] = Math.max(0.02, s.life); d[o + P_S0] = s.s0; d[o + P_S1] = s.s1;
    d[o + P_R] = s.r; d[o + P_G] = s.g; d[o + P_B] = s.b; d[o + P_A] = s.a; d[o + P_TILE] = s.tile;
    d[o + P_ROT] = s.rot; d[o + P_RV] = s.rv; d[o + P_DRAG] = s.drag; d[o + P_GRAV] = s.grav; d[o + P_EMIT] = s.emit;
    d[o + P_FLAGS] = s.flags; d[o + P_FADEIN] = Math.max(0.001, s.fadeIn); d[o + P_FADEPOW] = s.fadePow; d[o + P_SEED] = Math.random() * 100;
    d[o + P_SOFT] = 1;
    // keep defaults for the next spawn but re-randomise rotation
    s.rot = Math.random() * TAU;
  }
  // Alpha multiplier for a soft billboard of radius r centred at (x, y, z).
  softFade(x, y, z, r, heightAt, boxes, slot, o) {
    let f = 1;
    if (heightAt) {
      const h = y - heightAt(x, z);
      f = 0.18 + 0.82 * smoothstep(-0.3 * r, 0.75 * r, h);
    }
    if (boxes && boxes.length) {
      // box term is cached and refreshed every 4th frame (staggered per slot)
      const d = this.data;
      if (((this.frame + slot) & 3) === 0) {
        let near = 1e9;
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          const mn = b.min, mx = b.max;
          if (!mn || !mx) continue;
          const ex = mn.x - x > 0 ? mn.x - x : (x - mx.x > 0 ? x - mx.x : 0);
          if (ex >= r) continue;
          const ez = mn.z - z > 0 ? mn.z - z : (z - mx.z > 0 ? z - mx.z : 0);
          if (ez >= r) continue;
          const ey = mn.y - y > 0 ? mn.y - y : (y - mx.y > 0 ? y - mx.y : 0);
          if (ey >= r) continue;
          const dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dd < near) near = dd;
        }
        d[o + P_SOFT] = near >= r ? 1 : 0.3 + 0.7 * smoothstep(0, r, near);
      }
      f *= d[o + P_SOFT];
    }
    return f;
  }
  update(dt, heightAt, boxes) {
    const d = this.data, P = this.aPos.array, C = this.aCol.array, Q = this.aPar.array;
    const wx = this.windX, wz = this.windZ;
    this.frame = (this.frame + 1) | 0;
    let n = this.n;
    for (let i = 0; i < n;) {
      const o = i * PS;
      const age = d[o + P_AGE] + dt, life = d[o + P_LIFE];
      if (age >= life) {
        n--;
        if (i !== n) d.copyWithin(o, n * PS, n * PS + PS);
        continue;
      }
      d[o + P_AGE] = age;
      const flags = d[o + P_FLAGS];
      const drag = d[o + P_DRAG];
      if (drag > 0) { const f = Math.exp(-drag * dt); d[o + P_VX] *= f; d[o + P_VY] *= f; d[o + P_VZ] *= f; }
      d[o + P_VY] -= d[o + P_GRAV] * dt;
      let vx = d[o + P_VX], vz = d[o + P_VZ];
      if (flags & F_FLUTTER) { const sd = d[o + P_SEED]; vx += Math.sin(age * 5.1 + sd) * 0.9; vz += Math.cos(age * 4.3 + sd * 1.7) * 0.9; }
      if (flags & F_WIND) { const k = Math.min(1, age * 0.35); vx += wx * k; vz += wz * k; }
      d[o + P_X] += vx * dt; d[o + P_Y] += d[o + P_VY] * dt; d[o + P_Z] += vz * dt;
      if ((flags & F_COLLIDE) && heightAt) {
        const h = heightAt(d[o + P_X], d[o + P_Z]) + 0.02;
        if (d[o + P_Y] < h) {
          d[o + P_Y] = h;
          if (d[o + P_VY] < 0) d[o + P_VY] *= -0.28;
          d[o + P_VX] *= 0.55; d[o + P_VZ] *= 0.55; d[o + P_RV] *= 0.5;
        }
      }
      d[o + P_ROT] += d[o + P_RV] * dt;
      const t = age / life;
      const inv = 1 - t;
      const size = d[o + P_S0] + (d[o + P_S1] - d[o + P_S0]) * (1 - inv * inv);
      let alpha = d[o + P_A] * Math.min(1, t / d[o + P_FADEIN]) * Math.pow(inv, d[o + P_FADEPOW]);
      if ((flags & F_SOFT) && size > 0.9) alpha *= this.softFade(d[o + P_X], d[o + P_Y], d[o + P_Z], size * 0.5, heightAt, boxes, i, o);
      const p3 = i * 3, p4 = i * 4;
      P[p3] = d[o + P_X]; P[p3 + 1] = d[o + P_Y]; P[p3 + 2] = d[o + P_Z];
      C[p4] = d[o + P_R]; C[p4 + 1] = d[o + P_G]; C[p4 + 2] = d[o + P_B]; C[p4 + 3] = alpha;
      Q[p4] = size; Q[p4 + 1] = d[o + P_ROT]; Q[p4 + 2] = d[o + P_TILE]; Q[p4 + 3] = d[o + P_EMIT] * inv * inv;
      i++;
    }
    this.n = n;
    this.geo.instanceCount = n;
    if (n > 0) { uploadAttr(this.aPos, n); uploadAttr(this.aCol, n); uploadAttr(this.aPar, n); }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

// ---------------------------------------------------------------------------------------------
// Tracers: camera-facing streaks travelling along a segment.
// ---------------------------------------------------------------------------------------------

const TRACER_VS = /* glsl */`
attribute vec3 iA;
attribute vec4 iB; // dir.xyz, total length
attribute vec4 iC; // head, length, width, alpha
varying float vT;
varying float vX;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float tail = clamp(iC.x - iC.y, 0.0, iB.w);
  float head = clamp(iC.x, 0.0, iB.w);
  float along = position.y + 0.5;
  vec3 P = iA + iB.xyz * mix(tail, head, along);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 side = normalize(cross(iB.xyz, toCam) + vec3(1e-5));
  P += side * iC.z * position.x;
  vT = along; vX = position.x * 2.0; vA = iC.w;
  vec4 mvPosition = viewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const TRACER_FS = /* glsl */`
uniform vec3 uColor;
varying float vT;
varying float vX;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float core = 1.0 - vX * vX;
  float a = vA * pow(vT, 1.6) * core;
  float ff = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      ff = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  vec3 c = mix(uColor, vec3(1.4, 3.0, 1.0), core * core * vT);
  gl_FragColor = vec4(c, a * (1.0 - ff * 0.6));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Tracers {
  constructor(max) {
    this.max = max; this.n = 0;
    this.data = new Float32Array(max * 12); // ax ay az dx dy dz total head len width alpha speed
    const { geo, attrs } = quadInstancedGeo(max, [['iA', 3], ['iB', 4], ['iC', 4]]);
    this.geo = geo; this.a = attrs;
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0.45, 2.4, 0.3) } }]);
    this.material = new THREE.ShaderMaterial({ uniforms: u, vertexShader: TRACER_VS, fragmentShader: TRACER_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.mesh.name = 'tracers';
  }
  spawn(from, to, speed, len, width, head0 = 0) {
    let i = this.n; if (i >= this.max) i = 0; else this.n++;
    const d = this.data, o = i * 12;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z;
    d[o + 3] = dx / L; d[o + 4] = dy / L; d[o + 5] = dz / L; d[o + 6] = L;
    d[o + 7] = head0; d[o + 8] = len; d[o + 9] = width; d[o + 10] = 1; d[o + 11] = speed;
  }
  update(dt) {
    const d = this.data, A = this.a.iA.array, Bv = this.a.iB.array, Cv = this.a.iC.array;
    let n = this.n;
    for (let i = 0; i < n;) {
      const o = i * 12;
      d[o + 7] += d[o + 11] * dt;
      if (d[o + 7] - d[o + 8] > d[o + 6]) { n--; if (i !== n) d.copyWithin(o, n * 12, n * 12 + 12); continue; }
      const p3 = i * 3, p4 = i * 4;
      A[p3] = d[o]; A[p3 + 1] = d[o + 1]; A[p3 + 2] = d[o + 2];
      Bv[p4] = d[o + 3]; Bv[p4 + 1] = d[o + 4]; Bv[p4 + 2] = d[o + 5]; Bv[p4 + 3] = d[o + 6];
      Cv[p4] = d[o + 7]; Cv[p4 + 1] = d[o + 8]; Cv[p4 + 2] = d[o + 9]; Cv[p4 + 3] = d[o + 10];
      i++;
    }
    this.n = n; this.geo.instanceCount = n;
    if (n) { uploadAttr(this.a.iA, n); uploadAttr(this.a.iB, n); uploadAttr(this.a.iC, n); }
  }
}

// ---------------------------------------------------------------------------------------------
// Decals (bullet holes, scorch marks): ring buffers of instanced quads.
// ---------------------------------------------------------------------------------------------

class Decals {
  constructor(max, tex, opacity = 1) {
    this.max = max; this.next = 0; this.count = 0;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.name = 'decals';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  add(pos, normal, size) {
    const n = this._n.copy(normal); if (n.lengthSq() < 1e-6) n.set(0, 1, 0); n.normalize();
    this._q.setFromUnitVectors(_ZAX, n);
    this._q2.setFromAxisAngle(_ZAX, Math.random() * TAU);
    this._q.multiply(this._q2);
    this._p.copy(pos).addScaledVector(n, 0.012);
    this._m.compose(this._p, this._q, this._s.set(size, size, size));
    this.mesh.setMatrixAt(this.next, this._m);
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Spent cases: instanced, simple rigid-body hops on the terrain.
// ---------------------------------------------------------------------------------------------

class Shells {
  constructor(max, material) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * 12); // x y z vx vy vz rx ry rz wx wy age | bounced flag stored in sign of age? use separate
    this.b = new Uint8Array(max);
    const g = new THREE.CylinderGeometry(0.0056, 0.0052, 0.039, 8);
    this.mesh = new THREE.InstancedMesh(g, material, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.name = 'shells';
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }
  spawn(p, v) {
    let i = this.n; if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const d = this.d, o = i * 12;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = v.x; d[o + 4] = v.y; d[o + 5] = v.z;
    d[o + 6] = Math.random() * TAU; d[o + 7] = Math.random() * TAU; d[o + 8] = Math.PI / 2;
    d[o + 9] = (Math.random() - 0.5) * 40; d[o + 10] = 18 + Math.random() * 20; d[o + 11] = 0;
    this.b[i] = 0;
  }
  update(dt, heightAt, onLand) {
    const d = this.d; let n = this.n;
    for (let i = 0; i < n;) {
      const o = i * 12;
      d[o + 11] += dt;
      if (d[o + 11] > 6) { n--; if (i !== n) { d.copyWithin(o, n * 12, n * 12 + 12); this.b[i] = this.b[n]; } continue; }
      const resting = this.b[i] >= 3;
      if (!resting) {
        d[o + 4] -= 9.81 * dt;
        d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
        d[o + 6] += d[o + 9] * dt; d[o + 7] += d[o + 10] * dt;
        const h = heightAt ? heightAt(d[o], d[o + 2]) + 0.006 : -1e9;
        if (d[o + 1] < h) {
          d[o + 1] = h;
          if (this.b[i] === 0 && onLand) onLand(d[o], d[o + 1], d[o + 2]);
          this.b[i]++;
          d[o + 4] = Math.abs(d[o + 4]) * 0.3; d[o + 3] *= 0.45; d[o + 5] *= 0.45; d[o + 9] *= 0.4; d[o + 10] *= 0.4;
          if (this.b[i] >= 3) { d[o + 6] = Math.PI / 2; d[o + 4] = 0; }
        }
      }
      const life = d[o + 11];
      const sink = life > 5 ? (life - 5) * 0.04 : 0;
      this._e.set(d[o + 6], d[o + 7], 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(d[o], d[o + 1] - sink, d[o + 2]), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      i++;
    }
    this.n = n; this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Rig poses (camera space: x right, y up, -z forward). [x, y, z, rx, ry, rz]
// ---------------------------------------------------------------------------------------------

const POSE = {
  rifle: { hip: [0.078, -0.094, -0.275, 0.016, 0.045, 0.0], ads: [0, 0, -0.4, 0, 0, 0], sprint: [0.05, -0.205, -0.34, -0.4, 0.75, 0.42] },
  // under: one hand choked up near the blade (grip ~0.5 m out, low right), blade raised toward
  // the tunnel face; the handle butt stays ~0.37 m from the eye and below the frustum.
  shovel: { hip: [0.21, -0.27, -0.16, -1.31, 0.0, 0.25], under: [0.19, -0.26, -0.19, -1.22, 0.12, 0.14], sprint: [0.24, -0.33, -0.26, -0.8, 0.5, 0.6] },
  satchel: { hip: [0.0, -0.095, -0.34, 0.42, 0.36, 0.04], sprint: [0.04, -0.22, -0.34, 0.05, 0.6, 0.2] },
  grenade: { hip: [0.14, -0.15, -0.33, 0.12, 0.12, -0.18], sprint: [0.16, -0.22, -0.3, -0.25, 0.3, -0.3] },
  trap: { hip: [0.06, -0.17, -0.37, 0.12, 0.62, 0.12], sprint: [0.08, -0.24, -0.33, -0.1, 0.9, 0.3] },
  lamp: { hip: [-0.145, -0.09, -0.32, 0.0, 0.0, 0.0] },
};

const DUMMY_INPUT = { keys: new Set(), pressed: new Set(), mouse: { dx: 0, dy: 0, left: false, right: false, wheel: 0 }, locked: false };

// ---------------------------------------------------------------------------------------------
// createWeapons
// ---------------------------------------------------------------------------------------------

// Model assets: CC0 hand (assets/hand.glb), CC BY AK pattern rifle (assets/type56.glb). See CREDITS.md.
const ASSET_BASE = new URL('../assets/', import.meta.url);

export function createWeapons(ctx) {
  const scene = ctx.scene;
  const camera = ctx.camera;
  const ev = ctx.events || utilEvents;
  if (camera && scene && !camera.parent) scene.add(camera);

  const T = makeTextures();
  const envMap = makeEnvMap(ctx.renderer);
  const vmLamp = makeVmLampUniforms();
  const VM = makeMaterials(T, envMap, true, vmLamp);
  const WM = makeMaterials(T, envMap, false);

  // ---- scene graph ------------------------------------------------------------------------
  const viewModel = new THREE.Group(); viewModel.name = 'viewModel';
  const sway = new THREE.Group(); sway.name = 'vmSway';
  viewModel.add(sway);
  if (camera) camera.add(viewModel);
  const fxRoot = new THREE.Group(); fxRoot.name = 'weaponsFx';
  if (scene) scene.add(fxRoot);

  const alphaFx = new Particles(1400, false, T.atlas, 8);
  const addFx = new Particles(900, true, T.atlas, 9);
  const tracers = new Tracers(40);
  const holes = new Decals(120, T.hole, 0.9);
  const scorches = new Decals(16, T.scorch, 0.92);
  const shells = new Shells(48, WM.caseSteel);
  fxRoot.add(holes.mesh, scorches.mesh, shells.mesh, alphaFx.mesh, addFx.mesh, tracers.mesh);

  const fxLight = new THREE.PointLight(0xffb060, 0, 18, 2);
  fxLight.castShadow = false; fxLight.name = 'weaponsFxLight';
  fxRoot.add(fxLight);

  // ---- rifle --------------------------------------------------------------------------------
  const magGeos = buildMagGeos();
  const rifle = { root: new THREE.Group() };
  rifle.root.name = 'rifle';
  rifle.root.add(meshGroup(buildRifleGeos(), VM, { name: 'rifleBody' }));
  rifle.bolt = meshGroup(buildBoltGeos(), VM, { name: 'rifleBolt' }); rifle.root.add(rifle.bolt);
  rifle.mag = meshGroup(magGeos, VM, { name: 'rifleMag' }); rifle.mag.position.copy(RIFLE_MAG_PIVOT); rifle.root.add(rifle.mag);
  rifle.flash = buildFlash(T, true); rifle.flash.position.set(0, BORE, -0.493); rifle.root.add(rifle.flash);
  rifle.muzzle = new THREE.Object3D(); rifle.muzzle.position.set(0, BORE, -0.5); rifle.root.add(rifle.muzzle);
  rifle.ejector = new THREE.Object3D(); rifle.ejector.position.set(0.022, -0.043, 0.1); rifle.root.add(rifle.ejector);
  const rHip = POSE.rifle.hip.slice(3);
  rifle.rArm = makeArm(VM, 'right', [0, 0.928, -0.373], [1, -0.05, 0.2], [0.32, -0.62, 0.72], rHip, 0.0165);
  rifle.rArm.position.set(0, -0.142, 0.246);
  rifle.lArm = makeArm(VM, 'left', [0, 0, -1], [0.25, -1, 0.05], [-0.42, -0.62, 0.66], rHip, 0.0215, -0.8);
  rifle.lArm.position.set(0, -0.071, -0.152);
  rifle.root.add(rifle.rArm, rifle.lArm);
  rifle.lBasePos = rifle.lArm.position.clone();
  rifle.lBaseQuat = rifle.lArm.quaternion.clone();
  rifle.lMagQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.0, -0.3)).multiply(rifle.lBaseQuat);
  rifle.lRackQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.0, 0.55)).multiply(rifle.lBaseQuat);

  // ---- shovel -------------------------------------------------------------------------------
  const shovelGeos = buildShovelGeos();
  const shovel = { root: new THREE.Group() };
  shovel.root.name = 'shovel';
  shovel.model = meshGroup(shovelGeos, VM, { name: 'shovelModel' }); shovel.root.add(shovel.model);
  const sHip = POSE.shovel.hip.slice(3);
  shovel.rArm = makeArm(VM, 'right', [0, 1, 0], [0.9, -0.4, 0], [0.3, -0.62, 0.72], sHip, 0.0165);
  shovel.rArm.position.set(0, 0.045, 0);
  shovel.lArm = makeArm(VM, 'left', [0, 1, 0], [-0.3, -1, 0.1], [-0.45, -0.6, 0.66], sHip, 0.0165);
  shovel.lArm.position.set(0, 0.265, 0);
  shovel.root.add(shovel.rArm, shovel.lArm);
  shovel.rUnderArm = makeArm(VM, 'right', [0, 1, 0], [0.9, -0.4, 0], [0.35, -0.55, 0.75], POSE.shovel.under.slice(3), 0.0165);
  shovel.rUnderArm.position.set(0, 0.31, 0);
  shovel.rUnderArm.visible = false;
  shovel.root.add(shovel.rUnderArm);

  // ---- satchel ------------------------------------------------------------------------------
  const satchelGeos = buildSatchelGeos();
  const satchel = { root: new THREE.Group() };
  satchel.root.name = 'satchel';
  satchel.model = meshGroup(satchelGeos, VM, { name: 'satchelModel' }); satchel.root.add(satchel.model);
  const saHip = POSE.satchel.hip.slice(3);
  satchel.lArm = makeArm(VM, 'left', [1, 0, 0], [0, 1, 0.2], [-0.5, -0.5, 0.7], saHip, 0.008);
  satchel.lArm.position.set(-0.01, 0.006, 0);
  satchel.rArm = makeArm(VM, 'right', [0, 1, 0], [1, 0, 0.3], [0.45, -0.55, 0.7], saHip, 0.0075);
  satchel.rArm.position.set(0.094, -0.008, 0.012);
  satchel.root.add(satchel.lArm, satchel.rArm);

  // ---- grenade ------------------------------------------------------------------------------
  const grenadeGeos = buildGrenadeGeos();
  const grenade = { root: new THREE.Group() };
  grenade.root.name = 'grenade';
  grenade.model = meshGroup(grenadeGeos, VM, { name: 'grenadeModel' }); grenade.root.add(grenade.model);
  const gHip = POSE.grenade.hip.slice(3);
  grenade.rArm = makeArm(VM, 'right', [0, 1, 0], [1, 0, 0.4], [0.35, -0.6, 0.7], gHip, 0.0128);
  grenade.rArm.position.set(0, -0.008, 0);
  grenade.lArm = makeArm(VM, 'left', [0, -1, 0], [-1, 0, 0.3], [-0.4, -0.55, 0.72], gHip, 0.012);
  grenade.lArm.position.set(0, -0.095, 0);
  grenade.lArm.visible = false;
  grenade.root.add(grenade.rArm, grenade.lArm);
  grenade.cordRing = new THREE.Object3D(); grenade.cordRing.position.set(0, -0.085, 0); grenade.root.add(grenade.cordRing);

  // ---- trap ---------------------------------------------------------------------------------
  const trapGeos = buildTrapGeos();
  const trap = { root: new THREE.Group() };
  trap.root.name = 'trap';
  trap.model = meshGroup(trapGeos, VM, { name: 'trapModel' }); trap.root.add(trap.model);
  const tHip = POSE.trap.hip.slice(3);
  trap.rArm = makeArm(VM, 'right', [1, 0, 0], [0.4, -1, 0.2], [0.35, -0.6, 0.72], tHip, 0.021);
  trap.rArm.position.set(-0.12, 0, 0);
  trap.lArm = makeArm(VM, 'left', [1, 0, 0], [-0.3, -1, 0], [-0.45, -0.55, 0.7], tHip, 0.021);
  trap.lArm.position.set(0.06, 0, 0);
  trap.root.add(trap.rArm, trap.lArm);

  // ---- lamp ---------------------------------------------------------------------------------
  const lamp = { root: new THREE.Group() };
  lamp.root.name = 'lamp';
  lamp.swing = new THREE.Group(); lamp.root.add(lamp.swing);
  lamp.model = meshGroup(buildLampGeos(), VM, { name: 'lampModel' }); lamp.swing.add(lamp.model);
  const flameMat = new THREE.MeshBasicMaterial({ map: T.lampFlame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  flameMat.color.setRGB(2.6, 2.0, 1.4);
  applyViewmodelDepth(flameMat);
  lamp.flame = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.044), flameMat);
  lamp.flame.position.set(0, -0.013, 0); lamp.flame.renderOrder = 21;
  lamp.swing.add(lamp.flame);
  lamp.light = new THREE.PointLight(0xffc890, 0, 11, 1.5);
  // Parented to the always-visible viewmodel root so the scene's light count never changes
  // (toggling it would recompile every material when entering a tunnel). Each frame it is moved
  // to the flame, pulled back toward the eye when a tunnel face is closer than the lamp.
  lamp.light.position.set(-0.145, -0.1, -0.32); lamp.light.castShadow = false; lamp.light.name = 'oilLamp';
  viewModel.add(lamp.light);
  lamp.flamePos = new THREE.Vector3(-0.145, -0.1, -0.32); // view space, refreshed per frame
  lamp.dist = 0.36;       // current light distance from the eye along the flame direction
  lamp.clear = 10;        // free distance from the eye toward the flame (cached)
  lamp.probeFrame = -10;
  lamp.flicker = 0;
  lamp.kI = 1;
  lamp.lArm = makeArm(VM, 'left', [-1, 0, 0], [0, 1, 0.25], [-0.3, -0.72, 0.62], [0, 0, 0], 0.006);
  lamp.root.add(lamp.lArm);
  lamp.root.visible = false;

  const rigs = { rifle, shovel, satchel, grenade, trap };
  loadModels();

  function vmMaterial(src, { color = null, env = 0.45, rough = null } = {}) {
    const m = src.clone();
    if (color != null) m.color.multiply(new THREE.Color(color));
    if (rough != null) m.roughness = rough;
    if (envMap) { m.envMap = envMap; m.envMapIntensity = env; }
    m.userData.baseEnv = m.envMapIntensity;
    m.side = THREE.FrontSide;
    applyViewmodelDepth(m, vmLamp);
    VM.list.push(m);
    return m;
  }
  function setupMesh(mesh) { mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; return mesh; }
  function firstMesh(root, name) {
    let hit = null;
    root.traverse((o) => { if (!hit && o.isMesh && (!name || o.name === name || o.parent?.name === name)) hit = o; });
    return hit;
  }

  function loadModels() {
    const loader = new GLTFLoader();
    const viaUrl = (file) => new Promise((res, rej) => loader.load(new URL(file, ASSET_BASE).href, res, undefined, rej));
    const viaModule = async (file) => {
      const mod = await import('../assets/models.js');
      const bin = Uint8Array.from(atob(mod[file.replace('.glb', '')]), (c) => c.charCodeAt(0));
      return new Promise((res, rej) => loader.parse(bin.buffer, '', res, rej));
    };
    const load = (file) => viaUrl(file).catch(() => viaModule(file));
    load('hand.glb').then((gltf) => {
      const src = firstMesh(gltf.scene);
      if (!src) return;
      const geo = src.geometry;
      geo.computeBoundingSphere();
      const mat = vmMaterial(new THREE.MeshStandardMaterial({ map: src.material.map, color: 0xd2a07c, roughness: 0.62, metalness: 0 }), { env: 0.25 });
      const arms = [];
      viewModel.traverse((o) => { if (o.userData?.hand) arms.push(o); });
      lamp.root.traverse((o) => { if (o.userData?.hand && !arms.includes(o)) arms.push(o); });
      for (const arm of arms) {
        const h = arm.userData.hand;
        for (const c of [...arm.children]) { arm.remove(c); c.traverse?.((m) => { if (m.isMesh) m.geometry?.dispose?.(); }); }
        const B = new Builder();
        sleeveParts(B, h.fLocal);
        const sl = meshGroup(B.geometries(h.side === 'left'), VM, { name: 'sleeve' });
        for (const m of sl.children) setupMesh(m);
        arm.add(sl);
        const k = clamp(h.gripR / HAND_REF_R, 0.92, 1.0);
        const hand = setupMesh(new THREE.Mesh(geo, mat));
        hand.name = 'handModel';
        hand.scale.set(h.side === 'left' ? -k : k, k, k);
        arm.add(hand);
      }
      api.handModel = true;
    }).catch((e) => console.warn('[weapons] hand model not loaded, keeping built hands', e?.message || e));

    load('type56.glb').then((gltf) => {
      const body = firstMesh(gltf.scene, 'AK_body'), mag = firstMesh(gltf.scene, 'AK_mag'), bolt = firstMesh(gltf.scene, 'AK_bolt');
      if (!body) return;
      const mBody = vmMaterial(body.material, { env: 0.5 });
      const bodyGrp = rifle.root.getObjectByName('rifleBody');
      if (bodyGrp) bodyGrp.visible = false;
      const bm = setupMesh(new THREE.Mesh(body.geometry, mBody)); bm.name = 'rifleModel';
      rifle.root.add(bm);
      if (bolt) {
        for (const c of rifle.bolt.children) c.visible = false;
        rifle.bolt.add(setupMesh(new THREE.Mesh(bolt.geometry, mBody)));
      }
      if (mag) {
        const g = mag.geometry.clone(); g.translate(-RIFLE_MAG_PIVOT.x, -RIFLE_MAG_PIVOT.y, -RIFLE_MAG_PIVOT.z);
        const mMag = vmMaterial(body.material, { color: 0x4a4744, env: 0.5, rough: 0.5 });
        mMag.metalness = Math.max(mMag.metalness, 0.6);
        for (const c of rifle.mag.children) c.visible = false;
        rifle.mag.add(setupMesh(new THREE.Mesh(g, mMag)));
      }
      // muzzle, ejection port and hands for this rifle's real proportions
      rifle.flash.position.set(0, BORE, -0.398);
      rifle.muzzle.position.set(0, BORE, -0.405);
      rifle.ejector.position.set(0.022, -0.04, 0.05);
      rifle.rArm.position.set(0, -0.136, 0.205);
      rifle.lArm.position.set(0, -0.06, -0.118);
      rifle.lBasePos.copy(rifle.lArm.position);
      api.rifleModel = true;
    }).catch((e) => console.warn('[weapons] rifle model not loaded, keeping built rifle', e?.message || e));
  }
  for (const k of ITEMS) { rigs[k].root.visible = false; sway.add(rigs[k].root); }
  sway.add(lamp.root);
  viewModel.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });

  // ---- world props (pools) ------------------------------------------------------------------
  const droppedMags = [];
  for (let i = 0; i < 4; i++) {
    const m = meshGroup(magGeos, WM, { shadow: true, name: 'droppedMag' });
    m.visible = false; fxRoot.add(m);
    droppedMags.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, rest: false, active: false });
  }
  const thrown = [];
  for (let i = 0; i < 6; i++) {
    const m = meshGroup(grenadeGeos, WM, { shadow: true, name: 'thrownGrenade' });
    m.visible = false; fxRoot.add(m);
    thrown.push({ mesh: m, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), fuse: 0, active: false, rest: false, wet: false, lastBounce: 0 });
  }
  const plantedMesh = meshGroup(satchelGeos, WM, { shadow: true, name: 'plantedSatchel' });
  plantedMesh.visible = false; fxRoot.add(plantedMesh);
  const igniterOffset = new THREE.Vector3(0.094, 0.016, 0.012);

  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xd8e8c0, transparent: true, opacity: 0.32, depthWrite: false });
  const trapGhost = new THREE.Mesh(buildTrapGhostGeo(), ghostMat);
  trapGhost.visible = false; trapGhost.renderOrder = 3; trapGhost.name = 'trapGhost';
  fxRoot.add(trapGhost);
  const GHOST_OK = new THREE.Color(0xd8e8c0), GHOST_BAD = new THREE.Color(0xff5a44);

  // Dump wreck (appears after the demolition): charred crates and smouldering planks.
  const wreck = (() => {
    const mats = {
      charred: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.95, metalness: 0.05 }),
      ember: new THREE.MeshStandardMaterial({ color: 0x140c08, emissive: 0xff4a10, emissiveIntensity: 0.7, roughness: 1 }),
    };
    const B = new Builder();
    const rr = rand(1312);
    for (let i = 0; i < 18; i++) {
      const plank = rr() < 0.4;
      const w = plank ? 1.2 + rr() * 0.8 : 0.4 + rr() * 0.9, h = plank ? 0.05 : 0.12 + rr() * 0.35, d = plank ? 0.14 : 0.3 + rr() * 0.6;
      const a = rr() * TAU, r = rr() * 4.8;
      B.add(rr() < 0.25 ? 'ember' : 'charred', new THREE.BoxGeometry(w, h, d), Math.cos(a) * r, h * 0.3, Math.sin(a) * r,
        (rr() - 0.5) * 0.9, rr() * TAU, (rr() - 0.5) * 0.9);
    }
    const g = meshGroup(B.geometries(), mats, { shadow: true, name: 'dumpWreck' });
    g.visible = false;
    return g;
  })();
  fxRoot.add(wreck);

  // ---- state ----------------------------------------------------------------------------------
  const api = {
    current: 'rifle',
    ammo: { mag: CFG.magSize, reserve: CFG.startReserve },
    grenades: CFG.startGrenades, satchels: CFG.startSatchels, traps: CFG.startTraps,
    viewModel,
    labels: LABELS,
    get label() { return LABELS[api.current] || ''; },
    aiming: false, ads: 0, aim: 0, magSize: CFG.magSize, digProgress: 0, plantProgress: 0, spread: CFG.spreadHip, firing: false, lastShotTime: -1,
    shotsFired: 0, hits: 0, reloading: false, reloadProgress: 0,
    switching: false, progress: { kind: null, t: 0 },
    canPlant: false, satchelPlanted: false, satchelFuse: -1, dumpDestroyed: false,
    trapValid: false, digTarget: null, lampOn: false, fxLight,
    update, select, give, addAmmo, reset, dispose,
  };

  let time = 0;
  let baseFov = camera?.fov || 72;
  let lastFovSet = baseFov;
  let wasUnderground = false;
  let surfaceWeapon = 'rifle';
  let alive = true;

  const sw = { phase: 'up', t: 1, target: null, fast: false };
  let quick = null; // quick grenade throw {returnTo}
  let autoSwitchAt = -1, autoSwitchTo = null;

  const rs = { cooldown: 0, bloom: 0, burst: 0, lastShot: -10, pending: 0, reload: null, boltKick: 0, flashT: 0 };
  let adsT = 0, sprintE = 0;
  const aim = { pending: 0, pendingYaw: 0, recover: 0, pitchSign: 1, lastFire: -10 };

  const dig = { active: false, kind: null, cx: 0, cz: 0, t: 0, phase: 0, requery: 0, stroke: 0, cooldown: 0 };
  const melee = { active: false, t: 0, hitDone: false, swingOnly: false };
  const plant = { t: 0 };
  const planted = { active: false, atDump: false, pos: new THREE.Vector3(), fuse: 0, lastTick: 0 };
  const throwA = { active: false, t: 0, lob: false, released: false, pulled: false, pullTime: 0 };
  const trapA = { t: 0, valid: false, pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), failT: -1, failX: 0, failZ: 0 };
  let lastProgressKind = null;
  let explosionKillWindow = -10;
  let bulletKillFrame = -1;
  let frame = 0;
  let hitboxSyncFrame = -1;

  // Springs for viewmodel motion
  const spr = {
    swayX: new Spring(90, 0.7), swayY: new Spring(90, 0.7), swayRoll: new Spring(80, 0.7),
    recZ: new Spring(320, 0.62), recRot: new Spring(260, 0.55), recRoll: new Spring(200, 0.6), recY: new Spring(260, 0.6),
    fall: new Spring(70, 0.55), jolt: new Spring(140, 0.35), lampX: new Spring(28, 0.18), lampZ: new Spring(28, 0.18),
  };
  let bobPhase = 0, bobAmp = 0, prevVy = 0;

  // temps
  const camPos = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const fwdH = new THREE.Vector3();
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tN = new THREE.Vector3();
  const muzzleW = new THREE.Vector3(), ejectW = new THREE.Vector3();
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const hitsW = [], hitsE = [];
  const traceRes = { t: 0, kind: 'none', point: new THREE.Vector3(), normal: new THREE.Vector3(), object: null, enemy: null, part: null, surface: null };
  const tmpColor = new THREE.Color();
  const ambient = alphaFx.uniforms.uAmbient.value;

  const COL = {
    mud: new THREE.Color(0x5b4632), dirt: new THREE.Color(0x6e5a42), laterite: new THREE.Color(0x9a5534),
    wood: new THREE.Color(0x8a6a48), sand: new THREE.Color(0xa89a74), smoke: new THREE.Color(0x8e8c86),
    darkSmoke: new THREE.Color(0x2a2724), blood: new THREE.Color(0x6a0808), water: new THREE.Color(0xd8e2dc),
    leafA: new THREE.Color(0x4f6e2c), leafB: new THREE.Color(0x6f7f34), leafC: new THREE.Color(0x8a7a3a),
    fire: new THREE.Color(1, 1, 1), muzzleSmoke: new THREE.Color(0xb8b6b0), debris: new THREE.Color(0x3a2e24),
  };

  // ---- helpers --------------------------------------------------------------------------------
  const W = () => ctx.world;
  const heightAt = (x, z) => { const w = ctx.world; if (w && typeof w.heightAt === 'function') { const h = w.heightAt(x, z); return Number.isFinite(h) ? h : 0; } return 0; };
  const heightFn = (x, z) => heightAt(x, z);
  const isWater = (x, z) => { const w = ctx.world; try { return !!(w && typeof w.isWater === 'function' && w.isWater(x, z)); } catch (e) { return false; } };
  const waterLevel = () => { const w = ctx.world; return w && Number.isFinite(w.waterLevel) ? w.waterLevel : -1e9; };
  // Local water surface height (river or a terraced paddy), -Infinity where there is no water.
  const surfY = (x, z) => {
    const w = ctx.world;
    if (w && typeof w.waterHeightAt === 'function') {
      try { const h = w.waterHeightAt(x, z); if (Number.isFinite(h)) return h; if (h === -Infinity) return -Infinity; } catch (e) { /* fall back */ }
    }
    return isWater(x, z) ? waterLevel() : -Infinity;
  };
  const coverAt = (x, z) => { const w = ctx.world; try { return w && typeof w.coverAt === 'function' ? w.coverAt(x, z) || 0 : 0; } catch (e) { return 0; } };
  const normalAt = (x, z, out) => {
    const w = ctx.world;
    if (w && typeof w.normalAt === 'function') { const n = w.normalAt(x, z); if (n && Number.isFinite(n.x)) return out.copy(n).normalize(); }
    const e = 0.5;
    const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  };
  const impactMsg = { pos: new THREE.Vector3(), surface: '' };
  function impactSound(p, surface) {
    impactMsg.pos.copy(p); impactMsg.surface = surface;
    emit('impact', impactMsg);
  }
  function sfx(name, pos, opts) {
    const a = ctx.audio;
    if (!a || typeof a.play !== 'function') return;
    try { a.play(name, pos, opts); } catch (e) { /* audio is optional */ }
  }
  function emit(name, data) { try { ev.emit(name, data); } catch (e) { console.error('[weapons] event', name, e); } }
  const progressMsg = { t: 0, kind: null };
  function setProgress(kind, t) {
    if (t <= 0) {
      if (lastProgressKind !== null) {
        api.progress.kind = null; api.progress.t = 0;
        progressMsg.t = 0; progressMsg.kind = lastProgressKind;
        emit(lastProgressKind === 'plant' ? 'plantProgress' : 'digProgress', progressMsg);
        api.digProgress = 0; api.plantProgress = 0;
        lastProgressKind = null;
      }
      return;
    }
    api.progress.kind = kind; api.progress.t = t; lastProgressKind = kind;
    progressMsg.t = clamp(t, 0, 1); progressMsg.kind = kind;
    if (kind === 'plant') api.plantProgress = progressMsg.t; else api.digProgress = progressMsg.t;
    emit(kind === 'plant' ? 'plantProgress' : 'digProgress', progressMsg);
  }
  function playerPos(out) {
    const p = ctx.player?.position;
    if (p && Number.isFinite(p.x)) return out.copy(p);
    return out.copy(camPos).setY(camPos.y - 1.6);
  }
  function available(name) {
    if (name === 'rifle' || name === 'shovel') return true;
    if (name === 'grenade') return api.grenades > 0;
    if (name === 'satchel') return api.satchels > 0;
    if (name === 'trap') return api.traps > 0;
    return false;
  }

  // ---- world raycast list (flattened, huge terrain meshes replaced by height-field march) ----
  let rayList = [], rayListSrc = null, rayListLen = -1;
  const triCount = (g) => (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
  function worldRayList() {
    const src = ctx.world?.raycastMeshes;
    if (!Array.isArray(src)) return rayList;
    if (src === rayListSrc && src.length === rayListLen) return rayList;
    rayListSrc = src; rayListLen = src.length; rayList = [];
    const hasHF = typeof ctx.world?.heightAt === 'function';
    for (const o of src) {
      if (!o) continue;
      o.traverse?.((m) => {
        if (!(m.isMesh || m.isInstancedMesh) || !m.geometry) return;
        const name = (m.name || '').toLowerCase();
        const isTerrain = m.userData?.terrain || m.userData?.isTerrain || /terrain|ground|heightfield/.test(name);
        if (hasHF && !m.isInstancedMesh && (isTerrain || triCount(m.geometry) > 24000)) return;
        rayList.push(m);
      });
    }
    return rayList;
  }

  function marchTerrain(o, d, maxT) {
    if (typeof ctx.world?.heightAt !== 'function') return -1;
    if (o.y < heightAt(o.x, o.z) - 0.05) return -1;
    let t = 0, prevT = 0;
    for (let i = 0; i < 320 && t < maxT; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = y - heightAt(x, z);
      if (h < 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) { const m = (a + b) * 0.5; if (o.y + d.y * m - heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; }
        return b;
      }
      prevT = t;
      t += clamp(h * 0.6, 0.15, 6);
    }
    return -1;
  }

  // Bullet trace: enemies, world meshes, terrain, water.
  function trace(origin, dir, range) {
    const R = traceRes;
    R.kind = 'none'; R.t = range; R.object = null; R.enemy = null; R.part = null; R.surface = null;
    raycaster.set(origin, dir); raycaster.near = 0.05; raycaster.far = range;
    const list = worldRayList();
    if (list.length) {
      hitsW.length = 0;
      try { raycaster.intersectObjects(list, false, hitsW); } catch (e) { hitsW.length = 0; }
      for (let i = 0; i < hitsW.length; i++) {
        const h = hitsW[i];
        if (h.distance < R.t) {
          R.t = h.distance; R.kind = 'world'; R.object = h.object; R.point.copy(h.point); R.surface = typeof h.surface === 'string' ? h.surface : null;
          if (h.face && !h.object.isInstancedMesh) R.normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
          else R.normal.copy(dir).negate();
          if (R.normal.dot(dir) > 0) R.normal.negate();
        }
        break;
      }
    }
    const tt = marchTerrain(origin, dir, R.t);
    if (tt >= 0 && tt < R.t) {
      R.t = tt; R.kind = 'terrain'; R.object = null; R.surface = null;
      R.point.copy(origin).addScaledVector(dir, tt);
      normalAt(R.point.x, R.point.z, R.normal);
    }
    const hb = ctx.enemies?.hitboxes;
    if (Array.isArray(hb) && hb.length) {
      if (hitboxSyncFrame !== frame) {
        hitboxSyncFrame = frame;
        for (let i = 0; i < hb.length; i++) { const h = hb[i]; if (h && h.updateWorldMatrix) h.updateWorldMatrix(true, false); }
      }
      hitsE.length = 0;
      try { raycaster.far = R.t; raycaster.intersectObjects(hb, false, hitsE); } catch (e) { hitsE.length = 0; }
      for (let i = 0; i < hitsE.length; i++) {
        const h = hitsE[i];
        const en = h.object.userData?.enemy;
        if (!en || en.alive === false || (Number.isFinite(en.health) && en.health <= 0)) continue;
        if (h.distance < R.t) {
          R.t = h.distance; R.kind = 'enemy'; R.object = h.object; R.enemy = en; R.part = h.object.userData.part || 'body';
          R.point.copy(h.point); R.normal.copy(dir).negate();
        }
        break;
      }
    }
    if (dir.y < -1e-4) {
      if (R.kind !== 'none') {
        // Anything hit below a local water surface (river bed, paddy mud, wading legs) was
        // reached through the water first: the round stops at the surface.
        const s = surfY(R.point.x, R.point.z);
        if (s > R.point.y + 0.01 && origin.y > s) {
          const tw = (s - origin.y) / dir.y;
          if (tw > 0 && tw < R.t) {
            const x = origin.x + dir.x * tw, z = origin.z + dir.z * tw;
            const s2 = surfY(x, z);
            setWaterHit(R, tw, x, Number.isFinite(s2) && Math.abs(s2 - s) < 0.4 ? s2 : s, z);
          }
        }
      } else {
        // ray ran out before reaching the ground: still catch the river plane
        const wl = waterLevel();
        if (origin.y > wl) {
          const tw = (wl - origin.y) / dir.y;
          if (tw > 0 && tw < R.t) {
            const x = origin.x + dir.x * tw, z = origin.z + dir.z * tw;
            if (Math.abs(surfY(x, z) - wl) < 0.05 && heightAt(x, z) < wl) setWaterHit(R, tw, x, wl, z);
          }
        }
      }
    }
    return R;
  }
  function setWaterHit(R, t, x, y, z) {
    R.t = t; R.kind = 'water'; R.object = null; R.enemy = null; R.part = null; R.surface = 'water';
    R.point.set(x, y, z); R.normal.set(0, 1, 0);
  }

  function classify(obj, p, hitSurface) {
    const ud = obj?.userData || {};
    const s = String(hitSurface || ud.surface || ud.material || ud.kind || ud.type || obj?.name || '').toLowerCase();
    if (/stone|rock|concrete/.test(s)) return 'stone';
    if (/leaf|foliage|bush|fern|canopy|grass|frond/.test(s)) return 'leaves';
    if (/water|river|paddy/.test(s)) return 'water';
    if (/sand|bag|berm|bunker/.test(s)) return 'sandbag';
    if (/metal|steel|tin|iron|drum|heli|huey|wire|truck|roof|corrugat/.test(s)) return 'metal';
    if (/tent|canvas|tarp/.test(s)) return 'canvas';
    if (/trunk|tree|wood|hut|log|bamboo|palm|crate|stilt|timber|tower|post|plank|branch/.test(s)) return 'wood';
    if (/terrain|ground|earth|dirt|mud/.test(s)) return terrainSurface(p);
    return obj ? 'wood' : terrainSurface(p);
  }
  function terrainSurface(p) {
    if (p.y <= surfY(p.x, p.z) + 0.05) return 'water';
    const fb = WORLD.firebase;
    const dx = p.x - fb.x, dz = p.z - fb.z;
    if (dx * dx + dz * dz < (fb.radius + 10) * (fb.radius + 10)) return 'laterite';
    return 'mud';
  }

  // ---- particles: effect recipes ---------------------------------------------------------
  const rnd = Math.random;
  const sgn = () => rnd() * 2 - 1;

  // Fill a particle spec (caller may tweak extra fields, then call ps.emit()).
  function spec(ps, x, y, z, vx, vy, vz, life, s0, s1, col, a, tile) {
    const s = ps.reset();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.s0 = s0; s.s1 = s1;
    s.r = col.r; s.g = col.g; s.b = col.b; s.a = a; s.tile = tile;
    return s;
  }
  function puff(ps, x, y, z, vx, vy, vz, life, s0, s1, col, a, tile) {
    spec(ps, x, y, z, vx, vy, vz, life, s0, s1, col, a, tile);
    ps.emit();
  }

  function impactFX(p, n, surface, dir) {
    const x = p.x, y = p.y, z = p.z;
    const nx = n.x, ny = n.y, nz = n.z;
    switch (surface) {
      case 'water': {
        for (let i = 0; i < 9; i++) { const s = spec(alphaFx, x, y + 0.02, z, sgn() * 0.8, 2.5 + rnd() * 3.5, sgn() * 0.8, 0.6 + rnd() * 0.4, 0.08, 0.22, COL.water, 0.75, 7); s.grav = 9.8; s.drag = 0.4; s.emit = 0.3; alphaFx.emit(); }
        { const s = spec(alphaFx, x, y + 0.05, z, 0, 0.6, 0, 0.9, 0.2, 0.9, COL.water, 0.4, 0); s.drag = 2; s.emit = 0.3; alphaFx.emit(); }
        impactSound(p, 'water');
        return;
      }
      case 'flesh': {
        for (let i = 0; i < 3; i++) { const s = spec(alphaFx, x, y, z, -dir.x * 0.6 + sgn() * 0.5, 0.3 + sgn() * 0.4, -dir.z * 0.6 + sgn() * 0.5, 0.35 + rnd() * 0.25, 0.12, 0.55, COL.blood, 0.7, rnd() < 0.5 ? 0 : 1); s.drag = 4; s.emit = 0.1; alphaFx.emit(); }
        for (let i = 0; i < 7; i++) { const s = spec(alphaFx, x, y, z, dir.x * 2 + sgn() * 1.5, 0.6 + rnd() * 1.6, dir.z * 2 + sgn() * 1.5, 0.5 + rnd() * 0.3, 0.05, 0.08, COL.blood, 0.9, 7); s.grav = 9.8; s.drag = 0.6; alphaFx.emit(); }
        return;
      }
      case 'metal': {
        for (let i = 0; i < 10; i++) { const s = spec(addFx, x, y, z, nx * 3 + sgn() * 4, ny * 3 + rnd() * 3, nz * 3 + sgn() * 4, 0.2 + rnd() * 0.3, 0.035, 0.01, tmpColor.setRGB(4, 2.4, 0.8), 1, 3); s.grav = 9.8; s.drag = 1.5; s.fadePow = 0.6; addFx.emit(); }
        { const s = spec(alphaFx, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 0.4, 0.3, nz * 0.4, 0.7, 0.1, 0.5, COL.smoke, 0.35, 0); s.drag = 3; alphaFx.emit(); }
        holes.add(p, n, 0.07);
        impactSound(p, 'metal');
        return;
      }
      default: break;
    }
    let col = COL.mud, dust = 5, chips = 7, chipTile = 6, chipCol = COL.debris, size = 1;
    if (surface === 'laterite') { col = COL.laterite; chipCol = COL.laterite; size = 1.2; }
    else if (surface === 'wood') { col = COL.wood; dust = 2; chips = 8; chipCol = COL.wood; size = 0.6; }
    else if (surface === 'sandbag') { col = COL.sand; dust = 6; chips = 3; chipCol = COL.sand; size = 1.2; }
    else if (surface === 'canvas') { col = COL.sand; dust = 2; chips = 2; size = 0.6; }
    else if (surface === 'stone') { col = COL.smoke; dust = 3; chips = 6; chipCol = COL.smoke; size = 0.8; }
    else if (surface === 'leaves') { dust = 1; chips = 0; size = 0.4; }
    for (let i = 0; i < dust; i++) {
      { const s = spec(alphaFx, x + nx * 0.04, y + ny * 0.04, z + nz * 0.04,
        nx * (1 + rnd() * 1.8) + sgn() * 0.5, ny * (1 + rnd() * 1.8) + rnd() * 0.6, nz * (1 + rnd() * 1.8) + sgn() * 0.5,
        0.7 + rnd() * 0.9, 0.1 * size, (0.55 + rnd() * 0.5) * size, col, 0.55, rnd() < 0.5 ? 0 : 1); s.drag = 3.2; s.grav = -0.15; s.flags = F_WIND; s.fadeIn = 0.08; s.fadePow = 1.4; alphaFx.emit(); }
    }
    for (let i = 0; i < chips; i++) {
      { const s = spec(alphaFx, x, y, z, nx * (2 + rnd() * 3) + sgn() * 1.6, ny * (2 + rnd() * 3) + 1 + rnd() * 2, nz * (2 + rnd() * 3) + sgn() * 1.6,
        0.6 + rnd() * 0.6, 0.025 + rnd() * 0.03, 0.025, chipCol, 1, chipTile); s.grav = 9.8; s.drag = 0.5; s.flags = F_COLLIDE; s.rv = sgn() * 10; s.fadePow = 0.3; s.fadeIn = 0.01; alphaFx.emit(); }
    }
    if (surface === 'leaves' || coverAt(x, z) > 0.45) leafBurst(x, y + 0.3, z, 3 + (rnd() * 4 | 0), 1);
    if (surface !== 'leaves') holes.add(p, n, surface === 'wood' ? 0.06 : 0.1);
    impactSound(p, surface);
  }

  function leafBurst(x, y, z, count, spread) {
    for (let i = 0; i < count; i++) {
      const c = rnd() < 0.4 ? COL.leafA : rnd() < 0.6 ? COL.leafB : COL.leafC;
      { const s = spec(alphaFx, x + sgn() * 0.3 * spread, y + rnd() * 0.6 * spread, z + sgn() * 0.3 * spread, sgn() * 1.2 * spread, 0.5 + rnd() * 1.5, sgn() * 1.2 * spread,
        2.2 + rnd() * 2.2, 0.06 + rnd() * 0.07, 0.07, c, 1, rnd() < 0.5 ? 4 : 5); s.grav = 1.3; s.drag = 2.2; s.flags = F_FLUTTER | F_COLLIDE; s.rv = sgn() * 5; s.fadeIn = 0.02; s.fadePow = 0.35; alphaFx.emit(); }
    }
  }

  // ---- light management -----------------------------------------------------------------
  const flash = { pos: new THREE.Vector3(), i: 0, peak: 0, decay: 1, range: 20, color: new THREE.Color(0xff9a40) };
  const muzzleL = { pos: new THREE.Vector3(), t: 0 };
  const fireGlow = { pos: new THREE.Vector3(), until: -1, i: 0 };
  function lightFlash(pos, intensity, range, decay) {
    if (intensity < flash.i) return;
    flash.pos.copy(pos); flash.i = intensity; flash.peak = intensity; flash.decay = decay; flash.range = range;
  }
  function updateLight(dt) {
    flash.i = Math.max(0, flash.i - flash.peak * dt / flash.decay);
    muzzleL.t = Math.max(0, muzzleL.t - dt);
    let I = 0, range = 18;
    if (flash.i > 1) {
      fxLight.position.copy(flash.pos); I = flash.i; range = flash.range; fxLight.color.setHex(0xff9a40);
    } else if (muzzleL.t > 0) {
      fxLight.position.copy(muzzleL.pos); I = 38 * (muzzleL.t / 0.05); range = 16; fxLight.color.setHex(0xffc27a);
    } else if (time < fireGlow.until) {
      const k = clamp((fireGlow.until - time) / 40, 0, 1);
      const fl = 0.75 + 0.25 * Math.sin(time * 13.1) * Math.sin(time * 7.3 + 1.2) + 0.1 * Math.sin(time * 31);
      fxLight.position.copy(fireGlow.pos); I = 520 * k * fl; range = 70; fxLight.color.setHex(0xff7a2a);
    }
    fxLight.intensity = I;
    fxLight.distance = range;
  }

  // ---- explosions ------------------------------------------------------------------------
  const emitters = []; // lingering fire / smoke / cook-off sources
  function onExplosion(e) {
    if (!e || !e.pos) return;
    const p = e.pos;
    const r = Number.isFinite(e.radius) ? e.radius : 8;
    if (e.by === 'player') explosionKillWindow = time;
    explosionFX(p, r, e);
    // jolt the viewmodel if close
    const d = camPos.distanceTo(p);
    if (d < r * 4) spr.jolt.kick((1 - d / (r * 4)) * 2.2 * clamp(r / 8, 0.6, 2.5));
  }

  function explosionFX(p, radius, e) {
    const x = p.x, y = p.y, z = p.z;
    const ground = heightAt(x, z);
    const under = e?.underground === true || y < ground - 1.0;
    const wy = under ? -Infinity : surfY(x, z);
    const wet = Number.isFinite(wy) && y < wy + 0.8 && wy - ground > 0.05;
    if (radius >= 20) { bigExplosion(p, e?.weapon === 'satchel' || e?.kind === 'satchel'); return; }
    const k = clamp(radius / 10, 0.35, 1.6);
    if (wet) lightFlash(tA.set(x, wy + 0.6, z), 240 * k, radius * 4, 0.22);
    else lightFlash(tA.set(x, y + 1, z), under ? 120 : 900 * k, radius * 6, 0.32);
    if (wet) {
      for (let i = 0; i < 46; i++) { const s = spec(alphaFx, x + sgn() * 0.6, wy, z + sgn() * 0.6, sgn() * 2.2, 6 + rnd() * 10 * k, sgn() * 2.2, 1.2 + rnd() * 0.8, 0.25, 0.7, COL.water, 0.85, 7); s.grav = 9.8; s.drag = 0.3; s.emit = 0.3; alphaFx.emit(); }
      for (let i = 0; i < 12; i++) { const s = spec(alphaFx, x + sgn(), wy + 0.3, z + sgn(), sgn() * 3, 1 + rnd() * 2, sgn() * 3, 2.5 + rnd() * 1.5, 1, 4.5 * k, COL.water, 0.4, rnd() < 0.5 ? 0 : 1); s.drag = 1.6; s.flags = F_WIND | F_SOFT; s.emit = 0.3; alphaFx.emit(); }
      return;
    }
    if (under) {
      for (let i = 0; i < 6; i++) { const s = spec(addFx, x, y + 0.4, z, sgn() * 2, rnd() * 1.5, sgn() * 2, 0.25 + rnd() * 0.2, 0.4, 1.4, tmpColor.setRGB(2.5, 1.2, 0.35), 0.9, 2); s.drag = 3; addFx.emit(); }
      for (let i = 0; i < 16; i++) { const s = spec(alphaFx, x + sgn() * 0.4, y + 0.3 + rnd() * 0.6, z + sgn() * 0.4, sgn() * 2.5, sgn() * 0.8, sgn() * 2.5, 2.5 + rnd() * 2, 0.4, 1.6, COL.mud, 0.75, rnd() < 0.5 ? 0 : 1); s.drag = 1.8; s.emit = 0.5; alphaFx.emit(); }
      for (let i = 0; i < 18; i++) { const s = spec(alphaFx, x, y + 0.5, z, sgn() * 4, rnd() * 3, sgn() * 4, 0.8 + rnd() * 0.5, 0.04, 0.04, COL.debris, 1, 6); s.grav = 9.8; s.rv = sgn() * 8; s.fadePow = 0.3; alphaFx.emit(); }
      return;
    }
    const gy = Math.max(y, ground);
    // fireball
    for (let i = 0; i < 14; i++) {
      { const s = spec(addFx, x + sgn() * 0.5 * k, gy + 0.5 + rnd() * 0.8 * k, z + sgn() * 0.5 * k, sgn() * 4 * k, 1 + rnd() * 4 * k, sgn() * 4 * k,
        0.3 + rnd() * 0.35, 1.3 * k, (3.4 + rnd() * 2.2) * k, tmpColor.setRGB(2.0, 0.78 + rnd() * 0.3, 0.18), 0.85, 2); s.drag = 4; s.fadeIn = 0.04; s.fadePow = 1.2; addFx.emit(); }
    }
    // sparks
    for (let i = 0; i < 26; i++) {
      { const s = spec(addFx, x, gy + 0.4, z, sgn() * 14 * k, 4 + rnd() * 14 * k, sgn() * 14 * k, 0.4 + rnd() * 0.6, 0.07, 0.03, tmpColor.setRGB(5, 2.8, 0.9), 1, 3); s.grav = 9.8; s.drag = 1.2; s.fadePow = 0.7; s.flags = F_COLLIDE; addFx.emit(); }
    }
    // dirt fountain + chunks
    const soil = terrainSurface(tB.set(x, gy, z)) === 'laterite' ? COL.laterite : COL.mud;
    for (let i = 0; i < 30; i++) {
      { const s = spec(alphaFx, x, gy + 0.3, z, sgn() * 7 * k, 5 + rnd() * 10 * k, sgn() * 7 * k, 1.4 + rnd() * 1.2, 0.06 + rnd() * 0.16, 0.08, COL.debris, 1, 6); s.grav = 9.8; s.drag = 0.4; s.rv = sgn() * 9; s.flags = F_COLLIDE; s.fadePow = 0.25; s.fadeIn = 0.01; alphaFx.emit(); }
    }
    for (let i = 0; i < 9; i++) {
      { const s = spec(alphaFx, x + sgn() * 0.6, gy + 0.6, z + sgn() * 0.6, sgn() * 2.5, 5 + rnd() * 6 * k, sgn() * 2.5, 1.6 + rnd() * 0.8, 0.6 * k, 2.4 * k, soil, 0.85, rnd() < 0.5 ? 0 : 1); s.grav = 5; s.drag = 1.2; s.emit = 0.5; s.fadeIn = 0.03; s.flags = F_SOFT; alphaFx.emit(); }
    }
    // rolling smoke
    for (let i = 0; i < 18; i++) {
      { const s = spec(alphaFx, x + sgn() * 1.2 * k, gy + 0.8 + rnd() * 2.2 * k, z + sgn() * 1.2 * k, sgn() * 1.5, 0.8 + rnd() * 2.2, sgn() * 1.5,
        5 + rnd() * 5, (1.8 + rnd()) * k, (5.5 + rnd() * 4) * k, rnd() < 0.5 ? COL.smoke : COL.darkSmoke, 0.8, rnd() < 0.5 ? 0 : 1); s.drag = 0.9; s.grav = -0.15; s.flags = F_WIND | F_SOFT; s.emit = 1.1; s.fadeIn = 0.06; s.rv = sgn() * 0.3; alphaFx.emit(); }
    }
    // ground dust ring
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU + rnd() * 0.3;
      { const s = spec(alphaFx, x + Math.cos(a) * 0.8, gy + 0.25, z + Math.sin(a) * 0.8, Math.cos(a) * 8 * k, 0.4, Math.sin(a) * 8 * k,
        1.8 + rnd(), 0.8 * k, 3.2 * k, soil, 0.68, rnd() < 0.5 ? 0 : 1); s.drag = 2.6; s.flags = F_WIND | F_SOFT; alphaFx.emit(); }
    }
    if (coverAt(x, z) > 0.3) leafBurst(x, gy + 3, z, 16, 3);
    scorches.add(tC.set(x, ground, z), normalAt(x, z, tN), 3.2 * k + 1);
  }

  function bigExplosion(p, isDump) {
    const x = p.x, z = p.z, gy = heightAt(x, z);
    lightFlash(tA.set(x, gy + 6, z), 26000, 260, 1.4);
    for (let i = 0; i < 40; i++) {
      { const s = spec(addFx, x + sgn() * 3, gy + 2 + rnd() * 6, z + sgn() * 3, sgn() * 9, 5 + rnd() * 14, sgn() * 9,
        1.0 + rnd() * 1.5, 4 + rnd() * 3, 12 + rnd() * 9, tmpColor.setRGB(1.7, 0.55 + rnd() * 0.25, 0.1), 0.5, 2); s.drag = 1.4; s.grav = -1.2; s.fadeIn = 0.03; s.fadePow = 1.3; s.rv = sgn() * 0.6; addFx.emit(); }
    }
    for (let i = 0; i < 22; i++) {
      { const s = spec(addFx, x + sgn() * 2, gy + 1 + rnd() * 2, z + sgn() * 2, sgn() * 22, 2 + rnd() * 8, sgn() * 22,
        0.5 + rnd() * 0.5, 2, 6, tmpColor.setRGB(3, 1.6, 0.5), 1, 2); s.drag = 3; s.fadeIn = 0.02; addFx.emit(); }
    }
    for (let i = 0; i < 80; i++) {
      { const s = spec(addFx, x + sgn() * 2, gy + 2, z + sgn() * 2, sgn() * 26, 10 + rnd() * 34, sgn() * 26,
        1.6 + rnd() * 2.4, 0.22 + rnd() * 0.2, 0.08, tmpColor.setRGB(5, 2.6, 0.8), 1, 3); s.grav = 9.8; s.drag = 0.35; s.flags = F_COLLIDE; s.fadePow = 0.5; addFx.emit(); }
    }
    for (let i = 0; i < 90; i++) {
      { const s = spec(alphaFx, x + sgn() * 2, gy + 1.5, z + sgn() * 2, sgn() * 22, 8 + rnd() * 26, sgn() * 22,
        2.5 + rnd() * 2.5, 0.12 + rnd() * 0.45, 0.12, COL.debris, 1, 6); s.grav = 9.8; s.drag = 0.25; s.rv = sgn() * 7; s.flags = F_COLLIDE; s.fadePow = 0.2; s.fadeIn = 0.01; alphaFx.emit(); }
    }
    for (let i = 0; i < 34; i++) {
      { const s = spec(alphaFx, x + sgn() * 5, gy + 3 + rnd() * 10, z + sgn() * 5, sgn() * 4, 5 + rnd() * 9, sgn() * 4,
        9 + rnd() * 7, 5 + rnd() * 3, 16 + rnd() * 10, COL.darkSmoke, 0.85, rnd() < 0.5 ? 0 : 1); s.drag = 0.45; s.grav = -0.3; s.flags = F_WIND | F_SOFT; s.emit = 1.6; s.fadeIn = 0.05; s.rv = sgn() * 0.2; alphaFx.emit(); }
    }
    const soil = COL.laterite;
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU + rnd() * 0.2;
      { const s = spec(alphaFx, x + Math.cos(a) * 3, gy + 0.6, z + Math.sin(a) * 3, Math.cos(a) * 20, 0.8, Math.sin(a) * 20,
        3 + rnd() * 2, 3, 9, soil, 0.8, rnd() < 0.5 ? 0 : 1); s.drag = 1.6; s.flags = F_WIND | F_SOFT; s.emit = 0.3; alphaFx.emit(); }
    }
    scorches.add(tC.set(x, gy, z), normalAt(x, z, tN), 15);
    // lingering column, fires and cook-offs
    emitters.push({ kind: 'column', x, y: gy, z, t: 0, dur: 160, acc: 0 });
    const rr = rand(Math.floor(time * 1000) + 7);
    for (let i = 0; i < 4; i++) {
      const a = rr() * TAU, d = 1 + rr() * 4;
      emitters.push({ kind: 'fire', x: x + Math.cos(a) * d, y: gy, z: z + Math.sin(a) * d, t: 0, dur: 70 + rr() * 50, acc: 0, size: 0.8 + rr() * 0.8 });
    }
    for (let i = 0; i < 9; i++) {
      const a = rr() * TAU, d = 2 + rr() * 6;
      emitters.push({ kind: 'cookoff', x: x + Math.cos(a) * d, y: gy + 0.5, z: z + Math.sin(a) * d, t: -(2 + rr() * 22), dur: 0.1, acc: 0 });
    }
    fireGlow.pos.set(x, gy + 3, z); fireGlow.until = time + 120;
    // wreck replaces the dump
    if (isDump && !ctx.world?.firebase?.wreck) {
      // world.js normally swaps in its own wreck on dumpDestroyed; this is the fallback.
      const dm = ctx.world?.firebase?.dumpMesh;
      if (dm) dm.visible = false;
      wreck.position.set(x, gy, z); wreck.visible = true;
    }
  }

  function updateEmitters(dt) {
    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i];
      e.t += dt;
      if (e.t < 0) continue;
      if (e.t > e.dur) {
        if (e.kind === 'cookoff') {
          emit('explosion', { pos: new THREE.Vector3(e.x, e.y, e.z), radius: 7, damage: 60, by: 'player', weapon: 'cookoff' });
        }
        emitters.splice(i, 1);
        continue;
      }
      const k = 1 - e.t / e.dur;
      if (e.kind === 'column') {
        e.acc += dt * (0.7 + 3.4 * k);
        while (e.acc >= 1) {
          e.acc -= 1;
          { const s = spec(alphaFx, e.x + sgn() * 2.5, e.y + 2 + rnd() * 3, e.z + sgn() * 2.5, sgn() * 0.6, 3 + rnd() * 2.5, sgn() * 0.6,
            11 + rnd() * 6, 3 + rnd() * 2, 13 + rnd() * 8, COL.darkSmoke, 0.6 + 0.25 * k, rnd() < 0.5 ? 0 : 1); s.drag = 0.12; s.flags = F_WIND | F_SOFT; s.emit = 0.9 * k; s.fadeIn = 0.08; s.rv = sgn() * 0.15; alphaFx.emit(); }
        }
      } else if (e.kind === 'fire') {
        e.acc += dt * 16 * (0.3 + 0.7 * k);
        while (e.acc >= 1) {
          e.acc -= 1;
          const s0 = e.size * (0.6 + 0.6 * k);
          { const s = spec(addFx, e.x + sgn() * 0.5, e.y + 0.2, e.z + sgn() * 0.5, sgn() * 0.4, 2 + rnd() * 2.2, sgn() * 0.4,
            0.45 + rnd() * 0.45, s0, s0 * 2.2, tmpColor.setRGB(2.5, 1.0 + rnd() * 0.35, 0.22), 0.9, 2); s.drag = 1.2; s.fadeIn = 0.12; s.rv = sgn() * 1.2; addFx.emit(); }
          if (rnd() < 0.12) { const s = spec(addFx, e.x, e.y + 0.8, e.z, sgn() * 0.8, 1.5 + rnd() * 2.5, sgn() * 0.8, 1.6 + rnd(), 0.05, 0.03, tmpColor.setRGB(5, 2.2, 0.6), 1, 3); s.flags = F_FLUTTER; s.drag = 0.6; s.grav = -0.4; addFx.emit(); }
        }
      }
    }
  }

  // ---- satchel -----------------------------------------------------------------------------
  function plantSatchel() {
    const pp = playerPos(tA);
    // set against the crate stack on the side nearest the player
    const b = dumpBounds(), c = dumpQ.centre;
    const hx = Math.max(0.6, (b.max.x - b.min.x) * 0.5 - 0.75), hz = Math.max(0.5, (b.max.z - b.min.z) * 0.5 - 0.75);
    let x = clamp(pp.x, c.x - hx, c.x + hx), z = clamp(pp.z, c.z - hz, c.z + hz);
    let dx = pp.x - x, dz = pp.z - z, d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = pp.x - c.x; dz = pp.z - c.z; d = Math.hypot(dx, dz) || 1; }
    x += dx / d * 0.35; z += dz / d * 0.35;
    const y = heightAt(x, z);
    planted.atDump = true;
    planted.active = true; planted.fuse = CFG.satchelFuse; planted.lastTick = time; planted.pos.set(x, y, z);
    plantedMesh.position.set(x, y + 0.2, z);
    plantedMesh.rotation.set(0, Math.atan2(dx, dz), 0.0);
    plantedMesh.visible = true;
    plantedMesh.updateMatrixWorld(true);
    api.satchels = Math.max(0, api.satchels - 1);
    api.satchelPlanted = true; api.satchelFuse = planted.fuse;
    satchel.model.visible = false;
    emit('satchelPlanted', { pos: planted.pos.clone(), fuse: CFG.satchelFuse });
    emit('message', { text: 'Charge planted' });
    emit('noise', { pos: planted.pos.clone(), loudness: 0.25 });
    autoSwitchAt = time + 0.45; autoSwitchTo = 'rifle';
  }

  function updatePlanted(dt) {
    if (!planted.active) return;
    planted.fuse -= dt;
    api.satchelFuse = Math.max(0, planted.fuse);
    // (audio.js runs the ticking itself from the satchelPlanted event)
    // sputtering fuse
    tA.copy(igniterOffset).applyMatrix4(plantedMesh.matrixWorld);
    if (rnd() < 0.7) { const s = spec(addFx, tA.x, tA.y, tA.z, sgn() * 0.8, 0.6 + rnd() * 1.4, sgn() * 0.8, 0.25 + rnd() * 0.3, 0.035, 0.012, tmpColor.setRGB(5, 2.6, 0.9), 1, 3); s.grav = 4; addFx.emit(); }
    if (rnd() < 0.25) { const s = spec(alphaFx, tA.x, tA.y + 0.03, tA.z, 0.1, 0.35, 0.1, 1.4, 0.04, 0.3, COL.smoke, 0.35, 0); s.drag = 1; s.flags = F_WIND; alphaFx.emit(); }
    if (planted.fuse <= 0) detonateSatchel();
  }

  function detonateSatchel() {
    planted.active = false; plantedMesh.visible = false;
    api.satchelPlanted = false; api.satchelFuse = -1;
    const pos = new THREE.Vector3(WORLD.ammoDump.x, heightAt(WORLD.ammoDump.x, WORLD.ammoDump.z) + 1.0, WORLD.ammoDump.z);
    const near = planted.atDump || Math.hypot(planted.pos.x - WORLD.ammoDump.x, planted.pos.z - WORLD.ammoDump.z) <= CFG.plantRange + 0.5;
    if (!near) pos.copy(planted.pos).setY(planted.pos.y + 0.4);
    emit('explosion', { pos, radius: CFG.satchelRadius, damage: CFG.satchelDamage, by: 'player', weapon: 'satchel', kind: 'satchel' });
    if (near && !api.dumpDestroyed) {
      api.dumpDestroyed = true;
      emit('dumpDestroyed', {});
    }
  }

  // ---- grenades ----------------------------------------------------------------------------
  function spawnGrenade(lob, fuseLeft) {
    let g = null;
    for (const t of thrown) if (!t.active) { g = t; break; }
    if (!g) g = thrown[0];
    g.active = true; g.rest = false; g.wet = false; g.fuse = fuseLeft; g.lastBounce = 0;
    g.pos.copy(camPos).addScaledVector(fwd, 0.4).addScaledVector(right, 0.14).addScaledVector(up, lob ? -0.12 : 0.02);
    const sp = lob ? 7.5 : 17;
    g.vel.copy(fwd).multiplyScalar(sp).addScaledVector(up, lob ? 2.2 : 3.0);
    const pv = ctx.player?.velocity;
    if (pv && Number.isFinite(pv.x)) g.vel.add(pv);
    g.spin.set(lob ? -6 : -13 + sgn() * 2, sgn() * 2, sgn() * 2);
    g.mesh.position.copy(g.pos);
    g.mesh.quaternion.copy(camera.quaternion);
    g.mesh.visible = true;
  }

  function updateThrown(dt) {
    const w = ctx.world;
    const nearFn = typeof w?.collidersNear === 'function' ? w.collidersNear : null;
    const allCols = Array.isArray(w?.colliders) ? w.colliders : null;
    const boxes = Array.isArray(w?.boxColliders) ? w.boxColliders : null;
    for (const g of thrown) {
      if (!g.active) continue;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.active = false; g.mesh.visible = false;
        emit('explosion', { pos: g.pos.clone().setY(g.pos.y + 0.15), radius: CFG.grenadeRadius, damage: CFG.grenadeDamage, by: 'player', weapon: 'grenade' });
        continue;
      }
      if (g.rest) continue;
      const steps = 2, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= 9.81 * h;
        if (g.wet) { const f = Math.exp(-3.5 * h); g.vel.multiplyScalar(f); g.vel.y -= 1.5 * h; }
        g.pos.addScaledVector(g.vel, h);
        // trees / posts
        let cols = allCols;
        if (nearFn) { try { cols = nearFn(g.pos.x, g.pos.z, 1.0, nearCols); } catch (e) { cols = allCols; } }
        if (cols) {
          for (let i = 0; i < cols.length; i++) {
            const c = cols[i];
            const dx = g.pos.x - c.x, dz = g.pos.z - c.z, rr = (c.r || 0.3) + 0.05;
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr && d2 > 1e-8) {
              const top = Number.isFinite(c.h) ? c.h : Number.isFinite(c.top) ? c.top : heightAt(c.x, c.z) + 12;
              if (g.pos.y > top) continue;
              const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
              g.pos.x = c.x + nx * rr; g.pos.z = c.z + nz * rr;
              const vn = g.vel.x * nx + g.vel.z * nz;
              if (vn < 0) { g.vel.x -= 1.45 * vn * nx; g.vel.z -= 1.45 * vn * nz; g.vel.x *= 0.7; g.vel.z *= 0.7; bounceSound(g, -vn); }
            }
          }
        }
        if (boxes) {
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i]; if (!b?.min || !b?.max) continue;
            const p = g.pos;
            if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) {
              const px0 = p.x - b.min.x, px1 = b.max.x - p.x, py0 = p.y - b.min.y, py1 = b.max.y - p.y, pz0 = p.z - b.min.z, pz1 = b.max.z - p.z;
              const m = Math.min(px0, px1, py0, py1, pz0, pz1);
              let speed = 0;
              if (m === py1) { p.y = b.max.y + 0.01; speed = -g.vel.y; if (g.vel.y < 0) g.vel.y *= -0.3; g.vel.x *= 0.7; g.vel.z *= 0.7; }
              else if (m === py0) { p.y = b.min.y - 0.01; if (g.vel.y > 0) g.vel.y *= -0.3; }
              else if (m === px0) { p.x = b.min.x - 0.01; speed = g.vel.x; if (g.vel.x > 0) g.vel.x *= -0.35; }
              else if (m === px1) { p.x = b.max.x + 0.01; speed = -g.vel.x; if (g.vel.x < 0) g.vel.x *= -0.35; }
              else if (m === pz0) { p.z = b.min.z - 0.01; speed = g.vel.z; if (g.vel.z > 0) g.vel.z *= -0.35; }
              else { p.z = b.max.z + 0.01; speed = -g.vel.z; if (g.vel.z < 0) g.vel.z *= -0.35; }
              bounceSound(g, Math.abs(speed));
            }
          }
        }
        // terrain
        const gh = heightAt(g.pos.x, g.pos.z) + 0.03;
        if (g.pos.y < gh) {
          g.pos.y = gh;
          normalAt(g.pos.x, g.pos.z, tN);
          const vn = g.vel.dot(tN);
          if (vn < 0) {
            g.vel.addScaledVector(tN, -1.32 * vn);
            g.vel.multiplyScalar(0.62);
            g.spin.multiplyScalar(0.6);
            bounceSound(g, -vn);
            if (g.vel.lengthSq() < 0.5) { g.rest = true; g.vel.set(0, 0, 0); }
          }
        }
        // water entry
        const wl = g.wet ? 0 : surfY(g.pos.x, g.pos.z);
        if (!g.wet && g.pos.y < wl) {
          g.wet = true;
          for (let i = 0; i < 10; i++) { const s2 = spec(alphaFx, g.pos.x, wl, g.pos.z, sgn() * 1.2, 1.5 + rnd() * 2.5, sgn() * 1.2, 0.6, 0.06, 0.16, COL.water, 0.8, 7); s2.grav = 9.8; s2.emit = 0.3; alphaFx.emit(); }
          sfx('splash', g.pos);
        }
      }
      g.mesh.position.copy(g.pos);
      if (!g.rest) {
        _e1.set(g.spin.x * dt, g.spin.y * dt, g.spin.z * dt);
        qA.setFromEuler(_e1);
        g.mesh.quaternion.multiply(qA);
      } else {
        // settle lying on its side
        qB.setFromEuler(_e1.set(0, g.mesh.rotation.y, Math.PI / 2));
        g.mesh.quaternion.slerp(qB, damp(6, dt));
      }
    }
  }
  function bounceSound(g, speed) {
    if (speed < 1.2 || time - g.lastBounce < 0.08) return;
    g.lastBounce = time;
    emit('grenadeBounce', { pos: g.pos.clone(), speed });
    emit('noise', { pos: g.pos.clone(), loudness: clamp(speed / 20, 0.05, 0.25) });
  }

  // ---- dropped magazines ----------------------------------------------------------------
  function dropMag() {
    let m = null;
    for (const d of droppedMags) if (!d.active) { m = d; break; }
    if (!m) { m = droppedMags[0]; for (const d of droppedMags) if (d.life > m.life) m = d; }
    rifle.mag.updateMatrixWorld(true);
    rifle.mag.matrixWorld.decompose(m.mesh.position, m.mesh.quaternion, tA);
    m.mesh.scale.set(1, 1, 1);
    m.vel.copy(fwd).multiplyScalar(0.4).addScaledVector(up, -1.2).addScaledVector(right, -0.3);
    const pv = ctx.player?.velocity; if (pv && Number.isFinite(pv.x)) m.vel.add(pv);
    m.spin.set(sgn() * 3, sgn() * 3, 2 + rnd() * 3);
    m.life = 0; m.rest = false; m.active = true; m.mesh.visible = true;
  }
  function updateMags(dt) {
    for (const m of droppedMags) {
      if (!m.active) continue;
      m.life += dt;
      if (m.life > 30) { m.active = false; m.mesh.visible = false; continue; }
      if (m.rest) continue;
      m.vel.y -= 9.81 * dt;
      m.mesh.position.addScaledVector(m.vel, dt);
      _e1.set(m.spin.x * dt, m.spin.y * dt, m.spin.z * dt); qA.setFromEuler(_e1); m.mesh.quaternion.multiply(qA);
      const h = heightAt(m.mesh.position.x, m.mesh.position.z) + 0.016;
      if (m.mesh.position.y < h) {
        m.mesh.position.y = h;
        if (m.vel.y < -1.5) sfx('gear', m.mesh.position, { rate: 0.7 });
        m.vel.y *= -0.25; m.vel.x *= 0.4; m.vel.z *= 0.4; m.spin.multiplyScalar(0.3);
        if (Math.abs(m.vel.y) < 0.6) {
          m.rest = true;
          qB.setFromEuler(_e1.set(0, rnd() * TAU, Math.PI / 2));
          m.mesh.quaternion.copy(qB);
        }
      }
    }
  }

  // ---- switching -------------------------------------------------------------------------
  function setCurrent(name) {
    api.current = name;
    for (const k of ITEMS) rigs[k].root.visible = k === name;
    if (name === 'satchel') satchel.model.visible = api.satchels > 0;
    if (name === 'grenade') grenade.model.visible = api.grenades > 0;
    if (name === 'trap') trap.model.visible = api.traps > 0;
    emit('weaponSwitch', { current: name });
  }
  function cancelActions() {
    if (rs.reload) {
      if (!rs.reload.inserted) { rifle.mag.visible = true; rifle.mag.position.copy(RIFLE_MAG_PIVOT); rifle.mag.rotation.set(0, 0, 0); }
      rs.reload = null; api.reloading = false; api.reloadProgress = 0;
    }
    if (dig.active) { dig.active = false; setProgress(null, 0); }
    melee.active = false;
    if (plant.t > 0) { plant.t = 0; setProgress(null, 0); }
    if (trapA.t > 0) { trapA.t = 0; setProgress(null, 0); }
    if (throwA.active && !throwA.released) {
      // the cord was pulled: the grenade must still leave the hand
      if (throwA.pulled) { spawnGrenade(true, Math.max(0.3, CFG.grenadeFuse - (time - throwA.pullTime))); api.grenades = Math.max(0, api.grenades - 1); }
    }
    throwA.active = false;
    grenade.lArm.visible = false;
  }
  function requestSwitch(name, opts = {}) {
    if (!rigs[name]) return false;
    if (name === api.current && sw.phase === 'idle') return false;
    if (throwA.active && !throwA.released) return false;
    if (name === api.current && sw.phase === 'up') return false;
    cancelActions();
    sw.target = name; sw.fast = !!opts.fast;
    if (sw.phase !== 'down') sw.phase = 'down';
    if (name !== 'grenade') quick = opts.keepQuick ? quick : null;
    return true;
  }
  function select(name) {
    if (!ITEMS.includes(name)) return false;
    if (ctx.player?.underground && name !== 'shovel' && name !== 'rifle') return false;
    if (!available(name)) return false;
    return requestSwitch(name);
  }
  function updateSwitch(dt) {
    if (sw.phase === 'down') {
      sw.t += dt / (CFG.switchDown * (sw.fast ? 0.55 : 1));
      if (sw.t >= 1) {
        sw.t = 1; setCurrent(sw.target || api.current); sw.phase = 'up';
      }
    } else if (sw.phase === 'up') {
      sw.t -= dt / (CFG.switchUp * (sw.fast ? 0.6 : 1));
      if (sw.t <= 0) {
        sw.t = 0; sw.phase = 'idle';
        if (quick && api.current === 'grenade') startThrow(false);
      }
    }
    api.switching = sw.phase !== 'idle';
  }

  // ---- rifle ---------------------------------------------------------------------------------
  function startReload() {
    if (api.current !== 'rifle' || rs.reload || sw.phase !== 'idle') return;
    if (api.ammo.mag >= CFG.magSize || api.ammo.reserve <= 0) return;
    const empty = api.ammo.mag === 0;
    rs.reload = { t: 0, dur: empty ? CFG.reloadEmptyTime : CFG.reloadTime, empty, dropped: false, inserted: false, racked: false, shown: false };
    api.reloading = true;
    emit('reload', { empty });
  }
  function updateReload(dt) {
    const r = rs.reload; if (!r) return;
    r.t += dt / r.dur;
    const insertT = r.empty ? 0.56 : 0.66;
    if (!r.dropped && r.t >= 0.3) { r.dropped = true; dropMag(); rifle.mag.visible = false; sfx('gear', null, { rate: 1.2 }); }
    if (!r.shown && r.t >= 0.42) { r.shown = true; rifle.mag.visible = true; }
    if (!r.inserted && r.t >= insertT) {
      r.inserted = true;
      const total = api.ammo.mag + api.ammo.reserve;
      const take = Math.min(CFG.magSize, total);
      api.ammo.mag = take; api.ammo.reserve = total - take;
      sfx('click', null, { rate: 0.8 });
    }
    if (r.empty && !r.racked && r.t >= 0.79) { r.racked = true; sfx('click', null, { rate: 0.62, gain: 1.3 }); }
    api.reloadProgress = clamp(r.t, 0, 1);
    if (r.t >= 1) { rs.reload = null; api.reloading = false; api.reloadProgress = 0; rifle.mag.visible = true; }
  }

  function currentSpread() {
    const pl = ctx.player;
    const speed = pl?.velocity ? Math.hypot(pl.velocity.x, pl.velocity.z) : 0;
    const mv = clamp(speed / 3.2, 0, 1.6);
    const ads = easeInOut(adsT);
    let s = lerp(CFG.spreadHip, CFG.spreadAds, ads) + mv * lerp(CFG.spreadMove, CFG.spreadMoveAds, ads) + rs.bloom * lerp(1, 0.3, ads);
    const st = pl?.stance;
    if (st === 'crouch') s *= 0.78; else if (st === 'prone') s *= 0.6;
    if (pl && pl.grounded === false && !pl.underground) s += 0.05;
    return s;
  }

  function queueShot() {
    api.ammo.mag--;
    rs.pending++;
    rs.burst++;
    rs.lastShot = time; api.lastShotTime = time; api.shotsFired++;
    const ads = easeInOut(adsT);
    rs.bloom = Math.min(CFG.bloomMax, rs.bloom + 0.0042);
    // visual recoil
    spr.recZ.kick(lerp(1.05, 0.55, ads));
    spr.recRot.kick(lerp(1.5, 0.75, ads) * (0.85 + rnd() * 0.3));
    spr.recRoll.kick(sgn() * lerp(0.9, 0.35, ads));
    spr.recY.kick(lerp(0.25, 0.12, ads));
    rs.boltKick = 1;
    rs.flashT = 0.05;
    // aim recoil
    const st = ctx.player?.stance;
    const sm = st === 'prone' ? 0.55 : st === 'crouch' ? 0.8 : 1;
    const ramp = 1 + 0.35 * Math.min(1, rs.burst / 8);
    const kp = CFG.kickPitch * lerp(1, 0.66, ads) * sm * ramp * (0.85 + rnd() * 0.3);
    const ky = (rnd() - 0.42) * 2 * CFG.kickYaw * lerp(1, 0.7, ads) * sm;
    const pl = ctx.player;
    if (pl && typeof pl.addRecoil === 'function') { try { pl.addRecoil(kp, ky); } catch (e) { /* ignore */ } }
    else { aim.pending += kp; aim.pendingYaw += ky; }
    aim.lastFire = time;
  }

  function applyAimRecoil(dt) {
    const pl = ctx.player;
    if (!pl || typeof pl.addRecoil === 'function' || !Number.isFinite(pl.pitch)) { aim.pending = 0; aim.pendingYaw = 0; return; }
    // learn the pitch sign (does +pitch look up?)
    if (Math.abs(pl.pitch) > 0.15 && Math.abs(fwd.y) > 0.1) aim.pitchSign = Math.sign(pl.pitch) === Math.sign(fwd.y) ? 1 : -1;
    if (aim.pending > 1e-5) {
      const a = aim.pending * Math.min(1, dt * 28);
      pl.pitch += aim.pitchSign * a; aim.pending -= a; aim.recover += a;
    }
    if (Math.abs(aim.pendingYaw) > 1e-6) { const a = aim.pendingYaw * Math.min(1, dt * 28); if (Number.isFinite(pl.yaw)) pl.yaw += a; aim.pendingYaw -= a; }
    if (time - aim.lastFire > 0.12 && aim.recover > 1e-5) {
      const r = aim.recover * Math.min(1, dt * 7);
      pl.pitch -= aim.pitchSign * r * 0.8; aim.recover -= r;
    }
  }

  function executeShots() {
    if (!rs.pending) return;
    rifle.muzzle.getWorldPosition(muzzleW);
    rifle.ejector.getWorldPosition(ejectW);
    const ads = easeInOut(adsT);
    while (rs.pending > 0) {
      rs.pending--;
      const spread = currentSpread();
      const a = spread * Math.sqrt(rnd()), ph = rnd() * TAU, ta = Math.tan(a);
      tB.copy(fwd).addScaledVector(right, ta * Math.cos(ph)).addScaledVector(up, ta * Math.sin(ph)).normalize();
      const res = trace(camPos, tB, CFG.range);
      const end = tC.copy(camPos).addScaledVector(tB, res.kind === 'none' ? CFG.range : res.t);
      if (res.kind === 'enemy') {
        const en = res.enemy, part = res.part;
        const head = part === 'head';
        const dmg = head ? CFG.dmgHead : /leg|arm|limb/.test(part) ? 26 : CFG.dmgBody;
        const wasAlive = en.alive !== false;
        try { en.damage?.(dmg, part, camPos.clone()); } catch (e) { console.error('[weapons] enemy.damage', e); }
        const killed = wasAlive && (en.alive === false || (Number.isFinite(en.health) && en.health <= 0));
        if (killed) bulletKillFrame = frame;
        api.hits++;
        emit('hitMarker', { kill: killed, headshot: head, pos: res.point.clone() });
        impactFX(res.point, res.normal, 'flesh', tB);
      } else if (res.kind === 'world') {
        impactFX(res.point, res.normal, classify(res.object, res.point, res.surface), tB);
      } else if (res.kind === 'terrain') {
        impactFX(res.point, res.normal, terrainSurface(res.point), tB);
      } else if (res.kind === 'water') {
        impactFX(res.point, res.normal, 'water', tB);
      }
      if (api.shotsFired % CFG.tracerEvery === 0) tracers.spawn(muzzleW, end, CFG.tracerSpeed, CFG.tracerLen, 0.035, 2);
      emit('shot', { pos: muzzleW.clone(), dir: tB.clone(), by: 'player', weapon: 'rifle' });
      // muzzle smoke + light
      { const s = spec(alphaFx, muzzleW.x + fwd.x * 0.08, muzzleW.y + fwd.y * 0.08, muzzleW.z + fwd.z * 0.08, fwd.x * 1.2 + sgn() * 0.2, 0.3 + fwd.y, fwd.z * 1.2 + sgn() * 0.2,
        0.9 + rnd() * 0.5, 0.05, 0.42, COL.muzzleSmoke, lerp(0.22, 0.08, ads), 0); s.drag = 2.2; s.flags = F_WIND; s.grav = -0.2; s.fadeIn = 0.1; alphaFx.emit(); }
      muzzleL.pos.copy(muzzleW).addScaledVector(fwd, 0.25); muzzleL.t = 0.05;
      // ejected case
      const pv = ctx.player?.velocity;
      tA.copy(right).multiplyScalar(1.9 + rnd() * 0.9).addScaledVector(up, 1.1 + rnd() * 0.8).addScaledVector(fwd, 1.3 + rnd() * 0.7);
      if (pv && Number.isFinite(pv.x)) tA.add(pv);
      shells.spawn(tB.copy(ejectW).addScaledVector(fwd, 0.08), tA);
    }
  }

  // ---- shovel: dig + melee ----------------------------------------------------------------
  function findMeleeTarget(maxD) {
    const list = ctx.enemies?.list;
    if (!Array.isArray(list)) return null;
    const pp = playerPos(tA);
    let best = null, bd = maxD;
    for (const e of list) {
      if (!e || e.alive === false || !e.position) continue;
      const dx = e.position.x - pp.x, dz = e.position.z - pp.z, dy = e.position.y - pp.y;
      if (Math.abs(dy) > 1.8) continue;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      const dot = d > 1e-3 ? (dx * fwdH.x + dz * fwdH.z) / d : 1;
      if (dot < (d < 0.9 ? 0.0 : 0.55)) continue;
      best = e; bd = d;
    }
    return best;
  }

  function queryDigTarget() {
    const tun = ctx.tunnels;
    if (!tun) return null;
    const pp = playerPos(tA);
    if (typeof tun.digTarget === 'function') {
      let r = null;
      try { r = tun.digTarget(pp, fwd); } catch (e) { r = null; }
      if (!r || !r.type) return null;
      if (r.type !== 'cell' && r.type !== 'hatch' && r.type !== 'chamber') return null;
      return r;
    }
    // fallback when tunnels has no digTarget()
    const under = !!ctx.player?.underground;
    const c = typeof tun.cellOf === 'function' ? tun.cellOf(pp.x, pp.z) : { cx: Math.floor(pp.x / WORLD.cell), cz: Math.floor(pp.z / WORLD.cell) };
    if (under) {
      if (fwd.y > 0.72 && typeof tun.createHatch === 'function') return { type: 'hatch', cx: c.cx, cz: c.cz };
      if (typeof tun.dig === 'function') return { type: 'cell', cx: c.cx + Math.round(fwdH.x), cz: c.cz + Math.round(fwdH.z) };
      return null;
    }
    if (fwd.y < -0.55 && typeof tun.createHatch === 'function') return { type: 'hatch', cx: c.cx, cz: c.cz };
    return null;
  }

  function startMelee(swingOnly) {
    melee.active = true; melee.t = 0; melee.hitDone = false; melee.swingOnly = swingOnly;
    emit('melee', { hit: false });
  }

  function updateMelee(dt) {
    if (!melee.active) return;
    melee.t += dt / 0.62;
    if (!melee.hitDone && melee.t >= 0.4) {
      melee.hitDone = true;
      const target = findMeleeTarget(CFG.meleeRange + 0.2);
      if (target) {
        const wasAlive = target.alive !== false;
        try { target.damage?.(CFG.meleeDamage, 'body', camPos.clone()); } catch (e) { console.error('[weapons] melee', e); }
        const killed = wasAlive && (target.alive === false || (Number.isFinite(target.health) && target.health <= 0));
        if (killed) bulletKillFrame = frame;
        emit('hitMarker', { kill: killed, headshot: false, melee: true });
        tA.copy(target.position); tA.y += 1.3;
        impactFX(tA, tN.copy(fwd).negate(), 'flesh', fwd);
        emit('melee', { hit: true, pos: tA.clone() });
        spr.jolt.kick(-1.2);
      } else {
        const res = trace(camPos, fwd, 2.0);
        if (res.kind === 'world' || res.kind === 'terrain') {
          impactFX(res.point, res.normal, res.kind === 'terrain' ? terrainSurface(res.point) : classify(res.object, res.point, res.surface), fwd);
          spr.jolt.kick(-0.8);
        }
      }
      emit('noise', { pos: camPos.clone(), loudness: 0.18 });
    }
    if (melee.t >= 1) melee.active = false;
  }

  function digCenter(t, out) {
    const tun = ctx.tunnels;
    if (typeof tun?.cellCenter === 'function') {
      try { const c = tun.cellCenter(t.cx, t.cz); if (c && Number.isFinite(c.x)) return out.set(c.x, c.y, c.z); } catch (e) { /* fall through */ }
    }
    return out.set((t.cx + 0.5) * WORLD.cell, 0, (t.cz + 0.5) * WORLD.cell);
  }

  function completeDig() {
    const tun = ctx.tunnels; if (!tun) return false;
    const pp = playerPos(tA);
    let ok = false;
    try {
      if (dig.kind === 'cell') ok = !!tun.dig?.(pp, tB.copy(fwdH));
      else if (dig.kind === 'hatch') { digCenter(dig, tC); ok = !!tun.createHatch?.(tC.x, tC.z); }
      else if (dig.kind === 'chamber') ok = !!tun.digChamber?.(dig.cx, dig.cz);
    } catch (e) { console.error('[weapons] dig', e); ok = false; }
    return ok;
  }

  function dirtSpray(n) {
    // clods in front of the blade
    tA.copy(camPos).addScaledVector(fwd, 0.75).addScaledVector(up, -0.12);
    const under = !!ctx.player?.underground;
    const col = under ? COL.laterite : terrainSurface(tA) === 'laterite' ? COL.laterite : COL.mud;
    for (let i = 0; i < n; i++) {
      { const s = spec(alphaFx, tA.x + sgn() * 0.1, tA.y + sgn() * 0.1, tA.z + sgn() * 0.1, -fwd.x * 0.8 + sgn() * 0.7, 0.8 + rnd() * 1.2, -fwd.z * 0.8 + sgn() * 0.7,
        0.5 + rnd() * 0.3, 0.02 + rnd() * 0.03, 0.02, COL.debris, 1, 6); s.grav = 9.8; s.rv = sgn() * 8; s.fadePow = 0.3; s.fadeIn = 0.01; alphaFx.emit(); }
    }
    { const s = spec(alphaFx, tA.x, tA.y, tA.z, sgn() * 0.2, 0.2, sgn() * 0.2, 1.2, 0.08, 0.5, col, under ? 0.35 : 0.25, 0); s.drag = 2.5; s.emit = under ? 0.15 : 0; alphaFx.emit(); }
  }

  function updateShovel(dt, input, mouse) {
    const under = !!ctx.player?.underground;
    updateMelee(dt);
    if (sw.phase !== 'idle') return;
    const pressedL = input.pressed?.has?.('Mouse0');
    if (pressedL && !melee.active) {
      const target = !under ? findMeleeTarget(CFG.meleeRange) : null;
      if (target) { if (dig.active) { dig.active = false; setProgress(null, 0); } startMelee(false); return; }
    }
    if (melee.active) return;
    dig.cooldown = Math.max(0, dig.cooldown - dt);
    if (!mouse.left && !dig.active) api.digTarget = null;
    if (mouse.left && dig.cooldown <= 0) {
      dig.requery -= dt;
      if (!dig.active || dig.requery <= 0) {
        dig.requery = 0.15;
        const t = queryDigTarget();
        api.digTarget = t;
        if (!t) {
          if (dig.active) { dig.active = false; setProgress(null, 0); }
          if (pressedL) startMelee(true);
          return;
        }
        if (!dig.active || t.type !== dig.kind || t.cx !== dig.cx || t.cz !== dig.cz) {
          dig.active = true; dig.kind = t.type; dig.cx = t.cx; dig.cz = t.cz; dig.t = 0; dig.stroke = 0;
        }
      }
      const dur = CFG.digTimes[dig.kind] || 1.5;
      dig.t += dt / dur;
      dig.phase += dt / 0.52;
      if (dig.phase >= dig.stroke + 1) {
        dig.stroke = Math.floor(dig.phase);
        dirtSpray(4);
        emit('noise', { pos: camPos.clone(), loudness: under ? 0.06 : 0.14 });
      }
      setProgress(dig.kind, Math.min(dig.t, 1));
      if (dig.t >= 1) {
        const ok = completeDig();
        if (ok) { dirtSpray(10); spr.jolt.kick(-0.6); }
        dig.active = false; dig.cooldown = ok ? 0.18 : 0.6; dig.requery = 0;
        setProgress(null, 0);
      }
    } else if (dig.active) {
      dig.active = false; setProgress(null, 0);
    }
  }

  // ---- satchel / grenade / trap ------------------------------------------------------------
  // ---- ammo dump reach: measured to the crate stack's bounds, not its centre, so the charge can
  // be set from any side of the sandbag revetment (leaning over the bags) and not just the gap.
  const dumpQ = { box: new THREE.Box3(), aim: new THREE.Box3(), centre: new THREE.Vector3(), ray: new THREE.Ray(), hit: new THREE.Vector3(), ok: false, tries: 0 };
  function dumpBounds() {
    if (dumpQ.ok) return dumpQ.box;
    const dm = ctx.world?.firebase?.dumpMesh;
    let got = false;
    if (dm && dumpQ.tries < 5) {
      dumpQ.tries++;
      try {
        dm.updateWorldMatrix(true, true);
        dumpQ.box.setFromObject(dm);
        const sz = dumpQ.box.getSize(tN);
        got = !dumpQ.box.isEmpty() && sz.x < 20 && sz.z < 20 && Number.isFinite(sz.x);
      } catch (e) { got = false; }
    }
    if (!got) {
      // fallback: tarp + crate footprint around the contract position
      const dx = WORLD.ammoDump.x, dz = WORLD.ammoDump.z, gy = heightAt(dx, dz);
      dumpQ.box.min.set(dx - 2.65, gy, dz - 1.95); dumpQ.box.max.set(dx + 2.65, gy + 2.8, dz + 1.95);
      if (!dm || dumpQ.tries >= 5) dumpQ.ok = !!ctx.world; // world present but no mesh: keep the fallback
    } else dumpQ.ok = true;
    dumpQ.box.getCenter(dumpQ.centre);
    dumpQ.aim.copy(dumpQ.box).expandByScalar(0.3);
    return dumpQ.box;
  }
  function dumpGone() {
    return api.dumpDestroyed || ctx.world?.firebase?.dumpMesh?.userData?.destroyed === true;
  }
  function canReachDump(pp) {
    const b = dumpBounds();
    const dx = Math.max(b.min.x - pp.x, 0, pp.x - b.max.x), dz = Math.max(b.min.z - pp.z, 0, pp.z - b.max.z);
    const dH = Math.sqrt(dx * dx + dz * dz);
    if (dH > CFG.plantReach) return false;
    if (pp.y < b.min.y - 2.0 || pp.y > b.max.y + 1.5) return false;
    if (dH < 0.9) return true; // right at the stack
    // further out the player has to be looking at it
    dumpQ.ray.set(camPos, fwd);
    if (dumpQ.ray.intersectBox(dumpQ.aim, dumpQ.hit) && dumpQ.hit.distanceToSquared(camPos) < (CFG.plantReach + 3) * (CFG.plantReach + 3)) return true;
    const cx = dumpQ.centre.x - pp.x, cz = dumpQ.centre.z - pp.z, l = Math.sqrt(cx * cx + cz * cz) || 1;
    return (cx * fwdH.x + cz * fwdH.z) / l > 0.72;
  }

  function updateSatchel(dt, mouse) {
    const pp = playerPos(tA);
    const near = !ctx.player?.underground && !dumpGone() && !planted.active && canReachDump(pp);
    api.canPlant = near && api.satchels > 0;
    if (sw.phase !== 'idle' || api.satchels <= 0) { if (plant.t > 0) { plant.t = 0; setProgress(null, 0); } return; }
    if (mouse.left && api.canPlant) {
      plant.t += dt / CFG.plantTime;
      setProgress('plant', Math.min(1, plant.t));
      if (plant.t >= 1) { plant.t = 0; setProgress(null, 0); plantSatchel(); }
    } else if (plant.t > 0) { plant.t = 0; setProgress(null, 0); }
  }

  function startThrow(lob) {
    if (api.grenades <= 0 || throwA.active || ctx.player?.underground) { quick = null; return; }
    throwA.active = true; throwA.t = 0; throwA.lob = lob; throwA.released = false; throwA.pulled = false;
    grenade.model.visible = true;
  }
  function updateThrow(dt) {
    if (!throwA.active) return;
    throwA.t += dt / (throwA.lob ? 0.62 : 0.72);
    if (!throwA.pulled && throwA.t >= 0.14) { throwA.pulled = true; throwA.pullTime = time; }
    if (!throwA.released && throwA.t >= (throwA.lob ? 0.36 : 0.4)) {
      throwA.released = true;
      spawnGrenade(throwA.lob, CFG.grenadeFuse - (time - throwA.pullTime));
      api.grenades = Math.max(0, api.grenades - 1);
      grenade.model.visible = false;
      emit('grenadeThrown', { pos: camPos.clone() });
    }
    if (throwA.t >= 0.62 && api.grenades > 0 && !quick) grenade.model.visible = true;
    if (throwA.t >= 1) {
      throwA.active = false;
      if (quick) { const back = quick.returnTo; quick = null; requestSwitch(available(back) ? back : 'rifle', { fast: true }); }
      else if (api.grenades <= 0) requestSwitch('rifle');
    }
  }
  function updateGrenade(dt, input) {
    if (sw.phase !== 'idle' || throwA.active || api.grenades <= 0) return;
    if (input.pressed?.has?.('Mouse0')) startThrow(false);
    else if (input.pressed?.has?.('Mouse2')) startThrow(true);
  }

  // Same rules as tunnels.placeTrap(), so a green ghost always means the stakes go in.
  // Prefers a validation-only call from tunnels.js when it offers one.
  function trapSiteOk(x, z, y) {
    const tun = ctx.tunnels;
    if (typeof tun?.canPlaceTrap === 'function') {
      try { return !!tun.canPlaceTrap(x, z); } catch (e) { return false; }
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const lim = WORLD.playable - 3;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (isWater(x, z) || isWater(x + 0.5, z) || isWater(x - 0.5, z) || isWater(x, z + 0.5) || isWater(x, z - 0.5)) return false;
    const traps = tun?.traps;
    if (Array.isArray(traps)) for (let i = 0; i < traps.length; i++) { const t = traps[i]; if (t && (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 1.69) return false; }
    const hs = tun?.hatches;
    if (Array.isArray(hs)) for (let i = 0; i < hs.length; i++) { const h = hs[i]; if (h && (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z) < 2.56) return false; }
    let mn = y, mx = y;
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU, hh = heightAt(x + Math.cos(a) * 0.55, z + Math.sin(a) * 0.55);
      if (hh < mn) mn = hh; if (hh > mx) mx = hh;
    }
    if (mx - mn > 0.6) return false;
    const w = ctx.world;
    let cols = w?.colliders;
    if (typeof w?.collidersNear === 'function') { try { cols = w.collidersNear(x, z, 0.5, nearCols); } catch (e) { cols = w?.colliders; } }
    if (Array.isArray(cols)) for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c) continue;
      const rr = (c.r || 0) + 0.5, dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    const boxes = w?.boxColliders;
    if (Array.isArray(boxes)) for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]; if (!b?.min || !b?.max) continue;
      if (x > b.min.x - 0.5 && x < b.max.x + 0.5 && z > b.min.z - 0.5 && z < b.max.z + 0.5) return false;
    }
    return true;
  }

  function updateTrap(dt, mouse) {
    const show = api.current === 'trap' && api.traps > 0 && !ctx.player?.underground && alive && sw.phase !== 'down';
    trapGhost.visible = show;
    if (!show) { api.trapValid = false; if (trapA.t > 0) { trapA.t = 0; setProgress(null, 0); } return; }
    // find the ground point in front
    let hitT = -1;
    for (let t = 0.6; t <= CFG.trapRange; t += 0.12) {
      const x = camPos.x + fwd.x * t, y = camPos.y + fwd.y * t, z = camPos.z + fwd.z * t;
      if (y <= heightAt(x, z)) { hitT = t; break; }
    }
    const pp = playerPos(tB);
    let x, z;
    if (hitT > 0) { x = camPos.x + fwd.x * hitT; z = camPos.z + fwd.z * hitT; }
    else { x = pp.x + fwdH.x * 1.8; z = pp.z + fwdH.z * 1.8; }
    const y = heightAt(x, z);
    normalAt(x, z, trapA.normal);
    trapA.pos.set(x, y, z);
    let valid = typeof ctx.tunnels?.placeTrap === 'function' && Math.hypot(x - pp.x, z - pp.z) >= 0.9 && trapSiteOk(x, z, y);
    // a refused placement shows red at that spot until the aim moves on
    if (valid && trapA.failT > time && Math.hypot(x - trapA.failX, z - trapA.failZ) < 0.6) valid = false;
    trapA.valid = valid; api.trapValid = valid;
    trapGhost.position.set(x, y + 0.01, z);
    qA.setFromUnitVectors(_UP, trapA.normal);
    qB.setFromAxisAngle(_UP, Math.atan2(fwdH.x, fwdH.z));
    trapGhost.quaternion.copy(qA).multiply(qB);
    ghostMat.color.copy(valid ? GHOST_OK : GHOST_BAD);
    ghostMat.opacity = 0.22 + 0.12 * Math.sin(time * 5) + trapA.t * 0.3;
    if (sw.phase !== 'idle') return;
    if (mouse.left && valid) {
      trapA.t += dt / CFG.trapTime;
      setProgress('trap', Math.min(1, trapA.t));
      if (trapA.t >= 1) {
        trapA.t = 0; setProgress(null, 0);
        let ok = false;
        try { ok = !!ctx.tunnels.placeTrap(x, z); } catch (e) { console.error('[weapons] placeTrap', e); }
        if (ok) {
          api.traps = Math.max(0, api.traps - 1);
          emit('trapPlaced', { x, z });
          emit('noise', { pos: trapA.pos.clone(), loudness: 0.12 });
          tA.copy(trapA.pos); tA.y += 0.1;
          for (let i = 0; i < 6; i++) { const s = spec(alphaFx, tA.x + sgn() * 0.4, tA.y, tA.z + sgn() * 0.4, sgn() * 0.5, 0.6, sgn() * 0.5, 1, 0.1, 0.5, COL.mud, 0.4, 0); s.drag = 2.5; alphaFx.emit(); }
          if (api.traps <= 0) { trap.model.visible = false; autoSwitchAt = time + 0.3; autoSwitchTo = 'rifle'; }
        } else { trapA.failT = time + 1.5; trapA.failX = x; trapA.failZ = z; }
      }
    } else if (trapA.t > 0) { trapA.t = 0; setProgress(null, 0); }
  }

  // ---- viewmodel animation -----------------------------------------------------------------
  const P6 = new Float32Array(6);
  function blendPose(a, b, t, out) { for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; }
  function setPose(obj, p) { obj.position.set(p[0], p[1], p[2]); obj.rotation.set(p[3], p[4], p[5]); }

  function animate(dt, input) {
    const pl = ctx.player;
    const mouse = input.mouse || DUMMY_INPUT.mouse;
    const ads = easeInOut(adsT);
    const under = !!pl?.underground;
    // --- global sway & bob
    const swayMul = lerp(1, 0.18, ads);
    const mdx = Number.isFinite(mouse.dx) ? mouse.dx : 0, mdy = Number.isFinite(mouse.dy) ? mouse.dy : 0;
    spr.swayX.step(clamp(-mdx * 0.00042, -0.07, 0.07) * swayMul, dt);
    spr.swayY.step(clamp(mdy * 0.00042, -0.06, 0.06) * swayMul, dt);
    const vx = pl?.velocity?.x || 0, vz = pl?.velocity?.z || 0, vy = pl?.velocity?.y || 0;
    const speed = Math.hypot(vx, vz);
    const lateral = vx * right.x + vz * right.z;
    spr.swayRoll.step(clamp(-lateral * 0.012, -0.05, 0.05) * swayMul, dt);
    const grounded = pl?.grounded !== false;
    bobAmp += ((grounded ? clamp(speed / 3.2, 0, 1.8) : 0) - bobAmp) * damp(8, dt);
    bobPhase += dt * (speed > 0.1 ? 2.1 + speed * 1.65 : 0);
    const stance = pl?.stance;
    const stanceMul = stance === 'prone' ? 0.5 : stance === 'crouch' ? 0.8 : 1;
    const bA = bobAmp * stanceMul * lerp(1, 0.12, ads) * (pl?.sprinting ? 1.35 : 1);
    const bobX = Math.sin(bobPhase) * 0.0085 * bA;
    const bobY = -Math.abs(Math.cos(bobPhase)) * 0.0095 * bA + 0.004 * bA;
    const breathe = Math.sin(time * 1.55) * lerp(0.0016, 0.00035, ads);
    spr.fall.step(clamp(-(vy - prevVy) * 0.004 + (grounded ? 0 : -vy * 0.0025), -0.05, 0.05), dt);
    prevVy = vy;
    spr.jolt.step(0, dt);
    const swE = easeInOut(sw.t);
    sway.position.set(
      spr.swayX.x * 0.25 + bobX,
      -spr.swayY.x * 0.2 + bobY + breathe + spr.fall.x - swE * 0.24,
      spr.jolt.x * 0.02,
    );
    sway.rotation.set(
      spr.swayY.x + Math.sin(bobPhase * 2) * 0.006 * bA - swE * 0.55 + spr.jolt.x * 0.04,
      spr.swayX.x + Math.cos(bobPhase) * 0.004 * bA,
      spr.swayRoll.x + Math.sin(bobPhase) * 0.008 * bA + swE * 0.12,
    );

    // --- per-rig
    const cur = api.current;
    if (cur === 'rifle') animRifle(dt, ads);
    else if (cur === 'shovel') animShovel(dt, under);
    else if (cur === 'satchel') animSatchel(dt);
    else if (cur === 'grenade') animGrenade(dt);
    else if (cur === 'trap') animTrap(dt);

    // --- lamp
    lamp.root.visible = under && cur !== 'rifle';
    api.lampOn = under;
    if (under) {
      setPose(lamp.root, POSE.lamp.hip);
      lamp.root.position.y += bobY * 0.6 + breathe;
      spr.lampX.step(-spr.swayX.v * 0.05 - lateral * 0.02, dt);
      spr.lampZ.step(spr.swayY.v * 0.04 + speed * 0.02 * Math.sin(bobPhase), dt);
      lamp.swing.rotation.set(clamp(spr.lampZ.x, -0.5, 0.5), 0, clamp(spr.lampX.x, -0.5, 0.5));
      const fl = 0.82 + 0.1 * Math.sin(time * 17.3) + 0.06 * Math.sin(time * 41.7 + 1.3) + 0.04 * noise2D(time * 3.1, 0.5);
      lamp.flicker = fl;
      lamp.flame.scale.set(0.9 + 0.12 * Math.sin(time * 23), fl * 1.05, 1);
      lamp.flame.rotation.z = Math.sin(time * 9.3) * 0.08 - lamp.swing.rotation.z;
    } else {
      lamp.flicker = 0;
    }
  }

  // ---- oil lamp lighting (runs after the viewmodel matrices are current) ---------------------
  const camInv = new THREE.Matrix4();
  const lampDirW = new THREE.Vector3();
  const lampHits = [];
  // Free distance from `o` along unit `d` inside dug tunnel space, up to maxD.
  function tunnelClearance(o, d, maxD) {
    const tun = ctx.tunnels;
    if (typeof tun?.isFree === 'function') {
      const floorFn = typeof tun.floorAt === 'function' ? tun.floorAt : null;
      try {
        if (!tun.isFree(o.x, o.z)) return maxD; // eye not inside known free space: don't clamp
        const step = 0.025;
        for (let t = step; t <= maxD; t += step) {
          const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
          if (!tun.isFree(x, z)) return t - step * 0.5;
          if (floorFn) { const f = floorFn(x, z); if (f !== null && Number.isFinite(f) && y < f + 0.03) return t - step * 0.5; }
        }
        return maxD;
      } catch (e) { /* fall through to the mesh probe */ }
    }
    const grp = tun?.group;
    if (!grp) return maxD;
    // Mesh probe is comparatively expensive (no BVH): refresh every 3rd frame.
    if (frame - lamp.probeFrame < 3) return lamp.clear;
    lamp.probeFrame = frame;
    raycaster.set(o, d); raycaster.near = 0; raycaster.far = maxD;
    lampHits.length = 0;
    try { raycaster.intersectObject(grp, true, lampHits); } catch (e) { lampHits.length = 0; }
    let best = maxD;
    for (let i = 0; i < lampHits.length; i++) {
      const h = lampHits[i];
      if (h.object?.visible === false || h.object?.material?.transparent) continue;
      best = Math.min(best, h.distance); break;
    }
    lamp.clear = best;
    return best;
  }

  function updateLampLight(dt, under) {
    if (!under || lamp.flicker <= 0) {
      lamp.light.intensity = 0;
      vmLamp.uVmLampCol.value.setRGB(0, 0, 0);
      vmLamp.uVmDirect.value = 1;
      return;
    }
    const fl = lamp.flicker;
    // flame position in view space (viewModel sits at the camera origin)
    camInv.copy(camera.matrixWorld).invert();
    lamp.flamePos.setFromMatrixPosition(lamp.flame.matrixWorld).applyMatrix4(camInv);
    vmLamp.uVmLampPos.value.copy(lamp.flamePos);
    const fd = lamp.flamePos.length() || 0.36;
    // keep the physical light on the near side of whatever face is in front of the lamp
    lampDirW.copy(lamp.flamePos).divideScalar(fd).transformDirection(camera.matrixWorld);
    const clear = tunnelClearance(camPos, lampDirW, fd + 0.45);
    const target = clamp(Math.min(clear * 0.7, clear - 0.08), 0.04, fd);
    lamp.dist = target < lamp.dist ? target : lamp.dist + (target - lamp.dist) * damp(14, dt);
    lamp.light.position.copy(lamp.flamePos).multiplyScalar(lamp.dist / fd);
    // A lamp held right up against a face floods it; scale the light so the lit face reads about
    // as bright as one ~0.45 m away (the body and hand shade most of the flame at that range).
    const faceD = Math.max(0.05, clear - lamp.dist);
    const kT = clamp(Math.pow(faceD / 0.45, 1.2), 0.12, 1);
    lamp.kI += (kT - lamp.kI) * damp(kT < lamp.kI ? 20 : 8, dt);
    lamp.light.intensity = 1.8 * fl * lamp.kI;
    // Viewmodel: its own soft lamp term (wrap diffuse + bounce from the clay + a little spec);
    // scene direct light is nearly removed so the flame centimetres away never saturates it.
    vmLamp.uVmLampCol.value.setRGB(1.0, 0.6, 0.3).multiplyScalar(1.3 * fl);
    vmLamp.uVmLampBounce.value = 0.2 + 0.3 * (1 - lamp.kI);
    vmLamp.uVmDirect.value = 0.08;
  }

  function animRifle(dt, ads) {
    const R = POSE.rifle;
    blendPose(R.hip, R.ads, ads, P6);
    if (sprintE > 0.001) blendPose(P6, R.sprint, easeInOut(sprintE), P6);
    // recoil
    spr.recZ.step(0, dt); spr.recRot.step(0, dt); spr.recRoll.step(0, dt); spr.recY.step(0, dt);
    P6[2] += spr.recZ.x * 0.035; P6[3] += spr.recRot.x * 0.04; P6[5] += spr.recRoll.x * 0.03; P6[1] += spr.recY.x * 0.03;
    // reload choreography
    const r = rs.reload;
    const mag = rifle.mag, la = rifle.lArm;
    mag.position.copy(RIFLE_MAG_PIVOT); mag.rotation.set(0, 0, 0);
    la.position.copy(rifle.lBasePos); la.quaternion.copy(rifle.lBaseQuat);
    let boltBack = 0;
    if (r) {
      const t = r.t;
      const insertT = r.empty ? 0.56 : 0.66;
      const env = seg(t, 0, 0.14) * (1 - seg(t, 0.86, 1));
      P6[0] -= 0.07 * env; P6[1] += 0.085 * env; P6[2] -= 0.13 * env;
      P6[3] += 0.36 * env; P6[4] += 0.1 * env; P6[5] += 1.1 * env;
      if (r.empty) { const rk = bump(t, 0.64, 0.9); P6[5] -= 0.95 * rk; P6[4] -= 0.2 * rk; P6[0] += 0.02 * rk; P6[1] -= 0.01 * rk; }
      const jig = bump(t, 0.2, 0.3) + bump(insertT - 0.06, insertT + 0.02, t + 0.0001) * 0;
      P6[1] -= 0.006 * jig;
      if (t > insertT - 0.02 && t < insertT + 0.06) { const k = bump(t, insertT - 0.02, insertT + 0.06); P6[1] += 0.012 * k; P6[3] += 0.03 * k; }
      // magazine motion
      if (t < 0.3) {
        const rock = seg(t, 0.12, 0.24), pull = seg(t, 0.2, 0.3);
        mag.rotation.x = 0.42 * rock;
        mag.position.y -= 0.05 * pull; mag.position.z -= 0.01 * pull;
      } else if (t >= 0.42 && t < insertT + 0.02) {
        const rise = seg(t, 0.42, insertT - 0.07), seat = seg(t, insertT - 0.08, insertT);
        mag.rotation.x = 0.42 * (1 - seat) + 0.2 * (1 - rise);
        mag.position.y -= 0.26 * (1 - rise) + 0.012 * (1 - seat);
        mag.position.z += 0.06 * (1 - rise) - 0.008 * (1 - seat);
        mag.position.x -= 0.04 * (1 - rise);
      }
      // left hand path: handguard → magazine → pouch → magazine → (charging handle) → handguard
      const magGrip = tA.set(-0.032, -0.15, 0.066);
      const pouch = tB.set(-0.08, -0.34, 0.12);
      const charge = tC.set(0.03, -0.062, 0.045);
      const back = r.empty ? 0.9 : 0.86;
      if (t < 0.14) { const k = seg(t, 0.0, 0.14); la.position.lerpVectors(rifle.lBasePos, magGrip, k); la.quaternion.slerpQuaternions(rifle.lBaseQuat, rifle.lMagQuat, k); }
      else if (t < 0.3) { la.position.copy(magGrip); la.position.y -= 0.05 * seg(t, 0.2, 0.3); la.quaternion.copy(rifle.lMagQuat); }
      else if (t < 0.42) { const k = seg(t, 0.3, 0.42); la.position.lerpVectors(magGrip, pouch, k); la.quaternion.copy(rifle.lMagQuat); }
      else if (t < insertT) {
        const rise = seg(t, 0.42, insertT - 0.07);
        la.position.lerpVectors(pouch, magGrip, rise); la.position.y -= 0.012 * (1 - seg(t, insertT - 0.08, insertT));
        la.quaternion.copy(rifle.lMagQuat);
      } else if (r.empty && t < 0.86) {
        if (t < 0.7) { const k = seg(t, insertT, 0.7); la.position.lerpVectors(magGrip, charge, k); la.quaternion.slerpQuaternions(rifle.lMagQuat, rifle.lRackQuat, k); }
        else { la.position.copy(charge); la.quaternion.copy(rifle.lRackQuat); }
        boltBack = seg(t, 0.72, 0.78) * (1 - seg(t, 0.8, 0.83));
        la.position.z += 0.075 * boltBack;
      } else {
        const from = r.empty ? charge : magGrip;
        const k = seg(t, r.empty ? 0.86 : insertT + 0.04, back + 0.08);
        la.position.lerpVectors(from, rifle.lBasePos, k);
        qA.copy(r.empty ? rifle.lRackQuat : rifle.lMagQuat);
        la.quaternion.slerpQuaternions(qA, rifle.lBaseQuat, k);
      }
    }
    // bolt carrier cycling
    rs.boltKick = Math.max(0, rs.boltKick - dt / 0.06);
    const cyc = rs.boltKick > 0 ? Math.sin((1 - rs.boltKick) * Math.PI) : 0;
    rifle.bolt.position.z = Math.max(cyc, boltBack) * 0.078;
    // muzzle flash
    rs.flashT = Math.max(0, rs.flashT - dt);
    const fl = rifle.flash;
    if (rs.flashT > 0) {
      fl.visible = true;
      if (rs.flashT > 0.04) {
        fl.rotation.z = rnd() * TAU;
        const s = 0.75 + rnd() * 0.55;
        fl.scale.set(s, s, 0.8 + rnd() * 0.6);
        fl.userData.star.scale.setScalar(lerp(1, 0.55, ads) * (0.8 + rnd() * 0.5));
      }
    } else fl.visible = false;
    setPose(rifle.root, P6);
  }

  function animShovel(dt, under) {
    const S = POSE.shovel;
    const base = under ? S.under : S.hip;
    if (sprintE > 0.001 && !under) blendPose(base, S.sprint, easeInOut(sprintE), P6); else P6.set(base);
    shovel.lArm.visible = !under;
    shovel.rArm.visible = !under;
    shovel.rUnderArm.visible = under;
    if (dig.active) {
      const u = dig.phase % 1;
      const thrust = bump(u, 0.0, 0.42), lever = bump(u, 0.38, 1.0);
      const lookUp = clamp(fwd.y, -1, 1);
      if (!under && dig.kind === 'hatch') {
        // stab downward
        P6[1] -= 0.09 * thrust - 0.04 * lever; P6[2] -= 0.05 * thrust; P6[3] -= 0.45 * thrust - 0.25 * lever;
      } else if (dig.kind === 'hatch' || lookUp > 0.5) {
        P6[1] += 0.1 * thrust; P6[3] += 0.55 * thrust; P6[2] -= 0.05 * thrust;
      } else {
        P6[2] -= 0.13 * thrust; P6[3] -= 0.18 * thrust + 0.22 * lever; P6[1] += 0.03 * lever; P6[5] -= 0.08 * lever;
      }
      P6[0] += Math.sin(time * 37) * 0.002 * thrust;
    }
    if (melee.active) {
      const t = melee.t;
      const wind = seg(t, 0, 0.3) * (1 - seg(t, 0.32, 0.5));
      const strike = seg(t, 0.3, 0.48) * (1 - seg(t, 0.62, 1));
      P6[0] += 0.09 * wind - 0.2 * strike; P6[1] += 0.07 * wind - 0.04 * strike; P6[2] += 0.04 * wind - 0.08 * strike;
      P6[3] += 0.35 * wind - 0.1 * strike; P6[4] += 0.55 * wind - 0.85 * strike; P6[5] += 0.4 * wind - 0.7 * strike;
    }
    setPose(shovel.root, P6);
  }

  function animSatchel(dt) {
    const S = POSE.satchel;
    if (sprintE > 0.001) blendPose(S.hip, S.sprint, easeInOut(sprintE), P6); else P6.set(S.hip);
    const p = easeInOut(plant.t);
    P6[1] -= 0.16 * p; P6[2] -= 0.12 * p; P6[3] -= 0.55 * p; P6[0] -= 0.02 * p;
    P6[1] += Math.sin(time * 30) * 0.0015 * p;
    if (!satchel.model.visible) { P6[1] -= 0.12; P6[3] -= 0.4; }
    setPose(satchel.root, P6);
  }

  function animGrenade(dt) {
    const S = POSE.grenade;
    if (sprintE > 0.001) blendPose(S.hip, S.sprint, easeInOut(sprintE), P6); else P6.set(S.hip);
    grenade.lArm.visible = false;
    if (throwA.active) {
      const t = throwA.t;
      if (!throwA.lob) {
        const pull = bump(t, 0.0, 0.3);
        grenade.lArm.visible = t < 0.3;
        grenade.lArm.position.set(0, -0.095 - 0.08 * seg(t, 0.12, 0.28), 0);
        const wind = seg(t, 0.12, 0.38) * (1 - seg(t, 0.38, 0.5));
        const fol = seg(t, 0.38, 0.52) * (1 - seg(t, 0.6, 1));
        P6[0] += 0.06 * wind - 0.1 * fol; P6[1] += 0.09 * wind - 0.16 * fol + 0.02 * pull; P6[2] += 0.16 * wind - 0.18 * fol;
        P6[3] += 0.9 * wind - 0.9 * fol; P6[5] -= 0.25 * wind + 0.3 * fol;
      } else {
        grenade.lArm.visible = t < 0.28;
        grenade.lArm.position.set(0, -0.095 - 0.08 * seg(t, 0.1, 0.26), 0);
        const wind = seg(t, 0.1, 0.34) * (1 - seg(t, 0.36, 0.5));
        const fol = seg(t, 0.36, 0.5) * (1 - seg(t, 0.62, 1));
        P6[1] -= 0.12 * wind - 0.05 * fol; P6[2] += 0.08 * wind - 0.16 * fol; P6[3] -= 0.7 * wind - 0.5 * fol;
      }
      if (throwA.released) { const k = 1 - seg(throwA.t, 0.62, 0.95); P6[1] -= 0.3 * k; }
    }
    setPose(grenade.root, P6);
  }

  function animTrap(dt) {
    const S = POSE.trap;
    if (sprintE > 0.001) blendPose(S.hip, S.sprint, easeInOut(sprintE), P6); else P6.set(S.hip);
    const p = easeInOut(trapA.t);
    P6[1] -= 0.18 * p; P6[2] -= 0.1 * p; P6[3] -= 0.7 * p;
    if (!trap.model.visible) { P6[1] -= 0.15; }
    setPose(trap.root, P6);
  }

  // ---- input + main update ------------------------------------------------------------------
  function handleSelection(input, mouse) {
    const under = !!ctx.player?.underground;
    const pr = input.pressed;
    if (pr && pr.size) {
      for (let i = 0; i < ITEMS.length; i++) if (pr.has('Digit' + (i + 1)) || pr.has('Numpad' + (i + 1))) select(ITEMS[i]);
      if (pr.has('KeyG')) quickGrenade();
      if (pr.has('KeyR')) startReload();
    }
    const wh = Number.isFinite(mouse.wheel) ? mouse.wheel : 0;
    if (wh !== 0 && !throwA.active) {
      const dir = wh > 0 ? 1 : -1;
      const from = sw.phase === 'down' && sw.target ? sw.target : api.current;
      let idx = ITEMS.indexOf(from);
      for (let k = 0; k < ITEMS.length; k++) {
        idx = (idx + dir + ITEMS.length) % ITEMS.length;
        if (available(ITEMS[idx]) && (!under || ITEMS[idx] === 'rifle' || ITEMS[idx] === 'shovel')) { if (ITEMS[idx] !== from) requestSwitch(ITEMS[idx]); break; }
      }
    }
  }
  function quickGrenade() {
    if (api.grenades <= 0 || ctx.player?.underground || throwA.active) return;
    if (api.current === 'grenade') { if (sw.phase === 'idle') startThrow(false); return; }
    const back = sw.phase === 'down' && sw.target ? sw.target : api.current;
    if (requestSwitch('grenade', { fast: true })) quick = { returnTo: back };
  }

  function onUndergroundChange(under) {
    cancelActions();
    quick = null;
    adsT = 0;
    if (under) {
      surfaceWeapon = (sw.phase === 'down' && sw.target) ? sw.target : api.current;
      setCurrent('shovel');
    } else {
      setCurrent(available(surfaceWeapon) ? surfaceWeapon : 'rifle');
    }
    sw.phase = 'up'; sw.t = 1; sw.target = null;
  }

  const shellPos = new THREE.Vector3();
  const nearCols = [];
  function onShellLand(x, y, z) { if (rnd() < 0.6) sfx('shell', shellPos.set(x, y, z)); }

  function update(dtIn) {
    const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0.016, 0, 0.05);
    time += dt; frame++;
    if (!camera) return;
    const input = ctx.input || DUMMY_INPUT;
    const mouse = input.mouse || DUMMY_INPUT.mouse;
    const pl = ctx.player;

    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    camPos.set(e[12], e[13], e[14]);
    right.set(e[0], e[1], e[2]).normalize();
    up.set(e[4], e[5], e[6]).normalize();
    fwd.set(-e[8], -e[9], -e[10]).normalize();
    fwdH.set(fwd.x, 0, fwd.z); if (fwdH.lengthSq() < 1e-6) fwdH.set(-e[4], 0, -e[6]); fwdH.normalize();

    // ambient tint for lit particles
    const under = !!pl?.underground;
    const sunI = ctx.world?.sun?.intensity, hemiI = ctx.world?.hemi?.intensity;
    let amb = 0.55;
    if (Number.isFinite(sunI) || Number.isFinite(hemiI)) amb = clamp(0.18 + (sunI || 0) * 0.14 + (hemiI || 0) * 0.3, 0.12, 1.0);
    if (under) amb = Math.min(amb, 0.2);
    ambient.setRGB(amb * 1.0, amb * 0.98, amb * 0.9);
    for (const m of VM.list) m.envMapIntensity = m.userData.baseEnv * (under ? 0.06 : 1);

    if (under !== wasUnderground) { wasUnderground = under; onUndergroundChange(under); }

    const nowAlive = pl ? pl.alive !== false : true;
    if (!nowAlive && alive) { cancelActions(); quick = null; }
    alive = nowAlive;
    sway.visible = alive;

    if (alive) {
      handleSelection(input, mouse);
      updateSwitch(dt);
      if (autoSwitchAt > 0 && time >= autoSwitchAt) { autoSwitchAt = -1; if (api.current !== 'rifle' || autoSwitchTo !== 'rifle') requestSwitch(autoSwitchTo || 'rifle'); }

      // sprint / ADS blends
      const speed = pl?.velocity ? Math.hypot(pl.velocity.x, pl.velocity.z) : 0;
      const sprinting = pl ? (typeof pl.sprinting === 'boolean' ? pl.sprinting && speed > 2.5 : speed > 4.4) : false;
      const busy = !!rs.reload || dig.active || melee.active || throwA.active || plant.t > 0 || trapA.t > 0;
      const wantSprint = sprinting && !mouse.left && !busy && !under;
      sprintE += ((wantSprint ? 1 : 0) - sprintE) * damp(wantSprint ? 7 : 12, dt);
      const wantAds = !!mouse.right && api.current === 'rifle' && sw.phase === 'idle' && !rs.reload && sprintE < 0.5;
      adsT = clamp(adsT + (wantAds ? 1 : -1) * dt / CFG.adsTime, 0, 1);
      api.aiming = wantAds;
      api.ads = easeInOut(adsT); api.aim = api.ads;

      // weapon logic
      rs.cooldown = Math.max(rs.cooldown - dt, -0.034);
      rs.bloom = Math.max(0, rs.bloom - dt * (mouse.left ? 0.02 : 0.11));
      if (!mouse.left) { rs.burst = 0; if (rs.cooldown < 0) rs.cooldown = 0; }
      if (api.current === 'rifle') {
        updateReload(dt);
        const canFire = sw.phase === 'idle' && !rs.reload && sprintE < 0.35;
        if (mouse.left && canFire) {
          let n = 0;
          while (rs.cooldown <= 0 && api.ammo.mag > 0 && n < 2) { queueShot(); rs.cooldown += CFG.fireInterval; n++; }
          if (api.ammo.mag === 0 && input.pressed?.has?.('Mouse0') && n === 0) {
            emit('dryFire', {});
            if (api.ammo.reserve > 0) startReload();
          }
        }
        if (api.ammo.mag === 0 && api.ammo.reserve > 0 && !rs.reload && !mouse.left && time - rs.lastShot > 0.25 && time - rs.lastShot < 0.4 && sw.phase === 'idle') startReload();
      } else if (api.current === 'shovel') updateShovel(dt, input, mouse);
      else if (api.current === 'satchel') updateSatchel(dt, mouse);
      else if (api.current === 'grenade') updateGrenade(dt, input);
      if (api.current !== 'satchel') api.canPlant = false;
      updateThrow(dt);
      applyAimRecoil(dt);
    } else {
      adsT = clamp(adsT - dt / CFG.adsTime, 0, 1);
      api.aiming = false; api.ads = easeInOut(adsT); api.aim = api.ads;
    }
    updateTrap(dt, mouse);
    api.firing = time - rs.lastShot < 0.12;
    api.spread = currentSpread();

    animate(dt, input);
    viewModel.updateMatrixWorld(true);
    updateLampLight(dt, under);
    executeShots();

    updatePlanted(dt);
    updateThrown(dt);
    updateMags(dt);
    updateEmitters(dt);
    updateLight(dt);
    const hf = typeof ctx.world?.heightAt === 'function' ? heightFn : null;
    const boxes = Array.isArray(ctx.world?.boxColliders) ? ctx.world.boxColliders : null;
    alphaFx.update(dt, hf, boxes);
    addFx.update(dt, hf, null);
    tracers.update(dt);
    shells.update(dt, hf, onShellLand);

    // FOV
    if (Math.abs(camera.fov - lastFovSet) > 0.01) baseFov = camera.fov; // someone else changed it
    const fov = lerp(baseFov, CFG.adsFov, api.ads);
    if (Math.abs(fov - camera.fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    lastFovSet = camera.fov;
  }

  // ---- misc API ------------------------------------------------------------------------------
  function give(item, n = 1) {
    if (item === 'grenade' || item === 'grenades') api.grenades += n;
    else if (item === 'satchel' || item === 'satchels') api.satchels += n;
    else if (item === 'trap' || item === 'traps') api.traps += n;
    else if (item === 'ammo' || item === 'rifle') api.ammo.reserve += n;
  }
  function addAmmo(n = CFG.magSize) { api.ammo.reserve += n; }
  function reset() {
    cancelActions();
    api.ammo.mag = CFG.magSize; api.ammo.reserve = CFG.startReserve;
    api.grenades = CFG.startGrenades; api.satchels = CFG.startSatchels; api.traps = CFG.startTraps;
    api.dumpDestroyed = false; planted.active = false; plantedMesh.visible = false;
    for (const g of thrown) { g.active = false; g.mesh.visible = false; }
    for (const m of droppedMags) { m.active = false; m.mesh.visible = false; }
    emitters.length = 0; fireGlow.until = -1; wreck.visible = false;
    alphaFx.clear(); addFx.clear();
    setCurrent('rifle'); sw.phase = 'up'; sw.t = 1;
  }

  function onEnemyKilled(e) {
    if (frame === bulletKillFrame) return;
    if (time - explosionKillWindow < 0.3) emit('hitMarker', { kill: true, headshot: false, explosive: true });
  }
  function onSplash(e) {
    if (!e?.pos) return;
    const s = clamp(e.strength ?? 0.5, 0, 1);
    const n = 2 + (s * 6 | 0);
    const sy = surfY(e.pos.x, e.pos.z);
    const y0 = (Number.isFinite(sy) && Math.abs(sy - e.pos.y) < 2.5 ? sy : e.pos.y) + 0.02;
    for (let i = 0; i < n; i++) { const sp = spec(alphaFx, e.pos.x + sgn() * 0.25, y0, e.pos.z + sgn() * 0.25,
      sgn() * 0.8, 1 + rnd() * 2 * s, sgn() * 0.8, 0.5 + rnd() * 0.3, 0.05, 0.14, COL.water, 0.7, 7); sp.grav = 9.8; sp.emit = 0.3; alphaFx.emit(); }
  }
  ev.on('explosion', onExplosion);
  ev.on('enemyKilled', onEnemyKilled);
  ev.on('splash', onSplash);

  function dispose() {
    ev.off('explosion', onExplosion);
    ev.off('enemyKilled', onEnemyKilled);
    ev.off('splash', onSplash);
    camera?.remove(viewModel);
    scene?.remove(fxRoot);
  }

  setCurrent('rifle');
  return api;
}
