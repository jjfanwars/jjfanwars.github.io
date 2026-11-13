// Match / round rules, soldiers, weapons, ballistics, explosives.
import * as THREE from 'three';
import { World, rayBox } from './world.js';
import { buildMap } from './map.js';
import { createSoldier } from './soldier.js';
import { Bot } from './bot.js';

export const FACTIONS = [
  { id: 'fascist', name: 'Fascists', short: 'FAS', names: ['Kessler', 'Brandt', 'Falke', 'Adler', 'Wolf'], rifle: 'sturm', pistol: 'p9' },
  { id: 'communist', name: 'Communists', short: 'COM', names: ['Volkov', 'Sokol', 'Orlov', 'Medved', 'Zima'], rifle: 'vk', pistol: 'tk' },
];
export const WEAPONS = {
  sturm: { name: 'Sturm-7', dmg: 38, rpm: 680, mag: 30, reserve: 120, reload: 2.3, auto: true, sound: 'rifle', kick: 0.014, hip: 0.035 },
  vk: { name: 'VK-47', dmg: 43, rpm: 590, mag: 30, reserve: 120, reload: 2.5, auto: true, sound: 'rifle', kick: 0.018, hip: 0.038 },
  p9: { name: 'Wolf 9', dmg: 30, rpm: 400, mag: 12, reserve: 48, reload: 1.6, auto: false, sound: 'pistol', kick: 0.02, hip: 0.025 },
  tk: { name: 'TK-33', dmg: 33, rpm: 360, mag: 9, reserve: 45, reload: 1.6, auto: false, sound: 'pistol', kick: 0.024, hip: 0.025 },
};
export const T = { prep: 30, action: 180, plant: 5, defuse: 5, bomb: 40, end: 6, wins: 3 };
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class Soldier {
  constructor(game, id, name, team, isPlayer) {
    this.game = game; this.id = id; this.name = name; this.team = team; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(); this.kills = 0; this.deaths = 0; this.bot = null;
    this.model = createSoldier(FACTIONS[team].id);
    game.scene.add(this.model.group);
    this.alive = false;
  }
  reset(x, z, yaw, isAtk) {
    const f = FACTIONS[this.team];
    this.pos.set(x, 0, z); this.yaw = yaw; this.pitch = 0; this.crouch = 0; this.crouchT = 0; this.lean = 0;
    this.hp = 100; this.alive = true; this.speed = 0; this.isAtk = isAtk; this.firedT = 0;
    this.w = [f.rifle, f.pistol].map(k => ({ def: WEAPONS[k], mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve }));
    this.cur = 0; this.reloadT = 0; this.fireCd = 0; this.actionT = 0; this.acting = null; this.charge = null;
    this.gad = isAtk ? { charges: 2, frags: 2 } : { reinf: 2, impacts: 2 };
    this.model.reset(); this.model.group.visible = true;
    this.sync(0);
  }
  get eyeY() { return 1.62 - 0.47 * this.crouch; }
  get height() { return 1.8 - 0.6 * this.crouch; }
  wpn() { return this.w[this.cur]; }
  startReload() {
    const w = this.wpn();
    if (this.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    this.reloadT = w.def.reload;
    this.game.sound('reload', this);
  }
  switchTo(i) { if (i !== this.cur && this.reloadT <= 0) { this.cur = i; this.fireCd = 0.45; this.game.sound('swap', this); } }
  tryFire(ox, oy, oz, dx, dy, dz) {
    const w = this.wpn();
    if (this.reloadT > 0 || this.fireCd > 0) return false;
    if (w.mag <= 0) { if (w.reserve > 0) this.startReload(); else { this.game.sound('empty', this); this.fireCd = 0.3; } return false; }
    w.mag--; this.fireCd = 60 / w.def.rpm; this.firedT = 0.09;
    this.game.fireBullet(this, ox, oy, oz, dx, dy, dz);
    return true;
  }
  sync(dt) {
    this.fireCd -= dt; this.firedT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const w = this.wpn(), n = Math.min(w.def.mag - w.mag, w.reserve); w.mag += n; w.reserve -= n; }
    }
    this.crouch = Math.max(0, Math.min(1, this.crouch + Math.max(-dt * 5, Math.min(dt * 5, this.crouchT - this.crouch))));
    if (this.alive && this.speed > 0.6) {
      this.stepAcc = (this.stepAcc || 0) + this.speed * dt;
      if (this.stepAcc > 2.3) { this.stepAcc = 0; this.game.sound('step', this, this.isPlayer ? 0.3 : (this.crouch > 0.5 ? 0.35 : 0.8)); }
    }
    const g = this.model.group;
    g.position.copy(this.pos); g.rotation.y = this.yaw;
    if (this.alive) this.model.setPose({ speed: this.speed, crouch: this.crouch, pitch: this.pitch, lean: this.lean, firing: this.firedT > 0, reloading: this.reloadT > 0 });
    this.model.update(dt);
  }
}

