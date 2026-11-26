// UNDERGROWTH — audio.js
// Fully procedural WebAudio. No samples: every sound is synthesised either offline into
// AudioBuffers (generated lazily / pre-warmed in small per-frame slices after unlock) or
// live with oscillators (birdsong, alarm siren, tinnitus).
//
// Routing
//   strips (pooled voices: src -> env -> lowpass -> gain -> panner) ──> open bus ──┐
//        └─ send ──> verbSend ──> outdoor convolver / tunnel convolver ───────────┤
//   cross-space voices (surface <-> tunnel) ──> muffled bus (double lowpass) ─────┤
//   ambience loops ──> ambience bus (lowpass when underground) ───────────────────┤
//                                                                                  v
//   master ──> duck ──> shock lowpass (concussion) ──> limiter ──> destination
//
// Listens to util.js events; nothing is queued while the AudioContext is locked.

import { WORLD, events as globalEvents, rand, clamp, lerp, noise2D } from './util.js';

const TAU = Math.PI * 2;
const SR_HI = 44100;
const SR_MID = 32000;
const SR_LO = 22050;
const SPEED_OF_SOUND = 343;

// ============================================================================
// Offline DSP helpers (operate on Float32Arrays at generation time only)
// ============================================================================

class Biquad {
  constructor(type = 'lp', f = 1000, q = 0.707, sr = SR_HI) {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    this.set(type, f, q, sr);
  }
  set(type, f, q, sr) {
    f = Math.min(Math.max(f, 5), sr * 0.45);
    q = Math.max(q, 0.05);
    const w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) * 0.5; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) * 0.5; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
const bq = (type, f, q, sr) => new Biquad(type, f, q, sr);

function runChain(x, fs) {
  for (let i = 0; i < fs.length; i++) x = fs[i].run(x);
  return x;
}
function envAD(t, a, d) { return t < a ? t / a : Math.exp(-(t - a) / d); }

// Filtered noise burst with attack/decay envelope (dur defaults to a + 7 decay constants).
function addNoise(out, sr, r, t0, dur, amp, a, d, fs) {
  if (!(dur > 0)) dur = a + d * 7;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  if (n <= 0) return;
  const tail = Math.max(1, Math.floor(Math.min(0.005 * sr, n * 0.1)));
  for (let i = 0; i < n; i++) {
    let x = r() * 2 - 1;
    if (fs) x = runChain(x, fs);
    let e = envAD(i / sr, a, d);
    if (i > n - tail) e *= (n - i) / tail;
    out[i0 + i] += x * amp * e;
  }
}

// Filtered noise with a sustained (sin^shape) envelope across the whole window.
function addNoiseSus(out, sr, r, t0, dur, amp, fs, shape = 0.6) {
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  for (let i = 0; i < n; i++) {
    let x = r() * 2 - 1;
    if (fs) x = runChain(x, fs);
    out[i0 + i] += x * amp * Math.pow(Math.sin(Math.PI * i / n), shape);
  }
}

// Band-pass noise whose centre sweeps exponentially from f0 to f1.
function addSweep(out, sr, r, t0, dur, f0, f1, q, amp, envFn) {
  const f = new Biquad('bp', f0, q, sr);
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) f.set('bp', f0 * Math.pow(f1 / f0, u), q, sr);
    const x = f.run(r() * 2 - 1);
    const e = envFn ? envFn(u) : Math.pow(Math.sin(Math.PI * u), 2);
    out[i0 + i] += x * amp * e;
  }
}

// Sine (plus optional harmonics) gliding f0 -> f1 (exponential glide if glide > 0, else linear).
function addTone(out, sr, t0, dur, f0, f1, amp, a, d, glide = 0, harm = null) {
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const n = Math.min(out.length - i0, Math.floor(dur * sr));
  if (n <= 0) return;
  const tail = Math.max(1, Math.floor(Math.min(0.006 * sr, n * 0.15)));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = glide > 0 ? f1 + (f0 - f1) * Math.exp(-t / glide) : f0 + (f1 - f0) * (t / dur);
    ph += TAU * f / sr;
    let s = Math.sin(ph);
    if (harm) for (let k = 0; k < harm.length; k++) s += harm[k] * Math.sin(ph * (k + 2));
    let e = envAD(t, a, d);
    if (i > n - tail) e *= (n - i) / tail;
    out[i0 + i] += s * amp * e;
  }
}

// Struck-metal: inharmonic decaying partials.
function addMetal(out, sr, t0, base, ratios, amp, decay) {
  for (let k = 0; k < ratios.length; k++) {
    const f = base * ratios[k];
    if (f >= sr * 0.45) continue;
    const dk = decay / (1 + 0.35 * k);
    addTone(out, sr, t0, dk * 7 + 0.002, f, f, amp / Math.sqrt(k + 1), 0.0003, dk);
  }
}

// Many tiny noise grains (crunch, crackle, debris). shape(u) biases density over [t0,t1].
function addGrains(out, sr, r, t0, t1, count, amp, dMin, dMax, fs, shape) {
  for (let g = 0; g < count; g++) {
    let u = r();
    if (shape) for (let k = 0; k < 6 && r() > shape(u); k++) u = r();
    const dd = dMin + r() * (dMax - dMin);
    addNoise(out, sr, r, t0 + u * (t1 - t0), dd, amp * (0.25 + 0.75 * r()), 0.0003, dd * 0.3, fs);
  }
}

// Low body thump: lowpassed noise + pitched sine drop.
function addThud(out, sr, r, t0, amp, lp = 220, decay = 0.04, f = 70) {
  addNoise(out, sr, r, t0, 0, amp, 0.002, decay, [bq('lp', lp, 0.8, sr), bq('lp', lp * 1.5, 0.7, sr)]);
  addTone(out, sr, t0, decay * 6, f * 1.4, f, amp * 0.5, 0.002, decay * 0.8, 0.015);
}

function filterBuf(out, fs) { for (let i = 0; i < out.length; i++) out[i] = runChain(out[i], fs); return out; }

function mixInto(out, src, sr, t0, amp) {
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(src.length, out.length - i0);
  for (let i = 0; i < n; i++) out[i0 + i] += src[i] * amp;
}

function normalize(out, peak) {
  let m = 0;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v !== v) { out[i] = 0; continue; } // NaN guard
    const a = v < 0 ? -v : v;
    if (a > m) m = a;
  }
  if (m > 1e-9) { const k = peak / m; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return out;
}

// Normalise, optional tanh saturation, then de-click the edges.
function finish(out, peak = 0.9, drive = 0) {
  normalize(out, 1);
  if (drive > 0) {
    const k = 1 / Math.tanh(drive);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive) * k;
  }
  normalize(out, peak);
  const a = Math.min(8, out.length), b = Math.min(Math.floor(out.length * 0.05), 160);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < b; i++) out[out.length - 1 - i] *= i / b;
  return out;
}

// Seamless loop: raw has N + xf samples; the tail crossfades into the head (equal power).
function makeLoop(raw, xf) {
  const N = raw.length - xf;
  const out = new Float32Array(N);
  out.set(raw.subarray(0, N));
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    out[i] = raw[i] * Math.sqrt(k) + raw[N + i] * Math.sqrt(1 - k);
  }
  return out;
}
function finishLoop(raw, xf, peak) { return normalize(makeLoop(raw, xf), peak); }

const sized = (sr, sec) => new Float32Array(Math.max(1, Math.floor(sr * sec)));

// ============================================================================
// Formant speech-ish synthesiser (enemy shouts, radio chatter, grunts)
// ============================================================================

const PH = {
  _: { v: 0 },
  a: { v: 1, F: [760, 1120, 2440, 3400] }, ae: { v: 1, F: [680, 1700, 2420, 3400] },
  e: { v: 1, F: [560, 1820, 2500, 3500] }, i: { v: 1, F: [310, 2200, 2980, 3600] },
  o: { v: 1, F: [580, 880, 2400, 3300] }, u: { v: 1, F: [340, 900, 2250, 3300] },
  uh: { v: 1, F: [650, 1200, 2400, 3400] }, er: { v: 1, F: [500, 1350, 1700, 3300] },
  m: { v: 0.35, F: [260, 1100, 2300, 3300] }, n: { v: 0.35, F: [260, 1600, 2600, 3400] },
  l: { v: 0.6, F: [380, 1050, 2700, 3400] }, r: { v: 0.6, F: [430, 1250, 1600, 3200] },
  w: { v: 0.6, F: [320, 700, 2200, 3300] },
  v: { v: 0.35, F: [320, 1350, 2300, 3300], fric: [3500, 0.6, 0.12] },
  z: { v: 0.35, F: [320, 1500, 2500, 3400], fric: [5000, 1, 0.16] },
  s: { v: 0, fric: [5500, 1.2, 0.4] }, sh: { v: 0, fric: [2700, 1.4, 0.4] },
  f: { v: 0, fric: [4200, 0.5, 0.2] }, h: { v: 0, asp: 0.7 },
  ch: { v: 0, stop: 1, burst: [3000, 1.2, 0.5], fricAfter: [2800, 1.3, 0.35] },
  k: { v: 0, stop: 1, burst: [2200, 1.5, 0.55], asp: 0.35 },
  t: { v: 0, stop: 1, burst: [4200, 1, 0.5], asp: 0.3 },
  p: { v: 0, stop: 1, burst: [900, 0.8, 0.4], asp: 0.3 },
  g: { v: 0.15, stop: 1, burst: [1800, 1.5, 0.35] },
  d: { v: 0.15, stop: 1, burst: [3600, 1, 0.3] },
  b: { v: 0.15, stop: 1, burst: [800, 0.8, 0.25] },
};

const PHRASES = {
  contact: 'k.05 a.11 n.05 t.05 ae.2! k.04 t.06',
  overthere: 'o.14! v.05 er.08 d.03 e.14 er.2',
  grenade: 'g.04 r.05 uh.06 n.05 e.16! i.1 d.05',
  move: 'm.06 u.2! v.06 _.06 m.06 u.22! v.08',
  medic: 'm.07 e.16! d.04 i.08 k.06',
  getdown: 'g.04 e.08 t.04 d.04 a.14! u.12 n.08',
  cover: 'k.05 uh.14! v.05 er.1 m.06 i.2',
  charlie: 'ch.08 a.2! r.06 l.05 i.22',
  mandown: 'm.06 ae.16! n.05 d.04 a.12 u.12 n.1',
  hey: 'h.08 e.16! i.14',
  whatwas: 'w.05 uh.1 t.04 w.04 uh.08 z.05 d.03 ae.14! t.05',
  fire: 'f.08 a.18! i.08 er.16',
  gogo: 'g.04 o.14! u.06 _.05 g.04 o.14! u.06',
  incoming: 'i.08 n.05 k.05 uh.14! m.05 i.08 n.07',
};
const COMBAT_PHRASES = ['move', 'cover', 'getdown', 'overthere', 'charlie', 'fire', 'gogo', 'incoming', 'contact'];

function parsePhrase(text, tempo) {
  const segs = [];
  let t = 0.03;
  const toks = text.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const m = /^([a-z_]+)(\.\d+)?(!)?$/.exec(toks[i]);
    if (!m) continue;
    const p = PH[m[1]];
    if (!p) continue;
    const dur = (m[2] ? parseFloat('0' + m[2]) : (p.stop ? 0.06 : p.v >= 1 ? 0.1 : 0.07)) * tempo;
    segs.push({ p, t0: t, t1: t + dur, stress: !!m[3], F: null });
    t += dur;
  }
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].p.F) { segs[i].F = segs[i].p.F; continue; }
    let F = null;
    for (let j = i + 1; j < segs.length && !F; j++) F = segs[j].p.F || null;
    for (let j = i - 1; j >= 0 && !F; j--) F = segs[j].p.F || null;
    segs[i].F = F || PH.uh.F;
  }
  return { segs, T: t };
}

function speak(sr, r, text, o) {
  const shout = !!o.shout;
  const { segs, T } = parsePhrase(text, o.tempo || 1);
  if (!segs.length) return sized(sr, 0.1);
  const N = Math.floor((T + 0.15) * sr);
  const out = new Float32Array(N);
  const BW = shout ? [120, 140, 200, 300] : [80, 100, 160, 260];
  const FA = shout ? [1, 0.8, 0.5, 0.32] : [1, 0.6, 0.3, 0.15];
  const fil = [0, 1, 2, 3].map(() => new Biquad('bp', 500, 4, sr));
  const cur = segs[0].F.slice();
  const stressT = segs.filter((s) => s.stress).map((s) => (s.t0 + s.t1) * 0.5);
  const kf = Math.min(1, 32 * (1 - Math.exp(-1 / (0.018 * sr))));
  const kv = 1 - Math.exp(-1 / (0.007 * sr));
  const f1Boost = shout ? 1.1 : 1;
  const Tp = 0.4, Tn = shout ? 0.12 : 0.18;
  let si = 0, ph = 0, prevG = 0, vAmp = 0, aAmp = 0, jit = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    while (si < segs.length - 1 && t >= segs[si].t1) si++;
    const s = segs[si], p = s.p;
    let vT = 0, aT = 0;
    if (t >= s.t0 && t < s.t1) {
      const u = (t - s.t0) / (s.t1 - s.t0);
      if (p.stop) { vT = u < 0.65 ? p.v : (p.v > 0 ? 0.5 : 0); aT = u >= 0.68 ? (p.asp || 0) : 0; }
      else { vT = p.v; aT = p.asp || 0; }
    }
    vAmp += (vT - vAmp) * kv;
    aAmp += (aT - aAmp) * kv;
    if ((i & 31) === 0) {
      const F = s.F;
      for (let k = 0; k < 4; k++) {
        cur[k] += (F[k] * (k === 0 ? f1Boost : 1) - cur[k]) * kf;
        fil[k].set('bp', cur[k], cur[k] / BW[k], sr);
      }
    }
    let bump = 0;
    for (let k = 0; k < stressT.length; k++) { const x = (t - stressT[k]) / 0.11; bump += Math.exp(-x * x); }
    jit = jit * 0.995 + (r() - 0.5) * 0.004;
    const f = o.f0 * (1 + (shout ? 0.32 : 0.15) * Math.min(1, bump)) * (1 - 0.2 * t / T) * (1 + jit);
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    const gl = ph < Tp ? 0.5 * (1 - Math.cos(Math.PI * ph / Tp))
      : ph < Tp + Tn ? Math.cos(0.5 * Math.PI * (ph - Tp) / Tn) : 0;
    const dg = (gl - prevG) * sr / f;
    prevG = gl;
    const nz = r() * 2 - 1;
    const src = dg * 0.12 * vAmp + nz * (aAmp * 0.5 + vAmp * 0.03);
    let y = 0;
    for (let k = 0; k < 4; k++) y += fil[k].run(src) * FA[k];
    out[i] = y;
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], p = s.p, d = s.t1 - s.t0;
    if (p.burst) addNoise(out, sr, r, s.t0 + d * 0.65, 0.05, p.burst[2], 0.0005, 0.009, [bq('bp', p.burst[0], p.burst[1], sr)]);
    if (p.fric) addNoiseSus(out, sr, r, s.t0, d, p.fric[2], [bq('bp', p.fric[0], p.fric[1], sr)]);
    if (p.fricAfter) addNoiseSus(out, sr, r, s.t0 + d * 0.68, d * 0.32 + 0.04, p.fricAfter[2], [bq('bp', p.fricAfter[0], p.fricAfter[1], sr)]);
  }
  filterBuf(out, [bq('hp', 110, 0.7, sr)]);
  return finish(out, 0.9, shout ? 2.4 : 1.2);
}

const SYL_ON = ['w', 't', 'l', 'g', 'm', 's', 'd', 'n', 'k', 'h', 'b', 'r', 'f', 'sh'];
const SYL_V = ['uh', 'a', 'e', 'i', 'o', 'ae', 'er', 'u'];
const SYL_CODA = ['n', 't', 's', 'k', 'm'];
function babble(r, n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += SYL_ON[Math.floor(r() * SYL_ON.length)] + ' ';
    s += SYL_V[Math.floor(r() * SYL_V.length)] + '.' + String(Math.floor(7 + r() * 8)).padStart(2, '0') + (r() < 0.25 ? '! ' : ' ');
    if (r() < 0.35) s += SYL_CODA[Math.floor(r() * SYL_CODA.length)] + ' ';
    if (r() < 0.15) s += '_.' + String(Math.floor(8 + r() * 12)).padStart(2, '0') + ' ';
  }
  return s;
}

// ============================================================================
// Sound generators
// ============================================================================

const GUN = {
  ak: { crackHP: 1800, crackDecay: 0.0016, crackAmp: 0.9, bodyLP: 1900, ring: 520, ringQ: 1.4, ringAmp: 0.55,
    bodyTau: 0.024, body2Tau: 0.09, thumpF0: 150, thumpF1: 46, thumpTau: 0.05, thumpAmp: 1.0, tailAmp: 0.14, slapAmp: 0.32 },
  m16: { crackHP: 2800, crackDecay: 0.0011, crackAmp: 1.0, bodyLP: 3400, ring: 1150, ringQ: 1.8, ringAmp: 0.5,
    bodyTau: 0.013, body2Tau: 0.055, thumpF0: 230, thumpF1: 80, thumpTau: 0.03, thumpAmp: 0.55, tailAmp: 0.09, slapAmp: 0.26 },
  m60: { crackHP: 1500, crackDecay: 0.0018, crackAmp: 0.85, bodyLP: 1600, ring: 420, ringQ: 1.2, ringAmp: 0.6,
    bodyTau: 0.03, body2Tau: 0.11, thumpF0: 130, thumpF1: 40, thumpTau: 0.06, thumpAmp: 1.1, tailAmp: 0.18, slapAmp: 0.35 },
};

function genShot(kind, mech) {
  return (sr, r) => {
    const P = GUN[kind];
    const out = sized(sr, 1.0);
    const j = () => 0.9 + 0.2 * r();
    // supersonic/muzzle crack
    addNoise(out, sr, r, 0, 0.012, P.crackAmp, 0.00008, P.crackDecay * j(), [bq('hp', P.crackHP, 0.7, sr)]);
    // muzzle blast: broadband body + resonant bark
    const lp = bq('lp', P.bodyLP * j(), 0.8, sr), rp = bq('bp', P.ring * j(), P.ringQ, sr);
    const bt = P.bodyTau * j(), bt2 = P.body2Tau * j();
    const nb = Math.floor(sr * 0.5);
    for (let i = 0; i < nb; i++) {
      const t = i / sr;
      const x = r() * 2 - 1;
      const e = (1 - Math.exp(-t / 0.0003)) * (0.78 * Math.exp(-t / bt) + 0.22 * Math.exp(-t / bt2));
      out[i] += (lp.run(x) * 0.9 + rp.run(x) * P.ringAmp * 2.2) * e;
    }
    // chest thump
    addTone(out, sr, 0, 0.4, P.thumpF0 * j(), P.thumpF1, P.thumpAmp, 0.0008, P.thumpTau * j(), 0.018);
    // tree-line / ground slap echoes
    const echoes = [[0.085 + 0.05 * r(), P.slapAmp], [0.17 + 0.08 * r(), P.slapAmp * 0.55], [0.3 + 0.1 * r(), P.slapAmp * 0.3]];
    const win = Math.floor(0.08 * sr);
    for (let k = 0; k < echoes.length; k++) {
      const D = Math.floor(echoes[k][0] * sr), f = bq('lp', 1600 - k * 400, 0.7, sr), f2 = bq('lp', 2200 - k * 400, 0.7, sr);
      for (let i = 0; i < win && D + i < out.length; i++) out[D + i] += f2.run(f.run(out[i])) * echoes[k][1];
    }
    addNoise(out, sr, r, 0.005, 0.9, P.tailAmp, 0.02, 0.22, [bq('lp', 700, 0.7, sr)]);
    if (mech) {
      // Type 56 bolt carrier slam and rattle, close to the ear
      const tm = 0.03 + 0.006 * r();
      addNoise(out, sr, r, tm, 0.02, 0.22, 0.0002, 0.0025, [bq('bp', 2300, 2.5, sr)]);
      addMetal(out, sr, tm, 2900 + r() * 200, [1, 1.53, 2.21], 0.05, 0.02);
      addNoise(out, sr, r, tm + 0.018, 0.02, 0.12, 0.0002, 0.002, [bq('bp', 1700, 2, sr)]);
    }
    return finish(out, 0.95, 1.4);
  };
}

