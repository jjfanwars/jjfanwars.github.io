// Booking through the Halaxy API, behind our own booking screens (/book-online).
//   GET  /api/hx/times?pid=adi&svc=psych&from=2027-02-01&days=14  -> { live, len, times: [ISO...] }
//   POST /api/hx/book  { pid, svc, mode, pay, start, first, last, dob, phone, email, seen } -> { ok, start } | { ok:false, error }
// Live once these Cloudflare secrets exist (Adi buys the Halaxy API add-on and creates a key):
//   HALAXY_CLIENT_ID, HALAXY_CLIENT_SECRET
//   HX_MAP  JSON: { "roles": { "adi": "PR-123", ... },
//                   "services": { "adi:psych:medicare": "33", "laura:massage60": "41", ... },   // HealthcareService ids
//                   "locations": { "clinic": "clinic", "video": "online", "phone": "phone" } }    // Halaxy location-type codes
// Until then everything runs on demo times and nothing is sent anywhere.

const API = "https://au-api.halaxy.com/main/";
const TZ = "Australia/Melbourne";

// Service length in minutes, per practitioner and service id (same ids as the page).
const LEN = {
  psych: 50, parenthood: 50, parenthood90: 90, eating: 50,
  counsel: 50, couples: 60, massage30: 30, massage60: 60, acufirst: 60, acufollow: 50
};
// first service per practitioner (used for "next free time")
const FIRST = { adi: "psych", hannah: "psych", melinda: "psych", ellie: "psych", maddy: "psych", "michelle-ferris": "counsel", laura: "massage60", kate: "acufollow" };
const NAMES = { adi: "Adi", hannah: "Hannah", melinda: "Melinda", ellie: "Ellie", maddy: "Maddy", "michelle-ferris": "Michelle", laura: "Laura", kate: "Kate" };
const PIDS = ["adi", "hannah", "melinda", "ellie", "maddy", "michelle-ferris", "laura", "kate"];

function json(o, status = 200, extra = {}) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra } });
}
function live(env) { return !!(env.HALAXY_CLIENT_ID && env.HALAXY_CLIENT_SECRET && env.HX_MAP); }
function map(env) { try { return JSON.parse(env.HX_MAP || "{}"); } catch (e) { return {}; } }

// Melbourne UTC offset (+10:00 or +11:00) for a given date
function offset(d) {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(d).find(x => x.type === "timeZoneName");
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(p ? p.value : "");
  return m ? m[1] + ":" + (m[2] || "00") : "+10:00";
}
function localDate(ymd, hh = "00:00:00") { const t = new Date(ymd + "T12:00:00Z"); return ymd + "T" + hh + offset(t); }
function addDays(ymd, n) { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function todayMel() { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); }

