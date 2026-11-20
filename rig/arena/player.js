'use strict';
// player: the local soldier (movement, swimming, ladders, climbing out), camera, guns (client-side hit detection, the host applies damage),
// gun models (view, avatar, pickups), remote avatars with interpolation buffers.
const P = {id: 'H', x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onG: false, cr: 0, sw: 0, uw: 0, air: 1, bi: -1, bl: [0, 0, 0], lastBY: 0, seat: null,
  alive: false, hp: 100, lo: 0, slot: 0, prim: 'smg', ammo: {}, nades: 2, fireT: 0, relT: 0, ads: 0, lad: null, mant: null, eye: 1.62, bob: 0, stepD: 0, fallV: 0, kick: 0, spr: 0, oobT: 0, airT: 0};
const PH = {walk: 4.6, run: 6.9, crouch: 2.5, swim: 2.5, swimD: 3.7, jump: 5.4, g: 19, R: .34, H: 1.78, HC: 1.25};
const wNow = () => P.slot === 0 ? P.prim : 'pistol';
function giveLoadout(i) { const L = LOADOUTS[i] || LOADOUTS[0]; P.lo = i; P.prim = L.p; P.ammo = {}; for (const k of [L.p, 'pistol']) P.ammo[k] = [WPN[k].mag, WPN[k].res]; P.nades = L.g; P.slot = 0; P.relT = 0; P.fireT = .3; }
function placePlayer(sp) { Object.assign(P, {x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, onG: true, sw: 0, uw: 0, air: 1, bi: -1, seat: null, alive: true, hp: 100, lad: null, mant: null, cr: 0, ads: 0, oobT: 0, fallV: 0}); giveLoadout(sp.lo ?? P.lo); }
const diver = () => !!(LOADOUTS[P.lo] || {}).diver;

