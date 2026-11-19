# Station Nine: boss fights (plan, nothing built yet)

Goal: a handful of big set-piece fights that a crew of 1 to 6 can find, prepare for and win, each paying a trophy, a relic and a lot of cash. Host-authoritative like the island creatures (`IC` in rig/game.js): the host runs the boss, snapshots carry its state, events drive sounds and messages.

## Shared rules
- **Find:** each boss has a lair in Places (M) shown as "Rumoured" until someone hears about it (a note, a radio call, a job-board rumour). Set course from there.
- **Summon:** a ritual or trigger at the lair, so the fight starts when the crew is ready (bell, flare circle, bait, power switch).
- **Phases:** 3 phases with a clear tell before each big attack (sound, light, shadow), so dodging is skill, not luck.
- **Weak points:** glowing spots that take double damage from guns and the harpoon gun; flares stun for a few seconds.
- **Downs, not deaths:** the usual downed and revive. A wipe resets the boss to phase 1 after 30 s.
- **Rewards:** first kill per save pays a big bounty plus a relic; repeat kills pay loot and a trophy count for the shed shelf.
- **Scale:** HP x (0.6 + 0.4 x crew size).

## Fishing bosses (use the catch bar)
- **The Old Blue (tuna legend):** a three-bar fight. Each bar is faster and the zone shrinks; between bars the fish tows the boat (steer to keep the line clear of rocks).
- **Grandfather Squid:** hooked from a big ship at night. Its arms grab crew off the deck (shoot the arm to free them) while one player works the catch bar.

## Combat bosses
1. **The Maw (island lair, mid game):** a giant burrowing thing under a sand island. Phase 1: bursts from holes (watch the sand ripple). Phase 2: tentacles from every hole, shoot the glowing tips. Phase 3: it surfaces fully; hit the mouth with the harpoon gun. Reward: Maw tooth relic.
2. **The Pale Mother (night, a ruined island):** the Pale Things' source. Moves only when unseen, like them, but the crew has to split up to light four braziers. Teamwork test: someone always has to watch her.
3. **The Leviathan (deep sea, late game):** the deep creature as a full fight from a big ship. It rams (hull damage), drags swimmers, and surfaces to breathe; hit the gills with the deck gun, harpoons and the SMG. The tanker's "no deep attacks" perk turns off near its lair.
4. **The Ghost Carrier (USS Requiem, endgame):** the abandoned carrier wakes. Fight across the flight deck: drowned sailors in waves, then the captain on the bridge. Ends with the F-35B escape.

## PvP hooks
The same weapons work for PvP: friendly fire already routes hits through `ffShoot`. A PvP mode needs teams, HP instead of downs, respawn points and a score panel. Boss arenas can double as PvP maps.

## Build order
1. Shared boss framework (state machine, phases, weak points, snapshot, HUD health bar).
2. The Maw (simplest arena).
3. Fishing bosses (reuse the catch bar).
4. Pale Mother, Leviathan, Ghost Carrier.
