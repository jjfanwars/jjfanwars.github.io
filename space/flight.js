'use strict';
// YeShip flight (step 2): starter rocket, flight physics, controls, chase camera, exhaust plume, smoke, sounds, flight HUD.
// Loaded after game.js and shares its top-level names (THREE, V3, Q4, G, P, PLANET, MOON, site, scene, cam, keys, look...). Calls boot() at the end.
const G0 = 9.81, OMEGA = new V3(0, 2 * Math.PI / PLANET.day, 0);
const SOI_M = MOON.orbit * Math.pow(MOON.GM / PLANET.GM, .4); // moon's sphere of influence (~2400 km)
const P_H = 3500; // air pressure scale height (engines + drag)
function airAt(alt) { return alt > PLANET.atmo ? 0 : Math.exp(-alt / P_H) * (1 - sstep(PLANET.atmo * .7, PLANET.atmo, alt)); } // pressure, 1 = sea level
const WARPS = [1, 2, 4, 10, 50, 100, 1000, 10000];
G.wi = 0; G.warp = 1;

// moon orbit (matches bodyState in game.js), analytic velocity
const _mp = new V3(), _mv = new V3();
function moonPos(t, out) { const a = 2 * Math.PI * t / MOON.period + 2.2, inc = .09; return out.set(Math.cos(a) * MOON.orbit, Math.sin(a) * Math.sin(inc) * MOON.orbit, -Math.sin(a) * Math.cos(inc) * MOON.orbit); }
function moonVel(t, out) { const a = 2 * Math.PI * t / MOON.period + 2.2, inc = .09, w = 2 * Math.PI / MOON.period; return out.set(-Math.sin(a) * MOON.orbit * w, Math.cos(a) * Math.sin(inc) * MOON.orbit * w, -Math.cos(a) * Math.cos(inc) * MOON.orbit * w); }
function bodySpin(b) { return b === PLANET ? OMEGA.y : 2 * Math.PI / MOON.period; } // both spin about inertial +y
// velocity of the ground (or air) at inertial point p of body b
function groundVel(b, p, t, out) { const w = bodySpin(b); if (b === PLANET) return out.set(w * p.z, 0, -w * p.x);
  moonPos(t, _mp); moonVel(t, out); return out.add(new V3(w * (p.z - _mp.z), 0, -w * (p.x - _mp.x))); }
function gravAt(p, t, out) { const r2 = p.lengthSq(); out.copy(p).multiplyScalar(-PLANET.GM / (r2 * Math.sqrt(r2)));
  moonPos(t, _mp); const dx = _mp.x - p.x, dy = _mp.y - p.y, dz = _mp.z - p.z, d2 = dx * dx + dy * dy + dz * dz, k = MOON.GM / (d2 * Math.sqrt(d2)); out.x += dx * k; out.y += dy * k; out.z += dz * k; return out; }
function domBody(p) { return p.distanceTo(MOON.c) < SOI_M ? MOON : PLANET; }

// ---------------- rocket model (local: y = nose, -z = "front" (faces east on the pad), origin at the engine bell exit)
const RM = {}; // materials + cached geometry
{ const paint = (c, r = .38) => new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: .05});
  RM.white = paint(0xf3f2ee); RM.black = paint(0x17191d, .5); RM.grey = new THREE.MeshStandardMaterial({color: 0x5d636b, roughness: .45, metalness: .7});
  RM.gold = new THREE.MeshStandardMaterial({color: 0xd9a23a, roughness: .3, metalness: 1});
  RM.shield = paint(0x3a2a20, .8); RM.win = new THREE.MeshStandardMaterial({color: 0x0a1220, roughness: .05, metalness: .9, envMapIntensity: 1.6});
  RM.cap = new THREE.MeshStandardMaterial({color: 0xdcdfe3, roughness: .32, metalness: .35});
  const bell = new THREE.MeshStandardMaterial({color: 0x2c2d31, roughness: .32, metalness: .9, side: THREE.DoubleSide, emissive: 0xff6a1e, emissiveIntensity: 0});
  bell.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= gl_FrontFacing ? .12 : 1.;'); }; // the inside of the bell glows
  RM.bellM = bell; RM.bell2 = bell.clone(); RM.bell2.onBeforeCompile = bell.onBeforeCompile;
  // painted tank: panel seams, black roll pattern, name down the side
  const tankTex = (h, label, bands) => { const c = document.createElement('canvas'); c.width = 512; c.height = h; const x = c.getContext('2d');
    x.fillStyle = '#f1f0ec'; x.fillRect(0, 0, 512, h); x.strokeStyle = 'rgba(0,0,0,.07)'; x.lineWidth = 2;
    for (let y = 40; y < h; y += 85) { x.beginPath(); x.moveTo(0, y); x.lineTo(512, y); x.stroke(); } for (let u = 0; u < 512; u += 64) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, h); x.stroke(); }
    x.fillStyle = '#17191d'; for (const [y0, y1, ph] of bands) for (let q = 0; q < 4; q++) if ((q + ph) % 2) x.fillRect(q * 128, y0 * h, 128, (y1 - y0) * h);
    if (label) { x.save(); x.translate(384 - 10, h * .5); x.rotate(-Math.PI / 2); x.font = '600 74px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 0, 0); x.restore(); }
    x.fillStyle = '#ff8a1e'; x.fillRect(0, h * .985, 512, h * .015);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  RM.tank1 = new THREE.MeshStandardMaterial({map: tankTex(2048, 'YESHIP', [[0, .06, 0], [.9, 1, 1]]), roughness: .36, metalness: .05});
  RM.tank2 = new THREE.MeshStandardMaterial({map: tankTex(1024, '', [[0, .14, 1], [.86, 1, 0]]), roughness: .36, metalness: .05});
  // parachute canopy: orange/white gores
  { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f4f1ea' : '#ff6a1e'; x.fillRect(i * 32, 0, 32, 64); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; RM.chute = new THREE.MeshStandardMaterial({map: t, roughness: .8, side: THREE.DoubleSide}); }
}
function bellGeo(rT, rE, len) { const pts = []; for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(new THREE.Vector2(rT + (rE - rT) * Math.pow(t, .55), len - t * len)); } return new THREE.LatheGeometry(pts, 40); }
function finGeo() { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0, 2.8); s.lineTo(1.25, .7); s.lineTo(1.3, -.6); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, {depth: .1, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1}); g.translate(0, 0, -.05); return g; }
function mesh(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; }
function cylY(r0, r1, y0, y1, m, seg = 40, open = false) { const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open); return mesh(g, m, 0, (y0 + y1) / 2, 0); }

// exhaust plume: additive cone, widens in thin air; shock diamonds near sea level
const PLUME_VS = `#include <common>
#include <logdepthbuf_pars_vertex>
uniform float L, r0, sp; varying float vS; varying vec3 vN, vV;
void main(){ float s = .5 - position.y; vS = s; float r = r0 * (1. + sp * s + .4 * sp * sqrt(s));
  vec3 p = vec3(position.x * r, -s * L, position.z * r); vN = normalMatrix * normalize(vec3(position.x, r0 * sp / L * 1.5, position.z));
  vec4 mv = modelViewMatrix * vec4(p, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`;
const PLUME_FS = `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 cA, cB; uniform float I, shock, t; varying float vS; varying vec3 vN, vV;
void main(){
#include <logdepthbuf_fragment>
  float f = abs(dot(normalize(vN), normalize(-vV))), th = pow(f, 1.6);
  float s = vS, fall = exp(-s * 2.8) * smoothstep(0., .04, s) * smoothstep(1., .55, s);
  float dia = 1. + shock * 1.4 * pow(.5 + .5 * cos(s * 42.), 8.) * exp(-s * 3.5);
  float fl = .85 + .15 * sin(t * 71. + s * 23.) * sin(t * 37. - s * 11.);
  vec3 col = mix(cA, cB, smoothstep(0., .45, s)) * I * th * fall * dia * fl;
  gl_FragColor = vec4(col, 1.); }`;
function plumeMat(cA, cB) { return new THREE.ShaderMaterial({vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  uniforms: {L: {value: 10}, r0: {value: 1}, sp: {value: .5}, cA: {value: new V3(...cA)}, cB: {value: new V3(...cB)}, I: {value: 0}, shock: {value: 1}, t: {value: 0}}}); }
const PLUME_GEO = new THREE.CylinderGeometry(1, 1, 1, 32, 40, true);

// stage table, bottom to top. Masses in kg, thrust in N (vacuum), Isp in s.
const STAGES = [
  {name: 'Booster', dry: 2400, fuel: 20000, thrust: 520000, ispS: 270, ispV: 300, y0: 0, y1: 16.6, exit: .95, hot: 1},
  {name: 'Upper stage', dry: 1200, fuel: 9000, thrust: 80000, ispS: 210, ispV: 345, y0: 14.7, y1: 21.6, exit: .7, hot: 0},
  {name: 'Capsule', dry: 2200, fuel: 0, y0: 21.6, y1: 26.1, chute: true},
];
function buildStage(i) {
  const g = new THREE.Group(), S = STAGES[i];
  if (i === 0) {
    g.add(mesh(bellGeo(.32, .95, 2.3), RM.bellM)); g.add(cylY(.4, .4, 2.3, 2.95, RM.grey, 20));
    g.add(mesh(new THREE.BoxGeometry(.5, .5, .45), RM.gold, .45, 2.65, 0)); g.add(cylY(.6, 1.25, 2.9, 3.6, RM.grey));
    g.add(cylY(1.25, 1.25, 3.6, 14.4, RM.tank1, 48)); g.add(cylY(1.27, 1.27, 14.35, 14.6, RM.grey, 48));
    const ist = cylY(1.25, 1.25, 14.6, 16.6, RM.black, 48, true); ist.material = RM.black.clone(); ist.material.side = THREE.DoubleSide; g.add(ist);
    const fg = finGeo(); for (let k = 0; k < 4; k++) { const f = mesh(fg, RM.black); const a = Math.PI / 4 + k * Math.PI / 2; f.position.set(Math.cos(a) * 1.22, 3.6, -Math.sin(a) * 1.22); f.rotation.y = a; g.add(f); }
  } else if (i === 1) {
    g.add(mesh(bellGeo(.22, .7, 1.35), RM.bell2, 0, 14.75, 0)); g.add(cylY(.28, .28, 16.1, 16.55, RM.grey, 20)); g.add(mesh(new THREE.BoxGeometry(.32, .32, .3), RM.gold, .3, 16.3, 0));
    g.add(cylY(1.25, 1.25, 16.55, 20.4, RM.tank2, 48)); g.add(cylY(1.25, 2.5, 20.4, 21.6, RM.white, 64)); g.add(cylY(1.27, 1.27, 20.4, 20.55, RM.grey, 48)); // flared adapter up to the wide capsule
    // four landing legs: fold up along the tank, swing out for a landing (R.legs)
    const legs = [], strut = new THREE.CylinderGeometry(.075, .095, 3.4, 10); strut.translate(0, -1.7, 0); const pad = new THREE.CylinderGeometry(.34, .4, .1, 20), knee = new THREE.CylinderGeometry(.04, .04, 1.9, 8); knee.translate(0, -.95, 0);
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, base = new THREE.Group(); base.position.set(Math.cos(a) * 1.32, 17.5, -Math.sin(a) * 1.32); base.rotation.y = a; g.add(base);
      base.add(mesh(new THREE.BoxGeometry(.22, .34, .3), RM.grey, -.04, 0, 0)); const hinge = new THREE.Group(); base.add(hinge); hinge.add(mesh(strut, RM.grey)); const ft = mesh(pad, RM.black, 0, -3.42, 0); hinge.add(ft);
      const br = mesh(knee, RM.gold, 0, -1.3, 0); br.rotation.z = -.5; hinge.add(br); legs.push(hinge); }
    g.userData.legs = legs;
  } else buildCapsule(g);
  if (S.thrust) { // two-layer plume hung below the bell
    const pg = new THREE.Group(); pg.position.y = S.y0 + (i === 1 ? .05 : 0);
    const hot = S.hot ? [[1, .92, .75], [1, .5, .16]] : [[.85, .78, 1], [.45, .4, 1]];
    const core = new THREE.Mesh(PLUME_GEO, plumeMat(hot[0], hot[1])), outer = new THREE.Mesh(PLUME_GEO, plumeMat(hot[1], S.hot ? [.9, .25, .06] : [.3, .25, .8]));
    core.frustumCulled = outer.frustumCulled = false; core.renderOrder = outer.renderOrder = 5; pg.add(core, outer); g.add(pg); g.userData.plume = [core, outer];
  }
  return g;
}

// ---------------- rocket state
const R = {on: false, st: 'pad', body: PLANET, pos: new V3(), vel: new V3(), q: new Q4(), w: new V3(), lp: new V3(), lq: new Q4(),
  thr: 1, sas: 'hold', felt: new V3(0, 9.81, 0), t0: 0, hold: new Q4(), bot: 0, lit: false, fuel: [], chute: 0, chA: 0, comY: 10, F: 0, p: 0, qd: 0, deadT: 0,
  g: new THREE.Group(), inner: new THREE.Group(), sg: [], debris: [],
  legs: 0, legT: 0, warpTo: 0, spool: 0, inp: new V3(), lag: new V3(), clag: new V3(), fov: 70, cam: {yaw: 1.65, pitch: .12, dist: 48, ref: new V3()}};
R.g.add(R.inner); scene.add(R.g);
const flameL = new THREE.PointLight(0xffa04a, 0, 0, 2); scene.add(flameL); // always in the scene (adding lights later recompiles every material)
const _ry = new Q4().setFromAxisAngle(new V3(0, 1, 0), -Math.PI / 2);
function rocketMass() { let m = 0; for (let i = R.bot; i < STAGES.length; i++) m += STAGES[i].dry + R.fuel[i]; return m; }
function comOf() { let m = 0, my = 0; for (let i = R.bot; i < STAGES.length; i++) { const S = STAGES[i], mi = S.dry + R.fuel[i]; m += mi; my += mi * (S.y0 + S.y1) / 2; } return my / m; }
function resetRocket() {
  for (const g of R.sg) R.inner.remove(g); R.sg = STAGES.map((_, i) => buildStage(i)); for (const g of R.sg) R.inner.add(g);
  R.fuel = STAGES.map(s => s.fuel); R.bot = 0; R.lit = false; R.thr = 1; R.chute = 0; R.chA = 0; R.w.set(0, 0, 0); R.sas = 'hold'; R.st = 'pad'; R.body = PLANET; R.deadT = 0; R.legs = R.legT = 0; R.warpTo = 0; R.spool = 0; R.inp.set(0, 0, 0); R.test = false; R.legManual = false; R.g.visible = true; R.t0 = 0; HIST.length = 0;
  R.comY = comOf(); const pad = site.pads[0]; siteToBody(new V3(pad.x, pad.y + R.comY, pad.z), R.lp); R.lq.copy(site.q).multiply(_ry);
  latch(G.t); R.hold.copy(R.q);
}
function latch(t) { const b = R.body; R.pos.copy(R.lp).applyQuaternion(b.q).add(b.c); R.q.copy(b.q).multiply(R.lq); groundVel(b, R.pos, t, R.vel); }
const _n = new V3(), _a = new V3(), _va = new V3(), _t1 = new V3(), _t2 = new V3(), _qa = new Q4(), _qb = new Q4();
function botY() { return STAGES[R.bot].y0 - (R.bot === 1 && R.legs > .9 ? .6 : 0); } // lowest point of the stack (rocket coords)
function nose(out) { return out.set(0, 1, 0).applyQuaternion(R.q); }

