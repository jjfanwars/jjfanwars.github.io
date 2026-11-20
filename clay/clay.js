/* Clay: a small programming language built for AI to write.
   Interpreter in plain JS. Works in the browser (window.Clay) and in node (module.exports). */
(function (G) {
'use strict';

// ---------- errors ----------
class ClayError extends Error {
  constructor(code, msg, pos, hint, detail) { super(msg); this.code = code; this.pos = pos ? { line: pos.line, col: pos.col } : null; this.hint = hint || ''; this.detail = detail || ''; this.trace = null; }
}
const err = (code, msg, pos, hint, detail) => new ClayError(code, msg, pos, hint, detail);

const KW = new Set('let var fn ret if elif else while for in break continue true false and or not type test assert none'.split(' '));
const BASE_TYPES = new Set(['int', 'float', 'str', 'bool', 'list', 'map', 'fn', 'any', 'none']);
const CMP = new Set(['==', '!=', '<', '<=', '>', '>=']);

// habits from other languages, mapped to the Clay way
const FOREIGN = {
  return: 'ret', function: 'fn', def: 'fn', func: 'fn', fun: 'fn', const: 'let', null: 'none', nil: 'none', None: 'none',
  undefined: 'none', True: 'true', False: 'false', class: 'type', struct: 'type', elsif: 'elif', switch: 'if / elif / else',
  match: 'if / elif / else', foreach: 'for x in xs', unless: 'if not', until: 'while not', lambda: 'fn(x: int) -> int { ret x }',
  this: 'a normal parameter', self: 'a normal parameter', echo: 'print(x)', puts: 'print(x)', println: 'print(x)', console: 'print(x)',
  length: 'len(x)', size: 'len(x)', count: 'len(x)', append: 'push(xs, v)', add: 'push(xs, v)', toString: 'str(x)', String: 'str(x)',
  parseInt: 'int(s)', Number: 'float(x)', includes: 'contains(x, v)', has_key: 'has(m, k)', remove: 'del(xs, i)', delete: 'del(m, k)',
  range: 'a..b (for i in 0..10)', input: 'nothing (Clay programs take no input)', printf: 'print("{x}")', format: '"{x}" string interpolation',
  indexOf: 'index_of(x, v)', toUpperCase: 'upper(s)', toLowerCase: 'lower(s)', strip: 'trim(s)', concat: 'a + b',
  sorted: 'sort(xs)', reversed: 'reverse(xs)', items: 'keys(m)', forEach: 'for x in xs', Math: 'abs / sqrt / pow / floor'
};
const FOREIGN_TYPES = { string: 'str', String: 'str', number: 'int or float', integer: 'int', Int: 'int', double: 'float', Float: 'float', boolean: 'bool', Bool: 'bool', array: 'list', List: 'list', dict: 'map', Map: 'map', object: 'map or your own type', void: 'none, or leave out -> T', Any: 'any' };
const STMT_FOREIGN = new Set(['return', 'function', 'def', 'func', 'const', 'class', 'struct', 'switch', 'match', 'foreach', 'unless', 'until', 'elsif']);

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = []; for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function closest(name, cands) {
  let best = null, bd = name.length > 3 ? 3 : 2;
  for (const c of cands) { if (c === name) continue; const d = lev(name.toLowerCase(), c.toLowerCase()); if (d < bd) { bd = d; best = c; } }
  return best;
}

// ---------- lexer ----------
function lex(src, line0, col0) {
  const T = []; let i = 0, line = line0 || 1, col = col0 || 1; const stack = [];
  const add = (t, v, p, o) => T.push({ t, v, line: p.line, col: p.col, o, e: i });
  const BAD = {
    '&': 'use and', '|': 'use or', '!': 'use not (and != for not-equal)', "'": 'strings use double quotes: "like this"',
    ';': 'end a statement with a new line instead of ;', '?': 'there is no ?: operator; use if / elif / else',
    '`': 'strings use double quotes; put values inside with "{x}"', '@': 'remove it', '$': 'put values in strings with "{x}"', '^': 'use pow(a, b)'
  };
  while (i < src.length) {
    const c = src[i], p = { line, col }, o = i;
    if (c === '\n') {
      const top = stack[stack.length - 1];
      if (top !== '(' && top !== '[' && T.length && T[T.length - 1].t !== 'nl') add('nl', '\n', p, o);
      i++; line++; col = 1; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') { i++; col++; } continue; }
    if (c === '/' && (src[i + 1] === '*' || (src[i + 1] === '/' && src[i + 2] === ' ' && (!T.length || T[T.length - 1].t === 'nl'))))
      throw err('E102', 'comments start with #', p, 'write # comment');
    if (c >= '0' && c <= '9') {
      let j = i; while (j < src.length && /[0-9_]/.test(src[j])) j++;
      let isF = false;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { isF = true; j++; while (j < src.length && /[0-9_]/.test(src[j])) j++; }
      if (/[A-Za-z_]/.test(src[j] || '')) throw err('E102', `bad number '${src.slice(i, j + 1)}'`, p, 'names cannot start with a digit; floats look like 1.5');
      const text = src.slice(i, j).replace(/_/g, '');
      col += j - i; i = j;
      add(isF ? 'float' : 'int', isF ? parseFloat(text) : BigInt(text), p, o); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j); col += j - i; i = j;
      add(KW.has(w) ? 'kw' : 'id', w, p, o); continue;
    }
    if (c === '"') {
      const parts = []; let s = ''; i++; col++;
      for (;;) {
        if (i >= src.length || src[i] === '\n') throw err('E101', 'string is missing its closing "', p, 'strings stay on one line; use \\n for a line break');
        const d = src[i];
        if (d === '"') { i++; col++; break; }
        if (d === '\\') {
          const n = src[i + 1]; const m = { n: '\n', t: '\t', '"': '"', '\\': '\\', '{': '{', '}': '}' }[n];
          if (m === undefined) throw err('E101', `unknown escape \\${n || ''}`, { line, col }, 'escapes are \\n \\t \\" \\\\ \\{ \\}');
          s += m; i += 2; col += 2; continue;
        }
        if (d === '{') {
          const ip = { line, col: col + 1 }; let j = i + 1, depth = 1;
          while (j < src.length && src[j] !== '\n') {
            if (src[j] === '"') { j++; while (j < src.length && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } }
            else if (src[j] === '{') depth++;
            else if (src[j] === '}' && --depth === 0) break;
            j++;
          }
          if (src[j] !== '}') throw err('E101', 'string has a { with no matching }', { line, col }, 'write \\{ for a literal brace');
          const code = src.slice(i + 1, j);
          if (!code.trim()) throw err('E101', 'empty {} in a string', { line, col }, 'put an expression inside, or write \\{\\} for literal braces');
          if (s) parts.push(s); s = '';
          parts.push({ code, line: ip.line, col: ip.col });
          col += j + 1 - i; i = j + 1; continue;
        }
        if (d === '}') throw err('E101', 'unmatched } in a string', { line, col }, 'write \\} for a literal brace');
        s += d; i++; col++;
      }
      if (s || !parts.length) parts.push(s);
      add('str', parts, p, o); continue;
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (three === '===' || three === '!==') throw err('E102', `there is no ${three}`, p, `use ${three === '===' ? '==' : '!='}; it already compares type and value`);
    if (two === '**') throw err('E102', 'there is no ** operator', p, 'use pow(a, b)');
    if (two === '++' || two === '--') throw err('E102', `there is no ${two} operator`, p, `write x ${two[0]}= 1`);
    if (two === '=>') throw err('E102', 'there are no arrow functions', p, 'write fn(x: int) -> int { ret x * 2 }');
    if (two === '&&' || two === '||') throw err('E102', `there is no ${two}`, p, `use ${two === '&&' ? 'and' : 'or'}`);
    if (['==', '!=', '<=', '>=', '//', '->', '..', '+=', '-=', '*='].includes(two)) { i += 2; col += 2; add('op', two, p, o); continue; }
    if ('+-*/%<>=()[]{},:.'.includes(c)) {
      if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) stack.pop();
      i++; col++; add('op', c, p, o); continue;
    }
    throw err('E102', `unexpected character '${c}'`, p, BAD[c] || 'remove it');
  }
  add('eof', null, { line, col }, i);
  return T;
}

// ---------- parser ----------
class Parser {
  constructor(toks, src) { this.t = toks; this.i = 0; this.src = src; this.loop = 0; this.fnDepth = 0; this.blockDepth = 0; }
  get p() { return this.t[this.i]; }
  at(k) { return this.t[Math.min(this.i + k, this.t.length - 1)]; }
  next() { return this.t[this.i++]; }
  is(t, v) { const x = this.t[this.i]; return x.t === t && (v === undefined || x.v === v); }
  op(v) { return this.is('op', v); }
  kw(v) { return this.is('kw', v); }
  eat(t, v) { return this.is(t, v) ? this.next() : null; }
  skipNL() { while (this.is('nl')) this.i++; }
  desc(x) {
    if (x.t === 'nl') return 'the end of the line';
    if (x.t === 'eof') return 'the end of the file';
    if (x.t === 'str') return 'a string';
    if (x.t === 'int' || x.t === 'float') return `the number ${x.v}`;
    if (x.t === 'kw') return `the keyword '${x.v}'`;
    return `'${x.v}'`;
  }
  fail(msg, hint, x) { throw err('E100', msg, x || this.p, hint); }
  expect(t, v, hint) {
    if (this.is(t, v)) return this.next();
    const what = v ? `'${v}'` : t === 'id' ? 'a name' : t === 'str' ? 'a string' : t;
    let h = hint;
    if (t === 'id' && this.p.t === 'kw') h = `'${this.p.v}' is a keyword and cannot be a name` + (hint ? '; ' + hint : '');
    this.fail(`expected ${what} but found ${this.desc(this.p)}`, h);
  }
  program() {
    const body = []; this.skipNL();
    while (!this.is('eof')) { body.push(this.stmt()); this.endStmt(); this.skipNL(); }
    return body;
  }
  endStmt() {
    if (this.is('nl') || this.is('eof') || this.op('}')) return;
    let h = 'put each statement on its own line';
    const prev = this.t[this.i - 1];
    if (this.op('=') && prev && prev.t === 'op' && (prev.v === ']' || prev.v === ')')) h = 'only names, xs[i] and rec.field can be assigned';
    if (this.op('{')) h = 'a { here looks like a block; blocks follow if, elif, else, while, for, fn, type and test';
    this.fail(`expected the end of the line but found ${this.desc(this.p)}`, h);
  }
  block() {
    const ob = this.expect('op', '{', 'blocks start with {');
    const body = []; this.skipNL(); this.blockDepth++;
    while (!this.op('}')) {
      if (this.is('eof')) this.fail('this { is never closed', 'add a } to close the block', ob);
      body.push(this.stmt()); this.endStmt(); this.skipNL();
    }
    this.next(); this.blockDepth--;
    return body;
  }
  fnBody() {
    const l = this.loop; this.loop = 0; this.fnDepth++;
    const b = this.block();
    this.fnDepth--; this.loop = l;
    return b;
  }
  lowerName(n, what) {
    if (!/^[a-z_]/.test(n.v)) throw err('E106', `${what} names start with a lowercase letter: '${n.v}'`, n, `rename it to ${n.v[0].toLowerCase() + n.v.slice(1)}; Capitalized names are for types`);
  }
  stmt() {
    const x = this.p;
    if (x.t === 'id' && STMT_FOREIGN.has(x.v)) {
      const n = this.at(1);
      if (!(n.t === 'op' && ['=', '+=', '-=', '*=', '(', '[', '.'].includes(n.v))) this.fail(`Clay has no '${x.v}'`, `use ${FOREIGN[x.v]}`);
    }
    if (x.t === 'kw') switch (x.v) {
      case 'let': case 'var': return this.letStmt();
      case 'fn': if (this.at(1).t === 'id') return this.fnDecl(); break;
      case 'type': return this.typeDecl();
      case 'test': return this.testDecl();
      case 'if': return this.ifStmt();
      case 'while': { this.next(); const c = this.condE(); this.loop++; const body = this.block(); this.loop--; return { k: 'while', c, body, pos: x }; }
      case 'for': return this.forStmt();
      case 'break': case 'continue':
        if (!this.loop) this.fail(`${x.v} is only allowed inside a loop`, 'use it inside while or for');
        this.next(); return { k: x.v, pos: x };
      case 'ret': {
        if (!this.fnDepth) this.fail('ret is only allowed inside a function', 'wrap the code in fn name() { ... }');
        this.next(); const e = (this.is('nl') || this.op('}') || this.is('eof')) ? null : this.expr();
        return { k: 'ret', e, pos: x };
      }
      case 'assert': {
        this.next(); const s = this.p.o; const e = this.expr();
        const text = this.src.slice(s, this.t[this.i - 1].e);
        let m = null; if (this.eat('op', ',')) m = this.expr();
        return { k: 'assert', e, m, text, pos: x };
      }
      case 'elif': case 'else': this.fail(`'${x.v}' without an if before it`, 'put elif / else right after the } of an if block');
    }
    const e = this.expr();
    const a = this.p;
    if (a.t === 'op' && ['=', '+=', '-=', '*='].includes(a.v)) {
      if (!['var', 'index', 'field'].includes(e.k)) this.fail('can only assign to a name, xs[i] or rec.field', null, a);
      this.next();
      return { k: 'assign', op: a.v, target: e, e: this.expr(), pos: a };
    }
    if (e.k !== 'call') {
      let h = 'assign it (let x = ...) or delete it';
      if (e.k === 'bin' && e.op === '==') h = 'to change a variable use =, not ==';
      if (e.k === 'var' && FOREIGN[e.name]) h = `Clay uses ${FOREIGN[e.name]}`;
      throw err('E105', 'this value is computed but never used', e.pos, h);
    }
    return { k: 'expr', e, pos: e.pos };
  }
  letStmt() {
    const kw = this.next();
    const n = this.expect('id', undefined, `give it a name, e.g. ${kw.v} total = 0`);
    this.lowerName(n, 'variable');
    let ty = null; if (this.eat('op', ':')) ty = this.type();
    this.expect('op', '=', `${kw.v} needs a value: ${kw.v} ${n.v} = ...`);
    return { k: 'let', mut: kw.v === 'var', name: n.v, ty, e: this.expr(), pos: n };
  }
  type() {
    if (this.kw('none')) { this.next(); return { n: 'none' }; }
    if (this.kw('fn')) { this.next(); return { n: 'fn' }; }
    const n = this.expect('id', undefined, 'types are int float str bool list map fn any none, list[T], map[T], or a type you declared');
    if (n.v === 'list' || n.v === 'map') {
      if (this.eat('op', '[')) { const a = this.type(); this.expect('op', ']'); return { n: n.v, a, pos: n }; }
      if (this.op('<')) this.fail('generic types use square brackets', `write ${n.v}[int]`);
      return { n: n.v, pos: n };
    }
    if (FOREIGN_TYPES[n.v] && !BASE_TYPES.has(n.v)) throw err('E307', `unknown type '${n.v}'`, n, `use ${FOREIGN_TYPES[n.v]}`);
    if (!BASE_TYPES.has(n.v) && !/^[A-Z]/.test(n.v)) throw err('E307', `unknown type '${n.v}'`, n, 'types are int float str bool list map fn any none, or a Capitalized type you declared');
    return { n: n.v, pos: n };
  }
  params() {
    this.expect('op', '(', 'write fn name(a: int, b: int) -> int { ... }');
    const ps = [];
    while (!this.op(')')) {
      const n = this.expect('id', undefined, 'parameters look like name: type');
      this.lowerName(n, 'parameter');
      if (ps.some(p => p.name === n.v)) throw err('E201', `parameter '${n.v}' appears twice`, n, 'give each parameter its own name');
      if (!this.eat('op', ':')) this.fail(`parameter '${n.v}' needs a type`, `write ${n.v}: int (or ${n.v}: any to accept anything)`);
      ps.push({ name: n.v, ty: this.type(), pos: n });
      if (!this.eat('op', ',')) break;
    }
    this.expect('op', ')', 'separate parameters with commas');
    let ret = null;
    if (this.eat('op', '->')) ret = this.type();
    else if (this.op(':')) this.fail('return types use ->', 'write fn f(x: int) -> int { ... }');
    return { ps, ret };
  }
  fnDecl() {
    this.next(); const n = this.next(); this.lowerName(n, 'function');
    const { ps, ret } = this.params();
    return { k: 'fn', name: n.v, ps, ret, body: this.fnBody(), pos: n };
  }
  typeDecl() {
    const x = this.next();
    if (this.blockDepth) this.fail('types must be declared at the top level', 'move the type out of the block', x);
    const n = this.expect('id', undefined, 'write type Point { x: float, y: float }');
    if (!/^[A-Z]/.test(n.v)) throw err('E106', `type names start with a capital letter: '${n.v}'`, n, `rename it to ${n.v[0].toUpperCase() + n.v.slice(1)}`);
    this.expect('op', '{'); const fields = []; this.skipNL();
    while (!this.op('}')) {
      const f = this.expect('id', undefined, 'fields look like name: type');
      this.lowerName(f, 'field');
      if (fields.some(q => q.name === f.v)) throw err('E201', `field '${f.v}' appears twice`, f);
      this.expect('op', ':', `field '${f.v}' needs a type, e.g. ${f.v}: int`);
      fields.push({ name: f.v, ty: this.type(), pos: f });
      const sep = this.eat('op', ',') || this.is('nl');
      this.skipNL();
      if (!sep) break;
    }
    this.skipNL(); this.expect('op', '}', 'separate fields with commas or new lines');
    return { k: 'type', name: n.v, fields, pos: n };
  }
  testDecl() {
    const x = this.next();
    if (this.blockDepth) this.fail('tests must be at the top level', 'move the test out of the block', x);
    const s = this.expect('str', undefined, 'write test "what it checks" { assert ... }');
    if (s.v.length !== 1 || typeof s.v[0] !== 'string') this.fail('test names are plain strings', 'remove the {} from the test name', s);
    const l = this.loop; this.loop = 0;
    const body = this.block(); this.loop = l;
    return { k: 'test', name: s.v[0], body, pos: x };
  }
  ifStmt() {
    const x = this.next();
    const arms = [{ c: this.condE(), body: this.block() }]; let els = null;
    for (;;) {
      const save = this.i; this.skipNL();
      if (this.kw('elif')) { this.next(); arms.push({ c: this.condE(), body: this.block() }); continue; }
      if (this.kw('else')) {
        this.next();
        if (this.kw('if')) this.fail("Clay writes 'else if' as 'elif'", 'write elif cond { ... }');
        els = this.block(); break;
      }
      if (this.is('id') && this.p.v === 'elsif') this.fail("Clay writes 'elsif' as 'elif'", 'write elif cond { ... }');
      this.i = save; break;
    }
    return { k: 'if', arms, els, pos: x };
  }
  forStmt() {
    const x = this.next();
    if (this.op('(')) this.fail('for loops have no parentheses', 'write for i in 0..10 { ... }');
    const n = this.expect('id', undefined, 'write for x in xs { ... }');
    this.lowerName(n, 'loop variable');
    if (this.op(',')) this.fail('for loops take one variable', `write for i in 0..len(xs) { let ${n.v === 'i' ? 'x' : n.v} = xs[i] }`);
    this.expect('kw', 'in', 'write for x in xs { ... }');
    const it = this.expr();
    this.loop++; const body = this.block(); this.loop--;
    return { k: 'for', name: n.v, it, body, pos: n };
  }
  // expressions, lowest precedence first
  expr() { return this.orE(); }
  condE() { this.inCond = true; try { return this.orE(); } finally { this.inCond = false; } }
  orE() {
    let l = this.andE();
    while (this.kw('or')) {
      const o = this.next(); const r = this.andE();
      for (const s of [l, r]) if (s.k === 'bin' && s.op === 'and' && !s.paren) throw err('E103', 'mixing and with or needs parentheses', o, 'write (a and b) or c, or a and (b or c)');
      l = { k: 'bin', op: 'or', l, r, pos: o };
    }
    return l;
  }
  andE() { let l = this.notE(); while (this.kw('and')) { const o = this.next(); l = { k: 'bin', op: 'and', l, r: this.notE(), pos: o }; } return l; }
  notE() { if (this.kw('not')) { const o = this.next(); return { k: 'not', e: this.notE(), pos: o }; } return this.cmpE(); }
  isCmp() { return this.p.t === 'op' && CMP.has(this.p.v); }
  cmpE() {
    const l = this.rangeE();
    if (!this.isCmp()) { if (this.op('=') && this.inCond) this.fail('= changes a variable; to compare use ==', 'write a == b'); return l; }
    const o = this.next(); const r = this.rangeE();
    if (this.isCmp()) throw err('E104', 'comparisons cannot be chained', this.p, 'write a < b and b < c');
    return { k: 'bin', op: o.v, l, r, pos: o };
  }
  rangeE() { const l = this.addE(); if (this.op('..')) { const o = this.next(); return { k: 'range', l, r: this.addE(), pos: o }; } return l; }
  addE() { let l = this.mulE(); while (this.op('+') || this.op('-')) { const o = this.next(); l = { k: 'bin', op: o.v, l, r: this.mulE(), pos: o }; } return l; }
  mulE() { let l = this.unE(); while (this.op('*') || this.op('/') || this.op('//') || this.op('%')) { const o = this.next(); l = { k: 'bin', op: o.v, l, r: this.unE(), pos: o }; } return l; }
  unE() { if (this.op('-')) { const o = this.next(); return { k: 'neg', e: this.unE(), pos: o }; } return this.postE(); }
  postE() {
    let e = this.prim();
    for (;;) {
      if (this.op('(')) {
        this.next(); const args = [];
        while (!this.op(')')) { args.push(this.expr()); if (!this.eat('op', ',')) break; }
        this.expect('op', ')', 'separate arguments with commas');
        e = { k: 'call', f: e, args, pos: e.pos };
      } else if (this.op('[')) {
        const o = this.next(); const ix = this.expr();
        if (this.op(':')) this.fail('there is no slice syntax', 'use slice(xs, a, b)');
        this.expect('op', ']');
        e = { k: 'index', e, ix, pos: o };
      } else if (this.op('.')) {
        this.next(); const f = this.expect('id', undefined, 'write rec.field');
        e = { k: 'field', e, name: f.v, pos: f };
      } else return e;
    }
  }
  prim() {
    const x = this.p;
    switch (x.t) {
      case 'int': case 'float': this.next(); return { k: 'lit', v: x.v, pos: x };
      case 'str': this.next(); return this.strNode(x);
      case 'kw':
        if (x.v === 'true' || x.v === 'false') { this.next(); return { k: 'lit', v: x.v === 'true', pos: x }; }
        if (x.v === 'none') { this.next(); return { k: 'lit', v: NONE, pos: x }; }
        if (x.v === 'fn') { this.next(); const { ps, ret } = this.params(); return { k: 'lambda', ps, ret, body: this.fnBody(), pos: x }; }
        break;
      case 'id':
        this.next();
        if (/^[A-Z]/.test(x.v) && this.op('{')) return this.recLit(x);
        return { k: 'var', name: x.v, pos: x };
      case 'op':
        if (x.v === '(') { this.next(); const e = this.expr(); this.expect('op', ')'); e.paren = true; return e; }
        if (x.v === '[') {
          this.next(); const items = [];
          while (!this.op(']')) { items.push(this.expr()); if (!this.eat('op', ',')) break; }
          this.expect('op', ']', 'separate items with commas');
          return { k: 'list', items, pos: x };
        }
        if (x.v === '{') return this.mapLit();
    }
    let h = 'finish the expression';
    if (x.t === 'nl' || x.t === 'eof') h = 'the expression is incomplete';
    else if (x.t === 'op' && x.v === '}') h = 'a value is missing before }';
    this.fail(`expected a value but found ${this.desc(x)}`, h);
  }
  mapLit() {
    const o = this.next(); const ents = []; this.skipNL();
    while (!this.op('}')) {
      const k = this.expr();
      this.expect('op', ':', 'map entries look like "key": value');
      this.skipNL(); ents.push([k, this.expr()]); this.skipNL();
      if (!this.eat('op', ',')) break;
      this.skipNL();
    }
    this.skipNL(); this.expect('op', '}', 'separate entries with commas');
    return { k: 'map', ents, pos: o };
  }
  recLit(x) {
    this.next(); const fields = []; this.skipNL();
    while (!this.op('}')) {
      const f = this.expect('id', undefined, `write ${x.v}{field: value}`);
      this.expect('op', ':', `write ${f.v}: value`);
      this.skipNL(); fields.push({ name: f.v, e: this.expr(), pos: f }); this.skipNL();
      if (!this.eat('op', ',')) break;
      this.skipNL();
    }
    this.skipNL(); this.expect('op', '}', 'separate fields with commas');
    return { k: 'rec', name: x.v, fields, pos: x };
  }
  strNode(x) {
    if (x.v.every(p => typeof p === 'string')) return { k: 'lit', v: x.v.join(''), pos: x };
    const parts = x.v.map(p => {
      if (typeof p === 'string') return p;
      const sp = new Parser(lex(p.code, p.line, p.col), p.code);
      sp.fnDepth = this.fnDepth; sp.loop = this.loop;
      const e = sp.expr();
      if (!sp.is('eof')) sp.fail(`unexpected ${sp.desc(sp.p)} inside {} in a string`, 'only one expression fits inside {}');
      return e;
    });
    return { k: 'str', parts, pos: x };
  }
}
function parse(src) { return new Parser(lex(src), src).program(); }

// ---------- values ----------
const NONE = Object.freeze({ none: true });
class Fn { constructor(name, ps, ret, body, env, pos) { this.name = name; this.ps = ps; this.ret = ret; this.body = body; this.env = env; this.pos = pos; } }
class Builtin { constructor(name, sig, min, max, f) { this.name = name; this.sig = sig; this.min = min; this.max = max; this.f = f; } }
class Rec { constructor(t, f) { this.t = t; this.f = f; } }
class Ret { constructor(v, has, pos) { this.v = v; this.has = has; this.pos = pos; } }
const BRK = { brk: 1 }, CNT = { cnt: 1 };

function typeOf(v) {
  switch (typeof v) { case 'bigint': return 'int'; case 'number': return 'float'; case 'string': return 'str'; case 'boolean': return 'bool'; }
  if (v === NONE) return 'none';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Map) return 'map';
  if (v instanceof Rec) return v.t;
  if (v instanceof Fn || v instanceof Builtin) return 'fn';
  return '?';
}
const tyStr = ty => ty.a ? `${ty.n}[${tyStr(ty.a)}]` : ty.n;
function fits(v, ty) {
  if (!ty || ty.n === 'any') return true;
  if (ty.n === 'list') return Array.isArray(v) && (!ty.a || v.every(x => fits(x, ty.a)));
  if (ty.n === 'map') { if (!(v instanceof Map)) return false; if (ty.a) for (const x of v.values()) if (!fits(x, ty.a)) return false; return true; }
  return typeOf(v) === ty.n;
}
function whatIs(v, ty) {
  if (ty && ty.a && ty.n === 'list' && Array.isArray(v)) { const i = v.findIndex(x => !fits(x, ty.a)); if (i >= 0) return `a list with ${typeOf(v[i])} ${show(v[i], true)} at index ${i}`; }
  if (ty && ty.a && ty.n === 'map' && v instanceof Map) for (const [k, x] of v) if (!fits(x, ty.a)) return `a map with ${typeOf(x)} at key ${JSON.stringify(k)}`;
  return `${typeOf(v)} ${show(v, true, 0, 40)}`;
}
function tyHint(v, ty) {
  if (!ty) return '';
  if (ty.n === 'float' && typeof v === 'bigint') return `write ${v}.0 instead of ${v}, or use float(x)`;
  if (ty.n === 'int' && typeof v === 'number') return 'use int(x), floor(x) or round(x)';
  if (ty.n === 'str' && typeOf(v) !== 'str') return 'use str(x)';
  if (ty.n === 'int' && typeof v === 'string') return 'use int(s)';
  return '';
}
function fmtFloat(x) {
  if (!isFinite(x)) return String(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);
  return String(x);
}
function show(v, q, d, max) {
  d = d || 0;
  let s;
  switch (typeof v) {
    case 'bigint': s = v.toString(); break;
    case 'number': s = fmtFloat(v); break;
    case 'string': s = q ? JSON.stringify(v) : v; break;
    case 'boolean': s = String(v); break;
    default:
      if (d > 20) s = '...';
      else if (v === NONE) s = 'none';
      else if (Array.isArray(v)) s = '[' + v.map(x => show(x, true, d + 1)).join(', ') + ']';
      else if (v instanceof Map) s = '{' + [...v].map(([k, x]) => JSON.stringify(k) + ': ' + show(x, true, d + 1)).join(', ') + '}';
      else if (v instanceof Rec) s = v.t + '{' + Object.keys(v.f).map(k => k + ': ' + show(v.f[k], true, d + 1)).join(', ') + '}';
      else if (v instanceof Fn || v instanceof Builtin) s = `<fn ${v.name}>`;
      else s = String(v);
  }
  if (max && s.length > max) s = s.slice(0, max - 3) + '...';
  return s;
}
function eq(a, b) {
  if (a === b) return true;
  const ta = typeOf(a); if (ta !== typeOf(b)) return false;
  if (ta === 'list') return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (ta === 'map') { if (a.size !== b.size) return false; for (const [k, x] of a) if (!b.has(k) || !eq(x, b.get(k))) return false; return true; }
  if (a instanceof Rec) return Object.keys(a.f).every(k => eq(a.f[k], b.f[k]));
  return false;
}
function floordiv(a, b) { const q = a / b; return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const boolHint = v => {
  const t = typeOf(v);
  if (t === 'int' || t === 'float') return 'Clay has no truthiness; compare explicitly, e.g. x != 0';
  if (t === 'list') return 'Clay has no truthiness; use len(xs) > 0';
  if (t === 'str') return 'Clay has no truthiness; use s != ""';
  if (t === 'map') return 'Clay has no truthiness; use len(m) > 0';
  return 'conditions must be true or false';
};

// ---------- built-ins ----------
const BUILTINS = Object.create(null);
function def(sig, f) {
  const m = /^(\w+)\((.*?)\)/.exec(sig); const name = m[1];
  const ps = m[2] ? m[2].split(', ').map(p => { const [n, t] = p.split(': '); return { rest: n.startsWith('...'), opt: t.endsWith('?'), t: t.replace('?', '').split('|') }; }) : [];
  const min = ps.filter(p => !p.opt && !p.rest).length, max = ps.some(p => p.rest) ? Infinity : ps.length;
  BUILTINS[name] = new Builtin(name, sig, min, max, function (args, pos) {
    for (let i = 0; i < args.length; i++) {
      const p = ps[Math.min(i, ps.length - 1)], ta = typeOf(args[i]);
      if (!p.t.includes('any') && !p.t.includes(ta)) {
        const h = tyHint(args[i], { n: p.t[0] });
        throw err('E302', `argument ${i + 1} of ${name} must be ${p.t.join(' or ')}, got ${whatIs(args[i])}`, pos, (h ? h + '; ' : '') + `signature: ${sig}`);
      }
    }
    return f.call(this, args, pos);
  });
}
const I = n => BigInt(n);
const need = (ok, code, msg, pos, hint) => { if (!ok) throw err(code, msg, pos, hint); };
const sameKind = (xs, pos, what) => {
  if (!xs.length) return null;
  const t = typeOf(xs[0]);
  need(['int', 'float', 'str'].includes(t), 'E302', `${what} works on int, float or str, got ${t}`, pos);
  const bad = xs.findIndex(x => typeOf(x) !== t);
  need(bad < 0, 'E302', `${what} needs items of one type; index 0 is ${t}, index ${bad} is ${typeOf(xs[bad])}`, pos, 'convert the items first');
  return t;
};
const cmpVals = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function nthArgFn(f, pos, name) { if (!(f instanceof Fn || f instanceof Builtin)) throw err('E302', `${name} needs a function`, pos); }

def('print(...values: any) -> none', function (a) { this.out(a.map(x => show(x)).join(' ')); return NONE; });
def('len(x: list|str|map) -> int', a => I(a[0] instanceof Map ? a[0].size : a[0].length));
def('str(x: any) -> str', a => show(a[0]));
def('int(x: int|float|str|bool) -> int', (a, pos) => {
  const x = a[0];
  if (typeof x === 'bigint') return x;
  if (typeof x === 'boolean') return x ? 1n : 0n;
  if (typeof x === 'number') { need(isFinite(x), 'E300', `cannot turn ${x} into int`, pos); return I(Math.trunc(x)); }
  const s = x.trim(); need(/^[-+]?\d+$/.test(s), 'E300', `cannot turn ${JSON.stringify(x)} into int`, pos, /^[-+]?\d*\.\d+$/.test(s) ? 'it looks like a float; use int(float(s))' : 'the string must be digits, e.g. "42"');
  return BigInt(s);
});
def('float(x: int|float|str) -> float', (a, pos) => {
  const x = a[0];
  if (typeof x === 'number') return x;
  if (typeof x === 'bigint') return Number(x);
  const s = x.trim(); need(/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s), 'E300', `cannot turn ${JSON.stringify(x)} into float`, pos, 'the string must be a number, e.g. "3.5"');
  return parseFloat(s);
});
def('type_of(x: any) -> str', a => typeOf(a[0]));
def('push(xs: list, v: any) -> none', a => { a[0].push(a[1]); return NONE; });
def('pop(xs: list) -> any', (a, pos) => { need(a[0].length, 'E400', 'cannot pop from an empty list', pos, 'check len(xs) > 0 first'); return a[0].pop(); });
const idx = (len, i, pos, extra) => {
  need(i >= 0n && i < I(len) + (extra ? 1n : 0n), 'E400', `index ${i} is out of range (length ${len})`, pos, i < 0n ? 'Clay has no negative indexes; the last item is xs[len(xs) - 1]' : len ? `valid indexes are 0 to ${len - (extra ? 0 : 1)}` : 'the list is empty');
  return Number(i);
};
def('insert(xs: list, i: int, v: any) -> none', (a, pos) => { a[0].splice(idx(a[0].length, a[1], pos, true), 0, a[2]); return NONE; });
def('del(x: list|map, key: int|str) -> none', (a, pos) => {
  if (a[0] instanceof Map) { need(typeof a[1] === 'string', 'E302', 'map keys are str', pos); need(a[0].has(a[1]), 'E401', `key ${JSON.stringify(a[1])} is not in the map`, pos, 'check has(m, k) first'); a[0].delete(a[1]); }
  else { need(typeof a[1] === 'bigint', 'E302', 'list indexes are int', pos); a[0].splice(idx(a[0].length, a[1], pos), 1); }
  return NONE;
});
def('copy(x: list|map) -> list|map', a => Array.isArray(a[0]) ? a[0].slice() : new Map(a[0]));
def('slice(x: list|str, start: int, end: int) -> list|str', (a, pos) => {
  const n = a[0].length, s = a[1], e = a[2];
  need(s >= 0n && e <= I(n) && s <= e, 'E400', `slice ${s}..${e} is out of range (length ${n})`, pos, `need 0 <= start <= end <= ${n}`);
  return a[0].slice(Number(s), Number(e));
});
def('contains(x: list|str|map, v: any) -> bool', (a, pos) => {
  if (typeof a[0] === 'string') { need(typeof a[1] === 'string', 'E302', 'contains on a str needs a str to look for', pos, 'use str(x)'); return a[0].includes(a[1]); }
  if (a[0] instanceof Map) return a[0].has(a[1]);
  return a[0].some(x => eq(x, a[1]));
});
def('index_of(x: list|str, v: any) -> int', (a, pos) => {
  if (typeof a[0] === 'string') { need(typeof a[1] === 'string', 'E302', 'index_of on a str needs a str', pos); return I(a[0].indexOf(a[1])); }
  return I(a[0].findIndex(x => eq(x, a[1])));
});
def('join(xs: list, sep: str) -> str', a => a[0].map(x => show(x)).join(a[1]));
def('split(s: str, sep: str) -> list', a => a[0].split(a[1]));
def('chars(s: str) -> list', a => a[0].split(''));
def('upper(s: str) -> str', a => a[0].toUpperCase());
def('lower(s: str) -> str', a => a[0].toLowerCase());
def('trim(s: str) -> str', a => a[0].trim());
def('replace(s: str, old: str, new: str) -> str', (a, pos) => { need(a[1] !== '', 'E302', 'replace needs a non-empty str to find', pos); return a[0].split(a[1]).join(a[2]); });
def('starts_with(s: str, prefix: str) -> bool', a => a[0].startsWith(a[1]));
def('ends_with(s: str, suffix: str) -> bool', a => a[0].endsWith(a[1]));
def('repeat(s: str, n: int) -> str', (a, pos) => { need(a[1] >= 0n && a[1] < 10000000n, 'E302', 'repeat count must be 0 or more', pos); return a[0].repeat(Number(a[1])); });
def('ord(c: str) -> int', (a, pos) => { need(a[0].length === 1, 'E302', 'ord needs a single character', pos); return I(a[0].charCodeAt(0)); });
def('chr(n: int) -> str', (a, pos) => { need(a[0] >= 0n && a[0] < 65536n, 'E302', 'chr needs 0 to 65535', pos); return String.fromCharCode(Number(a[0])); });
def('keys(m: map) -> list', a => [...a[0].keys()]);
def('values(m: map) -> list', a => [...a[0].values()]);
def('has(m: map, key: str) -> bool', a => a[0].has(a[1]));
def('get(m: map, key: str, default: any) -> any', a => a[0].has(a[1]) ? a[0].get(a[1]) : a[2]);
def('map(xs: list, f: fn) -> list', function (a, pos) { return a[0].map(x => this.invoke(a[1], [x], pos)); });
def('filter(xs: list, f: fn) -> list', function (a, pos) {
  return a[0].filter(x => { const r = this.invoke(a[1], [x], pos); need(typeof r === 'boolean', 'E302', `the filter function must return bool, got ${typeOf(r)}`, pos, 'give it -> bool'); return r; });
});
def('reduce(xs: list, f: fn, start: any) -> any', function (a, pos) { let acc = a[2]; for (const x of a[0]) acc = this.invoke(a[1], [acc, x], pos); return acc; });
def('sort(xs: list) -> list', (a, pos) => { sameKind(a[0], pos, 'sort'); return a[0].slice().sort(cmpVals); });
def('sort_by(xs: list, key: fn) -> list', function (a, pos) {
  const ks = a[0].map(x => this.invoke(a[1], [x], pos)); sameKind(ks, pos, 'sort_by keys');
  return a[0].map((x, i) => [ks[i], i, x]).sort((p, q) => cmpVals(p[0], q[0]) || p[1] - q[1]).map(p => p[2]);
});
def('reverse(x: list|str) -> list|str', a => typeof a[0] === 'string' ? a[0].split('').reverse().join('') : a[0].slice().reverse());
def('sum(xs: list) -> int|float', (a, pos) => {
  const t = sameKind(a[0], pos, 'sum'); if (!t) return 0n;
  need(t !== 'str', 'E302', 'sum needs numbers', pos, 'use join(xs, "") for strings');
  return a[0].reduce((x, y) => x + y);
});
for (const nm of ['min', 'max']) def(`${nm}(...values: any) -> any`, (a, pos) => {
  const xs = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
  need(xs.length, 'E400', `${nm} of an empty list`, pos, 'check len(xs) > 0 first');
  sameKind(xs, pos, nm);
  return xs.reduce((x, y) => (nm === 'min' ? y < x : y > x) ? y : x);
});
def('abs(x: int|float) -> int|float', a => a[0] < 0 ? -a[0] : a[0]);
def('sqrt(x: float) -> float', (a, pos) => { need(a[0] >= 0, 'E302', 'sqrt of a negative number', pos); return Math.sqrt(a[0]); });
def('pow(base: int|float, exp: int|float) -> int|float', (a, pos) => {
  need(typeOf(a[0]) === typeOf(a[1]), 'E300', `pow needs two ints or two floats, got ${typeOf(a[0])} and ${typeOf(a[1])}`, pos, 'convert with float(x) or int(x)');
  if (typeof a[0] === 'bigint') { need(a[1] >= 0n, 'E302', 'int pow needs exp >= 0', pos, 'use floats: pow(2.0, -1.0)'); need(a[1] < 100000n, 'E302', 'exponent too big', pos); return a[0] ** a[1]; }
  return Math.pow(a[0], a[1]);
});
def('floor(x: float) -> int', (a, pos) => { need(isFinite(a[0]), 'E300', 'floor of a non-finite float', pos); return I(Math.floor(a[0])); });
def('ceil(x: float) -> int', (a, pos) => { need(isFinite(a[0]), 'E300', 'ceil of a non-finite float', pos); return I(Math.ceil(a[0])); });
def('round(x: float) -> int', (a, pos) => { need(isFinite(a[0]), 'E300', 'round of a non-finite float', pos); return I(Math.round(a[0])); });
def('fixed(x: float, digits: int) -> str', (a, pos) => { need(a[1] >= 0n && a[1] <= 20n, 'E302', 'digits must be 0 to 20', pos); return a[0].toFixed(Number(a[1])); });
def('seed(n: int) -> none', function (a) { this.rng = mulberry(Number(BigInt.asIntN(32, a[0]))); return NONE; });
def('rand_int(low: int, high: int) -> int', function (a, pos) { need(a[0] <= a[1], 'E302', 'rand_int needs low <= high', pos); return a[0] + I(Math.floor(this.rng() * Number(a[1] - a[0] + 1n))); });
def('rand_float() -> float', function () { return this.rng(); });
def('fail(message: str) -> none', (a, pos) => { throw err('E600', a[0], pos, ''); });

// ---------- interpreter ----------
class Env { constructor(p, root) { this.p = p; this.v = new Map(); this.root = !!root; } }

class Interp {
  constructor(o) { this.out = o.out; this.steps = 0; this.max = o.maxSteps || 5e6; this.depth = 0; this.types = new Map(); this.rng = mulberry(1); this.global = new Env(null, true); this.stack = []; this.lp = null; }
  tick(pos) {
    this.lp = pos;
    if (++this.steps > this.max) throw err('E501', `stopped after ${this.max.toLocaleString('en')} steps`, pos, 'probably an infinite loop; make sure the loop condition can become false');
  }
  find(env, name) { for (let e = env; e; e = e.p) { const b = e.v.get(name); if (b) return b; } return null; }
  names(env) { const s = new Set(Object.keys(BUILTINS)); for (let e = env; e; e = e.p) for (const k of e.v.keys()) s.add(k); return s; }
  define(env, name, v, mut, ty, pos) {
    if (BUILTINS[name]) throw err('E201', `'${name}' is a built-in function and cannot be redefined`, pos, `pick another name, e.g. my_${name}`);
    for (let e = env; e; e = e.p) { if (e.v.has(name)) throw err('E201', `'${name}' is already defined`, pos, 'a name cannot be reused inside the same function; pick a new name, or if it is a var assign with ='); if (e.root) break; }
    env.v.set(name, { v, mut, ty, t: typeOf(v) });
  }
  undef(name, pos, env) {
    let hint;
    if (FOREIGN[name]) hint = `Clay uses ${FOREIGN[name]}`;
    else if (this.types.has(name)) hint = `${name} is a type; build one with ${name}{...}`;
    else { const s = closest(name, this.names(env)); hint = s ? `did you mean ${s}?` : 'define it first with let or var'; }
    return err('E200', `'${name}' is not defined`, pos, hint);
  }
  checkType(ty, pos) {
    if (!ty) return;
    if (ty.a) this.checkType(ty.a, pos);
    if (BASE_TYPES.has(ty.n) || this.types.has(ty.n)) return;
    const s = closest(ty.n, [...this.types.keys(), ...BASE_TYPES]);
    throw err('E307', `unknown type '${ty.n}'`, ty.pos || pos, s ? `did you mean ${s}?` : `declare it with type ${ty.n} { ... }`);
  }
  setup(prog) {
    for (const s of prog) if (s.k === 'type') {
      if (this.types.has(s.name)) throw err('E201', `type ${s.name} is declared twice`, s.pos);
      this.types.set(s.name, s);
    }
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.k === 'fn' || n.k === 'lambda') { n.ps.forEach(p => this.checkType(p.ty, p.pos)); this.checkType(n.ret, n.pos); }
      if (n.k === 'type') n.fields.forEach(f => this.checkType(f.ty, f.pos));
      if (n.k === 'let') this.checkType(n.ty, n.pos);
      if (n.k === 'rec' && !this.types.has(n.name)) { const s = closest(n.name, this.types.keys()); throw err('E307', `unknown type '${n.name}'`, n.pos, s ? `did you mean ${s}?` : `declare it with type ${n.name} { ... }`); }
      for (const k in n) if (k !== 'pos' && k !== 'ty' && k !== 'ret') walk(n[k]);
    };
    walk(prog);
  }
  block(stmts, env) {
    for (const s of stmts) if (s.k === 'fn') this.define(env, s.name, new Fn(s.name, s.ps, s.ret, s.body, env, s.pos), false, null, s.pos);
    for (const s of stmts) this.exec(s, env);
  }
  cond(e, env, what) {
    const v = this.eval(e, env);
    if (typeof v !== 'boolean') throw err('E301', `${what} condition must be bool, got ${typeOf(v)}`, e.pos, boolHint(v));
    return v;
  }
  exec(s, env) {
    this.tick(s.pos);
    switch (s.k) {
      case 'let': {
        const v = this.eval(s.e, env);
        if (s.ty && !fits(v, s.ty)) throw err('E302', `${s.name} is declared as ${tyStr(s.ty)} but the value is ${whatIs(v, s.ty)}`, s.pos, tyHint(v, s.ty));
        if (v === NONE) throw err('E302', `cannot store none in '${s.name}'`, s.pos, 'the function you called returns nothing');
        this.define(env, s.name, v, s.mut, s.ty, s.pos); return;
      }
      case 'assign': return this.assign(s, env);
      case 'expr': this.eval(s.e, env); return;
      case 'if':
        for (const a of s.arms) if (this.cond(a.c, env, 'if')) return this.block(a.body, new Env(env));
        if (s.els) this.block(s.els, new Env(env));
        return;
      case 'while':
        while (this.cond(s.c, env, 'while')) {
          this.tick(s.pos);
          try { this.block(s.body, new Env(env)); }
          catch (x) { if (x === BRK) break; if (x === CNT) continue; throw x; }
        }
        return;
      case 'for': return this.forLoop(s, env);
      case 'break': throw BRK;
      case 'continue': throw CNT;
      case 'ret': throw new Ret(s.e ? this.eval(s.e, env) : NONE, !!s.e, s.pos);
      case 'assert': return this.assert(s, env);
    }
  }
  rangeEnds(n, env) {
    const a = this.eval(n.l, env), b = this.eval(n.r, env);
    if (typeof a !== 'bigint' || typeof b !== 'bigint') throw err('E300', `range ends must be int, got ${typeOf(a)}..${typeOf(b)}`, n.pos, 'convert with int(x)');
    return [a, b];
  }
  forLoop(s, env) {
    const run = v => {
      const e = new Env(env); this.define(e, s.name, v, false, null, s.pos);
      try { this.block(s.body, e); } catch (x) { if (x === BRK) return false; if (x !== CNT) throw x; }
      return true;
    };
    if (s.it.k === 'range') { const [a, b] = this.rangeEnds(s.it, env); for (let i = a; i < b; i++) if (!run(i)) break; return; }
    const it = this.eval(s.it, env);
    if (Array.isArray(it)) { for (const v of it.slice()) if (!run(v)) break; return; }
    if (typeof it === 'string') { for (let i = 0; i < it.length; i++) if (!run(it[i])) break; return; }
    if (it instanceof Map) { for (const k of [...it.keys()]) if (!run(k)) break; return; }
    throw err('E300', `cannot loop over ${typeOf(it)}`, s.it.pos, typeof it === 'bigint' ? 'to count, write for i in 0..n' : 'for works on list, str, map (its keys) and a..b ranges');
  }
  assert(s, env) {
    const e = s.e; const msg = () => s.m ? show(this.eval(s.m, env)) : '';
    if (e.k === 'bin' && CMP.has(e.op) && !e.paren) {
      const l = this.eval(e.l, env), r = this.eval(e.r, env);
      if (!this.compare(e.op, l, r, e.pos)) { const m = msg(); throw err('E500', `assert failed: ${s.text}`, s.pos, '', `left:  ${show(l, true, 0, 200)}\nright: ${show(r, true, 0, 200)}` + (m ? `\nnote:  ${m}` : '')); }
      return;
    }
    const v = this.eval(e, env);
    if (typeof v !== 'boolean') throw err('E301', `assert needs a bool, got ${typeOf(v)}`, e.pos, boolHint(v));
    if (!v) { const m = msg(); throw err('E500', `assert failed: ${s.text}`, s.pos, '', m ? `note:  ${m}` : ''); }
  }
  eval(n, env) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'str': { let s = ''; for (const p of n.parts) s += typeof p === 'string' ? p : show(this.eval(p, env)); return s; }
      case 'var': { const b = this.find(env, n.name); if (b) return b.v; const bi = BUILTINS[n.name]; if (bi) return bi; throw this.undef(n.name, n.pos, env); }
      case 'list': return n.items.map(x => this.eval(x, env));
      case 'map': {
        const m = new Map();
        for (const [k, v] of n.ents) {
          const kv = k.k === 'var' && !this.find(env, k.name) && !BUILTINS[k.name] ? (() => { throw err('E200', `'${k.name}' is not defined`, k.pos, `map keys are strings; write "${k.name}": value`); })() : this.eval(k, env);
          if (typeof kv !== 'string') throw err('E300', `map keys must be str, got ${typeOf(kv)}`, k.pos, 'write {"name": value}; convert numbers with str(x)');
          if (m.has(kv)) throw err('E201', `duplicate key ${JSON.stringify(kv)}`, k.pos);
          m.set(kv, this.eval(v, env));
        }
        return m;
      }
      case 'rec': return this.mkRec(n, env);
      case 'range': {
        const [a, b] = this.rangeEnds(n, env);
        if (b - a > 10000000n) throw err('E501', 'range is too big to make a list', n.pos, 'loop over it directly: for i in a..b');
        const out = []; for (let i = a; i < b; i++) out.push(i); return out;
      }
      case 'not': { const v = this.eval(n.e, env); if (typeof v !== 'boolean') throw err('E300', `not needs a bool, got ${typeOf(v)}`, n.pos, boolHint(v)); return !v; }
      case 'neg': { const v = this.eval(n.e, env); if (typeof v === 'bigint' || typeof v === 'number') return -v; throw err('E300', `cannot negate ${typeOf(v)}`, n.pos); }
      case 'bin': return this.bin(n, env);
      case 'call': {
        const f = this.eval(n.f, env);
        return this.invoke(f, n.args.map(a => this.eval(a, env)), n.pos, n.args, n.f);
      }
      case 'index': return this.index(this.eval(n.e, env), this.eval(n.ix, env), n.pos);
      case 'field': return this.field(this.eval(n.e, env), n.name, n.pos);
      case 'lambda': return new Fn('fn', n.ps, n.ret, n.body, env, n.pos);
    }
    throw err('E900', 'unknown node ' + n.k, n.pos);
  }
  bin(n, env) {
    const op = n.op;
    if (op === 'and' || op === 'or') {
      const l = this.eval(n.l, env);
      if (typeof l !== 'boolean') throw err('E300', `${op} needs bool on both sides; the left side is ${typeOf(l)}`, n.pos, boolHint(l));
      if (op === 'and' ? !l : l) return l;
      const r = this.eval(n.r, env);
      if (typeof r !== 'boolean') throw err('E300', `${op} needs bool on both sides; the right side is ${typeOf(r)}`, n.pos, boolHint(r));
      return r;
    }
    return this.arith(op, this.eval(n.l, env), this.eval(n.r, env), n.pos);
  }
  arith(op, l, r, pos) {
    if (CMP.has(op)) return this.compare(op, l, r, pos);
    const tl = typeOf(l), tr = typeOf(r);
    const div0 = () => err('E402', 'division by zero', pos, 'check the divisor first');
    if (tl === 'int' && tr === 'int') switch (op) {
      case '+': return l + r; case '-': return l - r; case '*': return l * r;
      case '//': if (r === 0n) throw div0(); return floordiv(l, r);
      case '%': if (r === 0n) throw div0(); return l % r;
      case '/': throw err('E300', 'cannot use / on two ints', pos, 'use // for whole-number division, or float(a) / float(b)');
    }
    if (tl === 'float' && tr === 'float') switch (op) {
      case '+': return l + r; case '-': return l - r; case '*': return l * r;
      case '/': if (r === 0) throw div0(); return l / r;
      case '%': if (r === 0) throw div0(); return l % r;
      case '//': throw err('E300', '// is only for ints', pos, 'use floor(a / b) to get an int');
    }
    if (op === '+' && tl === 'str' && tr === 'str') return l + r;
    if (op === '+' && tl === 'list' && tr === 'list') return l.concat(r);
    const verb = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '//': 'divide', '%': 'use % on' }[op];
    let hint = '';
    if ((tl === 'int' && tr === 'float') || (tl === 'float' && tr === 'int')) hint = 'Clay never mixes int and float; convert one side with float(x) or int(x)';
    else if (tl === 'str' || tr === 'str') hint = op === '+' ? 'convert with str(x), or build the string with "{x}"' : op === '*' ? 'use repeat(s, n)' : '';
    else if (tl === 'list' && op === '+') hint = 'to add one item use push(xs, v); to join lists both sides must be lists';
    throw err('E300', `cannot ${verb} ${tl} and ${tr}`, pos, hint);
  }
  compare(op, l, r, pos) {
    const tl = typeOf(l), tr = typeOf(r);
    if (tl !== tr) throw err('E300', `cannot compare ${tl} with ${tr}`, pos,
      (tl === 'int' && tr === 'float') || (tl === 'float' && tr === 'int') ? 'convert one side with float(x) or int(x)'
        : tl === 'none' || tr === 'none' ? 'there is no null in Clay; values are never none unless a function returns nothing' : 'values of different types are never equal; convert one side first');
    if (op === '==') return eq(l, r);
    if (op === '!=') return !eq(l, r);
    if (tl !== 'int' && tl !== 'float' && tl !== 'str') throw err('E300', `cannot use ${op} on ${tl}`, pos, '< > <= >= work on int, float and str');
    switch (op) { case '<': return l < r; case '<=': return l <= r; case '>': return l > r; case '>=': return l >= r; }
  }
  sigOf(f) { return `fn ${f.name}(${f.ps.map(p => `${p.name}: ${tyStr(p.ty)}`).join(', ')})${f.ret ? ' -> ' + tyStr(f.ret) : ''}`; }
  invoke(f, args, pos, argNodes, fNode) {
    if (f instanceof Builtin) {
      if (args.length < f.min || args.length > f.max) throw err('E304', `${f.name} takes ${f.min === f.max ? f.min : f.max === Infinity ? `${f.min} or more` : `${f.min} to ${f.max}`} argument${f.max === 1 ? '' : 's'} but got ${args.length}`, pos, `signature: ${f.sig}`);
      this.tick(pos);
      return f.f.call(this, args, pos);
    }
    if (!(f instanceof Fn)) {
      let h = '';
      if (fNode && fNode.k === 'field') h = BUILTINS[fNode.name] ? `Clay has no methods; call ${BUILTINS[fNode.name].sig.split(' ->')[0]}` : FOREIGN[fNode.name] ? `Clay has no methods; use ${FOREIGN[fNode.name]}` : '';
      throw err('E305', `${typeOf(f)} is not a function`, pos, h);
    }
    if (args.length !== f.ps.length) throw err('E304', `${f.name} takes ${f.ps.length} argument${f.ps.length === 1 ? '' : 's'} but got ${args.length}`, pos, `signature: ${this.sigOf(f)}`);
    const e = new Env(f.env, true);
    for (let i = 0; i < args.length; i++) {
      const p = f.ps[i], a = args[i];
      if (!fits(a, p.ty)) { const h = tyHint(a, p.ty); throw err('E302', `argument ${i + 1} of ${f.name} ('${p.name}') must be ${tyStr(p.ty)}, got ${whatIs(a, p.ty)}`, argNodes && argNodes[i] ? argNodes[i].pos : pos, (h ? h + '; ' : '') + `signature: ${this.sigOf(f)}`); }
      this.define(e, p.name, a, false, p.ty, p.pos);
    }
    if (this.depth >= 700) throw err('E502', 'too many nested calls (over 700)', pos, 'make sure the recursion reaches a base case, or use a loop');
    this.depth++; this.stack.push({ name: f.name, pos });
    let v = NONE, had = false, rp = null;
    try { this.block(f.body, e); }
    catch (x) {
      if (x instanceof Ret) { v = x.v; had = x.has; rp = x.pos; }
      else { if (x instanceof ClayError && !x.trace) x.trace = this.stack.slice(); throw x; }
    } finally { this.depth--; this.stack.pop(); }
    if (f.ret && f.ret.n !== 'none') {
      if (!had) throw err('E303', `${f.name} must return ${tyStr(f.ret)} but finished without ret`, rp || f.pos, `make every path end with ret <${tyStr(f.ret)}>`);
      if (!fits(v, f.ret)) { const h = tyHint(v, f.ret); throw err('E303', `${f.name} must return ${tyStr(f.ret)} but returned ${whatIs(v, f.ret)}`, rp || pos, (h ? h + '; ' : '') + `signature: ${this.sigOf(f)}`); }
    } else if (had && v !== NONE) throw err('E303', `${f.name} returns a value but its signature has no -> type`, rp || f.pos, `add -> ${typeOf(v)} after the parameters`);
    return v;
  }
  index(v, ix, pos) {
    if (Array.isArray(v) || typeof v === 'string') {
      if (typeof ix !== 'bigint') throw err('E300', `${typeOf(v)} index must be int, got ${typeOf(ix)}`, pos, typeof ix === 'number' ? 'convert with int(x)' : '');
      return v[idx(v.length, ix, pos)];
    }
    if (v instanceof Map) {
      if (typeof ix !== 'string') throw err('E300', `map keys are str, got ${typeOf(ix)}`, pos, 'convert with str(x)');
      if (!v.has(ix)) { const ks = [...v.keys()]; const s = closest(ix, ks); throw err('E401', `key ${JSON.stringify(ix)} is not in the map`, pos, s ? `did you mean ${JSON.stringify(s)}? or use get(m, key, default)` : `use get(m, ${JSON.stringify(ix)}, default) or check has(m, ${JSON.stringify(ix)}) first`); }
      return v.get(ix);
    }
    if (v instanceof Rec) throw err('E300', `cannot index a ${v.t}`, pos, 'read fields with rec.field');
    throw err('E300', `cannot index ${typeOf(v)}`, pos, 'only list, str and map can be indexed');
  }
  field(v, name, pos) {
    if (v instanceof Rec) {
      if (name in v.f) return v.f[name];
      const s = closest(name, Object.keys(v.f));
      throw err('E306', `${v.t} has no field '${name}'`, pos, (s ? `did you mean ${s}? ` : '') + `fields: ${Object.keys(v.f).join(', ')}`);
    }
    const h = BUILTINS[name] ? `Clay has no methods; call ${BUILTINS[name].sig.split(' ->')[0]}`
      : FOREIGN[name] ? `Clay has no methods; use ${FOREIGN[name]}`
      : v instanceof Map ? `map values are read with m["${name}"]` : 'only records (your own types) have fields';
    throw err('E306', `${typeOf(v)} has no field '${name}'`, pos, h);
  }
  mkRec(n, env) {
    const T = this.types.get(n.name); const f = Object.create(null); const given = new Map();
    for (const g of n.fields) {
      if (given.has(g.name)) throw err('E201', `field '${g.name}' is given twice`, g.pos);
      const fd = T.fields.find(x => x.name === g.name);
      if (!fd) { const s = closest(g.name, T.fields.map(x => x.name)); throw err('E306', `${n.name} has no field '${g.name}'`, g.pos, (s ? `did you mean ${s}? ` : '') + `fields: ${T.fields.map(x => x.name).join(', ')}`); }
      given.set(g.name, [this.eval(g.e, env), g.pos]);
    }
    for (const fd of T.fields) {
      if (!given.has(fd.name)) throw err('E306', `${n.name} is missing field '${fd.name}'`, n.pos, `every field is required: ${n.name}{${T.fields.map(x => `${x.name}: ${tyStr(x.ty)}`).join(', ')}}`);
      const [v, p] = given.get(fd.name);
      if (!fits(v, fd.ty)) throw err('E302', `field ${fd.name} of ${n.name} must be ${tyStr(fd.ty)}, got ${whatIs(v, fd.ty)}`, p, tyHint(v, fd.ty));
      f[fd.name] = v;
    }
    return new Rec(n.name, f);
  }
  assign(s, env) {
    const t = s.target; const v = this.eval(s.e, env);
    const combine = old => s.op === '=' ? v : this.arith(s.op[0], old, v, s.pos);
    if (t.k === 'var') {
      const b = this.find(env, t.name);
      if (!b) { if (BUILTINS[t.name]) throw err('E202', `'${t.name}' is a built-in function and cannot be assigned`, t.pos); throw err('E203', `'${t.name}' is not defined`, t.pos, `declare it first: var ${t.name} = ...`); }
      if (!b.mut) throw err('E202', `'${t.name}' is a let and cannot change`, t.pos, `declare it with var ${t.name} = ... if it needs to change`);
      const nv = combine(b.v);
      if (b.ty ? !fits(nv, b.ty) : typeOf(nv) !== b.t) { const ty = b.ty || { n: b.t }; const h = tyHint(nv, ty); throw err('E302', `'${t.name}' holds ${b.ty ? tyStr(b.ty) : b.t}, cannot store ${whatIs(nv, ty)}`, s.pos, h || 'a variable keeps its type; make a new variable instead'); }
      b.v = nv; return;
    }
    if (t.k === 'index') {
      const c = this.eval(t.e, env), ix = this.eval(t.ix, env);
      if (Array.isArray(c)) { const old = this.index(c, ix, t.pos); c[Number(ix)] = combine(old); return; }
      if (c instanceof Map) {
        if (typeof ix !== 'string') throw err('E300', `map keys are str, got ${typeOf(ix)}`, t.pos, 'convert with str(x)');
        c.set(ix, s.op === '=' ? v : combine(this.index(c, ix, t.pos))); return;
      }
      if (typeof c === 'string') throw err('E300', 'strings cannot be changed in place', t.pos, 'build a new string instead');
      throw err('E300', `cannot index ${typeOf(c)}`, t.pos);
    }
    const r = this.eval(t.e, env); const nv = combine(this.field(r, t.name, t.pos));
    const fty = this.types.get(r.t).fields.find(f => f.name === t.name).ty;
    if (!fits(nv, fty)) throw err('E302', `field ${t.name} of ${r.t} must be ${tyStr(fty)}, got ${whatIs(nv, fty)}`, s.pos, tyHint(nv, fty));
    r.f[t.name] = nv;
  }
}

