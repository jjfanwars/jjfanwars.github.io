// LAST STAND: first-person horde shooter. World, warrior bugs, rotary cannon, audio, HUD, squad multiplayer.
'use strict';
const $ = id => document.getElementById(id);
const TEST = /[?&]test/.test(location.search);
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }

// ---------------- settings
const SET = Object.assign({sens: 1, vol: .8, gfx: 'high', auto: true, name: 'Trooper'}, (() => { try { return JSON.parse(localStorage.getItem('ls-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('ls-set', JSON.stringify(SET)); } catch (e) {} };
const HI = () => SET.gfx === 'high';

// ---------------- net (jjfanwars relay; same frames as hollow/rig)
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const Net = {
  tag: '[LastStand]', role: 'solo', ws: null, peers: new Map(), code: '', id: '', name: '', handlers: {}, retry: 0,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return decodeURIComponent(m[1]).replace(/\/$/, ''); return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) {
    if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} }
    else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} }
  },
  send1(id, o) { if (!this.ws || this.ws.readyState !== 1) return; const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s squad", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(true); this.onStatus && this.onStatus('open'); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') {
        if (!this.peers.has(id) && this.peers.size >= 3) { this.send1(id, {t: 'full'}); return; }
        const used = new Set([0, ...[...this.peers.values()].map(p => p.slot)]); let s = 1; while (used.has(s)) s++;
        const p = this.peers.get(id) || {id, slot: s, kills: 0, yaw: 0, fire: 0};
        p.name = String(m.name || 'Trooper').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Trooper';
        this.peers.set(id, p); this.emit({t: '_join', id}); return;
      }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id);
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) {
    this.close(); this.role = 'guest'; this.code = code; this.name = name; this.id = Math.random().toString(36).slice(2, 11);
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.send({t: 'hello', name});
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostgone'}); else if (m.c === 'host' && m.up) { this.send({t: 'hello', name}); this.emit({t: '_hostback'}); } return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      if (m.t === 'full') { this.close(); onFail('That squad is full (4 max).'); return; }
      this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such squad code.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null; this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
};
const isHost = () => Net.role !== 'guest';

// ---------------- renderer + post
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: false, powerPreference: 'high-performance'});
RND.toneMapping = THREE.NoToneMapping; RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .03, 6000);
scene.add(cam);
const FOG = new THREE.Color(.62, .25, .1);
scene.fog = new THREE.FogExp2(FOG, .0016);
const POST = {};
function mkRT(w, h, ms) { return new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: ms || 0, depthBuffer: !!ms || ms === 0 && false}); }
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene();
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsScene.add(fsQuad);
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const brightM = new THREE.ShaderMaterial({uniforms: {t: {value: null}, px: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: 'uniform sampler2D t; uniform vec2 px; varying vec2 vUv; void main(){ vec3 c = (texture2D(t, vUv + px*vec2(-1.,-1.)).rgb + texture2D(t, vUv + px*vec2(1.,-1.)).rgb + texture2D(t, vUv + px*vec2(-1.,1.)).rgb + texture2D(t, vUv + px*vec2(1.,1.)).rgb) * .25; float l = max(c.r, max(c.g, c.b)); c *= smoothstep(.9, 2.2, l); gl_FragColor = vec4(min(c, vec3(30.)), 1.); }'});
const blurM = new THREE.ShaderMaterial({uniforms: {t: {value: null}, d: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d*1.38).rgb + texture2D(t, vUv - d*1.38).rgb) * .316; c += (texture2D(t, vUv + d*3.23).rgb + texture2D(t, vUv - d*3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }'});
const compM = new THREE.ShaderMaterial({uniforms: {t: {value: null}, b: {value: null}, b2: {value: null}, time: {value: 0}, bloom: {value: .9}, exp: {value: 1}, dmg: {value: 0}, ab: {value: .004}, res: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: `uniform sampler2D t, b, b2; uniform float time, bloom, exp, dmg, ab; uniform vec2 res; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.13) * 43758.5453); }
  void main(){ vec2 d = vUv - .5; float r = dot(d, d); vec2 o = d * ab * (1. + dmg*3.);
    vec3 c = vec3(texture2D(t, vUv + o).r, texture2D(t, vUv).g, texture2D(t, vUv - o).b);
    c += (texture2D(b, vUv).rgb * .6 + texture2D(b2, vUv).rgb * .8) * bloom;
    c = aces(c * exp * .62);
    c = pow(c, vec3(1./2.2));
    c *= 1. - r * .85; c = mix(c, vec3(.55, .02, 0.), clamp(dmg * smoothstep(.05, .35, r), 0., .8));
    c += (hash(vUv * res) - .5) * .045;
    gl_FragColor = vec4(c, 1.); }`});
function setupPost() {
  const pr = Math.min(devicePixelRatio, HI() ? 1.5 : .85), w = Math.max(2, innerWidth * pr | 0), h = Math.max(2, innerHeight * pr | 0);
  RND.setPixelRatio(pr); RND.setSize(innerWidth, innerHeight, false);
  for (const k in POST) POST[k].dispose();
  POST.main = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: HI() ? 4 : 0});
  const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
  POST.a = new THREE.WebGLRenderTarget(bw, bh, {type: THREE.HalfFloatType, depthBuffer: false}); POST.b = POST.a.clone();
  POST.c = new THREE.WebGLRenderTarget(bw >> 2 || 1, bh >> 2 || 1, {type: THREE.HalfFloatType, depthBuffer: false}); POST.d = POST.c.clone();
  compM.uniforms.res.value.set(w, h); POST.w = w; POST.h = h;
  RND.shadowMap.enabled = HI(); if (window.SUN) { SUN.castShadow = HI(); RND.shadowMap.needsUpdate = true; }
}
function pass(mat, target) { fsQuad.material = mat; RND.setRenderTarget(target); RND.render(fsScene, fsCam); }
function render() {
  RND.setRenderTarget(POST.main); RND.render(scene, cam);
  brightM.uniforms.t.value = POST.main.texture; brightM.uniforms.px.value.set(1 / POST.w, 1 / POST.h); pass(brightM, POST.a);
  blurM.uniforms.t.value = POST.a.texture; blurM.uniforms.d.value.set(1 / POST.a.width, 0); pass(blurM, POST.b);
  blurM.uniforms.t.value = POST.b.texture; blurM.uniforms.d.value.set(0, 1 / POST.a.height); pass(blurM, POST.a);
  brightM.uniforms.t.value = POST.a.texture; brightM.uniforms.px.value.set(1 / POST.a.width, 1 / POST.a.height); pass(blurM, POST.c);
  blurM.uniforms.t.value = POST.c.texture; blurM.uniforms.d.value.set(1.5 / POST.c.width, 0); pass(blurM, POST.d);
  blurM.uniforms.t.value = POST.d.texture; blurM.uniforms.d.value.set(0, 1.5 / POST.c.height); pass(blurM, POST.c);
  compM.uniforms.t.value = POST.main.texture; compM.uniforms.b.value = POST.a.texture; compM.uniforms.b2.value = POST.c.texture;
  compM.uniforms.bloom.value = HI() ? .9 : .5;
  pass(compM, null);
}

// ---------------- canvas textures
function cvs(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function ctex(c, srgb = true, rep) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; return t; }
const sandTex = ctex(cvs(512, 512, (g, w, h) => {
  const id = g.createImageData(w, h), d = id.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x * .04, y * .04) * .5 + Math.random() * .35 + .5 * (Math.sin((x + fbm(x * .02, y * .02) * 40) * .25) * .5 + .5) * .3;
    const i = (y * w + x) * 4; d[i] = 150 + n * 70; d[i + 1] = 92 + n * 45; d[i + 2] = 58 + n * 28; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}), true, true);
const soft = ctex(cvs(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.4, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }), false);
const blobT = ctex(cvs(64, 64, (g) => { let r = g.createRadialGradient(32, 32, 0, 32, 32, 30); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.75, 'rgba(220,220,220,.95)'); r.addColorStop(1, 'rgba(180,180,180,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  r = g.createRadialGradient(24, 22, 0, 24, 22, 10); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.globalCompositeOperation = 'lighter'; g.fillStyle = r; g.fillRect(0, 0, 64, 64); }), false);
const starT = ctex(cvs(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 60); r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(.18, 'rgba(255,220,140,.9)'); r.addColorStop(.5, 'rgba(255,140,40,.25)'); r.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); g.translate(64, 64); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) { g.rotate(TAU / 9 + Math.random() * .3); const l = 30 + Math.random() * 32; const gr = g.createLinearGradient(0, 0, l, 0); gr.addColorStop(0, 'rgba(255,240,200,.95)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -5); g.lineTo(l, 0); g.lineTo(0, 5); g.fill(); }
}), true);
const splatT = ctex(cvs(128, 128, (g) => {
  g.fillStyle = '#fff'; g.translate(64, 64);
  for (let i = 0; i < 22; i++) { const a = Math.random() * TAU, d = Math.random() * 34, r = 8 + Math.random() * 18; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (1 - d / 60), 0, TAU); g.fill(); }
  for (let i = 0; i < 14; i++) { const a = Math.random() * TAU, d = 40 + Math.random() * 20; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 2 + Math.random() * 3, 0, TAU); g.fill(); }
}), true);
const burlapT = ctex(cvs(128, 128, (g, w, h) => { g.fillStyle = '#8a7350'; g.fillRect(0, 0, w, h); for (let i = 0; i < 128; i += 2) { g.fillStyle = `rgba(40,25,10,${.1 + Math.random() * .15})`; g.fillRect(0, i, w, 1); g.fillRect(i, 0, 1, h); } for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '30,20,10' : '200,170,120'},.12)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }), true, true);
const markT = ctex(cvs(512, 128, (g, w, h) => {
  g.fillStyle = '#2b3034'; g.fillRect(0, 0, w, h);
  for (let i = -2; i < 10; i++) { g.fillStyle = i % 2 ? '#d8a21c' : '#151515'; g.beginPath(); g.moveTo(400 + i * 18, 0); g.lineTo(418 + i * 18, 0); g.lineTo(400 + i * 18 - 40, h); g.lineTo(382 + i * 18 - 40, h); g.fill(); }
  g.fillStyle = '#2b3034'; g.fillRect(0, 0, 380, h);
  g.fillStyle = '#e9e4d8'; g.font = 'bold 44px monospace'; g.fillText('XR-6 ROTARY', 16, 56); g.font = '22px monospace'; g.fillStyle = '#9fb'; g.fillText('KESTREL-9 // 7.6 CASELESS', 16, 92);
  g.fillStyle = '#6ff7ee'; g.fillRect(16, 104, 120, 6);
}), true);
const texL = new THREE.TextureLoader();
function ltex(p, srgb, rep) { const t = texL.load(p); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep, rep); t.anisotropy = 8; return t; }

// ---------------- sky + lights
const SUN_DIR = new THREE.Vector3(-.55, .1, -.83).normalize();
const skyM = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {sunDir: {value: SUN_DIR}, flash: {value: 0}},
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
  fragmentShader: `uniform vec3 sunDir; uniform float flash; varying vec3 vD;
  void main(){ vec3 d = normalize(vD); float e = d.y;
    vec3 zen = vec3(.035, .018, .04), mid = vec3(.42, .12, .05), hor = vec3(1.25, .45, .15);
    float t = max(e, 0.); vec3 c = mix(hor, mid, smoothstep(0., .16, t)); c = mix(c, zen, smoothstep(.1, .65, t));
    if (e < 0.) c = mix(hor, vec3(.35, .12, .05), smoothstep(0., -.08, e));
    float sd = max(dot(d, sunDir), 0.);
    c += vec3(1., .5, .2) * pow(sd, 6.) * .7 + vec3(1., .65, .35) * pow(sd, 60.) * 1.6;
    c += vec3(40., 22., 9.) * smoothstep(.9993, .9996, sd);
    c += vec3(.9, .35, .12) * exp(-abs(e) * 16.) * .3;
    float bands = sin(e * 90. + d.x * 3.) * .5 + .5; c *= 1. - .06 * bands * smoothstep(.02, .2, e) * (1. - smoothstep(.2, .5, e));
    c += vec3(1., .6, .3) * flash * exp(-abs(e) * 10.);
    gl_FragColor = vec4(c, 1.); }`});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyM); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
{ const pm = new THREE.PMREMGenerator(RND), s2 = new THREE.Scene(); s2.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyM)); scene.environment = pm.fromScene(s2, 0, .1, 1000).texture; scene.environmentIntensity = .55; }
const SUN = window.SUN = new THREE.DirectionalLight(0xffa066, 3.4);
SUN.position.copy(SUN_DIR).multiplyScalar(200).add(new THREE.Vector3(0, 0, -30)); SUN.target.position.set(0, 0, -30); scene.add(SUN, SUN.target);
SUN.castShadow = true; SUN.shadow.mapSize.set(2048, 2048); Object.assign(SUN.shadow.camera, {left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 500}); SUN.shadow.bias = -.0006; SUN.shadow.normalBias = .04;
const HEMI = new THREE.HemisphereLight(0xff9a70, 0x4a2414, 1.2); scene.add(HEMI);
const fireL = new THREE.PointLight(0xff6a20, 60, 90, 1.6); fireL.position.set(-60, 6, -95); scene.add(fireL);
const flareL = new THREE.PointLight(0xff3a20, 0, 160, 1.4); scene.add(flareL);
const muzL = new THREE.PointLight(0xffb060, 0, 30, 1.6); scene.add(muzL);