// ---------------- movement
function floorAll(x, z, y) { const s = floorStatic(x, z, y, .18), b = boatFloor(x, z, y); if (b && b.y >= s) { FLR.b = b.bi; return b.y; } FLR.b = -1; return s; }
const FLR = {b: -1};
function playerStep(dt) {
  if (!P.alive) return;
  let B0 = P.bi >= 0 ? BOATS[P.bi] : null; if (B0 && !B0.vis) { P.bi = -1; P.seat = null; B0 = null; }
  if (B0) { const [wx, wz] = boatL2W(B0, P.bl[0], P.bl[2]); P.x = wx; P.z = wz; P.y = B0.hy + P.bl[1]; P.yaw += angD(P.lastBY, B0.ryaw); P.lastBY = B0.ryaw; }
  if (P.seat) { seatStep(dt); return; }
  if (P.mant) { const m = P.mant; m.t += dt / .38; const k = smooth(m.t); P.x = mix(m.x0, m.x1, k); P.z = mix(m.z0, m.z1, k); P.y = mix(m.y0, m.y1, Math.min(1, k * 1.6)); if (m.t >= 1) { P.mant = null; P.sw = 0; P.vy = 0; P.onG = true; } attachBoat(); return; }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mag = Math.hypot(fw, st) || 1;
  const crouchK = K.KeyC || K.ControlLeft; P.cr = mix(P.cr, crouchK && !P.sw ? 1 : 0, Math.min(1, dt * 10));
  const g0 = groundH(P.x, P.z), wade = !P.sw && P.y < -.15 && g0 > -1.35;
  const run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && !P.ads && P.cr < .5 && !P.sw;
  let sp = P.sw ? (diver() ? PH.swimD : PH.swim) : P.cr > .5 ? PH.crouch : run ? PH.run : PH.walk; if (wade) sp *= .6; if (P.ads && !P.sw) sp *= .62; if (wNow() === 'lmg' || wNow() === 'rocket') sp *= .9;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp;
  const ac = P.onG || P.sw ? 12 : 2.2; P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * ac)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * ac));
  const ox = P.x, oz = P.z, oy = P.y; P.x += P.vx * dt; P.z += P.vz * dt;
  const h = P.cr > .5 ? PH.HC : PH.H; pushStatic(P, PH.R, h); pushBoats(P, PH.R, h);
  // ladders: hold W (or Space) inside one to climb, S to go down
  const ld = ladderAt(P.x, P.z, P.y); if (!ld) P.lad = null; else if (!P.lad && K.KeyW && P.y < ld.y1 - .3) P.lad = ld; if (P.lad && K.Space && !K.KeyW && !P.sw && P.y > P.lad.y0 + .5) { P.lad = null; P.vy = 2; P.onG = false; }
  if (P.lad) { const l = P.lad; P.x = clamp(ox, Math.min(l.x0, l.x1) - .3, Math.max(l.x0, l.x1) + .3); P.z = clamp(oz, Math.min(l.z0, l.z1) - .3, Math.max(l.z0, l.z1) + .3); P.vx = P.vz = 0; }
  let f = floorAll(P.x, P.z, P.y);
  if (P.lad) { const l = P.lad; P.vy = K.KeyW ? 3.4 : K.KeyS ? -3 : 0; P.y = Math.min(P.y + P.vy * dt, l.y1); P.sw = 0; P.onG = false;
    if (P.y >= l.y1 - .05) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = P.x + dx * .9, z = P.z + dz * .9, fy = floorStatic(x, z, l.y1 + .6); if (Math.abs(fy - l.y1) < .7) { const o = {x, z, y: fy}; pushStatic(o, PH.R, 1.7); if (Math.hypot(o.x - x, o.z - z) < .05) { P.x = x; P.z = z; P.y = fy; P.lad = null; P.onG = true; break; } } }
    if (P.lad && P.y < f) { P.y = f; P.lad = null; P.onG = true; } }
  else if (P.sw) {
    // swimming: float with the head out; C dives, Space rises; climb out with Space at an edge
    const bot = groundH(P.x, P.z) + .25, wy = waterY(P.x, P.z) * .8; let vy = 0; if (crouchK) vy -= 2.6; if (K.Space) vy += 2.6; if (fw && P.uw && Math.abs(P.pitch) > .25) vy += Math.sin(P.pitch) * sp * fw;
    P.vy = mix(P.vy, vy || (P.y < wy - 1.32 ? 1.8 : 0), Math.min(1, dt * 4)); P.y = clamp(P.y + P.vy * dt, bot, wy - 1.28); if (!vy && P.y > wy - 1.4) P.y = mix(P.y, wy - 1.28, Math.min(1, dt * 6));
    if (f > -1.25 && f > P.y - .1 && f <= P.y + STEP) { P.sw = 0; P.y = f; } // walked up a beach
    if (K.Space && P.y > wy - 1.6) tryMantle();
  } else {
    if (P.onG && f < P.y - .3 && !(FLR.b >= 0)) P.onG = false;
    if (P.onG) { P.y = Math.max(f, mix(P.y, f, Math.min(1, dt * 18))); if (f > P.y + .01) P.y = f; P.vy = 0;
      if (K.Space && !(P.jT > G.t)) { P.vy = PH.jump; P.onG = false; P.jT = G.t + .35; P.y += .02; } }
    else { P.vy -= PH.g * dt; P.y += P.vy * dt; const c = ceilStatic(P.x, P.z, oy + h - .05); if (P.y + h > c && P.vy > 0) { P.y = c - h; P.vy = 0; }
      if (P.y <= f && P.vy <= 0) { const iv = -P.vy; P.y = f; P.vy = 0; P.onG = true; if (iv > 13) selfDmg((iv - 13) * 9, 'fall'); if (iv > 6) Snd.step(null, false); } }
    if (!P.onG && P.y < -1.2 && groundH(P.x, P.z) < -1.35 && !(FLR.b >= 0 && f > -1)) { P.sw = 1; P.vy *= .2; P.onG = false; splashAt(P.x, P.z, Math.abs(P.vy) > 4); if (P.slot === 0 && !WPN[P.prim].uw) P.slot = 1; }
  }
  attachBoat();
  // the head under water: air, view, sound
  const eyeY = P.y + P.eye; P.uw = eyeY < waterY(P.x, P.z) - .05 ? 1 : 0;
  if (P.uw) { P.air -= dt / (diver() ? 32 : 13); if (P.air <= 0) { P.air = 0; P.airT = (P.airT || 0) + dt; if (P.airT > .5) { P.airT = 0; selfDmg(9, 'drown'); } } } else P.air = Math.min(1, P.air + dt / 3);
  P.eye = mix(P.eye, P.sw ? 1.47 : P.cr > .5 ? 1.08 : 1.62, Math.min(1, dt * 10));
  // steps
  const mv = Math.hypot(P.x - ox, P.z - oz); P.bob += mv * (run ? .9 : 1.25); P.stepD += mv; if (P.stepD > (run ? 2.1 : 1.6) && (P.onG || P.sw)) { P.stepD = 0; Snd.step(null, P.sw || wade); }
  // out of bounds
  const r = Math.hypot(P.x, P.z + 10); if (r > ARENA.R) { P.oobT += dt; if (P.oobT > 1) { P.oobT = 0; selfDmg(15, 'oob'); } if (!(G.oobMsgT > G.t)) { G.oobMsgT = G.t + 3; showMsg('Turn back! You are leaving the arena.', 2); } } else P.oobT = 0;
  if (r > ARENA.R + 25) { P.x *= (ARENA.R + 25) / r; P.z = (P.z + 10) * (ARENA.R + 25) / r - 10; }
}
function attachBoat() {
  // standing on (or jumping just above) a deck: ride it in boat coordinates
  const fb = FLR.b; let bi = -1;
  if (!P.sw && fb >= 0 && P.y - floorAll(P.x, P.z, P.y) < 2.5) bi = fb;
  if (bi >= 0) { const b = BOATS[bi], l = boatW2L(b, P.x, P.z); P.bl = [l[0], P.y - b.hy, l[1]]; if (P.bi !== bi) P.lastBY = b.ryaw; } P.bi = bi;
}
function tryMantle() {
  if (P.mant || (P.mantT > G.t)) return; P.mantT = G.t + .5;
  const f = fwd(P.yaw, 0); for (const d of [.7, 1.1]) { const x = P.x + f[0] * d, z = P.z + f[2] * d, top = floorAll(x, z, 1.9); if (top > -.4 && top < 1.95) { const o = {x, z, y: top}; pushStatic(o, PH.R, 1.7); pushBoats(o, PH.R, 1.7); P.mant = {t: 0, x0: P.x, z0: P.z, y0: P.y, x1: o.x, z1: o.z, y1: top}; P.vx = P.vz = P.vy = 0; Snd.splash(null, false); return; } }
}
function splashAt(x, z, big) { fxSplash(x, 0, z, big ? 1.4 : .8); Snd.splash(null, big); }
function selfDmg(d, why) { act({a: 'self', d: Math.round(d), why}); }

