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
  {name: 'Booster', dry: 2200, fuel: 15000, thrust: 330000, ispS: 270, ispV: 300, y0: 0, y1: 16.6, exit: .95, hot: 1},
  {name: 'Upper stage', dry: 700, fuel: 3800, thrust: 60000, ispS: 210, ispV: 345, y0: 14.7, y1: 20.4, exit: .7, hot: 0},
  {name: 'Capsule', dry: 1300, fuel: 0, y0: 20.4, y1: 23.6, chute: true},
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
    g.add(cylY(1.25, 1.25, 16.55, 20.4, RM.tank2, 48));
  } else {
    g.add(cylY(1.27, 1.25, 20.4, 20.65, RM.shield, 48)); const cone = cylY(1.22, .56, 20.65, 23.0, RM.cap, 48); g.add(cone);
    g.add(cylY(.56, .5, 23.0, 23.5, RM.white, 32)); g.add(cylY(.5, .2, 23.5, 23.62, RM.grey, 24));
    g.add(cylY(1.235, 1.2, 20.9, 21.05, RM.black, 48)); // stripe
    const slope = Math.atan((1.22 - .56) / 2.35);
    for (const a of [-.32, .32]) { const w = mesh(new THREE.PlaneGeometry(.36, .44), RM.win); const y = 22.05, r = 1.22 + (.56 - 1.22) * (y - 20.65) / 2.35 + .012;
      w.position.set(Math.sin(a) * r, y, -Math.cos(a) * r); w.rotation.order = 'YXZ'; w.rotation.y = Math.PI - a; w.rotation.x = -slope; w.castShadow = false; g.add(w); }
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, y = 22.4, r = 1.22 + (.56 - 1.22) * (y - 20.65) / 2.35; const q = mesh(new THREE.BoxGeometry(.16, .2, .16), RM.grey, Math.sin(a) * r, y, Math.cos(a) * r); g.add(q); }
    // parachute (hidden until it opens)
    const ch = new THREE.Group(); ch.position.y = 23.6; const can = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 10, 0, Math.PI * 2, 0, 1.25), RM.chute); can.position.y = 12; can.castShadow = true; ch.add(can);
    const lp = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = 7 * Math.sin(1.25); lp.push(0, 0, 0, Math.cos(a) * rr, 12 + 7 * Math.cos(1.25), Math.sin(a) * rr); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); ch.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({color: 0x9a9a9a})));
    ch.visible = false; g.add(ch); g.userData.chute = ch;
  }
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
  thr: 1, sas: 'hold', hold: new Q4(), bot: 0, lit: false, fuel: [], chute: 0, chA: 0, comY: 10, F: 0, p: 0, qd: 0, deadT: 0,
  g: new THREE.Group(), inner: new THREE.Group(), sg: [], debris: [],
  cam: {yaw: 1.65, pitch: .12, dist: 48, ref: new V3()}};
R.g.add(R.inner); scene.add(R.g);
const flameL = new THREE.PointLight(0xffa04a, 0, 0, 2); scene.add(flameL); // always in the scene (adding lights later recompiles every material)
const _ry = new Q4().setFromAxisAngle(new V3(0, 1, 0), -Math.PI / 2);
function rocketMass() { let m = 0; for (let i = R.bot; i < STAGES.length; i++) m += STAGES[i].dry + R.fuel[i]; return m; }
function comOf() { let m = 0, my = 0; for (let i = R.bot; i < STAGES.length; i++) { const S = STAGES[i], mi = S.dry + R.fuel[i]; m += mi; my += mi * (S.y0 + S.y1) / 2; } return my / m; }
function resetRocket() {
  for (const g of R.sg) R.inner.remove(g); R.sg = STAGES.map((_, i) => buildStage(i)); for (const g of R.sg) R.inner.add(g);
  R.fuel = STAGES.map(s => s.fuel); R.bot = 0; R.lit = false; R.thr = 1; R.chute = 0; R.chA = 0; R.w.set(0, 0, 0); R.sas = 'hold'; R.st = 'pad'; R.body = PLANET; R.deadT = 0; R.g.visible = true;
  R.comY = comOf(); const pad = site.pads[0]; siteToBody(new V3(pad.x, pad.y + R.comY, pad.z), R.lp); R.lq.copy(site.q).multiply(_ry);
  latch(G.t); R.hold.copy(R.q);
}
function latch(t) { const b = R.body; R.pos.copy(R.lp).applyQuaternion(b.q).add(b.c); R.q.copy(b.q).multiply(R.lq); groundVel(b, R.pos, t, R.vel); }
const _n = new V3(), _a = new V3(), _va = new V3(), _t1 = new V3(), _t2 = new V3(), _qa = new Q4(), _qb = new Q4();
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
  R.bot++; R.vel.addScaledVector(nz, .8); const c0 = R.comY; R.comY = comOf(); R.pos.addScaledVector(nz, R.comY - c0); // keep the parts where they were
  if (R.st !== 'fly') { R.lp.addScaledVector(new V3(0, 1, 0).applyQuaternion(R.lq), R.comY - c0); }
}