function genShell(sr, r, v) {
  const mode = Math.floor(v / 3); // 0 hard, 1 jungle floor, 2 tunnel clay
  const out = sized(sr, 0.7);
  let t = 0, amp = 1;
  const base = 2900 + r() * 900;
  const nb = 3 + Math.floor(r() * 2);
  for (let b = 0; b < nb; b++) {
    const a = amp * (b === 0 ? 1 : (mode ? 0.5 : 0.8));
    let decay = mode === 2 ? 0.005 : mode === 1 ? 0.011 : 0.035;
    if (b === 0 && mode === 1) decay *= 2;
    addMetal(out, sr, t, base * (0.97 + 0.06 * r()), [1, 1.47, 2.09, 2.56, 3.37], a * 0.5, decay);
    addNoise(out, sr, r, t, 0.02, a * 0.25, 0.0002, 0.002, [bq('hp', 2000, 0.7, sr)]);
    if (mode) addNoise(out, sr, r, t, 0.05, a * 0.25, 0.001, 0.012, [bq('lp', 600, 0.7, sr)]);
    t += 0.07 + r() * 0.08 * amp;
    amp *= 0.45 + r() * 0.15;
  }
  return finish(out, 0.8);
}

function genStep(surf) {
  return (sr, r) => {
    const out = sized(sr, 0.5);
    switch (surf) {
      case 'mud': {
        addThud(out, sr, r, 0, 0.6, 260, 0.035, 60);
        const t0 = 0.03 + 0.03 * r();
        addSweep(out, sr, r, t0, 0.13 + 0.06 * r(), 240 + 80 * r(), 900 + 500 * r(), 3.5, 0.9);
        const nb = 2 + Math.floor(r() * 3);
        for (let i = 0; i < nb; i++) { const f = 380 + r() * 500; addTone(out, sr, t0 + 0.04 + r() * 0.14, 0.03, f, f * 1.7, 0.12 + 0.1 * r(), 0.002, 0.008); }
        addNoise(out, sr, r, t0, 0.2, 0.15, 0.03, 0.05, [bq('lp', 500, 0.7, sr)]);
        break;
      }
      case 'leaves': {
        addThud(out, sr, r, 0, 0.3, 240, 0.03, 70);
        addGrains(out, sr, r, 0, 0.18 + 0.06 * r(), 70 + Math.floor(r() * 50), 0.55, 0.0006, 0.004,
          [bq('hp', 2000, 0.7, sr), bq('lp', 9000, 0.7, sr)], (u) => Math.exp(-u * 2.5));
        addNoise(out, sr, r, 0.005, 0.2, 0.18, 0.006, 0.045, [bq('bp', 3200, 0.8, sr)]);
        break;
      }
      case 'grass': {
        addThud(out, sr, r, 0, 0.25, 260, 0.025, 75);
        addSweep(out, sr, r, 0, 0.18 + 0.05 * r(), 1500 + 300 * r(), 3800, 1.2, 0.5);
        addGrains(out, sr, r, 0, 0.12, 20, 0.15, 0.0005, 0.002, [bq('hp', 3000, 0.7, sr)]);
        break;
      }
      case 'dirt': {
        addThud(out, sr, r, 0, 0.5, 350, 0.03, 80);
        addGrains(out, sr, r, 0, 0.08, 25 + Math.floor(r() * 15), 0.35, 0.0004, 0.002, [bq('hp', 1500, 0.7, sr)], (u) => 1 - u);
        addNoise(out, sr, r, 0.01, 0.07, 0.2, 0.005, 0.015, [bq('bp', 2200, 1, sr)]);
        break;
      }
      case 'water': {
        addNoise(out, sr, r, 0, 0.35, 0.7, 0.008, 0.07, [bq('bp', 900, 0.7, sr)]);
        addNoise(out, sr, r, 0, 0.25, 0.3, 0.004, 0.05, [bq('hp', 3000, 0.7, sr)]);
        addTone(out, sr, 0, 0.2, 140, 90, 0.35, 0.004, 0.05, 0.03);
        const nb = 4 + Math.floor(r() * 5);
        for (let i = 0; i < nb; i++) {
          const t = 0.03 + r() * 0.27, f = 350 + r() * 850;
          addTone(out, sr, t, 0.02 + r() * 0.015, f, f * 1.8, 0.15 * (1 - t), 0.001, 0.008);
        }
        break;
      }
      default: { // tunnel: crawling knee/palm on packed clay
        addThud(out, sr, r, 0, 0.55, 160, 0.045, 55);
        addSweep(out, sr, r, 0.02, 0.22, 1300, 900, 0.8, 0.25);
        addGrains(out, sr, r, 0.02, 0.22, 12, 0.15, 0.0005, 0.003, [bq('hp', 800, 0.7, sr), bq('lp', 3000, 0.7, sr)]);
      }
    }
    return finish(out, 0.85);
  };
}

function genDig(sr, r) {
  const out = sized(sr, 0.7);
  addNoise(out, sr, r, 0, 0.1, 0.7, 0.002, 0.03, [bq('lp', 240, 0.8, sr)]);
  addSweep(out, sr, r, 0.005, 0.2, 3400 - r() * 400, 1700, 2.2, 0.6, (u) => Math.pow(1 - u, 1.5) * Math.min(1, u * 30));
  addMetal(out, sr, 0.004, 820 + r() * 120, [1, 2.76, 4.1], 0.08, 0.05);
  addGrains(out, sr, r, 0.01, 0.22, 60, 0.3, 0.0005, 0.003, [bq('hp', 1200, 0.7, sr)]);
  addGrains(out, sr, r, 0.22, 0.6, 50, 0.35, 0.002, 0.012, [bq('lp', 1400, 0.7, sr)], (u) => 1 - u);
  addNoise(out, sr, r, 0.2, 0.45, 0.25, 0.06, 0.12, [bq('lp', 500, 0.7, sr)]);
  return finish(out, 0.85);
}

function genDirtFall(sr, r) {
  const out = sized(sr, 1.4);
  addThud(out, sr, r, 0, 0.8, 150, 0.08, 50);
  addNoise(out, sr, r, 0, 1.3, 0.6, 0.05, 0.35, [bq('lp', 380, 0.7, sr)]);
  addGrains(out, sr, r, 0.02, 1.3, 140, 0.4, 0.002, 0.01, [bq('lp', 1800, 0.7, sr)], (u) => Math.exp(-2.5 * u));
  addGrains(out, sr, r, 0.05, 1.2, 40, 0.12, 0.0005, 0.002, [bq('hp', 2500, 0.7, sr)], (u) => 1 - u);
  return finish(out, 0.85);
}

function genExplosion(big) {
  return (sr, r) => {
    const len = big ? 6.5 : 4.5;
    const out = sized(sr, len);
    addNoise(out, sr, r, 0, 0.6, 1.0, 0.0005, big ? 0.09 : 0.055, [bq('lp', 6000, 0.7, sr)]);
    addNoise(out, sr, r, 0, 1.5, 0.8, 0.002, big ? 0.4 : 0.25, [bq('lp', 1100, 0.7, sr)]);
    addTone(out, sr, 0, len * 0.8, big ? 62 : 70, big ? 24 : 30, 1.1, 0.004, big ? 1.5 : 0.9, 0.35);
    { // rolling rumble
      const lpf = bq('lp', big ? 140 : 180, 0.7, sr), lpf2 = bq('lp', big ? 160 : 200, 0.7, sr);
      const n = out.length, dec = big ? 2.2 : 1.3;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const m = 0.75 + 0.25 * Math.sin(TAU * t * 1.3 + 2 * Math.sin(TAU * t * 0.37));
        out[i] += lpf2.run(lpf.run(r() * 2 - 1)) * 2.4 * envAD(t, 0.06, dec) * m;
      }
    }
    // debris: clods, stones and splinters raining back down
    const nDeb = big ? 160 : 70, span = big ? 4 : 2.6;
    for (let k = 0; k < nDeb; k++) {
      const t = 0.2 + Math.pow(r(), 1.6) * span;
      const amp = 0.25 * (1 - t / len) * (0.3 + 0.7 * r());
      addNoise(out, sr, r, t, 0.06, amp, 0.0005, 0.004 + r() * 0.012, [bq('lp', 500 + r() * 2500, 0.9, sr)]);
    }
    addGrains(out, sr, r, 0.15, big ? 3.5 : 2.2, big ? 260 : 120, 0.12, 0.0004, 0.002, [bq('hp', 3000, 0.7, sr)], (u) => (1 - u) * (1 - u));
    // valley echoes
    const ech = big ? [[0.5, 0.3], [1.2, 0.18], [2.0, 0.1]] : [[0.42, 0.3], [0.95, 0.16]];
    const win = Math.floor(0.25 * sr);
    for (let k = 0; k < ech.length; k++) {
      const D = Math.floor(ech[k][0] * sr), f = bq('lp', 600, 0.7, sr), f2 = bq('lp', 700, 0.7, sr);
      for (let i = 0; i < win && D + i < out.length; i++) out[D + i] += f2.run(f.run(out[i])) * ech[k][1];
    }
    return finish(out, 0.98, 2.2);
  };
}

function genBounce(sr, r) {
  const out = sized(sr, 0.35);
  addThud(out, sr, r, 0, 0.55, 500, 0.02, 110);
  addNoise(out, sr, r, 0, 0, 0.5, 0.0004, 0.012, [bq('bp', 700 + r() * 200, 6, sr)]);
  addMetal(out, sr, 0.001, 2000 + r() * 400, [1, 1.58, 2.37], 0.12, 0.018);
  addGrains(out, sr, r, 0.005, 0.1, 12, 0.15, 0.001, 0.004, [bq('lp', 2500, 0.7, sr)]);
  return finish(out, 0.85);
}

function genWhiz(sr, r) {
  const out = sized(sr, 0.3);
  const nN = Math.max(4, Math.floor(0.00035 * sr));
  for (let i = 0; i < nN; i++) out[i] += 1 - 2 * i / nN;
  addNoise(out, sr, r, 0, 0.01, 0.4, 0.0001, 0.0015, [bq('hp', 3000, 0.7, sr)]);
  addSweep(out, sr, r, 0.002, 0.16, 5200, 2000, 5, 0.35, (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.6));
  return finish(out, 0.9);
}

function genImpact(sr, r) {
  const out = sized(sr, 0.35);
  addNoise(out, sr, r, 0, 0, 0.7, 0.0002, 0.0025, [bq('hp', 1500, 0.7, sr)]);
  addThud(out, sr, r, 0, 0.6, 420, 0.02, 90);
  addGrains(out, sr, r, 0.01, 0.3, 30, 0.25, 0.001, 0.006, [bq('lp', 2600, 0.7, sr)], (u) => Math.exp(-3 * u));
  return finish(out, 0.85);
}
function genImpactWood(sr, r) {
  const out = sized(sr, 0.3);
  addNoise(out, sr, r, 0, 0, 0.8, 0.0003, 0.02, [bq('bp', 520 + r() * 80, 4, sr)]);
  addNoise(out, sr, r, 0, 0, 0.5, 0.0001, 0.002, [bq('hp', 2500, 0.7, sr)]);
  addTone(out, sr, 0, 0.15, 360, 340, 0.2, 0.001, 0.03);
  addGrains(out, sr, r, 0.005, 0.12, 10, 0.1, 0.0005, 0.002, [bq('hp', 3000, 0.7, sr)]);
  return finish(out, 0.85);
}
function genImpactLeaf(sr, r) {
  const out = sized(sr, 0.35);
  addGrains(out, sr, r, 0, 0.25, 80, 0.4, 0.0006, 0.003, [bq('hp', 2500, 0.7, sr)], (u) => Math.exp(-2 * u));
  addThud(out, sr, r, 0, 0.1, 300, 0.02, 90);
  return finish(out, 0.8);
}

function genTick(sr, r, v) {
  const out = sized(sr, 0.08);
  addNoise(out, sr, r, 0, 0, 0.8, 0.00005, 0.0007, [bq('hp', 2500, 0.7, sr)]);
  addTone(out, sr, 0, 0.05, v ? 2500 : 3300, v ? 2500 : 3300, 0.35, 0.0002, 0.006);
  addTone(out, sr, 0, 0.04, v ? 700 : 900, v ? 670 : 860, 0.25, 0.0005, 0.007);
  return finish(out, 0.8);
}

function genHeart(sr, r) {
  const out = sized(sr, 0.55);
  addTone(out, sr, 0, 0.3, 64, 36, 1, 0.006, 0.055, 0.03);
  addNoise(out, sr, r, 0, 0.12, 0.35, 0.004, 0.03, [bq('lp', 140, 0.7, sr), bq('lp', 160, 0.7, sr)]);
  addTone(out, sr, 0.18, 0.25, 74, 42, 0.7, 0.005, 0.045, 0.025);
  addNoise(out, sr, r, 0.18, 0.1, 0.25, 0.004, 0.025, [bq('lp', 150, 0.7, sr), bq('lp', 170, 0.7, sr)]);
  return finish(out, 0.9);
}

function genBreath(exhale) {
  return (sr, r) => {
    const dur = (exhale ? 0.55 : 0.45) + r() * 0.1;
    const out = sized(sr, dur + 0.05);
    const b1 = bq('bp', 900 + r() * 300, 1.2, sr), b2 = bq('bp', 2400 + r() * 400, 1.5, sr);
    const n = Math.floor(dur * sr);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const e = exhale ? (u < 0.12 ? u / 0.12 : Math.pow((1 - u) / 0.88, 1.4))
        : Math.pow(Math.sin(Math.PI * u), 1.3) * (0.6 + 0.4 * u);
      const x = r() * 2 - 1;
      out[i] = (b1.run(x) * 0.8 + b2.run(x) * 0.5 + x * 0.05) * e;
    }
    return finish(out, 0.7);
  };
}

function genReload(sr, r) {
  const out = sized(sr, 2.2);
  // magazine catch
  addMetal(out, sr, 0.1, 3200, [1, 1.5], 0.3, 0.008);
  addNoise(out, sr, r, 0.1, 0, 0.3, 0.0001, 0.001, [bq('hp', 2500, 0.7, sr)]);
  // mag rocked out
  addSweep(out, sr, r, 0.18, 0.12, 2200, 1400, 2, 0.4);
  addMetal(out, sr, 0.3, 1900, [1, 1.6, 2.4], 0.25, 0.015);
  // fresh mag rocked in
  addThud(out, sr, r, 1.0, 0.4, 600, 0.015, 120);
  addMetal(out, sr, 1.0, 1500, [1, 1.7, 2.3], 0.4, 0.02);
  addMetal(out, sr, 1.06, 3000, [1, 1.45], 0.3, 0.006);
  // charging handle back and slam
  addSweep(out, sr, r, 1.55, 0.09, 1800, 2600, 1.5, 0.35);
  addMetal(out, sr, 1.62, 2200, [1, 1.5], 0.2, 0.01);
  addThud(out, sr, r, 1.72, 0.6, 700, 0.015, 140);
  addMetal(out, sr, 1.72, 1700, [1, 1.52, 2.3, 3.1], 0.5, 0.03);
  return finish(out, 0.85);
}

function genClick(sr, r) {
  const out = sized(sr, 0.12);
  addMetal(out, sr, 0, 2600, [1, 1.7, 2.9], 0.5, 0.006);
  addNoise(out, sr, r, 0, 0, 0.5, 0.0001, 0.001, [bq('hp', 2000, 0.7, sr)]);
  return finish(out, 0.8);
}

function genSwing(sr, r) {
  const out = sized(sr, 0.4);
  addSweep(out, sr, r, 0, 0.32, 350 + r() * 100, 1500, 1.3, 0.8, (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 2));
  addNoise(out, sr, r, 0, 0.3, 0.2, 0.08, 0.06, [bq('lp', 300, 0.7, sr)]);
  return finish(out, 0.75);
}

function genMelee(sr, r) {
  const out = sized(sr, 0.35);
  addThud(out, sr, r, 0, 1, 320, 0.03, 80);
  addNoise(out, sr, r, 0, 0, 0.3, 0.0002, 0.004, [bq('bp', 1500, 1, sr)]);
  addMetal(out, sr, 0.002, 950 + r() * 100, [1, 2.4, 3.9], 0.12, 0.05);
  return finish(out, 0.9);
}

function genThrow(sr, r) {
  const out = sized(sr, 0.4);
  addSweep(out, sr, r, 0, 0.05, 3000, 5200, 3, 0.25);
  addSweep(out, sr, r, 0.04, 0.28, 300, 1300, 1.2, 0.6, (u) => Math.pow(Math.sin(Math.PI * u), 2));
  return finish(out, 0.7);
}

function genGear(sr, r) {
  const out = sized(sr, 0.3);
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) addMetal(out, sr, r() * 0.18, 2400 + r() * 1600, [1, 1.42, 2.2], 0.3, 0.012 + r() * 0.01);
  addGrains(out, sr, r, 0, 0.2, 15, 0.12, 0.002, 0.008, [bq('hp', 1800, 0.7, sr)]);
  return finish(out, 0.7);
}

function genHelmet(sr, r) {
  const out = sized(sr, 0.9);
  addNoise(out, sr, r, 0, 0, 0.5, 0.0003, 0.01, [bq('lp', 600, 0.7, sr)]);
  addMetal(out, sr, 0, 1350 + r() * 200, [1, 1.62, 2.71, 3.55, 4.4], 0.7, 0.11);
  return finish(out, 0.85);
}

function genBodyfall(sr, r) {
  const out = sized(sr, 0.9);
  addThud(out, sr, r, 0, 1, 180, 0.06, 55);
  addThud(out, sr, r, 0.12 + r() * 0.05, 0.6, 220, 0.04, 65);
  addMetal(out, sr, 0.05, 1700, [1, 1.9, 2.7], 0.12, 0.03);
  addMetal(out, sr, 0.15, 2400, [1, 1.5], 0.08, 0.02);
  addNoise(out, sr, r, 0.18, 0, 0.3, 0.0003, 0.015, [bq('bp', 1200, 3, sr)]);
  addMetal(out, sr, 0.19, 1300, [1, 1.6, 2.5], 0.1, 0.04);
  addGrains(out, sr, r, 0, 0.3, 30, 0.2, 0.0005, 0.003, [bq('hp', 2000, 0.7, sr)]);
  return finish(out, 0.9);
}

