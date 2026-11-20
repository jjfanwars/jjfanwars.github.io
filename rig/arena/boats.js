'use strict';
// boats: four gunboats (two per dock). Whoever drives one simulates it (no input lag) and sends its state in the pose; the host simulates empty ones.
// Local frame: bow at -z, deck y .95. A helm (E to drive, F torpedo), a bow deck gun (E to man it), a gap in the stern rail to climb aboard from the water.
const BT = {HP: 450, VMAX: 17, VREV: 5, ACC: 6.5, TURN: .95, DECK: .95, HELM: [0, 1.05], GUN: [0, -2.05], TP: 8, SHELL: .5};
const BBOX = [
  {x0: -1.65, x1: 1.65, y0: -.9, y1: .95, z0: -2.6, z1: 4.9, fl: 1},
  {x0: -1.15, x1: 1.15, y0: -.9, y1: 1.05, z0: -4.4, z1: -2.6, fl: 1},
  {x0: -.55, x1: .55, y0: -.9, y1: 1.1, z0: -5.3, z1: -4.4, fl: 1},
  {x0: -1.78, x1: -1.55, y0: .95, y1: 1.62, z0: -2.6, z1: 4.6}, {x0: 1.55, x1: 1.78, y0: .95, y1: 1.62, z0: -2.6, z1: 4.6},
  {x0: -1.28, x1: -1.05, y0: 1.05, y1: 1.65, z0: -4.4, z1: -2.6}, {x0: 1.05, x1: 1.28, y0: 1.05, y1: 1.65, z0: -4.4, z1: -2.6},
  {x0: -.7, x1: -.45, y0: 1.1, y1: 1.65, z0: -5.3, z1: -4.4}, {x0: .45, x1: .7, y0: 1.1, y1: 1.65, z0: -5.3, z1: -4.4},
  {x0: -1.78, x1: -.6, y0: .95, y1: 1.62, z0: 4.6, z1: 4.9}, {x0: .6, x1: 1.78, y0: .95, y1: 1.62, z0: 4.6, z1: 4.9},
  {x0: -.6, x1: .6, y0: .95, y1: 2.05, z0: -.25, z1: .5}, // console
  {x0: -.38, x1: .38, y0: 1.05, y1: 1.75, z0: -3.4, z1: -2.75}, // gun pedestal
  {x0: -1.0, x1: 1.0, y0: .95, y1: 1.4, z0: 2.4, z1: 2.9, fl: 1}, // bench (step on it)
];
const BOATS = [];
function boatL2W(b, lx, lz) { const c = Math.cos(b.ryaw), s = Math.sin(b.ryaw); return [b.rx + lx * c + lz * s, b.rz - lx * s + lz * c]; }
function boatW2L(b, x, z) { const c = Math.cos(b.ryaw), s = Math.sin(b.ryaw), dx = x - b.rx, dz = z - b.rz; return [dx * c - dz * s, dx * s + dz * c]; }
const hullHW = z => z < -2.6 ? 1.72 * Math.sqrt(clamp((z + 5.35) / 2.75, 0, 1)) : z > 4.2 ? 1.72 - (z - 4.2) * .2 : 1.72;
function hullGeo() {
  // lofted hull: stations bow to stern, each a keel/chine/gunwale section; plus the transom
  const zs = []; for (let i = 0; i <= 20; i++) zs.push(mix(-5.35, 4.95, i / 20));
  const sec = z => { const w = hullHW(z), sh = .95 + .22 * clamp((-z - 1) / 4.3, 0, 1) ** 2, kd = -.85 + .3 * clamp((-z - 2) / 3.3, 0, 1) ** 2; return [[0, kd], [w * .82, -.5], [w, sh]]; };
  const P = [], N = []; const tri = (a, b, c) => P.push(...a, ...b, ...c);
  for (let i = 0; i < zs.length - 1; i++) { const A = sec(zs[i]), B = sec(zs[i + 1]); for (const s of [-1, 1]) for (let k = 0; k < 2; k++) { const a = [s * A[k][0], A[k][1], zs[i]], b = [s * A[k + 1][0], A[k + 1][1], zs[i]], c = [s * B[k][0], B[k][1], zs[i + 1]], d = [s * B[k + 1][0], B[k + 1][1], zs[i + 1]]; if (s > 0) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); } } }
  const T = sec(4.95); for (const s of [-1, 1]) { const a = [0, T[0][1], 4.95], b = [s * T[1][0], T[1][1], 4.95], c = [s * T[2][0], T[2][1], 4.95], d = [0, T[2][1], 4.95]; if (s > 0) { tri(a, b, c); tri(a, c, d); } else { tri(a, c, b); tri(a, d, c); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
  const uv = new Float32Array(P.length / 3 * 2); for (let i = 0; i < P.length / 3; i++) { uv[i * 2] = P[i * 3 + 2] / 2; uv[i * 2 + 1] = P[i * 3 + 1] / 2; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
function deckGeo() { const zs = []; for (let i = 0; i <= 16; i++) zs.push(mix(-5.2, 4.9, i / 16)); const P = []; for (let i = 0; i < zs.length - 1; i++) { const a = zs[i], b = zs[i + 1], wa = hullHW(a) - .06, wb = hullHW(b) - .06, ya = .95 + (a < -2.6 ? .1 : 0) + (a < -4.4 ? .05 : 0), yb = .95 + (b < -2.6 ? .1 : 0) + (b < -4.4 ? .05 : 0); P.push(-wa, ya, a, -wb, yb, b, wa, ya, a, wa, ya, a, -wb, yb, b, wb, yb, b); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); const uv = new Float32Array(P.length / 3 * 2); for (let i = 0; i < P.length / 3; i++) { uv[i * 2] = P[i * 3] / 2.5; uv[i * 2 + 1] = P[i * 3 + 2] / 2.5; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; }
function boatMesh(team) {
  const g = new THREE.Group(), col = team == null ? 0x6a737a : TEAM_C[team], hm = MAT.hull.clone(); hm.color.set(team == null ? 0x6a737a : new THREE.Color(col).lerp(new THREE.Color(0x404448), .35));
  const add = (geo, m, x = 0, y = 0, z = 0, par = g) => { const q = new THREE.Mesh(geo, m); q.position.set(x, y, z); q.castShadow = q.receiveShadow = true; par.add(q); return q; };
  add(hullGeo(), hm); add(deckGeo(), MAT.wood);
  const stripe = new THREE.MeshStandardMaterial({color: team == null ? 0xd8d0b8 : col, roughness: .6});
  for (const b of BBOX.slice(3, 11)) { const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0; add(new THREE.BoxGeometry(sx, .06, sz), stripe, (b.x0 + b.x1) / 2, b.y1, (b.z0 + b.z1) / 2); for (let z = b.z0 + .2; z < b.z1; z += .9) add(new THREE.CylinderGeometry(.025, .025, sy, 5), MAT.metal, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z); }
  // console, windshield, wheel, throttle
  add(new THREE.BoxGeometry(1.2, 1.1, .75), hm, 0, 1.5, .12); add(new THREE.BoxGeometry(1.1, .06, .55), MAT.dark, 0, 2.06, .15);
  const ws = add(new THREE.BoxGeometry(1.3, .45, .04), MAT.glass, 0, 2.3, -.18); ws.rotation.x = -.35;
  const wh = add(new THREE.TorusGeometry(.17, .025, 6, 16), MAT.dark, 0, 1.85, .55); wh.rotation.x = -.6; add(new THREE.BoxGeometry(.05, .2, .05), MAT.dark, .4, 2.1, .4);
  add(new THREE.BoxGeometry(2, .45, .5), MAT.woodD, 0, 1.17, 2.65);
  // deck gun: pedestal, turret (yaw), cradle (pitch), barrel, shield
  add(new THREE.CylinderGeometry(.28, .36, .7, 12), MAT.metal, 0, 1.4, -3.07);
  const tur = new THREE.Group(); tur.position.set(0, 1.78, -3.07); g.add(tur); add(new THREE.CylinderGeometry(.32, .32, .16, 12), MAT.dark, 0, 0, 0, tur);
  const cr = new THREE.Group(); cr.position.y = .22; tur.add(cr); add(new THREE.BoxGeometry(.3, .28, .7), MAT.gun, 0, 0, -.05, cr); const bar = add(new THREE.CylinderGeometry(.06, .075, 1.7, 10), MAT.gun, 0, .02, -1.1, cr); bar.rotation.x = PI / 2;
  const sh = add(new THREE.BoxGeometry(1.0, .36, .05), hm, 0, -.04, -.38, cr); sh.rotation.x = -.15; for (const sx of [-.36, .36]) add(new THREE.BoxGeometry(.28, .22, .05), hm, sx, .24, -.4, cr);
  add(new THREE.BoxGeometry(.06, .3, .3), MAT.dark, .2, -.15, .35, cr); add(new THREE.BoxGeometry(.06, .3, .3), MAT.dark, -.2, -.15, .35, cr);
  // torpedo tubes on cradles
  for (const s of [-1, 1]) { const t = add(new THREE.CylinderGeometry(.2, .2, 2.4, 12), MAT.dark, s * 1.15, 1.3, 1.9); t.rotation.x = PI / 2; add(new THREE.BoxGeometry(.35, .35, .2), MAT.metal, s * 1.15, 1.08, 1.2); add(new THREE.BoxGeometry(.35, .35, .2), MAT.metal, s * 1.15, 1.08, 2.7); }
  // outboard engines and a little flag mast
  for (const s of [-.55, .55]) { add(new THREE.BoxGeometry(.4, .55, .5), MAT.dark, s, 1.1, 5.2); add(new THREE.BoxGeometry(.14, .9, .14), MAT.dark, s, .4, 5.3); }
  add(new THREE.CylinderGeometry(.03, .03, 1.6, 5), MAT.metal, 0, 2.9, .3);
  const fl = new THREE.PlaneGeometry(.7, .42); fl.translate(.35, 0, 0); add(fl, team == null ? MAT.flagN : MAT.flag[team], 0, 3.45, .3).rotation.y = PI / 2;
  // a white hull number
  return {g, tur, cr, hm};
}
function buildBoats(mode) {
  for (const b of BOATS) { scene.remove(b.m.g); if (b.snd) try { b.snd.o.stop(); } catch (e) {} } BOATS.length = 0;
  for (const d of DOCKS) for (const [x, z, yaw] of d.moor) { const team = mode === 'boat' ? d.team : null, m = boatMesh(team); scene.add(m.g);
    BOATS.push({i: BOATS.length, team, home: [x, z, yaw], x, z, yaw, v: 0, yr: 0, rx: x, rz: z, ryaw: yaw, hy: 0, hp: BT.HP, drv: '', gun: '', sunk: 0, vis: true, m, buf: new Buf(), tp: [0, 0], gT: 0, snd: null, smk: 0, pitch: 0, roll: 0}); }
}
function resetBoat(b) { Object.assign(b, {x: b.home[0], z: b.home[1], yaw: b.home[2], v: 0, yr: 0, hp: BT.HP, drv: '', gun: '', sunk: 0, vis: true, tp: [0, 0]}); b.rx = b.x; b.rz = b.z; b.ryaw = b.yaw; b.buf = new Buf(); }
// the driver's (or host's) sim: throttle/steer, land and boat collisions, the map edge
const BC = [-3.4, 0, 3.4];
function simBoat(b, inp, dt) {
  const thr = inp[0], str = inp[1], tv = thr > 0 ? thr * BT.VMAX : thr * BT.VREV;
  b.v += clamp(tv - b.v, -BT.ACC * dt * (thr ? 1.2 : .45), BT.ACC * dt * (thr ? 1 : .45));
  const turn = -str * BT.TURN * clamp(Math.abs(b.v) / 6, .3, 1) * (b.v < -.3 ? -1 : 1); b.yr = mix(b.yr, turn, Math.min(1, dt * 3)); b.yaw += b.yr * dt;
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw); b.x += fx * b.v * dt; b.z += fz * b.v * dt;
  let hit = 0; const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  for (const [lx, lz] of [[0, -5.2], [-1.5, -2.6], [1.5, -2.6], [-1.6, 2], [1.6, 2], [-1.4, 4.8], [1.4, 4.8]]) { const wx = b.x + lx * c + lz * s, wz = b.z - lx * s + lz * c, h = groundH(wx, wz);
    if (h > -.75) { const gx = groundH(wx + 1, wz) - groundH(wx - 1, wz), gz = groundH(wx, wz + 1) - groundH(wx, wz - 1), gl = Math.hypot(gx, gz) || 1, push = (h + .75) * dt * 18 + .02; b.x -= gx / gl * push; b.z -= gz / gl * push; hit = Math.max(hit, Math.abs(b.v)); } }
  // piers, posts
  for (const lz of BC) { const wx = b.x + lz * s, wz = b.z + lz * c, o = {x: wx, z: wz, y: -.5}; const L = near(wx, wz);
    for (const q of L) { if (q.r != null) { if (q.y1 < -.5 || q.y0 > 1) continue; const dx = o.x - q.x, dz = o.z - q.z, d = Math.hypot(dx, dz), m = q.r + 1.7; if (d < m && d > 1e-4) { b.x += dx / d * (m - d); b.z += dz / d * (m - d); hit = Math.max(hit, Math.abs(b.v) * .5); } continue; }
      if (q.y1 < -.5 || q.y0 > 1.2) continue; const cx = clamp(o.x, q.x0, q.x1), cz = clamp(o.z, q.z0, q.z1), dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz); if (d < 1.7) { const k = d > 1e-4 ? (1.7 - d) / d : 1; b.x += (d > 1e-4 ? dx : 0) * k; b.z += (d > 1e-4 ? dz : 1) * k; hit = Math.max(hit, Math.abs(b.v)); } } }
  // other boats (one-sided: each sim pushes itself)
  for (const o of BOATS) { if (o === b || !o.vis) continue; if (Math.hypot(o.rx - b.x, o.rz - b.z) > 13) continue; const oc = Math.cos(o.ryaw), os = Math.sin(o.ryaw);
    for (const la of BC) for (const lb of BC) { const ax = b.x + la * s, az = b.z + la * c, bx = o.rx + lb * os, bz = o.rz + lb * oc, dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz); if (d < 3.4 && d > 1e-4) { const k = (3.4 - d) * .5; b.x += dx / d * k; b.z += dz / d * k; hit = Math.max(hit, Math.abs(b.v - o.v) * .7); } } }
  if (hit > 2) { b.v *= Math.max(0, 1 - dt * 6); if (hit > 7 && !(b.crT > G.t)) { b.crT = G.t + 1; act({a: 'crash', b: b.i, s: +hit.toFixed(1)}); } }
  const r = Math.hypot(b.x, b.z + 10); if (r > ARENA.R + 10) { b.x *= (ARENA.R + 10) / r; b.z = (b.z + 10) * (ARENA.R + 10) / r - 10; b.v *= .5; }
}
// every frame: interpolate others' boats, bob, sinking, smoke, engine sound
function boatsFrame(dt) {
  const me = myId();
  for (const b of BOATS) {
    if (b.sunk) { b.st = (b.st || 0) + dt; const k = Math.min(1, b.st / 6); b.m.g.position.y = b.hy - k * 4; b.m.g.rotation.x = k * .5; b.vis = b.st < 1.2; b.m.g.visible = b.st < 7; if (b.snd) b.snd.g.gain.value = 0; continue; } b.st = 0; b.m.g.visible = true;
    const own = b.drv === me || (isHost() && !b.drv);
    if (own) { if (b.drv === me) simBoat(b, P.seat && P.seat.r === 'd' ? P.bin || [0, 0] : [0, 0], dt); else if (isHost()) simBoat(b, [0, 0], dt); b.rx = b.x; b.rz = b.z; b.ryaw = b.yaw; b.rv = b.v; }
    else { const r = b.buf.at(115); if (r) { const s = r.s, n = r.n, k = r.k; const ex = r.ex; b.rx = mix(s[0], n[0], k); b.rz = mix(s[1], n[1], k); b.ryaw = s[2] + angD(s[2], n[2]) * k; b.rv = mix(s[3], n[3], k);
        if (ex) { b.rx = n[0] - Math.sin(n[2]) * n[3] * ex; b.rz = n[1] - Math.cos(n[2]) * n[3] * ex; } b.x = b.rx; b.z = b.rz; b.yaw = b.ryaw; b.v = b.rv; } }
    b.hy = waterY(b.rx, b.rz) * .55;
    const tp = clamp((b.rv || 0) / BT.VMAX, -.3, 1); b.pitch = mix(b.pitch, -tp * .06 + Math.sin(G.wt * 1.3 + b.i) * .012, Math.min(1, dt * 3)); b.roll = mix(b.roll, (b.yr || 0) * .12 + Math.sin(G.wt * 1.1 + b.i * 2) * .015, Math.min(1, dt * 3));
    b.m.g.position.set(b.rx, b.hy + Math.max(0, tp) * .12, b.rz); b.m.g.rotation.set(b.pitch, b.ryaw, b.roll, 'YXZ');
    // the deck gun follows its gunner's aim
    let gy = 0, gp = 0; if (b.gun) { const yw = b.gun === me ? P.yaw : (AVS.get(b.gun) || {}).ryaw, pt = b.gun === me ? P.pitch : 0; if (yw != null) { gy = clamp(angD(b.ryaw, yw), -2.7, 2.7); gp = b.gun === me ? clamp(pt, -.2, .6) : BOTS.has(b.gun) ? clamp(BOTS.get(b.gun).pitch, -.2, .6) : (b.gp ?? (AVS.get(b.gun) || {}).rpt ?? 0); } }
    b.m.tur.rotation.y = mix(b.m.tur.rotation.y, gy, Math.min(1, dt * 10)); b.m.cr.rotation.x = mix(b.m.cr.rotation.x, gp, Math.min(1, dt * 10));
    // wake, smoke, engine
    if (Math.abs(b.rv || 0) > 3 && Math.random() < dt * 12) { const [wx, wz] = boatL2W(b, (Math.random() - .5) * 2.6, 5.2); fxSplash(wx, .1, wz, .5 + Math.abs(b.rv) / 30, true); }
    if (b.hp < BT.HP * .45 && Math.random() < dt * (b.hp < BT.HP * .2 ? 14 : 6)) { const [wx, wz] = boatL2W(b, 0, .2); fxSmoke(wx, b.hy + 2.2, wz, b.hp < BT.HP * .2); }
    if (A.on) { if (!b.snd) b.snd = engineVoice(); const S = b.snd; if (S) { const p = S.p; if (p.positionX) { p.positionX.value = b.rx; p.positionY.value = 1; p.positionZ.value = b.rz; } const occ = b.drv ? 1 : 0, sp = Math.abs(b.rv || 0) / BT.VMAX; S.g.gain.value = mix(S.g.gain.value, occ * (.05 + sp * .14), Math.min(1, dt * 4)); S.o.frequency.value = 42 + sp * 70; S.f.frequency.value = 250 + sp * 700; } }
  }
}
// standing on a deck: highest boat floor under (x, z) at or below y + STEP
function boatFloor(x, z, y) {
  let best = null;
  for (const b of BOATS) { if (!b.vis) continue; const dx = x - b.rx, dz = z - b.rz; if (dx * dx + dz * dz > 49) continue; const [lx, lz] = boatW2L(b, x, z);
    for (const q of BBOX) { if (!q.fl || lx < q.x0 || lx > q.x1 || lz < q.z0 || lz > q.z1) continue; const top = b.hy + q.y1; if (top <= y + STEP && (!best || top > best.y)) best = {y: top, bi: b.i}; } }
  return best;
}
function pushBoats(o, r, h) {
  for (const b of BOATS) { if (!b.vis) continue; const dx = o.x - b.rx, dz = o.z - b.rz; if (dx * dx + dz * dz > 64) continue; const c = Math.cos(b.ryaw), s = Math.sin(b.ryaw); let lx = dx * c - dz * s, lz = dx * s + dz * c; const ly = o.y - b.hy; let moved = false;
    for (const q of BBOX) { if (q.y1 <= ly + STEP || q.y0 >= ly + h) continue; if (lx < q.x0 - r || lx > q.x1 + r || lz < q.z0 - r || lz > q.z1 + r) continue;
      const cx = clamp(lx, q.x0, q.x1), cz = clamp(lz, q.z0, q.z1), ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez);
      if (d > 1e-6) { if (d < r) { lx = cx + ex / d * r; lz = cz + ez / d * r; moved = true; } } else { const l = lx - q.x0, rr = q.x1 - lx, t = lz - q.z0, bb = q.z1 - lz, m = Math.min(l, rr, t, bb); if (m === l) lx = q.x0 - r; else if (m === rr) lx = q.x1 + r; else if (m === t) lz = q.z0 - r; else lz = q.z1 + r; moved = true; } }
    if (moved) { o.x = b.rx + lx * c + lz * s; o.z = b.rz - lx * s + lz * c; } }
}
function rayBoats(o, d, max) {
  let best = null;
  for (const b of BOATS) { if (!b.vis) continue; const dx = o[0] - b.rx, dz = o[2] - b.rz; const c = Math.cos(b.ryaw), s = Math.sin(b.ryaw), lo = [dx * c - dz * s, o[1] - b.hy, dx * s + dz * c], ld = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
    for (const q of BBOX) { let t0 = 0, t1 = best ? best.t : max, ok = true; for (let a = 0; a < 3; a++) { const lo2 = a === 0 ? q.x0 : a === 1 ? q.y0 : q.z0, hi = a === 0 ? q.x1 : a === 1 ? q.y1 : q.z1; if (Math.abs(ld[a]) < 1e-9) { if (lo[a] < lo2 || lo[a] > hi) { ok = false; break; } continue; } let ta = (lo2 - lo[a]) / ld[a], tb = (hi - lo[a]) / ld[a]; if (ta > tb) { const z = ta; ta = tb; tb = z; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; } }
      if (ok && t0 > 0 && (!best || t0 < best.t)) best = {t: t0, b: b.i}; } }
  return best;
}
function inBoatHull(b, x, y, z, m = 0) { const [lx, lz] = boatW2L(b, x, z), ly = y - b.hy; return Math.abs(lx) < hullHW(lz) + m && lz > -5.4 - m && lz < 5 + m && ly > -1 - m && ly < 1.7 + m; }

