'use strict';
// YeShip rocket builder (KSP-style hangar editor, 25 Nov 2026). Parts + layout live in flight.js (PARTS, shipLayout, shipApply, partMeshes).
// B (not while flying), the main menu or the pause card opens it. Own small WebGL renderer for the preview; the world is not drawn while it is open.
// Loaded after extras.js, before polish.js (which calls boot()).

const BLD = {on: false, parts: [], paint: {...PAINT0}, sideN: 2, name: '', sel: -1, hist: [], yaw: .7, pitch: .25, dist: 60, tdist: 60, cy: 12, tcy: 12, drag: null};
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 64), new THREE.MeshBasicMaterial({color: 0xffcf4a})); ring.rotation.x = -Math.PI / 2; ring.position.y = .02; s.add(ring);
  BLD.hl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), new THREE.MeshBasicMaterial({color: 0xffcf4a, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending}));
  BLD.hl.renderOrder = 3; s.add(BLD.hl);
  BLD.ray = new THREE.Raycaster();
  cv.addEventListener('pointerdown', e => { BLD.drag = {x: e.clientX, y: e.clientY, moved: 0}; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { const d = BLD.drag; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    if (e.buttons & 2 || e.shiftKey) BLD.tcy = clamp(BLD.tcy + dy * BLD.dist * .002, BLD.lo, BLD.hi); else { BLD.yaw -= dx * .008; BLD.pitch = clamp(BLD.pitch + dy * .006, -.2, 1.35); } });
  cv.addEventListener('pointerup', e => { const d = BLD.drag; BLD.drag = null; if (d && d.moved < 5) bldPick(e); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); BLD.tdist = clamp(BLD.tdist * Math.exp(e.deltaY * .0012), 8, 320); }, {passive: false});
}
function capsuleLook(g) { // outside of the capsule only (the real one carries the whole cabin)
  const c = cylY(2.5, 1.0, 21.6, 25.45, RM.cap, 48); g.add(c); g.add(cylY(2.52, 2.5, 21.45, 21.75, RM.shield, 48));
  g.add(cylY(1.0, .95, 25.45, 25.95, RM.white, 40)); g.add(cylY(.78, .75, 25.95, 26.1, RM.grey, 32));
  for (const a of [-.25, .25]) { const w = mesh(new THREE.BoxGeometry(.5, .8, .05), RM.win, Math.sin(a) * 2.02, 23.45, -Math.cos(a) * 2.02); w.rotation.y = -a; w.rotation.x = .38; g.add(w); }
}
function bldRebuild() {
  bldInit(); if (BLD.g) { BLD.scene.remove(BLD.g); BLD.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  RM.cap.color.set(BLD.paint.cap || PAINT0.cap);
  const st = BLD.st = shipLayout(BLD.parts), g = BLD.g = new THREE.Group(), y0 = Math.min(...st.filter(S => !S.cap).map(S => S.y0), 21.6);
  st.forEach((S, si) => { if (S.cap) { const n0 = g.children.length; capsuleLook(g); for (let k = n0; k < g.children.length; k++) g.children[k].userData.pi = -1; return; }
    stageMeshes(g, S, si, true, BLD.paint, (o, it) => o.traverse(x => x.userData.pi = it.k === 'adapt' ? undefined : it.i)); });
  for (const h of g.userData.legs || []) h.rotation.z = .5; g.userData.legs = null; g.position.y = -y0; g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); BLD.scene.add(g);
  BLD.lo = 0; BLD.hi = 26.1 - y0; BLD.tcy = clamp(BLD.tcy, BLD.lo, BLD.hi); BLD.y0 = y0;
  const hgt = 26.1 - y0; BLD.sun.target.position.set(0, hgt / 2, 0); const sc = BLD.sun.shadow.camera; sc.left = sc.bottom = -hgt * .7 - 6; sc.right = sc.top = hgt * .7 + 6; sc.far = hgt * 3 + 120; sc.updateProjectionMatrix(); BLD.sun.position.set(hgt * .6 + 20, hgt * 1.2 + 30, hgt * .8 + 20);
  bldHl(); bldPanels();
}
function bldHl() { // glow around the selected part
  const it = BLD.sel >= 0 && BLD.st && BLD.st.flatMap(S => S.parts).find(p => p.i === BLD.sel && p.k !== 'adapt'), h = BLD.hl;
  if (!it && BLD.sel !== -1) { h.visible = false; return; } h.visible = true;
  const r = it ? (it.r || 1.25) + .25 : 2.75, ya = it ? it.y0 : 21.5, yb = it ? it.y1 : 26.2; h.scale.set(r, yb - ya + .2, r); h.position.y = (ya + yb) / 2 - BLD.y0; }