export class Game {
  constructor(o) {
    Object.assign(this, o); // scene, camera, tex, fx, audio, hud
    this.soldiers = []; this.bots = []; this.grenades = []; this.extra = new THREE.Group(); this.scene.add(this.extra);
    this.phase = 'menu'; this.clock = 0; this.score = [0, 0]; this.round = 0; this.world = null;
    this.difficulty = 0.7;
  }

  startMatch(playerTeam) {
    for (const s of this.soldiers) this.scene.remove(s.model.group);
    this.soldiers = []; this.bots = []; this.score = [0, 0]; this.round = 0;
    this.playerTeam = playerTeam; this.atkTeam = playerTeam;
    let id = 0;
    for (let t = 0; t < 2; t++) for (let i = 0; i < 5; i++) {
      const isP = t === playerTeam && i === 0;
      const s = new Soldier(this, id++, isP ? 'You' : FACTIONS[t].names[i], t, isP);
      this.soldiers.push(s);
      if (isP) this.player = s; else this.bots.push(new Bot(this, s));
    }
    this.startRound();
  }

  startRound() {
    this.round++;
    if (this.world) this.world.dispose();
    this.extra.clear(); this.grenades = []; this.bomb = null; this.fx.clear();
    this.world = new World(this.scene, this.tex, this.fx, this.audio);
    this.map = buildMap(this.world, this.scene);
    const m = this.map, rnd = a => a[(Math.random() * a.length) | 0], shuf = a => a.map(v => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(v => v[1]);
    this.site = (Math.random() * 2) | 0; // attackers' intended site
    const sp = rnd(m.atkSpawns);
    this.plan = { reinf: shuf(m.reinforce), barr: shuf(m.defBarricade), holds: shuf(m.holds), entries: shuf(m.entries), spawn: sp };
    let ai = 0, di = 0;
    for (const s of this.soldiers) {
      const atk = s.team === this.atkTeam;
      if (atk) { const p = sp.pts[ai++]; s.reset(p[0], p[1], sp.yaw, true); }
      else { const p = m.defSpawns[di++]; s.reset(p[0], p[1], Math.random() * 6.28, false); }
    }
    let a = 0, d = 0;
    for (const b of this.bots) b.setup(b.s.isAtk, b.s.isAtk ? a++ : d++);
    this.phase = 'prep'; this.time = T.prep; this.planter = null; this.planT = 0;
    this.pc.onRound();
    this.hud.banner(`ROUND ${this.round}`, this.player.isAtk ? 'ATTACK — scout with your drone' : 'DEFEND — reinforce and barricade', 3.5);
    this.audio.play('round_start');
  }

  team(t, aliveOnly = true) { return this.soldiers.filter(s => s.team === t && (!aliveOnly || s.alive)); }
  get defTeam() { return 1 - this.atkTeam; }

  sound(name, s, vol = 1) {
    if (s.isPlayer) this.audio.play(name, { volume: vol });
    else this.audio.play(name, { pos: [s.pos.x, s.pos.y + 1.3, s.pos.z], volume: vol, muffle: this.muffleAt(s.pos.x, s.pos.y + 1.3, s.pos.z) });
  }
  muffleAt(x, y, z) {
    const c = this.camera.position;
    return this.world.los(c.x, c.y, c.z, x, y, z) ? 0 : 0.7;
  }
  soundAt(name, x, y, z, vol = 1) { this.audio.play(name, { pos: [x, y, z], volume: vol, muffle: this.muffleAt(x, y, z) }); }

  noise(x, z, r, src) {
    for (const b of this.bots) if (b.s.alive && b.s.team !== src.team && Math.hypot(b.s.pos.x - x, b.s.pos.z - z) < r) b.hear(x, z);
  }

  raySoldiers(src, ox, oy, oz, dx, dy, dz, maxT) {
    let best = null, bt = maxT, head = false;
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9), box = this._box || (this._box = {});
    for (const s of this.soldiers) {
      if (!s.alive || s.team === src.team) continue;
      const hx = s.pos.x - ox, hy = s.pos.y + s.eyeY + 0.03 - oy, hz = s.pos.z - oz;
      const tc = hx * dx + hy * dy + hz * dz;
      if (tc > 0 && tc < bt + 0.3) {
        const d2 = hx * hx + hy * hy + hz * hz - tc * tc, r = 0.135;
        if (d2 < r * r) { const t = tc - Math.sqrt(r * r - d2); if (t < bt) { bt = t; best = s; head = true; } }
      }
      box.x0 = s.pos.x - 0.23; box.x1 = s.pos.x + 0.23; box.z0 = s.pos.z - 0.23; box.z1 = s.pos.z + 0.23; box.y0 = s.pos.y; box.y1 = s.pos.y + s.eyeY - 0.13;
      const t = rayBox(box, ox, oy, oz, ix, iy, iz, bt);
      if (t >= 0 && t < bt) { bt = t; best = s; head = false; }
    }
    return best ? { s: best, t: bt, head } : null;
  }

