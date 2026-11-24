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
const SET = Object.assign({sens: 1, vol: .8, gfx: 'high', auto: false, ff: false, name: 'Trooper'}, (() => { try { return JSON.parse(localStorage.getItem('ls-set')) || {}; } catch (e) { return {}; } })());
if (!SET.v2) { SET.auto = false; SET.v2 = 1; try { localStorage.setItem('ls-set', JSON.stringify(SET)); } catch (e) {} } // manual fire is the default now
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
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.seq = 0; this.mySlot = 0; this.onStatus = onStatus; this.hostConnect(); return this.code; },
  // host migration: a guest takes over the same room code (the relay sends 'host up' to the other guests, who say hello again)
  promote(onStatus, slot, seq) { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} }
    this.role = 'host'; this.peers = new Map(); this.seq = seq || 0; this.mySlot = slot; this.onStatus = onStatus; this.retry = 0; this.hostConnect(); },
  host0(code) { this.close(); this.role = 'host'; this.code = code; this.peers = new Map(); this.seq = this.seq || 0; this.mySlot = this.mySlot || 0; this.retry = 0; this.hostConnect(); },
  helloMsg() { return Object.assign({t: 'hello', name: this.name}, this.helloX ? this.helloX() : {}); },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(true); this.onStatus && this.onStatus('open'); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') {
        if (!this.peers.has(id) && this.peers.size >= 3) { this.send1(id, {t: 'full'}); return; }
        let p = this.peers.get(id);
        if (!p) { // a returning squad member (after a host migration) asks for its old slot, kills and join order
          const used = new Set([this.mySlot || 0, ...[...this.peers.values()].map(q => q.slot)]); let s = 0; while (used.has(s)) s++;
          const want = m.slot | 0; if (m.slot !== undefined && want >= 0 && want < 4 && !used.has(want)) s = want;
          p = {id, slot: s, kills: Math.max(0, m.kills | 0), j: m.j > 0 ? m.j | 0 : ++this.seq, yaw: 0, fire: 0}; this.seq = Math.max(this.seq, p.j);
        }
        p.name = String(m.name || 'Trooper').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Trooper';
        this.peers.set(id, p); this.emit({t: '_join', id}); return;
      }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id);
    };
    ws.onclose = ev => { if (this.role !== 'host' || this.ws !== ws) return;
      if (ev.code === 4001) { this.ws = null; this.emit({t: '_replaced'}); return; } // another squad member took over the room while we were away
      this.onStatus && this.onStatus('retry');
      // one quick retry as host; after that a guest has probably taken over, so come back as a guest (the game re-hosts if the room is empty)
      setTimeout(() => { if (this.role !== 'host' || this.ws !== ws) return; if (this.retry > 1 && this.peers.size) this.emit({t: '_hostlost'}); else this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) {
    this.close(); this.role = 'guest'; this.code = code; this.name = name; this.id = Math.random().toString(36).slice(2, 11);
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer';
    // the relay also says 'host up' right after we connect; hello was already sent, so only a later 'host up' re-sends it
    ws.onopen = () => { this.openT = Date.now(); this.send(this.helloMsg()); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostgone'}); else if (m.c === 'host' && m.up && Date.now() - (this.openT || 0) > 1500) { this.send(this.helloMsg()); this.emit({t: '_hostback'}); } return; }
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
const FOG = new THREE.Color(.74, .5, .35);
scene.fog = new THREE.FogExp2(FOG, .00105);
const POST = {};
function mkRT(w, h, ms) { return new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, samples: ms || 0, depthBuffer: !!ms || ms === 0 && false}); }
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene();
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsScene.add(fsQuad);
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const brightM = new THREE.ShaderMaterial({uniforms: {t: {value: null}, px: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: 'uniform sampler2D t; uniform vec2 px; varying vec2 vUv; void main(){ vec3 c = (texture2D(t, vUv + px*vec2(-1.,-1.)).rgb + texture2D(t, vUv + px*vec2(1.,-1.)).rgb + texture2D(t, vUv + px*vec2(-1.,1.)).rgb + texture2D(t, vUv + px*vec2(1.,1.)).rgb) * .25; float l = max(c.r, max(c.g, c.b)); c *= smoothstep(1.6, 4., l); gl_FragColor = vec4(min(c, vec3(30.)), 1.); }'});
const blurM = new THREE.ShaderMaterial({uniforms: {t: {value: null}, d: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * .227; c += (texture2D(t, vUv + d*1.38).rgb + texture2D(t, vUv - d*1.38).rgb) * .316; c += (texture2D(t, vUv + d*3.23).rgb + texture2D(t, vUv - d*3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }'});
const compM = new THREE.ShaderMaterial({uniforms: {sun: {value: new THREE.Vector2(.5, .5)}, sunI: {value: 0}, t: {value: null}, b: {value: null}, b2: {value: null}, time: {value: 0}, bloom: {value: .9}, exp: {value: 1}, dmg: {value: 0}, ab: {value: .0008}, res: {value: new THREE.Vector2()}}, vertexShader: VS, depthTest: false,
  fragmentShader: `uniform sampler2D t, b, b2; uniform float time, bloom, exp, dmg, ab, sunI; uniform vec2 res, sun; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.13) * 43758.5453); }
  void main(){ vec2 d = vUv - .5; float r = dot(d, d); vec2 o = d * ab * (1. + dmg*3.);
    vec3 c = vec3(texture2D(t, vUv + o).r, texture2D(t, vUv).g, texture2D(t, vUv - o).b);
    c += (texture2D(b, vUv).rgb * .6 + texture2D(b2, vUv).rgb * .8) * bloom;
    if (sunI > .001) { vec2 dd = (sun - vUv) / 32.; vec2 u2 = vUv + dd * hash(vUv * res); vec3 gr = vec3(0.); float w = 1.; // light shafts through dust, bugs and smoke
      for (int i = 0; i < 32; i++) { u2 += dd; vec3 s = texture2D(t, clamp(u2, 0., 1.)).rgb; gr += max(s - 1.1, 0.) * w; w *= .95; }
      c += gr / 32. * sunI * vec3(1., .78, .55) * 1.6; }
    c = aces(c * exp * .6);
    float lu = dot(c, vec3(.2126, .7152, .0722)); c = mix(vec3(lu), c, .82);
    c = pow(c, vec3(1./2.2));
    c *= 1. - r * .4; c = mix(c, vec3(.35, .03, .01), clamp(dmg * smoothstep(.12, .4, r), 0., .5));
    c += (hash(vUv * res) - .5) * .014;
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
const _gv = new THREE.Vector3();
function render() {
  RND.setRenderTarget(POST.main); RND.render(scene, cam);
  brightM.uniforms.t.value = POST.main.texture; brightM.uniforms.px.value.set(1 / POST.w, 1 / POST.h); pass(brightM, POST.a);
  blurM.uniforms.t.value = POST.a.texture; blurM.uniforms.d.value.set(1 / POST.a.width, 0); pass(blurM, POST.b);
  blurM.uniforms.t.value = POST.b.texture; blurM.uniforms.d.value.set(0, 1 / POST.a.height); pass(blurM, POST.a);
  brightM.uniforms.t.value = POST.a.texture; brightM.uniforms.px.value.set(1 / POST.a.width, 1 / POST.a.height); pass(blurM, POST.c);
  blurM.uniforms.t.value = POST.c.texture; blurM.uniforms.d.value.set(1.5 / POST.c.width, 0); pass(blurM, POST.d);
  blurM.uniforms.t.value = POST.d.texture; blurM.uniforms.d.value.set(0, 1.5 / POST.c.height); pass(blurM, POST.c);
  compM.uniforms.t.value = POST.main.texture; compM.uniforms.b.value = POST.a.texture; compM.uniforms.b2.value = POST.c.texture;
  compM.uniforms.bloom.value = HI() ? .4 : .25;
  { _gv.copy(SUN_DIR).multiplyScalar(1000).add(cam.position).project(cam); const f = _gv.z < 1 ? clamp(1.4 - Math.hypot(_gv.x, _gv.y) * .7, 0, 1) : 0; compM.uniforms.sun.value.set(_gv.x * .5 + .5, _gv.y * .5 + .5); compM.uniforms.sunI.value = TUN ? 0 : f * (HI() ? 1 : .6); }
  pass(compM, null);
}

// ---------------- canvas textures
function cvs(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function ctex(c, srgb = true, rep) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; return t; }
// ---- procedural texture sets: tileable colour + normal (+ roughness) generated from one height function
function pn(x, y, P) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = a => ((a % P) + P) % P;
  return mix(mix(h2(w(xi), w(yi)), h2(w(xi + 1), w(yi)), u), mix(h2(w(xi), w(yi + 1)), h2(w(xi + 1), w(yi + 1)), u), v); }
function pf(x, y, P, o = 4) { let s = 0, a = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * pn(x * f, y * f, P * f); n += a; f *= 2; a *= .5; } return s / n; }
function vor(x, y, P) { const xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9, id = 0; // periodic voronoi: nearest, second nearest, cell id
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const cx = xi + i, cy = yi + j, wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P, px = cx + h2(wx, wy * 1.7 + 3), py = cy + h2(wx * 2.3 + 7, wy), d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = h2(wx + 11, wy + 5); } else if (d < d2) d2 = d; } return [d1, d2, id]; }
function genTex(N, f, nStr, srgb = true) { // f(u, v) -> [height, r, g, b, rough] (colour 0..1 in sRGB)
  const H = new Float32Array(N * N), cc = document.createElement('canvas'), cn = document.createElement('canvas'), cr = document.createElement('canvas'); cc.width = cc.height = cn.width = cn.height = cr.width = cr.height = N;
  const gc = cc.getContext('2d'), gn = cn.getContext('2d'), gr = cr.getContext('2d'), dc = gc.createImageData(N, N), dn = gn.createImageData(N, N), dr = gr.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = f(x / N, y / N), i = y * N + x, k = i * 4; H[i] = o[0];
    dc.data[k] = clamp(o[1], 0, 1) * 255; dc.data[k + 1] = clamp(o[2], 0, 1) * 255; dc.data[k + 2] = clamp(o[3], 0, 1) * 255; dc.data[k + 3] = 255; const r = clamp(o[4] ?? .9, 0, 1) * 255; dr.data[k] = dr.data[k + 1] = dr.data[k + 2] = r; dr.data[k + 3] = 255; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const at = (a, b) => H[((b + N) % N) * N + ((a + N) % N)], dx = (at(x + 1, y) - at(x - 1, y)) * nStr, dy = (at(x, y + 1) - at(x, y - 1)) * nStr, l = Math.hypot(dx, dy, 1), k = (y * N + x) * 4;
    dn.data[k] = (-dx / l * .5 + .5) * 255; dn.data[k + 1] = (dy / l * .5 + .5) * 255; dn.data[k + 2] = (1 / l * .5 + .5) * 255; dn.data[k + 3] = 255; }
  gc.putImageData(dc, 0, 0); gn.putImageData(dn, 0, 0); gr.putImageData(dr, 0, 0);
  const map = ctex(cc, srgb, true), nrm = ctex(cn, false, true), rgh = ctex(cr, false, true); for (const t of [map, nrm, rgh]) t.anisotropy = 8; return {map, nrm, rgh, H}; }
// desert sand: wind ripples (sharp crests, soft stoss slopes), coarse grains in the troughs, scattered pebbles
const SAND = genTex(HI() ? 1024 : 512, (u, v) => {
  const q = u * 34 + pf(u * 4, v * 4, 4) * 2.4 + pf(u * 9 + 3, v * 9, 9, 2) * .4, t = q - Math.floor(q), rip = t < .72 ? t / .72 : (1 - t) / .28;
  const big = pf(u * 3, v * 3, 3, 3), g = h2(u * 997.3, v * 787.1), cell = vor(u * 26, v * 26, 26), peb = cell[0] < .16 * (cell[2] > .7 ? 1 : 0) ? 1 - cell[0] / .16 : 0;
  const h = rip * .55 + big * .6 + g * .12 + peb * .9, tr = 1 - rip, n = .9 + big * .2 + (g - .5) * .14;
  let r = .78 * n - tr * .05, gg = .58 * n - tr * .045, b = .42 * n - tr * .035; if (peb > 0) { const pc = cell[2] * 3 % 1; r = mix(r, .38 + pc * .2, Math.min(1, peb * 3)); gg = mix(gg, .27 + pc * .12, Math.min(1, peb * 3)); b = mix(b, .2 + pc * .08, Math.min(1, peb * 3)); }
  return [h, r, gg, b, .82 + tr * .15 - peb * .25]; }, 5);
const sandTex = SAND.map;
// burlap: over/under weave of jute threads, fuzzy fibres, dust and stains
const BURL = genTex(512, (u, v) => {
  const n = 40, gx = u * n, gy = v * n, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i - .5, fy = gy - j - .5, wo = (i + j) % 2;
  const warp = Math.cos(fx * PI) * (wo ? 1 : .55), weft = Math.cos(fy * PI) * (wo ? .55 : 1), th = Math.max(warp, weft), fib = h2(u * 1531, v * 1291) * .25 + Math.sin((wo ? gy : gx) * 40 + h2(i, j) * 6) * .08;
  const st = pf(u * 3, v * 3, 3, 4), dust = pf(u * 6 + 4, v * 6, 6, 3), sl = h2(i * .37, j * .91);
  const h = th + fib, k = (.62 + th * .35 + (sl - .5) * .12) * (1 - smooth((st - .55) * 4) * .35);
  return [h, .66 * k + dust * .08, .52 * k + dust * .06, .34 * k + dust * .04, .97]; }, 4);
const burlapT = BURL.map;
// chitin (triplanar on the bugs): armour plates with grooves between them, pits, scratches. R = height, G = roughness, B = tone
const CHIT = genTex(512, (u, v) => {
  const c = vor(u * 7, v * 7, 7), e = c[1] - c[0], groove = smooth(e / .12), pit = vor(u * 18, v * 18, 18)[0] + .06, sc = Math.abs(Math.sin((u * 3 + v * 11) * 14 + pf(u * 6, v * 6, 6) * 9)) < .03 ? 1 : 0;
  const h = groove * (.7 + (1 - c[0]) * .3) - (pit < .12 ? (1 - pit / .12) * .35 : 0) - sc * .15 + pf(u * 20, v * 20, 20, 2) * .1;
  return [h, h, .25 + (1 - groove) * .45 + sc * .2 + pf(u * 5, v * 5, 5, 3) * .2, .75 + c[2] * .35 + groove * .1 - sc * .2, 1]; }, 6, false);
// rock (triplanar on rocks + mesas): layered grain with cracks. R = height, G = roughness, B = tone
const ROCK = genTex(512, (u, v) => {
  const c = vor(u * 5, v * 5, 5), crack = smooth((c[1] - c[0]) / .05), lay = Math.sin(v * TAU * 9 + pf(u * 4, v * 4, 4) * 5) * .5 + .5, gr = pf(u * 24, v * 24, 24, 3), fine = h2(u * 911, v * 677);
  const h = crack * .6 + lay * .25 + gr * .3 + fine * .06; return [h, h, .8 + (1 - crack) * .2, .7 + lay * .25 + gr * .25 - (1 - crack) * .35, 1]; }, 5, false);
// olive drab ammo crates with chipped paint, steel plates with scrapes and rust
const CRATE = genTex(256, (u, v) => {
  const edge = Math.min(u, v, 1 - u, 1 - v), rim = edge < .06 ? 1 : 0, rib = Math.abs(((u * 4) % 1) - .5) < .04 && edge > .06 ? 1 : 0, chip = pf(u * 9, v * 9, 9, 4), bare = chip > .68 - (edge < .1 ? .12 : 0) ? 1 : 0, dirt = pf(u * 3 + 5, v * 3, 3, 3);
  const k = .85 + dirt * .25; let r = .29 * k, g = .34 * k, b = .22 * k; if (bare) { r = .46; g = .44; b = .4; } if (rim) { r *= .8; g *= .8; b *= .8; }
  return [rim * .6 + rib * .4 - bare * .15, r, g, b, bare ? .45 : .75]; }, 3);
const STEEL = genTex(256, (u, v) => {
  const sc = pf(u * 2, v * 40, 2, 3), rust = smooth((pf(u * 4 + 9, v * 4, 4, 4) - .6) * 6), sp = h2(u * 300, v * 200);
  return [sc * .3 + rust * .3, .26 + sc * .08 + rust * .2 + sp * .03, .27 + sc * .08 + rust * .08, .29 + sc * .08 - rust * .02, .35 + rust * .5 + sc * .15]; }, 3);
// triplanar detail + derivative bump in object space (works on instanced meshes): tex R = height, G = roughness, B = tone
function triMat(m, tex, scale, bump, key, toneAmt = .45, fade = 40) {
  m.customProgramCacheKey = () => 'tri-' + key;
  m.onBeforeCompile = sh => {
    sh.uniforms.triT = {value: tex}; sh.uniforms.triS = {value: scale}; sh.uniforms.triB = {value: bump}; sh.uniforms.triF = {value: fade};
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP, vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vOP, vON; uniform sampler2D triT; uniform float triS, triB, triF;
      vec4 triS4(vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(4.)); w /= (w.x + w.y + w.z); return texture2D(triT, p.yz) * w.x + texture2D(triT, p.xz) * w.y + texture2D(triT, p.xy) * w.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      vec4 tri = triS4(vOP * triS, normalize(vON)); diffuseColor.rgb *= mix(1., tri.b * 1.25, ${toneAmt.toFixed(2)});`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (.55 + tri.g * .9), .05, 1.);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); float dhx = dFdx(tri.r), dhy = dFdy(tri.r); vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2) * triB * smoothstep(triF, triF * .2, length(vViewPosition)); normal = normalize(abs(det) * normal - grad); }`);
  };
  return m;
}
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
const skyM = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {sunDir: {value: SUN_DIR}, flash: {value: 0}, ct: {value: 0}},
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
  fragmentShader: `uniform vec3 sunDir; uniform float flash, ct; varying vec3 vD;
  float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hs(i), hs(i + vec2(1., 0.)), f.x), mix(hs(i + vec2(0., 1.)), hs(i + vec2(1., 1.)), f.x), f.y); }
  float fb(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.; a *= .5; } return s; }
  void main(){ vec3 d = normalize(vD); float e = d.y;
    vec3 zen = vec3(.06, .065, .1), mid = vec3(.4, .26, .18), hor = vec3(1.15, .72, .46);
    float t = max(e, 0.); vec3 c = mix(hor, mid, smoothstep(0., .16, t)); c = mix(c, zen, smoothstep(.1, .65, t));
    if (e < 0.) c = mix(hor, vec3(.4, .27, .18), smoothstep(0., -.08, e));
    float sd = max(dot(d, sunDir), 0.);
    c += vec3(1., .62, .35) * pow(sd, 6.) * .45 + vec3(1., .75, .5) * pow(sd, 60.) * 1.1;
    c += vec3(22., 15., 9.) * smoothstep(.9993, .9996, sd);
    c += vec3(.8, .55, .35) * exp(-abs(e) * 16.) * .2;
    float bands = sin(e * 90. + d.x * 3.) * .5 + .5; c *= 1. - .02 * bands * smoothstep(.02, .2, e) * (1. - smoothstep(.2, .5, e));
    // a big pale gas giant low in the east, half lit by the sun
    vec3 pd = normalize(vec3(.62, .2, -.76)); float pdd = dot(d, pd);
    if (pdd > .9978) { vec3 off = d - pd * pdd; float rr = length(off) / sqrt(1. - .9978 * .9978); vec3 sn = normalize(off + pd * sqrt(max(0., 1. - rr * rr)) * .17);
      float lit = clamp(dot(sn, sunDir) * 3. + .35, 0., 1.), band = .85 + .15 * sin(off.y * 2400. + sin(off.x * 800.) * 2.);
      vec3 pc = mix(vec3(.12, .1, .13), vec3(.62, .5, .44) * band, lit); c = mix(c, pc + c * .45, smoothstep(1., .96, rr) * .65); }
    // streaky high cloud and dust layers, lit hot near the sun
    if (e > 0.) { vec2 uv = d.xz / (e + .06); float n = fb(uv * vec2(.7, 2.4) + vec2(ct * .006, 0.)), n2 = fb(uv * 3.1 - vec2(ct * .01, 3.));
      float cl = smoothstep(.48, .82, n * .8 + n2 * .3) * smoothstep(0., .1, e) * (1. - smoothstep(.45, .85, e));
      vec3 cc = mix(vec3(.2, .13, .12), vec3(1.6, .82, .45), clamp(pow(sd, 3.) * 1.2 + .12, 0., 1.)); c = mix(c, cc, cl * .7); }
    c += vec3(1., .6, .3) * flash * exp(-abs(e) * 10.);
    gl_FragColor = vec4(c, 1.); }`});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyM); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
{ const pm = new THREE.PMREMGenerator(RND), s2 = new THREE.Scene(); s2.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyM)); scene.environment = pm.fromScene(s2, 0, .1, 1000).texture; scene.environmentIntensity = .55; }
const SUN = window.SUN = new THREE.DirectionalLight(0xffc49a, 3.2);
SUN.position.copy(SUN_DIR).multiplyScalar(200).add(new THREE.Vector3(0, 0, -30)); SUN.target.position.set(0, 0, -30); scene.add(SUN, SUN.target);
SUN.castShadow = true; SUN.shadow.mapSize.set(2048, 2048); Object.assign(SUN.shadow.camera, {left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 500}); SUN.shadow.bias = -.0006; SUN.shadow.normalBias = .04;
const HEMI = new THREE.HemisphereLight(0xc9b8a8, 0x4a382a, 1.1); scene.add(HEMI);
const fireL = new THREE.PointLight(0xff7a30, 35, 90, 1.6); fireL.position.set(-60, 6, -95); scene.add(fireL);
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
let TUN = null; const UGY = -40;
const HG = new Float32Array(GN * GN);
for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) HG[j * GN + i] = H0(-GE + i * GS, -GE + j * GS);
function gH(x, z) {
  if (z > 450 && TUN) return UGY; // inside the hive tunnels (they sit far off the map)
  const fx = (x + GE) / GS, fz = (z + GE) / GS;
  if (fx < 0 || fz < 0 || fx >= GN - 1 || fz >= GN - 1) return H0(x, z);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, a = HG[j * GN + i], b = HG[j * GN + i + 1], c = HG[(j + 1) * GN + i], d = HG[(j + 1) * GN + i + 1];
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
function groundCol(x, z, h, arr, k) {
  const n = fbm(x * .02 + 5, z * .02), t = clamp(h / 8 + .5, 0, 1);
  arr[k] = .85 + n * .3 - (1 - t) * .15; arr[k + 1] = .72 + n * .2 - (1 - t) * .12; arr[k + 2] = .62 + n * .15 - (1 - t) * .1;
}
// ---- baked lighting: soft sun shadows marched across the heightfield + horizon ambient occlusion, per vertex.
// The sun sits ~6 degrees up, so every dune throws a long shadow; the shadow map only covers ~70 m around the line.
const SUNH = Math.hypot(SUN_DIR.x, SUN_DIR.z), SDX = SUN_DIR.x / SUNH, SDZ = SUN_DIR.z / SUNH, STAN = SUN_DIR.y / SUNH;
function bakeAt(x, z, h, far) {
  const hf = far ? (a, b) => H0(a, b) - 2.5 : gH; let vis = 1, d = far ? 30 : 2;
  for (let i = 0; i < (far ? 22 : 42); i++) { const th = hf(x + SDX * d, z + SDZ * d), ry = h + .25 + STAN * d; vis = Math.min(vis, clamp(.5 + (ry - th) / (d * .045 + .3), 0, 1)); if (vis <= 0) break; d *= far ? 1.18 : 1.13; }
  let occ = 0; if (!far) for (let k = 0; k < 8; k++) { const a = k / 8 * TAU, cx = Math.cos(a), cz = Math.sin(a); let m = 0; for (const r of [2.5, 7, 16, 36]) m = Math.max(m, (gH(x + cx * r, z + cz * r) - h) / r); occ += Math.atan(Math.max(0, m)); }
  return [vis * vis * (3 - 2 * vis), 1 - clamp(occ / 8 * 1.5, 0, .55)];
}
const BK = new Float32Array(GN * GN); // sun visibility on the grid (bugs use it too)
function sunVis(x, z) { const fx = (x + GE) / GS, fz = (z + GE) / GS; if (fx < 0 || fz < 0 || fx >= GN - 1 || fz >= GN - 1) return 1; const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  return mix(mix(BK[j * GN + i], BK[j * GN + i + 1], u), mix(BK[(j + 1) * GN + i], BK[(j + 1) * GN + i + 1], u), v); }
const groundM = new THREE.MeshStandardMaterial({map: sandTex, normalMap: SAND.nrm, roughnessMap: SAND.rgh, roughness: 1, metalness: 0, vertexColors: true});
groundM.normalScale.set(1, 1);
const detailT = ltex('../tex/ground_c.jpg', false);
function bakedShader(sh, ground) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 bake; varying vec2 vBake; varying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake; vWp = (modelMatrix * vec4(position, 1.)).xyz;');
  let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vBake; varying vec3 vWp;' + (ground ? ' uniform sampler2D detail;' : ''));
  if (ground) { sh.uniforms.detail = {value: detailT};
    f = f.replace('#include <map_fragment>', `#include <map_fragment>
      float mm = dot(texture2D(map, vWp.xz * .0137).rgb, vec3(.3, .6, .1)) / .3; diffuseColor.rgb *= mix(1., mm, .35); // breaks up tiling
      float dl = texture2D(detail, vWp.xz * .8).r; diffuseColor.rgb *= .78 + dl * .5;
      vec3 wn = normalize(cross(dFdx(vWp), dFdy(vWp))); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.82, .66, .58), smoothstep(.93, .8, abs(wn.y))); // steep faces: darker, redder`); }
  sh.fragmentShader = f.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= vBake.x; reflectedLight.directSpecular *= vBake.x; reflectedLight.indirectDiffuse *= vBake.y;');
}
groundM.onBeforeCompile = sh => bakedShader(sh, true);
{
  const g = new THREE.PlaneGeometry(GE * 2, GE * 2, GN - 1, GN - 1); g.rotateX(-PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), h = gH(x, z); p.setY(i, h); groundCol(x, z, h, col, i * 3); uv.setXY(i, x / 7, z / 7); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  { const bk = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = bakeAt(x, z, p.getY(i), false); bk[i * 2] = r[0]; bk[i * 2 + 1] = r[1]; const gi = Math.round((x + GE) / GS), gj = Math.round((z + GE) / GS); if (gi >= 0 && gj >= 0 && gi < GN && gj < GN) BK[gj * GN + gi] = r[0]; } g.setAttribute('bake', new THREE.BufferAttribute(bk, 2)); }
  const m = new THREE.Mesh(g, groundM); m.receiveShadow = true; scene.add(m);
  const g2 = new THREE.PlaneGeometry(9000, 9000, 120, 120); g2.rotateX(-PI / 2);
  const p2 = g2.attributes.position, c2 = new Float32Array(p2.count * 3), uv2 = g2.attributes.uv;
  for (let i = 0; i < p2.count; i++) { const x = p2.getX(i), z = p2.getZ(i), h = H0(x, z) - 2.5; p2.setY(i, h); groundCol(x, z, h, c2, i * 3); uv2.setXY(i, x / 7, z / 7); }
  g2.setAttribute('color', new THREE.BufferAttribute(c2, 3)); g2.computeVertexNormals();
  { const bk = new Float32Array(p2.count * 2); for (let i = 0; i < p2.count; i++) { const r = bakeAt(p2.getX(i), p2.getZ(i), p2.getY(i), true); bk[i * 2] = r[0]; bk[i * 2 + 1] = .9; } g2.setAttribute('bake', new THREE.BufferAttribute(bk, 2)); }
  scene.add(new THREE.Mesh(g2, groundM));
}
// mesas: eroded, gullied, layered sandstone with baked strata colours and base occlusion; plus a far hazy range behind them
{
  const m = triMat(new THREE.MeshStandardMaterial({color: 0xffffff, vertexColors: true, roughness: 1}), ROCK.map, 1 / 14, .7, 'mesa', .5, 1e5);
  const C1 = [.62, .36, .24], C2 = [.78, .56, .4], C3 = [.4, .25, .19], C4 = [.7, .45, .3];
  const strata = (y, k) => { const b = Math.sin(y * .21 + Math.sin(y * .05 + k) * 2) * .5 + .5, b2 = Math.sin(y * .63 + k * 3) * .5 + .5; const A = b > .6 ? C2 : b < .25 ? C3 : C1; return [mix(A[0], C4[0], b2 * .3), mix(A[1], C4[1], b2 * .3), mix(A[2], C4[2], b2 * .3)]; };
  const mesa = (x, z, h, rt, i, sc) => {
    const g = new THREE.CylinderGeometry(rt, rt * rnd(1.2, 1.55), h, 40, 22); const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { const px = p.getX(k), y = p.getY(k), pz = p.getZ(k), an = Math.atan2(pz, px), yn = y / h + .5;
      let s = 1 + (fbm(Math.cos(an) * 2 + i, y * .03) - .5) * .55; s *= 1 - .09 * Math.pow(Math.abs(Math.sin(an * 7 + fbm(an * 2, i) * 4)), 4) * (1 - yn * .3); // gullies
      s *= 1 + .05 * Math.floor(Math.max(0, .5 - yn) * 6) / 3; // talus terraces toward the base
      p.setX(k, px * s); p.setZ(k, pz * s); if (y > h / 2 - 1) p.setY(k, y + (fbm(px * .03, pz * .03) - .5) * 12);
      const c = strata(y + h / 2, i), ao = .55 + .45 * smooth(yn * 4); col[k * 3] = c[0] * ao * sc; col[k * 3 + 1] = c[1] * ao * sc; col[k * 3 + 2] = c[2] * ao * sc; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * rt * .25, uv.getY(k) * h * .04);
    const me = new THREE.Mesh(g, m); me.position.set(x, h / 2 - 8 + H0(x, z) * .2, z); me.rotation.y = rnd(0, TAU); scene.add(me); };
  for (let i = 0; i < 16; i++) { const a = -1.9 + i * .24 + rnd(-.08, .08), r = rnd(900, 1700); mesa(Math.sin(a) * r, -Math.cos(a) * r, rnd(60, 190), rnd(60, 170), i, 1); }
  for (let i = 0; i < 7; i++) { const a = rnd(-1.3, 1.3), r = rnd(480, 700); mesa(Math.sin(a) * r, -Math.cos(a) * r, rnd(25, 55), rnd(20, 45), i + 30, 1); } // a few nearer buttes
  // far range: a ragged ridge line well beyond the mesas, mostly lost in the haze
  const N = 360, g = new THREE.BufferGeometry(), pos = [], idx = [];
  for (let i = 0; i <= N; i++) { const a = -PI + i / N * TAU, r = 3300 + fbm(i * .05, 7) * 600, top = 140 + Math.pow(fbm(i * .03, 2), 2) * 700 + fbm(i * .3, 5) * 60;
    pos.push(Math.sin(a) * r, -60, -Math.cos(a) * r, Math.sin(a) * r, top, -Math.cos(a) * r); if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: 0x6a4a3a, roughness: 1, side: THREE.DoubleSide})));
}
// rocks
{
  const g = new THREE.DodecahedronGeometry(1, 1), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const s = 1 + (h2(p.getX(k) * 9.1, p.getY(k) * 7.3 + p.getZ(k) * 3.1) - .5) * .45; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * .7, p.getZ(k) * s); }
  g.computeVertexNormals();
  { const c = new Float32Array(p.count * 3); for (let k = 0; k < p.count; k++) { const y = p.getY(k), ao = .45 + .55 * smooth(y * .8 + .55), n = .85 + h2(p.getX(k) * 5, p.getZ(k) * 5) * .3; c[k * 3] = ao * n; c[k * 3 + 1] = ao * n * .93; c[k * 3 + 2] = ao * n * .88; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  const N = 420, im = new THREE.InstancedMesh(g, triMat(new THREE.MeshStandardMaterial({color: 0x7a5c48, roughness: .9, vertexColors: true}), ROCK.map, .45, .9, 'rock', .5, 120), N), o = new THREE.Object3D();
  for (let i = 0; i < N; i++) { let x, z; do { x = rnd(-280, 280); z = rnd(-290, 60); } while (Math.hypot(x, z) < 22); const s = Math.random() < .1 ? rnd(2, 4) : rnd(.3, 1.3); o.position.set(x, gH(x, z) - s * .2, z); o.rotation.set(rnd(-.3, .3), rnd(0, 6), rnd(-.3, .3)); o.scale.setScalar(s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); const v = .55 + .45 * sunVis(x, z); im.setColorAt(i, new THREE.Color(v, v * .97, v * .95)); }
  im.castShadow = im.receiveShadow = true; scene.add(im);
}

// ---------------- particles
class Parts {
  constructor(n, tex, blend) {
    this.n = n; this.i = 0; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.sz = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.stick = new Uint8Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('col', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({uniforms: {map: {value: tex}, scale: {value: 600}}, transparent: true, depthWrite: false, blending: blend,
      vertexShader: 'attribute vec4 col; attribute float size; uniform float scale; varying vec4 vC; void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.); vC.a *= smoothstep(.6, 3., -mv.z); gl_PointSize = min(size * scale / max(-mv.z, .1), 160.); gl_Position = projectionMatrix * mv; }',
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
const DEC = pool(decGeo, new THREE.MeshStandardMaterial({map: splatT, transparent: true, depthWrite: false, roughness: .12, metalness: .1, color: 0x5c6a24, polygonOffset: true, polygonOffsetFactor: -4, emissive: 0x060a00}), 240);
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
const TRC = pool(trGeo, new THREE.MeshBasicMaterial({color: new THREE.Color(3.2, 1.9, .8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false}), 80);
const tracers = []; let trI = 0;
function addTracer(a, b) { trI = (trI + 1) % 80; const d = a.distanceTo(b); tracers[trI] = {ax: a.x, ay: a.y, az: a.z, dx: (b.x - a.x) / d, dy: (b.y - a.y) / d, dz: (b.z - a.z) / d, L: d, p: 0}; }
function stepTracers(dt) {
  const e = _m.elements;
  for (let i = 0; i < 80; i++) { const t = tracers[i]; if (!t) continue; t.p += 700 * dt;
    if (t.p > t.L + 6) { tracers[i] = null; TRC.setMatrixAt(i, ZERO); continue; }
    const p0 = Math.max(0, t.p - 7), p1 = Math.min(t.L, t.p);
    segMat(e, t.ax + t.dx * p0, t.ay + t.dy * p0, t.az + t.dz * p0, t.ax + t.dx * p1, t.ay + t.dy * p1, t.az + t.dz * p1, .013); TRC.setMatrixAt(i, _m); }
  TRC.instanceMatrix.needsUpdate = true;
}

// shell casings
const casGeo = new THREE.CylinderGeometry(.007, .007, .05, 6); casGeo.rotateZ(PI / 2);
const CAS = pool(casGeo, new THREE.MeshStandardMaterial({color: 0xffffff, metalness: .85, roughness: .3}), 160);
CAS.setColorAt(0, new THREE.Color(1, 1, 1));
const cases = []; let caI = 0;
function addCase(p, v) { caI = (caI + 1) % 160; cases[caI] = {x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, rx: 0, ry: rnd(0, 6), w: rnd(15, 40), t: 0, b: 0}; }
function stepCases(dt) {
  for (let i = 0; i < 160; i++) { const c = cases[i]; if (!c) continue; c.t += dt;
    if (c.t > 7) { cases[i] = null; CAS.setMatrixAt(i, ZERO); continue; }
    if (c.b < 4) { c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += c.w * dt;
      if (c.y < .01) { c.y = .01; if (c.vy < -1) { if (c.b < 2) Sfx.tink(c.x); c.vy *= -.35; c.vx *= .55; c.vz *= .55; c.w *= .5; c.b++; } else { c.b = 4; c.rx = 0; } } }
    const h = Math.max(0, 1 - c.t * 1.2);
    CAS.setColorAt(i, _v.set(.78 + h * .4, .58 + h * .15, .28));
    _o.position.set(c.x, c.y, c.z); _o.rotation.set(c.rx, c.ry, 0); _o.scale.setScalar(1); _o.updateMatrix(); CAS.setMatrixAt(i, _o.matrix); }
  CAS.instanceMatrix.needsUpdate = true; CAS.instanceColor.needsUpdate = true;
}

// ---------------- defensive position
const SLOTX = [0, -3.4, 3.4, -6.8, -9.6, 9.6]; // 0-3 squad gunners, 4-5 sentry pods
{
  const bag = new THREE.SphereGeometry(1, 12, 8), p = bag.attributes.position;
  for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setY(k, Math.sign(y) * Math.pow(Math.abs(y), .6)); }
  bag.scale(.32, .14, .2); bag.computeVertexNormals();
  const bm = new THREE.MeshStandardMaterial({map: burlapT, normalMap: BURL.nrm, roughness: .97, color: 0xf0e0c8}); burlapT.repeat.set(2, 1); BURL.nrm.repeat.set(2, 1);
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
  const plate = new THREE.MeshStandardMaterial({map: STEEL.map, normalMap: STEEL.nrm, roughnessMap: STEEL.rgh, metalness: .8, roughness: 1});
  for (const x of [-10, -5.1, 5.1, 10]) { const z = -1.3 - Math.pow(Math.abs(x) / 13, 2) * 2.2; box(1.4, 1.5, .08, x, .9, z - .35, -Math.atan(x / 13 * .35), plate); }
  // crates
  const crate = new THREE.MeshStandardMaterial({map: CRATE.map, normalMap: CRATE.nrm, roughnessMap: CRATE.rgh, roughness: 1, metalness: .25});
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
    fragmentShader: 'varying float vZ; void main(){ gl_FragColor = vec4(vec3(1., .92, .8) * .14 * pow(1. - vZ, 2.), 1.); }'});
  for (const x of [-16, 16]) { const b = new THREE.Mesh(g, m); b.position.set(x, 3.5, 1.5); scene.add(b); BEAMS.push({m: b, ph: Math.random() * 10, x});
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.4, .5, .6, 10), new THREE.MeshStandardMaterial({color: 0x222, emissive: 0xffeecc, emissiveIntensity: 3})); lamp.position.set(x, 3.5, 1.5); scene.add(lamp); }
}

// ---------------- warrior bugs
const BH = 1.5;
function bugBodyGeo(lo) {
  const parts = [];
  const add = (g, col, tf) => { g = g.toNonIndexed(); g.applyMatrix4(tf); const n = g.attributes.position.count, c = new Float32Array(n * 3); const C = new THREE.Color(col);
    const p = g.attributes.position; for (let i = 0; i < n; i++) { const shade = .85 + h2(p.getX(i) * 13, p.getZ(i) * 17 + p.getY(i) * 5) * .3; c[i * 3] = C.r * shade; c[i * 3 + 1] = C.g * shade; c[i * 3 + 2] = C.b * shade; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); parts.push(g); };
  const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const sph = () => lo ? new THREE.SphereGeometry(1, 7, 5) : new THREE.SphereGeometry(1, 14, 10), half = () => lo ? new THREE.SphereGeometry(1, 7, 3, 0, TAU, 0, PI * .5) : new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, PI * .5), cone = () => new THREE.ConeGeometry(1, 1, lo ? 4 : 6);
  const AMB = 0x8a5a2e, DRK = 0x2a1a10, MID = 0x5e3c20, BONE = 0xc9b998, BEL = 0x7a5a3c;
  // warrior bug, not a spider: slim armoured thorax, a long tapering tail that sweeps up behind, wedge head with big pincers
  const seg = [[-.5, .32, .3, .08], [-.85, .3, .27, .2], [-1.18, .26, .23, .34], [-1.48, .21, .18, .5], [-1.74, .16, .13, .68], [-1.95, .11, .09, .86]];
  seg.forEach(([z, r, w, dy], i) => { const y = BH + dy, tilt = -.35 - i * .08; add(sph(), i % 2 ? BEL : AMB, M(0, y - .03, z, w, r * .85, .24, tilt)); add(half(), DRK, M(0, y, z + .02, w * 1.06, r, .23, tilt - .05)); if (!lo || i % 2 === 0) add(cone(), DRK, M(0, y + r * .85, z + .03, .04, .18, .06, -.9)); });
  add(cone(), DRK, M(0, BH + 1.02, -2.12, .06, .42, .06, -2.1)); // tail spike
  // thorax: armoured, narrow, with a raised spine plate
  add(sph(), AMB, M(0, BH, 0, .3, .3, .55)); add(half(), DRK, M(0, BH + .04, -.02, .33, .36, .56, -.04));
  for (const z of [.25, -.05, -.32]) add(cone(), DRK, M(0, BH + .38, z, .05, .24, .08, -.5));
  // head: long wedge, low and forward
  add(sph(), MID, M(0, BH - .05, .5, .2, .2, .2)); add(sph(), AMB, M(0, BH - .14, .78, .22, .18, .36, .3)); add(half(), DRK, M(0, BH - .08, .76, .24, .17, .37, .4));
  if (!lo) for (const s of [-1, 1]) add(sph(), 0x0a0605, M(s * .15, BH - .06, .9, .05, .04, .05));
  // pincers: two long curved outer jaws plus two short inner ones
  for (const s of [-1, 1]) {
    add(cone(), MID, M(s * .17, BH - .22, 1.02, .07, .34, .07, PI / 2 + .35, 0, -s * .55));
    add(cone(), BONE, M(s * .26, BH - .36, 1.3, .045, .44, .045, PI / 2 + .45, 0, s * .6));
    if (!lo) add(cone(), BONE, M(s * .07, BH - .3, 1.08, .03, .26, .03, PI / 2 + .6, 0, -s * .2));
  }
  if (!lo) { // close-up detail: overlapping armour, lateral spikes, spiracles, belly plates, jaw serrations, eye clusters, palps, neck tendons, crest
    const cyl = () => new THREE.CylinderGeometry(1, 1, 1, 6), SPI = 0x14100c, CRE = 0x3a2416;
    for (const [z, sc] of [[.32, 1], [.1, 1.05], [-.14, 1], [-.36, .9]]) { add(half(), z > 0 ? DRK : CRE, M(0, BH + .12 - Math.abs(z) * .08, z, .31 * sc, .28 * sc, .17, -.35)); add(cone(), BONE, M(0, BH + .36, z - .04, .025, .12, .04, -.7)); }
    for (const s of [-1, 1]) { // thorax side plates + spiracles
      add(sph(), CRE, M(s * .27, BH - .02, .05, .08, .2, .42, 0, 0, s * .25));
      for (const z of [.2, -.05, -.3]) add(sph(), SPI, M(s * .29, BH - .08, z, .025, .035, .035));
    }
    seg.forEach(([z, r, w, dy], i) => { const y = BH + dy; if (i > 4) return;
      for (const s of [-1, 1]) { add(cone(), DRK, M(s * w * .95, y + .02, z - .02, .03, .2 * (1 - i * .12), .04, -.9, 0, -s * 1.15)); add(sph(), SPI, M(s * w * .85, y - r * .3, z, .02, .03, .03)); }
      add(sph(), BEL, M(0, y - r * .62, z + .02, w * .75, .05, .17, -.35 - i * .08)); });
    for (const z of [.2, -.1]) add(sph(), BEL, M(0, BH - .25, z, .2, .07, .2));
    add(cone(), DRK, M(0, BH + .08, .78, .05, .5, .07, PI / 2 + .35)); // head crest
    for (const s of [-1, 1]) {
      for (const [ex, ey, ez, r] of [[.11, -.02, .97, .028], [.18, -.1, .93, .022], [.08, -.1, 1.0, .018]]) add(sph(), 0x050302, M(s * ex, BH + ey, ez, r, r * .8, r));
      for (let k = 0; k < 4; k++) { const t = .25 + k * .17; add(cone(), BONE, M(s * mix(.2, .33, t), BH - mix(.27, .5, t), mix(1.1, 1.55, t), .014, .07, .014, PI / 2 + .45, 0, -s * 1.3)); } // serrations
      add(cone(), MID, M(s * .07, BH - .32, .92, .02, .3, .02, PI / 2 + 1.05, 0, -s * .3)); // palp
      const nk = new THREE.Vector3(s * .12, BH + .05, .28), hd = new THREE.Vector3(s * .1, BH - .05, .62), d = hd.clone().sub(nk), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      add(cyl(), 0x6a4630, new THREE.Matrix4().compose(nk.clone().add(hd).multiplyScalar(.5), q, new THREE.Vector3(.025, d.length(), .025))); // neck tendon
    }
  }
  const g = new THREE.BufferGeometry(); let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
function legGeo(rt, rb, c0, c1) { const g = new THREE.CylinderGeometry(rt, rb, 1, 7, 3); g.translate(0, .5, 0); const p = g.attributes.position, c = new Float32Array(p.count * 3), A = new THREE.Color(c0), B = new THREE.Color(c1);
  for (let i = 0; i < p.count; i++) { const t = p.getY(i); c[i * 3] = mix(A.r, B.r, t); c[i * 3 + 1] = mix(A.g, B.g, t); c[i * 3 + 2] = mix(A.b, B.b, t); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
function legGeoHi(prof, c0, c1, barbs) { // lathe along +y 0..1 (radius profile), with small barbs; vertex colour graded along the leg
  const g0 = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 9).toNonIndexed(), parts = [g0];
  for (const [y, sz, ax] of barbs) { const b = new THREE.ConeGeometry(.045 * sz, .12 * sz, 5).toNonIndexed(); b.rotateZ(-PI / 2 + .5); b.rotateY(ax); b.translate(Math.cos(ax) * .1, y, -Math.sin(ax) * .1); parts.push(b); }
  let n = 0; for (const p of parts) { p.deleteAttribute('uv'); n += p.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), A = new THREE.Color(c0), B = new THREE.Color(c1); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  for (let i = 0; i < n; i++) { const t = clamp(pos[i * 3 + 1], 0, 1), sh = .85 + h2(pos[i * 3] * 40, t * 31) * .3; col[i * 3] = mix(A.r, B.r, t) * sh; col[i * 3 + 1] = mix(A.g, B.g, t) * sh; col[i * 3 + 2] = mix(A.b, B.b, t) * sh; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeBoundingSphere(); return g;
}
const MAXB = 1100, NEARB = 260, NEAR_D = 48;
const bugMat = triMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .42, metalness: .08}), CHIT.map, .35, .18, 'chitin', .2, 25);
const legMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .45, metalness: .08}); // legs are stretched cylinders: no triplanar detail
const BODY = pool(bugBodyGeo(false), bugMat, NEARB, true);   // detailed bodies, closest bugs
const BODYL = pool(bugBodyGeo(true), bugMat, MAXB, false);   // low-poly bodies, everything else
const LUP = pool(legGeo(.09, .15, 0x4e3018, 0x2a1a10), legMat, MAXB * 6, true);
const LLO = pool(legGeo(.008, .11, 0x2a1a10, 0xa89878), legMat, MAXB * 6, true);
// near bugs get jointed, muscled, barbed legs
const LUPH = pool(legGeoHi([[0, 0], [0, .12], [.08, .15], [.3, .19], [.5, .17], [.75, .11], [.9, .1], [.96, .14], [1, .1], [1.02, 0]], 0x5a3a1e, 0x24160c, [[.35, 1, PI / 2], [.55, .8, PI / 2], [.72, .6, PI / 2]]), legMat, NEARB * 6, true);
const LLOH = pool(legGeoHi([[0, 0], [0, .1], [.03, .13], [.07, .1], [.15, .09], [.45, .065], [.75, .04], [.92, .02], [1, .002]], 0x24160c, 0xb8a888, [[.25, .7, PI / 2], [.45, .55, PI / 2], [.62, .4, -PI / 2]]), legMat, NEARB * 6, true);
for (let i = 0; i < NEARB; i++) BODY.setColorAt(i, new THREE.Color(1, 1, 1));
for (let i = 0; i < MAXB; i++) BODYL.setColorAt(i, new THREE.Color(1, 1, 1));
const SHD = pool((() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return g; })(), new THREE.MeshBasicMaterial({map: soft, color: 0x000000, transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}), MAXB, false);
const DRAW = {n: 0, nl: 0, legs: 0, lh: 0, sh: 0};
function drawBegin() { DRAW.n = DRAW.nl = DRAW.legs = DRAW.lh = DRAW.sh = 0; }
function drawEnd() { BODY.count = DRAW.n; BODYL.count = DRAW.nl; LUP.count = LLO.count = DRAW.legs; SHD.count = DRAW.sh; SHD.instanceMatrix.needsUpdate = true; LUPH.count = LLOH.count = DRAW.lh; LUPH.instanceMatrix.needsUpdate = LLOH.instanceMatrix.needsUpdate = true;
  for (const m of [BODY, BODYL, LUP, LLO]) m.instanceMatrix.needsUpdate = true; BODY.instanceColor.needsUpdate = BODYL.instanceColor.needsUpdate = true; }
