'use strict';
// match: effects, projectiles (rockets, shells, torpedoes, grenades), the host's rules (damage, kills, score, spawns, pickups, boats, bots),
// events (emit -> applyEv everywhere) and the network messages.
G.pl = {}; G.ts = [0, 0]; G.tl = 0;
const HS = new Map(); // host: id -> {hp, alive, k, d, s, hitT, deadT, prot, lo}
const PK = []; // pickup respawn times (0 = there)
const BOTS = new Map();

// ---------------- effects
const FX = [];
function fxSprite(x, y, z, tex, col, s, life, o = {}) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, color: col, transparent: true, depthWrite: false, blending: o.add === false ? THREE.NormalBlending : THREE.AdditiveBlending, opacity: o.op ?? 1})); sp.position.set(x, y, z); sp.scale.setScalar(s); scene.add(sp); FX.push({sp, t: 0, life, s0: s, s1: o.grow ?? s * 1.5, vy: o.vy || 0, op: o.op ?? 1}); return sp; }
function fxImpact(p, n, metal) { fxSprite(p[0], p[1], p[2], TX.glow, metal ? 0xffd080 : 0xd8c8a8, .35, .15); fxSprite(p[0], p[1], p[2], TX.smoke, 0xb0a890, .4, .6, {add: false, op: .6, grow: 1.1, vy: .4}); }
function fxBlood(p) { fxSprite(p[0], p[1], p[2], TX.smoke, 0x8a0a0a, .45, .4, {add: false, op: .9, grow: .9}); }
function fxSplash(x, y, z, s = 1, wake) { fxSprite(x, y + .1, z, TX.smoke, 0xffffff, s, wake ? 1.2 : .7, {add: false, op: wake ? .5 : .8, grow: s * 2.2, vy: wake ? 0 : 1.5}); }
function fxSmoke(x, y, z, black) { fxSprite(x + rnd(-.3, .3), y, z + rnd(-.3, .3), TX.smoke, black ? 0x2a2a2a : 0x7a7a7a, .8, 3, {add: false, op: .55, grow: 3, vy: 1.6}); }
function fxFlash(x, y, z, s = 1) { fxSprite(x, y, z, TX.glow, 0xffc070, s, .08); MFL.position.set(x, y, z); MFL.intensity = 40; }
function fxBoom(x, y, z, big, water) { fxSprite(x, y, z, TX.glow, 0xffa040, big ? 9 : 6, .35); MFL.position.set(x, y + 1, z); MFL.intensity = 160; for (let i = 0; i < (big ? 9 : 6); i++) fxSprite(x + rnd(-1, 1), y + rnd(0, 1), z + rnd(-1, 1), TX.smoke, water ? 0xffffff : 0x403830, rnd(2, 3.5), rnd(1.5, 3), {add: false, op: .75, grow: 7, vy: rnd(1, 3)}); if (water) for (let i = 0; i < 5; i++) fxSprite(x + rnd(-1.5, 1.5), .5, z + rnd(-1.5, 1.5), TX.smoke, 0xffffff, 2, 1.6, {add: false, op: .9, grow: 5, vy: rnd(3, 7)});
  const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z); G.shake = Math.max(G.shake || 0, clamp(1 - d / (big ? 40 : 28), 0, 1)); Snd.boom(aPan(x, y, z, 10), big); }
const TRC = [];
function fxTracer(a, b, col, slow) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), l = new THREE.Line(g, new THREE.LineBasicMaterial({color: col, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false})); scene.add(l); TRC.push({l, t: slow ? .25 : .07}); }
function fxFrame(dt) {
  for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; f.t += dt; const k = f.t / f.life; if (k >= 1) { scene.remove(f.sp); f.sp.material.dispose(); FX.splice(i, 1); continue; } f.sp.scale.setScalar(mix(f.s0, f.s1, k)); f.sp.material.opacity = f.op * (1 - k); f.sp.position.y += f.vy * dt; }
  for (let i = TRC.length - 1; i >= 0; i--) { const t = TRC[i]; t.t -= dt; t.l.material.opacity = Math.max(0, t.t * 10); if (t.t <= 0) { scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); TRC.splice(i, 1); } }
}

