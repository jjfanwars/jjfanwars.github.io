#!/usr/bin/env python3
"""Free, openly licensed question banks: turn an OpenStax book's end-of-section exercises (with their answers) into
question-bank JSON for ib/bank.py. No Claude needed for this step; bank.py then tags topics.

  python3 ib/openstax.py REPO_DIR COLLECTION.xml "Book name (OpenStax, CC BY-NC-SA 4.0)" out.json [--chapters 1-12,15] [--sections a,b]
  then: IB_ADMIN=... IB_PASS=... python3 ib/bank.py add BOOK "Set name" out.json --upload

REPO_DIR = a clone of github.com/openstax/osbooks-*. Figures in problems link to the repo's media on GitHub.
Difficulty comes from the section: conceptual questions 1, problems/exercises 2, challenge/additional problems 3.
"""
import json, re, sys, xml.etree.ElementTree as ET

C = '{http://cnx.rice.edu/cnxml}'; M = '{http://www.w3.org/1998/Math/MathML}'; MD = '{http://cnx.rice.edu/mdml}'; COL = '{http://cnx.rice.edu/collxml}'
SEC = {'conceptual-questions': 1, 'review-conceptual-questions': 1, 'problems-exercises': 2, 'review-problems': 2, 'exercises': 2, 'section-exercises': 2,
       'review-exercises': 2, 'review-additional-problems': 3, 'review-challenge': 3, 'ap-test-prep': 2, 'practice': 1, 'homework': 2, 'bring-together-homework': 3, 'free-response': 2}
GREEK = {'α': r'\alpha', 'β': r'\beta', 'γ': r'\gamma', 'δ': r'\delta', 'Δ': r'\Delta', 'ε': r'\varepsilon', 'θ': r'\theta', 'λ': r'\lambda', 'μ': r'\mu', 'π': r'\pi',
         'ρ': r'\rho', 'σ': r'\sigma', 'Σ': r'\Sigma', 'τ': r'\tau', 'φ': r'\phi', 'ϕ': r'\phi', 'ω': r'\omega', 'Ω': r'\Omega', '×': r'\times', '·': r'\cdot', '−': '-', '≈': r'\approx',
         '≤': r'\le', '≥': r'\ge', '≠': r'\ne', '∞': r'\infty', '→': r'\to', '±': r'\pm', '°': r'^\circ', '∫': r'\int', '∑': r'\sum', '√': r'\sqrt{}', '⇌': r'\rightleftharpoons', '∝': r'\propto', '…': r'\ldots', '⋅': r'\cdot', '′': "'", 'ℓ': r'\ell', '∂': r'\partial', 'η': r'\eta', 'χ': r'\chi', 'ψ': r'\psi', 'ν': r'\nu', 'κ': r'\kappa', 'ζ': r'\zeta', 'ξ': r'\xi', 'Φ': r'\Phi', 'Γ': r'\Gamma', 'Λ': r'\Lambda', 'Ψ': r'\Psi', 'Θ': r'\Theta', '∈': r'\in', '∪': r'\cup', '∩': r'\cap', '⟶': r'\longrightarrow', '⟹': r'\Rightarrow', '⇒': r'\Rightarrow', '⟨': r'\langle', '⟩': r'\rangle'}
loc = lambda e: e.tag.split('}')[-1]

