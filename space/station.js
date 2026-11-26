'use strict';
// Lucas Space Program space stations (26 Nov 2026). Station modules ride up in a cargo bay (PARTS.bay, MODULES in flight.js).
// K in orbit opens the bay and lets the module go: far from any station it starts a new one, within 300 m of a station it flies itself onto a free port.
// Stations coast on rails (two-body Kepler around their world) and are saved in localStorage 'ye-world'.
// H docks your ship (assisted: it flies you in) once you are within 20 km and slower than 60 m/s; docking at a fuel depot fills your tanks.
// Y picks a station as the target; the map gets a "Meet station" plan (phasing burn, then a match-speed burn at the closest point).
// Loaded after nav.js, before polish.js (which calls boot()).

// ---------------- materials
const SM = {};
{ const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // white thermal blankets: quilted squares with stitching, a little sheen
  const quilt = cv(256, 256, (x, w, h) => { x.fillStyle = '#e9e8e2'; x.fillRect(0, 0, w, h); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const g = x.createRadialGradient(i * 64 + 32, j * 64 + 32, 4, i * 64 + 32, j * 64 + 32, 46); g.addColorStop(0, '#f6f5f0'); g.addColorStop(1, '#cfcdc5'); x.fillStyle = g; x.fillRect(i * 64 + 1, j * 64 + 1, 62, 62); }
    x.strokeStyle = 'rgba(0,0,0,.18)'; x.setLineDash([3, 3]); for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 64, 0); x.lineTo(k * 64, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 64); x.lineTo(w, k * 64); x.stroke(); } });
  SM.white = new THREE.MeshStandardMaterial({map: quilt, roughness: .7, metalness: 0}); quilt.repeat.set(3, 2);
  SM.panel = new THREE.MeshStandardMaterial({color: 0xd8dbdf, roughness: .38, metalness: .4});
  SM.metal = new THREE.MeshStandardMaterial({color: 0x7d848c, roughness: .35, metalness: .8});
  SM.dark = new THREE.MeshStandardMaterial({color: 0x26292e, roughness: .5, metalness: .4});
  SM.gold = new THREE.MeshStandardMaterial({color: 0xd9a23a, roughness: .28, metalness: 1});
  SM.orange = new THREE.MeshStandardMaterial({color: 0xd9782a, roughness: .55, metalness: .05});
  SM.glass = new THREE.MeshStandardMaterial({color: 0x0b1626, roughness: .04, metalness: .9, envMapIntensity: 1.8});
  SM.glassT = new THREE.MeshStandardMaterial({color: 0x9ccbe8, roughness: .05, metalness: .2, transparent: true, opacity: .32, depthWrite: false});
  SM.plant = new THREE.MeshStandardMaterial({color: 0x2f8a2a, roughness: .8, metalness: 0, emissive: 0x2a8a24, emissiveIntensity: .25});
  SM.lamp = new THREE.MeshStandardMaterial({color: 0xffe9c0, emissive: 0xffe2a8, emissiveIntensity: 2.2});
  // solar cells: dark blue squares with silver gaps
  SM.solar = new THREE.MeshStandardMaterial({map: cv(256, 256, (x, w, h) => { x.fillStyle = '#c9ccd2'; x.fillRect(0, 0, w, h); for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const g = x.createLinearGradient(0, j * 32, 0, j * 32 + 30); g.addColorStop(0, '#1d3a7a'); g.addColorStop(1, '#0f2350'); x.fillStyle = g; x.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29); } }), roughness: .25, metalness: .5, side: THREE.DoubleSide});
  SM.solar.map.repeat.set(6, 2);
}
const SG = {}; const sgeo = (k, f) => SG[k] || (SG[k] = f());
function smesh(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; }
function scyl(g, r0, r1, y0, y1, m, seg = 32, open = false) { const o = smesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open), m, 0, (y0 + y1) / 2, 0); g.add(o); return o; }
function collar(g, y, dir) { scyl(g, .72, .72, y - (dir > 0 ? .5 : 0), y + (dir > 0 ? 0 : .5), SM.metal, 24); scyl(g, .8, .8, y - .06 * dir - .05, y - .06 * dir + .05, SM.dark, 24); }
function rails(g, r, y0, y1, n = 4) { const geo = sgeo('rail', () => new THREE.CylinderGeometry(.025, .025, 1, 6)); for (let k = 0; k < n; k++) { const a = (k + .5) * Math.PI * 2 / n, m = smesh(geo, SM.gold, Math.cos(a) * (r + .12), (y0 + y1) / 2, Math.sin(a) * (r + .12)); m.scale.y = y1 - y0; g.add(m); } }
// one module, centred on its origin, axis along y, back port at -L/2
function modMesh(k) { const M = MODULES[k], g = new THREE.Group(), L = M.L, h = L / 2;
  if (k === 'hub') { g.add(smesh(sgeo('hubS', () => new THREE.SphereGeometry(1.45, 32, 20)), SM.white)); for (const [ax, s] of [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]]) { const c = new THREE.Group(); collar(c, 1.7, 1); c.rotation.set(ax === 'z' ? s * Math.PI / 2 : ax === 'y' && s < 0 ? Math.PI : 0, 0, ax === 'x' ? -s * Math.PI / 2 : 0); g.add(c); }
    g.add(smesh(sgeo('hubL', () => new THREE.BoxGeometry(.3, .3, .3)), SM.lamp, 1.05, 1.05, 0)); }
  else if (k === 'cupola') { collar(g, -h, -1); scyl(g, 1.45, 1.45, -h + .5, -h + 1.1, SM.white, 6); scyl(g, 1.45, .8, -h + 1.1, h - .1, SM.panel, 6); scyl(g, .7, .7, h - .1, h, SM.glass, 6);
    for (let i = 0; i < 6; i++) { const a = (i + .5) * Math.PI / 3, w = smesh(sgeo('cupW', () => new THREE.BoxGeometry(.75, .62, .04)), SM.glass, Math.cos(a) * 1.13, -h + 1.62, Math.sin(a) * 1.13); w.rotation.set(0, -a + Math.PI / 2, 0); w.rotateX(-.62); g.add(w); } }
  else if (k === 'solar') { collar(g, -h, -1); const L2 = L - .5, tr = new THREE.Group(); g.add(tr);
    for (const [x, z] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) tr.add(smesh(sgeo('trL' + L2, () => new THREE.BoxGeometry(.08, L2, .08)), SM.metal, x, .25, z));
    for (let y = -h + .5; y < h; y += .55) { const b = smesh(sgeo('trB', () => new THREE.BoxGeometry(1.08, .05, .05)), SM.metal, 0, y, -.5); tr.add(b); const b2 = b.clone(); b2.position.z = .5; tr.add(b2); }
    tr.add(smesh(sgeo('trBox', () => new THREE.BoxGeometry(.8, .9, .8)), SM.gold, 0, h - .7, 0));
    const wings = []; for (const s of [1, -1]) { const w = new THREE.Group(); w.position.set(s * .55, h - .8, 0); g.add(w); w.add(smesh(sgeo('mast', () => new THREE.BoxGeometry(14.5, .1, .1)), SM.metal, s * 7.3, 0, 0));
      for (const z of [-1.95, 1.95]) w.add(smesh(sgeo('wing', () => new THREE.BoxGeometry(14, .04, 3.5)), SM.solar, s * 7.5, 0, z)); wings.push(w); }
    g.userData.wings = wings; }
  else if (k === 'depot') { collar(g, -h, -1); collar(g, h, 1); scyl(g, .5, .5, -h + .5, h - .5, SM.metal, 16);
    for (const y of [-2.05, 0, 2.05]) { g.add(smesh(sgeo('dSph', () => new THREE.SphereGeometry(1.25, 28, 18)), SM.orange, 0, y, 0)); scyl(g, 1.27, 1.27, y - .05, y + .05, SM.gold, 28); }
    for (let k2 = 0; k2 < 4; k2++) { const a = k2 * Math.PI / 2 + .4, b = smesh(sgeo('dFr', () => new THREE.BoxGeometry(.1, L - 1, .1)), SM.metal, Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55); g.add(b); } }
  else if (k === 'tele') { collar(g, -h, -1); scyl(g, 1.25, 1.25, -h + .5, -h + 1.6, SM.gold, 32); scyl(g, 1.35, 1.35, -h + 1.6, h - .2, SM.panel, 32, true); const inn = scyl(g, 1.3, 1.3, -h + 1.6, h - .2, SM.dark, 32, true); inn.material = SM.dark.clone(); inn.material.side = THREE.BackSide;
    scyl(g, 1.2, 1.2, -h + 1.62, -h + 1.7, SM.glass, 32); const lid = smesh(sgeo('lid', () => new THREE.CylinderGeometry(1.4, 1.4, .08, 32)), SM.panel, 0, 0, 0); const lg = new THREE.Group(); lg.position.set(0, h - .2, -1.35); lid.position.set(0, 0, 1.35); lg.add(lid); lg.rotation.x = -1.9; g.add(lg);
    for (const s of [1, -1]) g.add(smesh(sgeo('tSol', () => new THREE.BoxGeometry(.04, 3.2, 1.6)), SM.solar, s * 1.45, -.6, 0)); }
  else { // pressurised cylinders: hab, lab, greenhouse
    collar(g, -h, -1); collar(g, h, 1); const r = M.w; scyl(g, .8, r, -h + .5, -h + 1.0, SM.panel, 32); scyl(g, r, .8, h - 1.0, h - .5, SM.panel, 32);
    if (k === 'green') { scyl(g, r, r, -h + 1.0, -h + 1.25, SM.metal, 32); scyl(g, r, r, h - 1.25, h - 1.0, SM.metal, 32); const gl = scyl(g, r, r, -h + 1.25, h - 1.25, SM.glassT, 12, true); gl.castShadow = false; gl.renderOrder = 3;
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, rib = smesh(sgeo('rib' + L, () => new THREE.BoxGeometry(.06, L - 2.5, .06)), SM.metal, Math.cos(a) * r, 0, Math.sin(a) * r); g.add(rib); }
      scyl(g, .5, .5, -h + 1.25, h - 1.25, SM.dark, 12); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, y = -h + 1.6 + (i % 6) * (L - 3.2) / 5, p = smesh(sgeo('bush', () => new THREE.IcosahedronGeometry(.42, 1)), SM.plant, Math.cos(a) * .9, y, Math.sin(a) * .9); p.scale.set(1, .7 + (i % 3) * .2, 1); g.add(p); }
      g.add(smesh(sgeo('glamp', () => new THREE.BoxGeometry(.2, L - 3, .2)), SM.lamp, 0, 0, 1.25)); }
    else { scyl(g, r, r, -h + 1.0, h - 1.0, SM.white, 36); rails(g, r, -h + 1.2, h - 1.2);
      if (k === 'hab') { for (let i = 0; i < 4; i++) { const y = -h + 1.7 + i * (L - 3.4) / 3, w = smesh(sgeo('habW', () => new THREE.CylinderGeometry(.22, .22, .1, 20)), SM.glass, 0, y, r + .02); w.rotation.x = Math.PI / 2; g.add(w); const f = smesh(sgeo('habWf', () => new THREE.TorusGeometry(.24, .04, 8, 20)), SM.metal, 0, y, r + .05); g.add(f); }
        g.add(smesh(sgeo('rad', () => new THREE.BoxGeometry(.05, 2.4, 1.6)), SM.panel, -r - .9, 0, 0)); g.add(smesh(sgeo('radA', () => new THREE.BoxGeometry(.9, .1, .1)), SM.metal, -r - .45, 0, 0)); }
      else { scyl(g, r + .02, r + .02, -.5, .5, SM.gold, 36); for (const [y, a] of [[-1.6, .3], [1.4, 2.1], [0, 3.9]]) { const b = smesh(sgeo('pay', () => new THREE.BoxGeometry(.7, .6, .55)), SM.panel, Math.cos(a) * (r + .3), y, Math.sin(a) * (r + .3)); b.rotation.y = -a; g.add(b); }
        const ar = smesh(sgeo('arm', () => new THREE.CylinderGeometry(.09, .09, 3.2, 10)), SM.panel, r + .4, 1.2, -.8); ar.rotation.z = .6; g.add(ar); } } }
  g.userData.k = k; return g; }
