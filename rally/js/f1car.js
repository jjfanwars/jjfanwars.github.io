'use strict';
// James Racing: F1 car physics (planar two-axle model with Pacejka-style tyres, load transfer, downforce, drag, DRS, ERS,
// 8-speed gearbox, brake lock-up, wheelspin, tyre temperature and wear, barrier impacts) and the AI driver.
const F1 = (() => {
  const A = F1T.AERO, M = A.mass, G = A.g, L = 3.6, CA = 1.98, CB = 1.62, HCG = 0.26, IZ = 1150, RW = 0.36;
  const GEARS = [16.3, 13.66, 11.45, 9.6, 8.04, 6.74, 5.65, 4.73], REV = 12500, IDLE = 4000;
  const COMP = { S: { mu: 1.035, wear: 1.7, col: '#e8312b', name: 'Soft' }, M: { mu: 1, wear: 1, col: '#f5d000', name: 'Medium' }, H: { mu: 0.97, wear: 0.55, col: '#eeeeee', name: 'Hard' } };
  const SURF = [{ mu: 1, drag: 0 }, { mu: 0.93, drag: 0 }, { mu: 0.5, drag: 700 }, { mu: 0.4, drag: 2600 }, { mu: 0.96, drag: 0 }];
  const pac = a => Math.sin(1.45 * Math.atan(22 * a));
  const icePower = rpm => rpm < 3000 ? 0 : rpm < 10800 ? 560000 * Math.pow((rpm - 3000) / 7800, 0.75) : rpm < 11800 ? 560000 : 560000 * (1 - (rpm - 11800) / 9000);

  class Car {
    constructor(T, o) {
      this.T = T; this.id = o.id; this.name = o.name; this.team = o.team; this.ai = !!o.ai; this.skill = o.skill || 1;
      const p = T.at(o.s), d = o.d || 0; this.x = p.x - Math.sin(p.h) * d; this.z = p.z + Math.cos(p.h) * d; this.h = p.h;
      this.vx = 0; this.vy = 0; this.r = 0; this.ax = 0; this.ay = 0; this.delta = 0;
      this.gear = 1; this.rpm = IDLE; this.shiftT = 0; this.thr = 0; this.brk = 0;
      this.comp = o.comp || 'M'; this.tf = this.tr = 85; this.wear = 0; this.ers = 4e6; this.ersMode = 1; this.drs = false; this.drsOK = false;
      this.dmg = 0; this.wing = 0; this.spinR = 0; this.lockF = 0; this.lockR = 0; this.surfF = 0; this.surfR = 0; this.kerb = 0; this.off = 0;
      this.q = T.query(this.x, this.z, -1); this.idx = this.q.i; this.dist = o.s; // grid is behind the line (negative): crossing it starts lap 1
      this.abs = o.abs !== undefined ? o.abs : true; this.tc = o.tc !== undefined ? o.tc : 1; this.auto = o.auto !== undefined ? o.auto : true; this.bias = 0.56;
      this.hit = 0; this.revT = 0; this.ev = [];
    }
    get v() { return Math.hypot(this.vx, this.vy); }
    gearUp() { if (this.gear < 8 && this.shiftT <= 0) { this.gear = this.gear < 1 ? 1 : this.gear + 1; this.shiftT = 0.12; this.ev.push('up'); } }
    gearDown() { if (this.gear > 1 && this.shiftT <= 0) { const nr = this.wheelRpm(this.gear - 1); if (nr < REV + 300) { this.gear--; this.shiftT = 0.12; this.ev.push('down'); } else this.ev.push('deny'); } }
    wheelRpm(g) { return Math.abs(this.vx) / RW * (g < 1 ? 15 : GEARS[g - 1]) * 60 / (2 * Math.PI); }
    // inp: thr, brk 0..1, steer -1..1 (wheel angle = steer * 0.34 rad), drs bool, rev bool (S held at a stop)
    step(dt, inp) {
      const T = this.T, q = this.q, n = Math.max(1, Math.round(dt * 240)), h = dt / n;
      this.thr = inp.thr; this.brk = inp.brk;
      // reverse: hold the brake at a standstill
      if (this.gear >= 1 && this.v < 0.6 && inp.brk > 0.5 && inp.thr < 0.1) { this.revT += dt; if (this.revT > 0.6) { this.gear = -1; this.ev.push('down'); } } else this.revT = 0;
      if (this.gear === -1 && inp.thr > 0.1 && this.vx > -0.5) this.gear = 1;
      const wantD = clamp(inp.steer, -1, 1) * 0.34; this.delta += clamp(wantD - this.delta, -3.2 * dt, 3.2 * dt);
      // auto gearbox
      if (this.shiftT > 0) this.shiftT -= dt;
      if (this.auto && this.gear >= 1 && this.shiftT <= 0) {
        if (this.rpm > 11850 && this.gear < 8 && inp.thr > 0.2) this.gearUp();
        else if (this.gear > 1 && this.wheelRpm(this.gear - 1) < (inp.brk > 0.2 ? 11000 : 9300)) this.gearDown();
      }
      // DRS opens only inside a zone when allowed, shuts on the brakes
      let inZ = false; for (const z of T.drs) { const a = z.a, b = z.b, i = this.idx; if (a < b ? i >= a && i < b : i >= a || i < b) inZ = true; }
      if (!inZ || inp.brk > 0.05) this.drs = false; else if (inp.drs && this.drsOK) this.drs = true;
      this.inDRS = inZ;
      for (let k = 0; k < n; k++) this.sub(h, inp);
      // tyres: heat from sliding work, cooled by airflow
      const C = COMP[this.comp];
      for (const ax of ['tf', 'tr']) { const P = ax === 'tf' ? this.slipPF : this.slipPR; this[ax] += (P * 1e-5 + this.v * 0.02 - (this[ax] - 30) * (0.004 + this.v * 0.00025)) * dt * 1.5; this[ax] = clamp(this[ax], 30, 160); }
      this.wear = Math.min(1, this.wear + (this.slipPF + this.slipPR) * 1.6e-10 * C.wear * dt * 60);
      // track position and progress
      const prevS = q.s; T.query(this.x, this.z, this.idx, q); this.idx = q.i;
      let dS = q.s - prevS; if (dS > T.len / 2) dS -= T.len; if (dS < -T.len / 2) dS += T.len; this.dist += dS;
      this.barrier(dt);
    }
    sub(dt, inp) {
      const T = this.T, q = this.q, C = COMP[this.comp], v = Math.hypot(this.vx, this.vy), ch = Math.cos(this.h), sh = Math.sin(this.h);
      // surface under each axle (wheel track 1.6 m)
      const i = q.i, dAx = (q.d) , dyaw = wrapA(this.h - q.h);
      const dF = dAx + Math.sin(dyaw) * CA, dR = dAx - Math.sin(dyaw) * CB;
      const sw = (dd) => { const s1 = T.surf(i, dd - 0.8), s2 = T.surf(i, dd + 0.8); return [s1, s2]; };
      const [f1, f2] = sw(dF), [r1, r2] = sw(dR);
      const muF = (SURF[f1].mu + SURF[f2].mu) / 2, muR = (SURF[r1].mu + SURF[r2].mu) / 2;
      const sDrag = (SURF[f1].drag + SURF[f2].drag + SURF[r1].drag + SURF[r2].drag) * Math.min(1, v / 8);
      this.surfF = Math.max(f1, f2); this.surfR = Math.max(r1, r2); this.kerb = (f1 === 1 || f2 === 1 || r1 === 1 || r2 === 1) ? 1 : 0;
      this.off = [f1, f2, r1, r2].filter(s => s >= 2 && s !== 4).length; this.lim = [f1, f2, r1, r2].filter(s => s >= 2).length; this.surfs = [f1, f2, r1, r2];
      // aero
      const drsK = this.drs ? 1 : 0, tow = this.tow || 0, dyn = 0.5 * A.rho * v * v, down = dyn * A.ClA * (1 - 0.07 * drsK) * (1 - this.wing * 0.35) * (1 - 0.12 * tow); // dirty air
      const drag = dyn * A.CdA * (1 - 0.17 * drsK) * (1 - 0.2 * tow) + 0.012 * M * G + sDrag; // slipstream
      const frontAero = 0.41 - this.wing * 0.1;
      let Fzf = M * G * CB / L + down * frontAero - M * this.ax * HCG / L, Fzr = M * G * CA / L + down * (1 - frontAero) + M * this.ax * HCG / L;
      Fzf = Math.max(Fzf, 300); Fzr = Math.max(Fzr, 300);
      const tg = t => clamp(1 - ((t - 100) / 75) ** 2 * 0.55, 0.7, 1);
      const ls = (fz, st) => clamp(1 - 0.06 * (fz / st - 1), 0.82, 1.05);
      const mf = A.mu * C.mu * tg(this.tf) * (1 - 0.22 * this.wear) * muF * ls(Fzf, M * G * CB / L), mr = A.mu * C.mu * tg(this.tr) * (1 - 0.22 * this.wear) * muR * ls(Fzr, M * G * CA / L);
      const capF = mf * Fzf, capR = mr * Fzr * 1.1; // wider rears: stable at the limit
      // powertrain
      let drive = 0, eb = 0;
      if (this.gear === -1) { this.rpm = Math.max(IDLE, this.wheelRpm(-1)); drive = -inp.thr * 3500 * (this.vx > -6 ? 1 : 0); }
      else {
        const gr = GEARS[this.gear - 1], wr = this.wheelRpm(this.gear), clutch = this.gear === 1 && Math.abs(this.vx) < 14;
        let rpm = clutch ? Math.max(wr, lerp(IDLE, 10500, inp.thr) * (1 - Math.abs(this.vx) / 14) + wr * Math.abs(this.vx) / 14) : Math.max(wr, IDLE);
        this.rpm += (rpm - this.rpm) * Math.min(1, dt * 30);
        let P = icePower(this.rpm) * inp.thr * (this.rpm > REV ? 0 : 1);
        const dep = this.ersMode === 0 ? 0 : this.ersMode === 2 ? 160000 : 100000;
        if (inp.thr > 0.9 && this.rpm > 9000) this.ers = Math.min(4e6, this.ers + 70000 * dt); // MGU-H
        this.deploying = false;
        if (dep && inp.thr > 0.9 && this.ers > 0 && v > 5) { P += dep; this.ers = Math.max(0, this.ers - dep * dt); this.deploying = true; }
        if (this.shiftT > 0.09) P *= 0.6; // seamless shift: tiny torque dip
        const w = Math.max(this.rpm, 3000) * 2 * Math.PI / 60;
        drive = P / w * gr / RW;
        eb = (1 - inp.thr) * (900 + this.rpm / REV * 1400) * (this.vx > 1 ? 1 : 0);
      }
      // brakes
      const vsgn = this.vx >= 0 ? 1 : -1;
      let bF = inp.brk * 46000 * this.bias, bR = inp.brk * 46000 * (1 - this.bias) + eb;
      if (this.abs) { const yf = Math.min(0.9, Math.abs(this.FyF || 0) / capF), yr = Math.min(0.9, Math.abs(this.FyR || 0) / capR); bF = Math.min(bF, capF * Math.sqrt(1 - yf * yf) * 0.96); bR = Math.min(bR, capR * Math.sqrt(1 - yr * yr) * 0.93); }
      if (inp.brk > 0 && v > 1 && this.gear >= 1) { const hv = Math.min(120000, inp.brk * 46000 * v * 0.5) * dt; this.ers = Math.min(4e6, this.ers + hv * 0.6); }
      if (this.ersMode === 0 && inp.thr < 0.95 && v > 15) this.ers = Math.min(4e6, this.ers + 30000 * dt);
      // traction control
      if (this.tc && drive > 0) { const fy = Math.min(0.9, Math.abs(this.FyR || 0) / capR); drive = Math.min(drive, capR * Math.sqrt(1 - fy * fy) * (this.tc === 2 ? 0.85 : 0.95) + bR); const ar = Math.abs(this.aR || 0); if (ar > 0.075) drive *= Math.max(0.15, 1 - (ar - 0.075) * (this.tc === 2 ? 14 : 9)); }
      // longitudinal per axle with lock / spin states
      const fxF = bF, demR = drive - bR * vsgn;
      const lockFt = (bF > capF && Math.abs(this.vx) > 1.5) ? 1 : 0, lockRt = (-demR * vsgn > capR && Math.abs(this.vx) > 1.5) ? 1 : 0, spinT = demR * vsgn > capR * 1.0 && this.gear >= 1 ? 1 : 0;
      this.lockF += (lockFt - this.lockF) * Math.min(1, dt * 18); this.lockR += (lockRt - this.lockR) * Math.min(1, dt * 18); this.spinR += (spinT - this.spinR) * Math.min(1, dt * 14);
      let FxF = -vsgn * Math.min(fxF, capF * 0.999), FxR = clamp(demR, -capR * 0.999, capR * 0.999);
      FxF = lerp(FxF, -vsgn * capF * 0.82, this.lockF);
      if (this.lockR > 0.01) FxR = lerp(FxR, -vsgn * capR * 0.82, this.lockR); else FxR = lerp(FxR, Math.sign(demR) * capR * 0.85, this.spinR);
      if (Math.abs(this.vx) < 0.4 && inp.brk > 0.05 && Math.abs(demR) < bR + 50) { FxF = 0; FxR = -this.vx * M / dt * 0.5; }
      // lateral
      const vxe = Math.max(Math.abs(this.vx), 5) * (this.vx < -0.5 ? -1 : 1), d = this.delta;
      const aF = Math.atan2(this.vy + CA * this.r, Math.abs(vxe)) - d * Math.sign(vxe), aR = Math.atan2(this.vy - CB * this.r, Math.abs(vxe));
      const latF = Math.sqrt(Math.max(0.02, 1 - (FxF / capF) ** 2)) * lerp(1, 0.3, this.lockF), latR = Math.sqrt(Math.max(0.02, 1 - (FxR / capR) ** 2)) * lerp(1, 0.35, Math.max(this.lockR, this.spinR));
      const FyF = -capF * latF * pac(aF), FyR = -capR * latR * pac(aR);
      this.slipPF = Math.abs(FyF * Math.sin(aF) * v) + (this.lockF * capF + 0) * Math.abs(this.vx) * 0.5;
      this.slipPR = Math.abs(FyR * Math.sin(aR) * v) + (this.spinR + this.lockR) * capR * 2;
      const cd = Math.cos(d), sd = Math.sin(d);
      const Fx = FxR + FxF * cd - FyF * sd - drag * (this.vx >= 0 ? 1 : -1) * Math.abs(this.vx) / Math.max(v, 0.01);
      const Fy = FyR + FxF * sd + FyF * cd - drag * this.vy / Math.max(v, 0.01) * 0;
      const Mz = CA * (FyF * cd + FxF * sd) - CB * FyR - this.r * v * 90; // floor/diffuser yaw damping
      const axl = Fx / M, ayl = Fy / M;
      this.vx += (axl + this.r * this.vy) * dt; this.vy += (ayl - this.r * this.vx) * dt; this.r += Mz / IZ * dt;
      if (v < 5) { const k = 1 - v / 5; this.vy *= 1 - k * dt * 8; this.r = lerp(this.r, this.vx * Math.tan(d) / L, k * Math.min(1, dt * 10)); }
      this.ax += (axl - this.ax) * Math.min(1, dt * 12); this.ay += (ayl - this.ay) * Math.min(1, dt * 12);
      this.h += this.r * dt;
      this.x += (this.vx * ch - this.vy * sh) * dt; this.z += (this.vx * sh + this.vy * ch) * dt;
      this.FyF = FyF; this.FyR = FyR; this.capF = capF; this.capR = capR; this.aF = aF; this.aR = aR;
    }
    // walls: push back, bounce the normal part, scrub some speed, damage on square hits
    barrier(dt) {
      const T = this.T, i = this.idx, q = this.q, nx = -Math.sin(q.h), nz = Math.cos(q.h), dy = wrapA(this.h - q.h);
      const ext = 2.7 * Math.abs(Math.sin(dy)) + 1.0 * Math.abs(Math.cos(dy));
      const R = T.barR[i] - 0.15, Lb = T.barL[i] - 0.15;
      let side = 0, pen = 0;
      if (q.d + ext > R) { side = 1; pen = q.d + ext - R; } else if (q.d - ext < -Lb) { side = -1; pen = -Lb - (q.d - ext); }
      if (!side) return;
      const wx = this.vx * Math.cos(this.h) - this.vy * Math.sin(this.h), wz = this.vx * Math.sin(this.h) + this.vy * Math.cos(this.h);
      const ox = nx * side, oz = nz * side, vn = wx * ox + wz * oz;
      this.x -= ox * pen; this.z -= oz * pen; q.d -= side * pen;
      if (vn > 0) {
        let nwx = wx - 1.3 * vn * ox, nwz = wz - 1.3 * vn * oz; const tk = 1 - Math.min(0.5, vn * 0.03); nwx *= tk; nwz *= tk;
        this.vx = nwx * Math.cos(this.h) + nwz * Math.sin(this.h); this.vy = -nwx * Math.sin(this.h) + nwz * Math.cos(this.h);
        this.r *= 0.6; this.r += -side * Math.sign(Math.sin(dy) || 1) * vn * 0.05;
        if (vn > 2) { this.hit = Math.max(this.hit, vn); this.ev.push('wall:' + vn.toFixed(1)); }
        if (vn > 11) { this.wing = Math.min(1, this.wing + (vn - 11) * 0.04); this.dmg = Math.min(1, this.dmg + (vn - 11) * 0.03); }
      }
    }
  }

  // ---- AI driver ----
  function aiDrive(c, cars, dt) {
    const T = c.T, N = T.N, v = c.v, i = c.idx;
    if (!c.V) c.V = T.profile(0.9 + 0.08 * c.skill); if (!(c.ofs >= -99)) c.ofs = 0;
    // avoid cars ahead: pick a side, or follow
    let cap = 99, want = null; const myD = c.q.d, lim = T.hw - 1.3;
    for (const o of cars) {
      if (o === c) continue; const gap = o.dist - c.dist; if (gap < -6 || gap > 30) continue;
      const dl = o.q.d - myD;
      if (gap > 5 && Math.abs(dl) < 2.6 && v > o.v - 1) { // catching a car: go round it if there is room, else follow
        const left = o.q.d - 3, right = o.q.d + 3, canL = left > -lim, canR = right < lim;
        const tgt = canL && canR ? (Math.abs(left - T.L[i]) < Math.abs(right - T.L[i]) ? left : right) : canL ? left : canR ? right : null;
        const str = T.KS[T.wi(i + 30)] < 1 / 600 && T.KS[T.wi(i + 12)] < 1 / 600 && T.KS[i] < 1 / 600; // only pull out to pass on straights
        if (tgt !== null && gap < 22 && (str || Math.abs(c.ofs) > 1.5)) want = tgt - T.L[i];
        if (gap < 16 && !(str && tgt !== null)) cap = Math.min(cap, o.v - 0.5 + (gap - 8) * 0.4);
      } else if (Math.abs(gap) <= 5 && Math.abs(dl) < 2.7) { want = clamp(o.q.d + (dl > 0 ? -2.8 : 2.8), -lim, lim) - T.L[i]; if (gap > 0) cap = Math.min(cap, o.v + (T.KS[i] > 1 / 600 ? -1.5 : 1)); }
    }
    if (want !== null) c.ofs += clamp(want - c.ofs, -2.5 * dt, 2.5 * dt); else c.ofs -= Math.sign(c.ofs) * Math.min(Math.abs(c.ofs), 0.9 * dt);
    c.ofs = clamp(c.ofs, -lim - T.L[i], lim - T.L[i]);
    // steering: pure pursuit on the line
    const ld = 7 + v * 0.32, j = T.wi(i + Math.round(ld / T.ds)), tl = clamp(T.L[j] + c.ofs, -lim, lim);
    const offK = 1 - Math.min(0.25, Math.abs(c.ofs) * 0.035 * (T.KS[i] * 300));
    const tx = T.X[j] + T.nx[j] * tl, tz = T.Z[j] + T.nz[j] * tl, dx = tx - c.x, dz = tz - c.z, ch = Math.cos(c.h), sh = Math.sin(c.h);
    const lx = dx * ch + dz * sh, ly = -dx * sh + dz * ch, kap = 2 * ly / (lx * lx + ly * ly);
    let st = Math.atan(kap * L) / 0.34 + (kap * v - c.r) * 0.35 - c.vy * 0.01;
    // speed target a little ahead, with braking room
    const la = T.wi(i + Math.round((4 + v * 0.18) / T.ds)); let vt = Math.min(c.V[la] * offK * (1 - 0.07 * (c.tow || 0) * Math.min(1, T.KS[la] * 400)), c.V[i] + 4, cap);
    if (c.off) vt = Math.min(vt, 40);
    const slide = Math.abs(c.aR || 0);
    const err = vt - v; let thr = 0, brk = 0;
    if (err > 0) thr = clamp(0.35 + err * 0.35, 0, 1); else if (err > -1.2) thr = 0.25; else brk = clamp(-err * 0.18, 0, 1);
    brk *= clamp(1.25 - Math.abs(c.ay) / 40, 0.45, 1);
    if (slide > 0.06) thr *= Math.max(0, 1 - (slide - 0.06) * 12);
    // stuck or turned round: reverse off the wall
    if (c.stuck === undefined) c.stuck = 0;
    if ((v < 2 || (c.off >= 2 && v < 5)) && !c.hold) c.stuck += dt; else c.stuck = Math.max(0, c.stuck - dt);
    const ang = wrapA(c.h - c.q.h);
    if (c.stuck > 2.5 || Math.abs(ang) > 2.2) { if (c.stuck > 2.5 && c.stuck < 4) return { thr: 0, brk: 1, steer: 0 }; if (c.stuck >= 4 || Math.abs(ang) > 2.2) { c.wantReset = true; c.stuck = 0; } }
    return { thr, brk, steer: clamp(st, -1, 1), drs: true };
  }

  // car to car: three discs along each car, impulse along the contact normal
  function collide(cars) {
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
      const A1 = cars[a], B1 = cars[b]; if ((A1.x - B1.x) ** 2 + (A1.z - B1.z) ** 2 > 49) continue;
      for (const oa of [-1.8, 0, 1.8]) for (const ob of [-1.8, 0, 1.8]) {
        const ax = A1.x + Math.cos(A1.h) * oa, az = A1.z + Math.sin(A1.h) * oa, bx = B1.x + Math.cos(B1.h) * ob, bz = B1.z + Math.sin(B1.h) * ob;
        const dx = bx - ax, dz = bz - az, d2 = dx * dx + dz * dz; if (d2 > 1.9 * 1.9 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = 1.9 - d;
        A1.x -= nx * pen / 2; A1.z -= nz * pen / 2; B1.x += nx * pen / 2; B1.z += nz * pen / 2;
        const W = c => [c.vx * Math.cos(c.h) - c.vy * Math.sin(c.h), c.vx * Math.sin(c.h) + c.vy * Math.cos(c.h)];
        const [awx, awz] = W(A1), [bwx, bwz] = W(B1), rel = (bwx - awx) * nx + (bwz - awz) * nz;
        if (rel < 0) {
          const j = -rel * 0.6; const set = (c, wx, wz) => { c.vx = wx * Math.cos(c.h) + wz * Math.sin(c.h); c.vy = -wx * Math.sin(c.h) + wz * Math.cos(c.h); };
          set(A1, awx - nx * j, awz - nz * j); set(B1, bwx + nx * j, bwz + nz * j);
          A1.r += oa * j * 0.02 * (Math.cos(A1.h) * nz - Math.sin(A1.h) * nx); B1.r -= ob * j * 0.02 * (Math.cos(B1.h) * nz - Math.sin(B1.h) * nx);
          if (-rel > 1.5) { A1.ev.push('bump:' + (-rel).toFixed(1)); B1.ev.push('bump:' + (-rel).toFixed(1)); A1.hit = Math.max(A1.hit, -rel); B1.hit = Math.max(B1.hit, -rel); }
          if (-rel > 9) for (const c of [A1, B1]) { c.wing = Math.min(1, c.wing + (-rel - 9) * 0.04); }
        }
      }
    }
  }
  // slipstream / dirty air: how much each car is in the wake of another
  function wakes(cars) {
    for (const c of cars) { let w = 0; for (const o of cars) { if (o === c) continue; const gap = o.dist - c.dist; if (gap > 1 && gap < 40 && Math.abs(o.q.d - c.q.d) < 2.2) w = Math.max(w, 1 - gap / 40); } c.tow = w; }
  }
  // put a car back on the track, stopped, at its progress point
  function reset(c) {
    const T = c.T, s = c.q.s, p = T.at(s), l = clamp(c.q.d, -T.hw + 1.5, T.hw - 1.5) * 0.5 + T.L[p.i] * 0.5;
    c.x = p.x - Math.sin(p.h) * l; c.z = p.z + Math.cos(p.h) * l; c.h = p.h; c.vx = c.vy = c.r = 0; c.gear = 1; c.lockF = c.lockR = c.spinR = 0; T.query(c.x, c.z, c.idx, c.q);
  }
  return { Car, aiDrive, collide, reset, wakes, GEARS, COMP, REV, RW, L, CA, CB };
})();