// ---------------- staging: launch, drop spent stages, open the parachute
function stage() {
  if (R.st === 'dead') return;
  const S = STAGES[R.bot];
  if (!R.lit && S.thrust && R.fuel[R.bot] > 0) { R.lit = true; if (R.st === 'pad') { sfx('clamp'); showHint('Liftoff!', 2500); } else sfx('pop'); return; }
  if (R.bot < STAGES.length - 1) { dropStage(); const N = STAGES[R.bot]; R.lit = !!N.thrust && R.fuel[R.bot] > 0; sfx('pop'); return; }
  if (STAGES[R.bot].chute && R.chute === 0) { R.chute = 1; sfx('pop'); showHint('Parachute armed: it opens low and slow', 3500); }
}
function dropStage() {
  const i = R.bot, g = R.sg[i], nz = nose(_n);
  const d = {g: new THREE.Group(), pos: R.pos.clone(), vel: R.vel.clone().addScaledVector(nz, -2.5), q: R.q.clone(), w: new V3((Math.random() - .5) * .15, (Math.random() - .5) * .2, (Math.random() - .5) * .15), m: STAGES[i].dry + R.fuel[i], cdA: 3.5, t: 0, plume: g.userData.plume};
  R.inner.remove(g); g.position.y = -R.comY; d.g.add(g); scene.add(d.g); R.debris.push(d);
  if (d.plume) for (const m of d.plume) m.visible = false;
  { const jy = STAGES[i].y1 - 1.9 - R.comY, jp = R.pos.clone().addScaledVector(nz, jy), d = new V3(); for (let k = 0; k < 40; k++) { d.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).addScaledVector(nz, -d.dot(nz)).normalize();
      puff(jp.clone().addScaledVector(d, 1.3), R.vel.clone().addScaledVector(d, 6 + Math.random() * 10).addScaledVector(nz, -2 - Math.random() * 3), {life: 1.2 + Math.random(), s: 1.4, gr: 2.5, heat: 0, drag: .6, tone: 1}); } }
  R.bot++; R.vel.addScaledVector(nz, .8); const c0 = R.comY; R.comY = comOf(); R.pos.addScaledVector(nz, R.comY - c0); // keep the parts where they were
  if (R.st !== 'fly') { R.lp.addScaledVector(new V3(0, 1, 0).applyQuaternion(R.lq), R.comY - c0); }
}

// ---------------- physics
function rocketStep(h, t) {
  if (R.st === 'dead') { latch(t); return; } // the wreck point turns with the ground
  const nz = nose(_n), m = rocketMass(), S = STAGES[R.bot];
  const r = R.pos.length(), alt = r - PLANET.R, p = airAt(alt); R.p = p;
  // engine
  const want = R.lit && S.thrust && R.fuel[R.bot] > 0 && R.thr > 0 ? 1 : 0; R.spool += clamp(want - R.spool, -h * 4, h * (R.st === 'pad' ? 1.6 : 3)); // engines take a moment to come up to power
  R.F = 0; if (want && R.spool > 0) { const isp = lerp(S.ispV, S.ispS, p); R.F = S.thrust * R.thr * R.spool * isp / S.ispV; R.fuel[R.bot] = Math.max(0, R.fuel[R.bot] - R.F / (isp * G0) * h); if (R.fuel[R.bot] === 0) { R.lit = false; showHint('Out of fuel. Space: next stage', 3000); } }
  if (R.st !== 'fly') { // held by the pad clamps, or sitting on the ground
    latch(t); const gl = gravAt(R.pos, t, _a).length(); R.felt.set(0, gl, 0);
    if (R.F / m > gl * 1.02) { R.st = 'fly'; R.w.set(0, 0, 0); R.hold.copy(R.q); if (!R.t0) R.t0 = t; } return; // free from the next substep (the latch already put us at time t)
  }
  // air
  groundVel(PLANET, R.pos, t, _va); _va.subVectors(R.vel, _va); const vs = _va.length(); const rho = 1.225 * p; R.qd = .5 * rho * vs * vs;
  // parachute: opens when armed, below 9 km and slower than 280 m/s
  if (R.chute === 1 && p > .07 && vs < 280) { R.chute = 2; sfx('chute'); showHint('Parachute open: it holds you upright now', 2500); R.sg[R.sg.length - 1].userData.chute.visible = true; }
  if (R.chute === 2) { const tg = alt > 1000 && radarAlt() > 1000 ? .07 : 1; /* main canopy 1 km above the ground (or sea) */ R.chA += clamp(tg - R.chA, -h, h / 3); } // drogue high up, full canopy below 1 km
  let cdA = (R.bot < 2 ? 4.5 : 16);
  if (vs > 1) { const ca = (nz.x * _va.x + nz.y * _va.y + nz.z * _va.z) / vs, s2 = Math.max(0, 1 - ca * ca), M = vs / 330, len = 26.1 - STAGES[R.bot].y0;
    cdA = cdA * (1 + .9 * Math.exp(-(((M - 1.05) / .3) ** 2)) + .3 * sstep(.8, 1.8, M)) + s2 * (R.bot === 2 ? 4 : len * 2.5 * .7); R.mach = M; R.aoa = s2; } else R.mach = R.aoa = 0;
  cdA += R.chA * 1100;
  gravAt(R.pos, t, _a); _a.addScaledVector(nz, R.F / m);
  if (vs > .01 && R.qd > 0) _a.addScaledVector(_va, -R.qd * cdA / (m * vs));
  R.felt.copy(_a).sub(gravAt(R.pos, t, _t1)).applyQuaternion(_qa.copy(R.q).invert()); // what the crew feels (thrust + drag)
  R.vel.addScaledVector(_a, h); R.pos.addScaledVector(R.vel, h);
  // rotation: player input, else SAS, plus aerodynamic weathervaning
  const pk = pilot() ? keys : {}, ix = (pk.KeyS ? 1 : 0) - (pk.KeyW ? 1 : 0), iz = (pk.KeyA ? 1 : 0) - (pk.KeyD ? 1 : 0), iy = (pk.KeyQ ? 1 : 0) - (pk.KeyE ? 1 : 0);
  const auth = clamp(Math.sqrt(16000 / m), .7, 2), mr = .55 * Math.min(auth, 1.35), wt = _t1.set(0, 0, 0); let free = false;
  for (const [k, v] of [['x', ix], ['y', iy], ['z', iz]]) { const c = R.inp[k]; R.inp[k] = v ? clamp(c + Math.sign(v - c) * h * (Math.sign(v) === Math.sign(c) || !c ? 2.2 : 8), -1, 1) : c * Math.max(0, 1 - h * 14); }
  if (ix || iy || iz || R.inp.lengthSq() > 4e-4) { wt.set(R.inp.x * mr, R.inp.y * .8, R.inp.z * mr); R.hold.copy(R.q); }
  else if (R.sas === 'off' || R.chute === 2) { wt.copy(R.w); free = true; } // the canopy steers once it is open
  else if (R.sas === 'hold') { _qa.copy(R.q).invert().multiply(R.hold); if (_qa.w < 0) { _qa.x *= -1; _qa.y *= -1; _qa.z *= -1; _qa.w *= -1; } const s = Math.sqrt(1 - Math.min(1, _qa.w * _qa.w)), ang = 2 * Math.acos(Math.min(1, _qa.w));
    if (s > 1e-6) wt.set(_qa.x / s, _qa.y / s, _qa.z / s).multiplyScalar(Math.min(mr, ang * 2)); }
  else { const d = sasDir(_t2); if (d) { d.applyQuaternion(_qa.copy(R.q).invert()); const ax = new V3(d.z, 0, -d.x), sl = ax.length(), ang = Math.acos(clamp(d.y, -1, 1));
      if (sl > 1e-6) ax.multiplyScalar(Math.min(mr, ang * 2) / sl); else if (d.y < 0) ax.set(mr, 0, 0); wt.copy(ax); wt.y = 0; R.hold.copy(R.q); } }
  const acc = 1.4 * auth * h; for (const k of ['x', 'y', 'z']) R.w[k] += clamp(wt[k] - R.w[k], -acc, acc);
  if (vs > 5 && R.qd > 50) { // fins keep the rocket pointing along the airflow; a lone capsule flies blunt end first
    const vl = _t2.copy(_va).multiplyScalar(1 / vs).applyQuaternion(_qa.copy(R.q).invert()); if (R.bot === STAGES.length - 1) vl.negate();
    const k = (R.chA > .1 ? 3 : 1) * .7 * Math.min(1, R.qd / 25000) * h; R.w.x += vl.z * k; R.w.z -= vl.x * k; if (!free || R.chA > .1) { R.w.x *= 1 - k; R.w.z *= 1 - k; } }
  if (R.chA > .05) { // the canopy hangs the capsule under it: swing the top toward the oncoming air (straight up when slow)
    const d = vs > 2 ? _t2.copy(_va).multiplyScalar(-1 / vs) : _t2.copy(R.pos).sub(PLANET.c).normalize(); d.applyQuaternion(_qa.copy(R.q).invert());
    let ax = _n.set(d.z, 0, -d.x); const ang = Math.acos(clamp(d.y, -1, 1)); if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0); ax.normalize().multiplyScalar(Math.min(1.2, ang * 1.5));
    const k = 1 - Math.exp(-h * 2.5 * Math.min(1, R.chA * 3)); R.w.x += (ax.x - R.w.x) * k; R.w.z += (ax.z - R.w.z) * k; R.w.y *= 1 - k; }
  const wl = R.w.length(); if (wl > 1e-7) { _qb.setFromAxisAngle(_t2.copy(R.w).multiplyScalar(1 / wl), wl * h); R.q.multiply(_qb).normalize(); }
  // ground contact (bottom of the stack)
  for (const b of BODIES) { const rel = _t2.copy(R.pos).sub(b.c); if (rel.length() - b.R > 12000) continue;
    const bot = rel.addScaledVector(nose(_n), -(R.comY - botY())); const bf = bot.clone().applyQuaternion(_qa.copy(b.q).invert()), gr = groundR(b, bf);
    if (bf.length() >= gr) continue;
    const vg = groundVel(b, R.pos, t, new V3()), sp = R.vel.distanceTo(vg), up = bf.clone().normalize();
    if (_t2.subVectors(R.vel, vg).dot(_t1.copy(up).applyQuaternion(b.q)) > 0 && bf.length() > gr - .5) continue; // lifting off: moving away from the ground
    const tilt = Math.acos(clamp(new V3(0, 1, 0).applyQuaternion(_qa.copy(b.q).invert().multiply(R.q)).dot(up), -1, 1));
    const legs = R.bot === 1 && R.legs > .9, chute = R.chA > .5; if (sp > (legs ? 14 : 12) || (tilt > (legs ? .8 : chute ? 1.2 : .55) && sp > 3) || tilt > (chute ? 1.6 : 1.1)) { explode(); return; } // a capsule on its chute can come down swinging
    R.landV = sp;
    // set down upright
    R.body = b; const lq = _qa.copy(b.q).invert().multiply(R.q), ly = new V3(0, 1, 0).applyQuaternion(lq); lq.premultiply(new Q4().setFromUnitVectors(ly, up));
    R.lq.copy(lq); R.lp.copy(up).multiplyScalar(gr + R.comY - botY()); R.st = 'landed'; R.w.set(0, 0, 0); latch(t);
    sfx('thud'); showHint(b === MOON ? 'Landed on the Moon!' : 'Landed. F: get out · Backspace: new rocket', 5000); return; }
}
function sasDir(out) { // inertial direction for the SAS modes
  const b = domBody(R.pos), rel = _t1.copy(R.pos).sub(b.c);
  if (R.sas === 'up') return out.copy(rel).normalize();
  if (R.sas === 'guide') return guideDir(out);
  const v = R.sas === 'pro' || R.sas === 'retro' ? relVel(out) : null; if (!v || v.lengthSq() < 1) return null; v.normalize(); return R.sas === 'retro' ? v.negate() : v; }
// ascent guide: pitch over gently from straight up to flat by ~45 km, toward the east (or north for a polar orbit)
const GUIDE = {head: 'east', ap: 80000};
function guideDir(out) {
  const b = domBody(R.pos), up = _t1.copy(R.pos).sub(b.c).normalize(), alt = R.pos.distanceTo(b.c) - b.R;
  const east = new V3(0, 1, 0).cross(up).normalize(), dir = GUIDE.head === 'north' ? new V3(0, 1, 0).addScaledVector(up, -up.y).normalize() : east;
  const g0 = b === PLANET ? 900 : 150, g1 = b === PLANET ? 44000 : 9000; // the Moon has no air: turn over much sooner
  if (alt > g1) { const v = relVel(new V3()); v.addScaledVector(up, -v.dot(up)); return v.lengthSq() > 1 ? out.copy(v.normalize()) : out.copy(dir); }
  const th = Math.PI / 2 * Math.min(1, Math.sqrt(Math.max(0, alt - g0) / (g1 - g0))) * .97;
  return out.copy(up).multiplyScalar(Math.cos(th)).addScaledVector(dir, Math.sin(th)).normalize(); }
function guideOn() { if (R.st !== 'fly') return false; const b = domBody(R.pos), o = orbitOf(b), alt = R.pos.distanceTo(b.c) - b.R; return o.pe < (b === PLANET ? PLANET.atmo : 3000) && alt < (b === PLANET ? 60000 : 20000) && (o.ap === Infinity || o.ap > alt - 50); }
function relVel(out) { // surface velocity low down, orbital velocity higher up
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R;
  if (b === PLANET) return alt < 20000 ? groundVel(PLANET, R.pos, G.t, out).negate().add(R.vel) : out.copy(R.vel);
  moonVel(G.t, out); if (alt < 6000) groundVel(MOON, R.pos, G.t, out); return out.negate().add(R.vel); }
function debrisStep(d, h, t) {
  gravAt(d.pos, t, _a); const alt = d.pos.length() - PLANET.R, p = airAt(alt);
  if (p > 0) { groundVel(PLANET, d.pos, t, _va); _va.subVectors(d.vel, _va); const vs = _va.length(); if (vs > .01) _a.addScaledVector(_va, -.5 * 1.225 * p * vs * d.cdA / d.m); }
  d.vel.addScaledVector(_a, h); d.pos.addScaledVector(d.vel, h); const wl = d.w.length(); if (wl > 0) d.q.multiply(_qb.setFromAxisAngle(_t1.copy(d.w).multiplyScalar(1 / wl), wl * h));
  d.t += h;
  for (const b of BODIES) { const rel = _t2.copy(d.pos).sub(b.c); if (rel.length() - b.R > 12000) continue; const bf = rel.applyQuaternion(_qa.copy(b.q).invert());
    if (bf.length() < groundR(b, bf) + 3) { boom(d.pos, .6); d.dead = true; return; } }
}
function flightStep(dt) {
  if (!G.on) return;
  const sim = dt * G.warp; if (sim <= 0) return;
  const t1 = G.t, coast = R.st === 'fly' && R.F === 0 && R.p === 0 && altAbove() > 15000;
  const n = R.st === 'fly' ? Math.min(4000, Math.ceil(sim / (coast ? .5 : .02))) : Math.max(1, Math.ceil(sim / .05)), h = sim / n;
  for (let i = 0; i < n; i++) { const t = t1 - sim + h * (i + 1); bodyState(PLANET, t); bodyState(MOON, t); rocketStep(h, t);
    if (R.debris.length && i % (coast ? 1 : 4) === 0) for (const d of R.debris) debrisStep(d, coast ? h : h * 4, t); }
  R.debris = R.debris.filter(d => { if (d.dead || d.t > 1800 || d.pos.distanceTo(R.pos) > 4e5) { scene.remove(d.g); return false; } return true; });
  if (R.st === 'dead' && (R.deadT -= dt) <= 0) { respawn(); }
  // keep warp safe: no fast warp under thrust, in the air, or near the ground
  if (R.on && R.st === 'fly' && G.wi > 2 && (R.F > 0 || R.p > 0 || altAbove() < 12000)) { G.wi = 2; G.warp = WARPS[2]; }
  if (R.warpTo) { const left = R.warpTo - G.t; if (left <= 0 || R.st !== 'fly' || R.F > 0) { R.warpTo = 0; G.wi = 0; G.warp = 1; if (left <= 0) showHint('Arrived', 1500); }
    else { let i = WARPS.length - 1; while (i > 0 && WARPS[i] * .05 * 4 > left) i--; if (i > 2 && (R.p > 0 || altAbove() < 12000)) i = 2; G.wi = i; G.warp = WARPS[i]; } }
}
function legsStep(dt) {
  if (R.bot !== 1) return; const leg = R.sg[1] && R.sg[1].userData.legs; if (!leg) return;
  if (R.st === 'fly' && R.legT === 0 && !R.legManual) { const ra = radarAlt(); if (ra < 2500 && vertSpeed() < -2) { R.legT = 1; showHint('Landing legs out', 2000); sfx('pop'); } }
  R.legs = clamp(R.legs + (R.legT - R.legs) * Math.min(1, dt * 1.6) + Math.sign(R.legT - R.legs) * dt * .05, 0, 1);
  const ang = lerp(Math.PI - .06, .5, sstep(0, 1, R.legs)); for (const h of leg) h.rotation.z = ang; }