// ports in module coordinates: [position, outward direction]; index 0 is the back
function modPorts(k) { const h = MODULES[k].L / 2, Y = (y, d) => [new V3(0, y, 0), new V3(0, d, 0)];
  if (k === 'hub') return [Y(-h, -1), Y(h, 1), [new V3(h, 0, 0), new V3(1, 0, 0)], [new V3(-h, 0, 0), new V3(-1, 0, 0)], [new V3(0, 0, h), new V3(0, 0, 1)], [new V3(0, 0, -h), new V3(0, 0, -1)]];
  if (k === 'solar' || k === 'cupola' || k === 'tele') return [Y(-h, -1)]; return [Y(-h, -1), Y(h, 1)]; }

// ---------------- cargo bay: a hinged clamshell around the module (called from partMeshes)
function bayMeshes(g, it, preview, paint) { const r = it.r, y0 = it.y0, y1 = it.y1, yc = (y0 + y1) / 2, k = (it.d && it.d.cargo) || 'hab';
  g.add(cylY(r, r, y0, y0 + .35, RM.grey, 48)); g.add(cylY(r, r, y1 - .35, y1, RM.grey, 48)); g.add(cylY(r * .55, r * .55, y0 + .3, y0 + .5, RM.black, 24));
  for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 4, l = mesh(pgeo('bayL' + it.p.h, () => new THREE.BoxGeometry(.12, y1 - y0 - .6, .12)), RM.grey, Math.cos(a) * (r - .08), yc, Math.sin(a) * (r - .08)); g.add(l); }
  const dg = pgeo('bayD' + r + '|' + it.p.h, () => new THREE.CylinderGeometry(r + .02, r + .02, y1 - y0 - .7, 32, 1, true, 0, Math.PI)), dm = tankMat(it.p.h, r, 1, paint || SHIP.paint), doors = [];
  for (const s of [1, -1]) { const hg = new THREE.Group(); hg.position.set(0, yc, -(r + .02)); const d = mesh(dg, dm, 0, 0, r + .02); if (s < 0) d.rotation.y = Math.PI; d.material = dm.clone(); d.material.side = THREE.DoubleSide; hg.add(d); g.add(hg); doors.push({g: hg, s}); }
  const mod = modMesh(k), ML = MODULES[k].L, sc = Math.min(1, (y1 - y0 - .8) / ML, (r - .15) / Math.max(MODULES[k].w, k === 'hub' ? 1.7 : 0)); mod.scale.setScalar(sc); mod.position.set(0, yc, 0); g.add(mod);
  if (mod.userData.wings) for (const w of mod.userData.wings) w.scale.set(.04, 1, .3); // folded
  const bay = {it, doors, mod, open: preview ? .75 : 0, want: preview ? .75 : 0, out: false, k}; (g.userData.bays || (g.userData.bays = [])).push(bay); bayPose(bay); }
