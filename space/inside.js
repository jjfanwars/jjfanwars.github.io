'use strict';
// Lucas Space Program station interiors (26 Nov 2026; owner: "make sure all the rocketships etc are walkable and some have cool useful features").
// Docked, float up out of the capsule (F under the roof hatch) into the station: every pressurised module is a room you can drift through,
// joined by the port tunnels. Things to use: bunks (sleep: time skips 8 h or to the next burn), lab bench (experiments: science per world),
// greenhouse (harvest when grown), depot console (refill the ship), cupola (look out, HUD off), telescope (zoom in on any world), hub console.
// Loaded after net.js (wraps its cabinAct / myPose / avatarsFrame), before polish.js.

const SI = {on: false, V: null, pos: new V3(), vel: new V3(), q: new Q4(), use: null, busy: null, tele: null, look: false, sleep: null};
const SCI = (() => { try { return JSON.parse(localStorage.getItem('ye-sci') || 'null') || {n: 0, done: {}}; } catch (e) { return {n: 0, done: {}}; } })();
const _iA = new V3(), _iB = new V3(), _iC = new V3(), _iQ = new Q4(), _iQ2 = new Q4(), _iZ = new V3(0, 0, 1), _iX = new V3(1, 0, 0), _iY = new V3(0, 1, 0);

// ---------------- where you can be: one test per module, in module coordinates (axis = local y, ports at y = +-L/2)
function modIn(k, p) { const h = MODULES[k].L / 2, y = p.y, ay = Math.abs(y), r = Math.hypot(p.x, p.z);
  if (k === 'hub') { if (p.length() < 1.12) return true; const a = [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)]; for (let i = 0; i < 3; i++) if (a[i] < h + .05 && Math.hypot(a[(i + 1) % 3], a[(i + 2) % 3]) < .46) return true; return false; }
  if (ay > h + .05) return false;
  if (k === 'hab' || k === 'lab' || k === 'green') { if (k === 'green' && ay < h - 1.25 && r < .64) return false; // greenhouse: the plant column in the middle
    if (ay <= h - 1.05) return r < 1.36; if (ay <= h - .5) return r < lerp(1.36, .46, (ay - (h - 1.05)) / .55); return r < .46; }
  if (k === 'cupola') { const u = y + h; if (u < .5) return r < .46; if (u < 1.1) return r < 1.15; return u < 2 * h - .35 && r < lerp(1.15, .5, (u - 1.1) / (2 * h - 1.45)); }
  if (k === 'depot') return r < .36;
  if (k === 'tele') return y < -h + 1.45 && r < .46;
  return y < -h + .42 && r < .44; } // solar: just the hatch
const modLocal = (m, p, out) => out.copy(p).sub(m.p).applyQuaternion(_iQ.copy(m.q).invert());
function stIn(V, p) { for (const m of V.mods) if (modIn(m.k, modLocal(m, p, _iC))) return m; return null; }

// ---------------- interiors (built when you first go in; rebuilt when the station or its open hatches change)
const IM = {};
{ const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // wall panels: off-white with seams, velcro squares, a few labels and one blue "deck" stripe so you keep a sense of down
  const wall = cv(512, 512, (x, w, h) => { x.fillStyle = '#dcddd8'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const g = x.createLinearGradient(i * 128, j * 128, i * 128 + 128, j * 128 + 128); g.addColorStop(0, '#e6e7e2'); g.addColorStop(1, '#d2d3ce'); x.fillStyle = g; x.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (const [a, b] of [[12, 12], [110, 12], [12, 110], [110, 110]]) { x.beginPath(); x.arc(i * 128 + a + 3, j * 128 + b + 3, 2.2, 0, 7); x.fill(); } }
    x.strokeStyle = 'rgba(30,32,36,.35)'; x.lineWidth = 2; for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 128, 0); x.lineTo(k * 128, h); x.moveTo(0, k * 128); x.lineTo(w, k * 128); x.stroke(); }
    x.fillStyle = '#3b3f45'; for (const [a, b] of [[40, 60], [300, 200], [180, 420], [430, 330], [70, 300]]) x.fillRect(a, b, 26, 16);
    x.fillStyle = '#2f5d9e'; x.fillRect(0, 236, w, 40); x.fillStyle = '#e9b53a'; for (let k = 0; k < w; k += 32) x.fillRect(k, 228, 16, 6);
    x.fillStyle = '#121314'; x.font = '700 15px Archivo, sans-serif'; x.fillText('HANDRAIL', 150, 90); x.fillText('PWR 28V', 330, 470); x.fillText('STOW', 40, 470); x.font = '600 11px Archivo, sans-serif'; x.fillText('DO NOT PUSH OFF', 270, 140); });
  IM.wall = new THREE.MeshStandardMaterial({map: wall, roughness: .78, metalness: .02, side: THREE.BackSide});
  IM.tun = new THREE.MeshStandardMaterial({color: 0xb9bcbf, roughness: .45, metalness: .55, side: THREE.BackSide});
  IM.dark = new THREE.MeshStandardMaterial({color: 0x2a2d32, roughness: .6, metalness: .3});
  IM.hatch = new THREE.MeshStandardMaterial({map: cv(256, 256, (x, w, h) => { x.fillStyle = '#9aa0a6'; x.fillRect(0, 0, w, h); x.strokeStyle = '#4a4f55'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.stroke();
    x.lineWidth = 8; x.beginPath(); x.arc(128, 128, 46, 0, 7); x.stroke(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * 46, 128 + Math.sin(a) * 46); x.lineTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); x.stroke(); }
    x.fillStyle = '#D8342A'; x.fillRect(96, 196, 64, 18); }), roughness: .5, metalness: .6});
  IM.rail = new THREE.MeshStandardMaterial({color: 0xe0b23a, roughness: .4, metalness: .3});
  IM.lamp = new THREE.MeshStandardMaterial({color: 0xfff4de, emissive: 0xfff0d6, emissiveIntensity: 2.4});
  IM.grow = new THREE.MeshStandardMaterial({color: 0xffc8f0, emissive: 0xe070ff, emissiveIntensity: 2});
  IM.scr = new THREE.MeshStandardMaterial({color: 0x0f1a14, emissive: 0x39d07a, emissiveIntensity: .9, roughness: .3});
  IM.scrB = new THREE.MeshStandardMaterial({color: 0x0d1424, emissive: 0x4f8fe0, emissiveIntensity: .9, roughness: .3});
  IM.rack = new THREE.MeshStandardMaterial({color: 0xc9ccd0, roughness: .5, metalness: .25});
  IM.glass = new THREE.MeshStandardMaterial({color: 0x081220, roughness: .03, metalness: .95, envMapIntensity: 2});
  IM.cup = new THREE.MeshStandardMaterial({color: 0x9cc6e4, roughness: .04, metalness: .3, transparent: true, opacity: .22, depthWrite: false});
  IM.bag = [0x2f5d9e, 0xd9782a, 0x3f8a4f, 0x7d4f9e].map(c => new THREE.MeshStandardMaterial({color: c, roughness: .85}));
  IM.food = new THREE.MeshStandardMaterial({color: 0xd9d2c0, roughness: .7});
}
const IG = {}; const igeo = (k, f) => IG[k] || (IG[k] = f());
function imesh(geo, mat, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.receiveShadow = true; return o; }
function iwall(g, r0, r1, y0, y1, mat, seg = 36, rep) { const geo = igeo('w' + [r0, r1, y0, y1, seg].join(','), () => { const c = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, true); const uv = c.attributes.uv; if (rep) for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 - uv.getX(i)) * rep[0], uv.getY(i) * rep[1]); return c; }); // seen from inside: flip u so labels read
  const o = imesh(geo, mat, 0, (y0 + y1) / 2, 0); g.add(o); return o; }
