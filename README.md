# jjfanwars

Browser games, all playable at https://jjfanwars.github.io/ with no install and no build step. Every game is plain HTML/JS served by GitHub Pages; most use the shared Three.js build `three-r170.js`.

See [LOG.md](LOG.md) for what changed and how to play with a friend.

## The games

| Game | What it is | Play | Files | Notes |
|---|---|---|---|---|
| **jjfanwars** | The main game: RTS war game where you can jump into any unit in first person (planes, tanks, ships, spies, trains) | [/](https://jjfanwars.github.io/) | `index.html` (copied to `warsim.html`) | [CLAUDE.md](CLAUDE.md) |
| **jjfront** | OpenFront-style territory conquest, online lockstep | [/front.html](https://jjfanwars.github.io/front.html) | `front.html` | [front](docs/notes/front.md) |
| **jjdrop** | Siege-style urban close-quarters shooter: operators, gadgets, destructible walls, bomb plant/defuse | [/drop.html](https://jjfanwars.github.io/drop.html) | `drop.html` | [drop](docs/notes/drop.md) |
| **Rally** | Stage rally with a co-driver reading pace notes, AI rivals, championships | [/rally](https://jjfanwars.github.io/rally/) | `rally/` | [rally](docs/notes/rally.md) |
| **Ridge Runner** | 2D side-view hill climb | [/rally/climb.html](https://jjfanwars.github.io/rally/climb.html) | `rally/climb.html` | [climb](docs/notes/climb.md) |
| **Camper Crew** | Co-op road trip in a camper you can walk around inside | [/rally/rv.html](https://jjfanwars.github.io/rally/rv.html) | `rally/rv.html`, `rally/js/rv*.js` | [camper](docs/notes/camper.md) |
| **James Racing** | First-person F1 with pit stops, tyres and ERS | [/f1](https://jjfanwars.github.io/f1/) | `f1/`, `rally/js/f1*.js` | [f1](docs/notes/f1.md) |
| **Whisperpine** | Solo survival horror in the woods | [/night](https://jjfanwars.github.io/night/) | `night/` | [night](docs/notes/night.md) |
| **Black Hollow** | Online co-op survival horror (1-6 players) | [/hollow](https://jjfanwars.github.io/hollow/) | `hollow/` | [hollow](docs/notes/hollow.md) |
| **Station Nine: Open Sea** | Online co-op sea exploration with boats, fishing, diving and horror | [/rig](https://jjfanwars.github.io/rig/) | `rig/` | [rig](docs/notes/rig.md) |
| **Courtroom Duel** | Legal Studies revision game, answers marked by AI (not part of jjfanwars) | [/legal](https://jjfanwars.github.io/legal/) | `legal/` | [legal](docs/notes/legal.md) |

Also in the repo: `r6/` (BREACHLINE, an early tactical shooter prototype, see `r6/README.md`), `hub*/` (unrelated hub page drafts) and `stats.html` (anonymous play stats).

## Shared pieces
- **`three-r170.js`**: Three.js r170 as a classic script that sets `window.THREE`. Don't edit it. `index.html` has its own inlined copy.
- **`relay/`**: a Cloudflare Worker (`worker.js`) that every online game uses. It forwards messages between a host and guests in a room, and also holds accounts, the play tracker and the Courtroom Duel marking. Secrets live only in Cloudflare.
- **Assets**: `tex/` (CC0 textures), `soldier.glb`, `suit.glb`, `heads/`, `m4a1.*`, `shotgun.bin`, `gltf-loader.js`. Licences are next to them (`tex/LICENSE.txt`, `tex/faces/LICENSE.txt`).

## How online play works
One player hosts and runs the game; guests send their inputs and get snapshots back through the relay. Rooms are tagged by game (`[Front]`, `[Drop]`, `[Hollow]`, `[Rig]`, `[Camper]` ...). jjfront is the exception: every client runs the same deterministic sim in lockstep. No game has host migration yet.

## Docs
- [CLAUDE.md](CLAUDE.md): rules for every change, plus the code map of the main game. Claude reads it at the start of every session, so keep it short.
- [docs/notes/](docs/notes/): one file per other game with its code map and design notes. Claude reads only the one for the game it's working on.
- [docs/plans/](docs/plans/README.md): design plans for future modes and the overall direction.
- [LOG.md](LOG.md): player-facing changelog and how-to-play.

## Testing
No build or test suite. Changes are checked with `node --check` on each `<script>` block and short headless Playwright runs; most games expose a `?test` hook (see each notes file).