// landing maths: how much height a full retrograde burn needs to stop (it also has to kill the sideways speed)
function landCalc() { const b = domBody(R.pos), v = relVel(new V3()).length(), vs = vertSpeed(), vd = Math.max(0, -vs), gl = b.GM / R.pos.distanceToSquared(b.c), am = maxAcc() * .9, hs = Math.sqrt(Math.max(0, v * v - vs * vs));
  // fly the burn forward (thrust against the velocity, flat ground, constant gravity): how far down do we go before we stop?
  let stop = Infinity; if (am > gl) { let u = hs, w = vs, h = 0, lo = 0; for (let i = 0; i < 3000; i++) { const sp = Math.hypot(u, w); if (sp < 1.5) break; const dt = clamp(sp / am / 60, .01, .5);
      u -= am * u / sp * dt; w += (-am * w / sp - gl) * dt; h += w * dt; if (h < lo) lo = h; if (w > 0 && u < 1) break; } stop = -lo; }
  return {ra: radarAlt(), vd, v, hs, stop}; }
function vertSpeed() { const b = domBody(R.pos), up = _t2.copy(R.pos).sub(b.c).normalize(); return relVel(new V3()).dot(up); }
let _raT = 0, _raV = 1e9; // radar altitude (height of the bottom of the stack over the ground), cached a little
function radarAlt() { if (G.t === _raT) return _raV; _raT = G.t; const b = domBody(R.pos), rel = R.pos.clone().sub(b.c), d = rel.length() - b.R; if (d > 60000) return _raV = d;
  const bf = rel.applyQuaternion(_qa.copy(b.q).invert()); return _raV = bf.length() - groundR(b, bf) - (R.comY - botY()); }
function altAbove() { const b = domBody(R.pos); return R.pos.distanceTo(b.c) - b.R; }

// ---------------- crash
function explode() {
  const wb = R.body = domBody(R.pos); R.lp.copy(R.pos).sub(wb.c).applyQuaternion(_qa.copy(wb.q).invert()); R.lq.copy(_qa).multiply(R.q);
  R.st = 'dead'; R.deadT = 4; R.lit = false; R.F = 0; R.g.visible = false; boom(R.pos, 1.6); sfx('boom');
  // the stack breaks into a few tumbling pieces
  for (const g of R.sg.slice(R.bot)) { R.inner.remove(g); const d = {g: new THREE.Group(), pos: R.pos.clone(), vel: R.vel.clone(), q: R.q.clone(), m: 800, cdA: 4, t: 1700, plume: g.userData.plume};
    g.position.y = -R.comY; d.g.add(g); scene.add(d.g); if (d.plume) for (const p of d.plume) p.visible = false;
    const b = domBody(R.pos), up = R.pos.clone().sub(b.c).normalize(); d.vel = groundVel(b, R.pos, G.t, new V3()).addScaledVector(up, 12 + Math.random() * 18).add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(30));
    d.w = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(4); d.cdA = 6; R.debris.push(d); }
  R.sg = []; showHint('Kaboom! Back to the space centre...', 3500);
}
function respawn() { resetRocket(); if (R.on) { R.on = false; C.in = false; C.seat = -1; cabL.intensity = 0; $('cross').classList.remove('hidden'); spawnPlayer(); P.body = PLANET; } }

// ---------------- particles: smoke, fire, explosions (camera-relative billboards, premultiplied alpha)
const PN = 2000, PT = {n: 0, head: 0, pos: new Float64Array(PN * 3), vel: new Float32Array(PN * 3), age: new Float32Array(PN), life: new Float32Array(PN), s0: new Float32Array(PN), gr: new Float32Array(PN), heat: new Float32Array(PN), hk: new Float32Array(PN), tone: new Float32Array(PN), drag: new Float32Array(PN), rise: new Float32Array(PN)};
const pGeo = new THREE.InstancedBufferGeometry(); { const pl = new THREE.PlaneGeometry(1, 1); pGeo.index = pl.index; pGeo.setAttribute('position', pl.getAttribute('position')); pGeo.setAttribute('uv', pl.getAttribute('uv')); }
const pAP = new THREE.InstancedBufferAttribute(new Float32Array(PN * 3), 3), pAD = new THREE.InstancedBufferAttribute(new Float32Array(PN * 4), 4); pAP.setUsage(THREE.DynamicDrawUsage); pAD.setUsage(THREE.DynamicDrawUsage);
pGeo.setAttribute('iP', pAP); pGeo.setAttribute('iD', pAD); pGeo.instanceCount = 0;
const PNOISE = (() => { const N = 128, d = new Uint8Array(N * N * 4), per = (x, y, p, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), m = (a, b) => hsh(((a % p) + p) % p, ((b % p) + p) % p, 0, s);
    return lerp(lerp(m(xi, yi), m(xi + 1, yi), u), lerp(m(xi, yi + 1), m(xi + 1, yi + 1), u), v); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let t = 0, a = .5, f = 8; for (let o = 0; o < 4; o++) { t += a * per(i / N * f, j / N * f, f, 7 + o); a *= .5; f *= 2; } const o = (j * N + i) * 4; d[o] = d[o + 1] = d[o + 2] = clamp(t / .9375, 0, 1) * 255; d[o + 3] = 255; }
  const t = new THREE.DataTexture(d, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; })();
const pMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: {sunV: {value: new V3()}, sunC: {value: new V3()}, ambC: {value: new V3()}, flP: {value: new V3()}, flC: {value: new V3()}, nT: {value: PNOISE}},
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iP; attribute vec4 iD; varying vec2 vUv; varying vec4 vD; varying vec3 vV;
void main(){ vUv = uv; vD = iD; vec4 mv = viewMatrix * vec4(iP, 1.); mv.xy += position.xy * iD.x; vV = mv.xyz; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\n' + `
uniform vec3 sunV, sunC, ambC, flP, flC; uniform sampler2D nT; varying vec2 vUv; varying vec4 vD; varying vec3 vV;
void main(){
#include <logdepthbuf_fragment>
  vec2 q = vUv * 2. - 1.; float seed = fract(vD.w * 37.1) * 50.; float n = texture2D(nT, q * .27 + vec2(seed * .137, seed * .0713)).r; float d = dot(q, q) * (1.25 - n * .6);
  if (d > 1.) discard;
  float a = pow(1. - d, 1.6) * vD.y; vec3 N = normalize(vec3(q * 1.2, sqrt(max(0., 1. - d)) + .2));
  float l = clamp(dot(N, sunV) * .65 + .32 + (n - .5) * .9, .06, 1.), tone = floor(vD.w) / 100.;
  vec3 col = tone * (sunC * l + ambC);
  float fd = length(vV - flP); col += tone * flC / (1. + fd * fd * .02);
  float ht = vD.z; vec3 fire = mix(vec3(1., .3, .06), vec3(1., .75, .4), ht) * (4. + 40. * ht * ht) * (.7 + .6 * n);
  col = mix(col, fire, clamp(ht * 1.6, 0., 1.));
  gl_FragColor = vec4(col * a, a * (1. - clamp(ht, 0., 1.) * .75)); }`});
const pMesh = new THREE.Mesh(pGeo, pMat); pMesh.frustumCulled = false; pMesh.renderOrder = 6; scene.add(pMesh);
function puff(p, v, o) { const i = PT.head; PT.head = (PT.head + 1) % PN; PT.n = Math.min(PN, PT.n + 1);
  PT.pos[i * 3] = p.x; PT.pos[i * 3 + 1] = p.y; PT.pos[i * 3 + 2] = p.z; PT.vel[i * 3] = v.x; PT.vel[i * 3 + 1] = v.y; PT.vel[i * 3 + 2] = v.z;
  PT.age[i] = 0; PT.life[i] = o.life; PT.s0[i] = o.s; PT.gr[i] = o.gr; PT.heat[i] = o.heat || 0; PT.hk[i] = o.hk || 2; PT.tone[i] = o.tone || .8; PT.drag[i] = o.drag ?? 1; PT.rise[i] = o.rise || 0; }
function boom(at, k) { const b = domBody(at), up = at.clone().sub(b.c).normalize(), vg = groundVel(b, at, G.t, new V3()), d = new V3(), air = b === PLANET && at.length() - PLANET.R < PLANET.atmo;
  for (let i = 0; i < 70 * k; i++) { d.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().addScaledVector(up, .5); const s = (10 + Math.random() * 30) * k;
    puff(at, vg.clone().addScaledVector(d, s), {life: 1.5 + Math.random() * 1.5, s: 3 * k, gr: 9 * k, heat: 1, hk: .6 + Math.random() * .5, drag: air ? 1.8 : 0, tone: .3}); }
  if (air) for (let i = 0; i < 40 * k; i++) { d.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().addScaledVector(up, .8); puff(at, vg.clone().addScaledVector(d, (4 + Math.random() * 12) * k), {life: 9 + Math.random() * 8, s: 5 * k, gr: 3 * k, heat: .3, hk: 1.5, drag: 1, tone: .18, rise: 1.5}); }
  G.flash = Math.max(G.flash || 0, k); G.flashP = at.clone(); }
const _pd = new Float32Array(PN), _pi = new Uint16Array(PN), _pdd = new Float32Array(PN), _pidx = [], _pcmp = (a, b) => _pdd[b] - _pdd[a];
function stepParticles(dt) {
  if (!PT.n) { pGeo.instanceCount = 0; return; }
  const sim = Math.min(dt * G.warp, .2); let k = 0;
  for (let i = 0; i < PT.n; i++) { if (PT.age[i] >= PT.life[i]) continue; PT.age[i] += sim; const j = i * 3;
    _t1.set(PT.pos[j], PT.pos[j + 1], PT.pos[j + 2]); const b = domBody(_t1); groundVel(b, _t1, G.t, _va); const dk = 1 - Math.exp(-sim * PT.drag[i] * (b === PLANET ? Math.max(.05, airAt(_t1.length() - PLANET.R)) : 0));
    for (let c = 0; c < 3; c++) PT.vel[j + c] += (_va.getComponent(c) - PT.vel[j + c]) * dk;
    if (PT.rise[i]) { const up = _t2.copy(_t1).sub(b.c).normalize(); for (let c = 0; c < 3; c++) PT.vel[j + c] += up.getComponent(c) * PT.rise[i] * sim; }
    for (let c = 0; c < 3; c++) PT.pos[j + c] += PT.vel[j + c] * sim;
    // billow out along the ground at the pad
    if (b === PLANET) { const r = Math.hypot(PT.pos[j], PT.pos[j + 1], PT.pos[j + 2]), gr = PLANET.R + SITE_H + 3.5 + PT.s0[i] * .3;
      if (r < gr && _t1.distanceTo(_t2.copy(site.p).applyQuaternion(PLANET.q)) < 3000) { const up = _t2.set(PT.pos[j], PT.pos[j + 1], PT.pos[j + 2]).multiplyScalar(1 / r); for (let c = 0; c < 3; c++) PT.pos[j + c] += up.getComponent(c) * (gr - r);
        const vu = PT.vel[j] * up.x + PT.vel[j + 1] * up.y + PT.vel[j + 2] * up.z; if (vu < 0) for (let c = 0; c < 3; c++) PT.vel[j + c] -= up.getComponent(c) * vu * 1.0; } }
    _pd[k] = (PT.pos[j] - G.O.x) ** 2 + (PT.pos[j + 1] - G.O.y) ** 2 + (PT.pos[j + 2] - G.O.z) ** 2; _pi[k++] = i; }
  // far to near
  const idx = _pidx; idx.length = k; for (let a = 0; a < k; a++) { idx[a] = _pi[a]; _pdd[_pi[a]] = _pd[a]; } idx.sort(_pcmp); // no allocations per frame
  const P3 = pAP.array, D4 = pAD.array;
  for (let a = 0; a < k; a++) { const i = idx[a], j = i * 3, u = PT.age[i] / PT.life[i];
    P3[a * 3] = PT.pos[j] - G.O.x; P3[a * 3 + 1] = PT.pos[j + 1] - G.O.y; P3[a * 3 + 2] = PT.pos[j + 2] - G.O.z;
    D4[a * 4] = PT.s0[i] + PT.gr[i] * Math.sqrt(PT.age[i]) * 2; D4[a * 4 + 1] = Math.min(1, PT.age[i] * 8) * Math.pow(1 - u, 1.4) * .85; D4[a * 4 + 2] = PT.heat[i] * Math.exp(-PT.age[i] * PT.hk[i] * 3);
    D4[a * 4 + 3] = Math.round(PT.tone[i] * 100) + (i % 97) / 97; }
  pGeo.instanceCount = k; pAP.needsUpdate = pAD.needsUpdate = true;
  if (PT.head === 0 && k === 0) PT.n = 0;
}

// ---------------- visuals each frame: place meshes, plume, chute, flame light, exhaust smoke
let smokeAcc = 0;
function flightVisuals(dt) {
  const cs = compM.uniforms.sunCol.value; // sunlight colour at the camera (from game.js)
  R.g.position.copy(R.pos).sub(G.O); R.g.quaternion.copy(R.q); R.inner.position.y = -R.comY;
  for (const d of R.debris) { d.g.position.copy(d.pos).sub(G.O); d.g.quaternion.copy(d.q); }
  // engine glow + plume
  const S = STAGES[R.bot], on = R.F > 0 ? R.thr : 0, vac = 1 - R.p, nz = nose(_n);
  for (let i = 0; i < R.sg.length; i++) { const u = R.sg[i].userData; if (!u.plume) continue; const live = i === R.bot && on > 0, [core, outer] = u.plume; core.visible = outer.visible = live;
    const bm = i === 0 ? RM.bellM : RM.bell2; bm.emissiveIntensity = lerp(bm.emissiveIntensity, live ? (i === 0 ? 1.6 : 1.1) * (.4 + .6 * vac) : 0, 1 - Math.exp(-dt * (live ? 6 : .6)));
    if (!live) continue; const st = STAGES[i], ex = st.exit;
    const cu = core.material.uniforms, ou = outer.material.uniforms, hot = st.hot;
    cu.r0.value = ex * .62; cu.sp.value = lerp(.1, 1.4, vac); cu.L.value = (hot ? 9 : 3.5) * (.6 + .4 * on) * (1 + vac * .6); cu.I.value = (hot ? 16 : 3.5) * on * (1 - .35 * vac); cu.shock.value = hot ? R.p : 0; cu.t.value = G.t % 50;
    ou.r0.value = ex * .95; ou.sp.value = lerp(.45, 5.5, vac); ou.L.value = (hot ? 22 : 9) * (.5 + .5 * on) * (1 + vac * 1.3); ou.I.value = (hot ? 3.2 : 1.4) * on * (1 - .6 * vac); ou.shock.value = 0; ou.t.value = cu.t.value; }
  // flame light below the bell (lights the pad, smoke and the rocket at night)
  const fp = _t1.copy(R.pos).sub(G.O).addScaledVector(nz, -(R.comY - S.y0) - 1.5); flameL.position.copy(fp); flameL.intensity = on * (S.hot ? 1400 : 300) * (.9 + .2 * Math.random());
  if (G.flash > 0) { flameL.position.copy(G.flashP).sub(G.O); flameL.intensity = Math.max(flameL.intensity, G.flash * 6e4); G.flash = Math.max(0, G.flash - dt * 1.5); }
  // chute
  const cap = R.sg[R.sg.length - 1]; if (cap && cap.userData.chute) { const ch = cap.userData.chute; ch.visible = R.chute === 2; const s = .05 + .95 * sstep(0, 1, R.chA); ch.scale.set(s, .3 + .7 * s, s); }
  // exhaust smoke (only in the air)
  if (on > 0 && R.p > .02 && R.st !== 'dead') { smokeAcc += dt * (20 + 50 * on) * Math.min(1, R.p * 3) * Math.min(1, G.warp); const ext = _t2.copy(R.pos).addScaledVector(nz, -(R.comY - S.y0) - 6);
    const vg = groundVel(PLANET, ext, G.t, new V3()), lowPad = R.pos.length() - PLANET.R - SITE_H - R.comY < 60 && R.pos.distanceTo(_t1.copy(site.p).applyQuaternion(PLANET.q)) < 1500;
    while (smokeAcc > 1) { smokeAcc--; const v = vg.clone().lerp(R.vel, .25).addScaledVector(nz, -(30 + Math.random() * 40)).add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(lowPad ? 20 : 6));
      puff(ext.clone().addScaledVector(nz, -Math.random() * 10), v, {life: ((lowPad ? 18 : 12) + Math.random() * 10) * Math.min(1, .3 + R.p * 2), s: 3.5, gr: lowPad ? 5.5 : 4, heat: S.hot ? .35 : .15, hk: 2.5, drag: 1.2, tone: S.hot ? .72 : .9, rise: lowPad ? .35 : .1}); } }
  else smokeAcc = 0;
  // particle lighting
  const u = pMat.uniforms; u.sunV.value.copy(SUN).transformDirection(cam.matrixWorldInverse); u.sunC.value.copy(cs).multiplyScalar(3.4 / Math.PI / .9);
  const ap = R.pos.length() - PLANET.R < PLANET.atmo; u.ambC.value.set(.05, .07, .1).multiplyScalar(ap ? 1.6 : .3);
  u.flP.value.copy(fp).applyMatrix4(cam.matrixWorldInverse); u.flC.value.set(1, .55, .25).multiplyScalar(on * (S.hot ? 25 : 6));
  stepParticles(dt);
  // label over the rocket while on foot
  const tag = $('rTag'); if (!R.on && R.st !== 'dead' && G.on) { const top = _t1.copy(R.pos).sub(G.O).addScaledVector(nz, 23.6 - R.comY + 3), dist = top.length();
    _t2.copy(top).project(cam); const vis = _t2.z < 1 && Math.abs(_t2.x) < 1.1 && Math.abs(_t2.y) < 1.1 && dist < 3000;
    tag.classList.toggle('hidden', !vis); if (vis) { tag.style.left = ((_t2.x * .5 + .5) * innerWidth) + 'px'; tag.style.top = ((-_t2.y * .5 + .5) * innerHeight) + 'px'; tag.textContent = canBoard() ? 'F · Get in' : 'Rocket · ' + Math.round(dist) + ' m'; } }
  else tag.classList.add('hidden');
}

// ---------------- chase camera: orbits the rocket, keeps the horizon level
function flightCamera(dt) {
  const c = R.cam, b = domBody(R.pos), up = _t1.copy(R.pos).sub(b.c).normalize();
  c.ref.addScaledVector(up, -c.ref.dot(up)); if (c.ref.lengthSq() < 1e-8) c.ref.set(1, 0, 0).addScaledVector(up, -up.x); c.ref.normalize();
  const sens = .0028; c.yaw += look.dx * sens; c.pitch = clamp(c.pitch + look.dy * sens, -1.45, 1.45); look.dx = look.dy = 0;
  const right = _t2.crossVectors(c.ref, up).normalize();
  const v = new V3().addScaledVector(c.ref, Math.cos(c.yaw)).addScaledVector(right, Math.sin(c.yaw)).multiplyScalar(Math.cos(c.pitch)).addScaledVector(up, -Math.sin(c.pitch));
  const tgt = R.pos.clone().addScaledVector(nose(_n), 2), eye = tgt.clone().addScaledVector(v, -c.dist);
  // shake: engines in thick air, and max-q
  const sh = (R.F > 0 ? R.thr * (.02 + .12 * R.p) : 0) + Math.min(.15, R.qd / 2e5) + (G.flash || 0) * .3; if (sh > 0 && R.st !== 'dead') eye.add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(sh * Math.min(1, c.dist / 30)));
  // stay above the ground
  const rel = eye.clone().sub(b.c); if (rel.length() - b.R < 15000) { const bf = rel.clone().applyQuaternion(_qa.copy(b.q).invert()), gr = groundR(b, bf) + 1.5; if (bf.length() < gr) eye.copy(b.c).addScaledVector(rel.normalize(), gr); }
  const fa = _t2.copy(R.felt).applyQuaternion(R.q); if (R.st !== 'fly') fa.set(0, 0, 0); else fa.multiplyScalar(-.055).clampLength(0, 3.2); R.lag.lerp(fa, 1 - Math.exp(-dt * 2.5)); eye.add(R.lag);
  G.O.copy(eye); _m.lookAt(eye, tgt, up); cam.quaternion.setFromRotationMatrix(_m); cam.position.set(0, 0, 0); cam.updateMatrixWorld();
}
addEventListener('wheel', e => { if (!G.on || !R.on || MAPV.on) return; e.preventDefault(); R.cam.dist = clamp(R.cam.dist * Math.exp(e.deltaY * .0015), 8, 2000); }, {passive: false});

// ---------------- boarding
function canBoard() { if (R.st === 'fly' || R.st === 'dead' || P.body !== R.body) return false; const base = R.lp.clone().addScaledVector(new V3(0, 1, 0).applyQuaternion(R.lq), -(R.comY - STAGES[R.bot].y0));
  const up = base.clone().normalize(), d = P.pos.clone().sub(base); return d.dot(up) < 26 && d.addScaledVector(up, -d.dot(up)).length() < 20; }
function board() { R.on = true; C.in = true; C.seat = -1; C.view = 'in'; C.pos.set(0, CAB.floor, .3); C.vel.set(0, 0, 0); C.yaw = 0; C.pitch = 0; const c = R.cam; c.dist = 48; c.pitch = .05; c.yaw = 1.65; c.ref.set(1, 0, 0).applyQuaternion(site.q).applyQuaternion(PLANET.q); if (R.st !== 'pad') { c.ref.copy(new V3(0, 0, -1).applyQuaternion(R.q)); c.yaw = 0; }
  showHint('You are in the capsule. Walk to the middle seat and press F to fly · F at the hatch (back) to get out', 9000); }
function getOut() { if (R.st === 'fly' || R.st === 'dead') { showHint('Land first to get out', 2000); return; }
  const b = R.body, up = R.lp.clone().normalize(), side = new V3(0, 0, 1).applyQuaternion(R.lq); side.addScaledVector(up, -side.dot(up)).normalize();
  const base = R.lp.clone().addScaledVector(up, -(R.comY - STAGES[R.bot].y0));
  P.body = b; P.pos.copy(base).addScaledVector(side, 7).addScaledVector(up, 1.5); P.vel.set(0, 0, 0); P.fwd.copy(side).negate(); P.pitch = .3; R.on = false; C.in = false; C.seat = -1; cabL.intensity = 0; $('cross').classList.remove('hidden');
  showHint(b === MOON ? 'You are on the Moon. WASD walk, Space hop' : 'F at the rocket to get back in', 4000); }

// ---------------- keys
addEventListener('keydown', e => {
  sndInit(); if (!G.on || e.repeat) return; const k = e.code;
  if (k === 'KeyF') { if (R.on) cabinAct(); else if (canBoard()) board(); }
  if (k === 'KeyV' && pilot()) C.view = C.view === 'in' ? 'out' : 'in';
  if (k === 'Comma' || k === 'BracketLeft') setWarp(G.wi - 1);
  if (k === 'Period' || k === 'BracketRight') setWarp(G.wi + 1);
  if (!pilot()) { if (R.on && C.in && /^(Digit[1-5]|Numpad[1-5]|KeyT|KeyZ|KeyX)$/.test(k)) showHint('Sit in the middle (Pilot) seat to fly: walk to it and press F', 2500); return; }
  if (k === 'Space') { e.preventDefault(); stage(); }
  if (k === 'KeyZ') R.thr = 1; if (k === 'KeyX') R.thr = 0;
  const modes = {Digit1: 'hold', Digit2: 'pro', Digit3: 'retro', Digit4: 'up', Digit5: 'guide', Numpad1: 'hold', Numpad2: 'pro', Numpad3: 'retro', Numpad4: 'up', Numpad5: 'guide', KeyT: R.sas === 'off' ? 'hold' : 'off'}; if (modes[k]) setSas(modes[k]);
  if (k === 'KeyG' && R.bot === 1) { R.legT = R.legT ? 0 : 1; R.legManual = true; showHint(R.legT ? 'Landing legs out' : 'Landing legs in', 1500); }
  if (k === 'KeyN') warpNext();
  if (k === 'Backspace') { e.preventDefault(); if (R.st !== 'fly') { resetRocket(); showHint('New rocket on the pad', 2500); } }
});
addEventListener('pointerdown', sndInit);
function setSas(m) { R.sas = m; R.hold.copy(R.q);
  const names = {guide: 'Following the ascent guide (blue marker): you still stage and throttle', hold: 'Holding direction', pro: 'Pointing prograde (where you are going)', retro: 'Pointing retrograde (backwards, to slow down)', up: 'Pointing up', off: 'Autopilot off'};
  if ((m === 'pro' || m === 'retro') && (R.st !== 'fly' || relVel(new V3()).length() < 3)) showHint((m === 'pro' ? 'Prograde' : 'Retrograde') + ' needs you to be moving: it turns once you are flying', 3000); else showHint(names[m], 1800); }
function setWarp(i) { R.warpTo = 0; let mx = WARPS.length - 1; if (R.on && R.st === 'fly' && (R.F > 0 || R.p > 0 || altAbove() < 12000)) mx = 2; if (!R.on && G.on) mx = 6;
  G.wi = clamp(i, 0, mx); G.warp = WARPS[G.wi]; if (i > mx) showHint(R.on ? 'Faster time needs space, engines off' : 'Max time speed', 2000); }
function warpNext() { // time warp to the next apoapsis or periapsis, whichever is sooner
  if (!R.on || R.st !== 'fly') return; const o = orbitEl(domBody(R.pos)); const ts = [o.tAp, o.tPe].filter(x => x > 20); if (R.F > 0) { showHint('Cut the engine first (X)', 2000); return; }
  if (!ts.length) { showHint('Nothing to warp to', 1500); return; } const dt = Math.min(...ts); R.warpTo = G.t + dt - 15; showHint('Warping to ' + (dt === o.tAp ? 'apoapsis (Ap)' : 'periapsis (Pe)') + ' · any time key stops', 2500); }
function stepThrottle(dt) { if (!pilot()) return; if (keys.ShiftLeft || keys.ShiftRight) R.thr = Math.min(1, R.thr + dt * .9); if (keys.KeyC) R.thr = Math.max(0, R.thr - dt * .9); }

// ---------------- sound (WebAudio noise, no files)
const SND = {};
function sndInit() { if (SND.c) return; try { const c = SND.c = new (window.AudioContext || window.webkitAudioContext)(), n = c.sampleRate * 2;
    const br = c.createBuffer(1, n, c.sampleRate), wh = c.createBuffer(1, n, c.sampleRate), bd = br.getChannelData(0), wd = wh.getChannelData(0); let b = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; wd[i] = w; b = (b + .02 * w) / 1.02; bd[i] = b * 3.5; }
    SND.br = br; SND.wh = wh; SND.out = c.createGain(); SND.out.gain.value = .7; SND.out.connect(c.destination);
    const loop = (buf, type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(SND.out); s.start(); return {g, fl}; };
    SND.rum = loop(br, 'lowpass', 320, .7); SND.crk = loop(wh, 'bandpass', 1400, .5); SND.wind = loop(wh, 'bandpass', 500, .8);
  } catch (e) { SND.c = null; } }
function sfx(kind) { const c = SND.c; if (!c) return; const t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.connect(f); f.connect(g); g.connect(SND.out);
  const cfg = {pop: [SND.wh, 'highpass', 900, .5, .25], clamp: [SND.br, 'lowpass', 500, 1.2, .9], chute: [SND.wh, 'bandpass', 700, .6, .5], thud: [SND.br, 'lowpass', 200, 1.2, .5], boom: [SND.br, 'lowpass', 260, 2.4, 3.2]}[kind];
  s.buffer = cfg[0]; f.type = cfg[1]; f.frequency.value = cfg[2]; g.gain.setValueAtTime(cfg[3], t); g.gain.exponentialRampToValueAtTime(.001, t + cfg[4]); s.start(t, Math.random()); s.stop(t + cfg[4] + .1); }
function sndUpdate() { if (!SND.c) return; const t = SND.c.currentTime; let e = R.F > 0 ? R.thr : 0;
  const near = R.on ? 1 : clamp(1 - G.O.distanceTo(R.pos) / 4000, 0, 1) ** 2; e *= near * (STAGES[R.bot].hot ? 1 : .45); const p = .25 + .75 * Math.min(1, R.p * 2);
  SND.rum.g.gain.setTargetAtTime(e * p * .9, t, .08); SND.crk.g.gain.setTargetAtTime(e * p * .12 * (.7 + .3 * Math.random()), t, .05); SND.rum.fl.frequency.setTargetAtTime(220 + 200 * R.thr, t, .2);
  SND.wind.g.gain.setTargetAtTime(R.on ? Math.min(.5, R.qd / 40000) : 0, t, .2); SND.wind.fl.frequency.setTargetAtTime(300 + Math.min(900, R.qd / 30), t, .3); }

// ---------------- flight HUD
const fmtD = m => Math.abs(m) >= 1e6 ? (m / 1e6).toFixed(2) + ' Mm' : Math.abs(m) >= 1e4 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
function orbitOf(b) { const mu = b.GM, rr = R.pos.clone().sub(b.c), vv = R.vel.clone(); if (b === MOON) vv.sub(moonVel(G.t, new V3()));
  const r = rr.length(), v2 = vv.lengthSq(), E = v2 / 2 - mu / r, h = rr.clone().cross(vv).length(), e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (mu * mu)));
  const pe = h * h / mu / (1 + e) - b.R, ap = E < 0 ? -mu / (2 * E) * (1 + e) - b.R : Infinity; return {ap, pe}; }
// full orbital elements around body b: e, a, period, true anomaly, time to Ap / Pe (s), inclination to the equator
function orbitEl(b, pos = R.pos, vel = R.vel, t = G.t) { const mu = b.GM, rr = pos.clone().sub(b === MOON ? moonPos(t, new V3()) : b.c), vv = vel.clone(); if (b === MOON) vv.sub(moonVel(t, new V3()));
  const r = rr.length(), hv = rr.clone().cross(vv), h = hv.length(), E = vv.lengthSq() / 2 - mu / r, ev = vv.clone().cross(hv).multiplyScalar(1 / mu).sub(rr.clone().multiplyScalar(1 / r)), e = ev.length();
  const a = -mu / (2 * E), out = {e, a, r, ap: E < 0 ? a * (1 + e) - b.R : Infinity, pe: h * h / mu / (1 + e) - b.R, tAp: Infinity, tPe: Infinity, period: E < 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity, inc: Math.acos(clamp(hv.y / (h || 1), -1, 1))};
  let nu = e > 1e-6 ? Math.acos(clamp(ev.dot(rr) / (e * r), -1, 1)) : 0; if (rr.dot(vv) < 0) nu = 2 * Math.PI - nu; out.nu = nu;
  if (E < 0 && e < 1) { const n = Math.sqrt(mu / (a * a * a)), Ea = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)), M = ((Ea - e * Math.sin(Ea)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    out.tPe = (2 * Math.PI - M) / n; out.tAp = ((Math.PI - M) / n + out.period) % out.period; }
  else if (e > 1 && rr.dot(vv) < 0) { const n = Math.sqrt(mu / Math.pow(-a, 3)), F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)), M = e * Math.sinh(F) - F; out.tPe = Math.abs(M) / n; }
  return out; }
function stageDv() { const S = STAGES[R.bot]; if (!S.thrust || !R.fuel[R.bot]) return 0; const m = rocketMass(); return lerp(S.ispV, S.ispS, R.p) * G0 * Math.log(m / (m - R.fuel[R.bot])); }
function maxAcc() { const S = STAGES[R.bot]; return S.thrust && R.fuel[R.bot] > 0 ? S.thrust * lerp(S.ispV, S.ispS, R.p) / S.ispV / rocketMass() : 0; }
const fmtS = s => s === Infinity || isNaN(s) ? '—' : s >= 3600 ? (s / 3600 | 0) + 'h ' + String((s / 60 | 0) % 60).padStart(2, '0') + 'm' : (s / 60 | 0) + ':' + String(s % 60 | 0).padStart(2, '0');
const HUDE = {}, setTxt = (id, t) => { const el = HUDE[id] || (HUDE[id] = $(id)); if (el._t !== t) { el._t = t; el.textContent = t; } };
let sasBtns = null, fhT = 0;
function flightHud(dt) {
  const fl = $('fl'); fl.classList.remove('hidden'); document.body.classList.add('fly'); if ((fhT -= dt) > 0) return markers(); fhT = .1;
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, v = relVel(new V3()).length(), o = orbitOf(b), S = STAGES[R.bot];
  const sit = R.st === 'pad' ? 'On the pad' : R.st === 'landed' ? 'Landed' : R.st === 'dead' ? 'Crashed' : o.pe > (b === PLANET ? PLANET.atmo : 2000) ? 'In orbit' : alt < 20000 && b === PLANET ? 'Flying' : 'Suborbital';
  setTxt('hLoc', sit + (b === MOON ? ' · Moon' : '')); setTxt('hInfo', 'Local time ' + localTime() + (G.warp > 1 ? ' · Time ×' + G.warp : '') + (R.warpTo ? ' (warping)' : ''));
  setTxt('fAlt', fmtD(alt)); setTxt('fSpd', Math.round(v) + ' m/s');
  setTxt('fAp', o.ap === Infinity ? 'escape' : fmtD(o.ap)); setTxt('fPe', o.pe < -b.R * .5 ? '—' : fmtD(o.pe));
  // extra readouts: vertical speed, time to Ap/Pe, stage delta-v, ground radar + "burn now" for landings
  const el = orbitEl(b), vs = vertSpeed(), ra = radarAlt(), fly = R.st === 'fly'; let x = (vs >= 0 ? '↑ ' : '↓ ') + Math.abs(Math.round(vs)) + ' m/s';
  if (fly && el.tAp < 1e6 && (vs > 0 || el.tAp < el.tPe)) x += ' · Ap in ' + fmtS(el.tAp); else if (fly && el.tPe < 1e6 && el.pe > 0) x += ' · Pe in ' + fmtS(el.tPe);
  const dv = stageDv(); if (dv) x += ' · Δv ' + Math.round(dv); if (fly) x += ' · ' + (R.felt.length() / 9.81).toFixed(1) + ' g'; if (fly && R.p > .01 && R.mach > .3) x += ' · Mach ' + R.mach.toFixed(2); setTxt('fX', x);
  let w = '', wc = '';
  if (fly && ra < 15000) { const L = landCalc(), stop = L.stop, vd = L.vd, hs = L.hs;
    w = 'Ground ' + fmtD(Math.max(0, ra)); if (vd > 4 && b === MOON || vd > 4 && R.bot < 2 && ra < 4000) { if (stop * 1.25 + 60 > ra) { w += ' · BURN NOW'; wc = 'red'; } else if (stop * 2 + 150 > ra) { w += ' · burn soon'; wc = 'amber'; } }
    if (ra < 300 && (vd > 8 || hs > 8)) { w += ' · too fast'; wc = 'red'; } }
  setTxt('fW', w); const fw = HUDE.fW; if (fw._c !== wc) { fw._c = wc; fw.className = wc; }
  $('fThr').style.height = (R.thr * 100) + '%'; $('fFuel').style.height = (S.fuel ? R.fuel[R.bot] / S.fuel * 100 : 0) + '%'; setTxt('fStage', S.name + (R.bot === 1 ? ' · legs ' + (R.legT ? 'out' : 'in') + ' (G)' : ''));
  const nx = R.st === 'pad' && !R.lit ? 'Launch' : !R.lit && S.thrust && R.fuel[R.bot] > 0 ? 'Ignite' : R.bot < STAGES.length - 1 ? 'Drop ' + S.name.toLowerCase() : R.chute === 0 ? 'Parachute' : '';
  setTxt('fNext', nx ? 'Space · ' + nx : ''); for (const el of sasBtns || (sasBtns = [...document.querySelectorAll('#fSas button')])) el.classList.toggle('on', el.dataset.m === R.sas);
  markers();
}
const _mk = new V3(), _mv3 = new V3(), MKS = [['mPro', 1], ['mRet', -1], ['mGd', 0]];
function markers() { // prograde / retrograde / ascent-guide markers on screen
  const v = relVel(_mv3); const show = v.length() > 3 && R.st === 'fly' && !MAPV.on; v.normalize();
  const gd = !MAPV.on && (R.sas === 'guide' || guideOn()) ? guideDir(new V3()) : null;
  for (const [id, s] of MKS) { const el = HUDE[id] || (HUDE[id] = $(id)); const d = s ? (show ? _mk.copy(v).multiplyScalar(s) : null) : gd; if (!d) { el.classList.add('hidden'); continue; }
    const p = _mk.copy(d).multiplyScalar(1e4).project(cam); const ok = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; el.classList.toggle('hidden', !ok);
    if (ok) { el.style.transform = 'translate(' + ((p.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-p.y * .5 + .5) * innerHeight).toFixed(1) + 'px)'; } } }
document.querySelectorAll('#fSas button').forEach(el => el.onclick = e => { e.stopPropagation(); setSas(el.dataset.m); });

// ---------------- capsule: walk-in crew cabin (outer shell with real window holes, padded lining, seats, consoles, lockers, hatch)
const CAB = {y0: 21.85, y1: 25.45, rb: 2.5, rt: 1.0, wall: .09, floor: 22.0, ceil: 25.15, hatchA: Math.PI};
const rOut = y => CAB.rb + (CAB.rt - CAB.rb) * (clamp(y, CAB.y0, CAB.y1) - CAB.y0) / (CAB.y1 - CAB.y0), rIn = y => rOut(y) - CAB.wall;
const angD = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const CWIN = [{a: -.25, w: .19, y0: 22.95, y1: 24.0}, {a: .25, w: .19, y0: 22.95, y1: 24.0}, {a: -1.15, w: .15, y0: 23.0, y1: 23.85}, {a: 1.15, w: .15, y0: 23.0, y1: 23.85}];
const CHATCH = {a: Math.PI, w: .3, y0: 22.2, y1: 23.75};
function inReg(R0, a, y, pa = 0, py = 0) { return Math.abs(angD(a, R0.a)) < R0.w + pa && y > R0.y0 - py && y < R0.y1 + py; }
const inWin = (a, y, pa, py) => CWIN.some(w => inReg(w, a, y, pa, py));
// a lathe-like shell r(y) + inset, built quad by quad so window holes can be left out; uv over [a0,a1]x[y0,y1] when uvr is given
function shellGeo(inset, keep, uvr, y0 = CAB.y0, y1 = CAB.y1, na = 128, ny = 36) {
  const P = [], N = [], U = [], da = 2 * Math.PI / na, dy = (y1 - y0) / ny, k = -(CAB.rt - CAB.rb) / (CAB.y1 - CAB.y0);
  const pt = (a, y) => { const r = rOut(y) + inset; return [r * Math.sin(a), y, -r * Math.cos(a)]; }, nm = a => { const v = new V3(Math.sin(a), k, -Math.cos(a)).normalize(); return [v.x, v.y, v.z]; };
  const uvf = (a, y) => uvr ? [(angD(a, uvr[0]) ) / (uvr[1] - uvr[0]), (y - uvr[2]) / (uvr[3] - uvr[2])] : [(a + Math.PI) / (2 * Math.PI), (y - y0) / (y1 - y0)];
  for (let j = 0; j < ny; j++) for (let i = 0; i < na; i++) { const a0 = -Math.PI + i * da, a1 = a0 + da, ya = y0 + j * dy, yb = ya + dy; if (!keep((a0 + a1) / 2, (ya + yb) / 2)) continue;
    for (const [a, y] of [[a0, ya], [a1, yb], [a1, ya], [a0, ya], [a0, yb], [a1, yb]]) { P.push(...pt(a, y)); N.push(...nm(a)); U.push(...uvf(a, y)); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); return g; }
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; }
// cabin materials (indoor lighting)
const CM = {};
{ const im = o => interiorMat(new THREE.MeshStandardMaterial(o), INT_CAB);
  // clean white wall panels: colour + normal map with bevelled seams and fasteners (u = around, v = up the cone)
  const PU = 28, PV = 4, W = 2048, H = 512, mk = fn => { const c = document.createElement('canvas'); c.width = W; c.height = H; fn(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t; };
  const col = mk(x => { for (let i = 0; i < PU; i++) for (let j = 0; j < PV; j++) { const lo = j === PV - 1, tone = lo ? 196 : (i * 7 + j * 3) % 9 === 0 ? 218 : 232; x.fillStyle = `rgb(${tone},${tone + 1},${tone + 2})`; x.fillRect(i * W / PU, j * H / PV, W / PU, H / PV); }
    x.fillStyle = '#8e9296'; for (let i = 0; i <= PU; i++) x.fillRect(i * W / PU - 1, 0, 2, H); for (let j = 0; j <= PV; j++) x.fillRect(0, j * H / PV - 1, W, 2);
    x.fillStyle = '#7d8185'; for (let i = 0; i < PU; i++) for (let j = 0; j < PV; j++) for (const [u, v] of [[.12, .14], [.88, .14], [.12, .86], [.88, .86]]) { x.beginPath(); x.arc((i + u) * W / PU, (j + v) * H / PV, 2.2, 0, 7); x.fill(); } });
  col.colorSpace = THREE.SRGBColorSpace;
  const nrm = mk(x => { x.fillStyle = 'rgb(128,128,255)'; x.fillRect(0, 0, W, H);
    for (let i = 0; i <= PU; i++) { const p = i * W / PU; x.fillStyle = 'rgb(70,128,225)'; x.fillRect(p - 5, 0, 4, H); x.fillStyle = 'rgb(186,128,225)'; x.fillRect(p + 1, 0, 4, H); }
    for (let j = 0; j <= PV; j++) { const p = j * H / PV; x.fillStyle = 'rgb(128,186,225)'; x.fillRect(0, p - 5, W, 4); x.fillStyle = 'rgb(128,70,225)'; x.fillRect(0, p + 1, W, 4); } });
  CM.lining = im({side: THREE.BackSide, roughness: .5, metalness: 0, map: col, normalMap: nrm, normalScale: new THREE.Vector2(1.4, 1.4)});
  CM.floor = im({color: 0x3b3e43, roughness: .8, metalness: .2, map: canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { const v = 130 + Math.random() * 60 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, [6, 6])});
  CM.trim = im({color: 0x8d939b, roughness: .35, metalness: .85}); CM.fabric = im({color: 0x2a2c31, roughness: .92}); CM.fabric2 = im({color: 0xc9ccd1, roughness: .85});
  CM.frame = im({color: 0x9aa0a8, roughness: .32, metalness: .85}); CM.dark = im({color: 0x1d1f23, roughness: .45, metalness: .3}); CM.darkB = im({color: 0x24272c, roughness: .4, metalness: .35, side: THREE.BackSide});
  CM.panel = im({color: 0xe3e5e7, roughness: .45}); CM.console = im({color: 0x26292e, roughness: .38, metalness: .25}); CM.cab = im({color: 0xd4d7da, roughness: .4, side: THREE.BackSide});
  CM.rail = im({color: 0xb8bec6, roughness: .3, metalness: .7}); CM.red = im({color: 0xc2302a, roughness: .35});
  CM.led = new THREE.MeshBasicMaterial({color: new THREE.Color(2.2, 2.05, 1.8)}); CM.ledDim = new THREE.MeshBasicMaterial({color: new THREE.Color(.9, .85, .75)});
  CM.lamp = new THREE.MeshBasicMaterial({vertexColors: false, color: 0xffffff});
  CM.glass = new THREE.MeshStandardMaterial({color: 0x9fb6c8, roughness: .02, metalness: .1, transparent: true, opacity: .1, side: THREE.DoubleSide, depthWrite: false});
  CM.winFrame = new THREE.MeshStandardMaterial({color: 0x2a2d33, roughness: .4, metalness: .7, side: THREE.DoubleSide});
}
// rounded box (bevelled extrusion), centred
function rbox(w, h, d, r) { const b = Math.min(r, d * .45, w * .45, h * .45), iw = w / 2 - b, ih = h / 2 - b, rr = Math.max(.001, Math.min(r - b, iw * .9, ih * .9) + .001), s = new THREE.Shape();
  s.moveTo(-iw + rr, -ih); s.lineTo(iw - rr, -ih); s.quadraticCurveTo(iw, -ih, iw, -ih + rr); s.lineTo(iw, ih - rr); s.quadraticCurveTo(iw, ih, iw - rr, ih); s.lineTo(-iw + rr, ih); s.quadraticCurveTo(-iw, ih, -iw, ih - rr); s.lineTo(-iw, -ih + rr); s.quadraticCurveTo(-iw, -ih, -iw + rr, -ih);
  const g = new THREE.ExtrudeGeometry(s, {depth: Math.max(.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 5}); g.translate(0, 0, -(d - 2 * b) / 2); g.computeVertexNormals(); return g; }
// instanced small parts placed on the cabin wall, facing the centre
function wallParts(geo, mat, list, out) { const m = new THREE.InstancedMesh(geo, mat, list.length), M4 = new THREE.Matrix4(), q = new Q4(), q2 = new Q4(), k = (CAB.rb - CAB.rt) / (CAB.y1 - CAB.y0);
  list.forEach(([a, y, off, tilt, col], i) => { const r = rIn(y) - off, n = new V3(-Math.sin(a), -k, Math.cos(a)).normalize(); q.setFromUnitVectors(new V3(0, 1, 0), n); q2.setFromAxisAngle(new V3(1, 0, 0), tilt || 0); q.multiply(q2);
    M4.compose(new V3(Math.sin(a) * r, y, -Math.cos(a) * r), q, new V3(1, 1, 1)); m.setMatrixAt(i, M4); if (col !== undefined) m.setColorAt(i, new THREE.Color(col)); });
  m.castShadow = true; m.receiveShadow = true; out.add(m); return m; }
const SEATS = [{a: 0, name: 'Pilot', scr: 'tele'}, {a: -1.15, name: 'Navigator', scr: 'orbit'}, {a: 1.15, name: 'Engineer', scr: 'sys'}];
function buildCapsule(g) {
  // outside: heat shield, cone with window holes + frames + glass, nose, docking ring, stripes, RCS blocks, hatch outline
  g.add(cylY(2.53, 2.5, 21.6, 21.85, RM.shield, 64));
  const outer = mesh(shellGeo(0, (a, y) => !inWin(a, y)), RM.cap); g.add(outer);
  const fr = mesh(shellGeo(.012, (a, y) => inWin(a, y, .06, .07) && !inWin(a, y)), RM.black); fr.material = CM.winFrame; g.add(fr);
  const gl = new THREE.Mesh(shellGeo(-.045, (a, y) => inWin(a, y)), CM.glass); gl.renderOrder = 4; g.add(gl);
  const hf = mesh(shellGeo(.01, (a, y) => inReg(CHATCH, a, y, .05, .06) && !inReg(CHATCH, a, y)), RM.black); g.add(hf);
  g.add(mesh(shellGeo(.006, (a, y) => inReg(CHATCH, a, y, -.03, -.05) && y > 22.9 && y < 22.97), RM.grey));
  g.add(cylY(1.0, .95, 25.45, 25.95, RM.white, 48)); g.add(cylY(.78, .75, 25.95, 26.1, RM.grey, 32));
  g.add(mesh(shellGeo(.008, (a, y) => y > 22.15 && y < 22.32), RM.black));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, y = 24.4, r = rOut(y) + .1; const q = mesh(new THREE.BoxGeometry(.24, .3, .24), RM.grey, Math.sin(a) * r, y, -Math.cos(a) * r); q.rotation.y = -a; g.add(q); }
  // inside: clean panelled lining (same holes), window reveals, floor with trim + LED strip, ceiling with LED ring and docking hatch
  const lin = new THREE.Mesh(shellGeo(-CAB.wall, (a, y) => !inWin(a, y) && y > CAB.floor - .05 && y < CAB.ceil + .05), CM.lining); lin.receiveShadow = true; g.add(lin);
  const rv = new THREE.Mesh(shellGeo(-CAB.wall - .006, (a, y) => inWin(a, y, .05, .06) && !inWin(a, y)), CM.darkB); g.add(rv);
  const fl = new THREE.Mesh(new THREE.CircleGeometry(rIn(CAB.floor) - .1, 64), CM.floor); fl.rotation.x = -Math.PI / 2; fl.position.y = CAB.floor; fl.receiveShadow = true; g.add(fl);
  const ft = new THREE.Mesh(new THREE.RingGeometry(rIn(CAB.floor) - .1, rIn(CAB.floor) + .01, 96), CM.trim); ft.rotation.x = -Math.PI / 2; ft.position.y = CAB.floor + .002; ft.receiveShadow = true; g.add(ft);
  const fled = new THREE.Mesh(new THREE.TorusGeometry(rIn(CAB.floor + .06) - .03, .006, 4, 128), CM.ledDim); fled.rotation.x = Math.PI / 2; fled.position.y = CAB.floor + .06; g.add(fled);
  const ce = new THREE.Mesh(new THREE.CircleGeometry(rIn(CAB.ceil) + .01, 48), CM.panel); ce.rotation.x = Math.PI / 2; ce.position.y = CAB.ceil; g.add(ce);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.64, .018, 6, 96), CM.led); ring.rotation.x = Math.PI / 2; ring.position.y = CAB.ceil - .02; g.add(ring);
  const cove = new THREE.Mesh(new THREE.TorusGeometry(rIn(CAB.ceil - .06) - .02, .006, 4, 96), CM.ledDim); cove.rotation.x = Math.PI / 2; cove.position.y = CAB.ceil - .06; g.add(cove);
  { const dh = mesh(new THREE.CylinderGeometry(.44, .44, .05, 48), CM.trim); dh.position.y = CAB.ceil - .03; g.add(dh); const dd = mesh(new THREE.CylinderGeometry(.38, .38, .06, 48), CM.panel); dd.position.y = CAB.ceil - .04; g.add(dd);
    const wh = mesh(new THREE.TorusGeometry(.14, .012, 8, 32), CM.frame); wh.rotation.x = Math.PI / 2; wh.position.y = CAB.ceil - .08; g.add(wh); }
  // handrails: ring under the ceiling, verticals by the hatch
  const hr = mesh(new THREE.TorusGeometry(rIn(24.6) - .1, .018, 8, 96), CM.rail); hr.rotation.x = Math.PI / 2; hr.position.y = 24.6; g.add(hr);
  for (const s of [-1, 1]) { const a = CAB.hatchA + s * .4, r = rIn(23) - .07; g.add(mesh(new THREE.CylinderGeometry(.016, .016, 1.3, 10), CM.rail, Math.sin(a) * r, 23, -Math.cos(a) * r)); }
  // overhead panel: dark satin band with real toggle switches, guards and status lights
  g.add(new THREE.Mesh(shellGeo(-CAB.wall - .012, (a, y) => Math.abs(a) < 1.45 && y > 24.18 && y < 24.82), CM.darkB));
  { const tg = [], gd = [], ld = []; for (const y of [24.32, 24.5, 24.68]) for (let a = -1.32; a <= 1.32; a += .055) { if (((a + 1.32) / .055 | 0) % 9 === 8) continue; const up = Math.sin(a * 37 + y * 11) > 0;
      tg.push([a, y, .028, up ? .45 : -.45]); gd.push([a, y, .016, 0]); if (((a * 100 | 0) + y * 10 | 0) % 3 === 0) ld.push([a + .022, y + .05, .016, 0, [0x2bd46a, 0xffb02e, 0x2bd46a, 0x3aa0ff][(a * 50 | 0) & 3]]); }
    wallParts(new THREE.CylinderGeometry(.0045, .006, .032, 8), CM.frame, tg, g); wallParts(new THREE.BoxGeometry(.024, .006, .036), CM.dark, gd, g);
    wallParts(new THREE.SphereGeometry(.006, 8, 6), new THREE.MeshBasicMaterial({color: 0xffffff}), ld, g); }
  // inner hatch door with handle
  g.add(new THREE.Mesh(shellGeo(-CAB.wall - .02, (a, y) => inReg(CHATCH, a, y), [CHATCH.a - CHATCH.w, CHATCH.a + CHATCH.w, CHATCH.y0, CHATCH.y1]), CM.cab));
  { const r = rIn(23) - .08, a = CAB.hatchA; const h = mesh(new THREE.TorusGeometry(.15, .016, 10, 32), CM.frame, Math.sin(a) * r, 23, -Math.cos(a) * r); h.rotation.y = -a; g.add(h); }
  // seats + consoles (rounded, charcoal with light trim and harness)
  const RB = {pan: rbox(.6, .1, .56, .04), back: rbox(.6, .82, .12, .05), head: rbox(.42, .3, .12, .05), bol: rbox(.08, .7, .14, .035), con: rbox(.98, .62, .1, .03), shelf: rbox(.9, .04, .28, .015), strap: new THREE.BoxGeometry(.05, .6, .012)};
  for (const S of SEATS) { const sg = new THREE.Group(); sg.rotation.y = -S.a; g.add(sg); const fy = CAB.floor, rz = -1.0; // seat-local: -z = outward (towards the wall)
    const add = (geo, m, x, y, z, rx = 0) => { const o = mesh(geo, m, x, y, z); o.rotation.x = rx; sg.add(o); return o; };
    add(RB.pan, CM.fabric, 0, fy + .45, rz, -Math.PI / 2); add(RB.back, CM.fabric, 0, fy + .9, rz + .32, -.18); add(RB.head, CM.fabric, 0, fy + 1.47, rz + .4, -.18);
    for (const sx of [-1, 1]) { add(RB.bol, CM.fabric2, sx * .32, fy + .88, rz + .33, -.18); add(RB.strap, CM.dark, sx * .13, fy + .95, rz + .26, -.18); add(new THREE.CylinderGeometry(.022, .022, .5, 10), CM.frame, sx * .26, fy + .22, rz, 0); }
    add(new THREE.CylinderGeometry(.03, .03, .64, 10), CM.frame, 0, fy + .38, rz + .26, 0).rotation.z = Math.PI / 2; add(new THREE.CylinderGeometry(.03, .03, .64, 10), CM.frame, 0, fy + .38, rz - .24, 0).rotation.z = Math.PI / 2;
    // console under the window, tilted to face the seat: glossy display glass and a row of hard buttons
    const cr = -(rIn(22.6) - .34); const c = add(RB.con, CM.console, 0, 22.55, cr, -.75);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(.78, .44), screenGlass(S.scr, 1.6)); sc.position.set(0, .05, .051); c.add(sc);
    for (let b = 0; b < 8; b++) { const k = mesh(new THREE.CylinderGeometry(.018, .018, .02, 14), b === 7 ? CM.red : CM.frame, -.35 + b * .1, -.25, .055); k.rotation.x = Math.PI / 2; c.add(k); }
    add(RB.shelf, CM.trim, 0, 22.3, cr + .25); S.pos = new V3(Math.sin(S.a) * .8, fy, -Math.cos(S.a) * .8); }
  // flush stowage cabinets either side of the hatch, with recessed handles
  for (const s of [-1, 1]) for (const [y0, y1] of [[22.25, 22.85], [22.95, 23.55]]) { const a0 = CAB.hatchA + s * .5, a1 = CAB.hatchA + s * 1.0, lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    g.add(new THREE.Mesh(shellGeo(-CAB.wall - .014, (a, y) => { const d = angD(a, 0) < 0 ? angD(a, 0) + 2 * Math.PI : angD(a, 0); const aa = a < 0 ? a + 2 * Math.PI : a; return aa > lo && aa < hi && y > y0 && y < y1; }), CM.cab));
    const am = (a0 + a1) / 2, r = rIn((y0 + y1) / 2) - .03; const hd = mesh(new THREE.BoxGeometry(.16, .025, .02), CM.dark, Math.sin(am) * r, (y0 + y1) / 2, -Math.cos(am) * r); hd.rotation.y = -am; g.add(hd); }
  { const a = CAB.hatchA - .38, r = rIn(22.3) - .12; g.add(mesh(new THREE.CylinderGeometry(.07, .07, .45, 16), CM.red, Math.sin(a) * r, 22.35, -Math.cos(a) * r)); g.add(mesh(new THREE.CylinderGeometry(.03, .03, .08, 12), CM.dark, Math.sin(a) * r, 22.62, -Math.cos(a) * r)); } // extinguisher
  // parachute (hidden until it opens)
  const ch = new THREE.Group(); ch.position.y = 26.1; const can = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 10, 0, Math.PI * 2, 0, 1.25), RM.chute); can.position.y = 15; can.castShadow = true; ch.add(can);
  const lp = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = 10 * Math.sin(1.25); lp.push(0, 0, 0, Math.cos(a) * rr, 15 + 10 * Math.cos(1.25), Math.sin(a) * rr); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); ch.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({color: 0x9a9a9a})));
  ch.visible = false; g.add(ch); g.userData.chute = ch;
}
const cabL = new THREE.PointLight(0xfff0dc, 0, 7, 2); scene.add(cabL); // cabin light (always in the scene)

// ---------------- live screens (canvas textures shared by the cabin and mission control)
const SCR = {}, HIST = []; let scrT = 0, histT = 0;
function scr(name) { if (SCR[name]) return SCR[name]; const big = name === 'map', c = document.createElement('canvas'); c.width = big ? 1024 : 512; c.height = big ? 512 : 256;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; const s = SCR[name] = {c, x: c.getContext('2d'), t, w: c.width, h: c.height, mats: {}, drawn: false}; return s; }
function screenGlass(name, k = 1.5) { const s = scr(name), key = 'g' + k; return s.mats[key] || (s.mats[key] = interiorMat(new THREE.MeshStandardMaterial({color: 0x030405, roughness: .1, metalness: 0, emissive: 0xffffff, emissiveMap: s.t, emissiveIntensity: k}), INT_CAB)); } // glossy display glass
function screenMat(name, k = 1.5) { const s = scr(name); return s.mats[k] || (s.mats[k] = new THREE.MeshBasicMaterial({map: s.t, color: new THREE.Color(k, k, k)})); }
function scrBg(s, title, col = '#7fd4ff') { const x = s.x; x.fillStyle = '#050c18'; x.fillRect(0, 0, s.w, s.h); x.strokeStyle = 'rgba(80,140,200,.12)'; x.lineWidth = 1;
  for (let i = 0; i < s.w; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, s.h); x.stroke(); } for (let i = 0; i < s.h; i += 32) { x.beginPath(); x.moveTo(0, i); x.lineTo(s.w, i); x.stroke(); }
  x.fillStyle = '#0d1f38'; x.fillRect(0, 0, s.w, 30); x.fillStyle = col; x.font = '600 18px monospace'; x.textBaseline = 'middle'; x.textAlign = 'left'; x.fillText(title, 10, 15);
  x.textAlign = 'right'; x.fillStyle = '#ffcf4a'; x.fillText('YESHIP', s.w - 10, 15); x.textAlign = 'left'; }
const fmtT = s => { s = Math.max(0, s | 0); return String(s / 3600 | 0).padStart(2, '0') + ':' + String((s / 60 | 0) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function situation(b, alt, o) { return R.st === 'pad' ? 'ON THE PAD' : R.st === 'landed' ? 'LANDED' : R.st === 'dead' ? 'VEHICLE LOST' : o.pe > (b === PLANET ? PLANET.atmo : 2000) ? 'IN ORBIT' : alt < 20000 && b === PLANET ? 'FLYING' : 'SUBORBITAL'; }
const DRAW = {
  tele(s) { scrBg(s, 'FLIGHT DYNAMICS'); const x = s.x, b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, o = orbitOf(b), v = relVel(new V3()).length();
    const rows = [['MET', R.t0 ? 'T+' + fmtT(G.t - R.t0) : 'T- HOLD'], ['ALT', fmtD(alt)], ['VEL', Math.round(v) + ' m/s'], ['AP', o.ap === Infinity ? 'ESCAPE' : fmtD(o.ap)], ['PE', o.pe < -b.R * .5 ? '--' : fmtD(o.pe)], ['STAGE', STAGES[R.bot].name.toUpperCase()], ['THR', Math.round(R.thr * 100) + '%'], ['BODY', b.name.toUpperCase()]];
    x.font = '600 21px monospace'; rows.forEach(([k, v2], i) => { const cx = i < 4 ? 14 : 270, cy = 62 + (i % 4) * 46; x.fillStyle = '#5c8fbf'; x.fillText(k, cx, cy); x.fillStyle = '#eaf4ff'; x.fillText(v2, cx + 76, cy); });
    x.fillStyle = R.st === 'dead' ? '#ff5a4a' : '#5fd38a'; x.font = '600 16px monospace'; x.fillText(situation(b, alt, o), 14, s.h - 14); },
  orbit(s) { scrBg(s, 'TRAJECTORY'); const x = s.x, b = domBody(R.pos), mu = b.GM, rr = R.pos.clone().sub(b.c), vv = R.vel.clone(); if (b === MOON) vv.sub(moonVel(G.t, new V3()));
    const hv = rr.clone().cross(vv), p = hv.lengthSq() / mu, ev = vv.clone().cross(hv).multiplyScalar(1 / mu).sub(rr.clone().normalize()), e = ev.length(), o = orbitOf(b);
    const ex = e > 1e-4 ? ev.clone().normalize() : rr.clone().normalize(), ey = hv.clone().cross(ex).normalize(), nu = Math.atan2(rr.dot(ey), rr.dot(ex));
    const span = Math.max(b.R * 1.25, Math.min(o.ap === Infinity ? b.R * 4 : o.ap + b.R, b.R * 6)), sc = (s.h - 60) / 2 / span, cx = s.w / 2 + (e < 1 && o.ap !== Infinity ? (o.ap - o.pe) / 2 * sc * .5 : 0), cy = s.h / 2 + 14;
    x.fillStyle = b === PLANET ? '#1d4f7a' : '#6b6b6b'; x.beginPath(); x.arc(cx, cy, b.R * sc, 0, 7); x.fill(); if (b === PLANET) { x.strokeStyle = 'rgba(120,190,255,.5)'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, (b.R + PLANET.atmo) * sc, 0, 7); x.stroke(); }
    x.strokeStyle = '#c8f25a'; x.lineWidth = 2; x.beginPath(); const lim = e < 1 ? Math.PI : Math.acos(-1 / e) - .02; let first = true;
    for (let i = 0; i <= 240; i++) { const th = -lim + 2 * lim * i / 240, r = p / (1 + e * Math.cos(th)); if (r <= 0 || r > span * 3) { first = true; continue; } const px = cx - r * Math.cos(th) * sc, py = cy - r * Math.sin(th) * sc; first ? x.moveTo(px, py) : x.lineTo(px, py); first = false; } x.stroke();
    const r0 = rr.length(); x.fillStyle = '#ffcf4a'; x.beginPath(); x.arc(cx - r0 * Math.cos(nu) * sc, cy - r0 * Math.sin(nu) * sc, 5, 0, 7); x.fill();
    x.font = '15px monospace'; x.fillStyle = '#9fd0ff'; x.fillText('AP ' + (o.ap === Infinity ? 'ESC' : fmtD(o.ap)), 12, s.h - 34); x.fillText('PE ' + (o.pe < -b.R * .5 ? '--' : fmtD(o.pe)), 12, s.h - 14); x.textAlign = 'right'; x.fillText(b.name.toUpperCase(), s.w - 12, s.h - 14); x.textAlign = 'left'; },
  sys(s) { scrBg(s, 'SYSTEMS', '#ffb347'); const x = s.x; x.font = '15px monospace';
    STAGES.forEach((S, i) => { const y = 50 + i * 36, f = i < R.bot ? 0 : S.fuel ? R.fuel[i] / S.fuel : 0; x.fillStyle = i < R.bot ? '#4a5563' : '#cfe3f7'; x.fillText(S.name.toUpperCase(), 12, y + 10);
      x.fillStyle = '#132640'; x.fillRect(170, y, 220, 18); if (S.fuel) { x.fillStyle = f < .15 ? '#ff6a4a' : '#5fd38a'; x.fillRect(170, y, 220 * f, 18); } else { x.fillStyle = '#5c8fbf'; x.fillText(i < R.bot ? 'SEP' : 'NO FUEL', 176, y + 10); }
      x.fillStyle = '#9fd0ff'; x.fillText(i < R.bot ? 'SEP' : i === R.bot ? (R.F > 0 ? 'BURN' : 'IDLE') : 'ATT', 404, y + 10); });
    x.fillStyle = '#5c8fbf'; x.fillText('THROTTLE', 12, 170); x.fillStyle = '#132640'; x.fillRect(170, 160, 220, 18); x.fillStyle = '#ffcf4a'; x.fillRect(170, 160, 220 * R.thr, 18);
    x.fillStyle = '#5c8fbf'; x.fillText('SAS', 12, 200); x.fillStyle = '#eaf4ff'; x.fillText(R.sas.toUpperCase(), 170, 200); x.fillStyle = '#5c8fbf'; x.fillText('CHUTE', 12, 226); x.fillStyle = '#eaf4ff'; x.fillText(['STOWED', 'ARMED', 'OPEN'][R.chute], 170, 226);
    x.fillStyle = '#5c8fbf'; x.fillText('Q', 300, 200); x.fillStyle = '#eaf4ff'; x.fillText((R.qd / 1000).toFixed(1) + ' kPa', 330, 200); },
  graph(s) { scrBg(s, 'ALTITUDE / VELOCITY'); const x = s.x, n = HIST.length; if (n < 2) { x.fillStyle = '#5c8fbf'; x.font = '16px monospace'; x.fillText('AWAITING LAUNCH', 150, 140); return; }
    let ma = 1, mv = 1; for (const h of HIST) { ma = Math.max(ma, h.a); mv = Math.max(mv, h.v); } const t0 = HIST[0].t, t1 = HIST[n - 1].t || 1;
    for (const [key, m, col] of [['a', ma, '#5fd38a'], ['v', mv, '#ffcf4a']]) { x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); HIST.forEach((h, i) => { const px = 30 + (h.t - t0) / Math.max(1, t1 - t0) * (s.w - 50), py = s.h - 20 - h[key] / m * (s.h - 70); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); }
    x.font = '14px monospace'; x.fillStyle = '#5fd38a'; x.fillText('ALT ' + fmtD(HIST[n - 1].a), 30, 48); x.fillStyle = '#ffcf4a'; x.fillText('VEL ' + Math.round(HIST[n - 1].v) + ' m/s', 220, 48); },
  map(s) { const x = s.x, w = s.w, h = s.h; mapBuild(); x.imageSmoothingEnabled = true; x.drawImage(MAPB.c, 0, 0, w, h);
    // night side
    const sb = SUN.clone().applyQuaternion(PLANET.q.clone().invert()); x.fillStyle = 'rgba(0,4,16,.55)';
    for (let i = 0; i < 128; i++) for (let j = 0; j < 64; j++) { const lon = (i + .5) / 128 * 2 * Math.PI - Math.PI, lat = Math.PI / 2 - (j + .5) / 64 * Math.PI, d = Math.cos(lat) * Math.cos(lon) * sb.x + Math.sin(lat) * sb.y - Math.cos(lat) * Math.sin(lon) * sb.z;
      if (d < .05) { x.globalAlpha = Math.min(1, (.05 - d) * 6); x.fillRect(i * w / 128, j * h / 64, w / 128 + 1, h / 64 + 1); } } x.globalAlpha = 1;
    x.strokeStyle = 'rgba(160,210,255,.18)'; x.lineWidth = 1; for (let i = 0; i <= 12; i++) { x.beginPath(); x.moveTo(i * w / 12, 0); x.lineTo(i * w / 12, h); x.stroke(); } for (let j = 0; j <= 6; j++) { x.beginPath(); x.moveTo(0, j * h / 6); x.lineTo(w, j * h / 6); x.stroke(); }
    x.fillStyle = '#ffcf4a'; x.beginPath(); x.moveTo(w / 2, h / 2 - 9); x.lineTo(w / 2 + 7, h / 2 + 5); x.lineTo(w / 2 - 7, h / 2 + 5); x.fill(); // space centre
    x.strokeStyle = '#c8f25a'; x.lineWidth = 3; x.beginPath(); let px0 = null; for (const p of HIST) { if (p.lon === undefined) { px0 = null; continue; } const px = (p.lon / (2 * Math.PI) + .5) * w, py = (.5 - p.lat / Math.PI) * h; if (px0 === null || Math.abs(px - px0) > w / 2) x.moveTo(px, py); else x.lineTo(px, py); px0 = px; } x.stroke();
    const ll = latLon(R.pos); if (ll) { const px = (ll[1] / (2 * Math.PI) + .5) * w, py = (.5 - ll[0] / Math.PI) * h; x.fillStyle = '#ffffff'; x.beginPath(); x.arc(px, py, 7 + 2 * Math.sin(G.t * 4), 0, 7); x.fill(); }
    x.fillStyle = 'rgba(5,12,24,.7)'; x.fillRect(0, 0, w, 40); x.fillStyle = '#7fd4ff'; x.font = '600 22px monospace'; x.fillText('GROUND TRACK · ' + PLANET.name.toUpperCase(), 14, 20); x.textAlign = 'right'; x.fillStyle = '#ffcf4a'; x.fillText('LOCAL ' + localTime(), w - 14, 20); x.textAlign = 'left'; },
  code(s) { if (s.drawn) return; scrBg(s, 'GUIDANCE', '#5fd38a'); const x = s.x; x.font = '13px monospace'; x.fillStyle = '#3fbf6a'; let r = 9; for (let i = 0; i < 13; i++) { let l = ''; for (let k = 0; k < 6; k++) { r = (r * 16807) % 2147483647; l += (r % 65536).toString(16).padStart(4, '0') + ' '; } x.fillText(l, 12, 50 + i * 15); } },
  wx(s) { if (s.drawn) return; scrBg(s, 'WEATHER'); const x = s.x; for (let i = 0; i < 40; i++) { const px = (i * 131) % s.w, py = 40 + (i * 71) % (s.h - 50), r = 10 + (i * 13) % 30; const g = x.createRadialGradient(px, py, 1, px, py, r); g.addColorStop(0, i % 5 ? 'rgba(95,211,138,.6)' : 'rgba(255,207,74,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
    x.fillStyle = '#eaf4ff'; x.font = '15px monospace'; x.fillText('WIND 4 m/s E   VIS 30 km   GO', 12, s.h - 14); },
  net(s) { scrBg(s, 'GO / NO-GO'); const x = s.x, L = ['BOOSTER', 'GUIDANCE', 'NAV', 'SYSTEMS', 'COMMS', 'WEATHER', 'RECOVERY', 'RANGE', 'CAPCOM', 'FLIGHT']; x.font = '600 16px monospace';
    L.forEach((n, i) => { const cx = 14 + (i % 2) * 250, cy = 52 + (i >> 1) * 40; x.fillStyle = '#132640'; x.fillRect(cx, cy - 13, 230, 28); x.fillStyle = '#cfe3f7'; x.fillText(n, cx + 8, cy + 1); const ok = R.st !== 'dead'; x.fillStyle = ok ? '#5fd38a' : '#ff5a4a'; x.fillText(ok ? 'GO' : 'NO GO', cx + 170, cy + 1); }); },
};
function latLon(p) { if (domBody(p) !== PLANET) return null; const d = p.clone().applyQuaternion(PLANET.q.clone().invert()).normalize(); return [Math.asin(d.y), Math.atan2(-d.z, d.x)]; }
const MAPB = {row: 0}; // planet map baked a row at a time (heightAt is slow)
function mapBuild() { if (!MAPB.c) { MAPB.c = document.createElement('canvas'); MAPB.c.width = 256; MAPB.c.height = 128; MAPB.x = MAPB.c.getContext('2d'); MAPB.x.fillStyle = '#0b2440'; MAPB.x.fillRect(0, 0, 256, 128); MAPB.im = MAPB.x.createImageData(256, 1); }
  for (let n = 0; n < 2 && MAPB.row < 128; n++, MAPB.row++) { const j = MAPB.row, lat = Math.PI / 2 - (j + .5) / 128 * Math.PI, d = MAPB.im.data;
    for (let i = 0; i < 256; i++) { const lon = (i + .5) / 256 * 2 * Math.PI - Math.PI, cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = -Math.cos(lat) * Math.sin(lon), h = heightAt(PLANET, cx, cy, cz);
      let c; if (h < 0) { const k = clamp(-h / 2500, 0, 1); c = [14 - 6 * k, 58 - 26 * k, 98 - 36 * k]; } else if (h > 3300) c = [225, 230, 235]; else { const k = clamp(h / 3000, 0, 1); c = [62 + 70 * k, 104 - 10 * k, 54 + 20 * k]; }
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; } MAPB.x.putImageData(MAPB.im, 0, j); } }
const MC_P = new V3(); // mission control centre (body-fixed), set at boot
function updateScreens(dt) {
  if (R.st === 'fly' && (histT -= dt * G.warp) <= 0) { histT = Math.max(1, G.warp); const b = domBody(R.pos), ll = latLon(R.pos); HIST.push({t: G.t, a: R.pos.distanceTo(b.c) - b.R, v: relVel(new V3()).length(), lat: ll && ll[0], lon: ll && ll[1]}); if (HIST.length > 1500) HIST.shift(); }
  const nearMC = !R.on && P.body === PLANET && P.pos.distanceTo(MC_P) < 120; if (!(R.on && C.in) && !nearMC) return; if (nearMC && MAPB.row < 128) { mapBuild(); if (MAPB.tex && MAPB.row % 8 === 0) MAPB.tex.needsUpdate = true; }
  if ((scrT -= dt) > 0) return; scrT = .35;
  for (const k in SCR) { if (!nearMC && !['tele', 'orbit', 'sys'].includes(k)) continue; if (DRAW[k]) { DRAW[k](SCR[k]); if (!SCR[k].drawn || !['code', 'wx'].includes(k)) SCR[k].t.needsUpdate = true; SCR[k].drawn = true; } }
}

// ---------------- crew in the cabin: walk (floor = local -y), float in zero-g, sit at a station
const C = {in: false, seat: -1, view: 'in', pos: new V3(0, CAB.floor, 0), vel: new V3(), yaw: 0, pitch: 0, ground: false};
const _cq = new Q4(), _cq2 = new Q4(), _cx = new V3(1, 0, 0), _cy = new V3(0, 1, 0);
function cabinStep(dt) {
  const sens = .0022; C.yaw -= look.dx * sens; C.pitch = clamp(C.pitch - look.dy * sens, -1.45, 1.45); look.dx = look.dy = 0;
  if (C.seat >= 0) { const s = SEATS[C.seat]; C.yaw = -s.a + clamp(angD(C.yaw, -s.a), -1.7, 1.7); return; }
  const gy = R.st === 'dead' ? 0 : R.felt.y, grav = gy > .6, fw = new V3(-Math.sin(C.yaw), 0, -Math.cos(C.yaw)), rt = new V3(Math.cos(C.yaw), 0, -Math.sin(C.yaw)), wish = new V3();
  if (keys.KeyW) wish.add(fw); if (keys.KeyS) wish.sub(fw); if (keys.KeyD) wish.add(rt); if (keys.KeyA) wish.sub(rt); if (wish.lengthSq()) wish.normalize();
  if (grav) { const k = C.ground ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 1.5); C.vel.x += (wish.x * 2.2 - C.vel.x) * k; C.vel.z += (wish.z * 2.2 - C.vel.z) * k; C.vel.y -= Math.min(gy, 30) * dt;
    if (C.ground && keys.Space) { C.vel.y = Math.sqrt(2 * Math.min(gy, 30) * .35); C.ground = false; } }
  else { // zero-g: push gently, drift
    const look3 = fw.clone().multiplyScalar(Math.cos(C.pitch)).addScaledVector(_cy, Math.sin(C.pitch)); const push = new V3(); if (keys.KeyW) push.add(look3); if (keys.KeyS) push.sub(look3); if (keys.KeyD) push.add(rt); if (keys.KeyA) push.sub(rt);
    if (keys.Space) push.y += 1; if (keys.ShiftLeft || keys.ShiftRight) push.y -= 1; C.vel.addScaledVector(push, 1.6 * dt).multiplyScalar(Math.exp(-dt * .5)); C.ground = false; }
  C.pos.addScaledVector(C.vel, dt);
  // walls: floor, ceiling, cone (head height is the tight spot)
  C.ground = false; if (C.pos.y < CAB.floor) { C.pos.y = CAB.floor; if (C.vel.y < 0) C.vel.y = grav ? 0 : -C.vel.y * .3; C.ground = grav; }
  if (C.pos.y > CAB.ceil - 1.8) { C.pos.y = CAB.ceil - 1.8; if (C.vel.y > 0) C.vel.y = -C.vel.y * .3; }
  const rmax = Math.min(rIn(C.pos.y + 1.75), rIn(C.pos.y + .3)) - .3, r = Math.hypot(C.pos.x, C.pos.z);
  if (r > rmax) { const nx = C.pos.x / r, nz = C.pos.z / r; C.pos.x = nx * rmax; C.pos.z = nz * rmax; const vo = C.vel.x * nx + C.vel.z * nz; if (vo > 0) { C.vel.x -= nx * vo; C.vel.z -= nz * vo; } }
}
function cabinEye(out) { if (C.seat >= 0) { const s = SEATS[C.seat]; return out.set(Math.sin(s.a) * .9, CAB.floor + 1.25, -Math.cos(s.a) * .9); } return out.copy(C.pos).add(new V3(0, C.ground || R.felt.y > .6 ? 1.62 : .9, 0)); }
function cabinCamera() {
  const e = cabinEye(new V3()); e.y -= R.comY;
  if (R.st === 'fly') { const k = C.seat >= 0 ? .006 : .002; R.clag.lerp(_t2.copy(R.felt).multiplyScalar(-k).clampLength(0, .12), 1 - Math.exp(-G.dt * 4)); e.add(R.clag);
    const rb = (R.F > 0 ? R.thr * (.002 + .01 * R.p) : 0) + Math.min(.012, R.qd / 2e6); if (rb) e.add(_t2.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(rb)); } else R.clag.set(0, 0, 0); G.O.copy(e).applyQuaternion(R.q).add(R.pos);
  cam.quaternion.copy(R.q).multiply(_cq.setFromAxisAngle(_cy, C.yaw)).multiply(_cq2.setFromAxisAngle(_cx, C.pitch)); cam.position.set(0, 0, 0); cam.updateMatrixWorld();
  const l = new V3(0, CAB.ceil - .25 - R.comY, 0).applyQuaternion(R.q).add(R.pos).sub(G.O); cabL.position.copy(l); cabL.intensity = 7;
}
function cabinNear() { // what F would do from here
  if (C.seat >= 0) return {k: 'stand', t: 'F · Get up' + (C.seat === 0 ? ' · V outside view' : '')};
  const p = C.pos; for (let i = 0; i < SEATS.length; i++) { const s = SEATS[i]; if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < .85) return {k: 'sit', i, t: 'F · Sit: ' + s.name + (i === 0 ? ' (fly)' : '')}; }
  const a = Math.atan2(p.x, -p.z); if (Math.hypot(p.x, p.z) > .7 && Math.abs(angD(a, CAB.hatchA)) < .6) return {k: 'hatch', t: R.st === 'fly' ? 'Hatch locked in flight' : 'F · Open hatch'};
  return null; }
function cabinAct() { const n = cabinNear(); if (!n) return;
  if (n.k === 'stand') { const s = SEATS[C.seat]; C.seat = -1; C.view = 'in'; C.pos.set(Math.sin(s.a) * .4, CAB.floor, -Math.cos(s.a) * .4); C.vel.set(0, 0, 0); return; }
  if (n.k === 'sit') { C.seat = n.i; C.yaw = -SEATS[n.i].a; C.pitch = -.05; C.vel.set(0, 0, 0); if (n.i === 0) showHint('Space: ' + (R.st === 'pad' ? 'launch' : 'stage') + ' · W/S A/D steer · Q/E roll · Shift/C throttle · 1-4 autopilot · V outside view', 8000); return; }
  if (n.k === 'hatch' && R.st !== 'fly') getOut(); }
const pilot = () => R.on && C.in && C.seat === 0;

// ---------------- the Moon from afar: colour + slope maps baked from the real moon terrain (a few rows per frame) on a smooth sphere
// Terrain chunks are too coarse beyond ~3000 km, so this sphere takes over there. Lunar lighting: Lommel-Seeliger (why the full moon looks flat and bright to the edge).
const MI = {W: 1024, H: 512, row: 0, ready: false};
MI.mesh = new THREE.Mesh(new THREE.SphereGeometry(MOON.R, 256, 128), new THREE.ShaderMaterial({uniforms: {mC: {value: null}, mN: {value: null}, sunD: {value: SUN}, mRot: {value: new THREE.Matrix3()}},
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vD, vW; void main(){ vD = normalize(position); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D mC, mN; uniform vec3 sunD; uniform mat3 mRot; varying vec3 vD, vW;
void main(){
#include <logdepthbuf_fragment>
  vec3 d = normalize(vD); float lat = asin(clamp(d.y, -1., 1.)), lon = atan(-d.z, d.x); vec2 uv = vec2(lon / 6.2831853 + .5, lat / 3.1415927 + .5);
  vec3 alb = texture2D(mC, uv).rgb; vec2 g = (texture2D(mN, uv).rg - .5) * 2.;
  vec3 e = vec3(-sin(lon), 0., -cos(lon)), nn = vec3(-sin(lat) * cos(lon), cos(lat), sin(lat) * sin(lon));
  vec3 n = normalize(mRot * normalize(d - e * g.x * 1.3 - nn * g.y * 1.3)), v = normalize(-vW);
  float mu0 = max(dot(n, sunD), 0.), mu = max(dot(n, v), 0.), ls = 2. * mu0 / (mu0 + mu + 1e-4);
  float shade = mix(mu0, ls * smoothstep(0., .08, dot(normalize(mRot * d), sunD) + .02), .72);
  gl_FragColor = vec4(alb * (3.4 / 3.14159) * shade * .9 + alb * .0015, 1.); }`}));
