'use strict';
// YeShip models + sounds (26 Nov 2026; owner: "make all the models more detailed"). CC0 props from space/assets (Poly Haven scans, Kenney kits),
// loaded lazily with three r170 GLTFLoader (gltf-r170.js, a classic-script copy) after boot, so nothing heavy blocks the first frame.
// Helpers for other files: mdlGet(key) -> Promise(template), propPlace(key, parent, pos, rotY, scale, opt) -> Group (filled when loaded), furnish(kind, parent, opt).
// Also: real sound samples layered over the procedural ones (sfx / sndUpdate wrappers), ambience per place, footsteps by surface, boulders on airless worlds.
// Loaded after net.js, before polish.js (which calls boot()).

const MDL = {base: 'assets/models/', tpl: {}, ready: null, loader: null, props: [], rocks: null,
  // metres per model unit for each kit (MANIFEST.md); Poly Haven is already in metres
  kit: {'polyhaven': 1, 'kenney-space': 2.5, 'kenney-station': 2.2, 'kenney-furniture': 2, 'kenney-nature': 4, 'kenney-factory': 2, 'kenney-survival': 3, 'kenney-car': 2, 'kenney-industrial': 7.5, 'kenney-modular-space': 1}};
if (/[?&]noprops/.test(location.search)) MDL.siteDone = MDL.rocks = true; // test switch: no props
const lowGfx = () => typeof SET !== 'undefined' && SET.gfx === 'low';
function mdlLib() { if (MDL.ready) return MDL.ready;
  return MDL.ready = new Promise((res, rej) => { if (THREE.GLTFLoader) return res(); const s = document.createElement('script'); s.src = 'gltf-r170.js?v=1'; s.onload = res; s.onerror = rej; document.head.appendChild(s); })
    .then(() => { MDL.loader = new THREE.GLTFLoader(); }); }
// template for a key like 'polyhaven/barrel_01': feet at y 0, centred in x/z, kit scale applied, shadows on
function mdlGet(key) { if (MDL.tpl[key]) return MDL.tpl[key];
  return MDL.tpl[key] = mdlLib().then(() => new Promise((res, rej) => MDL.loader.load(MDL.base + key + '.glb', gl => {
    const s = gl.scene, kit = key.split('/')[0], k = MDL.kit[kit] || 1, root = new THREE.Group(); s.scale.setScalar(k); root.add(s); root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(s); s.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    s.traverse(o => { if (!o.isMesh) return; o.castShadow = o.receiveShadow = true; const m = o.material; if (m && m.isMeshStandardMaterial) { if (kit !== 'polyhaven') { m.metalness = Math.min(m.metalness, .2); m.roughness = Math.max(m.roughness, .55); } if (m.map) m.map.anisotropy = 4; } });
    root.userData.size = bb.getSize(new V3()); res(root); }, undefined, rej))); }
// place a copy of a model. opt: lit (material mapper, e.g. hgOf for the hangar), solid (collision box in site.boxes; parent must be in the site frame),
// tilt [x, z] radians, range (hide beyond this many metres from the camera; site props only), min (minimum gfx: 1 = skip on Low)
const _mdmlit = new WeakMap();
function propPlace(key, parent, pos, rotY = 0, scale = 1, opt = {}) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.set(opt.tilt ? opt.tilt[0] : 0, rotY, opt.tilt ? opt.tilt[1] : 0); g.scale.setScalar(scale); g.userData.key = key; parent.add(g);
  if (opt.min && lowGfx()) return g;
  mdlGet(key).then(t => { const o = t.clone(true);
    if (opt.lit) o.traverse(m => { if (!m.isMesh) return; let c = _mdmlit.get(opt.lit); if (!c) _mdmlit.set(opt.lit, c = new Map()); let mm = c.get(m.material.uuid); if (!mm) c.set(m.material.uuid, mm = opt.lit(m.material)); m.material = mm; });
    if (opt.tint) o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(opt.tint)); } });
    g.add(o);
    if (opt.solid && typeof site !== 'undefined' && site.boxes) { g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(site.g.matrixWorld).invert(), bb = new THREE.Box3();
      o.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))); } });
      const sh = opt.solid === true ? 0 : opt.solid; site.boxes.push({x0: bb.min.x + sh, x1: bb.max.x - sh, y0: bb.min.y, y1: bb.max.y, z0: bb.min.z + sh, z1: bb.max.z - sh}); }
  }).catch(e => console.warn('model', key, e && e.message));
  if (opt.range) MDL.props.push({g, r: opt.range, at: pos.clone()}); return g; }
