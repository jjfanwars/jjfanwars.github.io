'use strict';
// Rally car physics: rigid body with four raycast suspension corners, a simple Pacejka-style tyre curve,
// friction circle, 4WD (35/65 split), turbo engine, auto gearbox, handbrake, tree/log collisions.
// Body frame: +z forward, +y up, +x LEFT.
const CAR = {
  m: 1230, I: [2300, 2400, 900],                // pitch(x), yaw(y), roll(z) inertia
  wheels: [[0.8, -0.1, 1.27], [-0.8, -0.1, 1.27], [0.8, -0.1, -1.24], [-0.8, -0.1, -1.24]], // FL FR RL RR
  rest: 0.36, travel: 0.27, r: 0.32, k: 36000, cB: 4200, cR: 7500, arb: 9000,
  gears: [3.25, 2.2, 1.67, 1.32, 1.07, 0.89], rev: 3.1, fin: 5.2, idle: 950, red: 7700,
  split: 0.5,                                  // share of drive torque to the rear axle
  brake: 9800, brakeBias: 0.64,                 // max brake force per car (N) and front share
  hw: 0.9, hl: 2.06,                           // collision footprint half width/length
};
// Garage: unlockable cars. need = stage finishes to unlock. pow/grip/steer/tough multiply the base car; vmax sets the final drive.
const CARS = [
  { name: 'Group A Saloon', cls: 'Starter', need: 0, look: 'saloon', pow: 1, grip: 1, steer: 1, tough: 1, m: 1230, vmax: 200, split: 0.5 },
  { name: 'Kit Car Hatch', cls: 'Light and nimble', need: 2, look: 'hatch', pow: 1.08, grip: 1.07, steer: 1.14, tough: 1, m: 1060, vmax: 196, split: 0.35 },
  { name: 'Turbo Coupé', cls: 'Wide arches, big turbo', need: 4, look: 'coupe', pow: 1.3, grip: 1.07, steer: 1.06, tough: 1.15, m: 1200, vmax: 214, split: 0.55 },
  { name: 'Group B Monster', cls: 'Banned for a reason', need: 7, look: 'groupb', pow: 1.6, grip: 1.1, steer: 1.06, tough: 1.2, m: 1100, vmax: 226, split: 0.62 },
  { name: 'WRC Plus', cls: 'Modern works car', need: 10, look: 'wrc', pow: 1.5, grip: 1.22, steer: 1.18, tough: 1.4, m: 1190, vmax: 220, split: 0.5 },
  { name: 'Hill Climb Prototype', cls: 'All wing, no mercy', need: 14, look: 'proto', pow: 1.95, grip: 1.32, steer: 1.22, tough: 1.6, m: 1080, vmax: 238, split: 0.55 },
  { name: 'Volkswagen Beetle', cls: 'Maxed out. Everything.', need: 20, look: 'beetle', pow: 2.3, grip: 1.42, steer: 1.3, tough: 3, m: 1000, vmax: 255, split: 0.5 },
  // not rally cars: each one has a trick
  { name: 'Ice Cream Van', cls: 'Tall, tippy, slow. T plays the jingle', need: 1, look: 'van', pow: 1.0, grip: 0.92, steer: 0.85, tough: 2.2, m: 2100, vmax: 135, split: 0, roll: 0.2, hl: 2.3, snd: 'van', horn: 'jingle' },
  { name: 'Muscle Car', cls: 'Rear-drive V8. Hold Shift for nitro', need: 3, look: 'muscle', pow: 2.0, grip: 0.98, steer: 0.98, tough: 1.3, m: 1520, vmax: 245, split: 1, snd: 'v8', nitro: 1, hl: 2.3 },
  { name: 'Trophy Truck', cls: 'Long-travel desert racer, eats jumps', need: 6, look: 'trophy', pow: 2.1, grip: 1.05, steer: 1.0, tough: 2.6, m: 1900, vmax: 215, split: 1, r: 0.45, rest: 0.52, travel: 0.48, soft: 0.6, track: 0.95, base: [1.5, 1.45], hw: 1.05, hl: 2.35, snd: 'v8' },
  { name: 'Monster Truck', cls: 'Rolls over logs. Basically unbreakable', need: 8, look: 'monster', pow: 2.2, grip: 0.88, steer: 0.85, tough: 7, m: 2600, vmax: 165, split: 0.5, r: 0.66, rest: 0.6, travel: 0.55, soft: 0.5, track: 1.18, base: [1.45, 1.4], hw: 1.2, hl: 2.35, roll: 0.12, snd: 'v8' },
  { name: 'Electric Hypercar', cls: 'Instant torque, one gear, no noise', need: 12, look: 'ev', pow: 2.4, grip: 1.36, steer: 1.15, tough: 1.5, m: 1750, vmax: 255, split: 0.5, ev: 1, snd: 'ev' },
  // second batch (append only: saves use the index)
  { name: 'Pocket Rocket', cls: 'Tiny, light, front-drive. Darts into hairpins', need: 5, look: 'mini', pow: 1.05, grip: 1.12, steer: 1.32, tough: 0.9, m: 780, vmax: 188, split: 0, r: 0.29, rest: 0.33, base: [1.08, 1.05], hl: 1.72, bz: 1.6 },
  { name: 'Rally Estate', cls: 'Long roof, roof box, a very good boy in the back', need: 9, look: 'estate', pow: 1.3, grip: 1.08, steer: 1.0, tough: 1.7, m: 1380, vmax: 208, split: 0.5, hl: 2.18 },
  { name: 'Drift Coupé', cls: 'Rear-drive, pop-up lights, loves to slide', need: 11, look: 'drift', pow: 1.6, grip: 0.96, steer: 1.24, tough: 1.1, m: 1150, vmax: 228, split: 1 },
  { name: 'Stretch Limo', cls: 'Very long. Corners are a group effort', need: 15, look: 'limo', pow: 1.9, grip: 0.95, steer: 0.8, tough: 3.2, m: 2800, I: [9000, 9500, 2000], vmax: 195, split: 1, base: [2.34, 2.23], hl: 3.3, bz: 3.1, roll: 0.06, snd: 'v8' },
];
// driving model: 'arcade' (assists, generous grip) or 'real' (real-world grip, no assists, lock-ups, spin-ups, damage hurts the car)
const PHYS = { real: false, sport: false }; // sport: in between, real tyre physics with no scripted turning, power oversteer, ABS-style brakes and an anti-spin net
// real-world peak friction per surface (tyre on gravel, snow, sand, tarmac, verge)
const realMu = (B, onRoad) => onRoad ? (B.rGrip || B.grip * 0.58) : (B.rOff || B.off * 0.66);
const CAR_BASE = JSON.parse(JSON.stringify({ m: 1230, I: [2300, 2400, 900], k: 36000, cB: 4200, cR: 7500, arb: 9000, brake: 9800 }));
// stat bars out of 10 (the Beetle is 10 across the board)
const carStats = c => { const B = CARS.find(x => x.look === 'beetle'); return [['Power', c.pow / B.pow], ['Top speed', (c.vmax - 150) / (B.vmax - 150)], ['Grip', (c.grip - 0.6) / (B.grip - 0.6)], ['Handling', (c.steer - 0.6) / (B.steer - 0.6)], ['Toughness', Math.sqrt(c.tough / B.tough)]].map(([n, v]) => [n, Math.round(clamp(v, 0.05, 1) * 10)]); };
// wheel positions for a car spec (track = half width between wheel centres, base = front/rear axle distance from the middle)
const wheelsOf = c => { const tw = c.track || 0.8, wb = c.base || [1.27, 1.24]; return [[tw, -0.1, wb[0]], [-tw, -0.1, wb[0]], [tw, -0.1, -wb[1]], [-tw, -0.1, -wb[1]]]; };
function applyCar(i) {
  const c = i && typeof i === 'object' ? i : CARS[i] || CARS[0], s = c.m / CAR_BASE.m; CAR.idx = CARS.indexOf(c);
  CAR.m = c.m; CAR.I = c.I ? c.I.slice() : CAR_BASE.I.map(x => x * s);
  CAR.bx = c.bx || 0.88; CAR.by0 = c.by0 !== undefined ? c.by0 : -0.12; CAR.by1 = c.by1 || 1.05; CAR.bz = c.bz || 2.0; CAR.bh = c.bh || 1.6; // body box for ground contact and collisions
  // springs, dampers and anti-roll bars scale with mass (kS overrides), always from the base so swapping cars never compounds
  const ks = c.kS !== undefined ? c.kS : s; for (const k of ['k', 'cB', 'cR', 'arb']) CAR[k] = CAR_BASE[k] * ks;
  CAR.brake = CAR_BASE.brake * s * (0.85 + 0.15 * c.grip); CAR.pow = c.pow; CAR.grip = c.grip; CAR.steerK = c.steer; CAR.tough = c.tough; CAR.split = c.split;
  // body and running gear (defaults are the rally saloon)
  CAR.r = c.r || 0.32; CAR.rest = c.rest || 0.36; CAR.travel = c.travel || 0.27; CAR.hw = c.hw || 0.9; CAR.hl = c.hl || 2.06; CAR.roll = c.roll || 0;
  if (c.soft) { CAR.k *= c.soft; CAR.cB *= Math.sqrt(c.soft); CAR.cR *= Math.sqrt(c.soft); CAR.arb *= c.soft; }
  CAR.wheels = wheelsOf(c);
  CAR.ev = !!c.ev; CAR.nitro = !!c.nitro; CAR.snd = c.snd || ''; CAR.horn = c.horn || 'horn'; CAR.gears = c.ev ? [1] : [3.25, 2.2, 1.67, 1.32, 1.07, 0.89];
  CAR.fin = CAR.red * 2 * Math.PI / 60 * CAR.r / (CAR.gears[CAR.gears.length - 1] * c.vmax / 3.6);
}
const torqueAt = rpm => { const x = rpm / 1000; return x < 2.5 ? 230 + 60 * x : x < 4.5 ? 380 + 20 * (x - 2.5) : x < 6.5 ? 420 - 8 * (x - 4.5) : 404 - 70 * (x - 6.5); };

