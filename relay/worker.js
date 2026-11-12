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
