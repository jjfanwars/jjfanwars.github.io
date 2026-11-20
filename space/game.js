'use strict';
// YeShip. Step 1: planet + moon (cube-sphere quadtree terrain), ray-marched atmosphere post pass, day/night, space centre, walking.
// Frames: "inertial" = world, planet centre at 0, sun fixed. Bodies rotate (planet about +Y). Body-fixed coords = inertial rotated back.
// Rendering uses a floating origin: the camera sits at 0 and everything is placed relative to O (the camera's inertial position).
const $ = id => document.getElementById(id);
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const SET = Object.assign({gfx: 'high', name: ''}, (() => { try { return JSON.parse(localStorage.getItem('ye-set') || '{}'); } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('ye-set', JSON.stringify(SET)); } catch (e) {} };
const HI = () => SET.gfx === 'high';
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
const PLANET = {name: 'Home', R: 60000, GM: 9.81 * 60000 * 60000, atmo: 18000, day: 3600, maxL: 12, seed: 11, water: true};
const MOON = {name: 'Moon', R: 20000, GM: 1.63 * 20000 * 20000, atmo: 0, maxL: 10, seed: 71, water: false, orbit: 400000};
MOON.period = 2 * Math.PI * Math.sqrt(MOON.orbit ** 3 / PLANET.GM);
const BODIES = [PLANET, MOON];
const SITE = new V3(1, 0, 0); // space centre direction (body-fixed), on the equator
const SITE_H = 20; // flattened ground height at the space centre
const G = {t: 0, warp: 1};
// time of day: start in the morning at the space centre
const T0 = -PLANET.day * .19;
function bodyState(b, t) { // centre (inertial) and rotation
  if (b === PLANET) { b.c = b.c || new V3(); b.c.set(0, 0, 0); b.q = b.q || new Q4(); b.q.setFromAxisAngle(new V3(0, 1, 0), 2 * Math.PI * (t + T0) / PLANET.day); return; }
  const a = 2 * Math.PI * t / MOON.period + 2.2, inc = .09;
  b.c = b.c || new V3(); b.c.set(Math.cos(a) * MOON.orbit, Math.sin(a) * Math.sin(inc) * MOON.orbit, -Math.sin(a) * Math.cos(inc) * MOON.orbit);
  b.q = b.q || new Q4(); b.q.setFromAxisAngle(new V3(0, 1, 0), a + Math.PI); // tidally locked
}

// ---------------- heights
const CRATERS = (() => { const out = []; let s = 7; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 140; i++) { const z = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - z * z); const big = i < 14;
    out.push({d: new V3(q * Math.cos(a), z, q * Math.sin(a)), r: big ? 2500 + r() * 4500 : 250 + r() * r() * 1800}); }
  return out; })();
function siteDist(x, y, z) { return Math.acos(clamp(x * SITE.x + y * SITE.y + z * SITE.z, -1, 1)) * PLANET.R; }
function heightAt(b, x, y, z) { // unit direction, body-fixed -> metres above sea level / datum
  if (b === PLANET) {
    const ox = 13.1, cont = fbm(x * 1.8 + ox, y * 1.8, z * 1.8, 5, 1);
    let h = cont * 5200 - 700;
    const m = ridged(x * 7, y * 7, z * 7, 5, 9); h += m * m * 3400 * sstep(-.05, .35, cont);
    h += fbm(x * 60, y * 60, z * 60, 3, 20) * 90 + fbm(x * 500, y * 500, z * 500, 3, 30) * 9 + noise3(x * 3000, y * 3000, z * 3000, 40) * 1.2;
    const sd = siteDist(x, y, z);
    if (sd < 11000) { const k = 1 - sstep(2200, 11000, sd); h = lerp(h, 30 + Math.max(0, h) * .25 + fbm(x * 90, y * 90, z * 90, 3, 50) * 60, k);
      h = lerp(h, SITE_H + sd * sd / (2 * PLANET.R), 1 - sstep(1500, 2300, sd)); } // flat plane (tangent to the planet) under the space centre
    return h;
  }
  let h = fbm(x * 3, y * 3, z * 3, 5, 3) * 600 + fbm(x * 40, y * 40, z * 40, 3, 6) * 40 + noise3(x * 900, y * 900, z * 900, 8) * 2;
  for (let i = 0; i < CRATERS.length; i++) { const c = CRATERS[i]; const dd = x * c.d.x + y * c.d.y + z * c.d.z; if (dd < .9) continue;
    const dist = Math.acos(Math.min(1, dd)) * MOON.R / c.r; if (dist > 1.6) continue;
    h += dist < 1 ? (dist * dist - 1) * c.r * .18 + c.r * .05 : c.r * .05 * Math.max(0, 1 - (dist - 1) / .6) ** 2; }
  return h;
}
// colour (linear rgb) for a vertex
const _c = {r: 0, g: 0, b: 0}, _wt = [0, 0, 0, 0]; // material weights: grass, sand, rock, snow
function lin(v) { return Math.pow(v, 2.2); }
function colorAt(b, x, y, z, h, slope) {
  let r, g, bl;
  if (b === PLANET) {
    const n = fbm(x * 220, y * 220, z * 220, 2, 60) * .5 + .5, lat = Math.abs(y);
    let sand = 0;
    if (h < -2) { r = .55; g = .5; bl = .38; sand = 1; } // sea floor
    else if (h < 4 + n * 10 && siteDist(x, y, z) > 2300) { r = .82; g = .74; bl = .52; sand = 1; } // beach
    else { const f = sstep(.25, .75, n); r = lerp(.4, .25, f); g = lerp(.48, .34, f); bl = lerp(.26, .18, f); } // grass / forest
    const rock = Math.max(sstep(.35, .6, slope), sstep(1800, 2600, h + n * 400));
    r = lerp(r, .42, rock); g = lerp(g, .39, rock); bl = lerp(bl, .36, rock);
    const snow = Math.max(sstep(2600, 3100, h + n * 500), sstep(.82, .9, lat + n * .05)) * (1 - sstep(.55, .75, slope));
    r = lerp(r, .95, snow); g = lerp(g, .96, snow); bl = lerp(bl, 1, snow);
    _wt[0] = (1 - sand) * (1 - rock) * (1 - snow); _wt[1] = sand * (1 - rock) * (1 - snow); _wt[2] = rock * (1 - snow); _wt[3] = snow;
  } else { _wt[0] = 0; _wt[1] = .35; _wt[2] = .65; _wt[3] = 0;
    const n = fbm(x * 30, y * 30, z * 30, 3, 90) * .5 + .5; const v = .42 + n * .18 - slope * .12;
    r = v; g = v * .98; bl = v * .95;
  }
  _c.r = lin(r); _c.g = lin(g); _c.b = lin(bl); return _c;
}

