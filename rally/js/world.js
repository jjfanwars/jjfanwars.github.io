'use strict';
// World rendering: renderer, sky, light, fog, terrain tiles, forest, undergrowth, logs, start/finish, dust.
const TOD = {
  morning: { sun: [0.55, 0.42, 0.72], sunC: 0xffe2b8, sunI: 3.0, zen: 0x6d93c4, hor: 0xd9d4c4, fog: 0xbfc3bb, hemiS: 0xbcd0e6, hemiG: 0x4a4430, hemiI: 1.1, exp: 1.0 },
  overcast: { sun: [0.3, 0.75, 0.4], sunC: 0xe8ecf0, sunI: 1.3, zen: 0x8e98a2, hor: 0xc4c8c8, fog: 0xa9aeac, hemiS: 0xcdd3d8, hemiG: 0x45443a, hemiI: 1.7, exp: 1.05 },
  evening: { sun: [-0.7, 0.22, 0.55], sunC: 0xffb070, sunI: 2.8, zen: 0x3f5c8a, hor: 0xe8a878, fog: 0xa89a8c, hemiS: 0x9fb0cc, hemiG: 0x3e3226, hemiI: 1.0, exp: 1.1 },
  noon: { sun: [0.25, 0.9, 0.3], sunC: 0xfff4e0, sunI: 3.4, zen: 0x4f86c6, hor: 0xc8d8e4, fog: 0xb8c4c6, hemiS: 0xc2d6ec, hemiG: 0x4c4632, hemiI: 1.0, exp: 0.95 },
  autumnDay: { sun: [0.5, 0.45, 0.6], sunC: 0xffd8a0, sunI: 3.0, zen: 0x7a9cc6, hor: 0xe0d0b0, fog: 0xc8b89a, hemiS: 0xd0c8b0, hemiG: 0x504030, hemiI: 1.1, exp: 1.0 },
  snowDay: { sun: [0.4, 0.35, 0.7], sunC: 0xfff2e0, sunI: 2.6, zen: 0x7f9fcf, hor: 0xe4ecf4, fog: 0xd6dee8, hemiS: 0xe8f0ff, hemiG: 0x8090a0, hemiI: 1.3, exp: 0.8 },
  snowDusk: { sun: [-0.6, 0.15, 0.6], sunC: 0xff9a60, sunI: 2.2, zen: 0x2c3f6a, hor: 0xd09080, fog: 0x9a98a8, hemiS: 0x9fb0d0, hemiG: 0x606070, hemiI: 1.1, exp: 1.0 },
  desertNoon: { sun: [0.3, 0.85, 0.35], sunC: 0xfff0d8, sunI: 3.8, zen: 0x3f78c8, hor: 0xe8d4b0, fog: 0xdcc6a0, hemiS: 0xc8d8f0, hemiG: 0x8a6a48, hemiI: 0.9, exp: 0.88 },
  desertDusk: { sun: [-0.75, 0.18, 0.5], sunC: 0xff8a50, sunI: 3.0, zen: 0x34508a, hor: 0xf0a070, fog: 0xc09878, hemiS: 0xa0a8c8, hemiG: 0x6a4a38, hemiI: 0.9, exp: 1.05 },
  cityDay: { sun: [0.4, 0.6, 0.5], sunC: 0xf0f0f0, sunI: 2.0, zen: 0x8ea0b4, hor: 0xc8ccd0, fog: 0xb4b8bc, hemiS: 0xd0d8e0, hemiG: 0x505050, hemiI: 1.4, exp: 1.0 },
  cityDusk: { sun: [-0.6, 0.18, 0.6], sunC: 0xffa070, sunI: 2.2, zen: 0x26355a, hor: 0xe09878, fog: 0x8a7e86, hemiS: 0x8090b0, hemiG: 0x403838, hemiI: 1.0, exp: 1.1, lamps: true },
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
  resize() { const w = innerWidth, h = innerHeight; this.R.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); if (this.pp) this.ppSize(); },
  // ---- post: HDR scene target -> bright pass -> blurred bloom -> composite (ACES, grade, vignette, speed blur, grain) ----
  ppInit() {
    const R = this.R, HF = THREE.HalfFloatType;
    const rt = (w, h, ms) => new THREE.WebGLRenderTarget(w, h, { type: HF, samples: ms || 0, depthBuffer: !!ms });
    const quad = mat => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; const sc = new THREE.Scene(); sc.add(m); return sc; };
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const bright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722)); gl_FragColor = vec4(c * smoothstep(1.1, 2.6, l), 1.); }', depthTest: false, depthWrite: false });
    const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d * 1.38).rgb + texture2D(t, vUv - d * 1.38).rgb) * .316; c += (texture2D(t, vUv + d * 3.23).rgb + texture2D(t, vUv - d * 3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }', depthTest: false, depthWrite: false });
    const comp = new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, b: { value: null }, exp: { value: 1 }, spd: { value: 0 }, time: { value: 0 }, hurt: { value: 0 }, asp: { value: 1 } },
      vertexShader: vs,
      fragmentShader: `uniform sampler2D t, b; uniform float exp, spd, time, hurt, asp; varying vec2 vUv;
        vec3 aces(vec3 c){ c *= exp / .6; mat3 i = mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777); mat3 o = mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602); c = i * c; vec3 a = c * (c + .0245786) - .000090537; vec3 bb = c * (.983729 * c + .4329510) + .238081; return clamp(o * (a / bb), 0., 1.); }
        vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1./2.4)) - .055, step(.0031308, c)); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
        void main(){
          vec2 d = vUv - .5; float r = length(d * vec2(asp, 1.));
          // speed blur: smear toward the centre, only at the edges, grows with speed
          float k = spd * smoothstep(.15, .75, r) * .035; vec3 c = vec3(0.);
          for (int i = 0; i < 6; i++) c += texture2D(t, vUv - d * k * float(i) / 5.).rgb; c /= 6.;
          c += texture2D(b, vUv).rgb * .55;
          c = aces(c);
          // grade: a little warmth in the highlights, cool shadows, slight saturation
          float l = dot(c, vec3(.2126,.7152,.0722)); c = mix(vec3(l), c, 1.08); c *= mix(vec3(.96,.99,1.04), vec3(1.03,1.,.95), smoothstep(.1,.8,l));
          c *= 1. - smoothstep(.45, 1.25, r) * (.38 + hurt * .4); c = mix(c, c * vec3(1.,.55,.5), hurt * smoothstep(.3, 1., r));
          c = srgb(c); c += (h(vUv * 917.) - .5) * .018;
          gl_FragColor = vec4(c, 1.); }`,
      depthTest: false, depthWrite: false });
    this.pp = { rt, A: null, B1: null, B2: null, sBright: quad(bright), sBlur: quad(blur), sComp: quad(comp), bright, blur, comp, oc: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    this.ppSize();
  },
  ppSize() {
    const P = this.pp, R = this.R, v = R.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, v.x), h = Math.max(2, v.y);
    for (const k of ['A', 'B1', 'B2']) if (P[k]) P[k].dispose();
    P.A = P.rt(w, h, this.gfx === 'high' ? 4 : 2); P.B1 = P.rt(w >> 2, h >> 2); P.B2 = P.rt(w >> 2, h >> 2);
    P.comp.uniforms.asp.value = w / h;
  },
  // photo textures (Poly Haven, CC0), loaded once each and kept
  photos(B) {
    B = B || BIOMES.forest; this._tx = this._tx || {}; this.PH = this.PH || {};
    const L = new THREE.TextureLoader(), A = this.R.capabilities.getMaxAnisotropy(), need = [[B.road, 'gravel'], [B.ground, 'floor'], ['bark', 'bark']];
    if (B.city) need.push(['brick', 'brick'], ['plaster', 'plaster']);
    if (B.banks) need.push(['snow', 'snowbank']);
    const ld = (f, srgb, rep) => this._tx[f + rep] || (this._tx[f + rep] = new Promise(res => L.load('tex/' + f + '.jpg?v=1', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, A); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.repeat.set(rep, rep); res(t); }, undefined, () => res(null))));
    return Promise.all(need.map(([f, as]) => Promise.all([ld(f + '_diff', 1, as === 'floor' ? 2 : 0), ld(f + '_nor', 0, as === 'floor' ? 2 : 0)]).then(([d, n]) => { this.PH[as] = d; this.PH[as + 'N'] = n; })));
  },
  build(S, fogLevel) {
    const B = this.B = S.B || BIOMES.forest, RK = { gravel: 'gravel', leafroad: 'leaf', snowroad: 'snow', sandroad: 'sand', asphalt: 'tarmac' };
    this.dispose(); const T = TEX(RK[B.road] || 'gravel', B.hw), tod = TOD[S.cfg.tod] || TOD.morning, scene = this.scene = new THREE.Scene(), gfx = this.gfx;
    this.S = S; this.tod = tod;
    const den = (FOG_D[fogLevel] || FOG_D[1]) * B.fogK;
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
    const PH = this.PH || {}, B = this.B, G = S.grid, TS = 32, mat = new THREE.MeshStandardMaterial({ map: PH.floor || T.floor.map, normalMap: PH.floorN || T.floor.nrm, normalScale: new THREE.Vector2(1, 1), vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.roadMap = { value: T.road.map }; sh.uniforms.roadNrm = { value: T.road.nrm }; sh.uniforms.grav = { value: PH.gravel || T.road.map }; sh.uniforms.gravN = { value: PH.gravelN || T.road.nrm }; sh.uniforms.hasG = { value: PH.gravel ? 1 : 0 };
      sh.vertexShader = 'attribute float aRoad; attribute vec2 aRuv; varying float vRoad; varying vec2 vRuv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vRoad = aRoad; vRuv = vec2(aRuv.x/12.+.5, aRuv.y/16.);');
      sh.fragmentShader = 'uniform sampler2D roadMap, roadNrm, grav, gravN; uniform float hasG; varying float vRoad; varying vec2 vRuv;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n vec4 rc4 = texture2D(roadMap, vRuv); vec3 rc = rc4.rgb; vec3 gc = texture2D(grav, vMapUv * 0.75).rgb * clamp(rc / vec3(.2,.15,.095), 0., 1.7); vec3 road = mix(rc, gc, hasG); road = mix(road, vec3(.78,.78,.74), (1. - rc4.a) * 1.4); diffuseColor.rgb = mix(diffuseColor.rgb, road, vRoad);')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz, mix(texture2D( roadNrm, vRuv ).xyz, texture2D( gravN, vNormalMapUv * 0.75 ).xyz, hasG * .7), vRoad) * 2.0 - 1.0;'))
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
        if (B.flora === 'fir') { r = lerp(r, 0.85, edge); g = lerp(g, 1.25, edge); b = lerp(b, 0.7, edge); }
        else if (B.flora === 'snow' || B.city) { r = g = b = 1 - deep * 0.12 + n * 0.05; }
        else if (B.flora === 'desert') { const hgt = clamp((y - G.H[k] + 0) * 0, 0, 1); r = 1.05 + n * 0.1 - deep * 0.15; g = 0.98 + n * 0.08 - deep * 0.15; b = 0.9 - deep * 0.15; }
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
  // fir made of drooping branch cards around a dark core: reads as a real conifer at any distance
  foliageCards(rng, layers, y0, y1, r0, r1, cards) {
    const parts = [];
    for (let i = 0; i < layers; i++) {
      const t = i / Math.max(1, layers - 1), y = lerp(y0, y1, t), r = lerp(r0, r1, t) * (0.85 + rng() * 0.3), n = Math.max(4, Math.round(cards * (1 - t * 0.4)));
      for (let j = 0; j < n; j++) {
        const g = new THREE.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); g.rotateX(-Math.PI / 2); g.scale(r, 1, r * 0.8);
        g.rotateX((rng() - 0.5) * 0.9); g.rotateZ(-(0.25 + rng() * 0.35 + t * 0.1)); g.rotateY((j + rng() * 0.6) / n * Math.PI * 2 + i * 0.7); g.translate(0, y + (rng() - 0.5) * 0.3, 0);
        const p = g.attributes.position, c = new Float32Array(p.count * 3), nn = g.attributes.normal;
        for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k), d = Math.hypot(x, z), sh = (0.45 + 0.55 * Math.min(1, d / Math.max(r, 0.01))) * (0.75 + 0.25 * t); c[k * 3] = sh; c[k * 3 + 1] = sh; c[k * 3 + 2] = sh; const l = d || 1; nn.setXYZ(k, x / l * 0.65, 0.76, z / l * 0.65); }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g);
      }
    }
    // dark core so you can't see straight through the middle
    const core = new THREE.ConeGeometry(Math.max(r0, r1) * 0.2, y1 - y0 + 1.2, 6, 1, true); core.translate(0, (y0 + y1) / 2 + 0.4, 0);
    const cc = new Float32Array(core.attributes.position.count * 3).fill(0.22); core.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const cu = core.attributes.uv; for (let k = 0; k < cu.count; k++) cu.setXY(k, 0.45, 0.5); // a needle-dense texel of the branch texture
    parts.push(core);
    return this.merge(parts);
  },
  // deciduous crown: leaf cards scattered through an ellipsoid
  crownCards(rng, cy, rx, ry, n) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const u = rng() * 6.28, v = Math.acos(rng() * 2 - 1), rr = Math.cbrt(rng()), x = Math.sin(v) * Math.cos(u) * rx * rr, y = Math.cos(v) * ry * rr, z = Math.sin(v) * Math.sin(u) * rx * rr;
      const g = new THREE.PlaneGeometry(1.7, 1.7); g.rotateX(rng() * 6.28); g.rotateY(rng() * 6.28); g.translate(x, cy + y, z);
      const p = g.attributes.position, c = new Float32Array(p.count * 3), nn = g.attributes.normal, sh = 0.55 + 0.45 * (rr * 0.6 + (y / ry * 0.5 + 0.5) * 0.4);
      for (let k = 0; k < p.count; k++) { c[k * 3] = c[k * 3 + 1] = c[k * 3 + 2] = sh; const l = Math.hypot(x, y, z) || 1; nn.setXYZ(k, x / l, y / l * 0.6 + 0.4, z / l); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g);
    }
    return this.merge(parts);
  },
  buildForest(S, T) {
    const rng = mulberry(42), B = this.B, PH = this.PH || {};
    const trunk = (h, r, seg) => { const g = new THREE.CylinderGeometry(r * 0.55, r, h, seg || 7, 1, true); g.translate(0, h / 2 - 0.3, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 2); return g; };
    const barkM = new THREE.MeshStandardMaterial({ map: PH.bark || T.bark.map, normalMap: PH.barkN || T.bark.nrm, roughness: 1 });
    // snow settles on upward-facing needles
    const snowy = m => { if (B.flora !== 'snow') return m; m.onBeforeCompile = sh => { sh.vertexShader = 'varying float vUpY;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n #ifdef USE_INSTANCING\n vUpY = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.)).xyz).y;\n #else\n vUpY = objectNormal.y;\n #endif'); sh.fragmentShader = 'varying float vUpY;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9,.93,.98), smoothstep(.45, .75, vUpY) * .8);'); }; return m; };
    const folM = snowy(new THREE.MeshStandardMaterial({ map: T.branch, vertexColors: true, roughness: 0.95, alphaTest: 0.42, side: THREE.DoubleSide })), folLo = snowy(new THREE.MeshStandardMaterial({ map: T.needles, vertexColors: true, roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide }));
    const leafM = new THREE.MeshStandardMaterial({ map: T.leaves, vertexColors: true, roughness: 0.9, alphaTest: 0.45, side: THREE.DoubleSide }), birchM = new THREE.MeshStandardMaterial({ map: T.birch, roughness: 0.85 });
    const cactM = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.7 }), rockM = new THREE.MeshStandardMaterial({ map: PH.floor || T.floor.map, normalMap: PH.floorN || null, color: 0xb59a7e, roughness: 0.95 });
    const bushM = new THREE.MeshStandardMaterial({ map: T.plants, color: 0xa08055, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
    const lampM = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.45 }), lampHead = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffd9a0, emissiveIntensity: this.tod.lamps ? 6 : 0.3 });
    // cactus: ribbed trunk with two arms
    const cactus = () => { const parts = [], seg = (h, r, x, y, z, rz) => { const g = new THREE.CylinderGeometry(r, r * 1.05, h, 10, 1, false); g.translate(0, h / 2, 0); if (rz) g.rotateZ(rz); g.translate(x, y, z); parts.push(g); }; seg(4.2, 0.32, 0, 0, 0); seg(0.9, 0.22, 0, 0, 0, Math.PI / 2); seg(1.6, 0.22, -0.9, 1.6, 0); seg(0.7, 0.2, 0, 0, 0, -Math.PI / 2); seg(1.3, 0.2, 0.75, 2.3, 0); parts[1].translate(-0.05, 1.6, 0); parts[3].translate(0.05, 2.3, 0); return this.merge(parts); };
    const boulder = () => { const g = new THREE.DodecahedronGeometry(1, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = 0.8 + 0.35 * S.noise(x * 2.1 + 5, z * 2.1 + y); p.setXYZ(i, x * f * 1.2, Math.max(-0.3, y * f * 0.75) + 0.25, z * f); } g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.6, p.getY(i) * 0.6 + p.getZ(i) * 0.6); return g; };
    const bush = () => { const parts = []; for (let i = 0; i < 3; i++) { const q = new THREE.PlaneGeometry(1.6, 1); q.translate(0, 0.5, 0); const uv = q.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, lerp(0.55, 0.95, uv.getX(k))); q.rotateY(i * 1.05); parts.push(q); } return this.merge(parts); };
    const lamp = () => { const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 8); pole.translate(0, 3.5, 0); const arm = new THREE.BoxGeometry(0.08, 0.08, 1.6); arm.translate(0, 6.9, 0.75); return this.merge([pole, arm]); };
    const lampH = new THREE.BoxGeometry(0.35, 0.12, 0.6); lampH.translate(0, 6.82, 1.5);
    const kinds = {
      0: [[trunk(14, 0.24), barkM], [this.foliageCards(rng, 12, 1.4, 15.5, 3.0, 0.45, 10), folM, 'hi'], [this.foliage(rng, 4, 1.8, 15, 2.8, 0.4, 0.6), folLo, 'lo']],
      1: [[trunk(16, 0.26), barkM], [this.foliageCards(rng, 6, 10.2, 17, 2.5, 0.5, 7), folM, 'hi'], [this.foliage(rng, 3, 10.8, 16.5, 2.4, 0.5, 0.4), folLo, 'lo']],
      2: [[trunk(6, 0.15), barkM], [this.foliageCards(rng, 8, 0.6, 7.5, 1.8, 0.3, 6), folM, 'hi'], [this.foliage(rng, 3, 1, 7.2, 1.7, 0.3, 0.4), folLo, 'lo']],
      3: [[trunk(12, 0.17, 9), birchM], [this.crownCards(rng, 8.5, 2.6, 3.4, 46), leafM, 'hi'], [this.crownCards(rng, 8.5, 2.6, 3.4, 12), leafM, 'lo']],
      4: [[cactus(), cactM]], 5: [[boulder(), rockM]], 6: [[bush(), bushM]], 7: [[lamp(), lampM], [lampH, lampHead]],
    };
    const tint = { 0: [0.85, 1.05], 1: [0.9, 1.2], 2: [0.95, 1.25], 3: [0.8, 1.15] };
    const byTile = new Map(), tileOf = (x, z) => { let best = null, bd = 1e9; for (const t of this.tiles) { const d = Math.abs(t.cx - x) + Math.abs(t.cz - z); if (d < bd) { bd = d; best = t; } } return best; };
    const TSZ = 64, key = (x, z) => Math.floor((x - S.grid.x0) / TSZ) + ',' + Math.floor((z - S.grid.z0) / TSZ), tmap = new Map();
    for (const t of this.tiles) tmap.set(key(t.cx, t.cz), t);
    for (const tr of S.trees) { if (!kinds[tr.kind]) continue; const tl = tmap.get(key(tr.x, tr.z)) || tileOf(tr.x, tr.z); let a = byTile.get(tl); if (!a) byTile.set(tl, a = []); a.push(tr); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const shadows = this.gfx !== 'low';
    for (const [tl, list] of byTile) for (const k in kinds) {
      const L = list.filter(t => t.kind === +k); if (!L.length) continue;
      const parts = kinds[k].map(([geo, mat, lod]) => ({ m: new THREE.InstancedMesh(geo, mat, L.length), lod }));
      L.forEach((t, i) => {
        e.set((rng() - 0.5) * 0.06, t.rot || 0, (rng() - 0.5) * 0.06); q.setFromEuler(e); v.set(t.x, t.y, t.z); const s = (t.sc || 1) * (+k === 2 ? 0.9 : 1); sc.set(s, s * (+k >= 4 ? 1 : 0.9 + rng() * 0.25), s);
        m4.compose(v, q, sc); const tn = tint[k] ? lerp(tint[k][0], tint[k][1], rng()) : 1; c.setRGB(tn * (0.9 + rng() * 0.15), tn, tn * (0.85 + rng() * 0.2));
        for (const p of parts) { p.m.setMatrixAt(i, m4); if (p.lod) p.m.setColorAt(i, c); }
      });
      for (const p of parts) {
        p.m.computeBoundingSphere(); p.m.castShadow = shadows && p.lod !== 'lo'; p.m.receiveShadow = shadows; this.scene.add(p.m);
        if (p.lod === 'hi') (tl.hi = tl.hi || []).push(p.m); else if (p.lod === 'lo') (tl.lo = tl.lo || []).push(p.m); else tl.objs.push(p.m);
      }
    }
  },
  buildProps(S, T) {
    const rng = mulberry(S.cfg.seed + 9), scene = this.scene, B = this.B, green = B.flora === 'fir' || B.flora === 'autumn';
    // undergrowth: crossed quads (fern / grass) along the verges and scattered in the forest
    const quad = (u0, u1) => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, lerp(u0, u1, uv.getX(i))); return g; };
    const cross = (u0, u1) => { const a = quad(u0, u1), b = quad(u0, u1); b.rotateY(Math.PI / 2); const g = this.merge([a, b]); const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); return g; };
    const gFern = cross(0, 0.5), gGrass = cross(0.55, 0.95);
    const pm = new THREE.MeshStandardMaterial({ map: T.plants, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: B.flora === 'autumn' ? 0xd8a060 : 0xffffff });
    const items = [[], []];
    const dens = this.gfx === 'low' ? 1 : this.gfx === 'med' ? 2 : 3;
    if (green) for (let s = 20; s < S.L; s += 2.2 / dens) for (const sd of [-1, 1]) {
      const p = S.at(s), rx = -Math.cos(p.h), rz = Math.sin(p.h), d = ROAD_HW + 0.9 + rng() * rng() * 9, x = p.x + rx * sd * d + (rng() - 0.5) * 2, z = p.z + rz * sd * d + (rng() - 0.5) * 2;
      const q = S.near(x, z, 10); if (!q || q.d < ROAD_HW + 0.6) continue;
      items[rng() < 0.45 ? 0 : 1].push([x, S.heightAt(x, z) - 0.05, z, 0.5 + rng() * 0.9, rng() * 6.28]);
    }
    if (green) for (const t of S.trees) if (t.kind <= 3 && rng() < 0.18 * dens) { const a = rng() * 6.28, r = 1.2 + rng() * 1.5, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r; items[0].push([x, S.heightAt(x, z) - 0.05, z, 0.6 + rng() * 0.8, rng() * 6.28]); }
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
    const rocks = []; if (!B.city) for (let s = 30; s < S.L; s += 9) if (rng() < 0.55) { const p = S.at(s), sd = rng() < 0.5 ? -1 : 1, d = ROAD_HW + 1.5 + rng() * 4, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; rocks.push([x, S.heightAt(x, z), z, 0.25 + rng() * rng() * 0.9, rng() * 6]); }
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x8a877e, roughness: 0.9, map: T.floor.map }), rocks.length);
    rocks.forEach((r, i) => { e.set(rng(), r[4], rng()); q.setFromEuler(e); v.set(r[0], r[1], r[2]); sc.set(r[3], r[3], r[3]); m4.compose(v, q, sc); rm.setMatrixAt(i, m4); });
    rm.castShadow = rm.receiveShadow = this.gfx !== 'low'; scene.add(rm);
    // red/white marker posts every 20 m on both verges: strong speed cue
    { const pg = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6); pg.translate(0, 0.55, 0); const pc = new Float32Array(pg.attributes.position.count * 3); for (let i = 0; i < pg.attributes.position.count; i++) { const y = pg.attributes.position.getY(i), red = y > 0.8; pc[i * 3] = red ? 0.85 : 0.95; pc[i * 3 + 1] = red ? 0.1 : 0.95; pc[i * 3 + 2] = red ? 0.08 : 0.92; } pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
      const posts = []; if (!B.city) for (let s = 50; s < S.L - 40; s += 20) for (const sd of [-1, 1]) { const p = S.at(s), d = ROAD_HW + 1.1, x = p.x - Math.cos(p.h) * sd * d, z = p.z + Math.sin(p.h) * sd * d; if (S.logs.some(l => Math.abs(l.s - s) < 6)) continue; posts.push([x, S.heightAt(x, z), z]); }
      const pm2 = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), posts.length); posts.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); pm2.setMatrixAt(i, m4); }); pm2.castShadow = this.gfx !== 'low'; pm2.computeBoundingSphere(); scene.add(pm2); }
    // obstacles across half the road: logs (forests, snow), boulders (desert), concrete barriers (city)
    const PH = this.PH || {}, barkM = new THREE.MeshStandardMaterial({ map: PH.bark || T.bark.map, normalMap: PH.barkN || T.bark.nrm, roughness: 1 }), endM = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
    const rockM = new THREE.MeshStandardMaterial({ map: PH.floor || T.floor.map, color: 0xc0a080, roughness: 0.95 });
    const barC = document.createElement('canvas'); barC.width = 256; barC.height = 64; { const g = barC.getContext('2d'); g.fillStyle = '#d8d6cf'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#c62020'; for (let i = -1; i < 9; i++) { g.beginPath(); g.moveTo(i * 32, 64); g.lineTo(i * 32 + 16, 64); g.lineTo(i * 32 + 40, 22); g.lineTo(i * 32 + 24, 22); g.fill(); } g.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 300; i++) g.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
    const barT = new THREE.CanvasTexture(barC); barT.colorSpace = THREE.SRGBColorSpace; barT.wrapS = THREE.RepeatWrapping; const barM = new THREE.MeshStandardMaterial({ map: barT, roughness: 0.85 });
    for (const l of S.logs) {
      const len = Math.hypot(l.bx - l.ax, l.bz - l.az), mx = (l.ax + l.bx) / 2, mz = (l.az + l.bz) / 2, dir = new THREE.Vector3(l.bx - l.ax, 0, l.bz - l.az).normalize();
      if (B.obs === 'rock') {
        const g = new THREE.DodecahedronGeometry(1, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = 0.85 + 0.3 * S.noise(p.getX(i) * 2 + l.s, p.getZ(i) * 2); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.8, p.getZ(i) * f); } g.computeVertexNormals();
        const m = new THREE.Mesh(g, rockM); m.scale.set(len / 2 + l.rad * 0.6, l.rad * 1.3, l.rad * 1.3); m.position.set(mx, S.heightAt(mx, mz) + l.rad * 0.6, mz); m.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2; m.castShadow = m.receiveShadow = true; scene.add(m);
      } else if (B.obs === 'barrier') {
        // jersey barriers in a row: wide base, narrow top
        const prof = new THREE.Shape(); prof.moveTo(-0.32, 0); prof.lineTo(0.32, 0); prof.lineTo(0.3, 0.12); prof.lineTo(0.12, 0.32); prof.lineTo(0.1, 0.82); prof.lineTo(-0.1, 0.82); prof.lineTo(-0.12, 0.32); prof.lineTo(-0.3, 0.12); prof.closePath();
        const n = Math.round(len / 2); for (let i = 0; i < n; i++) { const g = new THREE.ExtrudeGeometry(prof, { depth: 1.95, bevelEnabled: false }); g.translate(0, 0, -0.975); const m = new THREE.Mesh(g, barM); const u = (i + 0.5) / n, x = l.ax + (l.bx - l.ax) * u, z = l.az + (l.bz - l.az) * u; m.position.set(x, S.heightAt(x, z), z); m.rotation.y = Math.atan2(dir.x, dir.z); m.castShadow = m.receiveShadow = true; scene.add(m); }
      } else {
        const g = new THREE.CylinderGeometry(l.rad, l.rad * 1.08, len, 12, 1, false);
        const m = new THREE.Mesh(g, [barkM, endM, endM]); m.position.set(mx, l.cy, mz);
        m.quaternion.setFromUnitVectors(up, dir); m.castShadow = m.receiveShadow = true; scene.add(m);
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5), barkM); br.position.set(0, len * 0.2, l.rad); br.rotation.x = 1.0; m.add(br);
      }
    }
    // snowbanks: a white mound strip along each edge
    if (B.banks) {
      const snowM = new THREE.MeshStandardMaterial({ map: PH.snowbank || null, color: PH.snowbank ? 0xffffff : 0xf0f3f8, roughness: 0.85 });
      for (const sd of [-1, 1]) {
        const prof = [[ROAD_HW + 0.8, -0.1], [ROAD_HW + 1.3, 0.45], [ROAD_HW + 2.0, 0.75], [ROAD_HW + 2.8, 0.6], [ROAD_HW + 3.6, 0.0]], pos = [], uv = [], idx = []; let row = 0;
        for (let s = 0; s <= S.L; s += 2, row++) { const p = S.at(s), rx = -Math.cos(p.h) * sd, rz = Math.sin(p.h) * sd, wob = 0.85 + 0.3 * S.noise(s * 0.08, sd * 9); for (const [d, hh] of prof) { const x = p.x + rx * d, z = p.z + rz * d; pos.push(x, S.heightAt(x, z) + hh * wob, z); uv.push(d / 3, s / 3); } }
        const np = prof.length; for (let r = 0; r < row - 1; r++) for (let k = 0; k < np - 1; k++) { const a = r * np + k, b = a + 1, c2 = a + np, d2 = c2 + 1; if (sd > 0) idx.push(a, c2, b, b, c2, d2); else idx.push(a, b, c2, b, d2, c2); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, snowM); m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
      }
    }
    // city blocks: one merged mesh per facade style, windows painted over the photo brick / plaster
    if (B.city && S.buildings.length) {
      const facade = (base, tintCol, win) => {
        const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
        if (base && base.image) { for (let x = 0; x < 512; x += 256) for (let y = 0; y < 512; y += 256) g.drawImage(base.image, x, y, 256, 256); } else { g.fillStyle = '#9a8a7a'; g.fillRect(0, 0, 512, 512); }
        g.fillStyle = tintCol; g.fillRect(0, 0, 512, 512);
        // 4 columns x 3 floors of windows; ground floor gets shop fronts
        for (let f = 0; f < 3; f++) for (let k = 0; k < 4; k++) { const x = 28 + k * 128, y = 30 + f * 170, lit = this.tod.lamps && Math.random() < 0.45; g.fillStyle = '#2c2f33'; g.fillRect(x - 6, y - 6, 84, 116); g.fillStyle = lit ? '#ffcf80' : win; g.fillRect(x, y, 72, 104); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 72, 10); g.fillStyle = '#2c2f33'; g.fillRect(x + 34, y, 4, 104); g.fillRect(x, y + 50, 72, 4); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
      };
      const PHb = this.PH || {}, styles = [facade(PHb.brick, 'rgba(0,0,0,0)', '#5d7386'), facade(PHb.plaster, 'rgba(230,200,150,.25)', '#4e6474'), facade(PHb.plaster, 'rgba(120,130,140,.35)', '#3e5262'), facade(PHb.brick, 'rgba(60,40,30,.35)', '#56697a')];
      const groups = [[], [], [], []];
      for (const b of S.buildings) {
        const g = new THREE.BoxGeometry(b.w, b.ht, b.d); g.translate(0, b.ht / 2, 0);
        const uv = g.attributes.uv, nn = g.attributes.normal, col = new Float32Array(uv.count * 3);
        for (let i = 0; i < uv.count; i++) { const ny = nn.getY(i), nx = Math.abs(nn.getX(i)); const sx = nx > 0.5 ? b.d : b.w; uv.setXY(i, uv.getX(i) * sx / 12, uv.getY(i) * b.ht / 9.6); const sh = ny > 0.5 ? 0.25 : ny < -0.5 ? 0.2 : 1; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.rotateY(b.h); g.translate(b.x, b.y, b.z); groups[b.style].push(g);
      }
      groups.forEach((list, i) => { if (!list.length) return; const m = new THREE.Mesh(this.merge(list), new THREE.MeshStandardMaterial({ map: styles[i], vertexColors: true, roughness: 0.85 })); m.castShadow = m.receiveShadow = this.gfx !== 'low'; scene.add(m); });
    }
    // spectators behind tape at jumps, crests and hairpins
    this.crowds = [];
    { const spots = S.jumps.map(j => j.s).concat(S.corners.filter(c => c.g === 1).map(c => (c.s0 + c.s1) / 2), S.crests.slice(0, 2).map(c => c.s));
      const bodyG = new THREE.CapsuleGeometry(0.24, 0.9, 3, 8); bodyG.translate(0, 0.75, 0); const headG = new THREE.SphereGeometry(0.13, 10, 8); headG.translate(0, 1.55, 0);
      const people = [], jackets = [0xd22d2d, 0x2a6cd6, 0xf2b632, 0x2f8a3a, 0xeeeeee, 0x222222, 0xff7a1a, 0x7a3fb0];
      for (const s0 of spots) {
        const p = S.at(s0), corner = S.corners.find(c => s0 > c.s0 && s0 < c.s1), side = corner ? (corner.dir === 'L' ? -1 : 1) : (rng() < 0.5 ? -1 : 1); // outside of the corner is the classic spot... so stand on the inside, safely
        const sd = -side, n = 8 + (rng() * 8 | 0), cr = { x: p.x, z: p.z, ppl: [], cheered: false };
        for (let i = 0; i < n; i++) {
          const ss = s0 + (rng() - 0.5) * 26, q = S.at(ss), d = ROAD_HW + 3 + rng() * 5, x = q.x - Math.cos(q.h) * sd * d, z = q.z + Math.sin(q.h) * sd * d;
          if (S.trees.some(t => Math.hypot(t.x - x, t.z - z) < 0.8)) continue;
          const o = { x, y: S.heightAt(x, z), z, rot: q.h + (sd > 0 ? -1 : 1) * Math.PI / 2 + (rng() - 0.5) * 0.8, c: jackets[rng() * jackets.length | 0], ph: rng() * 6.28, i: people.length };
          people.push(o); cr.ppl.push(o);
        }
        // tape line
        const tq = S.at(s0 - 14), tq2 = S.at(s0 + 14), tm = new THREE.MeshBasicMaterial({ color: 0xe03030 });
        const a = new THREE.Vector3(tq.x - Math.cos(tq.h) * sd * (ROAD_HW + 3.2), 0, tq.z + Math.sin(tq.h) * sd * (ROAD_HW + 3.2)), b = new THREE.Vector3(tq2.x - Math.cos(tq2.h) * sd * (ROAD_HW + 3.2), 0, tq2.z + Math.sin(tq2.h) * sd * (ROAD_HW + 3.2));
        a.y = S.heightAt(a.x, a.z) + 0.9; b.y = S.heightAt(b.x, b.z) + 0.9; const tl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, a.distanceTo(b)), tm); tl.position.copy(a).add(b).multiplyScalar(0.5); tl.lookAt(b); scene.add(tl);
        this.crowds.push(cr);
      }
      if (people.length) {
        const bm = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), people.length), hm = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.7 }), people.length), col = new THREE.Color();
        people.forEach((o, i) => { m4.makeRotationY(o.rot); m4.setPosition(o.x, o.y, o.z); bm.setMatrixAt(i, m4); hm.setMatrixAt(i, m4); bm.setColorAt(i, col.setHex(o.c)); });
        bm.castShadow = hm.castShadow = this.gfx !== 'low'; bm.computeBoundingSphere(); hm.computeBoundingSphere(); scene.add(bm, hm); this.ppl = { bm, hm };
      }
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
  // spectators bounce and jump when the car is near
  wave(cr, t) {
    if (!this.ppl) return; const m = new THREE.Matrix4();
    for (const o of cr.ppl) { const hop = Math.max(0, Math.sin(t * 9 + o.ph)) * 0.18; m.makeRotationY(o.rot); m.setPosition(o.x, o.y + hop, o.z); this.ppl.bm.setMatrixAt(o.i, m); this.ppl.hm.setMatrixAt(o.i, m); }
    this.ppl.bm.instanceMatrix.needsUpdate = this.ppl.hm.instanceMatrix.needsUpdate = true;
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
  render(fx) {
    const R = this.R;
    if (this.gfx === 'low') { R.render(this.scene, this.cam); return; }
    if (!this.pp) this.ppInit();
    const P = this.pp, tm = R.toneMapping; R.toneMapping = THREE.NoToneMapping;
    R.setRenderTarget(P.A); R.render(this.scene, this.cam);
    P.bright.uniforms.t.value = P.A.texture; R.setRenderTarget(P.B1); R.render(P.sBright, P.oc);
    const bw = 1 / P.B1.width, bh = 1 / P.B1.height;
    for (let i = 0; i < 2; i++) { P.blur.uniforms.t.value = P.B1.texture; P.blur.uniforms.d.value.set(bw, 0); R.setRenderTarget(P.B2); R.render(P.sBlur, P.oc); P.blur.uniforms.t.value = P.B2.texture; P.blur.uniforms.d.value.set(0, bh); R.setRenderTarget(P.B1); R.render(P.sBlur, P.oc); }
    const u = P.comp.uniforms; u.t.value = P.A.texture; u.b.value = P.B1.texture; u.exp.value = R.toneMappingExposure; u.spd.value = fx ? fx.spd : 0; u.hurt.value = fx ? fx.hurt : 0; u.time.value = (performance.now() / 1000) % 100;
    R.setRenderTarget(null); R.render(P.sComp, P.oc); R.toneMapping = tm;
  },
  dispose() { if (!this.scene) return; this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.scene = null; },
};