// ---------------- terrain
const GS = 2.5, GE = 300, GN = GE * 2 / GS + 1;
function H0(x, z) {
  const r = Math.hypot(x, z), f = smooth((r - 16) / 55);
  const warp = fbm(x * .006, z * .006) * 5;
  const dune = Math.pow(1 - Math.abs(Math.sin(x * .026 + z * .012 + warp)), 2.4) * 5.5;
  const roll = (fbm(x * .004 + 11, z * .004 - 3) - .5) * 26;
  return f * (dune + roll + (fbm(x * .05, z * .05) - .5) * 1.6 - 1.5) + smooth((r - 280) / 500) * 30;
}
const HG = new Float32Array(GN * GN);
for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) HG[j * GN + i] = H0(-GE + i * GS, -GE + j * GS);
function gH(x, z) {
  const fx = (x + GE) / GS, fz = (z + GE) / GS;
  if (fx < 0 || fz < 0 || fx >= GN - 1 || fz >= GN - 1) return H0(x, z);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, a = HG[j * GN + i], b = HG[j * GN + i + 1], c = HG[(j + 1) * GN + i], d = HG[(j + 1) * GN + i + 1];
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
function groundCol(x, z, h, arr, k) {
  const n = fbm(x * .02 + 5, z * .02), t = clamp(h / 8 + .5, 0, 1);
  arr[k] = .85 + n * .3 - (1 - t) * .15; arr[k + 1] = .72 + n * .2 - (1 - t) * .12; arr[k + 2] = .62 + n * .15 - (1 - t) * .1;
}
const groundM = new THREE.MeshStandardMaterial({map: sandTex, normalMap: ltex('../tex/ground_n.jpg', false), roughness: .96, metalness: 0, vertexColors: true});
groundM.normalScale.set(.6, .6);
{
  const g = new THREE.PlaneGeometry(GE * 2, GE * 2, GN - 1, GN - 1); g.rotateX(-PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), h = gH(x, z); p.setY(i, h); groundCol(x, z, h, col, i * 3); uv.setXY(i, x / 7, z / 7); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, groundM); m.receiveShadow = true; scene.add(m);
  const g2 = new THREE.PlaneGeometry(9000, 9000, 120, 120); g2.rotateX(-PI / 2);
  const p2 = g2.attributes.position, c2 = new Float32Array(p2.count * 3), uv2 = g2.attributes.uv;
  for (let i = 0; i < p2.count; i++) { const x = p2.getX(i), z = p2.getZ(i), h = H0(x, z) - 2.5; p2.setY(i, h); groundCol(x, z, h, c2, i * 3); uv2.setXY(i, x / 7, z / 7); }
  g2.setAttribute('color', new THREE.BufferAttribute(c2, 3)); g2.computeVertexNormals();
  scene.add(new THREE.Mesh(g2, groundM));
}
// mesas
{
  const m = new THREE.MeshStandardMaterial({color: 0x6a3420, roughness: 1});
  for (let i = 0; i < 16; i++) {
    const a = -1.9 + i * .24 + rnd(-.08, .08), r = rnd(900, 1700), h = rnd(60, 190), rt = rnd(60, 170);
    const g = new THREE.CylinderGeometry(rt, rt * rnd(1.15, 1.5), h, 9, 4); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k), s = 1 + (fbm(p.getX(k) * .02 + i, y * .05) - .5) * .5; p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s); if (y > h / 2 - 1) p.setY(k, y + (fbm(p.getX(k) * .03, p.getZ(k) * .03) - .5) * 14); }
    g.computeVertexNormals(); const me = new THREE.Mesh(g, m); me.position.set(Math.sin(a) * r, h / 2 - 8 + H0(Math.sin(a) * r, -Math.cos(a) * r) * .2, -Math.cos(a) * r); scene.add(me);
  }
}
// rocks
{
  const g = new THREE.DodecahedronGeometry(1, 1), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const s = 1 + (h2(p.getX(k) * 9.1, p.getY(k) * 7.3 + p.getZ(k) * 3.1) - .5) * .45; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * .7, p.getZ(k) * s); }
  g.computeVertexNormals();
  const N = 260, im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({color: 0x5a3324, roughness: .9}), N), o = new THREE.Object3D();
  for (let i = 0; i < N; i++) { let x, z; do { x = rnd(-280, 280); z = rnd(-290, 60); } while (Math.hypot(x, z) < 22); const s = Math.random() < .1 ? rnd(2, 4) : rnd(.3, 1.3); o.position.set(x, gH(x, z) - s * .2, z); o.rotation.set(rnd(0, 3), rnd(0, 6), rnd(0, 3)); o.scale.setScalar(s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
  im.castShadow = im.receiveShadow = true; scene.add(im);
}

// ---------------- particles
class Parts {
  constructor(n, tex, blend) {
    this.n = n; this.i = 0; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.sz = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.stick = new Uint8Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('col', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({uniforms: {map: {value: tex}, scale: {value: 600}}, transparent: true, depthWrite: false, blending: blend,
      vertexShader: 'attribute vec4 col; attribute float size; uniform float scale; varying vec4 vC; void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * scale / max(-mv.z, .1); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a); }'});
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; scene.add(this.pts); this.g = g;
  }
  add(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0, stick = 0) {
    const i = this.i = (this.i + 1) % this.n, k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.a0[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.stick[i] = stick;
  }
  step(dt) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.sz[i] = 0; continue; }
      const l = this.life[i] -= dt, k = i * 3, t = 1 - l / this.max[i];
      V[k + 1] -= this.grav[i] * dt; const dr = 1 - this.drag[i] * dt; V[k] *= dr; V[k + 1] *= dr; V[k + 2] *= dr;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      if (this.stick[i] && V[k + 1] < 0) { const gy = gH(P[k], P[k + 2]) + .04; if (P[k + 1] < gy) { P[k + 1] = gy; V[k] = V[k + 1] = V[k + 2] = 0; this.grav[i] = 0; } }
      this.sz[i] = l > 0 ? mix(this.s0[i], this.s1[i], t) : 0; this.col[i * 4 + 3] = this.a0[i] * (1 - t * t);
    }
    this.g.attributes.position.needsUpdate = this.g.attributes.col.needsUpdate = this.g.attributes.size.needsUpdate = true;
  }
}
const PA = new Parts(2600, soft, THREE.AdditiveBlending);   // sparks, embers, fire
const PS = new Parts(3000, soft, THREE.NormalBlending);     // smoke, dust
const PG = new Parts(3500, blobT, THREE.NormalBlending);    // slime
PG.pts.renderOrder = 2;

// instanced pools helper
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3(), _o = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function pool(geo, mat, n, shadow) { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO); m.frustumCulled = false; if (shadow) m.castShadow = true; scene.add(m); return m; }
// segment matrix: unit geometry along +y from 0..1 stretched from a to b, thickness th
function segMat(e, ax, ay, az, bx, by, bz, th) {
  let yx = bx - ax, yy = by - ay, yz = bz - az; const L = Math.hypot(yx, yy, yz) || 1e-4;
  let xx = yy * 0 - yz * 1, xy = yz * 0 - yx * 0, xz = yx * 1 - yy * 0; // cross(y, up=(0,1,0)) -> (-yz, 0, yx)
  xx = -yz; xy = 0; xz = yx; let xl = Math.hypot(xx, xz); if (xl < 1e-5) { xx = 1; xz = 0; xl = 1; }
  xx /= xl; xz /= xl;
  const ux = yx / L, uy = yy / L, uz = yz / L;
  const zx = xy * uz - xz * uy, zy = xz * ux - xx * uz, zz = xx * uy - xy * ux;
  e[0] = xx * th; e[1] = xy * th; e[2] = xz * th; e[3] = 0; e[4] = yx; e[5] = yy; e[6] = yz; e[7] = 0; e[8] = zx * th; e[9] = zy * th; e[10] = zz * th; e[11] = 0; e[12] = ax; e[13] = ay; e[14] = az; e[15] = 1;
}

// decals (goo pools)
const decGeo = new THREE.PlaneGeometry(1, 1); decGeo.rotateX(-PI / 2);
const DEC = pool(decGeo, new THREE.MeshStandardMaterial({map: splatT, transparent: true, depthWrite: false, roughness: .08, metalness: .1, color: 0x7fb020, polygonOffset: true, polygonOffsetFactor: -4, emissive: 0x1a3000}), 240);
DEC.receiveShadow = true; DEC.renderOrder = 1;
const decs = []; let decI = 0;
function addDecal(x, z, s, c) { const i = decI = (decI + 1) % 240; decs[i] = {x, z, y: gH(x, z) + .03, s, r: Math.random() * TAU, t: 0, life: 30}; DEC.setColorAt(i, _v.set(c[0], c[1], c[2])); DEC.instanceColor.needsUpdate = true; }
DEC.setColorAt(0, new THREE.Color(1, 1, 1));
function stepDecals(dt) {
  for (let i = 0; i < 240; i++) { const d = decs[i]; if (!d) continue; d.t += dt; const g = Math.min(1, d.t * 5), f = d.t > d.life - 4 ? Math.max(0, (d.life - d.t) / 4) : 1;
    if (d.t > d.life) { decs[i] = null; DEC.setMatrixAt(i, ZERO); continue; }
    _o.position.set(d.x, d.y, d.z); _o.rotation.set(0, d.r, 0); _o.scale.setScalar(d.s * (.4 + .6 * g) * (.3 + .7 * f)); _o.updateMatrix(); DEC.setMatrixAt(i, _o.matrix); }
  DEC.instanceMatrix.needsUpdate = true;
}

// debris chunks (carapace)
const chunkGeo = new THREE.IcosahedronGeometry(1, 0); chunkGeo.scale(1, .35, .8);
const CHK = pool(chunkGeo, new THREE.MeshStandardMaterial({color: 0x6a3a18, roughness: .35, metalness: .1}), 300, true);
const legGeoD = new THREE.CylinderGeometry(.01, .08, 1, 6); legGeoD.translate(0, .5, 0);
const LGD = pool(legGeoD, new THREE.MeshStandardMaterial({color: 0x5a3416, roughness: .4}), 80, true);
const chunks = [], legsD = []; let chI = 0, lgI = 0;
function addChunk(x, y, z, s, sp, leg) {
  const o = {x, y, z, vx: rnd(-1, 1) * sp, vy: rnd(.5, 1.5) * sp, vz: rnd(-1, 1) * sp, rx: rnd(0, 6), ry: rnd(0, 6), wx: rnd(-15, 15), wy: rnd(-15, 15), s, t: 0, rest: 0};
  if (leg) { lgI = (lgI + 1) % 80; legsD[lgI] = o; } else { chI = (chI + 1) % 300; chunks[chI] = o; }
}
function stepChunks(arr, M, n, dt, leg) {
  for (let i = 0; i < n; i++) { const o = arr[i]; if (!o) continue; o.t += dt;
    if (o.t > 9) { arr[i] = null; M.setMatrixAt(i, ZERO); continue; }
    if (!o.rest) { o.vy -= 18 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.rx += o.wx * dt; o.ry += o.wy * dt;
      const gy = gH(o.x, o.z) + o.s * .15; if (o.y < gy) { o.y = gy; if (Math.abs(o.vy) < 2) { o.rest = 1; o.rx = leg ? PI / 2 : 0; } o.vy *= -.3; o.vx *= .5; o.vz *= .5; o.wx *= .5; } }
    const sink = o.t > 7 ? (o.t - 7) * .3 : 0;
    _o.position.set(o.x, o.y - sink, o.z); _o.rotation.set(o.rx, o.ry, 0); _o.scale.set(leg ? o.s * 1.6 : o.s, leg ? o.s * 1.6 : o.s, o.s); if (leg) _o.scale.set(o.s * 1.4, o.s * 1.8, o.s * 1.4); _o.updateMatrix(); M.setMatrixAt(i, _o.matrix); }
  M.instanceMatrix.needsUpdate = true;
}

// tracers
const trGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); trGeo.translate(0, .5, 0);
const TRC = pool(trGeo, new THREE.MeshBasicMaterial({color: new THREE.Color(8, 3.2, .8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false}), 80);
const tracers = []; let trI = 0;
function addTracer(a, b) { trI = (trI + 1) % 80; const d = a.distanceTo(b); tracers[trI] = {ax: a.x, ay: a.y, az: a.z, dx: (b.x - a.x) / d, dy: (b.y - a.y) / d, dz: (b.z - a.z) / d, L: d, p: 0}; }
function stepTracers(dt) {
  const e = _m.elements;
  for (let i = 0; i < 80; i++) { const t = tracers[i]; if (!t) continue; t.p += 700 * dt;
    if (t.p > t.L + 6) { tracers[i] = null; TRC.setMatrixAt(i, ZERO); continue; }
    const p0 = Math.max(0, t.p - 7), p1 = Math.min(t.L, t.p);
    segMat(e, t.ax + t.dx * p0, t.ay + t.dy * p0, t.az + t.dz * p0, t.ax + t.dx * p1, t.ay + t.dy * p1, t.az + t.dz * p1, .022); TRC.setMatrixAt(i, _m); }
  TRC.instanceMatrix.needsUpdate = true;
}

// shell casings
const casGeo = new THREE.CylinderGeometry(.007, .007, .05, 6); casGeo.rotateZ(PI / 2);
const CAS = pool(casGeo, new THREE.MeshBasicMaterial({color: 0xffffff}), 160);
CAS.setColorAt(0, new THREE.Color(1, 1, 1));
const cases = []; let caI = 0;
function addCase(p, v) { caI = (caI + 1) % 160; cases[caI] = {x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, rx: 0, ry: rnd(0, 6), w: rnd(15, 40), t: 0, b: 0}; }
function stepCases(dt) {
  for (let i = 0; i < 160; i++) { const c = cases[i]; if (!c) continue; c.t += dt;
    if (c.t > 7) { cases[i] = null; CAS.setMatrixAt(i, ZERO); continue; }
    if (c.b < 4) { c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += c.w * dt;
      if (c.y < .01) { c.y = .01; if (c.vy < -1) { if (c.b < 2) Sfx.tink(c.x); c.vy *= -.35; c.vx *= .55; c.vz *= .55; c.w *= .5; c.b++; } else { c.b = 4; c.rx = 0; } } }
    const h = Math.max(0, 1 - c.t * 1.2);
    CAS.setColorAt(i, _v.set(.55 + h * 5, .38 + h * 2, .14 + h * .4));
    _o.position.set(c.x, c.y, c.z); _o.rotation.set(c.rx, c.ry, 0); _o.scale.setScalar(1); _o.updateMatrix(); CAS.setMatrixAt(i, _o.matrix); }
  CAS.instanceMatrix.needsUpdate = true; CAS.instanceColor.needsUpdate = true;
}

// ---------------- defensive position
const SLOTX = [0, -3.4, 3.4, -6.8];
{
  const bag = new THREE.SphereGeometry(1, 12, 8), p = bag.attributes.position;
  for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setY(k, Math.sign(y) * Math.pow(Math.abs(y), .6)); }
  bag.scale(.32, .14, .2); bag.computeVertexNormals();
  const bm = new THREE.MeshStandardMaterial({map: burlapT, roughness: .95, color: 0xb89a74});
  const list = [];
  for (let L = 0; L < 6; L++) for (let x = -13; x <= 13; x += .6) { const xx = x + (L % 2) * .3, z = -1.25 - Math.pow(Math.abs(xx) / 13, 2) * 2.2 - (L < 2 ? .25 : 0); list.push([xx + rnd(-.04, .04), .14 + L * .2, z + rnd(-.05, .05), rnd(-.15, .15)]); }
  const im = new THREE.InstancedMesh(bag, bm, list.length);
  list.forEach((b, i) => { _o.position.set(b[0], b[1], b[2]); _o.rotation.set(rnd(-.05, .05), b[3] - Math.atan(b[0] / 13 * .35), rnd(-.06, .06)); _o.scale.set(rnd(.95, 1.1), rnd(.9, 1.15), 1); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); });
  im.castShadow = im.receiveShadow = true; scene.add(im);
  // concrete + plates
  const cm = new THREE.MeshStandardMaterial({map: ltex('../tex/prop_c.jpg', true), normalMap: ltex('../tex/prop_n.jpg', false), roughness: .9, color: 0xc8a890});
  const box = (w, h, d, x, y, z, ry, m) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || cm); me.position.set(x, y, z); me.rotation.y = ry || 0; me.castShadow = me.receiveShadow = true; scene.add(me); return me; };
  box(2.5, 2.2, 1.2, -14.5, 1.1, -2.5, .5); box(2.5, 2.2, 1.2, 14.5, 1.1, -2.5, -.5); box(1.4, 1, 1, -9, .5, 1.8, .2); box(30, .3, 6, 0, -.1, 2);
  box(.6, 3.2, .6, -12, 1.6, 1.5); box(.6, 3.2, .6, 12, 1.6, 1.5);
  const plate = new THREE.MeshStandardMaterial({color: 0x3c4046, metalness: .85, roughness: .45});
  for (const x of [-10, -5.1, 5.1, 10]) { const z = -1.3 - Math.pow(Math.abs(x) / 13, 2) * 2.2; box(1.4, 1.5, .08, x, .9, z - .35, -Math.atan(x / 13 * .35), plate); }
  // crates
  const crate = new THREE.MeshStandardMaterial({color: 0x4b5a3a, roughness: .7, metalness: .2});
  box(.8, .5, .5, 1.6, .25, 1.1, .3, crate); box(.8, .5, .5, 1.5, .75, 1.15, .1, crate); box(.8, .5, .5, -1.8, .25, 1.3, -.2, crate);
}
// crashed dropship + burning wrecks
const FIRES = [];
{
  const hull = new THREE.MeshStandardMaterial({color: 0x2e3236, metalness: .7, roughness: .55}), dark = new THREE.MeshStandardMaterial({color: 0x15171a, roughness: .9});
  const g = new THREE.Group(); g.position.set(-62, gH(-62, -100) - 1, -100); g.rotation.set(.12, .8, -.22); scene.add(g);
  const add = (geo, m, x, y, z, rx, ry, rz) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx || 0, ry || 0, rz || 0); me.castShadow = true; g.add(me); };
  add(new THREE.BoxGeometry(9, 6, 28), hull, 0, 3, 0); add(new THREE.CylinderGeometry(1.2, 4.6, 10, 6), hull, 0, 2.6, 18, PI / 2 + .1, 0, 0);
  add(new THREE.BoxGeometry(22, .8, 7), hull, -4, 2, -4, 0, 0, .25); add(new THREE.BoxGeometry(.8, 7, 6), hull, 0, 8, -12, -.3); add(new THREE.BoxGeometry(4, 4, 3), dark, 6, 2, -13);
  add(new THREE.BoxGeometry(3.4, 3.4, 6), hull, 6.5, 3, -6, 0, 0, .2); add(new THREE.BoxGeometry(3.4, 3.4, 6), hull, -6.5, 1.5, -8, 0, 0, -.4);
  for (const [x, y, z, s] of [[2, 6, 4, 4], [-6, 3, -4, 3], [5, 3, -12, 2.5]]) { const v = new THREE.Vector3(x, y, z); g.updateMatrixWorld(); v.applyMatrix4(g.matrixWorld); FIRES.push({p: v, s}); }
  for (const [x, z] of [[34, -64], [-26, -48], [70, -140]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 5.5), hull); m.position.set(x, gH(x, z) + .5, z); m.rotation.set(.1, rnd(0, 3), .3); m.castShadow = true; scene.add(m);
    FIRES.push({p: new THREE.Vector3(x, gH(x, z) + 1.5, z), s: 1.6});
  }
}
// searchlights
const BEAMS = [];
{
  const g = new THREE.CylinderGeometry(4, .25, 120, 20, 1, true); g.translate(0, -60, 0); g.rotateX(-PI / 2);
  const m = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying float vZ; void main(){ vZ = -position.z / 120.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying float vZ; void main(){ gl_FragColor = vec4(vec3(1., .9, .75) * .35 * pow(1. - vZ, 2.), 1.); }'});
  for (const x of [-16, 16]) { const b = new THREE.Mesh(g, m); b.position.set(x, 3.5, 1.5); scene.add(b); BEAMS.push({m: b, ph: Math.random() * 10, x});
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.4, .5, .6, 10), new THREE.MeshStandardMaterial({color: 0x222, emissive: 0xffeecc, emissiveIntensity: 3})); lamp.position.set(x, 3.5, 1.5); scene.add(lamp); }
}