// ---------------- camera
const _cv = new THREE.Vector3();
function camStep(dt) {
  if (!P.alive) { deathCam(dt); return; }
  let x = P.x, y = P.y + P.eye, z = P.z;
  if (P.seat) { const sp = seatEye(P.seat); x = sp[0]; y = sp[1]; z = sp[2]; }
  const bob = P.onG && !P.seat ? Math.sin(P.bob * 2.2) * .035 * clamp(Math.hypot(P.vx, P.vz) / 5, 0, 1) : P.sw ? Math.sin(G.wt * 1.4) * .06 : 0;
  cam.position.set(x, y + bob, z);
  if (P.sw && !P.uw) cam.position.y = Math.max(cam.position.y, waterY(x, z) + .14);
  P.kick = Math.max(0, P.kick - dt * 6);
  cam.rotation.set(P.pitch + P.kick * .08, P.yaw, 0);
  const zoom = P.ads && WPN[wNow()].zoom && !P.seat ? WPN[wNow()].zoom : P.ads ? 1.2 : 1; const tf = SET.fov / zoom; if (Math.abs(cam.fov - tf) > .05) { cam.fov = mix(cam.fov, tf, Math.min(1, dt * 14)); cam.updateProjectionMatrix(); }
  sun.position.set(cam.position.x + SUNDIR.x * 140, SUNDIR.y * 140, cam.position.z + SUNDIR.z * 140); sun.target.position.set(cam.position.x, 0, cam.position.z);
}
function deathCam(dt) { const k = G.killCam; if (!k) return; k.t += dt; const a = Math.min(1, k.t / 1.5); cam.position.set(k.x, k.y + 1.2 + a * 3.5, k.z); const tg = G.killer && avatarPos(G.killer); if (tg) { _cv.set(tg[0], tg[1] + 1.2, tg[2]); const yaw = Math.atan2(-(_cv.x - cam.position.x), -(_cv.z - cam.position.z)), d = Math.hypot(_cv.x - cam.position.x, _cv.z - cam.position.z), pt = Math.atan2(_cv.y - cam.position.y, d); cam.rotation.set(mix(cam.rotation.x, pt, Math.min(1, dt * 4)), cam.rotation.y + angD(cam.rotation.y, yaw) * Math.min(1, dt * 4), 0); } else cam.rotation.x = mix(cam.rotation.x, -.6, Math.min(1, dt * 2)); }

