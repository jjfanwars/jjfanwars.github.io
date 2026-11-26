# Upload a patched module folder to the Family Hub workers (review + public), keeping secrets.
#   python3 deploy.py <mods dir> [review|public|both]
# Goes through the Cloudflare API (the session proxy adds the auth).
import sys, os, json, uuid, urllib.request
D = sys.argv[1]; which = sys.argv[2] if len(sys.argv) > 2 else 'both'
A = '97a2687d528ea8254d059634d63f9f76'
KV = {'type': 'kv_namespace', 'name': 'TEXT', 'namespace_id': '4b92f17c2fdc44ad97f5daa2c1369f4d'}
WORKERS = {
    'review': ('surfcoast-family-hub', [KV, {'type': 'send_email', 'name': 'BRIEF_MAIL', 'destination_address': os.environ.get('BRIEF_DEST', '')}]),
    'public': ('surfcoast-family-hub-public', [KV, {'type': 'plain_text', 'name': 'PUBLIC_SITE', 'text': '1'}]),
}
SKIP = {'wrangler.toml', 'site-profiles.json', '.wrangler'}
def ctype(n):
    if n.endswith('.js'): return 'application/javascript+module'
    if n.endswith(('.html', '.txt')): return 'text/plain'
    return 'application/octet-stream'
def upload(name, bindings):
    b = uuid.uuid4().hex
    meta = {'main_module': 'index.js', 'compatibility_date': '2025-09-01', 'bindings': bindings, 'keep_bindings': ['secret_text']}
    parts = [('metadata', 'blob', 'application/json', json.dumps(meta).encode())]
    for n in sorted(os.listdir(D)):
        if n in SKIP or os.path.isdir(os.path.join(D, n)): continue
        parts.append((n, n, ctype(n), open(os.path.join(D, n), 'rb').read()))
    body = b''
    for field, fn, ct, data in parts:
        body += ('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: %s\r\n\r\n' % (b, field, fn, ct)).encode() + data + b'\r\n'
    body += ('--%s--\r\n' % b).encode()
    req = urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s' % (A, name), data=body, method='PUT',
                                 headers={'content-type': 'multipart/form-data; boundary=' + b, 'authorization': 'Bearer proxy'})
    try:
        r = json.load(urllib.request.urlopen(req)); print(name, r['success'], r.get('errors'))
    except urllib.error.HTTPError as e:
        print(name, e.code, e.read()[:800])
for k in (['review', 'public'] if which == 'both' else [which]):
    upload(*WORKERS[k])
