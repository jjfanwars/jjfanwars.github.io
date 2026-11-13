// BREACHLINE audio: every sound is synthesised at runtime with the Web Audio API.
// No imports, no assets. All of play() is guarded so audio can never break the game loop.

const MAX_VOICES = 32;      // soft cap: beyond this, new quiet sounds are dropped
const HARD_VOICES = 44;     // hard cap: beyond this, everything new is dropped
const REF_DIST = 2;
const MAX_DIST = 70;
const NO_PITCH_VAR = new Set(['beep', 'plant_done', 'defuse_done', 'kill', 'headshot',
  'round_start', 'round_win', 'round_lose', 'ui_click', 'hitmarker', 'breach_place']);

const rnd = (a, b) => a + Math.random() * (b - a);

// One Voice per play() call: schedules noise bursts and oscillators into a shared output node.
class Voice {
  constructor(sys, out, t0, pitch) {
    this.sys = sys; this.ctx = sys.ctx; this.out = out; this.t0 = t0; this.p = pitch;
    this.end = t0; this.last = null;
  }

  // Attack / hold / exponential-decay envelope.
  _env(t, d, g, a, h) {
    const e = this.ctx.createGain();
    const peak = Math.max(0.0002, g);
    const at = Math.min(a, d * 0.5);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(peak, t + at);
    if (h > 0) e.gain.setValueAtTime(peak, t + at + Math.min(h, d - at - 0.01));
    e.gain.exponentialRampToValueAtTime(0.0001, t + d);
    e.connect(this.out);
    return e;
  }

  _track(src, t, d) {
    src.start(t);
    src.stop(t + d + 0.03);
    if (t + d > this.end) { this.end = t + d; this.last = src; }
  }

  // Filtered noise burst. buf: 'w' white, 'b' brown (dark rumble).
  n({ t = 0, d = 0.1, type = 'lowpass', f = 1000, f2 = 0, q = 0.7, g = 1, a = 0.001, h = 0, buf = 'w' }) {
    const c = this.ctx, at = this.t0 + t;
    const src = c.createBufferSource();
    src.buffer = this.sys.buf[buf];
    src.loop = true;
    src.loopStart = Math.random() * 1.5;       // decorrelate repeated plays
    src.loopEnd = src.buffer.duration;
    src.playbackRate.value = this.p;
    const fl = c.createBiquadFilter();
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(Math.min(20000, f * this.p), at);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.min(20000, f2 * this.p), at + d);
    src.connect(fl); fl.connect(this._env(at, d, g, a, h));
    src.start(at, src.loopStart);
    src.stop(at + d + 0.03);
    if (at + d > this.end) { this.end = at + d; this.last = src; }
    return this;
  }

  // Oscillator with optional pitch sweep (f -> f2) and optional lowpass (lp -> lp2).
  o({ t = 0, d = 0.1, w = 'sine', f = 440, f2 = 0, g = 1, a = 0.002, h = 0, lp = 0, lp2 = 0, det = 0 }) {
    const c = this.ctx, at = this.t0 + t;
    const osc = c.createOscillator();
    osc.type = w;
    osc.detune.value = det;
    osc.frequency.setValueAtTime(f * this.p, at);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2 * this.p, at + d);
    const env = this._env(at, d, g, a, h);
    if (lp) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.Q.value = 1;
      fl.frequency.setValueAtTime(lp, at);
      if (lp2) fl.frequency.exponentialRampToValueAtTime(lp2, at + d * 0.6);
      osc.connect(fl); fl.connect(env);
    } else osc.connect(env);
    this._track(osc, at, d);
    return this;
  }
}

// ---- shared building blocks -------------------------------------------------