function bldPick(e) { const cv = $('bldC'), b = cv.getBoundingClientRect(), m = new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
  BLD.ray.setFromCamera(m, BLD.cam); const hit = BLD.ray.intersectObject(BLD.g, true).find(h => h.object.userData.pi !== undefined); if (hit) bldSelect(hit.object.userData.pi); }
function bldRender() {
  if (!BLD.on) return; requestAnimationFrame(bldRender); const cv = $('bldC'), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * BLD.rnd.getPixelRatio()) || cv.height !== Math.round(h * BLD.rnd.getPixelRatio())) { BLD.rnd.setSize(w, h, false); BLD.cam.aspect = w / h; BLD.cam.updateProjectionMatrix(); }
  if (!BLD.drag) BLD.yaw += .0012; BLD.dist += (BLD.tdist - BLD.dist) * .15; BLD.cy += (BLD.tcy - BLD.cy) * .15;
  const c = BLD.cam, d = BLD.dist; c.position.set(Math.sin(BLD.yaw) * Math.cos(BLD.pitch) * d, BLD.cy + Math.sin(BLD.pitch) * d, Math.cos(BLD.yaw) * Math.cos(BLD.pitch) * d); if (c.position.y < 1) c.position.y = 1; c.lookAt(0, BLD.cy, 0);
  BLD.hl.material.opacity = .16 + .08 * Math.sin(performance.now() / 250); BLD.rnd.render(BLD.scene, c);
}

// ---------------- stats: delta-v and thrust-to-weight per stage (bottom stage fires first)
function shipStats(st) { // side boosters burn together with the core above them: that part of the flight uses both engines (and some core fuel)
  const out = []; let tot = 0, totS = 0, carry = 0; const mass = i => st.slice(i).reduce((a, S) => a + S.dry + (S.fuel || 0), 0);
  st.forEach((S, i) => { if (S.cap) return; const m0 = mass(i) - carry, low = i === 0 || (i === 1 && st[0].side), C = st[i + 1];
    if (S.side && S.thrust && S.fuel && C && C.thrust && C.fuel) {
      const mdS = S.thrust / (S.ispV * G0), mdC = C.thrust / (C.ispV * G0), t1 = S.fuel / mdS, fc = Math.min(C.fuel, mdC * t1), T = S.thrust + C.thrust, ispV = T / ((mdS + mdC) * G0), ispS = T / (S.thrust / S.ispS + C.thrust / C.ispS), m1 = m0 - S.fuel - fc;
      const dv = ispV * G0 * Math.log(m0 / m1), dvS = ispS * G0 * Math.log(m0 / m1); tot += dv; totS += low ? dvS : dv; carry = fc;
      out.push({S, i, m0, dv, dvS, twr: (S.thrust * S.ispS / S.ispV + C.thrust * C.ispS / C.ispV) / (m0 * G0), twrM: T / (m0 * 1.63), burn: t1}); return; }
    const f = Math.max(0, (S.fuel || 0) - carry), m1 = m0 - f, ok = S.thrust && f > 0; carry = 0;
    const dv = ok ? S.ispV * G0 * Math.log(m0 / m1) : 0, dvS = ok ? S.ispS * G0 * Math.log(m0 / m1) : 0; tot += dv; totS += low ? dvS : dv;
    out.push({S, i, m0, dv, dvS, twr: ok ? S.thrust * S.ispS / S.ispV / (m0 * G0) : 0, twrM: ok ? S.thrust / (m0 * 1.63) : 0, burn: ok ? f / (S.thrust / (S.ispV * G0)) : 0}); });
  return {rows: out, tot, totS, mass: mass(0), h: 26.1 - Math.min(...st.filter(S => !S.cap).map(S => S.y0), 21.6)};
}

// ---------------- panels
function partStat(p) { return p.cat === 'tank' ? (p.fuel / 1000) + ' t fuel · ' + ((p.fuel + p.dry) / 1000).toFixed(1) + ' t' : p.cat === 'engine' ? Math.round(p.thrust / 1000) + ' kN · Isp ' + p.ispS + '/' + p.ispV + ' s · ' + (p.dry / 1000).toFixed(2) + ' t'
  : p.cat === 'srb' ? Math.round(p.thrust / 1000) + ' kN · ' + Math.round(p.fuel * p.ispS * G0 / p.thrust) + ' s burn · ' + ((p.fuel + p.dry) / 1000).toFixed(1) + ' t' : (p.dry / 1000).toFixed(2) + ' t'; }