// ---------------- warrior bugs
const BH = 1.15;
function bugBodyGeo() {
  const parts = [];
  const add = (g, col, tf) => { g = g.toNonIndexed(); g.applyMatrix4(tf); const n = g.attributes.position.count, c = new Float32Array(n * 3); const C = new THREE.Color(col);
    const p = g.attributes.position; for (let i = 0; i < n; i++) { const shade = .85 + h2(p.getX(i) * 13, p.getZ(i) * 17 + p.getY(i) * 5) * .3; c[i * 3] = C.r * shade; c[i * 3 + 1] = C.g * shade; c[i * 3 + 2] = C.b * shade; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); parts.push(g); };
  const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const sph = () => new THREE.SphereGeometry(1, 14, 10), half = () => new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, PI * .5), cone = () => new THREE.ConeGeometry(1, 1, 6);
  const AMB = 0xb8722c, DRK = 0x3e2412, MID = 0x7a4a20, BONE = 0xdccaa0, BEL = 0xc8955a;
  // abdomen: segmented rings
  const seg = [[-.55, .5, .5], [-.98, .58, .56], [-1.4, .5, .5], [-1.72, .33, .34]];
  seg.forEach(([z, r, w], i) => { const y = BH + .12 + (i === 1 ? .08 : 0) - (i === 3 ? .1 : 0); add(sph(), i % 2 ? BEL : AMB, M(0, y - .04, z, w * .95, r * .8, .32)); add(half(), DRK, M(0, y, z + .02, w * 1.02, r * .95, .3, -.1)); add(cone(), DRK, M(0, y + r * .9, z, .06, .26, .1, -.5)); });
  // thorax
  add(sph(), AMB, M(0, BH, 0, .42, .36, .5)); add(half(), DRK, M(0, BH + .03, -.02, .44, .4, .48, -.05)); add(cone(), DRK, M(0, BH + .45, -.05, .07, .3, .12, -.4));
  // neck + head
  add(sph(), MID, M(0, BH - .02, .42, .26, .24, .2)); add(sph(), AMB, M(0, BH - .08, .66, .3, .26, .34, .25)); add(half(), DRK, M(0, BH - .02, .64, .32, .26, .34, .35));
  // eyes (glossy black)
  for (const s of [-1, 1]) add(sph(), 0x0a0605, M(s * .17, BH, .82, .06, .05, .06));
  // mandibles
  for (const s of [-1, 1]) { add(cone(), BONE, M(s * .12, BH - .2, 1.0, .05, .42, .05, PI / 2 + .5, 0, -s * .5)); add(cone(), MID, M(s * .09, BH - .1, .9, .07, .2, .07, PI / 2 + .3, 0, -s * .3)); }
  const g = new THREE.BufferGeometry(); let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
function legGeo(rt, rb, c0, c1) { const g = new THREE.CylinderGeometry(rt, rb, 1, 7, 3); g.translate(0, .5, 0); const p = g.attributes.position, c = new Float32Array(p.count * 3), A = new THREE.Color(c0), B = new THREE.Color(c1);
  for (let i = 0; i < p.count; i++) { const t = p.getY(i); c[i * 3] = mix(A.r, B.r, t); c[i * 3 + 1] = mix(A.g, B.g, t); c[i * 3 + 2] = mix(A.b, B.b, t); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
const MAXB = 520;
const bugMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .38, metalness: .05});
const BODY = pool(bugBodyGeo(), bugMat, MAXB, true);
const LUP = pool(legGeo(.07, .12, 0x6a3c18, 0x3a2010), bugMat, MAXB * 6, true);
const LLO = pool(legGeo(.006, .08, 0x3a2010, 0xc9b48a), bugMat, MAXB * 6, true);
for (let i = 0; i < MAXB; i++) BODY.setColorAt(i, new THREE.Color(1, 1, 1));
// legs: 0-3 walking, 4-5 claws. [side, hipZ, footZ]
const LEGS = [[1, .22, .9], [-1, .22, .9], [1, -.28, -1.2], [-1, -.28, -1.2]];
const TYPES = [
  {s: 1, hp: 3, sp: 1, tint: [1, 1, 1], dps: 4},
  {s: .78, hp: 2, sp: 1.4, tint: [1.15, .95, .7], dps: 3, leap: 1},
  {s: 2.1, hp: 20, sp: .72, tint: [.85, .6, .5], dps: 10},
];
const bugs = []; // active bugs (alive or corpse)
const freeIdx = []; for (let i = MAXB - 1; i >= 0; i--) freeIdx.push(i);
const byId = new Map(); let nextId = 1;
function spawnBug(type, x, z, id) {
  if (!freeIdx.length) { const c = bugs.find(q => q.dead); if (!c) return null; freeBug(c); } // pool full: recycle the oldest corpse
  const T = TYPES[type];
  const b = {idx: freeIdx.pop(), id: id || nextId++, type, T, s: T.s * rnd(.92, 1.1), x, z, y: gH(x, z), vy: 0, yaw: Math.atan2(-x, -z), hp: T.hp, st: 0, ph: rnd(0, TAU), t: 0, flash: 0, legs: 63, tx: rnd(-11, 11), weave: rnd(.2, .7), wf: rnd(.5, 1.5),
    sp: 0, dead: 0, atkT: rnd(0, 1), leapT: 0, roll: 0, pitch: 0, twitch: rnd(0, 10), nx: x, nz: z, nyaw: 0};
  b.nyaw = b.yaw; bugs.push(b); byId.set(b.id, b); return b;
}
function freeBug(b) { const i = bugs.indexOf(b); if (i >= 0) bugs.splice(i, 1); byId.delete(b.id); freeIdx.push(b.idx); BODY.setMatrixAt(b.idx, ZERO); for (let k = 0; k < 6; k++) { LUP.setMatrixAt(b.idx * 6 + k, ZERO); LLO.setMatrixAt(b.idx * 6 + k, ZERO); } }
const bm4 = new THREE.Matrix4(), bp = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3(), foot = new THREE.Vector3();
function drawBug(b, time) {
  if (b.gib) { BODY.setMatrixAt(b.idx, ZERO); for (let k = 0; k < 6; k++) { LUP.setMatrixAt(b.idx * 6 + k, ZERO); LLO.setMatrixAt(b.idx * 6 + k, ZERO); } return; }
  const s = b.s, dead = b.dead > 0, dt = b.dead, hk = b.hk || 0;
  // alive: lean toward the side that lost legs (limp); dead: tumble toward b.droll
  const lean = dead ? 0 : (((b.legs & 1) ? 0 : 1) + ((b.legs & 4) ? 0 : 1) - ((b.legs & 2) ? 0 : 1) - ((b.legs & 8) ? 0 : 1)) * .16;
  const roll = b.roll + lean + (dead ? 0 : Math.sin(b.t * 31) * hk * .08), lift = dead ? mix(1, .5, smooth(dt * 2.5)) : 1;
  const bob = dead ? 0 : Math.sin(b.ph * 2) * .05 * Math.min(1, b.sp / 4);
  const sink = dead && dt > 6 ? (dt - 6) * .6 : 0;
  // a hit snaps the head up and shoves the body back a little
  _e.set(b.pitch - hk * .3 + (b.st === 1 ? -.35 - Math.max(0, Math.sin(b.t * 7)) * .25 : 0), b.yaw + (b.dyaw || 0), roll, 'YXZ'); _q.setFromEuler(_e);
  const kb = hk * .14 * s; bp.set(b.x - Math.sin(b.yaw) * kb, b.y + (BH * lift + bob) * s - sink, b.z - Math.cos(b.yaw) * kb);
  bm4.compose(bp, _q, _s.set(s, s, s)); bm4.multiply(_m.makeTranslation(0, -BH, 0));
  BODY.setMatrixAt(b.idx, bm4);
  const fl = b.flash, T = b.T.tint; BODY.setColorAt(b.idx, _v.set(T[0] + fl * 2, T[1] + fl * 3, T[2] + fl * 1));
  const e = _m.elements, stride = .55, liftH = .4;
  for (let k = 0; k < 6; k++) {
    const ui = b.idx * 6 + k;
    if (!(b.legs & (1 << k))) { LUP.setMatrixAt(ui, ZERO); LLO.setMatrixAt(ui, ZERO); continue; }
    let sd, hx, hy, hz, fx, fy, fz, kx, ky, kz;
    if (k < 4) {
      const L = LEGS[k]; sd = L[0]; const ph = b.ph + (k === 0 || k === 3 ? 0 : PI);
      hx = sd * .3; hy = BH + .02; hz = L[1];
      if (dead) { const tw = Math.sin(time * 18 + b.twitch + k) * Math.max(0, 1 - dt / 4) * .25; const c = smooth(dt * 1.5);
        fx = sd * mix(1.5, .5, c); fy = mix(0, BH + 1.1, c) + tw; fz = L[2] * mix(1, .4, c); kx = sd * mix(1.2, .8, c); ky = BH + mix(.95, 1.4, c); kz = hz + (fz - hz) * .5; }
      else if (b.st === 2) { fx = sd * 1.3; fy = .4; fz = L[2] - 1.2 * (k < 2 ? -1 : 1) * .3 - .6; kx = sd * 1.1; ky = BH + .7; kz = (hz + fz) / 2; }
      else { const sw = Math.sin(ph) * stride * Math.min(1, b.sp / 3 + .15), up = Math.max(0, Math.cos(ph)) * liftH * Math.min(1, b.sp / 3 + .1);
        fx = sd * 1.55; fy = up; fz = L[2] + sw; kx = sd * 1.05; ky = BH + .95 + up * .5; kz = (hz + fz) * .5; }
    } else {
      sd = k === 4 ? 1 : -1; hx = sd * .2; hy = BH - .02; hz = .5;
      const a = b.st === 1 ? Math.sin(b.t * 7 + (sd > 0 ? 0 : 1.6)) : Math.sin(b.ph + (sd > 0 ? 0 : PI)) * .3;
      if (dead) { const c = smooth(dt * 1.5), tw = Math.sin(time * 15 + b.twitch * 2 + k) * Math.max(0, 1 - dt / 4) * .3; kx = sd * .5; ky = BH + .6 * c + .5; kz = .7; fx = sd * .25; fy = BH + 1.2 * c + tw; fz = 1.2 - c * .5; }
      else { kx = sd * .48; ky = BH + .7 + a * .25; kz = .95 + a * .15; fx = sd * .22; fy = BH - .55 + a * .7; fz = 1.75 + a * .35; }
    }
    hip.set(hx, hy, hz).applyMatrix4(bm4); knee.set(kx, ky, kz).applyMatrix4(bm4); foot.set(fx, fy, fz).applyMatrix4(bm4);
    segMat(e, hip.x, hip.y, hip.z, knee.x, knee.y, knee.z, s * (k < 4 ? 1 : 1.15)); LUP.setMatrixAt(ui, _m);
    segMat(e, knee.x, knee.y, knee.z, foot.x, foot.y, foot.z, s * (k < 4 ? 1 : 1.35)); LLO.setMatrixAt(ui, _m);
  }
}
function bugCenter(b, out) { return out.set(b.x, b.y + BH * b.s * (b.dead ? .5 : 1), b.z); }