function wrap(x, it) {
  if (x instanceof ClayError) return x;
  if (x instanceof RangeError) return err('E502', 'too much recursion', it && it.lp, 'make sure the recursion reaches a base case, or use a loop');
  return err('E900', 'internal error: ' + (x && x.message || x), it && it.lp, 'this is a bug in Clay itself, not your code');
}

function run(src, opts) {
  opts = opts || {};
  const output = [];
  const res = { ok: true, error: null, tests: [], output, steps: 0 };
  let it = null;
  try {
    const prog = parse(src);
    it = new Interp({ out: opts.out || (s => output.push(s)), maxSteps: opts.maxSteps });
    it.setup(prog);
    it.block(prog.filter(s => s.k !== 'test'), it.global);
    if (opts.test) for (const t of prog) if (t.k === 'test') {
      it.steps = 0; it.depth = 0; it.stack = [];
      try { it.block(t.body, new Env(it.global, true)); res.tests.push({ name: t.name, ok: true }); }
      catch (x) { res.tests.push({ name: t.name, ok: false, error: wrap(x, it) }); }
    }
  } catch (x) { res.ok = false; res.error = wrap(x, it); }
  res.steps = it ? it.steps : 0;
  if (res.tests.some(t => !t.ok)) res.ok = false;
  return res;
}

