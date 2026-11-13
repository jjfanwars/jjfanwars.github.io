// Bot AI: perception, combat, navigation and objective tasks.
import { yawTo, angDiff } from './game.js';

const R = Math.random;

export class Bot {
  constructor(game, s) { this.g = game; this.s = s; s.bot = this; }

  setup(isAtk, idx) {
    const g = this.g, m = g.map, p = g.plan;
    this.tasks = []; this.path = null; this.pi = 0; this.repath = 0; this.goal = null;
    this.target = null; this.seenT = 0; this.react = 0.4; this.lastSeen = null; this.alert = null;
    this.thinkT = R() * 0.15; this.burst = 0; this.pause = 0; this.err = { x: 0, y: 0, t: 0 };
    this.timer = 0; this.meleeT = 0; this.stuckT = 0; this.stuckP = { x: this.s.pos.x, z: this.s.pos.z };
    this.moveYaw = this.s.yaw; this.lookT = 0; this.lookAt = null; this.idx = idx; this.wait = 0;
    if (isAtk) {
      const e = p.entries[idx % p.entries.length];
      const br = m.breaches.find(b => b.site === g.site);
      if (idx === 1 && br) {
        // breacher: enter, blow the wall next to the site, then push
        this.tasks.push({ t: 'goto', x: e[0][0], z: e[0][1], run: true }, { t: 'breach', b: br, st: 0 });
      } else this.tasks.push({ t: 'goto', x: e[0][0], z: e[0][1], run: true }, { t: 'goto', x: e[1][0], z: e[1][1] });
      this.tasks.push({ t: 'site' });
    } else {
      if (idx < 3) for (const k of [idx * 2, idx * 2 + 1]) { const r = p.reinf[k]; if (r) this.tasks.push({ t: 'reinforce', x: r[0], z: r[1] }); }
      else { const b = p.barr[idx - 3], b2 = p.barr[idx - 1]; for (const q of [b, b2]) if (q) this.tasks.push({ t: 'barricade', x: q[0], z: q[1] }); }
      if (idx < 4) { const h = p.holds[idx]; this.tasks.push({ t: 'hold', x: h[0][0], z: h[0][1], lx: h[1][0], lz: h[1][1], crouch: R() < 0.5 }); }
      else this.tasks.push({ t: 'patrol' });
    }
  }

  onPlanted() {
    const g = this.g, s = this.s, b = g.bomb;
    if (!s.alive) return;
    this.path = null;
    if (s.isAtk) this.tasks = [{ t: 'guard', a: R() * 6.28, d: 2.5 + R() * 2.5 }];
    else {
      const ds = g.team(s.team).filter(o => o.bot).sort((p, q) => p.pos.distanceTo(b.mesh.position) - q.pos.distanceTo(b.mesh.position));
      this.tasks = ds.indexOf(s) < 2 ? [{ t: 'defuse' }] : [{ t: 'guard', a: R() * 6.28, d: 3 + R() * 2 }];
    }
  }
  onHurt(att) { if (!this.target) this.alert = { x: att.pos.x, z: att.pos.z, t: 2.5 }; }
  hear(x, z) { if (!this.target && (!this.alert || this.alert.t < 0.5)) this.alert = { x, z, t: 1.6 }; }

  think() {
    const g = this.g, s = this.s, W = g.world, ey = s.pos.y + s.eyeY;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    let best = null, bd = 1e9;
    for (const o of g.soldiers) {
      if (!o.alive || o.team === s.team) continue;
      const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z, d = Math.hypot(dx, dz);
      if (d > 55 || d >= bd) continue;
      if (d > 3.5 && (dx * fx + dz * fz) / d < 0.3) continue;
      if (W.los(s.pos.x, ey, s.pos.z, o.pos.x, o.pos.y + o.eyeY - 0.3, o.pos.z) || W.los(s.pos.x, ey, s.pos.z, o.pos.x, o.pos.y + o.eyeY + 0.05, o.pos.z)) { best = o; bd = d; }
    }
    if (best) {
      if (this.target !== best) { this.target = best; this.seenT = 0; this.react = 0.32 + R() * 0.4; this.cc = R() < 0.4 ? 1 : 0; }
      this.lastSeen = { x: best.pos.x, z: best.pos.z, y: best.pos.y + best.eyeY - 0.3, t: g.clock };
    } else this.target = null;
  }