const click = (s, t, f, g) => {            // small metallic/mechanical click
  s.n({ t, d: 0.03, type: 'bandpass', f, q: 3, g });
  s.o({ t, d: 0.04, w: 'triangle', f: f * 0.35, f2: f * 0.2, g: g * 0.5 });
};
const knock = (s, t, g) => {               // knuckle / hammer on wood
  s.o({ t, d: 0.09, w: 'triangle', f: rnd(220, 260), f2: 150, g: g * 0.7 });
  s.o({ t, d: 0.04, f: rnd(480, 560), g: g * 0.25 });
  s.n({ t, d: 0.04, type: 'bandpass', f: 1100, q: 2, g: g * 0.5 });
};
const splinters = (s, n, span, lo, hi, g) => {   // scattered crackle
  for (let i = 0; i < n; i++) {
    s.n({ t: rnd(0, span), d: rnd(0.03, 0.09), type: 'bandpass', f: rnd(lo, hi), q: 3, g: g * rnd(0.5, 1) });
  }
};
const brass = (s, t, f, d, g, lp) => {     // detuned saw pair through an opening lowpass
  s.o({ t, d, w: 'sawtooth', f, g, a: 0.03, h: d * 0.5, lp: lp * 0.4, lp2: lp, det: -7 });
  s.o({ t, d, w: 'sawtooth', f, g, a: 0.03, h: d * 0.5, lp: lp * 0.4, lp2: lp, det: 8 });
};

// ---- sound definitions --------------------------------------------------------

