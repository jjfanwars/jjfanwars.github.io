---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# YeShip in-game UI

Scope: every HTML surface of YeShip over the WebGL view: main menu, loading, on-foot HUD, flight HUD, map panels and burn node, warp bar, mission card and list, pause card, test menu, flight report, station readout and markers, rocket builder. Mode: Operate.
Audience and task: the owner and friends on laptops, glancing at numbers while watching the rocket; calm stretches and tense moments.
Constraints: plain HTML/CSS/JS, no build step; ids and DOM that the JS reads stay; keyboard controls unchanged. Owner's complaints: generic dark glass panels, too much text, cluttered and overlapping.

## Direction contract
THESIS: Every readout is set like a page of a 1970s space agency's graphics standards manual: solid off-white plates, black grotesk, one signal red, ruled tables on a strict grid. It refuses the dark translucent glass-card HUD and the neon sci-fi overlay.
OWN-WORLD: Plate #F3F3F0 (cool manual stock), ink #121314, secondary ink #5A5E63, hairline rules in ink, signal red #D8342A for the wordmark, the current step, danger and the active stage, nothing else. Square corners, solid plates with a short soft drop shadow, no blur. One grotesk (Archivo, self-hosted) at 500/600, caps labels tracked .08em at 11px, tabular figures for all data. Inverse ink plates (white on #121314) only for transient messages.
STORY: The player reads altitude, speed, orbit and stage at a glance without words, sees exactly one next action, and finds every control by its key.
FIRST VIEWPORT: Flight: centre of the screen empty for the rocket. Bottom left a flight-data plate (ALT, SPEED, AP, PE as a two-column ruled table, big tabular values), beside it the stage elevation plate. Bottom right the autopilot keys as a ruled segmented grid. One next-action strip above the data plate (key cap + verb). Top left location, top centre warp scale, top right the mission plate showing the current step large. Signature move: the stage elevation, a 1px technical side drawing of the live stack drawn from the stage geometry, current stage outlined in red with its fuel as a fill, dropped stages gone.
FORM: Impeccable's pick (agency graphics standards manual), chosen by the owner over the assigned departure board; seed:2258864797d084c1
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