// corpse piles: settled corpses raise a coarse height grid; live bugs climb over them and fresh corpses land on top
const PILE = new Map(), pileK = (x, z) => (Math.floor(x / 1.4) + 1000) * 4000 + Math.floor(z / 1.4) + 1000;
function pileAt(x, z) { return PILE.get(pileK(x, z)) || 0; }
// legs: 0-3 walking, 4-5 claws. [side, hipZ, footZ]
const LEGS = [[1, .2, 1.5], [-1, .2, 1.5], [1, -.3, -1.75], [-1, -.3, -1.75]];
const TYPES = [
  {s: 1, hp: 2, sp: 1, tint: [1, 1, 1], dps: 2.2, gib: .4},
  {s: .78, hp: 1, sp: 1.4, tint: [1.1, .95, .78], dps: 1.6, leap: 1, gib: .6},
  {s: 2.1, hp: 20, sp: .72, tint: [.85, .6, .5], dps: 10, gib: 0},
  {s: .92, hp: 4, sp: .85, tint: [.7, 1.3, .5], dps: 0, spit: 1, gib: .35},      // 3 spitter (wave 4+): squats at ~42 m and lobs acid at the line
  {s: 1.15, hp: 6, sp: 1.2, tint: [.95, .72, .55], dps: 5, burrow: 1, gib: .3},  // 4 burrower (wave 6+): tunnels in under the sand, erupts at ~28 m
  {s: 4.3, hp: 300, sp: .4, tint: [.72, .4, .5], dps: 18, titan: 1, gib: 0, legOff: .004}, // 5 hive titan: the finale every 5 waves
];
const bugs = []; // active bugs (alive or corpse)
const freeIdx = []; for (let i = MAXB - 1; i >= 0; i--) freeIdx.push(i);
const byId = new Map(); let nextId = 1;
function spawnBug(type, x, z, id) {
  if (!freeIdx.length) { const c = bugs.find(q => q.dead); if (!c) return null; freeBug(c); } // pool full: recycle the oldest corpse
  const T = TYPES[type];
  const b = {idx: freeIdx.pop(), id: id || nextId++, type, T, s: T.s * rnd(.92, 1.1), x, z, y: gH(x, z), vy: 0, yaw: Math.atan2(-x, -z), hp: T.hp, hp0: T.hp, st: T.burrow ? 3 : 0, ph: rnd(0, TAU), t: 0, flash: 0, legs: 63, tx: rnd(-11, 11), weave: rnd(.2, .7), wf: rnd(.5, 1.5),
    sp: 0, dead: 0, atkT: rnd(0, 1), leapT: 0, roll: 0, pitch: 0, twitch: rnd(0, 10), nx: x, nz: z, nyaw: 0};
  b.nyaw = b.yaw; bugs.push(b); byId.set(b.id, b); return b;
}
function freeBug(b) { const i = bugs.indexOf(b); if (i >= 0) bugs.splice(i, 1); byId.delete(b.id); freeIdx.push(b.idx); }
const bm4 = new THREE.Matrix4(), bp = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3(), foot = new THREE.Vector3();
function drawBug(b, time) {
  if (b.gib || b.st === 3) return;
  const s = b.s, dead = b.dead > 0, dt = b.dead, hk = b.hk || 0;
  // alive: lean toward the side that lost legs (limp); dead: tumble toward b.droll
  const lean = dead ? 0 : (((b.legs & 1) ? 0 : 1) + ((b.legs & 4) ? 0 : 1) - ((b.legs & 2) ? 0 : 1) - ((b.legs & 8) ? 0 : 1)) * .16;
  const roll = b.roll + lean + (dead ? 0 : Math.sin(b.t * 31) * hk * .08), lift = dead ? mix(1, .38, smooth(dt * 2.5)) : 1;
  const bob = dead ? 0 : Math.sin(b.ph * 2) * .08 * Math.min(1, b.sp / 4);
  const sink = dead && dt > 6 ? (dt - 6) * .6 : 0;
  // a hit snaps the head up and shoves the body back a little
  _e.set(b.pitch - hk * .3 + (b.st === 1 ? -.35 - Math.max(0, Math.sin(b.t * 7)) * .25 : 0), b.yaw + (b.dyaw || 0), roll, 'YXZ'); _q.setFromEuler(_e);
  const kb = hk * .14 * s; bp.set(b.x - Math.sin(b.yaw) * kb, b.y + (dead ? 0 : b.py || 0) + (BH * lift + bob) * s - sink, b.z - Math.cos(b.yaw) * kb);
  bm4.compose(bp, _q, _s.set(s, s, s)); bm4.multiply(_m.makeTranslation(0, -BH, 0));
  const near = (b.x - P.x) ** 2 + b.z * b.z < NEAR_D * NEAR_D * Math.max(1, s) && DRAW.n < NEARB, BM = near ? BODY : BODYL, bi = near ? DRAW.n++ : DRAW.nl++;
  BM.setMatrixAt(bi, bm4);
  const fl = b.flash, T = b.T.tint, sv = .5 + .5 * sunVis(b.x, b.z); BM.setColorAt(bi, _v.set(T[0] * sv + fl * .8, T[1] * sv + fl * .9, T[2] * sv + fl * .5)); // in a dune's shadow = darker
  if (sink < .3) { const gy = gH(b.x, b.z) + (b.py || 0), up = Math.max(0, bp.y - BH * s * lift - gy), f = 1 / (1 + up * .3); // soft contact shadow
    _e.set(0, b.yaw + (b.dyaw || 0), 0); _q.setFromEuler(_e); _m.compose(_v2.set(b.x, gy + .05, b.z), _q, _s.set(2.6 * s * f, 1, 4.2 * s * f)); SHD.setMatrixAt(DRAW.sh++, _m); _s.set(s, s, s); }
  const e = _m.elements, stride = .7, liftH = .5;
  for (let k = 0; k < 6; k++) {
    if (!(b.legs & (1 << k))) continue;
    const hi = near && DRAW.lh < NEARB * 6, ui = hi ? DRAW.lh++ : DRAW.legs++, LU = hi ? LUPH : LUP, LL = hi ? LLOH : LLO;
    let sd, hx, hy, hz, fx, fy, fz, kx, ky, kz;
    if (k < 4) {
      const L = LEGS[k]; sd = L[0]; const ph = b.ph + (k === 0 || k === 3 ? 0 : PI);
      hx = sd * .26; hy = BH + .12; hz = L[1]; const fr = k < 2 ? 1 : -1;
      if (dead) { const th = b.thr && dt < b.thr, tw = Math.sin(time * (th ? 11 : 18) + b.twitch + k * 1.7) * (th ? .9 * (1 - dt / b.thr) + .2 : Math.max(0, 1 - dt / 4) * .25); const c = smooth(dt * 1.5);
        fx = sd * mix(1.15, .5, c); fy = mix(0, BH + 1.3, c) + tw; fz = L[2] * mix(1, .4, c); kx = sd * mix(.7, .8, c); ky = BH + mix(1.1, 1.5, c); kz = hz + fr * mix(.55, .3, c); }
      else if (b.st === 2) { fx = sd * 1.0; fy = .3; fz = L[2] + fr * .5; kx = sd * .75; ky = BH + 1.0; kz = hz + fr * .7; }
      else { // stance (foot planted, sliding back at body speed) 60% of the cycle, quick lifted swing forward 40%
        const u = ((ph / TAU) % 1 + 1) % 1; let sw, up; if (u < .6) { sw = stride * (1 - 2 * u / .6); up = 0; } else { const v = (u - .6) / .4; sw = stride * (-1 + 2 * smooth(v)); up = Math.sin(v * PI) * liftH; }
        sw *= Math.min(1, b.sp / 3 + .15); up *= Math.min(1, b.sp / 3 + .1);
        fx = sd * 1.0; fy = up; fz = L[2] + sw; kx = sd * .6; ky = BH + 1.3 + up * .4; kz = hz + fr * .5 + sw * .3; }
    } else {
      sd = k === 4 ? 1 : -1; hx = sd * .2; hy = BH + .1; hz = .42;
      const a = b.st === 1 ? Math.sin(b.t * 7 + (sd > 0 ? 0 : 1.6)) : Math.sin(b.ph + (sd > 0 ? 0 : PI)) * .3;
      if (dead) { const c = smooth(dt * 1.5), tw = Math.sin(time * (b.thr && dt < b.thr ? 9 : 15) + b.twitch * 2 + k) * (b.thr && dt < b.thr ? 1.1 * (1 - dt / b.thr) + .2 : Math.max(0, 1 - dt / 4) * .3); kx = sd * .5; ky = BH + .6 * c + .6; kz = .7; fx = sd * .25; fy = BH + 1.2 * c + tw; fz = 1.2 - c * .5; }
      else { const at = b.st === 1 ? Math.max(0, a) : 0; kx = sd * .42; ky = BH + 1.0 + a * .25; kz = .75 + a * .1; fx = sd * .2; fy = BH + .35 - at * 1.4 + (b.st === 1 ? 0 : a * .2); fz = 1.55 + a * .2 + at * .35; }
    }
    hip.set(hx, hy, hz).applyMatrix4(bm4); knee.set(kx, ky, kz).applyMatrix4(bm4); foot.set(fx, fy, fz).applyMatrix4(bm4);
    segMat(e, hip.x, hip.y, hip.z, knee.x, knee.y, knee.z, s * (k < 4 ? 1 : 1.25) * (hi ? .8 : 1)); LU.setMatrixAt(ui, _m);
    segMat(e, knee.x, knee.y, knee.z, foot.x, foot.y, foot.z, s * (k < 4 ? 1.15 : 1.6) * (hi ? .85 : 1)); LL.setMatrixAt(ui, _m);
  }
}
function bugCenter(b, out) { return out.set(b.x, b.y + (b.dead ? 0 : b.py || 0) + BH * b.s * (b.dead ? .5 : 1), b.z); }