const mV = (x, y, z) => new V3(x, y, z);
// PBR texture sets in assets/tex (<name>_c/_n/_r.jpg); colour maps are sRGB
const _mdTx = {};
function atex(name, kind, ru = 1, rv = 1) { const k = name + kind + ru + 'x' + rv; if (_mdTx[k]) return _mdTx[k]; const t = new THREE.TextureLoader().load('assets/tex/' + name + '_' + kind + '.jpg');
  if (kind === 'c') t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 4; return _mdTx[k] = t; }
const mgV = (x, dy, z) => mV(x, Math.max(.06, site.H && site.H.groundY ? site.H.groundY(x, z) : 0) + dy, z); // outdoor: on the ground (or the slab)

// ---------------- the space centre
function siteProps() { if (!site.g || MDL.siteDone) return; MDL.siteDone = true;
  const g = site.g, gin = WLD.gIn || g, HG = typeof hgOf === 'function' ? hgOf : null, PH = 'polyhaven/', KC = 'kenney-car/', KI = 'kenney-industrial/';
  const hin = (k, x, y, z, ry = 0, s = 1, o = {}) => propPlace(PH + k, gin, mV(x, y, z), ry, s, Object.assign({lit: HG, solid: true}, o));
  // ---- hangar workshop corner (front west) and around the hall
  hin('portable_welding_cart', -13.2, 0, 20.2, Math.PI / 2 + .3); hin('metal_toolbox', -15.1, .98, 18.7, .2, 1, {solid: false}); hin('retro_multimeter', -15.05, .98, 21.1, -.5, 1, {solid: false});
  hin('metal_toolbox', -15.2, .98, 22.4, 1.6, 1, {solid: false}); hin('tool_cart', -18.6, 0, 15.4, Math.PI / 2); hin('hand_truck', -6.3, 0, 23.6, -.4);
  for (const [x, z, r] of [[-20.9, 22.6, 0], [-20.9, 23.5, .8], [-20.05, 23.4, 2], [-20.9, 21.7, 1.3]]) hin('barrel_01', x, 0, z, r);
  hin('metal_jerrycan', -19.3, 0, 24.5, .3, 1, {solid: false}); hin('metal_jerrycan', -18.9, 0, 24.55, -.2, 1, {solid: false});
  hin('ladder_sectioned_01', -16.8, 0, 24.95, Math.PI, 1, {solid: false, tilt: [-.2, 0]});
  hin('metal_stool_01', -14.2, 0, 17.6, .4); hin('metal_stool_01', -14.3, 0, 21.9, 1.1);
  for (const x of [-18.6, 18.6]) hin('korean_fire_extinguisher_01', x, 0, 24.75, Math.PI, 1, {solid: false});
  hin('korean_fire_extinguisher_01', 10.2, 0, -12, -Math.PI / 2, 1, {solid: false}); hin('fire_alarm', -19.6, 1.45, 25.05, Math.PI, 1, {solid: false});
  hin('wetfloorsign_01', -6, 0, 8.5, .6, 1, {min: 1}); hin('portable_generator', 6.9, 0, 22.6, -.3); hin('industrial_storage_cart', 20, 0, 21.4, -Math.PI / 2);
  hin('propane_tank', -7.0, 0, 24.75, 0, 1, {solid: false});
  for (const [x, z, r] of [[-22, 25, -2.4], [22, 25, 2.4], [-22, -25, -.8], [22, -25, .8]]) hin('security_camera_01', x * .97, 9, z * .97, r, 1.4, {solid: false, min: 1});
  for (const [x, z] of [[-12, 12.6], [-12, 10.8]]) hin('cardboard_box_01', x, 0, z, Math.random() * 3, 1.3, {solid: false, min: 1});
  hin('old_military_crate', -20.6, 0, 18.6, Math.PI / 2); hin('wooden_crate_01', -20.8, 0, 16.2, .1); hin('wooden_crate_01', -20.8, .35, 16.2, .5, 1, {solid: false});
  // ---- launch pads: floodlight masts, power cabinets, generators, gas bottles, a fire truck on standby
  const mastM = new THREE.MeshStandardMaterial({color: 0xb4bcc4, map: atex('painted_metal', 'c', 1, 6), normalMap: atex('painted_metal', 'n', 1, 6), roughnessMap: atex('painted_metal', 'r', 1, 6), roughness: 1, metalness: .4});
  for (const [px, pz] of [[260, 40], [260, -70]]) {
    for (const [dx, dz] of [[-27, -27], [-27, 27], [27, 27]]) { const x = px + dx, z = pz + dz, ry = Math.atan2(-dx, -dz);
      const gy0 = mgV(x, 0, z).y, m = new THREE.Mesh(new THREE.CylinderGeometry(.22, .4, 22, 10), mastM); m.position.set(x, gy0 + 11, z); m.castShadow = true; g.add(m); site.boxes.push({x0: x - .4, x1: x + .4, y0: 0, y1: 22, z0: z - .4, z1: z + .4});
      propPlace(PH + 'flood_lights', g, mV(x, gy0 + 21.6, z), ry, 1.3, {range: 3000}); }
    for (let i = 0; i < 2; i++) propPlace(PH + 'utility_box_01', g, mV(px + 15.5 + i * .6, 3, pz + 6), Math.PI / 2, 1.3, {solid: true, range: 500});
    propPlace(PH + 'portable_generator', g, mgV(px - 22, 0, pz - 9), .7, 1.4, {solid: true, range: 500});
    for (let i = 0; i < 4; i++) propPlace(PH + 'propane_tank', g, mgV(px - 24 + i * .5, 0, pz - 11.5 + (i % 2) * .4), i, 1.4, {range: 400, min: 1});
    propPlace(KC + 'cone', g, mgV(px - 21, 0, pz + 12), 0, 1, {range: 400, min: 1}); propPlace(KC + 'cone', g, mgV(px - 21, 0, pz + 15), 0, 1, {range: 400, min: 1}); }
  propPlace(KC + 'firetruck', g, mgV(222, 0, -14), Math.PI / 2, 1.5, {solid: .3, range: 2500}); propPlace(KC + 'ambulance', g, mgV(222, 0, -4), Math.PI / 2, 1.5, {solid: .3, range: 2500});
  // ---- parking lot west of the hangar: cars in the stalls
  { const cars = ['sedan', 'suv', 'van', 'sedan', 'delivery', 'suv', 'sedan', 'truck', 'van', 'suv'], tints = [0xffffff, 0xd8d8e8, 0xb8c8d8, 0xffe0c8, 0xe0ffe0, 0xc8c8c8]; let s = 7;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (const x of [-72, -50]) for (let i = 0; i < 12; i++) { if (rnd() < (lowGfx() ? .7 : .38)) continue; const k = cars[(rnd() * cars.length) | 0];
      propPlace(KC + k, g, mgV(x + (rnd() - .5) * .4, 0, -21.8 + i * 4.4), (x < -60 ? 0 : Math.PI) + (rnd() - .5) * .12, 1, {solid: .2, range: 1500, tint: tints[(rnd() * tints.length) | 0]}); } }
  // ---- apron + crawlerway: a flatbed, a tractor and a truck by the hangar door
  propPlace(KC + 'truck-flat', g, mgV(34, 0, 36), -.3, 1.5, {solid: .3, range: 1500}); propPlace(KC + 'tractor-shovel', g, mgV(-34, 0, 34), 2.6, 1.3, {solid: .3, range: 1200});
  propPlace(KC + 'truck', g, mgV(-30, 0, 46), 1.4, 1.4, {solid: .3, range: 1500});
  // ---- fuel farm: shipping containers and a pair of tanks; tracking station: solar field
  for (let i = 0; i < 3; i++) propPlace(KI + 'shipping-container-' + 'abc'[i], g, mgV(318, 0, 22 + i * 3.4), Math.PI / 2, 1, {solid: .1, range: 2500});
  propPlace(KI + 'shipping-container-b', g, mgV(318, 2.6, 23.7), Math.PI / 2 + .05, 1, {range: 2500});
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) propPlace(KI + 'solar-panel-landscape-group', g, mgV(130 + c * 9, 0, -240 + r * 9), 0, 1, {range: 3000, min: r > 0 ? 1 : 0});
  // ---- the grounds: ferns and shrubs by the mission control door and the welcome sign
  for (const [x, z, k] of [[-66, 83, 'fern_02'], [-78, 83, 'fern_02'], [-8, 72, 'shrub_03'], [8, 72, 'shrub_03'], [-12, 72.4, 'fern_02'], [12, 72.4, 'fern_02']]) propPlace(PH + k, g, mgV(x, 0, z), x * 3, 1.2, {range: 400, min: 1});
  // ---- mission control: real kit on the desks
  if (typeof interiorMat === 'function') { const MC = m => interiorMat(m.clone(), INT_MC);
    let c = 0; for (const [cz, by] of [[66, 0], [71, .35], [77, .7]]) for (let i = 0; i < 6; i++, c++) { const cx = -91.6 + i * 3;
      if (c % 3 === 0) propPlace(PH + 'vintage_spacecraft_instrument', g, mV(cx - .1, by + .8, cz + .15), Math.PI + .1, .9, {lit: MC, range: 120});
      else if (c % 3 === 1) propPlace(PH + 'classic_laptop', g, mV(cx + .2, by + .8, cz + .2), Math.PI - .2, .8, {lit: MC, range: 120});
      if (c % 4 === 2) propPlace(PH + 'potted_plant_04', g, mV(cx - 1.1, by + .8, cz - .1), c, 1, {lit: MC, range: 120, min: 1}); }
    propPlace(PH + 'projector_screen', g, mV(-94.6, 0, 62.6), Math.PI / 4, 1.1, {lit: MC, range: 120, solid: true});
    propPlace(PH + 'modern_arm_chair_01', g, mV(-70.2, 0, 69.4), -Math.PI / 2, 1, {lit: MC, range: 120, solid: true});
    propPlace(PH + 'korean_fire_extinguisher_01', g, mV(-96.4, 0, 79.8), Math.PI / 2, 1, {lit: MC, range: 120});
    propPlace(PH + 'potted_plant_04', g, mV(-69.6, 1.15, 76.8), 0, 1.2, {lit: MC, range: 120}); }
}