let tok = null;
async function token(env) {
  if (tok && tok.exp > Date.now() + 30e3) return tok.v;
  const r = await fetch(API + "oauth/token", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/fhir+json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.HALAXY_CLIENT_ID, client_secret: env.HALAXY_CLIENT_SECRET })
  });
  if (!r.ok) throw new Error("halaxy auth " + r.status);
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + 14 * 60e3 }; // tokens last 15 minutes
  return tok.v;
}
async function hx(env, path, opt = {}) {
  const r = await fetch(API + path, { ...opt, headers: { accept: "application/fhir+json", "content-type": "application/json", authorization: "Bearer " + await token(env), ...(opt.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

// Demo availability: a believable week pattern, some times already taken
function demoTimes(pid, len, from, days) {
  const H = { 1: [9, 10, 11, 13, 14, 15], 2: [9, 10, 11, 13, 14], 3: [9, 10, 11, 13, 14, 15], 4: [10, 11, 13, 14, 15, 16], 5: [9, 10, 11] };
  const seed = [...pid].reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [], now = Date.now() + 20 * 36e5;
  for (let i = 0; i < days; i++) {
    const ymd = addDays(from, i), dow = new Date(ymd + "T12:00:00Z").getUTCDay();
    (H[dow] || []).forEach((h, k) => {
      if ((seed + i * 7 + k * 3 + dow) % 5 < 3) return; // booked
      const iso = new Date(localDate(ymd, String(h).padStart(2, "0") + ":00:00")).toISOString();
      if (Date.parse(iso) > now) out.push(iso);
    });
  }
  return out;
}

async function liveTimes(env, pid, len, from, days) {
  const role = (map(env).roles || {})[pid];
  if (!role) return [];
  const q = "Appointment/$find?start=" + encodeURIComponent(localDate(from)) + "&end=" + encodeURIComponent(localDate(addDays(from, days - 1), "23:59:59")) +
    "&duration=" + len + "&practitioner-role=" + encodeURIComponent(role);
  const r = await hx(env, q);
  if (!r.ok) throw new Error("halaxy find " + r.status);
  return (r.body.entry || []).map(e => e.resource && e.resource.start).filter(Boolean).map(s => new Date(s).toISOString());
}

function clean(s, n = 80) { return String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n); }
function auPhone(p) { p = String(p || "").replace(/[^\d+]/g, ""); if (p.startsWith("0")) p = "+61" + p.slice(1); return /^\+61\d{9}$/.test(p) ? p : ""; }

async function findOrCreatePatient(env, d) {
  const q = "Patient?email=" + encodeURIComponent(d.email) + "&birthdate=" + d.dob;
  const f = await hx(env, q);
  const hit = f.ok && (f.body.entry || []).find(e => e.resource && e.resource.id);
  if (hit) return hit.resource.id;
  const c = await hx(env, "Patient", { method: "POST", body: JSON.stringify({
    resourceType: "Patient",
    name: [{ use: "official", family: d.last, given: [d.first] }],
    telecom: [{ system: "email", value: d.email, use: "home" }, { system: "sms", value: d.phone, use: "mobile" }],
    birthDate: d.dob
  }) });
  if (!c.ok || !c.body.id) throw new Error("halaxy patient " + c.status);
  return c.body.id;
}

async function liveBook(env, d, len) {
  const m = map(env), role = (m.roles || {})[d.pid];
  const svcKey = d.pid + ":" + d.svc + (d.pay ? ":" + d.pay : "");
  const svc = (m.services || {})[svcKey] || (m.services || {})[d.pid + ":" + d.svc];
  const loc = (m.locations || {})[d.mode] || (d.mode === "clinic" ? "clinic" : d.mode);
  if (!role || !svc) return { ok: false, error: "setup" };
  const pidRef = await findOrCreatePatient(env, d);
  const start = new Date(d.start), end = new Date(start.getTime() + len * 60e3);
  const r = await hx(env, "Appointment/$book", { method: "POST", body: JSON.stringify({ resourceType: "Parameters", parameter: [
    { name: "appt-resource", resource: { resourceType: "Appointment", start: start.toISOString(), end: end.toISOString(), minutesDuration: len,
      participant: [{ actor: { reference: API + "PractitionerRole/" + role, type: "PractitionerRole" } }] } },
    { name: "patient-id", valueReference: { reference: API + "Patient/" + pidRef, type: "Patient" } },
    { name: "healthcare-service-id", valueReference: { reference: API + "HealthcareService/" + svc, type: "HealthcareService" } },
    { name: "location-type", valueCode: loc },
    { name: "status", valueCode: "booked" },
    { name: "fail-on-double-booking", valueBoolean: true }
  ] }) });
  if (r.status === 409 || r.status === 422) return { ok: false, error: "taken" };
  if (!r.ok) throw new Error("halaxy book " + r.status);
  return { ok: true, start: start.toISOString(), id: r.body.id };
}

export async function hxApi(request, env, url) {
  if (!url.pathname.startsWith("/api/hx/")) return null;
  const isLive = live(env);
  try {
    if (url.pathname === "/api/hx/times" && request.method === "GET") {
      const pid = url.searchParams.get("pid"), svc = url.searchParams.get("svc");
      if (!PIDS.includes(pid) || !LEN[svc]) return json({ error: "bad request" }, 400);
      const days = Math.min(28, Math.max(1, +url.searchParams.get("days") || 14));
      let from = url.searchParams.get("from") || todayMel();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < todayMel()) from = todayMel();
      const len = LEN[svc];
      // short edge cache so a busy page doesn't hit Halaxy on every visit
      const cache = caches.default, key = new Request(url.origin + "/api/hx/times?" + [pid, svc, from, days, isLive ? 1 : 0].join("|"));
      const hit = await cache.match(key);
      if (hit) return hit;
      const times = isLive ? await liveTimes(env, pid, len, from, days) : demoTimes(pid, len, from, days);
      const res = json({ live: isLive, len, from, days, times }, 200, { "cache-control": "no-store" });
      const store = new Response(res.clone().body, res); store.headers.set("cache-control", "public, max-age=90");
      await cache.put(key, store);
      return res;
    }
    if (url.pathname === "/api/hx/book" && request.method === "POST") {
      const b = await request.json().catch(() => null);
      if (!b || b.website) return json({ ok: false, error: "bad request" }, 400); // honeypot
      const d = {
        pid: b.pid, svc: b.svc, mode: ["clinic", "video", "phone"].includes(b.mode) ? b.mode : "clinic", pay: ["medicare", "private"].includes(b.pay) ? b.pay : "",
        start: b.start, first: clean(b.first, 40), last: clean(b.last, 40), dob: clean(b.dob, 10), phone: auPhone(b.phone), email: clean(b.email, 120).toLowerCase()
      };
      if (!PIDS.includes(d.pid) || !LEN[d.svc] || !d.first || !d.last || !/^\d{4}-\d{2}-\d{2}$/.test(d.dob) || !d.phone || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || isNaN(Date.parse(d.start)) || Date.parse(d.start) < Date.now())
        return json({ ok: false, error: "check" }, 400);
      if (!isLive) return json({ ok: true, demo: true, start: new Date(d.start).toISOString() });
      const r = await liveBook(env, d, LEN[d.svc]);
      return json(r, r.ok ? 200 : r.error === "taken" ? 409 : 500);
    }
    if (url.pathname === "/api/hx/next" && request.method === "GET") {
      // soonest free time per practitioner, for team cards and profile pages
      const demo = url.searchParams.get("demo") === "1";
      const pids = (url.searchParams.get("pids") || "").split(",").filter(p => PIDS.includes(p)).slice(0, 12);
      if (!isLive && !demo) return json({ live: false, next: {} }, 200, { "cache-control": "public, max-age=300" });
      const cache = caches.default, key = new Request(url.origin + "/api/hx/next?" + pids.join(",") + "|" + (isLive ? 1 : 0));
      const hit = await cache.match(key);
      if (hit) return hit;
      const next = {}, from = todayMel();
      await Promise.all(pids.map(async pid => {
        const len = LEN[FIRST[pid]] || 50;
        let t = [];
        for (let k = 0; k < 3 && !t.length; k++) t = isLive ? await liveTimes(env, pid, len, addDays(from, k * 28), 28) : demoTimes(pid, len, addDays(from, k * 28), 28);
        next[pid] = t.length ? t.sort()[0] : null;
      }));
      const res = json({ live: isLive, next }, 200, { "cache-control": "public, max-age=300" });
      await cache.put(key, res.clone());
      return res;
    }
    if (url.pathname.startsWith("/api/hx/waitlist")) return await waitlistApi(request, env, url);
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.log("hx error", e && e.message);
    return json({ ok: false, error: "halaxy" }, 502);
  }
}


// ---------- Waitlist ----------
// Stored in the TEXT KV as wl:<id> (90 days). Keeps only what's needed to offer a time: name, mobile, email,
// who, days and am/pm. No health details.
// Live (Halaxy keys set): hxWaitTick runs from the cron, finds free times that match, and texts an offer
// (ClickSend, secrets CLICKSEND_USER + CLICKSEND_KEY; sender SMS_FROM). First to book gets it: booking goes
// through /api/hx/book with Halaxy's fail-on-double-booking. Without an SMS provider, matches show on /waitlist for staff.
const WL_DAYS = 90;
function rid(n = 12) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => (x % 36).toString(36)).join(""); }
function staff(request, env) { const k = request.headers.get("x-admin-key") || ""; return !!env.ADMIN_KEY && k.length > 0 && k === env.ADMIN_KEY; }
async function perIp(env, request, tag, max) {
  if (!env.TEXT) return true;
  const k = tag + ":" + todayMel() + ":" + (request.headers.get("cf-connecting-ip") || "x"), n = Number(await env.TEXT.get(k)) || 0;
  if (n >= max) return false;
  await env.TEXT.put(k, String(n + 1), { expirationTtl: 172800 });
  return true;
}
async function wlAll(env) {
  const out = []; let cursor;
  do {
    const l = await env.TEXT.list({ prefix: "wl:", cursor });
    for (const k of l.keys) { const v = await env.TEXT.get(k.name, "json"); if (v) out.push(v); }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor && out.length < 1000);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
async function wlPut(env, w) { await env.TEXT.put("wl:" + w.id, JSON.stringify(w), { expirationTtl: Math.max(60, Math.round((Date.parse(w.until) - Date.now()) / 1000)) }); }
function page(title, msg) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:32em;margin:12vh auto;padding:0 20px;color:#3A2F28;background:#FBF6EE"><h1 style="font-size:1.4em">${title}</h1><p>${msg}</p><p><a href="/" style="color:#23605A">Surf Coast Family Hub</a></p>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
async function waitlistApi(request, env, url) {
  if (!env.TEXT) return json({ ok: false, error: "setup" }, 503);
  const m = request.method;
  if (url.pathname === "/api/hx/waitlist/leave" && m === "GET") {
    const id = clean(url.searchParams.get("id"), 20), t = clean(url.searchParams.get("t"), 20);
    const w = id && await env.TEXT.get("wl:" + id, "json");
    if (w && w.tok === t) await env.TEXT.delete("wl:" + id);
    return page("You’re off the waitlist", w && w.tok === t ? "We won’t text you about earlier times any more. To book, call us on <a href=\"tel:0491184788\">0491 184 788</a>." : "This link has already been used or has expired.");
  }
  if (url.pathname !== "/api/hx/waitlist") return json({ error: "not found" }, 404);
  if (m === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || b.website) return json({ ok: false, error: "bad request" }, 400);
    const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter(d => d >= 1 && d <= 5);
    const w = {
      id: rid(10), tok: rid(12), at: new Date().toISOString(), until: new Date(Date.now() + WL_DAYS * 864e5).toISOString(),
      pid: b.pid, svc: LEN[b.svc] ? b.svc : FIRST[b.pid], first: clean(b.first, 40), last: clean(b.last, 40),
      phone: auPhone(b.phone), email: clean(b.email, 120).toLowerCase(),
      days: days.length ? [...new Set(days)].sort() : [1, 2, 3, 4, 5], ampm: ["am", "pm"].includes(b.ampm) ? b.ampm : "any",
      mode: ["clinic", "video", "phone"].includes(b.mode) ? b.mode : "clinic", sent: [], src: url.hostname
    };
    if (!PIDS.includes(w.pid) || !w.first || !w.phone || (w.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email)) || !b.consent) return json({ ok: false, error: "check" }, 400);
    if (!await perIp(env, request, "hxwl", 8)) return json({ ok: false, error: "limit" }, 429);
    await wlPut(env, w);
    return json({ ok: true, live: live(env), sms: sms(env) });
  }
  if (!staff(request, env)) return json({ error: "staff only" }, 401);
  if (m === "GET") {
    const all = await wlAll(env);
    return json({ live: live(env), sms: sms(env), list: all.map(w => ({ ...w, tok: undefined })) });
  }
  if (m === "DELETE") { const id = clean(url.searchParams.get("id"), 20); if (id) await env.TEXT.delete("wl:" + id); return json({ ok: true }); }
  return json({ error: "method" }, 405);
}
function sms(env) { return !!(env.CLICKSEND_USER && env.CLICKSEND_KEY); }
async function sendSms(env, to, body) {
  const r = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Basic " + btoa(env.CLICKSEND_USER + ":" + env.CLICKSEND_KEY) },
    body: JSON.stringify({ messages: [{ source: "hub", to, body, from: env.SMS_FROM || undefined }] })
  });
  return r.ok;
}
function fits(w, iso) {
  const d = new Date(iso), parts = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find(p => p.type === "weekday").value), h = +parts.find(p => p.type === "hour").value;
  return w.days.includes(wd) && (w.ampm === "any" || (w.ampm === "am" ? h < 12 : h >= 12));
}
// Called from the worker's cron. Runs at most every 15 minutes; does nothing until Halaxy is live.
export async function hxWaitTick(env, origin = "https://surfcoast.aiautomationvic.com") {
  if (!env.TEXT || !live(env)) return;
  const last = Number(await env.TEXT.get("hxwl:tick")) || 0;
  if (Date.now() - last < 15 * 60e3) return;
  await env.TEXT.put("hxwl:tick", String(Date.now()), { expirationTtl: 86400 });
  const all = await wlAll(env), byPid = {};
  all.forEach(w => (byPid[w.pid + "|" + w.svc] = byPid[w.pid + "|" + w.svc] || []).push(w));
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  for (const key of Object.keys(byPid)) {
    const [pid, svc] = key.split("|");
    let times = [];
    try { times = await liveTimes(env, pid, LEN[svc] || 50, todayMel(), 21); } catch (e) { continue; }
    times = times.filter(t => Date.parse(t) > Date.now() + 18 * 36e5);
    // oldest sign-ups first; each free time goes to one person per round, nobody gets more than one text a day
    for (const w of byPid[key]) {
      if (w.lastSent && Date.now() - Date.parse(w.lastSent) < 864e5) continue;
      const t = times.find(t => fits(w, t) && !w.sent.includes(t));
      if (!t) continue;
      times = times.filter(x => x !== t);
      w.match = t;
      if (sms(env)) {
        const link = origin + "/book-online#" + pid + "&t=" + encodeURIComponent(t);
        const ok = await sendSms(env, w.phone, `Surf Coast Family Hub: a time with ${NAMES[pid]} just opened, ${fmt.format(new Date(t))}. First to book gets it: ${link} Not interested? ${origin}/api/hx/waitlist/leave?id=${w.id}&t=${w.tok}`);
        if (ok) { w.sent.push(t); w.lastSent = new Date().toISOString(); }
      }
      await wlPut(env, w);
    }
  }
}