function bayPose(b) { for (const d of b.doors) d.g.rotation.y = d.s * b.open * 1.9; }

// ---------------- orbits on rails (two-body, universal variables)
function stumpC(z) { if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z; if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z; return .5 - z / 24 + z * z / 720; }
function stumpS(z) { if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); } if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); } return 1 / 6 - z / 120 + z * z / 5040; }
const _kR = new V3(), _kV = new V3();
function kepler(r0v, v0v, mu, dt, oR, oV) {
  const r0 = r0v.length(), vr0 = r0v.dot(v0v) / r0, alpha = 2 / r0 - v0v.lengthSq() / mu, sm = Math.sqrt(mu);
  if (alpha > 1e-12) { const P = 2 * Math.PI / Math.sqrt(mu * alpha * alpha * alpha); dt = ((dt % P) + P) % P; if (dt > P / 2) dt -= P; }
  let x = sm * Math.abs(alpha) * dt; if (!(alpha > 1e-12)) x = Math.sign(dt) * Math.sqrt(mu) * Math.abs(dt) / r0;
  for (let i = 0; i < 60; i++) { const z = alpha * x * x, C = stumpC(z), S = stumpS(z), F = r0 * vr0 / sm * x * x * C + (1 - alpha * r0) * x * x * x * S + r0 * x - sm * dt,
      dF = r0 * vr0 / sm * x * (1 - alpha * x * x * S) + (1 - alpha * r0) * x * x * C + r0, dx = F / dF; x -= dx; if (Math.abs(dx) < 1e-9 * Math.max(1, Math.abs(x))) break; }
  const z = alpha * x * x, C = stumpC(z), S = stumpS(z), f = 1 - x * x / r0 * C, g = dt - x * x * x / sm * S;
  _kR.copy(r0v).multiplyScalar(f).addScaledVector(v0v, g); const r = _kR.length(), fd = sm / (r * r0) * (alpha * x * x * x * S - x), gd = 1 - x * x / r * C;
  _kV.copy(r0v).multiplyScalar(fd).addScaledVector(v0v, gd); oR.copy(_kR); if (oV) oV.copy(_kV); return oR; }

// ---------------- stations
const VES = {list: [], tgt: null, near: null, nameI: 0};
const ST_NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Falcon', 'Gemini', 'Halo', 'Iris', 'Juno', 'Kestrel', 'Lumen'];
const _tP = new V3(), _tV = new V3(), _tQ = new Q4(), _t1s = new V3(), _t2s = new V3(), _t3s = new V3();
function vesState(V, t, oP, oV) { const b = BODIES[V.b]; kepler(V.r, V.v, b.GM, t - V.t0, oP, oV); if (b !== PLANET) { oP.add(satPos(b, t, _t3s)); if (oV) oV.add(satVel(b, t, _t3s)); } return oP; }
function vesSave() { try { localStorage.setItem('ye-world', JSON.stringify({v: 1, nameI: VES.nameI, list: VES.list.map(V => ({id: V.id, name: V.name, b: V.b, t0: V.t0, r: V.r.toArray(), v: V.v.toArray(), q: V.q.toArray(), visits: V.visits || 0,
  mods: V.mods.map(m => ({k: m.k, p: m.p.toArray(), q: m.q.toArray(), used: m.used}))}))})); } catch (e) {} }
function vesLoad() { try { const d = JSON.parse(localStorage.getItem('ye-world') || 'null'); if (!d || d.v !== 1) return; VES.nameI = d.nameI || 0;
  for (const s of d.list) { if (!BODIES[s.b] || !s.mods.every(m => MODULES[m.k])) continue; VES.list.push({id: s.id, name: s.name, b: s.b, t0: s.t0, r: new V3().fromArray(s.r), v: new V3().fromArray(s.v), q: new Q4().fromArray(s.q), visits: s.visits || 0,
    mods: s.mods.map(m => ({k: m.k, p: new V3().fromArray(m.p), q: new Q4().fromArray(m.q), used: m.used || []})), g: null}); } } catch (e) {} }
function vesNew(k, pos, vel, q) { const b = domBody(pos), bi = BODIES.indexOf(b), V = {id: 's' + Date.now().toString(36), name: 'Station ' + ST_NAMES[VES.nameI++ % ST_NAMES.length], b: bi, t0: G.t,
    r: pos.clone().sub(b.c), v: vel.clone().sub(b === PLANET ? _t3s.set(0, 0, 0) : satVel(b, G.t, _t3s)), q: q.clone(), mods: [{k, p: new V3(), q: new Q4(), used: []}], g: null, visits: 0};
  VES.list.push(V); vesSave(); return V; }
const portWorld = (V, m, j, oP, oD) => { const pt = modPorts(m.k)[j]; oP.copy(pt[0]).applyQuaternion(m.q).add(m.p); if (oD) oD.copy(pt[1]).applyQuaternion(m.q); return oP; }; // station frame
const modR = k => Math.max(MODULES[k].L / 2, MODULES[k].w);
function freePorts(V, forShip) { const out = []; V.mods.forEach((m, mi) => modPorts(m.k).forEach((_, j) => { if (m.used[j]) return; const P = portWorld(V, m, j, new V3()), D = new V3(); portWorld(V, m, j, new V3(), D);
  if (forShip && m.k === 'solar') return; out.push({mi, j, P, D}); })); return out; }
