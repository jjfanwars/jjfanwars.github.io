'use strict';
// Synthesised sound: 4-cylinder turbo engine, gravel under the tyres, wind, impacts, anti-lag pops, beeps, and speech for callouts.
const Sfx = {
  ctx: null, on: false,
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let C; try { C = this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const master = this.master = C.createGain(); master.gain.value = 0.7; master.connect(C.destination);
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master); this.out = comp;
    const noiseBuf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = noiseBuf;
    const noise = () => { const s = C.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine: two detuned saws + square sub, waveshaper, lowpass
    const eg = this.eg = C.createGain(); eg.gain.value = 0;
    const lp = this.elp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 2;
    const ws = C.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); } ws.curve = curve;
    this.o1 = C.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = C.createOscillator(); this.o2.type = 'sawtooth'; this.o3 = C.createOscillator(); this.o3.type = 'square';
    const g1 = C.createGain(), g2 = C.createGain(), g3 = C.createGain(); g1.gain.value = 0.4; g2.gain.value = 0.3; g3.gain.value = 0.25;
    this.o1.connect(g1); this.o2.connect(g2); this.o3.connect(g3); g1.connect(ws); g2.connect(ws); g3.connect(ws); ws.connect(lp); lp.connect(eg); eg.connect(comp);
    this.o1.start(); this.o2.start(); this.o3.start();
    // induction / turbo hiss
    const tn = noise(), tbp = this.tbp = C.createBiquadFilter(); tbp.type = 'bandpass'; tbp.frequency.value = 3000; tbp.Q.value = 6; const tg = this.tg = C.createGain(); tg.gain.value = 0; tn.connect(tbp); tbp.connect(tg); tg.connect(comp);
    // gravel
    const gn = noise(), gbp = this.gbp = C.createBiquadFilter(); gbp.type = 'bandpass'; gbp.frequency.value = 1400; gbp.Q.value = 0.7; const gg = this.gg = C.createGain(); gg.gain.value = 0; gn.connect(gbp); gbp.connect(gg); gg.connect(comp);
    // rumble (low noise for rough ground) and wind
    const rn = noise(), rlp = C.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 160; const rg = this.rg = C.createGain(); rg.gain.value = 0; rn.connect(rlp); rlp.connect(rg); rg.connect(comp);
    const wn = noise(), wlp = this.wlp = C.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 500; const wg = this.wg = C.createGain(); wg.gain.value = 0; wn.connect(wlp); wlp.connect(wg); wg.connect(comp);
    this.on = true; this.lastThr = 0;
  },
  // st: rpm, thr, speed, slide, offroad, air
  update(st, dt) {
    if (!this.on) return; const C = this.ctx, t = C.currentTime, f = st.rpm / 60 * 2; // 4-cylinder firing frequency
    this.o1.frequency.setTargetAtTime(f, t, 0.02); this.o2.frequency.setTargetAtTime(f * 1.007, t, 0.02); this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.elp.frequency.setTargetAtTime(400 + st.rpm * 0.25 + st.thr * 2200, t, 0.03);
    this.eg.gain.setTargetAtTime((0.1 + st.thr * 0.22) * (st.inside ? 1 : 0.6), t, 0.03);
    this.tbp.frequency.setTargetAtTime(1800 + st.rpm * 0.6, t, 0.05); this.tg.gain.setTargetAtTime(st.thr * Math.max(0, st.rpm - 3000) / 4700 * 0.05, t, 0.08);
    const ground = st.air ? 0 : 1, sp = Math.min(1, st.speed / 30);
    this.gg.gain.setTargetAtTime(ground * (sp * 0.09 + st.slide * 0.25) * (1 - st.offroad * 0.5), t, 0.05); this.gbp.frequency.setTargetAtTime(900 + st.slide * 900, t, 0.1);
    this.rg.gain.setTargetAtTime(ground * (sp * 0.25 + st.offroad * sp * 0.5), t, 0.05);
    this.wg.gain.setTargetAtTime(Math.min(0.32, (st.speed / 42) ** 2 * 0.32), t, 0.1); this.wlp.frequency.setTargetAtTime(300 + st.speed * 18, t, 0.1);
    // anti-lag pops when lifting at high revs
    if (this.lastThr > 0.6 && st.thr < 0.2 && st.rpm > 4500) this.pops = 0.5; this.lastThr = st.thr;
    if (this.pops > 0) { this.pops -= dt; if (Math.random() < dt * 22) this.pop(0.25 + Math.random() * 0.4); }
  },
  burst(vol, freq, dur, type) {
    if (!this.on) return; const C = this.ctx, t = C.currentTime, s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq; const g = C.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  pop(v) { this.burst(v, 900, 0.07, 'bandpass'); },
  crash(v) { const k = Math.min(1, v / 18); this.burst(0.5 + k * 0.6, 300 + k * 600, 0.25 + k * 0.4); this.burst(0.3 * k, 3000, 0.2, 'highpass'); },
  thud(v) { this.burst(Math.min(0.8, v / 10), 180, 0.25); },
  click() { this.burst(0.2, 4200, 0.03, 'highpass'); },
  shift() { this.burst(0.15, 2500, 0.05, 'highpass'); },
  // crowd cheer: band-passed noise with a wobble, plus a few whistles
  cheer(k) {
    if (!this.on) return; const C = this.ctx, t = C.currentTime, s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8; const g = C.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * (0.4 + k), t + 0.4); g.gain.setValueAtTime(0.25 * (0.4 + k), t + 1.6); g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    const lfo = C.createOscillator(), lg = C.createGain(); lfo.frequency.value = 7; lg.gain.value = 300; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t); lfo.stop(t + 3.3);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random()); s.stop(t + 3.3);
    for (let i = 0; i < 3; i++) { const o = C.createOscillator(), og = C.createGain(), t0 = t + 0.2 + Math.random() * 1.5; o.frequency.setValueAtTime(2200 + Math.random() * 600, t0); o.frequency.linearRampToValueAtTime(2900 + Math.random() * 500, t0 + 0.3); og.gain.setValueAtTime(0.04, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4); o.connect(og); og.connect(this.out); o.start(t0); o.stop(t0 + 0.45); }
  },
  beep(hi) { if (!this.on) return; const C = this.ctx, t = C.currentTime, o = C.createOscillator(), g = C.createGain(); o.frequency.value = hi ? 1320 : 660; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + (hi ? 0.6 : 0.25)); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.7); },
  say(words) {
    try {
      if (!window.speechSynthesis) return; speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(words); u.rate = 1.3; u.pitch = 1.0; u.volume = 1;
      const v = speechSynthesis.getVoices().find(v => /en-GB/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang)); if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  },
  mute(m) { if (this.master) this.master.gain.value = m ? 0 : 0.7; },
};