const SWATCH = {base: ['#f1f0ec', '#d9dde2', '#8d949c', '#2a2d33', '#e8d9b5', '#c9302c', '#2f6fd6', '#2f8f5b', '#f2b81e', '#6b3fa0'],
  acc: ['#17191d', '#ffffff', '#c9302c', '#2f6fd6', '#f2b81e', '#2f8f5b', '#6b3fa0', '#ff8a1e', '#8d949c', '#7a1f1f'],
  trim: ['#ff8a1e', '#f2b81e', '#c9302c', '#2f6fd6', '#5fd38a', '#ffffff', '#17191d', '#e04fa0'], cap: ['#dcdfe3', '#f1f0ec', '#2a2d33', '#c9302c', '#2f6fd6', '#f2b81e', '#9aa3ad', '#2f8f5b']};
function bldCatalog() {
  const cats = [['tank', 'Fuel tanks'], ['engine', 'Engines'], ['srb', 'Solid boosters'], ['struct', 'Structure']]; let h = '';
  for (const [c, t] of cats) { h += '<div class="bt">' + t + '</div>'; for (const k in PARTS) { const p = PARTS[k]; if (p.cat !== c) continue;
      h += '<button class="bp" data-add="' + k + '" title="' + p.desc + '"><i class="ic ic-' + c + '" style="--w:' + Math.round((p.r || .9) * 10) + 'px;--h:' + Math.round(Math.min(p.h || 1, 6) * 5 + 6) + 'px"></i><span><b>' + p.name + '</b><small>' + partStat(p) + '</small></span></button>'; } }
  h += '<div class="bt">On the selected part</div>';
  for (const k in RADIAL) h += '<button class="bp" data-rad="' + k + '" title="' + RADIAL[k].desc + '"><i class="ic ic-' + k + '"></i><span><b>' + RADIAL[k].name + '</b><small>' + RADIAL[k].desc + ' · ' + (RADIAL[k].dry / 1000).toFixed(2) + ' t</small></span></button>';
  h += '<div class="bt">Side boosters on the selected part</div><div class="bseg" id="bSideN">' + [2, 3, 4].map(n => '<button data-sn="' + n + '">' + n + '×</button>').join('') + '<button data-sn="0" title="Remove the side boosters">None</button></div>';
  for (const k in SIDE_PRESETS) { const sp = SIDE_PRESETS[k], ps = sp.parts.map(q => PARTS[q.k]), eng = ps.find(q => q.thrust), fuel = ps.reduce((a, q) => a + (q.fuel || 0), 0);
    h += '<button class="bp" data-side="' + k + '"><i class="ic ic-' + (eng && eng.cat === 'srb' ? 'srb' : 'tank') + '" style="--w:' + Math.round(ps[ps.length - 1].r * 10) + 'px;--h:26px"></i><span><b>' + sp.name + '</b><small>each ' + Math.round(eng.thrust / 1000) + ' kN · ' + (fuel / 1000).toFixed(1) + ' t fuel</small></span></button>'; }
  h += '<div class="bt">Paint</div><div id="bldPaint"></div>';
  $('bldParts').innerHTML = h;
  $('bldParts').querySelectorAll('[data-side]').forEach(b => b.onclick = () => bldSide(b.dataset.side));
  $('bldParts').querySelectorAll('[data-sn]').forEach(b => b.onclick = () => bldSideN(+b.dataset.sn));
  bldPaintUI();
  $('bldParts').querySelectorAll('[data-add]').forEach(b => b.onclick = () => bldAdd(b.dataset.add));
  $('bldParts').querySelectorAll('[data-rad]').forEach(b => b.onclick = () => bldRadial(b.dataset.rad));
}
function bldPanels() {
  const st = BLD.st, s = shipStats(st), sel = BLD.parts[BLD.sel];
  // stack, grouped by stage (top of the list = top of the rocket), KSP order: stage 1 fires first
  let h = '<div class="bs' + (BLD.sel === -1 ? ' on' : '') + '" data-i="-1"><b>Capsule</b><small>3 seats · parachute · ' + (CAPSULE.dry / 1000).toFixed(1) + ' t</small></div>';
  for (let si = st.length - 2; si >= 0; si--) { const S = st[si], r = s.rows.find(x => x.i === si);
    h += '<div class="bsg">Stage ' + (si + 1) + ' · ' + S.name + (r && r.dv ? ' <em>' + Math.round(r.dv) + ' m/s</em>' : '') + '</div>';
    if (S.side) { const nm = S.side.items.filter(x => x.p).map(x => x.p.name).join(' + '); h += '<div class="bs' + (S.side.at === BLD.sel ? ' on' : '') + '" data-i="' + S.side.at + '"><b>' + S.side.n + '× side boosters</b><small>' + nm + '</small></div>'; continue; }
    for (const it of S.parts) { if (it.k === 'adapt') continue; const d = it.d, tags = [d.fins ? 'fins' : '', d.bigfins ? 'big fins' : '', d.legs ? 'legs' : '', d.rcs ? 'RCS' : '', d.side ? d.side.n + '× side boosters' : '', it.inter ? 'interstage' : '', it.blocked ? '<span class="bad">blocked</span>' : ''].filter(Boolean).join(' · ');
      h += '<div class="bs' + (it.i === BLD.sel ? ' on' : '') + '" data-i="' + it.i + '"><b>' + it.p.name + '</b><small>' + (tags || partStat(it.p)) + '</small></div>'; } }
  if (!BLD.parts.length) h += '<div class="bsg">Pick tanks and an engine on the left: they go under the selected part</div>';
  $('bldStack').innerHTML = h; $('bldStack').querySelectorAll('.bs').forEach(e => e.onclick = () => bldSelect(+e.dataset.i));
  // numbers
  const twr0 = s.rows[0] ? s.rows[0].twr : 0, warn = st.flatMap(S => S.warn);
  if (!s.rows.length || !s.rows[0].dv) warn.unshift('The bottom stage needs an engine and fuel to leave the pad');
  else if (twr0 < 1) warn.unshift('Too heavy to lift off: thrust-to-weight ' + twr0.toFixed(2) + ' (needs over 1, 1.3+ is comfy)');
  for (const S of st) if (S.legs && S.legFoot > S.y0 + .05) warn.push('Landing legs on ' + S.name.toLowerCase() + ' sit too high to reach the ground: put them on the lowest tank');
  let n = '<div class="bnum"><div><span>Mass</span><b>' + (s.mass / 1000).toFixed(1) + ' t</b></div><div><span>Height</span><b>' + s.h.toFixed(1) + ' m</b></div><div><span>Δv (space)</span><b>' + (s.tot / 1000).toFixed(2) + ' km/s</b></div><div><span>Lift-off TWR</span><b class="' + (twr0 < 1 ? 'bad' : twr0 < 1.2 ? 'amb' : '') + '">' + twr0.toFixed(2) + '</b></div></div>';
  n += '<table class="btab"><tr><th>Stage</th><th>Δv</th><th>TWR Home</th><th>TWR Moon</th><th>Burn</th></tr>';
  for (const r of s.rows.slice().reverse()) n += '<tr><td>' + (r.i + 1) + ' ' + r.S.name + '</td><td>' + (r.dv ? Math.round(r.dv) : '—') + '</td><td class="' + (r.i === 0 && r.twr < 1 ? 'bad' : '') + '">' + (r.twr ? r.twr.toFixed(2) : '—') + '</td><td>' + (r.twrM ? r.twrM.toFixed(1) : '—') + '</td><td>' + (r.burn ? fmtS(r.burn) : '—') + '</td></tr>';
  n += '</table><div class="bneed">' + DV_NEED.map(([t, v]) => '<span class="' + (s.tot >= v ? 'ok' : '') + '">' + t + ' ≈ ' + (v / 1000).toFixed(1) + '</span>').join('') + '</div>';
  if (warn.length) n += '<div class="bwarn">' + warn.map(w => '<div>⚠ ' + w + '</div>').join('') + '</div>';
  $('bldNum').innerHTML = n;
  // radial buttons light up when the selected part has them
  $('bldParts').querySelectorAll('[data-rad]').forEach(b => { b.classList.toggle('on', !!(sel && sel[b.dataset.rad])); b.disabled = !sel || PARTS[sel.k].k === 'dec' || (b.dataset.rad === 'legs' && PARTS[sel.k].cat !== 'tank'); });
  const sideOk = sel && PARTS[sel.k].k !== 'dec'; $('bldParts').querySelectorAll('[data-side]').forEach(b => { b.disabled = !sideOk; b.classList.toggle('on', !!(sel && sel.side && sel.side.pre === b.dataset.side)); });
  $('bldParts').querySelectorAll('[data-sn]').forEach(b => { const n = +b.dataset.sn; b.classList.toggle('on', sel && sel.side ? sel.side.n === n : n === BLD.sideN); b.disabled = !sideOk; });
  $('bldSel').textContent = BLD.sel === -1 ? 'Capsule selected: new parts go right under it' : sel ? PARTS[sel.k].name + ' selected · new parts go under it · Del removes · Shift+↑↓ moves' : '';
  $('bldGo').disabled = R.st === 'fly' && G.on; $('bldGo').title = $('bldGo').disabled ? 'Land (or crash) first' : '';
  bldShips();
}
function bldShips() { const sv = shipsSaved(), sel = $('bldLoad'), cur = sel.value;
  sel.innerHTML = '<option value="">Load a design…</option><optgroup label="Ready-made">' + Object.keys(SHIP_PRESETS).map(k => '<option value="p:' + k + '">' + k + '</option>').join('') + '</optgroup>'
    + (Object.keys(sv).length ? '<optgroup label="Saved">' + Object.keys(sv).map(k => '<option value="s:' + k.replace(/"/g, '&quot;') + '">' + k.replace(/</g, '&lt;') + '</option>').join('') + '</optgroup>' : '');
  sel.value = cur; $('bldDel').classList.toggle('hidden', !cur.startsWith('s:')); }

// ---------------- editing
function bldPush() { BLD.hist.push(JSON.stringify(BLD.parts)); if (BLD.hist.length > 60) BLD.hist.shift(); }
function bldSelect(i) { BLD.sel = i; bldHl(); bldPanels(); const it = BLD.st.flatMap(S => S.parts).find(p => p.i === i); if (it) BLD.tcy = clamp((it.y0 + it.y1) / 2 - BLD.y0, BLD.lo, BLD.hi); }
function bldAdd(k) { if (BLD.parts.length >= 40) { showHint('That is plenty of parts', 2000); return; } bldPush(); const at = BLD.sel + 1; BLD.parts.splice(at, 0, {k}); BLD.sel = at; bldRebuild(); sfx && SND.c && sfx('pop'); }
function bldRadial(k) { const p = BLD.parts[BLD.sel]; if (!p) { showHint('Select a tank first', 1800); return; } bldPush();
  if (k === 'legs' && !p.legs) for (const q of BLD.parts) q.legs = 0; // one set of legs per rocket keeps G simple
  p[k] = p[k] ? 0 : 1; bldRebuild(); }
function bldStageOf(i) { return BLD.st ? BLD.st.find(S => S.parts.some(it => it.i === i)) : null; }
function bldSide(k) { const p = BLD.parts[BLD.sel]; if (!p || PARTS[p.k].k === 'dec') { showHint('Select a tank in the stage they should help lift', 2200); return; } bldPush();
  const S = bldStageOf(BLD.sel); if (S) for (const it of S.parts) if (it.d && it.d !== p) delete it.d.side; // one set per stage
  p.side = {n: p.side ? p.side.n : BLD.sideN, pre: k, parts: SIDE_PRESETS[k].parts.map(q => ({...q}))}; const last = p.side.parts[p.side.parts.length - 1]; if (PARTS[last.k].h > 3) last.fins = 1; bldRebuild(); }
function bldSideN(n) { const p = BLD.parts[BLD.sel]; if (n) BLD.sideN = n; if (!p || !p.side) { if (!n) return; bldPanels(); return; } bldPush(); if (!n) delete p.side; else p.side.n = n; bldRebuild(); }
function bldPaintUI() { const P = BLD.paint, row = (key, label) => '<div class="bpr"><span>' + label + '</span>' + SWATCH[key].map(c => '<button class="sw' + (P[key] === c ? ' on' : '') + '" data-pk="' + key + '" data-pc="' + c + '" style="background:' + c + '"></button>').join('') + '</div>';
  $('bldPaint').innerHTML = row('base', 'Body') + row('acc', 'Marks') + row('trim', 'Trim') + row('cap', 'Capsule')
    + '<div class="bseg">' + PAINT_PATS.map(([k, t]) => '<button data-pp="' + k + '" class="' + (P.pat === k ? 'on' : '') + '">' + t + '</button>').join('') + '</div>'
    + '<input id="bldText" type="text" maxlength="12" placeholder="Name on the tanks" value="' + (P.text || '').replace(/"/g, '&quot;') + '">';
  $('bldPaint').querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { P[b.dataset.pk] = b.dataset.pc; bldPaintUI(); bldRebuild(); });
  $('bldPaint').querySelectorAll('[data-pp]').forEach(b => b.onclick = () => { P.pat = b.dataset.pp; bldPaintUI(); bldRebuild(); });
  $('bldText').oninput = () => { P.text = $('bldText').value.toUpperCase(); clearTimeout(BLD.tT); BLD.tT = setTimeout(bldRebuild, 350); }; }
function bldDel() { if (BLD.sel < 0) return; bldPush(); BLD.parts.splice(BLD.sel, 1); BLD.sel = Math.min(BLD.sel, BLD.parts.length - 1); if (BLD.sel < 0 && BLD.parts.length) BLD.sel = 0; if (!BLD.parts.length) BLD.sel = -1; bldRebuild(); }
function bldMove(d) { const i = BLD.sel, j = i + d; if (i < 0 || j < 0 || j >= BLD.parts.length) return; bldPush(); [BLD.parts[i], BLD.parts[j]] = [BLD.parts[j], BLD.parts[i]]; BLD.sel = j; bldRebuild(); }
function bldUndo() { const h = BLD.hist.pop(); if (!h) return; BLD.parts = JSON.parse(h); BLD.sel = Math.min(BLD.sel, BLD.parts.length - 1); bldRebuild(); }
function bldSet(parts, name, paint) { bldPush(); BLD.parts = cloneParts(parts); if (paint) { BLD.paint = Object.assign({}, PAINT0, paint); bldPaintUI(); } if (name) { BLD.name = name; $('bldName').value = name; } BLD.sel = BLD.parts.length ? BLD.parts.length - 1 : -1; bldRebuild(); BLD.tdist = clamp(BLD.hi * 2.4, 24, 260); BLD.tcy = BLD.hi * .5; }

// ---------------- open / close / launch
function bldOpen() {
  if (BLD.on) return; BLD.on = true; BLD.wasOn = G.on; BLD.wasPaused = G.paused; G.paused = true; for (const k in keys) keys[k] = false; if (document.pointerLockElement) document.exitPointerLock();
  if (typeof setPause === 'function') $('pause').classList.add('hidden'); if (SND.c) { try { SND.c.suspend(); } catch (e) {} }
  bldInit(); bldCatalog(); BLD.hist = []; BLD.parts = cloneParts(SHIP.parts); BLD.paint = Object.assign({}, PAINT0, SHIP.paint); bldPaintUI(); BLD.name = SHIP.name; $('bldName').value = SHIP.name; BLD.sel = BLD.parts.length - 1;
  $('bld').classList.remove('hidden'); bldRebuild(); BLD.dist = BLD.tdist = clamp(BLD.hi * 2.4, 24, 260); BLD.cy = BLD.tcy = BLD.hi * .5; requestAnimationFrame(bldRender);
}
function bldClose() { if (!BLD.on) return; BLD.on = false; applyCapPaint(); $('bld').classList.add('hidden'); G.paused = false; if (!G.on) return;
  if (SND.c) { try { SND.c.resume(); } catch (e) {} } G.pauseAt = performance.now(); lockPointer(); }
function bldSaveCur() { try { localStorage.setItem('ye-ship', JSON.stringify({name: SHIP.name, parts: SHIP.parts, paint: SHIP.paint})); } catch (e) {} }
function bldLaunch() {
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
$('bldSave').onclick = () => { const nm = ($('bldName').value || '').trim().slice(0, 24) || 'My rocket'; const sv = shipsSaved(); sv[nm] = {parts: BLD.parts, paint: BLD.paint}; try { localStorage.setItem(SHIPS_K, JSON.stringify(sv)); } catch (e) {} BLD.name = nm; bldShips(); $('bldLoad').value = 's:' + nm; bldShips(); showHint('Saved "' + nm + '"', 1800); };
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
  if (k === 'Escape' || k === 'KeyB') bldClose();
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); bldDel(); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const d = k === 'ArrowUp' ? -1 : 1; if (e.shiftKey) bldMove(d); else bldSelect(clamp(BLD.sel + d, -1, BLD.parts.length - 1)); }
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