function vesAttach(V, k) { // find a free port where the new module fits, add it (station frame); returns the module
  const half = MODULES[k].L / 2;
  for (const fp of freePorts(V)) { const c = fp.P.clone().addScaledVector(fp.D, half), rr = modR(k) * .8;
    if (V.mods.some((m, mi) => mi !== fp.mi && m.p.distanceTo(c) < rr + modR(m.k) * .8)) continue;
    const q = new Q4().setFromUnitVectors(new V3(0, -1, 0), fp.D.clone().negate()), m = {k, p: c, q, used: [true]}; V.mods[fp.mi].used[fp.j] = true; V.mods.push(m); if (V.g) vesBuild(V); vesSave(); return m; }
  return null; }
function vesBuild(V) { if (V.g) { scene.remove(V.g); V.g.traverse(o => { if (o.geometry && !Object.values(SG).includes(o.geometry)) o.geometry.dispose(); }); }
  const g = V.g = new THREE.Group(); V.mods.forEach((m, mi) => { const mm = modMesh(m.k); mm.position.copy(m.p); mm.quaternion.copy(m.q); mm.userData.mi = mi; g.add(mm); m.g = mm; });
  // a little blinking beacon + nav lights so you can find it in the dark
  const bl = new THREE.Mesh(sgeo('beacon', () => new THREE.SphereGeometry(.18, 10, 8)), new THREE.MeshBasicMaterial({color: 0xff3b2f})); bl.position.set(0, 1.9, 0); g.add(bl); g.userData.beacon = bl;
  scene.add(g); }
function vesFrame(dt) {
  let near = null, nd = Infinity; const cam0 = G.O;
  for (const V of VES.list) { vesState(V, G.t, _tP, _tV); V.pos = V.pos || new V3(); V.vel = V.vel || new V3(); V.pos.copy(_tP); V.vel.copy(_tV); const d = _tP.distanceTo(cam0); V.dCam = d;
    if (d < 4e5) { if (!V.g) vesBuild(V); V.g.visible = true; V.g.position.copy(_tP).sub(G.O); V.g.quaternion.copy(V.q); if (V.g.userData.beacon) V.g.userData.beacon.visible = (G.t * 1.3 % 1) < .12; }
    else if (V.g) V.g.visible = false;
    if (V.anim) { const a = V.anim; a.t += dt / Math.max(1, G.warp > 4 ? 1 : 1); const u = sstep(0, 1, Math.min(1, a.t / 4)); if (a.m.g) a.m.g.position.lerpVectors(a.from, a.m.p, u); if (a.t >= 4) { V.anim = null; if (a.m.g) a.m.g.position.copy(a.m.p); sfx('thud'); showHint('Module docked to ' + V.name + '', 2500); } }
    const ds = R.pos.distanceTo(_tP); if (ds < nd) { nd = ds; near = V; } }
  VES.near = near; VES.nearD = nd;
  // bay doors + wings unfolding on released modules
  for (const g of R.sg) for (const b of g.userData.bays || []) { if (Math.abs(b.want - b.open) > .001) { b.open += clamp(b.want - b.open, -dt * .7, dt * .7); bayPose(b); } }
  for (const V of VES.list) if (V.g) V.g.children.forEach(mm => { if (mm.userData.wings) for (const w of mm.userData.wings) if (w.scale.x < 1) { w.scale.x = Math.min(1, w.scale.x + dt * .15); w.scale.z = Math.min(1, w.scale.z + dt * .2); } });
}

// ---------------- releasing cargo (K)
function cargoNext() { for (let i = R.bot; i < STAGES.length; i++) { const g = R.sg[i]; if (!g) continue; for (const b of g.userData.bays || []) if (!b.out) return {i, b}; } return null; }
function cargoRelease() {
  if (!R.on || !pilot()) return; const c = cargoNext(); if (!c) { showHint('No station module on board (put one in a cargo bay in the builder)', 2500); return; }
  if (R.st !== 'fly' && R.st !== 'docked') { showHint('Release modules in orbit', 2000); return; }
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, o = orbitEl(b); if (b === PLANET && (alt < PLANET.atmo || o.pe < PLANET.atmo)) { showHint('Get into orbit first: Pe above ' + fmtD(PLANET.atmo) + ' (modules left in the air would fall)', 3000); return; }
  if (R.F > 0) { showHint('Cut the engine first (X)', 2000); return; }
  const {i, b: bay} = c, it = bay.it, nz = nose(_t1s), side = _t2s.set(0, 0, 1).applyQuaternion(R.q), yc = (it.y0 + it.y1) / 2 - R.comY;
  const pos = R.pos.clone().addScaledVector(nz, yc).addScaledVector(side, it.r + MODULES[bay.k].w + 1.5), vel = R.vel.clone().addScaledVector(side, .4);
  bay.out = true; bay.want = 1; bay.mod.visible = false; R.cargoOut[i + ':' + it.i] = 1; const c0 = R.comY; R.cargoM[i] = Math.max(0, R.cargoM[i] - MODULES[bay.k].m); R.comY = comOf(); R.pos.addScaledVector(nz, R.comY - c0);
  sfx('pop'); FLOG.released = (FLOG.released || 0) + 1;
  // close to a station: it flies itself onto a free port
  let host = null, hd = 300; for (const V of VES.list) { if (BODIES[V.b] !== b) continue; vesState(V, G.t, _tP); const d = _tP.distanceTo(pos); if (d < hd) { hd = d; host = V; } }
  if (host) { const m = vesAttach(host, bay.k); if (m) { vesState(host, G.t, _tP); const from = pos.clone().sub(_tP).applyQuaternion(_tQ.copy(host.q).invert()); host.anim = {m, from, t: 0}; if (m.g) m.g.position.copy(from);
      FLOG.dockedMod = true; showHint(MODULES[bay.k].name + ' is flying itself to ' + host.name + ' (' + host.mods.length + ' modules)', 4000); vesSave(); return; }
    showHint(host.name + ' has no free port that fits: it drifts free as a new station', 3000); }
  const V = vesNew(bay.k, pos, vel, R.q); VES.tgt = V; FLOG.newStation = true;
  showHint(MODULES[bay.k].name + ' released: ' + V.name + ' is born! Launch more modules and release them within 300 m of it', 6000);
}

// ---------------- docking your ship (H): assisted approach, then it holds you on the port
const DK = {ap: null}; // ap = {V, mi, j, t, phase}
function dockCan(V) { if (!V || R.st !== 'fly') return false; vesState(V, G.t, _tP, _tV); return R.pos.distanceTo(_tP) < 20000 && R.vel.distanceTo(_tV) < 60; }
function dockPort(V) { // the free port facing us most
  let best = null, bs = -Infinity; vesState(V, G.t, _tP); const rel = R.pos.clone().sub(_tP).applyQuaternion(_tQ.copy(V.q).invert());
  for (const fp of freePorts(V, true)) { const s = fp.D.dot(rel.clone().sub(fp.P).normalize()) - fp.P.distanceTo(rel) * .001; if (s > bs) { bs = s; best = fp; } } return best; }
