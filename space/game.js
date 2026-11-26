'use strict';
// Lucas Space Program. Step 1: planet + moon (cube-sphere quadtree terrain), ray-marched atmosphere post pass, day/night, space centre, walking.
// Frames: "inertial" = world, planet centre at 0, sun fixed. Bodies rotate (planet about +Y). Body-fixed coords = inertial rotated back.
// Rendering uses a floating origin: the camera sits at 0 and everything is placed relative to O (the camera's inertial position).
const $ = id => document.getElementById(id);
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
// sun shadows only cover a square around the camera: fade them out toward its edge so the square never shows
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace('return mix( 1.0, shadow, shadowIntensity );',
  'vec2 shE = abs(shadowCoord.xy - .5); return mix(1.0, mix( 1.0, shadow, shadowIntensity ), 1. - smoothstep(.3, .48, max(shE.x, shE.y)));');
// two shadow cascades: sunL (near, +-260 m) and sunL2 (far, +-3 km, intensity 0: only its shadow map is used). The near map wins where it reaches, the far one fills in outside
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;', `
		#if UNROLLED_LOOP_INDEX == 0
		{ float s0 = getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
		#if NUM_DIR_LIGHT_SHADOWS > 1
		vec2 e0 = abs(vDirectionalShadowCoord[ 0 ].xy / vDirectionalShadowCoord[ 0 ].w - .5); float in0 = 1. - smoothstep(.3, .48, max(e0.x, e0.y));
		if (in0 < 1.) s0 -= (1. - in0) * (1. - getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] ));
		#endif
		directLight.color *= ( directLight.visible && receiveShadow ) ? s0 : 1.0; }
		#endif`);
const SET = Object.assign({gfx: 'high', name: ''}, (() => { try { return JSON.parse(localStorage.getItem('ye-set') || '{}'); } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('ye-set', JSON.stringify(SET)); } catch (e) {} };
const HI = () => SET.gfx !== 'low'; // Medium and High share the full renderer; Medium (and High when frames drop) trims the costly passes
const LITE = () => SET.gfx === 'med' || !!G.lite;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------- noise
function hsh(i, j, k, s) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683) + Math.imul(s, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10), w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const a = lerp(hsh(xi, yi, zi, s), hsh(xi + 1, yi, zi, s), u), b = lerp(hsh(xi, yi + 1, zi, s), hsh(xi + 1, yi + 1, zi, s), u);
  const c = lerp(hsh(xi, yi, zi + 1, s), hsh(xi + 1, yi, zi + 1, s), u), d = lerp(hsh(xi, yi + 1, zi + 1, s), hsh(xi + 1, yi + 1, zi + 1, s), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w) * 2 - 1;
}
function fbm(x, y, z, o, s) { let t = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { t += a * noise3(x * f, y * f, z * f, s + i); f *= 2.03; a *= .5; } return t; }
function ridged(x, y, z, o, s) { let t = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { const n = 1 - Math.abs(noise3(x * f, y * f, z * f, s + i)); t += a * n * n; f *= 2.1; a *= .5; } return t; }

// ---------------- solar system (semi-real: small planet, real gravity)
const SUN = new V3(1, .18, .35).normalize(); // inertial direction to the sun
const PLANET = {name: 'Home', R: 600000, GM: 9.81 * 600000 * 600000, atmo: 22000, day: 21600, maxL: 15, seed: 11, water: true};
// satellites of Home on rails (circular, tilted orbits). ph = starting angle, inc = tilt, lan = where the tilt's axis points
const MOON = {name: 'Moon', R: 200000, GM: 1.63 * 200000 * 200000, atmo: 0, maxL: 14, seed: 71, water: false, orbit: 12000000, ph: 2.2, inc: .09, lan: 0, col: [.42, .42, .42]};
const RUST = {name: 'Rust', R: 140000, GM: 1.1 * 140000 * 140000, atmo: 0, maxL: 14, seed: 131, water: false, orbit: 30000000, ph: 4.1, inc: .06, lan: 1.3, col: [.62, .34, .2], desc: 'red desert world: canyons, dunes, old craters'};
const FROST = {name: 'Frost', R: 90000, GM: .6 * 90000 * 90000, atmo: 0, maxL: 13, seed: 171, water: false, orbit: 52000000, ph: .7, inc: .045, lan: 3.6, col: [.86, .9, .95], desc: 'ice world: cracked plains, blue ridges, few craters'};
const EMBER = {name: 'Ember', R: 120000, GM: 1.3 * 120000 * 120000, atmo: 0, maxL: 14, seed: 211, water: false, orbit: 20000000, ph: 5.3, inc: .11, lan: 2.4, col: [.3, .15, .1], lava: .45, desc: 'volcanic moon: black lava plains, glowing rivers, Fire Mountain'};
const PEBBLE = {name: 'Pebble', R: 8000, GM: .15 * 8000 * 8000, atmo: 0, maxL: 10, seed: 251, water: false, orbit: 4000000, ph: 1.1, inc: .21, lan: .8, col: [.38, .35, .31], desc: 'tiny lumpy asteroid: you weigh almost nothing'};
const SATS = [MOON, RUST, FROST, EMBER, PEBBLE];
for (const b of SATS) b.period = 2 * Math.PI * Math.sqrt(b.orbit ** 3 / PLANET.GM);
const BODIES = [PLANET, ...SATS];
const SITE = new V3(1, 0, 0); // space centre direction (body-fixed), on the equator
const SITE_H = 20; // flattened ground height at the space centre
const G = {t: 0, warp: 1};
// time of day: start in the morning at the space centre
const T0 = -PLANET.day * .19;
function bodyState(b, t) { // centre (inertial) and rotation
  if (b === PLANET) { b.c = b.c || new V3(); b.c.set(0, 0, 0); b.q = b.q || new Q4(); b.q.setFromAxisAngle(new V3(0, 1, 0), 2 * Math.PI * (t + T0) / PLANET.day); return; }
  const a = 2 * Math.PI * t / b.period + b.ph, inc = b.inc, cl = Math.cos(b.lan), sl = Math.sin(b.lan), px = Math.cos(a) * b.orbit, py = Math.sin(a) * Math.sin(inc) * b.orbit, pz = -Math.sin(a) * Math.cos(inc) * b.orbit;
  b.c = b.c || new V3(); b.c.set(px * cl + pz * sl, py, -px * sl + pz * cl);
  b.q = b.q || new Q4(); b.q.setFromAxisAngle(new V3(0, 1, 0), a + Math.PI + b.lan); // tidally locked
}

// ---------------- heights
const CRATERS = (() => { const out = []; let s = 7; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 700; i++) { const z = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - z * z); const big = i < 18;
    const rad = big ? 20000 + r() * 30000 : Math.min(19000, 1100 / Math.pow(1 - r() * .985, .62));
    const c = {d: new V3(q * Math.cos(a), z, q * Math.sin(a)), r: rad, young: !big && rad > 4000 && i % 61 === 3, seed: i}; c.cos = Math.cos(Math.min(1.5, 7 * rad / 200000)); out.push(c); }
  return out; })();
MOON.craters = CRATERS;
function makeCraters(seed, n, nBig, R, bigMin, bigMax, small, maxR) { const out = []; let s = seed; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) { const z = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - z * z), big = i < nBig, rad = big ? bigMin + r() * (bigMax - bigMin) : Math.min(maxR, small / Math.pow(1 - r() * .985, .62));
    const c = {d: new V3(q * Math.cos(a), z, q * Math.sin(a)), r: rad, young: false, seed: i}; c.cos = Math.cos(Math.min(1.5, 7 * rad / R)); out.push(c); } return out; }
RUST.craters = makeCraters(1311, 240, 6, RUST.R, 12000, 26000, 900, 11000);
FROST.craters = makeCraters(1711, 90, 2, FROST.R, 8000, 14000, 700, 6000);
EMBER.craters = makeCraters(2111, 50, 1, EMBER.R, 9000, 14000, 800, 5000);
PEBBLE.craters = makeCraters(2511, 46, 3, PEBBLE.R, 1200, 2200, 110, 900);
// Ember's volcanoes: Fire Mountain (7 km, a lava lake in its caldera) and a scatter of small cones
EMBER.fm = new V3(.32, .22, .92).normalize();
EMBER.cones = (() => { const out = []; let s = 77; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; for (let i = 0; i < 16; i++) { const z = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - z * z); out.push({d: new V3(q * Math.cos(a), z, q * Math.sin(a)), r: 2500 + r() * 4000, h: 500 + r() * 1500}); } return out; })();
let CR_NEAR = null; // craters that can touch the chunk being built
// shared crater shape: bowl, flat floor for big ones, central peak, raised rim (eroded = softer, shallower)
function craterH(b, x, y, z, erode) { let h = 0; const CL = CR_NEAR || b.craters;
  for (let i = 0; i < CL.length; i++) { const c = CL[i]; const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < c.cos) continue;
    const d = Math.acos(Math.min(1, dd)) * b.R / c.r; if (d > 2.2) continue;
    const depth = c.r * (c.r > 1500 ? .12 : .3) * erode, rim = c.r * .07 * erode;
    h += d < 1 ? Math.max(-depth, depth * (d * d - 1)) * (1 - d ** 8) + rim * d ** 6 + (c.r > 1500 ? c.r * .06 * erode * Math.exp(-((d / .16) ** 2)) : 0) : rim * Math.exp(-(((d - 1) * 2.6) ** 2)); }
  return h; }
// Rust: wind-worn red highlands, deep canyons, old soft craters, dune fields in the lowlands
function rustH(x, y, z) { let h = fbm(x * 2.2 + 3, y * 2.2, z * 2.2, 6, 201) * 3000 + fbm(x * 28, y * 28, z * 28, 4, 202) * 260 + fbm(x * 260, y * 260, z * 260, 3, 203) * 28;
  const cn = ridged(x * 3.2 + 1, y * 3.2, z * 3.2, 5, 204); h -= Math.pow(Math.max(0, cn - .45), 1.5) * 5200; // canyon network
  const low = sstep(200, -900, h); h += low * Math.abs(noise3(x * 1800 + noise3(x * 90, y * 90, z * 90, 206) * 3, y * 1800, z * 1800, 205)) * 9; // dune ripples on low ground
  return h + craterH(RUST, x, y, z, .55) + microCraters(x * RUST.R / 900, y * RUST.R / 900, z * RUST.R / 900, 900 * .4) + microCraters(x * RUST.R / 60, y * RUST.R / 60, z * RUST.R / 60, 60 * .5) + noise3(x * 9000, y * 9000, z * 9000, 207) * 1.5; }
// Frost: smooth ice plains split by raised blue ridges (cracks), a few fresh craters
function frostH(x, y, z) { const cr = ridged(x * 7 + 2, y * 7, z * 7, 4, 301), cr2 = ridged(x * 26, y * 26, z * 26, 3, 302);
  return fbm(x * 2 + 9, y * 2, z * 2, 5, 303) * 1400 + Math.pow(cr, 6) * 520 + Math.pow(cr2, 8) * 120 + fbm(x * 300, y * 300, z * 300, 3, 304) * 12 + craterH(FROST, x, y, z, 1) + microCraters(x * FROST.R / 400, y * FROST.R / 400, z * FROST.R / 400, 400 * .3) + noise3(x * 8000, y * 8000, z * 8000, 305) * .8; }
// Ember: black lava plains, low ash hills, volcano cones; returns height (m)
function emberFM(x, y, z) { const f = EMBER.fm; return Math.acos(clamp(x * f.x + y * f.y + z * f.z, -1, 1)) * EMBER.R; } // metres from Fire Mountain's summit
function emberH(x, y, z) { let h = fbm(x * 2.5 + 1, y * 2.5, z * 2.5, 6, 401) * 1800 + fbm(x * 30, y * 30, z * 30, 4, 402) * 180 + fbm(x * 300, y * 300, z * 300, 3, 403) * 16;
  const low = sstep(250, -450, h); h = lerp(h, -420 + fbm(x * 80, y * 80, z * 80, 3, 404) * 25, low * .85); // flooded lowlands (lava plains)
  const dF = emberFM(x, y, z); if (dF < 30000) { const u = dF / 26000; h += 7200 * Math.pow(Math.max(0, 1 - u), 1.8) * (1 + .06 * fbm(x * 60, y * 60, z * 60, 3, 405)); if (dF < 2600) h -= 1500 * (1 - (dF / 2600) ** 2); } // the cone, then the caldera
  for (const c of EMBER.cones) { const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < .95) continue; const d = Math.acos(Math.min(1, dd)) * EMBER.R / c.r; if (d > 1.2) continue; h += c.h * Math.pow(Math.max(0, 1 - d), 1.6) - (d < .12 ? c.h * .25 * (1 - (d / .12) ** 2) : 0); }
  return h + craterH(EMBER, x, y, z, .35) + microCraters(x * EMBER.R / 500, y * EMBER.R / 500, z * EMBER.R / 500, 500 * .25) + noise3(x * 9000, y * 9000, z * 9000, 407) * 1.5; }
function emberLava(x, y, z, h) { // 0..1: glowing lava (rivers on the plains, the lake in Fire Mountain's caldera)
  const riv = Math.pow(ridged(x * 9 + 4, y * 9, z * 9, 4, 410), 7) * sstep(-250, -400, h), dF = emberFM(x, y, z), lake = dF < 1700 ? sstep(1700, 1300, dF) : 0;
  return clamp(Math.max(sstep(.18, .3, riv), lake), 0, 1); }
// Pebble: a lumpy, stretched potato of rock with craters
function pebbleH(x, y, z) { return fbm(x * .9 + 2, y * .9, z * .9, 3, 501) * 3600 + fbm(x * 3, y * 3, z * 3, 4, 502) * 800 + fbm(x * 30, y * 30, z * 30, 3, 503) * 50 + (x * x - .33) * 2400
  + craterH(PEBBLE, x, y, z, 1) + microCraters(x * PEBBLE.R / 120, y * PEBBLE.R / 120, z * PEBBLE.R / 120, 120 * .4) + microCraters(x * PEBBLE.R / 14, y * PEBBLE.R / 14, z * PEBBLE.R / 14, 14 * .5) + noise3(x * 4000, y * 4000, z * 4000, 504) * .6; }
// moon features shared by height and colour
function mareAt(x, y, z) { return sstep(-.02, .2, fbm(x * 1.15 + 5, y * 1.15, z * 1.15, 5, 101) + fbm(x * 9, y * 9, z * 9, 3, 102) * .06); }
function microCraters(px, py, pz, amp) { // 2x2x2 nearest cells, one crater per cell (60%)
  let h = 0; const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz), ox = px - ix < .5 ? -1 : 0, oy = py - iy < .5 ? -1 : 0, oz = pz - iz < .5 ? -1 : 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) { const cx = ix + ox + a, cy = iy + oy + b, cz = iz + oz + c;
    if (hsh(cx, cy, cz, 3) > .45) continue; const rr = .07 + Math.pow(hsh(cx, cy, cz, 4), 3) * .42, dx = px - cx - hsh(cx, cy, cz, 5), dy = py - cy - hsh(cx, cy, cz, 6), dz = pz - cz - hsh(cx, cy, cz, 7);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / rr; if (d > 1.8) continue;
    h += (d < 1 ? (d * d - 1) * .35 + .06 * d ** 6 : .06 * Math.exp(-(((d - 1) * 3.5) ** 2))) * rr * amp; }
  return h; }
function siteDist(x, y, z) { return Math.acos(clamp(x * SITE.x + y * SITE.y + z * SITE.z, -1, 1)) * PLANET.R; }
function heightAt(b, x, y, z) { // unit direction, body-fixed -> metres above sea level / datum
  if (b === PLANET) {
    const ox = 13.1, cont = fbm(x * 1.8 + ox, y * 1.8, z * 1.8, 7, 1);
    let h = cont * 4200 - 200;
    const m = ridged(x * 7, y * 7, z * 7, 7, 9); h += m * m * 4800 * sstep(-.05, .35, cont);
    h += fbm(x * 60, y * 60, z * 60, 4, 20) * 260 + fbm(x * 500, y * 500, z * 500, 3, 30) * 45 + fbm(x * 4000, y * 4000, z * 4000, 3, 35) * 7 + noise3(x * 30000, y * 30000, z * 30000, 40) * 1.2;
    const sd = siteDist(x, y, z);
    if (sd < 26000) { // the space centre's island: plains round the site, sea to the east (launches go out over water), hills, a mountain range to the west
      const ex = -z * PLANET.R, ny = y * PLANET.R, w = fbm(x * 140, y * 140, z * 140, 4, 51); // ex = metres east, ny = metres north of the site
      const dI = Math.hypot(ex * (ex > 0 ? 1 : .28), ny * .78) / (3300 * (1 + .45 * w)); // 1 = coastline
      let hi = 26 * sstep(1.02, .84, dI) - 70 * sstep(1, 1.6, dI) + fbm(x * 2600, y * 2600, z * 2600, 3, 54) * 4;
      hi += fbm(x * 900, y * 900, z * 900, 4, 52) * 60 * sstep(2000, 4200, sd) * sstep(1.05, .8, dI); // rolling hills inland
      const mtn = sstep(3200, 8500, -ex + w * 1800) * sstep(1.3, .85, dI);
      if (mtn > 0) { const r2 = ridged(x * 260, y * 260, z * 260, 6, 53); hi += (r2 * r2 * 3600 + fbm(x * 700, y * 700, z * 700, 3, 55) * 160) * mtn; }
      h = lerp(hi, h, sstep(15000, 26000, sd));
      h = lerp(h, SITE_H + sd * sd / (2 * PLANET.R), 1 - sstep(1500, 2300, sd)); } // flat plane (tangent to the planet) under the space centre
    return h;
  }
  if (b === RUST) return rustH(x, y, z); if (b === FROST) return frostH(x, y, z); if (b === EMBER) return emberH(x, y, z); if (b === PEBBLE) return pebbleH(x, y, z);
  const mare = mareAt(x, y, z);
  let h = (fbm(x * 3, y * 3, z * 3, 6, 3) * 2400 + fbm(x * 40, y * 40, z * 40, 4, 6) * 220 + fbm(x * 400, y * 400, z * 400, 3, 12) * 25) * (1 - .75 * mare) - 1400 * mare + noise3(x * 9000, y * 9000, z * 9000, 8) * 2.5;
  const CL = CR_NEAR || CRATERS; for (let i = 0; i < CL.length; i++) { const c = CL[i]; const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < c.cos) continue;
    const d = Math.acos(Math.min(1, dd)) * MOON.R / c.r; if (d > 2.2) continue;
    const depth = c.r * (c.r > 1500 ? .12 : .32), rim = c.r * .07;
    h += d < 1 ? Math.max(-depth, depth * (d * d - 1)) * (1 - d ** 8) + rim * d ** 6 + (c.r > 1500 ? c.r * .07 * Math.exp(-((d / .16) ** 2)) : 0) // bowl, flat floor, central peak
      : rim * Math.exp(-(((d - 1) * 2.6) ** 2)); }
  const k = 1 - .5 * mare; h += microCraters(x * MOON.R / 3000, y * MOON.R / 3000, z * MOON.R / 3000, 3000 * k) + microCraters(x * MOON.R / 420, y * MOON.R / 420, z * MOON.R / 420, 420 * k) + microCraters(x * MOON.R / 95, y * MOON.R / 95, z * MOON.R / 95, 95 * k) + microCraters(x * MOON.R / 22, y * MOON.R / 22, z * MOON.R / 22, 22 * k) + microCraters(x * MOON.R / 6, y * MOON.R / 6, z * MOON.R / 6, 5 * k);
  return h;
}
// colour (linear rgb) for a vertex
const _c = {r: 0, g: 0, b: 0}, _wt = [0, 0, 0, 0]; // material weights: grass, sand, rock, snow
function lin(v) { return Math.pow(v, 2.2); }
function colorAt(b, x, y, z, h, slope) {
  let r, g, bl;
  if (b === PLANET) {
    const n = fbm(x * 220, y * 220, z * 220, 2, 60) * .5 + .5, lat = Math.abs(y), sd = siteDist(x, y, z);
    // climate: temperature from latitude + height, moisture from large noise, dry belt in the subtropics (like Earth's deserts)
    const wetN = fbm(x * 2.6 + 7, y * 2.6, z * 2.6, 5, 77) * .5 + .5, tN = fbm(x * 4 + 3, y * 4, z * 4, 3, 78);
    const L = Math.asin(Math.min(1, lat)) / 1.5708, dry = sstep(.12, .2, L) * (1 - sstep(.36, .46, L)), temp = 1 - L * 1.1 - Math.max(0, h) / 6500 + tN * .12; // L: 0 equator, 1 pole
    let moist = clamp(wetN * 1.35 - .12 - dry * .45 + (1 - sstep(0, .1, L)) * .25, 0, 1);
    const near = 1 - sstep(4000, 14000, sd); moist = lerp(moist, .5 + (n - .5) * .3, near); // green, mixed country around the space centre
    let sand = 0, des = 0;
    if (h < -2) { const dp = sstep(-2, -60, h); r = lerp(.5, .03, dp); g = lerp(.47, .07, dp); bl = lerp(.36, .1, dp); sand = 1; } // sea floor: sand in the shallows, dark further out
    else if (h < 4 + n * 10 && sd > 2300) { r = .82; g = .74; bl = .52; sand = 1; } // beach
    else {
      const p2 = fbm(x * 1400, y * 1400, z * 1400, 2, 61) * .5 + .5; // small patches: meadows, scrub, darker woods
      des = 1 - sstep(.12, .32, moist); const red = sstep(.35, .8, fbm(x * 14, y * 14, z * 14, 4, 79) * .5 + .5);
      // desert -> dry grass -> grassland -> forest
      r = lerp(.82, .76, red); g = lerp(.67, .53, red); bl = lerp(.42, .3, red);
      const sv = sstep(.12, .32, moist); r = lerp(r, .6, sv); g = lerp(g, .53, sv); bl = lerp(bl, .29, sv);
      const gr = sstep(.3, .5, moist); r = lerp(r, .39 + (p2 - .5) * .06, gr); g = lerp(g, .47 + (p2 - .5) * .05, gr); bl = lerp(bl, .24, gr);
      const fo = sstep(.5, .8, moist) * sstep(.3, .7, n * .7 + p2 * .3 + moist * .3); r = lerp(r, .21, fo); g = lerp(g, .31, fo); bl = lerp(bl, .15, fo);
      // cold: boreal forest, then tundra
      const bo = 1 - sstep(.24, .4, temp); r = lerp(r, lerp(.4, .2, sstep(.3, .6, moist)), bo * .8); g = lerp(g, lerp(.42, .27, sstep(.3, .6, moist)), bo * .8); bl = lerp(bl, lerp(.33, .19, sstep(.3, .6, moist)), bo * .8);
      const tu = 1 - sstep(.1, .22, temp); r = lerp(r, .5, tu); g = lerp(g, .48, tu); bl = lerp(bl, .41, tu);
      sand = des * (1 - bo); }
    const rock = Math.max(sstep(.35, .6, slope), sstep(2300, 3100, h + n * 500));
    const rk = des > .5 ? [.6, .46, .34] : [.42, .39, .36]; // desert rock is red-brown
    r = lerp(r, rk[0], rock); g = lerp(g, rk[1], rock); bl = lerp(bl, rk[2], rock);
    const snow = Math.max(sstep(3200, 3800, h + n * 600 + (1 - temp) * 1200 - 700), sstep(.8, .87, L + n * .04)) * (1 - sstep(.55, .75, slope));
    r = lerp(r, .95, snow); g = lerp(g, .96, snow); bl = lerp(bl, 1, snow);
    _wt[0] = (1 - sand) * (1 - rock) * (1 - snow); _wt[1] = sand * (1 - rock) * (1 - snow); _wt[2] = rock * (1 - snow); _wt[3] = snow;
  } else if (b === RUST) { _wt[0] = 0; _wt[1] = .7; _wt[2] = .3; _wt[3] = 0;
    // rusty dust, darker basalt patches and canyon floors, pale dust on the heights
    const n = fbm(x * 24, y * 24, z * 24, 3, 210) * .5 + .5, ba = sstep(.1, .3, fbm(x * 1.6 + 4, y * 1.6, z * 1.6, 4, 211)), hi = sstep(500, 2600, h), lo = sstep(-300, -2500, h);
    r = lerp(.6, .5, n) ; g = lerp(.33, .27, n); bl = lerp(.19, .16, n);
    r = lerp(r, .34, ba * .7); g = lerp(g, .22, ba * .7); bl = lerp(bl, .17, ba * .7);
    r = lerp(r, .76, hi * .6); g = lerp(g, .52, hi * .6); bl = lerp(bl, .34, hi * .6);
    r = lerp(r, .42, lo * .6); g = lerp(g, .24, lo * .6); bl = lerp(bl, .16, lo * .6);
    const dk = sstep(.05, .3, fbm(x * 3.1 + 11, y * 3.1, z * 3.1, 5, 212) - Math.abs(y) * .25) * (1 - hi); r = lerp(r, .27, dk * .55); g = lerp(g, .17, dk * .55); bl = lerp(bl, .13, dk * .55); // dark basalt provinces seen from orbit
    const brt = sstep(.15, .4, fbm(x * 2.3 + 2, y * 2.3, z * 2.3, 4, 213)) * (1 - dk); r = lerp(r, .8, brt * .25); g = lerp(g, .55, brt * .25); bl = lerp(bl, .36, brt * .25); // bright dust basins
    r += slope * .05; g += slope * .02; r -= slope * .06 * (1 - hi); // steep canyon walls show darker rock
    const cap = sstep(.86, .92, Math.abs(y) + fbm(x * 9, y * 9, z * 9, 3, 214) * .05), tr = Math.pow(ridged(x * 14 + 3, y * 14, z * 14, 3, 215), 4); // polar ice caps with dark spiral troughs
    if (cap > 0) { const c2 = cap * (1 - tr * .55); r = lerp(r, .86, c2); g = lerp(g, .84, c2); bl = lerp(bl, .8, c2); _wt[3] = cap * .8; _wt[1] *= 1 - cap; }
  } else if (b === EMBER) { // black basalt, grey ash on the heights, rusty sulphur crusts, glowing lava (weight 3 drives the glow)
    const n = fbm(x * 26, y * 26, z * 26, 3, 420) * .5 + .5, hi = sstep(600, 3500, h), su = sstep(.25, .45, fbm(x * 5 + 2, y * 5, z * 5, 3, 421)) * (1 - hi), lv = emberLava(x, y, z, h);
    r = lerp(.075, .05, n); g = lerp(.068, .045, n); bl = lerp(.066, .045, n); r = lerp(r, .13, hi * .6); g = lerp(g, .12, hi * .6); bl = lerp(bl, .115, hi * .6);
    r = lerp(r, .42, su * .35); g = lerp(g, .3, su * .35); bl = lerp(bl, .1, su * .35); r += slope * .04; g += slope * .035; bl += slope * .03;
    let sul = 0; for (const c of EMBER.cones) { const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < .9) continue; const d = Math.acos(Math.min(1, dd)) * EMBER.R / c.r; sul = Math.max(sul, Math.exp(-(((d - 1.9) / .7) ** 2)) * (.6 + .4 * n)); }
    const dF = emberFM(x, y, z), rd = Math.exp(-(((dF - 42000) / 12000) ** 2)) * (.7 + .3 * n) * (1 - hi * .5);
    r = lerp(r, .62, sul * .45); g = lerp(g, .52, sul * .45); bl = lerp(bl, .2, sul * .45); r = lerp(r, .45, rd * .4); g = lerp(g, .16, rd * .4); bl = lerp(bl, .08, rd * .4);
    r = lerp(r, .55, lv); g = lerp(g, .12, lv); bl = lerp(bl, .03, lv); _wt[0] = 0; _wt[1] = .3 * (1 - lv); _wt[2] = .7 * (1 - lv); _wt[3] = lv;
  } else if (b === PEBBLE) { _wt[0] = 0; _wt[1] = .5; _wt[2] = .5; _wt[3] = 0;
    const n = fbm(x * 12, y * 12, z * 12, 3, 520) * .5 + .5, dk = sstep(.1, .35, fbm(x * 2 + 5, y * 2, z * 2, 3, 521)); r = lerp(.36, .3, n); g = lerp(.33, .28, n); bl = lerp(.3, .26, n); r = lerp(r, .2, dk * .6); g = lerp(g, .18, dk * .6); bl = lerp(bl, .17, dk * .6); const fr = sstep(.2, .45, slope); r = lerp(r, .5, fr * .5); g = lerp(g, .47, fr * .5); bl = lerp(bl, .43, fr * .5); // fresh rock on steep slopes
    const bd = sstep(.3, .5, fbm(x * 40, y * 40, z * 40, 2, 522)); r = lerp(r, .44, bd * .3); g = lerp(g, .38, bd * .3); bl = lerp(bl, .3, bd * .3); // tan boulder fields
  } else if (b === FROST) { _wt[0] = 0; _wt[1] = .4; _wt[2] = .2; _wt[3] = .4;
    // bright ice, blue-grey along the cracks, faint tan dust in patches
    const cr = Math.pow(ridged(x * 7 + 2, y * 7, z * 7, 4, 301), 3) * .85, n = fbm(x * 18, y * 18, z * 18, 3, 310) * .5 + .5, rg = sstep(-.2, .3, fbm(x * 1.4 + 2, y * 1.4, z * 1.4, 4, 312)), du = sstep(.15, .35, fbm(x * 2.4 + 6, y * 2.4, z * 2.4, 3, 311));
    r = lerp(.72, .62, n); g = lerp(.77, .69, n); bl = lerp(.85, .79, n); r = lerp(r, .5, rg * .6); g = lerp(g, .62, rg * .6); bl = lerp(bl, .78, rg * .6); // bluer old ice in broad regions
    r = lerp(r, .6, du * .6); g = lerp(g, .55, du * .6); bl = lerp(bl, .5, du * .6);
    const cr2 = Math.pow(ridged(x * 26, y * 26, z * 26, 3, 302), 5) * .6; r = lerp(r, .28, Math.min(1, cr + cr2)); g = lerp(g, .42, Math.min(1, cr + cr2)); bl = lerp(bl, .6, Math.min(1, cr + cr2)); r -= slope * .12; g -= slope * .08;
    const li = Math.pow(ridged(x * 11 + 5, y * 11, z * 11, 3, 313), 9) * .8 + Math.pow(ridged(x * 41 + 1, y * 41, z * 41, 2, 314), 12) * .5, ch = sstep(.28, .42, fbm(x * 3.3 + 8, y * 3.3, z * 3.3, 4, 315)) * .55; // reddish-brown lineae and chaos terrain
    const br = Math.min(.85, li + ch * (.6 + .4 * n)); r = lerp(r, .56, br); g = lerp(g, .43, br); bl = lerp(bl, .36, br);
  } else { _wt[0] = 0; _wt[1] = .55; _wt[2] = .45; _wt[3] = 0;
    // highlands bright, maria dark basalt, bright ray streaks around young craters
    const n = fbm(x * 30, y * 30, z * 30, 3, 90) * .5 + .5, mare = mareAt(x, y, z); let v = lerp(.42, .17, mare) + (n - .5) * .08 + slope * .06, ray = 0;
    for (const c of CRATERS) { if (!c.young) continue; const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < .5) continue; const d = Math.acos(Math.min(1, dd)) * MOON.R / c.r; if (d > 14) continue;
      const tx = x - c.d.x * dd, ty = y - c.d.y * dd, tz = z - c.d.z * dd, ang = Math.atan2(tx * c.d.z - tz * c.d.x, ty);
      const st = Math.max(0, noise3(Math.cos(ang) * 9, Math.sin(ang) * 9, c.seed, 5)) ** 2 * 3; ray = Math.max(ray, d < 1.4 ? .7 : st * Math.max(0, 1 - d / 14) ** 1.5); }
    v += ray * .26; let ej = 0; const CLm = CR_NEAR || CRATERS; for (let i = 0; i < CLm.length; i++) { const c = CLm[i]; if (c.r < 700) continue; const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < c.cos) continue; const d = Math.acos(Math.min(1, dd)) * MOON.R / c.r; if (d > 2.4) continue;
      ej += d < .85 ? -.03 * (c.r > 1500 ? 1 : 0) : Math.exp(-(d - .95) * 2.2) * (c.r > 15000 ? .03 : .06); }
    v += clamp(ej, -.05, .1) + fbm(x * 5 + 1, y * 5, z * 5, 3, 91) * .05 * (1 - mare); r = v; g = v * .955; bl = v * .9 - mare * .01;
  }
  _c.r = lin(r); _c.g = lin(g); _c.b = lin(bl); return _c;
}

