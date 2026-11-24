#!/usr/bin/env python3
"""Build a book's reference data (formula sheet or case-study bank) with Claude Haiku via the relay's admin /ib/gen.

  IB_ADMIN=... python3 ib/extract.py BOOK md_dir book.json formulas|cases [--upload]

Groups pages by contents section (level 1-2 entries with a number), sends each section's
Markdown (max ~40 pages per call), merges and de-duplicates the results, writes BOOK-ref.json
and with --upload stores it as kv 'ref:BOOK' (merged with what is already there, so a book
can have both formulas and cases).
"""
import json, os, sys, glob, re, urllib.request
from concurrent.futures import ThreadPoolExecutor

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
H = {'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build', 'content-type': 'application/json'}

S = lambda **p: {'type': 'object', 'additionalProperties': False, 'required': list(p), 'properties': p}
STR, ARR = {'type': 'string'}, lambda x: {'type': 'array', 'items': x}
KINDS = {
  'formulas': (
    "You extract a formula and data sheet from an IB Diploma textbook section, for a student revising. List every equation, "
    "relationship and formula the student is expected to know or use in calculations (not every chemical reaction: only general "
    "relationships like n = m/M, PV = nRT, rate laws, Ka expressions, ΔG = ΔH − TΔS, plus important named reaction types written generally). "
    "Write each in LaTeX (no $ delimiters; use \\ce{} for chemical species). 'where' explains each symbol with units, in plain text with inline LaTeX in $...$. "
    "'page' is the printed page number from the <page> tag where it first appears. Also list constants and data values the section gives "
    "(e.g. Avogadro constant, R, specific heat capacity of water, Kw at 298 K). Skip anything trivial. Empty arrays are fine.",
    S(formulas=ARR(S(name=STR, latex=STR, where=STR, page=STR, note=STR)), constants=ARR(S(name=STR, symbol=STR, value=STR, page=STR)))),
  'cases': (
    "You build a case-study bank from an IB Global Politics textbook section, for essay writing. List every real-world case study or "
    "specific example the text uses (named states, conflicts, organisations, movements, events, policies, court cases), not hypotheticals. "
    "For each: a short title; a 2-3 sentence summary with the concrete facts (who, what, when, numbers) a student could cite; the concepts it "
    "illustrates, chosen from: power, sovereignty, legitimacy, interdependence, peace, conflict, violence, human rights, justice, liberty, equality, "
    "development, sustainability, poverty, inequality, globalization, security, environment, identity, health, technology, borders, democracy, "
    "non-state actors, international law, theory; the main actors; region; years; and 'page' = printed page number from the <page> tag. "
    "Merge mentions of the same case within the section.",
    S(cases=ARR(S(title=STR, summary=STR, concepts=ARR(STR), actors=ARR(STR), region=STR, years=STR, page=STR)))),
}

def post(path, body):
    req = urllib.request.Request(RELAY + path, data=json.dumps(body).encode(), method='POST', headers=H)
    return json.loads(urllib.request.urlopen(req, timeout=300).read())

def main():
    book, mdd, meta_f, kind = sys.argv[1:5]
    files = sorted(glob.glob(os.path.join(mdd, '*.md')))
    meta = json.load(open(meta_f))['meta']
    heads = [t for t in meta['toc'] if t['lvl'] <= 2 and t.get('num')]
    heads = [t for i, t in enumerate(heads) if not (i + 1 < len(heads) and heads[i + 1]['n'] == t['n'])]  # keep the deepest of same-page heads
    secs = []
    for i, t in enumerate(heads):
        end = heads[i + 1]['n'] if i + 1 < len(heads) else len(files) + 1
        for a in range(t['n'], end, 40): secs.append((t, a, min(end, a + 40)))
    sys_p, schema = KINDS[kind]
    def run(x):
        t, a, z = x
        text = f"Section: {t.get('num', '')} {t['title']}\n\n" + '\n'.join(
            f"<page {re.match(r'<!-- p:(.*?) -->', open(files[n - 1]).read() or '') and re.match(r'<!-- p:(.*?) -->', open(files[n - 1]).read()).group(1) or n}>\n{open(files[n - 1]).read()}\n</page>" for n in range(a, z))
        for k in range(3):
            try:
                r = post('/ib/gen', {'sys': sys_p, 'schema': schema, 'text': text[:400000]})
                if r.get('err'): raise Exception(r['err'])
                o = json.loads(r['text']); topic = (t.get('num') or '').strip()
                for v in o.values():
                    for it in v: it['topic'] = topic
                print(t.get('num'), a, z, {k2: len(v) for k2, v in o.items()}, flush=True); return o
            except Exception as e: print('retry', t.get('num'), e, flush=True)
        return {}
    with ThreadPoolExecutor(8) as ex: outs = list(ex.map(run, secs))
    ref = {}
    for o in outs:
        for k, v in o.items(): ref.setdefault(k, []).extend(v)
    seen = set()
    for k in ref:  # de-duplicate by latex / title / symbol
        keep = []
        for it in ref[k]:
            key = (k, re.sub(r'\s+', '', (it.get('latex') or it.get('title') or it.get('symbol') or '')).lower())
            if key in seen: continue
            seen.add(key); keep.append(it)
        ref[k] = keep
    json.dump(ref, open(f'{book}-ref.json', 'w'), indent=1, ensure_ascii=False)
    print({k: len(v) for k, v in ref.items()})
    if '--upload' in sys.argv:
        cur = {}
        try:
            cur = json.loads(urllib.request.urlopen(urllib.request.Request(RELAY + '/ib/ref', data=json.dumps({'book': book}).encode(), method='POST', headers=H)).read() or '{}')
            if not isinstance(cur, dict): cur = {}
        except Exception: pass
        cur.update(ref)
        req = urllib.request.Request(f'{RELAY}/ib/put?t=kv&k=ref:{book}', data=json.dumps(cur, ensure_ascii=False).encode(), method='POST', headers=H)
        print(urllib.request.urlopen(req).read().decode())

if __name__ == '__main__': main()
