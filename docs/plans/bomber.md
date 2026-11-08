# Operation Red Star: Soviet atomic bomber co-op

Status: playable preview built (flight, complications, lounge, bail-out, arming, Strangelove ending). Roles, flak and the code challenge not built; see [direction.md](direction.md).

## Pitch
2 to 7 players are blob crew inside one Soviet atomic bomber. Everyone has a different job at a different station. Fly from a Siberian airfield over the Arctic and Atlantic to New York, survive the fighters and flak, and drop the bomb. 15 to 20 minutes. Teamwork under pressure, with comedy: shouting radio lines, a commissar, a very loud engine room.

The aircraft is one big shared vehicle. The host runs it. Nobody flies alone: the pilot cannot fix engines, the engineer cannot see the map, and the bombardier cannot do anything until the others have got him there.

## Decisions (2026-11-06)
- **Tone: pretty tense.** Real pressure, but with the blob look and some dry humour in the radio lines.
- **Playable with 2 and 3 players, scaled to fit.** Fewer crew means fewer simultaneous problems and a gentler event rate, not just AI taking the seats. See Scaling below.
- **Not just tasks.** Each phase needs a moment of drama: tension spikes, near misses, a set-piece. Task stations feed the drama; they are never a checklist.
- **Bomb cutscene at the end:** a proper cinematic of the bomb falling and detonating over the city, shown to the whole crew.
- **Detailed, atmospheric interior with windows to the outside.** The outside world is visible through the nose glass, cockpit, side windows and gunner blisters.
- **Pilot gets the map himself** whenever nobody is on the navigator seat (the pilot has the nav table view on a fold-down chart).
- **Guns have lead indicators** (a predicted aim point so shots at moving fighters are fair).
- **Everything first person.** No third-person or free camera anywhere in the mode, including turrets.
- Build order: interior and shared presence first, clarify gameplay after.

## Scaling for 2 and 3 players
- **2 players:** Pilot (also navigator, reads the chart from his seat) + Engineer (also radio: the radio panel is on the engine bulkhead for this size). AI gunners at 50%, AI bombardier does the sight only on the final 20 seconds with the pilot assisting.
- **3 players:** Pilot (+navigator), Engineer (+radio), Gunner/Bombardier (a single role: the dorsal turret early, the nose for the bomb run). AI tail gunner.
- Fighter count, flak density and event rate scale with crew size so a 2-crew run is hard but fair. Training / Standard / Brutal multiplies on top.

## Crew and roles
Roles are picked in the lobby (one player per role). Smaller crews merge roles. Empty roles are filled by AI crew who work at about half efficiency, so a solo test works.

| Role | Station | Job |
|---|---|---|
| **Pilot** | Cockpit left seat | Steers: heading, altitude, throttle. Keeps the bomber inside the route corridor and level on the bomb run. |
| **Navigator** | Nav table (map) | Plots each leg. Reads wind and drift, calls headings and ETAs to the pilot. Confirms the target on the final leg. |
| **Engineer** | Engine panel, mid-ship | Keeps four engines alive: fuel crossfeed, temperature, fires, leaks. Walks to compartments to repair. Routes power to arm the bomb. |
| **Radio operator** | Radio desk | Decodes orders, answers the air-defence challenge with the code word of the day, jams enemy radar. First to get warnings. |
| **Tail gunner** | Rear turret | Shoots fighters from behind. |
| **Dorsal gunner** | Top turret | Shoots fighters above and ahead. |
| **Bombardier** | Glass nose | Final bomb run: sight alignment, release. Idle until the last 90 seconds, so he also acts as spotter (calls bandits). |
| **Commissar** (extra seat) | Walks free | Comic role. Can shout "For the motherland!" for a short reload and calm buff to nearby crew, and can reassign a station if someone disconnects. Cannot touch controls. |

Merging for small crews: 2 players = Pilot+Navigator and Engineer+Radio (AI do the gunners and bombardier). 3 = add Gunners. 4 = add Bombardier, and so on up to 7 (host + 6) plus commissar as an 8th seat if the room has space. Exact table in the lobby code.

## The aircraft
A Tu-95-style four-engine bomber. Walkable interior, front to back, connected by a tunnel/catwalk:
1. **Glass nose:** bombardier station, bombsight.
2. **Cockpit:** pilot seat, navigator table across the aisle.
3. **Radio desk** behind the cockpit.
4. **Engine/fuel bay:** panel with 4 engine gauges, fuel valves, fire handles, a wall of pipes. Repair points.
5. **Bomb bay:** the big weapon, visible below the catwalk. Arming panel.
6. **Rear:** tail turret. A top turret with a ladder in the mid-ship.

