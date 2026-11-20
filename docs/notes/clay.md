# Clay (clay/)

A small, strict programming language built for AI to write, with a browser playground. Live at https://jjfanwars.github.io/clay/.

- `clay/clay.js`: the whole language (lexer, parser, tree-walking interpreter, built-ins, `SPEC` text). Works in the browser (`window.Clay`) and node (`require`). API: `Clay.run(src, {test, maxSteps})` -> `{ok, error, tests, output, steps}`, `Clay.format(err, src)`, `Clay.check(src)`.
- `clay/index.html`: playground. Textarea over a highlighted `<pre>` (`hlCode`), gutter, examples (`EXAMPLES`), Run/Test in a blob Web Worker (10 s kill, falls back to main thread), Share (`#c=` base64url), "Copy spec for AI", "Copy error for AI". Code saved in localStorage `clay-src`.
- Design rules: one way to do each thing; typed fn params, `-> T` required when returning a value; no null/truthiness/implicit int-float mixing; `let`/`var` (var keeps its type); no shadowing inside one function (`Env.root` marks function/global/test scopes); fns hoisted; types and tests top level only; a bare expression line must be a call.
- Values: int = BigInt, float = JS number, str, bool, list = Array, map = Map (str keys), records = `Rec`, `NONE`. Seeded RNG (`mulberry`, seed 1).
- Errors: `ClayError(code, msg, pos, hint, detail)` with a call trace. Codes are listed in `SPEC`. `FOREIGN` maps habits from other languages (return, .push, &&, else if, ...) to hints. Step limit 5M (`tick`), call depth 700.
- When changing the language, update `SPEC` too (it is what gets pasted into AI chats) and run the examples: `node -e "const C=require('./clay/clay.js');..."`.
