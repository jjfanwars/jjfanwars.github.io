// Player controller: input, first-person camera, viewmodel, gadgets, drone, spectating.
import * as THREE from 'three';

const R = Math.random;
const FOV = 76, FOV_ADS = 50;
const _v = new THREE.Vector3();

function box(g, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
}

function buildVM(team) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.45, metalness: 0.7 });
  const furn = new THREE.MeshStandardMaterial(team === 1 ? { color: 0x6b3f1e, roughness: 0.6 } : { color: 0x2a2c2f, roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: team === 1 ? 0x5a5a3a : 0x25272b, roughness: 0.95 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
  const dotM = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  const root = new THREE.Group();
  // rifle
  const rf = new THREE.Group();
  box(rf, 0.05, 0.075, 0.34, 0, 0, -0.08, metal);
  box(rf, 0.046, 0.052, 0.24, 0, 0.004, -0.36, furn);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), metal); bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.012, -0.56); rf.add(bar);
  box(rf, 0.04, 0.065, 0.24, 0, -0.02, 0.2, furn);
  box(rf, 0.03, 0.17, 0.06, 0, -0.11, -0.13, metal, team === 1 ? 0.35 : 0.08);
  box(rf, 0.034, 0.1, 0.04, 0, -0.08, 0.02, furn, -0.3);
  box(rf, 0.03, 0.012, 0.09, 0, 0.044, -0.1, metal);
  box(rf, 0.004, 0.045, 0.004, -0.02, 0.07, -0.1, metal); box(rf, 0.004, 0.045, 0.004, 0.02, 0.07, -0.1, metal); box(rf, 0.044, 0.004, 0.004, 0, 0.094, -0.1, metal);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 10), dotM); dot.position.set(0, 0.072, -0.1); rf.add(dot);
  box(rf, 0.05, 0.05, 0.3, -0.1, -0.075, -0.2, sleeve, 0.2).rotation.y = -0.55;
  box(rf, 0.05, 0.05, 0.08, -0.02, -0.03, -0.34, glove);
  box(rf, 0.065, 0.065, 0.3, 0.06, -0.1, 0.16, sleeve, -0.35).rotation.y = 0.25;
  box(rf, 0.05, 0.07, 0.06, 0.005, -0.075, 0.03, glove);
  const rm = new THREE.Object3D(); rm.position.set(0, 0.012, -0.68); rf.add(rm);
  rf.userData = { muzzle: rm, sightY: 0.072 };
  // pistol
  const ps = new THREE.Group();
  box(ps, 0.03, 0.04, 0.19, 0, 0.02, -0.06, metal);
  box(ps, 0.028, 0.1, 0.04, 0, -0.045, 0.01, furn, -0.2);
  box(ps, 0.004, 0.012, 0.004, 0, 0.046, -0.14, metal); box(ps, 0.014, 0.01, 0.004, 0, 0.045, 0.025, metal);
  box(ps, 0.065, 0.065, 0.32, 0.03, -0.09, 0.2, sleeve, -0.25).rotation.y = 0.1;
  box(ps, 0.055, 0.08, 0.06, 0, -0.045, 0.02, glove);
  const pm = new THREE.Object3D(); pm.position.set(0, 0.02, -0.17); ps.add(pm);
  ps.userData = { muzzle: pm, sightY: 0.05 };
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  flash.visible = false; root.add(flash);
  root.add(rf, ps);
  root.traverse(o => { o.frustumCulled = false; });
  return { root, guns: [rf, ps], flash };
}

