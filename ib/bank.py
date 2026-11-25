#!/usr/bin/env python3
"""Tagged question bank: add the owner's question banks to the app, and tag questions with difficulty / paper / level / calculator.

  IB_ADMIN=... IB_PASS=... python3 ib/bank.py add BOOK "Set name" FILE... [--upload]
  IB_ADMIN=... IB_PASS=... python3 ib/bank.py retag BOOK [--upload]
  IB_ADMIN=... IB_PASS=... python3 ib/bank.py calibrate BOOK "Set name" [--upload]   # textbook banks from outside IB: IB-scale difficulty, HL flag, drop off-syllabus       # tag existing questions that have no difficulty yet

FILE can be:
  .json  a list of questions: {text, ms|markscheme|answer, marks, topic, difficulty|diff, paper, level|lvl, calculator|calc, kind, ans (MCQ letter)}
  .csv   the same fields as columns (header row)
  .md / .txt  transcribed questions + markschemes (e.g. from ocr.py): Claude splits them into questions and tags them
Missing tags are filled in by Claude (Haiku). Topic codes are the book's syllabus sections (toc level 2, e.g. "S2.1", "3.4").
Question fields in kv 'qs': {id, book, kind, text, marks, ms, ans?, topic, set, src: 'bank', diff: 1|2|3, paper: '1'|'2'|'3'|'', lvl: 'HL'|'', calc: 'yes'|'no'|''}
Without --upload it only writes bank-<BOOK>.json to look over.
"""
import csv, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
UA = {'user-agent': 'ib-build'}
S = lambda **p: {'type': 'object', 'additionalProperties': False, 'required': list(p), 'properties': p}
STR, INT = {'type': 'string'}, {'type': 'integer'}
ARR = lambda x: {'type': 'array', 'items': x}
DIFF = {'easy': 1, 'e': 1, '1': 1, 'medium': 2, 'med': 2, 'm': 2, '2': 2, 'hard': 3, 'h': 3, '3': 3, 'challenging': 3}

def rq(op, body=None, admin=False, path=None):
    h = {**UA, 'content-type': 'application/json'}
    if admin: h['x-ib-admin'] = os.environ['IB_ADMIN']
    req = urllib.request.Request(RELAY + (path or '/ib/' + op), data=json.dumps(body if body is not None else {'pass': os.environ['IB_PASS']}, ensure_ascii=False).encode(), method='POST', headers=h)
    return json.loads(urllib.request.urlopen(req, timeout=600).read() or 'null')

def gen(sys_, text, schema):
    for _ in range(3):
        try:
            r = rq(None, {'sys': sys_, 'text': text, 'schema': schema}, True, '/ib/gen')
            if r.get('err'): raise Exception(r['err'])
            return json.loads(r['text'])
        except Exception as e: print('retry', e, flush=True)
    return None

def topics(book):
    B = next(b for b in rq('books') if b['id'] == book)
    return B, [t for t in B['toc'] if t.get('lvl') == 2 and t.get('num')]

def norm(q):  # tidy tags from any source
    d = str(q.get('difficulty', q.get('diff', ''))).strip().lower()
    q['diff'] = (1 if int(d) <= 3 else 2 if int(d) <= 5 else 3) if d.isdigit() and int(d) > 3 else DIFF.get(d, 0)  # 1-7 scales map onto 3
    p = re.sub(r'[^0-9AB]', '', str(q.get('paper', '')).upper()); q['paper'] = p[:2]
    l = str(q.get('level', q.get('lvl', ''))).upper(); q['lvl'] = 'HL' if 'HL' in l or 'AHL' in l else ''
    c = str(q.get('calculator', q.get('calc', ''))).lower(); q['calc'] = 'no' if c in ('no', 'n', 'false', 'non-calculator', 'gdc not allowed') else 'yes' if c in ('yes', 'y', 'true', 'gdc', 'calculator') else ''
    q['ms'] = q.get('ms') or q.get('markscheme') or q.get('answer') or ''
    try: q['marks'] = int(q.get('marks') or 0)
    except ValueError: q['marks'] = 0
    return q

