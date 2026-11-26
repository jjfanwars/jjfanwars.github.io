'use strict';
// YeShip world pass (25 Nov 2026; owner: "make the map, hangar and home planet 10x better").
// Hangar inside: lit lining, roof trusses, lamps with light shafts, your current rocket on the assembly stand, every part on show (F adds it),
// status board, build console, mezzanine office, crane, workshop corner. Grounds: roads, parking, rocket garden, tracking station, control tower,
// fuel farm, the town of Yeville, forests, bushes, rocks and grass. Loaded after build.js, before polish.js (which calls boot()).

const WLD = {acts: [], near: null, night: 0, day: 1};
// hangar lighting: like interiorMat, plus top-down shading from the lamps (upV = site up in view space, set every frame)
const INT_HG = {k: {value: .16}, a: {value: new THREE.Color(.6, .61, .64)}}, HG_UP = {value: new V3(0, 1, 0)};
function hgMat(m) { m.onBeforeCompile = sh => { sh.uniforms.inK = INT_HG.k; sh.uniforms.inA = INT_HG.a; sh.uniforms.upV = HG_UP;
    sh.fragmentShader = 'uniform float inK; uniform vec3 inA, upV;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', 'irradiance = irradiance * inK + inA * (.4 + .6 * (.5 + .5 * dot(normal, upV))); iblIrradiance *= inK; radiance *= inK;\n#include <lights_fragment_end>'); };
  m.customProgramCacheKey = () => 'hangar'; m.needsUpdate = true; return m; }
const _hgc = {};
function hm(col, r = .7, mt = 0, o = {}) { const k = [col, r, mt, o.t && o.t.uuid, o.em && o.em.uuid, o.e, o.ei, o.tile, o.vc ? 1 : 0, o.ds ? 1 : 0].join('|'); if (_hgc[k]) return _hgc[k];
  const M = new THREE.MeshStandardMaterial({color: col, roughness: r, metalness: mt, map: o.t || null, emissive: o.e || 0, emissiveIntensity: o.e ? (o.ei || 1) : 0, emissiveMap: o.em || null, vertexColors: !!o.vc, side: o.ds ? THREE.DoubleSide : THREE.FrontSide});
  M.userData.tile = o.tile || 4; return _hgc[k] = hgMat(M); }
const _hgClone = {};
const hgOf = m => _hgClone[m.uuid] || (_hgClone[m.uuid] = hgMat(m.clone())); // indoor copy of a rocket material
// merge a group's meshes into one mesh per material (static displays: far fewer draw calls)
function bakeByMat(root, mapM) {
  root.updateMatrixWorld(true); const by = new Map();
  root.traverse(o => { if (!o.isMesh) return; const m = mapM ? mapM(o.material) : o.material; const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); if (!by.has(m)) by.set(m, []); by.get(m).push(geo); });
  const out = new THREE.Group();
  for (const [m, list] of by) { let n = 0; for (const gg of list) n += gg.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
    for (const gg of list) { const p = gg.attributes.position, q = gg.attributes.normal, u = gg.attributes.uv; P.set(p.array, o * 3); if (q) N.set(q.array, o * 3); if (u) U.set(u.array, o * 2); o += p.count; gg.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2)); geo.computeBoundingSphere();
    const me = new THREE.Mesh(geo, m); me.castShadow = !m.transparent && !m.isMeshBasicMaterial; me.receiveShadow = true; if (m.transparent) me.renderOrder = 4; out.add(me); }
  root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); return out;
}
// the whole rocket (stack + capsule) as meshes, bottom of the stack at y 0
function rocketModel(parts, paint) { const st = shipLayout(parts), g = new THREE.Group(), y0 = Math.min(...st.filter(S => !S.cap).map(S => S.y0), 21.6);
  st.forEach((S, si) => { if (S.cap) capsuleLook(g); else stageMeshes(g, S, si, true, paint); });
  g.userData.legs = null; const w = new THREE.Group(); g.position.y = -y0; w.add(g); return {g: w, h: 26.1 - y0, st}; }
function siteSun() { const s = SITE.clone().applyQuaternion(PLANET.q); return s.dot(SUN); } // sun elevation (sine) at the space centre