// ---------------- gun models
function gunModel(k, vm) {
  const g = new THREE.Group(), M = MAT.gun, W = MAT.gunW, D = MAT.dark;
  const bx = (m, sx, sy, sz, x, y, z, rx = 0) => { const q = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); q.position.set(x, y, z); q.rotation.x = rx; g.add(q); return q; };
  const cy = (m, r, l, x, y, z, r2) => { const q = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 ?? r, l, 10), m); q.rotation.x = PI / 2; q.position.set(x, y, z); g.add(q); return q; };
  let mz = -.2;
  if (k === 'pistol' || k === 'magnum') { const s = k === 'magnum' ? 1.25 : 1; bx(M, .035 * s, .04 * s, .19 * s, 0, 0, -.05 * s); bx(D, .032 * s, .11 * s, .05 * s, 0, -.065 * s, .03 * s, -.25); if (k === 'magnum') cy(D, .028, .06, 0, -.005, -.01); mz = -.15 * s; }
  else if (k === 'smg') { bx(M, .05, .07, .3, 0, 0, -.05); bx(D, .035, .14, .04, 0, -.09, -.06, .15); cy(M, .013, .14, 0, .01, -.26); bx(D, .03, .05, .18, 0, -.01, .2); bx(D, .03, .09, .04, 0, -.06, .06, -.2); mz = -.33; }
  else if (k === 'shotgun') { cy(M, .018, .62, 0, .015, -.32); cy(D, .014, .5, 0, -.022, -.27); bx(W, .05, .05, .16, 0, -.025, -.3); bx(M, .045, .07, .2, 0, 0, .0); bx(W, .042, .09, .3, 0, -.03, .24, .12); mz = -.63; }
  else if (k === 'rifle' || k === 'sniper') { const L = k === 'sniper' ? 1.25 : 1; bx(W, .05, .07, .5 * L, 0, 0, -.05); cy(M, .014, .42 * L, 0, .015, -.5 * L); cy(D, .026, .24, 0, .065, -.04, .022); bx(D, .03, .1, .05, 0, -.07, -.02); bx(W, .045, .1, .25, 0, -.03, .3, .1); if (k === 'sniper') { cy(D, .034, .06, 0, .065, -.18); cy(D, .03, .05, 0, .065, .1); } mz = -.72 * L; }
  else if (k === 'harpoon') { cy(M, .03, .55, 0, 0, -.18); bx(D, .035, .11, .05, 0, -.07, .04, -.2); const t = new THREE.Mesh(new THREE.ConeGeometry(.02, .12, 8), MAT.metal); t.rotation.x = -PI / 2; t.position.set(0, 0, -.5); g.add(t); g.userData.tip = t; bx(D, .03, .04, .2, 0, -.02, .2); mz = -.56; }
  else if (k === 'lmg') { bx(M, .07, .09, .45, 0, 0, -.05); cy(M, .02, .5, 0, .01, -.5); bx(D, .09, .1, .11, .05, -.06, -.06); bx(W, .05, .1, .25, 0, -.02, .28); bx(D, .015, .2, .015, .06, -.12, -.55); bx(D, .015, .2, .015, -.06, -.12, -.55); mz = -.76; }
  else if (k === 'rocket') { cy(MAT.ammo, .065, 1.05, 0, 0, -.2); cy(D, .075, .1, 0, 0, -.72); bx(D, .035, .12, .05, 0, -.1, -.1, -.2); bx(D, .035, .12, .05, 0, -.1, .15, -.2); bx(D, .04, .06, .12, -.07, .06, -.25); const w = new THREE.Mesh(new THREE.ConeGeometry(.055, .18, 10), MAT.rust); w.rotation.x = -PI / 2; w.position.set(0, 0, -.82); g.add(w); g.userData.tip = w; mz = -.82; }
  g.userData.mz = mz; if (vm) g.traverse(o => { if (o.isMesh) { o.renderOrder = 10; o.material = o.material.clone(); o.material.depthTest = true; } }); return g;
}

// ---------------- view model
const VM = new THREE.Group(); cam.add(VM); VM.position.set(.2, -.21, -.42);
const VMS = {}; let VMK = '';
const SKIN = new THREE.MeshStandardMaterial({color: 0xd8a882, roughness: .7}), SLEEVE = new THREE.MeshStandardMaterial({color: 0x3a4030, roughness: .9});
function vmBuild(k) {
  if (VMS[k]) return VMS[k]; const g = new THREE.Group(), gun = gunModel(k, true); g.add(gun);
  const hand = (x, y, z) => { const h = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .09), SKIN); h.position.set(x, y, z); g.add(h); const s = new THREE.Mesh(new THREE.BoxGeometry(.065, .065, .3), SLEEVE); s.position.set(x + (x > 0 ? .02 : -.03), y - .03, z + .19); g.add(s); };
  hand(0, -.055, .04); if (k !== 'pistol' && k !== 'magnum') hand(-.03, -.035, k === 'rocket' ? -.35 : -.22); else hand(-.025, -.07, .06);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffd080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); fl.position.set(0, .01, gun.userData.mz - .05); fl.scale.setScalar(.25); fl.visible = false; g.add(fl); g.userData.fl = fl; g.userData.gun = gun;
  g.visible = false; VM.add(g); return VMS[k] = g;
}
const MFL = new THREE.PointLight(0xffc070, 0, 12, 2); scene.add(MFL);
function vmFrame(dt) {
  const k = wNow(), show = P.alive && !P.seat && !(P.ads && WPN[k].zoom >= 4) && !P.mant;
  if (k !== VMK) { for (const q in VMS) VMS[q].visible = false; VMK = k; P.swapT = .35; }
  const g = vmBuild(k); g.visible = show; $('scope').classList.toggle('hidden', !(P.alive && P.ads && WPN[k].zoom >= 4 && !P.seat));
  P.adsK = mix(P.adsK || 0, P.ads ? 1 : 0, Math.min(1, dt * 14)); P.swapT = Math.max(0, (P.swapT || 0) - dt);
  const sp = Math.hypot(P.vx, P.vz), bb = P.onG ? clamp(sp / 5, 0, 1) : 0, rl = P.relT > 0 ? Math.sin(clamp(1 - P.relT / (WPN[k].rel || 1), 0, 1) * PI) : 0;
  VM.position.set(mix(.2, 0, P.adsK) + Math.sin(P.bob * 1.1) * .012 * bb, mix(-.21, -.115 - (k === 'rocket' ? .02 : 0), P.adsK) + Math.abs(Math.cos(P.bob * 1.1)) * .01 * bb - rl * .12 - P.swapT * .4 - (P.sw ? .05 : 0), mix(-.42, -.33, P.adsK) + P.kick * .06);
  VM.rotation.set(P.kick * .25 + rl * .5, 0, rl * .4);
  const fl = g.userData.fl; if (fl.visible && (P.flT -= dt) <= 0) fl.visible = false; MFL.intensity = Math.max(0, MFL.intensity - dt * 400);
  const tip = g.userData.gun.userData.tip; if (tip) tip.visible = (P.ammo[k] || [0])[0] > 0;
}