const SOUNDS = {
  rifle(s) {
    s.n({ d: 0.06, type: 'highpass', f: 2500, g: 1.1, a: 0.0005 });                 // crack
    s.n({ d: 0.16, type: 'bandpass', f: 900, f2: 300, q: 0.6, g: 1.0 });            // body
    s.o({ d: 0.15, f: 160, f2: 45, g: 1.1 });                                       // thump
    s.n({ t: 0.02, d: 0.45, f: 1800, f2: 300, g: 0.3, buf: 'b' });                  // tail
  },
  pistol(s) {
    s.n({ d: 0.04, type: 'highpass', f: 3200, g: 0.85, a: 0.0005 });
    s.n({ d: 0.09, type: 'bandpass', f: 1400, f2: 500, q: 0.7, g: 0.75 });
    s.o({ d: 0.08, f: 220, f2: 70, g: 0.65 });
    s.n({ t: 0.015, d: 0.22, f: 2200, f2: 500, g: 0.16, buf: 'b' });
  },
  empty(s) {
    s.n({ d: 0.015, type: 'highpass', f: 4000, g: 0.5 });
    s.o({ d: 0.012, w: 'square', f: 1800, g: 0.12 });
    s.n({ t: 0.02, d: 0.02, type: 'bandpass', f: 2500, q: 2, g: 0.2 });
  },
  reload(s) {
    click(s, 0, 1800, 0.5);                                                          // mag out
    s.n({ t: 0.03, d: 0.13, type: 'bandpass', f: 900, f2: 500, q: 1, g: 0.15 });
    s.o({ t: 0.5, d: 0.07, f: 140, f2: 80, g: 0.4 });                                // mag in
    click(s, 0.5, 1300, 0.7);
    click(s, 0.56, 2600, 0.4);
  },
  swap(s) {
    s.n({ d: 0.22, type: 'bandpass', f: 1200, f2: 2600, q: 0.8, g: 0.25, a: 0.06 });
    s.n({ t: 0.12, d: 0.12, type: 'bandpass', f: 600, q: 1, g: 0.15, a: 0.03 });
    click(s, 0.2, 2000, 0.2);
  },
  step(s) {
    s.o({ d: 0.09, f: 90, f2: 50, g: 0.5 });
    s.n({ d: 0.07, f: 500, g: 0.4, buf: 'b' });
    s.n({ d: 0.03, type: 'bandpass', f: 1800, q: 1, g: 0.06 });
  },
  impact_wall(s) {
    s.n({ d: 0.05, type: 'bandpass', f: 3000, f2: 1200, q: 1, g: 0.55 });
    s.o({ d: 0.04, f: 300, f2: 120, g: 0.25 });
    s.n({ t: 0.01, d: 0.16, type: 'highpass', f: 5000, g: 0.08, a: 0.01 });          // dust
  },
  impact_flesh(s) {
    s.o({ d: 0.1, f: 130, f2: 55, g: 0.7 });
    s.n({ d: 0.09, f: 700, f2: 250, g: 0.6 });
    s.n({ t: 0.005, d: 0.05, type: 'bandpass', f: 1500, f2: 700, q: 2, g: 0.18 });   // wet smack
  },
  wall_break(s) {
    s.o({ d: 0.2, f: 110, f2: 50, g: 0.7 });
    s.n({ d: 0.12, f: 2200, f2: 500, g: 0.6 });
    splinters(s, 7, 0.28, 500, 2500, 0.5);
    s.n({ t: 0.03, d: 0.55, type: 'highpass', f: 3000, g: 0.12, a: 0.05 });          // falling dust
  },
  barricade_hit(s) { knock(s, 0, 0.8); },
  barricade_break(s) {
    knock(s, 0, 1);
    s.o({ d: 0.25, f: 150, f2: 60, g: 0.7 });
    s.n({ d: 0.4, f: 2500, f2: 400, g: 0.5 });
    splinters(s, 10, 0.42, 800, 4000, 0.5);
  },
  explosion(s) {
    s.n({ d: 0.08, type: 'highpass', f: 1500, g: 1.1, a: 0.0005 });
    s.n({ d: 1.2, f: 3000, f2: 120, g: 1.3 });
    s.o({ d: 1.0, f: 90, f2: 25, g: 1.4 });
    s.n({ t: 0.03, d: 2.6, f: 400, f2: 60, g: 0.9, a: 0.05, buf: 'b' });             // rumble
    splinters(s, 8, 1.4, 600, 3000, 0.2);                                            // debris
  },
  breach_place(s) {
    for (let i = 0; i < 7; i++) {                                                    // velcro rip
      s.n({ t: i * 0.024 + rnd(0, 0.008), d: 0.03, type: 'highpass', f: 3000, g: rnd(0.15, 0.3) });
    }
    s.o({ t: 0.22, d: 0.09, w: 'square', f: 1400, g: 0.12, h: 0.05, lp: 4000 });
  },
  beep(s) {
    s.o({ d: 0.09, f: 1050, g: 0.35, h: 0.06 });
    s.o({ d: 0.09, w: 'square', f: 1050, g: 0.05, h: 0.06, lp: 5000 });
    s.o({ d: 0.05, f: 2100, g: 0.06 });
  },
  grenade_bounce(s) {
    s.n({ d: 0.02, type: 'highpass', f: 4000, g: 0.3 });
    s.o({ d: 0.13, f: 2300, g: 0.25 });
    s.o({ d: 0.1, f: 3710, g: 0.15 });
    s.o({ d: 0.07, f: 5230, g: 0.1 });
    s.o({ d: 0.04, f: 180, f2: 110, g: 0.25 });
  },
  plant_done(s) {
    s.o({ d: 0.45, w: 'triangle', f: 500, f2: 1400, g: 0.3, h: 0.3 });
    s.o({ d: 0.45, w: 'sawtooth', f: 250, f2: 700, g: 0.08, h: 0.3, lp: 2500 });
    s.o({ t: 0.46, d: 0.16, f: 1600, g: 0.3, h: 0.1 });
  },
  defuse_done(s) {
    click(s, 0, 2200, 0.3);
    s.o({ d: 0.6, w: 'triangle', f: 1200, f2: 180, g: 0.3, h: 0.3 });
    s.o({ d: 0.6, w: 'sawtooth', f: 600, f2: 90, g: 0.1, h: 0.3, lp: 2000, lp2: 300 });
  },
  barricade_build(s) {
    knock(s, 0, 0.8); knock(s, 0.22, 0.9); knock(s, 0.44, 1);
    s.n({ t: 0.44, d: 0.1, f: 600, g: 0.2, buf: 'b' });
  },
  reinforce(s) {
    for (let i = 0; i < 11; i++) {                                                   // ratchet
      s.n({ t: i * 0.055, d: 0.02, type: 'bandpass', f: rnd(2500, 3100), q: 4, g: 0.35 });
    }
    s.o({ d: 0.62, w: 'sawtooth', f: 90, f2: 140, g: 0.12, a: 0.05, h: 0.5, lp: 900 });
    const t = 0.7;                                                                   // clang
    s.n({ t, d: 0.08, type: 'bandpass', f: 2000, q: 1, g: 0.6 });
    s.o({ t, d: 0.2, f: 80, f2: 45, g: 0.7 });
    [[320, 0.3, 0.5], [487, 0.22, 0.45], [811, 0.16, 0.35], [1290, 0.1, 0.25]]
      .forEach(([f, g, d]) => s.o({ t, d, f, g }));
  },
  melee(s) {
    s.n({ d: 0.22, type: 'bandpass', f: 500, f2: 2400, q: 1.5, g: 0.4, a: 0.1 });    // whoosh
    s.o({ t: 0.18, d: 0.12, f: 120, f2: 50, g: 0.7 });
    s.n({ t: 0.18, d: 0.08, f: 900, f2: 300, g: 0.5 });
  },
  vault(s) {
    s.n({ d: 0.25, type: 'bandpass', f: 900, f2: 1800, q: 0.8, g: 0.22, a: 0.08 });  // cloth
    s.o({ t: 0.28, d: 0.12, f: 85, f2: 45, g: 0.6 });
    s.n({ t: 0.28, d: 0.08, f: 450, g: 0.45, buf: 'b' });
  },
  hitmarker(s) {
    s.o({ d: 0.035, w: 'triangle', f: 2200, g: 0.3 });
    s.n({ d: 0.012, type: 'highpass', f: 5000, g: 0.25 });
  },
  kill(s) {
    s.o({ d: 0.09, w: 'triangle', f: 880, g: 0.3, h: 0.05 });
    s.o({ t: 0.08, d: 0.18, w: 'triangle', f: 1320, g: 0.3, h: 0.06 });
    s.o({ t: 0.08, d: 0.14, f: 2640, g: 0.06 });
  },
  headshot(s) {
    s.n({ d: 0.01, type: 'highpass', f: 6000, g: 0.3 });
    s.o({ d: 0.32, f: 2640, g: 0.3 });
    s.o({ d: 0.22, f: 3960, g: 0.14 });
    s.o({ d: 0.12, f: 1760, g: 0.15 });
  },
  round_start(s) {
    [146.8, 220, 293.7].forEach((f) => brass(s, 0, f, 0.9, 0.11, 1800));             // D5 chord stab
    brass(s, 0.12, 349.2, 0.8, 0.07, 2200);                                          // minor third on top
    s.o({ d: 0.5, f: 73, f2: 50, g: 0.6 });
    s.n({ d: 0.3, f: 300, g: 0.4, buf: 'b' });
  },
  round_win(s) {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      const d = i === 3 ? 0.7 : 0.16;
      brass(s, i * 0.1, f, d, 0.09, 2600);
      s.o({ t: i * 0.1, d, w: 'triangle', f, g: 0.14, h: d * 0.4 });
    });
    brass(s, 0.3, 261.6, 0.7, 0.07, 1500);
  },
  round_lose(s) {
    [392, 311.1, 233.1].forEach((f, i) => {
      const d = i === 2 ? 0.9 : 0.2;
      brass(s, i * 0.16, f, d, 0.1, 1000);
    });
    s.o({ t: 0.32, d: 0.9, w: 'sawtooth', f: 58.3, g: 0.2, a: 0.04, h: 0.4, lp: 400 });
  },
  ui_click(s) {
    s.o({ d: 0.035, f: 1400, f2: 900, g: 0.2 });
    s.n({ d: 0.008, type: 'highpass', f: 3000, g: 0.12 });
  },
  drone(s) {
    s.o({ d: 0.14, w: 'sawtooth', f: 320, f2: 420, g: 0.12, a: 0.03, h: 0.08, lp: 1800 });
    s.o({ d: 0.14, w: 'square', f: 640, f2: 835, g: 0.035, a: 0.03, h: 0.08, lp: 3000 });
    s.n({ d: 0.14, type: 'bandpass', f: 3000, q: 3, g: 0.05, a: 0.03, h: 0.08 });
  },
};

