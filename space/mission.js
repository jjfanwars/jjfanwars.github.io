'use strict';
// YeShip missions, map view (M) with trajectory prediction, re-entry plasma, Moon landing dust.
// Loaded after flight.js and shares its top-level names (R, STAGES, orbitEl, gravAt, moonPos, SOI_M, ...). Calls boot() at the end.

// ---------------- trajectory prediction (engine off from now; full gravity of Home + Moon on rails, no drag)
// Points are inertial. Each point also stores which body's frame it is drawn in: the body we orbit now, then the Moon after an
// encounter (drawn around a "ghost" Moon where it will be), then Home again after leaving the Moon.
const PN_MAX = 6000;
const PRED = {n: 0, p: new Float64Array(PN_MAX * 3), t: new Float64Array(PN_MAX), f: new Uint8Array(PN_MAX), anc: [0, 0], t0: -1, enc: null, exit: null, imp: null, air: null, close: null, moonPe: Infinity, homePe: Infinity, start: 0};
const _pp = new V3(), _pv = new V3(), _pa = new V3(), _pm = new V3();
function predict() {
  const P_ = PRED; P_.n = 0; P_.enc = P_.exit = P_.imp = P_.air = P_.close = null; P_.moonPe = P_.homePe = Infinity; P_.t0 = G.t;
  if (R.st !== 'fly') return;
  _pp.copy(R.pos); _pv.copy(R.vel); let t = G.t, f = domBody(_pp) === MOON ? 1 : 0; P_.start = f; P_.anc[f] = t; P_.anc[1 - f] = t;
  let sweep = 0, lx = 0, ly = 0, lz = 0, first = true, wasUp = _pp.length() - PLANET.R > PLANET.atmo;
  gravAt(_pp, t, _pa); const mPl = PLANET.GM, mMo = MOON.GM;
  for (let i = 0; i < PN_MAX; i++) {
    moonPos(t, _pm); const rp = _pp.length(), dmx = _pp.x - _pm.x, dmy = _pp.y - _pm.y, dmz = _pp.z - _pm.z, rm = Math.sqrt(dmx * dmx + dmy * dmy + dmz * dmz);
    const j = i * 3; P_.p[j] = _pp.x; P_.p[j + 1] = _pp.y; P_.p[j + 2] = _pp.z; P_.t[i] = t; P_.f[i] = f; P_.n = i + 1;
    // frame changes at the Moon's sphere of influence
    if (f === 0 && rm < SOI_M) { f = 1; P_.anc[1] = t; if (!P_.enc) P_.enc = {i, t}; sweep = 0; first = true; }
    else if (f === 1 && rm > SOI_M * 1.02) { f = 0; P_.anc[0] = t; if (!P_.exit) P_.exit = {i, t}; sweep = 0; first = true; }
    if (f === 1) P_.moonPe = Math.min(P_.moonPe, rm - MOON.R); else if (P_.start === 1 || P_.exit) P_.homePe = Math.min(P_.homePe, rp - PLANET.R);
    if (f === 0 && !P_.enc && (!P_.close || rm < P_.close.d)) P_.close = {d: rm, i, t};
    if (rp < PLANET.R + PLANET.atmo) { if (wasUp && !P_.air) P_.air = {i, t}; } else wasUp = true;
    if (rp < PLANET.R) { P_.imp = {i, t, b: PLANET}; break; }
    if (rm < MOON.R + 300) { P_.imp = {i, t, b: MOON}; break; }
    // one full turn around the frame body is enough
    const cx = f ? _pm.x : 0, cy = f ? _pm.y : 0, cz = f ? _pm.z : 0, rx = _pp.x - cx, ry = _pp.y - cy, rz = _pp.z - cz, rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (!first) sweep += Math.acos(clamp((rx * lx + ry * ly + rz * lz) / rl, -1, 1)); first = false; lx = rx / rl; ly = ry / rl; lz = rz / rl;
    if (sweep > 2 * Math.PI + .02 || t - G.t > 5 * 86400 || rp > 3.5e7) break;
    // leapfrog with a step that follows the local orbital time scale
    const h = clamp(.012 * Math.min(Math.sqrt(rp * rp * rp / mPl), Math.sqrt(rm * rm * rm / mMo)), .2, 900);
    _pv.addScaledVector(_pa, h / 2); _pp.addScaledVector(_pv, h); t += h; gravAt(_pp, t, _pa); _pv.addScaledVector(_pa, h / 2);
  }
}
// seconds of full-throttle burn on the current stage for a speed change dv
function burnTime(dv) { const S = STAGES[R.bot]; if (!S.thrust) return Infinity; const ve = S.ispV * G0, m = rocketMass(); return m * ve / S.thrust * (1 - Math.exp(-dv / ve)); }
// phase angle of the Moon ahead of us (degrees, 0..360 in the direction we orbit) and the one a direct transfer wants
function moonPhase() { const r = R.pos, v = R.vel, m = moonPos(G.t, new V3()), h = r.clone().cross(v).normalize(), ang = Math.atan2(r.clone().cross(m).dot(h), r.dot(m)) * 180 / Math.PI;
  const a = (r.length() + MOON.orbit) / 2, tt = Math.PI * Math.sqrt(a * a * a / PLANET.GM); return {now: (ang + 360) % 360, want: 186 - tt / MOON.period * 360}; }

// where to burn prograde in Moon orbit so you fall back to Home: the escape path has to leave against the Moon's motion
function homeWindow() { const mp = moonPos(G.t, new V3()), mv = moonVel(G.t, new V3()), r = R.pos.clone().sub(mp), v = R.vel.clone().sub(mv), h = r.clone().cross(v).normalize(), rl = r.length();
  const aT = (MOON.orbit + PLANET.R + 20000) / 2, vAp = Math.sqrt(PLANET.GM * (2 / MOON.orbit - 1 / aT)), vInf = mv.length() - vAp, e = 1 + rl * vInf * vInf / MOON.GM, thInf = Math.acos(-1 / e);
  const d = mv.clone().normalize().negate(); d.addScaledVector(h, -d.dot(h)).normalize(); const pb = d.applyAxisAngle(h, -thInf - HW_OFF), ang = Math.atan2(r.clone().cross(pb).dot(h), r.dot(pb)) * 180 / Math.PI;
  const o = orbitEl(MOON); return {deg: (ang + 360) % 360, t: ((ang + 360) % 360) / 360 * o.period}; }