// a part stuck to the curved wall at angle a (around the axis), height y, standing off the wall by `off`, facing the axis
function onWall(g, geo, mat, r, a, y, off = 0) { const o = imesh(geo, mat, Math.sin(a) * (r - off), y, Math.cos(a) * (r - off)); o.rotation.y = a + Math.PI; o.castShadow = false; g.add(o); return o; }
function hatchAt(g, y, s, open) { // port end at local y (s = +-1 points out)
  const ring = imesh(igeo('hRing', () => new THREE.TorusGeometry(.5, .05, 8, 28)), IM.rail, 0, y - s * .04, 0); ring.rotation.x = Math.PI / 2; g.add(ring);
  if (!open) { const d = imesh(igeo('hDisc', () => new THREE.CircleGeometry(.52, 28)), IM.hatch, 0, y - s * .02, 0); d.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(d); } }
function railsIn(g, r, y0, y1) { const geo = igeo('ir' + (y1 - y0).toFixed(2), () => new THREE.CylinderGeometry(.025, .025, y1 - y0, 6)); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.add(imesh(geo, IM.rail, Math.sin(a) * (r - .12), (y0 + y1) / 2, Math.cos(a) * (r - .12))); } }
function lampsIn(g, r, y0, y1, mat = IM.lamp) { const geo = igeo('lp' + (y1 - y0).toFixed(2), () => new THREE.BoxGeometry(.16, y1 - y0, .05)); for (const a of [Math.PI * .75, Math.PI * 1.25]) onWall(g, geo, mat, r, a, (y0 + y1) / 2, .03); }