Reuse the existing Interior builder (`Interior.get`, `roomAt`, `chair`, `worldUp`, the interior camera and the blob walk code). Add a `bomber` interior kind.

## The big technical piece: shared interiors
Today each player's interior is local: you walk in your own scene and nobody else is in it. Crew modes need everyone to see each other at their stations. This also unlocks the submarine.

- **Station claim:** new command `{c:'station', k:'pilot', on:1}`. The host validates (role allowed, not taken) and broadcasts the crew table. A player is either **seated** at a station (controls live) or **walking**.
- **Crew presence:** while walking, each client sends `{c:'icrew', x, z, yaw, st}` at about 10 Hz. The host keeps a crew list `S.crew[playerIndex] = {st, x, z, yaw, anim}` and includes it in the snapshot meta (small: a few bytes per player).
- **Rendering:** the interior scene draws blobs for the other crew at those positions (smoothed), with name tags, using the same drawing as the world blobs. Seated crew play a seated pose.
- **Animation reuse:** fire, aim and throw states already travel as snapshot bits for soldiers. Station actions (turning a wheel, typing) are just a short `anim` id on the crew entry.
- Everything stays host-authoritative: guests send intent, the host decides.

## Flight and the map
- A custom low-detail "Red Star Run" map in the style of the Grand Theatre air map: Siberian coast, Arctic ice, Atlantic, and a New York coast with a stylised skyline. Cheap geometry, long sight lines, fog.
- The bomber is one sim entity flying a **route**: a list of waypoints (legs). The route is a corridor with a width. Staying inside it is "on course".
- **Controls are setpoints, not raw stick.** The pilot sends target heading, altitude and throttle about 10 times a second; the host's flight model turns the heavy aircraft toward them. This hides relay latency: a bomber is slow and a 150 ms delay is invisible.
- **Wind and drift:** a slow wind vector pushes the bomber off the corridor each leg. The navigator sees the drift on the table and calls a correction (a heading offset). If the pilot ignores it, fuel burns and the route time grows.
- **Fuel budget:** total fuel is fixed. Bad flying, hard turns and engine damage all burn more. Run dry and the bomber ditches short of New York.

## Engine room (engineer)
- Four engines, each with temperature, health, fuel feed. Random events: oil leak (a pipe sprays, hold the repair key at the spot), engine fire (pull the correct fire handle, then wait), fuel imbalance (turn crossfeed valves until the gauges even out).
- A damaged engine cuts speed. Two dead engines = the bomber cannot hold altitude. Three = ditch.
- **Arming the bomb** needs power: the engineer routes it with a simple switch puzzle in phase 5, which also slows him down so he cannot fix an engine at the same time.
- Repair walks matter: his panel is mid-ship and leaks happen elsewhere, so he leaves his post and the engine gauges go unwatched.

## Radio (radio operator)
- **Orders:** coded messages arrive at set times (change route, hold, weather warning). The radio operator decodes them on the desk with a code wheel (match symbols), then reads the result aloud to the navigator. A wrong decode means a wrong waypoint.
- **Air-defence challenge (phase 4):** a coastal defence radio asks for the code word. The briefing gives a code word of the day. The radio operator picks the right reply from three within about 8 seconds. Fail and the flak and searchlights are much heavier for the rest of the approach.
- **Jamming:** hold a key on a frequency dial to drag a radar lock off. Costs the operator his decoding for a few seconds.

## Threats by phase
1. **Takeoff (about 2 min):** pilot and engineer sync. Throttle up in steps, the engineer watches temperatures. Fail = abort and restart.
2. **Arctic (about 5 min):** navigation and fuel. Storms, ice on the wings (engineer de-ice), drift. Few enemies. The calm before.
3. **Interception (about 4 min):** two or three fighter waves from the clock positions the radio or bombardier call out ("two at 4 o'clock high"). The gunners shoot, the pilot jinks gently, the engineer repairs hits. Reuse the existing air bots and aim code from the arcade modes.
4. **NYC approach (about 3 min):** coastal radar, the code challenge, flak bursts, searchlights, SAM warnings. The pilot descends to the bomb altitude. Heavy radio and engineer load.
5. **Bomb run (about 90 s):** the bombardier takes the sight. The pilot must keep the bomber level and slow. The navigator confirms the aim point. The engineer arms the bomb. Everyone else steadies the aircraft (gunners keep the last fighters off). Release, then a long fall, tension music, and the result.

