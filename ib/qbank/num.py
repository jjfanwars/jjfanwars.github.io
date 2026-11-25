#!/usr/bin/env python3
"""Build qbank/num.json: the checkable final numerical answers of the IB-style questions (used by the app's
"Final answer check", numCheck in ib/index.html).

num.json = {question id: {"parts": [part, ...], "all": 1 when every marked part of the question is listed}}
part = {"p": "(a)" | "(b)(i)" | "" (unlabelled question),
        "v": number | [numbers] (several answers, any order) ,
        "u": "unit" | "" (plain text: "m s^-1", "J kg^-1 K^-1", "°C", "%", "rad"),
        "sf": significant figures the question asks for (else IB default, 3 s.f. with leniency),
        "dp": decimal places the question asks for,
        "tol": relative tolerance (default: half a unit in the last digit given in the markscheme),
        "r": [lo, hi] accepted range (graph readings, "accept 0.76-0.84"),
        "alt": ["exact forms in LaTeX"], "ex": 1 if an exact value is asked for, "pt": 1 if v is an ordered point / pair,
        "m": marks for the part}

How it is made:
  1. a first pass over the markscheme (`ms`) of every structured / maths question: the question and the markscheme are
     split into parts, parts whose command term asks for a value (calculate, determine, find, ...) are kept, and the
     value on the final marking line is read (sciences: the last line with a tick, maths: the last A1 line);
  2. every candidate was then reviewed by hand against its question and markscheme. FIX holds the corrections
     (replaced fields), DROP the parts with no single checkable number (expressions, two different quantities in one
     answer, "show that", reasons, equations, ...) and ADD parts the first pass missed.
Run:  python3 ib/qbank/num.py            (writes ib/qbank/num.json)
      python3 ib/qbank/num.py --review   (prints the first-pass candidates with the corrections applied)
"""
import json, re, sys, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
BOOKS = ['phys', 'math', 'chem']
ROMAN = r'(?:i|ii|iii|iv|v|vi|vii)'
CALC = re.compile(r'\b(calculate|determine|find|estimate|evaluate|solve|write down|work out|state the value|state the number|predict the value|deduce the value|hence find|hence calculate|hence determine|deduce)\b', re.I)
NOTNUM = re.compile(r'\b(show that|prove|sketch|explain|verify|draw|plot|describe|suggest|outline|discuss|justify|comment|label|annotate|construct|equation|expression|in terms of|coordinates|general|the set of|range of|domain|inverse|derivative|gradient function|integral of|simplify|expand|factori[sz]e|formula|name|structure|identify|whether|reason|type|which|shape|geometry|order of reaction|units|interpret|vector|matrix|hybridi[sz]ation|configuration|form a\b|in the form)\b', re.I)


def parts_of(text):
    """Split text into [(label, body)] with labels like '(a)', '(b)(i)'; [('', text)] when unlabelled."""
    out, cur, buf, letter = [], None, [], None
    pat = re.compile(r'^\s*[-*]*\s*\**\s*\(([a-h])\)\s*\**\s*(?:\(\s*(' + ROMAN + r')\s*\)\s*\**)?|^\s*[-*]*\s*\**\s*\((' + ROMAN + r')\)\s*\**')
    for line in text.split('\n'):
        m = pat.match(line)
        if m:
            if m.group(1):
                letter = m.group(1); lab = '(' + letter + ')' + ('(' + m.group(2) + ')' if m.group(2) else '')
            else:
                lab = ('(' + letter + ')' if letter else '') + '(' + m.group(3) + ')'
            if cur is not None or buf: out.append((cur or '', '\n'.join(buf)))
            cur, buf = lab, [line[m.end():]]
        else:
            buf.append(line)
    out.append((cur or '', '\n'.join(buf)))
    if len(out) > 1 and out[0][0] == '': out = out[1:]
    return out


def marks_of(body):
    m = re.findall(r'\[(\d+)\]', body)
    return int(m[-1]) if m else 0