// ---------------- events
function emit(e) { applyEv(e); if (Net.role === 'host') G.evq.push(e); }
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({t: 'act'}, m)); }
function applyEv(e) {
  const me = myId();
  switch (e.k) {
    case 'dm': if (e.id === me) { G.hurt = 1; Snd.hurt(); dmgDir(e.x, e.z); } if (e.by === me && e.id !== me) hitMark(e.hd ? 'h' : ''); break;
    case 'kl': { const vic = nameOf(e.id), kil = nameOf(e.by); feed(e); if (e.id === me) { P.alive = false; P.seat = null; G.killer = e.by !== me ? e.by : null; G.killCam = {t: 0, x: P.x, y: P.y, z: P.z}; G.deadT = G.t; G.deadMsg = e.by === me || !e.by ? (e.w === 'drown' ? 'You drowned.' : e.w === 'fall' ? 'You fell.' : e.w === 'oob' ? 'You left the arena.' : 'You blew yourself up.') : `<b>${esc(kil)}</b> got you${e.w ? ' with the ' + (WPN[e.w] ? (e.w === 'smg' || e.w === 'lmg' ? WPN[e.w].n : WPN[e.w].n.toLowerCase()) : e.w === 'knife' ? 'knife' : e.w === 'boat' ? 'sinking boat' : e.w) : ''}${e.hd ? ' (headshot)' : ''}.${killInfo(e)}`; setTimeout(() => { if (!P.alive && G.on && !G.over) showDead(); }, 1600); }
      if (e.by === me && e.id !== me) { hitMark('k'); Snd.kill(); killStreak(vic, e); } if (e.id === me) G.streak = 0; break; }
    case 'sp': if (e.id === me) { placePlayer(e); P.spT = G.t; hideDead(); } else { const a = AVS.get(e.id); if (a) { a.buf = new Buf(); a.dT = 0; } } break;
    case 'seat': { const b = BOATS[e.b]; if (!b) break; if (e.r === 'd') { if (b.drv !== e.id) b.buf = new Buf(); b.drv = e.id; } else b.gun = e.id; if (e.id === me) { P.seat = {b: e.b, r: e.r}; P.lastBY = b.ryaw; showMsg(e.r === 'd' ? 'W/S throttle · A/D steer · F torpedo · E get up' : 'Mouse aims · click fires · E get up', 3); } break; }
    case 'unseat': { const b = BOATS[e.b]; if (!b) break; if (e.r === 'd' && b.drv === e.id) { b.drv = ''; b.buf = new Buf(); } if (e.r === 'g' && b.gun === e.id) b.gun = ''; if (e.id === me && P.seat) { P.seat = null; P.bl = [e.r === 'd' ? .9 : .9, BT.DECK, e.r === 'd' ? 1.4 : -1.6]; } break; }
    case 'pj': if (!PJ.has(e.id)) pjSpawn({id: e.id, k: e.kd, o: e.o, v: e.v, by: e.by, b: e.b}); break;
    case 'bx': { const p = PJ.get(e.id); if (p) pjDrop(p); fxBoom(e.x, e.y, e.z, e.big, e.w); break; }
    case 'bs': { const b = BOATS[e.b]; if (!b) break; b.sunk = 1; b.st = 0; b.drv = b.gun = ''; fxBoom(b.rx, 1.5, b.rz, true, true); feed({k: 'bs', b: e.b, by: e.by}); if (P.bi === e.b) { P.seat = null; P.bi = -1; P.sw = 1; P.y = -1.28; P.vy = 0; } break; }
    case 'br': { const b = BOATS[e.b]; if (b) resetBoat(b); break; }
    case 'pku': if (e.id === me) gotPick(e.kd); break;
    case 'sh': if (e.id !== me) { const k = WKEYS[e.w] || 'pistol'; fxTracer(e.o, e.e, k === 'harpoon' ? 0x9aa0a8 : 0xffe0a0, k === 'harpoon'); fxFlash(e.o[0], e.o[1], e.o[2], .5); Snd.gun(k, aPan(e.o[0], e.o[1], e.o[2], 6)); const a = AVS.get(e.id); if (a) { a.flT = .05; a.shT = G.t + 2; }
      // a near miss whizzes past you
      if (P.alive) { const ab = [e.e[0] - e.o[0], e.e[1] - e.o[1], e.e[2] - e.o[2]], L = Math.hypot(...ab) || 1, t = ((P.x - e.o[0]) * ab[0] + (P.y + 1.5 - e.o[1]) * ab[1] + (P.z - e.o[2]) * ab[2]) / L; if (t > 2 && t < L) { const q = [e.o[0] + ab[0] / L * t, e.o[1] + ab[1] / L * t, e.o[2] + ab[2] / L * t]; if (Math.hypot(q[0] - P.x, q[1] - P.y - 1.5, q[2] - P.z) < 1.6) Snd.whiz(); } } } break;
    case 'end': G.over = true; showEnd(e); break;
    case 'rs': G.over = false; hideEnd(); G.ts = [0, 0]; P.alive = false; for (const b of BOATS) resetBoat(b); for (const p of PJ.values()) pjDrop(p); showDead(true); break;
    case 'ro': G.roster = e.ro; for (const id of [...AVS.keys()]) if (!G.roster.some(r => r.id === id)) dropAvatar(id); for (const a of AVS.values()) { const c = avColor(a.id); a.vest.color.set(c); } break;
    case 'msg': showMsg(e.t, 3); break;
    case 'tp': if (e.id === me) showMsg('Torpedo away!', 1.2); break;
  }
}

