'use strict';
// Lucas Space Program flight (step 2): starter rocket, flight physics, controls, chase camera, exhaust plume, smoke, sounds, flight HUD.
// Loaded after game.js and shares its top-level names (THREE, V3, Q4, G, P, PLANET, MOON, site, scene, cam, keys, look...). Calls boot() at the end.
const G0 = 9.81, OMEGA = new V3(0, 2 * Math.PI / PLANET.day, 0);
for (const b of SATS) b.soi = b.orbit * Math.pow(b.GM / PLANET.GM, .4); // spheres of influence (Moon ~2400 km)
const SOI_M = MOON.soi;
const P_H = 3500; // air pressure scale height (engines + drag)
function airAt(alt) { return alt > PLANET.atmo ? 0 : Math.exp(-alt / P_H) * (1 - sstep(PLANET.atmo * .7, PLANET.atmo, alt)); } // pressure, 1 = sea level
const WARPS = [1, 2, 4, 10, 50, 100, 1000, 10000, 100000];
G.wi = 0; G.warp = 1;

// moon orbit (matches bodyState in game.js), analytic velocity
const _mp = new V3(), _mv = new V3();
function satPos(b, t, out) { if (b === PLANET) return out.set(0, 0, 0); const a = 2 * Math.PI * t / b.period + b.ph, R0 = b.orbit, cl = Math.cos(b.lan), sl = Math.sin(b.lan), px = Math.cos(a) * R0, py = Math.sin(a) * Math.sin(b.inc) * R0, pz = -Math.sin(a) * Math.cos(b.inc) * R0;
  return out.set(px * cl + pz * sl, py, -px * sl + pz * cl); }
function satVel(b, t, out) { if (b === PLANET) return out.set(0, 0, 0); const a = 2 * Math.PI * t / b.period + b.ph, w = 2 * Math.PI / b.period, R0 = b.orbit, cl = Math.cos(b.lan), sl = Math.sin(b.lan), px = -Math.sin(a) * R0 * w, py = Math.cos(a) * Math.sin(b.inc) * R0 * w, pz = -Math.cos(a) * Math.cos(b.inc) * R0 * w;
  return out.set(px * cl + pz * sl, py, -px * sl + pz * cl); }
function moonPos(t, out) { return satPos(MOON, t, out); }
function moonVel(t, out) { return satVel(MOON, t, out); }
function bodySpin(b) { return b === PLANET ? OMEGA.y : 2 * Math.PI / b.period; } // all spin about inertial +y (satellites are tidally locked)
// velocity of the ground (or air) at inertial point p of body b
function groundVel(b, p, t, out) { const w = bodySpin(b); if (b === PLANET) return out.set(w * p.z, 0, -w * p.x);
  satPos(b, t, _mp); satVel(b, t, out); return out.add(new V3(w * (p.z - _mp.z), 0, -w * (p.x - _mp.x))); }
function gravAt(p, t, out) { const r2 = p.lengthSq(); out.copy(p).multiplyScalar(-PLANET.GM / (r2 * Math.sqrt(r2)));
  for (let i = 0; i < SATS.length; i++) { const b = SATS[i]; satPos(b, t, _mp); const dx = _mp.x - p.x, dy = _mp.y - p.y, dz = _mp.z - p.z, d2 = dx * dx + dy * dy + dz * dz, k = b.GM / (d2 * Math.sqrt(d2)); out.x += dx * k; out.y += dy * k; out.z += dz * k;
    // Home sits still at the origin, so outside a moon's sphere of influence take off the pull Home itself feels toward that moon (the "indirect" term):
    // what's left is the true tide. Without it a moon tugs every Home orbit sideways and Ap / Pe creep by kilometres. Inside the sphere the moon's rails are the frame.
    if (d2 > b.soi * b.soi) { const m2 = _mp.lengthSq(), km = b.GM / (m2 * Math.sqrt(m2)); out.x -= _mp.x * km; out.y -= _mp.y * km; out.z -= _mp.z * km; } } return out; }
function domBody(p) { for (let i = 0; i < SATS.length; i++) if (p.distanceTo(SATS[i].c) < SATS[i].soi) return SATS[i]; return PLANET; }

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
    if (label) { x.save(); x.translate(384 - 10, h * .5); x.rotate(-Math.PI / 2); x.font = '600 74px Archivo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 0, 0); x.restore(); }
    x.fillStyle = '#ff8a1e'; x.fillRect(0, h * .985, 512, h * .015);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  RM.blackDS = RM.black.clone(); RM.blackDS.side = THREE.DoubleSide;
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

// ---------------- parts + ship designs (KSP-style): a design is a list of parts under the capsule, top to bottom.
// Decouplers split it into stages. Radial parts (fins, legs, RCS) are flags on the part they hang from.
// A part can carry side boosters: d.side = {n: 2-4, parts: [...]} (their own little stack, top to bottom). They fire with the stage they hang on and drop first.
// Masses in kg, thrust in N (vacuum), Isp in s, sizes in m (r = radius).
const PARTS = {
  // tanks
  sS: {cat: 'tank', name: 'Mini tank', r: .65, h: 1.2, fuel: 700, desc: '1.3 m wide'},
  sL: {cat: 'tank', name: 'Mini tank L', r: .65, h: 2.6, fuel: 1500, desc: '1.3 m wide, long'},
  sXL: {cat: 'tank', name: 'Mini tank XL', r: .65, h: 5.2, fuel: 3000, desc: '1.3 m wide, extra long'},
  ball: {cat: 'tank', name: 'Ball tank', r: .9, h: 1.8, fuel: 1300, ball: true, desc: 'Round lander tank'},
  tS: {cat: 'tank', name: 'Tank S', r: 1.25, h: 1.25, fuel: 2500, desc: '2.5 m wide, short'},
  tM: {cat: 'tank', name: 'Tank M', r: 1.25, h: 2.5, fuel: 5000, desc: '2.5 m wide'},
  tL: {cat: 'tank', name: 'Tank L', r: 1.25, h: 5, fuel: 10000, desc: '2.5 m wide, long'},
  tXL: {cat: 'tank', name: 'Tank XL', r: 1.25, h: 10, fuel: 20000, desc: '2.5 m wide, extra long'},
  hS: {cat: 'tank', name: 'Heavy tank S', r: 1.9, h: 2, fuel: 9000, desc: '3.8 m wide, short'},
  hM: {cat: 'tank', name: 'Heavy tank', r: 1.9, h: 4, fuel: 18000, desc: '3.8 m wide'},
  hL: {cat: 'tank', name: 'Heavy tank L', r: 1.9, h: 8, fuel: 36000, desc: '3.8 m wide, long'},
  xM: {cat: 'tank', name: 'Mega tank', r: 2.5, h: 5, fuel: 40000, desc: '5 m wide'},
  xL: {cat: 'tank', name: 'Mega tank L', r: 2.5, h: 10, fuel: 80000, desc: '5 m wide, long'},
  // liquid engines (noz: extra nozzles as [x, z] offsets; one bell on the axis when missing)
  ant: {cat: 'engine', name: 'Ant', gim: .14, r: .65, mount: .35, bl: .7, rT: .14, rE: .42, dry: 150, thrust: 25000, ispS: 240, ispV: 330, hot: 0, desc: 'Tiny vacuum engine for landers'},
  cricket: {cat: 'engine', name: 'Cricket', gim: .12, r: .65, mount: .4, bl: .85, rT: .17, rE: .5, dry: 260, thrust: 60000, ispS: 265, ispV: 320, hot: 0, desc: 'Small, punchy lander engine'},
  swift: {cat: 'engine', name: 'Swift', gim: .05, r: 1.25, mount: .45, bl: 1.35, rT: .22, rE: .7, dry: 300, thrust: 80000, ispS: 210, ispV: 345, hot: 0, desc: 'Upper stage engine, best in space'},
  hopper: {cat: 'engine', name: 'Hopper', gim: .1, r: 1.25, mount: .55, bl: 1.6, rT: .26, rE: .8, dry: 400, thrust: 160000, ispS: 250, ispV: 320, hot: 0, desc: 'Strong and efficient: landers, light rockets'},
  spike: {cat: 'engine', name: 'Spike', gim: .06, r: 1.25, mount: .5, bl: 1.2, rT: .3, rE: 1.05, dry: 850, thrust: 200000, ispS: 295, ispV: 335, hot: 0, aero: true, desc: 'Aerospike: good low down and up high'},
  twin: {cat: 'engine', name: 'Twin', gim: .09, r: 1.25, mount: .7, bl: 1.5, rT: .2, rE: .52, dry: 700, thrust: 330000, ispS: 262, ispV: 300, hot: 1, noz: [[-.56, 0], [.56, 0]], desc: 'Two-nozzle booster engine'},
  mule: {cat: 'engine', name: 'Mule', gim: .087, r: 1.25, mount: 1.3, bl: 2.3, rT: .32, rE: .95, dry: 450, thrust: 520000, ispS: 270, ispV: 300, hot: 1, desc: 'Booster engine, made for lift-off'},
  vector: {cat: 'engine', name: 'Vector', gim: .18, r: 1.25, mount: 1.1, bl: 2.2, rT: .3, rE: .9, dry: 1400, thrust: 900000, ispS: 290, ispV: 315, hot: 1, desc: 'Strong, steers hard (big gimbal)'},
  atom: {cat: 'engine', name: 'Atom', gim: .03, r: 1.25, mount: 1.6, bl: 2.4, rT: .22, rE: .75, dry: 2600, thrust: 65000, ispS: 190, ispV: 850, hot: 0, nuke: true, desc: 'Nuclear: amazing in space, weak in air'},
  titan: {cat: 'engine', name: 'Titan', gim: .07, r: 1.9, mount: 1.6, bl: 3, rT: .45, rE: 1.4, dry: 1100, thrust: 1250000, ispS: 275, ispV: 305, hot: 1, desc: 'Huge booster engine, 3.8 m'},
  mammoth: {cat: 'engine', name: 'Mammoth', gim: .06, r: 2.5, mount: 1.8, bl: 2.6, rT: .3, rE: .95, dry: 5200, thrust: 3800000, ispS: 282, ispV: 310, hot: 1, noz: [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]], desc: 'Four-nozzle monster, 5 m'},
  // solid boosters: fuel and nozzle in one; full power until empty, can't be throttled or shut off
  flea: {cat: 'srb', name: 'Flea', r: .65, h: 4.2, bl: .7, rT: .16, rE: .42, fuel: 2800, thrust: 190000, ispS: 200, ispV: 225, gim: 0, hot: 2, desc: 'Small solid booster'},
  hammer: {cat: 'srb', name: 'Hammer', r: .65, h: 8, bl: .8, rT: .18, rE: .46, fuel: 6000, thrust: 310000, ispS: 205, ispV: 230, gim: 0, hot: 2, desc: 'Long solid booster'},
  thumper: {cat: 'srb', name: 'Thumper', r: 1.25, h: 11, bl: 1.3, rT: .3, rE: .8, fuel: 24000, thrust: 950000, ispS: 210, ispV: 235, gim: .02, hot: 2, desc: 'Big solid booster'},
  kraken: {cat: 'srb', name: 'Kraken', r: 1.9, h: 16, bl: 1.9, rT: .45, rE: 1.2, fuel: 76000, thrust: 2700000, ispS: 215, ispV: 240, gim: .03, hot: 2, desc: 'Giant solid booster'},
  // structure
  dec: {cat: 'struct', name: 'Decoupler', r: 0, h: .35, dry: 120, desc: 'Splits stages. Under an engine it becomes an interstage'},
  cone: {cat: 'struct', name: 'Nose cone', r: .65, h: 1.6, dry: 60, nose: true, desc: 'Pointy top for side boosters'},
  coneL: {cat: 'struct', name: 'Nose cone L', r: 1.25, h: 2.6, dry: 150, nose: true, desc: '2.5 m nose cone'},
  coneH: {cat: 'struct', name: 'Nose cone XL', r: 1.9, h: 3.6, dry: 300, nose: true, desc: '3.8 m nose cone'},
  wheel: {cat: 'struct', name: 'Gyro ring', r: 1.25, h: .5, dry: 300, torque: 30000, desc: 'Reaction wheels: turn faster'},
  dock: {cat: 'struct', name: 'Docking port', r: .65, h: .5, dry: 120, desc: 'Docks with stations and other ships'},
  // station parts: a cargo bay carries one module (d.cargo), K lets it go in orbit (station.js)
  bay: {cat: 'cargo', name: 'Cargo bay', r: 1.9, h: 7.6, dry: 1600, desc: 'Carries a station module. K releases it in orbit'},
};
// station modules (meshes + behaviour in station.js). m = mass in kg, L = length along its axis, w = radius, ports: 0 = the back (where it attaches)
const MODULES = {
  hub: {name: 'Core hub', m: 5000, L: 3.4, w: 1.7, desc: 'Six docking ports: the heart of a station'},
  hab: {name: 'Habitat', m: 9000, L: 6.6, w: 1.75, desc: 'Bunks, galley and windows for the crew'},
  lab: {name: 'Science lab', m: 8000, L: 6.2, w: 1.75, desc: 'Experiments inside and out'},
  solar: {name: 'Solar wings', m: 3200, L: 4.4, w: 1.1, desc: 'Two huge solar wings (power for everything)'},
  depot: {name: 'Fuel depot', m: 7000, L: 6.6, w: 1.8, desc: 'Ships that dock get their tanks filled'},
  green: {name: 'Greenhouse', m: 5500, L: 6.2, w: 1.75, desc: 'Plants under glass: fresh food in orbit'},
  cupola: {name: 'Cupola', m: 1900, L: 2.2, w: 1.5, desc: 'Seven windows for the best view in space'},
  tele: {name: 'Space telescope', m: 4200, L: 6.8, w: 1.4, desc: 'Big mirror pointed at the stars'},
};
for (const k in MODULES) MODULES[k].k = k;
for (const k in PARTS) { const p = PARTS[k]; p.k = k; if (p.cat === 'tank') p.dry = Math.round(p.fuel * (p.ball ? .1 : .08) / 10) * 10; if (p.cat === 'srb') p.dry = Math.round(p.fuel * .16 / 10) * 10; if (p.cat === 'engine') p.h = p.mount + p.bl; }
const RADIAL = {fins: {name: 'Fins', dry: 150, desc: 'Keep the nose into the wind low down'}, bigfins: {name: 'Big fins', dry: 320, desc: 'Bigger fins for big rockets'},
  legs: {name: 'Landing legs', dry: 160, desc: 'Land on the Moon. G folds them'}, rcs: {name: 'RCS thrusters', dry: 90, desc: 'Little jets: turn faster'}};