# ---- a small LaTeX number evaluator (only digits, fractions, roots, pi, e, ln, powers) ----
def tex_eval(s):
    s = s.replace('−', '-').replace('\\left', '').replace('\\right', '').replace('\\ldots', '').replace('\\dots', '').replace('\\!', '')
    s = re.sub(r'(\d)\\,(\d)', r'\1\2', s); s = re.sub(r'(\d)\\,(\d)', r'\1\2', s); s = re.sub(r'(\d) (\d{3})\b', r'\1\2', s)
    s = s.replace('\\,', '').replace('\\ ', ' ').replace('\\displaystyle', '')
    for _ in range(4): s = re.sub(r'\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}', r'((\1)/(\2))', s)
    s = re.sub(r'\\[dt]?frac(\d)(\d)', r'(\1/\2)', s)
    for _ in range(3): s = re.sub(r'\\sqrt\s*\[(\d+)\]\s*\{([^{}]*)\}', r'((\2)**(1/\1))', s); s = re.sub(r'\\sqrt\s*\{([^{}]*)\}', r'sqrt(\1)', s)
    s = re.sub(r'\\sqrt\s*(\d+)', r'sqrt(\1)', s)
    s = s.replace('\\pi', 'pi').replace('\\times', '*').replace('\\cdot', '*').replace('\\ln', 'log').replace('{', '(').replace('}', ')').replace('^', '**')
    s = s.replace('%', '').strip()
    if re.search(r'[^0-9.+\-*/() a-z]', s) or re.search(r'[a-z]+', s.replace('sqrt', '').replace('pi', '').replace('log', '').replace('e', '')): return None
    s = re.sub(r'(\d|\))\s*(sqrt|pi|log|\()', r'\1*\2', s); s = re.sub(r'(pi)\s*(\d|\()', r'\1*\2', s)
    s = re.sub(r'\be\b', 'E_', s)
    try: return float(eval(s, {'__builtins__': {}}, {'sqrt': math.sqrt, 'pi': math.pi, 'log': math.log, 'E_': math.e}))
    except Exception: return None


def digits_sf(s):
    s = s.replace('−', '-').replace('\\,', '').replace(' ', '')
    m = re.match(r'-?(\d+(?:\.\d+)?)', s)
    if not m: return None
    d = m.group(1); n = d.replace('.', '').lstrip('0')
    if '.' not in d: n = n.rstrip('0') or n
    return max(1, len(n))


UNIT_TX = [(r'\\text\{\s*([^}]*)\}', r'\1'), (r'\\mathrm\{\s*([^}]*)\}', r'\1'), (r'\^\{([^}]*)\}', r'^\1'), (r'\\Omega', 'Ω'), (r'\\mu\s*', 'µ'),
           (r'\^\s*\\circ\s*', '°'), (r'\\circ', '°'), (r'\\%', '%'), (r'\\ ', ' '), (r'\\,', ' '), (r'~', ' '), (r'\\', '')]
UNITW = re.compile(r'^\s*(Ω|°C|°|%|MeV|keV|GeV|eV|kWh|ppm|mol|light-years|light years|ly|pc|AU|cm\^?[23]?|mm|km|m|kg|g|s|min|h|hours|years|Hz|N|J|W|V|A|K|Pa|kPa|rad)(?![a-z])')


def unit_clean(u):
    for a, b in UNIT_TX: u = re.sub(a, b, u)
    u = re.sub(r'\s+', ' ', u).strip().strip('$').strip()
    u = re.sub(r'^°\s*C', '°C', u).replace('ohm', 'Ω')
    return u


NOTE = re.compile(r'\((?:[^()]*\b(?:accept|allow|ECF|or|award|i\.e\.|e\.g\.|from|using)\b[^()]*)\)|\*[^*]+\*|\b(?:Accept|Allow|Award|Do not|ECF|OR)\b.*$', re.I)