// ---------------- physics
function rocketStep(h, t) {
  if (R.st === 'dead') { latch(t); return; } // the wreck point turns with the ground
  const nz = nose(_n), m = rocketMass(), S = STAGES[R.bot];
  const r = R.pos.length(), alt = r - PLANET.R, p = airAt(alt); R.p = p;
  // engine
  R.F = 0; if (R.lit && S.thrust && R.fuel[R.bot] > 0 && R.thr > 0) { const isp = lerp(S.ispV, S.ispS, p); R.F = S.thrust * R.thr * isp / S.ispV; R.fuel[R.bot] = Math.max(0, R.fuel[R.bot] - R.F / (isp * G0) * h); if (R.fuel[R.bot] === 0) { R.lit = false; showHint('Out of fuel. Space: next stage', 3000); } }
  if (R.st !== 'fly') { // held by the pad clamps, or sitting on the ground
    latch(t); const gl = gravAt(R.pos, t, _a).length();
    if (R.F / m > gl * 1.02) { R.st = 'fly'; R.w.set(0, 0, 0); R.hold.copy(R.q); } else return;
  }
  // air
  groundVel(PLANET, R.pos, t, _va); _va.subVectors(R.vel, _va); const vs = _va.length(); const rho = 1.225 * p; R.qd = .5 * rho * vs * vs;
  // parachute: opens when armed, below 9 km and slower than 280 m/s
  if (R.chute === 1 && p > .07 && vs < 280) { R.chute = 2; sfx('chute'); showHint('Parachute open', 2500); R.sg[R.sg.length - 1].userData.chute.visible = true; }
  if (R.chute === 2) { const tg = alt > 1000 ? .07 : 1; R.chA += clamp(tg - R.chA, -h, h / 3); } // drogue high up, full canopy below 1 km
  const cdA = (R.bot === 0 ? 1.9 : R.bot === 1 ? 1.7 : 2.4) + R.chA * 420;
  gravAt(R.pos, t, _a); _a.addScaledVector(nz, R.F / m);
  if (vs > .01 && R.qd > 0) _a.addScaledVector(_va, -R.qd * cdA / (m * vs));
  R.vel.addScaledVector(_a, h); R.pos.addScaledVector(R.vel, h);
  // rotation: player input, else SAS, plus aerodynamic weathervaning
  const ix = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0), iz = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0), iy = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  const mr = .55, wt = _t1.set(0, 0, 0); let free = false;
  if (ix || iy || iz) { wt.set(ix * mr, iy * .8, iz * mr); R.hold.copy(R.q); }
  else if (R.sas === 'off') { wt.copy(R.w); free = true; }
  else if (R.sas === 'hold') { _qa.copy(R.q).invert().multiply(R.hold); if (_qa.w < 0) { _qa.x *= -1; _qa.y *= -1; _qa.z *= -1; _qa.w *= -1; } const s = Math.sqrt(1 - Math.min(1, _qa.w * _qa.w)), ang = 2 * Math.acos(Math.min(1, _qa.w));
    if (s > 1e-6) wt.set(_qa.x / s, _qa.y / s, _qa.z / s).multiplyScalar(Math.min(mr, ang * 2)); }
  else { const d = sasDir(_t2); if (d) { d.applyQuaternion(_qa.copy(R.q).invert()); const ax = new V3(d.z, 0, -d.x), sl = ax.length(), ang = Math.acos(clamp(d.y, -1, 1));
      if (sl > 1e-6) ax.multiplyScalar(Math.min(mr, ang * 2) / sl); else if (d.y < 0) ax.set(mr, 0, 0); wt.copy(ax); wt.y = 0; R.hold.copy(R.q); } }
  const acc = 1.4 * h; for (const k of ['x', 'y', 'z']) R.w[k] += clamp(wt[k] - R.w[k], -acc, acc);
  if (vs > 5 && R.qd > 50) { // fins keep the rocket pointing along the airflow; a lone capsule flies blunt end first
    const vl = _t2.copy(_va).multiplyScalar(1 / vs).applyQuaternion(_qa.copy(R.q).invert()); if (R.bot === STAGES.length - 1) vl.negate();
    const k = (R.chA > .1 ? 3 : 1) * .7 * Math.min(1, R.qd / 25000) * h; R.w.x += vl.z * k; R.w.z -= vl.x * k; if (!free || R.chA > .1) { R.w.x *= 1 - k; R.w.z *= 1 - k; } }
  const wl = R.w.length(); if (wl > 1e-7) { _qb.setFromAxisAngle(_t2.copy(R.w).multiplyScalar(1 / wl), wl * h); R.q.multiply(_qb).normalize(); }
  // ground contact (bottom of the stack)
  for (const b of BODIES) { const rel = _t2.copy(R.pos).sub(b.c); if (rel.length() - b.R > 12000) continue;
    const bot = rel.addScaledVector(nose(_n), -(R.comY - STAGES[R.bot].y0)); const bf = bot.clone().applyQuaternion(_qa.copy(b.q).invert()), gr = groundR(b, bf);
    if (bf.length() >= gr) continue;
    const vg = groundVel(b, R.pos, t, new V3()), sp = R.vel.distanceTo(vg), up = bf.clone().normalize(), tilt = Math.acos(clamp(new V3(0, 1, 0).applyQuaternion(_qa.copy(b.q).invert().multiply(R.q)).dot(up), -1, 1));
    if (sp > 12 || (tilt > .55 && sp > 3) || tilt > 1.1) { explode(); return; }
    // set down upright
    R.body = b; const lq = _qa.copy(b.q).invert().multiply(R.q), ly = new V3(0, 1, 0).applyQuaternion(lq); lq.premultiply(new Q4().setFromUnitVectors(ly, up));
    R.lq.copy(lq); R.lp.copy(up).multiplyScalar(gr + R.comY - STAGES[R.bot].y0); R.st = 'landed'; R.w.set(0, 0, 0); latch(t);
    sfx('thud'); showHint(b === MOON ? 'Landed on the Moon!' : 'Landed. F: get out · Backspace: new rocket', 5000); return; }
}
function sasDir(out) { // inertial direction for the SAS modes
  const b = domBody(R.pos), rel = _t1.copy(R.pos).sub(b.c);
  if (R.sas === 'up') return out.copy(rel).normalize();
  const v = R.sas === 'pro' || R.sas === 'retro' ? relVel(out) : null; if (!v || v.lengthSq() < 1) return null; v.normalize(); return R.sas === 'retro' ? v.negate() : v; }
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
}
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
function respawn() { resetRocket(); if (R.on) { R.on = false; spawnPlayer(); P.body = PLANET; } }

