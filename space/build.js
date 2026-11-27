'use strict';
// Lucas Space Program rocket builder (KSP-style hangar editor, 25 Nov 2026). Parts + layout live in flight.js (PARTS, shipLayout, shipApply, partMeshes).
// B (not while flying), the main menu or the pause card opens it. Own small WebGL renderer for the preview; the world is not drawn while it is open.
// Loaded after extras.js, before polish.js (which calls boot()).

const BLD = {on: false, parts: [], paint: {...PAINT0}, sideN: 2, name: '', sel: -1, ss: -1, held: null, hist: [], yaw: .7, pitch: .25, dist: 60, tdist: 60, cy: 12, tcy: 12, drag: null};
const SHIPS_K = 'ye-ships';
const shipsSaved = () => { try { return JSON.parse(localStorage.getItem(SHIPS_K) || '{}') || {}; } catch (e) { return {}; } };
const DV_NEED = [['Orbit', 2900], ['Moon flyby', 3800], ['Moon orbit', 4100], ['Moon landing', 4800], ['There and back', 6500]];

// ---------------- preview renderer
function bldInit() {
  if (BLD.rnd) return; const cv = $('bldC');
  const r = BLD.rnd = new THREE.WebGLRenderer({canvas: cv, antialias: true}); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const s = BLD.scene = new THREE.Scene(); s.background = new THREE.Color(0x0d1420); s.fog = new THREE.Fog(0x0d1420, 140, 420);
  BLD.cam = new THREE.PerspectiveCamera(40, 1, .1, 1000);
  s.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2622, .9 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.6 * Math.PI); sun.position.set(30, 60, 40); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200}); s.add(sun, sun.target); BLD.sun = sun;
  const fill = new THREE.DirectionalLight(0x9fc4ff, .5 * Math.PI); fill.position.set(-40, 20, -30); s.add(fill);
  // hangar floor: concrete with painted grid + a launch-mount ring
  const fc = document.createElement('canvas'); fc.width = fc.height = 512; const x = fc.getContext('2d'); x.fillStyle = '#3a3d42'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) { x.fillStyle = 'rgba(' + (Math.random() > .5 ? '255,255,255' : '0,0,0') + ',' + Math.random() * .05 + ')'; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  x.strokeStyle = 'rgba(255,207,74,.35)'; x.lineWidth = 3; x.strokeRect(0, 0, 512, 512);
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(24, 24);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(220, 64), new THREE.MeshStandardMaterial({map: ft, roughness: .85})); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor); BLD.floor = floor;
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 64), new THREE.MeshBasicMaterial({color: 0xffcf4a})); ring.rotation.x = -Math.PI / 2; ring.position.y = .02; s.add(ring); BLD.ringM = ring;
  BLD.hl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), new THREE.MeshBasicMaterial({color: 0xffcf4a, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending}));
  BLD.hl.renderOrder = 3; s.add(BLD.hl);
  BLD.ray = new THREE.Raycaster();
  BLD.hls = [BLD.hl]; for (let k = 0; k < 3; k++) { const h = new THREE.Mesh(BLD.hl.geometry, BLD.hl.material); h.renderOrder = 3; h.visible = false; s.add(h); BLD.hls.push(h); }
  BLD.ghost = new THREE.Group(); s.add(BLD.ghost); BLD.nodeG = new THREE.Group(); s.add(BLD.nodeG);
  BLD.nodeM = new THREE.MeshBasicMaterial({color: 0x1fa64a, transparent: true, opacity: .85, depthTest: false}); BLD.nodeM2 = new THREE.MeshBasicMaterial({color: 0xD8342A, depthTest: false}); BLD.nodeGeo = new THREE.SphereGeometry(1, 16, 12);
  // drag on empty space turns the camera; drag on a part picks it up; a click selects (or places the part you hold)
  cv.addEventListener('pointerdown', e => { if (e.button === 2 && BLD.held) { bldCancel(); return; } BLD.drag = {x: e.clientX, y: e.clientY, moved: 0, hit: BLD.held ? null : bldHit(e)}; try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
  cv.addEventListener('pointermove', e => { const d = BLD.drag; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.hit && !BLD.held && d.moved > 7 && !(e.buttons & 2) && !e.shiftKey) { if (d.hit.i >= 0) { bldGrab(d.hit); BLD.press = {moved: 99}; } d.hit = null; }
    if (BLD.held && BLD.press) return;
    if (e.buttons & 2 || e.shiftKey) BLD.tcy = clamp(BLD.tcy + dy * BLD.dist * .002, BLD.lo, BLD.hi); else { BLD.yaw -= dx * .008; BLD.pitch = clamp(BLD.pitch + dy * .006, -.2, 1.35); } });
  addEventListener('pointermove', e => { if (!BLD.on || !BLD.held) return; if (BLD.press) BLD.press.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); BLD.hov = e; }); // handled once per frame in bldRender
  addEventListener('pointerup', e => { if (!BLD.on) return; const d = BLD.drag, pr = BLD.press; BLD.drag = null; BLD.press = null;
    const b = cv.getBoundingClientRect(), inCv = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
    if (BLD.held) { const pb = $('bldParts').getBoundingClientRect(), inCat = e.clientX >= pb.left && e.clientX <= pb.right && e.clientY >= pb.top && e.clientY <= pb.bottom;
      if (pr && pr.moved > 7) { if (inCv) { bldHover(e); if (BLD.cand) bldPlace(e.shiftKey); } else if (inCat && BLD.origin) bldDrop(); } // dragged here and let go
      else if (!pr && d && d.moved < 6 && inCv) { bldHover(e); if (BLD.cand) bldPlace(e.shiftKey); }
      return; }
    if (d && d.moved < 6 && inCv) { const h = d.hit || bldHit(e); if (h) bldSelect(h.i, h.si >= 0 ? h.si : -1); } });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); BLD.tdist = clamp(BLD.tdist * Math.exp(e.deltaY * .0012), 8, 320); }, {passive: false});
}
function capsuleLook(g) { // outside of the capsule only (the real one carries the whole cabin)
  const c = cylY(2.5, 1.0, 21.6, 25.45, RM.cap, 48); g.add(c); g.add(cylY(2.52, 2.5, 21.45, 21.75, RM.shield, 48));
  g.add(cylY(1.0, .95, 25.45, 25.95, RM.white, 40)); g.add(cylY(.78, .75, 25.95, 26.1, RM.grey, 32));
  for (const a of [-.25, .25]) { const w = mesh(new THREE.BoxGeometry(.5, .8, .05), RM.win, Math.sin(a) * 2.02, 23.45, -Math.cos(a) * 2.02); w.rotation.y = -a; w.rotation.x = .38; g.add(w); }
}
function bldRebuild() {
  bldInit(); if (BLD.g) { BLD.scene.remove(BLD.g); BLD.g.traverse(o => { if (o.geometry && !o.geometry.keep) o.geometry.dispose(); }); }
  RM.cap.color.set(BLD.paint.cap || PAINT0.cap);
  const st = BLD.st = shipLayout(BLD.parts), g = BLD.g = new THREE.Group(), y0 = Math.min(...st.filter(S => !S.cap).map(S => S.y0), 21.6);
  st.forEach((S, si) => { if (S.cap) { const n0 = g.children.length; capsuleLook(g); for (let k = n0; k < g.children.length; k++) g.children[k].userData.pi = -1; capTops(g, S, si, true, BLD.paint); return; }
    const gs = stageMeshes(g, S, si, true, BLD.paint); if (S.side) S.gs = gs; });
  for (const h of g.userData.legs || []) h.rotation.z = .5; g.userData.legs = null; const an = BLD.held ? BLD.anchor : y0; g.position.y = -an; BLD.floor.position.y = y0 - an; if (BLD.ringM) BLD.ringM.position.y = y0 - an + .02; g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); BLD.scene.add(g);
  if (!BLD.held && BLD.reanchor != null) { BLD.cy += BLD.reanchor - y0; BLD.tcy += BLD.reanchor - y0; BLD.reanchor = null; }
  if (!BLD.held) { BLD.lo = 0; BLD.hi = 27.7 - y0; BLD.tcy = clamp(BLD.tcy, BLD.lo, BLD.hi); } BLD.y0 = an;
  const hgt = 26.1 - y0; BLD.sun.target.position.set(0, hgt / 2, 0); const sc = BLD.sun.shadow.camera; sc.left = sc.bottom = -hgt * .7 - 6; sc.right = sc.top = hgt * .7 + 6; sc.far = hgt * 3 + 120; sc.updateProjectionMatrix(); BLD.sun.position.set(hgt * .6 + 20, hgt * 1.2 + 30, hgt * .8 + 20);
  bldHl(); bldPanels();
}
function bldHl() { // glow around the selected part (every copy of a side booster)
  const hs = BLD.hls; for (const h of hs) h.visible = false; if (!BLD.st) return; const put = (k, r, ya, yb, x, z) => { const h = hs[k]; if (!h) return; h.visible = true; h.scale.set(r, yb - ya + .2, r); h.position.set(x || 0, (ya + yb) / 2 - BLD.y0, z || 0); };
  if (BLD.sel === -1) { put(0, 2.75, 21.5, 26.2); return; }
  if (BLD.ss !== -1) { const S = BLD.st.find(S => S.side && S.side.at === BLD.sel); if (!S) return; const its = S.side.items.filter(it => it.k !== 'adapt' && (BLD.ss === -2 || it.si === BLD.ss)); if (!its.length) return;
    const ya = Math.min(...its.map(it => it.y0)), yb = Math.max(...its.map(it => it.y1)), r = Math.max(...its.map(it => it.r)) + .2; for (let k = 0; k < S.side.n; k++) { const a = S.side.ang(k); put(k, r, ya, yb, Math.cos(a) * S.side.off, -Math.sin(a) * S.side.off); } return; }
  const it = BLD.st.flatMap(S => S.parts).find(p => p.i === BLD.sel && p.k !== 'adapt'); if (it) put(0, (it.r || 1.25) + .25, it.y0, it.y1); }