  turn(yaw, pitch, dt, rate = 7) {
    const s = this.s, dy = angDiff(yaw, s.yaw), st = rate * dt;
    s.yaw += Math.abs(dy) < st ? dy : Math.sign(dy) * st;
    s.pitch += (pitch - s.pitch) * Math.min(1, 10 * dt);
    return Math.abs(dy);
  }

  blockingBarricade() {
    const s = this.s, ops = this.g.world.openings, p = this.path;
    if (!p) return null;
    for (const op of ops) {
      if (!op.barricade || Math.hypot(op.x - s.pos.x, op.z - s.pos.z) > 1.35) continue;
      for (let k = this.pi; k < Math.min(p.length, this.pi + 5); k++) if (Math.hypot(p[k].x - op.x, p[k].z - op.z) < 0.6) return op;
    }
    return null;
  }

  // Walk toward (x,z). Returns true when arrived.
  moveTo(x, z, dt, speed = 2.6, tol = 0.55) {
    const g = this.g, s = this.s, W = g.world;
    const dist = Math.hypot(x - s.pos.x, z - s.pos.z);
    if (dist < tol) { s.speed = 0; return true; }
    this.repath -= dt;
    if (!this.path || !this.goal || Math.hypot(this.goal.x - x, this.goal.z - z) > 0.5 || this.repath <= 0 || this.navV !== W.navVersion) {
      this.path = W.findPath(s.pos.x, s.pos.z, x, z); this.pi = 1; this.goal = { x, z }; this.repath = 2 + R(); this.navV = W.navVersion;
      if (!this.path) { this.repath = 0.6; s.speed = 0; return false; }
    }
    const p = this.path;
    while (this.pi < p.length - 1 && Math.hypot(p[this.pi].x - s.pos.x, p[this.pi].z - s.pos.z) < 0.4) this.pi++;
    for (let k = Math.min(this.pi + 4, p.length - 1); k > this.pi; k--) if (W.navLineClear(s.pos.x, s.pos.z, p[k].x, p[k].z)) { this.pi = k; break; }
    let tp = p[Math.min(this.pi, p.length - 1)];
    if (this.pi >= p.length - 1 && W.navLineClear(s.pos.x, s.pos.z, x, z)) tp = { x, z };
    let dx = tp.x - s.pos.x, dz = tp.z - s.pos.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const op = this.blockingBarricade();
    if (op) {
      this.moveYaw = yawTo(op.x - s.pos.x, op.z - s.pos.z); s.speed = 0; this.meleeT -= dt;
      if (this.meleeT <= 0) { this.meleeT = 0.55; g.sound('melee', s); W.damageBarricade(op, 40); g.noise(s.pos.x, s.pos.z, 12, s); }
      return false;
    }
    if (d < 0.3 && this.pi >= p.length - 1) { s.speed = 0; return true; }
    s.pos.x += dx * speed * dt; s.pos.z += dz * speed * dt;
    W.collide(s.pos, 0.3, 0.35, 1.7, true);
    s.speed = speed; this.moveYaw = yawTo(dx, dz);
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (Math.hypot(s.pos.x - this.stuckP.x, s.pos.z - this.stuckP.z) < 0.25) { this.path = null; s.pos.x += (R() - 0.5) * 0.4; s.pos.z += (R() - 0.5) * 0.4; W.collide(s.pos, 0.3, 0.35, 1.7, true); }
      this.stuckT = 0; this.stuckP.x = s.pos.x; this.stuckP.z = s.pos.z;
    }
    return false;
  }

  scan(dt, cx, cz) {
    // look at nearby interior openings in turn
    this.lookT -= dt;
    if (this.lookT <= 0 || !this.lookAt) {
      this.lookT = 2 + R() * 2.5;
      const s = this.s, ops = this.g.world.openings.filter(o => Math.hypot(o.x - s.pos.x, o.z - s.pos.z) < 11 && Math.hypot(o.x - s.pos.x, o.z - s.pos.z) > 1.5);
      this.lookAt = ops.length ? ops[(R() * ops.length) | 0] : { x: cx, z: cz };
    }
    return yawTo(this.lookAt.x - this.s.pos.x, this.lookAt.z - this.s.pos.z);
  }

  runTask(dt) {
    const g = this.g, s = this.s, W = g.world, m = g.map, t = this.tasks[0];
    let look = null;
    s.crouchT = 0;
    if (!t) { s.speed = 0; return this.scan(dt, 0, 0); }
    const done = () => { this.tasks.shift(); this.timer = 0; };
    const side = (x, z, off) => { // stand point beside a wall point, on the bot's side
      const dx = s.pos.x - x, dz = s.pos.z - z;
      const pn = W.panels.reduce((a, b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a);
      const op = W.openings.reduce((a, b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a);
      const ax = (Math.hypot(pn.x - x, pn.z - z) < Math.hypot(op.x - x, op.z - z) ? pn.wall.axis : op.axis);
      return ax === 'x' ? { x, z: z + (dz >= 0 ? off : -off), pn, op } : { x: x + (dx >= 0 ? off : -off), z, pn, op };
    };
    switch (t.t) {
      case 'goto': if (this.moveTo(t.x, t.z, dt, t.run ? 4.2 : 2.7, 0.8)) done(); break;
      case 'reinforce': {
        if (!t.sp) t.sp = side(t.x, t.z, 0.75);
        if (t.sp.pn.reinforced || t.sp.pn.hasDoor || s.gad.reinf <= 0) { done(); break; }
        if (this.moveTo(t.sp.x, t.sp.z, dt, 2.8, 0.5)) {
          look = yawTo(t.x - s.pos.x, t.z - s.pos.z); this.timer += dt;
          if (this.timer > 2.4) { s.gad.reinf--; W.reinforce(t.sp.pn); g.soundAt('reinforce', t.x, 1.3, t.z); done(); }
        }
        break;
      }
      case 'barricade': {
        if (!t.sp) t.sp = side(t.x, t.z, 0.85);
        if (t.sp.op.barricade) { done(); break; }
        if (this.moveTo(t.sp.x, t.sp.z, dt, 2.8, 0.5)) {
          look = yawTo(t.x - s.pos.x, t.z - s.pos.z); this.timer += dt;
          if (this.timer > 1.5) { W.deployBarricade(t.sp.op); done(); }
        }
        break;
      }
      case 'hold':
        if (this.moveTo(t.x, t.z, dt, 2.6, 0.45)) { s.crouchT = t.crouch ? 1 : 0; look = yawTo(t.lx - s.pos.x, t.lz - s.pos.z) + Math.sin(g.clock * 0.6 + this.idx) * 0.35; }
        break;
      case 'patrol': {
        if (!t.p || this.wait <= 0 && t.arr) { t.p = m.patrol[(R() * m.patrol.length) | 0]; t.arr = false; }
        if (this.moveTo(t.p[0], t.p[1], dt, 2.3, 0.7)) { if (!t.arr) { t.arr = true; this.wait = 3 + R() * 5; } this.wait -= dt; look = this.scan(dt, 0, 0); }
        break;
      }
      case 'breach': {
        const b = t.b, pn = W.panels.reduce((a, c) => Math.hypot(c.x - b.x, c.z - b.z) < Math.hypot(a.x - b.x, a.z - b.z) ? c : a);
        if (t.st === 0) {
          if (pn.reinforced || s.gad.charges <= 0) { done(); break; }
          if (this.moveTo(b.stand[0], b.stand[1], dt, 2.7, 0.5)) {
            look = yawTo(b.x - s.pos.x, b.z - s.pos.z); this.timer += dt;
            if (this.timer > 1.3) { const nx = Math.sign(s.pos.x - b.x) * (pn.wall.axis === 'z' ? 1 : 0), nz = Math.sign(s.pos.z - b.z) * (pn.wall.axis === 'x' ? 1 : 0); g.placeCharge(s, b.x + nx * 0.08, 1.2, b.z + nz * 0.08, nx, nz); t.st = 1; this.timer = 0; }
          }
        } else if (this.moveTo(b.retreat[0], b.retreat[1], dt, 3.6, 0.6) || (this.timer += dt) > 4) { g.detonate(s); done(); }
        break;
      }
      case 'site': {
        const st = m.sites[g.site];
        if (g.planter === this) {
          if (this.moveTo(st.plant.x, st.plant.z, dt, 2.7, 0.5)) { s.crouchT = 1; g.interact(s, dt); look = this.scan(dt, st.x, st.z); }
        } else {
          const h = st.atkHold[this.idx % st.atkHold.length];
          if (this.moveTo(h[0], h[1], dt, 2.7, 0.6)) { s.crouchT = this.idx % 2; look = this.scan(dt, st.x, st.z); }
        }
        break;
      }
      case 'guard': {
        const b = g.bomb;
        if (!t.p) { t.p = { x: b.x + Math.cos(t.a) * t.d, z: b.z + Math.sin(t.a) * t.d }; if (!W.navFree(t.p.x, t.p.z) || !W.los(t.p.x, 1.2, t.p.z, b.x, 0.3, b.z)) t.p = { x: b.x + Math.cos(t.a) * 1.2, z: b.z + Math.sin(t.a) * 1.2 }; }
        if (this.moveTo(t.p.x, t.p.z, dt, 3, 0.6)) { s.crouchT = this.idx % 2; look = this.scan(dt, b.x, b.z); }
        break;
      }
      case 'defuse': {
        const b = g.bomb;
        if (this.moveTo(b.x, b.z, dt, 3.6, 1.1)) { s.crouchT = 1; g.interact(s, dt); look = yawTo(b.x - s.pos.x, b.z - s.pos.z); }
        break;
      }
    }
    return look;
  }

  update(dt, live) {
    const g = this.g, s = this.s;
    if (!live) { s.speed = 0; return; }
    if (g.phase === 'prep' && s.isAtk) { s.speed = 0; return; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.12; this.think(); }
    const w = s.wpn();
    if (w.mag === 0 || (!this.target && w.mag < w.def.mag * 0.35)) s.startReload();
    if (this.alert) { this.alert.t -= dt; if (this.alert.t <= 0) this.alert = null; }
    const tg = this.target;
    if (tg && tg.alive) {
      // combat
      this.seenT += dt; s.speed = 0; s.crouchT = this.cc;
      const dx = tg.pos.x - s.pos.x, dz = tg.pos.z - s.pos.z, d = Math.hypot(dx, dz), dy = tg.pos.y + tg.eyeY - 0.28 - (s.pos.y + s.eyeY);
      this.err.t -= dt;
      if (this.err.t <= 0) { const mag = (0.035 + 0.0015 * d) * Math.max(0.35, 1.3 - this.seenT) / (0.5 + g.difficulty * 0.7); this.err.x = (R() - 0.5) * 2 * mag; this.err.y = (R() - 0.5) * 1.4 * mag; this.err.t = 0.3; }
      const off = this.turn(yawTo(dx, dz) + this.err.x, Math.atan2(dy, d) + this.err.y, dt, 6.5);
      if (this.seenT > this.react && off < 0.12) {
        if (this.burst > 0) {
          this.burst -= dt;
          const sp = 0.012, yaw = s.yaw + (R() - 0.5) * sp, pit = s.pitch + (R() - 0.5) * sp, cp = Math.cos(pit);
          s.tryFire(s.pos.x, s.pos.y + s.eyeY, s.pos.z, -Math.sin(yaw) * cp, Math.sin(pit), -Math.cos(yaw) * cp);
        } else { this.pause -= dt; if (this.pause <= 0) { this.burst = 0.2 + R() * 0.45; this.pause = 0.25 + R() * 0.4; } }
      }
      return;
    }
    if (this.lastSeen && g.clock - this.lastSeen.t < (s.isAtk ? 1.4 : 2.6)) {
      const l = this.lastSeen; s.speed = 0;
      this.turn(yawTo(l.x - s.pos.x, l.z - s.pos.z), 0, dt);
      return;
    }
    const look = this.runTask(dt);
    let yaw = look ?? this.moveYaw;
    if (this.alert) yaw = yawTo(this.alert.x - s.pos.x, this.alert.z - s.pos.z);
    this.turn(yaw, 0, dt, 5);
  }
}