// ---------------- gun model
function makeGun(fp) {
  const G = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color: 0x3a3f45, metalness: .85, roughness: .38});
  const dark = new THREE.MeshStandardMaterial({color: 0x1b1d20, metalness: .7, roughness: .5});
  const olive = new THREE.MeshStandardMaterial({color: 0x45503a, metalness: .3, roughness: .6});
  const brass = new THREE.MeshStandardMaterial({color: 0xb08a3a, metalness: .9, roughness: .3});
  const glow = new THREE.MeshStandardMaterial({color: 0x0c1414, emissive: 0x0a3a36, metalness: .2, roughness: .15});
  const barrelM = new THREE.MeshStandardMaterial({color: 0x2a2c30, metalness: .9, roughness: .32, emissive: 0x000000});
  const decal = new THREE.MeshStandardMaterial({map: markT, metalness: .6, roughness: .45});
  const add = (geo, m, x, y, z, rx, ry, rz, par) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx || 0, ry || 0, rz || 0); (par || G).add(me); return me; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (r1, r2, l, n) => new THREE.CylinderGeometry(r1, r2, l, n || 16);
  const RB = (w, h, d, r = .01) => { const hw = w / 2 - r, hh = h / 2 - r, sh = new THREE.Shape(); // rounded, bevelled box (no hard CG edges)
    sh.moveTo(-hw, -h / 2); sh.lineTo(hw, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh); sh.lineTo(w / 2, hh); sh.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
    sh.lineTo(-hw, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh); sh.lineTo(-w / 2, -hh); sh.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
    const g = new THREE.ExtrudeGeometry(sh, {depth: Math.max(.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * .5, bevelSegments: 2, curveSegments: 3}); g.translate(0, 0, -(d - 2 * r) / 2); return g; };
  const worn = new THREE.MeshStandardMaterial({color: 0x4a4f55, metalness: .8, roughness: .5}), poly = new THREE.MeshStandardMaterial({color: 0x2c2f2a, metalness: .1, roughness: .8});
  const red = new THREE.MeshBasicMaterial({color: new THREE.Color(4, .4, .2)}), glass = new THREE.MeshStandardMaterial({color: 0x203030, metalness: .9, roughness: .05, transparent: true, opacity: .35});
  const bolt = (x, y, z, rx, ry, rz, r = .007) => add(C(r, r, .008, 6), metal, x, y, z, rx, ry, rz);
  // receiver: bevelled body, top rail with cross slots, side panels with decal, bolts
  add(RB(.17, .18, .5, .02), worn, 0, 0, -.28); add(RB(.15, .05, .44, .012), dark, 0, -.1, -.3);
  add(RB(.07, .025, .46, .006), dark, 0, .102, -.3); for (let i = 0; i < 15; i++) add(B(.074, .008, .012), dark, 0, .118, -.08 - i * .03);
  for (const s of [-1, 1]) { add(new THREE.PlaneGeometry(.42, .1), decal, s * .0895, -.01, -.3, 0, s * PI / 2); add(RB(.012, .13, .34, .004), dark, s * .092, .01, -.3, 0, 0, 0);
    for (const z of [-.08, -.5]) for (const y of [-.06, .06]) bolt(s * .093, y, z, 0, 0, PI / 2); }
  add(B(.03, .03, .3), glow, .0, .135, -.3); add(B(.012, .04, .02), glow, .088, .05, -.1);
  // ejection port with a spring-loaded cover
  add(B(.004, .05, .09), new THREE.MeshStandardMaterial({color: 0x050505, roughness: 1}), .0915, -.02, -.22); add(B(.006, .055, .095), metal, .097, .015, -.22, 0, 0, -.5);
  // motor housing at the back: finned cylinder, end cap with bolt circle, power cable
  add(C(.072, .072, .2, 24), dark, 0, 0, -.0, PI / 2); for (let i = 0; i < 7; i++) add(C(.085, .085, .008, 24), worn, 0, 0, .07 - i * .024, PI / 2);
  add(C(.06, .065, .03, 24), metal, 0, 0, .115, PI / 2); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; bolt(Math.cos(a) * .045, Math.sin(a) * .045, .132, PI / 2, 0, 0, .006); }
  { const cv = new THREE.CatmullRomCurve3([new THREE.Vector3(-.05, -.05, .1), new THREE.Vector3(-.13, -.12, .08), new THREE.Vector3(-.2, -.2, -.02), new THREE.Vector3(-.21, -.2, -.1)]); add(new THREE.TubeGeometry(cv, 16, .012, 6), poly, 0, 0, 0); }
  // heat shroud: open half-shell over the barrels, rows of vent holes, side rails
  const shroud = new THREE.CylinderGeometry(.098, .098, .56, 28, 1, true, -PI * .62, PI * 1.24); add(shroud, worn, 0, 0, -.82, PI / 2, 0, 0).material.side = THREE.DoubleSide;
  const holeM = new THREE.MeshBasicMaterial({color: 0x050403});
  for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) { const a = (r - 1) * .55, z = -.58 - i * .055; const h = add(new THREE.CircleGeometry(.011, 10), holeM, Math.sin(a) * .0995, Math.cos(a) * .0995, z); h.lookAt(Math.sin(a) * 2, Math.cos(a) * 2, z); }
  add(B(.02, .07, .6), dark, .1, -.02, -.82); add(B(.02, .07, .6), dark, -.1, -.02, -.82);
  { const st = add(new THREE.PlaneGeometry(.12, .05), decal, .1115, -.02, -.95, 0, PI / 2); st.material = decal; }
  // barrel cluster (spins): six fluted barrels, rotor, mid clamp, muzzle clamp with a flash cage
  const bar = new THREE.Group(); bar.position.set(0, 0, -.5); G.add(bar);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, x = Math.cos(a) * .045, y = Math.sin(a) * .045; add(C(.015, .016, .78, 10), barrelM, x, y, -.39, PI / 2, 0, 0, bar);
    add(C(.0185, .0185, .03, 10), metal, x, y, -.77, PI / 2, 0, 0, bar); add(C(.006, .006, .02, 6), new THREE.MeshBasicMaterial({color: 0x000000}), x, y, -.79, PI / 2, 0, 0, bar); }
  add(C(.07, .07, .07, 24), metal, 0, 0, -.02, PI / 2, 0, 0, bar); add(C(.072, .072, .03, 6), dark, 0, 0, -.36, PI / 2, 0, 0, bar); add(C(.076, .076, .04, 6), worn, 0, 0, -.73, PI / 2, 0, 0, bar);
  for (let i = 0; i < 6; i++) { const a = (i + .5) / 6 * TAU; add(B(.008, .008, .05), dark, Math.cos(a) * .072, Math.sin(a) * .072, -.76, 0, 0, a, bar); }
  add(C(.02, .02, .8, 8), dark, 0, 0, -.39, PI / 2, 0, 0, bar);
  // carry handle, holo sight on the rail
  add(new THREE.TorusGeometry(.1, .016, 10, 20, PI), dark, 0, .13, -.32, 0, PI / 2, 0);
  add(RB(.05, .03, .09, .006), dark, 0, .135, -.12); add(RB(.06, .055, .012, .004), dark, 0, .175, -.155); add(RB(.06, .055, .012, .004), dark, 0, .175, -.085);
  add(new THREE.PlaneGeometry(.045, .04), glass, 0, .177, -.15); add(new THREE.CircleGeometry(.003, 8), red, 0, .18, -.149);
  // grips: ribbed front grip, rear pistol grip with trigger + guard
  add(new THREE.CapsuleGeometry(.024, .12, 4, 10), poly, 0, -.16, -.5, .2); for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(.025, .004, 6, 14), poly, 0, -.12 - i * .03, -.5 + i * .006, PI / 2 + .2);
  add(new THREE.CapsuleGeometry(.026, .1, 4, 10), poly, 0, -.15, -.02, -.25); add(B(.008, .04, .012), metal, 0, -.105, -.07, .3);
  add(new THREE.TorusGeometry(.04, .006, 6, 14, PI), dark, 0, -.1, -.07, 0, PI / 2, PI);
  // ammo drum: ribbed can with latch and handle, flexible feed chute to the receiver, brass belt
  add(C(.15, .15, .13, 28), olive, -.2, -.1, -.12, 0, 0, PI / 2); for (const x of [-.27, -.13]) add(C(.156, .156, .012, 28), dark, x, -.1, -.12, 0, 0, PI / 2);
  for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(.15, .004, 6, 32), dark, -.2 + (i - 1) * .035, -.1, -.12, 0, PI / 2, 0);
  add(B(.03, .03, .05), metal, -.2, .05, -.06); add(new THREE.TorusGeometry(.04, .007, 6, 14, PI), dark, -.2, .055, -.17, 0, PI / 2, 0);
  for (let i = 0; i < 7; i++) { const t = i / 6; add(RB(.05, .016, .04, .004), dark, mix(-.17, -.09, t), mix(.02, .03, t) + Math.sin(t * PI) * .035, mix(-.15, -.22, t), 0, 0, .3 - t * .4); }
  const belt = [];
  for (let i = 0; i < 9; i++) { const t = i / 8, x = mix(-.2, -.07, t), y = mix(.05, .02, t) + Math.sin(t * PI) * .05, z = mix(-.12, -.22, t); belt.push(add(C(.006, .006, .05, 8), brass, x, y, z, 0, 0, PI / 2 + .3)); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.3); G.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(.09, -.02, -.22); G.add(eject);
  // arms: armoured sleeves, gauntlets, fingers wrapped round the grips
  if (fp) {
    const arm = new THREE.MeshStandardMaterial({color: 0x3c4436, metalness: .35, roughness: .6}), plate = new THREE.MeshStandardMaterial({color: 0x59624d, metalness: .5, roughness: .45}), glove = new THREE.MeshStandardMaterial({color: 0x23261f, metalness: .1, roughness: .85});
    const mkArm = (hx, hy, hz, ex, ey, ez) => { const a = new THREE.Vector3(hx, hy, hz), b = new THREE.Vector3(ex, ey, ez), m = new THREE.Mesh(C(.06, .075, 1, 14), arm); const d = b.clone().sub(a); m.scale.y = d.length(); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); G.add(m);
      const p = new THREE.Mesh(RB(.15, .1, .2, .02), plate); p.position.copy(m.position); p.quaternion.copy(m.quaternion); p.scale.set(1, 1.6, 1); G.add(p); const s = new THREE.Mesh(B(.02, .05, .02), glow); s.position.copy(p.position).add(new THREE.Vector3(0, .07, 0)); G.add(s);
      const cuff = new THREE.Mesh(C(.08, .08, .05, 14), plate); cuff.position.copy(b).addScaledVector(d, -.06); cuff.quaternion.copy(m.quaternion); G.add(cuff); };
    mkArm(.2, -.5, .45, .02, -.17, -.0); mkArm(-.35, -.55, .2, -.02, -.19, -.48);
    for (const [gy, gz, tilt] of [[-.15, -.02, -.25], [-.16, -.5, .2]]) { add(RB(.08, .09, .1, .015), glove, 0, gy + .02, gz + .045, tilt);
      for (let i = 0; i < 4; i++) add(new THREE.CapsuleGeometry(.013, .05, 3, 8), glove, .022, gy - .035 + i * .024, gz - .028 + i * Math.sin(tilt) * .02, PI / 2, 0, 0);
      add(new THREE.CapsuleGeometry(.014, .045, 3, 8), glove, -.03, gy + .03, gz - .02, PI / 2 - .4, 0, .3); }
  }
  G.userData = {bar, barrelM, muzzle, eject, belt};
  // muzzle flash sprites
  const fl = []; for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: starT, color: new THREE.Color(2.6, 1.9, 1.1), blending: THREE.AdditiveBlending, depthWrite: false, fog: false})); s.visible = false; muzzle.add(s); fl.push(s); }
  const side = new THREE.Mesh(new THREE.PlaneGeometry(.5, .12), new THREE.MeshBasicMaterial({map: starT, color: new THREE.Color(2, 1.4, .7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false})); side.visible = false; muzzle.add(side);
  G.userData.fl = fl; G.userData.side = side;
  G.traverse(o => { if (o.isMesh) o.castShadow = !fp; });
  return G;
}
// first-person rig
const gunRoot = new THREE.Group(); cam.add(gunRoot);
const FPG = makeGun(true); gunRoot.add(FPG);
const RIF = makeRifle(); RIF.scale.setScalar(.82); gunRoot.add(RIF);
const MOUNT = makeGun(false); MOUNT.position.set(0, 1.32, -.25); MOUNT.visible = false; scene.add(MOUNT);
{ const tm = new THREE.MeshStandardMaterial({color: 0x2a2d30, metalness: .7, roughness: .5}); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU, l = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, 1.45, 8), tm); l.position.set(Math.sin(a) * .28, -.66, Math.cos(a) * .28 + .1); l.rotation.set(Math.cos(a) * .22, 0, -Math.sin(a) * .22); MOUNT.add(l); } }
FPG.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material.envMapIntensity = .3; o.material.roughness = Math.max(o.material.roughness, .62); o.material.metalness = Math.min(o.material.metalness, .6); } }); // close to the lens the sky reflections blew the gun out
const GUN_BASE = new THREE.Vector3(.2, -.27, -.42);
// survival: rifle in first person, and the cannon left standing on its mount when you walk off
function makeRifle() {
  const G = new THREE.Group(), dk = new THREE.MeshStandardMaterial({color: 0x1d2022, metalness: .6, roughness: .5}), pl = new THREE.MeshStandardMaterial({color: 0x3b4033, metalness: .1, roughness: .8}), mt = new THREE.MeshStandardMaterial({color: 0x45494e, metalness: .8, roughness: .4});
  const glove = new THREE.MeshStandardMaterial({color: 0x23261f, roughness: .85}), arm = new THREE.MeshStandardMaterial({color: 0x3c4436, metalness: .35, roughness: .6}), lens = new THREE.MeshStandardMaterial({color: 0x102a30, metalness: 1, roughness: .05, emissive: 0x041618});
  const RB = (w, h, d, r = .006) => { const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2); return g; };
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); G.add(me); return me; }, C = (a, b, l, n = 14) => new THREE.CylinderGeometry(a, b, l, n);
  add(RB(.055, .085, .36), dk, 0, 0, -.22); add(RB(.062, .07, .34), pl, 0, -.005, -.56); for (let i = 0; i < 5; i++) add(RB(.064, .012, .03), dk, 0, .02, -.45 - i * .055);
  add(C(.011, .011, .32), mt, 0, .005, -.88, PI / 2); add(C(.017, .017, .07), dk, 0, .005, -1.06, PI / 2); for (const s of [-1, 1]) add(RB(.004, .01, .03), new THREE.MeshBasicMaterial({color: 0}), s * .017, .005, -1.07);
  add(RB(.04, .15, .075), dk, 0, -.11, -.27, .22); add(RB(.034, .1, .045), pl, 0, -.08, -.08, -.35); add(RB(.05, .085, .22), pl, 0, -.015, .1); add(RB(.054, .1, .03), dk, 0, -.02, .215);
  add(RB(.03, .012, .3), dk, 0, .05, -.25); add(C(.022, .022, .13), dk, 0, .082, -.24, PI / 2); add(new THREE.CircleGeometry(.019, 16), lens, 0, .082, -.306, 0, PI); add(new THREE.CircleGeometry(.019, 16), lens, 0, .082, -.174);
  add(RB(.02, .02, .05), dk, 0, .055, -.2); add(RB(.02, .02, .05), dk, 0, .055, -.29);
  add(RB(.05, .06, .09), glove, 0, -.06, -.58); for (let i = 0; i < 4; i++) add(new THREE.CapsuleGeometry(.011, .04, 3, 6), glove, .024, -.045 - i * .002, -.61 + i * .022, 0, 0, PI / 2 - .3);
  add(RB(.05, .07, .07), glove, 0, -.08, -.06); add(new THREE.CapsuleGeometry(.011, .04, 3, 6), glove, .015, -.035, -.14, PI / 2, 0, 0);
  const mkArm = (a, b) => { const d = b.clone().sub(a), m = new THREE.Mesh(C(.05, .065, 1, 12), arm); m.scale.y = d.length(); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); G.add(m); };
  mkArm(new THREE.Vector3(-.28, -.42, -.1), new THREE.Vector3(-.01, -.07, -.56)); mkArm(new THREE.Vector3(.18, -.42, .3), new THREE.Vector3(.01, -.09, -.04));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, .005, -1.12); G.add(muzzle); const eject = new THREE.Object3D(); eject.position.set(.035, .01, -.2); G.add(eject);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({map: starT, color: new THREE.Color(2.4, 1.7, 1), blending: THREE.AdditiveBlending, depthWrite: false, fog: false})); fl.visible = false; muzzle.add(fl);
  G.userData = {muzzle, eject, fl, flT: 0}; G.traverse(o => { if (o.isMesh) o.castShadow = false; }); G.visible = false; return G;
}

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
    // heavier gun: a low body thump under each round, a rolling echo tail off the dunes when you let go
    this.B.thump = (() => { let ph = 0; return buf(.18, t => { ph += TAU * (52 + 60 * Math.exp(-t * 60)) / sr; return Math.sin(ph) * Math.exp(-t * 22) * 1.1 * Math.min(1, t * 900); }); })();
    this.B.tail = (() => { let lp = 0, lp2 = 0; return buf(2.6, t => { const n = Math.random() * 2 - 1; lp += (n - lp) * .05; lp2 += (lp - lp2) * .2; const e = Math.exp(-t * 1.7) * (1 + .5 * Math.sin(t * 9) * Math.exp(-t * 2)); return lp2 * 4 * e * Math.min(1, t * 20); }); })();
    // radio: a click, then band-limited noise chopped into syllables (sounds like garbled talk)
    this.B.radio = (() => { let a = 0, b = 0, env = 0, tgt = 0, nx = 0; return buf(2.4, (t, i) => { const n = Math.random() * 2 - 1; a += (n - a) * .35; b += (a - b) * .06; if (t > nx) { nx = t + rnd(.06, .16); tgt = Math.random() < .25 ? .1 : rnd(.5, 1); } env += (tgt - env) * .004;
      const click = t < .012 ? (Math.random() * 2 - 1) * 1.2 : 0, beep = t < .09 ? Math.sin(TAU * 1250 * t) * .25 : 0; return (a - b) * 2.4 * env * (t > .1 && t < 2.2 ? 1 : 0) * (1 - Math.max(0, t - 2) * 5) + click + beep; }); })();
    this.B.flyby = (() => { let lp = 0, lp2 = 0; return buf(5, t => { const n = Math.random() * 2 - 1; lp += (n - lp) * .08; lp2 += (lp - lp2) * .3; const e = Math.exp(-Math.pow((t - 2) / .9, 2)) + .15 * Math.exp(-Math.pow((t - 2) / 2, 2)); return (lp2 * 3 + Math.sin(TAU * (90 - t * 6) * t) * .2) * e; }); })();
    // low armour heartbeat (lub-dub) and the shield collapsing (a falling electric crackle)
    this.B.heart = (() => { let ph = 0; return buf(.5, t => { const k = t < .2 ? t : t - .22, a = t < .2 ? 1 : .7; ph += TAU * (46 + 30 * Math.exp(-k * 30)) / sr; return Math.sin(ph) * a * Math.exp(-k * 26) * Math.min(1, k * 600) * (t > .2 && t < .22 ? 0 : 1); }); })();
    this.B.shbrk = (() => { let ph = 0, y = 0; return buf(.7, t => { ph += TAU * (900 * Math.exp(-t * 5) + 70) / sr; if (Math.random() < .2) y = Math.random() * 2 - 1; return ((Math.sin(ph) > 0 ? .35 : -.35) * Math.exp(-t * 6) + y * .5 * Math.exp(-t * 9)) * Math.min(1, t * 300); }); })();
    this.B.shup = buf(.6, t => { const k = t < .12 ? t : t - .12; return Math.sin(TAU * (t < .12 ? 660 : 990) * t) * .22 * Math.exp(-k * 9) * Math.min(1, k * 400); }); // shield back to full
    this.B.conf = (() => { let ph = 0; return buf(.24, t => { const k = t < .06 ? t : t - .06; ph += TAU * (t < .06 ? 1180 : 1770) / sr; return (Math.sin(ph) + .3 * Math.sin(ph * 2)) * .2 * Math.exp(-k * 24) * Math.min(1, k * 700); }); })(); // kill confirm (special bugs)
    const noise = buf(2, () => Math.random() * 2 - 1);
    const loop = (filtType, f, q, g) => { const s = C.createBufferSource(); s.buffer = noise; s.loop = true; const fl = C.createBiquadFilter(); fl.type = filtType; fl.frequency.value = f; fl.Q.value = q; const gn = C.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(); return {fl, gn}; };
    this.wind = loop('lowpass', 380, .7, .14); this.roar = loop('bandpass', 240, .9, 0); this.hiss = loop('highpass', 2600, .7, 0); this.rattle = loop('bandpass', 1400, 2, 0);
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
  gun(spin, heat, vent, firing) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.roar.gn.gain.setTargetAtTime(firing ? .5 : 0, t, firing ? .03 : .12); this.roar.fl.frequency.setTargetAtTime(200 + heat * 120, t, .1);
    this.o1.frequency.setTargetAtTime(70 + spin * 380, t, .05); this.o2.frequency.setTargetAtTime(105 + spin * 570, t, .05); this.of.frequency.setTargetAtTime(400 + spin * 2400, t, .05);
    this.og.gain.setTargetAtTime(spin > .01 ? .025 + spin * .04 : 0, t, .08); this.rattle.gn.gain.setTargetAtTime(spin * .05, t, .05); this.rattle.fl.frequency.setTargetAtTime(900 + spin * 1500, t, .05);
    this.hiss.gn.gain.setTargetAtTime(vent ? .22 : heat > .8 ? (heat - .8) * .25 : 0, t, .06);
  },
};

// ---------------- game state
const P = {x: 0, z: 0, yaw: 0, pitch: -.04, spin: 0, heat: 0, vent: 0, firing: false, fireAcc: 0, shots: 0, fireT: 0,
  kick: 0, kickV: 0, gp: 0, gpV: 0, cp: 0, cpV: 0, cy: 0, cyV: 0, trauma: 0, ads: 0, swayX: 0, swayY: 0, swayVX: 0, swayVY: 0, fovP: 0, drift: 0, mdx: 0, bloom: 0};
const G = {on: false, paused: false, over: false, wave: 0, quota: 0, spawnAcc: 0, gap: 3, kills: 0, shield: 100, hp: 100, hurtT: 9, t: 0, sendT: 0, dmgFlash: 0, dmgDirs: [], hitT: 0, killT: 0, scores: {}, best: +(localStorage.getItem('ls-bestk') || 0), bestS: +(localStorage.getItem('ls-bestN') || 0), mode: 'horde', gunners: new Map()};
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

