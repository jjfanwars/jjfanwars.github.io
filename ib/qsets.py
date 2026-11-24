#!/usr/bin/env python3
"""Turn transcribed question sets that carry their own answers (tests, review sets, exam practice, practice papers)
into question-bank entries with markschemes, using Claude Haiku via the relay's admin /ib/gen.

  IB_ADMIN=... python3 ib/qsets.py BOOK KIND "Label" md_dir out.json
  IB_ADMIN=... python3 ib/qsets.py BOOK paper "Label" md_dir out.json     # practice papers -> past-paper format

The page stream is split on "## Answers" / "## Markscheme" headings: each question block is paired with the
answer block that follows it. Output: a JSON list of questions {id, book, kind, text, marks, ms, topic, set}
(or, for KIND=paper, a list of papers in the kv 'papers' format). Upload with upsets.py / build-style merging.
"""
import glob, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
H = {'x-ib-admin': os.environ['IB_ADMIN'], 'user-agent': 'ib-build', 'content-type': 'application/json'}
S = lambda **p: {'type': 'object', 'additionalProperties': False, 'required': list(p), 'properties': p}
STR, INT, ARR = {'type': 'string'}, {'type': 'integer'}, lambda x: {'type': 'array', 'items': x}
Q = S(n=STR, chapter=STR, text=STR, marks=INT, calculator=STR, ms=STR)
SYS = ("You convert a transcribed IB Mathematics question set and its answers/markscheme into structured questions. "
       "One item per top-level numbered question (keep all its parts a, b, i, ii inside 'text', as Markdown with LaTeX in $...$, exactly as given; "
       "do not solve or change wording). 'chapter' = the chapter number the question belongs to (from the nearest chapter heading, digits only, '' if none). "
       "'marks' = total marks if printed, else 0. 'calculator' = 'no' if the section/question says calculator not allowed, 'yes' if allowed, else ''. "
       "'ms' = that question's answers or markscheme copied from the answers block (all parts, with mark codes if present), Markdown + LaTeX. "
       "If a question has no matching answer, ms = ''. Include every question.")
PSYS = SYS + (" Also identify which paper each question is in: put the paper title (e.g. 'Paper 1', 'Paper 2') in 'chapter' instead of a chapter number.")

def post(body):
    req = urllib.request.Request(RELAY + '/ib/gen', data=json.dumps(body).encode(), method='POST', headers=H)
    return json.loads(urllib.request.urlopen(req, timeout=600).read())

def main():
    book, kind, label, mdd, out = sys.argv[1:6]
    pages = [open(f).read() for f in sorted(glob.glob(os.path.join(mdd, '*.md')))]
    text = '\n'.join(re.sub(r'^<!--.*?-->\s*', '', p) for p in pages)
    AH = r'##\s*(?:Answers|Markscheme|Mark scheme|Worked solutions)\b[^\n]*'
    text = re.sub(rf'^{AH}\n(?:\s*\n|{AH}\n)*', '## Answers\n', text, flags=re.M | re.I)  # "Answers" + "Markscheme" back to back = one block
    pairs = []  # (questions, answers)
    if kind == 'paper':  # one markscheme at the end covers every paper
        q, _, a = text.partition('## Answers\n'); pairs = [(q, a)]
    else:
        parts = re.split(r'^## Answers\n', text, flags=re.M)
        qb = parts[0]
        for ans in parts[1:]:
            # answers run until the next numbered chapter/section heading (running headers like "## Mixed review" don't end them)
            m = re.search(r'^##\s+(?:\d+(?:\.\d+)*\s|Exam practice:)', ans, re.M | re.I)
            a, rest = (ans[:m.start()], ans[m.start():]) if m else (ans, '')
            pairs.append((qb, a)); qb = rest
        if qb.strip(): pairs.append((qb, ''))
        merged = []  # an "Answers" running header on the next page starts an empty pair: fold it into the previous answers
        for q, a in pairs:
            if merged and len(re.sub(r'(?m)^##.*$', '', q).strip()) < 200: merged[-1] = (merged[-1][0], merged[-1][1] + '\n' + q + '\n' + a)
            else: merged.append((q, a))
        pairs = merged
    chunks = []
    for q, a in pairs:  # keep calls a manageable size
        if len(q) + len(a) < 120000: chunks.append((q, a)); continue
        qs = re.split(r'(?=^##\s)', q, flags=re.M); cur = ''
        for s in qs:
            if len(cur) + len(s) > 60000: chunks.append((cur, a)); cur = ''
            cur += s
        if cur: chunks.append((cur, a))
    schema = S(qs=ARR(Q))
    def run(x):
        q, a = x
        for k in range(3):
            try:
                r = post({'sys': PSYS if kind == 'paper' else SYS, 'schema': schema, 'text': f"QUESTIONS:\n{q}\n\nANSWERS / MARKSCHEME:\n{a or '(none)'}"})
                if r.get('err'): raise Exception(r['err'])
                o = json.loads(r['text'])['qs']; print(len(o), 'questions', flush=True); return o
            except Exception as e: print('retry', e, flush=True)
        return []
    with ThreadPoolExecutor(6) as ex: res = [q for r in ex.map(run, chunks) for q in r]
    slug = re.sub(r'[^a-z0-9]+', '', label.lower())[:10]
    if kind == 'paper':
        papers = {}
        for q in res: papers.setdefault(q['chapter'] or 'Paper', []).append(q)
        outp = [{'id': f'{book}-{slug}-{re.sub(r"[^a-z0-9]", "", t.lower())}', 'book': book, 'title': f'{label}: {t}', 'session': label, 'paper': t,
                 'mins': 90, 'calc': qs[0].get('calculator', ''), 'qs': [{'n': q['n'], 'text': q['text'], 'marks': q['marks'], 'ms': q['ms'], 'kind': 'mexam'} for q in qs]} for t, qs in papers.items()]
    else:
        outp = [{'id': f'{book}-{slug}-{i}', 'book': book, 'kind': kind, 'set': label, 'text': q['text'], 'marks': q['marks'] or None, 'ms': q['ms'],
                 'topic': q['chapter'], 'calc': q['calculator'], 'n': 0, 'bp': '', 'pages': []} for i, q in enumerate(res)]
    json.dump(outp, open(out, 'w'), indent=1, ensure_ascii=False)
    print(label, len(outp), 'items ->', out)

if __name__ == '__main__': main()