// ---- system ---------------------------------------------------------------------

export class AudioSys {
  constructor() {
    this.ctx = null;          // created lazily in resume() (autoplay policy)
    this.master = null;
    this.reverb = null;
    this.buf = null;
    this.volume = 0.8;
    this.voices = [];         // end times of active voices
    this.lis = [0, 0, 0, 0, 0, -1];
  }

  resume() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        const c = new AC();
        const master = c.createGain();
        master.gain.value = this.volume;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        master.connect(comp); comp.connect(c.destination);
        this.buf = { w: this._noise(c, false), b: this._noise(c, true) };
        const rev = c.createConvolver();
        rev.buffer = this._impulse(c, 1.3);
        rev.connect(master);
        this.master = master; this.reverb = rev; this.ctx = c;
        this.setListener(...this.lis);
      }
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* audio unavailable: stay silent */ }
  }

  _noise(c, brown) {
    const len = Math.floor(c.sampleRate * 2), b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const wn = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * wn) / 1.02; d[i] = last * 3.5; } else d[i] = wn;
    }
    return b;
  }

  _impulse(c, secs) {         // decaying stereo noise = cheap room reverb
    const len = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5);
    }
    return b;
  }

  setListener(px, py, pz, fx, fy, fz) {
    this.lis = [px, py, pz, fx, fy, fz];
    if (!this.ctx) return;
    try {
      const l = this.ctx.listener;
      if (l.positionX) {
        l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
        l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition(px, py, pz);
        l.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    } catch (e) { /* ignore non-finite values etc. */ }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    try {
      if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    } catch (e) { /* ignore */ }
  }

  play(name, opts) {
    try {
      const c = this.ctx;
      if (!c || c.state === 'closed' || !Object.prototype.hasOwnProperty.call(SOUNDS, name)) return;
      const o = opts || {};
      const vol = o.volume == null ? 1 : Math.max(0, +o.volume || 0);
      const muffle = Math.max(0, Math.min(1, +o.muffle || 0));
      const pos = Array.isArray(o.pos) && o.pos.length >= 3 && o.pos.every(Number.isFinite) ? o.pos : null;
      if (vol <= 0) return;
      const now = c.currentTime;

      // Voice cap: estimate how loud this would be at the listener; drop quiet ones when busy.
      this.voices = this.voices.filter((e) => e > now);
      if (this.voices.length >= MAX_VOICES) {
        let loud = vol * (1 - 0.5 * muffle);
        if (pos) {
          const dist = Math.hypot(pos[0] - this.lis[0], pos[1] - this.lis[1], pos[2] - this.lis[2]);
          loud *= Math.min(1, REF_DIST / Math.max(dist, 0.001));
        }
        if (loud < 0.5 || this.voices.length >= HARD_VOICES) return;
      }

      // Chain: voice gain -> [muffle lowpass] -> [panner] -> master (+ small reverb send)
      const out = c.createGain();
      out.gain.value = vol * (1 - 0.45 * muffle);
      let tail = out;
      const nodes = [out];
      if (muffle > 0.01) {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 0.5;
        lp.frequency.value = 600 + Math.pow(1 - muffle, 3) * 17000;
        tail.connect(lp); tail = lp; nodes.push(lp);
      }
      if (pos) {
        const pn = c.createPanner();
        pn.panningModel = 'HRTF';
        pn.distanceModel = 'inverse';
        pn.refDistance = REF_DIST; pn.maxDistance = MAX_DIST; pn.rolloffFactor = 1;
        if (pn.positionX) {
          pn.positionX.value = pos[0]; pn.positionY.value = pos[1]; pn.positionZ.value = pos[2];
        } else pn.setPosition(pos[0], pos[1], pos[2]);
        tail.connect(pn); tail = pn; nodes.push(pn);
      }
      tail.connect(this.master);
      const wet = c.createGain();
      wet.gain.value = pos ? 0.16 : 0.05;
      tail.connect(wet); wet.connect(this.reverb); nodes.push(wet);

      const rate = Math.max(0.25, Math.min(4, +o.rate || 1));
      const pitch = rate * (NO_PITCH_VAR.has(name) ? 1 : rnd(0.95, 1.05));
      const voice = new Voice(this, out, now + 0.005, pitch);
      const cleanup = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
      try {
        SOUNDS[name](voice);
      } catch (e) {
        cleanup();
        return;
      }
      if (voice.last) voice.last.onended = cleanup; else cleanup();
      this.voices.push(voice.end);
    } catch (e) { /* never let audio break the game */ }
  }
}