function innerMesh(m) { const k = m.k, M = MODULES[k], h = M.L / 2, g = new THREE.Group(), used = j => !!m.used[j], spots = [];
  const spot = (kind, p, t) => spots.push({kind, p, t});
  if (k === 'hub') { g.add(imesh(igeo('hubIn', () => { const c = new THREE.SphereGeometry(1.4, 36, 24), uv = c.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 - uv.getX(i)) * 4, uv.getY(i) * 2); return c; }), IM.wall));
    const dirs = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    dirs.forEach((d, j) => { const t = new THREE.Group(); t.quaternion.setFromUnitVectors(_iY, _iA.fromArray(d)); iwall(t, .62, .62, 1.15, h, IM.tun, 24); hatchAt(t, h, 1, used(j)); g.add(t); });
    const con = imesh(igeo('hubCon', () => new THREE.BoxGeometry(.7, .45, .14)), IM.dark), dir = _iA.set(1, -1, 1).normalize(); con.position.copy(dir).multiplyScalar(1.22); con.lookAt(0, 0, 0); g.add(con);
    const s = imesh(igeo('hubScr', () => new THREE.PlaneGeometry(.6, .34)), IM.scrB); s.position.copy(dir).multiplyScalar(1.13); s.lookAt(0, 0, 0); g.add(s);
    spot('status', dir.clone().multiplyScalar(.75), 'F · Station status'); }
  else if (k === 'hab' || k === 'lab' || k === 'green') {
    const y0 = -h + 1.0, y1 = h - 1.0, R0 = 1.68;
    if (k !== 'green') { iwall(g, R0, R0, y0, y1, IM.wall, 36, [5, Math.round((y1 - y0) / 1.3)]); railsIn(g, R0, y0 + .2, y1 - .2); lampsIn(g, R0, y0 + .3, y1 - .3); }
    else { iwall(g, R0, R0, y0, -h + 1.25, IM.tun); iwall(g, R0, R0, h - 1.25, y1, IM.tun); for (const s of [-1, 1]) { const l = imesh(igeo('glamp' + M.L, () => new THREE.BoxGeometry(.12, M.L - 3, .12)), IM.grow, s * .74, 0, -.74); g.add(l); } }
    for (const s of [-1, 1]) { const c = iwall(g, s > 0 ? R0 : .64, s > 0 ? .64 : R0, s > 0 ? h - 1.0 : -h + .5, s > 0 ? h - .5 : -h + 1.0, IM.tun); c.userData.cone = true; iwall(g, .64, .64, s > 0 ? h - .5 : -h, s > 0 ? h : -h + .5, IM.tun, 24); hatchAt(g, s * h, s, used(s > 0 ? 1 : 0)); }
    if (k === 'hab') { // four sleeping bags on the walls, a galley table, the windows on the +z side
      const bag = igeo('bag', () => { const c = new THREE.CapsuleGeometry(.28, 1.3, 6, 14); c.scale(1, 1, .45); return c; });
      [[Math.PI * .55, -1.15], [Math.PI * 1.45, -1.15], [Math.PI * .55, 1.15], [Math.PI * 1.45, 1.15]].forEach(([a, y], i) => { onWall(g, bag, IM.bag[i], R0, a, y, .2); onWall(g, igeo('bLamp', () => new THREE.BoxGeometry(.12, .06, .04)), IM.lamp, R0, a, y + .95, .03); });
      spot('sleep', new V3(Math.sin(Math.PI * .55) * .9, -1.15, Math.cos(Math.PI * .55) * .9), 'F · Sleep in a bunk (skips 8 h)'); spot('sleep', new V3(Math.sin(Math.PI * 1.45) * .9, 1.15, Math.cos(Math.PI * 1.45) * .9), 'F · Sleep in a bunk (skips 8 h)');
      onWall(g, igeo('galley', () => new THREE.BoxGeometry(.9, 1.1, .4)), IM.rack, R0, Math.PI, 0, .22); for (let i = 0; i < 6; i++) onWall(g, igeo('pack', () => new THREE.BoxGeometry(.14, .2, .06)), IM.food, R0, Math.PI + (i % 3 - 1) * .13, -.3 + Math.floor(i / 3) * .5, .45);
      for (let i = 0; i < 4; i++) { const y = -h + 1.7 + i * (M.L - 3.4) / 3; const w = imesh(igeo('habWin', () => new THREE.CircleGeometry(.22, 24)), IM.glass, 0, y, R0 - .03); w.rotation.y = Math.PI; g.add(w);
        const f = imesh(igeo('habWinF', () => new THREE.TorusGeometry(.24, .035, 8, 24)), IM.rail, 0, y, R0 - .04); g.add(f); } }
    if (k === 'lab') { // racks down both sides with glowing screens, a glovebox opposite
      for (const a of [Math.PI / 2, -Math.PI / 2]) for (const y of [-1.25, 0, 1.25]) { onWall(g, igeo('rack', () => new THREE.BoxGeometry(.95, 1.1, .5)), IM.rack, R0, a, y, .3); onWall(g, igeo('rScr', () => new THREE.PlaneGeometry(.5, .3)), (y > 0) ? IM.scr : IM.scrB, R0, a, y + .2, .56); }
      onWall(g, igeo('glove', () => new THREE.BoxGeometry(1.1, .8, .55)), IM.rack, R0, Math.PI, 0, .3); onWall(g, igeo('gGlass', () => new THREE.PlaneGeometry(.9, .45)), IM.cup, R0, Math.PI, .08, .58);
      for (const x of [-.22, .22]) onWall(g, igeo('gHole', () => new THREE.CircleGeometry(.1, 16)), IM.dark, R0, Math.PI + x * .5, -.2, .585);
      spot('lab', new V3(0, 0, -.85), 'F · Run an experiment'); }
    if (k === 'green') spot('harvest', new V3(.9, 0, .2), 'F · Harvest'); }
  else if (k === 'cupola') { iwall(g, .64, .64, -h, -h + .5, IM.tun, 24); iwall(g, 1.38, 1.38, -h + .5, -h + 1.1, IM.wall, 6); hatchAt(g, -h, -1, used(0)); spot('look', new V3(0, .1, 0), 'F · Look out'); }
  else if (k === 'depot') { iwall(g, .46, .46, -h, h, IM.tun, 20); hatchAt(g, -h, -1, used(0)); hatchAt(g, h, 1, used(1));
    for (const a of [0, 2.1, 4.2]) { const p = imesh(igeo('pipe' + M.L, () => new THREE.CylinderGeometry(.03, .03, M.L - .2, 8)), IM.rail, Math.sin(a) * .38, 0, Math.cos(a) * .38); g.add(p); }
    const c = imesh(igeo('depCon', () => new THREE.BoxGeometry(.34, .3, .08)), IM.dark, 0, -h + .9, .36); g.add(c); const s = imesh(igeo('depScr', () => new THREE.PlaneGeometry(.28, .2)), IM.scr, 0, -h + .9, .315); s.rotation.y = Math.PI; g.add(s);
    spot('refuel', new V3(0, -h + .9, 0), 'F · Fill the ship\'s tanks'); }
  else if (k === 'tele') { iwall(g, .64, .64, -h, -h + 1.6, IM.tun, 24); hatchAt(g, -h, -1, used(0)); const e = imesh(igeo('tEnd', () => new THREE.CircleGeometry(.64, 24)), IM.dark, 0, -h + 1.58, 0); e.rotation.x = Math.PI / 2; g.add(e);
    const ep = imesh(igeo('eye', () => new THREE.CylinderGeometry(.08, .1, .3, 16)), IM.rack, 0, -h + 1.42, 0); g.add(ep); const s = imesh(igeo('tScr', () => new THREE.PlaneGeometry(.4, .25)), IM.scrB, .3, -h + 1.2, .3); s.rotation.y = -Math.PI * .75; g.add(s);
    spot('tele', new V3(0, -h + 1.05, 0), 'F · Use the telescope'); }
  else { iwall(g, .62, .62, -h, -h + .48, IM.tun, 24); hatchAt(g, -h, -1, used(0)); const e = imesh(igeo('sEnd', () => new THREE.CircleGeometry(.62, 24)), IM.hatch, 0, -h + .47, 0); e.rotation.x = Math.PI / 2; g.add(e); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } }); g.userData.spots = spots; return g; }

