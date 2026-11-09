# Iron Express 2.0: "All Aboard"

Status 2026-11-09: WP1 (walkable train: cars, decks, turret seats, falling off, caboose respawn) and WP5 (emote wheel, key B) are built and live. WP2 to WP4 still to do. WP5 (emote wheel) is separate but ships alongside.

## Why the current version is weak
Today every player sits in a gun car and shoots blobs for six minutes. Nobody moves and nothing breaks unless the locomotive's HP drops. There are no jobs, no reason to talk, no calm moments and no panic moments.

## The fantasy
You and your friends are the crew of an armoured steam train. You run up and down it. You shovel coal, put out fires, man the turrets, kick boarders off the roof, and sprint back from the caboose with a spare rail while the boiler screams. Then the line goes quiet for a minute and everyone dances on the roof until the next ambush.

## The train (front to back), all walkable
Cars follow the track like today (`railAt(R, T.s - rof)`). Each car has a flat **deck** (walk area) in car-local coordinates: `u` along the car (-len/2..len/2, +u = forward), `w` across (-wid/2..wid/2), plus a **roof** level on the closed cars.

| # | Car | Stations (`u`, `w`) | Notes |
|---|-----|---------------------|-------|
| 0 | Locomotive (cab at the back of it) | throttle lever, brake lever, whistle cord, firebox door, pressure gauge | You walk only in the cab (rear part). |
| 1 | Coal tender | coal pile (grab coal) | Hits can hole it: coal spills, so it needs patching. |
| 2 | Gun car A | turret seat (forward-facing 360 autocannon + rockets) | Roof hatch/ladder: the turret sits on top. |
| 3 | Flak car (open flatcar) | AA gun seat | Best against gunships. Open deck: boarders love it. |
| 4 | Gun car B | turret seat | |
| 5 | Caboose / workshop | tool rack (wrench), extinguisher rack, rail-section rack, crew bunks (respawn) | Respawn point. Its rear platform is a great place to mess around. |

Gangways connect the cars (walk across the coupling). Cars 2 to 5 have ladders to the roof. The roof is walkable but is a risk: low bridges knock you off unless you crouch.

## Jobs (things that go wrong and how you fix them)
Everything is "walk there, hold E", with a progress ring. Two players on the same job go 1.8x faster.

1. **Boiler pressure (always on).** Pressure (0..1) drains over time, faster at higher throttle. **Coal:** grab a shovel-load at the tender (E), carry it to the firebox (E): +0.18. Above 0.95 the safety valve screams. Above 1.0 for 6 s the boiler takes damage (locomotive -8%/s) unless someone pulls the **vent** (at the firebox: hold E, pressure -0.3). Below 0.25 the train crawls; at 0 it stops. Every crew size has a reason to keep one person "on coal" in rough patches.
2. **Throttle and brake.** At the cab: E toggles throttle notch 1/2/3 (speed 0.6/1.0/1.35 x RAIL_SPD). Brake lever: hold to stop (needed before a blown track, or the train derails: big locomotive damage plus everyone is knocked over).
3. **Fires.** Rockets and shells that hit a car can start a fire at a random spot on its deck. A fire hurts the car (1%/s), hurts crew who stand in it, and spreads to the next car after 20 s. Fix: carry an extinguisher from the caboose and hold E at the fire (4 s).
4. **Coupling damage.** Heavy hits can crack a coupling between two cars. Fix it with a wrench from the caboose: hold E at the gangway (6 s). If it isn't fixed in 30 s, the rear part **uncouples**: those cars roll to a stop and are left behind. Anyone standing on them has to jump off and run, and you lose their turrets. This is dramatic, and it's the main nerve-wracking job.
5. **Damaged turret.** A turret hit hard jams (cannot fire). Fix it with a wrench at the turret seat (5 s).
6. **Holed tender.** Coal leaks (pressure drains faster). Fix it with a wrench at the tender (4 s).
7. **Blown track ahead (scripted).** A warning 25 s before: "Track out ahead, BRAKE!". The driver stops the train before the gap marker. Crew grab **rail sections** from the caboose (one each), carry them to the gap, and hold E. Each rail placed fills 1/3; with 2+ players a rail takes 3 s, solo 6 s. Raiders attack the whole time.

Carrying: one item at a time (coal, extinguisher, wrench, rail). Q drops it. Items are shown in the blob's hands.

## Boarders (the fun fights)
Raider **bikers** (fast, `rifle`-like units, unit kind `raider`) ride alongside the train and jump onto open decks (flak car, caboose platform, tender) or the roofs. Boarders on board try to: start a fire, crack a coupling, attack crew. Crew fight them with their sidearm or **kick** (F = melee shove; a boarder kicked near an edge falls off and is gone). Turrets can't fire at boarders standing on the train (friendly-fire guard), so people on foot matter.

