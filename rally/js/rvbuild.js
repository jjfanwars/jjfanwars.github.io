'use strict';
// Camper Crew: meshes. The camper (outside and a walk-in inside), crew avatars, items, and the set pieces on the map.
// Camper body frame (same as Car): +z forward, +y up, +x LEFT. Floor at FL, roof at RT, cab from CAB forward.
const FL = 0.2, RT = 2.42, CAB = 2.6;
const RVL = {
  bumper: [0, -0.12, 4.98], cap: [1.33, FL + 0.15, -3.0], door: [-0.52], ladder: [-0.55, -4.75], spare: [0.5, FL + 0.75, -4.66],
  seats: [[0.6, 3.28], [-0.6, 3.28]], radio: [0, FL + 1.02, 3.95], box: [-1.15, 1.15, -4.36, 3.86],
  // furniture boxes: x0 x1 z0 z1 top
  furn: [[0.68, 1.25, 0.25, 2.25, FL + 0.92], [0.62, 1.25, -0.8, 0.25, FL + 1.85], [-1.25, -0.5, 1.15, 1.95, FL + 0.74], [-1.25, -0.5, 0.62, 1.08, FL + 0.46], [-1.25, -0.5, 2.02, 2.48, FL + 0.46],
    [-1.25, -0.3, -4.45, -3.12, FL + 2.0], [0.0, 1.25, -4.45, -2.45, FL + 0.55], [0.28, 0.95, 2.98, 3.55, FL + 0.5], [-0.95, -0.28, 2.98, 3.55, FL + 0.5], [-1.25, 1.25, 3.82, 4.3, FL + 1.0]],
};
const RVSPEC = { name: 'Camper', m: 4600, I: [36000, 38000, 8200], pow: 1.5, grip: 1.0, steer: 0.72, tough: 5, vmax: 100, split: 1, r: 0.46, rest: 0.42, travel: 0.3, soft: 1.25, track: 1.06, base: [3.3, 2.3], hw: 1.3, hl: 4.9, bx: 1.25, by0: -0.4, by1: 2.4, bz: 4.6, bh: 2.7, roll: 0.1, snd: 'van' };
const MAT = {};
const mat = (c, o) => { const k = c + JSON.stringify(o || {}); return MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75 }, o || {}))); };
const cvTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const box = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; if (parent) parent.add(o); return o; };
const cyl = (r0, r1, h, m, x, y, z, parent, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; if (parent) parent.add(o); return o; };
// a flat wall split into boxes around rectangular holes. axis 'x': wall in the z-y plane at x; 'z': in the x-y plane at z.
function wallHoles(parent, m, axis, at, t, a0, a1, y0, y1, holes) {
  const cuts = [a0, a1]; for (const h of holes) cuts.push(h[0], h[1]); cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const u0 = cuts[i], u1 = cuts[i + 1]; if (u1 - u0 < 0.005) continue; const um = (u0 + u1) / 2, ys = [y0];
    for (const h of holes.filter(h => um > h[0] && um < h[1]).sort((a, b) => a[2] - b[2])) ys.push(h[2], h[3]); ys.push(y1);
    for (let k = 0; k < ys.length; k += 2) { const ya = ys[k], yb = ys[k + 1]; if (yb - ya < 0.005) continue;
      if (axis === 'x') box(t, yb - ya, u1 - u0, m, at, (ya + yb) / 2, um, parent); else box(u1 - u0, yb - ya, t, m, um, (ya + yb) / 2, at, parent); }
  }
}
// ---------- the camper ----------
function buildCamper() {
  const g = new THREE.Group(), body = mat(0xf2ecdc, { roughness: 0.45, metalness: 0.05 }), inner = mat(0xe9dcc0, { roughness: 0.85, emissive: 0x2a2418 }), trim = mat(0x7b4a2a, { roughness: 0.5 }), orange = mat(0xe0892e, { roughness: 0.5 }), mustard = mat(0xd8a634, { roughness: 0.5 });
  const dark = mat(0x22262a, { roughness: 0.6 }), chrome = mat(0xcfd3d6, { roughness: 0.25, metalness: 0.9 }), glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ map: cvTex(256, 256, (x, w, h) => { x.fillStyle = '#9a6a3e'; x.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(${90 + Math.random() * 40 | 0},${55 + Math.random() * 25 | 0},${30 + Math.random() * 15 | 0},.6)`; x.fillRect(0, i * 32, w, 30); x.fillStyle = 'rgba(40,25,10,.6)'; x.fillRect(0, i * 32 + 30, w, 2); } for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(60,35,15,.15)'; x.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 1); } }), roughness: 0.7, emissive: 0x1a120a });
  wood.map.wrapS = wood.map.wrapT = THREE.RepeatWrapping; wood.map.repeat.set(2, 6);
  const W = 1.25, Z0 = -4.5, T = 0.06;
  // chassis skirt and floor
  box(2 * W, 0.5, 7.2, body, 0, FL - 0.25, Z0 + 3.6, g); box(2 * W - 0.1, 0.04, CAB + 1.5 - Z0, wood, 0, FL + 0.02, (Z0 + CAB + 1.5) / 2, g);
  box(2 * W + 0.04, 0.14, 7.4, dark, 0, FL - 0.55, Z0 + 3.6, g);
  // living box: side walls with windows, door on the right (-x)
  const winL = [[-3.9, -2.6, FL + 1.05, FL + 1.65], [0.4, 2.2, FL + 1.05, FL + 1.7]], winR = [[-2.0, -1.2, FL + 1.05, FL + 1.65], [0.7, 2.3, FL + 1.0, FL + 1.7], [RVL.door[0] - 0.42, RVL.door[0] + 0.42, FL, FL + 1.92]];
  for (const [x, wins, m, t] of [[W - T / 2, winL, body, T], [-(W - T / 2), winR, body, T], [W - T - 0.02, winL, inner, 0.03], [-(W - T - 0.02), winR, inner, 0.03]]) wallHoles(g, m, 'x', x, t, Z0, CAB, FL, RT, wins);
  // rear wall with a window, front bulkhead above the cab opening
  wallHoles(g, body, 'z', Z0 + T / 2, T, -W, W, FL, RT, [[-0.5, 0.5, FL + 1.2, FL + 1.7]]); wallHoles(g, inner, 'z', Z0 + T + 0.02, 0.03, -W, W, FL, RT, [[-0.5, 0.5, FL + 1.2, FL + 1.7]]);
  box(2 * W, 0.1, CAB - Z0 + 1.7, body, 0, RT - 0.05, (Z0 + CAB + 1.7) / 2, g); box(2 * W - 0.14, 0.03, CAB - Z0, inner, 0, RT - 0.12, (Z0 + CAB) / 2, g);
  // cab-over bunk: the classic nose above the cab, with a little window
  box(2 * W, RT - (FL + 1.78), 1.72, body, 0, (RT + FL + 1.78) / 2, CAB + 0.86, g).castShadow = true;
  const nose = box(2 * W, 0.5, 0.5, body, 0, FL + 2.0, CAB + 1.85, g); nose.rotation.x = 0.5; box(1.2, 0.2, 0.02, glass, 0, FL + 2.06, CAB + 1.73, g);
  box(2 * W - 0.2, 0.18, 1.6, mat(0x5e7f9a, { roughness: 0.9 }), 0, FL + 1.88, CAB + 0.9, g); // bunk mattress
  // cab: doors with windows, windscreen, hood, grille, lights, bumper
  for (const sd of [1, -1]) { wallHoles(g, body, 'x', sd * (W - T / 2), T, CAB, 4.15, FL - 0.2, FL + 1.78, [[CAB + 0.35, 4.0, FL + 0.85, FL + 1.6]]); box(T, 0.04, 1.2, chrome, sd * (W + 0.01), FL + 0.6, CAB + 0.75, g); }
  const ws = box(2 * W - 0.1, 0.92, 0.03, glass, 0, FL + 1.3, 4.28, g); ws.rotation.x = -0.32; ws.castShadow = false;
  box(2 * W, 0.12, 0.25, body, 0, FL + 1.78, 4.05, g);
  const hood = box(2 * W - 0.04, 0.1, 0.9, body, 0, FL + 0.68, 4.62, g); hood.rotation.x = 0.12; box(2 * W, 0.95, 0.75, body, 0, FL + 0.18, 4.6, g);
  box(1.4, 0.42, 0.04, dark, 0, FL + 0.28, 4.99, g); for (let i = 0; i < 5; i++) box(1.36, 0.03, 0.05, chrome, 0, FL + 0.12 + i * 0.08, 5.0, g);
  for (const sd of [1, -1]) { box(0.3, 0.2, 0.05, mat(0xfff6d0, { emissive: 0xfff0c0, emissiveIntensity: 0.6 }), sd * 0.88, FL + 0.32, 5.0, g); box(0.22, 0.14, 0.05, mat(0xd02010, { emissive: 0x801008, emissiveIntensity: 0.8 }), sd * 1.05, FL + 0.5, Z0 - 0.02, g); }
  box(2 * W + 0.1, 0.22, 0.2, chrome, 0, FL - 0.35, 5.05, g); box(2 * W + 0.06, 0.2, 0.16, chrome, 0, FL - 0.32, Z0 - 0.08, g);
  // winch drum on the bumper
  cyl(0.11, 0.11, 0.5, dark, 0, FL - 0.22, 5.12, g).rotation.z = Math.PI / 2;
  // stripes: brown, orange, mustard sweep along both sides
  for (const sd of [1, -1]) { const x = sd * (W + 0.006); box(0.012, 0.14, 7.1, trim, x, FL + 0.62, Z0 + 3.6, g); box(0.012, 0.09, 7.1, orange, x, FL + 0.48, Z0 + 3.6, g); box(0.012, 0.06, 7.1, mustard, x, FL + 0.37, Z0 + 3.6, g); box(0.012, 0.14, 1.6, trim, x, FL + 0.62, CAB + 0.8, g); }
  // windows (glass)
  for (const [x, wins] of [[W, winL], [-W, winR.slice(0, 2)]]) for (const w of wins) { const p = box(0.01, w[3] - w[2], w[1] - w[0], glass, x, (w[2] + w[3]) / 2, (w[0] + w[1]) / 2, g); p.castShadow = false; }
  { const p = box(1, 0.5, 0.01, glass, 0, FL + 1.45, Z0, g); p.castShadow = false; }
  for (const sd of [1, -1]) { const p = box(0.01, 0.75, CAB - 3.45 + 0.1, glass, sd * W, FL + 1.22, (CAB + 0.35 + 4.0) / 2, g); p.castShadow = false; }
  // door leaf (swings open when someone is near)
  const door = new THREE.Group(); door.position.set(-W, 0, RVL.door[0] + 0.42); g.add(door); box(0.05, 1.9, 0.84, body, -0.02, FL + 0.96, -0.42, door); box(0.02, 0.45, 0.4, glass, -0.05, FL + 1.45, -0.42, door); box(0.04, 0.04, 0.14, chrome, -0.06, FL + 0.95, -0.72, door); box(0.012, 0.14, 0.84, trim, -0.05, FL + 0.62, -0.42, door);
  // ladder, roof rack and spare-wheel mount on the back
  for (const x of [RVL.ladder[0] - 0.22, RVL.ladder[0] + 0.22]) box(0.04, 2.6, 0.04, chrome, x, FL + 0.95, Z0 - 0.12, g);
  for (let i = 0; i < 7; i++) box(0.48, 0.03, 0.03, chrome, RVL.ladder[0], FL - 0.2 + i * 0.4, Z0 - 0.12, g);
  for (const x of [-1.05, 1.05]) box(0.04, 0.08, 6.2, chrome, x, RT + 0.08, -1.0, g);
  for (let i = 0; i < 5; i++) box(2.1, 0.04, 0.04, chrome, 0, RT + 0.1, -3.9 + i * 1.45, g);
  box(0.06, 0.06, 0.3, chrome, RVL.spare[0], RVL.spare[1], Z0 - 0.15, g);
  // ---- inside ----
  const cab = mat(0x3c3f44, { roughness: 0.8, emissive: 0x0b0b0c }), seatM = mat(0x8a5a3a, { roughness: 0.9, emissive: 0x150c06 }), counter = mat(0xd6c7a6, { roughness: 0.4, emissive: 0x201a10 }), cabinet = mat(0xa8784a, { roughness: 0.7, emissive: 0x1a1006 });
  const fb = (f, m, extra) => box(f[1] - f[0], f[4] - FL, f[3] - f[2], m, (f[0] + f[1]) / 2, (FL + f[4]) / 2, (f[2] + f[3]) / 2, g);
  const F = RVL.furn;
  fb(F[0], cabinet); box(F[0][1] - F[0][0] + 0.04, 0.04, F[0][3] - F[0][2], counter, (F[0][0] + F[0][1]) / 2 - 0.02, F[0][4] + 0.02, (F[0][2] + F[0][3]) / 2, g);
  box(0.36, 0.02, 0.4, chrome, 0.95, F[0][4] + 0.045, 0.75, g); for (const z of [1.55, 1.9]) cyl(0.08, 0.08, 0.02, dark, 0.95, F[0][4] + 0.05, z, g);
  fb(F[1], mat(0xe8e8e2, { roughness: 0.3, emissive: 0x202020 })); box(0.03, 0.4, 0.03, chrome, 0.6, FL + 1.1, -0.65, g);
  fb(F[2], counter); box(0.12, 0.7, 0.12, chrome, -0.88, FL + 0.37, 1.55, g); fb(F[3], seatM); fb(F[4], seatM);
  box(0.12, 0.5, 0.46, seatM, -1.18, FL + 0.72, 0.85, g); box(0.12, 0.5, 0.46, seatM, -1.18, FL + 0.72, 2.25, g);
  fb(F[5], mat(0xd8d2c4, { roughness: 0.6, emissive: 0x1c1a16 })); box(0.02, 1.8, 0.6, cabinet, -0.29, FL + 0.95, -3.8, g);
  fb(F[6], cabinet); box(1.2, 0.16, 1.95, mat(0x4f6f8e, { roughness: 0.95, emissive: 0x0a0f14 }), 0.63, F[6][4] + 0.08, -3.45, g); box(0.5, 0.1, 0.32, mat(0xf0ede4, { roughness: 0.95 }), 0.63, F[6][4] + 0.21, -4.15, g);
  box(1.25, 0.5, 0.35, cabinet, 0.63, RT - 0.4, -3.5, g); box(0.55, 0.5, 2.0, cabinet, 0.97, RT - 0.4, 1.2, g); // overhead lockers
  for (const sd of [0, 1]) { const f = F[7 + sd]; fb(f, seatM); box(f[1] - f[0], 0.75, 0.14, seatM, (f[0] + f[1]) / 2, f[4] + 0.38, f[2] + 0.07, g).rotation.x = -0.12; }
  fb(F[9], cab); box(2.4, 0.2, 0.5, cab, 0, F[9][4] + 0.05, 4.0, g).rotation.x = -0.3;
  // dashboard bits: gauges, the radio, steering wheel (turns), gear lever
  const gauges = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: cvTex(256, 96, (x, w, h) => { x.fillStyle = '#111'; x.fillRect(0, 0, w, h); for (const [cx, l] of [[64, 'MPH'], [192, 'FUEL']]) { x.strokeStyle = '#ddd'; x.lineWidth = 3; x.beginPath(); x.arc(cx, 52, 38, Math.PI * 0.8, Math.PI * 2.2); x.stroke(); x.fillStyle = '#ddd'; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText(l, cx, 82); } }) }));
  gauges.position.set(0.6, F[9][4] + 0.12, 3.86); gauges.rotation.y = Math.PI; gauges.rotation.x = 0.3; g.add(gauges);
  const radio = box(0.32, 0.1, 0.06, mat(0x222222, { emissive: 0x331a00 }), RVL.radio[0], RVL.radio[1], RVL.radio[2] - 0.12, g); const rled = box(0.2, 0.03, 0.01, mat(0xff9a30, { emissive: 0xff8a20, emissiveIntensity: 0.2 }), RVL.radio[0], RVL.radio[1] + 0.01, RVL.radio[2] - 0.155, g);
  const steer = new THREE.Group(); steer.position.set(0.6, FL + 0.98, 3.66); steer.rotation.x = -0.45 + Math.PI / 2; g.add(steer);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 8, 24), dark); steer.add(ring); for (const a of [0, 2.1, 4.2]) { const sp = box(0.2, 0.025, 0.02, dark, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0, steer); sp.rotation.z = a; }
  cyl(0.03, 0.03, 0.5, dark, 0.6, FL + 0.85, 3.78, g).rotation.x = -0.45; cyl(0.015, 0.015, 0.3, chrome, 0.2, FL + 0.55, 3.55, g);
  // rug, curtains, a picture: it's a home
  box(0.5, 0.01, 3.4, mat(0xa0453a, { roughness: 1, emissive: 0x200806 }), 0, FL + 0.05, -0.6, g);
  for (const z of [-3.9, -2.6, 0.4, 2.2]) box(0.02, 0.62, 0.14, mat(0xd96a3a, { roughness: 1, emissive: 0x200c06 }), 1.17, FL + 1.38, z, g);
  // warm interior light
  const lamp = new THREE.PointLight(0xffe2b0, 1.4, 7, 1.2); lamp.position.set(0, RT - 0.35, -0.5); g.add(lamp);
  // wheels
  const tyreM = mat(0x1d1d1d, { roughness: 0.9 }), hubM = mat(0xd0d0cc, { roughness: 0.3, metalness: 0.8 });
  const wheels = wheelsOf(RVSPEC).map((a, i) => { const w = new THREE.Group(), sp = new THREE.Group(); w.add(sp); const t = cyl(RVSPEC.r, RVSPEC.r, i < 2 ? 0.28 : 0.42, tyreM, 0, 0, 0, sp, 20); t.rotation.z = Math.PI / 2; const h = cyl(0.22, 0.22, i < 2 ? 0.3 : 0.44, hubM, 0, 0, 0, sp, 10); h.rotation.z = Math.PI / 2; box(0.46, 0.05, 0.05, hubM, 0, 0, 0, sp); w.position.set(a[0], a[1], a[2]); w.userData = { a, sp }; g.add(w); return w; });
  // wheel arches
  for (const a of wheelsOf(RVSPEC)) box(0.08, 0.1, 1.15, dark, Math.sign(a[0]) * (W + 0.02), FL - 0.02, a[2], g);
  // the spare and the hook live as items, drawn by the game
  return { g, wheels, steer, door, rled, lamp };
}
// ---------- crew avatars ----------
const CREW_COL = [0xe24a3a, 0x3a7be2, 0x3ab86a, 0xe2b23a, 0xa05ae2, 0xe27ab8, 0x3ac4d0, 0xf07a20];
function buildAvatar(col, name) {
  const g = new THREE.Group(), shirt = mat(col, { roughness: 0.8 }), skin = mat(0xe0b090, { roughness: 0.7 }), pants = mat(0x2e3a52, { roughness: 0.9 }), shoe = mat(0x222222);
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  for (const [lg, x] of [[legL, 0.11], [legR, -0.11]]) { lg.position.set(x, 0.86, 0); box(0.15, 0.82, 0.18, pants, 0, -0.41, 0, lg); box(0.16, 0.08, 0.26, shoe, 0, -0.82, 0.04, lg); g.add(lg); }
  box(0.42, 0.56, 0.24, shirt, 0, 1.15, 0, g);
  for (const [am, x] of [[armL, 0.28], [armR, -0.28]]) { am.position.set(x, 1.4, 0); box(0.12, 0.56, 0.13, shirt, 0, -0.26, 0, am); box(0.1, 0.1, 0.1, skin, 0, -0.56, 0, am); g.add(am); }
  const head = new THREE.Group(); head.position.set(0, 1.5, 0); g.add(head); box(0.26, 0.28, 0.26, skin, 0, 0.12, 0, head); box(0.29, 0.07, 0.29, shirt, 0, 0.29, 0, head); box(0.27, 0.03, 0.14, shirt, 0, 0.26, 0.18, head);
  box(0.05, 0.04, 0.02, mat(0x111111), 0.06, 0.15, 0.13, head); box(0.05, 0.04, 0.02, mat(0x111111), -0.06, 0.15, 0.13, head);
  const tc = document.createElement('canvas'); tc.width = 256; tc.height = 64; const x = tc.getContext('2d'); x.fillStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.roundRect(8, 8, 240, 48, 20); x.fill(); x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.beginPath(); x.arc(34, 32, 10, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 28px system-ui'; x.textBaseline = 'middle'; x.fillText(name.slice(0, 12), 54, 33);
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace; const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tt, depthTest: false, transparent: true })); tag.scale.set(1.2, 0.3, 1); tag.position.y = 2.15; tag.renderOrder = 9; g.add(tag);
  const hand = new THREE.Group(); hand.position.set(0, -0.6, 0.08); armR.add(hand);
  return { g, legL, legR, armL, armR, head, hand, tag, ph: 0 };
}
// ---------- items ----------
function itemMesh(k) {
  const g = new THREE.Group();
  if (k === 'remote') { box(0.09, 0.16, 0.04, mat(0xf2c21a, { roughness: 0.5 }), 0, 0, 0, g); box(0.04, 0.03, 0.015, mat(0x30c030, { emissive: 0x104010 }), 0, 0.035, 0.025, g); box(0.04, 0.03, 0.015, mat(0xd02020, { emissive: 0x401010 }), 0, -0.015, 0.025, g); cyl(0.006, 0.006, 0.16, mat(0x222222), 0.03, 0.15, 0, g); box(0.14, 0.03, 0.03, mat(0x222222), 0, -0.1, 0, g); }
  else if (k === 'can') { box(0.3, 0.42, 0.16, mat(0xc8231a, { roughness: 0.45, metalness: 0.2 }), 0, 0, 0, g); box(0.2, 0.05, 0.05, mat(0x222222), 0, 0.24, 0, g); cyl(0.03, 0.03, 0.08, mat(0x222222), 0.11, 0.23, 0, g); }
  else if (k === 'tyre') { const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 10, 22), mat(0x1d1d1d, { roughness: 0.9 })); t.castShadow = true; g.add(t); cyl(0.22, 0.22, 0.18, mat(0xd0d0cc, { metalness: 0.8, roughness: 0.3 }), 0, 0, 0, g, 12).rotation.x = Math.PI / 2; }
  else if (k === 'dyn') { for (const x of [-0.04, 0.04, 0]) cyl(0.035, 0.035, 0.3, mat(0xb8201a, { roughness: 0.6 }), x, 0, x === 0 ? 0.05 : 0, g, 8); box(0.13, 0.04, 0.1, mat(0x222222), 0, 0, 0.02, g); cyl(0.006, 0.006, 0.1, mat(0xe0d0a0), 0, 0.2, 0.02, g); const sp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd060 })); sp.position.set(0, 0.25, 0.02); sp.visible = false; g.add(sp); g.userData.spark = sp; }
  else if (k === 'duck') { const y = mat(0xf7d21e, { roughness: 0.4 }); const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), y); b.scale.set(1, 0.8, 1.25); g.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), y); h.position.set(0, 0.09, 0.07); g.add(h); box(0.06, 0.02, 0.06, mat(0xf07a10), 0, 0.08, 0.14, g); for (const x of [0.03, -0.03]) box(0.015, 0.015, 0.01, mat(0x111111), x, 0.11, 0.125, g); }
  else if (k === 'hook') { const m = mat(0x8c9196, { metalness: 0.85, roughness: 0.35 }); const t = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14, Math.PI * 1.4), m); t.rotation.z = -0.8; g.add(t); box(0.04, 0.12, 0.04, m, 0, 0.12, 0, g); box(0.07, 0.03, 0.03, mat(0xe0b020), 0, 0.17, 0, g); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const ITEM_NAME = { remote: 'winch remote', can: 'jerry can', tyre: 'spare wheel', dyn: 'dynamite', duck: 'rubber duck', hook: 'winch hook' };
// ---------- signs ----------
function sign(scene, x, y, z, h, lines, opt) {
  opt = opt || {}; const w = opt.w || 2.4, ht = opt.h || 1.2, bg = opt.bg || '#f4efe2', fg = opt.fg || '#2a2218';
  const t = cvTex(512, Math.round(512 * ht / w), (c, W, H) => { c.fillStyle = bg; c.fillRect(0, 0, W, H); c.strokeStyle = fg; c.lineWidth = 10; c.strokeRect(10, 10, W - 20, H - 20); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const n = lines.length;
    lines.forEach((l, i) => { const big = i === 0 && n > 1, fs = Math.min(big ? 70 : 46, (H - 30) / n * (big ? 0.8 : 0.66)); c.font = (big ? '900 ' : '700 ') + fs + 'px system-ui,sans-serif'; c.fillText(l, W / 2, 20 + (H - 40) * (i + 0.5) / n, W - 40); }); });
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = h;
  const bd = new THREE.Mesh(new THREE.BoxGeometry(w, ht, 0.06), [mat(0x6b4a2a), mat(0x6b4a2a), mat(0x6b4a2a), mat(0x6b4a2a), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })]);
  bd.position.y = (opt.post || 1.4) + ht / 2; bd.castShadow = true; g.add(bd);
  for (const sx of [-w / 2 + 0.15, w / 2 - 0.15]) cyl(0.06, 0.06, (opt.post || 1.4) + ht, mat(0x5a3d22), sx, ((opt.post || 1.4) + ht) / 2, -0.06, g, 6);
  scene.add(g); return g;
}
// ---------- the set pieces ----------
function buildSet(scene, S) {
  const out = {}, P = (s, lat) => S.sideP(s, lat), A = S.sAll, HW = S.HW;
  const wood = mat(0x8a6038, { roughness: 0.85 }), dwood = mat(0x5e4024, { roughness: 0.9 }), white = mat(0xeeeae0), red = mat(0xa8322a, { roughness: 0.8 }), steel = mat(0x6f767c, { metalness: 0.6, roughness: 0.45 }), conc = mat(0xa9a59c, { roughness: 0.95 }), yel = mat(0xf0c020, { roughness: 0.6 });
  S.pbox = []; // oriented boxes the crew can't walk through: {x, z, h, a (half along), b (half across), y0, y1}
  // a solid box in the world: drawn, walked into, and driven into
  const solid = (x, z, h, a, b, y0, y1, m, noCar) => { const o = box(2 * b, y1 - y0, 2 * a, m, x, (y0 + y1) / 2, z, scene); o.rotation.y = h; S.pbox.push({ x, z, h, a, b, y0, y1 }); if (!noCar) { const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h); for (let u = -a; u <= a + 0.01; u += 1) for (const v of [-b, b]) S.addT({ x: x + fx * u + rx * v, z: z + fz * u + rz * v, y: y0, kind: 8, r: 0.5 }); for (let v = -b; v <= b + 0.01; v += 1) for (const u of [-a, a]) S.addT({ x: x + fx * u + rx * v, z: z + fz * u + rz * v, y: y0, kind: 8, r: 0.5 }); } return o; };
  const at3 = (p, du, dv) => ({ x: p.x + Math.sin(p.h) * du - Math.cos(p.h) * dv, z: p.z + Math.cos(p.h) * du + Math.sin(p.h) * dv });
  const roofGable = (x, y, z, h, len, wid, ht, m) => { const sh = new THREE.Shape(); sh.moveTo(-wid / 2 - 0.3, 0); sh.lineTo(wid / 2 + 0.3, 0); sh.lineTo(0, ht); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: len + 0.6, bevelEnabled: false }); g.translate(0, 0, -(len + 0.6) / 2); const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = h; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
  // ---- Grandma's farm ----
  { const f = S.farm, hp = at3(f, -8, -4), bp = at3(f, 14, -2);
    solid(hp.x, hp.z, f.h, 5, 4, f.y - 0.5, f.y + 3.2, white); roofGable(hp.x, f.y + 3.2, hp.z, f.h + Math.PI / 2, 10, 8, 2.4, mat(0x6a3a2a));
    for (const du of [-2.5, 2.5]) { const wp = at3(f, -8 + du, -4 + 4.02); box(1.1, 1.0, 0.05, mat(0x88aacc, { roughness: 0.1 }), 0, 0, 0, scene).position.set(wp.x, f.y + 1.6, wp.z); }
    solid(bp.x, bp.z, f.h, 7, 5.5, f.y - 0.5, f.y + 4.5, red); roofGable(bp.x, f.y + 4.5, bp.z, f.h, 14, 11, 3.2, mat(0x4a4a4a));
    const mb = at3(f, -2, 8); cyl(0.05, 0.05, 1.1, dwood, mb.x, f.y + 0.55, mb.z, scene); box(0.3, 0.25, 0.5, mat(0x2d5aa0), mb.x, f.y + 1.2, mb.z, scene).rotation.y = f.h;
    const sp = P(A.start + 30, HW + 2); sign(scene, sp.x, S.heightAt(sp.x, sp.z), sp.z, sp.h + Math.PI, ['LAKESIDE CAMP  3 km', 'Bridge out? Ask Pete.'], { w: 2.6, h: 1.1 });
    for (let s = A.start + 14; s < A.start + 360; s += 3.2) for (const sd of [-1, 1]) { const o = P(s, sd * (HW + 3)), y = S.heightAt(o.x, o.z); cyl(0.06, 0.07, 1.1, dwood, o.x, y + 0.5, o.z, scene, 5); const o2 = P(s + 1.6, sd * (HW + 3)); const r = box(0.05, 0.08, 3.2, wood, (o.x + o2.x) / 2, y + 0.85, (o.z + o2.z) / 2, scene); r.rotation.y = o.h; }
  }
  // ---- logging yard and the fallen tree ----
  { const y = S.yard; for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) { const p = at3(y, -6 + i * 0, 7.5); const lg = cyl(0.32, 0.32, 7, mat(0x6b4b2e), 0, 0, 0, scene, 10); lg.rotation.set(0, y.h, Math.PI / 2); const q = at3(y, -10 + j * 0.66 + i * 0.33, 8.5); lg.position.set(q.x, y.y + 0.32 + i * 0.56, q.z); lg.rotation.y = y.h + Math.PI / 2; lg.rotation.z = Math.PI / 2; lg.rotation.order = 'YXZ'; }
    const sp = at3(y, 10, 9); sign(scene, sp.x, y.y, sp.z, y.h - Math.PI / 2, ['LOGGING YARD', 'turning area'], { w: 2.2, h: 1 });
    const wp = P(A.log - 60, -(HW + 1.8)); sign(scene, wp.x, S.heightAt(wp.x, wp.z), wp.z, wp.h + Math.PI, ['TREE DOWN AHEAD', 'winch it into the yard'], { bg: '#f0c020' });
  }
  const bark = new THREE.MeshStandardMaterial({ map: World.PH.bark || null, color: World.PH.bark ? 0xffffff : 0x6b4b2e, roughness: 1 });
  if (bark.map) { bark.map = bark.map.clone(); bark.map.needsUpdate = true; bark.map.repeat.set(1, 6); }
  { const g = new THREE.Group(), L0 = S.log.len; const t = cyl(S.log.rad * 0.8, S.log.rad, L0, bark, 0, 0, 0, g, 14); t.rotation.z = Math.PI / 2; t.position.x = 0;
    const rb = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 1), mat(0x4a3826, { roughness: 1 })); rb.scale.set(0.5, 1, 1); rb.position.x = L0 / 2 + 0.3; g.add(rb);
    for (let i = 0; i < 6; i++) { const b = cyl(0.05, 0.1, 2.2, bark, -L0 / 2 + 1 + i * 1.4, 0.5, (i % 2 ? 1 : -1) * 0.5, g, 6); b.rotation.set(i % 2 ? 0.9 : -0.9, 0, 0.5); }
    const crown = new THREE.Mesh(World.foliage(mulberry(3), 4, -1, 4, 2.6, 0.6, 0.3), mat(0x3d5a2a, { vertexColors: true, roughness: 0.95 })); crown.rotation.z = Math.PI / 2; crown.position.x = -L0 / 2 - 1.5; g.add(crown);
    g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); scene.add(g); out.log = g; }
  // ---- mud hill: dark mud, puddles, winch posts ----
  const mm = S.at((A.mud0 + A.mud1) / 2); for (const t of World.tiles) if (Math.hypot(t.cx - mm.x, t.cz - mm.z) < 160) for (const o of t.objs) { const gg = o.geometry; if (!gg || !gg.attributes.aRoad) continue; const p = gg.attributes.position, c = gg.attributes.color; let ch = false;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), q = S.near(x, z, 14); if (!q || q.s < A.mud0 - 12 || q.s > A.mud1 + 4 || q.d > HW + 5) continue; const k = (1 - sstep(HW + 2, HW + 7, q.d)) * sstep(A.mud0 - 12, A.mud0, q.s) * (1 - sstep(A.mud1 - 4, A.mud1 + 4, q.s)) * (0.85 + 0.15 * S.noise(x * 0.3, z * 0.3)); c.setXYZ(i, lerp(c.getX(i), 0.2, k), lerp(c.getY(i), 0.14, k), lerp(c.getZ(i), 0.08, k)); ch = true; }
    if (ch) c.needsUpdate = true; }
  { const pm = new THREE.MeshStandardMaterial({ color: 0x2e2416, roughness: 0.05, metalness: 0.3 }); const r = mulberry(8); for (let i = 0; i < 34; i++) { const s = lerp(A.mud0 - 8, A.mud1, r()), p = P(s, (r() - 0.5) * 2 * (HW + 0.5)); const m = new THREE.Mesh(new THREE.CircleGeometry(0.8 + r() * 1.6, 14), pm); m.rotation.x = -Math.PI / 2; m.scale.y = 0.6 + r() * 0.5; m.position.set(p.x, S.heightAt(p.x, p.z) + 0.04, p.z); scene.add(m); } }
  for (const p of S.posts) { cyl(0.28, 0.32, 1.6, wood, p.x, p.y + 0.8, p.z, scene, 10); for (let i = 0; i < 3; i++) cyl(0.33, 0.33, 0.12, i % 2 ? mat(0x222222) : yel, p.x, p.y + 0.95 + i * 0.13, p.z, scene, 10); }
  { const sp = P(A.mud0 - 30, HW + 1.8); sign(scene, sp.x, S.heightAt(sp.x, sp.z), sp.z, sp.h + Math.PI, ['STEEP + MUDDY', 'winch posts on the way up'], { bg: '#f0c020' }); }
  // ---- Pete's Gas ----
  { const gp = S.gas, base = gp.y; const sh = at3(gp, 10, -10); // shop: back wall away from the road, door facing it
    const SH = { x: sh.x, z: sh.z, h: gp.h }; const fx = Math.sin(gp.h), fz = Math.cos(gp.h), rx = -Math.cos(gp.h), rz = Math.sin(gp.h), Wp = (du, dv) => ({ x: sh.x + fx * du + rx * dv, z: sh.z + fz * du + rz * dv });
    const wallM = mat(0xd9cfb8, { roughness: 0.9 }); let q;
    q = Wp(0, -4.9); solid(q.x, q.z, gp.h, 6, 0.15, base, base + 3.2, wallM);
    q = Wp(-5.9, 0); solid(q.x, q.z, gp.h, 0.15, 5, base, base + 3.2, wallM); q = Wp(5.9, 0); solid(q.x, q.z, gp.h, 0.15, 5, base, base + 3.2, wallM);
    q = Wp(-3.6, 4.9); solid(q.x, q.z, gp.h, 2.4, 0.15, base, base + 3.2, wallM); q = Wp(3.6, 4.9); solid(q.x, q.z, gp.h, 2.4, 0.15, base, base + 3.2, wallM);
    q = Wp(0, 4.9); box(2.4, 0.9, 0.3, wallM, 0, 0, 0, scene).position.set(q.x, base + 2.75, q.z); scene.children[scene.children.length - 1].rotation.y = gp.h;
    { const r = box(10.4, 0.2, 12.4, mat(0x5a4a3a), sh.x, base + 3.3, sh.z, scene); r.rotation.y = gp.h; const fl = box(11.8, 0.06, 9.8, mat(0x9a8e7e), sh.x, base + 0.03, sh.z, scene); fl.rotation.y = gp.h; fl.castShadow = false; }
    const ip = new THREE.PointLight(0xfff0d0, 2, 12, 1.3); ip.position.set(sh.x, base + 2.8, sh.z); scene.add(ip);
    for (const du of [-4, 0, 4]) { q = Wp(du, -3.9); const sf = box(0.5, 1.8, 3, mat(0x7a6a5a), q.x, base + 0.9, q.z, scene); sf.rotation.y = gp.h; S.pbox.push({ x: q.x, z: q.z, h: gp.h, a: 1.5, b: 0.25, y0: base, y1: base + 1.8 }); for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) { const b2 = box(0.2, 0.25, 0.2, mat([0xd04030, 0x3060c0, 0xe0c030, 0x40a050][(i + j + du) & 3]), 0, 0, 0, scene); const qq = Wp(du - 1.2 + j * 0.6, -3.75); b2.position.set(qq.x, base + 0.45 + i * 0.6, qq.z); } }
    q = Wp(3.5, 1.5); const ct = box(3, 1, 1, mat(0x6a5038), q.x, base + 0.5, q.z, scene); ct.rotation.y = gp.h; S.pbox.push({ x: q.x, z: q.z, h: gp.h, a: 0.5, b: 1.5, y0: base, y1: base + 1 });
    out.shopSpots = [Wp(-3.5, -2.6), Wp(-2.3, -2.6), Wp(-1.1, -2.6), Wp(-4.2, 1.5)].map(p => [p.x, base, p.z]);
    // forecourt: canopy and dead pumps
    const cp = at3(gp, 0, 7); for (const [du, dv] of [[-6, -3], [6, -3], [-6, 3], [6, 3]]) { const pq = at3(gp, du, 7 + dv); cyl(0.18, 0.18, 4.4, white, pq.x, base + 2.2, pq.z, scene, 8); S.pbox.push({ x: pq.x, z: pq.z, h: gp.h, a: 0.2, b: 0.2, y0: base, y1: base + 4.4 }); S.addT({ x: pq.x, z: pq.z, y: base, kind: 8, r: 0.3 }); }
    const can = box(9, 0.5, 14, mat(0xc42a1e), cp.x, base + 4.6, cp.z, scene); can.rotation.y = gp.h;
    for (const du of [-3, 3]) { const pq = at3(gp, du, 7); const pmp = box(0.7, 1.7, 0.5, mat(0xe8e0c8), pq.x, base + 0.85, pq.z, scene); pmp.rotation.y = gp.h; S.pbox.push({ x: pq.x, z: pq.z, h: gp.h, a: 0.3, b: 0.4, y0: base, y1: base + 1.7 }); S.addT({ x: pq.x, z: pq.z, y: base, kind: 8, r: 0.5 }); sign(scene, pq.x + rx * 0.01, base, pq.z, gp.h + Math.PI / 2, ['OUT OF', 'ORDER'], { w: 0.6, h: 0.4, post: 1.0, bg: '#ffffff', fg: '#c01010' }); }
    const ps = at3(gp, -14, 9); sign(scene, ps.x, base, ps.z, gp.h - Math.PI / 2, ["PETE'S GAS", 'pumps broken · cans inside'], { w: 3.2, h: 1.6, post: 2.6, bg: '#c42a1e', fg: '#fff6e0' });
  }
  // ---- the drawbridge, the river, the footbridge, the crank ----
  { const p = S.at(A.br), fx = Math.sin(p.h), fz = Math.cos(p.h), rx = -Math.cos(p.h), rz = Math.sin(p.h), dy = S.deckY, half = 10.5;
    const leaf = new THREE.Group(), hinge = new THREE.Group(); hinge.position.set(p.x + fx * half, dy, p.z + fz * half); hinge.rotation.y = p.h; scene.add(hinge); hinge.add(leaf);
    const plank = new THREE.MeshStandardMaterial({ map: cvTex(128, 512, (x, w, h) => { for (let i = 0; i < 32; i++) { x.fillStyle = `rgb(${120 + Math.random() * 30 | 0},${82 + Math.random() * 20 | 0},${50 + Math.random() * 12 | 0})`; x.fillRect(0, i * 16, w, 15); x.fillStyle = '#3a2814'; x.fillRect(0, i * 16 + 15, w, 1); } }), roughness: 0.85 });
    box(2 * HW + 0.8, 0.25, 2 * half, plank, 0, -0.125, -half, leaf); for (const sd of [-1, 1]) { box(0.3, 0.8, 2 * half, steel, sd * (HW + 0.55), 0.2, -half, leaf); for (let u = 0; u <= 2 * half; u += 2.5) box(0.08, 1.0, 0.08, steel, sd * (HW + 0.55), 0.9, -u, leaf); box(0.08, 0.08, 2 * half, steel, sd * (HW + 0.55), 1.4, -half, leaf); }
    leaf.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    // counterweight towers and abutments
    for (const sd of [-1, 1]) for (const e of [-1, 1]) { const q = { x: p.x + fx * e * (half + 1.2) + rx * sd * (HW + 1.6), z: p.z + fz * e * (half + 1.2) + rz * sd * (HW + 1.6) }; solid(q.x, q.z, p.h, 0.6, 0.6, dy - 8, dy + (e > 0 ? 5 : 1.2), conc); }
    for (const e of [-1, 1]) { const q = { x: p.x + fx * e * (half + 1.5), z: p.z + fz * e * (half + 1.5) }; const ab = box(2 * HW + 2, 9, 3, conc, q.x, dy - 4.6, q.z, scene); ab.rotation.y = p.h; }
    { const q = { x: p.x + fx * (half + 1.2), z: p.z + fz * (half + 1.2) }; const bm = box(2 * HW + 4.4, 0.6, 0.6, steel, q.x, dy + 5.2, q.z, scene); bm.rotation.y = p.h; }
    out.bridge = { hinge, leaf, half, p };
    // crank on the far side
    const cq = { x: p.x + fx * (half + 4) + rx * (HW + 2.4), z: p.z + fz * (half + 4) + rz * (HW + 2.4) }, cy = S.heightAt(cq.x, cq.z);
    cyl(0.12, 0.15, 1.1, steel, cq.x, cy + 0.55, cq.z, scene); const wh = new THREE.Group(); wh.position.set(cq.x, cy + 1.15, cq.z); wh.rotation.y = p.h; scene.add(wh); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 20), red); wh.add(ring); for (const a of [0, 1.05, 2.1]) { const sp = box(0.9, 0.04, 0.04, red, 0, 0, 0, wh); sp.rotation.z = a; } box(0.06, 0.06, 0.25, dwood, 0.45, 0, 0.12, wh);
    out.crank = { x: cq.x, y: cy + 1.1, z: cq.z, wh };
    const hq = { x: p.x + fx * (half + 7.5) + rx * (HW + 4.5), z: p.z + fz * (half + 7.5) + rz * (HW + 4.5) }, hy = S.heightAt(hq.x, hq.z); solid(hq.x, hq.z, p.h, 1.6, 1.4, hy - 0.5, hy + 2.6, mat(0x5f7f5a)); roofGable(hq.x, hy + 2.6, hq.z, p.h + Math.PI / 2, 2.8, 3.2, 1, mat(0x3a3a3a));
    sign(scene, p.x - fx * (half + 24) - rx * (HW + 2), S.heightAt(p.x - fx * (half + 24) - rx * (HW + 2), p.z - fz * (half + 24) - rz * (HW + 2)), p.z - fz * (half + 24) - rz * (HW + 2), p.h + Math.PI, ['BRIDGE RAISED', 'operator out fishing', 'footbridge upstream · crank on far side'], { w: 3, h: 1.6, bg: '#f0c020' });
    // footbridge for people, upstream on the left
    const fl = -32, e0 = { x: p.x - fx * 15 + rx * fl, z: p.z - fz * 15 + rz * fl }, e1 = { x: p.x + fx * 15 + rx * fl, z: p.z + fz * 15 + rz * fl }, y0 = S.terrainAt(e0.x, e0.z), y1 = S.terrainAt(e1.x, e1.z);
    out.foot = { x0: e0.x, z0: e0.z, x1: e1.x, z1: e1.z, y0, y1, w: 0.75, fx, fz };
    for (let u = 0; u <= 30; u += 0.5) { const t = u / 30, x = lerp(e0.x, e1.x, t), z = lerp(e0.z, e1.z, t), y = lerp(y0, y1, t) - Math.sin(t * Math.PI) * 0.5; const pl = box(1.4, 0.06, 0.4, wood, x, y, z, scene); pl.rotation.y = p.h; if (u % 3 === 0) for (const sd of [-0.7, 0.7]) cyl(0.04, 0.04, 1.0, dwood, x + rx * sd, y + 0.5, z + rz * sd, scene, 5); }
    for (const sd of [-0.7, 0.7]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 30.5, 4), mat(0xc8b080)); r.position.set((e0.x + e1.x) / 2 + rx * sd, (y0 + y1) / 2 + 0.75, (e0.z + e1.z) / 2 + rz * sd); r.rotation.order = 'YXZ'; r.rotation.y = p.h; r.rotation.x = Math.PI / 2; scene.add(r); }
    S.addT({ x: e0.x, z: e0.z, y: y0, kind: 8, r: 0.5 }); S.addT({ x: e1.x, z: e1.z, y: y1, kind: 8, r: 0.5 });
  }
  // river water: a strip along its wiggly centreline
  { const R = S.river, pos = [], idx = []; let n = 0; for (let u = -900; u <= 900; u += 8) { const wig = (9 * Math.sin(u * 0.011) + 5 * Math.sin(u * 0.027 + 1)) * sstep(30, 120, Math.abs(u)), cx = R.x + R.dx * u + R.dz * wig, cz = R.z + R.dz * u - R.dx * wig; for (const sd of [-1, 1]) pos.push(cx + R.dz * sd * 15, R.water, cz - R.dx * sd * 15); if (n) idx.push(n * 2 - 2, n * 2 - 1, n * 2, n * 2 - 1, n * 2 + 1, n * 2); n++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); const wm = new THREE.MeshStandardMaterial({ color: 0x3f6c74, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86, side: THREE.DoubleSide }); const m = new THREE.Mesh(g, wm); m.receiveShadow = true; scene.add(m); out.water = wm; }
  { const Lk = S.lake, g = new THREE.CircleGeometry(1, 64); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, out.water); m.scale.set(560 * 1.2, 1, Lk.half * 1.6); m.rotation.y = Math.atan2(Lk.fx, Lk.fz); m.position.set(Lk.x, Lk.water, Lk.z); m.receiveShadow = true; scene.add(m); }
  // ---- cliff road: work site, explosives, rockslide ----
  { const w = S.work, tp = at3(w, 2, -2.2); const tr = solid(tp.x, tp.z, w.h, 3.2, 1.3, w.y + 0.4, w.y + 3, mat(0xe8e2d0)); box(0.1, 0.4, 6.2, mat(0xe07a20), 0, 0, 0, scene).position.set(0, -100, 0);
    for (const du of [-2.2, 2.2]) { const wq = at3(w, du, -2.2 + 1.32); const ww = cyl(0.35, 0.35, 0.25, mat(0x1d1d1d), wq.x, w.y + 0.35, wq.z, scene, 12); ww.rotation.set(0, w.h, Math.PI / 2); ww.rotation.order = 'YXZ'; }
    const cq = at3(w, -5, 2.2); out.crate = { x: cq.x, y: w.y, z: cq.z }; const cr = box(0.9, 0.6, 0.6, mat(0x8a6a3a), cq.x, w.y + 0.3, cq.z, scene); cr.rotation.y = w.h; S.pbox.push({ x: cq.x, z: cq.z, h: w.h, a: 0.3, b: 0.45, y0: w.y, y1: w.y + 0.6 });
    sign(scene, cq.x + 0.01, w.y, cq.z + 0.01, w.h + Math.PI / 2, ['DANGER', 'EXPLOSIVES'], { w: 0.9, h: 0.5, post: 0.62, bg: '#c01010', fg: '#fff' });
    for (const du of [-6, -3, 3, 6]) { const cn = at3(w, du, 6.4); const c = cyl(0.03, 0.2, 0.7, mat(0xf07010), cn.x, w.y + 0.35, cn.z, scene, 10); }
    const sp = P(A.rk - 50, HW + 1.6); sign(scene, sp.x, S.heightAt(sp.x, sp.z), sp.z, sp.h + Math.PI, ['ROAD CLOSED', 'rockfall · use the dynamite at the work site', 'then RUN'], { w: 3.2, h: 1.6, bg: '#e07a20', fg: '#1a1208' });
    const rockM = new THREE.MeshStandardMaterial({ map: World.PH.floor || null, color: 0xa09080, roughness: 0.95 });
    out.boulders = S.boulders.map((b, i) => { const g = new THREE.DodecahedronGeometry(1, 1), pp = g.attributes.position; for (let k = 0; k < pp.count; k++) { const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k), f = 0.82 + 0.3 * S.noise(x * 2 + i * 7, z * 2 + y); pp.setXYZ(k, x * f, y * f * 0.8, z * f); } g.computeVertexNormals(); const m = new THREE.Mesh(g, rockM); m.scale.setScalar(b.r); m.position.set(b.x, b.y + b.r * 0.55, b.z); m.rotation.y = i; m.castShadow = m.receiveShadow = true; scene.add(m); return m; });
    // debris left after the blast: sharp shards across the road
    const dg = new THREE.TetrahedronGeometry(0.22, 0), r = mulberry(31), n = 220, dm = new THREE.InstancedMesh(dg, rockM, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const p = P(lerp(S.debris.s0, S.debris.s1, r()), (r() - 0.5) * 2 * (HW + 1)); e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e); const s = 0.5 + r() * 1.3; sc.set(s, s * 0.7, s); v.set(p.x, S.terrainAt(p.x, p.z) + 0.06, p.z); m4.compose(v, q, sc); dm.setMatrixAt(i, m4); }
    dm.castShadow = true; dm.visible = false; dm.computeBoundingSphere(); scene.add(dm); out.debris = dm;
  }
  // ---- the ferry: piers, raft with a crank, cable across ----
  { const d0 = S.at(A.dock0), d1 = S.at(A.dock1), fy = S.ferryY;
    for (const [d, sg] of [[d0, -1], [d1, 1]]) { const fx = Math.sin(d.h), fz = Math.cos(d.h); for (let u = 0; u < 14; u += 0.6) { const x = d.x + fx * sg * u, z = d.z + fz * sg * u; const pl = box(2 * HW + 0.6, 0.12, 0.55, mat(0x7a5634), x, fy - 0.06, z, scene); pl.rotation.y = d.h; } for (let u = 1; u < 14; u += 3) for (const sd of [-1, 1]) cyl(0.15, 0.15, 6, dwood, d.x + fx * sg * u - Math.cos(d.h) * sd * (HW + 0.2), fy - 3, d.z + fz * sg * u + Math.sin(d.h) * sd * (HW + 0.2), scene, 8); }
    const raft = new THREE.Group(); scene.add(raft); box(2 * HW + 1.2, 0.3, 14, mat(0x7a5634, { roughness: 0.9 }), 0, -0.15, 0, raft); for (const sd of [-1, 1]) { box(0.2, 0.5, 14, dwood, sd * (HW + 0.5), 0.25, 0, raft); for (const z of [-5, -1.7, 1.7, 5]) { const b = cyl(0.55, 0.55, 1.4, mat(0x2d5aa0, { roughness: 0.5 }), sd * (HW - 0.5), -0.6, z, raft, 12); b.rotation.x = Math.PI / 2; } }
    cyl(0.12, 0.14, 1.1, steel, HW - 0.2, 0.55, 0, raft); const wh = new THREE.Group(); wh.position.set(HW - 0.2, 1.15, 0); wh.rotation.y = Math.PI / 2; raft.add(wh); wh.add(new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 20), red)); for (const a of [0, 1.05, 2.1]) { const sp = box(0.9, 0.04, 0.04, red, 0, 0, 0, wh); sp.rotation.z = a; }
    raft.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); out.raft = raft; out.raftWheel = wh;
    // guide cable across the lake
    const cg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(d0.x - Math.cos(d0.h) * (HW + 1), fy + 1.6, d0.z + Math.sin(d0.h) * (HW + 1)), new THREE.Vector3(d1.x - Math.cos(d1.h) * (HW + 1), fy + 1.6, d1.z + Math.sin(d1.h) * (HW + 1))]); scene.add(new THREE.Line(cg, new THREE.LineBasicMaterial({ color: 0x222222 })));
    const sp = P(A.dock0 - 30, HW + 1.6); sign(scene, sp.x, S.heightAt(sp.x, sp.z), sp.z, sp.h + Math.PI, ['SELF-SERVICE FERRY', 'drive on · crank to cross', 'mind the edge'], { w: 3, h: 1.5 });
  }
  // ---- Lakeside Camp ----
  { const c = S.camp, cy = c.y; const fx = Math.sin(c.h), fz = Math.cos(c.h), at2 = (du, dv) => ({ x: c.x + fx * du - Math.cos(c.h) * dv, z: c.z + fz * du + Math.sin(c.h) * dv });
    const tents = [[8, -14, 0xd0602a], [14, -9, 0x2a8ad0], [16, 12, 0x4ab04a], [6, 15, 0xd0b02a]];
    for (const [du, dv, col] of tents) { const p = at2(du, dv); const t = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.1, 4, 1), mat(col, { roughness: 0.8 })); t.position.set(p.x, cy + 1.05, p.z); t.rotation.y = c.h + Math.PI / 4; t.castShadow = true; scene.add(t); S.pbox.push({ x: p.x, z: p.z, h: c.h, a: 1.2, b: 1.2, y0: cy, y1: cy + 2 }); S.addT({ x: p.x, z: p.z, y: cy, kind: 8, r: 1.3 }); }
    const fp = at2(12, 1); for (let i = 0; i < 6; i++) { const l = cyl(0.08, 0.08, 0.9, mat(0x5a3a1e), fp.x, cy + 0.12, fp.z, scene, 6); l.rotation.set(Math.PI / 2 - 0.3, i * 1.05, 0); l.rotation.order = 'YXZ'; }
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), mat(0x8a8680)); s.position.set(fp.x + Math.cos(a) * 0.75, cy + 0.08, fp.z + Math.sin(a) * 0.75); scene.add(s); }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85 })); fire.position.set(fp.x, cy + 0.45, fp.z); scene.add(fire); const fl = new THREE.PointLight(0xff9a40, 3, 14, 1.2); fl.position.set(fp.x, cy + 1, fp.z); scene.add(fl); out.fire = { m: fire, l: fl, x: fp.x, y: cy, z: fp.z };
    for (const [du, dv] of [[4, 6], [20, -2]]) { const p = at2(du, dv); const tb = box(1.8, 0.08, 0.8, wood, p.x, cy + 0.75, p.z, scene); tb.rotation.y = c.h; for (const o of [-0.65, 0.65]) { const bq = { x: p.x - Math.cos(c.h) * o, z: p.z + Math.sin(c.h) * o }; const bn = box(1.8, 0.06, 0.3, wood, bq.x, cy + 0.45, bq.z, scene); bn.rotation.y = c.h; } S.pbox.push({ x: p.x, z: p.z, h: c.h, a: 0.9, b: 0.4, y0: cy, y1: cy + 0.78 }); }
    const ap = at2(-14, 0); for (const sd of [-1, 1]) { const q = { x: ap.x - Math.cos(c.h) * sd * (HW + 1.2), z: ap.z + Math.sin(c.h) * sd * (HW + 1.2) }; cyl(0.2, 0.22, 5, dwood, q.x, cy + 2.5, q.z, scene, 8); S.addT({ x: q.x, z: q.z, y: cy, kind: 8, r: 0.3 }); }
    { const t = cvTex(1024, 192, (x, w, h) => { x.fillStyle = '#5a3a1e'; x.fillRect(0, 0, w, h); x.fillStyle = '#f7e6b0'; x.font = '900 110px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('LAKESIDE CAMP', w / 2, h / 2 + 6); }); const bd = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 2.8, 1.1, 0.15), new THREE.MeshStandardMaterial({ map: t })); bd.position.set(ap.x, cy + 4.6, ap.z); bd.rotation.y = c.h; scene.add(bd); }
    out.campC = at2(8, 0);
  }
  // cable for the winch: instanced segments
  { const n = 28, m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 5), mat(0x2a2a2a, { metalness: 0.5, roughness: 0.5 }), n); m.frustumCulled = false; m.castShadow = true; m.count = 0; scene.add(m); out.cable = m; }
  return out;
}