// aim assist: best bug in a tight cone around a gunner's yaw (tighter still while aiming down sights; guests send `a`)
const coneOf = g => .045 - .025 * (g.id === myId() ? P.ads : g.ads || 0);
function pickTarget(g) {
  const gx = SLOTX[g.slot]; let best = null, bs = 1e9;
  for (const b of bugs) { if (b.dead || b.st === 3) continue; const dx = b.x - gx, dz = b.z, d = Math.hypot(dx, dz); if (d > 190) continue;
    const a = Math.abs(angD(g.yaw, Math.atan2(-dx, -dz))), sz = Math.atan(1.1 * b.s / Math.max(d, 1)), cone = coneOf(g) + sz;
    if (a > cone) continue; const sc = Math.max(0, a - sz) * 30 + d / 150 - (b.st === 1 ? .15 : 0); if (sc < bs) { bs = sc; best = b; } }
  return best;
}
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), mz = new THREE.Vector3(), hitP = new THREE.Vector3(), hitP2 = new THREE.Vector3(), dirV = new THREE.Vector3();
function nearBug(p, not, r) { let best = null, bd = r * r; for (const b of bugs) { if (b.dead || b === not || b.st === 3) continue; const dx = b.x - p.x, dz = b.z - p.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = b; } } return best; }
function muzzleOf(g, out) {
  if (g.id === myId()) return (SURV() && P.foot ? RIF : FPG).userData.muzzle.getWorldPosition(out);
  if (g.model) return g.model.userData.gun.userData.muzzle.getWorldPosition(out);
  return out.set(SLOTX[g.slot], 1.4, -1);
}
// no aim assist for people: every round is a ray from the gunner's eye along yaw/pitch (+ a little spread) tested against
// each bug's hit spheres (thorax, head, tail). Rounds go through the first bug into a second one on the same line.
const RAYH = [];
function rayBugs(ox, oy, oz, dx, dy, dz) {
  RAYH.length = 0; let t1 = 1e9, b1 = null, t2 = 1e9, b2 = null;
  for (const b of bugs) { if (b.dead || b.st === 3) continue; const ex = b.x - ox, ez = b.z - oz, s = b.s, k0 = ex * dx + ez * dz; if (k0 < -4 * s || k0 > 230) continue;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), cy = b.y + (b.py || 0) + BH * s - oy; let best = 1e9;
    for (let i = 0; i < 3; i++) { const f = i === 0 ? 0 : i === 1 ? .8 : -1.15, up = i === 0 ? 0 : i === 1 ? -.12 : .35, r = (i === 0 ? .48 : i === 1 ? .36 : .44) * s;
      const cx = ex + fx * f * s, cyy = cy + up * s, cz = ez + fz * f * s, k = cx * dx + cyy * dy + cz * dz; if (k < 0) continue;
      const qx = cx - dx * k, qy = cyy - dy * k, qz = cz - dz * k, d2 = qx * qx + qy * qy + qz * qz; if (d2 > r * r) continue;
      const tt = k - Math.sqrt(r * r - d2); if (tt < best) best = tt; }
    if (best < t1) { t2 = t1; b2 = b1; t1 = best; b1 = b; } else if (best < t2) { t2 = best; b2 = b; } }
  if (b1) RAYH.push([b1, t1]); if (b2) RAYH.push([b2, t2]); return RAYH;
}
function fireShot(g, idx) {
  if (g.sentry) return fireShotAuto(g, idx);
  const local = g.id === myId(), ads = local ? P.ads : g.ads || 0, spr = (.006 + (local ? P.heat : g.heat || 0) * .006) * (1 - ads * .7);
  const foot = local && SURV() && P.foot, sp2 = foot ? (.003 + Math.min(1, P.fireT) * .006 + (P.moveL || 0) * .006) * (1 - ads * .75) : spr;
  const yw = g.yaw + rnd(-sp2, sp2), pt = g.pitch + rnd(-sp2, sp2), ox = foot ? P.x : SLOTX[g.slot], oy = foot ? P.eyeY : 1.7, oz = foot ? P.z : 0;
  const dx = -Math.sin(yw) * Math.cos(pt), dy = Math.sin(pt), dz = -Math.cos(yw) * Math.cos(pt);
  const hits = rayBugs(ox, oy, oz, dx, dy, dz);
  if (foot && TUN && !TUN.dead) { const c = TUN.core, ex = c.x - ox, ey = c.y - oy, ez = c.z - oz, k = ex * dx + ey * dy + ez * dz;
    if (k > 0) { const qx = ex - dx * k, qy = ey - dy * k, qz = ez - dz * k, q2 = qx * qx + qy * qy + qz * qz; if (q2 < c.r * c.r) { const tc = k - Math.sqrt(c.r * c.r - q2);
      if (!hits.length || tc < hits[0][1]) { muzzleOf(g, mz); hitP.set(ox + dx * tc, oy + dy * tc, oz + dz * tc); coreHit(hitP); shotTail(g, idx, local); return; } } } }
  const t = hits.length ? hits[0][0] : null; g.tgt = t;
  muzzleOf(g, mz);
  const mate = G.ff ? mateOnLine(g, t) : null;
  if (mate) friendlyHit(g, mate, local);
  else if (t) {
    for (let j = 0; j < hits.length; j++) { const [b, tt] = hits[j]; if (j && (foot ? !has('pierce') : Math.random() < .4)) break; const P2 = j ? hitP2 : hitP; P2.set(ox + dx * tt, oy + dy * tt, oz + dz * tt); hitFx(b, P2, local && !j, !!j); if (isHost()) damageBug(b, g, P2); }
    if (G.buff && G.buff.k === 1 && idx % 2 === 0) { let from = t; _sa.copy(hitP); for (let j = 0; j < 2; j++) { const o = nearBug(_sa, from, 9 + t.s * 2); if (!o || o === t) break; bugCenter(o, _sb); shockArc(_sa, _sb); hitFx(o, _sb, false); if (isHost()) damageBug(o, g, _sb); _sa.copy(_sb); from = o; } }
  } else {
    let d = 220; if (TUN && foot) d = Math.min(30, dy < -.01 ? (oy - UGY) / -dy : dy > .01 ? (UGY + 6 - oy) / dy : 30, 10 + Math.random() * 15); else if (dy < -.002) d = Math.min(220, (oy - gH(ox + dx * 60, oz + dz * 60)) / -dy);
    hitP.set(ox + dx * d, oy + dy * d, oz + dz * d); if (TUN && foot) dustFx(hitP); else if (d < 219) { hitP.y = gH(hitP.x, hitP.z); dustFx(hitP); }
  }
  shotTail(g, idx, local);
}
function fireShotAuto(g, idx) { // sentry pods keep their auto-targeting
  const ok = g.tgt && !g.tgt.dead && byId.has(g.tgt.id) && Math.abs(angD(g.yaw, Math.atan2(-(g.tgt.x - SLOTX[g.slot]), -g.tgt.z))) < coneOf(g) + Math.atan(1.1 * g.tgt.s / Math.max(1, Math.hypot(g.tgt.x - SLOTX[g.slot], g.tgt.z)));
  const t = ok ? g.tgt : (g.tgt = pickTarget(g));
  muzzleOf(g, mz); const local = g.id === myId();
  const mate = G.ff ? mateOnLine(g, t) : null;
  if (mate) friendlyHit(g, mate, local);
  else if (t) {
    // impact lands where the aim line crosses the bug (not a random spot on it), with a little dispersion
    bugCenter(t, hitP); { const ax = -Math.sin(g.yaw), az = -Math.cos(g.yaw), gx = SLOTX[g.slot], k = (hitP.x - gx) * ax + hitP.z * az, ox = gx + ax * k - hitP.x, oz = az * k - hitP.z, ol = Math.hypot(ox, oz), lim = .45 * t.s;
      if (ol > lim) { hitP.x += ox / ol * lim; hitP.z += oz / ol * lim; } else { hitP.x += ox; hitP.z += oz; } }
    hitP.x += rnd(-.12, .12) * t.s; hitP.y += rnd(-.15, .15) * t.s; hitP.z += rnd(-.12, .12) * t.s;
    hitFx(t, hitP, local);
    if (isHost()) damageBug(t, g, hitP);
    { let from = t; for (let j = 0; j < (Math.random() < .4 ? 2 : 1); j++) { const o = nearBug(hitP, from, 2.6 * t.s); if (!o) break; bugCenter(o, hitP2); hitFx(o, hitP2, false, true); if (isHost()) damageBug(o, g, hitP2); from = o; } }
    if (G.buff && G.buff.k === 1 && idx % 2 === 0) { let from = t; _sa.copy(hitP); for (let j = 0; j < 2; j++) { const o = nearBug(_sa, from, 9 + t.s * 2); if (!o || o === t) break; bugCenter(o, _sb); shockArc(_sa, _sb); hitFx(o, _sb, false); if (isHost()) damageBug(o, g, _sb); _sa.copy(_sb); from = o; } }
  } else {
    const d = rnd(30, 90), gx = SLOTX[g.slot]; hitP.set(gx - Math.sin(g.yaw + rnd(-.03, .03)) * d, 0, -Math.cos(g.yaw + rnd(-.03, .03)) * d); hitP.y = gH(hitP.x, hitP.z);
    dustFx(hitP);
  }
  shotTail(g, idx, local);
}
function shotTail(g, idx, local) {
  if (local && SURV() && P.foot) { // rifle
    if (idx % 3 === 0) addTracer(mz, hitP);
    Sfx.play('shot', {vol: .3, rate: 1.3, vr: .06}); Sfx.play('thump', {vol: .2, rate: 1.6}); if (idx % 2 === 0) Sfx.play('shot', {vol: .05, at: rnd(.15, .25), lp: 700, rate: .9});
    P.kickV += 2.4; P.gpV += 3; P.cpV += .9; P.cyV += rnd(-.6, .6); P.pitch = clamp(P.pitch + .006 * (1 - P.ads * .5), -1.35, 1.35); P.yaw += rnd(-.0025, .0025); P.trauma = Math.min(.5, P.trauma + .02);
    RIF.userData.eject.getWorldPosition(_v2); dirV.set(1, 0, 0).applyQuaternion(cam.quaternion); addCase(_v2, {x: dirV.x * rnd(1.5, 2.5), y: rnd(1.5, 2.5), z: dirV.z * rnd(1.5, 2.5) + rnd(0, .4)}); RIF.userData.flT = .04;
    for (let i = 0; i < 2; i++) PA.add(mz.x, mz.y, mz.z, rnd(-1, 1), rnd(-.5, 1), rnd(-1, 1), rnd(.03, .07), .05, .01, 3, 2, .8, 1); return; }
  if (local && SURV()) SV.belt = Math.max(0, SV.belt - 1);
  if (idx % (G.buff && G.buff.k === 0 ? 3 : 5) === 0) addTracer(mz, hitP);
  if (local) {
    Sfx.play('shot', {vol: .32, vr: .08}); if (idx % 2 === 0) Sfx.play('thump', {vol: .4, vr: .12}); if (idx % 4 === 0) Sfx.play('shot', {vol: .06, at: rnd(.12, .2), lp: 700, rate: .8});
    P.kickV += 1.5; P.gpV += 2.6; P.cpV += .45 + P.heat * .2; P.cyV += rnd(-.4, .4);
    // real recoil: the muzzle climbs and wanders, you hold it down
    P.pitch = clamp(P.pitch + .0008 * (1 - P.ads * .5), -.55, .4); P.yaw = clamp(P.yaw + rnd(-.0007, .0007), -1.5, 1.5);
    if (Math.random() < .35) { _v2.set(P.x + rnd(-.6, .6), 1.05, P.z - 1.1); PS.add(_v2.x, _v2.y, _v2.z, rnd(-.6, .6), rnd(.2, .9), rnd(-2.5, -.8), rnd(.8, 1.5), .15, .9, .6, .48, .36, .22, -.1, 1.2); } // muzzle blast lifts dust off the sandbags
    P.trauma = Math.min(.6, P.trauma + .008); P.bloom = Math.min((.35 + P.heat * .65) * (1 - P.ads * .6), P.bloom + .05); // crosshair opens with sustained fire and heat (the spread does too)
    FPG.userData.eject.getWorldPosition(_v2); dirV.set(1, 0, 0).applyQuaternion(cam.quaternion); addCase(_v2, {x: dirV.x * rnd(2, 3.5) + rnd(-.3, .3), y: rnd(1.8, 3), z: dirV.z * rnd(2, 3.5) + rnd(.2, .8)});
    if (Math.random() < .3) PS.add(mz.x, mz.y, mz.z, rnd(-.3, .3), rnd(.3, .9), rnd(-.3, .3), rnd(1, 2), .1, .6, .5, .45, .42, .18, -.2, .5);
  } else if (idx % 2 === 0) { const a = Sfx.at(mz.x, mz.z); Sfx.play('shot', {vol: .16 * a.vol, pan: a.pan, vr: .1, lp: 3000}); }
  for (let i = 0; i < 2; i++) PA.add(mz.x, mz.y, mz.z, rnd(-2, 2), rnd(-1, 2), rnd(-2, 2) - 3, rnd(.04, .1), .06, .01, 3, 2, .8, 1);
}
// friendly fire (host setting G.ff): a squadmate within 0.55 m of the aim line, nearer than the target, takes the round
function mateOnLine(g, t) {
  const gx = SLOTX[g.slot], ax = -Math.sin(g.yaw), az = -Math.cos(g.yaw), td = t ? Math.hypot(t.x - gx, t.z) : 1e9;
  for (const o of G.gunners.values()) { if (o === g || o.sentry) continue; const dx = SLOTX[o.slot] - gx, dz = .1, k = dx * ax + dz * az; if (k <= .3 || k > td) continue;
    if (Math.abs(dx * az - dz * ax) < .55) return o; }
  return null;
}
function friendlyHit(g, o, local) {
  hitP.set(SLOTX[o.slot] + rnd(-.15, .15), rnd(1.1, 1.6), .1 + rnd(-.1, .1));
  for (let i = 0; i < 4; i++) PA.add(hitP.x, hitP.y, hitP.z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), rnd(.08, .2), .05, .01, 3, 2, 1, 1, 12);
  if (Math.random() < .4) PG.add(hitP.x, hitP.y, hitP.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), .5, .08, .04, .45, .04, .03, .9, 14, .5, 1);
  if (Sfx.ctx && Sfx.lim('ff', 120)) { const a = Sfx.at(hitP.x, hitP.z); Sfx.play('tink', {vol: .6 * a.vol + .1, pan: a.pan, rate: rnd(.7, 1)}); }
  if (isHost()) { hurt(1.2); if (!o.ffT || G.t - o.ffT > 2) { o.ffT = G.t; G.evq.push(['f', g.slot, o.slot]); ffNote(g.slot, o.slot); } }
}
function ffNote(from, to) {
  const me = localGunner(); if (!me) return; const nm = s => { for (const q of G.gunners.values()) if (q.slot === s && !q.sentry) return q.name; return 'squadmate'; };
  if (me.slot === from) toast('FRIENDLY FIRE: you hit ' + nm(to)); else if (me.slot === to) { toast('FRIENDLY FIRE from ' + nm(from)); P.trauma = Math.min(1, P.trauma + .4); G.dmgFlash = Math.min(1, G.dmgFlash + .3); }
}
const SLIME = [[.5, .58, .16], [.62, .66, .24], [.4, .46, .1], [.72, .7, .36]];
function hitFx(b, p, local, minor) {
  const n = minor ? 2 : HI() ? 5 : 3; const toCam = _v.set(P.x - p.x, 1.7 - p.y, P.z - p.z).normalize();
  for (let i = 0; i < n; i++) { const c = SLIME[(Math.random() * 4) | 0], sp = rnd(2, 7);
    PG.add(p.x, p.y, p.z, toCam.x * sp * .5 + rnd(-3, 3), rnd(1, 6), toCam.z * sp * .5 + rnd(-3, 3), rnd(.8, 1.8), rnd(.06, .14) * b.s, rnd(.04, .09), c[0], c[1], c[2], .95, 14, .5, 1); }
  if (!minor) PG.add(p.x, p.y, p.z, rnd(-.5, .5), rnd(0, 1), rnd(-.5, .5), .2, .2 * b.s, .55 * b.s, .55, .6, .2, .5, 0, 2);
  if (Math.random() < .3) addChunk(p.x, p.y, p.z, rnd(.05, .12) * b.s, 5);
  b.flash = 1; b.hk = Math.min(1.2, (b.hk || 0) + (b.T.s > 2 ? .3 : .75));
  if (b.T.s > 2 && Math.random() < .5) for (let i = 0; i < 5; i++) PA.add(p.x, p.y, p.z, toCam.x * 4 + rnd(-4, 4), rnd(1, 5), toCam.z * 4 + rnd(-4, 4), rnd(.1, .25), .07, .02, 3, 1.8, .6, 1, 12);
  if (Sfx.ctx && Sfx.lim('sq', local ? 55 : 110)) { const a = Sfx.at(p.x, p.z); Sfx.play(Math.random() < .7 ? 'squelch' : 'crunch', {vol: .8 * a.vol + .06, pan: a.pan, rate: rnd(.8, 1.25)}); }
  if (local) { G.hitT = .12; }
}
function dustFx(p) {
  for (let i = 0; i < 3; i++) PS.add(p.x, p.y + .1, p.z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), rnd(.6, 1.4), .2, rnd(.8, 1.6), .62, .42, .28, .5, 1.5, 1.5);
  PA.add(p.x, p.y + .1, p.z, rnd(-3, 3), rnd(2, 5), rnd(-3, 3), .15, .08, .02, 3, 1.6, .5, 1, 12);
}
function damageBug(b, g, p) {
  b.hp -= 1; b.stag = b.T.titan ? 0 : b.T.s > 2 ? .15 : .35;
  if (b.T.s < 2 && b.st !== 2) { const dx = b.x - SLOTX[g.slot], dz = b.z, d = Math.hypot(dx, dz) || 1; b.x += dx / d * .04; b.z += dz / d * .04; }
  if (b.hp > 0 && Math.random() < (b.T.legOff ?? .14)) { const k = (Math.random() * 6) | 0; if (b.legs & (1 << k)) { b.legs &= ~(1 << k); legOffFx(b, k); if (isHost()) G.evq.push(['l', b.id, k]); } }
  if (b.hp <= 0) { killBug(b, g); }
}
function legOffFx(b, k) { const c = bugCenter(b, _v2); addChunk(c.x + rnd(-1, 1) * b.s, c.y, c.z, b.s * .8, 6, true); for (let i = 0; i < 8; i++) PG.add(c.x, c.y, c.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), rnd(.8, 1.5), .15 * b.s, .08, .5, .9, .1, .95, 14, .4, 1); }
function killBug(b, g) {
  if (b.dead) return; b.dead = .001; b.hp = 0; b.roll = 0; b.dyaw = 0; b.y += b.py || 0;
  // corpse keeps its momentum (slides forward, leapers fall out of the air), minus the knock-back of the rounds that killed it; some light bugs burst apart (gib)
  const fw = b.st === 1 ? 0 : Math.min(b.sp, 14) * .7, gx = g ? SLOTX[g.slot] : P.x, kx = b.x - gx, kz = b.z, kd = Math.hypot(kx, kz) || 1, kb = rnd(3.5, 7.5) / (b.s * b.s);
  b.dvx = Math.sin(b.yaw) * fw + kx / kd * kb + rnd(-.8, .8); b.dvz = Math.cos(b.yaw) * fw + kz / kd * kb + rnd(-.8, .8); b.dvy = b.st === 2 ? (b.vy || 0) : rnd(1.5, 3.8) / (b.s * Math.sqrt(b.s));
  b.droll = Math.random() < .65 ? PI * (Math.random() < .5 ? 1 : -1) : PI / 2 * (Math.random() < .5 ? 1 : -1); b.dspin = rnd(-4, 4);
  b.gib = Math.random() < b.T.gib ? 1 : 0; b.thr = !b.gib && Math.random() < .5 ? rnd(1.2, 2.6) : 0; // death throes: some thrash a while
  if (g) { g.kills++; G.kills++; if (g.id === myId()) myKill(b); if (isHost() && !G.over && !g.sentry) G.hp = Math.min(100, G.hp + .02); if (isHost() && !G.over && !g.sentry && (G.sup += 1 / ((140 + 20 * G.wave) * crewMul())) >= 1) { G.sup = 0; callIn(); } }
  if (isHost()) G.evq.push(['k', b.id, g ? g.slot : -1]);
  deathFx(b);
  if (b.T.titan) titanDown(b);
}
function deathFx(b) {
  const c = bugCenter(b, _v2), s = b.s, n = HI() ? 26 : 14;
  for (let i = 0; i < n; i++) { const col = SLIME[(Math.random() * 4) | 0], a = rnd(0, TAU), sp = rnd(1, 9) * Math.sqrt(s);
    PG.add(c.x, c.y, c.z, Math.cos(a) * sp, rnd(2, 9), Math.sin(a) * sp, rnd(1, 2.2), rnd(.12, .32) * s, rnd(.08, .2) * s, col[0], col[1], col[2], .95, 14, .4, 1); }
  for (let i = 0; i < 2; i++) PG.add(c.x, c.y, c.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), .45, .4 * s, 1.4 * s, .55, .6, .2, .45, 0, 3);
  for (let i = 0; i < 4 + s * 3; i++) addChunk(c.x, c.y, c.z, rnd(.08, .22) * s, 7);
  if (b.gib) { for (let k = 0; k < 6; k++) if (b.legs & (1 << k)) addChunk(c.x, c.y, c.z, s * (k < 4 ? .8 : .6), 8, true);
    for (let i = 0; i < 6; i++) addChunk(c.x, c.y, c.z, rnd(.15, .35) * s, 9);
    for (let i = 0; i < (HI() ? 30 : 14); i++) { const col = SLIME[(Math.random() * 4) | 0]; PG.add(c.x, c.y, c.z, rnd(-7, 7), rnd(3, 11), rnd(-7, 7), rnd(1, 2), rnd(.15, .4) * s, .1, col[0], col[1], col[2], .95, 14, .3, 1); }
    PS.add(c.x, c.y, c.z, 0, .8, 0, 1.4, .6 * s, 2.4 * s, .5, .55, .3, .25, 0, 1); }
  else if (Math.random() < .5) { b.legs &= ~(1 << ((Math.random() * 4) | 0)); addChunk(c.x, c.y, c.z, s * .8, 6, true); }
  if (b.type === 2 || b.type === 5) { for (let i = 0; i < 10; i++) PS.add(b.x + rnd(-1.5, 1.5), b.y + .3, b.z + rnd(-1.5, 1.5), rnd(-2, 2), rnd(.5, 2), rnd(-2, 2), rnd(1.2, 2.4), .6, 3, .55, .38, .25, .5, 0, 1.5);
    const d = Math.hypot(b.x - P.x, b.z - P.z); P.trauma = Math.min(1, P.trauma + clamp(1 - d / 60, 0, 1) * .5); if (d < 70 && b.type === 2) G.hs = .06;
    if (Sfx.ctx) { const a = Sfx.at(b.x, b.z); Sfx.play('boom', {vol: .5 * a.vol + .1, pan: a.pan, rate: 1.6, lp: 900}); } }
  addDecal(b.x + rnd(-.5, .5), b.z + rnd(-.5, .5), rnd(2, 3.4) * s, [rnd(.7, .95), rnd(.85, 1), rnd(.6, .8)]);
  for (let i = 0; i < 2; i++) addDecal(b.x + rnd(-2, 2) * s, b.z + rnd(-2, 2) * s, rnd(.6, 1.4) * s, [.85, .95, .7]);
  if (Sfx.ctx) { const a = Sfx.at(b.x, b.z); if (Sfx.lim('death', 45)) { Sfx.play('squelch', {vol: 1.1 * a.vol + .08, pan: a.pan, rate: .7}); Sfx.play('crunch', {vol: .5 * a.vol, pan: a.pan, rate: .8}); }
    if (Sfx.lim('squeal', 110)) Sfx.play('squeal', {vol: .25 * a.vol, pan: a.pan, rate: rnd(.8, 1.3) / Math.sqrt(s), lp: 4000}); }
}

// ---------------- waves + bug AI (host)
// pacing: wave n spawns for (8 + n) s; a squad gets +50% bugs per extra gunner
const crewMul = () => 1 + .5 * (crewN() - 1);
// no waves: one endless horde. G.wave is a hidden threat level that rises every LEVEL_T s (spawn rate, bug mix, titan every 5th level)
const LEVEL_T = 28;
const spawnRate = n => Math.min(55, 15 + n * 3) * crewMul();
function waveQuota(n) { return 1e9; }
function startWave(n) {
  if (SURV()) return survWave(n);
  G.wave = n; G.quota = 1e9; G.gap = 0; G.cleared = false;
  if (n === 1) { callout('HOLD THE LINE', 'THEY JUST KEEP COMING'); Sfx.play('horn', {vol: .6, vr: 0}); }
  else if (n % 5) { G.thrT = 3; Sfx.play('horn', {vol: .14, rate: .55, vr: 0, lp: 600}); } // threat rises: HUD line flashes, a far-off siren
  if (isHost()) { G.evq.push(['w', n]); if (n % 5 === 0) spawnTitan(n);
    if (n === 1) for (let i = 0; i < 70; i++) { if (!G.pack || (G.pack.n -= 1) <= 0) G.pack = {a: rnd(-1.1, 1.1), d: rnd(60, 120), n: 10 + (Math.random() * 14 | 0)}; spawnOne(); } } // open on a horde already charging
}
function waveCleared() {
  G.hp = Math.min(100, G.hp + 12); G.shield = 100;
  heldFx(G.wave);
  if (isHost()) G.evq.push(['c', G.wave]);
}
function heldFx(n) { callout('WAVE ' + n + ' HELD', 'ARMOUR PATCHED // NEXT WAVE INBOUND'); Sfx.play('horn', {vol: .35, rate: 1.5, vr: 0}); }
function spawnOne() {
  const n = G.wave, r = Math.random();
  const p2 = n >= 3 ? Math.min(.12, .03 + n * .006) : 0, p3 = n >= 4 ? Math.min(.1, .035 + (n - 4) * .01) : 0, p4 = n >= 6 ? Math.min(.12, .045 + (n - 6) * .012) : 0;
  const type = r < p2 ? 2 : r < p2 + p3 ? 3 : r < p2 + p3 + p4 ? 4 : n >= 2 && r < p2 + p3 + p4 + .28 ? 1 : 0;
  if ((type === 3 || type === 4) && !(G.seen & (1 << type))) { G.seen |= 1 << type; newTypeWarn(type); if (isHost()) G.evq.push(['n', type]); }
  if (!G.pack || (G.pack.n -= 1) <= 0) G.pack = SURV() ? {a: Math.random() < .55 ? rnd(-1.2, 1.2) : rnd(-PI, PI), d: rnd(95, 140), n: 4 + (Math.random() * 10 | 0)} : {a: rnd(-1.15, 1.15), d: rnd(105, 165), n: 6 + (Math.random() * 18 | 0)};
  const a = G.pack.a + rnd(-.09, .09), d = G.pack.d + rnd(-9, 9);
  spawnBug(type, Math.sin(a) * d, -Math.cos(a) * d);
  if (type === 2 && !G.bruteSeen) { G.bruteSeen = true; bruteWarn(); if (isHost()) G.evq.push(['b']); }
}
function bruteWarn() { setTimeout(() => { if (G.on && !G.over) callout('BRUTE', 'BIG ONE // KEEP THE GUN ON IT'); }, 2600); }
// ---------------- milestone 2: new bugs, the titan finale, squad call-ins, supply drops
// Everything here still asks nothing of the player but sweeping the gun: call-ins fire on their own as the squad racks up
// kills, supply canisters pop when any gunner's sweep passes over them, and the titan just soaks rounds until it blows.
const crewN = () => { let n = 0; for (const g of G.gunners.values()) if (!g.sentry) n++; return Math.max(1, n); };
const NEWT = {3: ['SPITTERS', 'ACID INBOUND // SWEEP THE BACK ROW'], 4: ['BURROWERS', 'MOVEMENT UNDER THE SAND']};
function newTypeWarn(t) { setTimeout(() => { if (G.on && !G.over && NEWT[t]) callout(NEWT[t][0], NEWT[t][1]); }, 2200); }
function surfaceFx(b) { // a burrower erupts out of the sand
  for (let i = 0; i < 18; i++) PS.add(b.x + rnd(-1, 1), b.y + .2, b.z + rnd(-1, 1), rnd(-3, 3), rnd(3, 8), rnd(-3, 3), rnd(1, 2), .5, 2.4, .62, .42, .28, .7, 6, 1);
  for (let i = 0; i < 6; i++) addChunk(b.x, b.y + .3, b.z, rnd(.1, .25), 6);
  if (Sfx.ctx && Sfx.lim('surf', 150)) { const a = Sfx.at(b.x, b.z); Sfx.play('crunch', {vol: .6 * a.vol + .05, pan: a.pan, rate: .5}); Sfx.play('screech', {vol: .35 * a.vol, pan: a.pan, rate: rnd(1, 1.3)}); }
}
// acid globs (spitters)
const GLOBS = [];
function spit(b, tx, tz) {
  const sy = b.y + BH * b.s * 1.2, ez = tz !== undefined ? tz : -2.3 - Math.pow(Math.abs(tx) / 13, 2) * 2.2, T = 1.7;
  GLOBS.push({x: b.x, y: sy, z: b.z, vx: (tx - b.x) / T, vz: (ez - b.z) / T, vy: (1.1 - sy) / T + 9 * T, t: 0, T});
  for (let i = 0; i < 8; i++) PG.add(b.x, sy, b.z, rnd(-2, 2), rnd(2, 5), rnd(-2, 2), rnd(.5, 1), .2, .1, .5, 1, .2, .9, 14, .4, 1);
  if (Sfx.ctx && Sfx.lim('spit', 120)) { const a = Sfx.at(b.x, b.z); Sfx.play('squelch', {vol: .6 * a.vol + .04, pan: a.pan, rate: .45}); }
}
function stepGlobs(dt) {
  for (let i = GLOBS.length - 1; i >= 0; i--) { const g = GLOBS[i]; g.t += dt; g.vy -= 18 * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    PA.add(g.x, g.y, g.z, 0, 0, 0, .12, .55, .2, .5, 2.2, .3, 1); if (Math.random() < dt * 30) PG.add(g.x, g.y, g.z, rnd(-.5, .5), 0, rnd(-.5, .5), rnd(.5, 1), .12, .05, .55, 1, .2, .9, 14, .2, 1);
    if (g.t < g.T) continue; GLOBS.splice(i, 1);
    for (let k = 0; k < 16; k++) PG.add(g.x, g.y, g.z, rnd(-4, 4), rnd(1, 5), rnd(-4, 4), rnd(.6, 1.4), rnd(.1, .25), .08, .5, 1, .2, .95, 14, .4, 1);
    for (let k = 0; k < 6; k++) PS.add(g.x, g.y, g.z, rnd(-1, 1), rnd(.5, 2), rnd(-1, 1), rnd(1, 2), .3, 1.8, .6, .9, .5, .4, -.3, 1);
    addDecal(g.x, g.z - .6, rnd(1, 1.6), [.6, 1.2, .3]);
    if (Sfx.ctx) { const a = Sfx.at(g.x, g.z); Sfx.play('squelch', {vol: .7 * a.vol, pan: a.pan, rate: .6}); Sfx.play('zap', {vol: .2, rate: .5}); }
    G.dmgDirs.push({a: Math.atan2(-(g.x - P.x), -(g.z - P.z)) + rnd(-.3, .3), t: 1}); P.trauma = Math.min(1, P.trauma + .12);
    if (isHost() && !G.over && (!SURV() || Math.hypot(g.x - P.x, g.z - P.z) < 2.6)) hurt(7); }
}
// the hive titan: every 5th wave
// kill streak: kills within 1.6 s of each other chain; every 50 in a chain pays out armour + a chime
const KTAG = ['', '', 'BRUTE', 'SPITTER', 'BURROWER'];
function myKill(b) { G.killT = .25;
  if (b && KTAG[b.type]) { G.tag = KTAG[b.type] + ' DOWN'; G.tagT = 1.3; G.tagB = b.type === 2; if (Sfx.ctx && Sfx.lim('conf', 220)) Sfx.play('conf', {vol: b.type === 2 ? .45 : .28, rate: b.type === 2 ? .85 : 1, vr: 0}); } G.combo = (G.comboT > 0 ? G.combo : 0) + 1; G.comboT = 1.6; G.comboPop = .18; G.comboBest = Math.max(G.comboBest || 0, G.combo);
  if (G.combo % 50 === 0) { G.comboFlash = 1; if (G.combo % 150 === 0) radio('streak'); Sfx.play('horn', {vol: .3, rate: 1.6 + Math.min(.8, G.combo / 500), vr: 0}); if (isHost()) { G.hp = Math.min(100, G.hp + 4); G.shield = 100; } }
}
function spawnTitan(n) {
  const b = spawnBug(5, rnd(-25, 25), -205); if (!b) return;
  b.hp = b.hp0 = Math.round(300 * crewMul() * (1 + .25 * (n / 5 - 1))); G.titan = b; titanWarn(); G.evq.push(['T']);
}
function titanWarn() { setTimeout(() => { if (!G.on || G.over) return; radio('titan'); callout('HIVE TITAN', 'SOMETHING HUGE // POUR IT ON'); Sfx.play('horn', {vol: .6, rate: .5, vr: 0}); }, 1800); }
function titanDown(b) {
  G.titan = null; G.titansDown = (G.titansDown || 0) + 1; G.slow = 1.8; G.shock = {x: b.x, z: b.z, r: 0};
  for (let i = 0; i < (HI() ? 160 : 70); i++) { const a = rnd(0, TAU), sp = rnd(4, 26); PA.add(b.x, b.y + rnd(1, 6), b.z, Math.cos(a) * sp, rnd(3, 22), Math.sin(a) * sp, rnd(.6, 1.6), rnd(1, 3), 4, 3, 1.4, .4, 1, 8, 1); }
  for (let i = 0; i < 40; i++) PS.add(b.x + rnd(-4, 4), b.y + rnd(0, 6), b.z + rnd(-4, 4), rnd(-3, 3), rnd(3, 12), rnd(-3, 3), rnd(4, 8), 3, rnd(10, 18), .2, .12, .08, .7, -.4, .5);
  for (let i = 0; i < 30; i++) addChunk(b.x, b.y + 4, b.z, rnd(.3, .9), 14);
  skyM.uniforms.flash.value = 1.4; flareL.position.set(b.x, b.y + 10, b.z); P.trauma = 1;
  const a = Sfx.at(b.x, b.z); [0, .12, .35].forEach((t, i) => Sfx.play('boom', {vol: .9 - i * .2, pan: a.pan, rate: 1 - i * .2, at: t, vr: 0}));
  Sfx.play('squeal', {vol: .6, rate: .35, vr: 0});
  callout('TITAN DOWN', 'THE HIVE REELS // ARMOUR RESTORED');
  setTimeout(() => Sfx.play('horn', {vol: .45, rate: 1.25, vr: 0}), 900);
  if (isHost()) { G.hp = 100; G.shield = 100; G.lowWarn = false; }
}
function fxKill(b, tossV) { if (b.dead) return; killBug(b, null); G.kills++; if (tossV) { b.dvy = rnd(tossV * .6, tossV); b.dvx += rnd(-4, 4); b.dvz += rnd(-4, 4); b.dspin = rnd(-12, 12); } }
function stepShock(dt) {
  const s = G.shock; if (!s) return; s.r += dt * 70;
  for (let i = 0; i < 28; i++) { const a = i / 28 * TAU + rnd(0, .2); PS.add(s.x + Math.cos(a) * s.r, gH(s.x, s.z) + .3, s.z + Math.sin(a) * s.r, Math.cos(a) * 6, rnd(1, 3), Math.sin(a) * 6, rnd(.6, 1.1), 1, 3.5, .7, .5, .35, .5, 1, 2); }
  if (isHost()) for (const b of bugs) if (!b.dead && b.st !== 3 && Math.hypot(b.x - s.x, b.z - s.z) < s.r) fxKill(b, 9);
  if (s.r > 75) G.shock = null;
}
function stepTitanFx(dt) {
  const b = G.titan; if (!b || b.dead) return; const k = Math.floor(b.ph / PI);
  if (k !== b.stepK) { b.stepK = k; const d = Math.hypot(b.x - P.x, b.z - P.z); P.trauma = Math.min(1, P.trauma + clamp(1 - d / 170, 0, 1) * .22);
    for (let i = 0; i < 6; i++) PS.add(b.x + rnd(-4, 4), b.y + .2, b.z + rnd(-4, 4), rnd(-2, 2), rnd(.5, 2), rnd(-2, 2), rnd(1.5, 3), 1, 5, .62, .42, .28, .6, 0, 1);
    if (Sfx.ctx) { const a = Sfx.at(b.x, b.z); Sfx.play('boom', {vol: .35 * a.vol + .08, pan: a.pan, rate: 2.2, lp: 300}); } }
  if (Sfx.ctx && Math.random() < dt * .25) { const a = Sfx.at(b.x, b.z); Sfx.play('screech', {vol: .5 * a.vol + .1, pan: a.pan, rate: .3, vr: .05}); }
}
// call-in 1: gun run. A dropship strafes the densest part of the swarm, left to right or right to left.
const SHIP = (() => {
  const g = new THREE.Group(), hull = new THREE.MeshStandardMaterial({color: 0x3a4048, metalness: .7, roughness: .45}), glow = new THREE.MeshBasicMaterial({color: new THREE.Color(6, 3, 1)});
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
  add(new THREE.BoxGeometry(3.4, 2.6, 13), hull, 0, 0, 0); add(new THREE.CylinderGeometry(.6, 1.9, 4.5, 6), hull, 0, -.2, 8.5, PI / 2);
  add(new THREE.BoxGeometry(15, .4, 3.4), hull, 0, .3, -1.5); add(new THREE.BoxGeometry(.4, 3.4, 2.6), hull, 0, 2.6, -5.6, -.3);
  for (const x of [-5.6, 5.6]) { add(new THREE.CylinderGeometry(.8, .8, 3.6, 10), hull, x, .3, -1.6, PI / 2); add(new THREE.CircleGeometry(.65, 12), glow, x, .3, -3.45, 0, PI); }
  add(new THREE.BoxGeometry(.5, .5, 2.2), hull, 0, -1.6, 4);
  g.visible = false; scene.add(g); return g;
})();
let RUN = null;
function gunRun(z, dir) {
  RUN = {z, dir, t: 0, x: -dir * 175, acc: 0}; SHIP.visible = true;
  callout('GUN RUN', 'DROPSHIP INBOUND // DANGER CLOSE'); Sfx.play('screech', {vol: .55, rate: .28, vr: 0}); Sfx.play('horn', {vol: .3, rate: 1.8, vr: 0});
}
function pickRunZ() { // the bug with the most neighbours (sampled) marks the strafe line
  const live = bugs.filter(b => !b.dead && b.st !== 3 && b.z < -15 && b.z > -170); if (!live.length) return -60;
  let best = live[0], bn = -1; for (let i = 0; i < Math.min(60, live.length); i++) { const a = live[(Math.random() * live.length) | 0]; let n = 0; for (const o of live) if (Math.abs(o.z - a.z) < 9) n++; if (n > bn) { bn = n; best = a; } }
  return clamp(best.z, -150, -22);
}
function blast(x, z, r, dmg) {
  for (const b of bugs) { if (b.st === 3) continue; const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
    if (b.dead) { if (d < r * 1.5 && !b.T.titan) { const f = (1 - d / (r * 1.5)) * 9 / b.s; b.dvx += dx / (d || 1) * f; b.dvz += dz / (d || 1) * f; b.dvy = Math.max(b.dvy, f * .8); b.dspin += rnd(-8, 8); b.dead = Math.min(b.dead, .5); } continue; }
    if (d > r * clamp(b.s * .6, 1, 1.4)) continue;
    b.hp -= b.T.titan ? dmg * .3 : dmg; b.hk = 1.2; if (b.hp <= 0) { fxKill(b, 10); if (!b.T.titan) { b.dvx += dx / (d || 1) * 6; b.dvz += dz / (d || 1) * 6; } } }
}
function stepRun(dt) {
  if (!RUN) return; const R = RUN; R.t += dt; R.x += R.dir * 95 * dt;
  SHIP.position.set(R.x, 30 + Math.sin(R.t * 2) * .8, R.z + 14); SHIP.rotation.set(-.12, R.dir > 0 ? PI / 2 : -PI / 2, Math.sin(R.t * 1.5) * .08, 'YXZ');
  for (const sx of [-5.6, 5.6]) { _v.set(sx, .3, -3.6).applyMatrix4(SHIP.matrixWorld); PA.add(_v.x, _v.y, _v.z, -R.dir * 20 + rnd(-2, 2), rnd(-1, 1), rnd(-1, 1), .25, 1.2, .3, 3, 1.4, .5, 1); }
  if (Math.random() < dt * 20) PS.add(R.x - R.dir * 6, SHIP.position.y, SHIP.position.z, rnd(-1, 1), 0, rnd(-1, 1), 3, 1.5, 5, .3, .28, .26, .25);
  if (Math.abs(R.x) < 100) { R.acc += dt * 18;
    while (R.acc >= 1) { R.acc--; const ix = R.x + R.dir * rnd(2, 14), iz = R.z + rnd(-8, 8), iy = gH(ix, iz);
      for (let i = 0; i < 10; i++) PA.add(ix, iy + .5, iz, rnd(-5, 5), rnd(4, 14), rnd(-5, 5), rnd(.3, .7), rnd(.8, 2), 1.5, 3, 1.5, .4, 1, 10, 1);
      for (let i = 0; i < 5; i++) PS.add(ix + rnd(-1, 1), iy + .5, iz + rnd(-1, 1), rnd(-2, 2), rnd(2, 6), rnd(-2, 2), rnd(1.5, 3), 1, 6, .5, .36, .25, .6, 1, 1);
      _v.set(0, -1.6, 5).applyMatrix4(SHIP.matrixWorld); _v2.set(ix, iy, iz); addTracer(_v, _v2);
      if (Sfx.ctx && Sfx.lim('imp', 70)) { const a = Sfx.at(ix, iz); Sfx.play('boom', {vol: .45 * a.vol + .05, pan: a.pan, rate: rnd(1.6, 2.2), lp: 1800}); }
      if (isHost()) blast(ix, iz, 6, 8); } }
  if (Math.abs(R.x) > 180) { RUN = null; SHIP.visible = false; }
}
// call-in 2: sentry pod. Drops onto one end of the barricade and hoses whatever is closest for 25 s.
function makeSentry() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({color: 0x4b5a3a, metalness: .5, roughness: .5}), lamp = new THREE.MeshBasicMaterial({color: new THREE.Color(3, .6, .3)});
  for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 1.5, 6), m), a = i / 3 * TAU; l.position.set(Math.sin(a) * .35, .65, Math.cos(a) * .35); l.rotation.set(Math.cos(a) * .45, 0, -Math.sin(a) * .45); l.castShadow = true; g.add(l); }
  const box = new THREE.Mesh(new THREE.BoxGeometry(.5, .35, .6), m); box.position.y = 1.3; box.castShadow = true; g.add(box);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), lamp); eye.position.set(0, 1.52, -.2); g.add(eye);
  const gun = makeGun(false); gun.position.set(0, 1.45, -.1); g.add(gun); g.userData.gun = gun; scene.add(g); return g;
}
function dropSentry(slot) {
  const old = G.gunners.get('S' + slot); if (old) removeGunner(old.id);
  const m = makeSentry(); m.position.set(SLOTX[slot], 120, -.6);
  G.gunners.set('S' + slot, {id: 'S' + slot, slot, name: 'SENTRY', sentry: 18, drop: 1.4, yaw: 0, pitch: -.04, fire: 0, spin: 0, heat: 0, acc: 0, n: 0, kills: 0, model: m, tgt: null, tgtT: 0});
  callout('SENTRY POD', 'AUTO-TURRET ON THE ' + (SLOTX[slot] < 0 ? 'LEFT' : 'RIGHT') + ' FLANK'); Sfx.play('horn', {vol: .3, rate: 1.8, vr: 0});
}
function stepSentries(dt) {
  for (const g of [...G.gunners.values()]) { if (!g.sentry) continue; const m = g.model, x = SLOTX[g.slot];
    if (g.drop > 0) { g.drop -= dt; const k = Math.max(0, g.drop / 1.4); m.position.y = k * k * 120; g.fire = 0;
      if (m.position.y > 6) PS.add(x + rnd(-.3, .3), m.position.y + 2, -.6, rnd(-.5, .5), 3, rnd(-.5, .5), 1.2, .4, 1.6, .45, .42, .4, .4); PA.add(x, m.position.y + 1.5, -.6, 0, 8, 0, .2, .8, .2, 3, 1.4, .5, 1);
      if (g.drop <= 0) { m.position.y = 0; for (let i = 0; i < 16; i++) { const a = rnd(0, TAU); PS.add(x + Math.cos(a), .2, -.6 + Math.sin(a) - .8, Math.cos(a) * 4, rnd(.3, 1.2), Math.sin(a) * 4 - 1, rnd(.8, 1.4), .25, 1.1, .62, .44, .3, .35, 1, 2); }
        const a = Sfx.at(x, 0); Sfx.play('boom', {vol: .6, pan: a.pan, rate: 1.4}); P.trauma = Math.min(1, P.trauma + .35); }
      continue; }
    g.sentry -= dt;
    if (isHost()) { let best = null, bd = 1e9; for (const b of bugs) { if (b.dead || b.st === 3) continue; const dx = b.x - x, d = Math.hypot(dx, b.z); if (d > 150 || Math.abs(Math.atan2(-dx, -b.z)) > 1.45) continue; const sc = d - (b.st === 1 ? 30 : 0); if (sc < bd) { bd = sc; best = b; } }
      if (best) g.yaw += angD(g.yaw, Math.atan2(-(best.x - x), -best.z)) * Math.min(1, dt * 10); g.fire = best ? 1 : 0; }
    if (g.sentry <= 0) { for (let i = 0; i < 8; i++) PS.add(x, 1.3, -1.2, rnd(-.6, .6), rnd(1, 2), rnd(-1, 0), 1.5, .2, 1, .4, .4, .4, .35); removeGunner(g.id); } }
}
function callIn() {
  const n = G.supN++;
  if (n % 2 === 0) { const z = pickRunZ(), dir = Math.random() < .5 ? 1 : -1; gunRun(z, dir); G.evq.push(['R', Math.round(z * 10), dir]); }
  else { const slot = G.gunners.has('S4') ? 5 : G.gunners.has('S5') ? 4 : (Math.random() < .5 ? 4 : 5); dropSentry(slot); G.evq.push(['S', slot]); }
}
// supply canisters: parachute in, and pop when anyone's sweep passes over them
const CANK = [{n: 'OVERDRIVE', s: 'DOUBLE RATE // NO HEAT', c: [1, .62, .15]}, {n: 'SHOCK ROUNDS', s: 'HITS ARC INTO NEARBY BUGS', c: [.35, .75, 1]}, {n: 'ARMOUR CELL', s: 'SHIELD AND ARMOUR RESTORED', c: [.4, 1, .45]}];
const CANS = new Map(); let canId = 1;
function makeCan(k) {
  const g = new THREE.Group(), c = CANK[k].c, m = new THREE.MeshStandardMaterial({color: new THREE.Color(c[0] * .6, c[1] * .6, c[2] * .6), metalness: .6, roughness: .4}), lit = new THREE.MeshBasicMaterial({color: new THREE.Color(c[0] * 4, c[1] * 4, c[2] * 4)});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, 1.2, 12), m); body.position.y = .6; body.castShadow = true; g.add(body);
  for (const y of [.15, 1.05]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.4, .05, 6, 16), lit); r.rotation.x = PI / 2; r.position.y = y; g.add(r); }
  const chute = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 6, 0, TAU, 0, PI / 2), new THREE.MeshStandardMaterial({color: 0xd8d0c0, roughness: .9, side: THREE.DoubleSide})); chute.position.y = 4.2; chute.scale.y = .6; g.add(chute);
  g.userData.chute = chute; g.userData.lit = lit; scene.add(g); return g;
}
function dropCan(id, x, z, k) { canId = Math.max(canId, id + 1); CANS.set(id, {id, x, z, y: 55, k, m: makeCan(k), t: 0, land: false}); }
function popCan(c) {
  CANS.delete(c.id); scene.remove(c.m); const K = CANK[c.k], col = K.c;
  for (let i = 0; i < 60; i++) { const a = rnd(0, TAU), sp = rnd(2, 12); PA.add(c.x, c.y + .6, c.z, Math.cos(a) * sp, rnd(1, 10), Math.sin(a) * sp, rnd(.4, 1), rnd(.2, .5), .1, col[0] * 3, col[1] * 3, col[2] * 3, 1, 8, 1); }
  callout(K.n, K.s); Sfx.play('zap', {vol: .5, rate: 1.6, vr: 0}); Sfx.play('horn', {vol: .3, rate: 2.2, vr: 0});
  if (c.k === 2) { if (isHost()) { G.hp = Math.min(100, G.hp + 25); G.shield = 100; } }
  else G.buff = {k: c.k, t: 12};
}
function stepCans(dt) {
  if (isHost() && G.on && !G.over && G.wave >= 2 && (G.dropT -= dt) <= 0) {
    G.dropT = rnd(30, 46); const a = rnd(-.9, .9), d = rnd(16, 32), k = G.hp < 55 && Math.random() < .55 ? 2 : Math.random() < .5 ? 0 : 1, id = canId++;
    dropCan(id, Math.sin(a) * d, -Math.cos(a) * d, k); G.evq.push(['D', id, Math.round(Math.sin(a) * d * 10), Math.round(-Math.cos(a) * d * 10), k]);
  }
  for (const c of [...CANS.values()]) { c.t += dt; const gy = gH(c.x, c.z);
    if (!c.land) { c.y -= 7 * dt; if (c.y <= gy) { c.y = gy; c.land = true; c.m.userData.chute.visible = false; for (let i = 0; i < 12; i++) PS.add(c.x, gy + .2, c.z, rnd(-3, 3), rnd(.5, 2), rnd(-3, 3), 1.2, .4, 2, .62, .44, .3, .6, 1, 2); } }
    else if (Math.random() < dt * 14) { const col = CANK[c.k].c; PS.add(c.x, c.y + 1.2, c.z, rnd(-.3, .3), rnd(2, 3.5), rnd(-.3, .3), rnd(2, 3.5), .4, 2.5, col[0], col[1], col[2], .45, -.2, .3); }
    c.m.position.set(c.x + (c.land ? 0 : Math.sin(c.t * 1.3) * .5), c.y, c.z); c.m.rotation.set(c.land ? 0 : Math.sin(c.t * 1.7) * .12, c.t * .6, 0);
    const bl = .5 + .5 * Math.sin(c.t * 9), col = CANK[c.k].c; c.m.userData.lit.color.setRGB(col[0] * (1 + bl * 4), col[1] * (1 + bl * 4), col[2] * (1 + bl * 4));
    if (isHost() && c.t > 26) { popGone(c); G.evq.push(['X', c.id]); continue; }
    if (isHost()) for (const g of G.gunners.values()) { if (g.sentry || g.spin < .9) continue; const dx = c.x - SLOTX[g.slot], d = Math.hypot(dx, c.z);
      if (Math.abs(angD(g.yaw, Math.atan2(-dx, -c.z))) < .06 + Math.atan(1.3 / d)) { popCan(c); G.evq.push(['O', c.id]); break; } } }
}
function popGone(c) { CANS.delete(c.id); scene.remove(c.m); for (let i = 0; i < 10; i++) PS.add(c.x, c.y + .6, c.z, rnd(-1, 1), rnd(1, 2), rnd(-1, 1), 1.5, .3, 1.6, .4, .4, .4, .5); }
function shockArc(a, b) { const n = 7; for (let i = 0; i <= n; i++) { const t = i / n, j = i && i < n ? .5 : 0; PA.add(mix(a.x, b.x, t) + rnd(-j, j), mix(a.y, b.y, t) + rnd(-j, j), mix(a.z, b.z, t) + rnd(-j, j), 0, 0, 0, .12, .35, .1, 1.4, 2.4, 4, 1); }
  if (Sfx.ctx && Sfx.lim('arc', 110)) { const s = Sfx.at(b.x, b.z); Sfx.play('zap', {vol: .12 * s.vol + .03, pan: s.pan, rate: rnd(2, 2.8)}); } }
