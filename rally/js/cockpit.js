'use strict';
// The car you sit in: exterior shell (shadows, hood view), wheels, roll-caged interior, dash display,
// driver and co-driver figures, the navigator's clipboard map, and the first-person head camera.
// Car local frame: +z forward, +y up, +x LEFT. Left-hand drive: driver seat x = +0.37, navigator x = -0.37.
// eye sits forward of the body, close to the windscreen (like a real in-car camera)
const EYE_OFF = new THREE.Vector3(0, -0.01, 0.27);
const SWITCH_NAMES = ['IGNITION', 'FUEL PUMP', 'FAN', 'WIPERS', 'HEADLIGHTS', 'SPOT LIGHTS'];
const SEAT = { drv: new THREE.Vector3(0.37, 0.49, -0.34), nav: new THREE.Vector3(-0.37, 0.47, -0.34) };

class CarView {
  constructor(scene, opt) {
    opt = opt || {}; const g = this.g = new THREE.Group(); scene.add(g);
    const paint = new THREE.MeshPhysicalMaterial({ color: opt.color || 0x1d4fbf, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.7 }), satin = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.15 });
    const cageM = new THREE.MeshStandardMaterial({ color: 0xc8c9cc, metalness: 0.8, roughness: 0.35 }), trim = new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.9 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, metalness: 0.1, roughness: 0.35, clearcoat: 1 }), orange = new THREE.MeshPhysicalMaterial({ color: 0xff7a1a, roughness: 0.35, clearcoat: 1 });
    this.mats = { paint, black, satin, cageM, trim };
    // ---- exterior shell: side profile extruded across the width ----
    const prof = [[-2.04, -0.42], [-2.09, -0.05], [-2.05, 0.22], [-1.92, 0.55], [-1.55, 0.75], [-0.6, 0.79], [0.32, 0.77], [0.98, 0.26], [1.6, 0.18], [1.98, 0.1], [2.1, -0.08], [2.08, -0.42]];
    const sh = new THREE.Shape(); prof.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
    const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3, steps: 1, curveSegments: 4 });
    bodyGeo.translate(0, 0, -0.81); bodyGeo.rotateY(-Math.PI / 2); // extrude axis -> x, profile x -> z
    const body = new THREE.Mesh(bodyGeo, paint); body.castShadow = true; g.add(body); this.body = body;
    // livery stripes on the hood and roof (outside only)
    for (const x of [0.16, -0.16]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 1.05), white); st.position.set(x, 0.205, 1.5); st.rotation.x = -0.09; g.add(st); const rf = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 1.6), white); rf.position.set(x, 0.875, -0.6); g.add(rf); }
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.28), black); vent.position.set(0, 0.22, 1.25); vent.rotation.x = -0.09; g.add(vent);
    for (const sd of [1, -1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 3.0), orange); s.position.set(sd * 0.895, -0.12, 0); g.add(s); }
    // lights, grille, mud flaps, spoiler
    const lampM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.4, roughness: 0.1 });
    this.lampM = lampM;
    // headlights: real spot lights on your own car (switch with H)
    this.spots = []; if (!opt.remote) for (const sd of [1, -1]) { const sp = new THREE.SpotLight(0xfff0d8, 0, 160, 0.38, 0.55, 1.2); sp.position.set(sd * 0.55, 0.06, 2.15); sp.target.position.set(sd * 0.6, -0.8, 30); g.add(sp, sp.target); this.spots.push(sp); }
    for (const sd of [1, -1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), lampM); l.position.set(sd * 0.55, 0.06, 2.12); g.add(l); const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0x500000, roughness: 0.2 })); r.position.set(sd * 0.6, 0.2, -2.13); g.add(r); }
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.32), black); spoiler.position.set(0, 0.86, -1.82); g.add(spoiler);
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
    const M = this.imats = CarView.materials();
    const tube = (a, b, r, m) => { const d = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m || cageM); c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); I.add(c); return c; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z), add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); I.add(m); return m; };
    // ---- classic rally dash: grey lower dash and centre stack, black top pad, black binnacle with red piping ----
    const grey = new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.68 }), blk = M.plastic;
    { const pr = [[0.99, 0.24], [0.8, 0.255], [0.62, 0.225], [0.52, 0.185], [0.47, 0.11], [0.44, 0.0], [0.4, -0.12], [0.37, -0.24], [0.62, -0.26], [0.99, -0.2]], shp = new THREE.Shape(); pr.forEach((q, i) => i ? shp.lineTo(q[0], q[1]) : shp.moveTo(q[0], q[1]));
      const dg = new THREE.ExtrudeGeometry(shp, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 }); dg.translate(0, 0, -0.78); dg.rotateY(-Math.PI / 2); I.add(new THREE.Mesh(dg, grey));
      const top = [[0.99, 0.243], [0.8, 0.258], [0.62, 0.228], [0.53, 0.19], [0.55, 0.16], [0.99, 0.2]], ts = new THREE.Shape(); top.forEach((q, i) => i ? ts.lineTo(q[0], q[1]) : ts.moveTo(q[0], q[1]));
      const tg = new THREE.ExtrudeGeometry(ts, { depth: 1.6, bevelEnabled: false }); tg.translate(0, 0.004, -0.8); tg.rotateY(-Math.PI / 2); I.add(new THREE.Mesh(tg, blk)); }
    // binnacle: a black pod facing the driver with a hood over it
    add(new THREE.BoxGeometry(0.46, 0.2, 0.1), blk, 0.37, 0.2, 0.5, -0.2);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24, 1, true, -Math.PI / 2, Math.PI), blk, 0.37, 0.235, 0.52, Math.PI / 2 - 0.2, 0, Math.PI / 2).material.side = THREE.DoubleSide;
    // red dashed piping along the binnacle and the dash edge
    { const red = new THREE.MeshBasicMaterial({ color: 0xc41e1e }); for (let i = 0; i < 26; i++) { const t = i / 25, x = 0.62 - t * 0.9, y = 0.268 - Math.abs(t - 0.28) * 0.06, z = 0.47 + Math.abs(t - 0.28) * 0.02; if (i % 2) continue; add(new THREE.BoxGeometry(0.03, 0.004, 0.004), red, x, y, z, 0, 0, (t < 0.28 ? -1 : 1) * 0.07); } }
    // two big analog dials: speedo (0-200 km/h) and rev counter (0-8), white bezels, orange needles
    const dial = (max, step, sub, unit, red) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#0d0e10'; x.beginPath(); x.arc(128, 128, 127, 0, 7); x.fill();
      const n = max / sub; for (let i = 0; i <= n; i++) { const a = (-225 + i / n * 270) * Math.PI / 180, v = i * sub, big = v % step === 0, r0 = big ? 94 : 104; x.strokeStyle = red && v >= red ? '#e33' : '#f2f2f2'; x.lineWidth = big ? 5 : 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); x.stroke();
        if (big) { x.fillStyle = red && v >= red ? '#e33' : '#fff'; x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(max > 20 ? v : v), 128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); } }
      x.fillStyle = '#ccc'; x.font = '16px system-ui'; x.textAlign = 'center'; x.fillText(unit, 128, 196); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const bezel = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.4 }), dialRot = [-0.2, Math.PI, 0];
    const mkDial = (x, tex) => { const d = add(new THREE.CircleGeometry(0.074, 40), new THREE.MeshBasicMaterial({ map: tex }), x, 0.205, 0.448, ...dialRot); const bz = add(new THREE.TorusGeometry(0.079, 0.01, 10, 40), bezel, x, 0.205, 0.447, ...dialRot);
      const ng = new THREE.Group(); ng.position.copy(d.position); ng.rotation.copy(d.rotation); I.add(ng); const piv = new THREE.Group(); ng.add(piv); const n = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.064, 0.002), new THREE.MeshBasicMaterial({ color: 0xff6a10 })); n.position.set(0, 0.024, 0.003); piv.add(n); const cap = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshBasicMaterial({ color: 0xff6a10 })); cap.position.z = 0.004; ng.add(cap); return piv; };
    this.speedN = mkDial(0.462, dial(200, 50, 10, 'km/h')); this.needleP = mkDial(0.278, dial(8, 1, 0.5, 'x1000 rpm', 7));
    // warning lamps between the dials
    [[0xd01818, 0.232], [0xe0a010, 0.212], [0x1e50d0, 0.192]].forEach(([c, y]) => add(new THREE.BoxGeometry(0.012, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: c }), 0.37, y, 0.452, -0.2));
    // shift-light pod on top of the binnacle: 3 green, 2 yellow, 2 red
    add(new THREE.BoxGeometry(0.22, 0.04, 0.035), blk, 0.37, 0.31, 0.47, -0.2);
    this.leds = []; this.ledCol = [0x20ff40, 0x20ff40, 0x20ff40, 0xffc020, 0xffc020, 0xff2020, 0xff2020];
    for (let i = 0; i < 7; i++) { const m = new THREE.MeshBasicMaterial({ color: 0x151515 }); add(new THREE.CircleGeometry(0.0115, 16), m, 0.45 - i * 0.027, 0.311, 0.4515, -0.2, Math.PI, 0); add(new THREE.TorusGeometry(0.0125, 0.0025, 6, 16), bezel, 0.45 - i * 0.027, 0.311, 0.451, -0.2, Math.PI, 0); this.leds.push(m); }
    this.dashC = document.createElement('canvas'); this.dashC.width = 4; this.dashC.height = 4; this.dashT = new THREE.CanvasTexture(this.dashC);
    // slatted vents: driver's left, both sides of the centre stack, co-driver's right
    const ventS = (x, y, z, w) => { add(new THREE.BoxGeometry(w, 0.055, 0.02), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 }), x, y, z, -0.15); for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(w - 0.01, 0.006, 0.018), grey, x, y - 0.019 + i * 0.013, z - 0.006, -0.15); };
    ventS(0.68, 0.12, 0.47, 0.1); ventS(0.07, 0.13, 0.452, 0.1); ventS(-0.07, 0.13, 0.452, 0.1); ventS(-0.68, 0.12, 0.47, 0.1);
    // ignition key on the driver's left
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }), 0.62, 0.03, 0.46, Math.PI / 2 - 0.15); add(new THREE.BoxGeometry(0.006, 0.026, 0.01), M.alu, 0.62, 0.03, 0.452, -0.15);
    // centre stack: two small gauges, the labelled switch panel with real toggles, lamps and a start button
    add(new THREE.BoxGeometry(0.3, 0.3, 0.02), grey, 0, -0.02, 0.462, -0.15);
    for (const x of [0.045, -0.045]) { add(new THREE.CircleGeometry(0.026, 24), new THREE.MeshBasicMaterial({ map: dial(150, 50, 10, '') }), x, 0.07, 0.448, -0.15, Math.PI, 0); add(new THREE.TorusGeometry(0.028, 0.004, 6, 24), bezel, x, 0.07, 0.447, -0.15, Math.PI, 0); }
    { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#16171a'; x.fillRect(0, 0, 512, 256); x.fillStyle = '#ddd'; x.font = 'bold 22px system-ui'; x.textAlign = 'center';
      ['IGN', 'FUEL', 'FAN', 'WIPE', 'LIGHTS', 'SPOTS'].forEach((t, i) => x.fillText(t, 50 + i * 82, 34)); x.fillText('START', 440, 200); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      add(new THREE.PlaneGeometry(0.27, 0.135), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.1 }), 0, -0.07, 0.449, -0.15, Math.PI, 0); }
    this.toggles = []; this.hits = []; for (let i = 0; i < 6; i++) { const tg = new THREE.Group(); tg.position.set(0.11 - i * 0.0435, -0.04, 0.446); tg.rotation.x = -0.15; I.add(tg); const hit = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.08, 0.05), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = -0.005; hit.userData.sw = i; tg.add(hit); this.hits.push(hit); const base = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10), M.alu); base.rotation.x = Math.PI / 2; tg.add(base); const lever = new THREE.Group(); tg.add(lever); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.03, 8), M.alu); l.position.y = 0.015; lever.add(l); const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, 0.012, 10), new THREE.MeshStandardMaterial({ color: [0xd01818, 0x222222, 0x222222, 0xe0b020, 0xe0b020, 0x222222][i] })); tip.position.y = 0.032; lever.add(tip); lever.rotation.x = -2.2; this.toggles.push(lever); }
    [[0xff3030, 0.09], [0xffc020, 0.06], [0x30ff60, 0.03]].forEach(([c, x], i) => { const m = new THREE.MeshBasicMaterial({ color: c }); add(new THREE.SphereGeometry(0.007, 10, 8), m, x, -0.11, 0.447); });
    add(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 14), new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.4 }), -0.075, -0.115, 0.447, Math.PI / 2 - 0.15);
    // glovebox on the co-driver side
    add(new THREE.BoxGeometry(0.34, 0.12, 0.012), new THREE.MeshStandardMaterial({ map: M.plastic.map, color: 0xa4a8ac, roughness: 0.7 }), -0.4, 0.03, 0.452, -0.15); add(new THREE.BoxGeometry(0.06, 0.012, 0.012), M.alu, -0.4, 0.07, 0.445, -0.15);
    // ---- windscreen wipers (outside the glass), dust layer they clear ----
    { const wg = this.wsG = new THREE.Group(); wg.position.set(0, 0.515, 0.65); wg.rotation.x = Math.atan2(-0.66, 0.51); g.add(wg); const wm = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.6 }); this.wipers = [];
      for (const px of [0.55, -0.05]) { const p = new THREE.Group(); p.position.set(px, -0.4, 0.02); wg.add(p); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.014, 0.01), wm); arm.position.x = -0.25; p.add(arm); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.02), wm); blade.position.set(-0.27, 0.004, -0.006); p.add(blade); p.rotation.z = -0.06; this.wipers.push(p); }
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; const r = Math.random() * 2.5; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, r, 0, 7); x.fill(); } for (let i = 0; i < 60; i++) { x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 3; x.beginPath(); const a = Math.random() * 256; x.moveTo(a, 256); x.quadraticCurveTo(a + 40, 140, a + 10, Math.random() * 120); x.stroke(); }
      const dt2 = new THREE.CanvasTexture(c); this.dirtM = new THREE.MeshBasicMaterial({ map: dt2, transparent: true, opacity: 0, depthWrite: false, color: 0x8a7458, side: THREE.DoubleSide });
      const dm = new THREE.Mesh(new THREE.PlaneGeometry(1.46, Math.hypot(0.66, 0.51)), this.dirtM); dm.position.z = 0.004; wg.add(dm); this.dirt = 0; this.wipeT = 0; }
    // transmission tunnel, sequential lever, hydraulic handbrake
    add(new THREE.BoxGeometry(0.26, 0.26, 1.05), M.carbon, 0, -0.27, 0.05);
    this.shiftL = new THREE.Group(); this.shiftL.position.set(0.15, -0.12, 0.3); I.add(this.shiftL);
    { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.42, 8), M.alu); l.position.y = 0.21; this.shiftL.add(l); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 12), M.suede); k.position.y = 0.43; this.shiftL.add(k); this.shiftL.rotation.x = -0.35; this.lastGear = 1; this.shiftA = 0; }
    this.hbL = new THREE.Group(); this.hbL.position.set(0.15, -0.14, 0.1); I.add(this.hbL); { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.26, 8), M.alu); l.position.y = 0.13; this.hbL.add(l); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xa01414, roughness: 0.5 })); k.position.y = 0.27; this.hbL.add(k); }
    // co-driver: trip computer with a live display, gooseneck map lamp, footrest
    this.tripC = document.createElement('canvas'); this.tripC.width = 320; this.tripC.height = 84; this.tripT = new THREE.CanvasTexture(this.tripC); this.tripT.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.BoxGeometry(0.22, 0.07, 0.07), M.plastic, -0.42, 0.29, 0.6, -0.25);
    add(new THREE.PlaneGeometry(0.19, 0.05), new THREE.MeshBasicMaterial({ map: this.tripT, toneMapped: false }), -0.42, 0.292, 0.564, -0.25, Math.PI, 0);
    tube(V(-0.6, 0.24, 0.55), V(-0.58, 0.36, 0.42), 0.006, M.alu); add(new THREE.ConeGeometry(0.02, 0.04, 10, 1, true), M.plastic, -0.58, 0.36, 0.41, -1.2);
    add(new THREE.BoxGeometry(0.34, 0.02, 0.32), M.checker, -0.37, -0.36, 0.66, 0.55);
    add(new THREE.BoxGeometry(1.56, 0.02, 1.4), M.checker, 0, -0.42, 0.25); // floor plates
    // A pillars, roof liner with vent, door cards with pull straps, window net on the driver's side
    for (const sd of [1, -1]) {
      tube(V(sd * 0.77, 0.22, 0.98), V(sd * 0.66, 0.76, 0.32), 0.045, M.plastic);
      add(new THREE.BoxGeometry(0.04, 0.52, 1.45), M.carbon, sd * 0.86, -0.08, -0.25);
      add(new THREE.BoxGeometry(0.1, 0.05, 1.45), M.plastic, sd * 0.83, 0.19, -0.25);
      add(new THREE.BoxGeometry(0.02, 0.025, 0.3), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.7 }), sd * 0.835, 0.08, 0.05, 0, 0, sd * 0.4);
      add(new THREE.BoxGeometry(0.08, 0.6, 0.14), M.plastic, sd * 0.8, 0.48, -0.95);
      const mr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), black); mr.position.set(sd * 0.98, 0.3, 0.75); g.add(mr);
    }
    add(new THREE.BoxGeometry(1.5, 0.02, 2.1), M.liner, 0, 0.775, -0.6); add(new THREE.BoxGeometry(0.42, 0.03, 0.32), M.plastic, 0, 0.76, -0.2);
    // windscreen black band (frit) so the glass has an edge
    { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 256, 7); x.fillRect(0, 121, 256, 7); x.fillRect(0, 0, 5, 128); x.fillRect(251, 0, 5, 128); for (let i = 0; i < 256; i += 3) for (let j = 0; j < 0; j++) { x.beginPath(); x.arc(i + 2, 12 + j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); x.beginPath(); x.arc(i + 2, 116 - j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); }
      const t = new THREE.CanvasTexture(c); const fr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, Math.hypot(0.66, 0.51) + 0.02), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x000000 })); fr.position.set(0, 0.512, 0.645); fr.rotation.x = Math.atan2(-0.66, 0.51); g.add(fr); }
    // rear-view mirror shows a live render from behind the car
    this.mirrorRT = new THREE.WebGLRenderTarget(320, 96, { type: THREE.HalfFloatType });
    { const mg = new THREE.PlaneGeometry(0.25, 0.075), uv = mg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      add(new THREE.BoxGeometry(0.27, 0.09, 0.02), black, 0, 0.665, 0.31); this.mirror = add(mg, new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture }), 0, 0.665, 0.298, 0.08, Math.PI, 0); tube(V(0, 0.71, 0.31), V(0, 0.775, 0.33), 0.008, black); }
    this.mirrorCam = new THREE.PerspectiveCamera(42, 320 / 96, 2.25, 320);
    // roll cage with foam padding where heads and knees go
    for (const sd of [1, -1]) {
      tube(V(sd * 0.7, -0.35, -0.85), V(sd * 0.66, 0.72, -0.85), 0.022); tube(V(sd * 0.7, -0.3, 0.7), V(sd * 0.6, 0.72, 0.28), 0.02);
      tube(V(sd * 0.6, 0.72, 0.28), V(sd * 0.66, 0.72, -0.85), 0.02); tube(V(sd * 0.66, 0.72, -0.85), V(sd * 0.68, -0.25, -1.75), 0.02);
      tube(V(sd * 0.72, -0.05, 0.6), V(sd * 0.72, 0.2, -0.85), 0.018); tube(V(sd * 0.72, 0.2, 0.55), V(sd * 0.72, -0.1, -0.85), 0.018);
      tube(V(sd * 0.72, 0.13, 0.15), V(sd * 0.72, 0.03, -0.35), 0.036, M.foam);
    }
    tube(V(0.66, 0.72, -0.85), V(-0.66, 0.72, -0.85), 0.022); tube(V(0.6, 0.72, 0.28), V(-0.6, 0.72, 0.28), 0.02);
    tube(V(0.66, 0.72, -0.85), V(-0.68, -0.3, -0.85), 0.02); tube(V(0.62, 0.72, 0.28), V(-0.64, 0.72, -0.85), 0.018); tube(V(-0.62, 0.72, 0.28), V(0.64, 0.72, -0.85), 0.018);
    tube(V(0.4, 0.72, 0.28), V(-0.4, 0.72, 0.28), 0.034, M.foam);
    // bucket seats: extruded side profile with bolsters, fabric with a stitched centre
    for (const sx of [0.37, -0.37]) {
      const pr = new THREE.Shape(); pr.moveTo(0.18, -0.33); pr.lineTo(-0.28, -0.33); pr.quadraticCurveTo(-0.36, -0.3, -0.38, 0.05); pr.lineTo(-0.44, 0.68); pr.quadraticCurveTo(-0.42, 0.74, -0.34, 0.72); pr.lineTo(-0.28, 0.1); pr.quadraticCurveTo(-0.26, -0.2, -0.1, -0.21); pr.lineTo(0.18, -0.19); pr.closePath();
      for (const [w, off] of [[0.36, 0], [0.07, 0.215], [0.07, -0.215]]) { const sg = new THREE.ExtrudeGeometry(pr, { depth: w, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3 }); sg.translate(0, 0, -w / 2); sg.rotateY(-Math.PI / 2); const m = new THREE.Mesh(sg, off ? M.seatSide : M.seat); m.position.set(sx + off, 0, -0.33); if (off) m.scale.set(1, 1.02, 1); I.add(m); }
    }
    // spare wheel, extinguisher, tool bag, rear strut brace
    add(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 18), black, 0, -0.28, -1.45); add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.3 }), 0, -0.3, -0.75, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.4, 0.18, 0.25), new THREE.MeshStandardMaterial({ color: 0x1f2b4a, roughness: 0.9 }), -0.45, -0.3, -1.4);
    // steering wheel: flat-bottom suede rim, alloy spokes, quick-release hub with buttons
    const sw0 = this.wheelG = new THREE.Group(); sw0.position.set(0.37, 0.115, 0.27); sw0.rotation.x = -0.55; I.add(sw0);
    { const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, x = Math.sin(a) * 0.175, y = Math.max(Math.cos(a) * 0.175, -0.142); pts.push(new THREE.Vector3(x, y, 0)); } const path = new THREE.CatmullRomCurve3(pts, true); sw0.add(new THREE.Mesh(new THREE.TubeGeometry(path, 80, 0.018, 10, true), M.suede)); }
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.008), M.alu); sp.position.set(Math.sin(a) * 0.085, Math.cos(a) * 0.075, -0.005); sp.rotation.z = -a; sw0.add(sp); }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xffd400 })); mark.position.set(0, 0.175, 0); sw0.add(mark);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 18), M.plastic); hub.rotation.x = Math.PI / 2; sw0.add(hub);
    const qr = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 18), M.alu); qr.position.z = 0.03; sw0.add(qr);
    for (const [x, c] of [[0.065, 0xd01818], [-0.065, 0x1e6fd0]]) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10), new THREE.MeshStandardMaterial({ color: c })); bt.rotation.x = Math.PI / 2; bt.position.set(x, 0.02, -0.008); sw0.add(bt); }
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
    this.wheels = CAR.wheels.map((a, i) => {
      const w = new THREE.Group(), spin = new THREE.Group(); w.add(spin);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(CAR.r, CAR.r, 0.22, 22, 1), tyreM); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
      const rimm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.225, 6), rimG); rimm.rotation.z = Math.PI / 2; spin.add(rimm);
      for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.045, 0.03), rimG); s.rotation.x = k * Math.PI / 3; spin.add(s); }
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.012), new THREE.MeshStandardMaterial({ color: i < 2 ? 0x111111 : 0xf2f2f2 })); flap.position.set(a[0] > 0 ? 0 : 0, -0.12, -0.36); if (i >= 2) w.add(flap);
      g.add(w); return { g: w, spin, a: new THREE.Vector3(...a) };
    });
    this.head = new THREE.Vector3(); this.headV = new THREE.Vector3(); this.prevV = null; this.shake = 0;
    // the roof and pillars shade the cabin
    g.traverse(o => { if (o.isMesh && o !== wsh && o.material !== this.dashMat) { o.receiveShadow = true; if (o.parent !== g || o === body) o.castShadow = true; } });
    body.receiveShadow = false;
    // rival cars: only the shell, wheels and crew are worth drawing
    this.remote = !!opt.remote; if (this.remote) I.children.forEach(ch => { ch.visible = ch === this.crew.drv.g || ch === this.crew.nav.g; });
  }
  static materials() {
    if (CarView._M) return CarView._M;
    const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }, tx = (c, rep) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(rep, rep); return t; }, R = mulberry(5);
    const carbon = cv(128, 128, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const o = ((x + y) / 8) % 4 < 2; const gr = g.createLinearGradient(x, y, o ? x + 8 : x, o ? y : y + 8); gr.addColorStop(0, '#0d0e10'); gr.addColorStop(0.5, o ? '#2a2c31' : '#1c1d21'); gr.addColorStop(1, '#0d0e10'); g.fillStyle = gr; g.fillRect(x, y, 8, 8); } });
    const noise = (base, amp) => cv(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * amp})`; g.fillRect(R() * w, R() * h, 1.5, 1.5); } });
    const seat = cv(128, 128, (g, w, h) => { g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f3f8a'; g.fillRect(40, 0, 48, h); g.strokeStyle = 'rgba(255,255,255,.12)'; for (let y = 0; y < h; y += 10) { g.beginPath(); g.moveTo(40, y); g.lineTo(88, y); g.stroke(); } for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.05})`; g.fillRect(R() * w, R() * h, 1, 1); } });
    const checker = cv(64, 64, (g, w, h) => { g.fillStyle = '#8d9095'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8bcc2'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { g.save(); g.translate(x + 4 + (y / 16 % 2) * 8, y + 8); g.rotate((y / 16 % 2 ? 1 : -1) * 0.7); g.fillRect(-4, -1.2, 8, 2.4); g.restore(); } });
    const net = cv(128, 128, (g, w, h) => { g.strokeStyle = '#111'; g.lineWidth = 5; for (let i = -128; i < 256; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); } g.strokeStyle = '#c81e1e'; g.lineWidth = 10; g.strokeRect(0, 0, w, h); });
    return CarView._M = {
      carbon: new THREE.MeshPhysicalMaterial({ map: tx(carbon, 4), roughness: 0.4, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 }),
      plastic: new THREE.MeshStandardMaterial({ map: tx(noise('#1a1b1e', 0.05), 3), roughness: 0.62, metalness: 0.05 }),
      suede: new THREE.MeshStandardMaterial({ map: tx(noise('#1b1b1d', 0.08), 6), roughness: 1 }),
      liner: new THREE.MeshStandardMaterial({ map: tx(noise('#2c2e33', 0.2), 4), roughness: 1, side: THREE.DoubleSide }),
      seat: new THREE.MeshStandardMaterial({ map: tx(seat), roughness: 0.95 }), seatSide: new THREE.MeshStandardMaterial({ map: tx(noise('#141519', 0.15), 3), roughness: 0.9 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.32 }), checker: new THREE.MeshStandardMaterial({ map: tx(checker, 6), metalness: 0.7, roughness: 0.45 }),
      foam: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }), net: new THREE.MeshStandardMaterial({ map: tx(net, 3), alphaTest: 0.5, transparent: false, roughness: 0.9 }),
    };
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
      const comp = st.comp ? st.comp[i] : 0.1; w.g.position.set(w.a.x + (w.a.x > 0 ? 0.0 : 0), w.a.y - (CAR.rest - comp), w.a.z);
      w.g.rotation.y = i < 2 ? st.steer : 0; w.spin.rotation.x += (st.spinW !== undefined ? st.spinW : st.speedF / CAR.r) * dt;
    });
    // steering wheel: ~14:1 ratio, a full lock is about 1.4 turns lock to lock
    const swA = -st.steer * 9; this.wheelG.rotation.z = swA; this.wheelG.rotation.x = -0.55; this.wheelG.updateMatrixWorld();
    this.hbL.rotation.x = st.hb ? -0.55 : -0.15;
    // crew: driver's hands on the rim, navigator holds the board
    const I = this.interior, D = this.crew.drv, N = this.crew.nav, rimPt = a => { const p = new THREE.Vector3(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.02); p.applyEuler(new THREE.Euler(-0.55, 0, swA, 'XYZ')); return p.add(this.wheelG.position).sub(D.g.position); };
    this.setArm(D.arms[0], new THREE.Vector3(0.2, -0.2, -0.1), rimPt(1.4), 1); this.setArm(D.arms[1], new THREE.Vector3(-0.2, -0.2, -0.1), rimPt(-1.4), -1);
    D.headG.visible = D.straps.visible = me !== 'drv'; N.headG.visible = N.straps.visible = me !== 'nav'; for (const o of D.collar) o.visible = me !== 'drv'; for (const o of N.collar) o.visible = me !== 'nav';
    D.headG.rotation.set(-(me === 'drv' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'drv' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    N.headG.rotation.set(-(me === 'nav' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'nav' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    // map board: on the lap, raised in front of the face when held up
    const tgt = me === 'nav' && look.map ? 1 : (me !== 'nav' && other && other.map ? 1 : 0); this.mapUp += (tgt - this.mapUp) * Math.min(1, dt * 9); const u = sstep(0, 1, this.mapUp);
    this.board.position.set(-0.37, lerp(0.0, 0.35, u), lerp(-0.02, 0.0, u)); this.board.rotation.set(lerp(-0.35, -1.38, u), 0, 0);
    const bp = this.board.position.clone().sub(N.g.position);
    this.setArm(N.arms[0], new THREE.Vector3(0.2, -0.2, -0.1), bp.clone().add(new THREE.Vector3(0.15, 0, 0.05)), 1); this.setArm(N.arms[1], new THREE.Vector3(-0.2, -0.2, -0.1), bp.clone().add(new THREE.Vector3(-0.15, 0, 0.05)), -1);
    this.crackM.opacity = clamp(((st.dmg || 0) - 0.12) * 1.4, 0, 0.85);
    if (this.remote) return;
    // dials: rev counter 0..8000 and speedo 0..200 over 270 degrees
    const ang = f => (135 - clamp(f, 0, 1) * 270) * Math.PI / 180;
    this.needleP.rotation.z = ang(st.rpm / 8000); this.speedN.rotation.z = ang(st.speed * 3.6 / 200);
    // shift lights fill up from green to red, all flash at the limiter
    const sl = clamp((st.rpm - 4600) / (CAR.red - 300 - 4600), 0, 1), flash = st.rpm > CAR.red - 300 && (performance.now() / 70 | 0) % 2;
    this.leds.forEach((m, i) => m.color.setHex(flash ? 0xff2020 : (i + 0.5) / 7 < sl ? this.ledCol[i] : 0x151515));
    if (st.gear !== this.lastGear) { this.shiftA = st.gear > this.lastGear ? 1 : -1; this.lastGear = st.gear; }
    this.shiftA *= Math.max(0, 1 - dt * 9); this.shiftL.rotation.x = -0.35 + this.shiftA * 0.28;
    // switches: IGN always on, WIPE and LIGHTS follow their state
    const on = st.sw || [1, 1, 0, st.wp ? 1 : 0, st.hl ? 1 : 0, 0]; this.toggles.forEach((l, i) => { l.rotation.x += ((on[i] ? -0.95 : -2.2) - l.rotation.x) * Math.min(1, dt * 20); });
    // headlights
    this.lampM.emissiveIntensity = st.hl ? (st.spot ? 14 : 8) : 0.4; for (const sp of this.spots) { sp.intensity = st.hl ? (st.spot ? 260 : 90) : 0; sp.distance = st.spot ? 260 : 160; sp.angle = st.spot ? 0.3 : 0.38; }
    // wipers sweep while switched on and finish their stroke when switched off
    const TAU = Math.PI * 2; if (st.wp || this.wipeT % TAU > 0.05) { this.wipeT += dt * 2.6; if (!st.wp && this.wipeT % TAU < dt * 2.6 + 0.02) this.wipeT = Math.round(this.wipeT / TAU) * TAU; }
    const wa = 0.06 + (1 - Math.cos(this.wipeT)) / 2 * 1.72; for (const w of this.wipers) w.rotation.z = -wa;
    // windscreen dust builds up on loose surfaces at speed, the wipers clear it
    if (!this.remote) { const k = (World.B && (World.B.dustK || 1)) * (st.offroad > 0.5 ? 1.6 : 1); if (st.speed > 4 && !st.air) this.dirt += dt * 0.0045 * Math.min(1, st.speed / 22) * k; if (st.wp || this.wipeT % TAU > 0.05) this.dirt -= dt * 0.35; this.dirt = clamp(this.dirt, 0, 0.6); this.dirtM.opacity = this.dirt; if (World.B) this.dirtM.color.setRGB(World.B.dust[0] * 0.7, World.B.dust[1] * 0.7, World.B.dust[2] * 0.7); }
    if ((this.dashTk = (this.dashTk || 0) + dt) > 0.1) {
      this.dashTk = 0;
      const t = this.tripC.getContext('2d'); t.fillStyle = '#100a04'; t.fillRect(0, 0, 320, 84); t.fillStyle = '#ff9a2a'; t.shadowColor = '#ff7a10'; t.shadowBlur = 8; t.font = 'bold 40px monospace'; t.textAlign = 'left';
      const clk = Math.max(0, st.clock || 0), mm = Math.floor(clk / 60), ss = Math.floor(clk % 60); t.fillText((Math.max(0, (st.prog || 0) - (World.startS || 40)) / 1000).toFixed(2), 16, 56); t.textAlign = 'right'; t.fillText(String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'), 304, 56); t.shadowBlur = 0;
      this.tripT.needsUpdate = true;
    }
  }
  // render the rear-view mirror image (call after the main frame is set up)
  renderMirror(R, scene, st) {
    const c = this.mirrorCam; c.position.set(0, 0.68, 0.25).applyQuaternion(st.q).add(st.pos); c.quaternion.copy(st.q); c.updateMatrixWorld();
    this.mirror.visible = false; const prev = R.getRenderTarget(); R.setRenderTarget(this.mirrorRT); R.render(scene, c); R.setRenderTarget(prev); this.mirror.visible = true;
  }
  // first-person camera: seat + head lag from body acceleration + mouse look
  camera(cam, st, me, look, dt) {
    const seat = SEAT[me].clone().add(EYE_OFF), acc = new THREE.Vector3();
    if (this.prevV) acc.subVectors(st.vel, this.prevV).divideScalar(Math.max(dt, 1e-3)); this.prevV = (this.prevV || new THREE.Vector3()).copy(st.vel);
    const iq = st.q.clone().invert(), al = acc.applyQuaternion(iq); al.y += 0; // body-frame acceleration
    // spring-damper head: pushed opposite to the acceleration
    const k = 120, c = 16, tgt = new THREE.Vector3(clamp(-al.x * 0.004, -0.07, 0.07), clamp(-al.y * 0.003, -0.06, 0.06), clamp(-al.z * 0.0035, -0.06, 0.06));
    const f = tgt.sub(this.head).multiplyScalar(k).addScaledVector(this.headV, -c); this.headV.addScaledVector(f, Math.min(dt, 0.05)); this.head.addScaledVector(this.headV, Math.min(dt, 0.05));
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.02, rough = (st.offroad || 0) * 0.006 * Math.min(1, st.speed / 10) + (st.speed / 40) ** 2 * 0.004;
    const hp = new THREE.Vector3(seat.x + this.head.x + (Math.random() - 0.5) * (sh + rough), seat.y + this.head.y + (Math.random() - 0.5) * (sh + rough), seat.z + this.head.z);
    cam.position.copy(hp).applyQuaternion(st.q).add(st.pos);
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw + Math.PI, -this.head.x * 1.2, 'YXZ'));
    // camera looks down -z; car forward is +z, hence the extra half turn
    cam.quaternion.copy(st.q).multiply(lq);
    cam.fov = lerp(cam.fov, 68 + Math.min(24, (st.speed * 3.6 / 160) ** 1.3 * 24), Math.min(1, dt * 3)); cam.updateProjectionMatrix();
  }
}
