#!/usr/bin/env python3
"""Transcribe page images to Markdown with Claude Haiku through the relay's admin /ib/ocr endpoint.
Usage: IB_ADMIN=... python3 ocr.py SPEC.txt IMG_DIR OUT_DIR [first last] [--workers N]"""
import base64, glob, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
a = [x for x in sys.argv[1:] if not x.startswith('--')]
spec, img_dir, out = open(a[0]).read(), a[1], a[2]
W = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 8
files = sorted(glob.glob(os.path.join(img_dir, 'p-*.jpg')))
num = lambda f: int(re.search(r'p-(\d+)', f).group(1))
if len(a) >= 5:
    files = [f for f in files if int(a[3]) <= num(f) <= int(a[4])]
tot = {'in': 0, 'out': 0, 'cr': 0}

def one(f):
    n = num(f); dst = os.path.join(out, '%04d.md' % n)
    if os.path.exists(dst):
        return
    body = json.dumps({'sys': spec, 'img': base64.b64encode(open(f, 'rb').read()).decode()}).encode()
    for k in range(5):
        try:
            req = urllib.request.Request(RELAY + '/ib/ocr', data=body, method='POST', headers={'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build', 'content-type': 'application/json'})
            j = json.loads(urllib.request.urlopen(req, timeout=180).read())
            if j.get('text'):
                t = re.sub(r'^```(markdown)?\s*|\s*```\s*$', '', j['text'].strip())
                open(dst, 'w').write(t + '\n')
                u = j.get('usage') or {}
                tot['in'] += u.get('input_tokens', 0); tot['out'] += u.get('output_tokens', 0); tot['cr'] += u.get('cache_read_input_tokens', 0) or 0
                return
            err = j
        except Exception as e:
            err = e
        time.sleep(3 * (k + 1))
    print('FAILED', n, err, flush=True)

t0 = time.time()
with ThreadPoolExecutor(W) as ex:
    for i, _ in enumerate(ex.map(one, files)):
        if i % 50 == 49:
            print(f'{i + 1}/{len(files)} {time.time() - t0:.0f}s tokens {tot}', flush=True)
print('done', len(files), f'{time.time() - t0:.0f}s', tot)