let HW_OFF = 0;
// ---------------- map view: its own little scene (1 unit = 1 km), trajectory drawn on a 2D canvas on top
const MAPV = {on: false, focus: 0, dist: 3000, yaw: .6, pitch: .85, dx: 0, dy: 0, scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(45, 1, 1, 1e6), t: 0, fitted: false};
{ const s = MAPV.scene; s.background = new THREE.Color(0x01030a);
  // stars
  const n = 3000, sp = new Float32Array(n * 3), sc = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const d = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(4e5); sp.set([d.x, d.y, d.z], i * 3); const k = .25 + Math.random() ** 3 * .75; sc.set([k, k, k * (.9 + Math.random() * .2)], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  MAPV.stars = new THREE.Points(sg, new THREE.PointsMaterial({size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false})); s.add(MAPV.stars);
  const VSm = `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN, vW, vD; void main(){ vD = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`;
  const body = (atm) => new THREE.ShaderMaterial({uniforms: {map: {value: null}, has: {value: 0}, base: {value: new THREE.Color(.42, .42, .42)}, sun: {value: SUN}, atm: {value: atm}},
    vertexShader: VSm, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map; uniform float has, atm; uniform vec3 base, sun; varying vec3 vN, vW, vD;
void main(){
#include <logdepthbuf_fragment>
  vec3 d = normalize(vD); vec2 uv = vec2(atan(-d.z, d.x) / 6.2831853 + .5, asin(clamp(d.y, -1., 1.)) / 3.1415927 + .5);
  vec3 alb = has > .5 ? texture2D(map, uv).rgb : base; vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float l = dot(n, sun);
  vec3 col = alb * (max(l, 0.) * 1.15 + .05) + atm * vec3(.25, .5, 1.) * pow(1. - max(dot(n, v), 0.), 3.) * smoothstep(-.3, .3, l) * .8;
  gl_FragColor = vec4(col, 1.);
#include <colorspace_fragment>
}`});
  MAPV.pl = new THREE.Mesh(new THREE.SphereGeometry(PLANET.R / 1000, 96, 48), body(1)); s.add(MAPV.pl);
  MAPV.mo = new THREE.Mesh(new THREE.SphereGeometry(MOON.R / 1000, 64, 32), body(0)); s.add(MAPV.mo);
  MAPV.ghost = new THREE.Mesh(MAPV.mo.geometry, new THREE.MeshBasicMaterial({color: 0x5ad1ff, wireframe: true, transparent: true, opacity: .18, depthWrite: false})); s.add(MAPV.ghost);
  // air halo around Home
  MAPV.halo = new THREE.Mesh(new THREE.SphereGeometry((PLANET.R + PLANET.atmo * 1.6) / 1000, 96, 48), new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, uniforms: {sun: {value: SUN}},
    vertexShader: VSm, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sun; varying vec3 vN, vW, vD;
void main(){
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN), v = normalize(cameraPosition - vW); float r = 1. - abs(dot(n, v)); float a = pow(r, 6.) * 2.2 * smoothstep(-.4, .4, dot(-n, sun));
  gl_FragColor = vec4(vec3(.3, .6, 1.) * a, 1.); }`})); s.add(MAPV.halo);
  MAPV.plTex = null; MAPV.c = document.createElement('canvas'); MAPV.c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; $('mapUI').prepend(MAPV.c); MAPV.x = MAPV.c.getContext('2d');
}
function mapToggle(on) { MAPV.on = on ?? !MAPV.on; $('mapUI').classList.toggle('hidden', !MAPV.on); if (MAPV.on) { MAPV.fitted = false; MAPV.focus = 0; predict(); showHint('Map · drag to turn · wheel to zoom · Tab: change focus · M: back', 3500); } }
addEventListener('keydown', e => { if (!G.on || e.repeat) return; const k = e.code;
  // Esc / P: close the top overlay first, else pause or resume (Esc while the mouse is grabbed only frees it; that pauses too)
  if (k === 'Escape' || k === 'KeyP') { if (!$('test').classList.contains('hidden')) testMenu(false); else if (!$('misL').classList.contains('hidden')) misList(false); else if (k === 'Escape' && MAPV.on) mapToggle(false); else if (!(G.paused && performance.now() - G.pauseAt < 400)) setPause(!G.paused); return; } // (the same Esc may also have freed the mouse and paused)
  if (G.paused) return; if (k === 'KeyM') mapToggle(); if (k === 'Tab' && MAPV.on) { e.preventDefault(); MAPV.focus = (MAPV.focus + 1) % 3; MAPV.fitted = false; } if (k === 'KeyJ') misList(); });
addEventListener('mousemove', e => { if (!MAPV.on) return; if (document.pointerLockElement === canvas) { look.dx -= e.movementX; look.dy -= e.movementY; MAPV.dx += e.movementX; MAPV.dy += e.movementY; } else if (e.buttons) { MAPV.dx += e.movementX; MAPV.dy += e.movementY; } });
addEventListener('wheel', e => { if (!MAPV.on) return; e.preventDefault(); MAPV.dist = clamp(MAPV.dist * Math.exp(e.deltaY * .0015), 260, 60000); }, {passive: false});
const _mc = new V3(), _mq = new V3();
const toMap = (p, out) => out.copy(p).multiplyScalar(.001);
function mapFocus(out) { const f = MAPV.focus === 0 ? (R.st === 'fly' || R.on ? 'auto' : 'home') : MAPV.focus === 1 ? 'home' : 'moon';
  if (f === 'home') return out.set(0, 0, 0); if (f === 'moon') return toMap(MOON.c, out);
  return domBody(R.pos) === MOON ? toMap(MOON.c, out) : out.set(0, 0, 0); }
function drawPoint(i, out) { // predicted point i in map coordinates (frame of its segment)
  const P_ = PRED, j = i * 3; out.set(P_.p[j], P_.p[j + 1], P_.p[j + 2]); if (P_.f[i] === 1) { out.sub(moonPos(P_.t[i], _mq)).add(moonPos(P_.anc[1] === P_.t0 ? G.t : P_.anc[1], _mq)); } return out.multiplyScalar(.001); }
