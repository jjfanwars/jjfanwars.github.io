'use strict';
// The car you sit in: exterior shell (shadows, hood view), wheels, roll-caged interior, dash display,
// driver and co-driver figures, the navigator's clipboard map, and the first-person head camera.
// Car local frame: +z forward, +y up, +x LEFT. Left-hand drive: driver seat x = +0.37, navigator x = -0.37.
// eye sits forward of the body, close to the windscreen (like a real in-car camera)
const EYE_OFF = new THREE.Vector3(0, -0.01, 0.27);
const SWITCH_NAMES = ['IGNITION', 'FUEL PUMP', 'FAN', 'WIPERS', 'HEADLIGHTS', 'SPOT LIGHTS'];
const SEAT = { drv: new THREE.Vector3(0.37, 0.49, -0.34), nav: new THREE.Vector3(-0.37, 0.47, -0.34) };

// wheel size per body (the physics uses the selected car's own radius)
const LOOKW = { monster: { r: 0.66, w: 0.55 }, trophy: { r: 0.45, w: 0.36 }, van: { r: 0.34, w: 0.22 }, muscle: { r: 0.34, w: 0.28 }, ev: { r: 0.35, w: 0.27 }, mini: { r: 0.28, w: 0.2 }, drift: { r: 0.31, w: 0.25 }, limo: { r: 0.33, w: 0.22 } };
// cabin theme per body: dash finish, seat fabric (base, centre panel), piping, cage (0 none, 2 heavy), wheel style, dial colours, floor, extras
const CABIN = {
  saloon: { dash: 0xa9adb1, seat: ['#16181c', '#1f3f8a'], pipe: 0xc41e1e },
  hatch: { dash: 0x34373c, seat: ['#16181c', '#d0202a'], pipe: 0xffd400, cageCol: 0xffd400 },
  coupe: { dash: 0x6a5846, seat: ['#2a2018', '#c9a46a'], pipe: 0xc9a46a, pods: 1 },
  groupb: { dash: 0x2f3134, seat: ['#16181c', '#c81e1e'], pipe: 0xf0f0f0, wheel: 'dish', boost: 1 },
  wrc: { dash: 'carbon', seat: ['#111214', '#e0601a'], pipe: 0xe0601a, digital: 1, bbox: 1 },
  proto: { dash: 'carbon', seat: ['#0d0f12', '#18b8d8'], pipe: 0x18b8d8, digital: 1, wheel: 'formula', bbox: 1, cageCol: 0x1a1b1e },
  beetle: { dash: 'paint', seat: ['#e8dcc0', '#c84030'], pipe: 0xe8e8e8, dialBg: '#efe7d2', dialFg: '#161616', wheel: 'thin', vase: 1 },
  van: { dash: 0xf1e4c8, seat: ['#f2a5c5', '#fff4e0'], pipe: 0xf6a6c8, cage: 0, wheel: 'big', floor: 'carpet', van: 1 },
  muscle: { dash: 'wood', seat: ['#3a160c', '#5e2414'], pipe: 0xd8d8d8, cage: 0, wheel: 'wood', floor: 'carpet', dialBg: '#060606', pods: 1, nos: 1 },
  trophy: { dash: 0x2a2b2e, seat: ['#16181c', '#d8a040'], pipe: 0xd8a040, cage: 2, digital: 1, gps: 1 },
  monster: { dash: 0x1a1b1d, seat: ['#16181c', '#36b030'], pipe: 0x36b030, cage: 2, cageCol: 0x36b030, gps: 1, wheel: 'big' },
  ev: { dash: 0xe8e8e6, seat: ['#f0f0ee', '#d4d4d2'], pipe: 0x20e0ff, cage: 0, digital: 1, wheel: 'yoke', floor: 'carpet', ev: 1 },
  mini: { dash: 'paint', seat: ['#111214', '#e8e8e8'], pipe: 0xe8e8e8, wheel: 'dish', dialBg: '#101010', pods: 1 },
  estate: { dash: 0x5c6066, seat: ['#22252a', '#2f8a4a'], pipe: 0x2f8a4a, dog: 1 },
  drift: { dash: 0x202124, seat: ['#111111', '#d02020'], pipe: 0xd02020, wheel: 'dish', pods: 1, cageCol: 0x1a1b1e },
  limo: { dash: 'wood', seat: ['#0c0c0c', '#1c1c1c'], pipe: 0xc8a050, cage: 0, wheel: 'wood', floor: 'carpet', limo: 1 },
};
class CarView {
  constructor(scene, opt) {
    opt = opt || {}; const g = this.g = new THREE.Group(); scene.add(g);
    const paint = new THREE.MeshPhysicalMaterial({ color: opt.color || 0x1d4fbf, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.7 }), satin = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.15 });
    const cageM = new THREE.MeshStandardMaterial({ color: 0xc8c9cc, metalness: 0.8, roughness: 0.35 }), trim = new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.9 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, metalness: 0.1, roughness: 0.35, clearcoat: 1 }), orange = new THREE.MeshPhysicalMaterial({ color: 0xff7a1a, roughness: 0.35, clearcoat: 1 });
    this.mats = { paint, black, satin, cageM, trim };
    // ---- exterior shell: side profile extruded across the width ----
    const look = this.look = opt.look || 'saloon', isB = look === 'beetle', spec = CARS.find(c => c.look === look) || CARS[0];
    this.WH = wheelsOf(spec); this.cr = spec.r || 0.32; this.crest = spec.rest || 0.36; // this body's own wheels, whatever car is being driven
    // side profiles; the cabin (windscreen 0.32..0.98, roof 0.79) stays the same so the interior fits every car
    const arc = (cx, cy, rx, ry, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };
    const PROF = {
      saloon: [[-2.04, -0.42], [-2.09, -0.05], [-2.05, 0.22], [-1.92, 0.55], [-1.55, 0.75], [-0.6, 0.79], [0.32, 0.77], [0.98, 0.26], [1.6, 0.18], [1.98, 0.1], [2.1, -0.08], [2.08, -0.42]],
      hatch: [[-1.86, -0.42], [-1.9, -0.05], [-1.87, 0.3], [-1.8, 0.66], [-1.62, 0.79], [-0.6, 0.8], [0.32, 0.77], [0.98, 0.26], [1.55, 0.2], [1.92, 0.1], [2.02, -0.1], [2.0, -0.42]],
      coupe: [[-2.08, -0.42], [-2.12, -0.05], [-2.06, 0.2], [-1.75, 0.36], [-1.1, 0.66], [-0.6, 0.78], [0.32, 0.77], [0.98, 0.24], [1.6, 0.15], [2.0, 0.06], [2.14, -0.12], [2.12, -0.42]],
      groupb: [[-2.0, -0.42], [-2.06, -0.02], [-2.0, 0.26], [-1.7, 0.42], [-1.15, 0.7], [-0.6, 0.79], [0.32, 0.77], [0.98, 0.25], [1.6, 0.17], [2.02, 0.06], [2.14, -0.14], [2.1, -0.42]],
      wrc: [[-2.06, -0.42], [-2.1, -0.04], [-2.04, 0.24], [-1.9, 0.56], [-1.55, 0.76], [-0.6, 0.8], [0.32, 0.77], [0.98, 0.25], [1.62, 0.16], [2.02, 0.05], [2.18, -0.16], [2.16, -0.42]],
      proto: [[-2.12, -0.44], [-2.16, -0.1], [-2.08, 0.16], [-1.6, 0.34], [-1.1, 0.62], [-0.6, 0.78], [0.32, 0.77], [0.98, 0.22], [1.6, 0.1], [2.05, -0.02], [2.24, -0.22], [2.2, -0.44]],
      van: [[-2.3, -0.42], [-2.33, 0.2], [-2.3, 1.3], [-2.18, 1.4], [0.18, 1.4], [0.3, 1.2], [0.32, 0.77], [0.98, 0.26], [1.55, 0.2], [1.95, 0.1], [2.02, -0.1], [2.0, -0.42]],
      muscle: [[-2.22, -0.4], [-2.26, -0.02], [-2.18, 0.24], [-1.95, 0.32], [-1.25, 0.6], [-0.6, 0.78], [0.32, 0.77], [0.98, 0.27], [1.9, 0.22], [2.3, 0.14], [2.38, -0.12], [2.34, -0.4]],
      trophy: [[-2.28, -0.36], [-2.34, 0.26], [-0.85, 0.3], [-0.74, 0.8], [0.32, 0.78], [0.98, 0.26], [1.85, 0.18], [2.32, 0.02], [2.36, -0.18], [2.28, -0.36]],
      monster: [[-2.15, -0.42], [-2.2, 0.32], [-0.8, 0.34], [-0.72, 0.82], [0.32, 0.79], [0.98, 0.28], [1.7, 0.22], [2.12, 0.12], [2.2, -0.12], [2.15, -0.42]],
      ev: [[-2.1, -0.44], [-2.15, -0.02], [-2.02, 0.28], [-1.45, 0.56], [-0.6, 0.78], [0.32, 0.77], [0.98, 0.24], [1.7, 0.08], [2.2, -0.06], [2.27, -0.26], [2.2, -0.44]],
      mini: [[-1.6, -0.42], [-1.64, -0.05], [-1.62, 0.3], [-1.58, 0.7], [-1.45, 0.8], [-0.6, 0.81], [0.32, 0.77], [0.98, 0.28], [1.4, 0.22], [1.6, 0.12], [1.66, -0.1], [1.64, -0.42]],
      estate: [[-2.12, -0.42], [-2.16, -0.04], [-2.14, 0.3], [-2.08, 0.7], [-1.95, 0.8], [-0.6, 0.81], [0.32, 0.77], [0.98, 0.26], [1.6, 0.18], [1.98, 0.1], [2.1, -0.08], [2.08, -0.42]],
      drift: [[-2.1, -0.4], [-2.14, -0.04], [-2.06, 0.22], [-1.85, 0.3], [-1.3, 0.58], [-0.6, 0.77], [0.32, 0.76], [0.98, 0.24], [1.7, 0.16], [2.12, 0.08], [2.2, -0.12], [2.16, -0.4]],
      limo: [[-4.2, -0.42], [-4.24, -0.05], [-4.2, 0.24], [-4.05, 0.56], [-3.7, 0.78], [-0.6, 0.8], [0.32, 0.77], [0.98, 0.26], [1.6, 0.18], [1.98, 0.1], [2.1, -0.08], [2.08, -0.42]],
      beetle: [...arc(-0.35, -0.4, 1.65, 1.2, Math.PI, 1.723, 10), [-0.15, 0.81], [0.32, 0.77], ...arc(0.9, -0.4, 1.06, 0.67, 1.495, 0, 9)],
    };
    const prof = PROF[look] || PROF.saloon, T = this.cab = CABIN[look] || CABIN.saloon;
    // the cabin is at the front of long bodies: shift the whole shell so the physics centre sits mid-body (wheels stay put)
    const zMin = Math.min(...prof.map(q => q[0])), zMax = Math.max(...prof.map(q => q[0])); this.zo = look === 'limo' ? -(zMin + zMax) / 2 : 0; this.rearZ = this.zMin = zMin;
    this.yAt = z => { let best = -9; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; if ((a[0] - z) * (b[0] - z) > 0 || a[0] === b[0]) continue; best = Math.max(best, a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0])); } return best + (isB ? 0.09 : 0.07); };
    // z of the body surface at height y on the front (+1) or rear (-1) face
    const zAt = this.zAt = (y, side) => { let best = side > 0 ? -9 : 9; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue; const z = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); best = side > 0 ? Math.max(best, z) : Math.min(best, z); } return best + side * (isB ? 0.14 : 0.07); };
    const sh = new THREE.Shape(); prof.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
    const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: isB ? 1.46 : 1.62, bevelEnabled: true, bevelThickness: isB ? 0.16 : 0.08, bevelSize: isB ? 0.09 : 0.07, bevelSegments: isB ? 5 : 3, steps: 1, curveSegments: 4 });
    bodyGeo.translate(0, 0, isB ? -0.73 : -0.81); bodyGeo.rotateY(-Math.PI / 2); // extrude axis -> x, profile x -> z
    const body = new THREE.Mesh(bodyGeo, paint); body.castShadow = true; g.add(body); this.body = body;
    // livery stripes on the hood and roof (outside only)
    if (!isB && !T.limo && !T.ev) for (const x of [0.16, -0.16]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 1.05), white); st.position.set(x, 0.205, 1.5); st.rotation.x = -0.09; g.add(st); const rf = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 1.6), white); rf.position.set(x, 0.875, -0.6); g.add(rf); }
    if (!isB) { const vent = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.28), black); vent.position.set(0, 0.22, 1.25); vent.rotation.x = -0.09; g.add(vent); }
    if (!isB && !T.limo) for (const sd of [1, -1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 3.0), orange); s.position.set(sd * 0.895, -0.12, 0); g.add(s); }
    // lights, grille, mud flaps, spoiler
    const lampM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.4, roughness: 0.1 });
    this.lampM = lampM;
    // headlights: real spot lights on your own car (switch with H)
    const noseZ = zAt(0.06, 1); this.spots = []; if (!opt.remote) for (const sd of [1, -1]) { const sp = new THREE.SpotLight(0xfff0d8, 0, 120, 0.42, 0.7, 1.3); sp.position.set(sd * 0.55, 0.06, noseZ + 0.12); sp.target.position.set(sd * 0.9, -1.6, noseZ + 22); sp.userData.sd = sd; g.add(sp, sp.target); this.spots.push(sp); }
    const lampHs = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.4 }), lampCh = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.22 });
    // headlamps: a black housing on the nose with two round lenses in chrome reflectors per side
    for (const sd of [1, -1]) { if (!isB) { const hs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), lampHs); hs.position.set(sd * 0.55, 0.06, noseZ - 0.02); g.add(hs);
        for (const k of [0, 1]) { const x = sd * (0.46 + k * 0.18), rf = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.05, 0.035, 18).rotateX(Math.PI / 2), lampCh); rf.position.set(x, 0.06, noseZ + 0.012); g.add(rf); const ln = new THREE.Mesh(new THREE.CircleGeometry(0.054, 18), lampM); ln.position.set(x, 0.06, noseZ + 0.031); g.add(ln); } } const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0x500000, roughness: 0.2 })); r.position.set(sd * 0.6, isB ? 0.0 : 0.2, zAt(isB ? 0.0 : 0.2, -1)); g.add(r); }
    if (look === 'saloon' || look === 'hatch') { const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.32), black); spoiler.position.set(0, look === 'hatch' ? 0.83 : 0.86, look === 'hatch' ? -1.72 : -1.82); g.add(spoiler); }
    this.bodyKit(look, { paint, black, white, satin, lampM });
    { const tint = new THREE.MeshPhysicalMaterial({ color: 0x0b0f13, metalness: 0.3, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.3 }), bv = isB ? 0.09 : 0.07, hwX = (isB ? 0.73 : 0.81) + (isB ? 0.16 : 0.08) + 0.006;
      const pane = (z1, y1, z2, y2, w) => { const dz = z2 - z1, dy = y2 - y1, L = Math.hypot(dz, dy); let nz = -dy / L, ny = dz / L; if (ny < 0) { nz = -nz; ny = -ny; } const o = new THREE.Mesh(new THREE.PlaneGeometry(w, L * 0.9), tint); o.position.set(0, (y1 + y2) / 2 + ny * (bv + 0.012), (z1 + z2) / 2 + nz * (bv + 0.012)); g.add(o); o.lookAt(0, o.position.y + ny, o.position.z + nz); };
      pane(0.32, 0.77, 0.98, 0.26, 1.38); // windscreen from outside
      const rT = zAt(0.74, -1) + 0.04, rB = zAt(0.4, -1) + 0.02; pane(rT, 0.74, rB, 0.4, isB ? 1.0 : 1.3);
      const wsh2 = new THREE.Shape(), pts = [[0.86, 0.36], [0.3, 0.75], [-0.6, 0.77], [Math.min(-0.95, rT + 0.12), 0.72], [Math.min(-1.05, rB + 0.25), 0.36]];
      pts.forEach((q, i) => i ? wsh2.lineTo(q[0], q[1]) : wsh2.moveTo(q[0], q[1]));
      for (const sd of [1, -1]) { const geo = new THREE.ShapeGeometry(wsh2); if (sd > 0) { geo.scale(-1, 1, 1); geo.rotateY(Math.PI / 2); geo.index.array.reverse(); } else geo.rotateY(-Math.PI / 2); const o = new THREE.Mesh(geo, tint); o.position.x = sd * hwX; g.add(o); }
      for (const sd of [1, -1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.42, 0.05), black); b.position.set(sd * (hwX + 0.004), 0.55, -0.62); g.add(b); } }
    // ---- glass ----
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb2c0, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.1, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
    const wsh = new THREE.Mesh(new THREE.PlaneGeometry(1.48, Math.hypot(0.66, 0.51)), glass); wsh.position.set(0, 0.515, 0.65); wsh.rotation.x = Math.atan2(-0.66, 0.51); g.add(wsh);
    this.glass = wsh;
    // windscreen cracks that grow with damage
    { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), r = mulberry(11); g.strokeStyle = 'rgba(235,240,245,.9)'; g.lineCap = 'round';
      for (const [cx, cy] of [[150, 330], [380, 260], [260, 120]]) { for (let k = 0; k < 14; k++) { let x = cx, y = cy, a = r() * 6.28; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); const L = 40 + r() * 170; for (let d = 0; d < L; d += 8) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y); } g.stroke(); } for (let ring = 1; ring < 4; ring++) { g.lineWidth = 0.9; g.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * 6.28, rr = ring * 16 + r() * 8; k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); } }
      const t = new THREE.CanvasTexture(c); this.crackM = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const cm = new THREE.Mesh(new THREE.PlaneGeometry(1.46, Math.hypot(0.66, 0.51)), this.crackM); cm.position.set(0, 0.51, 0.64); cm.rotation.x = Math.atan2(-0.66, 0.51); this.g.add(cm); }
    // ---- interior ----
    const I = this.interior = new THREE.Group(); g.add(I);
    const M = this.imats = CarView.materials(), seatM = CarView.seatMat(T.seat[0], T.seat[1]), seatS = CarView.seatMat(T.seat[0]);
    const cageMat = T.cageCol ? new THREE.MeshStandardMaterial({ color: T.cageCol, metalness: 0.5, roughness: 0.4 }) : cageM, cageR = T.cage === 2 ? 1.45 : 1;
    const tube = (a, b, r, m) => { const d = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m || cageM); c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); I.add(c); return c; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z), add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); I.add(m); return m; };
    // ---- classic rally dash: grey lower dash and centre stack, black top pad, black binnacle with red piping ----
    const grey = T.dash === 'carbon' ? M.carbon : T.dash === 'wood' ? M.wood : T.dash === 'paint' ? paint : new THREE.MeshStandardMaterial({ color: T.dash, roughness: 0.68 }), blk = M.plastic;
    { const pr = [[0.99, 0.24], [0.8, 0.255], [0.62, 0.225], [0.52, 0.185], [0.47, 0.11], [0.44, 0.0], [0.4, -0.12], [0.37, -0.24], [0.62, -0.26], [0.99, -0.2]], shp = new THREE.Shape(); pr.forEach((q, i) => i ? shp.lineTo(q[0], q[1]) : shp.moveTo(q[0], q[1]));
      const dg = new THREE.ExtrudeGeometry(shp, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 }); dg.translate(0, 0, -0.78); dg.rotateY(-Math.PI / 2); I.add(new THREE.Mesh(dg, grey));
      const top = [[0.99, 0.243], [0.8, 0.258], [0.62, 0.228], [0.53, 0.19], [0.55, 0.16], [0.99, 0.2]], ts = new THREE.Shape(); top.forEach((q, i) => i ? ts.lineTo(q[0], q[1]) : ts.moveTo(q[0], q[1]));
      const tg = new THREE.ExtrudeGeometry(ts, { depth: 1.6, bevelEnabled: false }); tg.translate(0, 0.004, -0.8); tg.rotateY(-Math.PI / 2); I.add(new THREE.Mesh(tg, blk)); }
    // binnacle: a black pod facing the driver with a hood over it
    add(new THREE.BoxGeometry(0.46, 0.2, 0.1), blk, 0.37, 0.2, 0.5, -0.2);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24, 1, true, -Math.PI / 2, Math.PI), blk, 0.37, 0.235, 0.52, Math.PI / 2 - 0.2, 0, Math.PI / 2).material.side = THREE.DoubleSide;
    // red dashed piping along the binnacle and the dash edge
    { const red = new THREE.MeshBasicMaterial({ color: T.pipe || 0xc41e1e }); for (let i = 0; i < 26; i++) { const t = i / 25, x = 0.62 - t * 0.9, y = 0.268 - Math.abs(t - 0.28) * 0.06, z = 0.47 + Math.abs(t - 0.28) * 0.02; if (i % 2) continue; add(new THREE.BoxGeometry(0.03, 0.004, 0.004), red, x, y, z, 0, 0, (t < 0.28 ? -1 : 1) * 0.07); } }
    // two big analog dials: speedo (0-200 km/h) and rev counter (0-8), white bezels, orange needles
    const dial = (max, step, sub, unit, red) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), fg = T.dialFg || '#f2f2f2'; x.fillStyle = T.dialBg || '#0d0e10'; x.beginPath(); x.arc(128, 128, 127, 0, 7); x.fill();
      const n = max / sub; for (let i = 0; i <= n; i++) { const a = (-225 + i / n * 270) * Math.PI / 180, v = i * sub, big = v % step === 0, r0 = big ? 94 : 104; x.strokeStyle = red && v >= red ? '#e33' : fg; x.lineWidth = big ? 5 : 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); x.stroke();
        if (big) { x.fillStyle = red && v >= red ? '#e33' : fg; x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(max > 20 ? v : v), 128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); } }
      x.fillStyle = fg; x.globalAlpha = 0.75; x.font = '16px system-ui'; x.textAlign = 'center'; x.fillText(unit, 128, 196); x.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const bezel = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.4 }), dialRot = [-0.2, Math.PI, 0];
    const mkDial = (x, tex) => { const d = add(new THREE.CircleGeometry(0.074, 40), new THREE.MeshBasicMaterial({ map: tex }), x, 0.205, 0.448, ...dialRot); const bz = add(new THREE.TorusGeometry(0.079, 0.01, 10, 40), bezel, x, 0.205, 0.447, ...dialRot);
      const ng = new THREE.Group(); ng.position.copy(d.position); ng.rotation.copy(d.rotation); I.add(ng); const piv = new THREE.Group(); ng.add(piv); const n = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.064, 0.002), new THREE.MeshBasicMaterial({ color: 0xff6a10 })); n.position.set(0, 0.024, 0.003); piv.add(n); const cap = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshBasicMaterial({ color: 0xff6a10 })); cap.position.z = 0.004; ng.add(cap); return piv; };
    const nI0 = I.children.length;
    this.vDial = (CARS.find(c => c.look === look) || CARS[0]).vmax > 205 ? 280 : 200; this.speedN = mkDial(0.462, dial(this.vDial, this.vDial > 200 ? 40 : 50, 10, 'km/h')); this.needleP = mkDial(0.278, dial(8, 1, 0.5, 'x1000 rpm', 7));
    if (T.digital) { for (let k = nI0; k < I.children.length; k++) I.children[k].visible = false; this.lcdC = document.createElement('canvas'); this.lcdC.width = 512; this.lcdC.height = 208; this.lcdT = new THREE.CanvasTexture(this.lcdC); this.lcdT.colorSpace = THREE.SRGBColorSpace;
      add(new THREE.PlaneGeometry(0.37, 0.15), new THREE.MeshBasicMaterial({ map: this.lcdT, toneMapped: false }), 0.37, 0.205, 0.447, ...dialRot); }
    // warning lamps between the dials
    [[0xd01818, 0.232], [0xe0a010, 0.212], [0x1e50d0, 0.192]].forEach(([c, y]) => add(new THREE.BoxGeometry(0.012, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: c }), 0.37, y, 0.452, -0.2));
    // shift-light pod on top of the binnacle: 3 green, 2 yellow, 2 red
    add(new THREE.BoxGeometry(0.22, 0.04, 0.035), blk, 0.37, 0.31, 0.47, -0.2);
    this.leds = []; this.ledCol = [0x20ff40, 0x20ff40, 0x20ff40, 0xffc020, 0xffc020, 0xff2020, 0xff2020];
    for (let i = 0; i < 7; i++) { const m = new THREE.MeshBasicMaterial({ color: 0x151515 }); add(new THREE.CircleGeometry(0.0115, 16), m, 0.45 - i * 0.027, 0.311, 0.4515, -0.2, Math.PI, 0); add(new THREE.TorusGeometry(0.0125, 0.0025, 6, 16), bezel, 0.45 - i * 0.027, 0.311, 0.451, -0.2, Math.PI, 0); this.leds.push(m); }
    this.dashC = document.createElement('canvas'); this.dashC.width = 4; this.dashC.height = 4; this.dashT = new THREE.CanvasTexture(this.dashC);
    // slatted vents: driver's left, both sides of the centre stack, co-driver's right
    const ventS = (x, y, z, w) => { add(new THREE.BoxGeometry(w, 0.055, 0.02), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 }), x, y, z, -0.15); for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(w - 0.01, 0.006, 0.018), grey, x, y - 0.019 + i * 0.013, z - 0.006, -0.15); };
    ventS(0.68, 0.12, 0.47, 0.1); ventS(-0.68, 0.12, 0.47, 0.1); ventS(0, -0.13, 0.457, 0.16);
    // ignition key on the driver's left
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }), 0.62, 0.03, 0.46, Math.PI / 2 - 0.15); add(new THREE.BoxGeometry(0.006, 0.026, 0.01), M.alu, 0.62, 0.03, 0.452, -0.15);
    // centre stack: two small gauges and the switch panel
    add(new THREE.BoxGeometry(0.3, 0.3, 0.02), grey, 0, -0.02, 0.462, -0.15);
    // switch panel: six big push buttons, 2 rows x 3, each with its own label and a status light that glows when on
    add(new THREE.BoxGeometry(0.27, 0.15, 0.006), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.8 }), -0.035, 0.118, 0.452, -0.15);
    this.toggles = []; this.hits = []; this.btnCol = [0xff3030, 0xffa020, 0x40a8ff, 0x30e0d0, 0x50ff60, 0xfff0a0];
    ['IGN', 'FUEL', 'FAN', 'WIPE', 'LIGHTS', 'SPOTS'].forEach((lab, i) => {
      const col = i % 3, row = i / 3 | 0, tg = new THREE.Group(); tg.position.set(0.05 - col * 0.085, 0.15 - row * 0.064, 0.448); tg.rotation.x = -0.15; I.add(tg);
      const bz = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.056, 0.01), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.5 })); tg.add(bz);
      const c = document.createElement('canvas'); c.width = 128; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#2a2c30'; x.fillRect(0, 0, 128, 96); x.fillStyle = '#3a3d42'; x.fillRect(0, 0, 128, 6);
      x.fillStyle = '#f2f2f2'; x.font = 'bold ' + (lab.length > 4 ? 26 : 32) + 'px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(lab, 64, 62); x.fillStyle = '#9aa0a8'; x.font = 'bold 18px system-ui'; x.textAlign = 'left'; x.fillText(String(i + 1), 8, 24);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const side = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });
      const face = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.18 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.046, 0.016), [side, side, side, side, side, face]); cap.position.z = -0.008; tg.add(cap);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.007, 0.002), new THREE.MeshBasicMaterial({ color: 0x1a1a1a })); led.position.set(0, 0.012, -0.0085); cap.add(led); const hb = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.062, 0.03), new THREE.MeshBasicMaterial({ visible: false })); hb.userData.sw = i; tg.add(hb); this.hits.push(hb);
      this.toggles.push({ cap, led, face, i });
    });
    // glovebox on the co-driver side
    add(new THREE.BoxGeometry(0.34, 0.12, 0.012), new THREE.MeshStandardMaterial({ map: M.plastic.map, color: 0xa4a8ac, roughness: 0.7 }), -0.4, 0.03, 0.452, -0.15); add(new THREE.BoxGeometry(0.06, 0.012, 0.012), M.alu, -0.4, 0.07, 0.445, -0.15);
    // ---- windscreen wipers (outside the glass) ----
    { const wg = this.wsG = new THREE.Group(); wg.position.set(0, 0.515, 0.65); wg.rotation.x = Math.atan2(-0.66, 0.51); g.add(wg); const wm = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.6 }); this.wipers = [];
      for (const px of [0.55, -0.05]) { const p = new THREE.Group(); p.position.set(px, -0.4, 0.02); wg.add(p); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.014, 0.01), wm); arm.position.x = -0.25; p.add(arm); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.02), wm); blade.position.set(-0.27, 0.004, -0.006); p.add(blade); p.rotation.z = -0.06; this.wipers.push(p); }
      // raindrops and splash water on the glass (rain stages, river fords); the wipers clear them
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      for (let i = 0; i < 420; i++) { const px = Math.random() * 256, py = Math.random() * 256, r = 0.8 + Math.random() * Math.random() * 4.5; x.fillStyle = 'rgba(200,215,230,.35)'; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(px - r * 0.3, py - r * 0.3, r * 0.35, 0, 7); x.fill(); }
      for (let i = 0; i < 40; i++) { x.strokeStyle = 'rgba(210,225,240,.3)'; x.lineWidth = 1.5; x.beginPath(); const a = Math.random() * 256, b = Math.random() * 200; x.moveTo(a, b); x.lineTo(a + (Math.random() - 0.5) * 6, b + 20 + Math.random() * 40); x.stroke(); }
      const dt2 = new THREE.CanvasTexture(c); this.dropM = new THREE.MeshBasicMaterial({ map: dt2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const dm = new THREE.Mesh(new THREE.PlaneGeometry(1.46, Math.hypot(0.66, 0.51)), this.dropM); dm.position.z = 0.004; wg.add(dm); this.wet = 0;
      this.wipeT = 0; }
    // transmission tunnel, sequential lever, hydraulic handbrake
    add(new THREE.BoxGeometry(0.26, 0.26, 1.05), M.carbon, 0, -0.27, 0.05);
    this.shiftL = new THREE.Group(); this.shiftL.position.set(0.15, -0.12, 0.3); I.add(this.shiftL);
    { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.34, 8), M.alu); l.position.y = 0.17; this.shiftL.add(l); const k = T.floor === 'carpet' ? new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), T.limo || T.nos ? new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.15 }) : M.wood) : new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 12), M.suede); k.position.y = 0.35; this.shiftL.add(k); if (T.ev) this.shiftL.visible = false; this.shiftL.rotation.x = -0.35; this.lastGear = 1; this.shiftA = 0; }
    this.hbL = new THREE.Group(); this.hbL.position.set(0.15, -0.14, 0.1); I.add(this.hbL); { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.26, 8), M.alu); l.position.y = 0.13; this.hbL.add(l); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xa01414, roughness: 0.5 })); k.position.y = 0.27; this.hbL.add(k); }
    // co-driver: trip computer with a live display, gooseneck map lamp, footrest
    this.tripC = document.createElement('canvas'); this.tripC.width = 320; this.tripC.height = 84; this.tripT = new THREE.CanvasTexture(this.tripC); this.tripT.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.BoxGeometry(0.22, 0.07, 0.07), M.plastic, -0.42, 0.29, 0.6, -0.25);
    add(new THREE.PlaneGeometry(0.19, 0.05), new THREE.MeshBasicMaterial({ map: this.tripT, toneMapped: false }), -0.42, 0.292, 0.564, -0.25, Math.PI, 0);
    tube(V(-0.6, 0.24, 0.55), V(-0.58, 0.36, 0.42), 0.006, M.alu); add(new THREE.ConeGeometry(0.02, 0.04, 10, 1, true), M.plastic, -0.58, 0.36, 0.41, -1.2);
    add(new THREE.BoxGeometry(0.34, 0.02, 0.32), M.checker, -0.37, -0.36, 0.66, 0.55);
    add(new THREE.BoxGeometry(1.56, 0.02, 1.4), T.floor === 'carpet' ? M.carpet : M.checker, 0, -0.42, 0.25); // floor plates (carpet in road cars)
    // A pillars, roof liner with vent, door cards with pull straps, window net on the driver's side
    for (const sd of [1, -1]) {
      tube(V(sd * 0.77, 0.22, 0.98), V(sd * 0.66, 0.76, 0.32), 0.045, M.plastic);
      add(new THREE.BoxGeometry(0.04, 0.52, 1.45), T.floor === 'carpet' ? seatS : M.carbon, sd * 0.86, -0.08, -0.25);
      add(new THREE.BoxGeometry(0.1, 0.05, 1.45), M.plastic, sd * 0.83, 0.19, -0.25);
      add(new THREE.BoxGeometry(0.02, 0.025, 0.3), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.7 }), sd * 0.835, 0.08, 0.05, 0, 0, sd * 0.4);
      add(new THREE.BoxGeometry(0.08, 0.6, 0.14), M.plastic, sd * 0.8, 0.48, -0.95);
      const mr = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.07), paint); mr.position.set(sd * 1.02, 0.31, 0.72); g.add(mr); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.04), black); arm.position.set(sd * 0.93, 0.28, 0.74); g.add(arm); const mg = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.08), CarView.mirrorGlass || (CarView.mirrorGlass = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 1, roughness: 0.04 }))); mg.position.set(sd * 1.02, 0.31, 0.684); mg.rotation.y = Math.PI; g.add(mg);
    }
    add(new THREE.BoxGeometry(1.5, 0.02, 2.1), M.liner, 0, 0.775, -0.6); add(new THREE.BoxGeometry(0.42, 0.03, 0.32), M.plastic, 0, 0.76, -0.2);
    // windscreen black band (frit) so the glass has an edge
    { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 256, 7); x.fillRect(0, 121, 256, 7); x.fillRect(0, 0, 5, 128); x.fillRect(251, 0, 5, 128); for (let i = 0; i < 256; i += 3) for (let j = 0; j < 0; j++) { x.beginPath(); x.arc(i + 2, 12 + j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); x.beginPath(); x.arc(i + 2, 116 - j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); }
      const t = new THREE.CanvasTexture(c); const fr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, Math.hypot(0.66, 0.51) + 0.02), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x000000 })); fr.position.set(0, 0.512, 0.645); fr.rotation.x = Math.atan2(-0.66, 0.51); g.add(fr); }
    // rear-view mirror shows a live render from behind the car
    this.mirrorRT = new THREE.WebGLRenderTarget(320, 96, { type: THREE.HalfFloatType });
    { const mg = new THREE.PlaneGeometry(0.25, 0.075), uv = mg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      add(new THREE.BoxGeometry(0.27, 0.09, 0.02), black, 0, 0.665, 0.31); this.mirror = add(mg, new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture }), 0, 0.665, 0.298, 0.08, Math.PI, 0); tube(V(0, 0.71, 0.31), V(0, 0.775, 0.33), 0.008, black); }
    this.mirrorCam = new THREE.PerspectiveCamera(42, 320 / 96, Math.max(2.25, 0.2 - this.rearZ), 320);
    // roll cage with foam padding where heads and knees go
    const rzC = Math.max(-1.75, this.rearZ + 0.3), ctube = (a, b, r, foam) => { if (a.z < rzC) a.z = rzC; if (b.z < rzC) b.z = rzC; return tube(a, b, foam ? r : r * cageR, foam ? M.foam : cageMat); };
    if (T.cage !== 0) {
    for (const sd of [1, -1]) {
      ctube(V(sd * 0.7, -0.35, -0.85), V(sd * 0.66, 0.72, -0.85), 0.022); ctube(V(sd * 0.7, -0.3, 0.7), V(sd * 0.6, 0.72, 0.28), 0.02);
      ctube(V(sd * 0.6, 0.72, 0.28), V(sd * 0.66, 0.72, -0.85), 0.02); ctube(V(sd * 0.66, 0.72, -0.85), V(sd * 0.68, -0.25, -1.75), 0.02);
      ctube(V(sd * 0.72, -0.05, 0.6), V(sd * 0.72, 0.2, -0.85), 0.018); ctube(V(sd * 0.72, 0.2, 0.55), V(sd * 0.72, -0.1, -0.85), 0.018);
      ctube(V(sd * 0.72, 0.13, 0.15), V(sd * 0.72, 0.03, -0.35), 0.036, 1);
    }
    ctube(V(0.66, 0.72, -0.85), V(-0.66, 0.72, -0.85), 0.022); ctube(V(0.6, 0.72, 0.28), V(-0.6, 0.72, 0.28), 0.02);
    ctube(V(0.66, 0.72, -0.85), V(-0.68, -0.3, -0.85), 0.02); ctube(V(0.62, 0.72, 0.28), V(-0.64, 0.72, -0.85), 0.018); ctube(V(-0.62, 0.72, 0.28), V(0.64, 0.72, -0.85), 0.018);
    ctube(V(0.4, 0.72, 0.28), V(-0.4, 0.72, 0.28), 0.034, 1);
    }
    // bucket seats: extruded side profile with bolsters, fabric with a stitched centre
    for (const sx of [0.37, -0.37]) {
      const pr = new THREE.Shape(); pr.moveTo(0.18, -0.33); pr.lineTo(-0.28, -0.33); pr.quadraticCurveTo(-0.36, -0.3, -0.38, 0.05); pr.lineTo(-0.44, 0.68); pr.quadraticCurveTo(-0.42, 0.74, -0.34, 0.72); pr.lineTo(-0.28, 0.1); pr.quadraticCurveTo(-0.26, -0.2, -0.1, -0.21); pr.lineTo(0.18, -0.19); pr.closePath();
      for (const [w, off] of [[0.36, 0], [0.07, 0.215], [0.07, -0.215]]) { const sg = new THREE.ExtrudeGeometry(pr, { depth: w, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3 }); sg.translate(0, 0, -w / 2); sg.rotateY(-Math.PI / 2); const m = new THREE.Mesh(sg, off ? seatS : seatM); m.position.set(sx + off, 0, -0.33); if (off) m.scale.set(1, 1.02, 1); I.add(m); }
    }
    // spare wheel, extinguisher, tool bag, rear strut brace
    if (T.cage !== 0) { const rz = Math.max(-1.45, this.rearZ + 0.42), rk = rz + 1.45;
    add(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 18), black, 0, -0.28, rz); add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.3 }), 0, -0.3, -0.75, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.4, 0.18, 0.25), new THREE.MeshStandardMaterial({ color: 0x1f2b4a, roughness: 0.9 }), -0.45, -0.3, -1.4 + rk); }
    // steering wheel: flat-bottom suede rim, alloy spokes, quick-release hub with buttons
    const sw0 = this.wheelG = new THREE.Group(); sw0.position.set(0.37, 0.115, 0.27); sw0.rotation.x = -0.55; I.add(sw0);
    { const ws = T.wheel || 'flat', R0 = ws === 'thin' ? 0.2 : ws === 'big' ? 0.205 : ws === 'wood' ? 0.185 : 0.175, tk = ws === 'thin' ? 0.009 : ws === 'wood' ? 0.014 : ws === 'big' ? 0.02 : 0.018;
      const rimMat = ws === 'wood' ? M.wood : ws === 'thin' ? new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.35 }) : ws === 'big' || ws === 'yoke' ? M.plastic : M.suede;
      const yr = ws === 'yoke' ? [-0.105, 0.055] : ws === 'formula' ? [-0.085, 0.085] : ws === 'flat' ? [-0.142, 1] : [-1, 1], xs = ws === 'formula' ? 0.95 : 1;
      const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * R0 * xs, clamp(Math.cos(a) * R0, yr[0], yr[1]), 0)); }
      sw0.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, tk, 10, true), rimMat));
      const dish = ws === 'dish' ? -0.045 : 0, spM = ws === 'wood' || ws === 'thin' ? new THREE.MeshStandardMaterial({ color: 0xe8eaec, metalness: 1, roughness: 0.18 }) : M.alu;
      const spokes = ws === 'thin' || ws === 'big' ? [Math.PI / 2, -Math.PI / 2] : ws === 'yoke' || ws === 'formula' ? [] : [Math.PI / 2, -Math.PI / 2, Math.PI];
      for (const a of spokes) { const sp = new THREE.Mesh(new THREE.BoxGeometry(ws === 'thin' ? 0.012 : 0.03, R0 - 0.03, 0.008), spM); sp.position.set(Math.sin(a) * (R0 - 0.03) / 2, Math.cos(a) * (R0 - 0.03) / 2, dish / 2); sp.rotation.z = -a; sw0.add(sp); }
      if (ws === 'thin') { const hr = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 8, 32, Math.PI), spM); hr.position.z = -0.012; sw0.add(hr); }
      if (ws === 'yoke' || ws === 'formula') { const pl = new THREE.Mesh(new THREE.BoxGeometry(ws === 'yoke' ? 0.3 : 0.24, 0.1, 0.02), ws === 'yoke' ? M.plastic : M.carbon); pl.position.set(0, -0.02, -0.01); sw0.add(pl);
        if (ws === 'formula') { const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.035), new THREE.MeshBasicMaterial({ color: 0x103018 })); scr.position.set(0, 0.0, 0.002); scr.rotation.y = Math.PI; sw0.add(scr); [0xd01818, 0x20b040, 0x1e6fd0, 0xffc020, 0xf0f0f0, 0xd01818].forEach((c, k) => { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), new THREE.MeshStandardMaterial({ color: c })); bt.rotation.x = Math.PI / 2; bt.position.set((k % 2 ? -1 : 1) * (0.07 + (k >> 1) * 0.012), 0.02 - (k >> 1) * 0.022, 0.006); sw0.add(bt); }); } }
      if (ws === 'flat' || ws === 'dish' || ws === 'formula') { const mark = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xffd400 })); mark.position.set(0, ws === 'formula' ? 0.085 : R0, 0); sw0.add(mark); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(ws === 'big' ? 0.06 : 0.048, ws === 'big' ? 0.06 : 0.048, 0.03, 18), ws === 'thin' || ws === 'wood' ? spM : M.plastic); hub.rotation.x = Math.PI / 2; hub.position.z = dish; sw0.add(hub);
      if (ws === 'flat' || ws === 'dish') { const qr = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 18), M.alu); qr.position.z = 0.03 + dish; sw0.add(qr);
        for (const [x, c] of [[0.065, 0xd01818], [-0.065, 0x1e6fd0]]) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10), new THREE.MeshStandardMaterial({ color: c })); bt.rotation.x = Math.PI / 2; bt.position.set(x, 0.02, -0.008); sw0.add(bt); } } }
    tube(V(0.37, 0.09, 0.32), V(0.37, 0.0, 0.56), 0.03, M.plastic);
    // pedals
    for (const [x, h] of [[0.48, 0], [0.37, 0.02], [0.27, 0]]) add(new THREE.BoxGeometry(0.07, 0.11, 0.015), M.alu, x, -0.25 + h, 0.75, 0.4);
    // ---- crew figures (race suits and helmets) ----
    this.crew = { drv: this.person(0x2b303b, 0xf2b632), nav: this.person(0x3b2d22, 0xe0e0e0) };
    this.crew.drv.g.position.copy(SEAT.drv); this.crew.nav.g.position.copy(SEAT.nav); I.add(this.crew.drv.g, this.crew.nav.g);
    // navigator's clipboard map
    this.mapC = document.createElement('canvas'); this.mapC.width = 1024; this.mapC.height = 1280; this.mapT = new THREE.CanvasTexture(this.mapC); this.mapT.colorSpace = THREE.SRGBColorSpace; this.mapT.anisotropy = 8;
    const board = this.board = new THREE.Group();
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.012, 0.42), new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 })); board.add(bm);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.39), new THREE.MeshStandardMaterial({ map: this.mapT, roughness: 0.85, emissive: 0xffffff, emissiveMap: this.mapT, emissiveIntensity: 0.18 })); paper.rotation.x = -Math.PI / 2; paper.rotation.z = Math.PI; paper.position.y = 0.007; board.add(paper);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), cageM); clip.position.set(0, 0.012, -0.2); board.add(clip);
    I.add(board); this.mapUp = 0;
    // ---- wheels ----
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 }), rimG = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.85, roughness: 0.3 });
    this.wheels = this.WH.map((a, i) => {
      const w = new THREE.Group(), spin = new THREE.Group(); w.add(spin);
      const LW = LOOKW[look] || {}, tr = LW.r || 0.32, tw = LW.w || 0.22;
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, tw, 22, 1), tyreM); tyre.scale.set(1, 1, 1); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
      const rimm = new THREE.Mesh(new THREE.CylinderGeometry(tr * 0.62, tr * 0.62, tw + 0.005, look === 'ev' ? 24 : 6), look === 'ev' ? new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.8, roughness: 0.3 }) : rimG); rimm.rotation.z = Math.PI / 2; spin.add(rimm);
      if (look !== 'ev') for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.01, 0.045, tr * 0.1), rimG); s.rotation.x = k * Math.PI / 3; spin.add(s); }
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.012), new THREE.MeshStandardMaterial({ color: i < 2 ? 0x111111 : 0xf2f2f2 })); flap.position.set(a[0] > 0 ? 0 : 0, -0.12, -0.36); if (i >= 2) w.add(flap);
      g.add(w); return { g: w, spin, a: new THREE.Vector3(...a), rv: tr };
    });
    this.cabinExtras(T, I, add, tube, V, M, { paint, black, cageM, grey });
    if (T.dog) { const fur = new THREE.MeshStandardMaterial({ color: 0xc8902a, roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x4a2a10, roughness: 1 }), dg = new THREE.Group(); dg.position.set(0.1, 0.0, this.rearZ + 0.45); g.add(dg);
      const bx = (w, h, d, mt, x, y, z, p) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt); o.position.set(x, y, z); (p || dg).add(o); return o; };
      bx(0.24, 0.24, 0.5, fur, 0, 0.12, 0); for (const sx of [0.08, -0.08]) for (const sz of [0.17, -0.17]) bx(0.06, 0.16, 0.06, fur, sx, -0.06, sz);
      const hd = this.dogHead = new THREE.Group(); hd.position.set(0, 0.34, 0.24); dg.add(hd); bx(0.18, 0.17, 0.18, fur, 0, 0, 0, hd); bx(0.1, 0.08, 0.1, fur, 0, -0.03, 0.12, hd); bx(0.04, 0.03, 0.02, dark, 0, 0.0, 0.175, hd); for (const sx of [0.1, -0.1]) bx(0.04, 0.13, 0.08, dark, sx, -0.03, -0.02, hd); for (const sx of [0.045, -0.045]) bx(0.025, 0.025, 0.01, dark, sx, 0.04, 0.09, hd);
      const tl = this.dogTail = new THREE.Group(); tl.position.set(0, 0.2, -0.25); dg.add(tl); const tm = bx(0.035, 0.035, 0.2, fur, 0, 0.05, -0.08, tl); tm.rotation.x = 0.6; }
    if (this.zo) for (const ch of g.children) if (!this.wheels.some(w => w.g === ch)) ch.position.z += this.zo;
    this.head = new THREE.Vector3(); this.headV = new THREE.Vector3(); this.prevV = null; this.shake = 0;
    // the roof and pillars shade the cabin
    g.traverse(o => { if (o.isMesh && o !== wsh && o.material !== this.dashMat) { o.receiveShadow = true; if (o.parent !== g || o === body) o.castShadow = true; } });
    body.receiveShadow = false;
    // rival cars: only the shell, wheels and crew are worth drawing
    this.remote = !!opt.remote; if (this.remote) I.children.forEach(ch => { ch.visible = ch === this.crew.drv.g || ch === this.crew.nav.g; });
  }
  // per-car exterior extras: arches, wings, scoops, splitters, lamp pods; the Beetle gets its fenders, round lamps and chrome
  bodyKit(look, m) {
    const g = this.g, zAt = this.zAt, chrome = new THREE.MeshStandardMaterial({ color: 0xe8eaec, metalness: 1, roughness: 0.18 });
    const box = (w, h, d, mat, x, y, z, rx, ry, rz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); o.castShadow = true; g.add(o); return o; };
    const fm = m.paint.clone(); fm.side = THREE.DoubleSide; const flares = (wd, r) => { for (const a of this.WH) { const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wd, 18, 1, true, 0, Math.PI), fm); f.rotation.set(0, 0, Math.PI / 2); f.rotation.order = 'ZYX'; f.position.set(Math.sign(a[0]) * (0.84 + wd / 2 - 0.06), -0.34, a[2]); g.add(f); const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 18, Math.PI), m.black); lip.rotation.y = Math.PI / 2; lip.position.set(Math.sign(a[0]) * (0.84 + wd - 0.06), -0.34, a[2]); g.add(lip); } };
    const wing = (y, wd, ch, zOff, plates) => { const z = zAt(0.5, -1) + (zOff || 0); box(wd, 0.035, ch, m.black, 0, y, z, -0.12); if (plates) for (const sd of [1, -1]) box(0.02, 0.2, ch + 0.08, m.black, sd * wd / 2, y - 0.04, z); for (const sd of [1, -1]) box(0.03, y - 0.55, 0.12, m.black, sd * 0.42, (y + 0.55) / 2, z + 0.04); };
    const splitter = (wd, d) => box(wd, 0.03, d, m.black, 0, -0.41, zAt(-0.38, 1) - d / 2 + 0.06);
    const scoop = () => { box(0.36, 0.1, 0.5, m.paint, 0, 0.9, -0.1); box(0.28, 0.06, 0.02, m.black, 0, 0.9, 0.16); };
    const louvres = (z, n) => { for (let i = 0; i < n; i++) box(0.5, 0.014, 0.03, m.black, 0, this.yAt(z - i * 0.06) + 0.004, z - i * 0.06, -0.09); };
    const pod = (n, y) => { const z = zAt(0.1, 1) - 0.16; box(0.12 + n * 0.17, 0.05, 0.06, m.black, 0, y - 0.06, z - 0.03); for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * 0.17; const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 18), m.black); ring.rotation.x = Math.PI / 2; ring.position.set(x, y, z); g.add(ring); const l = new THREE.Mesh(new THREE.CircleGeometry(0.064, 18), m.lampM); l.position.set(x, y, z + 0.031); g.add(l); } };
    if (look === 'hatch') { flares(0.06, 0.42); splitter(1.5, 0.18); }
    else if (look === 'coupe') { flares(0.12, 0.44); wing(0.72, 1.55, 0.3, 0.25, true); louvres(1.3, 5); splitter(1.6, 0.2); }
    else if (look === 'groupb') { flares(0.16, 0.45); wing(0.8, 1.7, 0.36, 0.2, true); scoop(); louvres(1.4, 7); pod(4, 0.26); splitter(1.7, 0.22); }
    else if (look === 'wrc') { flares(0.14, 0.45); wing(0.92, 1.6, 0.3, 0.32, true); box(1.4, 0.02, 0.24, m.black, 0, 0.86, -1.55); scoop(); splitter(1.8, 0.3); for (const sd of [1, -1]) box(0.03, 0.12, 0.3, m.black, sd * 0.95, -0.25, zAt(-0.25, 1) - 0.25); }
    else if (look === 'proto') { flares(0.2, 0.46); wing(1.15, 2.0, 0.5, 0.45, true); wing(0.95, 1.9, 0.3, 0.55, false); scoop(); louvres(1.45, 9); splitter(2.1, 0.45); for (const sd of [1, -1]) { box(0.3, 0.02, 0.2, m.black, sd * 0.8, -0.18, zAt(-0.2, 1) - 0.12, 0, 0, sd * 0.25); box(0.02, 0.1, 3.2, m.black, sd * 1.02, -0.36, -0.05); } }
    else if (look === 'van') {
      // ice cream van: pastel band, serving hatch, a giant cone on the roof
      const pink = new THREE.MeshStandardMaterial({ color: 0xf6a6c8, roughness: 0.5 }), cream = new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.6 });
      for (const sd of [1, -1]) { box(0.02, 0.18, 2.4, pink, sd * 0.9, 0.95, -1.08); box(0.02, 0.06, 2.4, cream, sd * 0.9, 1.08, -1.08); }
      box(0.03, 0.55, 1.3, m.black, -0.9, 0.85, -0.9); box(0.08, 0.04, 1.4, cream, -0.95, 0.56, -0.9);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 16), new THREE.MeshStandardMaterial({ color: 0xd9a35a, roughness: 0.8 })); cone.rotation.x = Math.PI; cone.position.set(0, 1.85, -0.9); g.add(cone);
      for (const [y, c] of [[2.28, 0xf6a6c8], [2.5, 0xfff1d6], [2.68, 0x8a5a3a]]) { const sc = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })); sc.position.set(0, y, -0.9); g.add(sc); }
    }
    else if (look === 'muscle') { box(0.42, 0.1, 0.8, m.paint, 0, 0.32, 1.35); box(0.36, 0.06, 0.02, m.black, 0, 0.34, 1.76); box(1.5, 0.05, 0.25, m.black, 0, 0.36, zAt(0.3, -1) + 0.08, -0.15); for (const sd of [1, -1]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 10), chrome); ex.rotation.x = Math.PI / 2; ex.position.set(sd * 0.95, -0.32, 0.1); g.add(ex); } splitter(1.6, 0.15); }
    else if (look === 'trophy' || look === 'monster') {
      // pickup bed with a roll cage, roof light bar; the trophy truck carries a spare
      const z0 = -0.8, z1 = zAt(0.0, -1) + 0.15, bar = (a, b) => { const d = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, d.length(), 8), chrome); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(c); };
      for (const sd of [1, -1]) { bar(new THREE.Vector3(sd * 0.75, 0.32, z0 - 0.1), new THREE.Vector3(sd * 0.6, 1.1, z0 - 0.1)); bar(new THREE.Vector3(sd * 0.6, 1.1, z0 - 0.1), new THREE.Vector3(sd * 0.7, 0.32, z1 + 0.3)); }
      bar(new THREE.Vector3(0.6, 1.1, z0 - 0.1), new THREE.Vector3(-0.6, 1.1, z0 - 0.1));
      box(1.3, 0.1, 0.18, m.black, 0, 0.92, 0.0); for (let i = 0; i < 4; i++) box(0.22, 0.08, 0.04, m.lampM, (i - 1.5) * 0.3, 0.92, 0.1);
      if (look === 'trophy') { const sp = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.13, 10, 20), new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 })); sp.rotation.x = Math.PI / 2; sp.position.set(0, 0.45, -1.5); g.add(sp); splitter(1.9, 0.3); }
      else { box(1.9, 0.18, 4.0, m.black, 0, -0.5, 0); for (const sd of [1, -1]) box(0.08, 0.5, 0.08, m.black, sd * 0.7, -0.8, 0); }
    }
    else if (look === 'ev') { box(1.7, 0.035, 0.03, m.lampM, 0, 0.12, zAt(0.12, 1) + 0.01); box(1.7, 0.035, 0.03, new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xc00000 }), 0, 0.3, zAt(0.3, -1) - 0.01); box(1.3, 0.012, 1.4, m.black, 0, 0.885, -0.3); splitter(1.8, 0.2); }
    else if (look === 'mini') { flares(0.07, 0.38); splitter(1.5, 0.14); pod(4, 0.2); box(1.5, 0.012, 1.7, m.white, 0, 0.885, -0.55); for (const sd of [1, -1]) box(0.03, 0.03, 1.2, m.black, sd * 0.75, 0.9, -0.55); }
    else if (look === 'estate') { flares(0.08, 0.44); splitter(1.6, 0.18); pod(2, 0.24); for (const sd of [1, -1]) box(0.04, 0.04, 2.3, m.satin, sd * 0.62, 0.92, -0.75); box(0.9, 0.22, 1.5, m.black, 0, 1.05, -0.9); box(0.86, 0.04, 1.46, m.satin, 0, 1.17, -0.9); }
    else if (look === 'drift') {
      flares(0.12, 0.43); splitter(1.7, 0.22); box(1.5, 0.03, 0.22, m.black, 0, 0.36, zAt(0.3, -1) + 0.12, 0.25);
      // pop-up headlights: hinged at the back edge, they flip up with the lights
      this.popups = []; for (const sd of [1, -1]) { const zf = zAt(0.1, 1) - 0.42, hg = new THREE.Group(); hg.position.set(sd * 0.55, this.yAt(zf) - 0.01, zf); g.add(hg); const lid = box(0.34, 0.03, 0.22, m.paint, 0, 0, 0.11); g.remove(lid); hg.add(lid); const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.09), m.lampM); face.position.set(0, -0.05, 0.225); hg.add(face); const sideB = box(0.32, 0.1, 0.2, m.black, 0, -0.06, 0.11); g.remove(sideB); hg.add(sideB); this.popups.push(hg); hg.rotation.x = 0; }
    }
    else if (look === 'limo') {
      const tint = new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0.3, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.82, depthWrite: false }), rz = this.zMin; // privacy glass: dark outside, see-through from the party
      for (const sd of [1, -1]) { box(0.02, 0.28, -rz - 1.75, tint, sd * 0.905, 0.56, (rz - 1.35) / 2 + 0.1); box(0.025, 0.035, -rz + 1.9, chrome, sd * 0.905, 0.02, (rz + 2.0) / 2); for (const z of [-1.1, (rz - 1.1) / 2, rz + 0.55]) box(0.03, 0.34, 0.08, m.black, sd * 0.91, 0.56, z); }
      const orn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 8), chrome); orn.position.set(0, this.yAt(1.95) + 0.04, 1.95); g.add(orn);
      for (const z of [zAt(-0.3, 1) + 0.02, zAt(-0.3, -1) - 0.02]) { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 1.5, 4, 10), chrome); b.rotation.z = Math.PI / 2; b.position.set(0, -0.3, z); g.add(b); }
    }
    else if (look === 'beetle') {
      // bulbous fenders over every wheel
      for (const a of this.WH) { const f = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), fm); const front = a[2] > 0; f.scale.set(0.3, 0.5, front ? 0.56 : 0.62); f.position.set(Math.sign(a[0]) * 0.78, -0.36, a[2] + (front ? 0.04 : -0.04)); f.castShadow = true; g.add(f); }
      // round headlights sitting on the front fenders, chrome rings
      for (const sd of [1, -1]) { const zf = this.WH[0][2] + 0.62; const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.08, 22), chrome); ring.rotation.x = Math.PI / 2 - 0.25; ring.position.set(sd * 0.78, -0.07, zf - 0.13); g.add(ring); const l = new THREE.Mesh(new THREE.CircleGeometry(0.095, 22), m.lampM); l.rotation.x = -0.25; l.position.set(sd * 0.78, -0.06, zf - 0.088); g.add(l); }
      // chrome bumpers, running boards, engine-lid louvres, a maxed-out whale tail and a lamp pod
      for (const z of [zAt(-0.3, 1) + 0.02, zAt(-0.3, -1) - 0.02]) { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 1.5, 4, 10), chrome); b.rotation.z = Math.PI / 2; b.position.set(0, -0.3, z); g.add(b); for (const sd of [1, -1]) box(0.04, 0.12, 0.08, chrome, sd * 0.45, -0.28, z + Math.sign(z) * -0.04); }
      for (const sd of [1, -1]) box(0.16, 0.03, 1.4, m.black, sd * 0.84, -0.4, 0);
      for (let i = 0; i < 5; i++) box(0.04, 0.012, 0.2, chrome, (i - 2) * 0.07, 0.42 - 0.0, -1.66, 0.8);
      const tz = zAt(0.4, -1) + 0.12; box(1.3, 0.03, 0.34, m.black, 0, 0.5, tz, 0.15); for (const sd of [1, -1]) box(0.02, 0.14, 0.38, m.black, sd * 0.65, 0.46, tz);
      // white side roundels with the car's number
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#f4f4f0'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill(); x.fillStyle = '#111'; x.font = '900 72px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('1', 64, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const rm = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4 });
      for (const sd of [1, -1]) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), rm); d.rotation.y = sd * Math.PI / 2; d.position.set(sd * 0.905, 0.12, -0.25); g.add(d); }
      // stripes over the bonnet and roof
      for (const xx of [0.12, -0.12]) { box(0.1, 0.012, 0.5, m.white, xx, 0.325, 1.3, -0.2); box(0.1, 0.012, 0.9, m.white, xx, 0.895, -0.25); }
    }
  }
  static materials() {
    if (CarView._M) return CarView._M;
    const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }, tx = (c, rep) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(rep, rep); return t; }, R = mulberry(5);
    const carbon = cv(128, 128, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const o = ((x + y) / 8) % 4 < 2; const gr = g.createLinearGradient(x, y, o ? x + 8 : x, o ? y : y + 8); gr.addColorStop(0, '#0d0e10'); gr.addColorStop(0.5, o ? '#2a2c31' : '#1c1d21'); gr.addColorStop(1, '#0d0e10'); g.fillStyle = gr; g.fillRect(x, y, 8, 8); } });
    const noise = (base, amp) => cv(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * amp})`; g.fillRect(R() * w, R() * h, 1.5, 1.5); } });
    const seat = cv(128, 128, (g, w, h) => { g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f3f8a'; g.fillRect(40, 0, 48, h); g.strokeStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < h; y += 10) { g.beginPath(); g.moveTo(40, y); g.lineTo(88, y); g.stroke(); } for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.05})`; g.fillRect(R() * w, R() * h, 1, 1); } });
    const checker = cv(64, 64, (g, w, h) => { g.fillStyle = '#8d9095'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8bcc2'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { g.save(); g.translate(x + 4 + (y / 16 % 2) * 8, y + 8); g.rotate((y / 16 % 2 ? 1 : -1) * 0.7); g.fillRect(-4, -1.2, 8, 2.4); g.restore(); } });
    const net = cv(128, 128, (g, w, h) => { g.strokeStyle = '#111'; g.lineWidth = 5; for (let i = -128; i < 256; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); } g.strokeStyle = '#c81e1e'; g.lineWidth = 10; g.strokeRect(0, 0, w, h); });
    const wood = cv(256, 128, (g, w, h) => { g.fillStyle = '#5a2e14'; g.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { const y = R() * h, a = 0.1 + R() * 0.25; g.strokeStyle = `rgba(${R() < 0.5 ? '30,12,4' : '150,80,36'},${a})`; g.lineWidth = 0.6 + R() * 2.2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3 + (R() - 0.5) * 1.5); g.stroke(); } });
    return CarView._M = {
      carbon: new THREE.MeshPhysicalMaterial({ map: tx(carbon, 4), roughness: 0.4, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 }),
      plastic: new THREE.MeshStandardMaterial({ map: tx(noise('#1a1b1e', 0.05), 3), roughness: 0.62, metalness: 0.05 }),
      suede: new THREE.MeshStandardMaterial({ map: tx(noise('#1b1b1d', 0.08), 6), roughness: 1 }),
      liner: new THREE.MeshStandardMaterial({ map: tx(noise('#2c2e33', 0.2), 4), roughness: 1, side: THREE.DoubleSide }),
      seat: new THREE.MeshStandardMaterial({ map: tx(seat), roughness: 0.95 }), seatSide: new THREE.MeshStandardMaterial({ map: tx(noise('#141519', 0.15), 3), roughness: 0.9 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.32 }), checker: new THREE.MeshStandardMaterial({ map: tx(checker, 6), metalness: 0.7, roughness: 0.45 }),
      foam: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }), wood: new THREE.MeshPhysicalMaterial({ map: tx(wood, 1), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }), carpet: new THREE.MeshStandardMaterial({ map: tx(noise('#1c1b1a', 0.22), 5), roughness: 1 }), net: new THREE.MeshStandardMaterial({ map: tx(net, 3), alphaTest: 0.5, transparent: false, roughness: 0.9 }),
    };
  }
  // seat fabric: base colour, optional stitched centre panel (cached per colour pair)
  static seatMat(base, mid) {
    const key = base + (mid || ''), C = CarView._S || (CarView._S = {}); if (C[key]) return C[key];
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), R = mulberry(9); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    if (mid) { g.fillStyle = mid; g.fillRect(40, 0, 48, 128); g.strokeStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < 128; y += 10) { g.beginPath(); g.moveTo(40, y); g.lineTo(88, y); g.stroke(); } }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * 0.06})`; g.fillRect(R() * 128, R() * 128, 1.2, 1.2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (!mid) t.repeat.set(3, 3);
    return C[key] = new THREE.MeshStandardMaterial({ map: t, roughness: mid ? 0.95 : 0.8 });
  }
  // the bits that make each cabin its own: gauge pods, button boxes, GPS, the dog, the freezer, the disco ball
  cabinExtras(T, I, add, tube, V, M, m) {
    const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5 }, o || {})), glow = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const canv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const mini = (lab, col) => canv(96, 96, (x) => { x.fillStyle = T.dialBg || '#0b0b0c'; x.beginPath(); x.arc(48, 48, 47, 0, 7); x.fill(); x.strokeStyle = T.dialFg || '#eee'; x.lineWidth = 3; for (let i = 0; i <= 8; i++) { const a = (-225 + i * 33.75) * Math.PI / 180; x.beginPath(); x.moveTo(48 + Math.cos(a) * 34, 48 + Math.sin(a) * 34); x.lineTo(48 + Math.cos(a) * 42, 48 + Math.sin(a) * 42); x.stroke(); } x.fillStyle = T.dialFg || '#eee'; x.font = 'bold 15px system-ui'; x.textAlign = 'center'; x.fillText(lab, 48, 74); x.strokeStyle = col || '#ff6a10'; x.lineWidth = 3; const a = (-225 + (0.3 + Math.random() * 0.4) * 270) * Math.PI / 180; x.beginPath(); x.moveTo(48, 48); x.lineTo(48 + Math.cos(a) * 36, 48 + Math.sin(a) * 36); x.stroke(); });
    const chrome = mat(0xe8eaec, { metalness: 1, roughness: 0.18 });
    const gauge = (x, y, z, r, lab, rx, ry) => { add(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.03, 20), T.floor === 'carpet' ? chrome : M.plastic, x, y, z, Math.PI / 2 + (rx || 0), ry || 0, 0); add(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ map: mini(lab) }), x, y, z - 0.016 * Math.cos(rx || 0), rx || 0, Math.PI + (ry || 0), 0); };
    if (T.pods) { add(new THREE.BoxGeometry(0.26, 0.07, 0.06), M.plastic, 0, -0.2, 0.45, -0.5); ['OIL', 'WATER', 'VOLTS'].forEach((l, k) => gauge((k - 1) * 0.08, -0.2, 0.42, 0.028, l, -0.5)); }
    if (T.boost) gauge(0.7, 0.42, 0.52, 0.045, 'BOOST', -0.3, -0.5);
    if (T.bbox) { add(new THREE.BoxGeometry(0.2, 0.03, 0.26), M.carbon, 0, -0.1, 0.12, 0.25); const cols = [0xd01818, 0x20b040, 0x1e6fd0, 0xffc020, 0xf0f0f0, 0xd01818, 0x20b040, 0xffc020];
      cols.forEach((c, k) => add(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 12), glow(c), (k % 2 ? -1 : 1) * 0.045, -0.08 + (k >> 1) * 0.015, 0.21 - (k >> 1) * 0.055, 0.25));
      add(new THREE.BoxGeometry(0.2, 0.012, 0.14), M.plastic, -0.42, 0.28, 0.42, -0.9); add(new THREE.PlaneGeometry(0.18, 0.12), new THREE.MeshBasicMaterial({ map: canv(256, 170, (x, w, h) => { x.fillStyle = '#0c1a10'; x.fillRect(0, 0, w, h); x.strokeStyle = '#3cff7a'; x.lineWidth = 4; x.beginPath(); x.moveTo(20, h - 20); for (let i = 0; i < 9; i++) x.lineTo(30 + i * 25, h - 30 - Math.sin(i * 1.3) * 40 - i * 10); x.stroke(); x.fillStyle = '#3cff7a'; x.font = 'bold 22px monospace'; x.fillText('TC 2  SS4', 14, 28); }), toneMapped: false }), -0.42, 0.287, 0.42, -0.9 - Math.PI / 2, 0, Math.PI); }
    if (T.vase) { add(new THREE.CylinderGeometry(0.012, 0.018, 0.12, 12), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transmission: 0, transparent: true, opacity: 0.55, roughness: 0.05 }), -0.66, 0.33, 0.56); tube(V(-0.66, 0.38, 0.56), V(-0.65, 0.47, 0.57), 0.003, mat(0x2f8a2a)); add(new THREE.SphereGeometry(0.022, 10, 8), mat(0xe02040), -0.65, 0.48, 0.57); for (let k = 0; k < 5; k++) add(new THREE.SphereGeometry(0.012, 8, 6), mat(0xffd040), -0.65 + Math.cos(k * 1.26) * 0.022, 0.48, 0.57 + Math.sin(k * 1.26) * 0.022); }
    if (T.gps) { tube(V(-0.12, 0.25, 0.55), V(-0.12, 0.34, 0.5), 0.008, M.alu); add(new THREE.BoxGeometry(0.2, 0.13, 0.025), M.plastic, -0.12, 0.38, 0.49, -0.3);
      add(new THREE.PlaneGeometry(0.18, 0.11), new THREE.MeshBasicMaterial({ map: canv(256, 160, (x, w, h) => { x.fillStyle = '#0a1410'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(80,140,100,.35)'; for (let i = 0; i < w; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); } for (let i = 0; i < h; i += 32) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); } x.strokeStyle = '#ffb030'; x.lineWidth = 5; x.beginPath(); x.moveTo(128, 150); x.bezierCurveTo(100, 100, 200, 70, 150, 10); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(128, 120); x.lineTo(118, 140); x.lineTo(138, 140); x.fill(); x.fillStyle = '#ffb030'; x.font = 'bold 18px monospace'; x.fillText('WPT 07  1.4km', 8, 22); }), toneMapped: false }), -0.12, 0.38, 0.476, -0.3, Math.PI, 0);
      add(new THREE.BoxGeometry(0.5, 0.05, 0.16), M.plastic, 0, 0.73, 0.12); for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.012, 0.012, 0.03), M.alu, -0.2 + k * 0.08, 0.7, 0.18, 0.5);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), mat(0xd01818, { roughness: 0.3 }), 0, -0.25, -0.72, 0, 0, Math.PI / 2); }
    if (T.nos) { for (const x of [0.22, -0.22]) { add(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 16), mat(0x2050d0, { roughness: 0.25, metalness: 0.3 }), x, -0.1, -1.0); add(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 10), chrome, x, 0.18, -1.0); add(new THREE.BoxGeometry(0.15, 0.03, 0.15), M.plastic, x, -0.05, -1.0); }
      add(new THREE.BoxGeometry(0.05, 0.03, 0.08), mat(0xd01818), 0, -0.13, 0.36, 0.3); add(new THREE.BoxGeometry(0.008, 0.03, 0.008), chrome, 0, -0.1, 0.37); }
    if (T.van) { // freezer chest, tubs, a stack of cones, fluffy dice
      add(new THREE.BoxGeometry(1.2, 0.55, 0.62), mat(0xf4f4f2, { roughness: 0.3 }), 0, -0.15, -1.4); add(new THREE.BoxGeometry(1.16, 0.02, 0.58), mat(0x9fc8e0, { roughness: 0.1 }), 0, 0.13, -1.4);
      [0xf6a6c8, 0xfff1d6, 0x8a5a3a, 0x8fd18a].forEach((c, k) => add(new THREE.CylinderGeometry(0.09, 0.08, 0.1, 14), mat(c, { roughness: 0.8 }), -0.42 + k * 0.28, 0.2, -1.4));
      for (let k = 0; k < 5; k++) add(new THREE.ConeGeometry(0.045, 0.14, 12), mat(0xd9a35a, { roughness: 0.85 }), 0.5, 0.2 + k * 0.03, -1.0, Math.PI);
      for (const x of [0.02, -0.03]) { tube(V(x, 0.62, 0.3), V(x, 0.55, 0.3), 0.002, M.plastic); add(new THREE.BoxGeometry(0.028, 0.028, 0.028), mat(0xff70b0, { roughness: 1 }), x, 0.54, 0.3, 0.3, 0.5, 0.2); } }
    if (T.ev) { // portrait touchscreen and an ambient light strip
      this.evC = document.createElement('canvas'); this.evC.width = 256; this.evC.height = 360; this.evT = new THREE.CanvasTexture(this.evC); this.evT.colorSpace = THREE.SRGBColorSpace;
      add(new THREE.BoxGeometry(0.24, 0.33, 0.02), M.plastic, 0, 0.1, 0.47, -0.25); add(new THREE.PlaneGeometry(0.225, 0.315), new THREE.MeshBasicMaterial({ map: this.evT, toneMapped: false }), 0, 0.1, 0.458, -0.25, Math.PI, 0);
      add(new THREE.BoxGeometry(1.5, 0.006, 0.006), glow(0x20e0ff), 0, 0.172, 0.52); for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.006, 0.006, 1.2), glow(0x20e0ff), sd * 0.83, 0.22, -0.25); }
    if (T.limo) { // the party in the back: benches, bar, mood lights, a disco ball
      const rz = this.rearZ, gold = mat(0xc8a050, { metalness: 1, roughness: 0.25 }), leather = CarView.seatMat('#0c0c0c');
      add(new THREE.BoxGeometry(1.5, 0.02, -rz - 1.6), M.liner, 0, 0.775, (rz + 1.6) / 2 - 0.05); add(new THREE.BoxGeometry(1.56, 0.02, -rz - 0.9), M.carpet, 0, -0.42, (rz - 0.9) / 2 + 0.45);
      for (const sd of [1, -1]) { add(new THREE.BoxGeometry(0.42, 0.3, -rz - 1.9), leather, sd * 0.6, -0.25, (rz + 1.5) / 2); add(new THREE.BoxGeometry(0.12, 0.45, -rz - 1.9), leather, sd * 0.8, 0.05, (rz + 1.5) / 2); (this.party || (this.party = [])).push(add(new THREE.BoxGeometry(0.012, 0.012, -rz - 1.9), glow(0xb040ff), sd * 0.74, 0.74, (rz + 1.5) / 2).material); add(new THREE.BoxGeometry(0.04, 0.6, -rz - 1.6), leather, sd * 0.86, 0.0, (rz + 1.6) / 2 - 0.15); }
      add(new THREE.BoxGeometry(1.4, 0.3, 0.4), leather, 0, -0.25, rz + 0.45); add(new THREE.BoxGeometry(1.4, 0.5, 0.12), leather, 0, 0.05, rz + 0.3);
      add(new THREE.BoxGeometry(0.5, 0.42, 0.3), M.wood, 0, -0.22, -1.2); for (let k = 0; k < 5; k++) { add(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 10), mat([0x0e3d14, 0x5a2a08, 0xe8e0c0, 0x0e3d14, 0x2a0a30][k], { roughness: 0.1 }), -0.18 + k * 0.09, 0.09, -1.2); add(new THREE.CylinderGeometry(0.008, 0.012, 0.06, 8), gold, -0.18 + k * 0.09, 0.21, -1.2); }
      this.disco = new THREE.Group(); this.disco.position.set(0, 0.6, (rz - 1.6) / 2); I.add(this.disco); tube(V(0, 0.77, (rz - 1.6) / 2), V(0, 0.66, (rz - 1.6) / 2), 0.003, M.alu);
      { const db = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), mat(0xdadfe6, { metalness: 1, roughness: 0.12, flatShading: true })); this.disco.add(db); }
    }
  }
  person(suit, helm) {
    const g = new THREE.Group(), cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const hexs = '#' + suit.toString(16).padStart(6, '0'), hexh = '#' + helm.toString(16).padStart(6, '0');
    // race suit: base colour, contrasting side stripes, sponsor patches, seams
    const suitT = cv(256, 256, x => { x.fillStyle = hexs; x.fillRect(0, 0, 256, 256); x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, 18, 256); x.fillRect(238, 0, 18, 256); x.fillStyle = '#c81e1e'; x.fillRect(18, 0, 8, 256); x.fillRect(230, 0, 8, 256);
      const pc = ['#f2b632', '#ffffff', '#1e6fd0', '#e33']; for (let i = 0; i < 6; i++) { x.fillStyle = pc[i % 4]; x.fillRect(60 + (i % 2) * 80, 40 + (i >> 1) * 52, 54, 22); x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(66 + (i % 2) * 80, 48 + (i >> 1) * 52, 40, 6); }
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.stroke(); for (let i = 0; i < 1500; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } });
    const sm = new THREE.MeshStandardMaterial({ map: suitT, roughness: 0.85 }), plain = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 }), black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    // helmet: team colour, a stripe and a number
    const helmT = cv(256, 128, x => { x.fillStyle = hexh; x.fillRect(0, 0, 256, 128); x.fillStyle = '#111'; x.fillRect(0, 54, 256, 10); x.fillStyle = '#c81e1e'; x.fillRect(0, 64, 256, 6); x.fillStyle = '#111'; x.font = 'bold 34px system-ui'; x.textAlign = 'center'; x.fillText('7', 192, 44); x.fillText('7', 64, 44); });
    const hm = new THREE.MeshPhysicalMaterial({ map: helmT, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }), vis = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.05, metalness: 0.4, clearcoat: 1 });
    // torso: a lathe from waist to shoulders, slightly flattened front-to-back
    const prof = [[0.0, -0.62], [0.15, -0.6], [0.16, -0.45], [0.175, -0.3], [0.19, -0.2], [0.2, -0.14], [0.15, -0.09], [0.06, -0.07], [0.0, -0.07]].map(p => new THREE.Vector2(p[0], p[1]));
    const tg = new THREE.LatheGeometry(prof, 16); tg.scale(1, 1, 0.68);
    const torso = new THREE.Mesh(tg, sm); torso.position.set(0, -0.05, -0.1); torso.rotation.x = 0.12; g.add(torso);
    for (const x0 of [-0.2, 0.2]) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), plain); sh.position.set(x0, -0.19, -0.1); g.add(sh); }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })); neck.position.set(0, -0.06, -0.07); g.add(neck);
    // HANS collar on the shoulders
    const hans = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 16, Math.PI * 1.25), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.2 })); hans.rotation.set(Math.PI / 2, 0, Math.PI * 0.375 + Math.PI); hans.position.set(0, -0.12, -0.1); g.add(hans);
    // legs: thighs forward to the knees, shins down to the pedals, boots
    for (const x0 of [-0.1, 0.1]) {
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.46, 10), plain); th.rotation.x = Math.PI / 2 - 0.12; th.position.set(x0, -0.6, 0.12); g.add(th);
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), plain); kn.position.set(x0, -0.57, 0.35); g.add(kn);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.42, 10), plain); sh.rotation.x = 0.55; sh.position.set(x0, -0.73, 0.45); g.add(sh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.24), black); boot.position.set(x0, -0.9, 0.6); g.add(boot);
    }
    // straps: shoulder belts over the suit and a lap belt
    const strapM = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.7 }), straps = new THREE.Group(); g.add(straps);
    for (const x of [-0.08, 0.08]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.44, 0.012), strapM); st.position.set(x, -0.33, 0.035); st.rotation.x = 0.12; straps.add(st); }
    { const lap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.012), strapM); lap.position.set(0, -0.55, 0.05); straps.add(lap); const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 14), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })); buckle.rotation.x = Math.PI / 2; buckle.position.set(0, -0.52, 0.06); straps.add(buckle); }
    // head: helmet shell, visor, chin bar, intercom boom mic
    const headG = new THREE.Group(); headG.position.set(0, 0.03, -0.05); g.add(headG);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 18), hm); shell.scale.set(1, 1.08, 1.12); headG.add(shell);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.139, 24, 10, -1.0, 2.0, 1.15, 0.6), vis); visor.scale.set(1, 1.08, 1.12); headG.add(visor);
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 16, Math.PI * 0.75), hm); chin.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI * 0.125 + Math.PI / 2 - Math.PI * 0.375); chin.position.set(0, -0.075, 0.03); headG.add(chin);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), black); mic.rotation.set(Math.PI / 2, 0, 0.4); mic.position.set(0.05, -0.07, 0.14); headG.add(mic);
    const armM = plain, glove = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    const mkArm = () => { const u = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 1, 10), armM), f = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1, 10), armM), cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 10), glove), h = new THREE.Group(); const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.09), glove); palm.position.z = 0.03; const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), glove); thumb.position.set(0.035, 0, 0.02); thumb.rotation.z = 0.8; h.add(palm, thumb, cuff); cuff.rotation.x = Math.PI / 2; cuff.position.z = -0.025; g.add(u, f, h); return { u, f, h }; };
    return { g, headG, torso, straps, collar: [neck, hans], arms: [mkArm(), mkArm()] };
  }
  // two-bone arm: shoulder -> elbow (bent down and out) -> hand
  setArm(arm, from, to, out) {
    const L1 = 0.31, L2 = 0.3, d = new THREE.Vector3().subVectors(to, from), D = Math.min(d.length(), L1 + L2 - 0.005), dir = d.clone().normalize();
    const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D), hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = new THREE.Vector3(out || 0, -1, -0.3).normalize(); pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = from.clone().addScaledVector(dir, a).addScaledVector(pole, hgt), hand = from.clone().addScaledVector(dir, D);
    const seg = (m, p, q) => { const v = new THREE.Vector3().subVectors(q, p); m.scale.set(1, v.length(), 1); m.position.copy(p).addScaledVector(v, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); };
    seg(arm.u, from, elbow); seg(arm.f, elbow, hand); arm.h.position.copy(hand); arm.h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().subVectors(hand, elbow).normalize());
  }
  // st: {pos, q, steer, comp[4], spin, speed, hb, rpm, gear}; me: 'drv'|'nav'; look: {yaw,pitch}; navLook: other player's head yaw
  update(st, dt, me, look, other) {
    const g = this.g; g.position.copy(st.pos); g.quaternion.copy(st.q); g.updateMatrixWorld();
    // wheels
    this.wheels.forEach((w, i) => {
      const comp = st.comp ? st.comp[i] : 0.1; w.g.position.set(w.a.x, w.a.y - (this.crest - comp) - (this.cr - w.rv), w.a.z);
      w.g.rotation.y = i < 2 ? st.steer : 0; w.spin.rotation.x += (st.spinW !== undefined ? st.spinW * (st.wr || CAR.r) / this.cr : st.speedF / this.cr) * dt;
    });
    // steering wheel: ~14:1 ratio, a full lock is about 1.4 turns lock to lock
    const swA = -st.steer * 9; this.wheelG.rotation.z = swA; this.wheelG.rotation.x = -0.55; this.wheelG.updateMatrixWorld();
    this.hbL.rotation.x = st.hb ? -0.55 : -0.15;
    // crew: driver's hands on the rim, navigator holds the board
    const I = this.interior, D = this.crew.drv, N = this.crew.nav, rimPt = a => { const p = new THREE.Vector3(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.02); p.applyEuler(new THREE.Euler(-0.55, 0, 0, 'XYZ')); return p.add(this.wheelG.position).sub(D.g.position); };
    // shuffle steering: each hand holds the rim and turns with it, but past ~75 degrees from its home it lets go and re-grips
    // further round (hand over hand), so the arms never wind up; the hand slides smoothly to its new grip
    const hand = (k, home) => { const gk = 'grip' + k, dk = 'hd' + k; if (this[gk] === undefined) { this[gk] = home; this[dk] = home; }
      let a = this[gk] - swA; if (a - home > 1.3) this[gk] -= 1.9; else if (a - home < -1.3) this[gk] += 1.9; a = this[gk] - swA; // the rim turns by swA, which moves a rim point's angle by -swA
      this[dk] += (a - this[dk]) * Math.min(1, dt * 16); return this[dk]; };
    this.setArm(D.arms[0], new THREE.Vector3(0.2, -0.2, -0.1), rimPt(hand(0, 1.4)), 1); this.setArm(D.arms[1], new THREE.Vector3(-0.2, -0.2, -0.1), rimPt(hand(1, -1.4)), -1);
    D.headG.visible = D.straps.visible = me !== 'drv'; N.headG.visible = N.straps.visible = me !== 'nav'; for (const o of D.collar) o.visible = me !== 'drv'; for (const o of N.collar) o.visible = me !== 'nav';
    D.headG.rotation.set(-(me === 'drv' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'drv' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    N.headG.rotation.set(-(me === 'nav' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'nav' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    // map board: on the lap, raised in front of the face when held up
    const tgt = me === 'nav' && look.map ? 0.35 : (me !== 'nav' && other && other.map ? 1 : 0); this.mapUp += (tgt - this.mapUp) * Math.min(1, dt * 9); const u = sstep(0, 1, this.mapUp);
    this.board.position.set(-0.37, lerp(0.0, 0.35, u), lerp(-0.02, 0.0, u)); this.board.rotation.set(lerp(-0.35, -1.38, u), 0, 0);
    const bp = this.board.position.clone().sub(N.g.position);
    this.setArm(N.arms[0], new THREE.Vector3(0.2, -0.2, -0.1), bp.clone().add(new THREE.Vector3(0.15, 0, 0.05)), 1); this.setArm(N.arms[1], new THREE.Vector3(-0.2, -0.2, -0.1), bp.clone().add(new THREE.Vector3(-0.15, 0, 0.05)), -1);
    this.crackM.opacity = clamp(((st.dmg || 0) - 0.12) * 1.4, 0, 0.85);
    if (this.popups) { const up = st.hl ? 1 : 0; for (const p of this.popups) p.rotation.x += (-up * 1.05 - p.rotation.x) * Math.min(1, dt * 6); }
    if (this.dogTail) { this.dogT = (this.dogT || 0) + dt * (6 + Math.min(10, st.speed * 0.3)); this.dogTail.rotation.y = Math.sin(this.dogT) * 0.6; this.dogHead.rotation.y = Math.sin(this.dogT * 0.13) * 0.5; }
    if (this.remote) return;
    // dials: rev counter 0..8000 and speedo 0..200 over 270 degrees
    const ang = f => (135 - clamp(f, 0, 1) * 270) * Math.PI / 180;
    this.needleP.rotation.z = ang(st.rpm / 8000); this.speedN.rotation.z = ang(Math.min(1.02, st.speed * 3.6 / this.vDial));
    // shift lights fill up from green to red, all flash at the limiter
    const sl = clamp((st.rpm - 4600) / (CAR.red - 300 - 4600), 0, 1), flash = st.rpm > CAR.red - 300 && (performance.now() / 70 | 0) % 2;
    this.leds.forEach((m, i) => m.color.setHex(flash ? 0xff2020 : (i + 0.5) / 7 < sl ? this.ledCol[i] : 0x151515));
    if (st.gear !== this.lastGear) { this.shiftA = st.gear > this.lastGear ? 1 : -1; this.lastGear = st.gear; }
    this.shiftA *= Math.max(0, 1 - dt * 9); this.shiftL.rotation.x = -0.35 + this.shiftA * 0.28;
    // switches: IGN always on, WIPE and LIGHTS follow their state
    const on = st.sw || [1, 1, 0, st.wp ? 1 : 0, st.hl ? 1 : 0, 0];
    for (const b of this.toggles) { const k = b.i, hov = this.hoverSw === k; b.cap.position.z += ((on[k] ? -0.003 : -0.008) - b.cap.position.z) * Math.min(1, dt * 25); b.led.material.color.setHex(on[k] ? this.btnCol[k] : 0x1a1a1a); b.face.emissiveIntensity = hov ? 0.55 : 0.18; b.cap.scale.setScalar(hov ? 1.06 : 1); }
    // headlights
    // lamps glow, they don't blow out into white slabs; low beam dips onto the road ahead, the spot lights add a long high beam
    this.lampM.emissiveIntensity = st.hl ? (st.spot ? 4.5 : 2.6) : 0.25;
    if (this.spotMode !== (st.hl ? (st.spot ? 2 : 1) : 0)) { this.spotMode = st.hl ? (st.spot ? 2 : 1) : 0; const hi = this.spotMode === 2;
      for (const sp of this.spots) { sp.intensity = this.spotMode ? (hi ? 210 : 75) : 0; sp.distance = hi ? 260 : 120; sp.angle = hi ? 0.32 : 0.42; sp.penumbra = hi ? 0.5 : 0.7; sp.target.position.set(sp.userData.sd * (hi ? 0.35 : 0.9), hi ? -0.7 : -1.6, sp.position.z + (hi ? 45 : 22)); sp.target.updateMatrixWorld(); } }
    // wipers sweep while switched on and finish their stroke when switched off
    const TAU = Math.PI * 2; if (st.wp || this.wipeT % TAU > 0.05) { this.wipeT += dt * 2.6; if (!st.wp && this.wipeT % TAU < dt * 2.6 + 0.02) this.wipeT = Math.round(this.wipeT / TAU) * TAU; }
    const wa = 0.06 + (1 - Math.cos(this.wipeT)) / 2 * 1.72; for (const w of this.wipers) w.rotation.z = -wa;
    if (!this.remote) { if (World.S && World.S.cfg && World.S.cfg.wet) this.wet += dt * 0.1 * (1 + (st.speed || 0) / 25); if (st.wp || this.wipeT % TAU > 0.05) this.wet -= dt * 0.8; this.wet = clamp(this.wet, 0, 1); this.dropM.opacity = this.wet * 0.8; }
    if (this.disco) { this.disco.rotation.y += dt * 1.6; const tt = performance.now() / 1000; this.party.forEach((m, k) => m.color.setHSL((tt * 0.15 + k * 0.5) % 1, 0.9, 0.55)); }
    if (this.lcdC && (this.lcdTk = (this.lcdTk || 0) + dt) > 0.066) { this.lcdTk = 0; const x = this.lcdC.getContext('2d'), W = 512, H = 208, acc = '#' + (this.cab.pipe || 0xff6a10).toString(16).padStart(6, '0');
      x.fillStyle = this.cab.ev ? '#f4f6f8' : '#050607'; x.fillRect(0, 0, W, H); const fg = this.cab.ev ? '#101418' : '#f2f2f2', rr = clamp(st.rpm / CAR.red, 0, 1);
      for (let i = 0; i < 24; i++) { const on = (i + 0.5) / 24 < rr; x.fillStyle = on ? (i > 20 ? '#ff2a2a' : i > 16 ? '#ffc020' : acc) : (this.cab.ev ? '#dde2e6' : '#1a1c20'); x.fillRect(14 + i * 20.5, 12, 17, 26); }
      x.fillStyle = fg; x.font = 'bold 110px system-ui'; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillText(String(Math.round(st.speed * 3.6)), 210, 165); x.font = 'bold 22px system-ui'; x.globalAlpha = 0.6; x.fillText('KM/H', 210, 194); x.globalAlpha = 1;
      x.strokeStyle = acc; x.lineWidth = 5; x.strokeRect(372, 56, 112, 132); x.fillStyle = acc; x.font = 'bold 100px system-ui'; x.fillText(CAR.ev ? 'D' : String(st.gear), 428, 160);
      x.fillStyle = fg; x.globalAlpha = 0.55; x.font = 'bold 18px monospace'; x.textAlign = 'left'; x.fillText(CAR.ev ? 'BATT ' + Math.max(1, 100 - Math.round((st.prog || 0) / 90)) + '%' : 'OIL 104°  TURBO 1.4', 16, 196); x.globalAlpha = 1; this.lcdT.needsUpdate = true; }
    if (this.evC && (this.evTk = (this.evTk || 0) + dt) > 0.25) { this.evTk = 0; const x = this.evC.getContext('2d'), W = 256, H = 360;
      x.fillStyle = '#0d1014'; x.fillRect(0, 0, W, H); x.fillStyle = '#1a2a22'; x.fillRect(0, 0, W, 230); x.strokeStyle = '#2c3a33'; x.lineWidth = 1; for (let i = 0; i < W; i += 24) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 40, 230); x.stroke(); }
      x.strokeStyle = '#20e0ff'; x.lineWidth = 7; x.beginPath(); x.moveTo(128, 230); const ph = (st.prog || 0) * 0.02; for (let k = 1; k < 8; k++) x.lineTo(128 + Math.sin(ph + k * 0.6) * 60 * (k / 7), 230 - k * 32); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(128, 200); x.lineTo(116, 226); x.lineTo(140, 226); x.fill();
      x.fillStyle = '#e8eef2'; x.font = 'bold 54px system-ui'; x.textAlign = 'left'; x.fillText(String(Math.round(st.speed * 3.6)), 18, 296); x.font = '16px system-ui'; x.fillStyle = '#8a98a4'; x.fillText('km/h', 20, 318); x.textAlign = 'right'; x.fillStyle = '#e8eef2'; x.font = 'bold 22px system-ui'; x.fillText('Ludicrous', 238, 286); x.fillStyle = '#8a98a4'; x.font = '15px system-ui'; x.fillText('mode: on', 238, 306);
      const bt = Math.max(0.05, 1 - (st.prog || 0) / 9000); x.fillStyle = '#26303a'; x.fillRect(18, 334, 220, 12); x.fillStyle = bt < 0.2 ? '#ff4040' : '#3ce07a'; x.fillRect(18, 334, 220 * bt, 12); this.evT.needsUpdate = true; }
    if ((this.dashTk = (this.dashTk || 0) + dt) > 0.1) {
      this.dashTk = 0;
      const t = this.tripC.getContext('2d'); t.fillStyle = '#100a04'; t.fillRect(0, 0, 320, 84); t.fillStyle = '#ff9a2a'; t.shadowColor = '#ff7a10'; t.shadowBlur = 8; t.font = 'bold 40px monospace'; t.textAlign = 'left';
      const clk = Math.max(0, st.clock || 0), mm = Math.floor(clk / 60), ss = Math.floor(clk % 60); t.fillText((Math.max(0, (st.prog || 0) - (World.startS || 40)) / 1000).toFixed(2), 16, 56); t.textAlign = 'right'; t.fillText(String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'), 304, 56); t.shadowBlur = 0;
      this.tripT.needsUpdate = true;
    }
  }
  // render the rear-view mirror image (call after the main frame is set up)
  renderMirror(R, scene, st) {
    const c = this.mirrorCam; c.position.set(0, 0.68, 0.25 + this.zo).applyQuaternion(st.q).add(st.pos); c.quaternion.copy(st.q); c.updateMatrixWorld();
    this.mirror.visible = false; const prev = R.getRenderTarget(); R.setRenderTarget(this.mirrorRT); R.render(scene, c); R.setRenderTarget(prev); this.mirror.visible = true;
  }
  // first-person camera: seat + head lag from body acceleration + mouse look
  camera(cam, st, me, look, dt) {
    const seat = SEAT[me].clone().add(EYE_OFF), acc = new THREE.Vector3(); seat.z += this.zo;
    if (this.prevV) acc.subVectors(st.vel, this.prevV).divideScalar(Math.max(dt, 1e-3)); this.prevV = (this.prevV || new THREE.Vector3()).copy(st.vel);
    const iq = st.q.clone().invert(), al0 = acc.applyQuaternion(iq); this.accF = (this.accF || new THREE.Vector3()).lerp(al0, Math.min(1, dt * 8)); const al = this.accF; // body-frame acceleration, smoothed so a twitch of the wheel doesn't throw your head
    // spring-damper head: pushed opposite to the acceleration
    const k = 120, c = 22, tgt = new THREE.Vector3(clamp(-al.x * 0.0025, -0.045, 0.045), clamp(-al.y * 0.003, -0.06, 0.06), clamp(-al.z * 0.0035, -0.06, 0.06));
    const f = tgt.sub(this.head).multiplyScalar(k).addScaledVector(this.headV, -c); this.headV.addScaledVector(f, Math.min(dt, 0.05)); this.head.addScaledVector(this.headV, Math.min(dt, 0.05));
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.02, rough = (st.offroad || 0) * 0.006 * Math.min(1, st.speed / 10) + (st.speed / 40) ** 2 * 0.004;
    const hp = new THREE.Vector3(seat.x + this.head.x + (Math.random() - 0.5) * (sh + rough), seat.y + this.head.y + (Math.random() - 0.5) * (sh + rough), seat.z + this.head.z);
    cam.position.copy(hp).applyQuaternion(st.q).add(st.pos);
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw + Math.PI, -this.head.x * 0.4, 'YXZ'));
    // camera looks down -z; car forward is +z, hence the extra half turn
    cam.quaternion.copy(st.q).multiply(lq);
    cam.fov = lerp(cam.fov, 68 + Math.min(24, (st.speed * 3.6 / 160) ** 1.3 * 24), Math.min(1, dt * 3)); cam.updateProjectionMatrix();
  }
}