function stepSpecials(dt) { stepGlobs(dt); stepShock(dt); stepTitanFx(dt); stepRun(dt); stepSentries(dt); stepCans(dt); if (G.buff && (G.buff.t -= dt) <= 0) G.buff = null; }
function resetSpecials() {
  GLOBS.length = 0; for (const c of CANS.values()) scene.remove(c.m); CANS.clear(); canId = 1; RUN = null; SHIP.visible = false;
  for (const g of [...G.gunners.values()]) if (g.sentry) removeGunner(g.id);
  Object.assign(G, {buff: null, sup: 0, supN: 0, titan: null, slow: 0, shock: null, dropT: 20, seen: 0});
}

// ---------------- survival mode (solo): get off the gun, walk the outpost with a rifle, scavenge supplies between waves
const SURV = () => G.mode === 'surv';
const SV = {mag: 30, res: 150, belt: 1200, rel: 0, lull: 0, wt: 0, items: [], q0: 0, dur: 1, bob: 0, live: 0, emptyT: 0};
const ITEMK = [{n: 'RIFLE AMMO +90', c: 0xd8a21c}, {n: 'CANNON BELT +500', c: 0xff7a30}, {n: 'MED KIT +35', c: 0xe04040}, {n: 'ARMOUR CELL', c: 0x6ff7ee}];
const pickK = () => { const r = Math.random(); return r < .4 ? 0 : r < .62 ? 1 : r < .84 ? 2 : 3; };
function addItem(k, x, z) {
  const g = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(.62, .36, .42), new THREE.MeshStandardMaterial({map: CRATE.map, normalMap: CRATE.nrm, roughnessMap: CRATE.rgh, roughness: 1, metalness: .2}));
  box.position.y = .18; box.castShadow = true; g.add(box);
  const band = new THREE.Mesh(new THREE.BoxGeometry(.64, .07, .44), new THREE.MeshStandardMaterial({color: ITEMK[k].c, emissive: ITEMK[k].c, emissiveIntensity: .8, roughness: .5})); band.position.y = .22; g.add(band);
  g.position.set(x, gH(x, z), z); g.rotation.y = rnd(0, TAU); scene.add(g); SV.items.push({k, x, z, m: g});
}
function scatterItems(n, r0, r1, compound) { for (let i = 0; i < n; i++) { let x, z;
  if (compound) { x = rnd(-12, 12); z = rnd(1.5, 13); } else { const a = rnd(-PI, PI), r = rnd(r0, r1); x = Math.sin(a) * r; z = -Math.cos(a) * r; }
  addItem(pickK(), x, z); } }
function clearItems() { for (const it of SV.items) scene.remove(it.m); SV.items = []; }
function survStart() { Object.assign(SV, {mag: 30, res: 150, belt: 1200, rel: 0, lull: 0, wt: 0, q0: 0, emptyT: 0, night: 1, nw: 0, day: 0, perks: [], offer: [], hives: 0}); hidePerks(); clearItems(); P.foot = false; P.x = 0; P.z = 0; P.eyeY = 1.7; scatterItems(7, 0, 0, true); scatterItems(4, 25, 60); }
// multi-night: each night is WPN waves with short breathers, then dawn: the hive pulls back, a timed day to scavenge and pick a perk
const WPN = 3, DAY_T = 90;
const PERKS = [
  {id: 'mag', n: 'EXTENDED MAGS', d: '45-round magazines'}, {id: 'fast', n: 'FAST HANDS', d: 'Reload in 1.1 s'}, {id: 'medic', n: 'FIELD MEDIC', d: 'Med kits heal more, slow health regen'},
  {id: 'belt', n: 'HEAVY BELT', d: '+1000 cannon rounds now, bigger belt pickups'}, {id: 'plate', n: 'ARMOUR PLATING', d: 'Take 25% less damage'}, {id: 'run', n: 'MARATHON', d: 'Move and sprint faster'},
  {id: 'pierce', n: 'AP ROUNDS', d: 'Rifle rounds punch through to a second bug'}, {id: 'scav', n: 'SCAVENGER', d: '+3 crates every day'}, {id: 'res', n: 'AMMO CACHE', d: '+180 rifle rounds now, ammo crates give more'}];
const has = id => SV.perks && SV.perks.includes(id);
function survWave(n) { G.wave = n; SV.nw = (SV.nw || 0) + 1; G.quota = Math.round((24 + n * 14) * (n % 5 === 0 ? .7 : 1) * Math.max(.55, 1 - .15 * (SV.hives || 0))); SV.q0 = G.quota; SV.dur = 20 + n * 2; SV.lull = 0; SV.wt = 0;
  callout(SV.nw === 1 ? 'NIGHT ' + SV.night : 'WAVE ' + SV.nw + ' / ' + WPN, SV.nw === 1 ? (SV.night === 1 ? 'THEY KNOW YOU ARE HERE' : 'THE HIVE IS BACK') : 'INBOUND FROM ALL SIDES'); Sfx.play('horn', {vol: .6, vr: 0}); if (n % 5 === 0) spawnTitan(n); }
function startDay() {
  SV.day = DAY_T; SV.nw = 0; G.shield = 100; G.hp = Math.min(100, G.hp + 20); SV.offer = PERKS.filter(q => !has(q.id)).sort(() => Math.random() - .5).slice(0, 3);
  callout('DAWN', 'NIGHT ' + SV.night + ' SURVIVED // THE HIVE PULLS BACK'); Sfx.play('horn', {vol: .45, rate: 1.4, vr: 0}); radio('idle');
  scatterItems(8 + (has('scav') ? 3 : 0), 22, 110); scatterItems(3, 0, 0, true); showPerks(); makeHole(); setTimeout(() => { if (G.on && SURV() && SV.day > 0 && !TUN) toast('A hive mound has opened in the dunes. Raid it: [E] at the hole'); }, 3500);
}
function nightFall() { dropHole(); SV.day = 0; SV.night++; hidePerks(); startWave(G.wave + 1); }
function showPerks() { const el = $('perks'); if (!el || !SV.offer.length) return; el.innerHTML = '<div class="ph">DAWN // PICK ONE</div>' + SV.offer.map((q, i) => `<button data-i="${i}"><b>[${i + 1}] ${q.n}</b><small>${q.d}</small></button>`).join('');
  el.classList.remove('hidden'); for (const b of el.querySelectorAll('button')) b.onclick = () => pickPerk(+b.dataset.i); }
function hidePerks() { const el = $('perks'); if (el) el.classList.add('hidden'); SV.offer = []; }
function pickPerk(i) { const q = SV.offer && SV.offer[i]; if (!q) return; SV.perks.push(q.id);
  if (q.id === 'belt') SV.belt += 1000; if (q.id === 'res') SV.res += 180; if (q.id === 'mag') SV.mag = Math.min(45, SV.mag);
  toast('PERK: ' + q.n); Sfx.play('zap', {vol: .2, rate: 1.5}); hidePerks(); }
function survSpawn(dt, live) {
  if (SV.day > 0) { // daytime: no spawns, stragglers run off into the dunes
    for (const b of bugs.slice()) if (!b.dead && b.z < 450 && Math.hypot(b.x, b.z) > 170) { if (G.titan === b) G.titan = null; freeBug(b); }
    if ((SV.day -= dt) <= 0) { if (TUN) SV.day = .01; else nightFall(); } return; }
  if (G.quota > 0) { G.spawnAcc += dt * SV.q0 / SV.dur; while (G.spawnAcc > 1 && G.quota > 0) { G.spawnAcc--; spawnOne(); G.quota--; } SV.wt += dt; return; }
  if (SV.lull > 0) { if ((SV.lull -= dt) <= 0) startWave(G.wave + 1); return; }
  if (live <= 2 || (SV.wt += dt) > SV.dur + 70) {
    if (SV.nw >= WPN) startDay();
    else { SV.lull = 12; callout('WAVE ' + SV.nw + ' / ' + WPN + ' CLEARED', 'BREATHE // MORE COMING'); Sfx.play('horn', {vol: .3, rate: 1.5, vr: 0}); scatterItems(2, 15, 40); G.shield = 100; } }
}
const angW = a => ((a + PI) % TAU + TAU) % TAU - PI;
const inLine = (x, z) => Math.abs(x) < 13.7 && Math.abs(z - (-1.4 - (x / 13) ** 2 * 2.2)) < .55;
function toggleMount() {
  if (!SURV() || G.over) return;
  if (P.ug) { if (Math.hypot(P.x - TUN.N[0][0], P.z - TUN.N[0][1]) < 4) exitHive(); else toast('Climb out at the light where you came in'); return; }
  if (P.foot && HOLE && SV.day > 0 && Math.hypot(P.x - HOLE.x, P.z - HOLE.z) < 4) { enterHive(); return; }
  if (P.foot) { if (Math.hypot(P.x, P.z - .3) > 2.3) { toast('Get to the cannon to man it'); return; }
    P.foot = false; P.x = 0; P.z = 0; P.eyeY = 1.7; P.yaw = clamp(angW(P.yaw), -1.5, 1.5); P.pitch = clamp(P.pitch, -.55, .4); Sfx.play('tink', {vol: .4, rate: .6}); }
  else { P.foot = true; P.z = 1.1; P.pitch = clamp(P.pitch, -.3, .3); const lg = localGunner(); if (lg) lg.spin = 0; P.spin = 0; P.heat = 0; Sfx.play('tink', {vol: .4, rate: .8}); }
}
function reload() { if (!P.foot || SV.rel > 0 || SV.mag >= (has('mag') ? 45 : 30) || SV.res <= 0) return; SV.rel = has('fast') ? 1.1 : 1.8; SV.rel0 = SV.rel; Sfx.play('tink', {vol: .35, rate: .6}); setTimeout(() => Sfx.play('crunch', {vol: .3, rate: 1.6}), 1000); }
function rifleStep(g, dt) {
  g.spin = 0; P.firing = false; g.pitch = P.pitch;
  if (SV.rel > 0) { if ((SV.rel -= dt) <= 0) { const n = Math.min((has('mag') ? 45 : 30) - SV.mag, SV.res); SV.mag += n; SV.res -= n; } g.acc = 1; return; }
  const want = wantFire() && !G.over;
  if (want && SV.mag > 0) { g.acc += dt * 10; while (g.acc >= 1 && SV.mag > 0) { g.acc--; SV.mag--; fireShot(g, g.n++); } P.firing = true; P.fireT += dt; }
  else { g.acc = 1; P.fireT = Math.max(0, P.fireT - dt * 3); }
  if (want && SV.mag === 0) { if (SV.res > 0) reload(); else if (Sfx.lim('dry', 350)) { Sfx.play('tink', {vol: .3, rate: .45}); toast('Out of rifle ammo: find a crate or man the cannon'); } }
}
function survMove(dt) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (P.mvY || 0), r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (P.mvX || 0);
  const run = keys.ShiftLeft || keys.ShiftRight ? (has('run') ? 2 : 1.7) : 1, sp = (has('run') ? 4.8 : 4.2) * run * (1 - P.ads * .5), l = Math.min(1, Math.hypot(f, r)), ox = P.x, oz = P.z;
  if (l > .05) { const k = l / Math.hypot(f, r) * sp * dt, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw); P.x += (fx * f + rx * r) * k; P.z += (fz * f + rz * r) * k; SV.bob += dt * sp * 1.9;
    if (Sfx.ctx && Math.sin(SV.bob) * Math.sin(SV.bob - dt * sp * 1.9) < 0) Sfx.play('crunch', {vol: .06 * run, rate: rnd(.5, .7), lp: 1200}); }
  if (!P.ug && inLine(P.x, P.z) && !inLine(ox, oz)) { P.x = ox; P.z = oz; } // the sandbag line: go round the ends
  for (const b of bugs) { if (b.dead || b.st === 3) continue; const dx = P.x - b.x, dz = P.z - b.z, d2 = dx * dx + dz * dz, rr = .7 * b.s + .3; if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); P.x += dx / d * (rr - d) * .5; P.z += dz / d * (rr - d) * .5; } }
  if (P.ug) { const q = tunClamp(P.x, P.z, .6); if (q) { P.x = q[0]; P.z = q[1]; } } else { const rr = Math.hypot(P.x, P.z); if (rr > 160) { P.x *= 160 / rr; P.z *= 160 / rr; } }
  P.eyeY = gH(P.x, P.z) + 1.65 + Math.sin(SV.bob) * .035 * l; P.moveL = l * run;
}
const FLASH = new THREE.SpotLight(0xfff0d8, 0, 80, .4, .55, 1.3); FLASH.position.set(0, .15, -1.3); FLASH.target.position.set(0, -.6, -10); cam.add(FLASH, FLASH.target);
let dayK = .5;
function survLight(dt) { // night = dark with a flashlight; day = bright and hazy (the sun stays low so the baked shadows still fit)
  const tgt = !SURV() ? .5 : SV.day > 0 ? (SV.day < 8 ? .5 * SV.day / 8 : 1) : .0; dayK += (tgt - dayK) * Math.min(1, dt * .5);
  const k = dayK < .5 ? mix(.34, 1, dayK * 2) : mix(1, 1.45, (dayK - .5) * 2);
  compM.uniforms.exp.value = TUN ? .95 : k; SUN.intensity = TUN ? 0 : 3.2 * mix(.4, 1.25, Math.min(1, dayK * 1.3)); HEMI.intensity = TUN ? .05 : 1.1 * mix(.45, 1.5, dayK);
  FLASH.intensity = TUN ? 30 * (P.torch === false ? 0 : 1) : SURV() && dayK < .35 ? 26 * (1 - dayK / .35) * (P.torch === false ? 0 : 1) : 0;
}
function survStep(dt) {
  if (!SURV()) return;
  if (has('medic') && G.hurtT > 4) G.hp = Math.min(100, G.hp + dt * .6);
  for (let i = SV.items.length - 1; i >= 0; i--) { const it = SV.items[i]; it.m.rotation.y += dt * .4;
    if (Math.random() < dt * .8) PA.add(it.x, it.m.position.y + .5, it.z, 0, rnd(.6, 1.4), 0, rnd(.6, 1), .08, .02, 1.5 * ((ITEMK[it.k].c >> 16) / 255) + .2, 1.5 * ((ITEMK[it.k].c >> 8 & 255) / 255) + .1, 1.5 * ((ITEMK[it.k].c & 255) / 255) + .1, 1);
    if (!P.foot || Math.hypot(it.x - P.x, it.z - P.z) > 1.5) continue;
    if (it.k === 0) SV.res += has('res') ? 140 : 90; else if (it.k === 1) SV.belt += has('belt') ? 800 : 500; else if (it.k === 2) G.hp = Math.min(100, G.hp + (has('medic') ? 60 : 35)); else { G.shield = 100; G.hp = Math.min(100, G.hp + 10); }
    toast(ITEMK[it.k].n); Sfx.play('tink', {vol: .5, rate: 1.3}); Sfx.play('zap', {vol: .1, rate: 2}); scene.remove(it.m); SV.items.splice(i, 1); }
  if (!P.foot && SV.belt <= 0 && wantFire() && (SV.emptyT -= dt) <= 0) { SV.emptyT = 2.5; toast('BELT EMPTY: get off the gun [E] and find a cannon belt'); Sfx.play('tink', {vol: .3, rate: .45}); }
}

