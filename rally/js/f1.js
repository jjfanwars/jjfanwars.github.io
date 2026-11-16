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
  const DEF = { mode: 'race', circuit: '0', laps: '5', diff: '1', grid: '1', comp: 'M', auto: '1', abs: '1', tc: '1', sa: '1', line: '0', gfx: '1', fov: 58, name: '', input: 'kb', visor: '1', voice: '1' };
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
  const SKY_H = new THREE.Color(0xbcd3e6), SKY_Z = new THREE.Color(0x2f69b4);
  scene.fog = new THREE.FogExp2(0xc4d6e6, 0.00028);
  const cam = new THREE.PerspectiveCamera(58, 1, 0.04, 9000); cam.rotation.order = 'YXZ';
  const chase = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  const POST = JRG.Post(R);
  const resize = () => { const w = innerWidth, h = innerHeight, pr = Math.min(devicePixelRatio, SET.gfx === '1' ? 1.5 : 1); R.setPixelRatio(pr); R.setSize(w, h, false); POST.size(Math.round(w * pr), Math.round(h * pr)); for (const c of [cam, chase]) { c.aspect = w / h; c.updateProjectionMatrix(); } };
  addEventListener('resize', resize);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4d5a3a, 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.6); sun.castShadow = true; scene.add(sun); scene.add(sun.target);
  const SUN_DIR = V3(-0.45, 0.62, 0.52).normalize();
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45; sun.shadow.camera.near = 1; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2;
  const skyMat = JRG.skyMaterial(SKY_H, SKY_Z, SUN_DIR);
  { const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky); scene.userData.sky = sky; }
  scene.environment = JRG.envMap(R, skyMat); scene.environmentIntensity = 0.75;
  const FXS = JRG.FX(scene);

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
      for (const [p, y, ss] of q) { pos.push(p[0], y, p[1]); const c = col(i, y); cl.push(c[0], c[1], c[2]); uv.push(ss / (uvS.length ? uvS[0] : uvS), (y - (uvS.length ? uvS[2] : 0)) / (uvS.length ? uvS[1] : uvS)); }
      s += sl;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
  }
  function buildWorld(ci) {
    if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    T = F1T.build(ci); world = new THREE.Group(); scene.add(world); gantryLamps = [];
    const TX = JRG.textures(), rp = (t, r) => { const c = t.clone(); c.needsUpdate = true; if (r) c.repeat.set(r, r); return c; };
    const hw = T.hw, N = T.N, add = (g, m, sh) => { const o = new THREE.Mesh(g, m); o.receiveShadow = true; if (sh) o.castShadow = true; world.add(o); return o; };
    const hi = SET.gfx === '1';
    // ground
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < N; i++) { x0 = Math.min(x0, T.X[i]); x1 = Math.max(x1, T.X[i]); z0 = Math.min(z0, T.Z[i]); z1 = Math.max(z1, T.Z[i]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; T.box = { x0, x1, z0, z1, cx, cz };
    { const g = new THREE.PlaneGeometry(9000, 9000, 120, 120).rotateX(-Math.PI / 2).translate(cx, -0.12, cz), t = rp(TX.grass, 9000 / 11), tn = rp(TX.grassN, 9000 / 11); add(g, M({ map: t, normalMap: tn, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.97 })); }
    // distant hills
    { const g = new THREE.BufferGeometry(), pos = [], n = 96, R0 = 3600; const hn = makeNoise(3);
      const ring = []; for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, hgt = 120 + 260 * (0.5 + 0.5 * hn.fbm(k * 0.18, 0.5, 3)); ring.push([cx + Math.cos(a) * R0, hgt, cz + Math.sin(a) * R0, cx + Math.cos(a) * (R0 - 900), cz + Math.sin(a) * (R0 - 900)]); }
      for (let k = 0; k < n; k++) { const A = ring[k], B = ring[k + 1]; pos.push(A[3], 0, A[4], A[0], A[1], A[2], B[3], 0, B[4], B[3], 0, B[4], A[0], A[1], A[2], B[0], B[1], B[2]); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, M({ color: 0x6f8a6a, roughness: 1, side: THREE.DoubleSide })); world.add(m); }
    // tarmac with a rubbered-in racing line and darker braking zones
    const tarM = M({ map: TX.tar, normalMap: TX.tarN, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: TX.tarR, vertexColors: true, roughness: 1, envMapIntensity: 0.6 });
    const tc = (i, l) => { const r = Math.abs(l - T.L[i]), rub = Math.max(0, 1 - r / 1.6) * 0.32, brk = T.V[T.wi(i + 20)] < T.V[i] - 6 ? 0.05 : 0; const v = 0.5 * (1 - rub - brk) * (0.94 + 0.06 * Math.sin(i * 0.37 + l * 0.8)); return [v, v, v * 1.03]; };
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
    const roM = M({ map: TX.tar, normalMap: TX.tarN, vertexColors: true, roughness: 0.92 }), grM = M({ map: TX.gravel, normalMap: TX.gravelN, vertexColors: true, roughness: 1 });
    for (const s of [-1, 1]) {
      const isG = i => (T.gravel[i] === 1 && s < 0) || (T.gravel[i] === 2 && s > 0), inner = i => hw + (T.kerb[i] ? 1.3 : 0.0), bar = i => s < 0 ? T.barL[i] : T.barR[i];
      add(band(() => true, i => s * inner(i), i => s * Math.min(bar(i), isG(i) ? hw + 2.5 : hw + 3.5), () => 0.027, () => [0.36, 0.38, 0.42], 1, 5), roM);
      add(band(i => isG(i), i => s * (hw + 2.5), i => s * (bar(i) - 0.2), () => 0.022, () => [0.9, 0.86, 0.76], 3, 3), grM);
      // green-painted strip beyond the run-off where there's no gravel
      add(band(i => !isG(i), i => s * (hw + 3.5), i => s * Math.min(bar(i), hw + 6), () => 0.024, () => [0.18, 0.42, 0.24], 1, 5), roM);
    }
    // barriers: armco with a catch fence above, tyre walls in the gravel traps, concrete pit wall
    const armM = M({ map: TX.armco, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }), fenM = M({ map: TEX.fence, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4, color: 0x9aa0a8 });
    const tecM = M({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), postM = M({ color: 0x55595f, metalness: 0.6, roughness: 0.5 }), baseM = M({ color: 0x6b6e72, roughness: 0.9, side: THREE.DoubleSide });
    const pitI = i => T.pit[i] === 1, posts = [];
    const ADS = ['VELOX OIL', 'NORTHSTAR', 'AURUM WATCHES', 'PULSE ENERGY', 'KESTREL BANK', 'ORBITEL', 'JAMES RACING', 'HALCYON AIR'], ADC = [['#0d2a5c', '#ffd23c'], ['#111', '#fff'], ['#1c1c1c', '#d9b25a'], ['#e5003a', '#fff'], ['#00704a', '#fff'], ['#5a2ca0', '#fff'], ['#c40b0b', '#fff'], ['#f2f2f2', '#0a3a7a']];
    const adT = ctex(2048, 128, (x) => { for (let k = 0; k < 8; k++) { x.fillStyle = ADC[k][0]; x.fillRect(k * 256, 0, 256, 128); x.fillStyle = ADC[k][1]; x.font = 'italic 900 34px system-ui'; x.textAlign = 'center'; x.fillText(ADS[k], k * 256 + 128, 78); x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(k * 256, 0, 256, 6); } });
    const adM = M({ map: adT, roughness: 0.5, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const d = i => s < 0 ? -T.barL[i] : T.barR[i], gv = i => T.gravel[i] === (s < 0 ? 1 : 2);
      add(wall(i => !(s < 0 && pitI(i)), d, 0.3, 0.95, () => [1, 1, 1], [4, 0.65, 0.3]), armM, true);
      add(wall(i => !(s < 0 && pitI(i)), i => d(i) + s * 0.08, 0, 0.32, () => [1, 1, 1], 4), baseM);
      if (hi) add(wall(() => true, i => d(i) + s * 0.05, 0.95, 3.8, () => [1, 1, 1], 1.2), fenM);
      for (let i = 0; i < N; i += 2) if (!(s < 0 && pitI(i))) posts.push([T.X[i] + T.nx[i] * (d(i) + s * 0.15), T.Z[i] + T.nz[i] * (d(i) + s * 0.15)]);
      // TecPro blocks in front of the armco at gravel traps: red / white / blue
      const TC = [[0.75, 0.06, 0.05], [0.92, 0.92, 0.92], [0.06, 0.2, 0.62]];
      add(wall(gv, i => d(i) - s * 0.6, 0, 1.0, (i) => TC[Math.floor(i * T.ds / 1.5) % 3], 2), tecM, true);
      // advertising boards along the fast straights
      add(wall(i => !gv(i) && !(s < 0 && pitI(i)) && T.KS[i] < 1 / 500 && (Math.floor(i * T.ds / 160) % 2 === (s > 0 ? 0 : 1)), i => d(i) - s * 0.25, 0.02, 1.0, () => [1, 1, 1], [48, 1, 0.02]), adM);
    }
    { const geo = new THREE.BoxGeometry(0.12, 0.95, 0.12).translate(0, 0.475, 0), m = new THREE.InstancedMesh(geo, postM, posts.length), o = new THREE.Object3D(); posts.forEach((p, k) => { o.position.set(p[0], 0, p[1]); o.updateMatrix(); m.setMatrixAt(k, o.matrix); }); world.add(m); }
    // marshal posts: orange huts behind the barrier every 300 m
    for (let i = 60; i < N; i += Math.round(300 / T.ds)) { const s = T.K[T.wi(i + 30)] > 0 ? -1 : 1, d = s * ((s < 0 ? T.barL[i] : T.barR[i]) + 2.5); if (s < 0 && pitI(i)) continue;
      const hut = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 2).translate(0, 1.2, 0), M({ color: 0xf07d1a, roughness: 0.6 })); hut.position.set(T.X[i] + T.nx[i] * d, 0, T.Z[i] + T.nz[i] * d); hut.rotation.y = -T.H[i]; hut.castShadow = true; world.add(hut);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), M({ color: 0xeeeeee })); roof.position.set(hut.position.x, 2.47, hut.position.z); roof.rotation.y = hut.rotation.y; world.add(roof); }
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
      const card = (w, h) => { const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), b = a.clone().rotateY(Math.PI / 2), c = a.clone().rotateY(Math.PI / 4), d = a.clone().rotateY(-Math.PI / 4); return JRG.merge([a, b, c, d]); };
      const im = (geo, tex, list) => { const mat = M({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }), m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(), col = new THREE.Color();
        list.forEach((p, k) => { o.position.set(p[0], 0, p[1]); o.scale.setScalar(p[2]); o.rotation.y = p[3] * 6; o.updateMatrix(); m.setMatrixAt(k, o.matrix); col.setHSL(0.24 + (p[3] - 0.5) * 0.08, 0.35 + p[3] * 0.2, 0.75 + p[3] * 0.25); m.setColorAt(k, col); });
        m.castShadow = hi; m.receiveShadow = true; m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45 }); world.add(m); };
      im(card(11, 13), TX.tree, pts.filter(p => p[3] < 0.55)); im(card(6, 15), TX.pine, pts.filter(p => p[3] >= 0.55));
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

  // ================= car models (js/f1gfx.js) =================
  const makeCar = (team, num, comp, mine) => JRG.makeCar(team, num, comp, mine, F1);
  let CK = null;
  function buildCockpit(g, team, name) { CK = JRG.buildCockpit(g, team, name); CK.pad = { up: 0, down: 0 }; }

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
    if (c === 'KeyB' && G.mode2 === 'race' && G.state === 'race' && !me.pit) { me.wantPit = !me.wantPit; if (me.wantPit) { me.nextComp = me.nextComp && me.nextComp !== me.comp ? me.nextComp : (me.comp === 'H' ? 'M' : me.comp === 'M' ? 'H' : 'M'); radio('Copy, box this lap. ' + F1.COMP[me.nextComp].name + ' tyres ready.'); } else radio('Okay, stay out, stay out.'); }
    if ((c === 'Digit1' || c === 'Digit2' || c === 'Digit3') && me.wantPit) { me.nextComp = ['S', 'M', 'H'][+c.slice(-1) - 1]; toast(F1.COMP[me.nextComp].name.toUpperCase() + ' TYRES', 'ready in the box', 1.2); }
  }
  const ctl = { st: 0, thr: 0, brk: 0, drs: false };
  const MS = { x: 0.5, seen: false, l: false, r: false };
  addEventListener('mousemove', e => { MS.x = e.clientX / innerWidth; MS.seen = true; });
  addEventListener('mousedown', e => { if (G.mode !== 'run' || SET.input !== 'mouse') return; if (e.button === 0) MS.l = true; if (e.button === 2) MS.r = true; Snd.init(); });
  addEventListener('mouseup', e => { if (e.button === 0) MS.l = false; if (e.button === 2) MS.r = false; });
  addEventListener('contextmenu', e => { if (G.mode === 'run') e.preventDefault(); });
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
    // Steering help: at speed the full input only asks for the lock the tyres can use (keyboard, mouse and pad alike)
    let lim = 1; if (SET.sa === '1' && v > 8) { const A = F1T.AERO, k = 0.5 * A.rho * A.ClA / A.mass, amax = A.mu * (A.g + k * v * v); lim = clamp((Math.atan(F1.L * amax / (v * v)) + 0.07) / F1.LOCK, 0.08, 1); }
    const smooth = (tgt, k) => { ctl.st += (tgt - ctl.st) * (1 - Math.exp(-dt * k)); };
    if (!analog && SET.input === 'mouse' && MS.seen) {
      const m = (MS.x - 0.5) / 0.34, dz = Math.sign(m) * Math.max(0, Math.abs(m) - 0.015) / 0.985; st = clamp(Math.sign(dz) * Math.pow(Math.abs(dz), 1.35), -1, 1);
      ctl.raw = (ctl.raw || 0) + clamp(st * lim - (ctl.raw || 0), -dt * 6, dt * 6); smooth(ctl.raw, 12);
      thr = Math.max(thr, MS.l ? 1 : 0); brk = Math.max(brk, MS.r ? 1 : 0);
      ctl.thr += clamp(thr - ctl.thr, -dt * 9, dt * 6); ctl.brk += clamp(brk - ctl.brk, -dt * 10, dt * 9);
    } else if (analog) { ctl.raw = st * lim; smooth(ctl.raw, 14); ctl.thr = thr; ctl.brk = brk; }
    else {
      // keyboard: ramped pedals, rate-limited steering, and (optionally) a speed-aware lock limit so a tap doesn't spin the car
      ctl.thr += clamp(thr - ctl.thr, -dt * 9, dt * 6); ctl.brk += clamp(brk - ctl.brk, -dt * 10, dt * 9);
      // gradual: a tap is a gentle nudge, holding builds to full lock in about half a second, release eases back to centre,
      // then a light filter takes the corners off every change so the car never jerks
      ctl.held = st && st === ctl.dir ? (ctl.held || 0) + dt : 0; ctl.dir = st; ctl.raw = ctl.raw || 0;
      const rate = (st === 0 ? 2.8 : Math.sign(st) !== Math.sign(ctl.raw) && Math.abs(ctl.raw) > 0.04 ? 3.6 : Math.min(2.3, 0.7 + ctl.held * 3.2)) * Math.max(lim, 0.3);
      ctl.raw += clamp(st * lim - ctl.raw, -dt * rate, dt * rate); smooth(ctl.raw, 10);
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
      G.mode = 'run'; G.mode2 = SET.mode; ctl.st = ctl.raw = ctl.held = 0; for (const k in CREW) { world.remove(CREW[k].g); delete CREW[k]; } G.cars = []; G.t = 0; G.jump = G.jumpTold = false; G.lightsN = 0; G.chaseInit = false; G.resultsOn = false; G.trace = null; G.traceT = 0; G.paused = false; G.fin = null; G.over = false; G.pen = 0; G.warn = 0; G.limT = 0; G.results = null;
      const name = (SET.name || '').trim() || 'James';
      const roster = []; TEAMS.forEach((tm, ti) => tm.drivers.forEach((dn, k) => roster.push({ team: tm, name: dn || name, me: ti === 0 && k === 0, num: [7, 22, 16, 55, 3, 11, 31, 4, 28, 63][roster.length] })));
      if (G.mode2 === 'tt') {
        const p = roster[0]; const c = new F1.Car(T, { id: 0, name: p.name, team: p.team, s: -260, d: 0, comp: SET.comp, abs: SET.abs === '1', tc: +SET.tc, auto: SET.auto === '1' }); c.drsOK = true; c.p = p; G.cars.push(c); G.me = c;
        G.state = 'run'; G.start = 0; c.lapN = -1; c.lapValid = true; G.laps = 0;
      } else {
        const others = roster.filter(r => !r.me), r2 = mulberry((Date.now() / 1000) | 0); for (let i = others.length - 1; i > 0; i--) { const j = (r2() * (i + 1)) | 0; [others[i], others[j]] = [others[j], others[i]]; }
        const slot = SET.grid === '0' ? 0 : SET.grid === '1' ? 5 : 9, order = others.slice(); order.splice(slot, 0, roster[0]);
        const base = DIFF[+SET.diff];
        order.forEach((p, k) => { const c = new F1.Car(T, { id: k, name: p.name, team: p.team, ai: !p.me, s: -8 - k * 8, d: k % 2 ? 2.6 : -2.6, comp: p.me ? SET.comp : (+SET.laps >= 10 ? (r2() < 0.5 ? 'M' : 'S') : +SET.laps <= 5 ? 'S' : 'M'), abs: p.me ? SET.abs === '1' : true, tc: p.me ? +SET.tc : 1, auto: p.me ? SET.auto === '1' : true });
          c.p = p; c.lapN = -1; c.hold = true; if (!p.me) { c.V = T.profile(base + (r2() - 0.5) * 0.025 + (order.length - k) * 0.0012); c.ofs = 0; c.react = 0.18 + r2() * 0.25; } G.cars.push(c); if (p.me) G.me = c; });
        G.state = 'lights'; G.lt = 0; G.lightsOut = 3.0 + 5 + 0.4 + r2() * 2.2; G.laps = +SET.laps;
      }
      const mk = G.cars.length * Math.ceil(((G.laps || 50) + 2) * T.len / 20);
      G.mandatory = G.mode2 === 'race' && G.laps >= 10; G.fastest = null; G.noStop = false;
      for (const c of G.cars) { c.compsUsed = new Set([c.comp]); c.wantPit = false; c.pit = null; if (c.ai && G.mandatory) { c.plan = Math.round(G.laps * (0.35 + Math.random() * 0.3)); } c.lastP = 0; }
      buildCrews();
      for (const c of G.cars) { c.mesh = makeCar(c.p.team, c.p.num, c.comp, c === G.me); scene.add(c.mesh); c.marks = new Float32Array(Math.ceil(((G.laps || 200) + 2) * T.len / 20) + 10).fill(-1); c.best = 0; c.last = 0; c.lapT0 = 0; c.secT = [0, 0, 0]; c.sec = 0; c.fin = 0; c.lapValid = true; }
      buildCockpit(G.me.mesh, G.me.p.team, G.me.name); G.me.mesh.add(cam);
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
      if (c.pit) { pitStep(c, h); laps(c); continue; }
      if (c.ai && G.state === 'race' && !c.fin) aiStrategy(c);
      pitEntry(c);
      if (c.pit) { pitStep(c, h); laps(c); continue; }
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
      if (me.lim === 4 && !me.pit) G.limT += h; else { if (G.limT > 0.3) limits(); G.limT = 0; }
    }
    if (G.state === 'lights' && G.jump && !G.jumpTold && me.v > 1) { G.jumpTold = true; G.pen += 5; toast('JUMP START', '+5 s penalty', 2.5); }
    // events: crashes, bumps, shifts
    for (const c of G.cars) { for (const e of c.ev) { if (c === me) { if (e.startsWith('wall') || e.startsWith('bump')) { const m = +e.split(':')[1]; G.shake = Math.min(1.5, G.shake + m * 0.08); Snd.hit(m); } else if (e === 'down') { Snd.pop(); if (CK) CK.pad.down = 1; } else if (e === 'up' && CK) CK.pad.up = 1; } } c.ev.length = 0; }
  }
  // ================= pit stops =================
  // The pit lane runs on the left from T.pitS0 (before the line) to T.pitS1. Entering with a box call hands the car to a
  // scripted run: 80 km/h limiter, stop in the team box, crew changes tyres (and the wing if damaged), release, limiter off at the exit.
  const PIT_LIM = 80 / 3.6, LANE_D = () => -(T.hw + 11), BOX_D = () => -(T.hw + 13.4);
  const pitLen = () => T.pitS1 - T.pitS0;
  const boxU = team => pitLen() / 2 + (TEAMS.indexOf(team) - 2) * 26;
  function pitLat(u, P) {
    const L = pitLen(), lane = LANE_D(), edge = -(T.hw - 1.6);
    let d = u < 120 ? lerp(P.lat0, lane, sstep(0, 120, u)) : u > L - 110 ? lerp(lane, edge, sstep(L - 110, L, u)) : lane;
    const b = P.box - u; if (b > -16 && b < 22) d = lerp(d, BOX_D(), sstep(22, 6, b) * (P.ph === 'out' ? sstep(-16, -4, b) : 1));
    return d;
  }
  function pitPose(c, P) {
    const s0 = T.pitS0 + P.u, a = T.at(s0), b = T.at(s0 + 1.5), la = pitLat(P.u, P), lb = pitLat(P.u + 1.5, P);
    const ax = a.x - Math.sin(a.h) * la, az = a.z + Math.cos(a.h) * la, bx = b.x - Math.sin(b.h) * lb, bz = b.z + Math.cos(b.h) * lb;
    c.x = ax; c.z = az; c.h = Math.atan2(bz - az, bx - ax);
  }
  function lapPos(c) { return ((c.dist % T.len) + T.len) % T.len; }
  function pitEntry(c) {
    const sE = (T.pitS0 + T.len) % T.len, s = lapPos(c), prev = c.lastPos === undefined ? s : c.lastPos; c.lastPos = s;
    if (!c.wantPit || G.state !== 'race' || c.fin && c !== G.me) return;
    if (prev < sE && s >= sE && s - prev < 50) {
      const lat0 = clamp(c.q.d, -T.hw + 1, T.hw - 1);
      c.pit = { ph: 'in', u: 0, v: c.v, box: boxU(c.p.team), lat0, comp: c.nextComp || 'M', t0: G.t };
      c.wantPit = false; c.drs = false; c.vy = c.r = 0; c.delta = 0;
      if (c === G.me) radio('Box box. Limiter is on, we are ready for you.');
    }
  }
  function pitStep(c, h) {
    const P = c.pit, L = pitLen();
    if (P.ph === 'stop') {
      P.t += h; const crew = CREW[P.team]; const k = P.t / P.dur;
      if (!P.swapped && k > 0.45) { P.swapped = true; c.comp = P.comp; c.wear = 0; c.tf = c.tr = 72; if (P.wing) { c.wing = 0; c.dmg = 0; } c.compsUsed.add(c.comp); setTyreLook(c); }
      if (P.t >= P.dur) { P.ph = 'out'; P.v = 0; if (c === G.me) { const st = P.dur; toast(st.toFixed(1) + ' s', 'pit stop', 2); radio(st < 3 ? 'Great stop, ' + st.toFixed(1) + ' seconds. Tyres are cold, careful.' : 'Slow stop, sorry. ' + st.toFixed(1) + ' seconds. Push now.'); } }
    } else {
      const toBox = P.box - P.u, outLim = P.ph === 'out' && P.u > L - 100;
      let vt = outLim ? 75 : PIT_LIM; if (P.ph === 'in') vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 7 * (toBox - 0.2))));
      P.v += clamp(vt - P.v, -32 * h, (outLim ? 11 : 9) * h); P.u += P.v * h; c.dist += P.v * h;
      if (P.ph === 'in' && toBox < 0.4 && P.v < 0.6) { P.ph = 'stop'; P.v = 0; P.t = 0; P.team = c.p.team.name; P.wing = c.wing > 0.05; P.dur = (2.1 + Math.random() * 0.7 + (Math.random() < 0.08 ? 2 + Math.random() * 3 : 0) + (P.wing ? 4.5 : 0)); }
      if (P.ph === 'out' && P.u >= L) { c.pit = null; c.vx = P.v; c.vy = 0; c.r = 0; c.gear = 3; T.query(c.x, c.z, c.idx, c.q); c.idx = c.q.i; c.lastPos = lapPos(c); c.ofs = 0; c.stuck = 0; c.limiter = false; return; }
    }
    pitPose(c, P); c.vx = P.v; c.vy = 0; c.r = 0; c.ax = 0; c.ay = 0; c.drs = false; c.lim = 0; c.off = 0; c.kerb = 0; c.lockF = c.lockR = c.spinR = 0;
    c.limiter = P.ph !== 'stop' && !(P.ph === 'out' && P.u > L - 100);
    c.gear = P.v < 12 ? 1 : P.v < 30 ? 2 : 3; c.rpm = Math.max(5200, c.wheelRpm(c.gear)) + (c.limiter && P.v > PIT_LIM - 1 && Math.sin(G.t * 40) > 0 ? 450 : 0); c.thr = P.ph === 'stop' ? 0.08 : 0.35; c.brk = 0;
    T.query(c.x, c.z, c.idx, c.q); c.idx = c.q.i;
  }
  // AI strategy: long races have a planned stop (two compounds required); anyone pits for dead tyres or a broken wing
  function aiStrategy(c) {
    if (c.wantPit || c.pit) return; const left = G.laps - c.lapN;
    if (left < 2) return;
    const dead = c.wear > 0.72, wing = c.wing > 0.3, plan = c.plan && c.lapN + 1 >= c.plan;
    if (dead || wing || plan) { c.wantPit = true; c.plan = 0; c.nextComp = left <= 5 ? 'S' : left <= 11 ? 'M' : 'H'; if (G.mandatory && c.compsUsed.size < 2 && c.nextComp === c.comp) c.nextComp = c.comp === 'M' ? 'H' : 'M'; }
  }
  function setTyreLook(c) { const mt = JRG.tyreMat(c.comp); for (const w of c.mesh.userData.wheels) w.tyre.material = mt; }
  // pit crews: one per team, waiting in front of the garage, stepping up when their car is in the box
  const CREW = {};
  function buildCrews() {
    for (const k in CREW) world.remove(CREW[k].g);
    TEAMS.forEach((tm, ti) => {
      const u = boxU(tm), s = T.pitS0 + u, p = T.at(s), d = BOX_D(), g = new THREE.Group();
      g.position.set(p.x - Math.sin(p.h) * d, 0, p.z + Math.cos(p.h) * d); g.rotation.y = -p.h; world.add(g);
      // box marking
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 3.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: tm.c, roughness: 0.8, transparent: true, opacity: 0.55 })); mk.position.y = 0.031; g.add(mk);
      const men = [], hex = c => '#' + c.toString(16).padStart(6, '0');
      const suitT = ctex(64, 64, (x) => { x.fillStyle = hex(tm.c); x.fillRect(0, 0, 64, 64); x.fillStyle = hex(tm.c2); x.fillRect(0, 26, 64, 7); x.fillRect(29, 0, 6, 64); });
      const body = new THREE.MeshStandardMaterial({ map: suitT, roughness: 0.9 }), helm = new THREE.MeshPhysicalMaterial({ color: tm.c2, roughness: 0.3, clearcoat: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.3 });
      const spots = [];
      for (const wx of [F1.CA, -F1.CB]) for (const sd of [-1, 1]) for (const [ox, oz, kneel] of [[0, 1.45, 1], [0.6, 1.75, 0], [-0.6, 1.75, 0]]) spots.push([wx + ox, sd * oz, kneel, wx, 0]);
      spots.push([3.9, 0, 0, 0, 0], [-3.2, 0, 0, 0, 0], [2.4, -2.1, 0, 0, 0], [0.2, -2.0, 0, 0, 0], [-1.0, 2.1, 0, 0, 0]);
      for (const [x, z, kn, tx, tz] of spots) {
        const P = JRG.person(kn), m = new THREE.Group();
        for (const [geo, mat] of [[P.suit, body], [P.head, helm], [P.dark, dark]]) { const o = new THREE.Mesh(geo, mat); o.castShadow = true; m.add(o); }
        g.add(m); men.push({ m, x, z, ix: x * 0.55, iz: -3.3 - Math.random() * 1.4, face: Math.atan2(-(tz - z), tx - x), kn });
      }
      CREW[tm.name] = { g, men, k: 0 };
    });
  }
  function crewFrame(dt) {
    for (const tm of TEAMS) {
      const cr = CREW[tm.name]; if (!cr) continue;
      const car = G.cars.find(c => c.p && c.p.team === tm && c.pit && (c.pit.ph === 'stop' || (c.pit.ph === 'in' && c.pit.box - c.pit.u < 140) || (c.pit.ph === 'out' && c.pit.u - c.pit.box < 3)));
      cr.k += ((car ? 1 : 0) - cr.k) * Math.min(1, dt * (car ? 3 : 1.2));
      const t = performance.now() / 1000;
      cr.men.forEach((mm, i) => { mm.m.position.set(lerp(mm.ix, mm.x, cr.k), 0, lerp(mm.iz, mm.z, cr.k)); mm.m.rotation.y = cr.k > 0.5 ? mm.face : -Math.PI / 2 + Math.sin(t * 0.5 + i) * 0.4; if (car && car.pit.ph === 'stop') mm.m.position.y = Math.abs(Math.sin(t * 9 + i)) * 0.03; });
      // car on the jacks, wheels off for a moment
      for (const c of G.cars) if (c.p.team === tm) { const P = c.pit, up = P && P.ph === 'stop' ? sstep(0, 0.25, P.t) * sstep(P.dur, P.dur - 0.25, P.t) : 0; c.mesh.position.y = up * 0.07; for (const w of c.mesh.userData.wheels) w.spin.visible = !(P && P.ph === 'stop' && P.t / P.dur > 0.3 && P.t / P.dur < 0.45); }
    }
  }

  // ================= team radio =================
  let radioT = 0;
  function radio(msg) {
    const el = $('radio'); el.innerHTML = '<b>' + (G.me ? G.me.p.team.name.toUpperCase() : 'TEAM') + ' RADIO</b>' + msg; el.style.opacity = 1; radioT = 4.5; Snd.beep(1200, 0.05); setTimeout(() => Snd.beep(900, 0.05), 70);
    if (SET.voice === '1' && window.speechSynthesis) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(msg.replace(/<[^>]+>/g, '')); u.rate = 1.12; u.pitch = 0.9; u.volume = 0.8; speechSynthesis.speak(u); } catch (e) { } }
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
        if (G.mode2 === 'race' && (!G.fastest || lt < G.fastest.t)) { const was = G.fastest; G.fastest = { t: lt, c }; if (was && c === G.me) setTimeout(() => radio('That is purple. Fastest lap of the race.'), 2500); }
        if (c === G.me && G.mode2 === 'race' && !c.fin) lapRadio(c);
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
  function lapRadio(c) {
    const o = order(), p = o.indexOf(c) + 1, ahead = o[p - 2], left = G.laps - c.lapN;
    if (left === 1) return setTimeout(() => radio('Last lap. Bring it home.'), 2600);
    if (c.wear > 0.62 && !c.wantPit) return setTimeout(() => radio('Tyres are going off. Box this lap? Press B.'), 2600);
    if (c.wing > 0.2 && !c.wantPit) return setTimeout(() => radio('We see front wing damage. Box when you can, press B.'), 2600);
    if (G.mandatory && c.compsUsed.size < 2 && left <= 4 && !c.wantPit) return setTimeout(() => radio('Reminder: you still need your mandatory pit stop.'), 2600);
    if (p !== c.lastP && c.lastP) setTimeout(() => radio(p < c.lastP ? 'Nice move. P' + p + '.' : 'You are P' + p + ' now. Keep pushing.'), 2600);
    else if (ahead && Math.random() < 0.5) setTimeout(() => radio('P' + p + '. Gap to ' + ahead.name.split(' ').pop() + ' is ' + gapTo(ahead, c).toFixed(1) + '.'), 2600);
    c.lastP = p;
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
    G.state = 'done'; G.me.V = T.profile(0.85); G.me.ofs = 0; G.me.hold = false; G.me.wantPit = false;
    if (G.mandatory && G.me.compsUsed.size < 2) { G.pen += 20; G.noStop = true; }
    { const p = order().indexOf(G.me) + 1; setTimeout(() => radio(p === 1 ? 'Get in there! You have won it! Fantastic drive.' : p <= 3 ? 'P' + p + ', that is a podium! Great job.' : 'P' + p + '. Good effort, we go again.'), 1200); }
    toast('CHEQUERED FLAG', 'P' + (order().indexOf(G.me) + 1), 3);
    setTimeout(showResults, 3500);
  }
  function showResults() {
    if (G.mode !== 'run') return; $('fin').classList.remove('hidden'); G.resultsOn = true; renderResults();
  }
  function renderResults() {
    const o = order(), lead = o[0], me = G.me, myP = o.indexOf(me) + 1, pen = G.pen;
    $('finH').textContent = myP === 1 ? 'You win!' : 'P' + myP + ' at the flag';
    $('finS').textContent = F1T.CIRCUITS[+SET.circuit].name + ' · ' + G.laps + ' laps' + (pen ? ' · your time includes ' + pen + ' s of penalties' + (G.noStop ? ' (20 s for skipping the mandatory stop)' : '') : '');
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
    if (G.mode !== 'run') { if (world) { const a = now / 9000; chase.position.set(T.X[0] + Math.cos(a) * 30, 6, T.Z[0] + Math.sin(a) * 30); chase.lookAt(T.X[0], 1, T.Z[0]); draw(chase, 0); } return; }
    if (!G.paused) { readInput(dt); acc += dt; let n = 0; while (acc >= 1 / 120 && n < 8) { tick(1 / 120); acc -= 1 / 120; n++; } if (n === 8) acc = 0; }
    // the pre-race hold: brakes on for the player until lights out unless they creep
    const me = G.me;
    for (const c of G.cars) {
      const m = c.mesh, u = m.userData; m.position.set(c.x, 0, c.z); m.rotation.y = -c.h;
      u.body.rotation.z = clamp(-c.ax * 0.0009, -0.03, 0.03); u.body.rotation.x = clamp(-c.ay * 0.0006, -0.02, 0.02);
      u.spin -= c.vx / 0.36 * dt; for (const w of u.wheels) { w.spin.rotation.z = (w.fr || !c.spinR ? u.spin : u.spin * 1.3); if (w.fr) w.piv.rotation.y = -c.delta; }
      u.flap.rotation.z = c.drs ? -1.05 : -0.5; JRG.updateCar(c, dt);
      // sparks from the plank over kerbs and in compressions at speed; smoke from locked or spinning tyres
      if (!G.paused && SET.gfx === '1') {
        const ch = Math.cos(c.h), sh = Math.sin(c.h), wx = c.vx * ch - c.vy * sh, wz = c.vx * sh + c.vy * ch;
        if (c.v > 50 && Math.random() < (c.kerb ? 0.7 : c.ax < -25 ? 0.25 : 0.03)) for (let k = 0; k < 4; k++) FXS.spark(c.x - ch * (1.2 + Math.random() * 0.7), 0.06, c.z - sh * (1.2 + Math.random() * 0.7), wx * 0.75, wz * 0.75);
        const lk = Math.max(c.lockF, c.lockR, c.spinR); if (lk > 0.5 && c.v > 4 && Math.random() < 0.5) { const fwd = c.lockF > 0.5 ? F1.CA : -F1.CB; for (const sd of [-0.8, 0.8]) FXS.smoke(c.x + ch * fwd - sh * sd, 0.3, c.z + sh * fwd + ch * sd, wx * 0.3, wz * 0.3, lk); }
      }
    }
    if (!G.paused) FXS.step(dt); skyMat.uniforms.t.value += dt;
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
      cam.rotation.set(-0.06 + eyeS.pitch, -Math.PI / 2 + eyeS.yaw * (G.view === 0 ? 1 : 0.5), clamp(eyeS.roll, -0.05, 0.05));
      cam.fov = +SET.fov * (G.view === 0 ? 1 : 1.08); cam.updateProjectionMatrix();
    } else {
      camA = chase; const fx = Math.cos(me.h), fz = Math.sin(me.h);
      tmpV.set(me.x - fx * 7.5, 2.1, me.z - fz * 7.5); if (!G.chaseInit) { chaseP.copy(tmpV); G.chaseInit = true; } chaseP.lerp(tmpV, Math.min(1, dt * 8));
      chase.position.copy(chaseP); chase.lookAt(me.x + fx * 4, 0.9, me.z + fz * 4); chase.fov = 62; chase.updateProjectionMatrix();
    }
    if (G.camOv) { camA = chase; chase.position.copy(G.camOv.p); chase.lookAt(G.camOv.l); }
    me.mesh.userData.helm.forEach(o => o.visible = G.view === 2);
    // sun follows the camera for crisp shadows nearby
    camA.getWorldPosition(tmpV); sun.position.set(tmpV.x + SUN_DIR.x * 200, SUN_DIR.y * 200, tmpV.z + SUN_DIR.z * 200); sun.target.position.set(tmpV.x, 0, tmpV.z);
    scene.userData.sky.position.set(tmpV.x, 0, tmpV.z);
    crewFrame(dt);
    if (radioT > 0) { radioT -= dt; if (radioT <= 0) $('radio').style.opacity = 0; }
    $('visor').classList.toggle('hidden', !(G.view === 0 && SET.visor === '1'));
    $('steerBar').classList.toggle('hidden', SET.input !== 'mouse'); if (SET.input === 'mouse') $('steerI').style.left = (50 + ctl.st * 50) + '%';
    pitHud(); gmeter();
    // gantry lamps
    for (const l of gantryLamps) l.m.material.color.setHex(l.k < (G.lightsN || 0) ? 0xff2a10 : 0x220303);
    // cockpit: wheel angle, display, mirrors
    if (CK) {
      CK.inner.rotation.x = me.delta / F1.LOCK * 1.9; CK.sw.visible = G.view === 0; for (const a of CK.arms) for (const o of [a.up.m, a.up.cap, a.lo.m, a.lo.cap, a.cf, a.band]) o.visible = G.view === 0; if (G.view === 0) CK.update(me);
      CK.t += dt; if (CK.t > 1 / 20) { CK.t = 0; drawWheel(); }
      // physical rev LEDs and paddles
      { const n = 15, lit = clamp(Math.round((me.rpm - 9500) / (12100 - 9500) * n), 0, n), fl = (performance.now() / 90 | 0) % 2;
        CK.leds.forEach((l, i) => l.material.color.setRGB(...(me.limiter ? (fl ^ (i % 2) ? [0.2, 0.5, 3] : [0.02, 0.02, 0.02]) : i < lit ? (me.rpm > 11900 && fl ? [0.3, 0.5, 3] : i < 5 ? [0.2, 2.5, 0.4] : i < 10 ? [3, 0.15, 0.1] : [0.4, 0.5, 3]) : [0.03, 0.03, 0.03])));
        CK.flags.forEach(l => l.material.color.setRGB(...(me.drsOK && me.inDRS && !me.drs ? [0.2, 2.5, 0.4] : me.wantPit ? [2.5, 2, 0.2] : [0.03, 0.03, 0.03])));
        for (const k of ['up', 'down']) { CK.pad[k] = Math.max(0, CK.pad[k] - dt * 8); if (CK.paddles[k]) CK.paddles[k].rotation.y = (k === 'up' ? -1 : 1) * CK.pad[k] * 0.25; } }
      if (G.view === 0) { CK.fr = (CK.fr || 0) + 1; if (CK.fr % 2 === 0) { const vis = me.mesh.visible; R.setRenderTarget(CK.rt); R.render(scene, CK.mcam); R.setRenderTarget(null); } }
    }
    draw(camA, G.view < 2 ? clamp((v - 45) / 60, 0, 1) * 0.03 : clamp((v - 45) / 60, 0, 1) * 0.015);
    Snd.frame(me, G.cars, tmpV, camA.getWorldQuaternion(new THREE.Quaternion()), G.view);
    hudT += dt; if (hudT > 0.1) { hudT = 0; hud(); }
    hudFast(); mini();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
    if (G.resultsOn && !$('fin').classList.contains('hidden') && ((G.rt = (G.rt || 0) + dt) > 1)) { G.rt = 0; renderResults(); }
  }
  function draw(c, blur) {
    if (SET.gfx === '1') { POST.begin(); R.render(scene, c); POST.end(blur, Math.min(1, G.shake)); }
    else { R.setRenderTarget(null); R.render(scene, c); }
  }
  function drawWheel() {
    const x = CK.dx, me = G.me, W = 256, H = 140; x.fillStyle = '#050607'; x.fillRect(0, 0, W, H);
    if (me.pit) { const P = me.pit; x.fillStyle = P.ph === 'stop' ? '#0b0b0d' : (performance.now() / 250 | 0) % 2 ? '#1840c8' : '#0b1a50'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '900 30px system-ui'; x.fillText(P.ph === 'stop' ? P.t.toFixed(1) : 'PIT LIMITER', W / 2, 62); x.font = '700 18px system-ui'; x.fillText(P.ph === 'stop' ? 'STOPPED' : Math.round(me.v * 3.6) + ' / 80 KM/H', W / 2, 96); CK.dt.needsUpdate = true; return; }
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
  function pitHud() {
    const me = G.me, el = $('pitInfo'); let h = '';
    if (me.pit) { const P = me.pit; h = P.ph === 'stop' ? '<big>' + P.t.toFixed(1) + '</big>' + (P.wing ? 'changing the front wing' : 'tyres: ' + F1.COMP[P.comp].name) : me.limiter ? 'PIT LIMITER · 80 km/h' : ''; }
    else if (me.wantPit) h = 'BOX THIS LAP · ' + ['S', 'M', 'H'].map((k, i) => '<kbd>' + (i + 1) + '</kbd><span class="' + (me.nextComp === k ? 'on' : '') + '">' + F1.COMP[k].name + '</span>').join(' ') + ' · <kbd>B</kbd> cancel';
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
  }
  function gmeter() {
    const c = $('gm'), x = c.getContext('2d'), me = G.me; x.clearRect(0, 0, 192, 192);
    x.fillStyle = 'rgba(8,9,12,.6)'; x.beginPath(); x.arc(96, 96, 92, 0, 7); x.fill(); x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 2; for (const r of [30, 60, 90]) { x.beginPath(); x.arc(96, 96, r, 0, 7); x.stroke(); }
    G.gS = G.gS || { x: 0, y: 0 }; G.gS.x += (me.ay / 9.81 - G.gS.x) * 0.2; G.gS.y += (-me.ax / 9.81 - G.gS.y) * 0.2;
    const px = 96 + clamp(G.gS.x, -6, 6) * 15, py = 96 - clamp(G.gS.y, -6, 6) * 15; x.fillStyle = '#ffcc33'; x.beginPath(); x.arc(px, py, 8, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = '800 22px ui-monospace,monospace'; x.textAlign = 'center'; x.fillText(Math.hypot(G.gS.x, G.gS.y).toFixed(1) + 'G', 96, 186);
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