// ---------------- renderer
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance'});
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const FAR = 6e7;
// ---------------- textures (CC0, Poly Haven: see THIRD_PARTY.md). name_c = colour, _n = normal (GL), _r = roughness
const TXL = new THREE.TextureLoader(), TX = {};
function tex(name, kind) { const k = name + kind; if (TX[k]) return TX[k];
  const t = TXL.load('tex/' + name + '_' + kind + '.jpg', im => { if (kind === 'c') { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.drawImage(t.image, 0, 0, 8, 8);
      const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += lin(d[i] / 255); g += lin(d[i + 1] / 255); b += lin(d[i + 2] / 255); } const n = d.length / 4; t.userData.avg = new V3(r / n, g / n, b / n); TEXREADY(); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (kind === 'c') t.colorSpace = THREE.SRGBColorSpace; t.userData.avg = new V3(.5, .5, .5); return TX[k] = t; }
let TEXREADY = () => {};
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, FAR);
scene.add(cam);
const sunL = new THREE.DirectionalLight(0xffffff, 3); sunL.castShadow = true; scene.add(sunL); scene.add(sunL.target);
sunL.shadow.mapSize.set(2048, 2048); const sc = sunL.shadow.camera; sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 1; sc.far = 1200; sunL.shadow.bias = -.0003; sunL.shadow.normalBias = .5;
const sunL2 = new THREE.DirectionalLight(0xffffff, 0); sunL2.castShadow = false; scene.add(sunL2); scene.add(sunL2.target); // far shadow cascade (High only)
{ const c = sunL2.shadow.camera; c.left = c.bottom = -3000; c.right = c.top = 3000; c.near = 1; c.far = 9000; sunL2.shadow.bias = -.0006; sunL2.shadow.normalBias = 3; sunL2.shadow.autoUpdate = false; sunL2.shadow.mapSize.set(2048, 2048); }
const amb = new THREE.HemisphereLight(0x9ec8ff, 0x2a2418, .5); scene.add(amb);
// interiors: sky light (hemisphere + IBL) can't see walls, so indoor materials scale it down and add a soft lamp fill instead
const INT_MC = {k: {value: .1}, a: {value: new THREE.Color(.5, .47, .42)}}, INT_DECK = {k: {value: .45}, a: {value: new THREE.Color(.2, .19, .17)}}, INT_CAB = {k: {value: .06}, a: {value: new THREE.Color(.05, .05, .055)}};
function interiorMat(m, U = INT_MC) { m.onBeforeCompile = sh => { sh.uniforms.inK = U.k; sh.uniforms.inA = U.a;
    sh.fragmentShader = 'uniform float inK; uniform vec3 inA;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', 'irradiance = irradiance * inK + inA; iblIrradiance *= inK; radiance *= inK;\n#include <lights_fragment_end>'); };
  m.customProgramCacheKey = () => 'interior'; m.needsUpdate = true; return m; }

// ---------------- shared GLSL: atmosphere scattering + noise
const BR = new V3(5.8e-6, 13.5e-6, 33.1e-6).multiplyScalar(3.2), BM = 21e-6 * 1.9, HR = 2500, HM = 500, BO = new V3(.65e-6, 1.881e-6, .085e-6).multiplyScalar(3.2), OZ_C = 7800, OZ_W = 4700, SUN_I = 3.6; // sun irradiance: same units as the directional light, so sky and ground brightness match
const CL = {base: 1500, top: 4300, cov: {value: .5}};
const GLSL_ATMO = `
uniform vec3 bR, bO; uniform float bM, hR, hM, R, Ra, sunI;
float ozone(float h){ return max(0., 1. - abs(h - ${OZ_C}.) / ${OZ_W}.); }
vec2 rs(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r*r, h = b*b - c; if (h < 0.) return vec2(1e20, -1e20); h = sqrt(h); return vec2(-b - h, -b + h); }
// single scattering (Rayleigh + Mie) along o + d*t for t in [t0, t1]; returns in-scattered light and the transmittance
vec3 scatter(vec3 o, vec3 d, float t0, float t1, vec3 sunDir, int steps, out vec3 trans) {
  float ds = (t1 - t0) / float(steps), odR = 0., odM = 0., odO = 0.; vec3 sR = vec3(0.), sM = vec3(0.);
  for (int i = 0; i < 24; i++) { if (i >= steps) break;
    vec3 p = o + d * (t0 + ds * (float(i) + .5)); float hh = max(0., length(p) - R);
    float dR = exp(-hh / hR) * ds, dM = exp(-hh / hM) * ds; odR += dR; odM += dM; odO += ozone(hh) * ds;
    vec2 sh = rs(p, sunDir, R - 60.); if (sh.x > 0. && sh.x < 1e19) continue; // in the planet's shadow
    float lt = rs(p, sunDir, Ra).y / 4., lR = 0., lM = 0., lO = 0.;
    for (int j = 0; j < 4; j++) { vec3 q = p + sunDir * lt * (float(j) + .5); float h2 = max(0., length(q) - R); lR += exp(-h2 / hR) * lt; lM += exp(-h2 / hM) * lt; lO += ozone(h2) * lt; }
    vec3 at = exp(-(bR * (odR + lR) + bM * 1.1 * (odM + lM) + bO * (odO + lO))); sR += at * dR; sM += at * dM; }
  float mu = dot(d, sunDir), g = .76;
  float pR = .0596831 * (1. + mu*mu), pM = .1193662 * ((1. - g*g) * (1. + mu*mu)) / ((2. + g*g) * pow(1. + g*g - 2.*g*mu, 1.5));
  trans = exp(-(bR * odR + bM * 1.1 * odM + bO * odO));
  return sunI * (sR * bR * pR + sM * bM * pM);
}`;
const GLSL_NOISE = `
float h31(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y), mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p, int o){ float t = 0., a = .5; for (int i = 0; i < 8; i++) { if (i >= o) break; t += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return t; }`;
const atmoU = () => ({bO: {value: BO}, bR: {value: BR}, bM: {value: BM}, hR: {value: HR}, hM: {value: HM}, R: {value: PLANET.R}, Ra: {value: PLANET.R + PLANET.atmo}, sunI: {value: SUN_I}});

// ---------------- the galaxy: Milky Way band, dust lanes, nebulae and ~a million stars, baked once into a cube map
function bakeSky() {
  const gn = new V3(.32, .84, -.44).normalize(), gc = new V3(1, 0, 0).sub(gn.clone().multiplyScalar(gn.x)).normalize().applyAxisAngle(gn, 2.4);
  const m = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, uniforms: {gn: {value: gn}, gc: {value: gc}},
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: GLSL_NOISE + `uniform vec3 gn, gc; varying vec3 vD;
    vec3 starCol(float t){ return t < .15 ? vec3(.6, .72, 1.) : t < .5 ? vec3(.92, .95, 1.) : t < .78 ? vec3(1., .9, .76) : vec3(1., .7, .48); }
    vec3 stars(vec3 d, float sc, float dens, float br, float pw) { vec3 q0 = d * sc, i = floor(q0), o = step(.5, fract(q0)) - 1., col = vec3(0.);
      for (int z = 0; z <= 1; z++) for (int y = 0; y <= 1; y++) for (int x = 0; x <= 1; x++) { vec3 c = i + o + vec3(x, y, z); float h = h31(c);
        if (h > dens) continue; vec3 sp = c + vec3(h31(c + 11.3), h31(c + 23.7), h31(c + 37.1)); if (abs(length(sp) - sc) > .5) continue;
        float a = length(cross(d, normalize(sp))); float m = pow(h31(c + 51.9), pw) * 30. + h31(c + 5.) * .5;
        col += starCol(h31(c + 71.)) * m * br * exp(-a * a / 4.5e-7); } return col; }
    void main(){ vec3 d = normalize(vD); float lat = asin(clamp(dot(d, gn), -1., 1.)); vec3 gc2 = cross(gn, gc); float lon = atan(dot(d, gc2), dot(d, gc));
      float bulge = exp(-pow(lon / .5, 2.)) * exp(-pow(lat / .3, 2.)), wob = fbm3(d * 3., 3) - .5, width = .14 + .08 * exp(-pow(lon / .9, 2.)) + .06 * wob;
      float band = exp(-pow((lat + wob * .05) / width, 2.)), clouds = fbm3(d * 8., 6), fine = fbm3(d * 38., 4);
      float lum = band * (.25 + 1.6 * clouds * clouds) * (.7 + .6 * fine) + bulge * 2.2 + .03;
      float dust = smoothstep(.42, .66, fbm3(d * 13. + 3., 6)) * exp(-pow((lat - .02) / (width * .5), 2.)) * (.65 + .35 * bulge);
      lum *= 1. - dust * .88;
      vec3 col = mix(vec3(.55, .63, .82), vec3(1., .85, .64), clamp(bulge * 1.2 + band * .15, 0., 1.)) * lum;
      col = mix(col, col * vec3(1.15, .7, .55), dust * .7);
      col += vec3(.95, .22, .32) * smoothstep(.6, .82, fbm3(d * 6. + 9., 5)) * band * .7;     // red emission nebulae
      col += vec3(.25, .45, .95) * smoothstep(.64, .84, fbm3(d * 5. + 31., 5)) * (.2 + band) * .3; // blue reflection nebulae
      col *= .0035;
      // a big emission nebula: domain-warped gas, pink hydrogen / teal oxygen / gold, bright filaments, dark dust pillars, a young blue cluster
      { vec3 nd = normalize(vec3(-.42, .5, .76)), t1 = normalize(cross(nd, vec3(0., 1., 0.))), t2 = cross(nd, t1);
        float na = acos(clamp(dot(d, nd), -1., 1.));
        if (na < 1.5) { vec2 uv = vec2(dot(d, t1), dot(d, t2)); uv = mat2(.8, -.6, .6, .8) * uv; uv.x *= .55; // tilted, stretched cloud
          vec3 q = vec3(uv * 3.2, 1.7);
          float w1 = fbm3(q, 5), w2 = fbm3(q + 2.2 * vec3(w1, w1 * .7, 0.) + 1.3, 5), n = fbm3(q + 2.2 * vec3(w2, w1, w2) + 7.1, 6) * .8 + fbm3(q * 4. + 3.3, 4) * .2;
          float r = length(uv) / (.27 + .1 * (w1 - .5)), env = exp(-r * r * 1.6) * smoothstep(1.5, .8, na);
          float gas = pow(smoothstep(.3, .85, n), 1.6) * env;
          float rim = pow(clamp(1. - abs(n - .58) * 7., 0., 1.), 3.) * env;       // bright ionised edges
          float dust = smoothstep(.55, .72, fbm3(q * 2.2 + 4. * vec3(w2) + 11., 5)) * smoothstep(.1, .6, env);
          vec3 tint = mix(vec3(.85, .22, .32), vec3(.32, .58, .72), smoothstep(.5, .66, w2 + (n - .5) * .5) * .7); // mostly hydrogen red, a little oxygen teal
          tint = mix(tint, vec3(.85, .62, .42), smoothstep(.6, .78, w1) * .5);
          vec3 neb = tint * gas * 2. + tint * rim * .8 + vec3(.55, .62, .8) * exp(-pow(r / .2, 2.)) * .5;
          neb += tint * env * .35; // soft glow under the structure
          col += neb * (1. - dust * .9) * .017; // faint, like a real nebula to the eye
          col += stars(d, 900., env * .1, .006, 14.) * vec3(.8, .9, 1.2); } }
      col += stars(d, 160., .45, .006, 26.) + stars(d, 520., .08 + band * .3, .0011, 18.) + stars(d, 1300., band * .5 * (1. - dust), .0004, 6.);
      gl_FragColor = vec4(col, 1.); }`});
  const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), m));
  const rt = new THREE.WebGLCubeRenderTarget(HI() ? 2048 : 1024, {type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter});
  const cc = new THREE.CubeCamera(1, 100, rt); cc.coordinateSystem = RND.coordinateSystem; cc.updateCoordinateSystem(); cc.updateMatrixWorld(true);
  // one face per frame so the GPU never stalls
  let face = 0; G.skyBake = () => { if (face > 5) return; RND.setRenderTarget(rt, face); RND.render(sc, cc.children[face]); if (++face > 5) { m.dispose(); scene.background = rt.texture; } };
  return rt;
}

// ---------------- sky reflections: the real atmosphere (same scattering code) rendered into a PMREM environment every few seconds
const envScene = new THREE.Scene(), envMat = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false,
  uniforms: Object.assign(atmoU(), {camPos: {value: new V3()}, sunDir: {value: SUN.clone()}, sunC: {value: new THREE.Color()}}),
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: GLSL_ATMO + `uniform vec3 camPos, sunDir, sunC; varying vec3 vD;
    void main(){ vec3 d = normalize(vD), tr; vec3 c = vec3(0.); vec2 a = rs(camPos, d, Ra); float t0 = max(a.x, 0.), t1 = a.y; vec2 gp = rs(camPos, d, R);
      bool gnd = gp.x > 0. && gp.x < 1e19; if (gnd) t1 = gp.x;
      if (t1 > t0) c = scatter(camPos, d, t0, t1, sunDir, 10, tr); else tr = vec3(1.);
      if (gnd) { vec3 n = normalize(camPos + d * gp.x); c += tr * vec3(.09, .1, .07) * sunC * max(dot(n, sunDir), 0.) * 1.1; }
      gl_FragColor = vec4(c, 1.); }`});
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
let pmrem = null, envRT = null, envT = 0;
function updateEnv(dt, sunCol) {
  if ((envT -= dt) > 0) return; envT = 3;
  pmrem = pmrem || new THREE.PMREMGenerator(RND);
  envMat.uniforms.camPos.value.copy(G.O).sub(PLANET.c); envMat.uniforms.sunDir.value.copy(SUN); envMat.uniforms.sunC.value.setRGB(sunCol[0] * 3.4, sunCol[1] * 3.4, sunCol[2] * 3.4);
  const nrt = pmrem.fromScene(envScene, 0, .1, 100); if (envRT) envRT.dispose(); envRT = nrt;
  scene.environment = envRT.texture; scene.environmentIntensity = 1;
}

// ---------------- post: SSAO -> atmosphere (+ sun) -> eye adaptation -> bloom (2 levels) -> lens flare + tone map
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene(), fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsScene.add(fsQuad);
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const GLSL_VPOS = `uniform sampler2D tDep; uniform mat4 invProj; uniform float logC;
  vec3 vpos(vec2 uv){ float dep = texture2D(tDep, uv).x; vec4 v = invProj * vec4(uv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w); if (dep >= .99999) return dv * 1e9; return dv * ((exp2(dep * logC) - 1.) / max(1e-4, -dv.z)); }`;
const ssaoM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false,
  uniforms: {tDep: {value: null}, invProj: {value: new THREE.Matrix4()}, proj: {value: new THREE.Matrix4()}, logC: {value: Math.log2(FAR + 1)}, res: {value: new THREE.Vector2()}},
  fragmentShader: GLSL_VPOS + `uniform mat4 proj; uniform vec2 res; varying vec2 vUv;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){ vec3 p = vpos(vUv); float z = -p.z; if (z > 220.) { gl_FragColor = vec4(1.); return; }
    vec3 px = vpos(vUv + vec2(1. / res.x, 0.)) - p, py = vpos(vUv + vec2(0., 1. / res.y)) - p; vec3 n = normalize(cross(px, py)); if (dot(n, p) > 0.) n = -n;
    float rad = clamp(z * .08, .35, 1.6), occ = 0., ang = hh(vUv * res) * 6.283;
    vec3 t = normalize(abs(n.y) < .9 ? cross(n, vec3(0., 1., 0.)) : cross(n, vec3(1., 0., 0.))), b = cross(n, t);
    for (int i = 0; i < 12; i++) { float fi = float(i), a = ang + fi * 2.39996, r = sqrt((fi + .5) / 12.), h = sqrt(1. - r * r);
      vec3 s = p + (t * cos(a) * r + b * sin(a) * r + n * (h * .9 + .1)) * rad * (.3 + .7 * fract(fi * .618 + ang));
      vec4 c = proj * vec4(s, 1.); vec2 uv = c.xy / c.w * .5 + .5; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) continue;
      float sz = vpos(uv).z; occ += step(s.z + .03 * rad, sz) * smoothstep(0., 1., rad / abs(p.z - sz)); }
    float ao = 1. - occ / 12.; gl_FragColor = vec4(vec3(mix(1., ao * ao, smoothstep(220., 120., z))), 1.); }`});
