#!/usr/bin/env python3
"""Real diagrams in the reader: each `*[Figure ...]*` line on a page gets a pixel box in its scan (found by Claude Code agents, not the API:
figjobs/BOXES.md + one job file per ~25 pages, output BOXDIR/NNNN.json = {"boxes": [[x0,y0,x1,y1] | null, ...]} in figure-line order), crop it from a 200 dpi render of the PDF and store it as an image under book id
`BOOK~f`, n = page * 100 + k (k = index of the figure line on that page). kv `figs:BOOK` = {page: [k, ...]} tells the app which
figure lines have a picture; the description stays in the page text (alt text, and what the tutor reads).

  IB_ADMIN=... python3 ib/figs.py BOOK MD_DIR IMG_DIR BOOK.pdf BOXDIR [--workers 8]
Upload state is cached in figs-BOOK.json next to MD_DIR, so a rerun only uploads pages it hasn't done.
"""
import glob, io, json, os, re, subprocess, sys, tempfile, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
H = {'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build', 'content-type': 'application/json'}
FIG = re.compile(r'^\s*\*\[(Figure[^\n]*?)\]\*\s*$', re.M)
def post(path, body, ctype='application/json', raw=False):
    req = urllib.request.Request(RELAY + path, data=body if raw else json.dumps(body).encode(), method='POST', headers={**H, 'content-type': ctype})
    return urllib.request.urlopen(req, timeout=300).read()

def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    book, md_dir, img_dir, pdf, box_dir = a[:5]; up = True
    W = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 8
    cache_f = os.path.join(os.path.dirname(os.path.abspath(md_dir)), f'figs-{book}.json')
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    mds = sorted(glob.glob(os.path.join(md_dir, '*.md'))); imgs = sorted(glob.glob(os.path.join(img_dir, 'p-*.jpg')))
    lock = threading.Lock()
    def one(i):
        n = i + 1; md = open(mds[i]).read(); figs = FIG.findall(md)
        bf = os.path.join(box_dir, '%04d.json' % n)
        if not figs or not os.path.exists(bf): return
        key = str(n); b = json.load(open(bf)).get('boxes') or []
        b = [x if isinstance(x, list) and len(x) == 4 else None for x in (b + [None] * len(figs))[:len(figs)]]
        if key not in cache or cache[key].get('boxes') != b:
            with lock: cache[key] = {'figs': len(figs), 'boxes': b, 'size': Image.open(imgs[i]).size}; json.dump(cache, open(cache_f, 'w'))
        c = cache[key]
        if c.get('up') is not None: return
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(['pdftoppm', '-r', '200', '-f', str(n), '-l', str(n), '-jpeg', '-jpegopt', 'quality=85', pdf, os.path.join(td, 'x')], check=True)
            hi = Image.open(glob.glob(os.path.join(td, 'x*.jpg'))[0]).convert('RGB')
        sx, sy = hi.width / c['size'][0], hi.height / c['size'][1]; got = []
        for k, bx in enumerate(c['boxes']):
            if not bx: continue
            x0, y0, x1, y1 = bx; pad = 7
            x0, y0, x1, y1 = max(0, (x0 - pad) * sx), max(0, (y0 - pad) * sy), min(hi.width, (x1 + pad) * sx), min(hi.height, (y1 + pad) * sy)
            if x1 - x0 < 40 or y1 - y0 < 30: continue
            crop = hi.crop((int(x0), int(y0), int(x1), int(y1))); crop.thumbnail((1400, 1400))
            buf = io.BytesIO(); crop.save(buf, 'JPEG', quality=84)
            post(f'/ib/put?t=img&b={book}~f&n={n * 100 + k}', buf.getvalue(), 'image/jpeg', raw=True); got.append(k)
        with lock: c['up'] = got; json.dump(cache, open(cache_f, 'w'))
        print(n, len(got), '/', len(figs), flush=True)
    with ThreadPoolExecutor(W) as ex: list(ex.map(one, range(min(len(mds), len(imgs)))))
    if True:
        m = {k: v['up'] for k, v in cache.items() if v.get('up')}
        print(post(f'/ib/put?t=kv&k=figs:{book}', m).decode(), len(m), 'pages with pictures')

if __name__ == '__main__': main()
