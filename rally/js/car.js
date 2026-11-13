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
const torqueAt = rpm => { const x = rpm / 1000; return x < 2.5 ? 230 + 60 * x : x < 4.5 ? 380 + 20 * (x - 2.5) : x < 6.5 ? 420 - 8 * (x - 4.5) : 404 - 70 * (x - 6.5); };

class Car {
  constructor(S) {
    this.S = S; this.pos = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.wh = CAR.wheels.map((a, i) => ({ a: new THREE.Vector3(...a), comp: 0, pc: 0, contact: false, spin: 0, steer: 0, slip: 0, load: 0, front: i < 2, surf: 0, cp: new THREE.Vector3() }));
    this.steer = 0; this.thr = 0; this.brk = 0; this.gear = 1; this.rpm = CAR.idle; this.shiftT = 0; this.dmg = 0; this.air = 0; this.events = [];
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), f: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(), q: new THREE.Quaternion(), F: new THREE.Vector3(), T: new THREE.Vector3() };
    this.near = []; this.speed = 0; this.prog = 0; this.lat = 0; this.offroad = 0; this.slide = 0;
  }
  place(s, lat) {
    for (const l of this.S.logs) if (l.s - s < 18 && l.s - s > -6) s = l.s - 20;
    const S = this.S, p = S.at(s), rx = -Math.cos(p.h), rz = Math.sin(p.h);
    const x = p.x + rx * (lat || 0), z = p.z + rz * (lat || 0);
    this.pos.set(x, S.heightAt(x, z) + 0.62, z); this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.h); this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wh) { w.comp = w.pc = 0.12; w.cv = 0; w.spin = 0; } this.steer = 0; this.wrecked = false; this.gear = 1; this.rpm = CAR.idle; this.prog = s;
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
    const maxS = 0.6 / (1 + Math.max(0, spd - 4) / 24), st = inp.steer;
    let target = st * maxS;
    if (vF > 3) target += (1 - Math.abs(st) * 0.6) * clamp(beta * 0.85, -0.42, 0.42) * sstep(0.04, 0.22, Math.abs(beta));
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 7 : 5) * (1 + Math.abs(beta));
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    // throttle / brake / reverse logic
    let thr = inp.thr, brk = inp.brk;
    if (this.gear > 0 && brk > 0.1 && vF < 0.8 && thr < 0.1) { this.gear = -1; }
    else if (this.gear < 0 && thr > 0.1 && vF > -0.8) { this.gear = 1; }
    if (this.gear < 0) { const x = thr; thr = brk; brk = x; }
    this.thr += clamp(thr - this.thr, -8 * dt, 6 * dt); this.brk += clamp(brk - this.brk, -10 * dt, 8 * dt);
    const hb = inp.hb ? 1 : 0;
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
      if (this.rpm > CAR.red - 350 && this.gear < 6 && this.air <= 0.05) { this.gear++; this.shiftT = 0.13; this.events.push({ k: 'shift', up: 1 }); }
      else if (this.gear > 1) { const lower = tgtRpm * CAR.gears[this.gear - 2] / CAR.gears[this.gear - 1]; if (lower < CAR.red - 1500 && (tgtRpm < 3300 || (this.brk > 0.3 && lower < CAR.red - 1900))) { this.gear--; this.shiftT = 0.1; this.events.push({ k: 'shift', up: 0 }); } }
    }
    const limiter = this.rpm > CAR.red - 20 ? 0.15 : 1;
    const engT = this.shiftT > 0 ? 0 : torqueAt(this.rpm) * this.thr * limiter, driveTotal = engT * ksh * 0.9 / CAR.r; // N at the contact patches
    // ---- suspension + tyres ----
    let contacts = 0, slideSum = 0, offSum = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wh[i], A = this.toWorld(w.a, t.a).add(this.pos).clone(), down = up.clone().negate();
      let tt = 0; for (let it = 0; it < 3; it++) { const px = A.x + down.x * tt, pz = A.z + down.z * tt; tt = (A.y - S.heightAt(px, pz)) / Math.max(0.3, up.y); }
      const len = CAR.rest + CAR.r;
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
      const mu = (onRoad ? 1.25 : 0.82) * (1 - this.dmg * 0.15), Fz = Math.min(w.load, 9000), fmax = mu * Fz * (1 - 0.06 * Fz / 4000); // tyre load sensitivity
      // longitudinal
      let fx = 0, locked = false;
      const share = w.front ? (1 - CAR.split) / 2 : CAR.split / 2;
      if (this.gear !== 0) fx += driveTotal * share * Math.sign(ratio);
      const bf = this.brk * CAR.brake * (w.front ? CAR.brakeBias : 1 - CAR.brakeBias) / 2;
      fx -= Math.sign(vx) * Math.min(bf, Math.abs(vx) * CAR.m * 2);
      if (hb && !w.front) { locked = true; fx = -Math.sign(vx) * Math.min(fmax * 0.85, Math.abs(vx) * CAR.m); }
      if (!onRoad) fx -= vx * 140; // soft ground drag
      fx -= vx * 6;               // rolling resistance
      // lateral: slip angle curve, softer and wider on gravel
      const slipA = Math.atan2(vy, Math.max(Math.abs(vx), 3.5));
      const Bc = onRoad ? 10 : 7, Cc = 1.15, curve = Math.sin(Cc * Math.atan(Bc * slipA));
      let fy = -fmax * curve * (locked ? 0.45 : 1);
      if (Math.abs(vx) < 3) { const lowS = -vy * CAR.m * 0.25 * 8; fy = lerp(lowS, fy, Math.abs(vx) / 3); fy = clamp(fy, -fmax, fmax); }
      // friction circle (longitudinal first, then whatever grip is left for cornering)
      const mag = Math.hypot(fx, fy * 0.85); if (mag > fmax) { const kk = fmax / mag; fx *= kk; fy *= Math.min(1, kk * 1.35); }
      const tf = new THREE.Vector3().addScaledVector(wf, fx).addScaledVector(wl, fy);
      F.add(tf); T.add(t.b.crossVectors(t.c.subVectors(cp, this.pos).addScaledVector(up, 0.32), tf)); // force applied a little above the patch: lower effective roll centre
      // wheel spin (visual, sound, rpm): free-rolling plus wheelspin when drive exceeds grip
      const roll = vx / CAR.r, drv = this.gear !== 0 ? driveTotal * share * Math.sign(ratio) : 0, excess = Math.abs(drv) > fmax ? (Math.abs(drv) - fmax) / CAR.m * 0.9 : 0;
      const tgtSpin = locked ? 0 : roll + Math.sign(drv) * excess * 4 / CAR.r;
      w.spin += (tgtSpin - w.spin) * Math.min(1, dt * 25);
      w.slip = Math.min(1, Math.abs(slipA) * 2.2 + (locked ? Math.min(1, Math.abs(vx) / 6) : 0) + excess * 0.4);
      slideSum += w.slip;
    }
    // anti-roll: transfer between left and right on each axle
    for (const [a, b] of [[0, 1], [2, 3]]) { const wa = this.wh[a], wb = this.wh[b]; if (!wa.contact && !wb.contact) continue; const d = (wa.comp - wb.comp) * CAR.arb, Pa = this.toWorld(wa.a, t.a).add(this.pos).clone(), Pb = this.toWorld(wb.a, t.a).add(this.pos).clone(); T.add(t.b.crossVectors(t.c.subVectors(Pa, this.pos), t.d.copy(up).multiplyScalar(d))); T.add(t.b.crossVectors(t.c.subVectors(Pb, this.pos), t.d.copy(up).multiplyScalar(-d))); }
    if (contacts >= 3 && !hb) {
      const yaw = this.w.dot(up), want = vF * Math.tan(this.steer) / 2.51, err = yaw - want;
      T.addScaledVector(up, -err * CAR.I[1] * 6 * sstep(2, 8, Math.abs(vF)));
      // bleed off sideways sliding so the car goes where it points
      const vLat = this.v.dot(left); F.addScaledVector(left, -vLat * CAR.m * 1.0 * sstep(2, 6, Math.abs(vF)));
    }
    if (contacts && this.air > 0.25 && this.v.y > 0) this.v.y *= 0.3; // kill the rebound after a jump landing
    this.air = contacts === 0 ? this.air + dt : 0; this.slide = slideSum / 4; this.offroad = offSum / 4;
    // aero drag
    F.addScaledVector(this.v, -0.62 * spd);
    // integrate
    this.v.addScaledVector(F, dt / CAR.m); this.angAccel(T, dt);
    this.w.multiplyScalar(1 - dt * (contacts ? 0.3 : 0.9));
    if (contacts === 0) { // a touch of stability in the air so jumps are fun, not random
      const wl = this.w.clone().applyQuaternion(t.q.copy(this.q).invert()); wl.x *= 1 - dt * 1.2; wl.z *= 1 - dt * 1.2; this.w.copy(wl.applyQuaternion(this.q));
    }
    this.pos.addScaledVector(this.v, dt);
    const wq = t.q.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).multiply(this.q);
    this.q.x += wq.x; this.q.y += wq.y; this.q.z += wq.z; this.q.w += wq.w; this.q.normalize();
    this.bodyContacts(dt); this.collide();
    // stage progress (ignore jumps to another road branch)
    const q = S.near(this.pos.x, this.pos.z, 60);
    if (q) { this.lat = q.lat; if (Math.abs(q.s - this.prog) < 40) this.prog = q.s; this.roadD = q.d; } else this.roadD = 99;
  }
  // box corners against the ground (stops the body sinking when it lands hard or rolls)
  bodyContacts(dt) {
    const S = this.S, t = this.tmp;
    for (const cx of [-0.88, 0.88]) for (const cy of [-0.12, 1.05]) for (const cz of [-2.0, 2.0]) {
      const P = this.toWorld(t.a.set(cx, cy, cz), new THREE.Vector3()).add(this.pos), gy = S.heightAt(P.x, P.z), pen = gy - P.y;
      if (pen <= 0) continue;
      const n = S.normalAt(P.x, P.z, new THREE.Vector3()); this.pos.addScaledVector(n, pen * 0.6);
      const pv = this.pointVel(P, new THREE.Vector3()), vn = pv.dot(n);
      if (vn < 0) {
        const j = -vn / this.invMass(P, n); this.impulse(P, n.clone().multiplyScalar(j));
        const vt = pv.clone().addScaledVector(n, -vn), vtl = vt.length(); if (vtl > 0.01) { const jt = Math.min(vtl / this.invMass(P, vt.clone().normalize()), j * 0.6); this.impulse(P, vt.multiplyScalar(-jt / vtl)); }
        if (-vn > 3) { this.dmg = Math.min(1, this.dmg + (-vn - 3) * 0.01); this.events.push({ k: 'thud', v: -vn }); }
      }
    }
  }
  collide() {
    const S = this.S, t = this.tmp, iq = new THREE.Quaternion().copy(this.q).invert();
    const hit = (cx, cz, cy, r, topY) => {
      const L = new THREE.Vector3(cx - this.pos.x, cy - this.pos.y, cz - this.pos.z).applyQuaternion(iq);
      if (topY !== undefined && this.pos.y - 0.3 > topY) return;
      if (L.y < -1.2 || L.y > 1.6) return;
      const px = clamp(L.x, -CAR.hw, CAR.hw), pz = clamp(L.z, -CAR.hl, CAR.hl); let dx = px - L.x, dz = pz - L.z, d = Math.hypot(dx, dz);
      if (d >= r) return;
      let nl;
      if (d < 1e-4) { const ox = CAR.hw - Math.abs(L.x), oz = CAR.hl - Math.abs(L.z); nl = ox < oz ? new THREE.Vector3(-Math.sign(L.x), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(L.z)); d = -Math.min(ox, oz); }
      else nl = new THREE.Vector3(dx / d, 0, dz / d);
      const n = nl.applyQuaternion(this.q); n.y = 0; n.normalize();
      const pen = r - d; this.pos.addScaledVector(n, pen);
      const P = new THREE.Vector3(px, 0.1, pz).applyQuaternion(this.q).add(this.pos), pv = this.pointVel(P, new THREE.Vector3()), vn = pv.dot(n);
      if (vn >= 0) return;
      const j = -vn * 1.2 / this.invMass(P, n); this.impulse(P, n.clone().multiplyScalar(j));
      const vt = pv.clone().addScaledVector(n, -vn); vt.y = 0; const vtl = vt.length(); if (vtl > 0.01) { const jt = Math.min(vtl / this.invMass(P, vt.clone().normalize()) * 0.5, j * 0.5); this.impulse(P, vt.multiplyScalar(-jt / vtl)); }
      const sev = -vn; if (sev > 2) { this.dmg = Math.min(1, this.dmg + (sev - 2) * 0.012); this.events.push({ k: 'crash', v: sev }); }
      if (sev > 9 && !this.wrecked) { this.wrecked = true; this.events.push({ k: 'wreck', v: sev }); }
    };
    for (const tr of S.treesNear(this.pos.x, this.pos.z, this.near)) hit(tr.x, tr.z, tr.y + 0.6, tr.r);
    for (const l of S.logs) {
      const ex = l.bx - l.ax, ez = l.bz - l.az, ll = ex * ex + ez * ez; if ((this.pos.x - l.ax) ** 2 + (this.pos.z - l.az) ** 2 > 100) continue;
      const tc = clamp(((this.pos.x - l.ax) * ex + (this.pos.z - l.az) * ez) / ll, 0, 1), len = Math.sqrt(ll);
      for (const o of [-1.4, -0.7, 0, 0.7, 1.4]) { const u = clamp(tc + o / len, 0, 1); hit(l.ax + ex * u, l.az + ez * u, l.top - l.rad, l.rad + 0.05, l.top); }
    }
  }
  // compact state for the navigator (sent ~30 Hz)
  pack(stage) {
    const r = (x, k) => Math.round(x * k) / k;
    return { t: 'car', p: [r(this.pos.x, 100), r(this.pos.y, 100), r(this.pos.z, 100)], q: [r(this.q.x, 1e4), r(this.q.y, 1e4), r(this.q.z, 1e4), r(this.q.w, 1e4)], v: [r(this.v.x, 10), r(this.v.y, 10), r(this.v.z, 10)],
      rpm: this.rpm | 0, g: this.gear, st: r(this.steer, 100), th: r(this.thr, 100), sl: r(this.slide, 100), of: r(this.offroad, 10), c: this.wh.map(w => r(w.comp, 100)), dm: r(this.dmg, 100), pr: r(this.prog, 10), air: this.air > 0 ? 1 : 0, ...stage };
  }
}