const atmoM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false,
  uniforms: Object.assign(atmoU(), {tCol: {value: null}, tDep: {value: null}, tAO: {value: null}, aoOn: {value: 1}, invProj: {value: new THREE.Matrix4()}, camRot: {value: new THREE.Matrix3()}, camPos: {value: new V3()}, sunDir: {value: SUN.clone()},
    logC: {value: Math.log2(FAR + 1)}, steps: {value: 12}, aoPx: {value: new THREE.Vector2()}, tCl: {value: null}, clOn: {value: 0}}),
  fragmentShader: GLSL_ATMO + `uniform sampler2D tCol, tDep, tAO, tCl; uniform float clOn; uniform mat4 invProj; uniform mat3 camRot; uniform vec3 camPos, sunDir; uniform float logC, aoOn; uniform int steps; uniform vec2 aoPx; varying vec2 vUv;
  // the air is squeezed into a thin shell (same column as Earth's), which makes haze near the ground ~3x Earth's: thin it on nearby ground
  // (scales the optical depth, keeps the haze colour; the sky and far horizon are untouched so they still blend)
  void thin(inout vec3 ins, inout vec3 tr, float dist){ float k = .42; vec3 t2 = pow(max(tr, vec3(1e-5)), vec3(k));
    ins *= (1. - t2) / max(1. - tr, vec3(1e-4)); tr = t2; }
  void main(){
    vec4 v = invProj * vec4(vUv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w); vec3 d = normalize(camRot * dv);
    float dep = texture2D(tDep, vUv).x; float dist = dep >= .99999 ? 1e20 : (exp2(dep * logC) - 1.) / max(1e-4, -dv.z);
    vec3 col = texture2D(tCol, vUv).rgb;
    if (aoOn > .5 && dist < 300.) { float ao = (texture2D(tAO, vUv + aoPx * vec2(.7, .4)).r + texture2D(tAO, vUv - aoPx * vec2(.7, .4)).r + texture2D(tAO, vUv + aoPx * vec2(-.4, .7)).r + texture2D(tAO, vUv - aoPx * vec2(-.4, .7)).r) * .25; col *= ao; }
    vec3 trans = vec3(1.);
    vec2 a = rs(camPos, d, Ra); float t0 = max(a.x, 0.), t1 = min(a.y, dist);
    vec2 gp = rs(camPos, d, R - 30.); if (dist > 1e19 && gp.x > 0. && gp.x < 1e19) { t1 = min(t1, gp.x); col = vec3(.02, .025, .02) * max(0., dot(normalize(camPos + d * gp.x), sunDir)); dist = gp.x; } // ground not built yet: dark stand-in
    vec4 cl = clOn > .5 ? texture2D(tCl, vUv) : vec4(0., 0., 0., 1.);
    if (cl.a < .995) { // clouds: split the air at the cloud layer so near clouds stay crisp and far ones fade into the haze
      float rc = length(camPos) < R + ${CL.base}. ? R + ${CL.base}. : R + ${CL.top}.; vec2 ic = rs(camPos, d, rc); float tc = length(camPos) < R + ${CL.top}. && length(camPos) > R + ${CL.base}. ? 0. : (length(camPos) < rc ? ic.y : ic.x);
      tc = clamp(tc, t0, max(t0, t1)); vec3 tr1 = vec3(1.), tr2 = vec3(1.), ins1 = vec3(0.), ins2 = vec3(0.); int hs = max(steps / 2, 4);
      if (tc > t0) ins1 = scatter(camPos, d, t0, tc, sunDir, hs, tr1); if (t1 > tc) { ins2 = scatter(camPos, d, tc, t1, sunDir, hs, tr2); if (dist < 1e19) thin(ins2, tr2, dist); }
      col = ins1 + tr1 * (cl.rgb + cl.a * (ins2 + tr2 * col)); trans = tr1 * tr2 * cl.a; }
    else if (t1 > t0) { vec3 ins = scatter(camPos, d, t0, t1, sunDir, steps, trans); if (dist < 1e19) thin(ins, trans, dist); col = col * trans + ins; }
    if (dist > 1e19) { // the sun: limb-darkened disc + a tight glow
      float c = dot(d, sunDir), ang = acos(clamp(c, -1., 1.)), rr = ang / .0062;
      if (rr < 1.) { float mu = sqrt(1. - rr * rr); col += trans * vec3(1., .97, .92) * 30000. * (.4 + .6 * pow(mu, .6)); }
      col += trans * vec3(1., .93, .84) * (exp(-ang * 90.) * 30. + exp(-ang * 14.) * .6); }
    gl_FragColor = vec4(col, 1.); }`});
// ---------------- Rust's thin dusty air (Medium/High): single scattering by dust over Rust's own sphere, run after the Home sky pass when Rust is near.
// Dust absorbs blue, so the sky is butterscotch, the limb glows tan from orbit, the horizon goes hazy, and the sun dims towards sunset.
const HAZE = {b: RUST, H: 9000, top: 50000, ext: new V3(2.4e-5, 2.9e-5, 3.8e-5), alb: new V3(.94, .78, .58)};
const hazeM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false,
  uniforms: {tCol: {value: null}, tDep: {value: null}, invProj: {value: new THREE.Matrix4()}, camRot: {value: new THREE.Matrix3()}, camPos: {value: new V3()}, sunDir: {value: SUN.clone()}, logC: {value: Math.log2(FAR + 1)},
    hR0: {value: RUST.R}, hRa: {value: RUST.R + HAZE.top}, hH: {value: HAZE.H}, hExt: {value: HAZE.ext}, hSca: {value: HAZE.ext.clone().multiply(HAZE.alb)}, sunI: {value: SUN_I}},
  fragmentShader: `uniform sampler2D tCol, tDep; uniform mat4 invProj; uniform mat3 camRot; uniform vec3 camPos, sunDir, hExt, hSca; uniform float logC, hR0, hRa, hH, sunI; varying vec2 vUv;
  vec2 rs2(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r*r, h = b*b - c; if (h < 0.) return vec2(1e20, -1e20); h = sqrt(h); return vec2(-b - h, -b + h); }
  void main(){
    vec4 v = invProj * vec4(vUv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w), d = normalize(camRot * dv);
    float dep = texture2D(tDep, vUv).x, dist = dep >= .99999 ? 1e20 : (exp2(dep * logC) - 1.) / max(1e-4, -dv.z); vec3 col = texture2D(tCol, vUv).rgb;
    vec2 a = rs2(camPos, d, hRa); float t0 = max(a.x, 0.), t1 = min(a.y, dist); vec2 g = rs2(camPos, d, hR0 - 300.); if (g.x > 0. && g.x < 1e19) t1 = min(t1, g.x);
    if (t1 <= t0) { gl_FragColor = vec4(col, 1.); return; }
    float ds = (t1 - t0) / 10., od = 0.; vec3 ins = vec3(0.);
    for (int i = 0; i < 10; i++) { vec3 p = camPos + d * (t0 + ds * (float(i) + .5)); float hh = max(0., length(p) - hR0), dn = exp(-hh / hH) * ds; od += dn;
      vec2 sh = rs2(p, sunDir, hR0 - 100.); if (sh.x > 0. && sh.x < 1e19) continue; // in Rust's shadow
      float lt = rs2(p, sunDir, hRa).y / 3., ol = 0.; for (int j = 0; j < 3; j++) ol += exp(-max(0., length(p + sunDir * lt * (float(j) + .5)) - hR0) / hH) * lt;
      ins += exp(-hExt * (od + ol)) * dn; }
    float mu = dot(d, sunDir), gg = .7, ph = mix(.0796, .0796 * (1. - gg*gg) / pow(1. + gg*gg - 2.*gg*mu, 1.5), .75);
    gl_FragColor = vec4(col * exp(-hExt * od) + ins * hSca * ph * sunI, 1.); }`});
// ---------------- volumetric clouds (High): ray-marched cumulus layer, 3D noise texture made at load (tileable Perlin-Worley + Worley octaves)
const CLOUD3D = (() => { const N = 64, data = new Uint8Array(N * N * N * 4);
  const pts = cells => { const a = new Float32Array(cells * cells * cells * 3); let s = cells * 977 + 3; for (let i = 0; i < a.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s / 4294967296; } return a; };
  const P = {}; for (const c of [4, 8, 16, 32]) P[c] = pts(c);
  const wor = (x, y, z, c) => { const p = P[c], fx = x * c, fy = y * c, fz = z * c, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz); let m = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) { const cx = ix + a, cy = iy + b, cz = iz + d, wx = (cx % c + c) % c, wy = (cy % c + c) % c, wz = (cz % c + c) % c, k = ((wz * c + wy) * c + wx) * 3;
      const dx = cx + p[k] - fx, dy = cy + p[k + 1] - fy, dz = cz + p[k + 2] - fz, dd = dx * dx + dy * dy + dz * dz; if (dd < m) m = dd; }
    return 1 - Math.min(1, Math.sqrt(m)); };
  const vnp = (x, y, z, per, s) => { const fx = x * per, fy = y * per, fz = z * per, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz); let tx = fx - ix, ty = fy - iy, tz = fz - iz; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
    const h = (a, b, c) => hsh(((ix + a) % per + per) % per, ((iy + b) % per + per) % per, ((iz + c) % per + per) % per, s);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), tx), lerp(h(0, 1, 0), h(1, 1, 0), tx), ty), lerp(lerp(h(0, 0, 1), h(1, 0, 1), tx), lerp(h(0, 1, 1), h(1, 1, 1), tx), ty), tz); };
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i + .5) / N, y = (j + .5) / N, z = (k + .5) / N;
    const w4 = wor(x, y, z, 4), w8 = wor(x, y, z, 8), w16 = wor(x, y, z, 16), w32 = wor(x, y, z, 32);
    const pf = (vnp(x, y, z, 4, 1) * .5 + vnp(x, y, z, 8, 2) * .25 + vnp(x, y, z, 16, 3) * .125) / .875, wf = w4 * .625 + w8 * .25 + w16 * .125;
    const pw = clamp((pf - (wf - 1)) / (2 - wf) * 1.15 - .1, 0, 1); // Perlin-Worley: billowy Perlin carved by Worley cells
    const o = ((k * N + j) * N + i) * 4; data[o] = pw * 255; data[o + 1] = w8 * 255; data[o + 2] = w16 * 255; data[o + 3] = w32 * 255; }
  const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true; return t; })();
// planet weather map (equirect, baked once on the GPU): cyclone spirals in the storm tracks, zonal streaks, a cloudy equator, clearer subtropics
const WX = {rt: new THREE.WebGLRenderTarget(2048, 1024, {depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping}), done: false};
const weatherM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false, fragmentShader: GLSL_NOISE + `varying vec2 vUv;
  vec3 rotA(vec3 p, vec3 ax, float a){ return p * cos(a) + cross(ax, p) * sin(a) + ax * dot(ax, p) * (1. - cos(a)); }
  float hs(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  void main(){
    float lon = (vUv.x - .5) * 6.2831853, lat = (vUv.y - .5) * 3.1415927; vec3 d = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon)), p = d;
    // cyclones: twist the domain around storm centres (counter-clockwise in the north, clockwise in the south)
    for (int i = 0; i < 20; i++) { float fi = float(i), sgn = hs(fi) < .5 ? -1. : 1., cl = sgn * (.5 + .55 * hs(fi + 7.)), co = hs(fi + 3.) * 6.2831853;
      vec3 c = vec3(cos(cl) * cos(co), sin(cl), -cos(cl) * sin(co)); float dd = acos(clamp(dot(p, c), -1., 1.)), r = .13 + .12 * hs(fi + 11.);
      p = rotA(p, c, sgn * (3.5 + 3. * hs(fi + 5.)) * exp(-dd * dd / (r * r)) * (1. - dd / (r * 3.) * .2)); }
    vec3 q = vec3(p.x, p.y * 2.1, p.z) * 2.6; // stretched east-west
    vec3 w = vec3(fbm3(q * 1.4 + 1.7, 4), fbm3(q * 1.4 + 9.2, 4), fbm3(q * 1.4 + 4.4, 4)) - .5;
    float base = fbm3(q + w * 1.8, 6), wisp = fbm3((q + w * 2.4) * vec3(5., 9., 5.), 5), fine = fbm3((q + w) * 26., 3);
    float al = abs(lat) * 57.3, latf = .22 * exp(-pow((al - 52.) / 14., 2.)) + .08 * exp(-pow(lat * 57.3 / 6., 2.)) - .2 * exp(-pow((al - 24.) / 9., 2.)) + .12 * smoothstep(65., 85., al);
    float c = base * .9 + (wisp - .5) * .55 + (fine - .5) * .18 + latf - .36;
    gl_FragColor = vec4(smoothstep(0., .32, c), wisp, fine, 1.); }`});
const GLSL_CLOUD = `
uniform sampler3D nTex; uniform sampler2D wTex; uniform float clCov, clTime;
const float CB = ${CL.base}., CT = ${CL.top}.;
float clLod = 0.; // 0 near, 1 far (set by the caller from the view distance)
float remap(float v, float a, float b, float c, float d){ return c + (v - a) / (b - a) * (d - c); }
// pb = body-fixed position in metres
float clWeather(vec3 pb){ vec3 d = normalize(pb); float lon = atan(-d.z, d.x) + clTime * 2e-5, lat = asin(clamp(d.y, -1., 1.));
  vec2 wuv = vec2(lon / 6.2831853 + .5, lat / 3.1415927 + .5); vec4 w = texture(wTex, wuv);
  if (clLod > .05) { vec2 o = vec2(1. / 2048., 1. / 1024.) * (.5 + 1.5 * clLod); w = mix(w, (texture(wTex, wuv + o * vec2(1., .5)) + texture(wTex, wuv - o * vec2(1., .5)) + texture(wTex, wuv + o * vec2(-.5, 1.)) + texture(wTex, wuv - o * vec2(-.5, 1.))) * .25, clLod); } // smooth the map's texels from far (they showed as stripes)
  float e = texture(nTex, pb / 21000.).r;
  return clamp(w.r + (clCov - .5) * .6 + (e - .62) * .15, 0., 1.); }
float clDens(vec3 pb, float h, float cov, bool cheap){
  vec3 wind = vec3(clTime * 7., clTime * .3, clTime * 3.); vec4 n = texture(nTex, (pb + wind) / 4200.);
  float wf = n.g * .625 + n.b * .25 + n.a * .125, shape = remap(n.r, wf - 1., 1., 0., 1.);
  float hg = smoothstep(0., .1, h) * smoothstep(1., .3 + .45 * cov, h) * (1. - .35 * h); // flat bases, rounded tops (taller where cover is thick)
  float d = remap(shape * hg, 1. - min(1., cov * 1.5), 1., 0., 1.) * min(1., cov * 1.8); // sheets where the weather map is cloudy, broken cumulus at the edges
  if (clLod > 0.) { vec4 nf = texture(nTex, (pb + wind) / 38000.), ng = texture(nTex, pb / 9000.); d = mix(d, smoothstep(.3, .78, cov + (nf.r - .5) * .4 + (nf.g - .5) * .2 + (ng.r - .5) * .18 * (1. - clLod)) * hg * .95, clLod); } // from far: the big shapes of the weather map, not sub-pixel noise
  if (d <= 0. || cheap) return max(d, 0.);
  vec4 dn = texture(nTex, (pb + wind * 2.) / 900.); float df = dn.g * .625 + dn.b * .25 + dn.a * .125; df = mix(df, 1. - df, clamp(h * 3., 0., 1.)); // wispy at the base, billowy above
  return max(mix(remap(d, df * .38, 1., 0., 1.), d, clLod), 0.); }`;
const cloudM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false,
  uniforms: Object.assign(atmoU(), {tDep: {value: null}, invProj: {value: new THREE.Matrix4()}, camRot: {value: new THREE.Matrix3()}, camPos: {value: new V3()}, sunDir: {value: SUN.clone()}, bInv: {value: new THREE.Matrix3()},
    logC: {value: Math.log2(FAR + 1)}, nTex: {value: CLOUD3D}, wTex: {value: WX.rt.texture}, clCov: CL.cov, clTime: {value: 0}, steps: {value: 64}, frame: {value: 0}}),
  fragmentShader: GLSL_ATMO + GLSL_CLOUD + `uniform sampler2D tDep; uniform mat4 invProj; uniform mat3 camRot, bInv; uniform vec3 camPos, sunDir; uniform float logC, frame; uniform int steps; varying vec2 vUv;
  float hg(float g, float mu){ float g2 = g * g; return (1. - g2) / (12.566 * pow(1. + g2 - 2. * g * mu, 1.5)); }
  void main(){
    vec4 v = invProj * vec4(vUv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w), d = normalize(camRot * dv);
    float dep = texture2D(tDep, vUv).x, dist = dep >= .99999 ? 1e20 : (exp2(dep * logC) - 1.) / max(1e-4, -dv.z);
    vec3 o = camPos; float r0 = length(o), rb = R + CB, rt = R + CT; vec2 it = rs(o, d, rt), ib = rs(o, d, rb), gp = rs(o, d, R);
    float t0, t1; bool hitB = ib.x > 0. && ib.x < 1e19;
    if (r0 < rb) { t0 = ib.y; t1 = it.y; } else if (r0 < rt) { t0 = 0.; t1 = hitB ? ib.x : it.y; } else { if (it.x > 1e19 || it.y < 0.) { gl_FragColor = vec4(0., 0., 0., 1.); return; } t0 = it.x; t1 = hitB ? ib.x : it.y; }
    if (gp.x > 0. && gp.x < 1e19) t1 = min(t1, gp.x); if (t0 > 60000. && dist < 1e19 && length(o + d * dist) < R + CT + 500.) dist = 1e20; // from far, coarse mountain facets would cut the layer into steps: the sea-level sphere is enough
    t1 = min(min(t1, dist), t0 + 80000.);
    if (t1 <= t0) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
    // sunlight reaching the cloud layer along this view (air reddening + the planet's shadow), sky light
    vec3 pm = o + d * (t0 + min(t1 - t0, 4000.) * .5), up = normalize(pm); float el = dot(up, sunDir);
    vec3 sunT = vec3(0.); vec2 sh = rs(pm, sunDir, R - 300.);
    if (!(sh.x > 0. && sh.x < 1e19)) { float lt = rs(pm, sunDir, Ra).y / 8., oR = 0., oM = 0., oO = 0.; for (int j = 0; j < 8; j++) { float hh = max(0., length(pm + sunDir * lt * (float(j) + .5)) - R); oR += exp(-hh / hR) * lt; oM += exp(-hh / hM) * lt; oO += ozone(hh) * lt; } sunT = exp(-(bR * oR + bM * 1.1 * oM + bO * oO)); }
    sunT *= smoothstep(-.06, .02, el);
    float day = smoothstep(-.12, .35, el), tw = smoothstep(.2, 0., el) * smoothstep(-.2, -.02, el);
    vec3 amb = (vec3(.32, .48, .82) * day + vec3(.55, .32, .5) * tw * .6) * sunI * .065 + vec3(.0006, .0008, .0014);
    float mu = dot(d, sunDir), ph = mix(hg(.8, mu), hg(-.2, mu), .35), ph2 = mix(hg(.4, mu), hg(-.1, mu), .4);
    float ds = (t1 - t0) / float(steps), jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))) + frame * .618);
    float T = 1.; vec3 L = vec3(0.);
    for (int i = 0; i < 96; i++) { if (i >= steps) break; float t = t0 + (float(i) + jit) * ds; vec3 p = o + d * t; float h = (length(p) - rb) / (CT - CB); if (h < 0. || h > 1.) continue;
      clLod = smoothstep(18000., 110000., t); vec3 pb = bInv * p; float cov = clWeather(pb); if (cov < .02) continue;
      float dd = clDens(pb, h, cov, false); if (dd < .002) continue;
      float sig = dd * .05;
      // light march toward the sun (growing steps), coarse density
      float od = 0., ls = 70.; vec3 lp = p; for (int j = 0; j < 5; j++) { lp += sunDir * ls; float lh = (length(lp) - rb) / (CT - CB); if (lh > 1. || lh < 0.) break; vec3 lb = bInv * lp; od += clDens(lb, lh, cov, true) * ls; ls *= 1.9; }
      od *= .05;
      // multiple scattering (3 octaves) + powder darkening of thin edges facing the sun
      float ms = exp(-od) * ph + .5 * exp(-od * .45) * ph2 + .25 * exp(-od * .2) * .08;
      float pw = 1. - exp(-sig * 140.);
      vec3 S = sunI * sunT * ms * 12. * mix(.55, 1., pw) + amb * (.35 + .65 * h) * mix(1., .55, exp(-od * .2));
      float Ti = exp(-sig * ds); L += T * S * (1. - Ti); T *= Ti; if (T < .01) break; }
    gl_FragColor = vec4(L, T); }`});
// eye adaptation: log-average brightness, centre weighted, eased over time
let _cbm = null; function cloudBlurM() { return _cbm || (_cbm = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: blurM.uniforms,
  fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv) * .4; c += (texture2D(t, vUv + d) + texture2D(t, vUv - d)) * .22; c += (texture2D(t, vUv + d * 2.2) + texture2D(t, vUv - d * 2.2)) * .08; gl_FragColor = c; }'})); }
const lumM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}},
  fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ float s = 0.; for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) { vec3 c = texture2D(t, vUv + (vec2(x, y) - 1.5) / vec2(256., 128.)).rgb; s += log(max(dot(c, vec3(.2126, .7152, .0722)), .012)); } gl_FragColor = vec4(s / 16., 0., 0., 1.); }'});
const avgM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, prev: {value: null}, k: {value: .05}},
  fragmentShader: 'uniform sampler2D t, prev; uniform float k; varying vec2 vUv; void main(){ float s = 0., w = 0.; for (int y = 0; y < 8; y++) for (int x = 0; x < 16; x++) { vec2 uv = (vec2(x, y) + .5) / vec2(16., 8.); float ww = 1.2 - length(uv - .5) * 1.4; s += texture2D(t, uv).r * ww; w += ww; }\n  float L = exp(s / w), p = texture2D(prev, vec2(.5)).r; if (p <= 0.) p = L; gl_FragColor = vec4(exp(mix(log(p), log(L), k)), 0., 0., 1.); }'});
const EMAX = {value: 14};
const brightM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, ad: {value: null}, eMax: EMAX},
  fragmentShader: 'uniform float eMax; uniform sampler2D t, ad; varying vec2 vUv; void main(){ float e = clamp(.1 / texture2D(ad, vec2(.5)).r, .02, eMax); vec3 c = texture2D(t, vUv).rgb * e; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(min(c * smoothstep(1.5, 5., l), vec3(6.)), 1.); }'});
const downM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, px: {value: new THREE.Vector2()}},
  fragmentShader: 'uniform sampler2D t; uniform vec2 px; varying vec2 vUv; void main(){ gl_FragColor = vec4((texture2D(t, vUv + px * vec2(-1., -1.)).rgb + texture2D(t, vUv + px * vec2(1., -1.)).rgb + texture2D(t, vUv + px * vec2(-1., 1.)).rgb + texture2D(t, vUv + px).rgb) * .25, 1.); }'});
const blurM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, d: {value: new THREE.Vector2()}},
  fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d*1.38).rgb + texture2D(t, vUv - d*1.38).rgb) * .316; c += (texture2D(t, vUv + d*3.23).rgb + texture2D(t, vUv - d*3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }'});
const compM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false,
  uniforms: {tCl: {value: null}, clOn: {value: 0}, tR: {value: null}, rOn: {value: 0}, eMax: EMAX, t: {value: null}, b: {value: null}, b2: {value: null}, ad: {value: null}, tDep: {value: null}, sunUV: {value: new THREE.Vector2(-9, -9)}, sunCol: {value: new V3(1, 1, 1)}, aspect: {value: 1}, sunOn: {value: 0}, time: {value: 0}},
  fragmentShader: `uniform float eMax, rOn, clOn; uniform sampler2D t, b, b2, ad, tDep, tR, tCl; uniform vec2 sunUV; uniform vec3 sunCol; uniform float aspect, sunOn, time; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
  float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
  void main(){
    float e = clamp(.1 / texture2D(ad, vec2(.5)).r, .02, eMax);
    vec3 c = texture2D(t, vUv).rgb * e + texture2D(b, vUv).rgb * .14 + texture2D(b2, vUv).rgb * .12; if (rOn > .5) c += texture2D(tR, vUv).rgb * e;
    if (sunOn > .5) { // how much of the sun disc is unblocked (depth taps around it), then glare, starburst and ghosts
      float vis = 0.; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) vis += step(.99999, texture2D(tDep, sunUV + vec2(x, y) * .0035 * vec2(1. / aspect, 1.)).x); vis /= 25.; if (clOn > .5) vis *= texture2D(tCl, sunUV).a;
      vis *= smoothstep(-.1, .05, min(min(sunUV.x, sunUV.y), min(1. - sunUV.x, 1. - sunUV.y)));
      if (vis > 0.) { vec2 sv = vUv - sunUV; sv.x *= aspect; float r = length(sv), a = atan(sv.y, sv.x);
        float sp = pow(abs(cos(a * 2. + .4)), 900.) + pow(abs(cos(a * 3. + 1.1)), 1400.) * .5;
        c += sunCol * vis * (sp * exp(-r * 4.) * .35 + exp(-r * 22.) * 1.2 + exp(-r * 6.) * .12 + exp(-r * 1.6) * .012);
        vec2 ax = vec2(.5) - sunUV; float fs[6] = float[6](.35, .62, .95, 1.25, 1.55, 2.1), sz[6] = float[6](.03, .06, .018, .1, .04, .14);
        vec3 tc[6] = vec3[6](vec3(.4, .9, .5), vec3(.5, .6, 1.), vec3(1., .8, .3), vec3(.3, .5, 1.), vec3(1., .4, .6), vec3(.6, .9, 1.));
        for (int i = 0; i < 6; i++) { vec2 q = vUv - (sunUV + ax * fs[i]); q.x *= aspect; float d = length(q); c += sunCol * mix(vec3(1.), tc[i], .5) * vis * smoothstep(sz[i], sz[i] * .7, d) * (.05 + .1 * smoothstep(sz[i] * .6, sz[i], d)) * .16; } } }
    c = aces(c); c = pow(c, vec3(1. / 2.2));
    vec2 d = vUv - .5; c *= 1. - dot(d, d) * .3; c += (hh(vUv * 1000.) - .5) / 255.;
    gl_FragColor = vec4(c, 1.); }`});