const CAPSULE = {name: 'Capsule', dry: 2200, fuel: 0, y0: 21.6, y1: 26.1, chute: true, cap: true};
const SIDE_PRESETS = { // side booster stacks offered by the builder (top to bottom)
  flea: {name: 'Flea solids', parts: [{k: 'cone'}, {k: 'flea'}]}, hammer: {name: 'Hammer solids', parts: [{k: 'cone'}, {k: 'hammer'}]},
  thumper: {name: 'Thumper solids', parts: [{k: 'coneL'}, {k: 'thumper'}]}, kraken: {name: 'Kraken solids', parts: [{k: 'coneH'}, {k: 'kraken'}]},
  liquid: {name: 'Liquid: Tank L ×2 + Mule', parts: [{k: 'coneL'}, {k: 'tL'}, {k: 'tL'}, {k: 'mule'}]}, liquidXL: {name: 'Liquid: Tank XL ×2 + Vector', parts: [{k: 'coneL'}, {k: 'tXL'}, {k: 'tXL'}, {k: 'vector'}]}};
const SHIP_PRESETS = {
  'Lucas I': [{k: 'tM'}, {k: 'tM', legs: 1}, {k: 'swift'}, {k: 'dec'}, {k: 'tL'}, {k: 'tL', fins: 1}, {k: 'mule'}],
  'Hopper': [{k: 'tL', fins: 1}, {k: 'mule'}],
  'Lander': [{k: 'tM'}, {k: 'tM', legs: 1}, {k: 'hopper'}, {k: 'dec'}, {k: 'tL'}, {k: 'tL'}, {k: 'tL', fins: 1}, {k: 'mule'}],
  'Heavy': [{k: 'tL'}, {k: 'tM', legs: 1}, {k: 'swift'}, {k: 'dec'}, {k: 'hL'}, {k: 'hM', fins: 1}, {k: 'titan'}],
  'Sparrow (solids)': [{k: 'tM'}, {k: 'swift'}, {k: 'dec'}, {k: 'tXL', side: {n: 2, parts: [{k: 'cone'}, {k: 'hammer', fins: 1}]}}, {k: 'tL', fins: 1}, {k: 'mule'}],
  'Atlas Pro': [{k: 'tL'}, {k: 'tM', legs: 1}, {k: 'hopper'}, {k: 'dec'}, {k: 'tXL'}, {k: 'tXL', side: {n: 4, parts: [{k: 'coneL'}, {k: 'thumper', fins: 1}]}}, {k: 'vector'}],
  'Deep Space (nuclear)': [{k: 'tL'}, {k: 'tL', legs: 1}, {k: 'atom'}, {k: 'dec'}, {k: 'hL'}, {k: 'hL', side: {n: 3, parts: [{k: 'coneL'}, {k: 'tXL'}, {k: 'tXL', fins: 1}, {k: 'vector'}]}}, {k: 'titan'}],
  'Mega Lifter': [{k: 'tL'}, {k: 'tL', legs: 1}, {k: 'hopper'}, {k: 'dec'}, {k: 'hL'}, {k: 'swift'}, {k: 'dec'}, {k: 'xL'}, {k: 'xL', bigfins: 1, side: {n: 2, parts: [{k: 'coneH'}, {k: 'kraken', fins: 1}]}}, {k: 'mammoth'}],
};
// paint scheme: base colour, dark accent, trim stripe, pattern and the word down the side (saved with the design)
const PAINT0 = {base: '#f1f0ec', acc: '#17191d', trim: '#ff8a1e', pat: 'roll', text: 'LUCAS', cap: '#dcdfe3'};
const PAINT_PATS = [['roll', 'Roll marks'], ['band', 'Bands'], ['stripe', 'Stripe'], ['check', 'Chequers'], ['plain', 'Plain']];
const SHIP = {name: 'Lucas I', parts: SHIP_PRESETS['Lucas I'].map(p => ({...p})), paint: {...PAINT0}};
const STAGES = []; // filled by shipLayout(), bottom to top; the capsule is always last
const partOk = d => d && PARTS[d.k] && (!d.cargo || MODULES[d.cargo]) && (!d.side || (Array.isArray(d.side.parts) && d.side.parts.every(q => PARTS[q.k])));
const cloneParts = parts => parts.map(p => { const q = {...p}; if (p.side) q.side = {n: p.side.n, parts: p.side.parts.map(s => ({...s}))}; return q; });
function stageEngine(S, it) { // a part that makes thrust becomes the stage's engine when it sits at the bottom of its section
  Object.assign(S, {eng: it, thrust: it.p.thrust, ispS: it.p.ispS, ispV: it.p.ispV, exit: it.p.rE, hot: it.p.hot, plumeY: it.y0, srb: it.p.cat === 'srb', nuke: !!it.p.nuke, noz: it.p.noz || [[0, 0]]}); }
function sumRadial(S, it) { const d = it.d || {}; for (const k in RADIAL) if (d[k]) S.dry += RADIAL[k].dry; if (d.fins || d.bigfins) S.fins = true; if (d.bigfins) S.bigfins = true; if (d.rcs) S.rcs = (S.rcs || 0) + 1;
  if (d.legs) { S.legs = true; it.hinge = Math.min(it.y1 - .3, it.y0 + .95); S.legFoot = Math.min(S.legFoot ?? 1e9, it.hinge - 3.42); } }
function shipLayout(parts) { // places the parts (rocket coords: capsule base at y 21.6, the stack hangs below) and sums up each stage
  const L = [], secs = [[]]; let y = 21.6, prevR = 2.5;
  const radAt = i => { for (let j = i; j < parts.length; j++) { const p = PARTS[parts[j].k]; if (p && p.r) return p.r; } return prevR; };
  if (parts.length) { const r0 = radAt(0), h = clamp(1.2 * (2.5 - r0) / 1.25, .4, 1.7); if (Math.abs(r0 - 2.5) > .01) { secs[0].push({k: 'adapt', rT: 2.5, rB: r0, y0: y - h, y1: y, dry: 100}); y -= h; } prevR = r0; }
  parts.forEach((d, i) => { const p = PARTS[d.k]; if (!p) return; const sec = secs[secs.length - 1];
    if (p.k === 'dec') { const last = sec[sec.length - 1], rB = radAt(i + 1);
      const it = last && last.p && last.p.thrust ? {y1: last.y1, y0: last.y0 - .25, inter: true} : {y1: y, y0: y - p.h};
      const r = Math.max(prevR, it.inter ? rB : 0); secs.push([Object.assign(it, {k: 'dec', p, d, i, r, dry: p.dry})]); y = it.y0; return; }
    if (Math.abs(p.r - prevR) > .01 && !(p.nose && i === 0)) { sec.push({k: 'adapt', rT: prevR, rB: p.r, y0: y - .5, y1: y, dry: 60}); y -= .5; }
    const it = {k: d.k, p, d, i, r: p.r, y0: y - p.h, y1: y, dry: p.dry || 0, fuel: p.fuel || 0}; sec.push(it); y = it.y0; prevR = p.r; L.push(it); });
  const out = [];
  secs.filter(s => s.length).reverse().forEach(sec => { const S = {parts: sec, dry: 0, fuel: 0, y0: Infinity, y1: -Infinity, thrust: 0, legs: false, fins: false, r: 0, torque: 0, warn: []};
    sec.forEach((it, j) => { S.dry += it.dry; S.fuel += it.fuel || 0; S.y0 = Math.min(S.y0, it.y0); S.y1 = Math.max(S.y1, it.y1); S.r = Math.max(S.r, it.r || it.rB || 0); S.torque += (it.p && it.p.torque) || 0; if (it.d) sumRadial(S, it); if (it.p && it.p.k === 'bay') S.cargoM = (S.cargoM || 0) + MODULES[it.d.cargo || 'hab'].m;
      if (it.p && it.p.thrust) { const bottom = j === sec.length - 1; it.blocked = !bottom; if (!bottom) S.warn.push(it.p.name + ' is blocked by the part under it (put a decoupler there)'); else stageEngine(S, it); } });
    if (S.fuel && !S.thrust) S.warn.push('Fuel but no engine'); if (S.thrust && !S.fuel) S.warn.push('Engine but no fuel');
    // side boosters hanging on this stage: their own stage, fired with this one and dropped first
    const at = sec.find(it => it.d && it.d.side && it.d.side.parts && it.d.side.parts.length);
    if (at) out.push(sideStage(at, S));
    out.push(S); });
  const named = out.filter(S => !S.side), n = named.length; named.forEach((S, i) => { S.name = n === 1 ? 'Main stage' : i === 0 ? 'Booster' : i === n - 1 ? 'Upper stage' : 'Stage ' + (i + 1); });
  out.push(Object.assign({}, CAPSULE, {parts: [], r: 2.5, warn: []})); return out;
}
function sideStage(at, core) { const sd = at.d.side, n = clamp(sd.n | 0 || 2, 2, 4), items = []; let y = at.y1, prevR = 0, rs = 0;
  sd.parts.forEach((d, j) => { const p = PARTS[d.k]; if (!p || p.k === 'dec') return; if (prevR && Math.abs(p.r - prevR) > .01) { items.push({k: 'adapt', rT: prevR, rB: p.r, y0: y - .4, y1: y, dry: 40}); y -= .4; }
    const it = {k: d.k, p, d, i: at.i, si: j, r: p.r, y0: y - p.h, y1: y, dry: p.dry || 0, fuel: p.fuel || 0, side: true}; items.push(it); y = it.y0; prevR = p.r; rs = Math.max(rs, p.r); });
  const S = {side: {n, items, off: 0, at: at.i}, parts: [], dry: 0, fuel: 0, y0: Infinity, y1: -Infinity, thrust: 0, legs: false, fins: false, r: 0, torque: 0, warn: [], name: 'Side boosters'};
  items.forEach((it, j) => { S.dry += it.dry; S.fuel += it.fuel; S.y0 = Math.min(S.y0, it.y0); S.y1 = Math.max(S.y1, it.y1); if (it.d) sumRadial(S, it);
    if (it.p && it.p.thrust) { if (j === items.length - 1) stageEngine(S, it); else { it.blocked = true; S.warn.push('Side boosters: ' + it.p.name + ' is blocked (engines go at the bottom)'); } } });
  // sit just outside the widest core part they reach
  let cr = at.r; for (const it of core.parts) if ((it.r || it.rB) && it.y1 > S.y0 && it.y0 < S.y1) cr = Math.max(cr, it.r || it.rB || 0);
  S.side.off = cr + rs + .12; S.side.cr = cr; S.r = S.side.off + rs; S.rs = rs;
  S.dry = (S.dry + 80) * n; S.fuel *= n; if (S.thrust) S.thrust *= n; S.legs = false; // legs only on the core
  S.noz = []; if (S.eng) { const nz = S.eng.p.noz || [[0, 0]]; for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n + (n === 4 ? Math.PI / 4 : 0), ca = Math.cos(a), sa = Math.sin(a); for (const [x, z] of nz) S.noz.push([ca * (S.side.off + x) + sa * z, -sa * (S.side.off + x) + ca * z]); } }
  S.side.ang = k => k * 2 * Math.PI / n + (n === 4 ? Math.PI / 4 : 0);
  if (S.fuel && !S.thrust) S.warn.push('Side boosters have fuel but no engine'); return S; }
