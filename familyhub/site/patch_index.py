# Patches the worker's index.js: new files and routes, review-mode toggle on the review site, {{ORIGIN}} fill-in, waitlist cron.
import sys, os, json
D = sys.argv[1]; f = os.path.join(D, 'index.js'); s = open(f).read()
if 'site-next.js.txt' in s: print('already'); sys.exit()
def rep(a, b):
    global s
    assert a in s, a[:70]; s = s.replace(a, b, 1)
prof = json.load(open(os.path.join(D, 'site-profiles.json')))
imp = ['import fnext from "./site-next.js.txt";', 'import fsm from "./site-sitemap.xml.txt";', 'import frob from "./site-robots.txt";',
       'import fwl from "./site-waitlist.html";', 'import fico from "./site-favicon.ico";', 'import fati from "./site-apple-touch-icon.png";', 'import fog from "./site-og.jpg";']
imp += ['import fpf%d from "./pf-%s.html";' % (i, p) for i, p in enumerate(prof)]
rep('import { hxApi } from "./hx.js";', 'import { hxApi, hxWaitTick } from "./hx.js";\n' + '\n'.join(imp))
ent = ['  "/next.js": [fnext, "text/javascript; charset=utf-8", \'"nx1"\'],', '  "/sitemap.xml": [fsm, "application/xml; charset=utf-8", \'"sm1"\'],',
       '  "/robots.txt": [frob, "text/plain; charset=utf-8", \'"rb1"\'],', '  "/waitlist.html": [fwl, "text/html; charset=utf-8", \'"wl1"\'],',
       '  "/favicon.ico": [fico, "image/x-icon", \'"fv1"\'],', '  "/apple-touch-icon.png": [fati, "image/png", \'"at1"\'],', '  "/og.jpg": [fog, "image/jpeg", \'"og1"\'],']
ent += ['  "/team/%s.html": [fpf%d, "text/html; charset=utf-8", \'"pf1"\'],' % (p, i) for i, p in enumerate(prof)]
rep('var FILES = {\n', 'var FILES = {\n' + '\n'.join(ent) + '\n')
rep('async scheduled(event, env, ctx) { if (env.PUBLIC_SITE !== "1") ctx.waitUntil(briefAuto(env)); },',
    'async scheduled(event, env, ctx) { if (env.PUBLIC_SITE !== "1") ctx.waitUntil(briefAuto(env)); ctx.waitUntil(hxWaitTick(env).catch(e => console.log("wl tick", e && e.message))); },')
# review toggle: the review site (no PUBLIC_SITE) now looks public unless ?review=1 (cookie) was used
rep('    const pub = env.PUBLIC_SITE === "1";\n    if (pub && (p === "/book.html"',
    '''    const u1 = new URL(request.url), rq = u1.searchParams.get("review"), ck = request.headers.get("cookie") || "";
    const review = env.PUBLIC_SITE !== "1" && rq !== "0" && (rq === "1" || /(^|;\\s*)scfh_review=1/.test(ck));
    const setCk = rq === "1" ? "scfh_review=1; Path=/; Max-Age=31536000; Secure; SameSite=Lax" : rq === "0" ? "scfh_review=; Path=/; Max-Age=0; Secure; SameSite=Lax" : null;
    const pub = !review;
    if (pub && (p === "/book.html"''')
rep('    if (hit[1].startsWith("text/html")) {\n      headers["cache-control"] = "no-store"; delete headers["etag"];\n      return new Response(request.method === "HEAD" ? null : pub ? publicHtml(hit[0]) : hit[0], { status, headers });\n    }',
    '''    if (setCk) headers["set-cookie"] = setCk;
    if (hit[1].startsWith("text/html")) {
      headers["cache-control"] = "no-store"; delete headers["etag"];
      const body = (pub ? publicHtml(hit[0]) : hit[0]).replaceAll("{{ORIGIN}}", u1.origin);
      return new Response(request.method === "HEAD" ? null : body, { status, headers });
    }
    if (p === "/sitemap.xml" || p === "/robots.txt") return new Response(request.method === "HEAD" ? null : hit[0].replaceAll("{{ORIGIN}}", u1.origin), { status, headers: { ...headers, "cache-control": "public, max-age=3600" } });''')
open(f, 'w').write(s); print('index ok')
