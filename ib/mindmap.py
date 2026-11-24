#!/usr/bin/env python3
"""Turn mind-map page images into node trees for the app's interactive mind maps (Claude Sonnet vision via the relay's admin /ib/ocr).

  IB_ADMIN=... python3 ib/mindmap.py BOOK MAPID out.json img1.jpg img2.jpg ...   # image k -> page n=k (same order as ref:BOOK.maps[].pages)

With --upload, stores the trees on that map in kv 'ref:BOOK' as maps[].pages[].tree.
Tree node: {t: label (Markdown + LaTeX in $...$), c: [children]}; the root is the page's central topic.
"""
import base64, io, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
H = {'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build', 'content-type': 'application/json'}
SYS = ("You convert a hand-drawn IB Mathematics revision mind map image into a JSON tree, exactly as drawn. "
       "The root is the page title (the subject area). Its children are the boxed/rectangular main topic hubs. Below each hub, follow the drawn "
       "connecting lines: every bubble becomes a node attached to the bubble it is linked to (examples hang under the rule they illustrate). "
       "Each node: {\"t\": label, \"c\": [children]}. Labels: copy the text and maths faithfully and completely, sentence case (not ALL CAPS), "
       "maths in LaTeX inside $...$ (fractions, powers, subscripts, sums, integrals, vectors, matrices). A small sketch/graph/table becomes a short "
       "description in brackets, e.g. \"(graph of $y=e^x$ crossing the y-axis at 1)\" or a Markdown table. Keep every bubble; don't add anything that isn't drawn. "
       "Reply with only the JSON object, no code fence.")

def img64(path):
    im = Image.open(path).convert('RGB'); im.thumbnail((2400, 2400))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=85); return base64.b64encode(b.getvalue()).decode()

def run(path):
    for k in range(3):
        try:
            req = urllib.request.Request(RELAY + '/ib/ocr', data=json.dumps({'model': 'claude-sonnet-5-5', 'sys': SYS, 'img': img64(path), 'hint': 'Convert this mind map to the JSON tree.'}).encode(), method='POST', headers=H)
            r = json.loads(urllib.request.urlopen(req, timeout=600).read())
            if r.get('err'): raise Exception(r['err'])
            t = r['text'].strip(); t = re.sub(r'^```(?:json)?\s*|\s*```$', '', t)
            tree = json.JSONDecoder().raw_decode(t[t.index('{'):])[0]  # ignores a stray trailing brace
            cnt = lambda n: 1 + sum(cnt(c) for c in n.get('c', []))
            print(path, cnt(tree), 'nodes', r.get('stop'), flush=True); return tree
        except Exception as e: print('retry', path, e, flush=True)
    return None

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    book, mid, out, imgs = args[0], args[1], args[2], args[3:]
    with ThreadPoolExecutor(6) as ex: trees = list(ex.map(run, imgs))
    json.dump(trees, open(out, 'w'), indent=1, ensure_ascii=False)
    if '--upload' in sys.argv:
        pw = {'pass': os.environ.get('IB_PASS', ''), 'book': book}
        cur = json.loads(urllib.request.urlopen(urllib.request.Request(RELAY + '/ib/ref', data=json.dumps(pw).encode(), method='POST', headers=H)).read())
        M = next(m for m in cur['maps'] if m['id'] == mid)
        start = int(os.environ.get('MM_FROM', '1'))  # MM_FROM=4: the images are pages 4, 5, ...
        for pg, tr in zip(M['pages'][start - 1:], trees):
            if tr: pg['tree'] = tr
        req = urllib.request.Request(f'{RELAY}/ib/put?t=kv&k=ref:{book}', data=json.dumps(cur, ensure_ascii=False).encode(), method='POST', headers=H)
        print(urllib.request.urlopen(req).read().decode())

if __name__ == '__main__': main()