// ---------------- station / cabin furnishing sets (for walkable modules): kind -> list of [key, x, y, z, rotY, scale] in the module frame (y up, floor at y 0)
const FURNISH = {
  hab: [['kenney-station/bed-single', -1.1, 0, -1.4, 0, .9], ['kenney-station/bed-single', 1.1, 0, -1.4, 0, .9], ['kenney-station/container-tall', -1.5, 0, 1.4, Math.PI / 2, .8], ['polyhaven/potted_plant_04', 1.4, 0, 1.4, 0, 1.4]],
  lab: [['kenney-station/computer-system', -1.3, 0, -1.2, Math.PI / 2, .85], ['kenney-station/computer-screen', 1.3, 0, -1.2, -Math.PI / 2, .85], ['kenney-station/table-display', 0, 0, 1.2, 0, .8], ['kenney-station/chair-headrest', -.6, 0, -1.2, -Math.PI / 2, .9]],
  green: [['kenney-station/table-inset', -1.2, 0, 0, Math.PI / 2, .8], ['kenney-station/table-inset', 1.2, 0, 0, Math.PI / 2, .8], ['polyhaven/fern_02', -1.2, .75, 0, 0, .55], ['polyhaven/fern_02', 1.2, .75, 0, 1.4, .55]],
  cupola: [['kenney-station/chair-armrest-headrest', 0, 0, 0, Math.PI, 1], ['kenney-station/table-display-planet', 0, 0, 1.2, 0, .8]],
  depot: [['kenney-station/container', -1.3, 0, -1.2, 0, .9], ['kenney-station/container-wide', 1.2, 0, -1.2, 0, .9], ['kenney-station/container-flat-open', -1.2, 0, 1.2, Math.PI / 2, .9], ['polyhaven/metal_jerrycan', 1.2, 0, 1.3, .4, 1.2]],
  galley: [['kenney-station/table', 0, 0, 0, 0, .9], ['kenney-station/chair-cushion', -.8, 0, 0, Math.PI / 2, .9], ['kenney-station/chair-cushion', .8, 0, 0, -Math.PI / 2, .9]],
  console: [['kenney-station/computer-wide', 0, 0, 0, 0, .85], ['kenney-station/chair-headrest', 0, 0, .9, Math.PI, .9]],
};
// fill a module: returns the Group (props arrive as they load). opt.lit maps materials (e.g. m => interiorMat(m.clone(), INT_CAB)), opt.s scales the layout.
function furnish(kind, parent, opt = {}) { const g = new THREE.Group(), s = opt.s || 1; parent.add(g);
  for (const [k, x, y, z, ry, sc] of FURNISH[kind] || []) propPlace(k, g, mV(x * s, y, z * s), ry, sc, {lit: opt.lit, min: opt.min}); return g; }

