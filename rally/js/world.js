'use strict';
// World rendering: renderer, sky, light, fog, terrain tiles, forest, undergrowth, logs, start/finish, dust.
const TOD = {
  morning: { sun: [0.55, 0.42, 0.72], sunC: 0xffe2b8, sunI: 3.0, zen: 0x6d93c4, hor: 0xd9d4c4, fog: 0xbfc3bb, hemiS: 0xbcd0e6, hemiG: 0x4a4430, hemiI: 1.1, exp: 1.0 },
  overcast: { sun: [0.3, 0.75, 0.4], sunC: 0xe8ecf0, sunI: 1.3, zen: 0x8e98a2, hor: 0xc4c8c8, fog: 0xa9aeac, hemiS: 0xcdd3d8, hemiG: 0x45443a, hemiI: 1.7, exp: 1.05 },
  evening: { sun: [-0.7, 0.22, 0.55], sunC: 0xffb070, sunI: 2.8, zen: 0x3f5c8a, hor: 0xe8a878, fog: 0xa89a8c, hemiS: 0x9fb0cc, hemiG: 0x3e3226, hemiI: 1.0, exp: 1.1 },
  noon: { sun: [0.25, 0.9, 0.3], sunC: 0xfff4e0, sunI: 3.4, zen: 0x4f86c6, hor: 0xc8d8e4, fog: 0xb8c4c6, hemiS: 0xc2d6ec, hemiG: 0x4c4632, hemiI: 1.0, exp: 0.95 },
};
const FOG_D = [0.0068, 0.0115, 0.0185];