const raysM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {tCol: {value: null}, tDep: {value: null}, sunUV: {value: new THREE.Vector2()}, aspect: {value: 1}, k: {value: 1}},
  fragmentShader: `uniform sampler2D tCol, tDep; uniform vec2 sunUV; uniform float aspect, k; varying vec2 vUv;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){ vec2 stp = (sunUV - vUv) / 56.; vec2 uv = vUv + stp * hh(vUv * 917.); float dec = 1.; vec3 sum = vec3(0.);
    for (int i = 0; i < 56; i++) { uv += stp; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) { dec *= .97; continue; }
      float sky = step(.99999, texture2D(tDep, uv).x); vec2 o = (uv - sunUV) * vec2(aspect, 1.);
      vec3 cc = texture2D(tCol, uv).rgb; sum += min(cc, vec3(14.)) * smoothstep(6., 40., dot(cc, vec3(.33))) * sky * exp(-length(o) * 4.5) * dec; dec *= .975; }
    gl_FragColor = vec4(sum / 56. * k, 1.); }`});
// FXAA on the final image (smooth edges; MSAA broke the depth texture on some GPUs)
const fxaaM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, px: {value: new THREE.Vector2()}},
  fragmentShader: `uniform sampler2D t; uniform vec2 px; varying vec2 vUv; float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
  void main(){ vec3 m = texture2D(t, vUv).rgb, nw = texture2D(t, vUv + vec2(-1., -1.) * px).rgb, ne = texture2D(t, vUv + vec2(1., -1.) * px).rgb, sw = texture2D(t, vUv + vec2(-1., 1.) * px).rgb, se = texture2D(t, vUv + vec2(1., 1.) * px).rgb;
    float lm = lum(m), a = lum(nw), b = lum(ne), c = lum(sw), d = lum(se), lo = min(lm, min(min(a, b), min(c, d))), hi = max(lm, max(max(a, b), max(c, d)));
    vec2 dir = vec2(-((a + b) - (c + d)), (a + c) - (b + d)); float red = max((a + b + c + d) * .03125, 1. / 128.), rc = 1. / (min(abs(dir.x), abs(dir.y)) + red); dir = clamp(dir * rc, -8., 8.) * px;
    vec3 A = .5 * (texture2D(t, vUv + dir * (1. / 3. - .5)).rgb + texture2D(t, vUv + dir * (2. / 3. - .5)).rgb), B = A * .5 + .25 * (texture2D(t, vUv - dir * .5).rgb + texture2D(t, vUv + dir * .5).rgb);
    float lb = lum(B); vec3 o = lb < lo || lb > hi ? A : B; vec3 avg = (nw + ne + sw + se) * .25; o += (m - avg) * .32 * (1. - smoothstep(.02, .25, hi - lo)); // gentle sharpen (not on hard edges, FXAA owns those)
    gl_FragColor = vec4(clamp(o, 0., 1.), 1.); }`});
// TAA (Medium/High): the projection is jittered by a sub-pixel Halton offset each frame and the history is reprojected from depth.
// Points near a flying rocket reproject in the rocket's frame, everything else in the frame of the nearest world (terrain turns with it), sky by camera rotation.
// History is clipped to the YCoCg spread of the current 3x3 neighbourhood (no ghosting) and sampled with Catmull-Rom (no blur creep).
const taaM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {tCur: {value: null}, tHist: {value: null}, tDep: {value: null}, invProj: {value: new THREE.Matrix4()}, camRot: {value: new THREE.Matrix3()},
    prevVP: {value: new THREE.Matrix4()}, Ab: {value: new THREE.Matrix4()}, Ar: {value: new THREE.Matrix4()}, rC: {value: new V3()}, rR: {value: 0}, px: {value: new THREE.Vector2()}, logC: {value: Math.log2(FAR + 1)}, reset: {value: 1}},
  fragmentShader: `uniform sampler2D tCur, tHist, tDep; uniform mat4 invProj, prevVP, Ab, Ar; uniform mat3 camRot; uniform vec3 rC; uniform float rR, logC, reset; uniform vec2 px; varying vec2 vUv;
  vec3 toY(vec3 c){ return vec3(.25 * c.r + .5 * c.g + .25 * c.b, .5 * c.r - .5 * c.b, -.25 * c.r + .5 * c.g - .25 * c.b); }
  vec3 fromY(vec3 y){ return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
  vec3 hist(vec2 uv){ vec2 sp = uv / px, tc = floor(sp - .5) + .5, f = sp - tc, f2 = f * f, f3 = f2 * f;
    vec2 w0 = f2 - .5 * (f3 + f), w1 = 1.5 * f3 - 2.5 * f2 + 1., w3 = .5 * (f3 - f2), w2 = 1. - w0 - w1 - w3, s12 = w1 + w2, t0 = (tc - 1.) * px, t3 = (tc + 2.) * px, t12 = (tc + w2 / s12) * px;
    vec3 r = texture2D(tHist, vec2(t12.x, t0.y)).rgb * (s12.x * w0.y) + texture2D(tHist, vec2(t0.x, t12.y)).rgb * (w0.x * s12.y) + texture2D(tHist, t12).rgb * (s12.x * s12.y)
      + texture2D(tHist, vec2(t3.x, t12.y)).rgb * (w3.x * s12.y) + texture2D(tHist, vec2(t12.x, t3.y)).rgb * (s12.x * w3.y);
    return max(r / (s12.x * w0.y + w0.x * s12.y + s12.x * s12.y + w3.x * s12.y + s12.x * w3.y), 0.); }
  void main(){
    vec3 c = texture2D(tCur, vUv).rgb; if (reset > .5) { gl_FragColor = vec4(c, 1.); return; }
    vec3 m1 = vec3(0.), m2 = vec3(0.);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec3 s = toY(texture2D(tCur, vUv + vec2(x, y) * px).rgb); m1 += s; m2 += s * s; }
    m1 /= 9.; m2 /= 9.; vec3 sd = sqrt(max(m2 - m1 * m1, 0.));
    float dep = texture2D(tDep, vUv).x; vec4 v = invProj * vec4(vUv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w), wd = camRot * dv; vec4 cp;
    if (dep >= .99999) cp = prevVP * vec4(wd, 0.);
    else { vec3 wp = wd * ((exp2(dep * logC) - 1.) / max(1e-4, -dv.z)); vec3 pw = ((rR > 0. && distance(wp, rC) < rR) ? (Ar * vec4(wp, 1.)) : (Ab * vec4(wp, 1.))).xyz; cp = prevVP * vec4(pw, 1.); }
    vec2 puv = cp.xy / cp.w * .5 + .5;
    if (cp.w <= 0. || puv.x < 0. || puv.y < 0. || puv.x > 1. || puv.y > 1.) { gl_FragColor = vec4(c, 1.); return; }
    vec3 h = toY(hist(puv)), ctr = m1, ext = sd * 1.15 + 1e-4, off = h - ctr, ts = abs(off / ext); float mx = max(ts.x, max(ts.y, ts.z)); if (mx > 1.) h = ctr + off / mx;
    float k = mix(.085, .32, clamp(length((puv - vUv) / px) / 14., 0., 1.));
    gl_FragColor = vec4(max(fromY(mix(h, toY(c), k)), 0.), 1.); }`});
// after TAA: a light sharpen (TAA averages sub-pixel samples, which softens a little)
const sharpM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, px: {value: new THREE.Vector2()}, k: {value: .2}},
  fragmentShader: `uniform sampler2D t; uniform vec2 px; uniform float k; varying vec2 vUv;
  void main(){ vec3 m = texture2D(t, vUv).rgb, n = texture2D(t, vUv + vec2(0., px.y)).rgb, s = texture2D(t, vUv - vec2(0., px.y)).rgb, e = texture2D(t, vUv + vec2(px.x, 0.)).rgb, w = texture2D(t, vUv - vec2(px.x, 0.)).rgb;
    vec3 lo = min(m, min(min(n, s), min(e, w))), hi = max(m, max(max(n, s), max(e, w))); gl_FragColor = vec4(clamp(m + (4. * m - n - s - e - w) * k, lo * .9, hi * 1.1 + .01), 1.); }`});
const TAA = {on: () => HI() && SET.taa !== false, i: 0, P: new THREE.Matrix4(), PI: new THREE.Matrix4(), prevVP: new THREE.Matrix4(), prevR: new THREE.Matrix4(), hadR: false, last: 0, gap: 250, reset: true, m: new THREE.Matrix4(), m2: new THREE.Matrix4()};
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const POST = {};
function setupPost() {
  const pr = Math.min(devicePixelRatio, SET.gfx === 'high' ? 1.5 : SET.gfx === 'med' ? 1.25 : .75) * (G.rs || 1), w = Math.max(2, innerWidth * pr | 0), h = Math.max(2, innerHeight * pr | 0);
  RND.setPixelRatio(pr); RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  for (const k in POST) POST[k].dispose();
  const HF = {type: THREE.HalfFloatType, depthBuffer: false};
  POST.main = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: 0, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType)});
  POST.ao = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), {depthBuffer: false});
  POST.sky = new THREE.WebGLRenderTarget(w, h, HF); POST.hz = new THREE.WebGLRenderTarget(w, h, HF);
  const cs = SET.gfx === 'high' && !LITE() ? .7 : .5; POST.cl = new THREE.WebGLRenderTarget(Math.max(2, w * cs | 0), Math.max(2, h * cs | 0), HF); POST.cl2 = POST.cl.clone(); // sharper clouds on High
  const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
  POST.a = new THREE.WebGLRenderTarget(bw, bh, HF); POST.b = POST.a.clone();
  POST.c = new THREE.WebGLRenderTarget(Math.max(2, bw >> 2), Math.max(2, bh >> 2), HF); POST.d = POST.c.clone(); POST.r = POST.a.clone();
  POST.ldr = new THREE.WebGLRenderTarget(w, h, {depthBuffer: false}); fxaaM.uniforms.px.value.set(1 / w, 1 / h);
  POST.hA = new THREE.WebGLRenderTarget(w, h, HF); POST.hB = POST.hA.clone(); taaM.uniforms.px.value.set(1 / w, 1 / h); sharpM.uniforms.px.value.set(1 / w, 1 / h); TAA.reset = true;
  POST.lum = new THREE.WebGLRenderTarget(16, 8, {type: THREE.FloatType, depthBuffer: false});
  POST.ad0 = new THREE.WebGLRenderTarget(1, 1, {type: THREE.FloatType, depthBuffer: false}); POST.ad1 = POST.ad0.clone();
  atmoM.uniforms.steps.value = HI() ? (LITE() ? 10 : 14) : 8; atmoM.uniforms.aoOn.value = HI() && !LITE() ? 1 : 0; cloudM.uniforms.steps.value = LITE() ? 40 : 64; atmoM.uniforms.aoPx.value.set(1 / POST.ao.width, 1 / POST.ao.height);
  ssaoM.uniforms.res.value.set(POST.ao.width, POST.ao.height);
  RND.shadowMap.enabled = HI(); sunL.castShadow = HI(); sunL2.castShadow = SET.gfx === 'high'; if (sunL2.shadow.map) { sunL2.shadow.map.dispose(); sunL2.shadow.map = null; } const shs = !HI() ? 1024 : LITE() ? 2048 : 4096; sunL.shadow.mapSize.set(shs, shs); if (sunL.shadow.map) { sunL.shadow.map.dispose(); sunL.shadow.map = null; }
}
function pass(m, rt) { fsQuad.material = m; RND.setRenderTarget(rt); RND.render(fsScene, fsCam); }
const _sv4 = new V3();
function render(dt) {
  RND.shadowMap.autoUpdate = false; RND.shadowMap.needsUpdate = (G.frameN = (G.frameN || 0) + 1) % 2 === 0 || !!G.shadowEvery; sunL2.shadow.needsUpdate = sunL2.castShadow && !LITE() && (G.frameN % 4 === 0 || !!G.shadowEvery); sunL2.shadow.intensity = LITE() ? 0 : 1; if (sunL2.shadow.needsUpdate) RND.shadowMap.needsUpdate = true; // shadows at half rate (matrices update with the map, so no swimming)
  const taa = TAA.on() && POST.hA; if (taa) { // sub-pixel jitter (restored at the end of render)
    TAA.P.copy(cam.projectionMatrix); TAA.PI.copy(cam.projectionMatrixInverse); TAA.i = TAA.i % 16 + 1; const e = cam.projectionMatrix.elements;
    e[8] += (halton(TAA.i, 2) - .5) * 2 / POST.main.width; e[9] += (halton(TAA.i, 3) - .5) * 2 / POST.main.height; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
  RND.setRenderTarget(POST.main); RND.render(scene, cam);
  if (HI() && !LITE()) { const s = ssaoM.uniforms; s.tDep.value = POST.main.depthTexture; s.invProj.value.copy(cam.projectionMatrixInverse); s.proj.value.copy(cam.projectionMatrix); pass(ssaoM, POST.ao); }
  if (!WX.done) { WX.done = true; pass(weatherM, WX.rt); }
  const clOn = HI() && G.O.distanceTo(PLANET.c) - PLANET.R < 2e7 ? 1 : 0; atmoM.uniforms.clOn.value = compM.uniforms.clOn.value = clOn;
  if (clOn) { const c = cloudM.uniforms; c.tDep.value = POST.main.depthTexture; c.invProj.value.copy(cam.projectionMatrixInverse); c.camRot.value.setFromMatrix4(cam.matrixWorld); c.camPos.value.copy(G.O).sub(PLANET.c); c.sunDir.value.copy(SUN);
    c.bInv.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(PLANET.q).invert()); c.clTime.value = G.t; c.frame.value = (c.frame.value + 1) % 64; pass(cloudM, POST.cl);
    blurM.uniforms.t.value = POST.cl.texture; blurM.uniforms.d.value.set(.45 / POST.cl.width, 0); pass(cloudBlurM(), POST.cl2); blurM.uniforms.t.value = POST.cl2.texture; blurM.uniforms.d.value.set(0, .45 / POST.cl.height); pass(cloudBlurM(), POST.cl);
    atmoM.uniforms.tCl.value = compM.uniforms.tCl.value = POST.cl.texture; }
  const u = atmoM.uniforms; u.tCol.value = POST.main.texture; u.tDep.value = POST.main.depthTexture; u.tAO.value = POST.ao.texture; u.invProj.value.copy(cam.projectionMatrixInverse);
  u.camRot.value.setFromMatrix4(cam.matrixWorld); u.camPos.value.copy(G.O).sub(PLANET.c); u.sunDir.value.copy(SUN);
  pass(atmoM, POST.sky);
  if (HI() && G.O.distanceTo(RUST.c) < RUST.R * 12) { const h = hazeM.uniforms; h.tCol.value = POST.sky.texture; h.tDep.value = POST.main.depthTexture; h.invProj.value.copy(cam.projectionMatrixInverse);
    h.camRot.value.setFromMatrix4(cam.matrixWorld); h.camPos.value.copy(G.O).sub(RUST.c); h.sunDir.value.copy(SUN); pass(hazeM, POST.hz); const t = POST.sky; POST.sky = POST.hz; POST.hz = t; }
  // eye adaptation
  lumM.uniforms.t.value = POST.sky.texture; pass(lumM, POST.lum);
  const pa = POST.ad0, pb = POST.ad1; avgM.uniforms.t.value = POST.lum.texture; avgM.uniforms.prev.value = pa.texture; avgM.uniforms.k.value = 1 - Math.exp(-(dt || .016) * 1.6); pass(avgM, pb); POST.ad0 = pb; POST.ad1 = pa;
  // sun position on screen + light shafts
  const cu = compM.uniforms; _sv4.copy(SUN).multiplyScalar(1e5).project(cam); const front = SUN.dot(cam.getWorldDirection(new V3())) > 0;
  cu.sunUV.value.set(_sv4.x * .5 + .5, _sv4.y * .5 + .5); const near = front && Math.abs(cu.sunUV.value.x - .5) < 1.4 && Math.abs(cu.sunUV.value.y - .5) < 1.4;
  cu.rOn.value = near && HI() && !LITE() ? 1 : 0;
  if (cu.rOn.value) { const r = raysM.uniforms; r.tCol.value = POST.sky.texture; r.tDep.value = POST.main.depthTexture; r.sunUV.value.copy(cu.sunUV.value); r.aspect.value = cam.aspect;
    const alt = G.O.distanceTo(PLANET.c) - PLANET.R; r.k.value = lerp(1.1, .4, sstep(PLANET.atmo * .5, PLANET.atmo * 1.5, alt)); pass(raysM, POST.r);
    for (let i = 0; i < 2; i++) { blurM.uniforms.t.value = POST.r.texture; blurM.uniforms.d.value.set(1.6 / POST.r.width, 0); pass(blurM, POST.b); blurM.uniforms.t.value = POST.b.texture; blurM.uniforms.d.value.set(0, 1.6 / POST.r.height); pass(blurM, POST.r); } }
  // bloom: 1/4 and 1/16 resolution
  brightM.uniforms.t.value = POST.sky.texture; brightM.uniforms.ad.value = POST.ad0.texture; pass(brightM, POST.a);
  blurM.uniforms.t.value = POST.a.texture; blurM.uniforms.d.value.set(1 / POST.a.width, 0); pass(blurM, POST.b);
  blurM.uniforms.t.value = POST.b.texture; blurM.uniforms.d.value.set(0, 1 / POST.a.height); pass(blurM, POST.a);
  downM.uniforms.t.value = POST.a.texture; downM.uniforms.px.value.set(1 / POST.a.width, 1 / POST.a.height); pass(downM, POST.c);
  for (let i = 0; i < 2; i++) { blurM.uniforms.t.value = POST.c.texture; blurM.uniforms.d.value.set(1.5 / POST.c.width, 0); pass(blurM, POST.d); blurM.uniforms.t.value = POST.d.texture; blurM.uniforms.d.value.set(0, 1.5 / POST.c.height); pass(blurM, POST.c); }
  cu.sunOn.value = front ? 1 : 0; cu.aspect.value = cam.aspect; cu.tDep.value = POST.main.depthTexture; cu.time.value = G.t % 100;
  cu.tR.value = POST.r.texture; cu.t.value = POST.sky.texture; cu.b.value = POST.a.texture; cu.b2.value = POST.c.texture; cu.ad.value = POST.ad0.texture; pass(compM, POST.ldr);
  if (taa) taaResolve(); else { fxaaM.uniforms.t.value = POST.ldr.texture; pass(fxaaM, null); }
}
function taaResolve() { const u = taaM.uniforms, now = performance.now();
  // nearest world: its frame carries the terrain and everything built on it
  let B = PLANET, best = Infinity; for (const b of BODIES) { const a = G.O.distanceTo(b.c) - b.R; if (a < best) { best = a; B = b; } }
  const reset = TAA.reset || now - TAA.last > TAA.gap || !B._taaM; TAA.reset = false; TAA.last = now;
  if (!reset) u.Ab.value.multiplyMatrices(B._taaM, TAA.m.copy(B.group.matrixWorld).invert()); else u.Ab.value.identity();
  const fly = typeof R !== 'undefined' && R.on && R.st === 'fly' && R.g.visible;
  if (fly && TAA.hadR && !reset) { u.Ar.value.multiplyMatrices(TAA.prevR, TAA.m.copy(R.g.matrixWorld).invert()); u.rC.value.setFromMatrixPosition(R.g.matrixWorld);
    const S = STAGES, top = S[S.length - 1].y1 - R.comY, bot = R.comY - S[R.bot].y0; u.rR.value = Math.max(top, bot) + 6; } else u.rR.value = 0;
  // a teleport (test menu, respawn): start over
  const shift = TAA.m2.copy(u.Ab.value).elements; if (Math.hypot(shift[12], shift[13], shift[14]) > 3000 && !fly) u.Ab.value.identity();
  u.reset.value = reset ? 1 : 0; u.tCur.value = POST.ldr.texture; u.tHist.value = POST.hA.texture; u.tDep.value = POST.main.depthTexture;
  u.invProj.value.copy(cam.projectionMatrixInverse); u.camRot.value.setFromMatrix4(cam.matrixWorld); u.prevVP.value.copy(TAA.prevVP);
  pass(taaM, POST.hB); const t = POST.hA; POST.hA = POST.hB; POST.hB = t;
  sharpM.uniforms.t.value = POST.hA.texture; pass(sharpM, null);
  // remember this frame (unjittered) for the next one
  cam.projectionMatrix.copy(TAA.P); cam.projectionMatrixInverse.copy(TAA.PI); TAA.prevVP.multiplyMatrices(TAA.P, cam.matrixWorldInverse);
  for (const b of BODIES) (b._taaM || (b._taaM = new THREE.Matrix4())).copy(b.group.matrixWorld);
  TAA.hadR = fly; if (fly) TAA.prevR.copy(R.g.matrixWorld); }

// ---------------- terrain: cube-sphere quadtree with skirts and baked AO
const N = 32, NV = N + 1;
const FACES = [[1, 0, 0, 0, 0, -1, 0, 1, 0], [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0, -1], [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, -1, 0, 0, 0, 1, 0]];
const terrIndex = (() => { const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1; idx.push(a, b, d, a, d, c); }
  // skirts: 4 edges, each with NV extra verts after the grid
  const base = NV * NV, edge = (k, gi) => { for (let s = 0; s < N; s++) { const a = gi(s), b = gi(s + 1), c = base + k * NV + s, d = c + 1; idx.push(a, c, b, b, c, d, a, b, c, b, d, c); } };
  edge(0, s => s); edge(1, s => N * NV + s); edge(2, s => s * NV); edge(3, s => s * NV + N);
  return idx; })();
const terrMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .93, metalness: 0});
const TMATS = ['grass', 'sand', 'rock', 'snow'];
const GLSL_TDET = `    // per-pixel relief below the mesh's resolution: noise octaves from ~1/10 of the view distance down to ~4 pixels, as a screen-space bump + albedo mottling (Medium/High)
    float gDH = 0., gIce = 0.; vec3 gGlow = vec3(0.);
    float tRg(float n){ return 1. - abs(n * 2. - 1.); }
    void tDetail(vec3 p, float pxm, float vd, inout vec3 col){
      float H = 0., Al = 0., Aw = 0., lg = log2(max(vd * .12, 4.)), wl = exp2(floor(lg)), ft = fract(lg), ht = vHs.x, sl = vHs.y, rk = vMw.z / max(1e-3, dot(vMw, vec4(1.))), amp = tKind < .5 ? .006 + .02 * rk : tKind < 1.5 ? .028 : tKind < 2.5 ? .026 : tKind < 3.5 ? .01 : tKind < 4.5 ? .035 : .04;
      float dune = tKind > 1.5 && tKind < 2.5 ? smoothstep(150., -700., ht) * (1. - smoothstep(.12, .3, sl)) : 0.; vec3 wnd = normalize(vec3(.6, .1, .79));
      for (int i = 0; i < 5; i++) { if (float(i) >= tOct) break; // a few octaves starting just under the mesh's detail (tOct: 5 on High, 3 on Medium); the finest fades out as the band slides
        float w = smoothstep(3., 8., wl / pxm) * (1. - smoothstep(vd * .05, vd * .12, wl)) * (float(i) > tOct - 1.5 ? 1. - ft : 1.); if (w > 0.) {
          vec3 q = p / wl + log2(wl) * 7.31; float n = vn(q), h;
          if (tKind < .5) h = mix(n - .5, tRg(n) - .6, rk);                         // Home: soft ground, craggy rock
          else if (tKind < 1.5 || tKind > 4.5) h = abs(n * 2. - 1.) - .55;            // Moon, Pebble: pitted regolith
          else if (tKind < 2.5) h = mix(n - .5, sin(dot(p, wnd) / wl * 6.283 * 1.7 + n * 3.) * .45, dune); // Rust: wind ripples on the dune fields
          else if (tKind < 3.5) h = (n - .5) * .6;                                    // Frost: smooth ice
          else { float r = tRg(n); h = r * r - .35; }                                // Ember: blocky aa lava
          H += h * wl * amp * w; Al += (n - .5) * w; Aw += w; }
        wl *= .5; }
      float ab = Aw > 0. ? Al / Aw * min(1., Aw) : 0.;
      if (tKind > 1.5 && tKind < 2.5) { col *= 1. + .12 * sin(ht / 38. * 6.283 + vn(p / 500.) * 4.) * smoothstep(.18, .45, sl) * smoothstep(1.5, 6., 38. / pxm); col *= mix(1., .8, dune * smoothstep(.3, .7, vn(p / 900.))); } // Rust: strata on canyon walls, dark dune sand
      if (tKind > 2.5 && tKind < 3.5) { // Frost: networks of fine cracks, raised and darker, on glossy ice
        float c1 = tRg(vn(p / 420. + 3.)), c2 = tRg(vn(p / 70. + 9.)), l1 = smoothstep(1. - max(.012, pxm / 420. * 2.), 1., c1) * smoothstep(1., 3., 420. / pxm / 8.), l2 = smoothstep(1. - max(.02, pxm / 70. * 2.), 1., c2) * smoothstep(1., 3., 70. / pxm / 8.);
        float cr = max(l1, l2 * .8); H += l1 * 6. + l2 * 1.2; col = mix(col, col * vec3(.55, .7, .9), cr * .7); gIce = (1. - cr) * (1. - smoothstep(.3, .6, sl)); }
      if (tKind > 3.5 && tKind < 4.5) { // Ember: glowing fissures on the low lava plains, brighter near the lava
        float lowP = smoothstep(-250., -400., ht), c = tRg(vn(p / 160. + 2.)), f = smoothstep(.965, .995, c) * smoothstep(2., 5., 160. / pxm / 4.) * (lowP * .8 + vMw.w * 2.);
        gGlow = vec3(1., .3, .05) * f * (.7 + .3 * sin(mod(cT, 6283.) * 1.3 + vn(p / 40.) * 6.)) * .6; col *= 1. - f * .5; }
      col *= 1. + ab * (tKind < .5 ? .18 : .3); gDH = H; }
    vec3 tBump(vec3 sp, vec3 nn, float H){ vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, nn), r2 = cross(nn, sx); float det = dot(sx, r1);
      vec2 dh = vec2(dFdx(H), dFdy(H)); vec3 gr = sign(det) * (dh.x * r1 + dh.y * r2); return normalize(abs(det) * nn - gr); }
`;
// cloud shadows: the same coverage noise as the cloud layer, looked up where the sun ray through this point crosses it
const CLOUDU = {sunB: {value: new V3()}, cT: {value: 0}, cOn: {value: 1}, camT: {value: new V3(1, 1, 1)}};
function cloudShadow(sh, isTerr) {
  Object.assign(sh.uniforms, CLOUDU, {nTex: {value: CLOUD3D}, wTex: {value: WX.rt.texture}, clCov: CL.cov, clTime: CLOUDU.cT, pR: {value: PLANET.R}, aRa: {value: PLANET.R + PLANET.atmo}, aBR: {value: BR}, aBO: {value: BO}, aBM: {value: BM}, aHR: {value: HR}, aHM: {value: HM}});
  sh.vertexShader = 'attribute vec3 bd; varying vec3 vBd;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBd = bd;');
  sh.fragmentShader = 'uniform vec3 sunB, camT, aBR, aBO; uniform float cT, cOn, pR, aRa, aBM, aHR, aHM; varying vec3 vBd; vec3 gSunT = vec3(1.);\n' + GLSL_NOISE + GLSL_CLOUD + `
    // sunlight reaching this point on the ground: reddened by the air, cut off by the planet (soft terminator)
    vec3 sunTrans(){
#ifdef IS_MOON
      return vec3(1.);
#endif
      vec3 b = normalize(vBd); float mu = dot(b, sunB); if (mu < -.1) return vec3(0.);
      vec3 p = b * (pR + 5.); float bb = dot(p, sunB), c = dot(p, p) - aRa * aRa, tt = -bb + sqrt(max(bb * bb - c, 0.)), ds = tt / 6., oR = 0., oM = 0., oO = 0.;
      for (int i = 0; i < 6; i++) { float hh = max(0., length(p + sunB * ds * (float(i) + .5)) - pR); oR += exp(-hh / aHR) * ds; oM += exp(-hh / aHM) * ds; oO += max(0., 1. - abs(hh - ${OZ_C}.) / ${OZ_W}.) * ds; }
      return exp(-(aBR * oR + aBM * 1.1 * oM + aBO * oO)) * smoothstep(-.01, .006, mu); }
    float cshadow(float vd){
#ifdef IS_MOON
      return 1.;
#endif
      if (cOn < .5) return 1.; vec3 b = normalize(vBd); float su = dot(b, sunB); if (su < -.05) return 1.;
      clLod = smoothstep(18000., 110000., vd); vec3 pc = b * pR + sunB * ${(CL.base + CL.top) / 2}. / max(su, .12), pc2 = pc + sunB * 900. / max(su, .12); float cv = clWeather(pc);
      float c = clamp((clDens(pc, .35, cv, true) + clDens(pc2, .65, cv, true)) * 3., 0., 1.); return 1. - c * .8 * smoothstep(-.05, .15, su); }\n` +
    sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= cshadow(length(vViewPosition)); gSunT = sunTrans() / max(camT, vec3(.002));')
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= gSunT;'));
}
// Moon terrain shadows: each vertex stores the horizon elevation in 8 directions (Node.build); the sun is blocked when it is below the horizon there.
// No air on the Moon, so these shadows are pitch black (only the shadow map near you and these, which also work from orbit)
const MOONU = {mSun: {value: new V3(1, 0, 0)}};
function moonShadow(sh, u) { sh.uniforms.mSun = u || MOONU.mSun;
  sh.vertexShader = 'attribute vec4 hz0, hz1; attribute vec3 hzU; varying vec4 vHz0, vHz1; varying vec3 vHzU;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHz0 = hz0; vHz1 = hz1; vHzU = hzU;');
  sh.fragmentShader = sh.fragmentShader.replace('vec3 gSunT = vec3(1.);', `vec3 gSunT = vec3(1.); uniform vec3 mSun; varying vec4 vHz0, vHz1; varying vec3 vHzU;
    float moonSh(){ vec3 up = normalize(vBd), u = normalize(vHzU - up * dot(vHzU, up)), w = cross(up, u);
      float e = asin(clamp(dot(mSun, up), -1., 1.)), az = atan(dot(mSun, w), dot(mSun, u)); if (az < 0.) az += 6.2831853;
      float f = az / .78539816, t = fract(f); int i0 = int(floor(f)) & 7, i1 = (i0 + 1) & 7;
      float hz[8] = float[8](vHz0.x, vHz0.y, vHz0.z, vHz0.w, vHz1.x, vHz1.y, vHz1.z, vHz1.w); float h = mix(hz[i0], hz[i1], t);
      return smoothstep(h - .012, h + .012, e); }`).replace('gSunT = sunTrans() / max(camT, vec3(.002));', 'gSunT = sunTrans() / max(camT, vec3(.002)); gSunT *= moonSh();'); }
