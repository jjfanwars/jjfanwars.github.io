# Surf Coast Family Hub (`hub/`, `hub2/`, `hub3/`, `hub4/`)

A website for a family wellbeing hub in Jan Juc (not a game). There are four takes; `hub4/` is the one in progress.

## hub4
- One page: a sticky `#stage` scroll scene (`#scene` is 620vh) that pencils in and then watercolours a sunset at Jan Juc as you scroll, followed by the content sections.
- The scene is built from data in the script:
  - `FILLS` `[d, colour, layer, t0, t1, scribble angle, width, kind]`. Kinds: `glit`; `band` (a 20px stroke clipped to the cliff); `band2` (a fill clipped to the cliff); `trunk`.
  - `LINES` `[d, layer, t0, t1, width, opacity, clip?]`.
  - The times are scroll progress from 0 to 1.
- The owner likes this art style (the cliff on the left, open sea with the sun, the beach with the family, dunes with a fence in front). A full redraw from the beach photos was rejected, so keep the style and only refine.
- Cliffs follow the owner's Jan Juc photos:
  - The face is steep and stepped (`CLIFF`, `LEDGES`), with a shaded side (`SHADE`) and thin layered bands that dip gently (`STRATA`).
  - Scrub caps the top (`bumps`/`band` along `CLIFF_TOP`), with a scrub strip at the base (`BASE`). There are houses and tea-trees (`TREES`) on top.
  - Bird Rock is a flat-topped stack on a rock platform (`ROCK`, `SHELF`).
  - In the distance, flat-topped cliffs run towards Bells (`HEAD`, `HEAD_FACE`).
- No kelp. The opening is a muted dusk gradient on `#stage`, not white paper, and the colours are slightly muted. The phone view is centred on x 880 so the sun stays in frame.

## familyhub/book.html (booking finder)
- Guided "who should I see" booking page for the live demo site (familyhub.aiautomationvic.com, served by the Cloudflare Worker `surfcoast-family-hub`; its source is not in this repo). Option 2 of the booking plan: no Halaxy API, it sends people to each practitioner's own Halaxy / Cliniko / website booking.
- Steps: who it's for (`WHO`) → what would help (`NEED`, per-who list with practitioner order) → Mental Health Treatment Plan + in person/online (only for needs with `plan`/`how`) → results with fee, Medicare rebate and out-of-pocket, and a tip for which Halaxy service type to choose. "Body care" shortcut. State lives in the URL hash (`who, need, plan, how, r`) so Back and shared links work. Nothing is stored or sent.
- Practitioner data (`P`) and fees come from the demo site's team and fees pages (Nov 2026). Maddy's and Melissa's fees and assessment fees are unknown, so the page says "ask us".
- The head has a PREVIEW ONLY block (base href to the demo site, noindex, same-origin paper-edge masks from `familyhub/img/`). Delete it to drop the file into the live site as `book.html`.