// ---------------- gun model
function makeGun(fp) {
  const G = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color: 0x3a3f45, metalness: .85, roughness: .38});
  const dark = new THREE.MeshStandardMaterial({color: 0x1b1d20, metalness: .7, roughness: .5});
  const olive = new THREE.MeshStandardMaterial({color: 0x45503a, metalness: .3, roughness: .6});
  const brass = new THREE.MeshStandardMaterial({color: 0xb08a3a, metalness: .9, roughness: .3});
  const glow = new THREE.MeshBasicMaterial({color: new THREE.Color(.6, 3, 2.8)});
  const barrelM = new THREE.MeshStandardMaterial({color: 0x2a2c30, metalness: .9, roughness: .32, emissive: 0x000000});
  const decal = new THREE.MeshStandardMaterial({map: markT, metalness: .6, roughness: .45});
  const add = (geo, m, x, y, z, rx, ry, rz, par) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx || 0, ry || 0, rz || 0); (par || G).add(me); return me; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (r1, r2, l, n) => new THREE.CylinderGeometry(r1, r2, l, n || 16);
  add(B(.16, .17, .46), metal, 0, 0, -.28); add(B(.18, .06, .5), dark, 0, .1, -.3);
  add(C(.075, .075, .2), dark, 0, 0, -.02, PI / 2); add(C(.06, .06, .05), metal, 0, 0, .1, PI / 2);
  for (const s of [-1, 1]) add(new THREE.PlaneGeometry(.42, .1), decal, s * .082, -.01, -.3, 0, s * PI / 2);
  add(B(.03, .03, .3), glow, .0, .135, -.3); add(B(.012, .04, .02), glow, .085, .05, -.1);
  // heat shield with slots
  for (let i = 0; i < 6; i++) add(B(.17, .015, .06), dark, 0, .095, -.6 - i * .09);
  add(B(.02, .08, .6), dark, .09, .05, -.82); add(B(.02, .08, .6), dark, -.09, .05, -.82);
  // barrel cluster
  const bar = new THREE.Group(); bar.position.set(0, 0, -.5); G.add(bar);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; add(C(.015, .016, .78, 10), barrelM, Math.cos(a) * .045, Math.sin(a) * .045, -.39, PI / 2, 0, 0, bar); }
  add(C(.07, .07, .07), metal, 0, 0, -.02, PI / 2, 0, 0, bar); add(C(.072, .072, .03, 6), dark, 0, 0, -.36, PI / 2, 0, 0, bar); add(C(.075, .075, .035, 6), metal, 0, 0, -.74, PI / 2, 0, 0, bar);
  add(C(.02, .02, .8, 8), dark, 0, 0, -.39, PI / 2, 0, 0, bar);
  // carry handle + grips
  add(new THREE.TorusGeometry(.1, .016, 8, 14, PI), dark, 0, .13, -.32, 0, PI / 2, 0);
  add(C(.022, .025, .16, 10), olive, 0, -.15, -.5, .2); add(C(.024, .024, .15, 10), olive, 0, -.14, -.02, -.25);
  // ammo drum + belt
  add(C(.15, .15, .13, 20), olive, -.2, -.1, -.12, 0, 0, PI / 2); add(C(.155, .155, .02, 20), dark, -.2, -.1, -.12, 0, 0, PI / 2);
  const belt = [];
  for (let i = 0; i < 9; i++) { const t = i / 8, x = mix(-.2, -.07, t), y = mix(.05, .02, t) + Math.sin(t * PI) * .05, z = mix(-.12, -.22, t); belt.push(add(B(.03, .012, .05), brass, x, y, z, 0, 0, .3)); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.3); G.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(.09, -.02, -.22); G.add(eject);
  // arms
  if (fp) {
    const arm = new THREE.MeshStandardMaterial({color: 0x3c4436, metalness: .4, roughness: .55}), plate = new THREE.MeshStandardMaterial({color: 0x59624d, metalness: .5, roughness: .45});
    const mkArm = (hx, hy, hz, ex, ey, ez) => { const a = new THREE.Vector3(hx, hy, hz), b = new THREE.Vector3(ex, ey, ez), m = new THREE.Mesh(C(.06, .075, 1, 10), arm); const d = b.clone().sub(a); m.scale.y = d.length(); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); G.add(m);
      const p = new THREE.Mesh(B(.15, .1, .2), plate); p.position.copy(m.position); p.quaternion.copy(m.quaternion); p.scale.set(1, 1.6, 1); G.add(p); const s = new THREE.Mesh(B(.02, .05, .02), glow); s.position.copy(p.position).add(new THREE.Vector3(0, .07, 0)); G.add(s); };
    mkArm(.2, -.5, .45, .02, -.17, -.0); mkArm(-.35, -.55, .2, -.02, -.19, -.48);
    add(B(.1, .09, .12), plate, 0, -.17, -.02); add(B(.1, .09, .12), plate, 0, -.19, -.5);
  }
  G.userData = {bar, barrelM, muzzle, eject, belt};
  // muzzle flash sprites
  const fl = []; for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: starT, color: new THREE.Color(6, 4, 2), blending: THREE.AdditiveBlending, depthWrite: false, fog: false})); s.visible = false; muzzle.add(s); fl.push(s); }
  const side = new THREE.Mesh(new THREE.PlaneGeometry(.5, .12), new THREE.MeshBasicMaterial({map: starT, color: new THREE.Color(5, 3, 1.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false})); side.visible = false; muzzle.add(side);
  G.userData.fl = fl; G.userData.side = side;
  G.traverse(o => { if (o.isMesh) o.castShadow = !fp; });
  return G;
}
// first-person rig
const gunRoot = new THREE.Group(); cam.add(gunRoot);
const FPG = makeGun(true); gunRoot.add(FPG);
FPG.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMapIntensity = .3; }); // close to the lens the sky reflections blew the gun out
const GUN_BASE = new THREE.Vector3(.2, -.27, -.42);
// marines (other squad members)
function makeMarine() {
  const g = new THREE.Group(), arm = new THREE.MeshStandardMaterial({color: 0x46503e, metalness: .45, roughness: .5}), dk = new THREE.MeshStandardMaterial({color: 0x22261f, metalness: .4, roughness: .6}), vis = new THREE.MeshBasicMaterial({color: new THREE.Color(.5, 2.6, 2.4)});
  const add = (geo, m, x, y, z, par) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; (par || g).add(me); return me; };
  add(new THREE.BoxGeometry(.32, .8, .3), dk, -.14, .45, 0); add(new THREE.BoxGeometry(.32, .8, .3), dk, .14, .45, 0);
  add(new THREE.BoxGeometry(.62, .7, .42), arm, 0, 1.2, 0); add(new THREE.BoxGeometry(.5, .2, .38), dk, 0, .85, 0);
  add(new THREE.BoxGeometry(.3, .22, .4), arm, -.42, 1.5, 0).rotation.z = .3; add(new THREE.BoxGeometry(.3, .22, .4), arm, .42, 1.5, 0).rotation.z = -.3;
  add(new THREE.BoxGeometry(.5, .4, .25), dk, 0, 1.25, .3);
  const head = add(new THREE.SphereGeometry(.2, 14, 10), arm, 0, 1.72, 0); head.scale.set(1, 1.05, 1.1);
  add(new THREE.BoxGeometry(.3, .07, .05), vis, 0, 1.73, -.21);
  const gun = makeGun(false); gun.position.set(.15, 1.32, -.25); g.add(gun);
  add(new THREE.CylinderGeometry(.06, .07, .55, 8), arm, .3, 1.25, -.25).rotation.x = PI / 2.3;
  add(new THREE.CylinderGeometry(.06, .07, .6, 8), arm, -.2, 1.2, -.45).rotation.set(PI / 2.2, 0, .6);
  g.userData.gun = gun; scene.add(g); return g;
}

// ---------------- audio
const Sfx = {
  ctx: null, B: {},
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let C; try { C = this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const sr = C.sampleRate;
    this.master = C.createGain(); this.master.gain.value = SET.vol; const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = .002; comp.release.value = .15;
    this.master.connect(comp); comp.connect(C.destination);
    const buf = (d, f) => { const n = d * sr | 0, b = C.createBuffer(1, n, sr), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = f(i / sr, i); return b; };
    this.B.shot = [0, 1, 2].map(v => { let lp = 0, lp2 = 0, ph = 0; return buf(.16, t => { const n = Math.random() * 2 - 1; lp += (n - lp) * .3; lp2 += (lp - lp2) * .08; ph += TAU * (48 + 110 * Math.exp(-t * 45) + v * 6) / sr;
      return Math.tanh((Math.sin(ph) * Math.exp(-t * 26) * 1.3 + n * Math.exp(-t * 150) * .9 + lp * Math.exp(-t * 35) * .9 + lp2 * Math.exp(-t * 12) * 1.5) * 1.6) * .8; }); });
    this.B.tink = buf(.3, t => (Math.sin(TAU * 3150 * t) * .5 + Math.sin(TAU * 4470 * t) * .35 + Math.sin(TAU * 6020 * t) * .25 + Math.sin(TAU * 7900 * t) * .15) * Math.exp(-t * 22) * (t < .002 ? t / .002 : 1));
    this.B.squelch = [0, 1, 2, 3].map(v => { let lp = 0, ph = 0; return buf(.26, t => { const n = Math.random() * 2 - 1; lp += (n - lp) * (.03 + .35 * Math.exp(-t * (18 + v * 5))); ph += TAU * (90 + 260 * Math.exp(-t * 25) + v * 20) / sr;
      const wob = 1 + .6 * Math.sin(t * (90 + v * 30)); return (lp * 2.2 * wob + Math.sin(ph) * .5) * .5 * Math.exp(-t * (11 + v * 2)) * Math.min(1, t * 400); }); }); // peaks ~1.2: was clipping into the compressor
    this.B.crunch = [0, 1, 2].map(() => { let y = 0; return buf(.16, t => { if (Math.random() < .05) y = (Math.random() * 2 - 1); y *= .86; return y * Math.exp(-t * 22) * 1.2; }); });
    this.B.squeal = [0, 1, 2].map(v => { let ph = 0; return buf(.7, t => { const f = (1700 - v * 250) * Math.exp(-t * 2.2) + 280 + Math.sin(t * 190) * 60; ph += TAU * f / sr; const r = 1 + (Math.random() - .5) * .8;
      return (Math.sin(ph) + .5 * Math.sin(ph * 2.01) + .3 * Math.sin(ph * 3.03)) * r * .3 * Math.min(1, t * 40) * Math.exp(-t * 4); }); });
    this.B.screech = [0, 1].map(v => { let ph = 0; return buf(.8, t => { const f = 600 + 1300 * Math.sin(t / .8 * PI) + v * 200 + Math.sin(t * 240) * 80; ph += TAU * f / sr;
      return (Math.sin(ph) + .4 * Math.sin(ph * 2.5)) * (1 + (Math.random() - .5)) * .22 * Math.sin(t / .8 * PI); }); });
    this.B.chitter = buf(.6, t => { const k = (t * 55) % 1; return (Math.random() * 2 - 1) * Math.exp(-k * 14) * (.6 + .4 * Math.sin(t * 9)) * .7; });
    this.B.boom = (() => { let lp = 0; return buf(2.5, t => { const n = Math.random() * 2 - 1; lp += (n - lp) * .02; return lp * 6 * Math.exp(-t * 2.2) * Math.min(1, t * 60); }); })();
    this.B.zap = (() => { let ph = 0; return buf(.35, t => { ph += TAU * (180 + 800 * Math.exp(-t * 18)) / sr; return (Math.sin(ph) > 0 ? 1 : -1) * .25 * Math.exp(-t * 9) + (Math.random() - .5) * .3 * Math.exp(-t * 20); }); })();
    this.B.horn = (() => buf(2.2, t => { const e = Math.min(1, t * 3) * Math.exp(-Math.max(0, t - 1.4) * 4); return (Math.sin(TAU * 110 * t) + .6 * Math.sin(TAU * 165.5 * t) + .4 * Math.sin(TAU * 220.5 * t) + .3 * Math.sin(TAU * 331 * t)) * .14 * e * (1 + .1 * Math.sin(t * 30)); }))();
    this.B.alarm = buf(1.2, t => { const on = (t % .3) < .18 ? 1 : 0, f = (t % .6) < .3 ? 880 : 660; return (Math.sin(TAU * f * t) > 0 ? 1 : -1) * .18 * on * Math.min(1, (t % .3) * 200); });
    const noise = buf(2, () => Math.random() * 2 - 1);
    const loop = (filtType, f, q, g) => { const s = C.createBufferSource(); s.buffer = noise; s.loop = true; const fl = C.createBiquadFilter(); fl.type = filtType; fl.frequency.value = f; fl.Q.value = q; const gn = C.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(); return {fl, gn}; };
    this.wind = loop('lowpass', 380, .7, .14); this.hiss = loop('highpass', 2600, .7, 0); this.rattle = loop('bandpass', 1400, 2, 0);
    this.o1 = C.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = C.createOscillator(); this.o2.type = 'square'; this.of = C.createBiquadFilter(); this.of.type = 'lowpass'; this.of.Q.value = 4; this.og = C.createGain(); this.og.gain.value = 0;
    this.o1.connect(this.of); this.o2.connect(this.of); this.of.connect(this.og); this.og.connect(this.master); this.o1.start(); this.o2.start();
    this.last = {};
  },
  play(name, o = {}) {
    const C = this.ctx; if (!C || !this.B[name]) return; let b = this.B[name]; if (Array.isArray(b)) b = b[(Math.random() * b.length) | 0];
    const s = C.createBufferSource(); s.buffer = b; s.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - .5) * (o.vr ?? .1));
    const g = C.createGain(); g.gain.value = o.vol ?? .5; let n = s; n.connect(g); n = g;
    if (o.pan) { const p = C.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); n.connect(p); n = p; }
    if (o.lp) { const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; n.connect(f); n = f; }
    n.connect(this.master); s.start(C.currentTime + (o.at || 0));
  },
  lim(k, ms) { const n = performance.now(); if (this.last && n - (this.last[k] || 0) < ms) return false; if (this.last) this.last[k] = n; return true; },
  tink(x) { if (this.ctx && this.lim('tink', 25)) this.play('tink', {vol: .07, rate: rnd(.8, 1.35), vr: 0, pan: (x - P.x) * .3}); },
  at(x, z) { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz), a = angD(P.yaw, Math.atan2(-dx, -dz)); return {pan: clamp(-Math.sin(a) * 1.2, -1, 1), vol: 1 / (1 + d * .04), d}; },
  gun(spin, heat, vent) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.o1.frequency.setTargetAtTime(70 + spin * 380, t, .05); this.o2.frequency.setTargetAtTime(105 + spin * 570, t, .05); this.of.frequency.setTargetAtTime(400 + spin * 2400, t, .05);
    this.og.gain.setTargetAtTime(spin > .01 ? .025 + spin * .04 : 0, t, .08); this.rattle.gn.gain.setTargetAtTime(spin * .05, t, .05); this.rattle.fl.frequency.setTargetAtTime(900 + spin * 1500, t, .05);
    this.hiss.gn.gain.setTargetAtTime(vent ? .22 : heat > .8 ? (heat - .8) * .25 : 0, t, .06);
  },
};