MI.mesh.visible = false; MI.mesh.frustumCulled = false; scene.add(MI.mesh);
function moonBake(budget) {
  if (MI.ready) return; const t0 = performance.now(), W = MI.W, H = MI.H;
  if (!MI.col) { MI.col = new Uint8Array(W * H * 4); MI.h = new Float32Array(W * H); }
  while (MI.row < H && performance.now() - t0 < budget) { const j = MI.row, lat = -Math.PI / 2 + (j + .5) / H * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    CR_NEAR = CRATERS.filter(c => Math.abs(Math.asin(c.d.y) - lat) < c.r * 2.3 / MOON.R + .01);
    for (let i = 0; i < W; i++) { const lon = -Math.PI + (i + .5) / W * 2 * Math.PI, x = cl * Math.cos(lon), y = sl, z = -cl * Math.sin(lon), h = heightAt(MOON, x, y, z); MI.h[j * W + i] = h;
      const c = colorAt(MOON, x, y, z, h, 0), o = (j * W + i) * 4; MI.col[o] = Math.pow(c.r, 1 / 2.2) * 255; MI.col[o + 1] = Math.pow(c.g, 1 / 2.2) * 255; MI.col[o + 2] = Math.pow(c.b, 1 / 2.2) * 255; MI.col[o + 3] = 255; }
    CR_NEAR = null; MI.row++; }
  if (MI.row < H) return;
  const n = new Uint8Array(W * H * 4), latM = Math.PI * MOON.R / H;
  for (let j = 0; j < H; j++) { const lonM = Math.max(200, 2 * Math.PI * MOON.R * Math.cos(-Math.PI / 2 + (j + .5) / H * Math.PI) / W);
    for (let i = 0; i < W; i++) { const gE = (MI.h[j * W + (i + 1) % W] - MI.h[j * W + (i + W - 1) % W]) / (2 * lonM), gN = (MI.h[Math.min(H - 1, j + 1) * W + i] - MI.h[Math.max(0, j - 1) * W + i]) / (2 * latM), o = (j * W + i) * 4;
      n[o] = clamp(gE * .5 + .5, 0, 1) * 255; n[o + 1] = clamp(gN * .5 + .5, 0, 1) * 255; n[o + 3] = 255; } }
  const mk = (data, srgb) => { const t = new THREE.DataTexture(data, W, H); t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  MI.mesh.material.uniforms.mC.value = mk(MI.col, true); MI.mesh.material.uniforms.mN.value = mk(n, false); MI.ready = true; MI.h = null;
}
function moonFar() { moonBake(1.5); const far = MI.ready && G.O.distanceTo(MOON.c) > 3e6; MI.mesh.visible = far; MOON.group.visible = !far;
  if (far) { MI.mesh.position.copy(MOON.c).sub(G.O); MI.mesh.quaternion.copy(MOON.q); MI.mesh.material.uniforms.mRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(MOON.q)); } }

