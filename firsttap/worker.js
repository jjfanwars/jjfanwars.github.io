// Firsttap marketing site: serves the page and takes "join early access" enquiries.
// Bindings (set in Cloudflare at deploy, never committed):
//   LEADS      KV namespace for enquiries and the per-IP limit
//   LEAD_MAIL  send_email binding (its destination address is configured in Cloudflare)
//   LEAD_FROM  plain text, sender address on a domain with Email Routing
//   LEAD_TO    plain text, the destination address (must match LEAD_MAIL's)
import { EmailMessage } from "cloudflare:email";
import page from "./index.html";

const SEC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC } });
const clean = (v, n) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\S ]+/g, " ").trim().slice(0, n);

async function lead(req, env) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return json({ error: "Not allowed" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 20000) return json({ error: "Too large" }, 413);
  let d;
  try { d = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (!d || typeof d !== "object") return json({ error: "Bad request" }, 400);
  if (d.website) return json({ ok: true }); // honeypot: pretend it worked
  const L = {
    name: clean(d.name, 120), clinic: clean(d.clinic, 160), email: clean(d.email, 200), phone: clean(d.phone, 40),
    pms: clean(d.pms, 40), size: clean(d.size, 20), note: String(d.note ?? "").replace(/\r/g, "").trim().slice(0, 2000),
  };
  if (!L.name || !L.clinic || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(L.email)) return json({ error: "Please add your name, clinic and a work email." }, 400);

  const ip = req.headers.get("cf-connecting-ip") || "x";
  const hour = new Date().toISOString().slice(0, 13);
  const rk = `rl:${ip}:${hour}`;
  if (env.LEADS) {
    const n = Number((await env.LEADS.get(rk)) || 0);
    if (n >= 5) return json({ error: "Too many requests. Please try again later." }, 429);
    await env.LEADS.put(rk, String(n + 1), { expirationTtl: 3700 });
    await env.LEADS.put(`lead:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ ...L, at: new Date().toISOString() }));
  }

  if (env.LEAD_MAIL && env.LEAD_FROM && env.LEAD_TO) {
    const body = [
      `New early-access request from the Firsttap site.`, ``,
      `Name: ${L.name}`, `Clinic: ${L.clinic}`, `Email: ${L.email}`, `Phone: ${L.phone || "-"}`,
      `Practice software: ${L.pms || "-"}`, `Practitioners: ${L.size || "-"}`, ``, `Note:`, L.note || "-",
    ].join("\r\n");
    const raw = [
      `From: Firsttap <${env.LEAD_FROM}>`, `To: <${env.LEAD_TO}>`, `Reply-To: <${L.email}>`,
      `Subject: Firsttap lead: ${L.clinic}`, `Message-ID: <${crypto.randomUUID()}@${env.LEAD_FROM.split("@")[1]}>`,
      `Date: ${new Date().toUTCString()}`, `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, ``, body,
    ].join("\r\n");
    try { await env.LEAD_MAIL.send(new EmailMessage(env.LEAD_FROM, env.LEAD_TO, raw)); }
    catch (e) { console.error("lead email failed", e && e.message); }
  }
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/lead") return lead(req, env);
    if (url.pathname === "/" || url.pathname === "/index.html")
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", ...SEC } });
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    return Response.redirect(new URL("/", url).toString(), 302);
  },
};