  fireBullet(s, ox, oy, oz, dx, dy, dz) {
    const def = s.wpn().def, W = this.world, fx = this.fx;
    let dmg = def.dmg, range = 90, x = ox, y = oy, z = oz, ex, ey, ez;
    for (let pen = 0; pen < 10; pen++) {
      const h = W.raycast(x, y, z, dx, dy, dz, range), wt = h ? h.t : range, c = h && h.c, nx = h ? h.nx : 0, ny = h ? h.ny : 0, nz = h ? h.nz : 0;
      const e = this.raySoldiers(s, x, y, z, dx, dy, dz, wt);
      if (e) {
        ex = x + dx * e.t; ey = y + dy * e.t; ez = z + dz * e.t;
        fx.puff(ex, ey, ez, 0x6a0c0c, 7, 1.6, 0.1, 0.5, -1.5, 0.8);
        this.soundAt('impact_flesh', ex, ey, ez, 0.7);
        let amt = e.head ? 999 : dmg;
        if (e.s.isPlayer && !e.head) amt *= this.difficulty;
        this.damage(e.s, amt, s, e.head, dx, dz);
        break;
      }
      ex = x + dx * wt; ey = y + dy * wt; ez = z + dz * wt;
      if (!h) break;
      if (c.kind === 'cell' && !c.reinforced) {
        const broke = W.damageCell(c);
        fx.puff(ex, ey, ez, 0xd8d2c4, 3, 1.2, 0.1, 0.5, -0.6, 0.5, nx, 0, nz);
        if (pen === 0) this.soundAt(broke ? 'wall_break' : 'impact_wall', ex, ey, ez, 0.6);
        dmg *= 0.8; x = ex + dx * 0.17; y = ey + dy * 0.17; z = ez + dz * 0.17; range -= wt + 0.17; continue;
      }
      if (c.kind === 'barricade') {
        W.damageBarricade(c.op, dmg * 0.3);
        fx.puff(ex, ey, ez, 0xa98a5a, 3, 1.2, 0.08, 0.4, -1, 0.6);
        dmg *= 0.85; x = ex + dx * 0.15; y = ey + dy * 0.15; z = ez + dz * 0.15; range -= wt + 0.15; continue;
      }
      fx.decal(ex, ey, ez, nx, ny, nz);
      const metal = c.reinforced || (c.mesh && c.mesh.material.metalness > 0);
      fx.puff(ex, ey, ez, metal ? 0xffd27a : 0x9a958c, metal ? 4 : 3, metal ? 4 : 1.4, metal ? 0.04 : 0.11, metal ? 0.2 : 0.5, -1, 0.7, nx, ny, nz);
      this.soundAt('impact_wall', ex, ey, ez, 0.5);
      break;
    }
    // tracer + muzzle
    let mx, my, mz;
    if (s.isPlayer) { const m = this.pc.muzzleWorld(); mx = m.x; my = m.y; mz = m.z; }
    else { const m = s.model.muzzle.getWorldPosition(this._v || (this._v = new THREE.Vector3())); mx = m.x; my = m.y; mz = m.z; fx.puff(mx, my, mz, 0xffd080, 2, 0.6, 0.12, 0.05, 0, 0.9); }
    fx.tracer(mx, my, mz, ex, ey, ez);
    fx.flash(mx, my, mz, 18, 0.05);
    this.sound(def.sound, s);
    this.noise(s.pos.x, s.pos.z, 22, s);
  }