// ---------------- renderer
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance'});
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const FAR = 5e6;
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
sunL.shadow.mapSize.set(2048, 2048); const sc = sunL.shadow.camera; sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 1; sc.far = 1200; sunL.shadow.bias = -.0004; sunL.shadow.normalBias = .4;
const amb = new THREE.HemisphereLight(0x9ec8ff, 0x2a2418, .5); scene.add(amb);

// sky reflections: tiny sky-dome scene rendered into a PMREM environment map every few seconds
const envScene = new THREE.Scene(), envMat = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, uniforms: {top: {value: new THREE.Color()}, hor: {value: new THREE.Color()}, gnd: {value: new THREE.Color()}, sun: {value: new V3()}, sunC: {value: new THREE.Color()}},
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: 'uniform vec3 top, hor, gnd, sun, sunC; varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y > 0. ? mix(hor, top, pow(d.y, .45)) : mix(hor, gnd, pow(-d.y, .3)); c += sunC * pow(max(dot(d, sun), 0.), 64.) * 4.; gl_FragColor = vec4(c, 1.); }'});
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
let pmrem = null, envRT = null, envT = 0;
function updateEnv(dt, upW, day, sunCol) {
  if ((envT -= dt) > 0) return; envT = 2;
  pmrem = pmrem || new THREE.PMREMGenerator(RND);
  // sky dome in camera-up space: rotate so +y = local up
  const q = new Q4().setFromUnitVectors(upW, new V3(0, 1, 0)); envMat.uniforms.sun.value.copy(SUN).applyQuaternion(q);
  envMat.uniforms.top.value.setRGB(lerp(.004, .12, day), lerp(.006, .3, day), lerp(.02, .75, day));
  envMat.uniforms.hor.value.setRGB(lerp(.01, .55, day), lerp(.012, .65, day), lerp(.03, .8, day));
  envMat.uniforms.gnd.value.setRGB(lerp(.005, .16, day), lerp(.005, .15, day), lerp(.006, .12, day));
  envMat.uniforms.sunC.value.setRGB(sunCol[0], sunCol[1], sunCol[2]);
  const nrt = pmrem.fromScene(envScene, 0, .1, 100); if (envRT) envRT.dispose(); envRT = nrt;
  scene.environment = envRT.texture; scene.environmentRotation.setFromQuaternion(q.invert()); scene.environmentIntensity = .9;
}
// stars
(() => { const n = 5000, p = new Float32Array(n * 3), c = new Float32Array(n * 3); let s = 3; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) { const z = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - z * z), d = 3.5e6; p[i * 3] = q * Math.cos(a) * d; p[i * 3 + 1] = z * d; p[i * 3 + 2] = q * Math.sin(a) * d;
    const b = .3 + r() ** 6 * 2.2, t = r(); c[i * 3] = b * (t > .8 ? 1 : .85); c[i * 3 + 1] = b * .9; c[i * 3 + 2] = b * (t < .3 ? 1.2 : .9); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.PointsMaterial({size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false});
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = -1; scene.add(pts); G.stars = pts; })();

