# Rally co-op (driver + navigator) design

## Intent
Two-player online rally inspired by the co-op idea of *Left! Left! LEFT!*: the driver sees the road in first person through light fog and thick forest, and only the navigator has the stage map, so the driver depends on the navigator's callouts. Players talk in the same room or on a call; the game carries no voice.

## Goals
- Cars feel fast and engaging: real-ish handling (tyre grip curve, weight transfer, suspension, slides, handbrake), auto gearbox, speed sensations (FOV, shake, sound).
- One direct dirt route through a thick forest. Leaving the road means grass and trees you crash into.
- Corners of every tightness (pace-note grades 1 to 6, hairpins), jumps, crests and logs lying across half the road.
- First person for both players, mouse to look around. Driver uses WASD (Space handbrake, R recover).
- Navigator holds a paper map of the whole stage (right mouse raises it) with the car's position, hazards marked.
- Realistic look: PBR materials, sky and sun with shadows, fog, textured gravel road with ruts, conifer forest with undergrowth, roll-caged cockpit.

## Non-goals
In-game voice, more than 2 players, AI opponents, car damage models beyond a damage meter, phones/touch.

## Approach (picked)
- **Driver's browser runs the car** (zero input lag for the driver). It sends car state ~30 Hz; the navigator interpolates. Stage, terrain, trees and logs are generated from a shared seed on both sides.
- **Custom car model** (raycast suspension rigid body, simplified Pacejka tyres, friction circle, 4WD) instead of a physics library: easier to tune for fun.
- Rejected: host runs everything (driver would feel relay lag when the navigator hosts); deterministic lockstep (adds input delay, fragile for car physics).

## Structure
- Lives at `/rally/` (`rally/index.html` + classic scripts in `rally/js/`), uses `three-r170.js` from the site root and the jjfanwars relay unchanged; rooms are named `[Rally] ...`.
- Lobby: host picks stage, fog level and roles (swap button); guest joins by code or room list. Solo practice mode with an automatic co-driver for testing.
- Backup quick callouts: navigator keys (A/D + 1-6, J jump, L log, C crest, F flat out, B brake) show big on the driver's HUD and are spoken by speech synthesis.
- Stage flow: countdown, splits, finish, best time per stage in localStorage, restart. Recover (R) puts the car back on the road for +5 s.

## Builder's calls
Grades: 1 tightest (hairpin) to 6 near flat. Fog visibility roughly 80 to 160 m depending on setting. Logs block about half the road. Stage length about 3 to 4 km.