function shipApply(parts, name, paint) { SHIP.parts = cloneParts(parts); if (name) SHIP.name = name; if (paint) SHIP.paint = Object.assign({}, PAINT0, paint); STAGES.length = 0; STAGES.push(...shipLayout(SHIP.parts)); applyCapPaint(); }
function applyCapPaint() { if (RM.cap) RM.cap.color.set(SHIP.paint.cap || PAINT0.cap); }
try { const s = JSON.parse(localStorage.getItem('ye-ship') || 'null'); if (s && Array.isArray(s.parts) && s.parts.every(partOk)) { SHIP.name = s.name || 'My rocket'; SHIP.parts = s.parts; if (s.paint) SHIP.paint = Object.assign({}, PAINT0, s.paint); } } catch (e) {}
shipApply(SHIP.parts);

// ---------------- part looks: painted tanks with a matching normal map (panel seams, weld lines, stringers)
const TANKM = {};
function tankMat(h, r, style, paint, kind) { paint = paint || SHIP.paint || PAINT0; const key = h + '|' + r + '|' + style + '|' + (kind || '') + '|' + JSON.stringify(paint); if (TANKM[key]) return TANKM[key];
  const ph = Math.round(clamp(h * 190, 128, 2048)), c = document.createElement('canvas'); c.width = 512; c.height = ph; const x = c.getContext('2d'), srb = kind === 'srb';
  x.fillStyle = paint.base; x.fillRect(0, 0, 512, ph); x.strokeStyle = 'rgba(0,0,0,.07)'; x.lineWidth = 2;
  for (let v = 40; v < ph; v += 85) { x.beginPath(); x.moveTo(0, v); x.lineTo(512, v); x.stroke(); } for (let u = 0; u < 512; u += 64) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, ph); x.stroke(); }
  // a little grime toward the bottom (soot from staging, handling marks)
  const gr = x.createLinearGradient(0, ph * .6, 0, ph); gr.addColorStop(0, 'rgba(40,30,20,0)'); gr.addColorStop(1, 'rgba(40,30,20,.12)'); x.fillStyle = gr; x.fillRect(0, 0, 512, ph);
  x.fillStyle = paint.acc; const bh = Math.min(ph * .14, 70), pat = srb ? 'srb' : paint.pat;
  if (pat === 'roll') { for (let q = 0; q < 4; q++) { if ((q + style) % 2) x.fillRect(q * 128, 0, 128, bh); else x.fillRect(q * 128, ph - bh, 128, bh); } }
  else if (pat === 'band') { x.fillRect(0, ph * .12, 512, bh * .55); x.fillRect(0, ph * .88 - bh * .55, 512, bh * .55); }
  else if (pat === 'stripe') { x.fillRect(224, 0, 64, ph); x.fillStyle = paint.trim; x.fillRect(206, 0, 12, ph); x.fillRect(294, 0, 12, ph); x.fillStyle = paint.acc; }
  else if (pat === 'check') { const s = 64; for (let yy = 0; yy * s < ph; yy++) for (let q = 0; q < 8; q++) if ((q + yy + style) % 2 && (yy < 2 || yy * s > ph - 2 * s)) x.fillRect(q * s, yy * s, s, s); }
  else if (pat === 'srb') { for (let v = ph * .25; v < ph; v += ph * .25) { x.fillStyle = 'rgba(90,96,104,.9)'; x.fillRect(0, v - 6, 512, 12); } x.fillStyle = paint.acc; for (let q = 0; q < 4; q++) if (q % 2) x.fillRect(q * 128, 0, 128, Math.min(ph * .08, 40)); }
  const txt = (paint.text || '').slice(0, 12); if (txt && h >= 4.5 && r > 1 && !srb) { x.save(); x.translate(374, ph * .5); x.rotate(-Math.PI / 2); const fs = Math.min(74, 1500 / Math.max(4, txt.length) * Math.min(1, h / 6)); x.font = '600 ' + fs + 'px Archivo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = paint.acc; x.fillText(txt, 0, 0); x.restore(); }
  x.fillStyle = paint.trim; x.fillRect(0, ph - 6, 512, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return TANKM[key] = new THREE.MeshStandardMaterial({map: t, normalMap: tankNormal(ph, srb), normalScale: new THREE.Vector2(.6, .6), roughness: .36, metalness: .05}); }
const TANKN = {};
function tankNormal(ph, srb) { const key = ph + (srb ? 's' : ''); if (TANKN[key]) return TANKN[key]; // height field -> normals (same UV layout as the paint)
  const W = 256, H = Math.max(64, ph >> 1), hgt = new Float32Array(W * H), at = (i, j) => hgt[((j + H) % H) * W + ((i + W) % W)];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = 0; const yy = j * 2, xx = i * 2;
    if (!srb) { const ds = Math.abs(((yy - 40) % 85 + 85) % 85 - 0); v -= Math.max(0, 1 - Math.min(ds, 85 - ds) / 2.2) * .8; // weld seams (grooves)
      const us = (xx % 64); v += us > 28 && us < 36 ? .35 : 0; } // stringers (low ridges)
    else { const seg = Math.abs(((yy / ph * 4) % 1) - .5); v += seg > .47 ? 1 : 0; }
    hgt[j * W + i] = v + (Math.random() - .5) * .04; }
  const d = new Uint8Array(W * H * 4); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const dx = at(i + 1, j) - at(i - 1, j), dy = at(i, j + 1) - at(i, j - 1), o = (j * W + i) * 4, l = Math.hypot(dx, dy, 1);
    d[o] = (-dx / l * .5 + .5) * 255; d[o + 1] = (dy / l * .5 + .5) * 255; d[o + 2] = (1 / l * .5 + .5) * 255; d[o + 3] = 255; }
  const t = new THREE.DataTexture(d, W, H); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return TANKN[key] = t; }
function legSet(g, it, out) { // four legs: fold up along the tank, swing out for a landing (R.legs)
  const strut = new THREE.CylinderGeometry(.075, .095, 3.4, 10); strut.translate(0, -1.7, 0); const pad = new THREE.CylinderGeometry(.34, .4, .1, 20), knee = new THREE.CylinderGeometry(.04, .04, 1.9, 8); knee.translate(0, -.95, 0);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, base = new THREE.Group(); base.position.set(Math.cos(a) * (it.r + .07), it.hinge, -Math.sin(a) * (it.r + .07)); base.rotation.y = a; g.add(base);
    base.add(mesh(new THREE.BoxGeometry(.22, .34, .3), RM.grey, -.04, 0, 0)); const hinge = new THREE.Group(); hinge.rotation.z = Math.PI - .06; base.add(hinge); hinge.add(mesh(strut, RM.grey)); hinge.add(mesh(pad, RM.black, 0, -3.42, 0));
    const br = mesh(knee, RM.gold, 0, -1.3, 0); br.rotation.z = -.5; hinge.add(br); out.push(hinge); } }
const PGEO = {}; const pgeo = (k, f) => PGEO[k] || (PGEO[k] = f());
function bellSet(g, p, y0, bm) { // one bell per nozzle + a turbopump box each
  const noz = p.noz || [[0, 0]], yb = y0 + p.bl, bg = pgeo('bell' + p.k, () => bellGeo(p.rT, p.rE, p.bl));
  for (const [x, z] of noz) { g.add(mesh(bg, bm, x, y0, z)); const th = cylY(p.rT + .08, p.rT + .08, yb, yb + p.mount * .5, RM.grey, 20); th.position.x = x; th.position.z = z; g.add(th);
    g.add(mesh(pgeo('tp' + p.k, () => new THREE.BoxGeometry(p.rT * 1.5, p.rT * 1.5, p.rT * 1.4)), RM.gold, x + p.rT * 1.4, yb + p.mount * .3, z));
    if (noz.length === 1) { const pipe = mesh(pgeo('pipe' + p.k, () => new THREE.TorusGeometry(p.rT * 1.25, .035, 6, 20)), RM.gold, x, yb + p.mount * .15, z); pipe.rotation.x = Math.PI / 2; g.add(pipe); } } }
function noseGeo(r, h) { const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20, y = t * h; pts.push(new THREE.Vector2(Math.max(.04, r * Math.sqrt(1 - t * t * .96) * (1 - t * t * .1)), y)); } pts.push(new THREE.Vector2(0, h)); return new THREE.LatheGeometry(pts, 40); }
function partMeshes(g, it, si, preview, paint) { // meshes for one placed part (also used by the builder preview and the hangar)
  const p = it.p, r = it.r, pt = paint || (preview && typeof BLD !== 'undefined' && BLD.on ? BLD.paint : SHIP.paint);
  if (it.k === 'adapt') { g.add(cylY(it.rB, it.rT, it.y0, it.y1, RM.white, 64)); g.add(cylY(it.rB + .02, it.rB + .02, it.y0, it.y0 + .15, RM.grey, 48)); return; }
  if (it.k === 'dec') { if (it.inter) { const m = cylY(r, r, it.y0, it.y1, RM.black, 48, true); m.material = RM.blackDS; g.add(m); g.add(cylY(r + .02, r + .02, it.y1 - .25, it.y1, RM.grey, 48)); }
    else { g.add(cylY(r, r, it.y0, it.y1, RM.grey, 48)); g.add(cylY(r + .03, r + .03, it.y0 + .12, it.y1 - .12, RM.gold, 48)); } return; }
  const bmOf = () => { const bm = g.userData.bellM || (g.userData.bellM = preview ? RM.bellM : RM.bellM.clone()); if (!preview) bm.onBeforeCompile = RM.bellM.onBeforeCompile; return bm; };
  if (p.cat === 'tank') {
    if (p.ball) { const s = mesh(pgeo('ball', () => new THREE.SphereGeometry(p.r, 32, 20)), tankMat(1.8, p.r, 0, pt), 0, (it.y0 + it.y1) / 2, 0); g.add(s);
      g.add(cylY(p.r + .03, p.r + .03, (it.y0 + it.y1) / 2 - .06, (it.y0 + it.y1) / 2 + .06, RM.gold, 32));
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, st = cylY(.04, .04, it.y0, it.y1, RM.grey, 6); st.position.x = Math.cos(a) * p.r * .72; st.position.z = Math.sin(a) * p.r * .72; g.add(st); } }
    else { g.add(cylY(r, r, it.y0, it.y1, tankMat(p.h, r, (it.i + si + (it.si || 0)) % 2, pt), 48)); g.add(cylY(r + .02, r + .02, it.y1 - .12, it.y1, RM.grey, 48)); } }
  if (p.cat === 'srb') { const yb = it.y0 + p.bl; g.add(cylY(r, r, yb + .3, it.y1, tankMat(p.h, r, 0, pt, 'srb'), 40)); g.add(cylY(r * .82, r, yb, yb + .3, RM.grey, 40));
    g.add(cylY(r + .02, r + .02, it.y1 - .1, it.y1, RM.grey, 40)); g.add(mesh(pgeo('bell' + p.k, () => bellGeo(p.rT, p.rE, p.bl)), bmOf(), 0, it.y0, 0)); }
  if (p.cat === 'engine') { const bm = bmOf(), yb = it.y0 + p.bl;
    if (p.aero) { // aerospike: a truncated spike with a ring of little combustion chambers
      g.add(mesh(pgeo('spike', () => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(p.rE * (1 - .55 * Math.pow(t, .7)), p.bl * (1 - t))); } pts.push(new THREE.Vector2(0, 0)); return new THREE.LatheGeometry(pts.reverse(), 40); }), bm, 0, it.y0, 0));
      g.add(cylY(p.rE + .05, p.rE + .08, yb - .12, yb + .12, RM.grey, 40)); }
    else bellSet(g, p, it.y0, bm);
    if (p.nuke) { g.add(cylY(.75, .75, yb + p.mount * .3, yb + p.mount * .85, RM.grey, 24)); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, f = mesh(pgeo('rad', () => new THREE.BoxGeometry(.05, p.mount * .5, .5)), RM.gold, Math.cos(a) * .95, yb + p.mount * .58, Math.sin(a) * .95); f.rotation.y = -a; g.add(f); }
      g.add(mesh(pgeo('trefoil', () => new THREE.CylinderGeometry(.18, .18, .02, 3)), RM.black, 0, yb + p.mount * .9, .77)); }
    g.add(cylY((p.noz ? Math.max(...p.noz.map(n => Math.hypot(n[0], n[1]))) : 0) + p.rT + .2, r, yb + p.mount * .5, it.y1, RM.grey, 40)); }
  if (p.cat === 'struct' && p.k !== 'dec') {
    if (p.nose) g.add(mesh(pgeo('nose' + p.k, () => noseGeo(r, p.h)), tankMat(2, r, 1, pt), 0, it.y0, 0));
    else if (p.k === 'wheel') { g.add(cylY(r, r, it.y0, it.y1, RM.grey, 40)); g.add(cylY(r + .03, r + .03, it.y0 + .15, it.y1 - .15, RM.gold, 40)); }
    else if (p.k === 'dock') { g.add(cylY(r, r * .9, it.y0, it.y1 - .12, RM.grey, 32)); g.add(cylY(r * .75, r * .75, it.y1 - .12, it.y1, RM.white, 32));
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3, pe = mesh(pgeo('petal', () => new THREE.BoxGeometry(.18, .32, .06)), RM.gold, Math.cos(a) * r * .62, it.y1 + .1, Math.sin(a) * r * .62); pe.rotation.y = -a + Math.PI / 2; g.add(pe); } } }
  if (p.cat === 'cargo' && typeof bayMeshes === 'function') bayMeshes(g, it, preview, pt);
  const d = it.d || {};
  if (d.fins || d.bigfins) { const fg = pgeo('fin', finGeo), s = clamp(r / 1.25, .6, 1.4) * (d.bigfins ? 1.7 : 1); for (let k = 0; k < 4; k++) { const f = mesh(fg, RM.black); const a = Math.PI / 4 + k * Math.PI / 2; f.scale.setScalar(s); f.position.set(Math.cos(a) * (r - .03), it.y0 + .1, -Math.sin(a) * (r - .03)); f.rotation.y = a; g.add(f); } }
  if (d.legs) legSet(g, it, g.userData.legs || (g.userData.legs = []));
  if (d.rcs) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, q = new THREE.Group(); q.position.set(Math.cos(a) * (r + .1), it.y1 - .45, -Math.sin(a) * (r + .1)); q.rotation.y = a; g.add(q);
    q.add(mesh(pgeo('rcsb', () => new THREE.BoxGeometry(.16, .3, .3)), RM.white)); for (const [dy, dz] of [[.2, 0], [-.2, 0], [0, .2], [0, -.2]]) { const n = mesh(pgeo('rcsn', () => new THREE.CylinderGeometry(.03, .05, .1, 8)), RM.grey, .02, dy, dz); if (dz) n.rotation.x = Math.PI / 2 * Math.sign(dz); else if (dy < 0) n.rotation.z = Math.PI; q.add(n); } }
}
function sideMeshes(g, S, si, preview, paint, tag) { // n copies of the side stack, each in its own group (dropped one by one), with a radial strut
  const sd = S.side, groups = []; if (!preview && !g.userData.bellM) { g.userData.bellM = RM.bellM.clone(); g.userData.bellM.onBeforeCompile = RM.bellM.onBeforeCompile; }
  for (let k = 0; k < sd.n; k++) { const a = sd.ang(k), w = new THREE.Group(); w.rotation.y = a; const b = new THREE.Group(); b.position.x = sd.off; b.userData.bellM = preview ? RM.bellM : g.userData.bellM; w.add(b); g.add(w); groups.push(w);
    for (const it of sd.items) { const n0 = b.children.length; partMeshes(b, it, si, preview, paint); if (tag) for (let c = n0; c < b.children.length; c++) tag(b.children[c], it); }
    b.userData.legs = null;
    const st = mesh(pgeo('strut', () => new THREE.BoxGeometry(.55, .22, .3)), RM.grey, sd.off - S.rs - .06, S.y1 - 1.1, 0); w.add(st); const st2 = st.clone(); st2.position.y = S.y0 + 1.4 + (S.eng ? S.eng.p.bl || 0 : 0); w.add(st2); }
  g.userData.sides = groups; return groups; }
