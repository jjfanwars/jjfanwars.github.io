'use strict';
// AI rival cars for solo races and championships: real Car physics, a road-following driver, contact with you and each other.
const BOT_COL = [0xc62828, 0x2e7d32, 0xf2b632, 0x7b3fbf, 0xe86a1a, 0x1aa6b8];
const Bots = {
  list: [],
  // names: [{ n, s }] where s is a skill factor (lower = faster, ~0.86..1.13)
  spawn(S, names, startS, myIdx) {
    this.clear(); const n = names.length;
    names.forEach((r, i) => {
      const k = i < myIdx ? i : i + 1, gs = startS - 3 - Math.floor(k / 2) * 9, lat = k % 2 ? 1.9 : -1.9;
      const car = new Car(S); car.place(gs, lat);
      const look = CARS[(i * 3 + 1) % CARS.length].look, col = BOT_COL[i % BOT_COL.length];
      const view = new CarView(World.scene, { color: col, remote: true, look });
      const tag = this.tag(r.n, col);
      // skill -> pace: grip used for corner speed, straight-line cap, braking
      const pace = clamp(1 - (r.s - 0.86) * 1.5, 0.58, 1);
      this.list.push({ name: r.n, ref: r, car, view, tag, col, gs, lat, lane: lat * 0.5, pace, stuck: 0, recT: 0, fin: 0, adapt: { pos: car.pos, q: car.q, vel: car.v }, st: { comp: [0.1, 0.1, 0.1, 0.1], sw: [1, 1, 0, 0, 0, 0] } });
    });
    return this.list;
  },
  tag(text, col) {
    const tc = document.createElement('canvas'); tc.width = 256; tc.height = 64; const x = tc.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.fillRect(0, 0, 10, 64);
    x.fillStyle = '#fff'; x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 133, 33);
    const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tt, depthTest: false, transparent: true })); sp.scale.set(2.6, 0.65, 1); sp.renderOrder = 9; World.scene.add(sp); return sp;
  },
  clear() { this.list = []; },
  // the driver: aim at a point on the road ahead, pick a speed the next corners allow
  drive(b, dt, phase, finishS) {
    const c = b.car, S = c.S;
    if (phase === 'count') { c.step(dt, { steer: 0, thr: 0, brk: 0, hb: 1 }); c.v.set(0, 0, 0); c.place(b.gs, b.lat); return; }
    const spd = c.speed, s0 = c.prog;
    // steering target: a lookahead point on the racing lane
    // obstacles (logs, rocks, barriers): steer for the open side and ease off
    let ov = null, obsD = 1e9;
    for (const l of S.logs) { const d = l.s - s0; if (d < -4 || d > 75) continue;
      if (l.lmin === undefined) { const A = S.near(l.ax, l.az, 30), B2 = S.near(l.bx, l.bz, 30), la = A ? A.lat : -ROAD_HW, lb = B2 ? B2.lat : ROAD_HW; l.lmin = Math.min(la, lb) - l.rad - 1.1; l.lmax = Math.max(la, lb) + l.rad + 1.1; }
      const hw = ROAD_HW + 0.6, gapL = l.lmin + hw, gapR = hw - l.lmax;
      ov = gapR >= gapL ? (l.lmax + hw) / 2 : (l.lmin - hw) / 2; obsD = d; break; }
    if (ov !== null) b.lane += (ov - b.lane) * Math.min(1, dt * 5); else b.lane += ((b.laneT || 0) - b.lane) * Math.min(1, dt * 0.8);
    const la = clamp(7 + spd * 0.75, 7, 34), p = S.at(s0 + la), rx = -Math.cos(p.h), rz = Math.sin(p.h);
    const tx = p.x + rx * b.lane - c.pos.x, tz = p.z + rz * b.lane - c.pos.z;
    const iq = new THREE.Quaternion().copy(c.q).invert(), L = new THREE.Vector3(tx, 0, tz).applyQuaternion(iq);
    const ang = Math.atan2(L.x, L.z), steer = clamp(ang * 2.6, -1, 1);
    // speed: slowest of what each corner ahead allows, given braking distance
    const mu = 0.56 * b.pace * ((World.B && World.B.grip) || 1.4) / 1.4, dec = 7 * b.pace;
    let vt = 40 * b.pace;
    for (let d = 4; d < 150; d += 8) {
      const h0 = S.at(s0 + d).h, h1 = S.at(s0 + d + 10).h, k = Math.abs(wrapA(h1 - h0)) / 10 + 1e-4;
      const vc = Math.sqrt(mu * 9.81 / k), va = Math.sqrt(vc * vc + 2 * dec * Math.max(0, d - 6)); if (va < vt) vt = va;
    }
    if (obsD < 60) vt = Math.min(vt, 16 + obsD * 0.35);
    if (s0 >= finishS) vt = 0; // finished: roll to a stop
    if (Math.abs(ang) > 0.5) vt = Math.min(vt, 10);
    const thr = (spd < vt - 0.5 ? 1 : spd < vt + 0.5 ? 0.35 : 0) * (0.5 + 0.5 * b.pace), brk = spd > vt + 1.5 ? clamp((spd - vt) / 6, 0.25, 1) : 0;
    c.step(dt, { steer, thr, brk, hb: 0 });
    c.events.length = 0;
  },
  // stuck, flipped, wrecked or lost in the woods: put it back on the road
  watch(b, dt, phase) {
    if (phase !== 'run' && phase !== 'fin') return; const c = b.car, up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.q).y;
    const bad = c.wrecked || up < 0.3 || (c.speed < 1.5 && c.prog < (G.finishS || 1e9)) || c.roadD > ROAD_HW + 4;
    b.stuck = bad ? b.stuck + dt : 0;
    if (b.stuck > (c.wrecked ? 1.5 : 2.5)) { b.stuck = 0; b.recN = (b.recN || 0) + 1; c.place(Math.max(World.startS, c.prog - 6), b.lane); c.dmg = Math.min(1, c.dmg); }
  },
  step(dt, phase, t, player) {
    const all = this.list;
    for (const b of all) {
      // drift across the road now and then; move over when someone is right ahead
      b.laneT = b.laneT === undefined ? b.lane : b.laneT; if (Math.random() < dt * 0.15) b.laneT = (Math.random() - 0.5) * 2.4;
      this.drive(b, dt, phase, G.finishS);
      if (phase !== 'count') { const others = all.filter(o => o !== b).map(o => o.adapt); if (player) others.push(player); b.car.bump(others); }
      this.watch(b, dt, phase);
      if (!b.fin && phase !== 'count' && b.car.prog >= G.finishS) b.fin = Math.round(t * 100) / 100;
    }
  },
  // estimated finish for a car still running (for standings when you finish first)
  eta(b, t) { if (b.fin) return b.fin; const left = Math.max(0, G.finishS - b.car.prog), done = Math.max(1, b.car.prog - G.startS), avg = Math.max(8, done / Math.max(1, t)); return t + left / avg; },
  render(dt, look, camPos) {
    const fv = new THREE.Vector3();
    for (const b of this.list) {
      const c = b.car, st = b.st; fv.set(0, 0, 1).applyQuaternion(c.q);
      st.pos = c.pos; st.q = c.q; st.vel = c.v; st.steer = c.steer; for (let i = 0; i < 4; i++) st.comp[i] = c.wh[i].comp; st.speedF = c.v.dot(fv); st.spinW = c.wh[2].spin; st.hb = 0; st.dmg = c.dmg; st.speed = c.speed;
      b.view.update(st, dt, 'x', look, null);
      const d = c.pos.distanceTo(camPos); b.tag.visible = d < 140 && d > 4; b.tag.position.copy(c.pos).y += 1.9;
      // dust behind them
      if (c.speed > 6 && c.air <= 0 && d < 100 && Math.random() < 0.25 * (World.B.dustK || 1)) {
        const side = Math.random() < 0.5 ? 0.8 : -0.8, P = new THREE.Vector3(side, -0.6, -1.4).applyQuaternion(c.q).add(c.pos), col = World.B.dust;
        World.puff(P.x, P.y, P.z, c.v.x * 0.25 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.6, c.v.z * 0.25 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.6, 1.0 + Math.random() * 1.0, col[0], col[1], col[2]);
      }
    }
  }
};