function bldRay(e) { const cv = $('bldC'), b = cv.getBoundingClientRect(); BLD.ray.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), BLD.cam); return BLD.ray.ray; }
function bldHit(e, st) { // first part under the cursor: the parts are upright cylinders, so this is exact enough and never flickers
  const ray = bldRay(e), o = ray.origin, d = ray.direction, Y = BLD.y0; let best = null;
  const cyl = (cx, cz, r, y0, y1, out) => { const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, q = b * b - 4 * a * c; if (a < 1e-9 || q < 0) return;
    const t = (-b - Math.sqrt(q)) / (2 * a), y = o.y + t * d.y + Y; if (t > 0 && y >= y0 && y <= y1 && (!best || t < best.t - 1e-6)) best = Object.assign(out, {t, y, hx: o.x + t * d.x, hz: o.z + t * d.z}); };
  for (const S of st || BLD.st) {
    if (S.cap) { cyl(0, 0, 1.9, 21.6, 26.1, {i: -1, si: -1}); for (const it of S.parts) cyl(0, 0, it.r, it.y0, it.y1, {i: it.i, si: -1, it, top: true}); continue; }
    if (S.side) { for (let k = 0; k < S.side.n; k++) { const a = S.side.ang(k), cx = Math.cos(a) * S.side.off, cz = -Math.sin(a) * S.side.off; for (const it of S.side.items) if (it.k !== 'adapt') cyl(cx, cz, it.r, it.y0, it.y1, {i: S.side.at, si: it.si, it, side: S}); } continue; }
    for (const it of S.parts) if (it.k !== 'adapt') cyl(0, 0, Math.max(it.r || 0, .5), it.y0, it.inter ? it.y0 + (it.y1 - it.y0) / 3 : it.y1, {i: it.i, si: -1, it, S}); }
  return best; }
function bldRender() {
  if (!BLD.on) return; requestAnimationFrame(bldRender); const cv = $('bldC'), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * BLD.rnd.getPixelRatio()) || cv.height !== Math.round(h * BLD.rnd.getPixelRatio())) { BLD.rnd.setSize(w, h, false); BLD.cam.aspect = w / h; BLD.cam.updateProjectionMatrix(); }
  if (BLD.hov) { const e = BLD.hov; BLD.hov = null; if (BLD.held) bldHover(e); }
  BLD.dist += (BLD.tdist - BLD.dist) * .15; BLD.cy += (BLD.tcy - BLD.cy) * .15;
  const c = BLD.cam, d = BLD.dist; c.position.set(Math.sin(BLD.yaw) * Math.cos(BLD.pitch) * d, BLD.cy + Math.sin(BLD.pitch) * d, Math.cos(BLD.yaw) * Math.cos(BLD.pitch) * d); if (c.position.y < 1) c.position.y = 1; c.lookAt(0, BLD.cy, 0);
  BLD.hl.material.opacity = .16 + .08 * Math.sin(performance.now() / 250); const ns = d * .009; for (const n of BLD.nodeG.children) n.scale.setScalar(n.userData.on ? ns * 1.8 : ns); BLD.rnd.render(BLD.scene, c);
}