def read_value(line, book):
    """value, unit, sf, precise value from a final marking line"""
    seg = line.split('A1')[0] if book == 'math' else line.split('✓')[0]
    after = line[len(seg):]
    prec = None
    pm = re.search(r'\(\s*\$?\s*([-−]?\d[\d.,\\ ]*?)\s*(?:\\ldots|…|\.\.\.)?\s*\$?\s*\)', seg)
    seg0 = NOTE.sub('', seg)
    maths = re.findall(r'\$([^$]+)\$', seg0)
    plain = re.sub(r'\$[^$]*\$', ' § ', seg0)
    cand = [m for m in maths if re.search(r'\d', m) and not re.fullmatch(r'\s*\(?\s*[-−]?\d[\d.,\\ ]*(?:\\ldots)?\s*\)?\s*', m) or re.fullmatch(r'\s*[-−+]?\d[\d.,\\ ]*(?:\\times\s*10\^\{?[-−]?\d+\}?)?\s*(?:\\ )?(?:\\text\{[^}]*\}.*)?', m)]
    if not cand:
        m = re.search(r'([-−]?\d+(?:\.\d+)?)\s*(Ω|°C|°|%|[a-zA-Z]+(?:\^?-?\d)?)?', re.sub(r'\$[^$]*\$', '', seg0))
        if not m: return None
        txt, unit = m.group(1), m.group(2) or ''
    else:
        expr = cand[-1]
        expr = re.split(r'=|\\approx|\\Rightarrow|\\to\b|\\geq|\\leq|>|<', expr)[-1]
        mm = re.match(r'\s*([-−+]?[^a-zA-Z\\]*?(?:\\[dt]?frac\{[^{}]*\}\{[^{}]*\}|\\sqrt\{[^{}]*\}|\\pi|\\times\s*10\^\{?[-−]?\d+\}?|[\d.()+\-−*/^{} ]|\\,)*)(.*)$', expr)
        txt, unit = mm.group(1), mm.group(2)
        unit = unit_clean(unit)
        if not unit:  # unit written after the maths
            tail = plain.split('§')[-1] if '§' in plain else ''
            um = UNITW.match(tail)
            if um: unit = um.group(1)
    v = tex_eval(txt.strip().lstrip('+'))
    if v is None: return None
    if pm:
        pv = tex_eval(pm.group(1).replace(',', ''))
        if pv is not None and v and abs(pv - v) / abs(v) < 0.02 and digits_sf(pm.group(1)) and digits_sf(pm.group(1)) > (digits_sf(txt) or 0): prec = pv
    return v, unit, digits_sf(txt) if re.fullmatch(r'\s*[-−+]?[\d.\\, ]+(?:\\times\s*10\^\{?[-−]?\d+\}?)?\s*', txt) else None, prec, ('\\frac' in txt or '\\sqrt' in txt or '\\pi' in txt) and txt.strip()


def rng(ms, v):
    best = None
    for m in re.finditer(r'accept(?: answers in the range)?\s*(?:\$?\s*)([-−]?\d+(?:\.\d+)?)(?:\s*\\times\s*10\^\{?([-−]?\d+)\}?)?\s*\$?\s*(?:–|-|to)\s*\$?\s*([-−]?\d+(?:\.\d+)?)(?:\s*\\times\s*10\^\{?([-−]?\d+)\}?)?', ms, re.I):
        e2 = int((m.group(4) or m.group(2) or '0').replace('−', '-')); e1 = int((m.group(2) or m.group(4) or '0').replace('−', '-'))
        lo, hi = float(m.group(1).replace('−', '-')) * 10 ** e1, float(m.group(3).replace('−', '-')) * 10 ** e2
        lo, hi = sorted((rnd(lo), rnd(hi)))
        if lo <= v <= hi and (not best or hi - lo > best[1] - best[0]): best = [lo, hi]
    return best


def rnd(x): return float('%.10g' % x)