// ---------------- Test menu (` key, or "Test mode" on the main menu): jump straight to any part of the game
function hourNow() { const s = SITE.clone().applyQuaternion(PLANET.q), a = Math.atan2(s.z * SUN.x - s.x * SUN.z, s.x * SUN.x + s.z * SUN.z); return ((12 - a / Math.PI * 12) % 24 + 24) % 24; }
function setHour(h) { G.t += ((h - hourNow()) % 24 + 24) % 24 / 24 * PLANET.day; for (const b of BODIES) bodyState(b, G.t); if (R.st !== 'fly') latch(G.t); }
function clearDebris() { for (const d of R.debris) scene.remove(d.g); R.debris = []; }
function toPilot() { C.in = true; R.on = true; C.seat = 0; C.view = 'in'; C.yaw = 0; C.pitch = -.1; C.pos.copy(SEATS[0].pos); C.vel.set(0, 0, 0); $('cross').classList.add('hidden'); }
function onFoot() { if (R.st === 'fly' || R.st === 'dead') resetRocket(); if (R.on) { R.on = false; C.in = false; C.seat = -1; cabL.intensity = 0; } $('cross').classList.remove('hidden'); G.wi = 0; G.warp = 1; }
function flyFrom(drop) { resetRocket(); R.test = true; R.on = true; stage(); for (let i = 0; i < drop; i++) stage(); clearDebris(); R.st = 'fly'; R.thr = 0; R.t0 = G.t; R.w.set(0, 0, 0); }
const TESTS = {
  pad() { onFoot(); resetRocket(); board(); toPilot(); showHint('On the pad in the Pilot seat. Space to launch', 4000); },
  cabin() { onFoot(); resetRocket(); board(); },
  orbit() { onFoot(); flyFrom(1); const up = SITE.clone().applyQuaternion(PLANET.q), east = new V3(0, 1, 0).cross(up).normalize(), r = PLANET.R + 80000;
    R.pos.copy(up).multiplyScalar(r); R.vel.copy(east).multiplyScalar(Math.sqrt(PLANET.GM / r)); R.q.setFromUnitVectors(new V3(0, 1, 0), east); R.hold.copy(R.q); R.sas = 'pro'; toPilot(); showHint('80 km orbit. Upper stage has fuel. V = outside view', 4000); },
  reentry() { onFoot(); flyFrom(2); const up = SITE.clone().applyQuaternion(PLANET.q).applyAxisAngle(new V3(0, 1, 0), .5), east = new V3(0, 1, 0).cross(up).normalize(), r = PLANET.R + 45000;
    R.pos.copy(up).multiplyScalar(r); R.vel.copy(east).multiplyScalar(2250).addScaledVector(up, -90); R.q.setFromUnitVectors(new V3(0, 1, 0), R.vel.clone().normalize().negate()); R.hold.copy(R.q); R.sas = 'retro'; toPilot(); showHint('Re-entry: Space arms the parachute', 4000); },
  chute() { onFoot(); flyFrom(2); const up = SITE.clone().applyQuaternion(PLANET.q), r = PLANET.R + 3000; R.pos.copy(up).multiplyScalar(r); groundVel(PLANET, R.pos, G.t, R.vel).addScaledVector(up, -120);
    R.q.setFromUnitVectors(new V3(0, 1, 0), up); R.hold.copy(R.q); stage(); toPilot(); C.view = 'out'; showHint('Falling with the parachute armed', 4000); },
  moonOrbit() { onFoot(); flyFrom(1); const d = SUN.clone().addScaledVector(MOON.c.clone().normalize(), -1).normalize(), r = MOON.R + 30000, t = new V3(0, 1, 0).cross(d).normalize();
    R.pos.copy(MOON.c).addScaledVector(d, r); R.vel.copy(moonVel(G.t, new V3())).addScaledVector(t, Math.sqrt(MOON.GM / r)); R.q.setFromUnitVectors(new V3(0, 1, 0), t); R.hold.copy(R.q); R.sas = 'pro'; toPilot(); C.view = 'out'; showHint('30 km over the Moon', 4000); },
  moonLand() { onFoot(); flyFrom(1); const d = SUN.clone().addScaledVector(MOON.c.clone().normalize(), -1).normalize(), r = MOON.R + 9000, t = new V3(0, 1, 0).cross(d).normalize();
    R.pos.copy(MOON.c).addScaledVector(d, r); R.vel.copy(moonVel(G.t, new V3())).addScaledVector(t, 120).addScaledVector(d, -40); R.q.setFromUnitVectors(new V3(0, 1, 0), d); R.hold.copy(R.q); R.sas = 'retro'; toPilot(); C.view = 'out';
    R.fuel[1] = 3000; showHint('9 km over the Moon, falling. Keep 3 (retrograde) on and burn when the Ground readout says BURN NOW', 6000); },
  moonWalk() { onFoot(); const d = SUN.clone().applyQuaternion(MOON.q.clone().invert()).add(new V3(.3, .1, .2)).normalize(); P.body = MOON; P.pos.copy(d).multiplyScalar(MOON.R + heightAt(MOON, d.x, d.y, d.z) + 2); P.vel.set(0, 0, 0);
    P.fwd.set(0, 1, 0).addScaledVector(d, -d.y).normalize(); P.pitch = .1; showHint('On the Moon. Space to hop', 4000); },
  mc() { onFoot(); P.body = PLANET; placeAt(-72.25, .1, 79, 0, 0); showHint('Mission control. Stairs on the left wall go up to the deck', 4000); },
  deck() { onFoot(); P.body = PLANET; placeAt(-88, 6.1, 72, -1.2, -.05); },
  centre() { onFoot(); spawnPlayer(); P.body = PLANET; },
  sunrise() { setHour(6.4); }, noon() { setHour(12); }, sunset() { setHour(17.7); }, night() { setHour(23); },
  fuel() { R.fuel = STAGES.map(s => s.fuel); showHint('Tanks full', 1500); },
  cloudsMore() { CL.cov.value = Math.min(1, CL.cov.value + .15); }, cloudsLess() { CL.cov.value = Math.max(0, CL.cov.value - .15); },
};
function testMenu(show) { const t = $('test'); show = show ?? t.classList.contains('hidden'); t.classList.toggle('hidden', !show); if (show && document.pointerLockElement) document.exitPointerLock(); }
document.querySelectorAll('#test [data-t]').forEach(b => b.onclick = e => { e.stopPropagation(); TESTS[b.dataset.t](); if (!b.dataset.keep) testMenu(false); });
$('testX').onclick = () => testMenu(false);
addEventListener('keydown', e => { if (e.code === 'Backquote' && G.on) testMenu(); });