let TERR_OBC = null;
const moonMat = terrMat.clone(); moonMat.userData.hue = 0; terrMat.userData.hue = .2; terrMat.userData.kind = 0; terrMat.userData.bR = PLANET.R; moonMat.userData.kind = 1; moonMat.userData.bR = MOON.R; moonMat.customProgramCacheKey = () => 'moon'; moonMat.userData.mSun = MOONU.mSun;
terrMat.onBeforeCompile = moonMat.onBeforeCompile = TERR_OBC = function (sh) {
  TMATS.forEach((m, i) => { sh.uniforms['tC' + i] = {value: tex(m, 'c')}; sh.uniforms['tN' + i] = {value: tex(m, 'n')}; sh.uniforms['aC' + i] = {get value() { return tex(m, 'c').userData.avg; }}; });
  sh.uniforms.hiQ = {get value() { return HI() ? 1 : 0; }}; sh.uniforms.tHue = {value: this.userData.hue}; sh.uniforms.lavaK = {value: this.userData.lava || 0}; sh.uniforms.tKind = {value: this.userData.kind || 0}; sh.uniforms.tOct = {get value() { return !HI() ? 0 : SET.gfx === 'high' && !LITE() ? 5 : 3; }}; sh.uniforms.tbR = {value: this.userData.bR || PLANET.R};
  cloudShadow(sh, true); if (this !== terrMat) { sh.fragmentShader = '#define IS_MOON\n' + sh.fragmentShader; moonShadow(sh, this.userData.mSun); } sh.vertexShader = 'attribute vec2 tuv, hs; attribute vec4 mw; attribute float tax; varying vec2 vTu, vHs; varying vec4 vMw; varying vec3 vT, vB;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vTu = tuv; vHs = hs; vMw = mw; vec3 tA = tax < .5 ? vec3(0., 0., 1.) : vec3(1., 0., 0.); vec3 bA = tax > .5 && tax < 1.5 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
    vT = normalize(normalMatrix * tA); vB = normalize(normalMatrix * bA);`);
  sh.fragmentShader = 'uniform sampler2D tC0, tC1, tC2, tC3, tN0, tN1, tN2, tN3; uniform vec3 aC0, aC1, aC2, aC3; uniform float hiQ, tHue, lavaK, tKind, tbR, tOct; varying vec2 vTu, vHs; varying vec4 vMw; varying vec3 vT, vB;\n' +
    `
vec3 tdet(sampler2D t, vec3 a){ vec3 c = texture2D(t, vTu).rgb * .65 + texture2D(t, vTu * .125).rgb * .35; float la = dot(a, vec3(.3, .55, .15)); return mix(vec3(dot(c, vec3(.3, .55, .15)) / la), c / a, tHue); }\n` +
    sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float tFd = 1. - smoothstep(150., 1400., length(vViewPosition)); vec4 tW = vMw / max(1e-3, dot(vMw, vec4(1.)));
    if (tFd > 0.) { vec3 dt = tdet(tC0, aC0) * tW.x + tdet(tC1, aC1) * tW.y + tdet(tC2, aC2) * tW.z + tdet(tC3, aC3) * tW.w; diffuseColor.rgb *= mix(vec3(1.), dt, tFd * .9); }
    if (tOct > .5) { float vd = length(vViewPosition); tDetail(normalize(vBd) * tbR, max(1e-3, length(fwidth(vViewPosition)) * .7), vd, diffuseColor.rgb); }
#ifndef IS_MOON
    { vec3 bdn = normalize(vBd); float mv = vn(bdn * 9000.) * .6 + vn(bdn * 2600.) * .4; diffuseColor.rgb *= mix(1., .86 + .28 * mv, 1. - tFd * .6); } // per-pixel field/scrub variation so far ground isn't smooth vertex-colour blobs
#endif`)
    .replace('void main() {', GLSL_TDET + 'void main() {').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .38, gIce);')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    if (tOct > .5) normal = tBump(-vViewPosition, normal, gDH);
    if (hiQ > .5 && tFd > 0.) { vec3 nm = (texture2D(tN0, vTu).xyz * 2. - 1.) * tW.x + (texture2D(tN1, vTu).xyz * 2. - 1.) * tW.y + (texture2D(tN2, vTu).xyz * 2. - 1.) * tW.z + (texture2D(tN3, vTu).xyz * 2. - 1.) * tW.w;
      vec3 tT = normalize(vT - normal * dot(vT, normal)); vec3 tB = cross(normal, tT); tB *= sign(dot(tB, vB)); normal = normalize(tT * nm.x * tFd + tB * nm.y * tFd + normal * max(nm.z, .25)); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef IS_MOON
    if (lavaK > 0.) totalEmissiveRadiance += vec3(1., .26, .035) * tW.w * tW.w * lavaK + gGlow * lavaK; // glowing lava (Ember) and fissures
#endif
#ifndef IS_MOON
    { // city lights on the night side: clusters of warm dots on grassland, only seen from high up
      vec3 cb = normalize(vBd); float nt = smoothstep(.03, -.16, dot(cb, sunB)) * smoothstep(7000., 40000., length(vViewPosition)) * smoothstep(.45, .85, tW.x);
      if (nt > 0.) { float cty = smoothstep(.56, .78, fbm3(cb * 34. + 3.1, 4)), st = smoothstep(.3, .95, vn(cb * 1400.)) * .7 + smoothstep(.62, .9, fbm3(cb * 160., 2)) * .5;
        totalEmissiveRadiance += vec3(1., .62, .3) * nt * cty * (.15 + st) * .035; } }
#endif`);
};
MOON.mat = moonMat;
for (const b of [RUST, FROST, EMBER, PEBBLE]) { const m = terrMat.clone(); m.userData.hue = 0; m.userData.kind = [0, 1, 2, 3, 4, 5][BODIES.indexOf(b)]; m.userData.bR = b.R; m.userData.lava = b.lava || 0; m.userData.mSun = {value: new V3(1, 0, 0)}; m.customProgramCacheKey = () => 'moon'; m.onBeforeCompile = TERR_OBC; b.mat = m; }
// tileable wave normal map, made at load
const waveTex = (() => { const N2 = 256, c = document.createElement('canvas'); c.width = c.height = N2; const x = c.getContext('2d'), im = x.createImageData(N2, N2), H = new Float32Array(N2 * N2);
  for (let j = 0; j < N2; j++) for (let i = 0; i < N2; i++) { let h = 0; for (let k = 0; k < 14; k++) { const a = hsh(k, 1, 2, 9) * 6.283, f = 1 + (k % 7) * 1.0 + (k > 6 ? 5 : 0), kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
      h += Math.sin((kx * i + ky * j) / N2 * 6.283 + hsh(k, 3, 4, 9) * 6.283) / (Math.hypot(kx, ky) + 1); } H[j * N2 + i] = h; }
  for (let j = 0; j < N2; j++) for (let i = 0; i < N2; i++) { const dx = H[j * N2 + (i + 1) % N2] - H[j * N2 + (i + N2 - 1) % N2], dy = H[((j + 1) % N2) * N2 + i] - H[((j + N2 - 1) % N2) * N2 + i];
    const n = new V3(-dx * 3, -dy * 3, 1).normalize(), o = (j * N2 + i) * 4; im.data[o] = (n.x * .5 + .5) * 255; im.data[o + 1] = (n.y * .5 + .5) * 255; im.data[o + 2] = (n.z * .5 + .5) * 255; im.data[o + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; })();
const waterMat = new THREE.MeshStandardMaterial({color: 0x010a14, roughness: .06, metalness: 0, transparent: true, opacity: .97, envMapIntensity: .12, normalMap: waveTex, normalScale: new THREE.Vector2(.35, .35)});
waterMat.onBeforeCompile = sh => { sh.uniforms.wT = G.waterT = G.waterT || {value: 0}; cloudShadow(sh);
  sh.vertexShader = 'attribute float wd; varying float vWd;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWd = wd;');
  // shallow water: turquoise over sand, see-through near the beach, a line of surf at the shore
  sh.fragmentShader = 'varying float vWd;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float dep = max(0., -vWd), vd = length(vViewPosition); diffuseColor.rgb = mix(vec3(.025, .13, .12), diffuseColor.rgb, smoothstep(1., 30., dep));
    diffuseColor.a *= mix(.5, 1., smoothstep(.5, 14., dep));
    float fo = (1. - smoothstep(.2, 1.8, dep)) * (.55 + .45 * sin(wT * 1.1 + dep * 5. + vNormalMapUv.x * 3.)) * (1. - smoothstep(400., 2500., vd));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.7, .74, .75), fo * .7); diffuseColor.a = max(diffuseColor.a, fo * .9);`);
  sh.fragmentShader = 'uniform float wT;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `vec3 wn1 = texture2D(normalMap, vNormalMapUv + vec2(wT * .013, wT * .007)).xyz * 2. - 1., wn2 = texture2D(normalMap, vNormalMapUv * 2.7 - vec2(wT * .011, -wT * .017)).xyz * 2. - 1., wn3 = texture2D(normalMap, vNormalMapUv * .23 + vec2(wT * .002, wT * .003)).xyz * 2. - 1.;
    vec3 mapN = normalize(vec3(wn1.xy + wn2.xy * .6 + wn3.xy * 1.2, 1.)); mapN.xy *= normalScale * (1. - smoothstep(200., 3000., length(vViewPosition)) * .8);
    normal = normalize(tbn * mapN);`).replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n radiance *= .12; iblIrradiance *= .12;').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .2, smoothstep(300., 8000., length(vViewPosition)));'); };
function cubeDir(f, u, v, out) { const F = FACES[f]; let x = F[0] + F[3] * u + F[6] * v, y = F[1] + F[4] * u + F[7] * v, z = F[2] + F[5] * u + F[8] * v;
  // spherified cube for even cells
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out.x = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3); out.y = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3); out.z = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3); return out.normalize(); }
class Node {
  constructor(body, f, l, u, v, s) { this.b = body; this.f = f; this.l = l; this.u = u; this.v = v; this.s = s; this.kids = null; this.mesh = null;
    this.c = cubeDir(f, u + s / 2, v + s / 2, new V3()).multiplyScalar(body.R); this.size = body.R * s * 1.15; }
  build() {
    if (this.b.craters) { const ca = this.c.clone().normalize(), half = this.s * .8 + .01, B = this.b; CR_NEAR = B.craters.filter(c => Math.acos(clamp(ca.dot(c.d), -1, 1)) < half + 2.3 * c.r / B.R); }
    const b = this.b, R = b.R, M = NV + 2, H = new Float32Array(M * M), P = new Float32Array(M * M * 3), d = new V3();
    let hmin = 1e9; const E = b !== PLANET ? 8 : 1, ME = NV + 2 * E, HE = E > 1 ? new Float32Array(ME * ME) : null;
    if (HE) for (let j = 0; j < ME; j++) for (let i = 0; i < ME; i++) { cubeDir(this.f, this.u + this.s * (i - E) / N, this.v + this.s * (j - E) / N, d); HE[j * ME + i] = heightAt(b, d.x, d.y, d.z); }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      cubeDir(this.f, this.u + this.s * (i - 1) / N, this.v + this.s * (j - 1) / N, d); const h = HE ? HE[(j - 1 + E) * ME + i - 1 + E] : heightAt(b, d.x, d.y, d.z), k = j * M + i;
      H[k] = h; const r = R + h; P[k * 3] = d.x * r; P[k * 3 + 1] = d.y * r; P[k * 3 + 2] = d.z * r; if (i > 0 && j > 0 && i <= NV && j <= NV) hmin = Math.min(hmin, h); }
    const nv = NV * NV + 4 * NV, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), cx = this.c.x, cy = this.c.y, cz = this.c.z;
    const bdA = new Float32Array(nv * 3), hsA = new Float32Array(nv * 2), tuv = new Float32Array(nv * 2), mw = new Float32Array(nv * 4), ac = this.c, ax = Math.abs(ac.x) >= Math.abs(ac.y) && Math.abs(ac.x) >= Math.abs(ac.z) ? 0 : Math.abs(ac.y) >= Math.abs(ac.z) ? 1 : 2;
    const SN = 512, sx = Math.round(cx / SN) * SN, sy = Math.round(cy / SN) * SN, sz = Math.round(cz / SN) * SN; // texture coords stay small: snapped offset is a whole number of tiles
    const setT = (o2, px, py, pz) => { px -= sx; py -= sy; pz -= sz; if (ax === 0) { tuv[o2] = pz / 8; tuv[o2 + 1] = py / 8; } else if (ax === 1) { tuv[o2] = px / 8; tuv[o2 + 1] = pz / 8; } else { tuv[o2] = px / 8; tuv[o2 + 1] = py / 8; } };
    this.ax = ax;
    const t1 = new V3(), t2 = new V3(), n = new V3(), up = new V3(), cell = this.size / N;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const k = (j + 1) * M + i + 1, o = (j * NV + i) * 3;
      pos[o] = P[k * 3] - cx; pos[o + 1] = P[k * 3 + 1] - cy; pos[o + 2] = P[k * 3 + 2] - cz;
      t1.set(P[(k + 1) * 3] - P[(k - 1) * 3], P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2]);
      t2.set(P[(k + M) * 3] - P[(k - M) * 3], P[(k + M) * 3 + 1] - P[(k - M) * 3 + 1], P[(k + M) * 3 + 2] - P[(k - M) * 3 + 2]);
      n.crossVectors(t1, t2).normalize(); nrm[o] = n.x; nrm[o + 1] = n.y; nrm[o + 2] = n.z;
      up.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]).normalize(); const slope = 1 - n.dot(up);
      // baked AO: how far this vertex sits below its neighbours (valleys, crater floors get darker)
      const avg = (H[k - 1] + H[k + 1] + H[k - M] + H[k + M]) * .25, ao = clamp(1 + (H[k] - avg) / (cell * 1.5), .55, 1.08);
      const c = colorAt(b, up.x, up.y, up.z, H[k], slope); col[o] = c.r * ao; col[o + 1] = c.g * ao; col[o + 2] = c.b * ao;
      const o4 = (j * NV + i) * 4; mw[o4] = _wt[0]; mw[o4 + 1] = _wt[1]; mw[o4 + 2] = _wt[2]; mw[o4 + 3] = _wt[3]; setT((j * NV + i) * 2, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); bdA[o] = up.x; bdA[o + 1] = up.y; bdA[o + 2] = up.z; hsA[(j * NV + i) * 2] = H[k]; hsA[(j * NV + i) * 2 + 1] = slope;
    }
    // Moon: horizon elevation (radians) in 8 directions per vertex, so the shader can cast terrain shadows for any sun direction
    let hz0 = null, hz1 = null, hzU = null;
    if (HE) { hz0 = new Float32Array(nv * 4); hz1 = new Float32Array(nv * 4); hzU = new Float32Array(nv * 3);
      const kc = ((NV >> 1) + 1) * M + (NV >> 1) + 1, pd = (a, c) => Math.hypot(P[a * 3] - P[c * 3], P[a * 3 + 1] - P[c * 3 + 1], P[a * 3 + 2] - P[c * 3 + 2]);
      const cu = pd(kc, kc + 1), cvv = pd(kc, kc + M), upc = new V3(P[kc * 3], P[kc * 3 + 1], P[kc * 3 + 2]).normalize();
      const uc = new V3(P[(kc + 1) * 3] - P[kc * 3], P[(kc + 1) * 3 + 1] - P[kc * 3 + 1], P[(kc + 1) * 3 + 2] - P[kc * 3 + 2]), vc = new V3(P[(kc + M) * 3] - P[kc * 3], P[(kc + M) * 3 + 1] - P[kc * 3 + 1], P[(kc + M) * 3 + 2] - P[kc * 3 + 2]);
      const sg = new V3().crossVectors(upc, uc).dot(vc) > 0 ? 1 : -1, DIRS = [[1, 0], [1, sg], [0, sg], [-1, sg], [-1, 0], [-1, -sg], [0, -sg], [1, -sg]], i2R = 1 / (2 * R);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) { const o = j * NV + i, h0 = HE[(j + E) * ME + i + E], k = (j + 1) * M + i + 1;
        for (let q = 0; q < 8; q++) { const [di, dj] = DIRS[q], L = Math.hypot(di * cu, dj * cvv); let best = -1e9;
          for (let st = 1; ; st++) { const ii = i + E + di * st, jj = j + E + dj * st; if (ii < 0 || jj < 0 || ii >= ME || jj >= ME) break; const ds = st * L, sl = (HE[jj * ME + ii] - h0 - ds * ds * i2R) / ds; if (sl > best) best = sl; }
          (q < 4 ? hz0 : hz1)[o * 4 + (q & 3)] = best > -1e8 ? Math.atan(best) : -.3; }
        const ux = P[(k + 1) * 3] - P[(k - 1) * 3], uy = P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], uz = P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2], ul = Math.hypot(ux, uy, uz) || 1; hzU[o * 3] = ux / ul; hzU[o * 3 + 1] = uy / ul; hzU[o * 3 + 2] = uz / ul; } }
    // skirts
    const drop = Math.max(2, this.size * .02), edges = [s => [s, 0], s => [s, N], s => [0, s], s => [N, s]];
    for (let e = 0; e < 4; e++) for (let s = 0; s < NV; s++) { const [i, j] = edges[e](s), src = (j * NV + i) * 3, o = (NV * NV + e * NV + s) * 3;
      const px = pos[src] + cx, py = pos[src + 1] + cy, pz = pos[src + 2] + cz, L = Math.hypot(px, py, pz), k2 = (L - drop) / L;
      pos[o] = px * k2 - cx; pos[o + 1] = py * k2 - cy; pos[o + 2] = pz * k2 - cz; for (let q = 0; q < 3; q++) { nrm[o + q] = nrm[src + q]; col[o + q] = col[src + q]; bdA[o + q] = bdA[src + q]; if (hzU) hzU[o + q] = hzU[src + q]; } if (hz0) { const s4b = src / 3 * 4, o4b = o / 3 * 4; for (let q = 0; q < 4; q++) { hz0[o4b + q] = hz0[s4b + q]; hz1[o4b + q] = hz1[s4b + q]; } } const s4 = src / 3 * 4, o4 = o / 3 * 4; for (let q = 0; q < 4; q++) mw[o4 + q] = mw[s4 + q]; tuv[o / 3 * 2] = tuv[src / 3 * 2]; tuv[o / 3 * 2 + 1] = tuv[src / 3 * 2 + 1]; hsA[o / 3 * 2] = hsA[src / 3 * 2]; hsA[o / 3 * 2 + 1] = hsA[src / 3 * 2 + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (hz0) { g.setAttribute('hz0', new THREE.BufferAttribute(hz0, 4)); g.setAttribute('hz1', new THREE.BufferAttribute(hz1, 4)); g.setAttribute('hzU', new THREE.BufferAttribute(hzU, 3)); }
    g.setAttribute('bd', new THREE.BufferAttribute(bdA, 3)); g.setAttribute('tuv', new THREE.BufferAttribute(tuv, 2)); g.setAttribute('hs', new THREE.BufferAttribute(hsA, 2)); g.setAttribute('mw', new THREE.BufferAttribute(mw, 4)); g.setAttribute('tax', new THREE.BufferAttribute(new Float32Array(nv).fill(ax), 1));
    g.setIndex(terrIndex); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, b.mat || terrMat); m.position.copy(this.c); m.receiveShadow = true; m.castShadow = this.l >= b.maxL - 3;
    if (b.water && hmin < 4) { // sea at radius R, 17x17 grid
      const W = 17, wp = new Float32Array(W * W * 3), wi = [], wdA = new Float32Array(W * W);
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { cubeDir(this.f, this.u + this.s * i / (W - 1), this.v + this.s * j / (W - 1), d); wdA[j * W + i] = heightAt(b, d.x, d.y, d.z); const o = (j * W + i) * 3; wp[o] = d.x * R - cx; wp[o + 1] = d.y * R - cy; wp[o + 2] = d.z * R - cz; }
      for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; wi.push(a, a + 1, a + W + 1, a, a + W + 1, a + W); }
      const wu = new Float32Array(W * W * 2); for (let k = 0; k < W * W; k++) { const px = wp[k * 3] + cx - sx, py = wp[k * 3 + 1] + cy - sy, pz = wp[k * 3 + 2] + cz - sz; wu[k * 2] = (ax === 0 ? pz : px) / 64; wu[k * 2 + 1] = (ax === 1 ? pz : py) / 64; }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.BufferAttribute(wu, 2)); { const wb = new Float32Array(W * W * 3); for (let k = 0; k < W * W; k++) { const L = Math.hypot(wp[k * 3] + cx, wp[k * 3 + 1] + cy, wp[k * 3 + 2] + cz); wb[k * 3] = (wp[k * 3] + cx) / L; wb[k * 3 + 1] = (wp[k * 3 + 1] + cy) / L; wb[k * 3 + 2] = (wp[k * 3 + 2] + cz) / L; } wg.setAttribute('bd', new THREE.BufferAttribute(wb, 3)); } wg.setAttribute('wd', new THREE.BufferAttribute(wdA, 1)); wg.setIndex(wi); wg.computeVertexNormals(); wg.computeTangents ? 0 : 0; wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, waterMat); wm.receiveShadow = true; m.add(wm); }
    CR_NEAR = null; this.mesh = m; m.visible = false; b.group.add(m); TERR.built++;
  }
  free() { if (this.kids) { for (const k of this.kids) k.free(); this.kids = null; }
    if (this.mesh) { this.b.group.remove(this.mesh); this.mesh.geometry.dispose(); for (const c of this.mesh.children) c.geometry.dispose(); this.mesh = null; } }
}
const TERR = {queue: [], built: 0};
function initBody(b) {
  b.group = new THREE.Group(); scene.add(b.group); b.roots = [];
  for (let f = 0; f < 6; f++) b.roots.push(new Node(b, f, 0, -1, -1, 2));
  if (b === PLANET) makeClouds(b);
}
// cloud layer at 2.6 km: noise coverage, sun + self shadow, slow drift, rotates with the planet
const CLOUD_H = 2200;
function makeClouds(b) {
  const m = new THREE.ShaderMaterial({transparent: true, depthWrite: true, side: THREE.DoubleSide,
    uniforms: Object.assign(atmoU(), {sun: {value: new V3()}, sunC: {value: new THREE.Color()}, sky: {value: new THREE.Color()}, t: {value: 0}}),
    vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vP, vN; void main(){ vP = normalize(position); vN = normalize((modelMatrix * vec4(position, 0.)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\n' + GLSL_NOISE + GLSL_ATMO + `uniform vec3 sun, sunC, sky; uniform float t; varying vec3 vP, vN;
      float cov(vec3 p){ vec3 q = p * 6. + vec3(t * .0006, 0., t * .0004); float c = fbm3(q, 4) + (fbm3(p * 55. + q * .2, 4) - .5) * .32 + (vn(p * 420.) - .5) * .06; return smoothstep(.47, .8, c); }
      void main(){
        #include <logdepthbuf_fragment>
        float c = cov(vP);
        #ifdef DEPTHONLY
        if (c < .6) discard; gl_FragColor = vec4(0.); return;
        #endif
        if (c < .01) discard;
        vec3 n = normalize(vN), wp = n * (R + ${CLOUD_H}.); float l = dot(n, sun), sh = cov(normalize(vP + sun * .004));
        // sunlight reaching this cloud: blocked by the planet, reddened by the air in between
        vec3 sl = vec3(0.); vec2 g = rs(wp, sun, R - 200.);
        if (!(g.x > 0. && g.x < 1e19)) { float lt = rs(wp, sun, Ra).y / 8., oR = 0., oM = 0., oO = 0.; for (int j = 0; j < 8; j++) { float hh = max(0., length(wp + sun * lt * (float(j) + .5)) - R); oR += exp(-hh / hR) * lt; oM += exp(-hh / hM) * lt; oO += ozone(hh) * lt; } sl = exp(-(bR * oR + bM * 1.1 * oM + bO * oO)); }
        float lit = (.35 + .65 * smoothstep(-.3, .3, l)) * (1. - sh * .5);
        float tw = smoothstep(.25, 0., l) * smoothstep(-.2, .02, l); // twilight: cloud undersides pick up a pink-violet glow from the sky
        vec3 col = sl * sunC * lit * (.85 + .15 * c) * 1.3 + sky * (.4 + .3 * c) * (.15 + .85 * smoothstep(-.05, .35, l)) + vec3(.6, .3, .42) * tw * .3 * (.5 + .5 * c);
        gl_FragColor = vec4(col, smoothstep(0., .6, c) * .95); }`});
  // depth only where the cloud is thick (so thin edges don't cut off the sky glow behind them), then colour without depth writes
  const dm = m.clone(); dm.uniforms = m.uniforms; dm.colorWrite = false; dm.transparent = false; dm.defines = {DEPTHONLY: 1}; m.depthWrite = false;
  const geo = new THREE.SphereGeometry(b.R + CLOUD_H, 384, 192);
  const sd = new THREE.Mesh(geo, dm); sd.renderOrder = 1; sd.frustumCulled = false; b.group.add(sd);
  const sp = new THREE.Mesh(geo, m); sp.renderOrder = 2; sp.frustumCulled = false; b.group.add(sp); b.clouds = m; b.cloudMeshes = [sd, sp];
}
// walk the tree: show leaves that are ready, queue missing meshes (nearest first)
function updateTree(n, cp, want) {
  const dist = cp.distanceTo(n.c), split = n.l < n.b.maxL && dist < n.size * 1.7;
  // horizon cull: skip nodes well beyond the horizon
  const cl = cp.length(), R = n.b.R, hor = Math.sqrt(Math.max(0, cl * cl - R * R)) + Math.sqrt(Math.max(0, (R + 9000) ** 2 - R * R));
  if (dist - n.size > hor && n.l > 0) { if (n.mesh) n.mesh.visible = false; if (n.kids) for (const k of n.kids) hideAll(k); return true; }
  if (split) {
    if (!n.kids) { const h = n.s / 2; n.kids = [new Node(n.b, n.f, n.l + 1, n.u, n.v, h), new Node(n.b, n.f, n.l + 1, n.u + h, n.v, h), new Node(n.b, n.f, n.l + 1, n.u, n.v + h, h), new Node(n.b, n.f, n.l + 1, n.u + h, n.v + h, h)]; }
    let ready = true; for (const k of n.kids) if (!k.mesh) { ready = false; want.push([dist, k]); }
    if (ready || !n.mesh) { if (n.mesh) n.mesh.visible = false; let ok = true; for (const k of n.kids) ok = updateTree(k, cp, want) && ok; if (!n.mesh) return ok; return true; }
    n.mesh.visible = true; for (const k of n.kids) hideAll(k); return true;
  }
  if (n.kids) { for (const k of n.kids) k.free(); n.kids = null; }
  if (!n.mesh) { want.push([dist, n]); return false; }
  n.mesh.visible = true; return true;
}
function hideAll(n) { if (n.mesh) n.mesh.visible = false; if (n.kids) for (const k of n.kids) hideAll(k); }
const _cp = new V3(), _qi = new Q4();
function updateTerrain(budget) {
  const want = [];
  for (const b of BODIES) { _cp.copy(G.O).sub(b.c).applyQuaternion(_qi.copy(b.q).invert()); for (const r of b.roots) updateTree(r, _cp, want); }
  want.sort((a, b) => a[0] - b[0]); const t0 = performance.now();
  for (let i = 0; i < want.length && (i < 1 || performance.now() - t0 < budget); i++) if (!want[i][1].mesh) want[i][1].build();
  return want.length;
}
// exact ground height under a body-fixed point (for walking)
function groundR(b, p) { const L = p.length(); const h = heightAt(b, p.x / L, p.y / L, p.z / L); return b.R + (b.water ? Math.max(h, -1.1) : h); }

// ---------------- space centre (site frame: x east, y up, z south)
const site = {};
function buildSite() {
  const U = SITE.clone(), E = new V3(0, 0, -1), Nn = new V3(0, 1, 0);
  site.q = new Q4().setFromRotationMatrix(new THREE.Matrix4().makeBasis(E, U, Nn.clone().negate()));
  site.p = U.clone().multiplyScalar(PLANET.R + SITE_H);
  const g = site.g = new THREE.Group(); g.position.copy(site.p); g.quaternion.copy(site.q); PLANET.group.add(g);
  site.boxes = []; // collision boxes in site coords {x0,x1,y0,y1,z0,z1}
  const mats = {};
  // textured materials: t = texture set, tile = metres per repeat
  const mat = (c, r = .8, m = 0, e, t, tile = 4) => { const k = [c, r, m, e, t, tile].join('|'); if (mats[k]) return mats[k];
    const o = {color: c, roughness: r, metalness: m, emissive: e || 0, emissiveIntensity: e ? 2 : 0};
    if (t) { o.map = tex(t, 'c'); o.roughnessMap = tex(t, 'r'); o.roughness = 1; if (HI()) { o.normalMap = tex(t, 'n'); o.normalScale = new THREE.Vector2(1, 1); } }
    const M = new THREE.MeshStandardMaterial(o); M.userData.tile = tile; return mats[k] = M; };
  // baked AO on boxes: darken low vertices and the underside, like light bouncing off the ground
  function aoBox(w, h, d, ox, oy, oz, tile) { const geo = new THREE.BoxGeometry(w, h, d); const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + h / 2; let a = .55 + .45 * sstep(0, Math.min(3, h), y); if (n.getY(i) < -.5) a *= .5; if (n.getY(i) > .5) a = 1; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = a;
      // world-scale UVs so textures line up across boxes
      const wx = p.getX(i) + ox, wy = p.getY(i) + oy, wz = p.getZ(i) + oz, nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      if (ny > .5) uv.setXY(i, wx / tile, wz / tile); else if (nx > .5) uv.setXY(i, wz / tile, wy / tile); else uv.setXY(i, wx / tile, wy / tile); }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }
  function box(x, y, z, w, h, d, color, solid = true, o = {}) {
    const M = o.m || mat(color, o.r, o.mt, o.e, o.t, o.tile); const m = new THREE.Mesh(aoBox(w, h, d, x, y + h / 2, z, M.userData.tile || 4), M); m.material.vertexColors = true; m.position.set(x, y + h / 2, z); m.castShadow = o.cast !== false; m.receiveShadow = true; g.add(m);
    if (solid) site.boxes.push({x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h, z0: z - d / 2, z1: z + d / 2}); return m; }
  function cyl(x, y, z, r, h, color, solid = true, seg = 24) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color)); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m);
    if (solid) site.boxes.push({x0: x - r * .8, x1: x + r * .8, y0: y, y1: y + h, z0: z - r * .8, z1: z + r * .8}); return m; }
  // ground slabs
  box(0, -1, 40, 220, 1.05, 160, 0xffffff, false, {t: 'concrete', tile: 6});            // concrete apron
  box(-560 + 760, -1, 330, 1520, 1.08, 46, 0xffffff, false, {t: 'asphalt', tile: 8});      // runway
  for (let x = -540; x < 940; x += 40) box(x, .06, 330, 18, .02, 1.2, 0xe8e6df, false, {cast: false});
  box(150, -1, 40, 260, 1.06, 14, 0xd8d8d8, false, {t: 'concrete', tile: 5});                        // crawlerway to the pads
  const groundY = (x, z) => { const v = new V3(x, 0, z).applyQuaternion(site.q).add(site.p), L = v.length(); v.divideScalar(L); return Math.max(heightAt(PLANET, v.x, v.y, v.z), 0) + PLANET.R - L; }; // site-frame height of the real ground
  // --- helpers: merged geometry for many small parts (lattices, trees) = one draw call
  function mergeGeos(list) { let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
    for (const g of list) { const p = g.attributes.position, q = g.attributes.normal, c = g.attributes.color; for (let i = 0; i < p.count; i++, o++) { P[o * 3] = p.getX(i); P[o * 3 + 1] = p.getY(i); P[o * 3 + 2] = p.getZ(i); Nn[o * 3] = q.getX(i); Nn[o * 3 + 1] = q.getY(i); Nn[o * 3 + 2] = q.getZ(i);
      C[o * 3] = c ? c.getX(i) : 1; C[o * 3 + 1] = c ? c.getY(i) : 1; C[o * 3 + 2] = c ? c.getZ(i) : 1; } g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.computeBoundingSphere(); return g; }
  const tint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const _a = new V3(), _b = new V3(), _m4 = new THREE.Matrix4(), _qq = new Q4(), _Y = new V3(0, 1, 0);
  function beamGeo(a, b, r, hex, seg = 6) { const g = new THREE.CylinderGeometry(r, r, 1, seg).toNonIndexed(); const d = _b.copy(b).sub(a), L = d.length(); _qq.setFromUnitVectors(_Y, d.normalize());
    _m4.compose(_a.copy(a).add(b).multiplyScalar(.5), _qq, new V3(1, L, 1)); g.applyMatrix4(_m4); return tint(g, hex); }
  function boxGeo(x, y, z, w, h, d, hex) { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y + h / 2, z); return tint(g, hex); }
  const vcMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .55, metalness: .35});
  function addMerged(list, m = vcMat) { const mesh = new THREE.Mesh(mergeGeos(list), m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; }
  // painted signs (canvas textures)
  function signTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  function logo(x, w, h, sub) { x.fillStyle = '#16233a'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffcf4a'; x.fillRect(0, h * .84, w, h * .06);
    x.font = `600 ${h * .5}px Archivo, Arial Rounded MT Bold, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('YE', w / 2 - h * .52, h * .43); x.fillStyle = '#ffcf4a'; x.fillText('SHIP', w / 2 + h * .48, h * .43);
    if (sub) { x.font = `500 ${h * .1}px Archivo, sans-serif`; x.fillStyle = '#9fb6cc'; x.fillText(sub, w / 2, h * .73); } }
  const stripes = signTex(128, 32, (x, w, h) => { x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffcf2a'; for (let i = -2; i < 8; i++) { x.beginPath(); x.moveTo(i * 32, h); x.lineTo(i * 32 + 16, h); x.lineTo(i * 32 + 48, 0); x.lineTo(i * 32 + 32, 0); x.fill(); } });
  stripes.wrapS = THREE.RepeatWrapping;
  function decal(t, x, y, z, w, h, ry = 0, rep = 1) { const tt = rep > 1 ? t.clone() : t; if (rep > 1) { tt.repeat.set(rep, 1); tt.needsUpdate = true; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({map: tt, roughness: .6})); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); return m; }
  const glass = new THREE.MeshStandardMaterial({color: 0x1d3550, roughness: .05, metalness: .9, envMapIntensity: 1.4});

  // ---- HANGAR (the build hall): door faces south (+z)
  const HW = 46, HD = 52, HH = 34, T = 1.2, hx = 0, hz = 0, wall = 0xf2f5f8, WT = {t: 'corrugated', tile: 5};
  box(hx, 0, hz - HD / 2, HW, HH, T, wall, true, WT);
  box(hx - HW / 2, 0, hz, T, HH, HD, wall, true, WT); box(hx + HW / 2, 0, hz, T, HH, HD, wall, true, WT);
  box(hx, HH, hz, HW + 2, 1.6, HD + 2, 0x8a9096, true, {t: 'plate', tile: 4});                                       // roof
  box(hx, 26, hz + HD / 2, HW, 8, T, wall, true, WT);                                                               // header over the door
  box(hx - HW / 2 + 2.5, 0, hz + HD / 2, 5, 26, T, wall, true, WT); box(hx + HW / 2 - 2.5, 0, hz + HD / 2, 5, 26, T, wall, true, WT);
  // concrete plinth, parapet, pilasters, high window band
  box(hx, 0, hz - HD / 2 - .2, HW + 1.2, 2.2, T + .6, 0xb9b9b4, false, {r: .85}); box(hx - HW / 2 - .2, 0, hz, T + .6, 2.2, HD + 1.2, 0xb9b9b4, false, {r: .85}); box(hx + HW / 2 + .2, 0, hz, T + .6, 2.2, HD + 1.2, 0xb9b9b4, false, {r: .85});
  box(hx, HH + 1.6, hz, HW + 2.4, .9, HD + 2.4, 0x3c4450, false);
  { const L = []; for (let z = -HD / 2; z <= HD / 2; z += 8.6) for (const sx of [-1, 1]) L.push(boxGeo(hx + sx * (HW / 2 + .75), 0, hz + z, .5, HH + 1.6, 1, 0x4a5563));
    for (let x = -HW / 2; x <= HW / 2; x += 9.2) L.push(boxGeo(hx + x, 0, hz - HD / 2 - .75, 1, HH + 1.6, .5, 0x4a5563));
    for (const sx of [-1, 1]) for (const x of [-HW / 2 + 1.2, HW / 2 - 1.2]) L.push(boxGeo(hx + x, 0, hz + HD / 2 + .8, 1.6, 34.5, .6, 0x4a5563));
    addMerged(L); }
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(.2, 2.6, HD - 6), glass); w.position.set(hx + sx * (HW / 2 + .62), 28, hz); g.add(w); }
  // big logo panel over the door, a stripe band and sliding door leaves parked to the sides
  decal(signTex(1024, 256, (x, w, h) => logo(x, w, h, 'VEHICLE ASSEMBLY')), hx, 30, hz + HD / 2 + .62, 30, 7.5);
  decal(stripes, hx, 25.6, hz + HD / 2 + .62, 36, .8, 0, 24);
  for (const sx of [-1, 1]) { box(hx + sx * (HW / 2 + 5.5), 0, hz + HD / 2 + 1.6, 10, 25.6, .6, 0x5d6f86, false, {t: 'plate', tile: 3}); decal(stripes, hx + sx * (HW / 2 + 5.5), 1.2, hz + HD / 2 + 1.92, 10, .7, 0, 7); }
  box(hx, 0, hz + HD / 2 + 1.6, HW + 24, .25, .5, 0x333333, false); // door track
  // the inside of the hangar (lining, lights, rocket on the stand, parts displays) is built by world.js

  // ---- MISSION CONTROL (walk in through the south-east door): flight control room downstairs, glass viewing deck upstairs, roof antennas
  { const im = {}, imat = (c, r = .8, mt = 0, t, tile = 4, U = INT_MC, e) => { const k = [c, r, mt, t && t.uuid, tile, U === INT_MC ? 'm' : 'd', e].join('|'); if (im[k]) return im[k];
      const M = new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: mt, map: t || null, emissive: e || 0, emissiveIntensity: e ? 2 : 0}); M.userData.tile = tile; return im[k] = interiorMat(M, U); };
    const rep = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
    const carpetT = rep(signTex(256, 256, (x, w, h) => { x.fillStyle = '#1c2a44'; x.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { x.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      x.strokeStyle = 'rgba(120,160,220,.08)'; x.lineWidth = 2; for (let i = 0; i < w; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); } }));
    const woodT = rep(signTex(256, 256, (x, w, h) => { for (let j = 0; j < 8; j++) { const b = 95 + (j * 37) % 30; x.fillStyle = `rgb(${b + 40},${b + 8},${b - 30})`; x.fillRect(0, j * 32, w, 32); for (let i = 0; i < 30; i++) { x.fillStyle = 'rgba(60,30,10,.12)'; x.fillRect(0, j * 32 + Math.random() * 32, w, 1); } x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, j * 32, w, 1.5); x.fillRect(((j * 97) % 200) + 20, j * 32, 1.5, 32); } }));
    const panelT = rep(signTex(256, 256, (x, w, h) => { x.fillStyle = '#d7d5cf'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < w; i += 64) x.fillRect(i, 0, 2, h); x.fillRect(0, 0, w, 2); }));
    const M = {wall: imat(0xffffff, .9, 0, panelT, 2.4), wain: imat(0xffffff, .55, 0, woodT, 2), carpet: imat(0xffffff, .95, 0, carpetT, 3), ceil: imat(0xa8acb2, .9), desk: imat(0x2b3138, .45, .5), top: imat(0x15181c, .3, .2),
      step: imat(0x8a8f96, .6, .4), bezel: imat(0x0c0e12, .4, .3), deckFloor: imat(0xffffff, .5, 0, woodT, 2, INT_DECK), sofa: imat(0x39506e, .95, 0, null, 4, INT_DECK), table: imat(0x23272d, .35, .4, null, 4, INT_DECK),
      rug: imat(0xb8a98c, .95, 0, null, 4, INT_DECK), dceil: imat(0xe8e8e4, .9, 0, null, 4, INT_DECK), white: imat(0xeeeeea, .4, .1, null, 4, INT_DECK), plant: imat(0x2f6b34, .8, 0, null, 4, INT_DECK), pot: imat(0xc9c1b4, .7), led: imat(0x000000, .5, 0, null, 4, INT_MC, 0x3aa0ff), lamp: imat(0x000000, .5, 0, null, 4, INT_MC, 0xfff1dc)};
    const vcI = interiorMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .6, metalness: .25})), vcD = interiorMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .6, metalness: .25}), INT_DECK);
    const seeGlass = new THREE.MeshStandardMaterial({color: 0x86a6c0, roughness: .03, metalness: .25, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide});
    const pane = (x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), seeGlass); m.position.set(x, y + h / 2, z); m.renderOrder = 3; g.add(m); site.boxes.push({x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h, z0: z - d / 2, z1: z + d / 2}); };
    const scrn = (name, k, x, y, z, w, h, ry = 0) => { const n = new V3(Math.sin(ry), 0, Math.cos(ry)), b = new THREE.Mesh(new THREE.BoxGeometry(w + .14, h + .14, .08), M.bezel); b.position.set(x, y, z).addScaledVector(n, -.045); b.rotation.y = ry; b.castShadow = true; g.add(b);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(name, k)); p.position.set(x, y, z); p.rotation.y = ry; g.add(p); };
    const X0 = -97, X1 = -67, Z0 = 59, Z1 = 81, T = .4, H = 5.6, cw = 0xe9e7e2, ex = {r: .85};
    // shell: walls with a door (south-east) and a window band facing the pads (east)
    box(-82, 0, Z0 + T / 2, 30, H, T, cw, true, ex); box(X0 + T / 2, 0, 70, T, H, 22, cw, true, ex);
    box(-85.25, 0, Z1 - T / 2, 23.5, H, T, cw, true, ex); box(-69, 0, Z1 - T / 2, 4, H, T, cw, true, ex); box(-72.25, 3.2, Z1 - T / 2, 2.5, H - 3.2, T, cw, true, ex);
    box(X1 - T / 2, 0, 70, T, 1.2, 22, cw, true, ex); box(X1 - T / 2, 4.4, 70, T, 1.2, 22, cw, true, ex); box(X1 - T / 2, 1.2, 60, T, 3.2, 2, cw, true, ex); box(X1 - T / 2, 1.2, 80, T, 3.2, 2, cw, true, ex);
    pane(X1 - T / 2, 1.2, 70, .08, 3.2, 18);
    { const L = []; for (let z = 61; z <= 79.01; z += 2.25) L.push(boxGeo(X1 - T / 2, 1.2, z, .16, 3.2, .12, 0x2b313a)); for (const [x0, x1] of [[-73.5, -73.5], [-71, -71]]) L.push(boxGeo(x0, 0, Z1 - T / 2, .16, 3.2, .5, 0x2b313a)); L.push(boxGeo(-72.25, 3.2, Z1 - T / 2, 2.7, .16, .5, 0x2b313a));
      for (const x of [-74.8, -69.7]) L.push(boxGeo(x, 0, Z1 + .05, 1.3, .06, .12, 0x2b313a)); addMerged(L); }
    for (const x of [-74.8, -69.7]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.25, 3.0, .05), seeGlass); m.position.set(x, 1.55, Z1 + .08); m.renderOrder = 3; g.add(m); } // door leaves slid open
    box(-72.25, 3.4, Z1 + 1.1, 4.4, .22, 2.2, 0x3c4450, false); // entrance canopy
    // linings, wood wainscot, carpet, ceiling with light panels
    const lin = (x, z, w, d, y0 = 0, h = H) => { box(x, y0, z, w, h, d, 0xffffff, false, {m: M.wall, cast: false}); if (y0 < 1) box(x, y0, z, w + (w > d ? 0 : .04), Math.min(1.1, h), d + (d > w ? 0 : .04), 0xffffff, false, {m: M.wain, cast: false}); };
    lin(-82, Z0 + T + .02, 29.2, .04); lin(X0 + T + .02, 70, .04, 21.2); lin(-85.05, Z1 - T - .02, 23.1, .04); lin(-69.2, Z1 - T - .02, 3.6, .04); box(-72.25, 3.2, Z1 - T - .02, 2.5, H - 3.2, .04, 0xffffff, false, {m: M.wall, cast: false});
    lin(X1 - T - .02, 70, .04, 21.2, 0, 1.2); box(X1 - T - .02, 4.4, 70, .04, 1.2, 21.2, 0xffffff, false, {m: M.wall, cast: false}); lin(X1 - T - .02, 60.2, .04, 1.6); lin(X1 - T - .02, 79.8, .04, 1.6);
    box(-82, 0, 70, 29.2, .03, 21.2, 0xffffff, false, {m: M.carpet, cast: false});
    box(-81, H - .12, 70, 27.2, .1, 21.2, 0xffffff, false, {m: M.ceil}); box(-95.6, H - .12, 60.7, 2, .1, 2.6, 0xffffff, false, {m: M.ceil});
    for (let x = -91; x <= -71; x += 5) for (let z = 62; z <= 78; z += 4) box(x, H - .15, z, 1.8, .04, .6, 0xffffff, false, {m: M.lamp, cast: false});
    // floor slab between the storeys (opening over the stairs)
    box(-80.3, H, 70, 28.6, .4, 24, 0x9aa0a6, true); box(-96.3, H, 60, 3.4, .4, 4, 0x9aa0a6, true); box(-97.3, H, 72, 1.4, .4, 20, 0x9aa0a6, true);
    // stairs up the west wall (south to north), with a rail
    for (let i = 0; i < 20; i++) box(-95.7, 0, 79 - (i + .5) * .85, 1.8, (i + 1) * .3, .85, 0xffffff, true, {m: M.step});
    { const L = []; for (let i = 0; i <= 20; i += 2) { const z = 79 - i * .85, y = i * .3; L.push(beamGeo(new V3(-94.75, y, z), new V3(-94.75, y + 1, z), .03, 0x9aa4ae)); } L.push(beamGeo(new V3(-94.75, 1, 79), new V3(-94.75, 7, 62), .035, 0xffcf2a)); addMerged(L, vcI); }
    site.boxes.push({x0: -94.85, x1: -94.65, y0: 0, y1: 7, z0: 62, z1: 76.5});
    // tiered floor + three rows of consoles facing the big screens
    box(-84.8, 0, 71.1, 19.6, .35, 5, 0xffffff, true, {m: M.carpet}); box(-84.8, 0, 77.1, 19.6, .7, 7, 0xffffff, true, {m: M.carpet});
    box(-84.8, .3, 68.62, 19.6, .03, .04, 0xffffff, false, {m: M.led, cast: false}); box(-84.8, .65, 73.62, 19.6, .03, .04, 0xffffff, false, {m: M.led, cast: false});
    const NAMES = ['FLIGHT', 'BOOSTER', 'GUIDANCE', 'NAV', 'SYSTEMS', 'COMMS', 'CAPCOM', 'RECOVERY', 'WEATHER', 'RANGE', 'TRAJECTORY', 'SURGEON', 'NETWORK', 'POWER', 'THERMAL', 'PROPULSION', 'PAYLOAD', 'PAO'], SCRS = ['tele', 'orbit', 'sys', 'graph', 'net', 'code', 'wx', 'map'];
    const L = []; let ni = 0;
    for (const [cz, by] of [[66, 0], [71, .35], [77, .7]]) for (let c = 0; c < 6; c++) { const cx = -91.6 + c * 3;
      box(cx, by, cz, 2.8, .75, .9, 0xffffff, true, {m: M.desk}); box(cx, by + .75, cz + .05, 2.9, .05, 1.0, 0xffffff, false, {m: M.top}); box(cx, by + .8, cz - .4, 2.8, .4, .12, 0xffffff, false, {m: M.desk});
      for (const s of [-1, 1]) { const nm = SCRS[(ni * 2 + (s > 0 ? 1 : 0) + c) % SCRS.length]; scrn(nm, 1.3, cx + s * .66, by + 1.55, cz - .25, .98, .56); L.push(boxGeo(cx + s * .66, by + .8, cz - .3, .08, .5, .08, 0x30343a)); }
      L.push(boxGeo(cx - .5, by + .8, cz + .2, .55, .025, .2, 0x202328), boxGeo(cx + .5, by + .8, cz + .2, .55, .025, .2, 0x202328), boxGeo(cx + .9, by + .8, cz + .25, .08, .03, .12, 0x202328));
      for (const s of [-1, 1]) { const x = cx + s * .7, z = cz + 1.05; L.push(boxGeo(x, by + .42, z, .55, .09, .52, 0x24282e), boxGeo(x, by + .55, z + .3, .52, .62, .08, 0x24282e), boxGeo(x, by + .1, z, .06, .33, .06, 0x8a9099), boxGeo(x, by + .06, z, .62, .04, .07, 0x8a9099), boxGeo(x, by + .06, z, .07, .04, .62, 0x8a9099)); }
      const t = signTex(256, 48, (x, w, h) => { x.fillStyle = '#0f1726'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffcf4a'; x.font = '600 26px Archivo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(NAMES[ni % NAMES.length], w / 2, h / 2 + 1); });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .2), interiorMat(new THREE.MeshStandardMaterial({map: t, roughness: .5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .5}))); pl.position.set(cx, by + .5, cz + .456); g.add(pl); ni++; }
    addMerged(L, vcI);
    // the big screens on the front wall
    scrn('map', 1.6, -82, 3.15, Z0 + T + .1, 8.4, 4.2); scrn('graph', 1.4, -90.5, 3.7, Z0 + T + .1, 5.2, 2.6); scrn('tele', 1.4, -73.5, 3.7, Z0 + T + .1, 5.2, 2.6); scrn('net', 1.3, -90.5, 1.55, Z0 + T + .1, 3.2, 1.6); scrn('orbit', 1.3, -73.5, 1.55, Z0 + T + .1, 3.2, 1.6);
    // lobby by the door: reception, a model rocket, plants, mission patches
    box(-69.6, 0, 75.5, 1.1, 1.1, 3.4, 0xffffff, true, {m: M.desk}); box(-69.6, 1.1, 75.5, 1.3, .05, 3.6, 0xffffff, false, {m: M.top}); scrn('tele', 1.2, -70.1, 1.45, 74.8, .6, .34, -Math.PI / 2);
    box(-70.5, 0, 64, 1.4, 1, 1.4, 0xffffff, true, {m: M.desk}); { const rk = new THREE.Group(); rk.position.set(-70.5, 1, 64); g.add(rk); const wm = imat(0xf2f2ee, .35, .05), km = imat(0x17191d, .5);
      for (const [r0, r1, y0, y1, m] of [[.07, .07, .13, .75, wm], [.07, .07, .74, .84, km], [.07, .12, .84, .9, wm], [.125, .05, .9, 1.06, wm], [.05, .01, 1.06, 1.1, km]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 20), m); c.position.y = (y0 + y1) / 2; c.castShadow = true; rk.add(c); }
      const bl = new THREE.Mesh(new THREE.CylinderGeometry(.03, .05, .13, 16), km); bl.position.y = .065; rk.add(bl); }
    for (const [x, z] of [[-68.2, 60.2], [-68.2, 70], [-75.6, 80.1]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.3, .24, .6, 16), M.pot); p.position.set(x, .3, z); p.castShadow = true; g.add(p); for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(new THREE.ConeGeometry(.16, 1.1, 6), M.plant); l.position.set(x + Math.cos(k) * .1, 1.05, z + Math.sin(k) * .1); l.rotation.set(Math.sin(k * 2) * .4, 0, Math.cos(k * 2) * .4); l.castShadow = true; g.add(l); } }
    ['YS-1', 'ORBIT', 'MOON'].forEach((nm, i) => { const t = signTex(256, 256, (x, w, h) => { x.fillStyle = '#0b1424'; x.fillRect(0, 0, w, h); x.fillStyle = ['#ff8a1e', '#3aa0ff', '#c9c9c9'][i]; x.beginPath(); x.arc(128, 128, 104, 0, 7); x.fill(); x.fillStyle = '#0b1424'; x.beginPath(); x.arc(128, 128, 86, 0, 7); x.fill();
        x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(128, 60); x.lineTo(146, 120); x.lineTo(140, 170); x.lineTo(116, 170); x.lineTo(110, 120); x.fill(); x.fillStyle = '#ffcf4a'; x.font = '600 30px Archivo, sans-serif'; x.textAlign = 'center'; x.fillText(nm, 128, 210); });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), interiorMat(new THREE.MeshStandardMaterial({map: t, roughness: .4}))); p.position.set(-90 + i * 4, 3.4, Z1 - T - .05); p.rotation.y = Math.PI; g.add(p); });
    // ---- upstairs: the glass viewing deck
    const D = 6.0; box(-80.3, D, 70, 28.6, .03, 24, 0xffffff, false, {m: M.deckFloor, cast: false}); box(-96.3, D, 60, 3.4, .03, 4, 0xffffff, false, {m: M.deckFloor, cast: false}); box(-97.3, D, 72, 1.4, .03, 20, 0xffffff, false, {m: M.deckFloor, cast: false});
    box(-82, 12.8, 70, 32, .2, 24, 0xffffff, false, {m: M.dceil, cast: false});
    pane(-82, 6, 58.05, 32, 7, .06); pane(-82, 6, 81.95, 32, 7, .06); pane(-97.95, 6, 70, .06, 7, 24); pane(-66.05, 6, 70, .06, 7, 24);
    { const L2 = []; for (let z = 62.6; z <= 80.6; z += 2) L2.push(beamGeo(new V3(-94.6, 6, z), new V3(-94.6, 7, z), .03, 0x9aa4ae)); L2.push(beamGeo(new V3(-94.6, 7, 62), new V3(-94.6, 7, 80.6), .035, 0xffcf2a));
      for (let z = 62.6; z <= 80.6; z += 2) L2.push(beamGeo(new V3(-96.6, 6, z), new V3(-96.6, 7, z), .03, 0x9aa4ae)); L2.push(beamGeo(new V3(-96.6, 7, 62), new V3(-96.6, 7, 80.6), .035, 0xffcf2a)); L2.push(beamGeo(new V3(-96.6, 7, 80.6), new V3(-94.6, 7, 80.6), .035, 0xffcf2a));
      // pendant lamps
      for (let x = -92; x <= -70; x += 6) for (const z of [64, 76]) L2.push(beamGeo(new V3(x, 12.8, z), new V3(x, 11.2, z), .01, 0x222222, 4));
      addMerged(L2, vcD); }
    site.boxes.push({x0: -94.7, x1: -94.5, y0: 6, y1: 7.1, z0: 62, z1: 80.6}, {x0: -96.7, x1: -96.5, y0: 6, y1: 7.1, z0: 62, z1: 80.6}, {x0: -96.6, x1: -94.6, y0: 6, y1: 7.1, z0: 80.5, z1: 80.7});
    for (let x = -92; x <= -70; x += 6) for (const z of [64, 76]) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(.18, .45, .35, 20, 1, true), M.white); sh.material.side = THREE.DoubleSide; sh.position.set(x, 11.05, z); g.add(sh); const b = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 8), new THREE.MeshBasicMaterial({color: new THREE.Color(3, 2.7, 2.3)})); b.position.set(x, 10.95, z); g.add(b); }
    // observation desk facing the launch pads
    box(-67.2, D, 70, .9, .75, 14, 0xffffff, true, {m: M.table}); for (const z of [65, 70, 75]) { scrn(['tele', 'orbit', 'graph'][(z - 65) / 5], 1.3, -67.35, D + 1.05, z, .9, .5, -Math.PI / 2); }
    { const L3 = []; for (const z of [64, 67, 70, 73, 76]) { const x = -68.6; L3.push(boxGeo(x, D + .42, z, .52, .09, .55, 0x31363d), boxGeo(x - .3, D + .55, z, .08, .62, .52, 0x31363d), boxGeo(x, D + .1, z, .06, .33, .06, 0x8a9099), boxGeo(x, D + .06, z, .62, .04, .07, 0x8a9099), boxGeo(x, D + .06, z, .07, .04, .62, 0x8a9099)); }
      // telescope on a tripod in the north-east corner
      const tx = -68.6, tz = 60.2; for (const a of [0, 2.1, 4.2]) L3.push(beamGeo(new V3(tx + Math.cos(a) * .55, D, tz + Math.sin(a) * .55), new V3(tx, D + 1.3, tz), .03, 0x2b2f35));
      addMerged(L3, vcD); const tube = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, 1.5, 20), M.white); tube.position.set(tx + .2, D + 1.55, tz + .1); tube.rotation.set(0, 0, -1.0); tube.castShadow = true; g.add(tube); }
    // meeting table with chairs, a big hanging screen, and a globe of the planet (painted from the real terrain as it bakes)
    box(-84, D, 67, 6, .74, 2.2, 0xffffff, true, {m: M.table}); box(-84, D + .74, 67, 6.2, .04, 2.4, 0xffffff, false, {m: M.white});
    { const L4 = []; for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const x = -86.4 + i * 1.6, z = 67 + s * 1.55; L4.push(boxGeo(x, D + .42, z, .52, .09, .52, 0x31363d), boxGeo(x, D + .55, z + s * .28, .52, .6, .08, 0x31363d), boxGeo(x, D + .1, z, .06, .33, .06, 0x8a9099), boxGeo(x, D + .06, z, .6, .04, .07, 0x8a9099)); } addMerged(L4, vcD); }
    scrn('map', 1.5, -84, 9.6, 63.2, 6, 3); { const L5 = []; for (const x of [-86.8, -81.2]) L5.push(beamGeo(new V3(x, 11.1, 63.15), new V3(x, 12.8, 63.15), .02, 0x222222, 4)); addMerged(L5, vcD); }
    mapBuild(); MAPB.tex = new THREE.CanvasTexture(MAPB.c); MAPB.tex.colorSpace = THREE.SRGBColorSpace;
    { const gl = new THREE.Mesh(new THREE.SphereGeometry(.9, 48, 24), interiorMat(new THREE.MeshStandardMaterial({map: MAPB.tex, roughness: .45, metalness: .05}), INT_DECK)); gl.position.set(-75, D + 1.75, 69); gl.rotation.set(0, Math.PI / 2, 0); gl.castShadow = true; g.add(gl);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(.06, .35, .85, 16), M.table); st.position.set(-75, D + .43, 69); g.add(st); const rg = new THREE.Mesh(new THREE.TorusGeometry(1.0, .025, 6, 48, Math.PI), M.white); rg.position.set(-75, D + 1.75, 69); rg.rotation.z = Math.PI / 2; rg.rotation.y = Math.PI / 2; g.add(rg); }
    // lounge: rug, two sofas facing the south glass, coffee table, kitchenette, plants
    box(-83, D, 79, 9, .02, 4.6, 0xffffff, false, {m: M.rug, cast: false});
    for (const x of [-86, -80]) { box(x, D, 78.2, 2.4, .45, .9, 0xffffff, true, {m: M.sofa}); box(x, D, 77.65, 2.4, 1.0, .25, 0xffffff, false, {m: M.sofa}); for (const s of [-1, 1]) box(x + s * 1.1, D, 78.1, .2, .7, 1.0, 0xffffff, false, {m: M.sofa}); }
    box(-83, D, 80.2, 2.2, .4, .9, 0xffffff, true, {m: M.table});
    box(-87, D, 58.7, 7, .9, .7, 0xffffff, true, {m: M.table}); box(-87, D + .9, 58.7, 7.1, .04, .75, 0xffffff, false, {m: M.white}); box(-89.5, D + .94, 58.6, .4, .45, .35, 0x222222, false, {m: M.table});
    for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.045, .04, .1, 12), M.white); c.position.set(-88.4 + i * .25, D + .99, 58.75); g.add(c); }
    for (const [x, z] of [[-96.8, 58.8], [-66.9, 81.2], [-90, 81.2]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.3, .24, .6, 16), M.pot); p.position.set(x, D + .3, z); g.add(p); for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(new THREE.ConeGeometry(.16, 1.1, 6), M.plant); l.position.set(x + Math.cos(k) * .1, D + 1.05, z + Math.sin(k) * .1); l.rotation.set(Math.sin(k * 2) * .4, 0, Math.cos(k * 2) * .4); l.castShadow = true; g.add(l); } }
  }
  box(-82, 13, 70, 33, .8, 25, 0x3c4450, true);
  { const L = []; for (let x = -98; x <= -66; x += 3.2) { L.push(boxGeo(x, 6, 82.05, .25, 7, .25, 0x2b313a)); L.push(boxGeo(x, 6, 57.95, .25, 7, .25, 0x2b313a)); } for (let z = 58; z <= 82; z += 3) { L.push(boxGeo(-98.05, 6, z, .25, 7, .25, 0x2b313a)); L.push(boxGeo(-65.95, 6, z, .25, 7, .25, 0x2b313a)); }
    L.push(boxGeo(-82, 9.4, 82.1, 32.2, .25, .3, 0x2b313a)); L.push(boxGeo(-82, 9.4, 57.9, 32.2, .25, .3, 0x2b313a));
    // lattice antenna mast + dish
    const ax = -72, az = 64; for (let y = 13.8; y < 30; y += 2) { for (const [a, b2] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) L.push(beamGeo(new V3(ax + a[0] * .6, y, az + a[1] * .6), new V3(ax + b2[0] * .6, y + 2, az + b2[1] * .6), .05, 0xd8dde3, 4)); }
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L.push(beamGeo(new V3(ax + dx * .6, 13.8, az + dz * .6), new V3(ax + dx * .6, 30, az + dz * .6), .08, 0xd8dde3, 4));
    addMerged(L); }
  { const dish = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 12, 0, 6.283, 0, 1.0), new THREE.MeshStandardMaterial({color: 0xf4f6f8, roughness: .35, metalness: .2, side: THREE.DoubleSide})); dish.position.set(-88, 19, 66); dish.rotation.x = -.9; dish.castShadow = true; g.add(dish);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(.4, .6, 5, 12), mat(0xcfd6de, .5, .3)); st.position.set(-88, 16, 66); g.add(st); }
  decal(signTex(1024, 256, (x, w, h) => logo(x, w, h, 'MISSION CONTROL')), -85, 3.4, 81.23, 12, 3);

  // ---- LAUNCH PADS: hex pad, flame trench, red lattice tower with swing arms, water tower, fuel spheres
  site.pads = [];
  for (const [px, pz] of [[260, 40], [260, -70]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(18, 20, 3, 6), mat(0xffffff, .9, 0, 0, 'concrete', 6)); pad.position.set(px, 1.5, pz); pad.rotation.y = Math.PI / 6; pad.castShadow = pad.receiveShadow = true; g.add(pad);
    site.boxes.push({x0: px - 16, x1: px + 16, y0: 0, y1: 3, z0: pz - 16, z1: pz + 16});
    box(px, 2.9, pz, 9, .2, 9, 0x2b2b2b, false, {cast: false}); // flame hole
    box(px - 14, 2.95, pz, 10, .1, 4, 0x1a1a1a, false, {cast: false}); // trench
    const L = [], tx = px + 12, tz = pz, tw = 2.4, top = 32;
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L.push(beamGeo(new V3(tx + dx * tw, 3, tz + dz * tw), new V3(tx + dx * tw, top, tz + dz * tw), .22, 0xc2442e));
    for (let y = 3; y < top; y += 4) { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; for (let i = 0; i < 4; i++) { const a = c[i], b2 = c[(i + 1) % 4];
      L.push(beamGeo(new V3(tx + a[0] * tw, y, tz + a[1] * tw), new V3(tx + b2[0] * tw, y, tz + b2[1] * tw), .09, 0xc2442e, 4));
      L.push(beamGeo(new V3(tx + a[0] * tw, y, tz + a[1] * tw), new V3(tx + b2[0] * tw, y + 4, tz + b2[1] * tw), .07, 0xd25a40, 4)); } }
    for (let y = 11; y < top - 2; y += 10) { L.push(boxGeo(tx - tw - 3.5, y, tz, 7, .5, 1.6, 0x8a9198)); L.push(beamGeo(new V3(tx - tw, y + .5, tz - .8), new V3(tx - tw - 6.5, y + .5, tz - .8), .05, 0xffcf2a, 4)); L.push(beamGeo(new V3(tx - tw, y + 1.3, tz + .8), new V3(tx - tw - 6.5, y + 1.3, tz + .8), .05, 0xffcf2a, 4)); }
    L.push(beamGeo(new V3(tx, top, tz), new V3(tx, top + 12, tz), .12, 0xdddddd, 6)); // lightning mast
    L.push(boxGeo(tx, top, tz, tw * 2 + .6, .6, tw * 2 + .6, 0x8a9198));
    // water tower + fuel spheres
    const wx = px - 26, wz = pz + 22; for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) L.push(beamGeo(new V3(wx + dx * 1.6, 0, wz + dz * 1.6), new V3(wx + dx * .8, 18, wz + dz * .8), .2, 0xc4c9cf));
    addMerged(L);
    const wt = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 16), mat(0xd9dcdf, .55, .2)); wt.position.set(wx, 22, wz); wt.castShadow = true; g.add(wt);
    for (const [dx, dz, r] of [[-30, -22, 4], [-22, -26, 3.2]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat(0xd6d9dc, .5, .25)); sp.position.set(px + dx, r + 1.2, pz + dz); sp.castShadow = true; g.add(sp); }
    box(tx, 3, tz, tw * 2 + .4, 1, tw * 2 + .4, 0x6c737a, true); site.boxes.push({x0: tx - tw, x1: tx + tw, y0: 3, y1: top, z0: tz - tw, z1: tz + tw});
    site.pads.push(new V3(px, 3.4, pz));
  }
  // flag poles + a welcome sign
  for (let i = 0; i < 3; i++) { cyl(-10 + i * 6, 0, 52, .1, 12, 0xdddddd, false, 6); box(-10 + i * 6 + 1.6, 9.8, 52, 3, 2, .05, [0xffcf4a, 0x4aa8ff, 0xff6a4a][i], false); }
  box(0, 0, 70, 16, 4.4, .6, 0x2a3442, true, {r: .85}); decal(signTex(1024, 256, (x, w, h) => logo(x, w, h, 'SPACE CENTRE')), 0, 2.3, 70.31, 14, 3.5);
  // runway edge lights + threshold stripes
  { const L = []; for (let x = -550; x <= 950; x += 30) for (const dz of [-23.5, 23.5]) L.push(boxGeo(x, 0, 330 + dz, .4, .5, .4, 0xffffff));
    for (const x0 of [-545, 945]) for (let k = -8; k <= 8; k++) L.push(boxGeo(x0, .05, 330 + k * 2.4, 14, .02, 1.2, 0xeeeeee));
    addMerged(L, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .5, emissive: 0xfff0c0, emissiveIntensity: .25})); }
  // lights on poles around the apron (glow at night)
  for (let i = 0; i < 8; i++) { const x = -100 + i * 30; cyl(x, 0, 120, .15, 10, 0x999999, false, 6); box(x, 10, 120, 1, .3, 1, 0xfff1d0, false, {e: 0xfff1d0, cast: false}); }
  // trees around the site
  // two kinds (pines and broadleaf), in clumps and woods with clearings, each tree a slightly different size and green
  const tg = mergeGeos([boxGeo(0, 0, 0, .5, 3, .5, 0x0d0906), ...[[0, 3.4, 2.8], [2.4, 2.8, 2.2], [4.4, 2.2, 1.6]].map(([y, h2, r2]) => { const c = new THREE.ConeGeometry(r2 * 1.1, h2 * 1.6, 9).toNonIndexed(); c.translate(0, 2 + y + h2 * .8, 0); return tint(c, 0x070d05); })]); // colours here are linear (no colour management), so real foliage is this dark
  const bg = mergeGeos([boxGeo(0, 0, 0, .45, 3.6, .45, 0x0c0805), ...[[0, 5.4, 0, 2.6], [1.3, 4.6, .6, 1.9], [-1.1, 4.9, -.7, 2], [.2, 6.6, -.4, 1.8]].map(([x, y, z, r2]) => { const c = new THREE.IcosahedronGeometry(r2, 1).toNonIndexed(); c.scale(1, .82, 1); c.translate(x, y, z); return tint(c, 0x0b1105); })]);
  const tm = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .92}), NT = HI() ? 1500 : 700;
  const trs = [new THREE.InstancedMesh(tg, tm, NT), new THREE.InstancedMesh(bg, tm, NT)], kk = [0, 0], M4 = new THREE.Matrix4(), q = new Q4(), s = new V3(), p = new V3(), tc = new THREE.Color();
  let rs = 5; const r = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 30000 && (kk[0] < NT || kk[1] < NT); i++) { const a = r() * 6.283, d = 400 + Math.pow(r(), .8) * 2200, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(z - 330) < 70 && x > -640 && x < 1000) continue;
    const wood = noise3(x / 260, 0, z / 260, 77) + noise3(x / 70, 0, z / 70, 79) * .35; if (wood < .02 + r() * .25) continue; // clearings between the woods
    const t = noise3(x / 400, 3, z / 400, 81) + (r() - .5) * .5 > 0 ? 0 : 1; if (kk[t] >= NT) continue;
    const sz = (t ? .8 : .7) + r() * .8 + Math.max(0, wood) * .4; q.setFromAxisAngle(_Y, r() * 6.28); p.set(x, groundY(x, z) - .3, z); if (p.y < -6) continue;
    s.set(sz, sz * (.85 + r() * .4), sz); M4.compose(p, q, s); trs[t].setMatrixAt(kk[t], M4); const v = .75 + r() * .45; trs[t].setColorAt(kk[t]++, tc.setRGB(v * (1 + r() * .25), v, v * (.8 + r() * .15))); }
  for (let t = 0; t < 2; t++) { const tr = trs[t]; tr.count = kk[t]; tr.instanceMatrix.needsUpdate = true; if (tr.instanceColor) tr.instanceColor.needsUpdate = true; tr.castShadow = true; tr.receiveShadow = true; tr.computeBoundingSphere(); g.add(tr); } site.trees = trs; // world.js swaps these for its tiled forest
  site.H = {box, cyl, mat, mergeGeos, tint, beamGeo, boxGeo, addMerged, signTex, logo, decal, stripes, groundY, glass}; site.hangar = {HW, HD, HH, T, hx, hz}; // for world.js
}
const _sv = new V3(), _sq = new Q4();
// site coords <-> body-fixed
function siteToBody(v, out) { return out.copy(v).applyQuaternion(site.q).add(site.p); }
function bodyToSite(v, out) { return out.copy(v).sub(site.p).applyQuaternion(_sq.copy(site.q).invert()); }