// module shells are capped cylinders: the caps would wall off the inside, so stations use open ones (the walls still close every gap you can see)
{ const mm0 = modMesh; modMesh = function (k) { const g = mm0(k); g.traverse(o => { const gp = o.isMesh && o.geometry.type === 'CylinderGeometry' && o.geometry.parameters; if (!gp || gp.openEnded || Math.max(gp.radiusTop, gp.radiusBottom) < .3) return;
    const old = o.geometry; o.geometry = new THREE.CylinderGeometry(gp.radiusTop, gp.radiusBottom, gp.height, gp.radialSegments, gp.heightSegments, true); if (!Object.values(SG).includes(old)) old.dispose(); o.material = o.material.side === THREE.FrontSide ? o.material : o.material; }); return g; }; }
function stEnsure(V) { if (!V.g) vesBuild(V); V.mods.forEach((m, mi) => { const key = m.used.map(Boolean).join(); let inn = m.g.userData.inner;
    if (inn && inn.userData.key === key) return; if (inn) m.g.remove(inn); inn = innerMesh(m); inn.userData.key = key; inn.userData.mi = mi; m.g.add(inn); m.g.userData.inner = inn;
    if (m.k === 'cupola') m.g.traverse(o => { if (o.isMesh && (o.material === SM.glass || (o.material === SM.panel && o.geometry.parameters && o.geometry.parameters.radialSegments === 6))) { o.material = IM.cup; o.castShadow = false; } }); }); }
function stShowInner(V, on) { if (V.g) V.mods.forEach(m => { const i = m.g && m.g.userData.inner; if (i) i.visible = on;
    if (m.k === 'hub' && m.g) for (const o of m.g.children) if (o.isMesh && o.geometry.type === 'SphereGeometry' && o.material === SM.white) o.visible = !(on && SI.on); }); } // the hub's outer ball would hide its inside

// ---------------- in and out
function siEnter() { const V = DK.V, fp = DK.port; if (!V || !fp) return; stEnsure(V); SI.on = true; SI.V = V; SI.use = null; SI.busy = null;
  SI.pos.copy(fp.P).addScaledVector(fp.D, -.35); SI.vel.copy(fp.D).multiplyScalar(-.7);
  const m = V.mods[fp.mi], up = _iB.set(1, 0, 0).applyQuaternion(m.q); if (Math.abs(up.dot(fp.D)) > .9) up.set(0, 0, 1).applyQuaternion(m.q);
  SI.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new V3(), fp.D.clone().negate(), up)); // looking into the module, its blue stripe below
  FLOG.siIn = true; sfx('thud'); showHint('Inside ' + V.name + ' · W/S/A/D float · Space/Shift up/down · Q/E roll · F use things', 6000); }
function siLeave(toCabin) { if (!SI.on) return; const V = SI.V; siLook(false); siTele(false); siSleepEnd(); SI.on = false; SI.V = null; SI.busy = null; cabL.distance = 7;
  if (toCabin && R.on) { const f = _iA.set(0, 0, -1).applyQuaternion(SI.q).applyQuaternion(V.q).applyQuaternion(_iQ.copy(R.q).invert()); C.seat = -1; C.view = 'in'; C.pos.set(0, CAB.ceil - 1.85, 0); C.vel.set(0, -.25, 0);
    C.yaw = Math.atan2(-f.x, -f.z); C.pitch = clamp(Math.asin(clamp(f.y, -1, 1)), -1.4, 1.4); sfx('thud'); showHint('Back in the capsule', 2000); } }
function siCanEnter() { return R.on && C.in && C.seat < 0 && R.st === 'docked' && DK.V && Math.hypot(C.pos.x, C.pos.z) < .8 && (C.pitch > .55 || C.pos.y > CAB.floor + .9); }

