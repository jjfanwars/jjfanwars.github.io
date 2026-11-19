# Physics study hub (physics/)

Year 10 SCE16 Electricity & Astronomy revision site, one file: `physics/index.html`. Live at https://jjfanwars.github.io/physics/.

- Tabs: notes, formulas, Solar System / Gravity / Star Lives (Three.js r128 from cdnjs, one shared WebGLRenderer moved between stages), Circuit Lab (series-parallel solver `layoutCh`/`circSVG`, presets `CPRE`), Graph Lab, Static lab, Sheet answers (`SHEETS`, answers as on the class answer sheets, flagged where wrong), Claude tutor, flashcards, quiz, practice, study tricks, planner.
- Question diagrams: `QVIS` (sheet questions, key `"Sheet name|qid"`) and `QZVIS` (quiz index) rendered by `diagram()`.
- Hard mode: `HARD`, `HARDQ` quiz indices, `HARD_HOOKS`.
- Claude: uses the claude.ai artifact `sample` capability when opened there; otherwise an API-key popup (`openKey()`: "API key" button on the Claude tutor tab, `?key` in the URL, Ctrl/Alt+Shift+K, or tap the title 5 times) stores a key in localStorage (`sce16_apikey`) and calls the Messages API directly from the browser. Never commit a key.
- Source is built from parts outside the repo; edit `physics/index.html` directly for small fixes.