// ---------------- game state
const P = {x: 0, z: 0, yaw: 0, pitch: -.04, spin: 0, heat: 0, vent: 0, firing: false, fireAcc: 0, shots: 0, fireT: 0,
  kick: 0, kickV: 0, gp: 0, gpV: 0, cp: 0, cpV: 0, cy: 0, cyV: 0, trauma: 0, swayX: 0, swayY: 0, swayVX: 0, swayVY: 0, fovP: 0, drift: 0, mdx: 0, bloom: 0};
const G = {on: false, paused: false, over: false, wave: 0, quota: 0, spawnAcc: 0, gap: 3, kills: 0, shield: 100, hp: 100, hurtT: 9, t: 0, sendT: 0, dmgFlash: 0, dmgDirs: [], hitT: 0, killT: 0, scores: {}, best: +(localStorage.getItem('ls-best') || 0), gunners: new Map()};
// gunners: id -> {slot, name, yaw, pitch, fire, spin, heat, acc, n, kills, model}
function myId() { return Net.role === 'guest' ? Net.id : 'H'; }
function localGunner() { return G.gunners.get(myId()); }
function addGunner(id, slot, name) {
  let g = G.gunners.get(id); if (!g) { g = {id, slot, name, yaw: 0, pitch: -.04, fire: 0, spin: 0, heat: 0, acc: 0, n: 0, kills: 0, model: null, tgt: null, tgtT: 0}; G.gunners.set(id, g); }
  g.slot = slot; g.name = name;
  if (id !== myId() && !g.model) g.model = makeMarine();
  if (g.model) g.model.position.set(SLOTX[slot], 0, .1);
  if (id === myId()) { P.x = SLOTX[slot]; P.z = 0; }
  return g;
}
function removeGunner(id) { const g = G.gunners.get(id); if (!g) return; if (g.model) scene.remove(g.model); G.gunners.delete(id); }

// aim assist: best bug in a wide cone around a gunner's yaw
function pickTarget(g) {
  const gx = SLOTX[g.slot]; let best = null, bs = 1e9;
  for (const b of bugs) { if (b.dead) continue; const dx = b.x - gx, dz = b.z, d = Math.hypot(dx, dz); if (d > 190) continue;
    const a = Math.abs(angD(g.yaw, Math.atan2(-dx, -dz))), cone = .2 + Math.atan(2.2 * b.s / Math.max(d, 1));
    if (a > cone) continue; const sc = a / cone * 1.2 + d / 120 - (b.st === 1 ? .5 : 0); if (sc < bs) { bs = sc; best = b; } }
  return best;
}
const mz = new THREE.Vector3(), hitP = new THREE.Vector3(), hitP2 = new THREE.Vector3(), dirV = new THREE.Vector3();
function nearBug(p, not, r) { let best = null, bd = r * r; for (const b of bugs) { if (b.dead || b === not) continue; const dx = b.x - p.x, dz = b.z - p.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = b; } } return best; }
function muzzleOf(g, out) {
  if (g.id === myId()) return FPG.userData.muzzle.getWorldPosition(out);
  if (g.model) return g.model.userData.gun.userData.muzzle.getWorldPosition(out);
  return out.set(SLOTX[g.slot], 1.4, -1);
}
function fireShot(g, idx) {
  const t = g.tgt && !g.tgt.dead && byId.has(g.tgt.id) ? g.tgt : (g.tgt = pickTarget(g));
  muzzleOf(g, mz); const local = g.id === myId();
  if (t) {
    bugCenter(t, hitP); hitP.x += rnd(-.4, .4) * t.s; hitP.y += rnd(-.3, .3) * t.s; hitP.z += rnd(-.4, .4) * t.s;
    hitFx(t, hitP, local);
    if (isHost()) damageBug(t, g, hitP);
    if (Math.random() < .5) { const o = nearBug(hitP, t, 2.6 * t.s); if (o) { bugCenter(o, hitP2); hitFx(o, hitP2, false); if (isHost()) damageBug(o, g, hitP2); } }
  } else {
    const d = rnd(30, 90), gx = SLOTX[g.slot]; hitP.set(gx - Math.sin(g.yaw + rnd(-.03, .03)) * d, 0, -Math.cos(g.yaw + rnd(-.03, .03)) * d); hitP.y = gH(hitP.x, hitP.z);
    dustFx(hitP);
  }
  if (idx % 3 === 0) addTracer(mz, hitP);
  if (local) {
    Sfx.play('shot', {vol: .32, vr: .08});
    P.kickV += 1.1; P.gpV += 2.2; P.cpV += .5 + P.heat * .4; P.cyV += rnd(-.6, .6); P.trauma = Math.min(1, P.trauma + .02); P.bloom = Math.min(1, P.bloom + .06);
    FPG.userData.eject.getWorldPosition(_v2); dirV.set(1, 0, 0).applyQuaternion(cam.quaternion); addCase(_v2, {x: dirV.x * rnd(2, 3.5) + rnd(-.3, .3), y: rnd(1.8, 3), z: dirV.z * rnd(2, 3.5) + rnd(.2, .8)});
    if (Math.random() < .3) PS.add(mz.x, mz.y, mz.z, rnd(-.3, .3), rnd(.3, .9), rnd(-.3, .3), rnd(1, 2), .1, .6, .5, .45, .42, .18, -.2, .5);
  } else if (idx % 2 === 0) { const a = Sfx.at(mz.x, mz.z); Sfx.play('shot', {vol: .16 * a.vol, pan: a.pan, vr: .1, lp: 3000}); }
  for (let i = 0; i < 2; i++) PA.add(mz.x, mz.y, mz.z, rnd(-2, 2), rnd(-1, 2), rnd(-2, 2) - 3, rnd(.04, .1), .06, .01, 3, 2, .8, 1);
}
const SLIME = [[.45, .85, .08], [.7, .9, .15], [.35, .7, .05], [.85, .95, .3]];
function hitFx(b, p, local) {
  const n = HI() ? 7 : 4; const toCam = _v.set(P.x - p.x, 1.7 - p.y, P.z - p.z).normalize();
  for (let i = 0; i < n; i++) { const c = SLIME[(Math.random() * 4) | 0], sp = rnd(2, 7);
    PG.add(p.x, p.y, p.z, toCam.x * sp * .5 + rnd(-3, 3), rnd(1, 6), toCam.z * sp * .5 + rnd(-3, 3), rnd(.8, 1.8), rnd(.08, .2) * b.s, rnd(.05, .12), c[0], c[1], c[2], .95, 14, .5, 1); }
  PG.add(p.x, p.y, p.z, rnd(-.5, .5), rnd(0, 1), rnd(-.5, .5), .25, .3 * b.s, .9 * b.s, .5, .85, .1, .7, 0, 2);
  if (Math.random() < .3) addChunk(p.x, p.y, p.z, rnd(.05, .12) * b.s, 5);
  b.flash = 1; b.hk = Math.min(1.2, (b.hk || 0) + (b.type === 2 ? .3 : .75));
  if (b.type === 2 && Math.random() < .5) for (let i = 0; i < 5; i++) PA.add(p.x, p.y, p.z, toCam.x * 4 + rnd(-4, 4), rnd(1, 5), toCam.z * 4 + rnd(-4, 4), rnd(.1, .25), .07, .02, 3, 1.8, .6, 1, 12);
  if (Sfx.ctx && Sfx.lim('sq', local ? 55 : 110)) { const a = Sfx.at(p.x, p.z); Sfx.play(Math.random() < .7 ? 'squelch' : 'crunch', {vol: .8 * a.vol + .06, pan: a.pan, rate: rnd(.8, 1.25)}); }
  if (local) { G.hitT = .12; }
}
function dustFx(p) {
  for (let i = 0; i < 3; i++) PS.add(p.x, p.y + .1, p.z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), rnd(.6, 1.4), .2, rnd(.8, 1.6), .62, .42, .28, .5, 1.5, 1.5);
  PA.add(p.x, p.y + .1, p.z, rnd(-3, 3), rnd(2, 5), rnd(-3, 3), .15, .08, .02, 3, 1.6, .5, 1, 12);
}
function damageBug(b, g, p) {
  b.hp -= 1; b.stag = b.type === 2 ? .15 : .35;
  if (b.type !== 2 && b.st !== 2) { const dx = b.x - SLOTX[g.slot], dz = b.z, d = Math.hypot(dx, dz) || 1; b.x += dx / d * .04; b.z += dz / d * .04; }
  if (b.hp > 0 && Math.random() < .14) { const k = (Math.random() * 6) | 0; if (b.legs & (1 << k)) { b.legs &= ~(1 << k); legOffFx(b, k); if (isHost()) G.evq.push(['l', b.id, k]); } }
  if (b.hp <= 0) { killBug(b, g); }
}
function legOffFx(b, k) { const c = bugCenter(b, _v2); addChunk(c.x + rnd(-1, 1) * b.s, c.y, c.z, b.s * .8, 6, true); for (let i = 0; i < 8; i++) PG.add(c.x, c.y, c.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), rnd(.8, 1.5), .15 * b.s, .08, .5, .9, .1, .95, 14, .4, 1); }
function killBug(b, g) {
  if (b.dead) return; b.dead = .001; b.hp = 0; b.roll = 0; b.dyaw = 0;
  // corpse keeps its momentum: slides/tumbles forward, leapers fall out of the air; some light bugs burst apart (gib)
  const fw = b.st === 1 ? 0 : Math.min(b.sp, 14) * .7;
  b.dvx = Math.sin(b.yaw) * fw + rnd(-1, 1); b.dvz = Math.cos(b.yaw) * fw + rnd(-1, 1); b.dvy = b.st === 2 ? (b.vy || 0) : rnd(1.5, 3.5) / Math.sqrt(b.s);
  b.droll = Math.random() < .65 ? PI * (Math.random() < .5 ? 1 : -1) : PI / 2 * (Math.random() < .5 ? 1 : -1); b.dspin = rnd(-4, 4);
  b.gib = b.type !== 2 && Math.random() < (b.type === 1 ? .45 : .25) ? 1 : 0;
  if (g) { g.kills++; G.kills++; if (g.id === myId()) { G.killT = .25; } }
  if (isHost()) G.evq.push(['k', b.id, g ? g.slot : -1]);
  deathFx(b);
}
function deathFx(b) {
  const c = bugCenter(b, _v2), s = b.s, n = HI() ? 46 : 22;
  for (let i = 0; i < n; i++) { const col = SLIME[(Math.random() * 4) | 0], a = rnd(0, TAU), sp = rnd(1, 9) * Math.sqrt(s);
    PG.add(c.x, c.y, c.z, Math.cos(a) * sp, rnd(2, 9), Math.sin(a) * sp, rnd(1, 2.2), rnd(.12, .32) * s, rnd(.08, .2) * s, col[0], col[1], col[2], .95, 14, .4, 1); }
  for (let i = 0; i < 4; i++) PG.add(c.x, c.y, c.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), .5, .5 * s, 2 * s, .55, .9, .12, .6, 0, 3);
  for (let i = 0; i < 4 + s * 3; i++) addChunk(c.x, c.y, c.z, rnd(.08, .22) * s, 7);
  if (b.gib) { for (let k = 0; k < 6; k++) if (b.legs & (1 << k)) addChunk(c.x, c.y, c.z, s * (k < 4 ? .8 : .6), 8, true);
    for (let i = 0; i < 6; i++) addChunk(c.x, c.y, c.z, rnd(.15, .35) * s, 9);
    for (let i = 0; i < (HI() ? 30 : 14); i++) { const col = SLIME[(Math.random() * 4) | 0]; PG.add(c.x, c.y, c.z, rnd(-7, 7), rnd(3, 11), rnd(-7, 7), rnd(1, 2), rnd(.15, .4) * s, .1, col[0], col[1], col[2], .95, 14, .3, 1); }
    PS.add(c.x, c.y, c.z, 0, .8, 0, 1.4, .6 * s, 3 * s, .5, .62, .2, .35, 0, 1); }
  else if (Math.random() < .5) { b.legs &= ~(1 << ((Math.random() * 4) | 0)); addChunk(c.x, c.y, c.z, s * .8, 6, true); }
  if (b.type === 2) { for (let i = 0; i < 10; i++) PS.add(b.x + rnd(-1.5, 1.5), b.y + .3, b.z + rnd(-1.5, 1.5), rnd(-2, 2), rnd(.5, 2), rnd(-2, 2), rnd(1.2, 2.4), .6, 3, .55, .38, .25, .5, 0, 1.5);
    const d = Math.hypot(b.x - P.x, b.z - P.z); P.trauma = Math.min(1, P.trauma + clamp(1 - d / 60, 0, 1) * .5);
    if (Sfx.ctx) { const a = Sfx.at(b.x, b.z); Sfx.play('boom', {vol: .5 * a.vol + .1, pan: a.pan, rate: 1.6, lp: 900}); } }
  addDecal(b.x + rnd(-.5, .5), b.z + rnd(-.5, .5), rnd(2, 3.4) * s, [rnd(.55, .9), rnd(.85, 1.1), rnd(.3, .6)]);
  for (let i = 0; i < 2; i++) addDecal(b.x + rnd(-2, 2) * s, b.z + rnd(-2, 2) * s, rnd(.6, 1.4) * s, [.7, 1, .4]);
  if (Sfx.ctx) { const a = Sfx.at(b.x, b.z); if (Sfx.lim('death', 70)) { Sfx.play('squelch', {vol: 1.1 * a.vol + .08, pan: a.pan, rate: .7}); Sfx.play('crunch', {vol: .5 * a.vol, pan: a.pan, rate: .8}); }
    if (Sfx.lim('squeal', 160)) Sfx.play('squeal', {vol: .25 * a.vol, pan: a.pan, rate: rnd(.8, 1.3) / Math.sqrt(s), lp: 4000}); }
}

