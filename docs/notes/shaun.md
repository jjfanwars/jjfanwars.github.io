# Last Stand (`shaun/`): notes for Claude

Read `CLAUDE.md` first (shared rules). Keep this file up to date when you change the game.

**Queued work:** before working on this game, check open GitHub issues labelled `shaun-request` (`gh issue list --label shaun-request`). They come from the in-game request box. Close an issue once its request is built.

## What it is (19 Nov 2026)
Live at /shaun. First-person "final stand" horde shooter: an armoured trooper on a sandbag barricade on a desert planet at dusk, holding off endless waves of warrior bugs with a six-barrel rotary cannon. No levels, no upgrades. The player never moves.

The owner's design brief is **brain-off**: no skill needed beyond sweeping the gun left and right.
- Aim is yaw only. Mouse X (pointer lock), A/D or arrow keys, or touch drag. Pitch is automatic: `stepGunner` pitches toward the current target.
- Auto-fire is ON by default (`SET.auto`, F toggles it; when it's off, hold LMB).
- `pickTarget(g)` is the aim assist: the best live bug in a wide yaw cone (0.2 rad plus the bug's angular size). Every round hits that bug. Normal bugs have 3 HP, runners 2, brutes 20.
- Overheat is cosmetic: at full heat there's a 0.6 s vent (`P.vent`) with steam, then heat drops to 0.55. R or RMB vents by hand.
- Waves (milestone 1 pacing): wave n spawns for `8 + n` s at `spawnRate(n) = min(30, 6 + 1.5n)` bugs/s, times `crewMul()` (+50% per extra squad gunner). Once the quota is out and 4 or fewer bugs are left, the wave counts as **held** (`waveCleared`: +12 armour, full shield, "WAVE n HELD" banner + chime) and the next wave starts 3.5 s later. If the squad is swamped, the next wave starts 14 s after the quota anyway (no patch). At most 380 live bugs; pool `MAXB` = 520 including corpses (when full, `spawnBug` recycles the oldest corpse).
- Rounds punch through: half of them also hit the nearest bug within 2.6 m (x size) of the target (`nearBug`), so dense crowds die faster.
- The fail state is forgiving. Attackers' summed dps is soft-capped (`4 * (dps/4)^0.6`), drains a shared shield (100, +45/s after 1.2 s without a hit), then hull (`G.hp`) at 0.2x. Under 30 hull: "ARMOUR CRITICAL" banner + alarm (`G.lowWarn`). Hull 0 = OVERRUN end card (wave, kills, time held `G.runT`, best; Space restarts).
- First brute of a run gets a "BRUTE" banner (`bruteWarn`).
- Bot play-test (always sweeping to the nearest bug): solo lasts about 4 min, dies on wave 10 with ~1900 kills, and the last 35 s is a visible slide (shield gone, armour dropping, one patch). A human is worse, so expect wave 6 to 9.

## Code map (`shaun/game.js`; UI in `shaun/index.html`)
- **Renderer:** own post chain (`render`). The scene goes to a HalfFloat MSAA RT, then a bright pass, two blur levels, and the composite `compM`, which does ACES, gamma, vignette, grain, chromatic aberration and the damage tint. The renderer itself has `NoToneMapping`. Low quality (`SET.gfx`) lowers the pixel ratio and turns off shadows and MSAA.
- **World:**
  - Sky is a ShaderMaterial (`skyM`, sun disc, glow, `flash` uniform for artillery). It also feeds a PMREM environment map.
  - Terrain height grid `HG`/`gH` (2.5 m, ±300 m) comes from `H0`: flat near the base, dunes beyond. There is a far plane underneath.
  - Also: mesas, instanced rocks, sandbag arc (instanced), concrete and plates using `../tex/prop_*`, a crashed dropship with `FIRES`, burning hulks, two searchlight beams (`BEAMS`), flares (`flareL`) and horizon artillery flashes.
- **Bugs:** instanced meshes `BODY` (merged vertex-coloured geometry from `bugBodyGeo`), `LUP`/`LLO` (6 upper and 6 lower leg segments per bug, placed with `segMat`).
  - `drawBug` handles gait (tripod), claws slashing in the attack state (`st` 1), leaps (`st` 2), dead flip with curling, twitching legs, and sinking after 6 s. `b.legs` is a 6-bit mask, so legs can be blown off.
  - `TYPES`: 0 warrior, 1 runner/leaper, 2 brute.
  - Hit reaction: `hitFx` sets `b.hk` (decays in `stepBugsCommon`); `drawBug` snaps the head up, shoves the body back and jitters the roll. Brutes throw armour sparks. Host side, `damageBug` staggers (`b.stag`: 35% speed for 0.35 s, brutes 0.15 s) and shoves light bugs back 4 cm per round, so a hosed bug visibly struggles forward.
  - Limp: missing walking legs make the bug lean toward that side and lurch (speed pulses with the gait).
  - Death: `killBug` gives the corpse momentum (`dvx/dvz/dvy`: slides forward at 70% of its run speed, small hop, leapers fall out of the air, bounce), a tumble target `droll` (on its back or its side) and yaw spin `dspin`. 25% of warriors and 45% of runners gib instead (`b.gib`: body vanishes, every leg and extra chunks fly, big slime burst, freed after 1 s). Brute deaths add dust, a low thump and camera shake when within 60 m.
  - Separation checks the 3x3 neighbour cells (`cell()` uses floor, so no double-size cell at 0).
  - Host AI: `stepBugsHost` (spawning, waves, grid separation, attacking at the barricade, `hurt`).
- **Effects:** `Parts` point systems. `PA` is additive (sparks, fire, embers), `PS` is smoke and dust, and `PG` is slime blobs that stick to the ground. Also goo decals `DEC`, carapace chunks `CHK`, blown-off legs `LGD`, tracers `TRC` and hot casings `CAS` (with tinkle sounds). Hit and death effects are in `hitFx`/`deathFx`.
- **Gun:** `makeGun(fp)` is used for the first-person view (with gauntlets) and for remote marines (`makeMarine`). `updateGunVisual` handles barrel spin, heat glow on `barrelM`, and the muzzle flash sprites. `stepFeel` handles recoil springs (kick, muzzle climb, camera pitch and yaw), trauma shake, sway, breathing, FOV punch, drift and the muzzle light.
- **Audio:** `Sfx` is all procedural WebAudio buffers: shot (3 variants), tink, squelch, crunch, squeal, screech, chitter, boom, zap and horn, plus loops for wind, hiss and rattle and a motor whine from oscillators (`Sfx.gun`). It starts on first input. `SET.vol` is the master volume.
- **HUD:** one 2D canvas (`drawHud`): crosshair bloom, hit and kill markers, damage-direction arcs, a motion tracker with sweep (front arc, 200 m), shield, armour segments, heat, RPM, auto-fire state, wave, kills, squad list and scrolling readouts. The CSS visor edge and scanlines are in index.html.
- **Screens:** menu (start and squad buttons sit at the top so they are visible at 540 px tall), pause (ESC or the touch `II` button `#bPauseT`), end card `showEnd(title, sub, w, k, t, best)` used for OVERRUN and SIGNAL LOST. Callouts (`callout`) shrink for long text.
- **Settings:** stored in localStorage `ls-set` (sens, vol, gfx, auto, name). The best wave is in `ls-best`.

## Multiplayer (squad, up to 4)
- Uses the shared relay `wss://jjfanwars-relay.businessautomationvic.workers.dev` with rooms at `/room/<5 letters>`. The `Net` module is copied from `hollow/game.js` and uses the same frame format. The worker did not change.
- **Host squad:** the game starts at once, and the code and `?room=CODE` link are copied and shown in the pause menu and HUD. Friends join mid-fight.
- **Join:** the player enters the code (or it is prefilled from `?room=`). The host caps the squad at 3 guests.
- **Host-authoritative:**
  - The host runs the bug AI and resolves every gunner's shots. Guests send `{t:'aim', y: yaw, f: fire}` at 15 Hz; the host fires for them with the same `pickTarget`.
  - The host broadcasts `packSnap()` at 12 Hz: flat bug array `[id, x*10, z*10, yaw*100, type|st<<2|legs<<4, y*10]`, events `e` (`['k', id, slot]` kills, `['l', id, leg]`, `['w', wave]`), gunners `[id, yaw*100, fire, kills]`, plus shield, hp, kills and wave.
  - Guests interpolate bug positions (`stepBugsGuest`) and run every gunner's shots as visual-only effects locally (same target pick), so splatter is instant. Only kills and HP come from the host.
- Other messages:
  - `crew` (id, slot, name list) places the marines at `SLOTX`.
  - `start` (sent to a joiner), `over`, `restart` (the host clicks restart).
- Shield and hull are shared by the squad. Kills are shown per player and in total.
- Snapshot events also carry `['c', wave]` (wave held), `['b']` (first brute) and `['a']` (armour critical) so guests get the same banners.
- Host leaving: guests get a "Host disconnected" toast; if the host is not back within 6 s (`_hostback` cancels) they get the SIGNAL LOST end card with a Back to menu button. Not done: host migration.

## Testing
- `?test` exposes `window.__LS` = {start, fire(bool|null), step(dt, n, noRender), setYaw, host, join(code), G, P, bugs, Sfx}. `step(1/20, 100, true)` simulates 5 s without rendering (fast); a bot that turns `P.yaw` toward the nearest bug each step is a good stand-in for a brain-off player.
- Two pages in one headless browser can host and join through the real relay (the host page's clipboard write is refused headless; that's caught).
- To drive frames by hand, stub `requestAnimationFrame` and then call `step`.
- Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader`. It is very slow at this scene size, so keep the step counts small.

## Changelog
- 19 Nov 2026, milestone 1 polish: new wave pacing with a held-wave armour patch and lull, squad-size scaling, rounds punch through to a second bug, soft-capped barricade damage (slower, visible slide instead of a 5 s collapse), bug hit flinch/stagger/limp, corpse momentum and tumbling, gibs, heavier brute deaths, better crowd separation, ARMOUR CRITICAL and BRUTE banners, new end card (wave, kills, time held, best, Space to restart), SIGNAL LOST card when the host leaves, touch pause button, ESC toggles pause when the pointer isn't locked, menu buttons above the fold, muzzle light and gun reflections toned down (they blew out the sandbags and gun), sound balance (hit squelch no longer clips; horn, alarm and shield zap audible over the gun), shader warm-up so the first shots and the first squad join don't hitch, clipboard rejection error fixed.