## Being a blob on a train (feel, no glitches)
- Crew are soldier units (`kind 'crew'`, a pistol plus a kick) owned by each player and always controlled in first person (Direct soldier mode, deck variant).
- Their position is stored **in train coordinates** on the server: `e.deck = {c, u, w, roof}`. Every tick the server turns it into world x/y/z from the car's pose, so everyone sees everyone exactly where they are on the moving train, with no drift.
- The client sends deck coords (not world coords) in the `pose` command (`c.dk = [c, u, w, roof]`).
- **Fall off:** walking past a deck edge when there's no railing, getting kicked, or a low bridge while on the roof. You land beside the track, the train keeps going, and you run after it (a comedic chase, 6 s max). After that you "climb back on" at the caboose. Never permanent.
- **Death:** crew respawn in the caboose bunks after 8 s. You can never be locked out.
- **Seats:** walk to a turret seat, press E, and you are in the gun car's turret (existing `moveRail` turret control). E or F stands you back up where the seat is. An empty turret is worked by AI at 40% accuracy, so solo is possible but rough.

## Pacing: acts with breathers (about 9 minutes total)
| Time | Phase | What happens |
|------|-------|--------------|
| 0:00 | **Station departure (calm)** | Tutorial prompts: walk, coal the boiler, sit in a turret, whistle. No enemies for 45 s. |
| ~0:45 | **Act 1: farmland** | 2 light raids, first fire, first coupling crack (forgiving 45 s). |
| ~2:30 | **Breather: lake viaduct** | 60 s calm. Scenery, nothing spawns, pressure drains slowly. Music low. A prompt: "Quiet stretch. Stretch your legs." Good time to dance on the roof, ride the cowcatcher, honk at cows on the line (whistle clears them, comedic moo). |
| ~3:30 | **Act 2: canyon** | Ambushes from both sides, boarders, the blown track repair stop under fire, gunships. |
| ~5:30 | **Breather: tunnel** | 40 s calm in a dark tunnel (low ceiling: anyone on the roof must crouch or is knocked off; the warning bell rings 5 s before). |
| ~6:15 | **Act 3: the run in** | Night-ish tint, everything at once, the bunker on the line. Final **full steam sprint**: pressure must stay above 0.8 for the last stretch or the train is too slow and the pursuers catch up. |
| End | **Station** | Arrival, scoreboard: coal shovelled, fires out, boarders kicked off, rails laid. |

Difficulty scales with crew count (1 to 8): raid sizes, how often things go wrong, boarder count. Failure: the locomotive is destroyed, or the boiler explodes (pressure above 1.0 too long while the locomotive is under 10%).

## Multiplayer correctness rules
- The host sim owns everything: train state, jobs, items held, crew deck positions, fires.
- Everything clients need goes in `railPub()` (already sent every snapshot as `msg.rl`): pressure, throttle, jobs list `[{id, k, c, u, w, prog}]`, items per player, phase name, warnings.
- New commands (all checked on the server): `rlact {a: 'use'|'drop'|'kick', st?: stationId}` (the client says what it pressed; the server validates distance from the crew's deck position and does the action), plus the existing `pose` with `dk`.
- No client-only game state except visual prediction.

## Work packages
1. **WP1 Core: walkable train.** Car list (add tender, flak car, caboose units and meshes), deck geometry, `e.deck` server placement, the `dk` pose, Direct deck-walking (WASD within the deck rectangles, gangways, ladders and roof, jump, fall off and run, respawn), turret seats (E to sit or stand), crew unit, HUD prompt "E: sit in turret". The old "everyone sits in a gun car at spawn" changes to "everyone spawns in the caboose as crew".
2. **WP2 Boiler and driving.** Pressure, coal carry, firebox, vent, throttle notches, brake, whistle, HUD gauges, derail rule.
3. **WP3 Jobs and items.** Fires, couplings and uncoupling, turret jams, holed tender, the tool racks, carrying and dropping, hold-E progress rings, co-op speed-up.
4. **WP4 Pacing and threats.** The act script above with breathers, boarders (bikers that jump on, sabotage, kick-off), cows and whistle, the low-bridge tunnel, the blown track repair with rails, the final sprint, the end scoreboard, scaling by crew count.
5. **WP5 Emote wheel** (separate): hold B (or the `emote` bind) to show a radial wheel; release on an option. Emotes: wave, middle finger, the griddy, salute, facepalm, shrug, dab, "sit down and give up". Synced as a pose flag, seen by everyone in first and third person, and usable everywhere (war, battles, Red Star, train).

Each package must leave the mode fully playable, pass the syntax check, and be tested with a short Playwright run (host plus one simulated guest via a `Mirror`) before it's handed back.