// ---------------- post: atmosphere (ray-marched single scattering) + bloom + tone map
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene(), fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsScene.add(fsQuad);
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const BR = new V3(5.8e-6, 13.5e-6, 33.1e-6).multiplyScalar(1.7), BM = 21e-6 * 1.2, HR = 2600, HM = 450;
const atmoM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, depthWrite: false,
  uniforms: {tCol: {value: null}, tDep: {value: null}, invProj: {value: new THREE.Matrix4()}, camRot: {value: new THREE.Matrix3()}, camPos: {value: new V3()}, sunDir: {value: SUN.clone()},
    R: {value: PLANET.R}, Ra: {value: PLANET.R + PLANET.atmo}, logC: {value: Math.log2(FAR + 1)}, bR: {value: BR}, bM: {value: BM}, hR: {value: HR}, hM: {value: HM}, sunI: {value: 24}, dbg: {value: 0}, steps: {value: 12}},
  fragmentShader: `uniform sampler2D tCol, tDep; uniform mat4 invProj; uniform mat3 camRot; uniform vec3 camPos, sunDir, bR; uniform float R, Ra, logC, bM, hR, hM, sunI, dbg; uniform int steps; varying vec2 vUv;
  vec2 rs(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r*r, h = b*b - c; if (h < 0.) return vec2(1e20, -1e20); h = sqrt(h); return vec2(-b - h, -b + h); }
  void main(){
    vec4 v = invProj * vec4(vUv * 2. - 1., -1., 1.); vec3 dv = normalize(v.xyz / v.w); vec3 d = normalize(camRot * dv);
    float dep = texture2D(tDep, vUv).x; float dist = dep >= .99999 ? 1e20 : (exp2(dep * logC) - 1.) / max(1e-4, -dv.z);
    vec3 col = texture2D(tCol, vUv).rgb; vec3 trans = vec3(1.);
    vec2 a = rs(camPos, d, Ra); float t0 = max(a.x, 0.), t1 = min(a.y, dist);
    vec2 gp = rs(camPos, d, R - 30.); if (dist > 1e19 && gp.x > 0. && gp.x < 1e19) { t1 = min(t1, gp.x); col = vec3(.02, .025, .02) * max(0., dot(normalize(camPos + d * gp.x), sunDir)); dist = gp.x; } // ground not built yet: dark stand-in, hides stars
    if (t1 > t0) {
      float ds = (t1 - t0) / float(steps), odR = 0., odM = 0.; vec3 sR = vec3(0.), sM = vec3(0.);
      for (int i = 0; i < 24; i++) { if (i >= steps) break;
        vec3 p = camPos + d * (t0 + ds * (float(i) + .5)); float hh = max(0., length(p) - R);
        float dR = exp(-hh / hR) * ds, dM = exp(-hh / hM) * ds; odR += dR; odM += dM;
        { vec2 sh = rs(p, sunDir, R - 60.); if (sh.x > 0. && sh.x < 1e19) continue; } // in the planet's shadow
        float lt = rs(p, sunDir, Ra).y / 4., lR = 0., lM = 0.;
        for (int j = 0; j < 4; j++) { vec3 q = p + sunDir * lt * (float(j) + .5); float h2 = max(0., length(q) - R); lR += exp(-h2 / hR) * lt; lM += exp(-h2 / hM) * lt; }
        vec3 at = exp(-(bR * (odR + lR) + bM * 1.1 * (odM + lM))); sR += at * dR; sM += at * dM; }
      float mu = dot(d, sunDir), g = .76;
      float pR = .0596831 * (1. + mu*mu), pM = .1193662 * ((1. - g*g) * (1. + mu*mu)) / ((2. + g*g) * pow(1. + g*g - 2.*g*mu, 1.5));
      trans = exp(-(bR * odR + bM * 1.1 * odM));
      col = col * trans + sunI * (sR * bR * pR + sM * bM * pM);
    }
    if (dist > 1e6) { float c = dot(d, sunDir); col += trans * (smoothstep(.99985, .99993, c) * 60. + pow(max(c, 0.), 600.) * 1.2); }
    if (dbg > .5) col = vec3(dep, fract(dep * 10.), dist < 1e19 ? fract(dist / 10.) : 0.);
    gl_FragColor = vec4(col, 1.); }`});
const brightM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}},
  fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(min(c * smoothstep(1.2, 4., l), vec3(40.)), 1.); }'});