// ---------------- projectiles (the host decides where they burst; everyone flies them)
const PJ = new Map(); let pjN = 1;
const PJK = {rk: {v: 55, g: 1.5, life: 4, r: 4.5, dmg: 110, bd: 120}, sh: {v: 120, g: 6, life: 3.2, r: 3.6, dmg: 60, bd: 45}, tp: {v: 26, g: 0, life: 7.5, r: 4.5, dmg: 95, bd: 160}, gr: {v: 0, g: 18, life: 2.6, r: 6, dmg: 105, bd: 50}};
function pjMesh(k) { const g = new THREE.Group(); if (k === 'gr') { g.add(new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), MAT.ammo)); } else if (k === 'tp') { const m = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 2, 10), MAT.dark); m.rotation.x = PI / 2; g.add(m); } else { const m = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, k === 'rk' ? .6 : .35, 8), MAT.rust); m.rotation.x = PI / 2; g.add(m); const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffb050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.scale.setScalar(k === 'rk' ? 1.3 : .8); s.position.z = .3; g.add(s); } scene.add(g); return g; }
function pjSpawn(e) { const p = {id: e.id, k: e.k, x: e.o[0], y: e.o[1], z: e.o[2], vx: e.v[0], vy: e.v[1], vz: e.v[2], by: e.by, b: e.b ?? -1, t: 0, m: pjMesh(e.k)}; PJ.set(e.id, p); if (e.k === 'rk') Snd.gun('rocket', aPan(p.x, p.y, p.z, 6)); if (e.k === 'tp') Snd.splash(aPan(p.x, 0, p.z, 6), true); return p; }
function pjDrop(p) { scene.remove(p.m); PJ.delete(p.id); }
function pjFrame(dt) {
  for (const p of [...PJ.values()]) { const K0 = PJK[p.k]; p.t += dt; const ox = p.x, oy = p.y, oz = p.z;
    if (p.k === 'tp') { p.y = -.35; } else { p.vy -= K0.g * dt; if (p.k === 'gr' && p.y < 0) { p.vx *= 1 - dt * 3; p.vz *= 1 - dt * 3; p.vy = mix(p.vy, -1, dt * 4); } }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.k === 'gr') { const f = floorStatic(p.x, p.z, oy + .3), fb = boatFloor(p.x, p.z, oy + .3), fy = Math.max(f, fb ? fb.y : -1e9); if (p.y < fy + .07) { p.y = fy + .07; if (p.vy < 0) { p.vy = -p.vy * .32; p.vx *= .6; p.vz *= .6; } }
      const o = {x: p.x, z: p.z, y: p.y - .3}; const px = o.x, pz = o.z; pushStatic(o, .1, .6); if (o.x !== px) p.vx *= -.4; if (o.z !== pz) p.vz *= -.4; p.x = o.x; p.z = o.z; }
    if (p.k === 'tp' && Math.random() < dt * 20) fxSplash(p.x, 0, p.z, .45, true);
    if (p.k === 'rk' && Math.random() < dt * 40) fxSmoke(p.x, p.y, p.z, false);
    const sp = Math.hypot(p.vx, p.vy, p.vz); if (sp > .1) p.m.lookAt(p.x - p.vx, p.y - p.vy, p.z - p.vz); p.m.position.set(p.x, p.y, p.z);
    if (isHost()) pjHost(p, ox, oy, oz, K0);
    else if (p.t > K0.life + 1.5) pjDrop(p);
  }
}
function pjHost(p, ox, oy, oz, K0) {
  let hit = p.t > K0.life;
  if (!hit && p.k !== 'gr') { const d = [p.x - ox, p.y - oy, p.z - oz], L = Math.hypot(...d); if (L > 1e-4) { const u = d.map(v => v / L); const ts = rayStatic([ox, oy, oz], u, L + .1, p.k !== 'tp'); if (ts < Infinity) { hit = true; p.x = ox + u[0] * ts; p.y = oy + u[1] * ts; p.z = oz + u[2] * ts; } }
    if (p.k === 'tp' && groundH(p.x, p.z) > -.9) hit = true;
    for (const b of BOATS) if (!hit && b.vis && !(b.i === p.b && p.t < .8) && inBoatHull(b, p.x, p.y, p.z, p.k === 'tp' ? .3 : .1)) hit = true;
    if (!hit && p.k !== 'tp') for (const t of targets()) if (t.id !== p.by && Math.hypot(t.x - p.x, t.y + 1 - p.y, t.z - p.z) < 1.1) { hit = true; break; } }
  if (hit) boom(p);
}
function targets() { const L = []; for (const [id, s] of HS) { if (!s.alive) continue; const q = id === P.id ? [P.x, P.y, P.z, P.bi] : BOTS.has(id) ? [BOTS.get(id).x, BOTS.get(id).y, BOTS.get(id).z, BOTS.get(id).bi] : AVS.get(id) && AVS.get(id).rp ? [...AVS.get(id).rp, AVS.get(id).bi ?? -1] : null; if (q) L.push({id, x: q[0], y: q[1], z: q[2], bi: q[3]}); } return L; }
function boom(p) {
  const K0 = PJK[p.k], w = p.y < .3 && groundH(p.x, p.z) < -.5; emit({k: 'bx', id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), big: p.k === 'tp' || p.k === 'rk', w});
  const wk = p.k === 'rk' ? 'rocket' : p.k === 'gr' ? 'grenade' : p.k === 'sh' ? 'deck gun' : 'torpedo';
  for (const t of targets()) { const d = Math.hypot(t.x - p.x, t.y + 1 - p.y, t.z - p.z); if (d > K0.r) continue; let dm = K0.dmg * Math.pow(1 - d / K0.r, .7); if (!losStatic([p.x, p.y + .3, p.z], [t.x, t.y + 1.2, t.z])) dm *= .3; if (t.id === p.by) dm *= .6; damage(t.id, dm, p.by, wk, false, [p.x, p.y, p.z]); }
  for (const b of BOATS) if (b.vis && inBoatHull(b, p.x, p.y, p.z, K0.r * .6)) { const [lx, lz] = boatW2L(b, p.x, p.z), d = Math.max(0, Math.hypot(Math.max(0, Math.abs(lx) - 1.6), Math.max(0, Math.abs(lz) - 4.5))); boatDmg(b, K0.bd * (1 - clamp(d / K0.r, 0, .9)), p.by); }
  pjDrop(p);
}