// ---------------- particles: smoke, fire, explosions (camera-relative billboards, premultiplied alpha)
const PN = 2000, PT = {n: 0, head: 0, pos: new Float64Array(PN * 3), vel: new Float32Array(PN * 3), age: new Float32Array(PN), life: new Float32Array(PN), s0: new Float32Array(PN), gr: new Float32Array(PN), heat: new Float32Array(PN), hk: new Float32Array(PN), tone: new Float32Array(PN), drag: new Float32Array(PN), rise: new Float32Array(PN)};
const pGeo = new THREE.InstancedBufferGeometry(); { const pl = new THREE.PlaneGeometry(1, 1); pGeo.index = pl.index; pGeo.setAttribute('position', pl.getAttribute('position')); pGeo.setAttribute('uv', pl.getAttribute('uv')); }
const pAP = new THREE.InstancedBufferAttribute(new Float32Array(PN * 3), 3), pAD = new THREE.InstancedBufferAttribute(new Float32Array(PN * 4), 4); pAP.setUsage(THREE.DynamicDrawUsage); pAD.setUsage(THREE.DynamicDrawUsage);
pGeo.setAttribute('iP', pAP); pGeo.setAttribute('iD', pAD); pGeo.instanceCount = 0;
const pMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: {sunV: {value: new V3()}, sunC: {value: new V3()}, ambC: {value: new V3()}, flP: {value: new V3()}, flC: {value: new V3()}},
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iP; attribute vec4 iD; varying vec2 vUv; varying vec4 vD; varying vec3 vV;
void main(){ vUv = uv; vD = iD; vec4 mv = viewMatrix * vec4(iP, 1.); mv.xy += position.xy * iD.x; vV = mv.xyz; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\n' + GLSL_NOISE + `
uniform vec3 sunV, sunC, ambC, flP, flC; varying vec2 vUv; varying vec4 vD; varying vec3 vV;
void main(){
#include <logdepthbuf_fragment>
  vec2 q = vUv * 2. - 1.; float seed = fract(vD.w * 37.1) * 50.; float n = fbm3(vec3(q * 2.2, seed), 4); float d = dot(q, q) * (1.25 - n * .6);
  if (d > 1.) discard;
  float a = pow(1. - d, 1.6) * vD.y; vec3 N = normalize(vec3(q * 1.2, sqrt(max(0., 1. - d)) + .2));
  float l = clamp(dot(N, sunV) * .6 + .4 + (n - .5) * .5, 0., 1.), tone = floor(vD.w) / 100.;
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
const _pd = [], _pi = new Uint16Array(PN);
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
  const idx = Array.from(_pi.subarray(0, k)); const dd = new Float32Array(PN); for (let a = 0; a < k; a++) dd[_pi[a]] = _pd[a]; idx.sort((a, b) => dd[b] - dd[a]);
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
  G.O.copy(eye); _m.lookAt(eye, tgt, up); cam.quaternion.setFromRotationMatrix(_m); cam.position.set(0, 0, 0); cam.updateMatrixWorld();
}
addEventListener('wheel', e => { if (!G.on || !R.on) return; e.preventDefault(); R.cam.dist = clamp(R.cam.dist * Math.exp(e.deltaY * .0015), 8, 2000); }, {passive: false});

// ---------------- boarding
function canBoard() { if (R.st === 'fly' || R.st === 'dead' || P.body !== R.body) return false; const base = R.lp.clone().addScaledVector(new V3(0, 1, 0).applyQuaternion(R.lq), -(R.comY - STAGES[R.bot].y0));
  const up = base.clone().normalize(), d = P.pos.clone().sub(base); return d.dot(up) < 26 && d.addScaledVector(up, -d.dot(up)).length() < 20; }
function board() { R.on = true; $('cross').classList.add('hidden'); const c = R.cam; c.dist = 48; c.pitch = .05; c.yaw = 1.65; c.ref.set(1, 0, 0).applyQuaternion(site.q).applyQuaternion(PLANET.q); if (R.st !== 'pad') { c.ref.copy(new V3(0, 0, -1).applyQuaternion(R.q)); c.yaw = 0; }
  showHint(R.st === 'pad' ? 'Space: launch · W/S A/D steer · Q/E roll · Shift/C throttle · 1-4 autopilot · drag to look' : 'F: get out · Space: stage', 9000); }
function getOut() { if (R.st === 'fly' || R.st === 'dead') { showHint('Land first to get out', 2000); return; }
  const b = R.body, up = R.lp.clone().normalize(), side = new V3(0, 0, 1).applyQuaternion(R.lq); side.addScaledVector(up, -side.dot(up)).normalize();
  const base = R.lp.clone().addScaledVector(up, -(R.comY - STAGES[R.bot].y0));
  P.body = b; P.pos.copy(base).addScaledVector(side, 7).addScaledVector(up, 1.5); P.vel.set(0, 0, 0); P.fwd.copy(side).negate(); P.pitch = .3; R.on = false; $('cross').classList.remove('hidden');
  showHint(b === MOON ? 'You are on the Moon. WASD walk, Space hop' : 'F at the rocket to get back in', 4000); }

// ---------------- keys
addEventListener('keydown', e => {
  sndInit(); if (!G.on || e.repeat) return; const k = e.code;
  if (k === 'KeyF') { if (R.on) getOut(); else if (canBoard()) board(); }
  if (k === 'Comma' || k === 'BracketLeft') setWarp(G.wi - 1);
  if (k === 'Period' || k === 'BracketRight') setWarp(G.wi + 1);
  if (!R.on) return;
  if (k === 'Space') { e.preventDefault(); stage(); }
  if (k === 'KeyZ') R.thr = 1; if (k === 'KeyX') R.thr = 0;
  const modes = {Digit1: 'hold', Digit2: 'pro', Digit3: 'retro', Digit4: 'up', KeyT: R.sas === 'off' ? 'hold' : 'off'}; if (modes[k]) setSas(modes[k]);
  if (k === 'Backspace') { e.preventDefault(); if (R.st !== 'fly') { resetRocket(); showHint('New rocket on the pad', 2500); } }
});
addEventListener('pointerdown', sndInit);
function setSas(m) { R.sas = m; R.hold.copy(R.q); }
function setWarp(i) { let mx = WARPS.length - 1; if (R.on && R.st === 'fly' && (R.F > 0 || R.p > 0 || altAbove() < 12000)) mx = 2; if (!R.on && G.on) mx = 6;
  G.wi = clamp(i, 0, mx); G.warp = WARPS[G.wi]; if (i > mx) showHint(R.on ? 'Faster time needs space, engines off' : 'Max time speed', 2000); }
function stepThrottle(dt) { if (!R.on) return; if (keys.ShiftLeft || keys.ShiftRight) R.thr = Math.min(1, R.thr + dt * .9); if (keys.KeyC) R.thr = Math.max(0, R.thr - dt * .9); }

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
let fhT = 0;
function flightHud(dt) {
  const fl = $('fl'); fl.classList.remove('hidden'); document.body.classList.add('fly'); if ((fhT -= dt) > 0) return markers(); fhT = .1;
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, v = relVel(new V3()).length(), o = orbitOf(b), S = STAGES[R.bot];
  const sit = R.st === 'pad' ? 'On the pad' : R.st === 'landed' ? 'Landed' : R.st === 'dead' ? 'Crashed' : o.pe > (b === PLANET ? PLANET.atmo : 2000) ? 'In orbit' : alt < 20000 && b === PLANET ? 'Flying' : 'Suborbital';
  $('hLoc').textContent = sit + (b === MOON ? ' · Moon' : ''); $('hInfo').textContent = 'Local time ' + localTime() + (G.warp > 1 ? ' · Time ×' + G.warp : '');
  $('fAlt').textContent = fmtD(alt); $('fSpd').textContent = Math.round(v) + ' m/s';
  $('fAp').textContent = o.ap === Infinity ? 'escape' : fmtD(o.ap); $('fPe').textContent = o.pe < -b.R * .5 ? '—' : fmtD(o.pe);
  $('fThr').style.height = (R.thr * 100) + '%'; $('fFuel').style.height = (S.fuel ? R.fuel[R.bot] / S.fuel * 100 : 0) + '%'; $('fStage').textContent = S.name;
  const nx = R.st === 'pad' && !R.lit ? 'Launch' : !R.lit && S.thrust && R.fuel[R.bot] > 0 ? 'Ignite' : R.bot < STAGES.length - 1 ? 'Drop ' + S.name.toLowerCase() : R.chute === 0 ? 'Parachute' : '';
  $('fNext').textContent = nx ? 'Space · ' + nx : ''; for (const el of document.querySelectorAll('#fSas button')) el.classList.toggle('on', el.dataset.m === R.sas);
  markers();
}
function markers() { // prograde / retrograde markers on screen
  const v = relVel(new V3()); const show = v.length() > 3 && R.st === 'fly'; for (const [id, s] of [['mPro', 1], ['mRet', -1]]) { const el = $(id); if (!show) { el.classList.add('hidden'); continue; }
    const p = v.clone().normalize().multiplyScalar(s * 1e4).project(cam); const ok = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; el.classList.toggle('hidden', !ok);
    if (ok) { el.style.left = ((p.x * .5 + .5) * innerWidth) + 'px'; el.style.top = ((-p.y * .5 + .5) * innerHeight) + 'px'; } } }
document.querySelectorAll('#fSas button').forEach(el => el.onclick = e => { e.stopPropagation(); setSas(el.dataset.m); });

// hooks for game.js's frame loop
const FLIGHT = {step(dt) { stepThrottle(dt); flightStep(dt); }, camera: flightCamera, visuals(dt) { flightVisuals(dt); sndUpdate(); }, hud: flightHud, hideHud() { document.body.classList.remove('fly'); $('fl').classList.add('hidden'); $('mPro').classList.add('hidden'); $('mRet').classList.add('hidden'); }};
const _bootOrig = boot;
boot = function () { _bootOrig(); resetRocket(); R.cam.ref.set(1, 0, 0).applyQuaternion(site.q).applyQuaternion(PLANET.q); };
Object.assign(window.YE, {FLIGHT, R, STAGES, stage, board, getOut, resetRocket, setWarp, setSas, rocketStep, flightStep, PT, explode});
boot();