// ---------------- boulders on airless worlds: photoscanned rocks around wherever you walk (instanced, re-scattered as you move)
const ROCK_KEYS = ['polyhaven/moon_rock_01', 'polyhaven/moon_rock_02', 'polyhaven/moon_rock_04', 'polyhaven/moon_rock_06'];
const ROCK_TINT = {Moon: 0xffffff, Rust: 0xd08a60, Frost: 0xe8f0ff, Ember: 0x6a6460, Pebble: 0xb8b0a4};
function rocksInit() { if (MDL.rocks) return; MDL.rocks = {sets: [], body: null, at: new V3(), list: []};
  Promise.all(ROCK_KEYS.map(mdlGet)).then(ts => { for (const t of ts) { let mesh = null; t.traverse(o => { if (o.isMesh && !mesh) mesh = o; }); if (!mesh) continue; t.updateMatrixWorld(true);
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld); geo.computeBoundingBox(); const n = lowGfx() ? 10 : 26, im = new THREE.InstancedMesh(geo, mesh.material, n);
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = 0; im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      MDL.rocks.sets.push({im, n, h: geo.boundingBox.max.y, w: Math.max(geo.boundingBox.max.x - geo.boundingBox.min.x, geo.boundingBox.max.z - geo.boundingBox.min.z)}); } }).catch(() => {}); }
const _mdrq = new Q4(), _mdrm = new THREE.Matrix4(), _mdrs = new V3(), _mdrp = new V3(), _mdru = new V3(), _mdrt1 = new V3(), _mdrt2 = new V3(), _mdrc = new THREE.Color();
function rocksScatter(b) { const RK = MDL.rocks; RK.body = b; RK.at.copy(P.pos); RK.list = [];
  let s = (Math.floor(P.pos.x / 97) * 73856093 ^ Math.floor(P.pos.y / 97) * 19349663 ^ Math.floor(P.pos.z / 97) * 83492791) >>> 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const up = _mdru.copy(P.pos).normalize(); _mdrt1.set(up.y, -up.x, 0); if (_mdrt1.lengthSq() < 1e-6) _mdrt1.set(1, 0, 0); _mdrt1.normalize(); _mdrt2.crossVectors(up, _mdrt1);
  _mdrc.set(ROCK_TINT[b.name] || 0xffffff);
  for (const S of RK.sets) { if (S.im.parent !== b.group) b.group.add(S.im); let k = 0;
    for (let i = 0; i < S.n; i++) { const a = rnd() * 6.283, d = 14 + Math.sqrt(rnd()) * 230, big = rnd() < .12; const sc = (big ? 18 + rnd() * 22 : 4 + rnd() * 12) * (b === PEBBLE ? .7 : 1);
      _mdrp.copy(P.pos).addScaledVector(_mdrt1, Math.cos(a) * d).addScaledVector(_mdrt2, Math.sin(a) * d); const gr = groundR(b, _mdrp); _mdrp.setLength(gr - S.h * sc * (.15 + rnd() * .2));
      _mdrq.setFromUnitVectors(_mdrs.set(0, 1, 0), _mdru.copy(_mdrp).normalize()).multiply(new Q4().setFromAxisAngle(_mdrs.set(0, 1, 0), rnd() * 6.283));
      S.im.setMatrixAt(k, _mdrm.compose(_mdrp, _mdrq, _mdrs.setScalar(sc))); S.im.setColorAt(k, _mdrc); k++; if (sc * S.w > 1.2) RK.list.push({p: _mdrp.clone(), r: sc * S.w * .42, top: S.h * sc * .7}); }
    S.im.count = k; S.im.instanceMatrix.needsUpdate = true; S.im.instanceColor.needsUpdate = true; S.im.visible = true; } }