function dockToggle() {
  if (!R.on || !pilot()) return;
  if (R.st === 'docked') { // undock: back off gently
    const V = DK.V; R.st = 'fly'; DK.ap = null; R.lit = false; R.F = 0; if (V) { V.mods[DK.port.mi].used[DK.port.j] = false; vesSave(); vesState(V, G.t, _tP, _tV); R.vel.copy(_tV).addScaledVector(nose(_t1s), -.6); }
    R.w.set(0, 0, 0); R.hold.copy(R.q); R.sas = 'hold'; showHint('Undocked · backing away at 0.6 m/s', 2500); sfx('pop'); DK.V = null; return; }
  if (DK.ap) { DK.ap = null; showHint('Docking autopilot off', 1800); return; }
  const V = VES.tgt && dockCan(VES.tgt) ? VES.tgt : VES.near && dockCan(VES.near) ? VES.near : null;
  if (!V) { showHint(VES.near && VES.nearD < 20000 ? 'Get within 20 km of ' + VES.near.name + ' and slower than 60 m/s relative to it (8: kill relative speed)' : 'No station close by (Y picks a target, the map plans the way)', 3000); return; }
  const fp = dockPort(V); if (!fp) { showHint(V.name + ' has no free port', 2500); return; }
  vesState(V, G.t, _tP, _tV); DK.ap = {V, fp, rel: R.pos.clone().sub(_tP).applyQuaternion(_tQ.copy(V.q).invert()), rv: R.vel.clone().sub(_tV).applyQuaternion(_tQ), t: 0}; R.lit = false;
  showHint('Docking autopilot: flying you to ' + V.name + ' · H cancels', 3500); sfx('pop'); }
// target pose in the station frame: nose on the port, pointing into it
function dockGoal(V, fp, oP, oQ) { const L = 26.1 - R.comY; oP.copy(fp.P).addScaledVector(fp.D, L + .05); oQ.setFromUnitVectors(_t1s.set(0, 1, 0), _t2s.copy(fp.D).negate()); return oP; }
const _dQ = new Q4(), _dP = new V3(), _dW = new Q4();
function dockStep(h, t) { // replaces the physics while the docking autopilot flies or while docked
  const V = DK.ap ? DK.ap.V : DK.V; vesState(V, t, _tP, _tV); const fp = DK.ap ? DK.ap.fp : DK.port; dockGoal(V, fp, _dP, _dQ);
  if (R.st === 'docked') { R.pos.copy(_dP).applyQuaternion(V.q).add(_tP); R.vel.copy(_tV); R.q.copy(V.q).multiply(_dQ); R.w.set(0, 0, 0); R.F = 0; R.felt.set(0, 0, 0); return; }
  const a = DK.ap; a.t += h; const rel = a.rel, goal = _dP, d = goal.clone().sub(rel), L = d.length();
  // line up first (stay 25 m out on the port's axis), then come straight in; speed drops as we get close
  const stand = fp.P.clone().addScaledVector(fp.D, 26.1 - R.comY + 25), toStand = stand.clone().sub(rel), onAxis = toStand.length() < 3 || a.phase === 2;
  const tgtP = onAxis ? goal : stand; if (onAxis) a.phase = 2; const dv = tgtP.clone().sub(rel), dl = dv.length(), vmax = onAxis ? clamp(dl * .25, .25, 2.5) : clamp(dl * .08, 1, 80), want = dl > 1e-3 ? dv.multiplyScalar(vmax / dl) : dv.set(0, 0, 0);
  a.rv.lerp(want, 1 - Math.exp(-h * .8)); rel.addScaledVector(a.rv, h);
  const qGoal = _dW.copy(V.q).multiply(_dQ); R.q.slerp(qGoal, 1 - Math.exp(-h * .6)); R.w.set(0, 0, 0);
  R.pos.copy(rel).applyQuaternion(V.q).add(_tP); R.vel.copy(a.rv).applyQuaternion(V.q).add(_tV); R.F = 0; R.felt.set(0, 0, 0);
  if (onAxis && rel.distanceTo(goal) < .15) { R.st = 'docked'; DK.V = V; DK.port = fp; DK.ap = null; V.mods[fp.mi].used[fp.j] = true; V.visits = (V.visits || 0) + 1; vesSave(); FLOG.dockShip = true; sfx('thud');
    let msg = 'Docked with ' + V.name + '! H to undock'; if (V.mods.some(m => m.k === 'depot')) { for (let i = R.bot; i < STAGES.length; i++) R.fuel[i] = STAGES[i].fuel; FLOG.refuel = true; msg += ' · tanks filled at the fuel depot ⛽'; }
    showHint(msg, 5000); }
}
{ const rs0 = rocketStep; rocketStep = function (h, t) { if (R.st === 'docked' || DK.ap) { if ((DK.ap && DK.ap.V) || DK.V) { dockStep(h, t); return; } DK.ap = null; if (R.st === 'docked') R.st = 'fly'; } rs0(h, t); }; }
{ const rr0 = resetRocket; resetRocket = function () { DK.ap = null; DK.V = null; rr0(); }; }
{ const ex0 = explode; explode = function (why) { DK.ap = null; if (R.st === 'docked' && DK.V) { DK.V.mods[DK.port.mi].used[DK.port.j] = false; DK.V = null; } return ex0(why); }; }

// ---------------- targeting: Y cycles stations, SAS 7 points at the target, 8 points against the relative speed (burn to stop)
function relToTgt(out) { const V = VES.tgt; if (!V) return null; vesState(V, G.t, _tP, _tV); return out.copy(R.vel).sub(_tV); }
{ const sd0 = sasDir; sasDir = function (out) { if (R.sas === 'tgt' || R.sas === 'kill') { const V = VES.tgt; if (!V) return null; vesState(V, G.t, _tP, _tV);
    if (R.sas === 'tgt') return out.copy(_tP).sub(R.pos).normalize(); const rv = out.copy(R.vel).sub(_tV); return rv.lengthSq() < .01 ? null : rv.normalize().negate(); } return sd0(out); }; }
addEventListener('keydown', e => { if (!G.on || G.paused || e.repeat || (typeof BLD !== 'undefined' && BLD.on)) return; const k = e.code;
  if (k === 'KeyY') { if (!VES.list.length) { showHint('No stations yet: launch a module in a cargo bay (builder) and press K in orbit', 3000); return; } const i = VES.list.indexOf(VES.tgt); VES.tgt = e.shiftKey ? null : VES.list[(i + 1) % VES.list.length];
    showHint(VES.tgt ? 'Target: ' + VES.tgt.name + ' (' + VES.tgt.mods.length + ' modules) · 7 points at it · 8 kills your relative speed · map: Meet station' : 'Station target cleared', 3000); }
  if (!R.on || !pilot()) return;
  if (k === 'KeyK') cargoRelease();
  if (k === 'KeyH') dockToggle();
  if ((k === 'Digit7' || k === 'Numpad7' || k === 'Digit8' || k === 'Numpad8') && R.st === 'fly') { if (!VES.tgt) { showHint('Pick a station target first (Y)', 2000); return; } setSas(k.endsWith('7') ? 'tgt' : 'kill');
    showHint(k.endsWith('7') ? 'Pointing at ' + VES.tgt.name : 'Pointing against your speed relative to ' + VES.tgt.name + ': burn to stop', 2500); } });