def first_pass():
    res = {}
    for b in BOOKS:
        for q in json.load(open(os.path.join(HERE, b + '.json'))):
            if q['kind'] == 'mcq': continue
            tp = parts_of(q['text']); mp = dict(parts_of(q['ms']))
            cands = []
            for lab, body in tp:
                first = re.split(r'(?<=[.?])\s', body.strip(), maxsplit=1)[0]
                if not CALC.search(first) or NOTNUM.search(first): continue
                ms = mp.get(lab, '') or (q['ms'] if len(tp) == 1 else '')
                lines = [l for l in ms.split('\n') if l.strip()]
                pick = None
                for l in reversed(lines):
                    if re.match(r'\s*(?:\*|Note|_)', l): continue
                    if (re.search(r'\bA1\b', l) if b == 'math' else '✓' in l): pick = l; break
                if not pick: continue
                r = read_value(pick, b)
                if not r: continue
                v, unit, sf, prec, exact = r
                c = {'p': lab, 'v': rnd(prec if prec is not None else v), 'u': unit, 'm': marks_of(body), '_k': sf, '_q': first[:170], '_ms': pick.strip()[:220]}
                if prec is not None: c['_k'] = None
                if exact: c['alt'] = [exact]
                if b == 'math' and re.search(r'\bexact\b', body + q['text'][:200], re.I): c['ex'] = 1
                dm = re.search(r'correct to (one|two|three|four|1|2|3|4) decimal places?', body + ' ' + q['text'], re.I)
                if dm: c['dp'] = {'one': 1, 'two': 2, 'three': 3, 'four': 4}.get(dm.group(1).lower(), None) or int(dm.group(1))
                sm = re.search(r'(?:correct to|to) (two|three|four|2|3|4) (?:significant figures|s\.\s?f\.)', body, re.I)
                if sm: c['sf'] = {'two': 2, 'three': 3, 'four': 4}.get(sm.group(1).lower(), None) or int(sm.group(1))
                rr = rng(ms, c['v'])
                if rr: c['r'] = rr
                cands.append(c)
            if cands: res[q['id']] = cands
    return res


def tol_for(c, book):
    """relative tolerance from the precision the markscheme gives (half a unit in the last digit), sciences >= 2 s.f."""
    v = c['v']
    if isinstance(v, list) or c.get('tol') is not None: return c.get('tol')
    k = c.get('_k')
    if book == 'math' and k is not None and float(v).is_integer(): return 1e-9  # integers in maths are exact (sums, counts, k = 3)
    if v == 0: return None
    if k is None: return 0.005 if book != 'math' else None  # precise value: the app's rounding rule decides
    if book != 'math': k = max(k, 2)
    h = 0.5 * 10 ** (math.floor(math.log10(abs(v))) - k + 1)
    t = h / abs(v) * 1.05
    return float('%.3g' % (max(t, 0.005) if book != 'math' else t))