// ---------------- hive raids: by day a hive mound opens in the dunes; go down, fight in the dark, kill the brood core
let HOLE = null;
const TLIGHTS = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0x7aff4a, 0, 22, 1.2); l.position.set(0, -500, 0); scene.add(l); TLIGHTS.push(l); } // always present: no shader recompiles on entry
const tunM = triMat(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7, metalness: .05, side: THREE.DoubleSide}), CHIT.map, .2, .7, 'tunnel', .45, 60);
function makeHole() {
  if (HOLE) scene.remove(HOLE.m);
  const a = rnd(-PI, PI), r = rnd(55, 90), x = Math.sin(a) * r, z = -Math.cos(a) * r, g = new THREE.Group(), res = new THREE.MeshStandardMaterial({color: 0x4a2e1e, roughness: .85});
  const lat = new THREE.LatheGeometry([[1.7, -.3], [1.8, .5], [2.4, 1.4], [3.3, 1.7], [4.6, 1.1], [6.5, .1], [7, -.4]].map(([r, y]) => new THREE.Vector2(r, y)), 24); const lp = lat.attributes.position;
  for (let k = 0; k < lp.count; k++) { const s2 = 1 + (vn(lp.getX(k) * .5 + 3, lp.getZ(k) * .5) - .5) * .35; lp.setX(k, lp.getX(k) * s2); lp.setZ(k, lp.getZ(k) * s2); } lat.computeVertexNormals();
  const mound = new THREE.Mesh(lat, triMat(res, ROCK.map, .35, .8, 'mound', .5, 80)); mound.castShadow = mound.receiveShadow = true; g.add(mound);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), new THREE.MeshBasicMaterial({color: 0x000000})); hole.rotation.x = -PI / 2; hole.position.y = .25; g.add(hole);
  for (let i = 0; i < 9; i++) { const aa = i / 9 * TAU + rnd(-.2, .2), sp = new THREE.Mesh(new THREE.ConeGeometry(.22, rnd(1.6, 3), 6), res); sp.position.set(Math.cos(aa) * rnd(2.6, 3.6), 1.6, Math.sin(aa) * rnd(2.6, 3.6)); sp.rotation.set(Math.sin(aa) * .5, 0, -Math.cos(aa) * .5); sp.castShadow = true; g.add(sp); }
  g.position.set(x, gH(x, z) - .2, z); scene.add(g); HOLE = {x, z, m: g, done: false};
}
function dropHole() { if (HOLE && !TUN) { scene.remove(HOLE.m); HOLE = null; } }
function tunGeo(geo, cy) { // organic resin walls: jitter along normals, flat floor at UGY, dark resin vertex colours
  const p = geo.attributes.position, n = geo.attributes.normal, col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), j = (vn(x * .35 + y * .2, z * .35) - .5) * 1.3 + (vn(x * 1.3, z * 1.3 + y) - .5) * .3;
    let nx = x + n.getX(k) * j, ny = y + n.getY(k) * j * .6, nz = z + n.getZ(k) * j; if (ny < UGY) ny = UGY; p.setXYZ(k, nx, ny, nz);
    const fl = ny < UGY + .05, v = .8 + vn(x * .2, z * .2) * .4, vein = vn(x * .6 + 7, z * .6 + y * .8) > .78 ? 1 : 0;
    col[k * 3] = (fl ? .34 : .22 + vein * .12) * v; col[k * 3 + 1] = (fl ? .26 : .14 + vein * .2) * v; col[k * 3 + 2] = (fl ? .2 : .12 + vein * .05) * v; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals(); return geo;
}
function enterHive() {
  const N = [[0, 520]]; let hd = 0, x = 0, z = 520; for (let i = 1; i < 11; i++) { hd = clamp(hd + rnd(-.75, .75), -1.2, 1.2); x += Math.sin(hd) * 13; z += Math.cos(hd) * 13; N.push([x, z]); }
  const CHS = [{i: 4, r: 7}, {i: 7, r: 7.5}, {i: 10, r: 10}].map(c => ({x: N[c.i][0], z: N[c.i][1], r: c.r})), CYc = UGY + 3, R = 3.6, grp = new THREE.Group();
  const tube = tunGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(N.map(([a, b]) => new THREE.Vector3(a, CYc, b))), 240, R, 16, false), CYc); grp.add(new THREE.Mesh(tube, tunM));
  for (const c of [...CHS, {x: N[0][0], z: N[0][1] - 1, r: 4.5}]) { const sg = new THREE.SphereGeometry(c.r, 30, 20); sg.translate(c.x, UGY + c.r * .5, c.z); grp.add(new THREE.Mesh(tunGeo(sg), tunM)); }
  // light shaft down the entrance
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 14, 16, 1, true), new THREE.MeshBasicMaterial({color: new THREE.Color(.5, .42, .32), transparent: true, opacity: .25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide}));
  shaft.position.set(N[0][0], UGY + 7, N[0][1] - 1); grp.add(shaft);
  // egg clusters + green glow in the chambers; the brood core in the last one
  const eggM = new THREE.MeshStandardMaterial({color: 0x6a7a3a, emissive: 0x2a4a08, emissiveIntensity: .9, roughness: .3, transparent: true, opacity: .9});
  CHS.forEach((c, ci) => { for (let i = 0; i < 9; i++) { const a = rnd(0, TAU), rr = c.r * rnd(.6, .85), e = new THREE.Mesh(new THREE.SphereGeometry(rnd(.35, .7), 12, 9), eggM); e.scale.y = 1.3; e.position.set(c.x + Math.cos(a) * rr, UGY + .5, c.z + Math.sin(a) * rr); grp.add(e); }
    TLIGHTS[ci].position.set(c.x, UGY + c.r * .6, c.z); TLIGHTS[ci].intensity = 14; });
  TLIGHTS[3].position.set(N[0][0], UGY + 6, N[0][1] - 1); TLIGHTS[3].color.set(0xffd8a8); TLIGHTS[3].intensity = 20;
  const last = CHS[2], coreM = new THREE.MeshStandardMaterial({color: 0x7a2a10, emissive: 0xff5a10, emissiveIntensity: 1.2, roughness: .35}), core = new THREE.Mesh(new THREE.SphereGeometry(1.7, 28, 20), coreM);
  core.position.set(last.x, UGY + 2.3, last.z); grp.add(core); for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(1.75, .07, 6, 30), new THREE.MeshStandardMaterial({color: 0x2a140a, roughness: .6})); t.position.copy(core.position); t.rotation.set(rnd(0, PI), rnd(0, PI), 0); grp.add(t); }
  TLIGHTS[2].color.set(0xff6a20); TLIGHTS[0].color.set(0x7aff4a); TLIGHTS[1].color.set(0x7aff4a);
  scene.add(grp);
  TUN = {N, CHS, R, grp, core: {x: last.x, y: UGY + 2.3, z: last.z, r: 1.7, hp: 70 + SV.night * 25, hp0: 70 + SV.night * 25, m: core, M: coreM}, trk: 4, col: 0, dead: false, lateT: 0};
  for (const c of CHS.slice(0, 2)) for (let i = 0; i < 2; i++) addItem(pickK(), c.x + rnd(-3, 3), c.z + rnd(-3, 3));
  P.ug = true; P.x = N[0][0]; P.z = N[0][1] + 1; P.yaw = PI - Math.atan2(N[1][0] - N[0][0], N[1][1] - N[0][1]) + PI; P.yaw = Math.atan2(-(N[1][0] - N[0][0]), -(N[1][1] - N[0][1]));
  sky.visible = false; scene.fog.color.set(0x070504); scene.fog.density = .035;
  const n0 = 8 + SV.night * 4; for (let i = 0; i < n0; i++) tunSpawn(false); if (SV.night >= 2) { const b = spawnBug(2, last.x + 3, last.z + 3); if (b) b.st = 0; }
  callout('THE HIVE', 'FIND THE BROOD CORE // KILL IT'); Sfx.play('boom', {vol: .4, rate: .5, lp: 500}); toast('[E] at the light to climb out');
}
function tunSpawn(fx) {
  const N = TUN.N; let i = 0, tries = 0; do { i = 2 + (Math.random() * (N.length - 2) | 0); tries++; } while (tries < 8 && Math.hypot(N[i][0] - P.x, N[i][1] - P.z) < 14);
  const r = Math.random(), type = SV.night >= 2 && r < .08 ? 2 : r < .3 ? 1 : 0, b = spawnBug(type, N[i][0] + rnd(-2, 2), N[i][1] + rnd(-2, 2)); if (!b) return; b.st = 0; if (fx) surfaceFx(b);
}
function tunClamp(x, z, pad) {
  const N = TUN.N, R = TUN.R; let bd = 1e9, bx = x, bz = z;
  for (let i = 0; i < N.length - 1; i++) { const ax = N[i][0], az = N[i][1], ex = N[i + 1][0] - ax, ez = N[i + 1][1] - az, t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1), px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; bx = px; bz = pz; } }
  if (bd <= R - pad) return null; const cs = [...TUN.CHS, {x: N[0][0], z: N[0][1] - 1, r: 4.5}];
  for (const c of cs) if (Math.hypot(x - c.x, z - c.z) <= c.r - pad) return null;
  let nx = bx + (x - bx) * (R - pad) / bd, nz = bz + (z - bz) * (R - pad) / bd, nd = Math.hypot(x - nx, z - nz);
  for (const c of cs) { const dc = Math.hypot(x - c.x, z - c.z), cx = c.x + (x - c.x) * (c.r - pad) / dc, cz = c.z + (z - c.z) * (c.r - pad) / dc, d = Math.hypot(x - cx, z - cz); if (d < nd) { nd = d; nx = cx; nz = cz; } }
  return [nx, nz];
}
function coreHit(p) { const c = TUN.core; c.hp -= has('pierce') ? 1.5 : 1; c.M.emissiveIntensity = 3;
  for (let i = 0; i < 3; i++) PG.add(p.x, p.y, p.z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), rnd(.6, 1.2), rnd(.1, .2), .06, .9, .4, .1, .95, 14, .4, 1);
  if (Sfx.ctx && Sfx.lim('core', 60)) Sfx.play('squelch', {vol: .5, rate: .5}); G.hitT = .12;
  if (c.hp <= 0 && !TUN.dead) { TUN.dead = true; TUN.col = 30; SV.hives = (SV.hives || 0) + 1; c.m.visible = false; G.hs = .12; P.trauma = 1;
    for (let i = 0; i < 40; i++) { const cl = SLIME[(Math.random() * 4) | 0]; PG.add(c.x, c.y, c.z, rnd(-9, 9), rnd(2, 12), rnd(-9, 9), rnd(1, 2.2), rnd(.2, .5), .1, cl[0], cl[1], cl[2], .95, 14, .3, 1); }
    for (let i = 0; i < 14; i++) PA.add(c.x, c.y, c.z, rnd(-6, 6), rnd(0, 8), rnd(-6, 6), rnd(.4, .9), rnd(2, 4), 1, 4, 1.6, .5, 1);
    Sfx.play('boom', {vol: .9, rate: .6}); Sfx.play('screech', {vol: .7, rate: .35, vr: 0}); TLIGHTS[2].color.set(0xff2a10);
    callout('BROOD CORE DOWN', 'THE HIVE IS COLLAPSING // GET OUT'); for (const b of bugs) if (!b.dead && b.z > 450) b.stag = 1.5; }
}
function hiveStep(dt) {
  if (!TUN) return;
  const c = TUN.core; if (!TUN.dead) { c.M.emissiveIntensity = mix(c.M.emissiveIntensity, 1.1 + Math.sin(G.t * 3) * .4, Math.min(1, dt * 4)); c.m.scale.setScalar(1 + Math.sin(G.t * 3) * .04); TLIGHTS[2].intensity = 12 + Math.sin(G.t * 3) * 5; }
  if (!TUN.dead && (TUN.trk -= dt) <= 0) { TUN.trk = SV.day > .01 ? Math.max(2, 6 - SV.night * .6) : .7; let n = 0; for (const b of bugs) if (!b.dead && b.z > 450) n++; if (n < 40) tunSpawn(true); }
  if (TUN.dead) { TUN.col -= dt; P.trauma = Math.max(P.trauma, .25 + (TUN.col < 10 ? .3 : 0));
    if (Math.random() < dt * 25) PS.add(P.x + rnd(-6, 6), UGY + 6, P.z + rnd(-6, 6), rnd(-.3, .3), rnd(-3, -1), rnd(-.3, .3), rnd(1, 2), .3, 1.5, .4, .3, .22, .5, 6, .5);
    if (Math.random() < dt * 1.5 && Sfx.ctx) Sfx.play('boom', {vol: .35, rate: rnd(.5, .8), lp: 500});
    if (TUN.col <= 0) { G.hurtT = 0; G.shield = 0; G.hp = Math.max(0, G.hp - dt * 12); if (G.hp <= 0) overrun(); } }
  if (SV.day <= .01 && (TUN.lateT -= dt) <= 0) { TUN.lateT = 4; toast('NIGHT IS FALLING: GET OUT OF THE HIVE'); }
}
function exitHive() {
  const won = TUN.dead; P.ug = false; scene.remove(TUN.grp); TUN.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  for (const b of bugs.slice()) if (b.z > 450) freeBug(b); for (let i = SV.items.length - 1; i >= 0; i--) if (SV.items[i].z > 450) { scene.remove(SV.items[i].m); SV.items.splice(i, 1); }
  for (const l of TLIGHTS) { l.intensity = 0; l.position.set(0, -500, 0); }
  TUN = null; sky.visible = true; scene.fog.color.copy(FOG); scene.fog.density = .00105; P.x = HOLE.x + 3; P.z = HOLE.z + 1;
  if (won) { scene.remove(HOLE.m); HOLE = null; callout('HIVE DESTROYED', 'FEWER BUGS TONIGHT // BONUS PERK'); Sfx.play('horn', {vol: .45, rate: 1.4, vr: 0});
    SV.offer = PERKS.filter(q => !has(q.id)).sort(() => Math.random() - .5).slice(0, 3); showPerks(); }
  else toast('Back on the surface');
}
const grid = new Map();
const cellPool = () => { const a = []; let i = 0; return {reset() { i = 0; }, get() { const c = a[i] || (a[i] = []); i++; c.length = 0; return c; }}; }, GP = cellPool(), CP = cellPool();
function stepBugsHost(dt) {
  if (G.over) return;
  let live = 0; for (const b of bugs) if (!b.dead) live++;
  // endless: spawn nonstop (a little faster when the field thins out so it never goes quiet), threat level rises every LEVEL_T s
  SV.live = live;
  if (SURV()) survSpawn(dt, live);
  else { G.spawnAcc += dt * spawnRate(G.wave) * (live < 60 ? 2 : 1); while (G.spawnAcc > 1) { G.spawnAcc--; if (live < 720) { spawnOne(); live++; } else { G.spawnAcc = 0; break; } }
  if ((G.gap += dt) > LEVEL_T) startWave(G.wave + 1); }
  const spm = Math.min(2, 1 + G.wave * .05);
  grid.clear(); GP.reset();
  const cell = (x, z) => (Math.floor(x / 3) + 500) * 1000 + Math.floor(z / 3) + 500;
  for (const b of bugs) { if (b.dead) continue; const k = cell(b.x, b.z); let c = grid.get(k); if (!c) grid.set(k, c = GP.get()); c.push(b); }
  let attackers = 0, dmg = 0;
  for (const b of bugs) {
    if (b.dead) continue;
    const goalZ = -3.4 - b.s * 1.5 - Math.pow(Math.abs(b.tx) / 13, 2) * 2.2;
    const sv = SURV(), fl = sv && SV.day > 0 && b.z < 450, dx = fl ? b.x * 9 : sv ? P.x - b.x : b.tx - b.x, dz = fl ? b.z * 9 + 1 : sv ? P.z - b.z : goalZ - b.z, d = Math.hypot(dx, dz) || 1e-3;
    if (b.st === 2) { b.vy -= 18 * dt; b.y += b.vy * dt; const f = b.T.sp * 7.5 * spm; b.x += dx / d * f * 1.6 * dt; b.z += dz / d * f * 1.6 * dt; const gy = gH(b.x, b.z); if (b.y <= gy) { b.y = gy; b.st = 0; } b.sp = 0; continue; }
    if (b.st === 3) { const sp = b.T.sp * 7 * spm * 1.5, st = Math.min(sp * dt, d); b.x += dx / d * st; b.z += dz / d * st; b.y = gH(b.x, b.z); b.sp = sp; b.yaw = Math.atan2(dx, dz);
      if (Math.random() < dt * 8) PS.add(b.x, b.y + .1, b.z, rnd(-1, 1), rnd(.5, 1.5), rnd(-1, 1), rnd(.8, 1.4), .4, 1.6, .62, .42, .28, .5, 1, 1);
      if (d < 28) { b.st = 0; surfaceFx(b); } continue; }
    if (b.T.spit && (sv ? d < 30 : Math.hypot(b.x, b.z) < 42)) { b.st = 1; b.sp = 0; b.yaw += angD(b.yaw, sv ? Math.atan2(dx, dz) : Math.atan2(-b.x, -b.z)) * Math.min(1, dt * 4);
      if ((b.atkT -= dt) <= 0) { b.atkT = rnd(2.6, 3.8); if (sv) spit(b, P.x + rnd(-2.5, 2.5), P.z + rnd(-2.5, 2.5)); else { const tx = rnd(-11, 11); spit(b, tx); G.evq.push(['g', b.id, Math.round(tx * 10)]); } } continue; }
    if (d < (sv ? .9 + .55 * b.s : .8)) { b.st = 1; b.sp = 0; attackers++; dmg += b.T.dps * (b.legs === 63 ? 1 : .7); b.yaw += angD(b.yaw, sv ? Math.atan2(dx, dz) : Math.atan2(-b.x, -b.z)) * dt * 4; }
    else {
      b.st = 0; let sp = b.T.sp * 7 * spm;
      if ((b.legs & 15) !== 15) sp *= ((b.legs & 15) ? .65 : .4) + .3 * Math.abs(Math.sin(b.ph)); // limping: lurches along
      if (b.stag > 0) { b.stag -= dt; sp *= .35; }
      sp *= .8 + .4 * (.5 + .5 * Math.sin(b.t * 1.3 + b.wf * 7)); // surges: scuttle, slow, scuttle
      if (sv && inLine(b.x, b.z)) sp *= .4; // clambering over the sandbags
      const wv = Math.sin(b.t * b.wf) * b.weave * Math.min(1, d / 30);
      let ux = dx / d, uz = dz / d; const px = -uz, pz = ux; ux += px * wv; uz += pz * wv;
      // separation
      const k0 = cell(b.x, b.z); let ov = 0;
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const c = grid.get(k0 + gx * 1000 + gz); if (!c) continue;
        for (const o of c) { if (o === b) continue; const ox = b.x - o.x, oz = b.z - o.z, od = ox * ox + oz * oz, rr = (b.s + o.s) * .9; if (od < rr * rr && od > 1e-4) { const f = (rr - Math.sqrt(od)) * 2; ux += ox * f; uz += oz * f; ov += f; } } }
      const ul = Math.hypot(ux, uz) || 1; const step = Math.min(sp * dt, d);
      b.x += ux / ul * step; b.z += uz / ul * step; b.sp = sp;
      b.yaw += angD(b.yaw, Math.atan2(ux, uz)) * Math.min(1, dt * 6);
      // jammed against the line the horde climbs over itself
      b.clm = mix(b.clm || 0, d < 14 && !b.T.titan ? Math.min(1.8 * b.s, ov * .55) : 0, Math.min(1, dt * 3)); b.y = gH(b.x, b.z) + b.clm;
      if (b.T.leap && d > 18 && d < 45 && b.leapT <= 0 && Math.random() < dt * .8) { b.st = 2; b.vy = 9; b.leapT = 6; if (Sfx.ctx && Sfx.lim('scr', 300)) { const a = Sfx.at(b.x, b.z); Sfx.play('screech', {vol: .3 * a.vol, pan: a.pan, rate: rnd(.9, 1.3)}); } }
      b.leapT -= dt;
    }
  }
  // damage to the line
  if (dmg > 0) { hurt(4 * Math.pow(dmg / 4, .5) * dt); }
  G.attackers = attackers;
}
function hurt(d) {
  G.hurtT = 0; const s = Math.min(G.shield, d); G.shield -= s; d -= s; G.hp = Math.max(0, G.hp - d * (SURV() ? .45 * (has('plate') ? .75 : 1) : .2));
  if (G.hp < 30 && !G.lowWarn) { G.lowWarn = true; setTimeout(() => radio('low'), 1500); callout('ARMOUR CRITICAL', 'CLEAR THE BARRICADE'); Sfx.play('alarm', {vol: .5, vr: 0}); if (isHost()) G.evq.push(['a']); }
  if (G.hp > 45) G.lowWarn = false;
  G.dmgFlash = Math.min(1, G.dmgFlash + .03); P.trauma = Math.min(1, P.trauma + .015);
  if (Sfx.ctx && Sfx.lim('zap', 400)) Sfx.play('zap', {vol: .45});
  if (G.hp <= 0 && !G.over) overrun();
}
const CGRID = new Map(), cgK = (x, z) => (Math.floor(x / 2) + 1000) * 4000 + Math.floor(z / 2) + 1000;
const CORPSE_T = 14; // corpses stay long enough to pile up at the line
function stepBugsCommon(dt, time) {
  // rebuild the corpse grids: settled bodies stack into PILE, every body goes into CGRID so the living can shove it
  PILE.clear(); CGRID.clear(); CP.reset();
  for (const b of bugs) { if (!b.dead || b.gib || b.T.titan) continue;
    const ck = cgK(b.x, b.z); let c = CGRID.get(ck); if (!c) CGRID.set(ck, c = CP.get()); c.push(b);
    if (b.dead > .7 && b.dead < CORPSE_T - 2) { const k = pileK(b.x, b.z); PILE.set(k, Math.min(2.6, (PILE.get(k) || 0) + .42 * b.s * b.s)); } }
  for (let i = bugs.length - 1; i >= 0; i--) {
    const b = bugs[i]; b.t += dt; b.flash = Math.max(0, b.flash - dt * 8);
    b.hk = (b.hk || 0) * Math.exp(-dt * 11);
    if (b.dead) { b.dead += dt; if (b.dead > (b.gib ? 1 : CORPSE_T)) { freeBug(b); continue; }
      const rr = b.T.s > 2 ? (b.T.titan ? 1.6 : 3.5) : 7; b.roll += clamp(b.droll - b.roll, -rr * dt, rr * dt); b.pitch *= .9;
      // while it's still moving it can land on the pile; once settled its own weight is part of the pile, so keep the height it found
      if (b.dead < .7) b.py = mix(b.py || 0, pileAt(b.x, b.z), Math.min(1, dt * 8));
      const gy = gH(b.x, b.z) + (b.py || 0); b.dvy -= 20 * dt; b.y += b.dvy * dt;
      if (b.y <= gy) { b.y = gy;
        if (b.dvy < -3) { b.dvy *= -.3; b.dspin *= .6; b.dvx *= .7; b.dvz *= .7; if (b.dvy > 1.2 && b.dead > .15) dustPuff(b.x, b.y, b.z, b.s); } else b.dvy = 0;
        const f = Math.exp(-dt * (b.T.s > 2 ? 6 : 3.2)); b.dvx *= f; b.dvz *= f; b.dspin *= Math.exp(-dt * 3.5); }
      b.x += b.dvx * dt; b.z += b.dvz * dt; b.dyaw += b.dspin * dt;
      const near = (b.x - P.x) ** 2 + b.z * b.z < 4900;
      if (near && !b.gib && b.dead < 1.6 && Math.random() < dt * 16) { const c = bugCenter(b, _v), cl = SLIME[(Math.random() * 4) | 0], f = 1 - b.dead / 1.6; // ichor pumping out
        PG.add(c.x + Math.sin(b.yaw) * .5 * b.s, c.y, c.z + Math.cos(b.yaw) * .5 * b.s, rnd(-1.5, 1.5), rnd(2, 6) * f, rnd(-1.5, 1.5), rnd(.8, 1.4), rnd(.08, .18) * b.s, .06, cl[0], cl[1], cl[2], .95, 14, .4, 1); }
      if (near && b.y <= gy + .05 && b.dvx * b.dvx + b.dvz * b.dvz > 4 && Math.random() < dt * 12) dustPuff(b.x, b.y, b.z, b.s * .7); // skid dust
    }
    else { b.ph += dt * (b.sp * 2.7 / b.s + (b.st === 1 ? 0 : .3)); // matches the planted-foot stride, so feet don't skate
      if (TUN && b.z > 450) { const q = tunClamp(b.x, b.z, .5 * b.s); if (q) { b.x = q[0]; b.z = q[1]; } }
      { const fx = Math.sin(b.yaw) * 1.5 * b.s, fz = Math.cos(b.yaw) * 1.5 * b.s, sl = (gH(b.x + fx, b.z + fz) + pileAt(b.x + fx, b.z + fz) * .85 - gH(b.x - fx, b.z - fz) - pileAt(b.x - fx, b.z - fz) * .85) / (3 * b.s);
        if (b.st !== 2) b.pitch += (-Math.atan(sl) * .8 - b.pitch) * Math.min(1, dt * 5); } // body follows the slope and the pile
      // climb over the dead
      b.py = mix(b.py || 0, b.st === 2 ? 0 : pileAt(b.x, b.z) * .85, Math.min(1, dt * 6));
      // shove corpses out of the way (pushes them along, spins them a little)
      if (b.st !== 2 && b.st !== 3 && b.sp > .5) { const k0 = cgK(b.x, b.z);
        for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const c = CGRID.get(k0 + gx * 4000 + gz); if (!c) continue;
          for (const o of c) { const ox = o.x - b.x, oz = o.z - b.z, od = Math.hypot(ox, oz), rr = (b.s + o.s) * .75; if (od > rr || od < 1e-3) continue;
            const push = (rr - od) / rr * b.sp * .5 * b.s / o.s; o.dvx += ox / od * push * dt * 6; o.dvz += oz / od * push * dt * 6; o.dspin += (Math.random() - .5) * push * dt * 4; } } } }
  }
}
function dustPuff(x, y, z, s) { for (let i = 0; i < 2; i++) PS.add(x + rnd(-.4, .4) * s, y + .1, z + rnd(-.4, .4) * s, rnd(-.8, .8), rnd(.3, 1), rnd(-.8, .8), rnd(1, 1.8), .3 * s, 1.4 * s, .55, .45, .36, .3, -.1, 1.5); }