function stageMeshes(g, S, si, preview, paint, tag) { if (S.side) return sideMeshes(g, S, si, preview, paint, tag);
  for (const it of S.parts) { const n0 = g.children.length; partMeshes(g, it, si, preview, paint); if (tag) for (let c = n0; c < g.children.length; c++) tag(g.children[c], it); } }
function plumeSet(g, S, noz) { // a two-layer plume per nozzle, hung below the bells
  const hot = S.hot === 2 ? [[1, .95, .85], [1, .62, .3]] : S.hot ? [[1, .92, .75], [1, .5, .16]] : S.nuke ? [[.75, .85, 1], [.35, .45, 1]] : [[.85, .78, 1], [.45, .4, 1]], L = [];
  for (const [x, z] of noz || S.noz || [[0, 0]]) { const pg = new THREE.Group(); pg.position.set(x, S.plumeY + .05, z);
    const core = new THREE.Mesh(PLUME_GEO, plumeMat(hot[0], hot[1])), outer = new THREE.Mesh(PLUME_GEO, plumeMat(hot[1], S.hot === 2 ? [.95, .45, .15] : S.hot ? [.9, .25, .06] : [.3, .25, .8]));
    core.frustumCulled = outer.frustumCulled = false; core.renderOrder = outer.renderOrder = 5; pg.add(core, outer); g.add(pg); L.push([core, outer]); }
  return L; }