// ---------------- waves + bug AI (host)
// pacing: wave n spawns for (8 + n) s; a squad gets +50% bugs per extra gunner
const crewMul = () => 1 + .5 * Math.max(0, G.gunners.size - 1);
const spawnRate = n => Math.min(30, 6 + n * 1.5) * crewMul();
function waveQuota(n) { return Math.round(spawnRate(n) * (8 + n)); }
function startWave(n) {
  G.wave = n; G.quota = waveQuota(n); G.gap = 0; G.cleared = false;
  callout('WAVE ' + n, n === 1 ? 'CONTACTS INBOUND' : n % 5 === 0 ? 'MASSIVE SWARM' : 'MORE INBOUND');
  Sfx.play('horn', {vol: .6, vr: 0});
  if (isHost()) G.evq.push(['w', n]);
}
function waveCleared() {
  G.hp = Math.min(100, G.hp + 12); G.shield = 100;
  heldFx(G.wave);
  if (isHost()) G.evq.push(['c', G.wave]);
}
function heldFx(n) { callout('WAVE ' + n + ' HELD', 'ARMOUR PATCHED // NEXT WAVE INBOUND'); Sfx.play('horn', {vol: .35, rate: 1.5, vr: 0}); }
function spawnOne() {
  const n = G.wave, r = Math.random();
  const type = n >= 3 && r < Math.min(.12, .03 + n * .006) ? 2 : n >= 2 && r < .3 ? 1 : 0;
  const a = rnd(-1.2, 1.2), d = rnd(130, 210);
  spawnBug(type, Math.sin(a) * d, -Math.cos(a) * d);
  if (type === 2 && !G.bruteSeen) { G.bruteSeen = true; bruteWarn(); if (isHost()) G.evq.push(['b']); }
}
function bruteWarn() { setTimeout(() => { if (G.on && !G.over) callout('BRUTE', 'BIG ONE INBOUND // KEEP THE GUN ON IT'); }, 2600); }
const grid = new Map();
function stepBugsHost(dt) {
  if (G.over) return;
  let live = 0; for (const b of bugs) if (!b.dead) live++;
  if (G.quota > 0) { G.spawnAcc += dt * spawnRate(G.wave); while (G.spawnAcc > 1 && G.quota > 0) { G.spawnAcc--; if (live < 380) { spawnOne(); G.quota--; live++; } else { G.spawnAcc = 0; break; } } }
  else {
    // lull: once the field is nearly clear the wave counts as held (armour patch), next wave 3.5 s later; overwhelmed = next wave after 14 s anyway
    G.gap += dt;
    if (!G.cleared && live <= 4) { G.cleared = true; G.gap = 0; waveCleared(); }
    if ((G.cleared && G.gap > 3.5) || G.gap > 14) startWave(G.wave + 1);
  }
  const spm = Math.min(2, 1 + G.wave * .05);
  grid.clear();
  const cell = (x, z) => (Math.floor(x / 3) + 500) * 1000 + Math.floor(z / 3) + 500;
  for (const b of bugs) { if (b.dead) continue; const k = cell(b.x, b.z); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(b); }
  let attackers = 0, dmg = 0;
  for (const b of bugs) {
    if (b.dead) continue;
    const goalZ = -3.4 - b.s * 1.5 - Math.pow(Math.abs(b.tx) / 13, 2) * 2.2;
    const dx = b.tx - b.x, dz = goalZ - b.z, d = Math.hypot(dx, dz);
    if (b.st === 2) { b.vy -= 18 * dt; b.y += b.vy * dt; const f = b.T.sp * 9 * spm; b.x += dx / d * f * 1.6 * dt; b.z += dz / d * f * 1.6 * dt; const gy = gH(b.x, b.z); if (b.y <= gy) { b.y = gy; b.st = 0; } b.sp = 0; continue; }
    if (d < .8) { b.st = 1; b.sp = 0; attackers++; dmg += b.T.dps * (b.legs === 63 ? 1 : .7); b.yaw += angD(b.yaw, Math.atan2(-b.x + SLOTX[0] * 0, -b.z)) * dt * 4; }
    else {
      b.st = 0; let sp = b.T.sp * 8.5 * spm;
      if ((b.legs & 15) !== 15) sp *= ((b.legs & 15) ? .65 : .4) + .3 * Math.abs(Math.sin(b.ph)); // limping: lurches along
      if (b.stag > 0) { b.stag -= dt; sp *= .35; }
      const wv = Math.sin(b.t * b.wf) * b.weave * Math.min(1, d / 30);
      let ux = dx / d, uz = dz / d; const px = -uz, pz = ux; ux += px * wv; uz += pz * wv;
      // separation
      const k0 = cell(b.x, b.z);
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const c = grid.get(k0 + gx * 1000 + gz); if (!c) continue;
        for (const o of c) { if (o === b) continue; const ox = b.x - o.x, oz = b.z - o.z, od = ox * ox + oz * oz, rr = (b.s + o.s) * .9; if (od < rr * rr && od > 1e-4) { const f = (rr - Math.sqrt(od)) * 2; ux += ox * f; uz += oz * f; } } }
      const ul = Math.hypot(ux, uz) || 1; const step = Math.min(sp * dt, d);
      b.x += ux / ul * step; b.z += uz / ul * step; b.sp = sp;
      b.yaw += angD(b.yaw, Math.atan2(ux, uz)) * Math.min(1, dt * 6);
      b.y = gH(b.x, b.z);
      if (b.T.leap && d > 18 && d < 45 && b.leapT <= 0 && Math.random() < dt * .8) { b.st = 2; b.vy = 9; b.leapT = 6; if (Sfx.ctx && Sfx.lim('scr', 300)) { const a = Sfx.at(b.x, b.z); Sfx.play('screech', {vol: .3 * a.vol, pan: a.pan, rate: rnd(.9, 1.3)}); } }
      b.leapT -= dt;
    }
  }
  // damage to the line
  if (dmg > 0) { hurt(4 * Math.pow(dmg / 4, .6) * dt); }
  G.attackers = attackers;
}
function hurt(d) {
  G.hurtT = 0; const s = Math.min(G.shield, d); G.shield -= s; d -= s; G.hp = Math.max(0, G.hp - d * .2);
  if (G.hp < 30 && !G.lowWarn) { G.lowWarn = true; callout('ARMOUR CRITICAL', 'CLEAR THE BARRICADE'); Sfx.play('alarm', {vol: .5, vr: 0}); if (isHost()) G.evq.push(['a']); }
  if (G.hp > 45) G.lowWarn = false;
  G.dmgFlash = Math.min(1, G.dmgFlash + .08); P.trauma = Math.min(1, P.trauma + .015);
  if (Sfx.ctx && Sfx.lim('zap', 400)) Sfx.play('zap', {vol: .45});
  if (G.hp <= 0 && !G.over) overrun();
}
function stepBugsCommon(dt, time) {
  for (let i = bugs.length - 1; i >= 0; i--) {
    const b = bugs[i]; b.t += dt; b.flash = Math.max(0, b.flash - dt * 8);
    b.hk = (b.hk || 0) * Math.exp(-dt * 11);
    if (b.dead) { b.dead += dt; if (b.dead > (b.gib ? 1 : 8)) { freeBug(b); continue; }
      const rr = b.type === 2 ? 3.5 : 8; b.roll += clamp(b.droll - b.roll, -rr * dt, rr * dt); b.pitch *= .9;
      const gy = gH(b.x, b.z); b.dvy -= 20 * dt; b.y += b.dvy * dt;
      if (b.y <= gy) { b.y = gy; if (b.dvy < -3) { b.dvy *= -.25; b.dspin *= .5; } else b.dvy = 0; const f = Math.exp(-dt * 5); b.dvx *= f; b.dvz *= f; b.dspin *= Math.exp(-dt * 4); }
      b.x += b.dvx * dt; b.z += b.dvz * dt; b.dyaw += b.dspin * dt; }
    else { b.ph += dt * (b.sp * 1.9 / b.s + (b.st === 1 ? 0 : .5)); }
  }
}

// ---------------- guest: apply snapshots
function applySnap(m) {
  const seen = new Set(), a = m.b;
  for (let i = 0; i < a.length; i += 6) {
    const id = a[i], x = a[i + 1] / 10, z = a[i + 2] / 10, yaw = a[i + 3] / 100, f = a[i + 4], y = a[i + 5] / 10;
    let b = byId.get(id); if (!b) { b = spawnBug(f & 3, x, z, id); if (!b) continue; }
    if (b.dead) continue;
    seen.add(id); b.vx = (x - b.nx) * 10; b.vz = (z - b.nz) * 10; b.nx = x; b.nz = z; b.nyaw = yaw; b.ny = y; b.age = 0;
    b.st = (f >> 2) & 3; const lg = (f >> 4) & 63; if (lg !== b.legs) { for (let k = 0; k < 6; k++) if ((b.legs & (1 << k)) && !(lg & (1 << k))) legOffFx(b, k); b.legs = lg; }
  }
  for (const b of bugs.slice()) if (!b.dead && !seen.has(b.id)) freeBug(b);
  for (const e of m.e || []) {
    if (e[0] === 'k') { const b = byId.get(e[1]); if (b) { const g = [...G.gunners.values()].find(q => q.slot === e[2]); killBug(b, null); if (g && g.id === myId()) G.killT = .25; } }
    else if (e[0] === 'w') startWave(e[1]);
    else if (e[0] === 'c') heldFx(e[1]);
    else if (e[0] === 'b') bruteWarn();
    else if (e[0] === 'a') { callout('ARMOUR CRITICAL', 'CLEAR THE BARRICADE'); Sfx.play('alarm', {vol: .5, vr: 0}); }
  }
  G.shield = m.sh; G.hp = m.hp; G.kills = m.k; G.wave = m.w;
  if (m.hurt) { G.hurtT = 0; G.dmgFlash = Math.min(1, G.dmgFlash + .1); }
  for (const r of m.g) { const g = G.gunners.get(r[0]); if (!g) continue; g.kills = r[3]; if (r[0] !== myId()) { g.yaw = r[1] / 100; g.fire = r[2]; } }
}
function stepBugsGuest(dt) {
  for (const b of bugs) { if (b.dead) continue; b.age = (b.age || 0) + dt; const ex = Math.min(b.age, .25);
    const tx = b.nx + (b.vx || 0) * ex, tz = b.nz + (b.vz || 0) * ex, k = Math.min(1, dt * 12);
    b.x += (tx - b.x) * k; b.z += (tz - b.z) * k; b.yaw += angD(b.yaw, b.nyaw) * k; b.sp = Math.hypot(b.vx || 0, b.vz || 0);
    b.y = b.st === 2 ? mix(b.y, b.ny, k) : gH(b.x, b.z); }
}
function packSnap() {
  const a = [];
  for (const b of bugs) { if (b.dead) continue; a.push(b.id, Math.round(b.x * 10), Math.round(b.z * 10), Math.round(b.yaw * 100), b.type | (b.st << 2) | (b.legs << 4), Math.round(b.y * 10)); }
  const g = [...G.gunners.values()].map(q => [q.id, Math.round(q.yaw * 100), q.fire ? 1 : 0, q.kills]);
  const m = {t: 's', b: a, e: G.evq, g, sh: Math.round(G.shield), hp: Math.round(G.hp * 10) / 10, k: G.kills, w: G.wave, hurt: G.hurtT < .15 ? 1 : 0};
  G.evq = []; return m;
}
function crewMsg() { return {t: 'crew', crew: [...G.gunners.values()].map(g => [g.id, g.slot, g.name])}; }
Net.on('_join', m => { const p = Net.peers.get(m.id); addGunner(p.id, p.slot, p.name); Net.send(crewMsg()); Net.send1(m.id, {t: 'start', wave: G.wave}); toast(p.name + ' joined the line'); });
Net.on('_left', m => { removeGunner(m.id); Net.send(crewMsg()); toast(m.name + ' left'); });
Net.on('aim', (m, id) => { const g = G.gunners.get(id); if (g) { g.yaw = clamp(+m.y || 0, -1.6, 1.6); g.fire = m.f ? 1 : 0; } });
Net.on('crew', m => { const ids = new Set(); for (const [id, slot, name] of m.crew) { ids.add(id); addGunner(id, slot, name); } for (const id of [...G.gunners.keys()]) if (!ids.has(id)) removeGunner(id); });
Net.on('start', m => { if (!G.on || G.over) beginGame(false); G.wave = m.wave; netStatus('In squad ' + Net.code); });
Net.on('s', m => { if (Net.role === 'guest' && G.on) applySnap(m); });
Net.on('over', m => { if (Net.role === 'guest') overrun(m); });
Net.on('restart', () => { if (Net.role === 'guest') beginGame(false); });
Net.on('_hostgone', () => { toast('Host disconnected'); clearTimeout(G.goneT); G.goneT = setTimeout(() => { if (Net.role !== 'guest' || !G.on || G.over) return; G.over = true; G.lost = true; Net.close(); showEnd('SIGNAL LOST', 'The squad host left the game', G.wave, G.kills, G.runT, ''); }, 6000); });
Net.on('_hostback', () => { clearTimeout(G.goneT); toast('Host reconnected'); });