  damage(v, amt, att, head, dx, dz) {
    if (!v.alive || this.phase === 'end' || this.phase === 'matchEnd') return;
    v.hp -= amt;
    if (v.isPlayer) this.hud.hurt(Math.min(1, amt / 60));
    if (att && att.isPlayer && att !== v) { this.hud.hitmarker(v.hp <= 0, head); this.audio.play(v.hp <= 0 ? (head ? 'headshot' : 'kill') : 'hitmarker'); }
    if (v.bot && att) v.bot.onHurt(att);
    if (v.hp <= 0) {
      v.hp = 0; v.alive = false; v.deaths++; v.actionT = 0;
      if (att && att !== v) att.kills++;
      v.model.die(-dx, -dz);
      this.hud.feed(att ? att.name : '', v.name, head, att ? att.team === this.playerTeam : false, v.team === this.playerTeam);
      if (v.isPlayer) this.pc.onDeath();
    }
  }

  melee(s, ox, oy, oz, dx, dy, dz) {
    this.sound('melee', s);
    const h = this.world.raycast(ox, oy, oz, dx, dy, dz, 1.7), wt = h ? h.t : 1.7, c = h && h.c;
    const e = this.raySoldiers(s, ox, oy, oz, dx, dy, dz, wt);
    if (e) { this.damage(e.s, 999, s, false, dx, dz); return; }
    if (!h) return;
    const x = ox + dx * wt, y = oy + dy * wt, z = oz + dz * wt;
    if (c.kind === 'cell') { this.world.destroySphere(x, y, z, 0.33); this.soundAt('wall_break', x, y, z); }
    else if (c.kind === 'barricade') this.world.damageBarricade(c.op, 40);
  }