// ---------------- seats: helm (drive, F torpedo) and the deck gun
const SEAT_POS = {d: [0, 1.05, -.4], g: [0, -2.05, -.3]}; // local x, z, and the eye offset forward
function seatEye(s) { const b = BOATS[s.b]; if (s.r === 'd') { const [x, z] = boatL2W(b, 0, 1.05); return [x, b.hy + BT.DECK + 1.62, z]; } const [x, z] = boatL2W(b, 0, -1.75); return [x, b.hy + BT.DECK + 1.7, z]; }
function seatStep(dt) {
  const s = P.seat, b = BOATS[s.b]; if (!b || !b.vis || (s.r === 'd' ? b.drv : b.gun) !== P.id) { P.seat = null; return; }
  const lz = s.r === 'd' ? BT.HELM[1] : BT.GUN[1]; P.bi = b.i; P.bl = [0, BT.DECK, lz]; const [x, z] = boatL2W(b, 0, lz); P.x = x; P.z = z; P.y = b.hy + BT.DECK; P.vx = P.vz = P.vy = 0; P.onG = true; P.sw = 0;
  if (s.r === 'd') { P.bin = [(K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0)]; const d = angD(b.ryaw, P.yaw); P.yaw = b.ryaw + clamp(d, -1.6, 1.6); }
  else { const d = angD(b.ryaw, P.yaw); P.yaw = b.ryaw + clamp(d, -2.7, 2.7); P.pitch = clamp(P.pitch, -.2, .6); }
}
function seatFire(dt) {
  const s = P.seat, b = BOATS[s.b]; if (!b) return;
  if (s.r === 'g' && mouseL && P.fireT <= 0) { P.fireT = BT.SHELL; P.kick = 1.2; Snd.gun('deck'); cam.getWorldDirection(_cv); const tur = b.m.cr, v = new THREE.Vector3(0, .02, -2); tur.localToWorld(v);
    act({a: 'dg', b: b.i, o: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], d: [+_cv.x.toFixed(3), +_cv.y.toFixed(3), +_cv.z.toFixed(3)], bv: [+(-Math.sin(b.ryaw) * (b.rv || 0)).toFixed(2), +(-Math.cos(b.ryaw) * (b.rv || 0)).toFixed(2)]}); fxFlash(v.x, v.y, v.z, 1.6); }
}
function nearSeat() {
  if (P.bi < 0 || P.seat || !P.alive) return null; const b = BOATS[P.bi]; if (!b || !b.vis) return null; const l = P.bl;
  if (Math.hypot(l[0] - BT.HELM[0], l[2] - BT.HELM[1]) < 1.2 && !b.drv) return {b: b.i, r: 'd', t: 'E  drive the gunboat'};
  if (Math.hypot(l[0] - BT.GUN[0], l[2] - BT.GUN[1]) < 1.3 && !b.gun) return {b: b.i, r: 'g', t: 'E  man the deck gun'};
  return null;
}
