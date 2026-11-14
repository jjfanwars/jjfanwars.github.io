'use strict';
// Online play over the jjfanwars relay (same protocol as drop.html / front.html; the relay only forwards bytes).
// Frames: guest -> relay raw payload; relay -> host [idLen][id][payload]; host -> relay [idLen][id][payload] (empty id = everyone).
// Text frames are control: relay -> host {c:'join'|'leave', id}; relay -> guest {c:'host', up}.
const RELAY_URL = 'wss://jjfanwars-relay.businessautomationvic.workers.dev';
const Net = {
  role: 'solo', ws: null, peer: null, peers: new Map(), code: '', relayT: { car: 1, look: 1, call: 1 }, id: '', name: '', handlers: {}, retry: 0, ping: 0, started: false, lastRx: 0,
  enc: new TextEncoder(), dec: new TextDecoder(),
  relay() { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const m = /[?&]relay=([^&]+)/.exec(location.search); if (m) return decodeURIComponent(m[1]).replace(/\/$/, ''); } return RELAY_URL; },
  on(t, f) { this.handlers[t] = f; },
  emit(m, from) { const f = this.handlers[m.t]; if (f) f(m, from); },
  send(o) {
    if (!this.ws || this.ws.readyState !== 1) return; const b = this.enc.encode(JSON.stringify(o));
    if (this.role === 'host') { const out = new Uint8Array(1 + b.length); out.set(b, 1); try { this.ws.send(out); } catch (e) {} }
    else if (this.role === 'guest') { try { this.ws.send(b); } catch (e) {} }
  },
  meta(open) { try { this.ws.send(JSON.stringify({ c: 'meta', name: '[Rally] ' + this.name + "'s stage", open })); } catch (e) {} },
  newCode() { let s = ''; for (let i = 0; i < 5; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]; return s; },
  host(name, onStatus) {
    this.close(); this.role = 'host'; this.name = name; this.code = this.newCode(); this.peer = null; this.peers = new Map(); this.started = false; this.onStatus = onStatus; this.hostConnect(); return this.code;
  },
  hostConnect() {
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + this.code + '?role=host'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.meta(!this.started); this.onStatus && this.onStatus('open'); this.emit({ t: '_lobby' }); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'leave' && this.peers.has(m.id)) { const p = this.peers.get(m.id); this.peers.delete(m.id); this.peer = this.peers.values().next().value || null; this.emit({ t: '_left', id: m.id, name: p.name }); } return; }
      const b = new Uint8Array(e.data), k = b[0], id = this.dec.decode(b.subarray(1, 1 + k)); let m; try { m = JSON.parse(this.dec.decode(b.subarray(1 + k))); } catch (x) { return; }
      this.lastRx = performance.now();
      if (m.t === 'hello') { if (!this.peers.has(id) && (this.peers.size >= 7 || this.started)) { this.send1(id, { t: 'full' }); return; } const p = { id, name: String(m.name || 'Player').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14) || 'Player' }; this.peers.set(id, p); this.peer = p; this.emit({ t: '_join', id }); this.emit({ t: '_lobby' }); return; }
      if (m.t === 'pong') { this.ping = performance.now() - m.at; return; }
      if (!this.peers.has(id)) return;
      m.from = id; this.emit(m, id);
      if (this.relayT[m.t]) this.send(m); // pass car/look/call on to every other client
    };
    ws.onclose = () => { if (this.role === 'host' && this.ws === ws) { this.onStatus && this.onStatus('retry'); setTimeout(() => { if (this.role === 'host' && this.ws === ws) this.hostConnect(); }, Math.min(8000, 1000 * ++this.retry)); } };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) { this.ws.send('ping'); this.send({ t: 'ping', at: performance.now() }); } } catch (e) {} }, 2000);
  },
  send1(id, o) { const ib = this.enc.encode(id), b = this.enc.encode(JSON.stringify(o)), out = new Uint8Array(1 + ib.length + b.length); out[0] = ib.length; out.set(ib, 1); out.set(b, 1 + ib.length); try { this.ws.send(out); } catch (e) {} },
  join(code, name, onFail) {
    this.close(); this.role = 'guest'; this.code = code; this.name = name; this.id = Math.random().toString(36).slice(2, 11); this.started = false;
    const ws = this.ws = new WebSocket(this.relay() + '/room/' + code + '?role=guest&id=' + this.id); ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.send({ t: 'hello', name });
    ws.onmessage = e => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.c === 'host' && !m.up) this.emit({ t: '_hostgone' }); else if (m.c === 'host' && m.up) this.send({ t: 'hello', name }); return; }
      let m; try { m = JSON.parse(this.dec.decode(new Uint8Array(e.data))); } catch (x) { return; }
      this.lastRx = performance.now();
      if (m.t === 'ping') { this.send({ t: 'pong', at: m.at }); return; }
      if (m.t === 'full') { this.close(); onFail('That room is full or already racing.'); return; }
      if (m.from && m.from === this.id) return; // our own message coming back through the host
      this.emit(m);
    };
    ws.onclose = ev => { if (this.ws !== ws) return; const why = ev.code === 4404 ? 'No such room.' : ev.code === 4429 ? 'Room is full.' : 'Connection lost.'; this.ws = null; onFail(why); };
    clearInterval(this.pingT); this.pingT = setInterval(() => { try { if (this.ws && this.ws.readyState === 1) this.ws.send('ping'); } catch (e) {} }, 20000);
  },
  close() { clearInterval(this.pingT); if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; try { w.close(); } catch (e) {} } this.role = 'solo'; this.peer = null; this.peers = new Map(); },
  async rooms() { try { const r = await (await fetch(this.relay().replace(/^ws/, 'http') + '/rooms')).json(); return r.filter(x => x.open && /^\[Rally\]/.test(x.name)); } catch (e) { return []; } },
};