const blurM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, d: {value: new THREE.Vector2()}},
  fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d*1.38).rgb + texture2D(t, vUv - d*1.38).rgb) * .316; c += (texture2D(t, vUv + d*3.23).rgb + texture2D(t, vUv - d*3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }'});
const compM = new THREE.ShaderMaterial({vertexShader: VS, depthTest: false, uniforms: {t: {value: null}, b: {value: null}, exp: {value: 1}},
  fragmentShader: `uniform sampler2D t, b; uniform float exp; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
  void main(){ vec3 c = texture2D(t, vUv).rgb + texture2D(b, vUv).rgb * .35; c = aces(c * exp); c = pow(c, vec3(1./2.2)); vec2 d = vUv - .5; c *= 1. - dot(d, d) * .35; gl_FragColor = vec4(c, 1.); }`});
const POST = {};
function setupPost() {
  const pr = Math.min(devicePixelRatio, HI() ? 1.5 : .75), w = Math.max(2, innerWidth * pr | 0), h = Math.max(2, innerHeight * pr | 0);
  RND.setPixelRatio(pr); RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  for (const k in POST) POST[k].dispose();
  POST.main = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: HI() ? 4 : 0, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType)});
  POST.sky = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, depthBuffer: false});
  const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
  POST.a = new THREE.WebGLRenderTarget(bw, bh, {type: THREE.HalfFloatType, depthBuffer: false}); POST.b = POST.a.clone();
  atmoM.uniforms.steps.value = HI() ? 14 : 8;
  RND.shadowMap.enabled = HI(); sunL.castShadow = HI();
}
function pass(m, rt) { fsQuad.material = m; RND.setRenderTarget(rt); RND.render(fsScene, fsCam); }
function render() {
  RND.setRenderTarget(POST.main); RND.render(scene, cam);
  const u = atmoM.uniforms; u.tCol.value = POST.main.texture; u.tDep.value = POST.main.depthTexture; u.invProj.value.copy(cam.projectionMatrixInverse);
  u.camRot.value.setFromMatrix4(cam.matrixWorld); u.camPos.value.copy(G.O).sub(PLANET.c); u.sunDir.value.copy(SUN);
  pass(atmoM, POST.sky);
  brightM.uniforms.t.value = POST.sky.texture; pass(brightM, POST.a);
  blurM.uniforms.t.value = POST.a.texture; blurM.uniforms.d.value.set(1 / POST.a.width, 0); pass(blurM, POST.b);
  blurM.uniforms.t.value = POST.b.texture; blurM.uniforms.d.value.set(0, 1 / POST.a.height); pass(blurM, POST.a);
  compM.uniforms.t.value = POST.sky.texture; compM.uniforms.b.value = POST.a.texture; pass(compM, null);
}

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
terrMat.onBeforeCompile = sh => {
  TMATS.forEach((m, i) => { sh.uniforms['tC' + i] = {value: tex(m, 'c')}; sh.uniforms['tN' + i] = {value: tex(m, 'n')}; sh.uniforms['aC' + i] = {get value() { return tex(m, 'c').userData.avg; }}; });
  sh.uniforms.hiQ = {get value() { return HI() ? 1 : 0; }};
  sh.vertexShader = 'attribute vec2 tuv; attribute vec4 mw; attribute float tax; varying vec2 vTu; varying vec4 vMw; varying vec3 vT, vB;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vTu = tuv; vMw = mw; vec3 tA = tax < .5 ? vec3(0., 0., 1.) : vec3(1., 0., 0.); vec3 bA = tax > .5 && tax < 1.5 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
    vT = normalize(normalMatrix * tA); vB = normalize(normalMatrix * bA);`);
  sh.fragmentShader = 'uniform sampler2D tC0, tC1, tC2, tC3, tN0, tN1, tN2, tN3; uniform vec3 aC0, aC1, aC2, aC3; uniform float hiQ; varying vec2 vTu; varying vec4 vMw; varying vec3 vT, vB;\n' +
    `vec3 tdet(sampler2D t, vec3 a){ vec3 c = texture2D(t, vTu).rgb * .65 + texture2D(t, vTu * .125).rgb * .35; float la = dot(a, vec3(.3, .55, .15)); return mix(vec3(dot(c, vec3(.3, .55, .15)) / la), c / a, .35); }\n` +
    sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float tFd = 1. - smoothstep(150., 1400., length(vViewPosition)); vec4 tW = vMw / max(1e-3, dot(vMw, vec4(1.)));
    if (tFd > 0.) { vec3 dt = tdet(tC0, aC0) * tW.x + tdet(tC1, aC1) * tW.y + tdet(tC2, aC2) * tW.z + tdet(tC3, aC3) * tW.w; diffuseColor.rgb *= mix(vec3(1.), dt, tFd * .9); }`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    if (hiQ > .5 && tFd > 0.) { vec3 nm = (texture2D(tN0, vTu).xyz * 2. - 1.) * tW.x + (texture2D(tN1, vTu).xyz * 2. - 1.) * tW.y + (texture2D(tN2, vTu).xyz * 2. - 1.) * tW.z + (texture2D(tN3, vTu).xyz * 2. - 1.) * tW.w;
      vec3 tT = normalize(vT - normal * dot(vT, normal)); vec3 tB = cross(normal, tT); tB *= sign(dot(tB, vB)); normal = normalize(tT * nm.x * tFd + tB * nm.y * tFd + normal * max(nm.z, .25)); }`);
};
const waterMat = new THREE.MeshStandardMaterial({color: 0x0d3a5c, roughness: .12, metalness: .05, transparent: true, opacity: .88});
function cubeDir(f, u, v, out) { const F = FACES[f]; let x = F[0] + F[3] * u + F[6] * v, y = F[1] + F[4] * u + F[7] * v, z = F[2] + F[5] * u + F[8] * v;
  // spherified cube for even cells
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out.x = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3); out.y = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3); out.z = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3); return out.normalize(); }
class Node {
  constructor(body, f, l, u, v, s) { this.b = body; this.f = f; this.l = l; this.u = u; this.v = v; this.s = s; this.kids = null; this.mesh = null;
    this.c = cubeDir(f, u + s / 2, v + s / 2, new V3()).multiplyScalar(body.R); this.size = body.R * s * 1.15; }
  build() {
    const b = this.b, R = b.R, M = NV + 2, H = new Float32Array(M * M), P = new Float32Array(M * M * 3), d = new V3();
    let hmin = 1e9;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      cubeDir(this.f, this.u + this.s * (i - 1) / N, this.v + this.s * (j - 1) / N, d); const h = heightAt(b, d.x, d.y, d.z), k = j * M + i;
      H[k] = h; const r = R + h; P[k * 3] = d.x * r; P[k * 3 + 1] = d.y * r; P[k * 3 + 2] = d.z * r; if (i > 0 && j > 0 && i <= NV && j <= NV) hmin = Math.min(hmin, h); }
    const nv = NV * NV + 4 * NV, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), cx = this.c.x, cy = this.c.y, cz = this.c.z;
    const tuv = new Float32Array(nv * 2), mw = new Float32Array(nv * 4), ac = this.c, ax = Math.abs(ac.x) >= Math.abs(ac.y) && Math.abs(ac.x) >= Math.abs(ac.z) ? 0 : Math.abs(ac.y) >= Math.abs(ac.z) ? 1 : 2;
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
      const o4 = (j * NV + i) * 4; mw[o4] = _wt[0]; mw[o4 + 1] = _wt[1]; mw[o4 + 2] = _wt[2]; mw[o4 + 3] = _wt[3]; setT((j * NV + i) * 2, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    }
    // skirts
    const drop = Math.max(2, this.size * .02), edges = [s => [s, 0], s => [s, N], s => [0, s], s => [N, s]];
    for (let e = 0; e < 4; e++) for (let s = 0; s < NV; s++) { const [i, j] = edges[e](s), src = (j * NV + i) * 3, o = (NV * NV + e * NV + s) * 3;
      const px = pos[src] + cx, py = pos[src + 1] + cy, pz = pos[src + 2] + cz, L = Math.hypot(px, py, pz), k2 = (L - drop) / L;
      pos[o] = px * k2 - cx; pos[o + 1] = py * k2 - cy; pos[o + 2] = pz * k2 - cz; for (let q = 0; q < 3; q++) { nrm[o + q] = nrm[src + q]; col[o + q] = col[src + q]; } const s4 = src / 3 * 4, o4 = o / 3 * 4; for (let q = 0; q < 4; q++) mw[o4 + q] = mw[s4 + q]; tuv[o / 3 * 2] = tuv[src / 3 * 2]; tuv[o / 3 * 2 + 1] = tuv[src / 3 * 2 + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tuv', new THREE.BufferAttribute(tuv, 2)); g.setAttribute('mw', new THREE.BufferAttribute(mw, 4)); g.setAttribute('tax', new THREE.BufferAttribute(new Float32Array(nv).fill(ax), 1));
    g.setIndex(terrIndex); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, terrMat); m.position.copy(this.c); m.receiveShadow = true; m.castShadow = this.l >= b.maxL - 3;
    if (b.water && hmin < 4) { // sea at radius R, 17x17 grid
      const W = 17, wp = new Float32Array(W * W * 3), wi = [];
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { cubeDir(this.f, this.u + this.s * i / (W - 1), this.v + this.s * j / (W - 1), d); const o = (j * W + i) * 3; wp[o] = d.x * R - cx; wp[o + 1] = d.y * R - cy; wp[o + 2] = d.z * R - cz; }
      for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; wi.push(a, a + 1, a + W + 1, a, a + W + 1, a + W); }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals(); wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, waterMat); wm.receiveShadow = true; m.add(wm); }
    this.mesh = m; m.visible = false; b.group.add(m); TERR.built++;
  }
  free() { if (this.kids) { for (const k of this.kids) k.free(); this.kids = null; }
    if (this.mesh) { this.b.group.remove(this.mesh); this.mesh.geometry.dispose(); for (const c of this.mesh.children) c.geometry.dispose(); this.mesh = null; } }
}
const TERR = {queue: [], built: 0};
function initBody(b) {
  b.group = new THREE.Group(); scene.add(b.group); b.roots = [];
  for (let f = 0; f < 6; f++) b.roots.push(new Node(b, f, 0, -1, -1, 2));
}
// walk the tree: show leaves that are ready, queue missing meshes (nearest first)
function updateTree(n, cp, want) {
  const dist = cp.distanceTo(n.c), split = n.l < n.b.maxL && dist < n.size * 1.7;
  // horizon cull: skip nodes well beyond the horizon
  const cl = cp.length(), R = n.b.R, hor = Math.sqrt(Math.max(0, cl * cl - R * R)) + Math.sqrt(Math.max(0, (R + 4000) ** 2 - R * R));
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
    x.font = `600 ${h * .5}px Fredoka, Arial Rounded MT Bold, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('YE', w / 2 - h * .52, h * .43); x.fillStyle = '#ffcf4a'; x.fillText('SHIP', w / 2 + h * .48, h * .43);
    if (sub) { x.font = `500 ${h * .1}px Fredoka, sans-serif`; x.fillStyle = '#9fb6cc'; x.fillText(sub, w / 2, h * .73); } }
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
  // inside: floor, assembly bay with hazard stripes, gantry crane, work towers, lights
  box(hx, .02, hz, HW - 2, .05, HD - 2, 0xc8ccd0, false, {t: 'plate', tile: 3, cast: false});
  box(hx + 6, 0, hz - 6, 14, .9, 14, 0x8d959e, true, {t: 'plate', tile: 2});
  for (const [x, z, w, d, ry] of [[6, .95, 14, .6, 0], [6, -12.95, 14, .6, 0]]) decal(stripes, hx + x, .9, hz + z, w, .6, ry, 10).rotation.x = -Math.PI / 2;
  { const L = [], cy = 30; for (const sx of [-1, 1]) { L.push(boxGeo(hx + sx * (HW / 2 - 2), cy, hz, .8, 1, HD - 4, 0x353d48)); for (let z = -HD / 2 + 4; z <= HD / 2 - 4; z += 8) L.push(boxGeo(hx + sx * (HW / 2 - 2), 0, hz + z, .7, cy, .7, 0x606a76)); }
    L.push(boxGeo(hx, cy + 1, hz - 6, HW - 3, 1.4, 1.6, 0xffcf2a)); L.push(boxGeo(hx + 6, cy - 1.6, hz - 6, 3, 1.6, 2.4, 0x353d48)); L.push(beamGeo(new V3(hx + 6, cy - 1.6, hz - 6), new V3(hx + 6, 14, hz - 6), .06, 0x222222, 4));
    // two work towers either side of the bay
    for (const sx of [-1, 1]) { const x0 = hx + 6 + sx * 10, z0 = hz - 6; for (let y = 0; y <= 24; y += 6) L.push(boxGeo(x0, y, z0, 4, .25, 6, 0x9aa4ae));
      for (const [dx, dz] of [[-2, -3], [2, -3], [-2, 3], [2, 3]]) L.push(beamGeo(new V3(x0 + dx, 0, z0 + dz), new V3(x0 + dx, 24.3, z0 + dz), .12, 0xffcf2a));
      for (let y = 0; y < 24; y += 6) { L.push(beamGeo(new V3(x0 - 2, y, z0 - 3), new V3(x0 - 2, y + 6, z0 + 3), .06, 0xd9a91e)); L.push(beamGeo(new V3(x0 + 2, y, z0 + 3), new V3(x0 + 2, y + 6, z0 - 3), .06, 0xd9a91e)); } }
    addMerged(L);
    for (const sx of [-1, 1]) site.boxes.push({x0: hx + 6 + sx * 10 - 2, x1: hx + 6 + sx * 10 + 2, y0: 0, y1: .3, z0: hz - 9, z1: hz - 3}); }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(hx - 15 + i * 10, 32.4, hz - 18 + j * 16, 4, .3, 1.2, 0xffffff, false, {e: 0xfff4e0, cast: false});
  // shelves of parts along the west wall (parts get stocked in step 3)
  { const L = []; for (let i = 0; i < 4; i++) { const z = hz - 18 + i * 10, x = hx - HW / 2 + 2.6; for (let y = 0; y <= 6; y += 2) L.push(boxGeo(x, y, z, 3, .15, 7.6, 0x3a6ea5));
      for (const dz of [-3.7, 3.7]) for (const dx of [-1.4, 1.4]) L.push(boxGeo(x + dx, 0, z + dz, .15, 6.3, .15, 0xff8a2a));
      for (let k = 0; k < 6; k++) { const y = 2 * (k % 3) + .15, dz = -2.6 + (k * 1.7) % 5.2; L.push(boxGeo(x, y, z + dz, 1.4, .9 + (k % 2) * .5, 1.4, [0xc9a46a, 0xd8d8d8, 0x6d8f5a, 0xb4573e][(i + k) % 4])); }
      site.boxes.push({x0: x - 1.5, x1: x + 1.5, y0: 0, y1: 6.3, z0: z - 3.8, z1: z + 3.8}); }
    addMerged(L, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7, metalness: .1})); }
  // builder console (step 3 opens the editor here)
  box(hx + 15, 0, hz + 14, 3, 1.1, 1.6, 0x2a3646, true, {r: .4, mt: .6}); { const sc = decal(signTex(512, 256, (x, w, h) => { x.fillStyle = '#071423'; x.fillRect(0, 0, w, h); x.strokeStyle = '#2a8cff'; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) x.strokeRect(30 + i * 40, 180 - i * 25, 30, 22 + i * 25); x.fillStyle = '#ffcf4a'; x.font = '600 36px Fredoka, sans-serif'; x.fillText('BUILD', 300, 80); x.font = '22px Fredoka, sans-serif'; x.fillStyle = '#9fd0ff'; x.fillText('ROCKET EDITOR', 300, 115); }), hx + 15, 1.95, hz + 14.3, 2.5, 1.25, 0);
    sc.material.emissive = new THREE.Color(1, 1, 1); sc.material.emissiveMap = sc.material.map; sc.material.emissiveIntensity = 1.4; sc.rotation.x = -.35; }

  // ---- MISSION CONTROL: concrete base, glass upper floor, roof antennas
  box(-82, 0, 70, 30, 6, 22, 0xe9e7e2, true, {r: .85});
  { const m = new THREE.Mesh(new THREE.BoxGeometry(32, 7, 24), glass); m.position.set(-82, 9.5, 70); m.castShadow = m.receiveShadow = true; g.add(m); site.boxes.push({x0: -98, x1: -66, y0: 6, y1: 13, z0: 58, z1: 82}); }
  box(-82, 13, 70, 33, .8, 25, 0x3c4450, true);
  { const L = []; for (let x = -98; x <= -66; x += 3.2) { L.push(boxGeo(x, 6, 82.05, .25, 7, .25, 0x2b313a)); L.push(boxGeo(x, 6, 57.95, .25, 7, .25, 0x2b313a)); } for (let z = 58; z <= 82; z += 3) { L.push(boxGeo(-98.05, 6, z, .25, 7, .25, 0x2b313a)); L.push(boxGeo(-65.95, 6, z, .25, 7, .25, 0x2b313a)); }
    L.push(boxGeo(-82, 9.4, 82.1, 32.2, .25, .3, 0x2b313a)); L.push(boxGeo(-82, 9.4, 57.9, 32.2, .25, .3, 0x2b313a));
    // lattice antenna mast + dish
    const ax = -72, az = 64; for (let y = 13.8; y < 30; y += 2) { for (const [a, b2] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) L.push(beamGeo(new V3(ax + a[0] * .6, y, az + a[1] * .6), new V3(ax + b2[0] * .6, y + 2, az + b2[1] * .6), .05, 0xd8dde3, 4)); }
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L.push(beamGeo(new V3(ax + dx * .6, 13.8, az + dz * .6), new V3(ax + dx * .6, 30, az + dz * .6), .08, 0xd8dde3, 4));
    addMerged(L); }
  { const dish = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 12, 0, 6.283, 0, 1.0), new THREE.MeshStandardMaterial({color: 0xf4f6f8, roughness: .35, metalness: .2, side: THREE.DoubleSide})); dish.position.set(-88, 19, 66); dish.rotation.x = -.9; dish.castShadow = true; g.add(dish);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(.4, .6, 5, 12), mat(0xcfd6de, .5, .3)); st.position.set(-88, 16, 66); g.add(st); }
  decal(signTex(1024, 256, (x, w, h) => logo(x, w, h, 'MISSION CONTROL')), -82, 3.6, 81.06, 14, 3.5);

  // ---- LAUNCH PADS: hex pad, flame trench, red lattice tower with swing arms, water tower, fuel spheres
  site.pads = [];
  for (const [px, pz] of [[260, 40], [260, -70]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(18, 20, 3, 6), mat(0xffffff, .9, 0, 0, 'concrete', 6)); pad.position.set(px, 1.5, pz); pad.rotation.y = Math.PI / 6; pad.castShadow = pad.receiveShadow = true; g.add(pad);
    site.boxes.push({x0: px - 16, x1: px + 16, y0: 0, y1: 3, z0: pz - 16, z1: pz + 16});
    box(px, 2.9, pz, 9, .2, 9, 0x2b2b2b, false, {cast: false}); // flame hole
    box(px - 14, 2.95, pz, 10, .1, 4, 0x1a1a1a, false, {cast: false}); // trench
    const L = [], tx = px + 12, tz = pz, tw = 2.4, top = 52;
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
    const wt = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 16), mat(0xf4f6f8, .45, .2)); wt.position.set(wx, 22, wz); wt.castShadow = true; g.add(wt);
    for (const [dx, dz, r] of [[-30, -22, 4], [-22, -26, 3.2]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat(0xffffff, .35, .3)); sp.position.set(px + dx, r + 1.2, pz + dz); sp.castShadow = true; g.add(sp); }
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
  const tg = mergeGeos([boxGeo(0, 0, 0, .5, 3, .5, 0x5a4030), ...[[0, 3.4, 2.8], [2.4, 2.8, 2.2], [4.4, 2.2, 1.6]].map(([y, h2, r2]) => { const c = new THREE.ConeGeometry(r2 * 1.1, h2 * 1.6, 9).toNonIndexed(); c.translate(0, 2 + y + h2 * .8, 0); return tint(c, 0x2f5f2c); })]);
  const tm = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .9}), tr = new THREE.InstancedMesh(tg, tm, 900), M4 = new THREE.Matrix4(), q = new Q4(), s = new V3(), p = new V3();
  let k = 0, rs = 5; const r = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 6000 && k < 900; i++) { const a = r() * 6.283, d = 420 + r() * 1300, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(z - 330) < 70 && x > -640 && x < 1000) continue; if (noise3(x / 120, 0, z / 120, 77) < .05) continue;
    const sz = .7 + r() * .9; q.setFromAxisAngle(_Y, r() * 6.28); p.set(x, groundY(x, z) - .3, z); if (p.y < -6) continue; s.set(sz, sz * (.85 + r() * .4), sz); M4.compose(p, q, s); tr.setMatrixAt(k++, M4); }
  tr.count = k; tr.instanceMatrix.needsUpdate = true; tr.castShadow = true; tr.receiveShadow = true; g.add(tr);
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
canvas.addEventListener('click', () => { if (G.on && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
const _up = new V3(), _rt = new V3(), _w = new V3(), _sp = new V3();
function stepPlayer(dt) {
  const b = P.body, up = _up.copy(P.pos).normalize();
  // look
  const sens = .0022; if (look.dx) P.fwd.applyAxisAngle(up, -look.dx * sens); P.pitch = clamp(P.pitch - look.dy * sens, -1.5, 1.5); look.dx = look.dy = 0;
  P.fwd.addScaledVector(up, -P.fwd.dot(up)).normalize(); const rt = _rt.crossVectors(P.fwd, up).normalize();
  // move
  const sp = keys.ShiftLeft || keys.ShiftRight ? 9 : 4.5; _w.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) _w.add(P.fwd); if (keys.KeyS || keys.ArrowDown) _w.sub(P.fwd); if (keys.KeyD || keys.ArrowRight) _w.add(rt); if (keys.KeyA || keys.ArrowLeft) _w.sub(rt);
  if (_w.lengthSq() > 0) _w.normalize().multiplyScalar(sp);
  const r = P.pos.length(), g = b.GM / (r * r), vUp = P.vel.dot(up);
  const tang = P.vel.clone().addScaledVector(up, -vUp), k = P.ground ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 1.2);
  tang.lerp(_w, k); P.vel.copy(tang).addScaledVector(up, vUp - g * dt);
  if (P.ground && keys.Space) { P.vel.addScaledVector(up, b === MOON ? 3.2 : 4.6); P.ground = false; }
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
  const cg = posRel.lengthSq() - (R - 60) ** 2, hg = b * b - cg; if (hg > 0 && -b - Math.sqrt(hg) > 0) return [0, 0, 0];
  let oR = 0, oM = 0; const n = 16, ds = t1 / n;
  for (let i = 0; i < n; i++) { _lp.copy(posRel).addScaledVector(SUN, ds * (i + .5)); const hh = Math.max(0, _lp.length() - R); oR += Math.exp(-hh / HR) * ds; oM += Math.exp(-hh / HM) * ds; }
  return [Math.exp(-(BR.x * oR + BM * 1.1 * oM)), Math.exp(-(BR.y * oR + BM * 1.1 * oM)), Math.exp(-(BR.z * oR + BM * 1.1 * oM))];
}
const _rel = new V3();
function updateLight() {
  _rel.copy(G.O).sub(PLANET.c); const t = sunColour(_rel);
  sunL.color.setRGB(t[0], t[1], t[2]); sunL.intensity = 3.4;
  sunL.position.copy(SUN).multiplyScalar(600); sunL.target.position.set(0, 0, 0); sunL.target.updateMatrixWorld();
  // sky light: brighter and bluer when the sun is up over us
  const up = _rel.clone().normalize(), el = up.dot(SUN), alt = Math.max(0, _rel.length() - PLANET.R);
  const day = sstep(-.12, .25, el) * (1 - sstep(PLANET.atmo * .4, PLANET.atmo, alt));
  amb.intensity = .06 + day * .9; amb.color.setRGB(lerp(.25, .55, day), lerp(.3, .72, day), lerp(.45, 1, day));
  amb.groundColor.setRGB(.16 * (.3 + day), .13 * (.3 + day), .1 * (.3 + day));
  // hemisphere "up" must follow the local vertical: three's hemisphere light uses its position as the sky direction
  amb.position.copy(up);
  compM.uniforms.exp.value = lerp(1.6, 1.0, day);
  updateEnv(G.dt || 0, up, day, t); amb.intensity *= .45;
  G.stars.material.color.setScalar(1 - sstep(-.1, .1, el) * (1 - sstep(PLANET.atmo * .5, PLANET.atmo * 1.2, alt))); G.stars.visible = G.stars.material.color.r > .02;
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
  let dt = Math.min(.05, Math.max(0, (ts - last) / 1000)); last = ts; G.dt = dt; fps = lerp(fps, 1 / Math.max(dt, 1e-3), .05);
  if (keys.BracketRight) G.warp = Math.min(500, G.warp * (1 + dt * 2)); if (keys.BracketLeft) G.warp = Math.max(1, G.warp / (1 + dt * 2)); // test day/night with [ ]
  G.t += dt * (G.on ? G.warp : 1);
  for (const b of BODIES) bodyState(b, G.t);
  if (G.on) { const n = Math.ceil(dt / .02); for (let i = 0; i < n; i++) stepPlayer(dt / n); }
  placeCamera();
  for (const b of BODIES) { b.group.position.copy(b.c).sub(G.O); b.group.quaternion.copy(b.q); }
  G.stars.position.set(0, 0, 0);
  updateTerrain(HI() ? 8 : 5);
  updateLight();
  if (G.on) updateHud(dt);
  render();
}

// ---------------- boot
function boot() {
  for (const b of BODIES) { bodyState(b, 0); initBody(b); }
  buildSite(); spawnPlayer(); setupPost();
  // pre-build the terrain around the space centre before showing the menu
  placeCamera(); for (const b of BODIES) { b.group.position.copy(b.c).sub(G.O); b.group.quaternion.copy(b.q); }
  const t0 = performance.now(); while (updateTerrain(50) > 0 && performance.now() - t0 < 6000);
  $('load').classList.add('hidden'); $('menu').classList.remove('hidden');
  $('name').value = SET.name || '';
  const segs = [...$('gfx').children]; const mark = () => segs.forEach(b => b.classList.toggle('on', b.dataset.v === SET.gfx)); mark();
  segs.forEach(b => b.onclick = () => { SET.gfx = b.dataset.v; saveSet(); mark(); setupPost(); });
  $('play').onclick = () => { SET.name = $('name').value.trim().slice(0, 14); saveSet(); $('menu').classList.add('hidden'); G.on = true;
    $('hud').classList.remove('hidden'); $('cross').classList.remove('hidden'); canvas.requestPointerLock && canvas.requestPointerLock();
    showHint('WASD walk · Shift run · Space jump · click to look around · [ ] speed up time'); };
  addEventListener('resize', setupPost);
  requestAnimationFrame(frame);
}
function placeAt(x, y, z, yaw, pitch) { siteToBody(new V3(x, y, z), P.pos); const up = P.pos.clone().normalize(); P.fwd.set(Math.sin(yaw), 0, -Math.cos(yaw)).applyQuaternion(site.q); P.fwd.addScaledVector(up, -P.fwd.dot(up)).normalize(); P.pitch = pitch || 0; P.vel.set(0, 0, 0); }
window.YE = {placeAt, G, P, PLANET, MOON, site, TERR, heightAt, spawnPlayer, SET, setupPost, atmoM, POST, RND};
boot();