const World = {
  init(canvas, gfx) {
    const R = this.R = new THREE.WebGLRenderer({ canvas, antialias: gfx !== 'low', powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(devicePixelRatio || 1, gfx === 'high' ? 2 : gfx === 'med' ? 1.5 : 1));
    R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
    R.shadowMap.enabled = gfx !== 'low'; R.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gfx = gfx;
    this.cam = new THREE.PerspectiveCamera(72, 1, 0.05, 600);
    addEventListener('resize', () => this.resize()); this.resize();
  },
  resize() { const w = innerWidth, h = innerHeight; this.R.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); },
  build(S, fogLevel) {
    this.dispose(); const T = TEX(), tod = TOD[S.cfg.tod] || TOD.morning, scene = this.scene = new THREE.Scene(), gfx = this.gfx;
    this.S = S; this.tod = tod;
    const den = FOG_D[fogLevel] || FOG_D[1];
    scene.fog = new THREE.FogExp2(tod.fog, den); scene.background = new THREE.Color(tod.fog);
    this.far = Math.min(520, 2.6 / den); this.cam.far = this.far + 40; this.cam.updateProjectionMatrix();
    this.R.toneMappingExposure = tod.exp;
    // sky dome: gradient into the fog colour at the horizon, sun disk
    const sunDir = new THREE.Vector3(...tod.sun).normalize(); this.sunDir = sunDir;
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { zen: { value: new THREE.Color(tod.zen) }, hor: { value: new THREE.Color(tod.hor) }, fogC: { value: new THREE.Color(tod.fog) }, sun: { value: sunDir }, sunC: { value: new THREE.Color(tod.sunC) }, haze: { value: clamp(den * 60, 0.3, 1) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.9999; }',
      fragmentShader: 'uniform vec3 zen,hor,fogC,sun,sunC; uniform float haze; varying vec3 vD; void main(){ float y = max(vD.y,0.); vec3 c = mix(hor, zen, pow(y, .55)); float s = max(dot(normalize(vD), sun), 0.); c += sunC*(pow(s, 900.)*6. + pow(s, 12.)*.25)*(1.-haze*.6); c = mix(c, fogC, (1.-smoothstep(0., .45, y))*haze); gl_FragColor = vec4(c,1.); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -1; scene.add(this.sky);
    // environment map from the sky for paint and glass reflections
    const pm = new THREE.PMREMGenerator(this.R), es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat.clone()));
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0x2c3326 })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.5; es.add(gnd);
    scene.environment = pm.fromScene(es, 0.02).texture; scene.environmentIntensity = 0.55;
    // lights
    const sun = this.sun = new THREE.DirectionalLight(tod.sunC, tod.sunI); scene.add(sun, sun.target);
    if (gfx !== 'low') {
      sun.castShadow = true; const sz = gfx === 'high' ? 4096 : 2048, ext = gfx === 'high' ? 85 : 65; sun.shadow.mapSize.set(sz, sz);
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 400 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.camera.updateProjectionMatrix();
    }
    scene.add(this.hemi = new THREE.HemisphereLight(tod.hemiS, tod.hemiG, tod.hemiI));
    this.buildTerrain(S, T); this.buildForest(S, T); this.buildProps(S, T); this.buildDust(T);
  },
  buildTerrain(S, T) {
    const G = S.grid, TS = 32, mat = new THREE.MeshStandardMaterial({ map: T.floor.map, normalMap: T.floor.nrm, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.roadMap = { value: T.road.map }; sh.uniforms.roadNrm = { value: T.road.nrm };
      sh.vertexShader = 'attribute float aRoad; attribute vec2 aRuv; varying float vRoad; varying vec2 vRuv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vRoad = aRoad; vRuv = vec2(aRuv.x/10.+.5, aRuv.y/16.);');
      sh.fragmentShader = 'uniform sampler2D roadMap, roadNrm; varying float vRoad; varying vec2 vRuv;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(roadMap, vRuv).rgb, vRoad);')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz, texture2D( roadNrm, vRuv ).xyz, vRoad) * 2.0 - 1.0;'))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .86, vRoad);');
    };
    this.tiles = []; const nz = S.noise;
    for (let tj = 0; tj < G.GH - 1; tj += TS) for (let ti = 0; ti < G.GW - 1; ti += TS) {
      const w = Math.min(TS, G.GW - 1 - ti), h = Math.min(TS, G.GH - 1 - tj); let need = false;
      for (let j = tj; j <= tj + h && !need; j += 2) for (let i = ti; i <= ti + w; i += 2) if (G.RD[j * G.GW + i] < 48) { need = true; break; }
      if (!need) continue;
      const nv = (w + 1) * (h + 1), pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), rd = new Float32Array(nv), ruv = new Float32Array(nv * 2);
      let v = 0;
      for (let j = tj; j <= tj + h; j++) for (let i = ti; i <= ti + w; i++, v++) {
        const k = j * G.GW + i, x = G.x0 + i * CELL, z = G.z0 + j * CELL, y = G.H[k];
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const hl = G.H[j * G.GW + Math.max(0, i - 1)], hr = G.H[j * G.GW + Math.min(G.GW - 1, i + 1)], hd = G.H[Math.max(0, j - 1) * G.GW + i], hu = G.H[Math.min(G.GH - 1, j + 1) * G.GW + i];
        let nx = hl - hr, ny = 2 * CELL, nzz = hd - hu; const il = 1 / Math.hypot(nx, ny, nzz); nor[v * 3] = nx * il; nor[v * 3 + 1] = ny * il; nor[v * 3 + 2] = nzz * il;
        uv[v * 2] = x / 6; uv[v * 2 + 1] = z / 6;
        rd[v] = G.RF[k]; ruv[v * 2] = G.RU[k]; ruv[v * 2 + 1] = G.RV[k];
        // tint: grassier at the sunny road edge, darker deep in the forest
        const d = G.RD[k], edge = 1 - sstep(ROAD_HW + 1, ROAD_HW + 7, d), deep = sstep(ROAD_HW + 6, 30, d), n = nz(x * 0.05 + 17, z * 0.05);
        let r = 1 - deep * 0.35 + n * 0.08, g = 1 - deep * 0.3 + n * 0.08, b = 1 - deep * 0.3;
        r = lerp(r, 0.85, edge); g = lerp(g, 1.25, edge); b = lerp(b, 0.7, edge);
        const rf = G.RF[k]; col[v * 3] = lerp(r, 1, rf); col[v * 3 + 1] = lerp(g, 1, rf); col[v * 3 + 2] = lerp(b, 1, rf);
      }
      const idx = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aRoad', new THREE.BufferAttribute(rd, 1)); geo.setAttribute('aRuv', new THREE.BufferAttribute(ruv, 2));
      geo.setIndex(idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; this.scene.add(m);
      this.tiles.push({ cx: G.x0 + (ti + w / 2) * CELL, cz: G.z0 + (tj + h / 2) * CELL, objs: [m] });
    }
  },
  // merge simple non-indexed geometries with position/normal/uv/color
  merge(list) {
    let n = 0; const gs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; n += q.attributes.position.count; return q; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3); let o = 0;
    for (const g of gs) {
      const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
      if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3); o += c;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere(); return geo;
  },
  // ragged conifer foliage: stacked open cones, jittered, darker inside/low
  foliage(rng, layers, y0, y1, r0, r1, droop) {
    const parts = [];
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1), y = lerp(y0, y1, t), r = lerp(r0, r1, t) * (0.85 + rng() * 0.3), hh = lerp(2.4, 1.3, t) * (y1 - y0) / 10 + 0.6;
      const g = new THREE.ConeGeometry(r, hh, 9, 2, true); const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const vy = p.getY(k), rr = Math.hypot(p.getX(k), p.getZ(k)), j = 1 + (rng() - 0.5) * 0.3;
        p.setX(k, p.getX(k) * j); p.setZ(k, p.getZ(k) * j); p.setY(k, vy + y - (rr / Math.max(r, 0.01)) * droop * rng());
        const sh = 0.55 + 0.45 * t + (vy > 0 ? 0.15 : 0); c[k * 3] = sh; c[k * 3 + 1] = sh; c[k * 3 + 2] = sh;
      }
      g.rotateY(rng() * 6.28); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
      // tilt normals outward/up so the cone shades like a soft volume
      const nn = g.attributes.normal; for (let k = 0; k < nn.count; k++) { const x = p.getX(k), z = p.getZ(k), l = Math.hypot(x, z) || 1; nn.setXYZ(k, x / l * 0.7, 0.7, z / l * 0.7); }
      parts.push(g);
    }
    return this.merge(parts);
  },
  buildForest(S, T) {
    const rng = mulberry(42);
    const trunk = (h, r) => { const g = new THREE.CylinderGeometry(r * 0.55, r, h, 7, 1, true); g.translate(0, h / 2 - 0.3, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 2); return g; };
    const kinds = [
      { trunk: trunk(5, 0.24), fol: this.foliage(rng, 8, 1.6, 15.5, 2.9, 0.35, 0.9), lo: this.foliage(rng, 4, 1.8, 15, 2.8, 0.4, 0.6), tint: [0.85, 1.05] },
      { trunk: trunk(15, 0.26), fol: this.foliage(rng, 5, 10.5, 17, 2.4, 0.4, 0.5), lo: this.foliage(rng, 3, 10.8, 16.5, 2.4, 0.5, 0.4), tint: [0.9, 1.2] },
      { trunk: trunk(3, 0.15), fol: this.foliage(rng, 6, 0.8, 7.5, 1.7, 0.25, 0.6), lo: this.foliage(rng, 3, 1, 7.2, 1.7, 0.3, 0.4), tint: [0.95, 1.25] },
    ];
    const barkM = new THREE.MeshStandardMaterial({ map: T.bark.map, normalMap: T.bark.nrm, roughness: 1 });
    const folM = new THREE.MeshStandardMaterial({ map: T.needles, vertexColors: true, roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide });
    // bucket trees by terrain tile
    const byTile = new Map(), tileOf = (x, z) => { let best = null, bd = 1e9; for (const t of this.tiles) { const d = Math.abs(t.cx - x) + Math.abs(t.cz - z); if (d < bd) { bd = d; best = t; } } return best; };
    const TSZ = 64, key = (x, z) => Math.floor((x - S.grid.x0) / TSZ) + ',' + Math.floor((z - S.grid.z0) / TSZ), tmap = new Map();
    for (const t of this.tiles) tmap.set(key(t.cx, t.cz), t);
    for (const tr of S.trees) { const tl = tmap.get(key(tr.x, tr.z)) || tileOf(tr.x, tr.z); let a = byTile.get(tl); if (!a) byTile.set(tl, a = []); a.push(tr); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const shadows = this.gfx !== 'low';
    for (const [tl, list] of byTile) for (let k = 0; k < 3; k++) {
      const L = list.filter(t => t.kind === k); if (!L.length) continue;
      const mt = new THREE.InstancedMesh(kinds[k].trunk, barkM, L.length), mf = new THREE.InstancedMesh(kinds[k].fol, folM, L.length);
      L.forEach((t, i) => {
        e.set((rng() - 0.5) * 0.06, t.rot, (rng() - 0.5) * 0.06); q.setFromEuler(e); v.set(t.x, t.y, t.z); const s = t.sc * (k === 2 ? 0.9 : 1); sc.set(s, s * (0.9 + rng() * 0.25), s);
        m4.compose(v, q, sc); mt.setMatrixAt(i, m4); mf.setMatrixAt(i, m4);
        const tn = lerp(kinds[k].tint[0], kinds[k].tint[1], rng()); c.setRGB(tn * (0.9 + rng() * 0.15), tn, tn * (0.85 + rng() * 0.2)); mf.setColorAt(i, c);
      });
      mt.castShadow = mf.castShadow = shadows; mt.receiveShadow = mf.receiveShadow = shadows;
      mt.computeBoundingSphere(); mf.computeBoundingSphere();
      // low-detail foliage for distant tiles (same instances)
      const ml = new THREE.InstancedMesh(kinds[k].lo, folM, L.length); ml.instanceMatrix.copy(mf.instanceMatrix); if (mf.instanceColor) ml.instanceColor = mf.instanceColor; ml.computeBoundingSphere(); ml.castShadow = false;
      this.scene.add(mt, mf, ml); tl.objs.push(mt); (tl.hi = tl.hi || []).push(mf); (tl.lo = tl.lo || []).push(ml);
    }
  },
  buildProps(S, T) {
    const rng = mulberry(S.cfg.seed + 9), scene = this.scene;
    // undergrowth: crossed quads (fern / grass) along the verges and scattered in the forest
    const quad = (u0, u1) => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, lerp(u0, u1, uv.getX(i))); return g; };
    const cross = (u0, u1) => { const a = quad(u0, u1), b = quad(u0, u1); b.rotateY(Math.PI / 2); const g = this.merge([a, b]); const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); return g; };
    const gFern = cross(0, 0.5), gGrass = cross(0.55, 0.95);
    const pm = new THREE.MeshStandardMaterial({ map: T.plants, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
    const items = [[], []];
    const dens = this.gfx === 'low' ? 1 : this.gfx === 'med' ? 2 : 3;
    for (let s = 20; s < S.L; s += 2.2 / dens) for (const sd of [-1, 1]) {
      const p = S.at(s), rx = -Math.cos(p.h), rz = Math.sin(p.h), d = ROAD_HW + 0.9 + rng() * rng() * 9, x = p.x + rx * sd * d + (rng() - 0.5) * 2, z = p.z + rz * sd * d + (rng() - 0.5) * 2;
      const q = S.near(x, z, 10); if (!q || q.d < ROAD_HW + 0.6) continue;
      items[rng() < 0.45 ? 0 : 1].push([x, S.heightAt(x, z) - 0.05, z, 0.5 + rng() * 0.9, rng() * 6.28]);
    }
    for (const t of S.trees) if (rng() < 0.18 * dens) { const a = rng() * 6.28, r = 1.2 + rng() * 1.5, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r; items[0].push([x, S.heightAt(x, z) - 0.05, z, 0.6 + rng() * 0.8, rng() * 6.28]); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // bucket plants into tiles too (so they cull with distance)
    const tileFor = (x, z) => { let best = null, bd = 1e9; for (const t of this.tiles) { const d = Math.max(Math.abs(t.cx - x), Math.abs(t.cz - z)); if (d < bd) { bd = d; best = t; } } return best; };
    [gFern, gGrass].forEach((geo, k) => {
      const groups = new Map(); for (const it of items[k]) { const t = tileFor(it[0], it[2]); let a = groups.get(t); if (!a) groups.set(t, a = []); a.push(it); }
      for (const [tl, L] of groups) {
        const im = new THREE.InstancedMesh(geo, pm, L.length);
        L.forEach((it, i) => { q.setFromAxisAngle(up, it[4]); v.set(it[0], it[1], it[2]); const s = it[3] * (k ? 0.8 : 1.1); sc.set(s * 1.4, s, s * 1.4); m4.compose(v, q, sc); im.setMatrixAt(i, m4); });
        im.computeBoundingSphere(); im.receiveShadow = this.gfx !== 'low'; this.scene.add(im); tl.objs.push(im);
      }
    });
    // rocks on the verges
    const rg = new THREE.DodecahedronGeometry(1, 1); { const p = rg.attributes.position; for (let i = 0; i < p.count; i++) { const f = 0.75 + 0.5 * Math.abs(Math.sin(p.getX(i) * 5.1 + p.getZ(i) * 3.7)); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.6, p.getZ(i) * f); } rg.computeVertexNormals(); }
    const rocks = []; for (let s = 30; s < S.L; s += 9) if (rng() < 0.55) { const p = S.at(s), sd = rng() < 0.5 ? -1 : 1, d = ROAD_HW + 1.5 + rng() * 4, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; rocks.push([x, S.heightAt(x, z), z, 0.25 + rng() * rng() * 0.9, rng() * 6]); }
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x8a877e, roughness: 0.9, map: T.floor.map }), rocks.length);
    rocks.forEach((r, i) => { e.set(rng(), r[4], rng()); q.setFromEuler(e); v.set(r[0], r[1], r[2]); sc.set(r[3], r[3], r[3]); m4.compose(v, q, sc); rm.setMatrixAt(i, m4); });
    rm.castShadow = rm.receiveShadow = this.gfx !== 'low'; scene.add(rm);
    // red/white marker posts every 20 m on both verges: strong speed cue
    { const pg = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6); pg.translate(0, 0.55, 0); const pc = new Float32Array(pg.attributes.position.count * 3); for (let i = 0; i < pg.attributes.position.count; i++) { const y = pg.attributes.position.getY(i), red = y > 0.8; pc[i * 3] = red ? 0.85 : 0.95; pc[i * 3 + 1] = red ? 0.1 : 0.95; pc[i * 3 + 2] = red ? 0.08 : 0.92; } pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
      const posts = []; for (let s = 50; s < S.L - 40; s += 20) for (const sd of [-1, 1]) { const p = S.at(s), d = ROAD_HW + 1.1, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; if (S.logs.some(l => Math.abs(l.s - s) < 6)) continue; posts.push([x, S.heightAt(x, z), z]); }
      const pm2 = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), posts.length); posts.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); pm2.setMatrixAt(i, m4); }); pm2.castShadow = this.gfx !== 'low'; pm2.computeBoundingSphere(); scene.add(pm2); }
    // logs across half the road
    const barkM = new THREE.MeshStandardMaterial({ map: T.bark.map, normalMap: T.bark.nrm, roughness: 1 }), endM = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
    for (const l of S.logs) {
      const len = Math.hypot(l.bx - l.ax, l.bz - l.az), g = new THREE.CylinderGeometry(l.rad, l.rad * 1.08, len, 12, 1, false);
      const m = new THREE.Mesh(g, [barkM, endM, endM]); const mx = (l.ax + l.bx) / 2, mz = (l.az + l.bz) / 2;
      m.position.set(mx, l.cy, mz);
      m.quaternion.setFromUnitVectors(up, new THREE.Vector3(l.bx - l.ax, 0, l.bz - l.az).normalize()); m.castShadow = m.receiveShadow = true; scene.add(m);
      // a broken branch stub for realism
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5), barkM); br.position.set(0, len * 0.2, l.rad); br.rotation.x = 1.0; m.add(br);
    }
    // start and finish gantries
    const banner = (txt, col) => { const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 1024, 160); g.fillStyle = '#fff'; g.font = '900 italic 104px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 512, 84); g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 16; i++) g.fillRect(i * 64, 0, 32, 12); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const gantry = (s, txt, col) => {
      const p = S.at(s), grp = new THREE.Group(), postM = new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.6, roughness: 0.4 });
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), postM); post.position.set(sd * (ROAD_HW + 1.4), 3, 0); post.castShadow = true; grp.add(post); }
      const b = new THREE.Mesh(new THREE.BoxGeometry(2 * ROAD_HW + 3.2, 1.3, 0.2), [postM, postM, postM, postM, new THREE.MeshStandardMaterial({ map: banner(txt, col), roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: banner(txt, col), roughness: 0.6 })]);
      b.position.y = 5.6; b.castShadow = true; grp.add(b);
      grp.position.set(p.x, p.y - 0.2, p.z); grp.rotation.y = p.h; scene.add(grp);
      // tape and cones along the start/finish zone
      const coneM = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
      for (let k = -3; k <= 3; k++) for (const sd of [-1, 1]) { const qq = S.at(s + k * 4), x = qq.x - Math.cos(qq.h) * sd * (ROAD_HW + 0.6), z = qq.z + Math.sin(qq.h) * sd * (ROAD_HW + 0.6), c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 10), coneM); c.position.set(x, S.heightAt(x, z) + 0.25, z); c.castShadow = true; scene.add(c); }
    };
    this.startS = 40; this.finishS = S.L - 60;
    gantry(this.startS, 'START  ·  ' + S.cfg.name.toUpperCase(), '#b5241b'); gantry(this.finishS, 'FLYING FINISH', '#1b4fb5');
    // split markers are invisible (timing only)
  },
  // dust and gravel spray: one Points cloud with per-particle size and alpha, fog applied by hand
  buildDust(T) {
    const n = 700, geo = new THREE.BufferGeometry();
    this.dp = { n, i: 0, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), a: new Float32Array(n), col: new Float32Array(n * 3) };
    geo.setAttribute('position', new THREE.BufferAttribute(this.dp.pos, 3)); geo.setAttribute('sz', new THREE.BufferAttribute(this.dp.size, 1)); geo.setAttribute('al', new THREE.BufferAttribute(this.dp.a, 1)); geo.setAttribute('cl', new THREE.BufferAttribute(this.dp.col, 3));
    const fog = this.scene.fog;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: T.dust }, fogC: { value: fog.color }, den: { value: fog.density }, sc: { value: innerHeight } },
      vertexShader: 'attribute float sz, al; attribute vec3 cl; varying float vA, vF; varying vec3 vC; uniform float den, sc; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; float d = -mv.z; gl_PointSize = sz*sc*.6/max(d,.1); vA = al; vC = cl; vF = 1.-exp(-den*den*d*d); }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 fogC; varying float vA, vF; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(mix(vC, fogC, vF), t.a*vA); }',
      transparent: true, depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat); this.dust.frustumCulled = false; this.scene.add(this.dust);
  },
  puff(x, y, z, vx, vy, vz, size, life, r, g, b) {
    const d = this.dp, i = d.i; d.i = (i + 1) % d.n;
    d.pos[i * 3] = x; d.pos[i * 3 + 1] = y; d.pos[i * 3 + 2] = z; d.vel[i * 3] = vx; d.vel[i * 3 + 1] = vy; d.vel[i * 3 + 2] = vz; d.life[i] = d.max[i] = life; d.size[i] = size; d.col[i * 3] = r; d.col[i * 3 + 1] = g; d.col[i * 3 + 2] = b;
  },
  stepDust(dt) {
    const d = this.dp;
    for (let i = 0; i < d.n; i++) {
      if (d.life[i] <= 0) { d.a[i] = 0; continue; }
      d.life[i] -= dt; const t = 1 - d.life[i] / d.max[i];
      d.vel[i * 3] *= 1 - dt * 1.5; d.vel[i * 3 + 1] = d.vel[i * 3 + 1] * (1 - dt * 1.5) + dt * 0.25; d.vel[i * 3 + 2] *= 1 - dt * 1.5;
      d.pos[i * 3] += d.vel[i * 3] * dt; d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt; d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * dt;
      d.size[i] += dt * 2.2; d.a[i] = Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t) * 0.45;
    }
    const g = this.dust.geometry; g.attributes.position.needsUpdate = g.attributes.sz.needsUpdate = g.attributes.al.needsUpdate = g.attributes.cl.needsUpdate = true;
    this.dust.material.uniforms.sc.value = innerHeight;
  },
  update(camPos, focus) {
    const lim = this.far + 60;
    for (const t of this.tiles) { const d = Math.hypot(t.cx - camPos.x, t.cz - camPos.z), vis = d < lim, near = d < 110; for (const o of t.objs) o.visible = vis; if (t.hi) { for (const o of t.hi) o.visible = vis && near; for (const o of t.lo) o.visible = vis && !near; } }
    this.sky.position.copy(camPos);
    const s = this.sun, f = focus || camPos;
    s.position.set(f.x + this.sunDir.x * 150, f.y + this.sunDir.y * 150, f.z + this.sunDir.z * 150); s.target.position.set(f.x, f.y, f.z);
    // snap the shadow camera to texels to stop shimmering
    if (s.castShadow) { s.target.updateMatrixWorld(); }
  },
  render() { this.R.render(this.scene, this.cam); },
  dispose() { if (!this.scene) return; this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.scene = null; },
};