// ---------------- the hangar inside
function hangarInside() {
  const H = site.H, g = site.g, {box, signTex} = H, X0 = -22.4, X1 = 22.4, Z0 = -25.4, Z1 = 25.4, TOP = 34;
  const vcH = hm(0xffffff, .55, .35, {vc: true}), addM = (L, m = vcH) => H.addMerged(L, m);
  const rep = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // ---- floor: painted epoxy with joints, tyre marks, walkways, the assembly bay ring and zone labels
  { const S = 40, W = Math.round((X1 - X0) * S), Hh = Math.round((Z1 - Z0) * S), X = x => (x - X0) * S, Z = z => (z - Z0) * S;
    const t = signTex(W, Hh, (c, w, h) => { c.fillStyle = '#5f6872'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 220, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, Math.random() < .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 26000; i++) { c.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)'; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
      c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2; for (let x = 6; x < 44; x += 6) { c.beginPath(); c.moveTo(x * S, 0); c.lineTo(x * S, h); c.stroke(); } for (let z = 6; z < 50; z += 6) { c.beginPath(); c.moveTo(0, z * S); c.lineTo(w, z * S); c.stroke(); }
      c.lineCap = 'round'; for (let i = 0; i < 14; i++) { c.strokeStyle = 'rgba(10,10,12,.07)'; c.lineWidth = 16; const x = X(-10 + Math.random() * 20), y = Z(25); c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + (Math.random() - .5) * 400, y - 500, X((Math.random() - .5) * 30), Z(-2), X((Math.random() - .5) * 34), Z(-14 + Math.random() * 30)); c.stroke(); }
      const yel = '#e3b425'; c.fillStyle = yel; for (const x of [-16.2, 16.2]) c.fillRect(X(x) - 3, Z(-24.6), 6, (49.2) * S); c.fillRect(X(-16.2), Z(-24.6) - 3, (32.4) * S, 6);
      // assembly bay: hazard ring + dark disc + name
      const cx = X(0), cy = Z(-8); c.fillStyle = '#4a5159'; c.beginPath(); c.arc(cx, cy, 7.4 * S, 0, 7); c.fill();
      c.save(); c.beginPath(); c.arc(cx, cy, 8.3 * S, 0, 7); c.arc(cx, cy, 7.4 * S, 0, 7, true); c.clip(); c.fillStyle = '#18191b'; c.fillRect(cx - 9 * S, cy - 9 * S, 18 * S, 18 * S); c.fillStyle = yel;
      for (let i = -30; i < 30; i++) { c.beginPath(); const x = cx + i * 24; c.moveTo(x, cy - 9 * S); c.lineTo(x + 12, cy - 9 * S); c.lineTo(x + 12 + 18 * S, cy + 9 * S); c.lineTo(x + 18 * S, cy + 9 * S); c.fill(); } c.restore();
      c.font = `700 ${1.25 * S}px Archivo, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(255,207,74,.9)'; c.fillText('ASSEMBLY BAY 1', cx, Z(1.6));
      // roll-out lane to the door
      c.fillStyle = 'rgba(240,240,235,.75)'; for (let z = 2.5; z < 23; z += 2.4) for (const x of [-4.2, 4.2]) c.fillRect(X(x) - 3, Z(z), 6, 1.4 * S);
      c.fillStyle = 'rgba(240,240,235,.6)'; for (let z = 8; z <= 18; z += 10) { c.beginPath(); c.moveTo(X(0), Z(z + 2.2)); c.lineTo(X(-1.4), Z(z)); c.lineTo(X(-.5), Z(z)); c.lineTo(X(-.5), Z(z - 2)); c.lineTo(X(.5), Z(z - 2)); c.lineTo(X(.5), Z(z)); c.lineTo(X(1.4), Z(z)); c.fill(); }
      c.font = `700 ${.8 * S}px Archivo, Arial, sans-serif`; c.fillText('ROLL-OUT', X(0), Z(14.4));
      // door: keep clear hatching
      c.save(); c.beginPath(); c.rect(X(-18), Z(23.4), 36 * S, 2 * S); c.clip(); c.fillStyle = '#1a1b1d'; c.fillRect(X(-18), Z(23.4), 36 * S, 2 * S); c.fillStyle = yel; for (let x = X(-19); x < X(19); x += 40) { c.beginPath(); c.moveTo(x, Z(25.4)); c.lineTo(x + 20, Z(25.4)); c.lineTo(x + 20 + 2 * S, Z(23.4)); c.lineTo(x + 2 * S, Z(23.4)); c.fill(); } c.restore();
      const lab = (s, x, z, a, sz = 1) => { c.save(); c.translate(X(x), Z(z)); c.rotate(a); c.font = `700 ${sz * S}px Archivo, Arial, sans-serif`; c.fillStyle = 'rgba(255,255,255,.5)'; c.fillText(s, 0, 0); c.restore(); };
      lab('ENGINES · PARTS', -14.6, -4, Math.PI / 2); lab('FUEL TANKS', 14.6, -5, -Math.PI / 2); lab('BUILD CONSOLE', 14, 21.8, 0, .7); lab('WORKSHOP', -10, 24.6, 0, .55);
    });
    t.anisotropy = 8; const fl = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), hm(0xffffff, .38, .05, {t})); fl.rotation.x = -Math.PI / 2; fl.position.set(0, .08, 0); fl.receiveShadow = true; g.add(fl); }
  // ---- wall lining: ribbed insulated panels, blue dado with a yellow line, roof underside
  const ribT = rep(signTex(256, 256, (c, w, h) => { c.fillStyle = '#d6dadf'; c.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 64) { c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(i, 0, 3, h); c.fillStyle = 'rgba(0,0,0,.13)'; c.fillRect(i + 3, 0, 4, h); }
    c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(0, 0, w, 2); for (let i = 0; i < 1200; i++) { c.fillStyle = 'rgba(0,0,0,.025)'; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }));
  const wallM = hm(0xffffff, .8, 0, {t: ribT, tile: 2.2}), dadoM = hm(0x34475e, .6, .1), lineM = hm(0xe3b425, .5), ceilM = hm(0x5a626c, .9);
  box(X0 + .1, 3.1, 0, .2, TOP - 3.1, Z1 - Z0, 0, false, {m: wallM, cast: false}); box(X1 - .1, 3.1, 0, .2, TOP - 3.1, Z1 - Z0, 0, false, {m: wallM, cast: false}); box(0, 3.1, Z0 + .1, X1 - X0, TOP - 3.1, .2, 0, false, {m: wallM, cast: false});
  for (const [x, w] of [[-20.2, 4.4], [20.2, 4.4]]) box(x, 3.1, Z1 - .1, w, 22.9, .2, 0, false, {m: wallM, cast: false}); box(0, 26, Z1 - .1, X1 - X0, 8, .2, 0, false, {m: wallM, cast: false});
  box(X0 + .15, 0, 0, .3, 3, Z1 - Z0, 0, false, {m: dadoM, cast: false}); box(X1 - .15, 0, 0, .3, 3, Z1 - Z0, 0, false, {m: dadoM, cast: false}); box(0, 0, Z0 + .15, X1 - X0, 3, .3, 0, false, {m: dadoM, cast: false});
  for (const x of [-20.2, 20.2]) box(x, 0, Z1 - .15, 4.4, 3, .3, 0, false, {m: dadoM, cast: false});
  box(X0 + .17, 2.95, 0, .34, .15, Z1 - Z0, 0, false, {m: lineM, cast: false}); box(X1 - .17, 2.95, 0, .34, .15, Z1 - Z0, 0, false, {m: lineM, cast: false}); box(0, 2.95, Z0 + .17, X1 - X0, .15, .34, 0, false, {m: lineM, cast: false});
  box(0, TOP - .25, 0, X1 - X0, .2, Z1 - Z0, 0, false, {m: ceilM, cast: false});
  // ---- clerestory windows (daylight through the high band; dark at night)
  { const cm = new THREE.MeshBasicMaterial({color: 0xffffff}); WLD.clerM = cm; for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - Z0 - 6, 2.4), cm); m.position.set(sx * (X1 - .22), 28.3, 0); m.rotation.y = -sx * Math.PI / 2; g.add(m); }
    const L = []; for (const sx of [-1, 1]) { for (let z = -22; z <= 22; z += 2.75) L.push(H.boxGeo(sx * (X1 - .25), 27.05, z, .12, 2.5, .14, 0x2d343d)); L.push(H.boxGeo(sx * (X1 - .25), 26.95, 0, .14, .14, Z1 - Z0 - 5.8, 0x2d343d), H.boxGeo(sx * (X1 - .25), 29.5, 0, .14, .14, Z1 - Z0 - 5.8, 0x2d343d)); } addM(L); }
  // ---- roof trusses + purlins, lamps with soft light shafts
  { const L = [], tc = 0x7f8a96, yb = 30.9, yt = 33.6; for (let z = -22.2; z <= 22.3; z += 6.35) { L.push(H.beamGeo(new V3(X0, yb, z), new V3(X1, yb, z), .13, tc), H.beamGeo(new V3(X0, yt, z), new V3(X1, yt, z), .13, tc));
      for (let x = X0; x < X1 - .1; x += 2.8) { const x2 = Math.min(X1, x + 2.8); L.push(H.beamGeo(new V3(x, yb, z), new V3(x, yt, z), .07, tc), H.beamGeo(new V3(x, (x / 2.8 | 0) % 2 ? yb : yt, z), new V3(x2, (x / 2.8 | 0) % 2 ? yt : yb, z), .06, tc)); } }
    for (let x = -19.6; x <= 19.7; x += 5.6) L.push(H.boxGeo(x, yt + .1, 0, .18, .3, Z1 - Z0, 0x6b7580));
    // crane rails on corbels down both long walls
    for (const sx of [-1, 1]) { L.push(H.boxGeo(sx * 21.2, 27.3, 0, .9, .7, Z1 - Z0, 0x3b434d)); for (let z = -22; z <= 22; z += 6.35) L.push(H.boxGeo(sx * 21.7, 0, z, .7, 27.3, .7, 0x56606b)); }
    addM(L);
    const lampM = new THREE.MeshBasicMaterial({color: new THREE.Color(5, 4.8, 4.4)}), housing = hm(0x2b3036, .5, .6), cone = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: {I: {value: .018}},
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying float vY; varying vec3 vN, vV;
void main(){ vY = uv.y; vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float I; varying float vY; varying vec3 vN, vV;
void main(){
#include <logdepthbuf_fragment>
  float f = abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(vec3(1., .96, .88) * I * f * f * pow(vY, 2.2), 1.); }`});
    WLD.coneM = cone; const hg = new THREE.CylinderGeometry(.35, .62, .5, 20), cg = new THREE.CylinderGeometry(.5, 6.5, 29, 24, 1, true), dg = new THREE.CircleGeometry(.56, 20);
    const lg = new THREE.Group(); for (const x of [-13.5, -4.5, 4.5, 13.5]) for (const z of [-19, -9.5, 0, 9.5, 19]) { const hh = new THREE.Mesh(hg, housing); hh.position.set(x, 29.9, z); lg.add(hh); const d = new THREE.Mesh(dg, lampM); d.rotation.x = Math.PI / 2; d.position.set(x, 29.64, z); lg.add(d);
      const c = new THREE.Mesh(cg, cone); c.position.set(x, 29.6 - 14.5, z); lg.add(c); } g.add(bakeByMat(lg));
    const L2 = []; for (const x of [-13.5, -4.5, 4.5, 13.5]) for (const z of [-19, -9.5, 0, 9.5, 19]) L2.push(H.beamGeo(new V3(x, 30.15, z), new V3(x, 30.9, z), .02, 0x222222, 4)); addM(L2); }
  // ---- overhead crane parked toward the door
  { const L = [], zc = 7; L.push(H.boxGeo(0, 27.9, zc, 42.2, 1.5, 1.2, 0xf2b81e), H.boxGeo(0, 27.9, zc + 1.6, 42.2, 1.5, 1.2, 0xf2b81e)); for (const sx of [-1, 1]) L.push(H.boxGeo(sx * 20.6, 27.6, zc + .8, 1.6, 1.2, 4.6, 0x3b434d));
    L.push(H.boxGeo(3, 29.4, zc + .8, 3.2, 1.1, 3.4, 0x2f3740), H.beamGeo(new V3(2.6, 29.4, zc + .8), new V3(2.6, 20.2, zc + .8), .025, 0x111111, 4), H.beamGeo(new V3(3.4, 29.4, zc + .8), new V3(3.4, 20.2, zc + .8), .025, 0x111111, 4), H.boxGeo(3, 19.2, zc + .8, 1.3, 1, .6, 0xf2b81e), H.beamGeo(new V3(3, 19.2, zc + .8), new V3(3, 18.3, zc + .8), .12, 0x2b2b2b, 6));
    addM(L); const sg = H.decal(signTex(256, 64, (c, w, h) => { c.fillStyle = '#f2b81e'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.font = '700 44px Archivo, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SWL 40 T', w / 2, h / 2 + 2); }), 0, 28.65, zc + 2.22, 4, 1);
    sg.material = hm(0xffffff, .6, 0, {t: sg.material.map}); }
  // ---- assembly stand + service towers with swing arms
  const RZ = -8; WLD.rz = RZ;
  { const steel = tex('plate', 'c'), mount = hm(0x9aa2ab, .5, .4, {t: steel, tile: 2}); const base = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.6, .35, 48), hm(0x30353b, .6, .5)); base.position.set(0, .2, RZ); base.receiveShadow = true; g.add(base);
    const m2 = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.5, .9, 48), mount); m2.position.set(0, .75, RZ); m2.castShadow = m2.receiveShadow = true; g.add(m2);
    const st = H.stripes.clone(); st.repeat.set(26, 1); st.needsUpdate = true; const band = new THREE.Mesh(new THREE.CylinderGeometry(4.52, 4.52, .3, 64, 1, true), hm(0xffffff, .6, 0, {t: st})); band.position.set(0, .82, RZ); g.add(band);
    site.boxes.push({x0: -4.4, x1: 4.4, y0: 0, y1: 1.2, z0: RZ - 4.4, z1: RZ + 4.4});
    const L = []; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; L.push(H.boxGeo(Math.cos(a) * 3.3, 1.2, RZ + Math.sin(a) * 3.3, .7, .6, .7, 0x2b3036)); }
    for (const sx of [-1, 1]) { const x0 = sx * 8.2; for (const [dx, dz] of [[-1.5, -2.2], [1.5, -2.2], [1.5, 2.2], [-1.5, 2.2]]) L.push(H.beamGeo(new V3(x0 + dx, 0, RZ + dz), new V3(x0 + dx, 26.4, RZ + dz), .13, 0xf2b81e));
      for (let y = 4; y <= 26; y += 5.5) { L.push(H.boxGeo(x0, y, RZ, 3.4, .22, 4.8, 0x8c959f)); L.push(H.boxGeo(x0 - sx * 3.15, y, RZ, 2.9, .2, 1.6, 0x8c959f)); // platform + arm toward the rocket
        for (const dz of [-.8, .8]) L.push(H.beamGeo(new V3(x0 - sx * 1.7, y + 1.05, RZ + dz), new V3(x0 - sx * 4.6, y + 1.05, RZ + dz), .035, 0xf2b81e, 4));
        L.push(H.beamGeo(new V3(x0 - 1.5, y - 5.5 < 0 ? 0 : y - 5.5, RZ - 2.2), new V3(x0 + 1.5, y, RZ - 2.2), .06, 0xd9a91e, 4), H.beamGeo(new V3(x0 + 1.5, y - 5.5 < 0 ? 0 : y - 5.5, RZ + 2.2), new V3(x0 - 1.5, y, RZ + 2.2), .06, 0xd9a91e, 4)); }
      site.boxes.push({x0: x0 - 1.7, x1: x0 + 1.7, y0: 0, y1: 26.6, z0: RZ - 2.4, z1: RZ + 2.4}); }
    addM(L); }
  // ---- parts on show: engines + structure down the west wall, tanks down the east wall (F adds the part to your rocket)
  { const shows = new THREE.Group(), L = [], labs = new THREE.Group(), atl = document.createElement('canvas'); atl.width = 2048; atl.height = 1024; const ax = atl.getContext('2d'), atT = new THREE.CanvasTexture(atl); atT.colorSpace = THREE.SRGBColorSpace; atT.anisotropy = 8; let na = 0;
    const labM = hm(0xffffff, .5, 0, {t: atT, e: 0xffffff, em: atT, ei: .55});
    const show = (k, x, z, side, extra = {}) => { const p = PARTS[k] || {}, r = extra.r || p.r || 1.25, pw = Math.max(2.4, r * 2 + 1.3), lift = extra.lift || 0;
      L.push(H.boxGeo(x, 0, z, pw, .5, pw, 0x2c3238), H.boxGeo(x, .5, z, pw + .08, .06, pw + .08, 0xe3b425));
      const pg = new THREE.Group(); pg.position.set(x, .56 + lift, z); shows.add(pg);
      const h = extra.h || p.h || 1; const it = {k: extra.as || k, p: PARTS[extra.as || k], d: extra.d || {}, i: extra.i || 0, r, y0: 0, y1: h};
      if (it.d.legs) it.hinge = Math.min(it.y1 - .3, it.y0 + .95); partMeshes(pg, it, 0, true); if (it.d.legs) for (const hh of pg.userData.legs || []) hh.rotation.z = .5; pg.userData.legs = null;
      site.boxes.push({x0: x - pw / 2, x1: x + pw / 2, y0: 0, y1: .56 + lift + h, z0: z - pw / 2, z1: z + pw / 2});
      // label on a post, facing into the hall
      const lx = x + side * (pw / 2 + .75), nm = extra.name || p.name, line = extra.stat || (typeof partStat === 'function' ? partStat(p) : ''), desc = extra.desc || p.desc || '';
      const ox = (na % 4) * 512, oy = (na / 4 | 0) * 256, ua = na++; ax.save(); ax.translate(ox, oy); ax.beginPath(); ax.rect(0, 0, 512, 256); ax.clip(); ((c, w, hh) => { c.fillStyle = '#0d1828'; c.fillRect(0, 0, w, hh); c.fillStyle = '#ffcf4a'; c.fillRect(0, 0, 10, hh); c.font = '600 58px Archivo, Arial'; c.fillText(nm, 34, 70); c.font = '400 28px Archivo, Arial'; c.fillStyle = '#cfe0f2'; c.fillText(desc.slice(0, 34), 34, 120); c.fillStyle = '#8fb3d6'; c.fillText(line.slice(0, 36), 34, 162);
        c.fillStyle = '#ffcf4a'; c.font = '600 28px Archivo, Arial'; c.fillText('F · ' + (extra.verb || 'add to your rocket'), 34, 222); })(ax, 512, 256); ax.restore();
      const pg2 = new THREE.PlaneGeometry(1.6, .8), uv = pg2.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (ox + uv.getX(i) * 512) / 2048, 1 - (oy + (1 - uv.getY(i)) * 256) / 1024);
      const pl = new THREE.Mesh(pg2, labM); pl.position.set(lx, 1.32, z); pl.rotation.set(0, side * Math.PI / 2, 0, 'YXZ'); pl.rotateX(-.45); labs.add(pl);
      L.push(H.boxGeo(lx - side * .12, 0, z, .08, 1.1, .08, 0x2c3238), H.boxGeo(lx - side * .12, 0, z, .5, .04, .5, 0x2c3238));
      WLD.acts.push({x: lx + side * .9, z, r: 1.8, t: () => 'F · ' + (extra.verb ? extra.verb[0].toUpperCase() + extra.verb.slice(1) : 'Add ' + nm + ' to your rocket') + ' (opens the builder)', fn: () => { if (typeof bldOpen !== 'function') return; bldOpen(); if (extra.radial) { const i = BLD.parts.map(q => (PARTS[q.k] || {}).cat).lastIndexOf('tank'); if (i >= 0) bldSelect(i); bldRadial(extra.radial); } else bldAdd(k); }});
    };
    const W = -18.7, E = 18.7;
    show('ant', W, -21.2, 1); show('swift', W, -16.3, 1); show('hopper', W, -11.2, 1); show('mule', W, -5.6, 1); show('titan', W, 1.2, 1); show('dec', W, 6.9, 1);
    show('fins', W, 11.8, 1, {as: 'tS', h: 1.25, lift: .55, d: {fins: 1}, name: 'Fins', desc: RADIAL.fins.desc, stat: (RADIAL.fins.dry / 1000).toFixed(2) + ' t · on the selected tank', radial: 'fins', verb: 'add fins to a tank'});
    show('legs', W, 17.4, 1, {as: 'tM', h: 2.5, lift: 2.1, d: {legs: 1}, name: 'Landing legs', desc: RADIAL.legs.desc, stat: (RADIAL.legs.dry / 1000).toFixed(2) + ' t · on the selected tank', radial: 'legs', verb: 'add legs to a tank'});
    show('hL', E, -15.2, -1); show('hM', E, -9.6, -1); show('tL', E, -4.6, -1, {i: 1}); show('tM', E, -.8, -1); show('tS', E, 3, -1, {i: 1}); show('sL', E, 6.4, -1); show('sS', E, 9.4, -1, {i: 1});
    addM(L); g.add(bakeByMat(shows, hgOf)); g.add(bakeByMat(labs)); atT.needsUpdate = true; }
  // ---- build console (front east): desk, three screens facing the door side
  { const L = [], cx = 14, cz = 17; L.push(H.boxGeo(cx, 0, cz, 6.4, .95, 1.3, 0x27313d), H.boxGeo(cx, .95, cz, 6.6, .06, 1.5, 0x15191e));
    for (let i = 0; i < 4; i++) L.push(H.boxGeo(cx - 2.4 + i * 1.6, .45, cz + 1.4, .55, .08, .55, 0x31363d), H.boxGeo(cx - 2.4 + i * 1.6, 0, cz + 1.4, .07, .45, .07, 0x8a9099), H.boxGeo(cx - 2.4 + i * 1.6, .5, cz + 1.68, .55, .62, .08, 0x31363d));
    addM(L); site.boxes.push({x0: cx - 3.3, x1: cx + 3.3, y0: 0, y1: 1.05, z0: cz - .75, z1: cz + .75});
    const scr = signTex(1024, 256, (c, w, h) => { c.fillStyle = '#061322'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(60,140,255,.25)'; c.lineWidth = 1; for (let i = 0; i < w; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); } for (let i = 0; i < h; i += 32) { c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
      c.fillStyle = '#ffcf4a'; c.font = '600 64px Archivo, Arial'; c.fillText('ROCKET BUILDER', 360, 110); c.fillStyle = '#9fd0ff'; c.font = '30px Archivo, Arial'; c.fillText('Walk up and press F  ·  or press B anywhere', 362, 165);
      c.strokeStyle = '#3aa0ff'; c.lineWidth = 4; const bx = 120; c.strokeRect(bx, 40, 70, 40); for (let i = 0; i < 3; i++) c.strokeRect(bx - 10, 85 + i * 42, 90, 38); c.beginPath(); c.moveTo(bx + 10, 212); c.lineTo(bx + 60, 212); c.lineTo(bx + 75, 240); c.lineTo(bx - 5, 240); c.closePath(); c.stroke(); });
    const sm = hm(0x000000, .3, .2, {e: 0xffffff, em: scr, ei: 1.3}), bez = hm(0x0c0e12, .4, .3);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), sm); s.position.set(cx, 1.9, cz - .36); s.rotation.x = -.18; g.add(s);
    const b = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.55, .08), bez); b.position.set(cx, 1.9, cz - .42); b.rotation.x = -.18; g.add(b);
    WLD.acts.push({x: cx, z: cz + 1.6, r: 2.6, t: 'F · Open the rocket builder', fn: () => { if (typeof bldOpen === 'function') bldOpen(); }}); }
  // ---- mezzanine office (back east): stair, balcony, glass office with a lit planning room, storage under it
  { const L = [], D = 7, mx0 = 10, mx1 = X1, mz0 = Z0, mz1 = -19;
    box((mx0 + mx1) / 2, D - .35, (mz0 + mz1) / 2, mx1 - mx0, .35, mz1 - mz0, 0, true, {m: hm(0x6d7680, .6, .3, {t: tex('plate', 'c'), tile: 2})});
    for (const x of [10.4, 16, 21.8]) L.push(H.boxGeo(x, 0, mz1 + .35, .35, D - .35, .35, 0x56606b));
    // stair up from the hall (north along x 10.8), 20 steps
    for (let i = 0; i < 20; i++) { const y = (i + 1) * D / 20, z = -8.6 - i * .52; box(10.8, y - .12, z, 1.6, .12, .55, 0, true, {m: hm(0x8c959f, .5, .5)}); }
    L.push(H.beamGeo(new V3(9.95, 1.1, -8.4), new V3(9.95, D + 1.05, -19), .035, 0xf2b81e), H.beamGeo(new V3(11.65, 1.1, -8.4), new V3(11.65, D + 1.05, -19), .035, 0xf2b81e));
    L.push(H.beamGeo(new V3(9.95, 0, -8.4), new V3(9.95, 1.1, -8.4), .035, 0xf2b81e), H.beamGeo(new V3(11.65, 0, -8.4), new V3(11.65, 1.1, -8.4), .035, 0xf2b81e));
    site.boxes.push({x0: 9.9, x1: 10, y0: 0, y1: D + 1.1, z0: -19, z1: -8.4}, {x0: 11.6, x1: 11.7, y0: 0, y1: D + 1.1, z0: -19, z1: -8.4});
    // balcony rails
    L.push(H.beamGeo(new V3(11.7, D + 1.05, mz1), new V3(mx1, D + 1.05, mz1), .04, 0xf2b81e), H.beamGeo(new V3(mx0, D + 1.05, mz0), new V3(mx0, D + 1.05, mz1), .04, 0xf2b81e));
    for (let x = 12; x < mx1; x += 1.4) L.push(H.beamGeo(new V3(x, D, mz1), new V3(x, D + 1.05, mz1), .025, 0xf2b81e, 4)); for (let z = mz0 + .6; z < mz1; z += 1.4) L.push(H.beamGeo(new V3(mx0, D, z), new V3(mx0, D + 1.05, z), .025, 0xf2b81e, 4));
    site.boxes.push({x0: 11.7, x1: mx1, y0: D, y1: D + 1.1, z0: mz1 - .05, z1: mz1 + .05}, {x0: mx0 - .05, x1: mx0 + .05, y0: D, y1: D + 1.1, z0: mz0, z1: mz1});
    // the office: glass front + side, lit back wall painted with desks and a whiteboard
    const ox0 = 14.6, oz1 = -20.4, oh = 3.4; L.push(H.boxGeo((ox0 + mx1) / 2, D + oh, (mz0 + oz1) / 2, mx1 - ox0 + .2, .25, oz1 - mz0 + .2, 0x3c4450));
    for (let x = ox0; x <= mx1; x += 2.6) L.push(H.boxGeo(x, D, oz1, .12, oh, .12, 0x2b313a)); for (let z = mz0; z <= oz1; z += 2.5) L.push(H.boxGeo(ox0, D, z, .12, oh, .12, 0x2b313a));
    const gl = new THREE.MeshStandardMaterial({color: 0x9ab8d0, roughness: .05, metalness: .3, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide});
    for (const [x, z, w, d] of [[(ox0 + mx1) / 2, oz1, mx1 - ox0, .05], [ox0, (mz0 + oz1) / 2, .05, oz1 - mz0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, oh, d), gl); m.position.set(x, D + oh / 2, z); m.renderOrder = 3; g.add(m); site.boxes.push({x0: x - w / 2 - .05, x1: x + w / 2 + .05, y0: D, y1: D + oh, z0: z - d / 2 - .05, z1: z + d / 2 + .05}); }
    const ot = signTex(1024, 384, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e9e2d2'); gr.addColorStop(1, '#bfb6a4'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fbfbf8'; c.fillRect(80, 50, 420, 190); c.strokeStyle = '#555'; c.lineWidth = 6; c.strokeRect(80, 50, 420, 190); c.strokeStyle = '#2a6fd6'; c.lineWidth = 4; c.beginPath(); c.moveTo(140, 220); c.quadraticCurveTo(260, 40, 440, 90); c.stroke();
      c.fillStyle = '#d33'; c.font = '600 30px Archivo, Arial'; c.fillText('Δv = Isp·g·ln(m0/m1)', 120, 120); c.fillStyle = '#222'; c.font = '24px Archivo, Arial'; c.fillText('TLI window: T+?', 120, 160); c.fillText('more boosters??', 300, 205);
      for (let i = 0; i < 7; i++) { c.fillStyle = ['#f6e27a', '#9fd3ff', '#ffb3c1'][i % 3]; c.fillRect(560 + (i % 4) * 70, 60 + (i / 4 | 0) * 80, 56, 56); }
      c.fillStyle = '#16233a'; c.fillRect(0, h - 120, w, 120); c.fillStyle = '#2e3a4b'; for (let i = 0; i < 4; i++) { c.fillRect(60 + i * 240, h - 170, 180, 60); c.fillStyle = '#7fc1ff'; c.fillRect(80 + i * 240, h - 210, 90, 55); c.fillStyle = '#2e3a4b'; } });
    const ob = new THREE.Mesh(new THREE.PlaneGeometry(mx1 - ox0 - .2, oh), new THREE.MeshBasicMaterial({map: ot, color: new THREE.Color(1.3, 1.25, 1.15)})); ob.position.set((ox0 + mx1) / 2, D + oh / 2, mz0 + .25); g.add(ob);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(mx1 - ox0, oz1 - mz0), new THREE.MeshBasicMaterial({color: new THREE.Color(.42, .4, .36)})); fl.rotation.x = -Math.PI / 2; fl.position.set((ox0 + mx1) / 2, D + .01, (mz0 + oz1) / 2); g.add(fl);
    const sd = new THREE.Mesh(new THREE.PlaneGeometry(oz1 - mz0, oh), new THREE.MeshBasicMaterial({color: new THREE.Color(.75, .72, .66)})); sd.rotation.y = -Math.PI / 2; sd.position.set(mx1 - .3, D + oh / 2, (mz0 + oz1) / 2); g.add(sd);
    // storage racks under the deck
    for (let i = 0; i < 2; i++) { const z = -24.2 + i * 3.2; for (let y = 0; y <= 4.5; y += 1.5) L.push(H.boxGeo(16.5, y, z, 10, .12, 1.4, 0x3a6ea5)); for (const x of [11.6, 16.5, 21.4]) for (const dz of [-.65, .65]) L.push(H.boxGeo(x, 0, z + dz, .1, 4.6, .1, 0xff8a2a));
      for (let k = 0; k < 9; k++) { const y = 1.5 * (k % 3) + .12, x = 12.6 + (k * 3.1) % 8.6; L.push(H.boxGeo(x, y, z, 1.3, .7 + (k % 2) * .5, 1.1, [0xc9a46a, 0xd8d8d8, 0x6d8f5a, 0xb4573e][(i + k) % 4])); } }
    site.boxes.push({x0: 11.4, x1: X1, y0: 0, y1: 4.7, z0: -25.2, z1: -20.3});
    addM(L);
    // banners hanging above the office
    [['#ffcf4a', '#16233a'], ['#16233a', '#ffcf4a'], ['#e8572e', '#ffffff']].forEach(([bg, fg], i) => { const t = signTex(256, 1024, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.fillRect(0, h - 40, w, 14);
        c.save(); c.translate(w / 2, h / 2 - 40); c.rotate(-Math.PI / 2); c.font = '700 150px Archivo, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(['YESHIP', 'TO THE MOON', 'AND BACK'][i], 0, 0); c.restore();
        c.beginPath(); c.moveTo(w / 2, 40); c.lineTo(w / 2 + 34, 120); c.lineTo(w / 2 - 34, 120); c.fill(); });
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 10.4), hm(0xffffff, .9, 0, {t, ds: true})); b.position.set(12.8 + i * 3.4, 20.5, Z0 + .3); g.add(b); }); }
  // ---- workshop corner (front west): benches, tool chests, gas bottles, a forklift, pallets
  { const L = [], cy = (x, y, z, r, h, c, s = 12) => L.push(H.beamGeo(new V3(x, y, z), new V3(x, y + h, z), r, c, s));
    for (const z of [17.5, 21.5]) { L.push(H.boxGeo(-15.2, .9, z, 1.1, .08, 3.2, 0x8a6a46)); for (const dz of [-1.4, 1.4]) for (const dx of [-.45, .45]) L.push(H.boxGeo(-15.2 + dx, 0, z + dz, .07, .9, .07, 0x3b4148)); L.push(H.boxGeo(-15.2, .25, z, 1, .05, 3, 0x3b4148), H.boxGeo(-15.75, .98, z, .08, 1.3, 3.2, 0x4d5b6b));
      L.push(H.boxGeo(-15.0, .98, z - .6, .5, .35, .4, 0x222222), H.boxGeo(-15.1, .98, z + .7, .3, .12, .6, 0xc23b2b)); site.boxes.push({x0: -15.8, x1: -14.6, y0: 0, y1: 1, z0: z - 1.6, z1: z + 1.6}); }
    for (const [x, z, c] of [[-12.4, 23.8, 0xc23b2b], [-11.2, 23.8, 0xc23b2b], [-9.6, 23.8, 0x2a5ea8]]) { L.push(H.boxGeo(x, .1, z, 1, 1.05, .6, c)); for (let k = 0; k < 4; k++) L.push(H.boxGeo(x, .3 + k * .22, z - .31, .8, .02, .02, 0xcfd3d8)); site.boxes.push({x0: x - .5, x1: x + .5, y0: 0, y1: 1.2, z0: z - .3, z1: z + .3}); }
    for (let i = 0; i < 5; i++) cy(-7.8 + i * .32, 0, 24.6, .12, 1.5, [0x2e6b3a, 0x2e6b3a, 0x8c8c8c, 0x1f3b73, 0x2e6b3a][i]);
    // forklift
    { const fx = -8.6, fz = 18.6; L.push(H.boxGeo(fx, .35, fz, 1.2, .9, 2.2, 0xf2b81e), H.boxGeo(fx, 1.25, fz + .5, 1.15, .35, 1, 0x2b2b2b), H.boxGeo(fx, 1.25, fz - .1, .5, .6, .4, 0x333));
      for (const dx of [-.55, .55]) { L.push(H.beamGeo(new V3(fx + dx, 1.2, fz - .5), new V3(fx + dx, 2.3, fz - .5), .03, 0x222), H.beamGeo(new V3(fx + dx, 1.2, fz + 1), new V3(fx + dx, 2.3, fz + 1), .03, 0x222), H.beamGeo(new V3(fx + dx * .7, 0, fz - 1.2), new V3(fx + dx * .7, 2.9, fz - 1.2), .05, 0x333));
        L.push(H.boxGeo(fx + dx * .5, .08, fz - 1.95, .12, .06, 1.3, 0x555)); } L.push(H.boxGeo(fx, 2.3, fz + .25, 1.2, .06, 1.6, 0x222));
      for (const dx of [-.6, .6]) for (const dz of [-.7, .7]) L.push(H.beamGeo(new V3(fx + dx - .1, .32, fz + dz), new V3(fx + dx + .1, .32, fz + dz), .32, 0x161616, 12)); site.boxes.push({x0: fx - .7, x1: fx + .7, y0: 0, y1: 2.3, z0: fz - 2.6, z1: fz + 1.2}); }
    for (const [x, z] of [[-11.5, 13.6], [-9.8, 13.6], [-11.5, 11.9]]) { L.push(H.boxGeo(x, 0, z, 1.2, .14, 1.2, 0x9b7a4e)); L.push(H.boxGeo(x, .14, z, 1.1, .8 + ((x * 7 + z) % 3 + 3) % 3 * .25, 1.1, 0xb48a55)); site.boxes.push({x0: x - .6, x1: x + .6, y0: 0, y1: 1.3, z0: z - .6, z1: z + .6}); }
    addM(L); }
  // ---- wall signs: inside logo over the door, safety signs, the explosion counter, the status board
  { const lg = H.decal(signTex(1024, 256, (x, w, h) => H.logo(x, w, h, 'VEHICLE ASSEMBLY')), 0, 30.4, Z1 - .25, 16, 4, Math.PI); lg.material = hm(0xffffff, .6, 0, {t: lg.material.map});
    const sign = (txt, sub, col, x, y, z, ry) => { const t = signTex(256, 320, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.fillRect(0, 0, w, 110); c.fillStyle = '#fff'; c.font = '700 54px Archivo, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, 58);
        c.fillStyle = '#111'; c.font = '600 34px Archivo, Arial'; sub.split('|').forEach((s, i) => c.fillText(s, w / 2, 170 + i * 44)); }); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), hm(0xffffff, .6, 0, {t})); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); };
    sign('NOTICE', 'HARD HATS|PAST THIS|POINT', '#1f5fbf', -17.5, 4.6, Z1 - .27, Math.PI); sign('DANGER', 'FUEL TANKS|NO SMOKING|NO SPARKS', '#c62828', X1 - .27, 4.6, -12.4, -Math.PI / 2); sign('CAUTION', 'OVERHEAD|CRANE', '#e0a800', X0 + .27, 4.6, 4.3, Math.PI / 2);
    // "days since the last explosion" board (resets when a rocket blows up)
    const bc = document.createElement('canvas'); bc.width = 512; bc.height = 288; const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
    WLD.boomDraw = () => { const c = bc.getContext('2d'), w = 512, h = 288; c.fillStyle = '#f4f2ea'; c.fillRect(0, 0, w, h); c.fillStyle = '#16233a'; c.fillRect(0, 0, w, 74); c.fillStyle = '#ffcf4a'; c.font = '700 40px Archivo, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('DAYS SINCE THE LAST', w / 2, 40);
      let t0 = 0; try { t0 = +localStorage.getItem('ye-boom') || 0; } catch (e) {} const d = t0 ? Math.floor((Date.now() - t0) / 864e5) : 0;
      c.fillStyle = '#111'; c.fillRect(156, 92, 200, 130); c.fillStyle = '#ff5a3a'; c.font = '700 110px Archivo, Arial'; c.fillText(String(Math.min(d, 999)), w / 2, 160); c.fillStyle = '#16233a'; c.font = '700 40px Archivo, Arial'; c.fillText('EXPLOSION', w / 2, 256); bt.needsUpdate = true; };
    WLD.boomDraw(); const bm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), hm(0xffffff, .55, 0, {t: bt})); bm.position.set(X0 + .27, 5.4, 15.6); bm.rotation.y = Math.PI / 2; g.add(bm);
    // status board on the back wall: the rocket on the stand, its stages and what it can reach
    const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 576; const stt = new THREE.CanvasTexture(sc); stt.colorSpace = THREE.SRGBColorSpace; stt.anisotropy = 8; WLD.board = {c: sc, t: stt};
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 7.65), hm(0x000000, .35, .1, {e: 0xffffff, em: stt, ei: 1.15})); sm.position.set(-11.2, 13.2, Z0 + .32); g.add(sm);
    const bz = new THREE.Mesh(new THREE.BoxGeometry(14.1, 8.15, .2), hm(0x101318, .4, .4)); bz.position.set(-11.2, 13.2, Z0 + .2); g.add(bz); }
}
function boardDraw() {
  const B = WLD.board; if (!B) return; const c = B.c.getContext('2d'), w = 1024, h = 576, st = shipLayout(SHIP.parts), s = typeof shipStats === 'function' ? shipStats(st) : null;
  const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b1730'); gr.addColorStop(1, '#0a1220'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(80,150,255,.12)'; c.lineWidth = 1; for (let i = 0; i < w; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); } for (let i = 0; i < h; i += 32) { c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
  c.fillStyle = '#7fa6cc'; c.font = '500 24px Archivo, Arial'; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillText('VEHICLE ASSEMBLY · BAY 1 · ON THE STAND', 300, 46);
  c.fillStyle = '#ffcf4a'; c.font = '600 60px Archivo, Arial'; c.fillText(SHIP.name.slice(0, 22), 300, 108);
  // side view of the stack
  const y0 = st[0].y0, hh = 26.1 - y0, maxR = Math.max(2.5, ...st.map(S => S.r || 0)), k = Math.min(500 / hh, 220 / (maxR * 2)), cx = 150, by = 540, Y = y => by - (y - y0) * k;
  for (const S of st) { if (S.cap) { c.fillStyle = '#cfd3d8'; c.beginPath(); c.moveTo(cx - 2.5 * k, Y(21.6)); c.lineTo(cx + 2.5 * k, Y(21.6)); c.lineTo(cx + 1 * k, Y(25.45)); c.lineTo(cx - 1 * k, Y(25.45)); c.fill(); c.fillRect(cx - .78 * k, Y(26.1), 1.56 * k, Y(25.45) - Y(26.1)); continue; }
    for (const it of S.parts) { if (it.k === 'adapt') { c.fillStyle = '#e8e6e0'; c.beginPath(); c.moveTo(cx - it.rB * k, Y(it.y0)); c.lineTo(cx + it.rB * k, Y(it.y0)); c.lineTo(cx + it.rT * k, Y(it.y1)); c.lineTo(cx - it.rT * k, Y(it.y1)); c.fill(); continue; }
      if (it.k === 'dec') { c.fillStyle = it.inter ? '#2a2d33' : '#c9a33a'; c.fillRect(cx - it.r * k, Y(it.y1), it.r * 2 * k, Math.max(2, (it.y1 - it.y0) * k)); continue; }
      const p = it.p; if (p.cat === 'tank') { c.fillStyle = '#efeee9'; c.fillRect(cx - it.r * k, Y(it.y1), it.r * 2 * k, (it.y1 - it.y0) * k); c.fillStyle = '#17191d'; c.fillRect(cx - it.r * k, Y(it.y1), it.r * k, Math.min(6, (it.y1 - it.y0) * k * .2)); }
      if (p.cat === 'engine') { const yb = it.y0 + p.bl; c.fillStyle = '#8c929a'; c.beginPath(); c.moveTo(cx - p.rT * k, Y(yb)); c.lineTo(cx + p.rT * k, Y(yb)); c.lineTo(cx + p.rE * k, Y(it.y0)); c.lineTo(cx - p.rE * k, Y(it.y0)); c.fill(); c.fillStyle = '#5d636b'; c.fillRect(cx - it.r * k * .8, Y(it.y1), it.r * 1.6 * k, (it.y1 - yb) * k); }
      if (it.d && it.d.fins) { c.fillStyle = '#17191d'; for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(cx + sx * it.r * k, Y(it.y0 + 2.9)); c.lineTo(cx + sx * (it.r + 1.3) * k, Y(it.y0 - .5)); c.lineTo(cx + sx * it.r * k, Y(it.y0)); c.fill(); } }
      if (it.d && it.d.legs) { c.strokeStyle = '#8a9099'; c.lineWidth = 3; for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(cx + sx * it.r * k, Y(it.hinge)); c.lineTo(cx + sx * (it.r + .2) * k, Y(it.hinge - 3.2)); c.stroke(); } } } }
  // stages, numbers, what it can reach
  c.font = '500 26px Archivo, Arial'; let y = 160; if (s) { for (const r of s.rows.slice().reverse()) { c.fillStyle = '#9fc6ea'; c.fillText(r.S.name, 300, y); c.fillStyle = '#ffffff'; c.textAlign = 'right'; c.fillText(Math.round(r.dv).toLocaleString() + ' m/s', 700, y); c.fillStyle = r.twr >= 1.15 ? '#7ce38b' : r.i === 0 ? '#ff8a6a' : '#cfd8e2'; c.fillText(r.twr ? 'TWR ' + r.twr.toFixed(2) : '—', 900, y); c.textAlign = 'left'; y += 38; }
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(300, y - 22); c.lineTo(960, y - 22); c.stroke(); y += 12; c.fillStyle = '#ffcf4a'; c.font = '600 30px Archivo, Arial'; c.fillText('Δv ' + Math.round(s.tot).toLocaleString() + ' m/s', 300, y);
    c.fillStyle = '#cfd8e2'; c.font = '500 26px Archivo, Arial'; c.fillText((s.mass / 1000).toFixed(1) + ' t · ' + s.h.toFixed(1) + ' m tall', 620, y); y += 52;
    let x = 300; c.font = '500 22px Archivo, Arial'; for (const [nm, dv] of (typeof DV_NEED !== 'undefined' ? DV_NEED : [])) { const ok = s.tot >= dv, tw = c.measureText(nm).width + 50; if (x + tw > 990) { x = 300; y += 46; }
      c.fillStyle = ok ? 'rgba(60,190,100,.25)' : 'rgba(255,255,255,.07)'; c.fillRect(x, y - 28, tw, 38); c.fillStyle = ok ? '#7ce38b' : '#8494a8'; c.fillText((ok ? '✓ ' : '· ') + nm, x + 12, y - 2); x += tw + 10; } }
  c.fillStyle = '#6f87a3'; c.font = '400 22px Archivo, Arial'; c.fillText('Change it at the build console (F) or with B · F at the stand to fly it', 300, 548); B.t.needsUpdate = true;
}
// your current design standing on the assembly stand (rebuilt when the design changes)
function hangarRocket() {
  if (!site.g) return; if (WLD.rk) { WLD.rk.parent.remove(WLD.rk); WLD.rk.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const m = rocketModel(SHIP.parts), s = Math.min(1, 26.6 / m.h), b = bakeByMat(m.g, hgOf); b.scale.setScalar(s); b.position.set(0, 1.2, WLD.rz); (WLD.gIn || site.g).add(b); WLD.rk = b; boardDraw();
}

// ---------------- the grounds
function grounds() {
  const H = site.H, g = site.g, {box, signTex} = H, gy = H.groundY;
  const asph = {t: 'asphalt', tile: 8}, road = (x, z, w, d) => box(x, -1, z, w, 1.07, d, 0xffffff, false, asph);
  const L = [], white = 0xe8e6df;
  // roads: apron -> west -> Yeville; the town grid
  road(-385, 100, 560, 10); road(-650, -400, 10, 1010); for (const z of [-450, -600, -750]) road(-660, z, 520, 10);
  for (let x = -655; x < -115; x += 12) L.push(H.boxGeo(x, .08, 100, 5, .02, .25, white)); for (let z = 95; z > -905; z -= 12) L.push(H.boxGeo(-650, .08, z, .25, .02, 5, white));
  for (const z of [-450, -600, -750]) for (let x = -915; x < -400; x += 12) if (Math.abs(x + 650) > 8) L.push(H.boxGeo(x, .08, z, 5, .02, .25, white));
  // parking lot west of the hangar
  box(-61, -1, 2, 38, 1.07, 60, 0xffffff, false, asph); for (let i = 0; i <= 12; i++) for (const x of [-72, -50]) L.push(H.boxGeo(x, .08, -24 + i * 4.4, 5.6, .02, .14, white));
  // street lights
  const poles = []; for (let x = -620; x < -120; x += 45) poles.push([x, 107]); for (let z = 60; z > -880; z -= 45) poles.push([-657, z]); for (const z of [-450, -600, -750]) for (let x = -890; x < -420; x += 50) poles.push([x, z - 7]);
  for (const [x, z] of poles) L.push(H.beamGeo(new V3(x, 0, z), new V3(x, 8, z), .1, 0x8d949b, 6), H.boxGeo(x, 7.9, z, .9, .2, .5, 0x4a5058));
  // rocket garden: a lawn with the preset rockets on plinths
  { const gx = 70, gz = 92; const gt = tex('grass', 'c'), lawn = new THREE.Mesh(new THREE.CircleGeometry(21, 48), new THREE.MeshStandardMaterial({map: gt, roughness: .95})); lawn.rotation.x = -Math.PI / 2; lawn.position.set(gx, .09, gz); lawn.receiveShadow = true;
    const pa = lawn.geometry.attributes.position, uv = lawn.geometry.attributes.uv; for (let i = 0; i < pa.count; i++) uv.setXY(i, pa.getX(i) / 3, pa.getY(i) / 3); g.add(lawn);
    L.push(H.beamGeo(new V3(gx, 0, gz), new V3(gx, .12, gz), 21.4, 0xbdbab2, 48));
    const show = new THREE.Group(); [['Hopper', -12, 6], ['Lander', 0, -6], ['Heavy', 12, 6]].forEach(([nm, dx, dz]) => { const m = rocketModel(SHIP_PRESETS[nm], PAINT0); m.g.position.set(gx + dx, 1.6, gz + dz); show.add(m.g);
      L.push(H.boxGeo(gx + dx, 0, gz + dz, 7, 1.6, 7, 0x8e939a), H.boxGeo(gx + dx, 1.55, gz + dz, 7.3, .1, 7.3, 0xcfd3d8)); site.boxes.push({x0: gx + dx - 3.5, x1: gx + dx + 3.5, y0: 0, y1: 1.6, z0: gz + dz - 3.5, z1: gz + dz + 3.5});
      const t = signTex(512, 160, (c, w, h) => { c.fillStyle = '#16233a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffcf4a'; c.font = '600 64px Archivo, Arial'; c.textAlign = 'center'; c.fillText(nm, w / 2, 76); c.fillStyle = '#9fb6cc'; c.font = '28px Archivo, Arial'; c.fillText(Math.round(m.h) + ' m · ' + (m.st.length - 1) + ' stage' + (m.st.length > 2 ? 's' : ''), w / 2, 126); });
      H.decal(t, gx + dx, .8, gz + dz + 3.53, 2.6, .8); });
    g.add(bakeByMat(show)); H.decal(signTex(1024, 256, (x, w, h) => H.logo(x, w, h, 'ROCKET GARDEN')), gx, 1.4, gz + 21.7, 5.6, 1.4); L.push(H.boxGeo(gx, 0, gz + 21.5, 6, .7, .3, 0x2a3442)); }
  // tracking station: radome + dish
  { const tx = 170, tz = -210; L.push(H.boxGeo(tx, 0, tz, 9, 9, 9, 0xd9dcdf), H.boxGeo(tx, 9, tz, 10, .5, 10, 0x8a9198)); const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 3), new THREE.MeshStandardMaterial({color: 0xf6f6f2, roughness: .5})); dome.position.set(tx, 14.6, tz); dome.castShadow = dome.receiveShadow = true; g.add(dome);
    site.boxes.push({x0: tx - 4.5, x1: tx + 4.5, y0: 0, y1: 9, z0: tz - 4.5, z1: tz + 4.5});
    const dx = tx + 26; L.push(H.beamGeo(new V3(dx, 0, tz), new V3(dx, 9, tz), .8, 0xcfd6de, 10)); const dish = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 12, 0, 6.283, 0, .9), new THREE.MeshStandardMaterial({color: 0xf4f6f8, roughness: .35, metalness: .2, side: THREE.DoubleSide}));
    dish.position.set(dx, 15, tz); dish.rotation.set(-.7, .4, 0); dish.castShadow = true; g.add(dish); }
  // runway control tower
  { const cx = -260, cz = 282; L.push(H.boxGeo(cx, 0, cz, 4, 24, 4, 0xd8d6cf), H.boxGeo(cx, 24, cz, 8, .6, 8, 0x3c4450), H.boxGeo(cx, 28.2, cz, 8.4, .6, 8.4, 0x3c4450), H.beamGeo(new V3(cx, 28.8, cz), new V3(cx, 33, cz), .08, 0xdddddd, 6));
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4, 3.6, 3.6, 8), H.glass); cab.position.set(cx, 26.4, cz); g.add(cab); L.push(H.boxGeo(cx + 6, 0, cz, 8, 4, 6, 0xd8d6cf)); site.boxes.push({x0: cx - 2, x1: cx + 10, y0: 0, y1: 4, z0: cz - 3, z1: cz + 3}); }
  // fuel farm between the pads
  { const fx = 345, fz = -15; for (let i = 0; i < 4; i++) { const z = fz - 12 + i * 8; const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 16, 24), WLD.tankM || (WLD.tankM = new THREE.MeshStandardMaterial({color: 0xf4f6f8, roughness: .4, metalness: .2}))); t.rotation.z = Math.PI / 2; t.position.set(fx, 3.4, z); t.castShadow = t.receiveShadow = true; g.add(t);
      for (const dx of [-5, 5]) L.push(H.boxGeo(fx + dx, 0, z, .8, 1.4, 3.6, 0x8e939a)); L.push(H.beamGeo(new V3(fx - 8, 3.4, z), new V3(fx - 14, 3.4, z), .25, 0x9aa4ae, 8)); }
    L.push(H.beamGeo(new V3(fx - 14, 3.4, fz - 12), new V3(fx - 14, 3.4, fz + 12), .4, 0x9aa4ae, 8)); site.boxes.push({x0: fx - 8, x1: fx + 8, y0: 0, y1: 6, z0: fz - 15, z1: fz + 15}); }
  H.addMerged(L);
  // lamp heads that glow at night
  const lampM = new THREE.MeshStandardMaterial({color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0}); WLD.lampM = lampM;
  const lh = new THREE.InstancedMesh(new THREE.BoxGeometry(.7, .1, .4), lampM, poles.length), M4 = new THREE.Matrix4(); poles.forEach(([x, z], i) => lh.setMatrixAt(i, M4.makeTranslation(x, 7.85, z))); lh.userData.tile = [800, 3000]; g.add(lh);
  // signs
  H.decal(signTex(1024, 256, (c, w, h) => { c.fillStyle = '#1f6b3a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 10; c.strokeRect(14, 14, w - 28, h - 28); c.fillStyle = '#fff'; c.font = '600 110px Archivo, Arial'; c.textAlign = 'center'; c.fillText('YEVILLE', w / 2, 140); c.font = '44px Archivo, Arial'; c.fillText('pop. 1,204 · Home of YeShip', w / 2, 210); }), -641, 3, 30, 6, 1.5, Math.PI / 2);
  box(-641.2, 0, 30, .3, 2.2, .3, 0x666666, false);
}
// ---------------- Yeville: houses, apartment blocks, a water tower, parked cars
function town() {
  const H = site.H, g = site.g, gy = H.groundY, r = (() => { let s = 99; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; })();
  const lots = [], roadsX = [-650], roadsZ = [-450, -600, -750, 100];
  const nearRoad = (x, z, m) => roadsX.some(rx => Math.abs(x - rx) < m && z < 105 && z > -910) || roadsZ.some(rz => Math.abs(z - rz) < m && (rz === 100 ? x > -660 && x < -100 : x > -925 && x < -395));
  const plaza = (x, z) => Math.abs(x + 650) < 70 && Math.abs(z + 600) < 70;
  for (let z = 40; z > -890; z -= 21) for (const s of [-1, 1]) lots.push([-650 + s * 17, z, s > 0 ? -Math.PI / 2 : Math.PI / 2]);
  for (const zc of [-450, -600, -750]) for (let x = -905; x < -400; x += 21) for (const s of [-1, 1]) lots.push([x, zc + s * 17, s > 0 ? Math.PI : 0]);
  const keep = lots.filter(([x, z]) => !plaza(x, z) && !nearRoad(x, z, 12) && r() > .12);
  // house texture: wall + windows (emissive map lights some windows at night)
  const ht = H.signTex(256, 256, (c, w, h) => { c.fillStyle = '#f2efe8'; c.fillRect(0, 0, w, h); for (const [x, y] of [[40, 60], [150, 60], [40, 150], [150, 150]]) { c.fillStyle = '#ffffff'; c.fillRect(x - 6, y - 6, 74, 74); c.fillStyle = '#34414f'; c.fillRect(x, y, 62, 62); c.fillStyle = '#ffffff'; c.fillRect(x + 29, y, 4, 62); c.fillRect(x, y + 29, 62, 4); } });
  const he = H.signTex(256, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); for (const [x, y, on] of [[40, 60, 1], [150, 60, 0], [40, 150, 1], [150, 150, 1]]) if (on) { c.fillStyle = '#ffb860'; c.fillRect(x, y, 62, 62); } });
  const hm2 = new THREE.MeshStandardMaterial({map: ht, emissiveMap: he, emissive: 0xffffff, emissiveIntensity: 0, roughness: .85}); WLD.winM = [hm2];
  const roofGeo = (() => { const p = [-.5, 0, -.5, .5, 0, -.5, .5, 1, 0, -.5, 0, -.5, .5, 1, 0, -.5, 1, 0, -.5, 0, .5, -.5, 1, 0, .5, 1, 0, -.5, 0, .5, .5, 1, 0, .5, 0, .5, -.5, 0, -.5, -.5, 1, 0, -.5, 0, .5, .5, 0, -.5, .5, 0, .5, .5, 1, 0];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.computeVertexNormals(); return geo; })();
  const body = new THREE.BoxGeometry(1, 1, 1); body.translate(0, .5, 0);
  const n = keep.length, bodies = new THREE.InstancedMesh(body, hm2, n), roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({roughness: .8, side: THREE.DoubleSide}), n);
  const M4 = new THREE.Matrix4(), q = new Q4(), s = new V3(), p = new V3(), col = new THREE.Color(), Y = new V3(0, 1, 0);
  keep.forEach(([x, z, a], i) => { const w = 8 + r() * 4, d = 7 + r() * 3, h = r() < .35 ? 6 : 3.4, y = gy(x, z); q.setFromAxisAngle(Y, a + (r() - .5) * .06);
    bodies.setMatrixAt(i, M4.compose(p.set(x, y - .2, z), q, s.set(w, h + .2, d))); bodies.setColorAt(i, col.setHSL([.08, .1, .55, .13, .0, .6][i % 6], .25 + r() * .2, .78 + r() * .12));
    roofs.setMatrixAt(i, M4.compose(p.set(x, y + h, z), q, s.set(w + .8, 1.8 + r() * 1.2, d + .8))); roofs.setColorAt(i, col.setHSL([.02, .05, .6, .0][i % 4], .35 + r() * .2, .22 + r() * .14)); });
  for (const m of [bodies, roofs]) { m.castShadow = m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); g.add(m); }
  // apartment blocks round the plaza
  const at = H.signTex(256, 512, (c, w, h) => { c.fillStyle = '#d9d4ca'; c.fillRect(0, 0, w, h); for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) { c.fillStyle = '#2f3b48'; c.fillRect(14 + i * 62, 14 + j * 62, 44, 40); } c.fillStyle = 'rgba(0,0,0,.1)'; for (let j = 0; j < 8; j++) c.fillRect(0, j * 64 + 60, w, 4); });
  const ae = H.signTex(256, 512, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) if (((i * 7 + j * 3) % 5) < 3) { c.fillStyle = (i + j) % 3 ? '#ffc070' : '#d8e8ff'; c.fillRect(14 + i * 62, 14 + j * 62, 44, 40); } });
  const am = new THREE.MeshStandardMaterial({map: at, emissiveMap: ae, emissive: 0xffffff, emissiveIntensity: 0, roughness: .8}); WLD.winM.push(am);
  const blocks = [[-605, -555], [-695, -555], [-605, -645], [-695, -645], [-605, -500], [-700, -700]], ab = new THREE.InstancedMesh(body, am, blocks.length);
  blocks.forEach(([x, z], i) => ab.setMatrixAt(i, M4.compose(p.set(x, gy(x, z) - .2, z), q.identity(), s.set(22, 16 + (i * 7) % 4 * 5, 22)))); ab.castShadow = ab.receiveShadow = true; ab.computeBoundingSphere(); g.add(ab);
  // plaza + water tower
  const L = []; L.push(H.boxGeo(-650, -.9, -600, 54, 1, 54, 0x7d7870)); const wx = -760, wz = -690; for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L.push(H.beamGeo(new V3(wx + dx * 4, 0, wz + dz * 4), new V3(wx + dx * 2.5, 26, wz + dz * 2.5), .3, 0x9aa4ae));
  H.addMerged(L); const wt = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshStandardMaterial({color: 0x6fa8dc, roughness: .5, metalness: .2})); wt.position.set(wx, 31, wz); wt.castShadow = true; g.add(wt);
  H.decal(H.signTex(512, 128, (c, w, h) => { c.fillStyle = '#6fa8dc'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '700 84px Archivo, Arial'; c.textAlign = 'center'; c.fillText('YEVILLE', w / 2, 96); }), wx, 31, wz + 6.05, 8, 2);
  // parked cars: the staff car park + along the streets
  const carGeo = (() => { const parts = [H.boxGeo(0, .3, 0, 1.8, .7, 4.3, 0xffffff), H.boxGeo(0, 1, -.2, 1.6, .62, 2.3, 0x1b2129)]; for (const dx of [-.82, .82]) for (const dz of [-1.35, 1.35]) parts.push(H.beamGeo(new V3(dx - .12, .34, dz), new V3(dx + .12, .34, dz), .34, 0x111111, 10)); return H.mergeGeos(parts); })();
  const cars = []; for (let i = 0; i < 12; i++) for (const x of [-72, -50]) if (r() < .7) cars.push([x, -21.8 + i * 4.4, x < -60 ? Math.PI / 2 : -Math.PI / 2]);
  for (let z = 30; z > -880; z -= 9) if (r() < .25) cars.push([-650 + (r() < .5 ? -1 : 1) * 4, z, 0]);
  const cm = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .35, metalness: .4}), cars.length); const pal = [0xc0392b, 0xf2f2f2, 0x2c3e50, 0x7f8c8d, 0x2e86c1, 0xd4ac0d, 0x111111, 0x1e8449];
  cars.forEach(([x, z, a], i) => { cm.setMatrixAt(i, M4.compose(p.set(x, gy(x, z) + .05, z), q.setFromAxisAngle(Y, a), s.set(1, 1, 1))); cm.setColorAt(i, col.set(pal[(r() * pal.length) | 0])); });
  cm.castShadow = cm.receiveShadow = true; cm.computeBoundingSphere(); g.add(cm);
}
// ---------------- trees (pines + broadleaf), bushes, rocks and grass, kept off roads, runway, pads and the town
function flora() {
  const H = site.H, g = site.g, gy = H.groundY, r = (() => { let s = 5; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; })(), _v = new V3();
  if (site.trees) { for (const t of [].concat(site.trees)) { g.remove(t); t.geometry.dispose(); } site.trees = null; }
  const hAt = (x, z) => { _v.set(x, 0, z).applyQuaternion(site.q).add(site.p).normalize(); return heightAt(PLANET, _v.x, _v.y, _v.z); };
  const blocked = (x, z, town = .08) => { const d = Math.hypot(x, z); if (d < 125 || (x > -120 && x < 125 && z > -45 && z < 125)) return true;
    if (Math.abs(z - 330) < 62 && x > -650 && x < 1050) return true; if (x > 160 && x < 390 && z > -150 && z < 110) return true; if (x > -10 && x < 300 && z > 20 && z < 60) return true;
    if (Math.abs(z - 100) < 12 && x > -665 && x < -100) return true; if (Math.abs(x + 650) < 12 && z > -915 && z < 110) return true; for (const zc of [-450, -600, -750]) if (Math.abs(z - zc) < 12 && x > -925 && x < -395) return true;
    if (x > -930 && x < -380 && z > -930 && z < -380) return r() > town; if (Math.hypot(x - 183, z + 210) < 30 || Math.hypot(x + 256, z - 282) < 20) return true; return false; };
  const nonIdx = geo => geo.index ? geo.toNonIndexed() : geo;
  const pine = H.mergeGeos([H.tint(nonIdx(new THREE.CylinderGeometry(.16, .26, 2.6, 6).translate(0, 1.3, 0)), 0x0d0906), ...[[2.2, 3.8, 2.4, 0x060b04], [1.7, 3.2, 4.3, 0x070d05], [1.15, 2.6, 6.1, 0x081006], [.6, 1.8, 7.6, 0x091206]].map(([rr, h, y, c]) => H.tint(nonIdx(new THREE.ConeGeometry(rr, h, 8).translate(0, y + h / 2, 0)), c))]);
  const leaf = H.mergeGeos([H.tint(nonIdx(new THREE.CylinderGeometry(.18, .3, 3, 6).translate(0, 1.5, 0)), 0x0c0805), ...[[0, 4.4, 0, 2, 0x0b1105], [1.2, 3.9, .6, 1.4, 0x0d1406], [-1.1, 4.1, -.5, 1.5, 0x0a0f04], [.2, 5.5, -.3, 1.3, 0x0f1707], [-.4, 3.6, 1.1, 1.2, 0x0c1205]].map(([x, y, z, rr, c]) => H.tint(new THREE.IcosahedronGeometry(rr, 0).translate(x, y, z), c))]);
  const vm = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .9}), M4 = new THREE.Matrix4(), q = new Q4(), s = new V3(), p = new V3(), col = new THREE.Color(), Y = new V3(0, 1, 0);
  const NP = 3200, NL = 1800, pines = new THREE.InstancedMesh(pine, vm, NP), leafs = new THREE.InstancedMesh(leaf, vm, NL); let kp = 0, kl = 0;
  for (let i = 0; i < 60000 && (kp < NP || kl < NL); i++) { const a = r() * 6.283, d = 140 + Math.pow(r(), 1.5) * 5200, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const fm = noise3(x / 260, 3, z / 260, 77) + noise3(x / 70, 5, z / 70, 78) * .35; if (fm < -.05 && r() > .12) continue; if (blocked(x, z)) continue; const h = hAt(x, z); if (h < 4 || h > 1900) continue;
    const isPine = h > 260 || noise3(x / 500, 7, z / 500, 79) > -.1, sz = (.75 + r() * .7) * (fm > .3 ? 1.15 : 1); q.setFromAxisAngle(Y, r() * 6.28); p.set(x, gy(x, z) - .25, z); s.set(sz, sz * (.85 + r() * .4), sz); M4.compose(p, q, s); col.setRGB(.82 + r() * .3, .85 + r() * .25, .8 + r() * .2);
    if (isPine && kp < NP) { pines.setMatrixAt(kp, M4); pines.setColorAt(kp++, col); } else if (!isPine && kl < NL) { leafs.setMatrixAt(kl, M4); leafs.setColorAt(kl++, col); } }
  pines.count = kp; leafs.count = kl; for (const m of [pines, leafs]) { m.castShadow = m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); g.add(m); }
  // bushes + rocks
  const bush = new THREE.IcosahedronGeometry(1, 1), rock = new THREE.DodecahedronGeometry(1, 0), NB = 2200, NR = 700, bm = new THREE.InstancedMesh(H.tint(bush, 0x0c1306), vm, NB), rm = new THREE.InstancedMesh(H.tint(nonIdx(rock), 0x2c2a27), new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, flatShading: true}), NR); let kb = 0, kr = 0;
  for (let i = 0; i < 30000 && (kb < NB || kr < NR); i++) { const a = r() * 6.283, d = 115 + Math.pow(r(), 1.3) * 2600, x = Math.cos(a) * d, z = Math.sin(a) * d; if (blocked(x, z, .3)) continue; const h = hAt(x, z); if (h < 1) continue;
    q.setFromAxisAngle(Y, r() * 6.28); const isRock = h < 7 || r() < .22; if (isRock && kr < NR) { const sc = .4 + Math.pow(r(), 2) * 2.6; p.set(x, gy(x, z) - sc * .3, z); s.set(sc * (1 + r() * .6), sc * (.5 + r() * .4), sc); rm.setMatrixAt(kr, M4.compose(p, q.setFromEuler(new THREE.Euler(r(), r() * 6, r())), s)); rm.setColorAt(kr++, col.setRGB(.8 + r() * .35, .8 + r() * .3, .78 + r() * .3)); }
    else if (!isRock && kb < NB) { const sc = .6 + r() * 1.1; p.set(x, gy(x, z) + sc * .25, z); s.set(sc * (1 + r() * .5), sc * (.55 + r() * .3), sc); bm.setMatrixAt(kb, M4.compose(p, q, s)); bm.setColorAt(kb++, col.setRGB(.75 + r() * .4, .8 + r() * .3, .7 + r() * .3)); } }
  bm.count = kb; rm.count = kr; for (const m of [bm, rm]) { m.castShadow = m === rm; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); g.add(m); }
  // grass tufts round the site (normals point up so they shade like the ground)
  const tuft = (() => { const P = [], C = []; for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283 + Math.sin(k * 3) * .4, l = .35 + (k % 3) * .18, h = .45 + ((k * 5) % 4) * .14, cx = Math.cos(a), cz = Math.sin(a), px = -cz * .05, pz = cx * .05;
      P.push(-px, 0, -pz, px, 0, pz, cx * l * .55, h, cz * l * .55); C.push(.05, .08, .02, .05, .08, .02, .13, .18, .05); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return geo; })();
  const NG = 16000, gm = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, side: THREE.DoubleSide}), NG); let kg = 0;
  for (let i = 0; i < 60000 && kg < NG; i++) { const a = r() * 6.283, d = 112 + Math.pow(r(), 1.7) * 900, x = Math.cos(a) * d, z = Math.sin(a) * d; if (blocked(x, z, .5)) continue; if (noise3(x / 40, 1, z / 40, 81) < -.15) continue;
    const sc = .8 + r() * 1.1; gm.setMatrixAt(kg, M4.compose(p.set(x, gy(x, z) - .03, z), q.setFromAxisAngle(Y, r() * 6.28), s.set(sc, sc * (.7 + r() * .6), sc))); gm.setColorAt(kg++, col.setRGB(.8 + r() * .4, .85 + r() * .3, .7 + r() * .3)); }
  gm.count = kg; gm.userData.tile = [450, 700]; bm.userData.tile = [900, 1800]; rm.userData.tile = [900, 2500]; gm.receiveShadow = true; gm.instanceMatrix.needsUpdate = true; gm.computeBoundingSphere(); g.add(gm);
}