def tex(e):  # MathML -> LaTeX (the common elements OpenStax uses)
    t = loc(e); k = list(e); txt = lambda s: ''.join(GREEK.get(c, c) for c in (s or ''))
    if t in ('math', 'mrow', 'mstyle', 'semantics', 'mpadded', 'mphantom'): return ''.join(tex(x) for x in k if loc(x) not in ('annotation', 'annotation-xml'))
    if t == 'mi': s = txt(e.text).strip(); return s if len(s) <= 1 or s.startswith('\\') else r'\mathrm{' + s + '}'
    if t == 'mn': return txt(e.text).strip()
    if t == 'mo': s = txt(e.text).strip(); return {'(': '(', ')': ')', '{': r'\{', '}': r'\}'}.get(s, s if s.startswith('\\') else s)
    if t == 'mtext': s = (e.text or '').replace(' ', ' '); return s if re.fullmatch(r'[\d.]*', s.strip()) else r'\text{' + s + '}'
    if t == 'mspace': return r'\ '
    if t == 'msub': return '{' + tex(k[0]) + '}_{' + tex(k[1]) + '}'
    if t == 'msup': return '{' + tex(k[0]) + '}^{' + tex(k[1]) + '}'
    if t == 'msubsup': return '{' + tex(k[0]) + '}_{' + tex(k[1]) + '}^{' + tex(k[2]) + '}'
    if t == 'mfrac': return r'\frac{' + tex(k[0]) + '}{' + tex(k[1]) + '}'
    if t == 'msqrt': return r'\sqrt{' + ''.join(tex(x) for x in k) + '}'
    if t == 'mroot': return r'\sqrt[' + tex(k[1]) + ']{' + tex(k[0]) + '}'
    if t == 'mover': a = tex(k[1]); return (r'\vec{' if a in ('→', r'\to') else r'\overline{' if a in ('¯', '‾', '_') else r'\hat{' if a == '^' else r'\overset{' + a + '}{') + tex(k[0]) + '}'
    if t == 'munder': return r'\underset{' + tex(k[1]) + '}{' + tex(k[0]) + '}'
    if t == 'munderover': return '{' + tex(k[0]) + '}_{' + tex(k[1]) + '}^{' + tex(k[2]) + '}'
    if t == 'mfenced': o, c = e.get('open', '('), e.get('close', ')'); return r'\left' + (o if o not in '{' else r'\{') + ','.join(tex(x) for x in k) + r'\right' + (c if c not in '}' else r'\}')
    if t == 'mtable': return r'\begin{matrix}' + r'\\'.join('&'.join(tex(c) for c in r) for r in k) + r'\end{matrix}'
    if t in ('mtd', 'mtr', 'menclose'): return ''.join(tex(x) for x in k)
    return ''.join(tex(x) for x in k) or txt(e.text)

def md(e, media):  # CNXML -> Markdown
    t = loc(e); out = ''
    if t == 'math': s = re.sub(r'\s+', ' ', tex(e)).strip(); return f'$${s}$$' if e.get('display') == 'block' else f'${s}$'
    if t in ('figure', 'media'):
        im = e.find(f'.//{C}image'); cap = e.find(f'{C}caption')
        if im is not None: return f"\n\n![{(md(cap, media).strip() if cap is not None else 'figure')}]({media}{im.get('src').split('/')[-1]})\n\n"
    if t == 'list':
        lab = e.get('number-style') == 'lower-alpha'
        return '\n' + ''.join((f'{"abcdefghijklmnopqrstuvwxyz"[i % 26]}. ' if lab else '- ') + md(it, media).strip() + '\n' for i, it in enumerate(e.findall(f'{C}item'))) + '\n'
    if t == 'table':
        rows = [[md(c, media).strip().replace('\n', ' ') for c in r.findall(f'{C}entry')] for r in e.iter(f'{C}row')]
        if not rows: return ''
        w = max(len(r) for r in rows); rows = [r + [''] * (w - len(r)) for r in rows]
        return '\n\n' + '\n'.join(['| ' + ' | '.join(rows[0]) + ' |', '|' + '---|' * w] + ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]) + '\n\n'
    if t == 'equation': return '\n\n' + ''.join(md(x, media) for x in e).replace('$', '$$', 2).rstrip() + '\n\n' if e.find(f'{M}math') is not None else ''
    pre, post = {'emphasis': ('**', '**') if e.get('effect') == 'bold' else ('*', '*'), 'term': ('**', '**'), 'sup': ('^', ''), 'sub': ('~', ''), 'para': ('\n\n', '\n\n'), 'title': ('**', '**\n\n')}.get(t, ('', ''))
    if t in ('label',): return ''
    out = (e.text or '')
    for x in e: out += md(x, media) + (x.tail or '')
    out = out if t not in ('emphasis', 'term') or out.strip() else ''
    if t == 'link' and not out.strip(): return 'the ' + ('table' if 'table' in (e.get('target-id') or '').lower() else 'figure')
    if t == 'sup': return '<sup>' + out + '</sup>'
    if t == 'sub': return '<sub>' + out + '</sub>'
    return pre + out + post if out.strip() else out

