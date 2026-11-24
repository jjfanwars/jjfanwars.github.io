#!/usr/bin/env python3
"""Merge extra question sets / practice papers (from qsets.py) into the relay, replacing earlier copies of the same sets.

  IB_ADMIN=... IB_PASS=... python3 ib/addq.py [--book meta.json] [--papers papers.json] q1.json q2.json ...

--book adds or replaces a book entry (e.g. a subject whose textbook isn't uploaded yet: pages 0, toc of chapters).
Question files replace every existing question with the same (book, set); papers replace papers with the same id.
"""
import json, os, sys, urllib.request

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
UA = {'user-agent': 'ib-build'}

def get(op):
    req = urllib.request.Request(RELAY + '/ib/' + op, data=json.dumps({'pass': os.environ['IB_PASS']}).encode(), method='POST', headers=UA)
    r = json.loads(urllib.request.urlopen(req).read() or 'null')
    return r if isinstance(r, list) else []

def put(k, v):
    req = urllib.request.Request(f'{RELAY}/ib/put?t=kv&k={k}', data=json.dumps(v, ensure_ascii=False).encode(), method='POST', headers={**UA, 'x-ib-admin': os.environ['IB_ADMIN'], 'content-type': 'application/json'})
    print(k, urllib.request.urlopen(req).read().decode())

def main():
    args = sys.argv[1:]
    opt = lambda f: args[args.index(f) + 1] if f in args else None
    files = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] not in ('--book', '--papers'))]
    if opt('--book'):
        meta = json.load(open(opt('--book'))); books = [b for b in get('books') if b['id'] != meta['id']]
        old = next((b for b in get('books') if b['id'] == meta['id']), None)
        if old and old.get('pages') and not meta.get('pages'): meta = old  # never replace a real textbook with a placeholder
        put('books', books + [meta])
    if files:
        new = [q for f in files for q in json.load(open(f))]
        sets = {(q['book'], q.get('set')) for q in new}
        qs = [q for q in get('qs') if (q.get('book'), q.get('set')) not in sets]
        put('qs', qs + new); print(len(new), 'questions added')
    if opt('--papers'):
        new = json.load(open(opt('--papers'))); ids = {p['id'] for p in new}
        put('papers', [p for p in get('papers') if p['id'] not in ids] + new); print(len(new), 'papers')

if __name__ == '__main__': main()