function genDrip(sr, r) {
  const out = sized(sr, 0.2);
  const f = 900 + r() * 900;
  addTone(out, sr, 0, 0.04, f, f * 2.3, 0.7, 0.0005, 0.018);
  addTone(out, sr, 0.002, 0.08, f * 1.9, f * 2.0, 0.12, 0.002, 0.03);
  addNoise(out, sr, r, 0, 0, 0.12, 0.0001, 0.003, [bq('hp', 3000, 0.7, sr)]);
  return finish(out, 0.8);
}

function genHatch(sr, r) {
  const out = sized(sr, 1.1);
  { // stick-slip creak of the wooden lid
    const creak = sized(sr, 0.5);
    const b1 = bq('bp', 1250 + r() * 200, 5, sr), b2 = bq('bp', 620 + r() * 80, 4, sr);
    let ph = 0, walk = 0;
    const n = creak.length;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      walk = walk * 0.999 + (r() - 0.5) * 0.02;
      const rate = clamp(110 + 450 * u * (1 - u) + 900 * walk, 40, 420);
      ph += rate / sr;
      let x = 0;
      if (ph >= 1) { ph -= 1; x = 1 + r() * 0.5; }
      creak[i] = (b1.run(x) + b2.run(x) * 0.7) * Math.pow(Math.sin(Math.PI * u), 0.7);
    }
    mixInto(out, normalize(creak, 0.5), sr, 0, 1);
  }
  addThud(out, sr, r, 0.52, 0.9, 140, 0.05, 50);
  addNoise(out, sr, r, 0.52, 0, 0.5, 0.0005, 0.03, [bq('bp', 420, 3, sr)]);
  addGrains(out, sr, r, 0.56, 0.95, 25, 0.2, 0.002, 0.008, [bq('lp', 1500, 0.7, sr)], (u) => 1 - u);
  return finish(out, 0.85);
}

function genTrap(sr, r) {
  const out = sized(sr, 1.1);
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const t = r() * 0.5, f = 1100 + r() * 700;
    addNoise(out, sr, r, t, 0, 0.5, 0.0003, 0.012, [bq('bp', f, 7, sr)]);
    addTone(out, sr, t, 0.1, f * 0.8, f * 0.79, 0.25, 0.0005, 0.025);
  }
  addGrains(out, sr, r, 0.3, 1.0, 70, 0.3, 0.002, 0.01, [bq('lp', 1300, 0.7, sr)]);
  addNoise(out, sr, r, 0.35, 0.7, 0.2, 0.05, 0.2, [bq('lp', 400, 0.7, sr)]);
  return finish(out, 0.8);
}

function genTrapSpring(sr, r) {
  const out = sized(sr, 0.6);
  addThud(out, sr, r, 0, 1, 260, 0.05, 60);
  addGrains(out, sr, r, 0, 0.09, 45, 0.7, 0.0005, 0.003, [bq('hp', 1500, 0.7, sr)]);
  for (let i = 0; i < 3; i++) addNoise(out, sr, r, r() * 0.06, 0, 0.5, 0.0003, 0.01, [bq('bp', 1000 + r() * 800, 6, sr)]);
  addGrains(out, sr, r, 0, 0.3, 30, 0.3, 0.0006, 0.003, [bq('hp', 2500, 0.7, sr)], (u) => 1 - u);
  return finish(out, 0.9);
}

// ---- ambience loops -----------------------------------------------------------

function genCicada(sr, r, v) {
  const L = 7, XF = 0.5;
  const raw = sized(sr, L + XF);
  const n = raw.length;
  if (v === 0) { // broadband buzz chorus, ~94 Hz pulse
    const b1 = bq('bp', 4300, 4, sr), b2 = bq('bp', 4300, 4, sr), b3 = bq('bp', 8600, 3, sr);
    let ph = 0, wob = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      wob = wob * 0.999 + (r() - 0.5) * 0.002;
      ph += TAU * 94 * (1 + wob) / sr;
      const am = Math.pow(0.5 + 0.5 * Math.sin(ph), 3);
      const slow = 0.8 + 0.2 * Math.sin(TAU * t * 2 / L);
      const x = r() * 2 - 1;
      raw[i] = (b2.run(b1.run(x)) + b3.run(x) * 0.25) * (0.25 + 0.75 * am) * slow;
    }
  } else if (v === 1) { // pulsed tonal species: rising "zee-zee-zee" phrases
    const nb = bq('bp', 3150, 8, sr);
    const P = L / 2;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const u = (t % P) / P;
      const env = u < 0.6 ? Math.pow(u / 0.6, 1.5) : u < 0.85 ? 1 : (1 - u) / 0.15;
      const am = Math.pow(Math.max(0, Math.sin(TAU * 26 * t)), 2);
      const car = Math.sin(TAU * 3150 * t + 0.3 * Math.sin(TAU * 80 * t)) + 0.35 * Math.sin(TAU * 6300 * t);
      raw[i] = (car * 0.6 + nb.run(r() * 2 - 1) * 1.6) * am * (0.1 + 0.9 * env);
    }
  } else { // shrill whine
    const b1 = bq('bp', 5600, 14, sr), b2 = bq('bp', 5600, 14, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const am = (0.7 + 0.3 * Math.sin(TAU * 180 * t)) * (0.85 + 0.15 * Math.sin(TAU * 5 * t));
      raw[i] = b2.run(b1.run(r() * 2 - 1)) * am;
    }
  }
  return finishLoop(raw, Math.floor(XF * sr), 0.8);
}

function genWind(sr, r) {
  const L = 10, XF = 0.8;
  const raw = sized(sr, L + XF);
  const lp = bq('lp', 420, 0.6, sr), hp = bq('hp', 40, 0.7, sr), hs = bq('bp', 900, 0.5, sr);
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    b = (b + (r() * 2 - 1) * 0.04) * 0.997;
    const m = 0.7 + 0.3 * Math.sin(TAU * t * 3 / L + 1.3 * Math.sin(TAU * t / L));
    raw[i] = (hp.run(lp.run(b)) * 6 + hs.run(r() * 2 - 1) * 0.05) * m;
  }
  return finishLoop(raw, Math.floor(XF * sr), 0.7);
}

function genLeaves(sr, r) {
  const L = 8, XF = 0.5;
  const raw = sized(sr, L + XF);
  const fs = [bq('hp', 1800, 0.7, sr)];
  const count = Math.floor(700 * (L + XF));
  for (let g = 0; g < count; g++) {
    const t = r() * (L + XF);
    const dd = 0.002 + r() * 0.01;
    const swell = 0.5 + 0.5 * Math.sin(TAU * t * 2 / L);
    addNoise(raw, sr, r, t, dd, Math.pow(r(), 2.2) * (0.3 + 0.7 * swell), 0.0004, dd * 0.3, fs);
  }
  addNoiseSus(raw, sr, r, 0, L + XF, 0.06, [bq('bp', 3500, 0.7, sr)], 0.01);
  return finishLoop(raw, Math.floor(XF * sr), 0.7);
}

function genFrogs(sr, r) {
  const L = 9, XF = 0.6;
  const raw = sized(sr, L + XF);
  const types = ['ribbit', 'ribbit', 'gung', 'peep', 'peep', 'rattle', 'cricket', 'cricket', 'ribbit', 'peep', 'gung', 'tok', 'cricket'];
  for (let k = 0; k < types.length; k++) {
    const type = types[k];
    const amp = 0.3 + 0.7 * r();
    const period = type === 'cricket' ? 0.35 + r() * 0.25 : type === 'peep' ? 0.5 + r() * 0.6 : 0.9 + r() * 1.6;
    const f = type === 'ribbit' ? 500 + r() * 400 : type === 'gung' ? 200 + r() * 120 : type === 'peep' ? 2400 + r() * 1000
      : type === 'rattle' ? 1600 + r() * 800 : type === 'cricket' ? 4200 + r() * 800 : 400 + r() * 200;
    let t = r() * period;
    while (t < L + XF - 0.3) {
      if (r() > 0.18) {
        switch (type) {
          case 'ribbit': {
            const np = 2 + Math.floor(r() * 2);
            for (let p = 0; p < np; p++) addTone(raw, sr, t + p * 0.045, 0.025, f, f * 1.05, amp, 0.004, 0.008, 0, [0.5, 0.3, 0.15]);
            break;
          }
          case 'gung': addTone(raw, sr, t, 0.3, f, f * 1.12, amp * 0.9, 0.02, 0.07, 0, [0.6, 0.2]); break;
          case 'peep': addTone(raw, sr, t, 0.07, f, f * 1.18, amp * 0.5, 0.005, 0.02); break;
          case 'rattle': {
            const nc = 10 + Math.floor(r() * 9), rate = 18 + r() * 8;
            for (let c = 0; c < nc; c++) addTone(raw, sr, t + c / rate, 0.02, f, f, amp * 0.4, 0.0005, 0.004);
            break;
          }
          case 'cricket': for (let c = 0; c < 3; c++) addTone(raw, sr, t + c * 0.03, 0.02, f, f, amp * 0.25, 0.002, 0.005); break;
          default: addTone(raw, sr, t, 0.06, f, f * 0.9, amp, 0.002, 0.012, 0, [0.4]);
        }
      }
      t += period * (0.8 + 0.4 * r());
    }
  }
  filterBuf(raw, [bq('lp', 6500, 0.7, sr)]);
  return finishLoop(raw, Math.floor(XF * sr), 0.8);
}

function genRiver(sr, r) {
  const L = 8, XF = 0.5;
  const raw = sized(sr, L + XF);
  const bp = bq('bp', 500, 0.6, sr), lp = bq('lp', 1400, 0.7, sr);
  let m = 0.5, mt = 0.5;
  for (let i = 0; i < raw.length; i++) {
    if ((i & 1023) === 0) mt = 0.3 + 0.7 * r();
    m += (mt - m) * 0.002;
    raw[i] = lp.run(bp.run(r() * 2 - 1)) * m;
  }
  const count = Math.floor(35 * (L + XF));
  for (let k = 0; k < count; k++) {
    const t = r() * (L + XF), f0 = 300 + Math.pow(r(), 2) * 1500, d = 0.006 + r() * 0.019;
    addTone(raw, sr, t, d, f0, f0 * (1.4 + r() * 0.8), 0.04 + r() * 0.11, 0.001, d * 0.4);
  }
  return finishLoop(raw, Math.floor(XF * sr), 0.75);
}

function genRoom(sr, r) {
  const L = 8, XF = 0.5;
  const raw = sized(sr, L + XF);
  const lp = bq('lp', 90, 0.7, sr), hp = bq('hp', 25, 0.7, sr), lp2 = bq('lp', 300, 0.7, sr);
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    b = (b + (r() * 2 - 1) * 0.05) * 0.996;
    raw[i] = hp.run(lp.run(b)) * 8 * (0.8 + 0.2 * Math.sin(TAU * t / L)) + lp2.run(r() * 2 - 1) * 0.02;
  }
  return finishLoop(raw, Math.floor(XF * sr), 0.6);
}

function genFire(sr, r) {
  const L = 6, XF = 0.4;
  const raw = sized(sr, L + XF);
  const lp = bq('lp', 300, 0.7, sr);
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    b = (b + (r() * 2 - 1) * 0.05) * 0.995;
    raw[i] = lp.run(b) * 2.5 * (0.7 + 0.3 * Math.sin(TAU * t * 1.5 + Math.sin(TAU * t * 0.5) * 2));
  }
  const hp = [bq('hp', 2500, 0.7, sr)];
  const nc = Math.floor(40 * (L + XF));
  for (let k = 0; k < nc; k++) addNoise(raw, sr, r, r() * (L + XF), 0.0015, Math.pow(r(), 3) * 1.2, 0.0001, 0.0004, hp);
  for (let k = 0; k < 12 * (L + XF); k++) addNoise(raw, sr, r, r() * (L + XF), 0.012, 0.3 * r(), 0.0005, 0.003, [bq('bp', 1200, 2, sr)]);
  return finishLoop(raw, Math.floor(XF * sr), 0.8);
}

function genHeli(sr, r) {
  // UH-1: two-blade main rotor ~10.5 blade passes/s, tail rotor buzz, turbine whine.
  const L = 2.0, XF = 0.25, rate = 10.5;
  const raw = sized(sr, L + XF);
  const bp = bq('bp', 380, 1.1, sr), lpf = bq('lp', 1400, 0.7, sr);
  for (let k = 0; k * (1 / rate) < L + XF; k++) {
    const tp = k / rate;
    addNoise(raw, sr, r, tp, 0.08, k % 2 ? 0.92 : 1.0, 0.003, 0.022, [bp, lpf]);
    addTone(raw, sr, tp, 0.04, 95, 60, 0.9, 0.002, 0.014, 0.01);
  }
  const tl = bq('lp', 700, 0.7, sr), eng = bq('lp', 500, 0.7, sr);
  let tph = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    tph += 55 / sr;
    if (tph >= 1) tph -= 1;
    const saw = tph * 2 - 1;
    raw[i] += tl.run(saw) * 0.12 * (0.8 + 0.2 * Math.sin(TAU * rate * t))
      + Math.sin(TAU * 3800 * t) * 0.012 + Math.sin(TAU * 5600 * t) * 0.008
      + eng.run(r() * 2 - 1) * 0.12;
  }
  return finishLoop(raw, Math.floor(XF * sr), 0.85);
}

function genGibbon(sr, r) {
  const out = sized(sr, 6.5);
  const n = 10 + Math.floor(r() * 5);
  let t = 0.1;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const dur = lerp(0.38, 0.2, k);
    const f0 = lerp(520, 780, k) * (0.97 + 0.06 * r());
    addTone(out, sr, t, dur, f0, f0 * lerp(1.6, 2.1, k), lerp(0.5, 1, k), dur * 0.35, dur * 0.3, 0, [0.22, 0.08]);
    t += dur + lerp(0.25, 0.05, k);
  }
  addTone(out, sr, t + 0.1, 0.45, 1100, 650, 0.7, 0.08, 0.15, 0, [0.2]);
  addTone(out, sr, t + 0.7, 0.5, 1000, 600, 0.5, 0.08, 0.15, 0, [0.2]);
  return finish(out, 0.85);
}

function genGecko(sr, r) {
  // tokay gecko: a dry rattle, then a run of fading "to-kay" calls
  const out = sized(sr, 4.6);
  for (let c = 0; c < 10; c++) addTone(out, sr, 0.05 + c / 28, 0.02, 1400, 1300, 0.3, 0.0005, 0.004);
  const pairs = 4 + Math.floor(r() * 3);
  let t = 0.6, amp = 1, iv = 0.6;
  const H = [0.8, 0.6, 0.4, 0.3, 0.2];
  for (let p = 0; p < pairs; p++) {
    addTone(out, sr, t, 0.11, 380, 360, amp * 0.8, 0.01, 0.05, 0, H);
    addTone(out, sr, t + 0.16, 0.2, 450, 410, amp, 0.015, 0.09, 0, H);
    t += iv; iv += 0.03; amp *= 0.88;
  }
  filterBuf(out, [bq('bp', 950, 0.9, sr)]);
  return finish(out, 0.85);
}

function genFlush(sr, r) {
  const out = sized(sr, 2.0);
  const nb = 8 + Math.floor(r() * 6);
  for (let b = 0; b < nb; b++) {
    const t0 = r() * 0.35, rate = 12 + r() * 10, dur = 0.6 + r() * 0.9, f = 600 + r() * 900;
    const fs = [bq('bp', f, 1.2, sr)];
    const nbeat = Math.floor(dur * rate);
    for (let k = 0; k < nbeat; k++) addNoise(out, sr, r, t0 + k / rate, 0.05, 0.6 * (1 - k / nbeat), 0.004, 0.012, fs);
  }
  for (let c = 0; c < 6; c++) { const f = 2800 + r() * 1200; addTone(out, sr, r() * 1.2, 0.06, f, f * 0.8, 0.25, 0.003, 0.02); }
  return finish(out, 0.8);
}

function genRadio(sr, r) {
  const speech = speak(sr, r, babble(r, 4 + Math.floor(r() * 4)), { f0: 115 + r() * 20, shout: false, tempo: 0.9 });
  filterBuf(speech, [bq('hp', 450, 0.7, sr), bq('lp', 2800, 0.7, sr), bq('hp', 450, 0.7, sr)]);
  for (let i = 0; i < speech.length; i++) speech[i] = Math.tanh(speech[i] * 3);
  const dur = speech.length / sr + 0.35;
  const out = sized(sr, dur);
  addNoise(out, sr, r, 0, 0.09, 0.5, 0.002, 0.03, [bq('hp', 1000, 0.7, sr)]);
  mixInto(out, normalize(speech, 0.6), sr, 0.08, 1);
  addNoiseSus(out, sr, r, 0.02, dur - 0.1, 0.05, [bq('bp', 2000, 0.4, sr)], 0.05);
  addNoise(out, sr, r, dur - 0.22, 0.2, 0.45, 0.003, 0.06, [bq('hp', 800, 0.7, sr)]);
  return finish(out, 0.75);
}

// ---- registry ----------------------------------------------------------------
// n: variants, sr: generation rate, fn(sr, rng, variant) -> Float32Array