function check(src) { try { parse(src); return null; } catch (x) { return wrap(x); } }

function format(e, src) {
  const lines = (src || '').split('\n');
  let s = `error[${e.code}]` + (e.pos ? ` line ${e.pos.line}:${e.pos.col}` : '') + `: ${e.message}`;
  if (e.pos && lines[e.pos.line - 1] !== undefined) {
    const L = lines[e.pos.line - 1].replace(/\t/g, ' '), n = String(e.pos.line);
    s += `\n  ${n} | ${L}\n  ${' '.repeat(n.length)} | ${' '.repeat(Math.max(0, e.pos.col - 1))}^`;
  }
  if (e.detail) s += '\n' + e.detail.split('\n').map(l => '  ' + l).join('\n');
  if (e.trace && e.trace.length) {
    const fr = []; for (const f of e.trace.slice().reverse()) { const l = fr[fr.length - 1]; if (l && l.name === f.name && l.line === f.pos.line) l.n++; else fr.push({ name: f.name, line: f.pos.line, n: 1 }); }
    s += fr.slice(0, 6).map(f => `\n  in ${f.name}(), called at line ${f.line}` + (f.n > 1 ? ` (x${f.n})` : '')).join('') + (fr.length > 6 ? `\n  ... ${fr.length - 6} more` : '');
  }
  if (e.hint) s += `\n  fix: ${e.hint}`;
  return s;
}

