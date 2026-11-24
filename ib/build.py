#!/usr/bin/env python3
"""Build and upload one IB Study textbook to the relay.

Usage: python3 build.py BOOK_ID "Title" SUBJECT MD_DIR [IMG_DIR] [--upload]
  MD_DIR holds NNN.md page files (first line <!-- p:BOOKPAGE -->), IMG_DIR holds p-NNN.jpg scans.
Uploads need IB_ADMIN in the environment (the relay secret). Book text never goes in this repo.
Writes <MD_DIR>/../BOOK_ID.json (toc, terms, questions) for checking.
"""
import json, math, os, re, sys, urllib.request
from collections import Counter

RELAY = os.environ.get('IB_RELAY', 'https://jjfanwars-relay.businessautomationvic.workers.dev')
STOP = set('the of and to in a is that for as on are be by with this or it from an their can was have which not they has its at more these also there other such than how what were been may but who into about would between when some all them one most many states state political global politics example examples does do used use your you see'.split())


def words(s):
    return [w for w in re.findall(r"[a-z][a-z'-]{2,}", s.lower()) if w not in STOP]


def load(md_dir):
    pages = []
    for f in sorted(os.listdir(md_dir)):
        m = re.match(r'(\d+)\.md$', f)
        if not m:
            continue
        src = open(os.path.join(md_dir, f), encoding='utf-8').read()
        bp = re.match(r'<!--\s*p:\s*([^ ]*)\s*-->', src)
        pages.append({'n': int(m.group(1)), 'bp': bp.group(1) if bp else '-', 'md': src})
    return pages