// ---------------- firing (client side): rays vs the world, boats and the players you see
const _d = [0, 0, 0];
function canFire(k) { if (P.seat || P.mant || P.lad || !P.alive) return false; if (P.uw && !WPN[k].uw) return false; if (P.sw && !P.uw && k !== 'pistol' && k !== 'magnum' && !WPN[k].uw) return false; return true; }
function weaponStep(dt) {
  if (!P.alive) return; const k = wNow(), W = WPN[k], a = P.ammo[k] || (P.ammo[k] = [W.mag, W.res]);
  P.fireT -= dt; if (P.relT > 0) { P.relT -= dt; if (P.relT <= 0) { const n = Math.min(W.mag - a[0], a[1]); a[0] += n; a[1] -= n; } }
  P.ads = mouseR && !P.seat && !P.sw && P.relT <= 0 ? 1 : 0;
  P.spr = mix(P.spr, (Math.hypot(P.vx, P.vz) > .5 ? 1.7 : 1) * (P.onG || P.sw ? 1 : 2.2) * (P.cr > .5 ? .7 : 1) * (P.ads ? .35 : 1), Math.min(1, dt * 8));
  if (P.seat) { seatFire(dt); return; }
  if (mouseL && P.fireT <= 0 && P.relT <= 0 && (P.swapT || 0) <= .05 && canFire(k)) { if (a[0] <= 0) { if (!P.clkT || P.clkT < G.t) { Snd.click(); P.clkT = G.t + .4; } if (a[1] > 0) reload(); } else { fireGun(k, W, a); if (!W.auto) mouseL = false; } }
  if (a[0] <= 0 && a[1] > 0 && P.relT <= 0 && !mouseL && P.fireT < -.2) reload();
}
function reload() { const k = wNow(), W = WPN[k], a = P.ammo[k]; if (!a || P.relT > 0 || a[0] >= W.mag || a[1] <= 0) return; P.relT = W.rel; Snd.reload(); }
function fireGun(k, W, a) {
  a[0]--; P.fireT = W.rate; P.kick = Math.min(1.5, P.kick + (W.kick || .03) * 8); P.pitch = clamp(P.pitch + (W.kick || .03) * (P.ads ? .5 : 1), -1.5, 1.5); P.yaw += (Math.random() - .5) * (W.kick || .03) * .3;
  const g = VMS[k]; if (g) { g.userData.fl.visible = true; P.flT = .05; } MFL.position.copy(cam.position); MFL.intensity = 30; Snd.gun(k);
  const o = [cam.position.x, cam.position.y, cam.position.z]; cam.getWorldDirection(_cv); const base = [_cv.x, _cv.y, _cv.z];
  if (W.proj === 'rk') { act({a: 'rk', o: o.map(v => +v.toFixed(2)), d: base.map(v => +v.toFixed(3))}); return; }
  const n = W.pel || 1, hits = {}, bh = {}; let endP = null;
  for (let i = 0; i < n; i++) { const s = (W.spr || .01) * P.spr * (n > 1 ? 1 : 1); const d = [base[0] + (Math.random() - .5) * 2 * s, base[1] + (Math.random() - .5) * 2 * s, base[2] + (Math.random() - .5) * 2 * s], l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const r = shootRay(o, d, (W.rng || 60) * 2.2, !!W.uw && P.uw), e = [o[0] + d[0] * r.t, o[1] + d[1] * r.t, o[2] + d[2] * r.t];
    if (r.p) { const fo = r.t < W.rng * .5 ? 1 : mix(1, .55, clamp((r.t - W.rng * .5) / (W.rng * .5), 0, 1)) * (r.t > W.rng ? .8 : 1), dm = W.dmg * fo * (r.head ? W.hd : 1); const q = hits[r.p] || (hits[r.p] = {d: 0, h: 0}); q.d += dm; q.h = q.h || r.head; fxBlood(e); }
    else if (r.b >= 0) { bh[r.b] = (bh[r.b] || 0) + W.dmg * .12; fxImpact(e, null, true); }
    else if (r.t < 1e3) { if (r.water) fxSplash(e[0], e[1], e[2], .35); else fxImpact(e, r.n); }
    if (!endP) endP = e; }
  for (const id in hits) { act({a: 'hit', id, d: Math.round(hits[id].d), hd: hits[id].h ? 1 : 0, w: k}); }
  for (const b in bh) act({a: 'bh', b: +b, d: Math.round(bh[b] * 10) / 10});
  const mo = muzzleWorld(); fxTracer(mo, endP, k === 'harpoon' ? 0x9aa0a8 : 0xffe0a0, k === 'harpoon');
  act({a: 'sh', w: WIX(k), o: mo.map(v => +v.toFixed(1)), e: endP.map(v => +v.toFixed(1))});
}
function muzzleWorld() { const g = VMS[wNow()]; if (!g || !g.visible) { cam.getWorldDirection(_cv); return [cam.position.x + _cv.x * .5, cam.position.y + _cv.y * .5 - .1, cam.position.z + _cv.z * .5]; } const v = new THREE.Vector3(0, 0, g.userData.gun.userData.mz); g.userData.gun.localToWorld(v); return [v.x, v.y, v.z]; }
// nearest hit along a ray: static world, boats, avatars (rendered positions). uw: the shooter is under water (the surface doesn't stop it)
function shootRay(o, d, max, uw, skip = P.id) {
  const out = {t: Infinity, p: null, b: -1, head: false, n: null, water: 0};
  const ts = rayStatic(o, d, max, !uw); if (ts < out.t) { out.t = ts; out.n = RAYN.slice(); out.water = RAYN.water; }
  const rb = rayBoats(o, d, Math.min(max, out.t)); if (rb && rb.t < out.t) { out.t = rb.t; out.b = rb.b; out.water = 0; }
  const rp = rayAvatars(o, d, Math.min(max, out.t), skip); if (rp) { out.t = rp.t; out.p = rp.id; out.head = rp.head; out.b = -1; }
  if (out.t === Infinity) out.t = max; return out;
}
function rayAvatars(o, d, max, skip) {
  let best = null; const L = [...AVS.values()]; if (skip !== P.id && P.alive) L.push({id: P.id, rp: [P.x, P.y, P.z], cr: P.cr > .5 ? 1 : 0, sw: P.sw, alive: true, vis: true});
  for (const a of L) { if (a.id === skip || !a.alive || !a.vis) continue; const p = a.rp; if (!p) continue;
    const crouch = a.cr > .5, hb = a.sw ? 0 : crouch ? 1.0 : 1.42, hy = a.sw ? p[1] + .28 : p[1] + (crouch ? 1.12 : 1.6);
    // head sphere
    const hx = p[0] - o[0], hyy = hy - o[1], hz = p[2] - o[2], tc = hx * d[0] + hyy * d[1] + hz * d[2]; if (tc > 0 && tc < max) { const dd = hx * hx + hyy * hyy + hz * hz - tc * tc; if (dd < .045) { const t = tc - Math.sqrt(.045 - dd); if (!best || t < best.t) best = {t, id: a.id, head: true}; } }
    if (hb) { const fx = o[0] - p[0], fz = o[2] - p[2], A2 = d[0] * d[0] + d[2] * d[2]; if (A2 > 1e-9) { const B2 = fx * d[0] + fz * d[2], C2 = fx * fx + fz * fz - .36 * .36, D = B2 * B2 - A2 * C2; if (D >= 0) { const t = (-B2 - Math.sqrt(D)) / A2; if (t > 0 && t < max) { const y = o[1] + d[1] * t; if (y > p[1] && y < p[1] + hb && (!best || t < best.t)) best = {t, id: a.id, head: false}; } } } } }
  return best;
}
function throwNade() { if (!P.alive || P.seat || P.nades <= 0 || P.uw || (P.nadeT > G.t)) return; P.nades--; P.nadeT = G.t + .8; cam.getWorldDirection(_cv); const v = [_cv.x * 17 + P.vx, _cv.y * 17 + 4 + P.vy * .5, _cv.z * 17 + P.vz]; act({a: 'gr', o: [cam.position.x + _cv.x * .5, cam.position.y - .1, cam.position.z + _cv.z * .5].map(q => +q.toFixed(2)), v: v.map(q => +q.toFixed(2))}); P.kick = .6; Snd.click(); }
function knife() { if (!P.alive || P.seat || (P.knT > G.t)) return; P.knT = G.t + .6; P.kick = .8; burst(1800, 2, .25, .08, 'bandpass'); cam.getWorldDirection(_cv); const r = rayAvatars([cam.position.x, cam.position.y, cam.position.z], [_cv.x, _cv.y, _cv.z], 2.3, P.id); if (r) { act({a: 'hit', id: r.id, d: 60, hd: 0, w: 'knife'}); fxBlood([cam.position.x + _cv.x * r.t, cam.position.y + _cv.y * r.t, cam.position.z + _cv.z * r.t]); } }
function swapSlot(s) { if (s === P.slot || !P.alive || P.seat) return; if (s === 0 && (P.uw && !WPN[P.prim].uw || P.sw && !P.uw && !WPN[P.prim].uw && P.prim !== 'magnum')) { showMsg('Not in the water.', 1); return; } P.slot = s; P.relT = 0; P.fireT = Math.max(P.fireT, .3); }