// ---------------- floating about
function siStep(dt) { const V = SI.V;
  if (!V || R.st !== 'docked' || DK.V !== V) { siLeave(R.st === 'docked'); return; }
  const sens = .0022 * (SET.sens || 1) * (SI.tele ? SI.tele.fov / 70 : 1);
  if (SI.tele) { SI.tele.ax -= look.dx * sens; SI.tele.ay = clamp(SI.tele.ay - look.dy * sens * (SET.invY ? -1 : 1), -.5, .5); look.dx = look.dy = 0; return; }
  if (!SI.sleep) { SI.q.multiply(_iQ.setFromAxisAngle(_iY, -look.dx * sens)).multiply(_iQ2.setFromAxisAngle(_iX, -look.dy * sens * (SET.invY ? -1 : 1)));
    const roll = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0); if (roll) SI.q.multiply(_iQ.setFromAxisAngle(_iZ, roll * 1.3 * dt)); SI.q.normalize(); }
  look.dx = look.dy = 0; if (SI.look || SI.sleep) { SI.vel.multiplyScalar(Math.exp(-dt * 3)); return; }
  const push = _iA.set(0, 0, 0), fw = _iB.set(0, 0, -1).applyQuaternion(SI.q), rt = _iC.set(1, 0, 0).applyQuaternion(SI.q);
  if (keys.KeyW) push.add(fw); if (keys.KeyS) push.sub(fw); if (keys.KeyD) push.add(rt); if (keys.KeyA) push.sub(rt);
  const up = _iB.set(0, 1, 0).applyQuaternion(SI.q); if (keys.Space) push.add(up); if (keys.ShiftLeft || keys.ShiftRight) push.sub(up);
  if (push.lengthSq() > 1) push.normalize(); SI.vel.addScaledVector(push, 2.4 * dt).multiplyScalar(Math.exp(-dt * 1.1)); if (SI.vel.length() > 2.2) SI.vel.setLength(2.2);
  const mv = SI.vel.clone().multiplyScalar(dt), np = SI.pos.clone().add(mv); if (stIn(V, np)) { SI.pos.copy(np); return; }
  // blocked: slide along the module we are in (drop the push into the wall, then the push along the axis)
  const m = stIn(V, SI.pos); if (!m) { SI.vel.set(0, 0, 0); return; } const iq = _iQ.copy(m.q).invert(), lp = modLocal(m, SI.pos, new V3()), lm = mv.clone().applyQuaternion(iq), rad = new V3(lp.x, 0, lp.z);
  if (m.k === 'hub') rad.copy(lp); if (rad.lengthSq() > 1e-6) rad.normalize();
  const tries = [lm.clone().addScaledVector(rad, -lm.dot(rad)), new V3(lm.x, 0, lm.z), new V3(0, lm.y, 0)];
  for (const t of tries) { const p2 = t.clone().applyQuaternion(m.q).add(SI.pos); if (stIn(V, p2)) { SI.pos.copy(p2); SI.vel.copy(t).divideScalar(Math.max(dt, 1e-4)).applyQuaternion(m.q); return; } }
  SI.vel.multiplyScalar(-.2); }
function siEye(out) { vesState(SI.V, G.t, out); return out.add(_iA.copy(SI.pos).applyQuaternion(SI.V.q)); }
function siCamera() { const V = SI.V; siEye(G.O);
  if (SI.tele) { const b = BODIES[SI.tele.i], d = _iB.copy(b.c).sub(G.O).normalize(), up = _iC.set(0, 1, 0).applyQuaternion(V.q), M4 = new THREE.Matrix4().lookAt(new V3(), d, Math.abs(d.dot(up)) > .98 ? _iX : up);
    cam.quaternion.setFromRotationMatrix(M4).multiply(_iQ.setFromAxisAngle(_iY, SI.tele.ax)).multiply(_iQ2.setFromAxisAngle(_iX, SI.tele.ay)); }
  else cam.quaternion.copy(V.q).multiply(SI.q);
  cam.position.set(0, 0, 0); cam.updateMatrixWorld();
  const m = stIn(V, SI.pos) || V.mods[0]; vesState(V, G.t, cabL.position); cabL.position.add(_iA.copy(m.p).applyQuaternion(V.q)).sub(G.O); cabL.distance = 9; cabL.intensity = SI.tele ? 0 : 6; }
function siNear() { const V = SI.V; if (SI.tele) return {k: 'tele', t: 'F · Leave the telescope'}; if (SI.look) return {k: 'look', t: 'F · Stop looking'}; if (SI.sleep) return {k: 'wake', t: 'F · Wake up'};
  if (SI.busy) return {k: 'busy', t: SI.busy.t + ' ' + Math.ceil(SI.busy.T - SI.busy.e) + ' s'};
  const fp = DK.port; if (fp && SI.pos.distanceTo(_iA.copy(fp.P).addScaledVector(fp.D, -.3)) < 1.0) return {k: 'cabin', t: 'F · Down into the capsule'};
  let best = null, bd = 1.25; V.mods.forEach((m, mi) => { const inn = m.g && m.g.userData.inner; if (!inn) return; for (const s of inn.userData.spots) { const wp = _iA.copy(s.p).applyQuaternion(m.q).add(m.p), d = wp.distanceTo(SI.pos); if (d < bd) { bd = d; best = {k: s.kind, t: s.t, m, mi}; } } });
  if (best && best.k === 'harvest') { const g = greenGrow(V, best.mi); best.t = g < 1 ? 'Plants growing: ' + Math.round(g * 100) + '% (harvest at 100)' : 'F · Harvest fresh food'; }
  if (best && best.k === 'refuel' && R.fuel.every((f, i) => i < R.bot || f >= STAGES[i].fuel - .5)) best.t = 'Ship tanks are full';
  return best; }
function siAct() { const n = siNear(); if (!n) return;
  if (n.k === 'cabin') { siLeave(true); return; }
  if (n.k === 'tele') { siTele(!SI.tele); return; } if (n.k === 'look') { siLook(!SI.look); return; } if (n.k === 'wake') { siSleepEnd(true); return; }
  if (n.k === 'sleep') { siSleep(); return; }
  if (n.k === 'lab') { SI.busy = {k: 'lab', t: 'Experiment running…', e: 0, T: 8}; sfx('pop'); return; }
  if (n.k === 'harvest') { const V = SI.V; if (greenGrow(V, n.mi) < 1) { showHint('Not ready yet', 1500); return; } (V.harv = V.harv || {})[n.mi] = G.t; FLOG.harvest = true; sfx('pop'); showHint('Harvest: fresh lettuce, tomatoes and radishes for the crew', 3500); return; }
  if (n.k === 'refuel') { let any = false; for (let i = R.bot; i < STAGES.length; i++) if (R.fuel[i] < STAGES[i].fuel) { R.fuel[i] = STAGES[i].fuel; any = true; } if (!SI.V.mods.some(m => m.k === 'depot')) return; FLOG.refuel = true; sfx('thud'); showHint(any ? 'Pumping… tanks full' : 'Tanks already full', 2500); return; }
  if (n.k === 'status') { siStatus(); return; } }

