# Surf Coast Family Hub (`hub/`, `hub2/`, `hub3/`, `hub4/`)

A website for a family wellbeing hub in Jan Juc (not a game). Four takes; `hub4/` is the one in progress.

## hub4
- One page: a sticky `#stage` scroll scene (`#scene` is 620vh) that pencils in and then watercolours a sunset view of Jan Juc as you scroll, followed by the content sections.
- The scene is built from data in the script: `FILLS` `[d, colour, layer, t0, t1, scribble angle, width, kind, clip]` (kinds: `glit`, `band` and `in` clipped by `clip`, and `strk` for stroked shapes) and `LINES` `[d, layer, t0, t1, width, opacity]`. The times are scroll progress from 0 to 1.
- Parallax layers (`LAYERS`/`ORDER`): sky, sun, clouds, far (headland), sea, waves, birds, mid (cliff run), cliff (near bluff), beach, fam, foam, fg (scrub bank), grass.
- The layout comes from the owner's beach photos: a red-ochre bluff close on the left, the cliff line running back to a flat-topped headland, the beach curving away to the right, timber stairs down the bluff. No kelp.
- Helpers: `bumps`/`band`/`mass` make scrub edges, `yOn` gives a polyline's height at an x, and `bushTex` adds pencil texture to the scrub.
- The opening is a muted dusk gradient on `#stage`, not white paper. Mobile view centre is x 880 and the sun is at x 1000, so it fits both views.