TAGSYS = ("You tag IB Diploma exam-style questions for a question bank. For each question give: diff = 1 (easy: one-step recall or routine), "
          "2 (medium: multi-step, standard exam level), 3 (hard: unfamiliar context, long chain of reasoning, top-band); "
          "paper = the IB paper it best fits for this subject ('1', '2', '3', '1A' multiple choice, '1B' data-based) or '' if unsure; "
          "lvl = 'HL' only if it needs Additional Higher Level content, else ''; calc = 'no' if it is clearly a non-calculator question, 'yes' if it needs a calculator, else ''; "
          "topic = the best matching syllabus section code from the list given (exactly as written), keep the given one if it is already valid.")
TAG = S(items=ARR(S(i=INT, diff=INT, paper=STR, lvl=STR, calc=STR, topic=STR)))

def tag(B, tps, qs, only_missing=True):
    todo = [q for q in qs if not q.get('diff') or not q.get('topic')] if only_missing else qs
    tl = '\n'.join(f"{t['num']} {t['title']}" for t in tps); valid = {t['num'] for t in tps}
    def run(chunk):
        txt = f"Subject: {B.get('subject', B['title'])}\nSyllabus sections:\n{tl}\n\nQuestions:\n" + '\n\n'.join(
            f"[{i}] ({q.get('marks') or '?'} marks, given topic {q.get('topic') or 'none'}) {q['text'][:900]}" for i, q in chunk)
        r = gen(TAGSYS, txt, TAG) or {'items': []}
        for it in r['items']:
            q = qs[it['i']]
            if not q.get('diff'): q['diff'] = max(1, min(3, it['diff']))
            if not q.get('paper'): q['paper'] = re.sub(r'[^0-9AB]', '', it['paper'].upper())[:2]
            if not q.get('lvl') and it['lvl'].upper() == 'HL': q['lvl'] = 'HL'
            if not q.get('calc') and it['calc'] in ('yes', 'no'): q['calc'] = it['calc']
            if (not q.get('topic') or q['topic'] not in valid and not any(q['topic'].startswith(v + '.') for v in valid)) and it['topic'] in valid: q['topic'] = it['topic']
        print('tagged', len(chunk), flush=True)
    idx = [(qs.index(q), q) for q in todo]
    with ThreadPoolExecutor(6) as ex: list(ex.map(run, [idx[k:k + 20] for k in range(0, len(idx), 20)]))

SPLIT = ("You turn a transcribed IB question bank (questions and their markschemes/answers) into structured questions. One item per top-level question "
         "(keep its parts a, b, i, ii inside 'text' as Markdown with LaTeX in $...$, wording exactly as given; do not solve). marks = total marks if printed else 0. "
         "ms = that question's markscheme/answers copied from the text (Markdown + LaTeX), '' if none. ans = the correct letter for multiple choice, else ''. "
         "kind = 'mcq' for multiple choice, 'essay' for extended essay questions, else 'structured'. Copy any printed difficulty, paper, HL/SL and calculator labels into "
         "difficulty, paper, level, calculator (else ''). Include every question.")
QS = S(qs=ARR(S(text=STR, ms=STR, ans=STR, marks=INT, kind=STR, difficulty=STR, paper=STR, level=STR, calculator=STR)))

CALSYS = ("You calibrate questions from a university/AP textbook against the IB Diploma Programme (first assessment 2025 syllabi for Physics and Chemistry, "
          "2021 Mathematics: Analysis and Approaches). For each question: fit = 'SL' if it is in the SL syllabus, 'HL' if only in the HL (AHL) content, "
          "'no' if it needs content outside the IB syllabus (e.g. calculus-based physics beyond IB, fluid dynamics, colligative properties, epsilon-delta limits, "
          "confidence intervals) or is not an exam-style question; diff on the IB exam scale: 1 = easier than typical IB exam questions, 2 = typical IB exam level, "
          "3 = top-band / harder than most IB exam questions (unfamiliar context, long reasoning); topic = best syllabus section code from the list (exactly as written).")
CAL = S(items=ARR(S(i=INT, fit=STR, diff=INT, topic=STR)))