// ---------------- closest approach to a station (both on Kepler orbits around the same world)
function closest(V, p0, v0, t0, span) { const b = BODIES[V.b]; if (domBody(p0) !== b) return null; const rp = p0.clone().sub(b.c), vp = v0.clone().sub(b === PLANET ? _t3s.set(0, 0, 0) : satVel(b, t0, _t3s));
  const d = t => { kepler(rp, vp, b.GM, t - t0, _t1s); kepler(V.r, V.v, b.GM, t - V.t0, _t2s); return _t1s.distanceTo(_t2s); }; const N = 240; let bt = t0, bd = Infinity;
  for (let i = 0; i <= N; i++) { const t = t0 + span * i / N, dd = d(t); if (dd < bd) { bd = dd; bt = t; } }
  let lo = Math.max(t0, bt - span / N), hi = bt + span / N; for (let i = 0; i < 40; i++) { const m1 = lo + (hi - lo) * .382, m2 = lo + (hi - lo) * .618; if (d(m1) < d(m2)) hi = m2; else lo = m1; }
  const tc = (lo + hi) / 2; return {t: tc, d: d(tc)}; }
function orbitPeriod(p, v, b) { const r = p.distanceTo(b.c), vv = v.clone().sub(b === PLANET ? _t3s.set(0, 0, 0) : satVel(b, G.t, _t3s)), a = 1 / (2 / r - vv.lengthSq() / b.GM); return a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / b.GM) : 3600; }
function meetStation() { // plan: one burn that brings you close, or (when already close) one that matches speed at the closest point
  const V = VES.tgt || VES.near; if (!V) { showHint('Pick a station target first (Y)', 2200); return; } VES.tgt = V; if (R.st !== 'fly') return;
  const b = BODIES[V.b]; if (domBody(R.pos) !== b) { showHint(V.name + ' orbits ' + b.name + ': get into orbit there first', 2500); return; }
  const o = orbitEl(b); if (o.pe < (b === PLANET ? PLANET.atmo : 2000) || o.ap === Infinity) { showHint('Get into orbit first', 2000); return; }
  const P = orbitPeriod(R.pos, R.vel, b), now = closest(V, R.pos, R.vel, G.t, P * 5.2);
  if (now && now.d < 20000) { // close already: match speed there
    const p = new V3(), v = new V3(); kepler(R.pos.clone().sub(b.c), R.vel.clone(), b.GM, now.t - G.t, p, v); p.add(b.c); kepler(V.r, V.v, b.GM, now.t - V.t0, _t1s, _t2s);
    const dvI = _t2s.clone().sub(v), pro = new V3(), nrm = new V3(), rad = new V3(); nodeBasis(p, v, now.t, pro, nrm, rad); nodeMake(Math.max(G.t + 20, now.t - 5), new V3(dvI.dot(pro), dvI.dot(nrm), dvI.dot(rad)));
    showHint('Match-speed burn at the closest point (' + fmtD(now.d) + ' away): then H flies you in', 4500); return; }
  // phasing: Hohmann-like burn timed so you arrive where the station will be, then tuned
  const r1 = R.pos.distanceTo(b.c); vesState(V, G.t, _tP, _tV); const r2 = _tP.distanceTo(b.c), mu = b.GM, at = (r1 + r2) / 2, tt = Math.PI * Math.sqrt(at * at * at / mu), n2 = Math.sqrt(mu / (r2 * r2 * r2)), n1 = 2 * Math.PI / P;
  const h = R.pos.clone().sub(b.c).cross(R.vel).normalize(), rs = R.pos.clone().sub(b.c), ss = _tP.clone().sub(b.c); let ph = Math.atan2(rs.clone().cross(ss).dot(h), rs.dot(ss)); // station ahead of us (rad)
  const want = Math.PI - n2 * tt, rate = n1 - n2; let wait = Math.abs(rate) > 1e-9 ? (ph - want) / rate : 0; const syn = Math.abs(2 * Math.PI / rate); wait = ((wait % syn) + syn) % syn; if (!isFinite(wait)) wait = 60;
  let lastC = null; const score = (t, dv, dn, span) => { const p = new V3(), v = new V3(); kepler(R.pos.clone().sub(b.c), R.vel.clone(), mu, t - G.t, p, v); p.add(b.c); const pro = new V3(), nrm = new V3(), rad = new V3(); nodeBasis(p, v, t, pro, nrm, rad);
    v.addScaledVector(pro, dv).addScaledVector(nrm, dn); const P2 = orbitPeriod(p, v, b), c = closest(V, p, v, t, span || P2 * .75); lastC = c; const rr = p.clone().sub(b.c), hh = rr.clone().cross(v).length(), en = v.lengthSq() / 2 - mu / rr.length(), a = -mu / (2 * en), e = Math.sqrt(Math.max(0, 1 - hh * hh / (a * mu))), pe = a * (1 - e) - b.R;
    return (c ? (c.d < 15000 ? c.d * .03 : c.d - 15000 + 450) + (c.t - G.t) * .05 : 1e9) + (pe < (b === PLANET ? PLANET.atmo : 2000) || !(a > 0) ? 1e7 : 0) + Math.hypot(dv, dn) * 1.5; };
  const p = new V3(), v = new V3(); let t0 = G.t + Math.max(60, wait); kepler(R.pos.clone().sub(b.c), R.vel.clone(), mu, t0 - G.t, p, v); const r = p.length(), dv0 = Math.sqrt(mu * (2 / r - 2 / (r + r2))) - v.length();
  const C = []; for (const dtf of [-.06, -.03, 0, .03, .06]) for (const kk of [.9, 1, 1.1]) C.push({t: t0 + dtf * P, dv: dv0 * kk, dn: 0, span: 0});
  // phasing orbits: burn soon, go round k times on a slightly bigger or smaller orbit while the station catches up (or we catch it)
  { const tb = G.t + 90; kepler(R.pos.clone().sub(b.c), R.vel.clone(), mu, tb - G.t, p, v); const rb = p.length(), sb = vesState(V, tb, new V3()).sub(b.c); let ang = Math.atan2(p.clone().cross(sb).dot(h), p.dot(sb)); // station ahead of the burn point
    for (let k = 1; k <= 4; k++) for (let m = -1; m <= 2; m++) { const Pp = (2 * Math.PI * (k + m) - ang) / (n2 * k); if (!(Pp > P * .6 && Pp < P * 1.8)) continue; const a2 = Math.cbrt(mu * (Pp / (2 * Math.PI)) ** 2), vv = Math.sqrt(mu * (2 / rb - 1 / a2));
      if (!isFinite(vv)) continue; C.push({t: tb, dv: vv - v.length(), dn: 0, span: Pp * (k + .35)}); } }
  for (const c of C) c.s = c.t < G.t + 30 ? Infinity : score(c.t, c.dv, c.dn, c.span); C.sort((x, y) => x.s - y.s);
  const refine = c0 => { let best = {...c0}; const st = {t: P * .01, dv: Math.max(2, Math.abs(best.dv) * .02), dn: 5}; for (let it = 0; it < 50; it++) { let moved = false; for (const k of ['t', 'dv', 'dn']) for (const sg of [1, -1]) { const c = {...best}; c[k] += sg * st[k]; if (c.t < G.t + 30) continue; c.s = score(c.t, c.dv, c.dn, c.span); if (c.s < best.s) { best = c; moved = true; break; } }
    if (!moved) { st.t *= .5; st.dv *= .5; st.dn *= .5; } if (st.dv < .02 && st.t < .5) break; } return best; };
  let best = {s: Infinity}; for (const c of C.slice(0, 3)) { if (!isFinite(c.s)) continue; const r2b = refine(c); if (r2b.s < best.s) best = r2b; }
  if (!isFinite(best.s) || best.s >= 1e7) { showHint('Could not find a way to ' + V.name + ' from this orbit', 3000); return; }
  score(best.t, best.dv, best.dn, best.span);
  const cA = lastC; nodeMake(best.t, new V3(best.dv, best.dn, 0));
  showHint('Meet ' + V.name + ': burn ' + Math.round(Math.hypot(best.dv, best.dn)) + ' m/s in ' + fmtS(best.t - G.t) + (cA ? ' · passes ' + fmtD(cA.d) + ' from it in ' + fmtS(cA.t - G.t) : '') + '. After the burn, press Meet station again for the match-speed burn', 7000); }
{ const q = $('navQ'), bt = document.createElement('button'); bt.id = 'qSt'; bt.textContent = 'Meet station'; bt.title = 'Burn node to meet your station target (Y picks it); when close, a burn that matches its speed'; bt.onclick = () => meetStation(); const ref = $('qTr'); ref.after(bt); }

