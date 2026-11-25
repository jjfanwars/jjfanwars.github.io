# Writing IB-style practice questions for the IB Study site

You are writing ORIGINAL exam-style practice questions for IB Diploma students. They appear in the site's
Practice tab, in timed mocks, and are marked by Claude against the markscheme you write. Quality bar: they
should be indistinguishable in style, rigour and difficulty from real IB exam questions, and every answer
must be correct.

## Never copy
Write every question yourself. Do not reproduce or closely paraphrase real IB past-paper questions,
IB Questionbank items, Revision Village, Save My Exams, Kognity, textbook exercises or any other source.
Real-world facts and data must be accurate; if you need numbers that are not well-established facts,
make them clearly illustrative ("illustrative data"). Never invent quotations attributed to real people.

## Output
Write a Python script that builds the questions as Python dicts and saves them with
`json.dump(qs, open(OUT, 'w'), indent=1, ensure_ascii=False)` (this avoids JSON escaping mistakes with LaTeX
backslashes). OUT is the file path given in your task. Then run
`python3 /home/user/IBstudykic.github.io/qbank/check.py OUT` and fix everything it reports until it prints OK.

Each question is one dict:

| field | value |
|---|---|
| `id` | `gen:<book>:<topic code>:<n>` unique, e.g. `gen:chem:R2.2:7` |
| `book` | given in your task (`chem`, `phys`, `math`, `glopo`, `tokc`) |
| `kind` | sciences: `mcq` or `structured`; maths: `mcq` is not used, use `mexam`; Global Politics: `short`, `p1`, `essay`; TOK: `discuss` or `essay` |
| `topic` | the syllabus code given in your task, e.g. `R2.2`, `A.3`, `SL5.4`, `GP2` |
| `tname` | the topic title given in your task |
| `text` | the question, Markdown. One top-level question per item; multi-part questions keep all parts (a), (b)(i)... inside `text`, each part ending with its marks in square brackets, e.g. `[2]` |
| `marks` | total marks (integer). mcq = 1 |
| `ans` | mcq only: the correct letter `A`-`D` |
| `ms` | markscheme, Markdown (see below). Required for every question |
| `ctx` | optional shared setup shown in a box above the question (use only for a stimulus shared by several items, e.g. Global Politics Paper 1 sources). Most questions put their whole stem in `text` and leave this out |
| `diff` | 1 (straightforward), 2 (standard exam level), 3 (hard, top-band discriminator) |
| `paper` | sciences: `1A` (mcq), `1B` (data-based), `2` (structured); maths: `1` (no calculator) or `2` (calculator); GP: `1` or `2`; omit for TOK |
| `lvl` | `HL` if the content is HL-only (AHL), else omit |
| `calc` | maths only: `no` for paper 1, `yes` for paper 2 |
| `src` | always `gen` |
| `set` | always `IB-style practice` |

### Text conventions
- Maths and science: LaTeX in `$...$` (inline, no space just inside the dollars: `$x^2$` not `$ x^2 $`; never a bare `$` for money) and `$$...$$` (display). Chemistry species and equations with mhchem: `$\ce{2H2(g) + O2(g) -> 2H2O(l)}$`, `$\ce{<=>}$` for equilibrium. Units upright: `$9.81\ \text{m s}^{-2}$` (IB style: negative indices, not slashes).
- Global Politics and TOK: plain prose, no `$` at all.
- MCQ: stem, then a blank line, then exactly four options on their own lines starting `A. `, `B. `, `C. `, `D. ` (use `I.`, `II.`, `III.` combination style sometimes, as IB does). One unambiguous correct answer; distractors must be the mistakes real students make.
- Use IB command terms precisely (state, outline, describe, explain, calculate, determine, deduce, sketch, show that, suggest, discuss, evaluate, to what extent) and give marks that fit the command term.
- Data tables as Markdown tables.

### Diagrams
Use a diagram wherever a real IB question would (graphs, energy profiles, Maxwell-Boltzmann curves, titration curves,
circuits, field lines, free-body diagrams, ray/wave diagrams, apparatus outlines, molecule structures, Venn/tree
diagrams, function graphs, data plots, supply-demand). Aim for at least a quarter of science/maths questions.
- Save as SVG in `/home/user/IBstudykic.github.io/qbank/img/` named after the question id with `:` replaced by `_` (add `-2`, `-3` for more), e.g. `gen_chem_R2.2_7.svg`, and reference it in `text` (or `ctx`/`ms`) as `![short description](qbank/img/gen_chem_R2.2_7.svg)`.
- Graphs and plots: matplotlib (`plt.savefig(path, format='svg', bbox_inches='tight')`), figure width 6-7 in, font size 12-14, labelled axes with units, white background, black/dark lines, no titles that give the answer away. Molecules: RDKit (`rdkit.Chem.Draw.rdMolDraw2D.MolDraw2DSVG`). Circuits, free-body and apparatus: hand-written SVG with a white background `<rect>`, dark strokes, `font-family="Arial, sans-serif"`, `font-size` 14 or more, a `viewBox` and width/height (max 640 wide).
- The diagram must be accurate and match the numbers in the question. Open the SVG text after writing it and check labels, values and that nothing overlaps or is cut off.
- Markscheme answers may also use a diagram (e.g. the expected sketch).

### Markschemes (`ms`)
- Sciences: one marking point per line, each worth one mark, IB style: `- correct substitution into $Q = mc\Delta T$ ✓`, with the final answer and units, accepted alternatives (`Accept ...`, `Do not accept ...`, `Award [2] for correct final answer`), and ECF notes where a later part depends on an earlier one. For mcq: one or two sentences on why the answer is right and why each tempting distractor is wrong.
- Maths: full worked solution with IB mark codes: `(M1)` method, `A1` answer, `R1` reasoning, `AG` answer given, `(A1)` implied, follow-through `FT` notes. Give the exact or 3 s.f. answer as IB would.
- Global Politics: indicative content (key points, concepts, relevant real-world examples and the perspectives a strong answer covers), then the markbands for that question type (essay: IB 15-mark markbands; short: what earns each mark).
- TOK: what a strong response does (knowledge questions, concepts, perspectives, specific real-world examples, counterclaims, evaluation), and the markbands out of 10.

## Process (do all of it)
1. Plan the topic: list the syllabus understandings and skills, and cover them across the questions (do not cluster on one idea). Mix difficulties (roughly 30% diff 1, 45% diff 2, 25% diff 3) and include genuinely hard, multi-step questions.
2. Write the questions and markschemes.
3. Independent check: for EVERY question, solve it again from scratch without looking at your markscheme (actually compute numbers; for mcq confirm exactly one option is correct). Fix any question where your answers disagree, the wording is ambiguous, data are missing or inconsistent, or the marks don't fit.
4. Run check.py and fix until OK.
5. Report: number of questions per topic, number of diagrams, anything you were unsure about.

## Files you may touch
Only your OUT file, your own build script (put it in /home/user/qtools/), and SVGs in qbank/img/ whose names start with the ids of your own questions. Do not edit index.html, commit or push.