function rocksFrame() { const RK = MDL.rocks; if (!RK || !RK.sets.length) return; const b = P.body, on = G.on && b !== PLANET && !b.atmo;
  if (!on) { for (const S of RK.sets) S.im.visible = false; RK.body = null; return; }
  if (RK.body !== b || RK.at.distanceTo(P.pos) > 140) rocksScatter(b); }
// walk around boulders, not through them
{ const s0 = stepPlayer; stepPlayer = function (dt) { s0(dt); const RK = MDL.rocks; if (!RK || RK.body !== P.body || R.on && C.in) return;
    for (const k of RK.list) { _mdrp.copy(P.pos).sub(k.p); const up = _mdru.copy(k.p).normalize(), h = _mdrp.dot(up); if (h > k.top) continue; _mdrp.addScaledVector(up, -h); const d = _mdrp.length();
      if (d < k.r + .35 && d > 1e-4) { P.pos.addScaledVector(_mdrp, (k.r + .35 - d) / d); const vn = P.vel.dot(_mdrp) / d; if (vn < 0) P.vel.addScaledVector(_mdrp, -vn / d); } } }; }

// ---------------- sounds: samples decoded on the first input (sndInit), layered over the procedural engine
const SMP = {buf: {}, loops: {}, base: 'assets/sfx/', step: 0, amb: {},
  files: {liftoff: 'liftoff_rumble', stage: 'staging_thud', stage2: 'kenney/lowFrequency_explosion_000', dock: 'dock_clunk', dock2: 'dock_clunk_light', hiss: 'airlock_hiss', boom: 'explosion_big', boom2: 'kenney/explosionCrunch_002',
    land: 'kenney/impactPlate_heavy_001', pop0: 'kenney/impactMetal_light_000', pop1: 'kenney/impactMetal_light_001', pop2: 'kenney/impactMetal_light_002',
    eng: 'rocket_engine_loop', thrust: 'rocket_thrust_loop', crk: 'booster_crackle', wind: 'wind_loop', hangar: 'hangar_ambience_loop', buzz: 'fluorescent_buzz_loop', mc: 'control_room_hum_loop',
    cabin: 'station_ambience_loop', hum: 'scifi_hum_loop', space: 'space_ambience_loop',
    fc0: 'kenney/footstep_concrete_000', fc1: 'kenney/footstep_concrete_001', fc2: 'kenney/footstep_concrete_002', fc3: 'kenney/footstep_concrete_003', fc4: 'kenney/footstep_concrete_004',
    fp0: 'kenney/footstep_carpet_000', fp1: 'kenney/footstep_carpet_001', fp2: 'kenney/footstep_carpet_002', fp3: 'kenney/footstep_carpet_003', fp4: 'kenney/footstep_carpet_004',
    fs0: 'kenney/footstep_snow_000', fs1: 'kenney/footstep_snow_001', fs2: 'kenney/footstep_snow_002', fs3: 'kenney/footstep_snow_003', fs4: 'kenney/footstep_snow_004',
    fd0: 'footstep_dust_000', fd1: 'footstep_dust_001', fd2: 'footstep_dust_002', fd3: 'footstep_dust_003', fd4: 'footstep_dust_004'}};