// ---------------- the useful bits
const GREEN_T = 2 * 3600; // plants regrow in two hours of game time
function greenGrow(V, mi) { const t0 = V.harv && V.harv[mi]; return t0 === undefined ? 1 : clamp((G.t - t0) / GREEN_T, 0, 1); }
function siBusyStep(dt) { const b = SI.busy; if (!b) return; b.e += dt; if (b.e < b.T) return; SI.busy = null;
  if (b.k === 'lab') { const V = SI.V, body = BODIES[V.b], key = body.name + (V.r.length() - body.R > body.R * 2 ? ' high orbit' : ' orbit'), fresh = !SCI.done[key]; SCI.done[key] = (SCI.done[key] || 0) + 1; const pts = fresh ? 10 : 1; SCI.n += pts;
    try { localStorage.setItem('ye-sci', JSON.stringify(SCI)); } catch (e) {} FLOG.sci = true; if (fresh) FLOG.sciNew = true; chime();
    showHint((fresh ? 'New result: ' + key + ' · +10 science' : 'More data from ' + key + ' · +1 science') + ' · total ' + SCI.n + (fresh ? '' : ' · move the station to another world for new results'), 5000); } }
function siSleep() { if (NODE && NODE.t - G.t < 600) { showHint('A burn is coming up: no time for a nap', 2500); return; }
  const to = G.t + Math.min(8 * 3600, NODE ? NODE.t - NODE.burn / 2 - 120 - G.t : Infinity); SI.sleep = {to}; setWarp(WARPS.indexOf(10000)); $('siFade').classList.add('on'); }
function siSleepEnd(early) { if (!SI.sleep) return; SI.sleep = null; setWarp(0); $('siFade').classList.remove('on'); FLOG.slept = true; showHint(early ? 'Awake' : 'Good morning · ' + localTime() + ' at the Space Centre', 3000); }
function siSleepStep() { if (!SI.sleep) return; const left = SI.sleep.to - G.t; if (left <= 0) { siSleepEnd(); return; } if (G.wi === 0) { siSleepEnd(true); return; }
  if (G.warp > 1000 && left < G.warp * 1.5) setWarp(WARPS.indexOf(1000)); $('siFade').dataset.t = 'Sleeping · ' + siFmtT(left); }
function siFmtT(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' h ' + String(m).padStart(2, '0') + ' m' : m + ' m'; }
function siTele(on) { const el = $('siTele');
  if (on) { const V = SI.V, own = V.b, list = BODIES.map((b, i) => i).filter(i => i !== own); SI.tele = {list, j: 0, i: list[0], fov: 6, ax: 0, ay: 0}; siTeleNext(0); document.body.classList.add('photo'); el.classList.remove('hidden'); FLOG.tele = true; }
  else { SI.tele = null; el.classList.add('hidden'); if (!SI.look) document.body.classList.remove('photo'); } }
function siTeleNext(d) { const T = SI.tele; if (!T) return; T.j = (T.j + d + T.list.length) % T.list.length; T.i = T.list[T.j]; T.ax = T.ay = 0; const b = BODIES[T.i], dist = b.c.distanceTo(G.O);
  T.fov = clamp(Math.atan(b.R * 3 / dist) * 360 / Math.PI, .05, 20); siTeleLabel(); }
function siBlock(b) { const d = _iA.copy(b.c).sub(G.O), L = d.length(); d.divideScalar(L); for (const o of BODIES) { if (o === b) continue; const oc = _iB.copy(o.c).sub(G.O), t = oc.dot(d); if (t > 0 && t < L && oc.lengthSq() - t * t < o.R * o.R) return o; } return null; }
function siTeleLabel() { const T = SI.tele, b = BODIES[T.i], bl = siBlock(b); $('siTele').innerHTML = '<span class="cap">Telescope</span><b>' + b.name + '</b><span>' + fmtD(b.c.distanceTo(G.O)) + ' · ' + (70 / T.fov).toFixed(T.fov > 7 ? 1 : 0) + '×</span>' + (bl ? '<span class="warn">behind ' + bl.name + '</span>' : '') + '<span class="k">Scroll</span> zoom <span class="k">Tab</span> next world <span class="k">F</span> leave'; }
function siLook(on) { SI.look = !!on; document.body.classList.toggle('photo', SI.look || !!SI.tele); $('siLook').classList.toggle('hidden', !SI.look); if (on) FLOG.cupola = true; }
function siStatus() { const V = SI.V, el = $('siStat'); if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; } const b = BODIES[V.b], o = orbitEl(b), cnt = {};
  V.mods.forEach(m => cnt[m.k] = (cnt[m.k] || 0) + 1);
  el.innerHTML = '<div class="ph"><span class="cap">Station</span><b>' + V.name + '</b></div><div class="mg">' + [['Orbiting', b.name], ['Ap', fmtD(o.ap)], ['Pe', fmtD(o.pe)], ['Period', siFmtT(isFinite(o.period) ? o.period : 0)], ['Modules', V.mods.length], ['Visits', V.visits || 0], ['Science', SCI.n]].map(([a, v]) => '<span>' + a + '</span><b>' + v + '</b>').join('') + '</div><div class="mods">' + Object.keys(cnt).map(k => MODULES[k].name + (cnt[k] > 1 ? ' ×' + cnt[k] : '')).join(' · ') + '</div>';
  el.classList.remove('hidden'); }