// ---------------- host rules
const live = id => { const s = HS.get(id); return !!(s && s.alive); };
function teamMode() { return G.set && G.set.mode === 'boat'; }
function enemies(a, b) { return a !== b && (!teamMode() || teamOf(a) !== teamOf(b)); }
function damage(id, amt, by, w, head, at) {
  const s = HS.get(id); if (!s || !s.alive || G.over || amt <= 0) return; if (by !== id && !enemies(by, id)) return; if (s.prot > G.t && by !== id) return;
  s.hp -= amt; s.hitT = G.t; emit({k: 'dm', id, by, d: Math.round(amt), hd: head ? 1 : 0, x: at ? +at[0].toFixed(1) : 0, z: at ? +at[2].toFixed(1) : 0});
  if (s.hp <= 0) kill(id, by, w, head);
}
function kill(id, by, w, head) {
  const s = HS.get(id); s.alive = false; s.hp = 0; s.d++; s.deadT = G.t; for (const b of BOATS) { if (b.drv === id) { b.drv = ''; emit({k: 'unseat', b: b.i, r: 'd', id}); } if (b.gun === id) { b.gun = ''; emit({k: 'unseat', b: b.i, r: 'g', id}); } }
  const k = HS.get(by); if (k && by !== id) { k.k++; k.s++; if (teamMode()) G.ts[teamOf(by)]++; } else if (by === id || !by) s.s = Math.max(0, s.s - 1);
  emit({k: 'kl', id, by, w, hd: head ? 1 : 0, kh: k && by !== id ? Math.max(1, Math.ceil(k.hp)) : 0}); checkWin();
}
function boatDmg(b, d, by) {
  if (b.sunk || G.over || d <= 0) return; if (teamMode() && b.team != null && teamOf(by) === b.team) return; b.hp -= d; b.lastBy = by;
  if (b.hp <= 0) { b.hp = 0; b.sunk = 1; b.sunkT = G.t; const occ = []; for (const t of targets()) if (t.bi === b.i) occ.push(t.id);
    emit({k: 'bs', b: b.i, by}); const k = HS.get(by); if (k) { k.s += teamMode() ? 3 : 2; k.sk = (k.sk || 0) + 1; if (teamMode() && b.team != null) G.ts[teamOf(by)] += 3; }
    for (const id of occ) damage(id, 35, by, 'boat', false, [b.rx, 1, b.rz]); for (const bt of BOTS.values()) if (bt.bi === b.i) { bt.bi = -1; bt.seat = null; } b.drv = b.gun = ''; checkWin(); }
}
function checkWin() { if (G.over) return; const g = G.set.goal; if (!g) return; if (teamMode()) { for (const t of [0, 1]) if (G.ts[t] >= g) return endMatch(); } else for (const s of HS.values()) if (s.s >= g) return endMatch(); }
function standings() { return [...HS.entries()].map(([id, s]) => ({id, n: nameOf(id), t: teamOf(id), k: s.k, d: s.d, s: s.s, sk: s.sk || 0, bot: BOTS.has(id) ? 1 : 0})).sort((a, b) => b.s - a.s || b.k - a.k || a.d - b.d); }
function endMatch() { if (G.over) return; const st = standings(); let win; if (teamMode()) win = G.ts[0] === G.ts[1] ? 'Draw' : TEAM_N[G.ts[0] > G.ts[1] ? 0 : 1] + ' team wins'; else win = st[0] ? st[0].n + ' wins' : 'Match over'; emit({k: 'end', win, st, ts: G.ts.slice()}); G.endT = G.t; }
function pickSpawn(id) {
  const tm = teamMode() ? teamOf(id) : null, all = targets().filter(t => t.id !== id), en = all.filter(t => enemies(id, t.id)); let best = null, bs = -1e9;
  for (const s of SPAWNS) { if (tm != null && s.t != null && s.t !== tm) continue; let md = 999; for (const e of en) md = Math.min(md, Math.hypot(e.x - s.x, e.z - s.z)); let crowd = 0; for (const e of all) if (Math.hypot(e.x - s.x, e.z - s.z) < 3) crowd += 60; if (G.t - (s.used || -99) < 4) crowd += 40; const sc = Math.min(md, 70) + Math.random() * 18 - (tm != null && s.t == null ? 15 : 0) - crowd; if (sc > bs) { bs = sc; best = s; } }
  best = best || SPAWNS[0]; best.used = G.t; const y = floorStatic(best.x, best.z, Math.max(groundH(best.x, best.z), 1.3) + .4); return {x: best.x + rnd(-.8, .8), y, z: best.z + rnd(-.8, .8), yaw: best.yaw};
}
function hostSpawn(id, lo) { const s = HS.get(id); if (!s || s.alive || G.over) return; if (G.t - (s.deadT ?? -99) < 3) return; s.alive = true; s.hp = 100; s.prot = G.t + 1.6; s.lo = clamp(lo | 0, 0, LOADOUTS.length - 1); const sp = pickSpawn(id); emit({k: 'sp', id, x: +sp.x.toFixed(2), y: +sp.y.toFixed(2), z: +sp.z.toFixed(2), yaw: +sp.yaw.toFixed(2), lo: s.lo}); const bt = BOTS.get(id); if (bt) botPlace(bt, sp); }
const PICK_T = {hp: 25, ammo: 25, nade: 30}; const pickT = k => PICK_T[k] || 45;
function hostPick(id, i, pos) { const q = PICKS[i]; if (!q || PK[i] > 0 || !live(id)) return; if (pos && Math.hypot(pos[0] - q.x, pos[2] - q.z) > 3.5) return; const s = HS.get(id); if (q.k === 'hp') { if (s.hp >= 100) return; s.hp = 100; } PK[i] = pickT(q.k); emit({k: 'pku', i, id, kd: q.k}); const bt = BOTS.get(id); if (bt) botGot(bt, q.k); }
function hostAct(id, m) {
  if (!G.on) return; const s = HS.get(id);
  switch (m.a) {
    case 'spawn': hostSpawn(id, m.lo); break;
    case 'hit': { if (!s || !s.alive || typeof m.id !== 'string') return; const W = WPN[m.w], cap = m.w === 'knife' ? 60 : W ? W.dmg * (W.pel || 1) * W.hd * 1.05 : 0; const d = clamp(+m.d || 0, 0, cap); if (d > 0) { s.prot = 0; damage(m.id, d, id, m.w, !!m.hd, avatarPos(m.id)); } break; }
    case 'bh': { const b = BOATS[m.b]; if (b && s && s.alive) boatDmg(b, clamp(+m.d || 0, 0, 20), id); break; }
    case 'self': if (s && s.alive) damage(id, clamp(+m.d || 0, 0, 200), id, m.why, false, null); break;
    case 'sh': if (s && s.alive && Array.isArray(m.o) && Array.isArray(m.e)) { s.prot = 0; emit({k: 'sh', id, w: m.w | 0, o: m.o, e: m.e}); } break;
    case 'gr': if (s && s.alive && Array.isArray(m.o) && Array.isArray(m.v)) { s.prot = 0; const e = {k: 'pj', id: pjN++, kd: 'gr', o: m.o, v: m.v.map(v => clamp(v, -30, 30)), by: id}; emitPj(e); } break;
    case 'rk': if (s && s.alive && Array.isArray(m.o) && Array.isArray(m.d)) { s.prot = 0; const v = m.d.map(q => q * PJK.rk.v); emitPj({k: 'pj', id: pjN++, kd: 'rk', o: m.o.map((q, i) => q + m.d[i] * .8), v, by: id}); } break;
    case 'dg': { const b = BOATS[m.b]; if (!b || b.gun !== id || !s || !s.alive || (b.gT > G.t)) return; b.gT = G.t + BT.SHELL * .9; const d = m.d, bv = m.bv || [0, 0]; emitPj({k: 'pj', id: pjN++, kd: 'sh', o: m.o, v: [d[0] * PJK.sh.v + bv[0], d[1] * PJK.sh.v, d[2] * PJK.sh.v + bv[1]], by: id, b: b.i}); break; }
    case 'tp': { const b = BOATS[m.b]; if (!b || b.drv !== id || !s || !s.alive) return; const ti = b.tp[0] <= G.t ? 0 : b.tp[1] <= G.t ? 1 : -1; if (ti < 0) { emit({k: 'msg', t: '', id}); return; } b.tp[ti] = G.t + BT.TP; const sx = ti ? 1.15 : -1.15, [x, z] = boatL2W(b, sx, -5.2), f = [-Math.sin(b.ryaw), -Math.cos(b.ryaw)], sp = PJK.tp.v + Math.max(0, b.rv || 0); emitPj({k: 'pj', id: pjN++, kd: 'tp', o: [x, -.35, z], v: [f[0] * sp, 0, f[1] * sp], by: id, b: b.i}); emit({k: 'tp', id}); break; }
    case 'seat': { const b = BOATS[m.b]; if (!b || !b.vis || !s || !s.alive) return; if (m.r === 'd' && !b.drv) emit({k: 'seat', b: b.i, r: 'd', id}); else if (m.r === 'g' && !b.gun) emit({k: 'seat', b: b.i, r: 'g', id}); break; }
    case 'unseat': { const b = BOATS[m.b]; if (!b) return; if (b.drv === id) emit({k: 'unseat', b: b.i, r: 'd', id}); if (b.gun === id) emit({k: 'unseat', b: b.i, r: 'g', id}); break; }
    case 'crash': { const b = BOATS[m.b]; if (b && (b.drv === id || (id === P.id && !b.drv))) boatDmg(b, clamp((+m.s - 7) * 7, 0, 60), b.lastBy && G.t - (b.lastHitT || 0) < 5 ? b.lastBy : id); break; }
    case 'pick': hostPick(id, m.i | 0, avatarPos(id)); break;
  }
}
function emitPj(e) { e.o = e.o.map(q => +(+q).toFixed(2)); e.v = e.v.map(q => +(+q).toFixed(2)); const ev = {k: 'pj', id: e.id, kd: e.kd, o: e.o, v: e.v, by: e.by, b: e.b}; G.evq && Net.role === 'host' && G.evq.push(ev); pjSpawn({id: e.id, k: e.kd, o: e.o, v: e.v, by: e.by, b: e.b}); }
function updPl() { const pl = {}; for (const [id, s] of HS) pl[id] = [Math.round(s.hp), s.alive ? 1 : 0, teamOf(id), s.k, s.d, s.s, s.lo | 0]; G.pl = pl; const me = HS.get(P.id); if (me) P.hp = me.hp; }
function hostTick(dt) {
  if (!G.over) { G.tl -= dt; if (G.set.time && G.tl <= 0) { G.tl = 0; endMatch(); } }
  else if (G.t - G.endT > 14) matchReset();
  for (const [id, s] of HS) { if (s.alive && s.hp < 100 && G.t - (s.hitT || 0) > 5) s.hp = Math.min(100, s.hp + dt * 14); }
  for (let i = 0; i < PK.length; i++) if (PK[i] > 0) PK[i] = Math.max(0, PK[i] - dt);
  for (const b of BOATS) if (b.sunk && G.t - b.sunkT > 16) { emit({k: 'br', b: b.i}); }
  updPl();
  for (const bt of BOTS.values()) botStep(bt, dt);
  // bots walk over pickups
  for (const bt of BOTS.values()) if (bt.alive) PICKS.forEach((q, i) => { if (!PK[i] && Math.hypot(bt.x - q.x, bt.z - q.z) < 1.4 && Math.abs(bt.y - q.y) < 1.5) hostPick(bt.id, i, null); });
}
function matchReset() { for (const s of HS.values()) Object.assign(s, {hp: 100, alive: false, k: 0, d: 0, s: 0, sk: 0, deadT: -99}); G.ts = [0, 0]; G.tl = (G.set.time || 0) * 60; PK.fill(0); emit({k: 'rs'}); G.over = false; for (const bt of BOTS.values()) { bt.alive = false; bt.respT = G.t + 1 + Math.random() * 2; } }
function packSnap() {
  updPl(); const pl = G.pl;
  const s = {t: 'snap', ts: Math.round(NOW()), b: BOATS.map(b => [+b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(3), +(b.v || 0).toFixed(2), Math.round(b.hp), b.drv, b.gun, b.sunk ? 1 : 0, b.tp[0] > G.t ? Math.ceil(b.tp[0] - G.t) : 0, b.tp[1] > G.t ? Math.ceil(b.tp[1] - G.t) : 0]),
    bots: {}, pl, ts2: G.ts, tl: Math.round(G.tl), pk: PK.map(t => t > 0 ? 1 : 0).join(''), ov: G.over ? 1 : 0, ev: G.evq};
  for (const bt of BOTS.values()) s.bots[bt.id] = botPose(bt); G.evq = []; return s;
}
function applySnap(s) {
  for (const e of s.ev || []) applyEv(e);
  s.b.forEach((q, i) => { const b = BOATS[i]; if (!b) return; b.hp = q[4]; b.drv = q[5]; b.gun = q[6]; if (q[7] && !b.sunk) { b.sunk = 1; b.st = 0; } if (!q[7] && b.sunk) resetBoat(b); b.tpc = [q[8], q[9]]; if (!b.drv) b.buf.push(s.ts, [q[0], q[1], q[2], q[3]]); });
  for (const id in s.bots) avatar(id).buf.push(s.ts, s.bots[id]);
  G.pl = s.pl; G.ts = s.ts2; G.tl = s.tl; PK.length = 0; for (const c of s.pk) PK.push(c === '1' ? 1 : 0); G.overS = s.ov;
  const me = G.pl[myId()]; if (me) { P.hp = me[0]; if (!me[1] && P.alive && G.t - (P.spT || 0) > 3) { P.alive = false; showDead(); } }
}