// hooks for game.js's frame loop
const FLIGHT = {step(dt) { stepThrottle(dt); flightStep(dt); legsStep(dt); if (R.on && C.in) cabinStep(dt); },
  camera(dt) { if (R.st === 'dead' || (C.seat === 0 && C.view === 'out')) { cabL.intensity = 0; flightCamera(dt); } else cabinCamera(); },
  visuals(dt) { flightVisuals(dt); sndUpdate(); updateScreens(dt); moonFar(); },
  hud(dt) { const n = R.st === 'dead' || (C.seat >= 0 && R.st === 'fly') ? null : cabinNear(); $('act').classList.toggle('hidden', !n); if (n) $('act').textContent = n.t; $('cross').classList.toggle('hidden', C.seat >= 0 || C.view === 'out');
    if (C.seat >= 0 || R.st === 'dead') flightHud(dt); else { $('fl').classList.add('hidden'); $('mPro').classList.add('hidden'); $('mRet').classList.add('hidden'); $('mGd').classList.add('hidden'); $('hLoc').textContent = 'In the capsule'; $('hInfo').textContent = R.felt.y > .6 || R.st !== 'fly' ? 'WASD walk · F interact' : 'Weightless · WASD push · Space/Shift up/down'; } },
  hideHud() { document.body.classList.remove('fly'); $('fl').classList.add('hidden'); $('mPro').classList.add('hidden'); $('mRet').classList.add('hidden'); $('mGd').classList.add('hidden'); $('act').classList.add('hidden'); }};
const _bootOrig = boot;
boot = function () { _bootOrig(); $('testPlay').onclick = () => { $('play').click(); setTimeout(() => testMenu(true), 50); }; siteToBody(new V3(-82, 0, 70), MC_P); resetRocket(); R.cam.ref.set(1, 0, 0).applyQuaternion(site.q).applyQuaternion(PLANET.q); };
Object.assign(window.YE, {landCalc, radarAlt, TESTS, testMenu, MI, moonBake, FLIGHT, C, SEATS, cabinAct, CAB, R, STAGES, stage, board, getOut, resetRocket, setWarp, setSas, rocketStep, flightStep, PT, explode});
// boot() is called at the end of mission.js