// ---------------- hooks into the cabin (flight.js) and the crew sync (net.js)
{ const st0 = cabinStep; cabinStep = function (dt) { if (SI.on) { siStep(dt); siBusyStep(dt); siSleepStep(); return; } st0(dt); }; }
{ const ca0 = cabinCamera; cabinCamera = function () { if (SI.on && SI.V) { siCamera(); return; } ca0(); }; }
{ const n0 = cabinNear; cabinNear = function () { if (SI.on) return siNear(); if (siCanEnter()) return {k: 'stIn', t: 'F · Float up into ' + DK.V.name}; return n0(); }; }
{ const a0 = cabinAct; cabinAct = function () { if (SI.on) { siAct(); return; } if (siCanEnter() && C.seat < 0) { siEnter(); return; } a0(); }; }
{ const f0 = fovStep; fovStep = function (dt) { if (SI.on && (SI.tele || SI.look)) { const tg = SI.tele ? SI.tele.fov : 85, f = SI.tele ? tg : lerp(cam.fov, tg, 1 - Math.exp(-dt * 4)); if (Math.abs(f - cam.fov) > 1e-4) { cam.fov = f; cam.updateProjectionMatrix(); } return; } f0(dt); }; }
{ const rr0 = resetRocket; resetRocket = function () { if (SI.on) siLeave(false); rr0(); }; }
{ const dt0 = dockToggle; dockToggle = function () { if (R.st === 'docked') { const inside = SI.on || [...NET.players.values()].some(p => p.po && p.po.m === 2 && p.id !== myId()); if (inside) { showHint('Crew still inside ' + (DK.V ? DK.V.name : 'the station') + ': wait for everyone to come back to the capsule', 3000); return; } } dt0(); }; }
// the inside of a station shows while you are docked to it (or inside it)
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v0(dt); for (const V of VES.list) stShowInner(V, R.on && C.in && R.st === 'docked' && DK.V === V);
    if (SI.on && SI.tele) { siTeleLabel(); if (SI.V.g) SI.V.g.visible = false; if (R.g && R.g.visible) { R.g.visible = false; SI.hidR = true; } } else if (SI.hidR) { SI.hidR = false; if (R.g && R.st !== 'dead') R.g.visible = true; }
    if (SI.on) { const m = stIn(SI.V, SI.pos); setTxt('hLoc', (m ? MODULES[m.k].name : 'Tunnel') + ' · ' + SI.V.name); setTxt('hInfo', 'Weightless · WASD float · Space/Shift up/down · Q/E roll'); } if (!SI.on && !$('siStat').classList.contains('hidden')) $('siStat').classList.add('hidden'); }; }
{ const h0 = FLIGHT.hud; FLIGHT.hud = function (dt) { h0(dt); if (SI.on && SI.V) { const m = stIn(SI.V, SI.pos); $('hLoc').textContent = (m ? MODULES[m.k].name : 'Tunnel') + ' · ' + SI.V.name; $('hInfo').textContent = 'Weightless · WASD float · Space/Shift up/down · Q/E roll'; } }; }
addEventListener('keydown', e => { if (!SI.on || !G.on || G.paused) return;
  if (SI.tele && e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); siTeleNext(e.shiftKey ? -1 : 1); }
  if (/^(Digit\d|KeyT|KeyZ|KeyX|KeyR|KeyH|KeyK|KeyV)$/.test(e.code) && !SI.tele) { e.stopImmediatePropagation(); } }, true);
addEventListener('wheel', e => { if (!SI.on || !SI.tele || G.paused) return; e.preventDefault(); e.stopImmediatePropagation(); SI.tele.fov = clamp(SI.tele.fov * Math.exp(e.deltaY * .0015), .03, 40); }, {passive: false, capture: true});
// crew sync: m 2 = inside a station (station id, station-frame position, orientation)
{ const mp0 = myPose; myPose = function () { const o = mp0(); if (SI.on && SI.V) { o.m = 2; o.sv = SI.V.id; o.p = SI.pos.toArray().map(v => +v.toFixed(2)); o.q = SI.q.toArray().map(v => +v.toFixed(3)); delete o.b; delete o.f; delete o.yaw; } return o; }; }
{ const af0 = avatarsFrame; avatarsFrame = function (dt) { const held = [];
    for (const p of NET.players.values()) if (p.po && p.po.m === 2) { held.push([p, p.po]); p.po = null; if (p.g) p.g.visible = false; if (p.tag) p.tag.style.display = 'none'; }
    af0(dt);
    for (const [p, po] of held) { p.po = po; const V = VES.list.find(v => v.id === po.sv); if (!V || p.id === myId()) continue;
      if (!p.g) { p.g = avatarMesh(CREW_COL[p.c % CREW_COL.length]); scene.add(p.g); p.tag = document.createElement('div'); p.tag.className = 'ntag'; document.body.appendChild(p.tag); }
      const g = p.g; vesState(V, G.t, g.position); g.position.add(_iA.fromArray(po.p).applyQuaternion(V.q)).sub(G.O); g.quaternion.copy(V.q).multiply(_iQ.fromArray(po.q)); g.translateY(-1.5); g.visible = g.position.length() < 4000;
      g.userData.legs.forEach((l, k) => { l.rotation.x = .25 + k * .2; l.position.y = .38; l.position.z = 0; });
      _iB.copy(g.position).addScaledVector(_iA.set(0, 1, 0).applyQuaternion(g.quaternion), 2.05); _iB.project(cam); const vis = g.visible && _iB.z < 1 && Math.abs(_iB.x) < 1.05 && Math.abs(_iB.y) < 1.05 && !MAPV.on;
      p.tag.style.display = vis ? '' : 'none'; if (vis) { p.tag.style.transform = 'translate(' + ((_iB.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-_iB.y * .5 + .5) * innerHeight).toFixed(1) + 'px) translate(-50%,-100%)'; if (p.tag._t !== p.name) { p.tag._t = p.name; p.tag.textContent = p.name; p.tag.style.setProperty('--c', '#' + CREW_COL[p.c % CREW_COL.length].toString(16).padStart(6, '0')); } } } }; }