function mapRender(dt) {
  const M = MAPV, cv = M.c, W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio);
  if (cv.width !== (W * dpr | 0) || cv.height !== (H * dpr | 0)) { cv.width = W * dpr | 0; cv.height = H * dpr | 0; }
  if ((M.t -= dt) <= 0) { M.t = G.warp >= 100 ? 0 : .2; predict(); }
  // bodies
  M.pl.quaternion.copy(PLANET.q); toMap(MOON.c, M.mo.position); M.mo.quaternion.copy(MOON.q);
  if (!MAPB.c || MAPB.row < 128) mapBuild(); if (MAPB.c) { if (!M.plTex) { M.plTex = new THREE.CanvasTexture(MAPB.c); M.plTex.colorSpace = THREE.SRGBColorSpace; M.pl.material.uniforms.map.value = M.plTex; M.pl.material.uniforms.has.value = 1; } if (MAPB.row < 128) { mapBuild(); mapBuild(); M.plTex.needsUpdate = true; } }
  if (MI.ready && !M.mo.material.uniforms.has.value) { M.mo.material.uniforms.map.value = MI.mesh.material.uniforms.mC.value; M.mo.material.uniforms.has.value = 1; }
  M.ghost.visible = !!PRED.enc && PRED.start === 0; if (M.ghost.visible) toMap(moonPos(PRED.anc[1], _mq), M.ghost.position);
  // camera
  const fc = mapFocus(_mc);
  if (!M.fitted) { M.fitted = true; const b = MAPV.focus === 2 || (MAPV.focus === 0 && domBody(R.pos) === MOON) ? MOON : PLANET; let span = b.R * 3.2;
    if (R.st === 'fly' && domBody(R.pos) === b) { const o = orbitEl(b); span = Math.max(span, Math.min(o.ap === Infinity ? b.R * 8 : (o.ap + b.R) * 3.3, b === MOON ? SOI_M * 3 : MOON.orbit * 3)); } M.dist = span / 1000; }
  M.yaw -= M.dx * .004; M.pitch = clamp(M.pitch + M.dy * .004, -1.5, 1.5); M.dx = M.dy = 0;
  const cam2 = M.cam; cam2.aspect = W / H; cam2.near = Math.max(.5, M.dist * .002); cam2.far = M.dist * 50 + 1e5; cam2.updateProjectionMatrix();
  cam2.position.set(Math.cos(M.pitch) * Math.sin(M.yaw), Math.sin(M.pitch), Math.cos(M.pitch) * Math.cos(M.yaw)).multiplyScalar(M.dist).add(fc); cam2.lookAt(fc); cam2.updateMatrixWorld();
  M.stars.position.copy(cam2.position);
  RND.setRenderTarget(null); RND.render(M.scene, cam2);
  // overlay: Moon's path, predicted path, markers
  const x = M.x; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.lineJoin = 'round'; x.lineCap = 'round';
  const prj = (p, o = {}) => { _mq.copy(p).project(cam2); o.x = (_mq.x * .5 + .5) * W; o.y = (-_mq.y * .5 + .5) * H; o.ok = _mq.z < 1 && _mq.z > -1; return o; };
  const camP = cam2.position, hid = p => { // behind Home or the Moon (as seen from the map camera)?
    for (const [c, r] of [[_pz, PLANET.R / 1000], [M.mo.position, MOON.R / 1000]]) { const dx = p.x - camP.x, dy = p.y - camP.y, dz = p.z - camP.z, L = Math.sqrt(dx * dx + dy * dy + dz * dz), ux = dx / L, uy = dy / L, uz = dz / L;
      const ox = c.x - camP.x, oy = c.y - camP.y, oz = c.z - camP.z, tc = ox * ux + oy * uy + oz * uz; if (tc < 0 || tc > L) continue; const d2 = ox * ox + oy * oy + oz * oz - tc * tc; if (d2 < r * r && tc - Math.sqrt(r * r - d2) < L - .5) return true; } return false; };
  // the Moon's orbit
  x.strokeStyle = 'rgba(160,180,210,.22)'; x.lineWidth = 1; x.beginPath(); for (let i = 0; i <= 128; i++) { const q = prj(toMap(moonPos(i / 128 * MOON.period, _pm), _pa)); i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); } x.stroke();
  // Home's air line + Moon's sphere of influence (dashed rings), and a distance scale bar
  { const rgt = _mr.setFromMatrixColumn(cam2.matrixWorld, 0), pxR = (c3, r) => { const a = prj(c3), ax = a.x, ay = a.y, ok = a.ok, e = prj(_me.copy(c3).addScaledVector(rgt, r)); return ok ? {x: ax, y: ay, r: Math.hypot(e.x - ax, e.y - ay)} : null; };
    const ring = (c, col, txt) => { if (!c || c.r < 8 || c.r > 3 * Math.max(W, H)) return; x.save(); x.setLineDash([5, 6]); x.strokeStyle = col; x.lineWidth = 1.2; x.beginPath(); x.arc(c.x, c.y, c.r, 0, 7); x.stroke(); x.restore();
      if (txt && c.y - c.r > 30) { x.font = '600 11px Fredoka, sans-serif'; x.fillStyle = col; x.textAlign = 'center'; x.fillText(txt, c.x, c.y - c.r - 5); x.textAlign = 'left'; } };
    const pl = pxR(_pz, PLANET.R / 1000), air = pxR(_pz, (PLANET.R + PLANET.atmo) / 1000); if (pl && air && air.r - pl.r > 3) ring(air, 'rgba(120,190,255,.45)', air.r - pl.r > 14 ? 'Edge of the air' : '');
    ring(pxR(M.mo.position, SOI_M / 1000), 'rgba(90,209,255,.38)', "Moon's pull");
    const f1 = pxR(fc, 1); if (f1 && f1.r > 0) { const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]; let km = nice[0]; for (const n of nice) if (n * f1.r <= 150) km = n; const L = km * f1.r;
      if (L > 20) { const y0 = H - 22; x.strokeStyle = 'rgba(207,227,247,.75)'; x.lineWidth = 2; x.beginPath(); x.moveTo(16, y0 - 5); x.lineTo(16, y0); x.lineTo(16 + L, y0); x.lineTo(16 + L, y0 - 5); x.stroke();
        x.font = '600 12px Fredoka, sans-serif'; x.fillStyle = 'rgba(207,227,247,.9)'; x.fillText(km.toLocaleString('en') + ' km', 16, y0 - 9); } } }
  // predicted path: colour per segment, dim where hidden behind a body
  const P_ = PRED, cols = ['#c8f25a', '#5ad1ff'], pt = new V3(), q = {}; let prev = null, pf = -1, ph = null;
  for (let i = 0; i < P_.n; i++) { drawPoint(i, pt); prj(pt, q); const h = hid(pt), f = P_.exit && i >= P_.exit.i ? 2 : P_.f[i];
    if (prev && q.ok && (f !== pf || h !== ph)) { x.stroke(); prev = null; }
    if (!prev) { x.beginPath(); x.strokeStyle = f === 2 ? '#ffb347' : cols[f]; x.globalAlpha = h ? .22 : 1; x.lineWidth = h ? 1.5 : 2.6; x.moveTo(q.x, q.y); prev = true; pf = f; ph = h; } else if (q.ok) x.lineTo(q.x, q.y); }
  if (prev) x.stroke(); x.globalAlpha = 1;
  // labels
  const lab = (p3, txt, col, dot = true) => { const s = prj(p3); if (!s.ok) return; if (dot) { x.fillStyle = col; x.beginPath(); x.arc(s.x, s.y, 4, 0, 7); x.fill(); }
    x.font = '600 12px Fredoka, sans-serif'; const w = x.measureText(txt).width; x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(s.x - w / 2 - 6, s.y - 26, w + 12, 17); x.fillStyle = col; x.textAlign = 'center'; x.fillText(txt, s.x, s.y - 13.5); x.textAlign = 'left'; };
  lab(_pz, PLANET.name, '#9fb6cc', false); lab(M.mo.position, 'Moon', '#9fb6cc', false);
  if (R.st === 'fly') { const b = domBody(R.pos), o = orbitEl(b), rr = R.pos.clone().sub(b.c), vv = R.vel.clone(); if (b === MOON) vv.sub(moonVel(G.t, new V3()));
    const hv = rr.clone().cross(vv), ev = vv.clone().cross(hv).multiplyScalar(1 / b.GM).sub(rr.clone().normalize()), ed = ev.lengthSq() > 1e-12 ? ev.normalize() : rr.clone().normalize(), bc = toMap(b.c, new V3());
    if (o.ap !== Infinity && o.ap + b.R < (b === MOON ? SOI_M : 3e7) && o.e > .002) lab(ed.clone().multiplyScalar(-(o.ap + b.R) * .001).add(bc), 'Ap ' + fmtD(o.ap) + ' · ' + fmtS(o.tAp), '#7fd4ff');
    if (o.pe > -b.R * .95 && o.e > .002) lab(ed.clone().multiplyScalar((o.pe + b.R) * .001).add(bc), 'Pe ' + fmtD(o.pe) + (o.tPe < 1e7 ? ' · ' + fmtS(o.tPe) : ''), o.pe < (b === PLANET ? PLANET.atmo : 0) ? '#ff5a4a' : '#ffb347'); }
  if (P_.enc && P_.start === 0) lab(drawPoint(P_.enc.i, pt), 'Moon encounter · ' + fmtS(P_.enc.t - G.t), '#5ad1ff');
  if (P_.close && !P_.enc && P_.start === 0 && P_.close.d < MOON.orbit * .6) { lab(drawPoint(P_.close.i, pt), 'Closest to Moon ' + fmtD(P_.close.d - MOON.R), '#9fb6cc'); lab(toMap(moonPos(P_.close.t, _pm), new V3()), '', '#9fb6cc'); }
  if (P_.air) lab(drawPoint(P_.air.i, pt), 'Enters the air', '#ffcf4a');
  if (P_.imp) lab(drawPoint(P_.imp.i, pt), P_.imp.b === MOON ? 'Hits the Moon' : 'Hits the ground', '#ff5a4a');
  if (R.st === 'fly' || R.on) { const sp = prj(toMap(R.pos, pt)); if (sp.ok) { x.fillStyle = '#ffcf4a'; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.moveTo(sp.x, sp.y - 8); x.lineTo(sp.x + 6, sp.y + 6); x.lineTo(sp.x - 6, sp.y + 6); x.closePath(); x.stroke(); x.fill(); } }
  mapInfo(dt); $('act').classList.add('hidden');
}
const _pz = new V3(), _mr = new V3(), _me = new V3();
let mapInfoT = 0;
function mapInfo(dt) { if ((mapInfoT -= dt) > 0) return; mapInfoT = .25; const el = $('mapInfo'), L = [];
  const focus = ['Following your ship', 'Home', 'Moon'][MAPV.focus];
  if (R.st !== 'fly') L.push('<div class="h">' + (R.st === 'landed' && R.body === MOON ? 'Landed on the Moon' : R.st === 'pad' ? 'On the pad' : R.st === 'dead' ? 'Crashed' : 'Landed') + '</div>');
  else { const b = domBody(R.pos), o = orbitEl(b), inO = o.pe > (b === PLANET ? PLANET.atmo : 3000) && o.ap !== Infinity && (b === PLANET || o.ap + b.R < SOI_M);
    L.push('<div class="h">' + (inO ? 'Orbiting ' + (b === MOON ? 'the Moon' : PLANET.name) : o.ap === Infinity || (b === MOON && o.ap + b.R > SOI_M) ? 'Escaping ' + (b === MOON ? 'the Moon' : PLANET.name) : 'Falling back to ' + (b === MOON ? 'the Moon' : PLANET.name)) + '</div>');
    L.push('Ap <b>' + (o.ap === Infinity ? 'escape' : fmtD(o.ap)) + '</b> · Pe <b>' + fmtD(o.pe) + '</b>' + (inO ? ' · lap <b>' + fmtS(o.period) + '</b>' : ''));
    if (b === PLANET) { L.push('Tilt to the equator <b>' + Math.round(o.inc * 180 / Math.PI) + '°</b>');
      if (inO && !PRED.enc) { const ph = moonPhase(), d = ((ph.now - ph.want) % 360 + 360) % 360, good = d < 8 || d > 352; L.push('Moon is <b>' + Math.round(ph.now) + '°</b> ahead · go at <b>' + Math.round(ph.want) + '°</b>' + (good ? ' <span class="good">burn prograde now!</span>' : ' · in ' + fmtS(d / 360 * o.period / (1 - o.period / MOON.period)))); } }
    if (b === PLANET && inO && !PRED.enc && o.ap < 1e6) { const r = R.pos.length(), dv = Math.sqrt(PLANET.GM * (2 / r - 2 / (r + MOON.orbit))) - R.vel.length(); if (dv > 0) L.push('Moon burn ≈ <b>' + Math.round(dv) + ' m/s</b> · about <b>' + fmtS(burnTime(dv)) + '</b> at full throttle'); }
    if (b === MOON && !inO && o.tPe < 1e7 && o.pe > 0) { const rp = o.pe + MOON.R, vp = Math.sqrt(MOON.GM * (2 / rp - 1 / o.a)), dv = vp - Math.sqrt(MOON.GM / rp); L.push('Capture burn ≈ <b>' + Math.round(dv) + ' m/s</b> (' + fmtS(burnTime(dv)) + ') · start it about <b>' + fmtS(burnTime(dv) / 2) + '</b> before Pe'); }
    if (PRED.enc && PRED.start === 0) L.push('<span class="good">Moon encounter</span> in <b>' + fmtS(PRED.enc.t - G.t) + '</b> · passes <b>' + (PRED.moonPe < 0 ? 'into the surface' : fmtD(PRED.moonPe) + ' up') + '</b>');
    else if (PRED.close && PRED.start === 0 && PRED.close.d < MOON.orbit * .6) L.push('Misses the Moon by <b>' + fmtD(PRED.close.d - MOON.R) + '</b>');
    if ((PRED.start === 1 && PRED.exit) || (PRED.enc && PRED.exit)) L.push('Then back to Home: Pe <b>' + (PRED.homePe < 0 ? 'hits the ground' : fmtD(PRED.homePe)) + '</b>' + (PRED.homePe > 10000 && PRED.homePe < 20000 ? ' <span class="good">good re-entry</span>' : PRED.homePe > PLANET.atmo ? ' (misses the air)' : ''));
    if (PRED.start === 1 && !PRED.exit && !inO && !PRED.imp) L.push('Leaving soon? Keep burning to escape the Moon');
    if (b === MOON && inO && !PRED.exit) { const hw = homeWindow(), now = hw.deg < 4 || hw.deg > 356; L.push('Way home: ' + (now ? '<span class="good">burn prograde now!</span>' : 'burn prograde in <b>' + fmtS(hw.t) + '</b>') + ' · aim for Home Pe 10-20 km (gentler on the crew)'); }
  }
  L.push('<span style="font-size:12px">View: ' + focus + ' · Tab change · wheel zoom · M close</span>');
  const h = L.join('<br>'); if (el._h !== h) { el._h = h; el.innerHTML = h; } }
