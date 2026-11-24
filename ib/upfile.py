#!/usr/bin/env python3
"""Upload a textbook PDF to the relay for the app's Download button.
Usage: IB_ADMIN=... python3 upfile.py BOOK_ID file.pdf "Download name.pdf" """
import json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
book, path, name = sys.argv[1:4]
CH = 1900000
data = open(path, 'rb').read()
parts = [data[i:i + CH] for i in range(0, len(data), CH)]

def put(q, body):
    for _ in range(5):
        try:
            req = urllib.request.Request(f'{RELAY}/ib/put?{q}', data=body, method='POST', headers={'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build'})
            if '"ok"' in urllib.request.urlopen(req, timeout=120).read().decode():
                return
        except Exception as e:
            err = e
    raise SystemExit(f'failed {q}: {err}')

with ThreadPoolExecutor(6) as ex:
    list(ex.map(lambda a: put(f't=fchunk&b={book}&n={a[0]}', a[1]), enumerate(parts)))
put(f't=fmeta&b={book}', json.dumps({'n': len(parts), 'size': len(data), 'name': name}).encode())
print(f'{book}: {len(parts)} chunks, {len(data)} bytes')