const LOOPS = ['eng', 'thrust', 'crk', 'wind', 'hangar', 'buzz', 'mc', 'cabin', 'hum', 'space'];
function smpLoad() { const c = SND.c; if (!c || SMP.started) return; SMP.started = true;
  for (const [k, f] of Object.entries(SMP.files)) fetch(SMP.base + f + '.ogg').then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(a => c.decodeAudioData(a)).then(b => { SMP.buf[k] = b; if (LOOPS.includes(k)) smpLoop(k); }).catch(() => {}); }
function smpLoop(k) { const c = SND.c, s = c.createBufferSource(), g = c.createGain(); s.buffer = SMP.buf[k]; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(SND.out); s.start(0, Math.random() * SMP.buf[k].duration); SMP.loops[k] = {s, g}; }
function smp(k, gain = 1, rate = 1) { const c = SND.c, b = SMP.buf[k]; if (!c || !b) return false; const s = c.createBufferSource(), g = c.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain; s.connect(g); g.connect(SND.out); s.start(); return true; }
const smpAny = (p, n, gain, rate) => smp(p + ((Math.random() * n) | 0), gain, rate);
function loopTo(k, v, tc = .3) { const L = SMP.loops[k]; if (L) L.g.gain.setTargetAtTime(v, SND.c.currentTime, tc); }
{ const i0 = sndInit; sndInit = function () { i0(); smpLoad(); }; }
{ const f0 = sfx; sfx = function (kind) {
    if (kind === 'clamp' && smp('liftoff', .8)) { f0('clamp'); return; }
    if (kind === 'thud') { smp('stage', .55, .95 + Math.random() * .1); if (R.st === 'landed' || R.st === 'pad') smp('land', .5); return f0(kind); }
    if (kind === 'boom' && smp('boom', .9)) { smp('boom2', .6); return f0(kind); }
    if (kind === 'pop') smpAny('pop', 3, .28, .9 + Math.random() * .2);
    return f0(kind); }; }
