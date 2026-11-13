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
    // ---- interior ----
    const I = this.interior = new THREE.Group(); g.add(I);
    const tube = (a, b, r, m) => { const d = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m || cageM); c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); c.castShadow = true; I.add(c); return c; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // dashboard: a sloped top, a fascia and the centre console
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.07, 0.5), new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 1 })); dash.position.set(0, 0.2, 0.72); dash.rotation.x = 0.12; I.add(dash);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.32, 0.06), trim); fascia.position.set(0, 0.03, 0.5); fascia.rotation.x = -0.2; I.add(fascia);
    const cons = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.7), trim); cons.position.set(0, -0.2, 0.25); I.add(cons);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.16), satin); hood.position.set(0.37, 0.235, 0.5); I.add(hood); // instrument binnacle
    // digital dash display
    this.dashC = document.createElement('canvas'); this.dashC.width = 256; this.dashC.height = 96; this.dashT = new THREE.CanvasTexture(this.dashC); this.dashT.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), new THREE.MeshBasicMaterial({ map: this.dashT, toneMapped: false })); scr.position.set(0.37, 0.2, 0.43); scr.rotation.x = -0.35; I.add(scr);
    // switch panel and trip computer on the co-driver side
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.02), black); sw.position.set(-0.12, 0.05, 0.47); sw.rotation.x = -0.2; I.add(sw);
    for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 8), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xe23 : 0xfa2, emissive: i % 3 ? 0x300 : 0x320 })); b.rotation.x = Math.PI / 2 - 0.2; b.position.set(-0.26 + i * 0.04, 0.06, 0.462); I.add(b); }
    const trip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), black); trip.position.set(-0.42, 0.25, 0.45); trip.rotation.x = -0.3; I.add(trip);
    // A pillars, roof liner, door cards, floor
    for (const sd of [1, -1]) {
      tube(V(sd * 0.77, 0.22, 0.98), V(sd * 0.66, 0.76, 0.32), 0.045, trim);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.5), trim); door.position.set(sd * 0.86, -0.1, -0.25); I.add(door);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 1.45), satin); sill.position.set(sd * 0.83, 0.19, -0.25); I.add(sill);
      const bp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.14), trim); bp.position.set(sd * 0.8, 0.48, -0.95); I.add(bp);
      // mirror
      const mr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), paint); mr.position.set(sd * 0.98, 0.3, 0.75); g.add(mr);
    }
    const liner = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 2.1), new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.95, side: THREE.DoubleSide })); liner.position.set(0, 0.77, -0.6); I.add(liner);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 3.0), black); floor.position.set(0, -0.4, -0.3); I.add(floor);
    const rmir = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.02), black); rmir.position.set(0, 0.68, 0.3); I.add(rmir);
    // roll cage
    for (const sd of [1, -1]) {
      tube(V(sd * 0.7, -0.35, -0.85), V(sd * 0.66, 0.72, -0.85), 0.022); // main hoop legs
      tube(V(sd * 0.7, -0.3, 0.7), V(sd * 0.6, 0.72, 0.28), 0.02);         // front legs along the A pillars
      tube(V(sd * 0.6, 0.72, 0.28), V(sd * 0.66, 0.72, -0.85), 0.02);       // roof rails
      tube(V(sd * 0.66, 0.72, -0.85), V(sd * 0.68, -0.25, -1.75), 0.02);    // rear stays
      tube(V(sd * 0.72, -0.05, 0.6), V(sd * 0.72, 0.2, -0.85), 0.018);      // door bars (X)
      tube(V(sd * 0.72, 0.2, 0.55), V(sd * 0.72, -0.1, -0.85), 0.018);
    }
    tube(V(0.66, 0.72, -0.85), V(-0.66, 0.72, -0.85), 0.022); tube(V(0.6, 0.72, 0.28), V(-0.6, 0.72, 0.28), 0.02);
    tube(V(0.66, 0.72, -0.85), V(-0.68, -0.3, -0.85), 0.02); tube(V(0.62, 0.72, 0.28), V(-0.64, 0.72, -0.85), 0.018); tube(V(-0.62, 0.72, 0.28), V(0.64, 0.72, -0.85), 0.018);
    // bucket seats with harness
    const seatM = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.9 }), harM = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.7 });
    for (const sx of [0.37, -0.37]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatM); base.position.set(sx, -0.25, -0.2); I.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.85, 0.12), seatM); back.position.set(sx, 0.18, -0.55); back.rotation.x = 0.15; I.add(back);
      for (const w of [-1, 1]) { const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.3), seatM); wing.position.set(sx + w * 0.26, 0.15, -0.45); wing.rotation.x = 0.15; I.add(wing); }
    }
    // spare wheel and fire extinguisher in the back
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 18), black); spare.position.set(0, -0.28, -1.45); I.add(spare);
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.3 })); ext.rotation.z = Math.PI / 2; ext.position.set(0, -0.3, -0.1); I.add(ext);
    // steering wheel (suede rim, three spokes) on a column
    const sw0 = this.wheelG = new THREE.Group(); sw0.position.set(0.37, 0.215, 0.24); sw0.rotation.x = -0.42; I.add(sw0);
    const rimM = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.017, 10, 36), rimM); sw0.add(rim);
    for (const a of [0, 2.2, -2.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.012), satin); sp.position.set(Math.sin(a) * 0.08, Math.cos(a) * -0.08 * (a ? -1 : 1), 0); sp.rotation.z = a; sw0.add(sp); }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.022), new THREE.MeshStandardMaterial({ color: 0xffd400 })); mark.position.set(0, 0.175, 0); sw0.add(mark);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), satin); hub.rotation.x = Math.PI / 2; sw0.add(hub);
    const col = tube(V(0.37, 0.19, 0.3), V(0.37, 0.1, 0.55), 0.03, satin);
    // pedals
    for (const [x, h] of [[0.48, 0], [0.37, 0.02], [0.27, 0]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.015), cageM); p.position.set(x, -0.25 + h, 0.75); p.rotation.x = 0.4; I.add(p); }
    // hydraulic handbrake lever
    this.hbL = new THREE.Group(); this.hbL.position.set(0.16, -0.22, 0.12); I.add(this.hbL); { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), cageM); l.position.y = 0.2; this.hbL.add(l); const k = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), black); k.position.y = 0.36; this.hbL.add(k); }
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
  person(suit, helm) {
    const g = new THREE.Group(), sm = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 }), hm = new THREE.MeshPhysicalMaterial({ color: helm, roughness: 0.25, clearcoat: 1 }), vis = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.1, metalness: 0.6 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), sm); torso.position.set(0, -0.22, -0.12); torso.rotation.x = 0.15; g.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.6), sm); legs.position.set(0, -0.48, 0.2); g.add(legs);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.13), sm); shin.position.set(0, -0.55, 0.52); shin.rotation.x = 0.3; g.add(shin);
    const headG = new THREE.Group(); headG.position.set(0, 0.06, -0.05); g.add(headG);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), hm); headG.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 10, -0.9, 1.8, 1.1, 0.75), vis); visor.rotation.y = Math.PI; visor.rotation.y = 0; headG.add(visor);
    const armM = sm, glove = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    const mkArm = () => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 1, 8), armM); const h = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glove); g.add(a, h); return { a, h }; };
    return { g, headG, torso, arms: [mkArm(), mkArm()] };
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
    const swA = st.steer * 9; this.wheelG.rotation.z = swA; this.wheelG.rotation.x = -0.42; this.wheelG.updateMatrixWorld();
    this.hbL.rotation.x = st.hb ? -0.55 : -0.15;
    // crew: driver's hands on the rim, navigator holds the board
    const I = this.interior, D = this.crew.drv, N = this.crew.nav, rimPt = a => { const p = new THREE.Vector3(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.02); p.applyEuler(new THREE.Euler(-0.42, 0, swA, 'XYZ')); return p.add(this.wheelG.position).sub(D.g.position); };
    this.setArm(D.arms[0], new THREE.Vector3(0.2, -0.24, -0.08), rimPt(1.45)); this.setArm(D.arms[1], new THREE.Vector3(-0.2, -0.24, -0.08), rimPt(-1.45));
    D.headG.visible = me !== 'drv'; N.headG.visible = me !== 'nav';
    D.headG.rotation.set(-(me === 'drv' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'drv' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    N.headG.rotation.set(-(me === 'nav' ? 0 : (other ? other.pitch : 0)) * 0.6, me === 'nav' ? 0 : (other ? other.yaw : 0) * 0.8, 0);
    // map board: on the lap, raised in front of the face when held up
    const tgt = me === 'nav' && look.map ? 1 : (me !== 'nav' && other && other.map ? 1 : 0); this.mapUp += (tgt - this.mapUp) * Math.min(1, dt * 9); const u = sstep(0, 1, this.mapUp);
    this.board.position.set(-0.37, lerp(0.0, 0.35, u), lerp(-0.02, 0.0, u)); this.board.rotation.set(lerp(-0.35, -1.38, u), 0, 0);
    const bp = this.board.position.clone().sub(N.g.position);
    this.setArm(N.arms[0], new THREE.Vector3(0.2, -0.24, -0.08), bp.clone().add(new THREE.Vector3(0.15, 0, 0.05))); this.setArm(N.arms[1], new THREE.Vector3(-0.2, -0.24, -0.08), bp.clone().add(new THREE.Vector3(-0.15, 0, 0.05)));
    // dash display (driver side)
    if ((this.dashTk = (this.dashTk || 0) + dt) > 0.07) {
      this.dashTk = 0; const c = this.dashC.getContext('2d'); c.fillStyle = '#05080a'; c.fillRect(0, 0, 256, 96);
      const r = clamp((st.rpm - 1000) / (CAR.red - 1000), 0, 1); for (let i = 0; i < 20; i++) { c.fillStyle = i / 20 < r ? (i > 16 ? '#ff3030' : i > 12 ? '#ffc020' : '#30ff60') : '#16201a'; c.fillRect(8 + i * 12, 6, 9, 14); }
      c.fillStyle = '#e8f8ff'; c.font = 'bold 54px monospace'; c.textAlign = 'left'; c.fillText(st.gear < 0 ? 'R' : String(st.gear), 14, 82);
      c.font = 'bold 40px monospace'; c.textAlign = 'right'; c.fillText(String(Math.round(st.speed * 3.6)), 246, 80); c.font = '14px monospace'; c.fillStyle = '#8ab'; c.fillText('KM/H', 246, 36);
      this.dashT.needsUpdate = true;
    }
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
    const sh = this.shake * 0.02, rough = (st.offroad || 0) * 0.004 * Math.min(1, st.speed / 10) + Math.min(1, st.speed / 40) * 0.0012;
    const hp = new THREE.Vector3(seat.x + this.head.x + (Math.random() - 0.5) * (sh + rough), seat.y + this.head.y + (Math.random() - 0.5) * (sh + rough), seat.z + this.head.z);
    cam.position.copy(hp).applyQuaternion(st.q).add(st.pos);
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw + Math.PI, -this.head.x * 1.2, 'YXZ'));
    // camera looks down -z; car forward is +z, hence the extra half turn
    cam.quaternion.copy(st.q).multiply(lq);
    cam.fov = lerp(cam.fov, 70 + Math.min(14, st.speed * 0.28), Math.min(1, dt * 3)); cam.updateProjectionMatrix();
  }
}
