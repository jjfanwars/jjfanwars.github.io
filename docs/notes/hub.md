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

## familyhub/ (booking finder, live booking demo, Hub dashboard)
- Pages for the demo site (familyhub.aiautomationvic.com, served by the Cloudflare Worker `surfcoast-family-hub`; its source is not in this repo). Built from `familyhub/src/` by `familyhub/build.py`: `python3 build.py` writes preview pages (styles and photos load from the demo site, noindex) and `python3 build.py live` writes drop-in copies with relative links to `familyhub/live/`. Edit `src/`, never the built files. `src/shell.html` is the site's header/footer shell (copied from its book.html).
- `hub-core.js` (shared): practitioner data `P` (`live` = books through the hub, `leave:1` hides someone, demo `days/hours/len`), and a DEMO backend `HUB.api` in localStorage (`scfh-demo-v1`): seeded availability (`baseTaken`), bookings, waitlist, offers, SMS log, activity feed, settings, demo clock skew. Its API shape is what a real Worker + Halaxy API would serve.
- Refill engine: `slotFreed` (skips if under `minNotice`, "ask me first" mode, quiet hours) → `sendRound` texts the top `batch` matching waitlist people (practitioner, weekday, am/pm, oldest first, weekly cap, never the person who cancelled) → `claim` (first tap wins; a waitlist entry with `moveToken` gets their existing booking moved earlier and their old slot is offered on, a refill chain) → `tick` expires rounds and sends the next.
- `book.html`: guided finder (who → need → plan/how → results). Live practitioners show next free times, a "soonest" banner, a booking sheet (auto-picks the Medicare/private/telehealth service, .ics download, manage link, "text me if sooner"), and waitlist sign-up. Others keep link-outs. `manage.html`: move or cancel (late-cancel warning, reasons). `admin.html`: stats, spots being refilled, mock phones with tap-to-claim and Reply YES, "Everyone taps at once" race, skip time, coming-up list with Cancel, activity, waitlist, settings.
- Fees, appointment types (`svc`, Halaxy names so bookings land on the right service) and weekly working times (`sched`, `openFrom` = booked out until) come from each practitioner's public Halaxy page, read 20 Nov 2026. Halaxy has Ellie at $170 (the site says $190) and Maddy at $200. Adi's Preparing for Parenthood couple sessions ($245, or $365 for 90 min) and Adi/Hannah's eating disorder treatment are bookable. Assessment fees are not published anywhere ("ask us for a quote"). Melissa is on maternity leave; Michelle Joseph is online only until early 2027. Art therapy stays (Adi only removed play therapy, sleep and settling, and the music group). The finder shows Lifeline, PANDA and Kids Helpline. Address follows Halaxy (the owner's call): 16 Princes Tce, Jan Juc VIC 3228 (Jan Juc Village); fees follow Halaxy too. Child bookings ask for a parent name and the child's first name.
- Going live needs: Adi's practitioners in one Halaxy practice group with the API subscription, a Worker (webhook for cancellations, slots via `Appointment/$find`, create appointment, SMS provider), AU-hosted storage for the waitlist, and a privacy notice update.