// ---------------- bots (host only)
const BOT_NAMES = ['Gull', 'Barnacle', 'Squid', 'Rook', 'Marlin', 'Piston', 'Brine', 'Cutter', 'Kelp', 'Anchor', 'Grommet', 'Skate'];
function makeBot(i, team) { const id = 'b' + i; return {id, name: BOT_NAMES[i % BOT_NAMES.length] + ' (bot)', team, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, vy: 0, alive: false, respT: 1 + i * .4, path: null, pathT: 0, goal: null, tgt: null, seeT: 0, fireT: 0, mag: 0, relT: 0, w: 'smg', nades: 2, strafe: 1, strT: 0, stuckT: 0, lastX: 0, lastZ: 0, thinkT: 0, aimE: .2, bi: -1, seat: null, sw: 0, cr: 0, lo: 0}; }
function botPlace(bt, sp) { Object.assign(bt, {x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, vx: 0, vz: 0, vy: 0, alive: true, path: null, tgt: null, seeT: 0, bi: -1, seat: null, sw: 0}); const L = LOADOUTS[bt.lo]; bt.w = L.p; bt.mag = WPN[bt.w].mag; bt.nades = L.g; }
function botGot(bt, k) { if (WPN[k]) { bt.w = k; bt.mag = WPN[k].mag; } if (k === 'nade') bt.nades = Math.min(4, bt.nades + 2); }
function botPose(bt) { return [+bt.x.toFixed(2), +bt.y.toFixed(2), +bt.z.toFixed(2), +bt.yaw.toFixed(3), +bt.pitch.toFixed(3), (bt.cr ? 1 : 0) | (bt.sw ? 2 : 0) | (bt.seat ? 64 : 0), WIX(bt.w), bt.bi, bt.bl ? bt.bl[0] : 0, bt.bl ? bt.bl[1] : 0, bt.bl ? bt.bl[2] : 0, 0, bt.bi >= 0 ? +BOATS[bt.bi].ryaw.toFixed(3) : 0]; }
const SKILL = {1: {react: .7, err: .03, burst: .5}, 2: {react: .42, err: .017, burst: .72}, 3: {react: .24, err: .009, burst: .9}};
function botStep(bt, dt) {
  const s = HS.get(bt.id); if (!s) return; if (!s.alive) { bt.alive = false; if (!G.over && G.t >= bt.respT && G.t - (s.deadT ?? -99) > 3.5) { bt.lo = Math.random() * 4 | 0; hostSpawn(bt.id, bt.lo); } return; }
  if (!bt.alive) return; const SK = SKILL[G.set.skill] || SKILL[2], W = WPN[bt.w];
  // the deck gun: aim at the nearest enemy (boats first) and fire
  if (bt.seat) { const b = BOATS[bt.seat.b]; if (!b || !b.vis || b.gun !== bt.id) { bt.seat = null; bt.bi = -1; } else { const [x, z] = boatL2W(b, 0, BT.GUN[1]); bt.x = x; bt.z = z; bt.y = b.hy + BT.DECK; bt.bl = [0, BT.DECK, BT.GUN[1]];
      let tg = null, td = 140; for (const o of BOATS) if (o !== b && o.vis && (o.drv || o.gun) && (!teamMode() || o.team !== b.team)) { const d = Math.hypot(o.rx - x, o.rz - z); if (d < td) { td = d; tg = [o.rx, o.hy + 1.2, o.rz]; } }
      if (!tg) for (const t of targets()) if (enemies(bt.id, t.id) && t.bi !== b.i) { const d = Math.hypot(t.x - x, t.z - z); if (d < Math.min(td, 90) && losStatic([x, bt.y + 1.6, z], [t.x, t.y + 1.2, t.z])) { td = d; tg = [t.x, t.y + 1, t.z]; } }
      if (tg) { const dx = tg[0] - x, dz = tg[2] - z, hd = Math.hypot(dx, dz), tof = hd / PJK.sh.v, dy = tg[1] - (bt.y + 1.8) + .5 * PJK.sh.g * tof * tof; const yw = Math.atan2(-dx, -dz) + rnd(-1, 1) * SK.err * 1.5; bt.yaw += angD(bt.yaw, yw) * Math.min(1, dt * 4); bt.pitch = Math.atan2(dy, hd); if (Math.abs(angD(bt.yaw, yw)) < .08 && !(b.gT > G.t)) { const f = fwd(bt.yaw, bt.pitch + rnd(-1, 1) * SK.err); hostAct(bt.id, {a: 'dg', b: b.i, o: [x + f[0] * 2, bt.y + 1.75 + f[1] * 2, z + f[2] * 2], d: f, bv: [0, 0]}); } }
      else if ((bt.gunT = (bt.gunT || 0) + dt) > 12) { bt.gunT = 0; hostAct(bt.id, {a: 'unseat', b: b.i}); bt.seat = null; bt.bi = -1; } else bt.gunT += 0; return; } }
  bt.thinkT -= dt; bt.fireT -= dt; if (bt.relT > 0 && (bt.relT -= dt) <= 0) bt.mag = W.mag;
  const eye = [bt.x, bt.y + 1.6, bt.z];
  if (bt.thinkT <= 0) { bt.thinkT = .25 + Math.random() * .1; let best = null, bd = W.zoom ? 160 : 85;
    for (const t of targets()) { if (!enemies(bt.id, t.id)) continue; const d = Math.hypot(t.x - bt.x, t.z - bt.z, t.y - bt.y); if (d > bd) continue; const ang = Math.abs(angD(bt.yaw, Math.atan2(-(t.x - bt.x), -(t.z - bt.z)))); if (ang > 1.4 && d > 12 && !(bt.tgt && bt.tgt.id === t.id)) continue; if (!losStatic(eye, [t.x, t.y + (t.bi >= 0 ? 1.3 : 1.2), t.z])) continue; bd = d; best = t; }
    if (best) { if (!bt.tgt || bt.tgt.id !== best.id) { bt.seeT = 0; bt.aimE = SK.err * 3; } bt.tgt = best; bt.lastSeen = [best.x, best.z]; } else bt.tgt = null;
    // nothing to fight: head for health when hurt, a gun, a friendly boat's deck gun, the last place you saw someone, or somewhere central
    if (!bt.tgt && (!bt.path || !bt.path.length || G.t > bt.pathT)) { let goal = null;
      if (s.hp < 55) { let bd2 = 1e9; PICKS.forEach((q, i) => { if (q.k === 'hp' && !PK[i] && q.y < 5) { const d = Math.hypot(q.x - bt.x, q.z - bt.z); if (d < bd2) { bd2 = d; goal = [q.x, q.z]; } } }); }
      if (!goal && Math.random() < .3) { const L = PICKS.map((q, i) => [q, i]).filter(([q, i]) => !PK[i] && WPN[q.k] && q.y < 5 && q.k !== bt.w); if (L.length) { const q = L[Math.random() * L.length | 0][0]; goal = [q.x, q.z]; } }
      if (!goal && teamMode() && Math.random() < .35) { const B2 = BOATS.filter(b => b.vis && !b.gun && b.team === teamOf(bt.id) && Math.hypot(b.rx - bt.x, b.rz - bt.z) < 70); if (B2.length) { const b = B2[0]; const [x, z] = boatL2W(b, 0, -1); goal = [x, z]; bt.wantGun = b.i; } }
      if (!goal && bt.lastSeen && Math.random() < .6) goal = bt.lastSeen;
      if (!goal) { const C = [[0, -30], [0, 10], [-40, -10], [40, -10], [-55, 40], [55, 40], [0, -70], [-30, -55], [30, -55], [-50, 70], [50, 70]]; goal = C[Math.random() * C.length | 0]; goal = [goal[0] + rnd(-6, 6), goal[1] + rnd(-6, 6)]; }
      bt.path = navPath(bt.x, bt.z, goal[0], goal[1]) || [goal]; bt.pathT = G.t + 6 + Math.random() * 4; bt.goal = goal; } }
  // take a friendly boat's deck gun when standing at it
  if (bt.wantGun != null) { const b = BOATS[bt.wantGun]; if (b && b.vis && !b.gun) { const [x, z] = boatL2W(b, 0, BT.GUN[1]); if (Math.hypot(x - bt.x, z - bt.z) < 2.6) { hostAct(bt.id, {a: 'seat', b: b.i, r: 'g'}); if (b.gun === bt.id) { bt.seat = {b: b.i, r: 'g'}; bt.bi = b.i; bt.gunT = 0; } bt.wantGun = null; return; } } else bt.wantGun = null; }
  // move: strafe and hold range in a fight, else follow the path
  let mx = 0, mz = 0, sp = 3.4; const T = bt.tgt;
  if (T) { const dx = T.x - bt.x, dz = T.z - bt.z, d = Math.hypot(dx, dz) || 1, want = bt.w === 'shotgun' ? 6 : W.zoom ? 30 : 14; bt.strT -= dt; if (bt.strT <= 0) { bt.strT = .8 + Math.random() * 1.4; bt.strafe = Math.random() < .5 ? -1 : 1; }
    mx = -dz / d * bt.strafe * .8 + dx / d * clamp((d - want) / 6, -1, 1); mz = dx / d * bt.strafe * .8 + dz / d * clamp((d - want) / 6, -1, 1); sp = 3.6;
    bt.cr = W.zoom && d > 25 ? 1 : 0; if (bt.cr) sp = 1.6; }
  else if (bt.path && bt.path.length) { const n = bt.path[0], dx = n[0] - bt.x, dz = n[1] - bt.z, d = Math.hypot(dx, dz); if (d < 1.2) bt.path.shift(); else { mx = dx / d; mz = dz / d; } sp = 4.4; bt.cr = 0; }
  const ml = Math.hypot(mx, mz); if (ml > 1e-3) { mx /= ml; mz /= ml; }
  // keep off the edges of the walkable grid
  const nk = navIdx(bt.x + mx * 1.5, bt.z + mz * 1.5); if (T && (nk < 0 || !NAV.ok[nk])) { mx = -mx; mz = -mz; bt.strafe *= -1; }
  bt.vx = mix(bt.vx, mx * sp, Math.min(1, dt * 8)); bt.vz = mix(bt.vz, mz * sp, Math.min(1, dt * 8)); bt.x += bt.vx * dt; bt.z += bt.vz * dt; pushStatic(bt, .34, 1.7); pushBoats(bt, .34, 1.7);
  const fy = floorAll(bt.x, bt.z, bt.y); bt.bi = FLR.b; if (bt.bi >= 0) { const b = BOATS[bt.bi], l = boatW2L(b, bt.x, bt.z); bt.bl = [l[0], fy - b.hy, l[1]]; } else bt.bl = null;
  if (fy < -1.3 && groundH(bt.x, bt.z) < -1.3) { bt.sw = 1; bt.y = -1.28; } else { bt.sw = 0; if (bt.y > fy + .05) { bt.vy -= 19 * dt; bt.y = Math.max(fy, bt.y + bt.vy * dt); } else { bt.y = fy; bt.vy = 0; } }
  if (bt.sw && !T) { const k = navNear(bt.x, bt.z); if (k >= 0) { const [x, z] = navPos(k); bt.path = [[x, z]]; } }
  // stuck: re-plan
  if ((bt.stuckT += dt) > 1.5) { if (Math.hypot(bt.x - bt.lastX, bt.z - bt.lastZ) < .6 && !T) { bt.path = null; bt.pathT = 0; } bt.stuckT = 0; bt.lastX = bt.x; bt.lastZ = bt.z; }
  // aim and shoot
  if (T) { bt.seeT += dt; const ty = T.y + (T.bi >= 0 ? 1.25 : 1.15) + (Math.random() < .15 * G.set.skill ? .4 : 0), dx = T.x - bt.x, dy = ty - eye[1], dz = T.z - bt.z, hd = Math.hypot(dx, dz);
    const yw = Math.atan2(-dx, -dz), pt = Math.atan2(dy, hd); bt.yaw += angD(bt.yaw, yw) * Math.min(1, dt * 7); bt.pitch = mix(bt.pitch, pt, Math.min(1, dt * 7)); bt.aimE = Math.max(SK.err, bt.aimE - dt * SK.err * 2);
    if (bt.seeT > SK.react && bt.fireT <= 0 && bt.relT <= 0 && Math.abs(angD(bt.yaw, yw)) < .2 && hd < (W.rng || 60) * 1.4) {
      if (bt.nades > 0 && hd > 9 && hd < 24 && Math.random() < .05) { bt.nades--; const tf = 1.1, v = [dx / tf, (dy + .5 * 18 * tf * tf) / tf, dz / tf]; hostAct(bt.id, {a: 'gr', o: [bt.x, bt.y + 1.6, bt.z], v}); bt.fireT = .9; }
      else if (bt.mag <= 0) { bt.relT = W.rel; } else if (Math.random() < SK.burst) botShoot(bt, W, eye, yw, pt);
      else bt.fireT = .25; } }
  else { bt.seeT = 0; if (ml > .01) { const yw = Math.atan2(-mx, -mz); bt.yaw += angD(bt.yaw, yw) * Math.min(1, dt * 5); bt.pitch *= .9; } if (bt.mag < W.mag * .5 && bt.relT <= 0) bt.relT = W.rel; }
  const av = avatar(bt.id); av.buf.push(NOW(), botPose(bt));
}
function botShoot(bt, W, eye, yw, pt) {
  bt.fireT = W.rate * (W.auto ? 1 : 1.5 + Math.random()); bt.mag--; const k = bt.w;
  if (W.proj === 'rk') { const f = fwd(yw, pt + .02); hostAct(bt.id, {a: 'rk', o: eye, d: f}); return; }
  const n = W.pel || 1; const hits = {}; let end = null;
  for (let i = 0; i < n; i++) { const e = bt.aimE * (1 + Math.hypot(bt.vx, bt.vz) / 8) + (W.spr || .01) * .6, d = fwd(yw + rnd(-e, e), pt + rnd(-e, e)), r = shootRay(eye, d, (W.rng || 60) * 2, false, bt.id), end0 = [eye[0] + d[0] * r.t, eye[1] + d[1] * r.t, eye[2] + d[2] * r.t]; if (!end) end = end0;
    const pid = r.p; if (pid) { const fo = r.t < W.rng * .5 ? 1 : mix(1, .55, clamp((r.t - W.rng * .5) / (W.rng * .5), 0, 1)); const q = hits[pid] || (hits[pid] = {d: 0, h: 0}); q.d += W.dmg * fo * (r.head ? W.hd : 1); q.h = q.h || r.head; } else if (r.b >= 0) boatDmg(BOATS[r.b], W.dmg * .12, bt.id); }
  for (const id in hits) damage(id, hits[id].d, bt.id, k, hits[id].h, avatarPos(id));
  hostAct(bt.id, {a: 'sh', w: WIX(k), o: [+(eye[0] + Math.sin(-yw) * .6).toFixed(1), +(eye[1] - .2).toFixed(1), +(eye[2] - Math.cos(yw) * .6).toFixed(1)], e: end.map(v => +v.toFixed(1))});
}

