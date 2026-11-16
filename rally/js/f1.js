'use strict';
// James Racing: game loop, race rules, renderer (circuit, cars, cockpit, mirrors), sound and HUD.
(() => {
  const TEAMS = [
    { name: 'James Racing', c: 0x15171c, c2: 0xd9a419, drivers: [null, 'Alex Kerr'] },
    { name: 'Rossa Veloce', c: 0xb80f24, c2: 0xf0d000, drivers: ['Luca Bassani', 'Theo Marchetti'] },
    { name: 'Nordlicht', c: 0xaab3bd, c2: 0x00a39a, drivers: ['Niko Halvorsen', 'Oscar Lindqvist'] },
    { name: 'Blue Comet', c: 0x1c2c74, c2: 0xe53a2a, drivers: ['Raf Delacroix', 'Kenji Morita'] },
    { name: 'Apex Papaya', c: 0xff7b00, c2: 0x2c7fe0, drivers: ['Sam Okafor', 'Mateo Ruiz'] },
  ];
  const DIFF = [0.86, 0.925, 0.97];
  const DEF = { mode: 'race', circuit: '0', laps: '5', diff: '1', grid: '1', comp: 'M', auto: '1', abs: '1', tc: '1', sa: '1', line: '0', gfx: '1', fov: 58, name: '' };
  let SET = Object.assign({}, DEF); try { Object.assign(SET, JSON.parse(localStorage.getItem('jr-set') || '{}')); } catch (e) { }
  const save = () => { try { localStorage.setItem('jr-set', JSON.stringify(SET)); } catch (e) { } };
  const bestKey = ci => 'jr-best-' + F1T.CIRCUITS[ci].id;
  const getBest = ci => { try { return +localStorage.getItem(bestKey(ci)) || 0; } catch (e) { return 0; } };
  const fmtL = t => { if (!(t > 0)) return '-:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ================= renderer =================
  const canvas = $('gl');
  const R = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const SKY_H = new THREE.Color(0xc9dcec), SKY_Z = new THREE.Color(0x3d78c0);
  scene.fog = new THREE.Fog(SKY_H.getHex(), 500, 4200);
  const cam = new THREE.PerspectiveCamera(58, 1, 0.04, 9000); cam.rotation.order = 'YXZ';
  const chase = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  const resize = () => { const w = innerWidth, h = innerHeight; R.setPixelRatio(Math.min(devicePixelRatio, SET.gfx === '1' ? 1.5 : 1)); R.setSize(w, h, false); for (const c of [cam, chase]) { c.aspect = w / h; c.updateProjectionMatrix(); } };
  addEventListener('resize', resize);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x56633f, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1); sun.castShadow = true; scene.add(sun); scene.add(sun.target);
  const SUN_DIR = V3(-0.45, 0.72, 0.52).normalize();
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70; sun.shadow.camera.near = 1; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  // sky dome
  { const g = new THREE.SphereGeometry(8000, 32, 16), m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { h: { value: SKY_H }, z: { value: SKY_Z }, s: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 h; uniform vec3 z; uniform vec3 s; varying vec3 vp; void main(){ float t = clamp(vp.y,0.,1.); vec3 c = mix(h, z, pow(t,0.55)); float d = max(dot(vp, s), 0.); c += vec3(1.,.9,.7) * (pow(d, 600.) * 3. + pow(d, 12.) * .25); if (vp.y < 0.) c = h * .92; gl_FragColor = vec4(c,1.); }' });
    const sky = new THREE.Mesh(g, m); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky); scene.userData.sky = sky; }

  // ---- procedural textures ----
  const ctex = (w, h, fn, rep) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = rep === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const rnd = mulberry(7);
  const noiseFill = (x, w, h, base, amp, size) => { const id = x.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < w * h; i++) { const n = (rnd() - 0.5) * amp; for (let k = 0; k < 3; k++) d[i * 4 + k] = clamp(base[k] + n * (size || 1), 0, 255); d[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); };
  const TEX = {};
  TEX.tar = ctex(256, 256, (x, w, h) => { noiseFill(x, w, h, [200, 200, 202], 70); for (let i = 0; i < 900; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.2)'; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); } });
  TEX.grass = ctex(256, 256, (x, w, h) => { noiseFill(x, w, h, [120, 165, 80], 34); x.fillStyle = 'rgba(255,255,230,.07)'; x.fillRect(0, 0, w / 2, h); for (let i = 0; i < 1400; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(30,60,10,.18)' : 'rgba(200,230,140,.12)'; x.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 3); } });
  TEX.gravel = ctex(256, 256, (x, w, h) => { noiseFill(x, w, h, [205, 190, 160], 40); for (let i = 0; i < 2600; i++) { const v = 120 + rnd() * 120; x.fillStyle = `rgb(${v},${v * 0.93 | 0},${v * 0.8 | 0})`; x.beginPath(); x.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 1.6, 0, 7); x.fill(); } });
  TEX.fence = ctex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = 'rgba(150,155,162,1)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke(); x.fillStyle = '#555a60'; x.fillRect(0, 0, 3, h); });
  TEX.crowd = ctex(512, 64, (x, w, h) => { x.fillStyle = '#2a2d33'; x.fillRect(0, 0, w, h); const cols = ['#d33', '#fff', '#333', '#26c', '#fc3', '#f80', '#0a6', '#c9c', '#eee', '#a22']; for (let r = 0; r < 8; r++) for (let i = 0; i < 128; i++) { if (rnd() < 0.12) continue; x.fillStyle = cols[(rnd() * cols.length) | 0]; x.fillRect(i * 4 + rnd(), r * 8 + 2, 3, 4); x.fillStyle = '#e0b896'; x.fillRect(i * 4 + 0.5, r * 8, 2, 2); } x.fillStyle = 'rgba(0,0,0,.35)'; for (let r = 0; r < 8; r++) x.fillRect(0, r * 8 + 7, w, 1); });
  TEX.garage = ctex(512, 128, (x, w, h) => { x.fillStyle = '#e9ecef'; x.fillRect(0, 0, w, h); for (let i = 0; i < 5; i++) { x.fillStyle = '#' + TEAMS[i].c.toString(16).padStart(6, '0'); x.fillRect(i * 102 + 6, 30, 90, 98); x.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 9; k++) x.fillRect(i * 102 + 6, 34 + k * 10, 90, 2); x.fillStyle = '#111'; x.font = 'bold 13px system-ui'; x.fillText(TEAMS[i].name.toUpperCase(), i * 102 + 8, 22); } });
  TEX.banner = ctex(512, 64, (x, w, h) => { x.fillStyle = '#c40b0b'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = 'italic 900 40px system-ui'; x.fillText('JAMES RACING', 18, 46); x.fillText('JAMES RACING', 286, 46); });
  const M = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0 }, o));

  // ================= circuit =================
  let T = null, world = null, lineMesh = null, gantryLamps = [];
  function band(on, a, b, yf, col, sub, uvS) {
    const pos = [], cl = [], uv = [], N = T.N;
    for (let i = 0; i < N; i++) {
      if (!on(i)) continue; const j = T.wi(i + 1);
      for (let k = 0; k < sub; k++) {
        const t0 = k / sub, t1 = (k + 1) / sub;
        const P = (ii, t) => { const l = lerp(a(ii), b(ii), t); return [T.X[ii] + T.nx[ii] * l, yf(ii, l, t), T.Z[ii] + T.nz[ii] * l, l, ii]; };
        const A = P(i, t0), B = P(i, t1), C = P(j, t0), D = P(j, t1);
        for (const p of [A, B, C, B, D, C]) { pos.push(p[0], p[1], p[2]); const c = col(i, p[3], p[4]); cl.push(c[0], c[1], c[2]); uv.push(p[0] / uvS, p[2] / uvS); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nr = new Float32Array(pos.length); for (let i = 1; i < nr.length; i += 3) nr[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); return g;
  }
  function wall(on, d, y0, y1, col, uvS) {
    const pos = [], cl = [], uv = [], N = T.N; let s = 0;
    for (let i = 0; i < N; i++) {
      const j = T.wi(i + 1), seg = T.ds; if (!on(i) || !on(j)) { s += seg; continue; }
      const P = (ii) => [T.X[ii] + T.nx[ii] * d(ii), T.Z[ii] + T.nz[ii] * d(ii)];
      const a = P(i), b = P(j), sl = Math.hypot(b[0] - a[0], b[1] - a[1]); if (sl > 8) { s += seg; continue; }
      const q = [[a, y0, s], [b, y0, s + sl], [a, y1, s], [b, y0, s + sl], [b, y1, s + sl], [a, y1, s]];
      for (const [p, y, ss] of q) { pos.push(p[0], y, p[1]); const c = col(i, y); cl.push(c[0], c[1], c[2]); uv.push(ss / uvS, y / uvS); }
      s += sl;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
  }
  function buildWorld(ci) {
    if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    T = F1T.build(ci); world = new THREE.Group(); scene.add(world); gantryLamps = [];
    const hw = T.hw, N = T.N, add = (g, m, sh) => { const o = new THREE.Mesh(g, m); o.receiveShadow = true; if (sh) o.castShadow = true; world.add(o); return o; };
    const hi = SET.gfx === '1';
    // ground
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < N; i++) { x0 = Math.min(x0, T.X[i]); x1 = Math.max(x1, T.X[i]); z0 = Math.min(z0, T.Z[i]); z1 = Math.max(z1, T.Z[i]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; T.box = { x0, x1, z0, z1, cx, cz };
    { const g = new THREE.PlaneGeometry(9000, 9000, 120, 120).rotateX(-Math.PI / 2).translate(cx, -0.12, cz), t = TEX.grass.clone(); t.needsUpdate = true; t.repeat.set(9000 / 26, 9000 / 26); add(g, M({ map: t, roughness: 0.95 })); }
    // distant hills
    { const g = new THREE.BufferGeometry(), pos = [], n = 96, R0 = 3600; const hn = makeNoise(3);
      const ring = []; for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, hgt = 120 + 260 * (0.5 + 0.5 * hn.fbm(k * 0.18, 0.5, 3)); ring.push([cx + Math.cos(a) * R0, hgt, cz + Math.sin(a) * R0, cx + Math.cos(a) * (R0 - 900), cz + Math.sin(a) * (R0 - 900)]); }
      for (let k = 0; k < n; k++) { const A = ring[k], B = ring[k + 1]; pos.push(A[3], 0, A[4], A[0], A[1], A[2], B[3], 0, B[4], B[3], 0, B[4], A[0], A[1], A[2], B[0], B[1], B[2]); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, M({ color: 0x6f8a6a, roughness: 1, side: THREE.DoubleSide })); world.add(m); }
    // tarmac with a rubbered-in racing line and darker braking zones
    const tarM = M({ map: TEX.tar, vertexColors: true, roughness: 0.88 });
    const tc = (i, l) => { const r = Math.abs(l - T.L[i]), rub = Math.max(0, 1 - r / 1.6) * 0.32, brk = T.V[T.wi(i + 20)] < T.V[i] - 6 ? 0.05 : 0; const v = 0.42 * (1 - rub - brk); return [v, v, v * 1.03]; };
    add(band(() => true, () => -hw, () => hw, () => 0.03, tc, 14, 5), tarM);
    // white edge lines and start line
    const white = M({ color: 0xf4f4f4, roughness: 0.7 });
    for (const s of [-1, 1]) add(band(() => true, i => s > 0 ? hw - 0.32 : -hw + 0.12, i => s > 0 ? hw - 0.12 : -hw + 0.32, () => 0.034, () => [1, 1, 1], 1, 4), white);
    const across = (i, w, m) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, hw * 2).rotateX(-Math.PI / 2), m); o.position.set(T.X[i], 0.037, T.Z[i]); o.rotation.y = -T.H[i]; world.add(o); };
    across(0, 0.5, white);
    // kerbs: red/white, sloped up to the outside
    const kerbM = M({ vertexColors: true, roughness: 0.55 });
    for (const s of [-1, 1]) add(band(i => T.kerb[i], () => s * hw, () => s * (hw + 1.3), (ii, l, t) => 0.035 + Math.abs(t) * 0.05, (i) => Math.floor(i * T.ds / 2.5) % 2 ? [0.85, 0.05, 0.04] : [0.95, 0.95, 0.95], 1, 4), kerbM);
    // run-off: painted tarmac strip, then gravel traps or grass
    const roM = M({ map: TEX.tar, vertexColors: true, roughness: 0.9 }), grM = M({ map: TEX.gravel, vertexColors: true, roughness: 1 });
    for (const s of [-1, 1]) {
      const isG = i => (T.gravel[i] === 1 && s < 0) || (T.gravel[i] === 2 && s > 0), inner = i => hw + (T.kerb[i] ? 1.3 : 0.0), bar = i => s < 0 ? T.barL[i] : T.barR[i];
      add(band(() => true, i => s * inner(i), i => s * Math.min(bar(i), isG(i) ? hw + 2.5 : hw + 3.5), () => 0.027, () => [0.36, 0.38, 0.42], 1, 5), roM);
      add(band(i => isG(i), i => s * (hw + 2.5), i => s * (bar(i) - 0.2), () => 0.022, () => [0.9, 0.86, 0.76], 3, 3), grM);
      // green-painted strip beyond the run-off where there's no gravel
      add(band(i => !isG(i), i => s * (hw + 3.5), i => s * Math.min(bar(i), hw + 6), () => 0.024, () => [0.18, 0.42, 0.24], 1, 5), roM);
    }
    // barriers: armco with a catch fence above, tyre walls in the gravel traps, concrete pit wall
    const armM = M({ vertexColors: true, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), fenM = M({ map: TEX.fence, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4, color: 0x9aa0a8 });
    const pitI = i => T.pit[i] === 1;
    for (const s of [-1, 1]) {
      const d = i => s < 0 ? -T.barL[i] : T.barR[i];
      add(wall(i => !(s < 0 && pitI(i)), d, 0, 0.95, (i, y) => y > 0.5 ? [0.75, 0.77, 0.8] : (Math.floor(i * T.ds / 4) % 2 && (T.gravel[i] === (s < 0 ? 1 : 2)) ? [0.8, 0.1, 0.1] : [0.62, 0.64, 0.67]), 4), armM, true);
      if (hi) add(wall(() => true, i => d(i) + s * 0.05, 0.95, 3.6, () => [1, 1, 1], 1.2), fenM);
      // tyre wall in front of the armco at gravel traps
      add(wall(i => T.gravel[i] === (s < 0 ? 1 : 2), i => d(i) - s * 0.5, 0, 0.8, (i, y) => [0.08, 0.08, 0.09], 2), M({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), true);
    }
    add(wall(pitI, i => -T.barL[i], 0, 1.15, () => [0.86, 0.86, 0.84], 3), M({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), true);
    // pit lane and garages along the main straight
    add(band(pitI, i => -(hw + 18), i => -(hw + 4.2), () => 0.028, () => [0.38, 0.38, 0.4], 2, 5), tarM);
    { const cnt = (T.pitB - T.pitA + N) % N, len = cnt * T.ds, mid = T.at(T.wi(T.pitA + cnt / 2) * T.ds), off = hw + 24;
      const gx = mid.x + Math.sin(mid.h) * off, gz = mid.z - Math.cos(mid.h) * off;
      const bld = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 12));
      bld.geometry.translate(0, 4.5, 0); bld.position.set(gx, 0, gz); bld.rotation.y = -mid.h; bld.castShadow = bld.receiveShadow = true; world.add(bld);
      // the face toward the track is +z of the box (rotated): material index 4 is +z, 5 is -z
      bld.material = [M({ color: 0xd6dade }), M({ color: 0xd6dade }), M({ color: 0x9aa3ad, metalness: 0.4 }), M({ color: 0xd6dade }), M({ map: (() => { const t = TEX.garage.clone(); t.needsUpdate = true; t.repeat.set(len / 60, 1); return t; })() }), M({ color: 0xd6dade })];
      const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 8).translate(0, 11, 0), M({ color: 0xe2e5e8 })); tower.position.set(gx + Math.sin(mid.h) * 10, 0, gz - Math.cos(mid.h) * 10); tower.castShadow = true; world.add(tower);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3, 8.4).translate(0, 19, 0), M({ color: 0x223344, metalness: 0.8, roughness: 0.15 })); glass.position.copy(tower.position); world.add(glass);
    }
    // grandstands: opposite the pits, at turn one and at the slowest corner
    const stand = (s, side, len, rows) => {
      const p = T.at(s), i = p.i, d = (side > 0 ? T.barR[i] : T.barL[i]) + 6 + rows * 0.45, g = new THREE.Group();
      g.position.set(p.x + T.nx[i] * d * side, 0, p.z + T.nz[i] * d * side); g.rotation.y = -p.h + (side > 0 ? Math.PI : 0);
      const cm = M({ map: (() => { const t = TEX.crowd.clone(); t.needsUpdate = true; t.repeat.set(len / 40, 1); return t; })(), roughness: 0.9 }), conc = M({ color: 0xb8bcc0, roughness: 0.9 });
      for (let r = 0; r < rows; r++) { const st = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55 * (r + 1), 0.9), conc); st.position.set(0, 0.275 * (r + 1), -r * 0.9 + rows * 0.45); st.receiveShadow = true; g.add(st); }
      const face = new THREE.Mesh(new THREE.PlaneGeometry(len, Math.hypot(rows * 0.55, rows * 0.9)), cm); face.position.set(0, (0.55 + rows * 0.55) / 2 + 0.06, 0.02); face.rotation.x = -(Math.PI / 2 - Math.atan2(rows * 0.55, rows * 0.9)); g.add(face);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, rows * 0.9 + 3), M({ color: 0xf2f2f2 })); roof.position.set(0, rows * 0.55 + 4.5, -0.5); roof.castShadow = true; g.add(roof);
      for (let k = -len / 2; k <= len / 2; k += len / 4) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, rows * 0.55 + 4.5, 0.3), conc); post.position.set(k, (rows * 0.55 + 4.5) / 2, -rows * 0.9 + rows * 0.45 - 0.5); g.add(post); }
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), M({ map: (() => { const t = TEX.banner.clone(); t.needsUpdate = true; t.repeat.set(len / 30, 1); return t; })() })); ban.position.set(0, rows * 0.55 + 4.1, rows * 0.45 + 1.0); g.add(ban);
      world.add(g);
    };
    stand(60, 1, 120, 12); stand(220, 1, 90, 10);
    { let mn = 1e9, mi = 0; for (let i = 0; i < N; i++) if (T.V[i] < mn) { mn = T.V[i]; mi = i; } stand(mi * T.ds, T.K[mi] > 0 ? -1 : 1, 70, 9); }
    { const b0 = T.brakes[0]; if (b0 !== undefined) { const i = T.wi(b0 + 40); stand(i * T.ds, T.K[T.wi(i + 20)] > 0 ? -1 : 1, 80, 10); } }
    // start gantry with the five pairs of lights
    { const p = T.at(-1), g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -p.h; const dark = M({ color: 0x1a1c20, metalness: 0.5, roughness: 0.4 });
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5).translate(0, 3.75, 0), dark); post.position.z = sd * (hw + 1.6); post.castShadow = true; g.add(post); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, hw * 2 + 3.6), dark); beam.position.y = 7.2; beam.castShadow = true; g.add(beam);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 3.6, 1.2), M({ map: TEX.banner })); ban.rotation.y = -Math.PI / 2; ban.position.set(-0.41, 8.6, 0); g.add(ban);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 3.4), M({ color: 0x050505 })); back.position.set(-0.55, 6.6, 0); g.add(back);
      for (let k = 0; k < 5; k++) for (let r = 0; r < 2; r++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: 0x220303 })); l.position.set(-0.72, 6.85 - r * 0.42, -1.3 + k * 0.65); g.add(l); gantryLamps.push({ m: l, k }); }
      world.add(g); }
    // grid slots
    for (let k = 0; k < 10; k++) { const s = -8 - k * 8, p = T.at(s), d = k % 2 ? 2.6 : -2.6, x = p.x + T.nx[p.i] * d, z = p.z + T.nz[p.i] * d;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.2).rotateX(-Math.PI / 2), white); m.position.set(x + Math.cos(p.h) * 3.2, 0.036, z + Math.sin(p.h) * 3.2); m.rotation.y = -p.h; world.add(m);
      for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.2).rotateX(-Math.PI / 2), white); w.position.set(x + Math.cos(p.h) * 2.6 + T.nx[p.i] * sd * 1.05, 0.036, z + Math.sin(p.h) * 2.6 + T.nz[p.i] * sd * 1.05); w.rotation.y = -p.h; world.add(w); } }
    // braking boards (300 / 200 / 100) on the outside before heavy stops
    const boardTex = n => ctex(128, 128, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#111'; x.font = '900 64px system-ui'; x.textAlign = 'center'; x.fillText(n, 64, 86); x.strokeStyle = '#c00'; x.lineWidth = 8; x.strokeRect(4, 4, 120, 120); }, false);
    const BT = { 3: boardTex('3'), 2: boardTex('2'), 1: boardTex('1') };
    for (const b of T.brakes) for (const [n, back] of [[3, 150], [2, 100], [1, 50]]) {
      const i = T.wi(b + Math.round((150 - back) / T.ds)); const sd = T.K[T.wi(i + 40)] > 0 ? -1 : 1, d = sd * (hw + 4.5);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), M({ map: BT[n] })); m.position.set(T.X[i] + T.nx[i] * d, 1.6, T.Z[i] + T.nz[i] * d); m.rotation.y = -T.H[i] - Math.PI / 2; world.add(m);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1).translate(0, 0.45, 0), M({ color: 0xdddddd })); pole.position.set(m.position.x, 0, m.position.z); world.add(pole);
    }
    // DRS lines and signs
    for (const z of T.drs) for (const [i, txt] of [[z.det, 'DRS DETECTION'], [z.a, 'DRS']]) {
      across(i, 0.3, white);
      const t = ctex(256, 64, (x) => { x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#fff'; x.font = '800 30px system-ui'; x.textAlign = 'center'; x.fillText(txt, 128, 44); }, false);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), M({ map: t })); const d = -(hw + 2.2); m.position.set(T.X[i] + T.nx[i] * d, 1.4, T.Z[i] + T.nz[i] * d); m.rotation.y = -T.H[i] - Math.PI / 2; world.add(m);
    }
    // trees on a distance grid
    { const CS = 10, gx0 = x0 - 700, gz0 = z0 - 700, GW = Math.ceil((x1 - x0 + 1400) / CS), GH = Math.ceil((z1 - z0 + 1400) / CS), D = new Float32Array(GW * GH).fill(1e9);
      for (let i = 0; i < N; i += 2) { const ci = Math.floor((T.X[i] - gx0) / CS), cj = Math.floor((T.Z[i] - gz0) / CS); for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) { const u = ci + a, v = cj + b; if (u < 0 || v < 0 || u >= GW || v >= GH) continue; const dd = Math.hypot(gx0 + (u + 0.5) * CS - T.X[i], gz0 + (v + 0.5) * CS - T.Z[i]); if (dd < D[v * GW + u]) D[v * GW + u] = dd; } }
      const pts = []; const r2 = mulberry(11), nT = hi ? 2600 : 1100;
      for (let k = 0; k < nT * 6 && pts.length < nT; k++) { const x = gx0 + r2() * GW * CS, z = gz0 + r2() * GH * CS, u = Math.floor((x - gx0) / CS), v = Math.floor((z - gz0) / CS), dd = D[v * GW + u]; if (dd < 62) continue; if (dd > 1e8 && r2() < 0.75) continue; pts.push([x, z, 0.7 + r2() * 0.7, r2()]); }
      const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6).translate(0, 1.5, 0), crownA = new THREE.ConeGeometry(2.6, 8, 8).translate(0, 7, 0), crownB = new THREE.IcosahedronGeometry(3.4, 1).translate(0, 6, 0);
      const mT = M({ color: 0x5a4330, roughness: 1 }), mA = M({ color: 0x2f5a2c, roughness: 0.9, flatShading: true }), mB = M({ color: 0x4a7a35, roughness: 0.9, flatShading: true });
      const im = (geo, mat, list) => { const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(); list.forEach((p, k) => { o.position.set(p[0], 0, p[1]); o.scale.setScalar(p[2]); o.rotation.y = p[3] * 6; o.updateMatrix(); m.setMatrixAt(k, o.matrix); }); m.castShadow = hi; m.receiveShadow = true; world.add(m); };
      const A = pts.filter(p => p[3] < 0.55), B = pts.filter(p => p[3] >= 0.55); im(trunk, mT, pts); im(crownA, mA, A); im(crownB, mB, B);
    }
    // racing line overlay (rebuilt per assist setting)
    buildLine();
    T.mini = miniPath();
  }
  function buildLine() {
    if (lineMesh) { world.remove(lineMesh); lineMesh.geometry.dispose(); lineMesh = null; }
    if (SET.line === '0' || G.mode === 'menu') return;
    const corners = SET.line === '1';
    const on = i => { if (!corners) return true; for (let k = 0; k < 160; k += 10) if (T.V[T.wi(i + k / T.ds)] < T.V[i] - 8) return true; return T.KS[i] > 1 / 260; };
    const col = (i) => { const dv = T.V[T.wi(i + 12)] - T.V[i]; return dv < -1.5 ? [0.95, 0.12, 0.08] : dv < 0.4 && T.KS[i] > 1 / 400 ? [0.98, 0.8, 0.1] : [0.15, 0.85, 0.3]; };
    lineMesh = new THREE.Mesh(band(on, i => T.L[i] - 0.22, i => T.L[i] + 0.22, () => 0.038, col, 1, 4), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    world.add(lineMesh);
  }
  function miniPath() { const b = T.box, sc = 340 / Math.max(b.x1 - b.x0, b.z1 - b.z0); return { sc, ox: 190 - (b.cx) * sc, oz: 190 - (b.cz) * sc }; }

  // ================= car models =================
  function taper(x0, x1, w0, w1, yb0, yt0, yb1, yt1) { // box tapering from x0 (half-width w0) to x1 (w1)
    const P = [[x0, yb0, -w0], [x0, yb0, w0], [x0, yt0, w0], [x0, yt0, -w0], [x1, yb1, -w1], [x1, yb1, w1], [x1, yt1, w1], [x1, yt1, -w1]];
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]], pos = [];
    for (const f of F) for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...P[f[k]]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }
  const CARMAT = {};
  function makeCar(team, num, comp, mine) {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const key = team.name; if (!CARMAT[key]) CARMAT[key] = { b: M({ color: team.c, metalness: 0.35, roughness: 0.32 }), a: M({ color: team.c2, metalness: 0.3, roughness: 0.35 }) };
    const mb = CARMAT[key].b, ma = CARMAT[key].a, cf = CARMAT.cf || (CARMAT.cf = M({ color: 0x17181c, roughness: 0.45, metalness: 0.2 })), tyreM = CARMAT.ty || (CARMAT.ty = M({ color: 0x0c0c0d, roughness: 0.97 })), rimM = CARMAT.rim || (CARMAT.rim = M({ color: 0x2c2e33, metalness: 0.7, roughness: 0.35 }));
    const add = (geo, m, p) => { const o = new THREE.Mesh(geo, m); if (p) o.position.copy(p); o.castShadow = true; body.add(o); return o; };
    add(new THREE.BoxGeometry(3.5, 0.03, 1.8), cf, V3(-0.15, 0.06, 0)); // floor
    add(taper(1.75, -1.95, 0.55, 0.7, 0.04, 0.06, 0.05, 0.2), cf); // floor edges + diffuser
    add(taper(-0.35, 1.15, 0.38, 0.3, 0.07, 0.62, 0.08, 0.6), mb); // tub
    add(taper(1.15, 2.95, 0.3, 0.1, 0.08, 0.6, 0.1, 0.26), mb); // nose
    add(taper(2.62, 2.98, 0.11, 0.07, 0.1, 0.27, 0.12, 0.2), ma);
    // front wing: two elements + endplates
    add(taper(2.55, 3.08, 0.98, 0.98, 0.07, 0.1, 0.07, 0.1), cf); add(taper(2.45, 2.75, 0.95, 0.92, 0.14, 0.17, 0.2, 0.23), ma);
    for (const s of [-1, 1]) { const e = add(new THREE.BoxGeometry(0.55, 0.26, 0.02), mb, V3(2.75, 0.18, s * 0.98)); }
    // sidepods (coke bottle) and engine cover
    for (const s of [-1, 1]) { const sp = add(taper(0.55, -1.3, 0.25, 0.12, 0.1, 0.58, 0.1, 0.42), mb); sp.position.z = s * 0.6; const inlet = add(new THREE.BoxGeometry(0.04, 0.3, 0.42), cf, V3(0.57, 0.42, s * 0.6)); }
    add(taper(-0.3, -2.0, 0.36, 0.12, 0.1, 0.88, 0.1, 0.48), mb);
    add(taper(-0.25, -0.55, 0.14, 0.14, 0.6, 1.02, 0.6, 0.96), mb); // airbox / roll hoop
    add(new THREE.BoxGeometry(0.02, 0.18, 0.18), cf, V3(-0.245, 0.93, 0));
    add(taper(-0.6, -1.9, 0.02, 0.02, 0.85, 0.98, 0.5, 0.82), ma); // spine fin
    // rear wing, beam wing, DRS flap
    add(taper(-2.12, -2.5, 0.5, 0.5, 0.74, 0.79, 0.76, 0.8), cf);
    const flapP = new THREE.Group(); flapP.position.set(-2.18, 0.84, 0); body.add(flapP); const flap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 1.0).translate(-0.12, 0, 0), ma); flap.castShadow = true; flapP.add(flap); flap.rotation.z = -0.35;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.6, 0.02), mb, V3(-2.3, 0.62, s * 0.51));
    add(new THREE.BoxGeometry(0.3, 0.03, 0.9), cf, V3(-2.15, 0.38, 0)); add(new THREE.BoxGeometry(0.06, 0.45, 0.06), cf, V3(-2.15, 0.55, 0));
    // halo
    const haloM = CARMAT.halo || (CARMAT.halo = M({ color: 0x1d1f24, metalness: 0.5, roughness: 0.35 }));
    const loop = new THREE.CatmullRomCurve3([V3(-0.36, 0.6, -0.31), V3(-0.24, 0.9, -0.3), V3(0.12, 0.965, -0.26), V3(0.38, 0.965, -0.11), V3(0.44, 0.965, 0), V3(0.38, 0.965, 0.11), V3(0.12, 0.965, 0.26), V3(-0.24, 0.9, 0.3), V3(-0.36, 0.6, 0.31)]);
    add(new THREE.TubeGeometry(loop, 40, 0.019, 8), haloM); add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.44, 0.965, 0), V3(0.53, 0.82, 0), V3(0.66, 0.6, 0)]), 10, 0.017, 8), haloM);
    // driver helmet
    const helm = add(new THREE.SphereGeometry(0.135, 16, 12), ma, V3(-0.07, 0.8, 0)); const visor = add(new THREE.SphereGeometry(0.137, 16, 8, -0.9, 1.8, 1.2, 0.5), M({ color: 0x111111, metalness: 0.9, roughness: 0.1 }), V3(-0.07, 0.8, 0));
    if (mine) { helm.visible = false; visor.visible = false; }
    const helmL = [helm, visor];
    // race number on the nose
    { const t = ctex(128, 64, (x) => { x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, 128, 64); x.fillStyle = '#fff'; x.font = 'italic 900 52px system-ui'; x.textAlign = 'center'; x.fillText(num, 64, 52); }, false);
      const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true })); nm.position.set(2.1, 0.47, 0); nm.rotation.z = -0.13; body.add(nm); }
    // wheels
    const wheels = [], cM = new THREE.MeshStandardMaterial({ color: F1.COMP[comp].col, roughness: 0.6 });
    for (const [x, z, w, fr] of [[F1.CA, -0.8, 0.31, 1], [F1.CA, 0.8, 0.31, 1], [-F1.CB, -0.78, 0.4, 0], [-F1.CB, 0.78, 0.4, 0]]) {
      const piv = new THREE.Group(); piv.position.set(x, 0.36, z); g.add(piv); const spin = new THREE.Group(); piv.add(spin);
      const ty = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, w, 28, 1, true).rotateX(Math.PI / 2), tyreM); ty.castShadow = true; spin.add(ty);
      for (const sd of [-1, 1]) { const side = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.36, 28), tyreM); side.position.z = sd * w / 2; if (sd < 0) side.rotation.y = Math.PI; spin.add(side);
        const stripe = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.305, 28), cM); stripe.position.z = sd * (w / 2 + 0.002); if (sd < 0) stripe.rotation.y = Math.PI; spin.add(stripe);
        const rim = new THREE.Mesh(new THREE.CircleGeometry(0.23, 5), rimM); rim.position.z = sd * (w / 2 - 0.03); if (sd < 0) rim.rotation.y = Math.PI; spin.add(rim); }
      // wishbones to the body
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, Math.abs(z) - 0.3).translate(0, 0, -Math.sign(z) * (Math.abs(z) - 0.3) / 2), cf); arm.position.set(x, 0.42, z); g.add(arm);
      const arm2 = arm.clone(); arm2.position.y = 0.26; g.add(arm2);
      wheels.push({ piv, spin, fr });
    }
    g.userData = { wheels, flap, body, spin: 0, helm: helmL };
    return g;
  }
  // cockpit extras for the player's car: steering wheel with a live display, gloves, mirrors fed by a rear camera
  let CK = null;
  function buildCockpit(g) {
    const sw = new THREE.Group(); sw.position.set(0.36, 0.6, 0); sw.rotation.order = 'ZXY'; sw.rotation.z = -0.3; g.add(sw); // tilted towards the driver
    const inner = new THREE.Group(); sw.add(inner);
    const cf = M({ color: 0x141518, roughness: 0.5 }), grip = M({ color: 0x222222, roughness: 0.95 });
    inner.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.2), cf));
    for (const s of [-1, 1]) { const gp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 10), grip); gp.position.set(0, -0.005, s * 0.12); gp.rotation.x = s * 0.15; inner.add(gp);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.027, 10, 8).scale(1.1, 1.4, 0.9), M({ color: 0x2a2a2e, roughness: 0.85 })); glove.position.set(-0.025, 0.01, s * 0.125); inner.add(glove);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8).rotateZ(Math.PI / 2), M({ color: s < 0 ? 0xee3333 : 0x33cc33 })); btn.position.set(-0.02, -0.04, s * 0.06); inner.add(btn); }
    const dc = document.createElement('canvas'); dc.width = 256; dc.height = 140; const dt = new THREE.CanvasTexture(dc); dt.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.082), new THREE.MeshBasicMaterial({ map: dt, toneMapped: false })); disp.rotation.y = -Math.PI / 2; disp.position.set(-0.019, 0.008, 0); inner.add(disp);
    // mirrors
    const rt = new THREE.WebGLRenderTarget(512, 160); rt.texture.colorSpace = THREE.SRGBColorSpace;
    const mcam = new THREE.PerspectiveCamera(22, 512 / 160, 0.3, 1500); mcam.position.set(-0.4, 1.0, 0); mcam.rotation.order = 'YXZ'; mcam.rotation.y = Math.PI / 2; mcam.rotation.x = -0.05; g.add(mcam);
    for (const s of [-1, 1]) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.075, 0.17), M({ color: 0x15171c })); fr.position.set(0.47, 0.66, s * 0.41); g.add(fr);
      const geo = new THREE.PlaneGeometry(0.155, 0.06), uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) { const u = uv.getX(k); uv.setX(k, s < 0 ? 0.5 + (1 - u) * 0.5 : (1 - u) * 0.5); }
      const mm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false })); mm.rotation.y = -Math.PI / 2; mm.position.set(0.454, 0.66, s * 0.41); g.add(mm);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), M({ color: 0x15171c })); st.position.set(0.49, 0.59, s * 0.39); g.add(st);
    }
    // cockpit rim padding
    const pad = M({ color: 0x0e0f12, roughness: 0.9 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.07, 0.07), pad); p.position.set(0.05, 0.63, s * 0.31); g.add(p); }
    CK = { sw, inner, dc, dx: dc.getContext('2d'), dt, rt, mcam, t: 0 };
  }

  // ================= sound =================
  const Snd = {
    C: null, on: true,
    init() {
      if (this.C) { if (this.C.state === 'suspended') this.C.resume(); return; }
      let C; try { C = this.C = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      const out = this.out = C.createGain(); out.gain.value = 0.55; const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; out.connect(comp); comp.connect(C.destination);
      const nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.nb = nb;
      const noise = () => { const s = C.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
      const filt = (type, f, q) => { const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 1; return b; };
      const gain = v => { const g = C.createGain(); g.gain.value = v; return g; };
      // engine: V6 firing order harmonics, distortion, throttle-opened filter
      const ws = C.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * 2.4); } ws.curve = cv;
      this.eo = [['sawtooth', 1, 0.45], ['square', 0.5, 0.28], ['sawtooth', 2, 0.22], ['triangle', 3, 0.12]].map(([ty, m, v]) => { const o = C.createOscillator(); o.type = ty; const g = gain(v); o.connect(g); g.connect(ws); o.start(); return { o, m }; });
      this.elp = filt('lowpass', 2000, 1.2); this.eg = gain(0); ws.connect(this.elp); this.elp.connect(this.eg); this.eg.connect(out);
      this.ebp = filt('bandpass', 1200, 1.4); this.eng = gain(0); noise().connect(this.ebp); this.ebp.connect(this.eng); this.eng.connect(out);
      this.tw = C.createOscillator(); this.tw.type = 'sine'; this.twg = gain(0); this.tw.connect(this.twg); this.twg.connect(out); this.tw.start(); // turbo / MGU-H whistle
      this.kw = C.createOscillator(); this.kw.type = 'sawtooth'; const kwl = filt('lowpass', 3000); this.kwg = gain(0); this.kw.connect(kwl); kwl.connect(this.kwg); this.kwg.connect(out); this.kw.start(); // MGU-K whine
      this.sq = filt('bandpass', 1100, 7); this.sqg = gain(0); noise().connect(this.sq); this.sq.connect(this.sqg); this.sqg.connect(out);
      this.wl = filt('lowpass', 500); this.wg = gain(0); noise().connect(this.wl); this.wl.connect(this.wg); this.wg.connect(out);
      this.kb = C.createOscillator(); this.kb.type = 'square'; const kbl = filt('lowpass', 260); this.kbg = gain(0); this.kb.connect(kbl); kbl.connect(this.kbg); this.kbg.connect(out); this.kb.start();
      this.gv = filt('bandpass', 700, 0.6); this.gvg = gain(0); noise().connect(this.gv); this.gv.connect(this.gvg); this.gvg.connect(out);
      // two voices for the nearest rivals
      this.ov = [0, 1].map(() => { const o1 = C.createOscillator(), o2 = C.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; const l = filt('lowpass', 2200), g = gain(0), p = C.createStereoPanner ? C.createStereoPanner() : gain(1); const g2 = gain(0.4); o1.connect(l); o2.connect(g2); g2.connect(l); l.connect(g); g.connect(p); p.connect(out); o1.start(); o2.start(); return { o1, o2, g, p, l }; });
    },
    set(p, v, tc) { if (this.C && isFinite(v)) p.setTargetAtTime(v, this.C.currentTime, tc || 0.03); },
    frame(c, others, camPos, camQuat, view) {
      if (!this.C || !this.on) return;
      const f = c.rpm / 60 * 3, thr = c.thr, v = c.v, inCk = view < 2;
      for (const e of this.eo) this.set(e.o.frequency, f * e.m, 0.012);
      this.set(this.elp.frequency, 900 + thr * 5200 + c.rpm * 0.2, 0.03); this.set(this.eg.gain, (0.16 + thr * 0.5) * (inCk ? 1 : 0.75), 0.03);
      this.set(this.ebp.frequency, f * 2.2, 0.02); this.set(this.eng.gain, 0.05 + thr * 0.16, 0.04);
      this.set(this.tw.frequency, 2400 + c.rpm * 0.42, 0.05); this.set(this.twg.gain, thr * 0.012 + (c.rpm > 9000 ? 0.006 : 0), 0.1);
      this.set(this.kw.frequency, 60 + v * 14, 0.05); this.set(this.kwg.gain, c.deploying ? 0.03 : c.brk > 0.3 && v > 10 ? 0.02 : 0, 0.08);
      const sl = Math.max(Math.abs(c.aF || 0) - 0.075, Math.abs(c.aR || 0) - 0.07, 0) * 6 + c.lockF * 0.8 + c.lockR * 0.8 + c.spinR * 0.5;
      this.set(this.sq.frequency, c.lockF + c.lockR > 0.3 ? 1500 : 1000, 0.05); this.set(this.sqg.gain, Math.min(0.4, sl * 0.4) * (c.surfF === 0 || c.surfF === 4 ? 1 : 0.2) * Math.min(1, v / 8), 0.04);
      this.set(this.wl.frequency, 300 + v * 9, 0.1); this.set(this.wg.gain, Math.min(0.5, (v / 90) ** 2 * 0.35) * (inCk ? 1 : 0.5), 0.1);
      this.set(this.kb.frequency, Math.max(4, v / 1.25), 0.02); this.set(this.kbg.gain, c.kerb && v > 5 ? 0.35 : 0, 0.02);
      this.set(this.gvg.gain, c.off && v > 2 ? Math.min(0.35, v / 40) : 0, 0.05);
      // rivals: distance, doppler, pan
      const near = others.filter(o => o !== c).map(o => ({ o, d: Math.hypot(o.x - camPos.x, o.z - camPos.z) })).sort((a, b) => a.d - b.d).slice(0, 2);
      this.ov.forEach((vo, k) => {
        const n = near[k]; if (!n || n.d > 300) { this.set(vo.g.gain, 0, 0.1); return; }
        const o = n.o, dx = o.x - camPos.x, dz = o.z - camPos.z, ux = dx / (n.d || 1), uz = dz / (n.d || 1);
        const ow = [o.vx * Math.cos(o.h) - o.vy * Math.sin(o.h), o.vx * Math.sin(o.h) + o.vy * Math.cos(o.h)], cw = [c.vx * Math.cos(c.h) - c.vy * Math.sin(c.h), c.vx * Math.sin(c.h) + c.vy * Math.cos(c.h)];
        const vr = (ow[0] - cw[0]) * ux + (ow[1] - cw[1]) * uz, dop = 343 / (343 + clamp(vr, -150, 150));
        const fo = o.rpm / 60 * 3 * dop; this.set(vo.o1.frequency, fo, 0.02); this.set(vo.o2.frequency, fo * 0.5, 0.02); this.set(vo.l.frequency, 1200 + o.thr * 2500, 0.05);
        this.set(vo.g.gain, (0.05 + o.thr * 0.1) * Math.min(1, 14 / (n.d + 4)) * (inCk ? 0.75 : 1), 0.05);
        if (vo.p.pan) { const fwd = V3(0, 0, -1).applyQuaternion(camQuat), rt = V3(1, 0, 0).applyQuaternion(camQuat); this.set(vo.p.pan, clamp(ux * rt.x + uz * rt.z, -1, 1) * 0.8, 0.05); }
      });
    },
    mute() { if (this.C) { this.set(this.eg.gain, 0, 0.05); this.set(this.eng.gain, 0, 0.05); this.set(this.wg.gain, 0, 0.05); this.set(this.sqg.gain, 0, 0.05); this.set(this.kbg.gain, 0, 0.05); this.set(this.gvg.gain, 0, 0.05); this.set(this.twg.gain, 0, 0.05); this.set(this.kwg.gain, 0, 0.05); for (const v of this.ov) this.set(v.g.gain, 0, 0.05); } },
    hit(m) { if (!this.C) return; const C = this.C, s = C.createBufferSource(); s.buffer = this.nb; const l = C.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = 500 + m * 60; const g = C.createGain(); g.gain.setValueAtTime(Math.min(0.9, m * 0.06), C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.35); s.connect(l); l.connect(g); g.connect(this.out); s.start(); s.stop(C.currentTime + 0.4); },
    beep(f, d) { if (!this.C) return; const C = this.C, o = C.createOscillator(), g = C.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.12, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + (d || 0.15)); o.connect(g); g.connect(this.out); o.start(); o.stop(C.currentTime + (d || 0.15) + 0.02); },
    pop() { if (!this.C) return; const C = this.C, s = C.createBufferSource(); s.buffer = this.nb; const b = C.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 400; b.Q.value = 0.8; const g = C.createGain(); g.gain.setValueAtTime(0.25, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.09); s.connect(b); b.connect(g); g.connect(this.out); s.start(); s.stop(C.currentTime + 0.1); },
  };

  // ================= input =================
  const K = {}; let padPrev = {};
  addEventListener('keydown', e => { K[e.code] = true; Snd.init(); if (G.mode !== 'run') return; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault(); if (e.repeat) return; onKey(e.code); });
  addEventListener('keyup', e => { K[e.code] = false; });
  addEventListener('blur', () => { for (const k in K) K[k] = false; });
  function onKey(c) {
    const me = G.me; if (!me) return;
    if (c === 'Escape') return pause(!G.paused);
    if (G.paused) return;
    if (c === 'KeyE' || c === 'ShiftLeft' || c === 'ShiftRight') { if (!me.auto) me.gearUp(); }
    if (c === 'KeyQ' || c === 'ControlLeft' || c === 'ControlRight') { if (!me.auto) me.gearDown(); }
    if (c === 'KeyV') G.view = (G.view + 1) % 3;
    if (c === 'KeyX') { me.ersMode = (me.ersMode + 1) % 3; toast(['HARVEST', 'BALANCED', 'OVERTAKE'][me.ersMode], 'ERS mode', 1.2); }
    if (c === 'KeyR' && G.state !== 'lights') { F1.reset(me); if (G.mode2 === 'tt') me.lapValid = false; toast('BACK ON TRACK', G.mode2 === 'tt' ? 'lap invalidated' : '', 1.4); }
    if (c === 'KeyM') { Snd.on = !Snd.on; if (!Snd.on) Snd.mute(); }
  }
  const ctl = { st: 0, thr: 0, brk: 0, drs: false };
  function readInput(dt) {
    const me = G.me, v = me.v;
    let st = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0), thr = K.KeyW || K.ArrowUp ? 1 : 0, brk = K.KeyS || K.ArrowDown ? 1 : 0, drs = !!K.Space, analog = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : []; let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (gp) {
      const ax = gp.axes[0] || 0, rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (Math.abs(ax) > 0.06 || rt > 0.03 || lt > 0.03) { analog = true; st = Math.sign(ax) * Math.pow(Math.max(0, Math.abs(ax) - 0.06) / 0.94, 1.4); thr = Math.max(thr, rt); brk = Math.max(brk, lt); }
      const btn = i => gp.buttons[i] && gp.buttons[i].pressed, edge = i => btn(i) && !padPrev[i];
      if ((edge(5) || edge(0)) && !me.auto) me.gearUp(); if ((edge(4) || edge(2)) && !me.auto) me.gearDown();
      if (btn(3)) drs = true; if (edge(1)) G.view = (G.view + 1) % 3; if (edge(9)) pause(!G.paused);
      if (edge(12)) { me.ersMode = (me.ersMode + 1) % 3; toast(['HARVEST', 'BALANCED', 'OVERTAKE'][me.ersMode], 'ERS mode', 1.2); }
      padPrev = {}; gp.buttons.forEach((b, i) => padPrev[i] = b.pressed);
    }
    if (analog) { ctl.st = st; ctl.thr = thr; ctl.brk = brk; }
    else {
      // keyboard: ramped pedals, rate-limited steering, and (optionally) a speed-aware lock limit so a tap doesn't spin the car
      ctl.thr += clamp(thr - ctl.thr, -dt * 9, dt * 6); ctl.brk += clamp(brk - ctl.brk, -dt * 10, dt * 9);
      let lim = 1; if (SET.sa === '1' && v > 8) { const A = F1T.AERO, k = 0.5 * A.rho * A.ClA / A.mass, amax = A.mu * (A.g + k * v * v); lim = clamp((Math.atan(F1.L * amax / (v * v)) + 0.06) / 0.34, 0.08, 1); }
      const tgt = st * lim, rate = (st === 0 || Math.sign(st) !== Math.sign(ctl.st) ? 5 : 2.6) * Math.max(lim, 0.25);
      ctl.st += clamp(tgt - ctl.st, -dt * rate, dt * rate);
    }
    ctl.drs = drs; return ctl;
  }

  // ================= game state =================
  const G = { mode: 'menu', state: '', paused: false, view: 0, cars: [], me: null, t: 0, shake: 0 };
  function start() {
    $('menu').classList.add('hidden'); $('load').classList.remove('hidden');
    setTimeout(() => {
      const ci = +SET.circuit; if (!T || T.C !== F1T.CIRCUITS[ci]) buildWorld(ci);
      for (const c of G.cars) scene.remove(c.mesh); if (CK) { CK.rt.dispose(); CK = null; }
      G.mode = 'run'; G.mode2 = SET.mode; G.cars = []; G.t = 0; G.jump = G.jumpTold = false; G.lightsN = 0; G.chaseInit = false; G.resultsOn = false; G.trace = null; G.traceT = 0; G.paused = false; G.fin = null; G.over = false; G.pen = 0; G.warn = 0; G.limT = 0; G.results = null;
      const name = (SET.name || '').trim() || 'James';
      const roster = []; TEAMS.forEach((tm, ti) => tm.drivers.forEach((dn, k) => roster.push({ team: tm, name: dn || name, me: ti === 0 && k === 0, num: [7, 22, 16, 55, 3, 11, 31, 4, 28, 63][roster.length] })));
      if (G.mode2 === 'tt') {
        const p = roster[0]; const c = new F1.Car(T, { id: 0, name: p.name, team: p.team, s: -260, d: 0, comp: SET.comp, abs: SET.abs === '1', tc: +SET.tc, auto: SET.auto === '1' }); c.drsOK = true; c.p = p; G.cars.push(c); G.me = c;
        G.state = 'run'; G.start = 0; c.lapN = -1; c.lapValid = true; G.laps = 0;
      } else {
        const others = roster.filter(r => !r.me), r2 = mulberry((Date.now() / 1000) | 0); for (let i = others.length - 1; i > 0; i--) { const j = (r2() * (i + 1)) | 0; [others[i], others[j]] = [others[j], others[i]]; }
        const slot = SET.grid === '0' ? 0 : SET.grid === '1' ? 5 : 9, order = others.slice(); order.splice(slot, 0, roster[0]);
        const base = DIFF[+SET.diff];
        order.forEach((p, k) => { const c = new F1.Car(T, { id: k, name: p.name, team: p.team, ai: !p.me, s: -8 - k * 8, d: k % 2 ? 2.6 : -2.6, comp: p.me ? SET.comp : 'M', abs: p.me ? SET.abs === '1' : true, tc: p.me ? +SET.tc : 1, auto: p.me ? SET.auto === '1' : true });
          c.p = p; c.lapN = -1; c.hold = true; if (!p.me) { c.V = T.profile(base + (r2() - 0.5) * 0.025 + (order.length - k) * 0.0012); c.ofs = 0; c.react = 0.18 + r2() * 0.25; } G.cars.push(c); if (p.me) G.me = c; });
        G.state = 'lights'; G.lt = 0; G.lightsOut = 3.0 + 5 + 0.4 + r2() * 2.2; G.laps = +SET.laps;
      }
      const mk = G.cars.length * Math.ceil(((G.laps || 50) + 2) * T.len / 20);
      for (const c of G.cars) { c.mesh = makeCar(c.p.team, c.p.num, c.comp, c === G.me); scene.add(c.mesh); c.marks = new Float32Array(Math.ceil(((G.laps || 200) + 2) * T.len / 20) + 10).fill(-1); c.best = 0; c.last = 0; c.lapT0 = 0; c.secT = [0, 0, 0]; c.sec = 0; c.fin = 0; c.lapValid = true; }
      buildCockpit(G.me.mesh); G.me.mesh.add(cam);
      buildLine(); resize();
      $('load').classList.add('hidden'); $('hud').classList.remove('hidden'); $('fin').classList.add('hidden'); $('pause').classList.add('hidden');
      $('lights').classList.toggle('hidden', G.mode2 === 'tt'); $('tower').classList.toggle('hidden', G.mode2 === 'tt');
      G.bestEver = getBest(ci); G.bestSec = [0, 0, 0];
      toast(G.mode2 === 'tt' ? 'TIME TRIAL' : F1T.CIRCUITS[ci].name.toUpperCase(), G.mode2 === 'tt' ? 'Out lap. The clock starts at the line.' : G.laps + ' laps · formation done, wait for the lights', 3);
      Snd.init();
    }, 30);
  }
  function pause(p) {
    if (G.mode !== 'run' || G.state === 'done') return; G.paused = p; $('pause').classList.toggle('hidden', !p); if (p) Snd.mute();
    $('pauseInfo').textContent = G.mode2 === 'tt' ? 'Best lap ' + fmtL(G.me.best || G.bestEver) : 'Lap ' + Math.max(1, G.me.lapN + 1) + ' of ' + G.laps;
  }
  function toMenu() { G.mode = 'menu'; G.paused = false; Snd.mute(); $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('fin').classList.add('hidden'); $('menu').classList.remove('hidden'); menuSync(); }
  let toastT = 0; function toast(a, b, d) { const el = $('toast'); el.innerHTML = a + (b ? '<small>' + b + '</small>' : ''); el.style.opacity = 1; toastT = d || 2; }

  // fixed-step simulation
  function tick(h) {
    G.t += h; const T_ = T, me = G.me;
    if (G.state === 'lights') {
      G.lt += h; const n = clamp(Math.floor(G.lt - 3) + 1, 0, 5), prevN = G.lightsN || 0; if (G.lt < 8.4) { G.lightsN = G.lt >= 3 ? n : 0; if (G.lightsN > prevN) Snd.beep(440, 0.12); }
      if (G.lt >= G.lightsOut) { G.state = 'race'; G.lightsN = 0; G.start = G.t; for (const c of G.cars) { c.hold = false; c.lapT0 = G.t; } toast('LIGHTS OUT', '', 1.2); }
    }
    for (const c of G.cars) {
      let inp;
      if (c.ai || (c === me && G.state === 'done')) {
        if (!c.V) c.V = T_.profile(DIFF[1]);
        inp = c.hold ? { thr: 0, brk: 1, steer: 0 } : F1.aiDrive(c, G.cars, h);
        if (c.react && G.state === 'race' && G.t - G.start < c.react) inp = { thr: 0, brk: 1, steer: 0 };
        if (c.wantReset) { c.wantReset = false; F1.reset(c); }
      } else {
        inp = { thr: ctl.thr, brk: ctl.brk, steer: ctl.st, drs: ctl.drs };
        if (G.state === 'lights') { if (inp.thr > 0.1 && !G.jump && c.v > 0.5) { G.jump = true; } inp = Object.assign({}, inp, { brk: Math.max(inp.brk, G.jump ? 0 : 0.0) }); }
      }
      if (G.state === 'lights' && c.ai) inp = { thr: 0, brk: 1, steer: 0 };
      c.step(h, inp);
      laps(c);
    }
    F1.collide(G.cars); G.wk = (G.wk || 0) + 1; if (G.wk % 6 === 0) F1.wakes(G.cars);
    // track limits for the player: all four wheels past the white line
    if (G.state !== 'done' && G.state !== 'lights') {
      if (me.lim === 4) G.limT += h; else { if (G.limT > 0.3) limits(); G.limT = 0; }
    }
    if (G.state === 'lights' && G.jump && !G.jumpTold && me.v > 1) { G.jumpTold = true; G.pen += 5; toast('JUMP START', '+5 s penalty', 2.5); }
    // events: crashes, bumps, shifts
    for (const c of G.cars) { for (const e of c.ev) { if (c === me) { if (e.startsWith('wall') || e.startsWith('bump')) { const m = +e.split(':')[1]; G.shake = Math.min(1.5, G.shake + m * 0.08); Snd.hit(m); } else if (e === 'down') Snd.pop(); } } c.ev.length = 0; }
  }
  function limits() {
    if (G.mode2 === 'tt') { if (G.me.lapValid && G.me.lapN >= 0) { G.me.lapValid = false; toast('TRACK LIMITS', 'lap time deleted', 1.8); } return; }
    G.warn++; if (G.warn <= 3) toast('TRACK LIMITS', 'warning ' + G.warn + ' of 3', 1.8); else { G.pen += 5; toast('TRACK LIMITS', '+5 s time penalty', 2.2); }
  }
  function laps(c) {
    const L = T.len, n = Math.floor(c.dist / L);
    const mk = Math.floor((c.dist + 200) / 20); if (mk >= 0 && mk < c.marks.length && c.marks[mk] < 0) c.marks[mk] = G.t;
    if (n > c.lapN) {
      const first = c.lapN < 0; c.lapN = n;
      if (first) { if (G.mode2 === 'tt') { c.lapT0 = G.t; c.lapValid = true; } c.sec = 0; c.secT0 = c.lapT0; }
      else {
        const lt = G.t - c.lapT0; c.last = lt; c.lapT0 = G.t;
        // sector 3
        secDone(c, 2, G.t - c.secT0); c.sec = 0; c.secT0 = G.t;
        if (c === G.me) lapMsg(c, lt);
        if (!(G.mode2 === 'tt' && !c.lapValid) && (!c.best || lt < c.best)) c.best = lt;
        c.lapValid = true;
        if (G.mode2 === 'race') {
          const leaderDone = G.cars.some(o => o.fin);
          if (!c.fin && (c.lapN >= G.laps || leaderDone)) { c.fin = G.t - G.start; c.finLaps = c.lapN; c.finOrd = G.cars.filter(o => o.fin).length; if (c === G.me) finish(); }
          if (c === G.me && c.lapN === G.laps - 1 && !c.fin) setTimeout(() => { if (G.state === 'race') toast('FINAL LAP', '', 1.6); }, 1800);
        }
      }
    }
    // sectors 1 and 2
    const sp = (c.dist - n * L) / L, sec = sp < 1 / 3 ? 0 : sp < 2 / 3 ? 1 : 2;
    if (c.lapN >= 0 && sec > c.sec) { secDone(c, c.sec, G.t - c.secT0); c.sec = sec; c.secT0 = G.t; }
    // DRS: enabled from lap 3, within a second at the detection line
    if (G.mode2 === 'race') for (const z of T.drs) {
      if (c.idx === z.det || (c.lastIdx !== undefined && ((c.lastIdx < z.det && c.idx >= z.det && c.idx - c.lastIdx < 20)))) {
        const ahead = G.cars.filter(o => o !== c && o.dist > c.dist).sort((a, b) => a.dist - b.dist)[0];
        let gap = 99; if (ahead) { const k = Math.floor((c.dist + 200) / 20); if (k >= 0 && k < ahead.marks.length && ahead.marks[k] > 0) gap = G.t - ahead.marks[k]; }
        const ok = c.lapN >= 2 && gap < 1.0 && G.state === 'race'; if (c === G.me && ok && !c.drsOK) toast('DRS ENABLED', '', 1.0); c.drsOK = ok;
      }
    }
    c.lastIdx = c.idx;
  }
  function secDone(c, k, t) {
    c.secT[k] = t; if (c !== G.me) return;
    if (!(G.mode2 === 'tt' && !c.lapValid)) { c.secCol = c.secCol || []; c.secCol[k] = !G.bestSec[k] || t < G.bestSec[k] ? 'p' : 'y'; if (!G.bestSec[k] || t < G.bestSec[k]) G.bestSec[k] = t; } else { c.secCol = c.secCol || []; c.secCol[k] = ''; }
  }
  function lapMsg(c, lt) {
    if (G.mode2 === 'tt') {
      if (!c.lapValid) { toast(fmtL(lt), 'invalid lap', 2.5); return; }
      if (!G.bestEver || lt < G.bestEver) { G.bestEver = lt; try { localStorage.setItem(bestKey(+SET.circuit), lt.toFixed(3)); } catch (e) { } toast(fmtL(lt), 'PERSONAL BEST', 3); }
      else toast(fmtL(lt), '+' + (lt - G.bestEver).toFixed(3) + ' to your best', 2.5);
    } else toast(fmtL(lt), 'Lap ' + c.lapN + (c.best && lt <= c.best ? ' · personal best' : ''), 2);
    if (c.secCol) setTimeout(() => { c.secCol = []; }, 3000);
  }
  function order() {
    const sc = c => c.fin ? c.finLaps * T.len + (100 - c.finOrd) * 0.01 : c.dist;
    return G.cars.slice().sort((a, b) => sc(b) - sc(a));
  }
  function gapTo(lead, c) { const k = Math.floor((c.dist + 200) / 20); if (k < 0 || k >= lead.marks.length || lead.marks[k] < 0 || c === lead) return 0; return G.t - lead.marks[k]; }
  function finish() {
    G.state = 'done'; G.me.V = T.profile(0.85); G.me.ofs = 0; G.me.hold = false;
    toast('CHEQUERED FLAG', 'P' + (order().indexOf(G.me) + 1), 3);
    setTimeout(showResults, 3500);
  }
  function showResults() {
    if (G.mode !== 'run') return; $('fin').classList.remove('hidden'); G.resultsOn = true; renderResults();
  }
  function renderResults() {
    const o = order(), lead = o[0], me = G.me, myP = o.indexOf(me) + 1, pen = G.pen;
    $('finH').textContent = myP === 1 ? 'You win!' : 'P' + myP + ' at the flag';
    $('finS').textContent = F1T.CIRCUITS[+SET.circuit].name + ' · ' + G.laps + ' laps' + (pen ? ' · your time includes ' + pen + ' s of penalties' : '');
    let h = '<tr><td></td><td>Driver</td><td>Team</td><td class="n">Time</td><td class="n">Best lap</td></tr>';
    o.forEach((c, k) => {
      const tm = c.fin ? (c === lead ? fmtL(c.fin + (c === me ? pen : 0)) : c.finLaps < lead.finLaps ? '+' + (lead.finLaps - c.finLaps) + ' lap' : '+' + (c.fin + (c === me ? pen : 0) - lead.fin).toFixed(3)) : 'running';
      h += '<tr class="' + (c === me ? 'me' : '') + '"><td>' + (k + 1) + '</td><td>' + c.name + '</td><td>' + c.p.team.name + '</td><td class="n">' + tm + '</td><td class="n">' + fmtL(c.best) + '</td></tr>';
    });
    $('finT').innerHTML = h;
  }

  // ================= frame =================
  let last = performance.now(), acc = 0, hudT = 0, eyeS = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const chaseP = V3(), tmpV = V3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (G.mode !== 'run') { if (world) { const a = now / 9000; chase.position.set(T.X[0] + Math.cos(a) * 30, 6, T.Z[0] + Math.sin(a) * 30); chase.lookAt(T.X[0], 1, T.Z[0]); R.render(scene, chase); } return; }
    if (!G.paused) { readInput(dt); acc += dt; let n = 0; while (acc >= 1 / 120 && n < 8) { tick(1 / 120); acc -= 1 / 120; n++; } if (n === 8) acc = 0; }
    // the pre-race hold: brakes on for the player until lights out unless they creep
    const me = G.me;
    for (const c of G.cars) {
      const m = c.mesh, u = m.userData; m.position.set(c.x, 0, c.z); m.rotation.y = -c.h;
      u.body.rotation.z = clamp(-c.ax * 0.0009, -0.03, 0.03); u.body.rotation.x = clamp(-c.ay * 0.0006, -0.02, 0.02);
      u.spin -= c.vx / 0.36 * dt; for (const w of u.wheels) { w.spin.rotation.z = (w.fr || !c.spinR ? u.spin : u.spin * 1.3); if (w.fr) w.piv.rotation.y = -c.delta; }
      u.flap.rotation.z = c.drs ? -0.95 : -0.35;
    }
    // camera
    let camA = cam;
    const v = me.v; G.shake *= Math.exp(-dt * 6);
    if (G.view < 2) {
      const tgt = { x: -me.ax * 0.0011, z: -me.ay * 0.0012, y: 0 };
      const vib = (me.kerb ? 0.006 : 0) + Math.min(0.0025, v * 0.00003) + G.shake * 0.01 + (me.off ? 0.008 : 0);
      eyeS.x += (tgt.x - eyeS.x) * Math.min(1, dt * 9); eyeS.z += (tgt.z - eyeS.z) * Math.min(1, dt * 9);
      const yawT = -me.delta * 0.9 - me.r * 0.05; eyeS.yaw += (yawT - eyeS.yaw) * Math.min(1, dt * 5);
      eyeS.roll += (-me.ay * 0.0012 - eyeS.roll) * Math.min(1, dt * 8); eyeS.pitch += (me.ax * 0.0011 - eyeS.pitch) * Math.min(1, dt * 8);
      const ex = G.view === 0 ? -0.07 : -0.45, ey = G.view === 0 ? 0.835 : 1.22;
      cam.position.set(ex + clamp(eyeS.x, -0.05, 0.05) + (Math.random() - 0.5) * vib, ey + (Math.random() - 0.5) * vib * 1.5, clamp(eyeS.z, -0.06, 0.06) + (Math.random() - 0.5) * vib);
      cam.rotation.set(-0.035 + eyeS.pitch, -Math.PI / 2 + eyeS.yaw * (G.view === 0 ? 1 : 0.5), clamp(eyeS.roll, -0.05, 0.05));
      cam.fov = +SET.fov * (G.view === 0 ? 1 : 1.08); cam.updateProjectionMatrix();
    } else {
      camA = chase; const fx = Math.cos(me.h), fz = Math.sin(me.h);
      tmpV.set(me.x - fx * 7.5, 2.1, me.z - fz * 7.5); if (!G.chaseInit) { chaseP.copy(tmpV); G.chaseInit = true; } chaseP.lerp(tmpV, Math.min(1, dt * 8));
      chase.position.copy(chaseP); chase.lookAt(me.x + fx * 4, 0.9, me.z + fz * 4); chase.fov = 62; chase.updateProjectionMatrix();
    }
    me.mesh.userData.helm.forEach(o => o.visible = G.view === 2);
    // sun follows the camera for crisp shadows nearby
    camA.getWorldPosition(tmpV); sun.position.set(tmpV.x + SUN_DIR.x * 200, SUN_DIR.y * 200, tmpV.z + SUN_DIR.z * 200); sun.target.position.set(tmpV.x, 0, tmpV.z);
    scene.userData.sky.position.set(tmpV.x, 0, tmpV.z);
    // gantry lamps
    for (const l of gantryLamps) l.m.material.color.setHex(l.k < (G.lightsN || 0) ? 0xff2a10 : 0x220303);
    // cockpit: wheel angle, display, mirrors
    if (CK) {
      CK.inner.rotation.x = me.delta / 0.34 * 1.5; CK.sw.visible = G.view === 0;
      CK.t += dt; if (CK.t > 1 / 20) { CK.t = 0; drawWheel(); }
      if (G.view === 0) { CK.fr = (CK.fr || 0) + 1; if (CK.fr % 2 === 0) { const vis = me.mesh.visible; R.setRenderTarget(CK.rt); R.render(scene, CK.mcam); R.setRenderTarget(null); } }
    }
    R.render(scene, camA);
    Snd.frame(me, G.cars, tmpV, camA.getWorldQuaternion(new THREE.Quaternion()), G.view);
    hudT += dt; if (hudT > 0.1) { hudT = 0; hud(); }
    hudFast(); mini();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
    if (G.resultsOn && !$('fin').classList.contains('hidden') && ((G.rt = (G.rt || 0) + dt) > 1)) { G.rt = 0; renderResults(); }
  }
  function drawWheel() {
    const x = CK.dx, me = G.me, W = 256, H = 140; x.fillStyle = '#050607'; x.fillRect(0, 0, W, H);
    // rev lights: green, red, blue
    const n = 15, lit = clamp(Math.round((me.rpm - 9500) / (12100 - 9500) * n), 0, n), flash = me.rpm > 11900 && (performance.now() / 80 | 0) % 2;
    for (let i = 0; i < n; i++) { x.fillStyle = i < lit ? (flash ? '#3a5bff' : i < 5 ? '#22dd44' : i < 10 ? '#ff2222' : '#3a5bff') : '#1a1c20'; x.beginPath(); x.arc(14 + i * 16.3, 12, 6, 0, 7); x.fill(); }
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '900 64px system-ui'; x.fillText(me.gear === -1 ? 'R' : me.gear, W / 2, 92);
    x.font = '800 30px ui-monospace,monospace'; x.textAlign = 'left'; x.fillText(Math.round(me.v * 3.6), 10, 66); x.font = '600 12px system-ui'; x.fillStyle = '#9aa'; x.fillText('KM/H', 12, 82);
    x.textAlign = 'right'; const d = G.deltaV; x.font = '800 22px ui-monospace,monospace'; x.fillStyle = d === undefined ? '#666' : d <= 0 ? '#3ee07a' : '#ff4b4b'; x.fillText(d === undefined ? '--.--' : (d > 0 ? '+' : '') + d.toFixed(2), W - 8, 60);
    x.font = '600 12px system-ui'; x.fillStyle = '#9aa'; x.fillText(G.mode2 === 'tt' ? 'DELTA' : 'LAP ' + Math.max(1, me.lapN + 1) + '/' + G.laps, W - 10, 80);
    // bottom strip: ERS bar, mode, DRS, brake bias
    x.fillStyle = '#222'; x.fillRect(10, 108, 150, 12); x.fillStyle = '#ffd23c'; x.fillRect(10, 108, 150 * me.ers / 4e6, 12);
    x.font = '700 13px system-ui'; x.textAlign = 'left'; x.fillStyle = '#ddd'; x.fillText(['HARV', 'BAL', 'OVTK'][me.ersMode], 10, 135);
    x.fillStyle = me.drs ? '#3ee07a' : me.drsOK && me.inDRS ? '#2b8' : '#444'; x.fillRect(176, 104, 70, 20); x.fillStyle = me.drs ? '#032' : '#ddd'; x.textAlign = 'center'; x.fillText('DRS', 211, 119);
    x.fillStyle = '#9aa'; x.textAlign = 'right'; x.fillText('BB ' + (me.bias * 100).toFixed(0) + '%', W - 10, 136);
    CK.dt.needsUpdate = true;
  }
  const tcol = t => t < 70 ? '#3a7bff' : t < 88 ? '#5ad1ff' : t < 112 ? '#3ee07a' : t < 125 ? '#ffb02e' : '#ff3b3b';
  function hud() {
    const me = G.me, o = order(), pos = o.indexOf(me) + 1;
    $('pos').innerHTML = G.mode2 === 'tt' ? 'TT' : 'P' + pos + '<small>/' + G.cars.length + '</small>';
    $('lap').innerHTML = '<small>LAP</small>' + (G.mode2 === 'tt' ? Math.max(0, me.lapN + 1) : Math.min(G.laps, Math.max(1, me.lapN + 1)) + '/' + G.laps);
    const bestRef = G.mode2 === 'tt' ? G.bestEver : me.best;
    $('bestL').textContent = (G.mode2 === 'tt' ? 'Best ' : 'Best ') + fmtL(bestRef) + (me.last ? '  ·  Last ' + fmtL(me.last) : '') + (G.pen ? '  ·  +' + G.pen + ' s' : '');
    const secs = $('secs').children; for (let k = 0; k < 3; k++) secs[k].className = (me.secCol && me.secCol[k]) || '';
    if (G.mode2 === 'race') {
      const lead = o[0]; let h = '';
      o.forEach((c, k) => { const g = k === 0 ? (G.state === 'lights' ? '' : 'Leader') : c.fin && lead.fin ? (c.finLaps < lead.finLaps ? '+1L' : '+' + (c.fin - lead.fin).toFixed(1)) : lead.dist - c.dist > T.len ? '+' + Math.floor((lead.dist - c.dist) / T.len) + 'L' : '+' + gapTo(lead, c).toFixed(1);
        h += '<div class="' + (c === me ? 'me' : '') + '"><b>' + (k + 1) + '</b><i style="background:#' + c.p.team.c.toString(16).padStart(6, '0') + '"></i><span>' + c.name.split(' ').pop().slice(0, 10).toUpperCase() + (c.fin ? ' 🏁' : '') + '</span><em>' + g + '</em></div>'; });
      $('tower').innerHTML = h;
    }
    const ty = [me.tf, me.tf, me.tr, me.tr]; for (let k = 0; k < 4; k++) $('ty' + k).style.background = tcol(ty[k] + (k % 2 ? 1 : -1));
    $('tyC').textContent = me.comp + ' ' + Math.round((1 - me.wear) * 100) + '%'; $('tyC').style.color = F1.COMP[me.comp].col;
    $('fERS').textContent = ['HARVEST', 'BALANCED', 'OVERTAKE'][me.ersMode];
    $('fDRS').className = me.drs ? 'on' : me.drsOK && (me.inDRS || G.mode2 === 'tt') ? 'av' : '';
    $('fTL').textContent = G.mode2 === 'race' ? 'TL ' + Math.min(G.warn, 3) + '/3' : me.lapValid ? 'VALID' : 'INVALID'; $('fTL').className = G.mode2 === 'tt' && !me.lapValid ? '' : '';
    $('ersT').textContent = Math.round(me.ers / 4e6 * 100) + '%';
    let w = ''; if (me.wing > 0.05) w = 'Front wing damage ' + Math.round(me.wing * 100) + '%'; if (me.lockF > 0.5 && ctl.brk > 0.5) w = 'Front lock-up'; if (G.state === 'lights' && G.lt < 3) w = 'Hold the brake · go when the lights go out';
    $('warn').textContent = w;
  }
  function hudFast() {
    const me = G.me;
    $('spd').innerHTML = Math.round(me.v * 3.6) + '<small> km/h</small>'; $('gear').textContent = me.gear === -1 ? 'R' : me.gear;
    $('thrB').style.width = (me.thr * 100) + '%'; $('brkB').style.width = (me.brk * 100) + '%'; $('ersB').style.width = (me.ers / 4e6 * 100) + '%';
    const lt = me.lapN >= 0 && G.state !== 'lights' ? G.t - me.lapT0 : 0; $('cur').textContent = fmtL(lt).replace('-:--.---', '0:00.000');
    // live delta against your best lap (time trial) using a 20 m trace
    const ref = G.mode2 === 'tt' ? G.trace : me.traceBest;
    const prog = me.dist - me.lapN * T.len, k = Math.floor(prog / 20);
    me.trace = me.trace || []; if (me.lapN !== me.trLap) { if (me.trLap !== undefined && me.trace.length > T.len / 20 - 3 && me.lapValid !== false) { if (me.last && (!me.traceBestT || me.last <= me.traceBestT)) { me.traceBest = me.trace; me.traceBestT = me.last; } if (G.mode2 === 'tt' && me.last && me.last <= (G.traceT || 1e9) && me.last <= G.bestEver + 0.001) { G.trace = me.trace; G.traceT = me.last; } } me.trace = []; me.trLap = me.lapN; }
    if (me.lapN >= 0 && k >= 0 && me.trace[k] === undefined) me.trace[k] = lt;
    if (ref && ref[k] !== undefined && me.lapN >= 0) { G.deltaV = lt - ref[k]; $('delta').textContent = (G.deltaV > 0 ? '+' : '') + G.deltaV.toFixed(2); $('delta').className = G.deltaV <= 0 ? 'g' : 'r'; } else { G.deltaV = undefined; $('delta').textContent = ''; }
    const ls = $('lights').children; for (let i = 0; i < 5; i++) ls[i].className = i < (G.lightsN || 0) ? 'on' : '';
    if (G.state !== 'lights' && !$('lights').classList.contains('hidden') && G.t - G.start > 1.5) $('lights').classList.add('hidden');
  }
  function mini() {
    const c = $('mini'), x = c.getContext('2d'), m = T.mini; x.clearRect(0, 0, 380, 380);
    if (!T.miniP) { const p = new Path2D(); for (let i = 0; i <= T.N; i += 3) { const j = T.wi(i); const px = T.X[j] * m.sc + m.ox, pz = T.Z[j] * m.sc + m.oz; i ? p.lineTo(px, pz) : p.moveTo(px, pz); } p.closePath(); T.miniP = p; }
    x.lineJoin = 'round'; x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 12; x.stroke(T.miniP); x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5; x.stroke(T.miniP);
    const sx = T.X[0] * m.sc + m.ox, sz = T.Z[0] * m.sc + m.oz; x.fillStyle = '#e10600'; x.fillRect(sx - 2, sz - 8, 4, 16);
    for (const car of G.cars) { const px = car.x * m.sc + m.ox, pz = car.z * m.sc + m.oz; x.fillStyle = '#' + car.p.team.c2.toString(16).padStart(6, '0'); x.beginPath(); x.arc(px, pz, car === G.me ? 9 : 6, 0, 7); x.fill(); x.strokeStyle = car === G.me ? '#fff' : '#000'; x.lineWidth = 2; x.stroke(); }
  }

  // ================= menu =================
  function menuSync() {
    document.querySelectorAll('.seg').forEach(s => { const k = s.dataset.k; s.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(SET[k]) === b.dataset.v)); });
    $('raceOpts').style.display = SET.mode === 'race' ? '' : 'none';
    $('fov').value = SET.fov; $('fovV').textContent = SET.fov + '°'; $('nm').value = SET.name || '';
    const b = getBest(+SET.circuit); $('bestM').textContent = b ? 'Your best lap here: ' + fmtL(b) : '';
  }
  document.querySelectorAll('.seg').forEach(s => s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SET[s.dataset.k] = b.dataset.v; save(); menuSync(); }));
  $('fov').addEventListener('input', e => { SET.fov = +e.target.value; save(); menuSync(); });
  $('nm').addEventListener('input', e => { SET.name = e.target.value; save(); });
  $('real').addEventListener('click', e => { e.preventDefault(); Object.assign(SET, { auto: '0', abs: '0', tc: '0', sa: '0', line: '0' }); save(); menuSync(); });
  $('bGo').onclick = () => { Snd.init(); start(); };
  $('bResume').onclick = () => pause(false); $('bRestart').onclick = () => { $('pause').classList.add('hidden'); start(); }; $('bQuit').onclick = toMenu;
  $('bAgain').onclick = () => start(); $('bMenu').onclick = toMenu;
  menuSync(); resize();
  buildWorld(+SET.circuit);
  requestAnimationFrame(frame);
  if (/[?&]test/.test(location.search)) window.__JR = { G, SET, start, tick, get T() { return T; }, ctl, K, R, scene, cam, buildWorld };
})();
