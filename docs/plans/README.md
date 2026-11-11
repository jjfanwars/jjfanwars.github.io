# jjfanwars: plans and ideas

Saved design plans. Nothing here is built unless it says so. Status last updated 2026-11-06.

| Plan | Status | File |
|---|---|---|
| **Operation Red Star**: Soviet atomic bomber crew co-op, bomb New York | Playable preview: flight, complications, bomb finale. Roles (navigator, engineer, bombardier), flak and the code challenge not built | [bomber.md](bomber.md) |
| **Convoy escort** co-op | Chosen, needs detail | below |
| **Submarine crew** co-op | Chosen, needs detail | below |
| **Heist** co-op | Chosen, needs detail | below |
| **jjdrop**: Siege-style urban CQB, multi-storey houses, online co-op | Built (11 Nov 2026), see [drop.md](drop.md) | `drop.html` |
| Co-op campaign "Operation Chain" | Idea | below |
| 1v1 PvP modes | Idea | below |

**Current direction (2026-11-07): see [direction.md](direction.md).** Priority: feel and balance, then Red Star roles, then accounts, aiming for a public launch within a month.

## Constraints that shape every mode
- The relay allows 1 host + 7 guests per room (8 players). The host's game is authoritative; guests send commands.
- Interiors (`Interior.get(kind, nation)`, `Direct.aboard`) are **local to each player**: you see your own walk, not others. Any crew mode needs shared interior presence first (see bomber.md, "Shared interiors").
- Usernames are shown as name tags. Accounts (a username, no password) store XP, stats and settings on the relay (`Accts` in relay/worker.js); guests play on browser saves. See direction.md section 3.
- Keep each mode small enough to play in 15 to 20 minutes.

## Chosen next: convoy escort, submarine, heist
- **Convoy escort:** one player drives a supply truck (or ship) along a route while the others escort as fighters, tanks and AA. Bot raiders attack in waves from set directions. Win: the convoy arrives with enough trucks alive. Reuses Harbor Havoc ships and aircraft, arcade spawns (`arcSpawn`, `scenSpawn`) and the bot lane logic (`arcTankGoal`). Needs: a route and waypoint system, a convoy AI that follows it and stops under fire, and a wave script.
- **Submarine crew (4 to 6 players):** the bomber format underwater. Roles: captain/helm, sonar, torpedo officer, engineer (battery, air, leaks), dive-plane operator. Silent running means making noise gets you found. A `sub` interior already exists in the Interior builders, so the walkable boat is partly there. Needs shared interiors, a sonar display and an enemy hunter AI.
- **Heist (3 to 5 players):** infiltrate a base, steal or destroy an objective, get out. Roles: infiltrator, hacker (opens doors, kills cameras), driver, overwatch sniper. Reuses the spy and heist code (`startHeist`, `heistStep`, `Sim.spySteal`, SPY_GUARDS). Needs: a multi-player heist (the current one is solo), alarm levels and an extraction point.

## Other co-op ideas (not chosen yet)
- Base defence waves: hold one base against escalating bot attacks.
- Rescue and extraction: bring a downed pilot home with a helicopter and escorts.
- Armoured train defence: posts on moving carriages.

## Co-op campaign "Operation Chain" (idea)
Seven missions for 2 to 7 players that rotate formats and finish with the bomber raid. Persistent callsign, rank, medals and one perk unlocked per mission. A shared steel pool carries between missions for upgrades. Debrief screen shows who did what. A lost mission can be retried but crew losses carry over. Needs: a mission runner, a save format and briefing/debrief UI. Build last, once several modes exist.

## 1v1 PvP modes (idea)
- Duel arena: two soldiers in a walled room (the test-room code), best of 5, weapon pickups.
- Tank duel on a symmetrical map with repair stations.
- Dogfight on the big air map.
- Naval duel: destroyer against destroyer.
- Small-base capture the flag, and king of the hill.
- Ranked ladder (Elo). Needs unique usernames and relay storage.

## Suggested build order
1. Shared interiors (needed by bomber, submarine). 2. Operation Red Star. 3. 1v1 duel arena (cheap). 4. Convoy escort. 5. Submarine. 6. Heist. 7. Campaign.

## Open questions
- Tone of the bomber: cartoon-silly or tense?
- Other cities and routes after New York?
- [bomber-pacing.md](bomber-pacing.md): flight length, acts, director and tension plan for Operation Red Star

- [iron-express.md](iron-express.md): Iron Express 2.0 "All Aboard" (walkable train, jobs, boarders, acts with breathers) and the emote wheel. Being built 2026-11-09.