// ---------------- start / roster / network
function matchStart(set, roster) {
  G.set = set; G.roster = roster; G.on = true; G.over = false; G.t = 0; G.ts = [0, 0]; G.tl = (set.time || 0) * 60; G.evq = []; G.pl = {}; G.streak = G.multi = 0; G.multiT = -99;
  for (const id of [...AVS.keys()]) dropAvatar(id); buildBoats(set.mode); PK.length = PICKS.length; PK.fill(0); for (const p of [...PJ.values()]) pjDrop(p);
  P.id = myId(); P.alive = false; HS.clear(); BOTS.clear();
  if (isHost()) { for (const r of roster) { HS.set(r.id, {hp: 100, alive: false, k: 0, d: 0, s: 0, deadT: -99, lo: 0}); if (r.bot) BOTS.set(r.id, Object.assign(makeBot(+r.id.slice(1), r.team), {name: r.name})); } }
  for (const r of roster) if (r.id !== myId()) avatar(r.id);
  pkBuild(); startHud(); showDead(true);
}
function rosterAdd(id, name) { const tm = teamMode() ? (G.roster.filter(r => r.team === 0).length <= G.roster.filter(r => r.team === 1).length ? 0 : 1) : 0, used = new Set(G.roster.map(r => r.c)); let c = 0; while (used.has(c)) c++; G.roster.push({id, name, c, team: tm}); HS.set(id, {hp: 100, alive: false, k: 0, d: 0, s: 0, deadT: -99, lo: 0}); emit({k: 'ro', ro: G.roster}); }
Net.on('snap', m => { if (G.on && !isHost()) { G.lastSnap = NOW(); applySnap(m); } });
Net.on('pose', (m, from) => {
  if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId() || !Array.isArray(m.p) || m.p.length < 13 || !m.p.every(Number.isFinite)) return;
  const a = avatar(id); a.buf.push(m.ts, m.p); a.bi = m.p[7];
  if (Array.isArray(m.bs)) { const b = BOATS[m.bs[0]]; if (b && b.drv === id && m.bs.every(Number.isFinite)) { b.buf.push(m.ts, [m.bs[1], m.bs[2], m.bs[3], m.bs[4]]); b.yr = m.bs[5]; } }
  if (Array.isArray(m.g)) { const b = BOATS[m.g[0]]; if (b && b.gun === id) b.gp = clamp(+m.g[1] || 0, -.2, .6); }
});
Net.on('act', (m, from) => { if (isHost() && G.on) hostAct(from, m); });
function sendPose() { const m = {t: 'pose', ts: Math.round(NOW()), p: myPoseArr()}; if (isHost()) m.from = 'H'; if (P.seat && P.seat.r === 'd') { const b = BOATS[P.seat.b]; m.bs = [b.i, +b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(3), +b.v.toFixed(2), +(b.yr || 0).toFixed(3)]; } if (P.seat && P.seat.r === 'g') m.g = [P.seat.b, +P.pitch.toFixed(3)]; Net.send(m); }

