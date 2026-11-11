# jjdrop: urban CQB design notes

Status 2026-11-11. `drop.html` is a first-person, body-cam style urban combat game with two modes, **Siege** and **Assault**, both playable solo against bots or online (host-authoritative over the relay, up to 8 humans).

## What other games do, and what we took from it

Sources were fan and review pages, so treat the numbers as impressions, not specs.

| Game | What it does well | What we copied |
|---|---|---|
| Rainbow Six Siege ([map and wall design](https://www.ubisoft.com/pl-pl/game/rainbow-six/siege/news-updates/39MfgGP4Yo1jobS6sGAXW9/closed-beta-game-guide-part-4)) | Attackers vs defenders, one life per round, a prep phase with drones and barricades, soft vs reinforced walls, objective rooms with several breachable walls, vertical play through floors | The whole Siege round loop: 40 s prep (drone for attackers, barricade/reinforce for defenders), 3 min action, first to 3 rounds, roles swap every round, no respawn, spectate teammates. Soft chunks of wall (2.4 m wide, lower 2.4 m) can be breached; reinforced ones cannot; barricades block doors and windows and are shot or meleed down |
| Counter-Strike ([lane design](https://www.fandom.com/articles/counter-strike-dust-2)) | 2 to 3 lanes, chokepoints, broken sightlines for mobility, a secondary entrance so the site is never a dead end | The house has two exterior doors, many windows, a stair core in a corner and partitions with doors, so every room has at least two ways in once walls are breached. Objective room is a random upper-floor room each round |
| Insurgency: Sandstorm ([lethality and sound](https://www.well-played.com.au/?p=391509)) | 1 to 2 shots kill, slow movement, lean and peek, positional sound instead of kill confirmation | 3 body shots (head x3), no regeneration, bandage takes 4 s and slows you, lean on Z/X, suppression blur from near misses, loud reverb gunfire panned by direction, heartbeat when low |
| Bodycam ([store page](https://store.steampowered.com/app/2406770/Bodycam/)) | Real body-cam view with almost no HUD, very short time to kill, small CQB maps, bomb and team deathmatch modes | Fisheye/grain/timestamp post pass, small REC/compass HUD, short TTK. Kept a minimap toggle because bots and a drone phase need it |
| Ready or Not ([review notes](https://www.gfinityesports.com/article/ready-or-not-is-past-its-prime-but-the-gunplay-keeps-it-a-cut-above-the-rest)) | Doors are decision points; kicking a door into someone who is looking at it is suicide; lethality makes planning matter | Real door leaves (they swing open as someone nears, block sight and bullets when shut), so a closed door is information. Defender bots hold interior posts and react to noise |

## How it is laid out

- **City:** 3x3 blocks, 20 m streets, perimeter wall. The middle block holds the objective building. Other lots get random 1 to 6 storey buildings.
- **Real storeys:** up to 3 enterable floors per building (Bravo 4, Alpha 1), floor slabs with stairwell holes, two-column switchback stairs in a corner core, upper floors above that are a visual mass. Stairs are step solids, so walking, standing and bullets all work the same as on the ground. Fall damage above about 3 m.
- **Navigation:** 1 m grid with one layer per storey and explicit stair links in A*. Doors and windows: bots use doors; sills block them.
- **Siege house:** 54x44 m, 3 floors, walls built as separate destructible panels (`PANEL`), `OPEN` list of doors and windows for barricades.
- **Rounds:** prep 40 s (attackers are frozen in a drone view, click to mark an enemy for 14 s; defenders get 4 barricades and 2 reinforcements each, defender bots auto-prep), action 180 s, secure = hold the objective room alone for 7 s, or eliminate the other team, or defenders survive the clock.
- **Assault (co-op):** the original three-building ticket mode, now with humans plus AI squad mates, objectives captured by being inside the building on any floor.

## Online

Host runs everything (AI, damage, doors are derived from positions on each client). Guests send pose at 20 Hz and fire/use commands; the host resolves hits and broadcasts a snapshot at 15 Hz plus an event list (shots, hits, barricades, breaches, rounds). Room names start with `[Drop]` so they stay out of the jjfront list. The relay is unchanged. No late join, no host migration (a leaving guest is replaced by a bot; if the host leaves, guests get a defeat screen).

## Not built yet

- Siege map variety (only the one generated house), operators with different gadgets, shotgun/hatch breaches, floor/ceiling destruction, drones for defenders, plant and defuse mode.
- Grenades, vehicles, touch controls, voice or ping system, result feedback into jjfront.
- Ranked or lobby team picker (teams alternate by join order).
- A real hand-play balance pass: bot accuracy, round length and the number of barricades are guesses.