const GEN = {
  akPlayer: { n: 4, sr: SR_HI, fn: genShot('ak', true) },
  ak: { n: 3, sr: SR_HI, fn: genShot('ak', false) },
  m16: { n: 4, sr: SR_HI, fn: genShot('m16', false) },
  m60: { n: 3, sr: SR_HI, fn: genShot('m60', false) },
  shell: { n: 9, sr: SR_HI, fn: genShell },
  step_mud: { n: 5, sr: SR_HI, fn: genStep('mud') },
  step_leaves: { n: 5, sr: SR_HI, fn: genStep('leaves') },
  step_grass: { n: 5, sr: SR_HI, fn: genStep('grass') },
  step_dirt: { n: 5, sr: SR_HI, fn: genStep('dirt') },
  step_water: { n: 5, sr: SR_HI, fn: genStep('water') },
  step_tunnel: { n: 5, sr: SR_HI, fn: genStep('tunnel') },
  dig: { n: 4, sr: SR_HI, fn: genDig },
  dirtFall: { n: 2, sr: SR_MID, fn: genDirtFall },
  explosion: { n: 3, sr: SR_MID, fn: genExplosion(false) },
  explosionBig: { n: 2, sr: SR_MID, fn: genExplosion(true) },
  bounce: { n: 3, sr: SR_HI, fn: genBounce },
  whiz: { n: 3, sr: SR_HI, fn: genWhiz },
  impact: { n: 3, sr: SR_HI, fn: genImpact },
  impactWood: { n: 2, sr: SR_HI, fn: genImpactWood },
  impactLeaf: { n: 2, sr: SR_HI, fn: genImpactLeaf },
  tick: { n: 2, sr: SR_HI, fn: genTick },
  heart: { n: 1, sr: SR_LO, fn: genHeart },
  breathIn: { n: 2, sr: SR_LO, fn: genBreath(false) },
  breathOut: { n: 2, sr: SR_LO, fn: genBreath(true) },
  reload: { n: 1, sr: SR_HI, fn: genReload },
  click: { n: 1, sr: SR_HI, fn: genClick },
  swing: { n: 2, sr: SR_MID, fn: genSwing },
  melee: { n: 2, sr: SR_MID, fn: genMelee },
  throw: { n: 1, sr: SR_MID, fn: genThrow },
  gear: { n: 3, sr: SR_HI, fn: genGear },
  helmet: { n: 2, sr: SR_HI, fn: genHelmet },
  bodyfall: { n: 2, sr: SR_MID, fn: genBodyfall },
  drip: { n: 4, sr: SR_HI, fn: genDrip },
  hatch: { n: 2, sr: SR_MID, fn: genHatch },
  trap: { n: 2, sr: SR_MID, fn: genTrap },
  trapSpring: { n: 2, sr: SR_MID, fn: genTrapSpring },
  cicada: { n: 3, sr: SR_LO, fn: genCicada },
  wind: { n: 1, sr: SR_LO, fn: genWind },
  leaves: { n: 1, sr: SR_LO, fn: genLeaves },
  frogs: { n: 1, sr: SR_LO, fn: genFrogs },
  river: { n: 1, sr: SR_LO, fn: genRiver },
  room: { n: 1, sr: SR_LO, fn: genRoom },
  fire: { n: 1, sr: SR_LO, fn: genFire },
  heli: { n: 1, sr: SR_LO, fn: genHeli },
  gibbon: { n: 2, sr: SR_LO, fn: genGibbon },
  gecko: { n: 2, sr: SR_LO, fn: genGecko },
  flush: { n: 2, sr: SR_LO, fn: genFlush },
  radio: { n: 3, sr: SR_MID, fn: genRadio },
  murmur: { n: 4, sr: SR_MID, fn: (sr, r) => speak(sr, r, babble(r, 4 + Math.floor(r() * 4)), { f0: 105 + r() * 25, shout: false }) },
  scream: { n: 2, sr: SR_MID, fn: (sr, r, v) => speak(sr, r, 'h.04 a.42! uh.3', { f0: v ? 270 : 225, shout: true }) },
  hurt: { n: 3, sr: SR_MID, fn: (sr, r, v) => speak(sr, r, ['uh.14!', 'h.05 uh.12!', 'e.1! h.08'][v], { f0: 118 + r() * 15, shout: false }) },
};
for (const p in PHRASES) {
  GEN['sh_' + p] = { n: 2, sr: SR_MID, fn: (sr, r, v) => speak(sr, r, PHRASES[p], { f0: (v ? 198 : 158) * (0.96 + 0.08 * r()), shout: true }) };
}

const PREWARM = [
  'cicada:0', 'wind:0', 'leaves:0', 'cicada:1', 'cicada:2', 'frogs:0', 'river:0', 'room:0',
  'akPlayer:*', 'shell:*', 'step_leaves:*', 'step_grass:*', 'step_mud:*', 'step_dirt:*', 'step_water:*', 'step_tunnel:*',
  'm16:*', 'dig:*', 'explosion:*', 'bounce:*', 'whiz:*', 'tick:*', 'heart:*', 'breathIn:*', 'breathOut:*',
  'sh_contact:*', 'sh_overthere:*', 'sh_grenade:*', 'hatch:*', 'dirtFall:*', 'impact:*', 'bodyfall:*', 'helmet:*',
  'm60:*', 'ak:*', 'explosionBig:*', 'heli:*', 'fire:*', 'gibbon:*', 'gecko:*', 'flush:*', 'gear:*', 'drip:*', '*',
];

function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; }

// Pure synthesis entry (also handy for offline inspection/tests).
export function synthesize(key, variant = 0) {
  const G = GEN[key];
  if (!G) return null;
  const v = ((variant % G.n) + G.n) % G.n;
  const data = G.fn(G.sr, rand(hashStr(key) * 31 + v * 977 + 7), v);
  return { data, sampleRate: G.sr };
}

// ============================================================================
// Runtime
// ============================================================================

let sharedAC = null;               // one AudioContext for the page, reused across instances
const BUFS = new Map();            // key -> AudioBuffer[] (context-independent)
let current = null;

const EMPTY = Object.freeze({});
const FIREBASE_R2 = (WORLD.firebase.radius + 6) * (WORLD.firebase.radius + 6);

// Generic one-shot table for play(name)
const SFX = {
  reload: { key: 'reload', gain: 0.55, ref: 2, roll: 1, cat: 'gear', cap: 2, prio: 6, send: 0.15, rate: [0.98, 1.02] },
  click: { key: 'click', gain: 0.5, ref: 2, roll: 1, cat: 'gear', cap: 2, prio: 6, send: 0.1, rate: [0.95, 1.05] },
  dryfire: { key: 'click', gain: 0.5, ref: 2, roll: 1, cat: 'gear', cap: 2, prio: 6, send: 0.1, rate: [0.95, 1.05] },
  switch: { key: 'gear', gain: 0.3, ref: 2, roll: 1, cat: 'gear', cap: 2, prio: 4, send: 0.05, rate: [0.9, 1.1] },
  gear: { key: 'gear', gain: 0.3, ref: 3, roll: 1.2, cat: 'gear', cap: 3, prio: 3, send: 0.1, rate: [0.9, 1.1] },
  swing: { key: 'swing', gain: 0.45, ref: 2, roll: 1, cat: 'melee', cap: 2, prio: 6, send: 0.1, rate: [0.9, 1.1] },
  melee: { key: 'melee', gain: 0.8, ref: 3, roll: 1, cat: 'melee', cap: 2, prio: 7, send: 0.2, rate: [0.9, 1.1] },
  shovelHit: { key: 'melee', gain: 0.8, ref: 3, roll: 1, cat: 'melee', cap: 2, prio: 7, send: 0.2, rate: [0.9, 1.1] },
  throw: { key: 'throw', gain: 0.5, ref: 2, roll: 1, cat: 'melee', cap: 2, prio: 6, send: 0.1, rate: [0.9, 1.1] },
  hatch: { key: 'hatch', gain: 0.7, ref: 4, roll: 1, cat: 'world', cap: 3, prio: 6, send: 0.3, rate: [0.92, 1.08] },
  trap: { key: 'trap', gain: 0.6, ref: 4, roll: 1, cat: 'world', cap: 3, prio: 5, send: 0.2, rate: [0.92, 1.08] },
  trapSpring: { key: 'trapSpring', gain: 0.9, ref: 6, roll: 1, cat: 'world', cap: 3, prio: 7, send: 0.3, rate: [0.92, 1.08] },
  impact: { key: 'impact', gain: 0.6, ref: 4, roll: 1.2, cat: 'impact', cap: 6, prio: 3, send: 0.15, rate: [0.85, 1.15] },
  impactWood: { key: 'impactWood', gain: 0.6, ref: 4, roll: 1.2, cat: 'impact', cap: 6, prio: 3, send: 0.15, rate: [0.85, 1.15] },
  impactLeaf: { key: 'impactLeaf', gain: 0.5, ref: 4, roll: 1.2, cat: 'impact', cap: 6, prio: 3, send: 0.1, rate: [0.85, 1.15] },
  whiz: { key: 'whiz', gain: 0.7, ref: 2, roll: 1, cat: 'whiz', cap: 3, prio: 8, send: 0.1, rate: [0.9, 1.1], hrtf: true },
  bodyfall: { key: 'bodyfall', gain: 0.8, ref: 5, roll: 1, cat: 'body', cap: 3, prio: 5, send: 0.25, rate: [0.9, 1.1] },
  helmet: { key: 'helmet', gain: 0.6, ref: 5, roll: 1, cat: 'body', cap: 3, prio: 5, send: 0.25, rate: [0.92, 1.08] },
  drip: { key: 'drip', gain: 0.25, ref: 2, roll: 1, cat: 'drip', cap: 3, prio: 1, send: 0.8, rate: [0.85, 1.2] },
  dirtFall: { key: 'dirtFall', gain: 0.55, ref: 3, roll: 1, cat: 'dig', cap: 3, prio: 5, send: 0.5, rate: [0.9, 1.1] },
  collapse: { key: 'dirtFall', gain: 0.7, ref: 3, roll: 1, cat: 'dig', cap: 3, prio: 5, send: 0.5, rate: [0.8, 0.9] },
  heartbeat: { key: 'heart', gain: 0.6, ref: 1, roll: 1, cat: 'body', cap: 2, prio: 9, send: 0, rate: [1, 1] },
  hurt: { key: 'hurt', gain: 0.55, ref: 1, roll: 1, cat: 'pvoice', cap: 1, prio: 8, send: 0.2, rate: [0.95, 1.05] },
  scream: { key: 'scream', gain: 0.9, ref: 6, roll: 1, cat: 'voice', cap: 3, prio: 6, send: 0.4, rate: [0.92, 1.08], hrtf: true },
  radio: { key: 'radio', gain: 0.45, ref: 4, roll: 1.2, cat: 'voice', cap: 3, prio: 3, send: 0.2, rate: [0.98, 1.02] },
  murmur: { key: 'murmur', gain: 0.35, ref: 4, roll: 1.2, cat: 'voice', cap: 3, prio: 3, send: 0.2, rate: [0.95, 1.05] },
  gibbon: { key: 'gibbon', gain: 0.5, ref: 30, roll: 1, cat: 'call', cap: 2, prio: 1, send: 0.9, rate: [0.95, 1.05] },
  gecko: { key: 'gecko', gain: 0.35, ref: 8, roll: 1, cat: 'call', cap: 2, prio: 1, send: 0.5, rate: [0.95, 1.05] },
  flush: { key: 'flush', gain: 0.5, ref: 10, roll: 1, cat: 'call', cap: 2, prio: 2, send: 0.4, rate: [0.9, 1.1] },
};

