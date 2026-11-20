"""Build the Hamptons Cabinetry mockup site.

src/*.dc.html (canvas artboards) -> build/public/N.html, plus pages/index.html and assets/.
Then writes build/worker.js, a Worker that serves every file from memory.
Deploy: python3 build.py && npx wrangler@3 deploy   (run in this folder)
"""
import os, re, shutil
H = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(H, 'build'); P = os.path.join(B, 'public')
BLOBS = {
 '252fdc5f628c5b6a130a7a2dc055045d': 'bath.jpg', '84bb58462b9cc9f06814d60352002a7a': 'kitchen.jpg',
 'd24fcfea0de4f8d67a3b5daba0e4d7c1': 'kitchen2.jpg', 'f8b87b67a3ed7fdedcd4bddc898c8d0a': 'kitchen3.jpg',
 'bb21085872f73e6d5992e5c69b910641': 'bar.jpg', '356361c0e42a60f9715e7bc83be484e4': 'living.jpg',
 '515d984e5e2017e1545b64b06cff2195': 'mark-cream.png', '3239dc497015354f056b546e10de0cc4': 'mark-brown.png',
 '9f96f54c3316afb82cd44fcae26bb813': 'badge.png', '984421fab476bdf77cded2370f8e07f8': 'sw-white.jpg',
 '2717ee4b42d5ef457ed2b2c07a18867b': 'sw-stone.jpg', '7357f2e8f64524de67e2f07062cd4c2e': 'sw-reeded.jpg',
 '673cd4f61cfc1b644d1cedf391e95ddc': 'sw-timber.jpg', '8424bd846e03b6705eacfb4f3bf751ac': 'sw-marble.jpg',
}
PAGES = [('Main', 1), ('Atelier', 2), ('Showroom', 3), ('Monogram', 4)]

shutil.rmtree(B, ignore_errors=True)
shutil.copytree(os.path.join(H, 'assets'), os.path.join(P, 'assets'))
shutil.copy(os.path.join(H, 'pages', 'index.html'), os.path.join(P, 'index.html'))
for src, n in PAGES:
    t = open(os.path.join(H, 'src', src + '.dc.html')).read()
    title = re.search(r'<title>(.*?)</title>', t).group(1)
    helm = re.search(r'<helmet>(.*?)</helmet>', t, re.S).group(1).strip()
    body = re.search(r'</helmet>(.*?)</x-dc>', t, re.S).group(1).strip()
    out = f'''<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title}</title>
<link rel="icon" href="/assets/badge.png">
{helm}
<style>html{{scroll-behavior:smooth}}*{{box-sizing:border-box}}img{{display:block;max-width:100%}}</style>
</head>
<body>
{body}
</body>
</html>
'''
    for k, v in BLOBS.items():
        out = out.replace('/_blob/' + k, '/assets/' + v)
    assert '/_blob/' not in out and '{{' not in out, src
    open(os.path.join(P, f'{n}.html'), 'w').write(out)

files = sorted(os.path.relpath(os.path.join(r, f), P).replace(os.sep, '/') for r, _, fs in os.walk(P) for f in fs)
ct = {'.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png'}
js = '\n'.join(f'import f{i} from "./public/{p}";' for i, p in enumerate(files))
js += '\nconst F = {\n' + '\n'.join(f'  "/{p}": [f{i}, "{ct[os.path.splitext(p)[1]]}"],' for i, p in enumerate(files)) + '\n};\n'
alias = ', '.join([f'"/{n}": "/{n}.html"' for _, n in PAGES])
js += '''const ALIAS = { "/": "/index.html", %s };
export default {
  async fetch(req) {
    let p = new URL(req.url).pathname.replace(/\\/+$/, "") || "/";
    p = ALIAS[p] || p;
    const f = F[p];
    if (!f) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    const html = f[1].startsWith("text/html");
    return new Response(f[0], { headers: {
      "content-type": f[1],
      "cache-control": html ? "no-cache" : "public, max-age=86400",
      "x-robots-tag": "noindex",
    } });
  },
};
''' % alias
open(os.path.join(B, 'worker.js'), 'w').write(js)
print('built', len(files), 'files')