const SPEC = `# Clay language spec (complete; v1)
Clay is a small, strict language built for AI to write. One way to do each thing, no hidden behaviour.

## Values and types
int (whole numbers, any size), float (1.5, always has a dot), str ("double quotes"), bool (true/false),
list ([1, 2, 3]), map ({"key": value}, str keys, keeps insertion order), fn, records (your own types), none (only what a function with no -> type returns).
Type names in annotations: int float str bool list map fn any none, list[T], map[T] (T = value type), or a Capitalized record type.
No null, no truthiness, no implicit conversion. int and float never mix: 1 + 2.0 is an error; write float(1) + 2.0.

## Names
variables, functions, fields: lowercase_snake. Types: Capitalized. No shadowing inside a function: a name cannot be redefined in the same function (or at top level); parameters and locals may reuse top-level names.
Built-in names cannot be redefined. Comments start with #.

## Statements (one per line; no semicolons)
let x = 1              # cannot be reassigned
var y = 2              # can be reassigned; keeps its type forever
let z: list[int] = []  # optional type annotation (checked)
y = 3   y += 1   y -= 1   y *= 2     # also xs[i] = v, m["k"] = v, rec.field = v
if c { } elif c { } else { }         # conditions must be bool
while c { }
for x in xs { }        # list items; str characters; map keys; for i in 0..n is 0 to n-1
break   continue
fn add(a: int, b: int) -> int { ret a + b }   # every parameter needs a type; -> T required if it returns a value
fn log(msg: str) { print(msg) }               # no -> means it returns nothing
type Point { x: float, y: float }             # top level only
assert a == b, "optional message"
test "adds numbers" { assert add(1, 2) == 3 } # top level only; run with Test
A line holding only an expression must be a call (print(x) ok, x + 1 alone is an error).
Functions are hoisted: call them before or after their definition.

## Expressions (lowest to highest precedence)
or  |  and  |  not  |  == != < <= > >= (no chaining)  |  a..b (int range, end excluded)  |  + -  |  * / // %  |  -x  |  call f(x), index xs[i], field p.x
Mixing and with or needs parentheses: (a and b) or c.
+ works on int+int, float+float, str+str, list+list. / is float only; // is floor division for ints. % on ints follows the dividend's sign.
== compares deeply (lists, maps, records). Comparing different types is an error.
Strings: "hi {name}, you are {age + 1}" (any expression inside {}), escapes \\n \\t \\" \\\\ \\{ \\}. Strings stay on one line.
Indexes start at 0, no negative indexes, out of range is an error. Missing map key is an error (use get).
Lambdas: fn(x: int) -> int { ret x * 2 }. Closures capture variables.
Records: Point{x: 1.0, y: 2.0} (every field required), read p.x, set p.x = 3.0 (if p is any binding).
Lists and maps are shared by reference; use copy(x) for a separate one. for loops iterate over a snapshot.

## Built-in functions
print(...values) len(x) str(x) int(x) float(x) type_of(x) copy(x)
push(xs, v) pop(xs) insert(xs, i, v) del(xs_or_m, i_or_key) slice(x, start, end) contains(x, v) index_of(x, v) (-1 if missing)
join(xs, sep) split(s, sep) chars(s) upper(s) lower(s) trim(s) replace(s, old, new) starts_with(s, p) ends_with(s, p) repeat(s, n) ord(c) chr(n)
keys(m) values(m) has(m, k) get(m, k, default)
map(xs, f) filter(xs, f) reduce(xs, f, start) sort(xs) sort_by(xs, key_fn) reverse(x) sum(xs) min(...)/max(...) (two+ values or one list)
abs(x) sqrt(f) pow(a, b) floor(f) ceil(f) round(f) fixed(f, digits) -> str
seed(n) rand_int(low, high) (inclusive) rand_float()   # seeded with 1 at start, so runs are repeatable
fail(message)   # stop with an error
sort, map, filter, reverse, copy return new lists; push, pop, insert, del change the list in place.

## Errors
Every error has a code, a line:col, the source line with a ^ marker and a "fix:" hint.
E100 syntax  E101 string  E102 bad character  E103 and/or mix  E104 chained comparison  E105 unused value  E106 name case
E200 undefined name  E201 already defined  E202 let reassigned  E203 assign to undefined
E300 bad operand types  E301 condition not bool  E302 wrong type  E303 wrong return  E304 wrong argument count  E305 not a function  E306 bad field  E307 unknown type
E400 index out of range  E401 missing map key  E402 division by zero  E500 assert failed  E501 step limit (5,000,000)  E502 recursion too deep  E600 fail() called

## Style
Prefer small typed functions with a test for each. Return early with ret. Build strings with "{x}".`;

const Clay = { run, check, parse, lex, format, SPEC, BUILTINS: Object.keys(BUILTINS), KEYWORDS: [...KW], VERSION: '1.0' };
if (typeof module !== 'undefined' && module.exports) module.exports = Clay;
G.Clay = Clay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