def calibrate(book, set_name, up):
    B, tps = topics(book); allq = rq('qs'); mine = [q for q in allq if q['book'] == book and q.get('set') == set_name]
    tl = '\n'.join(f"{t['num']} {t['title']}" for t in tps); valid = {t['num'] for t in tps}; drop = set()
    def run(chunk):
        txt = f"Subject: {B.get('subject', B['title'])}\nSyllabus sections:\n{tl}\n\nQuestions:\n" + '\n\n'.join(f"[{i}] {q['text'][:900]}" for i, q in chunk)
        r = gen(CALSYS, txt, CAL) or {'items': []}
        for it in r['items']:
            if not 0 <= it['i'] < len(mine): continue
            q = mine[it['i']]; f = it['fit'].upper()
            if f == 'NO': drop.add(q['id']); continue
            q['diff'] = max(1, min(3, it['diff'])); q['cal'] = 1
            if f == 'HL': q['lvl'] = 'HL'
            else: q.pop('lvl', None)
            if it['topic'] in valid: q['topic'] = it['topic']
        print('calibrated', len(chunk), flush=True)
    idx = list(enumerate(mine))
    with ThreadPoolExecutor(6) as ex: list(ex.map(run, [idx[k:k + 20] for k in range(0, len(idx), 20)]))
    keep = [q for q in allq if q['id'] not in drop]
    print(set_name, len(mine), 'questions,', len(drop), 'outside the IB syllabus dropped,', sum(1 for q in mine if q.get('lvl') == 'HL'), 'HL only')
    if up: put_qs(keep)

def read(f):
    if f.endswith('.json'): return json.load(open(f))
    if f.endswith('.csv'): return list(csv.DictReader(open(f, newline='', encoding='utf-8-sig')))
    t = open(f, encoding='utf-8').read(); out = []
    for k in range(0, len(t), 40000):  # ~10 pages per call
        r = gen(SPLIT, t[k:k + 42000], QS); out += (r or {}).get('qs', [])
    print(f, len(out), 'questions', flush=True); return out

def merge(book, set_name, new, upload):
    allq = rq('qs')
    if set_name: allq = [q for q in allq if not (q['book'] == book and q.get('set') == set_name)]
    allq += new
    if upload: put_qs(allq)

def put_qs(allq):
    req = urllib.request.Request(f'{RELAY}/ib/put?t=kv&k=qs', data=json.dumps(allq, ensure_ascii=False).encode(), method='POST', headers={**UA, 'x-ib-admin': os.environ['IB_ADMIN'], 'content-type': 'application/json'})
    print('qs', urllib.request.urlopen(req).read().decode(), len(allq), 'questions in total')

def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; up = '--upload' in sys.argv
    if a[0] == 'add':
        book, name, files = a[1], a[2], a[3:]
        B, tps = topics(book); qs = [norm(dict(q)) for f in files for q in read(f) if (q.get('text') or '').strip()]
        tag(B, tps, qs)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:30]
        out = [{k: v for k, v in {'id': f'bk:{book}:{slug}:{i}', 'book': book, 'kind': q.get('kind') or ('mcq' if q.get('ans') else 'structured'), 'text': q['text'].strip(), 'ctx': (q.get('ctx') or q.get('context') or q.get('stem') or '').strip(),
                'marks': q['marks'], 'ms': q['ms'], 'ans': q.get('ans', ''), 'topic': q.get('topic', ''), 'set': name, 'src': 'bank', 'diff': q.get('diff') or 2,
                'paper': q.get('paper', ''), 'lvl': q.get('lvl', ''), 'calc': q.get('calc', ''), 'pages': []}.items() if v not in ('', None)} for i, q in enumerate(qs)]
        json.dump(out, open(f'bank-{book}.json', 'w'), indent=1, ensure_ascii=False); print(len(out), 'questions ->', f'bank-{book}.json')
        merge(book, name, out, up)
    elif a[0] == 'calibrate': calibrate(a[1], a[2], up)
    elif a[0] == 'retag':
        book = a[1]; B, tps = topics(book); allq = rq('qs')
        mine = [q for q in allq if q['book'] == book and not q.get('pp') and not re.fullmatch(r'[ivxlc]+', q.get('bp') or '', re.I)]
        tag(B, tps, mine); print(sum(1 for q in mine if q.get('diff')), '/', len(mine), 'tagged')
        json.dump(mine, open(f'retag-{book}.json', 'w'), indent=1, ensure_ascii=False)
        if up: put_qs(allq)

if __name__ == '__main__': main()
