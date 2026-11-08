# Operation Red Star: pacing and tension plan

Status: plan only. Today the whole flight is about 4.7 minutes (route 338 units at 1.2 u/s) and every event fires at a fixed second (18, 40, 80 ... 262). That is why it feels rushed: no build-up, no quiet, events stack by accident. Target is **about 14 minutes** (range 12 to 16 depending on difficulty and crew), not a hard rule.

## Principles
- **Tension is contrast.** A 40 second quiet stretch makes the next fighter pass hit harder. Every peak is followed by a breather.
- **Dread before danger.** Sound drops out, radio goes to static, the nav map shows "BANDITS 40 MI" before the jets arrive.
- **Problems stack at the end, not the start.** First act teaches, last act overwhelms.
- **Never more than two open problems at once** until the final act (the director queues the rest).
- **Position, not clock.** Events fire at a point on the route (progress 0 to 1), so a long storm or a jammed door delays the whole mission instead of overlapping with the next event.

## Length
- Route gets longer (extra Arctic dogleg waypoints, about 500 units) and the bomber slows to about 0.6 u/s: roughly 14 minutes. Scenery still visibly moves.
- Difficulty: Training about 16 min with longer breathers; Brutal about 12 min with shorter ones.
- Crew size: 2 and 3 players keep the same length but get lighter events (already scaled) and longer breathers.

## Acts (share of the route)
| Act | Progress | Feel | Events |
|---|---|---|---|
| 1. Departure | 0 to 10% (about 1.5 min) | Calm, learn the stations, quiet engines | One small leak (teaches hold E). Nothing else. |
| 2. Arctic transit | 10 to 35% | Slow dread, cold, long stretches of nothing | First fighter pair (about 3:30), guns taught for real. Fuel and trim chores. Radio chatter. |
| 3. Open ocean | 35 to 62% | Escalation | Long storm, radar lock and jamming, second fighter wave, first injuries. A real lull in the middle. |
| 4. Coast approach | 62 to 85% | Peak pressure | Searchlights, flak, ace fighter, door jam, two problems at once allowed. |
| 5. Run-in | 85 to 100% | Everything at once, then silence | Bay doors open, bomb run (hold the line over the target), bomb fault finale, drop, flash. |

Built 2026-11-07: events trigger by route distance (step 1 of the director's "position, not clock" principle). Budget, queue, breathers and difficulty-based length are not built.

## Director (replaces the fixed schedule)
- Events are a table: `{at: progress, kind, weight, minGap}` plus optional random fillers in each act.
- **Budget:** max open problems (leaks, jam, lock, lights, fighters) is 2 until act 5. New events wait in a queue.
- **Breather:** after any peak (injury, missile hit, fighter wave) the director holds off for 30 to 60 seconds scaled by difficulty.
- **Adaptive:** if the crew has been idle 60 seconds, pull the next event forward. If hull is under 40% or two people are down, delay and ease.
- **Stakes:** fuel and hull outcomes carry into the finale (low fuel shortens the final approach window, low hull makes the bomb fault harder).

## Ambient tension (cheap, big effect)
- Engine drone rises and falls with the act, cut to near silence before a fighter wave.
- Radio chatter lines and Morse bursts between events, static during jamming.
- Nav map and pilot map show distance to target and ETA, ticking down.
- Lights flicker on hits, cabin gets colder (frost on windows) later in the flight.
- Crew lines from AI crew on small crews, so 2 players still feel like a crew.

## Finale: the bomb run
1. Doors open (not a jam). Pilot holds the line over New York for about 20 seconds.
2. Navigator or pilot presses release. The electronics fail (built: `bombfault`).
3. One crewmate climbs on the bomb in the bay and rewires it by hand while the aircraft shakes and fighters come back through the windows. The rider can be shocked (injury risk). Others keep the plane steady and cover the guns.
4. Wires joined, the bomb drops through the open doors with the rider on it, then the flash and the end card (built).

## Build order
1. Longer route, speed constant, `R.prog` (route progress 0 to 1) published in the snapshot.
2. Director rewrite: event table, budget, queue, breathers.
3. Ambient: drone, chatter, ETA and distance HUD.
4. Bomb run phase that triggers the existing bomb fault instead of the placeholder timer at 262 seconds.
5. Telemetry pass: log when every event fires and how long each lasts, then tune with real play-tests (needs two or more people).
6. Cutscene (separate item): replaces the plain white flash.

## Open questions
- Is 14 minutes right for one session, or should there be a "short" 8 minute option?
- Should a lost mission offer a checkpoint at the start of the current act?
