'use strict';
// Station Nine: Arena. core: helpers, settings, the relay (Net), renderer, scene, sky, materials, sound, input, weapon tables.
const TEST = /[?&]test/.test(location.search);
const AV = 1; // must match between host and guests
const PI = Math.PI, TAU = PI * 2;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const rnd = (a, b) => a + Math.random() * (b - a);
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); return mix(mix(h2(xi, zi), h2(xi + 1, zi), u), mix(h2(xi, zi + 1), h2(xi + 1, zi + 1), u), v); }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }
const fwd = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const esc = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
const TEAM_N = ['Red', 'Blue'], TEAM_C = [0xd8452e, 0x2f78d8], TEAM_CSS = ['#ff6a50', '#5aa0ff'];
const FFA_C = [0xd8452e, 0x2f78d8, 0xe0b02a, 0x3aa04a, 0x9a5ad8, 0xd84a9a, 0x2ab8b0, 0xe07a2a, 0xa0a0a0, 0x6a4ad8, 0x8ad83a, 0xd8d8d8, 0x4a3a2a, 0xff9aa0, 0x3a6a3a, 0x8a2a2a];
const hexS = c => '#' + c.toString(16).padStart(6, '0');

// ---------------- settings (this browser)
const SET = Object.assign({sens: 1, vol: 1, fov: 78, gfx: 'high', name: '', mode: 'ffa', goal: 20, time: 8, bots: 4, skill: 2, lo: 0}, (() => { try { return JSON.parse(localStorage.getItem('s9a-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('s9a-set', JSON.stringify(SET)); } catch (e) {} };
if (!SET.name) try { const s = JSON.parse(localStorage.getItem('s9-set') || '{}'); if (s.name) SET.name = s.name; } catch (e) {}

// ---------------- game state shared by every file
const G = {on: false, t: 0, wt: 0, evq: [], set: null, msgT: 0, paused: false, roster: [], over: false};

// ---------------- the relay (same protocol as Station Nine; rooms tagged [Arena])
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const MAXP = 8;
const Net = {
  tag: '[Arena]', role: 'solo', ws: null, peers: new Map(), code: '', relayT: {pose: 1}, id: '', name: '', handlers: {}, retry: 0,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) { if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} } else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} } },
  send1(id, o) { if (!this.ws || this.ws.readyState !== 1) return; const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s match", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(this.peers.size < MAXP - 1); this.onStatus && this.onStatus('open'); this.emit({t: '_lobby'}); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); this.meta(this.peers.size < MAXP - 1); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') { if (!this.peers.has(id) && this.peers.size >= MAXP - 1) { this.send1(id, {t: 'full'}); return; } if (!this.peers.has(id)) { this.peers.set(id, {id, name: String(m.name || 'Player').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Player', v: m.v}); this.meta(this.peers.size < MAXP - 1); } this.emit({t: '_join', id}); this.emit({t: '_lobby'}); return; }
      if (!this.peers.has(id) || /^(_|(snap|start|lobby|bye|full|ro)$)/.test(m.t)) return;
      m.from = id; this.emit(m, id); if (this.relayT[m.t]) this.send(m);
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) { this.close(); this.role = 'guest'; this.code = code; this.name = name; this.onFail = onFail; this.id = Math.random().toString(36).slice(2, 11); this.guestConnect(false); },
  guestConnect(again) {
    const name = this.name, onFail = this.onFail, ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer'; let openT = 0;
    ws.onopen = () => { openT = performance.now(); this.send({t: 'hello', name, v: AV}); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostlost'}); else if (m.c === 'host' && m.up) this.send({t: 'hello', name, v: AV}); return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      if (m.t === 'full') { this.close(); onFail('That match is full.'); return; }
      if (m.from && m.from === this.id) return; this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such room.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null;
      if (G.on && ev.code !== 4404 && ev.code !== 4429 && (!again || (openT && performance.now() - openT > 10000))) { setTimeout(() => { if (this.role === 'guest' && !this.ws && G.on) this.guestConnect(true); }, 2000); return; }
      this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(), bare = this.tag.replace(/[\[\]]/g, ''); return r.filter(x => x.open && (x.name.startsWith(this.tag + ' ') || x.name.startsWith(bare + ' '))); } catch (e) { return []; } },
};
let CLKO = 0; const NOW = () => (G.pausedAt || performance.now()) + CLKO; // G.pausedAt freezes the clock while offline practice is paused
const isHost = () => Net.role !== 'guest';
const myId = () => Net.role === 'guest' ? Net.id : 'H';

// ---------------- renderer, scene, lights
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio, 1.75)); RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.05;
RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOGC = new THREE.Color(0xa9c6d8); scene.fog = new THREE.FogExp2(FOGC, .0032); scene.background = FOGC.clone();
const cam = new THREE.PerspectiveCamera(SET.fov, 1, .05, 2500); cam.rotation.order = 'YXZ'; scene.add(cam);
function resize() { RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const SUNDIR = new THREE.Vector3(-.45, .62, -.64).normalize();
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a5040, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.copy(SUNDIR).multiplyScalar(120); scene.add(sun, sun.target);
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 320}); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
function applyGfx() { const hi = SET.gfx === 'high'; RND.shadowMap.enabled = hi; sun.castShadow = hi; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); RND.setPixelRatio(Math.min(devicePixelRatio, hi ? 1.75 : 1)); resize(); }