export class PlayerCtl {
  constructor(game, camera, dom) {
    this.g = game; this.cam = camera; this.dom = dom;
    this.keys = {}; this.pressed = new Set(); this.mb = [false, false, false]; this.mpress = [false, false, false];
    this.sens = 0.0022; this.ads = 0; this.rec = 0; this.bloom = 0; this.kick = 0; this.shake = 0; this.bob = 0;
    this.vel = new THREE.Vector3(); this.vault = null; this.reinfT = 0; this.drone = null; this.spec = 0;
    this.vm = null; this.hint = ''; this.prog = null; this.mode = 'fp'; this.flashT = 0; this.wallNear = 0; this.active = true;
    camera.rotation.order = 'YXZ';
    addEventListener('keydown', e => { if (!this.keys[e.code]) this.pressed.add(e.code); this.keys[e.code] = true; if (['Tab', 'Space', 'ControlLeft', 'KeyQ', 'KeyE'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('mousedown', e => { if (!this.locked()) return; this.mb[e.button] = true; this.mpress[e.button] = true; });
    addEventListener('mouseup', e => { this.mb[e.button] = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('blur', () => { this.keys = {}; this.mb = [false, false, false]; });
    addEventListener('mousemove', e => {
      if (!this.locked()) return;
      const o = this.mode === 'drone' ? this.drone : this.g.player;
      if (!o || (this.mode === 'fp' && !o.alive)) return;
      const k = this.sens * (1 - this.ads * 0.45);
      o.yaw -= e.movementX * k; o.pitch = Math.max(-1.45, Math.min(1.45, o.pitch - e.movementY * k));
    });
  }
  locked() { return document.pointerLockElement === this.dom || this.fake; }

  onRound() {
    const g = this.g, s = g.player;
    if (!this.vm || this.vmTeam !== s.team) { if (this.vm) this.cam.remove(this.vm.root); this.vm = buildVM(s.team); this.vmTeam = s.team; this.cam.add(this.vm.root); }
    this.vault = null; this.rec = 0; this.vel.set(0, 0, 0); this.drone = null; this.mode = 'fp'; this.ads = 0;
    if (s.isAtk) {
      const grp = new THREE.Group(), mt = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5 });
      box(grp, 0.2, 0.07, 0.24, 0, 0.09, 0, mt);
      for (const x of [-0.12, 0.12]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), mt); w.rotation.z = Math.PI / 2; w.position.set(x, 0.07, 0); grp.add(w); }
      g.extra.add(grp);
      this.drone = { x: s.pos.x, z: s.pos.z - Math.cos(s.yaw) * 1.5, yaw: s.yaw, pitch: 0.1, mesh: grp, p: { x: 0, z: 0 } };
      this.drone.x -= Math.sin(s.yaw) * 1.5;
      this.mode = 'drone';
    }
  }
  onAction() { if (this.drone) { this.g.extra.remove(this.drone.mesh); this.drone = null; } if (this.g.player.alive) this.mode = 'fp'; }
  onDeath() { this.mode = 'spec'; this.spec = 0; this.ads = 0; }

  muzzleWorld() {
    if (this.mode !== 'fp') return this.cam.position;
    return this.vm.guns[this.g.player.cur].userData.muzzle.getWorldPosition(_v);
  }

  update(dt) {
    const g = this.g, s = g.player;
    this.shake = Math.max(0, this.shake - dt * 1.5); this.hint = ''; this.prog = null;
    if (!s.alive && this.mode !== 'spec') this.mode = 'spec';
    if (this.mode === 'drone') this.updDrone(dt);
    else if (this.mode === 'spec') this.updSpec(dt);
    else this.updFP(dt);
    s.model.group.visible = this.mode !== 'fp';
    this.vm.root.visible = this.mode === 'fp';
    this.pressed.clear(); this.mpress = [false, false, false];
  }

  updDrone(dt) {
    const g = this.g, d = this.drone, k = this.keys;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const sp = 4.2 * dt, sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
    d.p.x = d.x + (-sy * f + cy * r) * sp; d.p.z = d.z + (-cy * f - sy * r) * sp;
    g.world.collide(d.p, 0.13, 0.02, 0.2, false);
    if (f || r) { this.bob += dt; if (this.bob > 0.25) { this.bob = 0; g.audio.play('drone', { volume: 0.35 }); } }
    d.x = d.p.x; d.z = d.p.z;
    d.mesh.position.set(d.x, 0, d.z); d.mesh.rotation.y = d.yaw;
    this.cam.position.set(d.x - sy * 0.1, 0.17, d.z - cy * 0.1);
    this.cam.rotation.set(d.pitch, d.yaw, 0);
    this.setFov(88, dt);
    this.hint = 'DRONE — WASD to drive, find the bomb sites';
  }

  updSpec(dt) {
    const g = this.g, s = g.player, mates = g.team(s.team).filter(o => o !== s);
    if (this.mpress[0]) this.spec++;
    this.setFov(FOV, dt);
    if (!mates.length) {
      this.cam.position.set(s.pos.x + 2.5, 5, s.pos.z + 3.5); this.cam.lookAt(s.pos.x, 0.3, s.pos.z);
      this.hint = 'You are down'; return;
    }
    const t = mates[this.spec % mates.length], fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
    const ex = t.pos.x + Math.cos(t.yaw) * 0.35, ey = t.pos.y + t.eyeY + 0.25, ez = t.pos.z - Math.sin(t.yaw) * 0.35;
    const h = g.world.raycast(ex, ey, ez, -fx, 0.1, -fz, 1.9), d = (h ? h.t : 1.9) - 0.15;
    this.cam.position.set(ex - fx * d, ey + 0.1 * d, ez - fz * d);
    this.cam.rotation.set(t.pitch - 0.08, t.yaw, 0);
    this.hint = `Spectating ${t.name} — click to switch`;
  }

  setFov(f, dt) {
    if (Math.abs(this.cam.fov - f) > 0.05) { this.cam.fov += (f - this.cam.fov) * Math.min(1, dt * 18); this.cam.updateProjectionMatrix(); }
  }

  updFP(dt) {
    const g = this.g, s = g.player, W = g.world, k = this.keys, P = this.pressed;
    const live = g.phase !== 'end' && g.phase !== 'matchEnd';
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    // stance
    if (P.has('KeyC')) this.crouchTog = !this.crouchTog;
    s.crouchT = (this.crouchTog || k.ControlLeft) ? 1 : 0;
    if (s.crouchT === 0 && s.crouch > 0.3) { // need headroom to stand
      const h = W.raycast(s.pos.x, 1.0, s.pos.z, 0, 1, 0, 0.75);
      if (h) s.crouchT = 1;
    }
    const wantAds = this.mb[2] && s.reloadT <= 0;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    const lt = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    s.lean += (lt - s.lean) * Math.min(1, dt * 10);
    // movement
    if (this.vault) {
      const v = this.vault; v.t += dt / 0.42;
      const t = Math.min(1, v.t);
      s.pos.x = v.fx + (v.tx - v.fx) * t; s.pos.z = v.fz + (v.tz - v.fz) * t; s.pos.y = Math.sin(t * Math.PI) * v.h;
      s.crouchT = 1;
      if (t >= 1) { this.vault = null; s.pos.y = 0; }
    } else {
      let f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      const l = Math.hypot(f, r) || 1; f /= l; r /= l;
      const sprint = k.ShiftLeft && f > 0 && s.crouchT === 0 && this.ads < 0.3 && !this.mb[0];
      this.sprinting = sprint;
      const sp = sprint ? 5.3 : s.crouch > 0.5 ? 1.9 : this.ads > 0.5 ? 2.3 : 3.5;
      const wx = (-sy * f + cy * r) * sp, wz = (-cy * f - sy * r) * sp, a = Math.min(1, dt * 12);
      this.vel.x += (wx - this.vel.x) * a; this.vel.z += (wz - this.vel.z) * a;
      const px = s.pos.x, pz = s.pos.z;
      s.pos.x += this.vel.x * dt; s.pos.z += this.vel.z * dt;
      W.collide(s.pos, 0.3, 0.35, s.height, false);
      s.speed = Math.hypot(s.pos.x - px, s.pos.z - pz) / Math.max(dt, 1e-4);
      if (s.speed > 0.5) this.bob += dt * s.speed * 1.9;
      if (P.has('Space')) this.tryVault();
    }
    // weapons
    if (P.has('Digit1')) s.switchTo(0);
    if (P.has('Digit2')) s.switchTo(1);
    if (P.has('KeyR')) s.startReload();
    const def = s.wpn().def;
    this.bloom = Math.max(0, this.bloom - dt * 0.09);
    const d = this.rec * Math.min(1, dt * 7); s.pitch -= d; this.rec -= d;
    this.kick = Math.max(0, this.kick - dt * 9);
    const spread = def.hip * (1 - this.ads) + 0.0015 + this.bloom * (1 - this.ads * 0.7) + Math.min(1, s.speed / 5) * 0.03 * (1 - this.ads * 0.7);
    this.spread = spread;
    this.placeCam();
    const cp = this.cam.position;
    if (live && !this.vault && !this.sprinting && (def.auto ? this.mb[0] : this.mpress[0])) {
      const yaw = s.yaw + (R() + R() - 1) * spread, pit = s.pitch + (R() + R() - 1) * spread, c = Math.cos(pit);
      if (s.tryFire(cp.x, cp.y, cp.z, -Math.sin(yaw) * c, Math.sin(pit), -Math.cos(yaw) * c)) {
        const kk = def.kick * (1 - this.ads * 0.3) * (s.crouch > 0.5 ? 0.8 : 1);
        s.pitch += kk; s.yaw += (R() - 0.5) * kk * 0.9; this.rec += kk * 0.55; this.bloom = Math.min(0.03, this.bloom + 0.004); this.kick = 1; this.flashT = 0.045;
      }
    }
    const c = Math.cos(s.pitch), dx = -sy * c, dy = Math.sin(s.pitch), dz = -cy * c;
    if (live && P.has('KeyV') && s.fireCd <= 0) { s.fireCd = 0.5; this.kick = -1.5; g.melee(s, cp.x, cp.y, cp.z, dx, dy, dz); }
    if (live && (P.has('Digit4') || this.mpress[1])) {
      const key = s.isAtk ? 'frags' : 'impacts';
      if (s.gad[key] > 0) { s.gad[key]--; g.throwGrenade(s, cp.x, cp.y, cp.z, dx, dy, dz, !s.isAtk); }
    }
    // look-at target for gadgets
    const h = W.raycast(cp.x, cp.y, cp.z, dx, dy, dz, 2.3), hc = h && h.c;
    this.wallNear += (((h && h.t < 0.75) ? (0.75 - h.t) / 0.75 : 0) - this.wallNear) * Math.min(1, dt * 12);
    const hints = [];
    if (live && s.isAtk) {
      if (s.charge) { hints.push('[G] Detonate charge'); if (P.has('KeyG')) g.detonate(s); }
      else if (g.phase !== 'prep' && s.gad.charges > 0 && hc && ((hc.kind === 'cell' && !hc.reinforced) || hc.kind === 'barricade')) {
        hints.push('[G] Place breach charge');
        if (P.has('KeyG')) g.placeCharge(s, cp.x + dx * h.t, Math.max(0.4, Math.min(2.2, cp.y + dy * h.t)), cp.z + dz * h.t, h.nx, h.nz);
      }
    } else if (live && hc && hc.kind === 'cell' && !hc.reinforced && !hc.panel.hasDoor && s.gad.reinf > 0) {
      hints.push('[G] Hold to reinforce wall');
      if (k.KeyG) {
        this.reinfT += dt; this.prog = { label: 'Reinforcing', v: this.reinfT / 2.5 };
        if (this.reinfT >= 2.5) { this.reinfT = 0; s.gad.reinf--; W.reinforce(hc.panel); g.audio.play('reinforce'); }
      } else this.reinfT = 0;
    } else this.reinfT = 0;
    const act = live && g.actionFor(s);
    if (act) {
      hints.unshift(`[F] Hold: ${act.label}`);
      if (k.KeyF) { const a = g.interact(s, dt); if (a) this.prog = { label: a.label, v: s.actionT / a.dur }; }
    }
    this.hint = hints.join('   ');
    this.setFov(FOV + (FOV_ADS - FOV) * this.ads + (this.sprinting ? 4 : 0), dt);
    this.updVM(dt);
  }

  tryVault() {
    const g = this.g, s = g.player, W = g.world;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const h = W.raycast(s.pos.x, 0.55, s.pos.z, fx, 0, fz, 1.1);
    if (!h || h.c.kind === 'cell' || h.c.kind === 'barricade' || h.c.kind === 'floor' || h.c.y1 > 1.2) return;
    const c = h.c, th = Math.abs(fx) > Math.abs(fz) ? c.x1 - c.x0 : c.z1 - c.z0;
    if (th > 1.4) return;
    const dist = h.t + th / Math.max(Math.abs(fx), Math.abs(fz), 0.5) + 0.5;
    if (W.raycast(s.pos.x, c.y1 + 0.35, s.pos.z, fx, 0, fz, dist)) return;
    const tp = { x: s.pos.x + fx * dist, z: s.pos.z + fz * dist }, q = { x: tp.x, z: tp.z };
    W.collide(q, 0.3, 0.35, 1.2, false);
    if (Math.hypot(q.x - tp.x, q.z - tp.z) > 0.25) return;
    this.vault = { t: 0, fx: s.pos.x, fz: s.pos.z, tx: q.x, tz: q.z, h: c.y1 - 0.25 };
    this.vel.set(0, 0, 0);
    g.sound('vault', s);
  }

  placeCam() {
    const g = this.g, s = g.player, cam = this.cam;
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    let off = s.lean * 0.34;
    const ey = s.pos.y + s.eyeY - Math.abs(s.lean) * 0.05;
    if (Math.abs(off) > 0.01) {
      const sg = Math.sign(off), h = g.world.raycast(s.pos.x, ey, s.pos.z, rx * sg, 0, rz * sg, Math.abs(off) + 0.15);
      if (h) off = sg * Math.max(0, h.t - 0.15);
    }
    const bobY = s.speed > 0.5 ? Math.sin(this.bob * 2) * 0.012 * Math.min(1, s.speed / 3) * (1 - this.ads * 0.7) : 0;
    const sh = this.shake * 0.03;
    cam.position.set(s.pos.x + rx * off, ey + bobY, s.pos.z + rz * off);
    cam.rotation.set(s.pitch + (R() - 0.5) * sh, s.yaw + (R() - 0.5) * sh, -s.lean * 0.17);
  }

  updVM(dt) {
    const s = this.g.player, vm = this.vm, a = this.ads;
    vm.guns[0].visible = s.cur === 0; vm.guns[1].visible = s.cur === 1;
    const gun = vm.guns[s.cur], sy = gun.userData.sightY, pistol = s.cur === 1;
    const sway = Math.sin(this.bob) * 0.006 * (1 - a * 0.85) * Math.min(1, s.speed / 3), swy = Math.abs(Math.cos(this.bob)) * 0.005 * (1 - a * 0.85) * Math.min(1, s.speed / 3);
    const rl = s.reloadT > 0 ? Math.sin(Math.min(1, (s.wpn().def.reload - s.reloadT) / s.wpn().def.reload) * Math.PI) : 0;
    const sw = Math.max(0, s.fireCd > 0.2 && s.firedT <= -0.01 ? (s.fireCd - 0.2) * 3 : 0);
    const low = Math.max(this.wallNear, this.sprinting ? 0.6 : 0);
    const hx = pistol ? 0.13 : 0.15, hy = pistol ? -0.13 : -0.165, hz = pistol ? -0.42 : -0.36;
    const k = Math.max(0, this.kick);
    gun.position.set(hx * (1 - a) + sway, (hy * (1 - a) - sy * a) - swy - rl * 0.1 - sw * 0.15 - low * 0.05, (hz * (1 - a) + (pistol ? -0.3 : -0.2) * a) + k * 0.02 + low * 0.08 + (this.kick < 0 ? this.kick * 0.1 : 0));
    gun.rotation.set(k * 0.02 * (1 - a * 0.6) + rl * 0.5 - low * 0.5, low * 0.5 + rl * 0.3, rl * 0.4);
    this.flashT -= dt;
    vm.flash.visible = this.flashT > 0;
    if (vm.flash.visible) { const m = gun.userData.muzzle; vm.flash.position.copy(m.position).applyEuler(gun.rotation).add(gun.position); vm.flash.position.z -= 0.05; vm.flash.rotation.z = R() * 6.28; const sc = 0.7 + R() * 0.6; vm.flash.scale.set(sc, sc, 1); }
  }
}