const _renderWorld = render;
render = function (dt) { if (MAPV.on && G.on) { mapRender(dt || .016); return; } _renderWorld(dt); }; // the map skips the whole world render (cheap while you plan)

// ---------------- missions
const MISD = [
  {id: 'hop', name: 'First hop', d: 'Launch and fly higher than 2 km.', steps: [
    ['Walk to the rocket on the pad (east of you) and press F', F => R.on || F.launched], ['Walk to the middle seat and press F to sit as Pilot', F => pilot() || F.launched],
    ['Press Space to launch', F => F.launched], ['Climb past 2 km', F => F.maxAlt > 2000]], done: F => F.maxAlt > 2000},
  {id: 'space', name: 'Touch space', d: 'Fly above the air (22 km).', steps: [
    ['Launch (Space). Press 4 to keep pointing straight up', F => F.launched], ['When the booster runs dry, Space drops it and lights the upper stage', F => F.staged || F.maxAlt > 22000], ['Climb past 22 km: the edge of space', F => F.space]], done: F => F.space},
  {id: 'home', name: 'Safe return', d: 'Go to space and land the capsule in one piece.', steps: [
    ['Reach space (above 22 km)', F => F.space], ['Press Space until only the capsule is left', F => R.bot === 2 || F.landSpace], ['Press Space once more to arm the parachute', F => R.chute > 0 || F.landSpace], ['Touch down (the chute opens by itself low down)', F => F.landSpace]], done: F => F.landSpace},
  {id: 'orbit', name: 'Orbit', d: 'Go fast enough sideways that you never fall back: lift your Pe above 22 km.', steps: [
    ['Launch, then press 5: the autopilot follows the blue guide marker east', F => F.launched], ['Watch Ap. Cut the engine (X) when Ap reaches about 80 km', F => F.ap70 || F.orbit],
    ['Press N to warp up to Ap (you coast there)', F => F.nearAp || F.orbit], ['At Ap: press 2 (prograde), Z for full throttle, burn until Pe is above 22 km', F => F.orbit]], done: F => F.orbit},
  {id: 'lap', name: 'Around the world', d: 'Make one full lap of Home in orbit.', steps: [
    ['Get into orbit (Pe above 22 km)', F => F.orbit], [F => 'Speed up time with the . key and go all the way round (' + Math.min(100, Math.round(F.sweep / (2 * Math.PI) * 100)) + '%)', F => F.sweep >= 2 * Math.PI]], done: F => F.sweep >= 2 * Math.PI},
  {id: 'down', name: 'Come home', d: 'From orbit, land safely back on Home.', steps: [
    ['Get into orbit', F => F.orbit], ['Press 3 (retrograde) and burn until Pe is under 10 km', F => F.deorbit || F.landOrbit], ['Drop the upper stage (Space), then arm the parachute (Space)', F => R.chute > 0 || F.landOrbit], ['Touch down', F => F.landOrbit]], done: F => F.landOrbit},
  {id: 'flyby', name: 'Moon flyby', d: 'Reach the Moon\'s pull (its sphere of influence).', steps: [
    ['Get into a low orbit (about 80 km)', F => F.orbit || F.moonSOI], ['Open the map (M). It shows how far ahead the Moon is: wait until it says "burn prograde now" (N warps, . speeds up time)', F => F.tli || F.moonSOI],
    ['Press 2 (prograde) and burn until the map shows a Moon encounter', F => F.encounter || F.moonSOI], ['Speed up time (. key) and coast to the Moon', F => F.moonSOI]], done: F => F.moonSOI},
  {id: 'moonorbit', name: 'Moon orbit', d: 'Get captured into an orbit around the Moon.', steps: [
    ['Reach the Moon (Moon flyby)', F => F.moonSOI], ['Press N to warp to your closest point (Pe)', F => F.nearMPe || F.moonOrbit], ['At Pe press 3 (retrograde) and burn until the map says "Orbiting the Moon"', F => F.moonOrbit]], done: F => F.moonOrbit},
  {id: 'moonland', name: 'Moon landing', d: 'Land on the Moon without breaking anything.', steps: [
    ['Orbit the Moon (or fly straight at it)', F => F.moonOrbit || F.moonLow], ['Press 3 (retrograde) and burn to drop toward the surface', F => F.moonLow || F.moonLanded], ['Watch the Ground readout. Burn hard when it says BURN NOW, keep 3 on', F => F.moonVeryLow || F.moonLanded], ['Touch down gently: under 5 m/s (legs come out by themselves)', F => F.moonLanded]], done: F => F.moonLanded},
  {id: 'moonwalk', name: 'Moonwalk', d: 'Step outside on the Moon.', steps: [
    ['Land on the Moon', F => F.moonLanded], ['Get up (F), walk to the hatch at the back and press F', F => F.moonWalk]], done: F => F.moonWalk},
  {id: 'back', name: 'There and back again', d: 'Land on the Moon, then fly home and land on Home.', steps: [
    ['Land on the Moon', F => F.moonLanded], ['Back in the Pilot seat: Z for full throttle, press 5 (guide). Cut (X) at Ap 20 km, N to warp there, burn prograde (2) into orbit', F => F.leftMoonGround || F.backHome],
    ['Open the map (M). Burn prograde until it says "Then back to Home: good re-entry"', F => F.goHome || F.backHome], ['Near Home: drop the upper stage and arm the parachute', F => (F.leftMoonGround && R.bot === 2 && R.chute > 0) || F.backHome], ['Land on Home', F => F.backHome]], done: F => F.backHome},
  {id: 'high', name: 'High flyer', d: 'Raise your Ap above 3,000 km.', bonus: true, steps: [['Get into orbit', F => F.orbit], ['Burn prograde until Ap is over 3,000 km', F => F.highAp]], done: F => F.highAp},
  {id: 'polar', name: 'Over the poles', d: 'Get into an orbit that goes over the poles (tilt over 70°).', bonus: true, steps: [
    ['With this mission picked, the guide (5) steers north instead of east', F => F.launched], ['Burn into orbit as usual', F => F.orbit], ['Tilt to the equator over 70° (see the map)', F => F.polar]], done: F => F.polar},
  {id: 'splash', name: 'Splashdown', d: 'Fly above 5 km and land in the sea.', bonus: true, steps: [['Fly above 5 km', F => F.maxAlt > 5000], ['Steer out over the sea (the map, M, shows where it is) and come down on the water', F => F.splash]], done: F => F.splash},
  {id: 'bull', name: 'Bullseye', d: 'Fly above 10 km and land within 2 km of the launch pad.', bonus: true, steps: [['Fly above 10 km (go nearly straight up: press 4)', F => F.maxAlt > 10000], ['Land within 2 km of the pad', F => F.bull]], done: F => F.bull},
];
const MIS = Object.assign({done: {}, cur: 'hop', mini: false}, (() => { try { return JSON.parse(localStorage.getItem('ye-mis') || '{}'); } catch (e) { return {}; } })());
const misSave = () => { try { localStorage.setItem('ye-mis', JSON.stringify(MIS)); } catch (e) {} };
const FLOG = {};
function newFlight() { for (const k in FLOG) delete FLOG[k]; Object.assign(FLOG, {t0: R.t0, test: !!R.test, launched: false, maxAlt: 0, sweep: 0, lastT: G.t}); }
newFlight();
let misT = 0, prevSt = 'pad', predT = 0;
function misPoll(dt) {
  if (!G.on) return; const F = FLOG;
  if ((R.st === 'pad' && F.launched) || (R.t0 && R.t0 !== F.t0)) { newFlight(); if (R.st === 'fly') F.launched = true; }
  if ((misT -= dt) > 0) return; misT = .2;
  if (R.st === 'fly' && (predT -= .2) <= 0 && !MAPV.on) { predT = .6; predict(); } // the HUD and missions want to know about encounters
  const b = domBody(R.pos), alt = R.pos.distanceTo(b.c) - b.R;
  if (R.st === 'fly') { F.launched = true; if (b === PLANET) { F.maxAlt = Math.max(F.maxAlt, alt); if (alt > PLANET.atmo) F.space = true; }
    if (R.bot > 0) F.staged = true; const o = orbitEl(b);
    if (b === PLANET) { if (o.ap > 70000) F.ap70 = true; if (o.tAp < 40 && alt > PLANET.atmo) F.nearAp = true;
      const inO = o.pe > PLANET.atmo && o.ap !== Infinity; if (inO) { F.orbit = true; F.sweep += (G.t - F.lastT) / o.period * 2 * Math.PI; if (o.inc > 70 * Math.PI / 180 && o.inc < 110 * Math.PI / 180) F.polar = true; }
      if (o.ap > 3e6) F.highAp = true; if (F.orbit && o.pe < 10000) F.deorbit = true;
      if (F.orbit && (o.ap > 4e6 || PRED.enc)) F.tli = true; if (PRED.enc) F.encounter = true;
      if (F.leftMoonGround && PRED.start === 0 && R.pos.length() > 4e6 && o.pe < 20000) F.goHome = true; }
    else { F.moonSOI = true; if (o.tPe < 60) F.nearMPe = true; if (o.pe > 3000 && o.ap !== Infinity && o.ap + MOON.R < SOI_M) F.moonOrbit = true; if (alt < 15000) F.moonLow = true; if (radarAlt() < 1500) F.moonVeryLow = true;
      if (F.moonLanded) { F.leftMoonGround = true; if (PRED.exit && PRED.homePe < 20000) F.goHome = true; } } }
  F.lastT = G.t;
  if (prevSt === 'fly' && R.st === 'landed') { const B = R.body; if (B === MOON) F.moonLanded = true;
    else { if (F.space) F.landSpace = true; if (F.orbit) F.landOrbit = true; if (F.moonLanded && F.leftMoonGround) F.backHome = true;
      const d = R.lp.clone().normalize(), h = heightAt(PLANET, d.x, d.y, d.z); if (h < -.5 && F.maxAlt > 5000) F.splash = true;
      if (F.maxAlt > 10000 && R.lp.distanceTo(site.p) < 2000) F.bull = true; } }
  if (!R.on && P.body === MOON && F.moonLanded) F.moonWalk = true;
  prevSt = R.st;
  GUIDE.head = MIS.cur === 'polar' ? 'north' : 'east';
  if (!F.test) for (const m of MISD) if (!MIS.done[m.id] && m.done(F)) misComplete(m); // test-menu jumps don't count
  misCard();
}
function misComplete(m) { MIS.done[m.id] = true; const was = MIS.cur === m.id; if (was) { const nx = MISD.find(x => !MIS.done[x.id]); if (nx) MIS.cur = nx.id; } misSave();
  const t = $('toast'), nx = MISD.find(x => x.id === MIS.cur && !MIS.done[x.id]); t.innerHTML = '<small>Mission complete</small><b>' + m.name + '</b>' + (was && nx ? '<span>Next: ' + nx.name + '</span>' : '');
  t.classList.add('on'); clearTimeout(misComplete.t); misComplete.t = setTimeout(() => t.classList.remove('on'), 5000); chime(); }