// ---------------- HUD
const hud = $('hud'), hx = hud.getContext('2d');
let HW = 0, HH = 0;
function resize() { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); setupPost(); const dpr = Math.min(devicePixelRatio, 2); HW = hud.width = innerWidth * dpr; HH = hud.height = innerHeight * dpr; hx.setTransform(dpr, 0, 0, dpr, 0, 0); for (const p of [PA, PS, PG]) p.mat.uniforms.scale.value = innerHeight * Math.min(devicePixelRatio, HI() ? 1.5 : .85) / (2 * Math.tan(cam.fov * PI / 360)); }
addEventListener('resize', resize);
let callT = 0, toastT = 0, toastS = '';
function callout(t, s) { $('callT').textContent = t; $('callT').style.fontSize = t.length > 9 ? 'min(44px, 6.5vw)' : 'min(72px, 11vw)'; $('callS').textContent = s; $('call').style.opacity = 1; callT = 2.4; }
function toast(s) { toastS = s; toastT = 3; }
const CY = 'rgba(111,247,238,', READ = [];
for (let i = 0; i < 40; i++) READ.push(Math.random().toString(16).slice(2, 10).toUpperCase() + ' ' + ['SYNC', 'ACK', 'TRK', 'PWR', 'VNT', 'LNK'][i % 6]);
function drawHud(dt, time) {
  const w = innerWidth, h = innerHeight, c = hx; c.clearRect(0, 0, w, h);
  const fl = .85 + Math.sin(time * 60) * .03 + (Math.random() < .02 ? -.3 : 0);
  c.globalAlpha = fl; c.lineWidth = 1.5; c.font = '13px "Share Tech Mono",monospace';
  // crosshair
  const cx = w / 2, cy = h / 2, gap = 12 + P.bloom * 22;
  c.strokeStyle = CY + '.85)'; c.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(cx + dx * gap, cy + dy * gap); c.lineTo(cx + dx * (gap + 12), cy + dy * (gap + 12)); }
  c.stroke(); c.beginPath(); c.arc(cx, cy, 2, 0, TAU); c.fillStyle = CY + '.9)'; c.fill();
  c.strokeStyle = CY + '.25)'; c.beginPath(); c.arc(cx, cy, 70 + P.bloom * 20, -.6, .6); c.stroke(); c.beginPath(); c.arc(cx, cy, 70 + P.bloom * 20, PI - .6, PI + .6); c.stroke();
  if (G.hitT > 0 || G.killT > 0) { const k = G.killT > 0; c.strokeStyle = k ? 'rgba(255,120,60,.95)' : 'rgba(230,255,230,.9)'; c.lineWidth = k ? 3 : 2; c.beginPath(); const r0 = 8, r1 = k ? 20 : 15; for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(cx + dx * r0, cy + dy * r0); c.lineTo(cx + dx * r1, cy + dy * r1); } c.stroke(); c.lineWidth = 1.5; }
  // damage direction arcs
  for (const d of G.dmgDirs) { const a = angD(P.yaw, d.a); c.strokeStyle = `rgba(255,60,40,${d.t})`; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, 150, -PI / 2 - a - .25, -PI / 2 - a + .25); c.stroke(); }
  c.lineWidth = 1.5;
  // radar
  const rx = 120, ry = h - 120, R = 95;
  c.fillStyle = 'rgba(2,20,22,.45)'; c.beginPath(); c.moveTo(rx, ry); c.arc(rx, ry, R, -PI / 2 - 1.3, -PI / 2 + 1.3); c.closePath(); c.fill();
  c.strokeStyle = CY + '.5)'; c.stroke(); for (const r of [R / 3, R * 2 / 3]) { c.beginPath(); c.arc(rx, ry, r, -PI / 2 - 1.3, -PI / 2 + 1.3); c.strokeStyle = CY + '.18)'; c.stroke(); }
  const sw = (time * 1.6) % 2.6 - 1.3; c.strokeStyle = CY + '.6)'; c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + Math.sin(sw) * R, ry - Math.cos(sw) * R); c.stroke();
  for (const b of bugs) { if (b.dead) continue; const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz); if (d > 200) continue; const a = angD(P.yaw, Math.atan2(-dx, -dz)); if (Math.abs(a) > 1.3) continue;
    const rr = d / 200 * R, px = rx - Math.sin(a) * rr, py = ry - Math.cos(a) * rr, near = Math.abs(angD(-a, sw)) < .3;
    c.fillStyle = b.type === 2 ? 'rgba(255,150,60,.95)' : `rgba(255,${near ? 230 : 90},70,${near ? 1 : .7})`; c.fillRect(px - 1.5, py - 1.5, b.type === 2 ? 5 : 3, b.type === 2 ? 5 : 3); }
  c.fillStyle = CY + '.8)'; c.fillText('MOTION TRACKER', rx - 52, ry + 22); c.fillText(bugs.filter(b => !b.dead).length.toString().padStart(3, '0') + ' CONTACTS', rx - 44, ry + 38);
  // right panel: shield, armour, heat
  const bx = w - 300, by = h - 120;
  c.fillStyle = CY + '.8)'; c.fillText('SHIELD', bx, by); c.fillText((G.shield | 0) + '%', bx + 240, by);
  c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(bx, by + 6, 270, 10); c.fillStyle = G.shield < 30 ? 'rgba(255,90,60,.9)' : CY + '.85)'; c.fillRect(bx, by + 6, 270 * G.shield / 100, 10);
  c.fillStyle = CY + '.8)'; c.fillText('ARMOUR', bx, by + 36);
  for (let i = 0; i < 10; i++) { c.fillStyle = G.hp > i * 10 + 5 ? (G.hp < 35 ? 'rgba(255,90,60,.9)' : 'rgba(200,255,250,.85)') : 'rgba(255,255,255,.1)'; c.fillRect(bx + i * 27, by + 42, 23, 8); }
  const heat = P.heat; c.fillStyle = CY + '.8)'; c.fillText(P.vent > 0 ? 'VENTING' : 'BARREL TEMP', bx, by + 70); c.fillText(((P.spin * 2200) | 0) + ' RPM', bx + 190, by + 70);
  c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(bx, by + 76, 270, 8);
  const hg = c.createLinearGradient(bx, 0, bx + 270, 0); hg.addColorStop(0, '#ff8a2a'); hg.addColorStop(.7, '#ffd27a'); hg.addColorStop(1, '#ffffff'); c.fillStyle = hg; c.fillRect(bx, by + 76, 270 * heat, 8);
  c.fillStyle = CY + '.55)'; c.fillText('AUTO-FIRE ' + (SET.auto ? 'ON' : 'OFF') + '  [F]', bx, by + 100);
  // top left: wave, kills
  c.fillStyle = CY + '.9)'; c.font = '700 30px Rajdhani,sans-serif'; c.fillText('WAVE ' + G.wave, 34, 52); c.font = '13px "Share Tech Mono",monospace';
  c.fillText('KILLS ' + G.kills, 36, 72); c.fillStyle = CY + '.5)'; if (G.best) c.fillText('BEST WAVE ' + G.best, 36, 88);
  // squad
  if (Net.role !== 'solo') { let y = 112; c.fillStyle = CY + '.8)'; c.fillText(Net.role === 'host' ? 'SQUAD CODE ' + Net.code : 'SQUAD ' + Net.code, 36, y); for (const g of [...G.gunners.values()].sort((a, b) => a.slot - b.slot)) { y += 16; c.fillStyle = g.id === myId() ? '#fff' : CY + '.7)'; c.fillText((g.name || '?').padEnd(14) + ' ' + g.kills, 36, y); } }
  // top right readouts
  c.fillStyle = CY + '.35)'; const off = (time * 6) | 0; for (let i = 0; i < 7; i++) c.fillText(READ[(off + i) % READ.length], w - 170, 40 + i * 15);
  if (toastT > 0) { c.globalAlpha = Math.min(1, toastT); c.fillStyle = '#fff'; c.font = '16px "Share Tech Mono",monospace'; c.fillText(toastS, w / 2 - c.measureText(toastS).width / 2, h * .68); }
  c.globalAlpha = 1;
}

// ---------------- world fx (fires, flares, artillery, dust)
let flare = null, artT = 4;
function stepWorldFx(dt, time) {
  for (const f of FIRES) { if (Math.random() < dt * 30 * f.s) PA.add(f.p.x + rnd(-1, 1) * f.s, f.p.y, f.p.z + rnd(-1, 1) * f.s, rnd(-.3, .3), rnd(1.5, 3) * f.s, rnd(-.3, .3), rnd(.5, 1.1), f.s * rnd(1, 1.8), f.s * .3, 2.2, .8, .2, .8, -1);
    if (Math.random() < dt * 8 * f.s) PS.add(f.p.x, f.p.y + f.s, f.p.z, rnd(-.5, .5) + 1.2, rnd(2, 3.5), rnd(-.5, .5), rnd(5, 9), f.s, f.s * 6, .07, .05, .045, .6, -.15, .1);
    if (Math.random() < dt * 4) PA.add(f.p.x, f.p.y, f.p.z, rnd(-2, 2), rnd(3, 7), rnd(-2, 2), rnd(1.5, 3), .2, .05, 3, 1.2, .3, 1, 1); }
  fireL.intensity = 60 + Math.sin(time * 17) * 12 + Math.sin(time * 31) * 8;
  // drifting dust + embers around the player
  if (Math.random() < dt * (HI() ? 25 : 10)) PS.add(P.x + rnd(-40, 40), rnd(.5, 6), rnd(-60, 5), rnd(2, 4), rnd(-.2, .3), rnd(-.5, .5), rnd(4, 8), rnd(.3, .8), rnd(1, 3), .7, .45, .3, .12);
  if (Math.random() < dt * 6) PA.add(P.x + rnd(-25, 25), rnd(.5, 5), rnd(-30, 3), rnd(.5, 2), rnd(.2, .8), rnd(-.5, .5), rnd(3, 6), .05, .02, 3, 1.1, .3, 1);
  // flares
  if (!flare && Math.random() < dt * .08) flare = {x: rnd(-60, 60), y: 90, z: rnd(-150, -60), t: 0};
  if (flare) { flare.t += dt; flare.y -= dt * 4; flare.x += dt * 1.5; flareL.position.set(flare.x, flare.y, flare.z); flareL.intensity = flare.t < 18 ? (900 + Math.random() * 200) * Math.min(1, flare.t) : 0;
    PA.add(flare.x, flare.y, flare.z, 0, 0, 0, .1, 4, 3, 6, 1.2, .8, 1); if (Math.random() < dt * 20) PS.add(flare.x, flare.y, flare.z, rnd(-.2, .2), .6, rnd(-.2, .2), 6, .5, 3, .5, .3, .3, .25);
    if (flare.t > 18) flare = null; }
  // artillery flashes on the horizon
  if ((artT -= dt) < 0) { artT = rnd(3, 9); const a = rnd(-1.4, 1.4), d = rnd(500, 900), x = Math.sin(a) * d, z = -Math.cos(a) * d;
    for (let i = 0; i < 6; i++) PA.add(x, H0(x, z) + rnd(0, 10), z, rnd(-5, 5), rnd(5, 20), rnd(-5, 5), rnd(.3, .9), rnd(25, 50), 10, 4, 1.6, .6, 1);
    skyM.uniforms.flash.value = .5; const pan = clamp(-Math.sin(angD(P.yaw, a)), -1, 1); Sfx.play('boom', {vol: .5, at: d / 340, pan, lp: 600}); }
  skyM.uniforms.flash.value *= Math.exp(-dt * 5);
  for (const B of BEAMS) { B.ph += dt * .25; B.m.rotation.set(.35 + Math.sin(B.ph * 1.3) * .2, Math.sin(B.ph) * .8 + (B.x < 0 ? .3 : -.3), 0); }
  // ambient chitter
  if (Sfx.ctx && bugs.length && Math.random() < dt * Math.min(6, bugs.length * .05)) { const b = bugs[(Math.random() * bugs.length) | 0]; if (!b.dead) { const a = Sfx.at(b.x, b.z); Sfx.play(Math.random() < .2 ? 'screech' : 'chitter', {vol: .25 * a.vol, pan: a.pan, rate: rnd(.7, 1.4), lp: 2500}); } }
}

// ---------------- gun + camera feel
const keys = {};
let mouseDown = false, testFire = null;
function wantFire() { return testFire !== null ? testFire : (SET.auto || mouseDown); }
function stepGunner(g, dt, local) {
  const want = local ? wantFire() && !G.over : !!g.fire;
  g.spin = clamp(g.spin + (want ? dt / .4 : -dt / 1.4), 0, 1);
  if (local && P.vent > 0) { P.vent -= dt; }
  const can = g.spin > .97 && (!local || P.vent <= 0);
  if (can && want) { g.acc += dt * 36; let n = 0; while (g.acc >= 1) { g.acc--; fireShot(g, g.n++); n++; } if (local) { P.firing = true; P.fireT += dt; P.heat = Math.min(1, P.heat + dt / 9); if (P.heat >= 1) { P.vent = .6; P.heat = .55; vent(); } } }
  else { g.acc = 0; if (local) { P.firing = false; P.fireT = Math.max(0, P.fireT - dt * 3); } }
  if (local && !P.firing) P.heat = Math.max(0, P.heat - dt * (P.vent > 0 ? .5 : .12));
  if (!local) { g.heat = g.fire ? Math.min(1, g.heat + dt / 9) : Math.max(0, g.heat - dt * .12); }
  // target retarget timer
  g.tgtT -= dt; if (g.tgtT <= 0) { g.tgtT = .12; g.tgt = pickTarget(g); }
  // auto pitch toward target
  let tp = -.05; if (g.tgt && !g.tgt.dead) { const dx = g.tgt.x - SLOTX[g.slot], dz = g.tgt.z, d = Math.hypot(dx, dz); tp = Math.atan2(g.tgt.y + BH * g.tgt.s - 1.7, d); tp = clamp(tp, -.4, .25); }
  g.pitch += (tp - g.pitch) * Math.min(1, dt * 5);
}
function vent() { const u = FPG.userData; for (let i = 0; i < 26; i++) { u.bar.getWorldPosition(_v); PS.add(_v.x, _v.y, _v.z, rnd(-.8, .8), rnd(.8, 2.2), rnd(-.8, .8), rnd(.6, 1.6), .1, rnd(.6, 1.4), .85, .85, .85, .45, -.5, 1.5); } Sfx.play('shot', {vol: 0}); }
function updateGunVisual(gun, spin, heat, firing, time, dt) {
  const u = gun.userData; u.ang = (u.ang || 0) + spin * 34 * dt; u.bar.rotation.z = u.ang;
  const h = heat * heat; u.barrelM.emissive.setRGB(h * 4 + h * h * 6, h * 1.4 + h * h * 5, h * h * 3.5);
  for (let i = 0; i < u.belt.length; i++) u.belt[i].position.z = -.12 - (i / 8) * .1 + (firing ? Math.sin(time * 60 + i) * .004 : 0);
  const on = firing && Math.random() < .85;
  for (const s of u.fl) { s.visible = on; if (on) { const k = rnd(.25, .6); s.scale.set(k, k, 1); s.material.rotation = rnd(0, TAU); s.position.z = rnd(-.15, .05); } }
  u.side.visible = on && Math.random() < .5; if (u.side.visible) { u.side.rotation.z = rnd(0, PI); u.side.scale.set(rnd(.8, 1.6), 1, 1); }
}
function stepFeel(dt, time) {
  const firing = P.firing;
  // springs
  const spring = (x, v, k, c) => { const a = -k * x - c * v; v += a * dt; x += v * dt; return [x, v]; };
  [P.kick, P.kickV] = spring(P.kick, P.kickV, 420, 26);
  [P.gp, P.gpV] = spring(P.gp, P.gpV, 220, 18);
  [P.cp, P.cpV] = spring(P.cp, P.cpV, 70, 13);
  [P.cy, P.cyV] = spring(P.cy, P.cyV, 60, 12);
  [P.swayX, P.swayVX] = spring(P.swayX, P.swayVX, 90, 12);
  [P.swayY, P.swayVY] = spring(P.swayY, P.swayVY, 90, 12);
  if (firing) { P.drift += rnd(-1, 1) * dt * .4; P.drift *= .97; P.yaw += P.drift * dt * .15; }
  P.trauma = Math.max(firing ? .28 + P.heat * .25 : 0, P.trauma - dt * 1.4); P.bloom = Math.max(0, P.bloom - dt * (firing ? .6 : 3));
  const sh = P.trauma * P.trauma;
  const nx = (Math.sin(time * 47.3) + Math.sin(time * 31.7 + 1) * .6) * sh * .012, ny = (Math.sin(time * 53.1 + 2) + Math.sin(time * 27.9) * .6) * sh * .012;
  const lg = localGunner(); const pitch = (lg ? lg.pitch : -.05);
  P.fovP *= Math.exp(-dt * 4);
  cam.fov = 72 + P.fovP * 5 - (firing ? 2 : 0) * smooth(P.fireT); cam.updateProjectionMatrix();
  const breath = Math.sin(time * 1.4) * .004;
  cam.position.set(P.x + nx * .3, 1.7 + breath * .5 + (G.dmgFlash > .1 ? rnd(-.02, .02) * G.dmgFlash : 0), P.z + .02);
  cam.rotation.set(pitch + P.cp * .02 + ny + breath, P.yaw + P.cy * .01 + nx, nx * .3, 'YXZ');
  // gun pose
  const idle = firing ? 0 : 1;
  FPG.position.set(GUN_BASE.x + P.swayX * .02 + Math.sin(time * 1.1) * .003 * idle + rnd(-1, 1) * .002 * sh * 4, GUN_BASE.y + P.swayY * .02 + Math.sin(time * 1.4) * .004 * idle + P.gp * .004, GUN_BASE.z + P.kick * .012);
  FPG.rotation.set(P.gp * .02 - P.swayY * .03, -P.swayX * .04 + .02, P.cy * .01 + P.swayX * .05);
  muzL.intensity = firing && Math.random() < .8 ? rnd(5, 11) : 0; FPG.userData.muzzle.getWorldPosition(muzL.position);
}

