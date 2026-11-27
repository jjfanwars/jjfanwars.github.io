'use strict';
// Lucas Space Program multiplayer (26 Nov 2026). Rooms on the shared jjfanwars relay (relay/worker.js Room: one host + up to 7 guests, all over WebSocket).
// Authority: whoever sits in the Pilot seat runs the rocket physics and the clock (NET.auth); everyone else mirrors the rocket from its snapshots ('rs', 15 Hz)
// and walks their own body (poses 'po', 10 Hz). The host arbitrates the pilot seat ('authReq' -> 'auth') and takes over when the pilot leaves.
// Shared: ship design ('ship'), stations ('ves'), the burn node ('nd': a Navigator can plan burns for the Pilot), chat ('ch'), waves.
// Own ships (27 Nov 2026): the shared rocket is the "crew ship"; a guest can also launch a ship of their own (NET.own). They simulate it themselves,
// send its design ('od') and snapshots ('os'), and everyone else draws it as a ghost model (NET.ships). The clock stays with the crew authority.
// Loaded after ui.js, before polish.js (which calls boot()).

const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const Net = {
  tag: '[LSP]', role: 'solo', ws: null, peers: new Map(), code: '', relayT: {po: 1, rs: 1, ch: 1, ship: 1, ves: 1, nd: 1, em: 1, od: 1, os: 1, ox: 1}, id: '', name: '', handlers: {}, retry: 0,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) { if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} } else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} } },
  send1(id, o) { if (!this.ws || this.ws.readyState !== 1) return; const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  meta(open) { try { this.ws.send(JSON.stringify({c: 'meta', name: this.tag + ' ' + this.name + "'s crew", open})); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) { this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peers = new Map(); this.onStatus = onStatus; this.hostConnect(); return this.code; },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(true); this.onStatus && this.onStatus('open'); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.emit({t: '_left', id: m.id, name: p.name}); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      if (m.t === 'hello') { if (!this.peers.has(id) && this.peers.size >= 4) { this.send1(id, {t: 'full'}); return; } const used = new Set([0, ...[...this.peers.values()].map(p => p.c)]); let c = 1; while (used.has(c)) c++;
        const p = {id, c, name: String(m.name || 'Astronaut').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Astronaut'}; const fresh = !this.peers.has(id); if (fresh) this.peers.set(id, p); this.emit({t: '_join', id, fresh}); return; }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id); if (this.relayT[m.t]) this.send(m);
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  join(code, name, onFail) {
    this.close(); this.role = 'guest'; this.code = code; this.name = name; this.id = Math.random().toString(36).slice(2, 11);
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer';
    // the relay sends {c:'host', up:true} on connect and when a host comes back: hello goes out then, once
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({t: '_hostgone'}); else if (m.c === 'host' && m.up) this.send({t: 'hello', name}); return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      if (m.t === 'full') { this.close(); onFail('That crew is full (5 astronauts).'); return; }
      if (m.from && m.from === this.id) return; this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No room with that code.' : ev.code === 4429 ? 'That room is full.' : 'Connection lost.'; this.ws = null; this.role = 'solo'; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 15000);
  },
  close() { if (typeof netReset === 'function') netReset(); clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(); return r.filter(x => x.open && x.name.startsWith(this.tag + ' ')); } catch (e) { return []; } },
};
const online = () => Net.role !== 'solo';
const myId = () => Net.role === 'guest' ? Net.id : 'H';
const NET = {auth: 'H', players: new Map(), gen: 0, snap: null, snapAt: 0, applying: false, sendT: 0, poseT: 0, lastNd: '', col: 0, chat: [], wave: 0,
  own: false, ogen: 0, slot: 1, ships: new Map(), crewShip: null, clk: null, odT: 0, odG: -1};
const clockMine = () => !online() || NET.auth === myId(); // the crew ship's pilot runs the clock (and the crew ship)
const isAuth = () => !online() || NET.own || NET.auth === myId(); // do I simulate my own R? (crew authority, or a ship of my own)
const myShip = () => NET.own ? myId() : 'C';
const CREW_COL = [0xD8342A, 0x2F6FD6, 0xF2B81E, 0x2F8F5B, 0x6B3FA0, 0xE07A1E];

// ---------------- avatars: a suited astronaut per remote player, with a name tag
const AV = {suit: new THREE.MeshStandardMaterial({color: 0xEDEDEA, roughness: .7}), visor: new THREE.MeshStandardMaterial({color: 0x1a2230, roughness: .05, metalness: .9, envMapIntensity: 1.6}), dark: new THREE.MeshStandardMaterial({color: 0x2a2c30, roughness: .6})};
function avatarMesh(col) { const g = new THREE.Group(), stripe = new THREE.MeshStandardMaterial({color: col, roughness: .55}), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.CapsuleGeometry(.24, .5, 6, 14), AV.suit, 0, 1.12, 0); add(new THREE.CylinderGeometry(.245, .245, .1, 16), stripe, 0, 1.18, 0);
  add(new THREE.SphereGeometry(.2, 20, 14), AV.suit, 0, 1.6, 0); const v = add(new THREE.SphereGeometry(.16, 20, 12, -1.2, 2.4, .7, 1.3), AV.visor, 0, 1.6, -.06); v.scale.z = .9;
  add(new THREE.BoxGeometry(.38, .46, .18), AV.suit, 0, 1.2, .25); add(new THREE.BoxGeometry(.3, .08, .19), stripe, 0, 1.41, .25);
  const legG = new THREE.CapsuleGeometry(.1, .5, 4, 10); const lg = [add(legG, AV.suit, -.11, .38, 0), add(legG, AV.suit, .11, .38, 0)]; for (const l of lg) add(new THREE.BoxGeometry(.16, .1, .26), AV.dark, l.position.x, .06, -.04);
  const armG = new THREE.CapsuleGeometry(.075, .42, 4, 10); armG.translate(0, -.24, 0); const arms = [-1, 1].map(s => { const a = add(armG, AV.suit, s * .32, 1.38, 0); a.rotation.z = s * .12; return a; });
  g.userData = {arms, legs: lg}; g.traverse(o => { if (o.isMesh) o.frustumCulled = false; }); return g; }
function playerOf(id) { let p = NET.players.get(id); if (!p) { p = {id, name: 'Astronaut', c: 1, g: null, tag: null, po: null, at: 0}; NET.players.set(id, p); } return p; }
function dropPlayer(id) { const p = NET.players.get(id); if (!p) return; if (p.g) scene.remove(p.g); if (p.tag) p.tag.remove(); NET.players.delete(id); }
const _a1 = new V3(), _a2 = new V3(), _aq = new Q4(), _am = new THREE.Matrix4();
function avatarsFrame(dt) {
  for (const [id, p] of NET.players) { const po = p.po; if (!po || id === myId()) continue;
    if (!p.g) { p.g = avatarMesh(CREW_COL[p.c % CREW_COL.length]); scene.add(p.g); p.tag = document.createElement('div'); p.tag.className = 'ntag'; document.body.appendChild(p.tag); }
    let ok = true; const g = p.g;
    if (po.m === 1) { // in the capsule: cabin coordinates turn with the rocket
      if (R.st === 'dead' || (po.sh || 'C') !== myShip()) ok = false; else { const lp = _a1.fromArray(po.p); lp.y -= R.comY; g.position.copy(lp).applyQuaternion(R.q).add(R.pos).sub(G.O); g.quaternion.copy(R.q).multiply(_aq.setFromAxisAngle(_cy, po.yaw)); }
      if (po.s >= 0) { g.userData.legs.forEach(l => { l.rotation.x = -1.4; l.position.y = .62; l.position.z = -.22; }); } else g.userData.legs.forEach(l => { l.rotation.x = 0; l.position.y = .38; l.position.z = 0; }); }
    else { const b = BODIES[po.b] || PLANET, wp = _a1.fromArray(po.p).applyQuaternion(b.q).add(b.c), up = _a2.fromArray(po.p).normalize().applyQuaternion(b.q), fw = new V3().fromArray(po.f).applyQuaternion(b.q);
      g.position.copy(wp).sub(G.O).addScaledVector(up, -1.65); fw.addScaledVector(up, -fw.dot(up)).normalize(); const rt = new V3().crossVectors(up, fw).normalize(); _am.makeBasis(rt.negate(), up, fw.negate()); g.quaternion.setFromRotationMatrix(_am);
      const sp = po.v || 0, ph = performance.now() / 1000 * 8; g.userData.legs.forEach((l, k) => { l.rotation.x = Math.sin(ph + k * Math.PI) * .5 * Math.min(1, sp / 3); l.position.y = .38; l.position.z = 0; }); }
    const wv = p.wave > performance.now(); g.userData.arms[1].rotation.z = wv ? -2.6 + Math.sin(performance.now() / 90) * .4 : .12;
    g.visible = ok && g.position.length() < 4000;
    // name tag
    _a2.copy(g.position).addScaledVector(_a1.set(0, 1, 0).applyQuaternion(g.quaternion), 2.05); const d = _a2.length(); _a2.project(cam); const vis = g.visible && _a2.z < 1 && Math.abs(_a2.x) < 1.05 && Math.abs(_a2.y) < 1.05 && !MAPV.on;
    p.tag.style.display = vis ? '' : 'none'; if (vis) { p.tag.style.transform = 'translate(' + ((_a2.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-_a2.y * .5 + .5) * innerHeight).toFixed(1) + 'px) translate(-50%,-100%)'; const t = p.name + (d > 40 ? ' · ' + fmtD(d) : ''); if (p.tag._t !== t) { p.tag._t = t; p.tag.textContent = t; p.tag.style.setProperty('--c', '#' + CREW_COL[p.c % CREW_COL.length].toString(16).padStart(6, '0')); } } }
}

// ---------------- sending: my pose (everyone), the rocket (the authority)
function myPose() { const o = {t: 'po', id: myId(), n: Net.name || SET.name || 'Astronaut', c: NET.col, sh: myShip()};
  if (R.on && C.in) Object.assign(o, {m: 1, p: [+C.pos.x.toFixed(2), +C.pos.y.toFixed(2), +C.pos.z.toFixed(2)], yaw: +C.yaw.toFixed(2), s: C.seat});
  else Object.assign(o, {m: 0, b: BODIES.indexOf(P.body), p: P.pos.toArray().map(v => +v.toFixed(2)), f: P.fwd.toArray().map(v => +v.toFixed(3)), v: +P.vel.length().toFixed(1)});
  return o; }
function rocketSnap() { return {t: 'rs', a: myId(), g: NET.gen, T: G.t, wi: G.wi, wt: R.warpTo, st: R.st, b: BODIES.indexOf(R.body), bot: R.bot, pos: R.pos.toArray(), vel: R.vel.toArray(), q: R.q.toArray(), w: R.w.toArray(), lp: R.lp.toArray(), lq: R.lq.toArray(),
  fu: R.fuel.map(f => Math.round(f)), thr: +R.thr.toFixed(3), lit: R.lit, F: Math.round(R.F), p: +R.p.toFixed(4), sp: +R.spool.toFixed(2), ch: R.chute, chA: +R.chA.toFixed(3), lg: R.legT, lgs: +R.legs.toFixed(2), fe: R.felt.toArray().map(v => +v.toFixed(2)), sas: R.sas, mach: +(R.mach || 0).toFixed(2), qd: Math.round(R.qd || 0),
  co: R.cargoOut || {}, cm: R.cargoM || []}; }
function netSend(dt) {
  if (!online() || !G.on) return;
  if ((NET.poseT -= dt) <= 0) { NET.poseT = .1; const o = myPose(); Net.send(o); const me = playerOf(myId()); me.po = o; me.name = o.n; me.c = NET.col; }
  if (NET.own) { if ((NET.odT -= dt) <= 0 || NET.odG !== NET.ogen) { NET.odT = 5; NET.odG = NET.ogen; Net.send({t: 'od', name: SHIP.name, parts: SHIP.parts, paint: SHIP.paint, g: NET.ogen, sl: NET.slot}); }
    if ((NET.sendT -= dt) <= 0) { NET.sendT = 1 / 15; const c = R.on ? WC0() : {mx: 99, why: ''}; Net.send(Object.assign(rocketSnap(), {t: 'os', g: NET.ogen, wc: c.mx, wy: c.why})); } return; }
  if (isAuth() && (NET.sendT -= dt) <= 0) { NET.sendT = 1 / 15; Net.send(rocketSnap()); }
  // the burn node is shared: whoever changes it tells everyone
  if (NET.own) return; const nd = NODE ? JSON.stringify({t: Math.round(NODE.t * 10) / 10, dv: [NODE.dv.x, NODE.dv.y, NODE.dv.z].map(v => Math.round(v * 10) / 10)}) : '';
  if (nd !== NET.lastNd) { NET.lastNd = nd; Net.send({t: 'nd', d: nd ? JSON.parse(nd) : null}); }
}

// ---------------- mirroring the rocket (everyone who is not the authority)
function applySnap(s) { NET.snap = s; NET.snapAt = performance.now();
  if (s.g !== NET.gen) { NET.gen = s.g; NET.applying = true; resetRocket(); NET.applying = false; }
  while (R.bot < s.bot && R.bot < STAGES.length - 1) dropStage();
  R.body = BODIES[s.b] || PLANET; R.lp.fromArray(s.lp); R.lq.fromArray(s.lq);
  if (s.st === 'dead' && R.st !== 'dead') { R.pos.fromArray(s.pos); NET.applying = true; explode(); NET.applying = false; }
  R.st = s.st; R.fuel = s.fu.slice(); R.thr = s.thr; R.lit = s.lit; R.F = s.F; R.p = s.p; R.spool = s.sp; R.chute = s.ch; R.chA = s.chA; R.legT = s.lg; R.legs = s.lgs; R.felt.fromArray(s.fe); R.sas = s.sas; R.mach = s.mach; R.qd = s.qd; R.w.fromArray(s.w); R.warpTo = 0;
  if (R.chute === 2 && R.sg.length) { const cap = R.sg[R.sg.length - 1]; if (cap.userData.chute) cap.userData.chute.visible = true; }
  if (s.cm && s.cm.length === STAGES.length) R.cargoM = s.cm.slice();
  for (const k in s.co) if (!(R.cargoOut || {})[k]) { R.cargoOut = R.cargoOut || {}; R.cargoOut[k] = 1; const [si, ii] = k.split(':').map(Number), g = R.sg[si]; if (g) for (const b of g.userData.bays || []) if (b.it.i === ii) { b.out = true; b.want = 1; b.mod.visible = false; } }
  R.comY = comOf();
  // the clock follows the authority (snap far jumps, nudge small drifts)
  G.wi = s.wi; G.warp = WARPS[s.wi] || 1; const tgt = s.T; if (Math.abs(tgt - G.t) > Math.max(2, G.warp * .5)) G.t = tgt; else G.t += (tgt - G.t) * .3; }
function mirrorStep(h, t) { const s = NET.snap; if (!s) return;
  if (s.st !== 'fly') { latch(t); return; }
  const age = t - s.T, tp = _a1.fromArray(s.pos), tv = _a2.fromArray(s.vel); if (age > -5 && age < 30) tp.addScaledVector(tv, age);
  R.vel.copy(tv); if (R.pos.distanceTo(tp) > 400) R.pos.copy(tp); else R.pos.lerp(tp, 1 - Math.exp(-h * 8));
  _aq.fromArray(s.q); const wl = R.w.length(); if (wl > 1e-6 && age > 0 && age < 2) _aq.multiply(new Q4().setFromAxisAngle(R.w.clone().normalize(), wl * age)); R.q.slerp(_aq, 1 - Math.exp(-h * 10)); }
{ const rs0 = rocketStep; rocketStep = function (h, t) { if (online() && !isAuth()) { mirrorStep(h, t); return; } rs0(h, t); }; }
{ const ex0 = explode; explode = function (why) { if (online() && !isAuth() && !NET.applying) return; return ex0(why); }; }
{ const rr0 = resetRocket; resetRocket = function () { rr0(); if (online() && NET.own && !NET.applying) { ownPad(); NET.ogen = (NET.ogen + 1) % 100000; } else if (isAuth() && !NET.applying) NET.gen = (NET.gen + 1) % 100000; }; }
// a ship of my own stands on pad 2 (more own ships line up south of it), so it can lift off next to the crew ship
function ownPad() { const k = Math.max(1, NET.slot), p1 = site.pads[1] || site.pads[0], z = p1.z - (k - 1) * 70, y = k > 1 ? site.H.groundY(p1.x, z) + .15 : p1.y;
  siteToBody(new V3(p1.x, y + R.comY - lowY(0), z), R.lp); latch(G.t); R.hold.copy(R.q); }
// non-authorities ask the authority to change the clock
{ const sw0 = setWarp; setWarp = function (i) { if (online() && !clockMine()) { const a = NET.auth; Net.send({t: 'warp', i: clamp(i, 0, WARPS.length - 1), to: a}); const pn = (NET.players.get(a) || {}).name || 'the pilot'; if (!NET.wHint || performance.now() - NET.wHint > 4000) { NET.wHint = performance.now(); showHint('Asked ' + pn + ' to change time speed (the pilot runs the clock)', 2500); } return; } sw0(i); }; }

// ---------------- the pilot seat: sitting in it asks for the controls
// the clock owner also keeps time slow enough for every ship that is not its own (each reports its cap)
const WC0 = warpCap;
warpCap = function () { const c = WC0(); if (!online() || !clockMine()) return c; const now = performance.now();
  for (const [id, sh] of NET.ships) { const s = sh.s; if (id === 'C' || !s || now - sh.at > 3000 || s.st === 'dead' || !(s.wc < c.mx)) continue; c.mx = Math.max(0, s.wc | 0); c.why = ghostName(sh) + ': ' + (s.wy || 'busy'); } return c; };
// own ship: my rocket runs on my machine, the clock still follows the crew pilot. Converge gently (a flying ship must not see the world jump)
function clockFollow(dt) { const c = NET.clk; if (!online() || !NET.own || !c) return; const wi = clamp(c.wi | 0, 0, WARPS.length - 1); G.wi = wi; G.warp = WARPS[wi];
  const tgt = c.T + (performance.now() - c.at) / 1000 * G.warp, err = tgt - G.t, lim = dt * G.warp * .25;
  if (Math.abs(err) > Math.max(3, G.warp * 2)) { G.t = tgt; if (R.st !== 'fly') latch(G.t); } else G.t += clamp(err, -lim, lim); }
{ const s0 = FLIGHT.step; FLIGHT.step = dt => { clockFollow(dt); s0(dt); }; }
{ const wt0 = warpToT; warpToT = function (t, lbl) { if (online() && NET.own && !clockMine()) { if (!(t > G.t + 2)) { showHint('Nothing to warp to', 1500); return false; } Net.send({t: 'warp', i: G.wi, to: NET.auth, wt: t, wl: lbl}); showHint('Asked the crew pilot to warp to ' + lbl, 2000); return false; } return wt0(t, lbl); }; }

function requestAuth() { if (!online() || isAuth()) return; if (Net.role === 'host') grantAuth('H'); else { Net.send({t: 'authReq'}); showHint('Taking the controls…', 1500); } }
function grantAuth(id) { // host only
  const cur = NET.auth; if (cur === id) return; const holder = NET.players.get(cur), busy = cur !== id && ((cur === 'H' && pilot()) || (holder && holder.po && holder.po.m === 1 && holder.po.s === 0 && cur !== 'H'));
  if (busy) { if (id !== 'H') Net.send1(id, {t: 'authNo', who: cur === 'H' ? Net.name : holder.name}); else showHint('The Pilot seat is taken', 2000); return; }
  NET.auth = id; Net.send({t: 'auth', id}); onAuth(); }
function onAuth() { const me = isAuth(); if (me) { if (NET.snap) applySnap(NET.snap); showHint('You have the controls · Space launch / stage', 2500); } else { const p = NET.players.get(NET.auth); if (p && pilot()) { C.seat = -1; showHint(p.name + ' is flying', 2500); } } }
{ const ca0 = cabinAct; cabinAct = function () { const was = C.seat; ca0(); if (C.seat === 0 && was !== 0) requestAuth(); }; }
{ const tp0 = toPilot; toPilot = function () { tp0(); requestAuth(); }; }
// flight keys only work for the authority (others would fight the snapshots)
addEventListener('keydown', e => { if (!online() || !G.on || !pilot() || isAuth()) return; if (/^(Space|Digit[1-8]|Numpad[1-8]|KeyT|KeyZ|KeyX|KeyR|KeyG|KeyN|KeyK|KeyH|Backspace|CapsLock)$/.test(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); showHint('Waiting for the controls…', 1200); requestAuth(); } }, true);

// ---------------- shared ship design, stations, burn node
const curShip = () => ({parts: cloneParts(SHIP.parts), name: SHIP.name, paint: Object.assign({}, SHIP.paint)});
{ const bl0 = bldLaunch;
  const crew = () => { if (NET.own) ownEnd(true); bl0(); if (online()) { NET.crewShip = curShip(); Net.send({t: 'ship', parts: SHIP.parts, name: SHIP.name, paint: SHIP.paint, g: NET.gen}); } };
  const mine = () => { const was = NET.own, g0 = NET.ogen; if (!was) { if (!NET.crewShip) NET.crewShip = curShip(); NET.slot = freeSlot(); } NET.own = true; if (!was && R.st === 'fly' && !R.on) R.st = 'pad'; bl0();
    if (NET.ogen === g0) { NET.own = was; return; } // the builder refused (no engine, still flying)
    if (!was) { if (NET.auth === myId()) Net.send({t: 'authRel'}); if (NODE) nodeKill(); const cs = shipOf('C'); cs.s = NET.snap; cs.at = performance.now(); if (NET.snap) NET.clk = {T: NET.snap.T, at: NET.snapAt, wi: NET.snap.wi}; }
    NET.odT = 0; showHint(SHIP.name + ' is your own ship, on pad ' + (NET.slot + 1) + '. Space: launch · Esc: rejoin the crew ship', 6000); };
  bldLaunch = function () { if (Net.role !== 'guest') { crew(); return; } if (G.on && R.st === 'fly' && (R.on || NET.own)) { bl0(); return; } ownAsk(mine, crew); }; }
// a guest on the ground can build and launch a ship of their own while the crew ship is away flying
const ownFree = () => Net.role === 'guest' && G.on && !NET.own && !R.on && R.st === 'fly';
if (typeof bldPanels === 'function') { const bp0 = bldPanels; bldPanels = function () { bp0(); if (ownFree()) { const b = $('bldGo'); if (b) { b.disabled = false; b.title = ''; } } }; }
addEventListener('keydown', e => { if (e.code !== 'KeyB' || e.repeat || !ownFree() || G.paused || MAPV.on || (typeof BLD !== 'undefined' && BLD.on) || (e.target && e.target.tagName === 'INPUT')) return; bldOpen(); }, true);
function freeSlot() { const used = new Set(); for (const [id, sh] of NET.ships) if (id !== 'C' && sh.d) used.add(sh.d.sl | 0); let k = 1; while (used.has(k)) k++; return k; }
// back to the crew ship: my R mirrors it again
function ownEnd(quiet) { if (!NET.own) return; NET.own = false; Net.send({t: 'ox'}); ghostDrop('C'); if (NODE) nodeKill(); clearDebris(); if (R.on) { R.on = false; C.in = false; C.seat = -1; cabL.intensity = 0; $('cross').classList.remove('hidden'); }
  const cs = NET.crewShip; if (cs && cs.parts.every(partOk)) shipApply(cs.parts, cs.name, cs.paint); NET.gen = -1; NET.applying = true; resetRocket(); NET.applying = false; if (NET.snap) applySnap(NET.snap);
  P.body = PLANET; spawnPlayer(); if (quiet) return;
  if (NET.snap && (NET.snap.st === 'fly' || NET.snap.st === 'docked')) { board(); showHint('Back aboard the crew ship. Find a seat (F)', 4000); } else showHint('Back with the crew ship', 3000); }
function netReset() { for (const id of [...NET.ships.keys()]) ghostDrop(id); NET.own = false; NET.clk = null; NET.crewShip = null; }
function ownAsk(mine, crew) { let el = $('ownAsk'); if (!el) { el = document.createElement('div'); el.id = 'ownAsk'; document.body.appendChild(el); }
  el.innerHTML = '<div class="oa"><h3>Launch whose ship?</h3><p>Your own ship stands on the next pad and you fly it yourself, next to the crew ship. Launching for the crew replaces the crew ship for everyone.</p>'
    + '<div class="ob"><button id="oaMine">Launch my own ship</button><button id="oaCrew">Launch for the crew</button><button id="oaNo">Cancel</button></div></div>';
  const done = f => () => { el.remove(); if (f) f(); }; $('oaMine').onclick = done(mine); $('oaCrew').onclick = done(crew); $('oaNo').onclick = done(null); }
function vesPack() { return VES.list.map(V => ({id: V.id, name: V.name, b: V.b, t0: V.t0, r: V.r.toArray(), v: V.v.toArray(), q: V.q.toArray(), visits: V.visits || 0, mods: V.mods.map(m => ({k: m.k, p: m.p.toArray(), q: m.q.toArray(), used: m.used}))})); }
function vesUnpack(list) { for (const V of VES.list) if (V.g) scene.remove(V.g); const tgt = VES.tgt && VES.tgt.id; VES.list.length = 0;
  for (const s of list) { if (!BODIES[s.b] || !s.mods.every(m => MODULES[m.k])) continue; VES.list.push({id: s.id, name: s.name, b: s.b, t0: s.t0, r: new V3().fromArray(s.r), v: new V3().fromArray(s.v), q: new Q4().fromArray(s.q), visits: s.visits || 0, mods: s.mods.map(m => ({k: m.k, p: new V3().fromArray(m.p), q: new Q4().fromArray(m.q), used: m.used || []})), g: null}); }
  VES.tgt = VES.list.find(V => V.id === tgt) || null; }
{ const vs0 = vesSave; vesSave = function () { vs0(); if (online() && !NET.applying) Net.send({t: 'ves', l: vesPack()}); }; }

// ---------------- ghosts: every ship that is not my own R (other players' own ships; the crew ship while I fly my own)
const GH = {cone: (() => { const g = new THREE.ConeGeometry(1, 1, 20, 1, true); g.rotateX(Math.PI); g.translate(0, -.5, 0); return g; })(),
  pm: new THREE.MeshBasicMaterial({color: new THREE.Color(3, 1.6, .6), transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide})};
const _g1 = new V3(), _g2 = new V3(), _g3 = new V3(), _gq = new Q4();
function shipOf(id) { let s = NET.ships.get(id); if (!s) { s = {id, d: null, s: null, at: performance.now(), g: null, tag: null, p: new V3(), q: new Q4(), bot: -1, gen: -1, dg: null, comY: 10, dead: false}; NET.ships.set(id, s); } return s; }
function ghostFree(sh) { if (!sh.g) return; scene.remove(sh.g); sh.g.traverse(o => { if (o.geometry && o.geometry !== GH.cone) o.geometry.dispose(); }); if (sh.capM) sh.capM.dispose(); sh.g = null; }
function ghostDrop(id) { const sh = NET.ships.get(id); if (!sh) return; ghostFree(sh); if (sh.tag) sh.tag.remove(); NET.ships.delete(id); }
function ghostDesign(sh) { return sh.id === 'C' ? NET.crewShip : sh.d; }
function ghostName(sh) { if (sh.id === 'C') return 'Crew ship'; const p = NET.players.get(sh.id); return ((p && p.name) || 'Astronaut') + "'s ship"; }
function ghostBuild(sh, d, sn) { ghostFree(sh); const st = sh.st = shipLayout(d.parts), bot = clamp(sn.bot | 0, 0, st.length - 1), g = sh.g = new THREE.Group(), inner = sh.inner = new THREE.Group(), paint = Object.assign({}, PAINT0, d.paint); g.add(inner);
  const capM = sh.capM = RM.cap.clone(); capM.color.set(paint.cap || PAINT0.cap);
  st.forEach((S, si) => { if (si < bot) return; if (S.cap) { const n0 = inner.children.length; capsuleLook(inner); for (let k = n0; k < inner.children.length; k++) if (inner.children[k].material === RM.cap) inner.children[k].material = capM; capTops(inner, S, si, true, paint); } else stageMeshes(inner, S, si, true, paint); });
  sh.legs = inner.userData.legs || null; inner.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  const S0 = st[bot], r = S0.side ? S0.side.off + (S0.rs || 1) * .5 : (S0.exit || 1) * 1.15; sh.pl = new THREE.Mesh(GH.cone, GH.pm); sh.pl.position.y = S0.y0 + (S0.cap ? 0 : .3); sh.pl.scale.set(r, S0.hot ? 26 : 14, r); sh.pl.visible = false; sh.pl.renderOrder = 5; sh.pl.castShadow = false; sh.plOk = !!S0.thrust; inner.add(sh.pl);
  sh.botB = bot; scene.add(g); }
function ghostTarget(sn, p, q) { const b = BODIES[sn.b] || PLANET; if (sn.st === 'fly' || sn.st === 'docked') { p.fromArray(sn.pos).addScaledVector(_g3.fromArray(sn.vel), clamp(G.t - sn.T, -5, 30)); q.fromArray(sn.q); }
  else { p.fromArray(sn.lp).applyQuaternion(b.q).add(b.c); q.copy(b.q).multiply(_g4.fromArray(sn.lq)); } }
const _g4 = new Q4();
function ghostLive(id, sh) { return sh.s && ghostDesign(sh) && (id !== 'C' || NET.own) && performance.now() - sh.at < 6000; }
function ghostsFrame(dt) { const now = performance.now();
  for (const [id, sh] of NET.ships) { const sn = sh.s, d = ghostDesign(sh), hideTag = () => { if (sh.tag) sh.tag.style.display = 'none'; };
    if (!ghostLive(id, sh)) { if (sh.g && now - sh.at > 20000) ghostFree(sh); else if (sh.g) sh.g.visible = false; hideTag(); continue; }
    ghostTarget(sn, _g1, _gq);
    if (sn.st === 'dead') { if (!sh.dead) { sh.dead = true; if (sh.g && _g2.copy(_g1).sub(G.O).length() < 60000) { boom(_g1.clone(), 1.6); if (SND.c) sfx('boom'); } ghostFree(sh); } hideTag(); continue; } sh.dead = false;
    if (id !== 'C' && d.g !== sn.g) { hideTag(); continue; } // the design for this rocket has not arrived yet
    let fresh = false; if (!sh.g || sh.bot !== sn.bot || sh.gen !== sn.g || sh.dg !== d) { ghostBuild(sh, d, sn); sh.bot = sn.bot; sh.gen = sn.g; sh.dg = d; fresh = true; }
    const fly = sn.st === 'fly' || sn.st === 'docked';
    if (fresh || !fly || G.warp > 4 || sh.p.distanceTo(_g1) > 400) { sh.p.copy(_g1); sh.q.copy(_gq); } else { sh.p.addScaledVector(_g3.fromArray(sn.vel), dt * G.warp).lerp(_g1, 1 - Math.exp(-dt * 8)); sh.q.slerp(_gq, 1 - Math.exp(-dt * 10)); }
    const st = sh.st, g = sh.g; let m = 0, my = 0; for (let i = sh.botB; i < st.length; i++) { const S = st[i], mi = S.dry + (sn.fu[i] || 0) + ((sn.cm && sn.cm[i]) || 0); m += mi; my += mi * (S.y0 + S.y1) / 2; } sh.comY = m ? my / m : 20;
    g.position.copy(sh.p).sub(G.O); g.quaternion.copy(sh.q); sh.inner.position.y = -sh.comY; const dist = g.position.length(); g.visible = dist < 80000;
    if (sh.legs) { const a = lerp(Math.PI - .06, .5, sstep(0, 1, sn.lgs || 0)); for (const h of sh.legs) h.rotation.z = a; }
    sh.pl.visible = sh.plOk && sn.F > 0 && sn.st !== 'landed'; if (sh.pl.visible) sh.pl.scale.y = (st[sh.botB].hot ? 26 : 14) * (.85 + .3 * Math.random());
    // name tag over the nose
    if (!sh.tag) { sh.tag = document.createElement('div'); sh.tag.className = 'ntag'; document.body.appendChild(sh.tag); }
    _g2.set(0, 29 - sh.comY, 0).applyQuaternion(sh.q).add(g.position).project(cam); const vis = dist > 25 && dist < 3e6 && _g2.z < 1 && Math.abs(_g2.x) < 1.05 && Math.abs(_g2.y) < 1.05 && !MAPV.on && !(typeof BLD !== 'undefined' && BLD.on);
    sh.tag.style.display = vis ? '' : 'none'; if (vis) { sh.tag.style.transform = 'translate(' + ((_g2.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-_g2.y * .5 + .5) * innerHeight).toFixed(1) + 'px) translate(-50%,-100%)';
      const t = ghostName(sh) + ' · ' + fmtD(dist); if (sh.tag._t !== t) { sh.tag._t = t; sh.tag.textContent = t; const p = NET.players.get(id); sh.tag.style.setProperty('--c', '#' + CREW_COL[(p ? p.c : 0) % CREW_COL.length].toString(16).padStart(6, '0')); } } }
}
// map view: a marker for every other ship
{ const mr0 = mapRender, _mp3 = new V3(), _mq4 = new Q4(); mapRender = function (dt) { mr0(dt); if (!online()) return; const x = MAPV.x;
    for (const [id, sh] of NET.ships) { if (!ghostLive(id, sh) || sh.s.st === 'dead') continue; ghostTarget(sh.s, _mp3, _mq4); const p = _mp3.multiplyScalar(.001).project(MAPV.cam); if (p.z > 1 || p.z < -1) continue;
      const sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight, t = ghostName(sh), pl = NET.players.get(id), col = '#' + CREW_COL[(pl ? pl.c : 0) % CREW_COL.length].toString(16).padStart(6, '0');
      x.font = '600 12px Archivo, sans-serif'; const tw = x.measureText(t).width; x.fillStyle = '#F3F3F0'; x.fillRect(sx + 8, sy - 9, tw + 12, 18); x.fillStyle = col; x.beginPath(); x.moveTo(sx, sy - 6); x.lineTo(sx + 6, sy + 5); x.lineTo(sx - 6, sy + 5); x.closePath(); x.fill(); x.strokeStyle = '#F3F3F0'; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = '#121314'; x.textAlign = 'left'; x.fillText(t, sx + 14, sy + 4); } }; }

// ---------------- receiving
Net.on('rs', m => { if (m.a === myId()) return; if (NET.auth !== m.a && Net.role === 'host' && m.a !== NET.auth) return;
  if (NET.own) { NET.snap = m; NET.snapAt = performance.now(); NET.clk = {T: m.T, at: NET.snapAt, wi: m.wi}; const cs = shipOf('C'); cs.s = m; cs.at = NET.snapAt; return; }
  if (!isAuth()) applySnap(m); });
Net.on('od', m => { const id = m.from; if (!id || id === myId() || !Array.isArray(m.parts) || m.parts.length > 60 || !m.parts.every(partOk)) return; const sh = shipOf(id);
  if (!sh.d || sh.d.g !== m.g || sh.d.name !== m.name) sh.d = {name: String(m.name || 'Ship').slice(0, 24), parts: m.parts, paint: Object.assign({}, PAINT0, m.paint), g: m.g, sl: m.sl | 0}; });
Net.on('os', m => { const id = m.from; if (!id || id === myId() || !Array.isArray(m.pos) || !Array.isArray(m.fu)) return; const sh = shipOf(id); sh.s = m; sh.at = performance.now(); });
Net.on('ox', m => ghostDrop(m.id || m.from));
Net.on('authRel', (m, from) => { if (Net.role === 'host' && NET.auth === from) { NET.auth = 'H'; Net.send({t: 'auth', id: 'H'}); onAuth(); } });
Net.on('po', m => { if (m.id === myId()) return; const p = playerOf(m.id); p.po = m; p.name = m.n; p.c = m.c; p.at = performance.now(); });
Net.on('ch', m => chatAdd(m.n, m.m, m.c));
Net.on('em', m => { const p = NET.players.get(m.id); if (p) { p.wave = performance.now() + 2500; chatAdd(p.name, 'waves', p.c, true); } });
Net.on('ship', m => { if (!Array.isArray(m.parts) || !m.parts.every(partOk)) return; NET.crewShip = {parts: cloneParts(m.parts), name: m.name, paint: Object.assign({}, PAINT0, m.paint)}; if (NET.own) return; shipApply(m.parts, m.name, m.paint); if (Net.role === 'host' && !isAuth()) return; NET.applying = true; if (R.st !== 'fly') resetRocket(); NET.applying = false; });
Net.on('ves', m => { NET.applying = true; vesUnpack(m.l || []); try { localStorage.setItem('ye-world', JSON.stringify({v: 1, nameI: VES.nameI, list: vesPack()})); } catch (e) {} NET.applying = false; });
Net.on('nd', m => { if (NET.own) return; const s = m.d ? JSON.stringify(m.d) : ''; NET.lastNd = s; if (!m.d) { if (NODE) nodeKill(); return; } if (R.st !== 'fly') return; nodeMakeQuiet(m.d.t, new V3(...m.d.dv)); nodePanel(); });
Net.on('warp', (m, from) => { if (Net.role === 'host' && m.to && m.to !== 'H') { Net.send1(m.to, m); return; } if (clockMine()) { if (m.wt) warpToT(m.wt, m.wl || 'a time'); else setWarp(m.i); } });
Net.on('authReq', (m, from) => { if (Net.role === 'host') grantAuth(from); });
Net.on('auth', m => { NET.auth = m.id; if (!NET.own) onAuth(); });
Net.on('authNo', m => { showHint((m.who || 'Someone') + ' is flying: the Pilot seat is taken', 2500); C.seat = -1; });
Net.on('wel', m => { NET.auth = m.auth; NET.col = m.col; if (m.ship && m.ship.parts.every(partOk)) NET.crewShip = {parts: cloneParts(m.ship.parts), name: m.ship.name, paint: Object.assign({}, PAINT0, m.ship.paint)};
  if (NET.own) { NET.applying = true; vesUnpack(m.ves || []); NET.applying = false; NET.odT = 0; if (m.rs) { NET.snap = m.rs; NET.snapAt = performance.now(); NET.clk = {T: m.rs.T, at: NET.snapAt, wi: m.rs.wi}; } netBar(); return; } // the host came back while I fly my own ship
  NET.gen = -1; if (m.ship && m.ship.parts.every(partOk)) shipApply(m.ship.parts, m.ship.name, m.ship.paint); NET.applying = true; vesUnpack(m.ves || []); NET.applying = false;
  G.t = m.T; for (const b of BODIES) bodyState(b, G.t); if (m.rs) applySnap(m.rs);
  if (m.rs && (m.rs.st === 'fly' || m.rs.st === 'docked')) { board(); showHint('You joined ' + m.host + "'s crew in flight. Find a seat (F) · Enter to chat", 6000); } else showHint('You joined ' + m.host + "'s crew · Enter to chat · U to wave", 5000);
  netBar(); });
Net.on('_join', m => { const p = Net.peers.get(m.id); if (!p) return; const pl = playerOf(m.id); pl.name = p.name; pl.c = p.c;
  Net.send1(m.id, {t: 'wel', host: Net.name, auth: NET.auth, col: p.c, T: G.t, ship: {parts: SHIP.parts, name: SHIP.name, paint: SHIP.paint}, ves: vesPack(), rs: rocketSnap()});
  if (m.fresh) { chatAdd(p.name, 'joined the crew', p.c, true); sfx && SND.c && warnTone(990, 1); } netBar(); });
Net.on('_left', m => { dropPlayer(m.id); ghostDrop(m.id); Net.send({t: 'ox', id: m.id}); chatAdd(m.name, 'left', 0, true); if (NET.auth === m.id) { NET.auth = 'H'; Net.send({t: 'auth', id: 'H'}); onAuth(); } netBar(); });
Net.on('_hostgone', () => { showHint('The host left: you are flying solo now', 4000); for (const id of [...NET.players.keys()]) dropPlayer(id); Net.close(); NET.auth = 'H'; netBar(); });

// ---------------- chat + waves
function chatAdd(n, msg, c, act) { const el = $('chatLog'); if (!el) return; const d = document.createElement('div'); d.className = act ? 'act' : '';
  const b = document.createElement('b'); b.textContent = n; b.style.setProperty('--c', '#' + CREW_COL[(c || 0) % CREW_COL.length].toString(16).padStart(6, '0')); d.appendChild(b); d.appendChild(document.createTextNode(' ' + msg)); el.appendChild(d);
  while (el.children.length > 6) el.firstChild.remove(); setTimeout(() => d.classList.add('old'), 9000); }
function chatOpen() { const i = $('chatIn'); i.classList.remove('hidden'); i.value = ''; i.focus(); for (const k in keys) keys[k] = false; }
addEventListener('keydown', e => { if (!online() || !G.on) return; const i = $('chatIn');
  if (document.activeElement === i) { e.stopImmediatePropagation(); if (e.code === 'Enter') { const t = i.value.trim().slice(0, 140); if (t) { Net.send({t: 'ch', n: Net.name, m: t, c: NET.col}); chatAdd(Net.name, t, NET.col); } i.blur(); i.classList.add('hidden'); lockPointer(); } else if (e.code === 'Escape') { i.blur(); i.classList.add('hidden'); } return; }
  if (G.paused) return; if (e.code === 'Enter' && !(typeof BLD !== 'undefined' && BLD.on)) { e.preventDefault(); e.stopImmediatePropagation(); if (document.pointerLockElement) document.exitPointerLock(); chatOpen(); }
  if (e.code === 'KeyU' && !e.repeat) { Net.send({t: 'em', id: myId(), w: 'wave'}); chatAdd(Net.name, 'waves', NET.col, true); } }, true);

// ---------------- menu: host / join, in-game room bar
function netBar() { const el = $('netBar'); if (!online()) { el.classList.add('hidden'); return; } el.classList.remove('hidden'); const n = Net.role === 'host' ? Net.peers.size + 1 : NET.players.size || 1;
  el.innerHTML = '<span class="cap">Room</span><b>' + Net.code + '</b><span>' + (Net.role === 'host' ? 'You host · ' : '') + n + ' aboard</span>'; }
function startOnline(kind) { const name = ($('name').value.trim() || 'Astronaut').slice(0, 14); SET.name = name; saveSet(); const st = $('netMsg');
  if (kind === 'host') { Net.host(name, s => { st.textContent = s === 'open' ? 'Room open. Tell your friends the code: ' + Net.code : 'Reconnecting…'; netBar(); }); NET.auth = 'H'; NET.col = 0; NET.gen = 0; $('play').click(); netBar(); showHint('Room ' + Net.code + ' is open. Friends join with this code · Enter to chat · U to wave', 8000); return; }
  const code = $('netCode').value.trim().toUpperCase().replace(/[^A-Z]/g, ''); if (code.length !== 5) { st.textContent = 'Room codes are 5 letters.'; return; }
  st.textContent = 'Joining ' + code + '…'; NET.auth = 'H';
  Net.join(code, name, why => { st.textContent = why; if (G.on) showHint(why, 4000); netBar(); });
  const t0 = performance.now(), wait = setInterval(() => { if (NET.snap || Net.role !== 'guest') { clearInterval(wait); if (Net.role === 'guest') { $('play').click(); netBar(); } } else if (performance.now() - t0 > 12000) { clearInterval(wait); st.textContent = 'No answer from that room.'; Net.close(); } }, 200); }
async function roomList() { const el = $('netRooms'); el.textContent = 'Looking for open rooms…'; const r = await Net.rooms(); el.innerHTML = '';
  if (!r.length) { el.textContent = 'No open rooms right now. Host one, or type a code.'; return; }
  for (const x of r.slice(0, 6)) { const b = document.createElement('button'); b.innerHTML = '<b>' + x.code + '</b><span>' + String(x.name).replace(Net.tag + ' ', '').replace(/</g, '') + ' · ' + x.n + ' aboard</span>'; b.onclick = () => { $('netCode').value = x.code; startOnline('join'); }; el.appendChild(b); } }
{ const card = document.querySelector('#menu .card'), more = card.querySelector('.more'), box = document.createElement('div'); box.id = 'netBox';
  box.innerHTML = '<label>Play with friends</label><div class="seg"><button id="netHost">Host a room</button><button id="netJoinB">Join a room</button></div>'
    + '<div id="netJoin" class="hidden"><div class="jr"><input id="netCode" type="text" maxlength="5" placeholder="Room code" autocomplete="off"><button id="netGo">Join</button></div><div id="netRooms"></div></div><div id="netMsg"></div>';
  more.before(box);
  $('netHost').onclick = () => startOnline('host'); $('netJoinB').onclick = () => { $('netJoin').classList.toggle('hidden'); if (!$('netJoin').classList.contains('hidden')) { roomList(); $('netCode').focus(); } };
  $('netGo').onclick = () => startOnline('join'); $('netCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); startOnline('join'); } };
  const bar = document.createElement('div'); bar.id = 'netBar'; bar.className = 'hidden'; bar.title = 'Click to copy the room code'; bar.onclick = () => { try { navigator.clipboard.writeText(Net.code); showHint('Room code copied', 1500); } catch (e) {} }; document.body.appendChild(bar);
  const log = document.createElement('div'); log.id = 'chatLog'; document.body.appendChild(log); const ci = document.createElement('input'); ci.id = 'chatIn'; ci.className = 'hidden'; ci.maxLength = 140; ci.placeholder = 'Say something · Enter to send'; document.body.appendChild(ci);
  // crew list on the pause card
  const pc = document.querySelector('#pause .tcard'), cl = document.createElement('div'); cl.id = 'pCrew'; pc.querySelector('.pb').after(cl); }
function crewList() { const el = $('pCrew'); if (!online()) { el.innerHTML = ''; return; } const rows = [[myId(), Net.name + ' (you)', NET.col, R.on && C.in ? (NET.own ? 'Flying your own ship: ' + SHIP.name.replace(/</g, '') : C.seat >= 0 ? SEATS[C.seat].name : 'In the capsule') : 'On ' + P.body.name]];
  for (const [id, p] of NET.players) if (id !== myId() && p.po) rows.push([id, p.name, p.c, p.po.m === 2 ? 'In the station' : p.po.m === 1 ? (p.po.sh && p.po.sh !== 'C' ? 'Flying their own ship' + (NET.ships.get(id) && NET.ships.get(id).d ? ': ' + NET.ships.get(id).d.name.replace(/</g, '') : '') : p.po.s >= 0 ? SEATS[p.po.s].name : 'In the capsule') : 'On ' + (BODIES[p.po.b] || PLANET).name]);
  el.innerHTML = '<div class="tl">Crew · room ' + Net.code + '</div><div class="crew">' + rows.map(([id, n, c, w]) => '<div><i style="background:#' + CREW_COL[c % CREW_COL.length].toString(16).padStart(6, '0') + '"></i><b>' + n.replace(/</g, '') + '</b><span>' + w + (NET.auth === id ? ' · has the controls' : '') + '</span></div>').join('') + '</div>'
    + (NET.own ? '<div class="own">' + (R.st === 'fly' || R.st === 'docked' ? 'You are flying your own ship. Land or end the flight to rejoin the crew ship.' : '<button id="pRejoin">Rejoin the crew ship</button>') + '</div>' : '');
  const rj = $('pRejoin'); if (rj) rj.onclick = e => { e.stopPropagation(); setPause(false, true); ownEnd(); }; }
{ const sp0 = setPause; setPause = function (on, relock) { sp0(on, relock); if (on) crewList(); }; }
{ const st = document.createElement('style'); st.textContent = `
#netBox { margin-top:20px; } #netJoin { margin-top:8px; } #netJoin .jr { display:flex; } #netJoin .jr input { flex:1; text-transform:uppercase; letter-spacing:.2em; font-weight:600; } #netJoin .jr button { border-left:0; }
#netRooms { margin-top:6px; color:var(--ink2); font-size:12.5px; } #netRooms button { display:flex; width:100%; gap:10px; text-align:left; border-top:0; } #netRooms button:first-child { border-top:1px solid var(--rule); } #netRooms button b { letter-spacing:.15em; } #netRooms button span { color:var(--ink2); font-weight:500; }
#netMsg { margin-top:8px; color:var(--red); font-size:12.5px; font-weight:600; min-height:16px; }
#netBar { position:fixed; left:16px; top:72px; z-index:5; display:flex; align-items:baseline; gap:8px; padding:5px 12px; background:var(--plate); box-shadow:var(--sh); font-size:13px; cursor:pointer; } #netBar b { letter-spacing:.15em; } #netBar span:last-child { color:var(--ink2); }
body.map #netBar { display:none; }
@media (max-width:1100px) { #netBar { top:128px; } }
.ntag { position:fixed; left:0; top:0; z-index:4; pointer-events:none; padding:2px 8px; background:var(--plate); color:var(--ink); font-size:12px; font-weight:600; white-space:nowrap; box-shadow:var(--sh); border-bottom:3px solid var(--c, var(--red)); }
#chatLog { position:fixed; left:16px; top:50%; transform:translateY(-50%); z-index:5; width:300px; pointer-events:none; display:flex; flex-direction:column; gap:4px; }
#chatLog div { background:var(--ink); color:var(--plate); padding:5px 10px; font-size:13px; box-shadow:var(--sh); transition:opacity .4s steps(2); } #chatLog div.old { opacity:0; } #chatLog div.act { background:var(--plate); color:var(--ink2); }
#chatLog b { color:var(--c); filter:brightness(1.35); margin-right:2px; } #chatLog div.act b { filter:none; }
#chatIn { position:fixed; left:16px; top:calc(50% + 110px); z-index:6; width:300px !important; box-shadow:var(--sh); }
#pCrew .own { padding:10px 22px 0; color:var(--ink2); font-size:12.5px; } #pCrew .own button { width:100%; }
#ownAsk { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:rgba(18,19,20,.45); padding:16px; }
#ownAsk .oa { background:var(--plate); color:var(--ink); box-shadow:var(--sh); width:min(440px,100%); padding:20px 22px; } #ownAsk h3 { margin:0 0 6px; font-size:20px; letter-spacing:-.02em; } #ownAsk p { margin:0 0 14px; color:var(--ink2); font-size:13px; line-height:1.45; }
#ownAsk .ob { display:flex; flex-direction:column; } #ownAsk .ob button { padding:10px; font-weight:600; } #ownAsk .ob button + button { border-top:0; } #oaMine { background:var(--red) !important; color:#fff !important; border-color:var(--red) !important; }
#pCrew .crew { padding:0 22px; } #pCrew .crew div { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--hair); font-size:13px; } #pCrew .crew i { width:10px; height:10px; } #pCrew .crew span { color:var(--ink2); margin-left:auto; }
`; document.head.appendChild(st); }

// ---------------- per-frame hook
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v0(dt); if (online()) { netSend(dt); avatarsFrame(dt); ghostsFrame(dt); } }; }
addEventListener('beforeunload', () => Net.close());
Object.assign(window.YE, {Net, NET, isAuth, clockMine, online, applySnap, rocketSnap, vesPack, ownEnd, ghostsFrame});