def build(book, title, subject, pages):
    toc, terms, qs = [], [], []
    cand = []  # physics-style "A.2 Title" / "Theme A" headings repeat as running headers: resolved after the scan
    for p in pages:
        for line in p['md'].splitlines():
            h = re.match(r'(#{1,3})\s+(.+)', line)
            if h:
                t = re.sub(r'[*_]', '', h.group(2)).strip()
                num = re.match(r'((?:(?:Structure|Reactivity|Tools?)\s+)?\d+(?:\.\d+)*)\.?\s*[–-]?\s+(.*)', t)
                lvl = len(h.group(1))
                th = re.match(r'Theme\s+([A-E])\b[\s:.–-]*(.*)', t)  # physics: "Theme A Space, time and motion"
                tp = re.match(r'([A-E]\.\d+)\s+(.*)', t)  # physics topics: "A.2 Forces and momentum"
                if th and lvl == 1:
                    if '...' not in t: cand.append((1, th.group(1), th.group(2) or t, p['n'], p['bp'], len(toc)))
                elif tp and lvl == 1:
                    if '...' not in t: cand.append((2, tp.group(1), tp.group(2), p['n'], p['bp'], len(toc)))
                elif os.environ.get('IB_SUBS') and lvl == 2 and not num and len(t) < 70 and not re.match(r'(Exercises?|Practice questions|Challenge|Worked example|Guiding questions|Understandings|Solutions?|Examples?|Answers?|Notes?|Hint|Red|Blue|Summary|Video|[A-E]\.\d+ Figure|Figure)\b', t, re.I) and len(t) > 3:
                    toc.append({'lvl': 3, 'num': '', 'title': t, 'n': p['n'], 'bp': p['bp']})
                elif num:
                    lvl = min(3, re.sub(r'^\D+', '', num.group(1)).count('.') + 1)
                    toc.append({'lvl': lvl, 'num': num.group(1), 'title': num.group(2), 'n': p['n'], 'bp': p['bp']})
                elif lvl == 1:
                    toc.append({'lvl': 1, 'num': '', 'title': t, 'n': p['n'], 'bp': p['bp']})
        for m in re.finditer(r'^> \[!keyterm\]\s*(.+)\n((?:>.*\n?)+)', p['md'], re.M):
            d = re.sub(r'^>\s?', '', m.group(2), flags=re.M).strip()
            k = m.group(1).strip().rstrip(':')
            if k and d and not any(t['k'].lower() == k.lower() for t in terms):
                terms.append({'k': k, 'd': d, 'n': p['n'], 'bp': p['bp']})
    toc = [t for t in toc if not re.search(r'(,|\s)\s*\d+$', t['title']) and t['n'] > 4 and t['title'].lower() not in ('contents', 'chemistry')]
    # drop duplicated toc entries (a heading repeated on the next page)
    seen, toc2 = set(), []
    for t in toc:
        key = t['num'] or t['title'].lower()
        if key in seen:
            continue
        seen.add(key)
        toc2.append(t)
    toc = toc2

    if cand:  # most frequent title per number; start page = first page showing that title; merged into toc in page order

        best = {}
        for lv, num, ttl, n, bp, at in cand:
            best.setdefault((lv, num), Counter())[ttl] += 1
        add = []
        for (lv, num), c in best.items():
            ttl = c.most_common(1)[0][0]
            n, bp = next((x[3], x[4]) for x in cand if x[0] == lv and x[1] == num and x[2] == ttl)
            add.append({'lvl': lv, 'num': num, 'title': ttl, 'n': n, 'bp': bp})
        rest = [t for t in toc if not t['num'] and t['lvl'] == 3]  # in this mode only the lettered topics count; drop stray numbered/unnumbered headings
        toc[:] = sorted(rest + add, key=lambda t: (t['n'], t['lvl']))
        seen, out = set(), []
        for t in toc:  # repeated sub-section headings: keep the first per topic
            k = (t['lvl'], t['title'].lower(), next((x['num'] for x in reversed(out) if x['lvl'] == 2), ''))
            if t['lvl'] == 3 and k in seen: continue
            seen.add(k); out.append(t)
        toc[:] = out
    def topic_at(n):
        s = ''
        for t in toc:
            if t['n'] > n:
                break
            if t['num']:
                s = t['num']
        return s

    # tf-idf over pages to attach the most relevant pages to each question
    df, tf = Counter(), {}
    for p in pages:
        c = Counter(words(re.sub(r'^> \[!\w+\]', '', p['md'], flags=re.M)))
        tf[p['n']] = c
        df.update(c.keys())
    N = len(pages)

    def related(text, near=None, k=6):
        q = Counter(words(text))
        sc = []
        for n, c in tf.items():
            tot = sum(c.values()) or 1
            s = sum((c[w] / tot) * math.log(N / (1 + df[w])) * qc for w, qc in q.items() if c[w])
            if near and abs(n - near) <= 1:
                s *= 1.5
            sc.append((s, n))
        out = [n for s, n in sorted(sc, reverse=True)[:k] if s > 0]
        if near and near not in out:
            out = [near] + out[:k - 1]
        return sorted(out)

    plain = lambda s: re.sub(r'\*\*|__', '', s).strip()
    for p in pages:
        md = p['md']
        # Paper 2 exam-style lists
        if re.search(r'Paper 2,? section', md, re.I):
            sec = 'A'
            for line in md.splitlines():
                line = re.sub(r'^>\s?', '', line)
                ms = re.match(r'\**Paper 2,? section (\w)', line.strip(), re.I)
                if ms:
                    sec = ms.group(1).upper()
                    continue
                mq = re.match(r'(\d+)\.\s+(.+)', line.strip())
                if mq and len(mq.group(2)) > 25:
                    text = plain(mq.group(2))
                    ch = topic_at(p['n']).split('.')[0]
                    qs.append({'id': f'{book}-p2-{p["n"]}-{sec}{mq.group(1)}', 'book': book, 'kind': 'essay', 'marks': 15, 'text': text,
                               'ctx': f'Paper 2, section {sec}', 'topic': ch, 'n': p['n'], 'bp': p['bp'], 'pages': related(text)})
        # activities and question boxes: one practice item per box that asks something
        for m in re.finditer(r'^> \[!(activity|questions)\]\s*(.*)\n((?:>.*\n?)+)', md, re.M):
            body = re.sub(r'^>\s?', '', m.group(3), flags=re.M).strip()
            body = re.sub(r'^>\s?', '', body, flags=re.M)
            if '?' not in body and not re.search(r'^\s*\d+\.', body, re.M):
                continue
            if 'give you an opportunity' in body or 'paper 2-style' in body:
                continue
            if re.search(r'\bSource [A-D]\b', body):  # Paper 1 practice set: one item per sub-question, IB marks 3/4/8/10
                for mq in re.finditer(r'^(\d)\.\s+(.+)$', body, re.M):
                    i = int(mq.group(1))
                    qs.append({'id': f'{book}-p1-{p["n"]}-{i}', 'book': book, 'kind': 'p1', 'marks': [3, 4, 8, 10][min(i, 4) - 1], 'text': plain(mq.group(2)),
                               'ctx': 'Paper 1 practice: the sources are on the textbook pages shown (open in textbook).', 'topic': topic_at(p['n']), 'n': p['n'] - 1, 'bp': str(int(p['bp']) - 1) if p['bp'].isdigit() else p['bp'], 'pages': [p['n'] - 1, p['n']]})
                continue
            kind = 'activity' if m.group(1) == 'activity' else 'short'
            qs.append({'id': f'{book}-{kind}-{p["n"]}-{m.start()}', 'book': book, 'kind': kind, 'text': plain(body), 'ctx': plain(m.group(2)) if m.group(2).strip() not in ('Activity', '') else '',
                       'topic': topic_at(p['n']), 'n': p['n'], 'bp': p['bp'], 'pages': related(body, p['n'])})
        # science books: exercises, challenge boxes and end-of-chapter practice questions, one item per numbered question
        for m in re.finditer(r'^> \[!(exercise|challenge|practice)\]\s*(.*)\n((?:>.*\n?)+)', md, re.M):
            body = re.sub(r'^>\s?', '', m.group(3), flags=re.M).strip()
            items = re.split(r'(?m)^(?=\*{0,2}Q?\d{1,3}\.\*{0,2}\s)', body)
            for it in items:
                mq = re.match(r'\*{0,2}Q?(\d{1,3})\.\*{0,2}\s+([\s\S]+)', it.strip())
                if not mq or len(mq.group(2)) < 15:
                    continue
                text = mq.group(2).strip()
                marks = sum(int(x) for x in re.findall(r'(?:\[(\d{1,2})\]|\((\d{1,2})\)\s*$)', text, re.M) for x in x if x) or None
                kind = 'mcq' if re.search(r'(?m)^\s*(?:- )?\**A\.?\**[ .)]', text) and re.search(r'(?m)^\s*(?:- )?\**D\.?\**[ .)]', text) else {'exercise': 'exercise', 'challenge': 'challenge', 'practice': 'structured'}[m.group(1)]
                if kind == 'mcq':
                    marks = 1
                qs.append({'id': f'{book}-{m.group(1)}-{p["n"]}-{mq.group(1)}', 'book': book, 'kind': kind, 'marks': marks, 'text': text, 'ctx': '',
                           'topic': topic_at(p['n']), 'n': p['n'], 'bp': p['bp'], 'pages': related(text, p['n'], 4)})
    # end-of-chapter "Practice questions" written as plain numbered lists that run over several pages
    buf, start = None, None
    def flush():
        if not buf:
            return
        for it in re.split(r'(?m)^(?=\*{0,2}\d{1,2}\.\*{0,2}\s)', buf):
            mq = re.match(r'\*{0,2}(\d{1,2})\.\*{0,2}\s+([\s\S]+)', it.strip())
            if not mq or len(mq.group(2)) < 15:
                continue
            text = re.sub(r'\n{3,}', '\n\n', mq.group(2).strip())
            marks = sum(int(x) for x in re.findall(r'(?:\[(\d{1,2})\]|\((\d{1,2})\)\s*$)', text, re.M) for x in x if x) or None
            mcq = bool(re.search(r'(?m)^\s*(?:- )?\**A\.?\**[ .)]', text) and re.search(r'(?m)^\s*(?:- )?\**D\.?\**[ .)]', text))
            qs.append({'id': f'{book}-pq-{start[0]}-{mq.group(1)}', 'book': book, 'kind': 'mcq' if mcq else 'structured', 'marks': 1 if mcq else marks, 'text': text, 'ctx': 'End-of-chapter practice question',
                       'topic': topic_at(start[0]), 'n': start[0], 'bp': start[1], 'pages': related(text, start[0], 4)})
    for p in pages:
        for line in p['md'].splitlines()[1:]:
            if re.match(r'#{1,3}\s+\**Practice questions', line, re.I):
                flush(); buf, start = '', (p['n'], p['bp']); continue
            if buf is not None and re.match(r'#{1,2}\s', line):
                flush(); buf = None; continue
            if buf is not None and not line.startswith('*[Figure') or (buf is not None and line.startswith('*[Figure')):
                buf += line + '\n'
    flush()
    # science toc clean-up: drop learning-outcome lines mis-read as subsection headings
    cur2, keep = '', []
    for t in toc:
        n = re.sub(r'^\D+', '', t['num'])
        if t['lvl'] == 2:
            cur2 = n
        if t['lvl'] == 3 and t['num'] and cur2 and not n.startswith(cur2 + '.') or len(t['title']) > 75:
            continue
        keep.append(t)
    meta_toc = keep
    meta = {'id': book, 'title': title, 'subject': subject, 'pages': max(p['n'] for p in pages), 'toc': meta_toc, 'terms': sorted(terms, key=lambda t: t['k'].lower())}
    if os.environ.get('IB_MATH'):
        meta['math'] = True
    if os.environ.get('IB_SUBS'):
        meta['subs'] = True
    if os.environ.get('IB_FILE'):
        meta['file'] = True
    start = next((t['n'] for t in toc if t['num']), 1)
    meta['start'] = start
    return meta, qs