function buildStage(i) {
  const g = new THREE.Group(), S = STAGES[i];
  if (S.cap) buildCapsule(g); else stageMeshes(g, S, i);
  if (S.thrust) { const L = S.side ? g.userData.sides.flatMap(w => plumeSet(w.children[0], S, S.eng.p.noz || [[0, 0]])) : plumeSet(g, S); g.userData.plumes = L; g.userData.plume = L.flat(); }
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
const cargoAt = i => (R.cargoM && R.cargoM[i]) || 0; // station module still in a cargo bay on stage i
function rocketMass() { let m = 0; for (let i = R.bot; i < STAGES.length; i++) m += STAGES[i].dry + R.fuel[i] + cargoAt(i); return m; }
function comOf() { let m = 0, my = 0; for (let i = R.bot; i < STAGES.length; i++) { const S = STAGES[i], mi = S.dry + R.fuel[i] + cargoAt(i); m += mi; my += mi * (S.y0 + S.y1) / 2; } return my / m; }
function resetRocket() {
  for (const g of R.sg) R.inner.remove(g); R.sg = STAGES.map((_, i) => buildStage(i)); for (const g of R.sg) R.inner.add(g);
  R.fuel = STAGES.map(s => s.fuel); R.cargoM = STAGES.map(s => s.cargoM || 0); R.cargoOut = {}; R.bot = 0; R.lit = false; R.thr = 1; R.chute = 0; R.chA = 0; R.w.set(0, 0, 0); R.sas = 'hold'; R.st = 'pad'; R.body = PLANET; R.deadT = 0; R.legs = R.legT = 0; R.warpTo = 0; R.spool = 0; R.inp.set(0, 0, 0); R.test = false; R.legManual = false; R.lowB = -1; R.askT = 0; R.g.visible = true; R.t0 = 0; HIST.length = 0;
  R.comY = comOf(); const pad = site.pads[0]; siteToBody(new V3(pad.x, pad.y + R.comY - lowY(0), pad.z), R.lp); R.lq.copy(site.q).multiply(_ry);
  latch(G.t); R.hold.copy(R.q);
}
function latch(t) { const b = R.body; R.pos.copy(R.lp).applyQuaternion(b.q).add(b.c); R.q.copy(b.q).multiply(R.lq); groundVel(b, R.pos, t, R.vel); }
const _n = new V3(), _a = new V3(), _va = new V3(), _t1 = new V3(), _t2 = new V3(), _qa = new Q4(), _qb = new Q4();
// engines firing now: the bottom stage, plus the core stage it hangs on when the bottom stage is a set of side boosters
function burnSet() { const S = STAGES[R.bot]; return S && S.side && R.bot + 1 < STAGES.length ? [R.bot, R.bot + 1] : [R.bot]; }
function actS() { // the firing group as one engine: summed thrust, thrust-weighted Isp, fuel left (core engine for gimbal and plume)
  let T = 0, tS = 0, tV = 0, f = 0, srb = false, hot = 0, eng = null, plumeY = 0;
  for (const i of burnSet()) { const S = STAGES[i]; if (!S.thrust || !(R.fuel[i] > 0)) continue; T += S.thrust; tS += S.thrust / S.ispS; tV += S.thrust / S.ispV; f += R.fuel[i]; srb = srb || S.srb; hot = Math.max(hot, S.hot ? 1 : 0); if (!eng || !S.side) { eng = S.eng; plumeY = S.plumeY; } }
  return {thrust: T, ispS: T ? T / tS : 0, ispV: T ? T / tV : 0, fuel: f, srb, hot, eng, plumeY}; }
const srbBurning = () => R.lit && burnSet().some(i => STAGES[i].srb && R.fuel[i] > 0);
function lowY(from) { let y = Infinity; for (let i = from; i < STAGES.length; i++) if (!STAGES[i].cap) y = Math.min(y, STAGES[i].y0); return y === Infinity ? STAGES[STAGES.length - 1].y0 : y; } // lowest part from a stage up
function legStage() { for (const i of burnSet()) if (STAGES[i].legs) return STAGES[i]; return null; }
function botY() { let y = Infinity; for (const i of burnSet()) { const S = STAGES[i]; y = Math.min(y, S.legs && R.legs > .9 ? Math.min(S.y0, S.legFoot) : S.y0); } return y; } // lowest point of the stack (rocket coords)
function nose(out) { return out.set(0, 1, 0).applyQuaternion(R.q); }
function stackR() { let r = 0, ex = 0; for (let i = R.bot; i < STAGES.length - 1; i++) { const S = STAGES[i]; if (S.side) ex += S.side.n * S.rs * S.rs; else r = Math.max(r, S.r); } return Math.sqrt(r * r + ex) || 1.25; } // frontal size of what is still attached (drag)
function stackTorque() { let t = 0; for (let i = R.bot; i < STAGES.length; i++) t += (STAGES[i].torque || 0) + (STAGES[i].rcs || 0) * 9000; return t; } // gyro rings + RCS
function stackFins() { for (let i = R.bot; i < STAGES.length; i++) if (STAGES[i].fins) return true; return false; }

// ---------------- staging: launch, drop spent stages, open the parachute
function stage() {
  if (R.st === 'dead') return;
  if (!R.lit && actS().thrust) { R.lit = true; R.shut = false; if (R.st === 'pad') { sfx('clamp'); showHint('Liftoff!', 2500); } else sfx('pop'); return; }
  if (R.bot < STAGES.length - 1) { dropStage(); R.lit = actS().thrust > 0; R.shut = false; sfx('pop'); return; }
  if (STAGES[R.bot].chute && R.chute === 0) { R.chute = 1; sfx('pop'); showHint('Parachute armed: it opens low and slow', 3500); }
}
// Space from the keyboard: dropping a stage that still has fuel needs a second press, so one stray tap can't throw away the way home
const dropFull = () => { const S = STAGES[R.bot]; return R.st !== 'dead' && R.bot < STAGES.length - 1 && (R.lit || !S.thrust || !(R.fuel[R.bot] > 0)) && S.fuel > 0 && R.fuel[R.bot] / S.fuel > .02; };
function stageKey() { if (dropFull() && performance.now() - (R.askT || 0) > 2500) { const S = STAGES[R.bot]; R.askT = performance.now();
    showHint(S.name + ' still has ' + Math.round(R.fuel[R.bot] / S.fuel * 100) + '% fuel. Press Space again to drop it', 2500); warnTone(520, 1); return; }
  R.askT = 0; stage(); }
function dropStage() {
  const i = R.bot, g = R.sg[i], nz = nose(_n), S = STAGES[i];
  if (S.side) { // side boosters peel away one by one, tipping outward
    const n = S.side.n, ym = (S.y0 + S.y1) / 2; R.inner.remove(g);
    g.userData.sides.forEach((w, k) => { const a = S.side.ang(k), ca = Math.cos(a), sa = Math.sin(a), off = new V3(ca * S.side.off, ym - R.comY, -sa * S.side.off), out = new V3(ca, 0, -sa).applyQuaternion(R.q);
      const d = {g: new THREE.Group(), pos: R.pos.clone().add(off.clone().applyQuaternion(R.q)), vel: R.vel.clone().addScaledVector(out, 3 + Math.random()).addScaledVector(nz, -1.5), q: R.q.clone(), w: new V3(-sa, 0, -ca).multiplyScalar(.35 + Math.random() * .15), m: (S.dry + R.fuel[i]) / n, cdA: 1.5, t: 0, plume: []};
      g.remove(w); w.position.set(-ca * S.side.off, -ym, sa * S.side.off); d.g.add(w); scene.add(d.g); R.debris.push(d); w.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.I) o.visible = false; }); });
  } else {
  const d = {g: new THREE.Group(), pos: R.pos.clone(), vel: R.vel.clone().addScaledVector(nz, -2.5), q: R.q.clone(), w: new V3((Math.random() - .5) * .15, (Math.random() - .5) * .2, (Math.random() - .5) * .15), m: STAGES[i].dry + R.fuel[i], cdA: 3.5, t: 0, plume: g.userData.plume};
  R.inner.remove(g); g.position.y = -R.comY; d.g.add(g); scene.add(d.g); R.debris.push(d);
  if (d.plume) for (const m of d.plume) m.visible = false; }
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
  const BS = burnSet(); let anyF = false, srbOn = false; for (const i of BS) if (STAGES[i].thrust && R.fuel[i] > 0) { anyF = true; if (STAGES[i].srb) srbOn = true; }
  const want = R.lit && anyF && (R.thr > 0 || srbOn) ? 1 : 0; R.spool += clamp(want - R.spool, -h * 4, h * (R.st === 'pad' ? 1.6 : 3)); // engines take a moment to come up to power
  R.F = 0; if (want && R.spool > 0) { for (const i of BS) { const Si = STAGES[i]; if (!Si.thrust || !(R.fuel[i] > 0)) continue; const isp = lerp(Si.ispV, Si.ispS, p), F = Si.thrust * (Si.srb ? 1 : R.thr) * R.spool * isp / Si.ispV;
      R.F += F; R.fuel[i] = Math.max(0, R.fuel[i] - F / (isp * G0) * h); if (R.fuel[i] === 0 && Si.side && BS.length > 1 && R.fuel[BS[1]] > 0) showHint('Side boosters empty: Space drops them', 3000); }
    if (!BS.some(i => STAGES[i].thrust && R.fuel[i] > 0)) { R.lit = false; showHint('Out of fuel. Space: next stage', 3000); } }
  if (R.st !== 'fly') { // held by the pad clamps, or sitting on the ground
    latch(t); const gl = gravAt(R.pos, t, _a).length(); R.felt.set(0, gl, 0);
    if (R.F / m > gl * 1.02) { R.st = 'fly'; R.w.set(0, 0, 0); R.hold.copy(R.q); if (!R.t0) R.t0 = t; } return; // free from the next substep (the latch already put us at time t)
  }
  // air
  groundVel(PLANET, R.pos, t, _va); _va.subVectors(R.vel, _va); const vs = _va.length(); const rho = 1.225 * p; R.qd = .5 * rho * vs * vs;
  // parachute: opens when armed, below 9 km and slower than 280 m/s
  if (R.chute === 1 && p > .07 && vs < 280) { R.chute = 2; sfx('chute'); showHint('Parachute open: it holds you upright now', 2500); R.sg[R.sg.length - 1].userData.chute.visible = true; }
  if (R.chute === 2) { const tg = alt > 1000 && radarAlt() > 1000 ? .07 : 1; /* main canopy 1 km above the ground (or sea) */ R.chA += clamp(tg - R.chA, -h, h * (R.chA < .07 ? .028 : (.08 + R.chA) / 6)); } // canopies open reefed: drogue over ~2.5 s, main slow at first, ~6 s to full // drogue high up, full canopy below 1 km
  const S2 = stackR(); let cdA = S.cap ? 16 : 4.5 * (S2 / 1.25) ** 2;
  if (vs > 1) { const ca = (nz.x * _va.x + nz.y * _va.y + nz.z * _va.z) / vs, s2 = Math.max(0, 1 - ca * ca), M = vs / 330, len = 26.1 - lowY(R.bot);
    cdA = cdA * (1 + .9 * Math.exp(-(((M - 1.05) / .3) ** 2)) + .3 * sstep(.8, 1.8, M)) + s2 * (S.cap ? 4 : len * S2 * 2 * .7); R.mach = M; R.aoa = s2; } else R.mach = R.aoa = 0;
  cdA += R.chA * 1100;
  _a.copy(nz).multiplyScalar(R.F / m); if (NAVACC && R.F > 0) NAVACC.addScaledVector(nz, R.F / m * h); // burn node bookkeeping (nav.js)
  if (vs > .01 && R.qd > 0) _a.addScaledVector(_va, -R.qd * cdA / (m * vs)); // _a = thrust + drag (what the crew feels)
  R.felt.copy(_a).applyQuaternion(_qa.copy(R.q).invert());
  // leapfrog (kick-drift-kick, same scheme as the map's path prediction): second order, so orbits don't creep under time warp
  R.vel.addScaledVector(gravAt(R.pos, t - h, _t1).add(_a), h / 2); R.pos.addScaledVector(R.vel, h); R.vel.addScaledVector(gravAt(R.pos, t, _t1).add(_a), h / 2);
  if (R.rails) { railsTurn(); return; } // fast warp coasting high above everything: no torques, SAS just points (KSP "on rails")
  // rotation: real torques. Moment of inertia from the stack's mass and length; control torque from the capsule's reaction wheels plus
  // engine gimbal (only while the engine burns, more with a long lever); air pushes the nose into the wind when fins put the centre of
  // pressure behind the centre of mass, and tips it over when they don't. SAS is a controller limited by the same torque.
  const pk = pilot() ? keys : {}, ix = (pk.KeyS ? 1 : 0) - (pk.KeyW ? 1 : 0), iz = (pk.KeyA ? 1 : 0) - (pk.KeyD ? 1 : 0), iy = (pk.KeyQ ? 1 : 0) - (pk.KeyE ? 1 : 0);
  const Lst = 26.1 - lowY(R.bot), rS = S.cap ? 2.2 : stackR(), Ip = m * (Lst * Lst / 12 + rS * rS / 4), Ir = m * rS * rS / 2, A = actS();
  const gim = A.eng && !A.eng.blocked ? A.eng.p.gim ?? .06 : 0, arm = A.thrust ? Math.max(.5, R.comY - A.plumeY) : 0, tG = R.F * Math.sin(gim) * arm, tX = stackTorque();
  const tP = 14000 + tG + tX, tR = 9000 + tG * .08 + tX * .7; // N·m: reaction wheels in the capsule (+ gyro rings, RCS) + gimbal (a single engine barely rolls)
  const aP = tP / Ip, aR = tR / Ir; R.authP = aP; // rad/s² available (HUD / tests)
  for (const [k, v] of [['x', ix], ['y', iy], ['z', iz]]) { const c = R.inp[k]; R.inp[k] = v ? clamp(c + Math.sign(v - c) * h * (Math.sign(v) === Math.sign(c) || !c ? (R.fine ? 2 : 4) : 8), -1, 1) : c * Math.max(0, 1 - h * 14); }
  const fineK = R.fine ? .3 : 1, al = _t1.set(0, 0, 0); let free = false;
  const ctl = (e, w, a, wmax) => { const wd = Math.sign(e) * Math.min(wmax, Math.sqrt(2 * a * .6 * Math.abs(e)), Math.abs(e) * 2.5); return clamp((wd - w) / .2, -a, a); }; // time-optimal, then a soft finish
  if (ix || iy || iz || R.inp.lengthSq() > 4e-4) { al.set(R.inp.x * aP * fineK, R.inp.y * aR * fineK, R.inp.z * aP * fineK); R.hold.copy(R.q);
    if (R.sas !== 'off') { if (!ix && !iz) { al.x += ctl(0, R.w.x, aP, .6) * .5; al.z += ctl(0, R.w.z, aP, .6) * .5; } if (!iy) al.y += ctl(0, R.w.y, aR, .6) * .5; } } // SAS damps the axes you are not steering
  else if (R.sas === 'off' || R.chute === 2) free = true; // free: keeps spinning (no air on most of the trip to slow it)
  else if (R.sas === 'hold') { _qa.copy(R.q).invert().multiply(R.hold); if (_qa.w < 0) { _qa.x *= -1; _qa.y *= -1; _qa.z *= -1; _qa.w *= -1; } const sq = Math.sqrt(1 - Math.min(1, _qa.w * _qa.w)), ang = 2 * Math.acos(Math.min(1, _qa.w));
    const ex = sq > 1e-6 ? _qa.x / sq * ang : 0, ey = sq > 1e-6 ? _qa.y / sq * ang : 0, ez = sq > 1e-6 ? _qa.z / sq * ang : 0; al.set(ctl(ex, R.w.x, aP, .6), ctl(ey, R.w.y, aR, .6), ctl(ez, R.w.z, aP, .6)); }
  else { const d = sasDir(_t2); if (d) { d.applyQuaternion(_qa.copy(R.q).invert()); const ax = _n.set(d.z, 0, -d.x), sl = ax.length(), ang = Math.acos(clamp(d.y, -1, 1));
      if (sl > 1e-6) ax.multiplyScalar(ang / sl); else if (d.y < 0) ax.set(Math.PI, 0, 0); al.set(ctl(ax.x, R.w.x, aP, .6), ctl(0, R.w.y, aR, .6), ctl(ax.z, R.w.z, aP, .6)); R.hold.copy(R.q); }
    else { al.set(ctl(0, R.w.x, aP, .6), ctl(0, R.w.y, aR, .6), ctl(0, R.w.z, aP, .6)); } }
  if (vs > 5 && R.qd > 20) { // aerodynamics: restoring (fins) or tipping (no fins) torque toward/away from the airflow, plus damping
    const vl = _t2.copy(_va).multiplyScalar(1 / vs).applyQuaternion(_qa.copy(R.q).invert()); if (S.cap) vl.negate(); // a lone capsule flies heat shield first
    const area = S.cap ? 14 : Lst * rS * 2 * .6 + (stackFins() ? 4 * rS : 0), lever = S.cap ? .9 : R.chA > .1 ? 3 : stackFins() ? .14 * Lst + 1.2 : -.035 * Lst; // + = stable
    const kA = R.qd * area * lever / Ip, wn = Math.sqrt(Math.abs(kA)), dmp = 2 * .3 * wn + R.qd * area * Lst * Lst * 2e-6 / Ip;
    al.x += vl.z * kA - R.w.x * dmp; al.z += -vl.x * kA - R.w.z * dmp; al.y -= R.w.y * dmp * .2; }
  R.w.addScaledVector(al, h); R.w.multiplyScalar(1 - Math.min(.5, h * .02)); // a whisper of internal damping (sloshing fuel)
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
    const legs = !!legStage() && R.legs > .9, chute = R.chA > .5, lim = legs ? 14 : 12; if (sp > lim || (tilt > (legs ? .8 : chute ? 1.2 : .55) && sp > 3) || tilt > (chute ? 1.6 : 1.1)) { R.why = (sp > lim ? 'Hit the ground at ' + Math.round(sp) + ' m/s (safe is under ' + lim + ')' : 'Came down tipped over'); explode(); return; } // a capsule on its chute can come down swinging
    R.landV = sp;
    // set down upright
    R.body = b; const lq = _qa.copy(b.q).invert().multiply(R.q), ly = new V3(0, 1, 0).applyQuaternion(lq); lq.premultiply(new Q4().setFromUnitVectors(ly, up));
    R.lq.copy(lq); R.lp.copy(up).multiplyScalar(gr + R.comY - botY()); R.st = 'landed'; R.w.set(0, 0, 0); latch(t);
    const wet = b === PLANET && heightAt(b, up.x, up.y, up.z) < -.5, how = sp < 3 ? 'soft' : sp < 7 ? 'firm' : 'hard';
    sfx('thud'); showHint((b !== PLANET ? 'Landed on ' + (b === MOON ? 'the Moon' : b.name) : wet ? 'Splashdown' : 'Landed') + ' at ' + sp.toFixed(1) + ' m/s (' + how + ')' + (b !== PLANET ? '! F: get up, then F at the hatch to step outside' : ' · F: get up · Backspace: new rocket'), 6000); return; }
}
// on rails (fast warp, coasting): steps are seconds long, far too coarse for the torque controller (it would chatter or blow up).
// Spin stops; a pointing SAS mode turns the nose straight to its direction; hold keeps the attitude.
function railsTurn() { R.w.set(0, 0, 0); R.inp.set(0, 0, 0);
  if (R.sas === 'off' || R.sas === 'hold') return; const d = sasDir(_t2); if (!d) return;
  R.q.premultiply(_qb.setFromUnitVectors(nose(_n), d)).normalize(); R.hold.copy(R.q); }
