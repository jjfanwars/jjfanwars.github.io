# Courtroom Duel (`legal/`): notes for Claude

Read `CLAUDE.md` first (shared rules). Split out of it on 17 Nov 2026; keep this file up to date when you change the game.

- **Courtroom Duel (`legal/index.html`, live at /legal; `legal.html` just redirects; 12 Nov 2026):** Legal Studies revision game (not part of jjfanwars). 3D courtroom built procedurally on `three-r170.js` (canvas textures, PMREM env from a mini scene, window shadows from the sun through a split left wall, custom HDR bloom + ACES in `render`/`PP`). Cases in `CASES`, questions in `Q` (model answer `a`, marking points `k`, marks `m`). Each answer is marked by Claude Haiku through the relay (`grade` -> relay `/legal/grade`, `legalGrade` in relay/worker.js, secrets ANTHROPIC_KEY + LEGAL_PASS live only in Cloudflare; the page stores only the password in `cd-pass`; the menu's "Owner" box posts the key to `/legal/setup`, kept in the `Legal` Durable Object) or self-marked. First person as the left barrister (`FPV`, `eyeOf`, `fpLook`, viewmodel arms `VM`/`VMP`, screen aura `uAu`, hurt vignette `uHurt`); third-person cuts for intro, the MOGGED hero shot and the verdict. `turn` plays attack/counter (aura, MOGGED, combo), the counter has an OVERRULE timing tap (`qte`), a 40-60% answer triggers a Glock quick-draw (`quickDraw`, `mkGlock`, `fire`). `verdict` saves `cd-save` (aura rank, best grade per case). Test hook `window.__CD`.

## 24 Nov 2026: polish pass
- **Leave/restart safety:** every case run has a token (`G.run`, `live(run)`); `startCase` bumps it and clears `G.busy`, so leaving mid-turn (ruling, self-mark, cutscene) no longer leaves "Present argument" dead or lets the old turn keep playing into the next case. `say` won't reopen the dialogue box after you leave, and a newer `say` stops an older one typing. `menu()` also hides the duel/QTE overlays and resets timer, saturation, speed lines and the Glocks.
- **Verdict:** saved as soon as the verdict starts; the Leave button turns into **Skip** for the verdict cutscene (`G.skipV`, `W8` races each wait). An exact credibility tie goes to you if your average was 50%+.
- **Answer box:** live word count + Ctrl/⌘+Enter hint (`wc()`), "Write your argument first" on an empty submit. Peek button has a tooltip with its full cost.
- **Keyboard:** `focusSoon` focuses Next/Verdict buttons after a short delay (not on touch), number keys award self-marks, Enter in the password boxes submits, visible focus rings.
- **Timer:** turns red and blinks under 10 s, then says "Speed bonus gone".
- **Accessibility/mobile:** Leave/mute buttons move to the top right under 1100px (they were hidden under the question panel on phones), pinch zoom allowed (no `maximum-scale`), 16px fields on phones (no iOS focus zoom), `prefers-reduced-motion` softens shake/flash (`RM`) and the slam text wobble.
- Quick Trial uses a proper shuffle.

## 24 Nov 2026 (second pass)
- **Per-argument history:** `SAVE.q[id] = {b, l, n, t}` (best and last score as a fraction, attempts, time), written by `noteQ` as soon as an answer is ruled on (so it survives leaving mid-case). "Mastered" (`mastered`) = last attempt 75%+. The menu shows "X/20 mastered · Y attempted" (`#mastTxt`), won cases show "n/N mastered", and the question panel has a "Best x/m" / "New" tag (`#qBest`).
- **Revision Hearing** (`CASES` id `rv`, `rev:1`, `free:1`): 5 arguments from `weakQs` (last attempt under 75%, worst first, then never tried, then the stalest mastered). Locked until any argument has been tried; never saves a case grade. The verdict offers "Revise weak spots" when any argument scored under 75%. "Next case" now skips free cases (`nx.free`) instead of relying on Quick Trial being last.
- **Verdict breakdown:** every argument listed with its colour-coded score; each opens its model answer (`.vl`). Replaces the single "Revise next" line. The verdict overlay scrolls on short phones and is a labelled dialog.
- **Your own answer:** self-marking shows your argument beside the model answer (it was hidden before, so you had nothing to compare); Claude-marked rulings have a "Your argument" fold and a "New personal best" line (`res.pb`).
- **Low credibility warning:** an HP bar at 30% or less pulses red (`.hp.low`; static red border with reduced motion).
- Leave-court confirm says argument scores are kept. `__CD` also exposes `SAVE`, `weakQs`, `noteQ`, `selfMark`, `showRuling` for tests.