own = lambda q: len(q) > 110 and bool(re.match(r'(?:\*\*[^*]*\*\*\s*)?(?:A|An|Suppose|Consider|You|Two|Three|If|In|The|Let|Assume|Given|When|Use|At|Find the (?:area|volume|length)|Sketch the graph of)\b', q)) and not re.search(r'\b(?:the|this|previous|preceding) (?:lifeguard|pool|previous|above|figure|graph|function|problem|exercise)\b', q[:60], re.I)
def walk(node, media, st):  # exercises in document order, each with the text/figures since the previous run of exercises (their shared setup)
    for ch in node:
        t = loc(ch)
        if t == 'exercise':
            st['seen'] = True; p = ch.find(f'{C}problem'); q = md(p, media).strip() if p is not None else ''
            if st['intro'] and own(q): st['intro'] = ''  # this problem sets up its own scenario, so the run of shared setup has ended
            yield ch, st['intro'].strip()
        elif t in ('para', 'figure', 'table', 'list', 'note', 'equation', 'media'):
            if st['seen']: st['intro'], st['seen'] = '', False
            st['intro'] += md(ch, media)
        elif t != 'title': yield from walk(ch, media, st)

def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    repo, coll, name, outf = a[:4]
    opt = lambda f: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else None
    chs = None
    if opt('--chapters'): chs = set(); [chs.update(range(int(p.split('-')[0]), int(p.split('-')[-1]) + 1)) for p in opt('--chapters').split(',')]
    secs = set(opt('--sections').split(',')) if opt('--sections') else set(SEC)
    gh = re.search(r'osbooks-[\w-]+', repo + ' ' + open(f'{repo}/.git/config').read() if __import__('os').path.exists(f'{repo}/.git/config') else repo)
    media = f'https://raw.githubusercontent.com/openstax/{gh.group(0) if gh else "osbooks"}/main/media/'
    root = ET.parse(coll).getroot(); out = []
    chapters = [sc for sc in root.iter(f'{COL}subcollection') if sc.find(f'{COL}content/{COL}subcollection') is None]
    for ci, sc in enumerate(chapters, 1):
        if chs and ci not in chs: continue
        title = sc.find(f'{MD}title').text; n = 0
        for mod in sc.iter(f'{COL}module'):
            try: doc = ET.parse(f"{repo}/modules/{mod.get('document')}/index.cnxml").getroot()
            except Exception: continue
            for s in doc.iter(f'{C}section'):
                cls = (s.get('class') or '').split()[0] if s.get('class') else ''
                if cls not in secs: continue
                for ex, intro in walk(s, media, {'intro': '', 'seen': False}):
                    p = ex.find(f'{C}problem'); sol = ex.find(f'{C}solution')
                    if p is None: continue
                    q = re.sub(r'\n{3,}', '\n\n', md(p, media)).strip(); ms = re.sub(r'\n{3,}', '\n\n', md(sol, media)).strip() if sol is not None else ''
                    if len(q) < 15: continue
                    n += 1; mc = bool(re.search(r'(?m)^a\. .*\n(b\. .*\n?)+', q)) and cls in ('ap-test-prep',)
                    ans = (re.search(r'\(?([a-e])\)?', ms) or [None, ''])[1].upper() if mc and ms else ''
                    if mc: q = re.sub(r'(?m)^([a-e])\. ', lambda m: m.group(1).upper() + '. ', q)
                    out.append({'text': q, 'ms': ms, 'kind': 'mcq' if mc else 'short' if SEC[cls] == 1 and cls != 'exercises' else 'structured', 'ans': ans, 'difficulty': str(SEC[cls]),
                                'marks': 1 if mc else 0, 'chapter': f'{ci} {title}', 'ctx': re.sub(r'\n{3,}', '\n\n', intro)})
        print(ci, title, n, flush=True)
    json.dump(out, open(outf, 'w'), indent=1, ensure_ascii=False); print(len(out), 'questions,', sum(1 for q in out if q['ms']), 'with answers ->', outf)

if __name__ == '__main__': main()