let NAVACC = null; // speed gained from the engine since the burn node was made (nav.js)
function sasDir(out) { // inertial direction for the SAS modes
  if (R.sas === 'node') return typeof navRem === 'function' && NODE ? out.copy(navRem()).normalize() : null;
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
  satVel(b, G.t, out); if (alt < 6000) groundVel(b, R.pos, G.t, out); return out.negate().add(R.vel); }
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
  { const c = warpCap(); if (G.wi > c.mx) { G.wi = c.mx; G.warp = WARPS[c.mx]; } } // capped before the step: no long burn simulated on rails
  const sim = dt * G.warp; if (sim <= 0) return;
  const t1 = G.t, coast = R.st === 'fly' && R.F === 0 && R.p === 0 && altAbove() > 15000 && !(typeof DK !== 'undefined' && DK.ap);
  // step size: 20 ms under power / in the air; coasting, a small slice of the local orbit time scale (the leapfrog keeps orbits closed);
  // parked (pad, landed, docked, engine off) the rocket only follows the ground, so one step per frame however fast time runs
  let n; if (R.st === 'fly') { if (coast) { const rp = R.pos.length(); let hm = Math.sqrt(rp * rp * rp / PLANET.GM); for (const b of SATS) { const r = b.c.distanceTo(R.pos); hm = Math.min(hm, Math.sqrt(r * r * r / b.GM)); }
      n = Math.min(4000, Math.ceil(sim / clamp(.008 * hm, .05, 30))); } else n = Math.min(4000, Math.ceil(sim / .02)); }
  else n = R.F > 0 || R.spool > 0 || R.lit ? Math.min(4000, Math.ceil(sim / .05)) : 1;
  const h = sim / n; R.rails = coast && h > .1; let dAcc = 0;
  for (let i = 0; i < n; i++) { const t = t1 - sim + h * (i + 1); for (const bb of BODIES) bodyState(bb, t); rocketStep(h, t); dAcc += h;
    if (R.debris.length && (coast || i % 4 === 3 || i === n - 1)) { const k = Math.ceil(dAcc / .5), dh = dAcc / k; // debris: same span of time as the rocket, in slices of at most .5 s
      if (k > 400) { for (const d of R.debris) d.dead = true; } else for (let j = 0; j < k; j++) for (const d of R.debris) if (!d.dead) debrisStep(d, dh, t - dAcc + dh * (j + 1)); dAcc = 0; } else if (!R.debris.length) dAcc = 0; }
  R.rails = false;
  R.debris = R.debris.filter(d => { if (d.dead || d.t > 1800 || d.pos.distanceTo(R.pos) > 4e5) { scene.remove(d.g); return false; } return true; });
  if (R.st === 'dead' && (R.deadT -= dt) <= 0) { respawn(); }
  // keep warp safe: no fast warp under thrust, in the air, or near the ground
  { const c = warpCap(); if (G.wi > c.mx) { G.wi = c.mx; G.warp = WARPS[c.mx]; if (R.warpTo && R.on && R.st === 'fly' && R.F > 0) R.warpTo = 0; showHint('Time slowed to ×' + G.warp.toLocaleString('en') + ': ' + c.why, 2500); } }
  if (R.warpTo) { const left = R.warpTo - G.t; if (left <= 0 || (R.on && R.st === 'fly' && R.F > 0) || R.st === 'dead') { const lb = R.warpLbl; R.warpTo = 0; R.warpLbl = ''; G.wi = 0; G.warp = 1; if (left <= 0) showHint('Arrived' + (lb ? ': ' + lb : ''), 1800); }
    else { let i = WARPS.length - 1; while (i > 0 && WARPS[i] * .05 * 4 > left) i--; i = Math.min(i, warpCap().mx); G.wi = i; G.warp = WARPS[i]; } }
}
function legsStep(dt) {
  const LS = legStage(); if (!LS) return; const li = STAGES.indexOf(LS), leg = R.sg[li] && R.sg[li].userData.legs; if (!leg) return;
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
function explode(why) {
  const wb = R.body = domBody(R.pos); R.lp.copy(R.pos).sub(wb.c).applyQuaternion(_qa.copy(wb.q).invert()); R.lq.copy(_qa).multiply(R.q);
  R.st = 'dead'; R.deadT = 4; R.lit = false; R.F = 0; R.g.visible = false; boom(R.pos, 1.6); sfx('boom');
  // the stack breaks into a few tumbling pieces
  for (const g of R.sg.slice(R.bot)) { R.inner.remove(g); const d = {g: new THREE.Group(), pos: R.pos.clone(), vel: R.vel.clone(), q: R.q.clone(), m: 800, cdA: 4, t: 1700, plume: g.userData.plume};
    g.position.y = -R.comY; d.g.add(g); scene.add(d.g); if (d.plume) for (const p of d.plume) p.visible = false;
    const b = domBody(R.pos), up = R.pos.clone().sub(b.c).normalize(); d.vel = groundVel(b, R.pos, G.t, new V3()).addScaledVector(up, 12 + Math.random() * 18).add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(30));
    d.w = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(4); d.cdA = 6; R.debris.push(d); }
  why = why || R.why; R.why = ''; R.sg = []; showHint('Kaboom! ' + (why ? why + '. ' : '') + 'Back to the space centre...', 4000);
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
  const S = STAGES[R.bot], on = R.F > 0 ? Math.max(R.thr, srbBurning() ? 1 : 0) : 0, vac = 1 - R.p, nz = nose(_n);
  const BS = burnSet();
  for (let i = 0; i < R.sg.length; i++) { const u = R.sg[i].userData; if (!u.plumes) continue; const st = STAGES[i], live = on > 0 && BS.includes(i) && R.fuel[i] > 0 && (st.srb || R.thr > 0), oi = st.srb ? 1 : R.thr;
    const bm = u.bellM; if (bm) bm.emissiveIntensity = lerp(bm.emissiveIntensity, live ? (st.hot ? 1.6 : 1.1) * (.4 + .6 * vac) : 0, 1 - Math.exp(-dt * (live ? 6 : .6)));
    for (const [core, outer] of u.plumes) { core.visible = outer.visible = live; if (!live) continue; const ex = st.exit, hot = st.hot, cu = core.material.uniforms, ou = outer.material.uniforms;
      cu.r0.value = ex * .62; cu.sp.value = lerp(.1, 1.4, vac); cu.L.value = (hot ? 9 : 3.5) * (.6 + .4 * oi) * (1 + vac * .6) * (hot === 2 ? 1.3 : 1); cu.I.value = (hot ? 16 : 3.5) * oi * (1 - .35 * vac); cu.shock.value = hot === 1 ? R.p : 0; cu.t.value = G.t % 50;
      ou.r0.value = ex * .95; ou.sp.value = lerp(.45, 5.5, vac); ou.L.value = (hot ? 22 : 9) * (.5 + .5 * oi) * (1 + vac * 1.3); ou.I.value = (hot ? 3.2 : 1.4) * oi * (1 - .6 * vac); ou.shock.value = 0; ou.t.value = cu.t.value; } }
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
  const c = R.cam, b = domBody(R.pos), lock = c.mode === 'lock' && R.st !== 'dead', up = lock ? nose(_t1) : _t1.copy(R.pos).sub(b.c).normalize();
  if (lock) c.ref.set(0, 0, 1).applyQuaternion(R.q); c.ref.addScaledVector(up, -c.ref.dot(up)); if (c.ref.lengthSq() < 1e-8) c.ref.set(1, 0, 0).addScaledVector(up, -up.x); c.ref.normalize();
  const sens = .0028 * (SET.sens || 1); c.ty = (c.ty ?? c.yaw) + look.dx * sens; c.tp = clamp((c.tp ?? c.pitch) + look.dy * sens * (SET.invY ? -1 : 1), -1.45, 1.45); look.dx = look.dy = 0;
  if (Math.abs(c.ty - c.yaw) > 3) c.yaw = c.ty; const kk = 1 - Math.exp(-dt * 18); c.yaw += (c.ty - c.yaw) * kk; c.pitch += (c.tp - c.pitch) * kk; // light smoothing: no jitter from raw mouse steps
  c.td = c.td || c.dist; c.dist += (c.td - c.dist) * (1 - Math.exp(-dt * 8));
  const right = _t2.crossVectors(c.ref, up).normalize();
  const v = new V3().addScaledVector(c.ref, Math.cos(c.yaw)).addScaledVector(right, Math.sin(c.yaw)).multiplyScalar(Math.cos(c.pitch)).addScaledVector(up, -Math.sin(c.pitch));
  const tgt = R.pos.clone().addScaledVector(nose(_n), 2), eye = tgt.clone().addScaledVector(v, -c.dist);
  // shake: engines in thick air, and max-q
  const sh = (R.F > 0 ? R.thr * (.02 + .12 * R.p) : 0) + Math.min(.15, R.qd / 2e5) + (G.flash || 0) * .3; if (sh > 0 && R.st !== 'dead' && !G.paused) eye.add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(sh * Math.min(1, c.dist / 30)));
  // stay above the ground
  const rel = eye.clone().sub(b.c); if (rel.length() - b.R < 15000) { const bf = rel.clone().applyQuaternion(_qa.copy(b.q).invert()), gr = groundR(b, bf) + 1.5; if (bf.length() < gr) eye.copy(b.c).addScaledVector(rel.normalize(), gr); }
  const fa = _t2.copy(R.felt).applyQuaternion(R.q); if (R.st !== 'fly') fa.set(0, 0, 0); else fa.multiplyScalar(-.055).clampLength(0, 3.2); R.lag.lerp(fa, 1 - Math.exp(-dt * 2.5)); eye.add(R.lag);
  G.O.copy(eye); _m.lookAt(eye, tgt, up); cam.quaternion.setFromRotationMatrix(_m); cam.position.set(0, 0, 0); cam.updateMatrixWorld();
}
addEventListener('wheel', e => { if (!G.on || !R.on || MAPV.on || G.paused) return; e.preventDefault(); const c = R.cam; c.td = clamp((c.td || c.dist) * Math.exp(e.deltaY * .0015), 8, 3000); }, {passive: false});
// drag to look when the mouse isn't grabbed (touchpads, after Esc, or where the browser refuses the grab)
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas || !e.buttons || !G.on || G.paused || (typeof MAPV !== 'undefined' && MAPV.on) || e.target !== canvas) return; look.dx += e.movementX; look.dy += e.movementY; }); // on foot too
// some browsers / embedded windows refuse the mouse grab: say so, dragging still looks around
document.addEventListener('pointerlockerror', () => { if (G.on && !G.paused) showHint('Mouse grab not allowed here: hold a mouse button and drag to look around', 4000); });
function camDefault() { const c = R.cam, hgt = 26.1 - lowY(R.bot); c.td = c.dist = clamp(hgt * 1.9, 22, 160); c.ty = c.yaw; c.tp = c.pitch; }
const VIEWS = ['in', 'chase', 'lock'], VNAMES = {in: 'Inside view', chase: 'Chase view: horizon stays level', lock: 'Locked view: turns with the ship'};
function cycleView() { const cur = C.view === 'in' ? 'in' : R.cam.mode || 'chase', nx = VIEWS[(VIEWS.indexOf(cur) + 1) % 3];
  if (nx === 'in') C.view = 'in'; else { if (C.view === 'in') { camDefault(); } C.view = 'out'; R.cam.mode = nx; R.cam.ty = R.cam.yaw; R.cam.tp = R.cam.pitch; }
  showHint(VNAMES[nx] + (nx === 'in' ? '' : ' · mouse to look around · wheel zoom · V next view'), 2500); }

// ---------------- boarding
function canBoard() { if (R.st === 'fly' || R.st === 'dead' || P.body !== R.body) return false; const base = R.lp.clone().addScaledVector(new V3(0, 1, 0).applyQuaternion(R.lq), -(R.comY - lowY(R.bot)));
  const up = base.clone().normalize(), d = P.pos.clone().sub(base); return d.dot(up) < 26 && d.addScaledVector(up, -d.dot(up)).length() < 20; }
function board() { R.on = true; C.in = true; C.seat = -1; C.view = 'in'; C.pos.set(0, CAB.floor, .3); C.vel.set(0, 0, 0); C.yaw = 0; C.pitch = 0; const c = R.cam; c.dist = c.td = clamp((26.1 - STAGES[0].y0) * 1.9, 22, 160); c.mode = c.mode || 'chase'; c.pitch = .05; c.yaw = 1.65; c.ref.set(1, 0, 0).applyQuaternion(site.q).applyQuaternion(PLANET.q); if (R.st !== 'pad') { c.ref.copy(new V3(0, 0, -1).applyQuaternion(R.q)); c.yaw = 0; } c.ty = c.yaw; c.tp = c.pitch;
  showHint('You are in the capsule. Walk to the middle seat and press F to fly · F at the hatch (back) to get out', 9000); }
function getOut() { if (R.st === 'fly' || R.st === 'dead') { showHint('Land first to get out', 2000); return; }
  const b = R.body, up = R.lp.clone().normalize(), side = new V3(0, 0, 1).applyQuaternion(R.lq); side.addScaledVector(up, -side.dot(up)).normalize();
  const base = R.lp.clone().addScaledVector(up, -(R.comY - lowY(R.bot)));
  P.body = b; P.pos.copy(base).addScaledVector(side, 7).addScaledVector(up, 1.5); P.vel.set(0, 0, 0); P.fwd.copy(side).negate(); P.pitch = .3; R.on = false; C.in = false; C.seat = -1; cabL.intensity = 0; $('cross').classList.remove('hidden');
  showHint(b !== PLANET ? 'You are on ' + (b === MOON ? 'the Moon' : b.name) + '. WASD walk, Space hop' : 'F at the rocket to get back in', 4000); }