// ---------------- guest: apply snapshots
function applySnap(m) {
  const seen = new Set(), a = m.b;
  for (let i = 0; i < a.length; i += 6) {
    const id = a[i], x = a[i + 1] / 10, z = a[i + 2] / 10, yaw = a[i + 3] / 100, f = a[i + 4], y = a[i + 5] / 10;
    let b = byId.get(id); if (!b) { b = spawnBug(f & 7, x, z, id); if (!b) continue; if (b.T.titan) G.titan = b; }
    if (b.dead) continue;
    seen.add(id); b.vx = (x - b.nx) * 10; b.vz = (z - b.nz) * 10; b.nx = x; b.nz = z; b.nyaw = yaw; b.ny = y; b.age = 0;
    const st = (f >> 3) & 3; if (b.st === 3 && st !== 3) surfaceFx(b); b.st = st; if (f >> 11) { b.hp = f >> 11; b.hp0 = Math.max(b.hp0, b.hp); } const lg = (f >> 5) & 63; if (lg !== b.legs) { for (let k = 0; k < 6; k++) if ((b.legs & (1 << k)) && !(lg & (1 << k))) legOffFx(b, k); b.legs = lg; }
  }
  for (const b of bugs.slice()) if (!b.dead && !seen.has(b.id)) freeBug(b);
  for (const e of m.e || []) {
    if (e[0] === 'k') { const b = byId.get(e[1]); if (b) { const g = [...G.gunners.values()].find(q => q.slot === e[2]); killBug(b, null); if (g && g.id === myId()) myKill(b); } }
    else if (e[0] === 'w') startWave(e[1]);
    else if (e[0] === 'c') heldFx(e[1]);
    else if (e[0] === 'b') bruteWarn();
    else if (e[0] === 'g') { const b = byId.get(e[1]); if (b) spit(b, e[2] / 10); }
    else if (e[0] === 'T') titanWarn();
    else if (e[0] === 'n') { G.seen |= 1 << e[1]; newTypeWarn(e[1]); }
    else if (e[0] === 'R') gunRun(e[1] / 10, e[2]);
    else if (e[0] === 'S') dropSentry(e[1]);
    else if (e[0] === 'D') { if (!CANS.has(e[1])) dropCan(e[1], e[2] / 10, e[3] / 10, e[4]); }
    else if (e[0] === 'O') { const c = CANS.get(e[1]); if (c) popCan(c); }
    else if (e[0] === 'X') { const c = CANS.get(e[1]); if (c) popGone(c); }
    else if (e[0] === 'f') ffNote(e[1], e[2]);
    else if (e[0] === 'a') { callout('ARMOUR CRITICAL', 'CLEAR THE BARRICADE'); Sfx.play('alarm', {vol: .5, vr: 0}); }
  }
  G.shield = m.sh; G.hp = m.hp; G.kills = m.k; G.wave = m.w; G.ff = !!m.ff; if (m.sp !== undefined) { G.sup = m.sp / 100; G.supN = m.sn; G.buff = m.bf ? {k: m.bf[0], t: m.bf[1] / 10} : null; G.dropT = m.dt; }
  if (m.q !== undefined) { G.quota = m.q; G.gap = m.gp / 10; G.cleared = !!m.cl; G.bruteSeen = !!m.bs; }
  if (m.hurt) { G.hurtT = 0; G.dmgFlash = Math.min(1, G.dmgFlash + .1); }
  for (const r of m.g) { const g = G.gunners.get(r[0]); if (!g) continue; g.kills = r[3]; if (r[0] !== myId()) { g.yaw = r[1] / 100; g.fire = r[2]; if (r[4] !== undefined) g.pitch = r[4] / 100; } }
}
function stepBugsGuest(dt) {
  for (const b of bugs) { if (b.dead) continue; b.age = (b.age || 0) + dt; const ex = Math.min(b.age, .25);
    const tx = b.nx + (b.vx || 0) * ex, tz = b.nz + (b.vz || 0) * ex, k = Math.min(1, dt * 12);
    b.x += (tx - b.x) * k; b.z += (tz - b.z) * k; b.yaw += angD(b.yaw, b.nyaw) * k; b.sp = Math.hypot(b.vx || 0, b.vz || 0);
    b.y = b.st === 2 ? mix(b.y, b.ny, k) : gH(b.x, b.z);
    if (b.st === 3 && Math.random() < dt * 8) PS.add(b.x, b.y + .1, b.z, rnd(-1, 1), rnd(.5, 1.5), rnd(-1, 1), rnd(.8, 1.4), .4, 1.6, .62, .42, .28, .5, 1, 1); }
}
function packSnap() {
  const a = [];
  for (const b of bugs) { if (b.dead) continue; a.push(b.id, Math.round(b.x * 10), Math.round(b.z * 10), Math.round(b.yaw * 100), b.type | (b.st << 3) | (b.legs << 5) | (clamp(Math.ceil(b.hp), 0, 4000) << 11), Math.round(b.y * 10)); }
  const g = [...G.gunners.values()].map(q => [q.id, Math.round(q.yaw * 100), q.fire ? 1 : 0, q.kills, Math.round(q.pitch * 100)]);
  const m = {t: 's', b: a, e: G.evq, g, sh: Math.round(G.shield), hp: Math.round(G.hp * 10) / 10, k: G.kills, w: G.wave, hurt: G.hurtT < .15 ? 1 : 0, q: G.quota, gp: Math.round(G.gap * 10), cl: G.cleared ? 1 : 0, bs: G.bruteSeen ? 1 : 0, rt: Math.round(G.runT), sp: Math.round(G.sup * 100), sn: G.supN, bf: G.buff ? [G.buff.k, Math.round(G.buff.t * 10)] : 0, dt: Math.round(G.dropT), ff: G.ff ? 1 : 0};
  G.evq = []; return m;
}
function crewMsg() { return {t: 'crew', crew: [...G.gunners.values()].filter(g => !g.sentry).map(g => [g.id, g.slot, g.name, g.id === 'H' ? 0 : (g.j || 99)])}; }
Net.on('_join', m => { const p = Net.peers.get(m.id), g = addGunner(p.id, p.slot, p.name); g.j = p.j; g.kills = Math.max(g.kills, p.kills || 0); Net.send(crewMsg()); Net.send1(m.id, {t: 'start', wave: G.wave}); if (!(G.migT > 0)) toast(p.name + ' joined the line'); });
Net.on('_left', m => { if (!G.gunners.has(m.id)) return; removeGunner(m.id); Net.send(crewMsg()); toast(m.name + ' left'); });
Net.on('aim', (m, id) => { const g = G.gunners.get(id); if (g) { g.yaw = clamp(+m.y || 0, -1.6, 1.6); g.pitch = clamp(+m.p || 0, -.6, .45); g.fire = m.f ? 1 : 0; g.ads = m.a ? 1 : 0; } });
Net.on('crew', m => { const ids = new Set(), h0 = G.gunners.get('H'), hn = h0 && h0.name; for (const [id, slot, name, j] of m.crew) { ids.add(id); addGunner(id, slot, name).j = j; } if (hn && G.gunners.get('H') && G.gunners.get('H').name !== hn && G.hostMoved) toast(G.gunners.get('H').name + ' took over the squad'); for (const [id, g] of [...G.gunners]) if (!ids.has(id) && !g.sentry) removeGunner(id); });
Net.on('start', m => { if (!G.on || G.over) beginGame(false); G.wave = m.wave; netStatus('In squad ' + Net.code); });
Net.on('s', m => { if (Net.role === 'guest' && G.on) applySnap(m); });
Net.on('over', m => { if (Net.role === 'guest') overrun(m); });
Net.on('restart', () => { if (Net.role === 'guest') beginGame(false); });
// ---------------- host migration
// The longest-connected guest (lowest join order j) takes over the bug sim on the same room code. A host that quits says 'bye'
// first, naming its successor, so the handover is instant; if the host just drops, the successor waits 1.5 s for a quick
// reconnect, and the next in line steps in 2.5 s later if the first never shows up.
function successors() { return [...G.gunners.values()].filter(g => g.id !== 'H' && !g.sentry).sort((a, b) => (a.j || 99) - (b.j || 99) || (a.id < b.id ? -1 : 1)); }
function hostBye() { if (Net.role !== 'host' || !Net.peers.size) return; const p = [...Net.peers.values()].sort((a, b) => a.j - b.j)[0]; Net.send({t: 'bye', next: p.id}); }
function becomeHost() {
  if (Net.role !== 'guest') return; clearTimeout(G.goneT); G.hostDown = false;
  const me = G.gunners.get(Net.id), seq = Math.max(0, ...[...G.gunners.values()].map(g => g.j || 0));
  removeGunner('H'); let slot = 0;
  if (me) { G.gunners.delete(Net.id); me.id = 'H'; me.j = 0; G.gunners.set('H', me); slot = me.slot; }
  Net.promote(hostStatus, slot, seq);
  if (!me) addGunner('H', slot, SET.name);
  // take over the sim from the interpolated view: settle positions, ids carry on, leapers drop out of the air
  let mx = 0; for (const b of bugs) { mx = Math.max(mx, b.id); if (b.dead) continue; b.x = b.nx; b.z = b.nz; if (b.st === 2) { b.vy = 0; } }
  nextId = mx + 1; G.evq = []; if (G.titan && (G.titan.dead || !byId.has(G.titan.id))) G.titan = null; G.sendT = 0; G.migT = 6;
  if (!G.wave) startWave(1);
  toast('Host left. You are running the squad now'); $('pCode').textContent = 'Squad code ' + Net.code;
  if (G.over) showEnd($('endH').textContent, $('endSub').textContent, G.wave, G.kills, G.runT, $('endB').textContent);
}
function hostStatus(st) { netStatus(st === 'open' ? 'Squad open. Code ' + Net.code : 'Reconnecting to relay...'); }
function rejoinAsGuest(slot) { // our host socket was replaced (or we dropped) and someone else runs the room now
  const me = G.gunners.get('H'); G.gunners.delete('H');
  Net.join(Net.code, SET.name, why => { if (why === 'No such squad code.' && G.on) { const g = G.gunners.get(Net.id); Net.host0(Net.code); if (g) { G.gunners.delete(g.id); g.id = 'H'; G.gunners.set('H', g); } G.migT = 6; toast('Squad reopened'); return; } joinFail(why); });
  if (me) { me.id = Net.id; me.j = 99; G.gunners.set(Net.id, me); }
  for (const b of bugs) { b.nx = b.x; b.nz = b.z; b.nyaw = b.yaw; b.ny = b.y; b.age = 0; }
  G.hostMoved = true; toast('Rejoining the squad...');
}
Net.helloX = () => { const g = localGunner(); return g ? {slot: g.slot, kills: g.kills, j: g.j || 0} : {}; };
Net.on('bye', m => { if (Net.role !== 'guest') return; G.hostMoved = true; if (m.next === Net.id) becomeHost(); else { G.hostDown = true; clearTimeout(G.goneT); G.goneT = setTimeout(becomeHost, 6000); } });
Net.on('_hostgone', () => {
  if (Net.role !== 'guest' || G.hostDown && G.goneT) return; G.hostDown = true; G.hostMoved = true; toast('Host disconnected');
  const r = Math.max(0, successors().findIndex(g => g.id === Net.id)); clearTimeout(G.goneT); G.goneT = setTimeout(() => { if (G.hostDown) becomeHost(); }, 1500 + r * 2500);
});
Net.on('_hostback', () => { clearTimeout(G.goneT); G.goneT = 0; if (G.hostDown) toast('Squad link restored'); G.hostDown = false; });
Net.on('_replaced', () => rejoinAsGuest());
Net.on('_hostlost', () => rejoinAsGuest());

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
// off-screen pointer at the left or right edge (a > 0 = to your left); stacks per side
const EDGE = [0, 0];
function edgeMark(c, a, col, txt, w, h, time) {
  const L = a > 0, x = L ? 22 : w - 22, y = h * .4 + EDGE[L ? 0 : 1]++ * 34, s = 9 * (1 + Math.sin(time * 8) * .15), d = L ? -1 : 1;
  c.strokeStyle = c.fillStyle = col; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - d * s * .7, y - s); c.lineTo(x + d * s * .5, y); c.lineTo(x - d * s * .7, y + s); c.stroke(); c.lineWidth = 1.5;
  c.font = '11px "Share Tech Mono",monospace'; c.fillText(txt, L ? x + 12 : x - 12 - c.measureText(txt).width, y + 4); c.font = '13px "Share Tech Mono",monospace';
}
function drawHud(dt, time) {
  const w = innerWidth, h = innerHeight, c = hx; c.clearRect(0, 0, w, h); EDGE[0] = EDGE[1] = 0;
  G.tagT = (G.tagT || 0) - dt; G.thrT = (G.thrT || 0) - dt;
  const fl = .8;
  c.globalAlpha = fl; c.lineWidth = 1.5; c.font = '13px "Share Tech Mono",monospace';
  // crosshair
  const cx = w / 2, cy = h / 2, gap = 7 + P.bloom * 6;
  c.strokeStyle = CY + '.85)'; c.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(cx + dx * gap, cy + dy * gap); c.lineTo(cx + dx * (gap + 9), cy + dy * (gap + 9)); }
  c.stroke(); c.beginPath(); c.arc(cx, cy, 1.5, 0, TAU); c.fillStyle = CY + '.9)'; c.fill();
  c.strokeStyle = CY + '.25)'; c.beginPath(); c.arc(cx, cy, 70 + P.bloom * 20, -.6, .6); c.stroke(); c.beginPath(); c.arc(cx, cy, 70 + P.bloom * 20, PI - .6, PI + .6); c.stroke();
  if (G.hitT > 0 || G.killT > 0) { const k = G.killT > 0; c.strokeStyle = k ? 'rgba(255,120,60,.95)' : 'rgba(230,255,230,.9)'; c.lineWidth = k ? 3 : 2; c.beginPath(); const r0 = 8, r1 = k ? 20 : 15; for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(cx + dx * r0, cy + dy * r0); c.lineTo(cx + dx * r1, cy + dy * r1); } c.stroke(); c.lineWidth = 1.5; }
  // the bug the rounds are going into: thin brackets on it, so you see exactly what you're hitting
  { const lg = localGunner(), t = lg && lg.tgt; if (t && !t.dead && P.firing) { bugCenter(t, _v).project(cam); if (_v.z < 1) { const sx = (_v.x * .5 + .5) * w, sy = (-_v.y * .5 + .5) * h, d = Math.hypot(t.x - P.x, t.z - P.z), r = clamp(1.1 * t.s / Math.max(d, 1) / Math.tan(cam.fov * PI / 360) * h / 2, 7, 60);
    c.strokeStyle = 'rgba(235,240,230,.55)'; c.lineWidth = 1.2; c.beginPath(); for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(sx + dx * r, sy + dy * (r - 5)); c.lineTo(sx + dx * r, sy + dy * r); c.lineTo(sx + dx * (r - 5), sy + dy * r); } c.stroke(); c.lineWidth = 1.5;
    if (t.hp0 > 2 && !t.T.titan) { const k = clamp(t.hp / t.hp0, 0, 1), bw2 = Math.max(2 * r, 34); c.fillStyle = 'rgba(2,20,22,.6)'; c.fillRect(sx - bw2 / 2, sy + r + 5, bw2, 4); c.fillStyle = k < .3 ? 'rgba(255,110,70,.95)' : 'rgba(235,240,230,.85)'; c.fillRect(sx - bw2 / 2, sy + r + 5, bw2 * k, 4); } } } }
  // damage direction arcs
  for (const d of G.dmgDirs) { const a = angD(P.yaw, d.a); c.strokeStyle = `rgba(255,60,40,${d.t})`; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, 150, -PI / 2 - a - .25, -PI / 2 - a + .25); c.stroke(); }
  c.lineWidth = 1.5;
  // radar
  const full = SURV() && P.foot, ARC = full ? PI : 1.3, R = full ? 78 : 95, rx = full ? 104 : 120, ry = full ? h - 150 : h - 120, RNG = full ? 150 : 200;
  c.fillStyle = 'rgba(2,20,22,.45)'; c.beginPath(); c.moveTo(rx, ry); c.arc(rx, ry, R, -PI / 2 - ARC, -PI / 2 + ARC); c.closePath(); c.fill();
  c.strokeStyle = CY + '.5)'; c.stroke(); for (const r of [R / 3, R * 2 / 3]) { c.beginPath(); c.arc(rx, ry, r, -PI / 2 - ARC, -PI / 2 + ARC); c.strokeStyle = CY + '.18)'; c.stroke(); }
  if (full) { c.fillStyle = CY + '.9)'; c.beginPath(); c.moveTo(rx, ry - 6); c.lineTo(rx + 4, ry + 4); c.lineTo(rx - 4, ry + 4); c.closePath(); c.fill(); } // you, facing up
  const sw = full ? (time * 1.6) % TAU - PI : (time * 1.6) % 2.6 - 1.3; c.strokeStyle = CY + '.6)'; c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + Math.sin(sw) * R, ry - Math.cos(sw) * R); c.stroke();
  let nLive = 0; for (const b of bugs) { if (b.dead) continue; nLive++; const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz); if (d > RNG) continue; const a = angD(P.yaw, Math.atan2(-dx, -dz)); if (Math.abs(a) > ARC) continue;
    const rr = d / RNG * R, px = rx - Math.sin(a) * rr, py = ry - Math.cos(a) * rr, near = Math.abs(angD(-a, sw)) < .3;
    const big = b.T.titan ? 9 : b.type === 2 ? 5 : 3; c.fillStyle = b.T.titan ? 'rgba(255,60,90,1)' : b.type === 2 ? 'rgba(255,150,60,.95)' : b.type === 3 ? 'rgba(150,255,80,.9)' : b.st === 3 ? 'rgba(220,170,120,.5)' : `rgba(255,${near ? 230 : 90},70,${near ? 1 : .7})`;
    if (b.st === 3) { c.beginPath(); c.arc(px, py, 3, 0, TAU); c.fill(); } else c.fillRect(px - big / 2, py - big / 2, big, big); }
  c.fillStyle = CY + '.8)'; c.fillText('MOTION TRACKER', rx - 52, ry + (full ? R + 20 : 22)); c.fillText(String(nLive).padStart(3, '0') + ' CONTACTS', rx - 44, ry + (full ? R + 36 : 38));
  // right panel: shield, armour, heat
  const bx = w - 300, by = h - 120;
  const shDown = G.shBroke && G.shield < 99.5, blink = shDown && (time * 4 | 0) % 2 === 0;
  c.fillStyle = shDown ? (blink ? 'rgba(255,110,80,.95)' : 'rgba(255,110,80,.6)') : CY + '.8)'; c.fillText(shDown ? 'SHIELD DOWN' : 'SHIELD', bx, by); c.fillText((G.shield | 0) + '%', bx + 240, by);
  c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(bx, by + 6, 270, 10);
  if (G.shFlash > 0) { c.strokeStyle = `rgba(255,90,60,${G.shFlash})`; c.lineWidth = 2; c.strokeRect(bx - 3, by + 3, 276, 16); c.lineWidth = 1.5; } c.fillStyle = G.shield < 30 ? 'rgba(255,90,60,.9)' : CY + '.85)'; c.fillRect(bx, by + 6, 270 * G.shield / 100, 10);
  c.fillStyle = CY + '.8)'; c.fillText('ARMOUR', bx, by + 36);
  for (let i = 0; i < 10; i++) { c.fillStyle = G.hp > i * 10 + 5 ? (G.hp < 35 ? 'rgba(255,90,60,.9)' : 'rgba(200,255,250,.85)') : 'rgba(255,255,255,.1)'; c.fillRect(bx + i * 27, by + 42, 23, 8); }
  if (!(SURV() && P.foot)) { // cannon readouts (hidden while you carry the rifle)
  const heat = P.heat; c.fillStyle = CY + '.8)'; c.fillText(P.vent > 0 ? 'VENTING' : 'BARREL TEMP', bx, by + 70); c.fillText(((P.spin * 2200) | 0) + ' RPM', bx + 190, by + 70);
  c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(bx, by + 76, 270, 8);
  const hg = c.createLinearGradient(bx, 0, bx + 270, 0); hg.addColorStop(0, '#ff8a2a'); hg.addColorStop(.7, '#ffd27a'); hg.addColorStop(1, '#ffffff'); c.fillStyle = hg; c.fillRect(bx, by + 76, 270 * heat, 8);
  c.fillStyle = CY + '.55)'; c.fillText('AUTO-FIRE ' + (SET.auto ? 'ON' : 'OFF') + '  [F]   AIM [Q]' + (G.ff ? '   FF ON' : ''), bx, by + 100); }
  if (SURV()) { c.font = '700 22px Rajdhani,sans-serif'; c.fillStyle = (P.foot ? SV.mag === 0 : SV.belt <= 0) ? 'rgba(255,90,60,.95)' : '#fff';
    c.fillText(P.foot ? (SV.rel > 0 ? 'RELOADING' : SV.mag + ' / ' + SV.res) : 'BELT ' + SV.belt, bx, by - 34); c.font = '12px "Share Tech Mono",monospace'; c.fillStyle = CY + '.7)'; c.fillText(P.foot ? 'RIFLE  [R] RELOAD  [E] GUN' : 'CANNON  [E] GET OFF', bx, by - 18); c.font = '13px "Share Tech Mono",monospace';
    { const nearHole = HOLE && !TUN && SV.day > 0 && Math.hypot(P.x - HOLE.x, P.z - HOLE.z) < 4, nearExit = TUN && Math.hypot(P.x - TUN.N[0][0], P.z - TUN.N[0][1]) < 4; if (P.foot && (nearHole || nearExit)) { c.font = '700 18px Rajdhani,sans-serif'; c.fillStyle = '#fff'; const tx = nearHole ? '[E] GO DOWN INTO THE HIVE' : '[E] CLIMB OUT'; c.fillText(tx, w / 2 - c.measureText(tx).width / 2, h * .62); c.font = '13px "Share Tech Mono",monospace'; } }
    if (TUN) { c.font = '700 16px Rajdhani,sans-serif'; c.fillStyle = TUN.dead ? 'rgba(255,90,60,.95)' : '#ffd27a'; const tx = TUN.dead ? 'HIVE COLLAPSING: GET OUT ' + Math.max(0, Math.ceil(TUN.col)) + 'S' : 'BROOD CORE ' + Math.max(0, Math.ceil(TUN.core.hp / TUN.core.hp0 * 100)) + '%'; c.fillText(tx, w / 2 - c.measureText(tx).width / 2, 96); c.font = '13px "Share Tech Mono",monospace'; }
    if (P.foot && !P.ug && Math.hypot(P.x, P.z - .3) < 2.3) { c.font = '700 18px Rajdhani,sans-serif'; c.fillStyle = '#fff'; const tx = '[E] MAN THE CANNON'; c.fillText(tx, w / 2 - c.measureText(tx).width / 2, h * .62); c.font = '13px "Share Tech Mono",monospace'; }
    const MK = SV.items.map(it => ({x: it.x, y: it.m.position.y + .7, z: it.z, c: ITEMK[it.k].c, n: ITEMK[it.k].n.split(' ')[0], r: 90}));
    if (HOLE && !TUN && SV.day > 0) MK.push({x: HOLE.x, y: gH(HOLE.x, HOLE.z) + 3, z: HOLE.z, c: 0xff5a2a, n: 'HIVE', r: 400});
    if (TUN) { MK.push({x: TUN.N[0][0], y: UGY + 2.5, z: TUN.N[0][1], c: 0xffe0b0, n: 'EXIT', r: 400}); if (!TUN.dead) MK.push({x: TUN.core.x, y: TUN.core.y + 2.2, z: TUN.core.z, c: 0xff6a20, n: 'CORE', r: 400}); }
    for (const it of MK) { const d = Math.hypot(it.x - P.x, it.z - P.z); if (d > it.r) continue; _v.set(it.x, it.y, it.z).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
      const sx = (_v.x * .5 + .5) * w, sy = (-_v.y * .5 + .5) * h, col = '#' + it.c.toString(16).padStart(6, '0'); c.strokeStyle = col; c.globalAlpha = clamp(1.3 - d / it.r, .35, 1); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(sx, sy - 7); c.lineTo(sx + 6, sy); c.lineTo(sx, sy + 7); c.lineTo(sx - 6, sy); c.closePath(); c.stroke(); c.fillStyle = col; c.font = '11px "Share Tech Mono",monospace'; c.fillText(it.n + ' ' + (d | 0) + 'm', sx + 9, sy + 4); c.globalAlpha = 1; } c.lineWidth = 1; c.font = '13px "Share Tech Mono",monospace'; }
  // top left: wave, kills
  c.fillStyle = CY + '.9)'; c.font = '700 30px Rajdhani,sans-serif'; c.fillText('KILLS ' + G.kills, 34, 52); c.font = '13px "Share Tech Mono",monospace'; if (G.thrT > 0 && !SURV()) c.fillStyle = (time * 5 | 0) % 2 ? '#ffd27a' : 'rgba(255,170,90,.95)';
  c.fillText(SURV() ? (SV.day > 0 ? 'DAY ' + SV.night + '   NIGHTFALL IN ' + Math.ceil(SV.day) + 'S   [N] SKIP' : 'NIGHT ' + SV.night + '   WAVE ' + Math.max(1, SV.nw) + '/' + WPN + (SV.lull > 0 ? '   BREATHER ' + Math.ceil(SV.lull) + 'S' : '   CONTACTS ' + (G.quota + SV.live))) : 'HELD ' + fmtT(G.runT) + '   THREAT ' + G.wave + (G.thrT > 0 ? '  \u25B2 RISING' : ''), 36, 72); c.fillStyle = CY + '.5)'; if (SURV()) { if (G.bestS) c.fillText('BEST: ' + G.bestS + ' NIGHTS', 36, 88); if (SV.perks.length) c.fillText(SV.perks.map(q => PERKS.find(x => x.id === q).n).join(' / '), 36, Net.role !== 'solo' ? 220 : 140); } else if (G.best) c.fillText('BEST ' + G.best + ' KILLS', 36, 88);
  if (G.combo >= 3) { const sc = 1 + G.comboPop * 2.2, a = Math.min(1, G.comboT * 1.5); c.save(); c.translate(cx - 120, cy + 40); c.scale(sc, sc); c.globalAlpha = a; c.font = '700 26px Rajdhani,sans-serif';
    c.fillStyle = G.comboFlash > 0 ? '#ffd27a' : G.combo >= 50 ? 'rgba(255,170,90,.95)' : 'rgba(230,255,250,.9)'; c.fillText(G.combo + 'x', 0, 0); c.font = '11px "Share Tech Mono",monospace'; c.fillText('STREAK', 0, 13); c.restore(); }
  if (G.tagT > 0) { c.save(); c.globalAlpha = Math.min(1, G.tagT * 2.5) * fl; c.font = '700 ' + (G.tagB ? 19 : 15) + 'px Rajdhani,sans-serif'; c.fillStyle = G.tagB ? 'rgba(255,170,90,.98)' : 'rgba(235,240,230,.9)'; const tw = c.measureText(G.tag).width; c.fillText(G.tag, cx - tw / 2, cy + 46 - (1.3 - G.tagT) * 10); c.restore(); }
  // squad
  if (Net.role !== 'solo') { let y = 112; c.fillStyle = CY + '.8)'; c.fillText(Net.role === 'host' ? 'SQUAD CODE ' + Net.code : 'SQUAD ' + Net.code, 36, y); for (const g of [...G.gunners.values()].filter(q => !q.sentry).sort((a, b) => a.slot - b.slot)) { y += 16; c.fillStyle = g.id === myId() ? '#fff' : CY + '.7)'; c.fillText((g.name || '?').padEnd(14) + ' ' + g.kills, 36, y); } }
  // top right readouts
  c.fillStyle = CY + '.35)'; const off = (time * 6) | 0; for (let i = 0; i < 7; i++) c.fillText(READ[(off + i) % READ.length], w - 170, 40 + i * 15);
  // support call-in meter (fills with squad kills)
  { const sy = Net.role !== 'solo' ? 112 + 16 * (crewN() + 1) + 8 : 108; c.fillStyle = CY + '.7)'; c.fillText('SUPPORT ' + (G.supN % 2 ? 'SENTRY POD' : 'GUN RUN'), 36, sy);
    c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(36, sy + 6, 150, 6); c.fillStyle = G.sup > .9 ? `rgba(255,220,120,${.7 + Math.sin(time * 12) * .3})` : CY + '.8)'; c.fillRect(36, sy + 6, 150 * clamp(G.sup || 0, 0, 1), 6); }
  // active buff
  if (G.buff) { const K = CANK[G.buff.k], col = K.c.map(v => Math.min(255, v * 255 | 0)).join(','); c.font = '700 22px Rajdhani,sans-serif'; c.fillStyle = `rgba(${col},.95)`; const t = K.n + '  ' + G.buff.t.toFixed(1);
    c.fillText(t, cx - c.measureText(t).width / 2, h - 150); c.fillStyle = 'rgba(2,20,22,.5)'; c.fillRect(cx - 90, h - 142, 180, 4); c.fillStyle = `rgba(${col},.9)`; c.fillRect(cx - 90, h - 142, 180 * G.buff.t / 12, 4); c.font = '13px "Share Tech Mono",monospace'; }
  // titan health
  if (G.titan && !G.titan.dead) { const b = G.titan, k = clamp(b.hp / b.hp0, 0, 1), bw = Math.min(420, w * .6); c.fillStyle = 'rgba(255,90,110,.95)'; c.font = '700 18px Rajdhani,sans-serif'; c.fillText('HIVE TITAN', cx - bw / 2, 34); c.font = '13px "Share Tech Mono",monospace';
    c.fillText(Math.round(Math.hypot(b.x - P.x, b.z - P.z)) + ' M', cx + bw / 2 - 40, 34); c.fillStyle = 'rgba(30,4,8,.6)'; c.fillRect(cx - bw / 2, 40, bw, 9);
    if (G.tTrB !== b) { G.tTrB = b; G.tTr = G.tTrK = k; G.tTrH = 0; } if (k < G.tTrK - 1e-4) G.tTrH = .45; G.tTrK = k; if ((G.tTrH -= dt) <= 0) G.tTr = Math.max(k, G.tTr - dt * .35); // chunk you just took off lingers, then drains
    c.fillStyle = 'rgba(255,225,200,.85)'; c.fillRect(cx - bw / 2 + bw * k, 40, bw * (G.tTr - k), 9); c.fillStyle = 'rgba(255,70,90,.95)'; c.fillRect(cx - bw / 2, 40, bw * k, 9);
    if (b.flash > 0) { c.strokeStyle = `rgba(255,240,230,${b.flash * .8})`; c.strokeRect(cx - bw / 2 - 1.5, 38.5, bw + 3, 12); }
    bugCenter(b, _v).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1) edgeMark(c, angD(P.yaw, Math.atan2(-(b.x - P.x), -(b.z - P.z))), 'rgba(255,80,100,.95)', 'TITAN', w, h, time); }
  // supply canister markers: sweep over them to pop them
  for (const cn of CANS.values()) { _v.set(cn.x, cn.y + 1.6, cn.z).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1) { const K = CANK[cn.k]; edgeMark(c, angD(P.yaw, Math.atan2(-(cn.x - P.x), -(cn.z - P.z))), `rgba(${K.c.map(v => Math.min(255, v * 255 | 0)).join(',')},.95)`, K.n, w, h, time); continue; } const px = (_v.x + 1) / 2 * w, py = clamp((1 - _v.y) / 2 * h, 20, h - 40), K = CANK[cn.k], col = K.c.map(v => Math.min(255, v * 255 | 0)).join(',');
    const pul = 7 + Math.sin(time * 8) * 2; c.strokeStyle = `rgba(${col},.95)`; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py - pul); c.lineTo(px + pul, py); c.lineTo(px, py + pul); c.lineTo(px - pul, py); c.closePath(); c.stroke(); c.lineWidth = 1.5;
    c.fillStyle = `rgba(${col},.9)`; c.fillText(K.n, px - c.measureText(K.n).width / 2, py - 14); }
  if (RAD) { const n = Math.min(RAD.txt.length, RAD.t * 38 | 0), a = Math.min(1, (6 - RAD.t) * 1.5), y = h - 64; c.globalAlpha = a; c.font = '12px "Share Tech Mono",monospace'; c.fillStyle = 'rgba(255,200,120,.85)';
    const tx = w / 2 - 260; c.fillStyle = 'rgba(2,10,12,.45)'; c.fillRect(tx - 10, y - 16, 540, 44); c.fillStyle = 'rgba(255,200,120,.85)'; c.fillText('\u25CF ' + RAD.who, tx, y); c.font = '15px "Share Tech Mono",monospace'; c.fillStyle = 'rgba(220,240,235,.92)'; c.fillText(RAD.txt.slice(0, n) + (n < RAD.txt.length && (time * 8 | 0) % 2 ? '_' : ''), tx, y + 19); c.globalAlpha = 1; }
  if (toastT > 0) { c.globalAlpha = Math.min(1, toastT); c.fillStyle = '#fff'; c.font = '16px "Share Tech Mono",monospace'; c.fillText(toastS, w / 2 - c.measureText(toastS).width / 2, h * .68); }
  c.globalAlpha = 1;
}

// ---------------- world fx (fires, flares, artillery, dust)
let flare = null, artT = 4;
// ---------------- atmosphere: radio chatter, dropship flyovers, other outposts fighting on the flanks, wind gusts
const RADIO = {
  start: ['Kestrel-9, this is Actual. Evac is negative. Hold that line.', 'All stations, the hive is moving. Kestrel, you are the wall.'],
  idle: ['Bravo position just went dark. Anyone hear Bravo?', 'Artillery is walking the north dunes. Keep your heads down.', 'Kestrel, we have you on thermal. That is... a lot of contacts.',
    'Charlie Two falling back to the wreck! Say again, falling back!', 'Medevac is grounded. Repeat, medevac is grounded.', 'Contacts through the canyon on the east flank!',
    'Keep that barrel turning, trooper. We need it running.', 'Fleet says orbital fire is denied. You are on your own down there.', 'Watch the sand. Some of them come up from below.',
    'Delta, report! ... Delta, respond!', 'Command says hold till dawn. Dawn is nine hours out.', 'Dropship inbound to Foxtrot, not to you. Sorry, Kestrel.',
    'They just keep coming over that ridge.', 'Good kills, Kestrel. Keep pouring it on.', 'Echo is out of ammo. Echo is fixing bayonets.', 'Comms are breaking up. Hold, hold, hold.'],
  low: ['Kestrel, your line is buckling! Hold on!', 'Kestrel-9, you are being overrun. Do not give ground!'],
  titan: ['Something huge just broke the ridge line. All guns on it!'],
  streak: ['Holy hell, Kestrel. Do not stop shooting.', 'That is a wall of dead bugs out there. Outstanding.'],
};
const RCALL = ['KESTREL ACTUAL', 'BRAVO-6', 'CHARLIE-2', 'FLEET OPS', 'ECHO LEAD', 'OVERWATCH'];
let radT = 3, RAD = null;
function radio(kind) { const L = RADIO[kind]; if (!L || !G.on || G.over) return; const who = kind === 'start' || kind === 'low' ? RCALL[0] : RCALL[(Math.random() * RCALL.length) | 0];
  RAD = {who, txt: L[(Math.random() * L.length) | 0], t: 0}; radT = rnd(16, 30); if (Sfx.ctx) Sfx.play('radio', {vol: .3, vr: .05, rate: rnd(.92, 1.08)}); }
const FLY = SHIP.clone(); FLY.visible = false; scene.add(FLY); let flyT = 25, fly = null;
const FLANK = [{x: -430, z: -140, bt: 0, t: 2}, {x: 470, z: -260, bt: 0, t: 6}, {x: -150, z: -620, bt: 0, t: 9}];
let gust = 0, gustV = 0;
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
  if (flare) { flare.t += dt; flare.y -= dt * 4; flare.x += dt * 1.5; flareL.position.set(flare.x, flare.y, flare.z); flareL.intensity = flare.t < 18 ? (450 + Math.random() * 100) * Math.min(1, flare.t) : 0;
    PA.add(flare.x, flare.y, flare.z, 0, 0, 0, .1, 2.2, 1.8, 3, 1, .7, 1); if (Math.random() < dt * 20) PS.add(flare.x, flare.y, flare.z, rnd(-.2, .2), .6, rnd(-.2, .2), 6, .5, 3, .5, .3, .3, .25);
    if (flare.t > 18) flare = null; }
  // artillery flashes on the horizon
  if ((artT -= dt) < 0) { artT = rnd(3, 9); const a = rnd(-1.4, 1.4), d = rnd(500, 900), x = Math.sin(a) * d, z = -Math.cos(a) * d;
    for (let i = 0; i < 6; i++) PA.add(x, H0(x, z) + rnd(0, 10), z, rnd(-5, 5), rnd(5, 20), rnd(-5, 5), rnd(.3, .9), rnd(25, 50), 10, 4, 1.6, .6, 1);
    skyM.uniforms.flash.value = .5; const pan = clamp(-Math.sin(angD(P.yaw, a)), -1, 1); Sfx.play('boom', {vol: .5, at: d / 340, pan, lp: 600}); }
  skyM.uniforms.flash.value *= Math.exp(-dt * 5); skyM.uniforms.ct.value = time;
  if (G.on && !G.over) { if ((radT -= dt) <= 0) radio(G.runT < 6 ? 'start' : 'idle'); if (RAD) RAD.t += dt; if (RAD && RAD.t > 6) RAD = null; }
  // dropship flyover, low and loud, from behind the line out toward the hive
  if (!fly && (flyT -= dt) <= 0) { flyT = rnd(35, 70); fly = {x: rnd(-50, 50), y: rnd(32, 55), z: 160, vx: rnd(-6, 6)}; FLY.visible = true; if (Sfx.ctx) Sfx.play('flyby', {vol: .55, vr: .05, pan: clamp((fly.x - P.x) / 60, -.8, .8)}); }
  if (fly) { fly.z -= dt * 80; fly.x += fly.vx * dt; FLY.position.set(fly.x, fly.y, fly.z); FLY.rotation.set(-.05, 0, Math.sin(time) * .05);
    if (Math.random() < dt * 30) PS.add(fly.x + rnd(-6, 6), fly.y, fly.z + 4, 0, 0, 0, rnd(.6, 1.2), 1, 4, .4, .38, .36, .15);
    if (fly.z < -90 && fly.z > -96 && !fly.fl) { fly.fl = 1; for (let i = 0; i < 6; i++) PA.add(fly.x, fly.y - 1, fly.z, rnd(-12, 12), rnd(-4, 6), rnd(-8, 4), rnd(3, 5), 1.2, .8, 3, 1.4, .5, 1, 2, .3); } // drops flares
    if (fly.z < -650) { fly = null; FLY.visible = false; } }
  // other outposts fighting it out on the horizon: tracer streams, flashes, a faint crackle
  for (const F of FLANK) { if ((F.t -= dt) <= 0) { F.bt = rnd(1.5, 4); F.t = F.bt + rnd(2, 7); F.a = rnd(-.6, .6); }
    if (F.bt > 0) { F.bt -= dt; const y = H0(F.x, F.z) + 4; if (Math.random() < dt * 22) { const a = F.a + rnd(-.25, .25), sp = rnd(160, 220); PA.add(F.x, y, F.z, Math.sin(a) * sp * .4 + (-F.x) * .15, rnd(30, 80), Math.cos(a) * sp * .4 - 40, rnd(.6, 1.1), 2.2, 1.5, 3, 1.2, .5, 1, 30); }
      if (Math.random() < dt * 1.2) for (let i = 0; i < 3; i++) PA.add(F.x + rnd(-30, 30), y + rnd(0, 8), F.z + rnd(-30, 30) - 60, rnd(-4, 4), rnd(4, 14), rnd(-4, 4), rnd(.3, .7), rnd(14, 26), 6, 4, 1.6, .6, 1);
      if (Sfx.ctx && Math.random() < dt * 9) { const d = Math.hypot(F.x - P.x, F.z), pan = clamp(-Math.sin(angD(P.yaw, Math.atan2(-F.x, -F.z))), -1, 1); Sfx.play('shot', {vol: .05, pan, lp: 450, rate: .7, at: Math.min(1.5, d / 340 * .3)}); } } }
  // wind gusts: louder wind and a sheet of dust blowing across
  gustV += (rnd(-1, 1) * .8 - gust * .25) * dt; gust = clamp(gust + gustV * dt, 0, 1); if (Math.random() < dt * .05) gustV += .6;
  if (Sfx.ctx) { Sfx.wind.gn.gain.setTargetAtTime((.1 + gust * .2) * (TUN ? .15 : 1), Sfx.ctx.currentTime, .3); Sfx.wind.fl.frequency.setTargetAtTime(300 + gust * 500, Sfx.ctx.currentTime, .3); }
  if (Math.random() < dt * gust * (HI() ? 40 : 15)) PS.add(P.x + rnd(-60, 30), rnd(.2, 4), rnd(-70, 0), rnd(6, 11), rnd(-.2, .4), rnd(-1, 1), rnd(3, 6), rnd(.6, 1.4), rnd(3, 6), .68, .5, .36, .1);
  for (const B of BEAMS) { B.ph += dt * .25; B.m.rotation.set(.35 + Math.sin(B.ph * 1.3) * .2, Math.sin(B.ph) * .8 + (B.x < 0 ? .3 : -.3), 0); }
  // ambient chitter
  if (Sfx.ctx && bugs.length && Math.random() < dt * Math.min(6, bugs.length * .05)) { const b = bugs[(Math.random() * bugs.length) | 0]; if (!b.dead) { const a = Sfx.at(b.x, b.z); Sfx.play(Math.random() < .2 ? 'screech' : 'chitter', {vol: .25 * a.vol, pan: a.pan, rate: rnd(.7, 1.4), lp: 2500}); } }
}

