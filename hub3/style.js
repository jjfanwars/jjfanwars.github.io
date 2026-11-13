{
  // ---------------------------------------------------------------- content
  // A picture-book walk: one slow camera move from the clifftop to the Hub's music room, four beats that follow each
  // other, and one short caption per beat lettered in the bare corner of the canvas. The pram is the thread.
  const DURATION = 13;
  const BEATS = [
    { at: 0.0, text: 'Morning on the Jan Juc clifftop.' },
    { at: 3.2, text: 'Up Stuart Avenue to the Hub.' },
    { at: 6.4, text: 'Through the door, the music group begins.' },
    { at: 9.9, text: 'And the baby drifts off to sleep.' },
  ];
  const WRITE = 0.45;
  // one schedule for picture and sound
  const TURN = 3.2;                 // the pram leaves the clifftop and turns into the street
  const DOOR_OPEN = 6.0, DOOR_IN = 6.55;    // the Hub door swings open, the pram rolls in
  const MUSIC = 6.9;                // the ukulele starts
  const PARK = 7.75;                // the pram stops inside
  const LIFT = 7.95, LIFTED = 8.55; // the baby is lifted out
  const TO_SEAT = 8.6, SEATED = 9.35;
  const SLEEP = 10.3, ASLEEP = 11.3;
  const STOP = 11.4;                // the camera arrives and holds
  const WAVES = [0.6, 2.4, 4.2];    // surf breaking under the cliff (seconds)
  const STRUM = 0.46;               // seconds per ukulele strum

  function lettering() {
    const out = [];
    BEATS.forEach((b, beat) => { let t = b.at; b.text.split(' ').forEach((word, k) => { const dur = WRITE * (word.length + 1) / (b.text.length + 1); out.push({ beat, word, k, t0: beat ? t : -1, dur: dur * 0.85 }); t += dur; }); });
    return out;
  }
  const strums = () => { const o = []; for (let t = MUSIC; t < DURATION - 0.2; t += STRUM) o.push(t); return o; };

  // ---------------------------------------------------------------- the paint (from the Painted reference, unchanged)
  const BRUSH = `
    uniform float radius;
    vec3 px(vec2 o){ return texture2D(tex, vUv + o / res).rgb; }
    void main(){
      vec3 T = vec3(0.0), mean = vec3(0.0); float wsum = 0.0;
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
        vec2 o = vec2(float(i), float(j)) * 3.0; float w = exp(-dot(o, o) / 44.0);
        vec3 a = px(o + vec2(1.5, 0.0)), b = px(o - vec2(1.5, 0.0)), c = px(o + vec2(0.0, 1.5)), d = px(o - vec2(0.0, 1.5));
        vec3 gx = a - b, gy = c - d;
        T += w * vec3(dot(gx, gx), dot(gy, gy), dot(gx, gy)); mean += w * (a + b + c + d) * 0.25; wsum += w;
      }
      T /= wsum; mean /= wsum;
      float root = sqrt((T.x - T.y) * (T.x - T.y) + 4.0 * T.z * T.z), l1 = 0.5 * (T.x + T.y + root), l2 = 0.5 * (T.x + T.y - root);
      vec2 dir = vec2(l1 - T.x, -T.z); dir = length(dir) > 1e-6 ? normalize(dir) : vec2(1.0, 0.0);
      float aniso = l1 + l2 > 1e-7 ? (l1 - l2) / (l1 + l2) : 0.0;
      float ra = radius * clamp(1.0 + aniso, 0.1, 2.0), rb = radius * clamp(1.0 / (1.0 + aniso), 0.1, 2.0);
      int mx = int(sqrt(ra * ra * dir.x * dir.x + rb * rb * dir.y * dir.y)), my = int(sqrt(ra * ra * dir.y * dir.y + rb * rb * dir.x * dir.x));
      float zeta = 2.0 / radius, eta = (zeta + cos(0.58)) / (sin(0.58) * sin(0.58));
      vec4 m[8]; vec3 s[8];
      for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
      for (int y = -my; y <= my; y++) for (int x = -mx; x <= mx; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 v = 0.5 * vec2(dot(o, dir) / ra, dot(o, vec2(-dir.y, dir.x)) / rb);
        if (dot(v, v) > 0.25) continue;
        vec3 c = px(o);
        float w[8]; float z, vxx = zeta - eta * v.x * v.x, vyy = zeta - eta * v.y * v.y, sum = 0.0;
        z = max(0.0, v.y + vxx); w[0] = z * z; z = max(0.0, -v.x + vyy); w[2] = z * z; z = max(0.0, -v.y + vxx); w[4] = z * z; z = max(0.0, v.x + vyy); w[6] = z * z;
        vec2 q = 0.70710678 * vec2(v.x - v.y, v.x + v.y); vxx = zeta - eta * q.x * q.x; vyy = zeta - eta * q.y * q.y;
        z = max(0.0, q.y + vxx); w[1] = z * z; z = max(0.0, -q.x + vyy); w[3] = z * z; z = max(0.0, -q.y + vxx); w[5] = z * z; z = max(0.0, q.x + vyy); w[7] = z * z;
        for (int k = 0; k < 8; k++) sum += w[k];
        float g = exp(-3.125 * dot(v, v)) / sum;
        for (int k = 0; k < 8; k++) { float wk = w[k] * g; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; }
      }
      vec4 acc = vec4(0.0);
      for (int k = 0; k < 8; k++) {
        vec3 mk = m[k].rgb / m[k].w, sd = abs(s[k] / m[k].w - mk * mk);
        float w = 1.0 / (1.0 + pow(8000.0 * (sd.r + sd.g + sd.b), 4.0));
        acc += vec4(mk * w, w);
      }
      float lm = dot(mean, vec3(0.3, 0.55, 0.15)), detail = (dot(px(vec2(0.0)), vec3(0.3, 0.55, 0.15)) - lm) / (lm + 0.08);
      gl_FragColor = vec4(acc.rgb / acc.w, 0.5 + clamp(detail, -0.16, 0.16) * 2.5);
    }`;
  const SURFACE = `
    uniform sampler2D uCap; uniform vec4 uCapBox; uniform vec2 uCapLine; uniform vec2 uCapPatch; uniform float uCapShow, uCapAlpha;
    float lum(vec3 c){ return dot(c, vec3(0.3, 0.55, 0.15)); }
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float weave(vec2 p){
      vec2 q = p / 4.0, id = floor(q), f = fract(q) - 0.5; float over = mod(id.x + id.y, 2.0);
      float warp = cos(f.x * 3.14159) * (0.55 + 0.45 * cos(f.y * 6.28318)), weft = cos(f.y * 3.14159) * (0.55 + 0.45 * cos(f.x * 6.28318));
      return mix(warp, weft, over) * (0.8 + 0.4 * h21(id * (over > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0))));
    }
    float ink(vec2 p){
      vec2 q = (p - uCapBox.xy) / uCapBox.zw;
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
      float wipe = smoothstep(0.0, 5.0, uCapShow - (p.x - uCapBox.x) - 14.0 * h21(vec2(floor(p.y / 3.0), 7.0)));
      return texture2D(uCap, vec2(q.x, 1.0 - (uCapLine.x + 1.0 - q.y) / uCapLine.y)).r * wipe * uCapAlpha;
    }
    float thickness(vec2 o){ vec4 s = texture2D(tex, vUv + o / res); return 0.25 * lum(s.rgb) + 0.8 * (s.a - 0.5); }
    void main(){
      vec2 p = vUv * res; vec3 c = texture2D(tex, vUv).rgb;
      float edge = min(min(p.x, res.x - p.x), min(p.y, res.y - p.y));
      float painted = smoothstep(0.0, 3.0, edge - 13.0 - 17.0 * vnoise(p * vec2(0.012, 0.11)) - 7.0 * vnoise(p * 0.07));
      float corner = length(max(p - (uCapPatch - 30.0), 0.0)) - 30.0 + 9.0 * vnoise(p * vec2(0.05, 0.012)) + 6.0 * vnoise(p * 0.09);
      painted *= smoothstep(0.0, 3.0, corner);
      float k = ink(p), body = max(painted * smoothstep(0.04, 0.8, lum(c)), k);
      vec2 g = vec2(thickness(vec2(1.5, 0.0)) - thickness(vec2(-1.5, 0.0)), thickness(vec2(0.0, 1.5)) - thickness(vec2(0.0, -1.5))) * painted;
      g += vec2(ink(p + vec2(1.5, 0.0)) - ink(p - vec2(1.5, 0.0)), ink(p + vec2(0.0, 1.5)) - ink(p - vec2(0.0, 1.5))) * 0.22;
      vec2 gw = vec2(weave(p + vec2(0.8, 0.0)) - weave(p - vec2(0.8, 0.0)), weave(p + vec2(0.0, 0.8)) - weave(p - vec2(0.0, 0.8)));
      vec3 n = normalize(vec3(-(g * 1.6 + gw * mix(0.3, 0.07, body)), 1.0));
      vec3 L = normalize(vec3(-0.5, 0.62, 0.6));
      float diff = dot(n, L) / L.z, spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
      c = mix(vec3(0.90, 0.86, 0.77) * (0.97 + 0.05 * vnoise(p * 0.02)), c, painted);
      c = mix(c, vec3(0.17, 0.11, 0.24) * (0.9 + 0.3 * vnoise(p * vec2(0.5, 0.08))), k);
      c = c * mix(1.0, diff, 0.5) + spec * 0.12 * body;
      c *= 1.0 - 0.07 * (1.0 - body) * (1.0 - weave(p));
      gl_FragColor = vec4(c, 1.0);
    }`;
  const CAP = { font: '700 64px "Caveat"', x: 50, y: 34, row: 96, width: 1120 };

  registerStyle({
    id: 'painted-hub',
    name: 'Painted',
    family: 'Filters over 3D',
    topic: 'A morning at the Surf Coast Family Hub: a parent walks a pram from the Jan Juc clifftop up Stuart Avenue to the Hub, joins the baby music group, and the baby falls asleep',
    duration: DURATION,
    fonts: [CAP.font],
    render: { samples: 24, shutter: 0.5, tone: 'neutral', exposure: 1.0, bloom: 0.5, bloomThreshold: 1.05, vignette: 0, grain: 0, saturation: 1.12, contrast: 1.04, fov: 34, far: 600, background: '#f0a878' },

    build(S) {
      const { THREE, K, scene, camera } = S;
      const V = (x, y, z) => new THREE.Vector3(x, y, z), lin = (hex) => new THREE.Color(hex);
      const rnd = K.rng(21), nz = K.noise(3);
      S.addFilter(BRUSH, { radius: { value: 9 } });

      // ---- caption corner
      const words = lettering(), meas = document.createElement('canvas').getContext('2d'); meas.font = CAP.font;
      let capWidth = 0;
      BEATS.forEach((b, i) => {
        capWidth = Math.max(capWidth, meas.measureText(b.text).width);
        words.filter((w) => w.beat === i).forEach((w) => { const before = b.text.split(' ').slice(0, w.k).join(' ') + (w.k ? ' ' : ''); w.x0 = meas.measureText(before).width; w.x1 = w.x0 + meas.measureText(w.word).width; });
      });
      const capTex = K.canvasTex(CAP.width, CAP.row * BEATS.length, (ctx, w, h) => {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.font = CAP.font; ctx.textBaseline = 'middle'; ctx.fillStyle = ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
        BEATS.forEach((b, i) => { ctx.fillText(b.text, 8, CAP.row * (i + 0.52)); ctx.strokeText(b.text, 8, CAP.row * (i + 0.52)); });
      }, { data: true });
      const capU = { uCap: { value: capTex }, uCapBox: { value: new THREE.Vector4(CAP.x - 8, CAP.y, CAP.width, CAP.row) }, uCapLine: { value: new THREE.Vector2(0, BEATS.length) },
        uCapPatch: { value: new THREE.Vector2(CAP.x + capWidth + 44, CAP.y + CAP.row + 8) }, uCapShow: { value: 0 }, uCapAlpha: { value: 1 } };
      S.addFilter(SURFACE, capU);
      const caption = (t) => {
        let i = 0; while (i < BEATS.length - 1 && t >= BEATS[i + 1].at - 0.02) i++;
        let show = 0;
        for (const w of words) if (w.beat === i && t >= w.t0) show = Math.max(show, K.lerp(w.x0, w.x1 + 30, K.seg(t, w.t0, w.t0 + w.dur, K.ease.inOut)));
        capU.uCapLine.value.x = i; capU.uCapShow.value = show + 8;
        capU.uCapAlpha.value = i < BEATS.length - 1 ? 1 - K.seg(t, BEATS[i + 1].at - 0.2, BEATS[i + 1].at - 0.04) : 1;
      };

      // ---- the land: clifftop along x, the sea to the south (-z), a headland curling out to the east, Stuart Avenue
      // running inland (+z) with the shops on its east side
      const WIND = [0.35, 0.94];                                       // onshore breeze (x, z)
      const edgeZ = (x) => -3.2 - 0.6 * nz.n2(x * 0.08, 2.0) - (x > 2 ? 0.9 * (x - 2) - 0.004 * (x - 2) * (x - 2) : 0) * K.smooth(2, 14, x) * 1.6 - (x < -11 ? 0.85 * (-11 - x) : 0) * K.smooth(-11, -19, x) * 1.5;
      const STREET_X = 1.5, SHOP_X = 7.0;                              // street centre line, shop fronts
      const ground = (x, z) => {
        const d = z - edgeZ(x);
        let h = 0.22 * nz.fbm(x * 0.12, z * 0.12, 0, 3) + 0.012 * Math.max(0, z);
        const street = K.smooth(4.2, 3.2, Math.abs(x - STREET_X)) * K.smooth(1.5, 4, z);
        h = K.lerp(h, 0.05 + 0.012 * z, street);
        const foot = K.smooth(5.0, 4.6, x) < 1 && x > 4.4 && x < SHOP_X + 0.2 && z > 3 ? 1 : 0;
        if (foot) h = 0.18 + 0.012 * z;
        if (x > SHOP_X - 0.1 && z > 3 && z < 36) h = 0.18 + 0.012 * z;
        const c = K.smooth(0.4, -2.2, d);                              // 1 below the cliff
        const below = -11.75 - 0.18 * Math.max(0, -d - 9) + 0.25 * nz.n2(x * 0.3, z * 0.3);
        return K.lerp(h, below, c);
      };
      const G = (x, y, z) => [x, ground(x, z) + y, z];

      // the pram's route: clifftop path, the corner, the footpath, the Hub door, inside
      const ROUTE = new THREE.CatmullRomCurve3([[-16, -1.0], [-10, -0.7], [-4.5, -0.3], [0.5, 0.8], [4.4, 3.4], [5.75, 7.5], [5.8, 13], [5.85, 18.4], [6.6, 20.55], [8.1, 20.65], [8.7, 21.4]].map(([x, z]) => V(x, 0, z)), false, 'centripetal');
      const ROUTE_LEN = ROUTE.getLength();
      const routeDist = (x, z) => { let d = 1e9; for (let i = 0; i <= 80; i++) { const p = ROUTE.getPointAt(i / 80); d = Math.min(d, Math.hypot(x - p.x, z - p.z)); } return d; };
      // how far along the route the pram is at time t (the parent walks at about 1.3 m/s, slows at the door)
      const along = K.track([[0, 0], [TURN, 0.47, 'linear'], [DOOR_OPEN - 0.1, 0.885, 'out'], [DOOR_IN, 0.89, 'linear'], [PARK, 1.0, 'inOut']]);

      // ---- camera: one continuous shot, clifftop -> street -> through the door -> the music room
      const pr = (u) => { const p = ROUTE.getPointAt(K.clamp(u)); return [p.x, p.z]; };
      // ---- stations for the brush dabs
      const STATIONS = {
        coast: { eye: [-8, 6, 28], aim: [10, -6, -30], seen: 22 },
        path: { eye: [-9, 2.5, 14], aim: [-6, 0.2, -1], seen: 6 },
        street: { eye: [1, 2.5, -8], aim: [6.5, 1.5, 18], seen: 12 },
        front: { eye: [-6, 1.8, 20.5], aim: [7, 1.6, 20.4], seen: 6 },
        room: { eye: [-4, 1.4, 19.5], aim: [11, 0.8, 20], seen: 3.2 },
      };
      const REF = {};
      for (const [name, s] of Object.entries(STATIONS)) {
        const d = Math.hypot(s.eye[0] - s.aim[0], s.eye[1] - s.aim[1], s.eye[2] - s.aim[2]);
        const c = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan(17 * Math.PI / 180) * s.seen / d) * 180 / Math.PI, S.W / S.H, 0.1, 900);
        K.look(c, s.eye, s.aim); c.updateMatrixWorld();
        REF[name] = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      }
      const GROUND_REFS = [REF.coast, REF.path, REF.street, REF.front];

      function dabField(seed, flow) {
        const N = 1024, r = K.rng(seed), data = new Uint8Array(N * N * 4).fill(128), LEN = 84, WID = 22;
        for (let n = Math.round(N * N / (LEN * WID) * 3.4); n > 0; n--) {
          const cx = Math.floor(r() * N), cy = Math.floor(r() * N), len = LEN * r.range(0.55, 1.35), wid = WID * r.range(0.6, 1.25);
          const a = flow(cx / N, cy / N) + r.gauss() * 0.16, ca = Math.cos(a), sa = Math.sin(a), bend = r.range(-0.35, 0.35) / len;
          const tx = r() * 255, ty = r() * 255, tone = r() * 255, hairs = Math.max(3, Math.round(wid / 3.2)), ext = Math.ceil(len / 2 + wid);
          const from = [], to = [], ridge = [];
          for (let h = 0; h < hairs; h++) { from.push(-len / 2 + r() * len * 0.14); to.push(len / 2 - r() * len * 0.32); ridge.push(r.range(-0.3, 0.3)); }
          for (let dy = -ext; dy <= ext; dy++) for (let dx = -ext; dx <= ext; dx++) {
            const u = dx * ca + dy * sa, across = (-dx * sa + dy * ca - bend * u * u) / wid + 0.5;
            if (across < 0 || across >= 1) continue;
            const h = Math.floor(across * hairs);
            if (u < from[h] || u > to[h]) continue;
            const i = ((((cy + dy) % N) + N) % N * N + (((cx + dx) % N) + N) % N) * 4;
            data[i] = tx; data[i + 1] = ty; data[i + 2] = tone;
            data[i + 3] = 255 * K.clamp(0.5 + ridge[h] + 0.25 * Math.pow(Math.abs(across - 0.5) * 2, 3) - 0.15 * (u / len + 0.5));
          }
        }
        const tex = new THREE.DataTexture(data, N, N);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
        return tex;
      }
      const DABS = { sweep: dabField(1, (u, v) => 0.3 * Math.sin(6.283 * (u + 2 * v))), upright: dabField(2, (u, v) => 1.45 + 0.35 * Math.sin(6.283 * (2 * u + v))) };
      const dabScale = (size) => new THREE.Vector2(S.W, S.H).multiplyScalar(0.5 / (1024 * size));

      const f3 = (x) => x.toFixed(3);
      const GUST_GLSL = `const vec2 WIND = vec2(${f3(WIND[0])}, ${f3(WIND[1])}); float gustAt(vec2 p, float t){ return 0.0; }`;
      const uTime = { value: 0 };
      const paint = (o = {}) => {
        const { a = '#ffffff', b = a, c = b, dabs = 'sweep', size = 1, tilt = 0.5, at = 'street', moving = false, blend = false, wind = null, stem = 0.4, ...std } = o;
        const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 1, metalness: 0 }, std));
        const u = { uDabs: { value: DABS[dabs] }, uRef: { value: REF[at] }, uRefs: { value: GROUND_REFS }, uA: { value: lin(a) }, uB: { value: lin(b) }, uC: { value: lin(c) }, uTilt: { value: tilt },
          uScale: { value: dabScale(size) }, uOff: { value: new THREE.Vector2(rnd(), rnd()) }, uTime, uStem: { value: stem } };
        m.defines = {};
        if (moving) m.defines.DAB_BAKED = '';
        if (blend) m.defines.DAB_BLEND = '';
        if (wind) m.defines[wind === 'head' ? 'WIND_HEAD' : 'WIND_BLADE'] = '';
        m.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, u);
          sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
            uniform mat4 uRef, uRefs[4]; uniform float uTime, uStem; attribute vec3 dabClip; attribute vec4 dabMix; varying vec3 vDab, vDab1, vDab2, vDab3; varying vec4 vDabMix; varying float vGust;
            ${GUST_GLSL}`)
            .replace('#include <project_vertex>', `
              vec4 mvPosition = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                mvPosition = instanceMatrix * mvPosition;
              #endif
              #if defined(DAB_BAKED)
                vDab = dabClip;
              #elif defined(DAB_BLEND)
                vec4 dW = modelMatrix * mvPosition;
                vDab = (uRefs[0] * dW).xyw; vDab1 = (uRefs[1] * dW).xyw; vDab2 = (uRefs[2] * dW).xyw; vDab3 = (uRefs[3] * dW).xyw; vDabMix = dabMix;
              #else
                vDab = (uRef * modelMatrix * mvPosition).xyw;
              #endif
              vGust = 0.0;
              #if defined(USE_INSTANCING) && (defined(WIND_BLADE) || defined(WIND_HEAD))
                vec3 root = instanceMatrix[3].xyz;
                vGust = gustAt(root.xz, uTime);
                float lean = 0.12 + 0.11 * sin(uTime * 3.2 - dot(root.xz, WIND) * 1.1 + 0.6 * sin(root.z * 0.7 + root.x * 0.3)) + vGust * (0.6 + 0.1 * sin(uTime * 13.0 + root.x * 3.0 + root.z * 2.0));
                #ifdef WIND_BLADE
                  float tall = mvPosition.y - root.y, bendAt = lean * clamp(position.y, 0.0, 1.2);
                  mvPosition.xz += WIND * sin(bendAt) * tall; mvPosition.y = root.y + tall * cos(bendAt);
                #else
                  mvPosition.xz += WIND * sin(lean) * uStem; mvPosition.y -= (1.0 - cos(lean)) * uStem;
                #endif
              #endif
              mvPosition = modelViewMatrix * mvPosition;
              gl_Position = projectionMatrix * mvPosition;`);
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDabs; uniform vec2 uScale, uOff; uniform vec3 uA, uB, uC; uniform float uTilt; varying vec3 vDab, vDab1, vDab2, vDab3; varying vec4 vDabMix; varying float vGust;')
            .replace('#include <map_fragment>', `
              #include <map_fragment>
              #ifdef DAB_BLEND
                vec4 dab = vDabMix.x * texture2D(uDabs, vDab.xy / vDab.z * uScale + uOff) + vDabMix.y * texture2D(uDabs, vDab1.xy / vDab1.z * uScale + uOff + 0.31)
                  + vDabMix.z * texture2D(uDabs, vDab2.xy / vDab2.z * uScale + uOff + 0.57) + vDabMix.w * texture2D(uDabs, vDab3.xy / vDab3.z * uScale + uOff + 0.83);
              #else
                vec4 dab = texture2D(uDabs, vDab.xy / vDab.z * uScale + uOff);
              #endif
              vec3 dabCol = mix(uA, uB, smoothstep(0.1, 0.9, dab.b));
              dabCol = mix(dabCol, uC, step(0.86, fract(dab.b * 5.3 + dab.r * 3.1)));
              diffuseColor.rgb *= dabCol * (1.0 + (dab.a - 0.5) * 0.4) * (1.0 + 0.5 * vGust);`)
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + vec3(dab.rg - 0.5, 0.0) * uTilt);')
            .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb *= 1.0 + (dab.b - 0.5) * 0.3 + (dab.a - 0.5) * 0.14;');
        };
        return m;
      };
      const bake = (obj, at) => {
        obj.updateWorldMatrix(true, true);
        obj.traverse((m) => {
          if (!m.isMesh) return;
          const g = (m.geometry = m.geometry.clone()), p = g.attributes.position, out = new Float32Array(p.count * 3), v = new THREE.Vector4();
          for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i), 1).applyMatrix4(m.matrixWorld).applyMatrix4(REF[at]); out.set([v.x, v.y, v.w], i * 3); }
          g.setAttribute('dabClip', new THREE.BufferAttribute(out, 3));
        });
        return obj;
      };
      const add = (geo, mat, pos = [0, 0, 0], o = {}) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(pos[0], pos[1], pos[2]);
        if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
        if (o.scale) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
        m.castShadow = o.cast !== false; m.receiveShadow = true; (o.parent || scene).add(m); return m;
      };
      const group = (pos, parent = scene, yaw = 0) => { const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]); g.rotation.y = yaw; parent.add(g); return g; };
      const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
      const glow = (hex, k) => new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: hex, emissiveIntensity: k, roughness: 1 });
      const lampLight = (parent, pos, power, reach) => { const l = new THREE.PointLight('#ffa23c', power, reach, 2); l.position.set(pos[0], pos[1], pos[2]); parent.add(l); return l; };

      // ---- light: a low morning sun over the sea from the south-west, blue sky in the shadows
      const sunDir = (el, az) => V(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      K.env(S, { top: '#3f72c0', horizon: '#c9a0b4', bottom: '#3a4a2a', intensity: 0.85 });
      const sun = K.sun(S, { color: '#ffc27c', power: 5.6, size: 30, soft: 1.0, mapSize: 4096, far: 160, normalBias: 0.06 });
      const bounce = new THREE.DirectionalLight('#ff9a6a', 0.7); bounce.position.set(6, -10, 8); scene.add(bounce);
      scene.fog = new THREE.FogExp2('#d9a59e', 0.0072);

      const SKY = `
        uniform vec3 uSun; uniform float uDusk, uTime;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
        vec3 skyColor(vec3 d){
          float y = clamp(d.y, 0.0, 1.0), s = max(dot(d, uSun), 0.0);
          vec3 c = mix(vec3(1.0, 0.56, 0.26), vec3(0.95, 0.66, 0.50), smoothstep(0.0, 0.07, y));
          c = mix(c, vec3(0.30, 0.45, 0.62), smoothstep(0.04, 0.16, y));
          c = mix(c, vec3(0.10, 0.22, 0.45), smoothstep(0.12, 0.34, y));
          vec3 off = d - uSun;
          c += vec3(1.0, 0.52, 0.18) * exp(-dot(off.xz, off.xz) * 3.5 - off.y * off.y * 60.0) * 0.8 + vec3(1.0, 0.82, 0.5) * pow(s, 150.0);
          vec2 q = d.xz / (y + 0.1) * vec2(0.5, 1.7) + vec2(uTime * 0.035, 0.0);
          float body = fbm(q), toSun = fbm(q + normalize(uSun.xz) * vec2(0.14, 0.45));
          float cover = smoothstep(0.47, 0.62, body) * smoothstep(0.015, 0.05, y) * mix(0.12, 1.0, smoothstep(0.16, 0.09, y));
          vec3 cloud = mix(vec3(0.36, 0.30, 0.46), vec3(1.25, 0.66, 0.42), clamp(0.45 + (body - toSun) * 7.0, 0.0, 1.0)) + vec3(0.7, 0.35, 0.1) * pow(s, 5.0);
          c = mix(c, cloud, cover * 0.9);
          return c + vec3(9.0, 6.4, 3.0) * smoothstep(0.99962, 0.99975, s);
        }`;
      const SKY_VS = 'uniform mat4 uRef; varying vec3 vDab, vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 c = uRef * w; vDab = c.xyw; gl_Position = projectionMatrix * viewMatrix * w; }';
      const skyU = { uSun: { value: V(0, 0, -1) }, uDusk: { value: 0 }, uTime, uRef: { value: REF.coast }, uDabs: { value: DABS.sweep }, uScale: { value: dabScale(1) } };
      add(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU, vertexShader: SKY_VS,
        fragmentShader: `uniform sampler2D uDabs; uniform vec2 uScale; varying vec3 vDab, vWorld; ${SKY}
          void main(){
            vec4 dab = texture2D(uDabs, vDab.xy / vDab.z * uScale / 2.1);
            vec3 c = skyColor(normalize(vWorld - cameraPosition));
            c *= 1.0 + (dab.b - 0.5) * 0.34 + (dab.a - 0.5) * 0.2; c += (dab.r - 0.5) * vec3(0.12, 0.0, -0.1) * (0.2 + c.g);
            gl_FragColor = vec4(c, 1.0);
          }` }), [0, 0, 0], { cast: false });
      add(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS,
        fragmentShader: `uniform sampler2D uDabs; uniform vec2 uScale; varying vec3 vDab, vWorld; ${SKY}
          void main(){
            vec4 dab = texture2D(uDabs, vDab.xy / vDab.z * uScale / 1.3 + vec2(uTime * 0.008, 0.0));
            vec3 r = reflect(normalize(vWorld - cameraPosition), normalize(vec3((dab.r - 0.5) * 0.12, 1.0, (dab.g - 0.5) * 0.22)));
            r.y = abs(r.y);
            gl_FragColor = vec4(skyColor(r) * vec3(0.62, 0.78, 0.86) + vec3(0.0, 0.05, 0.07), 1.0);
          }` }), [0, -12.0, -300], { rot: [-Math.PI / 2, 0, 0], cast: false });

      // ---- the ground mesh
      const LAND = { grass: lin('#6f8a3c'), dry: lin('#a8a24a'), heath: lin('#3e5a32'), sand: lin('#e2c08c'), wet: lin('#b49a74'), path: lin('#dcc59a'),
        road: lin('#5d5a6e'), foot: lin('#c9bfae'), c1: lin('#c96a34'), c2: lin('#e8a65c'), c3: lin('#a9502c'), c4: lin('#f0c890'), c5: lin('#d88446'), shop: lin('#b9ad9a') };
      const STRATA = [LAND.c1, LAND.c2, LAND.c3, LAND.c4, LAND.c5, LAND.c2];
      const landColor = (x, z, y, out) => {
        const n = nz.fbm(x * 0.2, z * 0.2, 5, 3), d = z - edgeZ(x);
        out.copy(LAND.grass).lerp(LAND.heath, K.smooth(-0.05, 0.3, n)).lerp(LAND.dry, K.smooth(0.05, 0.35, -n));
        out.lerp(LAND.path, K.smooth(1.1, 0.6, routeDist(x, z)) * (z < 4 ? 1 : 0));
        out.lerp(LAND.road, K.smooth(4.0, 3.4, Math.abs(x - STREET_X)) * K.smooth(1.5, 4, z));
        if (x > 4.4 && x < SHOP_X + 0.2 && z > 3) out.copy(LAND.foot);
        if (x > SHOP_X && z > 3 && z < 36) out.copy(LAND.shop);
        const face = K.smooth(0.2, -0.6, d) * K.smooth(-11.5, -10.3, y);           // the cliff face: ochre strata
        if (face > 0) { const band = STRATA[((Math.floor(y * 1.5 + 1.2 * nz.n2(x * 0.15, y * 0.4)) % 6) + 6) % 6]; out.lerp(band, face); }
        const beach = K.smooth(-10.6, -11.3, y);
        if (beach > 0) out.lerp(LAND.sand, beach).lerp(LAND.wet, K.smooth(-11.7, -11.95, y));
        return out;
      };
      {
        const NX = 420, NZ = 330, g = new THREE.PlaneGeometry(1, 1, NX, NZ), p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3), mix = new Float32Array(p.count * 4), c = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
          const u = uv.getX(i) * 2 - 1, au = Math.abs(u), v = uv.getY(i) * 2 - 1, av = Math.abs(v);
          const x = 4 + Math.sign(u) * (au < 0.6 ? 36 * au : 21.6 + 120 * Math.pow((au - 0.6) / 0.4, 2)), z = 8 + Math.sign(v) * (av < 0.6 ? 32 * av : 19.2 + 110 * Math.pow((av - 0.6) / 0.4, 2));
          const y = ground(x, z); p.setXYZ(i, x, y, z); landColor(x, z, y, c); col.set([c.r, c.g, c.b], i * 3);
          const st = K.smooth(1.0, 4.5, z), fr = K.smooth(12, 16, z) * K.smooth(3, 5, x), co = K.smooth(-1.5, -4, z - edgeZ(x));
          let w = [co, (1 - co) * (1 - st), (1 - co) * st * (1 - fr), (1 - co) * fr]; const sm = w[0] + w[1] + w[2] + w[3]; w = w.map((q) => q / sm);
          mix.set(w, i * 4);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('dabMix', new THREE.BufferAttribute(mix, 4)); g.computeVertexNormals();
        add(g, paint({ a: '#aeb9d6', b: '#fff2c4', vertexColors: true, size: 1.15, tilt: 0.25, blend: true }));
      }

      // ---- far headlands down the coast (Bells and beyond), blue with distance
      for (const [x, z, sx, sy, sz] of [[60, -90, 40, 9, 14], [110, -150, 60, 14, 20], [-70, -140, 50, 8, 16]]) add(new THREE.SphereGeometry(1, 20, 10), paint({ a: '#6c6a9a', b: '#8a7ea8', size: 1.4, at: 'coast' }), [x, -12, z], { scale: [sx, sy, sz], cast: false });

      // ---- surf: lines of foam that roll in under the cliff and spread up the beach
      const foamMat = paint({ a: '#e4e8ea', b: '#ffffff', size: 0.6, tilt: 0.3, at: 'coast', emissive: '#c8d8dc', emissiveIntensity: 0.25 });
      const FOAM_N = 520, foam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foamMat, FOAM_N); foam.frustumCulled = false; foam.castShadow = false; foam.receiveShadow = true; scene.add(foam);
      const foamSeed = Array.from({ length: FOAM_N }, (_, i) => [K.hash(i, 1), K.hash(i, 2), K.hash(i, 3), K.hash(i, 4)]);
      const seaEdge = (x) => edgeZ(x) - 9.5;                            // where the beach meets the water
      const surf = (t) => {
        foamSeed.forEach(([a, b, c, d], i) => {
          const w = i % 3, born = WAVES[w], age = t - born + (t < born ? 5.4 : 0), x = -30 + a * 80;
          const run = K.ease.out(K.clamp(age / 1.6)), z = seaEdge(x) - 14 + 14 * run + 1.6 * K.clamp((age - 1.6) / 1.4) + (b - 0.5) * 1.6;
          const live = K.smooth(0, 0.2, age) * (1 - K.smooth(2.4, 3.4, age)), s = live * (0.25 + 0.5 * c) * (1 + 0.8 * K.clamp(age / 1.5));
          K.place(foam, i, [x, -12 + 0.05 + 0.12 * (1 - run) * live, z], [0, d * 6, 0], [s * 1.8, s * 0.25, s * 0.7]);
        });
        foam.instanceMatrix.needsUpdate = true;
      };

      // ---- clifftop heath, grass, and the street trees
      {
        const r = K.rng(4), blade = new THREE.ConeGeometry(0.035, 1, 3, 3); blade.translate(0, 0.5, 0);
        const spots = [];
        while (spots.length < 4200) {
          const x = r.range(-26, 18), z = r.range(-8, 12), d = z - edgeZ(x);
          if (d < 0.6 || routeDist(x, z) < 0.9 || (z > 2 && x > -3.2)) continue;
          spots.push([x, z]);
        }
        const grass = new THREE.InstancedMesh(blade, paint({ a: '#2f5230', b: '#9aa344', c: '#d9b05a', dabs: 'upright', size: 0.5, tilt: 0.6, at: 'path', wind: 'blade' }), spots.length);
        const daisies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), paint({ a: '#d64a8a', b: '#f07ab0', size: 0.4, at: 'path', wind: 'head', stem: 0.25, emissive: '#a02060', emissiveIntensity: 0.25 }), 160);   // pigface flowers
        spots.forEach(([x, z], i) => {
          K.place(grass, i, [x, ground(x, z) - 0.02, z], [r.range(-0.25, 0.25), r() * 6, r.range(-0.3, 0.3)], [1.5, r.range(0.2, 0.6), 1.5]);
          if (i < daisies.count) K.place(daisies, i, [x + r.range(-0.2, 0.2), ground(x, z) + 0.12, z], [r(), r(), r()], [0.07, 0.04, 0.07]);
        });
        for (const m of [grass, daisies]) { m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
        const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), paint({ a: '#24402c', b: '#5d7a36', c: '#8a8a3a', dabs: 'upright', size: 0.6, tilt: 0.7, flatShading: true, at: 'path' }), 70);
        for (let i = 0; i < shrubs.count; i++) {
          let x, z; do { x = r.range(-30, 20); z = r.range(-6, 30); } while (z - edgeZ(x) < 1.5 || routeDist(x, z) < 1.6 || (x > -3.2 && x < 16 && z > 1.5));
          const s = r.range(0.5, 1.1); K.place(shrubs, i, [x, ground(x, z) + s * 0.5, z], [0, r() * 6, 0], [s * 1.4, s, s * 1.2]);
        }
        shrubs.castShadow = shrubs.receiveShadow = true; scene.add(shrubs);
      }
      // houses and trees on the far side of the street
      const plaster = (at, o = {}) => paint(Object.assign({ a: '#c9b8a6', b: '#f2e4cc', dabs: 'upright', size: 0.6, tilt: 0.3, at }, o));
      const roofMat = paint({ a: '#5a5068', b: '#7a6a80', size: 0.6, tilt: 0.4, at: 'street' });
      for (const [z, w, col] of [[7, 6, '#e6d6bc'], [16, 7, '#d8c4b0'], [26, 6, '#e0cfa8']]) {
        const x = -5.5 - w / 2;
        add(box(w, 2.6, 6), plaster('street', { b: col }), [x, ground(x, z) + 1.3, z]);
        const gable = new THREE.Shape(); gable.moveTo(-3.4, 0); gable.lineTo(3.4, 0); gable.lineTo(0, 1.6); gable.closePath();
        add(new THREE.ExtrudeGeometry(gable, { depth: w + 0.4, bevelEnabled: false }), roofMat, [x - (w + 0.4) / 2, ground(x, z) + 2.6, z], { rot: [0, Math.PI / 2, 0] });
        add(box(0.06, 0.9, 1.1), glow('#ffb050', 0.9), [-5.48, ground(-5.5, z) + 1.4, z - 1.2], { cast: false });
      }
      const leaf = paint({ a: '#1d4a3c', b: '#5d8f2e', c: '#c9862e', dabs: 'upright', size: 0.6, tilt: 0.7, flatShading: true, at: 'street' });
      const bark = paint({ a: '#4a2f2a', b: '#7a4a32', dabs: 'upright', size: 0.5, at: 'street' });
      const blob = new THREE.IcosahedronGeometry(1, 1);
      for (const [x, z, s] of [[-3.4, 11.5, 1.4], [-3.6, 21, 1.6], [-3.3, 31, 1.3], [16, 2, 1.8], [-14, 6, 1.7], [-20, 3, 1.4]]) {
        const g = group([x, ground(x, z), z]);
        add(new THREE.CylinderGeometry(0.07 * s, 0.12 * s, 1.6 * s, 5), bark, [0, 0.8 * s, 0], { parent: g });
        for (const [ox, oy, oz, rr] of [[0, 1.9, 0, 0.9], [-0.6, 1.5, 0.2, 0.6], [0.55, 1.6, -0.2, 0.65], [0.1, 2.4, 0.1, 0.55]]) add(blob, leaf, [ox * s, oy * s, oz * s], { parent: g, scale: [rr * s, rr * s * 0.85, rr * s], rot: [ox, oy * 3, oz] });
      }

      {
        const r = K.rng(12), backTrees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), paint({ a: '#24402c', b: '#5d7a36', c: '#8a8a3a', dabs: 'upright', size: 0.7, tilt: 0.7, flatShading: true, at: 'street' }), 90);
        for (let i = 0; i < backTrees.count; i++) { const x = r.range(15.5, 40), z = r.range(-2, 48), s2 = r.range(1.6, 3.2); K.place(backTrees, i, [x, ground(x, z) + s2 * 0.9, z], [0, r() * 6, 0], [s2 * 1.2, s2 * 1.1, s2 * 1.2]); }
        backTrees.castShadow = backTrees.receiveShadow = true; scene.add(backTrees);
      }
      // ---- the shops on Stuart Avenue, and the Hub: a teal shopfront with two big windows and a glazed door
      const teal = (at, o = {}) => paint(Object.assign({ a: '#1f5f66', b: '#3f8a8e', c: '#5aa6a4', size: 0.6, tilt: 0.35, at }, o));
      const shopFloor = 0.18 + 0.012 * 20;
      const neighbour = (z0, z1, colA, colB) => {
        const zc = (z0 + z1) / 2, w = z1 - z0;
        add(box(8, 3.4, w), plaster('street', { a: colA, b: colB }), [SHOP_X + 4, shopFloor + 1.7, zc]);
        add(box(0.08, 1.9, w - 1.6), glow('#e89a5a', 0.22), [SHOP_X - 0.02, shopFloor + 1.35, zc], { cast: false });
        add(box(0.3, 0.12, w), plaster('street', { a: '#6a5a50', b: '#8a7466' }), [SHOP_X - 0.15, shopFloor + 2.55, zc]);
      };
      neighbour(5.4, 15.9, '#c9b08a', '#efdcb8'); neighbour(24.1, 34, '#a8583a', '#d08058');

      // logo texture: the Hub's tree with an arched door in its trunk (drawn in code)
      const logo = K.canvasTex(512, 600, (ctx) => {
        ctx.lineCap = 'round';
        ctx.fillStyle = '#e8b85e'; ctx.beginPath(); ctx.ellipse(256, 300, 200, 150, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#7a6f68'; ctx.lineWidth = 26;
        for (const [x0, y0, x1, y1, x2, y2] of [[230, 260, 160, 170, 90, 130], [260, 250, 260, 150, 250, 80], [290, 260, 360, 170, 420, 120], [220, 300, 140, 300, 80, 280], [300, 300, 380, 290, 440, 250]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x1, y1, x2, y2); ctx.stroke(); }
        const leafCol = ['#e9b44c', '#f2c3b8', '#4f8a8e'];
        for (let i = 0; i < 46; i++) { const a = K.hash(i, 3) * Math.PI - Math.PI, r = 150 + 90 * K.hash(i, 4), x = 256 + Math.cos(a) * r * 1.1, y = 230 + Math.sin(a) * r * 0.75; ctx.fillStyle = leafCol[i % 3]; ctx.beginPath(); ctx.ellipse(x, y, 24, 14, K.hash(i, 5) * 3, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#7a6f68'; ctx.beginPath(); ctx.moveTo(176, 470); ctx.lineTo(176, 330); ctx.quadraticCurveTo(256, 210, 336, 330); ctx.lineTo(336, 470); ctx.fill();
        ctx.fillStyle = '#4f8a8e'; ctx.beginPath(); ctx.moveTo(196, 470); ctx.lineTo(196, 340); ctx.quadraticCurveTo(256, 250, 316, 340); ctx.lineTo(316, 470); ctx.fill();
        ctx.fillStyle = '#fff6e0'; for (const [x, y] of [[280, 320], [296, 360], [270, 390], [296, 420]]) { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#5a504a'; ctx.beginPath(); ctx.moveTo(196, 470); ctx.lineTo(196, 345); ctx.quadraticCurveTo(225, 300, 256, 296); ctx.lineTo(256, 480); ctx.fill();
        ctx.fillStyle = '#4f8a8e'; ctx.font = '700 64px "Caveat"'; ctx.textAlign = 'center'; ctx.fillText('FAMILY HUB', 256, 560);
      });
      const fascia = K.canvasTex(2048, 160, (ctx, w, h) => { ctx.fillStyle = '#2f7479'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f4f1e8'; ctx.font = '700 104px "Caveat"'; ctx.textBaseline = 'middle'; ctx.fillText('Nurturing perinatal, child & family wellbeing', 60, h * 0.52); });

      // Hub in its own axes: x across the frontage (0 at the door, + toward the back of the street), y up, z into the
      // shop. World: frontage at SHOP_X facing the street (-x).
      const HZ = 20.55, hub = group([SHOP_X, shopFloor, HZ], scene, -Math.PI / 2);   // local +z -> world +x (into the shop), local +x -> world -z... set below
      hub.rotation.y = Math.PI / 2;                                        // local +z points into the shop (+x world), local +x points toward -z world
      const hubPt = (x, y, z) => { const v = V(x, y, z).applyMatrix4(hub.matrixWorld); return [v.x, v.y, v.z]; };
      hub.updateMatrixWorld(true);
      const W2 = 4.1, DEEP = 8, HH = 3.4;                                 // half width of the frontage, depth, height
      const tealWall = teal('front');
      const piece = (x0, x1, y0, y1, mat = tealWall) => add(box(x1 - x0, y1 - y0, 0.2), mat, [(x0 + x1) / 2, (y0 + y1) / 2, 0], { parent: hub });
      // frontage: window A (x -3.7..-0.65), door (-0.55..0.55), window B (0.65..3.7)
      piece(-W2, W2, 0, 0.55); piece(-W2, W2, 2.55, HH);
      piece(-W2, -3.7, 0.55, 2.55); piece(3.7, W2, 0.55, 2.55); piece(-0.65, -0.55, 0.55, 2.55); piece(0.55, 0.65, 0.55, 2.55); piece(-0.55, 0.55, 2.3, 2.55);
      add(box(2 * W2 + 0.3, 0.7, 0.32), tealWall, [0, HH - 0.2, -0.1], { parent: hub });
      add(new THREE.PlaneGeometry(2 * W2, 0.52), new THREE.MeshStandardMaterial({ map: fascia, roughness: 1, emissive: '#ffffff', emissiveMap: fascia, emissiveIntensity: 0.12 }), [0, HH - 0.2, -0.265], { parent: hub, rot: [0, Math.PI, 0], cast: false });
      // window frames and the logo on each window
      for (const cx of [-2.17, 2.17]) {
        for (const [x, y, w, h] of [[cx, 0.6, 3.1, 0.08], [cx, 2.5, 3.1, 0.08], [cx - 1.52, 1.55, 0.08, 2], [cx + 1.52, 1.55, 0.08, 2]]) add(box(w, h, 0.12), teal('front', { a: '#174a50', b: '#2a6a6e' }), [x, y, -0.06], { parent: hub });
        add(new THREE.PlaneGeometry(1.25, 1.46), new THREE.MeshStandardMaterial({ map: logo, transparent: true, alphaTest: 0.1, roughness: 1, emissive: '#ffffff', emissiveMap: logo, emissiveIntensity: 0.18, side: THREE.DoubleSide }), [cx, 1.55, 0.02], { parent: hub, rot: [0, Math.PI, 0], cast: false });
      }
      // the door: teal frame with a big glass panel, hinged on its left, opening inward
      const door = group([-0.55, 0, 0.05], hub);
      add(box(1.1, 2.3, 0.06), teal('front', { a: '#1a5258', b: '#2f7479', moving: true }), [0.55, 1.15, 0], { parent: door });
      add(box(0.8, 1.5, 0.07), glow('#ffb460', 0.35), [0.55, 1.35, 0], { parent: door, cast: false });
      bake(door, 'front');
      // inside: walls, floor, the music room
      const room = (o = {}) => paint(Object.assign({ a: '#cfc6b6', b: '#f6f0e4', dabs: 'upright', size: 0.55, tilt: 0.3, at: 'room', emissive: '#ffb070', emissiveIntensity: 0.02 }, o));
      add(box(2 * W2, 0.06, DEEP), room({ a: '#b08a64', b: '#dcbc90', dabs: 'sweep' }), [0, 0.0, DEEP / 2], { parent: hub });
      add(box(2 * W2, 0.12, DEEP), room({ a: '#e8dcc8', b: '#fff6e8' }), [0, HH, DEEP / 2], { parent: hub });
      add(box(2 * W2, HH, 0.15), room(), [0, HH / 2, DEEP], { parent: hub });
      for (const sx of [-1, 1]) add(box(0.15, HH, DEEP), room(), [sx * W2, HH / 2, DEEP / 2], { parent: hub });
      const mural = K.canvasTex(512, 600, (ctx, w, h) => { ctx.drawImage(logo.canvas2d, 0, 0); });
      add(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshStandardMaterial({ map: mural, transparent: true, alphaTest: 0.1, roughness: 1, emissive: '#ffffff', emissiveMap: mural, emissiveIntensity: 0.1 }), [0.2, 1.75, DEEP - 0.09], { parent: hub, rot: [0, Math.PI, 0], cast: false });
      // rug and cushions in a circle (brand colours: mustard, blush, teal, sage)
      const C_LOCAL = [0.15, 0, 5.0], A_MUM = 3.75;                                     // circle centre in hub axes
      add(new THREE.CylinderGeometry(1.75, 1.75, 0.03, 40), room({ a: '#d8c6a6', b: '#f2e6cc', dabs: 'sweep' }), [C_LOCAL[0], 0.045, C_LOCAL[2]], { parent: hub });
      const CUSH = ['#e2a83e', '#e8a8a0', '#3f8a8e', '#8fa878', '#e2a83e', '#e8a8a0'];
      for (let i = 0; i < 6; i++) { const a = [Math.PI / 2, 0.25, 2.6, A_MUM, -0.7, 5.2][i]; add(new THREE.SphereGeometry(0.3, 14, 8), room({ a: CUSH[i], b: lin(CUSH[i]).offsetHSL(0, 0, 0.12).getStyle() }), [C_LOCAL[0] + Math.cos(a) * 1.35, 0.1, C_LOCAL[2] + Math.sin(a) * 1.35], { parent: hub, scale: [1, 0.32, 1] }); }
      // shelf with toys, a plant, a lamp, pictures
      add(box(1.6, 0.8, 0.4), room({ a: '#b98a5a', b: '#e0b07a' }), [-3.0, 0.4, 7.6], { parent: hub });
      for (let i = 0; i < 5; i++) add(box(0.18, 0.18, 0.18), room({ a: CUSH[i], b: CUSH[i] }), [-3.6 + i * 0.28, 0.9, 7.6], { parent: hub, rot: [0, i, 0] });
      add(new THREE.CylinderGeometry(0.18, 0.14, 0.4, 10), room({ a: '#c97a5a', b: '#e09a7a' }), [3.3, 0.2, 7.4], { parent: hub });
      add(blob, paint({ a: '#2f5a36', b: '#6a9a4a', dabs: 'upright', size: 0.5, at: 'room', flatShading: true }), [3.3, 0.85, 7.4], { parent: hub, scale: [0.45, 0.6, 0.45] });
      add(new THREE.SphereGeometry(0.22, 14, 8), glow('#ffb860', 3.2), [-3.3, 1.55, 7.6], { parent: hub, cast: false });
      add(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), room({ a: '#3a2a20', b: '#5a4030' }), [-3.3, 0.7, 7.6], { parent: hub });
      for (const [x, y, c] of [[-1.6, 2.1, '#e8a8a0'], [1.9, 2.0, '#8fa878']]) add(box(0.6, 0.45, 0.03), glow(c, 0.4), [x, y, DEEP - 0.09], { parent: hub, cast: false });
      lampLight(hub, [-3.0, 1.7, 7.2], 1.6, 8); lampLight(hub, [1.0, 3.0, 4.5], 1.2, 8);
      // A-frame sign on the footpath
      {
        const a = group([4.75, ground(4.75, 15.2) - 0.02, 15.2], scene, 0.25);
        for (const s of [-1, 1]) {
          const leafg = group([0, 0, 0], a); leafg.rotation.x = s * 0.2;
          add(box(0.62, 0.95, 0.03), plaster('front', { a: '#eae4d6', b: '#ffffff' }), [0, 0.47, s * 0.1], { parent: leafg });
          add(new THREE.PlaneGeometry(0.5, 0.6), new THREE.MeshStandardMaterial({ map: logo, transparent: true, alphaTest: 0.1, roughness: 1 }), [0, 0.52, s * 0.118], { parent: leafg, rot: [0, s > 0 ? 0 : Math.PI, 0], cast: false });
        }
      }

      // ---- people: rounded simple figures; arms and legs swing from their joints
      const skinM = (at) => paint({ a: '#d9a07a', b: '#f2c8a4', size: 0.4, at, moving: true });
      const person = (o) => {
        const at = o.at, g = group([0, 0, 0]), body = group([0, 0, 0], g);
        const cloth = paint({ a: o.top, b: lin(o.top).offsetHSL(0, 0, 0.12).getStyle(), dabs: 'upright', size: 0.45, tilt: 0.45, at, moving: true });
        const legsM = paint({ a: o.legs, b: lin(o.legs).offsetHSL(0, 0, 0.1).getStyle(), dabs: 'upright', size: 0.45, at, moving: true });
        const hairM = paint({ a: o.hair, b: lin(o.hair).offsetHSL(0, 0, 0.12).getStyle(), size: 0.4, at, moving: true });
        const legs = [-0.1, 0.1].map((x) => { const hip = group([x, 0.86, 0], body); add(new THREE.CapsuleGeometry(0.075, 0.68, 4, 8), legsM, [0, -0.42, 0], { parent: hip }); add(box(0.12, 0.08, 0.24), hairM, [0, -0.83, 0.05], { parent: hip }); return hip; });
        add(new THREE.LatheGeometry([[0, 0.8], [0.2, 0.82], [0.21, 1.0], [0.19, 1.3], [0.12, 1.42], [0, 1.44]].map((q) => new THREE.Vector2(q[0], q[1])), 12), cloth, [0, 0, 0], { parent: body, scale: [1, 1, 0.75] });
        const arms = [-0.24, 0.24].map((x) => { const sh = group([x, 1.36, 0], body); add(new THREE.CapsuleGeometry(0.06, 0.52, 4, 8), cloth, [0, -0.3, 0], { parent: sh }); add(new THREE.SphereGeometry(0.06, 8, 6), skinM(at), [0, -0.62, 0], { parent: sh }); return sh; });
        const head = group([0, 1.58, 0], body);
        add(new THREE.SphereGeometry(0.13, 16, 12), skinM(at), [0, 0, 0], { parent: head, scale: [0.92, 1.05, 1] });
        add(new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * (o.long ? 0.75 : 0.55)), hairM, [0, 0.025, -0.02], { parent: head, rot: [-0.35, 0, 0] });
        if (o.long) add(new THREE.SphereGeometry(0.12, 10, 8), hairM, [0, -0.12, -0.08], { parent: head, scale: [1.1, 1.3, 0.7] });
        g.scale.setScalar(o.s || 1);
        return { g, body, legs, arms, head };
      };
      const pose = (P, o) => {   // o: walk phase, amp, sit (0..1), armX [l, r] forward swing, armZ spread, lean, headTilt
        const sw = Math.sin(o.ph || 0) * (o.amp || 0);
        const sit = o.sit || 0;
        P.legs[0].rotation.x = K.lerp(sw, -1.45, sit); P.legs[1].rotation.x = K.lerp(-sw, -1.45, sit);
        P.legs.forEach((l, i) => { l.rotation.z = (i ? -1 : 1) * 0.12 * sit; });
        P.body.position.y = -0.6 * sit + 0.02 * Math.abs(Math.cos(o.ph || 0)) * (o.amp ? 1 : 0);
        P.body.rotation.x = o.lean || 0;
        P.arms[0].rotation.x = o.armX ? o.armX[0] : -sw * 0.8; P.arms[1].rotation.x = o.armX ? o.armX[1] : sw * 0.8;
        P.arms[0].rotation.z = -(o.armZ || 0); P.arms[1].rotation.z = o.armZ || 0;
        P.head.rotation.x = o.headTilt || 0; P.head.rotation.z = o.headRoll || 0;
      };
      const baby = (at, blanket) => {
        const g = group([0, 0, 0]);
        add(new THREE.SphereGeometry(0.17, 14, 10), paint({ a: blanket, b: lin(blanket).offsetHSL(0, 0, 0.12).getStyle(), size: 0.35, at, moving: true }), [0, 0, 0], { parent: g, scale: [0.8, 0.7, 1.35] });
        add(new THREE.SphereGeometry(0.085, 12, 10), skinM(at), [0, 0.07, 0.22], { parent: g });
        add(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), paint({ a: '#e9e2d6', b: '#ffffff', size: 0.3, at, moving: true }), [0, 0.09, 0.24], { parent: g, rot: [0.5, 0, 0] });
        return g;
      };

      // our parent, the pram and the baby
      const mum = person({ top: '#3f6a8e', legs: '#2c3448', hair: '#5a3424', long: true, at: 'path' });
      const pram = group([0, 0, 0]);
      {
        const sage = paint({ a: '#5f7a5a', b: '#8faa82', size: 0.4, tilt: 0.4, at: 'path', moving: true }), frame = paint({ a: '#2a2a30', b: '#4a4a52', size: 0.35, at: 'path', moving: true });
        add(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), sage, [0, 0.72, 0], { parent: pram, scale: [0.75, 0.55, 1.1] });
        add(new THREE.SphereGeometry(0.4, 18, 10, 0, Math.PI, 0, Math.PI / 2), sage, [0, 0.72, -0.22], { parent: pram, rot: [0, -Math.PI / 2, 0], scale: [1.0, 0.95, 0.72] });   // the hood
        for (const [x, z] of [[-0.3, 0.35], [0.3, 0.35], [-0.3, -0.35], [0.3, -0.35]]) add(new THREE.TorusGeometry(0.15, 0.035, 6, 14), frame, [x, 0.15, z], { parent: pram, rot: [0, Math.PI / 2, 0] });
        for (const s of [-1, 1]) { add(box(0.03, 0.03, 0.85), frame, [s * 0.28, 0.4, 0], { parent: pram, rot: [0.25, 0, 0] }); add(box(0.03, 0.03, 0.8), frame, [s * 0.27, 0.78, -0.6], { parent: pram, rot: [0.9, 0, 0] }); }
        add(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6), frame, [0, 1.06, -0.88], { parent: pram, rot: [0, 0, Math.PI / 2] });
      }
      const bub = baby('path', '#f0d6a8');
      // the music group: the facilitator with a ukulele and two families
      const lead = person({ top: '#7f9a7a', legs: '#4a3a34', hair: '#8a5a32', long: true, at: 'room' });
      const uke = group([0, 0, 0], lead.body);
      add(new THREE.SphereGeometry(0.11, 12, 8), paint({ a: '#b97a3a', b: '#e0a35a', size: 0.3, at: 'room', moving: true }), [0, 0, 0], { parent: uke, scale: [1, 1.2, 0.45] });
      add(box(0.05, 0.36, 0.03), paint({ a: '#5a3a24', b: '#7a5030', size: 0.3, at: 'room', moving: true }), [0, 0.28, 0], { parent: uke });
      uke.position.set(0.05, 1.08, 0.2); uke.rotation.set(0.1, 0, -1.0);
      const others = [{ top: '#e2a83e', legs: '#5a5a6a', hair: '#2a1a14', long: false, blanket: '#a8c8c8' }, { top: '#e8a8a0', legs: '#3a4a5a', hair: '#c98a4a', long: true, blanket: '#e8c8e0' }].map((o) => {
        const P = person(Object.assign({ at: 'room' }, o)); P.bub = baby('room', o.blanket); P.shaker = add(new THREE.SphereGeometry(0.05, 10, 8), glow('#ff7a3a', 0.6), [0, 0, 0], { cast: false }); return P;
      });
      // place everything that sits still in the room and bake its dabs
      const local2world = (x, z) => { const p = hubPt(x, 0, z); return [p[0], p[2]]; };
      const sitAt = (P, angle) => {
        const lx = C_LOCAL[0] + Math.cos(angle) * 1.35, lz = C_LOCAL[2] + Math.sin(angle) * 1.35, [wx, wz] = local2world(lx, lz), [cx, cz] = local2world(C_LOCAL[0], C_LOCAL[2]);
        P.g.position.set(wx, shopFloor + 0.12, wz); P.g.rotation.y = Math.atan2(cx - wx, cz - wz); return P;
      };
      sitAt(lead, Math.PI / 2); pose(lead, { sit: 1, armX: [-0.9, -0.6], armZ: 0.1 }); bake(lead.g, 'room');
      sitAt(others[0], 0.25); sitAt(others[1], 2.6);
      others.forEach((P) => { pose(P, { sit: 1, armX: [-0.9, -0.9], armZ: 0.25 }); bake(P.g, 'room'); bake(P.bub, 'room'); });
      // ours: baked at the start of the walk
      {
        const [x, z] = pr(0); mum.g.position.set(x, ground(x, z), z); pram.position.set(x + 1, ground(x, z), z); bake(mum.g, 'path'); bake(pram, 'path'); bub.position.set(x + 1, ground(x, z) + 0.68, z); bake(bub, 'path');
      }

      // tea steam over the facilitator's mug
      const mugPos = V(...hubPt(0.9, 0.12, 6.1));
      add(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10), glow('#f2e8d8', 0.25), [mugPos.x, mugPos.y, mugPos.z]);
      const plume = (o) => {
        const N = o.n || 18, g = new THREE.PlaneGeometry(1, 1, 1, N - 1), fade = new Float32Array(N * 8), p = g.attributes.position;
        for (let i = 0; i < N * 2; i++) fade.set([1, 1, 1, Math.pow(1 - Math.floor(i / 2) / (N - 1), 1.2)], i * 4);
        g.setAttribute('color', new THREE.BufferAttribute(fade, 4));
        const mat = new THREE.MeshBasicMaterial({ color: o.color, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        add(g, mat, [0, 0, 0], { cast: false }).frustumCulled = false;
        return (t, base, lean) => {
          mat.opacity = o.alpha;
          for (let i = 0; i < N; i++) {
            const k = i / (N - 1), along2 = o.h * (lean * Math.pow(k, 1.5) + 0.07 * k * Math.sin(7 * k - 2.4 * t + o.seed)), y = o.h * Math.pow(k, 0.75);
            const w = o.w * (0.15 + Math.pow(k, 0.8)) * (1 + 0.28 * Math.sin(15 * k - 5 * t + o.seed));
            for (const side of [-1, 1]) p.setXYZ(i * 2 + (side + 1) / 2, base.x + along2 * 0.3 + side * w, base.y + y, base.z + along2);
          }
          p.needsUpdate = true;
        };
      };
      const steam = plume({ color: '#fff4e4', alpha: 0.4, h: 0.5, w: 0.07, seed: 1 });

      // ---- gulls over the sea
      const wing = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.2, 0, 0, -0.2, 0.5, 0.16, 0.22, 0, 0, -0.2, 0.5, 0.16, -0.12, 0.5, 0.16, 0.22, 0.5, 0.16, 0.22, 0.5, 0.16, -0.12, 1.08, 0.02, -0.26], 3));
      const birdMat = new THREE.MeshBasicMaterial({ color: '#f4ece4', side: THREE.DoubleSide, fog: false });
      const birds = Array.from({ length: 3 }, (_, i) => {
        const g = new THREE.Group(), L = new THREE.Mesh(wing, birdMat), R = new THREE.Mesh(wing, birdMat); R.scale.x = -1; g.add(L, R); g.scale.setScalar(0.5); scene.add(g);
        return { g, L, R, off: V(i * 1.6, K.hash(i, 1) * 1.2, -i * 1.3), phase: K.hash(i, 2) * 6 };
      });
      const flight = (t) => V(-12 + 2.2 * t, 3.2 + 0.3 * Math.sin(t * 0.7), -10 - 0.6 * t);

      const dirTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
      const SEAT_W = local2world(C_LOCAL[0] + Math.cos(A_MUM) * 1.35, C_LOCAL[2] + Math.sin(A_MUM) * 1.35);
      const CIRC_W = local2world(C_LOCAL[0], C_LOCAL[2]);
      const at0 = pr(along(0)), at1 = pr(along(1.6)), at2 = pr(along(3.0));
      const A = (x, y, z) => [x, y, z];
      const SEAT_L = [C_LOCAL[0] + Math.cos(A_MUM) * 1.35, C_LOCAL[2] + Math.sin(A_MUM) * 1.35];
      const cam = {
        pos: K.path([[0, A(at0[0] + 4.2, 2.0, at0[1] + 2.6)], [1.6, A(at1[0] + 4.0, 2.0, at1[1] + 2.7)], [3.0, A(at2[0] + 3.6, 2.0, at2[1] + 1.6)], [4.4, A(2.4, 1.9, 13.0)], [5.6, A(1.6, 1.75, 24.6)], [6.6, A(5.0, 1.75, 20.45)],
          [7.6, hubPt(2.4, 1.65, 1.0)], [9.4, hubPt(SEAT_L[0] + 2.9, 1.45, SEAT_L[1] - 1.6)], [STOP, hubPt(SEAT_L[0] + 2.45, 1.3, SEAT_L[1] - 1.45)]]),
        aim: K.path([[0, A(at0[0] - 3.5, 0.2, at0[1] - 3.6)], [1.6, A(at1[0] - 3.5, 0.2, at1[1] - 3.6)], [3.0, A(at2[0] - 2.5, 0.5, at2[1] - 1.5)], [4.4, A(5.8, 0.9, 7.8)], [5.6, A(6.8, 2.0, 18.9)], [6.6, A(9.6, 1.15, 20.6)],
          [7.6, hubPt(-0.7, 0.85, 3.4)], [9.4, hubPt(SEAT_L[0] + 0.1, 0.75, SEAT_L[1] + 0.2)], [STOP, hubPt(SEAT_L[0] + 0.15, 0.72, SEAT_L[1] + 0.15)]]),
      };

      return {
        update(t) {
          uTime.value = t;
          sun.target.position.set(4, 0, 6); sun.position.copy(sun.target.position).addScaledVector(sunDir(0.3 - 0.02 * t / DURATION, 0.62), 80);
          skyU.uSun.value.copy(sunDir(0.07 - 0.01 * t / DURATION, 0.3));
          surf(t);

          // the pram rolls along the route; the parent walks behind it, pushing
          const u = along(t), p = ROUTE.getPointAt(K.clamp(u)), q = ROUTE.getPointAt(K.clamp(u + 0.004)), yaw = Math.atan2(q.x - p.x, q.z - p.z);
          const walked = u * ROUTE_LEN + 2.2 * K.seg(t, TO_SEAT, SEATED - 0.4), ph = walked / 0.36 * Math.PI;
          pram.position.set(p.x, ground(p.x, p.z), p.z); pram.rotation.y = yaw;
          if (p.x > SHOP_X - 0.2) pram.position.y = shopFloor;
          const behind = 1.45;
          const mx = p.x - Math.sin(yaw) * behind, mz = p.z - Math.cos(yaw) * behind;
          // after parking: the parent steps to the pram side, lifts the baby, walks to the cushion and sits
          const toSeat = K.seg(t, TO_SEAT, SEATED - 0.35, K.ease.inOut), sit = K.seg(t, SEATED - 0.45, SEATED, K.ease.inOut);
          const standX = K.lerp(mx, SEAT_W[0], toSeat), standZ = K.lerp(mz, SEAT_W[1], toSeat);
          mum.g.position.set(standX, Math.max(ground(standX, standZ), standX > SHOP_X - 0.3 ? shopFloor : -99) + 0.12 * sit, standZ);
          const faceCircle = dirTo([SEAT_W[0], SEAT_W[1]], CIRC_W);
          mum.g.rotation.y = t < LIFT ? yaw : K.lerp(yaw, faceCircle, K.seg(t, LIFT, SEATED - 0.4, K.ease.inOut));
          const walking = t < PARK - 0.15 ? 1 : (t > TO_SEAT && t < SEATED - 0.4 ? 1 : 0);
          const lift = K.seg(t, LIFT, LIFTED, K.ease.inOut);
          const sleepK = K.seg(t, SLEEP, ASLEEP, K.ease.inOut), rock = t > SEATED ? Math.sin((t - SEATED) * 2.6) * 0.06 * (1 - 0.5 * sleepK) : 0;
          pose(mum, {
            ph: walking ? ph : 0, amp: walking ? 0.5 : 0, sit,
            armX: t < LIFT - 0.1 ? [-1.25, -1.25] : [K.lerp(-1.25, -0.95, lift), K.lerp(-1.25, -0.95, lift)], armZ: t < LIFT ? 0.05 : 0.32 * lift,
            lean: t < LIFT ? 0.1 : 0.1 + 0.25 * Math.sin(Math.PI * lift) + rock + 0.08 * sleepK, headTilt: 0.15 + 0.25 * sleepK,
          });
          mum.g.updateMatrixWorld(true);
          // the baby: in the pram, then held against the parent's chest
          const inPram = V(0, 0.68, 0.0).applyMatrix4(pram.matrixWorld), held = V(0, 1.1, 0.3).applyMatrix4(mum.body.matrixWorld);
          bub.position.copy(inPram.lerp(held, lift)); bub.rotation.set(0.35 * sleepK * lift, K.lerp(yaw + Math.PI, mum.g.rotation.y + Math.PI / 2, lift), 0.5 * lift);
          // the door opens as the pram reaches it
          door.rotation.y = -1.55 * K.seg(t, DOOR_OPEN - 0.3, DOOR_OPEN + 0.35, K.ease.inOut);
          // the music: strums, shakers, rocking
          const st = t - MUSIC, beat = st > 0 ? Math.sin(st / STRUM * Math.PI * 2) : 0;
          lead.arms[1].rotation.x = -0.6 + 0.25 * beat * (st > 0 ? 1 : 0); lead.head.rotation.z = 0.06 * Math.sin(st * 2.2) * (st > 0 ? 1 : 0);
          others.forEach((P, i) => {
            const rk = Math.sin(t * 2.4 + i * 1.7) * 0.05; P.body.rotation.x = rk;
            P.g.updateMatrixWorld(true);
            P.bub.position.copy(V(0, 1.05, 0.3).applyMatrix4(P.body.matrixWorld)); P.bub.rotation.set(0.2, P.g.rotation.y + Math.PI / 2, 0.5);
            const sh = st > 0 ? Math.abs(Math.sin(st / STRUM * Math.PI * 2 + i)) : 0;
            P.shaker.position.copy(V(0.05 * (i ? -1 : 1), 1.2 + 0.08 * sh, 0.4).applyMatrix4(P.body.matrixWorld));
          });
          steam(t, mugPos.clone().add(V(0, 0.05, 0)), 0.3);
          const lead0 = flight(t);
          birds.forEach((b) => { b.g.position.copy(lead0).add(b.off); b.g.lookAt(lead0.clone().add(V(2, 0, -0.6)).add(b.off)); const f = 0.4 + 0.4 * Math.sin(t * 7 + b.phase); b.L.rotation.z = f; b.R.rotation.z = -f; });
          K.look(camera, cam.pos(t), cam.aim(t));
          caption(t);
        },
      };
    },

    sound(k) {
      // a quiet coastal morning: surf and wind outside, footsteps and pram wheels, the door, then a small room with a
      // ukulele, shakers and a lullaby chord, and the hush when the baby sleeps
      k.bed('room', 0, DURATION, { gain: 0.6 });
      k.withMinor(() => {
        // surf under the cliff, louder before the street, muffled inside
        k.noise(0, { dur: DOOR_IN + 0.6, color: 'pink', filter: 'lowpass', f: [[0, 900], [TURN + 1.5, 600], [DOOR_IN + 0.6, 260]], gain: 0.16, a: 0.6, hold: DOOR_IN - 1, pan: -0.3, bus: 'amb' });
        for (const w of WAVES) k.noise(w + 0.3, { dur: 1.8, color: 'pink', filter: 'bandpass', f: [[0, 400], [0.4, 1400], [1.8, 500]], q: 0.6, gain: 0.22 * (w < TURN ? 1 : 0.5), a: 0.35, pan: -0.4, verb: 0.3 });
        k.noise(0, { dur: DOOR_IN, color: 'pink', filter: 'bandpass', f: 520, q: 0.7, gain: 0.04, a: 1.0, hold: DOOR_IN - 1.5, bus: 'amb' });   // breeze
        for (const t of [0.5, 0.8, 2.1]) k.tone(t, { f: [[0, 1800], [0.08, 2600], [0.2, 1500]], dur: 0.24, gain: 0.03, a: 0.01, pan: 0.4, verb: 0.5 });   // gulls
        // footsteps and wheel crunch while walking
        for (let t = 0.15; t < PARK - 0.2; t += 0.38) { const inside = t > DOOR_IN; k.noise(t, { dur: 0.06, color: 'brown', filter: 'bandpass', f: inside ? 420 : (t < TURN ? 900 : 650), q: 1.2, gain: inside ? 0.12 : 0.1, a: 0.004, pan: 0.05 }); }
        k.noise(0, { dur: TURN + 0.2, color: 'white', filter: 'bandpass', f: 2600, q: 0.7, gain: 0.025, a: 0.3, hold: TURN - 0.4 });   // wheels on the gravel path
        for (const w of lettering()) if (w.beat) k.play('stroke', w.t0, { dur: w.dur, material: 'brush', gain: 1.1, pan: -0.6 });
      });
      // the door: latch, a soft creak, a shop bell
      k.play('click', DOOR_OPEN - 0.3, { gain: 0.6, f: 1400, pan: 0.2 });
      k.noise(DOOR_OPEN - 0.25, { dur: 0.55, color: 'pink', filter: 'bandpass', f: [[0, 600], [0.55, 900]], q: 4, gain: 0.05, a: 0.1, pan: 0.2 });
      k.play('ding', DOOR_OPEN, { f: 'E6', gain: 0.35, pan: 0.2 }); k.play('ding', DOOR_OPEN + 0.12, { f: 'B6', gain: 0.22, pan: 0.25 });
      // ukulele strums and shakers
      const CH = [['C4', 'E4', 'G4', 'C5'], ['A3', 'E4', 'A4', 'C5'], ['F3', 'C4', 'F4', 'A4'], ['G3', 'D4', 'G4', 'B4']];
      strums().forEach((t, i) => {
        const ch = CH[Math.floor(i / 4) % 4], soft = t > SLEEP ? 0.55 : 1;
        ch.forEach((n, j) => k.tone(t + j * 0.014, { f: n, type: 'triangle', dur: 0.9, gain: 0.05 * soft, a: 0.003, filter: 'lowpass', f2: 2400, pan: 0.15, verb: 0.2 }));
        if (t < SLEEP) k.noise(t + STRUM / 2, { dur: 0.08, filter: 'bandpass', f: 5200, q: 1.5, gain: 0.07, a: 0.01, pan: (i % 2 ? 0.4 : -0.3) });
      });
      // the pram settles; the baby is lifted; the sleep chord
      k.play('tock', PARK, { f: 210, gain: 0.25, pan: 0.05 });
      k.noise(LIFT, { dur: LIFTED - LIFT, color: 'pink', filter: 'bandpass', f: 1500, q: 0.8, gain: 0.04, a: 0.2 });
      k.music('pad', SLEEP - 0.5, DURATION, { bpm: 60, gain: 0.6, chords: [['C3', 'G3', 'E4', 'G4'], ['F3', 'C4', 'A4', 'C5']] });
      k.tone(ASLEEP, { f: 'G5', dur: 2.0, gain: 0.04, a: 0.05, verb: 0.7 }); k.tone(ASLEEP + 0.15, { f: 'E5', dur: 2.0, gain: 0.03, a: 0.05, verb: 0.7 });
    },
  });
}