// ---------------- overlays
{ const mk = (id, cls) => { const d = document.createElement('div'); d.id = id; d.className = cls; document.body.appendChild(d); return d; };
  mk('siFade', ''); mk('siTele', 'hidden'); mk('siStat', 'hidden'); mk('siLook', 'hidden').innerHTML = '<span class="cap">Cupola</span> Mouse to look around · <span class="k">F</span> stop looking';
  const st = document.createElement('style'); st.textContent = `
#siFade { position:fixed; inset:0; background:#121314; opacity:0; pointer-events:none; transition:opacity 1.2s; z-index:30; }
#siFade.on { opacity:.94; } #siFade.on::after { content:attr(data-t); position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:#F3F3F0; font:600 15px Archivo, sans-serif; letter-spacing:.02em; }
#siTele, #siLook { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:var(--plate); color:var(--ink); border:1px solid var(--ink); padding:8px 14px; font:500 13px Archivo, sans-serif; display:flex; gap:10px; align-items:baseline; z-index:12; white-space:nowrap; }
#siTele b { font-weight:700; } #siTele .warn { color:var(--redt); font-weight:700; } #siTele .cap, #siLook .cap, #siStat .cap { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--ink2); }
#siTele .k, #siLook .k { border:1px solid var(--ink); padding:0 5px; font-size:11px; font-weight:700; }
body.photo #siTele::before { content:''; position:fixed; left:50%; top:calc(-50vh + 50%); }
#siStat { position:fixed; right:24px; top:50%; transform:translateY(-50%); width:260px; background:var(--plate); color:var(--ink); border:1px solid var(--ink); font:500 13px Archivo, sans-serif; z-index:12; }
#siStat .ph { display:flex; gap:10px; align-items:baseline; padding:10px 14px; border-bottom:1px solid var(--ink); } #siStat .ph b { font-size:16px; }
#siStat .mg { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; padding:10px 14px; } #siStat .mg span { color:var(--ink2); } #siStat .mg b { text-align:right; font-variant-numeric:tabular-nums; }
#siStat .mods { padding:8px 14px 12px; border-top:1px solid var(--hair, rgba(18,19,20,.18)); color:var(--ink2); font-size:12px; }
body.photo #fl, body.photo #hud, body.photo #mis, body.photo #stInfo, body.photo #stTag, body.photo #cross, body.photo #netBar, body.photo #fSas, body.photo #warpW { display:none !important; }
#siTele.hidden, #siLook.hidden, #siStat.hidden { display:none; }`; document.head.appendChild(st); }

// ---------------- missions + a test jump
MISD.push(
  {id: 'in1', name: 'Moving in', d: 'Dock with a station and float up into it.', steps: [['Dock with a station (H)', F => F.dockShip || F.siIn], ['Out of the seat, float to the roof hatch and press F', F => F.siIn]], done: F => F.siIn},
  {id: 'in2', name: 'Science in orbit', d: 'Run an experiment in a Science lab.', steps: [['Put a Science lab on a station', F => VES.list.some(V => V.mods.some(m => m.k === 'lab')) || F.sci], ['Dock, float in and use the lab bench (F)', F => F.sci]], done: F => F.sci},
  {id: 'in3', name: 'Space salad', d: 'Grow and harvest food in a Greenhouse.', bonus: true, steps: [['Float into a Greenhouse and harvest (F)', F => F.harvest]], done: F => F.harvest},
  {id: 'in4', name: 'Stargazer', d: 'Look at another world through a Space telescope.', bonus: true, steps: [['Use the telescope eyepiece (F)', F => F.tele]], done: F => F.tele},
  {id: 'in5', name: 'Night shift', d: 'Sleep in a Habitat bunk in orbit.', bonus: true, steps: [['Float to a bunk and press F', F => F.slept]], done: F => F.slept});
TESTS.stationIn = function () { TESTS.orbit(); const nz = nose(new V3()), side = new V3(1, 0, 0).applyQuaternion(R.q);
  for (let i = VES.list.length - 1; i >= 0; i--) if (VES.list[i].test) { const V = VES.list[i]; if (V.g) scene.remove(V.g); VES.list.splice(i, 1); }
  const V = vesNew('hub', R.pos.clone().addScaledVector(side, 60), R.vel.clone(), R.q.clone()); V.test = true; V.name = 'Test station';
  for (const k of ['hab', 'lab', 'green', 'cupola', 'depot', 'tele', 'solar']) vesAttach(V, k);
  vesBuild(V); const fp = freePorts(V, true).find(f => f.mi === 0) || freePorts(V, true)[0]; vesState(V, G.t, _tP, _tV); DK.V = V; DK.port = fp; V.mods[fp.mi].used[fp.j] = true; R.st = 'docked'; R.lit = false; R.thr = 0;
  dockStep(0, G.t); board(); C.pos.set(0, CAB.floor + 1, 0); C.pitch = .9; showHint('Docked at a test station: float up to the roof hatch and press F', 5000); };
{ const vs0 = vesSave; vesSave = function () { const keep = VES.list; VES.list = keep.filter(V => !V.test); try { vs0(); } finally { VES.list = keep; } }; }
{ const grid = document.querySelector('#test .tg'); if (grid) { const b = document.createElement('button'); b.dataset.t = 'stationIn'; b.textContent = 'Inside a station'; b.onclick = e => { e.stopPropagation(); TESTS.stationIn(); testMenu(false); }; grid.insertBefore(b, grid.querySelector('[data-t="deck"]')); } }
Object.assign(window.YE, {SI, SCI, siEnter, siLeave, stIn, modIn, stEnsure, siNear, siAct});
