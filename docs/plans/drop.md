# jjdrop: urban CQB design notes

Status 2026-11-11. `drop.html` is a first-person close-quarters tactical shooter with two modes, **Siege** and **Assault**, both playable solo against bots or online (host-authoritative over the relay, up to 8 humans). Siege now plays like a round of a modern attack/defend shooter: operator pick, prep phase, destructible soft walls, gadgets, a bomb objective.

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

## Siege, second pass: what makes it feel like Siege

The first pass had the round loop. This pass adds the parts players actually remember from that genre:

- **Operators.** Ten operators with names and kits of our own (not the real game's). Each has a weapon, armor/speed, one gadget of their own (G) and a secondary gadget (4). Picked at the start of every round (12 s, unique per team, bots fill the rest late so humans pick first).
  - Attack: KILN (thermal charge, the only way through reinforced walls), VESPER (EMP grenades, through walls), MALLET (breaching rounds), LYNX (hold-to-scan heartbeat sensor, 18 m), BRICK (breaching hammer, shotgun).
  - Defend: WARDEN (shock cells: thermal charges fizzle), SNARE (entry lasers on doors and windows), ORACLE (sticky cameras), STATIC (signal jammers: hold charges, kill drones), BASTION (armor bag, LMG).
  - Secondaries: breach charge, frag, smoke, flash / barbed wire, deployable shield, impact grenade, nitro cell (remote detonation).
- **Counter-play chain.** Reinforce stops soft breaching; thermal beats reinforcement; shock cells beat thermal; EMP and explosions beat shock cells, cameras, lasers and jammers; jammers stop every charge until shot. Gadgets can be shot (cameras, lasers, jammers, shock cells, nitro, drones).
- **Destruction.** Soft walls turn into 20 cm cells when hit. Bullets pass through soft walls and barricades with less damage and sometimes knock a cell out, so spraying a wall makes murder holes you can see and shoot through. Shotguns, melee and the hammer open holes big enough to walk through; explosions blow wider ones. Hard walls only break to a thermal charge.
- **Bomb objective (default).** Two sites on one floor. One attacker carries the defuser (dropped on death, any attacker picks it up). Hold E for 7 s on a site to plant; then a 45 s timer runs and defenders must hold E for 7 s to disable it. Killing every attacker does not end a planted round. Secure area is still a menu option.
- **Information war.** Attackers drive small wheeled drones (prep and action, two each, Space to hop, click to spot an enemy); defenders get 8 building cameras plus sticky cameras on key 5. Middle click pings a spot or an enemy for the team. Spotting the bomb sites with a drone in prep reveals them early.
- **HUD in the genre's layout.** Team operator icons and the timer at the top, health and gadgets bottom left, ammo bottom right, kill feed top right, big round banners (preparation, action, defuser planted, round won/lost), hitmarkers, damage direction, Tab scoreboard, footsteps of enemies louder than teammates'.

**Third pass (12 Nov 2026): Commies vs Fascists.** The owner asked for the teams to be a political joke: left-wing leaders are all "commies", right-wing ones all "fascists". Two fixed teams that swap attack and defend every round; each operator carries one attack gadget and one defend gadget with a joke name (Stalin's Five-Year Charge and Iron Curtain, Trump's Tariff Charge and Gold Plating, Kim's Test Missile and Approved Haircut Laser, Boris's Brexit Hammer and Partygate Tripwire, and so on). Names only, no explanations. Heads are procedural caricatures built from smooth shapes (hair, mustaches, beard, caps, ties, pearls), bodies are the shared soldier tinted dark red or dark blue.

What is still missing compared with the real thing: down-but-not-out and revives, rappel, hatches and floor destruction, pistols, defender drones, more maps, and a hand-play balance pass.

## Online

Host runs everything (AI, damage, doors are derived from positions on each client). Guests send pose at 20 Hz and fire/use commands; the host resolves hits and broadcasts a snapshot at 15 Hz plus an event list (shots, hits, barricades, breaches, rounds). Room names start with `[Drop]` so they stay out of the jjfront list. The relay is unchanged. No late join, no host migration (a leaving guest is replaced by a bot; if the host leaves, guests get a defeat screen).

## Not built yet

- Siege map variety (only the one generated house), down-but-not-out and revives, rappel, hatch and floor/ceiling destruction, pistols, drones for defenders.
- Grenades, vehicles, touch controls, voice or ping system, result feedback into jjfront.
- Ranked or lobby team picker (teams alternate by join order).
- A real hand-play balance pass: bot accuracy, round length, gadget counts and the number of barricades are guesses. In headless bot-only rounds, attackers planted in about 6 of 8 rounds; some rounds still time out when a carrier gets wedged.

### Fourth pass (12 Nov 2026): real faces, suits
- Operator faces are photo textures (Wikimedia Commons, see `tex/faces/LICENSE.txt`) projected onto a modelled head, with modelled hair and caps on top.
- Operator bodies are suits on the X Bot skeleton (`suit.glb`), built from rigid pieces per bone. Assault keeps the armoured soldiers.