// sky: a gradient dome with the sun
const SKY = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {sd: {value: SUNDIR}, hz: {value: FOGC}},
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
  fragmentShader: `varying vec3 vD; uniform vec3 sd; uniform vec3 hz;
    void main(){ float h = vD.y; vec3 zen = vec3(.18,.42,.78), c = mix(hz, zen, smoothstep(.0,.5,h)); c = mix(c, hz*.8, smoothstep(0.,-.2,h));
      float s = max(dot(vD, sd), 0.); c += vec3(1.,.85,.6) * (pow(s, 900.) * 6. + pow(s, 12.) * .25);
      float cl = sin(vD.x*9.+vD.z*3.)*sin(vD.z*7.-vD.x*2.)*.5+.5; c = mix(c, vec3(1.), smoothstep(.55,.95,cl)*smoothstep(.04,.25,h)*(1.-smoothstep(.3,.6,h))*.35);
      gl_FragColor = vec4(c,1.); }`}));
SKY.renderOrder = -1; SKY.frustumCulled = false; scene.add(SKY);

// ---------------- textures and materials
function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function ctex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, n) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r; } g.putImageData(im, 0, 0); }
const LOADER = new THREE.TextureLoader();
function ftex(url, rep = 1, srgb = true) { const t = LOADER.load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const TX = {}, MAT = {};
function buildMats() {
  TX.stone = ctex(cv(256, 256, (g, w, h) => { g.fillStyle = '#8f8a80'; g.fillRect(0, 0, w, h); for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) { const o = r % 2 ? 32 : 0, l = 70 + Math.random() * 40; g.fillStyle = `rgb(${l + 30},${l + 26},${l + 18})`; g.fillRect(c * 64 + o + 2, r * 32 + 2, 60, 28); } g.fillStyle = 'rgba(40,36,30,.6)'; for (let r = 0; r <= 8; r++) g.fillRect(0, r * 32, w, 2); noiseFill(g, w, h, 26); }));
  TX.sand = ctex(cv(128, 128, (g, w, h) => { g.fillStyle = '#c9b48a'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 40); }));
  TX.crate = ctex(cv(128, 128, (g, w, h) => { g.fillStyle = '#8a6438'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(0,0,0,${.08 + Math.random() * .1})`; g.fillRect(0, i * 21 + 20, w, 2); } g.strokeStyle = '#4a3418'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12); g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke(); noiseFill(g, w, h, 22); }));
  TX.bag = ctex(cv(128, 64, (g, w, h) => { g.fillStyle = '#8a7c58'; g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const o = r % 2 ? 16 : 0; g.fillStyle = `rgba(${150 + Math.random() * 20},${135 + Math.random() * 20},${95},1)`; g.beginPath(); g.ellipse(c * 32 + o + 16, r * 16 + 8, 15, 7, 0, 0, TAU); g.fill(); } noiseFill(g, w, h, 20); }));
  TX.metal = ctex(cv(64, 64, (g, w, h) => { g.fillStyle = '#5a6066'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 18); }));
  TX.deck = ftex('tex/deck.jpg', 1); TX.deckN = ftex('tex/deck_n.jpg', 1, false); TX.paint = ftex('tex/paint.jpg', 1); TX.paintN = ftex('tex/paint_n.jpg', 1, false);
  MAT.stone = new THREE.MeshStandardMaterial({map: TX.stone, roughness: .92});
  MAT.stoneD = new THREE.MeshStandardMaterial({map: TX.stone, color: 0x9a948a, roughness: .95});
  MAT.wood = new THREE.MeshStandardMaterial({map: TX.deck, roughness: .85});
  MAT.woodD = new THREE.MeshStandardMaterial({map: TX.deck, color: 0x8a7a68, roughness: .85});
  MAT.crate = new THREE.MeshStandardMaterial({map: TX.crate, roughness: .85});
  MAT.bag = new THREE.MeshStandardMaterial({map: TX.bag, roughness: 1});
  MAT.metal = new THREE.MeshStandardMaterial({map: TX.metal, roughness: .5, metalness: .6});
  MAT.dark = new THREE.MeshStandardMaterial({color: 0x26282c, roughness: .6, metalness: .4});
  MAT.gun = new THREE.MeshStandardMaterial({color: 0x2a2c30, roughness: .45, metalness: .7});
  MAT.gunW = new THREE.MeshStandardMaterial({color: 0x5a3c22, roughness: .7});
  MAT.rust = new THREE.MeshStandardMaterial({color: 0x6a4a34, roughness: .9, metalness: .3});
  MAT.rock = new THREE.MeshStandardMaterial({color: 0x7a746a, roughness: .95, flatShading: true});
  MAT.trunk = new THREE.MeshStandardMaterial({color: 0x7a5e40, roughness: .95});
  MAT.leaf = new THREE.MeshStandardMaterial({color: 0x4f8a3a, roughness: .8, side: THREE.DoubleSide});
  MAT.white = new THREE.MeshStandardMaterial({color: 0xe8e4da, roughness: .7});
  MAT.glass = new THREE.MeshStandardMaterial({color: 0x9ac0d0, roughness: .1, metalness: .2, transparent: true, opacity: .35});
  MAT.hull = new THREE.MeshStandardMaterial({map: TX.paint, normalMap: TX.paintN, normalScale: new THREE.Vector2(.3, .3), color: 0x5a636a, roughness: .55});
  MAT.bootR = new THREE.MeshStandardMaterial({color: 0x8a2a22, roughness: .6});
  MAT.flag = [0, 1].map(i => new THREE.MeshStandardMaterial({color: TEAM_C[i], roughness: .8, side: THREE.DoubleSide}));
  MAT.flagN = new THREE.MeshStandardMaterial({color: 0xd8d0b8, roughness: .8, side: THREE.DoubleSide});
  MAT.glow = new THREE.MeshBasicMaterial({color: 0xffd060, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending});
  MAT.hp = new THREE.MeshStandardMaterial({color: 0xf0f0f0, roughness: .5, emissive: 0x401010});
  MAT.hpX = new THREE.MeshStandardMaterial({color: 0xd82020, roughness: .5, emissive: 0x400000});
  MAT.ammo = new THREE.MeshStandardMaterial({color: 0x4a5a30, roughness: .7});
  TX.glow = ctex(cv(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }));
  TX.smoke = ctex(cv(64, 64, (g, w, h) => { for (let i = 0; i < 14; i++) { const x = 18 + Math.random() * 28, y = 18 + Math.random() * 28, r = 8 + Math.random() * 14, q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, 'rgba(255,255,255,.35)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(0, 0, w, h); } }));
}
function mergeGeos(list) { // non-indexed merge of position/normal/uv
  const qs = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; qs.forEach(q => n += q.attributes.position.count);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
  for (const q of qs) { P.set(q.attributes.position.array, o * 3); if (q.attributes.normal) N.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) U.set(q.attributes.uv.array, o * 2); o += q.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.computeBoundingSphere(); return g;
}
// box UVs scaled to metres so textures tile evenly whatever the box size
function boxUV(g, sx, sy, sz, t = 1.5) { const uv = g.attributes.uv, d = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * d[f][0] / t, uv.getY(i) * d[f][1] / t); } return g; }

// ---------------- sound (synthesised, positional)
const A = {ctx: null, on: false, master: null, noise: null};
function aInit() {
  if (A.ctx) { if (A.ctx.state === 'suspended' && !G.pausedAt) A.ctx.resume(); return; }
  try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const c = A.ctx; A.master = c.createGain(); A.master.gain.value = .8 * SET.vol; const comp = c.createDynamicsCompressor(); A.master.connect(comp); comp.connect(c.destination);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb; A.on = true;
}
function aPan(x, y, z, ref = 4) { if (!A.on) return null; const p = A.ctx.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.2, maxDistance: 600}); if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); p.connect(A.master); return p; }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1, delay = 0) { if (!A.on) return; const c = A.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .004); g.gain.exponentialRampToValueAtTime(.0005, t + dec); s.connect(fl); fl.connect(g); g.connect(dest || A.master); s.start(t, Math.random()); s.stop(t + dec + .05); }
function tone(f, peak, dec, type = 'sine', dest, f2, delay = 0) { if (!A.on) return; const c = A.ctx, t = c.currentTime + delay, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .005); g.gain.exponentialRampToValueAtTime(.0005, t + dec); o.connect(g); g.connect(dest || A.master); o.start(t); o.stop(t + dec + .05); }
const Snd = {
  gun(k, p) { const d = p || null; if (k === 'pistol') { burst(2400, .7, .7, .1, 'bandpass', d); burst(160, .6, .8, .22, 'lowpass', d); } else if (k === 'smg') { burst(2800, .8, .5, .07, 'bandpass', d); burst(200, .6, .55, .12, 'lowpass', d); } else if (k === 'shotgun') { burst(1300, .5, .9, .25, 'bandpass', d); burst(90, .6, 1.1, .5, 'lowpass', d); } else if (k === 'rifle' || k === 'lmg') { burst(1900, .6, .8, .16, 'bandpass', d); burst(120, .6, .9, .35, 'lowpass', d); } else if (k === 'sniper') { burst(1500, .5, 1, .3, 'bandpass', d); burst(70, .6, 1.2, .8, 'lowpass', d); } else if (k === 'magnum') { burst(1700, .5, .9, .2, 'bandpass', d); burst(100, .6, 1, .5, 'lowpass', d); } else if (k === 'harpoon') { burst(900, 1.5, .5, .12, 'bandpass', d); tone(300, .2, .2, 'triangle', d, 120); } else if (k === 'rocket') { burst(600, .4, .8, .9, 'bandpass', d, .5); } else if (k === 'deck') { burst(900, .4, 1, .35, 'bandpass', d); burst(60, .5, 1.3, .9, 'lowpass', d); } },
  boom(p, big) { burst(70, .5, big ? 1.6 : 1.1, big ? 2.2 : 1.4, 'lowpass', p); burst(400, .4, .8, .5, 'bandpass', p); tone(55, .6, 1.2, 'sine', p, 30); },
  splash(p, big) { burst(1200, .4, big ? .7 : .35, big ? .9 : .4, 'bandpass', p, .6); },
  hit(head) { tone(head ? 1800 : 1300, .25, .08, 'square'); if (head) tone(2400, .15, .1, 'square', null, null, .03); },
  kill() { tone(900, .3, .15, 'triangle'); tone(1350, .25, .2, 'triangle', null, null, .07); },
  hurt() { burst(500, .6, .5, .2, 'bandpass'); tone(160, .25, .2, 'sawtooth', null, 90); },
  click() { burst(3000, 2, .2, .03, 'highpass'); },
  reload() { burst(2200, 3, .25, .05, 'bandpass'); burst(1500, 3, .25, .06, 'bandpass', null, 1, .35); },
  pick() { tone(660, .2, .12, 'triangle'); tone(990, .2, .18, 'triangle', null, null, .08); },
  step(p, wet) { burst(wet ? 900 : 700, 1, wet ? .12 : .08, .07, 'bandpass', p); },
  whiz() { burst(3500, 2, .12, .12, 'bandpass'); },
  ping() { tone(1200, .15, .3, 'sine'); },
  heart(k) { k = clamp(k, .25, 1); tone(62, .5 * k, .14, 'sine', null, 40); tone(55, .38 * k, .16, 'sine', null, 36, .19); },
  streak(n) { const b = 660 * Math.pow(1.12, Math.min(5, n)); [0, 1, 2].forEach(i => tone(b * [1, 1.26, 1.5][i], .2, .22, 'triangle', null, null, .11 + i * .07)); },
};
// engine hum per boat: one oscillator + filtered noise into a panner, gain follows throttle
function engineVoice() { if (!A.on) return null; const c = A.ctx, p = aPan(0, 0, 0, 6), o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 50; f.type = 'lowpass'; f.frequency.value = 400; g.gain.value = 0; o.connect(f); f.connect(g); g.connect(p); o.start(); return {p, o, g, f}; }

// ---------------- input
const K = {}; let mouseL = false, mouseR = false, ePress = false, mdx = 0, mdy = 0;
const locked = () => document.pointerLockElement === canvas;
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function clearKeys() { for (const k in K) K[k] = false; mouseL = mouseR = false; ePress = false; }
addEventListener('mousemove', e => { if (locked() || TEST) { mdx += e.movementX || 0; mdy += e.movementY || 0; } });

// ---------------- weapons and loadouts
// dmg per hit (per pellet), hd = head multiplier, rate = s between shots, rng = full damage out to half of it, then down to 55% at rng
const WPN = {
  pistol: {n: 'Pistol', dmg: 24, hd: 2, rate: .17, mag: 12, res: 60, spr: .011, rel: 1.3, rng: 60, kick: .022},
  smg: {n: 'SMG', dmg: 14, hd: 1.6, rate: .075, mag: 30, res: 150, spr: .028, rel: 1.8, rng: 45, auto: 1, kick: .011},
  shotgun: {n: 'Pump shotgun', dmg: 11, pel: 9, hd: 1.3, rate: .85, mag: 6, res: 30, spr: .07, rel: 2.3, rng: 22, kick: .085},
  rifle: {n: 'Marksman rifle', dmg: 42, hd: 2, rate: .36, mag: 10, res: 50, spr: .003, rel: 2.2, rng: 140, zoom: 2.2, kick: .04},
  harpoon: {n: 'Harpoon gun', dmg: 80, hd: 1.5, rate: .5, mag: 1, res: 14, spr: .002, rel: 1.3, rng: 45, uw: 1, kick: .05},
  sniper: {n: 'Sniper rifle', dmg: 95, hd: 2.4, rate: 1.25, mag: 5, res: 20, spr: .0012, rel: 2.8, rng: 300, zoom: 5, kick: .1, pick: 1},
  magnum: {n: 'Magnum', dmg: 55, hd: 2, rate: .42, mag: 6, res: 30, spr: .006, rel: 2, rng: 80, kick: .07, pick: 1},
  lmg: {n: 'Machine gun', dmg: 19, hd: 1.5, rate: .09, mag: 80, res: 160, spr: .032, rel: 3.6, rng: 80, auto: 1, kick: .014, pick: 1},
  rocket: {n: 'Rocket launcher', proj: 'rk', rate: .9, mag: 1, res: 4, rel: 2.4, kick: .08, pick: 1},
};
const WKEYS = Object.keys(WPN), WIX = k => WKEYS.indexOf(k);
const LOADOUTS = [
  {n: 'Assault', d: 'SMG, pistol, 2 grenades', p: 'smg', g: 2},
  {n: 'Breacher', d: 'Pump shotgun, pistol, 3 grenades', p: 'shotgun', g: 3},
  {n: 'Marksman', d: 'Marksman rifle (zoom), pistol, 1 grenade', p: 'rifle', g: 1},
  {n: 'Diver', d: 'Harpoon gun (fires underwater), pistol, 2 grenades. Swims fast, holds breath long', p: 'harpoon', g: 2, diver: 1},
];
const KEYMAP = [['WASD', 'move'], ['Shift', 'sprint'], ['Space', 'jump · swim up · climb out'], ['C / Ctrl', 'crouch · dive'], ['Mouse', 'aim · fire (right: zoom)'], ['R', 'reload'], ['1 / 2 · wheel', 'primary / pistol'], ['G', 'grenade'], ['V', 'knife'], ['E', 'drive · man the gun · get out'], ['F', 'torpedo (driving) · horn'], ['Tab', 'scores'], ['Esc', 'pause']];