// ---------------- stats: delta-v and thrust-to-weight per stage (bottom stage fires first)
function shipStats(st) { // side boosters burn together with the core (and any other sets) above them: that part of the flight uses all those engines and some of their fuel
  const out = [], rem = st.map(S => S.fuel || 0); let tot = 0, totS = 0; const mass = i => st.slice(i).reduce((a, S, k) => a + S.dry + rem[i + k] + (S.cargoM || 0), 0), md = S => S.thrust / (S.ispV * G0), mass0 = mass(0);
  st.forEach((S, i) => { if (S.cap) return; const grp = [i]; if (S.side) { let j = i; while (st[j].side && st[j + 1] && !st[j + 1].cap) grp.push(++j); }
    const low = st.slice(0, i).every(x => x.side), m0 = mass(i), ok = S.thrust && rem[i] > 0, t = ok ? rem[i] / md(S) : 0, act = grp.filter(j => st[j].thrust && rem[j] > 0);
    if (!ok) { out.push({S, i, m0, dv: 0, dvS: 0, twr: 0, twrM: 0, burn: 0}); return; }
    let T = 0, mdT = 0, tS = 0, twrT = 0, used = 0; for (const j of act) { const X = st[j], f = Math.min(rem[j], md(X) * t); rem[j] -= f; used += f; T += X.thrust; mdT += md(X); tS += X.thrust / X.ispS; twrT += X.thrust * X.ispS / X.ispV; }
    const m1 = m0 - used, dv = T / mdT * Math.log(m0 / m1), dvS = T / tS * G0 * Math.log(m0 / m1); tot += dv; totS += low ? dvS : dv;
    out.push({S, i, m0, dv, dvS, twr: twrT / (m0 * G0), twrM: T / (m0 * 1.63), burn: t}); });
  return {rows: out, tot, totS, mass: mass0, h: 26.1 - Math.min(...st.filter(S => !S.cap).map(S => S.y0), 21.6)};
}

// ---------------- panels
function partStat(p) { return p.cat === 'tank' ? (p.fuel / 1000) + ' t fuel · ' + ((p.fuel + p.dry) / 1000).toFixed(1) + ' t' : p.cat === 'engine' ? Math.round(p.thrust / 1000) + ' kN · Isp ' + p.ispS + '/' + p.ispV + ' s · ' + (p.dry / 1000).toFixed(2) + ' t'
  : p.cat === 'srb' ? Math.round(p.thrust / 1000) + ' kN · ' + Math.round(p.fuel * p.ispS * G0 / p.thrust) + ' s burn · ' + ((p.fuel + p.dry) / 1000).toFixed(1) + ' t' : (p.dry / 1000).toFixed(2) + ' t'; }
const SWATCH = {base: ['#f1f0ec', '#d9dde2', '#8d949c', '#2a2d33', '#e8d9b5', '#c9302c', '#2f6fd6', '#2f8f5b', '#f2b81e', '#6b3fa0'],
  acc: ['#17191d', '#ffffff', '#c9302c', '#2f6fd6', '#f2b81e', '#2f8f5b', '#6b3fa0', '#ff8a1e', '#8d949c', '#7a1f1f'],
  trim: ['#ff8a1e', '#f2b81e', '#c9302c', '#2f6fd6', '#5fd38a', '#ffffff', '#17191d', '#e04fa0'], cap: ['#dcdfe3', '#f1f0ec', '#2a2d33', '#c9302c', '#2f6fd6', '#f2b81e', '#9aa3ad', '#2f8f5b']};