def put(q, body, ctype):
    req = urllib.request.Request(RELAY + '/ib/put?' + q, data=body, method='POST', headers={'x-ib-admin': os.environ['IB_ADMIN'], 'content-type': ctype, 'user-agent': 'ib-build'})
    for i in range(4):
        try:
            r = urllib.request.urlopen(req, timeout=60).read().decode()
            if '"ok"' in r:
                return
        except Exception as e:
            r = str(e)
    raise SystemExit('upload failed: ' + q + ' ' + r)


def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    book, title, subject, md_dir = a[:4]
    img_dir = a[4] if len(a) > 4 else None
    pages = load(md_dir)
    meta, qs = build(book, title, subject, pages)
    out = os.path.join(os.path.dirname(os.path.abspath(md_dir)), book + '.json')
    json.dump({'meta': meta, 'qs': qs}, open(out, 'w'), indent=1)
    print(f'{len(pages)} pages, {len(meta["toc"])} toc, {len(meta["terms"])} terms, {len(qs)} questions -> {out}')
    if '--upload' not in sys.argv:
        return
    from urllib.parse import quote
    for p in pages:
        put(f't=page&b={book}&n={p["n"]}&bp={quote(p["bp"])}', p['md'].encode(), 'text/plain')
        if img_dir:
            f = next((x for x in (os.path.join(img_dir, 'p-%03d.jpg' % p['n']), os.path.join(img_dir, 'p-%04d.jpg' % p['n'])) if os.path.exists(x)), '')
            if os.path.exists(f) and '--imgs' in sys.argv:
                put(f't=img&b={book}&n={p["n"]}', open(f, 'rb').read(), 'image/jpeg')
    # merge into the shared book list and question bank (other books stay)
    def get(op):
        req = urllib.request.Request(RELAY + '/ib/' + op, data=json.dumps({'pass': os.environ['IB_PASS']}).encode(), method='POST', headers={'user-agent': 'ib-build'})
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    books = [b for b in get('books') if b['id'] != book] + [meta]
    allq = [q for q in get('qs') if q['book'] != book or q.get('set')] + qs  # sets added by addq.py (tests, review, papers) survive a rebuild
    put('t=kv&k=books', json.dumps(books).encode(), 'application/json')
    put('t=kv&k=qs', json.dumps(allq).encode(), 'application/json')
    print('uploaded')


if __name__ == '__main__':
    main()