// ---------------- hooks: build with the site, refresh the stand when the design changes, the explosion counter, prompts + F, night lights
// group what a builder just added to site.g (so it can be hidden as one)
function adopt(n0) { const grp = new THREE.Group(); for (const k of site.g.children.slice(n0)) grp.add(k); site.g.add(grp); return grp; }
// split an instanced mesh into square tiles: the camera frustum and the shadow camera cull each tile, and far tiles are hidden (worldCull)
WLD.tiles = [];
function tileSplit(im, size, range) { const n = im.count, cells = new Map(), m = new THREE.Matrix4(), c = new THREE.Color(), par = im.parent;
  for (let i = 0; i < n; i++) { im.getMatrixAt(i, m); const k = Math.floor(m.elements[12] / size) + ',' + Math.floor(m.elements[14] / size); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
  for (const idx of cells.values()) { const t = new THREE.InstancedMesh(im.geometry, im.material, idx.length); let sx = 0, sz = 0;
    idx.forEach((i, j) => { im.getMatrixAt(i, m); t.setMatrixAt(j, m); sx += m.elements[12]; sz += m.elements[14]; if (im.instanceColor) { im.getColorAt(i, c); t.setColorAt(j, c); } });
    t.castShadow = im.castShadow; t.receiveShadow = im.receiveShadow; t.computeBoundingSphere(); t.userData.cx = sx / idx.length; t.userData.cz = sz / idx.length; t.userData.range = range + size * .75; par.add(t); WLD.tiles.push(t); }
  par.remove(im); }
{ const b0 = buildSite; buildSite = function () { b0(); try { let n0 = site.g.children.length; hangarInside(); WLD.gIn = adopt(n0); hangarRocket();
    n0 = site.g.children.length; grounds(); WLD.gOut = adopt(n0); n0 = site.g.children.length; town(); WLD.gTown = adopt(n0); n0 = site.g.children.length; flora(); WLD.gFl = adopt(n0);
    for (const im of [...WLD.gTown.children, ...WLD.gFl.children, ...WLD.gOut.children]) if (im.isInstancedMesh) { const [sz, rg] = im.userData.tile || (im.parent === WLD.gTown ? [700, 9000] : [1100, 6000]); tileSplit(im, sz, rg); }
  } catch (e) { console.error('world build', e); } }; }
// hide what is too far to matter (checked 4x a second): tiles by distance, the hangar inside past 450 m, everything from high up
const _wcam = new V3(), _wqi = new Q4();
function worldCull() { if (!site.p || !WLD.gIn) return; const c = bodyToSite(_wcam.copy(G.O).sub(PLANET.c).applyQuaternion(_wqi.copy(PLANET.q).invert()), _wcam), hi = c.y > 25000 || Math.hypot(c.x, c.z) > 60000;
  WLD.gIn.visible = !hi && Math.hypot(c.x, c.z) < 450 && c.y < 2000; WLD.gOut.visible = WLD.gTown.visible = !hi;
  const yy = Math.max(0, c.y); for (const t of WLD.tiles) { const u = t.userData; t.visible = !hi && Math.hypot(c.x - u.cx, c.z - u.cz, yy) < u.range; } }
{ const a0 = shipApply; shipApply = function (parts, name) { a0(parts, name); hangarRocket(); }; }
{ const e0 = explode; explode = function (...a) { const r = e0.apply(this, a); try { localStorage.setItem('ye-boom', String(Date.now())); } catch (e) {} if (WLD.boomDraw) WLD.boomDraw(); return r; }; }
// the stand: board the rocket on it (a fresh one rolls out to pad 1)
WLD.acts.push({x: 0, z: -2.2, r: 2.6, t: () => 'F · Fly ' + SHIP.name + ' (rolls out to pad 1)', fn: () => {
  if (R.st === 'fly') { showHint('Your rocket is still flying: land it first', 2500); return; }
  if (typeof flightClear === 'function') flightClear(); clearDebris(); resetRocket(); if (typeof warmShaders === 'function') warmShaders(); board(); toPilot(); G.wi = 0; G.warp = 1;
  showHint(SHIP.name + ' is on pad 1. Space: launch · V: outside view · B: back to the builder', 6000); }});
const _wsp = new V3(), _wu = new V3();
{ const h0 = FLIGHT.hideHud; FLIGHT.hideHud = function () { h0.call(this); WLD.near = null; if (!G.on || G.paused || R.on || P.body !== PLANET || !site.p) return;
    const s = bodyToSite(P.pos, _wsp); if (Math.abs(s.x) > 30 || Math.abs(s.z) > 30 || s.y > 3) return; let best = null, bd = 1e9;
    for (const a of WLD.acts) { const d = Math.hypot(s.x - a.x, s.z - a.z); if (d < a.r && d < bd) { best = a; bd = d; } }
    if (best) { WLD.near = best; const el = $('act'); el.classList.remove('hidden'); el.textContent = typeof best.t === 'function' ? best.t() : best.t; } }; }
addEventListener('keydown', e => { if (e.code !== 'KeyF' || e.repeat || !WLD.near || R.on || G.paused || !G.on) return; const a = WLD.near; WLD.near = null; a.fn(); });
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v0.call(this, dt);
    if (site.p) { _wu.copy(SITE).applyQuaternion(PLANET.q).transformDirection(cam.matrixWorldInverse); HG_UP.value.copy(_wu); }
    if ((WLD.c = (WLD.c || 0) - dt) <= 0 || dt === 0) { WLD.c = .25; worldCull(); }
    if ((WLD.t = (WLD.t || 0) - dt) > 0 && dt > 0) return; WLD.t = .5; const el = siteSun(); WLD.night = sstep(.06, -.1, el); WLD.day = sstep(-.12, .2, el);
    if (WLD.lampM) WLD.lampM.emissiveIntensity = WLD.night * 3; if (WLD.winM) for (const m of WLD.winM) m.emissiveIntensity = WLD.night * 1.4;
    if (WLD.clerM) WLD.clerM.color.setRGB(.06 + 1.3 * WLD.day, .07 + 1.4 * WLD.day, .09 + 1.6 * WLD.day); }; }
