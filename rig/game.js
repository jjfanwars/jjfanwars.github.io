// Station Nine: Open Sea. Online co-op exploration on a night sea: islands, wrecks, salvage, boat upgrades,
// an abandoned oil rig with something living on it, and something much bigger under the water.
'use strict';
const $ = id => document.getElementById(id);
const TEST = /[?&]test/.test(location.search);
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = mulberry(9001);
let WR = mulberry(1), CR = Math.random;
function h2(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, z) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2.03; a *= .5; } return s / .9375; }

// ---------------- settings
const SET = Object.assign({diff: 'normal', sens: 1, bright: 1, gfx: 'high', name: '', vol: 1, fov: 70, inv: 0}, (() => { try { return JSON.parse(localStorage.getItem('s9-set')) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem('s9-set', JSON.stringify(SET)); } catch (e) {} };
const DIFF = {
  easy:      {chase: 4.4, sight: 20, hear: .7,  checkP: .3,  breathHear: .1, lost: 2.5, roam: 30, react: .7,  bleed: 60, down: 14, drown: 20, ramDmg: 14, deep: .2, mhp: 100, pay: .85},
  normal:    {chase: 5.1, sight: 26, hear: 1,   checkP: .55, breathHear: .3, lost: 4,   roam: 24, react: .45, bleed: 45, down: 10, drown: 14, ramDmg: 22, deep: .3, mhp: 140, pay: 1},
  nightmare: {chase: 5.7, sight: 32, hear: 1.3, checkP: .8,  breathHear: .6, lost: 6,   roam: 18, react: .28, bleed: 30, down: 7,  drown: 9,  ramDmg: 32, deep: .45, mhp: 200, pay: 1.35},
};
let D = DIFF.normal;
const CREW_COL = [0xe0602a, 0x2f7fd8, 0xd8b02a, 0x3aa04a, 0x9a5ad8, 0xd84a9a];
const hexS = c => '#' + c.toString(16).padStart(6, '0');

// ---------------- net (jjfanwars relay)
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const GAME_V = 31;
const Net = {
  tag: '[Rig]', role: 'solo', ws: null, peers: new Map(), code: '', relayT: {pose: 1}, id: '', name: '', handlers: {}, retry: 0, started: false,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) { if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} } else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} } },
  send1(id, o) { const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s crew", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.started = false; this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { const was = this.retry > 0; this.retry = 0; this.meta(this.peers.size < 5); this.onStatus && this.onStatus('open'); this.emit({t: '_lobby'});
      clearTimeout(this.seenT); this._seen = null; if (!was || !G.on || !this.peers.size) return;
      // back after a relay blip: whoever doesn't turn up again within 6 s left while we were away
      this._seen = new Set(); this.seenT = setTimeout(() => { const s = this._seen; this._seen = null; if (!s || this.ws !== ws || this.role !== 'host') return;
        for (const [id, p] of [...this.peers]) if (!s.has(id)) { this.peers.delete(id); this.emit({t: '_left', id, name: p.name}); } this.meta(this.peers.size < 5); }, 6000); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'join' && this._seen) this._seen.add(m.id); if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); this.meta(this.peers.size < 5); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; } if (this._seen) this._seen.add(id);
      if (m.t === 'hello') { if (!this.peers.has(id) && this.peers.size >= 5) { this.send1(id, {t: 'full'}); return; } const used = new Set([0, ...[...this.peers.values()].map(p => p.c)]); let c = 1; while (used.has(c)) c++; if (!this.peers.has(id)) { this.peers.set(id, {id, c, name: String(m.name || 'Deckhand').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Deckhand'}); this.meta(this.peers.size < 5); } this.emit({t: '_join', id}); this.emit({t: '_lobby'}); return; }
      if (!this.peers.has(id) || /^(_|(snap|start|crew|lobby|bye|full)$)/.test(m.t)) return;
      m.from = id; this.emit(m, id); if (this.relayT[m.t]) this.send(m);
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) { this.close(); this.role = 'guest'; this.code = code; this.name = name; this.onFail = onFail; this.id = Math.random().toString(36).slice(2, 11); this.guestConnect(false); },
  guestConnect(again) {
    const name = this.name, onFail = this.onFail, ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer'; let openT = 0;
    ws.onopen = () => { openT = performance.now(); this.send({t: 'hello', name}); if (again) this.emit({t: '_back'}); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostlost'}); else if (m.c === 'host' && m.up) { this.send({t: 'hello', name}); this.emit({t: '_hostback'}); } return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      if (m.t === 'full') { this.close(); onFail('That crew is full.'); return; }
      if (m.from && m.from === this.id) return; this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such room.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null;
      // dropped mid-voyage: one more try with the same id (again later only if that try held for a while)
      if (G.on && ev.code !== 4404 && ev.code !== 4429 && (!again || (openT && performance.now() - openT > 10000))) { this.emit({t: '_drop'}); clearTimeout(this.rejT); this.rejT = setTimeout(() => { if (this.role === 'guest' && !this.ws && G.on) this.guestConnect(true); }, 2000); return; }
      this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { clearInterval(this.pingT); clearTimeout(this.seenT); clearTimeout(this.rejT); this._seen = null; clearTimeout(G.lostT); G.lostT = 0; if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(), bare = this.tag.replace(/[\[\]]/g, ''); return r.filter(x => (x.open || x.n >= 6) && (x.name.startsWith(this.tag + ' ') || x.name.startsWith(bare + ' '))); } catch (e) { return []; } },
};
const isHost = () => Net.role !== 'guest';
const myId = () => Net.role === 'guest' ? Net.id : 'H';

// ---------------- world data
// Rig (Station Nine) on (0, 0), home lighthouse island to the south, islands and wrecks scattered over about 1.6 km.
const LV = [1.8, 10, 17];
const JETTY = {x: 0, z: -238};
const HOME = {x: 0, z: -276, r: 30};
const LEGS = [[-11, -11], [11, -11], [-11, 11], [11, 11]];
const ISLES = [
  {n: 'Gull Rock', x: -420, z: -140, r: 42, top: 10, trees: 'pine'},
  {n: 'Palm Key', x: 380, z: -330, r: 48, top: 5, trees: 'palm'},
  {n: "Hermit's Isle", x: -300, z: 440, r: 56, top: 12, trees: 'pine', hut: 1},
  {n: 'Skull Reef', x: 540, z: 290, r: 34, top: 3.5, trees: 'palm', skull: 1},
  {n: 'Lantern Isle', x: -640, z: -470, r: 44, top: 8, trees: 'pine', ruin: 1},
  {n: 'Ashen Atoll', x: 170, z: 690, r: 62, top: 5, trees: 'dead', ring: 1},
  {n: 'Black Sands', x: -1350, z: 320, r: 72, top: 14, trees: 'pine', hut: 1},
  {n: 'Coral Crown', x: 1280, z: -720, r: 64, top: 5, trees: 'palm', ring: 1},
  {n: "Widow's Spire", x: 950, z: 1320, r: 52, top: 22, trees: 'dead', ruin: 1},
  {n: 'Frostbite Isle', x: -950, z: -1500, r: 82, top: 18, trees: 'pine'},
  {n: 'Sunken Bell Key', x: 1900, z: 620, r: 46, top: 4, trees: 'palm', hut: 1},
  {n: 'Ossuary Reef', x: -2000, z: -320, r: 40, top: 3.5, trees: 'dead', skull: 1},
  // the far sea (round 2): five regions past the old chart edge; nw marks them so POIS indices of the old places never move
  {n: 'Sentinel Ice', x: -1300, z: 3600, r: 70, top: 26, trees: 'pine', shape: 'spire', pal: 'snow', reg: 'frost', nw: 1},
  {n: 'Frostmere', x: -400, z: 4300, r: 95, top: 16, trees: 'pine', pal: 'snow', hut: 1, reg: 'frost', nw: 1},
  {n: 'Whitecap Shoal', x: 400, z: 3700, r: 55, top: 4, trees: 'pine', ring: 1, pal: 'snow', reg: 'frost', nw: 1},
  {n: 'Gravestone Tor', x: -2100, z: 4100, r: 60, top: 30, trees: 'dead', shape: 'cliff', pal: 'snow', ruin: 1, reg: 'frost', nw: 1},
  {n: 'Turtle Cay', x: 2800, z: 2200, r: 40, top: 4, trees: 'palm', pal: 'coral', reg: 'coral', nw: 1},
  {n: 'Pelican Key', x: 3500, z: 2950, r: 55, top: 6, trees: 'palm', pal: 'coral', hut: 1, reg: 'coral', nw: 1},
  {n: 'Sunrise Atoll', x: 4000, z: 2000, r: 85, top: 5, trees: 'palm', ring: 1, pal: 'coral', reg: 'coral', nw: 1},
  {n: 'Lagoon Isle', x: 2700, z: 3400, r: 45, top: 5, trees: 'palm', pal: 'coral', reg: 'coral', nw: 1},
  {n: 'Lone Mast Rock', x: 4600, z: -900, r: 30, top: 18, trees: 'dead', shape: 'spire', pal: 'black', reg: 'abyss', nw: 1},
  {n: 'Stormbreak', x: 3700, z: 300, r: 60, top: 12, trees: 'pine', shape: 'cliff', pal: 'moss', hut: 1, reg: 'abyss', nw: 1},
  {n: 'Cinder Cone', x: 300, z: -3700, r: 90, top: 40, trees: 'dead', shape: 'crater', pal: 'black', reg: 'ash', nw: 1},
  {n: 'Obsidian Key', x: 1300, z: -4300, r: 50, top: 8, trees: 'palm', pal: 'black', reg: 'ash', nw: 1},
  {n: 'Smoke Isle', x: -600, z: -4300, r: 65, top: 20, trees: 'dead', shape: 'cliff', pal: 'ash', hut: 1, reg: 'ash', nw: 1},
  {n: 'Ember Reef', x: 1000, z: -3200, r: 35, top: 3, trees: 'dead', ring: 1, pal: 'black', reg: 'ash', nw: 1},
  {n: "Hangman's Isle", x: -4500, z: 800, r: 60, top: 18, trees: 'dead', shape: 'cliff', pal: 'moss', ruin: 1, reg: 'grave', nw: 1},
  {n: 'Bone Spit', x: -3800, z: -300, r: 35, top: 3, trees: 'dead', skull: 1, pal: 'ash', reg: 'grave', nw: 1},
  {n: 'Lantern Shoal', x: -3500, z: 1200, r: 42, top: 4, trees: 'pine', pal: 'ash', reg: 'grave', nw: 1},
  {n: 'Halfway Rock', x: -2700, z: 2300, r: 45, top: 10, trees: 'pine', nw: 1},
  {n: 'Far Haven', x: 2600, z: -2700, r: 55, top: 9, trees: 'palm', hut: 1, nw: 1},
];
const WRECKS = [
  {n: 'The Marguerite', x: -200, z: 250},
  {n: 'Trawler Sorrow', x: 650, z: -90},
  {n: 'The Grey Lady', x: -560, z: 170, ghost: 1},
  {n: 'Iron Maiden', x: 1520, z: 120},
  {n: 'The Lost Hope', x: -1120, z: 1020, ghost: 1},
  {n: 'SS Carthage', x: 320, z: -1700},
  {n: 'The Covenant', x: -4100, z: 0, reg: 'grave', nw: 1},
  {n: 'Morning Star', x: -4400, z: 450, ghost: 1, reg: 'grave', nw: 1},
  {n: 'SS Halcyon', x: -3700, z: 750, reg: 'grave', nw: 1},
  {n: 'Polar Dawn', x: -800, z: 3900, reg: 'frost', nw: 1},
];
const SURF = [], WALLS = [], OBST = [], PCIRC = [], BLD = [], HIDES = [], SPOTS = [], INTER = [], LAMPS = [], DIGS = [], BUOYS = [], POIS = [];
const BK = {}; const bucket = k => BK[k] || (BK[k] = []);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function boxUV(g, sx, sy, sz, t) { const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t); } return g; }
function put(k, g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g; }
function wbox(k, x, y, z, sx, sy, sz, ry = 0, tile = 1.5) { return put(k, boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile), x, y, z, ry); }
function bx(k, x0, x1, y0, y1, z0, z1, tile) { return wbox(k, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, 0, tile); }
function slab(x0, x1, z0, z1, y, k = 'grate') { SURF.push({k: 'slab', x0, x1, z0, z1, y}); bx(k, x0, x1, y - .3, y, z0, z1, 2); bx('steel', x0, x1, y - .9, y - .3, z0 - .01, z0 + .25); bx('steel', x0, x1, y - .9, y - .3, z1 - .25, z1 + .01); bx('steel', x0 - .01, x0 + .25, y - .9, y - .3, z0 + .25, z1 - .25); bx('steel', x1 - .25, x1 + .01, y - .9, y - .3, z0 + .25, z1 - .25); if (k === 'grate') bx('steel', x0 + .02, x1 - .02, y - .34, y - .31, z0 + .02, z1 - .02); }
function rail(x0, x1, z0, z1, y, k = 'yellow') {
  WALLS.push({x0, x1, z0, z1, y0: y, y1: y + 1.15, see: false});
  const along = x1 - x0 > z1 - z0, L = along ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.6));
  bx(k, x0, x1, y + 1.02, y + 1.1, z0, z1); bx(k, x0, x1, y + .52, y + .57, z0, z1);
  for (let i = 0; i <= n; i++) { const t = i / n, x = along ? mix(x0, x1, t) : (x0 + x1) / 2, z = along ? (z0 + z1) / 2 : mix(z0, z1, t); bx(k, x - .04, x + .04, y, y + 1.1, z - .04, z + .04); }
}
function ramp(x0, x1, z0, z1, y0, y1, ax, k = 'grate', rk = 'yellow') {
  SURF.push({k: 'ramp', x0, x1, z0, z1, y0, y1, ax});
  const L = ax === 'x+' ? x1 - x0 : z1 - z0, n = Math.ceil(L / .32), rise = (y1 - y0) / n;
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n, y = y0 + rise * (i + .5) + .04;
    if (ax === 'x+') bx(k, mix(x0, x1, a), mix(x0, x1, b), y - .08, y, z0, z1); else bx(k, x0, x1, y - .08, y, mix(z0, z1, a), mix(z0, z1, b)); }
  for (let i = 1; i < n; i++) { const a = i / n, y = y0 + rise * i - .04; if (ax === 'x+') bx(k, mix(x0, x1, a) - .02, mix(x0, x1, a) + .02, y - Math.abs(rise), y, z0, z1); else bx(k, x0, x1, y - Math.abs(rise), y, mix(z0, z1, a) - .02, mix(z0, z1, a) + .02); }
  const sl = Math.hypot(L, y1 - y0), sa = Math.atan2(y1 - y0, L), lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  if (ax === 'x+') for (const z of [z0 - .05, z1 + .05]) { put('leg', new THREE.BoxGeometry(sl, .3, .08), (x0 + x1) / 2, (y0 + y1) / 2 - .1, z, 0, 0, sa); }
  else for (const x of [x0 - .05, x1 + .05]) { put('leg', new THREE.BoxGeometry(.08, .3, sl), x, (y0 + y1) / 2 - .1, (z0 + z1) / 2, 0, -sa, 0); }
  if (hi - lo > 1.2) for (const t of [.5, .97]) { const yt = mix(y0, y1, t) - .25, h = Math.max(0, mix(y0, y1, t) - lo - .25); if (h < .3) continue; const px = ax === 'x+' ? mix(x0, x1, t) : null, pz = ax === 'x+' ? null : mix(z0, z1, t);
    for (const sd of [0, 1]) { const x = ax === 'x+' ? px : (sd ? x1 + .05 : x0 - .05), z = ax === 'x+' ? (sd ? z1 + .05 : z0 - .05) : pz; put('leg', new THREE.BoxGeometry(.12, h, .12), x, lo + h / 2, z); } }
  for (let t = 0; t <= 1.001; t += 1 / Math.max(2, Math.round(sl / 1.2))) for (const sd of [0, 1]) { const x = ax === 'x+' ? mix(x0, x1, t) : (sd ? x1 : x0), z = ax === 'x+' ? (sd ? z1 : z0) : mix(z0, z1, t), y = mix(y0, y1, t); put(rk, new THREE.CylinderGeometry(.025, .025, 1.05, 5), x, y + .52, z); }
  const yy0 = Math.min(y0, y1), yy1 = Math.max(y0, y1) + 1.1;
  if (ax === 'x+') for (const z of [z0 - .08, z1 + .08]) WALLS.push({x0: x0 + .6, x1: x1 - .6, z0: z - .05, z1: z + .05, y0: yy0 + .4, y1: yy1, see: false});
  else for (const x of [x0 - .08, x1 + .08]) WALLS.push({x0: x - .05, x1: x + .05, z0: z0 + .6, z1: z1 - .6, y0: yy0 + .4, y1: yy1, see: false});
  if (ax === 'x+') for (const z of [z0, z1]) for (const hh of [1.05, .55]) { const q = new THREE.CylinderGeometry(hh > 1 ? .035 : .022, hh > 1 ? .035 : .022, Math.hypot(x1 - x0, y1 - y0), 5); q.rotateZ(-PI / 2 + Math.atan2(y1 - y0, x1 - x0)); put(rk, q, (x0 + x1) / 2, (y0 + y1) / 2 + hh, z); }
  else for (const x of [x0, x1]) for (const hh of [1.05, .55]) { const q = new THREE.CylinderGeometry(hh > 1 ? .035 : .022, hh > 1 ? .035 : .022, Math.hypot(z1 - z0, y1 - y0), 5); q.rotateX(PI / 2 - Math.atan2(y1 - y0, z1 - z0)); put(rk, q, x, (y0 + y1) / 2 + hh, (z0 + z1) / 2); }
}
function rampY(s, x, z) { const t = s.ax === 'x+' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0); return mix(s.y0, s.y1, clamp(t, 0, 1)); }
function spot(tag, x, y, z) { SPOTS.push({tag, x, y, z, i: SPOTS.length}); }
const ROT = {s: 0, w: PI / 2, n: PI, e: -PI / 2};
const L2W = (b, lx, lz) => { const c = Math.cos(b.th), s = Math.sin(b.th); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };
const W2L = (b, x, z) => { const c = Math.cos(b.th), s = Math.sin(b.th), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
function rectW(b, x0, x1, z0, z1) { const p = [L2W(b, x0, z0), L2W(b, x1, z1)]; return {x0: Math.min(p[0][0], p[1][0]), x1: Math.max(p[0][0], p[1][0]), z0: Math.min(p[0][1], p[1][1]), z1: Math.max(p[0][1], p[1][1])}; }
function lbox(b, k, lx, ly, lz, sx, sy, sz, ry = 0, tile = 1.5) {
  const g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, tile);
  _e.set(0, ry, 0); g.applyMatrix4(_m4.compose(_v.set(lx, ly, lz), _q.setFromEuler(_e), _s.set(1, 1, 1)));
  _e.set(0, b.th, 0); g.applyMatrix4(_m4.compose(_v.set(b.x, b.fy, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1))); bucket(k).push(g); return g;
}
function zoneOf(x, z, y, m = 0) { for (let i = 0; i < BLD.length; i++) { const b = BLD[i]; if (Math.abs(y - b.fy) > 2) continue; const l = W2L(b, x, z); if (Math.abs(l[0]) < b.w / 2 - m && Math.abs(l[1]) < b.d / 2 - m) return i; } return -1; }
const BT = {quarters: {w: 8, d: 6, dx: 0, dw: 1.3, wh: 2.8}, gen: {w: 7, d: 6, dx: 1.5, dw: 1.6, wh: 3}, ctrl: {w: 8, d: 5.5, dx: 2, dw: 1.3, wh: 2.8}, hut: {w: 6, d: 5, dx: 1.2, dw: 1.2, wh: 2.5, wood: 1}, state: {w: 5.4, d: 8.4, dx: 0, dw: 1.1, wh: 3.4, wm: 'wallp', fm: 'carpet'}, bridge: {w: 14, d: 6, dx: 0, dw: 1.4, wh: 3.2, wm: 'white'}, cabin: {w: 5, d: 4.4, dx: 0, dw: 1.2, wh: 2.3, wood: 1}, shed: {w: 7, d: 5, dx: 0, dw: 1.6, wh: 3, wood: 1}};
function building(kind, name, x, z, y, door) {
  const T = BT[kind], b = {kind, name, x, z, th: ROT[door], w: T.w, d: T.d, wh: T.wh, fy: y, i: BLD.length}; BLD.push(b);
  const t = .16, hw = b.w / 2, hd = b.d / 2, wh = b.wh, dl = T.dx - T.dw / 2, dr = T.dx + T.dw / 2, wm = T.wm || (T.wood ? 'planks' : 'plate');
  const wall = (lx, lz, sx, sz) => { lbox(b, wm, lx, wh / 2, lz, sx, wh, sz); const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: y, y1: y + wh, see: true})); };
  wall(0, hd, b.w + t, t); wall(-hw, 0, t, b.d); wall(hw, 0, t, b.d);
  wall((-hw - t / 2 + dl) / 2, -hd, dl + hw + t / 2, t); wall((hw + t / 2 + dr) / 2, -hd, hw + t / 2 - dr, t);
  lbox(b, wm, T.dx, (2.1 + wh) / 2, -hd, T.dw, wh - 2.1, t);
  lbox(b, T.wood ? 'log' : 'hazard', T.dx, 2.12, -hd, T.dw + .3, .12, t + .06);
  lbox(b, 'door', dr + .03, 1.02, -hd + T.dw / 2 + .1, .05, 2.02, T.dw - .04);
  lbox(b, T.wood ? 'roofW' : 'plate', 0, wh + .08, 0, b.w + .5, .16, b.d + .5);
  lbox(b, T.fm || (T.wood ? 'planks' : 'floorP'), 0, .03, 0, b.w, .06, b.d, 0, 1.2);
  for (const s of [-1, 1]) lbox(b, 'glass', s * hw, 1.6, -.6, t + .05, .5, 1.1);
  b.lamp = L2W(b, 0, 0); if (!T.wood && !T.wm) LAMPS.push([b.lamp[0], y + wh - .3, b.lamp[1], 1]);
  b.din = L2W(b, T.dx, -hd + 1.0); b.dout = L2W(b, T.dx, -hd - 1.4);
  b.hides = []; furnish(b); return b;
}
function hide(b, lx, lz, face) {
  const [x, z] = L2W(b, lx, lz), th = face + b.th, fx = -Math.sin(th), fz = -Math.cos(th);
  const h = {x, z, y: b.fy, yaw: th, b: b.i, ex: x + fx * .9, ez: z + fz * .9, i: HIDES.length}; HIDES.push(h); b.hides.push(h);
  INTER.push({kind: 'hide', h, x: x + fx * .35, y: b.fy + 1.2, z: z + fz * .35, r: 2, label: () => P.hd === h.i ? 'Get out' : 'Hide in the locker', on: () => !hideTaken(h)});
}
function locker(b, lx, lz, face) {
  lbox(b, 'locker', lx, .975, lz, .6, 1.95, .55, face);
  const fx = -Math.sin(face), fz = -Math.cos(face);
  for (let y = .3; y < 1.8; y += .16) lbox(b, 'dark', lx + fx * .285, y, lz + fz * .285, .5, .04, .02, face);
  const r = rectW(b, lx - .3, lx + .3, lz - .3, lz + .3); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + 1.95, see: false}));
  hide(b, lx, lz, face);
}
function furnish(b) {
  const hw = b.w / 2, hd = b.d / 2, L = (lx, ly, lz) => { const [x, z] = L2W(b, lx, lz); return [x, b.fy + ly, z]; };
  const solid = (lx, lz, sx, sz, h) => { const r = rectW(b, lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + h, see: false})); };
  if (b.kind === 'state') {
    lbox(b, 'white', -hw + 1.2, .35, 1.6, 1.9, .5, 2.4); lbox(b, 'fabric', -hw + 1.2, .62, 1.6, 1.8, .1, 2.3); solid(-hw + 1.2, 1.6, 1.9, 2.4, .7);
    lbox(b, 'wood', hw - .6, .4, 2.6, .9, .8, .5); solid(hw - .6, 2.6, .9, .5, .8); spot(b.capt ? 'capt' : 'cruise', ...L(hw - .6, .82, 2.6)); spot('cruise', ...L(-hw + 1.2, .7, 2.4));
    locker(b, hw - .45, .6, -PI / 2); lbox(b, 'glass', 0, 1.7, hd - .1, 1.6, 1, .05);
  } else if (b.kind === 'bridge') {
    lbox(b, 'dark', 0, .55, hd - .9, 5, 1.1, .8); solid(0, hd - .9, 5, .8, 1.1); b.console = L(0, 1.2, hd - 1.5); lbox(b, 'glass', 0, 1.8, hd - .02, b.w - .6, 1.2, .05);
    const wg = new THREE.Mesh(new THREE.TorusGeometry(.42, .04, 8, 24), MAT.brass); const [wx, wz] = L2W(b, 0, hd - 1.38); wg.position.set(wx, b.fy + 1.25, wz); wg.rotation.set(0, b.th, 0); scene.add(wg);
    locker(b, -hw + .5, 0, PI / 2); locker(b, hw - .5, 0, -PI / 2);
  } else if (b.kind === 'quarters') {
    for (const s of [-1, 1]) { lbox(b, 'steel', s * (hw - .55), .4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), .5, 1.6, .9, .12, 1.9); lbox(b, 'steel', s * (hw - .55), 1.4, 1.6, 1, .1, 2); lbox(b, 'fabric', s * (hw - .55), 1.5, 1.6, .9, .12, 1.9); solid(s * (hw - .55), 1.6, 1, 2, 1.6); }
    locker(b, -1.2, hd - .35, PI); locker(b, -.5, hd - .35, PI); locker(b, 1.2, hd - .35, PI);
    lbox(b, 'steel', -2.4, .75, -1.4, 1.2, .06, .8); solid(-2.4, -1.4, 1.2, .8, .8); spot('rig', ...L(-2.4, .8, -1.4)); spot('rig', ...L(hw - .55, .58, 1.2));
  } else if (b.kind === 'gen') {
    lbox(b, 'genM', -.8, .8, 1.2, 3.2, 1.6, 1.6); solid(-.8, 1.2, 3.2, 1.6, 1.6); lbox(b, 'dark', -.8, 1.62, 1.2, 2.6, .05, 1.1);
    for (let i = 0; i < 3; i++) lbox(b, 'steel', -2 + i * .6, 1.9, 1.2, .18, .6, .18);
    lbox(b, 'panel', 2.6, 1.3, 1.6, .9, 1.4, .3); b.genP = L(-.8, 1.2, -.2);
    locker(b, -hw + .35, -1.2, -PI / 2); spot('rig', ...L(2.6, .9, -1.6)); lbox(b, 'steel', 2.6, .45, -1.6, 1, .9, .6); solid(2.6, -1.6, 1, .6, .9);
  } else if (b.kind === 'ctrl') {
    lbox(b, 'panel', 0, .55, hd - .5, 6, 1.1, .7); solid(0, hd - .5, 6, .7, 1.1); lbox(b, 'screen', 0, 1.2, hd - .7, 5, .35, .05);
    for (let i = 0; i < 4; i++) lbox(b, 'screen', -2.4 + i * 1.6, 1.13, hd - .78, .9, .4, .03, 0);
    b.console = L(-1, 1.1, hd - 1.1); locker(b, -hw + .35, -1.2, -PI / 2); spot('rig', ...L(2.6, 1.12, hd - .55)); spot('rig', ...L(-2, .1, -1.6));
  } else if (b.kind === 'hut') {
    lbox(b, 'log', -hw + .55, .3, 1, 1, .5, 2); lbox(b, 'fabric', -hw + .55, .6, 1, .9, .1, 1.9); solid(-hw + .55, 1, 1, 2, .7);
    lbox(b, 'log', 1.4, .4, 1.4, 1.4, .8, .8); solid(1.4, 1.4, 1.4, .8, .8); spot('hut', ...L(1.4, .82, 1.4)); spot('hut', ...L(-1, .1, -1.2));
    locker(b, hw - .35, -1, PI / 2);
  } else if (b.kind === 'cabin') {
    lbox(b, 'log', 0, .35, hd - .5, 3, .7, .8); solid(0, hd - .5, 3, .8, .7); spot('wreck', ...L(.6, .72, hd - .5)); locker(b, hw - .35, -.6, PI / 2);
  } else if (b.kind === 'shed') {
    lbox(b, 'log', 0, .5, hd - .5, 5, 1, .8); solid(0, hd - .5, 5, .8, 1); lbox(b, 'paper', 0, 1.4, hd - .1, 3, 1.2, .03);
    b.shop = L(0, 1.1, hd - 1.2);
    for (const s of [-1, 1]) { lbox(b, 'crate', s * 2.6, .4, 0, .8, .8, .8); solid(s * 2.6, 0, .8, .8, .8); }
  }
}
const VALVES = [];
function valve(x, y, z, name, ry) { put('red', new THREE.TorusGeometry(.32, .05, 6, 16), x, y + 1.15, z, ry); put('steel', new THREE.CylinderGeometry(.12, .12, 1.2, 8), x, y + .55, z); wbox('pipe', x, y + .85, z + .1, .3, .3, 2.6, ry); VALVES.push({x, y, z, name, open: false}); }
function buildRig() {
  for (const [x, z] of LEGS) { put('leg', new THREE.CylinderGeometry(1.4, 1.6, 50, 14), x, -15, z); OBST.push({c: 1, x, z, r: 2.1}); PCIRC.push({x, z, r: 1.6}); }
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) for (const y of [-2, 5]) { const [x0, z0] = LEGS[a], [x1, z1] = LEGS[b]; wbox('leg', (x0 + x1) / 2, y, (z0 + z1) / 2, x0 === x1 ? .5 : 22, .5, z0 === z1 ? .5 : 22); }
  slab(-8, 8, -23, -16, LV[0], 'wood'); slab(4, 8, -16, -14.4, LV[0], 'wood'); for (const x of [-7.5, 0, 7.5]) for (const z of [-22.5, -16.5]) put('leg', new THREE.CylinderGeometry(.35, .35, 6, 8), x, LV[0] - 3.2, z);
  OBST.push({x0: -8.4, x1: 8.4, z0: -22.4, z1: -14});
  rail(-8, -8, -23, -16, LV[0]); rail(8, 8, -23, -16, LV[0]); rail(-8, 4, -16, -16, LV[0]); rail(4, 8, -14.4, -14.4, LV[0]); rail(4, 4, -16, -14.4, LV[0]);
  for (const x of [-6, -2, 2, 6]) put('dark', new THREE.CylinderGeometry(.18, .22, .5, 8), x, LV[0] + .25, -22.7);
  for (let y = -1.2; y < LV[0]; y += .35) wbox('yellow', 0, y, -23.2, .6, .05, .05); INTER.push({kind: 'ladder', x: 0, y: 0, z: -23.6, r: 3.5, top: [0, LV[0], -22], label: () => 'Climb the ladder', on: () => P.sw});
  valve(-6, LV[0], -18.2, 'dock fuel valve', 0); wbox('crate', 4, LV[0] + .4, -18.5, 1.2, .8, 1); WALLS.push({x0: 3.4, x1: 4.6, z0: -19, z1: -18, y0: LV[0], y1: LV[0] + .8, see: false}); spot('rig', 4, LV[0] + .8, -18.5);
  ramp(8, 20, -16, -14.4, LV[0], LV[1], 'x+');
  slab(20, 24, -18, -9, LV[1]); slab(14, 20, -13, -9, LV[1]);
  rail(24, 24, -18, -9, LV[1]); rail(20, 24, -18, -18, LV[1]); rail(14, 24, -9, -9, LV[1]); rail(14, 20, -13, -13, LV[1]); rail(20, 20, -18, -16, LV[1]);
  slab(-14, 14, -13, 13, LV[1]);
  rail(-14, 14, -13, -13, LV[1]); rail(-14, 14, 13, 13, LV[1]); rail(-14, -14, -13, 13, LV[1]); rail(14, 14, -9, 13, LV[1]);
  ramp(1, 2.6, -9, 2, LV[1], LV[2], 'z+');
  slab(-14, 3, 2, 13, LV[2]);
  rail(-14, 3, 13, 13, LV[2]); rail(-14, -14, 2, 13, LV[2]); rail(3, 3, 2, 13, LV[2]); rail(-14, .9, 2, 2, LV[2]);
  for (const [x, z] of [[-13.5, 2.5], [2.5, 2.5], [-13.5, 12.5], [2.5, 12.5], [-6, 2.5]]) wbox('steel', x, (LV[1] + LV[2]) / 2 - .15, z, .35, LV[2] - LV[1] - .3, .35);
  for (const [x, z] of [[-6, 2.5], [-13.5, 2.5]]) WALLS.push({x0: x - .2, x1: x + .2, z0: z - .2, z1: z + .2, y0: LV[1], y1: LV[2] - .3, see: true});
  building('quarters', 'Crew quarters', 8, 6, LV[1], 'w');
  building('gen', 'Generator room', -8, -5.5, LV[1], 'e');
  building('ctrl', 'Control room', -6.5, 9.6, LV[2], 's');
  valve(-12.4, LV[1], 7, 'main deck fuel valve', PI / 2);
  const dx = 6, dz = -6, dy = LV[1];
  for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const g = new THREE.CylinderGeometry(.12, .16, 28, 6); g.translate(0, 14, 0); g.rotateX(b * -.035); g.rotateZ(a * .035); put('steel', g, dx + a, dy, dz + b); }
  for (let y = 2; y < 27; y += 3) { const w = 4 - y * .1; wbox('steel', dx, dy + y, dz - w / 2, w, .1, .1); wbox('steel', dx, dy + y, dz + w / 2, w, .1, .1); wbox('steel', dx - w / 2, dy + y, dz, .1, .1, w); wbox('steel', dx + w / 2, dy + y, dz, .1, .1, w); }
  WALLS.push({x0: dx - 2.2, x1: dx + 2.2, z0: dz - 2.2, z1: dz + 2.2, y0: dy, y1: dy + 3, see: false}); bx('steel', dx - 2.2, dx + 2.2, dy, dy + .6, dz - 2.2, dz + 2.2);
  wbox('pipe', dx, dy + 1.8, dz, .5, 3.6, .5); spot('rig', dx - 2.6, dy + .05, dz + 2.6); G.avi = [dx, dy + 28.5, dz];
  { const cx = 12.5, cz = 1.2, y1 = LV[1], tx = cx + 16.46, ty = y1 + 11.09, tz = cz + 5.16; // pedestal crane on the deck edge, boom out over the sea (clear of the crew quarters)
    put('yellow', new THREE.CylinderGeometry(.7, .9, 6, 12), cx, y1 + 3, cz); wbox('yellow', cx, y1 + 6.6, cz, 2.2, 1.8, 2.2, -.3); wbox('glass', cx + 1.07, y1 + 6.9, cz + .33, .06, .7, 1.4, -.3); wbox('dark', cx - 1.53, y1 + 6.3, cz - .47, 1.2, 1.1, 1.8, -.3);
    put('steel', boxUV(new THREE.BoxGeometry(18, .5, .5), 18, .5, .5, 1.5), cx + 8.2, y1 + 8.6, cz + 2.6, -.3, 0, .28);
    put('dark', new THREE.CylinderGeometry(.03, .03, 4, 4), tx, ty - 2, tz); wbox('yellow', tx, ty - 4.2, tz, .32, .45, .32); put('steel', new THREE.TorusGeometry(.17, .04, 6, 10, PI * 1.4), tx, ty - 4.62, tz, 0, 0, -PI * .2);
    WALLS.push({x0: cx - .9, x1: cx + .9, z0: cz - .9, z1: cz + .9, y0: y1, y1: y1 + 6, see: true}); }
  for (const [x, z, c, r] of [[-9, -11.6, 'cont', 0], [10, -11.4, 'cont2', 0], [12, -3, 'cont', PI / 2]]) { wbox(c, x, LV[1] + 1.3, z, 6, 2.6, 2.4, r, 3); const w = r ? 2.4 : 6, d = r ? 6 : 2.4; WALLS.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: LV[1], y1: LV[1] + 2.6, see: true}); }
  spot('rig', -5.5, LV[1] + .05, -10); spot('rig', 12.8, LV[1] + .05, 6);
  for (let i = 0; i < 4; i++) wbox('pipe', -2 + i * .55, LV[1] + .4, 0, .4, .4, 9); WALLS.push({x0: -2.3, x1: 0, z0: -4.5, z1: 4.5, y0: LV[1], y1: LV[1] + .8, see: false});
  wbox('orange', -11, LV[2] + 1, 4, 2.4, 1.6, 4.6, 0); WALLS.push({x0: -12.2, x1: -9.8, z0: 1.7, z1: 6.3, y0: LV[2], y1: LV[2] + 2, see: true}); spot('rig', -9.2, LV[2] + .05, 3);
  spot('rig', 1.5, LV[2] + .05, 12.2); spot('rig', 20.8, LV[1] + .05, -10.2); spot('rig', -7, LV[0] + .05, -21);
  for (const [x, y, z] of [[13.5, LV[1] + 3, -12.5], [-13.5, LV[1] + 3, -12.5], [13.5, LV[1] + 3, 12.5], [-13.5, LV[2] + 3, 12.5], [0, LV[0] + 3, -16.5], [20, LV[1] + 3, -17.5], [0, LV[1] + 3, 0]]) { wbox('steel', x, y - 1.5, z, .12, 3, .12); put('bulb', new THREE.BoxGeometry(.6, .3, .3), x, y + .1, z); LAMPS.push([x, y, z, 1.6]); }
  extRig(); POIS.push({n: 'Station Nine', x: 0, z: 0, r: 40, rig: 1});
}
function buildHome() {
  extHome(); // the rock (a ring mesh), its pines, the jetty lamps and the lighthouse door
  OBST.push({c: 1, x: HOME.x, z: HOME.z, r: HOME.r + 1});
  SURF.push({k: 'disc', x: HOME.x, z: HOME.z, r: HOME.r * .7 - .2, y: 2, x0: HOME.x - 21, x1: HOME.x + 21, z0: HOME.z - 21, z1: HOME.z + 21});
  SURF.push({k: 'slab', x0: -2.5, x1: 2.5, z0: -256, z1: -233, y: 1.6}); bx('wood', -2.5, 2.5, 1.3, 1.6, -256, -233, 1.5);
  OBST.push({x0: -2, x1: 2, z0: -256, z1: -232.6});
  for (const z of [-249, -245, -241, -237, -233.5]) for (const x of [-2.2, 2.2]) put('log', new THREE.CylinderGeometry(.15, .15, 4, 6), x, -.5, z);
  INTER.push({kind: 'ladder', x: 0, y: 0, z: -232.3, r: 3.5, top: [0, 1.6, -234], label: () => 'Climb the ladder', on: () => P.sw});
  const lx = 6, lz = -284, lr = q => 3.4 - 1.2 * q / 26 + .04; put('white', new THREE.CylinderGeometry(2.2, 3.4, 26, 24), lx, 15, lz); for (let y = 6; y < 26; y += 6) put('red', new THREE.CylinderGeometry(lr(y + .8), lr(y - .8), 1.6, 24, 1, true), lx, 2 + y, lz);
  put('dark', new THREE.CylinderGeometry(3.1, 2.7, .3, 24), lx, 27.95, lz); for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; put('dark', new THREE.CylinderGeometry(.035, .035, 1, 4), lx + Math.cos(a) * 2.98, 28.6, lz + Math.sin(a) * 2.98); } put('dark', new THREE.TorusGeometry(2.98, .045, 4, 32), lx, 29.1, lz, 0, PI / 2); for (const y of [9, 15, 21]) put('dark', new THREE.BoxGeometry(.45, .85, .1), lx, y, lz + lr(y - 2) - .02); put('dark', new THREE.CylinderGeometry(2, 2.05, .25, 16), lx, 28.22, lz); put('glassL', new THREE.CylinderGeometry(1.8, 1.8, 2.2, 16), lx, 29.2, lz); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; put('dark', new THREE.BoxGeometry(.09, 2.2, .09), lx + Math.cos(a) * 1.83, 29.2, lz + Math.sin(a) * 1.83, -a); } put('dark', new THREE.CylinderGeometry(1.95, 1.95, .14, 16), lx, 30.33, lz); put('dark', new THREE.ConeGeometry(2.3, 1.6, 16), lx, 31.1, lz); put('dark', new THREE.SphereGeometry(.2, 8, 6), lx, 32, lz); PCIRC.push({x: lx, z: lz, r: 3.6});
  G.lh = [lx, 29.2, lz];
  G.shed = building('shed', 'Harbour shed', -9, -265, 2, 'e');
  { const sc = cv(512, 128, (g, w, h) => { g.fillStyle = '#2a1c12'; g.fillRect(0, 0, w, h); g.globalAlpha = .18; for (let y = 0; y < h; y += 16) { g.fillStyle = y % 32 ? '#000' : '#6a4a30'; g.fillRect(0, y, w, 3); } g.globalAlpha = 1; g.strokeStyle = '#8a6a44'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12);
      g.textAlign = 'center'; g.fillStyle = '#f2e6cc'; g.font = 'bold 50px Georgia'; g.fillText('HARBOUR SHED', w / 2, 66); g.font = '22px Georgia'; g.fillStyle = '#d8c8a8'; g.fillText('SALVAGE BOUGHT  ·  SUPPLIES', w / 2, 104); noiseFill(g, w, h, 14); });
    const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace; const sg = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({map: st, roughness: .85, metalness: 0}));
    const [sx, sz] = L2W(G.shed, 0, -2.82); sg.position.set(sx, 5.2, sz); sg.rotation.y = G.shed.th + PI; scene.add(sg); // hangs just in front of the roof edge
    const [ax, az] = L2W(G.shed, 0, -2.79), [lx, lz] = L2W(G.shed, 0, -2.96); put('dark', new THREE.BoxGeometry(.06, .06, .44), ax, 4.44, az, G.shed.th); put('dark', new THREE.CylinderGeometry(.03, .16, .1, 10), lx, 4.42, lz); put('glassL', new THREE.SphereGeometry(.07, 10, 8), lx, 4.33, lz);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffb860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .6})); gl.scale.setScalar(1.5); gl.position.set(lx, 4.32, lz); scene.add(gl); G.shedGlow = gl; G.shedLamp = [lx, 4.5, lz, 1]; }
  G.casino = casBuild(); G.casP = null;
  POIS.push({n: 'Lighthouse station', x: HOME.x, z: HOME.z, r: 40, home: 1});
}
// islands: noisy domes (an atoll is a ring) walkable from the beach
const IPADS = [];
function isleH(I, x, z, clean) {
  const d = Math.hypot(x - I.x, z - I.z) / I.r; if (d > 1.4) return -9;
  const sp = (I.extL || extLook(I)).shape; let h;
  if (I.ring) { const p = Math.exp(-((d - .75) ** 2) / .03); h = d < .75 ? mix(-1.4, I.top, p) : mix(-4.5, I.top, p); }
  else if (sp === 'spire') h = Math.max(I.top * Math.pow(clamp(1 - d / .95, 0, 1), .45), mix(-4.5, .8, 1 - smooth((d - .8) / .55)));
  else if (sp === 'cliff') h = d < .52 ? mix(I.top, I.top * .82, d / .52) : d < .62 ? mix(I.top * .82, 1.3, smooth((d - .52) / .1)) : mix(1.3, -4.5, smooth((d - .62) / .72));
  else if (sp === 'crater') h = d < .5 ? mix(I.top * .3, I.top, smooth(d / .5) ** 2) : mix(-4.5, I.top, 1 - smooth((d - .5) / .75));
  else h = mix(-4.5, I.top, 1 - smooth((d - .3) / .85));
  if (I.bar) h += .7 * Math.exp(-((x - I.x - 3) ** 2 + (z - I.z + 7) ** 2) / 50);
  if (!clean) { const k = clamp((h + 1) / 3, 0, 1); h += (fbm(x * .035 + I.x * .01, z * .035) - .5) * (2 + I.top * .6) * k * (sp === 'cliff' && d > .48 && d < .66 ? .45 : 1); }
  for (const p of IPADS) { if (p.I !== I) continue; const e = Math.hypot(x - p.x, z - p.z); if (e < p.r + p.f) { const w = e < p.r ? 1 : smooth(1 - (e - p.r) / p.f); h = mix(h, p.h, w); } }
  return h;
}
function seaBed(x, z) { const h = landH(x, z); if (h > -9) return h; let d = Math.min(Math.hypot(x, z) - 45, Math.hypot(x - HOME.x, z - HOME.z) - 60); for (const I of ISLES) d = Math.min(d, Math.hypot(x - I.x, z - I.z) - I.r * 1.4); const s = smooth(clamp(d / 150, 0, 1)), dc = Math.hypot(x, z + 60); let b = -9 - 21 * s - 25 * smooth(clamp((dc - 900) / 900, 0, 1)) + (fbm(x * .02, z * .02) - .5) * 3; if (dc > 2700) b = mapBed(x, z, b, s, dc); for (const q of DSITES) { const e = Math.hypot(x - q.x, z - q.z) / q.r; if (e < 2) b = q.field ? mix(b, -q.d + (fbm(x * .05, z * .05) - .5) * 6, 1 - smooth((e - .8) / .7)) : Math.min(b, -q.d * (1 - smooth(clamp(e - .3, 0, 1)))); } return b; }
const SUNK = [];
function placeSunk(seed) { for (const q of SUNK) scene.remove(q.m); SUNK.length = 0; const r = mulberry(seed ^ 0x51ab);
  const put = (x, z, kind) => { const y = seaBed(x, z), m = itemMesh(kind); m.scale.setScalar(1.6); m.position.set(x, y + .2, z); m.rotation.set(.3, r() * TAU, .2);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x7affd0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); gl.scale.setScalar(5); gl.position.set(0, .6, 0); m.add(gl); scene.add(m); SUNK.push({x, z, y, kind, m, got: false}); };
  for (const q of DSITES) for (let i = 0; i < 12; i++) { const a = r() * TAU, d = Math.sqrt(r()) * q.r * .8; put(q.x + Math.sin(a) * d, q.z + Math.cos(a) * d, ['gold', 'pearl', 'pearl', 'chest', 'relic', 'gold'][Math.floor(r() * 6)]); }
  for (let k = 0; k < 1800 && SUNK.length < DSITES.length * 12 + 40; k++) { const a = r() * TAU, d = 150 + r() * (MAP_R - 450), x = MAP_C.x + Math.sin(a) * d, z = MAP_C.z + Math.cos(a) * d; if (Math.hypot(x - MAP_C.x, z - MAP_C.z) > MAP_R - 100 || seaBed(x, z) > -17 || SUNK.some(q => Math.hypot(q.x - x, q.z - z) < 90)) continue;
    const kind = r() < .45 ? 'chest' : r() < .5 ? 'blackbox' : 'relic', y = seaBed(x, z), m = itemMesh(kind); m.scale.setScalar(1.6); m.position.set(x, y + .2, z); m.rotation.set(.3, r() * TAU, .2);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x7affd0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); gl.scale.setScalar(5); gl.position.set(0, .6, 0); m.add(gl); scene.add(m); SUNK.push({x, z, y, kind, m, got: false}); } }
function landH(x, z) { let h = -9; for (const I of ISLES) { if (Math.abs(x - I.x) > I.r * 1.4 || Math.abs(z - I.z) > I.r * 1.4) continue; h = Math.max(h, isleH(I, x, z)); } return h; }
function colGeo(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = .75 + .25 * h2(i, 7); a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function mergeC(list) { const qs = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; qs.forEach(q => n += q.attributes.position.count); const p = new Float32Array(n * 3), no = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0; for (const q of qs) { p.set(q.attributes.position.array, o * 3); no.set(q.attributes.normal.array, o * 3); c.set(q.attributes.color.array, o * 3); o += q.attributes.position.count; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(no, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
// trees (lo: the far variant): a curved palm with drooping fronds, a tiered pine, a dead snag; each with scrub at its foot
function extBush(parts, c, n, s) { for (let i = 0; i < n; i++) { const b = new THREE.IcosahedronGeometry(s * (.7 + h2(i, n) * .5), 0); b.scale(1.2, .55, 1.1); b.translate(Math.cos(i * 2.4 + 1) * (.9 + i * .3), .2, Math.sin(i * 2.4 + 1) * (.9 + i * .3)); parts.push(colGeo(b, c)); } }
function palmGeo(lo) {
  const parts = [], ns = lo ? 3 : 6, sl = 7.8 / ns; let x = 0, y = 0;
  for (let i = 0; i < ns; i++) { const b = .08 * i * 6 / ns, s = new THREE.CylinderGeometry(.14 - i * .06 / ns, .18 - i * .06 / ns, sl * 1.02, lo ? 4 : 6, 1, true); s.rotateZ(-b); s.translate(x, y + sl / 2, 0); parts.push(colGeo(s, [.22, .15, .1])); x += Math.sin(b) * sl; y += Math.cos(b) * sl; }
  const nf = lo ? 5 : 8; for (let i = 0; i < nf; i++) { const a = i / nf * TAU + (i % 2) * .2, d = .35 + (i % 2) * .2; for (let k = 0; k < (lo ? 1 : 2); k++) { const L = lo ? 3.2 : 1.7, f = new THREE.BoxGeometry(.5 - k * .12, .04, L); f.translate(0, 0, L / 2); f.rotateX(lo ? d + .3 : d + k * .55); if (k) f.translate(0, -Math.sin(d) * 1.7, Math.cos(d) * 1.7); f.rotateY(a); f.translate(x, y, 0); parts.push(colGeo(f, i % 3 ? [.14, .3, .1] : [.2, .34, .12])); } }
  if (!lo) { for (let i = 0; i < 3; i++) { const c = new THREE.IcosahedronGeometry(.16, 0); c.translate(x + Math.cos(i * 2.1) * .25, y - .25, Math.sin(i * 2.1) * .25); parts.push(colGeo(c, [.3, .22, .08])); } extBush(parts, [.12, .24, .08], 2, .8); }
  return mergeC(parts);
}
function pineGeo(lo) { const parts = [], tr = new THREE.CylinderGeometry(.12, .3, 9, lo ? 4 : 6, 1, true); tr.translate(0, 4.5, 0); parts.push(colGeo(tr, [.2, .14, .09])); const nt = lo ? 3 : 5; for (let i = 0; i < nt; i++) { const c = new THREE.ConeGeometry((2.3 - i * .38 * 5 / nt) * (lo ? 1.05 : 1), lo ? 3.6 : 2.6, lo ? 5 : 8); c.translate(0, (lo ? 3.2 + i * 2.4 : 2.6 + i * 1.5 + 1.3), 0); c.rotateY(i * .7); parts.push(colGeo(c, i % 2 ? [.07, .14, .09] : [.09, .17, .1])); } if (!lo) extBush(parts, [.1, .19, .09], 2, .7); return mergeC(parts); }
function deadGeo(lo) { const parts = []; const tr = new THREE.CylinderGeometry(.08, .26, 7, lo ? 4 : 5, 1, true); tr.translate(0, 3.5, 0); parts.push(colGeo(tr, [.18, .16, .15])); const nb = lo ? 3 : 6; for (let i = 0; i < nb; i++) { const b = new THREE.CylinderGeometry(.02, .06, 2.2, 4, 1, true); b.translate(0, 1.1, 0); b.rotateZ(1 + h2(i, 3) * .5); b.rotateY(i * 2.1); b.translate(0, 2.2 + i * .8 * 6 / nb, 0); parts.push(colGeo(b, [.18, .16, .15])); if (!lo && i % 2) { const t = new THREE.CylinderGeometry(.01, .025, 1, 3, 1, true); t.translate(0, .5, 0); t.rotateZ(-.6); t.rotateY(i * 2.1 + .8); t.translate(Math.cos(i * 2.1) * .9, 3.2 + i * .8, -Math.sin(i * 2.1) * .9); parts.push(colGeo(t, [.2, .18, .16])); } } if (!lo) extBush(parts, [.2, .19, .15], 2, .6); return mergeC(parts); }
function buildIsleSites() {
  for (const I of ISLES) {
    if (I.hut) { const x = I.x + 6, z = I.z + 4; IPADS.push({I, x, z, r: 5, f: 5, h: isleH(I, x, z) + .1}); }
    for (let k = 0, c = 0; k < 60 && c < Math.round(I.r / 12) + 1; k++) { const a = R() * TAU, d = (.2 + R() * .6) * I.r, x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, h = isleH(I, x, z); if (h < .6) continue; c++; spot('isle', x, h + .05, z); }
    if (I.hut) { const p = IPADS.find(q => q.I === I); building('hut', "Hermit's hut", p.x, p.z, p.h, 'w'); }
    if (I.ruin) { extRuin(I); const x = I.x - 4, z = I.z + 3, y = isleH(I, x, z); PCIRC.push({x, z, r: 3.3}); spot('isle', x + 4, y + .05, z); }
    if (I.skull) extSkull(I);
  }
  // buried treasure: cairns of stones on three islands
  for (const [ii, dx, dz] of [[3, 4, -6], [1, -12, 10], [4, 10, 8]]) { const I = ISLES[ii], x = I.x + dx, z = I.z + dz, y = isleH(I, x, z); DIGS.push({x, y, z, isle: I.n, dug: false, rev: false}); for (let k = 0; k < 5; k++) wbox('rock', x + Math.cos(k * 1.3) * .5, y + .15, z + Math.sin(k * 1.3) * .5, .4, .3, .35, k); }
  const QR = mulberry(4242); for (const I of ISLES.filter(q => !q.nw).concat(ISLES.filter(q => q.nw))) { if (I.bar || DIGS.length >= 40 || DIGS.some(d => d.isle === I.n) || Math.hypot(I.x - HOME.x, I.z - HOME.z) < 900) continue;
    for (let k = 0; k < 120; k++) { const a = QR() * TAU, d = (.12 + QR() * .95) * I.r, x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, y = isleH(I, x, z); if (y <= .6 || IPADS.some(p => p.I === I && Math.hypot(x - p.x, z - p.z) < p.r + 8) || (I.hut && Math.hypot(x - I.x - 6, z - I.z - 4) < 8) || (I.ruin && Math.hypot(x - I.x + 4, z - I.z - 3) < 8) || (I.skull && Math.hypot(x - I.x, z - I.z) < 13) || SPOTS.some(q => Math.hypot(x - q.x, z - q.z) < 3)) continue;
      DIGS.push({x, y, z, isle: I.n, dug: false, rev: false}); for (let j = 0; j < 5; j++) wbox('rock', x + Math.cos(j * 1.3) * .5, y + .15, z + Math.sin(j * 1.3) * .5, .4, .3, .35, j); break; } }
}
function buildIsles() {
  for (const W of WRECKS) ISLES.push({n: W.n, x: W.x + 12, z: W.z, r: 24, top: .5, bar: 1, w: W});
  for (const I of ISLES) {
    let lo = 0, hi = 1.4; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (isleH(I, I.x + m * I.r, I.z, true) > -.9) lo = m; else hi = m; } I.shore = lo * I.r;
    OBST.push({c: 1, x: I.x, z: I.z, r: I.shore, isle: I});
    if (!I.bar) POIS.push({n: I.n, x: I.x, z: I.z, r: I.shore + 10, isle: I});
  }
  // one mesh per island (one shared material: vertex colours by palette, height and slope) and its trees; culled and LODed in extFx
  ISLES.forEach((I, k) => { const e = {I, m: extIsleMesh(I), tr: []}; if (I.bar) extBar(I, k); else { const t = extTrees(I, k); if (t) e.tr.push(t); }
    if (typeof pfCull === 'function') { e.pf = 1; pfCull(e.m, I.x, I.z, I.r * 1.4, {sh: 150}); e.tr.forEach(t => pfCull(t, I.x, I.z, I.r * 1.15 + 10, {sh: 160})); } EXT.isles.push(e); });
}
function buildWrecks() {
  G.ghostLights = [];
  WRECKS.forEach((W, wi) => {
    const x = W.x, z = W.z, dy = 2.2, r = mulberry(0x3ec + wi), ls = (r() < .5 ? -1 : 1) * (.06 + r() * .08), pt = r() * .04;
    // hull: a list and a bow-up pitch about the stern, lifted so the lowest gunwale over the flat walkable deck stays at deck level; a breach at the waterline
    const sh = new THREE.Shape(); sh.moveTo(-3.6, 13); sh.lineTo(3.6, 13); sh.lineTo(3.8, -6); sh.quadraticCurveTo(2.5, -13, 0, -16); sh.quadraticCurveTo(-2.5, -13, -3.8, -6); sh.closePath();
    const M = new THREE.Matrix4().makeTranslation(0, 0, 13).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pt, 0, ls, 'XYZ'))).multiply(new THREE.Matrix4().makeTranslation(0, 0, -13)), tv = new THREE.Vector3();
    let lift = 9; for (const [cx, cz] of [[-3.7, -10], [3.7, -10], [-3.62, 12], [3.62, 12]]) lift = Math.min(lift, tv.set(cx, 0, cz).applyMatrix4(M).y); lift = dy - .3 - lift;
    const hg = new THREE.ExtrudeGeometry(sh, {depth: 6.4, bevelEnabled: false}); hg.rotateX(PI / 2); hg.applyMatrix4(M); put(W.ghost ? 'ghostH' : wi % 2 ? 'extRust2' : 'rustH', hg, x, lift, z);
    { const bs = new THREE.Shape(), sd = r() < .5 ? -1 : 1, bz = -2 + r() * 9; [[-1.3, -.2], [-.7, .55], [-.1, .2], [.4, .75], [1.25, .1], [.9, -.5], [.2, -.75], [-.6, -.45]].forEach(([u, v], i) => i ? bs.lineTo(u * (1 + r() * .3), v * 1.4) : bs.moveTo(u, v * 1.4));
      const bg = new THREE.ShapeGeometry(bs); bg.rotateY(sd * PI / 2); bg.translate(sd * (3.6 + .2 * (13 - bz) / 19 + .04), -1.9, bz); bg.applyMatrix4(M); put('dark', bg, x, lift, z); }
    OBST.push({x0: W.x - 4, x1: W.x + 4, z0: W.z - 16.5, z1: W.z + 13.5});
    slab(x - 3.4, x + 3.4, z - 10, z + 12, dy, 'planks');
    for (let i = 0; i < 6; i++) if (i !== 2 && i !== 4) rail(x - 3.5, x - 3.4, z - 10 + i * 3.7, z - 10 + i * 3.7 + 3.5, dy, 'rustR');
    for (let i = 0; i < 6; i++) if (i !== 3) rail(x + 3.4, x + 3.5, z - 10 + i * 3.7, z - 10 + i * 3.7 + 3.5, dy, 'rustR');
    WALLS.push({x0: x - 3.6, x1: x + 3.6, z0: z - 16, z1: z - 10, y0: dy - .2, y1: dy + 2.5, see: true});
    ramp(x + 3.4, x + 10, z + 1, z + 3, dy, .4, 'x+', 'planks', 'rustR');
    // a broken mast stub, tilted, with its yard lying on the deck
    { const hm = 2 + r() * 4, tl = (10 + r() * 25) * PI / 180, ta = r() * TAU, g = new THREE.CylinderGeometry(.12, .2, hm, 7), c = new THREE.ConeGeometry(.12, .45, 5); g.translate(0, hm / 2, 0); c.translate(.03, hm + .2, 0); put('log', g, x, dy, z - 4, ta, tl, 0); put('log', c, x, dy, z - 4, ta, tl, 0);
      wbox('log', x + (r() - .5) * 1.6, dy + .12, z - 1 + r() * 4, 5 + r(), .2, .2, (r() - .5) * 1.2); wbox('rustR', x + 1.2, dy + .2, z + 3.5 + r() * 2, .9, .4, .7, r()); PCIRC.push({x, z: z - 4, r: .3}); }
    const cab = building('cabin', W.n + ' cabin', x, z + 8.5, dy, 'n'); cab.wreck = W;
    spot('wreck', x - 2, dy + .05, z - 6); spot('wreck', x + 2.2, dy + .05, z + 2); spot('wreck', x + 7, .5, z + 6);
    POIS.push({n: W.n, x, z, r: 30, wreck: W});
    if (W.ghost) for (let i = 0; i < 5; i++) G.ghostLights.push([x + (i % 2 ? 3.7 : -3.7), dy - 1, z - 8 + i * 4]);
  });
}
function buildBuoys() {
  const br = mulberry(0xb0e), clear = (x, z, s) => !(OBST.some(o => o.c && Math.hypot(x - o.x, z - o.z) < o.r + 50) || Math.hypot(x, z) < 70 || BUOYS.some(b => Math.hypot(b.x - x, b.z - z) < s));
  for (let k = 0; k < 900 && BUOYS.length < 28; k++) { const a = br() * TAU, d = Math.sqrt(br()) * 1400, x = MAP_C.x + Math.sin(a) * d, z = MAP_C.z + Math.cos(a) * d; if (!clear(x, z, 140)) continue; BUOYS.push({x, z, c: [0xff2a1a, 0x2aff4a, 0xffd02a][BUOYS.length % 3]}); OBST.push({c: 1, x, z, r: 1.2}); }
  // channel marks: white lights along the lanes from the lighthouse out toward the far regions (all five at 45 %, three more at 70 %)
  for (const t of [.45, .7]) for (const q of REGIONS) { if (BUOYS.length >= 36) break; for (let j = 0; j < 9; j++) { const o = (j + 1 >> 1) * (j % 2 ? 30 : -30), dx = q.x - HOME.x, dz = q.z - HOME.z, l = Math.hypot(dx, dz), x = HOME.x + dx * t + dz / l * o, z = HOME.z + dz * t - dx / l * o; if (!clear(x, z, 300)) continue; BUOYS.push({x, z, c: 0xeef4ff, ch: q.k}); OBST.push({c: 1, x, z, r: 1.2}); break; } }
}

// ---------------- exteriors: the home rock, island looks and trees, wreck variety, rig dressing, buoys and night glows
const EXT = {isles: [], t: 0, geo: null, home: null, homeTr: null, rigPts: null, harbPts: null, flare: null, mist: null, buoy: null, serPts: null, tv: new THREE.Vector3()};
// legacy island looks by name; the map package gives new islands shape/pal/dens fields directly
const EXT_LOOK = {'Gull Rock': {shape: 'cliff'}, "Widow's Spire": {shape: 'spire', pal: 'moss'}, 'Frostbite Isle': {pal: 'snow'}, 'Black Sands': {pal: 'black'}, 'Coral Crown': {pal: 'coral'}, 'Ashen Atoll': {pal: 'ash'}, 'Ossuary Reef': {pal: 'ash'}, 'Palm Key': {sand: 'coral'}, 'Sunken Bell Key': {sand: 'coral'}};
// linear rgb: s dry sand, w wet sand, v vegetation, r rock, t high ground (snow on 'snow')
const EXT_PAL = {
  green: {s: [.62, .56, .42], w: [.33, .29, .22], v: [.15, .23, .11], r: [.31, .3, .28], t: [.36, .35, .33]},
  snow: {s: [.5, .5, .48], w: [.26, .27, .28], v: [.2, .24, .22], r: [.27, .3, .35], t: [.86, .9, .95]},
  black: {s: [.1, .095, .09], w: [.05, .05, .05], v: [.12, .18, .09], r: [.09, .09, .09], t: [.14, .14, .13]},
  coral: {s: [.86, .78, .62], w: [.55, .49, .39], v: [.2, .33, .14], r: [.62, .44, .43], t: [.6, .48, .45]},
  ash: {s: [.42, .41, .39], w: [.2, .2, .2], v: [.29, .28, .26], r: [.19, .19, .19], t: [.25, .25, .24]},
  moss: {s: [.46, .44, .36], w: [.23, .23, .19], v: [.18, .27, .11], r: [.25, .28, .22], t: [.3, .33, .26]}};
function extLook(I) { const L = EXT_LOOK[I.n] || {}, pal = EXT_PAL[I.pal] ? I.pal : L.pal || 'green'; return (I.extL = {shape: I.shape || L.shape || 'dome', pal, sand: L.sand || pal, dens: I.dens ?? L.dens ?? 1}); }
// the home rock: a flat pad at y 2 to r 21, a rocky fall to -4.5 by r 31 and a pale beach on the jetty side
function extHomeH(x, z) {
  const dx = x - HOME.x, dz = z - HOME.z, r = Math.hypot(dx, dz); if (r <= 21) return 2;
  const n = fbm(x * .09 + 3.1, z * .09 - 1.7) - .5, bw = smooth((dz / r - .25) / .45);
  const rock = r < 31 ? 2 - 6.5 * Math.pow((r - 21) / 10, .6) + n * 2.6 * Math.sin(PI * (r - 21) / 10) : mix(-4.5, -9.6, smooth((r - 31) / 11));
  if (bw <= 0) return rock;
  const beach = r < 22.5 ? mix(2, 1.15, smooth((r - 21) / 1.5)) : r < 27.5 ? mix(1.15, -.8, (r - 22.5) / 5) + n * .35 : r < 31 ? mix(-.8, -4.5, smooth((r - 27.5) / 3.5)) : rock;
  return mix(rock, beach, bw);
}
{ const f0 = landH; landH = function (x, z) { const h = f0(x, z), dx = x - HOME.x, dz = z - HOME.z; return dx * dx + dz * dz > 1764 ? h : Math.max(h, extHomeH(x, z)); }; }
{ const f0 = materials; materials = function () { const r = f0.apply(this, arguments); extMats(); return r; }; }
{ const f0 = updateWorldFx; updateWorldFx = function () { const r = f0.apply(this, arguments); extFx(arguments[0] || 0); return r; }; }
{ const f0 = buildFw; buildFw = function () { const r = f0.apply(this, arguments); extGlows(); return r; }; }
{ const f0 = buildWorld; buildWorld = function () { const was = BUILT, r = f0.apply(this, arguments); if (!was && BUILT) extHarbour(); return r; }; }
function extTex() {
  if (TX.extDetail) return;
  const dots = (g, w, h, n, f) => { for (let i = 0; i < n; i++) { const x = Math.random() * w, y = Math.random() * h, r = f(); for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill(); } } };
  const streaks = (g, w, h, n, a, y0 = 0, y1 = .8) => { for (let i = 0; i < n; i++) { const x = Math.random() * w, y = (y0 + Math.random() * (y1 - y0)) * h, l = 20 + Math.random() * h * .5, gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, `rgba(72,58,44,${a * (.5 + Math.random())})`); gr.addColorStop(1, 'rgba(72,58,44,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + Math.random() * 3, l); } };
  EXT.streaks = streaks;
  TX.extDetail = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,36,30,.07)'; dots(g, w, h, 240, () => 3 + Math.random() * 16); g.fillStyle = 'rgba(255,255,255,.08)'; dots(g, w, h, 160, () => 2 + Math.random() * 10); g.fillStyle = 'rgba(30,26,22,.13)'; dots(g, w, h, 600, () => .6 + Math.random() * 1.6); noiseFill(g, w, h, 18); }));
  TX.extGrime = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, w, h); streaks(g, w, h, 70, .14); rust(g, w, h, 18); noiseFill(g, w, h, 14); }));
  TX.extGrimeW = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#f6f4f0'; g.fillRect(0, 0, w, h); streaks(g, w, h, 46, .1); const gr = g.createLinearGradient(0, h * .84, 0, h); gr.addColorStop(0, 'rgba(60,54,44,0)'); gr.addColorStop(1, 'rgba(60,54,44,.18)'); g.fillStyle = gr; g.fillRect(0, h * .84, w, h * .16); noiseFill(g, w, h, 10); }));
  TX.extLeg = tex(cv(256, 256, (g, w, h) => { g.drawImage(TX.plate.image, 0, 0, w, h); streaks(g, w, h, 60, .24); rust(g, w, h, 40); }));
  // the Serenade's topsides: rust runs from the porthole rows (three per 9.6 m tile) and a dirty boot top; v runs down from the deck edge
  TX.extSerTop = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, h); streaks(g, w, h, 30, .1, 0, .1);
    for (const u of [1 / 6, .5, 5 / 6]) for (let k = 0; k < 5; k++) { const x = u * w + (Math.random() - .5) * 14, y = h * .5, l = h * (.15 + Math.random() * .3), gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, `rgba(110,52,22,${.25 + Math.random() * .25})`); gr.addColorStop(1, 'rgba(110,52,22,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + Math.random() * 3, l); }
    const gr = g.createLinearGradient(0, h * .86, 0, h); gr.addColorStop(0, 'rgba(70,40,26,0)'); gr.addColorStop(.4, 'rgba(70,40,26,.45)'); gr.addColorStop(1, 'rgba(40,30,22,.8)'); g.fillStyle = gr; g.fillRect(0, h * .86, w, h * .14); rust(g, w, h, 30); noiseFill(g, w, h, 12); }));
  TX.extSerTop.flipY = false; TX.extSerTop.repeat.set(1 / 9.6, 1 / 7.6);
}
function extMats() {
  extTex(); MAT.white.map = TX.extGrimeW; MAT.steel.map = TX.extGrime; MAT.leg.map = TX.extLeg;
  MAT.ghostH.emissive.setHex(0x3ac890); MAT.ghostH.emissiveMap = TX.rustH; MAT.ghostH.emissiveIntensity = 0;
  if (!MAT.winWarm) MAT.winWarm = new THREE.MeshStandardMaterial({color: 0x2a2010, emissive: 0xffb45a, emissiveIntensity: .1, roughness: .35, metalness: .1});
  MAT.extStone = new THREE.MeshStandardMaterial({map: TX.rock, color: 0xd8d0be, roughness: .95, metalness: 0, side: THREE.DoubleSide});
  MAT.extRust2 = new THREE.MeshStandardMaterial({map: TX.rustH, color: 0xc0a088, roughness: .85, metalness: .35, side: THREE.DoubleSide});
  MAT.extPortW = new THREE.MeshStandardMaterial({color: 0x1a140a, emissive: 0xffb050, emissiveIntensity: 0, roughness: .3});
  MAT.extPool = new THREE.MeshStandardMaterial({color: 0x2a6a78, roughness: .4, metalness: .1});
  EXT.isleMat = new THREE.MeshStandardMaterial({vertexColors: true, map: TX.extDetail, roughness: .95, metalness: 0, side: THREE.DoubleSide});
  EXT.treeMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, metalness: 0, flatShading: true});
}
// colour of a terrain vertex by height band and slope (rock where the normal is steep), wet sand at the waterline
function extCol(C, P, PS, h, ny, top, x, z) {
  const mx = (a, k) => { if (k <= 0) return; if (k > 1) k = 1; C[0] += (a[0] - C[0]) * k; C[1] += (a[1] - C[1]) * k; C[2] += (a[2] - C[2]) * k; };
  C[0] = PS.s[0]; C[1] = PS.s[1]; C[2] = PS.s[2];
  mx(P.v, smooth((h - 1.3) / 1.4) * (.75 + .5 * fbm(x * .04, z * .04)));
  if (P === EXT_PAL.snow) mx(P.t, smooth((h - .45 * top) / 2.5)); else if (top > 6) mx(P.t, smooth((h - .8 * top) / (.12 * top)));
  const rw = smooth((.84 - ny) / .12); mx(P.r, rw);
  const ww = smooth((.3 - h) / .5); mx(PS.w, ww * (1 - rw)); const dk = (1 - .3 * ww * rw) * mix(1, .62, smooth((-1.2 - h) / 2.5)) * (1 + (fbm(x * .07, z * .07) - .5) * .4) * 1.12;
  C[0] *= dk; C[1] *= dk; C[2] *= dk;
}
// a ring mesh: radii list (or i => radius), height and colour callbacks; world-space uv for the shared detail map
function extRing(cx, cz, rad, segs, hf, cf) {
  const rings = rad.length - 1, n = (rings + 1) * segs, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), idx = [], C = [0, 0, 0];
  for (let i = 0, v = 0; i <= rings; i++) for (let j = 0; j < segs; j++, v++) { const a = j / segs * TAU, x = cx + Math.cos(a) * rad[i], z = cz + Math.sin(a) * rad[i]; pos[v * 3] = x; pos[v * 3 + 1] = hf(x, z, i); pos[v * 3 + 2] = z; uv[v * 2] = x / 6; uv[v * 2 + 1] = z / 6; }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs, c = a + segs, d = b + segs; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const nr = g.attributes.normal.array; for (let v = 0; v < n; v++) { cf(C, pos[v * 3 + 1], nr[v * 3 + 1], pos[v * 3], pos[v * 3 + 2]); col[v * 3] = C[0]; col[v * 3 + 1] = C[1]; col[v * 3 + 2] = C[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, EXT.isleMat); m.receiveShadow = true; scene.add(m); return m;
}
function extIsleMesh(I) {
  const L = I.extL || extLook(I), P = EXT_PAL[L.pal] || EXT_PAL.green, PS = EXT_PAL[L.sand] || P, segs = clamp(Math.round(1.3 * I.r), 24, 96), rings = clamp(Math.round(I.r / 3), 18, 30), rad = [];
  for (let i = 0; i <= rings; i++) rad.push(1.4 * Math.pow(i / rings, .85) * I.r);
  return extRing(I.x, I.z, rad, segs, (x, z) => Math.max(-4.5, isleH(I, x, z)), (C, h, ny, x, z) => extCol(C, P, PS, h, ny, I.top, x, z));
}
// trees: one InstancedMesh per island (its kind), clumped, leaning, with a low-poly far variant swapped in by distance
function extTreeGeo() { if (!EXT.geo) EXT.geo = {palm: {hi: palmGeo(), lo: palmGeo(1)}, pine: {hi: pineGeo(), lo: pineGeo(1)}, dead: {hi: deadGeo(), lo: deadGeo(1)}}; return EXT.geo; }
function extInst(G0, list, tint, bs) {
  const im = new THREE.InstancedMesh(G0.hi, EXT.treeMat, list.length), c = new THREE.Color();
  list.forEach((t, i) => { _e.set(t[5], t[4], t[6], 'YXZ'); _m4.compose(_v.set(t[0], t[1], t[2]), _q.setFromEuler(_e), _s.setScalar(t[3])); im.setMatrixAt(i, _m4); const k = .86 + t[7] * .28; im.setColorAt(i, c.setRGB(k * tint[0], k * tint[1] * (.96 + t[7] * .08), k * tint[2])); });
  im.userData.gh = G0.hi; im.userData.gl = G0.lo; im.userData.lo = false; im.boundingSphere = bs; im.receiveShadow = true; scene.add(im); return im;
}
const EXT_TINT = {snow: [.92, .98, 1.06], ash: [.78, .78, .76], black: [.85, .9, .82], coral: [1.04, 1.02, .9], moss: [.95, 1.05, .85], green: [1, 1, 1]};
function extTrees(I, k) {
  const G0 = extTreeGeo()[I.trees]; if (!G0) return null;
  const L = I.extL || extLook(I), n = Math.round(I.r * I.r / 55 * L.dens), r = mulberry(0xe7e1 + k), list = [];
  for (let a = 0; a < n * 14 && list.length < n; a++) { const an = r() * TAU, d = Math.sqrt(r()) * I.r, x = I.x + Math.cos(an) * d, z = I.z + Math.sin(an) * d;
    if (fbm(x * .05, z * .05) < .45) continue; const h = isleH(I, x, z); if (h < 1.3) continue;
    if (IPADS.some(p => p.I === I && Math.hypot(x - p.x, z - p.z) < p.r + 2) || DIGS.some(q => Math.hypot(x - q.x, z - q.z) < 4) || SPOTS.some(q => Math.hypot(x - q.x, z - q.z) < 2)) continue;
    if ((I.ruin && Math.hypot(x - I.x + 4, z - I.z - 3) < 5) || (I.skull && Math.hypot(x - I.x, z - I.z) < 11)) continue;
    list.push([x, h - .2, z, .5 + r() * 1.1, r() * TAU, (r() - .5) * .16, (r() - .5) * .16, r()]); PCIRC.push({x, z, r: .35, tree: 1}); }
  return list.length ? extInst(G0, list, EXT_TINT[L.pal] || EXT_TINT.green, new THREE.Sphere(new THREE.Vector3(I.x, I.top * .5 + 4, I.z), I.r * 1.15 + 10)) : null;
}
// wreck sandbars: two or three bleached driftwood logs near the waterline, clear of the gangplank and the loot spot
function extBar(I, k) {
  const r = mulberry(0xe7e1 + k), W = I.w; let c = 0;
  for (let a = 0; a < 40 && c < 2 + (k % 2); a++) { const an = r() * TAU, d = (.3 + r() * .5) * I.r, x = I.x + Math.cos(an) * d, z = I.z + Math.sin(an) * d, h = isleH(I, x, z), L = 2.4 + r() * 2.2, yw = r() * PI;
    if (h < -.3 || h > .9 || Math.hypot(x - W.x - 7, z - W.z - 6) < 3.5 || Math.hypot(x - W.x - 10, z - W.z - 2) < 3.5 || x < W.x + 5) continue;
    put('log', new THREE.CylinderGeometry(.15, .22, L, 6), x, h + .1, z, yw, 0, PI / 2); if (r() < .6) put('log', new THREE.CylinderGeometry(.05, .08, 1.2, 4), x + Math.cos(yw) * .6, h + .35, z - Math.sin(yw) * .6, yw + 1.1, .5, PI / 2.6); c++; }
}
function extHome() {
  const P = {s: [.68, .62, .48], w: [.35, .31, .24], v: [.21, .26, .13], r: [.3, .29, .27], t: [.3, .29, .27]}, ST = [.4, .38, .34];
  const rad = [0, 8, 14, 18, 19.6, 20.4, 21, 21.5, 22.1, 22.8, 23.6, 24.5, 25.5, 26.6, 27.8, 29, 30.2, 31.4, 33.5];
  EXT.home = extRing(HOME.x, HOME.z, rad, 96, (x, z, i) => i <= 6 ? 2 : extHomeH(x, z), (C, h, ny, x, z) => { const dx = x - HOME.x, dz = z - HOME.z, r = Math.hypot(dx, dz);
    if (r <= 21.01) { const q = fbm(x * .15, z * .15), k = (1 + (fbm(x * .5, z * .5) - .5) * .3) * 1.1, s = r > 19.5 || q > .58 || (Math.abs(dx - JETTY.x) < 1.6 && dz > 4) ? 1 : 0, c = s ? ST : P.v; C[0] = c[0] * k; C[1] = c[1] * k; C[2] = c[2] * k; return; }
    extCol(C, P, P, h, ny, 2, x, z); const bw = smooth((dz / r - .25) / .45); if (h > .3) { const k = 1 - bw; C[0] += (P.r[0] - C[0]) * k; C[1] += (P.r[1] - C[1]) * k; C[2] += (P.r[2] - C[2]) * k; } });
  // pines on the south and east back half of the pad, clear of the shed, the casino, the lighthouse, the jetty path and the respawn spot
  const r = mulberry(0xe7e1 - 1), list = [], G0 = extTreeGeo().pine;
  for (let a = 0; a < 400 && list.length < 8; a++) { const an = r() * TAU, d = 13.5 + r() * 6, x = HOME.x + Math.sin(an) * d, z = HOME.z + Math.cos(an) * d;
    if (z - HOME.z > 3 && x - HOME.x < 8) continue; if (x > -14 && x < -4 && z > -269 && z < -261) continue; if (x > 7 && x < 17.5 && z > -276.5 && z < -263.5) continue;
    if (Math.hypot(x - 6, z + 284) < 6.5 || (Math.abs(x) < 4.5 && z > -264) || (x > -7 && x < 3 && z > -266 && z < -258) || list.some(t => Math.hypot(t[0] - x, t[2] - z) < 4.2)) continue;
    list.push([x, 1.9, z, .62 + r() * .4, r() * TAU, (r() - .5) * .08, (r() - .5) * .08, r()]); PCIRC.push({x, z, r: .35, tree: 1}); }
  EXT.homeTr = extInst(G0, list, [1, 1, 1], new THREE.Sphere(new THREE.Vector3(HOME.x, 8, HOME.z), 34));
  // jetty lamp posts and a lamp over the lighthouse door (glows and pooled light added after the build)
  EXT.harb = [];
  for (const [x, z] of [[2.38, -247.5], [-2.38, -241], [2.38, -234.5]]) { put('dark', new THREE.CylinderGeometry(.05, .07, 2.3, 6), x, 2.75, z); put('dark', new THREE.BoxGeometry(.06, .06, .34), x - Math.sign(x) * .14, 3.86, z, PI / 2); put('dark', new THREE.CylinderGeometry(.03, .14, .1, 8), x - Math.sign(x) * .3, 3.84, z); put('glassL', new THREE.SphereGeometry(.07, 8, 6), x - Math.sign(x) * .3, 3.75, z); EXT.harb.push([x - Math.sign(x) * .3, 3.74, z, .8]); }
  put('dark', new THREE.BoxGeometry(1.15, 2.15, .24), 6, 3.07, -280.66); put('log', new THREE.BoxGeometry(1.4, .12, .4), 6, 4.25, -280.6); put('glassL', new THREE.SphereGeometry(.08, 8, 6), 6, 4.55, -280.52); EXT.harb.push([6, 4.5, -280.45, .7]);
}
// rig dressing: X-bracing, landing columns on a y 5 frame, a cantilever helideck, a flare boom and lit windows
function extBeam(k, ax, ay, az, bx2, by, bz, w) { const dx = bx2 - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); return put(k, new THREE.BoxGeometry(L, w, w), (ax + bx2) / 2, (ay + by) / 2, (az + bz) / 2, Math.atan2(-dz, dx), 0, Math.atan2(dy, Math.hypot(dx, dz))); }
function extRig() {
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) { const [x0, z0] = LEGS[a], [x1, z1] = LEGS[b]; extBeam('leg', x0, -2, z0, x1, 5, z1, .38); extBeam('leg', x0, 5, z0, x1, -2, z1, .38); }
  for (const [x, z] of LEGS) put('rustH', new THREE.CylinderGeometry(1.47, 1.49, 2.4, 14, 1, true), x, .1, z);
  for (const [x0, x1, z0, z1] of [[11, 24, -9.75, -9.25], [9.6, 24, -15.45, -14.95], [23.25, 23.75, -17.75, -9.25], [20, 23.5, -17.75, -17.25], [10.75, 11.25, -15.2, -11]]) bx('leg', x0, x1, 4.75, 5.25, z0, z1);
  for (const [x, z] of [[23.5, -17.5], [23.5, -9.5], [20.3, -17.5], [14.5, -9.5], [20.3, -12.7], [19.6, -15.2]]) bx('leg', x - .2, x + .2, 5.25, z === -15.2 ? 9.55 : LV[1] - .9, z - .2, z + .2);
  { const hx = -21.5, hz = 7.5, hy = 17.2; put('plate', new THREE.CylinderGeometry(7, 7, .3, 8), hx, hy, hz, PI / 8); put('dark', new THREE.CylinderGeometry(7.06, 7.06, .14, 8, 1, true), hx, hy + .2, hz, PI / 8);
    put('yellow', new THREE.TorusGeometry(4, .12, 3, 28), hx, hy + .16, hz, 0, PI / 2); bx('yellow', hx - 1.6, hx - 1, hy + .15, hy + .19, hz - 2, hz + 2); bx('yellow', hx + 1, hx + 1.6, hy + .15, hy + .19, hz - 2, hz + 2); bx('yellow', hx - 1, hx + 1, hy + .15, hy + .19, hz - .3, hz + .3);
    for (const z of [hz - 2.6, hz + 2.6]) { bx('steel', -27.8, -14, hy - 1, hy - .15, z - .25, z + .25); extBeam('steel', -24, hy - .9, z, -13.6, LV[1] + .4, z, .28); }
    for (let i = 0; i < 5; i++) extBeam('steel', -14.5 - i * 2.6, hy - .9, hz - 2.6, -15.8 - i * 2.6, hy - .9, hz + 2.6, .14); }
  { const A = [13.4, LV[1] + .6, 12.6], Bp = [29, 23, 30]; for (const o of [-.45, .45]) { extBeam('steel', A[0] + o, A[1], A[2] - o, Bp[0] + o, Bp[1], Bp[2] - o, .14); extBeam('steel', A[0], A[1] + o * 1.4, A[2], Bp[0], Bp[1] + o * 1.4, Bp[2], .1); }
    for (let i = 0; i < 9; i++) { const t0 = i / 9, t1 = (i + 1) / 9, p = t => A.map((v, j) => mix(v, Bp[j], t)), a = p(t0), b = p(t1), s = i % 2 ? .45 : -.45; extBeam('steel', a[0] + s, a[1], a[2] - s, b[0] - s, b[1], b[2] + s, .07); }
    put('dark', new THREE.CylinderGeometry(.22, .3, .9, 8), Bp[0], Bp[1] + .4, Bp[2]); EXT.flareP = [Bp[0], Bp[1] + 1.2, Bp[2]]; }
  for (const b of BLD) if (b.kind === 'quarters' || b.kind === 'gen' || b.kind === 'ctrl') { const hw = b.w / 2, hd = b.d / 2; lbox(b, 'winWarm', 0, 1.75, hd + .1, b.w * .55, .42, .03); lbox(b, 'dark', 0, 1.51, hd + .14, b.w * .58, .06, .1); for (const s of [-1, 1]) lbox(b, 'winWarm', s * (hw + .115), 1.6, -.6, .02, .46, 1.06); }
}
// rough boulder (the shore dodecahedron) and the skull rock
function extBoulder(k, x, y, z, s, a) { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(s * (1 + h2(a, 1) * .3), s * (.6 + h2(a, 2) * .3), s * (1 + h2(a, 3) * .25)); return put(k, g, x, y, z, a * 2.3, h2(a, 4) * .5, h2(a, 5) * .4); }
function extSkull(I) {
  const y = isleH(I, I.x, I.z), x = I.x, z = I.z + .5; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + .2, bx2 = I.x + Math.cos(a) * 9, bz = I.z + Math.sin(a) * 9; extBoulder('rock', bx2, isleH(I, bx2, bz) + .5, bz, .9 + h2(i, I.x) * .7, i + I.z); }
  // the skull faces the way crews arrive from (the harbour)
  const ry = Math.atan2(-(HOME.x - x), -(HOME.z - z)), c = Math.cos(ry), s = Math.sin(ry), at = (k, g, ox, oy, oz, rx = 0, rz = 0) => put(k, g, x + ox * c + oz * s, y + oy, z - ox * s + oz * c, ry, rx, rz);
  const sk = new THREE.SphereGeometry(2.3, 14, 10); sk.scale(1, .92, 1.1); at('white', sk, 0, 2.1, 0);
  const jw = new THREE.SphereGeometry(1.55, 12, 6, 0, TAU, PI * .45, PI * .55); jw.scale(1, .7, 1); at('white', jw, 0, 1.15, -.95);
  for (const q of [-1, 1]) { const e = new THREE.SphereGeometry(.66, 10, 8); e.scale(1, 1.15, .6); at('dark', e, q * .84, 2.35, -2.02); }
  at('dark', new THREE.ConeGeometry(.3, .55, 3), 0, 1.55, -2.32, -.4, PI); for (let i = -2; i <= 2; i++) at('white', new THREE.BoxGeometry(.25, .32, .2), i * .31, .8, -2.12 + Math.abs(i) * .07);
}
function extRuin(I) {
  const x = I.x - 4, z = I.z + 3, y = isleH(I, x, z), g = new THREE.CylinderGeometry(2.6, 3.2, 9, 14, 3, true), p = g.attributes.position, r = mulberry(0xe7e1 + 77 + Math.round(I.x));
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i)), j = h2(Math.round(Math.cos(a) * 50), Math.round(Math.sin(a) * 50) + I.x); if (yy > 4.4) p.setY(i, yy - (Math.round((a + PI) / TAU * 14) % 2) * .8 - j * 2.4 - (Math.cos(a - 1) > .5 ? 2.2 : 0)); else if (yy > 1) p.setY(i, yy - j * .6); }
  g.computeVertexNormals(); put('extStone', g, x, y + 4, z); put('dark', new THREE.CircleGeometry(2.55, 14), x, y + .08, z, 0, -PI / 2);
  for (let i = 0; i < 5; i++) { const a = r() * TAU, d = 3.8 + r() * 2.5; extBoulder('extStone', x + Math.cos(a) * d, isleH(I, x + Math.cos(a) * d, z + Math.sin(a) * d) + .2, z + Math.sin(a) * d, .35 + r() * .4, i + 9); }
}
// rig lamp glows (one Points, lit with the generator), the flare and the ghost wreck mist
function extPts(list, col, size, op) { const g = new THREE.BufferGeometry(), p = new Float32Array(list.length * 3), c = new Float32Array(list.length * 3), cc = new THREE.Color();
  list.forEach((q, i) => { p.set([q[0], q[1], q[2]], i * 3); cc.setHex(q[4] ?? col); c.set([cc.r, cc.g, cc.b], i * 3); }); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeBoundingSphere();
  const m = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size, vertexColors: true, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); scene.add(m); return m; }
function extGlows() {
  const rl = LAMPS.filter(s => nearRig(s[0], s[2]) && zoneOf(s[0], s[2], s[1] - 2.5) < 0).map(s => [s[0], s[1] + .05, s[2]]); if (rl.length) { EXT.rigPts = extPts(rl, 0xffe2a8, 2.6, 0); EXT.rigPts.visible = false; }
  if (EXT.flareP) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff8a30, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .7})); s.scale.setScalar(4); s.position.set(...EXT.flareP); scene.add(s); EXT.flare = s; }
  const ms = [], r = mulberry(0xe7e1 + 501); for (const W of WRECKS) if (W.ghost) for (let i = 0; i < 4; i++) ms.push([W.x + (r() - .5) * 14, .8 + r() * 1.6, W.z + (r() - .5) * 26, 0, 0x5affa0]);
  if (ms.length) { EXT.mist = extPts(ms, 0x5affa0, 16, 0); EXT.mist.userData.b = ms.map(q => [q[0], q[1], q[2]]); }
}
function extHarbour() {
  if (EXT.harb && EXT.harb.length) { EXT.harbPts = extPts(EXT.harb, 0xffc070, 1.6, .2); if (G.homeLamps) for (const q of EXT.harb) G.homeLamps.push(q); }
  if (EXT.serR) EXT.serPts = extPts(EXT.serR, 0xff2010, 2.2, .7);
}
// buoys: one InstancedMesh (drum, lattice legs, hoops, topmark, lamp), a foam collar and one Points for the blinking lamps
function extBuoyGeo() {
  const parts = [], col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }, W = [1, 1, 1];
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const add = (g, c, x, y, z, rx = 0) => { g.rotateX(rx); g.translate(x, y, z); parts.push(col(g, c)); };
  add(new THREE.CylinderGeometry(1, 1.1, 1, 14), W, 0, .1, 0); add(new THREE.CylinderGeometry(.85, 1, .16, 14), [.55, .55, .55], 0, .68, 0); add(new THREE.CylinderGeometry(1.12, 1.12, .12, 14), [.2, .2, .2], 0, -.22, 0);
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4, A = [Math.cos(a) * .7, .74, Math.sin(a) * .7], B2 = [Math.cos(a) * .26, 3.16, Math.sin(a) * .26]; d.set(B2[0] - A[0], B2[1] - A[1], B2[2] - A[2]); const g = new THREE.BoxGeometry(.07, d.length(), .07);
    q.setFromUnitVectors(up, d.normalize()); g.applyMatrix4(m.compose(p.set((A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2, (A[2] + B2[2]) / 2), q, one)); parts.push(col(g, W)); }
  for (const [y, r] of [[1.4, .58], [2.3, .41]]) add(new THREE.TorusGeometry(r, .035, 4, 14), W, 0, y, 0, PI / 2);
  add(new THREE.CylinderGeometry(.3, .3, .12, 10), W, 0, 3.2, 0); add(new THREE.CylinderGeometry(.11, .14, .32, 8), [.15, .15, .15], 0, 3.42, 0); add(new THREE.ConeGeometry(.24, .45, 8), W, 0, 3.86, 0);
  return mergeC(parts);
}
function extBuoys() {
  if (!BUOYS.length) return; const g = extBuoyGeo(), n = BUOYS.length, mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .55, metalness: .15}), c = new THREE.Color();
  const im = new THREE.InstancedMesh(g, mat, n), fm = new THREE.InstancedMesh(new THREE.RingGeometry(1.05, 1.9, 22).rotateX(-PI / 2), new THREE.MeshBasicMaterial({map: FOAM ? FOAM.userData.mat.map : null, color: 0xe8f0f0, transparent: true, opacity: .45, depthWrite: false}), n), pl = [];
  BUOYS.forEach((b, i) => { c.setHex(b.c).multiplyScalar(.8); im.setColorAt(i, c); _e.set(0, i * 1.3, 0, 'YXZ'); _m4.compose(_v.set(b.x, 0, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)); im.setMatrixAt(i, _m4); fm.setMatrixAt(i, _m4); c.setHex(b.c); b.extC = [c.r, c.g, c.b]; pl.push([b.x, 3.45, b.z, 0, b.c]); });
  im.computeBoundingSphere(); fm.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true; scene.add(im, fm);
  EXT.buoy = {im, fm, pts: extPts(pl, 0xffffff, 3, 1)};
}
function extBuoyStep() {
  const E = EXT.buoy; if (!E) return; const cp = cam.position, pa = E.pts.geometry.attributes.position, ca = E.pts.geometry.attributes.color, t = G.wt; let mu = false;
  for (let i = 0; i < BUOYS.length; i++) { const b = BUOYS[i], on = Math.sin(t * 2 + b.x) > .6 ? 1 : .08; ca.setXYZ(i, b.extC[0] * on, b.extC[1] * on, b.extC[2] * on);
    if (Math.abs(b.x - cp.x) > 400 || Math.abs(b.z - cp.z) > 400) continue;
    const y = waveH(b.x, b.z, t); _e.set(Math.sin(t * 1.1 + i) * .07, i * 1.3, Math.cos(t * .9 + i * 1.7) * .07, 'YXZ'); _m4.compose(_v.set(b.x, y, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)); E.im.setMatrixAt(i, _m4);
    EXT.tv.set(0, 3.45, 0).applyMatrix4(_m4); pa.setXYZ(i, EXT.tv.x, EXT.tv.y, EXT.tv.z); _e.set(0, i * 1.3, 0); _m4.compose(_v.set(b.x, y + .03, b.z), _q.setFromEuler(_e), _s.set(1, 1, 1)); E.fm.setMatrixAt(i, _m4); mu = true; }
  ca.needsUpdate = true; if (mu) { E.im.instanceMatrix.needsUpdate = true; E.fm.instanceMatrix.needsUpdate = true; pa.needsUpdate = true; }
}
// per frame: night emissives and glows; at about 3 Hz: island and tree visibility, tree LOD and shadow casting
function extFx(dt) {
  const n = TOD.night, t = G.wt;
  if (MAT.ghostH) MAT.ghostH.emissiveIntensity = 1.6 * n; if (MAT.winWarm) MAT.winWarm.emissiveIntensity = .1 + 1.4 * n;
  if (MAT.extPortW) MAT.extPortW.emissiveIntensity = n * (Math.sin(t * 13) * Math.sin(t * 4.1) > .3 ? .25 : 1.3);
  if (EXT.rigPts) { EXT.rigPts.visible = !!G.power; EXT.rigPts.material.opacity = G.power ? 1 : 0; }
  if (EXT.harbPts) EXT.harbPts.material.opacity = .12 + .88 * (1 - TOD.day);
  if (EXT.serPts) EXT.serPts.material.opacity = Math.sin(t * 1.3) > -.3 || Math.random() < .03 ? .75 : .08;
  if (EXT.flare) { const f = .55 + .2 * Math.sin(t * 7.3) * Math.sin(t * 3.1) + Math.random() * .1; EXT.flare.material.opacity = f; EXT.flare.scale.setScalar(3.4 + f * 1.6); }
  if (EXT.mist) { const M = EXT.mist, cp = cam.position; M.material.opacity = .05 + .3 * n; if (Math.abs(M.geometry.boundingSphere.center.x - cp.x) < 600 + M.geometry.boundingSphere.radius) { const pa = M.geometry.attributes.position, B0 = M.userData.b; for (let i = 0; i < B0.length; i++) { const q = B0[i]; pa.setXYZ(i, q[0] + Math.sin(t * .11 + i * 1.7) * 5, q[1] + Math.sin(t * .23 + i) * .4, q[2] + Math.cos(t * .09 + i * 2.3) * 6); } pa.needsUpdate = true; } }
  if ((EXT.t -= dt) > 0) return; EXT.t = .35;
  const cp = cam.position, far = G.viewFar || 1600, uw = G.uw > .5;
  for (const e of EXT.isles) { const I = e.I, d = Math.hypot(I.x - cp.x, I.z - cp.z); if (!e.pf) e.m.visible = uw ? d - I.r * 1.4 < 120 : d < far + 1.4 * I.r;
    for (const m of e.tr) { if (!e.pf) { m.visible = !uw && d < far + I.r; m.castShadow = d - I.r < 160; } const lo = d - I.r > 260; if (m.userData.lo !== lo) { m.userData.lo = lo; m.geometry = lo ? m.userData.gl : m.userData.gh; } } }
  if (EXT.home) { const d = Math.hypot(HOME.x - cp.x, HOME.z - cp.z); EXT.home.visible = uw ? d < 160 : d < far + 45; if (EXT.homeTr) { EXT.homeTr.visible = !uw && d < far; EXT.homeTr.castShadow = d < 190; } }
  if (EXT.buoy) EXT.buoy.fm.visible = !uw;
}
// the Serenade: rust-streaked topsides, round portholes (a fifth glow at night), the red lamps on the rails
function extSerHull(sh, X, Z) {
  const m = new THREE.MeshStandardMaterial({map: TX.extSerTop, color: 0xccc8be, roughness: .62, metalness: .05, side: THREE.DoubleSide});
  for (let i = 0; i < 26; i++) { const z = Z - 24 + i * 3.2; for (const sx of [-1, 1]) { const g = new THREE.CylinderGeometry(.27, .27, .08, 10); put((i * 7 + (sx > 0 ? 3 : 0)) % 5 === 0 ? 'extPortW' : 'dark', g, X + sx * 14.04, 6.4, z, 0, 0, PI / 2); put('brass', new THREE.TorusGeometry(.29, .035, 4, 12), X + sx * 14.06, 6.4, z, PI / 2); } }
  EXT.serR = [[CRZ.x, CRZ.D1 + 1.4, CRZ.z - 59.8], [CRZ.x - 12.6, CRZ.D1 + 1.4, CRZ.z + 59.4], [CRZ.x + 12.6, CRZ.D1 + 1.4, CRZ.z + 59.4]];
  return m;
}
function extLido(X, Z, D2) {
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const z = Z - 34 + i * 6; wbox('orange', X + sx * 12.9, D2 + 2.2, z, 1.3, 1.1, 4.5); wbox('white', X + sx * 12.9, D2 + 2.92, z, 1.1, .36, 4); wbox('steel', X + sx * 12.2, D2 + 2.9, z - 1.5, .15, .15, .15);
    for (const dz of [-1.7, 1.7]) { bx('steel', X + sx * 12.05 - .07, X + sx * 12.05 + .07, D2, D2 + 3.5, z + dz - .07, z + dz + .07); extBeam('steel', X + sx * 12.05, D2 + 3.45, z + dz, X + sx * 13.05, D2 + 3.6, z + dz, .12); put('dark', new THREE.CylinderGeometry(.015, .015, .9, 3), X + sx * 13.05, D2 + 3.1, z + dz); } }
  for (let i = 0; i < 10; i++) { const x = X + (i % 2 ? 7.8 : -7.8), z = Z + 12 + Math.floor(i / 2) * 4.5, ry = (i % 3) * .3 * (i % 2 ? 1 : -1), c = Math.cos(ry), s = Math.sin(ry);
    wbox('white', x, D2 + .32, z, .66, .08, 1.3, ry); const bz = .75, g = new THREE.BoxGeometry(.66, .08, .75); g.rotateX(-.95); put('white', g, x + s * -bz, D2 + .6, z + c * -bz, ry);
    for (const [lx, lz] of [[-.28, -.55], [.28, -.55], [-.28, .6], [.28, .6]]) put('steel', new THREE.CylinderGeometry(.025, .025, .3, 4), x + lx * c + lz * s, D2 + .15, z - lx * s + lz * c);
    WALLS.push({x0: x - .55, x1: x + .55, z0: z - 1.15, z1: z + .75, y0: D2, y1: D2 + .9, see: false}); }
}

// ---------------- three
const canvas = $('gl');
const RND = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
RND.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25)); RND.shadowMap.autoUpdate = false; RND.toneMapping = THREE.ACESFilmicToneMapping; RND.toneMappingExposure = 1.15;
RND.shadowMap.enabled = true; RND.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0e14); scene.fog = new THREE.FogExp2(0x0a0e14, .01);
const cam = new THREE.PerspectiveCamera(70, 1, .05, 1600); scene.add(cam);
function resize() { RND.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const hemi = new THREE.HemisphereLight(0x4a5a78, 0x0a0c10, .5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9aaccc, .5); scene.add(moon, moon.target);
moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, {left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400}); moon.shadow.bias = -.0005; moon.shadow.normalBias = .05;
const MOONDIR = new THREE.Vector3(-.4, .55, .7).normalize(), SUNDIR = new THREE.Vector3(0, .2, 1), KEYDIR = new THREE.Vector3(0, 1, 0);
// time of day: 0 golden hour, .16 sunset, .26 dusk, .36-.72 night, .82 dawn, .9 sunrise, 1 = golden hour again (16 minute loop)
const TODK = [
  [0, 14, 235, 0x3d66aa, 0xe8a07a, 0x9a8a92, .0011, 0xffc48a, 2.8, 0x8aa0c8, 0x3a3028, .85, 0],
  [.16, 2.5, 252, 0x23397a, 0xff5a24, 0xb8705a, .0013, 0xff7a40, 2.2, 0x6a74a8, 0x3a2420, .7, 0],
  [.26, -5, 262, 0x0d1236, 0x7a3048, 0x2a1e2c, .0022, 0xc06070, .5, 0x3a4878, 0x181418, .55, .45],
  [.36, -24, 300, 0x020309, 0x0c121e, 0x06090f, .0048, 0x9aaccc, .55, 0x4a5a78, 0x0a0c10, .5, 1],
  [.72, -24, 400, 0x020309, 0x0c121e, 0x06090f, .0048, 0x9aaccc, .55, 0x4a5a78, 0x0a0c10, .5, 1],
  [.82, -5, 440, 0x18224c, 0xa86680, 0x38303e, .0022, 0xd08080, .5, 0x3a4878, 0x181418, .55, .45],
  [.9, 3.5, 455, 0x3a5aa0, 0xffa070, 0x9a8890, .0014, 0xffa060, 2.2, 0x7a88b8, 0x3a2a22, .7, 0],
  [1, 14, 595, 0x3d66aa, 0xe8a07a, 0x9a8a92, .0011, 0xffc48a, 2.8, 0x8aa0c8, 0x3a3028, .85, 0]];
const _ca = new THREE.Color(), _cb = new THREE.Color();
const TOD = {zen: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), el: 0, az: 0, fd: 0, sI: 0, hI: 0, st: 0, day: 1, night: 0};
function todAt(t, storm) {
  t = ((t % 1) + 1) % 1; let i = 0; while (TODK[i + 1][0] < t) i++;
  const a = TODK[i], b = TODK[i + 1], u = (t - a[0]) / (b[0] - a[0]), k = u * u * (3 - 2 * u), L = (x, y) => x + (y - x) * k;
  const C = (o, j) => o.copy(_ca.setHex(a[j])).lerp(_cb.setHex(b[j]), k);
  TOD.el = L(a[1], b[1]); TOD.az = L(a[2], b[2]); C(TOD.zen, 3); C(TOD.hor, 4); C(TOD.fog, 5); TOD.fd = L(a[6], b[6]); C(TOD.sun, 7); TOD.sI = L(a[8], b[8]); C(TOD.hs, 9); C(TOD.hg, 10); TOD.hI = L(a[11], b[11]); TOD.st = L(a[12], b[12]);
  const e = TOD.el * PI / 180, z = TOD.az * PI / 180; SUNDIR.set(Math.sin(z) * Math.cos(e), Math.sin(e), Math.cos(z) * Math.cos(e));
  MOONDIR.set(-SUNDIR.x * .8, Math.max(.3, -SUNDIR.y * .9 + .12), -SUNDIR.z * .8).normalize();
  TOD.day = clamp((TOD.el + 8) / 16, 0, 1); TOD.night = 1 - clamp((TOD.el + 22) / 18, 0, 1);
  if (storm > 0) {
    _ca.setRGB(.028, .04, .06).lerp(_cb.setRGB(.13, .15, .17), TOD.day); TOD.fog.lerp(_ca, storm); TOD.hor.lerp(_ca, storm * .9); TOD.zen.lerp(_cb.copy(_ca).multiplyScalar(.6), storm * .9);
    TOD.fd = mix(TOD.fd, mix(.02, .011, TOD.day), storm); TOD.sI *= 1 - .78 * storm; TOD.st *= 1 - storm; TOD.sun.lerp(_ca.setRGB(.7, .75, .8), storm * .6); TOD.hI *= 1 - .2 * storm;
  }
  // key light: the sun while it is up, the moon after dark; it fades through zero where they swap so the shadows never jump
  if (TOD.el > -3) { KEYDIR.copy(SUNDIR); KEYDIR.y = Math.max(KEYDIR.y, .06); KEYDIR.normalize(); TOD.kI = TOD.sI * clamp((TOD.el + 3) / 4, 0, 1); }
  else { KEYDIR.copy(MOONDIR); TOD.kI = TOD.sI * clamp((-3 - TOD.el) / 5, 0, 1); }
  return TOD;
}
const flash = new THREE.SpotLight(0xffeccc, 0, 45, .44, .6, 1.4); flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = .25; flash.shadow.camera.far = 45; flash.shadow.bias = -.0004; flash.shadow.normalBias = .03; scene.add(flash, flash.target);
const RSPOT = [0, 1].map(() => { const l = new THREE.SpotLight(0xffeccc, 0, 38, .44, .6, 1.4); scene.add(l, l.target); return l; });
const POOL = [0, 1].map(() => { const l = new THREE.PointLight(0xffe2b0, 0, 30, 1.4); scene.add(l); return l; });
const FLL = [0, 1].map(() => { const l = new THREE.PointLight(0xff2a14, 0, 22, 1.4); scene.add(l); return l; });
const boatL = new THREE.SpotLight(0xf4f8ff, 0, 90, .3, .5, 1.1); scene.add(boatL, boatL.target);
const lhL = new THREE.SpotLight(0xfff6dc, 0, 700, .09, .6, .35); scene.add(lhL, lhL.target);

function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, rep = 1) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function noiseFill(g, w, h, n) { const im = g.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - .5) * n; d[i] += r; d[i + 1] += r; d[i + 2] += r * .8; } g.putImageData(im, 0, 0); }
const TX = {}, MAT = {};
function rust(g, w, h, n) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${90 + Math.random() * 50},${40 + Math.random() * 20},${15},${Math.random() * .25})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 18, 0, TAU); g.fill(); } for (let i = 0; i < n / 2; i++) { g.fillStyle = `rgba(60,30,10,${Math.random() * .3})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 10 + Math.random() * 40); } }
function textures() {
  TX.grate = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#2a2c2c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#5a5c58'; g.lineWidth = 3; for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } g.lineWidth = 1.5; for (let i = 0; i <= h; i += 8) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } rust(g, w, h, 30); noiseFill(g, w, h, 20); }));
  TX.plate = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a5254'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2e30'; g.lineWidth = 2; for (let i = 0; i < w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } for (let i = 0; i < h; i += 128) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } g.fillStyle = '#2a2e30'; for (let x = 6; x < w; x += 64) for (let y = 6; y < h; y += 20) g.fillRect(x, y, 3, 3); rust(g, w, h, 80); noiseFill(g, w, h, 20); }));
  TX.wood = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = `rgba(0,0,0,${.1 + Math.random() * .2})`; g.fillRect(x, 0, 3, h); } noiseFill(g, w, h, 30); }));
  TX.planks = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#5a4634'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) { g.fillStyle = `rgba(0,0,0,${.15 + Math.random() * .2})`; g.fillRect(0, y, w, 2); for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(20,30,20,${Math.random() * .15})`; g.beginPath(); g.arc(Math.random() * w, y + Math.random() * 32, 3 + Math.random() * 10, 0, TAU); g.fill(); } } noiseFill(g, w, h, 30); }));
  TX.hazard = tex(cv(64, 64, (g, w, h) => { g.fillStyle = '#d8a820'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = -64; i < 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); } noiseFill(g, w, h, 30); }));
  TX.cont = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#6a2418'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.cont2 = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#1e4a6a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); } rust(g, w, h, 60); noiseFill(g, w, h, 20); }));
  TX.rock = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#3c3a36'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '10,10,10' : '100,98,90'},${Math.random() * .2})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 0, TAU); g.fill(); } noiseFill(g, w, h, 30); }), 3);
  TX.rustH = tex(cv(256, 256, (g, w, h) => { g.fillStyle = '#3a2c22'; g.fillRect(0, 0, w, h); rust(g, w, h, 200); noiseFill(g, w, h, 30); }), 2);
  TX.screen = tex(cv(128, 64, (g, w, h) => { g.fillStyle = '#04100a'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a8a50'; for (let y = 6; y < h; y += 7) g.fillRect(6, y, 20 + Math.random() * 90, 2); }));
  TX.paper = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#d6ccb0'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4030'; for (let y = 14; y < h - 10; y += 9) g.fillRect(12, y, 70 + Math.random() * 30, 2); noiseFill(g, w, h, 20); }));
  TX.board = tex(cv(256, 128, (g, w, h) => { g.fillStyle = '#2a2018'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c8a0'; g.font = 'bold 26px Georgia'; g.textAlign = 'center'; g.fillText('SALVAGE BOUGHT', w / 2, 44); g.font = '17px Georgia'; g.fillText('repairs · fuel · upgrades', w / 2, 76); g.fillText('ask inside', w / 2, 104); noiseFill(g, w, h, 30); }));
  TX.glow = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  TX.ripple = new THREE.CanvasTexture(cv(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 2 + Math.random() * 4, Math.random() * .4, 0, TAU); g.fill(); } }));
  TX.ripple.wrapS = TX.ripple.wrapT = THREE.RepeatWrapping; TX.ripple.repeat.set(60, 60);
}
const WAVES = [[.42, 34, .8, .3, .95], [.3, 22, 1.1, -.6, .8], [.2, 15, 1.5, .9, .4], [.12, 9, 2.0, -.2, -1]];
function waveH(x, z, t) { let h = 0; for (const [a, l, s, dx, dz] of WAVES) { const k = TAU / l, n = Math.hypot(dx, dz); h += a * Math.sin(k * (x * dx + z * dz) / n + t * s); } return h * G.sea; }
function materials() {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .8, metalness: .2}, o));
  MAT.grate = S({map: TX.grate, metalness: .5, roughness: .6}); MAT.plate = S({map: TX.plate, metalness: .5, roughness: .55, side: THREE.DoubleSide}); MAT.steel = S({color: 0x5a5e60, metalness: .6, roughness: .5});
  MAT.leg = S({map: TX.plate, color: 0xb0a080, metalness: .5}); MAT.yellow = S({color: 0xc8a020, roughness: .6}); MAT.wood = S({map: TX.wood}); MAT.hazard = S({map: TX.hazard}); MAT.planks = S({map: TX.planks, metalness: 0, side: THREE.DoubleSide}); MAT.roofW = S({map: TX.planks, color: 0x6a6a6a, metalness: 0});
  MAT.door = S({color: 0x3a4a4a, metalness: .5}); MAT.floorP = S({map: TX.grate, color: 0x9a9a9a}); MAT.glass = S({color: 0x0a1014, roughness: .1, metalness: .4}); MAT.dark = S({color: 0x0b0b0b});
  MAT.fabric = S({color: 0x3a4048, metalness: 0}); MAT.locker = S({color: 0x4a5a5a, metalness: .6, roughness: .45}); MAT.genM = S({color: 0x2a4a3a, metalness: .5}); MAT.panel = S({color: 0x3a3e40, metalness: .5});
  MAT.screen = S({map: TX.screen, emissive: 0x2a8a50, emissiveMap: TX.screen, emissiveIntensity: 0}); MAT.red = S({color: 0x9a1a14}); MAT.pipe = S({color: 0x6a5a40, metalness: .5}); MAT.crate = S({map: TX.wood, color: 0x9a8a6a});
  MAT.cont = S({map: TX.cont}); MAT.cont2 = S({map: TX.cont2}); MAT.orange = S({color: 0xd05a10}); MAT.bulb = S({color: 0x222018, emissive: 0xfff0c0, emissiveIntensity: 0});
  MAT.rock = S({map: TX.rock, metalness: 0, roughness: .95}); MAT.white = S({color: 0xc8c4b8, metalness: 0}); MAT.log = S({color: 0x2a2018, metalness: 0}); MAT.glassL = S({color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.5});
  MAT.rustH = S({map: TX.rustH, metalness: .4, side: THREE.DoubleSide}); MAT.ghostH = S({map: TX.rustH, color: 0x8a9a9a, metalness: .2, emissive: 0x0a2a20, side: THREE.DoubleSide}); MAT.rustR = S({color: 0x5a3a24, metalness: .4}); MAT.paper = S({map: TX.board, metalness: 0});
  TX.carpet = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#5a1418'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a6a2a'; g.lineWidth = 2; for (let i = 0; i < w; i += 32) for (let j = 0; j < h; j += 32) { g.beginPath(); g.arc(i + 16, j + 16, 9, 0, TAU); g.stroke(); } for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(20,10,5,${.15 + Math.random() * .3})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 20, 0, TAU); g.fill(); } noiseFill(g, w, h, 18); }), 1);
  TX.wallp = tex(cv(128, 128, (g, w, h) => { g.fillStyle = '#2a3a30'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a4a3a'; for (let i = 0; i < w; i += 22) for (let j = 0; j < h; j += 30) { g.beginPath(); g.ellipse(i + 11, j + 15, 5, 11, 0, 0, TAU); g.fill(); } const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,30,10,.5)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 16); }), 1);
  MAT.carpet = new THREE.MeshStandardMaterial({map: TX.carpet, roughness: .95}); MAT.wallp = new THREE.MeshStandardMaterial({map: TX.wallp, roughness: .85}); MAT.brass = new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3});
  MAT.sea = new THREE.MeshStandardMaterial({color: 0x031820, roughness: .07, metalness: 0, bumpMap: TX.ripple, bumpScale: .5, envMapIntensity: .9, side: THREE.DoubleSide});
  // uniforms that outlive a recompile: shore distances (SHORE), the 8 nearest islands, boat speed, the colours seen from under the surface
  MAT.sea.userData.U = {uShore: {value: null}, uIs: {value: [...Array(8)].map(() => new THREE.Vector4())}, uSpd: {value: 0}, uUs: {value: new THREE.Vector4()}, uUd: {value: new THREE.Color()}};
  MAT.sea.onBeforeCompile = sh => {
    sh.uniforms.uT = {value: 0}; sh.uniforms.uA = {value: 1}; sh.uniforms.uBt = {value: new THREE.Vector4()}; sh.uniforms.uBd = {value: new THREE.Vector4()}; MAT.sea.userData.sh = sh;
    const U = MAT.sea.userData.U; U.uShore.value = SHORE; Object.assign(sh.uniforms, U); const NI = (ISLES.length + 1).toFixed(1);
    const W = WAVES.map(([a, l, s, dx, dz]) => { const n = Math.hypot(dx, dz), k = (TAU / l).toFixed(4), d = `vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})`; return `{ float ph = ${k} * dot(p, ${d}) + uT * ${s.toFixed(2)}; w += vec3(${a.toFixed(3)} * sin(ph), ${(a * TAU / l * dx / n).toFixed(4)} * cos(ph), ${(a * TAU / l * dz / n).toFixed(4)} * cos(ph)); }`; }).join('\n');
    sh.vertexShader = 'uniform float uT; uniform float uA;\nvec3 seaW(vec2 p){ vec3 w = vec3(0.);\n' + W + '\n return w * uA; }\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 wpN = (modelMatrix * vec4(position, 1.)).xyz; vec3 sw = seaW(wpN.xz); vec3 objectNormal = normalize(vec3(-sw.y, 1., -sw.z));')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += sw.x; vWH = sw.x; vWP = wpN;');
    sh.vertexShader = 'varying float vWH; varying vec3 vWP;\n' + sh.vertexShader; sh.uniforms.uFoam = {value: .3};
    // ripples: a second, larger sample turned 30 degrees breaks the tiling; both fade out with distance (no moire, no glitter column)
    const bump = THREE.ShaderChunk.bumpmap_pars_fragment.replace('vec2 dHdxy_fwd() {', 'float ripH(vec2 u) { return texture2D(bumpMap, u).x * .75 + texture2D(bumpMap, mat2(.866, .5, -.5, .866) * u * .37 + vec2(.29, .61)).x * .55; }\n\tvec2 dHdxy_fwd() { float bS = bumpScale * (1. - smoothstep(60., 500., length(vWP.xz - cameraPosition.xz)));')
      .replace(/bumpScale \* texture2D\( bumpMap, ([^)]*) \)\.x/g, 'bS * ripH( $1 )');
    sh.fragmentShader = 'uniform float uT; uniform float uA; uniform float uFoam; uniform vec4 uBt, uBd; varying float vWH; varying vec3 vWP;\nuniform sampler2D uShore; uniform vec4 uIs[8]; uniform float uSpd; uniform vec4 uUs; uniform vec3 uUd;\n' + sh.fragmentShader
      .replace('#include <bumpmap_pars_fragment>', bump)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float hf = 0., dc = length(vWP.xz - cameraPosition.xz);
        if (uBd.w > .5) { vec2 bd = vWP.xz - uBt.xy; float lx = bd.x * uBt.z - bd.y * uBt.w, lz = bd.x * uBt.w + bd.y * uBt.z, tt = clamp((lz - uBd.y) / (uBd.z - uBd.y), 0., 1.), ww = uBd.x * (tt < .45 ? pow(sin(tt / .45 * 1.5708), .75) : 1.) - .12; if (uBd.w > 1.5) { float zc = clamp(lz, uBd.y + uBd.x, uBd.z - uBd.x), ez = lz - zc; ww = sqrt(max(uBd.x * uBd.x - ez * ez, 0.)) - .05; if (abs(lx) < ww) discard; } else if (lz > uBd.y + .4 && lz < uBd.z - .08 && abs(lx) < ww) discard;
          float ax = abs(lx) - max(ww, 0.); hf = (1. - smoothstep(0., .5 + uSpd * .7, ax)) * step(uBd.y - 1., lz) * (1. - smoothstep(uBd.z - 1.5, uBd.z + 1., lz)) * (.2 + .6 * uSpd) + uSpd * (1. - smoothstep(0., 1.2 + uSpd * 1.4, ax)) * (1. - smoothstep(0., 2.5 + uBd.x * .8, abs(lz - uBd.y - 1.5))); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cr = clamp(vWH / max(uA, .3), -1., 1.5); diffuseColor.rgb *= 1. + smoothstep(.1, .9, cr) * vec3(.6, 1.1, 1.0);
        float fn = sin(vWP.x * .9 + vWP.z * 1.3 + uT * .7) * sin(vWP.z * .7 - vWP.x * .4 - uT * .5) * .5 + .5;
        float fo = smoothstep(.62, 1.05, cr + fn * .35) * uFoam, shl = 0.;
        for (int i = 0; i < 8; i++) { vec4 I = uIs[i]; vec2 d2 = vWP.xz - I.xy; if (I.w < .5 || dot(d2, d2) > 52900.) continue;
          float a = atan(d2.y, d2.x), r0 = textureLod(uShore, vec2(a / 6.2832 + .5, (I.z + .5) / ${NI}), 0.).r, d = length(d2) - r0;
          shl = max(shl, 1. - smoothstep(0., 28., d)); fo += (1. - smoothstep(0., 3., abs(d - 1. - sin(uT * 1.2 + a * 17.) * .7))) * (.4 + .6 * fn); }
        fo = clamp(fo + hf * (.3 + .7 * fn * (sin(vWP.x * 3.1 + uT * 2.3) * sin(vWP.z * 2.7 - uT * 1.9) * .5 + .5)), 0., 1.); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.03, .2, .19), shl * .8); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62, .68, .7), fo);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .28, smoothstep(40., 600., dc)); roughnessFactor = mix(roughnessFactor, .85, fo);')
      // from below: a bright Snell's window straight up, the dark reflected deep around it
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n vec3 uwC = vec3(0.); if (uUs.w > .5 && !gl_FrontFacing) { vec3 vd = normalize(vWP - cameraPosition); float sw = .06 + max(0., -cameraPosition.y) * .005; uwC = mix(uUd, uUs.rgb * (.9 + .22 * cr), smoothstep(.66 - sw, .66 + sw, vd.y + cr * .05)) + vec3(.6, .68, .7) * fo * .15 * uUs.rgb; }')
      // the surface seen from below glows through more water than the fog allows sideways, so looking up is brighter than looking out
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        if (uUs.w > .5 && !gl_FrontFacing) { vec4 uc = linearToOutputTexel(vec4(uwC, 1.)); // untonemapped, like the fog it fades into
          #ifdef USE_FOG
          uc.rgb = mix(uc.rgb, fogColor, 1. - exp(-length(vWP - cameraPosition) * .02));
          #endif
          gl_FragColor.rgb = uc.rgb; }`);
  };
}
function mergeGeos(list) {
  let n = 0; const qs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0; for (const q of qs) { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); if (q.attributes.uv) uv.set(q.attributes.uv.array, o * 2); o += c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeBoundingSphere(); return g;
}
// [geometry already in the parent's space, material, casts shadow] -> one mesh per material (and shadow flag)
function mergeByMat(list) { const by = new Map(); for (const [geo, mat, cs] of list) { const k = mat.uuid + (cs ? '+' : '-'); if (!by.has(k)) by.set(k, {mat, cs, gs: []}); by.get(k).gs.push(geo); }
  return [...by.values()].map(e => { const m = new THREE.Mesh(mergeGeos(e.gs), e.mat); e.gs.forEach(q => q.dispose()); m.castShadow = !!e.cs; m.receiveShadow = true; return m; }); }
const MATC = {}; let SHORE = null, SNOW = null;
let SEA = null, RAIN = null, SEABED = null;
function seabedAt(cx, cz) { cx = Math.round(cx / 10) * 10; cz = Math.round(cz / 10) * 10; SEABED.userData.cx = cx; SEABED.userData.cz = cz; const p = SEABED.geometry.attributes.position, b = SEABED.userData.base; for (let i = 0; i < p.count; i++) { const x = b[i * 2] + cx, z = b[i * 2 + 1] + cz; p.setXYZ(i, x, seaBed(x, z), z); } p.needsUpdate = true; SEABED.geometry.computeVertexNormals(); SEABED.geometry.computeBoundingSphere(); }
function buildSea() {
  const g = new THREE.PlaneGeometry(1500, 1500, 250, 250); g.rotateX(-PI / 2);
  { const sg = new THREE.PlaneGeometry(420, 420, 60, 60); sg.rotateX(-PI / 2); const base = new Float32Array(sg.attributes.position.count * 2); for (let i = 0; i < sg.attributes.position.count; i++) { base[i * 2] = sg.attributes.position.getX(i); base[i * 2 + 1] = sg.attributes.position.getZ(i); }
    const sbm = new THREE.MeshStandardMaterial({map: TX.rock, color: 0x8a8068, roughness: 1});
    sbm.onBeforeCompile = sh => { sh.uniforms.uT = {value: 0}; sh.uniforms.uC = {value: 1}; sbm.userData.sh = sh;
      sh.vertexShader = 'varying vec3 vWq;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWq = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = 'uniform float uT, uC; varying vec3 vWq;\nfloat cau(vec2 p, float t){ vec2 i = p; float c = 1.; for (int k = 0; k < 4; k++) { float tt = t * (1. - 3.5 / float(k + 1)); i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)); c += 1. / length(vec2(p.x / (sin(i.x + tt) / .005), p.y / (cos(i.y + tt) / .005))); } c /= 4.; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.); }\n' + sh.fragmentShader
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(.7, 1., .95) * clamp(cau(mod(vWq.xz * .12, 6.2831), uT * .5), 0., 1.) * uC * exp(vWq.y / 45.) * 2.4;'); };
    SEABED = new THREE.Mesh(sg, sbm); SEABED.userData.base = base; SEABED.userData.cx = 1e9; SEABED.frustumCulled = false; SEABED.visible = false; scene.add(SEABED); }
  SEA = new THREE.Mesh(g, MAT.sea); SEA.receiveShadow = true; SEA.frustumCulled = false; scene.add(SEA);
  const n = 2600, p = new Float32Array(n * 6); for (let i = 0; i < n; i++) { const x = (Math.random() - .5) * 50, y = Math.random() * 30, z = (Math.random() - .5) * 50; p.set([x, y, z, x + .15, y + .7, z + .05], i * 6); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  RAIN = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({color: 0x9aa8b8, transparent: true, opacity: 0, depthWrite: false})); RAIN.frustumCulled = false; RAIN.visible = false;
  { const N = 7000, base = new THREE.PlaneGeometry(1, 1), g2 = new THREE.InstancedBufferGeometry(); g2.index = base.index; g2.setAttribute('position', base.attributes.position); g2.setAttribute('uv', base.attributes.uv);
    const off = new Float32Array(N * 4); for (let i = 0; i < off.length; i++) off[i] = Math.random(); g2.setAttribute('off', new THREE.InstancedBufferAttribute(off, 4)); g2.instanceCount = N;
    G.rainM = new THREE.ShaderMaterial({transparent: true, depthWrite: false, uniforms: {uT: {value: 0}, uI: {value: 0}, uC: {value: new THREE.Vector3()}, uW: {value: new THREE.Vector2(4, 1.5)}, uCol: {value: new THREE.Color(.6, .65, .7)}},
      vertexShader: `attribute vec4 off; uniform float uT, uI; uniform vec3 uC; uniform vec2 uW; varying float vA; varying vec2 vU;
        void main(){ float S = 46., H = 28., sp = 17. + off.w * 9.; vec3 p; p.x = uC.x + mod(off.x * S + uW.x * uT - uC.x, S) - S * .5; p.z = uC.z + mod(off.z * S + uW.y * uT - uC.z, S) - S * .5; p.y = uC.y + mod(off.y * H - sp * uT - uC.y, H) - H * .4;
          vec3 dir = normalize(vec3(uW.x, -sp, uW.y)), toC = normalize(uC - p), sd = normalize(cross(dir, toC)); float len = .45 + off.w * .75, wid = .008 + off.w * .008;
          vec3 wp = p + sd * position.x * wid + dir * position.y * len; float d = distance(p, uC);
          vA = step(fract(off.x * 13.7 + off.z * 7.3), uI) * smoothstep(.8, 2.5, d) * (1. - smoothstep(12., 22., d)); vU = uv; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.); }`,
      fragmentShader: 'uniform vec3 uCol; varying float vA; varying vec2 vU; void main(){ float a = vA * (1. - abs(vU.x - .5) * 2.) * smoothstep(0., .4, vU.y) * smoothstep(1., .6, vU.y) * .45; if (a < .003) discard; gl_FragColor = vec4(uCol, a); }'});
    G.rain2 = new THREE.Mesh(g2, G.rainM); G.rain2.frustumCulled = false; G.rain2.renderOrder = 4; scene.add(G.rain2);
    const NS = 500, sb = new THREE.PlaneGeometry(1, 1), g3 = new THREE.InstancedBufferGeometry(); g3.index = sb.index; g3.setAttribute('position', sb.attributes.position); g3.setAttribute('uv', sb.attributes.uv);
    const o3 = new Float32Array(NS * 3); for (let i = 0; i < o3.length; i++) o3[i] = Math.random(); g3.setAttribute('off', new THREE.InstancedBufferAttribute(o3, 3)); g3.instanceCount = NS;
    const W = WAVES.map(([a, l, s2, dx, dz]) => { const n = Math.hypot(dx, dz), k = (TAU / l).toFixed(4); return `h += ${a.toFixed(3)} * sin(${k} * dot(q, vec2(${(dx / n).toFixed(3)}, ${(dz / n).toFixed(3)})) + uT * ${s2.toFixed(2)});`; }).join(' ');
    G.splM = new THREE.ShaderMaterial({transparent: true, depthWrite: false, uniforms: {uT: {value: 0}, uI: {value: 0}, uA: {value: 1}, uC: {value: new THREE.Vector3()}, uCol: {value: new THREE.Color(.7, .75, .8)}},
      vertexShader: `attribute vec3 off; uniform float uT, uI, uA; uniform vec3 uC; varying float vA; varying vec2 vU;
        void main(){ float S = 34., ph = fract(off.z + uT * 1.7); vec2 c = vec2(off.x * S, off.y * S) + floor((uT * 1.7 + off.z)) * vec2(7.31, 3.17); c = uC.xz + mod(c - uC.xz, S) - S * .5; vec2 q = c; float h = 0.; ${W} h *= uA;
          float r = .06 + ph * .42; vec3 wp = vec3(c.x + position.x * r * 2., h + .03, c.y - position.y * r * 2.); vA = step(off.x * .7 + off.y * .3, uI) * (1. - ph) * (1. - smoothstep(10., 17., distance(wp, uC)));
          vU = uv; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.); }`,
      fragmentShader: 'uniform vec3 uCol; varying float vA; varying vec2 vU; void main(){ float r = length(vU - .5) * 2.; float a = vA * smoothstep(.62, .85, r) * (1. - smoothstep(.85, 1., r)) * .5; if (a < .003) discard; gl_FragColor = vec4(uCol, a); }'});
    G.spl = new THREE.Mesh(g3, G.splM); G.spl.frustumCulled = false; G.spl.renderOrder = 4; scene.add(G.spl);
    // marine snow: specks drifting in a 24 m box that wraps around the camera underwater
    const NN = 1200, s4 = new THREE.PlaneGeometry(1, 1), g4 = new THREE.InstancedBufferGeometry(); g4.index = s4.index; g4.setAttribute('position', s4.attributes.position); g4.setAttribute('uv', s4.attributes.uv);
    const o4 = new Float32Array(NN * 4); for (let i = 0; i < o4.length; i++) o4[i] = Math.random(); g4.setAttribute('off', new THREE.InstancedBufferAttribute(o4, 4)); g4.instanceCount = NN;
    SNOW = new THREE.Mesh(g4, new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {uT: {value: 0}, uC: {value: new THREE.Vector3()}, uCol: {value: new THREE.Color(.3, .4, .4)}},
      vertexShader: `attribute vec4 off; uniform float uT; uniform vec3 uC; varying float vA; varying vec2 vU;
        void main(){ float S = 24., w = off.w * 6.2832; vec3 p = off.xyz * S + vec3(sin(uT * .21 + w) * .5 + uT * .05, -uT * (.04 + off.w * .07) + sin(uT * .5 + w * 3.) * .12, cos(uT * .17 + w) * .5);
          p = uC + mod(p - uC, S) - S * .5; vec4 mv = viewMatrix * vec4(p, 1.); mv.xy += position.xy * (.025 + off.w * .04); float d = -mv.z;
          vA = smoothstep(.15, .6, d) * (1. - smoothstep(5., 12., d)) * (.45 + .55 * fract(off.x * 17.3)); vU = uv; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: 'uniform vec3 uCol; varying float vA; varying vec2 vU; void main(){ float a = vA * (1. - smoothstep(.2, 1., length(vU - .5) * 2.)); if (a < .004) discard; gl_FragColor = vec4(uCol, a); }'}));
    SNOW.frustumCulled = false; SNOW.visible = false; SNOW.renderOrder = 5; scene.add(SNOW); }
  const U = {uw: {value: 0}, uwk: {value: 0}, deepC: {value: new THREE.Color()}, surfC: {value: new THREE.Color()}, aur: {value: 0}, zen: {value: new THREE.Color()}, hor: {value: new THREE.Color()}, fogC: {value: new THREE.Color()}, sunC: {value: new THREE.Color()}, sunD: {value: SUNDIR}, moonD: {value: MOONDIR}, sunI: {value: 1}, uS: {value: 0}, uF: {value: 0}, stars: {value: 0}, uT: {value: 0}};
  const skyM = new THREE.ShaderMaterial({side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w * .999999; }',
    fragmentShader: `varying vec3 vD; uniform vec3 zen, hor, fogC, sunC, sunD, moonD, deepC, surfC; uniform float sunI, uS, uF, stars, uT, aur, uw, uwk;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); } float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
      void main(){ vec3 d = normalize(vD); float y = d.y, yy = max(y, 0.);
        if (uw > .5) { gl_FragColor = vec4(mix(deepC, surfC, smoothstep(-.4, .95, y)) + vec3(.25, .45, .45) * pow(yy, 10.) * uwk, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return; }
        vec3 col = mix(hor * mix(.62, 1., pow(max(dot(normalize(d.xz + 1e-4), normalize(sunD.xz + 1e-4)), 0.) * .5 + .5, 1.5)), zen, pow(yy, .48));
        float sd = max(dot(d, sunD), 0.), up = smoothstep(-.06, .02, sunD.y), ab = smoothstep(-.05, .03, y);
        col += sunC * (pow(sd, 14.) * .3 + pow(sd, 120.) * .9) * sunI * .4 * ab * (1. - uS * .7);
        col += sunC * exp(-yy * 9.) * pow(sd, 2.5) * sunI * .22 * ab * (1. - uS * .8);
        col += sunC * smoothstep(.99988, .99994, sd) * mix(4., 22., smoothstep(0., .25, sunD.y)) * up * ab * (1. - uS);
        vec2 uv = d.xz / (yy + .1) * .9 + uT * vec2(.006, .002); float c = fbm(uv), c2 = fbm(uv * 2.6 + 4.);
        float cov = mix(.47, .28, uS), cl = smoothstep(cov, cov + .2, c * .75 + c2 * .25) * smoothstep(0., .08, yy);
        vec3 cc = mix(zen * .7, hor * 1.15, .35 + .65 * pow(1. - yy, 3.)) * (.75 + .5 * (1. - c2));
        cc += sunC * (pow(sd, 3.) * .9 + .15) * sunI * .22 * (1. - smoothstep(.45, .8, c)) * (1. - uS);
        cc = mix(cc, fogC * (.65 + .5 * c2), uS * .85);
        col = mix(col, cc, cl * .92);
        vec3 sp = d * 260.; vec3 id = floor(sp); float r = h3(id); float s = step(.986, r) * smoothstep(.34, .06, length(fract(sp) - .5));
        col += vec3(.8, .86, 1.) * s * stars * (1. - cl) * smoothstep(.0, .15, y) * (.55 + .45 * sin(uT * 2.3 + r * 90.)) * 1.6;
        float md = dot(d, moonD); float mdisc = smoothstep(.99935, .99955, md);
        col = mix(col, vec3(.9, .93, 1.) * 1.8, mdisc * stars * (1. - uS * .9) * (1. - cl * .8)); col += vec3(.06, .08, .13) * pow(max(md, 0.), 30.) * stars;
        if (aur > .01 && y > .02) { vec3 ac = vec3(0.);
          for (int i = 0; i < 22; i++) { float fi = float(i) / 22., h = .9 + fi * 1.6; vec2 p = d.xz * (h / y) * .35 + vec2(uT * .004, 0.);
            float w = p.y + sin(p.x * .7 + uT * .03) * .9 + (n(vec2(p.x * .9, uT * .02)) - .5) * 1.6, band = exp(-w * w * 6.) + exp(-(w - 2.2) * (w - 2.2) * 9.) * .6;
            float rays = .35 + .65 * n(vec2(p.x * 14. + uT * .05, fi * 2.)); ac += mix(vec3(.05, 1., .35), vec3(.75, .15, .9), smoothstep(.25, 1., fi)) * band * rays * (1. - fi) * (1. - fi); }
          col += ac * .07 * aur * smoothstep(.02, .2, y) * (1. - cl * .8); }
        col = mix(col, fogC, smoothstep(.03, -.015, y));
        col += uF * vec3(.5, .55, .7) * (.4 + c);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), skyM); sky.frustumCulled = false; sky.renderOrder = 1000; scene.add(sky); scene.userData.sky = sky;
  ENV.scene = new THREE.Scene(); ENV.scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), skyM)); ENV.pm = new THREE.PMREMGenerator(RND);
  buildFoam(); buildBirds();
}
const ENV = {scene: null, pm: null, rt: null, t: 0, key: ''};
function envUpdate(dt, force) {
  if (!ENV.pm) return; ENV.t -= dt; const key = (G.tod || 0).toFixed(3) + '|' + G.storm.toFixed(2), uw = (G.uw || 0) > .5 ? 1 : 0; if (uw !== (ENV.uw || 0)) { ENV.uw = uw; force = true; }
  if (!force && (ENV.t > 0 || key === ENV.key) && Math.abs((G.tod || 0) - (ENV.td || 0)) < .01) return; ENV.td = G.tod || 0; ENV.t = 6; ENV.key = key;
  const rt = ENV.pm.fromScene(ENV.scene, 0, .1, 100); scene.environment = rt.texture; if (ENV.rt) ENV.rt.dispose(); ENV.rt = rt;
}
let FOAM = null, BIRDS = null;
function buildFoam() {
  // shoreline radius per island and angle (128 angles, marched in from the sea): the sea shader reads it for the shallows and the moving foam band
  const t = tex(cv(256, 32, (g, w, h) => { for (let i = 0; i < 900; i++) { const x = Math.random() * w, y = Math.pow(Math.random(), 1.6) * h; g.fillStyle = `rgba(255,255,255,${.25 + Math.random() * .5})`; g.beginPath(); g.arc(x, y, .6 + Math.random() * 1.8, 0, TAU); g.fill(); } }), 1);
  t.repeat.set(1, 1); FOAM = new THREE.Group(); scene.add(FOAM);
  const mat = new THREE.MeshBasicMaterial({map: t, transparent: true, opacity: .5, depthWrite: false, color: 0xe8f0f0});
  const SL = FOAM.userData.isles = ISLES.concat([{x: HOME.x, z: HOME.z, r: HOME.r, home: 1}]), NA = 128, NI = SL.length, data = new Uint16Array(NA * NI), r0s = []; // last row: the lighthouse rock
  SL.forEach((I, row) => { const rr = []; for (let i = 0; i < NA; i++) {
    const a = ((i + .5) / NA - .5) * TAU, c = Math.cos(a), sn = Math.sin(a), wet = r => landH(I.x + c * r, I.z + sn * r) < .05; let r = I.r * 1.45;
    while (r > 2 && wet(r)) r -= 2; let lo = r, hi = r + 2; if (r > 2) for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (wet(m)) hi = m; else lo = m; } else lo = I.r * .5;
    rr.push(lo); data[row * NA + i] = THREE.DataUtils.toHalfFloat(lo); } r0s.push(rr); });
  SHORE = new THREE.DataTexture(data, NA, NI, THREE.RedFormat, THREE.HalfFloatType); SHORE.wrapS = THREE.RepeatWrapping; SHORE.magFilter = SHORE.minFilter = THREE.LinearFilter; SHORE.generateMipmaps = false; SHORE.needsUpdate = true;
  MAT.sea.userData.U.uShore.value = SHORE; FOAM.userData.r0 = r0s;
  FOAM.userData.mat = mat;
  // boulders strewn along every island's waterline
  const br = mulberry(777), L = [];
  SL.forEach((I, row) => { if (I.bar) return; const n = 12 + Math.floor(br() * 14); for (let k = 0; k < n; k++) { const i = Math.floor(br() * NA), a = ((i + .5) / NA - .5) * TAU, r = r0s[row][i] + (br() * 2 - 1) * 2, x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r, s = .6 + br() * 1.6;
    if (I.home && ((z - HOME.z) / Math.hypot(x - HOME.x, z - HOME.z) > .45 || (Math.abs(x - JETTY.x) < 9 && z > HOME.z))) continue; L.push([x, landH(x, z), z, s, br(), br(), br()]); if (s > 1.3) PCIRC.push({x, z, r: s * .75}); } });
  const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({map: TX.rock, color: 0xffffff, roughness: .95, metalness: 0, flatShading: true}), L.length), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), C = new THREE.Color();
  L.forEach(([x, y, z, s, a, b, c], i) => { E.set(a * TAU, b * TAU, c * TAU); M4.compose(V.set(x, Math.max(y, -1.2) + s * .15, z), Q.setFromEuler(E), S3.set(s * (1 + a * .3), s * (.55 + b * .3), s * (1 + c * .25))); im.setMatrixAt(i, M4); const k = 1.05 + a * .45; im.setColorAt(i, C.setRGB(k, k * (.95 + b * .05), k * (.9 + c * .06))); });
  im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
}
function buildBirds() {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-.7, .12, -.1, 0, 0, .25, 0, 0, -.15, .7, .12, -.1, 0, 0, .25, 0, 0, -.15], 3)); g.computeVertexNormals();
  BIRDS = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({color: 0x101014, side: THREE.DoubleSide, fog: true}), 14); BIRDS.frustumCulled = false; scene.add(BIRDS);
  BIRDS.userData.ph = [...Array(14)].map(() => [Math.random() * TAU, 14 + Math.random() * 26, 14 + Math.random() * 14, .12 + Math.random() * .1, Math.random() * TAU]);
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(1, 1, 1), _be = new THREE.Euler();
function stepBirds(t, ex, ez) {
  if (!BIRDS) return; let best = null, bd = 1e9; for (const I of ISLES) { const d = Math.hypot(I.x - ex, I.z - ez); if (d < bd) { bd = d; best = I; } }
  const vis = best && bd < 420 && TOD.day > .2 && G.storm < .5; BIRDS.visible = vis; if (!vis) return;
  BIRDS.userData.ph.forEach((p, i) => {
    const a = p[0] + t * p[3], r = p[1], x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r, y = p[2] + Math.sin(t * .7 + p[4]) * 3, fl = Math.sin(t * 9 + p[4]) * .5;
    _be.set(0, -a, Math.sin(t * .5 + i) * .3); _bq.setFromEuler(_be); _bs.set(1, 1 + fl * .6, 1).multiplyScalar(.9);
    _bm.compose(_v.set(x, y, z), _bq, _bs); BIRDS.setMatrixAt(i, _bm);
  }); BIRDS.instanceMatrix.needsUpdate = true;
}

// ---------------- boat
const UPG = {
  engine: {n: 'Engine', d: 'Top speed', cost: [150, 320, 600]},
  hull: {n: 'Hull plating', d: 'Takes more hits', cost: [160, 340]},
  light: {n: 'Searchlight', d: 'Brighter, longer beam', cost: [90, 200]},
  sonar: {n: 'Sonar', d: 'Compass and map show unfound places, floating cargo and sunken treasure', cost: [220]},
  hold: {n: 'Hold racks', d: 'Fit more salvage in the hold', cost: [140, 320]},
  crane: {n: 'Cargo crane', d: 'Haul floating cargo aboard from twice as far', cost: [180]},
};
const B = {x: 0, z: 0, yaw: PI, v: 0, thr: 0, st: 0, driver: null, heave: 0, pitch: 0, roll: 0, fuel: 100, hull: 100, up: {engine: 0, tank: 0, hull: 0, light: 0, sonar: 0, hold: 0, crane: 0, cls: 0}, hold: [], sink: 0, dep: 0, dtar: 0};
// hull classes: buy any of them at the shed while the boat is at the jetty
const HULLS = [
  {n: 'Salvage launch', d: 'The boat everyone starts with', cost: 0, L: 12.2, W: 4.4, fb: 1.3, spd: 1, turn: 1, hold: 8, hp: 1, fuel: 1, col: 0x1e3a4a, wh: [.18, .42]},
  {n: 'Fishing trawler', d: 'Long work deck, stern gantry, twice the hold', cost: 900, L: 17, W: 5.6, fb: 1.45, spd: .95, turn: .85, hold: 16, hp: 1.6, fuel: 1.4, col: 0x7a1e16, wh: [.12, .34]},
  {n: 'Patrol cutter', d: 'Fast and tough, radar mast, big searchlight', cost: 1900, L: 22, W: 6, fb: 1.6, spd: 1.45, turn: .9, hold: 20, hp: 2.2, fuel: 1.8, col: 0x2e333a, wh: [.2, .4]},
  {n: 'Cargo freighter', d: 'A massive ship: container deck, huge hold, very tough, slow to turn', cost: 3800, L: 38, W: 10, fb: 1.9, spd: .9, turn: .17, hold: 60, hp: 4, fuel: 3, col: 0x1c2c3e, wh: [.66, .84]},
  {n: 'Research submarine', d: 'Walk-in sub: hatch, control room, bunks, galley and a diver airlock. Dives to 80 m (C down, Space up at the helm), claws sunken treasure', cost: 5200, L: 24, W: 5.8, fb: 1.6, spd: 1.15, turn: .8, hold: 28, hp: 3, fuel: 2, col: 0xd8a020, sub: 1, maxDep: 80},
  {n: 'Dive support vessel', d: 'A 48 m work ship: helipad, deck crane, a huge hold. Divers go over the side from her stern platform', cost: 7500, L: 48, W: 12, fb: 1.9, spd: 1.05, turn: .155, hold: 90, hp: 5, fuel: 4, col: 0x24486a, wh: [.12, .24], eye: 5.5, big: 1},
  {n: 'Icebreaker', d: 'A 64 m red giant with an armoured bow and two funnels. Rams barely scratch her', cost: 12500, L: 64, W: 14, fb: 2, spd: 1.12, turn: .125, hold: 120, hp: 9, fuel: 5, col: 0x9a1a12, wh: [.16, .28], eye: 9, big: 1},
  {n: 'MS Serenade', d: 'The 120 m cruise liner from the far north. Start her engines on the derelict to claim her. Something still lives aboard', cost: 0, L: 120, W: 26, fb: 2.2, spd: 1.25, turn: .075, hold: 260, hp: 15, fuel: 9, col: 0xd8d4c8, wh: [.1, .2], eye: 24, big: 1, cruise: 1},
];
const HC = () => HULLS[B.up.cls || 0];
const tankMax = () => Math.round([100, 160, 240][B.up.tank] * HC().fuel), hullMax = () => Math.round([100, 150, 220][B.up.hull] * HC().hp), holdMax = () => Math.round(HC().hold * [1, 1.5, 2][B.up.hold || 0]);
const BDECK = {x0: -2, x1: 2, z0: -5, z1: 5.2, y: 1.3}, BW = [], BHELM = [0, -2.6];
const BSPOT = {hold: [0, 3], fuel: [1.5, 4.6], patch: [-1.5, 4.6]};
const BG = {zs: 5.4, zb: -6.8, W: 4.4, L: 12.2, hw: 2.2};
// the research sub (HULLS[4]) in boat-local metres (y 0 = waterline, bow at -z): pressure hull, casing walkway (= BDECK), the inner deck at FI, trunk TR, airlock chamber LKR, outer door LD
const SUB = {R: 2.5, Ri: 2.3, cy: -1, zB: -10.8, zA: 7.6, tail: 10.2, dR: 2, FI: -2.4, OH: -.05, fx: 1.8, zF: -11.9, zE: 7, BH: [-2.6, 4.2], dw: .5, CAS: 1.6, cx: 1.35, cz0: -9.4, cz1: 8.2,
  SAIL: {x: .55, z0: -7.4, z1: -4.4, top: 4.2}, TR: {x: 0, z: -3.6, r: .45}, LKR: {x0: .25, x1: 1.78, z0: 2, z1: 3.8, dz0: 2.4, dz1: 3.4}, LD: {x: 2.45, y: -1.6, z: 2.9}, HELM: [0, -10.45], SCOPE: [0, -5.9],
  lamps: [[0, -.25, -10.1], [0, -.25, -7.3], [0, -.25, -4.7], [0, -.25, -1], [-.4, -.25, 2.9], [1, -.3, 2.9], [0, -.25, 5.5]]};
// boat floors (the deck, plus the sub's inner deck), the airlock state (0 dry, 1 seal, 2 flood, 3 open, 4 shut, 5 drain, 6 unseal), sub canvases and uniforms
const BFL = [], LK = {st: 0, t: 0, w: 0, ent: -1}, SUBC = {}, _sb = new THREE.Vector3(), _sc = new THREE.Vector3(); B.hat = 1;
function bL2W(lx, lz) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw); return [B.x + lx * c + lz * s, B.z - lx * s + lz * c]; }
function bW2L(x, z) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw), dx = x - B.x, dz = z - B.z; return [dx * c - dz * s, dx * s + dz * c]; }
let BOAT = null;
function hullHW(z) { const t = clamp((z - BG.zb) / (BG.zs - BG.zb), 0, 1); return BG.hw * (t < .45 ? Math.pow(Math.sin(t / .45 * PI / 2), .75) : 1 - (t - .45) * .06); }
function buildBoat() {
  const cls = B.up.cls || 0, H = HULLS[cls];
  if (BOAT) { scene.remove(BOAT); const keep = new Set(Object.values(MATC).concat(Object.values(MAT))), txs = new Set(Object.values(TX));
    BOAT.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); const m = o.material; if (m && !keep.has(m)) { if (m.map && !txs.has(m.map)) m.map.dispose(); m.dispose(); } }); }
  for (let i = INTER.length - 1; i >= 0; i--) if (INTER[i].boat) INTER.splice(i, 1);
  BW.length = 0; BFL.length = 0; BFL.push(BDECK); BHELM.length = 2;
  const L = H.L, W = H.W, hw = W / 2, fb = H.fb, zs = L * .44, zb = -L * .56;
  Object.assign(BG, {zs, zb, W, L, hw, sub: !!H.sub});
  const g = new THREE.Group(), S = o => { if (o.nc) { delete o.nc; return new THREE.MeshStandardMaterial(Object.assign({roughness: .55, metalness: .15}, o)); } const k = Object.keys(o).map(q => q + ':' + (o[q] && o[q].isTexture ? o[q].uuid : o[q])).join(); return MATC[k] || (MATC[k] = new THREE.MeshStandardMaterial(Object.assign({roughness: .55, metalness: .15}, o))); };
  const whiteM = S({color: 0xd0d0c8, roughness: .45}), deckM = S({map: TX.wood, color: 0x9a8a70, roughness: .8}), redM = S({color: 0x8a1a14}), steel = S({color: 0x5a6068, metalness: .6, roughness: .4}), darkM = S({color: 0x1a1c1e}), yel = S({color: 0xd8b020});
  const glass = new THREE.MeshStandardMaterial({color: 0x9ac0d0, roughness: .03, metalness: .1, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4});
  const add = (geo, m, x, y, z, p = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = m !== glass; o.receiveShadow = true; p.add(o); return o; };
  const box = (m, x0, x1, y0, y1, z0, z1, wall) => { const o = add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); if (wall) BW.push({x0, x1, z0, z1, y0: y0 - fb, y1: y1 - fb}); return o; };
  const cyl = (m, r0, r1, h, x, y, z, rx = 0, rz = 0, seg = 12) => { const o = add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z); o.rotation.set(rx, 0, rz); return o; };
  const hc = new THREE.Color((PAINTS[B.up.paint || 0] || PAINTS[0]).c || H.col), wc = new THREE.Color(0xe8e8e0), rc = new THREE.Color(0x7a1812);
  if (!H.sub) {
    // lofted hull: flared topsides, chine, V bottom, sheer rising to the bow, boot stripe and antifouling
    const d = .6 + fb * .7 + (H.big ? L * .045 : 0), NZ = H.big ? 40 : 28, ice = cls === 6, gy = Math.min(fb - .12, .62 + L * .004);
    const ring = ice ? [[1, 'top', 0], [1, fb, 0], [.997, 1.5, 0], [.995, 1.42, 4], [.99, .36, 4], [.985, .3, 5], [.98, .06, 5], [.975, .02, 3], [.82, -d * .55, 3], [.42, -d * .92, 3], [0, -d, 3]] : [[1, 'top', 0], [1, fb, 0], [.995, gy, 0], [.99, .36, 1], [.985, .3, 2], [.98, .06, 2], [.975, .02, 3], [.82, -d * .55, 3], [.42, -d * .92, 3], [0, -d, 3]];
    const pos = [], col = [], uv = [], idx = [], nr = ring.length * 2 - 1, HCOL = [hc, hc.clone().multiplyScalar(.55), wc, rc, new THREE.Color(0x4a0e0a), new THREE.Color(0x161616)], ps = 1 + L / 40, bwH = H.big ? Math.min(1.3, 1 + L * .003) : .32, shr = H.big ? Math.min(5, L * .03) : .9 * Math.min(1.6, L / 14), topAt = t => fb + bwH + shr * Math.pow(1 - t, 2.2);
    for (let i = 0; i <= NZ; i++) { const z = mix(zb, zs, i / NZ), w = hullHW(z), t = i / NZ, top = topAt(t), rk = ice ? L * .07 * Math.pow(Math.max(0, 1 - t / .22), 2) : 0;
      const pts = []; for (const [f, y, c] of ring) pts.push([-w * f, y === 'top' ? top : y, c]); for (let k = ring.length - 2; k >= 0; k--) { const [f, y, c] = ring[k]; pts.push([w * f, y === 'top' ? top : y, c]); }
      for (const [x, y, c] of pts) { const zz = y < 0 ? z + rk * (-y / d) : z, q = HCOL[c]; pos.push(x, y, zz); col.push(q.r, q.g, q.b); uv.push(zz / (8 * ps), 1 + (y - fb) / (4 * ps)); } }
    for (let i = 0; i < NZ; i++) for (let k = 0; k < nr - 1; k++) { const a = i * nr + k, b = a + 1, c = a + nr, e = c + 1; idx.push(a, c, b, b, c, e); }
    const tc = pos.length / 3; pos.push(0, fb * .4, zs); col.push(hc.r, hc.g, hc.b); uv.push(zs / (8 * ps), 1 - .6 * fb / (4 * ps)); for (let k = 0; k < nr - 1; k++) idx.push(tc, NZ * nr + k, NZ * nr + k + 1);
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); hg.setIndex(idx); hg.computeVertexNormals();
    add(hg, S({vertexColors: true, map: shpPlate(cls === 11), roughness: cls === 11 ? .3 : .5, metalness: .1, side: THREE.DoubleSide}), 0, 0, 0);
    const f = z => Math.max(0, hullHW(z) - .05), sh = new THREE.Shape(); sh.moveTo(f(zs), -zs); for (let i = 1; i <= NZ; i++) { const z = mix(zs, zb, i / NZ); sh.lineTo(f(z), -z); } for (let i = NZ - 1; i >= 0; i--) { const z = mix(zs, zb, i / NZ); sh.lineTo(-f(z), -z); }
    const dk = new THREE.ShapeGeometry(sh); dk.rotateX(-PI / 2); dk.translate(0, fb + .005, 0); add(dk, deckM, 0, 0, 0);
    // gunwale cap and rails
    for (const sd of [-1, 1]) for (let i = 0; i < NZ; i++) { const za = mix(zb, zs, i / NZ), zz = mix(zb, zs, (i + 1) / NZ), xa = sd * hullHW(za), xz = sd * hullHW(zz), ta = topAt(i / NZ), tz = topAt((i + 1) / NZ);
      const l = Math.hypot(xz - xa, zz - za, tz - ta), cap = add(new THREE.BoxGeometry(H.big ? .3 : .12, .06, l + .02), whiteM, (xa + xz) / 2, (ta + tz) / 2 + .03, (za + zz) / 2); cap.rotation.set(-Math.atan2(tz - ta, zz - za), Math.atan2(xz - xa, zz - za), 0, 'YXZ');
      if (!H.big && i % 2 === 0 && i > NZ * .2) { cyl(whiteM, .025, .025, .75, xa, ta + .4, za, 0, 0, 6); } }
    if (!H.big) for (const sd of [-1, 1]) { const zz = zb + L * .3; const r = add(new THREE.CylinderGeometry(.025, .025, zs - zz, 6), whiteM, sd * (hw - .06), fb + 1.08, (zz + zs) / 2); r.rotation.x = PI / 2; }
    const dz0 = zb + (zs - zb) * .32, fz0 = H.big ? Math.min(dz0, mix(zb, zs, H.wh[0]) + .12) : dz0;
    BDECK.x0 = -hw + .3; BDECK.x1 = hw - .3; BDECK.z0 = fz0; BDECK.z1 = zs - .25; BDECK.y = fb;
    for (const sd of [-1, 1]) BW.push({x0: sd < 0 ? -hw - .5 : hw - .28, x1: sd < 0 ? -hw + .28 : hw + .5, z0: dz0 - 1, z1: zs + .3, y0: 0, y1: 1.1});
    if (fz0 < dz0) for (let i = 0; i < 12; i++) { const za = mix(fz0 - 1, dz0, i / 12), zz = mix(fz0 - 1, dz0, (i + 1) / 12), x = Math.min(hullHW(za), hullHW(zz)) - .3; BW.push({x0: -hw - .5, x1: -x, z0: za, z1: zz, y0: 0, y1: 1.1}, {x0: x, x1: hw + .5, z0: za, z1: zz, y0: 0, y1: 1.1}); }
    BW.push({x0: -hw, x1: hw, z0: BDECK.z0 - 2, z1: BDECK.z0 + .05, y0: 0, y1: 2});
    BW.push({x0: -hw, x1: -.6, z0: zs - .12, z1: zs + .4, y0: 0, y1: 1}); BW.push({x0: .6, x1: hw, z0: zs - .12, z1: zs + .4, y0: 0, y1: 1});
    // wheelhouse with real walls and windows
    const sft = cls === 3 || H.big ? 0 : L * .12, wz0 = mix(zb, zs, H.wh[0]) + sft, wz1 = mix(zb, zs, H.wh[1]) + sft, ww = Math.min(hullHW(wz0), hullHW(wz1)) * .82, hh = 2.25, y0 = fb;
    const wallM = cls === 2 ? S({color: 0x8a9098}) : cls === 9 ? S({map: TX.wood, color: 0xe8dcb8, roughness: .85}) : cls === 10 ? S({color: 0xe0dcd0, roughness: .6}) : cls === 11 ? S({color: 0xf4f4f6, roughness: .25}) : whiteM;
    box(wallM, -ww, ww, y0, y0 + 1.05, wz0, wz0 + .12, 1); box(wallM, -ww, ww, y0 + 1.9, y0 + hh, wz0, wz0 + .12); add(new THREE.BoxGeometry(ww * 2, .85, .04), glass, 0, y0 + 1.48, wz0 + .06);
    for (const sd of [-1, 1]) { const x0 = sd < 0 ? -ww : ww - .12, x1 = x0 + .12; box(wallM, x0, x1, y0, y0 + 1.05, wz0, wz1, 1); box(wallM, x0, x1, y0 + 1.9, y0 + hh, wz0, wz1); box(wallM, x0, x1, y0, y0 + hh, wz1 - .5, wz1); add(new THREE.BoxGeometry(.04, .85, wz1 - wz0 - .6), glass, sd * (ww - .06), y0 + 1.48, (wz0 + wz1) / 2 - .25);
      for (let z = wz0 + .1; z < wz1 - .5; z += (wz1 - wz0) / 3) box(wallM, x0, x1, y0 + 1.05, y0 + 1.9, z, z + .08); }
    box(wallM, -ww, -.55, y0, y0 + hh, wz1 - .12, wz1, 1); box(wallM, .55, ww, y0, y0 + hh, wz1 - .12, wz1, 1); box(wallM, -.55, .55, y0 + 2, y0 + hh, wz1 - .12, wz1);
    box(wallM, -ww - .15, ww + .15, y0 + hh, y0 + hh + .12, wz0 - .3, wz1 + .2);
    // helm console against the windscreen, wheel on its back face
    box(darkM, -.55, .55, y0, y0 + 1.05, wz0 + .12, wz0 + .62, 1); const hz = wz0 + .62;
    const wg = new THREE.Group(); wg.position.set(0, y0 + 1.12, hz + .08); wg.rotation.x = -.45; g.add(wg);
    const wm = S({color: 0x4a3018, roughness: .5}); wg.add(new THREE.Mesh(new THREE.TorusGeometry(.3, .028, 8, 24), wm));
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .62, 5), wm); sp.rotation.z = i / 6 * PI; wg.add(sp); const hd = new THREE.Mesh(new THREE.CylinderGeometry(.02, .016, .14, 6), wm); hd.position.set(Math.cos(i / 6 * TAU) * .37, Math.sin(i / 6 * TAU) * .37, 0); hd.rotation.z = i / 6 * TAU + PI / 2; wg.add(hd); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .22, 10), steel); hub.rotation.x = PI / 2; hub.position.z = -.08; wg.add(hub);
    g.userData.wheel = wg;
    cyl(steel, .015, .015, .25, .38, y0 + 1.2, hz - .1, -.4); add(new THREE.SphereGeometry(.035, 8, 6), redM, .38, y0 + 1.33, hz - .05);
    add(new THREE.SphereGeometry(.11, 12, 8), S({color: 0x8a6a30, metalness: .7, roughness: .3}), -.35, y0 + 1.15, hz - .25);
    const scr = add(new THREE.BoxGeometry(.32, .22, .03), S({color: 0x103020, emissive: 0x2a8a50, emissiveIntensity: .6}), 0, y0 + 1.18, hz - .22); scr.rotation.x = -.6;
    BHELM[0] = 0; BHELM[1] = hz + .55;
    // wheelhouse interior: chart table, bench, radio, lamp, clock, extinguisher, life jackets; a casino table on the big ships
    { const zm = (wz0 + wz1) / 2, fab = S({color: 0x6a2a24, roughness: .9}), wd = S({map: TX.wood, color: 0x8a6a48, roughness: .7});
      box(wd, ww - .7, ww - .12, fb + .82, fb + .88, zm - .2, zm + .9, 1); box(wd, ww - .66, ww - .62, fb, fb + .82, zm - .15, zm - .1); const mp = add(new THREE.PlaneGeometry(.5, .8), S({map: TX.paper, roughness: 1}), ww - .4, fb + .885, zm + .35); mp.rotation.x = -PI / 2;
      cyl(S({color: 0xe8e0d0}), .04, .035, .1, ww - .55, fb + .93, zm - .05); cyl(S({color: 0x2a2a2a}), .006, .006, .25, ww - .3, fb + .9, zm + .6, 0, PI / 2);
      box(fab, -ww + .12, -ww + .62, fb, fb + .45, zm - .6, zm + 1.1, 1); box(fab, -ww + .12, -ww + .22, fb + .45, fb + .95, zm - .6, zm + 1.1);
      const rd = box(darkM, -.62, -.24, fb + 1.05, fb + 1.3, hz - .45, hz - .2); add(new THREE.BoxGeometry(.3, .06, .01), S({color: 0x201000, emissive: 0xffa040, emissiveIntensity: .5}), -.43, fb + 1.2, hz - .195);
      INTER.push({kind: 'radio', boat: 1, lx: -.43, lz: hz - .1, ly: 1.2, r: 1.7, label: () => G.radioOn ? 'Turn the radio off' : 'Turn on the radio', go: () => act({a: 'radio', on: !G.radioOn})});
      cyl(steel, .006, .006, .5, 0, fb + hh - .25, zm); const bulb = add(new THREE.SphereGeometry(.07, 10, 8), S({color: 0xfff0d0, emissive: 0xffd8a0, emissiveIntensity: .45}), 0, fb + hh - .52, zm); bulb.castShadow = false; cyl(darkM, .02, .2, .14, 0, fb + hh - .44, zm, 0, 0, 16);
      cyl(redM, .07, .07, .45, ww - .3, fb + .23, wz1 - .3); const ck = add(new THREE.CircleGeometry(.14, 20), S({color: 0xf0ece0}), 0, fb + 2.02, wz1 - .125); ck.rotation.y = PI; add(new THREE.BoxGeometry(.01, .1, .005), darkM, 0, fb + 2.05, wz1 - .13);
      for (let i = 0; i < 2; i++) box(S({color: 0xe06018}), -ww + .9 + i * .45, -ww + 1.25 + i * .45, fb + 1.2, fb + 1.65, wz1 - .26, wz1 - .14);
      // warm wood lining in every wheelhouse
      const pan = S({map: TX.wood, color: 0xb08860, roughness: .75}); box(pan, -ww + .12, -ww + .14, fb, fb + 1.05, wz0 + .12, wz1 - .12); box(pan, ww - .14, ww - .12, fb, fb + 1.05, wz0 + .12, wz1 - .12); box(pan, -ww + .12, -.55, fb, fb + 1.05, wz1 - .14, wz1 - .12); box(pan, .55, ww - .12, fb, fb + 1.05, wz1 - .14, wz1 - .12);
      box(pan, -ww + .12, ww - .12, fb + hh - .04, fb + hh - .02, wz0 + .12, wz1 - .12);
      if (H.big || cls === 3) { // the cosy part: rug, sofa with a sleeping cat, wood stove, books, plants, fairy lights
        const sof = S({color: 0x8a4a2a, roughness: .95}), cush = S({color: 0xd8b878, roughness: 1}), x0 = -ww + .7, x1 = -1.2, sz = wz1 - .14;
        box(S({color: 0x7a2a1a, roughness: 1}), x0, x1 + .4, fb, fb + .012, sz - 2.9, sz - .9);
        box(sof, x0, x1, fb, fb + .42, sz - .85, sz, 1); box(sof, x0, x1, fb + .42, fb + .95, sz - .25, sz); box(sof, x0 - .02, x0 + .2, fb + .42, fb + .65, sz - .85, sz); box(sof, x1 - .2, x1, fb + .42, fb + .65, sz - .85, sz);
        for (let i = 0; i < 3; i++) { const cx = mix(x0 + .45, x1 - .45, i / 2); box(cush, cx - .32, cx + .32, fb + .42, fb + .55, sz - .78, sz - .28); }
        box(S({color: 0x3a6a8a, roughness: 1}), x1 - .9, x1 - .2, fb + .55, fb + .58, sz - .8, sz - .25);
        box(wd, (x0 + x1) / 2 - .5, (x0 + x1) / 2 + .5, fb + .4, fb + .45, sz - 1.9, sz - 1.3, 1); for (const lx of [-.45, .45]) for (const lz of [-1.85, -1.35]) box(wd, (x0 + x1) / 2 + lx - .025, (x0 + x1) / 2 + lx + .025, fb, fb + .4, sz + lz - .025, sz + lz + .025);
        cyl(S({color: 0xe8e0d0}), .045, .04, .1, (x0 + x1) / 2 + .2, fb + .5, sz - 1.6); box(S({color: 0x2a3a5a}), (x0 + x1) / 2 - .3, (x0 + x1) / 2 - .05, fb + .45, fb + .48, sz - 1.7, sz - 1.5);
        // a ship's cat asleep on the sofa
        const cm = S({color: 0xc8783a, roughness: 1}), cat = new THREE.Group(); cat.position.set(x0 + .55, fb + .62, sz - .5); g.add(cat);
        const cb = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 8), cm); cb.scale.set(1.5, .75, 1); cat.add(cb); const ch = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), cm); ch.position.set(.2, .02, .06); cat.add(ch);
        for (const e of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(.03, .06, 4), cm); ear.position.set(.22, .1, .06 + e * .045); cat.add(ear); }
        const tl = new THREE.Mesh(new THREE.TorusGeometry(.17, .025, 6, 12, PI * 1.2), cm); tl.rotation.x = PI / 2; tl.position.y = -.03; cat.add(tl); g.userData.cat = cat; g.userData.catP = [x0 + .55, fb + .62, sz - .5];
        // wood stove with a glowing window and a flue
        const s0 = Math.min(zm + 1.1, wz1 - 1.75); box(S({color: 0x1a1a1a, roughness: .6, metalness: .4}), ww - .78, ww - .2, fb, fb + .8, s0, s0 + .6, 1);
        const fw = add(new THREE.BoxGeometry(.02, .26, .36), S({color: 0x200800, emissive: 0xff6a20, emissiveIntensity: 1.1, nc: 1}), ww - .79, fb + .42, s0 + .3); g.userData.fire = fw.material;
        cyl(S({color: 0x2a2a2a, metalness: .5}), .07, .07, hh - .8, ww - .5, fb + .8 + (hh - .8) / 2, s0 + .3); g.userData.stove = [ww - .9, fb + .7, s0 + .3];
        // bookshelf, plants, pictures, fairy lights
        const bz0 = wz0 + .75, bz1 = Math.max(bz0 + .6, zm - .8); box(wd, -ww + .14, -ww + .5, fb, fb + 1.9, bz0, bz1, 1); for (let r = 0; r < 4; r++) { box(wd, -ww + .14, -ww + .5, fb + .4 + r * .45, fb + .43 + r * .45, bz0, bz1); for (let z = bz0 + .04; z < bz1 - .06; z += .07 + (r * z * 13 % 3) * .01) box(S({color: [0x7a2a1a, 0x2a4a6a, 0x3a5a2a, 0xa08030, 0x5a2a5a][Math.floor(Math.abs(z * 31 + r) % 5)], roughness: .9}), -ww + .18, -ww + .45, fb + .43 + r * .45, fb + .43 + r * .45 + .28 + ((z * 17) % .08), z, z + .055); }
        for (const [px, pz] of [[ww - .45, wz1 - 1.2], [-ww + .5, wz0 + .5]]) { cyl(S({color: 0x8a4a2a}), .14, .1, .26, px, fb + .13, pz); for (let i = 0; i < 6; i++) { const lf = add(new THREE.ConeGeometry(.05, .55, 4), S({color: 0x2a6a2a, roughness: .9}), px + Math.cos(i) * .06, fb + .5, pz + Math.sin(i) * .06); lf.rotation.set(Math.sin(i * 2) * .5, 0, Math.cos(i * 2) * .5); } }
        for (const [px, pz, w2] of [[-ww + .15, zm + .2, .5], [ww - .15, zm - .9, .4]]) { const pf = add(new THREE.BoxGeometry(.02, w2 * .7, w2), S({color: 0x3a2a1a}), px, fb + 1.45, pz); const pc = add(new THREE.PlaneGeometry(w2 * .85, w2 * .6), S({color: [0x5a8aa0, 0xc89a5a][px > 0 ? 1 : 0], roughness: .9}), px + (px > 0 ? -.012 : .012), fb + 1.45, pz); pc.rotation.y = px > 0 ? -PI / 2 : PI / 2; }
        const fl = S({color: 0x302010, emissive: 0xffc070, emissiveIntensity: 1, nc: 1}); g.userData.fairy = fl; for (const zz of [wz0 + .25, wz1 - .25]) for (let x = -ww + .3; x < ww - .2; x += .45) add(new THREE.SphereGeometry(.025, 6, 4), fl, x, fb + hh - .1 - Math.abs(Math.sin(x * 1.3)) * .08, zz).castShadow = false;
      }
      if (H.big || cls === 3) { const tz = wz1 - 1.8; box(S({color: 0x0e4a2a, roughness: .9}), -.9, .9, fb + .78, fb + .84, tz - .55, tz + .55, 1); box(wd, -.95, .95, fb, fb + .78, tz - .6, tz + .6); for (const sx of [-1, 1]) cyl(fab, .2, .2, .5, sx * 1.35, fb + .25, tz);
        box(darkM, ww - 1.1, ww - .3, fb, fb + 1.7, wz1 - .9, wz1 - .3, 1); add(new THREE.BoxGeometry(.6, .4, .02), S({color: 0x101010, emissive: 0xff3070, emissiveIntensity: .5}), ww - .7, fb + 1.25, wz1 - .91);
        INTER.push({kind: 'cas', boat: 1, lx: 0, lz: tz, ly: 1, r: 2, label: () => 'Card table: blackjack, roulette, slots', go: openCasino}); } }
    cyl(whiteM, .04, .04, 1.4, 0, y0 + hh + .8, (wz0 + wz1) / 2);
    for (const sd of [-1, 1]) { const nl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: sd < 0 ? 0xff2020 : 0x20ff40, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); nl.scale.setScalar(.8); nl.position.set(sd * (ww + .1), y0 + hh + .1, wz0); g.add(nl); }
    g.userData.lightZ = wz0 - .2; g.userData.lightY = y0 + hh + .3; g.userData.wz = [wz0, wz1]; g.userData.ww = ww; g.userData.lamp = [0, y0 + hh - .6, (wz0 + wz1) / 2];
    const aft = (wz1 + zs) / 2;
    BSPOT.hold[0] = 0; BSPOT.hold[1] = Math.min(zs - 2.2, wz1 + 1.8 + (cls === 3 ? 0 : 0)); BSPOT.fuel[0] = hw - .9; BSPOT.fuel[1] = zs - .8; BSPOT.patch[0] = -hw + .9; BSPOT.patch[1] = zs - .8;
    if (cls === 3) { BSPOT.hold[1] = wz0 - 2.4; } if (cls === 7) BSPOT.hold[1] = zs - 9; if (cls === 8) { BSPOT.hold[0] = -.55; BSPOT.hold[1] = wz1 + 1.1; BSPOT.fuel[0] = hw - .55; BSPOT.patch[0] = -hw + .55; BSPOT.fuel[1] = BSPOT.patch[1] = zs - .45; } if (cls === 9) { BSPOT.hold[0] = -1.3; BSPOT.hold[1] = wz1 + 1.6; } if (cls === 11) BSPOT.hold[1] = wz1 + 2.2; if (cls === 12) BSPOT.hold[1] = zs - 30;
    const hz2 = BSPOT.hold[1], hx2 = BSPOT.hold[0], hb2 = cls === 8 ? .42 : .9, hl2 = cls === 8 ? .5 : .7; box(S({map: TX.wood, color: 0x6a5a44}), hx2 - hb2, hx2 + hb2, fb, fb + .22, hz2 - hl2, hz2 + hl2); box(steel, hx2 - hb2 - .05, hx2 + hb2 + .05, fb, fb + .08, hz2 - hl2 - .05, hz2 + hl2 + .05); BW.push({x0: hx2 - hb2, x1: hx2 + hb2, z0: hz2 - hl2, z1: hz2 + hl2, y0: 0, y1: .2});
    cyl(redM, .13, .13, .32, BSPOT.fuel[0], fb + .16, BSPOT.fuel[1]); box(yel, BSPOT.patch[0] - .3, BSPOT.patch[0] + .3, fb, fb + .4, BSPOT.patch[1] - .2, BSPOT.patch[1] + .2);
    // stern ladder down the transom
    for (let y = -.8; y < fb; y += .3) box(steel, -.32, .32, y, y + .04, zs + .05, zs + .1); for (const sd of [-1, 1]) box(steel, sd * .32 - .02, sd * .32 + .02, -.9, fb + .9, zs + .04, zs + .1);
    // class extras
    if (cls === 1) { for (const sd of [-1, 1]) box(steel, sd * (hw - .6) - .1, sd * (hw - .6) + .1, fb, fb + 3.4, zs - .9, zs - .7, 1); box(steel, -hw + .5, hw - .5, fb + 3.3, fb + 3.5, zs - .9, zs - .7); const dr = cyl(S({color: 0x3a6a3a}), .55, .55, 2.4, 0, fb + .6, aft - 1, 0, PI / 2, 16); BW.push({x0: -1.2, x1: 1.2, z0: aft - 1.6, z1: aft - .4, y0: 0, y1: 1.2}); }
    if (cls === 2) { cyl(steel, .06, .08, 3.2, 0, fb + hh + 1.6, (wz0 + wz1) / 2 + .4); const rad = add(new THREE.BoxGeometry(1.6, .12, .25), darkM, 0, fb + hh + 3.2, (wz0 + wz1) / 2 + .4); g.userData.radar = rad;
      cyl(steel, .25, .35, .5, 0, fb + .25, wz0 - 2.2); const gun = cyl(darkM, .06, .06, 1.6, 0, fb + .6, wz0 - 2.9, PI / 2); g.userData.gun = gun; }
    if (cls === 3) { const ss = S({color: 0xe0e0d8}); box(ss, -ww, ww, fb + hh + .12, fb + hh + 5.6, wz0 + .2, wz1 - .2); for (let lv = 0; lv < 2; lv++) add(new THREE.BoxGeometry(ww * 2 + .02, .5, .02), glass, 0, fb + hh + 1.2 + lv * 2.2, wz0 + .19);
      box(ss, -ww - 1.6, ww + 1.6, fb + hh + 5.6, fb + hh + 7.4, wz0 - .3, wz1 - 1); add(new THREE.BoxGeometry(ww * 2 + 3.2, .7, .02), glass, 0, fb + hh + 6.6, wz0 - .32);
      cyl(S({color: 0x9a2a1a}), 1.1, 1.3, 4.5, 0, fb + hh + 8, wz1 - 2.2); cyl(darkM, 1.12, 1.12, .7, 0, fb + hh + 10, wz1 - 2.2);
      const CM = [MAT.cont, MAT.cont2, S({color: 0x2a5a8a}), S({color: 0x8a3a1a}), S({color: 0x3a7a3a})];
      for (let r = 0; r < 4; r++) for (let c = -1; c <= 1; c++) { const z0 = zb + L * .2 + r * 6.4; if (z0 + 6 > wz0 - 1) continue; const h = 1 + ((r + c + 3) % 3); for (let k = 0; k < h; k++) box(CM[(r * 3 + c + k + 6) % 5], c * 2.6 - 1.2, c * 2.6 + 1.2, fb + k * 2.5, fb + k * 2.5 + 2.45, z0, z0 + 6, k === 0); }
      for (const sd of [-1, 1]) { cyl(S({color: 0xd8a020}), .25, .3, 7, sd * (hw - 1), fb + 3.5, zb + L * .3); cyl(S({color: 0xd8a020}), .5, .5, .4, sd * (hw - 1), fb + 7.1, zb + L * .3); }
      BSPOT.fuel[1] = zs - .8; BSPOT.patch[1] = zs - .8; }
    const SX = {g, H, L, W, hw, fb, zs, zb, wz0, wz1, ww, hh, aft, S, add, box, cyl, whiteM, deckM, redM, steel, darkM, yel, glass, wallM}; shpExtras(cls, SX);
    // deck hardware: fenders, cleats, a life ring, rope, antennas, an exhaust stack, the anchor, a name board, portholes
    { const fw = S({color: 0xe8e8e4, roughness: .5}), fbl = S({color: 0x22508a, roughness: .5}), ng = Math.max(2, Math.round(L / 6));
      for (const sd of [-1, 1]) for (let i = 0; i < ng; i++) { const z = mix(BDECK.z0 + 1, zs - 1.5, i / (ng - 1)); cyl(i % 2 ? fw : fbl, .15 + L * .004, .15 + L * .004, .55 + L * .01, sd * (hullHW(z) + .12), fb - .3, z, 0, 0, 10);
        cyl(steel, .01, .01, .5, sd * (hullHW(z) + .05), fb + .1, z); }
      for (const sd of [-1, 1]) for (const z of [BDECK.z0 + .6, zs - .5]) { box(steel, sd * (hullHW(z) - .35) - .14, sd * (hullHW(z) - .35) + .14, fb, fb + .07, z - .04, z + .04); cyl(steel, .025, .03, .12, sd * (hullHW(z) - .35), fb + .06, z); }
      const lr = add(new THREE.TorusGeometry(.28, .07, 8, 20), S({color: 0xf06818, roughness: .6}), ww - .6, fb + 1.45, wz1 + .09); for (let i = 0; i < 4; i++) { const b = add(new THREE.TorusGeometry(.28, .075, 6, 4, .3), whiteM, ww - .6, fb + 1.45, wz1 + .09); b.rotation.z = i * PI / 2; }
      const rc = add(new THREE.TorusGeometry(.3, .05, 6, 18), S({color: 0x8a7050, roughness: 1}), hw - 1.1, fb + .05, zs - 1.6); rc.rotation.x = PI / 2; const rc2 = add(new THREE.TorusGeometry(.22, .05, 6, 18), S({color: 0x8a7050, roughness: 1}), hw - 1.1, fb + .14, zs - 1.6); rc2.rotation.x = PI / 2;
      for (const sx of [-.4, .4]) cyl(darkM, .012, .02, 1.6 + L * .02, sx * ww, fb + hh + .9 + L * .01, wz1 - .4);
      cyl(darkM, .14, .16, .9, -ww + .5, fb + hh + .55, wz1 - .5); cyl(S({color: 0x111111}), .145, .145, .12, -ww + .5, fb + hh + .95, wz1 - .5);
      const an = add(new THREE.BoxGeometry(.06, .6, .06), darkM, 0, fb + .3, BDECK.z0 - .9); an.rotation.x = .3; const ac = add(new THREE.TorusGeometry(.2, .03, 6, 12, PI), darkM, 0, fb + .08, BDECK.z0 - .82); ac.rotation.x = PI / 2 + .3;
      const nc = cv(512, 96, (q, w, h2) => { q.fillStyle = 'rgba(0,0,0,0)'; q.clearRect(0, 0, w, h2); q.fillStyle = cls === 7 ? '#c8a040' : '#f0ece0'; q.font = 'bold 54px Georgia'; q.textAlign = 'center'; q.fillText(['NINE LIVES', 'SALT WIFE', 'VIGILANT', 'IRON MULE', 'NAUTILUS II', 'DEEP RIGHT', 'POLAR BEAR', 'SERENADE', 'DART', 'DRIFTWOOD', 'BULLDOG', 'AURORA', 'GOLIATH'][cls] || 'NINE LIVES', w / 2, 66); });
      const nb = add(new THREE.PlaneGeometry(Math.min(W * .8, 6), Math.min(W * .8, 6) * .19), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(nc), transparent: true}), 0, fb * .6, zs + .02); nb.castShadow = false;
      if (L > 16) { const pm = S({color: 0x0a0e12, roughness: .1, emissive: 0xffd090, emissiveIntensity: 0, nc: 1}); g.userData.port = pm; for (const sd of [-1, 1]) for (let z = BDECK.z0 + 2; z < zs - 2; z += Math.max(2.2, L / 24)) { const ph = add(new THREE.CircleGeometry(.16 + L * .002, 14), pm, sd * (hullHW(z) + .02), fb * .62, z); ph.rotation.y = sd * PI / 2; ph.castShadow = false; } } }
    if (H.big) { const ss = S({color: 0xe8e6de, roughness: .5}), wm = new THREE.MeshStandardMaterial({color: 0x101418, emissive: 0xffc070, emissiveIntensity: .1, roughness: .2}); g.userData.winM = wm;
      const lv = H.tiers || (cls === 7 ? 7 : cls === 6 ? 3 : 2), TH = cls === 12 ? 3.4 : 2.8, gl = cls === 11 ? 1.3 : .8, sz0 = wz0, sz1 = cls === 7 ? zs - 14 : cls === 12 ? wz1 : wz1 + L * .12;
      for (let i = 0; i < lv; i++) { const k = 1 - i * (cls === 7 ? .05 : cls === 12 ? .04 : .08), w = ww * k, y = fb + hh + .12 + i * TH, z0 = sz0 + i * (cls === 7 ? 1.6 : cls === 12 ? .15 : .8), z1 = sz1 - i * (cls === 7 ? 3.5 : cls === 12 ? 2 : cls === 11 ? 2.4 : 1);
        box(cls === 11 ? wallM : ss, -w, w, y, y + TH, z0, z1); for (const sd of [-1, 1]) add(new THREE.BoxGeometry(.04, gl, z1 - z0 - 1), wm, sd * (w + .02), y + TH * .54, (z0 + z1) / 2); add(new THREE.BoxGeometry(w * 2 - 1, gl, .04), wm, 0, y + TH * .54, z0 - .02); }
      shpExtras(cls, Object.assign(SX, {lv, TH, sz0, sz1, ss, wm, top: fb + hh + .12 + lv * TH}), 1);
      if (cls === 7) { BW.push({x0: -ww, x1: ww, z0: wz1 + 1.6, z1: sz1, y0: 0, y1: 3}); box(ss, -ww, ww, fb, fb + hh, wz1 + 1.6, sz1); for (const sd of [-1, 1]) for (let i = 0; i < 8; i++) { const z = wz1 + 4 + i * (sz1 - wz1 - 8) / 7; cyl(S({color: 0xe06018}), .9, .9, 5, sd * (ww + .9), fb + hh + 4, z, PI / 2); }
        const fz = sz1 - (lv - 1) * 3.5 - 5; cyl(S({color: 0xc8c4b8}), 3, 3.6, 9, 0, fb + hh + lv * 2.8 + 4, fz); cyl(S({color: 0x1a3a6a}), 3.02, 3.02, 2, 0, fb + hh + lv * 2.8 + 7.5, fz);
        const pool = add(new THREE.BoxGeometry(ww, .1, 10), S({color: 0x2a8ab0, roughness: .05}), 0, fb + hh + lv * 2.8 + .2, (sz0 + sz1) / 2); }
      if (cls === 6) { for (const z of [sz1 - 5, sz1 - 1]) { cyl(S({color: 0x9a1a12}), 1.3, 1.5, 7, 0, fb + hh + lv * 2.8 + 3.5, z); cyl(darkM, 1.32, 1.32, 1, 0, fb + hh + lv * 2.8 + 6.5, z); } cyl(steel, .12, .15, 6, 0, fb + hh + lv * 2.8 + 3, sz0 + 2); const rad = add(new THREE.BoxGeometry(2.4, .15, .35), darkM, 0, fb + hh + lv * 2.8 + 6, sz0 + 2); g.userData.radar = rad; }
      if (cls === 5) { const hp = add(new THREE.CylinderGeometry(6, 6, .25, 32), S({color: 0x2a5a3a}), 0, fb + hh + lv * 2.8 + .3, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(.5, .05, 3.6), whiteM, -1, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(.5, .05, 3.6), whiteM, 1, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2); add(new THREE.BoxGeometry(2, .05, .5), whiteM, 0, fb + hh + lv * 2.8 + .45, (sz0 + sz1) / 2);
        cyl(yel, .6, .8, 6, -hw + 2, fb + 3, zs - 8); const boom = add(new THREE.BoxGeometry(.6, .6, 16), yel, -hw + 2, fb + 9, zs - 14); boom.rotation.x = .6; BW.push({x0: -hw + 1.2, x1: -hw + 2.8, z0: zs - 8.8, z1: zs - 7.2, y0: 0, y1: 3});
        for (const sd of [-1, 1]) box(yel, sd * (hw - 1.5) - .2, sd * (hw - 1.5) + .2, fb, fb + 5, zs - 1.2, zs - .8, 1); box(yel, -hw + 1.3, hw - 1.3, fb + 4.8, fb + 5.2, zs - 1.2, zs - .8); }
    }
    INTER.push({kind: 'ladder', boat: 1, lx: 0, lz: zs + 1, ly: -fb, r: 3.5, top: 'boat', label: () => 'Climb aboard', on: () => P.sw});
  } else buildSub(g, {S, glass, darkM, steel, yel, H});
  const cargo = new THREE.Group(); g.add(cargo); g.userData.cargo = cargo; g.userData.cls = cls; g.userData.sig = cls + ':' + (B.up.paint || 0);
  { const gc = cv(128, 256, (q, w, h) => { const gr = q.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.55, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, w, h); });
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(W + 5, L + 6), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0})); gm.rotation.x = -PI / 2; gm.position.set(0, .12, (zb + zs) / 2); gm.renderOrder = 3; g.add(gm); g.userData.glow = gm; }
  INTER.push({kind: 'helm', boat: 1, lx: BHELM[0], lz: BHELM[1] - .4, ly: 1, r: 2, label: () => P.seat ? 'Let go of the wheel' : 'Take the wheel', on: () => !P.sw && (P.seat || !B.driver)});
  INTER.push({kind: 'hold', boat: 1, lx: BSPOT.hold[0], lz: BSPOT.hold[1], ly: .2, r: 2.4, label: () => { const u = `${sackUsed(B.hold)}/${holdCap()} slots, $${holdValue()}`; return P.sack.some(k => k !== 'key') ? `Stow everything from your sack · hold ${u}` : B.hold.length ? `Take the ${NAMES[B.hold.includes('key') ? 'key' : B.hold[B.hold.length - 1]]} out · hold ${u}` : `Cargo hold (empty, ${holdCap()} slots)`; }, on: () => !P.sw});
  if (0) INTER.push({kind: 'fuelcap', boat: 1, lx: BSPOT.fuel[0], lz: BSPOT.fuel[1], ly: .2, r: 1.8, label: () => (P.sack || []).includes('fuel') ? 'Pour a fuel drum into the tank' : `Fuel tank: ${Math.round(B.fuel)}/${tankMax()}`, on: () => !P.sw});
  INTER.push({kind: 'patchbox', boat: 1, lx: BSPOT.patch[0], lz: BSPOT.patch[1], ly: .2, r: 1.8, label: () => (P.sack || []).includes('patch') || B.hold.includes('patch') ? 'Patch the hull' : `Hull: ${Math.round(B.hull)}/${hullMax()} (bring a patch kit)`, on: () => !P.sw});
  // bake everything static into one mesh per material (the wheel, prop, radar, cat, gun, glow and cargo stay live; the painted hull keeps its own)
  { g.updateMatrixWorld(true); const live = new Set(), inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), list = [], gone = [];
    for (const k in g.userData) { const o = g.userData[k]; if (o && o.isObject3D) o.traverse(q => live.add(q)); }
    g.traverse(o => { if (!o.isMesh || live.has(o) || o.material.vertexColors || (o.material.transparent && o.material !== glass)) return; const q = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); q.applyMatrix4(_m4.multiplyMatrices(inv, o.matrixWorld)); list.push([q, o.material, o.castShadow]); gone.push(o); });
    for (const o of gone) { o.parent.remove(o); o.geometry.dispose(); } for (const m of mergeByMat(list)) (BG.sub && m.material.userData.inner ? SUBC.inner : g).add(m); if (BG.sub) subDone(g); }
  scene.add(g); BOAT = g;
}
function boatStep(dt) {
  if (B.sink > 0) { B.sink -= dt; B.v *= .95; if (B.sink <= 0) resetBoat(true); return; }
  const drv = B.driver && PL.get(B.driver); let thr = 0, st = 0;
  if (drv && drv.seat && !drv.down && !drv.dead) { if (drv !== P && drv.poseT != null && performance.now() - drv.poseT > 800) { drv.in = [0, 0, 0]; B.thr = 0; } thr = drv.in ? drv.in[0] : 0; st = drv.in ? drv.in[1] : 0; } else if (B.driver) B.driver = null;
  const lv = B.up.engine, empty = B.fuel <= 0, H = HC();
  const m = Math.pow(H.L / 12.2, .6); B.thr = mix(B.thr, thr * (empty ? .18 : 1), Math.min(1, dt * 1.2 / Math.sqrt(m))); B.st = mix(B.st, st, Math.min(1, dt * 2.5));
  B.fuel = tankMax();
  const acc = (B.thr > 0 ? B.thr * (2.4 + lv * .7) : B.thr * 1.2) * H.spd, drag = .028 / (1 + lv * .25) / H.spd;
  B.v += (acc - drag * B.v * Math.abs(B.v) - (Math.abs(B.thr) < .05 ? .25 * B.v : 0)) / m * dt;
  const yrT = -B.st * clamp(B.v / 3.5, -1, 1) * .5 * H.turn + (H.L > 30 ? -B.st * .035 * (1 - clamp(Math.abs(B.v) / 3, 0, 1)) : 0);
  B.yr = mix(B.yr || 0, yrT, Math.min(1, dt * 2.2 / m)); B.yaw += B.yr * dt;
  if (H.sub) subDive(drv, dt); else B.dep = B.dtar = 0;
  B.x += -Math.sin(B.yaw) * B.v * dt; B.z += -Math.cos(B.yaw) * B.v * dt;
  if (H.sub) subGround();
  let hit = 0;
  const r = BG.hw * .95, n = Math.max(3, Math.ceil((BG.zs - BG.zb - r * 2) / 3));
  for (let ci = 0; ci <= n; ci++) { const lz = mix(BG.zb + r * .9, BG.zs - r * .6, ci / n);
    const [cx, cz] = bL2W(0, lz);
    for (const o of OBST) {
      let d, nx, nz;
      if (o.ice && HC().ice) continue;
      if (o.c) { if (Math.abs(cx - o.x) > o.r + r || Math.abs(cz - o.z) > o.r + r) continue; const px = cx - o.x, pz = cz - o.z, e = Math.hypot(px, pz); if (e >= o.r + r) continue; nx = px / e; nz = pz / e; d = o.r + r - e; }
      else { const qx = clamp(cx, o.x0, o.x1), qz = clamp(cz, o.z0, o.z1), px = cx - qx, pz = cz - qz, e = Math.hypot(px, pz); if (e >= r) continue; if (e < 1e-4) { const l = cx - o.x0, rt = o.x1 - cx, t = cz - o.z0, b = o.z1 - cz, mn = Math.min(l, rt, t, b); nx = mn === l ? -1 : mn === rt ? 1 : 0; nz = nx ? 0 : mn === t ? -1 : 1; d = mn + r; } else { nx = px / e; nz = pz / e; d = r - e; } }
      B.x += nx * d; B.z += nz * d; hit = Math.max(hit, Math.abs(B.v));
    }
  }
  const rr = Math.hypot(B.x - MAP_C.x, B.z - MAP_C.z); if (rr > MAP_R) { B.x = MAP_C.x + (B.x - MAP_C.x) * MAP_R / rr; B.z = MAP_C.z + (B.z - MAP_C.z) * MAP_R / rr; hit = Math.max(hit, Math.abs(B.v)); }
  if (hit) { if (hit > 2.5) { emit({k: 'bump', s: Math.min(1, hit / 7)}); if (hit > 3.5) damageBoat((hit - 3) * 4); } B.v *= .4; }
  if (voyPortNear(B.x, B.z, 30 + BG.L * .5) && Math.abs(B.v) < 2) { B.fuel = Math.min(tankMax(), B.fuel + dt * 10); B.hull = Math.min(hullMax(), B.hull + dt * 6); }
}
function damageBoat(n) { if (B.sink > 0) return; B.hull = Math.max(0, B.hull - n); if (n >= .5) emit({k: 'hdmg', n: Math.round(n)}); if (B.hull <= 0) { B.sink = 4.5; B.driver = null; B.yr = 0; emit({k: 'sink'}); } }
function resetBoat(sunk) {
  const wasX = B.x, wasZ = B.z;
  Object.assign(B, {x: JETTY.x - 2.1 - BG.hw, z: JETTY.z + 3 + Math.max(0, BG.L - 12) * .5, yaw: PI, v: 0, yr: 0, trim: 0, thr: 0, st: 0, driver: null, sink: 0, dep: 0, dtar: 0}); B.hull = Math.max(B.hull, hullMax() * .6); B.fuel = Math.max(B.fuel, tankMax() * .4);
  Object.assign(LK, {st: 0, t: 0, w: 0, ent: -1, tw: 0, wv: 0}); B.hat = 1; SUBC.dq = 0;
  if (sunk) { B.hold = []; emit({k: 'boatback', x: wasX, z: wasZ}); }
}
// ---------------- boat feel and sound: one engine voice per hull, sea legs, water on the hull, a small score
const ENGV = [
  {f: [70, 150], lp: [700, 1600], am: .15, fr: 1, nz: .04, g: .10},
  {f: [22, 40], lp: [240, 520], am: .7, g: .14},
  {f: [50, 100], lp: [400, 1200], am: .3, whine: [1400, 2700], g: .12},
  {f: [14, 26], lp: [150, 320], am: .8, fr: .35, g: .2},
  {elec: 1, f: [110, 140], lp: [2400, 3200], am: 0, nz: 0, whine: [900, 1300], g: .08},
  {f: [13, 24], lp: [150, 320], am: .8, fr: .35, g: .2},
  {f: [12, 22], lp: [150, 320], am: .8, fr: .35, g: .2},
  {f: [9, 16], lp: [120, 240], am: .5, g: .2, hiss: 1},
];
// the body sways with the boat: a spring in boat-local metres pushed by turns, throttle and hits (G.shake jumps)
function seaLegs(dt) {
  dt = Math.max(dt, 1e-3); if (!G.sl) { G.sl = {x: 0, z: 0, vx: 0, vz: 0, a: 0, l: 0, s: G.shake || 0}; G.pv = B.v; } const S = G.sl;
  const ax = (B.v - G.pv) / dt; G.pv = B.v; S.a = mix(S.a, clamp(ax, -60, 60), Math.min(1, dt * 8)); S.l = mix(S.l, (B.yr || 0) * B.v, Math.min(1, dt * 6));
  const j = (G.shake || 0) - S.s; S.s = G.shake || 0; if (j > .2) { S.vz -= j * 1.6; S.vx += (Math.random() - .5) * j * 2.4; }
  S.vx += ((clamp(S.l * .015, -.15, .15) - S.x) * 30 - S.vx * 9) * dt; S.vz += ((clamp(S.a * .012, -.15, .15) - S.z) * 30 - S.vz * 9) * dt;
  S.x = clamp(S.x + S.vx * dt, -.3, .3); S.z = clamp(S.z + S.vz * dt, -.3, .3);
  const h = P.seat ? .5 : 1, lx = S.x * h, lz = S.z * h, c = Math.cos(B.yaw), s = Math.sin(B.yaw), rel = P.yaw - B.yaw;
  return [lx * c + lz * s, -lx * s + lz * c, (lx * Math.cos(rel) - lz * Math.sin(rel)) * .3];
}
// camera distance to the nearest shore (island, lighthouse), cached for half a second
function shoreDist() { const n = performance.now(); if (G.sdV != null && n - G.sdT < 500) return G.sdV; const p = cam.position; let d = Math.hypot(p.x - HOME.x, p.z - HOME.z) - HOME.r; for (const o of OBST) if (o.c && o.r > 5) d = Math.min(d, Math.hypot(p.x - o.x, p.z - o.z) - o.r); G.sdT = n; return (G.sdV = Math.max(0, d)); }
// engine, water, bilge alarm, dock repairs and the sub's tanks; gains fade out on their own if frames stop
function boatAudio(dt, t) {
  const c = A.ctx, E = A.E; if (!E) return;
  if ((E.rs = (E.rs || 0) - dt) <= 0) { E.rs = 1; if (c.state === 'interrupted' || (c.state === 'suspended' && !G.paused)) { const r = c.resume(); if (r && r.catch) r.catch(() => {}); } }
  const sT = (prm, v, tc = .15) => { prm.cancelScheduledValues(t); prm.setTargetAtTime(v, t, tc); prm.setTargetAtTime(0, t + .6, .25); }, cls = B.up.cls || 0;
  if (E.cls !== cls) { E.cls = cls; const V = E.V = Object.assign({f: [40, 70], lp: [300, 800], am: .3, fr: .5, nz: .025, g: .12}, ENGV[cls] || ENGV[0]);
    E.o1.type = V.elec ? 'sine' : 'sawtooth'; E.o2.type = V.elec ? 'sine' : 'square'; E.g1.gain.value = V.elec ? .45 : .42; E.g2.gain.value = V.elec ? .3 : .2; E.g3.gain.value = V.elec ? 0 : .5; E.pre.gain.value = V.elec ? .6 : 1.4; E.am.gain.value = 1 - V.am / 2; E.dep.gain.value = V.am / 2; }
  const V = E.V, on = !!B.driver && B.sink <= 0;
  if (on && !E.drv) { E.st = .36; if (V.elec) tone(240, .04, .9, 'sine', A.bPan, 1100); else for (let i = 0; i < 3; i++) setTimeout(() => burst(180, 1, .25, .1, 'lowpass', A.bPan), i * 120); }
  E.drv = on; E.st = Math.max(0, E.st - dt); E.k = on ? (E.st > 0 ? E.k : Math.min(1, E.k + dt / .8)) : Math.max(0, E.k - dt / 2);
  const a = Math.abs(B.thr), k = B.sink > 0 ? 0 : E.k, cab = inCabin() && (HC().big || cls === 3), f = mix(V.f[0], V.f[1], a) * (1 + B.up.engine * .05) * (1 + Math.sin(G.wt * 2.3) * .012 + Math.sin(G.wt * 5.1) * .006) * (.55 + .45 * k);
  E.o1.frequency.setTargetAtTime(f, t, .12); E.o2.frequency.setTargetAtTime(f * (V.elec ? 2 : 2.01), t, .12); E.o3.frequency.setTargetAtTime(f / 2, t, .12); E.lfo.frequency.setTargetAtTime(Math.max(.5, f * V.fr), t, .12);
  A.engF.frequency.setTargetAtTime(mix(V.lp[0], V.lp[1], a) * (cab ? 1.6 : 1), t, .15); sT(A.engG.gain, V.g * k * (.38 + .62 * a) * (cab ? 1.41 : 1));
  E.ex.f.frequency.setTargetAtTime(mix(180, 400, a), t, .15); sT(E.ex.g.gain, V.nz * k * (.4 + .6 * a)); sT(E.hs.g.gain, V.hiss ? .018 * k * (.5 + .5 * a) : 0);
  if (V.whine) E.wo.frequency.setTargetAtTime(mix(V.whine[0], V.whine[1], a), t, .2); sT(E.wg.gain, V.whine ? (V.elec ? .016 * (.35 + .65 * a) : .011 * a * a) * k : 0);
  // water against the hull, lapping when still
  const sp = Math.abs(B.v), dp = B.dep || 0, [wx, wz] = bL2W(0, BG.zb + BG.L * .15); setPan(A.wPan, wx, .5, wz);
  const wv = Math.pow(clamp(sp / 9, 0, 1), 1.5) * .14 * (inCabin() ? .35 : 1) * (dp > .6 ? 0 : 1);
  sT(A.wash.g.gain, wv, .2); A.wash.f.frequency.setTargetAtTime(380 + sp * 45, t, .2); sT(A.hiss.g.gain, wv * .45, .2);
  if (P && !P.sw && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 6) && sp < 1.2 && dp < .6 && B.sink <= 0 && (E.lap = (E.lap ?? 1) - dt) <= 0) { E.lap = .6 + Math.random(); burst(620 + Math.random() * 200, 2, .03 * (.7 + Math.random() * .5), .2); }
  // bilge alarm below a quarter hull, two soft tones at the helm
  const low = P && P.ob && B.sink <= 0 && B.hull < hullMax() * .25; if (low) { A.bilge.o.frequency.value = Math.floor(G.wt / .45) % 2 ? 880 : 660; const [hx, hz] = bL2W(BHELM[0], BHELM[1]); setPan(A.bilge.p, hx, (BHELM[2] ?? BDECK.y) + 1 + B.heave, hz); } sT(A.bilge.g.gain, low && G.wt % .45 < .36 ? .015 : 0, .02);
  // the dock crew hammers while the hull fills back up, then a chime
  const dh = B.hull - (E.hp ?? B.hull); E.hp = B.hull; if (dh > 0 && dh < 5 && Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 35 + BG.L * .5) E.rep = .9;
  if (E.rep > 0) { E.rep -= dt; if (B.hull >= hullMax() - .05) { E.rep = 0; const p = at(B.x, 1.5, B.z, 8); tone(1175, .05, .5, 'triangle', p); setTimeout(() => tone(1568, .05, .8, 'triangle', p), 130); } else if ((E.hmT = (E.hmT || 0) - dt) <= 0) { E.hmT = .35; burst(1500, 4, .06, .04, 'bandpass', at(B.x + (Math.random() - .5) * BG.W, 1.2, B.z + (Math.random() - .5) * BG.L * .5, 5)); } }
  // the sub: vents flood the tanks, air blows them, the pressure hull groans
  if (BG.sub) { const dtr = B.dtar || 0; if (dtr < .1) E.va = 1; else if (dtr > .5 && E.va) { E.va = 0; if (Snd.vent) Snd.vent(A.bPan); }
    if (dp > 1.5) E.bl = 1; else if (dp < .5 && E.bl) { E.bl = 0; burst(1600, .7, .25, 1.5, 'highpass', A.bPan); }
    if (dp > 3 && (E.gr = (E.gr ?? 12) - dt) <= 0) { E.gr = 10 + Math.random() * 15; if (Snd.groan) Snd.groan(A.bPan, dp / 20); }
    subAudio(dt, t, sT); }
}
// a small score on its own bus: plucked pentatonic phrases by day, slow chords at golden hour and sunset, low notes over the night pad, tremolo in storms
const Mus = {ph: null, ci: -1, cn: 0, nx: 0, bn: 0, q: [], son: false, sp: null, spT: 0, thT: 0, gold: false,
  CH: [[73.42, 146.83, 220, 277.18, 369.99], [61.74, 123.47, 185, 220, 277.18], [49, 146.83, 246.94, 293.66, 369.99], [55, 164.81, 220, 293.66, 329.63]],
  PEN: [146.83, 164.81, 185, 220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33],
  // pluck: a 15 ms noise burst into a delay line of 1/f with averaged feedback (Karplus-Strong), rendered once per note into a buffer so the pitch is exact
  kb: {},
  ks(f) { const k = f.toFixed(2); if (Mus.kb[k]) return Mus.kb[k]; const sr = 22050, n = sr * 2, b = A.ctx.createBuffer(1, n, sr), d = b.getChannelData(0), D = sr / f - .5, ne = sr * .015 | 0; let pk = 0, r = 0;
    for (let i = 0; i < n; i++) { const t = i - D, j = Math.floor(t), u = t - j; let y = 0; if (j >= 1) y = .5 * ((d[j] + d[j - 1]) * (1 - u) + (d[j + 1] + d[j]) * u) * .985; if (i < ne) { r = r * .5 + (Math.random() * 2 - 1) * .5; y += r * (1 - i / ne); } d[i] = y; pk = Math.max(pk, Math.abs(y)); }
    for (let i = 0; i < n; i++) d[i] /= pk || 1; return (Mus.kb[k] = b); },
  pluck(f, T, v) { const c = A.ctx, s = c.createBufferSource(), g = c.createGain(); s.buffer = Mus.ks(f); g.gain.value = v * .45; s.connect(g); g.connect(A.mus); s.start(T); },
  note(f, T, dur, pk, type = 'sine') { const c = A.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(pk, T + Math.min(.4, dur * .3)); g.gain.linearRampToValueAtTime(0, T + dur); o.connect(g); g.connect(A.mus); o.start(T); o.stop(T + dur + .05); },
  step(dt) {
    const M = Mus, U = A.MU; if (!U) return; const c = A.ctx, t = c.currentTime, cp = cam.position, td = G.tod;
    const quiet = (P && P.fear > .45) || !!G.spines || inCruise(cp.x, cp.z, cp.y) || (G.uw || 0) > .3, far = Math.hypot(cp.x - HOME.x, cp.z - HOME.z) > 900 ? 1.8 : 1;
    const ph = td < .14 ? 0 : td < .24 ? 1 : td < .34 ? 2 : td < .8 ? 3 : td < .9 ? 4 : 0, mood = G.storm > .45 ? 'storm' : td < .25 ? 'gold' : td < .82 ? 'night' : 'day';
    A.mus.gain.cancelScheduledValues(t); A.mus.gain.setTargetAtTime(quiet ? 0 : .8, t, quiet ? .5 : 2.5); A.mus.gain.setTargetAtTime(0, t + .8, .4);
    // stingers: a warm swell at sunset, a relief phrase at dawn, distant thunder when a storm starts
    if (M.ph == null) M.ph = ph; else if (ph !== M.ph) { M.ph = ph;
      if (!quiet && ph === 1) { M.ci = 0; M.CH[0].forEach((f, i) => U.ch[i].frequency.setTargetAtTime(f, t, .6)); U.cg.gain.cancelScheduledValues(t); U.cg.gain.setTargetAtTime(.075, t, 1.2); U.cg.gain.setTargetAtTime(.02, t + 4.5, 2); M.cn = t + 10; M.gold = true; M.note(587.33, t + .6, 3.6, .012); M.note(880, t + 1.4, 3, .008); }
      if (!quiet && ph === 4) [[293.66, 0, 1.4], [440, 1, 1.4], [369.99, 2, 1.4], [440, 3, 1.9]].forEach(([f, o, d]) => { M.note(f, t + .2 + o, d, .03, 'triangle'); M.note(f * 2, t + .2 + o, d * .8, .006); }); }
    if ((M.spT -= dt) <= 0) { M.spT = 1; const rise = M.sp != null && G.storm > M.sp + 2e-4 && G.storm < .5; if (rise && !M.son && t > M.thT) { M.thT = t + 60; burst(70, .5, .5, 4, 'lowpass', null, .4); setTimeout(() => burst(140, .5, .22, 2.6, 'lowpass', null, .5), 450); setTimeout(() => burst(55, .5, .3, 3.2, 'lowpass', null, .35), 1300); } M.son = rise; M.sp = G.storm; }
    // golden hour and sunset: Dmaj7, Bm9, Gmaj7, Asus4, ten seconds each
    if (mood === 'gold') { if (t >= M.cn) { M.ci = (M.ci + 1) % 4; M.CH[M.ci].forEach((f, i) => U.ch[i].frequency.setTargetAtTime(f, t, .9)); U.cg.gain.cancelScheduledValues(t); U.cg.gain.setTargetAtTime(.034, t + .6, 1.8); U.cg.gain.setTargetAtTime(.011, t + 7.5, 1.4); M.cn = t + 10.5; M.gold = true; } }
    else if (M.gold) { M.gold = false; U.cg.gain.cancelScheduledValues(t); U.cg.gain.setTargetAtTime(0, t, 2.5); M.cn = 0; }
    // day: 4-8 plucked notes at 68 bpm, then 15-40 s of nothing (longer far from home)
    if (mood === 'day' && !quiet) { if (!M.q.length && t >= M.nx) { const n = 4 + (Math.random() * 5 | 0), b = 60 / 68; let T = t + .3, i = 4 + (Math.random() * 4 | 0); for (let k = 0; k < n; k++) { i = k === n - 1 ? [3, 5, 8][Math.random() * 3 | 0] : clamp(i + [-2, -1, -1, 1, 1, 2, 0][Math.random() * 7 | 0], 0, M.PEN.length - 1); M.q.push([T, M.PEN[i], .22 + Math.random() * .12]); T += b * [.5, 1, 1, 1.5, 2][Math.random() * 5 | 0]; } M.nx = T + (15 + Math.random() * 25) * far; } }
    else M.q.length = 0;
    while (M.q.length && M.q[0][0] < t + .25) { const [T, f, v] = M.q.shift(); M.pluck(f, Math.max(T, t + .01), v); }
    // night: one low note every 8-12 s over the pad
    if (mood === 'night' && !quiet && t >= M.bn) { M.bn = t + (8 + Math.random() * 4) * far; U.bo.frequency.setValueAtTime([73.42, 55, 61.74, 82.41, 92.5][Math.random() * 5 | 0], t + .1); const g = U.bg.gain; g.cancelScheduledValues(t); g.setValueAtTime(0, t + .1); g.linearRampToValueAtTime(.07, t + 1.4); g.linearRampToValueAtTime(0, t + 6.5); }
    // storm: tremolo low saws
    U.sg.gain.setTargetAtTime(mood === 'storm' && !quiet ? .035 * clamp((G.storm - .45) * 3, 0, 1) : 0, t, 1.5);
  },
};

// ---------------- the research sub: a walk-in pressure hull under a casing and sail. The trunk hatch, the bow viewport and pilot seat, the control room, bunks and galley,
// the cargo racks, a diver lock-out chamber and the motor room. Interior materials skip the sun and fog while you are inside (subHook), lit by two pooled lamps
function uvBox(q, s) { const p = q.attributes.position, n = q.attributes.normal, uv = q.attributes.uv; for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (ay >= ax && ay >= az) uv.setXY(i, x * s, z * s); else if (ax >= az) uv.setXY(i, z * s, y * s); else uv.setXY(i, x * s, y * s); } uv.needsUpdate = true; return q; }
function uvS(q, su, sv) { const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return q; }
function uvRow(q, r, n = 8) { const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (r + 1) / n + uv.getY(i) / n); return q; }
// a box stretched between two end rectangles a, b = [z, x0, x1, y0, y1] (fairings, fins)
function loft(a, b) { const q = new THREE.BoxGeometry(1, 1, 1), p = q.attributes.position; for (let i = 0; i < p.count; i++) { const e = p.getZ(i) < 0 ? a : b; p.setXYZ(i, p.getX(i) < 0 ? e[1] : e[2], p.getY(i) < 0 ? e[3] : e[4], e[0]); } q.computeVertexNormals(); return q; }
function subHook(sh) { Object.assign(sh.uniforms, SUBC.U); const C = THREE.ShaderChunk;
  sh.fragmentShader = 'uniform float uFogK, uKey, uHemi; uniform vec3 uFill;\n' + sh.fragmentShader
    .replace('#include <lights_fragment_begin>', C.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= uKey;').replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )', 'getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * uHemi'))
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uFill * diffuseColor.rgb;')
    .replace('#include <fog_fragment>', C.fog_fragment.replace('fogFactor );', 'fogFactor * uFogK );')); }
function subMat(m) { if (!m.userData.inner) { m.userData.inner = 1; m.onBeforeCompile = subHook; } return m; }
function subTex() {
  if (TX.subLn) return;
  TX.subLn = tex(cv(256, 256, (q, w, h) => { q.fillStyle = '#cdcbb2'; q.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { q.fillStyle = `rgba(${Math.random() < .5 ? '255,255,240' : '90,90,70'},${.03 + Math.random() * .05})`; q.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
    q.fillStyle = '#8a8a72'; for (let i = 0; i <= w; i += 64) { q.fillRect(i - 1, 0, 2, h); q.fillRect(0, i - 1, w, 2); } q.fillStyle = '#76766a'; for (let i = 0; i < w; i += 64) for (let j = 6; j < h; j += 12) { q.fillRect(i + 4, j, 2, 2); q.fillRect(j, i + 4, 2, 2); } noiseFill(q, w, h, 10); }));
  TX.dia = tex(cv(128, 128, (q, w, h) => { q.fillStyle = '#3c4042'; q.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 8; x < w; x += 16) { q.save(); q.translate(x + 4, y + 4); q.rotate(y / 8 % 2 ? .6 : -.6); q.fillStyle = '#6c7274'; q.fillRect(-4, -1, 8, 2.2); q.fillStyle = '#25282a'; q.fillRect(-4, 1.2, 8, 1); q.restore(); } noiseFill(q, w, h, 16); }));
  TX.subPan = tex(cv(128, 128, (q, w, h) => { q.fillStyle = '#5d6c64'; q.fillRect(0, 0, w, h); q.strokeStyle = 'rgba(20,30,25,.6)'; q.lineWidth = 2; q.strokeRect(2, 2, w - 4, h - 4); q.strokeStyle = 'rgba(200,220,210,.18)'; q.strokeRect(5, 5, w - 10, h - 10); q.fillStyle = '#2a302c'; for (const [x, y] of [[9, 9], [w - 11, 9], [9, h - 11], [w - 11, h - 11]]) { q.beginPath(); q.arc(x + 1, y + 1, 2.5, 0, TAU); q.fill(); } noiseFill(q, w, h, 12); }));
  TX.gface = tex(cv(128, 128, (q) => { q.fillStyle = '#222'; q.fillRect(0, 0, 128, 128); q.fillStyle = '#efe9da'; q.beginPath(); q.arc(64, 64, 60, 0, TAU); q.fill(); q.strokeStyle = '#222'; for (let i = 0; i <= 10; i++) { const t = (-135 + 27 * i) * PI / 180 - PI / 2; q.lineWidth = i % 5 ? 2 : 4; q.beginPath(); q.moveTo(64 + Math.cos(t) * 44, 64 + Math.sin(t) * 44); q.lineTo(64 + Math.cos(t) * 54, 64 + Math.sin(t) * 54); q.stroke(); } q.strokeStyle = '#c02010'; q.lineWidth = 4; q.beginPath(); q.moveTo(64, 64); q.lineTo(64 + Math.cos(-.6) * 44, 64 + Math.sin(-.6) * 44); q.stroke(); q.fillStyle = '#222'; q.beginPath(); q.arc(64, 64, 6, 0, TAU); q.fill(); }));
  TX.haz = tex(cv(64, 16, (q, w, h) => { q.fillStyle = '#d8a820'; q.fillRect(0, 0, w, h); q.fillStyle = '#151515'; for (let i = -16; i < w + 16; i += 16) { q.beginPath(); q.moveTo(i, h); q.lineTo(i + 8, h); q.lineTo(i + 16, 0); q.lineTo(i + 8, 0); q.fill(); } }));
  TX.nslip = tex(cv(128, 128, (q, w, h) => { q.fillStyle = '#34383a'; q.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = 30 + Math.random() * 70 | 0; q.fillStyle = `rgb(${v},${v + 3},${v + 4})`; q.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }));
  TX.subSign = tex(cv(256, 256, (q, w) => { [['NAUTILUS II', '#16191b', '#e8e4d6'], ['AIRLOCK', '#d8b020', '#141414'], ['MAIN BALLAST', '#2a2f2c', '#e0d8b8'], ['SONAR', '#2a2f2c', '#9affc0'], ['BATTERY ROOM', '#d8b020', '#141414'], ['EMERGENCY BLOW', '#a01a12', '#f4ece0'], ['KEEP SHUT AT SEA', '#2a2f2c', '#e0d8b8'], ['MIND YOUR HEAD', '#d8b020', '#141414']].forEach(([t, b, f], i) => { q.fillStyle = b; q.fillRect(0, i * 32, w, 32); q.fillStyle = f; q.font = `bold ${i ? 19 : 22}px ${i ? 'Arial, sans-serif' : 'Georgia, serif'}`; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(t, w / 2, i * 32 + 17); }); }));
  const ct = (k, w, h) => { SUBC[k] = cv(w, h, q => { q.fillStyle = '#000c05'; q.fillRect(0, 0, w, h); }); const t = SUBC[k + 'T'] = new THREE.CanvasTexture(SUBC[k]); t.colorSpace = THREE.SRGBColorSpace; };
  ct('son', 256, 256); ct('dep', 128, 128); ct('ind', 128, 64);
  SUBC.U = {uFogK: {value: 1}, uKey: {value: 0}, uHemi: {value: .2}, uFill: {value: new THREE.Color()}};
}
function buildSub(g, o) {
  subTex(); const {S, glass, darkM, steel, yel, H} = o, U = SUB, {R, Ri, cy, zB, zE, FI, OH, CAS, TR, LKR, LD, cx, cz0, cz1} = U, TRZ = TR.z, sx = U.SAIL.x;
  const inner = SUBC.inner = new THREE.Group(); g.add(inner);
  const sm = S({color: (PAINTS[B.up.paint || 0] || PAINTS[0]).c || H.col, roughness: .35, metalness: .3});
  const SI = q => subMat(S(Object.assign({name: 'si', envMapIntensity: .15}, q))), NC = q => subMat(S(Object.assign({nc: 1, envMapIntensity: .15}, q)));
  const put = (par, cs) => (geo, m, uv) => { if (uv) uvBox(geo, uv); const q = new THREE.Mesh(geo, m); q.castShadow = cs && m !== glass; q.receiveShadow = true; par.add(q); return q; }, ia = put(inner, false), ea = put(g, true);
  const bx = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const ib = (m, x0, x1, y0, y1, z0, z1, uv) => ia(bx(x0, x1, y0, y1, z0, z1), m, uv), eb = (m, x0, x1, y0, y1, z0, z1, uv) => ea(bx(x0, x1, y0, y1, z0, z1), m, uv);
  const cY = (r0, r1, y0, y1, x, z, n = 12, open) => new THREE.CylinderGeometry(r1, r0, y1 - y0, n, 1, !!open).translate(x, (y0 + y1) / 2, z);
  const cZ = (r0, r1, z0, z1, x, y, n = 12, open) => new THREE.CylinderGeometry(r1, r0, z1 - z0, n, 1, !!open).rotateX(PI / 2).translate(x, y, (z0 + z1) / 2);
  const cX = (r, x0, x1, y, z, n = 8) => new THREE.CylinderGeometry(r, r, x1 - x0, n).rotateZ(PI / 2).translate((x0 + x1) / 2, y, z);
  const sph = (r, x, y, z, n = 10) => new THREE.SphereGeometry(r, n, Math.max(4, n * .7 | 0)).translate(x, y, z);
  const tor = (r, t, x, y, z, ax = 'z', n = 20) => { const q = new THREE.TorusGeometry(r, t, 6, n); if (ax === 'x') q.rotateY(PI / 2); else if (ax === 'y') q.rotateX(PI / 2); return q.translate(x, y, z); };
  const pl = (w, h, x, y, z, ry = 0, rx = 0) => { const q = new THREE.PlaneGeometry(w, h); if (rx) q.rotateX(rx); if (ry) q.rotateY(ry); return q.translate(x, y, z); };
  const piv = (par, x, y, z, m, geos, cs) => { const gp = new THREE.Group(); gp.position.set(x, y, z); par.add(gp); const q = new THREE.Mesh(mergeGeos(geos), m); q.castShadow = !!cs; q.receiveShadow = true; gp.add(q); return gp; };
  const spr = (c, s, x, y, z, par = g) => { const q = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); q.scale.setScalar(s); q.position.set(x, y, z); par.add(q); return q; };
  // walls: absolute boat-frame heights; interior ones only stop crew aboard, ext ones only stop swimmers and divers
  const Wl = (x0, x1, z0, z1, y0 = FI, y1 = OH, f = {int: 1}) => BW.push(Object.assign({x0, x1, z0, z1, y0: y0 - CAS, y1: y1 - CAS}, f));
  // ---- outside: the pressure hull (open on top under the casing), the acrylic bow dome in its bolted ring, floodlights, skids, the chin sonar
  const zinc = S({color: 0x9aa4a8, metalness: .5, roughness: .55}), recM = S({color: 0x05080a, roughness: .9}), nsM = S({map: TX.nslip, color: 0x8a8e90, roughness: .95, metalness: .1}), sgM = S({map: TX.subSign, roughness: .6}), stD = S({color: 0x5a6068, metalness: .6, roughness: .4, side: THREE.DoubleSide});
  const lensM = S({nc: 1, color: 0xfff6e0, emissive: 0xfff0c8, emissiveIntensity: .2}), lkLampM = S({nc: 1, color: 0x101010, emissive: 0x30ff50, emissiveIntensity: 1.5});
  const lathe = (pts, a0, aL, n = 40) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), n, a0, aL).rotateX(PI / 2).translate(0, cy, 0);
  ea(lathe([[1.96, zB], [2.4, zB + .01], [R, zB + .1], [R, cz0]], 0, TAU), sm); ea(lathe([[R, cz0], [R, U.zA]], PI + .5, TAU - 1, 36), sm);
  { const tp = [[R, U.zA]]; for (let i = 1; i <= 12; i++) { const u = i / 12; tp.push([.55 + 1.95 * (1 - Math.pow(u, 1.6)), U.zA + u * 2.6]); } tp.push([.4, 10.3], [.22, 10.38], [0, 10.4]); ea(lathe(tp, 0, TAU), sm); }
  for (const z of [-6.2, .4, 6.4]) ea(tor(R + .004, .03, 0, cy, z, 'z', 48), darkM);
  ea(tor(2.18, .2, 0, cy, zB, 'z', 44), steel); for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; ea(cZ(.04, .04, zB - .25, zB - .17, Math.sin(a) * 2.18, cy + Math.cos(a) * 2.18, 6), darkM); }
  ea(new THREE.SphereGeometry(U.dR, 32, 16, 0, TAU, 0, PI / 2).rotateX(-PI / 2).translate(0, cy, zB), glass);
  ea(new THREE.SphereGeometry(.5, 14, 8, 0, TAU, 0, PI / 2).scale(1, .6, 1.4).rotateX(PI).translate(0, -3.32, -9.7), darkM);
  for (const s of [-1, 1]) { eb(darkM, s * 1.25 - .08, s * 1.25 + .08, -3.58, -3.05, -8.6, 6.2); for (const z of [-8, -2, 4]) eb(darkM, s * 1.25 - .05, s * 1.25 + .05, -3.3, -2.9, z - .1, z + .1); }
  for (const a of [PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]) { const x = Math.sin(a) * 2.38, y = cy + Math.cos(a) * 2.38; ea(cZ(.15, .13, zB - .4, zB - .05, x, y, 12), darkM); ea(new THREE.CircleGeometry(.11, 14).rotateY(PI).translate(x, y, zB - .405), lensM); }
  { const geos = []; for (const s of [-1, 1]) geos.push(new THREE.ConeGeometry(1.9, 12, 16, 1, true).translate(0, -6, 0).rotateX(PI / 2 - .22).rotateY(s * -.12).translate(s * 1.68, cy - 1.68, zB - .42)); const bm = new THREE.Mesh(mergeGeos(geos), beamMat(0xd8ecff, .3)); bm.visible = false; bm.renderOrder = 4; g.add(bm); g.userData.beams = bm; }
  { const n = 160, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) pos.set([(Math.random() - .5) * 9, cy - 3.5 + Math.random() * 5.5, -12.8 - Math.random() * 12], i * 3); // drifting motes in the floodlights
    const gq = new THREE.BufferGeometry(); gq.setAttribute('position', new THREE.BufferAttribute(pos, 3)); const mo = new THREE.Points(gq, new THREE.PointsMaterial({map: TX.glow, color: 0xb8d8e0, size: .08, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending})); mo.frustumCulled = false; mo.visible = false; g.add(mo); g.userData.motes = mo; }
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; ea(new THREE.BoxGeometry(.12, .07, .3).translate(0, 2.36, 0).rotateZ(a).translate(0, cy, 8.15), zinc); ea(new THREE.BoxGeometry(.14, .07, .34).translate(0, R + .03, 0).rotateZ(a + PI / 4).translate(0, cy, -10.1), zinc); }
  // casing with a non-slip walkway, limber holes and lifelines (a gap at the boarding ladder); tapered fairings fore and aft
  const ch = .45; eb(sm, -cx, cx, 1.1, CAS, cz0, TRZ - ch); eb(sm, -cx, cx, 1.1, CAS, TRZ + ch, cz1); eb(sm, -cx, -ch, 1.1, CAS, TRZ - ch, TRZ + ch); eb(sm, ch, cx, 1.1, CAS, TRZ - ch, TRZ + ch);
  ea(loft([cz0 - 1.35, -.75, .75, 1.0, 1.4], [cz0, -cx, cx, 1.1, CAS]), sm); ea(loft([cz1, -cx, cx, 1.1, CAS], [9.75, -.3, .3, -.15, .18]), sm);
  for (const [z0, z1] of [[cz0 + .15, TRZ - .62], [TRZ + .62, cz1 - .15]]) { eb(nsM, -.95, .95, CAS, CAS + .012, z0, z1, 1); for (const s of [-1, 1]) eb(yel, s * .97 - .04, s * .97 + .04, CAS, CAS + .014, z0, z1); }
  for (const s of [-1, 1]) eb(nsM, s < 0 ? -.95 : .62, s < 0 ? -.62 : .95, CAS, CAS + .012, TRZ - .62, TRZ + .62, 1);
  for (const s of [-1, 1]) for (let i = 0; i < 18; i++) { const z = mix(cz0 + .6, cz1 - .6, i / 17); eb(recM, s * cx - .012, s * cx + .012, 1.31, 1.4, z - .12, z + .12); }
  { const st = []; for (let z = cz0 + .3; z <= cz1 - .2; z += 1.6) for (const s of [-1, 1]) { if (s > 0 && z > 5.4 && z < 6.8) continue; st.push(cY(.022, .02, CAS, CAS + .95, s * 1.28, z, 6)); }
    for (const s of [-1, 1]) for (const y of [CAS + .5, CAS + .93]) for (const [a, b] of s > 0 ? [[cz0 + .3, 5.3], [6.9, cz1 - .3]] : [[cz0 + .3, cz1 - .3]]) st.push(cZ(.012, .012, a, b, s * 1.28, y, 5));
    ea(mergeGeos(st), steel); }
  Wl(-1.62, -1.3, cz0, cz1, CAS, CAS + 1, {}); Wl(1.3, 1.62, cz0, 5.7, CAS, CAS + 1, {}); Wl(1.3, 1.62, 6.7, cz1, CAS, CAS + 1, {}); Wl(-cx, cx, cz0 - .4, cz0, CAS, CAS + 1, {}); Wl(-cx, cx, cz1, cz1 + .4, CAS, CAS + 1, {});
  // the sail: round nose, tapered tail, a little bridge, name boards, nav lights; masts and periscope rise from it when she is up
  { const sh = new THREE.Shape(); sh.moveTo(sx, 6.85); sh.lineTo(sx, 5.2); sh.lineTo(.17, 4.4); sh.lineTo(-.17, 4.4); sh.lineTo(-sx, 5.2); sh.lineTo(-sx, 6.85); sh.absarc(0, 6.85, sx, PI, 0, true);
    ea(new THREE.ExtrudeGeometry(sh, {depth: 2.56, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 2, curveSegments: 10}).rotateX(-PI / 2).translate(0, CAS, 0), sm); }
  eb(darkM, -.32, .32, 4.15, 4.23, -7.05, -6.35); ea(pl(.62, .2, 0, 4.34, -7.0, PI, -.4), glass); ea(cY(.2, .2, 4.2, 4.27, 0, -4.95, 14), steel); eb(darkM, -.4, .4, 4.18, 4.24, -6.35, -5.4);
  for (const s of [-1, 1]) ea(uvRow(pl(1.5, .19, s * (sx + .012), 3.35, -5.95, s * PI / 2), 0), sgM);
  for (const s of [-1, 1]) for (const z of [-6.62, -6.22]) ea(pl(.3, .13, s * (sx + .008), 3.86, z, s * PI / 2), recM);
  for (const t of [Math.acos(-1 / R), TAU - Math.acos(-1 / R)]) ea(new THREE.CylinderGeometry(R + .005, R + .005, U.zA - zB - .3, 1, 1, true, t - .035, .07).rotateX(PI / 2).translate(0, cy, (zB + U.zA) / 2 + .1), darkM); // boot-top line
  spr(0xff2020, .55, -sx - .04, 3.95, -6.55); spr(0x20ff40, .55, sx + .04, 3.95, -6.55);
  { const mg = new THREE.Group(); g.add(mg); const zs = U.SCOPE[1], q = new THREE.Mesh(mergeGeos([cY(.09, .09, 2.9, 5.0, 0, zs, 10), bx(-.11, .11, 4.85, 5.1, zs - .17, zs + .1), cY(.06, .04, 2.9, 4.75, .15, -5.25, 8), cY(.05, .05, 2.9, 4.5, -.12, -6.3, 8), sph(.13, -.12, 4.56, -6.3, 10)]), darkM); q.castShadow = true; mg.add(q); spr(0xffffff, .5, .15, 4.82, -5.25, mg); g.userData.masts = mg; }
  g.userData.sailPl = piv(g, 0, 3.3, -6.6, sm, [bx(sx, sx + 1.25, -.035, .035, -.35, .45), bx(-sx - 1.25, -sx, -.035, .035, -.35, .45)], 1);
  g.userData.bowPl = piv(g, 0, cy + .3, -8.0, sm, [bx(R - .1, R + 1.3, -.04, .04, -.35, .55), bx(-R - 1.3, -R + .1, -.04, .04, -.35, .55)], 1);
  Wl(-sx, sx, -7.4, -5.2, CAS, 4.2, {}); Wl(-.35, .35, -5.2, -4.4, CAS, 4.2, {});
  // cruciform tail: fixed fins, rudders and stern planes behind them, the ducted five-blade prop
  ea(loft([8.55, -.045, .045, cy + 1.75, cy + 2.6], [9.75, -.03, .03, cy + .95, cy + 2.6]), sm); ea(loft([8.55, -.045, .045, cy - 2.6, cy - 1.75], [9.75, -.03, .03, cy - 2.6, cy - .95]), sm);
  ea(loft([8.55, -2.6, -1.75, cy - .045, cy + .045], [9.75, -2.6, -.95, cy - .03, cy + .03]), sm); ea(loft([8.55, 1.75, 2.6, cy - .045, cy + .045], [9.75, .95, 2.6, cy - .03, cy + .03]), sm);
  g.userData.rud = piv(g, 0, cy, 9.75, sm, [bx(-.03, .03, 1.3, 2.6, 0, .45), bx(-.03, .03, -2.6, -1.3, 0, .45)], 1);
  g.userData.sternPl = piv(g, 0, cy, 9.75, sm, [bx(1.3, 2.6, -.03, .03, 0, .45), bx(-2.6, -1.3, -.03, .03, 0, .45)], 1);
  ea(new THREE.TorusGeometry(1.05, .13, 10, 32).scale(1, 1, 2.6).translate(0, cy, 10.45), darkM); for (const a of [PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]) ea(bx(-.03, .03, .32, 1.0, -.05, .05).rotateZ(a).translate(0, cy, 10.3), darkM);
  { const bl = [sph(.16, 0, 0, 0, 12).scale(1, 1, 1.5)]; for (let i = 0; i < 5; i++) bl.push(bx(-.09, .09, .12, .9, -.012, .012).rotateY(.45).rotateZ(i / 5 * TAU)); g.userData.prop = piv(g, 0, cy, 10.45, steel, bl, 1); }
  // the main hatch: an open coaming and collar over the trunk, the leaf hinged forward so it opens against the sail
  ea(cY(.5, .5, CAS, CAS + .3, TR.x, TRZ, 22, true), stD); ea(tor(.5, .035, TR.x, CAS + .3, TRZ, 'y', 24), steel); ea(new THREE.RingGeometry(.44, .72, 24).rotateX(-PI / 2).translate(TR.x, CAS - .004, TRZ), steel);
  g.userData.hatch = piv(g, TR.x, CAS + .32, TRZ - .5, sm, [cY(.52, .52, 0, .08, 0, .5, 24), tor(.17, .022, 0, .15, .5, 'y', 16), cY(.02, .02, .08, .15, 0, .5, 6), bx(-.26, -.12, -.03, .07, -.07, .05), bx(.12, .26, -.03, .07, -.07, .05)], 1);
  ea(uvRow(pl(.9, .11, TR.x, CAS + .013, TRZ + .85, 0, -PI / 2), 6), sgM);
  Wl(-.5, .5, TRZ - .5, TRZ + .5, CAS, CAS + .35, {});
  // the lock-out door low on the starboard side, tilted to the hull: frame, recess, the sliding leaf, a ring of status lamps
  { const door = q => q.rotateZ(-.24).translate(LD.x, LD.y, LD.z);
    ea(door(new THREE.TorusGeometry(.43, .055, 8, 28).scale(1, 1.45, 1).rotateY(PI / 2)), steel); ea(door(new THREE.CircleGeometry(.42, 24).scale(1, 1.45, 1).rotateY(PI / 2).translate(.006, 0, 0)), recM);
    ea(door(uvRow(pl(.62, .08, .03, .8, 0, PI / 2), 1)), sgM); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .3; ea(door(sph(.03, .03, Math.cos(a) * .74, Math.sin(a) * .54, 6)), lkLampM); }
    const lo = new THREE.Group(); g.add(lo); const lq = new THREE.Mesh(mergeGeos([door(new THREE.CylinderGeometry(.42, .42, .06, 24).rotateZ(PI / 2).scale(1, 1.45, 1).translate(.05, 0, 0)), door(tor(.15, .02, .1, 0, 0, 'x', 14)), door(cX(.02, .05, .11, 0, 0, 6))]), steel); lq.castShadow = true; lo.add(lq); g.userData.lkO = lo; }
  // boarding ladder on the starboard quarter, rungs hugging the hull up to the casing, with grab handles
  { const st = [], seg = (xa, ya, xb, yb, z) => { const L = Math.hypot(xb - xa, yb - ya); return bx(-.015, .015, 0, L, -.015, .015).rotateZ(-Math.atan2(xb - xa, yb - ya)).translate(xa, ya, z); }; let pv = null;
    for (let y = -.8; y < 1.05; y += .3) { const x = Math.sqrt(R * R - (y - cy) ** 2) + .1; st.push(cZ(.022, .022, 5.98, 6.42, x, y, 6)); if (pv) for (const z of [6.0, 6.4]) st.push(seg(pv[0], pv[1], x, y, z)); pv = [x, y]; }
    for (const z of [6.0, 6.4]) { st.push(seg(pv[0], pv[1], 1.32, CAS, z), cY(.02, .02, CAS, CAS + .6, 1.32, z, 6)); } st.push(cZ(.02, .02, 6.0, 6.4, 1.32, CAS + .6, 6)); ea(mergeGeos(st), steel); }
  Wl(-2.45, 2.45, zB, U.zA, -3.45, 1.5, {ext: 1}); Wl(-2.05, 2.05, -12.9, zB, -3.0, 1.0, {ext: 1}); Wl(-1.6, 1.6, U.zA, 9.8, -2.6, .6, {ext: 1}); Wl(-cx, cx, cz0, cz1, 1.1, CAS, {ext: 1});
  // ---- inside. Materials: lining, frames, deck, pipes, panels, fabrics, brass, lamps (lampM turns red when she dives)
  const lnM = SI({map: TX.subLn, side: THREE.BackSide, roughness: .75, metalness: .1}), lnF = SI({map: TX.subLn, color: 0xe6e4d4, roughness: .85, metalness: 0}), ribM = SI({color: 0xa9a892, roughness: .6, metalness: .35}), bhM = SI({map: TX.subPan, side: THREE.DoubleSide, roughness: .55, metalness: .4});
  const dkM = SI({map: TX.dia, color: 0xa0a6a8, roughness: .45, metalness: .65}), rubM = SI({color: 0x1c1e1e, roughness: .95, metalness: 0}), pR = SI({color: 0xa02818, roughness: .5, metalness: .3}), pG = SI({color: 0x2e6a48, roughness: .5, metalness: .3}), pY = SI({color: 0xc89a20, roughness: .5, metalness: .3});
  const iDk = SI({color: 0x23272a, roughness: .55, metalness: .5}), iSt = SI({color: 0x8c949a, roughness: .35, metalness: .75}), iBr = SI({color: 0xb8902a, roughness: .3, metalness: .85}), iPan = SI({map: TX.subPan, roughness: .6, metalness: .4}), iGf = SI({map: TX.gface, roughness: .4, metalness: 0});
  const iHz = SI({map: TX.haz, roughness: .6}), iWd = SI({map: TX.wood, color: 0x9a7650, roughness: .7, metalness: 0}), fNv = SI({color: 0x2a3a5c, roughness: 1, metalness: 0}), fRd = SI({color: 0x8a3428, roughness: 1, metalness: 0}), fCr = SI({color: 0xe8e0cc, roughness: .9, metalness: 0});
  const fGn = SI({color: 0x2e4c3a, roughness: 1, metalness: 0, side: THREE.DoubleSide}), iLk = SI({color: 0x56686a, roughness: .45, metalness: .55}), iPp = SI({map: TX.paper, roughness: 1, metalness: 0}), iYe = SI({color: 0xd8b020, roughness: .55, metalness: .2}), iRe = SI({color: 0xa01a12, roughness: .5, metalness: .2});
  const iGl = SI({color: 0x0a2830, roughness: .05, metalness: .6}), iPl = SI({color: 0x3a7a32, roughness: .9, metalness: 0}), iSg = SI({map: TX.subSign, roughness: .6, metalness: .1}), catM = SI({color: 0xc8783a, roughness: 1, metalness: 0});
  const sonM = SI({map: SUBC.sonT, emissive: 0xffffff, emissiveMap: SUBC.sonT, emissiveIntensity: .85, roughness: .3}), depM = SI({map: SUBC.depT, emissive: 0xffffff, emissiveMap: SUBC.depT, emissiveIntensity: .35, roughness: .4}), indM = SI({map: SUBC.indT, emissive: 0xffffff, emissiveMap: SUBC.indT, emissiveIntensity: .9, roughness: .4});
  const scrM = NC({color: 0x0c1c18, emissive: 0x30c070, emissiveIntensity: .5, roughness: .2}), navM = SI({map: TX.screen, emissive: 0x6affa0, emissiveMap: TX.screen, emissiveIntensity: .8, roughness: .2}), lampM = NC({color: 0xfff4e0, emissive: 0xffd8a0, emissiveIntensity: 1.2}), fairy = NC({color: 0x302010, emissive: 0xffc070, emissiveIntensity: 1}), lkLampI = NC({color: 0x101010, emissive: 0x30ff50, emissiveIntensity: 1.5});
  // hull lining (open on top above the ceiling), ribs, the bow ring's inner face, the after end plate
  { const len = zE - zB, q = new THREE.CylinderGeometry(Ri, Ri, len, 36, 1, true, PI + .3, TAU - .6); uvS(q, (TAU - .6) * Ri * .5, len * .5); ia(q.rotateX(PI / 2).translate(0, cy, (zB + zE) / 2), lnM); }
  ia(new THREE.RingGeometry(1.96, Ri + .03, 40).translate(0, cy, zB + .01), ribM); ia(new THREE.CircleGeometry(Ri + .02, 36).rotateY(PI).translate(0, cy, zE), bhM, .8);
  for (let z = zB + .55; z < zE - .2; z += 1.15) { if (U.BH.some(b => Math.abs(z - b) < .35) || Math.abs(z + 8.6) < .35 || Math.abs(z - TRZ) < .6) continue; ia(tor(Ri - .03, .05, 0, cy, z, 'z', 36), ribM); }
  // two watertight bulkheads with oval doors, each door swung back flat and dogged; an open frame between the viewport room and the control room
  const dShape = (sh, w, y0, y1, r) => { sh.moveTo(-w + r, y0); sh.lineTo(w - r, y0); sh.quadraticCurveTo(w, y0, w, y0 + r); sh.lineTo(w, y1 - r); sh.quadraticCurveTo(w, y1, w - r, y1); sh.lineTo(-w + r, y1); sh.quadraticCurveTo(-w, y1, -w, y1 - r); sh.lineTo(-w, y0 + r); sh.quadraticCurveTo(-w, y0, -w + r, y0); return sh; };
  for (const z of U.BH) { const w = U.dw + .04, sh = new THREE.Shape(); sh.absarc(0, cy, Ri + .02, 0, TAU, false); sh.holes.push(dShape(new THREE.Path(), w, FI + .12, FI + 1.92, .28)); ia(new THREE.ShapeGeometry(sh, 24).translate(0, 0, z), bhM, .8);
    for (const s of [-1, 1]) ib(iSt, s < 0 ? -w - .1 : w, s < 0 ? -w : w + .1, FI + .12, FI + 1.92, z - .07, z + .07); ib(iSt, -w - .1, w + .1, FI + 1.92, FI + 2.02, z - .07, z + .07); ib(iHz, -w - .1, w + .1, FI, FI + .12, z - .08, z + .08, 3);
    const lf = new THREE.ExtrudeGeometry(dShape(new THREE.Shape(), .58, FI + .06, FI + 1.98, .3), {depth: .06, bevelEnabled: false}).translate(w + .72, 0, z + .08); ia(lf, iPan, .8);
    ia(tor(.16, .018, w + .72, FI + 1.05, z + .16, 'z', 16), iSt); for (const y of [FI + .4, FI + 1.05, FI + 1.7]) ib(iSt, w + .1, w + .2, y - .03, y + .03, z + .08, z + .17); ia(uvRow(pl(.56, .07, -w - .52, FI + 1.75, z + .075), 6), iSg); }
  ia(tor(Ri - .04, .07, 0, cy, -8.6, 'z', 36), ribM); for (const s of [-1, 1]) ib(bhM, s < 0 ? -2.25 : 1.25, s < 0 ? -1.25 : 2.25, FI - .05, OH + .1, -8.66, -8.54, .8); ib(bhM, -1.25, 1.25, FI + 2.08, OH + .1, -8.66, -8.54, .8);
  // diamond-plate deck (into the dome), a rubber runner, lift-out panel seams; the false ceiling with its hole for the trunk; pipes, cable trays, a grab rail
  { const sh = new THREE.Shape(), f = U.fx, ys = -zB, a = Math.asin((zB - U.zF) / 1.43), xF = 1.43 * Math.cos(a); sh.moveTo(-f, -zE); sh.lineTo(f, -zE); sh.lineTo(f, ys); sh.lineTo(1.43, ys); sh.absarc(0, ys, 1.43, 0, a, false); sh.lineTo(-xF, -U.zF); sh.absarc(0, ys, 1.43, PI - a, PI, false); sh.lineTo(-f, ys);
    ia(new THREE.ShapeGeometry(sh, 12).rotateX(-PI / 2).translate(0, FI, 0), dkM, 1); }
  ib(rubM, -.36, .36, FI, FI + .01, -11.0, zE - .1, 1); for (let z = -10; z < zE - .3; z += 1.2) ib(iDk, -U.fx + .02, U.fx - .02, FI, FI + .004, z, z + .02);
  { const X = 2.12, y0 = OH, y1 = OH + .04; ib(lnF, -X, X, y0, y1, zB, TRZ - .5, .5); ib(lnF, -X, X, y0, y1, TRZ + .5, zE, .5); ib(lnF, -X, -.5, y0, y1, TRZ - .5, TRZ + .5, .5); ib(lnF, .5, X, y0, y1, TRZ - .5, TRZ + .5, .5); }
  for (const s of [-1, 1]) { ia(cZ(.05, .05, zB + .15, zE - .05, s * .58, OH - .08, 10), s < 0 ? pR : pG); ia(cZ(.035, .035, zB + .15, zE - .05, s * 1.08, OH - .07, 8), s < 0 ? pY : lnF); ib(iDk, s * .82 - .12, s * .82 + .12, OH - .035, OH - .012, zB + .2, zE - .1);
    ia(cZ(.02, .02, -8.4, zE - .3, s * .3, FI + 2.15, 6), iSt); for (let z = zB + .6; z < zE; z += 1.25) { ib(iDk, s * .48, s * .68, OH - .14, OH, z, z + .04); ia(cY(.008, .008, FI + 2.15, OH, s * .3, z + .3, 4), iSt); } }
  ia(uvRow(pl(.56, .07, 0, FI + 2.22, -8.535), 7), iSg);
  // the trunk: a lined tube up through the casing, rings top and bottom, the ladder on its after wall
  ia(uvS(new THREE.CylinderGeometry(TR.r, TR.r, CAS - OH, 20, 1, true), 1.4, 1).translate(TR.x, (OH + CAS) / 2, TRZ), lnM); ia(new THREE.RingGeometry(TR.r - .01, .76, 24).rotateX(PI / 2).translate(TR.x, OH - .004, TRZ), iSt);
  { const L = []; for (const s of [-1, 1]) L.push(cY(.022, .022, FI, CAS + .35, TR.x + s * .2, TRZ + .32, 6)); for (let y = FI + .3; y < CAS + .2; y += .3) L.push(cX(.017, TR.x - .2, TR.x + .2, y, TRZ + .32, 6)); ia(mergeGeos(L), iSt); }
  // ceiling lamps (POOL lights sit just under them)
  for (const [x, , z] of U.lamps) { ib(iDk, x - .17, x + .17, OH - .05, OH, z - .09, z + .09); ib(lampM, x - .14, x + .14, OH - .065, OH - .045, z - .06, z + .06); }
  // ---- the viewport room: pilot console under the dome (screens, depth dial, compass), the yoke, the pilot seat, two observer benches
  ib(iDk, -.65, .65, FI, FI + .6, -11.75, -11.2); ia(bx(-.66, .66, -.02, .02, -.3, .3).rotateX(.55).translate(0, FI + .66, -11.47), iPan, 1);
  for (const s of [-1, 1]) ia(new THREE.PlaneGeometry(.4, .26).rotateX(-PI / 2 + .55).translate(s * .33, FI + .684, -11.457), s < 0 ? sonM : navM);
  ia(new THREE.CircleGeometry(.075, 20).rotateX(-PI / 2 + .55).translate(0, FI + .69, -11.43), depM); ia(sph(.055, 0, FI + .72, -11.24, 10), iBr);
  ia(cZ(.035, .045, -11.2, -10.95, 0, FI + .9, 8), iSt);
  { const yg = piv(inner, 0, FI + .95, -10.95, iDk, [bx(-.24, .24, -.025, .025, -.025, .025), cY(.026, .026, -.12, .12, -.24, 0, 8), cY(.026, .026, -.12, .12, .24, 0, 8), cZ(.03, .03, -.3, 0, 0, 0, 8)]); yg.rotation.x = -.45; g.userData.wheel = yg; }
  ib(fNv, -.27, .27, FI + .38, FI + .5, -10.7, -10.2); ib(fNv, -.27, .27, FI + .5, FI + 1.15, -10.2, -10.1); ia(cY(.04, .04, FI, FI + .38, 0, -10.45, 8), iSt); ib(iDk, -.25, .25, FI + .3, FI + .38, -10.7, -10.2);
  for (const s of [-1, 1]) { ib(iDk, s < 0 ? -1.8 : 1.15, s < 0 ? -1.15 : 1.8, FI, FI + .38, -10.3, -9.0); ib(fRd, s < 0 ? -1.78 : 1.17, s < 0 ? -1.17 : 1.78, FI + .38, FI + .47, -10.25, -9.05); }
  ia(cY(.05, .05, FI + .47, FI + .73, -1.42, -9.25, 10), iRe); ib(iDk, 1.3, 1.6, FI + .47, FI + .55, -9.6, -9.35);
  // ---- control room: ballast panel (handwheels, levers, gauges, indicator board), sonar desk, periscope, the big depth gauge, chart table
  { const x = -1.45; ib(iPan, -1.85, x, FI, FI + 2.02, -8.3, -6.4, .8); ia(uvRow(pl(.7, .09, x + .006, FI + 1.92, -7.35, PI / 2), 2), iSg);
    for (let i = 0; i < 6; i++) { const z = -8.0 + (i % 3) * .55, y = FI + (i < 3 ? 1.05 : .62); ia(tor(.1, .016, x + .07, y, z, 'x', 18), iBr); ib(iBr, x + .062, x + .078, y - .1, y + .1, z - .008, z + .008); ib(iBr, x + .062, x + .078, y - .008, y + .008, z - .1, z + .1); ia(cX(.014, x, x + .07, y, z, 6), iBr); }
    for (let i = 0; i < 4; i++) { const z = -8.1 + i * .3, y = FI + 1.42; ib(iDk, x, x + .05, y - .04, y + .04, z - .03, z + .03); ia(bx(-.012, .012, 0, .22, -.012, .012).rotateZ(-.5).translate(x + .04, y, z), iSt); ia(sph(.03, x + .04 + .22 * Math.sin(.5), y + .22 * Math.cos(.5), z, 8), iRe); }
    for (let i = 0; i < 8; i++) { const y = FI + 1.78 - (i >> 2) * .17, z = -8.15 + (i % 4) * .2; ia(new THREE.CircleGeometry(.06, 16).rotateY(PI / 2).translate(x + .008, y, z), iGf); ia(tor(.062, .01, x + .01, y, z, 'x', 14), iBr); }
    ia(new THREE.PlaneGeometry(.4, .2).rotateY(PI / 2).translate(x + .007, FI + 1.42, -6.78), indM); }
  ib(iPan, 1.25, 1.85, FI, FI + .85, -8.3, -6.7, .8); ib(iWd, 1.2, 1.85, FI + .85, FI + .89, -8.32, -6.68, 1); ib(iDk, 1.48, 1.85, FI + .89, FI + 1.52, -7.82, -7.18); ia(new THREE.PlaneGeometry(.5, .42).rotateY(-PI / 2).translate(1.47, FI + 1.2, -7.5), sonM);
  ia(uvRow(pl(.4, .05, 1.47, FI + 1.47, -7.5, -PI / 2), 3), iSg); ia(cY(.04, .04, FI, FI + .5, .85, -7.5, 8), iSt); ia(cY(.18, .18, FI + .5, FI + .56, .85, -7.5, 14), fRd); ia(tor(.08, .015, 1.36, FI + .92, -6.95, 'z', 12), iDk);
  ia(cY(.14, .14, FI + 1.72, OH + .02, 0, U.SCOPE[1], 14), iSt); ia(tor(.15, .02, 0, FI + 1.8, U.SCOPE[1], 'y', 16), iBr);
  { const z = U.SCOPE[1]; g.userData.scope = piv(inner, 0, 0, 0, iDk, [bx(-.15, .15, FI + 1.35, FI + 1.68, z - .14, z + .14), bx(-.06, .06, FI + 1.45, FI + 1.55, z + .14, z + .24), cX(.025, -.32, .32, FI + 1.45, z, 8), cY(.11, .11, FI + 1.68, FI + 2.3, 0, z, 12)]); }
  ia(new THREE.CircleGeometry(.26, 28).translate(-1.6, FI + 1.45, -8.535), depM); ia(tor(.26, .025, -1.6, FI + 1.45, -8.53, 'z', 28), iBr);
  ib(iWd, 1.15, 1.85, FI, FI + .9, -5.0, -3.9, 1); ia(new THREE.PlaneGeometry(.6, .9).rotateX(-PI / 2).translate(1.48, FI + .905, -4.45), iPp); ia(cY(.012, .012, FI + .9, FI + 1.3, 1.72, -4.0, 6), iBr); ia(new THREE.ConeGeometry(.09, .1, 12, 1, true).translate(1.64, FI + 1.27, -4.05), iBr); ia(cY(.04, .036, FI + .9, FI + 1.0, 1.3, -4.75, 10), fCr);
  ia(cY(.07, .07, FI, FI + .45, -1.65, -6.15, 10), iRe); ia(cY(.025, .025, FI + .45, FI + .55, -1.65, -6.15, 6), iDk); ib(fCr, 1.55, 1.75, FI + 1.4, FI + 1.62, -8.53, -8.45);
  // ---- crew space: two bunks with curtains (and the ship's cat), lockers, a dinette, the galley counter, books, a radio, fairy lights
  { const x0 = -1.8, x1 = -.95, z0 = -2.45, z1 = -.35;
    for (const [px, pz] of [[x0 + .04, z0 + .04], [x1 - .04, z0 + .04], [x0 + .04, z1 - .04], [x1 - .04, z1 - .04]]) ia(cY(.025, .025, FI, FI + 1.95, px, pz, 6), iSt);
    for (const y of [FI + .3, FI + 1.2]) { ib(iSt, x0, x1, y, y + .05, z0, z1); ib(fNv, x0 + .03, x1 - .03, y + .05, y + .2, z0 + .03, z1 - .03); ib(fRd, x0 + .02, x1 - .02, y + .2, y + .23, z0 + .55, z1 - .02); ib(fCr, x0 + .1, x1 - .1, y + .2, y + .3, z0 + .06, z0 + .42); ia(sph(.04, x0 + .1, y + .62, z0 + .3, 8), lampM); }
    ib(iSt, x0, x1, FI + 1.95, FI + 2.0, z0, z1); ia(pl(.9, .78, x1 + .012, FI + .82, z0 + .5, PI / 2), fGn); ia(pl(.5, .8, x1 + .012, FI + 1.72, z1 - .28, PI / 2), fGn);
    ia(cZ(.01, .01, z0, z1, x1 + .02, FI + 1.22, 5), iBr); ia(cZ(.01, .01, z0, z1, x1 + .02, FI + 2.12, 5), iBr); ib(iDk, x0 + .02, x0 + .04, FI + .66, FI + .84, -1.3, -1.06); ib(fCr, x0 + .045, x0 + .05, FI + .69, FI + .81, -1.27, -1.09); }
  { const cg = piv(inner, -1.38, FI + .62, -1.5, catM, [new THREE.SphereGeometry(.16, 12, 8).scale(1.5, .75, 1), new THREE.SphereGeometry(.09, 10, 8).translate(.2, .02, .06), new THREE.ConeGeometry(.03, .06, 4).translate(.22, .1, .015), new THREE.ConeGeometry(.03, .06, 4).translate(.22, .1, .105), new THREE.TorusGeometry(.17, .025, 6, 12, PI * 1.2).rotateX(PI / 2).translate(0, -.03, 0)].map(q => q.rotateY(PI / 2)));
    g.userData.cat = cg; g.userData.catP = [-1.38, FI + .62, -1.5]; }
  ib(iLk, -1.8, -1.3, FI, FI + 1.9, -.25, 1.5); for (let z = -.25 + .58; z < 1.45; z += .58) ib(iDk, -1.305, -1.295, FI + .05, FI + 1.85, z - .01, z + .01); for (let z = -.25 + .29; z < 1.5; z += .58) { ib(iSt, -1.3, -1.28, FI + 1.0, FI + 1.12, z + .18, z + .2); for (let k = 0; k < 4; k++) ib(iDk, -1.3, -1.295, FI + 1.5 + k * .05, FI + 1.52 + k * .05, z - .12, z + .12); }
  ia(cY(.16, .12, FI + 1.9, FI + 2.02, -1.55, .9, 12), iYe);
  ib(iWd, .7, 1.8, FI + .72, FI + .77, -2.0, -1.2, 1); ia(cY(.04, .04, FI, FI + .72, 1.2, -1.6, 8), iSt);
  for (const [z0, z1] of [[-2.45, -2.05], [-1.15, -.75]]) { const fw = z0 < -2; ib(iWd, .7, 1.8, FI, FI + .4, z0, z1, 1); ib(fRd, .72, 1.78, FI + .4, FI + .5, z0 + .02, z1 - .02); ib(fRd, .72, 1.78, FI + .5, FI + 1.0, fw ? z0 + .02 : z1 - .12, fw ? z0 + .12 : z1 - .02); }
  for (const [x, z] of [[1.0, -1.75], [1.35, -1.45]]) ia(cY(.04, .036, FI + .77, FI + .87, x, z, 10), fCr); ib(fNv, .9, 1.15, FI + .77, FI + .79, -1.5, -1.3); ia(cY(.05, .03, FI + .77, FI + .95, 1.62, -1.85, 8), iBr); ia(sph(.06, 1.62, FI + 1.0, -1.85, 8), fairy);
  ib(iPan, 1.25, 1.85, FI, FI + .86, -.6, 1.5, .8); ib(iWd, 1.2, 1.85, FI + .86, FI + .9, -.62, 1.52, 1); ib(iDk, 1.35, 1.75, FI + .9, FI + .93, -.52, -.02); for (const z of [-.39, -.15]) ia(tor(.08, .012, 1.55, FI + .935, z, 'y', 14), iSt);
  ia(cY(.09, .07, FI + .93, FI + 1.13, 1.55, -.27, 12), iRe); ia(sph(.03, 1.55, FI + 1.15, -.27, 8), iDk); ia(cZ(.012, .02, -.42, -.34, 1.55, FI + 1.04, 6), iRe);
  for (const [x, z, m] of [[1.4, .22, fCr], [1.44, .38, pY]]) ia(cY(.04, .036, FI + .9, FI + 1.0, x, z, 10), m); ia(cY(.08, .08, FI + .9, FI + 1.02, 1.62, .58, 14), fNv);
  ia(cY(.09, .07, FI + .9, FI + 1.08, 1.6, .95, 10), fRd); for (let i = 0; i < 6; i++) ia(new THREE.ConeGeometry(.04, .38, 4).rotateX(Math.sin(i * 2) * .5).rotateZ(Math.cos(i * 2) * .5).translate(1.6 + Math.cos(i) * .04, FI + 1.25, .95 + Math.sin(i) * .04), iPl);
  ib(iDk, 1.4, 1.8, FI + .9, FI + 1.12, 1.0, 1.34); ia(pl(.22, .07, 1.395, FI + 1.04, 1.17, -PI / 2), fairy); ia(cY(.006, .006, FI + 1.12, FI + 1.5, 1.7, 1.3, 4), iSt);
  ib(iWd, 1.62, 1.95, FI + 1.55, FI + 1.58, -.5, 1.4, 1); { const bk = [fNv, fRd, fGn, pY, fCr]; let k = 0; for (let z = -.45; z < .6; z += .075) ib(bk[k++ % 5], 1.66, 1.9, FI + 1.58, FI + 1.58 + .18 + (k * 7 % 5) * .015, z, z + .058); }
  for (let z = -2.35; z < 1.5; z += .3) for (const s of [-1, 1]) ia(sph(.022, s * .95, OH - .1 - Math.abs(Math.sin(z * 2.1)) * .07, z, 6), fairy);
  ia(new THREE.CircleGeometry(.12, 20).translate(-.8, FI + 1.75, -2.525), iGf);
  // ---- cargo racks (the hold) and the lock-out chamber: walls, a pocket door with a porthole, the outer hatch in the hull, a bench, dive gear, the water
  { for (const [px, pz] of [[-1.77, 2.03], [-.98, 2.03], [-1.77, 3.97], [-.98, 3.97], [-.98, 3.0], [-1.77, 3.0]]) ia(cY(.025, .025, FI, FI + 2.0, px, pz, 6), iSt);
    for (const y of [FI + .25, FI + .95, FI + 1.65]) { ib(iSt, -1.8, -.95, y, y + .04, 2.0, 4.0); ib(iYe, -.99, -.97, y + .1, y + .14, 2.0, 4.0); } }
  { const {x0, z0, z1, dz0, dz1} = LKR, X = 2.15; ib(iPan, .32, X, FI, OH, z0 - .06, z0, .8); ib(iPan, .18, .32, FI, OH, 1.45, dz0, .8); ib(iPan, .2, .3, FI, OH, dz1, z1, .8); ib(iPan, .2, X, FI, OH, z1, z1 + .06, .8); ib(iPan, .2, .3, FI + 1.9, OH, dz0, dz1, .8); ib(iHz, .18, .32, FI, FI + .03, dz0, dz1, 3);
    ia(uvRow(pl(.4, .05, .175, FI + 1.78, 1.92, -PI / 2), 1), iSg); ib(iDk, .14, .18, FI + 1.15, FI + 1.45, 2.0, 2.32); ib(iDk, 1.35, 1.65, FI + 1.15, FI + 1.45, z0, z0 + .04); for (const [px, pz] of [[.15, 2.08], [.15, 2.2], [1.45, z0 + .045], [1.55, z0 + .045]]) ia(sph(.018, px, FI + 1.38, pz, 6), lkLampI);
    ia(sph(.04, .16, FI + 2.02, (dz0 + dz1) / 2, 8), lkLampI); ia(sph(.04, .34, FI + 2.02, (dz0 + dz1) / 2, 8), lkLampI);
    const lg = piv(inner, 0, 0, 0, iYe, [bx(.215, .285, FI + .03, FI + 1.88, dz0 + .02, dz1 - .02), bx(.17, .215, FI + .95, FI + 1.05, dz1 - .2, dz1 - .1), bx(.285, .33, FI + .95, FI + 1.05, dz1 - .2, dz1 - .1)]);
    lg.add(new THREE.Mesh(cX(.13, .205, .295, FI + 1.45, (dz0 + dz1) / 2, 16), iGl)); g.userData.lkI = lg;
    ib(iWd, 1.3, 1.78, FI, FI + .42, 3.25, 3.75, 1); ia(cY(.09, .09, FI + .5, FI + 1.2, 1.62, 2.25, 12), iYe); ib(iDk, 1.52, 1.72, FI + 1.25, FI + 1.38, 2.1, 2.2); ia(cZ(.012, .012, 2.05, 3.0, 1.75, FI + 1.55, 4), iSt);
    ia(new THREE.CircleGeometry(.16, 16).rotateX(-PI / 2).translate(1.0, FI + .006, 2.9), iDk); for (let k = -2; k <= 2; k++) ib(iSt, .86, 1.14, FI + .007, FI + .011, 2.9 + k * .05 - .008, 2.9 + k * .05 + .008);
    const tl = -.263, hz = q => q.rotateZ(tl).translate(2.17, LD.y, LD.z); ia(hz(new THREE.TorusGeometry(.42, .05, 8, 28).scale(1, 1.42, 1).rotateY(PI / 2)), iSt); ia(hz(new THREE.CircleGeometry(.41, 24).scale(1, 1.42, 1).rotateY(-PI / 2).translate(.035, 0, 0)), iGl);
    g.userData.lkOi = piv(inner, 0, 0, 0, iSt, [hz(new THREE.CylinderGeometry(.4, .4, .05, 24).rotateZ(PI / 2).scale(1, 1.42, 1).translate(-.03, 0, 0)), hz(tor(.13, .018, -.07, 0, 0, 'x', 14)), hz(cX(.02, -.07, -.02, 0, 0, 6))]);
    const wm = subMat(new THREE.MeshStandardMaterial({color: 0x0a4652, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide, roughness: .1, metalness: .1})), wq = new THREE.Mesh(bx(x0 + .02, 2.25, 0, 1, z0 + .02, z1 - .02), wm); wq.position.y = FI; wq.scale.y = .001; wq.visible = false; wq.renderOrder = 2; inner.add(wq); g.userData.lkW = wq; }
  // ---- motor room: battery racks with hazard bands and cell caps, the motor, pipes, gauges, fuse panel, the red emergency-blow wheel, the patch locker and trim tank
  for (const s of [-1, 1]) { const a = s < 0 ? -1.8 : 1.0, b = s < 0 ? -1.0 : 1.8; ib(iDk, a, b, FI, FI + .75, 4.5, 6.0); ia(uvS(pl(1.5, .08, s < 0 ? b + .003 : a - .003, FI + .66, 5.25, s < 0 ? PI / 2 : -PI / 2), 4.7, 1), iHz); ia(uvRow(pl(.5, .065, s < 0 ? b + .004 : a - .004, FI + .45, 5.25, s < 0 ? PI / 2 : -PI / 2), 4), iSg);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { const x = mix(a + .15, b - .15, j / 2), z = 4.65 + i * .25; ia(cY(.035, .035, FI + .75, FI + .8, x - .05, z, 8), iRe); ia(cY(.035, .035, FI + .75, FI + .8, x + .05, z, 8), iDk); } }
  ib(iDk, -.5, .5, FI, FI + .2, 6.3, 6.98); ia(cZ(.55, .55, 6.3, 6.98, 0, FI + .72, 20), pG); for (let z = 6.38; z < 6.95; z += .1) ia(tor(.56, .018, 0, FI + .72, z, 'z', 20), iSt); ia(cZ(.12, .12, 6.1, 6.3, 0, FI + .72, 10), iSt);
  ia(cY(.05, .05, FI, OH, -1.62, 6.9, 8), pY); ia(cY(.04, .04, FI, OH, 1.62, 6.9, 8), pR); ia(cX(.04, -1.62, 1.62, FI + 2.0, 6.9, 8), pY);
  for (let i = 0; i < 4; i++) { const x = -1.05 + i * .7; ia(new THREE.CircleGeometry(.07, 16).rotateY(PI).translate(x, FI + 1.55, 6.985), iGf); ia(tor(.072, .01, x, FI + 1.55, 6.98, 'z', 14), iBr); }
  ib(iPan, .7, 1.3, FI + 1.0, FI + 1.4, 6.94, 7.0, .8); for (let i = 0; i < 6; i++) ib(i % 2 ? iRe : iDk, .78 + i * .085, .83 + i * .085, FI + 1.18, FI + 1.26, 6.91, 6.94);
  ia(tor(.2, .025, 0, FI + 1.75, 6.95, 'z', 20), iRe); ib(iRe, -.2, .2, FI + 1.74, FI + 1.76, 6.94, 6.96); ib(iRe, -.01, .01, FI + 1.55, FI + 1.95, 6.94, 6.96); ia(uvRow(pl(.6, .075, 0, FI + 2.04, 6.99, PI), 5), iSg);
  ib(iYe, -1.8, -1.2, FI, FI + .5, 6.2, 6.95); ib(iDk, -1.75, -1.25, FI + .5, FI + .52, 6.25, 6.9); ia(cY(.3, .3, FI, FI + .9, 1.5, 6.57, 16), iRe); ia(cY(.05, .05, FI + .9, FI + 1.0, 1.5, 6.57, 8), iDk);
  // inside walls (crew only): hull sides, the dome, bulkheads, furniture, the chamber (its door is solid unless the lock is dry)
  Wl(-2.7, -U.fx, zB, zE); Wl(U.fx, 2.7, zB, zE); for (let i = 0; i < 4; i++) { const za = U.zF + i * (zB - U.zF) / 4, zb2 = za + (zB - U.zF) / 4, h = Math.sqrt(Math.max(0, 1.6 * 1.6 - ((za + zb2) / 2 - zB) ** 2)); Wl(-2.2, -h, za, zb2); Wl(h, 2.2, za, zb2); }
  Wl(-1.6, 1.6, -12.4, U.zF); Wl(-2.7, 2.7, zE, zE + .5); Wl(-2.7, -1.25, -8.66, -8.54); Wl(1.25, 2.7, -8.66, -8.54); for (const z of U.BH) { Wl(-2.7, -U.dw, z - .06, z + .06); Wl(U.dw, 2.7, z - .06, z + .06); }
  Wl(-.65, .65, -11.75, -11.2, FI, FI + .72); for (const s of [-1, 1]) Wl(s < 0 ? -1.8 : 1.15, s < 0 ? -1.15 : 1.8, -10.3, -9.0, FI, FI + .45);
  Wl(-1.85, -1.45, -8.3, -6.4); Wl(1.25, 1.85, -8.3, -6.7, FI, FI + .85); Wl(-.2, .2, -6.1, -5.7); Wl(1.15, 1.85, -5.0, -3.9, FI, FI + .9);
  Wl(-1.8, -.95, -2.45, -.35); Wl(-1.8, -1.3, -.25, 1.5); Wl(.7, 1.8, -2.0, -1.2, FI, FI + .77); Wl(.7, 1.8, -2.45, -2.05, FI, FI + .45); Wl(.7, 1.8, -1.15, -.75, FI, FI + .45); Wl(1.25, 1.8, -.6, 1.5, FI, FI + .9); Wl(-1.8, -.95, 2.0, 4.0);
  { const {z0, z1, dz0, dz1} = LKR; Wl(.2, 2.2, z0 - .06, z0); Wl(.18, .32, 1.45, dz0); Wl(.2, .3, dz1, z1); Wl(.2, 2.2, z1, z1 + .06); Wl(.2, .3, dz0, dz1, FI, FI + 1.9, {int: 1, door: 'i'}); }
  for (const s of [-1, 1]) Wl(s < 0 ? -1.8 : 1.0, s < 0 ? -1.0 : 1.8, 4.5, 6.0, FI, FI + .75); Wl(-.6, .6, 6.3, 7.0, FI, FI + 1.4); Wl(-1.8, -1.2, 6.2, 6.95, FI, FI + .5); Wl(1.2, 1.8, 6.2, 6.95, FI, FI + .9);
  // floors, helm, deck spots and interactions
  Object.assign(BDECK, {x0: -cx, x1: cx, z0: cz0, z1: cz1, y: CAS}); BFL.push({x0: -U.fx, x1: U.fx, z0: U.zF, z1: zE, y: FI, int: 1});
  BHELM[0] = U.HELM[0]; BHELM[1] = U.HELM[1]; BHELM[2] = FI; BSPOT.hold[0] = -1.0; BSPOT.hold[1] = 3.0; BSPOT.patch[0] = -1.5; BSPOT.patch[1] = 6.55; BSPOT.fuel[0] = 1.5; BSPOT.fuel[1] = 6.55;
  Object.assign(g.userData, {lamps: U.lamps, radioP: [1.58, FI + 1.0, 1.17], lampM, scrM, lensM, lkLampM: [lkLampM, lkLampI], fairy, cargoAt: i => [-1.38, FI + .29 + Math.floor(i / 4) * .7, 2.3 + (i % 4) * .48], lightZ: -12.9, lightY: cy - 1.2, wz: [U.zF, zE]});
  const busy = () => `Airlock ${LK.st === 2 ? 'flooding' : LK.st === 5 ? 'draining' : 'cycling'} ${Math.round((LK.st === 5 ? 1 - (LK.wv || 0) : (LK.wv || 0)) * 100)}%`;
  INTER.push({kind: 'ladder', boat: 1, lx: R + .45, lz: 6.2, ly: -CAS, r: 3.5, top: 'boat', end: [.75, 6.2], label: () => 'Climb aboard', on: () => P.sw && (B.dep || 0) < .6},
    {kind: 'shatch', boat: 1, lx: TR.x, lz: TRZ, by: CAS + .45, r: 1.9, get info() { return !B.hat && !subSurf() ? 1 : 0; }, label: () => B.hat ? 'Climb down' : subSurf() ? 'Open the hatch' : 'Hatch shut', go: () => B.hat ? subClimb(false) : act({a: 'hatch', o: 1}), on: () => !P.sw && P.ob && P.y > CAS - .5},
    {kind: 'shatchB', boat: 1, lx: TR.x, lz: TRZ + .2, by: FI + 1.5, r: 1.8, get info() { return !B.hat && !subSurf() ? 1 : 0; }, label: () => B.hat ? 'Climb up' : subSurf() ? 'Open the hatch' : 'Hatch shut. Surface first.', go: () => B.hat ? subClimb(true) : act({a: 'hatch', o: 1}), on: () => P.ob && P.y < FI + .5},
    {kind: 'lockIn', boat: 1, lx: 1.5, lz: LKR.z0 + .08, by: FI + 1.3, r: 1.6, get info() { return LK.st === 0 || LK.st === 3 ? 0 : 1; }, label: () => LK.st === 0 ? 'Flood the airlock and go out' : LK.st === 3 ? 'Drain the airlock' : busy(), go: () => act({a: 'lock', op: LK.st === 3 ? 'drain' : 'out'}), on: () => P.ob && inLock(P)},
    {kind: 'lockGo', boat: 1, lx: 1.75, lz: LD.z, by: FI + .8, r: 1.4, label: () => 'Swim out', go: () => lockDropOut(), on: () => P.ob && inLock(P) && LK.st === 3},
    {kind: 'lockOut', boat: 1, lx: .12, lz: 2.2, by: FI + 1.3, r: 1.7, get info() { return LK.st === 3 ? 0 : 1; }, label: () => LK.st === 3 ? 'Drain the airlock' : LK.st === 0 ? 'Airlock: step inside to dive out' : busy(), go: () => act({a: 'lock', op: 'drain'}), on: () => P.ob && !inLock(P) && P.y < FI + .5},
    {kind: 'lockSea', dive: 1, boat: 1, lx: LD.x + .5, lz: LD.z, by: LD.y, r: 2.8, get info() { return LK.st === 0 || LK.st === 3 ? 0 : 1; }, label: () => LK.st === 3 ? 'Enter the airlock' : LK.st === 0 ? 'Airlock: knock to flood it' : busy(), go: () => act({a: 'lock', op: LK.st === 3 ? 'enter' : 'knock'}), on: () => P.sw},
    {kind: 'radio', boat: 1, lx: 1.58, lz: 1.17, by: FI + 1.0, r: 1.7, label: () => G.radioOn ? 'Turn the radio off' : 'Turn on the radio', go: () => act({a: 'radio', on: !G.radioOn})},
    {kind: 'bunk', boat: 1, lx: -1.38, lz: -2.0, by: FI + .7, r: 1.7, label: () => 'Lie down', go: () => subRestStart(), on: () => P.ob && !P.rest && P.y < FI + .5},
    {kind: 'scope', boat: 1, lx: 0, lz: U.SCOPE[1] + .14, by: FI + 1.5, r: 1.5, get info() { return (B.dep || 0) < 3 ? 0 : 1; }, label: () => (B.dep || 0) < 3 ? 'Up periscope' : 'Periscope down', go: () => subScope(1), on: () => P.ob && !P.scope && P.y < FI + .5});
}
// after the bake: hang the interior and cargo off one group, raise the shared deck spots to the inner deck
function subDone(g) { const inner = g.userData.inner = SUBC.inner; inner.add(g.userData.cargo); const FI = SUB.FI;
  for (const it of INTER) { if (!it.boat) continue; if (it.kind === 'helm') it.by = FI + 1; else if (it.kind === 'hold') it.by = FI + .9; else if (it.kind === 'patchbox') { it.by = FI + .7; it.r = 2.2; } } }
// ---- sub rules shared by host and clients
const subSurf = () => (B.dep || 0) < .5 && (B.dtar || 0) < .3, lkDepth = () => (B.dep || 0) - SUB.LD.y;
const inTrunk = p => !!(p && p.ob && p.bl && Math.hypot(p.bl[0] - SUB.TR.x, p.bl[1] - SUB.TR.z) < .9 && p.y > SUB.FI + .3 && p.y < SUB.CAS - .3);
const inLock = p => { const L = SUB.LKR; return !!(p && p.ob && p.bl && p.bl[0] > L.x0 && p.bl[0] < L.x1 && p.bl[1] > L.z0 && p.bl[1] < L.z1 && p.y < SUB.FI + 1); };
const inDoorway = p => { const L = SUB.LKR; return !!(p && p.ob && p.bl && Math.abs(p.bl[0] - L.x0) < .45 && p.bl[1] > L.dz0 - .1 && p.bl[1] < L.dz1 + .1 && p.y < SUB.FI + 1); };
const freshP = p => p === P || performance.now() - (p.poseT || 0) < 1500;
function trunkBusy() { for (const p of PL.values()) if (p.ready && !p.dead && ((p.trunkT || 0) > G.t || (inTrunk(p) && freshP(p)))) return true; return false; }
const subInside = (p = P) => !!(BG.sub && p && p.ob && (p.y < BDECK.y - 1 || (p === P && P.climb && P.climb.b === 'bin')));
function boatSpawn(i) { if (BG.sub) return {bl: [[-.7, -7.3], [.7, -7.3], [-.7, -6.1], [.7, -6.1], [-.7, -4.9], [.7, -4.9]][i % 6].slice(), y: SUB.FI}; return {bl: [i % 2 ? .9 : -.9, Math.min(BDECK.z1 - .5, BSPOT.hold[1] + 1.8 + Math.floor(i / 2))], y: BDECK.y}; }
// collisions in boat space: crew aboard meet the inside walls, swimmers and divers the outside of the hull (by depth)
function subPush(o, r, y) { const on = !!o.ob, sw = !on && o.sw, by = (on ? y : sw ? -(o.dv || 0) - B.heave : y - B.heave) - BDECK.y, [lx, lz] = bW2L(o.x, o.z), q = {x: lx, z: lz};
  pushRects(q, r, BW.filter(w => on ? !w.ext && !(w.door && LK.st === 0) : !w.int), sw ? by - .4 : by + .2, sw ? by + .4 : by + 1.7);
  if (q.x !== lx || q.z !== lz) { const [wx, wz] = bL2W(q.x, q.z); o.x = wx; o.z = wz; } }
// ---- the trunk ladder (P.climb.b 'bin': P.ob stays 1 and P.bl follows the climb), the bunk, the airlock teleports
function subClimb(up) { const T = SUB.TR, y1 = up ? SUB.CAS : SUB.FI; if (!up && P.eq >= 5) equip(0);
  P.climb = {t: 0, T: 1.1 + Math.abs(y1 - P.y) * .3, a: [P.bl[0], P.y, P.bl[1]], b: 'bin', up, f: [T.x, T.z + .12], e: [T.x, y1, up ? T.z + .85 : T.z - .75], p0: P.pitch, po: 0, yo: 0, y0: P.yaw, eye: P.eye, rT: 0, wet: 0, bY: B.yaw};
  P.vx = P.vz = P.vy = 0; P.cr = 0; P.run = 0; P.rest = 0; P.trunkT = G.t + P.climb.T + .4; if (!isHost()) act({a: 'trunk', T: P.climb.T}); }
function subRestStart() { P.rest = 1; P.cr = 1; P.vx = P.vz = 0; P.yaw = B.yaw + PI; P.pitch = .2; showMsg('W to get up.', '', 2); }
function subRest(dt) { if (K.KeyW || K.KeyA || K.KeyS || K.KeyD || ePress || !BG.sub || !P.ob || B.sink > 0 || P.down) { ePress = false; P.rest = 0; P.cr = 0; P.bl = [-.6, -1.6]; P.y = SUB.FI; return false; }
  P.bl = [-1.38, -2.05]; P.y = SUB.FI + .48; P.vx = P.vz = 0; P.eye = mix(P.eye, .22, Math.min(1, dt * 4)); [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); return true; }
// the periscope: the view rides the mast head while she is shallow, the mouse trains it round, E or WASD lets go
function subScope(on) { const el = SUBC.scV || (SUBC.scV = scopeEl());
  if (on) { if ((B.dep || 0) >= 3) return; if (P.eq > 1) equip(0); Object.assign(P, {scope: 1, bl: [0, SUB.SCOPE[1] + .55], y: SUB.FI, vx: 0, vz: 0, cr: 0, yaw: B.yaw, pitch: 0}); tone(70, .04, .6, 'sawtooth', null, 160); burst(900, .6, .04, .5, 'bandpass'); }
  else { P.scope = 0; G.fovAdd = 0; } el.style.display = on ? '' : 'none'; }
function subScopeStep(dt) { const dp = B.dep || 0;
  if (K.KeyW || K.KeyA || K.KeyS || K.KeyD || ePress || !BG.sub || !P.ob || B.sink > 0 || P.down || P.seat || dp >= 3) { if (BG.sub && dp >= 3) showMsg('Periscope down.', '', 1.5); ePress = false; subScope(0); return false; }
  P.vx = P.vz = 0; [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); P.pitch = clamp(P.pitch, -.4, .4);
  const b = Math.round(((-P.yaw * 180 / PI) % 360 + 360) % 360) % 360; if (b !== SUBC.scB) { SUBC.scB = b; SUBC.scV.lastChild.textContent = String(b).padStart(3, '0') + '°'; } return true; }
function scopeEl() { const d = document.createElement('div'), ln = 'position:absolute;left:50%;top:50%;background:rgba(10,20,12,.6);';
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;z-index:3;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 33vmin,rgba(0,0,0,.7) 34.5vmin,#000 36vmin)';
  d.innerHTML = `<div style="${ln}width:56vmin;height:1px;margin-left:-28vmin"></div><div style="${ln}height:44vmin;width:1px;margin-top:-22vmin"></div>` + [-2, -1, 1, 2].map(i => `<div style="${ln}width:1px;height:2.4vmin;margin:-1.2vmin 0 0 ${i * 9}vmin"></div>`).join('') + '<div style="position:absolute;left:50%;top:calc(50% - 30vmin);transform:translateX(-50%);font:bold 13px ui-monospace,monospace;color:#cfe8d0;text-shadow:0 1px 2px #000">000°</div>';
  document.body.appendChild(d); return d; }
function washOff() { Object.assign(P, {ob: 0, sw: 1, y: 0, dv: 0, vx: 0, vz: 0, vy: 0, climb: null, rest: 0}); Snd.splash(); showMsg('The sea closes over the deck. Swim!', '', 2.5); }
function lockDropOut() { if (!P.ob || !inLock(P) || LK.st !== 3) return; const [x, z] = bL2W(SUB.LD.x + .75, SUB.LD.z);
  Object.assign(P, {ob: 0, sw: 1, y: 0, x, z, vx: 0, vz: 0, vy: 0, climb: null, rest: 0, cr: 0, dv: Math.max(.6, lkDepth()), yaw: B.yaw - PI / 2}); bubbles(x, -P.dv, z, 20); Snd.bubbles();
  showMsg(P.own && P.own.suit ? 'You swim out of the airlock.' : 'Out of the airlock. Hold your breath!', '', 2.5); }
function lockIn() { const [x, z] = bL2W(1.0, 2.9); if (P.eq >= 5) equip(0); Object.assign(P, {sw: 0, dv: 0, deep: 0, ob: 1, seat: 0, climb: null, bl: [1.0, 2.9], y: SUB.FI, x, z, vx: 0, vz: 0, vy: 0, yaw: B.yaw + PI / 2, lastBY: B.yaw}); Snd.splash(); showMsg('In the airlock. Draining.', '', 2); }
// ---- host: the hatch, the dive interlock, grounding, the airlock cycle
function subAct(p, m) { if (!HC().sub) return; const id = p.id, no = why => emit({k: 'subno', id, why});
  if (m.a === 'trunk') { p.trunkT = G.t + clamp(+m.T || 2.5, 1, 4) + .8; return; } if (m.a === 'lock') { lockAct(p, m.op); return; }
  if (!p.ob || !p.bl || Math.hypot(p.bl[0] - SUB.TR.x, p.bl[1] - SUB.TR.z) > 2.4) return;
  if (m.o) { if (B.hat) return; if (!subSurf()) return no('Surface first.'); B.hat = 1; emit({k: 'hatch', o: 1}); }
  else { if (!B.hat) return; if (trunkBusy()) return no('Someone is in the trunk.'); B.hat = 0; emit({k: 'hatch', o: 0}); } }
function subDive(drv, dt) { const H = HC(); let dv = drv && drv.seat && drv.in ? drv.in[2] || 0 : 0; const mx = Math.max(0, Math.min(H.maxDep || 26, -seaBed(B.x, B.z) - 4));
  if (dv > 0 && (B.dtar || 0) < .05) { // diving from the surface: give the deck crew three seconds, then shut the hatch (not on someone in the trunk)
    const up = [...PL.values()].some(q => q.ready && !q.dead && q.ob && !q.seat && q.y > BDECK.y - .6 && freshP(q));
    if (up && !SUBC.dq) { SUBC.dq = G.t + 3; emit({k: 'dive', warn: 1}); }
    if (SUBC.dq && G.t < SUBC.dq) dv = 0;
    else if (B.hat) { if (trunkBusy()) { dv = 0; if (G.t - (SUBC.trT ?? -9) > 3) { SUBC.trT = G.t; emit({k: 'subno', id: B.driver, why: 'Hatch open. Someone is in the trunk.'}); } } else { B.hat = 0; emit({k: 'hatch', o: 0, auto: 1}); } } }
  if (dv <= 0 && SUBC.dq && G.t > SUBC.dq + 4) SUBC.dq = 0;
  const was = B.dtar || 0; B.dtar = clamp(was + dv * dt * 2.2, 0, mx); if (was < .05 && B.dtar >= .05) { SUBC.dq = 0; emit({k: 'dive'}); }
  B.dep = (B.dep || 0) + clamp(B.dtar - (B.dep || 0), -dt * 1.6, dt * 1.6);
  if (B.hat && B.dep > .5) { B.hat = 0; emit({k: 'hatch', o: 0, auto: 1}); }
  SUBC.ox = B.x; SUBC.oz = B.z; }
// she draws 3.7 m (more when dived): rising sea bed ahead lifts her, a bank she cannot clear stops her
function subGround() { if (SUBC.ox == null || Math.abs(B.v) < .05) return; const [sx, sz] = bL2W(0, B.v > 0 ? BG.zb + 2 : BG.zs - 3), bed = seaBed(sx, sz), keel = -(3.7 + (B.dep || 0));
  if (-bed - 4 < (B.dtar || 0)) B.dtar = Math.max(0, -bed - 4);
  if (bed > keel) { B.x = SUBC.ox; B.z = SUBC.oz; const hv = Math.abs(B.v); B.v *= .3; if (hv > 1.5 && G.t - (SUBC.gT ?? -9) > 2) { SUBC.gT = G.t; emit({k: 'bump', s: Math.min(1, hv / 7)}); if (B.driver) emit({k: 'subno', id: B.driver, why: 'Too shallow for the sub.'}); } } }
function setLk(st, ids) { LK.st = st; LK.t = 0; if (st !== 3) LK.ent = -1; emit(ids && ids.length ? {k: 'lock', st, ids} : {k: 'lock', st}); }
const lkIn = () => [...PL.values()].filter(q => q.ready && !q.dead && inLock(q)), lkBad = q => lkDepth() + .5 > (SUIT[suitOf(q)] || SUIT[0]).max - 1;
function subHost(dt) { if (B.sink > 0) return; LK.t += dt;
  switch (LK.st) {
    case 1: if (LK.t >= .8) setLk(2); break;
    case 2: LK.w = Math.min(1, LK.w + dt / 6); if (LK.w >= 1) { const L = lkIn(), bad = L.find(lkBad); if (bad) { emit({k: 'subno', id: bad.id, why: 'Too deep for your gear. Draining.'}); setLk(5); } else setLk(3, L.map(q => q.id)); } break;
    case 3: if (LK.ent >= 0 && G.t - LK.ent > 2.5) setLk(4); break;
    case 4: if (LK.t >= 1) setLk(5); break;
    case 5: LK.w = Math.max(0, LK.w - dt / 6); if (LK.w <= 0) setLk(6); break;
    case 6: if (LK.t >= .8) setLk(0); break; } }
function lockAct(p, op) { if (!HC().sub || B.sink > 0) return; const id = p.id, no = why => emit({k: 'subno', id, why});
  const [dx, dz] = bL2W(SUB.LD.x + .5, SUB.LD.z), near = p.sw && Math.hypot(p.x - dx, p.z - dz) < 3.5 && Math.abs((p.dv || 0) - lkDepth()) < 3, L = lkIn();
  if (op === 'out') { if (LK.st !== 0 || !inLock(p)) return; if ([...PL.values()].some(q => q.ready && !q.dead && !inLock(q) && inDoorway(q))) return no('Doorway blocked.');
    const bad = L.find(lkBad); if (bad) { const su = suitOf(bad); return no(su ? `Too deep for the ${SUIT[su].n}.` : 'No dive gear. Not at this depth.'); } setLk(1); }
  else if (op === 'knock') { if (!near) return; if (LK.st === 3) return lockAct(p, 'enter'); if (LK.st !== 0) return; if (L.length) return no('Someone is in the airlock.'); setLk(1); }
  else if (op === 'enter') { if (!near || LK.st !== 3) return; LK.ent = G.t; emit({k: 'lin', id}); }
  else if (op === 'drain') { if (LK.st !== 3 || !p.ob || !p.bl || Math.hypot(p.bl[0] - .9, p.bl[1] - 2.9) > 3) return; setLk(4); } }
// ---- events (all clients)
function lockSfx(st) { if (!A.on || !BOAT || !BG.sub) return; const [x, z] = bL2W(1, 2.9), p = at(x, SUB.FI + 1 + B.heave, z, 3);
  if (st === 1 || st === 6) { burst(160, 1, .35, .2, 'lowpass', p); Snd.valve(p); } else if (st === 2) { burst(700, .5, .2, 1.2, 'bandpass', p); Snd.bubbles(); } else if (st === 3) { Snd.clang(p); Snd.bubbles(); }
  else if (st === 4) { burst(160, 1, .4, .25, 'lowpass', p); tone(90, .1, .4, 'triangle', p); } else if (st === 5) Snd.valve(p); else tone(880, .03, .5, 'sine', p); }
function subEv(e, me) {
  if (e.k === 'hatch') { B.hat = e.o ? 1 : 0; if (A.on && BG.sub) { const [x, z] = bL2W(SUB.TR.x, SUB.TR.z), p = at(x, SUB.CAS + .4 + B.heave, z, 4); if (e.o) { Snd.valve(p); tone(90, .05, .6, 'sawtooth', p, 60); } else Snd.clang(p); } if (e.auto && P && subInside()) showMsg('Hatch shut. Diving.', '', 2); }
  else if (e.k === 'dive') { if (A.on && BG.sub) Snd.klaxon(at(B.x, B.heave + 1, B.z, 10)); if (P && P.ob && !P.sw) { const up = !subInside() && !P.seat, t = e.warn ? (up ? 'Diving in 3. Get below!' : P.seat ? 'Clear the deck. Diving in 3.' : 'Diving in 3.') : up ? 'Hatch shut. Hold on or swim!' : P.seat ? '' : 'Diving.'; if (t) showMsg(t, '', e.warn ? 3 : 2); } }
  else if (e.k === 'lock') { LK.st = e.st; LK.t = 0; lockSfx(e.st); if (e.ids && P && e.ids.includes(me)) P.lkOut = .7; }
  else if (e.k === 'lin') { if (e.id === me) lockIn(); }
  else if (e.k === 'subno' && e.id === me) { showMsg(e.why, '', 2.5); tone(180, .05, .25, 'triangle', null, 120); } }
// ---- rendering: is the camera inside, the waterline cut-out, lamps, fog, the moving parts and screens
function camInSub() { if (!BG.sub || !BOAT || B.sink > 0) return false; _sc.copy(cam.position); BOAT.worldToLocal(_sc); const S = SUB, x = _sc.x, y = _sc.y, z = _sc.z; G.subL = [x, y, z];
  if (z < S.zB) return Math.hypot(x, y - S.cy, z - S.zB) < S.dR - .05 && y > S.FI - .3;
  if (z < S.zE + .3 && y > S.FI - .3 && Math.hypot(x, y - S.cy) < S.Ri + .05) return true;
  return Math.hypot(x - S.TR.x, z - S.TR.z) < S.TR.r + .05 && y > S.FI && y < S.CAS + .35; }
const lockWet = () => { const c = G.subL, L = SUB.LKR; return !!(G.subIn && c && c[0] > L.x0 && c[0] < L.x1 + .5 && c[2] > L.z0 && c[2] < L.z1 && c[1] < SUB.FI + 2.3 * (LK.wv || 0)); };
// the hull's waterline at local height h as a stadium [half width, bow end, stern end] (null when the water is over the casing)
function subWL(h) { const U = SUB; if (h > U.CAS) return null; const d = Math.abs(h - U.cy); let w = d < U.R ? Math.sqrt(U.R * U.R - d * d) : 0, z0 = d < U.dR ? U.zB - Math.sqrt(U.dR * U.dR - d * d) : U.zB, z1 = d <= .55 ? U.tail : d < U.R ? U.zA + 2.6 * Math.pow(1 - (d - .55) / 1.95, 1 / 1.6) : U.zA;
  if (h > 1.05) { w = Math.max(w, U.cx); z0 = Math.min(z0, U.cz0 - .6); z1 = Math.max(z1, U.cz1 + .8); } w += .08; if (z1 - z0 < 2 * w + .2) { const m = (z0 + z1) / 2; z0 = m - w - .1; z1 = m + w + .1; } return [w, z0 - .1, z1 + .1]; }
function subFx(dt) { G.subIn = camInSub(); const dp = B.dep || 0, dived = dp > 1.5, U = SUBC.U, sh = MAT.sea.userData.sh;
  if (U) { U.uFogK.value = G.subIn ? 0 : 1; U.uHemi.value = G.subIn ? (dived ? .05 : .16) : .3; if (G.subIn) U.uFill.value.setRGB(dived ? .034 : .066, dived ? .006 : .054, dived ? .004 : .04); else U.uFill.value.setRGB(.03, .025, .02); }
  if (sh && B.sink <= 0) { const w = subWL(dp - .6 * clamp(1 - dp, 0, 1) * G.sea); if (w) sh.uniforms.uBd.value.set(w[0], w[1], w[2], 2); else sh.uniforms.uBd.value.w = 0; }
  if (!G.subIn) return;
  scene.fog.density = Math.min(scene.fog.density, .035); if (SNOW) SNOW.visible = false;
  // two pooled lamps follow you through the boat: this compartment's first, then the nearest one past a bulkhead
  const c = G.subL, cmp = z => z < -8.6 ? 0 : z < -2.6 ? 1 : z < 4.2 ? 2 : 3, cc = cmp(c[2]); let a = null, b = null, da = 1e9, db = 1e9;
  for (const q of SUB.lamps) { const d = (q[0] - c[0]) ** 2 + 4 * (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 + (cmp(q[2]) === cc ? 0 : 30); if (d < da) { b = a; db = da; a = q; da = d; } else if (d < db) { b = q; db = d; } }
  const fl = (G.shake || 0) > .3 && Math.random() < .3 ? .3 : 1;
  for (let i = 0; i < 2; i++) { const l = POOL[i], q = i ? b : a; if (!q) { l.intensity = 0; continue; } l.position.copy(_sb.set(q[0], q[1], q[2]).applyMatrix4(BOAT.matrixWorld)); l.color.setHex(dived ? 0xff3a22 : 0xffc890); l.distance = 6; l.intensity = (dived ? 4.5 : 7) * fl * (i ? .8 : 1); } }
function subPose(dt) { const U = BOAT.userData, dp = B.dep || 0, dived = dp > 1.5, k3 = Math.min(1, dt * 3);
  G.hatA = mix(G.hatA ?? B.hat, B.hat ? 1 : 0, Math.min(1, dt * 4)); U.hatch.rotation.x = -1.75 * G.hatA;
  G.mastU = mix(G.mastU ?? 1, dp < 3 ? 1 : 0, Math.min(1, dt * .8)); U.masts.position.y = (G.mastU - 1) * 1.9; U.scope.position.y = (G.mastU - 1) * .6;
  const dr = clamp(((B.dtar || 0) - dp) * .25, -.35, .35); U.bowPl.rotation.x = -dr; U.sailPl.rotation.x = -.7 * dr; U.sternPl.rotation.x = dr; U.rud.rotation.y = (B.st || 0) * .45;
  LK.wv = isHost() ? LK.w : mix(LK.wv ?? LK.tw ?? 0, LK.tw ?? 0, Math.min(1, dt * 4)); G.lkI = mix(G.lkI ?? 1, LK.st === 0 ? 1 : 0, k3); G.lkO = mix(G.lkO ?? 0, LK.st === 3 ? 1 : 0, k3);
  U.lkI.position.z = -.95 * G.lkI; U.lkO.position.z = .9 * G.lkO; U.lkOi.position.z = .85 * G.lkO; U.lkW.visible = LK.wv > .01; U.lkW.scale.y = 2.3 * Math.max(.001, LK.wv);
  for (const m of U.lkLampM) { m.emissive.setHex(LK.st === 0 ? 0x30ff50 : LK.st === 3 ? 0xff2a10 : 0xffa020); m.emissiveIntensity = LK.st === 0 || LK.st === 3 ? 1.6 : Math.sin(G.wt * 9) > 0 ? 2 : .3; }
  U.lampM.emissive.setHex(dived ? 0xff2a18 : 0xffd8a0); U.lampM.emissiveIntensity = dived ? .9 : 1.2; U.scrM.emissiveIntensity = dived ? .9 : .5;
  const lon = dp > 1 || TOD.night > .3; U.lensM.emissiveIntensity = lon ? 2.5 : .2; U.beams.visible = lon && B.sink <= 0;
  const mo = U.motes; mo.visible = dp > 2 && B.sink <= 0 && (G.subIn || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < 30); if (mo.visible) { const a = mo.geometry.attributes.position, v = (Math.max(0, B.v) + .2) * dt; for (let i = 0; i < a.count; i++) { let z = a.getZ(i) + v; if (z > -12.6) z -= 12; a.setXYZ(i, a.getX(i) + Math.sin(G.wt * .3 + i) * dt * .05, a.getY(i) + Math.sin(G.wt * .2 + i * 1.7) * dt * .04, z); } a.needsUpdate = true; }
  const cd = Math.hypot(cam.position.x - B.x, cam.position.z - B.z); U.inner.visible = !!G.subIn || cd < 8 || (cd < 22 && G.subL && G.subL[2] < -9); U.glow.visible = !G.subIn; // from outside the interior only shows through the dome, the hatch or the lock
  BOAT.updateMatrixWorld();
  if (LK.st === 2 && G.subIn && Math.random() < dt * 14) { _sb.set(.4 + Math.random() * 1.3, SUB.FI + .05, 2.1 + Math.random() * 1.6); BOAT.localToWorld(_sb); bubbles(_sb.x, _sb.y, _sb.z, 2); }
  if (G.subIn) subScreens(dt); }
function subScreens(dt) { const S = SUBC, c = G.subL; if (!c) return;
  if ((S.sT = (S.sT || 0) - dt) <= 0 && Math.hypot(c[0] - 1.5, c[2] + 7.5) < 7) { S.sT = 1 / 15; drawSonar(); }
  const dp = B.dep || 0; if (Math.abs(dp - (S.dl ?? -9)) > .05 || (S.dT = (S.dT || 0) - dt) <= 0) { S.dl = dp; S.dT = .5; drawDepth(); }
  const sig = (B.hat ? 1 : 0) + ':' + LK.st + ':' + ((B.dtar || 0) > .05 ? 1 : 0); if (sig !== S.iSig) { S.iSig = sig; drawInd(); } }
// sonar: a sweeping green scope, 150 m range; contacts are painted as the beam passes them
function drawSonar() { const S = SUBC, q = S.son.getContext('2d'), W = 256, C = 128, Rr = 116, a = (G.wt * 1.3) % TAU, pa = S.sonA == null ? a - .1 : S.sonA, k = Rr / 150; S.sonA = a;
  q.fillStyle = 'rgba(0,16,8,.3)'; q.fillRect(0, 0, W, W); q.strokeStyle = 'rgba(70,255,140,.22)'; q.lineWidth = 1; q.beginPath(); for (let i = 1; i <= 3; i++) { q.moveTo(C + Rr * i / 3, C); q.arc(C, C, Rr * i / 3, 0, TAU); } q.moveTo(C - Rr, C); q.lineTo(C + Rr, C); q.moveTo(C, C - Rr); q.lineTo(C, C + Rr); q.stroke();
  const sp = ((a - pa) % TAU + TAU) % TAU, hit = b => ((b - pa) % TAU + TAU) % TAU <= sp + .03;
  const blip = (x, z, col, s) => { const [lx, lz] = bW2L(x, z), d = Math.hypot(lx, lz); if (d > 150 + s / k || !hit(Math.atan2(lx, -lz))) return; q.fillStyle = col; q.beginPath(); q.arc(C + lx * k, C + lz * k, Math.max(2, s), 0, TAU); q.fill(); };
  for (const I of ISLES) if (Math.hypot(I.x - B.x, I.z - B.z) - I.r < 150) blip(I.x, I.z, 'rgba(90,255,140,.55)', Math.min(60, I.r * k));
  for (const f of G.floats) if (f) blip(f[0], f[1], '#c8ff60', 2.5); for (const g of GUL) if (g && g.on) blip(g.x, g.z, '#ffb030', 3.5);
  for (const p of PL.values()) if (p.sw && !p.dead) blip(p.x, p.z, '#80e8ff', 3); if (B.up.sonar) for (const s of SUNK) if (!s.got) blip(s.x, s.z, '#ffe060', 2.5); if (G.spines && LEV.hp) blip(LEV.hp.x, LEV.hp.z, '#ff3020', 7);
  q.strokeStyle = 'rgba(150,255,180,.95)'; q.lineWidth = 2; q.beginPath(); q.moveTo(C, C); q.lineTo(C + Math.sin(a) * Rr, C - Math.cos(a) * Rr); q.stroke();
  q.fillStyle = '#000e06'; q.fillRect(0, 0, 66, 22); q.fillRect(0, 234, 104, 22); q.fillRect(190, 0, 66, 22); q.fillStyle = '#8affb0'; q.font = 'bold 15px monospace'; q.textAlign = 'left';
  q.fillText(`${(B.dep || 0).toFixed(0)} M`, 6, 16); q.fillText(`KEEL ${Math.max(0, -seaBed(B.x, B.z) - 3.5 - (B.dep || 0)).toFixed(0)}`, 6, 250); q.fillText(String(Math.round(((-B.yaw * 180 / PI) % 360 + 360) % 360)).padStart(3, '0') + '°', 196, 16);
  S.sonT.needsUpdate = true; }
function drawDepth() { const S = SUBC, q = S.dep.getContext('2d'), C = 64, dp = B.dep || 0, mx = HC().maxDep || 80, ang = v => (-135 + 270 * clamp(v / 100, 0, 1)) * PI / 180 - PI / 2;
  q.fillStyle = '#ece6d4'; q.fillRect(0, 0, 128, 128); q.strokeStyle = '#b02010'; q.lineWidth = 7; q.beginPath(); q.arc(C, C, 50, ang(mx), ang(100)); q.stroke();
  q.strokeStyle = q.fillStyle = '#1a1a1a'; q.font = 'bold 11px sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle';
  for (let v = 0; v <= 100; v += 10) { const t = ang(v), r0 = v % 20 ? 50 : 45; q.lineWidth = v % 20 ? 1.5 : 2.5; q.beginPath(); q.moveTo(C + Math.cos(t) * r0, C + Math.sin(t) * r0); q.lineTo(C + Math.cos(t) * 55, C + Math.sin(t) * 55); q.stroke(); if (!(v % 20)) q.fillText(v, C + Math.cos(t) * 36, C + Math.sin(t) * 36); }
  q.font = 'bold 14px monospace'; q.fillText(dp.toFixed(dp < 10 ? 1 : 0) + ' m', C, C + 30); q.font = '8px sans-serif'; q.fillText('DEPTH', C, C - 20);
  const t = ang(dp); q.strokeStyle = '#c01810'; q.lineWidth = 3; q.beginPath(); q.moveTo(C - Math.cos(t) * 8, C - Math.sin(t) * 8); q.lineTo(C + Math.cos(t) * 48, C + Math.sin(t) * 48); q.stroke(); q.fillStyle = '#222'; q.beginPath(); q.arc(C, C, 5, 0, TAU); q.fill(); S.depT.needsUpdate = true; }
function drawInd() { const S = SUBC, q = S.ind.getContext('2d'), dv = (B.dtar || 0) > .05; q.fillStyle = '#101414'; q.fillRect(0, 0, 128, 64); q.font = 'bold 11px monospace'; q.textAlign = 'left'; q.textBaseline = 'alphabetic';
  [['HATCH', B.hat ? '#ff4030' : '#40ff70', B.hat ? 'OPEN' : 'SHUT'], ['LOCK', LK.st === 0 ? '#40ff70' : LK.st === 3 ? '#ff4030' : '#ffb020', ['DRY', 'SEAL', 'FLOOD', 'OPEN', 'SHUT', 'DRAIN', 'VENT'][LK.st] || ''], ['DIVE', dv ? '#ffb020' : '#40ff70', dv ? 'DIVE' : 'SURF']]
    .forEach(([n, c, s], i) => { const y = 12 + i * 20; q.fillStyle = c; q.beginPath(); q.arc(10, y, 6, 0, TAU); q.fill(); q.fillStyle = '#c8d0c8'; q.fillText(n, 22, y + 4); q.fillStyle = c; q.fillText(s, 78, y + 4); }); S.indT.needsUpdate = true; }
// gulpers swim around the hull, not through it; lit floodlights chase them off the bow
function subGulPush(g) { const [lx, lz] = bW2L(g.x, g.z), ly = g.y - B.heave, U = SUB, m = .9, lo = U.cy - U.R - m;
  if ((B.dep || 0) > 1 && lz < -12 && lz > -24 && Math.abs(lx) < 5 && g.st !== 3) { g.st = 3; g.t = 0; }
  if (lz < -13.6 || lz > 10.8 || Math.abs(lx) > U.R + m || ly < lo || ly > 2.4) return;
  const ex = U.R + m - Math.abs(lx), ey = Math.min(ly - lo, 2.4 - ly); if (ex < ey) { const [wx, wz] = bL2W(Math.sign(lx || 1) * (U.R + m), lz); g.x = wx; g.z = wz; } else g.y = (ly - lo < 2.4 - ly ? lo : 2.4) + B.heave; }
// ---- sound loops: the flooding chamber, the pump, ballast air; hull ticks, drips and pings while you are inside
function subLoops(c) { if (!c || !A.noise || !A.mute) return null; const L = (f, q, type, dst) => { const s = c.createBufferSource(); s.buffer = A.noise; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(dst); s.start(); return {s, f: fl, g}; };
  const p = c.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 2, rolloffFactor: 1.2}); p.connect(A.out);
  const o = c.createOscillator(), of = c.createBiquadFilter(), pg = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 95; of.type = 'lowpass'; of.frequency.value = 260; pg.gain.value = 0; o.connect(of); of.connect(pg); pg.connect(p); o.start();
  const S = {p, lw: L(500, .7, 'lowpass', p), pg, bal: L(1700, .6, 'bandpass', A.bPan)}; A.mute.push(S.lw.g, pg, S.bal.g); return S; }
function subAudio(dt, t, sT) { const S = A.sub || (A.sub = subLoops(A.ctx)); if (!S) return; const E = A.E, dp = B.dep || 0, dtr = B.dtar || 0, [cx, cz] = bL2W(1, 2.9); setPan(S.p, cx, SUB.FI + 1 + B.heave, cz);
  sT(S.lw.g.gain, LK.st === 2 ? .07 : 0); sT(S.pg.gain, LK.st === 5 ? .05 : 0); sT(S.bal.g.gain, clamp(Math.abs(dtr - (E.dt0 ?? dtr)) / Math.max(dt, 1e-3) / 2.2, 0, 1) * .035 + (LK.st === 1 || LK.st === 6 ? .03 : 0)); E.dt0 = dtr;
  const sd = Math.abs(dp - (E.sdp ?? dp)) / Math.max(dt, 1e-3); E.sdp = dp; if (!G.subIn) return;
  const pt = () => { _sb.set((Math.random() < .5 ? -1 : 1) * 1.7, SUB.FI + 1.5 + Math.random() * .8, mix(SUB.zF, SUB.zE, Math.random())); BOAT.localToWorld(_sb); return at(_sb.x, _sb.y, _sb.z, 2); };
  if (Math.random() < (clamp(sd, 0, 2) * 1.2 + (dp > 20 ? .15 : 0)) * dt) Snd.hullTick(pt()); if (dp > 6 && Math.random() < dt * (.15 + dp / 400)) Snd.drip(pt());
  if (dp > 2 && (E.pgT = (E.pgT ?? 2) - dt) <= 0) { E.pgT = 4; const [px, pz] = bL2W(1.5, -7.5); Snd.ping(at(px, SUB.FI + 1.2 + B.heave, pz, 3)); } }

// ---------------- rig creature navigation
const NG = {x0: -24, z0: -24, n: 48, cells: null};
function buildNav() {
  const n = NG.n, L = LV.length; NG.cells = new Uint8Array(L * n * n);
  for (let l = 0; l < L; l++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = NG.x0 + i + .5, z = NG.z0 + j + .5, f = floorAt(x, z, LV[l] + .1, true);
    if (!f || Math.abs(f.y - LV[l]) > .05 || f.s.k !== 'slab') continue;
    let bad = false; for (const w of WALLS) { if (w.y1 < LV[l] + .3 || w.y0 > LV[l] + 1.6) continue; if (x > w.x0 - .45 && x < w.x1 + .45 && z > w.z0 - .45 && z < w.z1 + .45) { bad = true; break; } }
    if (!bad) NG.cells[l * n * n + j * n + i] = 1;
  }
  NG.links = new Map();
  const link = (a, b, via) => { if (a < 0 || b < 0) return; (NG.links.get(a) || NG.links.set(a, []).get(a)).push({to: b, via}); (NG.links.get(b) || NG.links.set(b, []).get(b)).push({to: a, via: via.slice().reverse()}); };
  for (const s of SURF) if (s.k === 'ramp') {
    const la = LV.indexOf(s.y0), lb = LV.indexOf(s.y1); if (la < 0 || lb < 0) continue;
    const pts = []; let a, b;
    if (s.ax === 'x+') { const z = (s.z0 + s.z1) / 2; a = nodeNear(s.x0 - .8, z, la, 3); b = nodeNear(s.x1 + .8, z, lb, 3); for (let t = 0; t <= 1; t += .25) pts.push([mix(s.x0, s.x1, t), z]); }
    else { const x = (s.x0 + s.x1) / 2; a = nodeNear(x, s.z0 - .8, la, 3); b = nodeNear(x, s.z1 + .8, lb, 3); for (let t = 0; t <= 1; t += .25) pts.push([x, mix(s.z0, s.z1, t)]); }
    link(a, b, pts);
  }
}
const nIdx = (l, i, j) => l * NG.n * NG.n + j * NG.n + i;
const nPos = k => { const n = NG.n, l = Math.floor(k / (n * n)), r = k % (n * n), j = Math.floor(r / n), i = r % n; return [NG.x0 + i + .5, NG.z0 + j + .5, l]; };
function nodeNear(x, z, l, rad = 6) { const n = NG.n, ci = Math.floor(x - NG.x0), cj = Math.floor(z - NG.z0); let best = -1, bd = 1e9; for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(l, i, j); if (!NG.cells[k]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; } } return best; }
function levelOf(y) { let b = 0, bd = 1e9; for (let l = 0; l < LV.length; l++) { const d = Math.abs(y - LV[l]); if (d < bd) { bd = d; b = l; } } return b; }
function astar(s, g) {
  if (s < 0 || g < 0) return null; if (s === g) return [s];
  const n = NG.n, open = [s], came = new Map(), gs = new Map([[s, 0]]), closed = new Set(); const [gx, gz, gl] = nPos(g);
  const hh = k => { const [x, z, l] = nPos(k); return Math.hypot(x - gx, z - gz) + Math.abs(l - gl) * 10; };
  const fs = new Map([[s, hh(s)]]); let it = 0;
  while (open.length && it++ < 9000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (fs.get(open[i]) < fs.get(open[bi])) bi = i;
    const c = open.splice(bi, 1)[0]; if (c === g) { const path = [c]; let k = c; while (came.has(k)) { k = came.get(k); path.unshift(k); } return path; }
    closed.add(c); const [cx, cz, cl] = nPos(c), ci = Math.floor(cx - NG.x0), cj = Math.floor(cz - NG.z0); const nb = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = nIdx(cl, i, j); if (!NG.cells[k]) continue; if (di && dj && (!NG.cells[nIdx(cl, ci + di, cj)] || !NG.cells[nIdx(cl, ci, cj + dj)])) continue; nb.push([k, Math.hypot(di, dj)]); }
    for (const lk of NG.links.get(c) || []) nb.push([lk.to, 12]);
    for (const [k, w] of nb) { if (closed.has(k)) continue; const t = gs.get(c) + w; if (t < (gs.get(k) ?? 1e9)) { came.set(k, c); gs.set(k, t); fs.set(k, t + hh(k)); if (!open.includes(k)) open.push(k); } }
  }
  return null;
}
function navPath(fx, fy, fz, tx, ty, tz) {
  const s = nodeNear(fx, fz, levelOf(fy)), g = nodeNear(tx, tz, levelOf(ty), 10); const p = astar(s, g); if (!p) return null;
  const out = []; for (let i = 0; i < p.length; i++) { const a = p[i]; out.push(nPos(a)); if (i < p.length - 1) { const lk = (NG.links.get(a) || []).find(q => q.to === p[i + 1]); if (lk) for (const v of lk.via) out.push([v[0], v[1], -1]); } }
  const sm = [out[0]]; let i = 0;
  while (i < out.length - 1) { let j = i + 1; while (j + 1 < out.length && out[j + 1][2] === out[i][2] && out[i][2] >= 0 && clearLine(out[i][0], out[i][1], out[j + 1][0], out[j + 1][1], LV[out[i][2]] + 1)) j++; sm.push(out[j]); i = j; }
  sm.push([tx, tz, levelOf(ty)]); return sm;
}
function clearLine(ax, az, bx, bz, y) { for (const w of WALLS) { if (w.y1 < y - .7 || w.y0 > y + .5) continue; if (segRect(ax, az, bx, bz, {x0: w.x0 - .35, x1: w.x1 + .35, z0: w.z0 - .35, z1: w.z1 + .35})) return false; } return true; }

// ---------------- physics helpers
function floorAt(x, z, y, noBoat, inner) {
  // inside the sub (inner): the inner deck, or the casing straight above it when you stand in the trunk
  if (inner && BOAT && B.sink <= 0) { const [lx, lz] = bW2L(x, z); let F = null, T = null; for (const q of BFL) { if (lx <= q.x0 || lx >= q.x1 || lz <= q.z0 || lz >= q.z1 || q.y > y + .75) continue; if (q.int) F = q; else if (!T || q.y > T.y) T = q; } if (F) return {y: (T || F).y, s: {k: 'boat'}}; }
  let best = null;
  for (const s of SURF) { if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue; let h; if (s.k === 'slab') h = s.y; else if (s.k === 'ramp') h = rampY(s, x, z); else { if (Math.hypot(x - s.x, z - s.z) > s.r) continue; h = s.y; } if (h <= y + .75 && (!best || h > best.y)) best = {y: h, s}; }
  const lh = landH(x, z); if (lh > -8 && lh <= y + .75 && (!best || lh > best.y)) best = {y: lh, s: {k: 'land'}};
  if (!noBoat && BOAT && B.sink <= 0 && !(BG.sub && (B.dep || 0) > .3)) { const [lx, lz] = bW2L(x, z); for (const q of BFL) { if (q.int || lx <= q.x0 || lx >= q.x1 || lz <= q.z0 || lz >= q.z1) continue; if (q.y <= y + .75 && (!best || q.y > best.y)) best = {y: q.y, s: {k: 'boat'}}; } }
  return best;
}
function segRect(ax, az, bx, bz, r) { let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az; for (const [p, d, lo, hi] of [[ax, dx, r.x0, r.x1], [az, dz, r.z0, r.z1]]) { if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; } let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false; } return true; }
function pushRects(o, r, list, y0, y1) {
  for (const w of list) {
    if (w.y1 < y0 || w.y0 > y1) continue;
    if (o.x < w.x0 - r || o.x > w.x1 + r || o.z < w.z0 - r || o.z > w.z1 + r) continue;
    const cx = clamp(o.x, w.x0, w.x1), cz = clamp(o.z, w.z0, w.z1), dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d < r) { o.x = cx + dx / d * r; o.z = cz + dz / d * r; } }
    else { const l = o.x - w.x0, rr = w.x1 - o.x, t = o.z - w.z0, b = w.z1 - o.z, m = Math.min(l, rr, t, b); if (m === l) o.x = w.x0 - r; else if (m === rr) o.x = w.x1 + r; else if (m === t) o.z = w.z0 - r; else o.z = w.z1 + r; }
  }
}
function pushBody(o, r, y) {
  if (BG.sub && BOAT && o.ob && y < BDECK.y - 1) { subPush(o, r, y); return; }
  pushRects(o, r, WALLS, y + .2, y + 1.7);
  for (const c of PCIRC) { if (Math.abs(o.x - c.x) > c.r + 1 || Math.abs(o.z - c.z) > c.r + 1) continue; const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz); if (d < c.r + r && d > 1e-4 && y < 25) { o.x = c.x + dx / d * (c.r + r); o.z = c.z + dz / d * (c.r + r); } }
  if (BOAT && Math.hypot(o.x - B.x, o.z - B.z) < BG.L * .55 + 3) { if (BG.sub) { subPush(o, r, y); return; } const [lx, lz] = bW2L(o.x, o.z), q = {x: lx, z: lz}; pushRects(q, r, BW.filter(w => !w.hatch || (B.dep || 0) > .6), y - BDECK.y + .2, y - BDECK.y + 1.7); if (q.x !== lx || q.z !== lz) { const [wx, wz] = bL2W(q.x, q.z); o.x = wx; o.z = wz; } }
}
function seeLine(ax, ay, az, bx, by, bz) { if (Math.abs(ay - by) > 3.8) return false; const h = (ay + by) / 2 + 1.3; for (const w of WALLS) { if (!w.see || w.y0 > h || w.y1 < h) continue; if (segRect(ax, az, bx, bz, w)) return false; } return true; }
const nearRig = (x, z) => Math.hypot(x, z) < 45;

// ---------------- creature on the rig
const MON = new THREE.Group(), MJ = {fing: []};
function buildCreature() { makeCreature(MON, MJ); }
function makeCreature(MON, MJ, o = {}) {
  // a gaunt, wet, eyeless thing: lathe torso with ribs, long three-joint arms with clawed fingers, digitigrade legs, a skull that splits open
  const skT = tex(cv(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5e58'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) { g.fillStyle = `rgba(${18 + Math.random() * 40 | 0},${20 + Math.random() * 38 | 0},${20 + Math.random() * 30 | 0},${.18 + Math.random() * .4})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 16, 0, TAU); g.fill(); }
    g.lineWidth = 1.3; for (let i = 0; i < 46; i++) { let x = Math.random() * w, y = Math.random() * h; g.strokeStyle = `rgba(${60 + Math.random() * 40 | 0},20,30,.4)`; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (Math.random() - .5) * 26; y += Math.random() * 18; g.lineTo(x, y); } g.stroke(); }
    noiseFill(g, w, h, 34);
  }), 2);
  const skin = new THREE.MeshStandardMaterial({map: skT, bumpMap: skT, bumpScale: 2.5, color: o.col || 0x4a504a, roughness: .38, metalness: 0, envMapIntensity: .35});
  const bone = new THREE.MeshStandardMaterial({color: 0xc8bea0, roughness: .3}), gum = new THREE.MeshStandardMaterial({color: 0x3a0a0c, roughness: .25}), hole = new THREE.MeshBasicMaterial({color: 0x020202});
  const eye = new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(.75, .85, .7)});
  const mesh = (g, m = skin) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };
  const seg = (r0, r1, l, m = skin, rs = 9) => { const g = new THREE.CylinderGeometry(r0 * 1.4, r1 * 1.4, l, rs, 2); g.translate(0, -l / 2, 0); return mesh(g, m); };
  const knob = (r, p, y = 0) => { const s = mesh(new THREE.SphereGeometry(r, 9, 7)); s.position.y = y; p.add(s); return s; };
  const hips = new THREE.Group(); hips.position.y = 1.2; MON.add(hips); MJ.hips = hips;
  const pel = mesh(new THREE.SphereGeometry(.14, 12, 8)); pel.scale.set(1.15, .7, .75); hips.add(pel);
  const torso = new THREE.Group(); hips.add(torso); MJ.torso = torso;
  const prof = [[.02, -.04], [.12, 0], [.12, .08], [.08, .22], [.085, .3], [.15, .42], [.185, .55], [.195, .66], [.175, .76], [.11, .82], [.04, .86]].map(([r, y]) => new THREE.Vector2(r, y));
  const tg = new THREE.LatheGeometry(prof, 16); tg.scale(1.15, 1, .7); const tm = mesh(tg); torso.add(tm); MJ.chest = tm;
  for (let i = 0; i < 6; i++) { const y = .43 + i * .062, r = [.155, .175, .188, .195, .19, .18][i]; const rb = mesh(new THREE.TorusGeometry(r * 1.03, .012, 4, 16, PI * 1.1), skin); rb.rotation.set(PI / 2, 0, -.05 * PI); rb.scale.set(1, .62, 1); rb.position.y = y; torso.add(rb); }
  for (let i = 0; i < 9; i++) { const s = mesh(new THREE.SphereGeometry(.03, 6, 4)); s.position.set(0, .12 + i * .085, -(i < 4 ? .07 : .1)); torso.add(s); }
  for (const s of [-1, 1]) { const b = mesh(new THREE.SphereGeometry(.09, 8, 6)); b.scale.set(1, 1.3, .35); b.position.set(s * .1, .64, -.1); torso.add(b); }
  const neck = new THREE.Group(); neck.position.y = .83; torso.add(neck); MJ.neck = neck;
  const ng = new THREE.CylinderGeometry(.045, .06, .26, 8); ng.translate(0, .13, 0); neck.add(mesh(ng));
  const head = new THREE.Group(); head.position.set(0, .27, .02); neck.add(head); MJ.head = head;
  const cr = mesh(new THREE.SphereGeometry(.12, 18, 14)); cr.scale.set(.92, .88, 1.55); cr.position.set(0, .07, -.05); head.add(cr);
  const sn = mesh(new THREE.SphereGeometry(.09, 14, 10)); sn.scale.set(.85, .55, 1.45); sn.position.set(0, .01, .1); head.add(sn);
  for (const s of [-1, 1]) {
    const so = new THREE.Mesh(new THREE.SphereGeometry(.026, 8, 6), hole); so.position.set(s * .05, .06, .155); so.scale.set(1, .8, .5); head.add(so);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.008, 6, 4), eye); e.position.set(s * .05, .06, .163); head.add(e);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(.005, 6, 4), eye); e2.position.set(s * .075, .085, .13); head.add(e2);
    const ch = mesh(new THREE.SphereGeometry(.04, 8, 6)); ch.scale.set(.6, 1, 1.4); ch.position.set(s * .07, -.01, .06); head.add(ch);
  }
  const tooth = (p, x, y, z, l, down) => { const t = new THREE.Mesh(new THREE.ConeGeometry(.0065, l, 4), bone); t.position.set(x, y, z); t.rotation.x = down ? PI : 0; p.add(t); };
  for (let i = 0; i < 13; i++) { const a = -1.25 + i / 12 * 2.5; tooth(head, Math.sin(a) * .068, -.04, .1 + Math.cos(a) * .1, .03 + Math.random() * .03, true); }
  const jaw = new THREE.Group(); jaw.position.set(0, -.03, -.03); head.add(jaw); MJ.jaw = jaw;
  const jm = mesh(new THREE.SphereGeometry(.08, 12, 8)); jm.scale.set(.9, .38, 1.75); jm.position.set(0, -.035, .12); jaw.add(jm);
  const mi = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), gum); mi.scale.set(.8, .5, 1.6); mi.position.set(0, -.005, .1); jaw.add(mi);
  for (let i = 0; i < 12; i++) { const a = -1.2 + i / 11 * 2.4; tooth(jaw, Math.sin(a) * .062, -.002, .13 + Math.cos(a) * .09, .028 + Math.random() * .028, false); }
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * .2, .76, -.01); torso.add(sh); MJ['sh' + s] = sh; knob(.055, sh); sh.add(seg(.05, .034, .52));
    const el = new THREE.Group(); el.position.y = -.52; sh.add(el); MJ['el' + s] = el; knob(.036, el); el.add(seg(.038, .024, .62));
    const wr = new THREE.Group(); wr.position.y = -.62; el.add(wr); MJ['wr' + s] = wr;
    const pm = mesh(new THREE.BoxGeometry(.065, .1, .025)); pm.position.y = -.05; wr.add(pm); const fs = [];
    for (let f = 0; f < 4; f++) {
      const f0 = new THREE.Group(); f0.position.set((f - 1.5) * .019, -.1, 0); f0.rotation.z = (f - 1.5) * .09; wr.add(f0); f0.add(seg(.009, .008, .11, skin, 5));
      const f1 = new THREE.Group(); f1.position.y = -.11; f0.add(f1); f1.add(seg(.008, .006, .1, skin, 5));
      const f2 = new THREE.Group(); f2.position.y = -.1; f1.add(f2); f2.add(seg(.006, .004, .08, skin, 5));
      const cl = new THREE.Mesh(new THREE.ConeGeometry(.005, .07, 4), bone); cl.rotation.x = PI + .3; cl.position.set(0, -.11, .01); f2.add(cl); fs.push([f0, f1, f2]);
    }
    MJ.fing.push(fs);
    const hp = new THREE.Group(); hp.position.set(s * .1, 0, 0); hips.add(hp); MJ['hp' + s] = hp; hp.add(seg(.075, .045, .5));
    const kn = new THREE.Group(); kn.position.y = -.5; hp.add(kn); MJ['kn' + s] = kn; knob(.045, kn); kn.add(seg(.045, .03, .48));
    const an = new THREE.Group(); an.position.y = -.48; kn.add(an); MJ['an' + s] = an; knob(.03, an); an.add(seg(.03, .022, .3));
    const toe = new THREE.Group(); toe.position.y = -.3; an.add(toe); MJ['to' + s] = toe;
    for (let f = 0; f < 3; f++) { const tg2 = new THREE.CylinderGeometry(.012, .008, .14, 5); tg2.rotateX(PI / 2); tg2.translate(0, 0, .07); const t = mesh(tg2); t.position.x = (f - 1) * .025; t.rotation.y = (f - 1) * .25; toe.add(t); const c = new THREE.Mesh(new THREE.ConeGeometry(.006, .05, 4), bone); c.rotation.x = PI / 2 + .4; c.position.set((f - 1) * .03, -.01, .16); toe.add(c); }
  }
  if (o.mask) { // a cracked porcelain face with a painted smile, a rotten steward's jacket
    const pm = new THREE.MeshStandardMaterial({color: 0xe8e2d4, roughness: .25}), bk = new THREE.MeshBasicMaterial({color: 0x050505});
    const mk = new THREE.Mesh(new THREE.SphereGeometry(.125, 18, 12, 0, PI * 2, 0, PI * .62), pm); mk.rotation.x = PI / 2; mk.scale.set(1, 1, .75); mk.position.set(0, .06, .1); MJ.head.add(mk);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), bk); e.scale.set(1, 1.6, .4); e.position.set(sx * .045, .09, .2); MJ.head.add(e); }
    const sm = new THREE.Mesh(new THREE.TorusGeometry(.06, .007, 4, 16, PI), bk); sm.rotation.z = PI; sm.position.set(0, .03, .2); MJ.head.add(sm);
    const cr = new THREE.Mesh(new THREE.BoxGeometry(.004, .09, .004), bk); cr.rotation.z = .5; cr.position.set(.05, .12, .195); MJ.head.add(cr);
    const jm = new THREE.MeshStandardMaterial({color: 0x161c2a, roughness: .9}); const jk = new THREE.Mesh(new THREE.CylinderGeometry(.23, .19, .62, 10), jm); jk.scale.set(1.15, 1, .75); jk.position.y = .5; MJ.torso.add(jk);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.015, 6, 4), new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3})); b.position.set(.05, .3 + i * .12, .16); MJ.torso.add(b); }
  }
  MON.scale.setScalar(o.s || 1);
  MON.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(MON);
}
const _mh = new THREE.Vector3();
function animCreature(dt, st, spd) { animBody(MON, MJ, M, dt, st, spd); }
function animBody(MON, MJ, M, dt, st, spd) {
  MON.visible = st !== 'gone'; if (st === 'gone') return;
  const t = G.wt, js = G.js && G.js.t > 0 && G.js.mon === MON;
  if (st === 'dead' && !js) { MON.position.set(M.x, M.y + .2, M.z); MON.rotation.set(-1.45, M.yaw + PI, 0, 'YXZ'); MJ.jaw.rotation.x = .9; return; }
  MON.rotation.set(0, M.yaw + PI, 0, 'YXZ');
  const chase = st === 'chase', four = chase && spd > 2.5, k = clamp(spd / 2.6, 0, 1.25);
  M.four = mix(M.four || 0, four ? 1 : 0, Math.min(1, dt * 4)); const q = M.four;
  // the step cycle advances with distance covered, so the feet never slide
  M.ph += spd * dt / mix(1.6, 3.4, q) * TAU; if (spd < .15) M.ph += (Math.round(M.ph / PI) * PI - M.ph) * Math.min(1, dt * 4);
  M.frz = (M.frz || 0) - dt; if (!chase && spd < .3 && M.frz <= 0 && Math.random() < dt * .12) M.frz = .9 + Math.random() * 1.6;
  const yr = angD(M.pyaw ?? M.yaw, M.yaw) / Math.max(dt, 1e-3); M.pyaw = M.yaw; M.lean = mix(M.lean || 0, clamp(yr * Math.max(spd, 1) * .045, -.3, .3), Math.min(1, dt * 5));
  const ph = M.ph, s = Math.sin(ph), c = Math.cos(ph);
  if (M.frz <= 0 || chase || js) for (const g of [-1, 1]) {
    const lp = ph + (g > 0 ? 0 : PI), sw = Math.sin(lp), lift = Math.max(0, Math.cos(lp + .55));
    const gp = ph + (g > 0 ? 0 : .4), gs = Math.sin(gp), gl = Math.max(0, Math.cos(gp + .5)), ap = gp + PI * .8, as = Math.sin(ap), al = Math.max(0, Math.cos(ap + .5));
    MJ['hp' + g].rotation.x = mix(-.33 - sw * .45 * k, -1.2 + gs * .8, q); MJ['kn' + g].rotation.x = mix(.82 + lift * 1.05 * k, 1.4 + gl * .9, q);
    MJ['an' + g].rotation.x = mix(-.72 - lift * .5 * k + sw * .16 * k, -.95 - gl * .55, q); MJ['to' + g].rotation.x = mix(.25 + lift * .35 * k, .55 + gl * .3, q);
    MJ['sh' + g].rotation.x = mix(.12 + sw * .3 * k, -1.7 - as * .85, q); MJ['sh' + g].rotation.z = g * mix(.1 + .04 * k, .22, q); MJ['el' + g].rotation.x = mix(-.22 - k * .2 - Math.max(0, -sw) * .2 * k, -.3 + al * .7, q); MJ['wr' + g].rotation.x = mix(-.15, .45 + al * .3, q);
  }
  const curl = chase ? .55 + Math.sin(t * 9) * .1 : .35 + Math.sin(t * 1.7) * .1;
  MJ.fing.forEach(fs => fs.forEach(([a, b, d], i) => { a.rotation.x = curl * .6; b.rotation.x = curl; d.rotation.x = curl * .8 + Math.sin(t * 3 + i) * .05; }));
  if (M.frz <= 0 || chase || js) { MJ.hips.position.y = mix(1.14 + Math.abs(c) * .07 * k, .88 + Math.max(0, Math.sin(ph + 1.2)) * .14, q); MJ.hips.rotation.set(0, 0, s * .07 * k * (1 - q) + M.lean * .4);
    MJ.torso.rotation.set(mix(.36 + k * .14, 1.18 + Math.sin(ph + 2.4) * .16, q), -s * .14 * k * (1 - q), -s * .05 * k * (1 - q) + M.lean * .6, 'YXZ'); }
  if (M.wind > 0 && !js) { MJ.hips.position.y -= .25; MJ.torso.rotation.x += .3; MJ.neck.rotation.x -= .15; }
  const br = 1 + Math.sin(t * (chase ? 7 : 1.8)) * (chase ? .05 : .03); MJ.chest.scale.set(br, 1, br);
  // head: snaps and twitches; within 30 m and not chasing, it turns (too far) to stare at you
  M.jit = (M.jit || 0) - dt; M.ntC = (M.ntC || 0) - dt; if (M.jit < 0) { M.jit = .12 + Math.random() * 1.1; M.jr = (Math.random() - .5) * (chase ? 1.2 : .9); }
  let hy = 0, hx = 0;
  if (P && !P.dead && (!chase || M.ntC > 0)) { const dx = cam.position.x - M.x, dz = cam.position.z - M.z, d = Math.hypot(dx, dz); if (d < (M.ntC > 0 ? 60 : 30)) { const want = angD(M.yaw, Math.atan2(-dx, -dz)); hy = clamp(want, -2.3, 2.3); hx = clamp(-Math.atan2(cam.position.y - (M.y + 2.1), d), -.6, .6); } }
  M.sq = (M.sq || 0) - dt; if (M.sq <= 0 || chase || M.ntC > 0) { M.sq = chase ? 0 : .18 + Math.random() * .3; M.hyQ = hy; M.hxQ = hx; }
  MJ.head.rotation.set(mix(0, M.hxQ || 0, 1 - q), (M.hyQ || 0) * (1 - q), mix(MJ.head.rotation.z || 0, mix(M.jr || 0, 1.85 + Math.sin(t * 6) * .12, q), Math.min(1, dt * 22)), 'YXZ');
  MJ.neck.rotation.x = mix(-.42 - k * .1 + (M.look || 0) - Math.abs(c) * .05 * k, -1.1 - Math.sin(ph + 2.4) * .14, q);
  MJ.jaw.rotation.x = chase ? .75 + Math.sin(t * 30) * .08 + Math.random() * .05 : .12 + Math.max(0, Math.sin(t * .7)) * .25;
  MON.position.set(M.x, M.y, M.z);
  if (js) {
    // jumpscare: it is in your face, upright, arms up, jaw wide
    const u = 1 - G.js.t / G.js.L; cam.getWorldDirection(_mh); _mh.y = 0; _mh.normalize();
    const sc = MON.scale.x; MON.position.set(cam.position.x + _mh.x * 1.05 * sc, cam.position.y - 2.1 * sc + Math.sin(u * 30) * .02, cam.position.z + _mh.z * 1.05 * sc);
    MON.rotation.set(0, Math.atan2(-_mh.x, -_mh.z), 0, 'YXZ');
    MJ.hips.position.y = 1.2; MJ.torso.rotation.x = .55 + Math.sin(t * 40) * .03; MJ.neck.rotation.x = -.6; MJ.head.rotation.set(-.15, Math.sin(t * 23) * .08, Math.sin(t * 17) * .25, 'YXZ');
    for (const g of [-1, 1]) { MJ['sh' + g].rotation.set(-2.3 + Math.sin(t * 31 + g) * .1, 0, g * .45); MJ['el' + g].rotation.x = -.5; MJ['hp' + g].rotation.x = -.35; MJ['kn' + g].rotation.x = .85; MJ['an' + g].rotation.x = -.75; }
    MJ.jaw.rotation.x = 1.05 + Math.random() * .08;
  }
}

// ---------------- crew avatars
function buildCrew(col) {
  const g = new THREE.Group(), j = {};
  const vest = new THREE.MeshStandardMaterial({color: col, roughness: .7}), coat = new THREE.MeshStandardMaterial({color: 0x2a2e30, roughness: .6, metalness: .1}), skin = new THREE.MeshStandardMaterial({color: 0xb08a6a, roughness: .8}), hood = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .5});
  const m = (geo, mat, x, y, z, p = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  const body = new THREE.Group(); body.position.y = .95; g.add(body); j.body = body;
  m(new THREE.CapsuleGeometry(.21, .42, 4, 8), hood, 0, .32, 0, body); m(new THREE.BoxGeometry(.46, .38, .3), vest, 0, .42, 0, body);
  const hd = new THREE.Group(); hd.position.y = .74; body.add(hd); j.head = hd; m(new THREE.SphereGeometry(.12, 12, 10), skin, 0, .02, 0, hd); m(new THREE.SphereGeometry(.14, 12, 8, 0, TAU, 0, 1.6), hood, 0, .04, -.02, hd);
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * .1, .95, 0); g.add(leg); j['l' + s] = leg; m(new THREE.CapsuleGeometry(.075, .72, 4, 8), coat, 0, -.47, 0, leg);
    const arm = new THREE.Group(); arm.position.set(s * .27, .55, 0); body.add(arm); j['a' + s] = arm; m(new THREE.CapsuleGeometry(.06, .5, 4, 8), hood, 0, -.3, 0, arm);
  }
  const box = m(new THREE.SphereGeometry(.26, 10, 8), new THREE.MeshStandardMaterial({color: 0x8a7a5a, roughness: .95}), 0, .45, .26, body); box.scale.set(1, 1.15, .75); j.box = box;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 24, 1, true), beamMat(0xfff0d0, .22));
  beam.geometry.translate(0, -7, 0); beam.geometry.rotateX(PI / 2); beam.position.set(0, -.6, -.15); j.a1.add(beam); j.beam = beam;
  const blk = new THREE.MeshStandardMaterial({color: 0x1a1c1e, metalness: .6, roughness: .4});
  j.it = [null, m(new THREE.CylinderGeometry(.012, .02, 1.8, 5), new THREE.MeshStandardMaterial({color: 0x3a2a1a}), 0, -1.2, -.6, j.a1), m(new THREE.BoxGeometry(.05, .12, .2), blk, 0, -.62, -.1, j.a1), m(new THREE.BoxGeometry(.06, .08, .8), blk, 0, -.6, -.25, j.a1)];
  j.it[1].rotation.x = -1.1;
  g.userData = j; scene.add(g); return g;
}
function animCrew(p, dt) {
  const g = p.av, j = g.userData; g.visible = !p.dead && p.hd < 0 && p.ready; if (!g.visible) return;
  g.position.set(p.rx, p.ry + (p.sw ? -1.1 : 0), p.rz); g.rotation.y = p.ryaw;
  p.anim = (p.anim || 0) + dt * p.rspd * 2.2; const s = Math.sin(p.anim) * clamp(p.rspd / 3, 0, 1);
  j.l1.rotation.x = s * .6; j['l-1'].rotation.x = -s * .6; j['a-1'].rotation.x = p.sw ? -2.5 + Math.sin(G.t * 4) : -s * .5; j.a1.rotation.x = -.6 - p.rpitch * .8;
  j.body.rotation.x = p.cr ? .35 : 0; j.body.position.y = p.cr ? .7 : .95; j.box.visible = !!(p.sack && p.sack.length); j.box.scale.setScalar(.7 + Math.min(1, sackUsed(p.sack) / 8) * .5);
  if (p.down) { g.rotation.x = -PI / 2 + .15; g.position.y += .25; } else g.rotation.x = 0;
  j.head.rotation.x = -p.rpitch * .5; j.beam.visible = !!p.l && !p.down && !p.sw;
  for (let i = 1; i < 4; i++) j.it[i].visible = p.eq === i + 1 && !p.down && !p.sw; if (p.eq >= 2) j.a1.rotation.x = -1.3 - p.rpitch * .8;
}

// ---------------- state
const TOD_LEN = 960;
const G = {wt: 0, tod: .015, on: false, t: 0, seed: 1, evq: [], holdP: {}, flares: [], msgT: 0, noteOpen: false, map: false, paused: false, spec: 0, sea: 1, power: false, lightT: 8, storm: 0, cash: 0, earned: 0, disc: [], goals: [], bbOut: false, floats: [], shopOpen: false};
const PL = new Map(); let P = null;
const M = {hp: 140, x: 0, z: 0, y: LV[2], yaw: 0, state: 'roam', path: [], rep: 0, goal: null, spd: 0, ph: 0, jit: 0, jr: 0, aware: 0, lostT: 0, idle: 0, flee: 0, sawHide: -1, chk: [], chkT: 0, stuck: 0, sx: 0, sz: 0, screamT: 0, look: 0, seenAt: -99, tgt: null, preyT: 0, prey: null, vy: 0, wet: 0};
function mkPlayer(id, name, c) { return {id, name, c, sack: [], sc: 0, x: 0, z: 0, y: BDECK.y, yaw: 0, pitch: 0, cr: 0, l: 1, run: 0, h: '', hd: -1, hb: 0, down: false, bleed: 0, dead: false, deadT: 0, ready: false, sd: 0, lx: 0, lz: 0, spd: 0, rx: 0, ry: 0, rz: 0, ryaw: 0, rpitch: 0, rspd: 0, av: null, tag: null, heat: 0, ob: 0, bl: [0, 0], sw: 0, deep: 0, swT: 0, seat: 0, in: [0, 0], carry: null, cooler: [], eq: 0}; }
function ensurePlayer(id, name, c) { let p = PL.get(id); if (!p) { p = mkPlayer(id, name, c); PL.set(id, p); } p.name = name; p.c = c; if (!p.av) { p.av = buildCrew(CREW_COL[c % 6]); const t = document.createElement('div'); t.className = 'tag'; $('tags').appendChild(t); p.tag = t; } return p; }
function syncCrew(crew) { const ids = new Set(crew.map(c => c.id)); for (const [id, p] of PL) if (!ids.has(id)) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); if (isHost() && G.on && p !== P) { if (p.sack && p.sack.length) dropCarry(p); const v = coolerVal(p.cooler || []); if (v) { G.cash += v; G.earned += v; const t = `${p.name} left. Their catch sold for ${money(v)}.`; setTimeout(() => showMsg(t), 0); } save(); } PL.delete(id); if (B.driver === id) B.driver = null; } for (const c of crew) ensurePlayer(c.id, c.name, c.c); P = PL.get(myId()); }
const alive = () => [...PL.values()].filter(p => p.ready && !p.down && !p.dead);
const onRig = p => !p.ob && !p.sw && p.y > 1 && nearRig(p.x, p.z);

// ---------------- items and salvage
const NAMES = {pearl: 'black pearl', gold: 'gold bar', key: "captain's key card", crate: 'cargo crate', scrap: 'scrap metal', fuel: 'fuel drum', patch: 'patch kit', relic: 'ghostly relic', chest: 'treasure chest', blackbox: 'black box', fang: 'creature fang', bottle: 'bottle', battery: 'batteries', flare: 'flare', note: 'note', mask: "Steward's porcelain mask", spine: 'leviathan spine'};
const VALUE = {crate: 55, scrap: 25, relic: 180, chest: 260, blackbox: 450, fang: 140, fuel: 35, pearl: 90, gold: 320, mask: 900, spine: 600};
const CARRY = new Set(['crate', 'scrap', 'fuel', 'patch', 'relic', 'chest', 'blackbox', 'fang', 'pearl', 'gold', 'key', 'mask', 'spine']);
const KINDS = ['crate', 'scrap', 'fuel', 'patch', 'relic', 'chest', 'blackbox', 'bottle', 'battery', 'flare', 'note', 'fang', 'pearl', 'gold', 'key', 'mask', 'spine'];
const holdCap = () => holdMax() * 2, holdFits = k => sackUsed(B.hold) + (SZ[k] || 1) <= holdCap();
const holdValue = () => B.hold.reduce((s, k) => s + (VALUE[k] || 0), 0);
// the sack: several things at once, each takes slots by size
const SZ = {crate: 2, scrap: 1, fuel: 2, patch: 1, relic: 1, chest: 3, blackbox: 2, fang: 1, pearl: 1, gold: 2, key: 1, mask: 1, spine: 2};
const sackCap = p => [4, 7, 10][(p === P ? (P.own && P.own.sack) : p.sc) || 0] || 4;
const sackUsed = q => (q || []).reduce((a, k) => a + (SZ[k] || 1), 0);
const sackVal = q => (q || []).reduce((a, k) => a + (VALUE[k] || 0), 0);
const sackFits = (p, k) => sackUsed(p.sack) + (SZ[k] || 1) <= sackCap(p);
function sackSet(p) { p.carry = p.sack.length ? p.sack[p.sack.length - 1] : null; emit({k: 'sack', id: p.id, s: p.sack.map(k => KINDS.indexOf(k))}); }
function itemMesh(kind) {
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .5}, o)); const g = new THREE.Group();
  if (kind === 'battery') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .1, 10), S({color: 0x2a5a2a, metalness: .4})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'flare') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .26, 8), S({color: 0xb0201a, emissive: 0x300000})); b.rotation.z = PI / 2; g.add(b); }
  else if (kind === 'note') { const n = new THREE.Mesh(new THREE.PlaneGeometry(.21, .28), S({map: TX.paper, side: THREE.DoubleSide, roughness: 1})); n.rotation.x = -PI / 2; g.add(n); }
  else if (kind === 'bottle') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .3, 10), S({color: 0x4a8a5a, transparent: true, opacity: .7, roughness: .1, emissive: 0x0a2a10})); b.rotation.z = PI / 2.3; b.position.y = .05; g.add(b); }
  else if (kind === 'crate') { const b = new THREE.Mesh(new THREE.BoxGeometry(.7, .5, .55), S({map: TX.wood, color: 0xa08a64})); b.position.y = .25; g.add(b); }
  else if (kind === 'scrap') { for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.6 - i * .1, .08, .3), S({map: TX.rustH, metalness: .6})); b.position.set(0, .05 + i * .08, 0); b.rotation.y = i; g.add(b); } }
  else if (kind === 'fuel') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .7, 12), S({color: 0x9a2418, metalness: .4})); b.position.y = .35; g.add(b); }
  else if (kind === 'patch') { const b = new THREE.Mesh(new THREE.BoxGeometry(.45, .3, .3), S({color: 0xd8b020})); b.position.y = .15; g.add(b); }
  else if (kind === 'relic') { const b = new THREE.Mesh(new THREE.OctahedronGeometry(.18), S({color: 0x9affd0, emissive: 0x2aff9a, emissiveIntensity: .8, roughness: .2})); b.position.y = .25; g.add(b); }
  else if (kind === 'chest') { const b = new THREE.Mesh(new THREE.BoxGeometry(.8, .5, .5), S({map: TX.wood, color: 0x7a5a2a})); b.position.y = .25; g.add(b); const l = new THREE.Mesh(new THREE.BoxGeometry(.82, .06, .52), S({color: 0xd8a830, metalness: .8})); l.position.y = .45; g.add(l); }
  else if (kind === 'fang') { const b = new THREE.Mesh(new THREE.ConeGeometry(.08, .45, 6), S({color: 0xe8e0c8, roughness: .3})); b.rotation.z = PI / 2.2; b.position.y = .08; g.add(b); }
  else if (kind === 'pearl') { const b = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), S({color: 0x1a1c24, metalness: .6, roughness: .08})); b.position.y = .07; g.add(b); const sh = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 6, 0, TAU, 0, PI / 2), S({color: 0x8a8070, side: THREE.DoubleSide})); sh.scale.y = .4; g.add(sh); }
  else if (kind === 'gold') { const b = new THREE.Mesh(new THREE.BoxGeometry(.32, .1, .14), S({color: 0xe0b030, metalness: 1, roughness: .2})); b.position.y = .05; g.add(b); const c = b.clone(); c.position.set(.05, .15, 0); c.rotation.y = .3; g.add(c); }
  else if (kind === 'key') { const b = new THREE.Mesh(new THREE.BoxGeometry(.09, .005, .055), S({color: 0xc8a030, metalness: .8, roughness: .3})); b.position.y = .01; g.add(b); }
  else if (kind === 'blackbox') { const b = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, .5), S({color: 0xd05a10})); b.position.y = .15; g.add(b); }
  else if (kind === 'mask') { const b = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, PI / 2), S({color: 0xf2eee6, roughness: .1, metalness: .05})); b.scale.set(.2, .1, .26); g.add(b); const K = S({color: 0x060606, roughness: .9});
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CircleGeometry(.03, 12), K); e.rotation.x = -PI / 2 - .3; e.rotation.y = s * .4; e.position.set(s * .068, .094, -.068); g.add(e); }
    const m = new THREE.Mesh(new THREE.TorusGeometry(.06, .007, 4, 14, PI), K); m.rotation.x = PI / 2; m.position.set(0, .09, .07); g.add(m); }
  else if (kind === 'spine') { const M2 = S({color: 0xe6dcc4, roughness: .45}); for (let i = 0; i < 5; i++) { const t = (i - 2) / 2, c = new THREE.Mesh(new THREE.ConeGeometry(.07, .35, 7), M2); c.position.set(t * .5, .16, t * t * .14); c.rotation.set(t * .12, 0, -t * .35); g.add(c); }
    const cv = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.62, .05, .2), new THREE.Vector3(0, .05, -.18), new THREE.Vector3(.62, .05, .2)), sp = new THREE.Mesh(new THREE.TubeGeometry(cv, 16, .045, 6), M2); g.add(sp); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}
const ITEMS = [];
const NOTES = [
  'DRILL LOG, STATION NINE\n\n03:10 Bit dropped into a void at 3,100 m.\n03:40 Mud returns warm. Smells like a fish market.\n04:15 Something on the drill floor camera. Climbing the pipe.\n04:16 Camera down.',
  'Both fuel valves are shut, one on the dock and one on the main deck under the top deck. The generator will not turn over until they are open. The flight recorder is in the control room and needs power to eject.\n\nIt hears the valves. It hears everything.',
  'Mikkel saw it hanging off the derrick upside down. It goes for whoever is on their own. We stopped splitting up. Then we stopped being enough to stay together.',
  "HERMIT'S LOG\n\nForty years on this rock. The big one circles boats out past the buoys when it is dark and the sea is rough. It hates red light. Drop a flare in the water and it sinks away.\n\nIt never comes into the shallows.",
  "MS SERENADE, purser's note, pinned inside the ballroom piano\n\nThe passengers went ashore at the last port and never came back aboard. Only the Steward stayed. It still makes up the cabins every night. It still wears the face.\n\nThe captain locked his key card in his quarters, the first cabin by the bow. Without it the engines on the bridge will not start.\n\nDo not let it hear you on the stairs.",
  "GREY LADY, ship's log, last page\n\nThe lights in the hold glow green at night now. The crew will not go below. I sealed the relics in the cabin. Whoever finds them, sell them far from here.",
];
function placeItems() {
  for (const it of ITEMS) scene.remove(it.mesh); ITEMS.length = 0;
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(WR() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }; const by = t => shuf(SPOTS.filter(s => s.tag === t));
  const rig = by('rig'), isle = by('isle'), wreck = by('wreck'), hut = by('hut');
  const N = (s, i) => s && addItem('note', s, {text: NOTES[i]});
  N(rig.pop(), 0); N(rig.pop(), 1); N(rig.pop(), 2); N(hut.pop(), 3);
  const gl = BLD.find(b => b.wreck && b.wreck.ghost); if (gl) { const [x, z] = L2W(gl, -1, -1); addItem('note', {x, y: gl.fy + .1, z}, {text: NOTES[5]}); }
  for (const s of rig) addItem(['scrap', 'crate', 'fuel', 'patch', 'battery', 'flare', 'scrap'][Math.floor(WR() * 7)], s);
  for (const s of hut) addItem('bottle', s);
  for (const s of by('cruise')) addItem(['relic', 'gold', 'chest', 'relic', 'pearl', 'flare', 'battery'][Math.floor(WR() * 7)], s);
  for (const s of by('key')) addItem('key', s); const cz = by('cruise'); if (cz.length) addItem('note', cz[0], {text: NOTES[4]});
  isle.forEach((s, i) => addItem(i % 5 === 0 ? 'bottle' : ['crate', 'fuel', 'flare', 'battery', 'crate', 'patch', 'scrap'][Math.floor(WR() * 7)], s));
  for (const s of wreck) { const near = WRECKS.find(w => Math.hypot(s.x - w.x, s.z - w.z) < 30); addItem(near && near.ghost && WR() < .7 ? 'relic' : ['crate', 'scrap', 'patch', 'crate'][Math.floor(WR() * 4)], s); }
}
function addItem(kind, s, extra = {}) { const m = itemMesh(kind); m.position.set(s.x, s.y + .03, s.z); m.rotation.y = WR() * TAU; const it = Object.assign({kind, mesh: m, x: s.x, y: s.y, z: s.z, taken: false, i: ITEMS.length}, extra); ITEMS.push(it); return it; }
function hideTaken(h) { for (const p of PL.values()) if (p.hd === h.i && p !== P) return true; return false; }
const FLM = [];
function spawnFloat(i) {
  // near the crew (a random living player, else the boat), anywhere on the big chart; far waters float richer cargo
  const pl = alive(), c = pl.length ? pl[Math.floor(CR() * pl.length)] : B;
  for (let k = 0; k < 30; k++) { const a = CR() * TAU, r = 150 + Math.pow(CR(), 1.5) * 1300, x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r; if (Math.hypot(x - MAP_C.x, z - MAP_C.z) > MAP_R - 100 || OBST.some(o => o.c && Math.hypot(x - o.x, z - o.z) < o.r + 12) || nearRig(x, z) || inCruise(x, z) || (Math.abs(x - CRZ.x) < 27 && Math.abs(z - CRZ.z + 3) < 78)) continue;
    const rg = mapRegion(x, z), pay = rg ? mix(1, rg.pay, mapRegion.w) : 1, W = MAP_FLW; let sum = 0; for (const e of W) sum += e[1] * (e[2] ? pay : 1); let roll = CR() * sum, kind = 'crate';
    for (const e of W) { roll -= e[1] * (e[2] ? pay : 1); if (roll <= 0) { kind = e[0]; break; } } G.floats[i] = [x, z, KINDS.indexOf(kind)]; return; }
}
function floatMesh(i) { const f = G.floats[i]; const kind = f ? KINDS[f[2]] : null; if (FLM[i] && FLM[i].kind === kind) return FLM[i]; if (FLM[i]) scene.remove(FLM[i].m); if (!kind) { FLM[i] = null; return null; }
  // a marker pole with an orange pennant and a soft glow, so floating cargo can be found by eye
  const m = itemMesh(kind), Q = floatMesh.Q || (floatMesh.Q = (() => { const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.84, 0, 0, 1.54, 0, .44, 1.69, 0], 3)); fg.computeVertexNormals();
    return {pole: new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, 1.6, 5), new THREE.MeshStandardMaterial({color: 0xd8d0c0, roughness: .6})), flag: new THREE.Mesh(fg, new THREE.MeshStandardMaterial({color: 0xff6a1a, emissive: 0x501800, roughness: .7, side: THREE.DoubleSide}))}; })());
  if (kind !== 'bottle') { const pl = Q.pole.clone(); pl.position.y = 1.05; m.add(pl); m.add(Q.flag.clone()); }
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffb060, transparent: true, opacity: .4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); gl.scale.setScalar(1.6); gl.position.y = kind === 'bottle' ? .35 : 1.72; m.add(gl);
  FLM[i] = {kind, m, glow: gl}; return FLM[i]; }

// ---------------- audio
const A = {ctx: null, on: false};
function aInit() {
  if (A.ctx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  const c = A.ctx = new C(); A.out = c.createGain(); A.out.gain.value = 1.15 * SET.vol; const comp = A.comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = .004; comp.release.value = .25; A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 20000; A.out.connect(A.lp); A.lp.connect(comp); comp.connect(c.destination);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
  const loop = (f, q, g0, type = 'bandpass') => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = g0; s.connect(fl); fl.connect(g); s.start(); return {s, f: fl, g}; };
  const pan = (ref, roll) => { const p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 400}); p.connect(A.out); return p; };
  A.rain = loop(3500, .3, .05, 'highpass'); A.rain.g.connect(A.out);
  A.wind = loop(420, .6, .06); A.wind.g.connect(A.out);
  A.surf = loop(300, .5, .08, 'lowpass'); A.surf.g.connect(A.out);
  A.mPan = pan(2.5, 1.4); A.mBreath = loop(260, 3, 0); A.mBreath.g.connect(A.mPan);
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 46; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 220; const sg = c.createGain(); sg.gain.value = 0; saw.connect(sf); sf.connect(sg); sg.connect(A.mPan); saw.start(); A.mGrowl = sg; A.mSaw = saw;
  const dg = c.createGain(); dg.gain.value = 0; dg.connect(A.out); A.drone = dg; const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 300; df.connect(dg); A.droneF = df;
  { const pg = c.createGain(); pg.gain.value = 0; pg.connect(A.out); A.pad = pg; const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 380; pf.connect(pg); A.padF = pf;
    for (const [f, ty] of [[36.7, 'sawtooth'], [55, 'triangle'], [77.8, 'sine'], [110.2, 'triangle'], [116.5, 'sine']]) { const x = c.createOscillator(); x.type = ty; x.frequency.value = f; x.detune.value = (Math.random() - .5) * 14; x.connect(pf); x.start(); } }
  for (const f of [55, 58.3, 82.4, 110.6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.connect(df); x.start(); }
  // boat engine: saw + square + sub sine -> tanh drive -> lowpass -> firing-rate AM -> A.engG; plus exhaust noise, turbine hiss and a whine (boatAudio sets them per hull)
  A.mute = []; A.bPan = pan(5, 1);
  { const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator(), g1 = c.createGain(), g2 = c.createGain(), g3 = c.createGain(), pre = c.createGain(), ws = c.createWaveShaper(), ef = c.createBiquadFilter(), am = c.createGain(), lfo = c.createOscillator(), dep = c.createGain(), eg = c.createGain();
    const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) cv[i] = Math.tanh(3 * (i / 511.5 - 1)); ws.curve = cv; ws.oversample = '2x';
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine'; ef.type = 'lowpass'; ef.frequency.value = 300; ef.Q.value = .7; eg.gain.value = 0; dep.gain.value = 0; lfo.frequency.value = 10;
    for (const [o, g] of [[o1, g1], [o2, g2], [o3, g3]]) { o.frequency.value = 40; o.connect(g); g.connect(pre); o.start(); }
    pre.connect(ws); ws.connect(ef); ef.connect(am); lfo.connect(dep); dep.connect(am.gain); lfo.start(); am.connect(eg); eg.connect(A.bPan);
    const ex = loop(250, 1.4, 0); ex.g.connect(A.bPan); const hs = loop(3200, .4, 0, 'highpass'); hs.g.connect(A.bPan);
    const wo = c.createOscillator(), wg = c.createGain(); wo.frequency.value = 1400; wg.gain.value = 0; wo.connect(wg); wg.connect(A.bPan); wo.start();
    A.E = {cls: -1, k: 0, st: 0, drv: false, o1, o2, o3, g1, g2, g3, pre, am, lfo, dep, ex, hs, wo, wg}; A.eng = o1; A.engG = eg; A.engF = ef; A.mute.push(eg, ex.g, hs.g, wg); }
  A.gPan = pan(4, 1.2); const gen = c.createOscillator(); gen.type = 'sawtooth'; gen.frequency.value = 50; const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180; const gg = c.createGain(); gg.gain.value = 0; gen.connect(gf); gf.connect(gg); gg.connect(A.gPan); gen.start(); A.genG = gg;
  A.aPan = pan(10, .8); const al = c.createOscillator(); al.type = 'square'; al.frequency.value = 600; const ag = c.createGain(); ag.gain.value = 0; al.connect(ag); ag.connect(A.aPan); al.start(); A.alarm = al; A.alarmG = ag;
  A.deepG = c.createGain(); A.deepG.gain.value = 0; A.deepG.connect(A.out); const dO = c.createOscillator(); dO.type = 'sine'; dO.frequency.value = 31; dO.connect(A.deepG); dO.start();
  // water against the hull (panner at the bow) and the bilge alarm at the helm
  A.wPan = pan(6, 1); A.wash = loop(500, .6, 0); A.wash.g.connect(A.wPan); A.hiss = loop(2600, .5, 0, 'highpass'); A.hiss.g.connect(A.wPan);
  { const p = pan(3, 1), o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 660; g.gain.value = 0; o.connect(g); g.connect(p); o.start(); A.bilge = {p, o, g}; }
  // the score: its own bus, a five-voice chord bank, one low bass voice and a storm tremolo
  { const mu = A.mus = c.createGain(); mu.gain.value = 0; mu.connect(A.out); const cf = c.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 900; cf.Q.value = .3; const cg = c.createGain(); cg.gain.value = 0; cf.connect(cg); cg.connect(mu);
    const ch = [73.42, 146.83, 220, 277.18, 369.99].map((f, i) => { const o = c.createOscillator(); o.type = i ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 8; o.connect(cf); o.start(); return o; });
    const bo = c.createOscillator(), bg = c.createGain(); bo.type = 'sine'; bo.frequency.value = 73.42; bg.gain.value = 0; bo.connect(bg); bg.connect(mu); bo.start();
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 420; const tr = c.createGain(); tr.gain.value = .55; const tl = c.createOscillator(), td = c.createGain(); tl.frequency.value = 6; td.gain.value = .45; tl.connect(td); td.connect(tr.gain); tl.start(); const sg = c.createGain(); sg.gain.value = 0; sf.connect(tr); tr.connect(sg); sg.connect(mu);
    for (const f of [73.42, 110, 110.4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(sf); o.start(); }
    A.MU = {cg, ch, bo, bg, sg}; A.mute.push(mu, cg, bg, sg); }
  A.mute.push(A.wash.g, A.hiss.g, A.bilge.g);
  // boat sounds (Snd extensions live here because the Snd literal is outside this package)
  Object.assign(Snd, {
    shipHorn(cls, p) { if (!A.on) return; const t = c.currentTime + .02, d = p || A.out;
      const voice = (fs, type, dur, att, pk, ft, ff, q, bend = .94) => { const f = c.createBiquadFilter(); f.type = ft; f.frequency.value = ff; f.Q.value = q; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + att); g.gain.setValueAtTime(pk, t + Math.max(att, dur - .3)); g.gain.linearRampToValueAtTime(0, t + dur); f.connect(g); g.connect(d);
        for (const fr of fs) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(fr * bend, t); o.frequency.exponentialRampToValueAtTime(fr, t + att + .12); o.connect(f); o.start(t); o.stop(t + dur + .05); } return g; };
      cls = cls || 0;
      if (cls === 0) voice([330, 415], 'square', .8, .03, .06, 'bandpass', 900, 1.1, .97);
      else if (cls === 1) voice([196, 196.7], 'sawtooth', 1.5, .06, .1, 'lowpass', 1500, .8);
      else if (cls === 2) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = .6; const g = c.createGain(), o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(900, t + .8); o.frequency.setValueAtTime(900, t + 1); o.frequency.exponentialRampToValueAtTime(420, t + 1.9); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .08); g.gain.setValueAtTime(.16, t + 1.6); g.gain.linearRampToValueAtTime(0, t + 2); o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + 2.05); }
      else if (cls === 4) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = .8; const g = c.createGain(), o = c.createOscillator(); o.type = 'square'; g.gain.setValueAtTime(0, t); for (let i = 0; i < 2; i++) { const u = t + i * .7; o.frequency.setValueAtTime(170, u); o.frequency.exponentialRampToValueAtTime(430, u + .45); g.gain.setValueAtTime(0, u); g.gain.linearRampToValueAtTime(.09, u + .04); g.gain.setValueAtTime(.09, u + .5); g.gain.linearRampToValueAtTime(0, u + .62); } o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + 1.45); }
      else if (cls === 3 || cls === 5) voice([82, 82.5, 98, 98.6], 'sawtooth', 3, .12, .085, 'lowpass', 760, .7);
      else if (cls === 6) voice([65, 65.4, 77, 77.5], 'sawtooth', 3.4, .15, .095, 'lowpass', 640, .7);
      else { const g = voice([55, 55.25, 69, 69.3, 110], 'sawtooth', 4.7, .25, .07, 'lowpass', 560, .7, .97), dl = c.createDelay(2), fb = c.createGain(), lp = c.createBiquadFilter(), eo = c.createGain(); dl.delayTime.value = 1.2; fb.gain.value = .3; lp.type = 'lowpass'; lp.frequency.value = 700; eo.gain.value = .45; g.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eo); eo.connect(A.out); setTimeout(() => { try { eo.disconnect(); fb.disconnect(); } catch (e) {} }, 12000); } },
    crack(p, n = 6) { const k = clamp(.55 + n / 25, .55, 1.2); burst(2200, 2, .25 * k, .15, 'bandpass', p); burst(700, .6, .3 * k, .4, 'bandpass', p); setTimeout(() => burst(3400, 3, .1 * k, .05, 'bandpass', p), 70); },
    groan(p, n = 6) { if (!A.on) return; const k = clamp(.55 + n / 25, .55, 1.2), t = c.currentTime, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(48, t + 1.2); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 4; env(g, t, .06, .22 * k, 1.2); o.connect(f); f.connect(g); g.connect(p || A.out); o.start(t); o.stop(t + 1.4); burst(380, 9, .2 * k, .6, 'bandpass', p); },
    vent(p) { burst(500, .4, .2, 2.2, 'bandpass', p); Snd.bubbles(); burst(160, 1, .35, .14, 'lowpass', p); burst(1100, 7, .08, .09, 'bandpass', p); },
  });
  A.on = true;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
function burst(f, q, peak, dec, type = 'bandpass', dest, rate = 1) { if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); env(g, t, .005, peak, dec); s.connect(fl); fl.connect(g); g.connect(dest || A.out); s.start(t, Math.random()); s.stop(t + dec + .1); }
function tone(f, peak, dec, type = 'sine', dest, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
function at(x, y, z, ref = 3) { if (!A.on) return null; const p = A.ctx.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.1}); setPan(p, x, y, z); p.connect(A.out); setTimeout(() => p.disconnect(), 5000); return p; }
function setPan(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
const Snd = {
  step(kind, k) { if (kind === 'wet') burst(700, .5, .1 * k, .25, 'bandpass', null, .7); else if (kind === 'metal') { burst(2200, 4, .05 * k, .08); tone(320 + Math.random() * 60, .02 * k, .08, 'triangle'); } else if (kind === 'sand') burst(500, .6, .06 * k, .12, 'lowpass'); else burst(600, 1.2, .06 * k, .09); },
  rStep(x, y, z, k) { const p = at(x, y, z, 2); if (p) burst(1800, 3, .05 * k, .08, 'bandpass', p); },
  mStep(k) { burst(160, 1, .35 * k, .16, 'lowpass', A.mPan); tone(140, .05 * k, .2, 'triangle', A.mPan); },
  heart(k) { tone(58, .25 * k, .12); setTimeout(() => tone(52, .18 * k, .14), 170); },
  pickup() { tone(660, .05, .25); setTimeout(() => tone(990, .04, .3), 90); },
  coin() { tone(1320, .05, .15, 'triangle'); setTimeout(() => tone(1760, .05, .3, 'triangle'), 80); },
  discover() { tone(392, .06, 1.2, 'triangle'); setTimeout(() => tone(523, .05, 1.2, 'triangle'), 180); setTimeout(() => tone(659, .05, 1.6, 'triangle'), 360); },
  click() { burst(3000, 3, .05, .02); },
  stinger() { for (const f of [233, 247, 311, 466]) tone(f, .06, 1.6, 'sawtooth'); burst(3000, .4, .25, 1.4, 'highpass'); },
  scream(dest) { for (const f of [520, 560, 790]) tone(f, .22, 1.2, 'sawtooth', dest, f * .4); burst(1800, .5, .9, 1.4, 'bandpass', dest); },
  creak() { tone(90, .06, .7, 'sawtooth', A.mPan, 60); burst(700, 6, .1, .6, 'bandpass', A.mPan, .4); },
  metal(p) { tone(180 + Math.random() * 300, .05, 2.5, 'triangle', p, 120); burst(500, 8, .04, 2, 'bandpass', p, .3); },
  gasp() { burst(1300, 1.5, .25, .45); },
  flare(p) { burst(2500, .5, .3, 1.2, 'highpass', p); },
  valve(p) { tone(1200 + Math.random() * 400, .03, .4, 'sawtooth', p, 900); },
  dig() { burst(400, .8, .12, .25, 'lowpass', null, .6); },
  thunder(k) { burst(90, .5, .9 * k, 3.5, 'lowpass', null, .5); burst(300, .5, .4 * k, 1.5, 'lowpass', null, .7); },
  splash(p) { burst(900, .5, .5, .8, 'bandpass', p, .6); },
  ram() { burst(70, 1, 1, 1.5, 'lowpass', null, .4); tone(45, .6, 1.2, 'sine'); burst(1500, .5, .25, 1, 'bandpass', null, .6); },
  deep() { tone(32, .5, 3, 'sawtooth', null, 24); burst(200, 1, .3, 2.5, 'lowpass', null, .3); },
  whale(p) { tone(180, .12, 2.5, 'sine', p, 90); setTimeout(() => tone(240, .08, 2, 'sine', p, 140), 900); },
  bubbles() { for (let i = 0; i < 6; i++) setTimeout(() => tone(500 + Math.random() * 500, .05, .08, 'sine', null, 1200), i * 90); },
  whistle(p) { tone(2600, .12, .5, 'sine', p, 2900); setTimeout(() => tone(2900, .1, .6, 'sine', p, 2400), 380); },
  horn(p) { tone(110, .25, 2.2, 'sawtooth', p); tone(112, .2, 2.2, 'sawtooth', p); },
  hurt(p) { burst(500, 1, .5, .5, 'lowpass', p); tone(160, .2, .5, 'sawtooth', p, 70); },
  revive() { tone(440, .06, .3); setTimeout(() => tone(660, .06, .4), 140); },
  power() { tone(60, .3, 3, 'sawtooth', null, 120); burst(400, .5, .5, 1.5, 'lowpass'); },
  gun(w, p) { if (w === 'g') { burst(2600, .7, .55, .12, 'bandpass', p); burst(180, .6, .7, .3, 'lowpass', p); } else { burst(1400, .5, .8, .25, 'bandpass', p); burst(90, .6, 1, .6, 'lowpass', p); setTimeout(() => { burst(900, 3, .12, .08, 'bandpass', p); setTimeout(() => burst(700, 3, .12, .08, 'bandpass', p), 140); }, 300); } },
  reload() { burst(1800, 4, .08, .05); setTimeout(() => burst(1200, 4, .1, .06), 250); },
  cast() { burst(1400, .5, .12, .4, 'highpass', null, 1.6); },
  bite() { burst(900, 1, .35, .3, 'bandpass', null, .7); tone(220, .08, .2, 'sine', null, 120); },
  hook() { tone(330, .08, .15, 'square'); },
  tick() { burst(4000, 6, .03, .02); },
  snap() { tone(900, .12, .3, 'sawtooth', null, 200); },
  sStep(p, k) { burst(120, 1, .5 * k, .25, 'lowpass', p); tone(70, .12 * k, .3, 'triangle', p); setTimeout(() => burst(900, 3, .06 * k, .08, 'bandpass', p), 120); },
  fwUp(p) { burst(2400, 2, .25, 1.4, 'bandpass', p, 1.6); tone(1200, .04, 1.3, 'sine', p, 2600); },
  fwBoom(p) { burst(90, .6, 1, 2.2, 'lowpass', p, .5); burst(600, .5, .5, 1, 'lowpass', p, .6); for (let i = 0; i < 14; i++) setTimeout(() => burst(3500 + Math.random() * 2000, 6, .12, .05, 'bandpass', p), 500 + Math.random() * 900); },
  inhale(k) { burst(900, .8, .05 * k, .9, 'bandpass', null, .8); },
  exhale(k) { burst(500, .6, .07 * k, 1.1, 'bandpass', null, .6); for (let i = 0; i < 8; i++) setTimeout(() => tone(400 + Math.random() * 600, .02 * k, .06, 'sine', null, 1100), 300 + i * 70); },
  roar(p, k = 1) { tone(62, .55 * k, 2.6, 'sawtooth', p, 38); tone(93, .35 * k, 2.2, 'sawtooth', p, 50); tone(140, .15 * k, 1.8, 'square', p, 70); burst(380, .6, .8 * k, 2.4, 'bandpass', p, .45); burst(1600, .5, .25 * k, 1.6, 'bandpass', p, .6); },
  clicks(p) { const n = 5 + (Math.random() * 6 | 0), g = 40 + Math.random() * 50; for (let i = 0; i < n; i++) setTimeout(() => burst(2600 + Math.random() * 900, 9, .16, .012, 'bandpass', p), i * g); },
  shriek(p) { tone(780, .25, .6, 'sawtooth', p, 1500); tone(1180, .12, .5, 'sawtooth', p, 2100); burst(3000, .6, .5, .7, 'bandpass', p, 1.4); },
};
function showMsg(txt, who, dur = 4) { $('msg').innerHTML = (who ? `<b>${who}</b>` : '') + txt; $('msg').style.opacity = 1; G.msgT = dur; }
function toast(t, sub) { const e = $('toast'); e.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); e.style.opacity = 1; clearTimeout(G.toastT); G.toastT = setTimeout(() => e.style.opacity = 0, 3500); }
const GOALS = ['Find every place on the sea', "Recover Station Nine's black box", 'Dig up a buried treasure chest', 'Earn $1500 from salvage', 'Fully upgrade the engine', 'Land a giant squid', 'Put down the thing on the rig', 'Start the engines of the MS Serenade', 'Dive deeper than 100 m', 'Sell your first haul', 'Buy something at the shed', 'Chart three places'];
function hint() { G.nstep = nextStep(); G.navMark = G.nstep.mk || null; return G.nstep.t; }
// ---------------- guide: one short step at a time, goals that pay, ranks, money you can feel
const cashStr = n => '$' + Math.round(n).toLocaleString('en-US');
const GOAL_ORDER = [9, 10, 11, 3, 2, 1, 4, 6, 5, 8, 7, 0];
const GOAL_CASH = [2500, 500, 300, 250, 300, 600, 600, 3000, 800, 100, 100, 150];
const GOAL_HINT = [() => `Chart every place (${G.disc.length}/${POIS.length})`, "Recover the rig's black box", 'Find a bottle map, dig the X', () => `Earn $1,500 (${cashStr(G.earned)} so far)`, 'Max out the engine', 'Land a giant squid on the deep rod', 'Put down the thing on the rig', "Find the Serenade's key card", 'Dive below 100 m', GOALS[9], GOALS[10], GOALS[11]];
const TITLES = [[0, 'Deckhand'], [1000, 'Bosun'], [3500, 'First Mate'], [9000, 'Skipper'], [20000, 'Captain'], [45000, 'Commodore']];
const titleOf = e => { let i = 0; while (i + 1 < TITLES.length && (e || 0) >= TITLES[i + 1][0]) i++; return i; };
// the next thing to do: {t: text, mk: {x, y, z, scr: 1} screen marker and/or {x, z, lab} compass marker}
function nextStep() {
  if (!P) return {t: ''};
  if (P.seat || G.earned > 0 || (B.driver && B.driver !== myId())) G.helmDone = true;
  const dP = (x, z) => Math.hypot(x - P.x, z - P.z), hv = B.heave || 0, sv = sackVal(P.sack), hold = holdValue(), sh = G.shed && G.shed.shop;
  const shed = t => !sh ? {t} : {t, mk: Object.assign({x: sh[0], z: sh[2], lab: 'SHED'}, dP(sh[0], sh[2]) < 40 ? {y: sh[1] + .9, scr: 1} : {})};
  if (!G.helmDone) {
    if (P.ob) { const h = INTER.find(i => i.kind === 'helm'); if (h) { const w = interWorld(h); return {t: 'Take the wheel', mk: {x: w.x, y: w.y + 1 + hv, z: w.z, scr: 1}}; } }
    else if (dP(B.x, B.z) > 30) return {t: 'Get back to your boat', mk: {x: B.x, z: B.z, lab: 'BOAT'}};
  }
  if (B.hull < 30) return {t: 'Patch the hull or head home'};
  if (G.earned === 0 && !(P.sack || []).length && !B.hold.length) {
    let f = null, bd = 600; for (const q of G.floats) if (q && KINDS[q[2]] !== 'bottle') { const d = dP(q[0], q[1]); if (d < bd) { bd = d; f = q; } }
    return {t: 'Haul floating cargo aboard', mk: f ? Object.assign({x: f[0], z: f[1], lab: 'CARGO'}, bd < 60 ? {y: waveH(f[0], f[1], G.wt) + 1.1, scr: 1} : {}) : null};
  }
  if (sv > 0 && P.ob) { const h = INTER.find(i => i.kind === 'hold'), w = h && interWorld(h); return {t: 'Stow it in the hold', mk: w ? {x: w.x, y: w.y + .7 + hv, z: w.z, scr: 1} : null}; }
  if ((hold > 0 && G.earned === 0) || hold >= 150 || (sv > 0 && !P.ob && Math.hypot(P.x - HOME.x, P.z - HOME.z) < 200)) return shed('Sell at the harbour shed');
  if (G.earned > 0 && !G.goals.includes(10) && G.cash >= 30) return shed('Spend it at the shed');
  const gi = GOAL_ORDER.find(i => !G.goals.includes(i)); if (gi == null) return {t: 'The sea is yours.'};
  const h = GOAL_HINT[gi]; let mk = null;
  if (gi === 1 || gi === 6) { const q = POIS.find(q => q.rig); if (q) mk = {x: q.x, z: q.z, lab: 'RIG'}; }
  else if (gi === 2) { let bd = 1e9; for (const d of DIGS) if (d.rev && !d.dug && dP(d.x, d.z) < bd) { bd = dP(d.x, d.z); mk = {x: d.x, z: d.z, lab: 'X'}; } }
  else if (gi === 7) { const i = POIS.findIndex(q => q.cruise); if (i >= 0 && G.disc.includes(i)) mk = {x: POIS[i].x, z: POIS[i].z, lab: 'SERENADE'}; }
  return {t: typeof h === 'function' ? h() : h, mk};
}
// coins: a drawer thunk, two bells and a run of ticks; a crate thump; a fanfare for the logbook
Snd.sale = v => { burst(300, 1, .3, .15, 'lowpass'); setTimeout(() => { tone(1568, .05, .9); tone(2349, .035, 1.2); }, 50); const n = clamp(Math.round((v || 0) / 40), 3, 16); for (let i = 0; i < n; i++) setTimeout(() => { tone(2900 + Math.random() * 700, .022, .06, 'triangle'); burst(5200, 5, .02, .025); }, 160 + i * 40); };
Snd.stow = () => { burst(160, 1, .4, .22, 'lowpass'); setTimeout(() => burst(800, 3, .14, .06), 25); };
Snd.goal = () => { if (!A.on) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => tone(f, .07, .5, 'triangle'), i * 110));
  setTimeout(() => { if (!A.on) return; const c = A.ctx, t = c.currentTime, g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.022, t + .18); g.gain.setValueAtTime(.022, t + 1.1); g.gain.linearRampToValueAtTime(0, t + 1.6); g.connect(A.out);
    for (const f of [261.63, 392, 523.25, 659.25]) { const o = c.createOscillator(); o.type = f < 300 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 8; o.connect(g); o.start(t); o.stop(t + 1.7); }
    burst(7000, .6, .05, 1.3, 'highpass', null, 1.6); }, 400); };
// DOM writes only when something changed (values cached on the element)
function setT(id, v) { const e = typeof id === 'string' ? setT.c[id] || (setT.c[id] = $(id)) : id; if (e && e._t !== v) { e._t = v; e.textContent = v; } }
setT.c = {};
function setS(id, p, v) { const e = typeof id === 'string' ? setT.c[id] || (setT.c[id] = $(id)) : id, k = '_s' + p; if (e && e[k] !== v) { e[k] = v; e.style[p] = v; } }
// monoline icons for the hotbar, sack and cooler
const ICON = (() => { const s = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`; return {
  hand: s('<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.8a1.5 1.5 0 0 1 3 0V12M14 12V6.2a1.5 1.5 0 0 1 3 0V13M17 13V9a1.5 1.5 0 0 1 3 0v5.5c0 3.6-2.8 6.5-6.5 6.5h-1.3c-2.2 0-3.6-.9-4.9-2.6L4 14.6a1.6 1.6 0 0 1 2.4-2.1L8 14"/>'),
  light: s('<path d="M3 10h8v4H3zM6 10V8.8M11 10l4-2.5v9L11 14M18 8.5l2.5-1.5M18.5 12H22M18 15.5l2.5 1.5"/>'),
  rod: s('<path d="M3 21L18 4c1.6 3 2 6.2 2 10v2.5a1.5 1.5 0 0 1-3 0"/><circle cx="7" cy="16.5" r="1.8"/>'),
  pistol: s('<path d="M3 7h17v4.5H9.5L8.5 13l-1 7H4l1.2-6.5L3 12zM9.5 11.5c0 2 1 2.5 3 2.5"/>'),
  shotgun: s('<path d="M2 9.5h16.5l3.5-1v3H11l-1.5 2H7l-2.5 5H2l2-5.5H2zM11.5 11.5v2.5h5v-2.5"/>'),
  flare: s('<path d="M8 21l5.5-9.5M10.6 10.4l4.3 2.5M14.8 8.8c-.9-1.6.4-3 .1-5 1.9 1 3.4 3 2.5 5.2a2.4 2.4 0 0 1-2.6 1.2zM20 4.5l1-1M20.5 8.3h1.3"/>'),
  rocket: s('<path d="M12 2.5v3.5M12 14.5V18M4.5 10.2H8M16 10.2h3.5M6.6 4.8l2.4 2.4M15 13.2l2.4 2.4M6.6 15.6L9 13.2M15 7.2l2.4-2.4M12 18c-.6 1.2-.2 2.4.6 3.5"/><circle cx="12" cy="10.2" r="1.4"/>'),
  sack: s('<path d="M9 6.5L7.5 3.5h9L15 6.5M8.5 6.5h7M9 6.5C5.5 9 4 12.5 4 15.5 4 19 7.5 21 12 21s8-2 8-5.5c0-3-1.5-6.5-5-9"/>'),
  fish: s('<path d="M2.5 12c3-4.8 9.2-6 14-1.8L21 7v10l-4.5-3.2C11.7 18 5.5 16.8 2.5 12z"/><circle cx="7.5" cy="11" r=".9"/>')}; })();

// ---------------- rig creature senses + brain (host)
function eyeDir(p) { return [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)]; }
function beamHits(p, x, y, z) { const ey = p.y + 1.55, dx = x - p.x, dy = y - ey, dz = z - p.z, d = Math.hypot(dx, dy, dz), f = eyeDir(p); return (dx * f[0] + dy * f[1] + dz * f[2]) / d > Math.cos(.4); }
function seesP(p) {
  if (p.hd >= 0 || !p.ready || p.down || p.dead || p.sw || !nearRig(p.x, p.z)) return 0;
  const dx = p.x - M.x, dz = p.z - M.z, d = Math.hypot(dx, dz);
  const lit = litP(p); let range = D.sight * (lit ? 1 : .42) * (p.cr ? .65 : 1) * (p.spd < .3 ? .75 : 1);
  if (G.power) range = Math.max(range, D.sight * .85);
  const beam = lit && d < 40 && beamHits(p, M.x, M.y + 2, M.z); if (beam) range = Math.max(range, 40);
  if (d > range) return 0;
  const fa = Math.atan2(-dx, -dz); if (d > 3.5 && !beam && Math.abs(angD(M.yaw, fa)) > 1.25) return 0;
  if (!seeLine(M.x, M.y, M.z, p.x, p.y, p.z)) return 0;
  return clamp(1.4 - d / range, .1, 1.4) * (beam ? 1.6 : 1);
}
function pSeesMon(p) {
  const ey = p.y + 1.55, dx = M.x - p.x, dz = M.z - p.z, d = Math.hypot(dx, dz), f = eyeDir(p), dy = M.y + 1.8 - ey;
  const dot = (dx * f[0] + dy * f[1] + dz * f[2]) / Math.hypot(dx, dy, dz);
  if (dot < .8 || !seeLine(p.x, p.y, p.z, M.x, M.y, M.z)) return 0;
  return (litP(p) && d < 36 && dot > Math.cos(.42)) || d < 10 || (G.power && d < 25) ? 1 : d < 18 ? .5 : 0;
}
function noise(x, y, z, r) {
  if (!isHost()) return; r *= D.hear;
  if (inCruise(x, z, y)) stwHear(x, y, z, r);
  if (!nearRig(x, z)) return;
  const d = Math.hypot(x - M.x, z - M.z) + Math.abs(y - M.y) * 1.5;
  if (d > r || M.state === 'chase' || M.state === 'flee' || M.state === 'dead' || M.state === 'gone') return;
  M.state = 'inv'; M.idle = 0; goTo(x + (CR() - .5) * d * .1, y, z + (CR() - .5) * d * .1); M.invZone = zoneOf(x, z, y);
}
function goTo(x, y, z) { M.goal = [x, y, z]; const p = navPath(M.x, M.y, M.z, x, y, z); M.path = p ? p.map(q => [q[0], q[1]]) : [[x, z]]; }
function moveAlong(dt, speed) {
  while (M.path.length && Math.hypot(M.path[0][0] - M.x, M.path[0][1] - M.z) < (M.path.length > 1 ? .5 : .3)) M.path.shift();
  if (!M.path.length) { M.spd = mix(M.spd, 0, dt * 6); return true; }
  const [wx, wz] = M.path[0], dx = wx - M.x, dz = wz - M.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz); M.yaw += clamp(angD(M.yaw, want), -dt * 7, dt * 7);
  M.spd = mix(M.spd, speed * (1 - Math.min(.6, Math.abs(angD(M.yaw, want)) / PI)), dt * 3);
  const st = Math.min(d, M.spd * dt); M.x += dx / d * st; M.z += dz / d * st;
  pushBody(M, .32, M.y); return false;
}
function randNode(near, r) { for (let k = 0; k < 40; k++) { const l = Math.floor(CR() * LV.length), i = Math.floor(CR() * NG.n), j = Math.floor(CR() * NG.n), id = nIdx(l, i, j); if (!NG.cells[id]) continue; const [x, z] = nPos(id); if (near && Math.hypot(x - near.x, z - near.z) + Math.abs(LV[l] - near.y) > r) continue; return [x, LV[l], z]; } return null; }
function pickRoam() { const prey = PL.get(M.prey); const q = prey && onRig(prey) && !prey.down ? randNode(prey, D.roam * (M.avoidT > 0 ? 2 : 1)) : randNode(null); if (q) { if (M.avoidT > 0 && alive().some(p => Math.hypot(p.x - q[0], p.z - q[2]) < 14)) return; goTo(q[0], q[1], q[2]); } }
function downPlayer(p, how) {
  if (p.down || p.dead) return; p.down = true; p.bleed = bleedFor(p); p.hd = -1; p.seat = 0; if (B.driver === p.id) B.driver = null; dropCarry(p);
  M.yaw = Math.atan2(-(p.x - M.x), -(p.z - M.z)); emit({k: 'down', id: p.id, how}); M.state = 'flee'; M.flee = D.down; M.tgt = null; M.sawHide = -1; M.aware = 0;
  const q = randNode(null); if (q) goTo(q[0], q[1], q[2]);
}
function stepSunk(dt) {
  if (!HC().sub || (B.dep || 0) < 3) return;
  for (let i = 0; i < SUNK.length; i++) { const q = SUNK[i]; if (q.got || Math.hypot(q.x - B.x, q.z - B.z) > 9 || Math.abs(q.y + B.dep) > 10) continue; if (!holdFits(q.kind)) { const n = performance.now(); if (B.driver && n - (G.clawFullT || 0) > 8000) { G.clawFullT = n; emit({k: 'holdfull', id: B.driver}); } continue; } q.got = true; B.hold.push(q.kind); emit({k: 'sunk', i, kind: q.kind}); }
}
function stepCreature(dt) {
  if (M.state === 'dead') { M.spd = 0; M.deadT -= dt; if (M.deadT <= 0) { M.state = 'gone'; M.goneT = 120; M.x = 0; M.z = 900; M.y = -50; } return; }
  if (M.state === 'gone') { M.goneT -= dt; if (M.goneT <= 0) { const n = randNode(null); if (n) { M.x = n[0]; M.y = n[1]; M.z = n[2]; } M.hp = D.mhp; M.state = 'roam'; M.path = []; M.idle = 4; } return; }
  const f = floorAt(M.x, M.z, M.y);
  if (f && M.y - f.y < .8) { M.y = mix(M.y, f.y, Math.min(1, dt * 12)); M.vy = 0; } else { M.vy -= 20 * dt; M.y += M.vy * dt; if (f && M.y < f.y) { M.y = f.y; M.vy = 0; } }
  if (M.y < -.5 || !nearRig(M.x, M.z)) { M.wet += dt; M.spd = 0; if (M.wet > 3) { M.wet = 0; const n = randNode(null); if (n) { M.x = n[0]; M.y = n[1]; M.z = n[2]; M.vy = 0; M.path = []; M.state = 'roam'; } } return; }
  M.avoidT = (M.avoidT || 0) - dt;
  const ps = alive().filter(p => nearRig(p.x, p.z) && !p.sw);
  if (!ps.length) { if (M.state === 'chase' || M.state === 'search') M.state = 'roam'; M.notT = M.wind = M.lunge = 0; if (!M.path.length && !(M.avoidT > 0) && (M.idle -= dt) <= 0) { const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); M.idle = 3 + CR() * 6; } moveAlong(dt, M.avoidT > 0 ? 3 : 1.4); return; }
  let tgt = M.tgt && PL.get(M.tgt); if (tgt && (tgt.down || tgt.dead || tgt.sw || !nearRig(tgt.x, tgt.z))) { tgt = null; M.tgt = null; }
  const dOf = p => Math.hypot(p.x - M.x, p.z - M.z) + Math.abs(p.y - M.y);
  M.preyT -= dt; if (M.preyT <= 0) { M.preyT = 20; let best = null, bv = -1; for (const p of ps) { let m = 1e9; for (const q of ps) if (q !== p) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(p.y - q.y)); if (ps.length === 1) m = 0; const v = m + p.heat * 20 + CR() * 8; if (v > bv) { bv = v; best = p; } } M.prey = best ? best.id : null; }
  for (const p of PL.values()) p.heat = Math.max(0, p.heat - dt * .05);
  for (const hp of PL.values()) if (hp.eq === 5 && hp.hd < 0 && !hp.down && !hp.dead && Math.hypot(hp.x - M.x, hp.z - M.z) < 5.5 && Math.abs(hp.y - M.y) < 3 && M.state !== 'flee') { M.state = 'flee'; M.flee = 4; M.tgt = null; M.notT = M.wind = M.lunge = 0; const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); emit({k: 'snd', s: 'lunge'}); break; }
  for (const fl of G.flares) if (fl.t > 0 && Math.hypot(fl.x - M.x, fl.z - M.z) < 9.5 && Math.abs(fl.y - M.y) < 4 && M.state !== 'flee') { M.state = 'flee'; M.flee = 6; M.tgt = null; M.notT = M.wind = M.lunge = 0; const q = randNode(null); if (q) goTo(q[0], q[1], q[2]); emit({k: 'snd', s: 'creak', x: +M.x.toFixed(1), y: +(M.y + 1.5).toFixed(1), z: +M.z.toFixed(1)}); break; }
  M.senseT = (M.senseT || 0) - dt;
  if (M.senseT <= 0) { M.senseT = .12; let bs = 0, bp = null; for (const p of ps) { const s = seesP(p) * (p.id === M.prey ? 1.25 : 1); if (s > bs) { bs = s; bp = p; } } M.see = bs; M.seeP = bp ? bp.id : null; }
  const see = M.state === 'flee' ? 0 : M.see, seeP = PL.get(M.seeP);
  if (see > 0) M.aware = Math.min(1.5, M.aware + dt * see / D.react); else M.aware = Math.max(0, M.aware - dt * .25);
  // the notice beat: it freezes, snaps round to face you and clicks, a moment before it comes
  if (see > 0 && seeP && (M.state === 'roam' || M.state === 'inv') && M.aware >= .4 && (M.awP || 0) < .4) { M.notT = .6; M.notP = seeP.id; emit({k: 'snd', s: 'notice', x: +M.x.toFixed(1), y: +(M.y + 2.2).toFixed(1), z: +M.z.toFixed(1)}); }
  M.awP = M.aware;
  if (see > 0 && seeP && (M.aware >= 1 || dOf(seeP) < 5)) {
    if (M.state !== 'chase') { M.state = 'chase'; if (G.t - M.screamT > 9) { M.screamT = G.t; emit({k: 'snd', s: 'stinger'}); } }
    if (!tgt || tgt.id === seeP.id || dOf(seeP) < dOf(tgt) - 6) tgt = seeP;
    M.tgt = tgt.id; M.lx = tgt.x; M.ly = tgt.y; M.lz = tgt.z; M.lostT = 0; M.seenAt = G.t; M.sawHide = -1;
  }
  if (M.notT > 0 && M.state !== 'flee') { M.notT -= dt; const np = PL.get(M.notP); if (np) M.yaw += angD(M.yaw, Math.atan2(-(np.x - M.x), -(np.z - M.z))) * Math.min(1, dt * 14); M.spd = mix(M.spd, 0, Math.min(1, dt * 12)); return finish(dt); }
  let speed = 1.7; const prog = G.power ? .08 : 0;
  switch (M.state) {
    case 'roam': { if (!M.path.length) { M.idle -= dt; M.look = Math.sin(G.t * 1.3) * .3; if (M.idle <= 0) { pickRoam(); M.idle = 1.5 + CR() * 4; } } speed = (M.avoidT > 0 ? 2.6 : 1.7) + prog * 4; break; }
    case 'inv': { speed = 3.1 + prog * 5; if (moveAlong(dt, speed)) { if (M.invZone >= 0 && BLD[M.invZone].hides.length) { startSearch(M.invZone); break; } M.idle += dt; M.look = Math.sin(G.t * 2) * .5; if (M.idle > 3.5) { M.state = 'roam'; M.idle = 1; M.avoidT = 10; } } return finish(dt); }
    case 'chase': {
      speed = D.chase * (1 + prog) * (1 + .08 * TOD.night);
      if (!tgt) { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx, M.ly, M.lz); break; }
      if (tgt.hd >= 0 && M.sawHide === tgt.hd) { const h = HIDES[tgt.hd]; M.rep -= dt; if (M.rep <= 0 || !M.path.length) { M.rep = .4; goTo(h.ex, h.y, h.ez); } if (Math.hypot(M.x - h.ex, M.z - h.ez) < 1.1 && Math.abs(M.y - h.y) < 1.5) { emit({k: 'snd', s: 'creak', x: +h.x.toFixed(1), y: +(h.y + 1).toFixed(1), z: +h.z.toFixed(1)}); downPlayer(tgt, 'pulled'); return finish(dt); } }
      else if (tgt.hd >= 0 && G.t - M.seenAt < 1.2) M.sawHide = tgt.hd;
      else {
        if (see > 0 && M.seeP === tgt.id) { M.rep -= dt; if (!(M.wind > 0 || M.lunge > 0) && (M.rep <= 0 || !M.path.length)) { M.rep = .3; if (Math.abs(tgt.y - M.y) < 1 && clearLine(M.x, M.z, tgt.x, tgt.z, M.y + 1)) M.path = [[tgt.x, tgt.z]]; else goTo(tgt.x, tgt.y, tgt.z); } }
        else { M.lostT += dt; if (!M.path.length) goTo(M.lx, M.ly, M.lz); if (M.lostT > D.lost) { M.tgt = null; const z = zoneOf(M.lx, M.lz, M.ly); if (z >= 0 && BLD[z].hides.length) startSearch(z, true); else { M.state = 'inv'; M.idle = 0; M.invZone = -1; goTo(M.lx, M.ly, M.lz); } } }
        if (Math.hypot(tgt.x - M.x, tgt.z - M.z) < 1.3 && Math.abs(tgt.y - M.y) < 1.4) { downPlayer(tgt, 'caught'); return finish(dt); }
      }
      break;
    }
    case 'search': {
      speed = 2.4 + prog * 4;
      if (M.chkT > 0) { M.chkT -= dt; M.spd = 0; const h = M.chkH; M.yaw += angD(M.yaw, Math.atan2(-(h.x - M.x), -(h.z - M.z))) * Math.min(1, dt * 6);
        if (M.chkT <= .9 && !M.chkDone) { M.chkDone = true; emit({k: 'snd', s: 'creak', x: +h.x.toFixed(1), y: +(h.y + 1).toFixed(1), z: +h.z.toFixed(1)}); for (const p of PL.values()) if (p.hd === h.i && !p.hb && !p.down) { downPlayer(p, 'pulled'); return finish(dt); } }
        if (M.chkT <= 0) nextCheck(); return finish(dt); }
      if (moveAlong(dt, speed)) { if (M.chkH) { M.chkT = 1.8; M.chkDone = false; } else nextCheck(); }
      for (const p of PL.values()) if (p.hd >= 0 && !p.hb && Math.hypot(p.x - M.x, p.z - M.z) < 3.2 && Math.abs(p.y - M.y) < 2 && CR() < dt * D.breathHear * 2 && M.chkH !== HIDES[p.hd]) { M.chk.unshift(HIDES[p.hd]); nextCheck(); break; }
      return finish(dt);
    }
    case 'flee': { speed = 5.2; M.flee -= dt; if (M.flee <= 0 || !M.path.length) { M.state = 'roam'; M.idle = 3; M.avoidT = 8; } break; }
  }
  if (M.state === 'chase' && tgt) { M.lcd = (M.lcd || 0) - dt; const dd = Math.hypot(tgt.x - M.x, tgt.z - M.z);
    // the lunge: a .3 s crouch aimed at where you stand (the tell), then a dash at double speed. Sidestep it.
    if (M.wind > 0) { M.wind -= dt; M.spd = 0; const [wx, wz] = M.path[0] || [tgt.x, tgt.z]; M.yaw += angD(M.yaw, Math.atan2(-(wx - M.x), -(wz - M.z))) * Math.min(1, dt * 12); if (M.wind <= 0) M.lunge = .55; return finish(dt); }
    if (M.lunge > 0) { M.lunge -= dt; speed *= 2; M.spd = Math.max(M.spd, speed); }
    else if (M.lcd <= 0 && dd < 6 && dd > 1.8 && Math.abs(tgt.y - M.y) < 1 && clearLine(M.x, M.z, tgt.x, tgt.z, M.y + 1)) { M.wind = .3; M.lcd = 5; M.path = [[tgt.x, tgt.z]]; emit({k: 'snd', s: 'lunge'}); } }
  moveAlong(dt, speed); return finish(dt);
}
function startSearch(z, fast) { const b = BLD[z]; M.state = 'search'; M.chk = b.hides.filter(() => CR() < D.checkP * (fast ? 1.3 : 1)); M.chk.sort(() => CR() - .5); M.chkH = null; M.chkT = 0; M.searchZ = z; goTo(b.din[0], b.fy, b.din[1]); if (M.chk.length) nextCheck(); }
function nextCheck() { M.chkT = 0; M.chkH = M.chk.shift() || null; M.chkDone = false; if (M.chkH) goTo(M.chkH.ex, M.chkH.y, M.chkH.ez); else { M.state = 'roam'; M.idle = 0; M.avoidT = 25; M.path = []; pickRoam(); } }
function finish(dt) {
  M.stuck += dt; if (M.stuck > 2.5) { if (Math.hypot(M.x - M.sx, M.z - M.sz) < .5 && M.path.length) { M.path = []; if (M.goal) goTo(M.goal[0], M.goal[1], M.goal[2]); } M.stuck = 0; M.sx = M.x; M.sz = M.z; }
  if (M.state !== 'flee') for (const p of alive()) if (p.hd < 0 && Math.hypot(p.x - M.x, p.z - M.z) < 1.0 && Math.abs(p.y - M.y) < 1.4) { downPlayer(p, 'caught'); break; }
  M.stepAcc = (M.stepAcc || 0) + M.spd * dt; if (M.stepAcc > 1.3) { M.stepAcc = 0; emit({k: 'mstep'}); }
}

// ---------------- events
function emit(e) { if (isHost()) goalHook(e, 0); applyEv(e); if (Net.role === 'host') G.evq.push(e); if (isHost()) goalHook(e, 1); }
function applyEv(e) {
  const me = myId();
  switch (e.k) {
    case 'hatch': case 'dive': case 'lock': case 'lin': case 'subno': subEv(e, me); break;
    case 'tod': { const L = {1: ['The sun is going down. Make the most of the light.', 'SUNSET'], 2: ['Night is coming. Something stirs under the water.', 'DUSK'], 3: ['Full dark. Stay close to land and keep a flare handy.', 'NIGHT'], 4: ['First light. Whatever was out there is sinking back down.', 'DAWN']}[e.p]; if (L) { showMsg(L[0], L[1], 6); if (e.p >= 2 && e.p < 4) Snd.deep(); } break; }
    case 'snd': { const ps = e.x != null && A.on ? at(e.x, e.y, e.z, 3) : null;
      if (e.s === 'stinger') Snd.stinger(); else if (e.s === 'creak') Snd.creak(ps || A.mPan); else if (e.s === 'lunge') Snd.shriek(A.mPan);
      else if (e.s === 'notice') { M.ntC = .6; if (ps) { burst(3300, 9, .3, .014, 'bandpass', ps); setTimeout(() => burst(2900, 9, .26, .014, 'bandpass', ps), 85); burst(2100, .9, .14, .75, 'bandpass', ps, 1.25); } }
      else if (e.s === 'stwHm') { if (ps) { hTone(98, .16, .5, 'triangle', ps); hTone(110, .14, .7, 'triangle', ps, .45, 140); Snd.bell(ps); } }
      else if (e.s === 'stwSee') { if (inCruise(cam.position.x, cam.position.z, cam.position.y)) { Snd.stinger(); Snd.shriek(at(STS.x, STS.y + 2.6, STS.z, 6)); } } else if (e.s === 'shriekS') Snd.shriek(at(STS.x, STS.y + 2.6, STS.z, 6));
      else if (e.s[0] === 'g' && e.s[1] === 'u') { if (ps && G.uw > .3 && Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < 80) {
        if (e.s === 'gulL') Snd.roar(ps, .35);
        else if (e.s === 'gulS') { const lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.connect(ps); tone(90, .3, 1.8, 'sawtooth', lp, 140); for (let i = 0; i < 4; i++) setTimeout(() => burst(4200, 9, .06, .01, 'bandpass', ps), 450 + i * 170); }
        else if (e.s === 'gulF') burst(1200, 1, .3, 1.6, 'bandpass', ps, 1.3); } }
      break; }
    case 'mstep': { const d = Math.hypot(cam.position.x - M.x, cam.position.z - M.z) + Math.abs(cam.position.y - M.y); if (d < 40) Snd.mStep(clamp(1.2 - d / 40, .1, 1) * (M.state === 'chase' ? 1.5 : 1)); break; }
    case 'down': { const p = PL.get(e.id); if (p) { p.down = true; p.hd = -1; p.seat = 0; }
      if (e.id === me) { if (P.hd >= 0 && HIDES[P.hd]) { const h = HIDES[P.hd]; P.x = h.ex; P.z = h.ez; } const jsc = e.how === 'caught' || e.how === 'pulled'; if (jsc) { G.js = {t: 1.4, L: 1.4, mon: e.st ? STW : MON, J: e.st ? SJ : MJ}; G.shake = 1.5; } Snd.scream(); $('flash').style.opacity = jsc ? .3 : .7; setTimeout(() => $('flash').style.opacity = 0, 300); P.hd = -1; P.seat = 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); if (PL.size > 1) showMsg('It got you. Crawl toward your crew, they can pick you up.', '', 5); }
      else if (p) { Snd.hurt(at(p.x, p.y + 1, p.z, 6)); showMsg(`${p.name} is down! Hold E on them to pick them up.`, '', 5); } break; }
    case 'rev': { const p = PL.get(e.id); if (p) p.down = false; Snd.revive(); showMsg(e.id === me ? 'You are back on your feet.' : `${p ? p.name : ''} is back up.`); break; }
    case 'dead': { const p = PL.get(e.id); if (p) { p.dead = true; p.down = false; p.drowned = e.drown || 0; p.sw = 0; } if (e.drown) Snd.deep(); if (e.id === me) { const t = e.drown === 4 ? 'Your arms give out. The sea closes over you.' : e.drown === 3 ? 'Needle teeth close on your hose. Then nothing.' : e.drown === 2 ? 'Your air runs out. The dark closes in.' : e.drown ? 'Something huge wraps around your legs and pulls you under.' : 'You bled out.'; if (e.drown === 1) { if (!G.maw) G.maw = {t: 3, x: P.x, z: P.z}; G.maw.bite = G.maw.t + .9; G.drownCam = {t: 0, x: P.x, z: P.z, yaw: P.yaw}; } P.dead = true; P.sw = 0; P.seat = 0; P.drowned = e.drown || 0; showMsg(t, '', 5); }
      else showMsg(`${p ? p.name : 'Someone'} ${e.drown === 4 ? 'drowned' : e.drown === 2 ? 'ran out of air' : e.drown === 3 ? 'was taken in the deep' : e.drown ? 'was pulled under' : 'bled out'}. They will wash up at the lighthouse.`, '', 5); break; }
    case 'resp': { const p = PL.get(e.id); if (p) { p.dead = false; p.down = false; p.drowned = false; } if (e.id === me) { Object.assign(P, {dead: false, down: false, sw: 0, ob: 0, seat: 0, x: e.x, y: 2, z: e.z, vy: 0, hd: -1, bat: Math.max(P.bat, .6), drowned: false}); showMsg('You wash up at the lighthouse, coughing seawater.', '', 4); } break; }
    case 'deepw': if (e.id === me) { Snd.gasp(); showMsg('Your arms are getting heavy. Get out of the water.', '', 4); } break;
    case 'give': if (e.id === me) { if (e.kind === 'battery') { P.bat = Math.min(1, P.bat + .5); showMsg('Fresh batteries.'); } if (e.kind === 'flare') { P.flares += e.n || 1; showMsg(`Picked up ${e.n > 1 ? e.n + ' flares' : 'a flare'}. Throw them with G.`); } Snd.pickup(); } break;
    case 'sack': { const p = PL.get(e.id), q = e.s.map(i => KINDS[i]); if (p) { const more = q.length > (p.sack || []).length; p.sack = q; p.carry = q[q.length - 1] || null;
      if (e.id === me) { P.sack = q; P.carry = p.carry; if (more) { const k = q[q.length - 1]; Snd.pickup(); showMsg(`+ ${NAMES[k]}${VALUE[k] ? ' · $' + VALUE[k] : ''}`, '', 1.6); } } } break; }
    case 'item': if (!isHost() && !ITEMS[e.i]) { while (ITEMS.length < e.i) { const d = addItem('note', {x: 0, y: -99, z: 0}); d.taken = true; d.mesh.visible = false; } addItem(e.kind, {x: e.x, y: e.y, z: e.z}); } break;
    case 'stow': (Snd.stow || Snd.coin)(); if (e.id === me) showMsg(`Stowed · hold ${cashStr(e.v || 0)}`, '', 2); break;
    case 'sold': { (Snd.sale || Snd.coin)(e.v); const N = {fuel: 'drum', blackbox: 'black box', gold: 'gold bar', key: 'key card'}, r = e.c ? Object.entries(e.c).filter(q => q[1] > 0).map(([k, n]) => { const w = N[k] || (k === 'fish' ? 'fish' : NAMES[k] || k).replace(/^(cargo|ghostly|treasure|creature|black) /, ''); return n + ' ' + (n > 1 && !/fish|scrap/.test(w) ? w + (/x$/.test(w) ? 'es' : 's') : w); }).join(' · ') : ''; showMsg(r || 'Sold at the harbour shed', '+' + cashStr(e.v || 0), 3.5); break; }
    case 'bought': Snd.coin(); if (e.hull != null) { toast('NEW SHIP', e.n); G.cine = 3; Snd.shipHorn && Snd.shipHorn(e.hull, null); } else showMsg(`${e.n} ✓`, '', 2); break;
    case 'boatuse': Snd.pickup(); showMsg(e.what === 'fuel' ? 'Fuel poured into the tank.' : 'Hull patched.'); break;
    case 'bottle': { Snd.pickup(); const d = DIGS[e.i]; if (d) { d.rev = true; showMsg(`A map in a bottle! An X is marked on ${d.isle}. It is on your compass now.`, '', 6); } else if (BOTTLE_NOTES[e.n]) showMsg(BOTTLE_NOTES[e.n].replace('\n', '<br>'), 'A NOTE IN A BOTTLE', 7); else showMsg('A bottle with a note inside: "Whoever reads this: the shallows are safe."'); break; }
    case 'dug': { const d = DIGS[e.i]; d.dug = true; Snd.dig(); showMsg(e.g > 1 ? 'Treasure! A chest, gold bars and a black pearl.' : e.g ? 'Treasure! A chest and a gold bar.' : 'Treasure! A chest was buried here.', '', 4); break; }
    case 'valve': { const v = VALVES[e.i]; v.open = true; Snd.valve(at(v.x, v.y + 1, v.z, 8)); showMsg(`The ${v.name} is open (${VALVES.filter(q => q.open).length} of 2).`); break; }
    case 'power': G.power = true; MAT.bulb.emissiveIntensity = 2.5; MAT.screen.emissiveIntensity = 1; if (!e.quiet) { Snd.power(); showMsg('The generator coughs and catches. Floodlights flare across the rig. An alarm starts wailing.', '', 6); G.alarmT = 22; } break;
    case 'bb': showMsg('The flight recorder ejects with a clunk. A black box, worth a fortune to the right people.', '', 5); break;
    case 'disc': if (!G.disc.includes(e.i)) G.disc.push(e.i); Snd.discover(); toast(POIS[e.i].n, e.c ? `Charted · +${cashStr(e.c)}` : 'Discovered'); break;
    case 'goal': if (!G.goals.includes(e.i)) G.goals.push(e.i); (G.banQ = G.banQ || []).push({h: 'LOGBOOK', t: GOALS[e.i], c: e.c, s: 'goal'}); break;
    case 'rank': G.rankI = Math.max(G.rankI || 0, e.i); (G.banQ = G.banQ || []).push({h: 'NEW RANK', t: (TITLES[e.i] || TITLES[0])[1], s: 'rank'}); break;
    case 'helm': { const p = PL.get(e.id); for (const q of PL.values()) q.seat = 0; if (p) p.seat = e.on ? 1 : 0; if (e.id === me) P.seat = e.on ? 1 : 0; B.driver = e.on ? e.id : null; break; }
    case 'bump': { const nr = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30); if (nr) { G.shake = Math.max(G.shake || 0, e.s); burst(120, 1, .6 * e.s, .6, 'lowpass', P.ob ? null : at(B.x, .5, B.z, 12)); } break; }
    case 'circle': { const nr = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30); if (LEV.on && !G.maw) LEV.hide(); G.spines = {t: 0, a: e.a, L: e.L || 9, circle: 1};
      if (nr) { Snd.deep(); let seen = G.tipDeep; try { seen = seen || localStorage.getItem('s9-tip-deep'); localStorage.setItem('s9-tip-deep', '1'); } catch (x) {} G.tipDeep = 1;
        if (!seen) showMsg('Something huge is circling the boat. <kbd>G</kbd> throw a flare into the sea' + (P.own && (P.own.glock || P.own.sg) ? ', or shoot it when it rears up' : '') + (P.flares > 0 ? '.' : '. Or run for land.'), '', 7); else showMsg('It is circling.', '', 2); }
      else if (P && G.wt - ((G.farT = G.farT || {}).a ?? -99) > 20) { G.farT.a = G.wt; showMsg('Your boat is under attack!', '', 3); } break; }
    case 'deepgone': { const nr = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30); if (nr || e.by === me) showMsg(e.dead ? 'It sinks in a cloud of black blood. Something glints.' : e.fl ? 'It sinks away from the red light.' : 'It sinks out of sight.', '', 3);
      if (e.dead) { Snd.roar(at(LEV.hp.x, 0, LEV.hp.z, 25)); spray(LEV.hp.x, .2, LEV.hp.z, 40, 6); if (e.by === me) { hTone(70, .35, .2); hTone(52, .3, .3, 'sine', null, .13); } }
      if (G.spines) { G.spines.leave = G.spines.t; G.spines.circle = 0; if (e.lx != null) { G.spines.gx = e.lx; G.spines.gz = e.lz; } } break; }
    case 'ram': { const nr = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30), big = HC().big;
      if (nr) { G.shake = big ? .6 : 1.4; Snd.ram(P.ob ? null : at(B.x, .5, B.z, 12)); showMsg(big ? 'Something huge scrapes along the keel.' : HC().sub ? 'It slams the hull. The whole sub rings like a bell.' : ['It slams into the hull!', 'The boat lurches. It is under us.', 'Wood splinters below the waterline!'][Math.floor(Math.random() * 3)], '', 2.5);
        if (P.ob && !P.seat && !inCabin() && !big && Math.random() < .12) { const [lx, lz] = P.bl; const s = lx >= 0 ? 1 : -1; P.ob = 0; const [wx, wz] = bL2W(lx + s * 3, lz); P.x = wx; P.z = wz; P.vy = 3; showMsg('You are thrown overboard!', '', 3); } }
      else if (P && G.wt - ((G.farT = G.farT || {}).a ?? -99) > 20) { G.farT.a = G.wt; showMsg('Your boat is under attack!', '', 3); } break; }
    case 'sink': { const nr = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30);
      if (nr) { G.shake = 2; Snd.ram(P.ob ? null : at(B.x, .5, B.z, 12)); Snd.deep(); showMsg('The boat is going down! Abandon ship!', '', 5); } else if (P && G.wt - ((G.farT = G.farT || {}).s ?? -99) > 20) { G.farT.s = G.wt; showMsg('Your boat is sinking!', '', 3); }
      if (P && P.ob) { P.ob = 0; P.seat = 0; P.y = .1; } if (P) { P.climb = null; P.lkOut = 0; P.rest = 0; } break; }
    case 'boatback': showMsg('A tug drags your boat back to the lighthouse. The cargo is lost.', '', 5); if (P && !P.dead && (P.sw || P.y < 1) && Math.hypot(P.x - e.x, P.z - e.z) < 80) { const sp = boatSpawn(0); P.sw = 0; P.ob = 1; P.bl = sp.bl; P.y = sp.y; } break;
    case 'horn': if (Snd.shipHorn) Snd.shipHorn(e.c, at(B.x, B.heave + 6, B.z, 25 + (HULLS[e.c] || HULLS[0]).L)); break;
    case 'hdmg': { if (A.on && Snd.crack) { const p = at(B.x, B.heave + 1, B.z, 10); if ((B.up.cls || 0) <= 1) Snd.crack(p, e.n); else Snd.groan(p, e.n); } if (P && P.ob) G.shake = Math.max(G.shake || 0, e.n / 20); const h = $('hullB'); if (h && h.animate) h.animate([{filter: 'brightness(2.6)', transform: 'scaleY(2.4)'}, {filter: 'none', transform: 'none'}], {duration: 500, easing: 'ease-out'}); break; }
    case 'storm': if (e.on) showMsg('The wind picks up. A storm is rolling in.', '', 4); else showMsg('The storm passes. The moon comes out.', '', 4); break;
    case 'fl': if (e.id !== me) spawnFlare(e); break;
    case 'tug': if (!isHost()) B.got = 0; showMsg(e.id === me ? 'You wash up at the lighthouse. The harbour tug towed your boat in.' : 'The harbour tug towed your boat to the jetty.', '', 4); break;
    case 'nope': if (e.id === myId()) { showMsg(e.why, 'HARBOUR SHED', 2.5); tone(180, .05, .25, 'triangle', null, 120); } break;
    case 'coolfull': if (e.id === myId()) showMsg('Cooler full. Sell at the shed.', '', 3); break;
    case 'gear': if (e.id === me) gotGear(e.g); else Snd.coin(); break;
    case 'cooler': if (e.id === me) { P.coolerN = e.n; P.coolerV = e.v; } break;
    case 'catch': { const p = PL.get(e.id); if (e.id !== me && p) showMsg(`${p.name} landed a ${FISH[e.f].n} (${e.kg} kg)!`, '', 3); break; }
    case 'shot': if (e.id !== me) gunFx([e.x, e.y, e.z], e.w, false); break;
    case 'mhit': hitFx(e.x, e.y, e.z, e.head, e.by); break;
    case 'mdown': Snd.scream(A.mPan); if (e.by === me) { hTone(70, .35, .2); hTone(52, .3, .3, 'sine', null, .13); } showMsg('It shrieks, collapses, and drags itself over the edge into the sea.', '', 5); break;
    case 'sunk': { const q = SUNK[e.i]; if (q) q.got = true; Snd.pickup(); Snd.discover(); showMsg(`The claw grabs a sunken ${NAMES[e.kind]} off the sea bed! It goes in the hold ($${VALUE[e.kind]}).`, '', 4); break; }
    case 'holdbig': if (e.id === myId()) showMsg('That hull has a smaller hold. Sell or unload your cargo first.', '', 3); break;
    case 'holdfull': if (e.id === myId()) showMsg(`Hold full (${holdCap()} slots). Sell at the shed or buy hold racks or a bigger hull.`, '', 3); break;
    case 'fw': spawnRocket(e); break;
    case 'radio': G.radioOn = !!e.on; break;
    case 'sunkp': { const q = SUNK[e.i]; if (q) q.got = true; break; }
    case 'bite': { const p = PL.get(e.id); if (e.id === me) { P.air = Math.max(0, (P.air ?? 1) - .45); G.shake = 1.6; $('flash').style.opacity = .6; setTimeout(() => $('flash').style.opacity = 0, 250); Snd.scream(); Snd.bubbles(); showMsg('Something tore at you in the dark. Your air hose is leaking. Get up, or burn a flare (6).', '', 4); } else if (p) Snd.hurt(at(p.rx, p.ry, p.rz, 8)); break; }
    case 'claim': Snd.horn(at(CRZ.x, 20, CRZ.z, 200)); Snd.power(); showMsg('She is yours. Switch to her at the shed.', 'SERENADE', 7); G.cruise = 1;
      G.cine = 14; G.camFly = {t: 0, T: 12, a: Math.random() * 6.28, st: e.st || {}}; setTimeout(() => G.on && Snd.horn(at(CRZ.x, 20, CRZ.z, 200)), 2500);
      if (isHost() && STS.state !== 'dead' && STS.state !== 'gone') { STS.state = 'flee'; STS.flee = 20; const n = CN.ok && CN.ok.length ? CN[CN.ok[Math.floor(Math.random() * CN.ok.length)]] : null; if (n) stwGo(n.x, n.y, n.z); }
      for (let k = 0; k < 12; k++) setTimeout(() => G.on && spawnRocket({x: CRZ.x + (Math.random() - .5) * 8, y: 40, z: CRZ.z + (Math.random() - .5) * 16, vx: (Math.random() - .5) * 7, vy: 20 + Math.random() * 8, vz: (Math.random() - .5) * 7, c: Math.floor(Math.random() * 6)}), 300 + k * 500 + Math.random() * 250); break;
    case 'sstep': { const d = Math.hypot(cam.position.x - STS.x, cam.position.z - STS.z) + Math.abs(cam.position.y - STS.y); if (d < 45) Snd.sStep(at(STS.x, STS.y, STS.z, 4), clamp(1.3 - d / 45, .1, 1)); break; }
    case 'shit': hitFx(e.x, e.y, e.z, e.head, e.by); if (Math.random() < .5) Snd.shriek(at(STS.x, STS.y + 2.5, STS.z, 6)); break;
    case 'sdown': Snd.scream(at(STS.x, STS.y + 2, STS.z, 10)); if (e.by === me) { hTone(70, .35, .2); hTone(52, .3, .3, 'sine', null, .13); } showMsg('The Steward folds over and crawls away below decks. It will be back.', '', 5); break;
    case 'dhit': Snd.splash(at(e.x, 0, e.z, 20)); burst(80, 1, .4, 1, 'lowpass'); hitFx(e.x, (e.y || 0) + 1, e.z, e.h, e.by); if (e.h) Snd.roar(at(e.x, e.y || 0, e.z, 25), .5); break;
    case 'wh': { const p = PL.get(e.id); if (p) { p.pingT = 6; Snd.whistle(at(p.x, p.y + 1.6, p.z, 8)); } break; }
    case 'bounty': (G.banQ = G.banQ || []).push({h: 'BOUNTY', t: e.n, c: e.c, s: 'bounty'}); break;
  }
}

// ---------------- host simulation
function dropCarry(p, all = true) { if (!p.sack || !p.sack.length) return; const L = all ? p.sack.splice(0) : [p.sack.pop()]; sackSet(p); L.forEach((k, i) => dropOne(p, k, i)); }
function dropOne(p, k, i) {
  if (p.ob && BG.sub && p.y < BDECK.y - 1) { if (holdFits(k)) B.hold.push(k); else { p.sack.push(k); sackSet(p); emit({k: 'holdfull', id: p.id}); } return; } // inside the sub it goes on the racks
  p = {x: p.x + (i % 3 - 1) * .5, y: p.y, z: p.z + Math.floor(i / 3) * .5};
  const f = floorAt(p.x, p.z, p.y + .5);
  if (f && f.y > -.5 && f.s.k !== 'boat') { const it = addItem(k, {x: p.x, y: f.y, z: p.z}); emit({k: 'item', i: it.i, kind: k, x: p.x, y: f.y, z: p.z}); }
  else if (f && f.s.k === 'boat' && holdFits(k)) B.hold.push(k);
  else { let i = G.floats.findIndex(q => !q); if (i < 0) i = G.floats.length; G.floats[i] = [p.x, p.z, KINDS.indexOf(k)]; }
}
// survival rules: bleed-out, suits, the harbour tug, the key card, fish prices
function bleedFor(p) { return alive().some(q => q !== p) ? D.bleed : PL.size > 1 ? 6 : 3.5; }
const suitOf = p => p === P ? ((P.own && P.own.suit) || 0) : (p.su || 0);
const money = cashStr;
const freeAll = () => isHost() ? ALL : !!G.hostAll;
const coolerVal = a => a.reduce((s, c) => s + (Array.isArray(c) ? c[1] : (FISH[c] ? FISH[c].v : 0)), 0);
function fishVal(k, x, z) { const dh = Math.hypot(x - HOME.x, z - HOME.z), rg = mapRegion(x, z), pay = rg ? mix(1, rg.pay, mapRegion.w) : 1; return Math.max(1, Math.round(FISH[k].v * clamp(.45 + dh / 2400, .45, 1.5) * pay)); }
function tugWhy() { const pl = [...PL.values()].filter(q => q.ready && !q.dead);
  return B.sink > 0 ? 'The boat is going down.' : Math.hypot(B.x - JETTY.x, B.z - JETTY.z) <= 120 + BG.L * .5 ? 'The boat is already by the jetty.' : B.driver || pl.some(q => q.ob || q.seat) ? 'Someone is aboard or at the wheel.' : pl.some(q => Math.hypot(q.x - B.x, q.z - B.z) < 60) ? 'Someone is still out by the boat.' : ''; }
function canTug() { return !tugWhy(); }
function towIfStranded(p) {
  if (B.sink > 0 || B.driver || Math.hypot(B.x - JETTY.x, B.z - JETTY.z) <= 60 + BG.L * .5) return;
  if ([...PL.values()].some(q => q !== p && q.ready && !q.down && !q.dead && (q.ob || q.seat || Math.hypot(q.x - B.x, q.z - B.z) < 60 || Math.hypot(q.x - HOME.x, q.z - HOME.z) > 150))) return;
  resetBoat(false); emit({k: 'tug', id: p.id});
}
const BOTTLE_NOTES = [
  "STATION NINE, LAST SHIFT\nHead office calls the scratching in the pipes 'operational noise'. Overtime approved.",
  "STATION NINE\nThe safety inspector signed us off by fax from his yacht. That night the drill floor went quiet.",
  "AURELIA, PURSER\nShe went down with the lifeboats still padlocked. The owners called it a strong quarter.",
  "AURELIA, DECK LOG\nOrdered to hold schedule through the storm. The schedule survived.",
  "THE TRENCH\nThe chart says 'depth under review'. The ministry has been reviewing it for forty years.",
  "THE TRENCH\nLights down there at night. Not ours. Something else is fishing.",
  "MS SERENADE\nThe Steward still folds the towels into swans. Never let it hear you on the stairs.",
  "GREY LADY\nHer lights burn green on calm nights. The harbour board says she was never registered.",
];
function keyCheck() {
  if (G.cruise) return; const ki = KINDS.indexOf('key');
  if (ITEMS.some(it => it.kind === 'key' && !it.taken) || [...PL.values()].some(q => (q.sack || []).includes('key')) || B.hold.includes('key') || G.floats.some(f => f && f[2] === ki)) return;
  const s = SPOTS.find(q => q.tag === 'key'); if (s) { const it = addItem('key', s); emit({k: 'item', i: it.i, kind: 'key', x: s.x, y: s.y, z: s.z}); }
}
function hostStep(dt) {
  G.t += dt;
  boatStep(dt); if (BG.sub) subHost(dt);
  for (const p of PL.values()) {
    if (!p.ready) continue;
    if (p.ob && p !== P) { const [wx, wz] = bL2W(p.bl[0], p.bl[1]); p.x = wx; p.z = wz; }
    const mv = Math.hypot(p.x - p.lx, p.z - p.lz); p.lx = p.x; p.lz = p.z; p.spd = mix(p.spd, mv / Math.max(dt, 1e-3), Math.min(1, dt * 5));
    if (p !== P && !p.down && mv < 3 && !p.ob) { p.sd += mv; if (p.sd > (p.run ? 1 : .75)) { p.sd = 0; noise(p.x, p.y, p.z, p.run ? 22 : p.cr ? 2 : 8); if (p.run) p.heat += .02; } }
    if (p === P ? lightOn() : p.l) p.heat = Math.min(1, p.heat + dt * .004);
    if (p.down && !p.dead) { if (!alive().length && p.bleed > 5) p.bleed = 5; p.bleed -= dt; if (p.bleed <= 0) { p.down = false; p.dead = true; p.deadT = 0; emit({k: 'dead', id: p.id}); } }
    if (p.dead) { p.deadT = (p.deadT || 0) + dt; if (p.deadT > (PL.size > 1 ? 12 : 5)) { p.deadT = 0; p.dead = false; p.x = -4 + CR() * 4; p.z = -262; p.y = 2; p.sw = 0; p.ob = 0; emit({k: 'resp', id: p.id, x: p.x, z: p.z}); towIfStranded(p); } }
    if (p.sw && p.deep && !p.dead && !suitOf(p)) { const lim = D.drown * 6.5; p.swT += dt; if (p.swT > lim - 20 && !p.warned) { p.warned = true; emit({k: 'deepw', id: p.id}); } if (p.swT > lim) { p.dead = true; p.deadT = 0; p.swT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 4}); } } else { p.swT = Math.max(0, p.swT - dt * 3); if (p.swT < D.drown * 6.5 - 30) p.warned = false; }
  }
  // holds: valves, generator, console, digging, reviving
  const hold = {};
  for (const p of PL.values()) {
    if (!p.ready || !p.h || p.down || p.dead || p.sw) continue;
    const k = p.h, near = (x, y, z, r) => Math.hypot(p.x - x, p.z - z) < r && Math.abs(p.y - y) < 2;
    let ok = false;
    if (k[0] === 'v') { const v = VALVES[+k[1]]; ok = v && !v.open && near(v.x, v.y, v.z, 3); }
    else if (k === 'g') { const b = BLD.find(q => q.kind === 'gen'); ok = !G.power && VALVES.every(v => v.open) && near(b.genP[0], b.fy, b.genP[2], 3.2); }
    else if (k === 'cz') { const b = CRZ.bridge; ok = !G.cruise && p.sack.includes('key') && near(b.console[0], b.fy, b.console[2], 3); if (ok && !['chase', 'dead', 'gone', 'flee'].includes(STS.state) && (G.czT = (G.czT || 0) - dt) <= 0) { G.czT = 1; STS.state = 'inv'; stwGo(p.x, p.y, p.z); } }
    else if (k === 'c') { const b = BLD.find(q => q.kind === 'ctrl'); ok = G.power && !G.bbOut && near(b.console[0], b.fy, b.console[2], 3); }
    else if (k[0] === 'd') { const d = DIGS[+k.slice(1)]; ok = d && !d.dug && near(d.x, d.y, d.z, 2.6); }
    else if (k[0] === 'r') { const q = PL.get(k.slice(1)); ok = q && q.down && near(q.x, q.y, q.z, 2.6); }
    if (ok) (hold[k] = hold[k] || []).push(p);
  }
  for (const k in G.holdP) if (!hold[k]) { G.holdP[k] -= dt * (k[0] === 'r' ? .5 : .1); if (G.holdP[k] <= 0) delete G.holdP[k]; }
  const dur = {v: 5, g: 4, c: 6, r: 4, d: 5}; if (hold.cz) G.holdP.cz = (G.holdP.cz || 0) + dt / 12 - dt / 6 * Math.min(2, .6 + .4 * hold.cz.length);
  for (const k in hold) {
    const n = hold[k].length; G.holdP[k] = (G.holdP[k] || 0) + dt / dur[k[0]] * Math.min(2, .6 + .4 * n + (n > 1 ? .2 : 0));
    G.noiseT = (G.noiseT || 0) - dt; if (G.noiseT <= 0) { G.noiseT = 1; const q = hold[k][0]; noise(q.x, q.y, q.z, k[0] === 'r' ? 14 : 24); }
    if (G.holdP[k] >= 1) {
      delete G.holdP[k]; const q = hold[k][0];
      if (k[0] === 'v') emit({k: 'valve', i: +k[1]});
      else if (k === 'g') { emit({k: 'power'}); const b = BLD.find(z => z.kind === 'gen'); noise(b.x, b.fy, b.z, 70); }
      else if (k === 'cz') { G.cruise = 1; q.sack.splice(q.sack.indexOf('key'), 1); sackSet(q); emit({k: 'claim', st: Object.assign({}, G.stat, {earned: G.earned, disc: G.disc.length, goals: G.goals.length + 1, crew: [...PL.values()].map(p => p.name)})}); goal(7); save(); }
      else if (k === 'c') { G.bbOut = true; emit({k: 'bb'}); giveCarry(q, 'blackbox'); goal(1); const b = BLD.find(z => z.kind === 'ctrl'); noise(b.x, b.fy, b.z, 50); }
      else if (k[0] === 'd') { const d = DIGS[+k.slice(1)], far = Math.hypot(d.x - HOME.x, d.z - HOME.z), ex = far > 3200 ? ['gold', 'gold', 'pearl', 'pearl'] : far > 1600 ? ['gold', 'gold', 'pearl'] : far > 800 ? ['gold'] : []; emit({k: 'dug', i: +k.slice(1), g: ex.length}); giveCarry(q, 'chest'); ex.forEach((kind, j) => { const x = d.x + Math.cos(j * 2.1 + .5) * 1.3, z = d.z + Math.sin(j * 2.1 + .5) * 1.3, y = Math.max(d.y - .4, landH(x, z)) + .03, it = addItem(kind, {x, y, z}); emit({k: 'item', i: it.i, kind, x, y, z}); }); goal(2); }
      else { const t = PL.get(k.slice(1)); if (t) { t.down = false; emit({k: 'rev', id: t.id}); } }
    }
  }
  // discovery
  G.discT = (G.discT || 0) - dt; if (G.discT <= 0) { G.discT = .5; POIS.forEach((q, i) => { if (G.disc.includes(i)) return; if (alive().some(p => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 40)) { emit({k: 'disc', i}); save(); if (POIS.every((_, j) => G.disc.includes(j))) goal(0); } }); }
  G.keyT = (G.keyT || 0) - dt; if (G.keyT <= 0) { G.keyT = 2; keyCheck(); } G.saveT = (G.saveT ?? 20) - dt; if (G.saveT <= 0) { G.saveT = 20; save(); }
  // floating cargo drifts; keep 16 of them out there
  mapFloatCull(dt); for (let i = 0; i < MAP_FLN; i++) { const f = G.floats[i]; if (!f) { if (CR() < dt * .05) spawnFloat(i); continue; } f[0] += Math.sin(G.t * .05 + i) * dt * .25; f[1] += Math.cos(G.t * .04 + i * 2) * dt * .25; }
  // weather
  G.stormT = (G.stormT ?? 200) - dt; if (G.stormT <= 0) { G.stormOn = !G.stormOn; G.stormT = G.stormOn ? 120 + CR() * 80 : 200 + CR() * 120; emit({k: 'storm', on: G.stormOn}); }
  G.storm = mix(G.storm, G.stormOn ? 1 : 0, Math.min(1, dt / 25));
  G.tod = (G.tod + dt / TOD_LEN) % 1; const ph = G.tod < .14 ? 0 : G.tod < .24 ? 1 : G.tod < .34 ? 2 : G.tod < .8 ? 3 : G.tod < .9 ? 4 : 0;
  if (ph !== G.todPh) { if (G.todPh >= 0 && ph) emit({k: 'tod', p: ph}); G.todPh = ph; }
  // the thing in the deep
  const homeD = Math.hypot(B.x - HOME.x, B.z - HOME.z), dRg = mapRegion(B.x, B.z), dK = dRg ? (dRg.deep ? mix(1, dRg.deep, mapRegion.w) : 0) : 1, nearLand = OBST.some(o => o.c && o.r > 5 && Math.hypot(B.x - o.x, B.z - o.z) < o.r + 70) || Math.hypot(B.x, B.z) < 80 || Math.hypot(B.x - CRZ.x, B.z - CRZ.z) < 140;
  G.deepT = (G.deepT ?? 40) - dt;
  // it only comes for a crew that is up on (or right beside) the boat: divers down below are the gulpers' business
  const crewUp = alive().some(p => (p.ob && !(HC().sub && (B.dep || 0) > 6)) || (!p.ob && Math.hypot(p.x - B.x, p.z - B.z) < 40 && !(p.sw && (p.dv || 0) > 3)));
  if (!G.enc && B.sink <= 0 && homeD > 280 && !nearLand && G.deepT <= 0) { G.deepT = 20 + CR() * 25; if (crewUp && CR() < (D.deep + .3 * G.storm + .25 * TOD.night) * .75 * dK) { const a = CR() * TAU; G.enc = {t: 9, L: 9, a, el: 0, hp: 90, t0: G.t}; emit({k: 'circle', a, L: 9}); } }
  if (G.enc) {
    G.enc.t -= dt; G.enc.el = (G.enc.el || 0) + dt;
    // a fresh flare in the sea (or burning on deck) close to the hull drives it off, away from the light
    const E = G.enc, rest = () => 150 + CR() * 90, rf = G.flares.find(f => f.t > 0 && (f.born ?? -1e9) >= E.t0 - 1 && (f.sea || f.surf) && Math.hypot(f.x - B.x, f.z - B.z) < levRad(Math.atan2(f.x - B.x, f.z - B.z)) + 13);
    if (!crewUp) { G.enc = null; G.deepT = 30; emit({k: 'deepgone'}); }
    else if (rf) { const lp = levPose(E.a, E.el, E.L || 9, _lo2), ax = lp.x - rf.x, az = lp.z - rf.z, al = Math.hypot(ax, az) || 1; G.enc = null; G.deepT = rest(); emit({k: 'deepgone', fl: 1, lx: +(lp.x + ax / al * 60).toFixed(1), lz: +(lp.z + az / al * 60).toFixed(1)}); }
    else if (E.t <= 0 || nearLand) { if (!nearLand) { const big = HC().big; damageBoat(D.ramDmg / [1, 1.5, 2.2][B.up.hull] * (big ? .3 : 1)); B.v *= big ? .85 : .35; B.yaw += (CR() - .5) * (big ? .08 : .5); emit({k: 'ram'}); if (CR() < .2) { const a = CR() * TAU; G.enc = {t: 8, L: 8, a, el: 0, hp: 70, t0: G.t}; emit({k: 'circle', a, L: 8}); } else { G.enc = null; G.deepT = rest(); } } else { G.enc = null; G.deepT = rest(); emit({k: 'deepgone'}); } }
  }
  if (G.earned >= 1500) goal(3); if (B.up.engine >= 3) goal(4);
  stepSunk(dt); stepCreature(dt); stepSteward(dt); stepGulpers(dt);
  for (const p of PL.values()) if (p.sw && (p.dv || 0) > 100 && !G.goals.includes(8)) goal(8);
}
function goal(i) { if (G.goals.includes(i)) return; const c = Math.round(GOAL_CASH[i] * (D.pay || 1)); G.cash += c; emit({k: 'goal', i, c}); save(); }
// host: charting fees before an event lands (ph 0), goals, ranks and voyage stats after it (ph 1)
function goalHook(e, ph) {
  if (ph === 0) { if (e.k === 'disc' && !e.c && !G.disc.includes(e.i)) { const q = POIS[e.i]; if (q && !q.home) { const c = Math.round((50 + Math.hypot(q.x - HOME.x, q.z - HOME.z) / 20) * (D.pay || 1)); G.cash += c; e.c = c; } } return; }
  const S = G.stat;
  switch (e.k) {
    case 'sold': if (e.v > 0) { goal(9); const r = titleOf(G.earned); if (r > (G.rankI || 0)) { G.rankI = r; emit({k: 'rank', i: r}); } } break;
    case 'bought': case 'gear': goal(10); break;
    case 'give': if (e.buy) goal(10); break;
    case 'disc': if (G.disc.length >= 4) goal(11); break;
    case 'catch': if (S) { S.fish++; S.maxKg = Math.max(S.maxKg || 0, +e.kg || 0); } break;
    case 'mdown': case 'sdown': if (S) S.kills++; break;
    case 'deepgone': if (S && e.dead) S.kills++; break;
    case 'dead': if (S) S.deaths++; break;
  }
}
function giveCarry(p, kind) { if (!sackFits(p, kind)) { const f = floorAt(p.x, p.z, p.y + .5); const it = addItem(kind, {x: p.x + .6, y: f ? f.y : p.y, z: p.z}); emit({k: 'item', i: it.i, kind, x: p.x + .6, y: f ? f.y : p.y, z: p.z}); return; } p.sack.push(kind); sackSet(p); }
function hostAct(id, m) {
  const p = PL.get(id); if (!p || !G.on) return;
  if (m.px != null && p !== P && !m.ob && Math.hypot(m.px - p.x, m.pz - p.z) < 25) { p.x = m.px; p.z = m.pz; }
  const nearBoat = (pt, r) => { const [x, z] = bL2W(pt[0], pt[1]); return Math.hypot(p.x - x, p.z - z) < r; };
  if (m.a === 'pick') { const it = ITEMS[m.i]; if (!it || it.taken || it.kind === 'note' || Math.hypot(p.x - it.x, p.z - it.z) > 3.5) return;
    if (CARRY.has(it.kind)) { if (!sackFits(p, it.kind)) return; it.taken = true; p.sack.push(it.kind); sackSet(p); }
    else if (it.kind === 'bottle') { it.taken = true; const d = DIGS.reduce((b, q, j) => q.rev || q.dug || (b >= 0 && Math.hypot(DIGS[b].x - it.x, DIGS[b].z - it.z) <= Math.hypot(q.x - it.x, q.z - it.z)) ? b : j, -1); if (d >= 0) { DIGS[d].rev = true; emit({k: 'bottle', i: d}); } else { G.bn = ((G.bn ?? -1) + 1) % BOTTLE_NOTES.length; emit({k: 'bottle', i: -1, n: G.bn}); } }
    else { it.taken = true; emit({k: 'give', id, kind: it.kind}); } }
  else if (m.a === 'float') { const f = G.floats[m.i]; if (!f || Math.hypot(p.x - f[0], p.z - f[1]) > (B.up.crane || HC().crane ? 14 : 7) + (p.ob ? BG.hw : 0)) return; const kind = KINDS[f[2]];
    if (kind === 'bottle') { G.floats[m.i] = null; const d = DIGS.reduce((b, q, j) => q.rev || q.dug || (b >= 0 && Math.hypot(DIGS[b].x - f[0], DIGS[b].z - f[1]) <= Math.hypot(q.x - f[0], q.z - f[1])) ? b : j, -1); if (d >= 0) { DIGS[d].rev = true; emit({k: 'bottle', i: d}); } else { G.bn = ((G.bn ?? -1) + 1) % BOTTLE_NOTES.length; emit({k: 'bottle', i: -1, n: G.bn}); } }
    else { if (!sackFits(p, kind)) return; G.floats[m.i] = null; p.sack.push(kind); sackSet(p); save(); } }
  else if (m.a === 'stow') { if (nearBoat(BSPOT.hold, 3.4)) { let n = 0; for (let i = 0; i < p.sack.length; i++) { const k = p.sack[i]; if (k !== 'key' && holdFits(k)) { B.hold.push(k); p.sack.splice(i--, 1); n++; } } if (n) { sackSet(p); emit({k: 'stow', id, v: holdValue()}); save(); } if (p.sack.some(k => k !== 'key')) emit({k: 'holdfull', id}); } }
  else if (m.a === 'unstow') { if (nearBoat(BSPOT.hold, 3.4) && B.hold.length) { const j = B.hold.lastIndexOf('key'), k = j >= 0 ? 'key' : B.hold[B.hold.length - 1]; if (sackFits(p, k)) { if (j >= 0) B.hold.splice(j, 1); else B.hold.pop(); p.sack.push(k); sackSet(p); save(); } } }
  else if (m.a === 'fuel') { const i = p.sack.indexOf('fuel'); if (i >= 0 && nearBoat(BSPOT.fuel, 3)) { B.fuel = Math.min(tankMax(), B.fuel + 45 * HC().fuel); p.sack.splice(i, 1); sackSet(p); emit({k: 'boatuse', what: 'fuel'}); } }
  else if (m.a === 'patch') { const i = p.sack.indexOf('patch'), j = B.hold.indexOf('patch'); if ((i >= 0 || j >= 0) && nearBoat(BSPOT.patch, 3)) { B.hull = Math.min(hullMax(), B.hull + 35 * HC().hp); if (i >= 0) { p.sack.splice(i, 1); sackSet(p); } else B.hold.splice(j, 1); emit({k: 'boatuse', what: 'patch'}); } }
  else if (m.a === 'drop') dropCarry(p, false);
  else if (m.a === 'tug') { const why = !G.shed || Math.hypot(p.x - G.shed.shop[0], p.z - G.shed.shop[2]) >= 25 ? 'Call the tug from the harbour shed.' : tugWhy(); if (!why) { resetBoat(false); emit({k: 'tug'}); } else emit({k: 'nope', id, why}); }
  else if (m.a === 'radio') emit({k: 'radio', on: m.on});
  else if (m.a === 'fw') emit({k: 'fw', x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, c: m.c});
  else if (m.a === 'buya') { const now = performance.now() / 1000; if ((p.buyT || 0) > now) return; p.buyT = now + .4; const A = AURAS[m.i]; if (A && G.cash >= (ALL ? 0 : A.cost)) { G.cash -= ALL ? 0 : A.cost; emit({k: 'gear', id, g: 'aura' + m.i}); save(); } }
  else if (m.a === 'buyc') { const now = performance.now() / 1000; if ((p.buyT || 0) > now) return; p.buyT = now + .4; const L = m.k === 'paint' ? PAINTS : m.k === 'glow' ? GLOWS : null; if (!L || !L[m.v] || (B.up[m.k] || 0) === m.v) return; const own = Array.isArray(B.up[m.k + 's']) ? B.up[m.k + 's'] : (B.up[m.k + 's'] = [0]), c = own.includes(m.v) || ALL ? 0 : STYLE_COST[m.k];
    if (G.cash < c) emit({k: 'nope', id, why: 'Not enough crew cash.'}); else { G.cash -= c; if (!own.includes(m.v)) own.push(m.v); B.up[m.k] = m.v; emit({k: 'bought', n: L[m.v].n}); save(); } }
  else if (m.a === 'dpick') { const q = SUNK[m.i]; if (q && !q.got && p.sw && Math.hypot(q.x - p.x, q.z - p.z) < 5 && Math.abs(q.y + (p.dv || 0)) < 5 && sackFits(p, q.kind)) { q.got = true; p.sack.push(q.kind); sackSet(p); emit({k: 'sunkp', i: m.i}); } }
  else if (m.a === 'drown') { if (!p.dead && p.sw) { p.dead = true; p.deadT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 2}); } }
  else if (m.a === 'sell') { let v = 0; const c = {}, cnt = k => { if (VALUE[k]) c[k] = (c[k] || 0) + 1; }; if (voyPortNear(B.x, B.z, 60 + BG.L * .5)) { v += holdValue(); B.hold.forEach(cnt); B.hold = B.hold.filter(k => !VALUE[k]); } { const sv = sackVal(p.sack); if (sv) { v += sv; p.sack.forEach(cnt); p.sack = p.sack.filter(k => !VALUE[k]); sackSet(p); } }
    if (p.cooler.length) { v += coolerVal(p.cooler); c.fish = p.cooler.length; p.cooler = []; emit({k: 'cooler', id, n: 0, v: 0}); } if (v) { v = Math.round(v * (D.pay || 1)); G.cash += v; G.earned += v; emit({k: 'sold', v, c}); if (G.earned >= 1500) goal(3); save(); } }
  else if (m.a === 'buyh') { const now = performance.now() / 1000; if ((p.buyT || 0) > now) return; p.buyT = now + .4; const H = HULLS[m.k]; if (!H || m.k === (B.up.cls || 0) || (H.cruise && !G.cruise)) return; const own = Array.isArray(B.up.own) ? B.up.own : (B.up.own = [0, B.up.cls || 0]), price = own.includes(m.k) || (H.cruise && G.cruise) ? 0 : hullCost(H);
    if (sackUsed(B.hold) > Math.round(H.hold * [1, 1.5, 2][B.up.hold || 0]) * 2) emit({k: 'holdbig', id}); else if (B.driver) emit({k: 'nope', id, why: 'Someone is at the wheel.'}); else if (Math.hypot(B.x - JETTY.x, B.z - JETTY.z) >= 60 + BG.L * .5) emit({k: 'nope', id, why: 'Bring the boat to the jetty first.'}); else if (G.cash < price) emit({k: 'nope', id, why: 'Not enough crew cash.'});
    else { G.cash -= price; if (!own.includes(m.k)) own.push(m.k); B.up.cls = m.k; buildBoat(); resetBoat(false); B.fuel = tankMax(); B.hull = hullMax(); { let n = 0; for (const q of PL.values()) if (q.ob) { const sp = boatSpawn(n++); q.bl = sp.bl; q.y = sp.y; q.climb = null; q.seat = 0; q.rest = 0; } } emit({k: 'bought', n: H.n, hull: m.k}); save(); } }
  else if (m.a === 'buy') { const now = performance.now() / 1000; if ((p.buyT || 0) > now) return; p.buyT = now + .4; const U = UPG[m.k], poor = c => G.cash < c && (emit({k: 'nope', id, why: 'Not enough crew cash.'}), true);
    if (U) { const lv = B.up[m.k] || 0, c = U.cost[lv]; if (c != null && !poor(c)) { G.cash -= c; B.up[m.k] = lv + 1; if (m.k === 'tank') B.fuel = tankMax(); if (m.k === 'hull') B.hull = hullMax(); emit({k: 'bought', n: U.n}); if (B.up.engine >= 3) goal(4); save(); } }
    else if (m.k === 'flares') { if ((m.fl || 0) >= 6) emit({k: 'nope', id, why: "You can't carry more flares."}); else if (!poor(30)) { G.cash -= 30; emit({k: 'give', id, kind: 'flare', n: Math.min(3, 6 - (m.fl || 0)), buy: 1}); save(); } }
    else if (m.k === 'battery' && !poor(20)) { G.cash -= 20; emit({k: 'give', id, kind: 'battery', buy: 1}); save(); } }
  else if (m.a === 'fl') { spawnFlare(Object.assign({}, m, {id})); if (Net.role === 'host') G.evq.push(Object.assign({}, m, {k: 'fl', id})); }
  else if (m.a === 'wh') { emit({k: 'wh', id}); noise(p.x, p.y, p.z, 45); p.heat += .1; }
  else if (m.a === 'helm') { if (!B.driver || B.driver === id || !PL.get(B.driver)) emit({k: 'helm', id, on: 1}); }
  else if (m.a === 'unhelm') { if (B.driver === id) emit({k: 'helm', id, on: 0}); }
  else if (m.a === 'horn') { const n = performance.now(); if (B.driver === id && n - (G.hornH || 0) > 2500) { G.hornH = n; emit({k: 'horn', c: B.up.cls || 0}); noise(B.x, 1, B.z, 90); } }
  else if (m.a === 'gasp') noise(p.x, p.y, p.z, 9);
  else if (m.a === 'buyg') { const now = performance.now() / 1000; if ((p.buyT || 0) > now) return; p.buyT = now + .4; const g = GEAR[m.k]; if (!g || (m.own && g.need && !g.need(m.own))) return; if (G.cash < g.cost) emit({k: 'nope', id, why: 'Not enough crew cash.'}); else { G.cash -= g.cost; emit({k: 'gear', id, g: m.k}); save(); } }
  else if (m.a === 'fish') { const f = FISH[m.f]; if (!f) return; if (m.f === 'bottle') { const d = DIGS.reduce((b, q, j) => q.rev || q.dug || (b >= 0 && Math.hypot(DIGS[b].x - p.x, DIGS[b].z - p.z) <= Math.hypot(q.x - p.x, q.z - p.z)) ? b : j, -1); if (d >= 0) { DIGS[d].rev = true; emit({k: 'bottle', i: d}); } else { G.bn = ((G.bn ?? -1) + 1) % BOTTLE_NOTES.length; emit({k: 'bottle', i: -1, n: G.bn}); } return; } const v = fishVal(m.f, p.x, p.z), cap = [0, 8, 12, 18][m.rod || 1] || 8; if (p.cooler.length >= cap) { emit({k: 'coolfull', id}); return; }
    p.cooler.push([m.f, v]); emit({k: 'cooler', id, n: p.cooler.length, v: coolerVal(p.cooler)}); emit({k: 'catch', id, f: m.f, kg: m.kg, v}); if (m.f === 'squid') goal(5); save(); }
  else if (m.a === 'hatch' || m.a === 'trunk' || m.a === 'lock') subAct(p, m);
  else if (m.a === 'shoot') hostShoot(p, m);
}
function act(m) { if (isHost()) hostAct(myId(), m); else Net.send(Object.assign({t: 'act', px: +P.x.toFixed(2), pz: +P.z.toFixed(2), ob: P.ob}, m)); }

// ---------------- save (host)
function save() { if (!isHost() || (TEST && !G.saveTest) || G.guestGame) return; try { localStorage.setItem(SK('s9-save2'), JSON.stringify({cash: G.cash, earned: G.earned, up: B.up, disc: G.disc, goals: G.goals, cruise: G.cruise || 0, hold: B.sink > 0 ? [] : B.hold.slice(), dg: DIGS.map(d => (d.rev ? 1 : 0) + (d.dug ? 2 : 0)), bb: G.bbOut ? 1 : 0, sk: P ? P.sack.slice() : [], co: P && P.cooler ? P.cooler.slice() : [], fl: P ? P.flares : 2, stat: G.stat || null, bn: G.bn ?? -1})); } catch (e) {} }
function loadSave() { try { return JSON.parse(localStorage.getItem(SK('s9-save2'))) || null; } catch (e) { return null; } }
addEventListener('pagehide', () => { if (G.on) save(); });

// ---------------- snapshots
function packSnap() {
  const ps = {}; for (const p of PL.values()) ps[p.id] = [p.down ? 1 : 0, Math.ceil(p.bleed), p.dead ? 1 : 0, p.seat ? 1 : 0, (p.sack || []).map(k => KINDS.indexOf(k))];
  const s = {t: 'snap', m: [+M.x.toFixed(2), +M.y.toFixed(2), +M.z.toFixed(2), +M.yaw.toFixed(2), M.state, +M.spd.toFixed(2), +(M.look || 0).toFixed(2)],
    b: [+B.x.toFixed(2), +B.z.toFixed(3), +B.yaw.toFixed(4), +B.v.toFixed(2), +B.thr.toFixed(2), B.driver || '', +B.fuel.toFixed(1), +B.hull.toFixed(1), B.sink > 0 ? 1 : 0, +(B.dep || 0).toFixed(2), +(B.dtar || 0).toFixed(2), +(B.yr || 0).toFixed(3)], rd: G.radioOn ? 1 : 0, up: B.up, sk: SUNK.map(q => q.got ? 1 : 0).join(''), hold: B.hold.map(k => KINDS.indexOf(k)),
    ps, it: ITEMS.map(i => i.taken ? 1 : 0).join(''), fl: G.floats.map(f => f ? [+f[0].toFixed(1), +f[1].toFixed(1), f[2]] : 0), va: VALVES.map(v => v.open ? 1 : 0), pw: G.power ? 1 : 0, bo: G.bbOut ? 1 : 0,
    dg: DIGS.map(d => (d.rev ? 1 : 0) + (d.dug ? 2 : 0)), cash: G.cash, earned: G.earned, disc: G.disc, goals: G.goals, st: +G.storm.toFixed(3), td: +G.tod.toFixed(4), hp: G.holdP, gt: +G.t.toFixed(1), sw: [+STS.x.toFixed(2), +STS.y.toFixed(2), +STS.z.toFixed(2), +STS.yaw.toFixed(2), STS.state, +STS.spd.toFixed(2)], gu: GUL.map(g => g.on ? [+g.x.toFixed(1), +g.y.toFixed(1), +g.z.toFixed(1), +g.yaw.toFixed(2), +g.pitch.toFixed(2), g.st] : 0), cz: G.cruise ? 1 : 0, ev: G.evq};
  s.al = ALL ? 1 : 0; if (HC().sub) s.sb = [B.hat ? 1 : 0, LK.st, +LK.w.toFixed(2), +LK.t.toFixed(2)];
  G.evq = []; return s;
}
function applySnap(s) {
  for (const e of s.ev || []) applyEv(e);
  const [x, y, z, yaw, st, spd, look] = s.m; M.tx = x; M.ty = y; M.tz = z; M.tyaw = yaw; M.state = st; M.spd = spd; M.look = look;
  B.tx = s.b[0]; B.tz = s.b[1]; B.tyaw = s.b[2]; B.v = s.b[3]; B.thr = s.b[4]; B.driver = s.b[5] || null; B.fuel = s.b[6]; B.hull = s.b[7]; B.sink = s.b[8] ? 1 : 0; B.dep = s.b[9] || 0; B.dtar = s.b[10] ?? B.dep; G.radioOn = !!s.rd; if (s.sk) SUNK.forEach((q, i) => q.got = s.sk[i] === '1'); if (!B.got) { B.got = 1; B.x = B.tx; B.z = B.tz; B.yaw = B.tyaw; }
  if (Math.hypot(B.tx - B.x, B.tz - B.z) > 40) { B.x = B.tx; B.z = B.tz; B.yaw = B.tyaw; } if (M.x != null && Math.hypot(M.tx - M.x, M.tz - M.z) + Math.abs(M.ty - M.y) > 15) { M.x = M.tx; M.y = M.ty; M.z = M.tz; M.yaw = M.tyaw; } G.hostAll = !!s.al;
  B.up = s.up; B.hold = s.hold.map(i => KINDS[i]);
  if (s.b[11] != null) B.yr = s.b[11]; if (s.sb) { B.hat = s.sb[0]; LK.st = s.sb[1]; LK.tw = s.sb[2]; LK.t = s.sb[3]; }
  for (const id in s.ps) { const p = PL.get(id); if (!p) continue; const [d, bl, de, , ca] = s.ps[id]; p.down = !!d; p.bleed = bl; p.dead = !!de; if (Array.isArray(ca)) { p.sack = ca.map(i => KINDS[i]); p.carry = p.sack[p.sack.length - 1] || null; if (p === P) P.sack = p.sack; } }
  for (let i = 0; i < ITEMS.length; i++) ITEMS[i].taken = s.it[i] === '1';
  G.floats = s.fl.map(f => f || null);
  s.va.forEach((v, i) => VALVES[i].open = !!v); if (s.pw && !G.power) applyEv({k: 'power', quiet: G.pwQuiet}); G.pwQuiet = 0; G.bbOut = !!s.bo;
  s.dg.forEach((v, i) => { DIGS[i].rev = !!(v & 1); DIGS[i].dug = !!(v & 2); });
  G.cash = s.cash; G.earned = s.earned; G.disc = s.disc; G.goals = s.goals; G.storm = s.st; if (s.td != null && (G.tod == null || Math.abs(s.td - G.tod) > .002)) G.tod = s.td;
  G.holdP = s.hp || {}; G.t = s.gt; G.cruise = s.cz || 0;
  if (s.sw) { const [x, y, z, yaw, st, spd] = s.sw; Object.assign(STS, {tx: x, ty: y, tz: z, tyaw: yaw, state: st, spd}); if (STS.x == null || Math.hypot(STS.x - x, STS.z - z) > 20) Object.assign(STS, {x, y, z, yaw}); }
  if (s.gu) s.gu.forEach((q, i) => { const g = GUL[i] || (GUL[i] = {}); if (!q) { g.on = 0; return; } const was = g.on; Object.assign(g, {on: 1, tx: q[0], ty: q[1], tz: q[2], tyaw: q[3], tpitch: q[4], st: q[5]}); if (!was) Object.assign(g, {x: q[0], y: q[1], z: q[2], yaw: q[3], pitch: q[4]}); }); for (let i = (s.gu || []).length; i < GUL.length; i++) GUL[i].on = 0;
}
Net.on('snap', m => { if (G.on && !isHost()) { G.lastSnapT = performance.now(); applySnap(m); } });
Net.on('pose', (m, from) => {
  if (!G.on) return; const id = isHost() ? from : m.from; if (!id || id === myId()) return; const p = PL.get(id); if (!p) return;
  p.x = m.x; p.z = m.z; p.y = m.y; p.yaw = m.yw; p.pitch = m.pt; p.cr = m.cr; p.l = m.l; p.run = m.rn; p.h = m.h || ''; p.hd = m.hd; p.hb = m.hb; p.ob = m.ob; p.bl = m.bl || p.bl; p.sw = m.sw; p.deep = m.dp; p.in = m.in || [0, 0]; p.eq = m.eq || 0; p.sc = m.sc || 0; p.dv = m.dv || 0; p.su = m.su || 0; p.au = m.au || 0; p.poseT = performance.now();
  if (!p.ready) { p.ready = true; p.rx = p.x; p.ry = p.y; p.rz = p.z; p.lx = p.x; p.lz = p.z; }
  p.stepD = (p.stepD || 0) + Math.hypot(m.x - (p.px ?? m.x), m.z - (p.pz ?? m.z)); p.px = m.x; p.pz = m.z;
});
Net.on('act', (m, from) => { if (isHost() && G.on) hostAct(from, m); });

// ---------------- flares
function spawnFlare(e) {
  const m = new THREE.Group(); m.add(itemMesh('flare'));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff3018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); glow.scale.set(1.4, 1.4, 1); m.add(glow);
  scene.add(m); const f = {m, glow, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, t: 32, rest: false, sea: false, born: G.t}; G.flares.push(f);
  Snd.flare(at(e.x, e.y, e.z, 4)); if (G.flares.length > 3) { const o = G.flares.shift(); scene.remove(o.m); }
}
function lightOn() { return !!(P && P.l && (P.eq === 1 || P.eq === 3 || P.eq === 4 || (P.sw && P.own && P.own.suit && P.dv > .5))); }
function throwFlare() {
  if (P.flares <= 0 || P.hd >= 0 || P.down || !alivePlay()) return; if (subInside()) { showMsg('Not in here.', '', 1.2); return; }
  if (P.eq === 5) P.burn = 0; P.flares--; if (P.flares <= 0 && P.eq === 5) P.eq = 0;
  const f = eyeDir(P); let e;
  // from the wheel: over the rail on the side you are looking at, so it lands in the sea beside the hull
  if (P.seat) { const sd = bW2L(B.x + f[0], B.z + f[2])[0] >= 0 ? 1 : -1, [ox, oz] = bL2W(sd * (BG.hw + .8), P.bl[1]), ux = sd * Math.cos(B.yaw), uz = -sd * Math.sin(B.yaw);
    e = {a: 'fl', x: ox, y: BDECK.y + B.heave + 1, z: oz, vx: ux * 7 - Math.sin(B.yaw) * B.v, vy: 3, vz: uz * 7 - Math.cos(B.yaw) * B.v}; }
  else e = {a: 'fl', x: P.x + f[0] * .4, y: P.y + P.eye - .2, z: P.z + f[2] * .4, vx: f[0] * 10 + P.vx, vy: f[1] * 10 + 3, vz: f[2] * 10 + P.vz};
  spawnFlare(e); if (isHost()) { if (Net.role === 'host') G.evq.push(Object.assign({}, e, {k: 'fl', id: myId()})); } else Net.send(Object.assign({t: 'act'}, e));
}
function stepFlares(dt) {
  // a held flare burns for 30 s, then the next one is struck
  if (alivePlay() && P.eq === 5 && P.flares > 0 && P.hd < 0 && !P.seat) { if (!(P.burn > 0)) P.burn = 30; P.burn -= dt; if (P.burn <= 0) { P.flares--; P.burn = 0; Snd.flare(null); if (P.flares <= 0) { P.eq = 0; showMsg('The flare sputters out.', '', 2); } } }
  for (let i = 0; i < G.flares.length; i++) {
    const f = G.flares[i];
    if (!f.rest) { f.vy -= 9.8 * dt; f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt; const fl = floorAt(f.x, f.z, f.y + .3); const gy = fl && fl.y > -.1 ? fl.y + .03 : -.1;
      if (f.y < gy) { f.y = gy; f.vy *= -.25; f.vx *= .5; f.vz *= .5; if (Math.hypot(f.vx, f.vz) < .5) { f.rest = true; f.sea = !(fl && fl.y > -.1); f.surf = fl && fl.s.k === 'boat' ? bW2L(f.x, f.z) : null; noise(f.x, f.y, f.z, 10); } } }
    else if (f.surf) { if (BG.sub && (B.dep || 0) > .3) { f.surf = null; f.rest = false; f.vy = 0; } else { const [wx, wz] = bL2W(f.surf[0], f.surf[1]); f.x = wx; f.z = wz; } }
    f.t -= f.sea ? dt * 2 : dt; f.m.position.set(f.x, f.y + (f.sea ? waveH(f.x, f.z, G.wt) + .1 : 0), f.z); f.m.rotation.set(0, 0, f.rest ? 0 : G.t * 9);
    const on = f.t > 0, k = .8 + Math.random() * .4; if (FLL[i]) FLL[i].intensity = on ? 16 * k * Math.min(1, f.t / 3) : 0; FLL[i] && FLL[i].position.set(f.x, f.m.position.y + .35, f.z); f.glow.material.opacity = on ? .8 * k : 0;
  }
  for (let i = G.flares.length; i < FLL.length; i++) FLL[i].intensity = 0;
}

// ---------------- local player
const K = {}; let mouseR = false, eDown = false, ePress = false;
const alivePlay = () => P && !P.dead;
// walk straight off the boat onto a dock, jetty, wreck or beach alongside it, and back
function gangway(dt) {
  P.gwT = Math.max(0, (P.gwT || 0) - dt); if (P.gwT > 0 || P.sw || P.seat || P.down || P.hd >= 0 || B.sink > 0 || (B.dep || 0) > .3) return;
  if (BG.sub && P.ob && P.y < BDECK.y - .5) return; const sp = Math.hypot(P.vx, P.vz); if (sp < .8) return; const ux = P.vx / sp, uz = P.vz / sp;
  if (P.ob) { const [lx, lz] = bW2L(P.x, P.z), c = Math.cos(B.yaw), s = Math.sin(B.yaw), lvx = ux * c - uz * s, lvz = ux * s + uz * c;
    const nearSide = Math.abs(lx) > BDECK.x1 - .55 && lvx * Math.sign(lx) > .5, nearEnd = (lz > BDECK.z1 - .6 && lvz > .5) || (lz < BDECK.z0 + .6 && lvz < -.5); if (!nearSide && !nearEnd) return;
    for (const dd of [1.2, 2, 2.8]) { const wx = P.x + ux * dd, wz = P.z + uz * dd, f = floorAt(wx, wz, BDECK.y + 1.4, true); if (f && f.y > -.4 && Math.abs(f.y - BDECK.y) < 2.4 && f.s.k !== 'boat') { P.ob = 0; P.x = wx; P.z = wz; P.y = f.y; P.vy = 0; P.gwT = .7; Snd.step('wood', 1); return; } } }
  else if (Math.hypot(B.x - P.x, B.z - P.z) < BG.L * .6 + 4 && Math.abs(P.y - BDECK.y) < 2.4) for (const dd of BG.sub ? [1.3, 2.1] : [1.3]) { const [lx, lz] = bW2L(P.x + ux * dd, P.z + uz * dd);
    if (lx > BDECK.x0 - .2 && lx < BDECK.x1 + .2 && lz > BDECK.z0 - .2 && lz < BDECK.z1 + .2) { const bl = [clamp(lx, BDECK.x0 + .45, BDECK.x1 - .45), clamp(lz, BDECK.z0 + .45, BDECK.z1 - .45)], [wx, wz] = bL2W(bl[0], bl[1]); P.ob = 1; P.bl = bl; P.x = wx; P.z = wz; P.y = BDECK.y; P.vy = 0; P.gwT = .7; P.lastBY = B.yaw; Snd.step('wood', 1); return; } }
}
function stepPlayer(dt) {
  if (!alivePlay()) return;
  const bdy = B.yaw - (P.lastBY ?? B.yaw); P.lastBY = B.yaw;
  if (P.ob) { P.yaw += bdy; const [wx, wz] = bL2W(P.bl[0], P.bl[1]); P.x = wx; P.z = wz; }
  if (P.lkOut > 0 && (P.lkOut -= dt) <= 0) lockDropOut();
  if (BG.sub && P.ob && !P.seat && !P.climb && P.y > BDECK.y - .6 && (B.dep || 0) > 1.1) washOff();
  if (P.climb) { climbStep(dt); return; }
  if (P.rest && subRest(dt)) return;
  if (P.scope && subScopeStep(dt)) return;
  if (P.seat) {
    P.bl = [BHELM[0], BHELM[1]]; const [wx, wz] = bL2W(BHELM[0], BHELM[1]); P.x = wx; P.z = wz; P.y = BHELM[2] ?? BDECK.y; P.ob = 1;
    const d = angD(B.yaw, P.yaw); P.yaw = B.yaw + clamp(d, -1.3, 1.3);
    P.in = [(K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0)];
    P.in.push((K.KeyC ? 1 : 0) - (K.Space ? 1 : 0)); P.vx = P.vz = 0; P.eye = mix(P.eye, HC().eye || ((B.up.cls || 0) === 3 ? 8.9 : BG.sub ? 1.15 : 1.62), dt * 4); return;
  }
  P.in = [0, 0];
  if (P.hd >= 0) {
    const h = HIDES[P.hd]; P.x = h.x; P.z = h.z; P.y = h.y; P.vx = P.vz = 0;
    const want = (mouseR || K.Space) && P.gasp <= 0;
    if (want && P.breath > 0) { P.hb = 1; P.breath -= dt / 10; if (P.breath <= 0) { P.breath = 0; P.hb = 0; P.gasp = 2.2; Snd.gasp(); act({a: 'gasp'}); } } else { P.hb = 0; P.breath = Math.min(1, P.breath + dt / 6); }
    P.gasp -= dt; $('breath').querySelector('i').style.width = P.breath * 100 + '%'; return;
  }
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mag = Math.hypot(fw, st) || 1;
  const wade = !P.sw && !P.ob && P.y < -.05;
  let run = (K.ShiftLeft || K.ShiftRight) && fw > 0 && P.stam > .02 && !P.cr && !P.down && !P.sw && !wade && sackUsed(P.sack) < 7;
  if (P.tired && P.stam < .3) run = false; if (P.stam > .3) P.tired = false;
  let sp = P.sw ? ((P.own && P.own.suit) ? 2.6 : 1.6) * (P.dv > 1 && (P.own && P.own.suit) ? Math.cos(P.pitch) : 1) : P.down ? .55 : P.cr ? 1.6 : run ? 5.8 : 3.0; if (wade) sp *= .6; sp *= 1 - .3 * sackUsed(P.sack) / 10;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tvx = (-sy * fw + cy * st) / mag * sp, tvz = (-cy * fw - sy * st) / mag * sp, acc = (fw || st) ? 9 : 12;
  P.vx = mix(P.vx, fw || st ? tvx : 0, Math.min(1, dt * acc)); P.vz = mix(P.vz, fw || st ? tvz : 0, Math.min(1, dt * acc));
  const ox = P.x, oz = P.z; P.x += P.vx * dt; P.z += P.vz * dt;
  pushBody(P, .33, P.y);
  const inner = BG.sub && P.ob && (P.y < BDECK.y - 1 || Math.hypot(P.bl[0] - SUB.TR.x, P.bl[1] - SUB.TR.z) < SUB.TR.r + .2), f = floorAt(P.x, P.z, P.sw ? 0 : P.y, false, inner);
  const stand = f && (f.y > -1.3 || f.s.k === 'boat');
  if (P.sw) { if (stand) { P.sw = 0; P.y = f.y; P.dv = 0; } else { P.y = 0; P.deep = !f || f.y < -3 ? 1 : 0; } }
  if (P.sw && P.cr) P.cr = 0;
  const surf = () => P.sw || wade ? 'wet' : !f ? 'wood' : f.s.k === 'boat' ? ((B.up.cls || 0) >= 2 ? 'steel' : 'wood') : f.s.k === 'disc' ? 'stone' : inCruise(P.x, P.z, P.y) ? ((BLD[zoneOf(P.x, P.z, P.y)] || {}).kind === 'state' ? 'carpet' : 'steel') : (f.s.k === 'slab' || f.s.k === 'ramp') && nearRig(P.x, P.z) ? 'metal' : f.s.k === 'land' ? 'sand' : 'wood';
  const landed = iv => { G.land = Math.min(1, (iv - 3.5) / 9); Snd.land(G.land, surf()); G.lspV = (G.lspV || 0) + 8.8 * G.land;
    if (iv > 13) { tone(180, .1, .3, 'sawtooth', null, 110); burst(520, .8, .1, .3, 'bandpass', null, .7); $('flash').style.opacity = .25; setTimeout(() => $('flash').style.opacity = 0, 200); P.stam = Math.max(0, P.stam - .4); } };
  const su = (P.own && P.own.suit) || 0, SU = SUIT[su]; let vy = 0;
  if (P.sw && !P.down) { if (K.KeyC) vy += 1; if (K.Space) vy -= 1; if (!su && (P.air ?? 1) <= 0) vy = -1; if (su && fw) vy += -Math.sin(P.pitch) * fw; }
  const lim = Math.max(0, Math.min(SU.max, -seaBed(P.x, P.z) - 1.2)); P.dv = P.sw ? clamp((P.dv || 0) + (vy ? vy * (su ? 2.4 : 1.4) : su ? 0 : -2.2) * dt, 0, lim) : 0;
  if (P.sw && P.dv >= SU.max - .5 && vy > 0 && !G.pressT) { G.pressT = 1; showMsg(su ? `Too deep for the ${SU.n}. The pressure crushes in on your chest.` : 'You need diving gear to go deeper. The harbour shed sells it.', '', 3); } if (P.dv < SU.max - 3) G.pressT = 0;
  P.air = clamp((P.air ?? 1) + (P.dv > .4 ? -dt / SU.air : dt / 4), 0, 1);
  if (P.air <= 0 && P.dv > .3) { if (su) { if (!P.drownSent) { P.drownSent = 1; act({a: 'drown'}); } } else if (!P.gaspT) { P.gaspT = 1; Snd.gasp(); } } if (P.dv < .1) { P.gaspT = 0; P.drownSent = 0; }
  if (P.dv > .4 && Math.random() < dt * .6) Snd.bubbles();
  if (!P.sw) {
    P.deep = 0;
    if (stand && P.y - f.y < .6) { const iv = -(P.vy || 0); P.y = mix(P.y, f.y, Math.min(1, dt * 14)); P.vy = 0; if (iv > 3.5) landed(iv); }
    else { P.vy = (P.vy || 0) - 20 * dt; P.y += P.vy * dt; if (stand && P.y < f.y) { const iv = -P.vy; P.y = f.y; P.vy = 0; if (iv > 3.5) landed(iv); } if (!stand && P.y < .1) { P.sw = 1; P.cr = 0; P.y = 0; P.vy = 0; P.ob = 0; Snd.splash(); showMsg('You are in the water! Swim to land or a ladder (E). Do not stay out in deep water.', '', 3); } }
  }
  if (!P.sw && f && f.s.k === 'boat' && Math.abs(P.y - f.y) < .3) { P.ob = 1; P.bl = bW2L(P.x, P.z); } else P.ob = 0;
  gangway(dt);
  const moved = Math.hypot(P.x - ox, P.z - oz), v = moved / Math.max(dt, 1e-4); P.run = run && v > 1 ? 1 : 0;
  if (P.run) { P.stam -= dt / 7; if (P.stam <= 0) { P.stam = 0; P.tired = true; } } else P.stam = Math.min(1, P.stam + dt / (v > .5 ? 11 : 7));
  P.eye = mix(P.eye, P.sw ? .25 : P.down ? .45 : P.cr ? 1.0 : 1.62, Math.min(1, dt * 8));
  P.bob += moved / (run ? 1 : P.cr ? .55 : .75) * PI; const bn = Math.floor(P.bob / PI);
  if (bn > (P.bobN ?? bn) && (P.sw || (stand && P.y - f.y < .3))) { const k = run ? 1.4 : P.cr ? .35 : .8; Snd.step(surf(), k); if (isHost() && !P.ob) { noise(P.x, P.y, P.z, run ? 22 : P.cr ? 2 : 8); if (run) P.heat += .02; } } P.bobN = bn;
  if (P.l) { P.bat -= dt / 360; if (P.bat <= 0) { P.bat = 0; P.l = 0; showMsg('Your flashlight died. Buy batteries at the harbour shed.', '', 3); } }
  const so = P.stam < .35, sw = Math.round(P.stam * 100) + '%'; if (so !== G.stamOn) { G.stamOn = so; $('stam').style.opacity = so ? 1 : 0; } if (sw !== G.stamW) { G.stamW = sw; $('stam').firstChild.style.width = sw; }
}
function interWorld(it) { if (!it.boat) return it; const [x, z] = bL2W(it.lx, it.lz); return {x, y: it.by != null ? it.by : BDECK.y + it.ly, z}; }
function targets() {
  const L = [], far = (x, z, r = 30) => (x - P.x) * (x - P.x) + (z - P.z) * (z - P.z) > r * r, full = `Sack full (${sackUsed(P.sack)}/${sackCap(P)})`;
  for (const it of ITEMS) { if (it.taken || far(it.x, it.z)) continue; const nf = CARRY.has(it.kind) && !sackFits(P, it.kind); L.push({x: it.x, y: it.y + .2, z: it.z, r: 2.4, info: nf ? 1 : 0, label: it.kind === 'note' ? 'Read the note' : nf ? `Sack full (${sackUsed(P.sack)}/${sackCap(P)}, X drops the last thing)` : `Pick up the ${NAMES[it.kind]}` + (VALUE[it.kind] ? ` ($${VALUE[it.kind]})` : ''), go: () => it.kind === 'note' ? openNote(it.text) : act({a: 'pick', i: it.i})}); }
  G.floats.forEach((f, i) => { if (!f || subInside()) return; const r = ((B.up.crane || HC().crane) && P.ob ? 12 : 5.5) + (P.ob ? BG.hw * .6 : 0); if (far(f[0], f[1], r + 2)) return; const kind = KINDS[f[2]], nf = kind !== 'bottle' && !sackFits(P, kind); L.push({x: f[0], y: (P.ob ? BDECK.y : 0) + .2, z: f[1], r, flat: 1, info: nf ? 1 : 0, label: nf ? full : (P.ob ? 'Haul the ' : 'Grab the ') + NAMES[kind] + (P.ob ? ' aboard' : '') + (VALUE[kind] ? ` ($${VALUE[kind]})` : ''), go: () => act({a: 'float', i})}); });
  VALVES.forEach((v, i) => { if (!v.open) L.push({x: v.x, y: v.y + 1.1, z: v.z, r: 2.6, hold: 'v' + i, label: 'Hold E to open the ' + v.name}); });
  const gb = BLD.find(q => q.kind === 'gen'), cb = BLD.find(q => q.kind === 'ctrl'), vo = VALVES.every(v => v.open);
  if (gb) L.push({x: gb.genP[0], y: gb.genP[1], z: gb.genP[2], r: 3, hold: !G.power && vo ? 'g' : '', info: G.power || !vo ? 1 : 0, label: G.power ? 'The generator is running' : vo ? 'Hold E to start the generator' : 'Generator. No fuel: two valves are shut.'});
  if (CRZ.bridge && CRZ.bridge.console) { const c = CRZ.bridge.console, key = P.sack.includes('key'); L.push({x: c[0], y: c[1], z: c[2], r: 2.8, hold: !G.cruise && key ? 'cz' : '', info: G.cruise || !key ? 1 : 0, label: G.cruise ? 'The Serenade is yours. Switch to her at the harbour shed.' : key ? 'Hold E to start the engines (it will hear)' : "Engine start. Needs the captain's key card."}); }
  if (P.sw && (P.dv || 0) >= 1) for (let i = 0; i < SUNK.length; i++) { const q = SUNK[i]; if (q.got || far(q.x, q.z, 4)) continue; const nf = !sackFits(P, q.kind); L.push({x: q.x, y: q.y + .4, z: q.z, r: 4.5, dive: 1, info: nf ? 1 : 0, label: nf ? full : `Grab the sunken ${NAMES[q.kind]} ($${VALUE[q.kind] || 0})`, go: nf ? null : () => act({a: 'dpick', i})}); }
  if (cb) L.push({x: cb.console[0], y: cb.console[1], z: cb.console[2], r: 2.8, hold: G.power && !G.bbOut ? 'c' : '', info: !G.power || G.bbOut ? 1 : 0, label: !G.power ? 'Control console. No power.' : G.bbOut ? 'Static on every channel' : 'Hold E to eject the flight recorder'});
  DIGS.forEach((d, i) => { if (!d.dug && !far(d.x, d.z)) L.push({x: d.x, y: d.y + .3, z: d.z, r: 2.6, hold: 'd' + i, label: d.rev ? 'Hold E to dig where the X is' : 'Hold E to dig under the cairn'}); });
  if (G.shed) L.push({x: G.shed.shop[0], y: G.shed.shop[1], z: G.shed.shop[2], r: 3, label: 'Harbour shed: sell salvage, buy upgrades', go: openShop});
  for (const p of PL.values()) if (p !== P && p.down && !p.dead && p.ready) L.push({x: p.x, y: p.y + .3, z: p.z, r: 2.4, hold: 'r' + p.id, label: `Hold E to pick up ${p.name}`});
  for (const it of INTER) { if ((!it.boat && far(it.x, it.z)) || (it.on && !it.on())) continue; const w = interWorld(it); L.push(Object.assign({}, it, {x: w.x, y: it.boat ? w.y + (it.dive ? B.heave : 0) : it.y, z: w.z, label: it.label(), hide: it.h, src: it})); }
  return L;
}
function stepInteract(dt) {
  const pr = $('prompt'); P.h = '';
  if (TEST && G.forceH) { P.h = G.forceH; return; }
  const off = () => { if (G.prOp !== 0) { G.prOp = 0; pr.style.opacity = 0; } ePress = false; };
  if (!alivePlay() || P.down || P.climb || P.scope || anyPanel()) { off(); return; }
  const ey = P.y + P.eye; cam.getWorldDirection(_fw); let best = null, bs = 1e9;
  for (const it of targets()) {
    if (P.hd >= 0) { if (it.hide && it.hide.i === P.hd) { best = it; break; } continue; }
    if (P.seat) { if (it.kind === 'helm') { best = it; break; } continue; }
    if (P.sw && it.kind !== 'ladder' && !it.flat && !it.dive) continue;
    if (it.kind === 'ladder' && (P.dv || 0) > .35) continue;
    const dx = it.x - P.x, dy = (it.kind === 'ladder' || it.flat ? 0 : it.dive ? it.y - cam.position.y : it.y - ey), dz = it.z - P.z, d = Math.hypot(dx, dy, dz); if (d > it.r) continue;
    if (it.kind !== 'ladder') { const hd = Math.hypot(dx, dz) || 1, dot = it.flat ? (dx * _fw.x + dz * _fw.z) / hd / Math.max(.2, Math.hypot(_fw.x, _fw.z)) : (dx * _fw.x + dy * _fw.y + dz * _fw.z) / d, lim = d < 1.2 ? .4 : it.flat ? .6 : .84; if (dot < lim) continue; }
    if (d < bs) { bs = d; best = it; }
  }
  if (!best) { off(); return; }
  const st = P.sack.some(k => k !== 'key'), doable = best.hold || (best.go && !best.info) || best.hide || best.kind === 'helm' || best.kind === 'ladder' || (best.kind === 'hold' && (st || B.hold.length)) || (best.kind === 'fuelcap' && P.sack.includes('fuel')) || (best.kind === 'patchbox' && (P.sack.includes('patch') || B.hold.includes('patch')));
  let html, op = 1; const lab = best.label;
  if (P.seat && best.kind === 'helm') {
    if (G.helmSeen == null) { try { G.helmSeen = localStorage.getItem('s9-helm') ? 1 : 0; } catch (e) { G.helmSeen = 0; } }
    const t = G.seatT || 0; if (t > 20 && !G.helmSeen) { G.helmSeen = 1; try { localStorage.setItem('s9-helm', '1'); } catch (e) {} }
    html = '<kbd>W</kbd><kbd>S</kbd> throttle · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Q</kbd> horn · <kbd>E</kbd> let go' + (HC().sub ? ' · <kbd>C</kbd><kbd>Space</kbd> dive' : ''); op = t < (G.helmSeen ? 2 : 6) ? 1 : 0;
  } else html = best.hold ? 'Hold <kbd>E</kbd> ' + (lab.startsWith('Hold E to ') ? lab[10].toUpperCase() + lab.slice(11) : lab) : doable ? `<kbd>E</kbd> ${lab}` : `<span class="info">${lab}</span>`;
  if (html !== G.pTxtK) { G.pTxtK = html; $('pTxt').innerHTML = html; } if (op !== G.prOp) { G.prOp = op; pr.style.opacity = op; }
  const bd = best.hold ? 'block' : 'none'; if (bd !== G.pBarD) { G.pBarD = bd; $('pBar').style.display = bd; } if (best.hold) $('pBar').firstChild.style.width = (G.holdP[best.hold] || 0) * 100 + '%';
  if (best.hold && eDown) { P.h = best.hold; if (best.hold[0] === 'v' && Math.random() < dt * 2) Snd.valve(); if (best.hold[0] === 'd' && Math.random() < dt * 3) Snd.dig(); }
  else if (ePress && doable) {
    if (best.hide) toggleHide(best.hide);
    else if (best.kind === 'helm') act({a: P.seat ? 'unhelm' : 'helm'});
    else if (best.kind === 'ladder') startClimb(best.src);
    else if (best.kind === 'hold') { if (st) act({a: 'stow'}); else if (B.hold.length) act({a: 'unstow'}); }
    else if (best.kind === 'fuelcap') act({a: 'fuel'});
    else if (best.kind === 'patchbox') act({a: 'patch'});
    else if (best.go) best.go();
  }
  ePress = false;
}
function toggleHide(h) {
  if (P.hd >= 0) { P.hd = -1; P.x = h.ex; P.z = h.ez; P.l = P.lightWas && P.bat > 0 ? 1 : 0; $('slats').classList.add('hidden'); $('breath').classList.add('hidden'); Snd.creak(); }
  else { P.hd = h.i; P.lightWas = P.l; P.l = 0; P.yaw = h.yaw; P.pitch = 0; P.cr = 0; $('slats').classList.remove('hidden'); $('breath').classList.remove('hidden'); Snd.creak(); if (isHost() && M.state === 'chase' && M.tgt === P.id && G.t - M.seenAt < 1.2) M.sawHide = h.i; if (isHost() && STS.state === 'chase' && STS.tgt === P.id && G.t - (STS.seenAt ?? -9) < 1.2) STS.sawHide = h.i; }
}
function openNote(t) { G.noteOpen = true; clearKeys(); $('noteT').textContent = t; $('note').classList.remove('hidden'); }
function closeNote() { G.noteOpen = false; $('note').classList.add('hidden'); if (G.on) lockMouse(); }
function openShop() { G.shopOpen = true; G.shopSig = ''; clearKeys(); $('shop').classList.remove('hidden'); try { document.exitPointerLock(); } catch (e) {} drawShop(); }
function closeShop() { G.shopOpen = false; $('shop').classList.add('hidden'); lockMouse(); }
function drawShop() {
  if (!G.shopOpen) return;
  const docked = Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 60 + BG.L * .5 || (typeof voyPortNear === 'function' && !!voyPortNear(B.x, B.z, 60 + BG.L * .5)), pay = D.pay || 1, free = freeAll(), cls = B.up.cls || 0, own = Array.isArray(B.up.own) ? B.up.own : [0, cls], hm = [1, 1.5, 2][B.up.hold || 0];
  if (!G.shopTab) { try { G.shopTab = localStorage.getItem('s9-shoptab'); } catch (e) {} if (!['jobs', 'supplies', 'boats', 'upgrades', 'gear', 'style'].includes(G.shopTab)) G.shopTab = 'supplies'; }
  const tab = G.shopTab, why = (w, c) => w || (c > 0 && G.cash < c ? `${money(c - G.cash)} short` : '');
  const bt = (at, label, c, w0) => { const w = why(w0, c); return `<span class="bt"><button ${at}${w ? ' disabled' : ' class="can"'}>${label}</button>${w ? `<small class="why">${w}</small>` : ''}</span>`; };
  const row = (n, d, b, k = '') => `<div class="up${k}"><div>${n}<small>${d}</small></div>${b}</div>`;
  // the sell bar: what goes, after the difficulty's pay
  const cn = {}, cnt = k => { if (VALUE[k]) cn[k] = (cn[k] || 0) + 1; }; if (docked) B.hold.forEach(cnt); P.sack.forEach(cnt);
  const v = Math.round(((docked ? holdValue() : 0) + sackVal(P.sack) + (P.coolerV || 0)) * pay), SN = {fuel: 'fuel drum', blackbox: 'black box', gold: 'gold bar'};
  const parts = Object.entries(cn).map(([k, n]) => { const w = SN[k] || k; return `${n} ${n > 1 && k !== 'scrap' ? w + (/x$/.test(w) ? 'es' : 's') : w}`; }); if (P.coolerN) parts.push(`${P.coolerN} fish`);
  $('bSell').textContent = v ? `Sell ${parts.slice(0, 4).join(' · ')}${parts.length > 4 ? ' · …' : ''} → ${money(v)}` : 'Nothing to sell'; $('bSell').disabled = !v;
  // header: crew cash and the next thing worth saving for
  const nx = [];
  if (!free) { for (const k in UPG) { const q = UPG[k].cost[B.up[k] || 0]; if (q != null) nx.push([UPG[k].n, q]); } for (const k in GEAR) if (!['ammo', 'shells', 'fw'].includes(k) && GEAR[k].need(P.own)) nx.push([GEAR[k].n, GEAR[k].cost]); HULLS.forEach((H, i) => { if (!own.includes(i) && !H.cruise && H.cost) nx.push([H.n, H.cost]); }); nx.sort((a, b) => a[1] - b[1]); }
  $('shopCash').innerHTML = `Crew cash ${money(G.cash)} · earned ${money(G.earned)}${pay > 1 ? ` · ×${pay} nightmare pay` : pay < 1 ? ` · ×${pay} easy pay` : ''}${!docked && B.hold.some(k => VALUE[k]) ? ' · dock to sell the hold' : ''}`
    + (nx.length ? `<span class="nx">Next: ${nx[0][0]} ${money(nx[0][1])}<i><b style="width:${Math.min(100, G.cash / nx[0][1] * 100).toFixed(1)}%"></b></i></span>` : '');
  document.querySelectorAll('#shopTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { G.shopTab = b.dataset.tab; try { localStorage.setItem('s9-shoptab', G.shopTab); } catch (e) {} drawShop(); }; });
  const rows = [];
  if (tab === 'supplies') {
    if (canTug()) rows.push(row('Call the tug', 'Tows your boat back to the jetty', bt('data-tug="1"', 'Free', 0)));
    rows.push(row(P.flares >= 6 ? 'Flares' : `Flares +${Math.min(3, 6 - P.flares)}`, `Red light keeps things away · carrying ${P.flares}`, bt('data-k="flares"', money(30), 30, P.flares >= 6 ? 'Full' : '')));
    rows.push(row('Batteries', 'Recharge your flashlight', bt('data-k="battery"', money(20), 20)));
  } else if (tab === 'jobs') { rows.push(jobRows(row, bt));
  } else if (tab === 'boats') {
    const next2 = HULLS.map((H, i) => i).filter(i => !own.includes(i) && !HULLS[i].cruise).sort((a, b) => HULLS[a].cost - HULLS[b].cost).slice(0, 2);
    const block = H => sackUsed(B.hold) > Math.round(H.hold * hm) * 2 ? 'Unload the hold first' : B.driver ? 'Someone is at the wheel' : !docked ? 'Dock at the jetty' : ''; let hid = 0;
    HULLS.forEach((H, i) => { const sz = `${H.L} m · hold ${H.hold}`, sd = H.d.includes(`${H.L} m`) ? `hold ${H.hold}` : sz, c = hullCost(H), mine = own.includes(i) || (H.cruise && G.cruise);
      if (i === cls) rows.push(row(H.n, `${H.d} · ${sd}`, '<span class="bt"><button disabled>Aboard</button></span>', ' cur'));
      else if (H.cruise ? !G.cruise : !mine && !next2.includes(i) && !G.shopAll && G.cash < c * .5) { if (!H.cruise) hid++; rows.push(row('???', sz, bt('', H.cruise ? '???' : money(c), c, H.cruise ? 'Unclaimed' : ''), ' q')); }
      else rows.push(row(H.n, `${H.d} · ${sd}`, bt(`data-h="${i}"`, mine ? 'Switch' : c ? money(c) : 'Free', mine ? 0 : c, block(H)))); });
    if (hid || G.shopAll) rows.push(`<div class="rowb" style="justify-content:flex-end"><button data-all="1">${G.shopAll ? 'Hide unknown ships' : 'Show all ships'}</button></div>`);
  } else if (tab === 'upgrades') {
    for (const [k, U] of Object.entries(UPG)) { const lv = B.up[k] || 0, q = U.cost[lv]; rows.push(row(`${U.n} <span class="pip">${'●'.repeat(lv)}${'○'.repeat(U.cost.length - lv)}</span>`, U.d, q == null ? bt('', '✓', 0, 'Maxed') : bt(`data-k="${k}"`, money(q), q))); }
  } else if (tab === 'gear') {
    for (const [k, g] of Object.entries(GEAR)) { if (g.need(P.own)) rows.push(row(g.n, g.d, bt(`data-g="${k}"`, money(g.cost), g.cost))); if (k === 'rod3') rows.push(row('How to fish', 'Casting and reeling, in short', '<span class="bt"><button data-help="1">Read</button></span>')); }
  } else {
    for (const [k, L, t] of [['paint', PAINTS, 'Hull paint'], ['glow', GLOWS, 'Underglow']]) {
      const ow = Array.isArray(B.up[k + 's']) ? B.up[k + 's'] : [0, B.up[k] || 0], cur = B.up[k] || 0, cost = free ? 0 : STYLE_COST[k];
      const sw = L.map((a, i) => { const has = i === 0 || ow.includes(i); return `<button class="swc${a.c ? '' : ' none'}${has ? ' own' : ''}${i === cur ? ' on' : ''}" title="${a.n}" data-c="${k}" data-v="${i}" style="${a.c < 0 ? 'background:conic-gradient(#f55,#fd4,#5f8,#4cf,#a5f,#f55)' : a.c ? 'background:' + hexS(a.c) : ''}"${!has && G.cash < cost ? ' disabled' : ''}></button>`; }).join('');
      rows.push(`<div class="up"><div>${t}<small>${L[cur].n}</small></div><span class="sws">${sw}</span></div><small class="why sp">${cost ? `New colour ${money(cost)}${G.cash < cost ? ` · ${money(cost - G.cash)} short` : ''} · owned ones are free` : 'Every colour is free'}</small>`);
    }
  }
  $('shopL').innerHTML = rows.join('');
  $('shopL').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.disabled) return;
    if (b.dataset.help) { G.shopOpen = false; $('shop').classList.add('hidden'); showFishHelp(true); return; }
    if (b.dataset.job != null || b.dataset.jobx != null) { const x = b.dataset.jobx != null; b.disabled = true; act({a: x ? 'jobx' : 'job', i: +(x ? b.dataset.jobx : b.dataset.job)}); setTimeout(drawShop, isHost() ? 0 : 400); return; }
    if (b.dataset.jrn) { jrnOpen(); return; }
    if (b.dataset.all) { G.shopAll = !G.shopAll; drawShop(); return; }
    const m = b.dataset.c ? {a: 'buyc', k: b.dataset.c, v: +b.dataset.v} : b.dataset.h ? {a: 'buyh', k: +b.dataset.h} : b.dataset.g ? {a: 'buyg', k: b.dataset.g, own: P.own} : b.dataset.tug ? {a: 'tug'} : {a: 'buy', k: b.dataset.k, fl: P.flares};
    document.querySelectorAll('#shopL button, #bSell').forEach(q => q.disabled = true); act(m); setTimeout(drawShop, 1000); });
}
function myPose() { return {t: 'pose', x: +P.x.toFixed(2), z: +P.z.toFixed(2), y: +P.y.toFixed(2), yw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.cr ? 1 : 0, rn: P.run, h: P.h, hd: P.hd, hb: P.hb, ob: P.ob, bl: P.ob ? [+P.bl[0].toFixed(2), +P.bl[1].toFixed(2)] : 0, sw: P.sw, dp: P.deep, in: P.seat ? P.in : 0, eq: P.eq, sc: (P.own && P.own.sack) || 0, dv: +(P.dv || 0).toFixed(2), su: (P.own && P.own.suit) || 0, au: (P.own && P.own.aura) || 0, l: lightOn() ? 1 : 0}; }

// ---------------- input
addEventListener('keydown', e => {
  const typing = e.target && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && /^(text|number|search|password)$/.test(e.target.type)));
  if ((e.code === 'Tab' || e.code === 'Space') && G.on && !G.paused && !typing) e.preventDefault();
  if (!G.on) return; if (G.paused) return;
  if (typing) { if (G.casOpen && e.code === 'Escape' && !e.repeat) closeCasino(); return; }
  if (!anyPanel()) K[e.code] = true;
  if (G.noteOpen) { if (e.code === 'KeyE' || e.code === 'Escape') closeNote(); return; }
  if (G.shopOpen) { if ((e.code === 'KeyE' || e.code === 'Escape') && !e.repeat) closeShop(); return; }
  if (G.casOpen) { if (e.code === 'Escape' && !e.repeat) closeCasino(); return; }
  if (G.helpOpen) { if (['KeyE', 'Escape', 'KeyH', 'Enter'].includes(e.code) && !e.repeat) showFishHelp(false); return; }
  if (G.jrnOpen) { if (['KeyJ', 'KeyE', 'Escape'].includes(e.code) && !e.repeat) jrnClose(); return; }
  if (G.endOpen) return;
  if (e.repeat) return;
  if (e.code === 'KeyE') { eDown = true; ePress = true; }
  if (!alivePlay()) return;
  if (e.code === 'KeyF' && P.hd < 0 && P.bat > 0) { if (![1, 3, 4].includes(P.eq)) { equip(1); P.l = 1; } else { P.l ^= 1; Snd.click(); } }
  if (e.code === 'KeyC' && !P.down && !P.seat && !P.sw) P.cr = P.cr ? 0 : 1;
  if (e.code === 'KeyG' && !P.climb) throwFlare();
  if (e.code === 'KeyX' && P.sack.length && !P.climb) act({a: 'drop'});
  const dg = /^(Digit|Numpad)([1-7])$/.exec(e.code); if (dg && !P.climb) equip(+dg[2] - 1);
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyH') showFishHelp(true);
  if (e.code === 'KeyJ') jrnOpen();
  if (e.code === 'KeyQ' && !P.down) { if (P.seat) { const n = performance.now(); if (n - (G.hornC || 0) > 2500) { G.hornC = n; act({a: 'horn'}); } } else if ((G.whT || 0) <= 0) { G.whT = 3; act({a: 'wh'}); } }
  if (e.code === 'Tab') { G.map = true; $('map').classList.remove('hidden'); drawMap(); }
});
addEventListener('keyup', e => { K[e.code] = false; if (e.code === 'KeyE') eDown = false; if (e.code === 'Tab') { G.map = false; $('map').classList.add('hidden'); } });
addEventListener('mousemove', e => {
  if (!G.on || G.paused || document.pointerLockElement !== canvas || !P) return;
  const s = .0022 * SET.sens; P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s * (SET.inv ? -1 : 1), -1.45, 1.45);
  if (P.hd >= 0) { const h = HIDES[P.hd], d = angD(h.yaw, P.yaw); P.yaw = h.yaw + clamp(d, -.7, .7); P.pitch = clamp(P.pitch, -.5, .4); }
});
canvas.addEventListener('mousedown', e => { if (!G.on || G.paused) return; if (G.noteOpen) { closeNote(); return; } if (anyPanel()) return; if (document.pointerLockElement !== canvas) { lockMouse(); return; } if (e.button === 2) mouseR = true; if (e.button === 0 && !alivePlay()) G.spec++; if (e.button === 0 && alivePlay() && !P.climb) { G.lmb = true; toolDown(); } });
addEventListener('mouseup', e => { if (e.button === 2) mouseR = false; if (e.button === 0) { G.lmb = false; toolUp(); } });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { const lk = document.pointerLockElement === canvas; if (lk && G.on && G.paused && G.wantResume) { G.wantResume = false; pause(false); return; } if (!lk && G.on && !TEST && !G.paused && !anyPanel()) pause(true); });
addEventListener('blur', () => clearKeys());
addEventListener('wheel', e => { if (!G.on || G.paused || anyPanel() || (document.pointerLockElement !== canvas && !TEST) || !alivePlay() || P.seat || P.climb) return;
  const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1), n = performance.now(); if (!d) return; if (Math.sign(d) !== Math.sign(G.whA || 0)) G.whA = 0; G.whA += d;
  if (Math.abs(G.whA) < 40 || n - (G.whN || 0) < 70) return; cycleSlot(Math.sign(G.whA)); G.whA = 0; G.whN = n; }, {passive: true});
addEventListener('beforeunload', e => { if (G.on && !TEST) { try { save(); } catch (x) {} e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('pointerlockerror', () => { if (G.paused) $('pauseN').textContent = 'Click Resume again if the mouse does not lock.'; });
function lockMouse() { if (!TEST && canvas.requestPointerLock) try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function pause(p) { G.paused = p; G.wantResume = false; $('pause').classList.toggle('hidden', !p); if (p) { clearKeys(); G.map = false; $('map').classList.add('hidden'); $('pVol').value = SET.vol; $('pSens').value = SET.sens; $('pBright').value = SET.bright; $('pFov').value = SET.fov || 70; $('pInv').checked = !!SET.inv; } $('pauseN').textContent = Net.role === 'solo' ? 'The sea waits for you. Progress is saved.' : 'Online games keep running.'; if (Net.role === 'solo' && A.ctx) p ? A.ctx.suspend() : A.ctx.resume(); }
function resumeReq() { if (TEST || document.pointerLockElement === canvas || !canvas.requestPointerLock) { pause(false); return; } G.wantResume = true; lockMouse(); $('pauseN').textContent = 'Click Resume again if the mouse does not lock.'; }
function clearKeys() { for (const k in K) K[k] = false; eDown = false; ePress = false; mouseR = false; G.lmb = false; }
const anyPanel = () => !!(G.noteOpen || G.shopOpen || G.casOpen || G.helpOpen || G.endOpen || G.jrnOpen);
function closePanels(relock) { G.noteOpen = G.shopOpen = G.casOpen = G.helpOpen = G.jrnOpen = false; ['shop', 'casino', 'fishHelp', 'note'].forEach(id => $(id).classList.add('hidden')); if ($('jrn')) $('jrn').classList.add('hidden'); if (relock && G.on) lockMouse(); }
// once per rendered frame, after the camera: panels that should close, the crouch dot, the click-to-look hint
function ctlFrame(dt) {
  if (!G.on || !P) return;
  const four = G.noteOpen || G.shopOpen || G.casOpen || G.helpOpen;
  if (four && (!alivePlay() || P.down || (B.sink > 0 && P.ob))) closePanels(false);
  else if (four && Net.role !== 'solo') { const sp = G.voyShopPos || (G.shed && G.shed.shop), sh = G.shopOpen && sp && Math.hypot(P.x - sp[0], P.z - sp[2]) > 6, c = G.casAt, cs = G.casOpen && c && (c[2] ? !P.ob : Math.hypot(P.x - c[0], P.z - c[1]) > 6); if (sh || cs) closePanels(false); }
  const ap = anyPanel(); if (ap && !G.panWas) clearKeys(); G.panWas = ap;
  if (P.climb && (!alivePlay() || P.down)) P.climb = null;
  const cr = !!(alivePlay() && P.cr && !P.sw && P.hd < 0); if (cr !== G.dotCr) { G.dotCr = cr; $('dot').classList.toggle('cr', cr); }
  const hint = !G.paused && !ap && !G.map && alivePlay() && document.pointerLockElement !== canvas && !TEST; if (hint !== G.hintOn) { G.hintOn = hint; $('clickHint').classList.toggle('on', hint); }
}
const slotOk = i => !![1, 1, P.own.rod, P.own.glock, P.own.sg, P.flares > 0, P.own.fw > 0][i];
function cycleSlot(d) { for (let k = 1; k <= 7; k++) { const i = ((P.eq + d * k) % 7 + 7) % 7; if (slotOk(i)) { if (i !== P.eq) equip(i); return; } } }
// ladders: climb over about a second instead of teleporting to the top
function startClimb(s) {
  const boat = s.top === 'boat', y0 = waveH(P.x, P.z, G.wt) - (P.dv || 0);
  if (boat) { const ex = s.end ? s.end[0] : 0, ez = s.end ? s.end[1] : BG.zs - 1, [ax, az] = bW2L(P.x, P.z); P.climb = {t: 0, T: .9 + (BDECK.y - y0) * .12, a: [ax, y0, az], b: 'boat', f: [s.lx, s.lz], e: [ex, BDECK.y, ez]}; }
  else { const t = s.top; P.climb = {t: 0, T: .9 + (t[1] - y0) * .12, a: [P.x, y0, P.z], b: t, f: [s.x, s.z], e: [t[0], t[1], t[2]]}; }
  Object.assign(P.climb, {p0: P.pitch, po: 0, yo: 0, y0: P.yaw, eye: P.eye, rT: 0, wet: 1});
  P.sw = 0; P.ob = 0; P.dv = 0; P.deep = 0; P.vx = P.vz = P.vy = 0; P.cr = 0; P.run = 0;
}
function climbStep(dt) {
  const c = P.climb, boat = c.b === 'boat', bin = c.b === 'bin';
  if (P.down || P.seat || (P.ob && !bin) || ((boat || bin) && B.sink > 0) || (boat && (B.dep || 0) > .6)) { P.climb = null; return; }
  if (bin) { if (c.up && !B.hat) { P.climb = null; subClimb(false); return; } c.y0 += B.yaw - (c.bY ?? B.yaw); c.bY = B.yaw; }
  c.t += dt; const u = Math.min(1, c.t / c.T), k1 = smooth(u / .45), k3 = smooth((u - .62) / .38), ky = smooth((u - .1) / .65);
  const hx = mix(mix(c.a[0], c.f[0], k1), c.e[0], k3), hz = mix(mix(c.a[2], c.f[1], k1), c.e[2], k3), lift = boat ? B.heave * ky : 0;
  const rung = ky > .02 && ky < .98, st = rung ? Math.sin(c.t / .28 * TAU) * .03 * Math.sin(PI * ky) : 0;
  P.y = mix(c.a[1], c.e[1], ky) + lift + st; P.eye = mix(c.eye, 1.62, smooth((u - .1) / .75));
  if (boat || bin) { [P.x, P.z] = bL2W(hx, hz); if (bin) P.bl = [hx, hz]; } else { P.x = hx; P.z = hz; }
  const [fx, fz] = boat ? bL2W(c.f[0], c.f[1]) : c.f, [tx, tz] = boat ? bL2W(c.e[0], c.e[2]) : [c.e[0], c.e[2]], ty = bin ? B.yaw + PI : Math.atan2(-(tx - fx), -(tz - fz));
  const yo = angD(c.y0, ty) * smooth(u / .45); P.yaw += yo - c.yo; c.yo = yo;
  const po = (-.15 - c.p0) * Math.sin(PI * u); P.pitch += po - c.po; c.po = po;
  if (rung && (c.rT -= dt) <= 0) { c.rT = .28; Snd.rung(); }
  if (c.wet && P.y > c.a[1] + .25) { c.wet = 0; Snd.splash(); for (let i = 0; i < 6; i++) setTimeout(() => tone(1100 + Math.random() * 900, .012, .05, 'sine', null, 1800 + Math.random() * 900), 250 + i * 300 + Math.random() * 140); }
  if (u < 1) return;
  P.climb = null; P.sw = 0; P.vy = 0; P.eye = 1.62;
  if (boat || bin) { P.ob = 1; P.bl = [c.e[0], c.e[2]]; [P.x, P.z] = bL2W(c.e[0], c.e[2]); P.y = c.e[1]; P.lastBY = B.yaw; } else { P.x = c.b[0]; P.y = c.b[1]; P.z = c.b[2]; }
}
// the sub's one-shots: hatch clang, dive klaxon, hull ticks, drips, the sonar ping
Snd.clang = p => { tone(110, .25, .5, 'triangle', p, 70); burst(2600, 8, .22, .12, 'bandpass', p); burst(400, 1, .3, .3, 'lowpass', p); setTimeout(() => burst(5200, 12, .05, .35, 'bandpass', p), 40); };
Snd.klaxon = p => { if (!A.on) return; const c = A.ctx, t = c.currentTime + .02, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = .9; g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 2; i++) { const u = t + i * .75; o.frequency.setValueAtTime(220, u); o.frequency.linearRampToValueAtTime(440, u + .35); o.frequency.linearRampToValueAtTime(300, u + .6); g.gain.setValueAtTime(0, u); g.gain.linearRampToValueAtTime(.1, u + .03); g.gain.setValueAtTime(.1, u + .55); g.gain.linearRampToValueAtTime(0, u + .65); }
  o.connect(f); f.connect(g); g.connect(p || A.out); o.start(t); o.stop(t + 1.6); };
Snd.hullTick = p => { burst(5000 + Math.random() * 3000, 14, .05, .015, 'bandpass', p); tone(2400, .01, .05, 'sine', p); };
Snd.drip = p => { tone(1400 + Math.random() * 500, .03, .07, 'sine', p, 700); setTimeout(() => burst(3000, 10, .02, .02, 'bandpass', p), 20); };
Snd.ping = p => { tone(1480, .025, 1.6, 'sine', p); setTimeout(() => tone(1480, .01, 1.2, 'sine', p), 700); };
Snd.rung = () => { burst(1600 * (.92 + Math.random() * .16), 3, .05, .05); tone(150, .03, .08); };
Snd.land = (k, kind) => { burst(110, 1, .4 * k, .25, 'lowpass'); Snd.step(kind || 'wood', 1.6); };
// footsteps by surface: a heel strike, then the toe 45 ms later at half gain
Snd.step = (kind, k) => { const r = .88 + Math.random() * .24, hit = g => {
    if (kind === 'wet') { burst(700 * r, .5, .1 * k * g, .25, 'bandpass', null, .7); burst(1600 * r, 1, .03 * k * g, .15); }
    else if (kind === 'metal') burst(2200 * r, 4, .05 * k * g, .08);
    else if (kind === 'steel') burst(1600 * r, 3, .05 * k * g, .08);
    else if (kind === 'stone') burst(900 * r, .8, .06 * k * g, .05);
    else if (kind === 'carpet') burst(350 * r, .7, .08 * k * g, .1, 'lowpass');
    else if (kind === 'sand') { burst(450 * r, .6, .07 * k * g, .12, 'lowpass'); burst(3000 * r, .5, .012 * k * g, .06, 'highpass'); }
    else burst(600 * r, 1.2, .06 * k * g, .09); };
  hit(1); setTimeout(() => hit(.5), 45);
  if (kind === 'metal') tone((320 + Math.random() * 60) * r, .02 * k, .08, 'triangle');
  else if (kind === 'steel') { tone(150 * r, .03 * k, .1); tone(2200 * r, .008 * k, .04); }
  else if (kind === 'wood') tone(180 * r, .015 * k, .08, 'triangle'); };
const KEYMAP = [['W A S D', 'move'], ['Shift', 'run'], ['C', 'crouch · dive'], ['Space', 'rise · hold breath'], ['E', 'use · hold for jobs'], ['F', 'flashlight'], ['G', 'throw a flare'], ['Q', 'whistle · horn at the wheel'], ['1-7 · wheel', 'hotbar'],
  ['LMB / RMB', 'use · aim'], ['R', 'reload'], ['X', 'drop the last thing'], ['H', 'fishing help'], ['Tab (hold)', 'chart'], ['Esc', 'pause']];
const keyTable = list => `<div class="keys ktab">${list.map(([k, a]) => `<span><b>${k}</b></span><span>${a}</span>`).join('')}</div>`;

// ---------------- rendering
const _fw = new THREE.Vector3(), swayV = new THREE.Vector3();
const VM = new THREE.Group(); cam.add(VM);
(function viewModel() {
  const m = new THREE.MeshStandardMaterial({color: 0x1d1f22, roughness: .4, metalness: .7});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.022, .02, .2, 12), m); body.rotation.x = PI / 2; VM.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.034, .024, .05, 14), m); head.rotation.x = PI / 2; head.position.z = -.12; VM.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.03, 14), new THREE.MeshBasicMaterial({color: 0xfff2d8})); lens.position.z = -.146; VM.add(lens); VM.userData.lens = lens;
  const glove = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .6}); const fist = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), glove); fist.scale.set(1, .85, 1.5); fist.position.set(0, -.012, .02); VM.add(fist);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .4, 10), glove); arm.rotation.x = PI / 2 - .25; arm.position.set(.03, -.06, .22); VM.add(arm);
  VM.scale.setScalar(.8); VM.traverse(o => { if (o.isMesh) o.castShadow = false; });
})();
const VMF = new THREE.Group(); cam.add(VMF); VMF.position.set(.2, -.24, -.45); VMF.rotation.set(.5, 0, -.25); VMF.visible = false;
{ const st = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .3, 8), new THREE.MeshStandardMaterial({color: 0xb01a10, roughness: .6})); VMF.add(st); const tp = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(6, 1.2, .5)})); tp.position.y = .16; VMF.add(tp); VMF.userData.tip = tp; }
const VMC = new THREE.Group(); cam.add(VMC); VMC.position.set(-.05, -.42, -.75);
function boatPose(dt) {
  if (!isHost() && B.tx != null) { const k = Math.min(1, dt * 6); const px = B.tx - Math.sin(B.tyaw) * B.v * .05, pz = B.tz - Math.cos(B.tyaw) * B.v * .05; B.x = mix(B.x, px, k); B.z = mix(B.z, pz, k); B.yaw += angD(B.yaw, B.tyaw) * k; B.x += -Math.sin(B.yaw) * B.v * dt * (1 - k); B.z += -Math.cos(B.yaw) * B.v * dt * (1 - k); }
  const t = G.wt, fx = -Math.sin(B.yaw), fz = -Math.cos(B.yaw), sx = Math.cos(B.yaw), sz = -Math.sin(B.yaw);
  if (BOAT.userData.sig !== (B.up.cls || 0) + ':' + (B.up.paint || 0)) { const same = BOAT.userData.cls === (B.up.cls || 0); buildBoat(); if (same) { /* repaint only */ } else if (P && P.ob) { const sp = boatSpawn(0); P.bl = sp.bl; P.y = sp.y; P.climb = null; P.rest = 0; } }
  const hl2 = BG.L * .32, hw2 = BG.hw * .9, hf = waveH(B.x + fx * hl2, B.z + fz * hl2, t), hb = waveH(B.x - fx * hl2, B.z - fz * hl2, t), hl = waveH(B.x - sx * hw2, B.z - sz * hw2, t), hr = waveH(B.x + sx * hw2, B.z + sz * hw2, t);
  B.sinkY = B.sink > 0 ? Math.max(-6, (B.sinkY || 0) - dt * 1.2) : 0;
  const dk = clamp(1 - (B.dep || 0), 0, 1), m = Math.pow(HC().L / 12.2, .6), dvdt = (B.v - (G.bv0 ?? B.v)) / Math.max(dt, 1e-3); G.bv0 = B.v; G.bdv = mix(G.bdv || 0, dvdt, Math.min(1, dt * 4)); B.trim = mix(B.trim || 0, (m < 1.6 ? clamp(B.v / 8, 0, 1) * .06 : 0) + clamp(G.bdv, -2, 2) * .01 / m, Math.min(1, dt * 2)); B.heave = (hf + hb + hl + hr) / 4 * dk + B.sinkY - (B.dep || 0); B.pitch = (Math.atan2(hf - hb, hl2 * 2) * .8 * dk + (B.sink > 0 ? .25 : 0)) - clamp((B.dtar - B.dep) * .06, -.12, .12) + B.trim * dk; B.roll = Math.atan2(hl - hr, hw2 * 2) * .8 * dk + (G.shake || 0) * Math.sin(G.t * 23) * .05 + clamp((B.yr || 0) * B.v * (m < 1.6 ? .03 : -.01), -.12, .12);
  { const gl = GLOWS[B.up.glow || 0], gm = BOAT.userData.glow; if (gl && gl.c) { if (gl.c < 0) gm.material.color.setHSL((G.wt * .1) % 1, 1, .55); else gm.material.color.setHex(gl.c); gm.material.opacity = (.55 - .35 * TOD.day) * (B.dep > .5 ? 0 : 1); } else gm.material.opacity = 0; }
  if (BOAT.userData.port) BOAT.userData.port.emissiveIntensity = TOD.night * .7;
  if (BOAT.userData.fire) BOAT.userData.fire.emissiveIntensity = .8 + Math.random() * .5; if (BOAT.userData.fairy) BOAT.userData.fairy.emissiveIntensity = .7 + Math.sin(G.wt * 2) * .15 + TOD.night * .5;
  if (BOAT.userData.cat) { BOAT.userData.cat.scale.y = 1 + Math.sin(G.wt * 2.2) * .04; if (P && P.ob && A.on) { const c = BOAT.userData.catP; if (Math.hypot(P.bl[0] - c[0], P.bl[1] - c[2]) < 1.6 && Math.abs(P.y - c[1]) < 2.2) { G.purrT = (G.purrT || 0) - dt; if (G.purrT <= 0) { G.purrT = .55; burst(90, 1.5, .05, .45, 'lowpass', null, .7); } } } }
  if (BOAT.userData.winM) BOAT.userData.winM.emissiveIntensity = .05 + TOD.night * .9 * (.85 + Math.random() * .15);
  if (BOAT.userData.prop) BOAT.userData.prop.rotation.z += B.thr * dt * 20; if (BOAT.userData.radar) BOAT.userData.radar.rotation.y += dt * 1.6;
  BOAT.position.set(B.x, B.heave, B.z); BOAT.rotation.set(B.pitch, B.yaw, B.roll, 'YXZ');
  BOAT.userData.wheel.rotation.z = -B.st * 2; if (BG.sub) subPose(dt);
  const cg = BOAT.userData.cargo, ck = B.hold.slice(0, 8).join(); if (cg.userData.k !== ck) { cg.userData.k = ck; const keep = new Set(Object.values(MAT)); cg.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (!keep.has(o.material)) o.material.dispose(); } }); cg.clear(); }
  while (cg.children.length < Math.min(8, B.hold.length)) { const i = cg.children.length, m = itemMesh(B.hold[i] || 'crate'), ca = BOAT.userData.cargoAt; scene.remove(m); if (ca) m.position.set(...ca(i)); else m.position.set(-1.3 + (i % 4) * .85, BDECK.y + .25 + Math.floor(i / 4) * .45, BSPOT.hold[1] + 1.4); cg.add(m); }
  const lv = B.up.light, [lx, lz] = bL2W(0, BOAT.userData.lightZ); boatL.position.set(lx, BOAT.userData.lightY + B.heave, lz); boatL.target.position.set(B.x + fx * 40, BG.sub ? B.heave - 14 : -1, B.z + fz * 40); boatL.intensity = [160, 300, 500][lv] * (1 - .85 * TOD.day * (B.dep > 1 ? 0 : 1)) * ((B.up.cls || 0) === 2 ? 1.6 : 1); boatL.distance = [90, 160, 220][lv];
}
function specTarget() { const L = [...PL.values()].filter(p => p !== P && p.ready && !p.dead); return L.length ? L[G.spec % L.length] : null; }
function fl2() { return (G.bolt || 0) > 0 ? G.bolt * 2 : 0; }
// raindrops on the lens: they land, sit, then run down
const DROPS = [];
function stepDrops(dt) {
  const c = $('drops'); if (!c) return; const I = G.dropsI || 0, up = cam.rotation.x > -.35; if (!I && !DROPS.length) { if (c.style.opacity !== '0') c.style.opacity = 0; return; } c.style.opacity = 1;
  if (I && up && Math.random() < dt * 14 * I) DROPS.push({x: Math.random() * c.width, y: Math.random() * c.height * .9, r: 2 + Math.random() * 6, t: 0, run: Math.random() < .35, v: 0});
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  for (let i = DROPS.length - 1; i >= 0; i--) { const d = DROPS[i]; d.t += dt; if (d.run && d.t > .6) { d.v += dt * 40; d.y += d.v * dt; } const life = d.run ? 3 : 2.2, a = Math.min(1, (life - d.t) / .6) * .55;
    if (d.t > life || d.y > c.height + 10) { DROPS.splice(i, 1); continue; }
    const gr = g.createRadialGradient(d.x - d.r * .3, d.y - d.r * .3, 0, d.x, d.y, d.r); gr.addColorStop(0, `rgba(255,255,255,${a * .55})`); gr.addColorStop(.6, `rgba(180,200,215,${a * .18})`); gr.addColorStop(1, `rgba(20,30,40,${a * .35})`);
    g.fillStyle = gr; g.beginPath(); g.ellipse(d.x, d.y, d.r * .85, d.r, 0, 0, TAU); g.fill(); if (d.run && d.v > 5) { g.fillStyle = `rgba(200,215,230,${a * .15})`; g.fillRect(d.x - d.r * .3, d.y - 18, d.r * .6, 18); } }
}
function inCabin() { if (!P || !P.ob || !BOAT || !BOAT.userData.wz) return false; if (BG.sub) return subInside(); const [wz0, wz1] = BOAT.userData.wz, ww = BOAT.userData.ww || 2; return P.bl[1] > wz0 && P.bl[1] < wz1 && Math.abs(P.bl[0]) < ww; }
function updateCamera(dt) {
  let ex, ey, ez, yaw, pitch, own = alivePlay(), roll = 0;
  if (own && P.ob) { [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); }
  if (own) { ex = P.x; ey = P.y + P.eye; ez = P.z; yaw = P.yaw; pitch = P.pitch; if (P.ob) { ey += B.heave; roll = B.roll * .7; pitch += B.pitch * .5; if (BG.sub && BOAT) { _sb.set(P.bl[0], P.y + P.eye, P.bl[1]).applyMatrix4(BOAT.matrixWorld); ex = _sb.x; ey = _sb.y; ez = _sb.z; } } if (P.sw) ey = waveH(P.x, P.z, G.wt) + .25 - (P.dv || 0) * 1.0; else if (P.y < 0 && !P.ob) ey = Math.max(ey, waveH(P.x, P.z, G.wt) + .25); }
  else if (G.drownCam) { const dc = G.drownCam; dc.t += dt; ex = dc.x; ez = dc.z; ey = waveH(ex, ez, G.wt) + .2 - Math.min(5.5, dc.t * 2.2); yaw = dc.yaw; pitch = mix(.1, -1.35, clamp(dc.t / 1.2, 0, 1)); roll = Math.sin(dc.t * 3) * .15; if (dc.t > 4) G.drownCam = null; }
  else { const s = specTarget(); if (s) { ex = s.rx; ey = s.ry + (s.down ? .5 : 1.6); ez = s.rz; yaw = s.ryaw; pitch = s.rpitch; } else { ex = HOME.x; ey = 30; ez = HOME.z + 40; yaw = PI; pitch = -.3; } }
  if (own && P.ob) { const o = seaLegs(dt); ex += o[0]; ez += o[1]; roll += o[2]; } else G.sl = null; G.fovAdd = mix(G.fovAdd || 0, own && P.ob ? clamp(Math.abs(B.v) / 12, 0, 1) * 4 : 0, Math.min(1, dt * 1.5));
  if (own && P.seat && HC().eye && BOAT && BOAT.userData.wz) { [ex, ez] = bL2W(0, BOAT.userData.wz[0] - .7); }
  if (P && P.scope && !(own && BOAT && BG.sub)) subScope(0); else if (P && P.scope) { _sb.set(0, 4.97 + ((G.mastU ?? 1) - 1) * 1.9, SUB.SCOPE[1] - .12).applyMatrix4(BOAT.matrixWorld); ex = _sb.x; ey = _sb.y; ez = _sb.z; G.fovAdd = 28 - (SET.fov || 70); }
  const sp = own ? Math.hypot(P.vx, P.vz) : 0, bobA = own && P.hd < 0 && !P.seat ? clamp(sp / 6, 0, 1) * .05 : 0, shk = own && P.fear > .5 ? (P.fear - .5) * .006 : 0, tr = Math.min(1, G.shake || 0), nz = i => Math.sin(G.t * 13.1 + i * 7) * .5 + Math.sin(G.t * 27.7 + i * 3) * .3 + Math.sin(G.t * 51.3 + i) * .2;
  G.shake = Math.max(0, (G.shake || 0) - dt * 1.6);
  for (let i = 0, h = Math.min(dt, .05) / 2; i < 2; i++) { G.lspV = (G.lspV || 0) + (-60 * (G.lspX || 0) - 14 * G.lspV) * h; G.lspX = (G.lspX || 0) + G.lspV * h; }
  const ld = own ? clamp(G.lspX || 0, -.15, .4) : 0, bb = (Math.abs(Math.sin(P.bob || 0)) - 1) * bobA * .8, bs = Math.sin((P.bob || 0) * .5) * bobA;
  if (own) { const sv = P.vx * Math.cos(P.yaw) - P.vz * Math.sin(P.yaw); G.rollS = mix(G.rollS || 0, -sv * .006, Math.min(1, dt * 6)); roll += G.rollS; }
  if (G.js && G.js.t > 0) { G.js.t -= dt; (G.js.J || MJ).head.getWorldPosition(_mh); const dx = _mh.x - ex, dy = _mh.y + .05 - ey, dz = _mh.z - ez, k = clamp((G.js.L - G.js.t) * 9, 0, 1);
    yaw += angD(yaw, Math.atan2(-dx, -dz)) * k; pitch = mix(pitch, Math.atan2(dy, Math.hypot(dx, dz)), k); }
  cam.position.set(ex + Math.sin(G.t * 37) * shk + nz(0) * .04 * tr, ey + bb + nz(1) * .04 * tr - ld, ez);
  cam.rotation.set(pitch + Math.sin(G.t * 31) * shk + nz(2) * .025 * tr - ld / .35 * .06, yaw + bs * .05 + nz(3) * .025 * tr, roll + (own && P.down ? .35 : bs * .08) + nz(4) * .05 * tr, 'YXZ'); cam.updateMatrixWorld();
  VM.visible = own && P.hd < 0 && !P.down && !P.sw && !P.seat && !P.scope && P.eq === 1; VMF.visible = own && P.hd < 0 && !P.down && !P.seat && P.eq === 5 && P.flares > 0;
  VM.position.set(.22 + Math.sin(P.bob || 0) * bobA * .3, -.21 - Math.abs(Math.cos(P.bob || 0)) * bobA * .3, -.42);
  if (false) { VMC.clear(); VMC.userData.k = P.carry; if (P.carry) { const m = itemMesh(P.carry); scene.remove(m); m.traverse(o => { if (o.isMesh) o.castShadow = false; }); VMC.add(m); } }
  VMC.visible = false;
  cam.getWorldDirection(_fw); swayV.lerp(_fw, Math.min(1, dt * 14));
  const on = own && (lightOn() || (G.js && G.js.t > 0)) && P.hd < 0 && (!P.sw || P.dv > .5); let k = on ? .55 + .45 * Math.min(1, P.bat * 3) : 0;
  const nearM = Math.hypot(ex - M.x, ez - M.z) + Math.abs(ey - M.y);
  if (G.js && G.js.t > 0) k = Math.random() < .3 ? .25 : 1; else if (on && (P.bat < .15 || nearM < 13 || M.state === 'chase' && nearM < 22) && Math.random() < .25) k *= Math.random() < .5 ? .05 : .5;
  flash.intensity = 70 * k; VM.userData.lens.material.color.setScalar(on ? .25 + k * .35 : .04);
  _v.set(.2, -.19, -.62).applyQuaternion(cam.quaternion).add(cam.position); flash.position.copy(_v); flash.target.position.copy(_v).addScaledVector(swayV, 10);
  scene.userData.sky.position.copy(cam.position); stepBirds(G.wt, ex, ez);
  SEA.position.set(Math.round(ex / 6) * 6, 0, Math.round(ez / 6) * 6);
  { const ri = G.storm < .15 ? 0 : clamp((G.storm - .15) / .7, 0, 1), cov = inCabin() || zoneOf(ex, ez, ey - 1.6) >= 0 || (G.uw || 0) > .3, u = G.rainM.uniforms; u.uT.value = G.wt; u.uC.value.set(ex, ey, ez); u.uI.value = cov ? 0 : ri; u.uW.value.set(3 + G.storm * 5, 1.2 + G.storm * 2);
    u.uCol.value.copy(TOD.fog).multiplyScalar(1.8).addScalar(.12 + fl2()); G.rain2.visible = ri > 0 && !cov; const su = G.splM.uniforms; su.uT.value = G.wt; su.uC.value.set(ex, ey, ez); su.uI.value = ri; su.uA.value = G.sea; su.uCol.value.copy(u.uCol.value); G.spl.visible = ri > 0 && (G.uw || 0) < .3 && !G.subIn;
    G.dropsI = cov || P && P.sw ? 0 : ri; RAIN.visible = false; }
  if (BG.sub) subFx(dt); else G.subIn = false;
  if (false) { const ra = RAIN.geometry.attributes.position.array, fall = dt * 24; for (let i = 0; i < ra.length; i += 6) { ra[i + 1] -= fall; ra[i + 4] -= fall; ra[i] -= fall * .1; ra[i + 3] -= fall * .1; if (ra[i + 1] < 0) { const x = (Math.random() - .5) * 50, y = 30, z = (Math.random() - .5) * 50; ra[i] = x; ra[i + 1] = y; ra[i + 2] = z; ra[i + 3] = x + .15; ra[i + 4] = y + .7; ra[i + 5] = z + .05; } } RAIN.geometry.attributes.position.needsUpdate = true; }
  ctlFrame(dt);
}
// ---------------- the deep: a 45 m serpent. Its body follows the path its head took.
const LEV = {NS: 46, NR: 14, LEN: 45, trail: [], g: null, body: null, spk: null, dots: null, head: null, jaw: null, U: new THREE.Vector3(0, 1, 0), on: false, hp: new THREE.Vector3(), ht: new THREE.Vector3(0, 0, 1)};
function levR(u) { return u < .05 ? 1.25 + u / .05 * .75 : 2.0 * Math.pow(1 - (u - .05) / .95, .8) + .12; }
// choreography shared by host (hit tests) and clients (drawing): circle, rear up out of the sea, strike, pass under
function levPose(a, el, L, o) {
  const tB = L - 3.4, tS = L - 1.2, ab = a + tB * .45;
  if (el < tB) { const ang = a + el * .45, R = levRad(ang); o.x = B.x + Math.sin(ang) * R; o.z = B.z + Math.cos(ang) * R; o.y = mix(-14, -1.25, clamp(el / 1.8, 0, 1)) + Math.sin(el * 1.3) * .35; o.jaw = .08; o.ph = 0; o.u = 0; return o; }
  // rear up outside the circle, strike in to a metre off the hull, then dive under it (under the keel of a big ship)
  const H = HC(), R = levRad(ab), rE = levRad(ab, 1.5, 0); let r;
  if (el < tS) { const u = (el - tB) / (tS - tB), e = Math.sin(Math.min(1, u * 1.5) * PI / 2); r = R + e * 5; o.y = mix(-1.25, 8, e) - Math.max(0, u - .82) * 10; o.jaw = clamp((u - .1) * 3, 0, 1); o.ph = 1; o.u = u; }
  else if (el < L) { const u = (el - tS) / (L - tS); r = mix(R + 5, rE, u); o.y = mix(6.2, H.big || H.sub ? -6 : -3.5, Math.min(1, u * 1.3)); o.jaw = 1 - u * .6; o.ph = 2; o.u = u; }
  else { const u = el - L; if (H.big || H.sub) { const kd = H.sub ? -(3.7 + (B.dep || 0)) - 3.5 : -(.6 + H.fb * .7 + H.L * .045) - 3.5; r = rE - Math.max(0, u - .7) * 9; o.y = mix(-6, kd, clamp(u / .7, 0, 1)) - Math.max(0, u - .7) * 1.5; } else { r = rE - u * 9; o.y = -3.5 - u * 6; } o.jaw = .2; o.ph = 3; o.u = u; }
  o.x = B.x + Math.sin(ab) * r; o.z = B.z + Math.cos(ab) * r; return o;
}
function buildLev() {
  const {NS, NR} = LEV, n = NS * NR, g = new THREE.BufferGeometry(), col = new Float32Array(n * 3), idx = [];
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const k = i * NR + j, a = j / NR * TAU, belly = Math.max(0, -Math.cos(a)), m = .6 + .4 * h2(i * 1.7, j * 3.1), str = .85 + .15 * Math.sin(i * 1.3 + j * .4);
    col.set([mix(.018, .11, belly) * m * str, mix(.026, .12, belly) * m * str, mix(.03, .11, belly) * m * str], k * 3); }
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR; idx.push(a, c, b, b, c, d); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const skin = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .42, metalness: 0, envMapIntensity: .45, side: THREE.DoubleSide});
  LEV.body = new THREE.Mesh(g, skin); LEV.body.frustumCulled = false; LEV.body.castShadow = true; scene.add(LEV.body);
  const bone = new THREE.MeshStandardMaterial({color: 0x1a1d1a, roughness: .5}), tooth = new THREE.MeshStandardMaterial({color: 0xd8d0b4, roughness: .25});
  LEV.spk = new THREE.InstancedMesh(new THREE.ConeGeometry(.28, 1.8, 5), bone, 24); LEV.spk.frustumCulled = false; scene.add(LEV.spk);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  LEV.dots = new THREE.Points(dg, new THREE.PointsMaterial({map: TX.glow, color: new THREE.Color().setRGB(1.4, 4, 3.4), size: .9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); LEV.dots.frustumCulled = false; scene.add(LEV.dots);
  const h = new THREE.Group(); LEV.head = h; scene.add(h);
  const sk = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, p = h) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; p.add(o); return o; };
  const hm = new THREE.MeshStandardMaterial({color: 0x0c1012, roughness: .4, metalness: 0, envMapIntensity: .45});
  sk(new THREE.SphereGeometry(1.5, 22, 16), hm, 0, .2, .4, 1.15, .8, 1.5); sk(new THREE.SphereGeometry(1.2, 18, 12), hm, 0, -.05, 2.6, .85, .55, 2.3); sk(new THREE.SphereGeometry(1, 16, 12), hm, 0, .55, .2, 1.1, .5, 1.6);
  for (const s of [-1, 1]) { sk(new THREE.SphereGeometry(.4, 10, 8), hm, s * .9, .55, 1.7, 1, .5, 2.2);
    [[2.6, .22], [2.1, .16], [1.65, .12]].forEach(([z, r]) => { const e = sk(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(7, 4.5, 1)}), s * (z > 2.4 ? .85 : 1.15), .42, z); e.castShadow = false; });
    for (let i = 0; i < 3; i++) { const t = sk(new THREE.CylinderGeometry(.05, .01, 3.5, 5), hm, s * (.5 + i * .25), -.9, 2.2 - i * .7); t.geometry.translate(0, -1.6, 0); t.rotation.x = .5; LEV['tn' + s + i] = t; } }
  for (let i = 0; i < 7; i++) sk(new THREE.ConeGeometry(.22 - i * .02, 1.4 - i * .12, 5), bone, 0, 1.05 - i * .04, 1.2 - i * .55, 1, 1, 1).rotation.x = -.7;
  for (let i = 0; i < 17; i++) { const a = -1.35 + i / 16 * 2.7, t = sk(new THREE.ConeGeometry(.11, .8 + Math.random() * .5, 5), tooth, Math.sin(a) * 1.15, -.42, 1.2 + Math.cos(a) * 1.9); t.rotation.x = PI; }
  const jaw = new THREE.Group(); jaw.position.set(0, -.35, -.3); h.add(jaw); LEV.jaw = jaw;
  sk(new THREE.SphereGeometry(1.4, 18, 12), hm, 0, -.32, 1.9, .92, .36, 1.75, jaw); sk(new THREE.SphereGeometry(1.2, 14, 10), new THREE.MeshStandardMaterial({color: 0x3a0808, roughness: .2, emissive: 0x9a1010}), 0, -.05, 1.8, .85, .3, 1.6, jaw);
  for (let i = 0; i < 15; i++) { const a = -1.3 + i / 14 * 2.6; sk(new THREE.ConeGeometry(.1, .7 + Math.random() * .45, 5), tooth, Math.sin(a) * 1.05, .08, 1.95 + Math.cos(a) * 1.65, 1, 1, 1, jaw); }
  for (const s of [-1, 1]) { const fin = sk(new THREE.PlaneGeometry(2, .9), new THREE.MeshStandardMaterial({color: 0x101618, roughness: .4, side: THREE.DoubleSide, transparent: true, opacity: .85}), s * 1.7, -.7, -1.9); fin.rotation.set(0, s * 1.0, s * .5); LEV['fin' + s] = fin; }
  LEV.hide = () => { LEV.on = false; LEV.body.visible = LEV.spk.visible = LEV.dots.visible = LEV.head.visible = false; LEV.trail.length = 0; };
  LEV.hide();
}
const _lt = new THREE.Vector3(), _lu = new THREE.Vector3(), _ls = new THREE.Vector3(), _lp = new THREE.Vector3(), _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion();
const _lpts = [], _lc = new THREE.Vector3(), _lc2 = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3(), _lsc = new THREE.Vector3();
// place the serpent with its head at hp, the head looking along look (or along its path when look is null)
function levDraw(hp, jaw, look, t) {
  const {NS, NR, LEN} = LEV, tr = LEV.trail;
  if (!LEV.on) { LEV.on = true; LEV.body.visible = LEV.spk.visible = LEV.dots.visible = LEV.head.visible = true; tr.length = 0; }
  const last = tr[tr.length - 1]; if (!last || Math.hypot(hp.x - last[0], hp.y - last[1], hp.z - last[2]) > .45) { tr.push([hp.x, hp.y, hp.z]); if (tr.length > 260) tr.shift(); }
  // resample the path back from the head every LEN/(NS-1) metres; straight on past its end
  const sp = LEN / (NS - 1); let pi = tr.length - 1, px = hp.x, py = hp.y, pz = hp.z, rem = 0;
  let bx = 0, by = -.15, bz = -1; if (tr.length > 1) { const a = tr[tr.length - 1], b = tr[Math.max(0, tr.length - 6)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; bx = (b[0] - a[0]) / l; by = (b[1] - a[1]) / l; bz = (b[2] - a[2]) / l; }
  for (let i = 0; i < NS; i++) {
    let need = i ? sp : 0;
    while (need > 0) {
      if (pi > 0) { const q = tr[pi - 1], l = Math.hypot(q[0] - px, q[1] - py, q[2] - pz); if (l <= need) { need -= l; px = q[0]; py = q[1]; pz = q[2]; pi--; if (pi === 0) { const a = tr[0], b = tr[Math.min(tr.length - 1, 4)], ll = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) || 1; bx = (a[0] - b[0]) / ll; by = (a[1] - b[1]) / ll; bz = (a[2] - b[2]) / ll; } } else { const f = need / l; px += (q[0] - px) * f; py += (q[1] - py) * f; pz += (q[2] - pz) * f; need = 0; } }
      else { px += bx * need; py += by * need; pz += bz * need; py = Math.max(py, -40); need = 0; }
    }
    (_lpts[i] || (_lpts[i] = new THREE.Vector3())).set(px, py, pz);
  }
  const pos = LEV.body.geometry.attributes.position.array, nor = LEV.body.geometry.attributes.normal.array, dp = LEV.dots.geometry.attributes.position.array;
  let si = 0, di = 0;
  for (let i = 0; i < NS; i++) {
    const u = i / (NS - 1), r = levR(u), a = _lpts[Math.max(0, i - 1)], b = _lpts[Math.min(NS - 1, i + 1)];
    _lt.subVectors(a, b); if (_lt.lengthSq() < 1e-6) _lt.set(0, 0, 1); _lt.normalize();
    _lu.set(0, 1, 0).addScaledVector(_lt, -_lt.y); if (_lu.lengthSq() < .01) _lu.copy(LEV.U); _lu.normalize(); if (i === 0) LEV.U.copy(_lu); _ls.crossVectors(_lt, _lu);
    const wv = Math.sin(i * .32 - t * 2.6) * .45 * u; const c = _lc.copy(_lpts[i]).addScaledVector(_ls, wv);
    for (let j = 0; j < NR; j++) { const an = j / NR * TAU, ca = Math.cos(an), sa = Math.sin(an), k = (i * NR + j) * 3;
      pos[k] = c.x + (_lu.x * ca * .85 + _ls.x * sa) * r; pos[k + 1] = c.y + (_lu.y * ca * .85 + _ls.y * sa) * r; pos[k + 2] = c.z + (_lu.z * ca * .85 + _ls.z * sa) * r;
      nor[k] = _lu.x * ca + _ls.x * sa; nor[k + 1] = _lu.y * ca + _ls.y * sa; nor[k + 2] = _lu.z * ca + _ls.z * sa; }
    if (i >= 2 && i % 2 === 0 && si < 24) { const sz = Math.max(.25, 1.4 - si * .05); _ly.copy(_lu).addScaledVector(_lt, -.6).normalize(); _lz.crossVectors(_ls, _ly); _lm.makeBasis(_ls, _ly, _lz); _lq.setFromRotationMatrix(_lm);
      _lm.compose(_lc2.copy(c).addScaledVector(_lu, r * .8), _lq, _lsc.set(sz, sz, sz)); LEV.spk.setMatrixAt(si++, _lm); }
    if (i >= 1 && i < 33 && di < 64) for (const sd of [-1, 1]) { const an = PI * .62 * sd; dp[di * 3] = c.x + (_lu.x * Math.cos(an) * .85 + _ls.x * Math.sin(an)) * r * 1.03; dp[di * 3 + 1] = c.y + (_lu.y * Math.cos(an) * .85 + _ls.y * Math.sin(an)) * r * 1.03; dp[di * 3 + 2] = c.z + (_lu.z * Math.cos(an) * .85 + _ls.z * Math.sin(an)) * r * 1.03; di++; }
  }
  LEV.body.geometry.attributes.position.needsUpdate = LEV.body.geometry.attributes.normal.needsUpdate = true; LEV.body.geometry.computeBoundingSphere();
  LEV.spk.instanceMatrix.needsUpdate = true; LEV.dots.geometry.attributes.position.needsUpdate = true; LEV.dots.geometry.setDrawRange(0, di);
  // head: placed on the first ring, facing along the body or toward the target
  _lt.subVectors(_lpts[0], _lpts[2]).normalize(); if (look) _lt.lerp(look, look.w ?? 1).normalize();
  _lu.set(0, 1, 0).addScaledVector(_lt, -_lt.y); if (_lu.lengthSq() < .01) _lu.copy(LEV.U); _lu.normalize(); _ls.crossVectors(_lu, _lt);
  _lm.makeBasis(_ls, _lu, _lt); LEV.head.quaternion.setFromRotationMatrix(_lm); LEV.head.position.copy(_lpts[0]).addScaledVector(_lt, -.6);
  LEV.ht.copy(_lt); LEV.hp.copy(LEV.head.position).addScaledVector(_lt, 1.6);
  LEV.jaw.rotation.x = jaw * .85 + Math.sin(t * 13) * .03 * jaw;
  for (const s of [-1, 1]) { LEV['fin' + s].rotation.z = s * (.5 + Math.sin(t * 2.4) * .35); for (let i = 0; i < 3; i++) LEV['tn' + s + i].rotation.set(.5 + Math.sin(t * 1.7 + i) * .3, 0, s * Math.sin(t * 1.3 + i * 2) * .3); }
  const uw = cam.position.y < 0 ? 1 : 0; LEV.dots.material.opacity = clamp(TOD.night * .85 + (1 - TOD.day) * .3 + uw * .6, 0, 1);
}
// ---------------- wake behind the boat and spray
const WAKE = {n: 70, pts: [], mesh: null, acc: 0}, SPRAY = {n: 140, p: [], pts: null, i: 0};
function buildWake() {
  const n = WAKE.n, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
  const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } g.setIndex(idx);
  WAKE.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({map: FOAM.userData.mat.map, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide})); WAKE.mesh.frustumCulled = false; WAKE.mesh.renderOrder = 2; scene.add(WAKE.mesh);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY.n * 3).fill(-999), 3));
  SPRAY.pts = new THREE.Points(sg, new THREE.PointsMaterial({map: TX.glow, color: 0xdfeaf0, size: .55, transparent: true, depthWrite: false, opacity: .55})); SPRAY.pts.frustumCulled = false; scene.add(SPRAY.pts);
  for (let i = 0; i < SPRAY.n; i++) SPRAY.p.push({x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0});
}
function bubbles(x, y, z, n) { for (let k = 0; k < n; k++) { const p = SPRAY.p[SPRAY.i++ % SPRAY.n]; Object.assign(p, {x: x + (Math.random() - .5) * .4, y: y - Math.random() * .3, z: z + (Math.random() - .5) * .4, vx: (Math.random() - .5) * .3, vy: 1 + Math.random(), vz: (Math.random() - .5) * .3, b: 1}); } }
function spray(x, y, z, n, s, up = 1) { for (let k = 0; k < n; k++) { const p = SPRAY.p[SPRAY.i++ % SPRAY.n], a = Math.random() * TAU, v = s * (.4 + Math.random() * .6); Object.assign(p, {b: 0, x: x + (Math.random() - .5), y, z: z + (Math.random() - .5), vx: Math.cos(a) * v * .6, vy: (2 + Math.random() * 3) * up * s / 4, vz: Math.sin(a) * v * .6}); } }
function stepWake(dt) {
  if (!WAKE.mesh) return; const t = G.wt, v = Math.abs(B.v);
  WAKE.acc += dt; if (WAKE.acc > .12) { WAKE.acc = 0; const [x, z] = bL2W(0, BG.zs + .2); if (v > .8 && B.sink <= 0) WAKE.pts.unshift({x, z, a: 0, w: 1.2, k: clamp(v / 10, .2, 1), dx: Math.cos(B.yaw), dz: -Math.sin(B.yaw)}); if (WAKE.pts.length > WAKE.n) WAKE.pts.pop(); }
  const pa = WAKE.mesh.geometry.attributes.position.array, ca = WAKE.mesh.geometry.attributes.color.array, ua = WAKE.mesh.geometry.attributes.uv.array;
  for (let i = 0; i < WAKE.n; i++) { const p = WAKE.pts[i] || WAKE.pts[WAKE.pts.length - 1];
    if (!p) { ca.fill(0); break; }
    if (WAKE.pts[i]) { p.a += dt; p.w += dt * 1.6; }
    const al = WAKE.pts[i] ? Math.max(0, 1 - p.a / 8) * p.k * (.6 + .4 * TOD.day) : 0;
    for (let s = 0; s < 2; s++) { const sg = s ? 1 : -1, x = p.x + p.dx * p.w * sg, z = p.z + p.dz * p.w * sg, o = (i * 2 + s); pa[o * 3] = x; pa[o * 3 + 1] = waveH(x, z, t) + .06; pa[o * 3 + 2] = z; ca[o * 4] = ca[o * 4 + 1] = ca[o * 4 + 2] = 1; ca[o * 4 + 3] = al * .9; ua[o * 2] = s; ua[o * 2 + 1] = i * .25; }
  }
  WAKE.mesh.material.color.setRGB(mix(1, .3, TOD.night), mix(1, 1.8, TOD.night), mix(1, 1.6, TOD.night)); WAKE.mesh.material.blending = TOD.night > .5 ? THREE.AdditiveBlending : THREE.NormalBlending; SPRAY.pts.material.color.setRGB(mix(.87, .4, TOD.night), mix(.92, 1.4, TOD.night), mix(.94, 1.3, TOD.night));
  WAKE.mesh.geometry.attributes.position.needsUpdate = WAKE.mesh.geometry.attributes.color.needsUpdate = WAKE.mesh.geometry.attributes.uv.needsUpdate = true;
  // bow spray grows with speed and slamming into waves
  B.slam = (B.slam || 0) * Math.exp(-dt * 3); const dp = (B.pitch - (B.lp ?? B.pitch)) / Math.max(dt, 1e-3); B.lp = B.pitch;
  G.slT = (G.slT || 0) - dt; if (dp < -.35 && v > 5 && G.slT <= 0 && B.sink <= 0 && (B.dep || 0) < .6) { G.slT = .35; const k = B.slam = clamp(-dp * .7, 0, 1) * clamp(v / 10, 0, 1); if (A.wPan) { burst(150, .8, .45 * k, .5, 'lowpass', A.wPan); burst(1100, .6, .2 * k, .7, 'bandpass', A.wPan); } if (P && P.ob && !inCabin()) G.shake = Math.max(G.shake || 0, .25 * k * Math.min(1, 14 / BG.L)); }
  if (v > 5 && B.sink <= 0 && Math.random() < dt * (v / 3 + Math.max(0, -dp) * 4 + G.storm * 4)) { for (const s of [-1, 1]) { const [x, z] = bL2W(s * BG.hw * .55, BG.zb + BG.L * .08); spray(x, waveH(x, z, t) + .3, z, 3 + (v > 9 ? 3 : 0), v * .35); } }
  const sa = SPRAY.pts.geometry.attributes.position.array;
  for (let i = 0; i < SPRAY.n; i++) { const p = SPRAY.p[i]; if (p.y < -900) { sa[i * 3 + 1] = -999; continue; } if (p.b) { p.vy = Math.min(p.vy + dt, 2.2); p.x += p.vx * dt + Math.sin(t * 9 + i) * dt * .2; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y > waveH(p.x, p.z, t)) p.y = -999; } else { p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < waveH(p.x, p.z, t) - .3) p.y = -999; } sa[i * 3] = p.x; sa[i * 3 + 1] = p.y; sa[i * 3 + 2] = p.z; }
  SPRAY.pts.geometry.attributes.position.needsUpdate = true; SPRAY.pts.material.opacity = .25 + .25 * TOD.day;
}
// ---------------- client side of the deep: draw it from the encounter state
const _lo = {}, _lk = new THREE.Vector4();
function stepLev(dt) {
  if (!LEV.body) return; const t = G.wt;
  const mw = G.maw, s = G.spines, lg = A.levG, near = !!P && (P.ob || Math.hypot(cam.position.x - B.x, cam.position.z - B.z) < BG.L * .5 + 30);
  if (lg && (mw || !s || s.leave != null)) lg.gain.setTargetAtTime(0, A.ctx.currentTime, .6);
  if (mw) {
    mw.t += dt; const u = clamp(mw.t / 4.2, 0, 1), y = mix(-48, -4, u * u);
    _lp.set(mw.x, y, mw.z + Math.sin(t) * .5); _lk.set(0, 1, 0, 1); levDraw(_lp, clamp(u * 1.4 - .3, 0, 1) * (mw.bite ? Math.max(0, 1 - (mw.t - mw.bite) * 4) : 1), _lk, t);
    if (mw.t > 9) { G.maw = null; LEV.hide(); } return;
  }
  if (!s) { if (LEV.on) LEV.hide(); return; }
  s.t += dt;
  if (s.leave != null) { const u = s.t - s.leave;
    if (s.qx == null) { s.qx = LEV.hp.x; s.qz = LEV.hp.z; s.qy = Math.min(LEV.hp.y, -1); const l = Math.hypot(LEV.ht.x, LEV.ht.z) || 1; s.hx = LEV.ht.x / l; s.hz = LEV.ht.z / l; }
    // it turns toward where it is going (away from the flare) and sinks
    if (s.gx != null) { const wx = s.gx - s.qx, wz = s.gz - s.qz, wl = Math.hypot(wx, wz) || 1, k = Math.min(1, dt * 2.2); s.hx = mix(s.hx, wx / wl, k); s.hz = mix(s.hz, wz / wl, k); const hl = Math.hypot(s.hx, s.hz) || 1; s.hx /= hl; s.hz /= hl; }
    s.qy -= dt * (4 + u * 6); s.qx += s.hx * dt * 9; s.qz += s.hz * dt * 9; _lp.set(s.qx, s.qy, s.qz); levDraw(_lp, .1, null, t); if (u > 4) { G.spines = null; LEV.hide(); } return; }
  const o = levPose(s.a, s.t, s.L || 9, _lo); _lp.set(o.x, o.y, o.z);
  let look = null; if (o.ph === 1) { _lk.set(B.x - o.x, B.heave + 1 - o.y * 1.6 - 4, B.z - o.z, clamp(o.u * 2.2, 0, 1)); const l = Math.hypot(_lk.x, _lk.y, _lk.z); _lk.x /= l; _lk.y /= l; _lk.z /= l; look = _lk; }
  levDraw(_lp, o.jaw, look, t);
  // its wash and throat move with its middle; a riser before it rears; the hull groans when it brushes past
  if (lg && A.levPan) { const mp = _lpts[23] || _lp; setPan(A.levPan, mp.x, Math.max(mp.y, -2), mp.z); lg.gain.setTargetAtTime(o.ph <= 2 && near ? .35 : 0, A.ctx.currentTime, o.ph <= 2 ? 1.2 : .6); }
  if (!s.rs && s.t > (s.L || 9) - 4.9) { s.rs = 1; if (near) Snd.riser(); }
  if (A.hcF && near && t - (s.ck ?? -9) > 2) for (let i = 2; i < LEV.NS; i += 5) { const q = _lpts[i]; if (!q || q.y < -10) continue; const [lx, lz] = bW2L(q.x, q.z), ex = Math.max(0, Math.abs(lx) - BG.hw), ez = Math.max(0, lz - BG.zs, BG.zb - lz); if (Math.hypot(ex, ez) < 6) { s.ck = t; tone(95, .1, 1.2, 'sawtooth', A.hcF, 70); G.shake = Math.max(G.shake || 0, .25); break; } }
  if (o.ph !== s.ph) { s.ph = o.ph;
    if (o.ph === 1) { Snd.roar(at(o.x, 2, o.z, 30)); G.shake = Math.max(G.shake || 0, .8); spray(o.x, .2, o.z, 40, 7); G.cine = 2.4; }
    if (o.ph === 2) { Snd.splash(at(o.x, 0, o.z, 20)); } }
  if (o.ph === 1 && o.u > .82 && !s.sp2) { s.sp2 = 1; spray(o.x, .2, o.z, 30, 6); }
  if (o.ph === 0 && Math.random() < dt * 6) { const k = 3 + (Math.random() * 18 | 0); if (_lpts[k] && _lpts[k].y > -3) spray(_lpts[k].x, .1, _lpts[k].z, 2, 2.5, .6); }
  if (o.ph === 3 && o.u > 4) { G.spines = null; LEV.hide(); }
}
// ---------------- shipyard: five new hulls with their own looks, cabins and perks, perks for the old ones, weathered plating
HULLS.push(
  {n: 'Dart speedboat', d: 'A tiny planing hull, the fastest thing afloat. Perk: hold Shift at the wheel to boost', cost: 1200, L: 9, W: 3, fb: 1.05, spd: 1.9, turn: 1.25, hold: 4, hp: .7, fuel: 1, col: 0xd84a1a, wh: [.3, .55], boost: 1, perk: 'Boost'},
  {n: 'Driftwood houseboat', d: 'A floating cottage with a wood stove, bunks and a porch. Perk: sleep in the bunk to skip the night', cost: 1500, L: 14, W: 6, fb: 1.1, spd: .7, turn: .7, hold: 14, hp: 1.3, fuel: 1, col: 0x2e4a34, wh: [.12, .62], sleep: 1, cosy: 1, perk: 'Sleep to dawn'},
  {n: 'Bulldog tug', d: 'A stubby harbour tug with a magnet winch. Perk: floating cargo nearby drifts to her and stows itself', cost: 2600, L: 18, W: 7, fb: 1.6, spd: 1.05, turn: 1, hold: 18, hp: 3, fuel: 2, col: 0x1a1a1a, wh: [.3, .56], magnet: 1, perk: 'Cargo magnet'},
  {n: 'Aurora expedition yacht', d: 'A 34 m blue-water yacht: fast, steady, a lounge and a hot tub. Perk: stabilised, and fish landed aboard sell for 25% more', cost: 9500, L: 34, W: 8, fb: 1.8, spd: 1.65, turn: .32, hold: 40, hp: 3.4, fuel: 3, col: 0xe8e8ee, wh: [.3, .55], eye: 4.2, big: 1, tiers: 2, fishK: 1.25, stab: .4, perk: 'Stabilised · fish +25%'},
  {n: 'Goliath supertanker', d: 'A 160 m ore carrier with a 400-slot hold and a bar on the bridge. Perk: nothing in the deep can shake her', cost: 30000, L: 160, W: 28, fb: 2.4, spd: 1.05, turn: .055, hold: 400, hp: 22, fuel: 12, col: 0x7a2a1a, wh: [.84, .95], eye: 26, big: 1, tiers: 5, nodeep: 1, perk: 'No deep attacks'});
Object.assign(HULLS[1], {net: 1, perk: 'Drag net', d: HULLS[1].d + '. Perk: her net fills with fish while she cruises over deep water'});
Object.assign(HULLS[3], {crane: 1, perk: 'Container crane', d: HULLS[3].d + '. Perk: her crane hauls floating cargo from twice as far'});
Object.assign(HULLS[5], {rov: 1, perk: 'Dive support', d: HULLS[5].d + '. Perk: divers near her use half the air'});
Object.assign(HULLS[6], {ice: 1, perk: 'Ice-class hull', d: HULLS[6].d + '. Perk: ice-class, she shoulders through icebergs'});
ENGV.push({f: [90, 210], lp: [900, 2600], am: .12, fr: 1.3, nz: .05, whine: [1900, 3800], g: .1}, {f: [30, 55], lp: [300, 700], am: .5, fr: .8, nz: .02, g: .1}, {f: [18, 34], lp: [170, 420], am: .8, fr: .4, g: .18},
  {f: [40, 90], lp: [420, 1100], am: .15, fr: .6, whine: [1100, 2100], g: .1}, {f: [8, 14], lp: [110, 220], am: .6, fr: .3, g: .2, hiss: 1});
KINDS.push('netfish'); NAMES.netfish = 'net of fish'; VALUE.netfish = 38; SZ.netfish = 2; CARRY.add('netfish');
const SHP = {heat: 0, oh: 0, on: 0, netT: 50, sprT: 0, hud: ''};
// weathered steel: plate seams, weld dots, rust runs from the scuppers under the deck edge (canvas top = deck edge), light grime; the clean one is for the yacht
function shpPlate(clean) {
  const k = clean ? 'shpClean' : 'hullPlate'; if (TX[k]) return TX[k];
  const c = cv(512, 256, (q, w, h) => {
    q.fillStyle = clean ? '#f4f4f2' : '#dcdcd6'; q.fillRect(0, 0, w, h);
    for (let i = 0; i < (clean ? 20 : 120); i++) { q.fillStyle = `rgba(${40 + Math.random() * 30},${36 + Math.random() * 20},30,${Math.random() * (clean ? .03 : .07)})`; q.beginPath(); q.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 60, 4 + Math.random() * 30, 0, 0, TAU); q.fill(); }
    q.strokeStyle = clean ? 'rgba(0,0,0,.06)' : 'rgba(30,26,22,.32)'; q.lineWidth = 2; q.beginPath();
    for (let y = 0; y <= h; y += 64) { q.moveTo(0, y); q.lineTo(w, y); } for (let r = 0; r < h / 64; r++) for (let x = (r % 2) * 32; x <= w; x += 64) { q.moveTo(x, r * 64); q.lineTo(x, r * 64 + 64); } q.stroke();
    if (!clean) { q.fillStyle = 'rgba(255,255,250,.28)'; for (let y = 0; y <= h; y += 64) for (let x = 3; x < w; x += 8) q.fillRect(x, y - 3.5, 1.5, 1.5); q.fillStyle = 'rgba(20,16,12,.3)'; for (let y = 0; y <= h; y += 64) for (let x = 3; x < w; x += 8) q.fillRect(x, y + 2, 1.5, 1.5);
      for (let i = 0; i < 16; i++) { const x = Math.random() * w, l = 30 + Math.random() * 110, gr = q.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, 'rgba(110,52,18,.55)'); gr.addColorStop(1, 'rgba(110,52,18,0)'); q.fillStyle = gr; q.fillRect(x, 0, 2 + Math.random() * 4, l); q.fillStyle = 'rgba(15,10,8,.7)'; q.fillRect(x - 3, 2, 9, 4); }
      for (let i = 0; i < 10; i++) { const x = Math.random() * w, y = Math.floor(Math.random() * 4) * 64, l = 14 + Math.random() * 40, gr = q.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(120,60,20,.4)'); gr.addColorStop(1, 'rgba(120,60,20,0)'); q.fillStyle = gr; q.fillRect(x, y, 2 + Math.random() * 2, l); } }
    noiseFill(q, w, h, clean ? 5 : 14); });
  return (TX[k] = tex(c));
}
// per-class looks, cabins and kit; ph 0 runs after the class extras, ph 1 after a big hull's tiers (X.lv, X.TH, X.sz0, X.sz1, X.top)
function shpExtras(cls, X, ph) {
  const {g, H, L, hw, fb, zs, zb, wz0, wz1, ww, hh, S, add, box, cyl, whiteM, darkM, steel, yel, glass} = X, zm = (wz0 + wz1) / 2, ud = g.userData, wallM = X.wallM || whiteM, wd = S({map: TX.wood, color: 0x9a7a54, roughness: .75});
  const glowS = (c, s, x, y, z, o = 0) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending})); sp.scale.setScalar(s); sp.position.set(x, y, z); g.add(sp); return sp; };
  const seg = (m, x0, y0, z0, x1, y1, z1, r) => { const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0), o = add(new THREE.CylinderGeometry(r, r, l, 6), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize()); return o; };
  ud.shpFl = ud.shpFl || []; ud.shpNl = ud.shpNl || [];
  if (ph) { // big hulls: masthead over the top tier, deck floods, class tops
    const top = X.top; if (cls === 12) { cyl(steel, .08, .12, 4, 0, top + 2, X.sz0 + 2.5); ud.shpMh.position.set(0, top + 4.2, X.sz0 + 2.5); } else if (ud.shpFm) ud.shpMh.position.set(...ud.shpFm);
    for (const sd of [-1, 1]) ud.shpFl.push(glowS(0xffe2a8, 3.2 + L * .02, sd * ww * .7, fb + hh + 1.2, wz0 - .35));
    if (cls === 11) { // swept mast with radar domes
      const mz = X.sz0 + 3; for (const sd of [-1, 1]) seg(whiteM, sd * 1.2, top, mz + 2.5, sd * .25, top + 3.4, mz - .2, .1); box(whiteM, -1.2, 1.2, top + 3.3, top + 3.5, mz - .6, mz + .2);
      for (const sd of [-1, 1]) { add(new THREE.SphereGeometry(.42, 14, 10), whiteM, sd * .8, top + 3.9, mz - .2); cyl(whiteM, .06, .06, .4, sd * .8, top + 3.6, mz - .2); }
      ud.shpMh.position.set(0, top + 4.6, mz - .2); }
    if (cls === 12) { // bridge wings, a funnel with the company band, lifeboats in davits, a bar on the bridge
      const yb = top - X.TH, w4 = ww * (1 - (X.lv - 1) * .04), z0 = X.sz0 + (X.lv - 1) * .15;
      for (const sd of [-1, 1]) { const xa = sd * w4, xb = sd * (hw + .4), x0 = Math.min(xa, xb), x1 = Math.max(xa, xb); box(X.ss, x0, x1, yb - .3, yb, z0, z0 + 3.2); box(X.ss, x0, x1, yb, yb + 1.1, z0, z0 + .2); add(new THREE.BoxGeometry(x1 - x0, 1.2, .04), X.wm, (xa + xb) / 2, yb + 1.9, z0 + .6); box(X.ss, x0, x1, yb + 2.5, yb + 2.7, z0, z0 + 3.2); ud.shpNl.push(glowS(sd < 0 ? 0xff2020 : 0x20ff40, 1.6, xb, yb + 2.9, z0 + 1, .9)); }
      const fz = X.sz1 - 2 * (X.lv - 1) - 3.6; cyl(X.ss, 2.6, 3, 9, 0, yb + 4.5, fz, 0, 0, 16); cyl(S({color: 0x1a3a6a}), 2.62, 2.62, 1.6, 0, yb + 7, fz, 0, 0, 16); cyl(darkM, 2.64, 2.64, .8, 0, yb + 8.6, fz, 0, 0, 16); ud.shpSmoke = [0, yb + 9.2, fz];
      for (const sd of [-1, 1]) { const lx = sd * (ww + .9), ly = fb + hh + .12 + X.TH * 1.4, lz = (wz0 + wz1) / 2; const lb = add(new THREE.CapsuleGeometry(1.1, 5, 4, 10), S({color: 0xe86018, roughness: .6}), lx, ly, lz); lb.rotation.x = PI / 2; for (const dz of [-2.4, 2.4]) seg(steel, sd * ww, ly + 1.6, lz + dz, lx, ly + 1.4, lz + dz, .12); }
      const bz = z0 + 4, bm = S({color: 0x3a1a10, roughness: .4}); box(bm, -3, 3, yb, yb + 1.1, bz, bz + .7); box(S({color: 0x101010, roughness: .3, metalness: .5}), -3.05, 3.05, yb + 1.1, yb + 1.16, bz - .05, bz + .75);
      for (let i = 0; i < 9; i++) cyl(S({color: [0x2a6a2a, 0x8a3a1a, 0xc8b060][i % 3], roughness: .2}), .06, .06, .3, -2.4 + i * .6, yb + 1.31, bz + .35, 0, 0, 8); }
    shpPuffs(g, 3.2); return; }
  // every hull: a white masthead light; floods on long hulls
  ud.shpMh = glowS(0xfff6e8, 1.2 + L * .006, 0, fb + hh + 1.6, zm);
  if (cls === 2) ud.shpMh.position.set(0, fb + hh + 3.5, zm + .4); else if (cls === 3) { cyl(steel, .05, .07, 1.4, 0, fb + hh + 8.1, wz0 + .8); ud.shpMh.position.set(0, fb + hh + 8.9, wz0 + .8); }
  else if (cls === 10) { cyl(steel, .04, .06, 1.3, 0, fb + hh + 2.9, zm - .6); ud.shpMh.position.set(0, fb + hh + 3.65, zm - .6); }
  if (!H.big && L > 30) for (const sd of [-1, 1]) ud.shpFl.push(glowS(0xffe2a8, 3.6, sd * ww * .7, fb + hh + .8, wz0 - .35));
  if (H.big && L > 30 && cls !== 11 && cls !== 12) { const fz = mix(zb, wz0, .55), mh = 6 + L * .02; cyl(steel, .1, .14, mh, 0, fb + mh / 2, fz); ud.shpFl.push(glowS(0xffe2a8, 4 + L * .02, 0, fb + mh - .2, fz + .4)); ud.shpFm = [0, fb + mh + .4, fz]; }
  if (cls === 5) { // a lit dive cage hanging off the stern A-frame
    const cx = -2.4, cz = zs + 1.1, y0 = fb + .4, y1 = fb + 2.4, cm = S({color: 0xe8c020, roughness: .5});
    for (const [x, z] of [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]]) box(cm, cx + x - .04, cx + x + .04, y0, y1, cz + z - .04, cz + z + .04);
    for (const y of [y0, (y0 + y1) / 2, y1]) { box(cm, cx - .74, cx + .74, y - .03, y + .03, cz - .74, cz - .66); box(cm, cx - .74, cx + .74, y - .03, y + .03, cz + .66, cz + .74); box(cm, cx - .74, cx - .66, y - .03, y + .03, cz - .74, cz + .74); box(cm, cx + .66, cx + .74, y - .03, y + .03, cz - .74, cz + .74); }
    seg(steel, cx, fb + 5, zs - 1, cx, y1, cz, .02); add(new THREE.SphereGeometry(.09, 8, 6), S({color: 0xfff0d0, emissive: 0xfff0c0, emissiveIntensity: 2}), cx, y1 - .2, cz); ud.shpCage = glowS(0xbfe8ff, 2.6, cx, y1 - .3, cz, .5); }
  if (cls === 8) { // Dart: raked screen, T-top on four tubes, twin outboards, racing stripe, pennant, cooler
    const sm = S({color: 0x101418, roughness: .3}), sc = add(new THREE.BoxGeometry(ww * 2 - .1, 1.05, .03), glass, 0, fb + 1.45, wz0 - .4); sc.rotation.x = -.95; box(sm, -ww, ww, fb + .9, fb + 1.02, wz0 - .85, wz0);
    const tz0 = wz1 + .25, tz1 = Math.min(zs - .6, wz1 + 2.3), tx = Math.min(1.12, hw - .3); for (const sx of [-tx, tx]) { for (const tz of [tz0, tz1]) cyl(steel, .035, .035, 2.05, sx, fb + 1.03, tz, 0, 0, 8); seg(steel, sx, fb + 1.86, tz0, sx, fb + 1.86, tz1, .022); seg(steel, sx * .55, fb + 1.08, wz0 - .8, sx * .75, fb + 1.08, wz0 - 2.2, .02); }
    box(S({color: 0xf0f0ea, roughness: .5}), -tx - .15, tx + .15, fb + 2.05, fb + 2.14, tz0 - .2, tz1 + .25); box(S({color: 0xd84a1a}), -tx - .16, tx + .16, fb + 2.0, fb + 2.06, tz0 - .21, tz1 + .26);
    for (const sx of [-.72, .72]) { const om = S({color: 0x1a1a1e, roughness: .35, metalness: .3}); box(om, sx - .2, sx + .2, fb - .2, fb + .55, zs + .1, zs + .55); box(om, sx - .06, sx + .06, -.7, fb - .2, zs + .25, zs + .4); box(S({color: 0xd84a1a}), sx - .21, sx + .21, fb + .3, fb + .38, zs + .09, zs + .56); }
    const st = S({color: 0xf4f4f0}); for (const sd of [-1, 1]) for (let i = 2; i < 14; i++) { const za = mix(zb, zs, i / 16), zz = mix(zb, zs, (i + 1) / 16), xa = sd * (hullHW(za) + .012), xz = sd * (hullHW(zz) + .012), y = fb - .3 + (1 - i / 16) * .12, o = add(new THREE.BoxGeometry(.01, .1, Math.hypot(xz - xa, zz - za) + .02), st, (xa + xz) / 2, y, (za + zz) / 2); o.rotation.y = Math.atan2(xz - xa, zz - za); }
    cyl(steel, .012, .012, .9, tx, fb + 2.5, tz1 + .2); const pf = new THREE.BufferGeometry(); pf.setAttribute('position', new THREE.Float32BufferAttribute([0, .4, 0, 0, 0, 0, 0, .2, .55], 3)); pf.computeVertexNormals(); add(pf, S({color: 0xd84a1a, side: THREE.DoubleSide}), tx, fb + 2.5, tz1 + .2);
    box(S({color: 0x2a6ab0, roughness: .6}), -1.15, -.6, fb, fb + .4, zs - 1.3, zs - .85, 1); box(whiteM, -1.17, -.58, fb + .4, fb + .46, zs - 1.32, zs - .83); }
  if (cls === 9) { // Driftwood: pitched roof, chimney, flower boxes, a porch rail and chair, string lights; bunks, stove, table, shelves inside
    const rf = S({color: 0x6a2a20, roughness: .9}), yr = fb + hh + .12, rh = .95, a = Math.atan2(rh, ww + .3), rl = Math.hypot(rh, ww + .3), cb = S({map: TX.wood, color: 0xe8dcb8, roughness: .85, side: THREE.DoubleSide});
    for (const sd of [-1, 1]) { const r = add(new THREE.BoxGeometry(rl + .1, .08, wz1 - wz0 + .7), rf, sd * (ww + .3) / 2, yr + rh / 2, zm); r.rotation.z = -sd * a; }
    for (const zz of [wz0 - .3, wz1 + .2]) { const sh = new THREE.Shape(); sh.moveTo(-ww - .15, 0); sh.lineTo(ww + .15, 0); sh.lineTo(0, rh - .04); sh.lineTo(-ww - .15, 0); add(new THREE.ShapeGeometry(sh), cb, 0, yr, zz); }
    const cz = wz0 + 1.1, cx = ww - .45; box(S({color: 0x8a3a2a, roughness: .9}), cx - .2, cx + .2, yr, yr + rh + .7, cz - .2, cz + .2); box(darkM, cx - .24, cx + .24, yr + rh + .7, yr + rh + .8, cz - .24, cz + .24); ud.shpSmoke = [cx, yr + rh + .9, cz];
    const fbx = S({color: 0x7a5a3a, roughness: .9}); for (const sd of [-1, 1]) { box(fbx, sd * (ww + .02) - .1, sd * (ww + .02) + .1, fb + .88, fb + 1.04, zm - 1.6, zm + .6); for (let i = 0; i < 9; i++) add(new THREE.SphereGeometry(.07, 6, 5), S({color: [0xd83a5a, 0xf0d040, 0xe8e8f0][i % 3], roughness: .8}), sd * (ww + .02), fb + 1.1, zm - 1.5 + i * .26).castShadow = false; }
    const pr = S({color: 0xe8e4d8, roughness: .7}); for (const sd of [-1, 1]) { box(pr, sd < 0 ? -(hw - .25) : .6, sd < 0 ? -.6 : hw - .25, fb + .95, fb + 1.0, zs - .2, zs - .14); for (let x = .7; x < hw - .2; x += .45) box(pr, sd * x - .025, sd * x + .025, fb, fb + .95, zs - .2, zs - .15); }
    const ch = S({color: 0x2a6a8a, roughness: .9}); box(ch, .95, 1.5, fb + .3, fb + .36, zs - 1.15, zs - .45, 1); const bk = add(new THREE.BoxGeometry(.55, .55, .05), ch, 1.22, fb + .6, zs - .38); bk.rotation.x = -.35; for (const lx of [.98, 1.47]) for (const lz of [zs - 1.1, zs - .5]) box(wd, lx - .02, lx + .02, fb, fb + .3, lz - .02, lz + .02);
    const sl = S({color: 0x302010, emissive: 0xffc070, emissiveIntensity: .4, nc: 1}); ud.shpStr = sl; for (let i = 0; i <= 12; i++) { const t = i / 12, z = mix(wz1 + .25, zs - .3, t), x = hw - .35, y = yr - .05 - Math.sin(t * PI) * .35; add(new THREE.SphereGeometry(.035, 6, 4), sl, x, y, z).castShadow = false; add(new THREE.SphereGeometry(.035, 6, 4), sl, -x, y, z).castShadow = false; }
    // inside: bunks with quilts and pillows (the sleep spot), the stove with a kettle, a table for two, shelves with jars, a rug
    const bx0 = -ww + .14, bx1 = -ww + 1, bz0 = wz0 + .75, bz1 = bz0 + 2, q1 = S({color: 0xb0402a, roughness: 1}), q2 = S({color: 0x3a5a8a, roughness: 1}), pil = S({color: 0xf0ead8, roughness: 1});
    for (const [y, q] of [[fb + .38, q1], [fb + 1.28, q2]]) { box(wd, bx0, bx1, y - .1, y, bz0, bz1, y < fb + 1); box(q, bx0 + .03, bx1 - .03, y, y + .12, bz0 + .45, bz1 - .03); box(pil, bx0 + .12, bx1 - .12, y, y + .14, bz0 + .05, bz0 + .42); }
    for (const z of [bz0, bz1 - .06]) box(wd, bx1 - .06, bx1, fb, fb + 1.95, z, z + .06); box(wd, bx0, bx1, fb + 1.42, fb + 1.48, bz1 - .06, bz1);
    INTER.push({kind: 'shpbunk', boat: 1, lx: bx1 - .2, lz: (bz0 + bz1) / 2, ly: .7, r: 1.8, label: () => 'Sleep until dawn', go: () => act({a: 'shpsleep'}), on: () => !P.sw});
    const sx0 = ww - .78, sz0 = wz0 + .8, sv = S({color: 0x1a1a1a, roughness: .6, metalness: .4}); box(sv, sx0, ww - .18, fb, fb + .75, sz0, sz0 + .6, 1); const fw = add(new THREE.BoxGeometry(.02, .24, .34), S({color: 0x200800, emissive: 0xff6a20, emissiveIntensity: 1.1, nc: 1}), sx0 - .01, fb + .4, sz0 + .3); ud.shpStove = fw.material;
    cyl(sv, .07, .07, hh - .75, ww - .45, fb + .75 + (hh - .75) / 2, sz0 + .3); cyl(S({color: 0xc8c0b0, metalness: .6, roughness: .3}), .09, .11, .16, sx0 + .2, fb + .83, sz0 + .18, 0, 0, 10); cyl(darkM, .012, .012, .12, sx0 + .32, fb + .9, sz0 + .18, 0, PI / 3);
    const tz = Math.min(wz1 - 1.4, zm + 1.6); box(wd, .95, 1.65, fb + .72, fb + .76, tz - .4, tz + .4, 1); box(wd, 1.27, 1.33, fb, fb + .72, tz - .03, tz + .03); for (const dz of [-.62, .62]) { box(wd, 1.1, 1.5, fb + .42, fb + .46, tz + dz - .18, tz + dz + .18); box(wd, 1.1, 1.5, fb + .46, fb + .95, tz + dz + Math.sign(dz) * .15, tz + dz + Math.sign(dz) * .19); for (const lx of [1.13, 1.47]) box(wd, lx - .02, lx + .02, fb, fb + .42, tz + dz - .02, tz + dz + .02); }
    cyl(S({color: 0xe8e0d0}), .045, .04, .1, 1.2, fb + .81, tz - .1); cyl(S({color: 0xd8a040, emissive: 0x402000}), .04, .05, .12, 1.45, fb + .82, tz + .15);
    const shz0 = Math.max(bz1 + .3, zm + .4), shz1 = Math.min(wz1 - .5, shz0 + 1.4); for (const y of [fb + 1.15, fb + 1.55]) { box(wd, -ww + .14, -ww + .42, y, y + .04, shz0, shz1); for (let z = shz0 + .12; z < shz1 - .1; z += .22) cyl(S({color: [0xc89a40, 0x8a2a2a, 0x4a7a4a][Math.round(z * 7 + 9) % 3], roughness: .3}), .05, .05, .16, -ww + .28, y + .12, z, 0, 0, 8); }
    box(S({color: 0x8a4a2a, roughness: 1}), -.7, .7, fb, fb + .012, zm - 1, zm + 1); }
  if (cls === 10) { // Bulldog: tyre fenders, pilot house with wrap-around glass, fat funnel, towing bitts, winch drum, magnet boom
    const ty = S({color: 0x161616, roughness: .95}), n = Math.round(L / 1.5); for (const sd of [-1, 1]) for (let i = 1; i < n; i++) { const z = mix(zb + 1, zs - .4, i / n), t = add(new THREE.TorusGeometry(.3, .13, 6, 12), ty, sd * (hullHW(z) + .14), fb - .35, z); t.rotation.y = PI / 2; }
    { const bf = add(new THREE.CylinderGeometry(.42, .42, 1.3, 12), ty, 0, fb - .35, zb + .55); bf.rotation.z = PI / 2; const sf = add(new THREE.CylinderGeometry(.4, .4, hw * 1.6, 12), ty, 0, fb - .4, zs + .25); sf.rotation.z = PI / 2; }
    const yr = fb + hh + .12, pw = ww - .45, pz0 = wz0 + .3, pz1 = wz1 - 1.2, gm = S({color: 0x14202a, roughness: .08, metalness: .4}); box(wallM, -pw, pw, yr, yr + .8, pz0, pz1); box(wallM, -pw, pw, yr + 1.85, yr + 2.05, pz0 - .1, pz1 + .1); box(darkM, -pw - .2, pw + .2, yr + 2.05, yr + 2.15, pz0 - .35, pz1 + .2);
    box(gm, -pw + .02, pw - .02, yr + .8, yr + 1.85, pz0 + .02, pz1 - .02); for (const sx of [-pw + .05, pw - .05]) for (const zz of [pz0 + .05, pz1 - .05]) box(darkM, sx - .05, sx + .05, yr + .8, yr + 1.85, zz - .05, zz + .05);
    const fz = wz1 - .45; cyl(S({color: 0x222222, roughness: .5}), .62, .72, 2.8, 0, yr + 1.4, fz, 0, 0, 16); cyl(S({color: 0xb0201a}), .63, .66, .5, 0, yr + 2.1, fz, 0, 0, 16); cyl(darkM, .5, .5, .1, 0, yr + 2.82, fz, 0, 0, 14); ud.shpSmoke = [0, yr + 2.9, fz];
    const bt = S({color: 0x2a2a2a, metalness: .5, roughness: .5}); for (const sx of [-1.6, 1.6]) { cyl(bt, .16, .18, .55, sx, fb + .27, zs - 2.6, 0, 0, 10); box(bt, sx - .2, sx + .2, fb, fb + .55, zs - 2.8, zs - 2.4, 1); }
    const dz = zs - 1.35, dr = add(new THREE.CylinderGeometry(.42, .42, 1.6, 16), S({color: 0x6a1a14, metalness: .3}), 0, fb + .55, dz); dr.rotation.z = PI / 2; for (const sx of [-.85, .85]) box(steel, sx - .06, sx + .06, fb, fb + 1.05, dz - .5, dz + .5); BW.push({x0: -.9, x1: .9, z0: dz - .5, z1: dz + .5, y0: 0, y1: 1.05});
    const bx = hw - .7, bz = zs - 3.2; cyl(yel, .14, .2, 2.6, bx, fb + 1.3, bz); BW.push({x0: bx - .25, x1: bx + .25, z0: bz - .25, z1: bz + .25, y0: 0, y1: 2.6});
    const mg = new THREE.Group(); mg.position.set(bx, fb + 2.5, bz); g.add(mg); ud.shpMag = mg; const boom = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, 3.2), yel); boom.position.set(1.1, .55, 0); boom.rotation.set(0, PI / 2, .35, 'YXZ'); mg.add(boom);
    const hd = new THREE.Group(); hd.position.set(2.5, 1.05, 0); mg.add(hd); ud.shpMagH = hd; const cbl = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.4, 4), steel); cbl.position.y = -.7; hd.add(cbl); const ms = new THREE.Mesh(new THREE.CylinderGeometry(.48, .48, .22, 16), S({color: 0xe8701a, roughness: .5, metalness: .3})); ms.position.y = -1.5; hd.add(ms); const mr = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, .05, 16), darkM); mr.position.y = -1.62; hd.add(mr); }
  if (cls === 11) { // Aurora: hot tub with steam, sun loungers, swim platform, teak aft deck
    const tz = zs - 4.6, tm = S({color: 0xf6f6f4, roughness: .3}), tk = S({map: TX.wood, color: 0xb08a5a, roughness: .7}); box(tm, -1.5, 1.5, fb, fb + .62, tz - 1.4, tz + 1.4, 1); box(tk, -1.62, 1.62, fb + .62, fb + .68, tz - 1.52, tz + 1.52);
    const wm = new THREE.MeshStandardMaterial({color: 0x30c8d8, emissive: 0x0a5a68, emissiveIntensity: .6, roughness: .05, transparent: true, opacity: .82}), wp = add(new THREE.PlaneGeometry(2.7, 2.5), wm, 0, fb + .58, tz); wp.rotation.x = -PI / 2; wp.castShadow = false; ud.shpTub = wm;
    const sm = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffffff, transparent: true, opacity: .14, depthWrite: false})); sm.scale.set(3, 1.6, 1); sm.position.set(0, fb + 1.3, tz); g.add(sm); ud.shpSteam = sm;
    const lm = S({color: 0x2a3a5a, roughness: .9}); for (const sx of [-1.8, 1.8]) { const z0 = wz1 + 3.6, z1 = z0 + 1.9; box(whiteM, sx - .35, sx + .35, fb, fb + .28, z0, z1, 1); box(lm, sx - .32, sx + .32, fb + .28, fb + .36, z0 + .05, z1 - .5); const bkr = add(new THREE.BoxGeometry(.64, .08, .62), lm, sx, fb + .55, z1 - .3); bkr.rotation.x = .9; }
    box(tk, -hw + .7, hw - .7, -.2, -.06, zs + .05, zs + 1.5); for (const sx of [-hw + .9, hw - .9]) cyl(steel, .03, .03, 1.1, sx, .45, zs + 1.4, 0, 0, 6);
    box(tk, -hw + .35, hw - .35, fb + .005, fb + .02, wz1 + 3, zs - .3); }
  if (cls === 12) { // Goliath: forecastle with windlasses, bulbous bow, nine hatch covers, pipework and a catwalk, two deck cranes, mast lights every 40 m
    const hm = S({color: 0x2e4a3a, roughness: .7, metalness: .3}), pm = S({color: 0x9a8a5a, roughness: .6, metalness: .4}), cr = S({color: 0xd8a020, roughness: .55}), z0 = BDECK.z0, fc0 = zb + 3;
    for (let i = 0; i < 6; i++) { const za = mix(fc0, z0, i / 6), zz = mix(fc0, z0, (i + 1) / 6), w = hullHW(za) * .96; box(wallM, -w, w, fb, fb + 2.6, za, zz + .01); }
    box(S({color: 0x8a1a14, roughness: .8}), -hw * .8, hw * .8, fb + 2.6, fb + 2.68, z0 - 14, z0); for (const sx of [-4, 4]) { const wl = add(new THREE.CylinderGeometry(.9, .9, 2.2, 14), S({color: 0x2a5a3a, metalness: .4}), sx, fb + 3.6, z0 - 8); wl.rotation.z = PI / 2; box(darkM, sx - 1.3, sx + 1.3, fb + 2.68, fb + 3.2, z0 - 9, z0 - 7); }
    const bb = add(new THREE.SphereGeometry(3, 16, 10), S({color: 0x8a1a14, roughness: .7}), 0, -(.6 + fb * .7 + L * .045) * .62, zb + 4.5); bb.scale.set(.9, .8, 2.6);
    const hl = 6.5, cranes = []; let z = -37; for (let i = 0; i < 9; i++) { box(hm, -hw + 4, hw - 4, fb, fb + 1.4, z, z + hl, 1); for (let k = 1; k < 4; k++) box(hm, -hw + 4.05, hw - 4.05, fb + 1.4, fb + 1.48, z + k * hl / 4 - .06, z + k * hl / 4 + .06); z += hl + (i === 2 || i === 5 ? 4 : 1.5); if (i === 2 || i === 5) cranes.push(z - 2); }
    for (const sd of [-1, 1]) { const px = sd * (hw - 3.6); cyl(pm, .22, .22, 75.5, px, fb + .5, .75, PI / 2); cyl(pm, .12, .12, 75.5, px + sd * .4, fb + .35, .75, PI / 2); BW.push({x0: Math.min(px - .45, px + sd * .65), x1: Math.max(px - .45, px + sd * .65), z0: -37, z1: 38.5, y0: 0, y1: .8}); }
    box(steel, -.8, .8, fb + 2.6, fb + 2.68, -37, 38.5); for (let zz = -36; zz < 38; zz += 6) box(steel, -.04, .04, fb, fb + 2.6, zz, zz + .08);
    for (const cz of cranes) { cyl(cr, 1.3, 1.5, 7, 0, fb + 3.5, cz, 0, 0, 14); BW.push({x0: -1.5, x1: 1.5, z0: cz - 1.5, z1: cz + 1.5, y0: 0, y1: 7}); box(cr, -1.6, 1.6, fb + 7, fb + 9.4, cz - 1.2, cz + 1.6); const jb = add(new THREE.BoxGeometry(.9, .9, 24), cr, 0, fb + 15, cz + 9.5); jb.rotation.x = .75; cyl(darkM, .02, .02, 10, 0, fb + 11, cz + 17); }
    for (const mz of [-80, -40, 0, 40]) { if (mz < fc0) continue; const mx = mz < z0 ? 0 : hw - 2.2, my = mz < z0 ? fb + 2.6 : fb; cyl(steel, .12, .16, 9, mx, my + 4.5, mz); if (mz >= z0) BW.push({x0: mx - .18, x1: mx + .18, z0: mz - .18, z1: mz + .18, y0: 0, y1: 9}); ud.shpNl.push(glowS(0xfff2dc, 1.8, mx, my + 9.2, mz, 0)); } }
  if (ud.shpSmoke) shpPuffs(g, cls === 9 ? .45 : 1);
}
// chimney and funnel smoke: six recycled sprites in the boat group (boat-local, drift aft and up)
function shpPuffs(g, k) { const ud = g.userData; if (ud.shpPuff || !ud.shpSmoke) return; const s = [];
  for (let i = 0; i < 6; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x8e8c88, transparent: true, opacity: 0, depthWrite: false})); sp.visible = false; sp.userData.a = 99; g.add(sp); s.push(sp); }
  ud.shpPuff = {s, k, i: 0, t: 0}; }
function shpSmoke(ud, dt) { const pf = ud.shpPuff; if (!pf) return; const on = B.sink <= 0 && (B.driver || Math.abs(B.v) > .5), k = pf.k, life = 2.8, sm = ud.shpSmoke;
  if ((pf.t -= dt) <= 0 && on) { pf.t = .5 / (1 + Math.abs(B.thr) * 1.5); const sp = pf.s[pf.i++ % pf.s.length]; sp.userData.a = 0; sp.position.set(sm[0] + (Math.random() - .5) * .2 * k, sm[1], sm[2]); }
  else if (!on && pf.t <= 0) { pf.t = 1.4; const sp = pf.s[pf.i++ % pf.s.length]; sp.userData.a = 0; sp.position.set(sm[0], sm[1], sm[2]); }
  const dk = 1 - TOD.night * .55;
  for (const sp of pf.s) { const a = sp.userData.a; if (a >= life) { if (sp.visible) sp.visible = false; continue; } sp.userData.a = a + dt; sp.visible = true; const u = a / life;
    sp.position.y += dt * (1.1 + Math.abs(B.thr)) * k; sp.position.z += dt * (.5 + Math.abs(B.v) * .55); sp.position.x += dt * .25 * k;
    sp.scale.setScalar(k * (.6 + u * 2.6)); sp.material.opacity = .34 * (1 - u) * Math.min(1, a * 5) * dk; } }
// horns for the new hulls (Snd.shipHorn keeps the old voices for cls < 8)
function shpHorn(cls, p) {
  if (!A.on) return; const c = A.ctx, t0 = c.currentTime + .02, d = p || A.out;
  const v = (fs, type, t, dur, pk, ft, ff, q = .8) => { const f = c.createBiquadFilter(); f.type = ft; f.frequency.value = ff; f.Q.value = q; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + Math.min(.08, dur * .2)); g.gain.setValueAtTime(pk, t + dur * .75); g.gain.linearRampToValueAtTime(0, t + dur); f.connect(g); g.connect(d); for (const fr of fs) { const o = c.createOscillator(); o.type = type; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + dur + .05); } return g; };
  if (cls === 8) { v([1320], 'square', t0, .16, .05, 'bandpass', 1800, 1.2); v([990], 'square', t0 + .2, .22, .05, 'bandpass', 1500, 1.2); }
  else if (cls === 9) { for (const [r, k] of [[1, .12], [2.76, .05], [5.4, .025], [8.9, .012]]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 640 * r; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(k, t0 + .005); g.gain.exponentialRampToValueAtTime(.0001, t0 + 2.6 / r); o.connect(g); g.connect(d); o.start(t0); o.stop(t0 + 2.7); } v([262, 263], 'sawtooth', t0 + .9, .6, .06, 'lowpass', 1100); }
  else if (cls === 10) { v([110, 110.6, 165], 'sawtooth', t0, .5, .1, 'lowpass', 620); v([110, 110.6, 165], 'sawtooth', t0 + .7, .7, .1, 'lowpass', 620); }
  else if (cls === 11) v([220, 277.2, 329.6, 440, 440.8], 'sawtooth', t0, 1.8, .05, 'lowpass', 1500, .7);
  else { const g = v([41, 41.3, 51.9, 82.2, 82.6], 'sawtooth', t0, 5.4, .085, 'lowpass', 420, .7), dl = c.createDelay(2.5), fb = c.createGain(), lp = c.createBiquadFilter(), eo = c.createGain(); dl.delayTime.value = 1.6; fb.gain.value = .35; lp.type = 'lowpass'; lp.frequency.value = 520; eo.gain.value = .5; g.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eo); eo.connect(A.out); setTimeout(() => { try { eo.disconnect(); fb.disconnect(); } catch (e) {} }, 14000); }
}
// perks: Dart boost (host), trawler net, tug magnet, Goliath calm, yacht stabilisers and fish bonus, DSV air, houseboat sleep
function shpBoost(dt) { const H = HC(), drv = B.driver && PL.get(B.driver), on = !!(H.boost && B.sink <= 0 && drv && drv.seat && drv.in && drv.in[3] && B.thr > .05 && !SHP.oh);
  if (on) { SHP.heat += dt; if (SHP.heat >= 6) { SHP.heat = 6; SHP.oh = 1; } B.v += .4 * B.thr * (2.4 + B.up.engine * .7) * H.spd / Math.pow(H.L / 12.2, .6) * dt; } else { if (SHP.heat > 0 && B.thr > 0) { const lv = B.up.engine, vt = H.spd * Math.sqrt(B.thr * (2.4 + lv * .7) * (1 + lv * .25) / .028); if (B.v > vt) B.v = Math.max(vt, B.v - dt * 2.5); } SHP.heat = Math.max(0, SHP.heat - dt * .6); if (SHP.heat < 1.5) SHP.oh = 0; } SHP.on = on ? 1 : 0; }
function shpNet(dt) { if (!HC().net || B.sink > 0) return; const v = Math.abs(B.v); if (v < 1.5 || v > 6 || seaBed(B.x, B.z) >= -10) return; if ((SHP.netT -= dt) > 0) return; SHP.netT = 40 + CR() * 20; if (holdFits('netfish')) { B.hold.push('netfish'); emit({k: 'shpnet'}); save(); } }
function shpMagnet(dt) { if (!HC().magnet || B.sink > 0) return; let got = 0;
  for (let i = 0; i < G.floats.length; i++) { const f = G.floats[i]; if (!f) continue; const kind = KINDS[f[2]]; if (kind === 'bottle' || !CARRY.has(kind)) continue; const [lx, lz] = bW2L(f[0], f[1]), cx = clamp(lx, -BG.hw, BG.hw), cz = clamp(lz, BG.zb, BG.zs), d = Math.hypot(lx - cx, lz - cz); if (d > 35) continue;
    if (d < 4) { if (holdFits(kind)) { B.hold.push(kind); G.floats[i] = null; emit({k: 'shpmag', kd: f[2]}); got = 1; } continue; }
    const [wx, wz] = bL2W(cx, cz), dx = wx - f[0], dz = wz - f[1], l = Math.hypot(dx, dz) || 1, s = Math.min(2 * dt, d - 3.9); f[0] += dx / l * s; f[1] += dz / l * s; }
  if (got) save(); }
function shpNight(t) { t = ((t % 1) + 1) % 1; let i = 0; while (TODK[i + 1][0] < t) i++; const a = TODK[i], b = TODK[i + 1], u = (t - a[0]) / (b[0] - a[0]), el = mix(a[1], b[1], u * u * (3 - 2 * u)); return 1 - clamp((el + 22) / 18, 0, 1); } // TOD.night at time t (todAt's formula), valid on a host that does not render
function shpSleep(id) { const p = PL.get(id); if (!p || !G.on || !HC().sleep || p.dead || p.down) return; const now = performance.now() / 1000; if ((p.shpT || 0) > now) return; p.shpT = now + 1;
  const why = !p.ob ? 'Get aboard first.' : !(shpNight(G.tod) > .25 && G.tod < .83) ? 'It is not night yet.' : alive().some(q => !q.ob) ? 'Everyone needs to be aboard.' : G.enc ? 'Not while something circles the boat.' : '';
  if (why) { emit({k: 'nope', id, why}); return; } G.tod = .84; G.enc = null; G.deepT = Math.max(G.deepT ?? 0, 90); emit({k: 'shpslp'}); save(); }
function shpFade() { let e = $('shpFade'); if (!e) { e = document.createElement('div'); e.id = 'shpFade'; document.body.appendChild(e); }
  G.shpSlp = performance.now(); e.style.transition = 'opacity .6s'; e.style.opacity = 1; clearTimeout(G.shpFT); G.shpFT = setTimeout(() => { e.style.transition = 'opacity 1.2s'; e.style.opacity = 0; }, 1300); }
function shpLook(dt) { // client: stabilisers, night lights, boost spray and HUD, steam, stove, magnet sway
  const ud = BOAT && BOAT.userData; if (!ud) return; const H = HC(), n = TOD.night, t = G.wt;
  if (H.stab) { B.pitch *= H.stab; B.roll *= H.stab; BOAT.rotation.set(B.pitch, B.yaw, B.roll, 'YXZ'); }
  if (ud.shpMh) ud.shpMh.material.opacity = Math.min(1, n * 1.1 + G.storm * .3); for (const s of ud.shpFl || []) s.material.opacity = n * .75; for (const s of ud.shpNl || []) s.material.opacity = Math.max(.25, n);
  if (ud.shpCage) ud.shpCage.material.opacity = .25 + n * .6; if (ud.shpStove) ud.shpStove.emissiveIntensity = .8 + Math.random() * .5; if (ud.shpStr) ud.shpStr.emissiveIntensity = .3 + n * 1.2 + Math.sin(t * 1.7) * .08;
  if (ud.shpTub) ud.shpTub.emissiveIntensity = .4 + n * .8; if (ud.shpSteam) { ud.shpSteam.material.opacity = .08 + .08 * (1 - TOD.day) + Math.sin(t * .8) * .03; ud.shpSteam.position.y = BDECK.y + 1.3 + Math.sin(t * .5) * .15; }
  if (ud.shpMagH) ud.shpMagH.rotation.x = Math.sin(t * 1.3) * .06 - B.v * .01 + B.pitch;
  if (H.fishK && !(GLOWS[B.up.glow || 0] || {}).c) { ud.glow.material.color.setHex(0x30c8ff); ud.glow.material.opacity = (.5 - .35 * TOD.day) * (B.dep > .5 ? 0 : 1); }
  shpSmoke(ud, dt);
  if (SHP.on && (SHP.sprT -= dt) <= 0) { SHP.sprT = .07; const [x, z] = bL2W(0, BG.zb + 1.2); spray(x, .3, z, 2, 1.6); }
  const sh = !!(H.boost && P && P.seat), hs = sh ? (SHP.oh ? 'o' : '') + Math.round(SHP.heat * 10) : '';
  if (hs !== SHP.hud) { SHP.hud = hs; let e = $('shpBoost'); if (!e && $('boatHud')) { e = document.createElement('div'); e.id = 'shpBoost'; e.innerHTML = 'BOOST <u><i></i></u>'; $('boatHud').appendChild(e); }
    if (e) { e.style.display = sh ? '' : 'none'; const i = e.querySelector('i'); i.style.width = (100 - SHP.heat / 6 * 100) + '%'; i.style.background = SHP.oh ? '#c84a2a' : '#f0a030'; } }
}
{ const st = document.createElement('style'); st.id = 'st-shp'; st.textContent = '#shpFade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40}'; document.head.appendChild(st); }
{ const f0 = boatStep; boatStep = function (dt) { const r = f0.apply(this, arguments); shpBoost(dt); return r; }; }
{ const f0 = boatPose; boatPose = function (dt) { const r = f0.apply(this, arguments); shpLook(dt); return r; }; }
{ const f0 = hostStep; hostStep = function (dt) { if (HC().nodeep) { if (G.enc) { G.enc = null; emit({k: 'deepgone'}); } G.deepT = Math.max(G.deepT ?? 0, 60); } const r = f0.apply(this, arguments); shpNet(dt); shpMagnet(dt); return r; }; }
{ const f0 = hostAct; hostAct = function (id, m) { if (m && m.a === 'shpsleep') return shpSleep(id); return f0.apply(this, arguments); }; }
{ const f0 = applyEv; applyEv = function (e) { const r = f0.apply(this, arguments);
  if (e.k === 'shpslp') { shpFade(); showMsg('You sleep until dawn. The stove ticks as it cools.', '', 5); }
  else if (e.k === 'shpnet') { if (P && P.ob) { (Snd.stow || Snd.coin)(); showMsg('+ net of fish', '', 2); } }
  else if (e.k === 'shpmag') { if (P && P.ob) { (Snd.stow || Snd.coin)(); showMsg('+ ' + (NAMES[KINDS[e.kd]] || 'cargo'), '', 1.5); } }
  return r; }; }
{ const f0 = packSnap; packSnap = function () { const s = f0.apply(this, arguments); if (HC().boost) s.shp = [Math.round(SHP.heat * 10), SHP.on, SHP.oh]; return s; }; }
{ const f0 = applySnap; applySnap = function (s) { const r = f0.apply(this, arguments); if (s.shp) { SHP.heat = s.shp[0] / 10; SHP.on = s.shp[1]; SHP.oh = s.shp[2]; } else SHP.on = 0; return r; }; }
{ const f0 = stepPlayer; stepPlayer = function (dt) { const r = f0.apply(this, arguments); if (!P) return r; if (P.seat && P.in) P.in[3] = K.ShiftLeft || K.ShiftRight ? 1 : 0;
  if (P.sw && (P.dv || 0) > .4 && HC().rov && B.sink <= 0 && Math.hypot(P.x - B.x, P.z - B.z) < 80) { const su = SUIT[(P.own && P.own.suit) || 0] || SUIT[0]; P.air = Math.min(1, (P.air ?? 1) + dt / su.air / 2); } return r; }; }
{ const f0 = aInit; aInit = function () { const r = f0.apply(this, arguments); if (A.ctx && Snd.shipHorn && !Snd.shipHorn.shp) { const h0 = Snd.shipHorn, h = (cls, p) => (cls || 0) >= 8 ? shpHorn(cls, p) : h0(cls, p); h.shp = 1; Snd.shipHorn = h; } return r; }; }
{ const f0 = fishVal; fishVal = function (k, x, z) { let v = f0.apply(this, arguments); const H = HC(); if (H.fishK && B.sink <= 0) { const [lx, lz] = bW2L(x, z); if (Math.abs(lx) < BG.hw + .6 && lz > BG.zb - .6 && lz < BG.zs + .6) v = Math.round(v * H.fishK); } return v; }; }
{ const f0 = itemMesh; itemMesh = function (kind) { const g = f0.apply(this, arguments); if (kind !== 'netfish' || g.children.length) return g;
  const nm = new THREE.MeshStandardMaterial({color: 0x3a5a3a, roughness: .95}), fm = new THREE.MeshStandardMaterial({color: 0xb8c4cc, roughness: .25, metalness: .5}), b = new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 8), nm); b.scale.set(1.3, .75, 1); b.position.y = .22; g.add(b);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(.05, .22, 5), fm); f.position.set(Math.cos(i * 1.7) * .3, .3 + (i % 2) * .08, Math.sin(i * 1.7) * .22); f.rotation.set(i, i * 2, PI / 2 + i * .4); g.add(f); }
  const tie = new THREE.Mesh(new THREE.TorusGeometry(.1, .025, 5, 10), new THREE.MeshStandardMaterial({color: 0xc8a050, roughness: .9})); tie.position.y = .42; tie.rotation.x = PI / 2; g.add(tie); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }; }
// ---------------- the derelict MS Serenade, far to the north. Two decks you can explore, and the Steward.
const CRZ = {x: -250, z: 2350, D1: 9, D2: 13}, CN = [], CWL = [];
const inCruise = (x, z, y = 99) => Math.abs(x - CRZ.x) < 15 && z > CRZ.z - 68 && z < CRZ.z + 62 && y > 6;
function buildCruise() {
  const X = CRZ.x, Z = CRZ.z, D1 = CRZ.D1, D2 = CRZ.D2, w0 = WALLS.length;
  // hull: plan shape extruded, dirty white topsides over a rusted lower hull (caps hidden so the deck shows)
  const sh = new THREE.Shape(); sh.moveTo(-14, 59.6); sh.quadraticCurveTo(0, 60.75, 14, 59.6); sh.lineTo(14, -28); sh.quadraticCurveTo(12, -58, 0, -68); sh.quadraticCurveTo(-12, -58, -14, -28); sh.closePath();
  const hull = (y0, y1, m) => { const g = new THREE.ExtrudeGeometry(sh, {depth: y1 - y0, bevelEnabled: false}); g.rotateX(PI / 2); g.translate(X, y1, Z); const o = new THREE.Mesh(g, [new THREE.MeshBasicMaterial({visible: false}), m]); o.receiveShadow = true; o.castShadow = true; scene.add(o); };
  hull(-8, 2.5, new THREE.MeshStandardMaterial({map: TX.rustH, color: 0x5a3a30, roughness: .8, metalness: .3, side: THREE.DoubleSide}));
  hull(2.5, D1 + 1.1, extSerHull(sh, X, Z));
  for (let i = 0; i < 3; i++) { wbox('white', X, D2 + 13.3 + i * 2.6, Z - 25.5, 18 - i * 3, 2.6, 30 - i * 5); for (const sx of [-1, 1]) wbox('dark', X + sx * (9 - i * 1.5 + .02), D2 + 13.5 + i * 2.6, Z - 25.5, .04, .7, 28 - i * 5); }
  // round portholes, a fifth of them lit at night: extSerHull
  // deck 1 (main), with a narrowing bow
  slab(X - 13.6, X + 13.6, Z - 28, Z + 59.5, D1, 'planks'); slab(X - 11.5, X + 11.5, Z - 46, Z - 28, D1, 'planks'); slab(X - 7, X + 7, Z - 60, Z - 46, D1, 'planks');
  for (const sx of [-1, 1]) { rail(X + sx * 13.6 - .05, X + sx * 13.6 + .05, Z - 28, Z + 59.5, D1, 'white'); rail(X + sx * 11.5 - .05, X + sx * 11.5 + .05, Z - 46, Z - 28, D1, 'white'); rail(X + sx * 7 - .05, X + sx * 7 + .05, Z - 60, Z - 46, D1, 'white'); }
  rail(X - 13.6, X - 1.1, Z + 59.4, Z + 59.6, D1, 'white'); rail(X + 1.1, X + 13.6, Z + 59.4, Z + 59.6, D1, 'white'); rail(X - 7, X + 7, Z - 60.1, Z - 59.9, D1, 'white');
  rail(X - 13.6, X - 11.5, Z - 28.1, Z - 27.9, D1, 'white'); rail(X + 11.5, X + 13.6, Z - 28.1, Z - 27.9, D1, 'white'); rail(X - 11.5, X - 7, Z - 46.1, Z - 45.9, D1, 'white'); rail(X + 7, X + 11.5, Z - 46.1, Z - 45.9, D1, 'white');
  // superstructure shell on deck 1: x -10..10, z -45..45, doors fore and aft only
  const sw = (x0, x1, z0, z1, k = 'white') => { bx(k, x0, x1, D1, D2 - .3, z0, z1); WALLS.push({x0, x1, z0, z1, y0: D1, y1: D2, see: true}); };
  for (const sx of [-1, 1]) sw(X + (sx < 0 ? -10.2 : 10), X + (sx < 0 ? -10 : 10.2), Z - 45, Z + 45);
  sw(X - 10, X - 1.1, Z - 45.2, Z - 45); sw(X + 1.1, X + 10, Z - 45.2, Z - 45); sw(X - 10, X - 1.1, Z + 45, Z + 45.2); sw(X + 1.1, X + 10, Z + 45, Z + 45.2);
  bx('white', X - 1.1, X + 1.1, D1 + 2.3, D2 - .3, Z - 45.2, Z - 45); bx('white', X - 1.1, X + 1.1, D1 + 2.3, D2 - .3, Z + 45, Z + 45.2);
  for (let i = 0; i < 18; i++) for (const sx of [-1, 1]) wbox('glass', X + sx * 10.22, D1 + 2, Z - 42 + i * 5, .04, .8, 1.6);
  // twelve staterooms off a carpeted corridor; the one nearest the bow is the captain's
  bx('carpet', X - 1.4, X + 1.4, D1, D1 + .02, Z - 45, Z - 8);
  for (let i = 0; i < 6; i++) { const z = Z - 41.9 + i * 5.6; const a = building('state', i === 0 ? "Captain's quarters" : 'Stateroom ' + (101 + i * 2), X - 5.7, z, D1, 'e'); a.cruise = 1; if (i === 0) a.capt = 1; const b = building('state', 'Stateroom ' + (102 + i * 2), X + 5.7, z, D1, 'w'); b.cruise = 1; }
  // atrium: open two decks, twin grand staircases up to deck 2
  bx('carpet', X - 10, X + 10, D1, D1 + .02, Z - 8, Z + 45);
  for (const sx of [-1, 1]) ramp(X + sx * 8.6 - 1, X + sx * 8.6 + 1, Z - 8, Z + 8, D1, D2, 'z+', 'carpet');
  wbox('brass', X, D1 + 3.6, Z, .1, 1.2, .1); { const ch = new THREE.Mesh(new THREE.TorusGeometry(1.4, .08, 6, 24), new THREE.MeshStandardMaterial({color: 0xb8902a, metalness: .8, roughness: .3})); ch.rotation.x = PI / 2.3; ch.position.set(X + .6, D1 + .3, Z + 1); scene.add(ch); }
  // ballroom: tables, a grand piano, the stage with the music box
  for (let i = 0; i < 8; i++) { const tx = X + (i % 2 ? 4.5 : -4.5), tz = Z + 14 + Math.floor(i / 2) * 6; wbox('wood', tx, D1 + .75, tz, 1.6, .06, 1.6); wbox('dark', tx, D1 + .38, tz, .12, .75, .12); WALLS.push({x0: tx - .8, x1: tx + .8, z0: tz - .8, z1: tz + .8, y0: D1, y1: D1 + .8, see: false}); spot('cruise', tx + .3, D1 + .8, tz - .2); for (const c of [-1, 1]) wbox('red', tx + c * 1.1, D1 + .45, tz, .45, .9, .45, .4 * c); }
  WALLS.push({x0: X - 8.6, x1: X - 3.5, z0: Z + 43.9, z1: Z + 45, y0: D1, y1: D1 + 1.8, see: false});
  for (let i = 0; i < 4; i++) { const sx = X - 8 + i * 1.3; wbox('dark', sx, D1 + .8, Z + 44.3, 1, 1.6, .7); wbox('glassL', sx, D1 + 1.25, Z + 43.94, .7, .45, .02); wbox('red', sx, D1 + 1.75, Z + 44.3, 1, .25, .7); }
  wbox('dark', X, D1 + .5, Z + 39, 8, 1, 4); WALLS.push({x0: X - 4, x1: X + 4, z0: Z + 37, z1: Z + 41, y0: D1, y1: D1 + 1, see: false});
  wbox('dark', X - 2.5, D1 + 1.5, Z + 38.5, 2.2, .5, 1.5); wbox('wood', X + 2.2, D1 + 1.15, Z + 38.5, .3, .3, .3); spot('cruise', X + 2.6, D1 + 1, Z + 37.5); CRZ.box = [X + 2.2, D1 + 1.3, Z + 38.5];
  // deck 2: open lido deck around a hole over the atrium, a tower, the pool and the funnel
  slab(X - 12, X + 12, Z - 46, Z - 8, D2, 'planks'); slab(X - 12, X + 12, Z + 8, Z + 48, D2, 'planks'); slab(X - 12, X - 10, Z - 8, Z + 8, D2, 'planks'); slab(X + 10, X + 12, Z - 8, Z + 8, D2, 'planks');
  rail(X - 10, X - 9.6, Z - 8.1, Z - 7.9, D2, 'white'); rail(X - 7.6, X + 7.6, Z - 8.1, Z - 7.9, D2, 'white'); rail(X + 9.6, X + 10, Z - 8.1, Z - 7.9, D2, 'white'); rail(X - 7.6, X + 7.6, Z + 7.9, Z + 8.1, D2, 'white');
  for (const sx of [-1, 1]) { rail(X + sx * 10 - .05, X + sx * 10 + .05, Z - 8, Z + 8, D2, 'white'); rail(X + sx * 12 - .05, X + sx * 12 + .05, Z - 46, Z + 48, D2, 'white'); }
  rail(X - 12, X + 12, Z + 47.9, Z + 48.1, D2, 'white');
  const tw = (x0, x1, z0, z1, y1, k = 'white') => { bx(k, x0, x1, D2, y1, z0, z1); WALLS.push({x0, x1, z0, z1, y0: D2, y1, see: true}); };
  tw(X - 7, X + 7, Z - 37, Z - 14, D2 + 12); for (let r = 0; r < 4; r++) for (const sx of [-1, 1]) wbox(r === 1 && sx > 0 ? 'extPortW' : 'glass', X + sx * 7.02, D2 + 1.8 + r * 2.8, Z - 25.5, .04, .9, 21);
  WALLS.push({x0: X - 3.5, x1: X + 3.5, z0: Z + 36, z1: Z + 44, y0: D2, y1: D2 + 15, see: true}); { const f = new THREE.CylinderGeometry(4, 4.3, 15, 20); f.scale(.65, 1, 1); put('red', f, X, D2 + 7.5, Z + 40, 0, .08); const t = new THREE.CylinderGeometry(4.04, 4.1, 2.4, 20, 1, true); t.scale(.65, 1, 1); t.translate(0, 6.3, 0); put('dark', t, X, D2 + 7.5, Z + 40, 0, .08); put('dark', new THREE.CircleGeometry(3.9, 20).scale(.63, 1, 1), X, D2 + 15, Z + 40.6, 0, -PI / 2 + .08); }
  bx('extPool', X - 5, X + 5, D2 - .3, D2 + .01, Z + 16, Z + 30); for (const [x0, x1, z0, z1] of [[-5.2, 5.2, 15.8, 16], [-5.2, 5.2, 30, 30.2], [-5.2, -5, 16, 30], [5, 5.2, 16, 30]]) { bx('white', X + x0, X + x1, D2, D2 + .5, Z + z0, Z + z1); WALLS.push({x0: X + x0, x1: X + x1, z0: Z + z0, z1: Z + z1, y0: D2, y1: D2 + 1, see: false}); }
  WALLS.push({x0: X - 5, x1: X + 5, z0: Z + 16, z1: Z + 30, y0: D2, y1: D2 + 1, see: false});
  { const w = new THREE.Mesh(new THREE.PlaneGeometry(10, 14), new THREE.MeshStandardMaterial({color: 0x1a7a9a, roughness: .08, metalness: .1, transparent: true, opacity: .85})); w.rotation.x = -PI / 2; w.position.set(X, D2 + .04, Z + 23); scene.add(w); }
  extLido(X, Z, D2); // backed deck chairs (with colliders) and the lifeboats under davits
  // (lifeboats: extLido)
  const br = building('bridge', 'Bridge', X, Z - 43, D2, 'n'); br.cruise = 1; CRZ.bridge = br;
  spot('key', X - 5.7 - 1.5, D1 + .8, Z - 41.9 + 1);
  // the way up from the sea
  for (let y = -1.2; y < D1; y += .35) wbox('yellow', X, y, Z + 60.4, .6, .05, .05);
  INTER.push({kind: 'ladder', x: X, y: 0, z: Z + 61, r: 3.5, top: [X, D1, Z + 58.2], label: () => 'Climb the boarding ladder', on: () => P.sw});
  POIS.push({n: 'MS Serenade', x: X, z: Z, r: 90, cruise: 1});
  OBST.push({x0: X - 14.4, x1: X + 14.4, z0: Z - 30, z1: Z + 60.4}, {x0: X - 13.6, x1: X + 13.6, z0: Z - 40, z1: Z - 30}, {c: 1, x: X, z: Z - 48, r: 11.5}, {c: 1, x: X, z: Z - 58, r: 8}, {c: 1, x: X, z: Z - 64, r: 4});
  for (let i = 0; i < 9; i++) CRZ.reds = (CRZ.reds || []).concat([[X + (i % 3 - 1) * 6, (i < 6 ? D1 : D2) + 3, Z - 40 + i * 10]]);
  for (let i = w0; i < WALLS.length; i++) CWL.push(WALLS[i]);
  // nav nodes for the Steward: a 2.5 m grid on both decks and the stairs, joined where nothing is in the way
  const key = new Set();
  for (const py of [D1 + .6, D2 + .6]) for (let x = -12; x <= 12; x += 2.5) for (let z = -58; z <= 58; z += 2.5) {
    const wx = X + x, wz = Z + z, f = floorAt(wx, wz, py, true); if (!f || f.y < py - 2) continue;
    if (CWL.some(w => wx > w.x0 - .15 && wx < w.x1 + .15 && wz > w.z0 - .15 && wz < w.z1 + .15 && w.y0 < f.y + 1.6 && w.y1 > f.y + .2)) continue;
    const k = x + ',' + z + ',' + Math.round(f.y); if (key.has(k)) continue; key.add(k); CN.push({x: wx, y: f.y, z: wz, nb: []}); }
  for (const sx of [-1, 1]) for (let z = -9.2; z <= 9.3; z += 1.6) { const y = z < -8 ? D1 : z > 8 ? D2 : mix(D1, D2, (z + 8) / 16); CN.push({x: X + sx * 8.6, y, z: Z + z, nb: [], st: 1}); }
  for (let i = 0; i < CN.length; i++) for (let j = i + 1; j < CN.length; j++) { const a = CN[i], b = CN[j]; if (Math.abs(a.y - b.y) > 1.3 || Math.abs(a.x - b.x) > 2.6 || Math.abs(a.z - b.z) > 2.6) continue;
    if ((a.st || b.st) && !(a.st && b.st) && Math.abs(a.y - b.y) > .35) continue;
    const y = Math.max(a.y, b.y) + 1; if (CWL.some(w => !(w.y1 < y - .7 || w.y0 > y + .5) && segRect(a.x, a.z, b.x, b.z, {x0: w.x0 - .25, x1: w.x1 + .25, z0: w.z0 - .25, z1: w.z1 + .25}))) continue; a.nb.push(j); b.nb.push(i); }
  { const r0 = cNear(X, D1, Z + 20), seen = new Set([r0]), q = [r0]; while (q.length) { const c = q.pop(); for (const k of CN[c].nb) if (!seen.has(k)) { seen.add(k); q.push(k); } } CN.forEach((n, i) => { if (!seen.has(i)) n.nb = []; }); CN.ok = [...seen]; }
}
function cNear(x, y, z) { let b = -1, bd = 1e9; for (let i = 0; i < CN.length; i++) { const n = CN[i], d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3; if (d < bd && n.nb.length) { bd = d; b = i; } } return b; }
function cPath(a, b) {
  if (a < 0 || b < 0) return null; const g = new Map([[a, 0]]), from = new Map(), open = [a], h = i => Math.hypot(CN[i].x - CN[b].x, CN[i].z - CN[b].z) + Math.abs(CN[i].y - CN[b].y);
  let it = 0; while (open.length && it++ < 3000) { let bi = 0; for (let k = 1; k < open.length; k++) if (g.get(open[k]) + h(open[k]) < g.get(open[bi]) + h(open[bi])) bi = k; const c = open.splice(bi, 1)[0];
    if (c === b) { const p = [c]; let q = c; while (from.has(q)) { q = from.get(q); p.unshift(q); } return p.map(i => [CN[i].x, CN[i].y, CN[i].z]); }
    for (const n of CN[c].nb) { const ng = g.get(c) + Math.hypot(CN[n].x - CN[c].x, CN[n].z - CN[c].z) + Math.abs(CN[n].y - CN[c].y); if (!g.has(n) || ng < g.get(n)) { g.set(n, ng); from.set(n, c); if (!open.includes(n)) open.push(n); } } }
  return null;
}
// the Steward: host brain
const STW = new THREE.Group(), SJ = {fing: []};
const STS = {x: CRZ.x, y: CRZ.D1, z: CRZ.z + 30, yaw: 0, state: 'roam', spd: 0, path: [], hp: 300, idle: 2, rep: 0, aware: 0, ph: 0, jit: 0, jr: 0};
function stwGo(x, y, z) { const p = cPath(cNear(STS.x, STS.y, STS.z), cNear(x, y, z)); STS.path = p ? p.slice(1) : []; STS.goal = [x, y, z]; }
function stwDown(p) { if (p.down || p.dead) return; p.down = true; p.bleed = typeof bleedFor === 'function' ? bleedFor(p) : D.bleed; p.hd = -1; p.seat = 0; if (B.driver === p.id) B.driver = null; dropCarry(p); STS.yaw = Math.atan2(-(p.x - STS.x), -(p.z - STS.z)); emit({k: 'down', id: p.id, how: 'caught', st: 1}); STS.state = 'flee'; STS.flee = 7; const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; if (n) stwGo(n.x, n.y, n.z); }
function stwHear(x, y, z, r) { if (!inCruise(x, z, y) || ['chase', 'flee', 'dead', 'gone'].includes(STS.state)) return; if (Math.hypot(x - STS.x, z - STS.z) + Math.abs(y - STS.y) * 2 > r * 1.4) return; STS.state = 'inv'; STS.idle = 0; stwGo(x, y, z); }
function stepSteward(dt) {
  const S = STS; if (!CN.length) return;
  const near = alive().some(p => Math.hypot(p.x - CRZ.x, p.z - CRZ.z) < 260); if (!near && S.state !== 'gone') { S.spd = 0; return; }
  if (S.state === 'dead') { S.spd = 0; S.deadT -= dt; if (S.deadT <= 0) { S.state = 'gone'; S.goneT = 150; } return; }
  if (S.state === 'gone') { S.goneT -= dt; if (S.goneT <= 0) { const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; Object.assign(S, {x: n.x, y: n.y, z: n.z, state: 'roam', hp: 300, path: [], aware: 0, hm: 0}); } return; }
  const ps = alive().filter(p => inCruise(p.x, p.z, p.y) && !p.sw), rn = () => CN[CN.ok[Math.floor(CR() * CN.ok.length)]];
  const flee = (t, s) => { S.state = 'flee'; S.flee = t; S.aware = 0; S.chkT = 0; S.chkH = null; const n = rn(); if (n) stwGo(n.x, n.y, n.z); if (s) emit({k: 'snd', s}); };
  for (const p of PL.values()) if (p.eq === 5 && p.hd < 0 && !p.down && !p.dead && Math.hypot(p.x - S.x, p.z - S.z) < 5.5 && Math.abs(p.y - S.y) < 3 && S.state !== 'flee') flee(5, 'shriekS');
  for (const fl of G.flares) if (fl.t > 0 && Math.hypot(fl.x - S.x, fl.z - S.z) < 9 && Math.abs(fl.y - S.y) < 4 && S.state !== 'flee') flee(6);
  // senses: a light it can see (or that shines on it) carries 30 m; otherwise it has to be looking your way
  S.senseT = (S.senseT || 0) - dt; if (S.senseT <= 0) { S.senseT = .15; S.see = null; S.seeK = 0; let bd = 1e9;
    for (const p of ps) { if (p.hd >= 0) continue; const dx = p.x - S.x, dz = p.z - S.z, d = Math.hypot(dx, dz) + Math.abs(p.y - S.y), inF = Math.abs(angD(S.yaw, Math.atan2(-dx, -dz))) < 1.4;
      const lit = litP(p) && (inF || beamHits(p, S.x, S.y + 2.4, S.z)), rng = (lit ? 30 : p.cr ? 8 : p.run ? 22 : 14) * D.sight / 26;
      if (d > rng || d > bd || (d > 3 && !inF)) continue; if (!seeLine(S.x, S.y + 1.2, S.z, p.x, p.y, p.z)) continue; bd = d; S.see = p; S.seeK = clamp(1.4 - d / rng, .1, 1.4); } }
  const sp = S.state === 'flee' ? null : S.see && PL.get(S.see.id) === S.see && !S.see.down && S.see.hd < 0 ? S.see : null;
  if (sp) { S.aware = Math.min(1.5, (S.aware || 0) + dt * S.seeK / .55); S.seenAt = G.t; S.seenId = sp.id; S.lx = sp.x; S.ly = sp.y; S.lz = sp.z; } else S.aware = Math.max(0, (S.aware || 0) - dt * .3);
  if (sp && (S.aware >= 1 || Math.hypot(sp.x - S.x, sp.z - S.z) + Math.abs(sp.y - S.y) < 4)) { if (S.state !== 'chase') { S.state = 'chase'; S.chkT = 0; S.chkH = null; emit({k: 'snd', s: 'stwSee'}); } S.tgt = sp.id; S.lost = 0; S.sawHide = -1; }
  // half-noticed: it stops, turns and hums at you; if you slip away it comes to look
  let notice = false;
  if (S.state !== 'chase' && S.state !== 'flee' && S.aware > .35) { notice = true; S.ntc = 1; if (sp) S.yaw += angD(S.yaw, Math.atan2(-(sp.x - S.x), -(sp.z - S.z))) * Math.min(1, dt * 6);
    if (!S.hm) { S.hm = 1; emit({k: 'snd', s: 'stwHm', x: +S.x.toFixed(1), y: +(S.y + 2.6).toFixed(1), z: +S.z.toFixed(1)}); } }
  else if (S.ntc) { S.ntc = 0; if (S.state !== 'chase' && S.state !== 'flee') { S.state = 'inv'; S.idle = 3; stwGo(S.lx, S.ly, S.lz); } }
  if (S.aware <= 0 || S.state === 'chase') S.hm = S.state === 'chase' ? 1 : 0;
  const tgt = S.tgt && PL.get(S.tgt);
  // lost them: search the stateroom they vanished in, hiding place by hiding place
  const lost = () => { const z = zoneOf(S.lx, S.lz, S.ly); S.tgt = null; S.sawHide = -1; S.aware = Math.min(S.aware, .3); S.ntc = 0; if (z >= 0 && BLD[z].cruise && BLD[z].hides.length) stwSearch(BLD[z]); else { S.state = 'search'; S.idle = 8; S.chk = []; S.chkH = null; S.chkT = 0; stwGo(S.lx, S.ly, S.lz); } };
  let speed = 1.5 + TOD.night * .3;
  if (S.state === 'chase') {
    speed = (4.6 + TOD.night * .6) * D.chase / 5.1;
    if (!tgt || tgt.down || tgt.dead || !inCruise(tgt.x, tgt.z, tgt.y) || tgt.sw) lost();
    else if (tgt.hd >= 0) { if (S.sawHide === tgt.hd || (S.seenId === tgt.id && G.t - S.seenAt < 1.2)) { const h = HIDES[tgt.hd]; S.sawHide = tgt.hd; if (Math.hypot(S.x - h.ex, S.z - h.ez) < 1.3 && Math.abs(S.y - h.y) < 2) { emit({k: 'snd', s: 'creak', x: +h.x.toFixed(1), y: +(h.y + 1).toFixed(1), z: +h.z.toFixed(1)}); stwDown(tgt); } else { S.rep -= dt; if (S.rep <= 0 || !S.path.length) { S.rep = .5; stwGo(h.ex, h.y, h.ez); S.path.push([h.ex, h.y, h.ez]); } } } else lost(); }
    else { if (!sp) { S.lost += dt; if (S.lost > 4) lost(); }
      S.rep -= dt; if (S.state === 'chase' && S.rep <= 0) { S.rep = .45; if (sp && Math.abs(tgt.y - S.y) < 1 && Math.hypot(tgt.x - S.x, tgt.z - S.z) < 9) S.path = [[tgt.x, tgt.y, tgt.z]]; else stwGo(S.lx, S.ly, S.lz); }
      if (S.state === 'chase' && Math.hypot(tgt.x - S.x, tgt.z - S.z) < 1.4 && Math.abs(tgt.y - S.y) < 1.5) stwDown(tgt); }
  } else if (S.state === 'flee') { speed = 5; S.flee -= dt; if (S.flee <= 0) { S.state = 'roam'; S.idle = 3; } }
  else if (S.state === 'search') { speed = 2.4;
    const h = S.chkH;
    if (S.chkT > 0) { S.chkT -= dt; speed = 0; S.path = []; S.yaw += angD(S.yaw, Math.atan2(-(h.x - S.x), -(h.z - S.z))) * Math.min(1, dt * 6);
      if (S.chkT <= .9 && !S.chkDone) { S.chkDone = 1; emit({k: 'snd', s: 'creak', x: +h.x.toFixed(1), y: +(h.y + 1).toFixed(1), z: +h.z.toFixed(1)}); for (const p of PL.values()) if (p.hd === h.i && !p.hb && !p.down && !p.dead) { stwDown(p); break; } }
      if (S.chkT <= 0 && S.state === 'search') S.chkH = null; }
    else if (h) { if (!S.path.length) { if (Math.hypot(S.x - h.ex, S.z - h.ez) < 1.4) { S.chkT = 1.8; S.chkDone = 0; } else S.chkH = null; } }
    else if (S.chk && S.chk.length) { const n = S.chk.shift(); S.chkH = n; stwGo(n.ex, n.y, n.ez); S.path.push([n.ex, n.y, n.ez]); }
    else if (!S.path.length) { S.idle -= dt; if (S.idle <= 0) S.state = 'roam'; }
    // held breath or not, breathing close by gives a hiding place away
    if (S.state === 'search' && !(S.chkT > 0)) for (const p of PL.values()) if (p.hd >= 0 && !p.hb && !p.down && Math.hypot(p.x - S.x, p.z - S.z) < 3.2 && Math.abs(p.y - S.y) < 2 && CR() < dt * D.breathHear * 2 && S.chkH !== HIDES[p.hd]) { S.chk = [HIDES[p.hd]].concat((S.chk || []).filter(q => q !== HIDES[p.hd])); S.chkH = null; break; }
  }
  else if (S.state === 'inv') { speed = 2.6; if (!S.path.length) { S.idle -= dt; if (S.idle <= 0) S.state = 'roam'; } }
  else { if (!S.path.length) { S.idle -= dt; if (S.idle <= 0) { S.idle = 2 + CR() * 5; const pr = ps[Math.floor(CR() * ps.length)]; const n = pr && CR() < .55 ? CN[cNear(pr.x + (CR() - .5) * 16, pr.y, pr.z + (CR() - .5) * 16)] : rn(); if (n) stwGo(n.x, n.y, n.z); } } }
  // move along the path (it stands still while it wonders)
  while (S.path.length && Math.hypot(S.path[0][0] - S.x, S.path[0][2] - S.z) < .45) S.path.shift();
  if (notice) S.spd = mix(S.spd, 0, Math.min(1, dt * 10));
  else if (!S.path.length) S.spd = mix(S.spd, 0, dt * 6);
  else { const [wx, wy, wz] = S.path[0], dx = wx - S.x, dz = wz - S.z, d = Math.hypot(dx, dz) || 1, want = Math.atan2(-dx, -dz); S.yaw += clamp(angD(S.yaw, want), -dt * 6, dt * 6); S.spd = mix(S.spd, speed * (1 - Math.min(.6, Math.abs(angD(S.yaw, want)) / PI)), dt * 3);
    const st = Math.min(d, S.spd * dt); S.x += dx / d * st; S.z += dz / d * st; const f = floorAt(S.x, S.z, S.y + .9, true); if (f) S.y = mix(S.y, f.y, Math.min(1, dt * 10)); }
  S.stepAcc = (S.stepAcc || 0) + S.spd * dt; if (S.stepAcc > 1.6) { S.stepAcc = 0; emit({k: 'sstep'}); }
}
// ---------------- ashore: a landing stage on every island, and a ship's tender (a grey RIB) carried by the big hulls
// PIERS (read by other packages): {n: island, x, z: T-head centre, y: 1.8, ax: 'x'|'z', root: [x, z] (the beach end), head: [x, z]}
const PIERS = [], PIER_LAMPS = [];
const pierAt = (Q, a, b) => [Q.c[0] + Q.u[0] * a - Q.u[1] * b, Q.c[1] + Q.u[1] * a + Q.u[0] * b];
const pierR = (Q, a0, a1, b0, b1) => { const p = pierAt(Q, a0, b0), q = pierAt(Q, a1, b1); return {x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), z0: Math.min(p[1], q[1]), z1: Math.max(p[1], q[1])}; };
// for each island try the four axis directions: root where the beach drops to 1.5 m, head where the sea is 6.5 m deep; shortest clear stem wins
function pierPlan() {
  const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]], MR = typeof MAP_R === 'number' ? MAP_R : 2600;
  const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  ISLES.forEach((I, ii) => {
    if (I.bar || PIERS.some(q => q.ii === ii)) return;
    const rn = mulberry(0x91e5 + ii), ord = DIR.slice(); for (let i = 3; i > 0; i--) { const j = Math.floor(rn() * (i + 1)), t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
    const ft = []; for (const p of IPADS) if (p.I === I) ft.push([p.x, p.z, p.r]); if (I.ruin) ft.push([I.x - 4, I.z + 3, 3.3]);
    if (I.skull) { ft.push([I.x, I.z, 1.4]); for (let i = 0; i < 9; i++) ft.push([I.x + Math.cos(i / 9 * TAU) * 9, I.z + Math.sin(i / 9 * TAU) * 9, 1]); } for (const d of DIGS) if (d.isle === I.n) ft.push([d.x, d.z, .6]);
    const bad = (x, z) => Math.hypot(x, z) < 80 || Math.hypot(x - HOME.x, z - HOME.z) < HOME.r + 50 || Math.hypot(x - CRZ.x, z - CRZ.z) < 140 || Math.hypot(x, z + 60) > MR - 40 || ISLES.some(J => J !== I && !J.bar && Math.hypot(x - J.x, z - J.z) < J.r * 1.15 + 10) || WRECKS.some(W => Math.hypot(x - W.x - 6, z - W.z) < 40);
    let best = null;
    for (const u of ord) {
      let seen = 0, ra = -1, ha = -1;
      for (let a = 0; a < I.r * 1.6 + 90; a += .5) { const x = I.x + u[0] * a, z = I.z + u[1] * a;
        if (ra < 0) { if (landH(x, z) > 1.5) seen = 1; else if (seen || a > I.r * 1.25) ra = a; continue; }
        if (seaBed(x, z) <= -6.5) { ha = a; break; } }
      if (ra < 0) continue; if (ha < 0 || ha - ra > 70) ha = ra + 70; if (ha - ra < 14) ha = ra + 14;
      const Q = {c: [I.x, I.z], u}, [rx, rz] = pierAt(Q, ra, 0), [hx, hz] = pierAt(Q, ha, 0); let sc = ha - ra;
      if (ft.some(f => segD(f[0], f[1], rx, rz, hx, hz) < 8 + f[2])) sc += 40;
      if (landH(rx - u[0] * 2, rz - u[1] * 2) - landH(rx, rz) > 1) sc += 20;
      if ([[ha, 0], [ha + 2, 7], [ha + 2, -7], [(ra + ha) / 2, 0]].some(([a, b]) => bad(...pierAt(Q, a, b)))) sc += 1000;
      if (!best || sc < best.sc) best = {sc, u, ra, ha};
    }
    if (!best) return;
    const Q = {c: [I.x, I.z], u: best.u}, [rx, rz] = pierAt(Q, best.ra, 0), [hx, hz] = pierAt(Q, best.ha, 0);
    IPADS.push({I, x: rx, z: rz, r: 3, f: 4, h: 1.5});
    PIERS.push({n: I.n, x: +hx.toFixed(2), z: +hz.toFixed(2), y: 1.8, ax: best.u[0] ? 'x' : 'z', root: [+rx.toFixed(2), +rz.toFixed(2)], head: [+hx.toFixed(2), +hz.toFixed(2)], ii, c: Q.c, u: best.u, ra: best.ra, ha: best.ha});
  });
}
// planked stem with a little ramp off the beach, a 12 x 4 m T-head (open outer faces so ships moor and the gangway works), piles, fenders, bollards, a lamp, a ladder
function pierBuild() {
  const Y = 1.8, RL = 2;
  for (const Q of PIERS) {
    if (Q.built) continue; Q.built = 1;
    const {ra, ha} = Q, a0 = ra + RL, a1 = ha - 2, ry = Math.atan2(-Q.u[1], Q.u[0]), at = (a, b) => pierAt(Q, a, b), up = Q.u[0] + Q.u[1] > 0;
    SURF.push(Object.assign({k: 'ramp', y0: up ? 1.5 : Y, y1: up ? Y : 1.5, ax: Q.u[0] ? 'x+' : 'z+'}, pierR(Q, ra, a0, -1.5, 1.5)));
    SURF.push(Object.assign({k: 'slab', y: Y}, pierR(Q, a0 - .05, a1 + .05, -1.5, 1.5)), Object.assign({k: 'slab', y: Y}, pierR(Q, ha - 2, ha + 2, -6, 6)));
    OBST.push(Object.assign({pier: 1}, pierR(Q, ra, ha - 2, -2, 2)), Object.assign({pier: 1}, pierR(Q, ha - 2.5, ha + 2.5, -6.5, 6.5)));
    { const m = at((a0 + a1) / 2, 0); wbox('planks', m[0], Y - .12, m[1], a1 - a0 + .1, .24, 3, ry, 1.2); }
    { const m = at(ha, 0); wbox('planks', m[0], Y - .12, m[1], 4, .24, 12, ry, 1.2); }
    { const g = boxUV(new THREE.BoxGeometry(Math.hypot(RL, Y - 1.5) + .05, .2, 3), RL, .2, 3, 1.2); g.rotateZ(Math.atan2(Y - 1.5, RL)); const m = at(ra + RL / 2, 0); put('planks', g, m[0], (Y + 1.5) / 2 - .1, m[1], ry); }
    for (const b of [-1.3, 1.3]) { const m = at((a0 + a1) / 2, b); wbox('log', m[0], Y - .42, m[1], a1 - a0, .22, .22, ry); }
    for (const a of [ha - 1.7, ha + 1.7]) { const m = at(a, 0); wbox('log', m[0], Y - .42, m[1], .22, .22, 12, ry); }
    const pile = (a, b) => { const [x, z] = at(a, b), lo = seaBed(x, z) - .5, hi = Y - .3; if (hi - lo < .4) return; put('log', new THREE.CylinderGeometry(.15, .18, hi - lo, 7, 1, true), x, (lo + hi) / 2, z); };
    for (let a = a0; a <= a1 + .01; a += 4) for (const b of [-1.3, 1.3]) pile(a, b);
    for (const a of [ha - 1.7, ha + 1.7]) for (const b of [-5.6, -1.9, 1.9, 5.6]) pile(a, b);
    for (const b of [-1.45, 1.45]) { const r = pierR(Q, a0, a1, b - .04, b + .04); rail(r.x0, r.x1, r.z0, r.z1, Y, 'wood'); }
    for (let b = -5.5; b <= 5.51; b += 2.2) { const m = at(ha + 2.07, b); wbox('log', m[0], Y - .85, m[1], .14, 1.5, .26, ry); }
    for (const b of [-4.6, 4.6]) { const [x, z] = at(ha + 1.45, b); put('dark', new THREE.CylinderGeometry(.15, .18, .46, 9), x, Y + .23, z); put('dark', new THREE.CylinderGeometry(.21, .21, .07, 9), x, Y + .47, z); PCIRC.push({x, z, r: .22}); }
    { const [x, z] = at(ha - 1.55, 5.55); put('log', new THREE.CylinderGeometry(.07, .1, 3.3, 6), x, Y + 1.65, z); put('dark', new THREE.ConeGeometry(.3, .22, 8), x, Y + 3.42, z); put('glassL', new THREE.SphereGeometry(.13, 8, 6), x, Y + 3.22, z); PCIRC.push({x, z, r: .18}); PIER_LAMPS.push([x, Y + 3.22, z]); }
    { for (let y = -.9; y < Y - .1; y += .32) { const m = at(ha + 2.1, 0); wbox('steel', m[0], y, m[1], .05, .05, .62, ry); } for (const b of [-.32, .32]) { const m = at(ha + 2.1, b); wbox('steel', m[0], (Y - .9) / 2, m[1], .06, Y + .9, .06, ry); }
      const f = at(ha + 2.6, 0), t = at(ha + 1.2, 0); INTER.push({kind: 'ladder', x: f[0], y: 0, z: f[1], r: 3.5, top: [t[0], Y, t[1]], label: () => 'Climb the ladder', on: () => P.sw}); }
  }
  if (PIER_LAMPS.length && !PIER_LAMPS.m) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(PIER_LAMPS.flat(), 3)); g.computeBoundingSphere();
    const m = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, color: 0xffc878, size: 4.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); scene.add(m); PIER_LAMPS.m = m; }
}
{ const f0 = buildIsles; buildIsles = function (...a) { pierPlan(); const r = f0.apply(this, a); pierBuild(); return r; }; }

// the tender: lives on davits on the starboard quarter of every hull of 30 m or more; the host drives it like the boat, four seats
const TN = {st: 'stow', x: 0, z: 0, yaw: 0, v: 0, yr: 0, thr: 0, steer: 0, drv: null, seats: [null, null, null, null], beach: 0, heave: 0, drop: 0,
  seat: [[0, .95], [-.42, -.85], [.42, -.85], [-.64, 1.55]], m: null, dv: null, mat: null, au: null, snK: 0, bumpT: 0, lv: null, lvT: 0, hudT: 0, hud: null, hudK: null, tx: null};
const tnOk = () => { const H = HC(); return !!H && !H.sub && H.L >= 30 && H.tender !== 0; };
function tnDavit() { return [BG.hw - .3, BG.zs - Math.max(6, BG.L * .1)]; }
const tnL2W = (lx, lz) => { const c = Math.cos(TN.yaw), s = Math.sin(TN.yaw); return [TN.x + lx * c + lz * s, TN.z - lx * s + lz * c]; };
function tnSeatPos(i) { return tnL2W(TN.seat[i][0], TN.seat[i][1]); }
const tnDist = (x, z) => { const c = Math.cos(TN.yaw), s = Math.sin(TN.yaw), dx = x - TN.x, dz = z - TN.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.hypot(lx - clamp(lx, -1.05, 1.05), lz - clamp(lz, -2.15, 2.3)); };
const tnHoistOk = () => { if (!tnOk() || B.sink > 0 || Math.abs(TN.v) >= 1.5) return false; const [x, z] = bL2W(BG.hw + 1, tnDavit()[1]); return Math.hypot(TN.x - x, TN.z - z) < 7; };
function tnMats() { return TN.mat || (TN.mat = {grey: new THREE.MeshStandardMaterial({color: 0x585d62, roughness: .72, metalness: 0}), dark: new THREE.MeshStandardMaterial({color: 0x1d2024, roughness: .55, metalness: .2}),
  steel: new THREE.MeshStandardMaterial({color: 0xb4b8bc, roughness: .4, metalness: .6}), rope: new THREE.MeshStandardMaterial({color: 0xc8b890, roughness: 1, metalness: 0})}); }
const tnBake = (list, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { _e.set(rx, ry, rz, 'YXZ'); geo.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); list.push([geo, mat, true]); };
// grey tubes with a round bow, floor, console, outboard with a live prop, a white masthead light: four draw calls
function tnMesh() {
  const M = tnMats(), g = new THREE.Group(), L = [], b = (geo, mat, ...p) => tnBake(L, geo, mat, ...p);
  for (const sd of [-1, 1]) b(new THREE.CapsuleGeometry(.28, 3.3, 4, 12), M.grey, sd * .74, .32, .25, PI / 2);
  b(new THREE.TorusGeometry(.74, .28, 8, 14, PI), M.grey, 0, .32, -1.4, -PI / 2);
  b(new THREE.BoxGeometry(1.32, .1, 3.7), M.dark, 0, .14, .15); b(new THREE.BoxGeometry(.7, .16, 3.4), M.dark, 0, .04, .1); b(new THREE.BoxGeometry(1.5, .5, .08), M.dark, 0, .36, 2.02);
  b(new THREE.BoxGeometry(.56, .72, .46), M.dark, 0, .55, .3); b(new THREE.BoxGeometry(.58, .2, .04), M.grey, 0, .97, .1, -.5); b(new THREE.BoxGeometry(.62, .34, .5), M.dark, 0, .32, 1.05);
  b(new THREE.BoxGeometry(.34, .5, .42), M.grey, 0, .8, 2.24); b(new THREE.BoxGeometry(.12, .72, .16), M.dark, 0, .22, 2.28); b(new THREE.CylinderGeometry(.02, .025, 1.25, 5), M.dark, .56, .95, 1.9);
  for (const sd of [-1, 1]) b(new THREE.CylinderGeometry(.035, .035, .1, 6), M.dark, sd * .74, .62, -1.6);
  for (const m of mergeByMat(L)) g.add(m);
  const pb = []; for (let i = 0; i < 3; i++) { const q = new THREE.BoxGeometry(.05, .26, .08); q.translate(0, .13, 0); q.rotateZ(i / 3 * TAU); pb.push(q); }
  const prop = new THREE.Mesh(mergeGeos(pb), M.dark); pb.forEach(q => q.dispose()); prop.position.set(0, -.14, 2.36); prop.castShadow = true; g.add(prop); g.userData.prop = prop;
  const lt = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5, fog: false})); lt.scale.setScalar(.7); lt.position.set(.56, 1.62, 1.9); g.add(lt); g.userData.lt = lt;
  return g;
}
// davits, the stowed tender and its launch prompt go back on after every rebuild (live children, never merged)
{ const f0 = buildBoat; buildBoat = function (...a) {
  if (TN.m && TN.m.parent) TN.m.parent.remove(TN.m);
  if (TN.dv) { if (TN.dv.parent) TN.dv.parent.remove(TN.dv); TN.dv.traverse(o => { if (o.geometry) o.geometry.dispose(); }); TN.dv = null; }
  const r = f0.apply(this, a);
  if (tnOk() && BOAT) { const M = tnMats(), [dx, dz] = tnDavit(), fb = BDECK.y, ox = BG.hw + 1, L = [], b = (geo, mat, ...p) => tnBake(L, geo, mat, ...p), bl = Math.hypot(ox - .3 - dx, .6);
    for (const s of [-1.45, 1.45]) { b(new THREE.CylinderGeometry(.08, .11, 2.7, 8), M.steel, dx, fb + 1.35, dz + s); b(new THREE.BoxGeometry(ox - dx + .2, .13, .13), M.steel, (dx + ox) / 2, fb + 2.66, dz + s);
      b(new THREE.BoxGeometry(bl, .07, .07), M.steel, (dx + ox - .3) / 2, fb + 2.3, dz + s, 0, 0, Math.atan2(.6, ox - .3 - dx)); b(new THREE.BoxGeometry(.36, .05, .36), M.steel, dx, fb + .03, dz + s);
      b(new THREE.CylinderGeometry(.05, .05, .16, 8), M.dark, ox, fb + 2.56, dz + s); b(new THREE.CylinderGeometry(.012, .012, .6, 4), M.rope, ox, fb + 2.2, dz + s); }
    b(new THREE.CylinderGeometry(.13, .13, .34, 10), M.dark, dx - .34, fb + .9, dz - 1.45, 0, 0, PI / 2);
    const dv = new THREE.Group(); for (const m of mergeByMat(L)) dv.add(m); BOAT.add(dv); TN.dv = dv;
    INTER.push({kind: 'tnl', boat: 1, lx: dx - .75, lz: dz, ly: 1.1, r: 2.6, label: () => 'Launch the tender', on: () => !P.sw && !P.seat && TN.st === 'stow' && tnOk(), go: () => act({a: 'tnl'})}); }
  return r;
}; }
function tnPub(s, put) { emit({k: 'tn', s, st: TN.st, x: +TN.x.toFixed(2), z: +TN.z.toFixed(2), yaw: +TN.yaw.toFixed(3), seats: TN.seats.map(q => q || 0), put}); }
// where a rider gets off: up the beach past the bow, onto a pier/jetty/deck beside, or over the ship's rail
function tnLeave(p) {
  const fx = -Math.sin(TN.yaw), fz = -Math.cos(TN.yaw), sx = Math.cos(TN.yaw), sz = -Math.sin(TN.yaw), bx = TN.x + fx * 2.1, bz = TN.z + fz * 2.1;
  for (const o of OBST) { if (!o.isle) continue; const e = Math.hypot(bx - o.x, bz - o.z); if (e >= o.r + 1) continue;
    const ux = (o.x - bx) / (e || 1), uz = (o.z - bz) / (e || 1); let x = bx + ux * 1.5, z = bz + uz * 1.5; for (let k = 0; k < 40 && landH(x, z) < .1; k++) { x += ux * .5; z += uz * .5; }
    const lh = landH(x, z), f = floorAt(x, z, lh + .4, true); return {x, z, y: f ? f.y : lh, ob: 0}; }
  let best = null, bd = 1e9;
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const d of [1.7, 2.5, 3.3, 4.1]) { const k = oz ? d + 1.2 : d, x = TN.x + (sx * ox + fx * oz) * k, z = TN.z + (sz * ox + fz * oz) * k, f = floorAt(x, z, 3.5, true);
    if (f && f.y >= 1 && f.y <= 3.2 && d < bd) { bd = d; best = {x, z, y: f.y, ob: 0}; } }
  if (best) return best;
  if (BOAT && B.sink <= 0 && (B.dep || 0) < .3 && !BG.sub) { const [lx, lz] = bW2L(TN.x, TN.z); if (Math.abs(lx) - BG.hw < 5.1 && lz > BDECK.z0 - 1 && lz < BDECK.z1 + 1) {
    const bl = [Math.sign(lx || 1) * (BDECK.x1 - .45), clamp(lz, BDECK.z0 + .5, BDECK.z1 - .5)], [x, z] = bL2W(bl[0], bl[1]); return {x, z, y: BDECK.y, ob: 1, bl}; } }
  return null;
}
// everyone in the tender goes aboard by the davit and it is hoisted (also when the ship sinks, is towed or changes hull)
function tnStow() {
  const dz = tnDavit()[1], puts = [];
  TN.seats.forEach((id, i) => { const p = id && PL.get(id); if (!p) return; const bl = [BG.sub ? 0 : BDECK.x1 - .5, clamp(dz + (i - 1.5) * .9, BDECK.z0 + .5, BDECK.z1 - .5)], [x, z] = bL2W(bl[0], bl[1]);
    Object.assign(p, {ob: 1, bl, x, z, y: BDECK.y, sw: 0}); puts.push({id, ob: 1, bl, x: +x.toFixed(2), z: +z.toFixed(2), y: BDECK.y}); });
  Object.assign(TN, {st: 'stow', seats: [null, null, null, null], v: 0, thr: 0, yr: 0, steer: 0, drv: null, beach: 0}); tnPub('hoist', puts);
}
function tnAct(p, id, m) {
  const no = t => emit({k: 'tnsay', id, t}), si = TN.seats.indexOf(id);
  if (p.dead || p.down) return;
  if (m.a === 'tnl') { if (TN.st !== 'stow' || !tnOk() || !BOAT || B.sink > 0 || p.seat) return; const [dx, dz] = tnDavit(), [wx, wz] = bL2W(dx, dz);
    if (!p.ob || Math.hypot(p.x - wx, p.z - wz) > 5) return no('Go to the davit first.'); if (Math.abs(B.v) > 3) return no('Slow the ship down first.');
    const [x, z] = bL2W(BG.hw + 4, dz); Object.assign(TN, {st: 'water', x, z, yaw: B.yaw, v: 0, yr: 0, thr: 0, steer: 0, beach: 0, seats: [id, null, null, null], drv: id}); p.ob = 0; p.sw = 0; tnPub('launch'); }
  else if (m.a === 'tnb') { if (TN.st !== 'water' || p.seat) return; if (tnDist(p.x, p.z) > 4.5) return no('Get closer to the tender.');
    const s = Number.isInteger(m.s) && m.s >= 0 && m.s < 4 && !TN.seats[m.s] ? m.s : si >= 0 ? -1 : [1, 2, 3, 0].find(i => !TN.seats[i]); if (s == null) return no('The tender is full.'); if (s < 0) return;
    if (si >= 0) TN.seats[si] = null; TN.seats[s] = id; TN.drv = TN.seats[0]; p.ob = 0; p.sw = 0; tnPub('board'); }
  else if (m.a === 'tnx') { if (si < 0) return; const d = tnLeave(p); if (!d) return no('Steer to land, a pier or the ship first.');
    TN.seats[si] = null; TN.drv = TN.seats[0]; Object.assign(p, {x: d.x, z: d.z, y: d.y, ob: d.ob, sw: 0}); if (d.ob) p.bl = d.bl.slice(); tnPub('leave', Object.assign({}, d, {id, x: +d.x.toFixed(2), z: +d.z.toFixed(2), y: +d.y.toFixed(2)})); }
  else if (m.a === 'tnh') { if (TN.st !== 'water') return; if (si !== 0) return no('Only the one at the tiller can hoist her.'); if (!tnOk() || B.sink > 0) return;
    const [x, z] = bL2W(BG.hw + 1, tnDavit()[1]); if (Math.hypot(TN.x - x, TN.z - z) > 7) return no('Bring her in under the davit.'); if (Math.abs(TN.v) >= 1.5) return no('Slow down first.'); tnStow(); }
}
// host physics: 11 m/s flat out, 3 m/s2, coasts to a stop in about 4 s; beaches on island shores, bumps off everything else
function tnStep(dt) {
  if (TN.st !== 'water') return;
  for (let i = 0; i < 4; i++) { const id = TN.seats[i]; if (id && (!PL.get(id) || PL.get(id).dead)) TN.seats[i] = null; } TN.drv = TN.seats[0];
  const d = TN.drv && PL.get(TN.drv); let thr = 0, st = 0;
  if (d && !d.down) { const tin = d === P ? P.tin : d.tin, stale = d !== P && d.poseT != null && performance.now() - d.poseT > 800; if (Array.isArray(tin) && !stale) { thr = clamp(+tin[0] || 0, -1, 1); st = clamp(+tin[1] || 0, -1, 1); } }
  TN.thr = mix(TN.thr, thr, Math.min(1, dt * 3)); TN.steer = mix(TN.steer, st, Math.min(1, dt * 5));
  const v = TN.v, a = TN.thr * (TN.thr > 0 ? 3 : 1.5) - .0248 * v * Math.abs(v) - (Math.abs(TN.thr) < .05 ? Math.sign(v) * Math.min(Math.abs(v) / dt, 1.8) : 0);
  TN.v = v + a * dt; TN.yr = mix(TN.yr, -TN.steer * .9 * clamp(TN.v / 3, -1, 1), Math.min(1, dt * 4)); TN.yaw += TN.yr * dt;
  const fx = -Math.sin(TN.yaw), fz = -Math.cos(TN.yaw); TN.x += fx * TN.v * dt; TN.z += fz * TN.v * dt;
  let bump = 0, beach = 0;
  for (const o of OBST) {
    if (o.c) { const R = o.isle ? o.r + .5 : o.r + 1.1, dx = TN.x - o.x, dz = TN.z - o.z; if (Math.abs(dx) > R || Math.abs(dz) > R) continue; const e = Math.hypot(dx, dz); if (e >= R || e < 1e-4) continue;
      TN.x = o.x + dx / e * R; TN.z = o.z + dz / e * R; const c = -(fx * dx + fz * dz) / e * Math.sign(TN.v); if (o.isle) { beach = 1; if (c > .45) TN.v = 0; else if (c > 0) TN.v *= 1 - c * dt * 8; } else if (c > 0) { bump = Math.max(bump, Math.abs(TN.v) * c); TN.v *= 1 - .7 * c; } continue; }
    for (const [px, pz, r] of [[TN.x, TN.z, 1.1], [TN.x + fx * 1.5, TN.z + fz * 1.5, .8]]) { const qx = clamp(px, o.x0, o.x1), qz = clamp(pz, o.z0, o.z1), ex = px - qx, ez = pz - qz, e = Math.hypot(ex, ez); if (e >= r) continue;
      let nx, nz, k; if (e < 1e-4) { const l = px - o.x0, rt = o.x1 - px, t = pz - o.z0, bt = o.z1 - pz, mn = Math.min(l, rt, t, bt); nx = mn === l ? -1 : mn === rt ? 1 : 0; nz = nx ? 0 : mn === t ? -1 : 1; k = mn + r; } else { nx = ex / e; nz = ez / e; k = r - e; }
      TN.x += nx * k; TN.z += nz * k; const c = -(fx * nx + fz * nz) * Math.sign(TN.v); if (c > 0) { bump = Math.max(bump, Math.abs(TN.v) * c); TN.v *= 1 - .7 * c; } }
  }
  if (BOAT && B.sink <= 0 && Math.hypot(TN.x - B.x, TN.z - B.z) < BG.L * .6 + 6) { const n = Math.max(3, Math.ceil((BG.zs - BG.zb - BG.hw * 2) / 3)), R = BG.hw + 1.1;
    for (let ci = 0; ci <= n; ci++) { const [cx, cz] = bL2W(0, mix(BG.zb + BG.hw * .9, BG.zs - BG.hw * .6, ci / n)), dx = TN.x - cx, dz = TN.z - cz, e = Math.hypot(dx, dz); if (e >= R || e < 1e-4) continue;
      TN.x = cx + dx / e * R; TN.z = cz + dz / e * R; const c = -(fx * dx + fz * dz) / e * Math.sign(TN.v); if (c > 0) { bump = Math.max(bump, Math.abs(TN.v) * c); TN.v *= 1 - .7 * c; } } }
  const MR = typeof MAP_R === 'number' ? MAP_R : 2600, rr = Math.hypot(TN.x, TN.z + 60); if (rr > MR) { TN.x *= MR / rr; TN.z = (TN.z + 60) * MR / rr - 60; TN.v *= .5; }
  TN.beach = beach; TN.bumpT -= dt; if (bump > 1.5 && TN.bumpT <= 0) { TN.bumpT = .5; emit({k: 'tn', s: 'bump', n: +Math.min(1, bump / 8).toFixed(2), x: +TN.x.toFixed(1), z: +TN.z.toFixed(1)}); }
  for (let i = 0; i < 4; i++) { const p = TN.seats[i] && PL.get(TN.seats[i]); if (!p || p === P) continue; [p.x, p.z] = tnSeatPos(i); p.ob = 0; p.sw = 0; }
}
function tnPlace() { const [x, z] = tnSeatPos(P.tn); P.x = x; P.z = z; P.y = waveH(TN.x, TN.z, G.wt) + .45; }
function tnPut(q) { if (!P || !q || q.id !== myId()) return;
  Object.assign(P, {tn: null, tnY: null, cr: 0, sw: 0, dv: 0, deep: 0, vx: 0, vz: 0, vy: 0, climb: null, gwT: .8, lastBY: B.yaw, tin: [0, 0]});
  if (q.ob) { P.ob = 1; P.bl = q.bl.slice(); [P.x, P.z] = bL2W(P.bl[0], P.bl[1]); P.y = BDECK.y; } else { P.ob = 0; P.x = q.x; P.z = q.z; P.y = q.y; } }
Snd.tnWinch = p => { tone(160, .035, 1.1, 'sawtooth', p, 260); burst(700, 4, .05, 1, 'bandpass', p, .8); setTimeout(() => burst(2400, 6, .04, .08, 'bandpass', p), 1050); };
Snd.tnThud = (p, k = .6) => { burst(180, 1, .3 * k, .22, 'lowpass', p); burst(700, 1.5, .08 * k, .12, 'bandpass', p); };
function tnEv(e) {
  if (e.seats && !isHost()) { const was = TN.st; TN.st = e.st; TN.seats = e.seats.map(q => q || null); TN.drv = TN.seats[0];
    if (e.st === 'water') { TN.tx = e.x; TN.tz = e.z; TN.tyaw = e.yaw; if (was !== 'water') { TN.x = e.x; TN.z = e.z; TN.yaw = e.yaw; TN.v = 0; } } else TN.v = 0; }
  const ps = A.on ? at(e.x ?? TN.x, 1, e.z ?? TN.z, 4) : null;
  if (e.s === 'launch') { TN.drop = 1; if (ps) { Snd.tnWinch(ps); setTimeout(() => Snd.splash(ps), 650); } }
  else if (e.s === 'hoist') { if (ps) Snd.tnWinch(ps); } else if (e.s === 'bump') { if (ps) Snd.tnThud(ps, e.n * 1.6); } else if (ps) Snd.tnThud(ps, .5);
  for (const q of [].concat(e.put || [])) tnPut(q);
}
function tnTargets(L) {
  if (!P || TN.st !== 'water' || !alivePlay()) return;
  if (P.tn != null) { const now = performance.now(); if (now - TN.lvT > 200) { TN.lvT = now; TN.lv = tnLeave(P); }
    let lab = 'Leave the tender', go = () => act({a: 'tnx'}), d = 5.2; if (P.tn === 0 && tnHoistOk()) { lab = 'Hoist the tender'; go = () => act({a: 'tnh'}); d = .6; } else if (TN.lv) { lab = TN.lv.ob ? 'Climb aboard' : 'Step ashore'; d = .6; }
    // nobody at the tiller and nowhere to step off: a passenger slides across to it
    if (P.tn > 0 && !TN.seats[0] && !TN.lv) { lab = 'Take the tiller'; go = () => act({a: 'tnb', s: 0}); d = .6; }
    if (d > 1 && P.tn === 0 && Math.abs(TN.v) > 1.5) return; // nothing to do while under way: keep the view clear
    const cp = Math.cos(P.pitch); L.push({x: P.x - Math.sin(P.yaw) * cp * d, y: P.y + P.eye + Math.sin(P.pitch) * d, z: P.z - Math.cos(P.yaw) * cp * d, r: d + .3, label: lab, go}); return; }
  if (P.down || P.seat || P.climb || tnDist(P.x, P.z) > 4.5) return;
  const hy = waveH(TN.x, TN.z, G.wt);
  if (!TN.seats[0]) { const [x, z] = tnL2W(0, .7); L.push({x, y: hy + 1, z, r: 5, flat: 1, label: 'Take the tiller', go: () => act({a: 'tnb', s: 0})}); }
  const s = [1, 2, 3].find(i => !TN.seats[i]); if (s) { const [x, z] = tnL2W(0, -1.4); L.push({x, y: hy + .6, z, r: 5, flat: 1, label: 'Board the tender', go: () => act({a: 'tnb', s})}); }
}
// outboard voice: a buzzy saw and square through a lowpass, pitched by the throttle, panned at the stern; fades out if not refreshed
function tnSnd() {
  if (!A.on || !A.ctx) return; const c = A.ctx, t = c.currentTime;
  if (!TN.au) { const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(), g2 = c.createGain(), p = c.createPanner(); o.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.Q.value = 3; g.gain.value = 0; g2.gain.value = .35;
    Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 4, rolloffFactor: 1.3, maxDistance: 400}); o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(p); p.connect(A.out); o.start(); o2.start(); (A.mute = A.mute || []).push(g); TN.au = {o, o2, lp, g, p}; }
  const u = TN.au, on = TN.st === 'water' && !!TN.seats[0] && Math.hypot(cam.position.x - TN.x, cam.position.z - TN.z) < 250, a = Math.abs(TN.thr), f = 52 + a * 64 + Math.min(11, Math.abs(TN.v)) * 3 + Math.sin(G.wt * 9) * 1.5;
  u.o.frequency.setTargetAtTime(f, t, .08); u.o2.frequency.setTargetAtTime(f * 1.5, t, .08); u.lp.frequency.setTargetAtTime(300 + a * 1500, t, .1);
  u.g.gain.cancelScheduledValues(t); u.g.gain.setTargetAtTime(on ? .035 + a * .06 : 0, t, .15); u.g.gain.setTargetAtTime(0, t + .6, .25);
  setPan(u.p, TN.x + Math.sin(TN.yaw) * 2.3, TN.heave + .6, TN.z + Math.cos(TN.yaw) * 2.3);
}
function tnHud(dt) {
  const on = P && P.tn === 0 && TN.st === 'water'; let el = TN.hud; if (!el && !on) return;
  if (!el) { const st = document.createElement('style'); st.id = 'st-tn'; st.textContent = '#tnHud{position:absolute;left:50%;top:63%;transform:translateX(-50%);font-size:13px;text-shadow:0 1px 4px #000;background:rgba(6,10,14,.5);padding:3px 11px;border-radius:12px;pointer-events:none;white-space:nowrap;transition:opacity .4s}#tnHud kbd{display:inline-block;border:1px solid var(--dim);border-radius:4px;padding:0 5px;margin:0 2px;font:11px ui-monospace,monospace}';
    document.head.appendChild(st); el = TN.hud = document.createElement('div'); el.id = 'tnHud'; $('hud').appendChild(el); }
  TN.hudT = Math.max(0, TN.hudT - dt); const txt = !on ? '' : TN.hudT > 0 ? '<kbd>W</kbd><kbd>S</kbd> throttle · <kbd>A</kbd><kbd>D</kbd> steer' : Math.round(Math.abs(TN.v) * 1.944) + ' kn';
  if (txt !== TN.hudK) { TN.hudK = txt; if (txt) el.innerHTML = txt; el.style.opacity = txt ? 1 : 0; }
}
// every client: follow the host's tender, bob it on the waves (or hang it on the davits), spray, light, sound, pier lamps
function tnDraw(dt) {
  if (!TN.m) TN.m = tnMesh(); const m = TN.m, w = TN.st === 'water';
  if (w && !isHost() && TN.tx != null) { const k = Math.min(1, dt * 6), px = TN.tx - Math.sin(TN.tyaw) * TN.v * .05, pz = TN.tz - Math.cos(TN.tyaw) * TN.v * .05; TN.x = mix(TN.x, px, k); TN.z = mix(TN.z, pz, k); TN.yaw += angD(TN.yaw, TN.tyaw) * k; TN.x += -Math.sin(TN.yaw) * TN.v * dt * (1 - k); TN.z += -Math.cos(TN.yaw) * TN.v * dt * (1 - k); }
  if (w) { if (m.parent !== scene) { if (m.parent) m.parent.remove(m); scene.add(m); }
    const t = G.wt, fx = -Math.sin(TN.yaw), fz = -Math.cos(TN.yaw), sx = Math.cos(TN.yaw), sz = -Math.sin(TN.yaw), hf = waveH(TN.x + fx * 1.6, TN.z + fz * 1.6, t), hb = waveH(TN.x - fx * 1.6, TN.z - fz * 1.6, t), hl = waveH(TN.x - sx * .8, TN.z - sz * .8, t), hr = waveH(TN.x + sx * .8, TN.z + sz * .8, t), av = Math.abs(TN.v);
    TN.heave = (hf + hb + hl + hr) / 4; TN.drop = Math.max(0, TN.drop - dt * 1.8);
    m.position.set(TN.x, TN.heave - .05 + TN.drop * TN.drop * 1.6, TN.z); m.rotation.set(Math.atan2(hf - hb, 3.2) * .9 + clamp(TN.v / 11, 0, 1) * .09, TN.yaw, Math.atan2(hl - hr, 1.6) * .7 + clamp((TN.yr || 0) * TN.v * .03, -.15, .15), 'YXZ');
    const dc = Math.hypot(cam.position.x - TN.x, cam.position.z - TN.z); m.visible = dc < (G.viewFar || 1600);
    m.userData.prop.rotation.z += ((TN.seats[0] ? 14 : 0) + TN.thr * 30) * dt; m.userData.lt.material.opacity = .25 + TOD.night * .75; m.userData.lt.scale.setScalar(.7 + ((TN.seats[0] || TN.seats[1] || TN.seats[2] || TN.seats[3]) ? 0 : clamp((dc - 25) / 45, 0, 4) * (.3 + TOD.night * .7))); // left at anchor: the riding light shows you where
    if (av > 2 && dc < 300 && Math.random() < dt * av * .9) spray(TN.x - fx * 2.3, TN.heave + .15, TN.z - fz * 2.3, 2, av * .3);
    if (P && P.tn != null && alivePlay()) tnPlace(); }
  else { const ok = tnOk() && !!BOAT; if (ok) { if (m.parent !== BOAT) { if (m.parent) m.parent.remove(m); BOAT.add(m); } m.position.set(BG.hw + 1, BDECK.y + 1.35, tnDavit()[1]); m.rotation.set(0, 0, 0); m.userData.lt.material.opacity = .1 + TOD.night * .3; } m.visible = ok; }
  if (PIER_LAMPS.m) PIER_LAMPS.m.material.opacity = clamp(TOD.night * 1.1 + (1 - TOD.day) * .25, 0, 1) * .85;
  tnSnd(); tnHud(dt);
}
{ const f0 = resetBoat; resetBoat = function (...a) { const r = f0.apply(this, a); if (isHost() && TN.st === 'water') tnStow(); return r; }; }
{ const f0 = startGame; startGame = function (...a) { Object.assign(TN, {st: 'stow', v: 0, yr: 0, thr: 0, steer: 0, drv: null, seats: [null, null, null, null], beach: 0, drop: 0, tx: null, snK: 0, hudT: 0, lv: null}); const r = f0.apply(this, a); if (P) Object.assign(P, {tn: null, tnY: null, tin: [0, 0]}); return r; }; }
{ const f0 = hostStep; hostStep = function (...a) { const r = f0.apply(this, a); tnStep(a[0]); return r; }; }
{ const f0 = hostAct; hostAct = function (id, m) { if (m && /^tn[lbxh]$/.test(m.a)) { const p = PL.get(id); if (!p || !G.on) return; if (m.px != null && p !== P && !m.ob && Math.hypot(m.px - p.x, m.pz - p.z) < 25) { p.x = m.px; p.z = m.pz; } tnAct(p, id, m); return; } return f0.apply(this, arguments); }; }
{ const f0 = applyEv; applyEv = function (e) { if (e && e.k === 'tn') { tnEv(e); return; } if (e && e.k === 'tnsay') { if (e.id === myId()) showMsg(e.t, '', 2.5); return; } return f0.apply(this, arguments); }; }
{ const f0 = packSnap; packSnap = function (...a) { const s = f0.apply(this, a);
  if (TN.st === 'water') { s.tn = ['water', +TN.x.toFixed(2), +TN.z.toFixed(2), +TN.yaw.toFixed(3), +TN.v.toFixed(2), TN.seats[0] || '', TN.seats.map(q => q || 0), +TN.thr.toFixed(2), +(TN.yr || 0).toFixed(3)]; TN.snK = 0; } else if (TN.snK++ % 30 === 0) s.tn = ['stow']; return s; }; }
{ const f0 = applySnap; applySnap = function (s) { const r = f0.apply(this, arguments), q = s && s.tn; if (!q) return r;
  if (q[0] === 'water') { const was = TN.st; Object.assign(TN, {st: 'water', tx: q[1], tz: q[2], tyaw: q[3], v: q[4], drv: q[5] || null, thr: q[7] || 0, yr: q[8] || 0}); TN.seats = [0, 1, 2, 3].map(i => (q[6] || [])[i] || null);
    if (was !== 'water' || Math.hypot(TN.tx - TN.x, TN.tz - TN.z) > 30) { TN.x = TN.tx; TN.z = TN.tz; TN.yaw = TN.tyaw; } }
  else Object.assign(TN, {st: 'stow', seats: [null, null, null, null], v: 0, thr: 0, drv: null});
  return r; }; }
// seated: ride the seat, look around within 110 degrees of the bow, the driver's WASD goes to the host as tin
{ const f0 = stepPlayer; stepPlayer = function (dt) {
  const s = P && TN.st === 'water' && alivePlay() ? TN.seats.indexOf(myId()) : -1;
  if (s < 0) { if (P && P.tn != null) Object.assign(P, {tn: null, tnY: null, cr: 0, tin: [0, 0]}); return f0.apply(this, arguments); }
  if (s === 0 && P.tn !== 0) TN.hudT = 6;
  P.tn = s; P.yaw += angD(P.tnY ?? TN.yaw, TN.yaw); P.tnY = TN.yaw; P.yaw = TN.yaw + clamp(angD(TN.yaw, P.yaw), -1.92, 1.92);
  Object.assign(P, {ob: 0, sw: 0, dv: 0, deep: 0, cr: 1, run: 0, vx: 0, vz: 0, vy: 0, climb: null, lastBY: B.yaw}); P.eye = mix(P.eye, 1.1, Math.min(1, dt * 6)); P.stam = Math.min(1, P.stam + dt / 7); P.air = Math.min(1, (P.air ?? 1) + dt / 4);
  if (P.l) { P.bat -= dt / 360; if (P.bat <= 0) { P.bat = 0; P.l = 0; } }
  P.tin = s === 0 ? [(K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0)] : [0, 0]; tnPlace();
}; }
{ const f0 = targets; targets = function (...a) { const L = f0.apply(this, a); tnTargets(L); return L; }; }
{ const f0 = myPose; myPose = function (...a) { const r = f0.apply(this, a); if (P && P.tn != null) { r.tn = P.tn; r.tin = P.tn === 0 ? P.tin : 0; } return r; }; }
{ const h0 = Net.handlers.pose; Net.on('pose', (m, f) => { if (h0) h0(m, f); if (!G.on) return; const id = isHost() ? f : m.from, p = id && PL.get(id); if (!p || p === P) return; p.tn = m.tn != null ? m.tn : null; p.tin = Array.isArray(m.tin) ? m.tin : [0, 0]; }); }
// remote riders sit still on their seats
{ const f0 = updateRemotes; updateRemotes = function (...a) {
  tnDraw(a[0]); const w = TN.st === 'water';
  if (w) for (let i = 0; i < 4; i++) { const p = TN.seats[i] && PL.get(TN.seats[i]); if (!p || p === P || !p.ready) continue; const [x, z] = tnSeatPos(i); p.x = p.rx = x; p.z = p.rz = z; p.y = p.ry = TN.heave + .45; p.sw = 0; p.ob = 0; p.tnS = 1; }
  const r = f0.apply(this, a);
  for (const p of PL.values()) { if (!p.tnS || p === P) continue; if (!w || !TN.seats.includes(p.id)) { p.tnS = 0; continue; } const j = p.av && p.av.userData; if (!j || !p.av.visible) continue;
    p.av.position.y -= .8; j.l1.rotation.x = j['l-1'].rotation.x = 1.4; j['a-1'].rotation.x = -.35; j.body.rotation.x = 0; j.body.position.y = .95; }
  return r;
}; }
// ---------------- deep dive sites, and the gulpers that hunt divers in the dark
const DSITES = [
  {n: 'The Abyssal Trench', x: -1500, z: -950, r: 170, d: 125},
  {n: 'Wreck of the Aurelia', x: 700, z: 1750, r: 110, d: 72, liner: 1},
  {n: 'The Drowned Garden', x: 2000, z: -1300, r: 130, d: 58, kelp: 1},
  {n: 'The Ship Graveyard', x: -4250, z: 250, r: 150, d: 60, field: 1, reg: 'grave', nw: 1},
  {n: 'The Maw', x: 4200, z: -300, r: 200, d: 150, reg: 'abyss', nw: 1},
];
const SUIT = [{n: 'no suit', max: 4, air: 22}, {n: 'Scuba gear', max: 45, air: 180}, {n: 'Saturation suit', max: 160, air: 540}];
let DEEPG = null;
function buildDeep() {
  // things that only show underwater: the sunken liner and the kelp forest
  DEEPG = new THREE.Group(); DEEPG.visible = false; scene.add(DEEPG);
  const rm = new THREE.MeshStandardMaterial({map: TX.rustH, color: 0x5a4a40, roughness: .9, metalness: .2, side: THREE.DoubleSide});
  for (const s of DSITES) {
    POIS.push({n: s.n, x: s.x, z: s.z, r: s.r, dive: s});
    if (s.liner) { const sh = new THREE.Shape(); sh.moveTo(-10, 45); sh.lineTo(10, 45); sh.lineTo(10, -20); sh.quadraticCurveTo(8, -40, 0, -48); sh.quadraticCurveTo(-8, -40, -10, -20); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, {depth: 14, bevelEnabled: false}); g.rotateX(PI / 2); const m = new THREE.Mesh(g, rm); const y = seaBed(s.x, s.z); m.position.set(s.x, y + 9, s.z); m.rotation.set(.12, .7, .38); DEEPG.add(m);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(16 - i * 3, 3, 30 - i * 6), rm); b.position.set(0, -14 + 3 * i, 0); b.position.applyEuler(m.rotation).add(m.position); b.position.y = m.position.y + 1.5 + i * 2.6; b.rotation.copy(m.rotation); DEEPG.add(b); }
      const fn = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 9, 14), rm); fn.position.set(s.x + 6, y + 6, s.z - 4); fn.rotation.set(.3, 0, 1.2); DEEPG.add(fn); }
    if (s.kelp) { const kg = new THREE.PlaneGeometry(.8, 14, 1, 6); kg.translate(0, 7, 0); const km = new THREE.MeshStandardMaterial({color: 0x1c3412, roughness: .8, side: THREE.DoubleSide}), kT = DEEPG.userData.kT = {value: 0};
      km.onBeforeCompile = sh => { sh.uniforms.uT = kT; // fronds sway with the swell, more toward the tips; darker at the base
        sh.vertexShader = 'uniform float uT; varying float vKy;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float ph = instanceMatrix[3].x * .13 + instanceMatrix[3].z * .07; float k = position.y / 14.; vKy = k; transformed.x += sin(uT * .7 + ph + position.y * .25) * k * k * 1.2; transformed.z += cos(uT * .55 + ph) * k * k * .8;');
        sh.fragmentShader = 'varying float vKy;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= .35 + .65 * smoothstep(0., .55, vKy);'); }; const im = new THREE.InstancedMesh(kg, km, 260), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
      for (let i = 0; i < 260; i++) { const a = R() * TAU, r = Math.sqrt(R()) * s.r, x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r; E.set((R() - .5) * .2, R() * TAU, (R() - .5) * .2); M4.compose(_v.set(x, seaBed(x, z), z), Q.setFromEuler(E), _s.set(1 + R(), .6 + R() * 1.2, 1)); im.setMatrixAt(i, M4); }
      im.frustumCulled = false; DEEPG.add(im); }
  }
}
// gulper: long pale eel body, a jaw full of needles, and a glowing lure in front of its face
const GUL = [], GN = 5;
function gulMesh() {
  const NS = 16, NR = 8, n = NS * NR, g = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR; idx.push(a, a + NR, b, b, a + NR, b + NR); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setIndex(idx);
  const body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: 0x4a3c40, roughness: .35, side: THREE.DoubleSide})); body.frustumCulled = false; scene.add(body);
  const h = new THREE.Group(); scene.add(h); const hm = new THREE.MeshStandardMaterial({color: 0x3a2e32, roughness: .35}), tm = new THREE.MeshStandardMaterial({color: 0xd8d0c0, roughness: .2});
  const sk = new THREE.Mesh(new THREE.SphereGeometry(.75, 14, 10), hm); sk.scale.set(1, .8, 1.3); sk.position.z = .3; h.add(sk);
  const jaw = new THREE.Group(); jaw.position.set(0, -.25, -.3); h.add(jaw); const jm = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 8), hm); jm.scale.set(1.05, .35, 1.5); jm.position.set(0, -.2, .6); jaw.add(jm);
  for (let i = 0; i < 14; i++) { const a = -1.3 + i / 13 * 2.6; const t = new THREE.Mesh(new THREE.ConeGeometry(.035, .5 + Math.random() * .4, 4), tm); t.position.set(Math.sin(a) * .62, .05, .6 + Math.cos(a) * .9); jaw.add(t);
    const u = new THREE.Mesh(new THREE.ConeGeometry(.03, .4 + Math.random() * .3, 4), tm); u.rotation.x = PI; u.position.set(Math.sin(a) * .66, -.25, .3 + Math.cos(a) * .95); h.add(u); }
  const inner = new THREE.Mesh(new THREE.SphereGeometry(.55, 10, 8), new THREE.MeshBasicMaterial({color: 0x0a0204})); inner.scale.set(1, .5, 1.3); inner.position.set(0, -.35, .5); h.add(inner);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(.9, .95, .85)})); e.position.set(sx * .5, .35, .75); h.add(e); }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, 1.6, 5), hm); st.geometry.translate(0, .8, 0); st.position.set(0, .5, .6); st.rotation.x = .9; h.add(st);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(2, 6, 5)})); bulb.position.set(0, .5 + Math.cos(.9) * 1.6, .6 + Math.sin(.9) * 1.6); h.add(bulb);
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x60ffe0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9})); gl.scale.setScalar(3); gl.position.copy(bulb.position); h.add(gl);
  return {body, h, jaw, bulb, gl, trail: [], NS, NR};
}
const _gp = [], _gt = new THREE.Vector3(), _gu = new THREE.Vector3(), _gs = new THREE.Vector3(), _gm = new THREE.Matrix4();
function gulDraw(o, x, y, z, yaw, pitch, jaw, t) {
  const tr = o.trail, LEN = 7, sp = LEN / (o.NS - 1); const last = tr[tr.length - 1]; if (!last || Math.hypot(x - last[0], y - last[1], z - last[2]) > .25) { tr.push([x, y, z]); if (tr.length > 80) tr.shift(); }
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  let pi = tr.length - 1, px = x, py = y, pz = z;
  for (let i = 0; i < o.NS; i++) { let need = i ? sp : 0; while (need > 0) { if (pi > 0) { const q = tr[pi - 1], l = Math.hypot(q[0] - px, q[1] - py, q[2] - pz); if (l <= need) { need -= l; px = q[0]; py = q[1]; pz = q[2]; pi--; } else { const f = need / l; px += (q[0] - px) * f; py += (q[1] - py) * f; pz += (q[2] - pz) * f; need = 0; } } else { px -= fx * need; py -= fy * need; pz -= fz * need; need = 0; } }
    (_gp[i] || (_gp[i] = new THREE.Vector3())).set(px, py, pz); }
  const pos = o.body.geometry.attributes.position.array, nor = o.body.geometry.attributes.normal.array;
  for (let i = 0; i < o.NS; i++) { const u = i / (o.NS - 1), r = (u < .1 ? .55 + u * 2 : .75 * Math.pow(1 - (u - .1) / .9, 1.2) + .03), a = _gp[Math.max(0, i - 1)], b = _gp[Math.min(o.NS - 1, i + 1)];
    _gt.subVectors(a, b); if (_gt.lengthSq() < 1e-6) _gt.set(fx, fy, fz); _gt.normalize(); _gu.set(0, 1, 0).addScaledVector(_gt, -_gt.y).normalize(); _gs.crossVectors(_gt, _gu);
    const wv = Math.sin(i * .6 - t * 6) * .35 * u, cx = _gp[i].x + _gs.x * wv, cy = _gp[i].y + _gs.y * wv, cz = _gp[i].z + _gs.z * wv;
    for (let j = 0; j < o.NR; j++) { const an = j / o.NR * TAU, ca = Math.cos(an), sa = Math.sin(an), k = (i * o.NR + j) * 3; nor[k] = _gu.x * ca + _gs.x * sa; nor[k + 1] = _gu.y * ca + _gs.y * sa; nor[k + 2] = _gu.z * ca + _gs.z * sa; pos[k] = cx + nor[k] * r; pos[k + 1] = cy + nor[k + 1] * r * .8; pos[k + 2] = cz + nor[k + 2] * r; } }
  o.body.geometry.attributes.position.needsUpdate = o.body.geometry.attributes.normal.needsUpdate = true;
  _gt.set(fx, fy, fz); _gu.set(0, 1, 0).addScaledVector(_gt, -_gt.y).normalize(); _gs.crossVectors(_gu, _gt); _gm.makeBasis(_gs, _gu, _gt); o.h.quaternion.setFromRotationMatrix(_gm); o.h.position.set(x, y, z).addScaledVector(_gt, .4);
  o.jaw.rotation.x = jaw; const pl = .8 + Math.sin(t * 3 + x) * .2; o.gl.material.opacity = pl; o.bulb.scale.setScalar(.9 + pl * .2);
}
// host brain
function stepGulpers(dt) {
  const divers = alive().filter(p => p.sw && (p.dv || 0) > 5);
  // they only rise for divers who go deep, go down at night, or swim into a dive site; and never in the first 25 s
  for (const p of PL.values()) { const dv = p.sw ? p.dv || 0 : 0, ok = p.ready && !p.dead && dv > 5 && (dv > 25 || (dv > 12 && TOD.night > .5) || DSITES.some(s => Math.hypot(p.x - s.x, p.z - s.z) < s.r)); if (!ok) p.gulOkT = null; else if (p.gulOkT == null) p.gulOkT = G.t + 25; }
  G.gulT = (G.gulT ?? 4) - dt;
  if (G.gulT <= 0) { G.gulT = 5; const on = GUL.filter(g => g.on).length, el = divers.filter(p => p.gulOkT != null && G.t >= p.gulOkT), p = el[Math.floor(CR() * el.length)];
    if (p && on < Math.min(GN, Math.max(1, 1 + Math.floor((p.dv - 25) / 35)))) { const a = CR() * TAU, r = 38 + CR() * 14, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, bed = seaBed(x, z);
      if (bed < -12) { let g = GUL.find(q => !q.on); if (!g) { g = {}; GUL.push(g); } Object.assign(g, {on: 1, x, z, y: clamp(-p.dv + (CR() - .5) * 8, bed + 2, -4), yaw: CR() * TAU, pitch: 0, st: 0, t: 0, tgt: null, vx: 0, vy: 0, vz: 0}); } } }
  for (const g of GUL) { if (!g.on) continue; g.t += dt;
    let best = null, bd = 1e9; for (const p of divers) { const d = Math.hypot(p.x - g.x, -p.dv - g.y, p.z - g.z); if (d < bd) { bd = d; best = p; } }
    if (!best || bd > 130) { g.on = 0; continue; }
    const scared = [...PL.values()].some(p => p.eq === 5 && p.sw && p.hd < 0 && Math.hypot(p.x - g.x, -p.dv - g.y, p.z - g.z) < 8) || G.flares.some(f => f.t > 0 && f.sea && Math.hypot(f.x - g.x, f.z - g.z) < 14 && g.y > -20);
    if (scared && g.st !== 3) { g.st = 3; g.t = 0; emit({k: 'snd', s: 'gulF', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); }
    const px = best.x, py = -best.dv - .3, pz = best.z; let tx, ty, tz, spd;
    if (g.st === 0) { const sense = litP(best) ? 42 : 26, ra = g.t * .12 + g.yaw; tx = px + Math.sin(ra) * 22; ty = py + Math.sin(g.t * .5) * 3; tz = pz + Math.cos(ra) * 22; spd = 3; if (bd < sense) { g.st = 1; g.t = 0; g.lt = 4 + CR() * 5; g.ang = Math.atan2(g.x - px, g.z - pz); emit({k: 'snd', s: 'gulS', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); } }
    else if (g.st === 1) { g.ang += dt * .55; const r = mix(14, 8, clamp(g.t / g.lt, 0, 1)); tx = px + Math.sin(g.ang) * r; tz = pz + Math.cos(g.ang) * r; ty = py + Math.sin(g.t) * 2; spd = 4.2; if (g.t > g.lt && bd < 11) { g.st = 4; g.t = 0; g.lx = px; g.ly = py; g.lz = pz; } }
    // the cock: it hangs there facing you, lure dark, aimed at where you were. Move now.
    else if (g.st === 4) { tx = px; ty = py; tz = pz; spd = 1; if (g.t > .9) { g.st = 2; g.t = 0; g.pass = 0; const ax = g.lx - g.x, ay = g.ly - g.y, az = g.lz - g.z, al = Math.hypot(ax, ay, az) || 1; g.vx = ax / al * 8; g.vy = ay / al * 8; g.vz = az / al * 8; emit({k: 'snd', s: 'gulL', x: +g.x.toFixed(1), y: +g.y.toFixed(1), z: +g.z.toFixed(1)}); } }
    else if (g.st === 2) { tx = mix(g.lx, px, .2); ty = mix(g.ly, py, .2); tz = mix(g.lz, pz, .2); spd = 11; if (!g.pass && Math.hypot(tx - g.x, ty - g.y, tz - g.z) < 1.5) g.pass = 1; if (g.pass) { tx = g.x + g.vx; ty = g.y + g.vy; tz = g.z + g.vz; }
      if (bd < 1.9) { g.st = 3; g.t = 0; const p = best; if (p.biteT && G.t - p.biteT < 15) { p.dead = true; p.deadT = 0; dropCarry(p); emit({k: 'dead', id: p.id, drown: 3}); } else { p.biteT = G.t; emit({k: 'bite', id: p.id}); } } else if (g.t > 1.4) { g.st = 1; g.t = 0; g.lt = 3 + CR() * 3; } }
    else { tx = g.x + (g.x - px) * 2; ty = g.y - 3; tz = g.z + (g.z - pz) * 2; spd = 7; if (g.t > 6) { g.st = 0; g.t = 0; } }
    const dx = tx - g.x, dy = ty - g.y, dz = tz - g.z, d = Math.hypot(dx, dy, dz) || 1, k = Math.min(1, dt * (g.st === 2 ? 4 : 1.6));
    g.vx = mix(g.vx, dx / d * spd, k); g.vy = mix(g.vy, dy / d * spd, k); g.vz = mix(g.vz, dz / d * spd, k);
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt; const bed = seaBed(g.x, g.z); g.y = clamp(g.y, bed + 1.2, -2.5); if (BG.sub) subGulPush(g);
    const hs = Math.hypot(g.vx, g.vz); if (hs > .2) g.yaw = Math.atan2(-g.vx, -g.vz); g.pitch = Math.atan2(g.vy, Math.max(hs, .1)) * .8;
  }
}
// ---------------- the far sea: a chart twice as wide, five regions with their own water, weather, catch and props
// Legacy waters (within 2.6 km of MAP_C) are untouched; everything with nw: 1 lives out here and sorts after the old POIS.
const MAP_R = 5200, MAP_C = {x: 0, z: -60}, MAP_FLN = 24;
const REGIONS = [
  {k: 'frost', n: 'The Frostreach', x: -900, z: 4000, r: 1700, fog: 1.3, tint: 0x0c1c2a, deep: 1.1, pay: 1.25},
  {k: 'coral', n: 'The Coral Shallows', x: 3300, z: 2600, r: 1400, fog: 1, tint: 0x06343a, deep: 0, pay: .9},
  {k: 'abyss', n: 'The Abyss', x: 4300, z: -400, r: 1300, fog: 1.1, tint: 0x020c16, deep: 1.6, pay: 1.4},
  {k: 'ash', n: 'The Ashfall Isles', x: 400, z: -3900, r: 1500, fog: 1.4, tint: 0x14100c, deep: 1, pay: 1.2},
  {k: 'grave', n: 'The Drowned Graveyard', x: -4000, z: 400, r: 1300, fog: 2.4, tint: 0x0a1410, deep: 1.3, pay: 1.35},
];
for (const q of REGIONS) q.tc = new THREE.Color(q.tint);
// floating cargo kinds: [kind, weight, scales with the region's pay]
const MAP_FLW = [['crate', .42], ['scrap', .2], ['fuel', .12], ['patch', .04], ['bottle', .06], ['relic', .08, 1], ['chest', .05, 1], ['gold', .03, 1]];
const mapToastSeen = new Set(), MAP_FLK = new Set(MAP_FLW.map(e => KINDS.indexOf(e[0])));
function mapRegW(x, z, q) { return 1 - smooth((Math.hypot(x - q.x, z - q.z) - .7 * q.r) / (.3 * q.r)); }
// the strongest region here (mapRegion.w holds its weight, 0-1), or null in home waters
function mapRegion(x, z) { let b = null, bw = 0; for (const q of REGIONS) { if (Math.abs(x - q.x) > q.r || Math.abs(z - q.z) > q.r) continue; const w = mapRegW(x, z, q); if (w > bw) { bw = w; b = q; } } mapRegion.w = bw; return b; }
mapRegion.w = 0;
function regionAt(x, z) { return mapRegion(x, z); }
// sea bed past the old chart: 20 m deeper out in the open, sandy coral flats, the abyss falls away
function mapBed(x, z, b, s, dc) { b -= 20 * smooth((dc - 2800) / 1400) * s; const q = mapRegion(x, z), w = mapRegion.w; if (!q) return b;
  if (q.k === 'coral') return mix(b, Math.max(b, -14 + 5 * (1 - s) + (fbm(x * .013, z * .013) - .5) * 6), w);
  if (q.k === 'abyss') return b - 40 * w * (.35 + .65 * s); return b; }
// the host lets cargo nobody is near sink, so the slots refill around the crew
function mapFloatCull(dt) { if ((G.mapFlT = (G.mapFlT || 0) - dt) > 0) return; G.mapFlT = 2; const pl = alive(); if (!pl.length) return;
  for (let i = 0; i < MAP_FLN; i++) { const f = G.floats[i]; if (f && MAP_FLK.has(f[2]) && pl.every(p => Math.hypot(p.x - f[0], p.z - f[1]) > 1800)) G.floats[i] = null; } }
// saves and snapshots keep POIS indices: old places stay 0-23 (rig, lighthouse, 6 wrecks, 12 islands, Serenade, 3 dive sites), new ones follow
function mapPoiOrder() { const nw = q => !!((q.isle && q.isle.nw) || (q.wreck && q.wreck.nw) || (q.dive && q.dive.nw)), a = POIS.filter(q => !nw(q)), b = POIS.filter(nw);
  if (POIS.findIndex(nw) >= 0 && POIS.findIndex(nw) < a.length) { POIS.length = 0; POIS.push(...a, ...b); }
  if (TEST && (!POIS[20] || !POIS[20].cruise || ![21, 22, 23].every(i => POIS[i] && POIS[i].dive))) console.warn('[map] legacy POIS order broken'); }
// the Ship Graveyard: a field of hulls on the bed, only seen underwater
function mapFieldMeshes() { if (!DEEPG) return; const r = mulberry(0x5ea9), list = [], M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S3 = new THREE.Vector3(1, 1, 1);
  const add = (g, x, y, z, rx, ry, rz) => { const uv = g.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .12, uv.getY(i) * .12); E.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(M4.compose(V.set(x, y, z), Q.setFromEuler(E), S3)); list.push(g); };
  for (const s of DSITES) { if (!s.field) continue; const n = 5 + Math.floor(r() * 3), at = [];
    for (let k = 0; k < 80 && at.length < n; k++) { const a = r() * TAU, d = (.12 + r() * .7) * s.r, x = s.x + Math.sin(a) * d, z = s.z + Math.cos(a) * d; if (at.some(p => Math.hypot(p[0] - x, p[1] - z) < 42)) continue; at.push([x, z]);
      const L = 22 + r() * 36, W = L * (.16 + r() * .05), H = W * .75, sh = new THREE.Shape(); sh.moveTo(-W / 2, L * .45); sh.lineTo(W / 2, L * .45); sh.lineTo(W * .52, -L * .2); sh.quadraticCurveTo(W * .36, -L * .42, 0, -L * .55); sh.quadraticCurveTo(-W * .36, -L * .42, -W * .52, -L * .2); sh.closePath();
      const yaw = r() * TAU, roll = (r() - .5) * 1.3, pitch = (r() - .5) * .3, y = seaBed(x, z) + H * .45, g = new THREE.ExtrudeGeometry(sh, {depth: H, bevelEnabled: false, curveSegments: 5}); g.rotateX(PI / 2); add(g, x, y, z, pitch, yaw, roll);
      if (r() < .7) { const c = new THREE.BoxGeometry(W * .6, H * .7, L * .18); c.translate(0, H * .35, L * .12); add(c, x, y, z, pitch, yaw, roll); }
      if (r() < .8) { const m = new THREE.CylinderGeometry(.25, .4, L * .45, 6); m.translate(0, L * .22, -L * .1); m.rotateZ((r() - .5) * .9); add(m, x, y, z, pitch, yaw, roll); } } }
  if (!list.length) return; const m = new THREE.Mesh(mergeGeos(list), new THREE.MeshStandardMaterial({map: TX.rustH, color: 0x4a3c34, roughness: .9, metalness: .25, side: THREE.DoubleSide})); DEEPG.add(m); DEEPG.userData.field = m; }
// Frostreach icebergs: one instanced mesh, half sunk, bobbing near the camera; each is a hard circle (the icebreaker shoulders through)
const mapIce = {im: null, L: [], t: 0, cx: 0, cz: 0, R: 0, M4: new THREE.Matrix4(), Q: new THREE.Quaternion(), E: new THREE.Euler(), V: new THREE.Vector3(), S: new THREE.Vector3(),
  build() { const q = REGIONS[0], r = mulberry(0x5ea), L = this.L;
    for (let k = 0; k < 2500 && L.length < 50; k++) { const a = r() * TAU, d = Math.sqrt(r()) * q.r * .92, x = q.x + Math.sin(a) * d, z = q.z + Math.cos(a) * d, s = 5 + Math.pow(r(), 1.6) * 13, sy = .55 + r() * .6, sx = .85 + r() * .4, sz = .85 + r() * .4, yaw = r() * TAU, ph = r() * TAU;
      if (Math.hypot(x - MAP_C.x, z - MAP_C.z) > MAP_R - 150 || mapRegW(x, z, q) < .25 || L.some(e => Math.hypot(e.x - x, e.z - z) < 150)) continue;
      if (OBST.some(o => o.c ? Math.hypot(x - o.x, z - o.z) < o.r + s + (o.isle ? 60 : 40) : x > o.x0 - s - 50 && x < o.x1 + s + 50 && z > o.z0 - s - 50 && z < o.z1 + s + 50)) continue;
      L.push({x, z, s, sx, sy, sz, yaw, ph}); }
    if (!L.length) return; const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = .78 + .5 * fbm(x * 1.7 + 3, z * 1.7 + y * 1.3 + 5) + (y > .35 ? .18 * fbm(x * 4, z * 4) : 0); p.setXYZ(i, x * k, y * (y > 0 ? k * 1.15 : k * .8), z * k); }
    g.computeVertexNormals(); const im = this.im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({color: 0xdcecf8, roughness: .45, metalness: 0, flatShading: true, emissive: 0x0b1824}), L.length), C = new THREE.Color();
    L.forEach((e, i) => { OBST.push({c: 1, x: e.x, z: e.z, r: e.s * Math.min(e.sx, e.sz) * .92, ice: 1}); this.pose(i, 0); const k = .9 + r() * .12; im.setColorAt(i, C.setRGB(k * (.9 + r() * .08), k, k)); });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.cx = im.boundingSphere.center.x; this.cz = im.boundingSphere.center.z; this.R = im.boundingSphere.radius; scene.add(im); },
  pose(i, t) { const e = this.L[i]; this.E.set(Math.sin(t * .4 + e.ph) * .025, e.yaw, Math.cos(t * .33 + e.ph) * .025, 'YXZ');
    this.im.setMatrixAt(i, this.M4.compose(this.V.set(e.x, -e.s * e.sy * .12 + Math.sin(t * .5 + e.ph) * .3, e.z), this.Q.setFromEuler(this.E), this.S.set(e.s * e.sx, e.s * e.sy, e.s * e.sz))); },
  step(dt) { const im = this.im; if (!im) return; const cp = cam.position; im.visible = Math.hypot(cp.x - this.cx, cp.z - this.cz) - this.R < (G.viewFar || 1600); if (!im.visible || (this.t -= dt) > 0) return; this.t = .25;
    let ch = false; for (let i = 0; i < this.L.length; i++) { const e = this.L[i]; if (Math.abs(e.x - cp.x) > 600 || Math.abs(e.z - cp.z) > 600) continue; this.pose(i, G.wt); ch = true; } if (ch) im.instanceMatrix.needsUpdate = true; },
};
// Ashfall smoke columns over Cinder Cone and Smoke Isle, and the crater's glow at night; drawn without fog but faded by hand so they read from afar
const mapSmoke = {cols: [], glow: [], C: new THREE.Color(), F: new THREE.Color(),
  build() { const r = mulberry(0x5ed), N = 11;
    if (!TX.mapPuff) { TX.mapPuff = new THREE.CanvasTexture(cv(128, 128, (g, w, h) => { for (let i = 0; i < 30; i++) { const x = 64 + (r() - .5) * 56, y = 64 + (r() - .5) * 56, d = 14 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, d); gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } })); TX.mapPuff.colorSpace = THREE.SRGBColorSpace; }
    for (const [nm, big] of [['Cinder Cone', 1], ['Smoke Isle', .6]]) { const I = ISLES.find(q => q.n === nm); if (!I) continue;
      // the summit (or the crater rim) wherever the island's shape put it
      let bx = I.x, bz = I.z, by = -9; for (let a = 0; a < 16; a++) for (let d = 0; d <= .55; d += .05) { const x = I.x + Math.cos(a / 16 * TAU) * d * I.r, z = I.z + Math.sin(a / 16 * TAU) * d * I.r, h = landH(x, z); if (h > by) { by = h; bx = x; bz = z; } }
      const cx = big === 1 ? I.x : bx, cz = big === 1 ? I.z : bz, g = new THREE.Group(); g.visible = false; scene.add(g); const col = {x: cx, y: Math.max(by, 2), z: cz, big, g, s: []};
      for (let i = 0; i < N; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.mapPuff, color: 0x302c28, transparent: true, depthWrite: false, fog: false, opacity: 0})); sp.userData.o = r(); g.add(sp); col.s.push(sp); }
      this.cols.push(col);
      if (big === 1) { const rim = []; for (let a = 0; a < 10; a++) { let best = -9, bp = null; for (let d = .05; d <= .6; d += .025) { const x = I.x + Math.cos(a / 10 * TAU) * d * I.r, z = I.z + Math.sin(a / 10 * TAU) * d * I.r, h = landH(x, z); if (h > best) { best = h; bp = [x, h, z]; } } if (bp) rim.push(bp); }
        for (const [x, y, z] of rim.concat([[I.x, by + 6, I.z]])) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff4a12, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); s.position.set(x, y + 1.5, z); s.scale.setScalar(y > by + 3 ? 46 : 9 + r() * 7); s.userData.ph = r() * TAU; g.add(s); this.glow.push(s); } } } },
  step(dt) { if (!this.cols.length) return; const cp = cam.position, vf = G.viewFar || 1600, fd = scene.fog.density, t = G.wt, day = TOD.day, nt = TOD.night;
    for (const c of this.cols) { const d = Math.hypot(cp.x - c.x, cp.z - c.z); c.g.visible = d < vf + 200 && (G.uw || 0) < .5; if (!c.g.visible) continue;
      const k = 1 - Math.exp(-Math.pow(d * fd * .45, 2)), ga = Math.exp(-d * fd * .4), F = this.F.copy(scene.fog.color);
      for (let i = 0; i < c.s.length; i++) { const sp = c.s[i], p = (t * .012 * (1.3 - c.big * .3) + i / c.s.length + sp.userData.o * .03) % 1, sz = (16 + p * 75) * (.6 + .4 * c.big);
        sp.position.set(c.x + p * p * 70 + Math.sin(t * .2 + i * 1.7) * 4, c.y + 4 + p * 150 * (.6 + .4 * c.big), c.z + p * p * 40 + Math.cos(t * .17 + i) * 4); sp.scale.setScalar(sz);
        const v = .1 + .14 * day, lit = c.big === 1 ? Math.pow(1 - p, 4) * nt : 0; this.C.setRGB(v + lit * .5, v + lit * .14, v + lit * .04).lerp(F, k); sp.material.color.copy(this.C); sp.material.opacity = Math.pow(Math.sin(p * PI), 1.4) * .62 * (1 - k * .8); }
      if (c.big === 1) for (let i = 0; i < this.glow.length; i++) { const s = this.glow[i]; s.material.opacity = (.12 + .78 * nt) * (.75 + .25 * Math.sin(t * 2.3 + s.userData.ph) * Math.sin(t * 3.7 + i)) * Math.min(1, ga * 1.6) * (s.scale.x > 30 ? .35 : 1); } } },
};
// Drowned Graveyard: green lights adrift in the fog, near the water, brighter at night
const mapGhosts = {s: [], g: null,
  build() { const q = REGIONS[4], r = mulberry(0x5ee); this.g = new THREE.Group(); this.g.visible = false; scene.add(this.g);
    for (let k = 0; k < 400 && this.s.length < 12; k++) { const a = r() * TAU, d = Math.sqrt(r()) * q.r * .65, x = q.x + Math.sin(a) * d, z = q.z + Math.cos(a) * d; if (landH(x, z) > -9 || this.s.some(s => Math.hypot(s.userData.x - x, s.userData.z - z) < 120)) continue;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x5affa0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); s.scale.setScalar(2.6 + r() * 1.6); Object.assign(s.userData, {x, z, R: 25 + r() * 40, ph: r() * TAU, sp: .03 + r() * .04}); this.g.add(s); this.s.push(s); } },
  step(dt) { const g = this.g; if (!g) return; const q = REGIONS[4], cp = cam.position, vf = G.viewFar || 1600; g.visible = Math.hypot(cp.x - q.x, cp.z - q.z) < q.r + vf && (G.uw || 0) < .5; if (!g.visible) return; const t = G.wt, fd = scene.fog.density, nt = TOD.night;
    for (const s of this.s) { const u = s.userData, x = u.x + Math.sin(t * u.sp + u.ph) * u.R, z = u.z + Math.cos(t * u.sp * .8 + u.ph * 1.3) * u.R, d = Math.hypot(cp.x - x, cp.z - z); s.visible = d < vf; if (!s.visible) continue;
      s.position.set(x, 1.6 + Math.sin(t * .7 + u.ph) * .8, z); s.material.opacity = (.05 + .85 * nt) * (.55 + .45 * Math.sin(t * 1.9 + u.ph * 3)) * Math.min(1, 1.5 * Math.exp(-d * fd * .5)); } },
};
// region look by camera: fog only thickens (never below the base), colours lean toward the region's tint; a toast the first time you sail in
const MAP_LK = {sea0: null, w: 0};
function mapLook(dt) { const cp = cam.position, q = mapRegion(cp.x, cp.z), w = mapRegion.w, sky = scene.userData.sky && scene.userData.sky.material.uniforms;
  if (!MAP_LK.sea0) MAP_LK.sea0 = MAT.sea.color.clone();
  if (q && w > 0) { const up = (G.uw || 0) <= .5; if (up) scene.fog.density *= mix(1, q.fog, w); scene.fog.color.lerp(q.tc, .15 * w); scene.background.copy(scene.fog.color); if (up && sky && sky.fogC) sky.fogC.value.copy(scene.fog.color); MAT.sea.color.copy(MAP_LK.sea0).lerp(q.tc, .25 * w);
    if (G.on && w > .35 && !mapToastSeen.has(q.k)) { mapToastSeen.add(q.k); toast(q.n, 'New waters'); Snd.discover(); } }
  else if (MAP_LK.w) MAT.sea.color.copy(MAP_LK.sea0);
  MAP_LK.w = q ? w : 0; mapIce.step(dt); mapSmoke.step(dt); mapGhosts.step(dt); }
{ const f0 = buildDeep; buildDeep = function (...a) { const r = f0.apply(this, a); mapFieldMeshes(); mapPoiOrder(); return r; }; }
{ const f0 = buildFw; buildFw = function (...a) { mapPoiOrder(); mapIce.build(); mapSmoke.build(); mapGhosts.build(); return f0.apply(this, a); }; }
{ const f0 = updateWorldFx; updateWorldFx = function (...a) { const r = f0.apply(this, a); mapLook(a[0] || 0); return r; }; }
// ---------------- horror helpers: who is lit, how far out the deep circles, positional dread
// a burning flare makes you visible, though things back off from it up close
const litP = p => p === P ? (lightOn() || (P.eq === 5 && !P.seat)) : (!!p.l || (p.eq === 5 && !p.seat));
// how far out the deep swims at a bearing: the hull outline (centre to far end) grown by m metres, at least lo
function levRad(ang, m = 7, lo = 19) {
  const H = HC(), phi = ang - B.yaw, c = Math.abs(Math.cos(phi)), s = Math.abs(Math.sin(phi)), a = H.L * .56, b = H.W / 2;
  let R = c > 1e-3 ? (a + m) / c : 1e9;
  if (R * s > b) { R = s > 1e-3 ? (b + m) / s : 1e9; if (R * c > a) { const k = a * c + b * s; R = k + Math.sqrt(Math.max(0, k * k - (a * a + b * b - m * m))); } }
  return Math.max(lo, R);
}
// a tone that starts `when` seconds from now on the audio clock
function hTone(f, peak, dec, type = 'sine', dest, when = 0, f2) { if (!A.on) return; const c = A.ctx, t = c.currentTime + when, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); const g = c.createGain(); env(g, t, .01, peak, dec); o.connect(g); g.connect(dest || A.out); o.start(t); o.stop(t + dec + .1); }
// the Steward checks the hiding places of a stateroom, one by one (each with chance D.checkP)
function stwSearch(b) { const S = STS; S.state = 'search'; S.idle = 5; S.chkT = 0; S.chkH = null; S.chk = b.hides.filter(() => CR() < D.checkP); S.chk.sort(() => CR() - .5); stwGo(b.din ? b.din[0] : b.x, b.fy, b.din ? b.din[1] : b.z); }
// persistent voices: the deep's wash and throat on a panner that follows its body, and a growl under the deep drone
function hzInit() {
  const c = A.ctx; if (!c || A.hz) return; A.hz = 1; const mu = A.mute = A.mute || [];
  const p = c.createPanner(); Object.assign(p, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 8, rolloffFactor: 1, maxDistance: 600}); setPan(p, B.x, 0, B.z); p.connect(A.out); A.levPan = p;
  const lg = c.createGain(); lg.gain.value = 0; lg.connect(p); A.levG = lg; mu.push(lg);
  const ns = c.createBufferSource(); ns.buffer = A.noise; ns.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 450; nf.Q.value = .7; ns.connect(nf); nf.connect(lg); ns.start();
  const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 58; const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 180; pk.Q.value = 1; pk.gain.value = 9; const sg = c.createGain(); sg.gain.value = .12; so.connect(pk); pk.connect(sg); sg.connect(lg); so.start();
  const lfo = c.createOscillator(); lfo.frequency.value = .21; const lfg = c.createGain(); lfg.gain.value = 6; lfo.connect(lfg); lfg.connect(so.frequency); lfo.start();
  const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220; const ws = c.createWaveShaper(), cv = new Float32Array(256); for (let i = 0; i < 256; i++) cv[i] = Math.tanh((i / 127.5 - 1) * 2.4); ws.curve = cv; const wg = c.createGain(); wg.gain.value = .5; dl.connect(ws); ws.connect(wg); wg.connect(A.deepG);
  for (const [f, ty, g0] of [[62, 'sawtooth', .5], [93, 'triangle', .35]]) { const o = c.createOscillator(); o.type = ty; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 10; const og = c.createGain(); og.gain.value = g0; o.connect(og); og.connect(dl); o.start(); }
  const hc = c.createBiquadFilter(); hc.type = 'bandpass'; hc.frequency.value = 450; hc.Q.value = 2.5; hc.connect(A.bPan || A.out); A.hcF = hc;
}
Snd.creak = p => { tone(90, .06, .7, 'sawtooth', p || null, 60); burst(700, 6, .1, .6, 'bandpass', p || null, .4); };
Snd.ram = p => { burst(70, 1, 1, 1.5, 'lowpass', p || null, .4); tone(45, .6, 1.2, 'sine', p || null); burst(1500, .5, .25, 1, 'bandpass', p || null, .6); };
// a heartbeat laptop speakers can play: a bandpassed thump plus its 2nd and 3rd harmonics, lub then dub
Snd.heart = k => { if (!A.on) return; const c = A.ctx;
  for (const [w, m] of [[0, 1], [.17, .8]]) { const t = c.currentTime + w, s = c.createBufferSource(); s.buffer = A.noise; const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 180; fl.Q.value = 1.2; const g = c.createGain(); env(g, t, .005, .3 * k * m, .09); s.connect(fl); fl.connect(g); g.connect(A.out); s.start(t, Math.random()); s.stop(t + .2);
    hTone(116, .1 * k * m, .1, 'sine', null, w); hTone(174, .05 * k * m, .08, 'triangle', null, w); } };
Snd.hitTick = head => { burst(3400, 6, .1, .025); tone(head ? 2400 : 1700, .05, .06, 'square'); };
Snd.bell = p => { tone(2350, .04, 1.4, 'triangle', p); tone(3520, .04, 1.4, 'triangle', p); };
Snd.riser = () => { if (!A.on) return; const c = A.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = A.noise; s.loop = true; const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 3; fl.frequency.setValueAtTime(400, t); fl.frequency.exponentialRampToValueAtTime(2500, t + 1.5); const g = c.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.22, t + 1.4); g.gain.exponentialRampToValueAtTime(.0001, t + 1.6); s.connect(fl); fl.connect(g); g.connect(A.out); s.start(t); s.stop(t + 1.7); };
// clients: draw from snapshot state
const GULM = [];
function drawGulpers(dt) {
  const t = G.wt;
  for (let i = 0; i < GN; i++) { const g = GUL[i], o = GULM[i]; const on = g && g.on && (G.uw > .3 || Math.hypot(g.x - cam.position.x, g.z - cam.position.z) < 60);
    if (!on) { if (o) { o.body.visible = o.h.visible = false; o.trail.length = 0; } if (g) g.pst = 0; continue; }
    const m = o || (GULM[i] = gulMesh()); m.body.visible = m.h.visible = true;
    if (!isHost() && g.tx != null) { const k = Math.min(1, dt * 8); g.x = mix(g.x, g.tx, k); g.y = mix(g.y, g.ty, k); g.z = mix(g.z, g.tz, k); g.yaw += angD(g.yaw, g.tyaw) * k; g.pitch = mix(g.pitch, g.tpitch, k); }
    // the cock before a lunge: the lure goes dark and it clicks
    if (g.st === 4 && g.pst !== 4 && G.uw > .3 && Math.hypot(g.x - cam.position.x, g.z - cam.position.z) < 80) Snd.clicks(at(g.x, g.y, g.z, 4)); g.pst = g.st;
    m.lf = mix(m.lf ?? 1, g.st === 4 ? 0 : 1, Math.min(1, dt * (g.st === 4 ? 9 : 2)));
    gulDraw(m, g.x, g.y, g.z, g.yaw, g.pitch, g.st === 2 ? .9 : g.st === 4 ? .5 + Math.sin(t * 24) * .06 : g.st === 1 ? .35 + Math.sin(t * 2) * .1 : .15, t);
    m.gl.material.opacity *= m.lf; m.bulb.scale.setScalar(mix(.3, m.bulb.scale.x, m.lf));
  }
}
// ---------------- world: working boats and cargo traffic, a ghost ship at night, derelicts to board, maydays, shared whales and lightning
// NPC boats run on fixed routes from host time (G.t), so every client draws them in the same place without a per-boat snapshot.
const WLD_MARKS = [], WLD_NPC = [], WLD_DRL = [];
const WLD = {ct: 0, M: null, vis: null, au: null, gh: {on: 0, x: 0, z: 0, yaw: 0, fade: 0, tr: 0}, may: null, snT: 0, mkT: 0, auT: 0, so: false, dropped: [], ta: {x: 0, z: 0}, tb: {x: 0, z: 0}};
const WLD_NAMES = ['Saint Brendan', 'Kittiwake', 'Halcyon Days', 'Dorothea', 'Lucky Strike', 'Marisol', 'Northern Dawn', 'Pelican', 'Sea Wren', 'Brave Heart', 'Moonraker', 'Gannet'];
const WLD_THANKS = ['Thank you. I thought nobody heard me.', 'Two days on that raft. Two days.', 'Something kept bumping the raft from below. Get us out of here.', 'She went down so fast. Thank you.', 'I saw your lights and shouted until my voice went.'];
const wldMR = () => typeof MAP_R === 'number' ? MAP_R : 2600;
const wldMC = () => typeof MAP_C === 'object' && MAP_C ? MAP_C : {x: 0, z: -60};
const wldHW = (t, k = .38) => t < k ? Math.pow(Math.sin(t / k * PI / 2), .7) : 1 - (t - k) * .12;
// night factor straight from G.tod (the host runs logic without rendering, so TOD may be stale there)
function wldNight(t) { t = ((t % 1) + 1) % 1; let i = 0; while (TODK[i + 1][0] < t) i++; const a = TODK[i], b = TODK[i + 1], u = (t - a[0]) / (b[0] - a[0]), k = u * u * (3 - 2 * u); return 1 - clamp((a[1] + (b[1] - a[1]) * k + 22) / 18, 0, 1); }
// open water m metres clear of every island, wreck, buoy, the rig, the Serenade and the Northwatch spot
function wldClear(x, z, m) {
  if (Math.hypot(x, z) < 45 + m || Math.hypot(x - CRZ.x, z - CRZ.z) < 75 + m || Math.hypot(x - 1150, z - 2000) < 90 + m) return false;
  for (const o of OBST) { if (o.npc) continue; if (o.c) { if (Math.abs(x - o.x) < o.r + m && Math.abs(z - o.z) < o.r + m && Math.hypot(x - o.x, z - o.z) < o.r + m) return false; } else { const dx = Math.max(o.x0 - x, 0, x - o.x1), dz = Math.max(o.z0 - z, 0, z - o.z1); if (dx * dx + dz * dz < m * m) return false; } }
  return landH(x, z) < -6;
}
function wldGrave() { if (typeof REGIONS === 'undefined' || !REGIONS) return null; const L = Array.isArray(REGIONS) ? REGIONS : Object.values(REGIONS); return L.find(R => R && R.x != null && (R.k === 'grave' || R.id === 'grave' || R.key === 'grave' || /grave/i.test(R.n || R.name || ''))) || null; }
function wldMark(key, x, z, n, c) { let m = WLD_MARKS.find(q => q.key === key); if (!m) { m = {key, x, z, n, c}; WLD_MARKS.push(m); } Object.assign(m, {x, z, n, c}); return m; }
function wldUnmark(key) { const i = WLD_MARKS.findIndex(q => q.key === key); if (i >= 0) WLD_MARKS.splice(i, 1); }
// ---- routes: a polyline with cumulative lengths; position by arc length
function wldPath(pts, loop) { const n = pts.length, p = new Float32Array(n * 2), cum = new Float32Array(n + 1); let L = 0;
  for (let i = 0; i < n; i++) { p[i * 2] = pts[i][0]; p[i * 2 + 1] = pts[i][1]; cum[i] = L; if (i < n - 1 || loop) { const j = (i + 1) % n; L += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]); } }
  cum[n] = L; return {p, cum, n, L, loop}; }
function wldAt(Q, s, o) { const L = Q.L; s = Q.loop ? ((s % L) + L) % L : clamp(s, 0, L - 1e-3); let lo = 0, hi = Q.n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Q.cum[m] <= s) lo = m; else hi = m - 1; }
  const j = (lo + 1) % Q.n, u = (s - Q.cum[lo]) / Math.max(1e-6, Q.cum[lo + 1] - Q.cum[lo]); o.x = mix(Q.p[lo * 2], Q.p[j * 2], u); o.z = mix(Q.p[lo * 2 + 1], Q.p[j * 2 + 1], u); return o; }
function wldRoute(R, t, o = {}) { const Q = R.path; let s = R.s0 + t * R.v; s = ((s % Q.L) + Q.L) % Q.L; wldAt(Q, s, o); const a = wldAt(Q, s + 9, WLD.ta), b = wldAt(Q, s - 9, WLD.tb); o.yaw = Math.atan2(-(a.x - b.x), -(a.z - b.z)); o.s = s; return o; }
function wldEllipse(cx, cz, a, b, ang, wob, ph, step) { const n = Math.max(32, Math.round(TAU * Math.sqrt((a * a + b * b) / 2) / step)), out = [], ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i < n; i++) { const t = i / n * TAU, k = 1 + wob * Math.sin(2 * t + ph) + wob * .5 * Math.sin(3 * t + ph * 1.7), x = Math.cos(t) * a * k, z = Math.sin(t) * b * k; out.push([cx + x * ca - z * sa, cz + x * sa + z * ca]); } return out; }
function wldBuildTraffic() {
  const r = mulberry(0x7a1f), MR = wldMR(), C = wldMC(); WLD.dropped = [];
  const ok = pts => pts.every(([x, z]) => Math.hypot(x - C.x, z - C.z) < MR - 120 && Math.hypot(x - HOME.x, z - HOME.z) > 140 && wldClear(x, z, 60));
  // push loop points out of every keep-out circle and rect, smooth, repeat: a trawler's loop bends around buoys and reefs instead of being dropped
  const out = (p, cx, cz, m) => { const dx = p[0] - cx, dz = p[1] - cz, d = Math.hypot(dx, dz); if (d >= m) return 0; if (d < 1e-3) { p[0] = cx + m; return 1; } p[0] = cx + dx * m / d; p[1] = cz + dz * m / d; return 1; };
  const relax = pts => { if (!pts) return pts; for (let it = 0; it < 14; it++) { let bad = 0;
    for (const p of pts) { bad += out(p, 0, 0, 112) + out(p, CRZ.x, CRZ.z, 142) + out(p, 1150, 2000, 154) + out(p, HOME.x, HOME.z, 146);
      for (const o of OBST) { if (o.npc) continue; if (o.c) { if (Math.abs(p[0] - o.x) < o.r + 64 && Math.abs(p[1] - o.z) < o.r + 64) bad += out(p, o.x, o.z, o.r + 64); } else { const qx = clamp(p[0], o.x0, o.x1), qz = clamp(p[1], o.z0, o.z1); if (Math.abs(p[0] - qx) < 64 && Math.abs(p[1] - qz) < 64) bad += out(p, qx, qz, 64); } } }
    for (let sm = 0; sm < 2; sm++) { const c = pts.map(q => q.slice()); for (let i = 0; i < pts.length; i++) { const a = c[(i + pts.length - 1) % pts.length], b = c[(i + 1) % pts.length]; pts[i][0] = (a[0] + 2 * c[i][0] + b[0]) / 4; pts[i][1] = (a[1] + 2 * c[i][1] + b[1]) / 4; } }
    if (!bad) break; } return pts; };
  const tryLoop = mk => { for (let k = 0; k < 18; k++) { const pts = relax(mk()); if (ok(pts)) return pts; } return null; };
  const add = (kind, n, pts, loop, L, W, v, col) => { if (!pts) { WLD.dropped.push(n); return; } const path = wldPath(pts, loop), R = {kind, n, path, L, W, v, s0: r() * path.L, col, obst: [], i: WLD_NPC.length, st: {x: 0, z: 0, yaw: 0, s: 0}};
    const nc = Math.max(2, Math.ceil((L - W) / (W * .75)) + 1); for (let c = 0; c < nc; c++) { const o = {c: 1, x: pts[0][0], z: pts[0][1], r: W / 2, npc: 1, lz: mix(-L / 2 + W / 2, L / 2 - W / 2, c / (nc - 1))}; OBST.push(o); R.obst.push(o); }
    WLD_NPC.push(R); };
  // three trawlers working slow loops off Palm Key, Hermit's Isle and Coral Crown
  [['Palm Key', 'Morning Gull'], ["Hermit's Isle", 'Kestrel'], ['Coral Crown', 'Bonny Lass']].forEach(([isle, n]) => { const I = ISLES.find(q => q.n === isle), L = 12 + r() * 5, col = [0x8a2a1c, 0x24486a, 0x2a5a3a, 0xc8c0a8, 0x3a3a6a][Math.floor(r() * 5)];
    add('fish', n, I && tryLoop(() => { const a = 300 + r() * 300; return wldEllipse(I.x + (r() - .5) * 80, I.z + (r() - .5) * 80, a, a * (.65 + r() * .35), r() * PI, .05 + r() * .06, r() * TAU, 14); }), true, L, 4.2 + L * .06, 2.5, col); });
  // a white yacht shuttling between home waters and Palm Key
  { const I = ISLES.find(q => q.n === 'Palm Key');
    add('yacht', 'Silver Lining', I && tryLoop(() => { const hx = 100 + r() * 80, hz = -150 - r() * 60, hd = Math.hypot(I.x - hx, I.z - hz) / 2; return wldEllipse((hx + I.x) / 2, (hz + I.z) / 2, hd + I.r + 80 + r() * 70, I.r + 70 + r() * 60, Math.atan2(I.z - hz, I.x - hx), .04, r() * TAU, 14); }), true, 25, 6, 6, 0xeeeeea); }
  // two cargo ships on long straight lanes across the whole sea; they wrap at the edge
  for (const n of ['Hesper Trader', 'Atlas Bay']) { let pts = null, th = 0;
    for (let k = 0; k < 70 && !pts; k++) { th = r() * TAU; const d = (r() * 2 - 1) * MR * .55, ux = Math.cos(th), uz = Math.sin(th), h = Math.sqrt(MR * MR - d * d) - 80, ox = C.x - uz * d, oz = C.z + ux * d, q = [];
      if (WLD_NPC.some(R => R.kind === 'cargo' && Math.abs(Math.sin(R.th - th)) < .35)) continue;
      for (let s = -h; s <= h; s += 20) q.push([ox + ux * s, oz + uz * s]); if (q.every(([x, z]) => Math.hypot(x - HOME.x, z - HOME.z) > 220 && wldClear(x, z, 60))) pts = q; }
    add('cargo', n, pts, false, 90, 13, 8, [0x1c2a3c, 0x5a1a16, 0x1a3a2a, 0x2a2a2c][Math.floor(r() * 4)]); if (pts) WLD_NPC[WLD_NPC.length - 1].th = th; }
  if (WLD.dropped.length && TEST) console.log('[wld] dropped routes:', WLD.dropped.join(', '));
}
// NPC poses at time t, and their rows of moving OBST circles (the host's boatStep bumps into them)
function wldNpcPlace(t) { for (const R of WLD_NPC) { const o = wldRoute(R, t, R.st), s = Math.sin(o.yaw), c = Math.cos(o.yaw), edge = !R.path.loop && (o.s < 40 || o.s > R.path.L - 40);
  for (const q of R.obst) { q.x = edge ? 1e6 : o.x + q.lz * s; q.z = edge ? 1e6 : o.z + q.lz * c; } } }
// ---- derelicts: listing hulls anchored in open water, walkable decks, a cabin, loot; built from fixed data on every client
function wldDerelicts() {
  const r = mulberry(0xde7e), MR = wldMR(), C = {x: 0, z: -60}, names = WLD_NAMES.slice();
  const far = (x, z) => { if (Math.hypot(x, z) < 300 || Math.hypot(x - CRZ.x, z - CRZ.z) < 400 || Math.hypot(x - 1150, z - 2000) < 300 || Math.hypot(x - HOME.x, z - HOME.z) < 400) return false;
    for (const o of OBST) { if (o.npc) continue; if (o.c) { if (Math.hypot(x - o.x, z - o.z) < o.r + (o.r > 5 ? 300 : 60)) return false; } else { const dx = Math.max(o.x0 - x, 0, x - o.x1), dz = Math.max(o.z0 - z, 0, z - o.z1); if (dx * dx + dz * dz < 300 * 300) return false; } }
    for (const q of DSITES) if (Math.hypot(x - q.x, z - q.z) < q.r + 120) return false;
    return !WLD_DRL.some(d => Math.hypot(d.x - x, d.z - z) < 450) && landH(x, z) < -8; };
  const place = (n, d0, d1, outer) => { for (let k = 0, c = 0; k < 3000 && c < n; k++) { const a = r() * TAU, d = d0 + r() * (d1 - d0), x = Math.round(C.x + Math.sin(a) * d), z = Math.round(C.z + Math.cos(a) * d); if (!far(x, z)) continue; c++; wldDerelict(x, z, r, names.splice(Math.floor(r() * names.length), 1)[0] || 'Derelict', outer); } };
  place(5, 900, 2300, 0); if (typeof MAP_R === 'number' && MR > 3200) place(4, 2700, MR - 300, 1);
}
function wldDerelict(x, z, r, n, outer) {
  const yacht = r() < .4, L = yacht ? 20 + r() * 4 : 15 + r() * 3, W = yacht ? 6.6 : 6.2, hw = W / 2, dk = 'swne'[Math.floor(r() * 4)], th = ROT[dk], fy = 1.2;
  const roll = (r() < .5 ? -1 : 1) * (.02 + r() * .025), pitch = (r() - .5) * .04, b = {x, z, th, fy};
  const D = {n, x, z, th, L, W, yacht, outer, seen: 0, i: WLD_DRL.length}; WLD_DRL.push(D);
  const m4 = new THREE.Matrix4().compose(_v.set(x, 0, z), _q.setFromEuler(_e.set(pitch, th, roll, 'YXZ')), _s.set(1, 1, 1)), m0 = new THREE.Matrix4().compose(_v.set(x, 0, z), _q.setFromEuler(_e.set(0, th, 0, 'YXZ')), _s.set(1, 1, 1));
  const putL = (k, g, tilt = 1) => { g.applyMatrix4(tilt ? m4 : m0); bucket(k).push(g); return g; };
  // hull: rusty (a trawler) or white over rust (a yacht gone to ruin)
  const sheer = t => fy + .7 + .6 * Math.pow(1 - t, 2.2), topP = [[-1, 'top'], [-.99, .2]], topS = [[.99, .2], [1, 'top']], bot = [[-.99, .2], [-.95, -.2], [-.72, -.9], [0, -1.6], [.72, -.9], [.95, -.2], [.99, .2]];
  const hk = yacht ? 'white' : 'rustH'; putL(hk, wldLoft(L, hw, topP, sheer)); putL(hk, wldLoft(L, hw, topS, sheer)); putL('rustH', wldLoft(L, hw, bot, sheer)); putL(hk, wldTransom(L, hw, [[-1, 'top'], ...bot, [1, 'top']], sheer));
  const z0 = -L / 2 + L * .3, z1 = L / 2 - .3, hwd = hw - .35, cz = z1 - 2.2;
  putL('planks', wldDeck(L, hw, fy - .04, -L / 2 + .6, z0 + .1, .3));
  { const s = r() < .5 ? -1 : 1, zb = mix(z0, cz, .3 + r() * .4); putL('dark', wldT(new THREE.BoxGeometry(.12, .7 + r() * .5, 1.2 + r() * 1.4), s * hw * wldHW((zb + L / 2) / L) * .99, .25, zb)); } // a hull breach near the waterline
  if (yacht) for (const s of [-1, 1]) putL('steel', wldT(new THREE.BoxGeometry(.05, .05, L * .5), s * (hw - .14), fy + .95, L * .12));
  // the walkable deck, rails with a gap at the boarding ladder, and the cabin
  const R4 = (lx0, lx1, lz0, lz1) => rectW(b, lx0, lx1, lz0, lz1), sd = r() < .5 ? -1 : 1, lzL = mix(z0 + 1.5, cz - 3, r());
  { const q = R4(-hwd, hwd, z0, z1); slab(q.x0, q.x1, q.z0, q.z1, fy, 'planks'); }
  const rl = (lx0, lx1, lz0, lz1) => { const q = R4(lx0, lx1, lz0, lz1); rail(q.x0, q.x1, q.z0, q.z1, fy, 'rustR'); };
  rl(-hwd, hwd, z0, z0); for (const s of [-1, 1]) { if (s === sd) { rl(s * hwd, s * hwd, z0, lzL - .7); rl(s * hwd, s * hwd, lzL + .7, cz - 2.3); } else rl(s * hwd, s * hwd, z0, cz - 2.3); }
  { const [cx, czw] = L2W(b, 0, cz), cab = building('cabin', n + ' cabin', cx, czw, fy, dk); cab.wreck = {n, derelict: 1}; D.cab = cab; }
  // boarding ladder over the side
  { const lx = sd * (hw + .06); for (let y = -1.1; y < fy; y += .34) putL('rustR', wldT(new THREE.BoxGeometry(.05, .05, .62), lx, y, lzL), 0); for (const e of [-.32, .32]) putL('rustR', wldT(new THREE.BoxGeometry(.06, fy + 1.9, .06), lx, (fy - 1.3) / 2 + .3, lzL + e), 0);
    const [ix, iz] = L2W(b, sd * (hw + .8), lzL), [tx, tz] = L2W(b, sd * (hwd - .7), lzL); INTER.push({kind: 'ladder', x: ix, y: 0, z: iz, r: 3.5, top: [tx, fy, tz], label: () => 'Climb aboard', on: () => P.sw}); D.lad = [ix, iz]; }
  // a broken mast, its yard across the deck, a snarl of net
  { const mz = mix(z0 + .8, cz - 3.2, .5), h = 2 + r() * 4, tl = (.17 + r() * .44) * (r() < .5 ? -1 : 1), [mx, mzw] = L2W(b, 0, mz);
    putL('log', wldT(new THREE.CylinderGeometry(.11, .16, h, 7), Math.sin(tl) * h / 2, fy + Math.cos(tl) * h / 2, mz, 0, 0, -tl), 0); PCIRC.push({x: mx, z: mzw, r: .3});
    putL('log', wldT(new THREE.CylinderGeometry(.07, .08, W * .9, 6), 0, fy + .08, mz + 1.2 + r(), r() * .6 - .3, 0, PI / 2), 0);
    putL('dark', wldT(new THREE.BoxGeometry(1.2, .25, .9), -sd * (hwd - .9), fy + .12, z0 + .9, r()), 0); }
  // 2-4 loot spots on the open deck
  for (let k = 0, c = 0, nn = 2 + Math.floor(r() * 3); k < 40 && c < nn; k++) { const lx = (r() * 2 - 1) * (hwd - .6), lz = mix(z0 + .7, cz - 2.7, r()), [sx, szw] = L2W(b, lx, lz);
    if (SPOTS.some(q => q.tag === 'drl' && Math.hypot(q.x - sx, q.z - szw) < 1.4) || Math.abs(lz - lzL) < 1.4 && Math.sign(lx) === sd) continue; c++; spot('drl', sx, fy + .05, szw); }
  // solid below the deck for swimmers, a rect for boats
  const hr = R4(-hw, hw, -L / 2, L / 2); WALLS.push(Object.assign(hr, {y0: -3, y1: fy - .3, see: false})); OBST.push(Object.assign(R4(-hw - .2, hw + .2, -L / 2 - .3, L / 2 + .3), {drl: 1}));
}
// ---- geometry helpers (bow at local -z, like the player's boat)
function wldT(g, x, y, z, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(_m4.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1))); return g; }
function wldB(sx, sy, sz, x, y, z, ry = 0, tile = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); if (tile) boxUV(g, sx, sy, sz, tile); return wldT(g, x, y, z, ry); }
function wldC(r0, r1, h, x, y, z, rx = 0, rz = 0, seg = 8) { return wldT(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, 0, rx, rz); }
function wldRod(a, b, r) { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1, g = new THREE.CylinderGeometry(r, r, l, 5); _q.setFromUnitVectors(_s.set(0, 1, 0), _v.set(dx / l, dy / l, dz / l)); g.applyMatrix4(_m4.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1))); return g; }
function wldLoft(L, hw, prof, sheer, nz = 16) { const np = prof.length, pos = [], uv = [], idx = [];
  for (let i = 0; i <= nz; i++) { const t = i / nz, z = -L / 2 + L * t, w = hw * wldHW(t), top = sheer(t); for (const [f, y0] of prof) { const y = y0 === 'top' ? top : y0; pos.push(w * f, y, z); uv.push(z / 3, y / 3 + f * 2); } }
  for (let i = 0; i < nz; i++) for (let k = 0; k < np - 1; k++) { const a = i * np + k, b = a + 1, c = a + np, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }
function wldTransom(L, hw, prof, sheer) { const w = hw * wldHW(1), top = sheer(1), sh = new THREE.Shape(); prof.forEach(([f, y0], k) => { const y = y0 === 'top' ? top : y0; if (k) sh.lineTo(w * f, y); else sh.moveTo(w * f, y); }); sh.closePath(); const g = new THREE.ShapeGeometry(sh); g.translate(0, 0, L / 2); return g; }
function wldDeck(L, hw, y, z0, z1, inset = .15) { const sh = new THREE.Shape(), n = 14, pts = []; for (let i = 0; i <= n; i++) { const z = mix(z0, z1, i / n); pts.push([Math.max(.05, hw * wldHW((z + L / 2) / L) - inset), z]); }
  pts.forEach(([w, z], i) => i ? sh.lineTo(w, -z) : sh.moveTo(w, -z)); for (let i = n; i >= 0; i--) sh.lineTo(-pts[i][0], -pts[i][1]); const g = new THREE.ShapeGeometry(sh); g.rotateX(-PI / 2); g.translate(0, y, 0); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * .5, u.getY(i) * .5); return g; }
function wldMats() { if (WLD.M) return WLD.M; const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .6, metalness: .1, side: THREE.DoubleSide}, o));
  WLD.M = {bot: S({color: 0x1c1e20, roughness: .85}), botR: S({color: 0x6a1a12, roughness: .8}), botY: S({color: 0x14203a, roughness: .4}), hull: {}, raft: S({color: 0xff6410, roughness: .7, emissive: 0x401000}), skin: S({color: 0xc89878, roughness: .8}), jacket: S({color: 0xe0b020, roughness: .7})};
  WLD.M.h = c => WLD.M.hull[c] || (WLD.M.hull[c] = S({color: c, roughness: c === 0xeeeeea ? .35 : .55})); return WLD.M; }
// one NPC hull: low-poly lofts merged by material (<= 6 draw calls). Returns the group and its light offsets [x, y, z, r, g, b].
function wldNpcMesh(R) {
  const M = wldMats(), L = R.L, W = R.W, hw = W / 2, list = [], Lt = [], rr = mulberry(0x7a1f ^ (R.i + 1) * 0x9e37), add = (g, m, cs = 1) => list.push([g, m, cs]);
  const loft = (fb, bow, dep, hullM, botM) => { const sheer = t => fb + .45 + bow * Math.pow(1 - t, 2.2), topP = [[-1, 'top'], [-.99, .3]], topS = [[.99, .3], [1, 'top']], bot = [[-.99, .3], [-.96, -.2], [-.74, -dep * .55], [0, -dep], [.74, -dep * .55], [.96, -.2], [.99, .3]];
    add(wldLoft(L, hw, topP, sheer), hullM); add(wldLoft(L, hw, topS, sheer), hullM); add(wldLoft(L, hw, bot, sheer), botM, 0); add(wldTransom(L, hw, [[-1, 'top'], ...bot, [1, 'top']], sheer), hullM, 0); };
  if (R.kind === 'fish') { const fb = 1.25, hm = M.h(R.col), zc = -L * .14; loft(fb, .75, 1.2, hm, M.bot); add(wldDeck(L, hw, fb, -L / 2 + L * .08, L / 2, .2), MAT.wood, 0);
    add(wldB(W * .62, 2, L * .2, 0, fb + 1, zc), MAT.white); add(wldB(W * .7, .14, L * .24, 0, fb + 2.07, zc), M.bot); add(wldB(W * .57, .55, .06, 0, fb + 1.45, zc - L * .1 - .01), MAT.glass, 0);
    for (const s of [-1, 1]) add(wldB(.06, .5, L * .12, s * W * .312, fb + 1.45, zc), MAT.glass, 0);
    add(wldC(.06, .09, 5, 0, fb + 4.5, zc + .4), MAT.steel); add(wldB(1.8, .06, .06, 0, fb + 4.4, zc + .4), MAT.steel); add(wldRod([0, fb + 4, zc + .4], [0, fb + 2.4, L * .3], .05), MAT.steel);
    const gz = L * .44; for (const s of [-1, 1]) { add(wldRod([s * W * .4, fb, gz], [s * W * .3, fb + 3.3, gz - .4], .09), MAT.steel); add(wldRod([s * W * .3, fb + 3.2, gz - .4], [s * W * .75, -1.2, L / 2 + 16], .025), MAT.steel, 0); }
    add(wldB(W * .66, .16, .16, 0, fb + 3.3, gz - .4), MAT.steel); add(wldC(.62, .62, W * .48, 0, fb + .75, L * .26, 0, PI / 2, 14), M.bot); for (const s of [-1, 1]) add(wldC(.78, .78, .06, s * W * .25, fb + .75, L * .26, 0, PI / 2, 14), MAT.steel);
    for (let i = 0; i < 4; i++) add(wldB(.5, .35, .6, (rr() - .5) * W * .5, fb + .18, L * (.05 + rr() * .1), rr()), M.bot, 0); // fish boxes
    Lt.push([0, fb + 4.95, zc + .4, .2, 1.6, .4], [0, fb + 4.55, zc + .4, 1.5, 1.5, 1.4], [-W * .36, fb + 2.1, zc - L * .06, 1.6, .15, .1], [W * .36, fb + 2.1, zc - L * .06, .15, 1.5, .3], [0, fb + .9, L / 2, 1.3, 1.3, 1.2], [-W * .3, fb + 3.4, gz - .4, 1.5, 1.05, .55], [W * .3, fb + 3.4, gz - .4, 1.5, 1.05, .55]);
    R.gz = [0, fb + 3.5, gz]; R.hk = .9; }
  else if (R.kind === 'yacht') { const fb = 1.6, hm = M.h(R.col); loft(fb, .6, 1.3, hm, M.botY); add(wldDeck(L, hw, fb, -L / 2 + 1, L / 2, .25), MAT.wood, 0);
    add(wldB(W * .74, 1.9, L * .42, 0, fb + .95, -L * .02), hm); add(wldB(W * .75, .62, L * .38, 0, fb + 1.25, -L * .03), MAT.glass, 0); add(wldB(W * .6, 1.4, L * .24, 0, fb + 2.6, L * .03), hm); add(wldB(W * .61, .5, L * .2, 0, fb + 2.7, L * .02), MAT.glass, 0);
    add(wldB(W * .68, .12, L * .3, 0, fb + 3.36, L * .1), hm); for (const s of [-1, 1]) { add(wldRod([s * W * .3, fb + 3.3, L * .2], [s * W * .2, fb + 4.8, L * .14], .07), MAT.steel); add(wldB(.04, .04, L * .5, s * (hw - .15), fb + .9, L * .12), MAT.steel, 0); }
    add(wldB(W * .45, .1, .4, 0, fb + 4.8, L * .14), MAT.steel); add(wldC(.05, .05, 1.6, 0, fb + 5.6, L * .14), MAT.steel); add(wldB(1.4, .12, .12, 0, fb + 5.2, L * .14), MAT.steel);
    Lt.push([0, fb + 6.4, L * .14, 1.5, 1.5, 1.4], [-W * .4, fb + 2.3, -L * .16, 1.6, .15, .1], [W * .4, fb + 2.3, -L * .16, .15, 1.5, .3], [0, fb + .6, L / 2, 1.3, 1.3, 1.2], [-W * .38, fb + 1.2, -L * .05, 1.6, 1.1, .55], [W * .38, fb + 1.2, L * .08, 1.6, 1.1, .55], [0, fb + 2.7, L * .16, 1.6, 1.1, .55]);
    R.hk = .7; }
  else { const fb = 3.2, hm = M.h(R.col); loft(fb, 2.2, 4.4, hm, M.botR); add(wldDeck(L, hw, fb, -L * .45, L / 2, .3), MAT.dark, 0);
    const sz = L * .37, sw = W * .86; add(wldB(sw, 10, L * .13, 0, fb + 5, sz), MAT.white); add(wldB(W * 1.04, 2.2, 4.6, 0, fb + 11.1, L * .33), MAT.white);
    for (const y of [3, 5.6, 8.2]) add(wldB(sw + .04, .5, L * .132, 0, fb + y, sz), MAT.dark, 0); add(wldB(W * 1.05, .7, 4.65, 0, fb + 11.4, L * .33), MAT.dark, 0);
    add(wldB(3.2, 5, 4, 0, fb + 12.5, L * .43), hm); add(wldB(3.3, .8, 4.1, 0, fb + 15.3, L * .43), MAT.dark); add(wldC(.15, .22, 5, 0, fb + 14.7, L * .34), MAT.dark); add(wldB(2.4, .12, .12, 0, fb + 16, L * .34), MAT.dark);
    add(wldC(.25, .32, 9, 0, fb + 6, -L * .43), MAT.dark); add(wldB(3, .14, .14, 0, fb + 8.5, -L * .43), MAT.dark);
    for (let b = 0; b < 5; b++) { const zc = -L * .35 + b * 12.8; if (zc + 6 > L * .29) break; const wd = hw * Math.min(wldHW((zc - 6 + L / 2) / L), wldHW((zc + 6 + L / 2) / L)) - .5, nr = Math.max(1, Math.floor(wd * 2 / 2.55));
      for (let q = 0; q < nr; q++) { const x = (q - (nr - 1) / 2) * 2.55, tiers = 1 + Math.floor(rr() * 3.4); for (let k = 0; k < tiers; k++) { if (k && rr() < .1) break; add(wldB(2.44, 2.55, 12.1, x, fb + 1.3 + k * 2.6, zc, 0, 3), rr() < .55 ? MAT.cont : MAT.cont2); } } }
    Lt.push([0, fb + 11, -L * .43, 1.5, 1.5, 1.4], [0, fb + 16.4, L * .34, 1.5, 1.5, 1.4], [-W * .54, fb + 11.8, L * .33, 1.6, .15, .1], [W * .54, fb + 11.8, L * .33, .15, 1.5, .3], [0, fb + 1.5, L / 2, 1.3, 1.3, 1.2]);
    for (const z of [-.3, -.05, .2]) for (const s of [-1, 1]) Lt.push([s * hw * .8, fb + 9, L * z, 1.5, 1.1, .6]); Lt.push([-sw / 2, fb + 6, sz, 1.6, 1.1, .55], [sw / 2, fb + 3.5, sz, 1.6, 1.1, .55]);
    R.hk = .3; }
  const g = new THREE.Group(); for (const m of mergeByMat(list)) { m.receiveShadow = false; g.add(m); } g.visible = false; scene.add(g); R.lt = Lt; return g;
}
// ---- the ghost ship: a glowing hull, tattered additive sails, cold mist
function wldGhostMesh() {
  const L = 36, hw = 4.6, list = [], gm = new THREE.MeshStandardMaterial({color: 0x0c1814, map: TX.rustH, emissive: 0x2aff9a, emissiveMap: TX.rustH, emissiveIntensity: .7, roughness: .9, metalness: 0, transparent: true, opacity: 1, side: THREE.DoubleSide});
  const st = tex(cv(128, 256, (q, w, h) => { const gr = q.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(200,255,230,.85)'); gr.addColorStop(1, 'rgba(120,220,180,.35)'); q.fillStyle = gr; q.fillRect(0, 0, w, h); q.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) { q.beginPath(); q.ellipse(Math.random() * w, Math.random() * h, 3 + Math.random() * 14, 4 + Math.random() * 22, Math.random(), 0, TAU); q.fill(); }
    q.beginPath(); q.moveTo(0, h); for (let x = 0; x <= w; x += 8) q.lineTo(x, h - 10 - Math.random() * 60); q.lineTo(w, h); q.fill(); for (let y = 0; y < h; y += 4) { q.fillStyle = `rgba(0,0,0,${Math.random() * .25})`; q.fillRect(0, y, w, 2); } }), 1);
  const sm = new THREE.MeshBasicMaterial({map: st, color: 0x6affc8, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true});
  const sheer = t => 2.6 + 1.8 * Math.pow(1 - t, 2) + 2.6 * smooth((t - .72) / .18), bot = [[-1, 'top'], [-.98, .2], [-.8, -1.6], [0, -3], [.8, -1.6], [.98, .2], [1, 'top']];
  list.push([wldLoft(L, hw, bot, sheer, 18), gm, 0], [wldTransom(L, hw, bot, sheer), gm, 0], [wldDeck(L, hw, 2.4, -L / 2 + 2, L / 2, .25), gm, 0], [wldB(hw * 1.7, 2.2, 7, 0, 4.4, L * .38), gm, 0], [wldRod([0, 3, -L / 2 + 1], [0, 7, -L / 2 - 8], .2), gm, 0]);
  const sails = []; [[-L * .24, 19, 7.5], [0, 23, 9], [L * .24, 16, 6.5]].forEach(([z, h, w]) => { list.push([wldC(.18, .3, h, 0, 2.4 + h / 2, z), gm, 0]); for (const y of [.42, .78]) { list.push([wldC(.1, .1, w * 1.1, 0, 2.4 + h * y, z, 0, PI / 2), gm, 0]);
    const p = new THREE.PlaneGeometry(w, h * .32, 6, 3), a = p.attributes.position; for (let i = 0; i < a.count; i++) { const u = a.getX(i) / w + .5; a.setZ(i, Math.sin(u * PI) * 1.3 + Math.sin(a.getY(i) * 2 + u * 7) * .2); } p.computeVertexNormals(); sails.push(wldT(p, 0, 2.4 + h * (y - .17), z + .3)); } });
  const g = new THREE.Group(); for (const m of mergeByMat(list)) { m.castShadow = false; g.add(m); } const sg = new THREE.Mesh(mergeGeos(sails), sm); sg.renderOrder = 5; g.add(sg);
  const mist = [], glow = []; for (let i = 0; i < 9; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x8affd8, transparent: true, opacity: 0, depthWrite: false, fog: true})); s.scale.set(26 + Math.random() * 18, 7 + Math.random() * 5, 1); s.userData.p = [(Math.random() - .5) * 30, 1.5 + Math.random() * 2, (Math.random() - .5) * 50, Math.random() * TAU]; g.add(s); mist.push(s); }
  for (const [x, y, z] of [[0, 7.4, L * .45], [-hw, 4, L * .1], [hw, 4, -L * .2], [0, 26, 0]]) { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x5affa8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); s.scale.setScalar(3.2); s.position.set(x, y, z); g.add(s); glow.push(s); }
  g.visible = false; scene.add(g); return {g, gm, sm, mist, glow};
}
// ---- the life raft with a waving survivor
function wldRaftMesh() { const M = wldMats(), g = new THREE.Group(), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const ring = add(new THREE.TorusGeometry(1.1, .3, 8, 18), M.raft, 0, .15, 0); ring.rotation.x = PI / 2; add(new THREE.CylinderGeometry(1.05, 1.05, .08, 16), M.bot, 0, 0, 0);
  const can = add(new THREE.SphereGeometry(1, 12, 6, 0, PI, 0, PI / 2), M.raft, 0, .3, 0); can.scale.set(1.1, 1.2, 1.1); can.rotation.y = PI / 2; add(new THREE.CylinderGeometry(.03, .03, 1.4, 4), MAT.steel, 0, 1.3, 0);
  const man = new THREE.Group(); man.position.set(.45, .1, .2); g.add(man); const b = new THREE.Mesh(new THREE.CylinderGeometry(.2, .24, .75, 8), M.jacket); b.position.y = .45; man.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8), M.skin); h.position.y = .98; man.add(h);
  const arm = new THREE.Group(); arm.position.set(.2, .78, 0); man.add(arm); const a = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .62, 6), M.jacket); a.position.y = .3; arm.add(a);
  const sb = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); sb.scale.setScalar(4); sb.position.y = 2.1; g.add(sb);
  g.visible = false; scene.add(g); return {g, arm, man, sb}; }
// ---- client visuals, built on first use
function wldVisInit() {
  const V = WLD.vis = {npc: [], n: 0}; for (const R of WLD_NPC) { R.m = wldNpcMesh(R); R.li = V.n; V.n += R.lt.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, V.n) * 3).fill(-9999), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(1, V.n) * 3), 3));
  V.pts = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size: 2.4, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); V.pts.frustumCulled = false; V.pts.renderOrder = 6; scene.add(V.pts);
  // gulls over the nearest trawler by day
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute([-.8, .14, -.1, 0, 0, .28, 0, 0, -.16, .8, .14, -.1, 0, 0, .28, 0, 0, -.16], 3)); bg.computeVertexNormals();
  V.gull = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({color: 0xd8dcdc, side: THREE.DoubleSide}), 7); V.gull.frustumCulled = false; V.gull.visible = false; scene.add(V.gull); V.gph = [...Array(7)].map(() => [Math.random() * TAU, 6 + Math.random() * 10, 6 + Math.random() * 7, .25 + Math.random() * .2, Math.random() * TAU]);
}
const _wm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _we = new THREE.Euler(), _ws = new THREE.Vector3(1, 1, 1);
function wldST(prm, v, tc = .3) { const t = A.ctx.currentTime; prm.cancelScheduledValues(t); prm.setTargetAtTime(v, t, tc); prm.setTargetAtTime(0, t + .6, .25); }
function wldAuInit() { const c = A.ctx; if (!c || WLD.au || !A.out) return; const mu = A.mute = A.mute || [];
  const P2 = ref => { const p = c.createPanner(); Object.assign(p, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1, maxDistance: 1200}); p.connect(A.out); return p; };
  // one shared engine hum, moved to whichever working boat is closest
  const hp = P2(16), hg = c.createGain(); hg.gain.value = 0; hg.connect(hp); const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 150; hf.Q.value = 1.2; hf.connect(hg);
  for (const [f, ty] of [[38, 'sawtooth'], [38.7, 'sawtooth'], [57, 'triangle']]) { const o = c.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(hf); o.start(); }
  { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 6.5; lg.gain.value = 45; l.connect(lg); lg.connect(hf.frequency); l.start(); }
  // the ghost choir: an open minor chord on breathy voices through two vowel formants, and a whisper riding a slow swell
  const gp = P2(40), gg = c.createGain(); gg.gain.value = 0; gg.connect(gp); const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(); f1.type = f2.type = 'bandpass'; f1.frequency.value = 640; f1.Q.value = 2.2; f2.frequency.value = 1080; f2.Q.value = 3; f1.connect(gg); f2.connect(gg);
  for (const [f, ty] of [[110, 'sawtooth'], [130.8, 'sawtooth'], [164.8, 'triangle'], [220, 'sawtooth'], [261.6, 'triangle']]) { const o = c.createOscillator(), og = c.createGain(), v = c.createOscillator(), vg = c.createGain(); o.type = ty; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 20; v.frequency.value = 4 + Math.random() * 1.5; vg.gain.value = f * .012; v.connect(vg); vg.connect(o.frequency); og.gain.value = .22; o.connect(og); og.connect(f1); og.connect(f2); o.start(); v.start(); }
  { const ns = c.createBufferSource(), nf = c.createBiquadFilter(), nw = c.createGain(), wl = c.createOscillator(), wg = c.createGain(); ns.buffer = A.noise; ns.loop = true; nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 1.4; nw.gain.value = .25; wl.frequency.value = .31; wg.gain.value = .22; wl.connect(wg); wg.connect(nw.gain); ns.connect(nf); nf.connect(nw); nw.connect(gg); ns.start(); wl.start(); }
  mu.push(hg, gg); WLD.au = {hp, hg, gp, gg}; }
Snd.wldHum = (x, y, z, k) => { if (!A.on || !WLD.au) return; setPan(WLD.au.hp, x, y, z); wldST(WLD.au.hg.gain, .085 * k); };
Snd.wldChoir = (x, y, z, k) => { if (!A.on || !WLD.au) return; setPan(WLD.au.gp, x, y, z); wldST(WLD.au.gg.gain, .07 * k, .8); };
Snd.wldHorn = p => { if (!A.on) return; const c = A.ctx, t = c.currentTime + .02, f = c.createBiquadFilter(), g = c.createGain(), dl = c.createDelay(2), fb = c.createGain(), d = p || A.out; f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = .7;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.1, t + .35); g.gain.setValueAtTime(.1, t + 2.6); g.gain.exponentialRampToValueAtTime(.0001, t + 3.5); dl.delayTime.value = 1.15; fb.gain.value = .26; f.connect(g); g.connect(d); g.connect(dl); dl.connect(fb); fb.connect(dl); fb.connect(d);
  for (const fr of [65, 65.4, 97.6, 130.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fr * .95, t); o.frequency.exponentialRampToValueAtTime(fr, t + .45); o.connect(f); o.start(t); o.stop(t + 3.6); } };
Snd.wldGull = p => { const k = .7 + Math.random() * .5; tone(1900 * k, .035, .32, 'triangle', p, 1150 * k); setTimeout(() => tone(2000 * k, .03, .4, 'triangle', p, 1100 * k), 260 + Math.random() * 120); burst(3000 * k, 4, .02, .2, 'bandpass', p); };
Snd.wldShout = p => { if (!A.on) return; const c = A.ctx; for (const [w, f0, f1] of [[0, 230, 330], [.55, 250, 190]]) { const t = c.currentTime + w, o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + .4); fl.type = 'bandpass'; fl.frequency.value = 850; fl.Q.value = 2.5; env(g, t, .05, .12, .45); o.connect(fl); fl.connect(g); g.connect(p || A.out); o.start(t); o.stop(t + .6); } };
Snd.wldRadio = sad => { for (let i = 0; i < 7; i++) setTimeout(() => burst(1700 + Math.random() * 900, .9, .05, .08 + Math.random() * .1, 'bandpass'), i * 90 + Math.random() * 60); if (sad) { tone(440, .03, 1.2, 'triangle', null, 220); setTimeout(() => burst(1400, .5, .06, 1.4, 'bandpass'), 700); } else { tone(880, .025, .15, 'square'); setTimeout(() => tone(880, .025, .15, 'square'), 220); } };
// ---- host: the ghost ship, maydays, cargo spills, whales, lightning
function wldGhostSpawn() {
  const Rg = wldGrave(), inG = !!Rg && Math.hypot(B.x - Rg.x, B.z - Rg.z) - (Rg.r || 0) < 2000, MR = wldMR(), C = wldMC();
  for (let k = 0; k < 24; k++) { const g = inG && k < 16, a = g ? Math.atan2(Rg.x - B.x, Rg.z - B.z) + (CR() - .5) * 1.8 : CR() * TAU, d = 500 + CR() * 400, x = B.x + Math.sin(a) * d, z = B.z + Math.cos(a) * d;
    if (g && Math.hypot(x - Rg.x, z - Rg.z) > (Rg.r || 0) * .95) continue; if (Math.hypot(x - C.x, z - C.z) > MR - 150 || !wldClear(x, z, 80)) continue;
    const sd = CR() < .5 ? -1 : 1, off = 60 + CR() * 100, tx = B.x + Math.cos(a) * sd * off, tz = B.z - Math.sin(a) * sd * off;
    return {on: 1, x, z, yaw: Math.atan2(-(tx - x), -(tz - z)), tr: (CR() - .5) * .012, t0: G.t, fade: 0}; }
  return null;
}
function wldGhostStep(dt) {
  const nt = wldNight(G.tod); let gh = G.wldGh; if (nt < .25) G.wldGhDone = 0;
  if (!gh || !gh.on) { if (nt > .6 && !G.wldGhDone && B.sink <= 0 && Math.hypot(B.x - HOME.x, B.z - HOME.z) > 900 && (G.wldGhT = (G.wldGhT ?? 2) - dt) <= 0) { G.wldGhT = 3; const q = wldGhostSpawn(); if (q) { G.wldGh = gh = q; G.wldGhDone = 1; emit({k: 'wghost', on: 1, x: +q.x.toFixed(1), z: +q.z.toFixed(1), yaw: +q.yaw.toFixed(3), tr: +q.tr.toFixed(4)}); } } return; }
  gh.yaw += gh.tr * dt; gh.x -= Math.sin(gh.yaw) * 3 * dt; gh.z -= Math.cos(gh.yaw) * 3 * dt;
  const d = Math.hypot(B.x - gh.x, B.z - gh.z);
  if (!gh.fade && (d < 150 || nt < .3)) { gh.fade = .001; gh.dawn = nt < .3; emit({k: 'wghost', on: 2});
    if (!gh.dawn) { const ki = KINDS.indexOf('relic'); for (let k = 0; k < 3; k++) { const b = 18 + k * 10, s = (CR() - .5) * 10, x = gh.x + Math.sin(gh.yaw) * b + Math.cos(gh.yaw) * s, z = gh.z + Math.cos(gh.yaw) * b - Math.sin(gh.yaw) * s; if (landH(x, z) > -1.5) continue; let i = G.floats.findIndex(q => !q); if (i < 0) i = G.floats.length; G.floats[i] = [x, z, ki]; } } }
  if (gh.fade) gh.fade = Math.min(1, gh.fade + dt / (gh.dawn ? 4 : 8));
  if (gh.fade >= 1 || d > 2800) { gh.on = 0; G.wldGh = null; emit({k: 'wghost', on: 0}); }
}
// force or roll a mayday (host): a spot in open water 600-1500 m from the boat
function wldMayday(x, z) {
  if (!isHost() || G.wldMay) return null; const MR = wldMR(), C = wldMC();
  if (x == null) for (let k = 0; k < 30; k++) { const a = CR() * TAU, d = 600 + CR() * 900, qx = B.x + Math.sin(a) * d, qz = B.z + Math.cos(a) * d; if (Math.hypot(qx - C.x, qz - C.z) < MR - 150 && wldClear(qx, qz, 50)) { x = qx; z = qz; break; } }
  if (x == null) return null; G.wldMay = {x: +x.toFixed(1), z: +z.toFixed(1), t: 240}; emit({k: 'wmay', x: G.wldMay.x, z: G.wldMay.z, t: 240}); return G.wldMay;
}
function wldHostStep(dt) {
  wldGhostStep(dt);
  // maydays: one every 6-10 minutes of sea time out past 400 m
  const q = G.wldMay; if (q) { q.t -= dt; if (q.t <= 0) { G.wldMay = null; G.wldMayT = 360 + CR() * 240; emit({k: 'wmay', x: q.x, z: q.z, t: 0}); } }
  else if (B.sink <= 0 && Math.hypot(B.x - HOME.x, B.z - HOME.z) > 400 && (G.wldMayT = (G.wldMayT ?? 360 + CR() * 240) - dt) <= 0) { G.wldMayT = 360 + CR() * 240; wldMayday(); }
  // a storm hits: cargo ships within 2 km lose a few containers over the side
  if (G.stormOn && !WLD.so) for (const R of WLD_NPC) { if (R.kind !== 'cargo' || Math.hypot(R.st.x - B.x, R.st.z - B.z) > 2000 || !R.path.loop && (R.st.s < 60 || R.st.s > R.path.L - 60)) continue;
    const n = 4 + Math.floor(CR() * 3), s = Math.sin(R.st.yaw), c = Math.cos(R.st.yaw), ki = KINDS.indexOf('crate'); let got = 0;
    for (let k = 0; k < n; k++) { const b = R.L / 2 + 8 + CR() * 60, l = (CR() - .5) * 30, x = R.st.x + s * b + c * l, z = R.st.z + c * b - s * l; if (landH(x, z) > -1.5) continue; let i = G.floats.findIndex(f => !f); if (i < 0) i = G.floats.length; G.floats[i] = [x, z, ki]; got++; }
    if (got) emit({k: 'wspill', x: +R.st.x.toFixed(0), z: +R.st.z.toFixed(0), n: R.n}); }
  WLD.so = !!G.stormOn;
  // whale breaches everyone sees: near a random crew member aboard, in calm water
  if ((G.wldWhT = (G.wldWhT ?? 40) - dt) <= 0) { G.wldWhT = 70 + CR() * 80; const crew = alive().filter(p => p.ob || p.seat);
    if (G.storm < .4 && crew.length) { const p = crew[Math.floor(CR() * crew.length)], a = CR() * TAU, r = 70 + CR() * 60, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r; if (landH(x, z) < -4 && !nearRig(x, z)) emit({k: 'wwhale', x: +x.toFixed(1), z: +z.toFixed(1), a: +(CR() * TAU).toFixed(2)}); } }
  // online lightning comes from the host so every crew sees the same bolt
  if (Net.role === 'host' && (G.wldBoltT = (G.wldBoltT ?? 8) - dt) <= 0) { G.wldBoltT = 8 + Math.random() * 20; if (G.storm > .6) emit({k: 'wbolt', d: Math.round(600 + Math.random() * 2500)}); }
}
// ---- client events
function wldMayOn(x, z, t, quiet) { WLD.may = {x, z, t, rk: quiet ? 50 : 0, shT: 2, crT: 3, ph: Math.random() * TAU}; wldMark('may', x, z, 'MAYDAY', '#ff4030');
  if (!quiet) { spawnRocket({x, y: 1, z, vx: 0, vy: 34, vz: 0, c: 0}); Snd.wldRadio(0); if (P && Math.hypot(P.x - x, P.z - z) < 3000) showMsg('"Mayday, mayday… we\'re going down…" A red flare climbs into the sky.', 'RADIO', 5); } }
function wldMayOff() { WLD.may = null; wldUnmark('may'); if (WLD.raft) WLD.raft.g.visible = false; }
function wldEv(e) {
  switch (e.k) {
    case 'wmay': if (e.t > 0) wldMayOn(e.x, e.z, e.t, 0); else { const had = !!WLD.may; wldMayOff(); if (had) { Snd.wldRadio(1); showMsg('The mayday goes silent.', 'RADIO', 3); } } break;
    case 'wsave': { wldMayOff(); const p = PL.get(e.id), me = e.id === myId(); Snd.wldShout(e.x != null ? at(e.x, 1, e.z, 6) : null); if (Snd.coin) setTimeout(() => Snd.coin(), 400);
      (G.banQ = G.banQ || []).push({h: 'RESCUE', t: me ? 'You pulled a survivor aboard' : `${p ? p.name : 'The crew'} pulled a survivor aboard`, c: e.v, s: 'bounty'}); showMsg(WLD_THANKS[(e.n || 0) % WLD_THANKS.length], 'SURVIVOR', 5); break; }
    case 'wwhale': FX.whA = {t: 0, x: e.x, z: e.z, a: e.a}; if (Snd.whale) Snd.whale(at(e.x, 0, e.z, 40)); break;
    case 'wbolt': G.bolt = .35; setTimeout(() => G.on && Snd.thunder(.6 + Math.random() * .4), e.d || 1200); break;
    case 'wghost': { const gh = WLD.gh;
      if (e.on === 1) { Object.assign(gh, {on: 1, x: e.x, z: e.z, yaw: e.yaw, tr: e.tr || 0, fade: 0, ap: 0}); if (P && Math.hypot(P.x - e.x, P.z - e.z) < 1400) { showMsg('Green lights on the water. A ship with no sound.', '', 4); Snd.stinger(); } }
      else if (e.on === 2) { gh.fd = 1; if (P && gh.on && Math.hypot(cam.position.x - gh.x, cam.position.z - gh.z) < 400) { showMsg('It thins into the mist. Something glints in its wake.', '', 4); burst(900, .4, .35, 3, 'bandpass', at(gh.x, 6, gh.z, 30), .5); } }
      else { gh.on = 0; gh.fd = 0; } break; }
    case 'wspill': if (P && Math.hypot(P.x - e.x, P.z - e.z) < 2600) { Snd.wldRadio(0); showMsg(`${e.n}: containers over the side!`, 'RADIO', 4); } break;
  }
}
// ---- client per-frame: NPC boats, nav lights, gulls, hum and horns, the ghost, the raft, derelict sightings
function wldFrame(dt) {
  if (!WLD.vis) wldVisInit(); const V = WLD.vis, cp = cam.position, far = Math.min(G.viewFar || 1600, 1400), nt = TOD.night, t = G.wt;
  if (isHost()) WLD.ct = G.t; else { const e = G.t - WLD.ct; WLD.ct = Math.abs(e) > 3 ? G.t : WLD.ct + dt + e * Math.min(1, dt * 1.5); }
  if (A.on && !WLD.au) wldAuInit(); const au = A.on && WLD.au && (WLD.auT = (WLD.auT || 0) - dt) <= 0; if (au) WLD.auT = .1;
  wldNpcPlace(WLD.ct);
  const pa = V.pts.geometry.attributes.position.array, ca = V.pts.geometry.attributes.color.array, lk = .12 + .88 * nt; let hum = null, hd = 200, fishN = null, fd = 350;
  for (const R of WLD_NPC) { const o = R.st, m = R.m, d = Math.hypot(o.x - cp.x, o.z - cp.z), edge = !R.path.loop && (o.s < 40 || o.s > R.path.L - 40), s = Math.sin(o.yaw), c = Math.cos(o.yaw);
    const vis = !edge && d < far + R.L / 2; m.visible = vis; let y = 0;
    if (vis || d < 2600) { const hb = R.L * .45; y = waveH(o.x, o.z, t) * R.hk; if (vis) { const yb = waveH(o.x - s * hb, o.z - c * hb, t), ys = waveH(o.x + s * hb, o.z + c * hb, t); m.position.set(o.x, y, o.z); m.rotation.set((yb - ys) / R.L * .9, o.yaw, Math.sin(t * .6 + R.i * 1.7) * .04 * R.hk, 'YXZ'); const sh = d < 150; for (const q of m.children) q.castShadow = sh; } }
    for (let k = 0; k < R.lt.length; k++) { const L = R.lt[k], j = (R.li + k) * 3; if (edge || d > 2600) { pa[j + 1] = -9999; continue; } pa[j] = o.x + L[0] * c + L[2] * s; pa[j + 1] = L[1] + y; pa[j + 2] = o.z - L[0] * s + L[2] * c; const f = lk * (Math.random() < .004 ? .3 : 1); ca[j] = L[3] * f; ca[j + 1] = L[4] * f; ca[j + 2] = L[5] * f; }
    if (edge) continue; if (d < hd) { hd = d; hum = R; } if (R.kind === 'fish' && d < fd) { fd = d; fishN = R; }
    // the cargo horn when one passes within 300 m of the crew's boat; spray off the bow up close
    if (R.kind === 'cargo' && Math.hypot(o.x - B.x, o.z - B.z) < 300 + R.L / 2 && WLD.ct - (R.hornT ?? -1e9) > 90) { R.hornT = WLD.ct; if (A.on) Snd.wldHorn(at(o.x, 18, o.z, 70)); }
    if (vis && d < 160 && R.v > 3 && (R.spT = (R.spT || 0) - dt) <= 0) { R.spT = .22; spray(o.x - s * R.L * .48, .3, o.z - c * R.L * .48, R.kind === 'cargo' ? 5 : 3, R.kind === 'cargo' ? 3.5 : 2.2); } }
  V.pts.geometry.attributes.position.needsUpdate = V.pts.geometry.attributes.color.needsUpdate = true; V.pts.material.size = 1.6 + nt * 1.4;
  if (au && hum) Snd.wldHum(hum.st.x, 2, hum.st.z, clamp(1.2 - hd / 200, 0, 1) * (hum.kind === 'cargo' ? 1.3 : hum.kind === 'yacht' ? .6 : .8));
  // gulls wheel over the nearest trawler's gantry by day
  const gon = !!fishN && TOD.day > .2 && G.storm < .5 && (G.uw || 0) < .5; V.gull.visible = gon;
  if (gon) { const o = fishN.st, s = Math.sin(o.yaw), c = Math.cos(o.yaw), gx = o.x + fishN.gz[2] * s, gz = o.z + fishN.gz[2] * c;
    V.gph.forEach((p, i) => { const a = p[0] + t * p[3], x = gx + Math.cos(a) * p[1], z = gz + Math.sin(a) * p[1], y = p[2] + Math.sin(t * .8 + p[4]) * 1.5, fl = Math.sin(t * 8 + p[4]) * .5; _we.set(0, -a, Math.sin(t * .5 + i) * .35); _wq.setFromEuler(_we); _ws.set(1, 1 + fl * .6, 1); _wm.compose(_v.set(x, y, z), _wq, _ws); V.gull.setMatrixAt(i, _wm); });
    V.gull.instanceMatrix.needsUpdate = true; if (fd < 160 && Math.random() < dt * .35) Snd.wldGull(at(gx, 10, gz, 10)); }
  wldGhostFrame(dt, au); wldRaftFrame(dt);
  // derelicts go on the chart once you have seen one up close
  if ((WLD.mkT -= dt) <= 0) { WLD.mkT = 1; const px = P ? P.x : cp.x, pz = P ? P.z : cp.z; for (const D of WLD_DRL) if (!D.seen && Math.hypot(D.x - px, D.z - pz) < 200) { D.seen = 1; wldMark('drl' + D.i, D.x, D.z, D.n, '#d8b070'); toast(D.n, 'Derelict, adrift'); } }
}
function wldGhostFrame(dt, au) {
  const gh = WLD.gh, host = isHost();
  if (host) { const q = G.wldGh; if (q && q.on) Object.assign(gh, {on: 1, x: q.x, z: q.z, yaw: q.yaw, fade: q.fade, tr: q.tr}); else if (gh.on && !(q && q.on)) gh.on = 0; }
  else if (gh.on) { gh.yaw += gh.tr * dt; if (!gh.fd || gh.fade < 1) { gh.x -= Math.sin(gh.yaw) * 3 * dt; gh.z -= Math.cos(gh.yaw) * 3 * dt; } if (gh.fd) gh.fade = Math.min(1, (gh.fade || 0) + dt / 8);
    if (gh.sx != null) { const k = Math.min(1, dt * 2); gh.x += (gh.sx - gh.x) * k; gh.z += (gh.sz - gh.z) * k; gh.sx += -Math.sin(gh.yaw) * 3 * dt; gh.sz += -Math.cos(gh.yaw) * 3 * dt; } }
  const on = gh.on && (G.uw || 0) < .5; if (!on && !WLD.ghM) return; if (!WLD.ghM) WLD.ghM = wldGhostMesh(); const Gm = WLD.ghM, d = Math.hypot(gh.x - cam.position.x, gh.z - cam.position.z);
  gh.ap = Math.min(1, (gh.ap || 0) + dt / 4); const k = on ? gh.ap * (1 - (gh.fade || 0)) : 0; Gm.g.visible = on && k > .01 && d < (G.viewFar || 1600) + 40; if (!Gm.g.visible) return;
  const t = G.wt; Gm.g.position.set(gh.x, waveH(gh.x, gh.z, t) * .5 - (gh.fade || 0) * 1.5, gh.z); Gm.g.rotation.set(Math.sin(t * .4) * .02, gh.yaw, Math.sin(t * .31) * .035, 'YXZ');
  const fl = .75 + .25 * Math.sin(t * 3.1) * Math.sin(t * 1.7); Gm.gm.opacity = k; Gm.gm.emissiveIntensity = .7 * fl * (.4 + .6 * TOD.night); Gm.sm.opacity = .5 * k * fl;
  Gm.mist.forEach((s, i) => { const p = s.userData.p; s.position.set(p[0] + Math.sin(t * .07 + p[3]) * 6, p[1], p[2] + Math.cos(t * .05 + p[3]) * 8); s.material.opacity = .13 * k; }); Gm.glow.forEach((s, i) => s.material.opacity = k * (.5 + .5 * Math.sin(t * 2 + i * 1.9)));
  if (au) Snd.wldChoir(gh.x, 8, gh.z, Math.pow(clamp(1 - d / 900, 0, 1), 1.4) * (1 - (gh.fade || 0) * .7));
  if (P && d < 260) P.fear = Math.max(P.fear || 0, .42 * (1 - d / 260) * k);
}
function wldRaftFrame(dt) {
  const q = WLD.may; if (!q) return; if (!WLD.raft) WLD.raft = wldRaftMesh(); const Rf = WLD.raft, t = G.wt, cp = cam.position, d = Math.hypot(q.x - cp.x, q.z - cp.z);
  q.t -= dt; Rf.g.visible = d < Math.min(G.viewFar || 1600, 1400); if (Rf.g.visible) { Rf.g.position.set(q.x, waveH(q.x, q.z, t) - .05, q.z); Rf.g.rotation.set(Math.sin(t * 1.1 + q.ph) * .08, q.ph, Math.cos(t * .9 + q.ph) * .08, 'YXZ'); Rf.arm.rotation.z = -2.4 + Math.sin(t * 7) * .55; Rf.man.rotation.y = Math.atan2(cp.x - q.x, cp.z - q.z) - q.ph;
    Rf.sb.material.opacity = (t % 1.3) < .08 ? .4 + .6 * TOD.night : 0; }
  // another red flare now and then; shouts and creaks up close
  if ((q.rk -= dt) <= 0) { q.rk = 55 + Math.random() * 20; if (q.t > 20 && d > 60) spawnRocket({x: q.x, y: 1, z: q.z, vx: 0, vy: 32, vz: 0, c: 0}); }
  if (A.on && d < 140 && (q.shT -= dt) <= 0) { q.shT = 4 + Math.random() * 4; Snd.wldShout(at(q.x, 1, q.z, 8)); }
  if (A.on && d < 40 && (q.crT -= dt) <= 0) { q.crT = 2 + Math.random() * 3; Snd.creak(at(q.x, .3, q.z, 3)); }
}
// ---- wrappers
{ const f0 = buildFw; buildFw = function (...a) { const r = f0.apply(this, a); wldDerelicts(); wldBuildTraffic(); wldNpcPlace(0); return r; }; }
{ const f0 = placeItems; placeItems = function (...a) { const r = f0.apply(this, a);
  // session reset (placeItems runs once per voyage on every client), then derelict loot from WR so late joiners get the same items
  Object.assign(G, {wldGh: null, wldGhDone: 0, wldGhT: 2, wldMay: null, wldMayT: undefined, wldWhT: 40, wldBoltT: 8}); WLD.so = false; WLD.gh.on = 0; WLD.gh.fd = 0; wldMayOff(); WLD_MARKS.length = 0; for (const D of WLD_DRL) D.seen = 0; WLD.ct = 0;
  for (const s of SPOTS) if (s.tag === 'drl') { const u = WR(); addItem(u < .4 ? 'crate' : u < .65 ? 'scrap' : u < .85 ? 'relic' : 'chest', s); }
  return r; }; }
{ const f0 = hostStep; hostStep = function (dt, ...a) { wldNpcPlace(G.t); const r = f0.call(this, dt, ...a); if (G.on) wldHostStep(dt); return r; }; }
{ const f0 = hostAct; hostAct = function (id, m, ...a) { const r = f0.call(this, id, m, ...a);
  if (m && m.a === 'wres' && G.on) { const p = PL.get(id), q = G.wldMay; if (p && q && !p.dead && Math.hypot(p.x - q.x, p.z - q.z) < 9 + (p.ob ? BG.hw : 0)) { const d = Math.hypot(q.x - HOME.x, q.z - HOME.z), v = Math.round((220 + d / 8) * (wldNight(G.tod) > .5 ? 1.5 : 1) * (D.pay || 1));
    G.wldMay = null; G.wldMayT = 360 + CR() * 240; G.cash += v; G.earned += v; emit({k: 'wsave', v, id, x: q.x, z: q.z, n: Math.floor(CR() * 5)}); save(); } }
  return r; }; }
{ const f0 = applyEv; applyEv = function (e, ...a) { const r = f0.call(this, e, ...a); if (e && typeof e.k === 'string' && e.k[0] === 'w') wldEv(e); return r; }; }
{ const f0 = packSnap; packSnap = function (...a) { const s = f0.apply(this, a); const n = performance.now(); if (n - WLD.snT > 480) { WLD.snT = n; const g = G.wldGh, q = G.wldMay;
  s.wg = g && g.on ? [1, +g.x.toFixed(1), +g.z.toFixed(1), +g.yaw.toFixed(3), +g.fade.toFixed(2), +g.tr.toFixed(4)] : [0]; s.wm = q ? [q.x, q.z, Math.round(q.t)] : 0; } return s; }; }
{ const f0 = applySnap; applySnap = function (s, ...a) { const r = f0.call(this, s, ...a);
  if (s.wg) { const gh = WLD.gh, w = s.wg; if (!w[0]) { gh.on = 0; gh.fd = 0; } else { if (!gh.on || Math.hypot(gh.x - w[1], gh.z - w[2]) > 40) Object.assign(gh, {on: 1, x: w[1], z: w[2], ap: gh.on ? gh.ap : 1}); Object.assign(gh, {sx: w[1], sz: w[2], yaw: w[3], tr: w[5] || 0}); if (w[4] > 0) { gh.fd = 1; gh.fade = Math.max(gh.fade || 0, w[4]); } else gh.fade = 0; } }
  if (s.wm !== undefined) { if (s.wm && !WLD.may) wldMayOn(s.wm[0], s.wm[1], s.wm[2], 1); else if (!s.wm && WLD.may) wldMayOff(); else if (s.wm) WLD.may.t = s.wm[2]; }
  return r; }; }
{ const f0 = stepFauna; stepFauna = function (...a) { FX.whT = 1e9; return f0.apply(this, a); }; }
{ const f0 = updateWorldFx; updateWorldFx = function (dt, ...a) { const r = f0.call(this, dt, ...a); if (G.on && WLD_NPC) wldFrame(dt); return r; }; }
{ const f0 = targets; targets = function (...a) { const L = f0.apply(this, a), q = WLD.may;
  if (q && P && !P.dead && Math.hypot(P.x - q.x, P.z - q.z) < 14) L.push({x: q.x, y: (P.ob ? BDECK.y : 0) + .3, z: q.z, r: 6 + (P.ob ? BG.hw * .6 : 0), flat: 1, label: 'Pull the survivor aboard', go: () => act({a: 'wres'})});
  return L; }; }
// ---------------- style: auras, boat paint and underglow, fireworks, fireflies
let ALL = (() => { try { return localStorage.getItem('s9-all') === '1'; } catch (e) { return false; } })(); const SK = k => k + (ALL ? '-all' : ''); const SLOTS = ['s9-save2', 's9-gear', 's9-cred']; (() => { try { if (!ALL || localStorage.getItem('s9-save2-all') != null) return; const s = localStorage.getItem('s9-save2'); if (s == null) return; const j = JSON.parse(s) || {}, dirty = (j.cash || 0) >= 250000 || ((j.up || {}).own || []).length >= HULLS.length; for (const k of SLOTS) { const v = localStorage.getItem(k); if (v != null) { localStorage.setItem(k + '-all', v); if (dirty) localStorage.removeItem(k); } } } catch (e) {} })();
const AURAS = [{n: 'No aura', c: 0, cost: 0}, {n: 'Sea glass', c: 0x60ffe0, cost: 300}, {n: 'Gold rush', c: 0xffc040, cost: 600}, {n: 'Void', c: 0xa050ff, cost: 900}, {n: 'Blood moon', c: 0xff3a2a, cost: 1200}, {n: 'Prism', c: -1, cost: 2500}];
const PAINTS = [{n: 'Factory', c: 0}, {n: 'Midnight', c: 0x0c1016}, {n: 'Racing red', c: 0xb01818}, {n: 'Gold', c: 0xd8a828}, {n: 'Pearl', c: 0xe4e4e0}, {n: 'Emerald', c: 0x16604a}, {n: 'Ultraviolet', c: 0x3a1a6a}];
const GLOWS = [{n: 'No underglow', c: 0}, {n: 'Cyan', c: 0x30f0ff}, {n: 'Magenta', c: 0xff30d0}, {n: 'Toxic', c: 0x70ff30}, {n: 'Sunset', c: 0xff8a20}, {n: 'Prism', c: -1}];
const STYLE_COST = {paint: 150, glow: 250};
function applyAll() {
  if (!ALL || !P) return;
  Object.assign(P.own, {rod: 3, glock: 1, sg: 1, suit: 2, sack: 2, fw: Math.max(P.own.fw || 0, 30)});
  Object.assign(P.ammo, {g: Math.max(P.ammo.g, 170), gm: 17, s: Math.max(P.ammo.s, 60), sm: 6}); P.flares = Math.max(P.flares, 12); P.bat = 1;
  if (isHost()) { Object.assign(B.up, {engine: 3, hull: 2, light: 2, sonar: 1, hold: 2, crane: 1, own: HULLS.map((H, i) => i), paints: PAINTS.map((a, i) => i), glows: GLOWS.map((a, i) => i)}); G.cruise = 1; G.cash = Math.max(G.cash, 250000); B.hull = hullMax(); }
}
const hullCost = H => freeAll() ? 0 : H.cost;
// auras: a slow spiral of motes around a player
const AURM = new Map(), _ac = new THREE.Color();
function auraOf(p) { const q = AURM.get(p.id); if (q) return q; const n = 40, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size: .22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); m.frustumCulled = false; scene.add(m); const o = {m, ph: [...Array(n)].map(() => [Math.random() * TAU, Math.random(), .35 + Math.random() * .4, .6 + Math.random()])}; AURM.set(p.id, o); return o; }
function updateAuras(dt) {
  const t = G.wt;
  for (const p of PL.values()) {
    const au = p === P ? (P.own && P.own.aura) || 0 : p.au || 0, A = AURAS[au]; const q = AURM.get(p.id);
    if (!au || !p.ready || p.dead || (p === P && P.hd >= 0)) { if (q) q.m.visible = false; continue; }
    const o = auraOf(p); o.m.visible = true; const x = p === P ? P.x : p.rx, z = p === P ? P.z : p.rz, y = p === P ? P.y + (P.ob ? B.heave : 0) - (P.sw ? P.dv || 0 : 0) : p.ry;
    const pa = o.m.geometry.attributes.position.array, ca = o.m.geometry.attributes.color.array;
    o.m.material.size = p === P ? .09 : .22; o.ph.forEach(([a0, h0, r, s], i) => { const h = (h0 + t * .25 * s) % 1, a = a0 + t * s * 1.3 + h * 4, rr = r * (1.1 - h * .5) + (p === P ? .45 : 0); pa[i * 3] = x + Math.cos(a) * rr; pa[i * 3 + 1] = y + .1 + h * (p === P ? .9 : 2); pa[i * 3 + 2] = z + Math.sin(a) * rr;
      if (A.c < 0) _ac.setHSL((t * .15 + i / 40) % 1, 1, .6); else _ac.setHex(A.c); const f = Math.sin(h * PI) * (1.3 + Math.sin(t * 5 + i) * .3); ca[i * 3] = _ac.r * f; ca[i * 3 + 1] = _ac.g * f; ca[i * 3 + 2] = _ac.b * f; });
    o.m.geometry.attributes.position.needsUpdate = o.m.geometry.attributes.color.needsUpdate = true;
  }
}
// fireworks
const FWK = {rk: [], sp: null, n: 900, i: 0, p: []};
function buildFw() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FWK.n * 3).fill(-9999), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FWK.n * 3), 3));
  FWK.sp = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, size: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); FWK.sp.frustumCulled = false; scene.add(FWK.sp);
  for (let i = 0; i < FWK.n; i++) FWK.p.push({x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, l: 0, L: 1, c: new THREE.Color()});
  FWK.fl = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0})); FWK.fl.scale.setScalar(40); scene.add(FWK.fl); }
function spawnRocket(e) { FWK.rk.push({x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, t: 0, c: e.c}); Snd.fwUp(at(e.x, e.y, e.z, 6)); }
function launchFw() {
  if (!P.own.fw || P.hd >= 0 || P.down || !alivePlay()) { if (!P.own.fw) showMsg('Out of fireworks', '', 1.5); return; } P.own.fw--; if (!P.own.fw && P.eq === 6) P.eq = 1; saveGear();
  const f = eyeDir(P), up = Math.max(.55, f[1] + .6), e = {a: 'fw', x: +cam.position.x.toFixed(1), y: +(cam.position.y - .3).toFixed(1), z: +cam.position.z.toFixed(1), vx: +(f[0] * 7).toFixed(2), vy: +(up * 26).toFixed(2), vz: +(f[2] * 7).toFixed(2), c: Math.floor(Math.random() * 6)};
  if (isHost()) emit(Object.assign({}, e, {k: 'fw'})); else Net.send(Object.assign({t: 'act'}, e));
}
const FWC = [[1, .3, .2], [.3, .8, 1], [1, .85, .3], [.7, .35, 1], [.4, 1, .5], [-1]];
function stepFw(dt) {
  if (!FWK.sp) return; const t = G.wt;
  for (let k = FWK.rk.length - 1; k >= 0; k--) { const r = FWK.rk[k]; r.t += dt; r.vy -= 9 * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    { const p = FWK.p[FWK.i++ % FWK.n]; Object.assign(p, {x: r.x, y: r.y, z: r.z, vx: (Math.random() - .5), vy: -1, vz: (Math.random() - .5), l: .5, L: .5}); p.c.setRGB(1, .6, .3); }
    if (r.t > 1.5 || r.vy < 2) { FWK.rk.splice(k, 1); const C = FWC[r.c], multi = C[0] < 0, n = 160, s = 13 + Math.random() * 6;
      for (let i = 0; i < n; i++) { const p = FWK.p[FWK.i++ % FWK.n], u = Math.random() * 2 - 1, a = Math.random() * TAU, q = Math.sqrt(1 - u * u), v = s * (.85 + Math.random() * .15);
        Object.assign(p, {x: r.x, y: r.y, z: r.z, vx: q * Math.cos(a) * v, vy: u * v, vz: q * Math.sin(a) * v, l: 2 + Math.random() * .8, L: 2.8}); if (multi) p.c.setHSL(Math.random(), 1, .6); else p.c.setRGB(C[0], C[1], C[2]); p.c.multiplyScalar(4); }
      FWK.fl.position.set(r.x, r.y, r.z); FWK.fl.material.color.setRGB(...(multi ? [1, 1, 1] : C)); FWK.fl.material.opacity = 1; Snd.fwBoom(at(r.x, r.y, r.z, 40)); }
  }
  FWK.fl.material.opacity = Math.max(0, FWK.fl.material.opacity - dt * 3);
  const pa = FWK.sp.geometry.attributes.position.array, ca = FWK.sp.geometry.attributes.color.array;
  for (let i = 0; i < FWK.n; i++) { const p = FWK.p[i]; if (p.l <= 0) { pa[i * 3 + 1] = -9999; continue; } p.l -= dt; const dr = Math.exp(-dt * 1.4); p.vx *= dr; p.vy = p.vy * dr - 4 * dt; p.vz *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.z; const f = Math.max(0, p.l / p.L) * (Math.random() < .08 ? .2 : 1); ca[i * 3] = p.c.r * f; ca[i * 3 + 1] = p.c.g * f; ca[i * 3 + 2] = p.c.b * f; }
  FWK.sp.geometry.attributes.position.needsUpdate = FWK.sp.geometry.attributes.color.needsUpdate = true;
}
// fireflies over the nearest island at night
let FFLY = null;
function stepFireflies(dt) {
  if (!FFLY) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(220 * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(220 * 3), 3)); FFLY = new THREE.Points(g, new THREE.PointsMaterial({map: TX.glow, vertexColors: true, size: .14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); FFLY.frustumCulled = false; FFLY.userData.base = []; scene.add(FFLY); }
  const cp = cam.position; let I = null, bd = 1e9; for (const q of ISLES) { if (q.bar) continue; const d = Math.hypot(q.x - cp.x, q.z - cp.z) - q.r; if (d < bd) { bd = d; I = q; } }
  const on = TOD.night > .3 && G.storm < .5 && I && bd < 150 && (G.uw || 0) < .5; FFLY.visible = on; if (!on) return;
  if (FFLY.userData.I !== I) { FFLY.userData.I = I; FFLY.userData.base = []; for (let i = 0; i < 220; i++) { let x, z, h, k = 0; do { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * I.r; x = I.x + Math.sin(a) * r; z = I.z + Math.cos(a) * r; h = landH(x, z); } while (h < .5 && k++ < 20); FFLY.userData.base.push([x, h + .3 + Math.random() * 1.6, z, Math.random() * TAU, 1.5 + Math.random() * 3]); } }
  const pa = FFLY.geometry.attributes.position.array, ca = FFLY.geometry.attributes.color.array, t = G.wt; FFLY.userData.base.forEach(([x, y, z, ph, per], i) => { pa[i * 3] = x + Math.sin(t * .23 + ph) * 1.4 + Math.sin(t * 1.7 + ph * 3) * .15; pa[i * 3 + 1] = y + Math.sin(t * .5 + ph * 2) * .4; pa[i * 3 + 2] = z + Math.cos(t * .19 + ph) * 1.4 + Math.cos(t * 1.3 + ph) * .15;
    const c = ((t + ph * 3) % per) / per, b = c < .18 ? Math.sin(c / .18 * PI) : 0; ca[i * 3] = b * 2.2; ca[i * 3 + 1] = b * 2.6; ca[i * 3 + 2] = b * .6; }); FFLY.geometry.attributes.color.needsUpdate = true;
  FFLY.geometry.attributes.position.needsUpdate = true; FFLY.material.opacity = TOD.night;
}
// ---------------- the Lucky Lantern: a real room beside the harbour shed. Roulette, blackjack and slots in first person, played with the crew's cash (host-run, shared)
BT.casino = {w: 10, d: 8, dx: 0, dw: 1.8, wh: 3.6, wood: 1};
const CAS_CHIPS = [10, 25, 100, 500, 1000], CAS_CC = [0xeeeae0, 0xc4242c, 0x24903c, 0x1c1c22, 0x8a3ad0];
const RL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26], RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// roulette, building-local: table centre (cx, cz), felt origin fx (felt coords u along x, w along z, + away from the players), wheel at wx
const CAS_RL = {cx: -2.3, cz: 1, fx: -2.35, wx: -3.6, y: .825, st: [-3.3, -2.5, -1.7, -.9], max: 5000, out: ['1-18', 'Even', 'Red', 'Black', 'Odd', '19-36'],
  pay: c => c <= 36 ? 35 : c <= 42 ? 2 : 1, odds: c => c <= 36 ? '35 to 1' : c <= 42 ? '2 to 1' : '1 to 1',
  win: (c, n) => c <= 36 ? c === n : n === 0 ? false : c <= 39 ? Math.ceil(n / 12) === c - 36 : c <= 42 ? (n - 1) % 3 === c - 40 : c === 43 ? n <= 18 : c === 44 ? n % 2 === 0 : c === 45 ? RED.has(n) : c === 46 ? !RED.has(n) : c === 47 ? n % 2 === 1 : n >= 19,
  name: c => c <= 36 ? String(c) : c <= 39 ? ['1st', '2nd', '3rd'][c - 37] + ' 12' : c <= 42 ? 'Column ' + (c - 39) : CAS_RL.out[c - 43],
  rect(c, o) { if (c === 0) { o[1] = -.75; o[2] = -.6; o[3] = -.3; o[4] = .3; } else if (c <= 36) { const k = Math.floor((c - 1) / 3), r = (c - 1) % 3; o[1] = -.6 + k * .15; o[2] = o[1] + .15; o[3] = -.3 + r * .2; o[4] = o[3] + .2; }
    else if (c <= 39) { o[1] = -.6 + (c - 37) * .6; o[2] = o[1] + .6; o[3] = .3; o[4] = .45; } else if (c <= 42) { o[1] = 1.2; o[2] = 1.35; o[3] = -.3 + (c - 40) * .2; o[4] = o[3] + .2; } else { o[1] = -.6 + (c - 43) * .3; o[2] = o[1] + .3; o[3] = -.45; o[4] = -.3; } o[0] = c; return o; },
  cell(u, w, o) { let c = -1; if (w >= -.3 && w < .3) { if (u >= -.75 && u < -.6) c = 0; else if (u >= -.6 && u < 1.2) c = Math.floor((u + .6) / .15) * 3 + Math.min(2, Math.floor((w + .3) / .2)) + 1; else if (u >= 1.2 && u < 1.35) c = 40 + Math.min(2, Math.floor((w + .3) / .2)); }
    else if (u >= -.6 && u < 1.2) { if (w >= -.45 && w < -.3) c = 43 + Math.min(5, Math.floor((u + .6) / .3)); else if (w >= .3 && w < .45) c = 37 + Math.min(2, Math.floor((u + .6) / .6)); } return c < 0 ? null : this.rect(c, o); }};
// blackjack: half-moon centred (cx, cz), players on the -z arc, dealer at dz; cards are ints 0-51 (rank c % 13, 0 = ace)
const CAS_BJ = {cx: 2.4, cz: 1.6, r: 1.1, dz: 2.65, max: 2000, shoe: [1.62, .93, 2.02], tray: [3.2, .87, 2.0], A: [-.6981, 0, .6981],
  val(h) { let v = 0, a = 0; for (let i = 0; i < h.length; i++) { const c = h[i]; if (c < 0) continue; const r = c % 13; if (r === 0) { a++; v += 11; } else v += r >= 9 ? 10 : r + 1; } while (v > 21 && a) { v -= 10; a--; } return v; }};
// slots: three walk-up machines on the +x wall; reel weights and pays give an RTP of about 94.7 %
const CAS_SL = {z: [-2.2, -1.2, -.2], W: [30, 24, 18, 12, 8, 5, 3], X3: [5, 8, 12, 20, 35, 60, 150], max: 500,
  pick: r => { let q = r() * 100; for (let i = 0; i < 7; i++) { q -= CAS_SL.W[i]; if (q < 0) return i; } return 0; },
  mult: (a, b, c) => a === b && b === c ? CAS_SL.X3[a] : a === 0 && b === 0 ? 2 : (a === 0) + (b === 0) + (c === 0) === 1 ? 1 : 0};
const casR = k => mulberry((G.seed ^ 0xca51) + 101 * k);
const CAS = {force: null, bjForce: null, slForce: null, v: 0, sv: -1, sT: -9, dirty: 1, cd: 1, kd: 1, ct: 0, b: null, g: null,
  seats: {rl: [null, null, null, null], bj: [null, null, null]}, rl: {ph: 'idle', T: 0, n: 0, bets: [], res: -1, t0: -99, a0: 0, k: 0},
  bj: {ph: 'idle', T: 0, turn: -1, seats: [], dl: [], hole: -1, shoe: [], q: [], qT: 0, sh: 0, ch: [[], [], []]},
  sl: [[null, 0, 0, 0, -99], [null, 0, 0, 0, -99], [null, 0, 0, 0, -99]], slPay: [null, null, null], rp: new Float32Array(9), rt0: [-99, -99, -99], rk: [0, 0, 0],
  stk: [], lv: [], cv: [], hc: [0, 0, 0, 0, 0], aim: null, aimSl: -1, dl: {p: 'idle', t: 0, s: 1}, mbT: 0, mbI: 0, tickT: 0, tickP: 0, hk: [], help: null,
  m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color()};
function casBjReset() { const J = CAS.bj; J.seats = [0, 1, 2].map(() => [null, 0, [], 0]); J.dl = []; J.hole = -1; J.q = []; J.turn = -1; J.ch = [[], [], []]; }
casBjReset();
function casReset() { CAS.seats.rl.fill(null); CAS.seats.bj.fill(null); Object.assign(CAS.rl, {ph: 'idle', T: 0, n: 0, bets: [], res: -1, t0: -99, a0: 0, k: 0}); Object.assign(CAS.bj, {ph: 'idle', T: 0, shoe: [], sh: 0}); casBjReset();
  CAS.sl.forEach(q => { q[0] = null; q[4] = -99; }); CAS.slPay.fill(null); CAS.stk = []; CAS.lv = []; CAS.cv = []; CAS.v++; CAS.sT = -9; CAS.dirty = CAS.cd = CAS.kd = 1; CAS.force = CAS.bjForce = CAS.slForce = null; }
// local <-> world for the room (it never moves)
const casW = (lx, lz) => [CAS.b.x + lx * CAS.cs + lz * CAS.sn, CAS.b.z - lx * CAS.sn + lz * CAS.cs];
function casInside(x, z, y) { const b = CAS.b; if (!b || Math.abs(y - b.fy - 1.5) > 2.6) return false; const dx = x - b.x, dz = z - b.z, lx = dx * CAS.cs - dz * CAS.sn, lz = dx * CAS.sn + dz * CAS.cs; return Math.abs(lx) < 5 && Math.abs(lz) < 4; }
// ---- canvases (own art, no emoji)
function casFelt() { return cv(1024, 512, (g, W, H) => { g.fillStyle = '#0e5530'; g.fillRect(0, 0, W, H); noiseFill(g, W, H, 10); g.translate(W, H); g.rotate(PI); // drawn as the seated player sees it
  const X = u => (1.35 - u) / 2.6 * W, Y = w => (.625 - w) / 1.25 * H, o = [0, 0, 0, 0, 0]; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let c = 0; c <= 48; c++) { CAS_RL.rect(c, o); const x0 = X(o[2]), x1 = X(o[1]), y0 = Y(o[4]), y1 = Y(o[3]), w = x1 - x0, h = y1 - y0, mx = x0 + w / 2, my = y0 + h / 2;
    if (c <= 36) { g.fillStyle = c === 0 ? '#14803e' : RED.has(c) ? '#a8141c' : '#141416'; g.fillRect(x0 + 3, y0 + 3, w - 6, h - 6); g.fillStyle = '#f4ecd6'; g.font = 'bold 30px Georgia'; g.save(); g.translate(mx, my); g.rotate(-PI / 2); g.fillText(c, 0, 0); g.restore(); }
    else if (c === 45 || c === 46) { g.fillStyle = c === 45 ? '#b0161e' : '#121214'; g.beginPath(); g.moveTo(mx - 44, my); g.lineTo(mx, my - 24); g.lineTo(mx + 44, my); g.lineTo(mx, my + 24); g.closePath(); g.fill(); g.strokeStyle = '#e8d8a8'; g.lineWidth = 2; g.stroke(); }
    else { g.fillStyle = '#f0e4c0'; g.font = (c <= 42 ? 'bold 22px' : 'bold 26px') + ' Georgia'; if (c >= 40 && c <= 42) { g.save(); g.translate(mx, my); g.rotate(-PI / 2); g.fillText('2 to 1', 0, 0); g.restore(); } else g.fillText(c <= 39 ? ['1st 12', '2nd 12', '3rd 12'][c - 37] : CAS_RL.out[c - 43].toUpperCase(), mx, my); }
    g.strokeStyle = '#e8d8a8'; g.lineWidth = 2.5; g.strokeRect(x0, y0, w, h); }
  g.fillStyle = 'rgba(240,226,190,.85)'; g.font = 'italic 19px Georgia'; g.fillText('Straight up pays 35 to 1  ·  dozens and columns 2 to 1', X(.3), Y(.535));
  g.fillText('Red, black, odd, even, high, low pay 1 to 1  ·  zero takes the outside bets', X(.3), Y(-.535)); g.font = 'bold 26px Georgia'; g.fillStyle = '#e8c060'; g.fillText('LUCKY LANTERN', X(-1.05), Y(0)); }); }
function casFeltBJ() { return cv(512, 390, (g, W, H) => { g.fillStyle = '#0e5530'; g.fillRect(0, 0, W, H); noiseFill(g, W, H, 10); g.translate(W, H); g.rotate(PI);
  const X = x => (1.15 - x) / 2.3 * W, Y = y => (y + .6) / 1.75 * H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = '#e8d8a8';
  for (let s = 0; s < 3; s++) { const a = CAS_BJ.A[s]; g.lineWidth = 3; g.beginPath(); g.arc(X(Math.sin(a) * .78), Y(Math.cos(a) * .78), 20, 0, TAU); g.stroke(); g.lineWidth = 1.5; g.strokeRect(X(Math.sin(a) * .48) - 16, Y(Math.cos(a) * .48) - 22, 32, 44); }
  g.lineWidth = 2; g.beginPath(); g.arc(X(0), Y(0), .62 / 1.75 * H, .15 * PI, .85 * PI); g.stroke();
  g.fillStyle = '#f0e4c0'; g.font = 'bold 17px Georgia'; g.fillText('BLACKJACK PAYS 3 TO 2', X(0), Y(.26)); g.font = 'italic 13px Georgia'; g.fillText('Dealer stands on all 17s', X(0), Y(.15)); g.font = 'bold 15px Georgia'; g.fillStyle = '#e8c060'; g.fillText('LUCKY LANTERN', X(0), Y(-.4)); }); }
function casSignCv() { return cv(512, 128, (g, w, h) => { g.fillStyle = '#120a08'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ff7a20'; g.lineWidth = 4; g.shadowColor = '#ff7a20'; g.shadowBlur = 12; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = '#ffb040'; g.beginPath(); g.ellipse(52, 64, 18, 26, 0, 0, TAU); g.fill(); g.fillRect(44, 30, 16, 8); g.fillRect(44, 90, 16, 8); g.fillRect(w - 60, 30, 16, 8); g.beginPath(); g.ellipse(w - 52, 64, 18, 26, 0, 0, TAU); g.fill(); g.fillRect(w - 60, 90, 16, 8);
  g.font = 'bold 50px Georgia'; g.textAlign = 'center'; g.fillStyle = '#ffcf60'; g.shadowBlur = 16; g.fillText('LUCKY LANTERN', w / 2, 82); }); }
function casWheelCv() { return cv(512, 512, (g, W) => { const c = W / 2; g.translate(c, c); g.fillStyle = '#c8a040'; g.fillRect(-c, -c, W, W); // the corners stay brass: the turret samples the centre
  for (let i = 0; i < 37; i++) { const a0 = (i - .5) / 37 * TAU, a1 = (i + .5) / 37 * TAU, n = RL[i]; g.fillStyle = n === 0 ? '#16883e' : RED.has(n) ? '#a8141c' : '#18181a'; g.beginPath(); g.arc(0, 0, c, a0, a1); g.arc(0, 0, c * .66, a1, a0, true); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.38)'; g.beginPath(); g.arc(0, 0, c * .86, a0, a1); g.arc(0, 0, c * .66, a1, a0, true); g.closePath(); g.fill(); g.strokeStyle = '#d8d0c0'; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.cos(a0) * c * .66, Math.sin(a0) * c * .66); g.lineTo(Math.cos(a0) * c * .86, Math.sin(a0) * c * .86); g.stroke();
    g.save(); g.rotate((a0 + a1) / 2 + PI / 2); g.fillStyle = '#f4ecd6'; g.font = 'bold 22px Georgia'; g.textAlign = 'center'; g.fillText(n, 0, -c * .9); g.restore(); }
  g.strokeStyle = '#d8c070'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, c * .86, 0, TAU); g.stroke(); const gr = g.createRadialGradient(0, 0, 10, 0, 0, c * .66); gr.addColorStop(0, '#c8a040'); gr.addColorStop(.25, '#6a3a18'); gr.addColorStop(1, '#3a1e0c'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c * .66, 0, TAU); g.fill();
  g.strokeStyle = '#c8a040'; g.lineWidth = 6; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(k * PI / 2) * c * .6, Math.sin(k * PI / 2) * c * .6); g.stroke(); } }); }
function casSuit(g, s, x, y, k) { g.fillStyle = s === 1 || s === 2 ? '#b8121a' : '#141418'; g.beginPath();
  if (s === 1) { g.moveTo(x, y + k * .9); g.bezierCurveTo(x - k * 1.4, y - k * .1, x - k * .7, y - k * 1.1, x, y - k * .4); g.bezierCurveTo(x + k * .7, y - k * 1.1, x + k * 1.4, y - k * .1, x, y + k * .9); g.fill(); }
  else if (s === 2) { g.moveTo(x, y - k); g.lineTo(x + k * .7, y); g.lineTo(x, y + k); g.lineTo(x - k * .7, y); g.fill(); }
  else if (s === 3) { for (const [dx, dy] of [[0, -.45], [-.45, .12], [.45, .12]]) { g.moveTo(x + dx * k + k * .38, y + dy * k); g.arc(x + dx * k, y + dy * k, k * .38, 0, TAU); } g.fill(); g.fillRect(x - k * .1, y, k * .2, k * .85); }
  else { g.moveTo(x, y - k); g.bezierCurveTo(x + k * 1.4, y + k * .1, x + k * .6, y + k * .9, x, y + k * .35); g.bezierCurveTo(x - k * .6, y + k * .9, x - k * 1.4, y + k * .1, x, y - k); g.fill(); g.fillRect(x - k * .1, y, k * .2, k * .85); } }
function casCardCv() { return cv(1024, 512, (g, W, H) => { const cw = W / 14, ch = H / 4, R = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 14; r++) { const x = r * cw, y = (3 - s) * ch; // texture row s from the bottom
    if (r === 13) { g.fillStyle = '#f2ece0'; g.fillRect(x, y, cw, ch); g.fillStyle = '#7a1418'; g.fillRect(x + 4, y + 4, cw - 8, ch - 8); g.strokeStyle = 'rgba(255,220,180,.35)'; g.lineWidth = 1; for (let k = -ch; k < cw + ch; k += 9) { g.beginPath(); g.moveTo(x + 4 + k, y + 4); g.lineTo(x + 4 + k + ch, y + ch - 4); g.moveTo(x + 4 + k + ch, y + 4); g.lineTo(x + 4 + k, y + ch - 4); g.stroke(); }
      g.fillStyle = '#e8c060'; g.fillRect(x + cw / 2 - 5, y + ch / 2 - 18, 10, 30); g.fillStyle = '#fff2b0'; g.fillRect(x + cw / 2 - 7, y + ch / 2 - 26, 14, 9); continue; }
    g.fillStyle = '#f6f2e8'; g.fillRect(x + 1, y + 1, cw - 2, ch - 2); g.strokeStyle = '#c8c0b0'; g.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
    g.fillStyle = s === 1 || s === 2 ? '#b8121a' : '#141418'; g.font = 'bold 20px Georgia'; g.textAlign = 'center'; g.fillText(R[r], x + 12, y + 22); casSuit(g, s, x + 12, y + 36, 6);
    if (r >= 10) { g.strokeStyle = s === 1 || s === 2 ? '#b8121a' : '#2a2a40'; g.lineWidth = 2; g.strokeRect(x + 22, y + 26, cw - 32, ch - 44); g.font = 'bold 34px Georgia'; g.fillText(R[r], x + cw / 2 + 4, y + ch / 2 + 6); casSuit(g, s, x + cw / 2 + 4, y + ch / 2 + 32, 8); }
    else casSuit(g, s, x + cw / 2 + 4, y + ch / 2 + 4, r === 0 ? 18 : 13); } }); }
function casReelCv() { return cv(128, 1024, (g, W, H) => { const h = H / 7; g.fillStyle = '#f6f0e2'; g.fillRect(0, 0, W, H);
  const at = (i, f) => { g.save(); g.translate(W / 2, (i + .5) * h); f(); g.restore(); g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, (i + 1) * h); g.lineTo(W, (i + 1) * h); g.stroke(); };
  at(0, () => { g.fillStyle = '#f08a5a'; for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(0, 30); g.lineTo(Math.sin(k * .38) * 46, 30 - Math.cos(k * .38) * 56); g.lineTo(Math.sin((k + .5) * .38) * 44, 30 - Math.cos((k + .5) * .38) * 52); g.closePath(); g.fill(); } g.fillStyle = '#c85a30'; g.fillRect(-12, 26, 24, 12); }); // shell
  at(1, () => { g.fillStyle = '#f2d020'; g.beginPath(); g.ellipse(0, 4, 42, 30, -.2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(36, -12); g.lineTo(50, -20); g.lineTo(40, -2); g.fill(); g.fillStyle = '#3a9a3a'; g.beginPath(); g.ellipse(-22, -30, 16, 7, -.6, 0, TAU); g.fill(); }); // lemon
  at(2, () => { g.strokeStyle = '#1e3a6a'; g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.arc(0, -40, 9, 0, TAU); g.moveTo(0, -31); g.lineTo(0, 40); g.moveTo(-24, -18); g.lineTo(24, -18); g.moveTo(-38, 14); g.quadraticCurveTo(-30, 44, 0, 44); g.quadraticCurveTo(30, 44, 38, 14); g.stroke(); }); // anchor
  at(3, () => { g.fillStyle = '#2a9ab0'; g.beginPath(); g.ellipse(-6, 0, 38, 22, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(28, 0); g.lineTo(52, -22); g.lineTo(52, 22); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-26, -6, 6, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(-26, -6, 3, 0, TAU); g.fill(); }); // fish
  at(4, () => { g.fillStyle = '#8a40b0'; g.beginPath(); g.ellipse(0, -18, 24, 32, 0, 0, TAU); g.fill(); g.strokeStyle = '#8a40b0'; g.lineWidth = 7; g.lineCap = 'round'; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 9, 8); g.quadraticCurveTo(k * 18, 30, k * 12 + 6, 50); g.stroke(); } g.fillStyle = '#fff'; g.beginPath(); g.arc(-9, -14, 5, 0, TAU); g.arc(9, -14, 5, 0, TAU); g.fill(); }); // squid
  at(5, () => { g.fillStyle = '#c89a70'; g.beginPath(); g.ellipse(0, 22, 48, 18, 0, 0, PI); g.fill(); const gr = g.createRadialGradient(-10, -12, 4, 0, 0, 32); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b8c4d8'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill(); }); // pearl
  at(6, () => { g.fillStyle = 'rgba(255,220,120,.35)'; g.beginPath(); g.moveTo(0, -40); g.lineTo(60, -62); g.lineTo(60, -18); g.closePath(); g.fill(); g.fillStyle = '#f4f0e8'; g.beginPath(); g.moveTo(-14, 50); g.lineTo(-9, -32); g.lineTo(9, -32); g.lineTo(14, 50); g.fill(); g.fillStyle = '#c81c1c'; g.fillRect(-12, 20, 24, 12); g.fillRect(-10, -8, 20, 10); g.fillStyle = '#ffd860'; g.fillRect(-8, -46, 16, 14);
    g.font = 'bold 64px Georgia'; g.textAlign = 'center'; g.fillStyle = '#c81c1c'; g.strokeStyle = '#ffd860'; g.lineWidth = 3; g.strokeText('7', -34, 24); g.fillText('7', -34, 24); }); // lighthouse 7
}); }
// ---- the building (buildHome calls this before the BK merge): room, tables, slots, bar, signs, colliders
function casBuild() {
  const b = building('casino', 'The Lucky Lantern', 12, -270, 2, 'w'); CAS.b = b; CAS.cs = Math.cos(b.th); CAS.sn = Math.sin(b.th);
  const S = o => new THREE.MeshStandardMaterial(Object.assign({roughness: .7, metalness: 0}, o)), B = o => new THREE.MeshBasicMaterial(o);
  if (!MAT.casFelt) { MAT.casFelt = S({map: tex(casFelt()), roughness: .95}); MAT.casBJ = S({map: tex(casFeltBJ()), roughness: .95}); MAT.casSign = B({map: tex(casSignCv()), color: new THREE.Color().setRGB(1.6, 1.6, 1.6)});
    MAT.casNeon = B({color: new THREE.Color().setRGB(2.2, .55, 1.1)}); MAT.casAwn = S({map: tex(cv(64, 16, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e8dcc0' : '#8a1a20'; g.fillRect(i * 8, 0, 8, h); } })), side: THREE.DoubleSide});
    MAT.casWood = S({map: TX.wood, color: 0x8a5a34, roughness: .5, side: THREE.DoubleSide}); MAT.casRail = S({color: 0x3a1a10, roughness: .45}); MAT.casSlot = S({color: 0x7a1424, metalness: .45, roughness: .35}); MAT.casChrome = S({color: 0xd0d0d8, metalness: .9, roughness: .22});
    MAT.casBtlG = S({color: 0x1a5a2a, roughness: .15, metalness: .2, emissive: 0x061a0a}); MAT.casBtlA = S({color: 0x8a4a12, roughness: .15, metalness: .2, emissive: 0x1a0a02}); MAT.casGlass = S({color: 0xd8e8f0, roughness: .05, metalness: .3, transparent: true, opacity: .14, depthWrite: false}); MAT.casShade = S({color: 0x1e4a2a, roughness: .5, side: THREE.DoubleSide, emissive: 0x0a1a0c}); }
  const P3 = (k, g, lx, ly, lz, ry = 0) => { g.rotateY(ry); g.translate(lx, ly, lz); g.rotateY(b.th); g.translate(b.x, b.fy, b.z); bucket(k).push(g); return g; };
  const solid = (x0, x1, z0, z1, h) => { const r = rectW(b, x0, x1, z0, z1); WALLS.push(Object.assign(r, {y0: b.fy, y1: b.fy + h, see: false})); };
  const R = CAS_RL, J = CAS_BJ;
  lbox(b, 'carpet', 0, .065, 0, 9.7, .01, 7.7);
  // roulette: wood top with a padded rail, the printed felt, two pedestals, the wheel bowl at the -x end
  lbox(b, 'wood', R.cx, .78, R.cz, 2.74, .08, 1.39); for (const s of [-1, 1]) lbox(b, 'dark', R.cx + s * .8, .37, R.cz, .34, .74, .9);
  P3('casFelt', new THREE.PlaneGeometry(2.6, 1.25).rotateX(-PI / 2), R.cx, R.y, R.cz);
  for (const s of [-1, 1]) { lbox(b, 'casRail', R.cx, .85, R.cz + s * .66, 2.74, .05, .07); lbox(b, 'casRail', R.cx + s * 1.335, .85, R.cz, .07, .05, 1.39); }
  P3('wood', new THREE.CylinderGeometry(.5, .5, .08, 30), R.wx, .78, R.cz); P3('dark', new THREE.CylinderGeometry(.18, .26, .74, 14), R.wx, .37, R.cz);
  P3('casWood', new THREE.LatheGeometry([[.33, .875], [.37, .885], [.405, .9], [.43, .925], [.46, .93], [.47, .91], [.47, .8]].map(([x, y]) => new THREE.Vector2(x, y)), 37), R.wx, 0, R.cz);
  P3('dark', new THREE.CircleGeometry(.34, 37).rotateX(-PI / 2), R.wx, .872, R.cz);
  for (let k = 0; k < 8; k++) P3('brass', new THREE.BoxGeometry(.03, .012, .015), R.wx + Math.cos(k * PI / 4) * .385, .9, R.cz + Math.sin(k * PI / 4) * .385, -k * PI / 4);
  solid(R.cx - 1.37, R.cx + 1.37, R.cz - .7, R.cz + .7, .87); solid(R.wx - .5, R.wx + .5, R.cz - .5, R.cz + .5, .93);
  // blackjack: a D-shaped top (arc toward the players), felt, rail, pedestal, shoe, chip rack, discard tray
  const D = new THREE.Shape(); D.moveTo(1.1, 0); for (let i = 0; i <= 24; i++) { const a = i / 24 * PI; D.lineTo(Math.cos(a) * 1.1, Math.sin(a) * 1.1); } D.lineTo(-1.1, -.55); D.lineTo(1.1, -.55); D.closePath();
  const top = new THREE.ExtrudeGeometry(D, {depth: .07, bevelEnabled: false}); top.rotateX(-PI / 2); P3('wood', top, J.cx, .75, J.cz);
  const fg = new THREE.ShapeGeometry(D, 24), fp = fg.attributes.position, fu = fg.attributes.uv; for (let i = 0; i < fp.count; i++) fu.setXY(i, (fp.getX(i) + 1.15) / 2.3, (fp.getY(i) + .6) / 1.75); fg.rotateX(-PI / 2); P3('casBJ', fg, J.cx, .825, J.cz);
  P3('casRail', new THREE.TorusGeometry(1.1, .04, 6, 30, PI).rotateX(-PI / 2), J.cx, .845, J.cz); for (const s of [-1, 1]) lbox(b, 'casRail', J.cx + s * 1.1, .845, J.cz + .275, .08, .06, .55);
  P3('dark', new THREE.CylinderGeometry(.22, .32, .78, 14), J.cx, .39, J.cz + .1);
  lbox(b, 'dark', J.shoe[0], .87, J.shoe[2], .14, .1, .26, .35); lbox(b, 'casRail', J.shoe[0], .93, J.shoe[2] - .1, .12, .03, .05, .35);
  lbox(b, 'dark', J.cx, .84, 2.05, .62, .04, .14); ['white', 'red', 'genM', 'dark', 'brass'].forEach((k, i) => lbox(b, k, J.cx - .24 + i * .12, .865, 2.05, .09, .02, .1)); lbox(b, 'dark', J.tray[0], .845, J.tray[2], .14, .04, .2);
  solid(J.cx - 1.15, J.cx + 1.15, J.cz - 1.12, J.cz + .58, .87);
  // the dealer's spot and the stools (4 roulette, 3 blackjack on the arc)
  PCIRC.push((([x, z]) => ({x, z, r: .32}))(casW(J.cx, J.dz)));
  const stool = (lx, lz) => { P3('red', new THREE.CylinderGeometry(.19, .17, .07, 16), lx, .73, lz); P3('brass', new THREE.TorusGeometry(.13, .012, 5, 16).rotateX(PI / 2), lx, .4, lz); P3('steel', new THREE.CylinderGeometry(.03, .03, .68, 8), lx, .36, lz); P3('dark', new THREE.CylinderGeometry(.19, .21, .03, 16), lx, .015, lz); const [x, z] = casW(lx, lz); PCIRC.push({x, z, r: .22}); };
  const seat = (lx, lz, dx, dz) => { const [x, z] = casW(lx, lz), wdx = dx * CAS.cs + dz * CAS.sn, wdz = -dx * CAS.sn + dz * CAS.cs; return {lx, lz, x, z, yaw: Math.atan2(-wdx, -wdz), sx: x - wdx * .75, sz: z - wdz * .75, dx, dz}; };
  CAS.seatW = {rl: R.st.map(x => seat(x, .05, 0, 1)), bj: J.A.map(a => seat(J.cx + Math.sin(a) * 1.4, J.cz - Math.cos(a) * 1.4, -Math.sin(a), Math.cos(a)))};
  for (const q of CAS.seatW.rl) stool(q.lx, q.lz); for (const q of CAS.seatW.bj) stool(q.lx, q.lz);
  // slot machines against the +x wall, facing the room; reels and levers are instanced in casMeshes
  for (const z of CAS_SL.z) { lbox(b, 'casSlot', 4.62, .48, z, .58, .96, .7); lbox(b, 'casSlot', 4.75, 1.33, z, .36, .78, .7); lbox(b, 'casChrome', 4.3, .97, z, .14, .04, .68); lbox(b, 'dark', 4.33, .3, z, .06, .14, .4);
    for (const y of [1.06, 1.34]) lbox(b, 'casChrome', 4.45, y, z, .05, .04, .5); for (const s of [-1, 1]) lbox(b, 'casChrome', 4.45, 1.2, z + s * .23, .05, .32, .04); lbox(b, 'casGlass', 4.43, 1.2, z, .005, .26, .44);
    lbox(b, 'casNeon', 4.68, 1.76, z, .4, .1, .66); P3('casGlass', new THREE.SphereGeometry(.065, 12, 8, 0, TAU, 0, PI / 2), 4.62, 1.81, z); lbox(b, 'casChrome', 4.62, 1.06, z + .38, .1, .1, .06);
    solid(4.3, 4.95, z - .38, z + .44, 1.9); }
  // the bar on the back wall: counter, two shelves of bottles
  lbox(b, 'wood', -2.9, .5, 3.6, 3.4, 1, .5); lbox(b, 'dark', -2.9, 1.02, 3.6, 3.5, .04, .56); for (const y of [1.55, 1.95]) lbox(b, 'wood', -2.9, y, 3.86, 3.2, .04, .22);
  for (let i = 0; i < 18; i++) { const y = i < 9 ? 1.57 : 1.97, x = -4.3 + (i % 9) * .34 + (i < 9 ? 0 : .12), h = .2 + (i * 7 % 5) * .02; P3(i % 3 ? 'casBtlA' : 'casBtlG', new THREE.CylinderGeometry(.032, .036, h, 8), x, y + h / 2, 3.86); P3('dark', new THREE.CylinderGeometry(.012, .016, .07, 6), x, y + h + .035, 3.86); }
  solid(-4.65, -1.15, 3.32, 3.95, 1.05);
  // neon strip under the ceiling, two green-shaded lamps over the tables (their light comes from the pooled home lamps)
  for (const s of [-1, 1]) { lbox(b, 'casNeon', 0, 3.42, s * 3.86, 9.6, .035, .03); lbox(b, 'casNeon', s * 4.86, 3.42, 0, .03, .035, 7.6); }
  CAS.lamps = []; for (const [lx, lz] of [[R.cx, R.cz], [J.cx, J.cz - .2]]) { P3('casShade', new THREE.ConeGeometry(.3, .22, 18, 1, true), lx, 2.42, lz); P3('glassL', new THREE.SphereGeometry(.06, 10, 8), lx, 2.34, lz); lbox(b, 'dark', lx, 3.02, lz, .02, 1.1, .02); const [x, z] = casW(lx, lz); CAS.lamps.push([x, b.fy + 2.6, z, .55]); }
  // outside: the neon sign above the door, a second one on the north wall facing the jetty, an awning
  P3('casSign', new THREE.PlaneGeometry(4.2, 1.05), 0, 4.2, -4.2, PI); for (const s of [-1, 1]) lbox(b, 'dark', s * 1.6, 3.95, -4.12, .06, .7, .06);
  P3('casSign', new THREE.PlaneGeometry(3.2, .8), -5.14, 2.65, 0, -PI / 2);
  P3('casAwn', new THREE.BoxGeometry(2.6, .04, 1).rotateX(-.32), 0, 2.42, -4.55);
  return b;
}
// ---- the moving parts: one group in room space, a few instanced meshes (wheel, ball and lamps, chips, owner discs and the marker, cards, reels, levers) plus the dealer
function casInstMat(map, key, vert, frag) { const m = new THREE.MeshStandardMaterial({map, roughness: .55, metalness: .05}); m.onBeforeCompile = s => { if (vert) s.vertexShader = vert(s.vertexShader); if (frag) s.fragmentShader = frag(s.fragmentShader); }; m.customProgramCacheKey = () => 'cas-' + key; return m; }
function casMeshes() {
  const b = CAS.b, g = CAS.g = new THREE.Group(); g.position.set(b.x, b.fy, b.z); g.rotation.y = b.th; g.visible = false; scene.add(g);
  const bs = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 7), inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.boundingSphere = bs; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); g.add(m); return m; };
  const R = CAS_RL, J = CAS_BJ, wt = new THREE.CanvasTexture(casWheelCv()); wt.colorSpace = THREE.SRGBColorSpace; wt.anisotropy = 4;
  const cone = new THREE.ConeGeometry(.055, .07, 12); cone.translate(0, .035, 0); const cu = cone.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, .5, .5);
  CAS.wheel = new THREE.Mesh(mergeGeos([new THREE.CircleGeometry(.34, 74).rotateX(-PI / 2), cone]), new THREE.MeshStandardMaterial({map: wt, roughness: .35, metalness: .25})); CAS.wheel.position.set(R.wx, .877, R.cz); CAS.wheel.receiveShadow = true; g.add(CAS.wheel);
  CAS.dots = inst(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial(), 4); for (let i = 0; i < 4; i++) CAS.dots.setColorAt(i, CAS.c.setHex(i ? 0x6a4a20 : 0xf4f2ee));
  CAS.discs = inst(new THREE.CylinderGeometry(1, 1, 1, 18), new THREE.MeshStandardMaterial({metalness: .5, roughness: .4}), 64); CAS.discs.setColorAt(0, CAS.c.setHex(0xd8b040)); CAS.discs.count = 0;
  // chips: the canvas is a mask (r = white edge stripe, g = shade) mixed over the instance colour
  const ct = new THREE.CanvasTexture(cv(128, 256, (q, w) => { q.fillStyle = 'rgb(0,255,0)'; q.fillRect(0, 0, w, 256); for (let k = 0; k < 8; k++) { q.fillStyle = 'rgb(255,255,0)'; q.beginPath(); q.arc(64, 64, 62, k * PI / 4, k * PI / 4 + .32); q.arc(64, 64, 46, k * PI / 4 + .32, k * PI / 4, true); q.fill(); q.fillRect(k * 16, 192, 6, 64); }
    q.strokeStyle = 'rgb(0,175,0)'; q.lineWidth = 3; q.beginPath(); q.arc(64, 64, 40, 0, TAU); q.stroke(); }));
  const chg = new THREE.CylinderGeometry(.019, .019, .0035, 20), chu = chg.attributes.uv, nSide = 21 * 2; for (let i = 0; i < chu.count; i++) { if (i < nSide) chu.setY(i, chu.getY(i) * .25); else chu.setY(i, .5 + chu.getY(i) * .5); }
  CAS.chips = inst(chg, casInstMat(ct, 'chip', null, f => f.replace('#include <map_fragment>', 'vec4 cT = texture2D(map, vMapUv);').replace('#include <color_fragment>', 'diffuseColor.rgb = mix(vColor, vec3(.93, .9, .84), cT.r) * cT.g;')), 480); CAS.chips.setColorAt(0, CAS.c.setHex(0xffffff)); CAS.chips.count = 0;
  // cards: two faces back to back; a per-instance atlas cell (13 ranks x 4 suits, back in column 13)
  const cg = new THREE.BufferGeometry(), F = new THREE.PlaneGeometry(.063, .088).rotateX(-PI / 2), Bk = new THREE.PlaneGeometry(.063, .088).rotateX(PI / 2).translate(0, -.0004, 0), cat = (k, n) => { const a = new Float32Array(F.attributes[k].array.length * 2); a.set(F.attributes[k].array); a.set(Bk.attributes[k].array, F.attributes[k].array.length); return new THREE.BufferAttribute(a, n); };
  cg.setAttribute('position', cat('position', 3)); cg.setAttribute('normal', cat('normal', 3)); cg.setAttribute('uv', cat('uv', 2)); cg.setAttribute('cb', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1)); cg.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  CAS.cOff = new THREE.InstancedBufferAttribute(new Float32Array(48), 2); cg.setAttribute('cOff', CAS.cOff); const at = new THREE.CanvasTexture(casCardCv()); at.colorSpace = THREE.SRGBColorSpace; at.anisotropy = 4;
  CAS.cards = inst(cg, casInstMat(at, 'card', v => v.replace('#include <common>', '#include <common>\nattribute vec2 cOff; attribute float cb;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (uv + mix(cOff, vec2(13., 0.), cb)) * vec2(1. / 14., .25);')), 24); CAS.cards.count = 0;
  // reels: open cylinders on the machine's width axis; the strip scrolls per instance
  const rg = new THREE.CylinderGeometry(.1, .1, .11, 28, 1, true).rotateX(PI / 2); CAS.rOff = new THREE.InstancedBufferAttribute(new Float32Array(9), 1); CAS.rOff.setUsage(THREE.DynamicDrawUsage); rg.setAttribute('rOff', CAS.rOff);
  const rt = new THREE.CanvasTexture(casReelCv()); rt.colorSpace = THREE.SRGBColorSpace; rt.anisotropy = 4;
  CAS.reels = inst(rg, casInstMat(rt, 'reel', v => v.replace('#include <common>', '#include <common>\nattribute float rOff;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2(uv.y, 1. - fract(uv.x + rOff));')), 9);
  for (let m = 0; m < 3; m++) for (let j = 0; j < 3; j++) { CAS.p.set(4.55, 1.2, CAS_SL.z[m] + (j - 1) * .14); CAS.q.identity(); CAS.s.set(1, 1, 1); CAS.reels.setMatrixAt(m * 3 + j, CAS.m.compose(CAS.p, CAS.q, CAS.s)); CAS.rOff.setX(m * 3 + j, (6.5 - j * 2) / 7 - .75); }
  const lv = [new THREE.CylinderGeometry(.011, .011, .34, 8).translate(0, .17, 0), new THREE.SphereGeometry(.036, 12, 8).translate(0, .36, 0), new THREE.CylinderGeometry(.03, .03, .05, 10).rotateX(PI / 2)];
  CAS.levers = inst(mergeC([colGeo(lv[0], [.85, .85, .88]), colGeo(lv[1], [.8, .06, .08]), colGeo(lv[2], [.3, .3, .32])]), new THREE.MeshStandardMaterial({vertexColors: true, metalness: .6, roughness: .3}), 3);
  // stack labels: one atlas (4 x 8 cells), redrawn only when bets change; one instanced quad per stack
  const lc = cv(512, 256, () => {}); CAS.lblG = lc.getContext('2d'); CAS.lblT = new THREE.CanvasTexture(lc); CAS.lblT.colorSpace = THREE.SRGBColorSpace; CAS.lblT.anisotropy = 4;
  const lg = new THREE.PlaneGeometry(.075, .019); CAS.lOff = new THREE.InstancedBufferAttribute(new Float32Array(64), 2); lg.setAttribute('cOff', CAS.lOff);
  const lm = new THREE.MeshBasicMaterial({map: CAS.lblT, transparent: true, depthWrite: false}); lm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 cOff;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (uv + cOff) * vec2(.25, .125);'); }; lm.customProgramCacheKey = () => 'cas-lbl';
  CAS.lbl = inst(lg, lm, 32); CAS.lbl.receiveShadow = false; CAS.lbl.count = 0; CAS.lbl.renderOrder = 2;
  CAS.hl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), new THREE.MeshBasicMaterial({color: 0xfff0b0, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending})); CAS.hl.visible = false; g.add(CAS.hl);
  casDealer(g);
  const gl = CAS.glow = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xffa850, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .5})); gl.scale.setScalar(3.2); const [x, z] = casW(0, -4.4); gl.position.set(x, b.fy + 2.3, z); scene.add(gl);
}
// the dealer: a crew avatar re-dressed (waistcoat, white shirt, bow tie), baked to one body mesh and two arms
function casDealer(g) {
  const c = buildCrew(0x2a1a3a), j = c.userData; scene.remove(c); c.position.set(0, 0, 0); c.updateMatrixWorld(true);
  const col = o => { const h = o.material.color.getHex(); return o.parent === j.head && h === 0xc8a020 ? [.16, .1, .07] : h === 0xc8a020 ? [.1, .08, .12] : h === 0x2a2e30 ? [.06, .06, .07] : o.material.color.toArray(); };
  const body = [], arms = [[], []], skip = new Set([j.beam, j.box, ...j.it.filter(Boolean)]);
  c.traverse(o => { if (!o.isMesh || skip.has(o)) return; const side = o.parent === j['a-1'] ? 0 : o.parent === j.a1 ? 1 : -1, geo = o.geometry.clone();
    if (side < 0) geo.applyMatrix4(o.matrixWorld); else geo.applyMatrix4(o.matrix); (side < 0 ? body : arms[side]).push(colGeo(geo, col(o))); });
  body.push(colGeo(new THREE.BoxGeometry(.2, .3, .02).translate(0, 1.38, -.155), [.95, .94, .9]), colGeo(new THREE.ConeGeometry(.028, .05, 6).rotateZ(PI / 2).translate(-.025, 1.52, -.168), [.05, .05, .05]), colGeo(new THREE.ConeGeometry(.028, .05, 6).rotateZ(-PI / 2).translate(.025, 1.52, -.168), [.05, .05, .05]));
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7}), d = CAS.dealer = new THREE.Group(); d.position.set(CAS_BJ.cx, 0, CAS_BJ.dz); g.add(d);
  d.add(new THREE.Mesh(mergeC(body), mat)); CAS.arms = arms.map((L, i) => { const m = new THREE.Mesh(mergeC(L), mat); m.position.set(i ? .27 : -.27, 1.5, 0); d.add(m); return m; });
  c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}
// ---- seats (host decides, everyone applies 'csit'); seated players are pinned to the stool by the stepPlayer wrapper
function casSitLocal(t, s) { if (!P.cas) P.casEq = P.eq; P.cas = {t, s}; P.eq = 0; F.st = 'idle'; if (P.casChip == null) P.casChip = 1; const q = CAS.seatW[t][s]; P.yaw = q.yaw; P.pitch = -.55; P.vx = P.vz = 0; Snd.casChip(0);
  let f = ''; try { f = localStorage.getItem(SK('s9-cas-help')) || ''; } catch (e) {} if (!f.includes(t)) { CAS.help = {t, u: CAS.ct + 10}; try { localStorage.setItem(SK('s9-cas-help'), f + t + ' '); } catch (e) {} } }
function casStandLocal() { const c = P.cas; if (!c) return; const q = CAS.seatW[c.t][c.s]; P.cas = null; P.x = q.sx; P.z = q.sz; P.y = CAS.b.fy; P.cr = 0; P.eq = P.casEq || 0; if (P.eq && !slotOk(P.eq)) P.eq = 0; if (CAS.hl) CAS.hl.visible = false; CAS.aim = null; }
function casPin(dt) { const q = CAS.seatW[P.cas.t][P.cas.s]; P.x = q.x; P.z = q.z; P.y = CAS.b.fy; P.ob = 0; P.sw = 0; P.vx = P.vz = P.vy = 0; P.cr = 1; P.run = 0; P.eye = 1.25; P.eq = 0; P.deep = 0; P.dv = 0;
  P.yaw = q.yaw + clamp(angD(q.yaw, P.yaw), -1.31, 1.31); P.pitch = clamp(P.pitch, -1.1, .3); P.stam = Math.min(1, P.stam + dt / 7); }
const casSeated = t => { const L = CAS.seats[t]; for (let i = 0; i < L.length; i++) if (L[i]) return true; return false; };
const casNope = (id, why) => emit({k: 'nope', id, why, cas: 1});
function casLeave(id) { const J = CAS.bj, s = CAS.seats.bj.indexOf(id); if (s >= 0 && J.ph === 'bet' && J.ch[s].length) { const v = J.ch[s].reduce((a, c) => a + c, 0); G.cash += v; emit({k: 'cbet', t: 'bj', id, s, v, x: 2}); }
  if (s >= 0 && J.ph === 'turn' && J.turn === s) casBjNext(s, 3); emit({k: 'csit', id, t: null}); }
// ---- host: roulette rounds, the blackjack shoe and turns, slot payouts
const casWA = t => CAS.rl.a0 + 12.222 * (1 - Math.exp(-.18 * Math.max(0, t - CAS.rl.t0)));
function casShuffle() { const J = CAS.bj, r = casR(100000 + (++J.sh)), d = J.shoe = []; for (let k = 0; k < 6; k++) for (let c = 0; c < 52; c++) d.push(c); for (let i = d.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)), t = d[i]; d[i] = d[k]; d[k] = t; } }
function casDraw() { const J = CAS.bj; if (CAS.bjForce && CAS.bjForce.length) return CAS.bjForce.shift() % 52; if (!J.shoe.length) casShuffle(); return J.shoe.pop(); }
function casDeal() { const J = CAS.bj, live = []; for (let s = 0; s < 3; s++) if (J.seats[s][1] > 0 && J.seats[s][0]) live.push(s); if (!live.length) { J.T = 0; return; }
  if (J.shoe.length < 78) casShuffle(); J.q = []; for (const s of live) J.q.push([s, casDraw()]); J.q.push([-1, casDraw()]); for (const s of live) J.q.push([s, casDraw()]); J.hole = casDraw(); J.q.push([-1, -1]); J.ph = 'deal'; J.qT = .25; CAS.v++; }
function casAfterDeal() { const J = CAS.bj; for (const q of J.seats) if (q[3] === 2 && q[2].length === 2 && CAS_BJ.val(q[2]) === 21) q[3] = 5;
  const up = J.dl[0] % 13; if ((up === 0 || up >= 9) && CAS_BJ.val([J.dl[0], J.hole]) === 21) { emit({k: 'cdeal', s: -1, c: J.hole, rv: 1}); casBjPay(); return; } J.ph = 'turn'; casBjNext(-1, 0); }
function casBjNext(s, st) { const J = CAS.bj; if (s >= 0 && J.seats[s][3] === 2) J.seats[s][3] = st; CAS.v++;
  for (let k = s + 1; k < 3; k++) if (J.seats[k][3] === 2) { J.turn = k; J.T = 15; J.ph = 'turn'; return; }
  J.turn = -1; J.ph = 'dealer'; J.qT = .9; J.live = J.seats.some(q => q[3] === 3 || q[3] === 6); emit({k: 'cdeal', s: -1, c: J.hole, rv: 1}); }
function casBjPay() { const J = CAS.bj, dv = CAS_BJ.val(J.dl), dbj = dv === 21 && J.dl.length === 2, res = [], w = new Map(); let tot = 0;
  for (let s = 0; s < 3; s++) { const q = J.seats[s]; if (!(q[1] > 0) || !q[0]) continue; const pv = CAS_BJ.val(q[2]), nat = pv === 21 && q[2].length === 2;
    const back = pv > 21 ? 0 : nat ? (dbj ? q[1] : Math.floor(q[1] * 2.5)) : dbj ? 0 : dv > 21 || pv > dv ? q[1] * 2 : pv === dv ? q[1] : 0;
    tot += back; res.push([s, back - q[1], pv]); w.set(q[0], (w.get(q[0]) || 0) + back - q[1]); }
  G.cash += tot; J.ph = 'pay'; J.T = 3.5; CAS.v++; emit({k: 'cbjr', res, d: dv}); emit({k: 'cpay', t: 'bj', w: [...w]}); save(); }
function casSettle() { const R = CAS.rl, n = R.res, w = new Map(); let tot = 0;
  for (const [id, c, v] of R.bets) { const back = CAS_RL.win(c, n) ? v * (CAS_RL.pay(c) + 1) : 0; tot += back; w.set(id, (w.get(id) || 0) + back - v); }
  G.cash += tot; emit({k: 'cpay', t: 'rl', r: R.n, res: n, w: [...w]}); save(); }
function casHost(dt) {
  const S = CAS.seats, R = CAS.rl, J = CAS.bj;
  for (let ti = 0; ti < 2; ti++) { const L = ti ? S.bj : S.rl; for (let s = 0; s < L.length; s++) { const id = L[s]; if (!id) continue; const p = PL.get(id); if (!p || p.dead || p.down) casLeave(id); } }
  const rlOn = casSeated('rl'), bjOn = casSeated('bj');
  if (R.ph === 'idle') { if (rlOn || R.bets.length) { R.ph = 'bet'; R.T = 15; CAS.v++; } }
  else if ((R.T -= dt) <= 0) {
    if (R.ph === 'bet') { if (R.bets.length) { const n = R.n + 1, res = CAS.force != null ? clamp(CAS.force | 0, 0, 36) : Math.floor(casR(n)() * 37); CAS.force = null; emit({k: 'crl', r: n, res, t0: +G.t.toFixed(2), a0: +(casWA(G.t) % TAU).toFixed(3)}); } else { if (!rlOn) R.ph = 'idle'; R.T = 15; CAS.v++; } }
    else if (R.ph === 'spin') casSettle();
    else { R.ph = rlOn ? 'bet' : 'idle'; R.T = 15; CAS.v++; } }
  if (J.ph === 'idle') { if (bjOn) { J.ph = 'bet'; J.T = 0; CAS.v++; } }
  else if (J.ph === 'bet') { let nb = 0, ns = 0; for (let s = 0; s < 3; s++) if (S.bj[s]) { ns++; if (J.seats[s][1] > 0) nb++; }
    if (!ns && !nb) { J.ph = 'idle'; CAS.v++; } else if (J.T > 0) { if (nb && nb === ns && J.T > 2) { J.T = 2; CAS.v++; } if ((J.T -= dt) <= 0) casDeal(); } }
  else if (J.ph === 'deal') { if ((J.qT -= dt) <= 0) { J.qT = .35; const d = J.q.shift(); if (d) emit({k: 'cdeal', s: d[0], c: d[1]}); else casAfterDeal(); } }
  else if (J.ph === 'turn') { if (!S.bj[J.turn] || (J.T -= dt) <= 0) casBjNext(J.turn, 3); }
  else if (J.ph === 'dealer') { if ((J.qT -= dt) <= 0) { J.qT = .6; if (J.live && CAS_BJ.val(J.dl) < 17) emit({k: 'cdeal', s: -1, c: casDraw()}); else casBjPay(); } }
  else if (J.ph === 'pay') { if ((J.T -= dt) <= 0) { emit({k: 'cdeal', s: -2}); J.ph = bjOn ? 'bet' : 'idle'; J.T = 0; CAS.v++; } }
  for (let m = 0; m < 3; m++) { const q = CAS.slPay[m]; if (q && G.t - CAS.sl[m][4] >= 2.3) { CAS.slPay[m] = null; if (q.w > 0) G.cash += q.w; emit({k: 'cpay', t: 'sl', m, w: [[q.id, q.w - q.v]], x: q.x}); save(); } }
}
function casAct(id, m) {
  const p = PL.get(id), S = CAS.seats, R = CAS.rl, J = CAS.bj; if (!p || !G.on || !CAS.b) return;
  const now = performance.now(); if (m.a !== 'csit' && !TEST && now - (p.casT || 0) < 60) return; p.casT = now;
  if (m.g === undefined && (m.t === 'rl' || m.t === 'bj')) m = Object.assign({}, m, {g: m.t}); // direct calls may name the table t (on the wire t is the message type)
  const v = CAS_CHIPS.includes(m.v) ? m.v : 0, ai = v >= 100 && v * 2 >= G.cash ? 1 : 0;
  if (m.a === 'csit') { const was = S.rl.includes(id) || S.bj.includes(id);
    if (m.g !== 'rl' && m.g !== 'bj') { if (was) casLeave(id); return; }
    const L = S[m.g], s = m.s | 0, q = CAS.seatW[m.g][s]; if (!q) return; if (L[s] && L[s] !== id) return casNope(id, 'That seat is taken.');
    if (Math.hypot(p.x - q.x, p.z - q.z) > 3 || Math.abs(p.y - CAS.b.fy) > 1.5) return casNope(id, 'Walk up to the table first.');
    if (was) casLeave(id); emit({k: 'csit', id, t: m.g, s}); }
  else if (m.a === 'cb' && m.g === 'rl') { const c = m.c | 0; if (!v || c < 0 || c > 48) return; if (!S.rl.includes(id)) return casNope(id, 'Take a seat first.'); if (R.ph !== 'bet' && R.ph !== 'idle') return casNope(id, 'No more bets.');
    let mine = 0; for (const q of R.bets) if (q[0] === id) mine += q[2]; if (mine + v > CAS_RL.max) return casNope(id, 'Table limit: $5,000 a spin.'); if (G.cash < v) return casNope(id, 'Not enough crew cash.');
    G.cash -= v; emit({k: 'cbet', t: 'rl', id, c, v, ai}); }
  else if (m.a === 'cb' && m.g === 'bj') { const s = S.bj.indexOf(id); if (!v || s < 0) return; if (J.ph !== 'bet' && J.ph !== 'idle') return casNope(id, 'Wait for the next hand.');
    if (J.seats[s][1] + v > CAS_BJ.max) return casNope(id, 'Table limit: $2,000 a hand.'); if (G.cash < v) return casNope(id, 'Not enough crew cash.');
    G.cash -= v; emit({k: 'cbet', t: 'bj', id, s, v, ai}); }
  else if (m.a === 'cbx') { if (m.g === 'rl') { if (R.ph !== 'bet') return; for (let i = R.bets.length - 1; i >= 0; i--) { const q = R.bets[i]; if (q[0] === id) { G.cash += q[2]; emit({k: 'cbet', t: 'rl', id, c: q[1], v: q[2], x: 1}); return; } } }
    else { const s = S.bj.indexOf(id); if (s < 0 || J.ph !== 'bet' || !J.ch[s].length) return; const c = J.ch[s].pop(); G.cash += c; emit({k: 'cbet', t: 'bj', id, s, v: c, x: 1}); } }
  else if (m.a === 'cbj') { const s = S.bj.indexOf(id); if (s < 0 || J.ph !== 'turn' || J.turn !== s) return; const q = J.seats[s];
    if (m.x === 'hit') { emit({k: 'cdeal', s, c: casDraw()}); const t = CAS_BJ.val(q[2]); if (t > 21) casBjNext(s, 4); else if (t === 21) casBjNext(s, 3); else { J.T = 15; CAS.v++; } }
    else if (m.x === 'stand') casBjNext(s, 3);
    else if (m.x === 'dbl') { if (q[2].length !== 2) return casNope(id, 'Double on your first two cards.'); if (G.cash < q[1]) return casNope(id, 'Not enough crew cash.'); G.cash -= q[1]; emit({k: 'cbet', t: 'bj', id, s, v: q[1], dbl: 1}); emit({k: 'cdeal', s, c: casDraw()}); casBjNext(s, CAS_BJ.val(q[2]) > 21 ? 4 : 6); } }
  else if (m.a === 'csl') { const k = m.m | 0, z = CAS_SL.z[k]; if (z == null || !v || v > CAS_SL.max) return; const [x, wz] = casW(4.1, z); if (Math.hypot(p.x - x, p.z - wz) > 3) return;
    if (CAS.slPay[k] || G.t - CAS.sl[k][4] < 2.6) return casNope(id, 'That machine is still spinning.'); if (G.cash < v) return casNope(id, 'Not enough crew cash.');
    const f = CAS.slForce, r = f ? f.slice(0, 3).map(i => clamp(i | 0, 0, 6)) : [0, 1, 2].map(() => CAS_SL.pick(CR)), x3 = CAS_SL.mult(r[0], r[1], r[2]); CAS.slForce = null;
    G.cash -= v; CAS.slPay[k] = {id, v, w: Math.floor(v * x3), x: x3}; emit({k: 'cslr', m: k, id, r, v, t0: +G.t.toFixed(2), ai}); }
}
// ---- events on every client (the host applies its own through emit)
const CAS_EV = new Set(['csit', 'cbet', 'crl', 'cdeal', 'cbjr', 'cslr', 'cpay']);
function casSnd(f, lx, ly, lz, ...a) { if (!A.on || !CAS.b) return; const [x, z] = casW(lx, lz); if (Math.hypot(x - cam.position.x, z - cam.position.z) > 30) return; f(...a, at(x, CAS.b.fy + ly, z, 2.5)); }
function casSeatL(id) { for (const t of ['rl', 'bj']) { const s = CAS.seats[t].indexOf(id); if (s >= 0) return CAS.seatW[t][s]; } return null; }
function casEv(e) {
  const me = myId(), R = CAS.rl, J = CAS.bj, p = PL.get(e.id), nm = p ? String(p.name).replace(/[<>&]/g, '') : 'Someone';
  switch (e.k) {
    case 'csit': { for (const t of ['rl', 'bj']) { const L = CAS.seats[t]; for (let i = 0; i < L.length; i++) if (L[i] === e.id) L[i] = null; }
      if (e.t && CAS.seats[e.t] && e.s >= 0 && e.s < CAS.seats[e.t].length) CAS.seats[e.t][e.s] = e.id; if (e.id === me && P) { if (e.t) casSitLocal(e.t, e.s); else casStandLocal(); } CAS.dirty = 1; break; }
    case 'cbet': { if (e.t === 'rl') { if (e.x) { for (let i = R.bets.length - 1; i >= 0; i--) { const q = R.bets[i]; if (q[0] === e.id && q[1] === e.c && q[2] === e.v) { R.bets.splice(i, 1); break; } } } else { R.bets.push([e.id, e.c, e.v]); if (R.ph === 'idle') { R.ph = 'bet'; R.T = 15; } }
        const o = CAS_RL.rect(e.c, CAS.hc); casSnd(Snd.casChip, CAS_RL.fx + (o[1] + o[2]) / 2, .83, CAS_RL.cz + (o[3] + o[4]) / 2, 2); }
      else { const q = J.seats[e.s]; if (!q) break; if (e.x === 2) { q[1] = 0; q[3] = 0; if (isHost()) J.ch[e.s] = []; } else if (e.x) { q[1] = Math.max(0, q[1] - e.v); if (!q[1]) q[3] = 0; }
        else { q[0] = e.id; q[1] += e.v; if (!q[3]) q[3] = 1; if (isHost() && !e.dbl) J.ch[e.s].push(e.v); if (J.ph === 'idle') J.ph = 'bet'; if (J.ph === 'bet' && !(J.T > 0)) J.T = 10; }
        casSnd(Snd.casChip, CAS_BJ.cx + Math.sin(CAS_BJ.A[e.s]) * .78, .83, CAS_BJ.cz - Math.cos(CAS_BJ.A[e.s]) * .78, 3); }
      if (e.ai && !e.x) { showMsg(`${nm} went all in ${e.t === 'rl' ? 'on ' + CAS_RL.name(e.c).toLowerCase() : 'at blackjack'}`, 'LUCKY LANTERN', 3); Snd.casOoh(); }
      CAS.dirty = 1; break; }
    case 'crl': Object.assign(R, {ph: 'spin', T: 7, n: e.r, res: e.res, t0: e.t0, a0: e.a0}); casUnwrap(); casSnd(Snd.casDrop, CAS_RL.wx, .9, CAS_RL.cz); break;
    case 'cdeal': {
      if (e.s === -2) { for (const q of J.seats) { q[1] = 0; q[2] = []; q[3] = 0; } J.dl = []; if (isHost()) J.ch = [[], [], []]; for (const c of CAS.cv) if (!c.out) c.out = CAS.ct; CAS.dl.p = 'sweep'; CAS.dl.t = CAS.ct; CAS.dirty = 1; casSnd(Snd.casCard, CAS_BJ.cx, .85, 1.8); break; }
      if (e.s === -1 && e.rv) { const i = J.dl.indexOf(-1); if (i >= 0) J.dl[i] = e.c; for (const c of CAS.cv) if (c.s === -1 && c.c < 0) { c.c = e.c; c.fl = CAS.ct; } CAS.kd = 1; CAS.dl.p = 'reveal'; CAS.dl.t = CAS.ct; }
      else { const L = e.s === -1 ? J.dl : J.seats[e.s] && J.seats[e.s][2]; if (!L) break; L.push(e.c); if (e.s >= 0 && J.seats[e.s][3] < 2) J.seats[e.s][3] = 2; casCardAdd(e.s, e.c, L.length - 1, 1); CAS.dl.p = 'deal'; CAS.dl.t = CAS.ct; CAS.dl.s = e.s; }
      CAS.cvSig = casCardSig(); casSnd(Snd.casCard, CAS_BJ.cx, .85, 1.8); break; }
    case 'cbjr': { J.ph = 'pay'; J.T = 3.5; CAS.bjNet = e.res; for (const [s, net, pv] of e.res) if (J.seats[s] && J.seats[s][0] === me) showMsg(`${pv > 21 ? 'Bust' : pv} against ${e.d > 21 ? 'a dealer bust' : e.d}${net > 0 ? ' · +' + money(net) : net < 0 ? ' · -' + money(-net) : ' · push'}`, 'BLACKJACK', 3); break; }
    case 'cslr': CAS.sl[e.m] = [e.id, e.r[0], e.r[1], e.r[2], e.t0]; casSnd(Snd.casLever, 4.4, 1.2, CAS_SL.z[e.m]); if (e.ai) { showMsg(`${nm} went all in on the slots`, 'LUCKY LANTERN', 3); Snd.casOoh(); } break;
    case 'cpay': { let net = null; for (const q of e.w) if (q[0] === me) net = q[1];
      if (e.t === 'rl') { for (const st of CAS.stk) { const win = st.rc != null && CAS_RL.win(st.rc, e.res), q = casSeatL(st.id); st.out = {t0: CAS.ct, tx: win ? (q ? q.lx : st.x) : CAS_RL.wx + .2, tz: win ? (q ? q.lz + .3 : st.z - .5) : CAS_RL.cz + .45}; CAS.lv.push(st); }
        CAS.stk = []; R.bets = []; R.ph = 'pay'; R.T = 3.5; if (net != null && net < 1000) showMsg(`${e.res} ${e.res === 0 ? 'green' : RED.has(e.res) ? 'red' : 'black'}${net > 0 ? ' · +' + money(net) : net < 0 ? ' · -' + money(-net) : ''}`, 'ROULETTE', 3); }
      else if (e.t === 'bj') { for (const st of CAS.stk) { const r = (CAS.bjNet || []).find(q => q[0] === st.bs), win = r && r[1] >= 0, q = CAS.seatW.bj[st.bs]; st.out = {t0: CAS.ct, tx: win && q ? q.lx : CAS_BJ.cx, tz: win && q ? q.lz + .3 : 2.05}; CAS.lv.push(st); }
        CAS.stk = []; for (const q of J.seats) q[1] = 0; J.ph = 'pay'; J.T = 3.5; CAS.dl.p = 'sweep'; CAS.dl.t = CAS.ct + 1; }
      else if (e.t === 'sl') { CAS.slWin = CAS.slWin || [0, 0, 0]; CAS.slWin[e.m] = e.x > 1 ? CAS.ct : 0; if (net != null && net < 1000 && e.x > 0) showMsg(e.x > 1 ? `×${e.x} · +${money(net)}` : 'Money back', 'SLOTS', 2.5);
        if (e.x >= 35 && CAS.b) { const [x, z] = casW(4.2, CAS_SL.z[e.m]); spray(x, CAS.b.fy + 1.3, z, 30, 2.5); for (let k = 0; k < 2; k++) { const [rx, rz] = casW(0, -6 - k * 2); spawnRocket({x: rx, y: CAS.b.fy + 1, z: rz, vx: (Math.random() - .5) * 4, vy: 22 + Math.random() * 6, vz: (Math.random() - .5) * 4, c: Math.floor(Math.random() * 6)}); } casSnd(Snd.casJack, 4.4, 1.6, CAS_SL.z[e.m]); }
        else if (e.x > 1) casSnd(Snd.casWin, 4.4, 1.6, CAS_SL.z[e.m]); }
      if (net != null && e.t !== 'sl') { if (net > 0) Snd.casWin(); else if (net < 0) tone(150, .05, .4, 'triangle', null, 90); }
      for (const [id, n] of e.w) if (n >= 1000) { const q = PL.get(id), who = q ? String(q.name).replace(/[<>&]/g, '') : 'Someone'; showMsg(e.t === 'rl' ? `${who} hit ${e.res}! +${money(n)}` : e.t === 'bj' ? `${who} took the dealer for ${money(n)}!` : `${who} hit the jackpot! +${money(n)}`, 'LUCKY LANTERN', 5); Snd.casOoh(); }
      CAS.cd = 1; CAS.dirty = 1; break; }
  }
  if (isHost()) CAS.v++;
}
// ---- snapshot 'cs' (on change, at most 4 Hz, a keyframe every 3 s for late joiners)
function casPack() { const R = CAS.rl, J = CAS.bj; return {rl: [R.ph, +R.T.toFixed(1), R.n, R.bets, R.res, R.t0, R.a0], bj: [J.ph, +Math.max(0, J.T).toFixed(1), J.turn, J.seats.map(q => [q[0], q[1], q[2], q[3]]), J.dl], sl: CAS.sl, seats: CAS.seats}; }
function casUnpack(cs) { const R = CAS.rl, J = CAS.bj, me = myId();
  if (cs.rl) { const [ph, T, n, bets, res, t0, a0] = cs.rl, bs = JSON.stringify(bets || []); if (bs !== JSON.stringify(R.bets)) CAS.dirty = 1; const nt = t0 !== R.t0; Object.assign(R, {ph, T, n, bets: bets || [], res, t0, a0}); if (nt) casUnwrap(); }
  if (cs.bj) { const [ph, T, turn, seats, dl] = cs.bj; Object.assign(J, {ph, T, turn, dl: dl || []}); (seats || []).forEach((q, i) => { if (J.seats[i]) { const o = J.seats[i]; if (o[1] !== q[1]) CAS.dirty = 1; J.seats[i] = [q[0], q[1], q[2] || [], q[3]]; } }); const sg = casCardSig(); if (sg !== CAS.cvSig) casCardsSync(); }
  if (cs.sl) cs.sl.forEach((q, i) => { if (CAS.sl[i]) CAS.sl[i] = q.slice(); });
  if (cs.seats) { for (const t of ['rl', 'bj']) if (Array.isArray(cs.seats[t])) cs.seats[t].forEach((id, i) => { if (i < CAS.seats[t].length && CAS.seats[t][i] !== id) { CAS.seats[t][i] = id || null; CAS.dirty = 1; } });
    if (P && G.on) { const L = P.cas && CAS.seats[P.cas.t]; if (P.cas && (!L || L[P.cas.s] !== me)) casStandLocal(); else if (!P.cas) for (const t of ['rl', 'bj']) { const s = CAS.seats[t].indexOf(me); if (s >= 0) casSitLocal(t, s); } } }
}
// ball choreography: pick the turn count so the ball's free path ends within half a turn of its pocket
function casUnwrap() { const R = CAS.rl; if (R.res < 0) return; const bf = R.a0 + 1 + 16.364 * (1 - Math.exp(-.55 * 6.2)), tg = RL.indexOf(R.res) / 37 * TAU - (R.a0 + 12.222 * (1 - Math.exp(-.18 * 6.2))); R.k = Math.round((bf - tg) / TAU); }
// ---- cards: visual list from the shoe to the felt
function casCardSig() { const J = CAS.bj; let s = J.dl.join(','); for (const q of J.seats) s += '|' + q[2].join(','); return s; }
function casCardAdd(s, c, k, anim) { const J = CAS_BJ; let x, z, yaw; if (s < 0) { x = J.cx + .03 - k * .022; z = 1.9; yaw = PI; } else { const a = J.A[s]; x = J.cx + Math.sin(a) * .46 - Math.cos(a) * (k * .015 - .02); z = J.cz - Math.cos(a) * .46 - Math.sin(a) * (k * .015 - .02); yaw = Math.atan2(Math.sin(a), -Math.cos(a)); }
  CAS.cv.push({c, s, x, y: .8265 + k * .0005, z, yaw, t0: anim ? CAS.ct : -9, fl: 0, out: 0}); CAS.kd = 1; }
function casCardsSync() { const J = CAS.bj; CAS.cv = CAS.cv.filter(c => c.out); J.dl.forEach((c, k) => casCardAdd(-1, c, k, 0)); J.seats.forEach((q, s) => q[2].forEach((c, k) => casCardAdd(s, c, k, 0))); CAS.cvSig = casCardSig(); CAS.kd = 1; }
// ---- chip stacks: rebuilt when bets change (not per frame); greedy split, largest at the bottom, at most 12 high
function casLayout() { CAS.dirty = 0; CAS.cd = 1; const old = new Map(CAS.stk.map(s => [s.key, s])), out = [], R = CAS.rl, J = CAS.bj, o = CAS.hc;
  const add = (key, x, z, v, id, extra) => { const p = PL.get(id), st = old.get(key) || {key, hop: -9, v: 0}; if (v > st.v) { st.hop = CAS.ct; const q = casSeatL(id); st.hx = q ? q.lx + q.dx * .25 : x; st.hz = q ? q.lz + q.dz * .25 : z; st.hy = q ? .95 : 1.1; }
    Object.assign(st, {x, z, y: .825, v, id, col: p ? CREW_COL[p.c % 6] : 0x888888}, extra); const ch = st.ch = []; let r = v; for (let k = 4; k >= 0; k--) while (r >= CAS_CHIPS[k] && ch.length < 12) { ch.push(k); r -= CAS_CHIPS[k]; } out.push(st); };
  const agg = new Map(); for (const [id, c, v] of R.bets) { const k = id + '|' + c; agg.set(k, (agg.get(k) || 0) + v); }
  for (const [k, v] of agg) { const i = k.lastIndexOf('|'), id = k.slice(0, i), c = +k.slice(i + 1), s = Math.max(0, CAS.seats.rl.indexOf(id)); CAS_RL.rect(c, o); const wide = o[2] - o[1] > .2, ox = wide ? (s - 1.5) * .05 : (s % 2 - .5) * .045, oz = wide ? 0 : (s >> 1) * .06 - .03;
    add('r' + k, CAS_RL.fx + (o[1] + o[2]) / 2 + ox, CAS_RL.cz + (o[3] + o[4]) / 2 + oz, v, id, {rc: c, bs: -1}); }
  J.seats.forEach((q, s) => { if (q[1] > 0) add('b' + s, CAS_BJ.cx + Math.sin(CAS_BJ.A[s]) * .78, CAS_BJ.cz - Math.cos(CAS_BJ.A[s]) * .78, q[1], q[0], {rc: null, bs: s}); });
  CAS.stk = out; casLabels(); }
function casLabels() { const g = CAS.lblG; if (!g) return; const n = Math.min(32, CAS.stk.length); g.clearRect(0, 0, 512, 256); g.font = 'bold 21px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) { const c = i % 4, r = i >> 2, x = c * 128, y = (7 - r) * 32; g.fillStyle = 'rgba(14,9,5,.8)'; g.beginPath(); if (g.roundRect) g.roundRect(x + 10, y + 3, 108, 26, 12); else g.rect(x + 10, y + 3, 108, 26); g.fill();
    g.fillStyle = '#ffe2a0'; g.fillText(money(CAS.stk[i].v), x + 64, y + 17); CAS.lOff.setXY(i, c, r); }
  CAS.lOff.needsUpdate = true; CAS.lblT.needsUpdate = true; }
// ---- client animation (render calls casStep every frame): wheel and ball, chips, cards, reels, levers, lamps, the dealer. No allocations here.
function casStep(dt) {
  CAS.ct += dt; if (!CAS.g || !G.on) return; if (!isHost()) { CAS.rl.T = Math.max(0, CAS.rl.T - dt); if (CAS.bj.T > 0) CAS.bj.T = Math.max(0, CAS.bj.T - dt); } const b = CAS.b, cp = cam.position, d = Math.hypot(cp.x - b.x, cp.z - b.z), vis = d < 28 && cp.y > b.fy - 4 && cp.y < b.fy + 14;
  if (CAS.glow) CAS.glow.material.opacity = .12 + .65 * (1 - TOD.day); casAudio(dt, d);
  if (CAS.g.visible !== vis) CAS.g.visible = vis; if (!vis) return; if (CAS.dirty) casLayout();
  const ct = CAS.ct, R = CAS.rl, RT = CAS_RL, m = CAS.m, q = CAS.q, e = CAS.e, p = CAS.p, s = CAS.s, wa = casWA(G.t), t = G.t - R.t0; CAS.wheel.rotation.y = wa;
  // the ball: rim run against the wheel, a spiral drop with hops, a blended landing in pocket res at 6.2 s, then it rides along
  let ba = 1, br = .395, by = .918;
  if (R.res >= 0 && (t >= 6.2 || t < 0)) { ba = RL.indexOf(R.res) / 37 * TAU - wa + R.k * TAU; br = .258; by = .888; }
  else if (R.res >= 0) { ba = R.a0 + 1 + 16.364 * (1 - Math.exp(-.55 * t)); if (t > 2.26) { const u = clamp((t - 2.26) / .7, 0, 1), ss = smooth(u), w = smooth((t - 5.2) / 1), tg = RL.indexOf(R.res) / 37 * TAU - wa + R.k * TAU;
      br = mix(.395, .258, ss); by = mix(.918, .888, ss) + Math.abs(Math.sin(u * PI * 2.5)) * .018 * (1 - u) + (u >= 1 ? Math.abs(Math.sin((t - 2.96) * 9)) * .005 * Math.max(0, 1 - (t - 2.96) / 2.3) : 0); ba += (tg - ba) * w;
      const pk = Math.floor((ba + wa) / (TAU / 37)); if (pk !== CAS.tickP) { CAS.tickP = pk; if (ct - CAS.tickT > .04 && d < 14 && t < 6.2) { CAS.tickT = ct; if (A.on) burst(6000, 9, .04, .002); } } } }
  p.set(RT.wx + Math.cos(ba) * br, by, RT.cz + Math.sin(ba) * br); q.identity(); s.setScalar(.011); CAS.dots.setMatrixAt(0, m.compose(p, q, s));
  // the brass marker drops on the winning number once the ball has settled
  const mk = R.res >= 0 && t > 6.4 && t < 20; if (mk) { CAS_RL.rect(R.res, CAS.hc); const o = CAS.hc, f = clamp((t - 6.4) / .3, 0, 1); p.set(RT.fx + (o[1] + o[2]) / 2, RT.y + .025 + (1 - f) * (1 - f) * .25, RT.cz + (o[3] + o[4]) / 2); s.set(.014, .05, .014); } else s.setScalar(0);
  CAS.discs.setMatrixAt(0, m.compose(p, q, s));
  // chips: stacks on the felt, the top chip hops in, settled stacks slide to the winner or the house
  let ci = 0, di = 1; const ch = CAS.chips, dc = CAS.discs, cd = CAS.cd;
  for (let L = 0; L < 2; L++) { const arr = L ? CAS.lv : CAS.stk; for (let a = 0; a < arr.length; a++) { const st = arr[a]; let x = st.x, z = st.z, y = st.y, sc = 1;
    if (st.out) { const u = clamp((ct - st.out.t0) / .7, 0, 1), k = smooth(u); x = mix(st.x, st.out.tx, k); z = mix(st.z, st.out.tz, k); y += Math.sin(u * PI) * .05; sc = u > .75 ? (1 - u) * 4 : 1; if (u >= 1) CAS.lvDone = 1; }
    if (di < 64) { p.set(x, y + .0008, z); s.set(.024 * sc, .0016, .024 * sc); q.identity(); dc.setMatrixAt(di, m.compose(p, q, s)); if (cd) dc.setColorAt(di, CAS.c.setHex(st.col)); di++; }
    const n = st.ch.length; for (let k = 0; k < n && ci < 480; k++, ci++) { let cx = x + Math.sin(k * 2.3 + a) * .0012, cz = z + Math.cos(k * 1.7 + a) * .0012, cy = y + .0034 + k * .0036;
      if (k === n - 1 && !st.out) { const u = (ct - st.hop) / .22; if (u >= 0 && u < 1) { cx = mix(st.hx, cx, u); cz = mix(st.hz, cz, u); cy = mix(st.hy, cy, u) + u * (1 - u) * .4; } }
      e.set(0, k * 1.7 + a, 0); q.setFromEuler(e); p.set(cx, cy, cz); s.set(sc, 1, sc); ch.setMatrixAt(ci, m.compose(p, q, s)); if (cd) ch.setColorAt(ci, CAS.c.setHex(CAS_CC[st.ch[k]])); }
    if (!L && a < 32) { e.set(-.5, st.bs >= 0 ? PI - CAS_BJ.A[st.bs] : PI, 0); q.setFromEuler(e); p.set(x, y + .0034 + n * .0036 + .013, z); s.set(1, 1, 1); CAS.lbl.setMatrixAt(a, m.compose(p, q, s)); } } }
  const nl = Math.min(32, CAS.stk.length); CAS.lbl.count = nl; CAS.lbl.visible = nl > 0; if (nl) CAS.lbl.instanceMatrix.needsUpdate = true; ch.visible = ci > 0;
  ch.count = ci; dc.count = di; ch.instanceMatrix.needsUpdate = dc.instanceMatrix.needsUpdate = true; if (cd) { CAS.cd = 0; if (ch.instanceColor) ch.instanceColor.needsUpdate = true; if (dc.instanceColor) dc.instanceColor.needsUpdate = true; }
  if (CAS.lvDone) { CAS.lvDone = 0; CAS.lv = CAS.lv.filter(st => ct - st.out.t0 < .7); CAS.cd = 1; }
  // cards: a .35 s arc from the shoe with a spin, flip face up as they land (the hole card flips slowly at the reveal), swept to the tray
  const cv = CAS.cv, cm = CAS.cards, kd = CAS.kd, J = CAS_BJ; let gone = 0; const nc = Math.min(24, cv.length);
  for (let k = 0; k < nc; k++) { const c = cv[k], u = clamp((ct - c.t0) / .35, 0, 1); let x = mix(J.shoe[0], c.x, u), z = mix(J.shoe[2], c.z, u), y = mix(J.shoe[1], c.y, u) + Math.sin(u * PI) * .1, fa = c.c < 0 ? PI : PI * (1 - smooth((u - .55) / .45)); const yaw = c.yaw + (1 - u) * 2.6;
    if (c.fl) { const f = clamp((ct - c.fl) / .6, 0, 1); fa = PI * (1 - smooth(f)); y += Math.sin(f * PI) * .04; }
    if (c.out) { const f = clamp((ct - c.out) / .5, 0, 1), k2 = smooth(f); x = mix(x, J.tray[0], k2); z = mix(z, J.tray[2], k2); y += Math.sin(f * PI) * .08; fa = mix(fa, PI, f); if (f >= 1) gone = 1; }
    e.set(0, yaw, fa); q.setFromEuler(e); p.set(x, y, z); s.set(1, 1, 1); cm.setMatrixAt(k, m.compose(p, q, s)); if (kd) CAS.cOff.setXY(k, c.c < 0 ? 13 : c.c % 13, c.c < 0 ? 0 : Math.floor(c.c / 13)); }
  cm.count = nc; cm.visible = nc > 0; cm.instanceMatrix.needsUpdate = true; if (kd) { CAS.kd = 0; CAS.cOff.needsUpdate = true; } if (gone) { CAS.cv = cv.filter(c => !c.out || ct - c.out < .5); CAS.kd = 1; }
  // slots: reels at speed, stopping .35 s apart with a tenth-of-a-symbol overshoot; the lever dips 55 degrees and springs back; the top lamp blinks on a win
  for (let mi = 0; mi < 3; mi++) { const st = CAS.sl[mi], t0 = st[4], tt = G.t - t0, z = CAS_SL.z[mi], near = d < 12;
    if (t0 !== CAS.rt0[mi]) { CAS.rt0[mi] = t0; CAS.rk[mi] = 0; for (let j = 0; j < 3; j++) CAS.rp[mi * 3 + j] = CAS.rOff.getX(mi * 3 + j); }
    for (let j = 0; j < 3; j++) { const tg = (st[1 + j] + .5) / 7 - .75, ts = 1.6 + .35 * j; let r = tg;
      if (t0 > -50 && tt >= 0 && tt < ts) { r = mix(CAS.rp[mi * 3 + j], tg + 3.2 * (ts - tt), smooth(tt / .3)); if (near && Math.floor(r * 7) !== Math.floor(CAS.rOff.getX(mi * 3 + j) * 7) && ct - CAS.tickT > .03) { CAS.tickT = ct; if (A.on) tone(700, .012, .004, 'square'); } }
      else if (t0 > -50 && tt >= ts && tt < ts + .25) { r = tg - .1 / 7 * Math.sin(PI * (tt - ts) / .25); if (!(CAS.rk[mi] & (1 << j))) { CAS.rk[mi] |= 1 << j; if (near && A.on) { tone(140, .1, .14, 'sine', null, 70); burst(400, 1, .06, .05, 'lowpass'); } } }
      CAS.rOff.setX(mi * 3 + j, r); }
    const lt = tt, pull = t0 < -50 || lt < 0 || lt > 1.3 ? 0 : lt < .22 ? smooth(lt / .22) : Math.exp(-(lt - .22) * 7) * Math.cos((lt - .22) * 18);
    e.set(0, 0, pull * .96); q.setFromEuler(e); p.set(4.62, 1.06, z + .39); s.set(1, 1, 1); CAS.levers.setMatrixAt(mi, m.compose(p, q, s));
    const wt = CAS.slWin ? CAS.slWin[mi] : 0, blink = wt && ct - wt < 3.5, x3 = CAS_SL.mult(st[1], st[2], st[3]), on = blink && (Math.floor(ct * (x3 >= 35 ? 12 : 7)) % 2);
    if (on) CAS.c.setRGB(x3 >= 35 && Math.floor(ct * 6) % 2 ? 2.6 : 2.4, x3 >= 35 && Math.floor(ct * 6) % 2 ? .4 : 1.7, .4); else CAS.c.setRGB(.7 + .15 * Math.sin(ct * 2 + mi), .42, .14); CAS.dots.setColorAt(1 + mi, CAS.c);
    p.set(4.62, 1.82, z); s.setScalar(.048); q.identity(); CAS.dots.setMatrixAt(1 + mi, m.compose(p, q, s)); }
  CAS.rOff.needsUpdate = true; CAS.levers.instanceMatrix.needsUpdate = true; CAS.dots.instanceMatrix.needsUpdate = true; CAS.dots.instanceColor.needsUpdate = true;
  // the dealer: three canned arm poses (deal, sweep, reveal)
  const dl = CAS.dl, ta = ct - dl.t; let lx = .45, rx = .45, lz = 0, rz = 0;
  if (dl.p === 'deal' && ta < .45) { const k = Math.sin(clamp(ta / .45, 0, 1) * PI); lx += .55 * k; rx += .9 * k; rz = (dl.s < 0 ? .1 : (dl.s - 1) * -.35) * k; }
  else if (dl.p === 'sweep' && ta > 0 && ta < .9) { const k = Math.sin(ta / .9 * PI); lx += .8 * k; rx += .8 * k; lz = -.5 * k; rz = .5 * k; }
  else if (dl.p === 'reveal' && ta < .7) rx += Math.sin(ta / .7 * PI);
  CAS.arms[0].rotation.set(lx, 0, lz); CAS.arms[1].rotation.set(rx, 0, rz); CAS.dealer.rotation.y = Math.sin(ct * .5) * .05;
}
// ---- seated: the camera ray on the felt plane picks the bet (no Raycaster); the prompt and a faint highlight follow it
function casSeatUI() {
  const b = CAS.b, c = P.cas, v = CAS_CHIPS[P.casChip ?? 1], R = CAS.rl, J = CAS.bj, hl = CAS.hl; cam.getWorldDirection(_fw);
  const ox = cam.position.x - b.x, oz = cam.position.z - b.z, oy = cam.position.y - b.fy - CAS_RL.y; let hit = false, lx = 0, lz = 0, html = '', hx = 0, hz = 0, sx = 0, sz = 0;
  if (_fw.y < -.05) { const k = -oy / _fw.y, wx = ox + _fw.x * k, wz = oz + _fw.z * k; lx = wx * CAS.cs - wz * CAS.sn; lz = wx * CAS.sn + wz * CAS.cs; hit = k < 3.5; }
  if (c.t === 'rl') { const o = hit ? CAS_RL.cell(lx - CAS_RL.fx, lz - CAS_RL.cz, CAS.hc) : null; CAS.aim = o ? o[0] : null;
    if (R.ph === 'spin') html = '<span class="info">No more bets</span>'; else if (R.ph === 'pay' && R.res >= 0) html = `<span class="info">${R.res} ${R.res === 0 ? 'green' : RED.has(R.res) ? 'red' : 'black'}</span>`;
    else if (o) { html = `${CAS_RL.name(o[0])} · ${CAS_RL.odds(o[0])} · ${money(v)}`; hx = CAS_RL.fx + (o[1] + o[2]) / 2; hz = CAS_RL.cz + (o[3] + o[4]) / 2; sx = o[2] - o[1]; sz = o[4] - o[3]; } }
  else { const a = CAS_BJ.A[c.s], q = J.seats[c.s], cx = CAS_BJ.cx + Math.sin(a) * .78, cz = CAS_BJ.cz - Math.cos(a) * .78, near = hit && Math.hypot(lx - cx, lz - cz) < .3; CAS.aim = near ? 'bj' : null;
    if (J.ph === 'turn' && J.turn === c.s) html = `<kbd>LMB</kbd> hit · <kbd>RMB</kbd> stand${q[2].length === 2 && G.cash >= q[1] ? ' · <kbd>D</kbd> double' : ''} · <b>${CAS_BJ.val(q[2])}</b>`;
    else if (J.ph === 'bet' || J.ph === 'idle') { if (near) { html = `Bet · ${money(v)}`; hx = cx; hz = cz; sx = sz = .3; } else if (!q[1]) html = '<span class="info">Look at your circle to bet</span>'; }
    else if (J.ph === 'turn') { const o = PL.get(CAS.seats.bj[J.turn]); html = `<span class="info">${o ? String(o.name).replace(/[<>&]/g, '') + "'s turn" : 'Waiting'}</span>`; }
    else if (q[2].length) html = `<span class="info">${CAS_BJ.val(q[2])} · dealer ${CAS_BJ.val(J.dl)}</span>`; }
  hl.visible = sx > 0; if (sx > 0) { hl.position.set(hx, CAS_RL.y + .003, hz); hl.scale.set(sx, 1, sz); hl.material.opacity = .22 + .08 * Math.sin(CAS.ct * 6); }
  const pr = $('prompt'), op = html ? 1 : 0; if (html !== G.pTxtK) { G.pTxtK = html; $('pTxt').innerHTML = html; } if (op !== G.prOp) { G.prOp = op; pr.style.opacity = op; } if (G.pBarD !== 'none') { G.pBarD = 'none'; $('pBar').style.display = 'none'; } P.h = '';
}
function casSlotAim() { const b = CAS.b; if (Math.abs(P.x - b.x) > 9 || Math.abs(P.z - b.z) > 9) return; cam.getWorldDirection(_fw);
  for (let m = 0; m < 3; m++) { const [x, z] = casW(4.3, CAS_SL.z[m]), dx = x - P.x, dz = z - P.z, dy = b.fy + 1.2 - cam.position.y, dd = Math.hypot(dx, dy, dz); if (dd > 1.8) continue; if ((dx * _fw.x + dy * _fw.y + dz * _fw.z) / dd < .8) continue; CAS.aimSl = m;
    if (!CAS.slHelp) { CAS.slHelp = 1; let f = ''; try { f = localStorage.getItem(SK('s9-cas-help')) || ''; } catch (e) {} if (!f.includes('sl')) { CAS.help = {t: 'sl', u: CAS.ct + 8}; try { localStorage.setItem(SK('s9-cas-help'), f + 'sl '); } catch (e) {} } } return; } }
const CAS_HELP = {rl: 'Click the felt to bet · right click takes a chip back · wheel or 1-5 picks the chip · E stands up', bj: 'Click your circle to bet · on your turn click hits, right click stands, D doubles · E stands up', sl: 'E pulls the lever · the mouse wheel changes the bet'};
function casHud() { const el = CAS.hud; if (!el) return; const on = !!(P && G.on && alivePlay() && (P.cas || CAS.aimSl >= 0));
  if (!on) { if (CAS.hudOn) { CAS.hudOn = 0; el.classList.remove('on'); } return; }
  const me = myId(), k = CAS.hk; let v = CAS_CHIPS[P.casChip ?? 1], tab = 0, T = -1;
  if (P.cas && P.cas.t === 'rl') { for (const q of CAS.rl.bets) if (q[0] === me) tab += q[2]; if (CAS.rl.ph === 'bet') T = Math.max(0, Math.ceil(CAS.rl.T)); }
  else if (P.cas) { const J = CAS.bj, q = J.seats[P.cas.s]; tab = q ? q[1] : 0; if ((J.ph === 'bet' && J.T > 0) || (J.ph === 'turn' && J.turn === P.cas.s)) T = Math.max(0, Math.ceil(J.T)); }
  else v = Math.min(v, CAS_SL.max);
  const help = CAS.help && CAS.ct < CAS.help.u ? CAS.help.t : '';
  if (k[0] !== v || k[1] !== G.cash || k[2] !== tab || k[3] !== T || k[4] !== help) { k[0] = v; k[1] = G.cash; k[2] = tab; k[3] = T; k[4] = help;
    el.innerHTML = `Chip <b>${money(v)}</b> · Cash <b>${money(G.cash)}</b>${tab ? ` · On the table <b>${money(tab)}</b>` : ''}${T >= 0 ? ` · ${T} s` : ''}${help ? `<small>${CAS_HELP[help]}</small>` : ''}`; }
  if (!CAS.hudOn) { CAS.hudOn = 1; el.classList.add('on'); } }
// ---- room sound: murmur and a music box inside, the wheel's rumble while it turns
const CAS_MB = [523, 0, 659, 784, 0, 659, 587, 0, 523, 0, 440, 523, 0, 587, 659, 0, 784, 0, 880, 784, 0, 659, 587, 0, 523, 587, 659, 0, 587, 0, 523, 0];
function casAudio(dt, d) { if (!A.on || !CAS.b || d > 30) return; const cp = cam.position, inn = casInside(cp.x, cp.z, cp.y), k = inn ? 1 : clamp(1 - (d - 5) / 10, 0, 1) * .3;
  if (k > .01) { Snd.casRoom(k); if ((CAS.mbT -= dt) <= 0) { CAS.mbT = .34; const i = CAS.mbI++ % 32, n = CAS_MB[i]; if (n) tone(n * 2, .011 * k, 1.4, 'sine'); if (i % 8 === 0) tone(n || 523, .006 * k, 2.2, 'triangle'); } }
  const t = G.t - CAS.rl.t0; if (t >= 0 && t < 10 && d < 18) Snd.casWheel(Math.exp(-.18 * t) * (inn ? 1 : .35)); }
Snd.casChip = (h = 0, p) => { const k = 1 + Math.min(12, h) * .04; burst(3500 * k, 7, .14, .006, 'bandpass', p); setTimeout(() => burst(5000 * k, 7, .1, .006, 'bandpass', p), 9); tone(1100 * k, .035, .06, 'sine', p); };
Snd.casCard = p => { burst(4500, .7, .09, .015, 'highpass', p); tone(300, .06, .05, 'sine', p, 180); };
Snd.casTick = p => burst(6000, 9, .06, .002, 'bandpass', p);
Snd.casDrop = p => { burst(1800, .8, .05, .5, 'bandpass', p); for (let i = 0; i < 5; i++) setTimeout(() => Snd.casTick(p), 2260 + i * (50 + i * 22)); };
Snd.casReel = p => tone(700, .02, .004, 'square', p);
Snd.casStop = p => { tone(140, .12, .14, 'sine', p, 70); burst(400, 1, .08, .05, 'lowpass', p); };
Snd.casLever = p => { for (let i = 0; i < 6; i++) setTimeout(() => burst(2200 - i * 120, 6, .06, .008, 'bandpass', p), i * 28); setTimeout(() => { tone(190, .07, .45, 'triangle', p, 320); tone(380, .025, .3, 'sine', p, 250); }, 220); };
Snd.casWin = p => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .05, .35, 'triangle', p), i * 85)); };
Snd.casJack = p => { for (let i = 0; i < 14; i++) setTimeout(() => { tone([1046, 1318, 1568, 2093][i % 4], .05, .6, 'sine', p); if (i % 2) burst(7000, 4, .04, .1, 'bandpass', p); }, i * 110); };
Snd.casOoh = () => { for (const [f, d] of [[196, 0], [247, 60], [294, 120], [220, 170]]) setTimeout(() => tone(f, .03, 1.2, 'triangle', null, f * 1.3), d); burst(520, 1.2, .07, 1.1, 'bandpass', null, .8); };
const casLoop = (key, mk) => { let L = A[key]; if (!L) { L = A[key] = mk(A.ctx); L.g.gain.value = 0; L.g.connect(A.out); (A.mute = A.mute || []).push(L.g); } return L; };
const casSet = (prm, v, t) => { prm.cancelScheduledValues(t); prm.setTargetAtTime(v, t, .2); prm.setTargetAtTime(0, t + .6, .25); };
Snd.casWheel = v => { if (!A.on || !A.ctx) return; const W = casLoop('casW', c => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 45; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; const g = c.createGain(); o.connect(f); f.connect(g); o.start(); return {g, o}; });
  const t = A.ctx.currentTime; casSet(W.g.gain, .13 * v, t); W.o.frequency.setTargetAtTime(30 + 25 * v, t, .2); };
Snd.casRoom = k => { if (!A.on || !A.ctx) return; const M = casLoop('casM', c => { const s = c.createBufferSource(); s.buffer = A.noise; s.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = .8; const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 900; const g = c.createGain(); s.connect(f); f.connect(f2); f2.connect(g); s.start(); return {g}; });
  const t = A.ctx.currentTime; casSet(M.g.gain, .05 * k * (.75 + .25 * Math.sin(t * 1.3) * Math.sin(t * .7)), t); };
// ---- input while seated: our own capture listeners (the main handlers never see these keys)
addEventListener('keydown', e => { if (!G.on || G.paused || !P || !P.cas || anyPanel() || (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return; const c = e.code;
  if (c === 'KeyE' || c === 'KeyS') { if (!e.repeat) act({a: 'csit', g: null}); }
  else if (/^Digit[1-5]$/.test(c)) { P.casChip = +c[5] - 1; Snd.casChip(0); }
  else if (c === 'KeyD') { if (!e.repeat) casDouble(); }
  else if (!/^(KeyG|KeyX|KeyC|KeyR|KeyQ|KeyF|KeyH|Digit[67]|Numpad\d)$/.test(c)) return;
  e.preventDefault(); e.stopImmediatePropagation(); }, {capture: true});
addEventListener('mousedown', e => { if (e.button !== 2 || !G.on || G.paused || !P || !P.cas || anyPanel() || (!TEST && document.pointerLockElement !== canvas)) return; casClick(2); }, {capture: true});
function casClick(btn) { const c = P.cas, v = CAS_CHIPS[P.casChip ?? 1], J = CAS.bj; if (!c) return;
  if (c.t === 'rl') { if (btn === 2) act({a: 'cbx', g: 'rl'}); else if (CAS.aim != null) act({a: 'cb', g: 'rl', c: CAS.aim, v}); }
  else if (J.ph === 'turn' && J.turn === c.s) act({a: 'cbj', x: btn === 2 ? 'stand' : 'hit'}); else if (btn === 2) act({a: 'cbx', g: 'bj'}); else if (CAS.aim === 'bj') act({a: 'cb', g: 'bj', v}); }
function casDouble() { const c = P.cas, J = CAS.bj; if (c && c.t === 'bj' && J.ph === 'turn' && J.turn === c.s) act({a: 'cbj', x: 'dbl'}); }
// ---- interaction targets: free stools and the slot machines
function casTargets(L) { const b = CAS.b; if (Math.abs(P.x - b.x) > 12 || Math.abs(P.z - b.z) > 12) return;
  for (const t of ['rl', 'bj']) CAS.seatW[t].forEach((q, s) => { if (!CAS.seats[t][s]) L.push({x: q.x, y: b.fy + .95, z: q.z, r: 2.2, label: t === 'rl' ? 'Sit at roulette' : 'Sit at blackjack', go: () => act({a: 'csit', g: t, s})}); });
  CAS_SL.z.forEach((z, m) => { const [x, wz] = casW(4.3, z), busy = CAS.slPay[m] || G.t - CAS.sl[m][4] < 2.6, v = Math.min(CAS_SL.max, CAS_CHIPS[P.casChip ?? 1]);
    L.push({x, y: b.fy + 1.2, z: wz, r: 1.8, info: busy ? 1 : 0, label: busy ? 'Spinning' : `Pull · ${money(v)}`, go: () => act({a: 'csl', m, v})}); }); }
// ---- old credits become crew cash once (the host only; guests just drop the key)
function casCredits() { try { const k = SK('s9-cred'), raw = localStorage.getItem(k); localStorage.removeItem(k); const v = Math.floor(+raw); if (raw != null && isHost() && v > 0 && isFinite(v)) { G.cash += v; save(); setTimeout(() => G.on && showMsg(`Your old casino credits were cashed in: +${money(v)}`, 'LUCKY LANTERN', 6), TEST ? 0 : 6200); } } catch (e) {} }
// ---- wrappers
{ const f0 = buildWorld; buildWorld = function () { const was = BUILT, r = f0.apply(this, arguments); if (!was && CAS.b && !CAS.g) { casMeshes(); if (Array.isArray(G.homeLamps)) G.homeLamps.push(...CAS.lamps); } return r; }; }
{ const f0 = stepPlayer; stepPlayer = function (dt) { if (P && P.cas && CAS.b && alivePlay()) { if (!P.down) { casPin(dt); return; } casStandLocal(); act({a: 'csit', g: null}); } return f0.apply(this, arguments); }; }
{ const f0 = stepInteract; stepInteract = function (dt) { CAS.aimSl = -1; if (P && P.cas && CAS.b && alivePlay() && !anyPanel()) { casSeatUI(); casHud(); return; } if (CAS.hl && CAS.hl.visible) CAS.hl.visible = false;
  const r = f0.apply(this, arguments); if (P && CAS.b && alivePlay() && !P.sw && !anyPanel()) casSlotAim(); casHud(); return r; }; }
{ const f0 = toolDown; toolDown = function () { if (P && P.cas) { casClick(0); return; } return f0.apply(this, arguments); }; }
{ const f0 = toolUp; toolUp = function () { if (P && P.cas) return; return f0.apply(this, arguments); }; }
{ const f0 = cycleSlot; cycleSlot = function (d) { if (P && (P.cas || CAS.aimSl >= 0)) { P.casChip = clamp((P.casChip ?? 1) + Math.sign(d), 0, P.cas ? 4 : 3); Snd.casChip(0); return; } return f0.apply(this, arguments); }; }
{ const f0 = hostStep; hostStep = function (dt) { const r = f0.apply(this, arguments); if (G.on && CAS.b) casHost(dt); return r; }; }
{ const f0 = hostAct; hostAct = function (id, m) { const r = f0.apply(this, arguments); if (m && (m.a === 'csit' || m.a === 'cb' || m.a === 'cbx' || m.a === 'cbj' || m.a === 'csl')) casAct(id, m); return r; }; }
{ const f0 = applyEv; applyEv = function (e) { if (e && CAS_EV.has(e.k)) { casEv(e); return; } if (e && e.k === 'nope' && e.cas) { if (e.id === myId()) { showMsg(e.why, 'LUCKY LANTERN', 2.5); tone(180, .05, .25, 'triangle', null, 120); } return; } return f0.apply(this, arguments); }; }
{ const f0 = packSnap; packSnap = function () { const s = f0.apply(this, arguments); if ((CAS.v !== CAS.sv && G.t - CAS.sT >= .25) || G.t - CAS.sT >= 3) { CAS.sv = CAS.v; CAS.sT = G.t; s.cs = casPack(); } return s; }; }
{ const f0 = applySnap; applySnap = function (s) { const r = f0.apply(this, arguments); if (s && s.cs) casUnpack(s.cs); return r; }; }
{ const f0 = startGame; startGame = function () { casReset(); const r = f0.apply(this, arguments); casCredits(); return r; }; }
{ const f0 = targets; targets = function () { const L = f0.apply(this, arguments); if (CAS.b && P && !P.cas) casTargets(L); return L; }; }
// the wheelhouse radio: a soft chord loop with an arpeggio, heard near the boat
const RADIO = {t: 0, i: 0}, PROG = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
function stepRadio(dt) {
  if (!G.radioOn || !A.on || !BOAT) return; const d = Math.hypot(cam.position.x - B.x, cam.position.z - B.z); if (d > 60) return;
  RADIO.t -= dt; if (RADIO.t > 0) return; RADIO.t = .3; const i = RADIO.i++, ch = PROG[Math.floor(i / 8) % 4], rp = BOAT.userData.radioP, [lx, lz] = rp ? bL2W(rp[0], rp[2]) : bL2W(-.43, BHELM[1] - .6), p = at(lx, (rp ? rp[1] : BDECK.y + 1.2) + B.heave, lz, 2), v = clamp(1 - d / 60, 0, 1);
  if (i % 8 === 0) { tone(ch[0] / 2, .06 * v, 2.2, 'sine', p); for (const f of ch) tone(f, .018 * v, 2.4, 'triangle', p); }
  const pat = [0, 1, 2, 1, 0, 2, 1, 2][i % 8]; tone(ch[pat] * 2, .03 * v, .45, 'triangle', p); if (i % 4 === 2) burst(6000, 3, .015 * v, .04, 'highpass', p);
}
// ---------------- the Lucky Lantern (continued): HUD pill, and the old GUI entry points other code still calls
function casInit() { if ($('st-cas')) return; const st = document.createElement('style'); st.id = 'st-cas';
  st.textContent = '#casHud{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);padding:5px 14px;border-radius:14px;background:rgba(22,12,6,.72);border:1px solid rgba(255,196,110,.32);color:#f2dcae;font:13px ui-monospace,monospace;letter-spacing:.03em;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .25s;text-shadow:0 1px 2px #000}#casHud.on{opacity:1}#casHud b{color:#ffd27a;font-weight:normal}#casHud small{display:block;text-align:center;color:#cdb48a;font-size:11px;margin-top:3px;white-space:normal;max-width:520px}';
  document.head.appendChild(st); const h = CAS.hud = document.createElement('div'); h.id = 'casHud'; ($('hud') || document.body).appendChild(h); }
function openCasino() { showMsg('Cards and roulette are at the Lucky Lantern, by the lighthouse.', '', 3); }
function closeCasino() {}
// cetaceans: lathe body (dark back, pale belly), curved dorsal fin, pectorals, flukes on a tail that beats
function mkCetacean(len, top, belly, o = {}) {
  const g = new THREE.Group(), K = len / 2.4, wide = o.wide || 1;
  const prof = (pts) => pts.map(([r, y]) => new THREE.Vector2(r * K * wide, y * K));
  const tc = new THREE.Color(top), bc = new THREE.Color(belly);
  const paint = geo => { geo.rotateX(-PI / 2); geo.computeVertexNormals(); const n = geo.attributes.normal, c = new Float32Array(n.count * 3); for (let i = 0; i < n.count; i++) { const k = smooth(clamp((n.getY(i) + .35) / .8, 0, 1)); c[i * 3] = mix(bc.r, tc.r, k); c[i * 3 + 1] = mix(bc.g, tc.g, k); c[i * 3 + 2] = mix(bc.b, tc.b, k); } geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; };
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .5, metalness: 0, envMapIntensity: .3});
  const front = o.blunt ? [[.2, 0], [.3, .3], [.34, .6], [.33, .9], [.29, 1.15], [.2, 1.3], [.08, 1.4], [0, 1.42]] : [[.2, 0], [.3, .3], [.34, .6], [.31, .9], [.24, 1.15], [.13, 1.3], [.085, 1.36], [.05, 1.46], [.03, 1.5], [0, 1.52]];
  const fg = paint(new THREE.LatheGeometry(prof(front), 18)); fg.translate(0, 0, -.9 * K); const fm = new THREE.Mesh(fg, mat); fm.scale.y = o.flat || .86; fm.castShadow = true; g.add(fm);
  const tail = new THREE.Group(); tail.position.z = -.9 * K + .02; g.add(tail);
  const tgeo = paint(new THREE.LatheGeometry(prof([[0, 0], [.035, .03], [.07, .25], [.12, .55], [.17, .8], [.2, .92]]), 14)); tgeo.translate(0, 0, .92 * K); const tm = new THREE.Mesh(tgeo, mat); tm.scale.y = o.flat || .86; tail.add(tm);
  const dark = new THREE.MeshStandardMaterial({color: top, roughness: .3});
  const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.quadraticCurveTo(.18, .05, .34, -.16); fl.quadraticCurveTo(.2, -.08, .05, -.1); fl.lineTo(-.05, -.1); fl.quadraticCurveTo(-.2, -.08, -.34, -.16); fl.quadraticCurveTo(-.18, .05, 0, 0);
  const flg = new THREE.ExtrudeGeometry(fl, {depth: .02, bevelEnabled: false}); flg.scale(K * (o.fluke || 1), K * (o.fluke || 1), K); flg.rotateX(PI / 2); const flk = new THREE.Mesh(flg, dark); flk.position.z = .92 * K + .02; tail.add(flk);
  if (!o.noDorsal) { const ds = new THREE.Shape(); ds.moveTo(-.14, 0); ds.quadraticCurveTo(-.04, .1, .12, .26); ds.quadraticCurveTo(.06, .1, .18, 0); ds.lineTo(-.14, 0); const dg = new THREE.ExtrudeGeometry(ds, {depth: .025, bevelEnabled: false}); dg.translate(0, 0, -.0125); dg.rotateY(PI / 2); dg.scale(K, K * (o.dorsal || 1), K); const d = new THREE.Mesh(dg, dark); d.position.set(0, .28 * K * (o.flat || .86) * wide, -.15 * K); g.add(d); }
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.SphereGeometry(.12 * K, 8, 6), dark); p.scale.set(1.4, .18, .55); p.position.set(s * .27 * K * wide, -.12 * K, -.55 * K); p.rotation.set(0, s * .5, s * .5); g.add(p);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.018 * K, 6, 4), new THREE.MeshStandardMaterial({color: 0x050505, roughness: .1})); e.position.set(s * .2 * K * wide, .03 * K, -1.12 * K); g.add(e); }
  g.userData.tail = tail; g.visible = false; scene.add(g); return g;
}
function beamMat(col, k) { return new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: {c: {value: new THREE.Color(col)}, k: {value: k}},
  vertexShader: 'varying vec2 vU; varying vec3 vN, vV; void main(){ vU = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform vec3 c; uniform float k; varying vec2 vU; varying vec3 vN, vV; void main(){ float d = max(length(vV), 1e-4); vec3 n = vN / max(length(vN), 1e-4); float e = abs(dot(n, vV / d)), y = clamp(vU.y, 1e-4, 1.); float a = k * e * e * e * exp2(2.2 * log2(y)) * (1. - exp(-d * .25)) * exp(-d * .003); a = min(max(a, 0.), 4.); if (isnan(a)) a = 0.; gl_FragColor = vec4(c * a, 1.); }'}); }
const FX = {dol: null, whale: null};
function buildFauna() {
  FX.dol = [0, 1, 2].map(() => mkCetacean(2.4, 0x3c4854, 0xc8ccd0));
  FX.whale = mkCetacean(14, 0x1c2228, 0x5a6066, {blunt: 1, wide: 1.25, fluke: 1.5, dorsal: .35});
  FX.spout = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xb0c8e0, transparent: true, depthWrite: false, opacity: 0})); FX.spout.scale.set(4, 10, 1); scene.add(FX.spout);
  buildLev(); buildWake();
}
function stepFauna(dt) {
  const calm = G.storm < .4;
  FX.dolT = (FX.dolT ?? 25) - dt;
  if (FX.dolT <= 0 && calm && Math.abs(B.v) > 4 && P && P.ob) { FX.dolT = 50 + Math.random() * 60; FX.dolA = {t: 0, s: Math.random() < .5 ? -1 : 1}; }
  if (FX.dolA) { const a = FX.dolA; a.t += dt; FX.dol.forEach((d, i) => { const ph = a.t * 2.4 + i * 1.3, j = Math.sin(ph); const [x, z] = bL2W(a.s * (4.5 + i * 1.6), -3 - i * 2.5 + Math.sin(a.t + i) * 2); d.visible = a.t < 12; d.position.set(x, Math.max(-1.2, j * 1.4 - .3), z); d.rotation.set(-Math.cos(ph) * .8, B.yaw, Math.sin(a.t * 1.3 + i) * .15, 'YXZ'); d.userData.tail.rotation.x = Math.sin(a.t * 9 + i) * .3; if (j > .9 && Math.random() < .1) Snd.splash(at(x, 0, z, 4)); }); if (a.t > 12) FX.dolA = null; }
  FX.whT = (FX.whT ?? 40) - dt;
  if (FX.whT <= 0 && calm) { FX.whT = 70 + Math.random() * 80; const a = Math.random() * TAU, r = 70 + Math.random() * 60, cp = cam.position, x = cp.x + Math.sin(a) * r, z = cp.z + Math.cos(a) * r; if (landH(x, z) < -4 && !nearRig(x, z)) { FX.whA = {t: 0, x, z, a: Math.random() * TAU}; Snd.whale(at(x, 0, z, 40)); } }
  if (FX.whA) { const w = FX.whA; w.t += dt; const u = w.t / 7; FX.whale.visible = u < 1; FX.whale.position.set(w.x + Math.sin(w.a) * (u - .5) * 30, -6 + Math.sin(u * PI) * 6.5, w.z + Math.cos(w.a) * (u - .5) * 30); FX.whale.rotation.set(-Math.cos(u * PI) * .5, w.a + PI, 0, 'YXZ'); FX.whale.userData.tail.rotation.x = Math.sin(w.t * 1.6) * .25; FX.spout.position.set(FX.whale.position.x, 4, FX.whale.position.z); FX.spout.material.opacity = u > .3 && u < .55 ? .5 : 0; if (u > .62 && !w.splash) { w.splash = 1; Snd.splash(at(w.x, 0, w.z, 30)); } if (u >= 1) FX.whA = null; }
  stepLev(dt); stepWake(dt);
}
function updateWorldFx(dt) {
  G.wt = performance.now() / 1000; G.sea = mix(.5, 1.25, G.storm);
  if (MAT.sea.userData.sh) { const u = MAT.sea.userData.sh.uniforms; u.uT.value = G.wt; u.uA.value = G.sea; u.uFoam.value = .25 + .75 * G.storm; u.uBt.value.set(B.x, B.z, Math.cos(B.yaw), Math.sin(B.yaw)); u.uBd.value.set(BG.hw, BG.zb, BG.zs, B.sink > 0 || (B.dep || 0) > .4 ? 0 : 1); }
  { const U = MAT.sea.userData.U; U.uSpd.value = clamp(Math.abs(B.v) / 8, 0, 1); // the 8 islands nearest the camera, for the shallows and shore foam
    if (FOAM && (FOAM.userData.isT = (FOAM.userData.isT || 0) - dt) <= 0) { FOAM.userData.isT = .5; const cp = cam.position, SL = FOAM.userData.isles, o = SL.map((I, i) => [Math.hypot(I.x - cp.x, I.z - cp.z) - I.r, i]).sort((a, b) => a[0] - b[0]);
      U.uIs.value.forEach((v, k) => { const e = o[k]; if (e) v.set(SL[e[1]].x, SL[e[1]].z, e[1], 1); else v.set(0, 0, 0, 0); }); } }
  TX.ripple.offset.set(G.wt * .01, G.wt * .013);
  const st = G.storm; if (Net.role !== 'host' && Net.role !== 'solo' && G.on) G.tod = ((G.tod || 0) + dt / TOD_LEN) % 1;
  todAt(G.tod || 0, st); scene.fog.density = TOD.fd; scene.fog.color.copy(TOD.fog); scene.background.copy(TOD.fog);
  G.lightT -= dt; const sky = scene.userData.sky.material.uniforms; sky.uS.value = st; sky.uT.value = G.wt;
  sky.zen.value.copy(TOD.zen); sky.hor.value.copy(TOD.hor); sky.fogC.value.copy(TOD.fog); sky.sunC.value.copy(TOD.sun); sky.sunI.value = TOD.sI; sky.stars.value = TOD.st; sky.aur.value = TOD.night * (1 - st) * .9;
  const cw = waveH(cam.position.x, cam.position.z, G.wt); G.uw = mix(G.uw || 0, G.subIn ? ((B.dep || 0) > 1 ? 1 : 0) : cam.position.y < cw - .08 ? 1 : 0, Math.min(1, dt * 12)); G.uwC = G.subIn ? mix(G.uwC || 0, lockWet() ? 1 : 0, Math.min(1, dt * 12)) : G.uw; // look vs camera-in-water (the sub's hull keeps you dry)
  { const und = G.uw > .5, U = MAT.sea.userData.U; sky.uw.value = und ? 1 : 0; U.uUs.value.w = und ? 1 : 0;
    if (und) { // underwater: clearer for the first 30 m so wreck silhouettes read, then the deep closes in; the sky becomes a lit-from-above gradient
      const dl = .25 + .75 * TOD.day, dp = cw - cam.position.y, dpt = clamp(dp / 80, 0, 1); scene.fog.color.setRGB(.012 * dl, .07 * dl, .08 * dl).multiplyScalar(1 - dpt * .92); scene.background.copy(scene.fog.color);
      scene.fog.density = mix(.035, mix(.06, .045, dpt), smooth((dp - 30) / 12)); const fc = scene.fog.color; sky.deepC.value.copy(fc).multiplyScalar(.68); sky.surfC.value.copy(fc).multiplyScalar(2.2); sky.uwk.value = TOD.day * (1 - dpt) * (1 - st * .6);
      const k = (.08 + .92 * TOD.day) * (1 - st * .5) * (1 - dpt * .7); U.uUs.value.set(.3 * k + fc.r, .5 * k + fc.g, .5 * k + fc.b, 1); U.uUd.value.copy(fc).multiplyScalar(.7); } }
  if (SNOW) { SNOW.visible = G.uw > .5; if (SNOW.visible) { const u = SNOW.material.uniforms; u.uT.value = G.wt; u.uC.value.copy(cam.position); u.uCol.value.copy(scene.fog.color).multiplyScalar(3).addScalar(.05 * (.3 + .7 * TOD.day)); } }
  const sbv = G.uw > .3 || (B.dep || 0) > .5; if (SEABED && SEABED.material.userData.sh) { const u = SEABED.material.userData.sh.uniforms; u.uT.value = G.wt; u.uC.value = TOD.day * (1 - G.storm * .7); } if (SEABED) { SEABED.visible = sbv; if (sbv && Math.hypot(cam.position.x - SEABED.userData.cx, cam.position.z - SEABED.userData.cz) > 40) seabedAt(cam.position.x, cam.position.z); }
  for (const q of SUNK) q.m.visible = sbv && !q.got; if (DEEPG) { DEEPG.visible = sbv; if (sbv && DEEPG.userData.kT) DEEPG.userData.kT.value = G.wt; }
  if (CRZ.reds && !CRZ.redS) { CRZ.redS = CRZ.reds.map(([x, y, z]) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.scale.setScalar(1.6); s.position.set(x, y, z); scene.add(s); return s; }); }
  if (CRZ.redS) CRZ.redS.forEach((s, i) => s.material.opacity = Math.sin(G.wt * 1.7 + i * 2.3) > -.2 || Math.random() < .03 ? .7 : .05);
  envUpdate(dt); if (FOAM) FOAM.userData.mat.opacity = (.35 + .15 * Math.sin(G.wt * 1.3)) * (.4 + .6 * TOD.day) * (1 - st * .4);
  if (POST.on) { POST.ex = mix(1.15, .95, TOD.night) * SET.bright; }
  if (G.lightT <= 0) { G.lightT = 8 + Math.random() * 20; if (st > .6 && Net.role === 'solo') { G.bolt = .35; setTimeout(() => Snd.thunder(.6 + Math.random() * .4), 600 + Math.random() * 2500); } }
  G.bolt = Math.max(0, (G.bolt || 0) - dt); const fl = G.bolt > 0 ? (Math.random() < .6 ? 1 : .2) * G.bolt * 3 : 0;
  sky.uF.value = fl; hemi.color.copy(TOD.hs); hemi.groundColor.copy(TOD.hg); hemi.intensity = TOD.hI * 1.15 + fl * 3; moon.color.copy(TOD.sun); moon.intensity = TOD.kI + fl * 2;
  const sc = _v.set(Math.round(cam.position.x / 4) * 4, 0, Math.round(cam.position.z / 4) * 4); moon.position.copy(sc).addScaledVector(KEYDIR, 200); moon.target.position.copy(sc);
  if (G.aviS) G.aviS.material.opacity = Math.sin(G.wt * 3) > .4 ? 1 : .05;
  const ang = G.wt * .45; lhL.position.set(G.lh[0], G.lh[1], G.lh[2]); lhL.target.position.set(G.lh[0] + Math.sin(ang) * 100, G.lh[1] - 6, G.lh[2] + Math.cos(ang) * 100); lhL.intensity = 30;
  G.lhBeam.position.set(G.lh[0], G.lh[1], G.lh[2]); G.lhBeam.rotation.set(0, ang, 0);
  const cp = cam.position;
  // two pooled lamps: the boat's cabin lamp and stove while aboard (wins at the jetty too), else the two nearest harbour/rig lamps (no allocations)
  if (BOAT && BOAT.userData.lamp && P && P.ob && Math.hypot(cp.x - B.x, cp.z - B.z) < BG.L * .5 + 12) { const c = Math.cos(B.yaw), sn = Math.sin(B.yaw);
    for (let i = 0; i < 2; i++) { const l = POOL[i], q = i ? BOAT.userData.stove : BOAT.userData.lamp; if (!q) { l.intensity = 0; continue; } l.position.set(B.x + q[0] * c + q[2] * sn, q[1] + B.heave, B.z - q[0] * sn + q[2] * c); l.color.setHex(i ? 0xff7a30 : 0xffc890); l.distance = 12; l.intensity = i ? 5 + Math.random() * 2.5 : 7; } }
  else if ((G.power && nearRig(cp.x, cp.z)) || Math.hypot(cp.x - HOME.x, cp.z - HOME.z) < 60) { let a = null, b = null, da = 1e18, db = 1e18; const h = G.homeLamps, nh = h.length, n = nh + (G.power ? LAMPS.length : 0);
    for (let i = 0; i < n; i++) { const s = i < nh ? h[i] : LAMPS[i - nh], dx = s[0] - cp.x, dy = s[1] - cp.y, dz = s[2] - cp.z, d = dx * dx + dy * dy + dz * dz; if (d < da) { b = a; db = da; a = s; da = d; } else if (d < db) { b = s; db = d; } }
    for (let i = 0; i < 2; i++) { const l = POOL[i], s = i ? b : a; if (!s) { l.intensity = 0; continue; } l.position.set(s[0], s[1] - .3, s[2]); l.color.setHex(0xffe2b0); l.distance = 30; l.intensity = 22 * s[3] * (Math.random() < .015 ? .3 : 1); } }
  else { POOL[0].intensity = 0; POOL[1].intensity = 0; }
  if (G.shedGlow) G.shedGlow.material.opacity = .12 + .7 * (1 - TOD.day);
  extBuoyStep();
  if (G.ghostS) G.ghostS.forEach((s, i) => s.material.opacity = (.4 + Math.sin(G.wt * 1.3 + i) * .3) * (.3 + .7 * TOD.night));
  G.floats.forEach((f, i) => { const o = floatMesh(i); if (!o) return; o.m.position.set(f[0], waveH(f[0], f[1], G.wt) - .15, f[1]); o.m.rotation.set(Math.sin(G.wt + i) * .2, i, Math.cos(G.wt * .8 + i) * .2); });
  for (let i = 0; i < FLM.length; i++) if (FLM[i] && !G.floats[i]) { scene.remove(FLM[i].m); FLM[i] = null; }
  stepFauna(dt);
}
function updateRemotes(dt) {
  let si = 0; const cp = cam.position;
  const L = [...PL.values()].filter(p => p !== P && p.ready); L.sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z));
  for (const p of PL.values()) {
    if (p === P) { if (p.av) p.av.visible = false; if (p.tag) p.tag.style.display = 'none'; continue; }
    if (!p.ready) continue;
    let tx = p.x, tz = p.z, ty = p.sw ? waveH(p.x, p.z, G.wt) - (p.dv || 0) : p.y; if (p.ob && p.bl) { if (BG.sub && BOAT) { _sb.set(p.bl[0], p.y, p.bl[1]).applyMatrix4(BOAT.matrixWorld); tx = _sb.x; ty = _sb.y; tz = _sb.z; } else { [tx, tz] = bL2W(p.bl[0], p.bl[1]); ty = BDECK.y + B.heave; } }
    const k = Math.min(1, dt * 12), ox = p.rx, oz = p.rz; p.rx = p.ob ? tx : mix(p.rx, tx, k); p.ry = mix(p.ry, ty, k); p.rz = p.ob ? tz : mix(p.rz, tz, k); p.ryaw += angD(p.ryaw, p.yaw) * k; p.rpitch = mix(p.rpitch, p.pitch, k);
    p.rspd = mix(p.rspd, Math.hypot(p.rx - ox, p.rz - oz) / Math.max(dt, 1e-3) - (p.ob ? Math.abs(B.v) : 0), Math.min(1, dt * 6));
    animCrew(p, dt);
    if ((p.stepD || 0) > (p.run ? 1 : .75)) { p.stepD = 0; if ((!p.ob || BG.sub) && Math.hypot(p.x - cp.x, p.z - cp.z) < 30 && !p.down) Snd.rStep(p.x, p.ob ? p.ry : p.y, p.z, p.run ? 1.4 : .8); }
    p.pingT = Math.max(0, (p.pingT || 0) - dt);
    const t = p.tag, d = Math.hypot(p.rx - cp.x, p.rz - cp.z); let show = !p.dead && (d < 40 || p.down || p.pingT > 0 || p.sw);
    if (show) { _v.set(p.rx, p.ry + (p.down ? .8 : 2.15), p.rz).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) show = false; }
    t.style.display = show ? 'block' : 'none';
    if (show) { t.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; t.className = 'tag' + (p.down || p.sw ? ' down' : p.pingT > 0 ? ' ping' : ''); t.textContent = p.down ? `${p.name} DOWN ${Math.max(0, p.bleed | 0)}s · ${d | 0}m` : p.sw ? `${p.name} IN THE WATER · ${d | 0}m` : p.pingT > 0 ? `${p.name} · ${d | 0}m` : p.name; t.style.opacity = p.down || p.pingT > 0 || p.sw ? 1 : clamp(1.4 - d / 40, .2, .9); }
  }
  for (const p of L) { if (si >= RSPOT.length) break; if (!p.l || p.down || p.dead || p.hd >= 0 || p.sw) continue; const l = RSPOT[si++], f = eyeDir({yaw: p.ryaw, pitch: p.rpitch}); l.position.set(p.rx + f[0] * .4, p.ry + 1.35, p.rz + f[2] * .4); l.target.position.set(l.position.x + f[0] * 10, l.position.y + f[1] * 10, l.position.z + f[2] * 10); l.intensity = 55; }
  for (; si < RSPOT.length; si++) RSPOT[si].intensity = 0;
  for (const it of ITEMS) it.mesh.visible = !it.taken;
}
let heartT = 0;
function stepFear(dt) {
  const cp = cam.position, d = Math.hypot(cp.x - M.x, cp.z - M.z) + Math.abs(cp.y - M.y - 1.5), me = alivePlay() ? P : null, s = me ? pSeesMon(me) : 0;
  // dread: the worst of the rig thing, the Steward and the gulpers, then the deep (only near the boat) and the dark below on top
  const near = !!P && (P.ob || Math.hypot(cp.x - B.x, cp.z - B.z) < BG.L * .5 + 30), sp = !!(G.spines && G.spines.circle && near);
  const fM = clamp(1 - d / 30, 0, 1) * .6 + (M.state === 'chase' ? (M.tgt === myId() ? .5 : .25) : 0) + s * clamp(1 - d / 45, 0, 1) * .4;
  const sd = Math.hypot(cp.x - STS.x, cp.y - STS.y, cp.z - STS.z), sOn = STS.state !== 'dead' && STS.state !== 'gone', sCh = sOn && STS.state === 'chase' && sd < 50, fS = sOn && inCruise(cp.x, cp.z, cp.y) ? clamp(1 - sd / 28, 0, 1) * .6 + (sCh ? (sd < 14 ? .55 : .3) : 0) : 0;
  let gd = 1e9, gs = 0, gCh = false; for (const g of GUL) { if (!g || !g.on) continue; const q = Math.hypot(g.x - cp.x, g.y - cp.y, g.z - cp.z); if ((g.st === 2 || g.st === 4) && q < 30) gCh = true; if (q < gd) { gd = q; gs = g.st; } }
  const fG = P.sw && gd < 45 && gs !== 3 ? clamp(1 - gd / 45, 0, 1) * .5 + (gs === 2 || gs === 4 ? .4 : gs === 1 ? .15 : 0) : 0;
  let f = Math.max(fM, fS, fG) + (me && me.sw && me.deep && !(me.own && me.own.suit) ? .45 : 0) + (me && me.sw ? .15 * clamp((me.dv || 0) / 120, 0, 1) : 0) + (sp ? .5 : 0);
  if (inCabin() && !sp) f *= .35;
  P.fear = mix(P.fear || 0, clamp(f, 0, 1), Math.min(1, dt * (f > (P.fear || 0) ? 3 : .6)));
  heartT -= dt; if (P.fear > .2 && heartT <= 0) { heartT = 60 / (60 + P.fear * 110); Snd.heart(P.fear); }
  $('fearV').style.opacity = G.js && G.js.t > 0 ? .2 : clamp((P.fear - .25) * 1.2, 0, .9); $('downV').style.opacity = P.down ? (G.js && G.js.t > 0 ? .1 : .55 + .35 * (1 - P.bleed / D.bleed)) : 0;
  if (A.on) {
    const c = A.ctx, t = c.currentTime, ch = M.state === 'chase', rigNear = nearRig(cp.x, cp.z), chase = (ch && d < 60) || sCh || gCh;
    A.drone.gain.setTargetAtTime(chase ? .05 : 0, t, chase ? .3 : 1.5); A.droneF.frequency.setTargetAtTime(chase ? 900 : 300, t, 1);
    A.mBreath.g.gain.setTargetAtTime(rigNear ? .25 * (ch ? 1.6 : 1) * (.5 + .5 * Math.sin(G.t * (ch ? 9 : 2.5))) : 0, t, .05); A.mGrowl.gain.setTargetAtTime(!rigNear ? 0 : ch ? .5 : M.state === 'search' ? .25 : .08 * clamp(1 - d / 25, 0, 1), t, .2); A.mSaw.frequency.setTargetAtTime(ch ? 62 : 44, t, .3);
    setPan(A.mPan, M.x, M.y + 2, M.z);
    if (!A.hz) hzInit();
    const L = c.listener; cam.getWorldDirection(_fw);
    if (L.positionX) { L.positionX.value = cp.x; L.positionY.value = cp.y; L.positionZ.value = cp.z; L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(cp.x, cp.y, cp.z); L.setOrientation(_fw.x, _fw.y, _fw.z, 0, 1, 0); }
    const inside = zoneOf(cp.x, cp.z, cp.y - 1.6) >= 0 || (P.hd >= 0) || inCabin(), st = G.storm, dvd = G.subIn && (B.dep || 0) > 2 ? 0 : 1;
    A.pad.gain.setTargetAtTime(.028 * Math.max(TOD.night * .9 + (1 - TOD.day) * .3, G.storm * .7), t, 2); A.padF.frequency.setTargetAtTime(260 + 300 * TOD.night + Math.sin(G.wt * .11) * 90, t, 2);
    A.rain.g.gain.value = (inside ? .015 : .05) * st * dvd; A.wind.g.gain.value = ((inside ? .02 : .06) + Math.sin(G.t * .13) * .02) * (.3 + st * .7) * dvd + (P.ob && !inCabin() ? clamp(Math.abs(B.v) / 11, 0, 1) * .07 : 0); A.wind.f.frequency.value = 380 + Math.sin(G.t * .21) * 140 + (P.ob ? Math.abs(B.v) * 35 : 0); A.surf.g.gain.value = clamp(.14 - cp.y * .006, .02, .14) * (.5 + st * .5) * clamp(1.2 - shoreDist() / 140, .15, 1) * (G.subIn ? .35 * dvd : 1);
    if (BG.sub) { const [ex, ez] = bL2W(0, 5.6); setPan(A.bPan, ex, B.heave + SUB.FI + 1, ez); } else setPan(A.bPan, B.x, 1.5, B.z); boatAudio(dt, t);
    if (A.mus) Mus.step(dt);
    const gb = BLD.find(q => q.kind === 'gen'); if (gb) setPan(A.gPan, gb.x, gb.fy + 1, gb.z); A.genG.gain.value = G.power ? .35 : 0;
    if (G.alarmT > 0) { G.alarmT -= dt; A.alarm.frequency.value = Math.sin(G.wt * 4) > 0 ? 620 : 470; A.alarmG.gain.value = .05; setPan(A.aPan, 0, LV[1] + 4, 0); } else A.alarmG.gain.value = 0;
    A.deepG.gain.setTargetAtTime(sp ? .2 : 0, t, .8);
    // the Steward walking the halls: a small bell, or three slow knocks somewhere close
    G.belT = (G.belT ?? 8) - dt; if (G.belT <= 0) { G.belT = 7 + Math.random() * 7; if (sOn && sd < 40 && (STS.state === 'roam' || STS.state === 'search')) { const bp = at(STS.x, STS.y + 2.4, STS.z, 4); if (Math.random() < .5) Snd.bell(bp); else for (let i = 0; i < 3; i++) setTimeout(() => burst(180, 1, .32, .16, 'lowpass', bp, .7), i * 290); } }
    A.lp.frequency.setTargetAtTime((G.uwC ?? G.uw) > .5 ? 520 : 20000, t, .08);
    if (P.sw && (P.dv || 0) > .6) { G.brT = (G.brT ?? 0) - dt; if (G.brT <= 0) { G.brT = 3.6 - P.fear * 1.6; Snd.inhale(1); setTimeout(() => { Snd.exhale(1); bubbles(cam.position.x, cam.position.y - .2, cam.position.z, 8); }, 1300); } }
    G.mbT = (G.mbT ?? 0) - dt; if (G.mbT <= 0 && CRZ.box && Math.hypot(cp.x - CRZ.box[0], cp.z - CRZ.box[2]) < 45) { const N = [659, 587, 523, 494, 523, 587, 440, 0, 659, 698, 659, 587, 523, 0, 494, 523]; G.mbI = ((G.mbI || 0) + 1) % N.length; G.mbT = .42; if (N[G.mbI]) tone(N[G.mbI] * 2, .05, .9, 'sine', at(CRZ.box[0], CRZ.box[1], CRZ.box[2], 3)); }
    G.mimT = (G.mimT ?? 60) - dt; if (G.mimT <= 0) { G.mimT = 70 + Math.random() * 90; if (rigNear && d > 10 && d < 45 && M.state === 'roam' && PL.size > 0) Snd.whistle(at(M.x, M.y + 2, M.z, 8)); }
    G.clickT = (G.clickT || 3) - dt; if (G.clickT <= 0) { G.clickT = 1.6 + Math.random() * 4; if (rigNear && d < 34 && ['roam', 'search', 'inv'].includes(M.state)) Snd.clicks(at(M.x, M.y + 2.2, M.z, 3)); }
    G.creakT = (G.creakT || 4) - dt; if (G.creakT <= 0) { G.creakT = 4 + Math.random() * 9; if (rigNear) Snd.metal(at((Math.random() - .5) * 28, LV[Math.floor(Math.random() * 3)] + 2, (Math.random() - .5) * 28, 6)); }
    G.hornT = (G.hornT || 20) - dt; if (G.hornT <= 0) { G.hornT = 45; Snd.horn(at(G.lh[0], G.lh[1], G.lh[2], 60)); }
  }
}
function bearing(x, z) { return Math.atan2(-(x - cam.position.x), -(z - cam.position.z)); }
function drawCompass() {
  const c = $('compass'), g = c.getContext('2d'), dpr = devicePixelRatio || 1, cw = c.clientWidth || 720;
  if (c._cw !== cw || c._d !== dpr) { c._cw = cw; c._d = dpr; c.width = Math.round(cw * dpr); c.height = Math.round(46 * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); const W = cw, H = 46, cp = cam.position; g.clearRect(0, 0, W, H);
  _v.set(0, 0, -1).applyQuaternion(cam.quaternion); const yaw = Math.atan2(-_v.x, -_v.z), span = PI * .9, X = a => W / 2 + angD(yaw, a) / span * W, dist = d => d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km';
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 12, W, 22); g.fillStyle = '#c8c0b0'; g.font = '11px ui-monospace,monospace'; g.textAlign = 'center';
  for (let i = 0; i < 24; i++) { const a = -i / 24 * TAU + PI, x = X(a); if (x < 0 || x > W) continue; const big = i % 6 === 0; g.fillRect(x, 12, 1, big ? 8 : 4); if (big) g.fillText(['N', 'E', 'S', 'W'][i / 6], x, 30); }
  const sm = G.nstep && G.nstep.mk && G.nstep.mk.lab ? G.nstep.mk : null; let lab = null;
  const mark = (x, z, label, col, sym = '▼') => { if (sm && Math.hypot(x - sm.x, z - sm.z) < 15) return; const a = bearing(x, z); if (Math.abs(angD(yaw, a)) > span / 2) return; const px = X(a), d = Math.hypot(x - cp.x, z - cp.z); g.fillStyle = col; g.fillText(sym, px, 10); const da = Math.abs(angD(yaw, a)); if ((da < .12 || sym === '!') && (!lab || da < lab.da)) lab = {da, px, col, t: `${label} ${dist(d)}`}; };
  mark(HOME.x, HOME.z, 'HOME', '#ffd880');
  for (const q of VOY_PORTS) if (Math.hypot(q.x - cp.x, q.z - cp.z) < 3000 && Math.hypot(q.x - cp.x, q.z - cp.z) > 40) mark(q.x, q.z, q.n.toUpperCase(), '#9fe6ff', '⚓');
  if (P && !P.ob && !P.dead) mark(B.x, B.z, 'BOAT', '#7ad0ff');
  POIS.forEach((q, i) => { if (q.home) return; if (G.disc.includes(i)) { if (Math.hypot(q.x - cp.x, q.z - cp.z) > 60) mark(q.x, q.z, q.n, 'rgba(220,210,190,.75)', '·'); } else if (B.up.sonar) mark(q.x, q.z, 'Unknown', '#9affd0', '◆'); });
  DIGS.forEach(d => { if (d.rev && !d.dug) mark(d.x, d.z, 'X', '#ff7050', '✕'); });
  if (B.up.sonar && HC().sub) SUNK.forEach(q => { if (!q.got) mark(q.x, q.z, 'WRECKAGE', '#7affd0', '◆'); });
  // floating cargo: sonar shows it out to 400 m; without sonar the nearest (150 m) still show as small ticks
  { const R = B.up.sonar ? 400 : 150; for (const f of G.floats) { if (!f || Math.hypot(f[0] - cp.x, f[1] - cp.z) > R) continue; const a = bearing(f[0], f[1]); if (Math.abs(angD(yaw, a)) >= span / 2) continue; if (B.up.sonar) { g.fillStyle = '#9affd0'; g.fillRect(X(a) - 1.5, 21, 3, 3); } else { g.fillStyle = 'rgba(255,196,120,.8)'; g.fillRect(X(a) - .75, 18, 1.5, 7); } } }
  for (const p of PL.values()) if (p !== P && p.ready && !p.dead && (p.sw || p.down)) mark(p.rx, p.rz, p.name, '#ff7050', '!');
  // the current step: always labelled; pinned to an edge with an arrow when it is off the strip
  // the current step and the chart course (cyan): always labelled; pinned to an edge with an arrow when off the strip; the course label steps aside from the step's
  let smR = null; const pin = (x, z, name, col, sym, avoid) => { const a = bearing(x, z), da = angD(yaw, a), t = `${name} ${dist(Math.hypot(x - cp.x, z - cp.z))}`, tw = g.measureText(t).width; g.fillStyle = col; let x0;
    if (Math.abs(da) > span / 2) { const r = da > 0; g.textAlign = r ? 'right' : 'left'; g.font = '13px ui-monospace,monospace'; g.fillText(r ? '▶' : '◀', r ? W - 3 : 3, avoid ? 20 : 28); g.font = '11px ui-monospace,monospace'; x0 = r ? W - 3 - tw : 3;
      if (avoid && avoid[0] < x0 + tw + 8 && avoid[1] > x0 - 8) x0 = r ? avoid[0] - tw - 14 : avoid[1] + 14; g.textAlign = 'left'; g.fillText(t, x0, 45); g.textAlign = 'center'; }
    else { const px = X(a); x0 = clamp(px, tw / 2 + 2, W - tw / 2 - 2) - tw / 2; if (avoid && avoid[0] < x0 + tw + 8 && avoid[1] > x0 - 8) x0 = px < (avoid[0] + avoid[1]) / 2 ? avoid[0] - tw - 14 : avoid[1] + 14; x0 = clamp(x0, 2, W - tw - 2); g.fillText(sym, px, 10); g.textAlign = 'left'; g.fillText(t, x0, 45); g.textAlign = 'center'; }
    if (lab && lab.px > x0 - 50 && lab.px < x0 + tw + 50) lab = null; return [x0, x0 + tw]; };
  if (sm) smR = pin(sm.x, sm.z, sm.lab, '#ffcf60', '◆');
  if (G.voyWp) pin(G.voyWp[0], G.voyWp[1], 'COURSE', '#6fe0ff', '◇', smR);
  if (lab) { g.fillStyle = lab.col; g.fillText(lab.t, lab.px, 45); }
}
function hud() {
  const now = performance.now(), dt = Math.min(.1, (now - (G.hudT || now)) / 1000); G.hudT = now;
  const lb = G.cine > 0 || (G.js && G.js.t > 0) || !!G.drownCam; if (lb !== G.lbOn) { G.lbOn = lb; $('lbox').classList.toggle('on', lb); }
  { let n = 0; for (let i = 0; i < 4; i++) if (P.bat > i * .25 + .02) n++; const k = n + (P.bat < .25 ? 'l' : ''); if (k !== G.batK) { G.batK = k; const b = $('bat'); for (let i = 0; i < 4; i++) b.children[i].className = i < n ? '' : 'off'; b.classList.toggle('low', P.bat < .25); } }
  setT('nFlare', P.flares); setT('nSpd', Math.abs(B.v * 1.94).toFixed(0));
  // cash counts up, and every change pops above the counter
  { const dc = G.cash - (G.cashLast ?? G.cash); G.cashLast = G.cash;
    if (Math.abs(dc) >= 1) { const cp = $('cashPop'), r = $('nCash').getBoundingClientRect(); G.popV = (now - (G.popAt || 0) < 400 ? G.popV || 0 : 0) + dc; G.popAt = now; cp.textContent = (G.popV >= 0 ? '+' : '-') + cashStr(Math.abs(G.popV)); cp.className = ''; void cp.offsetWidth; cp.className = 'go ' + (G.popV >= 0 ? 'up' : 'dn'); cp.style.left = (r.left + r.width / 2).toFixed(1) + 'px'; cp.style.top = (r.top - 2).toFixed(1) + 'px'; }
    if (G.cashShown == null) G.cashShown = G.cash; G.cashShown += (G.cash - G.cashShown) * Math.min(1, dt * 6); if (Math.abs(G.cash - G.cashShown) < 1) G.cashShown = G.cash; setT('nCash', cashStr(G.cashShown)); }
  { const sb = BG.sub && P.ob && !P.sw, dv = P.sw ? P.dv || 0 : sb ? B.dep || 0 : 0, show = dv > .3; if (show !== G.diveShow) { G.diveShow = show; $('dive').style.opacity = show ? 1 : 0; } if (sb !== !!G.diveSub) { G.diveSub = sb; $('dive').lastChild.textContent = sb ? '' : ' · AIR'; } if (show && sb) { const mx = HC().maxDep || 80; setT('diveD', `${dv.toFixed(dv < 10 ? 1 : 0)} m`); setS('diveA', 'width', Math.round(clamp(dv / mx, 0, 1) * 100) + '%'); setS('diveA', 'background', dv > mx * .85 ? '#e04030' : '#ffb040'); setT('diveS', `max ${mx} m`); } else if (show) { const su = (P.own && P.own.suit) || 0; setT('diveD', `${dv.toFixed(dv < 10 ? 1 : 0)} m`); setS('diveA', 'width', Math.round((P.air ?? 1) * 100) + '%'); setS('diveA', 'background', P.air < .25 ? '#e04030' : '#7ad0ff'); setT('diveS', SUIT[su].n + ' · max ' + SUIT[su].max + ' m'); } }
  setS('hullB', 'width', Math.round(clamp(B.hull / hullMax(), 0, 1) * 100) + '%'); setS('hullB', 'background', B.hull < 30 ? '#e06040' : '#8ac080');
  setT('holdT', `HOLD ${sackUsed(B.hold)}/${holdCap()} · ${cashStr(holdValue())}`);
  { const q = P.sack || [], key = q.join(); if (key !== G.sackKey) { G.sackKey = key; $('carry').innerHTML = q.length ? `${ICON.sack} ${sackUsed(q)}/${sackCap(P)}${sackVal(q) ? ' · ' + cashStr(sackVal(q)) : ''}<small>${q.map(k => NAMES[k]).join(', ')}</small>` : ''; G.sackSm = $('carry').querySelector('small'); G.sackShowT = 3.5; } if (!G.paused) G.sackShowT = (G.sackShowT || 0) - dt; if (G.sackSm) setS(G.sackSm, 'opacity', G.sackShowT > 0 ? 1 : 0); }
  // one short step at a time: after the intro, again when the chart opens and after a minute with no progress
  { const ot = hint(), ob = $('obj'), pk = `${G.earned}|${G.disc.length}|${sackUsed(P.sack)}|${B.hold.length}`;
    if (pk !== G.progK) { G.progK = pk; G.progT = 0; } else if (!G.paused) G.progT = (G.progT || 0) + dt;
    if (G.map && !G.mapWas) G.reshow = 1;
    if (G.introT > 0) { G.introT -= dt; setS(ob, 'opacity', 0); }
    else if (ot !== G.objLast) { const first = !G.objLast; G.objLast = ot; ob.innerHTML = ot; setS(ob, 'opacity', ot ? 1 : 0); G.objT = first ? 9 : 7; }
    else if (ot && (G.reshow || G.progT > 60)) { G.progT = 0; setS(ob, 'opacity', 1); G.objT = Math.max(G.objT || 0, 7); }
    G.reshow = 0; if (G.objT > 0 && !G.paused) { G.objT -= dt; if (G.objT <= 0) setS(ob, 'opacity', 0); } }
  G.teamT = (G.teamT || 0) - dt; if (G.teamT <= 0) { G.teamT = .33; const h = PL.size > 1 ? [...PL.values()].map(p => `<div class="${p.dead ? 'dead' : p.down || p.sw ? 'down' : ''}">${p.name}${p.down ? ' · DOWN ' + Math.max(0, p.bleed | 0) + 's' : p.dead ? '' : p.sw ? ' · IN THE WATER' : p.seat ? ' · at the wheel' : p.ob ? ' · aboard' : ''}<i style="background:${hexS(CREW_COL[p.c % 6])}"></i></div>`).join('') : ''; if (h !== G.teamH) { G.teamH = h; $('team').innerHTML = h; } }
  { const solo = PL.size === 1; let st = '';
    G.swimL = P.sw && P.deep && !P.dead && !(P.own && P.own.suit) ? (G.swimL || 0) + dt : Math.max(0, (G.swimL || 0) - dt * 3);
    if (P.dead) st = (P.drowned === 1 ? 'Pulled under' : P.drowned === 4 ? 'Drowned' : 'You are dead') + '<br><small>You will wash up at the lighthouse.</small>';
    else if (P.down) st = solo ? 'It got you<br><small>You will wash up at the lighthouse.</small>' : `You are down<br><small>Bleeding out · ${Math.max(0, P.bleed | 0)} s. Crawl to your crew.</small>`;
    else if (!P.seat && P.sw && P.deep && !(P.own && P.own.suit)) { const k = G.swimL / (D.drown * 6.5); st = k > .78 ? '<small style="color:#ff5a4a">Exhausted · get out of the water</small>' : k > .45 ? '<small style="color:#ffb07a">Tiring</small>' : '<small style="color:#9fd0e0">Deep water</small>'; }
    if (P.seat) { if (!G.paused) G.seatT = (G.seatT ?? 0) + dt; } else G.seatT = 0;
    if (st !== G.stTxt) { G.stTxt = st; $('state').innerHTML = st; } }
  { const nb = P.ob || P.seat || Math.hypot(B.x - P.x, B.z - P.z) < 30; if (nb !== G.bhOn) { G.bhOn = nb; $('boatHud').style.opacity = nb ? 1 : 0; $('nSpd').parentElement.style.display = nb ? '' : 'none'; } }
  { const k = .5 + .8 * (TOD.night || 0); for (let i = 0; i < FLM.length; i++) { const o = FLM[i]; if (o && o.glow) o.glow.material.opacity = (.35 + .25 * Math.sin(G.wt * 2 + i)) * k; } }
  if (isHost() && G.stat) { if (!(G.paused && Net.role === 'solo')) G.stat.play += dt; for (const p of PL.values()) { const v = (p.sw && p.dv) || 0; if (v > G.stat.maxDv) G.stat.maxDv = v; } }
  else if (G.stat && P && P.sw) G.stat.maxDv = Math.max(G.stat.maxDv, P.dv || 0);
  // logbook banner: one at a time, 4 s each, held back while a panel is open; a goal also sends up three rockets
  { const bn = $('banner'); if (G.banA && now - G.banA > 4000) { G.banA = 0; G.banE = now; bn.classList.remove('on'); }
    if (!G.banA && G.banQ && G.banQ.length && now - (G.banE || 0) > 700 && !(G.shopOpen || G.casOpen || G.helpOpen || G.noteOpen || G.endOpen)) { const q = G.banQ.shift(); bn.innerHTML = `<small>${q.h}</small>${q.t}${q.c ? `<b>+${cashStr(q.c)}</b>` : ''}`; bn.className = q.s === 'rank' ? 'rank' : ''; void bn.offsetWidth; bn.classList.add('on'); G.banA = now;
      if (q.s === 'rank') Snd.horn(null); else if (q.s === 'bounty') Snd.coin(); else { (Snd.goal || Snd.discover)(); setTimeout(() => Snd.coin(), 600); if (!(G.uw > .5) && !G.subIn) for (let k = 0; k < 3; k++) setTimeout(() => G.on && spawnRocket({x: cam.position.x + (Math.random() - .5) * 24, y: cam.position.y + 3, z: cam.position.z + (Math.random() - .5) * 24, vx: Math.random() < .5 ? -2 : 2, vy: 26, vz: Math.random() < .5 ? -2 : 2, c: Math.floor(Math.random() * 5)}), 200 + k * 380); } } }
  // the step marker: a gold diamond on the thing to do next; a tick for a second once it is done
  { let m = G.mkEl; if (!m || !m.isConnected) { m = G.mkEl = document.createElement('div'); m.id = 'stepMk'; m.innerHTML = '<b>◆</b><small></small>'; $('tags').appendChild(m); }
    const ns = G.nstep || {}, cur = ns.mk && ns.mk.scr ? ns.mk : null;
    if (ns.t !== G.mkKey) { if (G.mkKey != null && G.mkCur) G.mkDone = {mk: G.mkCur, t: 1}; G.mkKey = ns.t; }
    G.mkCur = cur; let s = cur, done = false; if (G.mkDone) { G.mkDone.t -= dt; if (G.mkDone.t > 0) { s = G.mkDone.mk; done = true; } else G.mkDone = null; }
    const block = G.map || G.shopOpen || G.casOpen || G.helpOpen || G.noteOpen || G.endOpen || G.cine > 0 || (G.js && G.js.t > 0) || G.camFly || !alivePlay(); let vis = false;
    if (s && !block) { const d = Math.hypot(s.x - cam.position.x, s.y - cam.position.y, s.z - cam.position.z); if (d >= 2) { _v.set(s.x, s.y, s.z).project(cam); if (_v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1) { vis = true; setS(m, 'left', ((_v.x + 1) / 2 * innerWidth).toFixed(1) + 'px'); setS(m, 'top', ((1 - _v.y) / 2 * innerHeight).toFixed(1) + 'px'); setT(m.lastChild, done ? '' : d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'); } } }
    setS(m, 'display', vis ? 'block' : 'none'); if (vis) { setT(m.firstChild, done ? '✓' : '◆'); const cl = done ? 'done' : ''; if (m.className !== cl) m.className = cl; } }
  // the chart's logbook: beside the chart on wide screens, a strip under the compass otherwise
  if (G.map !== G.mapWas) { G.mapWas = G.map; $('logbook').classList.toggle('hidden', !G.map); $('map').style.cssText = ''; G.logH = ''; if (G.map) G.logSide = innerWidth > Math.min(innerWidth * .86, innerHeight * .86, 760) + 600; }
  if (G.map) { const nm = String(P.name || '').replace(/[<>&]/g, ''), pay = D.pay || 1, pr = i => i === 0 ? `${G.disc.length}/${POIS.length}` : i === 3 ? cashStr(G.earned) : i === 11 ? `${clamp(G.disc.length - 1, 0, 3)}/3` : i === 4 ? `${B.up.engine || 0}/3` : i === 8 ? `${Math.round((G.stat && G.stat.maxDv) || 0)} m` : '';
    const h = `<h3>${TITLES[titleOf(G.earned)][1]} ${nm}</h3>` + GOAL_ORDER.filter(i => !G.goals.includes(i)).slice(0, 5).map(i => `<div><span>${GOALS[i]}${pr(i) ? ` <i>(${pr(i)})</i>` : ''}</span><b>${cashStr(GOAL_CASH[i] * pay)}</b></div>`).join('') + `<small>${G.goals.length}/${GOALS.length} done</small>`;
    if (h !== G.logH) { G.logH = h; const lg = $('logbook'), mp = $('map'), s = Math.min(innerWidth * .86, innerHeight * .86, 760); lg.innerHTML = h; lg.className = 'paper ' + (G.logSide ? 'side' : 'strip');
      if (G.logSide) { lg.style.left = ((innerWidth + s) / 2 + 24).toFixed(0) + 'px'; mp.style.cssText = ''; } else { lg.style.left = ''; const bt = lg.getBoundingClientRect().bottom, ms = Math.max(200, Math.min(s, innerHeight - bt - 14)); mp.style.width = mp.style.height = ms + 'px'; mp.style.top = (bt + 8 + ms / 2).toFixed(0) + 'px'; } } }
  drawCompass(); if (G.shopOpen) { const sg = [G.cash, JSON.stringify(B.up), JSON.stringify(P.own), holdValue(), sackVal(P.sack), P.coolerV || 0, Math.hypot(B.x - JETTY.x, B.z - JETTY.z) < 60 + BG.L * .5, G.cruise].join('|'); if (sg !== G.shopSig) { G.shopSig = sg; drawShop(); } }
  if (!!G.camFly !== !!G.flyOn) { G.flyOn = !!G.camFly; $('hud').classList.toggle('fly', G.flyOn); }
  if (G.camFly) camFly(Math.max(dt, G.cfC != null && G.cine > 0 ? G.cfC - G.cine : 0)); G.cfC = G.cine;
}
// the ending: a slow orbit of the Serenade under fireworks, then the voyage card
function camFly(dt) {
  const f = G.camFly; if (!f) return; f.t += dt; if (f.t >= f.T) { G.camFly = null; showEnd(f.st); return; }
  const a = f.a + f.t * .12; cam.position.set(CRZ.x + Math.sin(a) * 85, 28, CRZ.z + Math.cos(a) * 85); cam.lookAt(CRZ.x, 18, CRZ.z); cam.updateMatrixWorld(); VM.visible = VMF.visible = VMG.visible = VMS.visible = VMR.visible = false;
}
function showEnd(st) {
  st = st || {}; const pl = Math.round(st.play || 0), e = st.earned ?? G.earned, esc = s => String(s).replace(/[<>&]/g, '');
  $('endT').textContent = 'The Serenade sails again';
  $('endS').textContent = `${(st.crew && st.crew.length ? st.crew : [P ? P.name : '']).map(esc).join(', ')} · ${pl >= 3600 ? Math.floor(pl / 3600) + ' h ' : ''}${Math.floor(pl / 60) % 60} min at sea`;
  const rows = [['Places charted', `${st.disc ?? G.disc.length}/${POIS.length}`], ['Money earned', cashStr(e)], ['Fish landed', `${st.fish || 0}${st.maxKg ? ` · best ${st.maxKg} kg` : ''}`], ['Deepest dive', `${Math.round(st.maxDv || 0)} m`], ['Monsters put down', st.kills || 0], ['Goals', `${Math.min(GOALS.length, st.goals ?? G.goals.length)}/${GOALS.length}`], ['Rank', TITLES[titleOf(e)][1]]];
  $('endL').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  $('end').classList.remove('hidden', 'dead'); G.endOpen = true; try { document.exitPointerLock(); } catch (x) {}
  $('again').textContent = 'Keep sailing'; $('again').onclick = () => { $('end').classList.add('hidden'); G.endOpen = false; if (G.paused) pause(false); else lockMouse(); };
}
let grainT = 0; const gctx = $('grain').getContext('2d'), gimg = gctx.createImageData(200, 120);
function grain() { const f = P ? P.fear || 0 : 0; if (f < .05 && !(G.js && G.js.t > 0)) { if (G.grainQ) return; G.grainQ = true; } else G.grainQ = false; const d = gimg.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gctx.putImageData(gimg, 0, 0); setS('grain', 'opacity', G.grainQ ? .018 : .018 + .5 * f * .12); }
let MAPBG = null;
function drawMap() {
  const c = $('map'), g = c.getContext('2d'), W = c.width, now = performance.now();
  // at most 10 redraws a second (or at once on input), and always on the first call after the chart opens
  const fresh = (G.fr || 0) - (G.mapFr ?? -9) > 1; G.mapFr = G.fr || 0; if (fresh) voyChartOpen(W); if (!fresh && !VOY.dirty && now - (G.mapT || 0) < 100) return; G.mapT = now; VOY.dirty = 0;
  const MR = voyR(), MC = voyC(), ZL = VOY_ZL[VOY.z], S = W / (MR * 2.077) * ZL, cx = VOY.z ? VOY.cx : MC.x, cz = VOY.z ? VOY.cz : MC.z, X = x => W / 2 + (x - cx) * S, Z = z => W / 2 - (z - cz) * S;
  g.drawImage(voyChartBg(W), 0, 0); g.textAlign = 'center';
  // grid, map edge, scale bar
  { const gs = ZL >= 6 ? 250 : ZL >= 2.4 ? 500 : 1000, h = W / 2 / S; g.strokeStyle = 'rgba(20,40,52,.13)'; g.lineWidth = 1; g.beginPath();
    for (let k = Math.ceil((cx - h) / gs) * gs; k <= cx + h; k += gs) { const x = Math.round(X(k)) + .5; g.moveTo(x, 0); g.lineTo(x, W); }
    for (let k = Math.ceil((cz - h) / gs) * gs; k <= cz + h; k += gs) { const z = Math.round(Z(k)) + .5; g.moveTo(0, z); g.lineTo(W, z); } g.stroke();
    g.strokeStyle = 'rgba(20,30,40,.25)'; g.setLineDash([6, 6]); g.beginPath(); g.arc(X(MC.x), Z(MC.z), MR * S, 0, TAU); g.stroke(); g.setLineDash([]);
    const sl = [100, 250, 500, 1000, 2000].filter(v => v * S <= 150).pop() || 100, L5 = sl * S, sx = 20, sy = W - 50; g.fillStyle = 'rgba(32,32,30,.6)'; g.fillRect(sx, sy, L5, 2); g.fillRect(sx, sy - 4, 1.5, 8); g.fillRect(sx + L5 - 1.5, sy - 4, 1.5, 8); g.font = '11px Georgia'; g.textAlign = 'left'; g.fillText(sl < 1000 ? sl + ' m' : sl / 1000 + ' km', sx, sy - 7); g.textAlign = 'center'; }
  g.font = '13px Georgia';
  const arrow = (x, y, yaw, s, col, line) => { g.save(); g.translate(x, y); g.rotate(yaw + PI); g.beginPath(); g.moveTo(0, -s); g.lineTo(s * .55, s * .75); g.lineTo(-s * .55, s * .75); g.closePath(); if (line) { g.lineWidth = 2.5; g.strokeStyle = 'rgba(16,18,20,.85)'; g.stroke(); } g.fillStyle = col; g.fill(); g.restore(); };
  // region names, faint, once anything in the region is charted
  if (typeof REGIONS !== 'undefined' && Array.isArray(REGIONS)) { g.font = `italic ${Math.round(clamp(15 * Math.sqrt(ZL), 15, 30))}px Georgia`; g.fillStyle = 'rgba(30,44,52,.42)';
    for (const rg of REGIONS) { if (!rg || rg.x == null) continue; const rr = rg.r || 1000; if (POIS.some((q, i) => G.disc.includes(i) && Math.hypot(q.x - rg.x, q.z - rg.z) < rr)) g.fillText(rg.n || rg.name || '', X(rg.x), Z(rg.z)); } g.font = '13px Georgia'; }
  for (const b of BUOYS) { g.fillStyle = hexS(b.c); g.beginPath(); g.arc(X(b.x), Z(b.z), 2.5, 0, TAU); g.fill(); }
  const hintR = Math.max(700, .18 * MR);
  POIS.forEach((q, i) => { const known = G.disc.includes(i);
    if (!known) {
      if (q.rig) { g.strokeStyle = 'rgba(28,28,28,.38)'; g.lineWidth = 1; g.strokeRect(X(q.x) - 5.5, Z(q.z) - 5.5, 11, 11); g.fillStyle = 'rgba(26,26,26,.42)'; g.font = 'italic 12px Georgia'; g.fillText('Station Nine?', X(q.x), Z(q.z) - 12); g.font = '13px Georgia'; }
      else if (q.isle && Math.hypot(q.x - HOME.x, q.z - HOME.z) < hintR) { g.setLineDash([3, 3]); g.strokeStyle = 'rgba(40,46,36,.38)'; g.lineWidth = 1; g.beginPath(); g.arc(X(q.x), Z(q.z), Math.max(4, q.isle.shore * S), 0, TAU); g.stroke(); g.setLineDash([]); }
      if (B.up.sonar) { g.fillStyle = 'rgba(30,60,50,.6)'; g.fillText('?', X(q.x), Z(q.z) + 4); } return; }
    g.fillStyle = q.isle ? '#6a6a52' : q.home ? '#5a5248' : '#3a3a3a'; if (q.isle || q.home) { g.beginPath(); g.arc(X(q.x), Z(q.z), Math.max(4, (q.isle ? q.isle.shore : HOME.r) * S), 0, TAU); g.fill(); } else g.fillRect(X(q.x) - 5, Z(q.z) - 5, 10, 10);
    g.fillStyle = '#1a1a1a'; g.fillText(q.n, X(q.x), Z(q.z) - 12); });
  // landing stages, ports, world marks
  if (typeof PIERS !== 'undefined' && Array.isArray(PIERS)) { g.strokeStyle = 'rgba(70,52,34,.85)'; g.lineWidth = Math.max(2, 3 * S); g.beginPath(); for (const pr of PIERS) { const a = pr.root || [pr.x, pr.z], b = pr.head || [pr.x, pr.z]; g.moveTo(X(a[0]), Z(a[1])); g.lineTo(X(b[0]), Z(b[1])); } g.stroke(); }
  const anchor = (x, y, col) => { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y - 6, 2.2, 0, TAU); g.moveTo(x, y - 4); g.lineTo(x, y + 5); g.moveTo(x - 4, y - 1); g.lineTo(x + 4, y - 1); g.moveTo(x - 5, y + 2); g.quadraticCurveTo(x, y + 8, x + 5, y + 2); g.stroke(); };
  anchor(X(JETTY.x), Z(JETTY.z), '#2a3a46');
  for (const q of VOY_PORTS) { anchor(X(q.x), Z(q.z), '#1a4a66'); g.fillStyle = '#1a3a52'; g.font = 'bold 12px Georgia'; g.fillText(q.n, X(q.x), Z(q.z) - 13); g.font = '13px Georgia'; }
  if (typeof WLD_MARKS !== 'undefined' && Array.isArray(WLD_MARKS)) for (const m of WLD_MARKS) { if (!m) continue; const x = X(m.x), y = Z(m.z); g.fillStyle = typeof m.c === 'number' ? hexS(m.c) : m.c || '#5a3a2a'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.closePath(); g.fill(); if (m.n) { g.font = '11px Georgia'; g.fillText(m.n, x, y - 9); g.font = '13px Georgia'; } }
  DIGS.forEach(d => { if (d.rev) { g.fillStyle = d.dug ? '#666' : '#a01a10'; g.font = 'bold 16px Georgia'; g.fillText('✕', X(d.x), Z(d.z) + 5); g.font = '13px Georgia'; } });
  if (B.up.sonar) G.floats.forEach(f => { if (f) { g.fillStyle = '#2a6a5a'; g.fillRect(X(f[0]) - 1.5, Z(f[1]) - 1.5, 3, 3); } });
  // the course: dashed line from the boat, diamond, distance
  if (G.voyWp) { const [wx, wz] = G.voyWp; g.strokeStyle = 'rgba(16,96,128,.9)'; g.lineWidth = 2; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(X(B.x), Z(B.z)); g.lineTo(X(wx), Z(wz)); g.stroke(); g.setLineDash([]);
    const x = X(wx), y = Z(wz); g.fillStyle = '#1aa0d0'; g.strokeStyle = '#0a2a38'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 6, y); g.lineTo(x, y + 8); g.lineTo(x - 6, y); g.closePath(); g.fill(); g.stroke();
    const d = Math.hypot(wx - B.x, wz - B.z); g.fillStyle = '#0a3a50'; g.font = 'bold 11px ui-monospace,monospace'; g.fillText(d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km', x, y + 20); g.font = '13px Georgia'; }
  arrow(X(B.x), Z(B.z), B.yaw, 8, '#fff');
  // whoever is at the wheel points the way the boat is going, not where they are looking
  for (const p of PL.values()) { if (!p.ready || p.dead || p === P) continue; arrow(X(p.rx), Z(p.rz), PL.get(B.driver) === p ? B.yaw : p.ryaw, 6, hexS(CREW_COL[p.c % 6])); }
  if (P && !P.dead) arrow(X(P.x), Z(P.z), P.seat ? B.yaw : P.yaw, 9, hexS(CREW_COL[P.c % 6]), 1);
  // the cursor (fixed at the centre when zoomed in: the chart pans under it)
  { const [px, py] = VOY.z ? [W / 2, W / 2] : VOY.cur, wx = cx + (px - W / 2) / S, wz = cz - (py - W / 2) / S, d = Math.hypot(wx - B.x, wz - B.z); g.strokeStyle = 'rgba(10,20,26,.85)'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 7, 0, TAU); g.moveTo(px - 13, py); g.lineTo(px - 4, py); g.moveTo(px + 4, py); g.lineTo(px + 13, py); g.moveTo(px, py - 13); g.lineTo(px, py - 4); g.moveTo(px, py + 4); g.lineTo(px, py + 13); g.stroke();
    g.fillStyle = 'rgba(10,20,26,.8)'; g.font = '11px ui-monospace,monospace'; g.textAlign = 'left'; g.fillText(d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km', px + 12, py - 10); g.textAlign = 'center'; }
  // legend
  { let x = 20; const y = W - 26, it = (draw, t) => { draw(x + 5); g.fillStyle = '#1a1a1a'; g.textAlign = 'left'; g.font = '11px Georgia'; g.fillText(t, x + 14, y + 4); x += 22 + g.measureText(t).width; };
    it(cx => anchor(cx, y, '#1a4a66'), 'port');
    it(cx => arrow(cx, y, PI, 6, '#fff'), 'boat');
    it(cx => arrow(cx, y, PI, 7, hexS(CREW_COL[(P ? P.c : 0) % 6]), 1), 'you');
    it(cx => arrow(cx, y, PI, 5, hexS(CREW_COL[((P ? P.c : 0) + 1) % 6])), 'crew');
    it(cx => { g.fillStyle = '#a01a10'; g.font = 'bold 13px Georgia'; g.textAlign = 'center'; g.fillText('✕', cx, y + 5); }, 'treasure');
    it(cx => { g.fillStyle = '#1aa0d0'; g.beginPath(); g.moveTo(cx, y - 6); g.lineTo(cx + 4, y); g.lineTo(cx, y + 6); g.lineTo(cx - 4, y); g.closePath(); g.fill(); }, 'course'); }
  g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.font = '12px Georgia'; g.fillText('click: course · right-click: clear · wheel: zoom', W / 2, W - 8);
}

// ---------------- voyage: zoomable chart with a course, autopilot, the Northwatch trading post
const VOY_PORTS = [{n: 'Northwatch', x: 1150, z: 2000, dock: [1150, 2000], shop: null}];
function voyPortNear(x, z, pad) { if (Math.hypot(x - JETTY.x, z - JETTY.z) < pad) return JETTY; for (const q of VOY_PORTS) if (Math.hypot(x - q.dock[0], z - q.dock[1]) < pad) return q; return null; }
const VOY = {z: 0, cx: 0, cz: -60, cur: [380, 380], dirty: 0, bg: null, ap: 0, tg: null, wp0: null, pT: 0, bias: 0, slow: 1, arrive: 0, pill: null, pillT: 0, pillS: ''}, VOY_ZL = [1, 2.4, 6];
function voyR() { return typeof MAP_R === 'number' ? MAP_R : 2600; }
function voyC() { return typeof MAP_C === 'object' && MAP_C && MAP_C.x != null ? MAP_C : {x: 0, z: -60}; }
function voyChartBg(W) {
  if (VOY.bg && VOY.bg.width === W) return VOY.bg; const cv = VOY.bg = document.createElement('canvas'); cv.width = cv.height = W; const b = cv.getContext('2d'), r = mulberry(77);
  const gr = b.createRadialGradient(W / 2, W / 2, W * .15, W / 2, W / 2, W * .74); gr.addColorStop(0, '#93a3a5'); gr.addColorStop(1, '#7b8b8e'); b.fillStyle = gr; b.fillRect(0, 0, W, W);
  for (let i = 0; i < 3000; i++) { b.fillStyle = `rgba(30,50,60,${r() * .08})`; b.fillRect(r() * W, r() * W, 2, 2); }
  const rx = W - 44, ry = 52; b.fillStyle = b.strokeStyle = 'rgba(32,32,30,.6)'; b.lineWidth = 1;
  for (let k = 0; k < 4; k++) { const a = k * PI / 2, L = k % 2 ? 15 : 22; b.beginPath(); b.moveTo(rx + Math.sin(a) * L, ry - Math.cos(a) * L); b.lineTo(rx + Math.sin(a + PI / 4) * 4, ry - Math.cos(a + PI / 4) * 4); b.lineTo(rx, ry); b.lineTo(rx + Math.sin(a - PI / 4) * 4, ry - Math.cos(a - PI / 4) * 4); b.closePath(); if (k) b.stroke(); else b.fill(); }
  b.beginPath(); b.arc(rx, ry, 11, 0, TAU); b.stroke(); b.font = 'bold 12px Georgia'; b.textAlign = 'center'; b.fillText('N', rx, ry - 26); return cv;
}
// chart opened: the cursor starts on the course (or the boat, or you); zoomed in, the view centres on the boat (or you)
function voyChartOpen(W) {
  const MR = voyR(), MC = voyC(), S1 = W / (MR * 2.077), ab = P && (P.ob || Math.hypot(P.x - B.x, P.z - B.z) < 60), fx = ab ? B.x : P ? P.x : 0, fz = ab ? B.z : P ? P.z : 0, [qx, qz] = G.voyWp || [fx, fz];
  VOY.cur = [clamp(W / 2 + (qx - MC.x) * S1, 8, W - 8), clamp(W / 2 - (qz - MC.z) * S1, 8, W - 8)]; VOY.cx = fx; VOY.cz = fz;
}
function voyClampC() { const MR = voyR(), MC = voyC(), d = Math.hypot(VOY.cx - MC.x, VOY.cz - MC.z); if (d > MR) { VOY.cx = MC.x + (VOY.cx - MC.x) / d * MR; VOY.cz = MC.z + (VOY.cz - MC.z) / d * MR; } }
function voyZoom(dir) {
  const W = $('map').width, nz = clamp(VOY.z + dir, 0, 2); if (nz === VOY.z) return; const MR = voyR(), MC = voyC(), S1 = W / (MR * 2.077);
  if (VOY.z === 0) { VOY.cx = MC.x + (VOY.cur[0] - W / 2) / S1; VOY.cz = MC.z - (VOY.cur[1] - W / 2) / S1; voyClampC(); }
  if (nz === 0) VOY.cur = [clamp(W / 2 + (VOY.cx - MC.x) * S1, 8, W - 8), clamp(W / 2 - (VOY.cz - MC.z) * S1, 8, W - 8)];
  VOY.z = nz; VOY.dirty = 1; if (A.on) tone(nz > 0 ? 990 : 740, .03, .08, 'triangle');
}
function voyCursorWorld() {
  const W = $('map').width, MR = voyR(), MC = voyC(); if (VOY.z) return [VOY.cx, VOY.cz]; const S = W / (MR * 2.077); let x = MC.x + (VOY.cur[0] - W / 2) / S, z = MC.z - (VOY.cur[1] - W / 2) / S;
  const d = Math.hypot(x - MC.x, z - MC.z); if (d > MR) { x = MC.x + (x - MC.x) / d * MR; z = MC.z + (z - MC.z) / d * MR; } return [x, z];
}
Snd.voyChime = up => { tone(up ? 660 : 990, .05, .3, 'sine'); setTimeout(() => tone(up ? 990 : 660, .05, .45, 'sine'), 120); };
// autopilot: steers the driver's own input (sent in the pose), so it works the same for host and guests
function voyApTarget() { if (G.voyWp) return G.voyWp.slice(); const m = G.nstep && G.nstep.mk; if (m && m.x != null && !m.scr) return [m.x, m.z]; return [JETTY.x, JETTY.z + 14]; }
function voyApSet(on, why) {
  if (!!on === !!VOY.ap) return; VOY.ap = on ? 1 : 0; VOY.tg = on ? voyApTarget() : null; VOY.wp0 = G.voyWp; VOY.bias = 0; VOY.slow = 1; VOY.arrive = 0; VOY.pT = 0;
  if (A.on) Snd.voyChime(!!on); if (why) showMsg(why, '', 2.5); VOY.pillT = 0;
}
function voyProbe(h, tx, tz, d) {
  const m = BG.hw + 8, L = Math.max(40, BG.L), hit = (x, z) => { for (const o of OBST) { if (o.c ? Math.hypot(x - o.x, z - o.z) < o.r + m : x > o.x0 - m && x < o.x1 + m && z > o.z0 - m && z < o.z1 + m) return o; } return null; };
  const tin = hit(tx, tz), sc = [0, 0, 0]; let blk = false; VOY.arrive = 0;
  [-.44, 0, .44].forEach((da, j) => { for (let k = 1; k <= 3; k++) { const s = k * L; if (s > d + L * .5) break; const a = h + da, o = hit(B.x - Math.sin(a) * s, B.z - Math.cos(a) * s); if (!o) continue; if (o === tin) { if (j === 1 && s <= Math.max(60, L)) VOY.arrive = 1; break; } sc[j] += 4 - k; if (j === 1 && s <= Math.max(60, L)) blk = true; } });
  VOY.slow = blk ? .4 : 1; if (!sc[1]) VOY.bias *= .5; else VOY.bias = sc[0] <= sc[2] ? -.6 : .6;
}
function voyAp(dt) {
  if (!P || !P.seat || P.dead || !G.on) { voyApSet(false); return; }
  if (G.voyWp && G.voyWp !== VOY.wp0) { VOY.tg = G.voyWp.slice(); VOY.wp0 = G.voyWp; } else if (!G.voyWp && VOY.wp0) { VOY.wp0 = null; VOY.tg = voyApTarget(); }
  if ((B.dep || 0) > .5) return;
  const [tx, tz] = VOY.tg, d = Math.hypot(tx - B.x, tz - B.z);
  let h = Math.atan2(-(tx - B.x), -(tz - B.z)); if ((VOY.pT -= dt) <= 0) { VOY.pT = .2; voyProbe(h, tx, tz, d); }
  if (d < 25 + BG.L / 2 || VOY.arrive) { if (G.voyWp && Math.hypot(G.voyWp[0] - tx, G.voyWp[1] - tz) < 1) G.voyWp = null; voyApSet(false, 'Arrived.'); return; }
  h += VOY.bias; const e = angD(B.yaw, h); P.in[1] = clamp(-e * 2.2, -1, 1); P.in[0] = Math.min(d > 250 ? 1 : d > 80 ? .6 : .3, VOY.slow);
}
{ const f0 = stepPlayer; stepPlayer = function (dt, ...a) { const r = f0.call(this, dt, ...a); if (VOY.ap) voyAp(dt); return r; }; }
// the Northwatch trading post: a floating pontoon with a shop counter, built identically on every client
function voyBuildPort() {
  const q = VOY_PORTS[0], y = 1.6, x0 = q.x - 15, x1 = q.x + 15, z0 = q.z - 10, z1 = q.z + 10;
  SURF.push({k: 'slab', x0, x1, z0, z1, y}); bx('wood', x0, x1, y - .3, y, z0, z1, 1.5); bx('log', x0, x1, y - .6, y - .25, z0 - .22, z0);
  for (let x = x0 + 2; x <= x1 - 1.9; x += 4) for (const z of [z0 + 1.3, z1 - 1.3]) bx('dark', x - 1.5, x + 1.5, .15, y - .3, z - 1, z + 1);
  for (const [px, pz] of [[x0 + .35, z0 + .35], [x1 - .35, z0 + .35], [x0 + .35, z1 - .35], [x1 - .35, z1 - .35], [q.x, z0 + .35], [q.x, z1 - .35]]) put('log', new THREE.CylinderGeometry(.22, .26, 7.5, 7), px, -1.2, pz);
  OBST.push({x0: x0 - .5, x1: x1 + .5, z0: z0 - .5, z1: z1 + .5}, {c: 1, x: q.x, z: q.z, r: 6});
  for (let x = x0 + 2.5; x <= x1 - 2; x += 6.25) { put('dark', new THREE.CylinderGeometry(.15, .19, .42, 8), x, y + .21, z0 + .4); put('dark', new THREE.CylinderGeometry(.24, .24, .06, 8), x, y + .44, z0 + .4); }
  const b = building('shed', 'Northwatch trading post', q.x, q.z + 6, y, 's'); q.shop = b.shop; q.b = b;
  { const sc = cv(512, 128, (g, w, h) => { g.fillStyle = '#16303a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8fc8d8'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#e8f4f6'; g.font = 'bold 54px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NORTHWATCH', w / 2, h / 2 + 2); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, .9), new THREE.MeshStandardMaterial({map: (t => (t.colorSpace = THREE.SRGBColorSpace, t))(new THREE.CanvasTexture(sc)), roughness: .7})); const [sx, sz] = L2W(b, 0, -b.d / 2 - .1); m.position.set(sx, y + b.wh + .55, sz); m.rotation.y = b.th + PI; scene.add(m); }
  // lamp post, fuel drums, a crate stack, a radio mast with a red light, the swim ladder
  put('dark', new THREE.CylinderGeometry(.07, .1, 4, 6), x0 + 2.2, y + 2, z0 + 2.2); put('dark', new THREE.BoxGeometry(.7, .06, .12), x0 + 2.45, y + 3.95, z0 + 2.2); put('bulb', new THREE.SphereGeometry(.18, 10, 8), x0 + 2.75, y + 3.8, z0 + 2.2);
  for (let i = 0; i < 5; i++) put(i % 2 ? 'red' : 'steel', new THREE.CylinderGeometry(.3, .3, .9, 10), x1 - 2.1 - (i % 3) * .66, y + .45, z1 - 2.6 - Math.floor(i / 3) * .66);
  PCIRC.push({x: x1 - 2.75, z: z1 - 2.9, r: 1.2}, {x: x0 + 2.2, z: z0 + 2.2, r: .3});
  for (const [cx, cz, k] of [[x0 + 3, z1 - 2.5, 0], [x0 + 3.9, z1 - 2.5, 1], [x0 + 3.45, z1 - 2.5, 2]]) wbox('crate', cx, y + (k === 2 ? 1.2 : .4), cz, .8, .8, .8, k * .3); PCIRC.push({x: x0 + 3.45, z: z1 - 2.5, r: 1});
  put('steel', new THREE.CylinderGeometry(.08, .16, 12, 6), x1 - 1.2, y + 6, q.z + 4); for (let k = 0; k < 3; k++) put('steel', new THREE.CylinderGeometry(.015, .015, 12.6, 3), x1 - 1.2 + [-1.6, 1.4, .2][k] / 2, y + 6, q.z + 4 + [1.2, .8, -1.5][k] / 2, 0, [-1.6, 1.4, .2][k] * .065, [1.2, .8, -1.5][k] * -.065);
  PCIRC.push({x: x1 - 1.2, z: q.z + 4, r: .3});
  for (const sd of [-1, 1]) put('steel', new THREE.CylinderGeometry(.035, .035, 2.6, 6), q.x + sd * .32, .35, z0 - .3); for (let k = 0; k < 5; k++) put('steel', new THREE.CylinderGeometry(.025, .025, .64, 5), q.x, -.6 + k * .45, z0 - .3, 0, 0, PI / 2);
  INTER.push({kind: 'ladder', x: q.x, y: 0, z: z0 - .8, r: 3.5, top: [q.x, y, z0 + 1.2], label: () => 'Climb the ladder', on: () => P.sw});
  const spr = (col, s, xx, yy, zz) => { const o = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); o.scale.setScalar(s); o.position.set(xx, yy, zz); scene.add(o); return o; };
  VOY.mastS = spr(0xff2010, 2.6, x1 - 1.2, y + 12.2, q.z + 4); VOY.lampS = spr(0xffd8a0, 3, x0 + 2.75, y + 3.75, z0 + 2.2);
}
{ const f0 = buildBuoys; buildBuoys = function (...a) { const r = f0.apply(this, a); voyBuildPort(); return r; }; }
{ const f0 = targets; targets = function (...a) { const L = f0.apply(this, a); if (P && !P.dead) for (const q of VOY_PORTS) if (q.shop && Math.hypot(q.shop[0] - P.x, q.shop[2] - P.z) < 30) L.push({x: q.shop[0], y: q.shop[1], z: q.shop[2], r: 3, label: `${q.n}: sell, repair, supplies`, go: openShop}); return L; }; }
{ const f0 = openShop; openShop = function (...a) {
  let best = G.shed && G.shed.shop, port = null, bd = best && P ? Math.hypot(P.x - best[0], P.z - best[2]) : 1e9;
  if (P) for (const q of VOY_PORTS) if (q.shop) { const d = Math.hypot(P.x - q.shop[0], P.z - q.shop[2]); if (d < bd) { bd = d; best = q.shop; port = q; } }
  G.voyShopPos = P ? [P.x, P.y, P.z] : best; G.voyPort = port; const r = f0.apply(this, a); const h = document.querySelector('#shopH h2'); if (h) h.textContent = port ? port.n.toUpperCase() : 'HARBOUR SHED'; return r; }; }
// the sell step points at Northwatch when it is the nearer counter
{ const f0 = nextStep; nextStep = function (...a) { const r = f0.apply(this, a); const q = VOY_PORTS[0], sh = G.shed && G.shed.shop;
  if (r && r.mk && r.mk.lab === 'SHED' && P && q.shop && sh) { const dq = Math.hypot(q.shop[0] - P.x, q.shop[2] - P.z); if (dq < Math.hypot(sh[0] - P.x, sh[2] - P.z)) { r.t = r.t.replace('the harbour shed', q.n).replace('the shed', q.n); r.mk = Object.assign({x: q.shop[0], z: q.shop[2], lab: q.n.toUpperCase()}, dq < 40 ? {y: q.shop[1] + .9, scr: 1} : {}); } }
  return r; }; }
// HUD: the autopilot pill, the mast light
function voyHud() {
  if (VOY.mastS) { VOY.mastS.material.opacity = (G.wt % 2) < .35 ? 1 : .08; VOY.lampS.material.opacity = typeof TOD === 'object' && TOD ? clamp(TOD.night * 1.4 + .15, 0, 1) * .9 : .5; }
  const now = performance.now(); if (now - VOY.pillT < 250) return; VOY.pillT = now;
  let el = VOY.pill; if (!el) { const st = document.createElement('style'); st.id = 'st-voy'; st.textContent = '#voyAp{position:absolute;left:22px;bottom:122px;font:bold 11px ui-monospace,monospace;letter-spacing:.14em;color:#bff1ff;background:rgba(2,16,24,.78);border:1px solid rgba(120,220,255,.55);border-radius:12px;padding:3px 11px;opacity:0;transition:opacity .4s;pointer-events:none;text-shadow:0 1px 2px #000}#voyAp.on{opacity:1}#voyAp.dim{opacity:.55;color:#c8d8dc;border-color:rgba(200,220,230,.2)}#hud.fly #voyAp{visibility:hidden}'; document.head.appendChild(st);
    el = VOY.pill = document.createElement('div'); el.id = 'voyAp'; ($('hud') || document.body).appendChild(el); }
  let t = '', cls = '';
  if (VOY.ap && VOY.tg) { const d = Math.hypot(VOY.tg[0] - B.x, VOY.tg[1] - B.z); t = `AUTOPILOT · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} · T to stop`; cls = 'on'; }
  else if (P && P.seat && G.voyWp) { t = 'T · AUTOPILOT TO COURSE'; cls = 'on dim'; }
  const sig = t + cls; if (sig !== VOY.pillS) { VOY.pillS = sig; if (t) el.textContent = t; el.className = cls; }
}
{ const f0 = hud; hud = function (...a) { const r = f0.apply(this, a); voyHud(); return r; }; }
// input: T toggles the autopilot at the wheel; W/A/S/D take back control; with the chart open the mouse moves the cursor (or pans), the wheel zooms, LMB sets the course and RMB clears it
addEventListener('keydown', e => { if (!G.on || G.paused || !P) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyT' && !e.repeat && P.seat && !anyPanel()) { voyApSet(!VOY.ap); return; }
  if (VOY.ap && !e.repeat && /^Key[WASD]$/.test(e.code)) voyApSet(false); }, {capture: true});
addEventListener('wheel', e => { if (!G.map || !G.on || G.paused) return; e.stopImmediatePropagation(); voyZoom(e.deltaY < 0 ? 1 : -1); }, {capture: true});
addEventListener('mousemove', e => { if (!G.map || !G.on || G.paused) return; e.stopImmediatePropagation(); const c = $('map'), W = c.width, k = W / (c.clientWidth || W);
  if (VOY.z) { const S = W / (voyR() * 2.077) * VOY_ZL[VOY.z]; VOY.cx += e.movementX * k / S; VOY.cz -= e.movementY * k / S; voyClampC(); } else VOY.cur = [clamp(VOY.cur[0] + e.movementX * k, 4, W - 4), clamp(VOY.cur[1] + e.movementY * k, 4, W - 4)];
  VOY.dirty = 1; }, {capture: true});
addEventListener('mousedown', e => { if (!G.map || !G.on || G.paused) return; e.stopImmediatePropagation(); e.preventDefault(); VOY.md = 1;
  if (e.button === 0) { G.voyWp = voyCursorWorld(); if (A.on) tone(1180, .04, .12, 'triangle'); } else if (e.button === 2) { G.voyWp = null; if (A.on) tone(520, .04, .12, 'triangle'); } VOY.dirty = 1; }, {capture: true});
addEventListener('mouseup', e => { if (VOY.md) { VOY.md = 0; e.stopImmediatePropagation(); } }, {capture: true});

// ---------------- gear: guns and fishing
const GEAR = {
  rod1: {n: 'Fishing rod', d: 'Learn to fish! Cast off the boat, a dock or a beach (key 3)', cost: 40, need: o => !o.rod},
  rod2: {n: 'Carbon rod', d: 'Quicker bites, gentler fights, better fish', cost: 150, need: o => o.rod === 1},
  rod3: {n: 'Deep-sea rod', d: 'Tuna, anglerfish and giant squid', cost: 350, need: o => o.rod === 2},
  glock: {n: 'Glock', d: '17-round pistol with a spare magazine (key 4)', cost: 120, need: o => !o.glock},
  ammo: {n: '9mm rounds x34', d: 'For the Glock', cost: 20, need: o => o.glock},
  sg: {n: 'Pump shotgun', d: 'Six in the tube plus 12 shells, hits hard up close (key 5)', cost: 260, need: o => !o.sg},
  shells: {n: 'Shotgun shells x12', d: 'For the shotgun', cost: 30, need: o => o.sg},
  scuba: {n: 'Scuba gear', d: 'Dive to 45 m with 3 minutes of air (hold C to dive, Space to rise, swim where you look)', cost: 260, need: o => !o.suit},
  sat: {n: 'Saturation suit', d: 'Hard-hat suit with a helmet lamp: 160 m and 9 minutes of air. The trenches are dark', cost: 1400, need: o => o.suit === 1},
  fw: {n: 'Firework rockets x5', d: 'Slot 7. Light up the night sky', cost: 60, need: o => true},
  sack1: {n: 'Big sack', d: 'Carry 7 slots of salvage instead of 4', cost: 90, need: o => !o.sack},
  sack2: {n: "Hauler's pack", d: 'Carry 10 slots of salvage', cost: 220, need: o => o.sack === 1},
};
const FISH = {
  boot: {n: 'old boot', v: 1, s: .4, kg: [.6, 1.2]}, sard: {n: 'sardine', v: 8, s: .55, kg: [.1, .3]}, mack: {n: 'mackerel', v: 15, s: .75, kg: [.4, 1.2]},
  bass: {n: 'sea bass', v: 28, s: 1, kg: [1, 4]}, cod: {n: 'cod', v: 35, s: 1.15, kg: [2, 8]}, eel: {n: 'moray eel', v: 45, s: 1.35, kg: [2, 6]},
  tuna: {n: 'bluefin tuna', v: 90, s: 1.8, kg: [40, 120]}, angler: {n: 'glowing anglerfish', v: 150, s: 1.6, kg: [3, 9]}, squid: {n: 'giant squid', v: 280, s: 2.4, kg: [90, 200]},
  bottle: {n: 'message in a bottle', v: 0, s: .4, kg: [.5, .6]},
  parrot: {n: 'reef parrotfish', v: 24, s: .9, kg: [1, 3]}, snapper: {n: 'red snapper', v: 40, s: 1.1, kg: [2, 6]}, icecod: {n: 'ice cod', v: 55, s: 1.25, kg: [4, 12]},
  ember: {n: 'ember eel', v: 70, s: 1.4, kg: [2, 5]}, ghostfish: {n: 'ghost fish', v: 120, s: 1.5, kg: [1, 3]}, oarfish: {n: 'giant oarfish', v: 320, s: 2.2, kg: [60, 150]},
};
function pickFish(x, z, rod) {
  const land = OBST.filter(o => o.c && o.r > 5).reduce((m, o) => Math.min(m, Math.hypot(x - o.x, z - o.z) - o.r), Math.hypot(x - CRZ.x, z - CRZ.z) - 60), deep = land > 150;
  const wreck = POIS.some(q => (q.wreck || q.rig) && Math.hypot(x - q.x, z - q.z) < 70), storm = G.storm > .5;
  const w = {boot: [0, 8, 4, 2][rod], sard: 30, mack: 22, bass: land < 60 ? 22 : 4, cod: deep ? 18 : 5, eel: wreck ? 20 : 1, tuna: deep && rod >= 2 ? 9 + rod * 2 : 0, angler: (storm || deep) && rod >= 2 ? 3 + rod : 0, squid: deep && rod >= 3 ? 3 : 0, bottle: DIGS.some(d => !d.rev) ? 2 : 0};
  // regional catches on top (home waters keep the old odds)
  const rg = mapRegion(x, z), rw = mapRegion.w, nt = TOD.night > .5; if (rg) { const k = rg.k; if (k === 'coral') { if (land < 60) w.parrot = 26 * rw; w.snapper = 16 * rw; } else if (k === 'frost') w.icecod = 22 * rw; else if (k === 'ash' && nt) w.ember = 16 * rw; else if (k === 'grave' && nt) w.ghostfish = 12 * rw; else if (k === 'abyss' && deep && rod >= 3) w.oarfish = 5 * rw; }
  let sum = 0; for (const k in w) sum += w[k]; let r = Math.random() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'sard';
}
function loadGear() { let g = null; try { g = JSON.parse(localStorage.getItem(SK('s9-gear'))); } catch (e) {} g = g || {}; P.own = Object.assign({rod: 0, glock: 0, sg: 0}, g.own || {}); P.ammo = Object.assign({g: 0, gm: 0, s: 0, sm: 0}, g.ammo || {}); }
function saveGear() { if (TEST) return; try { localStorage.setItem(SK('s9-gear'), JSON.stringify({own: P.own, ammo: P.ammo})); } catch (e) {} }
function gotGear(k) {
  const o = P.own, a = P.ammo; Snd.coin();
  if (k === 'fw') o.fw = (o.fw || 0) + 5; if (k.startsWith('aura')) { const i = +k.slice(4); o.auras = (o.auras || [0]).concat([i]); o.aura = i; }
  if (k === 'scuba') o.suit = 1; else if (k === 'sat') o.suit = 2;
  if (k === 'sack1') o.sack = 1; else if (k === 'sack2') o.sack = 2;
  if (k === 'rod1') o.rod = 1; else if (k === 'rod2') o.rod = 2; else if (k === 'rod3') o.rod = 3;
  else if (k === 'glock') { o.glock = 1; a.gm = 17; a.g += 17; } else if (k === 'ammo') a.g += 34;
  else if (k === 'sg') { o.sg = 1; a.sm = 6; a.s += 12; } else if (k === 'shells') a.s += 12;
  saveGear(); showMsg(`Bought: ${GEAR[k].n}.` + (k === 'rod1' ? ' Press 3 to take it out.' : k === 'glock' ? ' Press 4 to draw it.' : k === 'sg' ? ' Press 5 to take it out.' : ''), 'HARBOUR SHED', 3);
  setTimeout(drawShop, 50);
}
function showFishHelp(on) { G.helpOpen = on; $('fishHelp').classList.toggle('hidden', !on); if (on) { clearKeys(); try { document.exitPointerLock(); } catch (e) {} try { localStorage.setItem('s9-fishhelp', '1'); } catch (e) {} } else if (G.on && !G.shopOpen) lockMouse(); }
function equip(i) {
  if ((i === 5 || i === 6) && subInside()) { showMsg('Not in here.', '', 1.2); return; }
  if (i === 6 && !P.own.fw) { showMsg('No fireworks. The harbour shed sells them.', '', 2); return; }
  if (i === 5 && P.flares <= 0) { showMsg('No flares left. The harbour shed sells them.', '', 2.5); return; }
  if (i === 2 && !P.own.rod) { showMsg('You need a fishing rod. Buy one at the harbour shed.', '', 2.5); return; }
  if (i === 3 && !P.own.glock) { showMsg('You do not own a Glock. The harbour shed sells them.', '', 2.5); return; }
  if (i === 4 && !P.own.sg) { showMsg('You do not own a shotgun. The harbour shed sells them.', '', 2.5); return; }
  const eq = i; if (eq === P.eq) return; P.eq = eq; P.reload = 0; F.st = 'idle'; (Snd.equip || Snd.click)();
  if (eq === 2) { try { if (!localStorage.getItem('s9-fishhelp')) showFishHelp(true); } catch (e) {} }
}
// key slots: 1 hands, 2 rod (eq 2), 3 glock (eq 3), 4 shotgun (eq 4)
function toolDown() { if (!P) return;
  if (G.shopOpen || G.helpOpen || P.hd >= 0 || P.seat || P.down) return;
  if (subInside() && P.eq > 1) { showMsg('Not in here.', '', 1.2); return; }
  if (P.eq === 5) { throwFlare(); return; }
  if (P.eq === 6) { launchFw(); return; }
  if (P.eq === 3 || P.eq === 4) fire();
  else if (P.eq === 2) { if (F.st === 'idle') { if (P.sw) return; F.st = 'charge'; F.pow = 0; } else if (F.st === 'bite') hook(); else if (F.st === 'wait') { F.st = 'idle'; showMsg('You reel the line back in.', '', 1.5); } }
}
function toolUp() { if (!P) return; if (P.eq === 2 && F.st === 'charge') castLine(); }
function fire() {
  const w = P.eq === 3 ? 'g' : 's', A = P.ammo;
  if ((G.fireT || 0) > 0 || P.reload > 0 || P.sw) return;
  if (w === 'g' ? A.gm <= 0 : A.sm <= 0) { Snd.click(); if ((w === 'g' ? A.g : A.s) > 0) reload(); else showMsg('Out of ammo. The harbour shed sells more.', '', 2); return; }
  if (w === 'g') { A.gm--; G.fireT = .13; } else { A.sm--; G.fireT = .85; }
  saveGear();
  cam.getWorldDirection(_fw); const o = [cam.position.x, cam.position.y, cam.position.z];
  gunFx(o, w, true); P.pitch = clamp(P.pitch + (w === 'g' ? .02 : .06), -1.45, 1.45); G.recoil = 1;
  act({a: 'shoot', w, o: o.map(v => +v.toFixed(2)), d: [+_fw.x.toFixed(3), +_fw.y.toFixed(3), +_fw.z.toFixed(3)]});
}
function reload() {
  const A = P.ammo; if (P.reload > 0) return;
  if (P.eq === 3 && A.g > 0 && A.gm < 17) { P.reload = 1.4; P.rk = 'g'; Snd.reload(); }
  else if (P.eq === 4 && A.s > 0 && A.sm < 6) { P.reload = .55; P.rk = 's'; Snd.reload(); }
}
const gunL = new THREE.PointLight(0xffd090, 0, 18, 1.6); scene.add(gunL);
function gunFx(o, w, own) {
  gunL.position.set(o[0], o[1], o[2]); gunL.intensity = w === 'g' ? 30 : 60; G.gunFlash = .06;
  Snd.gun(w, own ? null : at(o[0], o[1], o[2], 8));
}
const HITS = [];
function hitFx(x, y, z, head, by) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x6aff9a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); s.position.set(x, y, z); s.scale.setScalar(head ? .9 : .6); scene.add(s); HITS.push({s, t: .25});
  Snd.hurt(at(x, y, z, 6));
  // your own hits: the crosshair kicks (red on a headshot) and a dry tick
  if (by && by === myId()) { const xh = $('xhair'); if (xh) { xh.classList.remove('h', 'hh'); xh.classList.add(head ? 'hh' : 'h'); clearTimeout(G.xhT); G.xhT = setTimeout(() => xh.classList.remove('h', 'hh'), 140); } Snd.hitTick(head); }
}
const _lo2 = {};
function hostShoot(p, m) {
  const o = m.o, d = m.d; if (!o || !d || p.down || p.dead) return;
  emit({k: 'shot', id: p.id, x: o[0], y: o[1], z: o[2], w: m.w}); noise(o[0], o[1] - 1.5, o[2], m.w === 'g' ? 60 : 80);
  const pel = m.w === 'g' ? [[0, 0, 0]] : Array.from({length: 8}, () => [(CR() - .5) * .1, (CR() - .5) * .1, (CR() - .5) * .1]);
  let dm = 0, hp = null, head = false, dd = 0; const HL = HC().L;
  // the first kill of each monster pays a bounty to the crew
  const bounty = (key, n) => { const St = G.stat || (G.stat = {}), Kf = St.k || (St.k = {}); if (Kf[key]) return; Kf[key] = 1; const c = Math.round(500 * (D.pay || 1)); G.cash += c; emit({k: 'bounty', n, c}); save(); };
  for (const j of pel) {
    let ux = d[0] + j[0], uy = d[1] + j[1], uz = d[2] + j[2]; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
    if (M.state !== 'dead' && M.state !== 'gone' && nearRig(M.x, M.z)) {
      const hh = ux * ux + uz * uz, t = hh > 1e-6 ? ((M.x - o[0]) * ux + (M.z - o[2]) * uz) / hh : 0;
      if (t > 0 && t < 70) {
        const px = o[0] + ux * t, py = o[1] + uy * t, pz = o[2] + uz * t, lo = M.y + .2, hi = M.y + ((M.four || 0) > .5 ? 1.5 : 2.75);
        if (Math.hypot(px - M.x, pz - M.z) < .45 && py > lo - .15 && py < hi + .15) {
          let blocked = false; for (const w of WALLS) { if (!w.see || w.y0 > py || w.y1 < py) continue; if (segRect(o[0], o[2], px, pz, w)) { blocked = true; break; } }
          if (!blocked) { const isHead = py > hi - .35, base = m.w === 'g' ? 10 : 7 * (t > 20 ? .4 : 1); dm += base * (isHead ? 2 : 1); head = head || isHead; hp = [px, py, pz]; }
        }
      }
    }
    if (G.enc) { const lp = levPose(G.enc.a, G.enc.el, G.enc.L || 9, _lo2), far = Math.hypot(lp.x - o[0], lp.z - o[2]) > 15;
      const hitS = (cx, cy, cz, r) => { const tt = (cx - o[0]) * ux + (cy - o[1]) * uy + (cz - o[2]) * uz; return tt > 0 && tt < 90 + HL && Math.hypot(o[0] + ux * tt - cx, o[1] + uy * tt - cy, o[2] + uz * tt - cz) < r; };
      const pd = m.w === 'g' ? 10 : far ? 3 : 6;
      if (lp.y > -1.2 && hitS(lp.x, lp.y + .5, lp.z, 3.2)) { dd += pd * (lp.ph === 1 ? 2.5 : 1); G.enc.hh = 1; }
      else if (lp.ph === 0) { let an = G.enc.a + G.enc.el * .45; for (let k = 1; k < 7; k++) { an -= 6.1 / levRad(an); const R = levRad(an); if (hitS(B.x + Math.sin(an) * R, -.3, B.z + Math.cos(an) * R, 2.6)) { dd += pd * .6; break; } } } }
  }
  if (STS.state !== 'dead' && STS.state !== 'gone' && Math.hypot(STS.x - o[0], STS.z - o[2]) < 70) {
    let sd = 0, sh = false, shp = null; for (const j of pel) { let ux = d[0] + j[0], uy = d[1] + j[1], uz = d[2] + j[2]; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l; const hh = ux * ux + uz * uz, t = hh > 1e-6 ? ((STS.x - o[0]) * ux + (STS.z - o[2]) * uz) / hh : 0;
      if (t <= 0 || t > 70) continue; const px = o[0] + ux * t, py = o[1] + uy * t, pz = o[2] + uz * t, hi = STS.y + 3.4; if (Math.hypot(px - STS.x, pz - STS.z) < .55 && py > STS.y && py < hi + .1 && seeLine(o[0], o[1] - 1.5, o[2], px, py - 1, pz)) { const head = py > hi - .45; sd += (m.w === 'g' ? 10 : 7 * (t > 20 ? .4 : 1)) * (head ? 2 : 1); sh = sh || head; shp = [px, py, pz]; } }
    if (sd) { const out = !inCruise(p.x, p.z, p.y); if (out) sd *= .35; STS.hp -= sd; emit({k: 'shit', x: +shp[0].toFixed(2), y: +shp[1].toFixed(2), z: +shp[2].toFixed(2), head: sh, by: p.id});
      if (STS.hp <= 0) { STS.state = 'dead'; STS.deadT = 4; emit({k: 'sdown', by: p.id}); const kd = KINDS.includes('mask') ? 'mask' : 'relic', it = addItem(kd, {x: STS.x + .5, y: STS.y, z: STS.z}); emit({k: 'item', i: it.i, kind: kd, x: STS.x + .5, y: STS.y, z: STS.z}); bounty('stw', 'The Steward'); }
      else if (out) { if (STS.state !== 'flee') { STS.state = 'flee'; STS.flee = 6; STS.aware = 0; const n = CN[CN.ok[Math.floor(CR() * CN.ok.length)]]; if (n) stwGo(n.x, n.y, n.z); emit({k: 'snd', s: 'shriekS'}); } }
      else if (STS.state !== 'chase') { STS.state = 'chase'; STS.tgt = p.id; STS.lx = p.x; STS.ly = p.y; STS.lz = p.z; STS.lost = 0; STS.aware = 1.5; STS.seenAt = G.t; STS.seenId = p.id; } }
  }
  if (dm) {
    // shooting from a boat or the dock does little, and it goes to ground behind a wall
    const far = !nearRig(p.x, p.z); if (far) dm *= .35;
    M.hp -= dm; emit({k: 'mhit', x: +hp[0].toFixed(2), y: +hp[1].toFixed(2), z: +hp[2].toFixed(2), head, by: p.id});
    if (M.hp <= 0) { M.state = 'dead'; M.deadT = 3.5; M.tgt = null; emit({k: 'mdown', by: p.id}); const it = addItem('fang', {x: M.x + .5, y: M.y, z: M.z}); emit({k: 'item', i: it.i, kind: 'fang', x: M.x + .5, y: M.y, z: M.z}); goal(6); bounty('rig', 'The thing on the rig'); }
    else if (far) { if (!(M.avoidT > 13)) { let cv = null; for (let k = 0; k < 12 && !cv; k++) { const q = randNode(null); if (!q) continue; const hy = q[1] + 1.5; if (WALLS.some(w => w.see && w.y0 <= hy && w.y1 >= hy && segRect(q[0], q[2], p.x, p.z, w))) cv = q; }
      const q = cv || randNode(null); if (q) goTo(q[0], q[1], q[2]); Object.assign(M, {state: 'roam', avoidT: 15, tgt: null, aware: 0, idle: 4, notT: 0, wind: 0, lunge: 0}); emit({k: 'snd', s: 'lunge'}); } }
    else if (M.state !== 'chase') { M.state = 'chase'; M.tgt = p.id; M.aware = 1.5; M.lx = p.x; M.ly = p.y; M.lz = p.z; M.lostT = 0; M.seenAt = G.t; emit({k: 'snd', s: 'stinger'}); }
  }
  if (dd && G.enc) { G.enc.hp -= dd; const lp = levPose(G.enc.a, G.enc.el, G.enc.L || 9, _lo2); emit({k: 'dhit', x: +lp.x.toFixed(1), y: +Math.max(0, lp.y).toFixed(1), z: +lp.z.toFixed(1), h: G.enc.hh ? 1 : 0, by: p.id}); G.enc.hh = 0;
    if (G.enc.hp <= 0) { G.enc = null; G.deepT = 150 + CR() * 90; emit({k: 'deepgone', dead: 1, by: p.id}); let i = G.floats.findIndex((q, j) => !q && j < 16); if (i < 0) { let bd = -1; for (let j = 0; j < 16; j++) { const q = G.floats[j], d = q ? Math.hypot(q[0] - B.x, q[1] - B.z) : 1e9; if (d > bd) { bd = d; i = j; } } }
      const sk = KINDS.indexOf('spine'); if (i >= 0) G.floats[i] = [lp.x, lp.z, sk >= 0 ? sk : KINDS.indexOf('relic')]; bounty('lev', 'The deep'); } }
}
// fishing (each player fishes on their own screen; the host only records the catch)
const F = {st: 'idle', pow: 0, t: 0, ten: 0, prog: 0, k: null, slack: 0, bob: null, surge: 0, surgeT: 0};
function castLine() {
  cam.getWorldDirection(_fw); const sp = 5 + F.pow * 15;
  F.bob = {x: cam.position.x + _fw.x, y: cam.position.y, z: cam.position.z + _fw.z, vx: _fw.x * sp, vy: _fw.y * sp + 4, vz: _fw.z * sp}; F.st = 'cast'; Snd.cast();
}
function hook() { F.k = pickFish(F.bob.x, F.bob.z, P.own.rod); F.st = 'reel'; F.ten = 45; F.prog = 8; F.slack = 0; F.surgeT = 1; F.surge = 0; F.ph = Math.random() * 6; F.sx = F.bob.x; F.sz = F.bob.z; Snd.hook(); }
function stepGear(dt) {
  if (!P || !P.own) return;
  G.fireT = (G.fireT || 0) - dt;
  if (P.reload > 0) { P.reload -= dt; if (P.reload <= 0) { const A = P.ammo; if (P.rk === 'g') { const n = Math.min(17 - A.gm, A.g); A.gm += n; A.g -= n; } else if (A.s > 0) { A.sm++; A.s--; if (A.sm < 6 && A.s > 0 && P.eq === 4) { P.reload = .55; Snd.reload(); } } saveGear(); } }
  if (P.eq !== 2 || P.seat || P.down || P.dead) { if (F.st !== 'idle') F.st = 'idle'; return; }
  const rod = P.own.rod;
  switch (F.st) {
    case 'charge': F.pow = Math.min(1, F.pow + dt / 1.2); break;
    case 'cast': { const b = F.bob; b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const fl = floorAt(b.x, b.z, b.y);
      if (fl && fl.y > -1.3 && b.y <= fl.y + .05) { F.st = 'idle'; showMsg(fl.s.k === 'boat' ? 'That landed on the deck. Cast out over the rail.' : 'That landed on dry ground. Cast into open water.', '', 2.5); break; }
      if (b.y <= 0) { if (fl && fl.y > -1.6) { F.st = 'idle'; showMsg('Too shallow here. Cast further out.', '', 2.5); break; } F.st = 'wait'; F.t = (5 + Math.random() * 9) / (1 + .35 * (rod - 1)); Snd.splash(at(b.x, 0, b.z, 3)); }
      if (Math.hypot(b.x - P.x, b.z - P.z) > 45) F.st = 'idle'; break; }
    case 'wait': F.t -= dt; if (F.t <= 0) { F.st = 'bite'; F.t = 1.1 + .2 * rod; Snd.bite(); } break;
    case 'bite': F.t -= dt; if (F.t <= 0) { F.st = 'wait'; F.t = 4 + Math.random() * 6; showMsg('It took the bait and got away. Click faster when you see !', '', 2.5); } break;
    case 'reel': {
      const f = FISH[F.k], kf = [1, 1, .72, .52][rod];
      F.surgeT -= dt; if (F.surgeT <= 0) { F.surge = .5 + Math.random() * .8; F.surgeT = (1.5 + Math.random() * 2.5) / f.s; }
      F.surge = Math.max(0, F.surge - dt);
      const pull = f.s * (.5 + .5 * Math.sin(G.wt * 2.3 + F.ph)) + (F.surge > 0 ? f.s * 1.6 : 0);
      if (G.lmb) F.ten += dt * (50 + pull * 30) * kf; else F.ten -= dt * 48;
      if (F.surge > 0) F.ten += dt * 40 * f.s * kf;
      const inZ = F.ten >= 30 && F.ten <= 75;
      F.prog += dt * (inZ ? (G.lmb ? 24 : 7) / f.s : F.ten > 75 ? 3 / f.s : -7);
      F.prog = Math.max(0, F.prog);
      if (G.lmb && Math.random() < dt * 8) Snd.tick();
      if (F.ten >= 100) { F.st = 'idle'; Snd.snap(); showMsg('SNAP! The line broke. Ease off when the needle jumps.', '', 3); }
      else if (F.ten <= 0) { F.ten = 0; F.slack += dt; if (F.slack > 1.6) { F.st = 'idle'; showMsg('Too much slack. It slipped the hook.', '', 2.5); } } else F.slack = 0;
      if (F.prog >= 100) { F.st = 'idle'; const kg = +(f.kg[0] + Math.random() * (f.kg[1] - f.kg[0])).toFixed(1), full = (P.coolerN || 0) >= ([0, 8, 12, 18][P.own.rod] || 8); act({a: 'fish', f: F.k, kg, rod: P.own.rod}); Snd.discover(); if (F.k !== 'bottle') toast(`${f.n}`, full ? `${kg} kg · cooler full` : `${kg} kg · +${money(fishVal(F.k, P.x, P.z))}`); }
      const k = Math.min(1, F.prog / 100); F.bob.x = mix(F.sx, P.x, k * .9); F.bob.z = mix(F.sz, P.z, k * .9);
      break;
    }
  }
}
// viewmodels: glock, shotgun, rod + line + bobber
const VMG = new THREE.Group(), VMS = new THREE.Group(), VMR = new THREE.Group(); cam.add(VMG, VMS, VMR);
let ROD_TIP = null, LINE = null, BOB = null, MFLASH = null;
(function toolModels() {
  const blk = new THREE.MeshStandardMaterial({color: 0x1a1c1e, metalness: .6, roughness: .35}), glove = new THREE.MeshStandardMaterial({color: 0xc8a020, roughness: .6}), wood = new THREE.MeshStandardMaterial({color: 0x5a3a22, roughness: .6});
  const add = (g, geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  add(VMG, new THREE.BoxGeometry(.032, .036, .19), blk, 0, .02, -.05); add(VMG, new THREE.BoxGeometry(.03, .1, .045), blk, 0, -.04, .02, -.25); add(VMG, new THREE.SphereGeometry(.04, 8, 6), glove, 0, -.05, .04);
  VMG.position.set(.16, -.16, -.34); VMG.scale.setScalar(1.35); VMS.scale.setScalar(1.15);
  add(VMS, new THREE.CylinderGeometry(.013, .013, .75, 8), blk, 0, .02, -.3, PI / 2); add(VMS, new THREE.CylinderGeometry(.02, .02, .2, 8), wood, 0, -.012, -.3, PI / 2); add(VMS, new THREE.BoxGeometry(.045, .07, .25), wood, 0, -.03, .12); add(VMS, new THREE.BoxGeometry(.04, .05, .14), blk, 0, 0, -.02);
  add(VMS, new THREE.SphereGeometry(.04, 8, 6), glove, 0, -.04, -.32); add(VMS, new THREE.SphereGeometry(.04, 8, 6), glove, .01, -.05, .02);
  VMS.position.set(.17, -.19, -.38);
  const rod = new THREE.Group(); VMR.add(rod); rod.rotation.x = -.95; const fib = new THREE.MeshStandardMaterial({color: 0xd8b040, roughness: .4, metalness: .2});
  add(rod, new THREE.CylinderGeometry(.018, .022, .3, 8), wood, 0, 0, 0); add(rod, new THREE.CylinderGeometry(.005, .011, 1.7, 6), fib, 0, .98, 0); add(rod, new THREE.CylinderGeometry(.035, .035, .04, 10), blk, .04, .08, 0, 0).rotation.z = PI / 2;
  ROD_TIP = new THREE.Object3D(); ROD_TIP.position.set(0, 1.83, 0); rod.add(ROD_TIP); VMR.userData.rod = rod;
  add(VMR, new THREE.SphereGeometry(.045, 8, 6), glove, 0, -.02, 0);
  VMR.position.set(.3, -.34, -.45);
  MFLASH = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow || null, color: 0xffd080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})); MFLASH.scale.setScalar(.25); MFLASH.visible = false; cam.add(MFLASH);
  for (const g of [VMG, VMS, VMR]) { g.visible = false; g.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  LINE = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color: 0xdddddd, transparent: true, opacity: .6})); LINE.frustumCulled = false; scene.add(LINE);
  BOB = new THREE.Group(); const bw = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshStandardMaterial({color: 0xeeeeee})), br = new THREE.Mesh(new THREE.SphereGeometry(.071, 10, 8, 0, TAU, 0, PI / 2), new THREE.MeshStandardMaterial({color: 0xd02010, emissive: 0x300000})); BOB.add(bw, br); scene.add(BOB);
})();
function updateTools(dt) {
  const own = alivePlay() && P.hd < 0 && !P.seat && !P.down && !P.sw;
  VMG.visible = own && P.eq === 3; VMS.visible = own && P.eq === 4; VMR.visible = own && P.eq === 2;
  G.recoil = Math.max(0, (G.recoil || 0) - dt * 6); const rc = G.recoil || 0, rl = P.reload > 0 ? Math.sin(Math.min(1, P.reload) * PI) : 0;
  VMG.position.set(.16, -.16 - rl * .12, -.34 + rc * .05); VMG.rotation.x = rc * .3 - rl * .6;
  VMS.position.set(.17, -.19 - rl * .08, -.38 + rc * .1); VMS.rotation.x = rc * .25;
  const aim = mouseR && own && P.eq >= 3; G.aimK = mix(G.aimK || 0, aim ? 1 : 0, Math.min(1, dt * 10));
  if (G.aimK > .01) { VMG.position.x = mix(.16, 0, G.aimK); VMG.position.y += G.aimK * .05; VMS.position.x = mix(.17, 0, G.aimK); VMS.position.y += G.aimK * .07; }
  G.runK = mix(G.runK || 0, P && P.run ? 1 : 0, Math.min(1, dt * 4)); const fov = mix((SET.fov || 70) + G.runK * 6 + (G.fovAdd || 0) - (G.js && G.js.t > 0 ? 12 : 0), 52, G.aimK); if (Math.abs(cam.fov - fov) > .05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  $('xhair').classList.toggle('hidden', !(own && P.eq >= 3));
  G.gunFlash = (G.gunFlash || 0) - dt; gunL.intensity = G.gunFlash > 0 ? gunL.intensity : 0;
  if (VMF.visible && G.gunFlash <= 0) { VMF.userData.tip.getWorldPosition(gunL.position); gunL.color.setHex(0xff3018); gunL.intensity = 14 * (.8 + Math.random() * .4); gunL.distance = 22; VMF.userData.tip.scale.setScalar(.8 + Math.random() * .5); if (Math.random() < dt * 3) Snd.flare && Math.random() < .3 && Snd.flare(null); }
  else if (G.gunFlash > 0) gunL.color.setHex(0xffd090);
  if (!MFLASH.material.map && TX.glow) { MFLASH.material.map = TX.glow; MFLASH.material.needsUpdate = true; }
  MFLASH.visible = G.gunFlash > 0 && own && P.eq >= 3; if (MFLASH.visible) MFLASH.position.copy(P.eq === 3 ? VMG.position : VMS.position).add(_v.set(0, .02, P.eq === 3 ? -.17 : -.7));
  for (let i = HITS.length - 1; i >= 0; i--) { const h = HITS[i]; h.t -= dt; h.s.material.opacity = Math.max(0, h.t * 4); if (h.t <= 0) { scene.remove(h.s); HITS.splice(i, 1); } }
  // rod, bobber and line
  const fishing = own && P.eq === 2 && F.st !== 'idle' && F.st !== 'charge' && F.bob;
  VMR.userData.rod.rotation.x = -.95 + (F.st === 'charge' ? F.pow * .9 : 0) + (F.st === 'reel' ? -.25 - Math.sin(G.wt * 20) * .02 * F.ten / 50 : 0);
  BOB.visible = !!fishing; LINE.visible = !!fishing && VMR.visible;
  if (fishing) {
    const b = F.bob, wy = F.st === 'cast' ? b.y : waveH(b.x, b.z, G.wt) - (F.st === 'bite' ? .18 + Math.sin(G.wt * 18) * .06 : F.st === 'reel' ? .1 : 0);
    BOB.position.set(b.x, wy, b.z); cam.updateMatrixWorld(); ROD_TIP.getWorldPosition(_v);
    const pa = LINE.geometry.attributes.position; pa.setXYZ(0, _v.x, _v.y, _v.z); pa.setXYZ(1, b.x, wy, b.z); pa.needsUpdate = true;
  }
  const ui = $('fishUI'), show = own && P.eq === 2 && F.st !== 'idle' && F.st !== 'cast';
  ui.classList.toggle('hidden', !show);
  if (show) {
    const t = $('fishT'); t.className = F.st === 'bite' ? 'bite' : '';
    t.textContent = F.st === 'charge' ? 'Casting power: let go to cast' : F.st === 'wait' ? 'Waiting for a bite… (click to reel in)' : F.st === 'bite' ? '! CLICK !' : 'Hold to reel, let go to ease off. Keep it in the green.';
    $('tenBar').style.display = F.st === 'reel' ? 'block' : 'none';
    $('progBar').style.display = F.st === 'reel' || F.st === 'charge' ? 'block' : 'none';
    $('progFill').style.width = (F.st === 'charge' ? F.pow * 100 : Math.min(100, F.prog)) + '%';
    $('tenNeedle').style.left = clamp(F.ten, 0, 100) + '%';
  }
  // hud tool line
  const A = P.ammo || {}, own2 = P.own || {};
  const S7 = [[ICON.hand, 'Hands', 1, ''], [ICON.light, 'Flashlight', 1, P.l ? '' : 'off'], [ICON.rod, ['', 'Rod', 'Carbon rod', 'Deep-sea rod'][own2.rod || 0], own2.rod, ''], [ICON.pistol, 'Glock', own2.glock, `${A.gm}/${A.g}`], [ICON.shotgun, 'Shotgun', own2.sg, `${A.sm}/${A.s}`], [ICON.flare, 'Flare', P.flares > 0, P.flares], [ICON.rocket, 'Fireworks', own2.fw > 0, own2.fw]];
  const cur = S7[P.eq] || [], hk = P.eq + '|' + S7.map(q => q[2] ? 1 : 0).join('') + '|' + cur[3] + '|' + (P.reload > 0) + '|' + (P.coolerN || 0);
  if (hk !== G.toolK) { G.toolK = hk; $('tool').innerHTML = `<div id="toolN">${cur[2] ? cur[1] + (cur[3] !== '' ? ' ' + cur[3] : '') : ''}</div>` + S7.map((q, i) => q[2] ? `<b class="${P.eq === i ? 'on' : ''}"><em>${i + 1}</em>${q[0]}${P.eq === i ? ` <span>${q[1]}${q[3] !== '' ? ' ' + q[3] : ''}</span>` : ''}</b>` : '').join('') + (P.reload > 0 ? '<span class="rl">reloading</span>' : '') + (P.coolerN ? `<span class="rl">${ICON.fish} ${P.coolerN}</span>` : ''); }
}

// ---------------- loop: contracts on the job board, a receipt that counts up, streaks, night shifts and the journal
const JOB_SKIP = ['fuel', 'netfish'];
const JOB_LEG = [{f: 'tuna', kg: 110, n: 'The Old Blue', pay: 2500}, {f: 'squid', kg: 185, n: 'Grandfather Squid', pay: 4000}, {f: 'angler', kg: 8.4, n: 'The Lantern Queen', pay: 3000}, {f: 'eel', kg: 5.6, n: 'Old Moray', pay: 1500}, {f: 'cod', kg: 7.6, n: 'King Cod', pay: 1200}];
const JOB_SETS = [{n: 'Every catch', v: 1500}, {n: 'Every treasure', v: 2000}, {n: 'Every creature beaten', v: 2500}, {n: 'Six hulls', v: 1500}];
const jobOwn = () => Array.isArray(B.up.own) ? B.up.own : [0], jobSuit = n => [...PL.values()].some(p => suitOf(p) >= n);
const jobCzOk = () => POIS.some((q, i) => q.cruise && G.disc.includes(i));
// templates per tier: r 0 safe, 1 risky, 2 deadly; pay before multipliers (+ d / pd for places and parcels, d = metres from home)
const JOB_T = [
  {r: 0, t: 'haul', k: 'crate', n: 3, pay: 120}, {r: 0, t: 'haul', k: 'scrap', n: 4, pay: 90}, {r: 0, t: 'fish', k: 'mack', n: 3, pay: 90}, {r: 0, t: 'fish', k: 'bass', n: 2, pay: 120},
  {r: 0, t: 'chart', d0: 0, d1: 900, pay: 70, pd: 12}, {r: 0, t: 'cour', d0: 150, d1: 900, pay: 100, pd: 10},
  {r: 1, t: 'haul', k: 'relic', n: 1, pay: 220}, {r: 1, t: 'haul', k: 'pearl', n: 2, pay: 240}, {r: 1, t: 'haul', k: 'gold', n: 1, pay: 260}, {r: 1, t: 'haul', k: 'chest', n: 1, pay: 280},
  {r: 1, t: 'fish', k: 'cod', n: 2, pay: 170}, {r: 1, t: 'fish', k: 'eel', n: 1, pay: 190}, {r: 1, t: 'fish', k: 'tuna', n: 1, pay: 380, ok: () => G.stat.fish >= 3},
  {r: 1, t: 'chart', d0: 900, d1: 1800, pay: 140, pd: 12}, {r: 1, t: 'cour', d0: 900, d1: 1800, pay: 180, pd: 9},
  {r: 1, t: 'dive', n: 25, pay: 200, ok: () => jobSuit(1) || G.stat.maxDv >= 8}, {r: 1, t: 'sunk', n: 1, pay: 300, ok: () => HULLS.some((H, i) => H.sub && jobOwn().includes(i)) || G.stat.maxDv >= 8},
  {r: 2, t: 'deepfl', n: 1, pay: 320}, {r: 2, t: 'deepk', n: 1, pay: 850}, {r: 2, t: 'rig', n: 1, pay: 650}, {r: 2, t: 'stw', n: 1, pay: 1000, ok: jobCzOk},
  {r: 2, t: 'fish', k: 'angler', n: 1, pay: 520, ok: () => G.stat.fish >= 6}, {r: 2, t: 'fish', k: 'squid', n: 1, pay: 950, ok: () => G.stat.fish >= 6},
  {r: 2, t: 'chart', d0: 1800, d1: 1e9, pay: 240, pd: 12, far: 1}, {r: 2, t: 'cour', d0: 1500, d1: 1e9, pay: 350, pd: 8, nt: 1},
  {r: 2, t: 'haul', k: 'blackbox', n: 1, pay: 500, ok: () => !G.bbOut || B.hold.includes('blackbox') || [...PL.values()].some(p => (p.sack || []).includes('blackbox'))},
  {r: 2, t: 'haul', k: 'mask', n: 1, pay: 700, ok: jobCzOk}, {r: 2, t: 'haul', k: 'spine', n: 1, pay: 600},
  {r: 2, t: 'dive', n: 100, pay: 900, ok: () => jobSuit(2)},
];
// the parcel you carry for courier jobs
KINDS.push('parcel'); NAMES.parcel = 'parcel'; SZ.parcel = 2; CARRY.add('parcel');
const jobB = () => isHost() ? (G.stat && G.stat.job) : G.jobsS;
const jobCap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const jobPl = (k, n) => { const w = (NAMES[k] || k).replace(/^Steward's /, ''); return n > 1 && !/fish|scrap|mackerel|cod|bass|tuna|squid/.test(w) ? w + (/x$/.test(w) ? 'es' : 's') : w; };
const jobNight = () => { const t = ((G.tod % 1) + 1) % 1; let i = 0; while (i < TODK.length - 2 && TODK[i + 1][0] < t) i++; const a = TODK[i], b = TODK[i + 1], u = clamp((t - a[0]) / ((b[0] - a[0]) || 1), 0, 1), k = u * u * (3 - 2 * u); return 1 - clamp((a[1] + (b[1] - a[1]) * k + 22) / 18, 0, 1); };
const jobMul = s => { const J = jobB(); return (1 + .1 * Math.min((J && J.st) || 0, 5)) * (s && s.daily ? 1.5 : 1); };
const jobDay = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
function jobLeg(wk) { const L = JOB_LEG.filter(q => FISH[q.f]); for (const k in FISH) if (FISH[k].kg[1] >= 100 && !L.some(q => q.f === k)) L.push({f: k, kg: +(FISH[k].kg[1] * .92).toFixed(1), n: 'The great ' + FISH[k].n, pay: 5000}); return L[Math.floor(mulberry(wk * 7919)() * L.length)] || null; }
function jobTitle(s) {
  if (!s || s.e) return ''; const F = FISH[s.k];
  switch (s.t) {
    case 'haul': return `Haul ${s.n} ${jobPl(s.k, s.n)}`; case 'fish': return `Land ${s.n > 1 ? s.n + ' ' : 'a '}${F ? F.n : s.k}`; case 'chart': return `Chart ${s.k}`; case 'cour': return `Parcel to ${s.k}`;
    case 'dive': return `Dive to ${s.n} m`; case 'sunk': return 'Raise sunken treasure'; case 'deepfl': return 'Drive off the deep'; case 'deepk': return 'Kill the deep'; case 'rig': return 'Put down the thing on the rig'; case 'stw': return 'Put down the Steward'; case 'leg': return s.nm || 'Legend';
  } return '';
}
function jobDesc(s) {
  const fh = {mack: 'Open water near home', bass: 'Close to island shores', cod: 'Deep water far from land', eel: 'Around wrecks and the rig', tuna: 'Deep water, carbon rod or better', angler: 'Far out at night or in a storm', squid: 'Far out, deep-sea rod'};
  switch (s.t) {
    case 'haul': return 'Sell them at any shed'; case 'fish': return fh[s.k] || 'Find where they bite'; case 'chart': return 'Sail close enough to chart it'; case 'cour': return s.nt ? 'x1.6 if delivered at night' : 'Carry it there, then E';
    case 'dive': return s.n >= 100 ? 'Saturation suit only' : 'Scuba gear goes to 45 m'; case 'sunk': return 'Dive for it or use the claw'; case 'deepfl': return 'A flare in the sea, far out'; case 'deepk': return 'Shoot it when it rears up';
    case 'rig': return 'Station Nine. Bring a gun'; case 'stw': return 'MS Serenade, below decks';
  } return '';
}
function jobGen(r) {
  const J = G.stat.job, rnd = mulberry((G.seed ^ 0x10b5) + 7919 * J.n++), id = J.n, cur = J.b.filter(q => q && !q.e), dH = (x, z) => Math.hypot(x - HOME.x, z - HOME.z);
  const L = JOB_T.filter(T => T.r === r && (!T.ok || T.ok()) && (T.t !== 'haul' || VALUE[T.k]) && (T.t !== 'fish' || FISH[T.k]));
  while (L.length) {
    const T = L.splice(Math.floor(rnd() * L.length), 1)[0], s = {id, r, t: T.t, k: T.k || null, n: T.n || 1, got: 0, pay: T.pay, x: null, y: null, z: null, d: '', act: 0, daily: 0, born: G.t, refT: 0};
    if (T.t === 'chart') { const C = POIS.filter((q, i) => !q.home && !G.disc.includes(i) && !cur.some(o => o.t === 'chart' && o.k === q.n) && (T.far ? dH(q.x, q.z) > 1800 || q.dive || q.cruise : dH(q.x, q.z) >= T.d0 && dH(q.x, q.z) < T.d1)); if (!C.length) continue;
      const q = C[Math.floor(rnd() * C.length)]; Object.assign(s, {k: q.n, x: q.x, z: q.z, pay: Math.round(T.pay + dH(q.x, q.z) / T.pd)}); }
    else if (T.t === 'cour') { const C = (jobDests.L || []).filter(q => dH(q.x, q.z) >= T.d0 && dH(q.x, q.z) < T.d1 && !cur.some(o => o.t === 'cour' && o.k === q.n)); if (!C.length) continue;
      const q = C[Math.floor(rnd() * C.length)]; Object.assign(s, {k: q.n, x: q.x, y: q.y, z: q.z, pay: Math.round(T.pay + dH(q.x, q.z) / T.pd), nt: T.nt || 0}); }
    else if (cur.some(o => o.t === s.t && o.k === s.k)) continue;
    else if (T.t === 'rig') { const q = POIS.find(q => q.rig); if (q) { s.x = q.x; s.z = q.z; } }
    else if (T.t === 'stw') { s.x = CRZ.x; s.z = CRZ.z; }
    s.d = jobDesc(s).slice(0, 40); return s;
  }
  return {id, r, t: 'haul', k: 'crate', n: 3, got: 0, pay: 120 + 60 * r, x: null, y: null, z: null, d: jobDesc({t: 'haul'}), act: 0, daily: 0, born: G.t, refT: 0};
}
// where parcels go: huts, the rig dock, wreck decks, the Serenade, piers and trading posts (if those exist)
function jobDests() {
  const L = [], add = (n, x, y, z) => { if ([x, y, z].every(Number.isFinite) && !L.some(q => q.n === n)) L.push({n: String(n).slice(0, 22), x: +(+x).toFixed(2), y: +(+y).toFixed(2), z: +(+z).toFixed(2)}); };
  for (const b of BLD) if (b.kind === 'hut' && b.din) { let I = null, bd = 1e9; for (const q of ISLES) { const d = Math.hypot(q.x - b.x, q.z - b.z); if (d < bd) { bd = d; I = q; } } add((I ? I.n : 'Island') + ' hut', b.din[0], b.fy, b.din[1]); }
  add('Station Nine dock', 0, LV[0], -19.5);
  for (const q of POIS) if (q.wreck) add(q.n, q.x, 2.2, q.z + 4);
  add('MS Serenade', CRZ.x, CRZ.D1, CRZ.z + 50);
  if (typeof PIERS !== 'undefined' && Array.isArray(PIERS)) for (const q of PIERS) if (q) add((q.n || 'Island') + ' pier', q.x, q.y ?? 1.8, q.z);
  if (typeof VOY_PORTS !== 'undefined' && Array.isArray(VOY_PORTS)) for (const q of VOY_PORTS) { if (!q) continue; const s = Array.isArray(q.shop) ? q.shop : [q.x, q.y ?? 2, q.z]; add(q.n || 'Trading post', s[0], s[1], s[2]); }
  jobDests.L = L; return L;
}
function jobRank() { const r = titleOf(G.earned); if (r > (G.rankI || 0)) { G.rankI = r; emit({k: 'rank', i: r}); } }
const jobEmpty = i => ({e: 1, r: i, refT: G.t + 40, daily: 0});
function jobPay(i, x) {
  const J = G.stat.job, s = i === 3 ? x : J.b[i]; if (!s || s.e) return;
  const nt = s.nt && jobNight() > .5 ? 1.6 : 1, v = Math.round(s.pay * (D.pay || 1) * (1 + .1 * Math.min(J.st, 5)) * (s.daily ? 1.5 : 1) * nt);
  G.cash += v; G.earned += v; J.st++;
  if (i < 3) J.b[i] = jobEmpty(i);
  emit({k: 'jobok', i, v, st: J.st, t: jobTitle(s), lg: i === 3 ? 1 : 0, nt: nt > 1 ? 1 : 0}); jobRank(); J.v++; save();
}
function jobFail(i, why) { const J = G.stat.job, s = J.b[i]; if (!s || s.e) return; J.st = 0; J.b[i] = jobEmpty(i); emit({k: 'jobf', i, why, t: jobTitle(s)}); J.v++; save(); }
function jobParcels() { let n = 0; for (const p of PL.values()) for (const k of p.sack || []) if (k === 'parcel') n++; for (const k of B.hold) if (k === 'parcel') n++; for (const it of ITEMS) if (it.kind === 'parcel' && !it.taken) n++; const pi = KINDS.indexOf('parcel'); for (const f of G.floats) if (f && f[2] === pi) n++; return n; }
// host, 2 Hz: dives, lost parcels, refills, the daily board and the weekly legend
function jobStep(dt) {
  const J = G.stat && G.stat.job; if (!J || !isHost()) return;
  if (G.t < (G.jobT || 0)) return; G.jobT = G.t + .5; J.gt = G.t; let ch = 0;
  if (M.state === 'chase') jrnAdd('c', 'rig', 1); if (STS.state === 'chase') jrnAdd('c', 'stw', 1);
  for (let i = 0; i < 3; i++) { const s = J.b[i]; if (!s || s.e || !s.act || s.t !== 'dive') continue; let dv = 0; for (const p of PL.values()) if (p.ready && !p.dead && p.sw) dv = Math.max(dv, p.dv || 0); if (dv >= s.n) jobPay(i); else if (Math.floor(dv) > s.got) { s.got = Math.floor(dv); J.v++; } }
  const cs = []; for (let i = 0; i < 3; i++) { const s = J.b[i]; if (s && !s.e && s.act && s.t === 'cour') cs.push(i); }
  if (cs.length) { const n = jobParcels(); if (n < cs.length) { cs.sort((a, b) => (J.b[b].tk || 0) - (J.b[a].tk || 0)); for (let k = 0; k < cs.length - n; k++) jobFail(cs[k], 'The parcel was lost.'); } }
  for (let i = 0; i < 3; i++) { const s = J.b[i], gone = s && !s.e && !s.act && ((s.t === 'chart' && POIS.some((q, j) => q.n === s.k && G.disc.includes(j))) || G.t - (s.born || 0) > 2 * TOD_LEN);
    if (!s || s.r !== i || (s.e && G.t >= s.refT) || gone) { const d = (gone && s.daily) || (i === 1 && J.dp && (!s || s.e)); J.b[i] = jobGen(i); if (d) { J.b[i].daily = 1; if (i === 1) J.dp = 0; } ch = 1; } }
  if (G.t >= (G.jobDayT || 0)) { G.jobDayT = G.t + 60; const day = jobDay(), wk = Math.floor((day + 3) / 7);
    if (J.day !== day) { const first = J.day == null; J.day = day; for (let i = 0; i < 3; i++) { const s = J.b[i]; if (s && !s.e && !s.act) J.b[i] = jobGen(i); } J.dp = 0; if (J.b[1] && !J.b[1].e && !J.b[1].act) J.b[1].daily = 1; else J.dp = 1; ch = 1; if (!first) emit({k: 'jobst', day: 1}); }
    if (J.wk !== wk || !J.lg) { J.wk = wk; J.lg = jobLeg(wk); ch = 1; } }
  jrnSets(); if (ch) { J.v++; save(); }
}
// host, after an event lands: progress, payouts, the night shift and journal entries
function jobHook(e) {
  const J = G.stat.job, R = G.stat.jr; if (!J) return;
  const each = (t, f) => { for (let i = 0; i < 3; i++) { const s = J.b[i]; if (s && !s.e && s.act && s.t === t) f(s, i); } };
  const prog = (s, i, add, lab) => { s.got = Math.min(s.n, s.got + add); if (s.got >= s.n) jobPay(i); else { emit({k: 'jobp', i, n: s.got, of: s.n, l: lab}); J.v++; save(); } };
  switch (e.k) {
    case 'sold': if (e.v > 0 && jobNight() > .5) { const b = Math.round(e.v * .25); G.cash += b; G.earned += b; emit({k: 'jobnb', v: b}); jobRank(); }
      each('haul', (s, i) => { const n = (e.c && e.c[s.k]) || 0; if (n > 0) prog(s, i, n, jobCap(jobPl(s.k, 2))); }); for (const k in e.c || {}) if (k !== 'fish') jrnAdd('t', k); break;
    case 'catch': { each('fish', (s, i) => { if (s.k === e.f) prog(s, i, 1, jobCap(FISH[s.k] ? FISH[s.k].n : s.k)); }); jrnAdd('f', e.f, +e.kg || 0);
      const L = J.lg; if (L && titleOf(G.earned) >= 2 && J.leg !== J.wk && e.f === L.f && +e.kg >= L.kg) { J.leg = J.wk; jobPay(3, {t: 'leg', nm: L.n, pay: L.pay}); } break; }
    case 'disc': { const q = POIS[e.i]; if (q) each('chart', (s, i) => { if (s.k === q.n) jobPay(i); }); break; }
    case 'sunk': case 'sunkp': { const k = e.kind || (SUNK[e.i] && SUNK[e.i].kind); each('sunk', (s, i) => prog(s, i, 1, 'Sunken treasure')); if (k) jrnAdd('t', k); break; }
    case 'deepgone': if (e.fl) each('deepfl', (s, i) => jobPay(i)); if (e.dead) { each('deepk', (s, i) => jobPay(i)); jrnAdd('c', 'deep', 2); } break;
    case 'circle': jrnAdd('c', 'deep', 1); break;
    case 'mdown': each('rig', (s, i) => jobPay(i)); jrnAdd('c', 'rig', 2); break;
    case 'sdown': each('stw', (s, i) => jobPay(i)); jrnAdd('c', 'stw', 2); break;
    case 'bite': jrnAdd('c', 'gul', 1); break;
    case 'snd': if (e.s === 'gulS' || e.s === 'gulL') jrnAdd('c', 'gul', 1); else if (e.s === 'gulF') jrnAdd('c', 'gul', 2); break;
    case 'sink': if (J.st > 0) { J.st = 0; emit({k: 'jobst', st: 0}); J.v++; } break;
    case 'sack': for (const i of e.s || []) jrnAdd('t', KINDS[i]); break;
    case 'stow': for (const k of B.hold) jrnAdd('t', k); break;
    case 'wsave': if (R) { R.rs = (R.rs || 0) + 1; save(); } break;
    case 'bought': jrnSets(); break;
  }
}
function jobAct(id, m) {
  const p = PL.get(id), J = G.stat && G.stat.job; if (!p || !J) return; const i = m.i | 0, s = i >= 0 && i < 3 ? J.b[i] : null, no = why => emit({k: 'nope', id, why});
  if (m.a === 'job') {
    if (!s || s.e || s.act) return; if (i === 2 && titleOf(G.earned) < 1) return no('Opens at Bosun.');
    if (J.b.filter(q => q && !q.e && q.act).length >= 2) return no('Two contracts at a time.');
    const bp = jobBoard.p, sh = G.shed && G.shed.shop, nr = (bp && Math.hypot(p.x - bp[0], p.z - bp[2]) < 30) || (sh && Math.hypot(p.x - sh[0], p.z - sh[2]) < 30) || (typeof voyPortNear === 'function' && !!voyPortNear(p.x, p.z, 40));
    if (!nr) return no('Take contracts at the job board.');
    s.act = 1; s.tk = G.t; if (s.t === 'cour') giveCarry(p, 'parcel'); emit({k: 'jobs', i, id, t: jobTitle(s)}); J.v++; save();
  } else if (m.a === 'jobx') { if (!s || s.e || !s.act) return;
    if (s.t === 'cour') { const q = [p, ...PL.values()].find(q => (q.sack || []).includes('parcel')); if (q) { q.sack.splice(q.sack.indexOf('parcel'), 1); sackSet(q); } else if (B.hold.includes('parcel')) B.hold.splice(B.hold.indexOf('parcel'), 1); }
    jobFail(i, 'Contract abandoned.');
  } else if (m.a === 'jobd') { if (!s || s.e || !s.act || s.t !== 'cour') return; const j = p.sack.indexOf('parcel');
    if (j < 0 || Math.hypot(p.x - s.x, p.z - s.z) > 4.5 || Math.abs(p.y - s.y) > 3) return no('Bring the parcel to the drop-off.'); p.sack.splice(j, 1); sackSet(p); jobPay(i); }
}
// the journal (host): best catches, treasures, creatures; set rewards once each
function jrnAdd(g, k, v) {
  const R = G.stat && G.stat.jr; if (!R || !isHost() || !k) return;
  if (g === 'f') { if (!FISH[k] || k === 'boot' || k === 'bottle') return; const was = R.f[k]; if (was == null || v > was) { R.f[k] = +(+v || 0).toFixed(1); if (was == null) { emit({k: 'jrnew', g, n: k, v: R.f[k]}); jrnSets(); } } }
  else if (g === 't') { if (!(VALUE[k] > 0) || JOB_SKIP.includes(k) || R.t[k]) return; R.t[k] = 1; emit({k: 'jrnew', g, n: k}); jrnSets(); }
  else if (g === 'c') { if ((R.c[k] || 0) >= v) return; R.c[k] = v; emit({k: 'jrnew', g, n: k, d: v === 2 ? 1 : 0}); jrnSets(); }
}
function jrnSets() {
  const R = G.stat && G.stat.jr; if (!R || !isHost()) return;
  const ok = [Object.keys(FISH).filter(k => k !== 'boot' && k !== 'bottle').every(k => R.f[k] != null), Object.keys(VALUE).filter(k => VALUE[k] > 0 && !JOB_SKIP.includes(k)).every(k => R.t[k]), ['rig', 'stw', 'deep', 'gul'].every(k => R.c[k] === 2), jobOwn().length >= 6];
  ok.forEach((o, s) => { if (!o || R.s[s]) return; R.s[s] = 1; const v = Math.round(JOB_SETS[s].v * (D.pay || 1)); G.cash += v; G.earned += v; emit({k: 'jrset', s, v}); jobRank(); save(); });
}

// ---- the board beside the harbour shed door
const jobBoard = {p: null, m: null, c: null, g: null, tex: null, k: '', bg: null};
function jobBoardDraw() {
  const o = jobBoard, g = o.g; if (!g) return; const J = jobB(), W = 512, H = 320, rk = titleOf(G.earned), pay = D.pay || 1;
  g.drawImage(o.bg, 0, 0); g.textAlign = 'center'; g.fillStyle = '#f2e6cc'; g.font = 'bold 21px Georgia'; g.fillText('CONTRACTS', W / 2, 31);
  const leg = J && J.lg && rk >= 2, n = leg ? 4 : 3, cw = leg ? 110 : 142, gap = (W - 28 - n * cw) / (n + 1);
  const wrap = (t, x, y, w, lh, max) => { const ws = String(t).split(' '); let l = '', k = 0; for (let i = 0; i < ws.length; i++) { const tt = l ? l + ' ' + ws[i] : ws[i]; if (g.measureText(tt).width > w && l) { g.fillText(l, x, y + k * lh); k++; l = ws[i]; if (k >= max) return; } else l = tt; } if (l && k < max) g.fillText(l, x, y + k * lh); };
  const stamp = (t, c, x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 3; g.font = 'bold 17px Georgia'; const w = g.measureText(t).width + 14; g.globalAlpha = .85; g.strokeRect(-w / 2, -13, w, 24); g.fillText(t, 0, 5); g.restore(); };
  for (let i = 0; i < n; i++) {
    const x = 14 + gap + i * (cw + gap), y = 46, h = 250, s = i < 3 ? J && J.b[i] : null, lock = i === 2 && rk < 1, L = i === 3 ? J.lg : null;
    g.save(); g.translate(x + cw / 2, y + h / 2); g.rotate(((i * 37) % 7 - 3) * .013); g.translate(-cw / 2, -h / 2);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(4, 6, cw, h);
    g.fillStyle = i === 3 ? '#e9cf72' : s && s.e ? '#cfc6ae' : '#ebe3cc'; g.fillRect(0, 0, cw, h);
    g.fillStyle = ['#4a9a5a', '#d09a2a', '#b8362a', '#9a7410'][i]; g.fillRect(0, 0, cw, 16);
    g.fillStyle = '#c03020'; g.beginPath(); g.arc(cw / 2, 8, 6, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(cw / 2 - 2, 6, 2, 0, TAU); g.fill();
    g.fillStyle = '#5a4e38'; g.font = '11px monospace'; g.fillText(['SAFE', 'RISKY', 'DEADLY', 'LEGEND'][i], cw / 2, 34);
    g.fillStyle = '#2a241a'; g.font = 'bold 17px Georgia';
    if (lock) { wrap('Opens at Bosun', cw / 2, 92, cw - 16, 21, 3); g.font = '40px Georgia'; g.fillText('?', cw / 2, 180); }
    else if (L) { wrap(L.n, cw / 2, 66, cw - 14, 20, 3); g.font = '13px Georgia'; g.fillStyle = '#4a3a10'; wrap(`${jobCap(FISH[L.f] ? FISH[L.f].n : L.f)} over ${L.kg} kg`, cw / 2, 136, cw - 14, 16, 3); g.font = 'bold 24px Georgia'; g.fillStyle = '#2a1e08'; g.fillText(money(L.pay * pay), cw / 2, h - 22); if (J.leg === J.wk) stamp('CLAIMED', '#2a6a2a', cw / 2, 196, -.18); }
    else if (!s || s.e) { g.fillStyle = '#8a8068'; g.font = 'italic 15px Georgia'; wrap('More work soon', cw / 2, 110, cw - 16, 20, 2); }
    else { wrap(jobTitle(s), cw / 2, 66, cw - 14, 20, 4); g.font = '12px Georgia'; g.fillStyle = '#5a4e38'; wrap(s.d, cw / 2, 158, cw - 14, 15, 3);
      g.font = 'bold 24px Georgia'; g.fillStyle = '#2a241a'; g.fillText(money(s.pay * pay * (s.daily ? 1.5 : 1)), cw / 2, h - 22);
      if (s.act) stamp('TAKEN', '#22508a', cw / 2, 206, -.2); else if (s.daily) stamp('TODAY', '#b02818', cw / 2, 206, .16); }
    g.restore();
  }
  o.tex.needsUpdate = true;
}
{ const f0 = buildFw; buildFw = function () { const r = f0.apply(this, arguments);
  if (G.shed) { const b = G.shed, [x, z] = L2W(b, 2.35, -2.64), y = b.fy + 1.55, th = b.th + PI; jobBoard.p = [x, y, z];
    for (const s of [-1, 1]) { const [px, pz] = L2W(b, 2.35 + s * .86, -2.66); put('log', new THREE.CylinderGeometry(.06, .07, 2.5, 7), px, b.fy + 1.25, pz); }
    const [fx, fz] = L2W(b, 2.35, -2.61); wbox('wood', fx, y, fz, 1.72, 1.12, .05, th, .8);
    const [rx, rz] = L2W(b, 2.35, -2.72); wbox('wood', rx, y + .64, rz, 1.86, .06, .26, th, .8);
    const bg = jobBoard.bg = cv(512, 320, (g, w, h) => { g.fillStyle = '#7a5634'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(40,24,10,.25)' : 'rgba(200,150,100,.16)'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } g.strokeStyle = '#3a2614'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); });
    const c = jobBoard.c = cv(512, 320, g => g.drawImage(bg, 0, 0)); jobBoard.g = c.getContext('2d');
    const t = jobBoard.tex = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = jobBoard.m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({map: t, roughness: .92, metalness: 0, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0}));
    const [mx, mz] = L2W(b, 2.35, -2.645); m.position.set(mx, y, mz); m.rotation.y = th; m.receiveShadow = true; scene.add(m); }
  return r; }; }
// ---- parcels
{ const f0 = itemMesh; let PM = null; itemMesh = function (kind) { if (kind !== 'parcel') return f0.apply(this, arguments);
  PM = PM || {box: new THREE.MeshStandardMaterial({color: 0xb08a5a, roughness: .95}), str: new THREE.MeshStandardMaterial({color: 0xeadfc4, roughness: .9}), seal: new THREE.MeshStandardMaterial({color: 0xa01818, roughness: .4})};
  const g = new THREE.Group(), b = new THREE.Mesh(new THREE.BoxGeometry(.44, .28, .32), PM.box); b.position.y = .14; g.add(b);
  for (const [sx, sz] of [[.452, .025], [.025, .332]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(sx, .29, sz), PM.str); s.position.y = .14; g.add(s); }
  const w = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .012, 10), PM.seal); w.position.set(.1, .285, .07); g.add(w);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g; }; }

// ---- cards right of the compass: the counting-up receipt, contracts, journal reveals
const jobRc = {q: [], on: [], el: null, last: null,
  push(c) { c.t = 0; c.born = performance.now(); this.q.push(c); return c; },
  reset() { this.q.length = 0; for (const c of this.on) if (c.el) c.el.remove(); this.on.length = 0; this.last = null; },
  start(c) {
    const el = c.el = document.createElement('div'), J = jobB(); el.className = 'rc ' + (c.cls || '');
    if (c.k === 'sold') { const st = (J && J.st) || 0; c.cuD = c.rows.length * .11; c.life = 3.5 + c.cuD;
      el.innerHTML = `<h4>SOLD</h4>${c.rows.map((r, i) => `<div class="rw${r[2] ? ' nb' : ''}" style="animation-delay:${i * 110}ms"><span>${r[0]}</span><span>${money(r[1])}</span></div>`).join('')}<div class="tt"><span>Total</span><b>$0</b></div>${st > 0 ? `<span class="jobPill">Streak ×${(1 + .1 * Math.min(st, 5)).toFixed(1)}</span>` : ''}`;
      c.cu = el.querySelector('.tt b'); for (let i = 0; i < c.rows.length; i++) setTimeout(() => { if (A.on) { tone(2400 + i * 90, .02, .05, 'triangle'); burst(4800, 6, .015, .02); } }, i * 110); }
    else el.innerHTML = c.h;
    if (c.cuV != null && !c.cu) c.cu = el.querySelector('[data-cu]');
    if (c.go) c.go(); this.el.appendChild(el); this.on.push(c);
  },
  addRow(lab, v) { const c = this.last; if (!c || c.k !== 'sold' || performance.now() - c.born > 1500) return false; c.rows.push([lab, v, 1]); c.tot += v;
    if (c.el) { const d = document.createElement('div'); d.className = 'rw nb'; d.innerHTML = `<span>${lab}</span><span>${money(v)}</span>`; c.el.insertBefore(d, c.el.querySelector('.tt')); c.life += .6; } return true; },
  step(dt) {
    const el = this.el; if (!el) return; const hold = anyPanel() || G.map || G.cine > 0 || !!G.camFly;
    if (hold !== this.held) { this.held = hold; el.style.opacity = hold ? 0 : 1; } if (hold) return;
    while (this.q.length && this.on.length < 3) this.start(this.q.shift());
    for (let i = this.on.length - 1; i >= 0; i--) { const c = this.on[i]; c.t += dt;
      if (c.cu) { const u = clamp((c.t - (c.cuD || 0)) / .9, 0, 1), v = c.k === 'sold' ? c.tot : c.cuV; setT(c.cu, money(v * (1 - Math.pow(1 - u, 3)))); }
      if (c.t > c.life && !c.out) { c.out = 1; c.el.classList.add('out'); }
      if (c.t > c.life + .6) { c.el.remove(); this.on.splice(i, 1); } }
  }};
{ const st = document.createElement('style'); st.id = 'st-job'; st.textContent = `
#jobRc { position:absolute; left:calc(50% + 118px); top:62px; width:228px; display:flex; flex-direction:column; gap:7px; pointer-events:none; font:12px ui-monospace,monospace; transition:opacity .3s; }
#jobRc .rc { background:linear-gradient(180deg,rgba(18,20,22,.86),rgba(10,12,14,.8)); border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:8px 11px 9px; box-shadow:0 8px 24px rgba(0,0,0,.5); color:#e8e0cc; animation:jobIn .4s cubic-bezier(.2,1.3,.4,1) both; transition:opacity .5s, transform .5s; }
#jobRc .rc.out { opacity:0; transform:translateX(14px); }
#jobRc h4 { margin:0 0 5px; font:10px ui-monospace,monospace; letter-spacing:.32em; color:var(--acc); }
#logbook .jobLn span { color:#22508a; } #logbook .jobLn i { color:#6b604c; }
#jobRc .rw { display:flex; justify-content:space-between; gap:8px; padding:1px 0; animation:jobRow .22s ease-out both; } #jobRc .rw.nb { color:#b8a0ff; }
#jobRc .tt { display:flex; justify-content:space-between; align-items:baseline; border-top:1px dashed rgba(255,255,255,.22); margin-top:5px; padding-top:4px; } #jobRc .tt b { font:16px ui-monospace,monospace; color:#ffcf60; text-shadow:0 0 10px rgba(255,190,60,.45); }
#jobRc .gold { background:linear-gradient(160deg,rgba(74,54,14,.94),rgba(26,19,8,.9)); border-color:rgba(255,207,96,.55); } #jobRc .gold h4 { color:#ffcf60; } #jobRc .gold big { display:block; font:15px Georgia,serif; color:#fff2cc; margin-bottom:3px; } #jobRc .gold [data-cu] { font:20px ui-monospace,monospace; color:#ffd870; }
#jobRc .red { border-color:rgba(220,80,60,.55); color:#f0a090; } #jobRc .red h4 { color:#ff7a60; }
#jobRc .jn { border-color:rgba(160,220,255,.45); background:linear-gradient(110deg,rgba(14,22,30,.9) 30%,rgba(90,140,180,.5) 50%,rgba(14,22,30,.9) 70%) 0 0/300% 100%; animation:jobIn .4s ease-out both, jobSh 1.6s linear .3s 2; } #jobRc .jn h4 { color:#9ad8ff; }
.jobPill { display:inline-block; margin-top:6px; padding:1px 8px; border-radius:9px; background:#3a2a10; color:#ffcf60; font-size:10px; letter-spacing:.1em; }
@keyframes jobIn { from { opacity:0; transform:translateY(-8px) scale(.94); } to { opacity:1; transform:none; } }
@keyframes jobRow { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
@keyframes jobSh { from { background-position:100% 0; } to { background-position:0 0; } }
@media (max-width:760px) { #jobRc { left:auto; right:8px; width:200px; top:96px; } }
.jobC { display:inline-block; font:10px ui-monospace,monospace; letter-spacing:.12em; padding:1px 6px; border-radius:3px; margin-right:7px; vertical-align:2px; color:#111; }
.jobC.r0 { background:#5ab06a; } .jobC.r1 { background:#e0a830; } .jobC.r2 { background:#d0483a; color:#fff; } .jobC.r3 { background:#ffd060; }
.jobT { display:inline-block; font:9px ui-monospace,monospace; color:#ff7a60; border:1px solid #ff7a60; padding:0 4px; margin-left:6px; transform:rotate(-4deg); letter-spacing:.15em; vertical-align:2px; }
.jobBar { display:block; height:3px; background:rgba(255,255,255,.1); margin-top:5px; } .jobBar b { display:block; height:100%; background:var(--acc); }
#jobHd { display:flex; justify-content:space-between; align-items:center; gap:10px; color:var(--dim); font-size:13px; margin:2px 0 4px; } #jobHd button { padding:5px 12px; font-size:13px; }
.up.jobA { background:linear-gradient(90deg,rgba(74,168,200,.1),transparent); } .up.jobL { opacity:.55; }
#jrn .paper { width:min(780px,94vw); max-height:88vh; overflow:auto; white-space:normal; font:13px/1.45 "Courier New",monospace; padding:20px 26px 16px; position:relative; }
#jrn h2 { margin:0; font:bold 20px "Courier New",monospace; letter-spacing:.2em; } #jrnX { position:absolute; right:10px; top:8px; background:none; color:#6b604c; font-size:22px; padding:2px 10px; }
#jrn h3 { display:flex; justify-content:space-between; align-items:baseline; margin:14px 0 6px; font:bold 12px "Courier New",monospace; letter-spacing:.14em; text-transform:uppercase; border-bottom:1px dashed rgba(42,36,26,.35); padding-bottom:2px; } #jrn h3 i { font-style:normal; color:#6b604c; }
#jrn .jrS { font-style:normal; color:#7a5a10; } #jrn .jrS.ok { color:#2a7a3a; }
#jrn .jrG { display:grid; grid-template-columns:repeat(auto-fill,minmax(108px,1fr)); gap:6px; }
#jrn .jrT { border:1px solid rgba(42,36,26,.3); border-radius:3px; padding:5px 7px; min-height:40px; background:rgba(255,255,255,.22); font-size:11px; color:#4a4030; }
#jrn .jrT b { display:block; font-size:12px; color:#2a241a; } #jrn .jrT.q { background:transparent; border-style:dashed; color:#9a8e74; } #jrn .jrT.q b { color:#9a8e74; } #jrn .jrT.w { border-color:#a07a10; background:rgba(224,190,90,.25); }
#jrn .jrT svg { width:15px; height:15px; float:right; opacity:.55; }
`; document.head.appendChild(st);
  const rc = document.createElement('div'); rc.id = 'jobRc'; $('hud').appendChild(rc); jobRc.el = rc;
  const jr = document.createElement('div'); jr.id = 'jrn'; jr.className = 'scr hidden'; jr.innerHTML = '<div class="paper"><button id="jrnX" title="Close (J)">×</button><div id="jrnB"></div><small>J or Esc to close</small></div>'; document.body.appendChild(jr);
  jr.onclick = e => { if (e.target === jr) jrnClose(); }; $('jrnX').onclick = () => jrnClose();
  const tb = $('shopTabs'); if (tb && !tb.querySelector('[data-tab="jobs"]')) { const b = document.createElement('button'); b.dataset.tab = 'jobs'; b.textContent = 'Jobs'; tb.insertBefore(b, tb.firstChild); } }
Snd.jobPin = () => { if (!A.on) return; burst(2600, 1.5, .07, .06); setTimeout(() => { burst(700, 1.4, .16, .08, 'lowpass'); tone(820, .035, .05, 'triangle'); }, 70); };
Snd.jobDone = () => { if (!A.on) return; [1318.5, 1975.5, 2637].forEach((f, i) => setTimeout(() => { tone(f, .055, 1.5); tone(f * 2.76, .012, .6); }, i * 150));
  burst(260, 1, .25, .14, 'lowpass'); for (let i = 0; i < 10; i++) setTimeout(() => { tone(2900 + Math.random() * 800, .022, .06, 'triangle'); burst(5200, 5, .02, .025); }, 420 + i * 42); };

// ---- the Jobs tab in the shed (drawShop calls this with its row and button helpers)
function jobRows(row, bt) {
  const J = jobB(); if (!J || !J.b) return '<div class="up"><div>The board is being pinned up…</div></div>';
  const rk = titleOf(G.earned), pay = D.pay || 1, nAct = J.b.filter(s => s && !s.e && s.act).length, mul = 1 + .1 * Math.min(J.st || 0, 5);
  const dist = s => { if (s.x == null || !P) return ''; const d = Math.hypot(s.x - P.x, s.z - P.z); return d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'; };
  const chip = i => `<span class="jobC r${i}">${['SAFE', 'RISKY', 'DEADLY', 'LEGEND'][i]}</span>`;
  const out = [`<div id="jobHd"><span>${J.st > 0 ? `Streak ×${mul.toFixed(1)} · ` : ''}${nAct} of 2 active</span><button data-jrn="1">Journal</button></div>`];
  J.b.forEach((s, i) => {
    if (i === 2 && rk < 1) { out.push(row(`${chip(2)}???`, `Opens at Bosun (${money(TITLES[1][0])} earned)`, bt('', 'Locked', 0, `${money(Math.max(0, TITLES[1][0] - G.earned))} to go`), ' jobL')); return; }
    if (!s || s.e) { out.push(row(`${chip(i)}<i style="color:var(--dim)">More work soon</i>`, 'A new notice goes up in a moment', '', ' jobL')); return; }
    const m = jobMul(s) * (s.nt && jobNight() > .5 ? 1.6 : 1), pr = s.act && s.n > 1 ? `<i class="jobBar"><b style="width:${(s.got / s.n * 100).toFixed(0)}%"></b></i>` : '';
    const d = [s.d, dist(s), `${money(s.pay * pay)}${m > 1.001 ? ` ×${m.toFixed(1)}` : ''}`, s.act && s.n > 1 ? `${s.got}/${s.n}` : ''].filter(Boolean).join(' · ');
    const b = s.act ? `<span class="bt"><button data-jobx="${i}">Abandon</button></span>` : bt(`data-job="${i}"`, 'Take', 0, nAct >= 2 ? 'Two at a time' : '');
    out.push(row(`${chip(i)}${jobTitle(s)}${s.daily ? '<span class="jobT">TODAY</span>' : ''}`, d + pr, b, s.act ? ' jobA' : ''));
  });
  const L = J.lg; if (L && rk >= 2) out.push(row(`${chip(3)}${L.n}`, `Land a ${FISH[L.f] ? FISH[L.f].n : L.f} of ${L.kg} kg or more · this week · ${money(L.pay * pay)}`, `<span class="bt"><button disabled>${J.leg === J.wk ? 'Claimed ✓' : 'Always on'}</button></span>`, J.leg === J.wk ? ' jobL' : ' jobA'));
  else if (L && rk >= 1) out.push(row(`${chip(3)}???`, `A legendary catch each week · opens at First Mate (${money(TITLES[2][0])})`, '', ' jobL'));
  return out.join('');
}

// ---- the journal panel
function jrnOpen() {
  if (G.jrnOpen || G.noteOpen || G.casOpen || G.helpOpen || G.endOpen || !G.on) return;
  if (G.shopOpen) { G.shopOpen = false; $('shop').classList.add('hidden'); }
  G.jrnOpen = true; clearKeys(); $('jrn').classList.remove('hidden'); try { document.exitPointerLock(); } catch (e) {} jrnDraw(); Snd.jobPin();
}
function jrnClose(relock = true) { if (!G.jrnOpen && $('jrn').classList.contains('hidden')) return; G.jrnOpen = false; $('jrn').classList.add('hidden'); if (relock && G.on) lockMouse(); }
function jrnDraw() {
  const el = $('jrnB'); if (!el) return; const R0 = isHost() ? G.stat && G.stat.jr : G.jrnS, R = Object.assign({f: {}, t: {}, c: {}, s: {}}, R0 || {}), pay = D.pay || 1;
  const tile = (ok, ic, n, sub, w) => `<div class="jrT${ok ? (w ? ' w' : '') : ' q'}">${ok && ic ? ic : ''}<b>${ok ? n : '???'}</b>${ok && sub ? sub : ''}</div>`;
  const sec = (h, n, m, si, body) => `<h3><span>${h} <i>${n}/${m}</i></span>${si != null ? `<em class="jrS${R.s[si] ? ' ok' : ''}">${R.s[si] ? '✓ ' : ''}${JOB_SETS[si].n} · ${money(JOB_SETS[si].v * pay)}</em>` : ''}</h3><div class="jrG">${body}</div>`;
  const FK = Object.keys(FISH).filter(k => k !== 'boot' && k !== 'bottle'), TK = Object.keys(VALUE).filter(k => VALUE[k] > 0 && !JOB_SKIP.includes(k)), own = jobOwn();
  const CK = [['rig', 'The thing on the rig'], ['stw', 'The Steward'], ['deep', 'The deep'], ['gul', 'Gulpers']];
  const J = jobB(), nm = String((P && P.name) || '').replace(/[<>&]/g, '');
  el.innerHTML = `<h2>JOURNAL</h2><small style="margin:2px 0 0">${TITLES[titleOf(G.earned)][1]} ${nm} · earned ${money(G.earned)}${J && J.st ? ` · streak ${J.st}` : ''}${R.rs ? ` · ${R.rs} rescued` : ''}</small>`
    + sec('Catches', FK.filter(k => R.f[k] != null).length, FK.length, 0, FK.map(k => tile(R.f[k] != null, ICON.fish, jobCap(FISH[k].n), `best ${R.f[k]} kg`, J && J.lg && J.lg.f === k && R.f[k] >= J.lg.kg)).join(''))
    + sec('Treasures', TK.filter(k => R.t[k]).length, TK.length, 1, TK.map(k => tile(R.t[k], ICON.sack, jobCap(NAMES[k] || k), money(VALUE[k] * pay))).join(''))
    + sec('Creatures', CK.filter(([k]) => R.c[k] === 2).length, CK.length, 2, CK.map(([k, n]) => tile(R.c[k] >= 1, '', n, R.c[k] === 2 ? 'beaten' : 'seen', R.c[k] === 2)).join(''))
    + sec('Places', POIS.filter((q, i) => G.disc.includes(i)).length, POIS.length, null, POIS.map((q, i) => tile(G.disc.includes(i), '', q.n, '')).join(''))
    + sec('Fleet', HULLS.filter((H, i) => own.includes(i)).length, HULLS.length, 3, HULLS.map((H, i) => tile(own.includes(i), '', H.n, H.L ? H.L + ' m' : '')).join(''));
}

// ---- wrappers
{ const f0 = goalHook; goalHook = function (e, ph) { const r = f0.apply(this, arguments); if (ph === 1 && G.stat && G.stat.job && G.stat.jr) jobHook(e); return r; }; }
{ const f0 = hostStep; hostStep = function (dt) { const r = f0.apply(this, arguments); if (G.on) jobStep(dt); return r; }; }
{ const f0 = hostAct; hostAct = function (id, m) {
  const p = PL.get(id);
  // a stowed parcel rides in the hold (and sinks with it); unstowing hands it back first
  if (m && p && G.on && m.a === 'unstow' && B.hold.includes('parcel') && !B.hold.includes('key') && sackFits(p, 'parcel')) { const [x, z] = bL2W(BSPOT.hold[0], BSPOT.hold[1]); if (Math.hypot(p.x - x, p.z - z) < 3.4) { B.hold.splice(B.hold.lastIndexOf('parcel'), 1); p.sack.push('parcel'); sackSet(p); save(); return; } }
  const r = f0.apply(this, arguments); if (m && G.on && (m.a === 'job' || m.a === 'jobx' || m.a === 'jobd')) jobAct(id, m); return r; }; }
{ const f0 = applyEv; applyEv = function (e) {
  const me = myId();
  if (e.k === 'sold') { (Snd.sale || Snd.coin)(e.v); const pay = D.pay || 1, rows = []; let sum = 0;
    for (const k in e.c || {}) { const n = e.c[k]; if (!(n > 0) || k === 'fish') continue; const v = Math.round((VALUE[k] || 0) * n * pay); sum += v; rows.push([`${n} ${jobPl(k, n)}`, v]); }
    if (e.c && e.c.fish > 0) rows.push([`${e.c.fish} fish`, Math.max(0, (e.v || 0) - sum)]); if (!rows.length) rows.push(['Salvage', e.v || 0]);
    jobRc.last = jobRc.push({k: 'sold', rows, tot: e.v || 0}); return; }
  const r = f0.apply(this, arguments);
  switch (e.k) {
    case 'jobs': { Snd.jobPin(); const p = PL.get(e.id); showMsg(e.id === me ? `Contract taken · ${e.t}` : `${p ? p.name : 'Crew'} took a contract · ${e.t}`, '', 2.6); break; }
    case 'jobok': { Snd.jobDone(); const st = (1 + .1 * Math.min(e.st || 0, 5)).toFixed(1);
      jobRc.push({k: 'ok', cls: 'gold', cuV: e.v, life: 4.4, h: `<h4>${e.lg ? 'LEGEND LANDED' : 'CONTRACT DONE'}</h4><big>${e.t}</big><b data-cu>$0</b>${e.nt ? ' <small style="color:#b8a0ff">night ×1.6</small>' : ''}<br><span class="jobPill">Streak ${e.st} · ×${st}</span>`,
        go: () => { if (!(G.uw > .5)) for (let k = 0; k < 3; k++) setTimeout(() => G.on && spawnRocket({x: cam.position.x + (Math.random() - .5) * 24, y: cam.position.y + 3, z: cam.position.z + (Math.random() - .5) * 24, vx: Math.random() < .5 ? -2 : 2, vy: 26, vz: Math.random() < .5 ? -2 : 2, c: k + 1}), 150 + k * 340); }});
      if (e.lg) (G.banQ = G.banQ || []).push({h: 'LEGEND', t: e.t, c: e.v, s: 'goal'}); break; }
    case 'jobf': tone(150, .07, .55, 'triangle', null, 92); jobRc.push({k: 'f', cls: 'red', life: 3, h: `<h4>CONTRACT LOST</h4>${e.why || ''}${e.t ? `<br><small style="color:var(--dim)">${e.t}</small>` : ''}`}); break;
    case 'jobp': showMsg(`${e.l || 'Contract'} ${e.n}/${e.of}`, '', 1.6); break;
    case 'jobnb': if (!jobRc.addRow('Night shift +25%', e.v)) jobRc.push({k: 'nb', life: 2.6, cuV: e.v, h: '<h4>NIGHT SHIFT</h4><span>+25% after dark </span><b data-cu style="color:#b8a0ff">$0</b>'}); break;
    case 'jobst': if (e.day) showMsg('A new day. Fresh contracts on the board.', 'JOB BOARD', 4); else if (e.st === 0) showMsg('Streak lost.', '', 2); break;
    case 'jrnew': { Snd.discover(); const F = FISH[e.n], CN2 = {rig: 'The thing on the rig', stw: 'The Steward', deep: 'The deep', gul: 'Gulpers'};
      const t = e.g === 'f' ? `${jobCap(F ? F.n : e.n)} · ${e.v} kg` : e.g === 't' ? `${jobCap(NAMES[e.n] || e.n)} · ${money((VALUE[e.n] || 0) * (D.pay || 1))}` : `${CN2[e.n] || e.n} · ${e.d ? 'beaten' : 'seen'}`;
      jobRc.push({k: 'jn', cls: 'jn', life: 3.2, h: `<h4>NEW IN THE JOURNAL</h4>${t}`}); if (G.jrnOpen) jrnDraw(); break; }
    case 'jrset': (G.banQ = G.banQ || []).push({h: 'JOURNAL', t: (JOB_SETS[e.s] || {}).n || 'Set complete', c: e.v, s: 'goal'}); if (G.jrnOpen) jrnDraw(); break;
  }
  return r; }; }
{ const f0 = packSnap; packSnap = function () { const s = f0.apply(this, arguments), J = G.stat && G.stat.job, n = performance.now();
  if (J && ((J.v !== G.jobSentV && n - (G.jobSentT || 0) > 500) || n - (G.jobSentT || 0) > 2000)) { G.jobSentV = J.v; G.jobSentT = n;
    s.jb = {v: J.v, st: J.st, wk: J.wk, leg: J.leg, lg: J.lg, b: J.b.map(q => !q || q.e ? {e: 1, r: q ? q.r : 0} : {id: q.id, r: q.r, t: q.t, k: q.k, n: q.n, got: q.got, pay: q.pay, x: q.x, y: q.y, z: q.z, d: q.d, act: q.act, daily: q.daily, nt: q.nt || 0})}; }
  if (G.stat && G.stat.jr && n - (G.jrnSentT || 0) > 3000) { G.jrnSentT = n; s.jr = G.stat.jr; } return s; }; }
{ const f0 = applySnap; applySnap = function (s) { const r = f0.apply(this, arguments); if (s.jb) G.jobsS = s.jb; if (s.jr) { G.jrnS = s.jr; if (G.jrnOpen) jrnDraw(); } return r; }; }
{ const f0 = startGame; startGame = function () { const r = f0.apply(this, arguments);
  G.jobsS = null; G.jrnS = null; G.jobV = null; G.jobT = 0; G.jobDayT = 0; G.jobSentT = 0; G.jrnSentT = 0; jrnClose(false); jobRc.reset(); jobBoard.k = '';
  if (isHost() && G.stat) { const S = G.stat; S.jr = Object.assign({f: {}, t: {}, c: {}, s: {}, rs: 0}, S.jr || {}); for (const k of ['f', 't', 'c', 's']) S.jr[k] = S.jr[k] || {};
    jobDests(); const J = S.job = Object.assign({b: [], st: 0, day: null, wk: null, leg: null, lg: null, n: 0, v: 0, gt: 0, dp: 0}, S.job || {});
    // game time restarts every voyage: shift the stored times so ages and refills carry on
    const sh = -(J.gt || 0); for (const s of J.b) if (s) { if (s.born != null) s.born += sh; if (s.refT) s.refT = Math.max(1, s.refT + sh); if (s.tk != null) s.tk += sh; } J.gt = 0;
    for (let i = 0; i < 3; i++) if (!J.b[i] || J.b[i].r !== i) J.b[i] = jobGen(i); J.b.length = 3; jobStep(.5); J.v++; }
  return r; }; }
{ const f0 = targets; targets = function () { const L = f0.apply(this, arguments); if (!P) return L;
  const bp = jobBoard.p; if (bp && (bp[0] - P.x) * (bp[0] - P.x) + (bp[2] - P.z) * (bp[2] - P.z) < 900) L.push({x: bp[0], y: bp[1], z: bp[2], r: 2.4, label: 'Job board', go: () => { G.shopTab = 'jobs'; openShop(); G.voyShopPos = bp; }});
  const J = jobB(); if (J && J.b && (P.sack || []).includes('parcel')) J.b.forEach((s, i) => { if (s && !s.e && s.act && s.t === 'cour' && s.x != null && Math.hypot(s.x - P.x, s.z - P.z) < 30) L.push({x: s.x, y: s.y + 1.1, z: s.z, r: 3.6, label: `Deliver the parcel (${s.k})`, go: () => act({a: 'jobd', i})}); });
  return L; }; }
{ const f0 = nextStep; nextStep = function () { const r = f0.apply(this, arguments); if (!P || !G.goals.includes(10) || !G.helmDone) return r;
  const sv = sackVal(P.sack), hold = holdValue(); if (B.hull < 30 || (sv > 0 && P.ob) || (hold > 0 && G.earned === 0) || hold >= 150 || (sv > 0 && !P.ob && Math.hypot(P.x - HOME.x, P.z - HOME.z) < 200)) return r;
  const J = jobB(); if (!J || !J.b) return r; let best = null, bd = 1e9;
  for (const s of J.b) { if (!s || s.e || !s.act || s.x == null) continue; const d = Math.hypot(s.x - P.x, s.z - P.z); if (d < bd) { bd = d; best = s; } }
  if (!best) return r; const mk = {x: best.x, z: best.z, lab: 'JOB'}; if (bd < 40 && best.y != null) Object.assign(mk, {y: best.y + 1.2, scr: 1});
  return {t: jobTitle(best), mk}; }; }
{ const f0 = ctlFrame; ctlFrame = function () { const r = f0.apply(this, arguments); if (G.jrnOpen && P && (!alivePlay() || P.down || (B.sink > 0 && P.ob))) jrnClose(false); return r; }; }
{ const f0 = hud; hud = function () { const r = f0.apply(this, arguments), now = performance.now(), dt = Math.min(.1, (now - (G.jobHudT || now)) / 1000); G.jobHudT = now; const J = jobB();
  jobRc.step(dt);
  // the board: redraw on a new version, glow a little at night, hide when far
  const o = jobBoard; if (o.m) { const d = Math.hypot(cam.position.x - o.p[0], cam.position.z - o.p[2]), vis = d < 300; if (o.m.visible !== vis) o.m.visible = vis;
    if (vis) { const k = `${J ? J.v : -1}|${titleOf(G.earned)}|${D.pay}`; if (k !== o.k && d < 140) { o.k = k; jobBoardDraw(); } const ei = +(.2 * TOD.night).toFixed(2); if (o.m.material.emissiveIntensity !== ei) o.m.material.emissiveIntensity = ei; } }
  // the shed's Jobs tab follows the board
  if (G.shopOpen && G.shopTab === 'jobs') { const k = `${J ? J.v : -1}|${titleOf(G.earned)}|${G.cash}`; if (k !== G.jobV) { G.jobV = k; drawShop(); } } else G.jobV = null;
  // the chart's logbook lists up to two active contracts
  if (G.map && J && J.b) { const lg = $('logbook'), A2 = J.b.filter(s => s && !s.e && s.act).slice(0, 2), k = A2.map(s => s.id + ':' + s.got).join(',');
    if (lg && (lg._jobK !== k || (A2.length && !lg.querySelector('.jobLn')))) { lg._jobK = k; lg.querySelectorAll('.jobLn').forEach(q => q.remove());
      for (const s of A2) { const d = document.createElement('div'); d.className = 'jobLn'; d.innerHTML = `<span>◆ ${jobTitle(s)}${s.n > 1 ? ` <i>(${s.got}/${s.n})</i>` : ''}</span><b>${money(s.pay * (D.pay || 1) * jobMul(s))}</b>`; lg.appendChild(d); } } }
  return r; }; }

// ---------------- game flow
let BUILT = false;
function buildWorld() {
  if (BUILT) return; BUILT = true;
  textures(); materials(); buildRig(); buildHome(); buildIsleSites(); buildWrecks(); buildIsles(); buildBuoys(); buildSea(); buildBoat(); buildCreature(); buildNav(); buildFauna(); buildCruise(); buildDeep(); buildFw(); makeCreature(STW, SJ, {col: 0xa8a49a, s: 1.3, mask: 1});
  for (const k in BK) { const m = new THREE.Mesh(mergeGeos(BK[k]), MAT[k]); m.castShadow = !['glass', 'bulb', 'glassL', 'screen'].includes(k); m.receiveShadow = true; scene.add(m); }
  const avi = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xff2010, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); avi.scale.setScalar(3); avi.position.set(...G.avi); scene.add(avi); G.aviS = avi;
  const lg = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0xfff0c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .8})); lg.scale.setScalar(14); lg.position.set(...G.lh); scene.add(lg);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 160, 32, 1, true), beamMat(0xfff2d0, .32));
  beam.geometry.translate(0, -80, 0); beam.geometry.rotateX(-PI / 2 + .04); const bg = new THREE.Group(); bg.add(beam); scene.add(bg); G.lhBeam = bg;
  extBuoys();
  G.ghostS = G.ghostLights.map(p => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map: TX.glow, color: 0x6affb0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false})); s.scale.setScalar(2.4); s.position.set(...p); scene.add(s); return s; });
  G.homeLamps = [G.shedLamp, [0, 4.5, -236, 1.2]];
  $('load').classList.add('hidden');
}
// graphics level: shadows (both casters fixed, so no shader swaps at runtime), the post chain on High, exposure carries the brightness
function applyGfx() {
  const hi = SET.gfx === 'high';
  if (RND.shadowMap.enabled !== hi || moon.castShadow !== hi || flash.castShadow !== hi) { RND.shadowMap.enabled = hi; moon.castShadow = flash.castShadow = hi; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
  POST.on = hi; if (hi) postInit(); RND.toneMappingExposure = (hi ? 1 : 1.15) * SET.bright;
}
function startGame(seed, crew, sv) {
  buildWorld(); aInit(); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  D = DIFF[G.diff || SET.diff] || DIFF.normal; G.guestGame = Net.role === 'guest';
  G.casOpen = false; G.helpOpen = false; G.shopOpen = false; G.noteOpen = false; ['casino', 'fishHelp'].forEach(id => $(id).classList.add('hidden'));
  applyGfx();
  G.seed = seed; WR = mulberry(seed); CR = mulberry(seed ^ 0x5bd1e995); placeSunk(seed);
  Object.assign(G, {on: true, t: 0, evq: [], holdP: {}, noteOpen: false, paused: false, spec: 0, whT: 0, poseT: 0, sendT: 0, power: false, bbOut: false, spines: null, alarmT: 0, objLast: '', shake: 0, storm: 0, stormOn: false, stormT: 200, tod: .015, todPh: -1, enc: null, deepT: 40, shopOpen: false, cash: 0, earned: 0, disc: [], goals: [], floats: []});
  for (const f of G.flares) scene.remove(f.m); G.flares = []; VALVES.forEach(v => v.open = false); MAT.bulb.emissiveIntensity = 0; MAT.screen.emissiveIntensity = 0;
  DIGS.forEach(d => { d.dug = false; d.rev = false; });
  B.up = {engine: 0, tank: 0, hull: 0, light: 0, sonar: 0, hold: 0, crane: 0, cls: 0}; B.hold = []; B.dep = B.dtar = 0;
  G.cruise = 0; if (sv) { G.cruise = sv.cruise || 0; G.cash = sv.cash || 0; G.earned = sv.earned || 0; Object.assign(B.up, sv.up || {}); G.disc = (sv.disc || []).slice(); G.goals = (sv.goals || []).slice(); }
  if (!BOAT || BOAT.userData.cls !== (B.up.cls || 0)) buildBoat();
  if (!Array.isArray(B.up.own)) B.up.own = [...new Set([0, B.up.cls || 0])]; for (const k of ['paints', 'glows']) if (!Array.isArray(B.up[k])) B.up[k] = [...new Set([0, B.up[k.slice(0, -1)] || 0])]; G.bn = -1; if (isHost() && sv) { for (const k of sv.hold || []) if (KINDS.includes(k) && holdFits(k)) B.hold.push(k); (sv.dg || []).forEach((v, i) => { const d = DIGS[i]; if (!d || !v) return; d.rev = true; if (v & 2) d.dug = true; }); G.bbOut = !!sv.bb; G.bn = sv.bn ?? -1; }
  Object.assign(B, {x: JETTY.x - 2.1 - BG.hw, z: JETTY.z + 3 + Math.max(0, BG.L - 12) * .5, yaw: PI, v: 0, yr: 0, trim: 0, thr: 0, st: 0, driver: null, got: 0, sink: 0, sinkY: 0, dep: 0, dtar: 0}); B.fuel = tankMax(); B.hull = hullMax();
  Object.assign(LK, {st: 0, t: 0, w: 0, ent: -1, tw: 0, wv: 0}); B.hat = 1; SUBC.dq = 0; G.hatA = G.lkI = G.lkO = G.mastU = null; if (P && P.scope) subScope(0);
  for (const p of PL.values()) { if (p.av) scene.remove(p.av); if (p.tag) p.tag.remove(); } PL.clear();
  syncCrew(crew);
  [...PL.values()].forEach((p, i) => { const sp = boatSpawn(i); p.ob = 1; p.bl = sp.bl; const [x, z] = bL2W(p.bl[0], p.bl[1]); p.x = x; p.z = z; p.y = sp.y; p.rx = x; p.ry = p.y; p.rz = z; p.lx = x; p.lz = z; p.yaw = B.yaw; });
  loadGear(); Object.assign(P, {eq: 1, sack: [], heldF: 0, reload: 0, coolerN: 0, coolerV: 0, ready: true, vx: 0, vz: 0, vy: 0, stam: 1, bat: 1, flares: 2, breath: 1, gasp: 0, bob: 0, stepD: 0, fear: 0, eye: 1.62, l: 0, cr: 0, hd: -1, sw: 0, seat: 0, lastBY: B.yaw, drowned: false, carry: null});
  if (isHost() && sv) { for (const k of sv.sk || []) if (CARRY.has(k) && sackFits(P, k)) P.sack.push(k); if (P.sack.length) sackSet(P); P.cooler = (sv.co || []).map(e => Array.isArray(e) ? e : FISH[e] ? [e, FISH[e].v] : null).filter(Boolean); P.coolerN = P.cooler.length; P.coolerV = coolerVal(P.cooler); if (sv.fl != null) P.flares = Math.min(6, sv.fl); }
  F.st = 'idle'; placeItems(); G.seedItems = ITEMS.length; applyAll();
  for (let i = 0; i < FLM.length; i++) if (FLM[i]) { scene.remove(FLM[i].m); FLM[i] = null; }
  G.floats = []; for (let i = 0; i < MAP_FLN; i++) spawnFloat(i);
  if (isHost() && (!sv || !sv.earned)) { const jd = q => Math.hypot(q.x - JETTY.x, q.z - JETTY.z), I = ISLES.filter(q => !q.bar && !nearRig(q.x, q.z) && jd(q) < 900).sort((a, b) => jd(a) - jd(b))[0]; if (I) { const ux = (I.x - JETTY.x) / jd(I), uz = (I.z - JETTY.z) / jd(I); [70, 120, 180].forEach((r, i) => { let x = 0, z = 0; for (let k = 0; k < 12; k++) { const s = (k + 1 >> 1) * (k % 2 ? 6 : -6); x = JETTY.x + ux * r + uz * s; z = JETTY.z + uz * r - ux * s; if (!OBST.some(o => o.c && Math.hypot(x - o.x, z - o.z) < o.r + 12)) break; } G.floats[i] = [x, z, KINDS.indexOf('crate')]; }); } }
  Object.assign(M, {hp: D.mhp, x: -4, z: 6, y: LV[2], state: 'roam', path: [], idle: 2, aware: 0, lostT: 0, flee: 0, sawHide: -1, stuck: 0, screamT: 0, spd: 0, look: 0, tgt: null, preyT: 0, avoidT: 0, vy: 0, wet: 0});
  M.tx = M.x; M.ty = M.y; M.tz = M.z; M.tyaw = 0;
  ['slats', 'breath', 'map', 'note', 'end', 'pause', 'menu', 'lobby', 'shop'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); lockMouse();
  const hi = POIS.findIndex(q => q.home); if (!G.disc.includes(hi)) G.disc.push(hi);
  G.stat = Object.assign({fish: 0, maxKg: 0, kills: 0, deaths: 0, maxDv: 0, play: 0}, (sv && sv.stat) || {}); G.stat.k = G.stat.k || {}; G.rankI = titleOf(G.earned); G.helmDone = G.earned > 0; G.camFly = null; G.endOpen = false; if (G.earned > 0) for (const i of [9, 10]) if (!G.goals.includes(i)) G.goals.push(i); if (G.disc.length >= 4 && !G.goals.includes(11)) G.goals.push(11); Object.assign(G, {cashShown: G.cash, cashLast: G.cash, banQ: [], banA: 0, banE: 0, mkDone: null, mkKey: null, mkCur: null, progT: 0, progK: '', mapWas: false, objT: 0}); $('banner').className = '';
  const it = $('intro'); it.innerHTML = sv && sv.disc && sv.disc.length > 1 ? `${TITLES[titleOf(G.earned)][1]} ${String(P.name).replace(/[<>&]/g, '')}. Back at the lighthouse.<br>${cashStr(G.cash)} in the tin, ${G.disc.length} places on the chart.<br><br>The sea is waiting.` : 'A boat, a lighthouse, and a long night of open sea.<br>Find salvage. Sell it. Fix up the boat.<br><br>And stay out of deep water.';
  it.classList.remove('hidden'); it.style.opacity = 1; setTimeout(() => it.style.opacity = 0, TEST ? 0 : 4000); setTimeout(() => it.classList.add('hidden'), TEST ? 0 : 6000); G.introT = TEST ? 0 : 5.5;
}
function step(dt) {
  if (isHost()) hostStep(dt);
  else { const k = Math.min(1, dt * 10); if (STS.tx != null) { STS.x = mix(STS.x, STS.tx, k); STS.y = mix(STS.y, STS.ty, k); STS.z = mix(STS.z, STS.tz, k); STS.yaw += angD(STS.yaw, STS.tyaw) * k; } if (M.tx != null) { M.x = mix(M.x, M.tx, k); M.y = mix(M.y, M.ty, k); M.z = mix(M.z, M.tz, k); M.yaw += angD(M.yaw, M.tyaw) * k; } G.t += dt; }
  stepPlayer(dt); stepInteract(dt); stepFlares(dt); stepGear(dt);
  G.whT -= dt;
  if (Net.role !== 'solo') {
    if ((G.poseT -= dt) <= 0) { G.poseT = .05; const p = myPose(); if (isHost()) p.from = 'H'; Net.send(p); }
    if (Net.role === 'host') { stalePoses(); if ((G.sendT -= dt) <= 0) { G.sendT = 1 / 15; if (Net.ws && Net.ws.readyState === 1) Net.send(packSnap()); else { G.evq = G.evq.filter(e => !/^(mstep|sstep|snd|shot)$/.test(e.k)); if (G.evq.length > 500) G.evq.splice(0, G.evq.length - 500); } } }
    else if (Net.ws && Net.ws.readyState === 1 && !G.lostT && performance.now() - (G.lastSnapT || 0) > 2500) { if (!G.snapGap) showMsg('Waiting for the captain…', '', 4); G.snapGap = 1; } else G.snapGap = 0;
  } else G.evq.length = 0;
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').style.opacity = 0; }
}
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, Math.max(0, (t - last) / 1000)); last = t;
  if (!BUILT) return;
  if (G.on && !((G.paused || anyPanel()) && Net.role === 'solo')) step(dt);
  render(dt);
}
// ---------------- post (High): HDR scene -> bloom -> grade -> ACES
const POST = {on: false, ex: 1.1};
function postInit() {
  const w = Math.max(2, innerWidth), h = Math.max(2, innerHeight), pr = RND.getPixelRatio();
  if (!POST.rt) {
    POST.rt = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 2}); POST.a = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType}); POST.b = POST.a.clone();
    const V = 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const mk = (u, f) => new THREE.ShaderMaterial({uniforms: u, vertexShader: V, fragmentShader: f, depthTest: false, depthWrite: false, toneMapped: false});
    POST.bright = mk({t: {value: null}}, 'varying vec2 vU; uniform sampler2D t; void main(){ vec3 c = min(max(texture2D(t, vU).rgb, vec3(0.)), vec3(64.)); if (any(isnan(c))) c = vec3(0.); float l = dot(c, vec3(.3,.59,.11)); gl_FragColor = vec4(c * smoothstep(.85, 2.2, l) / max(l, 1e-3) * min(l, 6.), 1.); }');
    POST.blur = mk({t: {value: null}, d: {value: new THREE.Vector2()}}, 'varying vec2 vU; uniform sampler2D t; uniform vec2 d; void main(){ vec3 c = texture2D(t, vU).rgb * .227; c += (texture2D(t, vU + d * 1.385).rgb + texture2D(t, vU - d * 1.385).rgb) * .316; c += (texture2D(t, vU + d * 3.23).rgb + texture2D(t, vU - d * 3.23).rgb) * .07; gl_FragColor = vec4(c, 1.); }');
    POST.rays = mk({t: {value: null}, sp: {value: new THREE.Vector2(.5, .5)}}, 'varying vec2 vU; uniform sampler2D t; uniform vec2 sp; void main(){ vec2 d = (sp - vU) / 36.; vec2 p = vU; vec3 s = vec3(0.); float w = 1.; for (int i = 0; i < 36; i++) { s += texture2D(t, p).rgb * w * (1. - smoothstep(.06, .32, distance(p, sp))); w *= .93; p += d; } gl_FragColor = vec4(s / 9., 1.); }');
    POST.c = POST.a.clone();
    POST.comp = mk({t: {value: null}, bl: {value: null}, rays: {value: null}, ex: {value: 1}, fear: {value: 0}, ti: {value: 0}, uw: {value: 0}, ca: {value: 0}, sunV: {value: 0}, sp: {value: new THREE.Vector2(.5, .5)}},
      `varying vec2 vU; uniform sampler2D t, bl, rays; uniform float ex, fear, ti, uw, ca, sunV; uniform vec2 sp;
      vec3 aces(vec3 v){ v *= .6; return clamp((v * (2.51 * v + .03)) / (v * (2.43 * v + .59) + .14), 0., 1.); }
      void main(){ vec2 uv = vU; if (uw > 0.) uv += vec2(sin(vU.y * 23. + ti * 2.1), cos(vU.x * 19. + ti * 1.7)) * .004 * uw;
        vec2 dc = uv - .5; float cb = ca * dot(dc, dc);
        vec3 c = min(max(vec3(texture2D(t, uv - dc * cb).r, texture2D(t, uv).g, texture2D(t, uv + dc * cb).b), vec3(0.)), vec3(64.)) + texture2D(bl, uv).rgb * .55; if (any(isnan(c))) c = vec3(0.);
        c += texture2D(rays, uv).rgb * sunV * vec3(1., .85, .65);
        if (sunV > 0.) { vec2 g1 = dc * -.7 + .5, g2 = dc * -1.4 + .5, g3 = dc * .45 + .5; // ghosts only of the sun itself
          c += texture2D(bl, g1).rgb * vec3(.09, .06, .03) * sunV * (1. - smoothstep(0., .2, distance(g1, sp))); c += texture2D(bl, g2).rgb * vec3(.03, .06, .09) * sunV * (1. - smoothstep(0., .2, distance(g2, sp))); c += texture2D(bl, g3).rgb * vec3(.06, .05, .02) * sunV * (1. - smoothstep(0., .2, distance(g3, sp))); }
        c = mix(c, c * vec3(.32, .78, .82) + vec3(0., .004, .006), uw);
        c *= ex; float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c, c * vec3(.92, 1.0, 1.12), smoothstep(.25, 0., l) * .6); c = mix(c, c * vec3(1.08, 1., .9), smoothstep(.3, 1.5, l) * .5);
        c = aces(c); c = mix(c, c * c * (3. - 2. * c), .25); float g = dot(c, vec3(.2126,.7152,.0722)); c = mix(vec3(g), c, 1.22 - fear * .55);
        vec2 q = vU - .5; c *= 1. - dot(q, q) * (.55 + fear * .6);
        c = pow(c, vec3(1. / 2.2)); c += (fract(sin(dot(vU * 917. + ti, vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255.;
        gl_FragColor = vec4(c, 1.); }`);
    POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), POST.bright); POST.quad.frustumCulled = false; POST.qs = new THREE.Scene(); POST.qs.add(POST.quad); POST.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  POST.rt.setSize(w * pr, h * pr); const bw = Math.max(2, Math.round(w * pr / 4)), bh = Math.max(2, Math.round(h * pr / 4)); POST.a.setSize(bw, bh); POST.b.setSize(bw, bh); POST.c.setSize(bw, bh); POST.bw = bw; POST.bh = bh;
}
const _sv = new THREE.Vector3();
function sunVis() { if (!POST.sp) POST.sp = new THREE.Vector2(); if ((G.uw || 0) > .5) return 0; _sv.copy(SUNDIR).multiplyScalar(1000).add(cam.position).project(cam); if (_sv.z > 1 || cam.getWorldDirection(_fw).dot(SUNDIR) < 0) return 0;
  const e = Math.max(Math.abs(_sv.x), Math.abs(_sv.y)); POST.sp.set(_sv.x * .5 + .5, _sv.y * .5 + .5); return clamp(1.5 - e, 0, 1) * clamp((TOD.el + 2) / 5, 0, 1) * (1 - G.storm) * .7; }
function postPass(m, src, dst) { POST.quad.material = m; m.uniforms.t.value = src; RND.setRenderTarget(dst); RND.render(POST.qs, POST.qc); }
function postRender() {
  RND.setRenderTarget(POST.rt); RND.render(scene, cam);
  postPass(POST.bright, POST.rt.texture, POST.a);
  for (let i = 0; i < 2; i++) { POST.blur.uniforms.d.value.set(1 / POST.bw, 0); postPass(POST.blur, POST.a.texture, POST.b); POST.blur.uniforms.d.value.set(0, 1 / POST.bh); postPass(POST.blur, POST.b.texture, POST.a); }
  const sv = sunVis(); if (sv > 0) { POST.rays.uniforms.sp.value.copy(POST.sp); postPass(POST.rays, POST.a.texture, POST.c); }
  const u = POST.comp.uniforms; u.rays.value = POST.c.texture; u.sunV.value = sv; u.uw.value = G.uwC ?? G.uw ?? 0; u.ca.value = (P ? clamp(P.fear || 0, 0, 1) : 0) * .03 + (G.shake || 0) * .02 + (G.uwC ?? G.uw ?? 0) * .02; if (POST.sp) u.sp.value.copy(POST.sp); u.bl.value = POST.a.texture; u.ex.value = POST.ex; u.fear.value = P ? clamp(P.fear || 0, 0, 1) : 0; u.ti.value = G.wt % 10; postPass(POST.comp, POST.rt.texture, null);
}
addEventListener('resize', () => { if (POST.rt) postInit(); });
const DYN = {pr: Math.min(devicePixelRatio || 1, 1.25), max: Math.min(devicePixelRatio || 1, 1.25), ft: 1 / 60, t: 0, n: 0};
function dynRes(dt) {
  // adaptive resolution: drop the render scale when frames get slow; raise it only after 3 fast windows in a row and never within 8 s of a drop
  DYN.ft = mix(DYN.ft, dt, .05); DYN.t += dt; DYN.hold = Math.max(0, (DYN.hold || 0) - dt); if (DYN.t < 1.5 || G.prLock) return; DYN.t = 0;
  let pr = DYN.pr; if (DYN.ft > 1 / 42 && pr > .55) { pr = Math.max(.55, pr - .1); DYN.hold = 8; DYN.ok = 0; }
  else if (DYN.ft < 1 / 57 && pr < DYN.max) { DYN.ok = (DYN.ok || 0) + 1; if (DYN.ok >= 3 && DYN.hold <= 0) { pr = Math.min(DYN.max, pr + .05); DYN.ok = 0; } } else DYN.ok = 0;
  pr = Math.round(pr * 20) / 20; if (pr === DYN.pr) return; DYN.pr = pr;
  if (Math.floor(innerWidth * pr) === canvas.width && Math.floor(innerHeight * pr) === canvas.height) return; // same buffer: skip the resize
  RND.setPixelRatio(pr); resize(); if (POST.rt) postInit();
}
function render(dt) {
  dynRes(dt); G.fr = (G.fr || 0) + 1;
  G.cine = Math.max(0, (G.cine || 0) - dt);
  if (!G.on) { if (!G.drawn) { G.drawn = true; RND.render(scene, cam); } return; }
  updateWorldFx(dt); boatPose(dt); updateRemotes(dt); const md = Math.hypot(cam.position.x - M.x, cam.position.z - M.z), mon = md < 220 || (G.js && G.js.t > 0 && G.js.mon === MON); if (mon) animCreature(dt, M.state, M.spd); else MON.visible = false;
  { const sd = Math.hypot(cam.position.x - STS.x, cam.position.z - STS.z); STW.visible = sd < 160; if (sd < 160) animBody(STW, SJ, STS, dt, STS.state, STS.spd); } drawGulpers(dt); stepDrops(dt); casStep(dt); stepRadio(dt); stepFw(dt); stepFireflies(dt); updateCamera(dt); updateTools(dt); stepFear(dt); hud();
  if (G.map) drawMap(); if ((grainT += dt) > .05) { grainT = 0; grain(); }
  if (RND.shadowMap.enabled) { RND.shadowMap.needsUpdate = true; moon.shadow.autoUpdate = flash.shadow.autoUpdate = false; moon.shadow.needsUpdate = TOD.kI > .05 && (G.fr % 2 === 0 || G.fr < 5); flash.shadow.needsUpdate = flash.intensity > 0 && (G.fr % 2 === 1 || G.fr < 5); } if (POST.on) postRender(); else RND.render(scene, cam);
}

// ---------------- menu, lobby
const myName = () => (SET.name || 'Deckhand').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Deckhand';
function crewList() { return [{id: 'H', name: myName(), c: 0}, ...[...Net.peers.values()].map(p => ({id: p.id, name: p.name, c: p.c}))]; }
function show(id) { ['menu', 'lobby', 'end', 'pause', 'shop', 'casino', 'fishHelp'].forEach(k => $(k).classList.toggle('hidden', k !== id)); G.casOpen = G.helpOpen = G.shopOpen = false; }
function lobby() { const L = crewList(); $('crew').innerHTML = L.map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === 'H' ? ' <small style="color:var(--dim)">host</small>' : ''}</div>`).join(''); if (Net.role === 'host') Net.send({t: 'lobby', crew: L}); }
function hostStart() { G.diff = SET.diff; const seed = (Math.random() * 1e9) | 0, crew = crewList(), sv = loadSave(); Net.started = true; Net.meta(Net.peers.size < 5); Net.send({t: 'start', seed, crew, diff: G.diff, sv, v: GAME_V, al: ALL ? 1 : 0}); startGame(seed, crew, sv); }
Net.on('_lobby', () => { if (!G.on) lobby(); });
Net.on('_join', m => { if (G.on && Net.role === 'host') { const crew = crewList(), op = PL.get(m.id); if (op && op.ready) { Net.send({t: 'crew', crew}); return; } syncCrew(crew); const np = PL.get(m.id); if (np) { const sp = boatSpawn(PL.size - 1); np.ob = 1; np.bl = sp.bl; np.y = sp.y; } if (!np || !np.startT || performance.now() - np.startT > 4000) { if (np) np.startT = performance.now(); Net.send1(m.id, {t: 'start', seed: G.seed, crew, diff: G.diff, late: 1, v: GAME_V, al: ALL ? 1 : 0, ex: ITEMS.slice(G.seedItems || ITEMS.length).map(i => [i.kind, +i.x.toFixed(2), +i.y.toFixed(2), +i.z.toFixed(2), i.text || '']), sv: {cash: G.cash, earned: G.earned, up: B.up, disc: G.disc, goals: G.goals, cruise: G.cruise || 0}}); } Net.send({t: 'crew', crew}); showMsg(`${np ? np.name : 'Someone'} joined the crew.`); } });
Net.on('_left', m => { if (!G.on) { lobby(); return; } const crew = crewList(); syncCrew(crew); Net.send({t: 'crew', crew}); showMsg(`${m.name || 'Someone'} left.`); });
Net.on('_hostlost', () => { if (!G.on) { toMenu('The host left.'); return; } showMsg('Lost contact with the captain… holding position.', '', 20); clearTimeout(G.lostT); G.lostT = setTimeout(() => toMenu('The host left.'), 20000); });
Net.on('_hostback', () => { if (!G.lostT) return; clearTimeout(G.lostT); G.lostT = 0; if (G.on) showMsg('Back in contact.', '', 3); });
Net.on('_drop', () => showMsg('Connection dropped. Reconnecting…', '', 6));
Net.on('_back', () => showMsg('Reconnected.', '', 3));
Net.on('bye', () => { if (Net.role === 'guest') toMenu('The captain ended the voyage.'); });
Net.on('lobby', m => { $('crew').innerHTML = (m.crew || []).map(p => `<div><i style="background:${hexS(CREW_COL[p.c % 6])}"></i>${String(p.name).replace(/[<>&]/g, '')}</div>`).join(''); $('lmsg').textContent = 'Waiting for the captain to cast off…'; });
Net.on('start', m => { if (Net.role !== 'guest') return; if (m.v !== GAME_V) { toMenu('You and the captain have different versions. Reload the page.'); return; } G.hostAll = !!m.al;
  if (G.on && m.late && m.seed === G.seed) { if (m.crew.some(c => c.id === Net.id)) { syncCrew(m.crew); if (P) P.seat = 0; } return; } // back after a reconnect: keep playing
  G.diff = m.diff; startGame(m.seed, m.crew, m.sv); if (m.ex) for (const [kind, x, y, z, text] of m.ex) addItem(kind, {x, y, z}, text ? {text} : {}); G.lastSnapT = performance.now(); G.snapGap = 0; G.pwQuiet = m.late ? 1 : 0; if (m.late) showMsg('You came aboard late.'); });
Net.on('crew', m => { if (!G.on || Net.role !== 'guest') return; if (!(m.crew || []).some(c => c.id === Net.id)) { if (performance.now() - (Net.helloT || 0) > 2000) { Net.helloT = performance.now(); Net.send({t: 'hello', name: Net.name}); } return; } syncCrew(m.crew); });
function toMenu(why) {
  if (G.on) save(); if (Net.role === 'host' && Net.peers.size) Net.send({t: 'bye'}); Net.close(); hiddenStep(false); G.on = false; show('menu'); $('hud').classList.add('hidden'); $('fearV').style.opacity = 0; $('downV').style.opacity = 0; $('slats').classList.add('hidden');
  if (A.ctx) { A.ctx.resume(); for (const g of [A.pad, A.drone, A.mGrowl, A.mBreath.g, A.genG, A.alarmG, A.deepG, A.engG]) g.gain.value = 0; for (const g of A.mute || []) g.gain.value = 0; }
  try { document.exitPointerLock(); } catch (e) {} $('err').textContent = why || ''; refreshRooms(); saveInfo();
}
// host: guests who stop sending poses (tab hidden, lag, gone) stop holding keys and, after 15 s, leave the helm
function stalePoses() { const t = performance.now(); for (const p of PL.values()) { if (p === P || p.poseT == null) continue; const a = t - p.poseT; if (a > 1000) p.h = ''; if (a > 15000 && p.seat && B.driver === p.id) emit({k: 'helm', id: p.id, on: 0}); } }
// host in a background tab: rAF stops, so a worker clock keeps the sea running (true starts it, false stops it, no argument = one tick)
function hiddenStep(on) {
  const H = hiddenStep;
  if (on === true) { if (H.w || Net.role !== 'host' || !G.on) return; try { H.u = H.u || URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], {type: 'text/javascript'})); H.w = new Worker(H.u); H.t = performance.now(); H.w.onmessage = () => hiddenStep(); } catch (e) { H.w = null; } return; }
  if (on === false || !document.hidden || Net.role !== 'host' || !G.on) { if (H.w) { H.w.terminate(); H.w = null; last = performance.now(); } return; }
  const t = performance.now(), dt = Math.min(.1, (t - H.t) / 1000); H.t = t; if (dt > 0) step(dt);
}
Net.on('_idle', () => { if (Net.role !== 'guest' || !G.on || !P) return; const p = myPose(); p.in = [0, 0, 0]; p.h = ''; Net.send(p); if (P.seat) act({a: 'unhelm'}); });
addEventListener('blur', () => Net.emit({t: '_idle'}));
document.addEventListener('visibilitychange', () => { hiddenStep(document.hidden); if (document.hidden) Net.emit({t: '_idle'}); });
addEventListener('pagehide', () => { if (Net.role === 'host' && Net.peers.size) Net.send({t: 'bye'}); });
function saveInfo() { const s = loadSave(); $('saveInfo').textContent = s && (s.disc || []).length > 1 ? `Saved voyage: ${cashStr(s.cash || 0)} cash, ${(s.disc || []).length} places charted, ${(s.goals || []).length}/${GOALS.length} goals.` : ''; }
async function refreshRooms() { const L = await Net.rooms(), el = $('rooms'); el.innerHTML = L.length ? '' : '<small style="color:var(--dim)">No open crews right now. Host one and share the code.</small>'; for (const r of L) { const d = document.createElement('div'), full = r.n >= 6; d.textContent = r.name.replace(/^\[?Rig\]? /, '') + (full ? ' · full' : r.n ? ` · ${r.n}/6` : ''); if (full) d.style.cssText = 'opacity:.4;pointer-events:none'; else d.onclick = () => joinRoom(r.code); el.appendChild(d); } }
function joinRoom(code) {
  code = String(code || '').toUpperCase(); if (!/^[A-Z]{5}$/.test(code)) { $('err').textContent = 'Enter the 5-letter code.'; return; }
  aInit(); buildWorld(); Net.join(code, myName(), why => { if (G.on) toMenu(why); else { show('menu'); $('err').textContent = why; } });
  $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); $('lmsg').textContent = 'Connecting…'; $('crew').innerHTML = '';
}
function menuInit() {
  document.querySelectorAll('.seg').forEach(s => { const k = s.dataset.k, upd = () => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === SET[k])); s.querySelectorAll('button').forEach(b => b.onclick = () => { SET[k] = b.dataset.v; saveSet(); upd(); }); upd(); });
  $('sens').value = SET.sens; $('sens').oninput = e => { SET.sens = +e.target.value; saveSet(); };
  $('bright').value = SET.bright; $('bright').oninput = e => { SET.bright = +e.target.value; saveSet(); };
  const setVol = v => { SET.vol = v; saveSet(); if (A.out) A.out.gain.value = 1.15 * v; };
  $('vol').value = SET.vol; $('vol').oninput = e => setVol(+e.target.value);
  $('pVol').oninput = e => setVol(+e.target.value); $('pSens').oninput = e => { SET.sens = +e.target.value; saveSet(); }; $('pBright').oninput = e => { SET.bright = +e.target.value; saveSet(); if (!POST.on) RND.toneMappingExposure = 1.15 * SET.bright; };
  document.querySelectorAll('[data-k=gfx] button').forEach(b => b.addEventListener('click', () => { if (G.on) applyGfx(); document.querySelectorAll('[data-k=gfx] button').forEach(q => q.classList.toggle('on', q.dataset.v === SET.gfx)); }));
  $('name').value = SET.name; $('name').oninput = e => { SET.name = e.target.value; saveSet(); };
  $('bSolo').onclick = () => { Net.close(); G.diff = SET.diff; startGame((Math.random() * 1e9) | 0, [{id: 'H', name: myName(), c: 0}], loadSave()); };
  $('bHost').onclick = () => { aInit(); buildWorld(); const code = Net.host(myName(), s => { if (G.on) { if (s === 'open') showMsg('Reconnected.', '', 3); else showMsg('Relay connection dropped. Reconnecting…', '', 6); return; } $('lmsg').textContent = s === 'open' ? 'Share the code. Up to 6 crew. Friends can join mid-voyage.' : 'Connection lost, retrying…'; }); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('lmsg').textContent = 'Connecting…'; lobby(); };
  $('bJoin').onclick = () => joinRoom($('joinC').value); $('joinC').onkeydown = e => { if (e.key === 'Enter') joinRoom($('joinC').value); };
  $('bGo').onclick = hostStart; $('bLeave').onclick = () => toMenu(); $('resume').onclick = resumeReq; $('quit').onclick = () => { if (Net.role === 'host' && Net.peers.size && !confirm('Leaving ends the voyage for your crew. Leave?')) return; toMenu(); }; $('endMenu').onclick = () => toMenu();
  $('pFov').oninput = e => { SET.fov = +e.target.value; saveSet(); }; $('pInv').onchange = e => { SET.inv = e.target.checked ? 1 : 0; saveSet(); };
  $('pKeys').innerHTML = keyTable(KEYMAP); $('mKeys').innerHTML = keyTable(KEYMAP.slice(0, 9));
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) { const w = document.createElement('div'), bs = ['bSolo', 'bHost', 'bJoin'].map($); w.className = 'err'; w.innerHTML = 'Station Nine needs a keyboard and mouse. Open it on a computer. <a href="#" class="back">Try anyway</a>'; $('menu').querySelector('h1').after(w); bs.forEach(b => b.disabled = true);
    w.querySelector('a').onclick = e => { e.preventDefault(); bs.forEach(b => b.disabled = false); e.target.remove(); }; }
  $('again').onclick = () => toMenu();
  $('bSell').onclick = () => { act({a: 'sell'}); setTimeout(drawShop, 150); }; $('shopX').onclick = closeShop;
  $('resetSave').onclick = e => { e.preventDefault(); if (confirm('Wipe your saved voyage (cash, upgrades, chart)?')) { try { localStorage.removeItem(SK('s9-save2')); } catch (x) {} saveInfo(); } };
  const allUI = msg => { $('cheatM').innerHTML = (msg ? msg + ' ' : '') + (ALL ? 'Unlock-all is on (it has its own save). <a href="#" id="allOff" style="color:inherit">Turn off</a>' : ''); const o = $('allOff'); if (o) o.onclick = e => { e.preventDefault(); setAll(false); }; }; const setAll = on => { if (G.on) { allUI('Finish your voyage first.'); return; } ALL = on; try { localStorage.setItem('s9-all', on ? '1' : '0'); } catch (e) {} saveInfo(); allUI(on ? 'Everything unlocked.' : 'Back to your normal save.'); }; allUI(); $('bCheat').onclick = () => { const v = $('cheat').value.trim().toLowerCase(); if (v === 'rig67') { setAll(!ALL); Snd.coin && A.on && Snd.coin(); } else $('cheatM').textContent = v ? 'Nothing happens.' : ''; $('cheat').value = ''; };
  $('cheat').onkeydown = e => { if (e.key === 'Enter') $('bCheat').click(); };
  casInit();
  $('note').onclick = closeNote; $('fishHelpX').onclick = () => showFishHelp(false);
  refreshRooms(); saveInfo(); setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshRooms(); }, 8000);
}
menuInit();
setTimeout(() => { buildWorld(); requestAnimationFrame(frame); }, 30);
if (TEST) window.__S = {closeCasino, BOAT_: () => BOAT, BSPOT, FX, BHELM, bL2W, openCasino, AURAS, applyAll, launchFw, FWK, get ALL() { return ALL; }, get BOAT() { return BOAT; }, CN, CRZ, STS, GUL, DSITES, stepSteward, HULLS, SUNK, BG, BDECK, buildBoat, seaBed, render, levPose, LEV, MJ, TODd: () => SUNDIR, TOD, F, FISH, GEAR, equip, toolDown, toolUp, gotGear, pickFish, hostShoot, G, PL, M, B, K, SET, VALVES, ITEMS, HIDES, BLD, SPOTS, NG, SURF, POIS, DIGS, ISLES, Net, get P() { return P; }, startGame, step, hostStep, hostAct, act, targets, toggleHide, cam, scene, RND, noise, downPlayer, floorAt, navPath, applyEv, boatPose, landH, openShop, set eDown(v) { eDown = v; }, crewList, hostStart, joinRoom};