// ---------------- pickups (meshes; the host says which are there)
const PKM = [];
function pkBuild() { for (const m of PKM) scene.remove(m); PKM.length = 0;
  PICKS.forEach((q, i) => { const g = new THREE.Group(); g.position.set(q.x, q.y + .55, q.z);
    if (WPN[q.k]) { const m = gunModel(q.k); m.scale.setScalar(1.6); g.add(m); } else if (q.k === 'hp') { g.add(new THREE.Mesh(new THREE.BoxGeometry(.5, .32, .38), MAT.hp)); const c1 = new THREE.Mesh(new THREE.BoxGeometry(.32, .08, .4), MAT.hpX); c1.position.y = .02; g.add(c1); const c2 = new THREE.Mesh(new THREE.BoxGeometry(.1, .08, .4), MAT.hpX); c2.scale.set(1, 1, 1); c2.rotation.y = PI / 2; c2.position.y = .02; g.add(c2); }
    else if (q.k === 'ammo') { g.add(new THREE.Mesh(new THREE.BoxGeometry(.6, .35, .35), MAT.ammo)); } else { for (const s of [-.12, .12]) { const n = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), MAT.ammo); n.position.x = s; g.add(n); } }
    const ring = new THREE.Mesh(new THREE.RingGeometry(.45, .62, 24), MAT.glow); ring.rotation.x = -PI / 2; ring.position.y = -.52; g.add(ring); g.userData.ring = ring; scene.add(g); PKM.push(g); }); }
function pkFrame(dt) {
  PICKS.forEach((q, i) => { const g = PKM[i]; if (!g) return; const on = !PK[i]; g.visible = on; if (!on) return; g.rotation.y += dt * 1.5; g.children[0].position.y = Math.sin(G.wt * 2 + i) * .08;
    if (P.alive && !P.seat && Math.hypot(P.x - q.x, P.z - q.z) < 1.3 && Math.abs(P.y - q.y) < 1.6 && !(P.pkT > G.t)) { if (q.k === 'hp' && P.hp >= 100) return; P.pkT = G.t + .5; act({a: 'pick', i}); } });
}
function gotPick(k) { Snd.pick(); if (WPN[k]) { P.prim = k; P.ammo[k] = [WPN[k].mag, WPN[k].res]; P.slot = 0; P.relT = 0; showMsg('Picked up: ' + WPN[k].n, 2); } else if (k === 'hp') showMsg('Health restored', 1.5); else if (k === 'ammo') { for (const w in P.ammo) P.ammo[w][1] = WPN[w].res; showMsg('Ammo refilled', 1.5); } else if (k === 'nade') { P.nades = Math.min(4, P.nades + 2); showMsg('+2 grenades', 1.5); } }