Object.assign(window.YE, {WLD, hangarRocket, boardDraw});

// ---------------- the Home map (map view, mission control globe + screens): 512x256, real terrain colours, hill shading, shallow seas.
// Baked a few rows at a time in the background (time budget), so it is ready before you open the map. MAPB.row still counts 0..128 for the old callers.
mapBuild = function (budget = 2.5) {
  if (!MAPB.c) { MAPB.c = document.createElement('canvas'); MAPB.c.width = 512; MAPB.c.height = 256; MAPB.x = MAPB.c.getContext('2d'); MAPB.x.fillStyle = '#0b2440'; MAPB.x.fillRect(0, 0, 512, 256); MAPB.im = MAPB.x.createImageData(512, 1); MAPB.rr = 0; MAPB.row = 0; MAPB.up = new Float32Array(512); }
  if (MAPB.rr >= 256) return; const t0 = performance.now(), W = 512, Hh = 256, d = MAPB.im.data, up = MAPB.up;
  for (let n = 0; MAPB.rr < Hh && (n < 1 || performance.now() - t0 < budget); n++, MAPB.rr++) { const j = MAPB.rr, lat = Math.PI / 2 - (j + .5) / Hh * Math.PI; let hl = 0;
    for (let i = 0; i < W; i++) { const lon = (i + .5) / W * 2 * Math.PI - Math.PI, cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = -Math.cos(lat) * Math.sin(lon), h = heightAt(PLANET, cx, cy, cz);
      const hu = j ? up[i] : h; if (i === 0) hl = h; const sl = Math.min(1, (Math.abs(h - hl) + Math.abs(h - hu)) / 9000); let r, g, b;
      if (h < 0) { const k = clamp(-h / 2500, 0, 1), sh = sstep(-140, 0, h); r = 12 - 6 * k + sh * 30; g = 52 - 24 * k + sh * 62; b = 92 - 34 * k + sh * 58; }
      else { const c = colorAt(PLANET, cx, cy, cz, h, sl); const sh = clamp(1 + ((h - hl) + (h - hu)) * .00055, .55, 1.45); r = Math.pow(c.r, 1 / 2.2) * 255 * sh; g = Math.pow(c.g, 1 / 2.2) * 255 * sh; b = Math.pow(c.b, 1 / 2.2) * 255 * sh; }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; hl = h; up[i] = h; }
    MAPB.x.putImageData(MAPB.im, 0, j); }
  MAPB.row = MAPB.rr >= Hh ? 128 : Math.floor(MAPB.rr / Hh * 128);
  if (MAPB.rr >= Hh) { if (MAPB.tex) MAPB.tex.needsUpdate = true; if (MAPV.plTex) MAPV.plTex.needsUpdate = true; } };
{ const v1 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v1.call(this, dt); if (G.on && MAPB.c && MAPB.rr < 256 && !MAPV.on && (WLD.mf = (WLD.mf || 0) + 1) % 3 === 0) { mapBuild(1); if (MAPB.tex && MAPB.rr % 32 === 0) MAPB.tex.needsUpdate = true; } }; }
// map view: mark the space centre on Home
{ const mr = mapRender, _sv = new V3(), _cv = new V3(); mapRender = function (dt) { mr(dt); if (!site.p) return; const x = MAPV.x;
    const w = _sv.copy(site.p).applyQuaternion(PLANET.q).multiplyScalar(.001).add(MAPV.pl.position); if (_cv.copy(MAPV.cam.position).sub(w).dot(_sv.clone().sub(MAPV.pl.position)) < 0) return;
    const p = w.clone().project(MAPV.cam); if (p.z > 1) return; const sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight;
    x.fillStyle = '#ffcf4a'; x.strokeStyle = '#0b1424'; x.lineWidth = 2; x.beginPath(); x.moveTo(sx, sy - 8); x.lineTo(sx + 4, sy + 3); x.lineTo(sx - 4, sy + 3); x.closePath(); x.stroke(); x.fill();
    x.font = '600 11px Archivo, sans-serif'; x.textAlign = 'left'; x.fillStyle = 'rgba(255,207,74,.9)'; x.fillText('Space Centre', sx + 7, sy + 3); }; }