function bldCatalog() {
  const cats = [['tank', 'Fuel tanks'], ['engine', 'Engines'], ['srb', 'Solid boosters'], ['struct', 'Structure'], ['cargo', 'Cargo']]; let h = '<div id="bldBin">Let go here to remove it</div>';
  for (const [c, t] of cats) { h += '<div class="bt">' + t + '</div>'; for (const k in PARTS) { const p = PARTS[k]; if (p.cat !== c) continue;
      h += '<button class="bp" data-add="' + k + '" title="' + p.desc + '"><i class="ic ic-' + c + '" style="--w:' + Math.round((p.r || .9) * 10) + 'px;--h:' + Math.round(Math.min(p.h || 1, 6) * 5 + 6) + 'px"></i><span><b>' + p.name + '</b><small>' + partStat(p) + '</small></span></button>'; } }
  h += '<div class="bt">Stick on a part</div>';
  for (const k in RADIAL) h += '<button class="bp" data-rad="' + k + '" title="' + RADIAL[k].desc + '"><i class="ic ic-' + k + '"></i><span><b>' + RADIAL[k].name + '</b><small>' + RADIAL[k].desc + ' · ' + (RADIAL[k].dry / 1000).toFixed(2) + ' t</small></span></button>';
  h += '<div class="bt">Side boosters · how many</div><div class="bseg" id="bSideN">' + [2, 3, 4].map(n => '<button data-sn="' + n + '">' + n + '×</button>').join('') + '</div><div class="bhint">Ready-made sets below, or stick any tank or solid booster on the side of the rocket and build down from it.</div>';
  for (const k in SIDE_PRESETS) { const sp = SIDE_PRESETS[k], ps = sp.parts.map(q => PARTS[q.k]), eng = ps.find(q => q.thrust), fuel = ps.reduce((a, q) => a + (q.fuel || 0), 0);
    h += '<button class="bp" data-side="' + k + '"><i class="ic ic-' + (eng && eng.cat === 'srb' ? 'srb' : 'tank') + '" style="--w:' + Math.round(ps[ps.length - 1].r * 10) + 'px;--h:26px"></i><span><b>' + sp.name + '</b><small>each ' + Math.round(eng.thrust / 1000) + ' kN · ' + (fuel / 1000).toFixed(1) + ' t fuel</small></span></button>'; }
  h += '<div class="bt">Paint</div><div id="bldPaint"></div>';
  $('bldParts').innerHTML = h;
  const pick = (sel, hold, quick) => $('bldParts').querySelectorAll(sel).forEach(b => { b.onpointerdown = e => { if (e.button) return; e.preventDefault(); hold(b); BLD.press = {moved: 0}; }; b.ondblclick = () => { bldCancel(); quick(b); }; });
  pick('[data-side]', b => bldHold({kind: 'side', side: sideOf(b.dataset.side)}), b => bldSide(b.dataset.side));
  $('bldParts').querySelectorAll('[data-sn]').forEach(b => b.onclick = () => bldSideN(+b.dataset.sn));
  bldPaintUI();
  pick('[data-add]', b => bldHold({kind: 'part', d: {k: b.dataset.add}}), b => bldAdd(b.dataset.add));
  pick('[data-rad]', b => bldHold({kind: 'rad', k: b.dataset.rad}), b => bldRadial(b.dataset.rad));
}
function bldPanels() {
  const st = BLD.st, s = shipStats(st), sel = BLD.parts[BLD.sel];
  // stack, grouped by stage (top of the list = top of the rocket), KSP order: stage 1 fires first
  let h = st[st.length - 1].parts.map(it => '<div class="bs' + (it.i === BLD.sel ? ' on' : '') + '" data-i="' + it.i + '"><b>' + it.p.name + '</b><small>on the capsule · pops off with the parachute</small></div>').join('') + '<div class="bs' + (BLD.sel === -1 ? ' on' : '') + '" data-i="-1"><b>Capsule</b><small>3 seats · parachute · ' + (CAPSULE.dry / 1000).toFixed(1) + ' t</small></div>';
  for (let si = st.length - 2; si >= 0; si--) { const S = st[si], r = s.rows.find(x => x.i === si);
    h += '<div class="bsg">Stage ' + (si + 1) + ' · ' + S.name + (r && r.dv ? ' <em>' + Math.round(r.dv) + ' m/s</em>' : '') + '</div>';
    if (S.side) { const nm = S.side.items.filter(x => x.p).map(x => x.p.name).join(' + '); const mine = S.side.at === BLD.sel; h += '<div class="bs' + (mine && BLD.ss === -2 ? ' on' : '') + '" data-i="' + S.side.at + '" data-ss="-2"><b>' + S.side.n + '× side boosters</b><small>' + nm + '</small></div>';
      for (const it of S.side.items) if (it.k !== 'adapt') h += '<div class="bs bsub' + (mine && BLD.ss === it.si ? ' on' : '') + '" data-i="' + S.side.at + '" data-ss="' + it.si + '"><b>' + it.p.name + '</b><small>' + ([it.d.fins ? 'fins' : '', it.d.bigfins ? 'big fins' : '', it.d.rcs ? 'RCS' : '', it.blocked ? '<span class="bad">blocked</span>' : ''].filter(Boolean).join(' · ') || partStat(it.p)) + '</small></div>'; continue; }
    for (const it of S.parts) { if (it.k === 'adapt') continue; const d = it.d, tags = [d.fins ? 'fins' : '', d.bigfins ? 'big fins' : '', d.legs ? 'legs' : '', d.rcs ? 'RCS' : '', d.side ? d.side.n + '× side boosters' : '', it.inter ? 'interstage' : '', it.blocked ? '<span class="bad">blocked</span>' : ''].filter(Boolean).join(' · ');
      h += '<div class="bs' + (it.i === BLD.sel && BLD.ss === -1 ? ' on' : '') + '" data-i="' + it.i + '"><b>' + it.p.name + '</b><small>' + (tags || partStat(it.p)) + '</small></div>'; } }
  if (!BLD.parts.length) h += '<div class="bsg">Pick tanks and an engine on the left and click them onto the green dots</div>';
  $('bldStack').innerHTML = h; $('bldStack').querySelectorAll('.bs').forEach(e => e.onclick = () => { bldCancel(); bldSelect(+e.dataset.i, e.dataset.ss ? +e.dataset.ss : -1); });
  // numbers
  const twr0 = s.rows[0] ? s.rows[0].twr : 0, warn = st.flatMap(S => S.warn);
  if (!s.rows.length || !s.rows[0].dv) warn.unshift('The bottom stage needs an engine and fuel to leave the pad');
  else if (twr0 < 1) warn.unshift('Too heavy to lift off: thrust-to-weight ' + twr0.toFixed(2) + ' (needs over 1, 1.3+ is comfy)');
  for (const S of st) if (S.legs && S.legFoot > S.y0 + .05) warn.push('Landing legs on ' + S.name.toLowerCase() + ' sit too high to reach the ground: put them on the lowest tank');
  let n = '<div class="bnum"><div><span>Mass</span><b>' + (s.mass / 1000).toFixed(1) + ' t</b></div><div><span>Height</span><b>' + s.h.toFixed(1) + ' m</b></div><div><span>Δv (space)</span><b>' + (s.tot / 1000).toFixed(2) + ' km/s</b></div><div><span>Lift-off TWR</span><b class="' + (twr0 < 1 ? 'bad' : twr0 < 1.2 ? 'amb' : '') + '">' + twr0.toFixed(2) + '</b></div></div>';
  n += '<table class="btab"><tr><th>Stage</th><th>Δv</th><th>TWR Home</th><th>TWR Moon</th><th>Burn</th></tr>';
  for (const r of s.rows.slice().reverse()) n += '<tr><td>' + (r.i + 1) + ' ' + r.S.name + '</td><td>' + (r.dv ? Math.round(r.dv) : '—') + '</td><td class="' + (r.i === 0 && r.twr < 1 ? 'bad' : '') + '">' + (r.twr ? r.twr.toFixed(2) : '—') + '</td><td>' + (r.twrM ? r.twrM.toFixed(1) : '—') + '</td><td>' + (r.burn ? fmtS(r.burn) : '—') + '</td></tr>';
  n += '</table><div class="bneed">' + DV_NEED.map(([t, v]) => '<span class="' + (s.tot >= v ? 'ok' : '') + '">' + t + ' ≈ ' + (v / 1000).toFixed(1) + '</span>').join('') + '</div>';
  if (warn.length) n += '<div class="bwarn">' + warn.map(w => '<div><span class="ico i-warn"></span> ' + w + '</div>').join('') + '</div>';
  $('bldNum').innerHTML = n;
  // catalogue buttons light up for what the selected part carries, and for what you are holding
  const hd = BLD.held, tgt = sel && BLD.ss >= 0 && sel.side ? sel.side.parts[BLD.ss] : sel;
  $('bldParts').querySelectorAll('[data-rad]').forEach(b => b.classList.toggle('on', hd ? hd.kind === 'rad' && hd.k === b.dataset.rad : !!(tgt && tgt[b.dataset.rad])));
  $('bldParts').querySelectorAll('[data-side]').forEach(b => b.classList.toggle('on', hd ? hd.kind === 'side' && hd.side.pre === b.dataset.side : !!(sel && sel.side && sel.side.pre === b.dataset.side)));
  $('bldParts').querySelectorAll('[data-add]').forEach(b => b.classList.toggle('on', !!hd && hd.kind === 'part' && !BLD.origin && hd.d.k === b.dataset.add));
  $('bldParts').querySelectorAll('[data-sn]').forEach(b => { const n = +b.dataset.sn; b.classList.toggle('on', hd && hd.kind === 'side' ? hd.side.n === n : sel && sel.side && !hd ? sel.side.n === n : n === BLD.sideN); });
  const nmH = hd && (hd.kind === 'rad' ? RADIAL[hd.k].name : hd.kind === 'side' ? hd.side.n + '× side boosters' : PARTS[hd.d.k].name);
  $('bldSel').textContent = hd ? 'Holding ' + nmH + (hd.kind === 'rad' ? ' · click the part it goes on' : hd.kind === 'side' ? ' · click the side of the rocket, at the height you want them' : ' · click a green dot to attach it' + (PARTS[hd.d.k].cat === 'tank' || PARTS[hd.d.k].cat === 'srb' ? ', or the side of a tank for side boosters' : '')) + ' · Esc: put it back'
    : BLD.sel === -1 ? 'Capsule selected' : sel ? (BLD.ss === -2 ? 'Side boosters' : PARTS[(tgt || sel).k].name) + ' selected · drag it to move it · Del removes' : '';
  bldActs();
  $('bldGo').disabled = R.st === 'fly' && G.on; $('bldGo').title = $('bldGo').disabled ? 'Land (or crash) first' : '';
  bldShips();
}
function bldShips() { const sv = shipsSaved(), sel = $('bldLoad'), cur = sel.value;
  sel.innerHTML = '<option value="">Load a design…</option><optgroup label="Ready-made">' + Object.keys(SHIP_PRESETS).map(k => '<option value="p:' + k + '">' + k + '</option>').join('') + '</optgroup>'
    + (Object.keys(sv).length ? '<optgroup label="Saved">' + Object.keys(sv).map(k => '<option value="s:' + k.replace(/"/g, '&quot;') + '">' + k.replace(/</g, '&lt;') + '</option>').join('') + '</optgroup>' : '');
  sel.value = cur; $('bldDel').classList.toggle('hidden', !cur.startsWith('s:')); }

// ---------------- editing
function bldPush() { BLD.hist.push(JSON.stringify(BLD.parts)); if (BLD.hist.length > 60) BLD.hist.shift(); }
function bldSelect(i, ss = -1) { BLD.sel = i; BLD.ss = ss; bldHl(); bldPanels(); const it = BLD.st.flatMap(S => S.parts).find(p => p.i === i); if (it) BLD.tcy = clamp((it.y0 + it.y1) / 2 - BLD.y0, BLD.lo, BLD.hi); }
const sideOk = p => p && p.k !== 'dec' && p.cat !== 'cargo'; // what may be part of a side booster
const stripD = d => { const q = {k: d.k}; for (const f of ['fins', 'bigfins', 'rcs']) if (d[f]) q[f] = 1; return q; };
function sideOf(k) { const side = {n: BLD.sideN, pre: k, parts: SIDE_PRESETS[k].parts.map(q => ({...q}))}, last = side.parts[side.parts.length - 1]; if (PARTS[last.k].h > 3) last.fins = 1; return side; }
function bldAdd(k) { // quick add (double click, hangar shelves): under the selected part
  bldCancel(); if (BLD.parts.length >= 40) { showHint('That is plenty of parts', 2000); return; } const p = PARTS[k], sel = BLD.parts[BLD.sel]; if (!p) return; bldPush();
  if (sel && sel.side && BLD.ss !== -1 && sideOk(p)) { const at = BLD.ss >= 0 ? BLD.ss + 1 : sel.side.parts.length; sel.side.parts.splice(at, 0, {k}); delete sel.side.pre; BLD.ss = at; }
  else if (BLD.sel === -1 && p.nose && p.r <= .65 && !BLD.parts.some(d => d.top)) { BLD.parts.unshift({k, top: 1}); BLD.sel = 0; }
  else { let at = BLD.sel + 1; if (BLD.parts[0] && BLD.parts[0].top) at = Math.max(at, 1); BLD.parts.splice(at, 0, {k}); BLD.sel = at; BLD.ss = -1; }
  bldRebuild(); sfx && SND.c && sfx('pop'); }
function bldRadial(k) { bldCancel(); const m = BLD.parts[BLD.sel], p = m && BLD.ss >= 0 && m.side ? m.side.parts[BLD.ss] : m; if (!p || p.top || PARTS[p.k].k === 'dec' || (k === 'legs' && (p !== m || PARTS[p.k].cat !== 'tank'))) { showHint(k === 'legs' ? 'Select a tank on the rocket first' : 'Select a part first', 1800); return; } bldPush();
  if (k === 'legs' && !p.legs) for (const q of BLD.parts) q.legs = 0; // one set of legs per rocket keeps G simple
  if (k === 'fins') delete p.bigfins; if (k === 'bigfins') delete p.fins; p[k] = p[k] ? 0 : 1; bldRebuild(); }
function bldStageOf(i) { return BLD.st ? BLD.st.find(S => S.parts.some(it => it.i === i)) : null; }
function bldSide(k) { bldCancel(); const p = BLD.parts[BLD.sel]; if (!p || p.top || PARTS[p.k].k === 'dec') { showHint('Select a tank in the stage they should help lift', 2200); return; } bldPush();
  const o = p.side; p.side = sideOf(k); if (o) { p.side.n = o.n; if (o.dy) p.side.dy = o.dy; if (o.a != null) p.side.a = o.a; } BLD.ss = -2; bldRebuild(); }
function bldSideN(n) { if (!n) return; BLD.sideN = n; const h = BLD.held; if (h) { if (h.kind === 'side') h.side.n = n; const c = BLD.cand; BLD.cand = null; bldApply(c); return; }
  const p = BLD.parts[BLD.sel]; if (!p || !p.side) { bldPanels(); return; } bldPush(); p.side.n = n; bldRebuild(); }
function bldSideMove(dir) { const p = BLD.parts[BLD.sel], it = p && p.side && BLD.st.flatMap(S => S.parts).find(q => q.i === BLD.sel && q.k !== 'adapt'); if (!it) return; bldPush();
  p.side.dy = clamp((+p.side.dy || 0) + dir * .5, it.y0 + 1 - it.y1, 21.6 - it.y1); bldRebuild(); }

// ---------------- holding a part: it follows the mouse, snaps to the green dots (stack) or to the side of a tank (side boosters, fins, legs)
function heldParts() { const h = BLD.held; return h.kind === 'side' ? h.side.parts : h.kind === 'part' ? [h.d] : []; }
function bldHold(h, origin) {
  if (BLD.held) bldCancel(); if (!origin && h.kind === 'part' && BLD.parts.length >= 40) { showHint('That is plenty of parts', 2000); return; }
  BLD.sel0 = BLD.sel; BLD.ss0 = BLD.ss; BLD.held = h; BLD.origin = origin || null; BLD.base = JSON.stringify(BLD.parts); BLD.bst = shipLayout(BLD.parts); BLD.anchor = BLD.y0; BLD.cand = null;
  const g = BLD.ghost, w = new THREE.Group(); g.clear(); g.add(w); let y = 0;
  if (h.kind === 'rad') w.add(mesh(new THREE.BoxGeometry(.5, .9, .5), RM.black));
  else { heldParts().forEach((d, j) => { const p = PARTS[d.k], it = {k: d.k, p, d: stripD(d), i: 0, si: j, r: p.r || 1.25, y0: y - p.h, y1: y, dry: 0, fuel: 0}; if (p.k === 'dec') { it.k = 'dec'; it.d = {}; } partMeshes(w, it, 0, true, BLD.paint); y = it.y0; }); w.position.y = -y / 2; }
  g.userData.len = -y; g.visible = false; w.userData.legs = null;
  document.body.classList.add('bheld'); document.body.classList.toggle('bgrab', !!origin); bldNodes(); bldApply(null);
}
function bldNodes() { // where the held part may go: under the capsule, between parts, at the bottom, on a side booster, on top of the capsule
  const h = BLD.held, N = [], st = BLD.bst, parts = JSON.parse(BLD.base); BLD.nodeG.clear(); BLD.nodes = N; if (!h || h.kind !== 'part') return;
  const p0 = PARTS[h.d.k], main = st.filter(S => !S.cap && !S.side).flatMap(S => S.parts).filter(it => it.k !== 'adapt').sort((a, b) => a.i - b.i);
  let y = main.length ? main[0].y1 : 21.6; for (const it of main) { N.push({c: 'm', idx: it.i, x: 0, y, z: 0}); y = it.y0; } N.push({c: 'm', idx: parts.length, x: 0, y, z: 0});
  if (p0.nose && p0.r <= .65 && !h.d.side && !parts.some(d => d.top)) N.push({c: 't', x: 0, y: 26.1, z: 0});
  if (!h.d.side && sideOk(p0)) for (const S of st) if (S.side) { const its = S.side.items.filter(it => it.k !== 'adapt'); if (!its.length) continue;
    for (let k = 0; k < S.side.n; k++) { const a = S.side.ang(k), x = Math.cos(a) * S.side.off, z = -Math.sin(a) * S.side.off; let yy = its[0].y1; for (const it of its) { N.push({c: 's', at: S.side.at, idx: it.si, x, y: yy, z}); yy = it.y0; } N.push({c: 's', at: S.side.at, idx: parts[S.side.at].side.parts.length, x, y: yy, z}); } }
  for (const n of N) { const m = new THREE.Mesh(BLD.nodeGeo, BLD.nodeM); m.renderOrder = 9; m.position.set(n.x, n.y - BLD.anchor, n.z); n.m = m; BLD.nodeG.add(m); }
}
const _bv = new THREE.Vector3();
function bldHover(e) { const h = BLD.held; if (!h) return; const b = $('bldC').getBoundingClientRect(), inCv = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; let cand = null;
  if (inCv) { const hp0 = h.kind === 'part' && PARTS[h.d.k], wide = !hp0 || !(hp0.cat === 'tank' || hp0.cat === 'srb') || h.d.side; // tanks and solids can also go on the side of a part, so their dots must be hit more exactly
    let bd = wide ? 46 : clamp(b.height / (BLD.dist * .728), 20, 46); for (const n of BLD.nodes) { _bv.set(n.x, n.y - BLD.anchor, n.z).project(BLD.cam); if (_bv.z > 1) continue; const dd = Math.hypot(b.left + (_bv.x * .5 + .5) * b.width - e.clientX, b.top + (-_bv.y * .5 + .5) * b.height - e.clientY); if (dd < bd) { bd = dd; cand = n.c === 't' ? {t: 'top'} : {t: 'ins', c: n.c, at: n.at, idx: n.idx}; } }
    if (!cand) { const hit = bldHit(e, BLD.bst); if (hit && hit.i >= 0 && !hit.top) cand = bldSurf(h, hit); } }
  if (JSON.stringify(cand) !== JSON.stringify(BLD.cand)) bldApply(cand);
  const g = BLD.ghost; g.visible = !cand && inCv; if (g.visible) { const r = bldRay(e), nx = Math.sin(BLD.yaw), nz = Math.cos(BLD.yaw), den = r.direction.x * nx + r.direction.z * nz; if (Math.abs(den) > 1e-4) { const t = -(r.origin.x * nx + r.origin.z * nz) / den; g.position.copy(r.origin).addScaledVector(r.direction, t); } }
}
function bldSurf(h, hit) { // the cursor is on the side of a part
  const parts = JSON.parse(BLD.base), d = parts[hit.i]; if (!d) return null; const p = PARTS[d.k];
  if (h.kind === 'rad') { const tgt = hit.si >= 0 ? d.side.parts[hit.si] : d, tp = PARTS[tgt.k]; if (tp.k === 'dec' || tgt[h.k] || (h.k === 'legs' && (hit.si >= 0 || tp.cat !== 'tank'))) return null; return {t: 'rad', i: hit.i, si: hit.si}; }
  const p0 = PARTS[heldParts()[0].k], boost = h.kind === 'side' || (!h.d.side && (p0.cat === 'tank' || p0.cat === 'srb'));
  if (hit.si >= 0 && h.kind === 'part') return !h.d.side && sideOk(p0) ? {t: 'ins', c: 's', at: hit.i, idx: hit.si + 1} : null;
  if (!boost) return {t: 'ins', c: 'm', idx: hit.i + 1}; if (p.k === 'dec') return null;
  const at = BLD.bst.flatMap(S => S.parts).find(it => it.i === hit.i && it.k !== 'adapt'); if (!at) return null;
  const top = clamp(Math.round((hit.y + BLD.ghost.userData.len / 2) * 4) / 4, at.y0 + 1, 21.6); return {t: 'side', i: hit.i, dy: +(top - at.y1).toFixed(2), a: +(Math.round(Math.atan2(-hit.hz, hit.hx) / (Math.PI / 24)) * Math.PI / 24).toFixed(4)}; }
function bldApply(cand) { // show the design as it would be with the held part attached there
  const pc = BLD.cand; if (cand && pc && cand.t === 'side' && pc.t === 'side' && cand.i === pc.i) { // sliding boosters along the same part: move the meshes, no rebuild
    const S = BLD.st.find(S => S.side && S.side.at === cand.i && S.gs), sd = BLD.parts[cand.i] && BLD.parts[cand.i].side;
    if (S && sd) { S.gs.forEach((w, k) => { w.rotation.y = cand.a + k * 2 * Math.PI / S.side.n; w.position.y += cand.dy - pc.dy; }); sd.dy = cand.dy; sd.a = cand.a; BLD.cand = cand; for (const x of BLD.hls) x.visible = false; return; } }
  const parts = JSON.parse(BLD.base), h = BLD.held; let sel = -9, ss = -1;
  if (cand && cand.t === 'ins' && cand.c === 'm') { parts.splice(cand.idx, 0, JSON.parse(JSON.stringify(h.d))); sel = cand.idx; }
  else if (cand && cand.t === 'ins') { parts[cand.at].side.parts.splice(cand.idx, 0, stripD(h.d)); delete parts[cand.at].side.pre; sel = cand.at; ss = cand.idx; }
  else if (cand && cand.t === 'top') { parts.unshift({k: h.d.k, top: 1}); sel = 0; }
  else if (cand && cand.t === 'side') { const side = h.kind === 'side' ? JSON.parse(JSON.stringify(h.side)) : {n: BLD.sideN, parts: [stripD(h.d)]}; side.dy = cand.dy; side.a = cand.a; parts[cand.i].side = side; sel = cand.i; ss = -2; }
  else if (cand && cand.t === 'rad') { const tgt = cand.si >= 0 ? parts[cand.i].side.parts[cand.si] : parts[cand.i]; if (h.k === 'legs') for (const q of parts) q.legs = 0; if (h.k === 'fins') delete tgt.bigfins; if (h.k === 'bigfins') delete tgt.fins; tgt[h.k] = 1; sel = cand.i; ss = cand.si >= 0 ? cand.si : -1; }
  BLD.parts = parts; BLD.sel = sel; BLD.ss = ss; BLD.cand = cand || null; bldRebuild();
  for (const n of BLD.nodes) { const on = !!cand && (cand.t === 'top' ? n.c === 't' : cand.t === 'ins' && n.c === cand.c && n.idx === cand.idx && (n.c === 'm' || n.at === cand.at)); n.m.userData.on = on; n.m.material = on ? BLD.nodeM2 : BLD.nodeM; n.m.visible = on || !cand; }
}
function bldRelease() { BLD.held = null; BLD.origin = null; BLD.cand = null; BLD.ghost.clear(); BLD.ghost.visible = false; BLD.nodeG.clear(); BLD.nodes = []; document.body.classList.remove('bheld', 'bgrab'); BLD.reanchor = BLD.anchor; }
function bldPlace(keep) { const h = BLD.held; if (!h || !BLD.cand) return; BLD.hist.push(BLD.origin || BLD.base); if (BLD.hist.length > 60) BLD.hist.shift(); const fresh = !BLD.origin;
  bldRelease(); bldRebuild(); sfx && SND.c && sfx('pop'); if (keep && fresh && h.kind !== 'rad') bldHold(h.kind === 'side' ? {kind: 'side', side: JSON.parse(JSON.stringify(h.side))} : {kind: 'part', d: {k: h.d.k}}); }
function bldCancel() { if (!BLD.held) return; BLD.parts = JSON.parse(BLD.origin || BLD.base); BLD.sel = BLD.sel0; BLD.ss = BLD.ss0; bldRelease(); bldRebuild(); }
function bldDrop() { if (!BLD.held) return; if (BLD.origin) BLD.hist.push(BLD.origin); BLD.parts = JSON.parse(BLD.base); BLD.sel = BLD.parts.length ? Math.min(Math.max(BLD.sel0, 0), BLD.parts.length - 1) : -1; BLD.ss = -1; bldRelease(); bldRebuild(); }
function bldGrab(hit) { // pick a placed part up (a side booster comes off as a whole set)
  const origin = JSON.stringify(BLD.parts), d = BLD.parts[hit.i], s0 = [BLD.sel, BLD.ss]; if (!d) return; let h;
  if (hit.si !== undefined && hit.si !== -1) { if (!d.side) return; h = {kind: 'side', side: d.side}; delete d.side; } else { BLD.parts.splice(hit.i, 1); h = {kind: 'part', d: d.top ? {k: d.k} : d}; }
  BLD.sel = -9; BLD.ss = -1; bldHold(h, origin); BLD.sel0 = s0[0]; BLD.ss0 = s0[1]; }
function bldActs() { // buttons for the selected part (what KSP puts on a right click)
  const el = $('bldAct'); if (!el) return; const m = BLD.parts[BLD.sel]; let h = '';
  if (!BLD.held && m) { const sub = BLD.ss >= 0 && m.side ? m.side.parts[BLD.ss] : null, tgt = BLD.ss === -1 ? m : sub;
    h += '<button data-a="grab">Move</button>';
    if (BLD.ss !== -1) h += '<button data-a="up" title="Page Up">Slide up</button><button data-a="down" title="Page Down">Slide down</button>' + [2, 3, 4].map(n => '<button data-a="n' + n + '" class="' + (m.side && m.side.n === n ? 'on' : '') + '">' + n + '×</button>').join('');
    if (tgt) for (const k in RADIAL) if (tgt[k]) h += '<button data-a="r' + k + '">' + RADIAL[k].name + ' ×</button>';
    if (BLD.ss === -1 && m.side) h += '<button data-a="set">' + m.side.n + '× side boosters</button>';
    h += '<button data-a="del">' + (BLD.ss === -2 ? 'Remove boosters' : 'Remove') + '</button>'; }
  if (el._h !== h) { el._h = h; el.innerHTML = h; el.querySelectorAll('button').forEach(b => b.onclick = () => { const a = b.dataset.a;
    if (a === 'grab') { bldGrab({i: BLD.sel, si: BLD.ss}); showHint('Move the mouse to a green dot and click · Esc puts it back', 2600); } else if (a === 'up') bldSideMove(1); else if (a === 'down') bldSideMove(-1); else if (a[0] === 'n') bldSideN(+a[1]);
    else if (a[0] === 'r') bldRadial(a.slice(1)); else if (a === 'set') bldSelect(BLD.sel, -2); else if (a === 'del') bldDel(); }); }
}
function bldPaintUI() { const P = BLD.paint, row = (key, label) => '<div class="bpr"><span>' + label + '</span>' + SWATCH[key].map(c => '<button class="sw' + (P[key] === c ? ' on' : '') + '" data-pk="' + key + '" data-pc="' + c + '" style="background:' + c + '"></button>').join('') + '</div>';
  $('bldPaint').innerHTML = row('base', 'Body') + row('acc', 'Marks') + row('trim', 'Trim') + row('cap', 'Capsule')
    + '<div class="bseg">' + PAINT_PATS.map(([k, t]) => '<button data-pp="' + k + '" class="' + (P.pat === k ? 'on' : '') + '">' + t + '</button>').join('') + '</div>'
    + '<input id="bldText" type="text" maxlength="12" placeholder="Name on the tanks" value="' + (P.text || '').replace(/"/g, '&quot;') + '">';
  $('bldPaint').querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { P[b.dataset.pk] = b.dataset.pc; bldPaintUI(); bldRebuild(); });
  $('bldPaint').querySelectorAll('[data-pp]').forEach(b => b.onclick = () => { P.pat = b.dataset.pp; bldPaintUI(); bldRebuild(); });
  $('bldText').oninput = () => { P.text = $('bldText').value.toUpperCase(); clearTimeout(BLD.tT); BLD.tT = setTimeout(bldRebuild, 350); }; }
function bldDel() { if (BLD.held) { if (BLD.origin) bldDrop(); else bldCancel(); return; } const m = BLD.parts[BLD.sel]; if (!m) return; bldPush();
  if (BLD.ss >= 0 && m.side) { m.side.parts.splice(BLD.ss, 1); delete m.side.pre; BLD.ss = -2; if (!m.side.parts.length) { delete m.side; BLD.ss = -1; } bldRebuild(); return; }
  if (BLD.ss === -2) { delete m.side; BLD.ss = -1; bldRebuild(); return; }
  BLD.parts.splice(BLD.sel, 1); BLD.sel = Math.min(BLD.sel, BLD.parts.length - 1); if (BLD.sel < 0 && BLD.parts.length) BLD.sel = 0; if (!BLD.parts.length) BLD.sel = -1; bldRebuild(); }
function bldMove(d) { const i = BLD.sel, j = i + d; if (BLD.held || BLD.ss !== -1 || i < 0 || j < 0 || j >= BLD.parts.length || BLD.parts[i].top || BLD.parts[j].top) return; bldPush(); [BLD.parts[i], BLD.parts[j]] = [BLD.parts[j], BLD.parts[i]]; BLD.sel = j; bldRebuild(); }
function bldUndo() { if (BLD.held) { bldCancel(); return; } const h = BLD.hist.pop(); if (!h) return; BLD.parts = JSON.parse(h); BLD.sel = Math.min(BLD.sel, BLD.parts.length - 1); BLD.ss = -1; bldRebuild(); }
function bldSet(parts, name, paint) { bldCancel(); bldPush(); BLD.ss = -1; BLD.parts = cloneParts(parts); if (paint) { BLD.paint = Object.assign({}, PAINT0, paint); bldPaintUI(); } if (name) { BLD.name = name; $('bldName').value = name; } BLD.sel = BLD.parts.length ? BLD.parts.length - 1 : -1; bldRebuild(); BLD.tdist = clamp(BLD.hi * 2.4, 24, 260); BLD.tcy = BLD.hi * .5; }

// ---------------- open / close / launch
function bldOpen() {
  if (BLD.on) return; BLD.on = true; BLD.wasOn = G.on; BLD.wasPaused = G.paused; G.paused = true; for (const k in keys) keys[k] = false; if (document.pointerLockElement) document.exitPointerLock();
  if (typeof setPause === 'function') $('pause').classList.add('hidden'); if (SND.c) { try { SND.c.suspend(); } catch (e) {} }
  bldInit(); bldCatalog(); BLD.hist = []; BLD.parts = cloneParts(SHIP.parts); BLD.paint = Object.assign({}, PAINT0, SHIP.paint); bldPaintUI(); BLD.name = SHIP.name; $('bldName').value = SHIP.name; BLD.sel = BLD.parts.length - 1; BLD.ss = -1; BLD.held = null; BLD.reanchor = null;
  $('bld').classList.remove('hidden'); bldRebuild(); BLD.dist = BLD.tdist = clamp(BLD.hi * 2.4, 24, 260); BLD.cy = BLD.tcy = BLD.hi * .5; requestAnimationFrame(bldRender);
}
function bldClose() { if (!BLD.on) return; bldCancel(); BLD.on = false; applyCapPaint(); $('bld').classList.add('hidden'); G.paused = false; if (!G.on) return;
  if (SND.c) { try { SND.c.resume(); } catch (e) {} } G.pauseAt = performance.now(); lockPointer(); }
function bldSaveCur() { try { localStorage.setItem('ye-ship', JSON.stringify({name: SHIP.name, parts: SHIP.parts, paint: SHIP.paint})); } catch (e) {} }
function bldLaunch() {
  bldCancel();
  if (G.on && R.st === 'fly') { showHint('Land first: you can only roll out a new rocket when you are not flying', 3000); return; }
  const st = shipLayout(BLD.parts), s = shipStats(st); if (!s.rows.length || !s.rows[0].dv) { showHint('The bottom stage needs an engine and fuel', 2500); return; }
  const nm = ($('bldName').value || '').trim().slice(0, 24) || 'My rocket'; shipApply(BLD.parts, nm, BLD.paint); bldSaveCur();
  if (typeof flightClear === 'function') flightClear();
  const start = !G.on; bldClose(); if (start) $('play').click();
  clearDebris(); resetRocket(); if (typeof warmShaders === 'function') warmShaders();
  board(); toPilot(); G.wi = 0; G.warp = 1;
  showHint(nm + ' is on the pad. Space: launch · V: outside view · B: back to the builder', 6000);
}
$('bldX').onclick = () => bldClose();
$('bldGo').onclick = () => bldLaunch();
$('bldSave').onclick = () => { bldCancel(); const nm = ($('bldName').value || '').trim().slice(0, 24) || 'My rocket'; const sv = shipsSaved(); sv[nm] = {parts: BLD.parts, paint: BLD.paint}; try { localStorage.setItem(SHIPS_K, JSON.stringify(sv)); } catch (e) {} BLD.name = nm; bldShips(); $('bldLoad').value = 's:' + nm; bldShips(); showHint('Saved "' + nm + '"', 1800); };
$('bldLoad').onchange = () => { const v = $('bldLoad').value; if (!v) return; const nm = v.slice(2), sv = v[0] === 'p' ? SHIP_PRESETS[nm] : shipsSaved()[nm], parts = Array.isArray(sv) ? sv : sv && sv.parts; if (parts && parts.every(partOk)) bldSet(parts, nm, v[0] === 'p' ? null : sv.paint); bldShips(); };
$('bldDel').onclick = () => { const v = $('bldLoad').value; if (!v.startsWith('s:')) return; const sv = shipsSaved(); delete sv[v.slice(2)]; try { localStorage.setItem(SHIPS_K, JSON.stringify(sv)); } catch (e) {} $('bldLoad').value = ''; bldShips(); };
$('bldNew').onclick = () => bldSet([], 'New rocket');
$('bldUndo').onclick = () => bldUndo();
$('bldRm').onclick = () => bldDel();
$('menuBld').onclick = () => bldOpen();
$('pBld').onclick = () => { if (typeof setPause === 'function') setPause(false, false); bldOpen(); };
// keys: the builder eats every key while open (so Esc/P/M/J etc. don't reach the game underneath)
addEventListener('keydown', e => {
  if (!BLD.on) { if (e.code === 'KeyB' && G.on && !G.paused && !e.repeat && !(typeof MAPV !== 'undefined' && MAPV.on)) { if (R.st === 'fly') showHint('The builder opens when you are not flying (land first)', 2200); else bldOpen(); } return; }
  e.stopImmediatePropagation(); if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Escape' || e.code === 'Enter') e.target.blur(); return; }
  const k = e.code;
  if (k === 'Escape' && BLD.held) bldCancel();
  else if (k === 'Escape' || k === 'KeyB') bldClose();
  else if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); if (!BLD.held) bldSideMove(k === 'PageUp' ? 1 : -1); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); bldDel(); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const d = k === 'ArrowUp' ? -1 : 1; if (BLD.held) return; if (e.shiftKey) bldMove(d); else bldSelect(clamp(BLD.sel + d, -1, BLD.parts.length - 1)); }
  else if (k === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); bldUndo(); }
  else if (k === 'Enter') bldLaunch();
}, true);
addEventListener('keyup', e => { if (BLD.on) e.stopImmediatePropagation(); }, true);
// skip the world render while the builder covers the screen (saves the GPU for the preview)
{ const r0 = render; render = function (dt) { if (BLD.on) return; r0(dt); }; }
Object.assign(window.YE, {BLD, bldOpen, bldClose, bldLaunch, bldAdd, bldSet, shipStats, shipLayout, shipApply, SHIP, PARTS});
// mouse settings on the pause card (SET.sens, SET.invY: used by every camera)
{ const sv = $('pSens'), sl = $('pSensV'), iv = $('pInv'), show = () => { sv.value = SET.sens || 1; sl.textContent = (+(SET.sens || 1)).toFixed(2) + '×'; iv.checked = !!SET.invY; };
  show(); sv.oninput = () => { SET.sens = +sv.value; saveSet(); show(); }; iv.onchange = () => { SET.invY = iv.checked; saveSet(); }; }