// ---------------- keys
addEventListener('keydown', e => {
  sndInit(); if (!G.on || G.paused || e.repeat) return; const k = e.code;
  if (k === 'KeyF') { if (R.on) cabinAct(); else if (canBoard()) board(); }
  if (k === 'KeyV' && pilot()) cycleView();
  if (k === 'CapsLock' && pilot()) { R.fine = !R.fine; showHint(R.fine ? 'Fine controls on: gentle steering (Caps Lock)' : 'Fine controls off', 1800); }
  if (k === 'Comma' || k === 'BracketLeft') setWarp(G.wi - 1);
  if (k === 'Period' || k === 'BracketRight') setWarp(G.wi + 1);
  if (!pilot()) { if (R.on && C.in && /^(Digit[1-6]|Numpad[1-6]|KeyT|KeyZ|KeyX|KeyR)$/.test(k)) showHint('Sit in the middle (Pilot) seat to fly: walk to it and press F', 2500); return; }
  if (k === 'Space') { e.preventDefault(); stageKey(); }
  if (k === 'KeyZ') { R.thr = 1; autoLight(); } if (k === 'KeyX') R.thr = 0; if (k === 'KeyR') engineToggle();
  const modes = {Digit1: 'hold', Digit2: 'pro', Digit3: 'retro', Digit4: 'up', Digit5: 'guide', Digit6: 'node', Numpad6: 'node', Numpad1: 'hold', Numpad2: 'pro', Numpad3: 'retro', Numpad4: 'up', Numpad5: 'guide', KeyT: R.sas === 'off' ? 'hold' : 'off'}; if (modes[k]) setSas(modes[k]);
  if (k === 'KeyG' && legStage()) { R.legT = R.legT ? 0 : 1; R.legManual = true; showHint(R.legT ? 'Landing legs out' : 'Landing legs in', 1500); }
  if (k === 'KeyN') warpNext();
  if (k === 'Backspace') { e.preventDefault(); if (R.st !== 'fly') { resetRocket(); showHint('New rocket on the pad', 2500); } }
});
addEventListener('pointerdown', sndInit);
// R: shut the current engine down or light it again (no staging). Throttle (Shift / C / Z / X) only works while it is lit
function engineToggle() { const S = STAGES[R.bot]; if (R.st === 'dead') return;
  if (R.lit && srbBurning()) { showHint('Solid boosters burn until they are empty: they can\'t be shut down', 2500); return; }
  if (!S.thrust) { showHint('No engine on this stage' + (R.bot < STAGES.length - 1 ? ': Space drops it' : ''), 2000); return; }
  if (!(R.fuel[R.bot] > 0)) { showHint(S.name + ' is out of fuel: Space for the next stage', 2000); return; }
  if (R.lit) { R.lit = false; R.shut = true; sfx('pop'); showHint((actS().eng || S.eng).p.name + ' shut down · R to relight', 2200); }
  else if (R.st === 'pad') stage(); else { R.lit = true; R.shut = false; R.spool = Math.min(R.spool, .2); sfx('pop'); showHint(S.eng.p.name + ' lit' + (R.thr < .05 ? ' · throttle is at zero: Shift or Z' : ''), 2200); } }
function setSas(m) { R.sas = m; R.hold.copy(R.q);
  const names = {guide: 'Ascent guide: steers to orbit, stages when a stage runs dry, cuts the engine at 80 km Ap and plans the circularise burn. You launch (Space)', node: 'Pointing at the burn node (purple marker)', hold: 'Holding direction', pro: 'Pointing prograde (where you are going)', retro: 'Pointing retrograde (backwards, to slow down)', up: 'Pointing up', off: 'Autopilot off'};
  if ((m === 'pro' || m === 'retro') && (R.st !== 'fly' || relVel(new V3()).length() < 3)) showHint((m === 'pro' ? 'Prograde' : 'Retrograde') + ' needs you to be moving: it turns once you are flying', 3000); else showHint(names[m], 1800); }
// the fastest time warp allowed right now, and why (KSP: only physics warp up to ×4 under thrust, in the air or low down)
function warpCap() { if (!G.on) return {mx: 0, why: ''}; if (!R.on) return {mx: 6, why: 'on foot'};
  if (R.st === 'fly') { if (R.F > 0 || srbBurning() || (R.lit && R.thr > 0 && actS().thrust > 0 && burnSet().some(i => STAGES[i].thrust && R.fuel[i] > 0))) return {mx: 2, why: 'engine burning'}; if (R.p > 0) return {mx: 2, why: 'in the air'}; if (altAbove() < 12000) return {mx: 2, why: 'under 12 km'}; }
  return {mx: WARPS.length - 1, why: ''}; }
function setWarp(i) { R.warpTo = 0; R.warpLbl = ''; const c = warpCap(), want = clamp(i, 0, WARPS.length - 1); G.wi = Math.min(want, c.mx); G.warp = WARPS[G.wi];
  if (want > c.mx) showHint('×' + WARPS[want].toLocaleString('en') + ' not now: ' + c.why + (c.why === 'engine burning' ? ' (X cuts it)' : c.why === 'on foot' ? '' : '. Up to ×' + WARPS[c.mx] + ' (physics warp)'), 2500); }
function warpNext() { // time warp to the next apoapsis or periapsis, whichever is sooner
  if (!R.on || R.st !== 'fly') return; const o = orbitEl(domBody(R.pos)); const ts = [o.tAp, o.tPe].filter(x => x > 20); if (R.F > 0) { showHint('Cut the engine first (X)', 2000); return; }
  if (!ts.length) { showHint('Nothing to warp to', 1500); return; } const dt = Math.min(...ts); R.warpTo = G.t + dt - 15; showHint('Warping to ' + (dt === o.tAp ? 'apoapsis (Ap)' : 'periapsis (Pe)') + ' · any time key stops', 2500); }
// KSP style: the active stage's engines run whenever the throttle is up; only R (shut down) needs R / Space to relight
function autoLight() { if (!R.lit && !R.shut && R.st === 'fly' && actS().thrust > 0) { R.lit = true; R.spool = Math.min(R.spool, .2); } }
function stepThrottle(dt) { if (!pilot()) return; if (keys.ShiftLeft || keys.ShiftRight) { R.thr = Math.min(1, R.thr + dt * .9); autoLight(); } if (keys.KeyC) R.thr = Math.max(0, R.thr - dt * .9); }

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
function warnTone(f = 880, n = 2) { const c = SND.c; if (!c) return; const t = c.currentTime; // short cockpit warning tone (low fuel, stage-drop check)
  for (let i = 0; i < n; i++) { const o = c.createOscillator(), g = c.createGain(), t0 = t + i * .17; o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(SND.out);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.045, t0 + .01); g.gain.setValueAtTime(.045, t0 + .09); g.gain.linearRampToValueAtTime(0, t0 + .11); o.start(t0); o.stop(t0 + .13); } }
function sndUpdate() { if (!SND.c) return; const t = SND.c.currentTime; let e = R.F > 0 ? R.thr : 0;
  const near = R.on ? 1 : clamp(1 - G.O.distanceTo(R.pos) / 4000, 0, 1) ** 2; e *= near * (STAGES[R.bot].hot ? 1 : .45); const p = .25 + .75 * Math.min(1, R.p * 2);
  SND.rum.g.gain.setTargetAtTime(e * p * .9, t, .08); SND.crk.g.gain.setTargetAtTime(e * p * .12 * (.7 + .3 * Math.random()), t, .05); SND.rum.fl.frequency.setTargetAtTime(220 + 200 * R.thr, t, .2);
  SND.wind.g.gain.setTargetAtTime(R.on ? Math.min(.5, R.qd / 40000) : 0, t, .2); SND.wind.fl.frequency.setTargetAtTime(300 + Math.min(900, R.qd / 30), t, .3); }

// ---------------- flight HUD
const fmtD = m => Math.abs(m) >= 1e6 ? (m / 1e6).toFixed(2) + ' Mm' : Math.abs(m) >= 1e4 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
function orbitOf(b) { const mu = b.GM, rr = R.pos.clone().sub(b.c), vv = R.vel.clone(); if (b !== PLANET) vv.sub(satVel(b, G.t, new V3()));
  const r = rr.length(), v2 = vv.lengthSq(), E = v2 / 2 - mu / r, h = rr.clone().cross(vv).length(), e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (mu * mu)));
  const pe = h * h / mu / (1 + e) - b.R, ap = E < 0 ? -mu / (2 * E) * (1 + e) - b.R : Infinity; return {ap, pe}; }
// full orbital elements around body b: e, a, period, true anomaly, time to Ap / Pe (s), inclination to the equator
function orbitEl(b, pos = R.pos, vel = R.vel, t = G.t) { const mu = b.GM, rr = pos.clone().sub(b !== PLANET ? satPos(b, t, new V3()) : b.c), vv = vel.clone(); if (b !== PLANET) vv.sub(satVel(b, t, new V3()));
  const r = rr.length(), hv = rr.clone().cross(vv), h = hv.length(), E = vv.lengthSq() / 2 - mu / r, ev = vv.clone().cross(hv).multiplyScalar(1 / mu).sub(rr.clone().multiplyScalar(1 / r)), e = ev.length();
  const a = -mu / (2 * E), out = {e, a, r, ap: E < 0 ? a * (1 + e) - b.R : Infinity, pe: h * h / mu / (1 + e) - b.R, tAp: Infinity, tPe: Infinity, period: E < 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity, inc: Math.acos(clamp(hv.y / (h || 1), -1, 1))};
  let nu = e > 1e-6 ? Math.acos(clamp(ev.dot(rr) / (e * r), -1, 1)) : 0; if (rr.dot(vv) < 0) nu = 2 * Math.PI - nu; out.nu = nu;
  if (E < 0 && e < 1) { const n = Math.sqrt(mu / (a * a * a)), Ea = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)), M = ((Ea - e * Math.sin(Ea)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    out.tPe = (2 * Math.PI - M) / n; out.tAp = ((Math.PI - M) / n + out.period) % out.period; }
  else if (e > 1 && rr.dot(vv) < 0) { const n = Math.sqrt(mu / Math.pow(-a, 3)), F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)), M = e * Math.sinh(F) - F; out.tPe = Math.abs(M) / n; }
  return out; }