class Car {
  constructor(S) {
    this.S = S; this.pos = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.wh = CAR.wheels.map((a, i) => ({ a: new THREE.Vector3(...a), comp: 0, pc: 0, contact: false, spin: 0, steer: 0, slip: 0, load: 0, front: i < 2, surf: 0, cp: new THREE.Vector3() }));
    this.steer = 0; this.thr = 0; this.brk = 0; this.gear = 1; this.rpm = CAR.idle; this.shiftT = 0; this.dmg = 0; this.air = 0; this.events = [];
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), f: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(), q: new THREE.Quaternion(), F: new THREE.Vector3(), T: new THREE.Vector3() };
    this.near = []; this.speed = 0; this.prog = 0; this.lat = 0; this.offroad = 0; this.slide = 0; this.pull = Math.random() < 0.5 ? -1 : 1;
  }
  get real() { return this._real !== undefined ? this._real : PHYS.real; }
  get sport() { return this._sport !== undefined ? this._sport : PHYS.sport && !this.real; }
  set sport(v) { this._sport = v; }
  set real(v) { this._real = v; }
  place(s, lat) {
    for (const l of this.S.logs) if (l.s - s < 18 && l.s - s > -6) s = l.s - 20;
    const S = this.S, p = S.at(s), rx = -Math.cos(p.h), rz = Math.sin(p.h);
    const x = p.x + rx * (lat || 0), z = p.z + rz * (lat || 0);
    this.pos.set(x, S.heightAt(x, z) + 0.62 + (CAR.rest + CAR.r - 0.68), z); this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.h); this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wh) { w.comp = w.pc = 0.12; w.cv = 0; w.spin = 0; } this.steer = 0; this.wrecked = false; this.gear = 1; this.rpm = CAR.idle; this.prog = s; this.air = 0; this.shiftT = 0;
  }
  // world <- body
  toWorld(v, out) { return out.copy(v).applyQuaternion(this.q); }
  // apply impulse J at world point P
  impulse(P, J) {
    const t = this.tmp, r = t.a.subVectors(P, this.pos); this.v.addScaledVector(J, 1 / CAR.m);
    const tq = t.b.crossVectors(r, J); this.angAccel(tq, 1);
  }
  // w += Iinv_world * tq * k
  angAccel(tq, k) {
    const t = this.tmp, iq = t.q.copy(this.q).invert(), L = t.c.copy(tq).applyQuaternion(iq);
    L.x /= CAR.I[0]; L.y /= CAR.I[1]; L.z /= CAR.I[2]; L.applyQuaternion(this.q); this.w.addScaledVector(L, k);
  }
  // effective inverse mass for an impulse along n at point P
  invMass(P, n) {
    const t = this.tmp, r = t.a.subVectors(P, this.pos), rn = t.b.crossVectors(r, n), iq = t.q.copy(this.q).invert(), L = t.c.copy(rn).applyQuaternion(iq);
    L.x /= CAR.I[0]; L.y /= CAR.I[1]; L.z /= CAR.I[2]; L.applyQuaternion(this.q);
    return 1 / CAR.m + t.d.crossVectors(L, r).dot(n);
  }
  pointVel(P, out) { return out.crossVectors(this.w, this.tmp.d.subVectors(P, this.pos)).add(this.v); }
  step(dt, inp) {
    const S = this.S, t = this.tmp, up = this.toWorld(t.up.set(0, 1, 0), t.up), fwd = this.toWorld(t.f.set(0, 0, 1), t.f).clone(), left = this.toWorld(t.s.set(1, 0, 0), t.s).clone();
    const F = t.F.set(0, -9.81 * CAR.m, 0), T = t.T.set(0, 0, 0);
    const vF = this.v.dot(fwd), vL = this.v.dot(left), spd = this.v.length(); this.speed = spd;
    // ---- inputs: steering with speed sensitivity and self-alignment toward the direction of travel ----
    const beta = Math.abs(vF) > 2 ? Math.atan2(vL, Math.abs(vF)) : 0;
    // lateral grip the surface really has (road or verge): caps steering lock and the yaw assist, so snow feels like snow
    const BS = S.B || BIOMES.forest, real = this.real, sport = !real && this.sport, gk = real ? 1 + ((CAR.grip || 1) - 1) * 0.5 : sport ? 1 + ((CAR.grip || 1) - 1) * 0.75 : (CAR.grip || 1), zk = S.zoneAt ? S.zoneAt(this.prog) : null, wetK = (S.cfg && S.cfg.wet ? 0.8 : 1) * (zk ? zk.mu : 1);
    const mu0 = (real ? lerp(realMu(BS, true), realMu(BS, false), this.offroad) : sport ? lerp(realMu(BS, true), realMu(BS, false), this.offroad) * 1.4 : lerp(BS.grip, BS.off, this.offroad) * 1.12) * gk * wetK * (1 - this.dmg * 0.15), aMax = mu0 * 9.81 * 1.12;
    // real: the lock still narrows with speed (as a driver would), but allows 1.6x what the tyres can hold, so you can over-drive it
    const vv = Math.max(4, Math.abs(vF)), maxS = real ? clamp(Math.atan(2.51 * aMax * 1.6 / (vv * vv)) + 0.12, 0.2, 0.6) : sport ? clamp(Math.atan(2.51 * aMax * 1.9 * (CAR.steerK || 1) / (vv * vv)) + 0.12, 0.2, 0.62) : clamp(Math.atan(2.51 * aMax * (CAR.steerK || 1) / (vv * vv)) + 0.09, 0.14, 0.62), st = inp.steer;
    let target = st * maxS + (real ? this.dmg * 0.035 * this.pull : 0); // real: a bent car pulls to one side
    // countersteer help: the front wheels lean toward the direction of travel when the tail steps out
    if (!real && vF > 5 && Math.abs(beta) > 0.06) target = clamp(target + clamp(beta * (sport ? 0.3 : 0.45), sport ? -0.15 : -0.22, sport ? 0.15 : 0.22) * sstep(5, 12, vF), -0.65, 0.65);
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 10 : 8) * (real ? 0.6 : sport ? 0.85 * (CAR.steerK || 1) : (CAR.steerK || 1));
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    // throttle / brake / reverse logic
    let thr = inp.thr, brk = inp.brk;
    if (this.gear > 0 && brk > 0.1 && vF < 0.8 && thr < 0.1) { this.gear = -1; }
    else if (this.gear < 0 && thr > 0.1 && vF > -0.8) { this.gear = 1; }
    if (this.gear < 0) { const x = thr; thr = brk; brk = x; if (vF < -8) thr *= clamp((vF + 9) / 1, 0, 1); } // reverse tops out near 30 km/h
    this.thr += clamp(thr - this.thr, -8 * dt, 6 * dt); this.brk += clamp(brk - this.brk, -10 * dt, 8 * dt);
    const hb = inp.hb ? 1 : 0;
    // brake heat: only on stages with brake fade; past 60% the brakes start to go away, at 100% they are half as strong
    this.bT = this.bT || 0; if (S.cfg && S.cfg.fade) { this.bT = clamp(this.bT + (this.brk * Math.abs(vF) * 0.0105 - 0.035 - Math.abs(vF) * 0.0016) * dt, 0, 1.2); } else this.bT = 0;
    this.fadeK = 1 - 0.55 * clamp((this.bT - 0.6) / 0.5, 0, 1);
    // ---- engine and gearbox ----
    const ratio = this.gear < 0 ? -CAR.rev : CAR.gears[this.gear - 1], ksh = ratio * CAR.fin;
    let wheelW = 0, nd = 0; for (const w of this.wh) { wheelW += w.spin; nd++; } wheelW /= nd;
    const tgtRpm = Math.abs(wheelW * ksh) * 60 / (2 * Math.PI);
    const clutch = this.gear === 1 && tgtRpm < 2600 ? 1 : 0; // launch slip in first
    let rpm = Math.max(CAR.idle, clutch ? Math.max(tgtRpm, lerp(CAR.idle, 4800, this.thr)) : tgtRpm);
    if (rpm > CAR.red) rpm = CAR.red + (rpm - CAR.red) * 0.2;
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 20);
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (this.gear > 0) {
      if (this.rpm > CAR.red - 350 && this.gear < CAR.gears.length && this.air <= 0.05) { this.gear++; this.shiftT = real ? 0.22 : 0.13; this.events.push({ k: 'shift', up: 1 }); }
      else if (this.gear > 1) { const lower = tgtRpm * CAR.gears[this.gear - 2] / CAR.gears[this.gear - 1]; if (lower < CAR.red - 1500 && (tgtRpm < 3300 || (this.brk > 0.3 && lower < CAR.red - 1900))) { this.gear--; this.shiftT = 0.1; this.events.push({ k: 'shift', up: 0 }); } }
    }
    const limiter = this.rpm > CAR.red - 20 ? 0.15 : 1;
    this.nos = this.nos === undefined ? 1 : this.nos; this.boost = CAR.nitro && inp.nitro && this.nos > 0 && this.thr > 0.3; if (this.boost) this.nos = Math.max(0, this.nos - dt / 4); else this.nos = Math.min(1, this.nos + dt / 14);
    const tq = CAR.ev ? (this.rpm < 4200 ? 480 : 480 * 4200 / this.rpm) : torqueAt(this.rpm);
    const engT = this.shiftT > 0 ? 0 : tq * (CAR.pow || 1) * (this.boost ? 1.75 : 1) * this.thr * limiter * (real ? 1 - this.dmg * 0.4 : 1), driveTotal = engT * Math.abs(ksh) * 0.9 / CAR.r; // N at the contact patches
    // ---- suspension + tyres ----
    let contacts = 0, slideSum = 0, offSum = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wh[i], A = this.toWorld(w.a, t.a).add(this.pos).clone(), down = up.clone().negate();
      let tt = 0; for (let it = 0; it < 3; it++) { const px = A.x + down.x * tt, pz = A.z + down.z * tt; tt = (A.y - S.heightAt(px, pz)) / Math.max(0.3, up.y); }
      const len = CAR.rest + CAR.r - (w.flat ? 0.17 : 0); // a flat tyre sits lower
      w.pc = w.comp;
      if (tt < len && up.y > 0.2) {
        w.comp = Math.min(len - tt, CAR.travel + 0.1); w.contact = true; contacts++;
      } else { w.comp = Math.max(0, w.comp - dt * 2); w.contact = false; }
      if (!w.contact) { w.spin += ((w.front ? 0 : hb ? -w.spin * 30 : 0) + (this.gear !== 0 ? driveTotal * (w.front ? 1 - CAR.split : CAR.split) / 2 * CAR.r / 18 : 0)) * dt; w.spin *= 1 - dt * 0.6; w.load = 0; w.slip = 0; continue; }
      const cp = w.cp.copy(A).addScaledVector(down, tt), n = S.normalAt(cp.x, cp.z, t.n).clone();
      // spring + damper (+ bump stop)
      // compression velocity is low-passed (stands in for tyre sidewall compliance, kills chatter on mesh facets)
      w.cv = lerp(w.cv || 0, (w.comp - w.pc) / dt, Math.min(1, dt * 90)); const cv = w.cv;
      let fs = CAR.k * w.comp + clamp((cv > 0 ? CAR.cB : CAR.cR) * cv, -14000, 16000);
      if (w.comp > CAR.travel) { const o = w.comp - CAR.travel; fs += o * 120000 + o * o * 2e6 + Math.max(0, cv) * 12000; }
      fs = Math.max(0, fs); w.load = Math.min(fs, 30000);
      F.addScaledVector(up, fs); T.add(t.b.crossVectors(t.c.subVectors(A, this.pos), t.d.copy(up).multiplyScalar(fs)));
      // tyre frame
      const sa = w.front ? this.steer : 0, cs = Math.cos(sa), sn = Math.sin(sa);
      const wf = fwd.clone().multiplyScalar(cs).addScaledVector(left, sn); wf.addScaledVector(n, -wf.dot(n)).normalize();
      const wl = new THREE.Vector3().crossVectors(n, wf).normalize();
      const pv = this.pointVel(cp, new THREE.Vector3()), vx = pv.dot(wf), vy = pv.dot(wl);
      // surface from the road map
      const q = S.near(cp.x, cp.z, 12), onRoad = q && q.d < ROAD_HW + 0.3;
      w.surf = onRoad ? 0 : 1; offSum += w.surf;
      const BB = S.B || BIOMES.forest, mu = (real ? realMu(BB, onRoad) : sport ? realMu(BB, onRoad) * 1.4 : (onRoad ? BB.grip : BB.off) * 1.12) * gk * (onRoad ? wetK : zk ? zk.mu : 1) * (1 - this.dmg * 0.15) * (w.flat ? 0.45 : 1), Fz = Math.min(w.load, 9000), fmax = mu * Fz * (1 - 0.06 * Fz / 4000); // tyre load sensitivity
      // longitudinal
      let fx = 0, locked = false;
      const split = sport ? Math.min(0.85, CAR.split + 0.15) : CAR.split, share = w.front ? (1 - split) / 2 : split / 2; // sport: more drive to the rear so the throttle steers the tail
      if (this.gear !== 0) fx += driveTotal * share * Math.sign(ratio);
      const bf = this.brk * CAR.brake * (w.front ? CAR.brakeBias : 1 - CAR.brakeBias) / 2 * this.fadeK;
      fx -= Math.sign(vx) * Math.min(bf, Math.abs(vx) * CAR.m * 2);
      if (hb && !w.front) { locked = true; fx = -Math.sign(vx) * Math.min(fmax * 0.85, Math.abs(vx) * CAR.m); }
      if (!onRoad && !(zk && zk.noDrag)) fx -= vx * BB.offDrag; // soft ground drag (not on a frozen lake)
      if (zk && zk.drag) fx -= vx * zk.drag; // water: wading drag
      fx -= vx * (6 + (w.flat ? 900 : 0)); // rolling resistance (a flat drags hard)
      // lateral: slip angle curve, softer and wider on gravel
      const slipA = Math.atan2(vy, Math.max(Math.abs(vx), 3.5));
      // real: sharper peak and a real drop-off past it (sliding grip ~80% of peak), so a slide has to be caught
      const Bc = real ? (onRoad ? 10 : 7) : sport ? (onRoad ? 11 : 8) : onRoad ? 14 : 9, Cc = real ? 1.45 : sport ? 1.3 : 1.1, curve = Math.sin(Cc * Math.atan(Bc * slipA));
      let fy = -fmax * curve * (locked ? (sport ? 0.28 : 0.45) : 1) * (sport ? (w.front ? 1.04 : 0.9) : 1); // sport: a slightly loose rear, so the car rotates instead of ploughing on
      // a little wheelspin: when the drive at this tyre nears its grip (low gears, snow, big power) it spins up,
      // pushes slightly less and gives up some side grip (a hint of power oversteer)
      const drv0 = this.gear !== 0 ? Math.abs(driveTotal * share) : 0, spinR = real || sport ? 0 : locked || Math.abs(vx) > 30 ? 0 : clamp((drv0 / Math.max(1, fmax) - 0.45) / 0.5, 0, 1);
      if (spinR > 0) { fx *= 1 - 0.07 * spinR; fy *= 1 - (w.front ? 0.04 : 0.09) * spinR * (1 - sstep(0.15, 0.4, Math.abs(slipA))); }
      if (Math.abs(vx) < 3) { const lowS = -vy * CAR.m * 0.25 * 8; fy = lerp(lowS, fy, Math.abs(vx) / 3); fy = clamp(fy, -fmax, fmax); }
      // friction circle (longitudinal first, then whatever grip is left for cornering)
      let realSpin = 0;
      if (real) {
        // no ABS, no traction control: asking for more than the tyre has locks it (brakes) or spins it up (throttle); either way side grip collapses
        if (!locked && bf > fmax * 1.02 && Math.abs(vx) > 1) { locked = true; fx = -Math.sign(vx) * fmax * 0.8; fy *= 0.3; }
        else if (drv0 > fmax * 1.02) { realSpin = clamp((drv0 - fmax) / fmax, 0, 1); fx = Math.sign(fx) * fmax * (0.9 - 0.1 * realSpin); fy *= 0.45 - 0.2 * realSpin; }
        const mag = Math.hypot(fx, fy); if (mag > fmax) { const kk = fmax / mag; fx *= kk; fy *= kk; }
      } else if (sport) {
        // sport: brakes never lock (ABS), but too much throttle spins the driven wheels up and the tail steps out
        if (!locked && drv0 > fmax * 0.8) { realSpin = clamp((drv0 - fmax * 0.8) / (fmax * 0.6), 0, 1); fx = Math.sign(fx) * Math.min(Math.abs(fx), fmax * 0.95); fy *= 1 - (w.front ? 0.2 : 0.45) * realSpin; }
        const mag = Math.hypot(fx, fy); if (mag > fmax) { const kk = fmax / mag; fx *= kk; fy *= Math.min(1, kk * 1.12); }
      } else { const mag = Math.hypot(fx, fy * 0.85); if (mag > fmax) { const kk = fmax / mag; fx *= kk; fy *= Math.min(1, kk * 1.35); } }
      const tf = new THREE.Vector3().addScaledVector(wf, fx).addScaledVector(wl, fy);
      F.add(tf); T.add(t.b.crossVectors(t.c.subVectors(cp, this.pos).addScaledVector(up, (real ? 0.12 : sport ? 0.22 : 0.32) - (CAR.roll || 0)), tf)); // force applied a little above the patch: lower effective roll centre
      // wheel spin (visual, sound, rpm): free-rolling plus wheelspin when drive exceeds grip
      const roll = vx / CAR.r, drv = this.gear !== 0 ? driveTotal * share * Math.sign(ratio) : 0, excess = Math.max(Math.abs(drv) > fmax ? (Math.abs(drv) - fmax) / CAR.m * 0.9 : 0, spinR * 0.55, realSpin * (sport ? 1.5 : 2));
      const tgtSpin = locked ? 0 : roll + Math.sign(drv) * excess * 4 / CAR.r;
      w.spin += (tgtSpin - w.spin) * Math.min(1, dt * 25);
      w.slip = Math.min(1, Math.abs(slipA) * 2.2 + (locked ? Math.min(1, Math.abs(vx) / 6) : 0) + excess * 0.4);
      slideSum += w.slip;
    }
    // anti-roll: transfer between left and right on each axle
    for (const [a, b] of [[0, 1], [2, 3]]) { const wa = this.wh[a], wb = this.wh[b]; if (!wa.contact && !wb.contact) continue; const d = (wa.comp - wb.comp) * CAR.arb, Pa = this.toWorld(wa.a, t.a).add(this.pos).clone(), Pb = this.toWorld(wb.a, t.a).add(this.pos).clone(); T.add(t.b.crossVectors(t.c.subVectors(Pa, this.pos), t.d.copy(up).multiplyScalar(d))); T.add(t.b.crossVectors(t.c.subVectors(Pb, this.pos), t.d.copy(up).multiplyScalar(-d))); }
    if (sport && contacts >= 3 && Math.abs(vF) > 6) {
      // anti-spin net only: past ~30 degrees of slide, damp any rotation that would take it further; below that the car does what the tyres say
      const over = Math.abs(beta) - 0.5, yaw = this.w.dot(up); if (over > 0 && yaw * beta < 0) T.addScaledVector(up, -yaw * CAR.I[1] * 5 * clamp(over * 3, 0, 1));
    }
    if (contacts >= 3 && !hb && !real && !sport) {
      // yaw assist toward the bicycle-model yaw rate, capped by what the surface can hold (plus a little arcade bonus)
      const lim = aMax * 1.08 * (CAR.steerK || 1) / Math.max(3, Math.abs(vF)), yaw = this.w.dot(up), want = clamp(vF * Math.tan(this.steer) / 2.51, -lim, lim), err = yaw - want;
      // on the throttle with the tail out the assist relaxes a bit so you can hold a drift
      const drift = clamp((Math.abs(beta) - 0.08) * 4, 0, 1) * this.thr;
      T.addScaledVector(up, -err * CAR.I[1] * 10 * (1 - 0.4 * drift) * sstep(2, 8, Math.abs(vF)));
      // bleed off sideways sliding so the car goes where it points (less of it on low-grip surfaces)
      const vLat = this.v.dot(left); F.addScaledVector(left, -vLat * CAR.m * 2.1 * clamp(mu0 / 1.68, 0.7, 1.1) * (1 - 0.3 * drift) * sstep(2, 6, Math.abs(vF)));
    }
    if (contacts && this.air > 0.25) { // jump landing: kill the rebound and most of the pitch/roll bounce (real: only the springs and dampers)
      if (this.v.y > 0 && !real) this.v.y *= 0.3;
      if (!real) { const wl = this.w.clone().applyQuaternion(t.q.copy(this.q).invert()); wl.x *= 0.45; wl.z *= 0.45; this.w.copy(wl.applyQuaternion(this.q)); }
      this.events.push({ k: 'land', v: Math.min(1, this.air) });
    }
    this.air = contacts === 0 ? this.air + dt : 0; this.slide = slideSum / 4; this.offroad = offSum / 4;
    // aero drag
    F.addScaledVector(this.v, -0.62 * spd * (1 - 0.45 * (this.draft || 0)));
    // integrate
    this.v.addScaledVector(F, dt / CAR.m); this.angAccel(T, dt);
    this.w.multiplyScalar(1 - dt * (real ? 0.08 : contacts ? (sport ? 0.15 : 0.3) : 0.9));
    if (contacts === 0 && !real) { // a touch of stability in the air so jumps are fun, not random
      const iq = t.q.copy(this.q).invert(), wl = this.w.clone().applyQuaternion(iq); wl.x *= 1 - dt * 1.4; wl.z *= 1 - dt * 1.8;
      // the nose slowly follows the flight path, so a car that leaves a kicker flat lands on its wheels
      const vl = this.v.clone().applyQuaternion(iq); if (spd > 8) wl.x -= clamp(Math.atan2(vl.y, Math.max(1, vl.z)), -0.6, 0.6) * 2.2 * dt;
      this.w.copy(wl.applyQuaternion(this.q));
    }
    this.pos.addScaledVector(this.v, dt);
    const wq = t.q.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).multiply(this.q);
    this.q.x += wq.x; this.q.y += wq.y; this.q.z += wq.z; this.q.w += wq.w; this.q.normalize();
    this.bodyContacts(dt); this.collide();
    // stage progress (ignore jumps to another road branch)
    const q = S.near(this.pos.x, this.pos.z, 60);
    if (q) { this.lat = q.lat; if (Math.abs(q.s - this.prog) < 40) this.prog = q.s; this.roadD = q.d; this.below = this.pos.y < q.y - 3.5; } else { this.roadD = 99; this.below = false; }
  }
  // box corners against the ground (stops the body sinking when it lands hard or rolls)
  bodyContacts(dt) {
    const S = this.S, t = this.tmp;
    for (const cx of [-CAR.bx, CAR.bx]) for (const cy of [CAR.by0, CAR.by1]) for (const cz of [-CAR.bz, CAR.bz]) {
      const P = this.toWorld(t.a.set(cx, cy, cz), new THREE.Vector3()).add(this.pos), gy = S.heightAt(P.x, P.z), pen = gy - P.y;
      if (pen <= 0) continue;
      const n = S.normalAt(P.x, P.z, new THREE.Vector3()); this.pos.addScaledVector(n, pen * 0.6);
      const pv = this.pointVel(P, new THREE.Vector3()), vn = pv.dot(n);
      if (vn < 0) {
        const j = -vn / this.invMass(P, n); this.impulse(P, n.clone().multiplyScalar(j));
        const vt = pv.clone().addScaledVector(n, -vn), vtl = vt.length(); if (vtl > 0.01) { const jt = Math.min(vtl / this.invMass(P, vt.clone().normalize()), j * 0.6); this.impulse(P, vt.multiplyScalar(-jt / vtl)); }
        if (-vn > 3) { this.dmg = Math.min(1, this.dmg + (-vn - 3) * 0.01 / (CAR.tough || 1)); this.events.push({ k: 'thud', v: -vn }); }
      }
    }
  }
  collide() {
    const S = this.S, t = this.tmp, iq = new THREE.Quaternion().copy(this.q).invert();
    const hit = (cx, cz, cy, r, topY, soft, ovx, ovz, fnx, fnz) => {
      const L = new THREE.Vector3(cx - this.pos.x, cy - this.pos.y, cz - this.pos.z).applyQuaternion(iq);
      if (topY !== undefined && this.pos.y - 0.3 > topY) return;
      if (L.y < -1.2 || L.y > CAR.bh) return;
      const px = clamp(L.x, -CAR.hw, CAR.hw), pz = clamp(L.z, -CAR.hl, CAR.hl); let dx = px - L.x, dz = pz - L.z, d = Math.hypot(dx, dz);
      if (d >= r) return;
      let nl;
      if (d < 1e-4) { const ox = CAR.hw - Math.abs(L.x), oz = CAR.hl - Math.abs(L.z); nl = ox < oz ? new THREE.Vector3(-Math.sign(L.x), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(L.z)); d = -Math.min(ox, oz); }
      else nl = new THREE.Vector3(dx / d, 0, dz / d);
      const n = nl.applyQuaternion(this.q); n.y = 0; n.normalize(); if (fnx !== undefined) n.set(fnx, 0, fnz); // guardrails push straight back toward the road, never along it
      const pen = r - d; this.pos.addScaledVector(n, pen);
      const P = new THREE.Vector3(px, 0.1, pz).applyQuaternion(this.q).add(this.pos), pv = this.pointVel(P, new THREE.Vector3()); if (ovx !== undefined) { pv.x -= ovx; pv.z -= ovz; } const vn = pv.dot(n);
      if (vn >= 0) return;
      // how square the hit is: 1 = straight in, 0 = a scrape along it
      const sev = -vn, head = clamp(sev / Math.max(0.1, pv.length()), 0, 1), scrape = head < 0.55;
      const j = -vn * (soft ? 1.0 : scrape ? 1.04 : 1.15) / this.invMass(P, n); this.impulse(P, n.clone().multiplyScalar(j)); if (soft) { this.v.multiplyScalar(0.985); return; } // snowbank: you plough into it, no damage
      // friction along the surface: a sideswipe slides you along the barrier instead of spinning you round
      const vt = pv.clone().addScaledVector(n, -vn); vt.y = 0; const vtl = vt.length(); if (vtl > 0.01) { const jt = Math.min(vtl / this.invMass(P, vt.clone().normalize()) * 0.5, j * (scrape ? 0.1 : 0.4)); this.impulse(P, vt.multiplyScalar(-jt / vtl)); }
      if (scrape) { const yaw = this.w.dot(this.tmp.up.set(0, 1, 0).applyQuaternion(this.q)); this.w.addScaledVector(this.tmp.up, -yaw * 0.25); } // a scrape doesn't flick the car round
      if (sev > 3) { this.dmg = Math.min(1, this.dmg + (sev - 3) * 0.007 * (0.3 + 0.7 * head) / (CAR.tough || 1)); this.events.push({ k: 'crash', v: sev * (0.4 + 0.6 * head) }); }
      // only a hard, square hit wrecks the car (about 55 km/h straight into a tree or wall)
      if (sev > 15 * Math.sqrt(CAR.tough || 1) && head > 0.6 && !this.wrecked) { this.wrecked = true; this.events.push({ k: 'wreck', v: sev }); }
    };
    for (const tr of S.treesNear(this.pos.x, this.pos.z, this.near)) hit(tr.x, tr.z, tr.y + 0.6, tr.r, undefined, tr.soft, undefined, undefined, tr.nx, tr.nz);
    if (S.dynNear) for (const d of S.dynNear(this.pos.x, this.pos.z, S.clock || 0, this.dynL || (this.dynL = []))) hit(d.x, d.z, d.y + 1.2, d.r, undefined, false, d.vx, d.vz);
    for (const l of S.logs) {
      const ex = l.bx - l.ax, ez = l.bz - l.az, ll = ex * ex + ez * ez, rr = Math.sqrt(ll) / 2 + 7; if ((this.pos.x - (l.ax + l.bx) / 2) ** 2 + (this.pos.z - (l.az + l.bz) / 2) ** 2 > rr * rr) continue;
      const tc = clamp(((this.pos.x - l.ax) * ex + (this.pos.z - l.az) * ez) / ll, 0, 1), len = Math.sqrt(ll);
      for (let o = -Math.max(1.4, CAR.hl); o <= Math.max(1.4, CAR.hl) + 0.01; o += 0.7) { const u = clamp(tc + o / len, 0, 1); hit(l.ax + ex * u, l.az + ez * u, l.top - l.rad, l.rad + 0.05, l.top); }
    }
  }
  // car-to-car contact against other crews' cars (their latest known pose): three circles along each body
  bump(others) {
    // slipstream: tucked in 3-22 m behind a car doing over 36 km/h cuts your drag by up to 45%
    { let dr = 0; const fw = this.tmp.f.set(0, 0, 1).applyQuaternion(this.q); for (const o of others) { const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, al = dx * fw.x + dz * fw.z, lat = Math.abs(dx * fw.z - dz * fw.x); if (al > 3 && al < 22 && lat < 1.9 && o.vel.lengthSq() > 100) dr = Math.max(dr, 1 - (al - 3) / 19); } this.draft = lerp(this.draft || 0, dr, 0.05); }
    const me = [-1.35, 0, 1.35].map(z => new THREE.Vector3(0, 0, z).applyQuaternion(this.q).add(this.pos));
    for (const o of others) {
      if (Math.abs(o.pos.y - this.pos.y) > 1.6 || o.pos.distanceToSquared(this.pos) > 36) continue;
      const them = [-1.35, 0, 1.35].map(z => new THREE.Vector3(0, 0, z).applyQuaternion(o.q).add(o.pos));
      for (const A of me) for (const Bc of them) {
        const dx = A.x - Bc.x, dz = A.z - Bc.z, d = Math.hypot(dx, dz); if (d >= 1.85 || d < 1e-4) continue;
        const n = new THREE.Vector3(dx / d, 0, dz / d), pen = 1.85 - d; this.pos.addScaledVector(n, pen * 0.5);
        const P = A.clone().addScaledVector(n, -0.92), vrel = this.pointVel(P, new THREE.Vector3()).sub(o.vel), vn = vrel.dot(n);
        if (vn >= 0) continue;
        const j = -1.25 * vn / (this.invMass(P, n) + 1 / CAR.m); this.impulse(P, n.multiplyScalar(j));
        if (-vn > 2.5) { this.dmg = Math.min(1, this.dmg + (-vn - 2.5) * 0.008 / (CAR.tough || 1)); this.events.push({ k: 'crash', v: -vn }); }
      }
    }
  }
  // compact state for the navigator (sent ~30 Hz)
  pack(stage) {
    const r = (x, k) => Math.round(x * k) / k;
    return { t: 'car', p: [r(this.pos.x, 100), r(this.pos.y, 100), r(this.pos.z, 100)], q: [r(this.q.x, 1e4), r(this.q.y, 1e4), r(this.q.z, 1e4), r(this.q.w, 1e4)], v: [r(this.v.x, 10), r(this.v.y, 10), r(this.v.z, 10)],
      rpm: this.rpm | 0, g: this.gear, st: r(this.steer, 100), th: r(this.thr, 100), sl: r(this.slide, 100), of: r(this.offroad, 10), c: this.wh.map(w => r(w.comp, 100)), dm: r(this.dmg, 100), pr: r(this.prog, 10), air: this.air > 0 ? 1 : 0, ...stage };
  }
}