// ---------------- main flow
function resetWorld() {
  for (const b of bugs.slice()) freeBug(b); nextId = 1;
  Object.assign(G, {wave: 0, quota: 0, spawnAcc: 0, gap: 1.5, kills: 0, shield: 100, hp: 100, hurtT: 9, over: false, evq: [], dmgDirs: [], attackers: 0, runT: 0, cleared: false, bruteSeen: false, lowWarn: false, lost: false});
  for (const g of G.gunners.values()) g.kills = 0;
  P.heat = 0; P.spin = 0; P.vent = 0;
}
function beginGame(fresh) {
  Sfx.init(); resetWorld();
  if (fresh) { for (const id of [...G.gunners.keys()]) removeGunner(id); addGunner(myId(), 0, SET.name); }
  if (!G.gunners.has(myId())) addGunner(myId(), 0, SET.name);
  G.on = true; G.paused = false; P.yaw = 0;
  ['menu', 'end', 'pause'].forEach(i => $(i).classList.add('hidden')); $('hud').classList.remove('hidden'); $('visor').classList.remove('hidden');
  if (isHost()) startWave(1);
  if (!TEST && !isTouch) lockPtr();
  $('bPauseT').classList.toggle('hidden', !isTouch);
  $('bAgain').disabled = false;
}
function overrun(m) {
  if (G.over) return; G.over = true; const w = m ? m.w : G.wave, k = m ? m.k : G.kills, t = m && m.rt ? m.rt : G.runT;
  const prev = G.best; if (w > G.best) { G.best = w; try { localStorage.setItem('ls-best', w); } catch (e) {} }
  if (Net.role === 'host') Net.send({t: 'over', w, k, rt: Math.round(t)});
  callout('OVERRUN', 'THE LINE HAS FALLEN');
  setTimeout(() => { if (G.over) showEnd('OVERRUN', 'The hive took Kestrel-9', w, k, t, w > prev && prev > 0 ? 'NEW BEST: wave ' + w + ' (was ' + prev + ')' : 'Best: wave ' + G.best); }, 1600);
  Sfx.play('horn', {rate: .6, vol: .7});
}
function fmtT(t) { t = Math.max(0, t | 0); return (t / 60 | 0) + ':' + String(t % 60).padStart(2, '0'); }
function showEnd(title, sub, w, k, t, best) {
  const lg = localGunner(), you = lg && Net.role !== 'solo' ? lg.kills : null;
  $('call').style.opacity = 0; callT = 0;
  $('endH').textContent = title; $('endSub').textContent = sub;
  $('endS').innerHTML = `<div><b>${w}</b><small>Wave</small></div><div><b>${k}</b><small>${you !== null ? 'Squad kills' : 'Kills'}</small></div><div><b>${fmtT(t)}</b><small>Held</small></div>` + (you !== null ? `<div style="grid-column:1/-1"><small>Your kills</small> <b style="display:inline;font-size:22px">${you}</b></div>` : '');
  $('endB').textContent = best || '';
  const guest = Net.role === 'guest' && !G.lost;
  $('bAgain').textContent = G.lost ? 'Back to menu' : guest ? 'Waiting for the host to restart' : 'Hold the line again';
  $('bAgain').disabled = guest; $('endK').textContent = guest ? '' : 'or press Space';
  $('end').classList.remove('hidden'); $('bPauseT').classList.add('hidden'); document.exitPointerLock && document.exitPointerLock();
}
function lockPtr() { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }

let last = performance.now(), time = 0;
let noRender = false;
function step(dt) {
  time += dt; G.t += dt;
  const live = G.on && !(G.paused && Net.role === 'solo');
  if (live) {
    if (!G.over) G.runT += dt;
    // input sweep
    const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    if (kx) { P.yaw -= kx * dt * 1.7; P.swayVX -= kx * dt * 30; }
    P.yaw = clamp(P.yaw, -1.5, 1.5);
    const lg = localGunner(); if (lg) lg.yaw = P.yaw;
    if (isHost()) stepBugsHost(dt); else stepBugsGuest(dt);
    for (const g of G.gunners.values()) stepGunner(g, dt, g.id === myId());
    G.hurtT += dt; if (G.hurtT > 1.2 && isHost()) G.shield = Math.min(100, G.shield + dt * 45);
    if (G.hurtT < .1 && isHost()) { // direction indicator from nearest attacker
      let nb = null, nd = 1e9; for (const b of bugs) if (b.st === 1 && !b.dead) { const d = Math.abs(b.x - P.x); if (d < nd) { nd = d; nb = b; } }
      if (nb && Math.random() < .1) G.dmgDirs.push({a: Math.atan2(-(nb.x - P.x), -(nb.z - P.z)), t: 1}); }
    if (Net.role === 'guest' && G.hurtT < .1 && Math.random() < .1) G.dmgDirs.push({a: P.yaw + rnd(-1, 1), t: 1});
    if (Net.role === 'host' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 12; Net.send(packSnap()); }
    if (Net.role === 'guest' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 15; Net.send({t: 'aim', y: Math.round(P.yaw * 1000) / 1000, f: wantFire() && P.vent <= 0 ? 1 : 0}); }
  }
  if (Net.role !== 'host') G.evq = [];
  stepBugsCommon(dt, time);
  for (const b of bugs) drawBug(b, time);
  BODY.instanceMatrix.needsUpdate = LUP.instanceMatrix.needsUpdate = LLO.instanceMatrix.needsUpdate = true; if (BODY.instanceColor) BODY.instanceColor.needsUpdate = true;
  const lg = localGunner();
  if (lg) { P.spin = lg.spin; if (lg.spin > .97 && P.spinFull !== 1) { P.fovP = 1; } P.spinFull = lg.spin > .97 ? 1 : 0; }
  stepFeel(dt, time);
  updateGunVisual(FPG, P.spin, P.heat, P.firing, time, dt);
  for (const g of G.gunners.values()) if (g.model) { g.model.rotation.y = g.yaw; const gun = g.model.userData.gun; gun.rotation.x = g.pitch; updateGunVisual(gun, g.spin, g.heat, g.spin > .97 && g.fire, time, dt); }
  Sfx.gun(P.spin, P.heat, P.vent > 0);
  PA.step(dt); PS.step(dt); PG.step(dt); stepDecals(dt); stepChunks(chunks, CHK, 300, dt); stepChunks(legsD, LGD, 80, dt, true); stepTracers(dt); stepCases(dt);
  stepWorldFx(dt, time);
  G.dmgFlash = Math.max(0, G.dmgFlash - dt * 1.5); G.hitT -= dt; G.killT -= dt; for (const d of G.dmgDirs) d.t -= dt; G.dmgDirs = G.dmgDirs.filter(d => d.t > 0);
  compM.uniforms.dmg.value = G.dmgFlash * .9 + (G.hp < 30 ? (.25 + Math.sin(time * 6) * .1) : 0); compM.uniforms.time.value = time;
  $('dmg').style.opacity = 0;
  if (callT > 0 && (callT -= dt) <= 0) $('call').style.opacity = 0;
  toastT -= dt;
  if (G.on) drawHud(dt, time);
  if (!G.on) { P.yaw = Math.sin(time * .07) * .5; cam.position.set(0, 1.7, 0); cam.rotation.set(-.03, P.yaw, 0, 'YXZ'); }
  if (!noRender) render();
}
function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; step(dt); requestAnimationFrame(loop); }

// ---------------- input
addEventListener('mousemove', e => { if (document.pointerLockElement !== canvas || !G.on) return; const dx = e.movementX * .0022 * SET.sens; P.yaw = clamp(P.yaw - dx, -1.5, 1.5); P.swayVX -= dx * 40; P.swayVY += e.movementY * .0022 * SET.sens * 20; });
canvas.addEventListener('mousedown', e => { Sfx.init(); if (!G.on || G.over) return; if (document.pointerLockElement !== canvas && !TEST && !isTouch) { lockPtr(); return; } if (e.button === 0) mouseDown = true; if (e.button === 2 && P.vent <= 0 && P.heat > .2) { P.vent = .5; vent(); } });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { keys[e.code] = true; if (!G.on) return;
  if (G.over) { if ((e.code === 'Space' || e.code === 'Enter') && !$('end').classList.contains('hidden') && !$('bAgain').disabled) { e.preventDefault(); $('bAgain').click(); } return; }
  if (e.code === 'Escape' && document.pointerLockElement !== canvas && performance.now() - plT > 400) { pause(!G.paused); return; } if (e.code === 'KeyF') { SET.auto = !SET.auto; saveSet(); syncUI(); toast('Auto-fire ' + (SET.auto ? 'on' : 'off')); } if (e.code === 'KeyR' && P.vent <= 0 && P.heat > .2) { P.vent = .5; vent(); } if (e.code === 'KeyP') pause(true); });
addEventListener('keyup', e => { keys[e.code] = false; });
let isTouch = false, tX = null;
addEventListener('touchstart', e => { isTouch = true; Sfx.init(); if (G.on && !G.over) $('bPauseT').classList.remove('hidden'); if (G.on) tX = e.touches[0].clientX; }, {passive: true});
addEventListener('touchmove', e => { if (!G.on || tX === null) return; const x = e.touches[0].clientX, dx = (x - tX) * .006 * SET.sens; tX = x; P.yaw = clamp(P.yaw - dx, -1.5, 1.5); P.swayVX -= dx * 40; }, {passive: true});
addEventListener('touchend', () => { tX = null; });
let plT = 0;
document.addEventListener('pointerlockchange', () => { plT = performance.now(); const on = document.pointerLockElement === canvas; $('hint').classList.toggle('hidden', on || !G.on || G.over || isTouch || TEST); if (!on && G.on && !G.over && !TEST && !isTouch) pause(true); });
function pause(p) { G.paused = p; $('pause').classList.toggle('hidden', !p); if (!p && !isTouch) lockPtr(); }
$('bPauseT').onclick = () => pause(true);

// ---------------- menus
function syncUI() {
  for (const id of ['sens', 'sens2']) $(id).value = SET.sens; for (const id of ['vol', 'vol2']) $(id).value = SET.vol;
  for (const id of ['gfx', 'gfx2']) for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === SET.gfx);
  for (const id of ['auto', 'auto2']) if ($(id)) $(id).checked = SET.auto;
  if ($('name')) $('name').value = SET.name;
  $('best').textContent = G.best ? 'Best: held until wave ' + G.best : '';
}
for (const id of ['sens', 'sens2']) $(id).oninput = e => { SET.sens = +e.target.value; saveSet(); syncUI(); };
for (const id of ['vol', 'vol2']) $(id).oninput = e => { SET.vol = +e.target.value; saveSet(); if (Sfx.master) Sfx.master.gain.value = SET.vol; syncUI(); };
for (const id of ['gfx', 'gfx2']) for (const b of $(id).children) b.onclick = () => { SET.gfx = b.dataset.v; saveSet(); syncUI(); resize(); };
for (const id of ['auto', 'auto2']) if ($(id)) $(id).onchange = e => { SET.auto = e.target.checked; saveSet(); syncUI(); };
if ($('name')) $('name').oninput = e => { SET.name = e.target.value.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Trooper'; saveSet(); };
function netStatus(s) { if ($('netS')) $('netS').textContent = s; }
$('bStart').onclick = () => { Net.close(); beginGame(true); };
if ($('bHost')) $('bHost').onclick = () => {
  Sfx.init(); const code = Net.host(SET.name, st => netStatus(st === 'open' ? 'Squad open. Code ' + Net.code : 'Reconnecting to relay...'));
  beginGame(true); G.gunners.get('H').name = SET.name;
  const link = location.origin + location.pathname + '?room=' + code; toast('Squad code ' + code + ' (link copied)'); try { navigator.clipboard.writeText(link).catch(() => {}); } catch (e) {}
  $('pCode').textContent = 'Squad code ' + code + ' // ' + link;
};
if ($('bJoin')) $('bJoin').onclick = () => {
  const code = ($('jCode').value || '').toUpperCase().replace(/[^A-Z]/g, ''); if (code.length !== 5) { netStatus('Enter the 5-letter squad code.'); return; }
  Sfx.init(); netStatus('Joining ' + code + '...');
  Net.join(code, SET.name, why => { netStatus(why); if (G.on) { G.on = false; $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('end').classList.add('hidden'); document.exitPointerLock && document.exitPointerLock(); } });
  for (const id of [...G.gunners.keys()]) removeGunner(id);
};
$('bResume').onclick = () => pause(false);
$('bQuit').onclick = () => { Net.close(); clearTimeout(G.goneT); $('bPauseT').classList.add('hidden'); G.on = false; G.paused = false; resetWorld(); ['pause', 'end'].forEach(i => $(i).classList.add('hidden')); $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('visor').classList.add('hidden'); };
$('bMenu').onclick = $('bQuit').onclick;
$('bAgain').onclick = () => { if (G.lost) { $('bQuit').onclick(); return; } if (Net.role === 'guest') return; if (Net.role === 'host') Net.send({t: 'restart'}); beginGame(false); };
const openReq = () => { $('reqF').src = 'requests.html?embed'; $('reqBox').classList.remove('hidden'); document.exitPointerLock && document.exitPointerLock(); };
for (const id of ['bReq', 'bReq2', 'bReq3']) $(id).onclick = openReq;
$('bReqX').onclick = () => $('reqBox').classList.add('hidden');
{ const m = /[?&]room=([A-Za-z]{5})/.exec(location.search); if (m && $('jCode')) { $('jCode').value = m[1].toUpperCase(); netStatus('Squad code filled in. Press Join.'); } }
syncUI(); resize();

if (TEST) window.__LS = {G, P, bugs, Net, SET, start: () => beginGame(true), fire: v => { testFire = v; }, step: (dt, n = 1, nr) => { noRender = !!nr; for (let i = 0; i < n; i++) step(dt); noRender = false; }, setYaw: y => { P.yaw = y; }, Sfx, spawnBug, killBug, host: () => $("bHost").click(), join: c => { $('jCode').value = c; $('bJoin').click(); }, scene, cam};
// compile the shaders the fight needs up front (muzzle flash, squad marines) so the first shots don't hitch
{ const wm = makeMarine(), u = FPG.userData; u.fl.forEach(f => f.visible = true); u.side.visible = true; try { RND.compile(scene, cam); } catch (e) {} u.fl.forEach(f => f.visible = false); u.side.visible = false; scene.remove(wm); }
requestAnimationFrame(loop);