// ---------------- HUD: station tag + target readout
{ const t = document.createElement('div'); t.id = 'stTag'; t.className = 'hidden'; document.body.appendChild(t); const i = document.createElement('div'); i.id = 'stInfo'; i.className = 'hidden'; document.body.appendChild(i); }
let stHudT = 0;
function stationHud(dt) { const tag = $('stTag'), inf = $('stInfo'), V = VES.tgt || (VES.near && VES.nearD < 50000 ? VES.near : null);
  if (!G.on || !V || MAPV.on || (typeof BLD !== 'undefined' && BLD.on)) { tag.classList.add('hidden'); inf.classList.add('hidden'); return; }
  vesState(V, G.t, _tP, _tV); const rel = _t1s.copy(_tP).sub(G.O), d = R.pos.distanceTo(_tP), rv = R.vel.distanceTo(_tV); _t2s.copy(rel).project(cam);
  const vis = _t2s.z < 1 && Math.abs(_t2s.x) < 1.05 && Math.abs(_t2s.y) < 1.05 && rel.length() > 30;
  tag.classList.toggle('hidden', !vis); if (vis) { tag.style.left = ((_t2s.x * .5 + .5) * innerWidth) + 'px'; tag.style.top = ((-_t2s.y * .5 + .5) * innerHeight) + 'px'; tag.textContent = V.name + ' · ' + fmtD(rel.length()); }
  if ((stHudT -= dt) > 0) return; stHudT = .2;
  const show = R.on && (R.st === 'fly' || R.st === 'docked') && (d < 2e5 || VES.tgt === V); inf.classList.toggle('hidden', !show); if (!show) return;
  const closing = -R.pos.clone().sub(_tP).dot(_t3s.copy(R.vel).sub(_tV)) / Math.max(1, d), cargo = cargoNext();
  let s = '<b>' + V.name + '</b> · ' + fmtD(d) + ' · ' + (Math.abs(closing) < .05 ? 'holding' : closing > 0 ? 'closing ' + closing.toFixed(1) + ' m/s' : 'opening ' + (-closing).toFixed(1) + ' m/s') + ' · rel ' + rv.toFixed(1) + ' m/s';
  if (R.st === 'docked') s += ' · <span class="k">H</span> undock'; else if (DK.ap) s += ' · <span class="ok">docking…</span> <span class="k">H</span> cancel';
  else if (d < 20000 && rv < 60) s += ' · <span class="k">H</span> auto-dock'; else if (d < 60000) s += ' · <span class="k">8</span> kill rel. speed';
  if (cargo && (R.st === 'fly' || R.st === 'docked')) s += ' · <span class="k">K</span> release ' + MODULES[cargo.b.k].name.toLowerCase();
  if (inf._h !== s) { inf._h = s; inf.innerHTML = s; } }


// ---------------- map: station orbits, markers and the closest approach
{ const mr0 = mapRender; mapRender = function (dt) { mr0(dt); const M = MAPV, x = M.x, cam2 = M.cam, W = innerWidth, H = innerHeight, q = new V3();
  const prj = p => { q.copy(p).multiplyScalar(.001).project(cam2); return {x: (q.x * .5 + .5) * W, y: (-q.y * .5 + .5) * H, ok: q.z < 1 && q.z > -1}; };
  for (const V of VES.list) { const b = BODIES[V.b], tg = V === VES.tgt, r = V.r.length(), vv2 = V.v.lengthSq(), a = 1 / (2 / r - vv2 / b.GM); if (!(a > 0)) continue; const P = 2 * Math.PI * Math.sqrt(a * a * a / b.GM);
    x.strokeStyle = tg ? 'rgba(201,180,255,.75)' : 'rgba(201,180,255,.28)'; x.lineWidth = tg ? 1.6 : 1; x.beginPath(); for (let i = 0; i <= 120; i++) { const s = prj(vesState(V, G.t + P * i / 120, _t1s)); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); } x.stroke();
    const s = prj(vesState(V, G.t, _t1s)); if (!s.ok) continue; x.fillStyle = tg ? '#c9b4ff' : '#9d8fc4'; x.save(); x.translate(s.x, s.y); x.rotate(Math.PI / 4); x.fillRect(-4, -4, 8, 8); x.restore();
    x.font = '600 12px Archivo, sans-serif'; x.textAlign = 'center'; x.fillText(V.name + (tg ? ' (target)' : ''), s.x, s.y - 10); x.textAlign = 'left'; }
  const V = VES.tgt; if (V && R.st === 'fly' && (M.ct = (M.ct || 0) - dt) <= 0) { M.ct = .5; const b = BODIES[V.b]; M.cA = domBody(R.pos) === b ? closest(V, R.pos, R.vel, G.t, orbitPeriod(R.pos, R.vel, b)) : null;
    M.cB = NODE && NODE.pos && NODE.vel && domBody(NODE.pos) === b ? closest(V, NODE.pos, NODE.vel.clone().add(NODE.bv), NODE.t, orbitPeriod(NODE.pos, NODE.vel.clone().add(NODE.bv), b)) : null; }
  if (V && R.st === 'fly') for (const [c, base, col] of [[M.cA, null, '#9fb6cc'], [M.cB, NODE, '#c9b4ff']]) { if (!c || c.d > 2e6) continue; const b = BODIES[V.b];
    const p = base ? kepler(base.pos.clone().sub(b.c), base.vel.clone().add(base.bv), b.GM, c.t - base.t, new V3()).add(b.c) : kepler(R.pos.clone().sub(b.c), R.vel.clone(), b.GM, c.t - G.t, new V3()).add(b.c);
    const s = prj(p), s2 = prj(vesState(V, c.t, _t1s)); if (!s.ok) continue; x.strokeStyle = col; x.setLineDash([3, 4]); x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(s2.x, s2.y); x.stroke(); x.setLineDash([]);
    x.font = '600 12px Archivo, sans-serif'; x.fillStyle = col; x.fillText((base ? 'After burn: ' : 'Closest: ') + fmtD(c.d) + ' in ' + fmtS(c.t - G.t), s.x + 8, s.y + 14); } }; }