// ---------------- avatars (everyone but you): interpolation buffers keyed by the sender's clock
class Buf { constructor() { this.a = []; this.off = null; }
  push(ts, s) { const now = NOW(), o = now - ts; if (this.off == null || o < this.off || Math.abs(o - this.off) > 1500) this.off = o; else this.off += (o - this.off) * .02; if (this.a.length && ts <= this.a[this.a.length - 1][0]) return; this.a.push([ts, s]); if (this.a.length > 40) this.a.shift(); }
  at(delay) { const a = this.a; if (!a.length) return null; const t = NOW() - this.off - delay; let i = a.length - 1; while (i > 0 && a[i - 1][0] > t) i--; if (i === 0 || a[i][0] <= t) { const L = a[a.length - 1]; return {s: L[1], n: L[1], k: 0, ex: Math.min(.25, Math.max(0, (t - L[0]) / 1000))}; } const A0 = a[i - 1], B0 = a[i], k = clamp((t - A0[0]) / Math.max(1, B0[0] - A0[0]), 0, 1); return {s: A0[1], n: B0[1], k, ex: 0}; } }
const AVS = new Map(); // id -> {id, buf, g, parts, tag, alive, vis, rp: [x,y,z], ryaw, cr, sw, w}
function avColor(id) { const r = G.roster.find(q => q.id === id); if (!r) return 0x999999; return G.set && G.set.mode === 'boat' ? TEAM_C[r.team || 0] : FFA_C[(r.c || 0) % FFA_C.length]; }
function buildAvatar(id) {
  const g = new THREE.Group(), col = avColor(id), vest = new THREE.MeshStandardMaterial({color: col, roughness: .8}), cloth = new THREE.MeshStandardMaterial({color: 0x3d4230, roughness: .9}), skin = new THREE.MeshStandardMaterial({color: [0xd8a882, 0xb07850, 0x7a4a2e, 0xf1c9a5][h2(id.length, id.charCodeAt(0)) * 4 | 0], roughness: .7}), dk = MAT.dark;
  const part = (geo, m, x, y, z, par = g) => { const q = new THREE.Mesh(geo, m); q.position.set(x, y, z); q.castShadow = true; par.add(q); return q; };
  const hips = new THREE.Group(); hips.position.y = .92; g.add(hips);
  const legs = [-1, 1].map(s => { const l = new THREE.Group(); l.position.set(s * .11, 0, 0); hips.add(l); part(new THREE.BoxGeometry(.15, .5, .17), cloth, 0, -.25, 0, l); const kn = new THREE.Group(); kn.position.y = -.48; l.add(kn); part(new THREE.BoxGeometry(.13, .46, .15), cloth, 0, -.22, 0, kn); part(new THREE.BoxGeometry(.14, .1, .26), dk, 0, -.42, -.04, kn); l.userData.kn = kn; return l; });
  const torso = new THREE.Group(); hips.add(torso); part(new THREE.BoxGeometry(.4, .52, .24), cloth, 0, .27, 0, torso); part(new THREE.BoxGeometry(.43, .4, .28), vest, 0, .3, 0, torso);
  const head = new THREE.Group(); head.position.y = .62; torso.add(head); part(new THREE.BoxGeometry(.2, .22, .22), skin, 0, .1, 0, head); part(new THREE.SphereGeometry(.15, 10, 6, 0, TAU, 0, PI / 2), vest, 0, .15, 0, head).scale.set(1, .8, 1.05); part(new THREE.BoxGeometry(.16, .04, .02), dk, 0, .12, -.115, head);
  const arms = new THREE.Group(); arms.position.y = .46; torso.add(arms);
  for (const s of [-1, 1]) { const a = part(new THREE.BoxGeometry(.11, .11, .42), cloth, s * .17, -.05, -.18, arms); a.rotation.y = -s * .25; part(new THREE.BoxGeometry(.08, .08, .08), skin, s * .07, -.06, -.4, arms); }
  const gunH = new THREE.Group(); gunH.position.set(.05, -.05, -.38); arms.add(gunH);
  scene.add(g); const tag = document.createElement('div'); tag.className = 'tag'; $('tags').appendChild(tag);
  return {g, hips, legs, torso, head, arms, gunH, vest, tag, gk: ''};
}
function avatar(id) { let a = AVS.get(id); if (!a) { a = {id, buf: new Buf(), alive: true, vis: false, rp: null, ryaw: 0, cr: 0, sw: 0, w: 0, ph: 0}; Object.assign(a, buildAvatar(id)); AVS.set(id, a); } return a; }
function dropAvatar(id) { const a = AVS.get(id); if (!a) return; scene.remove(a.g); a.tag.remove(); AVS.delete(id); }
function avatarPos(id) { if (id === P.id) return [P.x, P.y, P.z]; const a = AVS.get(id); return a && a.rp; }
// a pose sample: [x, y, z, yaw, pitch, bits, weapon, boat, lx, ly, lz]
function avatarsFrame(dt) {
  for (const a of AVS.values()) {
    const r = a.buf.at(115); if (!r) { a.g.visible = a.vis = false; a.tag.style.display = 'none'; continue; }
    const s = r.s, n = r.n, k = r.k, bi = n[7];
    let x, y, z, yaw = s[3] + angD(s[3], n[3]) * k;
    if (bi >= 0 && BOATS[bi] && BOATS[bi].vis && s[7] === bi) { const B = BOATS[bi], lx = mix(s[8], n[8], k), lz = mix(s[10], n[10], k), w = boatL2W(B, lx, lz); x = w[0]; z = w[1]; y = B.hy + mix(s[9], n[9], k); yaw = B.ryaw + angD(0, (s[3] - (s[12] || 0)) + angD(s[3] - (s[12] || 0), n[3] - (n[12] || 0)) * k); }
    else { x = mix(s[0], n[0], k); y = mix(s[1], n[1], k); z = mix(s[2], n[2], k); }
    const pt = mix(s[4], n[4], k), bits = n[5]; a.rpt = pt;
    const mv = a.rp ? Math.hypot(x - a.rp[0], z - a.rp[2]) / Math.max(dt, 1e-3) : 0; a.spd = mix(a.spd || 0, mv, Math.min(1, dt * 6)); a.rp = [x, y, z]; a.ryaw = yaw;
    a.cr = bits & 1 ? 1 : 0; a.sw = bits & 2 ? 1 : 0; const seat = bits & 64, lad = bits & 32;
    const st = G.pl[a.id]; a.alive = st ? !!st[1] : true;
    a.vis = true; a.g.visible = true; a.g.position.set(x, y, z); a.g.rotation.set(0, yaw, 0);
    // pose: walk cycle, crouch, swim, dead
    a.ph += a.spd * dt * 2.4; const sw = Math.sin(a.ph) * clamp(a.spd / 4, 0, 1) * .7;
    if (!a.alive) { a.dT = (a.dT || 0) + dt; a.g.rotation.x = -Math.min(PI / 2, a.dT * 5) * .95; a.g.position.y = y + .1; if (a.dT > 4) { a.g.visible = false; a.vis = false; } }
    else { a.dT = 0; a.g.rotation.x = a.sw ? -1.2 : 0; if (a.sw) a.g.position.y = y + .55; }
    a.legs[0].rotation.x = sw; a.legs[1].rotation.x = -sw; a.legs[0].userData.kn.rotation.x = Math.max(0, -sw) * .9 + a.cr * 1.4; a.legs[1].userData.kn.rotation.x = Math.max(0, sw) * .9 + a.cr * 1.4;
    if (a.cr) { a.legs[0].rotation.x -= .9; a.legs[1].rotation.x -= .9; a.hips.position.y = .62; } else a.hips.position.y = seat ? .9 : .92;
    if (lad) { a.legs[0].rotation.x = Math.sin(G.wt * 6) * .5; a.legs[1].rotation.x = -a.legs[0].rotation.x; }
    a.arms.rotation.x = clamp(pt, -1.1, 1.1); a.head.rotation.x = clamp(pt, -.8, .8) * .6;
    const wk = WKEYS[n[6]] || 'pistol'; if (a.gk !== wk) { a.gk = wk; a.gunH.clear(); if (!seat) a.gunH.add(gunModel(wk)); }
    a.gunH.visible = !seat && !a.sw && a.alive;
    if (a.flT > 0) { a.flT -= dt; }
    // the name tag
    _cv.set(x, y + (a.cr ? 1.6 : 2.15), z).project(cam); const d = Math.hypot(x - cam.position.x, z - cam.position.z), enemy = isEnemy(a.id);
    const onS = _cv.z < 1 && Math.abs(_cv.x) < 1.1 && Math.abs(_cv.y) < 1.1 && a.alive && (!enemy ? d < 200 : d < 35 && losStatic([cam.position.x, cam.position.y, cam.position.z], [x, y + 1.5, z]));
    if (onS) { a.tag.style.display = 'block'; a.tag.style.left = ((_cv.x + 1) / 2 * innerWidth).toFixed(0) + 'px'; a.tag.style.top = ((1 - _cv.y) / 2 * innerHeight).toFixed(0) + 'px'; const nm = nameOf(a.id), hp = st ? st[0] : 100, sig = nm + '|' + Math.round(hp / 5) + enemy; if (a.tag._s !== sig) { a.tag._s = sig; a.tag.style.color = enemy ? '#ff9a8a' : '#bfe6ff'; a.tag.innerHTML = esc(nm) + (enemy ? '' : `<i style="width:${hp * .5}px"></i>`); } } else a.tag.style.display = 'none';
  }
}
function nameOf(id) { const r = G.roster.find(q => q.id === id); return r ? r.name : id === P.id ? 'You' : '?'; }
function teamOf(id) { const r = G.roster.find(q => q.id === id); return r ? r.team || 0 : 0; }
function isEnemy(id) { if (id === P.id) return false; return !(G.set && G.set.mode === 'boat') || teamOf(id) !== teamOf(P.id); }
function myPoseArr() { const sb = P.seat ? 64 : 0; return [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2), +P.yaw.toFixed(3), +P.pitch.toFixed(3), (P.cr > .5 ? 1 : 0) | (P.sw ? 2 : 0) | (P.uw ? 4 : 0) | (P.ads ? 16 : 0) | (P.lad ? 32 : 0) | sb, WIX(wNow()), P.bi, +P.bl[0].toFixed(2), +P.bl[1].toFixed(2), +P.bl[2].toFixed(2), 0, P.bi >= 0 ? +BOATS[P.bi].ryaw.toFixed(3) : 0]; }