// engine loops, wind, ambience by place, docking clunks, footsteps
const _mdsc = new V3(), _mdsqi = new Q4();
function placeOf() { if (R.on && C.in) return 'cabin'; if (P.body !== PLANET || !site.p) return 'out';
  const c = bodyToSite(P.pos, _mdsc); if (Math.abs(c.x) < 22.4 && Math.abs(c.z) < 25.4 && c.y < 30) return 'hangar'; if (c.x > -97 && c.x < -67 && c.z > 59 && c.z < 81 && c.y < 11) return 'mc'; return 'out'; }
{ const u0 = sndUpdate; sndUpdate = function () { u0(); const c = SND.c; if (!c || !SMP.started) return;
    let e = R.F > 0 ? Math.max(R.thr, STAGES[R.bot].srb ? 1 : 0) : 0; const near = R.on ? 1 : clamp(1 - G.O.distanceTo(R.pos) / 4000, 0, 1) ** 2, air = .25 + .75 * Math.min(1, R.p * 2), big = clamp(actS().thrust / 1.5e6, 0, 1);
    e *= near * air; loopTo('eng', e * (.55 - .25 * big), .08); loopTo('thrust', e * (.25 + .5 * big), .1); loopTo('crk', R.F > 0 && STAGES[R.bot].hot ? e * .35 : 0, .1);
    const pl = G.on ? placeOf() : 'menu', outHome = pl === 'out' && P.body === PLANET && !R.on;
    loopTo('wind', outHome ? .05 + Math.min(.12, P.vel.length() / 120) : 0, .8); loopTo('hangar', pl === 'hangar' ? .14 : 0, .6); loopTo('buzz', pl === 'hangar' ? .035 : 0, .6);
    loopTo('mc', pl === 'mc' ? .12 : 0, .6); loopTo('cabin', pl === 'cabin' ? .09 : 0, .8); loopTo('hum', pl === 'cabin' || DK && DK.V && R.st === 'docked' ? .04 : 0, .8);
    const hi = R.on ? R.pos.distanceTo(R.body.c) - R.body.R > (R.body.atmo || 0) : P.body !== PLANET; loopTo('space', G.on && hi && pl !== 'cabin' ? .05 : 0, 1.5); }; }