// ---------------- player (walks in body-fixed coords of the body it stands on)
const P = {body: PLANET, pos: new V3(), vel: new V3(), fwd: new V3(), pitch: 0, ground: false, eye: 1.65};
function spawnPlayer() { siteToBody(new V3(0, 1, 46), P.pos); P.vel.set(0, 0, 0); const up = P.pos.clone().normalize(); P.fwd.set(0, 0, -1).applyQuaternion(site.q); P.fwd.addScaledVector(up, -P.fwd.dot(up)).normalize(); P.pitch = .12; }
const keys = {}; let look = {dx: 0, dy: 0};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space' && G.on) e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { look.dx += e.movementX; look.dy += e.movementY; } });
function lockPointer() { if (!G.on || (typeof MAPV !== "undefined" && MAPV.on) || document.pointerLockElement === canvas || !canvas.requestPointerLock) return; try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } // can fail right after Esc (browser cooldown): the next click tries again
canvas.addEventListener('click', lockPointer);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; }); // keys released while the tab was in the background no longer stick
const _up = new V3(), _rt = new V3(), _w = new V3(), _sp = new V3();
function stepPlayer(dt) {
  const b = P.body, up = _up.copy(P.pos).normalize();
  // look
  const sens = .0022 * (SET.sens || 1); if (look.dx) P.fwd.applyAxisAngle(up, -look.dx * sens); P.pitch = clamp(P.pitch - look.dy * sens * (SET.invY ? -1 : 1), -1.5, 1.5); look.dx = look.dy = 0;
  P.fwd.addScaledVector(up, -P.fwd.dot(up)).normalize(); const rt = _rt.crossVectors(P.fwd, up).normalize();
  // move
  const sp = keys.ShiftLeft || keys.ShiftRight ? 9 : 4.5; _w.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) _w.add(P.fwd); if (keys.KeyS || keys.ArrowDown) _w.sub(P.fwd); if (keys.KeyD || keys.ArrowRight) _w.add(rt); if (keys.KeyA || keys.ArrowLeft) _w.sub(rt);
  if (_w.lengthSq() > 0) _w.normalize().multiplyScalar(sp);
  const r = P.pos.length(), g = b.GM / (r * r), vUp = P.vel.dot(up);
  const tang = P.vel.clone().addScaledVector(up, -vUp), k = P.ground ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 1.2);
  tang.lerp(_w, k); P.vel.copy(tang).addScaledVector(up, vUp - g * dt);
  if (P.ground && keys.Space) { P.vel.addScaledVector(up, b !== PLANET ? 3.2 : 4.6); P.ground = false; }
  P.pos.addScaledVector(P.vel, dt);
  // terrain
  P.ground = false; const gr = groundR(b, P.pos), rr = P.pos.length();
  if (rr < gr) { P.pos.multiplyScalar(gr / rr); const vu = P.vel.dot(up); if (vu < 0) P.vel.addScaledVector(up, -vu); P.ground = true; }
  // site boxes
  if (b === PLANET && P.pos.distanceTo(site.p) < 2500) {
    const s = bodyToSite(P.pos, _sp), rad = .35;
    for (const bx of site.boxes) {
      if (s.x < bx.x0 - rad || s.x > bx.x1 + rad || s.z < bx.z0 - rad || s.z > bx.z1 + rad || s.y > bx.y1 || s.y + 1.8 < bx.y0) continue;
      if (s.y > bx.y1 - .55) { s.y = bx.y1; P.ground = true; const vu = P.vel.dot(up); if (vu < 0) P.vel.addScaledVector(up, -vu); continue; }
      const px = Math.min(s.x - (bx.x0 - rad), bx.x1 + rad - s.x), pz = Math.min(s.z - (bx.z0 - rad), bx.z1 + rad - s.z);
      if (px < pz) s.x = s.x - (bx.x0 - rad) < bx.x1 + rad - s.x ? bx.x0 - rad : bx.x1 + rad; else s.z = s.z - (bx.z0 - rad) < bx.z1 + rad - s.z ? bx.z0 - rad : bx.z1 + rad;
      if (s.y + 1.8 > bx.y0 && s.y < bx.y0 && P.vel.dot(up) > 0) { /* head bump */ }
    }
    siteToBody(s, P.pos);
  }
}
// camera pose (inertial): eye position and orientation
const _m = new THREE.Matrix4(), _f = new V3(), _q = new Q4();
function placeCamera() {
  const b = P.body, up = _up.copy(P.pos).normalize(), rt = _rt.crossVectors(P.fwd, up).normalize();
  const eyeB = _sp.copy(P.pos).addScaledVector(up, P.eye);
  G.O.copy(eyeB).applyQuaternion(b.q).add(b.c);
  // camera basis in body frame: x = right, y = up, z = -forward, then pitch about right
  _f.copy(P.fwd).negate(); _m.makeBasis(rt, up, _f); _q.setFromRotationMatrix(_m);
  cam.quaternion.copy(b.q).multiply(_q).multiply(new Q4().setFromAxisAngle(new V3(1, 0, 0), P.pitch));
  cam.position.set(0, 0, 0); cam.updateMatrixWorld();
}

