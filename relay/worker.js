// jjfanwars relay: one Durable Object per room. Host and guests all connect out over WebSocket (port 443),
// so it works on school networks that block peer-to-peer. The host's game stays authoritative; this only forwards bytes.
// Frames: guest -> relay is the raw payload. relay -> host is [idLen][id][payload]. host -> relay is [idLen][id][payload] (empty id = everyone).
// Text frames are control: relay -> host {c:'join'|'leave', id}; relay -> guest {c:'host', up:true|false}.
const enc = new TextEncoder(), dec = new TextDecoder();

export default {
  async fetch(req, env) {
    const u = new URL(req.url), m = /^\/room\/([A-Za-z]{5})$/.exec(u.pathname);
    const CORS = {'access-control-allow-origin': '*'};
    if (u.pathname === '/') return new Response('jjfanwars relay ok', {headers: CORS});
    if (u.pathname === '/rooms' || u.pathname === '/log') { // live room list for the Join screen / history of every room ever made
      const r = await env.DIR.get(env.DIR.idFromName('dir')).fetch('https://d' + u.pathname);
      return new Response(r.body, {headers: {...CORS, 'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    if (u.pathname === '/stats') return Response.redirect('https://jjfanwars.github.io/stats.html', 302);
    if (u.pathname === '/track/hit' || u.pathname === '/track/sum') { // anonymous play counts: hit = POST from the game, sum = JSON for stats.html
      if (u.pathname === '/track/hit' && req.method !== 'POST') return new Response('expected POST', {status: 405, headers: CORS});
      const t = env.TRACK.get(env.TRACK.idFromName('main'));
      if (u.pathname === '/track/hit') { await t.fetch('https://t/hit', {method: 'POST', body: await req.text()}); return new Response('ok', {headers: CORS}); }
      if (/text\/html/.test(req.headers.get('accept') || '') && !u.searchParams.has('json')) return Response.redirect('https://jjfanwars.github.io/stats.html', 302); // opened in a browser: show the page
      const sum = await (await t.fetch('https://t/sum' + u.search)).json();
      try { sum.accounts = (await (await env.ACCTS.get(env.ACCTS.idFromName('main')).fetch('https://a/acct/count', {method: 'POST', body: '{}'})).json()).n; } catch (e) {}
      try { sum.rooms = (await (await env.DIR.get(env.DIR.idFromName('dir')).fetch('https://d/rooms')).json()).length; } catch (e) {}
      return new Response(JSON.stringify(sum), {headers: {...CORS, 'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    if (u.pathname.startsWith('/acct/')) { // accounts: plain JSON over HTTPS (text/plain bodies, so no CORS preflight)
      if (req.method === 'OPTIONS') return new Response(null, {headers: {...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type'}});
      if (req.method !== 'POST') return new Response('expected POST', {status: 405, headers: CORS});
      const r = await env.ACCTS.get(env.ACCTS.idFromName('main')).fetch('https://a' + u.pathname, {method: 'POST', body: await req.text()});
      return new Response(r.body, {status: r.status, headers: {...CORS, 'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    if (u.pathname.startsWith('/ib/')) return ibRoute(req, env, CORS, u);
    if (u.pathname === '/legal/grade' || u.pathname === '/legal/setup') return legalGrade(req, env, CORS, u.pathname);
    if (!m) return new Response('not found', {status: 404});
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', {status: 426});
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
    return stub.fetch(req);
  },
};

export class Room {
  constructor(state, env) { this.state = state; this.env = env; state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); }
  host() { return this.state.getWebSockets('host')[0] || null; }
  async fetch(req) {
    this._code = (/\/room\/([A-Za-z]{5})/.exec(req.url) || [])[1]; if (this._code) { this._code = this._code.toUpperCase(); this.state.storage.put('code', this._code); }
    const u = new URL(req.url), role = u.searchParams.get('role'), pair = new WebSocketPair(), [cli, srv] = [pair[0], pair[1]];
    if (role === 'host') {
      for (const old of this.state.getWebSockets('host')) try { old.close(4001, 'replaced'); } catch (e) {} // a reconnecting host replaces its stale socket
      this.state.acceptWebSocket(srv, ['host']);
      this.state.storage.setAlarm(Date.now() + 1500); // tell the room directory shortly (after the host sends its name)
      for (const g of this.state.getWebSockets('guest')) { const id = g.deserializeAttachment(); try { srv.send(JSON.stringify({c: 'join', id})); g.send(JSON.stringify({c: 'host', up: true})); } catch (e) {} }
    } else {
      if (!this.host()) { this.state.acceptWebSocket(srv, ['guest']); srv.close(4404, 'no such room'); return new Response(null, {status: 101, webSocket: cli}); }
      const id = (u.searchParams.get('id') || Math.random().toString(36).slice(2, 9)).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'g';
      if (this.state.getWebSockets('guest').length >= 7) { this.state.acceptWebSocket(srv, ['guest']); srv.close(4429, 'room full'); return new Response(null, {status: 101, webSocket: cli}); }
      for (const g of this.state.getWebSockets('guest')) if (g.deserializeAttachment() === id) try { g.close(4001, 'replaced'); } catch (e) {}
      this.state.acceptWebSocket(srv, ['guest']); srv.serializeAttachment(id);
      try { this.host().send(JSON.stringify({c: 'join', id})); srv.send(JSON.stringify({c: 'host', up: true})); } catch (e) {}
    }
    return new Response(null, {status: 101, webSocket: cli});
  }
  webSocketMessage(ws, data) {
    if (typeof data === 'string') { // host sends {c:'meta', name, open}; pings are auto-answered
      if (!this.state.getTags(ws).includes('host')) return;
      try { const m = JSON.parse(data); if (m.c === 'meta') { this.meta = {name: clean(m.name) || 'Friendly war', open: !!m.open}; this.state.storage.put('meta', this.meta); this.state.storage.setAlarm(Date.now() + 300); } } catch (e) {}
      return;
    }
    const isHost = this.state.getTags(ws).includes('host');
    if (isHost) {
      const b = new Uint8Array(data), n = b[0], id = dec.decode(b.subarray(1, 1 + n)), body = b.subarray(1 + n);
      for (const g of this.state.getWebSockets('guest')) if (!n || g.deserializeAttachment() === id) try { g.send(body); } catch (e) {}
    } else {
      const h = this.host(); if (!h) return;
      const id = enc.encode(ws.deserializeAttachment() || ''), b = new Uint8Array(data), out = new Uint8Array(1 + id.length + b.length);
      out[0] = id.length; out.set(id, 1); out.set(b, 1 + id.length);
      try { h.send(out); } catch (e) {}
    }
  }
  webSocketClose(ws) {
    if (this.state.getTags(ws).includes('host')) {
      if (this.host() && this.host() !== ws) return; // already replaced
      for (const g of this.state.getWebSockets('guest')) try { g.send(JSON.stringify({c: 'host', up: false})); } catch (e) {}
    } else { const h = this.host(), id = ws.deserializeAttachment(); if (h && id) try { h.send(JSON.stringify({c: 'leave', id})); } catch (e) {} }
  }
  webSocketError(ws) { this.webSocketClose(ws); }
  async alarm() { // heartbeat to the directory while a host is connected
    this._code = this._code || await this.state.storage.get('code'); const h = this.host();
    this.meta = this.meta || await this.state.storage.get('meta') || {name: 'Friendly war', open: true};
    const body = JSON.stringify({code: this.code(), name: this.meta.name, open: this.meta.open, n: this.state.getWebSockets('guest').length + 1, gone: !h});
    try { await this.env.DIR.get(this.env.DIR.idFromName('dir')).fetch('https://d/beat', {method: 'POST', body}); } catch (e) {}
    if (h) this.state.storage.setAlarm(Date.now() + 20000);
  }
  code() { return this._code || ''; }
}

const clean = s => String(s || '').replace(/[^A-Za-z0-9 .'!&-]/g, '').trim().slice(0, 28);

// One directory: which rooms are live right now, plus a permanent log of every room that has been made.
export class Dir {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const u = new URL(req.url), now = Date.now();
    let rooms = await this.state.storage.get('rooms') || {};
    for (const k of Object.keys(rooms)) if (now - rooms[k].t > 50000) delete rooms[k];
    if (u.pathname === '/beat') {
      const b = await req.json(), prev = rooms[b.code];
      if (b.gone) delete rooms[b.code];
      else {
        rooms[b.code] = {code: b.code, name: b.name, open: b.open, n: b.n, t: now, since: prev ? prev.since : now};
        if (!prev) await this.log(b, now);
      }
      await this.state.storage.put('rooms', rooms);
      return new Response('ok');
    }
    if (u.pathname === '/log') return new Response(JSON.stringify(await this.state.storage.get('log') || []));
    return new Response(JSON.stringify(Object.values(rooms).map(r => ({code: r.code, name: r.name, open: r.open, n: r.n, age: Math.round((now - r.since) / 1000)}))));
  }
  async log(b, now) {
    const line = {t: new Date(now).toISOString(), code: b.code, name: b.name};
    const log = await this.state.storage.get('log') || []; log.push(line); await this.state.storage.put('log', log.slice(-500));
    const e = this.env; // optional: also record it on GitHub as an issue comment (secret GH_TOKEN, vars GH_REPO "owner/repo", GH_ISSUE number)
    if (e.GH_TOKEN && e.GH_REPO && e.GH_ISSUE) try {
      await fetch('https://api.github.com/repos/' + e.GH_REPO + '/issues/' + e.GH_ISSUE + '/comments', {method: 'POST', headers: {authorization: 'Bearer ' + e.GH_TOKEN, 'user-agent': 'jjfanwars-relay', accept: 'application/vnd.github+json'}, body: JSON.stringify({body: '`' + line.t + '` room **' + line.code + '** "' + line.name + '" created'})});
    } catch (er) {}
  }
}

// ---------------------------------------------------------------------------------------------
// Accounts: one SQLite Durable Object holds every account. An account is just a username (no password yet).
// Tables:  acct (k = name key, name as typed, xp, data JSON, created, updated, sid + seen = the one live session)
//          hist (every change, last 40 per account, so a bad overwrite can be rolled back)
//          ban  (banned name keys)
// The name key folds case, spaces, symbols and look-alike digits (B0b = bob), so nobody can register a near copy of a name.
// Routes (POST, JSON body):  /acct/login {name, sid, xp, data}  ->  {ok, name, xp, data, fresh}  or  {err}
//                            /acct/save  {name, sid, xp, data}  ->  {ok, xp, data}  or  {err}     (also the heartbeat, every minute)
//                            /acct/logout {name, sid}
//   admin (secret ADMIN_KEY): /acct/ban {key, name, why} · /acct/unban {key, name} · /acct/hist {key, name} · /acct/rollback {key, name, id} · /acct/list {key} (every account name, xp, created, updated)
// Merge rules (clients are trusted, but sanity-checked): XP never goes down, and rises by at most XP_STEP per save
// (XP_IMPORT on the first sign-in, when local progress is uploaded). Stats keep the higher number per key. Settings: last write wins.
// Unlocks and achievements: union. Clan tag: last write wins.
const LEASE = 150e3, XP_STEP = 8000, XP_IMPORT = 60000, DATA_MAX = 16000, HIST_KEEP = 40;
const LEET = {'0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g', '2': 'z'};
const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/./gu, c => LEET[c] || c).replace(/[^a-z\p{L}]/gu, '').replace(/l/g, 'i');
const undouble = s => s.replace(/(.)\1+/gu, '$1');
export const nameKey = s => undouble(fold(s));
// Allowed: letters (any language), digits, spaces, symbols and emoji. Not allowed: < > & " ` \\ and control or invisible characters.
const NAME_BAD_CH = /[<>&"`\\\p{C}\u2028\u2029]|[^\P{Z} ]/u;
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'jjfanwars', 'kicwars', 'warsim', 'claude', 'anthropic', 'system', 'server', 'relay', 'official', 'staff', 'developer', 'dev', 'owner', 'support', 'guest', 'host', 'bot', 'tester', 'null', 'undefined', 'everyone', 'nobody'];
// Substring checks on the folded key (keep the list to words that are rarely inside clean words)
const BAD = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'biatch', 'whore', 'slut', 'nigger', 'nigga', 'niga', 'faggot', 'fagot', 'retard', 'rape', 'rapist', 'penis', 'vagina', 'dick', 'cock', 'pussy', 'porn', 'nazi', 'hitler', 'heil', 'kkk', 'wank', 'twat', 'bastard', 'boob', 'tits', 'anus', 'dildo', 'cum', 'jizz', 'molest', 'pedo', 'paedo', 'sex', 'nude', 'naked', 'horny', 'kys', 'killyourself', 'asshole', 'arse', 'bollock', 'prick', 'spastic', 'chink', 'spic', 'kike', 'wetback', 'tranny'].map(fold);
// Folded words that contain a BAD entry but are fine
const OK_WORDS = ['scunthorpe', 'cocktail', 'cockpit', 'peacock', 'hancock', 'dickens', 'sussex', 'essex', 'middlesex', 'sextant', 'cucumber', 'circumstance', 'document', 'accumulate', 'grape', 'drape', 'scrape', 'therapist', 'arsenal', 'parse', 'torpedo', 'trapeze', 'spice', 'spicy', 'uranus', 'janus', 'acumen', 'cumulus', 'cockroach', 'dickson', 'marseille', 'scrapes', 'sexton'].map(fold);
export function checkName(raw) {
  const name = String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim(), n = [...name].length;
  if (n < 2 || n > 20) return {err: 'Names are 2 to 20 characters.'};
  if (NAME_BAD_CH.test(name)) return {err: 'That name has a character that is not allowed.'};
  const k = nameKey(name);
  if (k.length < 2) return {err: 'Use at least 2 letters in your name.'};
  if (RESERVED.some(r => k === nameKey(r))) return {err: 'That name is reserved.'};
  let f = fold(name); for (const w of OK_WORDS) f = f.split(w).join('_');
  const u = undouble(f); // also catch stretched spellings (fuuuck), but only for words without double letters (so "boob" never blocks "Bob")
  if (BAD.some(w => f.includes(w) || (w === undouble(w) && u.includes(w)))) return {err: 'Please pick a different name.'};
  return {name, k};
}
const J = (o, status) => new Response(JSON.stringify(o), {status: status || 200});
const num = v => Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : 0;
function mergeData(old, inc) {
  const o = old || {}, n = inc && typeof inc === 'object' ? inc : {}, out = {...o};
  const st = {...(o.stats || {})}; for (const k in (n.stats || {})) if (/^[A-Za-z0-9_]{1,24}$/.test(k)) st[k] = Math.max(num(st[k]), num(n.stats[k])); out.stats = st;
  out.camp = Math.max(num(o.camp), num(n.camp));
  if (n.set && typeof n.set === 'object') out.set = n.set;
  const uni = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(x => String(x).slice(0, 32)))].slice(0, 300);
  out.unl = uni(o.unl, n.unl); out.ach = uni(o.ach, n.ach);
  if (typeof n.clan === 'string') out.clan = n.clan.replace(/[^A-Za-z0-9]/g, '').slice(0, 5);
  return out;
}
export class Accts {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS acct (k TEXT PRIMARY KEY, name TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}', created INTEGER, updated INTEGER, sid TEXT, seen INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS hist (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, t INTEGER, xp INTEGER, data TEXT, why TEXT);
      CREATE INDEX IF NOT EXISTS hist_k ON hist (k, id);
      CREATE TABLE IF NOT EXISTS ban (k TEXT PRIMARY KEY, t INTEGER, why TEXT);`);
  }
  row(k) { return this.sql.exec('SELECT * FROM acct WHERE k = ?', k).toArray()[0] || null; }
  hist(k, xp, data, why) {
    this.sql.exec('INSERT INTO hist (k, t, xp, data, why) VALUES (?, ?, ?, ?, ?)', k, Date.now(), xp, data, why);
    this.sql.exec('DELETE FROM hist WHERE k = ? AND id NOT IN (SELECT id FROM hist WHERE k = ? ORDER BY id DESC LIMIT ?)', k, k, HIST_KEEP);
  }
  out(r, extra) { return J({ok: true, name: r.name, xp: r.xp, data: JSON.parse(r.data || '{}'), ...extra}); }
  // Apply an upload: XP only rises (by at most `step`), data merged. Records history when anything changed.
  apply(r, b, step, why) {
    const xp = Math.max(r.xp, Math.min(num(b.xp), r.xp + step));
    let data = JSON.stringify(mergeData(JSON.parse(r.data || '{}'), b.data));
    if (data.length > DATA_MAX) data = r.data; // too big: keep what we had
    if (xp !== r.xp || data !== r.data) { this.sql.exec('UPDATE acct SET xp = ?, data = ?, updated = ? WHERE k = ?', xp, data, Date.now(), r.k); this.hist(r.k, xp, data, why); }
    r.xp = xp; r.data = data; return r;
  }
  async fetch(req) {
    const u = new URL(req.url), now = Date.now(); let b;
    try { b = JSON.parse(await req.text() || '{}'); } catch (e) { return J({err: 'Bad request.'}, 400); }
    const route = u.pathname.slice(6), sid = String(b.sid || '').slice(0, 40);
    if (['ban', 'unban', 'hist', 'rollback', 'list'].includes(route)) return this.admin(route, b);
    if (route === 'count') return J({n: this.sql.exec('SELECT COUNT(*) AS n FROM acct').toArray()[0].n});
    const c = checkName(b.name); if (c.err) return J({err: c.err, bad: 1});
    if (this.sql.exec('SELECT k FROM ban WHERE k = ?', c.k).toArray().length) return J({err: 'That name is banned.', bad: 1});
    let r = this.row(c.k);
    if (route === 'login') {
      if (!sid) return J({err: 'Bad request.'}, 400);
      if (!r) { // new account: one box, the name is the account. Local progress is uploaded on top.
        this.sql.exec('INSERT INTO acct (k, name, xp, data, created, updated, sid, seen) VALUES (?, ?, 0, ?, ?, ?, ?, ?)', c.k, c.name, '{}', now, now, sid, now);
        r = this.apply(this.row(c.k), b, XP_IMPORT, 'import');
        return this.out(r, {fresh: true});
      }
      if (r.sid && r.sid !== sid && now - r.seen < LEASE) return J({err: 'That name is signed in somewhere else right now. Sign out there, or wait 2 minutes.', busy: 1});
      this.sql.exec('UPDATE acct SET sid = ?, seen = ? WHERE k = ?', sid, now, c.k); r.sid = sid;
      if (b.xp !== undefined || b.data) r = this.apply(r, b, b.imp ? XP_IMPORT : XP_STEP, b.imp ? 'import' : 'login');
      return this.out(r, {fresh: false});
    }
    if (!r) return J({err: 'No such account.', gone: 1});
    if (route === 'save') {
      if (r.sid !== sid) { // our session was taken over, or expired and nobody else has it
        if (r.sid && now - r.seen < LEASE) return J({err: 'Signed in somewhere else.', busy: 1});
        r.sid = sid;
      }
      this.sql.exec('UPDATE acct SET sid = ?, seen = ? WHERE k = ?', sid, now, c.k);
      r = this.apply(r, b, XP_STEP, 'save');
      return this.out(r);
    }
    if (route === 'logout') {
      if (r.sid === sid) { if (b.xp !== undefined || b.data) this.apply(r, b, XP_STEP, 'save'); this.sql.exec('UPDATE acct SET sid = NULL, seen = 0 WHERE k = ?', c.k); }
      return J({ok: true});
    }
    return J({err: 'not found'}, 404);
  }
  admin(route, b) {
    if (!this.env.ADMIN_KEY || b.key !== this.env.ADMIN_KEY) return J({err: 'forbidden'}, 403);
    if (route === 'list') return J({ok: true, n: this.sql.exec('SELECT COUNT(*) c FROM acct').toArray()[0].c, accounts: this.sql.exec('SELECT name, xp, created, updated FROM acct ORDER BY created').toArray()}); // every account name, oldest first (admin only)
    const k = nameKey(b.name); if (!k) return J({err: 'name?'}, 400);
    if (route === 'ban') { this.sql.exec('INSERT OR REPLACE INTO ban (k, t, why) VALUES (?, ?, ?)', k, Date.now(), String(b.why || '')); return J({ok: true, k}); }
    if (route === 'unban') { this.sql.exec('DELETE FROM ban WHERE k = ?', k); return J({ok: true, k}); }
    if (route === 'hist') return J({ok: true, k, hist: this.sql.exec('SELECT id, t, xp, why FROM hist WHERE k = ? ORDER BY id DESC', k).toArray()});
    const h = this.sql.exec('SELECT * FROM hist WHERE k = ? AND id = ?', k, num(b.id)).toArray()[0]; // rollback to a history row
    if (!h) return J({err: 'no such history row'}, 404);
    this.sql.exec('UPDATE acct SET xp = ?, data = ?, updated = ? WHERE k = ?', h.xp, h.data, Date.now(), k); this.hist(k, h.xp, h.data, 'rollback ' + h.id);
    return J({ok: true, k, xp: h.xp});
  }
}

// ---------------------------------------------------------------------------------------------
// Track: anonymous play counts for stats.html. The game makes a random id per browser (localStorage jjf_uid), no names.
// Events: open (page loaded; dev = computer|phone, br = browser), beat (every minute while the tab is visible = play time),
// play (a game started, m = mode label), end (a game finished: m, r = win|loss, s = seconds it lasted).
// Days and hours use the time zone in the TZ secret (npx wrangler@3 secret put TZ, e.g. Europe/London), else UTC.
const mkFmt = (tz, o) => { try { return new Intl.DateTimeFormat('en-CA', {timeZone: tz, ...o}); } catch (e) { return new Intl.DateTimeFormat('en-CA', {timeZone: 'UTC', ...o}); } };
const word = (v, n) => String(v || '').replace(/[^\w :+'()/-]/g, '').slice(0, n);
export class Track {
  constructor(state, env) {
    this.sql = state.storage.sql;
    const tz = env.TZ || 'UTC';
    this.fd = mkFmt(tz, {year: 'numeric', month: '2-digit', day: '2-digit'});
    this.fh = mkFmt(tz, {hour: '2-digit', hourCycle: 'h23'});
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (u TEXT PRIMARY KEY, first INTEGER, last INTEGER, secs INTEGER DEFAULT 0, beat INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS day (d TEXT, u TEXT, secs INTEGER DEFAULT 0, PRIMARY KEY (d, u));
      CREATE TABLE IF NOT EXISTS mode (d TEXT, m TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (d, m));
      CREATE TABLE IF NOT EXISTS hr (d TEXT, h INTEGER, u TEXT, PRIMARY KEY (d, h, u));
      CREATE TABLE IF NOT EXISTS peak (d TEXT PRIMARY KEY, n INTEGER);
      CREATE TABLE IF NOT EXISTS fin (d TEXT, m TEXT, r TEXT, n INTEGER DEFAULT 0, secs INTEGER DEFAULT 0, PRIMARY KEY (d, m, r));
      CREATE INDEX IF NOT EXISTS seen_last ON seen (last);`);
    for (const c of ['dev TEXT', 'br TEXT']) try { this.sql.exec('ALTER TABLE seen ADD COLUMN ' + c); } catch (e) {} // added after the first version
  }
  day(t) { return this.fd.format(t); }
  async fetch(req) {
    const u = new URL(req.url), now = Date.now(), d = this.day(now);
    if (u.pathname === '/hit') {
      let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response('bad'); }
      const id = String(b.u || ''); if (!/^[a-z0-9]{8,40}$/.test(id)) return new Response('bad');
      const row = this.sql.exec('SELECT * FROM seen WHERE u = ?', id).toArray()[0];
      if (!row) this.sql.exec('INSERT INTO seen (u, first, last) VALUES (?, ?, ?)', id, now, now);
      this.sql.exec('INSERT OR IGNORE INTO day (d, u) VALUES (?, ?)', d, id);
      this.sql.exec('INSERT OR IGNORE INTO hr (d, h, u) VALUES (?, ?, ?)', d, +this.fh.format(now) % 24, id);
      if (b.e === 'open' && (b.dev || b.br)) this.sql.exec('UPDATE seen SET dev = ?, br = ? WHERE u = ?', word(b.dev, 12) || null, word(b.br, 12) || null, id);
      if (b.e === 'beat' && (!row || now - row.beat > 45e3)) { // at most one minute of play time per 45 s, so spam can't inflate it much
        this.sql.exec('UPDATE seen SET secs = secs + 60, beat = ? WHERE u = ?', now, id);
        this.sql.exec('UPDATE day SET secs = secs + 60 WHERE d = ? AND u = ?', d, id);
      }
      const m = word(b.m, 40) || '?';
      if (b.e === 'play') this.sql.exec('INSERT INTO mode (d, m, n) VALUES (?, ?, 1) ON CONFLICT (d, m) DO UPDATE SET n = n + 1', d, m);
      if (b.e === 'end') this.sql.exec('INSERT INTO fin (d, m, r, n, secs) VALUES (?, ?, ?, 1, ?) ON CONFLICT (d, m, r) DO UPDATE SET n = n + 1, secs = secs + excluded.secs', d, m, b.r === 'win' ? 'win' : 'loss', Math.max(0, Math.min(7200, Math.round(+b.s || 0))));
      this.sql.exec('UPDATE seen SET last = ? WHERE u = ?', now, id);
      const on = this.sql.exec('SELECT COUNT(*) AS n FROM seen WHERE last > ?', now - 90e3).toArray()[0].n;
      this.sql.exec('INSERT INTO peak (d, n) VALUES (?, ?) ON CONFLICT (d) DO UPDATE SET n = MAX(n, excluded.n)', d, on);
      return new Response('ok');
    }
    // Summary. ?days=7|30|90 picks the range for the charts (default 30).
    const span = Math.max(1, Math.min(365, +u.searchParams.get('days') || 30));
    const all = (q, ...a) => this.sql.exec(q, ...a).toArray(), one = (q, ...a) => all(q, ...a)[0] || {};
    const from = this.day(now - (span - 1) * 864e5), week = this.day(now - 6 * 864e5);
    const news = {}; for (const r of all('SELECT first FROM seen WHERE first > ?', now - (span + 1) * 864e5)) { const k = this.day(r.first); news[k] = (news[k] || 0) + 1; }
    const by = (q, key) => Object.fromEntries(all(q, from).map(r => [r.d, r[key]]));
    const starts = by('SELECT d, SUM(n) AS n FROM mode WHERE d >= ? GROUP BY d', 'n'), peaks = by('SELECT d, n FROM peak WHERE d >= ?', 'n');
    const days = all('SELECT d, COUNT(*) AS players, SUM(secs) AS secs FROM day WHERE d >= ? GROUP BY d ORDER BY d', from)
      .map(r => ({d: r.d, players: r.players, new: news[r.d] || 0, mins: Math.round(r.secs / 60), starts: starts[r.d] || 0, peak: peaks[r.d] || 0}));
    const hours = Array(24).fill(0); for (const r of all('SELECT h, COUNT(*) AS n FROM hr WHERE d >= ? GROUP BY h', from)) hours[r.h] = r.n;
    const sess = [['Under 1 min', 0, 59], ['1 to 5 min', 60, 299], ['5 to 15 min', 300, 899], ['15 to 30 min', 900, 1799], ['30 to 60 min', 1800, 3599], ['Over an hour', 3600, 1e12]]
      .map(([k, a, z]) => ({k, n: one('SELECT COUNT(*) AS n FROM day WHERE d >= ? AND secs BETWEEN ? AND ?', from, a, z).n || 0}));
    const loyal = [['1 day', 1, 1], ['2 days', 2, 2], ['3 to 5 days', 3, 5], ['6 to 10 days', 6, 10], ['Over 10 days', 11, 1e9]]
      .map(([k, a, z]) => ({k, n: one('SELECT COUNT(*) AS n FROM (SELECT COUNT(*) AS c FROM day GROUP BY u) WHERE c BETWEEN ? AND ?', a, z).n || 0}));
    const split = col => all(`SELECT COALESCE(${col}, 'Unknown') AS k, COUNT(*) AS n FROM seen WHERE last >= ? GROUP BY k ORDER BY n DESC`, now - span * 864e5);
    const modeRows = q => { // starts, finishes, wins and average game length per mode
      const fin = {}; for (const r of all('SELECT m, r, SUM(n) AS n, SUM(secs) AS secs FROM fin ' + q + ' GROUP BY m, r', ...(q ? [from] : []))) { const f = fin[r.m] || (fin[r.m] = {win: 0, loss: 0, secs: 0}); f[r.r] = r.n; f.secs += r.secs; }
      return all('SELECT m, SUM(n) AS n FROM mode ' + q + ' GROUP BY m ORDER BY n DESC LIMIT 30', ...(q ? [from] : [])).map(r => { const f = fin[r.m] || {win: 0, loss: 0, secs: 0}, done = f.win + f.loss; return {m: r.m, n: r.n, done, win: f.win, mins: done ? Math.round(f.secs / done / 6) / 10 : null}; });
    };
    const tot = one('SELECT COUNT(*) AS n, SUM(secs) AS secs FROM seen'), back = one('SELECT COUNT(*) AS n FROM (SELECT u FROM day GROUP BY u HAVING COUNT(*) > 1)');
    const pday = one('SELECT COUNT(*) AS n, SUM(secs) AS secs FROM day WHERE d >= ?', from);
    return new Response(JSON.stringify({
      now, day: d, span, players: tot.n || 0, mins: Math.round((tot.secs || 0) / 60), returning: back.n || 0,
      today: one('SELECT COUNT(*) AS n FROM day WHERE d = ?', d).n || 0,
      week: one('SELECT COUNT(DISTINCT u) AS n FROM day WHERE d >= ?', week).n || 0,
      range: one('SELECT COUNT(DISTINCT u) AS n FROM day WHERE d >= ?', from).n || 0,
      avgMins: pday.n ? Math.round(pday.secs / pday.n / 6) / 10 : 0,
      online: one('SELECT COUNT(*) AS n FROM seen WHERE last > ?', now - 90e3).n || 0,
      peakEver: one('SELECT MAX(n) AS n FROM peak').n || 0,
      days, hours, sess, loyal, dev: split('dev'), br: split('br'), modes: modeRows('WHERE d >= ?'), modesAll: modeRows(''),
    }));
  }
}

// Courtroom Duel (legal.html) marking: the page sends {pass, user} as text/plain (no CORS preflight). The relay checks the
// password and calls Claude Haiku with its own key, so no key ever reaches the browser. Secrets: ANTHROPIC_KEY, LEGAL_PASS.
const LEGAL_SYS = 'You are an experienced VCE Legal Studies examiner in Victoria, Australia, acting as the judge in a courtroom revision game. Mark the student answer strictly but fairly against the marking guide, like a real VCAA assessor. Award marks for correct legal terminology, accurate explanation, application to the scenario where relevant, and the right task word (explain, distinguish, compare, evaluate, discuss, analyse). Equivalent wording that shows the same understanding earns the mark. Reply with ONLY a JSON object: {"score": integer, "got": [short strings: what earned marks], "missed": [short strings: what was missing or wrong], "tip": "one or two sentences on how to lift the mark", "better": "a short improved version of the student answer in their own style", "jab": "the opposing barrister\'s one-line courtroom objection mocking the biggest gap in the answer, witty and PG, max 20 words; if the answer was perfect, a sulky concession", "ruling": "the judge\'s one-sentence ruling on the argument, max 22 words, in a judge\'s voice"}.';
// Setup without a computer: the menu's key box posts {pass, key} to /legal/setup; the key is kept in the Legal Durable Object
// (env secrets ANTHROPIC_KEY / LEGAL_PASS win if set).
export class Legal {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const b = await req.json(), st = this.state.storage;
    if (b.op === 'get') return Response.json({key: await st.get('key'), pass: await st.get('pass'), used: await st.get('used')});
    if (b.op === 'set') { await st.put({key: b.key, pass: b.pass, used: true}); return Response.json({ok: true}); }
    return Response.json({err: 'bad op'}, {status: 400});
  }
}
async function legalGrade(req, env, CORS, path) {
  const H = {...CORS, 'content-type': 'application/json', 'cache-control': 'no-store'};
  const J = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: H});
  if (req.method === 'OPTIONS') return new Response(null, {headers: {...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type'}});
  if (req.method !== 'POST') return J({err: 'expected POST'}, 405);
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return J({err: 'bad request'}, 400); }
  const lg = env.LEGAL.get(env.LEGAL.idFromName('main')), call = o => lg.fetch('https://l/', {method: 'POST', body: JSON.stringify(o)}).then(r => r.json());
  const saved = await call({op: 'get'});
  const KEY = env.ANTHROPIC_KEY || saved.key, PASS = env.LEGAL_PASS || saved.pass;
  if (path === '/legal/setup') { // key box in the menu: needs the court password (or the old one-time setup token)
    const tokOk = env.LEGAL_SETUP && b.setup === env.LEGAL_SETUP && !saved.used;
    if (!tokOk && !(PASS && b.pass === PASS)) return J({err: 'wrong password'}, 403);
    if (!/^sk-ant-/.test((b.key || '').trim())) return J({err: 'that does not look like an Anthropic key (sk-ant-...)'}, 400);
    await call({op: 'set', key: b.key.trim(), pass: PASS || String(b.pass)}); return J({ok: true});
  }
  if (b.status) return J({key: !!KEY, pass: !!PASS});
  if (!PASS) return J({err: 'marking is not set up on the relay yet'}, 503);
  if (b.pass !== PASS) return J({err: 'wrong password'}, 403);
  if (b.check) return J({ok: true, key: !!KEY});
  if (!KEY) return J({err: 'no API key saved yet: paste it in the menu (Owner: API key)'}, 503);
  const user = String(b.user || '').slice(0, 8000);
  if (!user) return J({err: 'empty answer'}, 400);
  const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 1000, system: LEGAL_SYS, messages: [{role: 'user', content: user}]})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return J({err: (j.error && j.error.message) || 'Anthropic HTTP ' + r.status}, 502);
  return J({text: (j.content || []).map(c => c.text || '').join('')});
}

// IB Study (ib/index.html): textbooks, practice questions and Claude Sonnet tutoring behind a password. Book pages
// (Markdown + page images) and questions live in the IB Durable Object's SQLite, so no copyrighted text is in the
// public repo. Secrets: IB_PASS (the app password), IB_ADMIN (uploads), ANTHROPIC_KEY (or the key saved for /legal).
// Requests are text/plain JSON {pass, ...}; images are GET /ib/img?b=&n=&t=<pass>. IB_CAP = Claude calls per day (default 300).
const IB_SYS = `You are a brilliant, warm IB Diploma teacher and examiner working one-to-one with a student. You teach for real understanding, not memorisation.

How you teach:
- Start from intuition. Before definitions, give the core idea in one plain sentence, then a vivid analogy or everyday example (school, sport, friends, games, the news) that makes it click. Then connect it to the precise course terms.
- Build up in small steps, from the simple case to the full idea. Use concrete, real-world case studies (prefer the textbook's) and say what each example shows.
- Show structure visually when it helps: a short comparison table, a quick flow (cause -> effect), or a 3-point summary.
- Check understanding instead of lecturing: after a chunk, ask one short question that makes the student apply the idea (not repeat it), then build on their answer. When they are wrong, find the useful part of what they said and fix the misconception kindly and clearly.
- Link ideas: show how this concept connects to others in the course and how it turns up in exam questions (command terms, Paper 1/2 use).
- Give memory hooks where useful (a mnemonic, a contrast pair, a one-line takeaway).
- Adapt: if the student seems lost, go simpler with a new analogy; if they are confident, push them with a harder "what if" or counter-argument.
- Keep replies focused and readable: short paragraphs, bold key terms, under about 250 words unless the student asks for more or you are giving exam feedback.

Accuracy: ground course content in the textbook extracts provided and cite them as "p. N" (printed page numbers). Say clearly when you go beyond the textbook. Never invent facts, statistics or quotes; if unsure, say so.
When marking, act as a strict but fair IB examiner who also wants the student to improve.
Notation: for maths and science, write formulas and equations in LaTeX between $...$ (display: $$...$$) and chemical species and reactions with mhchem, e.g. $\\ce{2H2 + O2 -> 2H2O}$. Do not use $ for anything else in science subjects (write "dollars").`;
const MARK_SCHEMA = {type: 'object', additionalProperties: false, required: ['score', 'max', 'band', 'verdict', 'good', 'missed', 'fix', 'plan', 'terms'], properties: {
  score: {type: 'integer'}, max: {type: 'integer'}, band: {type: 'string'}, verdict: {type: 'string'},
  good: {type: 'array', items: {type: 'string'}}, missed: {type: 'array', items: {type: 'string'}}, fix: {type: 'array', items: {type: 'string'}},
  plan: {type: 'string'}, terms: {type: 'array', items: {type: 'string'}}}};
// usage tracking: $ per million tokens [input, output, cache read, cache write]
const PRICE = {'claude-sonnet-5-5': [2, 10, .1, 2.5], 'claude-haiku-5-5': [.1, .5, .01, .125]};
function ibUse(db, who, model, us) {
  if (!us) return; const P = PRICE[model] || PRICE['claude-sonnet-5-5'], tin = us.input_tokens || 0, tout = us.output_tokens || 0, tcr = us.cache_read_input_tokens || 0, tcw = us.cache_creation_input_tokens || 0;
  return db('use', {u: who, tin, tout, tcr, tcw, cost: (tin * P[0] + tout * P[1] + tcr * P[2] + tcw * P[3]) / 1e6});
}
async function ibKey(env, db) {
  const v = await (await db('kvget', {k: 'apikey'})).text(); if (v && v.startsWith('sk-')) return v;
  const lg = await (await env.LEGAL.get(env.LEGAL.idFromName('main')).fetch('https://l/', {method: 'POST', body: '{"op":"get"}'})).json();
  return env.ANTHROPIC_KEY || lg.key;
}
async function ibRoute(req, env, CORS, u) {
  const H = {...CORS, 'content-type': 'application/json', 'cache-control': 'no-store'};
  const J = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: H});
  const ib = env.IB.get(env.IB.idFromName('main')), db = (op, o = {}) => ib.fetch('https://i/', {method: 'POST', body: JSON.stringify({...o, op})});
  const PASS = env.IB_PASS, OPEN = env.IB_OPEN === '1'; // IB_OPEN=1: no password for the app or PDF downloads (the calendar feed still needs it)
  if (!PASS) return J({err: 'IB app is not set up on the relay yet'}, 503);
  // accounts: first name only (the site itself is private). Each account has its own planner + progress (kv plan:<key>, prog:<key>)
  // and a random token for its calendar feed. The first account created inherits the data from before accounts existed.
  const users = async () => JSON.parse(await (await db('kvget', {k: 'users'})).text() || '{}') || {};
  const ukey = n => String(n || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 24);
  if (u.pathname === '/ib/cal.ics') { // calendar feed for phone/Google/Apple calendar subscriptions
    const k = u.searchParams.get('k'), U = k && Object.entries(await users()).find(([, v]) => v.tok === k);
    if (!U && u.searchParams.get('t') !== PASS) return new Response('no', {status: 403});
    const items = JSON.parse(await (await db('kvget', {k: U ? 'plan:' + U[0] : 'plan'})).text() || '[]');
    return new Response(toIcs(items), {headers: {'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store'}});
  }
  if (u.pathname === '/ib/key') { // owner pastes a new Anthropic key here (link holds the IB_KEYTOK secret); checked against the API before saving
    const tok = env.IB_KEYTOK; if (!tok) return new Response('off', {status: 404});
    if (req.method === 'GET') return new Response(u.searchParams.get('t') !== tok ? 'no' : `<!doctype html><meta name=viewport content="width=device-width"><title>API key</title><body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h2>IB Study: Anthropic API key</h2><form method=post><input type=hidden name=t value="${tok}"><input name=key type=password placeholder="sk-ant-..." style="width:100%;padding:10px;font:inherit" autofocus><p><button style="padding:10px 16px;font:inherit">Save</button></p></form>`, {status: u.searchParams.get('t') !== tok ? 403 : 200, headers: {'content-type': 'text/html; charset=utf-8'}});
    const f = await req.formData(), key = String(f.get('key') || '').trim(), page = m => new Response(`<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h2>${m}</h2>`, {headers: {'content-type': 'text/html; charset=utf-8'}});
    if (f.get('t') !== tok) return page('Wrong link');
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) return page('That doesn\'t look like an Anthropic key (sk-ant-...)');
    const t = await fetch('https://api.anthropic.com/v1/models?limit=1', {headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'}});
    if (!t.ok) return page('Anthropic rejected that key (HTTP ' + t.status + '). Nothing changed.');
    await db('kvset', {k: 'apikey', v: key}); return page('Saved. IB Study now uses the new key.');
  }
  if (u.pathname === '/ib/file') { // whole textbook PDF, stored in ~1.9 MB chunks, streamed back as one download
    if (!OPEN && u.searchParams.get('t') !== PASS) return new Response('no', {status: 403, headers: CORS});
    const b0 = u.searchParams.get('b'), meta = await (await db('fmeta', {b: b0})).json();
    if (!meta.n) return new Response('no file', {status: 404, headers: CORS});
    const {readable, writable} = new FixedLengthStream(meta.size);
    (async () => { const w = writable.getWriter(); for (let i = 0; i < meta.n; i++) { const r = await db('fchunk', {b: b0, i}); await w.write(new Uint8Array(await r.arrayBuffer())); } await w.close(); })();
    return new Response(readable, {headers: {...CORS, 'content-type': 'application/pdf', 'content-length': String(meta.size), 'content-disposition': `attachment; filename="${(meta.name || b0 + '.pdf').replace(/"/g, '')}"`}});
  }
  if (u.pathname === '/ib/img') {
    if (!OPEN && u.searchParams.get('t') !== PASS) return new Response('no', {status: 403, headers: CORS});
    const r = await db('img', {b: u.searchParams.get('b'), n: +u.searchParams.get('n')});
    return new Response(r.body, {status: r.status, headers: {...CORS, 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=604800'}});
  }
  if (u.pathname === '/ib/stats') { // owner-only usage dashboard: /ib/stats?k=<IB_STATS>
    if (!env.IB_STATS || u.searchParams.get('k') !== env.IB_STATS) return new Response('no', {status: 403});
    const d = await (await db('stats', {days: Math.min(365, +u.searchParams.get('days') || 30)})).json();
    if (!d.days) return new Response('stats error', {status: 500});
    return new Response(statsPage(d, u.searchParams.get('days') || 30, env.IB_STATS), {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
  }
  if (req.method === 'OPTIONS') return new Response(null, {headers: {...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type'}});
  if (req.method !== 'POST') return J({err: 'expected POST'}, 405);
  if (u.pathname === '/ib/ocr') { // admin: transcribe one page image with Claude Haiku (book import)
    if (!env.IB_ADMIN || req.headers.get('x-ib-admin') !== env.IB_ADMIN) return J({err: 'no'}, 403);
    const o = await req.json();
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': await ibKey(env, db), 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: o.model || 'claude-haiku-5-5', max_tokens: 8000, output_config: {effort: 'low'}, system: [{type: 'text', text: o.sys, cache_control: {type: 'ephemeral'}}],
        messages: [{role: 'user', content: [{type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: o.img}}, {type: 'text', text: o.hint || 'Transcribe this page.'}]}]})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({err: (j.error && j.error.message) || 'HTTP ' + r.status}, 502);
    await ibUse(db, 'build', o.model || 'claude-haiku-5-5', j.usage);
    return J({text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), stop: j.stop_reason, usage: j.usage});
  }
  if (u.pathname === '/ib/gen') { // admin: one structured-output call over text (build-time extraction of formulas, case studies)
    if (!env.IB_ADMIN || req.headers.get('x-ib-admin') !== env.IB_ADMIN) return J({err: 'no'}, 403);
    const o = await req.json();
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': await ibKey(env, db), 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: o.model || 'claude-haiku-5-5', max_tokens: 16000, output_config: {effort: 'low', format: {type: 'json_schema', schema: o.schema}}, system: [{type: 'text', text: o.sys, cache_control: {type: 'ephemeral'}}], messages: [{role: 'user', content: o.text}]})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({err: (j.error && j.error.message) || 'HTTP ' + r.status}, 502);
    await ibUse(db, 'build', o.model || 'claude-haiku-5-5', j.usage);
    return J({text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), stop: j.stop_reason, usage: j.usage});
  }
  if (u.pathname === '/ib/deluser') { // admin: remove an account and its data (planner, progress, inbox, chats)
    if (!env.IB_ADMIN || req.headers.get('x-ib-admin') !== env.IB_ADMIN) return J({err: 'no'}, 403);
    const k = ukey((await req.json()).name), all = await users(); if (!k || !all[k]) return J({err: 'no such account'}, 404);
    const idx = JSON.parse(await (await db('kvget', {k: 'chats:' + k})).text() || '{}') || {};
    for (const o of Object.keys(Array.isArray(idx) ? {} : idx)) { await db('kvset', {k: 'chat:' + [k, o].sort().join('|'), v: '[]'});
      const oi = JSON.parse(await (await db('kvget', {k: 'chats:' + o})).text() || '{}'); if (oi && !Array.isArray(oi)) { delete oi[k]; await db('kvset', {k: 'chats:' + o, v: JSON.stringify(oi)}); } }
    for (const p of ['plan:', 'prog:', 'inbox:', 'chats:']) await db('kvset', {k: p + k, v: p === 'chats:' || p === 'prog:' ? '{}' : '[]'});
    delete all[k]; await db('kvset', {k: 'users', v: JSON.stringify(all)}); return J({ok: true, left: Object.keys(all).length});
  }
  if (u.pathname === '/ib/put') { // uploads from the build script: admin key only
    if (!env.IB_ADMIN || req.headers.get('x-ib-admin') !== env.IB_ADMIN) return J({err: 'no'}, 403);
    const r = await ib.fetch('https://i/put' + u.search, {method: 'POST', body: req.body});
    return new Response(r.body, {status: r.status, headers: H});
  }
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return J({err: 'bad request'}, 400); }
  const op = u.pathname.slice(4);
  if (b.pass !== PASS && !(OPEN && op !== 'login')) return J({err: 'wrong password'}, 403);
  if (op === 'login') return J({ok: true});
  if (op === 'user') { // sign in or create: {name}
    const key = ukey(b.name); if (!key) return J({err: 'enter your first name'}, 400);
    const all = await users(); let isNew = false;
    if (!all[key]) {
      isNew = true; const first = !Object.keys(all).length;
      all[key] = {name: String(b.name).trim().slice(0, 30), tok: crypto.randomUUID().replace(/-/g, ''), t: Date.now()};
      await db('kvset', {k: 'users', v: JSON.stringify(all)});
      if (first) for (const k of ['plan', 'prog']) { const v = await (await db('kvget', {k})).text(); if (v && v !== '[]' && v !== '{}') await db('kvset', {k: k + ':' + key, v}); }
    }
    return J({key, name: all[key].name, tok: all[key].tok, isNew});
  }
  const uk = ukey(b.user), who = uk ? 'u:' + uk : b.uid ? 'g:' + String(b.uid).replace(/[^\w-]/g, '').slice(0, 16) : 'anon';
  if (op === 'beat') { await db('beat', {u: who, name: uk ? String(b.name || uk).slice(0, 30) : '', dev: String(b.dev || '').slice(0, 40)}); return J({ok: true}); }
  if (['plan', 'sync', 'agent'].includes(op) && !uk) return J({err: 'sign in first'}, 401);
  if (op === 'plan') { // planner items: {data} replaces the list, else returns it
    if (b.data) { await db('kvset', {k: 'plan:' + uk, v: JSON.stringify(b.data)}); return J({ok: true}); }
    const r = await db('kvget', {k: 'plan:' + uk}); return new Response(r.body, {headers: H});
  }
  if (op === 'agent') return planAgent(b, env, db, J, uk, who);
  // sharing between accounts by first name: decks, notes/ideas, mind maps, questions, pages land in the friend's inbox
  if (['send', 'inbox', 'inboxdel', 'chatsend', 'chats', 'chat'].includes(op) && !uk) return J({err: 'sign in first'}, 401);
  // chat between friends: thread 'chat:a|b' (sorted keys), each person's thread list 'chats:<key>' = {otherKey: {name, t, last, me}}
  if (op === 'chatsend') {
    const all = await users(), to = ukey(b.to), x = String(b.text || '').trim().slice(0, 2000); if (!to || !all[to]) return J({err: `No one called ${String(b.to || '').slice(0, 30)} has an account yet`}, 404);
    if (!x) return J({err: 'empty'}, 400); const me = (all[uk] || {}).name || uk, t = Date.now(), m = {id: crypto.randomUUID().slice(0, 10), f: uk, x, t};
    await db('push', {k: 'chat:' + [uk, to].sort().join('|'), v: m, cap: 500});
    await db('mset', {k: 'chats:' + uk, f: to, v: {name: all[to].name, t, last: x.slice(0, 90), me: 1}});
    if (to !== uk) await db('mset', {k: 'chats:' + to, f: uk, v: {name: me, t, last: x.slice(0, 90), me: 0}});
    return J({ok: true, m, to: all[to].name, tk: to});
  }
  if (op === 'chats') { const r = await (await db('kvget', {k: 'chats:' + uk})).text(); return new Response(r === '[]' ? '{}' : r, {headers: H}); }
  if (op === 'chat') { const w = ukey(b.with); if (!w) return J([]); const L = JSON.parse(await (await db('kvget', {k: 'chat:' + [uk, w].sort().join('|')})).text() || '[]'); return J(L.filter(m => m.t > (+b.after || 0))); }
  if (op === 'send') {
    const all = await users(), to = ukey(b.to); if (!to || !all[to]) return J({err: `No one called ${String(b.to || '').slice(0, 30)} has an account yet`}, 404);
    const it = {id: crypto.randomUUID().slice(0, 12), from: (all[uk] || {}).name || uk, kind: String(b.kind || 'note').slice(0, 10), title: String(b.title || '').slice(0, 120), note: String(b.note || '').slice(0, 2000), data: b.data || null, t: Date.now()};
    if (JSON.stringify(it).length > 400000) return J({err: 'too big to send'}, 413);
    await db('push', {k: 'inbox:' + to, v: it, cap: 80}); return J({ok: true, to: all[to].name});
  }
  if (op === 'inbox') { const r = await db('kvget', {k: 'inbox:' + uk}); return new Response(r.body, {headers: H}); }
  if (op === 'inboxdel') { await db('pull', {k: 'inbox:' + uk, ids: (b.ids || []).map(String)}); return J({ok: true}); }
  if (op === 'mapgen') { // mind map of a textbook chapter (Haiku, structured, 4 levels)
    const KEY = await ibKey(env, db); const cap = +(env.IB_CAP || 300), used = await (await db('spend', {cap})).json(); if (used.over) return J({err: 'daily Claude limit reached'}, 429);
    const ns = (b.pages || []).map(Number).filter(n => n > 0).slice(0, 30), pg = await (await db('pages', {b: b.book, ns})).json();
    const N = d => ({type: 'object', additionalProperties: false, required: d ? ['t', 'c'] : ['t'], properties: d ? {t: {type: 'string'}, c: {type: 'array', items: N(d - 1)}} : {t: {type: 'string'}}});
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 6000, output_config: {effort: 'low', format: {type: 'json_schema', schema: N(4)}},
        system: 'You make a revision mind map of an IB textbook chapter for a student. Root t = the chapter title. 4 to 7 main branches (the big ideas), each with the key sub-ideas, and under those the definitions, equations, examples, case studies and exam tips a student must remember. Labels are short (under 15 words), precise and in the book\'s own terms; maths/chemistry in LaTeX inside $...$. 40 to 80 nodes in total. Leaves have no c.',
        messages: [{role: 'user', content: `Chapter: ${String(b.title || '').slice(0, 200)}\n\n` + pg.pages.map(p => `<page ${p.bp}>\n${p.md}\n</page>`).join('\n')}]})});
    const j = await r.json().catch(() => ({})); if (!r.ok) return J({err: (j.error && j.error.message) || 'HTTP ' + r.status}, 502);
    await ibUse(db, who, 'claude-haiku-5-5', j.usage);
    try { return J({tree: JSON.parse(j.content.find(c => c.type === 'text').text)}); } catch (e) { return J({err: 'bad map'}, 502); }
  }
  if (op === 'ref') { const r = await db('kvget', {k: 'ref:' + String(b.book || '').replace(/[^a-z0-9]/g, '')}); return new Response(r.body, {headers: H}); } // formula sheet / case bank for a book
  if (op === 'quiz') { // spaced section review: 3 short questions + model answers from the section's pages (Haiku, cheap)
    const KEY = await ibKey(env, db); const cap = +(env.IB_CAP || 300), used = await (await db('spend', {cap})).json(); if (used.over) return J({err: 'daily Claude limit reached'}, 429);
    const ns = (b.pages || []).map(Number).filter(n => n > 0).slice(0, 12), pg = await (await db('pages', {b: b.book, ns})).json();
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 3000, output_config: {effort: 'low', format: {type: 'json_schema', schema: {type: 'object', additionalProperties: false, required: ['qs'], properties: {qs: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['q', 'a'], properties: {q: {type: 'string'}, a: {type: 'string'}}}}}}}},
        system: 'You write quick retrieval-practice checks for an IB student from their textbook section. Write exactly 3 short questions that test understanding of the most important ideas (not trivia, not page layout): one recall, one explain-why, one apply. Each model answer is 1-3 sentences, the way an examiner would accept it. For maths/science use LaTeX in $...$ and mhchem \\ce{}. Avoid repeating these earlier questions: ' + String(b.avoid || '').slice(0, 1500),
        messages: [{role: 'user', content: `Section: ${String(b.title || '').slice(0, 200)}\n\n` + pg.pages.map(p => `<page ${p.bp}>\n${p.md}\n</page>`).join('\n')}]})});
    const j = await r.json().catch(() => ({})); if (!r.ok) return J({err: (j.error && j.error.message) || 'HTTP ' + r.status}, 502);
    await ibUse(db, who, 'claude-haiku-5-5', j.usage);
    try { return J(JSON.parse(j.content.find(c => c.type === 'text').text)); } catch (e) { return J({err: 'bad quiz'}, 502); }
  }
  if (op === 'papers') { const r = await db('kvget', {k: 'papers'}); return new Response(r.body, {headers: H}); } // past papers (uploaded by the owner as kv 'papers')
  if (op === 'sync') { const r = await db('sync', {...b, k: 'prog:' + uk}); return new Response(r.body, {status: r.status, headers: H}); }
  if (['books', 'page', 'pagebp', 'pages', 'search', 'qs'].includes(op)) { const r = await db(op, b); return new Response(r.body, {status: r.status, headers: H}); }
  if (op !== 'ask') return J({err: 'not found'}, 404);
  const KEY = await ibKey(env, db);
  if (!KEY) return J({err: 'no API key on the relay'}, 503);
  const cap = +(env.IB_CAP || 300), used = await (await db('spend', {cap})).json();
  if (used.over) return J({err: `daily limit of ${cap} Claude replies reached, back tomorrow`}, 429);
  // context: the textbook pages the client points at (max 10), pulled from storage so the client can't inject a huge prompt
  const msgs = (b.messages || []).slice(-24).map(m => ({role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 12000)}));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return J({err: 'empty question'}, 400);
  // pages: the ones the client names, plus (when find is set, i.e. the first turn of a chat) the best keyword matches for the question.
  // The client sends the returned page list back on later turns, so the system prompt stays identical and the cache keeps hitting.
  let refs = (b.pages || []).map(Number).filter(n => n > 0).slice(0, 10);
  if (b.find && b.book) refs = [...new Set([...refs, ...(await (await db('find', {b: b.book, q: msgs[msgs.length - 1].content, k: 5})).json()).ns])].slice(0, 10);
  const pg = refs.length ? await (await db('pages', {b: b.book, ns: refs})).json() : {pages: []};
  const ctx = pg.pages.map(p => `<extract page="${p.bp}">\n${p.md}\n</extract>`).join('\n');
  const books = JSON.parse(await (await db('books')).text()), bk = books.find(x => x.id === b.book);
  const toc = bk ? `The student's textbook: ${bk.title}. Contents (section, printed page):\n` + bk.toc.map(t => `${t.num || '-'} ${t.title} (p. ${t.bp})`).join('\n') : '';
  // cache layout: [fixed tutor prompt + book contents] [rubric] [extracts] then the conversation (top-level automatic caching)
  const sys = [{type: 'text', text: IB_SYS + (toc ? '\n\n' + toc : '')}];
  if (b.mode === 'mark') sys.push({type: 'text', text: String(b.rubric || '').slice(0, 6000)});
  if (ctx) sys.push({type: 'text', text: 'Textbook extracts:\n' + ctx});
  sys[sys.length - 1].cache_control = {type: 'ephemeral'};
  if (b.stream && b.mode !== 'mark') { sys[0].text += "\n\nTools: messages may start with a one-line [Location: ...] note saying where the student is in the app. You are NOT shown the page or their work automatically: call read_page, search_book or read_screen only when the question actually needs it (one or two calls is usually enough), then answer.";
    return tutorStream({b, sys, msgs, KEY, db, CORS, refs, who}); }
  const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01'},
    body: JSON.stringify({model: 'claude-sonnet-5-5', max_tokens: 8000, fallbacks: 'default', cache_control: {type: 'ephemeral'}, system: sys, messages: msgs,
      output_config: b.mode === 'mark' ? {effort: 'medium', format: {type: 'json_schema', schema: MARK_SCHEMA}} : {effort: 'low'}})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return J({err: (j.error && j.error.message) || 'Anthropic HTTP ' + r.status}, 502);
  if (j.stop_reason === 'refusal') return J({err: 'Claude declined to answer that one.'}, 200);
  const us = j.usage || {}; await ibUse(db, who, 'claude-sonnet-5-5', j.usage);
  return J({text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), left: cap - used.n, pages: refs,
    usage: {in: us.input_tokens, cached: us.cache_read_input_tokens, wrote: us.cache_creation_input_tokens, out: us.output_tokens}});
}
export class IB {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS page (b TEXT, n INTEGER, bp TEXT, md TEXT, PRIMARY KEY (b, n));
      CREATE TABLE IF NOT EXISTS img (b TEXT, n INTEGER, data BLOB, PRIMARY KEY (b, n));
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS spend (d TEXT PRIMARY KEY, n INTEGER);
      CREATE TABLE IF NOT EXISTS fchunk (b TEXT, i INTEGER, data BLOB, PRIMARY KEY (b, i));
      CREATE TABLE IF NOT EXISTS use (d TEXT, u TEXT, mins INTEGER DEFAULT 0, calls INTEGER DEFAULT 0, tin INTEGER DEFAULT 0, tout INTEGER DEFAULT 0, tcr INTEGER DEFAULT 0, tcw INTEGER DEFAULT 0, cost REAL DEFAULT 0, PRIMARY KEY (d, u));
      CREATE TABLE IF NOT EXISTS who (u TEXT PRIMARY KEY, name TEXT, first INTEGER, last INTEGER, dev TEXT);`);
  }
  kv(k, v) { if (v === undefined) { const r = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0]; return r ? r.v : null; } this.sql.exec('INSERT OR REPLACE INTO kv VALUES (?, ?)', k, v); }
  async fetch(req) {
    const u = new URL(req.url), J = o => Response.json(o);
    if (u.pathname === '/put') { // ?t=page&b=&n=&bp= (body md) | ?t=img&b=&n= (body jpeg) | ?t=kv&k= (body json)
      const t = u.searchParams.get('t'), b = u.searchParams.get('b'), n = +u.searchParams.get('n');
      if (t === 'page') { this.idx = null; this.sql.exec('INSERT OR REPLACE INTO page VALUES (?, ?, ?, ?)', b, n, u.searchParams.get('bp') || '', await req.text()); }
      else if (t === 'img') this.sql.exec('INSERT OR REPLACE INTO img VALUES (?, ?, ?)', b, n, await req.arrayBuffer());
      else if (t === 'kv') this.kv(u.searchParams.get('k'), await req.text());
      else if (t === 'fchunk') this.sql.exec('INSERT OR REPLACE INTO fchunk VALUES (?, ?, ?)', b, n, await req.arrayBuffer());
      else if (t === 'fmeta') this.kv('file:' + b, await req.text());
      else return Response.json({err: 'bad type'}, {status: 400});
      return J({ok: true});
    }
    const o = await req.json(), all = (q, ...a) => this.sql.exec(q, ...a).toArray();
    switch (o.op) {
      case 'img': { const r = all('SELECT data FROM img WHERE b = ? AND n = ?', o.b, o.n)[0]; return r ? new Response(r.data) : new Response('missing', {status: 404}); }
      case 'books': return new Response(this.kv('books') || '[]');
      case 'fmeta': return new Response(this.kv('file:' + o.b) || '{}');
      case 'fchunk': { const r = all('SELECT data FROM fchunk WHERE b = ? AND i = ?', o.b, o.i)[0]; return new Response(r ? r.data : new ArrayBuffer(0)); }
      case 'kvget': return new Response(this.kv(o.k) || '[]');
      case 'kvset': if (o.v.length > 2e6) return J({err: 'too big'}); this.kv(o.k, o.v); return J({ok: true});
      case 'push': { const L = JSON.parse(this.kv(o.k) || '[]'); L.push(o.v); while (L.length > (o.cap || 60)) L.shift(); this.kv(o.k, JSON.stringify(L)); return J({ok: true}); } // atomic append (inboxes)
      case 'mset': { const O = JSON.parse(this.kv(o.k) || '{}'); O[o.f] = o.v; this.kv(o.k, JSON.stringify(O)); return J({ok: true}); } // atomic field set (chat index)
      case 'pull': { const ids = new Set(o.ids || []), L = JSON.parse(this.kv(o.k) || '[]').filter(x => !ids.has(x.id)); this.kv(o.k, JSON.stringify(L)); return J({ok: true}); }
      case 'qs': return new Response(this.kv('qs') || '[]');
      case 'page': { const r = all('SELECT n, bp, md FROM page WHERE b = ? AND n = ?', o.b, o.n)[0]; return J(r || {err: 'missing'}); }
      case 'pagebp': { const r = all('SELECT n, bp, md FROM page WHERE b = ? AND bp = ? ORDER BY n LIMIT 1', o.b, String(o.bp))[0]; return J(r || {err: 'missing'}); }
      case 'pages': return J({pages: all(`SELECT n, bp, md FROM page WHERE b = ? AND n IN (${o.ns.map(() => '?').join(',') || 'NULL'}) ORDER BY n`, o.b, ...o.ns.map(Number))});
      case 'find': { // keyword (tf-idf) page ranking for the tutor; page text is kept in memory per book
        this.idx = this.idx || {};
        let ix = this.idx[o.b];
        if (!ix) {
          const docs = all('SELECT n, md FROM page WHERE b = ?', o.b).map(r => ({n: r.n, w: (r.md.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])}));
          const df = {}; for (const d of docs) { d.tf = {}; for (const w of d.w) d.tf[w] = (d.tf[w] || 0) + 1; for (const w in d.tf) df[w] = (df[w] || 0) + 1; d.len = d.w.length || 1; delete d.w; }
          ix = this.idx[o.b] = {docs, df, N: docs.length};
        }
        const q = [...new Set(String(o.q || '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])];
        const sc = ix.docs.map(d => [q.reduce((s, w) => s + (d.tf[w] ? d.tf[w] / d.len * Math.log(ix.N / (1 + ix.df[w])) : 0), 0), d.n]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
        return J({ns: sc.slice(0, o.k || 5).map(x => x[1])});
      }
      case 'search': {
        const q = String(o.q || '').trim().toLowerCase().slice(0, 80); if (q.length < 2) return J({hits: []});
        const hits = all("SELECT b, n, bp, md FROM page WHERE instr(lower(md), ?) > 0 ORDER BY b, n LIMIT 60", q).map(r => {
          const i = r.md.toLowerCase().indexOf(q), s = r.md.slice(Math.max(0, i - 70), i + q.length + 90).replace(/\s+/g, ' ');
          return {b: r.b, n: r.n, bp: r.bp, s, k: (r.md.toLowerCase().split(q).length - 1)};
        });
        return J({hits});
      }
      case 'sync': { if (o.data) { const s = JSON.stringify(o.data); if (s.length > 2e6) return J({err: 'too big'}); this.kv(o.k || 'prog', s); return J({ok: true}); } return new Response(this.kv(o.k || 'prog') || '{}'); }
      case 'beat': { const d = new Date().toISOString().slice(0, 10), t = Date.now();
        this.sql.exec('INSERT INTO use (d, u, mins) VALUES (?, ?, 1) ON CONFLICT (d, u) DO UPDATE SET mins = mins + 1', d, o.u);
        this.sql.exec('INSERT INTO who (u, name, first, last, dev) VALUES (?, ?, ?, ?, ?) ON CONFLICT (u) DO UPDATE SET last = excluded.last, dev = excluded.dev, name = COALESCE(NULLIF(excluded.name, \'\'), name)', o.u, o.name || '', t, t, o.dev || '');
        return J({ok: true}); }
      case 'use': { const d = new Date().toISOString().slice(0, 10);
        this.sql.exec('INSERT INTO use (d, u, calls, tin, tout, tcr, tcw, cost) VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT (d, u) DO UPDATE SET calls = calls + 1, tin = tin + excluded.tin, tout = tout + excluded.tout, tcr = tcr + excluded.tcr, tcw = tcw + excluded.tcw, cost = cost + excluded.cost', d, o.u, o.tin, o.tout, o.tcr, o.tcw, o.cost);
        return J({ok: true}); }
      case 'stats': { const from = new Date(Date.now() - (o.days - 1) * 864e5).toISOString().slice(0, 10);
        return J({days: all('SELECT d, COUNT(CASE WHEN mins > 0 THEN 1 END) users, SUM(mins) mins, SUM(calls) calls, SUM(cost) cost, SUM(tin + tcr + tcw) tin, SUM(tout) tout FROM use WHERE d >= ? AND u != \'build\' GROUP BY d ORDER BY d', from),
          people: all('SELECT u.u, w.name, w.first, w.last, w.dev, COUNT(CASE WHEN u.mins > 0 THEN 1 END) days, SUM(u.mins) mins, SUM(u.calls) calls, SUM(u.tin + u.tcr + u.tcw) tin, SUM(u.tout) tout, SUM(u.cost) cost FROM use u LEFT JOIN who w ON w.u = u.u WHERE u.d >= ? GROUP BY u.u ORDER BY mins DESC, cost DESC', from)}); }
      case 'spend': { const d = new Date().toISOString().slice(0, 10), r = all('SELECT n FROM spend WHERE d = ?', d)[0], n = r ? r.n : 0;
        if (n >= o.cap) return J({over: true, n}); this.sql.exec('INSERT OR REPLACE INTO spend VALUES (?, ?)', d, n + 1); return J({n: n + 1}); }
    }
    return Response.json({err: 'bad op', op: o.op}, {status: 400});
  }
}

// Planner agent: Claude Sonnet with tools over the planner list (list/add/update/delete), looping server-side until it answers.
// Items: {id, kind: class|homework|exam|event|task, title, subject, date: YYYY-MM-DD, time?: HH:MM, end?: HH:MM, rep?: 'weekly', until?, done?, notes?}
const PLAN_TOOLS = [
  {name: 'list_items', description: 'List planner items whose date (or a weekly repeat) falls between from and to inclusive (YYYY-MM-DD). Also returns undone homework/tasks that are overdue. Use it before answering questions about specific dates beyond the snapshot.',
    input_schema: {type: 'object', properties: {from: {type: 'string'}, to: {type: 'string'}, query: {type: 'string', description: 'optional text filter on title/subject/notes'}}, required: ['from', 'to'], additionalProperties: false}},
  {name: 'add_item', description: 'Add one planner item. Use kind "homework" for things due (date = due date), "exam" for tests and exams, "class" for timetable lessons (usually rep weekly), "event" for anything else with a time, "task" for to-dos.',
    input_schema: {type: 'object', properties: {kind: {type: 'string', enum: ['class', 'homework', 'exam', 'event', 'task']}, title: {type: 'string'}, subject: {type: 'string'}, date: {type: 'string', description: 'YYYY-MM-DD'}, time: {type: 'string', description: 'HH:MM 24h, optional'}, end: {type: 'string', description: 'HH:MM 24h, optional'}, rep: {type: 'string', enum: ['none', 'weekly']}, until: {type: 'string', description: 'last date of a weekly repeat, optional'}, notes: {type: 'string'}}, required: ['kind', 'title', 'date'], additionalProperties: false}},
  {name: 'update_item', description: 'Change fields of an existing item by id (e.g. move the date, mark done: true, edit notes). Only the given fields change.',
    input_schema: {type: 'object', properties: {id: {type: 'string'}, changes: {type: 'object', description: 'fields to set: kind,title,subject,date,time,end,rep,until,notes,done'}}, required: ['id', 'changes'], additionalProperties: false}},
  {name: 'delete_item', description: 'Delete an item by id. Only when the student clearly asks to remove it.',
    input_schema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id'], additionalProperties: false}},
];
const dAdd = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function planOccurs(it, from, to) { // dates of an item inside [from, to]
  if (it.rep !== 'weekly') return it.date >= from && it.date <= to ? [it.date] : [];
  const out = []; let d = it.date; const end = it.until && it.until < to ? it.until : to;
  if (d < from) { const k = Math.floor((Date.parse(from) - Date.parse(d)) / 864e5 / 7); d = dAdd(d, 7 * k); if (d < from) d = dAdd(d, 7); }
  for (; d <= end && out.length < 60; d = dAdd(d, 7)) out.push(d);
  return out;
}
const planLine = (it, d) => `[${it.id}] ${d || it.date}${it.time ? ' ' + it.time + (it.end ? '-' + it.end : '') : ''} ${it.kind}${it.subject ? ' (' + it.subject + ')' : ''}: ${it.title}${it.rep === 'weekly' ? ' [weekly' + (it.until ? ' until ' + it.until : '') + ']' : ''}${it.done ? ' [done]' : ''}${it.notes ? ' - ' + it.notes : ''}`;
function planList(items, from, to, q, today) {
  q = (q || '').toLowerCase(); const rows = [];
  for (const it of items) { if (q && !(it.title + ' ' + (it.subject || '') + ' ' + (it.notes || '')).toLowerCase().includes(q)) continue;
    for (const d of planOccurs(it, from, to)) rows.push([d + (it.time || ''), planLine(it, d)]); }
  rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
  const over = items.filter(it => (it.kind === 'homework' || it.kind === 'task') && !it.done && it.date < today && (!q || it.title.toLowerCase().includes(q)));
  return (rows.map(r => r[1]).join('\n') || 'nothing in that range') + (over.length ? '\n\nOverdue and not done:\n' + over.map(it => planLine(it)).join('\n') : '');
}
// streamed tutor chat with tools: Claude only reads pages / the student's screen when it decides it needs to.
// Output to the browser is our own small SSE: data: {"t": text} | {"tool": name, "arg": ...} | {"err": msg} | {"done": 1}
const TUTOR_TOOLS = [
  {name: 'read_page', description: "Read one page of the student's textbook (Markdown). Use the printed page number (as in the contents and in the student's location note). Read only what you need; don't read pages just in case.",
    input_schema: {type: 'object', properties: {page: {type: 'string', description: 'printed page number, e.g. "143" or "xii"'}}, required: ['page']}},
  {name: 'search_book', description: "Find which pages of the student's textbook mention a word or phrase. Returns page numbers with short snippets.",
    input_schema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}},
  {name: 'read_screen', description: "See what the student has open right now beyond the one-line location note: the full practice question and their current draft answer, or the flashcard. Use when they refer to 'this question', 'my answer', etc.",
    input_schema: {type: 'object', properties: {}}}];
function tutorStream({b, sys, msgs, KEY, db, CORS, refs, who}) {
  const {readable, writable} = new TransformStream(), w = writable.getWriter(), enc = new TextEncoder();
  const send = o => w.write(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
  const run = async (name, a) => {
    if (name === 'read_page') { let r = await (await db('pagebp', {b: b.book, bp: String(a.page || '')})).json(); if (r.err && /^\d+$/.test(a.page)) r = await (await db('page', {b: b.book, n: +a.page})).json(); return r.err ? 'No page ' + a.page + ' in this book.' : `<page number="${r.bp}">\n${r.md}\n</page>`; }
    if (name === 'search_book') { const r = await (await db('search', {q: String(a.query || '')})).json(); const h = (r.hits || []).filter(x => x.b === b.book).sort((x, y) => y.k - x.k).slice(0, 10); return h.length ? h.map(x => `p. ${x.bp}: …${x.s}…`).join('\n') : 'No matches.'; }
    if (name === 'read_screen') return String(b.screen || 'Nothing open beyond the location note.').slice(0, 10000);
    return 'unknown tool';
  };
  (async () => {
    try {
      for (let step = 0; step < 5; step++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
          headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01'},
          body: JSON.stringify({model: 'claude-sonnet-5-5', max_tokens: 8000, fallbacks: 'default', cache_control: {type: 'ephemeral'}, system: sys, tools: TUTOR_TOOLS, messages: msgs, stream: true, output_config: {effort: 'low'}})});
        if (!r.ok) { const j = await r.json().catch(() => ({})); await send({err: (j.error && j.error.message) || 'Anthropic HTTP ' + r.status}); break; }
        const rd = r.body.getReader(), dec = new TextDecoder(), blocks = [], us = {}; let buf = '', stop = '';
        for (;;) { const {done, value} = await rd.read(); if (done) break; buf += dec.decode(value, {stream: true}); let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (ev.type === 'message_start') Object.assign(us, ev.message.usage || {});
            else if (ev.type === 'content_block_start') blocks[ev.index] = {...ev.content_block, _j: ''};
            else if (ev.type === 'content_block_delta') { const bl = blocks[ev.index], d = ev.delta;
              if (d.type === 'text_delta') { bl.text += d.text; await send({t: d.text}); }
              else if (d.type === 'input_json_delta') bl._j += d.partial_json;
              else if (d.type === 'thinking_delta') bl.thinking += d.thinking;
              else if (d.type === 'signature_delta') bl.signature = (bl.signature || '') + d.signature; }
            else if (ev.type === 'message_delta') { if (ev.usage) Object.assign(us, ev.usage); if (ev.delta.stop_reason) stop = ev.delta.stop_reason; }
            else if (ev.type === 'error') await send({err: ev.error.message}); } }
        await ibUse(db, who, 'claude-sonnet-5-5', us);
        const content = blocks.filter(Boolean).map(bl => { const {_j, ...c} = bl; if (c.type === 'tool_use') { try { c.input = _j ? JSON.parse(_j) : {}; } catch (e) { c.input = {}; } } if (c.type === 'text' && !c.text) return null; return c; }).filter(Boolean);
        if (stop !== 'tool_use') break;
        msgs.push({role: 'assistant', content}); const res = [];
        for (const c of content.filter(c => c.type === 'tool_use')) { await send({tool: c.name, arg: c.input.page || c.input.query || ''}); res.push({type: 'tool_result', tool_use_id: c.id, content: await run(c.name, c.input)}); }
        msgs.push({role: 'user', content: res});
      }
    } catch (e) { await send({err: String(e.message || e)}); }
    await send({done: 1, pages: refs}); await w.close();
  })();
  return new Response(readable, {headers: {...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-store'}});
}
async function planAgent(b, env, db, J, uk, who) {
  const KEY = await ibKey(env, db); if (!KEY) return J({err: 'no API key on the relay'}, 503);
  const cap = +(env.IB_CAP || 300), used = await (await db('spend', {cap})).json();
  if (used.over) return J({err: 'daily Claude limit reached'}, 429);
  let items = JSON.parse(await (await db('kvget', {k: 'plan:' + uk})).text() || '[]'); let changed = 0;
  const today = /^\d{4}-\d\d-\d\d$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const sys = `You are ${String(b.name || 'the student').slice(0, 30)}'s personal planner assistant inside their IB study app. You manage their calendar: classes, homework, exams, events and to-dos. Today is ${b.dow || ''} ${today}, local time ${String(b.now || '').slice(0, 5)} (${String(b.tz || '').slice(0, 40)}). Resolve relative dates ("next Friday", "in two weeks", "tomorrow arvo") against today yourself and use exact YYYY-MM-DD dates. When the student tells you about something, add it straight away with sensible defaults (kind, subject guessed from context) and confirm briefly with the date written as e.g. "Fri 5 Dec". Only ask a question when a date is truly ambiguous. When asked what's coming up, give a short, prioritised answer: due soonest first, flag clashes and heavy days, and suggest when to start bigger tasks. Be brief and friendly; no long preambles.`;
  const snap = () => 'Planner snapshot (next 21 days, plus overdue):\n' + planList(items, today, dAdd(today, 21), '', today);
  const msgs = (b.messages || []).slice(-20).map(m => ({role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000)}));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return J({err: 'empty message'}, 400);
  const last = msgs[msgs.length - 1]; last.content = snap() + '\n\n---\n' + last.content;
  let text = '';
  for (let step = 0; step < 8; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01'},
      body: JSON.stringify({model: 'claude-sonnet-5-5', max_tokens: 4000, fallbacks: 'default', output_config: {effort: 'low'}, cache_control: {type: 'ephemeral'},
        system: [{type: 'text', text: sys}], tools: PLAN_TOOLS, messages: msgs})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({err: (j.error && j.error.message) || 'Anthropic HTTP ' + r.status}, 502);
    await ibUse(db, who, 'claude-sonnet-5-5', j.usage);
    if (j.stop_reason === 'refusal') return J({err: 'Claude declined that one.'});
    msgs.push({role: 'assistant', content: j.content});
    text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const calls = (j.content || []).filter(c => c.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !calls.length) break;
    const res = [];
    for (const c of calls) {
      const a = c.input || {}; let out;
      try {
        if (c.name === 'list_items') out = planList(items, a.from, a.to, a.query, today);
        else if (c.name === 'add_item') {
          if (!/^\d{4}-\d\d-\d\d$/.test(a.date || '')) throw new Error('date must be YYYY-MM-DD');
          const it = {id: Math.random().toString(36).slice(2, 8), kind: a.kind, title: String(a.title).slice(0, 200), date: a.date};
          for (const k of ['subject', 'time', 'end', 'until', 'notes']) if (a[k]) it[k] = String(a[k]).slice(0, 1000);
          if (a.rep === 'weekly') it.rep = 'weekly';
          items.push(it); changed++; out = 'added ' + planLine(it);
        } else if (c.name === 'update_item') {
          const it = items.find(x => x.id === a.id); if (!it) throw new Error('no item with id ' + a.id);
          for (const [k, v] of Object.entries(a.changes || {})) if (['kind', 'title', 'subject', 'date', 'time', 'end', 'rep', 'until', 'notes', 'done'].includes(k)) { if (v === null || v === '' || v === 'none') delete it[k]; else it[k] = k === 'done' ? !!v : String(v).slice(0, 1000); }
          changed++; out = 'updated ' + planLine(it);
        } else if (c.name === 'delete_item') {
          const i = items.findIndex(x => x.id === a.id); if (i < 0) throw new Error('no item with id ' + a.id);
          out = 'deleted ' + planLine(items[i]); items.splice(i, 1); changed++;
        } else throw new Error('unknown tool');
        res.push({type: 'tool_result', tool_use_id: c.id, content: out});
      } catch (e) { res.push({type: 'tool_result', tool_use_id: c.id, content: String(e.message), is_error: true}); }
    }
    msgs.push({role: 'user', content: res});
  }
  if (changed) await db('kvset', {k: 'plan:' + uk, v: JSON.stringify(items)});
  return J({text: text || 'Done.', changed, items});
}
function toIcs(items) {
  const esc = s => String(s || '').replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const dt = (d, t) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IB Study//Planner//EN', 'X-WR-CALNAME:IB Planner', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  for (const it of items) {
    if (!/^\d{4}-\d\d-\d\d$/.test(it.date || '')) continue;
    const pre = {homework: 'Due: ', exam: 'Exam: ', task: 'To do: '}[it.kind] || '';
    L.push('BEGIN:VEVENT', 'UID:' + it.id + '@ibstudy', 'DTSTAMP:' + stamp, 'SUMMARY:' + esc((it.done ? '✓ ' : '') + pre + it.title + (it.subject ? ' (' + it.subject + ')' : '')));
    if (it.time) { L.push('DTSTART:' + dt(it.date, it.time)); L.push('DTEND:' + dt(it.date, it.end || (String(Math.min(23, +it.time.slice(0, 2) + 1)).padStart(2, '0') + it.time.slice(2)))); }
    else { L.push('DTSTART;VALUE=DATE:' + dt(it.date)); L.push('DTEND;VALUE=DATE:' + dt(dAdd(it.date, 1))); }
    if (it.rep === 'weekly') L.push('RRULE:FREQ=WEEKLY' + (it.until ? ';UNTIL=' + dt(it.until) + (it.time ? 'T235959' : '') : ''));
    if (it.notes) L.push('DESCRIPTION:' + esc(it.notes));
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

function statsPage(d, days, k) {
  const e = x => String(x ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const tot = d.days.reduce((a, x) => ({mins: a.mins + x.mins, calls: a.calls + x.calls, cost: a.cost + x.cost}), {mins: 0, calls: 0, cost: 0});
  const ppl = d.people.filter(p => p.u !== 'build'), build = d.people.find(p => p.u === 'build'), mx = Math.max(1, ...d.days.map(x => x.mins));
  const h = m => m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm', $ = c => '$' + (c || 0).toFixed(c < 1 ? 3 : 2), ago = t => { const s = (Date.now() - t) / 1000; return s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>IB Study usage</title><style>
  body{font:15px/1.5 system-ui,sans-serif;background:#f3f0e8;color:#1c2230;margin:0;padding:24px 16px}main{max-width:980px;margin:0 auto}h1{font:600 26px Georgia,serif;margin:0 0 4px}
  .k{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:18px 0}.k div{background:#fbfaf6;border:1px solid #ddd7c9;border-radius:10px;padding:12px 14px}.k b{display:block;font:600 24px Georgia,serif}
  .m{color:#646b78;font-size:13px}table{width:100%;border-collapse:collapse;background:#fbfaf6;border:1px solid #ddd7c9;border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums}td,th{padding:8px 10px;border-bottom:1px solid #ddd7c9;text-align:left;font-size:14px}th{font-size:12px;color:#646b78}
  .bars{display:flex;gap:3px;align-items:flex-end;height:120px;background:#fbfaf6;border:1px solid #ddd7c9;border-radius:10px;padding:12px}.bars i{flex:1;background:#24408e;border-radius:3px 3px 0 0;min-height:2px}
  @media(prefers-color-scheme:dark){body{background:#15171c;color:#ebe7dd}.k div,table,.bars{background:#1c1f26;border-color:#2c3039}td,th{border-color:#2c3039}.bars i{background:#9db1ff}}</style><main>
  <h1>IB Study usage</h1><div class=m>Last ${e(days)} days · show ${[1, 7, 30, 90, 365].map(n => `<a href="?k=${e(k)}&days=${n}">${n}</a>`).join(' · ')} days</div>
  <div class=k><div><b>${ppl.length}</b><span class=m>people</span></div><div><b>${h(tot.mins)}</b><span class=m>time on site</span></div><div><b>${tot.calls}</b><span class=m>Claude calls</span></div><div><b>${$(tot.cost)}</b><span class=m>Claude cost (students)</span></div>${build ? `<div><b>${$(build.cost)}</b><span class=m>book imports</span></div>` : ''}</div>
  <h3>Minutes per day</h3><div class=bars>${d.days.map(x => `<i style="height:${Math.round(x.mins / mx * 100)}%" title="${e(x.d)}: ${x.users} people, ${h(x.mins)}, ${x.calls} Claude calls, ${$(x.cost)}"></i>`).join('')}</div>
  <h3>People</h3><table><tr><th>Who</th><th>Days</th><th>Time</th><th>Claude calls</th><th>Tokens in / out</th><th>Cost</th><th>Last seen</th></tr>
  ${ppl.map(p => `<tr><td>${p.u.startsWith('u:') ? '<b>' + e(p.name || p.u.slice(2)) + '</b>' : 'Guest <span class=m>' + e(p.u.slice(2, 8)) + '</span>'}<div class=m>${e(p.dev || '')}</div></td><td>${p.days}</td><td>${h(p.mins || 0)}</td><td>${p.calls || 0}</td><td>${Math.round((p.tin || 0) / 1000)}k / ${Math.round((p.tout || 0) / 1000)}k</td><td>${$(p.cost)}</td><td>${p.last ? ago(p.last) : ''}</td></tr>`).join('') || '<tr><td colspan=7 class=m>No visits yet</td></tr>'}</table>
  <p class=m>Time counts minutes with the page open and in use. Costs are estimates from token counts (Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million tokens in/out).</p></main>`;
}