  throwGrenade(s, ox, oy, oz, dx, dy, dz, impact) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(impact ? 0.05 : 0.045, 10, 8), new THREE.MeshStandardMaterial({ color: impact ? 0x444a52 : 0x3d4a2c, roughness: 0.6 }));
    mesh.castShadow = true; this.extra.add(mesh);
    const sp = impact ? 20 : 15;
    this.grenades.push({ p: new THREE.Vector3(ox + dx * 0.4, oy - 0.1 + dy * 0.4, oz + dz * 0.4), v: new THREE.Vector3(dx * sp, dy * sp + 2, dz * sp), fuse: impact ? 6 : 2.6, impact, owner: s, mesh });
    this.sound('vault', s, 0.5);
  }

  explode(x, y, z, owner, radius, dmg, wallR) {
    this.world.destroySphere(x, y, z, wallR);
    this.fx.explosion(x, y, z, radius / 5);
    this.soundAt('explosion', x, y, z, 1);
    for (const s of this.soldiers) {
      if (!s.alive || (owner && s.team === owner.team && s !== owner)) continue;
      const cy = s.pos.y + s.eyeY * 0.6, d = Math.hypot(s.pos.x - x, cy - y, s.pos.z - z);
      if (d > radius || !this.world.los(x, Math.max(0.15, y), z, s.pos.x, cy, s.pos.z)) continue;
      this.damage(s, dmg * (1 - d / radius) * 1.3, owner, false, s.pos.x - x, s.pos.z - z);
    }
    if (owner) this.noise(x, z, 30, owner);
    const pd = Math.hypot(this.camera.position.x - x, this.camera.position.z - z);
    if (pd < 12) this.pc.shake = Math.max(this.pc.shake, 1 - pd / 12);
  }

  placeCharge(s, x, y, z, nx, nz) {
    if (s.charge || s.gad.charges <= 0) return false;
    s.gad.charges--;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, emissive: 0x330000 }));
    mesh.position.set(x + nx * 0.03, y, z + nz * 0.03); mesh.rotation.y = Math.abs(nx) > 0.5 ? Math.PI / 2 : 0;
    this.extra.add(mesh);
    s.charge = { x, y, z, nx, nz, mesh };
    this.soundAt('breach_place', x, y, z);
    return true;
  }
  detonate(s) {
    const c = s.charge;
    if (!c) return false;
    s.charge = null; this.extra.remove(c.mesh);
    this.explode(c.x - c.nx * 0.1, 1.15, c.z - c.nz * 0.1, s, 3, 70, 1.3);
    return true;
  }

  siteNear(s) { return this.map.sites.find(st => Math.hypot(st.x - s.pos.x, st.z - s.pos.z) < 3.4); }
  openingNear(s, r = 1.7) {
    let best = null, bd = r;
    for (const op of this.world.openings) { if (!op.canBarricade) continue; const d = Math.hypot(op.x - s.pos.x, op.z - s.pos.z); if (d < bd) { bd = d; best = op; } }
    return best;
  }
  // What F would do right now for this soldier: {type, label, dur, op}
  actionFor(s) {
    if (s.isAtk && this.phase === 'action' && this.siteNear(s)) return { type: 'plant', label: 'Plant defuser', dur: T.plant };
    if (!s.isAtk && this.phase === 'planted' && Math.hypot(this.bomb.x - s.pos.x, this.bomb.z - s.pos.z) < 1.7) return { type: 'defuse', label: 'Disable defuser', dur: T.defuse };
    const op = this.openingNear(s);
    if (op && (this.phase !== 'prep' || !s.isAtk)) return op.barricade ? { type: 'unbarricade', label: 'Remove barricade', dur: 1.2, op } : { type: 'barricade', label: 'Barricade', dur: 1.5, op };
    return null;
  }
  // Called every frame while the soldier holds interact. Returns the action (with progress on s.actionT).
  interact(s, dt) {
    const a = this.actionFor(s);
    if (!a) { s.actionT = 0; return null; }
    if (s.acting !== a.type) s.actionT = 0;
    s.acting = a.type; s._actFrame = this.frame; s.actionT += dt;
    if ((a.type === 'plant' || a.type === 'defuse') && Math.floor(s.actionT * 2) !== Math.floor((s.actionT - dt) * 2)) this.sound('beep', s, 0.5);
    if (s.actionT >= a.dur) {
      s.actionT = 0;
      if (a.type === 'plant') this.plant(s);
      else if (a.type === 'defuse') { this.audio.play('defuse_done'); this.endRound(this.defTeam, 'Defuser disabled'); }
      else if (a.type === 'barricade') this.world.deployBarricade(a.op);
      else this.world.damageBarricade(a.op, 999);
    }
    return a;
  }

  plant(s) {
    const mesh = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.24), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.4 }));
    box.position.y = 0.07; box.castShadow = true; mesh.add(box);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x30a0ff, emissiveIntensity: 4 }));
    lamp.position.set(0.1, 0.16, 0); mesh.add(lamp);
    mesh.position.set(s.pos.x, 0, s.pos.z); this.extra.add(mesh);
    this.bomb = { x: s.pos.x, z: s.pos.z, timer: T.bomb, mesh, beep: 0, lamp };
    this.phase = 'planted'; this.time = T.bomb;
    this.audio.play('plant_done');
    this.hud.banner('DEFUSER PLANTED', this.player.isAtk ? 'Protect it' : 'Disable it', 3);
    for (const b of this.bots) b.onPlanted();
  }

  endRound(team, reason) {
    if (this.phase === 'end' || this.phase === 'matchEnd') return;
    this.score[team]++;
    const won = team === this.playerTeam, over = this.score[team] >= T.wins;
    this.phase = over ? 'matchEnd' : 'end'; this.time = T.end;
    this.audio.play(won ? 'round_win' : 'round_lose');
    this.hud.banner(over ? (won ? 'VICTORY' : 'DEFEAT') : (won ? 'ROUND WON' : 'ROUND LOST'), `${reason} — ${FACTIONS[0].name} ${this.score[0]} : ${this.score[1]} ${FACTIONS[1].name}`, over ? 999 : T.end, won);
    if (over) this.hud.matchEnd(won);
  }

  update(dt) {
    this.frame = (this.frame || 0) + 1; this.clock += dt;
    if (this.phase === 'menu') return;
    const W = this.world;
    W.update(dt);
    this.pc.update(dt);
    const live = this.phase !== 'end' && this.phase !== 'matchEnd';
    for (const b of this.bots) if (b.s.alive) b.update(dt, live);
    // separation
    const S = this.soldiers;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4) { const k = (0.62 - d) / d * 0.5; if (!a.isPlayer) { a.pos.x -= dx * k; a.pos.z -= dz * k; } if (!b.isPlayer) { b.pos.x += dx * k; b.pos.z += dz * k; } }
    }
    for (const s of S) { if (s._actFrame !== this.frame) { s.actionT = 0; s.acting = null; } s.sync(dt); }
    // grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt; g.v.y -= 9.8 * dt;
      const sp = g.v.length(), st = sp * dt;
      let boom = g.fuse <= 0;
      if (!boom && sp > 0.01) {
        const h = W.raycast(g.p.x, g.p.y, g.p.z, g.v.x / sp, g.v.y / sp, g.v.z / sp, st + 0.05, 0);
        if (h) {
          if (g.impact) boom = true;
          else {
            g.p.addScaledVector(g.v, Math.max(0, h.t - 0.05) / sp);
            const dn = g.v.x * h.nx + g.v.y * h.ny + g.v.z * h.nz;
            g.v.x -= 2 * dn * h.nx; g.v.y -= 2 * dn * h.ny; g.v.z -= 2 * dn * h.nz; g.v.multiplyScalar(0.4);
            if (sp > 2) this.soundAt('grenade_bounce', g.p.x, g.p.y, g.p.z, 0.6);
          }
        } else g.p.addScaledVector(g.v, dt);
      }
      if (g.p.y < 0.05) { g.p.y = 0.05; if (g.v.y < 0) g.v.y = 0; }
      g.mesh.position.copy(g.p);
      if (boom) {
        this.extra.remove(g.mesh); this.grenades.splice(i, 1);
        if (g.impact) this.explode(g.p.x, g.p.y, g.p.z, g.owner, 2.5, 45, 1.0); else this.explode(g.p.x, g.p.y, g.p.z, g.owner, 5.5, 130, 1.4);
      }
    }
    this.fx.update(dt);
    // phases
    this.time -= dt;
    const atk = this.team(this.atkTeam).length, def = this.team(this.defTeam).length;
    if (this.phase === 'prep') {
      if (this.time <= 0) { this.phase = 'action'; this.time = T.action; this.pc.onAction(); this.hud.banner('ACTION PHASE', this.player.isAtk ? 'Plant the defuser at A or B' : 'Hold the sites', 2.5); this.audio.play('round_start'); }
    } else if (this.phase === 'action') {
      this.planT -= dt;
      if (this.planT <= 0) {
        this.planT = 0.6;
        const st = this.map.sites[this.site];
        let best = null, bd = 1e9;
        for (const b of this.bots) if (b.s.alive && b.s.isAtk) { const d = Math.hypot(b.s.pos.x - st.x, b.s.pos.z - st.z); if (d < bd) { bd = d; best = b; } }
        this.planter = best;
      }
      if (!def) this.endRound(this.atkTeam, 'Defenders eliminated');
      else if (!atk) this.endRound(this.defTeam, 'Attackers eliminated');
      else if (this.time <= 0 && !S.some(s => s.alive && s.acting === 'plant')) this.endRound(this.defTeam, 'Time expired');
    } else if (this.phase === 'planted') {
      const b = this.bomb;
      b.beep -= dt;
      if (b.beep <= 0) { b.beep = this.time < 10 ? 0.25 : this.time < 20 ? 0.5 : 1; this.soundAt('beep', b.x, 0.2, b.z, 0.8); b.lamp.visible = !b.lamp.visible; }
      if (this.time <= 0) { this.explode(b.x, 0.3, b.z, null, 9, 300, 2.5); this.endRound(this.atkTeam, 'Objective destroyed'); }
      else if (!def) this.endRound(this.atkTeam, 'Defenders eliminated');
    } else if (this.phase === 'end') {
      if (this.time <= 0) { this.atkTeam = 1 - this.atkTeam; this.startRound(); }
    }
    this.hud.update(this, dt);
  }
}