export function createAudio(ctx = {}) {
  if (current) { try { current.dispose(); } catch (e) { /* ignore */ } }
  ctx = ctx || {};
  const ev = ctx.events || globalEvents;

  let ac = sharedAC;
  let G = null;
  let disposed = false;
  let volume = 0.9, muted = false;
  // Two clocks: `clock` is wall time (ambience, throttles, listener smoothing) and keeps running
  // behind menus and the pause panel; `gclock` only advances while the simulation does, so
  // anything tied to gameplay (satchel fuse, scheduled enemy shouts, dump cook-offs) freezes
  // with the game instead of drifting out of sync.
  let clock = 0, gclock = 0, ambAcc = 0, simOn = true;
  let lastCtxTime = NaN, ctxTimeMoves = false;
  let listenerUnder = false, manualUnder = false, manualHoldUntil = -1;
  let alertLevel = 0, hush = 0, lastFlush = -99, extSteps = false, extShoutAt = -99;
  let over = false, prevAlive = true, tinnitusUntil = -1, lastGrenadeShout = -99;
  let queue = null, queueIdx = 0;
  let heliOverride; // undefined = auto-detect from ctx.enemies
  const warned = new Set();
  const R = Math.random;

  const L = { x: 0, y: 0, z: 0, rx: 1, rz: 0, ok: false };
  const P = { init: false, x: 0, y: 0, z: 0, acc: 0, fall: 0, speed: 0, inWater: false };
  const tmpA = { x: 0, y: 0, z: 0 }, tmpB = { x: 0, y: 0, z: 0 }, tmpT = { x: 0, y: 0, z: 0 }, tmpE = { x: 0, y: 0, z: 0 };
  const fuse = { on: false, x: 0, y: 0, z: 0, end: 0, next: 0, n: 0, setAt: -99, synced: false };
  const dumpCheck = { pending: false, at: 0 };
  const lastBoom = { t: -99, x: 0, z: 0, big: false };
  const water = { idx: 0, acc: 0, best: Infinity, bx: 0, bz: 0, prox: 0, px: 0, pz: 0, found: false, fx: 0, fz: 0, rot: 0 };
  const WS_R = [5, 12, 24, 40], WS_W = [1, 0.6, 0.35, 0.2];
  const T = { bird: 3, gibbon: 25 + R() * 40, gecko: 15 + R() * 30, art: 40 + R() * 60, arc: 160 + R() * 200,
    fight: 60 + R() * 90, drip: 2, trickle: 10, chatter: 2, murmur: 10 + R() * 10, heart: 0, breath: 0, breathIn: true, digLast: -1, coverAt: 0 };
  let coverL = 0.5;
  const eState = new WeakMap();

  // ---------------------------------------------------------------- helpers
  function warnOnce(tag, e) {
    if (warned.has(tag)) return;
    warned.add(tag);
    console.warn('[audio] ' + tag + ':', e && e.message ? e.message : e);
  }
  function live() { return !disposed && G !== null && ac !== null && ac.state === 'running'; }
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  function finite3(p) { return p && fin(p.x) && fin(p.y) && fin(p.z); }
  function setPannerPos(p, x, y, z) {
    if (!fin(x) || !fin(y) || !fin(z)) return;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
  }
  function makePanner(model) {
    const p = ac.createPanner();
    p.panningModel = model;
    p.distanceModel = 'inverse';
    p.refDistance = 1; p.maxDistance = 10000; p.rolloffFactor = 0;
    p.coneInnerAngle = 360; p.coneOuterAngle = 360;
    return p;
  }
  function gainNode(v, dest) { const g = ac.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function lowpass(f, q, dest) { const b = ac.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; if (dest) b.connect(dest); return b; }
  function heightAt(x, z) { const h = ctx.world?.heightAt?.(x, z); return fin(h) ? h : null; }
  function isUnder(p) { const h = heightAt(p.x, p.z); return h !== null && h - p.y > 1.0; }
  function airCutoff(d, p) {
    let c = 350 + 19000 / (1 + Math.pow(d / 28, 1.25));
    if (d > 12 && ctx.world?.coverAt) {
      const cv = ctx.world.coverAt((p.x + L.x) * 0.5, (p.z + L.z) * 0.5);
      if (fin(cv)) c *= 1 - 0.35 * clamp(cv, 0, 1);
    }
    return c;
  }
  function posOf(o) {
    if (!o) return null;
    if (o.position && fin(o.position.x)) return o.position;
    const c = o.group || o.mesh || o.root || o.object || o.obj || o.model;
    if (c && c.position && fin(c.position.x)) return c.position;
    return null;
  }
  function aliveOf(e) {
    return e.alive !== false && !e.dead && e.state !== 'dead' && !(typeof e.health === 'number' && e.health <= 0);
  }
  // world position of an Object3D-ish thing (helicopter) into out; false if unknown
  function readWorldPos(o, out) {
    if (!o) return false;
    const node = o.isObject3D ? o : (o.group?.isObject3D ? o.group : o.mesh?.isObject3D ? o.mesh : o.root?.isObject3D ? o.root : null);
    if (node && node.matrixWorld) {
      const e = node.matrixWorld.elements;
      if (fin(e[12]) && (e[12] !== 0 || e[13] !== 0 || e[14] !== 0 || !node.parent)) { out.x = e[12]; out.y = e[13]; out.z = e[14]; return true; }
    }
    const p = posOf(o);
    if (p) { out.x = p.x; out.y = fin(p.y) ? p.y : 0; out.z = p.z; return true; }
    return false;
  }
  function firebasePos(out) {
    const fb = WORLD.firebase;
    out.x = fb.x; out.z = fb.z; out.y = (heightAt(fb.x, fb.z) ?? 0) + 3;
    return out;
  }

  // ---------------------------------------------------------------- buffers
  function peekBuffer(key, v) {
    const arr = BUFS.get(key);
    return arr ? arr[v % arr.length] : null;
  }
  function getBuffer(key, v) {
    const Gd = GEN[key];
    if (!Gd || !ac) return null;
    let arr = BUFS.get(key);
    if (!arr) { arr = new Array(Gd.n).fill(null); BUFS.set(key, arr); }
    v = ((v % Gd.n) + Gd.n) % Gd.n;
    if (arr[v]) return arr[v];
    try {
      const s = synthesize(key, v);
      const b = ac.createBuffer(1, s.data.length, s.sampleRate);
      if (b.copyToChannel) b.copyToChannel(s.data, 0); else b.getChannelData(0).set(s.data);
      arr[v] = b;
      return b;
    } catch (e) { warnOnce('synth ' + key, e); return null; }
  }
  const rv = (key) => Math.floor(R() * (GEN[key]?.n || 1));
  function buildQueue() {
    const q = [];
    const seen = new Set();
    const push = (k, v) => { const id = k + ':' + v; if (!seen.has(id) && GEN[k]) { seen.add(id); q.push(k, v); } };
    for (const item of PREWARM) {
      if (item === '*') { for (const k in GEN) for (let v = 0; v < GEN[k].n; v++) push(k, v); continue; }
      const [k, v] = item.split(':');
      if (v === '*') { for (let i = 0; i < (GEN[k]?.n || 0); i++) push(k, i); } else push(k, +v);
    }
    return q;
  }
  function prewarm() {
    if (!queue || queueIdx >= queue.length) return;
    const t0 = performance.now();
    while (queueIdx < queue.length && performance.now() - t0 < 3.5) {
      getBuffer(queue[queueIdx], queue[queueIdx + 1]);
      queueIdx += 2;
    }
  }

  function makeIR(seconds, tau, lpStart, lpEnd, early, late, boxy, seed) {
    const sr = ac.sampleRate, n = Math.floor(seconds * sr);
    const buf = ac.createBuffer(2, n, sr);
    const r = rand(seed);
    let peak = 0;
    const chans = [];
    for (let c = 0; c < 2; c++) {
      const d = new Float32Array(n);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const fc = lpStart * Math.pow(lpEnd / lpStart, t / seconds);
        lp += ((r() * 2 - 1) - lp) * (1 - Math.exp(-TAU * fc / sr));
        d[i] = lp * Math.exp(-t / tau) * Math.min(1, t / 0.004);
      }
      for (let e = 0; e < early.count; e++) {
        const t = early.t0 + Math.pow(r(), 1.4) * (early.t1 - early.t0);
        const i = Math.floor(t * sr);
        if (i < n) d[i] += (r() < 0.5 ? -1 : 1) * early.amp * (1 - (t - early.t0) / (early.t1 - early.t0)) * (0.4 + 0.6 * r());
      }
      if (late) {
        const i0 = Math.floor(late.t * sr), m = Math.floor(0.14 * sr);
        let l2 = 0;
        for (let i = 0; i < m && i0 + i < n; i++) {
          l2 += ((r() * 2 - 1) - l2) * 0.08;
          d[i0 + i] += l2 * late.amp * Math.sin(Math.PI * i / m);
        }
      }
      if (boxy) { const f = bq('bp', boxy, 1.2, sr); for (let i = 0; i < n; i++) d[i] = d[i] * 0.7 + f.run(d[i]) * 0.9; }
      for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      chans.push(d);
    }
    for (let c = 0; c < 2; c++) {
      const d = chans[c];
      if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
      if (buf.copyToChannel) buf.copyToChannel(d, c); else buf.getChannelData(c).set(d);
    }
    return buf;
  }

  // ---------------------------------------------------------------- graph
  function buildGraph() {
    const g = {};
    g.limiter = ac.createDynamicsCompressor();
    g.limiter.threshold.value = -6; g.limiter.knee.value = 5; g.limiter.ratio.value = 12;
    g.limiter.attack.value = 0.003; g.limiter.release.value = 0.25;
    g.limiter.connect(ac.destination);
    g.direct = gainNode(1, g.limiter);
    g.shock = lowpass(20000, 0.6, g.limiter);
    g.duck = gainNode(1, g.shock);
    g.master = gainNode(muted ? 0 : volume, g.duck);
    g.open = gainNode(1, g.master);
    // cross-space (muffled through earth)
    g.mufOut = gainNode(0.9, g.master);
    g.mufLP2 = lowpass(700, 0.5, g.mufOut);
    g.mufLP = lowpass(340, 0.9, g.mufLP2);
    g.muf = gainNode(1, g.mufLP);
    // reverbs
    g.verbSend = gainNode(1);
    g.outRet = gainNode(0.32, g.master);
    g.outConv = ac.createConvolver();
    g.outConv.buffer = makeIR(2.4, 0.42, 9000, 1100, { count: 40, t0: 0.012, t1: 0.14, amp: 0.5 }, { t: 0.52, amp: 0.25 }, 0, 1968);
    g.outConv.connect(g.outRet);
    g.outIn = gainNode(listenerUnder ? 0 : 1, g.outConv);
    g.tunRet = gainNode(0.75, g.master);
    g.tunConv = ac.createConvolver();
    g.tunConv.buffer = makeIR(0.6, 0.09, 3200, 800, { count: 30, t0: 0.0015, t1: 0.014, amp: 0.8 }, null, 220, 1969);
    g.tunConv.connect(g.tunRet);
    g.tunIn = gainNode(listenerUnder ? 1 : 0, g.tunConv);
    g.verbSend.connect(g.outIn);
    g.verbSend.connect(g.tunIn);
    g.mufVerb = gainNode(0.5, g.tunIn);
    g.mufOut.connect(g.mufVerb);
    // ambience
    g.ambOut = gainNode(listenerUnder ? 0.45 : 1.2, g.master);
    g.ambLP = lowpass(listenerUnder ? 320 : 18000, 0.5, g.ambOut);
    g.ambIn = gainNode(1, g.ambLP);
    G = g;
  }

  // ---------------------------------------------------------------- voices
  const STRIP_COUNT = 48;
  const strips = [];
  let seq = 1, lastStrip = null, lastWhen = 0;

  function makeStrip() {
    const env = ac.createGain(), filter = ac.createBiquadFilter(), gain = ac.createGain();
    const panner = makePanner('equalpower'), send = ac.createGain();
    filter.type = 'lowpass'; filter.Q.value = 0.5; filter.frequency.value = 20000;
    send.gain.value = 0;
    env.connect(filter); filter.connect(gain); send.connect(G.verbSend);
    return { env, filter, gain, panner, send, src: null, extra: [], busy: false, id: 0, cat: '', prio: 0,
      startAt: 0, endAt: 0, loop: false, route: '', model: 'equalpower' };
  }
  function releaseStrip(s) {
    if (s.src) { s.src.onended = null; try { s.src.disconnect(); } catch (e) { /* noop */ } }
    for (let i = 0; i < s.extra.length; i++) { try { s.extra[i].disconnect(); } catch (e) { /* noop */ } }
    s.extra.length = 0;
    s.src = null; s.busy = false; s.id = 0;
  }
  function killStrip(s) {
    if (s.src) { try { s.src.stop(); } catch (e) { /* noop */ } }
    for (let i = 0; i < s.extra.length; i++) { const x = s.extra[i]; if (x.stop) { try { x.stop(); } catch (e) { /* noop */ } } }
    releaseStrip(s);
  }
  function takeStrip(cat, cap, prio) {
    const now = ac.currentTime;
    let free = null, catCount = 0, oldestCat = null, victim = null;
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i];
      if (!s.busy) { if (!free) free = s; continue; }
      if (s.endAt < now - 0.25) { releaseStrip(s); if (!free) free = s; continue; }
      if (s.cat === cat) { catCount++; if (!oldestCat || s.startAt < oldestCat.startAt) oldestCat = s; }
      if (s.loop) continue;
      if (!victim || s.prio < victim.prio || (s.prio === victim.prio && s.startAt < victim.startAt)) victim = s;
    }
    if (catCount >= cap && oldestCat) { killStrip(oldestCat); return oldestCat; }
    if (free) return free;
    if (victim && victim.prio <= prio) { killStrip(victim); return victim; }
    return null;
  }
  function routeStrip(s, positional, cross) {
    const key = positional ? (cross ? 'pm' : 'po') : (cross ? 'nm' : 'no');
    if (s.route === key) return;
    const bus = cross ? G.muf : G.open;
    s.gain.disconnect(); s.panner.disconnect();
    if (positional) { s.gain.connect(s.panner); s.panner.connect(bus); s.panner.connect(s.send); }
    else { s.gain.connect(bus); s.gain.connect(s.send); }
    s.route = key;
  }

  // Shared option object for internal calls (no per-call allocation).
  const VO = { gain: 1, ref: 6, roll: 1, cat: 'sfx', cap: 8, prio: 5, send: 0.2, rate: 1, delay: true, hrtf: false,
    at: 0, under: null, lp: 0, loop: false, dur: 0, offset: 0, fadeIn: 0 };
  function vo(gain, ref, roll, cat, cap, prio, send) {
    VO.gain = gain; VO.ref = ref; VO.roll = roll; VO.cat = cat; VO.cap = cap; VO.prio = prio; VO.send = send;
    VO.rate = 1; VO.delay = true; VO.hrtf = false; VO.at = 0; VO.under = null; VO.lp = 0; VO.loop = false;
    VO.dur = 0; VO.offset = 0; VO.fadeIn = 0;
    return VO;
  }

  // Core voice start. node: an already-built source (oscillator) or null to use buf.
  function voiceSrc(node, buf, pos, o) {
    if (!live()) return 0;
    const now = ac.currentTime;
    let d = 0, positional = false, srcUnder = listenerUnder;
    if (pos) {
      const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      positional = d > 0.3;
      srcUnder = o.under === null ? isUnder(pos) : o.under;
    } else if (o.under !== null) srcUnder = o.under;
    const cross = srcUnder !== listenerUnder;
    let g = o.gain, send = o.send, fc = o.lp > 0 ? o.lp : 20000;
    if (pos) {
      const ex = Math.max(0, d - o.ref);
      const att = o.ref / (o.ref + o.roll * ex);
      const attW = o.ref / (o.ref + o.roll * 0.3 * ex);
      g *= att;
      send *= attW / att;
      fc = Math.min(fc, airCutoff(d, pos));
    }
    if (cross) { g *= 0.8; send = 0; fc = Math.min(fc, 900); }
    if (muted || !(g > 0.002)) return 0;
    send = Math.min(send, 4);
    const s = takeStrip(o.cat, o.cap, o.prio);
    if (!s) return 0;
    let src = node;
    if (!src) {
      if (!buf) return 0;
      src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = o.rate > 0.05 ? o.rate : 1;
      src.loop = !!o.loop;
    }
    const when = now + Math.max(0, o.at) + (o.delay && pos && d > 20 ? d / SPEED_OF_SOUND : 0);
    s.id = seq++; s.busy = true; s.cat = o.cat; s.prio = o.prio; s.startAt = now; s.loop = !!o.loop;
    const len = buf ? buf.duration / (o.rate > 0.05 ? o.rate : 1) : o.dur || 2;
    s.endAt = o.loop ? (o.dur > 0 ? when + o.dur + 0.2 : Infinity) : when + (node ? (o.dur || 2) : len) + 0.15;
    s.src = src;
    const env = s.env.gain;
    env.cancelScheduledValues(now);
    if (o.fadeIn > 0) { env.setValueAtTime(0.0001, now); env.setValueAtTime(0.0001, when); env.linearRampToValueAtTime(1, when + o.fadeIn); }
    else env.setValueAtTime(1, now);
    s.filter.frequency.cancelScheduledValues(now); s.filter.frequency.setValueAtTime(clamp(fc, 60, 20000), now);
    s.gain.gain.cancelScheduledValues(now); s.gain.gain.setValueAtTime(g, now);
    s.send.gain.cancelScheduledValues(now); s.send.gain.setValueAtTime(send, now);
    const model = o.hrtf ? 'HRTF' : 'equalpower';
    if (s.model !== model) { s.panner.panningModel = model; s.model = model; }
    if (positional) setPannerPos(s.panner, pos.x, pos.y, pos.z);
    routeStrip(s, positional, cross);
    src.connect(s.env);
    const id = s.id;
    src.onended = () => { if (s.id === id) releaseStrip(s); };
    if (buf) src.start(when, o.offset > 0 ? o.offset % buf.duration : 0); else src.start(when);
    if (o.dur > 0 && (o.loop || node)) {
      const endT = when + o.dur;
      if (o.loop) { env.setValueAtTime(1, Math.max(when + (o.fadeIn || 0), endT - 1.5)); env.linearRampToValueAtTime(0.0001, endT); }
      src.stop(endT + 0.05);
    }
    lastStrip = s; lastWhen = when;
    return id;
  }
  function voiceBuf(key, v, pos, o) {
    if (!live()) return 0;
    const buf = getBuffer(key, v);
    return buf ? voiceSrc(null, buf, pos, o) : 0;
  }
  function stopVoice(id, fade = 0.08) {
    if (!id || !live()) return;
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i];
      if (s.busy && s.id === id) {
        const now = ac.currentTime;
        s.env.gain.cancelScheduledValues(now);
        s.env.gain.setTargetAtTime(0, now, Math.max(0.005, fade / 3));
        try { s.src.stop(now + fade + 0.05); } catch (e) { /* noop */ }
        s.loop = false; s.endAt = now + fade + 0.1;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- listener / space
  function syncListener() {
    const cam = ctx.camera;
    let px, py, pz, fx = 0, fy = 0, fz = -1, ux = 0, uy = 1, uz = 0;
    if (cam && cam.matrixWorld) {
      if (cam.updateMatrixWorld) cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      px = e[12]; py = e[13]; pz = e[14];
      fx = -e[8]; fy = -e[9]; fz = -e[10];
      ux = e[4]; uy = e[5]; uz = e[6];
      L.rx = e[0]; L.rz = e[2];
    } else {
      const pp = ctx.player?.position;
      if (!pp) return;
      px = pp.x; py = pp.y + 1.6; pz = pp.z;
    }
    if (!fin(px) || !fin(py) || !fin(pz)) return;
    const fl = Math.hypot(fx, fy, fz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
    fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
    if (!fin(fx) || !fin(ux)) { fx = 0; fy = 0; fz = -1; ux = 0; uy = 1; uz = 0; }
    L.x = px; L.y = py; L.z = pz; L.ok = true;
    const li = ac.listener;
    if (li.positionX) {
      li.positionX.value = px; li.positionY.value = py; li.positionZ.value = pz;
      li.forwardX.value = fx; li.forwardY.value = fy; li.forwardZ.value = fz;
      li.upX.value = ux; li.upY.value = uy; li.upZ.value = uz;
    } else {
      li.setPosition(px, py, pz);
      li.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }
  function applyUnder(b) {
    listenerUnder = b;
    if (!G) return;
    const now = ac.currentTime, tau = 0.25;
    G.ambLP.frequency.setTargetAtTime(b ? 320 : 18000, now, tau);
    G.ambOut.gain.setTargetAtTime(b ? 0.45 : 1.2, now, tau);
    G.outIn.gain.setTargetAtTime(b ? 0 : 1, now, tau);
    G.tunIn.gain.setTargetAtTime(b ? 1 : 0, now, tau);
  }
  function desiredUnder() {
    if (clock < manualHoldUntil) return manualUnder;
    const u = ctx.player?.underground;
    return typeof u === 'boolean' ? u : manualUnder;
  }
  function setUnderground(b) {
    manualUnder = !!b;
    manualHoldUntil = clock + 1.5;
    if (manualUnder !== listenerUnder) applyUnder(manualUnder);
  }

  // ---------------------------------------------------------------- concussion
  function shock(k, at) {
    if (!live() || !(k > 0.02)) return;
    k = clamp(k, 0, 1);
    const t = Math.max(ac.currentTime, at);
    const f = G.shock.frequency, dg = G.duck.gain;
    f.cancelScheduledValues(t);
    f.setValueAtTime(20000, t);
    f.exponentialRampToValueAtTime(lerp(4000, 320, k), t + 0.05);
    f.setTargetAtTime(20000, t + 0.05 + 0.5 * k, 0.5 + 1.8 * k);
    dg.cancelScheduledValues(t);
    dg.setValueAtTime(1, t);
    dg.linearRampToValueAtTime(1 - 0.55 * k, t + 0.03);
    dg.setTargetAtTime(1, t + 0.1, 0.4 + 1.2 * k);
    if (k > 0.35 && clock >= tinnitusUntil) tinnitus(k, t);
  }
  function tinnitus(k, t) {
    tinnitusUntil = clock + 3.5;
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'sine';
    o.frequency.value = 3600 + R() * 900;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(0.05 * k * (muted ? 0 : volume), t + 0.15);
    gn.gain.setTargetAtTime(0.0001, t + 0.45, 0.9);
    o.connect(gn); gn.connect(G.direct);
    o.onended = () => { try { o.disconnect(); gn.disconnect(); } catch (e) { /* noop */ } };
    o.start(t); o.stop(t + 4.5);
  }

  // ---------------------------------------------------------------- timers (pooled)
  const TIMERS = [];
  for (let i = 0; i < 128; i++) TIMERS.push({ on: false, wall: false, at: 0, fn: null, x: 0, y: 0, z: 0, s: '', n: 0 });
  // wall = true: ambience timer on the wall clock (keeps going while paused); otherwise game clock
  function schedule(delay, fn, p, s, n, wall) {
    for (let i = 0; i < TIMERS.length; i++) {
      const t = TIMERS[i];
      if (t.on) continue;
      t.on = true; t.wall = !!wall; t.at = (t.wall ? clock : gclock) + delay; t.fn = fn;
      if (p) { t.x = p.x; t.y = p.y; t.z = p.z; } else { t.x = NaN; t.y = NaN; t.z = NaN; }
      t.s = s || ''; t.n = n || 0;
      return t;
    }
    return null;
  }
  function runTimers() {
    for (let i = 0; i < TIMERS.length; i++) {
      const t = TIMERS[i];
      if (!t.on || (t.wall ? clock : gclock) < t.at) continue;
      t.on = false;
      const hasPos = fin(t.x);
      tmpT.x = t.x; tmpT.y = t.y; tmpT.z = t.z;
      const fn = t.fn, s = t.s, n = t.n;
      t.fn = null;
      try { fn(hasPos ? tmpT : null, s, n); } catch (e) { warnOnce('timer', e); }
    }
  }  function clearGameTimers() {
    for (let i = 0; i < TIMERS.length; i++) {
      const t = TIMERS[i];
      if (t.on && !t.wall) { t.on = false; t.fn = null; }
    }
    dumpCheck.pending = false;
  }


  // ---------------------------------------------------------------- surfaces
  function surfaceAt(x, z, under, inWater) {
    if (under) return 'tunnel';
    const w = ctx.world;
    if (inWater || w?.isWater?.(x, z)) return 'water';
    const fb = WORLD.firebase;
    let dx = x - fb.x, dz = z - fb.z;
    if (dx * dx + dz * dz < FIREBASE_R2) return 'dirt';
    const h = heightAt(x, z), wl = w?.waterLevel;
    if (h !== null && fin(wl) && h - wl < 1.0) return 'mud';
    const ps = WORLD.playerStart;
    dx = x - ps.x; dz = z - ps.z;
    if (dx * dx + dz * dz < 18 * 18) return 'dirt';
    const cv = w?.coverAt?.(x, z);
    const c = fin(cv) ? cv : 0.5;
    const nz = noise2D(x * 0.08, z * 0.08);
    if (c > 0.45 || nz > 0.2) return 'leaves';
    return nz < -0.35 ? 'mud' : 'grass';
  }
  const STEP_GAIN = { mud: 0.55, leaves: 0.5, grass: 0.4, dirt: 0.5, water: 0.6, tunnel: 0.45 };

  // ---------------------------------------------------------------- sound actions
  function gunKind(weapon, by) {
    const w = typeof weapon === 'string' ? weapon.toLowerCase() : '';
    if (w.includes('m60') || w.includes('mg')) return 'm60';
    if (/m16|m-16|5\.56|xm177|car-?15|m14/.test(w)) return 'm16';
    if (/ak|type ?56|sks|7\.62x39/.test(w)) return 'ak';
    return by === 'player' ? 'ak' : 'm16';
  }

  function playShot(kind, pos, own, weaponGain = 1) {
    if (own) {
      const po = vo(0.82 * weaponGain, 1, 1, 'pshot', 6, 9, 0.38);
      po.rate = 0.985 + R() * 0.03;
      const id = voiceBuf('akPlayer', rv('akPlayer'), null, po);
      // brass tinkle once it lands
      const surf = surfaceAt(L.x, L.z, listenerUnder, P.inWater);
      if (surf !== 'water') {
        const mode = surf === 'tunnel' ? 2 : surf === 'dirt' ? 0 : 1;
        const o = vo(mode === 0 ? 0.16 : 0.12, 1, 1, 'shell', 4, 2, 0.08);
        o.at = 0.32 + R() * 0.25; o.rate = 0.9 + R() * 0.2;
        voiceBuf('shell', mode * 3 + Math.floor(R() * 3), null, o);
      }
      hush = Math.min(1, hush + 0.3);
      return id;
    }
    const key = kind === 'ak' ? 'ak' : kind === 'm60' ? 'm60' : 'm16';
    const o = vo((kind === 'm60' ? 1.15 : 1.0) * weaponGain, 12, 1, 'shot', 14, 7, 0.32);
    o.hrtf = true; o.rate = 0.97 + R() * 0.06;
    const id = voiceBuf(key, rv(key), pos, o);
    if (pos) {
      const dx = pos.x - L.x, dz = pos.z - L.z;
      if (dx * dx + dz * dz < 250 * 250) hush = Math.min(1, hush + 0.22);
    }
    return id;
  }

  function nearMiss(pos, dir) {
    if (!pos || !dir || listenerUnder) return;
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    if (!(dl > 0)) return;
    const ux = dir.x / dl, uy = dir.y / dl, uz = dir.z / dl;
    const vx = L.x - pos.x, vy = L.y - pos.y, vz = L.z - pos.z;
    const t = vx * ux + vy * uy + vz * uz;
    if (t < 6 || t > 400) return;
    const cx = pos.x + ux * t, cy = pos.y + uy * t, cz = pos.z + uz * t;
    const perp = Math.hypot(L.x - cx, L.y - cy, L.z - cz);
    if (perp > 3.5) return;
    tmpB.x = cx; tmpB.y = cy; tmpB.z = cz;
    const o = vo(0.75 * (1 - perp / 3.5) + 0.15, 2, 1, 'whiz', 3, 8, 0.1);
    o.hrtf = true; o.delay = false; o.at = t / 900; o.rate = 0.9 + R() * 0.2; o.under = false;
    voiceBuf('whiz', rv('whiz'), tmpB, o);
  }

  function playExplosion(pos, radius, damage) {
    const big = radius >= 12 || damage >= 250;
    const key = big ? 'explosionBig' : 'explosion';
    const o = vo(big ? 1.6 : 1.25, big ? 60 : 25, 1, 'boom', 6, 10, 0.55);
    o.hrtf = true; o.rate = 0.92 + R() * 0.16;
    if (!pos) { voiceBuf(key, rv(key), null, o); shock(0.6, ac.currentTime); return; }
    voiceBuf(key, rv(key), pos, o);
    const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const srcUnder = isUnder(pos), cross = srcUnder !== listenerUnder;
    let k = clamp(1 - d / (radius * 3.5 + 8), 0, 1);
    if (cross) k *= 0.5; else if (srcUnder && listenerUnder) k = Math.min(1, k * 1.4); // enclosed blast
    const arrive = ac.currentTime + (d > 20 ? d / SPEED_OF_SOUND : 0);
    if (k > 0.03) shock(k, arrive + 0.06);
    if (listenerUnder && !srcUnder && d < 70) {
      // dust and clods shaken loose from the tunnel ceiling
      const o2 = vo(0.35 * (1 - d / 70) + 0.1, 1, 1, 'dig', 3, 5, 0.6);
      o2.at = (d > 20 ? d / SPEED_OF_SOUND : 0) + 0.15; o2.under = true; o2.rate = 0.9 + R() * 0.2;
      voiceBuf('dirtFall', rv('dirtFall'), null, o2);
    }
    lastBoom.t = clock; lastBoom.x = pos.x; lastBoom.z = pos.z; lastBoom.big = big;
    if (d < 400) hush = 1;
  }

  function playerStep(surf, gainMul) {
    const pl = ctx.player;
    const st = pl?.stance || 'stand';
    let k = st === 'prone' ? 0.45 : st === 'crouch' ? 0.55 : P.speed > 4.3 ? 1.35 : 1;
    if (listenerUnder) k = 0.8;
    const key = 'step_' + surf;
    const o = vo((STEP_GAIN[surf] || 0.5) * k * 0.62 * gainMul, 1, 1, 'pfoot', 3, 6, listenerUnder ? 0.35 : 0.06);
    o.rate = (st === 'prone' ? 0.85 : 1) * (0.92 + R() * 0.16);
    const id = voiceBuf(key, rv(key), null, o);
    if (!listenerUnder && (st === 'stand' && P.speed > 4.3) && R() < 0.25) {
      const g = vo(0.12, 1, 1, 'gear', 2, 2, 0.02); g.rate = 0.9 + R() * 0.2; g.at = 0.05;
      voiceBuf('gear', rv('gear'), null, g);
    }
    return id;
  }
  function enemyStep(pos, speed, surf, gainMul = 1) {
    const s = surf || surfaceAt(pos.x, pos.z, false, false);
    const key = 'step_' + s;
    const o = vo((STEP_GAIN[s] || 0.5) * (speed > 3 ? 1.25 : 0.85) * gainMul, 3, 1.4, 'efoot', 5, 3, 0.12);
    o.rate = 0.9 + R() * 0.18; o.delay = false;
    const id = voiceBuf(key, rv(key), pos, o);
    if (R() < 0.12) {
      const g = vo(0.22, 3, 1.4, 'gear', 3, 2, 0.05); g.rate = 0.9 + R() * 0.2; g.at = 0.04; g.delay = false;
      voiceBuf('gear', rv('gear'), pos, g);
    }
    return id;
  }
  function land() {
    const surf = surfaceAt(P.x, P.z, false, P.inWater);
    const o = vo((STEP_GAIN[surf] || 0.5) * 1.2, 1, 1, 'pfoot', 3, 7, 0.08); o.rate = 0.75;
    voiceBuf('step_' + surf, rv('step_' + surf), null, o);
    const g = vo(0.2, 1, 1, 'gear', 2, 3, 0.03); g.at = 0.03;
    voiceBuf('gear', rv('gear'), null, g);
  }

  function playShout(pos, phrase, gainMul = 1) {
    const key = 'sh_' + (PHRASES[phrase] ? phrase : 'contact');
    const o = vo(1.1 * gainMul, 6, 1, 'voice', 3, 7, 0.38);
    o.hrtf = true; o.rate = 0.95 + R() * 0.1;
    return voiceBuf(key, rv(key), pos, o);
  }
  // Pick an alive enemy within maxD (nearest, or random) and write its head position into out.
  function pickEnemy(maxD, random, out) {
    const list = ctx.enemies?.list;
    if (!list || !list.length) return false;
    let best = null, bd = maxD * maxD, cnt = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !aliveOf(e)) continue;
      const p = posOf(e);
      if (!p) continue;
      const dx = p.x - L.x, dz = p.z - L.z, d2 = dx * dx + dz * dz;
      if (d2 > maxD * maxD) continue;
      if (random) { cnt++; if (R() * cnt < 1) best = p; }
      else if (d2 < bd) { bd = d2; best = p; }
    }
    if (!best) return false;
    out.x = best.x; out.y = (fin(best.y) ? best.y : 0) + 1.6; out.z = best.z;
    return true;
  }
  function tmShout(p, phrase) { if (p) playShout(p, phrase); }
  function enemyShout(phrase, maxD, delay, random) {
    if (!pickEnemy(maxD, random, tmpE)) return;
    schedule(delay, tmShout, tmpE, phrase);
  }

  function playBounce(pos, speed) {
    const sp = fin(speed) ? speed : 5;
    const o = vo(clamp(0.25 + sp * 0.08, 0.2, 0.9), 3, 1.2, 'bounce', 4, 6, 0.15);
    o.rate = 0.9 + R() * 0.2; o.delay = false;
    const id = voiceBuf('bounce', rv('bounce'), pos, o);
    if (pos && clock - lastGrenadeShout > 2.5 && clock - extShoutAt > 2) {
      // a soldier near the landing point sees it
      const list = ctx.enemies?.list;
      if (list && list.length) {
        let best = null, bd = 15 * 15;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e || !aliveOf(e)) continue;
          const p = posOf(e);
          if (!p) continue;
          const dx = p.x - pos.x, dz = p.z - pos.z, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = p; }
        }
        if (best) {
          lastGrenadeShout = clock;
          tmpE.x = best.x; tmpE.y = best.y + 1.6; tmpE.z = best.z;
          schedule(0.15 + R() * 0.25, tmShout, tmpE, 'grenade');
        }
      }
    }
    return id;
  }

  function digScrape(pos) {
    const o = vo(0.6, 2, 1, 'dig', 3, 6, listenerUnder ? 0.45 : 0.12);
    o.rate = 0.9 + R() * 0.2;
    return voiceBuf('dig', rv('dig'), pos, o);
  }

  // ---- satchel fuse ticking
  function startFuse(pos, dur) {
    if (pos && finite3(pos)) { fuse.x = pos.x; fuse.y = pos.y; fuse.z = pos.z; }
    else guessChargePos(fuse);
    fuse.on = true; fuse.end = gclock + (fin(dur) && dur > 0 ? dur : 10); fuse.next = gclock; fuse.n = 0; fuse.setAt = gclock;
    fuse.synced = false;
    syncFuse();
  }
  function guessChargePos(out) {
    const ad = WORLD.ammoDump;
    const pp = ctx.player?.position;
    if (pp && Math.hypot(pp.x - ad.x, pp.z - ad.z) > 25) { out.x = pp.x; out.y = pp.y + 0.3; out.z = pp.z; return; }
    out.x = ad.x; out.z = ad.z; out.y = (heightAt(ad.x, ad.z) ?? 0) + 0.6;
  }
  // weapons.js owns the real countdown: follow it whenever it is exposed
  function syncFuse() {
    const w = ctx.weapons;
    if (!w) return;
    const left = w.satchelFuse;
    if (w.satchelPlanted === true && fin(left) && left >= 0) {
      fuse.end = gclock + left;
      fuse.synced = true;
    } else if (fuse.synced && w.satchelPlanted === false) {
      fuse.on = false; // detonated, defused or reset
      fuse.synced = false;
    }
  }
  function updateFuse() {
    if (!fuse.on) return;
    syncFuse();
    if (!fuse.on) return;
    if (gclock > fuse.end + 0.3) { fuse.on = false; return; }
    if (gclock < fuse.next) return;
    const rem = fuse.end - gclock;
    tmpA.x = fuse.x; tmpA.y = fuse.y; tmpA.z = fuse.z;
    const o = vo(rem < 2 ? 0.7 : 0.55, 3, 1.2, 'tick', 2, 8, 0.1);
    o.delay = false;
    voiceBuf('tick', fuse.n++ & 1, tmpA, o);
    fuse.next = gclock + (rem > 4 ? 1.0 : rem > 2 ? 0.5 : rem > 0.8 ? 0.25 : 0.125);
  }

  // ---- live birdsong (oscillators with scheduled pitch sweeps)
  const NOTES = [];
  for (let i = 0; i < 32; i++) NOTES.push({ t: 0, d: 0, f0: 0, f1: 0, a: 0 });
  let nNotes = 0;
  function note(t, d, f0, f1, a) {
    if (nNotes >= NOTES.length) return;
    const n = NOTES[nNotes++];
    n.t = t; n.d = d; n.f0 = f0; n.f1 = f1; n.a = a;
  }
  const BIRDS = ['whistle', 'whistle', 'chatter', 'koel', 'barbet', 'coucal', 'trill', 'chatter'];
  function birdPattern(type) {
    nNotes = 0;
    let t = 0, last = 0;
    switch (type) {
      case 'whistle': {
        const k = 2 + Math.floor(R() * 4), base = 1800 + R() * 1800;
        for (let i = 0; i < k; i++) {
          const d = 0.08 + R() * 0.17, f0 = base * (0.85 + R() * 0.3);
          note(t, d, f0, f0 * (R() < 0.5 ? 0.65 + R() * 0.2 : 1.15 + R() * 0.35), 0.7 + R() * 0.3);
          last = d; t += d + 0.04 + R() * 0.1;
        }
        break;
      }
      case 'koel': {
        const reps = 3 + Math.floor(R() * 3);
        let f = 700 + R() * 150;
        for (let i = 0; i < reps; i++) {
          note(t, 0.12, f, f * 1.08, 0.8);
          note(t + 0.16, 0.3, f * 1.12, f * 1.45, 1);
          last = 0.46; t += 0.75 + R() * 0.15; f *= 1.06;
        }
        break;
      }
      case 'barbet': {
        const n = 5 + Math.floor(R() * 7), f = 850 + R() * 250, iv = 0.33 + R() * 0.12;
        for (let i = 0; i < n; i++) { note(t, 0.05, f, f * 0.95, 0.9); last = 0.05; t += iv; }
        break;
      }
      case 'coucal': {
        const n = 6 + Math.floor(R() * 5);
        let f = 520 + R() * 80;
        for (let i = 0; i < n; i++) { note(t, 0.14, f, f * 0.92, 1); last = 0.14; t += 0.2; f *= 0.97; }
        break;
      }
      case 'trill': {
        const d = 0.5 + R() * 0.6, f = 3200 + R() * 1600;
        note(0, d, f, f * 0.8, 1); last = d; t = d;
        break;
      }
      default: { // chatter
        const n = 6 + Math.floor(R() * 9);
        for (let i = 0; i < n; i++) {
          const d = 0.04 + R() * 0.04, f0 = 1500 + R() * 1900;
          note(t, d, f0, f0 * (0.6 + R() * 0.8), 0.6 + R() * 0.4);
          last = d; t += d + 0.02 + R() * 0.03;
        }
      }
    }
    return nNotes ? NOTES[nNotes - 1].t + last + 0.05 : 0;
  }
  function spawnBird(pos) {
    if (!live()) return 0;
    const type = BIRDS[Math.floor(R() * BIRDS.length)];
    if (!pos) {
      const a = R() * TAU, d = 14 + R() * 56;
      tmpA.x = L.x + Math.cos(a) * d; tmpA.z = L.z + Math.sin(a) * d; tmpA.y = L.y + 6 + R() * 18;
      pos = tmpA;
    }
    const total = birdPattern(type);
    if (!(total > 0)) return 0;
    const osc = ac.createOscillator();
    osc.type = type === 'barbet' || type === 'coucal' ? 'triangle' : 'sine';
    const low = type === 'coucal' || type === 'barbet' || type === 'koel';
    const o = vo((low ? 0.3 : 0.2) * (0.6 + R() * 0.4), 10, 1, 'bird', 5, 1, 0.45);
    o.dur = total + 0.1; o.delay = false; o.under = false;
    const id = voiceSrc(osc, null, pos, o);
    if (!id) { try { osc.disconnect(); } catch (e) { /* noop */ } return 0; }
    const s = lastStrip, w = lastWhen;
    const fq = osc.frequency, env = s.env.gain;
    env.cancelScheduledValues(ac.currentTime);
    env.setValueAtTime(0, w);
    for (let i = 0; i < nNotes; i++) {
      const n = NOTES[i], t0 = w + n.t;
      fq.setValueAtTime(n.f0, t0);
      fq.exponentialRampToValueAtTime(Math.max(30, n.f1), t0 + n.d);
      env.setValueAtTime(0, t0);
      env.linearRampToValueAtTime(n.a, t0 + Math.min(0.015, n.d * 0.3));
      env.setValueAtTime(n.a, t0 + n.d * 0.7);
      env.linearRampToValueAtTime(0, t0 + n.d);
    }
    if (type === 'trill') {
      const mod = ac.createOscillator(), mg = ac.createGain();
      mod.frequency.value = 18 + R() * 14;
      mg.gain.value = NOTES[0].f0 * 0.12;
      mod.connect(mg); mg.connect(fq);
      mod.start(w); mod.stop(w + total + 0.1);
      s.extra.push(mod, mg);
    }
    return id;
  }

  // ---- firebase alarm siren
  function startSiren(pos) {
    if (!live()) return 0;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    const dur = 24;
    const o = vo(0.55, 40, 1, 'siren', 1, 8, 0.6);
    o.dur = dur; o.lp = 2200; o.hrtf = true; o.under = false;
    const id = voiceSrc(osc, null, pos, o);
    if (!id) { try { osc.disconnect(); } catch (e) { /* noop */ } return 0; }
    const s = lastStrip, w = lastWhen, f = osc.frequency, env = s.env.gain;
    f.setValueAtTime(260, w);
    for (let t = w; t < w + dur - 4; t += 4.2) {
      f.linearRampToValueAtTime(720, t + 2.6);
      f.linearRampToValueAtTime(380, t + 4.2);
    }
    env.cancelScheduledValues(ac.currentTime);
    env.setValueAtTime(0.0001, w);
    env.linearRampToValueAtTime(1, w + 2);
    env.setValueAtTime(1, w + dur - 3);
    env.linearRampToValueAtTime(0.0001, w + dur);
    return id;
  }

  // ---- dump destroyed: cook-off, fire, alarm
  function tmCook(p, kind) {
    if (!p) return;
    const key = kind === 'pop' ? 'impact' : kind;
    const o = vo(kind === 'pop' ? 1.2 : 0.75, 10, 1, 'cook', 6, 4, 0.45);
    o.rate = 0.75 + R() * 0.6;
    voiceBuf(key, rv(key), p, o);
  }
  function tmSecondary(p) {
    if (!p) return;
    const o = vo(1.1, 25, 1, 'boom', 6, 9, 0.55);
    o.rate = 1.05 + R() * 0.25; o.hrtf = true;
    voiceBuf('explosion', rv('explosion'), p, o);
    const d = Math.hypot(p.x - L.x, p.z - L.z);
    shock(clamp(1 - d / 40, 0, 1) * 0.6, ac.currentTime + d / SPEED_OF_SOUND);
  }
  function tmSiren(p) { if (p) startSiren(p); }
  function tmDumpCheck() {
    dumpCheck.pending = false;
    const ad = WORLD.ammoDump;
    if (clock - lastBoom.t < 0.6 && Math.hypot(lastBoom.x - ad.x, lastBoom.z - ad.z) < 30) return;
    tmpA.x = ad.x; tmpA.z = ad.z; tmpA.y = (heightAt(ad.x, ad.z) ?? 0) + 1;
    playExplosion(tmpA, 20, 400);
  }
  function onDump() {
    fuse.on = false;
    const ad = WORLD.ammoDump;
    tmpA.x = ad.x; tmpA.z = ad.z; tmpA.y = (heightAt(ad.x, ad.z) ?? 0) + 1;
    if (!dumpCheck.pending) { dumpCheck.pending = true; schedule(0.2, tmDumpCheck, null); }
    const kinds = ['m16', 'm16', 'ak', 'pop', 'm60', 'pop'];
    for (let k = 0; k < 28; k++) {
      tmpB.x = tmpA.x + (R() - 0.5) * 6; tmpB.y = tmpA.y + R() * 2; tmpB.z = tmpA.z + (R() - 0.5) * 6;
      schedule(0.8 + Math.pow(R(), 0.7) * 9, tmCook, tmpB, kinds[Math.floor(R() * kinds.length)]);
    }
    for (let k = 0; k < 3; k++) {
      tmpB.x = tmpA.x + (R() - 0.5) * 8; tmpB.y = tmpA.y; tmpB.z = tmpA.z + (R() - 0.5) * 8;
      schedule(1.5 + R() * 6, tmSecondary, tmpB);
    }
    const o = vo(0.9, 8, 1, 'fire', 1, 6, 0.3);
    o.loop = true; o.dur = 75; o.fadeIn = 1.5; o.delay = false;
    voiceBuf('fire', 0, tmpA, o);
    schedule(2.5, tmSiren, firebasePos(tmpB));
    hush = 1;
  }

  // ---- distant war: artillery, arc-light strikes, far firefights
  function farPos(minD, maxD, out) {
    const a = R() * TAU, d = minD + R() * (maxD - minD);
    out.x = L.x + Math.cos(a) * d; out.z = L.z + Math.sin(a) * d; out.y = L.y + 20;
    return out;
  }
  function tmArtillery(p, s, n) {
    if (!p) return;
    const o = vo(n > 0 ? 2.6 : 3.0, 30, 1, 'far', 6, 1, 0.9);
    o.delay = false; o.under = false; o.rate = 0.7 + R() * 0.3;
    if (n > 0) o.lp = 220;
    voiceBuf('explosion', rv('explosion'), p, o);
  }
  function tmFarShot(p, kind) {
    if (!p) return;
    const o = vo(kind === 'm60' ? 2.4 : 2.0, 12, 1, 'far', 6, 1, 0.7);
    o.delay = false; o.under = false; o.rate = 0.95 + R() * 0.1;
    voiceBuf(kind, rv(kind), p, o);
  }
  function distantFight() {
    farPos(700, 1300, tmpA);
    const bursts = 4 + Math.floor(R() * 8);
    let t = 0;
    for (let b = 0; b < bursts; b++) {
      const kind = R() < 0.45 ? 'm16' : R() < 0.6 ? 'ak' : 'm60';
      const shots = kind === 'm60' ? 4 + Math.floor(R() * 6) : 1 + Math.floor(R() * 5);
      const iv = kind === 'm60' ? 0.1 : 0.09 + R() * 0.25;
      tmpB.x = tmpA.x + (R() - 0.5) * 60; tmpB.y = tmpA.y; tmpB.z = tmpA.z + (R() - 0.5) * 60;
      for (let s = 0; s < shots; s++) schedule(t + s * iv, tmFarShot, tmpB, kind, 0, true);
      t += shots * iv + 0.2 + R() * 1.2;
    }
  }

  // ---------------------------------------------------------------- ambience layers
  const LAYERS = [
    ['c0', 'cicada', 0, true, 'amb', 1.0], ['c1', 'cicada', 1, true, 'amb', 1.0],
    ['c2', 'cicada', 2, true, 'amb', 1.0], ['c3', 'cicada', 0, true, 'amb', 0.94],
    ['wind', 'wind', 0, false, 'amb', 1.0], ['lv0', 'leaves', 0, true, 'amb', 1.0], ['lv1', 'leaves', 0, true, 'amb', 0.9],
    ['frog', 'frogs', 0, true, 'amb', 1.0], ['river', 'river', 0, true, 'amb', 1.0],
    ['wade', 'river', 0, false, 'open', 1.25], ['room', 'room', 0, false, 'master', 1.0],
  ];
  const CIC_BASE = [0.07, 0.045, 0.03, 0.05];
  const CIC_NAMES = ['c0', 'c1', 'c2', 'c3'];
  const layers = {};
  let layersStarted = 0;
  function startLayers() {
    if (layersStarted >= LAYERS.length) return;
    for (let i = 0; i < LAYERS.length; i++) {
      const def = LAYERS[i];
      const name = def[0], key = def[1], v = def[2], positional = def[3], dest = def[4], rate = def[5];
      if (layers[name]) continue;
      const buf = peekBuffer(key, v);
      if (!buf) continue;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
      const gain = ac.createGain(); gain.gain.value = 0;
      src.connect(gain);
      const out = dest === 'amb' ? G.ambIn : dest === 'open' ? G.open : G.master;
      let pan = null;
      if (positional) { pan = makePanner('equalpower'); gain.connect(pan); pan.connect(out); setPannerPos(pan, L.x, L.y, L.z); }
      else gain.connect(out);
      src.start(ac.currentTime + 0.05, R() * buf.duration * 0.9);
      layers[name] = { src, gain, pan };
      layersStarted++;
    }
  }
  function layerGain(name, v, now, tau = 0.35) {
    const l = layers[name];
    if (l) l.gain.gain.setTargetAtTime(fin(v) ? Math.max(0, v) : 0, now, tau);
  }
  function layerPos(name, x, y, z) { const l = layers[name]; if (l && l.pan) setPannerPos(l.pan, x, y, z); }

  function sampleWater() {
    const w = ctx.world;
    if (!w?.isWater) { water.prox = 0; return; }
    for (let k = 0; k < 4; k++) {
      const idx = water.idx++;
      const ring = idx >> 3, dir = idx & 7;
      const a = dir * (TAU / 8) + water.rot + ring * 0.39, rr = WS_R[ring];
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      if (w.isWater(x, z)) {
        water.acc += WS_W[ring];
        if (rr < water.best) { water.best = rr; water.bx = x; water.bz = z; }
      }
      if (water.idx >= 32) {
        let prox = clamp(water.acc / 6, 0, 1);
        if (P.inWater) prox = 1;
        water.prox = prox;
        water.found = water.best < Infinity;
        if (water.found) { water.px = water.bx; water.pz = water.bz; }
        water.idx = 0; water.acc = 0; water.best = Infinity; water.rot += 0.37;
        break;
      }
    }
  }

  function ambTick() {
    const now = ac.currentTime, t = clock;
    startLayers();
    if (ctx.world?.coverAt && clock >= T.coverAt) {
      T.coverAt = clock + 0.5;
      const cv = ctx.world.coverAt(L.x, L.z);
      if (fin(cv)) coverL = clamp(cv, 0, 1);
    }
    const wash = H.on && H.lastD >= 0 ? clamp(1 - H.lastD / 45, 0, 1) : 0;
    const gust = clamp(0.45 + 0.4 * noise2D(t * 0.05, 7.7) + 0.25 * noise2D(t * 0.21, 1.3), 0, 1.2);
    const quiet = 1 - 0.8 * hush;
    for (let k = 0; k < 4; k++) {
      const sw = 0.5 + 0.5 * noise2D(t * 0.04 + k * 17.3, k * 3.1 + 0.5);
      layerGain(CIC_NAMES[k], CIC_BASE[k] * (0.35 + 0.65 * sw) * quiet, now, 0.6);
      const a = k * 1.57 + t * 0.011 * (k % 2 ? -1 : 1), rr = 14 + 7 * k;
      layerPos(CIC_NAMES[k],L.x + Math.cos(a) * rr, L.y + 5 + k, L.z + Math.sin(a) * rr);
    }
    layerGain('wind', 0.05 + 0.1 * gust + 0.4 * wash, now, 0.5);
    const lv = (0.03 + 0.14 * gust * gust) * (0.35 + 0.65 * coverL) + 0.3 * wash;
    layerGain('lv0', lv, now, 0.4);
    layerGain('lv1', lv * 0.8, now, 0.4);
    const la = t * 0.02;
    layerPos('lv0', L.x + Math.cos(la) * 7, L.y + 2.5, L.z + Math.sin(la) * 7);
    layerPos('lv1', L.x - Math.cos(la) * 7, L.y + 2.5, L.z - Math.sin(la) * 7);
    if (water.found) {
      const k = 0.15;
      water.fx += (water.px - water.fx) * k; water.fz += (water.pz - water.fz) * k;
      if (Math.abs(water.fx - water.px) > 80 || Math.abs(water.fz - water.pz) > 80) { water.fx = water.px; water.fz = water.pz; }
      const wl = ctx.world?.waterLevel;
      const wy = fin(wl) ? wl : L.y - 1.6;
      layerPos('frog', water.fx, wy + 0.3, water.fz);
      layerPos('river', water.fx, wy, water.fz);
    }
    layerGain('frog', 0.2 * water.prox * (1 - 0.65 * hush), now, 0.8);
    layerGain('river', 0.16 * Math.pow(water.prox, 1.4) + (P.inWater ? 0.05 : 0), now, 0.6);
    layerGain('wade', P.inWater && !listenerUnder ? clamp(P.speed / 3, 0, 1) * 0.3 : 0, now, 0.15);
    layerGain('room', listenerUnder ? 0.2 : 0, now, 0.4);
  }

  function updateAmbienceEvents(dt) {
    if (!listenerUnder) {
      T.bird -= dt;
      if (T.bird <= 0) {
        T.bird = 1.0 + R() * 4.0 + 6 * hush;
        if (hush < 0.7 && R() > hush) spawnBird(null);
      }
      T.gibbon -= dt;
      if (T.gibbon <= 0) {
        T.gibbon = 45 + R() * 75;
        if (hush < 0.3) { farPos(120, 250, tmpA); tmpA.y = L.y + 25; const o = vo(SFX.gibbon.gain, 30, 1, 'call', 2, 1, 0.9); o.delay = false; o.under = false; o.rate = 0.95 + R() * 0.1; voiceBuf('gibbon', rv('gibbon'), tmpA, o); }
      }
      T.gecko -= dt;
      if (T.gecko <= 0) {
        T.gecko = 30 + R() * 60;
        if (hush < 0.4) { farPos(15, 40, tmpA); tmpA.y = L.y + 3; const o = vo(SFX.gecko.gain, 8, 1, 'call', 2, 1, 0.5); o.delay = false; o.under = false; voiceBuf('gecko', rv('gecko'), tmpA, o); }
      }
    } else {
      T.drip -= dt;
      if (T.drip <= 0) {
        T.drip = 2.5 + R() * 5;
        const a = R() * TAU, d = 1 + R() * 2.5;
        tmpA.x = L.x + Math.cos(a) * d; tmpA.z = L.z + Math.sin(a) * d; tmpA.y = L.y + 0.2;
        const o = vo(SFX.drip.gain * (0.5 + R() * 0.5), 2, 1, 'drip', 3, 1, 0.8);
        o.under = true; o.delay = false; o.rate = 0.85 + R() * 0.35;
        voiceBuf('drip', rv('drip'), tmpA, o);
      }
      T.trickle -= dt;
      if (T.trickle <= 0) {
        T.trickle = 9 + R() * 16;
        const o = vo(0.07, 1, 1, 'dig', 3, 1, 0.6); o.under = true; o.rate = 1.2 + R() * 0.3;
        voiceBuf('dirtFall', rv('dirtFall'), null, o);
      }
    }
    // the war elsewhere (heard above and, faintly, below)
    T.art -= dt;
    if (T.art <= 0) { T.art = 50 + R() * 100; schedule(0, tmArtillery, farPos(1200, 2000, tmpA), '', 0, true); }
    T.arc -= dt;
    if (T.arc <= 0) {
      T.arc = 200 + R() * 220;
      farPos(2600, 3400, tmpA);
      const a = R() * TAU, n = 8 + Math.floor(R() * 7);
      let t = 0;
      for (let i = 0; i < n; i++) {
        tmpB.x = tmpA.x + Math.cos(a) * i * 40; tmpB.y = tmpA.y; tmpB.z = tmpA.z + Math.sin(a) * i * 40;
        schedule(t, tmArtillery, tmpB, '', 1, true);
        t += 0.25 + R() * 0.25;
      }
    }
    T.fight -= dt;
    if (T.fight <= 0) { T.fight = 80 + R() * 140; if (alertLevel < 2) distantFight(); }
    // voices (the soldiers are frozen while the game is paused)
    if (!simOn) return;
    if (alertLevel === 2) {
      T.chatter -= dt;
      if (T.chatter <= 0) {
        T.chatter = 3 + R() * 6;
        if (clock - extShoutAt > 3 && pickEnemy(100, true, tmpE)) playShout(tmpE, COMBAT_PHRASES[Math.floor(R() * COMBAT_PHRASES.length)]);
      }
    } else if (alertLevel === 0) {
      T.murmur -= dt;
      if (T.murmur <= 0) {
        T.murmur = 12 + R() * 25;
        if (pickEnemy(35, false, tmpE)) {
          const key = R() < 0.35 ? 'radio' : 'murmur';
          const d = SFX[key], o = vo(d.gain, d.ref, d.roll, d.cat, d.cap, d.prio, d.send);
          o.rate = 0.97 + R() * 0.06;
          voiceBuf(key, rv(key), tmpE, o);
        } else {
          const fb = WORLD.firebase;
          if (Math.hypot(L.x - fb.x, L.z - fb.z) < fb.radius + 40) {
            tmpE.x = fb.x + (R() - 0.5) * fb.radius; tmpE.z = fb.z + (R() - 0.5) * fb.radius;
            tmpE.y = (heightAt(tmpE.x, tmpE.z) ?? L.y) + 1.5;
            const o = vo(SFX.radio.gain, 5, 1.2, 'voice', 3, 3, 0.25);
            voiceBuf('radio', rv('radio'), tmpE, o);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- player & enemy tracking
  function trackPlayer(dt, audible) {
    const pl = ctx.player;
    const pos = pl?.position;
    if (!pos || !fin(pos.x)) return;
    if (!P.init) { P.x = pos.x; P.y = pos.y; P.z = pos.z; P.init = true; return; }
    const dx = pos.x - P.x, dz = pos.z - P.z, dy = pos.y - P.y;
    P.x = pos.x; P.y = pos.y; P.z = pos.z;
    P.inWater = typeof pl.inWater === 'boolean' ? pl.inWater : !!ctx.world?.isWater?.(pos.x, pos.z);
    const m = Math.sqrt(dx * dx + dz * dz);
    if (m > 4 || !(dt > 0)) { P.acc = 0; P.fall = 0; P.speed = 0; return; }
    P.speed += (m / dt - P.speed) * Math.min(1, dt * 8);
    if (!audible || pl.alive === false) { P.acc = 0; return; }
    const vy = dy / dt;
    if (vy < -3) P.fall = Math.max(P.fall, -vy);
    else { if (P.fall > 5 && !listenerUnder) land(); P.fall = 0; }
    if (extSteps) return;
    P.acc += m;
    const st = pl.stance || 'stand';
    const stride = listenerUnder ? 0.6 : st === 'prone' ? 0.55 : st === 'crouch' ? 0.62 : P.speed > 4.3 ? 1.05 : 0.78;
    if (P.acc >= stride && P.speed > 0.35) {
      P.acc = 0;
      playerStep(surfaceAt(pos.x, pos.z, listenerUnder, P.inWater), 1);
    }
  }
  function trackEnemies(dt) {
    const list = ctx.enemies?.list;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || typeof e !== 'object') continue;
      const p = posOf(e);
      if (!p) continue;
      let st = eState.get(e);
      if (!st) { st = { x: p.x, z: p.z, acc: R() * 0.7 }; eState.set(e, st); continue; }
      const dx = p.x - st.x, dz = p.z - st.z;
      st.x = p.x; st.z = p.z;
      if (!aliveOf(e)) continue;
      const m = Math.sqrt(dx * dx + dz * dz);
      if (m > 3) continue;
      const lx = p.x - L.x, lz = p.z - L.z;
      if (lx * lx + lz * lz > 30 * 30) { st.acc = 0; continue; }
      st.acc += m;
      const speed = m / Math.max(dt, 1e-3);
      const stride = speed > 3 ? 1.1 : 0.75;
      if (st.acc >= stride) {
        st.acc -= stride;
        if (st.acc > stride) st.acc = 0;
        enemyStep(p, speed, null, 1);
      }
    }
  }

  function updateBody(dt) {
    const pl = ctx.player;
    if (!pl || pl.alive === false || over) return;
    const hp = fin(pl.health) ? pl.health : 100;
    if (hp > 0 && hp < 35) {
      T.heart -= dt;
      if (T.heart <= 0) {
        const k = 1 - hp / 35;
        T.heart = 60 / (68 + 62 * k);
        const o = vo(0.3 + 0.5 * k, 1, 1, 'body', 2, 9, 0);
        o.under = listenerUnder;
        voiceBuf('heart', 0, null, o);
      }
    } else T.heart = 0;
    const sta = fin(pl.stamina) ? pl.stamina : 100;
    const exert = sta < 25 ? (25 - sta) / 25 : 0;
    const g = Math.max(exert * 0.4, listenerUnder ? 0.09 : 0);
    if (g > 0.01) {
      T.breath -= dt;
      if (T.breath <= 0) {
        T.breathIn = !T.breathIn;
        const per = lerp(1.9, 0.75, exert);
        T.breath = per * (T.breathIn ? 0.45 : 0.55);
        const key = T.breathIn ? 'breathIn' : 'breathOut';
        const o = vo(g, 1, 1, 'breath', 1, 4, listenerUnder ? 0.3 : 0.05);
        o.under = listenerUnder; o.rate = 0.95 + R() * 0.1;
        voiceBuf(key, rv(key), null, o);
      }
    }
  }

  // ---------------------------------------------------------------- helicopter
  const H = { obj: null, on: false, src: null, filt: null, gain: null, pan: null, send: null,
    lastD: -1, vr: 0, acc: 0, poll: 0, offAt: 0, x: 0, y: 0, z: 0 };
  function heliCandidate() {
    if (heliOverride !== undefined) return heliOverride;
    const e = ctx.enemies;
    return e?.helicopter ?? e?.heli ?? e?.huey ?? null;
  }
  function heliActive(o) {
    if (!o || typeof o !== 'object') return false;
    if (o.active === false || o.alive === false || o.dead) return false;
    if (typeof o.state === 'string' && /^(off|idle|parked|done|hidden|gone|inactive)$/.test(o.state)) return false;
    if (typeof o.rotorSpeed === 'number' && o.rotorSpeed <= 0.02) return false;
    const vis = o.visible ?? o.group?.visible ?? o.mesh?.visible ?? o.root?.visible;
    return vis !== false;
  }
  function heliStart() {
    const buf = getBuffer('heli', 0);
    if (!buf) return;
    H.src = ac.createBufferSource(); H.src.buffer = buf; H.src.loop = true;
    H.filt = lowpass(800, 0.5);
    H.gain = gainNode(0);
    H.pan = makePanner('HRTF');
    H.send = gainNode(0.3, G.verbSend);
    H.src.connect(H.filt); H.filt.connect(H.gain); H.gain.connect(H.pan); H.pan.connect(G.open); H.pan.connect(H.send);
    setPannerPos(H.pan, H.x, H.y, H.z);
    H.src.start(ac.currentTime + 0.02, R() * buf.duration);
    H.on = true; H.lastD = -1; H.vr = 0; H.acc = 1; H.offAt = 0;
  }
  function heliStop() {
    if (H.src) { try { H.src.stop(); } catch (e) { /* noop */ } }
    for (const n of [H.src, H.filt, H.gain, H.pan, H.send]) { if (n) { try { n.disconnect(); } catch (e) { /* noop */ } } }
    H.src = H.filt = H.gain = H.pan = H.send = null;
    H.on = false; H.lastD = -1; H.offAt = 0;
  }
  function updateHeli(dt) {
    H.poll -= dt;
    if (H.poll <= 0) { H.poll = 0.25; H.obj = heliCandidate(); }
    const act = heliActive(H.obj) && readWorldPos(H.obj, H);
    if (act && !H.on) heliStart();
    if (!H.on) return;
    const now = ac.currentTime;
    if (!act) {
      if (H.offAt === 0) { H.offAt = clock + 2.2; H.gain.gain.setTargetAtTime(0, now, 0.6); }
      else if (clock > H.offAt) heliStop();
      return;
    }
    if (H.offAt !== 0) { H.offAt = 0; H.acc = 1; }
    setPannerPos(H.pan, H.x, H.y, H.z);
    const dx = H.x - L.x, dy = H.y - L.y, dz = H.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (H.lastD >= 0 && dt > 0) H.vr += (clamp((d - H.lastD) / dt, -120, 120) - H.vr) * Math.min(1, dt * 3);
    H.lastD = d;
    H.acc += dt;
    if (H.acc >= 0.1) {
      H.acc = 0;
      const ref = 35;
      let g = 1.3 * ref / (ref + Math.max(0, d - ref));
      let fc = airCutoff(d, H);
      if (listenerUnder) { g *= 0.45; fc = Math.min(fc, 380); }
      if (muted) g = 0;
      H.gain.gain.setTargetAtTime(g, now, 0.2);
      H.filt.frequency.setTargetAtTime(clamp(fc, 80, 20000), now, 0.2);
      H.src.playbackRate.setTargetAtTime(clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + H.vr), 0.8, 1.25), now, 0.15);
      H.send.gain.setTargetAtTime(listenerUnder ? 0 : 0.25 + Math.min(0.6, d / 300), now, 0.3);
    }
  }
  function setHelicopter(obj) { heliOverride = obj; H.poll = 0; }

  // ---------------------------------------------------------------- event handlers
  function onShot(d) {
    const own = d.by === 'player';
    const pos = finite3(d.pos) ? d.pos : null;
    playShot(gunKind(d.weapon, d.by), own ? null : pos, own, 1);
    if (!own && pos && d.dir) nearMiss(pos, d.dir);
    if (pos && !listenerUnder && clock - lastFlush > 25 && hush < 0.45) {
      const dx = pos.x - L.x, dz = pos.z - L.z;
      if (dx * dx + dz * dz < 150 * 150) {
        lastFlush = clock;
        farPos(18, 35, tmpA); tmpA.y = L.y + 12;
        const o = vo(SFX.flush.gain, 10, 1, 'call', 2, 2, 0.4); o.at = 0.25 + R() * 0.3; o.under = false; o.delay = false;
        voiceBuf('flush', rv('flush'), tmpA, o);
      }
    }
  }
  function onExplosion(d) {
    const pos = finite3(d.pos) ? d.pos : null;
    playExplosion(pos, fin(d.radius) ? d.radius : 6, fin(d.damage) ? d.damage : 0);
    if (pos && fuse.on && Math.hypot(pos.x - fuse.x, pos.z - fuse.z) < 15) fuse.on = false;
    if (pos && alertLevel > 0 && R() < 0.5 && clock - extShoutAt > 2) enemyShout(R() < 0.5 ? 'medic' : 'getdown', 80, 0.8 + R() * 0.8, true);
  }
  function onPlayerHit(d) {
    const dmg = fin(d.damage) ? d.damage : 20;
    const o = vo(0.5, 1, 1, 'pvoice', 1, 8, 0.2); o.rate = 0.95 + R() * 0.1; o.under = listenerUnder;
    voiceBuf('hurt', rv('hurt'), null, o);
    const o2 = vo(clamp(0.3 + dmg / 60, 0.3, 0.9), 1, 1, 'body', 3, 8, 0.1); o2.rate = 1.25 + R() * 0.2; o2.under = listenerUnder;
    voiceBuf('melee', rv('melee'), null, o2);
    if (dmg >= 15) shock(clamp(dmg / 90, 0, 0.55), ac.currentTime);
  }
  function onEnemyKilled(d) {
    const p = finite3(d.pos) ? d.pos : (d.enemy ? posOf(d.enemy) : null);
    if (!p) return;
    tmpA.x = p.x; tmpA.y = (fin(p.y) ? p.y : 0) + 1.5; tmpA.z = p.z;
    if (d.headshot) { const o = vo(SFX.helmet.gain, 5, 1, 'body', 3, 5, 0.25); o.rate = 0.92 + R() * 0.16; voiceBuf('helmet', rv('helmet'), tmpA, o); }
    else if (R() < 0.55) { const o = vo(SFX.scream.gain, 6, 1, 'voice', 3, 6, 0.4); o.hrtf = true; o.at = 0.05; o.rate = 0.92 + R() * 0.16; voiceBuf('scream', rv('scream'), tmpA, o); }
    tmpA.y -= 1.3;
    const o = vo(SFX.bodyfall.gain, 5, 1, 'body', 3, 5, 0.25); o.at = 0.45 + R() * 0.3; o.rate = 0.9 + R() * 0.2;
    voiceBuf('bodyfall', rv('bodyfall'), tmpA, o);
    if (R() < 0.45 && clock - extShoutAt > 2) enemyShout(R() < 0.5 ? 'medic' : 'mandown', 70, 1.1 + R(), true);
  }
  function onAlert(d) {
    const lv = clamp((d && d.level) | 0, 0, 2);
    const prev = alertLevel;
    alertLevel = lv;
    if (!live()) return;
    if (lv === 2 && prev < 2) {
      hush = Math.max(hush, 0.6);
      if (clock - extShoutAt > 3) {
        enemyShout('contact', 140, 0.25 + R() * 0.4, false);
        enemyShout(R() < 0.5 ? 'overthere' : 'charlie', 140, 1.4 + R() * 0.6, true);
      }
      T.chatter = 3 + R() * 3;
    } else if (lv === 1 && prev === 0) {
      if (R() < 0.6 && clock - extShoutAt > 3 && pickEnemy(70, false, tmpE)) {
        const o = vo(0.6, 6, 1, 'voice', 3, 6, 0.3); o.hrtf = true;
        const key = R() < 0.5 ? 'sh_hey' : 'sh_whatwas';
        o.at = 0.3;
        voiceBuf(key, rv(key), tmpE, o);
      }
    }
  }
  function onTunnel(under) {
    setUnderground(under);
    const o = vo(0.55, 1, 1, 'world', 3, 6, 0.3); o.rate = 0.92 + R() * 0.16; o.under = under;
    voiceBuf('hatch', rv('hatch'), null, o);
  }
  function onTunnelDug() {
    const o = vo(0.5, 1, 1, 'dig', 3, 6, 0.5); o.rate = 0.9 + R() * 0.2; o.under = listenerUnder;
    voiceBuf('dirtFall', rv('dirtFall'), null, o);
  }
  function onHatchCreated(d) {
    let pos = null;
    if (d && fin(d.x) && fin(d.z)) { tmpA.x = d.x; tmpA.z = d.z; tmpA.y = (heightAt(d.x, d.z) ?? L.y) + 0.2; pos = tmpA; }
    const o = vo(0.6, 3, 1, 'world', 3, 6, 0.3); o.under = listenerUnder; o.rate = 0.9 + R() * 0.15;
    voiceBuf('hatch', rv('hatch'), pos && Math.hypot(pos.x - L.x, pos.z - L.z) > 3 ? pos : null, o);
    const o2 = vo(0.4, 1, 1, 'dig', 3, 5, 0.4); o2.at = 0.2; o2.under = listenerUnder;
    voiceBuf('dirtFall', rv('dirtFall'), null, o2);
  }
  function onDigProgress(d) {
    const t = fin(d.t) ? d.t : 0;
    if (t <= 0 || t >= 1) return;
    if (clock - T.digLast < 0.36 + R() * 0.1) return;
    T.digLast = clock;
    const o = vo(0.6, 2, 1, 'dig', 3, 6, listenerUnder ? 0.45 : 0.12);
    o.rate = 0.88 + R() * 0.24; o.under = listenerUnder;
    voiceBuf('dig', rv('dig'), null, o);
  }
  function onGameOver(d) {
    over = true;
    fuse.on = false;
    if (!live()) return;
    const now = ac.currentTime;
    if (!d.won) {
      G.master.gain.cancelScheduledValues(now);
      G.master.gain.setTargetAtTime(muted ? 0 : volume * 0.3, now, 1.2);
      G.shock.frequency.cancelScheduledValues(now);
      G.shock.frequency.setTargetAtTime(700, now, 0.8);
    }
  }
  function restore() {
    over = false; hush = 0; fuse.on = false; fuse.synced = false; alertLevel = 0;
    clearGameTimers();
    if (!G) return;
    const now = ac.currentTime;
    G.master.gain.cancelScheduledValues(now); G.master.gain.setTargetAtTime(muted ? 0 : volume, now, 0.3);
    G.shock.frequency.cancelScheduledValues(now); G.shock.frequency.setTargetAtTime(20000, now, 0.3);
    G.duck.gain.cancelScheduledValues(now); G.duck.gain.setTargetAtTime(1, now, 0.2);
  }
  function onMessage(d) {
    const tx = typeof d.text === 'string' ? d.text : '';
    if (!tx || fuse.on || gclock - fuse.setAt < 1.5) return;
    if (/(charge|satchel)[^.]*(planted|set|placed|armed|lit)|planted[^.]*(charge|satchel)|fuse (lit|set|burning)/i.test(tx)) {
      guessChargePos(tmpA);
      startFuse(tmpA, 10);
    }
  }
  function onSatchel(d) {
    const pos = finite3(d.pos) ? d.pos : (fin(d.x) && fin(d.z) ? (tmpA.x = d.x, tmpA.z = d.z, tmpA.y = fin(d.y) ? d.y : (heightAt(d.x, d.z) ?? 0) + 0.5, tmpA) : null);
    const dur = fin(d.fuse) ? d.fuse : fin(d.duration) ? d.duration : fin(d.time) ? d.time : 10;
    startFuse(pos, dur);
  }
  function onBounce(d) { playBounce(finite3(d.pos) ? d.pos : null, d.speed); }
  function onThrow() { const o = vo(SFX.throw.gain, 1, 1, 'melee', 2, 6, 0.1); o.rate = 0.9 + R() * 0.2; voiceBuf('throw', 0, null, o); }
  function onImpact(d) {
    const pos = finite3(d.pos) ? d.pos : null;
    if (!pos) return;
    const s = typeof d.surface === 'string' ? d.surface : typeof d.type === 'string' ? d.type : '';
    const def = /wood|tree|trunk|hut|bamboo/i.test(s) ? SFX.impactWood : /leaf|foliage|plant|bush/i.test(s) ? SFX.impactLeaf : SFX.impact;
    playDef(def, pos, EMPTY);
  }
  function onTrapTriggered(d) {
    const pos = finite3(d.pos) ? d.pos : (fin(d.x) && fin(d.z) ? (tmpA.x = d.x, tmpA.z = d.z, tmpA.y = (heightAt(d.x, d.z) ?? 0) + 0.3, tmpA) : null);
    if (!pos) return;
    playDef(SFX.trapSpring, pos, EMPTY);
    tmpB.x = pos.x; tmpB.y = pos.y + 1.2; tmpB.z = pos.z;
    const o = vo(SFX.scream.gain, 6, 1, 'voice', 3, 7, 0.4); o.hrtf = true; o.at = 0.08;
    voiceBuf('scream', rv('scream'), tmpB, o);
  }
  function onTrapPlaced(d) {
    const pos = fin(d?.x) && fin(d?.z) ? (tmpA.x = d.x, tmpA.z = d.z, tmpA.y = (heightAt(d.x, d.z) ?? L.y) + 0.2, tmpA) : null;
    playDef(SFX.trap, pos && Math.hypot(pos.x - L.x, pos.z - L.z) > 2.5 ? pos : null, EMPTY);
  }
  function onMelee(d) { playDef(d.hit ? SFX.melee : SFX.swing, null, EMPTY); }
  function onHeliEvent(d) {
    if (d.object !== undefined) setHelicopter(d.object);
    else if (d.active === false) setHelicopter(null);
  }

  // Wrap a handler: never throw, skip silently when locked (stateful ones still track).
  function wrap(fn, always) {
    return (d) => {
      if (disposed) return;
      if (!always && !live()) return;
      try { fn(d || EMPTY); } catch (e) { warnOnce('event', e); }
    };
  }
  const HANDLERS = {
    shot: wrap(onShot), explosion: wrap(onExplosion), playerHit: wrap(onPlayerHit), enemyKilled: wrap(onEnemyKilled),
    alert: wrap(onAlert, true), enterTunnel: wrap(() => onTunnelSafe(true), true), exitTunnel: wrap(() => onTunnelSafe(false), true),
    tunnelDug: wrap(onTunnelDug), hatchCreated: wrap(onHatchCreated), digProgress: wrap(onDigProgress),
    dumpDestroyed: wrap(onDump), gameOver: wrap(onGameOver, true), message: wrap(onMessage),
    satchelPlanted: wrap(onSatchel), chargePlanted: wrap(onSatchel),
    grenadeBounce: wrap(onBounce), grenadeThrown: wrap(onThrow),
    reload: wrap(() => play('reload')), dryFire: wrap(() => play('click')), weaponSwitch: wrap(() => play('switch')),
    impact: wrap(onImpact), trapTriggered: wrap(onTrapTriggered), trapPlaced: wrap(onTrapPlaced), melee: wrap(onMelee),
    helicopter: wrap(onHeliEvent, true), restart: wrap(restore, true), newGame: wrap(restore, true),
  };
  function onTunnelSafe(under) {
    if (live()) onTunnel(under);
    else { manualUnder = under; manualHoldUntil = clock + 1.5; listenerUnder = under; }
  }
  for (const k in HANDLERS) ev.on(k, HANDLERS[k]);

  // ---------------------------------------------------------------- public: play
  function playDef(def, pos, o) {
    const g = fin(o.gain) ? o.gain : 1;
    const v = vo(def.gain * g, def.ref, def.roll, def.cat, def.cap, def.prio, def.send);
    v.rate = (def.rate[0] + R() * (def.rate[1] - def.rate[0])) * (fin(o.rate) ? o.rate : 1);
    v.hrtf = !!def.hrtf;
    if (typeof o.under === 'boolean') v.under = o.under;
    if (fin(o.delay)) v.at = o.delay;
    return voiceBuf(def.key, fin(o.variant) ? o.variant : rv(def.key), pos, v);
  }
  function playInner(name, pos, o) {
    switch (name) {
      case 'shot': case 'gunshot': {
        const own = o.by === 'player' || (!pos && !o.by);
        const id = playShot(gunKind(o.weapon, o.by), own ? null : pos, own, fin(o.gain) ? o.gain : 1);
        if (!own && pos && o.dir) nearMiss(pos, o.dir);
        return id;
      }
      case 'explosion': playExplosion(pos, fin(o.radius) ? o.radius : 6, fin(o.damage) ? o.damage : 0); return 1;
      case 'footstep': case 'step': {
        if (!pos || o.player) extSteps = true;
        if (pos && !o.player) return enemyStep(pos, fin(o.speed) ? o.speed : 2, o.surface && GEN['step_' + o.surface] ? o.surface : null, fin(o.gain) ? o.gain : 1);
        const surf = o.surface && GEN['step_' + o.surface] ? o.surface : surfaceAt(L.x, L.z, listenerUnder, P.inWater);
        return playerStep(surf, fin(o.gain) ? o.gain : 1);
      }
      case 'shout': extShoutAt = clock; return playShout(pos, o.phrase || o.text || COMBAT_PHRASES[Math.floor(R() * COMBAT_PHRASES.length)], fin(o.gain) ? o.gain : 1);
      case 'fuse': case 'tick': case 'satchel': startFuse(pos, fin(o.duration) ? o.duration : fin(o.fuse) ? o.fuse : 10); return 1;
      case 'stopFuse': fuse.on = false; return 1;
      case 'helicopter': case 'heli': setHelicopter(o.object ?? o.target ?? null); return 1;
      case 'bird': return spawnBird(pos);
      case 'dig': return digScrape(pos);
      case 'shell': { const mode = listenerUnder ? 2 : 1; const v = vo(0.14, 1, 1, 'shell', 4, 2, 0.08); v.rate = 0.9 + R() * 0.2; return voiceBuf('shell', mode * 3 + Math.floor(R() * 3), pos, v); }
      case 'bounce': case 'grenadeBounce': return playBounce(pos, o.speed);
      case 'siren': case 'alarm': return startSiren(pos || firebasePos(tmpA));
      case 'heartbeat': case 'heart': return playDef(SFX.heartbeat, null, o);
      case 'cookoff': onDump(); return 1;
      default: {
        const def = SFX[name];
        return def ? playDef(def, pos, o) : 0;
      }
    }
  }
  function play(name, pos, opts) {
    if (!live()) return 0;
    try {
      const p = pos && finite3(pos) ? pos : null;
      return playInner(String(name), p, opts && typeof opts === 'object' ? opts : EMPTY) || 0;
    } catch (e) { warnOnce('play ' + name, e); return 0; }
  }

  // ---------------------------------------------------------------- unlock / lifecycle
  function unlock() {
    if (disposed) return false;
    try {
      if (!ac) {
        const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
        if (!AC) return false;
        sharedAC = new AC({ latencyHint: 'interactive' });
        ac = sharedAC;
      }
      if (ac.state === 'suspended' || ac.state === 'interrupted') {
        const pr = ac.resume();
        if (pr && pr.catch) pr.catch(() => {});
      }
      if (!G) {
        buildGraph();
        for (let i = 0; i < STRIP_COUNT; i++) strips.push(makeStrip());
        queue = buildQueue(); queueIdx = 0;
        applyUnder(listenerUnder);
      }
      return true;
    } catch (e) { warnOnce('unlock', e); return false; }
  }
  function onGesture() {
    unlock();
    if (ac && ac.state === 'running') removeGestures();
  }
  function onVisibility() {
    if (!ac || !G) return;
    try {
      if (document.hidden) { const p = ac.suspend(); if (p && p.catch) p.catch(() => {}); }
      else { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* noop */ }
  }
  const hasWin = typeof window !== 'undefined' && window.addEventListener;
  function removeGestures() {
    if (!hasWin) return;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    window.removeEventListener('touchstart', onGesture, true);
  }
  if (hasWin) {
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    window.addEventListener('touchstart', onGesture, true);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  }

  // Does the game simulation advance this frame? main.js bumps ctx.time only in sim states,
  // so that is the most faithful signal; ctx.state is the fallback when ctx.time never moves.
  function simAdvancing() {
    const t = ctx.time;
    if (fin(t)) {
      const moved = fin(lastCtxTime) && t !== lastCtxTime;
      lastCtxTime = t;
      if (moved) ctxTimeMoves = true;
      if (ctxTimeMoves) return moved;
    }
    const s = ctx.state;
    if (typeof s !== 'string') return true;
    return s === 'playing' || s === 'dead' || s === 'won';
  }

  function update(dt) {
    if (disposed) return;
    dt = fin(dt) ? clamp(dt, 0, 0.1) : 0;
    clock += dt;
    simOn = simAdvancing();
    if (simOn) gclock += dt;
    if (!live()) { trackPlayer(dt, false); return; }
    try {
      prewarm();
      syncListener();
      const du = desiredUnder();
      if (du !== listenerUnder) applyUnder(du);
      const pl = ctx.player;
      if (pl) {
        const alive = pl.alive !== false;
        if (alive && !prevAlive && over) restore();
        prevAlive = alive;
      }
      trackPlayer(dt, true);
      trackEnemies(dt);
      sampleWater();
      runTimers();
      updateFuse();
      updateHeli(dt);
      updateBody(dt);
      updateAmbienceEvents(dt);
      if (alertLevel === 2) hush = Math.max(hush, 0.5);
      hush = Math.max(0, hush - dt / 35);
      ambAcc += dt;
      if (ambAcc >= 0.1) { ambAcc = 0; ambTick(); }
    } catch (e) { warnOnce('update', e); }
  }

  function setVolume(v) {
    volume = clamp(fin(v) ? v : 0.9, 0, 1);
    if (G && !over) G.master.gain.setTargetAtTime(muted ? 0 : volume, ac.currentTime, 0.05);
  }
  function setMuted(m) {
    muted = !!m;
    if (G) G.master.gain.setTargetAtTime(muted ? 0 : volume, ac.currentTime, 0.05);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const k in HANDLERS) ev.off(k, HANDLERS[k]);
    removeGestures();
    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onVisibility);
    try {
      for (let i = 0; i < strips.length; i++) if (strips[i].busy) killStrip(strips[i]);
      for (const k in layers) { try { layers[k].src.stop(); layers[k].src.disconnect(); } catch (e) { /* noop */ } }
      heliStop();
      if (G) G.limiter.disconnect();
    } catch (e) { /* noop */ }
    G = null;
    if (current === api) current = null;
  }

  const api = {
    update,
    unlock,
    setUnderground,
    play,
    stop: stopVoice,
    setVolume,
    setMuted,
    setHelicopter,
    dispose,
    get ready() { return live(); },
    get context() { return ac; },
    get underground() { return listenerUnder; },
  };
  current = api;
  return api;
}