function chime() { const c = SND.c; if (!c) return; const t = c.currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(SND.out);
  g.gain.setValueAtTime(0, t + i * .11); g.gain.linearRampToValueAtTime(.16, t + i * .11 + .02); g.gain.exponentialRampToValueAtTime(.001, t + i * .11 + 1.1); o.start(t + i * .11); o.stop(t + i * .11 + 1.2); }); }
// a step ticked off: soft two-note blip, and the step flashes green for a moment
function stepTick() { const c = SND.c; if (!c || G.paused) return; const t = c.currentTime; [880, 1318.5].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t0 = t + i * .08; o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(SND.out);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.09, t0 + .01); g.gain.exponentialRampToValueAtTime(.001, t0 + .35); o.start(t0); o.stop(t0 + .4); }); }
const STEPS = {id: '', done: [], just: []};
function misCard() { const el = $('mis'), m = MISD.find(x => x.id === MIS.cur); if (!m) { el.classList.add('hidden'); return; } el.classList.remove('hidden');
  const dn = m.steps.map(([, ok]) => !!(MIS.done[m.id] || ok(FLOG))), nowMs = performance.now();
  if (STEPS.id !== m.id) { STEPS.id = m.id; STEPS.just = []; } else if (G.on && !FLOG.test) { let any = false; dn.forEach((d, i) => { if (d && !STEPS.done[i]) { STEPS.just[i] = nowMs + 1600; any = true; } }); if (any && !MIS.done[m.id]) stepTick(); }
  STEPS.done = dn;
  let now = -1; const items = m.steps.map(([t], i) => { const d = dn[i]; if (!d && now < 0) now = i; return '<li class="' + (d ? 'ok' + (STEPS.just[i] > nowMs ? ' just' : '') : now === i ? 'now' : '') + '">' + (typeof t === 'function' ? t(FLOG) : t) + '</li>'; });
  const n = Object.keys(MIS.done).filter(k => MISD.some(x => x.id === k)).length;
  const h = '<div class="mt"><b>' + m.name + (MIS.done[m.id] ? ' ✓' : '') + '</b><span>' + n + '/' + MISD.length + ' · J all missions</span></div><div class="md">' + (FLOG.test ? '<i>Test-menu flight: missions do not count.</i> ' : '') + m.d + '</div><ol>' + items.join('') + '</ol>';
  el.classList.toggle('mini', MIS.mini); if (el._h !== h) { el._h = h; el.innerHTML = h; } }