// ---------------- builder: pick the module a cargo bay carries
{ const cat0 = bldCatalog; bldCatalog = function () { cat0(); const host = $('bldParts'), at = host.querySelector('#bldPaint'); if (!at) return; const hd = document.createElement('div'); hd.className = 'bt'; hd.textContent = 'Cargo bay module'; const box = document.createElement('div'); box.id = 'bldCargo';
    at.previousElementSibling.before(hd, box); for (const k in MODULES) { const M = MODULES[k], b = document.createElement('button'); b.className = 'bp'; b.dataset.cargo = k; b.innerHTML = '<i class="ic ic-tank" style="--w:16px;--h:22px"></i><span><b>' + M.name + '</b><small>' + M.desc + ' · ' + (M.m / 1000).toFixed(1) + ' t</small></span>'; b.onclick = () => bldCargo(k); box.appendChild(b); } };
  const pan0 = bldPanels; bldPanels = function () { pan0(); const sel = BLD.parts[BLD.sel], isBay = sel && sel.k === 'bay'; document.querySelectorAll('#bldCargo [data-cargo]').forEach(b => { b.disabled = !isBay; b.classList.toggle('on', isBay && (sel.cargo || 'hab') === b.dataset.cargo); });
    if (isBay) $('bldSel').textContent = 'Cargo bay selected · pick the module it carries on the left (K releases it in orbit)'; }; }
function bldCargo(k) { const p = BLD.parts[BLD.sel]; if (!p || p.k !== 'bay') { showHint('Select a cargo bay first', 1800); return; } bldPush(); p.cargo = k; bldRebuild(); }
SHIP_PRESETS['Station Hauler'] = [{k: 'bay', cargo: 'hub'}, {k: 'tM'}, {k: 'swift'}, {k: 'dec'}, {k: 'tXL'}, {k: 'tXL', side: {n: 2, pre: 'thumper', parts: [{k: 'coneL'}, {k: 'thumper', fins: 1}]}}, {k: 'vector'}];
SHIP_PRESETS['Depot Hauler'] = [{k: 'bay', cargo: 'depot'}, {k: 'tL'}, {k: 'swift'}, {k: 'dec'}, {k: 'tXL'}, {k: 'tXL', side: {n: 4, pre: 'thumper', parts: [{k: 'coneL'}, {k: 'thumper', fins: 1}]}}, {k: 'vector'}];
{ const ad0 = bldAdd; bldAdd = function (k) { ad0(k); if (k === 'bay') { const p = BLD.parts[BLD.sel]; if (p && !p.cargo) { p.cargo = 'hab'; bldRebuild(); } } }; }

// ---------------- saves: cargo and docking survive Continue
{ const fs0 = flightSave; flightSave = function () { if (R.st === 'docked' || DK.ap) return; fs0(); try { const d = JSON.parse(localStorage.getItem(SAVE_K) || 'null'); if (d) { d.cargoM = R.cargoM; d.cargoOut = R.cargoOut; localStorage.setItem(SAVE_K, JSON.stringify(d)); } } catch (e) {} }; }
{ const fl0 = flightLoad; flightLoad = function (d) { fl0(d); if (d.cargoM) R.cargoM = d.cargoM; if (d.cargoOut) { R.cargoOut = d.cargoOut; R.sg.forEach((g, i) => { for (const b of g.userData.bays || []) if (R.cargoOut[i + ':' + b.it.i]) { b.out = true; b.open = b.want = 1; b.mod.visible = false; bayPose(b); } }); } R.comY = comOf(); }; }

// ---------------- missions
MISD.push(
  {id: 'st1', name: 'Start a station', d: 'Carry a station module to orbit in a cargo bay and let it go.', steps: [
    ['In the builder add a Cargo bay and pick its module (or load "Station Hauler")', F => SHIP.parts.some(p => p.k === 'bay') || F.newStation], ['Get into orbit (Pe above 22 km)', F => F.orbit || F.newStation], ['Cut the engine and press K: the bay opens and the module floats free', F => F.newStation || VES.list.length > 0]], done: F => F.newStation},
  {id: 'st2', name: 'Grow your station', d: 'Bring a second module and let it dock itself to your station.', steps: [
    ['Have a station in orbit (Start a station)', F => VES.list.length > 0], ['Launch another module. Press Y to target the station', F => !!VES.tgt], ['In the map press Meet station, burn, then Meet station again to match speed', F => F.dockedMod || (VES.tgt && VES.nearD < 3000)], ['Dock (H) or get within 300 m, then press K: the module flies itself onto the station', F => F.dockedMod]], done: F => F.dockedMod},
  {id: 'st3', name: 'Visit the station', d: 'Dock your ship with a station.', steps: [
    ['Get close to a station (under 20 km) and slow (8 kills your relative speed)', F => F.dockShip || (VES.nearD < 20000 && R.st === 'fly')], ['Press H: the docking autopilot flies you onto a free port', F => F.dockShip]], done: F => F.dockShip},
  {id: 'st4', name: 'Gas station', d: 'Dock at a station with a Fuel depot and fill your tanks.', steps: [
    ['Put a Fuel depot module on a station ("Depot Hauler")', F => VES.list.some(V => V.mods.some(m => m.k === 'depot')) || F.refuel], ['Dock with that station (H)', F => F.refuel]], done: F => F.refuel},
  {id: 'st5', name: 'Space city', d: 'Grow one station to 6 modules.', bonus: true, steps: [[F => 'Biggest station: ' + Math.max(0, ...VES.list.map(V => V.mods.length)) + ' of 6 modules', F => VES.list.some(V => V.mods.length >= 6)]], done: F => VES.list.some(V => V.mods.length >= 6)});

// ---------------- per-frame hook (after the flight visuals)
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v0(dt); vesFrame(dt); stationHud(dt); }; }
vesLoad();
Object.assign(window.YE, {VES, MODULES, kepler, vesNew, vesAttach, vesState, cargoRelease, dockToggle, meetStation, closest, DK, modMesh});
