'use strict';
// The car you sit in: exterior shell (shadows, hood view), wheels, roll-caged interior, dash display,
// driver and co-driver figures, the navigator's clipboard map, and the first-person head camera.
// Car local frame: +z forward, +y up, +x LEFT. Left-hand drive: driver seat x = +0.37, navigator x = -0.37.
const SEAT = { drv: new THREE.Vector3(0.37, 0.43, -0.3), nav: new THREE.Vector3(-0.37, 0.41, -0.32) };

class CarView {
  constructor(scene, envOK) {
    const g = this.g = new THREE.Group(); scene.add(g);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x1d4fbf, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
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
    // dashboard: one extruded profile across the cabin (soft-touch top, fascia falling to the footwells)
    { const pr = [[0.99, 0.24], [0.8, 0.255], [0.62, 0.225], [0.52, 0.185], [0.47, 0.11], [0.45, 0.0], [0.46, -0.1], [0.62, -0.14], [0.99, -0.14]], shp = new THREE.Shape(); pr.forEach((q, i) => i ? shp.lineTo(q[0], q[1]) : shp.moveTo(q[0], q[1]));
      const dg = new THREE.ExtrudeGeometry(shp, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 }); dg.translate(0, 0, -0.78); dg.rotateY(-Math.PI / 2); I.add(new THREE.Mesh(dg, M.plastic)); }
    add(new THREE.BoxGeometry(0.62, 0.006, 0.28), M.carbon, -0.38, 0.23, 0.66, 0.1); // carbon trim on the co-driver side
    add(new THREE.BoxGeometry(0.7, 0.2, 0.004), M.carbon, -0.4, 0.04, 0.452, -0.15);
    // instrument hood, analog rev counter, digital gear/speed, shift lights
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 20, 1, true, -Math.PI / 2, Math.PI), M.plastic, 0.37, 0.205, 0.5, Math.PI / 2, 0, Math.PI / 2).material.side = THREE.DoubleSide;
    this.tachC = document.createElement('canvas'); this.tachC.width = this.tachC.height = 256; { const c = this.tachC.getContext('2d'); c.fillStyle = '#0b0c0e'; c.beginPath(); c.arc(128, 128, 126, 0, 7); c.fill(); c.strokeStyle = '#3a3d42'; c.lineWidth = 6; c.stroke();
      for (let i = 0; i <= 80; i++) { const a = (-225 + i / 80 * 270) * Math.PI / 180, big = i % 10 === 0, r0 = big ? 92 : 102; c.strokeStyle = i >= 70 ? '#e33' : '#ddd'; c.lineWidth = big ? 4 : 1.5; c.beginPath(); c.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); c.lineTo(128 + Math.cos(a) * 114, 128 + Math.sin(a) * 114); c.stroke(); if (big) { c.fillStyle = i >= 70 ? '#e33' : '#eee'; c.font = 'bold 22px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i / 10), 128 + Math.cos(a) * 74, 128 + Math.sin(a) * 74); } }
      c.fillStyle = '#888'; c.font = '12px system-ui'; c.fillText('x1000 rpm', 128, 170); }
    const tachT = new THREE.CanvasTexture(this.tachC); tachT.colorSpace = THREE.SRGBColorSpace;
    const tach = add(new THREE.CircleGeometry(0.068, 40), new THREE.MeshBasicMaterial({ map: tachT }), 0.4, 0.205, 0.45, -0.35, Math.PI, 0);
    this.needle = new THREE.Group(); this.needle.position.copy(tach.position); this.needle.rotation.copy(tach.rotation); I.add(this.needle);
    { const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.058, 0.002), new THREE.MeshBasicMaterial({ color: 0xff5020 })); n.position.set(0, 0.026, 0.002); const piv = new THREE.Group(); piv.add(n); this.needle.add(piv); this.needleP = piv; const cap = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), new THREE.MeshBasicMaterial({ color: 0x222222 })); cap.position.z = 0.003; this.needle.add(cap); }
    this.dashC = document.createElement('canvas'); this.dashC.width = 128; this.dashC.height = 96; this.dashT = new THREE.CanvasTexture(this.dashC); this.dashT.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.PlaneGeometry(0.075, 0.056), new THREE.MeshBasicMaterial({ map: this.dashT, toneMapped: false }), 0.29, 0.2, 0.452, -0.35, Math.PI, 0);
    this.leds = []; for (let i = 0; i < 9; i++) { const m = new THREE.MeshBasicMaterial({ color: 0x111111 }); add(new THREE.SphereGeometry(0.006, 8, 6), m, 0.45 - i * 0.02, 0.262, 0.478); this.leds.push(m); }
    // switch panel with labels, plus the big fire-system pull
    { const c = document.createElement('canvas'); c.width = 512; c.height = 192; const x = c.getContext('2d'); x.fillStyle = '#121315'; x.fillRect(0, 0, 512, 192); x.strokeStyle = '#2a2c30'; x.lineWidth = 4; x.strokeRect(4, 4, 504, 184);
      const lab = ['IGN', 'START', 'FUEL', 'FAN', 'WIPE', 'LIGHTS', 'SPOTS', 'ALS']; lab.forEach((t, i) => { const cx = 40 + i * 62; x.fillStyle = '#ddd'; x.font = 'bold 18px system-ui'; x.textAlign = 'center'; x.fillText(t, cx, 40); x.fillStyle = i === 0 ? '#e33' : '#3a3d42'; x.fillRect(cx - 12, 60, 24, 70); x.fillStyle = '#c8cbd0'; x.fillRect(cx - 5, i < 3 ? 64 : 100, 10, 26); x.fillStyle = i < 4 ? '#3f6' : '#333'; x.beginPath(); x.arc(cx, 160, 7, 0, 7); x.fill(); });
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; add(new THREE.PlaneGeometry(0.3, 0.112), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 }), 0.0, 0.05, 0.465, -0.15, Math.PI, 0); }
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xd01818 }), -0.17, 0.0, 0.47, Math.PI / 2);
    // transmission tunnel, sequential lever, hydraulic handbrake
    add(new THREE.BoxGeometry(0.26, 0.26, 1.05), M.carbon, 0, -0.27, 0.05);
    this.shiftL = new THREE.Group(); this.shiftL.position.set(0.15, -0.12, 0.3); I.add(this.shiftL);
    { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.42, 8), M.alu); l.position.y = 0.21; this.shiftL.add(l); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 12), M.suede); k.position.y = 0.43; this.shiftL.add(k); this.shiftL.rotation.x = -0.35; this.lastGear = 1; this.shiftA = 0; }
    this.hbL = new THREE.Group(); this.hbL.position.set(0.15, -0.14, 0.1); I.add(this.hbL); { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.36, 8), M.alu); l.position.y = 0.18; this.hbL.add(l); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.5 })); k.position.y = 0.37; this.hbL.add(k); }
    // co-driver: trip computer with a live display, gooseneck map lamp, footrest
    this.tripC = document.createElement('canvas'); this.tripC.width = 256; this.tripC.height = 112; this.tripT = new THREE.CanvasTexture(this.tripC); this.tripT.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.BoxGeometry(0.2, 0.1, 0.06), M.plastic, -0.42, 0.29, 0.52, -0.3);
    add(new THREE.PlaneGeometry(0.17, 0.075), new THREE.MeshBasicMaterial({ map: this.tripT, toneMapped: false }), -0.42, 0.288, 0.489, -0.3, Math.PI, 0);
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
    { const net = add(new THREE.PlaneGeometry(0.75, 0.38), M.net, 0.835, 0.43, -0.12, 0, Math.PI / 2); net.material.side = THREE.DoubleSide; }
    add(new THREE.BoxGeometry(1.5, 0.02, 2.1), M.liner, 0, 0.775, -0.6); add(new THREE.BoxGeometry(0.42, 0.03, 0.32), M.plastic, 0, 0.76, -0.2);
    // windscreen black band (frit) so the glass has an edge
    { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 256, 10); x.fillRect(0, 118, 256, 10); x.fillRect(0, 0, 8, 128); x.fillRect(248, 0, 8, 128); for (let i = 0; i < 256; i += 4) for (let j = 0; j < 6; j++) { x.beginPath(); x.arc(i + 2, 12 + j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); x.beginPath(); x.arc(i + 2, 116 - j * 3, 1.4 - j * 0.22, 0, 7); x.fill(); }
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
    const sw0 = this.wheelG = new THREE.Group(); sw0.position.set(0.37, 0.215, 0.24); sw0.rotation.x = -0.42; I.add(sw0);
    { const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, x = Math.sin(a) * 0.175, y = Math.max(Math.cos(a) * 0.175, -0.142); pts.push(new THREE.Vector3(x, y, 0)); } const path = new THREE.CatmullRomCurve3(pts, true); sw0.add(new THREE.Mesh(new THREE.TubeGeometry(path, 80, 0.018, 10, true), M.suede)); }
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.008), M.alu); sp.position.set(Math.sin(a) * 0.085, Math.cos(a) * 0.075, -0.005); sp.rotation.z = -a; sw0.add(sp); }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xffd400 })); mark.position.set(0, 0.175, 0); sw0.add(mark);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 18), M.plastic); hub.rotation.x = Math.PI / 2; sw0.add(hub);
    const qr = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 18), M.alu); qr.position.z = 0.03; sw0.add(qr);
    for (const [x, c] of [[0.065, 0xd01818], [-0.065, 0x1e6fd0]]) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10), new THREE.MeshStandardMaterial({ color: c })); bt.rotation.x = Math.PI / 2; bt.position.set(x, 0.02, -0.008); sw0.add(bt); }
    tube(V(0.37, 0.19, 0.3), V(0.37, 0.1, 0.55), 0.03, M.plastic);
    // pedals
    for (const [x, h] of [[0.48, 0], [0.37, 0.02], [0.27, 0]]) add(new THREE.BoxGeometry(0.07, 0.11, 0.015), M.alu, x, -0.25 + h, 0.75, 0.4);
    // ---- crew figures (race suits and helmets) ----
    this.crew = { drv: this.person(0x1f2a44, 0xf2b632), nav: this.person(0x3b2d22, 0xe0e0e0) };
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
      plastic: new THREE.MeshStandardMaterial({ map: tx(noise('#17181b', 0.18), 3), roughness: 0.85 }),
      suede: new THREE.MeshStandardMaterial({ map: tx(noise('#1b1b1d', 0.25), 6), roughness: 1 }),
      liner: new THREE.MeshStandardMaterial({ map: tx(noise('#2c2e33', 0.2), 4), roughness: 1, side: THREE.DoubleSide }),
      seat: new THREE.MeshStandardMaterial({ map: tx(seat), roughness: 0.95 }), seatSide: new THREE.MeshStandardMaterial({ map: tx(noise('#141519', 0.15), 3), roughness: 0.9 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.32 }), checker: new THREE.MeshStandardMaterial({ map: tx(checker, 6), metalness: 0.7, roughness: 0.45 }),
      foam: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }), net: new THREE.MeshStandardMaterial({ map: tx(net, 3), alphaTest: 0.5, transparent: false, roughness: 0.9 }),
    };
  }
  person(suit, helm) {
    const g = new THREE.Group(), sm = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 }), hm = new THREE.MeshPhysicalMaterial({ color: helm, roughness: 0.25, clearcoat: 1 }), vis = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.1, metalness: 0.6 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), sm); torso.position.set(0, -0.22, -0.12); torso.rotation.x = 0.15; g.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.6), sm); legs.position.set(0, -0.48, 0.2); g.add(legs);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.13), sm); shin.position.set(0, -0.55, 0.52); shin.rotation.x = 0.3; g.add(shin);
    const strapM = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.7 }), straps = new THREE.Group(); g.add(straps); for (const x of [-0.08, 0.08]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.012), strapM); st.position.set(x, -0.2, 0.06); st.rotation.x = 0.15; straps.add(st); } { const lap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.012), strapM); lap.position.set(0, -0.4, 0.05); straps.add(lap); }
    const headG = new THREE.Group(); headG.position.set(0, 0.06, -0.05); g.add(headG);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), hm); headG.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 10, -0.9, 1.8, 1.1, 0.75), vis); visor.rotation.y = Math.PI; visor.rotation.y = 0; headG.add(visor);
    const armM = sm, glove = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    const mkArm = () => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 1, 8), armM); const h = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glove); g.add(a, h); return { a, h }; };
    return { g, headG, torso, straps, arms: [mkArm(), mkArm()] };
  }
  setArm(arm, from, to) { const d = new THREE.Vector3().subVectors(to, from), L = d.length(); arm.a.scale.set(1, L, 1); arm.a.position.copy(from).addScaledVector(d, 0.5); arm.a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); arm.h.position.copy(to); }
  // st: {pos, q, steer, comp[4], spin, speed, hb, rpm, gear}; me: 'drv'|'nav'; look: {yaw,pitch}; navLook: other player's head yaw
  update(st, dt, me, look, other) {
    const g = this.g; g.position.copy(st.pos); g.quaternion.copy(st.q); g.updateMatrixWorld();
    // wheels
    this.wheels.forEach((w, i) => {
      const comp = st.comp ? st.comp[i] : 0.1; w.g.position.set(w.a.x + (w.a.x > 0 ? 0.0 : 0), w.a.y - (CAR.rest - comp), w.a.z);
      w.g.rotation.y = i < 2 ? st.steer : 0; w.spin.rotation.x += (st.spinW !== undefined ? st.spinW : st.speedF / CAR.r) * dt;
    });
    // steering wheel: ~14:1 ratio, a full lock is about 1.4 turns lock to lock
    const swA = -st.steer * 9; this.wheelG.rotation.z = swA; this.wheelG.rotation.x = -0.42; this.wheelG.updateMatrixWorld();
    this.hbL.rotation.x = st.hb ? -0.55 : -0.15;
    // crew: driver's hands on the rim, navigator holds the board
    const I = this.interior, D = this.crew.drv, N = this.crew.nav, rimPt = a => { const p = new THREE.Vector3(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.02); p.applyEuler(new THREE.Euler(-0.42, 0, swA, 'XYZ')); return p.add(this.wheelG.position).sub(D.g.position); };
    this.setArm(D.arms[0], new THREE.Vector3(0.2, -0.24, -0.08), rimPt(1.45)); this.setArm(D.arms[1], new THREE.Vector3(-0.2, -0.24, -0.08), rimPt(-1.45));
    D.headG.visible = D.straps.visible = me !== 'drv'; N.headG.visible = N.straps.visible = me !== 'nav';
    D.headG.rotation.set(-(me === 'drv' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'drv' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    N.headG.rotation.set(-(me === 'nav' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'nav' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    // map board: on the lap, raised in front of the face when held up
    const tgt = me === 'nav' && look.map ? 1 : (me !== 'nav' && other && other.map ? 1 : 0); this.mapUp += (tgt - this.mapUp) * Math.min(1, dt * 9); const u = sstep(0, 1, this.mapUp);
    this.board.position.set(-0.37, lerp(0.0, 0.35, u), lerp(-0.02, 0.0, u)); this.board.rotation.set(lerp(-0.35, -1.38, u), 0, 0);
    const bp = this.board.position.clone().sub(N.g.position);
    this.setArm(N.arms[0], new THREE.Vector3(0.2, -0.24, -0.08), bp.clone().add(new THREE.Vector3(0.15, 0, 0.05))); this.setArm(N.arms[1], new THREE.Vector3(-0.2, -0.24, -0.08), bp.clone().add(new THREE.Vector3(-0.15, 0, 0.05)));
    this.crackM.opacity = clamp(((st.dmg || 0) - 0.12) * 1.4, 0, 0.85);
    // rev counter needle (0..8000 over 270 degrees), shift lights, gear display
    const rr = clamp(st.rpm / 8000, 0, 1); this.needleP.rotation.z = (135 - rr * 270) * Math.PI / 180;
    const sl = clamp((st.rpm - 4800) / (CAR.red - 300 - 4800), 0, 1), flash = st.rpm > CAR.red - 300 && (performance.now() / 70 | 0) % 2;
    this.leds.forEach((m, i) => m.color.setHex(flash ? 0x3080ff : i / 9 < sl ? (i < 3 ? 0x20ff40 : i < 6 ? 0xffc020 : 0xff2020) : 0x161616));
    if (st.gear !== this.lastGear) { this.shiftA = st.gear > this.lastGear ? 1 : -1; this.lastGear = st.gear; }
    this.shiftA *= Math.max(0, 1 - dt * 9); this.shiftL.rotation.x = -0.35 + this.shiftA * 0.28;
    if ((this.dashTk = (this.dashTk || 0) + dt) > 0.08) {
      this.dashTk = 0; const c = this.dashC.getContext('2d'); c.fillStyle = '#05080a'; c.fillRect(0, 0, 128, 96);
      c.fillStyle = '#e8f8ff'; c.font = 'bold 56px monospace'; c.textAlign = 'center'; c.fillText(st.gear < 0 ? 'R' : String(st.gear), 64, 58); c.font = 'bold 22px monospace'; c.fillStyle = '#9cf'; c.fillText(Math.round(st.speed * 3.6) + ' km/h', 64, 88);
      this.dashT.needsUpdate = true;
      const t = this.tripC.getContext('2d'); t.fillStyle = '#0a1a0c'; t.fillRect(0, 0, 256, 112); t.fillStyle = '#7dff8a'; t.font = 'bold 44px monospace'; t.textAlign = 'right'; t.fillText((Math.max(0, (st.prog || 0) - (World.startS || 40)) / 1000).toFixed(2), 236, 52); t.font = '18px monospace'; t.textAlign = 'left'; t.fillText('TRIP km', 14, 26); t.fillText(Math.round(st.speed * 3.6) + ' km/h', 14, 96);
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
    const seat = SEAT[me], acc = new THREE.Vector3();
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