function stageDv() { const S = actS(); if (!S.thrust || !S.fuel) return 0; const m = rocketMass(); return lerp(S.ispV, S.ispS, R.p) * G0 * Math.log(m / (m - S.fuel)); }
function maxAcc() { const S = actS(); return S.thrust ? S.thrust * lerp(S.ispV, S.ispS, R.p) / S.ispV / rocketMass() : 0; }
const fmtS = s => s === Infinity || isNaN(s) ? '—' : s >= 3600 ? (s / 3600 | 0) + 'h ' + String((s / 60 | 0) % 60).padStart(2, '0') + 'm' : (s / 60 | 0) + ':' + String(s % 60 | 0).padStart(2, '0');
const HUDE = {}, setTxt = (id, t) => { const el = HUDE[id] || (HUDE[id] = $(id)); if (el._t !== t) { el._t = t; el.textContent = t; } };
let sasBtns = null, fhT = 0;
function flightHud(dt) {
  const fl = $('fl'); fl.classList.remove('hidden'); document.body.classList.add('fly'); if ((fhT -= dt) > 0) return markers(); fhT = .1;
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, v = relVel(new V3()).length(), o = orbitOf(b), S = STAGES[R.bot];
  const sit = R.st === 'pad' ? 'On the pad' : R.st === 'landed' ? 'Landed' : R.st === 'dead' ? 'Crashed' : o.pe > (b === PLANET ? PLANET.atmo : 2000) ? 'In orbit' : alt < 20000 && b === PLANET ? 'Flying' : 'Suborbital';
  setTxt('hLoc', sit + (b !== PLANET ? ' · ' + b.name : '')); setTxt('hInfo', 'Local time ' + localTime() + (G.warp > 1 ? ' · Time ×' + G.warp : '') + (R.warpTo ? ' (warping)' : ''));
  setTxt('fAlt', fmtD(alt)); setTxt('fSpd', Math.round(v) + ' m/s');
  setTxt('fAp', o.ap === Infinity ? 'escape' : fmtD(o.ap)); setTxt('fPe', o.pe < -b.R * .5 ? '—' : fmtD(o.pe));
  // extra readouts: vertical speed, time to Ap/Pe, stage delta-v, load
  const el = orbitEl(b), vs = vertSpeed(), ra = radarAlt(), fly = R.st === 'fly';
  setTxt('fVs', (vs >= 0 ? '+' : '−') + Math.abs(Math.round(vs)) + ' m/s');
  if (fly && el.tAp < 1e6 && (vs > 0 || el.tAp < el.tPe)) { setTxt('fTl', 'Ap in'); setTxt('fTt', fmtS(el.tAp)); } else if (fly && el.tPe < 1e6 && el.pe > 0) { setTxt('fTl', 'Pe in'); setTxt('fTt', fmtS(el.tPe)); } else { setTxt('fTl', 'Next'); setTxt('fTt', '—'); }
  const dv = stageDv(); setTxt('fDv', dv ? Math.round(dv) + ' m/s' : '—'); setTxt('fG', fly ? (R.felt.length() / 9.81).toFixed(1) + ' g' + (R.p > .01 && R.mach > .3 ? ' · M' + R.mach.toFixed(1) : '') : '—');
  let w = '', wc = '';
  if (fly && ra < 15000) { const L = landCalc(), stop = L.stop, vd = L.vd, hs = L.hs;
    w = 'Ground ' + fmtD(Math.max(0, ra)); if (vd > 4 && b !== PLANET || vd > 4 && !S.cap && ra < 4000) { if (stop * 1.25 + 60 > ra) { w += ' · BURN NOW'; wc = 'red'; } else if (stop * 2 + 150 > ra) { w += ' · burn soon'; wc = 'amber'; } }
    if (ra < 300 && (vd > 8 || hs > 8)) { w += ' · too fast'; wc = 'red'; } }
  setTxt('fW', w); const fw = HUDE.fW; if (fw._c !== wc) { fw._c = wc; fw.className = wc; }
  const ff = S.fuel ? R.fuel[R.bot] / S.fuel : 0, fe = HUDE.fFuel || (HUDE.fFuel = $('fFuel')), low = ff > 0 && ff < .15; if (fe._low !== low) { fe._low = low; fe.classList.toggle('low', low); }
  if (R.lit && fly && ff > 0 && ff < .1 && R.lowB !== R.bot) { R.lowB = R.bot; warnTone(660, 2); } // one warning per stage
  $('fThr').style.width = (R.thr * 100) + '%'; fe.style.width = (ff * 100) + '%'; setTxt('fStage', S.name); setTxt('fFlags', (S.thrust && R.fuel[R.bot] > 0 && !R.lit && R.st !== 'pad' ? 'Engine off' : '') + (legStage() ? (S.thrust && R.fuel[R.bot] > 0 && !R.lit && R.st !== 'pad' ? ' · ' : '') + 'Legs ' + (R.legT ? 'out' : 'in') : ''));
  const nx = R.st === 'pad' && !R.lit ? 'Launch' : !R.lit && S.thrust && R.fuel[R.bot] > 0 ? 'Ignite' : R.bot < STAGES.length - 1 ? 'Drop ' + S.name.toLowerCase() : R.chute === 0 ? 'Parachute' : '';
  { const t = nx ? (nx.startsWith('Drop') && dropFull() ? '2' : '1') + nx : ''; const fn = HUDE.fNext || (HUDE.fNext = $('fNext')); if (fn._t !== t) { fn._t = t; fn.innerHTML = nx ? '<span class="key">Space' + (t[0] === '2' ? ' ×2' : '') + '</span>' + nx : ''; } } for (const el of sasBtns || (sasBtns = [...document.querySelectorAll('#fSas button')])) el.classList.toggle('on', el.dataset.m ? el.dataset.m === R.sas : R.lit);
  markers();
}
const _mk = new V3(), _mv3 = new V3(), MKS = [['mPro', 1], ['mRet', -1], ['mGd', 0]];
function markers() { // prograde / retrograde / ascent-guide markers on screen
  const v = relVel(_mv3); const show = v.length() > 3 && R.st === 'fly' && !MAPV.on; v.normalize();
  const gd = !MAPV.on && (R.sas === 'guide' || guideOn()) ? guideDir(new V3()) : null;
  for (const [id, s] of MKS) { const el = HUDE[id] || (HUDE[id] = $(id)); const d = s ? (show ? _mk.copy(v).multiplyScalar(s) : null) : gd; if (!d) { el.classList.add('hidden'); continue; }
    const p = _mk.copy(d).multiplyScalar(1e4).project(cam); const ok = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; el.classList.toggle('hidden', !ok);
    if (ok) { el.style.transform = 'translate(' + ((p.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-p.y * .5 + .5) * innerHeight).toFixed(1) + 'px)'; } } }
document.querySelectorAll('#fSas button').forEach(el => el.onclick = e => { e.stopPropagation(); if (el.dataset.m) setSas(el.dataset.m); else engineToggle(); });

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
  x.textAlign = 'right'; x.fillStyle = '#ffcf4a'; x.fillText('LSP', s.w - 10, 15); x.textAlign = 'left'; }
const fmtT = s => { s = Math.max(0, s | 0); return String(s / 3600 | 0).padStart(2, '0') + ':' + String((s / 60 | 0) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function situation(b, alt, o) { return R.st === 'pad' ? 'ON THE PAD' : R.st === 'landed' ? 'LANDED' : R.st === 'dead' ? 'VEHICLE LOST' : o.pe > (b === PLANET ? PLANET.atmo : 2000) ? 'IN ORBIT' : alt < 20000 && b === PLANET ? 'FLYING' : 'SUBORBITAL'; }
const DRAW = {
  tele(s) { scrBg(s, 'FLIGHT DYNAMICS'); const x = s.x, b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R, o = orbitOf(b), v = relVel(new V3()).length();
    const rows = [['MET', R.t0 ? 'T+' + fmtT(G.t - R.t0) : 'T- HOLD'], ['ALT', fmtD(alt)], ['VEL', Math.round(v) + ' m/s'], ['AP', o.ap === Infinity ? 'ESCAPE' : fmtD(o.ap)], ['PE', o.pe < -b.R * .5 ? '--' : fmtD(o.pe)], ['STAGE', STAGES[R.bot].name.toUpperCase()], ['THR', Math.round(R.thr * 100) + '%'], ['BODY', b.name.toUpperCase()]];
    x.font = '600 21px monospace'; rows.forEach(([k, v2], i) => { const cx = i < 4 ? 14 : 270, cy = 62 + (i % 4) * 46; x.fillStyle = '#5c8fbf'; x.fillText(k, cx, cy); x.fillStyle = '#eaf4ff'; x.fillText(v2, cx + 76, cy); });
    x.fillStyle = R.st === 'dead' ? '#ff5a4a' : '#5fd38a'; x.font = '600 16px monospace'; x.fillText(situation(b, alt, o), 14, s.h - 14); },
  orbit(s) { scrBg(s, 'TRAJECTORY'); const x = s.x, b = domBody(R.pos), mu = b.GM, rr = R.pos.clone().sub(b.c), vv = R.vel.clone(); if (b !== PLANET) vv.sub(satVel(b, G.t, new V3()));
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
      let c; if (h < 0) { const k = clamp(-h / 2500, 0, 1); c = [14 - 6 * k, 58 - 26 * k, 98 - 36 * k]; } else { const q = colorAt(PLANET, cx, cy, cz, h, 0), sh = 1.1 - clamp(h / 3000, 0, 1) * .15; c = [Math.pow(q.r, 1 / 2.2) * 255 * sh, Math.pow(q.g, 1 / 2.2) * 255 * sh, Math.pow(q.b, 1 / 2.2) * 255 * sh]; } // same biomes as the ground
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
  if (C.view !== 'out') { const sens = .0022 * (SET.sens || 1); C.yaw -= look.dx * sens; C.pitch = clamp(C.pitch - look.dy * sens * (SET.invY ? -1 : 1), -1.45, 1.45); look.dx = look.dy = 0; } // the outside view reads the mouse itself
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
    const rb = (R.F > 0 ? R.thr * (.002 + .01 * R.p) : 0) + Math.min(.012, R.qd / 2e6); if (rb && !G.paused) e.add(_t2.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(rb)); } else R.clag.set(0, 0, 0); G.O.copy(e).applyQuaternion(R.q).add(R.pos);
  cam.quaternion.copy(R.q).multiply(_cq.setFromAxisAngle(_cy, C.yaw)).multiply(_cq2.setFromAxisAngle(_cx, C.pitch)); cam.position.set(0, 0, 0); cam.updateMatrixWorld();
  const l = new V3(0, CAB.ceil - .25 - R.comY, 0).applyQuaternion(R.q).add(R.pos).sub(G.O); cabL.position.copy(l); cabL.intensity = 7;
}
function cabinNear() { // what F would do from here
  if (C.seat >= 0) return {k: 'stand', t: 'F · Get up' + (C.seat === 0 ? ' · V outside view' : '')};
  const p = C.pos; for (let i = 0; i < SEATS.length; i++) { const s = SEATS[i]; if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < .85) return {k: 'sit', i, t: 'F · Sit: ' + s.name + (i === 0 ? ' (fly)' : '')}; }
  const a = Math.atan2(p.x, -p.z); if (Math.hypot(p.x, p.z) > .7 && Math.abs(angD(a, CAB.hatchA)) < .6) return {k: 'hatch', t: R.st === 'fly' || R.st === 'docked' ? 'Hatch locked in flight' : 'F · Open hatch'};
  return null; }
function cabinAct() { const n = cabinNear(); if (!n) return;
  if (n.k === 'stand') { const s = SEATS[C.seat]; C.seat = -1; C.view = 'in'; C.pos.set(Math.sin(s.a) * .4, CAB.floor, -Math.cos(s.a) * .4); C.vel.set(0, 0, 0); return; }
  if (n.k === 'sit') { C.seat = n.i; C.yaw = -SEATS[n.i].a; C.pitch = -.05; C.vel.set(0, 0, 0); if (n.i === 0) showHint('Space: ' + (R.st === 'pad' ? 'launch' : 'stage') + ' · W/S A/D steer · Q/E roll · Shift/C throttle · 1-4 autopilot · V outside view', 8000); return; }
  if (n.k === 'hatch' && R.st !== 'fly' && R.st !== 'docked') getOut(); }
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
function satOrbit(b) { onFoot(); flyFrom(1); const d = SUN.clone().addScaledVector(b.c.clone().normalize(), -1).normalize(), r = b.R + Math.max(20000, b.R * .15), t = new V3(0, 1, 0).cross(d).normalize();
  R.pos.copy(b.c).addScaledVector(d, r); R.vel.copy(satVel(b, G.t, new V3())).addScaledVector(t, Math.sqrt(b.GM / r)); R.q.setFromUnitVectors(new V3(0, 1, 0), t); R.hold.copy(R.q); R.sas = 'pro'; toPilot(); C.view = 'out'; showHint('Orbiting ' + b.name + ' · ' + b.desc, 5000); }
function satWalk(b) { onFoot(); const d = SUN.clone().applyQuaternion(b.q.clone().invert()).add(new V3(.4, .2, .3)).normalize(); P.body = b; P.pos.copy(d).multiplyScalar(b.R + heightAt(b, d.x, d.y, d.z) + 2); P.vel.set(0, 0, 0);
  P.fwd.set(0, 1, 0).addScaledVector(d, -d.y).normalize(); P.pitch = .1; showHint('On ' + b.name + ' · Space to hop', 4000); }
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
  rustOrbit() { satOrbit(RUST); }, frostOrbit() { satOrbit(FROST); }, rustWalk() { satWalk(RUST); }, frostWalk() { satWalk(FROST); },
  moonWalk() { onFoot(); const d = SUN.clone().applyQuaternion(MOON.q.clone().invert()).add(new V3(.3, .1, .2)).normalize(); P.body = MOON; P.pos.copy(d).multiplyScalar(MOON.R + heightAt(MOON, d.x, d.y, d.z) + 2); P.vel.set(0, 0, 0);
    P.fwd.set(0, 1, 0).addScaledVector(d, -d.y).normalize(); P.pitch = .1; showHint('On the Moon. Space to hop', 4000); },
  mc() { onFoot(); P.body = PLANET; placeAt(-72.25, .1, 79, 0, 0); showHint('Mission control. Stairs on the left wall go up to the deck', 4000); },
  deck() { onFoot(); P.body = PLANET; placeAt(-88, 6.1, 72, -1.2, -.05); },
  centre() { onFoot(); spawnPlayer(); P.body = PLANET; },
  sunrise() { setHour(6.4); }, noon() { setHour(12); }, sunset() { setHour(17.7); }, night() { setHour(23); },
  fuel() { R.fuel = STAGES.map(s => s.fuel); showHint('Tanks full', 1500); },
  cloudsMore() { CL.cov.value = Math.min(1, CL.cov.value + .15); }, cloudsLess() { CL.cov.value = Math.max(0, CL.cov.value - .15); },
};
function testMenu(show) { const t = $('test'); show = show ?? t.classList.contains('hidden'); t.classList.toggle('hidden', !show); if (show && document.pointerLockElement) document.exitPointerLock(); if (!show) lockPointer(); }
document.querySelectorAll('#test [data-t]').forEach(b => b.onclick = e => { e.stopPropagation(); TESTS[b.dataset.t](); if (!b.dataset.keep) testMenu(false); });
$('testX').onclick = () => testMenu(false);
addEventListener('keydown', e => { if (e.code === 'Backquote' && G.on && !G.paused) testMenu(); });

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