function sndFrame(dt) { if (!SND.c || !SMP.started || !G.on || G.paused) return;
  // docking latch / undock
  if (R.st !== SMP.st) { if (R.st === 'docked') { smp('dock', .7); setTimeout(() => smp('hiss', .35), 900); } else if (SMP.st === 'docked') smp('dock2', .5); SMP.st = R.st; }
  // footsteps: on foot and in the cabin
  const inCab = R.on && C.in, v = inCab ? C.vel.length() : P.vel.length(), grd = inCab ? true : P.ground;
  if (!grd || v < .8) { SMP.step = Math.min(SMP.step, .15); return; }
  if ((SMP.step -= dt * Math.min(v, 7) / 1.6) > 0) return; SMP.step = 1;
  const pl = placeOf(), b = P.body, onSite = b === PLANET && site.p && Math.hypot(bodyToSite(P.pos, _mdsc).x, _mdsc.z) < 420;
  const k = inCab || pl === 'mc' ? 'fp' : pl === 'hangar' || onSite ? 'fc' : b === FROST ? 'fs' : 'fd';
  smpAny(k, 5, (k === 'fd' ? .45 : .3) * (b !== PLANET && !inCab ? .7 : 1), .9 + Math.random() * .2); }

// ---------------- hooks
{ const v0 = FLIGHT.visuals; let pt = 0; FLIGHT.visuals = function (dt) { v0.call(this, dt);
    if (!MDL.siteDone && G.on && site.g) siteProps();
    if (!MDL.rocks && G.on) rocksInit(); if (G.on) rocksFrame();
    sndFrame(dt);
    if ((pt -= dt) <= 0 && site.p) { pt = .5; const c = bodyToSite(_mdsc.copy(G.O).sub(PLANET.c).applyQuaternion(_mdsqi.copy(PLANET.q).invert()), _mdsc);
      for (const p of MDL.props) p.g.visible = p.at.distanceTo(c) < p.r; } }; }
// warm the loader once the menu is up (idle time), so props arrive soon after Play
setTimeout(() => { try { mdlLib(); } catch (e) {} }, 2500);
Object.assign(window.YE || (window.YE = {}), {MDL, mdlGet, propPlace, furnish, FURNISH, SMP, siteProps, rocksScatter});