// ---------------- light: sun colour through the air (CPU version of the shader's transmittance)
const _lp = new V3();
function sunColour(posRel) { // posRel = position relative to planet centre
  const R = PLANET.R, Ra = R + PLANET.atmo, b = posRel.dot(SUN), c = posRel.lengthSq() - Ra * Ra, h = b * b - c;
  const tr = [1, 1, 1]; if (h < 0) return tr; const t1 = -b + Math.sqrt(h); if (t1 <= 0) return tr;
  // ground shadow
  const cg = posRel.lengthSq() - (R - 3) ** 2, hg = b * b - cg; if (hg > 0 && -b - Math.sqrt(hg) > 0) return [0, 0, 0];
  let oR = 0, oM = 0; const n = 16, ds = t1 / n;
  let oO = 0; for (let i = 0; i < n; i++) { _lp.copy(posRel).addScaledVector(SUN, ds * (i + .5)); const hh = Math.max(0, _lp.length() - R); oR += Math.exp(-hh / HR) * ds; oM += Math.exp(-hh / HM) * ds; oO += Math.max(0, 1 - Math.abs(hh - OZ_C) / OZ_W) * ds; }
  return [Math.exp(-(BR.x * oR + BM * 1.1 * oM + BO.x * oO)), Math.exp(-(BR.y * oR + BM * 1.1 * oM + BO.y * oO)), Math.exp(-(BR.z * oR + BM * 1.1 * oM + BO.z * oO))];
}
const _rel = new V3();
function updateLight() {
  _rel.copy(G.O).sub(PLANET.c); const t = sunColour(_rel).map(v => Math.max(v, .002)); // never fully black: the moon divides by this to get full sunlight
  sunL.color.setRGB(t[0], t[1], t[2]); sunL.intensity = 3.4;
  for (const [L, d] of [[sunL, 600], [sunL2, 4500]]) { // snap each shadow camera to whole texels so shadows don't crawl as you move
    L.position.copy(SUN).multiplyScalar(d); L.target.position.set(0, 0, 0); L.target.updateMatrixWorld(); L.updateMatrixWorld();
    const sc = L.shadow.camera; sc.position.copy(L.position); sc.lookAt(L.target.position); sc.updateMatrixWorld(); const tx = (sc.right - sc.left) / L.shadow.mapSize.x, v = new V3(0, 0, 0).applyMatrix4(sc.matrixWorldInverse);
    const dx = v.x - Math.round(v.x / tx) * tx, dy = v.y - Math.round(v.y / tx) * tx; const right = new V3().setFromMatrixColumn(sc.matrixWorld, 0), upv = new V3().setFromMatrixColumn(sc.matrixWorld, 1);
    L.position.addScaledVector(right, dx).addScaledVector(upv, dy); L.target.position.addScaledVector(right, dx).addScaledVector(upv, dy); L.target.updateMatrixWorld(); }
  sunL2.color.copy(sunL.color);
  // sky light: brighter and bluer when the sun is up over us
  const up = _rel.clone().normalize(), el = up.dot(SUN), alt = Math.max(0, _rel.length() - PLANET.R);
  const day = sstep(-.12, .25, el) * (1 - sstep(PLANET.atmo * .4, PLANET.atmo, alt));
  amb.intensity = (alt > PLANET.atmo ? .004 : .05) + day * .9; amb.color.setRGB(lerp(.25, .55, day), lerp(.3, .72, day), lerp(.45, 1, day));
  amb.groundColor.setRGB(.16 * (.3 + day), .13 * (.3 + day), .1 * (.3 + day));
  // hemisphere "up" must follow the local vertical: three's hemisphere light uses its position as the sky direction
  amb.position.copy(up);
  // dusk on the ground stays dusky; space can open up for stars, except when the camera is looking at the sunlit ship from outside:
  // a black screen would push exposure up and blow the ship out to white (real cameras expose for the lit spacecraft)
  let em = lerp(3.5, 11, sstep(PLANET.atmo * .3, PLANET.atmo, alt)); const lit = Math.max(t[0], t[1], t[2]);
  if (typeof R !== 'undefined' && R.on && (C.view === 'out' || R.st === 'dead') && alt > PLANET.atmo * .5) em = lerp(em, 1.4, sstep(.05, .4, lit) * sstep(PLANET.atmo * .5, PLANET.atmo * 1.5, alt));
  G.emS = G.emS ? G.emS + (em - G.emS) * (1 - Math.exp(-(G.dt || .016) * 2)) : em; EMAX.value = G.emS;
  updateEnv(G.dt || 0, t); scene.environmentIntensity = alt > PLANET.atmo * 2 ? .15 : 1;
  scene.backgroundIntensity = lerp(1, .004, sstep(-.16, .08, el) * (1 - sstep(PLANET.atmo * .35, PLANET.atmo, alt))); // stars wash out in a daylight sky
  if (PLANET.cloudMeshes) for (const m of PLANET.cloudMeshes) m.visible = !HI(); // High uses the volumetric clouds
  if (PLANET.clouds) { const u = PLANET.clouds.uniforms; u.sun.value.copy(SUN); u.sunC.value.setRGB(1, 1, 1).multiplyScalar(3.4 * .85 / Math.PI * 1.6); u.sky.value.setRGB(.06, .09, .14).multiplyScalar(.2 + day * 2); u.t.value = G.t; }
  // wave clock: every scroll repeats after 1000 s, so it wraps seamlessly and keeps float precision after long time warps
  if (G.waterT) G.waterT.value = G.t % 1000; CLOUDU.sunB.value.copy(SUN).applyQuaternion(PLANET.q.clone().invert()); for (const sb of SATS) sb.mat.userData.mSun.value.copy(SUN).applyQuaternion(sb.q.clone().invert()); CLOUDU.cT.value = G.t; CLOUDU.cOn.value = HI() ? 1 : 0; CLOUDU.camT.value.set(t[0], t[1], t[2]); amb.intensity *= .25; compM.uniforms.sunCol.value.set(t[0], t[1], t[2]).multiplyScalar(.9);
}

// ---------------- HUD
const hint = $('hint');
function showHint(t, ms = 7000) { hint.textContent = t; hint.classList.remove('hidden'); hint.style.opacity = 1; clearTimeout(showHint.t); showHint.t = setTimeout(() => hint.style.opacity = 0, ms); }
function localTime() { // hours at the space centre: noon when the site faces the sun
  const s = SITE.clone().applyQuaternion(PLANET.q); const a = Math.atan2(s.z * SUN.x - s.x * SUN.z, s.x * SUN.x + s.z * SUN.z); // east of the sun is morning
  let h = 12 - a / Math.PI * 12; h = ((h % 24) + 24) % 24; return (h | 0) + ':' + String((h % 1) * 60 | 0).padStart(2, '0'); }
let hudT = 0;
function updateHud(dt) {
  if ((hudT -= dt) > 0) return; hudT = .2;
  const alt = P.pos.length() - P.body.R; const near = P.body === PLANET && P.pos.distanceTo(site.p) < 2000;
  $('hLoc').textContent = near ? 'Space Centre' : P.body.name;
  $('hInfo').textContent = 'Local time ' + localTime() + ' · Alt ' + alt.toFixed(0) + ' m';
}

// ---------------- main loop
G.O = new V3();
let last = 0, fps = 60;
function frame(ts) {
  requestAnimationFrame(frame);
  const rdt = Math.min(.05, Math.max(0, (ts - last) / 1000)); last = ts; fps = lerp(fps, 1 / Math.max(rdt, 1e-3), .05);
  const dt = G.paused ? 0 : rdt; G.dt = dt; // paused (Esc): the world freezes, the screen still draws
  G.t += dt * (G.on ? G.warp : 1);
  for (const b of BODIES) bodyState(b, G.t);
  if (G.on && !G.noGrav && !R.on) { const n = Math.ceil(dt / .02); for (let i = 0; i < n; i++) stepPlayer(dt / n); } // noGrav: test hook, freezes the player
  FLIGHT.step(dt); // rocket + debris (flight.js)
  if (R.on) FLIGHT.camera(dt); else placeCamera();
  for (const b of BODIES) { b.group.position.copy(b.c).sub(G.O); b.group.quaternion.copy(b.q); }
  FLIGHT.visuals(dt);
  if (G.skyBake) G.skyBake();
  updateTerrain(HI() ? 4 : 3); moonRocks();
  updateLight();
  if (G.on) { if (R.on) FLIGHT.hud(dt); else { FLIGHT.hideHud(); updateHud(dt); } }
  // adaptive resolution: drop a little when frames are slow, climb back when there is room
  if (G.on && !MAPV.on && (G.rsT = (G.rsT || 0) + dt) > 3) { G.rsT = 0; const rs = G.rs || 1; let n = rs, lite = !!G.lite;
    if (fps < 42) { if (SET.gfx === 'high' && !lite) lite = true; else if (rs > .8) n = Math.max(.8, rs - .1); } else if (fps > 57) { if (rs < 1) n = Math.min(1, rs + .1); else if (lite && SET.gfx === 'high') lite = false; } // blur last: drop SSAO / rays first, then at most 20% resolution
    if (n !== rs || lite !== !!G.lite) { G.rs = n; G.lite = lite; setupPost(); } }
  render(rdt);
}

// ---------------- Moon boulders: scattered rocks near the camera (stable: one per cell of a fixed grid on the cube faces, so they don't move as you walk)
const ROCK = {n: 1100, key: '', mesh: null, M4: new THREE.Matrix4(), q: new Q4(), sc: new V3(), p: new V3(), d: new V3(), a: new V3()};
function rockGeo() { const g = new THREE.IcosahedronGeometry(1, 2), pa = g.attributes.position, v = new V3(); // lumpy, flattened stone
  for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const k = .78 + .3 * noise3(v.x * 1.7 + 3, v.y * 1.7, v.z * 1.7, 91) + .1 * noise3(v.x * 4, v.y * 4, v.z * 4, 92); v.multiplyScalar(k); v.y = v.y * .62 + .12; pa.setXYZ(i, v.x, v.y, v.z); }
  // smooth normals: the icosahedron is unwelded, so average the face normals of vertices that share a spot
  const nm = new Map(), tri = [new V3(), new V3(), new V3()], fn = new V3(), e1 = new V3(), e2 = new V3(), keyOf = i => Math.round(pa.getX(i) * 1e4) + ',' + Math.round(pa.getY(i) * 1e4) + ',' + Math.round(pa.getZ(i) * 1e4);
  for (let i = 0; i < pa.count; i += 3) { for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pa, i + k); fn.crossVectors(e1.subVectors(tri[1], tri[0]), e2.subVectors(tri[2], tri[0]));
    for (let k = 0; k < 3; k++) { const key = keyOf(i + k), a = nm.get(key) || nm.set(key, new V3()).get(key); a.add(fn); } }
  const na = new Float32Array(pa.count * 3); for (let i = 0; i < pa.count; i++) { if (i % 3 === 0) { for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pa, i + k); fn.crossVectors(e1.subVectors(tri[1], tri[0]), e2.subVectors(tri[2], tri[0])).normalize(); } const n2 = nm.get(keyOf(i)).clone().normalize().addScaledVector(fn, .7).normalize(); na[i * 3] = n2.x; na[i * 3 + 1] = n2.y; na[i * 3 + 2] = n2.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(na, 3)); return g; }
function moonRocks() {
  let B = MOON, best = Infinity; for (const sb of SATS) { const a2 = G.O.distanceTo(sb.c) - sb.R; if (a2 < best) { best = a2; B = sb; } } // the nearest airless world
  const cpos = ROCK.a.copy(G.O).sub(B.c).applyQuaternion(_qi.copy(B.q).invert()), L = cpos.length(), alt = L - B.R;
  if (!ROCK.mesh) { ROCK.mesh = new THREE.InstancedMesh(rockGeo(), new THREE.MeshStandardMaterial({color: 0x3a3836, map: tex('rock', 'c'), normalMap: tex('rock', 'n'), normalScale: new THREE.Vector2(1.4, 1.4), roughness: 1, metalness: 0}), ROCK.n); ROCK.mesh.castShadow = ROCK.mesh.receiveShadow = true; ROCK.mesh.frustumCulled = false; ROCK.mesh.count = 0;
    ROCK.mesh.material.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = diffuse * dot(sampledDiffuseColor.rgb, vec3(.3, .55, .15)) * 1.6;'); }; } // moon rock is grey: drop the texture's moss
  ROCK.mesh.visible = alt < 2500; if (!ROCK.mesh.visible) return;
  if (ROCK.body !== B) { ROCK.body = B; B.group.add(ROCK.mesh); ROCK.key = ''; ROCK.mesh.material.color.setHex(B === RUST ? 0x8a5034 : B === FROST ? 0xa4adb8 : B === EMBER ? 0x2c2624 : B === PEBBLE ? 0x7c7268 : 0x8c8782); } // rock colour close to each world's ground: rocks read by shape and shadow, not as black blots
  const d = ROCK.d.copy(cpos).divideScalar(L), ax = Math.abs(d.x) >= Math.abs(d.y) && Math.abs(d.x) >= Math.abs(d.z) ? 0 : Math.abs(d.y) >= Math.abs(d.z) ? 1 : 2, comp = [d.x, d.y, d.z], dom = comp[ax], o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
  const s0 = comp[o1] / Math.abs(dom), t0 = comp[o2] / Math.abs(dom), cs = 6 / B.R, ci = Math.floor(s0 / cs), cj = Math.floor(t0 / cs), key = B.name + ax + (dom > 0 ? '+' : '-') + (ci >> 2) + ',' + (cj >> 2);
  if (key === ROCK.key) return; ROCK.key = key; // re-scatter when you move ~24 m
  const anchor = d.clone().multiplyScalar(B.R + heightAt(B, d.x, d.y, d.z)); ROCK.mesh.position.copy(anchor); // instance positions stay small (float precision)
  const ca = Math.cos(1200 / B.R); CR_NEAR = B.craters.filter(c => d.dot(c.d) > Math.cos(Math.acos(Math.min(1, ca)) + 2.3 * c.r / B.R));
  let n = 0; const W = 28, v = new V3();
  for (let j = -W; j <= W && n < ROCK.n; j++) for (let i = -W; i <= W && n < ROCK.n; i++) { const gi = (ci >> 2 << 2) + i, gj = (cj >> 2 << 2) + j, hs = hsh(gi, gj, ax * 2 + (dom > 0 ? 1 : 0), 31);
    const big = hs < .025, far = Math.abs(i) > 18 || Math.abs(j) > 18; if (!(hs < .5 || big) || (far && !big)) continue;
    const sv = (gi + hsh(gi, gj, 1, 32)) * cs, tv = (gj + hsh(gi, gj, 2, 33)) * cs; v.set(0, 0, 0); v.setComponent(ax, Math.sign(dom)); v.setComponent(o1, sv); v.setComponent(o2, tv); v.normalize();
    const sz = big ? 1 + hsh(gi, gj, 3, 34) * 2.2 : .07 + Math.pow(hsh(gi, gj, 3, 35), 4) * 1.1;
    ROCK.p.copy(v).multiplyScalar(B.R + heightAt(B, v.x, v.y, v.z) - sz * .25).sub(anchor);
    ROCK.q.setFromUnitVectors(_Yr, v).multiply(_qr.setFromAxisAngle(_Yr, hsh(gi, gj, 4, 36) * 6.28)); ROCK.sc.set(sz * (.8 + hsh(gi, gj, 5, 37) * .5), sz, sz * (.8 + hsh(gi, gj, 6, 38) * .5));
    ROCK.mesh.setMatrixAt(n++, ROCK.M4.compose(ROCK.p, ROCK.q, ROCK.sc)); }
  CR_NEAR = null; ROCK.mesh.count = n; ROCK.mesh.instanceMatrix.needsUpdate = true; }
const _Yr = new V3(0, 1, 0), _qr = new Q4();

// ---------------- boot
function boot() {
  for (const b of BODIES) { bodyState(b, 0); initBody(b); }
  buildSite(); spawnPlayer(); setupPost(); bakeSky();
  // pre-build the terrain around the space centre before showing the menu
  placeCamera(); for (const b of BODIES) { b.group.position.copy(b.c).sub(G.O); b.group.quaternion.copy(b.q); }
  const t0 = performance.now(); while (updateTerrain(50) > 0 && performance.now() - t0 < 6000);
  $('load').classList.add('hidden'); $('menu').classList.remove('hidden');
  $('name').value = SET.name || ''; $('name').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('play').click(); } };
  const segs = [...$('gfx').children]; markGfx();
  segs.forEach(b => b.onclick = () => setGfx(b.dataset.v));
  $('play').onclick = () => { SET.name = $('name').value.trim().slice(0, 14); saveSet(); $('menu').classList.add('hidden'); G.on = true;
    $('hud').classList.remove('hidden'); $('cross').classList.remove('hidden'); lockPointer();
    showHint('WASD walk · Shift run · Space jump · click to look · the rocket is on the pad to the east'); };
  addEventListener('resize', setupPost);
  requestAnimationFrame(frame);
}
const markGfx = () => document.querySelectorAll('#gfx button, [data-gfx] button').forEach(b => b.classList.toggle('on', b.dataset.v === SET.gfx)); // main menu + pause menu
function setGfx(v) { SET.gfx = v; saveSet(); G.lite = false; G.rs = 1; setupPost(); markGfx(); }
function placeAt(x, y, z, yaw, pitch) { siteToBody(new V3(x, y, z), P.pos); const up = P.pos.clone().normalize(); P.fwd.set(Math.sin(yaw), 0, -Math.cos(yaw)).applyQuaternion(site.q); P.fwd.addScaledVector(up, -P.fwd.dot(up)).normalize(); P.pitch = pitch || 0; P.vel.set(0, 0, 0); }
window.YE = {bench(n = 5) { const gl = RND.getContext(), px = new Uint8Array(4); render(.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) render(.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; }, cloudM, ssaoM, CLOUD3D, CL, WX, weatherM, prebuild: (ms = 20000) => { placeCamera(); for (const b of BODIES) { b.group.position.copy(b.c).sub(G.O); b.group.quaternion.copy(b.q); } const t0 = performance.now(); while (updateTerrain(200) > 0 && performance.now() - t0 < ms); }, placeAt, G, P, PLANET, MOON, site, TERR, heightAt, spawnPlayer, SET, setupPost, atmoM, POST, RND, SUN, cam, waterMat, terrMat, scene, compM, raysM};
// boot() is called at the end of flight.js