## Bomb run in detail
- Bombardier sight: a crosshair drifting over the city map; he nudges it onto the aim point with mouse and keys. Pilot instability (turning, damage, turbulence) adds drift, so the whole crew affects accuracy.
- The sight locks when it is on target and the bomber is level and in range. The navigator "confirms" with a key press. The bomb is armed by the engineer. All three must be true before release.
- Result: **perfect / near / miss** by distance from the aim point, shown with a big stylised flash and mushroom cloud (cartoon, no gore) plus the blob crew cheering or despairing.
- Then the way home is optional: a short epilogue flight, or end the mission on the flash.

## Failure, disconnects, difficulty
- **Hull damage** stacks per compartment. A hit near a crew member can knock them out for a short time (a revive by walking to them).
- **Crew death:** a dead player respawns at the nearest station after 20 s as "wounded" (half speed) so nobody sits out for 10 minutes.
- **Disconnect:** the station goes to AI at half efficiency; the commissar can reassign it.
- **Fail** = ditch (fuel, engines), shot down, or bomb dropped far off. Retry from the start of the current phase once, then full restart.
- **Difficulty:** scales fighter count, flak density, event frequency. Small crews get a handicap; big crews get more events. Three presets in the lobby: Training, Standard, Brutal.

## UI per role (sketch)
- **Pilot:** compass, altitude, throttle, a corridor bar showing left/right drift, a callout strip from the navigator.
- **Navigator:** a table map with the route, current position, drift arrow, ETA to each waypoint, and a "call to pilot" quick-message wheel (heading left/right, altitude).
- **Engineer:** four engine gauges, fuel schematic, fire handles, repair prompts, power switch board.
- **Radio:** decode wheel, code list, frequency dial.
- **Gunners:** the existing turret HUD (reuse), with a call-out compass for bandit positions.
- **Bombardier:** the sight view and a three-light "ready" panel (aim, level, armed).
- **Everyone:** one shared "crew status" strip (engines, fuel, hull, who is where), a voice-free callout system (quick-message wheel, since there is no voice chat).

## Lobby and entry
- A new menu tile under *With friends*: **Operation Red Star**. Host picks difficulty and role slots.
- The lobby lists roles; each player clicks a free role. Unfilled roles get AI. Start allowed with 1 player (AI crew) for solo testing.
- Name tags work in the interior too (usernames).

## Networking summary
- Host sim: the bomber entity, the route, the systems state (engines, fuel, hull), the threat script.
- Guests send: station claims, setpoints (pilot), station actions (engineer valves, radio picks, gunner fire, bombardier nudge), `icrew` positions.
- Host sends: the snapshot as today, plus `crew` (a small table), systems state (engines, fuel, hull, drift), and events (callouts, radio messages, flash).
- Bandwidth is small; the relay is not a bottleneck.

## Build order (each step testable)
1. **Shared interior skeleton:** `bomber` interior kind, station claim, crew presence, other blobs visible with name tags. Test: two tabs, both walk, each sees the other. Also unlocks the submarine.
2. **Flight and route:** the custom map, the bomber entity, the pilot setpoints, the corridor, wind drift. Test: a scripted flight completes with a competent pilot and fails with a bad one.
3. **Systems:** engines, fuel, hull, the engineer panel and repairs.
4. **Navigator and radio:** the map table, the code wheel, the challenge.
5. **Threats:** fighter waves, flak, searchlights; gunner stations reuse the turret code.
6. **Bomb run:** sight, arm, release, result flash.
7. **Lobby, roles, AI crew fill, difficulty, debrief screen, polish** (briefing text, radio lines, music, the commissar).

Estimate: about 8 to 12 focused sessions. Steps 1 and 2 carry most of the risk.

## Risks and how to handle them
- **Shared interior rendering** (largest): build step 1 first and prove it with two tabs before anything else.
- **Pilot latency:** use setpoints and host smoothing, as above.
- **Too many mini-games:** keep each one under 5 seconds and make most optional. If a role is bored, give it a spotter job (the bombardier already has one).
- **Balance with 2 players:** AI crew at half efficiency; playtest early with 2 and 4.
- **Single file size:** `index.html` is already large. Put the mode in a labelled section of the sim and Direct, and a small separate section for the interior, like the other mode sections.
- **Testing without 7 players:** an AI crew mode lets one person run every role; headless tests can drive each station with scripted inputs, as the flight-model tests do.