# ---- hand review (see the docstring) ----
PI = math.pi
FIX = {
    # physics
    'gen:phys:A.1:7 (b)': {'r': [0.76, 0.84]},
    'gen:phys:A.1:9 (a)': {'v': [14.7, 10.3], 'tol': 0.006},  # horizontal and vertical components
    'gen:phys:A.1:10 (b)': {'u': 'm s^-1', 'abs': 0.05},
    'gen:phys:A.3:8 (a)': {'v': 1025, 'tol': 0.003, '_k': None},
    'gen:phys:A.4:6 (b)': {'r': [0.019, 0.021]},
    'gen:phys:A.4:7 (c)': {'v': 12.73, 'tol': 0.003, '_k': None},  # 80/(2 pi) revolutions, accept 13
    'gen:phys:B.4:9 (a)': {'tol': 0.009},
    'gen:phys:C.1:6 (b)(i)': {'r': [0.476, 0.478]},
    'gen:phys:C.1:9 (b)': {'r': [14.7, 15.4]},
    'gen:phys:C.1:9 (c)': {'r': [0.81, 0.83]},
    # chemistry
    'gen:chem:S1.2:6 (a)': {'dp': 2},
    'gen:chem:S1.2:9 (a)': {'v': [19, 81]},  # % abundances of 10B and 11B
    'gen:chem:S1.4:6 (a)': {'v': [0.243, 0.162]},  # masses of Mg and O
    'gen:chem:S2.2:12 (d)': {'v': 0, 'abs': 0.01},  # formal charge on S in SF4
    'gen:chem:S2.4:5 (b)': {'u': ''},  # Vickers hardness HV
    'gen:chem:R1.1:7 (b)': {'v': 1504.8, '_k': None},
    'gen:chem:R1.1:8 (d)': {'v': 11.4, 'r': [10.9, 11.5]},
    'gen:chem:R1.4:8 (b)': {'r': [6.0e5, 7.0e5]},
    'gen:chem:R2.1:6 (f)': {'r': [0.46, 0.5]},
    'gen:chem:R2.1:7 (b)': {'v': [1.26, 1.20]},  # water removed, anhydrous salt
    'gen:chem:R2.3:7 (c)': {'v': [0.0335, 0.0665, 0.0665], 'tol': 0.004},
    'gen:chem:R2.3:9 (b)': {'v': [0.111, 0.111, 0.778], 'tol': 0.005},
    'gen:chem:R3.1:10 (d)': {'v': 12.70, 'u': '', 'tol': 0.0008},
    'gen:chem:R3.1:11 (b)': {'v': 11.21, 'u': '', 'tol': 0.0008},
    'gen:chem:R3.1:11 (d)': {'v': 4.97, 'u': '', 'tol': 0.002},
    # maths
    'gen:math:SL1.1:2 (a)': {'tol': 0.001},  # 498.99... s
    'gen:math:SL1.1:2 (c)': {'u': ''},
    'gen:math:SL1.1:3 (b)': {'v': 333000, 'tol': 0.0016, '_k': None},
    'gen:math:SL1.2:3 (c)': {'u': ''},
    'gen:math:SL1.2:4 (e)(i)': {'v': 31, 'u': '', '_k': 2},
    'gen:math:SL1.3:5 (a)': {'u': 'm'}, 'gen:math:SL1.3:5 (b)': {'u': 'm'},
    'gen:math:SL1.3:6 (a)': {'u': 'km'}, 'gen:math:SL1.3:6 (b)': {'u': 'km'},
    'gen:math:SL1.4:2 (a)': {'v': 14798.71, '_k': None},
    'gen:math:SL1.4:3 (a)': {'v': 14467.90, '_k': None},
    'gen:math:SL1.4:4 (b)': {'v': 13107.20, '_k': None},
    'gen:math:SL1.4:5 (e)': {'u': ''},
    'gen:math:SL1.7:5 (c)': {'v': [81, 1 / 81]},
    'gen:math:SL1.8:3 (c)': {'v': 80 + 40 * math.sqrt(2), 'u': 'cm', 'alt': ['80+40\\sqrt{2}'], '_k': None},
    'gen:math:SL1.8:4 (a)': {'u': 'cm'},
    'gen:math:SL1.9:4 (a)': {'v': 3},
    'gen:math:SL2.2:2 (a)': {'u': ''},
    'gen:math:SL2.4:1 (b)': {'u': ''},
    'gen:math:SL2.5:6 (d)(ii)': {'v': [0, 2]},
    'gen:math:SL2.5:6 (e)': {'v': (7 + math.sqrt(5)) / 2, 'alt': ['\\frac{7+\\sqrt{5}}{2}'], '_k': None},
    'gen:math:SL2.6:4 (b)': {'v': [2, 4]},
    'gen:math:SL2.9:3 (b)': {'u': ''}, 'gen:math:SL2.9:3 (c)': {'u': 'min'}, 'gen:math:SL2.9:5 (d)': {'u': 'years'},
    'gen:math:SL2.11:4 (c)': {'v': 0.5 * math.log(3), 'u': '', 'alt': ['\\frac{1}{2}\\ln 3'], '_k': None},
    'gen:math:SL2.11:6 (d)': {'v': 1 + math.exp(0.5), 'alt': ['1+e^{\\frac{1}{2}}'], '_k': None},
    'gen:math:SL3.1:1 (a)': {'v': [0, -4]},
    'gen:math:SL3.1:2 (b)': {'alt': ['100\\pi']}, 'gen:math:SL3.1:2 (c)': {'alt': ['90\\pi']},
    'gen:math:SL3.1:3 (b)': {'alt': ['\\sqrt{125}', '5\\sqrt{5}']},
    'gen:math:SL3.1:5 (a)': {'alt': ['108\\pi']}, 'gen:math:SL3.1:5 (b)': {'alt': ['87\\pi']},
    'gen:math:SL3.2:11 (a)': {'v': [PI / 6, 5 * PI / 6], 'u': 'rad', 'alt': ['\\frac{\\pi}{6}', '\\frac{5\\pi}{6}']},
    'gen:math:SL3.2:12 (b)': {'v': 3},
    'gen:math:SL3.4:22 (b)': {'alt': ['6\\sqrt{3}']}, 'gen:math:SL3.4:22 (d)': {'alt': ['8\\pi']},
    'gen:math:SL3.5:26 (c)': {'v': [PI / 4, 3 * PI / 4], 'alt': ['\\frac{\\pi}{4}', '\\frac{3\\pi}{4}']},
    'gen:math:SL3.6:32 (b)(i)': {'v': PI / 2, '_k': None},
    'gen:math:SL3.7:34 (c)': {'v': PI / 2, '_k': None},
    'gen:math:SL3.7:34 (d)': {'v': [2 / 3, 10 / 3], 'u': ''},
    'gen:math:SL3.7:37 (c)': {'v': [PI / 3, 2 * PI / 3], 'u': '', 'alt': ['\\frac{\\pi}{3}', '\\frac{2\\pi}{3}']},
    'gen:math:SL4.3:4 (a)': {'v': [1, 6, 7, 8, 8], 'u': ''},
    'gen:math:SL4.4:4 (d)': {'r': [197.8, 198.2]},
    'gen:math:SL4.9:5 (b)': {'u': 'mm'}, 'gen:math:SL4.12:4 (b)': {'u': 'g'}, 'gen:math:SL4.12:4 (c)': {'u': 'g'},
    'gen:math:SL5.4:4 (a)': {'v': [4, -8]},
    'gen:math:SL5.5:2 (a)': {'v': [0, 4]},
    'gen:math:SL5.9:1 (b)': {'v': [(5 - math.sqrt(13)) / 2, (5 + math.sqrt(13)) / 2], 'alt': ['\\frac{5-\\sqrt{13}}{2}', '\\frac{5+\\sqrt{13}}{2}']},
    'gen:math:SL5.11:5 (d)': {'v': 4 * math.log(2) - 1.5, 'u': '', 'alt': ['4\\ln 2-\\frac{3}{2}'], '_k': None},
}
DROP = {
    'gen:chem:S2.2:11 (b)', 'gen:chem:R1.3:7 (a)', 'gen:chem:R1.3:7 (b)', 'gen:chem:R1.4:8 (c)', 'gen:chem:R3.1:9 (c)', 'gen:chem:R3.3:7 (b)',
    'gen:math:SL1.2:2 (a)', 'gen:math:SL1.5:4 (a)', 'gen:math:SL2.5:3 (a)', 'gen:math:SL2.6:4 (a)', 'gen:math:SL2.6:5 (b)', 'gen:math:SL2.7:1 (b)',
    'gen:math:SL2.8:5 (e)', 'gen:math:SL2.11:5 (a)', 'gen:math:SL3.4:21 (b)', 'gen:math:SL4.2:1 (a)', 'gen:math:SL4.2:2 (b)', 'gen:math:SL4.2:2 (d)',
    'gen:math:SL4.6:4 (a)', 'gen:math:SL4.7:4 (a)', 'gen:math:SL4.7:5 (a)', 'gen:math:SL4.8:4 (a)', 'gen:math:SL4.8:5 (a)', 'gen:math:SL4.10:2 (a)',
    'gen:math:SL4.12:2 (a)', 'gen:math:SL4.12:3 (a)', 'gen:math:SL5.1:2 (b)', 'gen:math:SL5.2:1 (a)', 'gen:math:SL5.3:3 (c)', 'gen:math:SL5.4:1 (a)',
    'gen:math:SL5.5:1 (b)', 'gen:math:SL5.7:1 (a)', 'gen:math:SL5.8:1 (a)', 'gen:math:SL5.8:2 (c)', 'gen:math:SL5.8:3 (b)', 'gen:math:SL5.10:2 (a)',
    'gen:math:SL2.5:2 (c)', 'gen:math:SL2.6:5 (c)', 'gen:math:SL3.6:32 (c)',
}
ADD = {
    'gen:phys:A.1:7 (a)': {'v': 0.2, 'u': 's^2', 'm': 2, '_k': 2},
}