// ---------------- gun + camera feel
const keys = {};
let mouseDown = false, testFire = null, aimTouch = false, fireTouch = false;
function aiming() { return !!(keys.KeyQ || aimTouch) && G.on && !G.over; }
const adsSens = () => 1 - P.ads * .5;
function wantFire() { return testFire !== null ? testFire : (SET.auto || mouseDown || fireTouch); }
function stepGunner(g, dt, local) {
  if (local && SURV() && P.foot) return rifleStep(g, dt);
  const want = local ? wantFire() && !G.over : !!g.fire;
  g.spin = clamp(g.spin + (want ? dt / .6 : -dt / 2.2), 0, 1); // heavy barrels: slower spin-up, long run-down
  if (local && P.vent > 0) { P.vent -= dt; }
  const can = g.spin > .97 && (!local || P.vent <= 0) && !(local && SURV() && SV.belt <= 0);
  const od = G.buff && G.buff.k === 0;
  if (can && want) { g.acc += dt * (g.sentry ? 16 : od ? 60 : 36); let n = 0; while (g.acc >= 1) { g.acc--; fireShot(g, g.n++); n++; } if (local) { P.firing = true; P.fireT += dt; P.heat = od ? Math.max(0, P.heat - dt * .3) : Math.min(1, P.heat + dt / 9); if (P.heat >= 1) { P.vent = .6; P.heat = .55; vent(); } } }
  else { g.acc = 0; if (local) { P.firing = false; P.fireT = Math.max(0, P.fireT - dt * 3); } }
  if (local && !P.firing) P.heat = Math.max(0, P.heat - dt * (P.vent > 0 ? .5 : .12));
  if (!local) { g.heat = g.fire ? Math.min(1, g.heat + dt / 9) : Math.max(0, g.heat - dt * .12); }
  // target retarget timer
  if (local) { g.pitch = P.pitch; return; } if (!g.sentry) return; // people aim pitch themselves (sent as `p`)
  g.tgtT -= dt; if (g.tgtT <= 0) { g.tgtT = .12; g.tgt = pickTarget(g); }
  // sentries: auto pitch toward target
  let tp = -.05; if (g.tgt && !g.tgt.dead) { const dx = g.tgt.x - SLOTX[g.slot], dz = g.tgt.z, d = Math.hypot(dx, dz); tp = Math.atan2(g.tgt.y + BH * g.tgt.s - 1.7, d); tp = clamp(tp, -.4, .25); }
  g.pitch += (tp - g.pitch) * Math.min(1, dt * 5);
}
function vent() { const u = FPG.userData; for (let i = 0; i < 26; i++) { u.bar.getWorldPosition(_v); PS.add(_v.x, _v.y, _v.z, rnd(-.8, .8), rnd(.8, 2.2), rnd(-.8, .8), rnd(.6, 1.6), .1, rnd(.6, 1.4), .85, .85, .85, .45, -.5, 1.5); } Sfx.play('shot', {vol: 0}); }
function updateGunVisual(gun, spin, heat, firing, time, dt) {
  const u = gun.userData; u.ang = (u.ang || 0) + spin * 34 * dt; u.bar.rotation.z = u.ang;
  const h = heat * heat; u.barrelM.emissive.setRGB(h * 4 + h * h * 6, h * 1.4 + h * h * 5, h * h * 3.5);
  for (let i = 0; i < u.belt.length; i++) u.belt[i].position.z = -.12 - (i / 8) * .1 + (firing ? Math.sin(time * 60 + i) * .004 : 0);
  const on = firing && Math.random() < .85;
  for (const s of u.fl) { s.visible = on; if (on) { const k = rnd(.16, .38); s.scale.set(k, k, 1); s.material.rotation = rnd(0, TAU); s.position.z = rnd(-.15, .05); } }
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
  P.trauma = Math.max(firing ? (.13 + P.heat * .1 + smooth(Math.min(1, P.fireT / 3)) * .08) * (1 - P.ads * .55) : 0, P.trauma - dt * 1.8); P.bloom = Math.max(0, P.bloom - dt * (firing ? .6 : 3));
  const sh = P.trauma * P.trauma;
  const nx = (Math.sin(time * 47.3) + Math.sin(time * 31.7 + 1) * .6) * sh * .012, ny = (Math.sin(time * 53.1 + 2) + Math.sin(time * 27.9) * .6) * sh * .012;
  const lg = localGunner(); const pitch = (lg ? lg.pitch : -.05);
  P.fovP *= Math.exp(-dt * 4);
  const ad = smooth(P.ads); cam.fov = mix(72, 40, ad) + P.fovP * 2 - (firing ? 1 : 0) * smooth(P.fireT); cam.updateProjectionMatrix();
  { const sc = innerHeight * Math.min(devicePixelRatio, HI() ? 1.5 : .85) / (2 * Math.tan(cam.fov * PI / 360)); for (const p of [PA, PS, PG]) p.mat.uniforms.scale.value = sc; }
  const breath = Math.sin(time * 1.4) * .004;
  cam.position.set(P.x + nx * .3, (P.eyeY || 1.7) + breath * .5 + (G.dmgFlash > .1 ? rnd(-.02, .02) * G.dmgFlash : 0), P.z + .02);
  cam.rotation.set(pitch + P.cp * .02 + ny + breath, P.yaw + P.cy * .01 + nx, nx * .3, 'YXZ');
  // gun pose
  const idle = firing ? 0 : 1;
  FPG.position.set(GUN_BASE.x - ad * .03 + P.swayX * .02 + (firing ? rnd(-1, 1) * .0025 : 0) + Math.sin(time * 1.1) * .003 * idle + rnd(-1, 1) * .002 * sh * 4, GUN_BASE.y - ad * .05 + P.swayY * .02 + (firing ? rnd(-1, 1) * .0025 : 0) + Math.sin(time * 1.4) * .004 * idle + P.gp * .004, GUN_BASE.z + ad * .06 + P.kick * .012 * (1 - ad * .5));
  FPG.rotation.set(P.gp * .02 - P.swayY * .03, -P.swayX * .04 + .02, P.cy * .01 + P.swayX * .05);
  const foot = SURV() && P.foot; FPG.visible = !foot; RIF.visible = foot; MOUNT.visible = foot;
  if (foot) { const bob = Math.sin(SV.bob) * .012 * (P.moveL || 0) * (1 - ad), bx2 = Math.cos(SV.bob * .5) * .01 * (P.moveL || 0) * (1 - ad), rl = SV.rel > 0 ? Math.sin(Math.min(1, ((SV.rel0 || 1.8) - SV.rel) / (SV.rel0 || 1.8)) * PI) : 0;
    RIF.position.set(mix(.14, 0, ad) + P.swayX * .02 + bx2, mix(-.2, -.068, ad) + P.swayY * .02 + bob - rl * .12 + P.gp * .003, mix(-.22, -.16, ad) + P.kick * .015);
    RIF.rotation.set(P.gp * .03 - P.swayY * .03 - rl * .5, -P.swayX * .04 + (1 - ad) * .03, P.swayX * .05 + rl * .6);
    const u = RIF.userData; u.fl.visible = u.flT > 0; if (u.flT > 0) { u.flT -= dt; const k = rnd(.12, .22); u.fl.scale.set(k, k, 1); u.fl.material.rotation = rnd(0, TAU); }
    MOUNT.rotation.y = 0; updateGunVisual(MOUNT, 0, 0, false, time, dt); }
  muzL.intensity = firing && Math.random() < .8 ? rnd(2, 4.5) : 0; (foot ? RIF : FPG).userData.muzzle.getWorldPosition(muzL.position);
}

// ---------------- main flow
function resetWorld() {
  RAD = null; radT = 2.5; fly = null; FLY.visible = false; G.hs = 0;
  for (const b of bugs.slice()) freeBug(b); nextId = 1;
  Object.assign(G, {wave: 0, quota: 0, spawnAcc: 0, gap: 1.5, kills: 0, shield: 100, hp: 100, hurtT: 9, over: false, evq: [], dmgDirs: [], attackers: 0, runT: 0, combo: 0, comboT: 0, comboBest: 0, cleared: false, bruteSeen: false, lowWarn: false, lost: false, shBroke: false, shFlash: 0, beatT: 0, titansDown: 0});
  resetSpecials();
  for (const g of G.gunners.values()) { g.kills = 0; g.spin = 0; g.heat = 0; g.acc = 0; g.fire = 0; }
  P.heat = 0; P.spin = 0; P.vent = 0; P.firing = false; P.fireT = 0; P.burst = 0; P.bloom = 0;
}
function beginGame(fresh) {
  Sfx.init(); resetWorld(); if (TUN) { if (!HOLE) HOLE = {x: 0, z: 0, m: new THREE.Group()}; TUN.dead = false; exitHive(); } dropHole(); P.ug = false; if (Net.role !== 'solo') G.mode = 'horde';
  if (SURV()) survStart(); else { clearItems(); P.foot = false; P.x = SLOTX[0]; P.z = 0; P.eyeY = 1.7; }
  P.pitch = -.04;
  if (fresh) { for (const id of [...G.gunners.keys()]) removeGunner(id); addGunner(myId(), 0, SET.name); }
  if (!G.gunners.has(myId())) addGunner(myId(), 0, SET.name);
  G.on = true; G.paused = false; P.yaw = 0;
  ['menu', 'end', 'pause'].forEach(i => $(i).classList.add('hidden')); $('hud').classList.remove('hidden'); $('visor').classList.remove('hidden');
  if (isHost()) startWave(1);
  if (!TEST && !isTouch) lockPtr();
  $('bPauseT').classList.toggle('hidden', !isTouch); $('bAimT').classList.toggle('hidden', !isTouch); $('bFireT').classList.toggle('hidden', !isTouch); $('bUseT').classList.toggle('hidden', !isTouch || !SURV());
  $('bAgain').disabled = false;
}
function overrun(m) {
  if (G.over) return;
  if (SURV()) { G.over = true; hidePerks(); const w = SV.night - (SV.day > 0 ? 0 : 1), prev = G.bestS || 0; if (w > prev) { G.bestS = w; try { localStorage.setItem('ls-bestN', w); } catch (e) {} }
    callout('KILLED IN ACTION', 'THE HIVE GOT YOU'); Sfx.play('horn', {rate: .6, vol: .7});
    setTimeout(() => { if (G.over) showEnd('KILLED IN ACTION', 'You fell on night ' + SV.night + ' after surviving ' + w + (w === 1 ? ' night' : ' nights'), w, G.kills, G.runT, w > prev && prev > 0 ? 'NEW BEST: ' + w + ' nights (was ' + prev + ')' : 'Best: ' + Math.max(w, prev) + ' nights'); }, 1600); return; }
  G.over = true; const w = m ? m.w : G.wave, k = m ? m.k : G.kills, t = m && m.rt ? m.rt : G.runT;
  const prev = G.best; if (k > G.best) { G.best = k; try { localStorage.setItem('ls-bestk', k); } catch (e) {} }
  if (Net.role === 'host') Net.send({t: 'over', w, k, rt: Math.round(t)});
  callout('OVERRUN', 'THE LINE HAS FALLEN');
  setTimeout(() => { if (G.over) showEnd('OVERRUN', 'The hive took Kestrel-9', w, k, t, k > prev && prev > 0 ? 'NEW BEST: ' + k + ' kills (was ' + prev + ')' : G.best ? 'Best: ' + G.best + ' kills' : ''); }, 1600);
  Sfx.play('horn', {rate: .6, vol: .7});
}
function fmtT(t) { t = Math.max(0, t | 0); return (t / 60 | 0) + ':' + String(t % 60).padStart(2, '0'); }
function showEnd(title, sub, w, k, t, best) {
  const lg = localGunner(), you = lg && Net.role !== 'solo' ? lg.kills : null;
  $('call').style.opacity = 0; callT = 0;
  $('endH').textContent = title; $('endSub').textContent = sub;
  const it = (l, v) => `<span style="margin:0 10px;white-space:nowrap"><small>${l}</small> <b style="display:inline;font-size:22px">${v}</b></span>`;
  const more = (SURV() ? '' : it('Threat reached', w)) + (G.titansDown || !SURV() ? it('Titans felled', G.titansDown || 0) : '') + (you !== null ? it('Your kills', you) : '');
  $('endS').innerHTML = `<div><b>${G.comboBest || 0}x</b><small>Best streak</small></div><div><b>${k}</b><small>${you !== null ? 'Squad kills' : 'Kills'}</small></div><div><b>${fmtT(t)}</b><small>Held</small></div>` + (more ? `<div style="grid-column:1/-1">${more}</div>` : '');
  $('endB').textContent = best || '';
  const guest = Net.role === 'guest' && !G.lost;
  $('bAgain').textContent = G.lost ? 'Back to menu' : guest ? 'Waiting for the host to restart' : 'Hold the line again';
  $('bAgain').disabled = guest; $('endK').textContent = guest ? '' : 'or press Space';
  $('end').classList.remove('hidden'); $('bPauseT').classList.add('hidden'); $('bAimT').classList.add('hidden'); $('bFireT').classList.add('hidden'); $('bUseT').classList.add('hidden'); aimTouch = fireTouch = false; document.exitPointerLock && document.exitPointerLock();
}
function lockPtr() { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }

let last = performance.now(), time = 0;
let noRender = false;
function step(dt) {
  if (G.hs > 0) { G.hs -= dt; dt *= .2; } // brief hit-stop on big kills
  if (G.slow > 0) { G.slow -= dt; dt *= .25 + .75 * smooth(1 - G.slow / 1.8); } // titan kill slow-mo
  time += dt; G.t += dt;
  const live = G.on && !(G.paused && Net.role === 'solo');
  if (live) {
    if (!G.over) G.runT += dt;
    // input sweep
    P.ads = clamp(P.ads + (aiming() ? dt : -dt) / .18, 0, 1);
    if (SURV() && P.foot) survMove(dt);
    else { const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    if (kx) { P.yaw -= kx * dt * 1.7 * adsSens(); P.swayVX -= kx * dt * 30; }
    const ky = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0); if (ky) P.pitch = clamp(P.pitch + ky * dt * 1.0 * adsSens(), -.55, .4);
    P.yaw = clamp(P.yaw, -1.5, 1.5); }
    const lg = localGunner(); if (lg) lg.yaw = P.yaw;
    if (isHost()) { G.ff = SET.ff && crewN() > 1; stepBugsHost(dt); } else stepBugsGuest(dt);
    stepSpecials(dt);
    for (const g of G.gunners.values()) stepGunner(g, dt, g.id === myId());
    G.hurtT += dt; if (G.hurtT > (SURV() ? 3 : 1.2) && isHost()) G.shield = Math.min(100, G.shield + dt * (SURV() ? 18 : 45));
    survStep(dt); hiveStep(dt);
    // shield collapse + recharge cues and a heartbeat at low armour (guests too: shield and hull come from snapshots)
    if (!G.over) { if (G.shield <= .5 && !G.shBroke) { G.shBroke = true; G.shFlash = 1; if (Sfx.ctx && Sfx.lim('shb', 1500)) Sfx.play('shbrk', {vol: .5, vr: .05}); }
      else if (G.shBroke && G.shield >= 99.5) { G.shBroke = false; if (Sfx.ctx && Sfx.lim('shu', 1500)) Sfx.play('shup', {vol: .3, vr: 0}); }
      if (G.hp < 30 && (G.beatT = (G.beatT || 0) - dt) <= 0) { G.beatT = .55 + G.hp / 30 * .45; Sfx.play('heart', {vol: .55, vr: 0}); } }
    if (G.hurtT < .1 && (G.dirT = (G.dirT || 0) - dt) <= 0) { // damage arc toward the nearest bug clawing at you (real 360 distance; guests use the synced attack state, not a random arc)
      let nb = null, nd = 1e9; for (const b of bugs) if (b.st === 1 && !b.dead && !b.T.spit) { const d = (b.x - P.x) ** 2 + (b.z - P.z) ** 2; if (d < nd) { nd = d; nb = b; } }
      if (nb) { G.dirT = .3; G.dmgDirs.push({a: Math.atan2(-(nb.x - P.x), -(nb.z - P.z)), t: 1}); } }
    if (Net.role === 'host' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 12; Net.send(packSnap()); }
    if (Net.role === 'host' && G.migT > 0 && (G.migT -= dt) <= 0) { for (const id of [...G.gunners.keys()]) if (id !== 'H' && id[0] !== 'S' && !Net.peers.has(id)) removeGunner(id); Net.send(crewMsg()); }
    if (Net.role === 'guest' && (G.sendT -= dt) <= 0) { G.sendT = 1 / 15; Net.send({t: 'aim', y: Math.round(P.yaw * 1000) / 1000, p: Math.round(P.pitch * 1000) / 1000, f: wantFire() && P.vent <= 0 ? 1 : 0, a: P.ads > .5 ? 1 : 0}); }
  }
  else { P.firing = false; P.fireT = 0; }
  if (Net.role !== 'host') G.evq = [];
  stepBugsCommon(dt, time);
  drawBegin(); for (const b of bugs) drawBug(b, time); drawEnd();
  const lg = localGunner();
  if (lg) { P.spin = lg.spin; if (lg.spin > .97 && P.spinFull !== 1) { P.fovP = 1; } P.spinFull = lg.spin > .97 ? 1 : 0; }
  survLight(dt); stepFeel(dt, time);
  updateGunVisual(FPG, P.spin, P.heat, P.firing, time, dt);
  for (const g of G.gunners.values()) if (g.model) { g.model.rotation.y = g.yaw; const gun = g.model.userData.gun; gun.rotation.x = g.pitch; updateGunVisual(gun, g.spin, g.heat, g.spin > .97 && g.fire, time, dt); }
  Sfx.gun(live ? P.spin : 0, P.heat, live && P.vent > 0, P.firing);
  if (P.firing) P.burst = (P.burst || 0) + dt; else { if (P.burst > .35 && Sfx.ctx) Sfx.play('tail', {vol: Math.min(.5, .2 + P.burst * .08), vr: .05, lp: 900}); P.burst = 0; }
  PA.step(dt); PS.step(dt); PG.step(dt); stepDecals(dt); stepChunks(chunks, CHK, 300, dt); stepChunks(legsD, LGD, 80, dt, true); stepTracers(dt); stepCases(dt);
  stepWorldFx(dt, time);
  G.dmgFlash = Math.max(0, G.dmgFlash - dt * 1.5); G.shFlash = Math.max(0, (G.shFlash || 0) - dt * .8); G.hitT -= dt; G.killT -= dt; if ((G.comboT -= dt) <= 0) G.combo = 0; G.comboPop = Math.max(0, (G.comboPop || 0) - dt); G.comboFlash = Math.max(0, (G.comboFlash || 0) - dt * 1.2); { let j = 0; for (const d of G.dmgDirs) if ((d.t -= dt) > 0) G.dmgDirs[j++] = d; G.dmgDirs.length = j; }
  compM.uniforms.dmg.value = G.dmgFlash * .4 + (G.hp < 30 ? (.15 + Math.sin(time * 3) * .05) : 0); compM.uniforms.time.value = time;
  if (callT > 0 && (callT -= dt) <= 0) $('call').style.opacity = 0;
  toastT -= dt;
  if (G.on) drawHud(dt, time);
  if (!G.on) { P.yaw = Math.sin(time * .07) * .5; cam.position.set(0, 1.7, 0); cam.rotation.set(-.03, P.yaw, 0, 'YXZ'); }
  if (!noRender) render();
}
function loop(now) { const dt = clamp((now - last) / 1000, 0, .05); last = now; step(dt); requestAnimationFrame(loop); }

// ---------------- input
addEventListener('mousemove', e => { if (document.pointerLockElement !== canvas || !G.on) return; const dx = e.movementX * .0022 * SET.sens * adsSens(); const ft = SURV() && P.foot; P.yaw = ft ? P.yaw - dx : clamp(P.yaw - dx, -1.5, 1.5); P.pitch = clamp(P.pitch - e.movementY * .0022 * SET.sens * adsSens(), ft ? -1.35 : -.55, ft ? 1.35 : .4); P.swayVX -= dx * 40; P.swayVY += e.movementY * .0022 * SET.sens * 20; });
canvas.addEventListener('mousedown', e => { Sfx.init(); if (!G.on || G.over) return; if (document.pointerLockElement !== canvas && !TEST && !isTouch) { lockPtr(); return; } if (e.button === 0) mouseDown = true; if (e.button === 2 && P.vent <= 0 && P.heat > .2) { P.vent = .5; vent(); } });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { keys[e.code] = true; if (!G.on) return;
  if (G.over) { if ((e.code === 'Space' || e.code === 'Enter') && !$('end').classList.contains('hidden') && !$('bAgain').disabled) { e.preventDefault(); $('bAgain').click(); } return; }
  if (e.code === 'Escape' && document.pointerLockElement !== canvas && performance.now() - plT > 400) { pause(!G.paused); return; } if (e.code === 'KeyF') { SET.auto = !SET.auto; saveSet(); syncUI(); toast('Auto-fire ' + (SET.auto ? 'on' : 'off')); } if (e.code === 'KeyE') toggleMount(); if (SURV() && SV.offer && SV.offer.length && /^Digit[123]$/.test(e.code)) pickPerk(+e.code[5] - 1); if (SURV() && e.code === 'KeyN' && SV.day > 0) { SV.day = Math.min(SV.day, .01); } if (e.code === 'KeyT' && SURV()) { P.torch = P.torch === false; toast('Flashlight ' + (P.torch === false ? 'off' : 'on')); } if (e.code === 'KeyR') { if (SURV() && P.foot) reload(); else if (P.vent <= 0 && P.heat > .2) { P.vent = .5; vent(); } } if (e.code === 'KeyP') pause(true); });
addEventListener('keyup', e => { keys[e.code] = false; });
let isTouch = false, tX = null, tY = null, tId = null, mId = null, mX = 0, mY = 0;
addEventListener('touchstart', e => { isTouch = true; Sfx.init(); if (G.on && !G.over) { $('bPauseT').classList.remove('hidden'); $('bAimT').classList.remove('hidden'); $('bFireT').classList.remove('hidden'); if (SURV()) $('bUseT').classList.remove('hidden'); } const t = e.changedTouches[0]; if (G.on && SURV() && P.foot && mId === null && t.clientX < innerWidth * .4 && !(t.target.closest && t.target.closest('button'))) { mId = t.identifier; mX = t.clientX; mY = t.clientY; return; } if (G.on && tId === null && !(t.target.closest && t.target.closest('button'))) { tId = t.identifier; tX = t.clientX; tY = t.clientY; } }, {passive: true});
addEventListener('touchmove', e => { if (G.on && mId !== null) { const m = [...e.touches].find(q => q.identifier === mId); if (m) { P.mvX = clamp((m.clientX - mX) / 55, -1, 1); P.mvY = clamp(-(m.clientY - mY) / 55, -1, 1); } } if (!G.on || tX === null) return; const t = [...e.touches].find(q => q.identifier === tId); if (!t) return; const x = t.clientX, dx = (x - tX) * .006 * SET.sens * adsSens(); tX = x; P.pitch = clamp(P.pitch - (t.clientY - tY) * .006 * SET.sens * adsSens(), SURV() && P.foot ? -1.35 : -.55, SURV() && P.foot ? 1.35 : .4); tY = t.clientY; P.yaw = SURV() && P.foot ? P.yaw - dx : clamp(P.yaw - dx, -1.5, 1.5); P.swayVX -= dx * 40; }, {passive: true});
const tEnd = e => { for (const t of e.changedTouches) { if (t.identifier === tId) { tId = null; tX = null; } if (t.identifier === mId) { mId = null; P.mvX = P.mvY = 0; } } }; addEventListener('touchend', tEnd); addEventListener('touchcancel', tEnd);
let plT = 0;
document.addEventListener('pointerlockchange', () => { plT = performance.now(); const on = document.pointerLockElement === canvas; $('hint').classList.toggle('hidden', on || !G.on || G.over || isTouch || TEST); if (!on && G.on && !G.over && !TEST && !isTouch) pause(true); });
function clearInput() { for (const k in keys) keys[k] = false; mouseDown = false; fireTouch = false; aimTouch = false; for (const id of ['bFireT', 'bAimT']) $(id).classList.remove('on'); }
addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (!Sfx.ctx) return; if (document.hidden) { clearInput(); Sfx.ctx.suspend(); } else Sfx.ctx.resume(); });
function pause(p) { if (p) clearInput(); G.paused = p; $('pause').classList.toggle('hidden', !p); if (!p && !isTouch) lockPtr(); }
$('bPauseT').onclick = () => pause(true);

// ---------------- menus
function syncUI() {
  for (const id of ['sens', 'sens2']) $(id).value = SET.sens; for (const id of ['vol', 'vol2']) $(id).value = SET.vol;
  for (const id of ['gfx', 'gfx2']) for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === SET.gfx);
  for (const id of ['auto', 'auto2']) if ($(id)) $(id).checked = SET.auto;
  for (const id of ['ff', 'ff2']) if ($(id)) { $(id).checked = SET.ff; $(id).disabled = Net.role === 'guest'; }
  if ($('name')) $('name').value = SET.name;
  $('best').textContent = [G.best ? 'Best hold: ' + G.best + ' kills' : '', G.bestS ? 'Survival: ' + G.bestS + (G.bestS === 1 ? ' night' : ' nights') : ''].filter(Boolean).join('   //   ');
}
for (const id of ['sens', 'sens2']) $(id).oninput = e => { SET.sens = +e.target.value; saveSet(); syncUI(); };
for (const id of ['vol', 'vol2']) $(id).oninput = e => { SET.vol = +e.target.value; saveSet(); if (Sfx.master) Sfx.master.gain.value = SET.vol; syncUI(); };
for (const id of ['gfx', 'gfx2']) for (const b of $(id).children) b.onclick = () => { SET.gfx = b.dataset.v; saveSet(); syncUI(); resize(); };
for (const id of ['auto', 'auto2']) if ($(id)) $(id).onchange = e => { SET.auto = e.target.checked; saveSet(); syncUI(); };
for (const id of ['ff', 'ff2']) if ($(id)) $(id).onchange = e => { SET.ff = e.target.checked; saveSet(); syncUI(); toast('Friendly fire ' + (SET.ff ? 'on' : 'off')); };
if ($('bAimT')) { const on = v => e => { e.preventDefault(); aimTouch = v; $('bAimT').classList.toggle('on', v); }; $('bAimT').addEventListener('touchstart', on(true), {passive: false}); $('bAimT').addEventListener('touchend', on(false)); $('bAimT').addEventListener('touchcancel', on(false)); }
if ($('bUseT')) $('bUseT').addEventListener('touchstart', e => { e.preventDefault(); if (SURV() && (!P.foot || Math.hypot(P.x, P.z - .3) < 2.3)) toggleMount(); else reload(); }, {passive: false});
if ($('bFireT')) { const on = v => e => { e.preventDefault(); fireTouch = v; $('bFireT').classList.toggle('on', v); }; for (const [ev, v] of [['touchstart', true], ['touchend', false], ['touchcancel', false]]) $('bFireT').addEventListener(ev, on(v), {passive: false}); }
if ($('name')) $('name').oninput = e => { SET.name = e.target.value.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Trooper'; saveSet(); };
function joinFail(why) { netStatus(why); if (G.on) { G.on = false; $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('end').classList.add('hidden'); $('visor').classList.add('hidden'); document.exitPointerLock && document.exitPointerLock(); } }
function netStatus(s) { if ($('netS')) $('netS').textContent = s; }
$('bStart').onclick = () => { Net.close(); G.mode = 'horde'; beginGame(true); };
if ($('bSurv')) $('bSurv').onclick = () => { Net.close(); G.mode = 'surv'; beginGame(true); };
if ($('bHost')) $('bHost').onclick = () => {
  Sfx.init(); const code = Net.host(SET.name, st => netStatus(st === 'open' ? 'Squad open. Code ' + Net.code : 'Reconnecting to relay...'));
  beginGame(true); G.gunners.get('H').name = SET.name;
  const link = location.origin + location.pathname + '?room=' + code; toast('Squad code ' + code + ' (link copied)'); try { navigator.clipboard.writeText(link).catch(() => {}); } catch (e) {}
  $('pCode').textContent = 'Squad code ' + code + ' // ' + link;
};
if ($('bJoin')) $('bJoin').onclick = () => {
  const code = ($('jCode').value || '').toUpperCase().replace(/[^A-Z]/g, ''); if (code.length !== 5) { netStatus('Enter the 5-letter squad code.'); return; }
  Sfx.init(); netStatus('Joining ' + code + '...');
  Net.join(code, SET.name, joinFail);
  for (const id of [...G.gunners.keys()]) removeGunner(id);
};
$('bResume').onclick = () => pause(false);
$('bQuit').onclick = () => { hidePerks(); hostBye(); Net.close(); clearTimeout(G.goneT); $('bPauseT').classList.add('hidden'); $('bAimT').classList.add('hidden'); $('bFireT').classList.add('hidden'); $('bUseT').classList.add('hidden'); aimTouch = fireTouch = false; G.on = false; G.paused = false; resetWorld(); ['pause', 'end'].forEach(i => $(i).classList.add('hidden')); $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('visor').classList.add('hidden'); syncUI(); };
$('bMenu').onclick = $('bQuit').onclick;
$('bAgain').onclick = () => { if (G.lost) { $('bQuit').onclick(); return; } if (Net.role === 'guest') return; if (Net.role === 'host') Net.send({t: 'restart'}); beginGame(false); };
const openReq = () => { $('reqF').src = 'requests.html?embed'; $('reqBox').classList.remove('hidden'); document.exitPointerLock && document.exitPointerLock(); };
for (const id of ['bReq', 'bReq2', 'bReq3']) $(id).onclick = openReq;
$('bReqX').onclick = () => $('reqBox').classList.add('hidden');
{ const m = /[?&]room=([A-Za-z]{5})/.exec(location.search); if (m && $('jCode')) { $('jCode').value = m[1].toUpperCase(); netStatus('Squad code filled in. Press Join.'); } }
syncUI(); resize();
addEventListener('pagehide', hostBye);

if (TEST) window.__LS = {SV, toggleMount, startDay, enterHive, exitHive, tun: () => TUN, hole: () => HOLE, G, P, bugs, Net, SET, start: () => beginGame(true), fire: v => { testFire = v; }, step: (dt, n = 1, nr) => { noRender = !!nr; for (let i = 0; i < n; i++) step(dt); noRender = false; }, setYaw: y => { P.yaw = y; }, Sfx, spawnBug, killBug, host: () => $("bHost").click(), startWave, callIn, spawnTitan, dropCan, CANS, gunRun, dropSentry, join: c => { $('jCode').value = c; $('bJoin').click(); }, scene, cam};
// compile the shaders the fight needs up front (muzzle flash, squad marines) so the first shots don't hitch
{ const wm = makeMarine(), u = FPG.userData; u.fl.forEach(f => f.visible = true); u.side.visible = true; try { RND.compile(scene, cam); } catch (e) {} u.fl.forEach(f => f.visible = false); u.side.visible = false; scene.remove(wm); }
requestAnimationFrame(loop);