## Content notes
- **Briefing:** a short comic Soviet briefing screen: the target, the code word of the day, the route, the crew list.
- **Radio lines:** a bank of short orders and fighter callouts ("bandit at 4 o'clock", "engine two burning, comrade").
- **Tone question:** keep the cartoon blob look for crew and city. The flash is stylised, not graphic.

## Open questions
- Cartoon-silly or tense? (Leaning cartoon, with real pressure.)
- Other targets and routes after New York (a second city, a harder run)?
- Does the commissar count as a player seat or an extra?
- A voice chat is out of scope; is the quick-message wheel enough?

## Build status
- **Done (2026-11-06):** step 1 started. A detailed bomber interior (glass nose and cockpit, radio and navigation, engineer's bay, bomb bay with the bomb, tail gunner) with windows to the outside, shown in first person over the real world with wings and engines outside. Shared crew presence over the relay: everyone sees the others walk around, with name tags. Menu tile "Operation Red Star (preview)" starts it. The bomber flies a scripted circle for now.
- **Next:** station seats and claiming, then the flight model and route, systems, threats, bomb run and cutscene.

## More decisions (2026-11-06)
- **Mission settings in the lobby** (host picks, remembered in the browser): flying feel (heavy/demanding), failure rule (retry a phase once / one life / unlimited checkpoints), bomb cutscene (bomb's-eye then wide / from the bomber / both), ending (ends on the flash / escape flight home), difficulty (training/standard/brutal). Passed to the game as `rso`. Not yet acted on by gameplay: the options are stored and shown at launch.
- **Clean mode:** no nation abilities (including the colourblind filter), no battle popups (only mission messages), no health/ammo/radar/crosshair ring, no weapon or view keys, no leaving to the command view. Only walking, looking and the free cursor.
- **Look:** procedural riveted metal, grime and glowing lamps and dials on a physically lit material, dusty fog and dim warm lights. No external model files yet: they would need to be embedded in the single html file and checked for licence, so only add them with the owner's go-ahead.

## Decisions and status (2026-11-06, later)
- **Settings cut down:** only Flying, Respawns (one per phase / none / unlimited) and Difficulty. The cutscene is always the full version (bomb's-eye drop, wide shot, then back inside the bomber for the shockwave) and the mission ends on the flash.
- **Charlies:** the colour-blind filter is off in this mode. **Rule for roles when they are built: a Charlies player can never be the pilot** (the instruments are red/green coded). They can take any other seat.
- **Map built:** "Red Star Run", 384 x 384, low-detail air map (`redstarMap`): a Siberian airfield and runway, Arctic ice floes, the Atlantic with islands, and New York (Hudson, East River, harbour, a grid of skyscrapers with a spire at the aim point). `M.rsRoute` is the flight plan (7 waypoints, about 340 units) and `M.rsTarget` the aim point. The bomber follows the route at 1.2 units/s then circles the city. Superseded: the map is now 768 with a route of about 1,174 units (about 16 minutes).
- **3D models:** searched. No free (CC0) bomber or Soviet aircraft interior exists; free packs found are generic sci-fi (Quaternius). Using them would also mean embedding a glTF loader and the model data in the single html file. Decision pending; default stays procedural.
- Nose glass is now low so the bombardier can look down at the ground.

## Complications built (2026-11-06)
Built and working in a single-player test; the multi-player treat-a-crewmate path is written but not yet tried with two real people.
- **Fighters:** enemy jets attack in passes (scripted, owned by a hidden "Air Defence" player). Gunners sit at the tail or the two waist blisters (E to sit), aim in first person with a lead indicator, and shoot real bullets with travel time. Empty gun seats are manned by AI at low skill on crews of 3 or fewer.
- **Injured crew:** hits can hurt a crewmate (slow, red screen), a second hit puts them down (bleeding out in 30 s). Another crew member holds E next to them to treat them. If they bleed out they respawn at the bunk according to the Respawns setting (one per phase, none, or unlimited).
- **Radar lock and jamming:** a lock countdown; the radio operator sits at the set and tunes with A/D to a drifting signal until the lock breaks. Fail and a missile hits.
- **Searchlights:** beams sweep; the pilot sits at the controls and shifts the aircraft sideways to stay out of them. Lit = brighter screen and more accurate fighters.
- **Leaks:** oil, fuel and hydraulic leaks spray in the cabin; hold E next to one to patch it. Fuel leaks burn fuel; hydraulic leaks make the aircraft drift.
- **Bomb bay door jam:** crank it shut at the bomb bay wall. Until then the aircraft is slower and shakes.
- **Storm:** rain, lightning, jolts, more drift, harder jamming.
- **Pilot:** drift pushes the aircraft off the flight line (visible bar). Off the line burns more fuel.
- **Fixes (2026-11-07):** events fire at a distance along the route, not a clock time (storms and the door delay what follows; searchlights land on the coast approach; the bomb fault fires 36 units before the target). With nobody in the pilot's seat the aircraft half-holds the line (`R.inp = clamp(-off/4, ±.35)`), so a crew can step away; storms and hydraulic leaks can still beat it. Respawns are one per act (route progress .1/.35/.62/.85), not per 70 s. Charlies cannot take the pilot's seat (host check in `rsseat` plus the prompt).
- Fuel and hull are tracked; running out or being shot down loses the mission. Events are timed to the route and scaled by crew size and difficulty.

## Crew lounge (2026-11-07)
A side cabin off the tail passage (x -12.8 to -9.2, z .6 to 1.7, door at x -11). Roulette table (E bets 10 roubles on red, Shift+E on black, 100 to start, 2D wheel spin on the HUD) and a vodka table (E drinks a shot, up to 5; the view sways and wanders, walking drifts, warm haze; wears off at 1 shot per 40 s). Shared through the host (cmd `rslounge`; `R.vod`, `R.rub`, `R.roul` in `rsPub`): everyone gets a message when someone drinks or spins, drunk crewmates sway and get a (tipsy)/(drunk) tag, and the wheel shows on screen for the spinner and anyone in the lounge. `rsLounge`, `drawLounge`, `RS_WHEEL`, `RS_RED`.

## Bail-out, Polar Base, lights out, arming keys (2026-11-07)
- **Parachutes:** rack in the tail passage (-9.6, -.3), E puts one on (`rschute`, `R.stock`, starts at crew size, restocked at the base). **Hatch** in the floor at (-12.3, 0): hold E for 1 s (`rsbail`). The host spawns a `para` unit as cargo of the bomber; the client enters it (`Direct.rsBailTo`) and auto-jumps into the existing freefall and canopy code. No parachute: canopy never opens and the host kills the unit on impact.
- **Going down:** hull or fuel at zero no longer loses at once: `R.state = 'falling'` for 40 s while the bomber sinks, with a BAIL OUT banner. At the end, everyone still aboard goes down with it. All crew bailed while flying = mission lost.
- **Polar Base 7:** ice runway under the route at (.40, .20) of the map (`M.rsBase`, `R.baseS` = route distance). The pilot gets "L: land" from 120 to 12 units before it (`rsland`, once per flight). Approach and climb are 40 units each, 30 s on the ground: refuel, repair, clear leaks, door, lock, storm, lights, heal everyone (including crew who were out), restock parachutes, +50 roubles each.
- **Lights out (`dark`):** lightning kills the cabin lights (torch-beam vignette on the HUD) until someone holds E at the breaker in the engineer's bay (3.5, -1.25) for 3 s.
- **Two-key arming (`arm`):** before the bomb fault, keys in the cockpit (9.1, -1.35) and the tail gunner's room (-13.6, .55) must be held together for 3 s. The bomb fault waits until armed. With one active crew member, key 1 alone works.
- **Fixes:** standing up from a seat that sits inside its own collision box (pilot, tail gun) now steps you clear. Depth pre-pass (`Direct.prePass`): the cabin's opaque walls are drawn depth-only before the world so hidden world pixels are skipped; frames proven identical with grain and dust frozen.

## Take-off and props (2026-11-07)
- The route now starts on the Siberian runway (longer strip, to ax+36). The bomber spawns at ground height, rolls the first 30 units at reduced speed (no drift for the first 50), then climbs to `RS_ALT` over 110 units with a "Wheels up" message. Airborne after about 34 s, at cruise height after about 2.5 min.
- Cabin-view propellers are separate meshes (`I.propsG`, built in `syncRsFx`): 4 blades with yellow tips and a faint blur disc, spinning up smoothly, slower on the ground at Polar Base, stopped when the mission is lost. The outside world model is still the B-52-style jet (`def('bomber')`), so bailed-out crew see jets, not props.