def merged():
    fp = first_pass(); out = {}
    for qid, cs in fp.items():
        for c in cs:
            key = qid + ' ' + (c['p'] or '-')
            if key in DROP: continue
            if key in FIX: c = {**c, **FIX[key]}
            out.setdefault(qid, []).append(c)
    for key, c in ADD.items():
        qid, _, lab = key.partition(' ')
        out.setdefault(qid, []).append({'p': '' if lab == '-' else lab, **c})
    for key in list(FIX) + list(DROP):
        qid, _, lab = key.partition(' ')
        if not any((c['p'] or '-') == lab for c in fp.get(qid, [])): print('warning: reviewed part not found', key, file=sys.stderr)
    return out


def build():
    qs = {q['id']: q for b in BOOKS for q in json.load(open(os.path.join(HERE, b + '.json')))}
    out = {}
    for qid, cs in merged().items():
        q = qs[qid]; b = q['book']; tp = parts_of(q['text']); labs = [l for l, _ in tp]
        parts = []
        for c in sorted(cs, key=lambda c: labs.index(c['p']) if c['p'] in labs else 99):
            p = {'p': c['p'], 'v': c['v'], 'u': c.get('u', '')}
            t = tol_for(c, b)
            if t is not None: p['tol'] = t
            for k in ('sf', 'dp', 'r', 'alt', 'ex', 'pt', 'm', 'abs'):
                if c.get(k) not in (None, '', []): p[k] = c[k]
            if isinstance(p['v'], float) and p['v'].is_integer() and abs(p['v']) < 1e15: p['v'] = int(p['v'])
            parts.append(p)
        o = {'parts': parts}
        marked = [l for l, bd in tp if marks_of(bd)] or ['']
        if set(marked) <= {p['p'] for p in parts}: o['all'] = 1
        out[qid] = o
    return out


if __name__ == '__main__':
    if '--review' in sys.argv:
        only = [a for a in sys.argv[1:] if not a.startswith('--')]
        for qid, cs in merged().items():
            if only and not any(qid.startswith(o) for o in only): continue
            for c in cs:
                ex = ''.join(f' {k}={c[k]}' for k in ('sf', 'dp', 'r', 'alt', 'ex', 'pt') if c.get(k))
                print(f"{qid[4:]} {c['p'] or '-'} [{c.get('m', '')}] => {c['v']!r} {c.get('u', '')!r} k{c.get('_k')}{ex} | Q: {c.get('_q', '')[:150]} | MS: {c.get('_ms', '')[:170]}")
    else:
        out = build()
        json.dump(out, open(os.path.join(HERE, 'num.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
        print(len(out), 'questions,', sum(len(o['parts']) for o in out.values()), 'parts')