function misList(show) { const L = $('misL'); show = show ?? L.classList.contains('hidden'); L.classList.toggle('hidden', !show); if (!show) { lockPointer(); return; } if (document.pointerLockElement) document.exitPointerLock();
  const g = $('misG'); g.innerHTML = ''; for (const m of MISD) { const b = document.createElement('button'); b.className = (MIS.done[m.id] ? 'done ' : '') + (MIS.cur === m.id ? 'cur ' : '') + (m.bonus ? 'bonus' : ''); b.innerHTML = '<b>' + m.name + '</b><small>' + m.d + '</small>';
    b.onclick = e => { e.stopPropagation(); MIS.cur = m.id; misSave(); misCard(); misList(false); }; g.appendChild(b); }
  const hb = document.createElement('button'); hb.innerHTML = '<b>' + (MIS.mini ? 'Show' : 'Hide') + ' mission steps</b><small>Keep just the mission name on screen</small>'; hb.onclick = e => { e.stopPropagation(); MIS.mini = !MIS.mini; misSave(); misCard(); misList(false); }; g.appendChild(hb); }
$('misX').onclick = () => misList(false);

// ---------------- re-entry plasma: glowing bow shock in front, a hot wake behind, sparks, glowing heat shield
const HEAT = {g: new THREE.Group(), k: 0};
{ const core = new THREE.Mesh(PLUME_GEO, plumeMat([1, .82, .62], [1, .42, .16])), outer = new THREE.Mesh(PLUME_GEO, plumeMat([1, .5, .22], [.85, .18, .32]));
  core.frustumCulled = outer.frustumCulled = false; core.renderOrder = outer.renderOrder = 5; HEAT.core = core; HEAT.outer = outer;
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * .62), new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: {I: {value: 0}, t: {value: 0}}, vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN, vV; varying float vY; void main(){ vY = position.y; vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float I, t; varying vec3 vN, vV; varying float vY;
void main(){
#include <logdepthbuf_fragment>
  float f = 1. - abs(dot(normalize(vN), normalize(-vV))); float fl = .8 + .2 * sin(t * 53. + vY * 9.) * sin(t * 31. - vY * 5.);
  vec3 c = mix(vec3(1., .35, .12), vec3(1., .8, .55), smoothstep(.3, 1., vY)) * I * (pow(f, 2.) * 1.6 + .25) * fl * smoothstep(-.05, .35, vY);
  gl_FragColor = vec4(c, 1.); }`}));
  shock.frustumCulled = false; shock.renderOrder = 5; HEAT.shock = shock; HEAT.g.add(core, outer, shock); HEAT.g.visible = false; scene.add(HEAT.g); }
const _hv = new V3(), _hq = new Q4(), _hy = new V3(0, 1, 0);
function heatStep(dt) {
  let k = 0; if (R.st === 'fly' && R.p > 0) { groundVel(PLANET, R.pos, G.t, _hv); _hv.subVectors(R.vel, _hv); const vs = _hv.length(), rho = 1.225 * R.p; k = sstep(1.6e8, 1.4e9, Math.sqrt(rho) * vs * vs * vs); if (vs > 1) _hv.multiplyScalar(1 / vs); }
  HEAT.k = lerp(HEAT.k, k, 1 - Math.exp(-dt * 3)); const on = HEAT.k > .01; HEAT.g.visible = on; if (!on && HEAT.was) cabL.color.set(0xfff0dc); HEAT.was = on; RM.shield.emissive.setRGB(1, .3, .08); RM.shield.emissiveIntensity = HEAT.k * 2.2 * (R.bot === 2 ? 1 : .3);
  if (!on) return;
  const cap = R.bot === 2, rad = cap ? 2.9 : 1.7, top = 26.1 - R.comY, lead = cap ? 21.6 - R.comY : top; // the capsule flies heat shield first; a full stack nose first
  const nz = nose(new V3()), lp = R.pos.clone().addScaledVector(nz, lead).addScaledVector(_hv, cap ? .6 : .4);
  HEAT.g.position.copy(lp).sub(G.O); HEAT.g.quaternion.copy(_hq.setFromUnitVectors(_hy, _hv));
  const K = HEAT.k, tt = G.t % 50, cu = HEAT.core.material.uniforms, ou = HEAT.outer.material.uniforms;
  cu.r0.value = rad * .8; cu.sp.value = .3; cu.L.value = (cap ? 40 : 50) * (.5 + .5 * K); cu.I.value = 9 * K; cu.shock.value = 0; cu.t.value = tt;
  ou.r0.value = rad * 1.1; ou.sp.value = .9; ou.L.value = (cap ? 110 : 140) * (.4 + .6 * K); ou.I.value = 3.2 * K; ou.shock.value = 0; ou.t.value = tt;
  HEAT.shock.scale.set(rad * 1.25, rad * .55, rad * 1.25); HEAT.shock.position.y = -rad * .25; HEAT.shock.material.uniforms.I.value = 3.2 * K; HEAT.shock.material.uniforms.t.value = tt;
  if (R.F === 0) { flameL.position.copy(lp).sub(G.O); flameL.intensity = Math.max(flameL.intensity, K * 2500 * (.85 + .3 * Math.random())); flameL.color.setRGB(1, .5, .25); }
  // sparks peeling off the edge
  HEAT.acc = (HEAT.acc || 0) + dt * 90 * K * Math.min(1, G.warp); const sd = new V3();
  while (HEAT.acc > 1) { HEAT.acc--; sd.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).addScaledVector(_hv, -sd.dot(_hv)).normalize().multiplyScalar(rad);
    puff(lp.clone().add(sd), R.vel.clone().addScaledVector(_hv, -(40 + Math.random() * 90)).addScaledVector(sd, 3), {life: .35 + Math.random() * .5, s: .5 + Math.random() * .6, gr: 1.2, heat: 1, hk: .25, drag: 0, tone: .4}); }
  if (cap && C.in) cabL.color.setRGB(1, lerp(.94, .55, K), lerp(.86, .35, K)); }
// Moon dust: the engine blasts the regolith out sideways when close to the surface
let dustAcc = 0;
function dustStep(dt) {
  if (R.st !== 'fly' || R.F <= 0 || domBody(R.pos) !== MOON) { dustAcc = 0; return; } const ra = radarAlt(); if (ra > 40) return;
  const up = R.pos.clone().sub(MOON.c).normalize(), gp = R.pos.clone().addScaledVector(up, -(ra + R.comY - botY())), vg = groundVel(MOON, gp, G.t, new V3()), k = (1 - ra / 40) * R.thr;
  dustAcc += dt * 160 * k * Math.min(1, G.warp); const d = new V3();
  while (dustAcc > 1) { dustAcc--; d.set(Math.random() - .5, Math.random() - .5, Math.random() - .5); d.addScaledVector(up, -d.dot(up)).normalize();
    puff(gp.clone().addScaledVector(d, 1 + Math.random() * 2), vg.clone().addScaledVector(d, 14 + Math.random() * 26).addScaledVector(up, Math.random() * 3), {life: 1.6 + Math.random() * 1.6, s: 1.2, gr: 2.6, heat: 0, drag: 0, tone: .62}); } }

// ---------------- feel: vapour cone through the sound barrier, a little FOV kick under hard thrust in the chase view
let vapAcc = 0;
function vaporStep(dt) {
  const M = R.mach || 0, k = R.st === 'fly' ? sstep(.86, .97, M) * (1 - sstep(1.12, 1.3, M)) * sstep(.2, .45, R.p) : 0; if (k < .02) { vapAcc = 0; return; }
  const nz = nose(new V3()), d = new V3(); vapAcc += dt * 260 * k * Math.min(1, G.warp);
  while (vapAcc > 1) { vapAcc--; d.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).addScaledVector(nz, -d.dot(nz)).normalize(); const y = (R.bot === 2 ? 22.4 : 12 + Math.random() * 10) - R.comY;
    puff(R.pos.clone().addScaledVector(nz, y).addScaledVector(d, (R.bot === 2 ? 2.7 : 1.45) + Math.random() * .5), R.vel.clone().addScaledVector(d, 2), {life: .18 + Math.random() * .2, s: 1.6, gr: 3, heat: 0, drag: 3, tone: 1.15}); } }
function fovStep(dt) { let tg = 70; if (R.on && R.st === 'fly' && (C.view === 'out' || R.st === 'dead') && C.seat === 0) tg += 7 * clamp((R.felt.length() - 9) / 25, 0, 1) + 3 * clamp(R.qd / 25000, 0, 1);
  const f = lerp(cam.fov, tg, 1 - Math.exp(-dt * 2)); if (Math.abs(f - cam.fov) > .005) { cam.fov = f; cam.updateProjectionMatrix(); } }
// compile every shader we may need up front, so re-entry, the map or the far Moon don't stutter the first time they show
function warmShaders() { try {
  const tmp = [HEAT.g, MI.mesh]; for (const g of R.sg) { if (g.userData.plume) tmp.push(...g.userData.plume); if (g.userData.chute) tmp.push(g.userData.chute); }
  const was = tmp.map(o => o.visible); tmp.forEach(o => o.visible = true); RND.compile(scene, cam); tmp.forEach((o, i) => o.visible = was[i]);
  RND.compile(MAPV.scene, MAPV.cam); } catch (e) { console.warn('warm-up', e); } }
// ---------------- pause menu (Esc / P): time stops, sound stops, controls + graphics on one card
function setPause(on, relock = true) { on = !!on && G.on; if (!!G.paused === on) return; G.paused = on; $('pause').classList.toggle('hidden', !on); for (const k in keys) keys[k] = false;
  if (SND.c) { try { on ? SND.c.suspend() : SND.c.resume(); } catch (e) {} }
  if (on) { G.pauseAt = performance.now(); markGfx(); if (document.pointerLockElement) document.exitPointerLock(); }
  else if (relock) { lockPointer(); setTimeout(() => { if (G.on && !G.paused && !document.pointerLockElement && !MAPV.on) showHint('Click to look around', 2500); }, 400); } }
const overlayOpen = () => !$('misL').classList.contains('hidden') || !$('test').classList.contains('hidden');
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.on && !G.paused && !MAPV.on && !overlayOpen()) setPause(true); });
$('resume').onclick = () => setPause(false); $('pMis').onclick = () => { setPause(false, false); misList(true); };
document.querySelectorAll('#pause [data-gfx] button').forEach(b => b.onclick = () => setGfx(b.dataset.v)); window.YE.setPause = setPause;
// ---------------- hooks
{ const vis = FLIGHT.visuals;
  FLIGHT.visuals = dt => { if (!(R.F === 0 && HEAT.k > .01)) flameL.color.setRGB(1, .627, .29); vis(dt); heatStep(dt); dustStep(dt); vaporStep(dt); fovStep(dt); misPoll(dt); };
}
const _bootM = boot;
boot = function () { _bootM(); warmShaders(); const n = Object.keys(MIS.done).filter(k => MISD.some(x => x.id === k)).length; $('misSum').textContent = n ? 'Missions done: ' + n + ' of ' + MISD.length : 'New here? Follow the mission card (top right). J shows all missions.'; };
Object.assign(window.YE, {homeWindow, setHW: v => HW_OFF = v, PRED, predict, MAPV, mapToggle, MISD, MIS, FLOG, misPoll, HEAT, orbitEl, moonPhase});
// boot() is called at the end of polish.js
