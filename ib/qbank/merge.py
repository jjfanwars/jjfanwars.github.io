#!/usr/bin/env python3
"""Merge qbank/parts/*.json into qbank/<book>.json + qbank/index.json (the site loads index.json)."""
import json, glob, os, collections
D = os.path.dirname(os.path.abspath(__file__)); by = collections.defaultdict(list)
for f in sorted(glob.glob(os.path.join(D, 'parts', '*.json'))):
    for q in json.load(open(f)): by[q['book']].append(q)
for b, qs in by.items():
    seen = set(); qs = [q for q in qs if not (q['id'] in seen or seen.add(q['id']))]
    json.dump(qs, open(os.path.join(D, b + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(b, len(qs))
json.dump(sorted(b + '.json' for b in by), open(os.path.join(D, 'index.json'), 'w'))
