#!/usr/bin/env python3
"""Validate a generated question file: python3 qbank/check.py FILE.json [more.json]  -> prints problems, or OK."""
import json, re, sys, os, subprocess, xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = {'chem': {'mcq', 'structured'}, 'phys': {'mcq', 'structured'}, 'math': {'mexam'}, 'glopo': {'short', 'p1', 'essay'}, 'tokc': {'discuss', 'essay'}}
MATHB = {'chem', 'phys', 'math'}
KJS = r"""const k=require('katex');require('katex/contrib/mhchem');let o=[];for(const [t,d] of JSON.parse(require('fs').readFileSync(0,'utf8'))){try{k.renderToString(t,{displayMode:d,throwOnError:true})}catch(e){o.push(t.slice(0,80)+'  -> '+e.message.slice(0,120))}}console.log(JSON.stringify(o))"""
def maths(s):  # same delimiters as the site (mathOut)
    out = []
    s = re.sub(r'\$\$([\s\S]+?)\$\$', lambda m: out.append((m.group(1), True)) or ' ', s)
    s = re.sub(r'\$([^\s$](?:[^$\n]*?[^\s$])?)\$', lambda m: out.append((m.group(1), False)) or ' ', s)
    return out, s
def main():
    probs, tex, n = [], [], 0
    ids = set()
    for f in sys.argv[1:]:
        try: qs = json.load(open(f))
        except Exception as e: print(f'{f}: not valid JSON: {e}'); sys.exit(1)
        if not isinstance(qs, list): print(f'{f}: must be a list'); sys.exit(1)
        for q in qs:
            n += 1; P = lambda m: probs.append(f"{q.get('id', '?')}: {m}")
            for k in ('id', 'book', 'kind', 'topic', 'tname', 'text', 'marks', 'ms', 'diff', 'src', 'set'):
                if q.get(k) in (None, ''): P('missing ' + k)
            b = q.get('book')
            if q.get('id') in ids: P('duplicate id')
            ids.add(q.get('id'))
            if not re.fullmatch(r'gen:[a-z]+:[A-Za-z0-9.]+:\d+', str(q.get('id', ''))): P('id must look like gen:book:TOPIC:n')
            if b in KINDS and q.get('kind') not in KINDS[b]: P(f"kind {q.get('kind')} not allowed for {b}")
            if not isinstance(q.get('marks'), int) or q.get('marks', 0) < 1: P('marks must be a positive integer')
            if q.get('diff') not in (1, 2, 3): P('diff must be 1, 2 or 3')
            if q.get('src') != 'gen': P("src must be 'gen'")
            t = q.get('text', '')
            if q.get('kind') == 'mcq':
                if q.get('marks') != 1: P('mcq marks must be 1')
                if q.get('ans') not in ('A', 'B', 'C', 'D'): P('mcq needs ans A-D')
                opts = re.findall(r'(?m)^([A-D])\. ', t)
                if opts != ['A', 'B', 'C', 'D']: P(f'mcq needs options A. B. C. D. each on its own line (found {opts})')
            else:
                pm = [int(x) for x in re.findall(r'\[(\d{1,2})\]', t)]
                if pm and sum(pm) != q.get('marks'): P(f"part marks {pm} add to {sum(pm)}, not marks={q.get('marks')}")
                if not pm and q.get('kind') in ('structured', 'mexam'): P('structured/mexam text should show marks like [3] after each part')
            if b == 'math' and q.get('calc') not in ('yes', 'no'): P("maths needs calc 'yes' or 'no'")
            if b == 'math' and str(q.get('paper')) not in ('1', '2'): P("maths needs paper '1' or '2'")
            for fld in ('text', 'ms', 'ctx'):
                v = q.get(fld) or ''
                for img in re.findall(r'!\[[^\]]*\]\(([^)]+)\)', v):
                    path = os.path.join(ROOT, img)
                    if not img.startswith('qbank/img/') or not os.path.exists(path): P(f'image not found: {img}')
                    else:
                        try: r = ET.parse(path).getroot(); assert r.tag.endswith('svg')
                        except Exception as e: P(f'bad SVG {img}: {e}')
                if b in MATHB:
                    m, rest = maths(v); tex += [(x, d, q.get('id')) for x, d in m]
                    if rest.count('$') % 2: P(f'{fld}: unmatched or badly spaced $ (no spaces just inside $...$)')
                elif '$' in v and b in ('glopo', 'tokc'): P(f'{fld}: no $ in Global Politics / TOK (write "dollars" or US$)')
    if tex:
        r = subprocess.run(['node', '-e', KJS], input=json.dumps([[t, d] for t, d, _ in tex]), capture_output=True, text=True, cwd='/home/user/qtools')
        try: probs += ['LaTeX error: ' + x for x in json.loads(r.stdout)]
        except Exception: probs.append('could not run KaTeX check: ' + r.stderr[:300])
    print('\n'.join(probs) if probs else f'OK ({n} questions)')
if __name__ == '__main__': main()
