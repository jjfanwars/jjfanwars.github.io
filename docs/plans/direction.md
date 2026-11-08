# Direction interview (2026-11-07)

Captured from a click-through interview with Finn. No code was written that day. Order below is the agreed priority. Status: decisions, not built.

## Goal
Open the game to the public **within a month**, friends first. Ranked ladder is cut for now.

## Order of work
1. **Gameplay feel, controls and balance** (improves every mode)
2. **Operation Red Star**: Navigator and Bombardier roles, flak, fighters
3. **Accounts** on the relay
4. **Performance** (frame rate in big battles, load time)
5. **Visuals** (lowest priority if time runs short)
6. **Public-launch bar**: new-player tutorial

Playtests: ad hoc, whenever friends are around.

Process: ask before big design choices, keep `docs/plans/` current as work lands, test with short Playwright pokes only (no long sims).

## 1. Feel, controls, balance

### Planes (laptop trackpad is the target device)
- Aim: **mouse aim with cursor lag** (the plane chases a cursor, War Thunder style). Fix the twitchy/drifting mouse aim.
- Weapon keys: **left click fires guns, one key for the special weapon**, default **E**, rebindable. Planes with several specials pick with **number keys 1-3**. Replaces E/R/Y.
- Landing gear and flaps: an **assist toggle** (automatic by default, manual option for experienced pilots).
- Target lock: easier to acquire, stays locked when the target turns, clearer lead marker, camera smoothing.

### Tanks / ground vehicles
- Too easy: bot tanks line up to be one-tapped. They should **spread out and flank** and **use cover and hills**.
- **Collision:** tanks block each other, push infantry and props aside, and are blocked by buildings and trees.
- Driving feels clunky; targets are hard to see (spotting, markers).

### On foot (first person)
- Mouse look, climbing and terrain, and gun feel.
- Gun feel to add: recoil and muzzle flash, hit markers and sounds, reload animation, aim down sights.

### Balance
- Bots: aim accuracy, tactics, RTS expansion speed, with easy/medium/hard levels (this is the backlog "difficulty setting").
- RTS economy: **early game too slow, costs feel arbitrary**. Ideas picked: faster early income, cheaper first buildings, early skirmish objectives.
- Weapon damage and reload need a pass.

## 2. Operation Red Star
Already built (see [bomber.md](bomber.md)): flight, complications, shared crew lounge, parachutes and bail-out, Polar Base, two-key arming, take-off roll, and the **Strangelove ending** (rider on the falling bomb, blast, end card). Note: bomber.md's top "not built" line is out of date.

Next, in order:
- **Navigator:** plot legs on a chart, call ETAs and landmarks, confirm the target.
- **Bombardier / bomb run:** bombsight alignment, pilot and bombardier cooperating, two-key arming first, a timing window.
- **Threats:** flak over the coast, fighter attacks, escalating waves, crew casualties, screen shake and sound.
- **Shared interiors** must show: other crew walking, seated poses at stations, windows to the outside, lounge activities.
- **Difficulty selector** (Training / Standard / Brutal). Crews of 2 to 8 must all work, since Finn's group size varies (use the merged-role scaling in bomber.md).
- Tone: silly crew, tense target.
- **Delayed:** Engineer and Radio roles, and the code-word challenge.

## 3. Accounts (small database on the relay)
**Status 2026-11-07: minimal version built** (sign in, load, save). Relay: `Accts` Durable Object with SQLite storage in `relay/worker.js` (chosen over D1: same SQL, no separate database to create, deploys with the usual `wrangler deploy`; migration tag v3). Tables `acct` (name key, name, xp, data JSON, sid + seen for the one-session rule, 150 s lease), `hist` (last 40 changes per account), `ban`. Name key folds case, symbols, accents, look-alike digits and doubled letters, so "F1nn" can't be registered next to "Finn". Reserved names and a profanity list (with a whitelist such as torpedo, cockpit). Merge: XP never drops, rises at most 8000 per save (60000 on the first import); stats keep the higher number; settings last write wins. Admin routes (ban, unban, hist, rollback) need the `ADMIN_KEY` secret. Game: `Acct` object next to `Profile`, a one-box sign-in bar on the main menu (`#acctBar`), saves every minute and 4 s after XP changes, `kw-owner` marks whose local save it is. **Deployed 2026-11-08** (no `ADMIN_KEY` set yet, so admin routes are off). Not built yet: unlocks, achievements and clan tags (fields exist in the data), friends, privacy policy.
- Unique usernames reserved on the relay, a simple passcode per name, a profanity filter, recovery on a new device.
- Saved rank, XP and stats (today in localStorage `kw-xp` / `kw-stats`).
- Friends: invite code (as now), join a friend directly, party before a match.
- Cut for now: ranked ladder, online/offline presence.
- Risk: the relay stores data for the first time; needs abuse protection. Propose the schema before building.

## 4. Performance
- Low frame rate in big battles; slow load/startup.
- Ideas picked: smaller file / lazy-load rarely used modes, skip the menu demo battle.

## 5. Visuals
Overall look: **stylised blobs, cleaner** (keep the cartoon look, tidier).
- **Mountains and rocks:** bigger dramatic peaks, snow caps and rock layers, more varied rock shapes.
- **Trees and foliage:** more tree types, denser forests, better wind sway, cheaper far-away trees (ties to performance).
- **Menu:** **big mode cards** (RTS, Arcade beta, Red Star), settings tucked away.
- **Direct-control HUD:** health and ammo only by default, minimap, a controls hint that fades, kill feed and alerts.
- **RTS panels:** buttons too small, too many build options at once (needs categories), unit info unclear, shortcuts not discoverable.
- **Battle size:** selectable by the player.

## Public menu
Show **Play vs bots (RTS)**, **Operation Red Star**, and **Arcade battles marked as beta** at launch.

## Dropped for now
Submarine, convoy escort, heist, 1v1 duel arena, naval battles, kill cam, camos.

## Roles in Red Star: free swapping
- **No auto-assigned jobs.** Players choose and can change roles during the flight by **walking to a free seat and sitting**.
- A **role card in the lobby** explains each job before the start.
- Empty stations are covered by **AI at half efficiency**, and a **warning banner** tells the crew which seats are empty.

## Accounts: guests
Guests keep playing with **local saves** (browser storage, as today). Named accounts add relay-stored progress on top.

## Launch bar
New-player tutorial, opened as a **guided tutorial mission** on first load. The RTS tutorial ends by **winning a tiny skirmish**. It covers RTS basics, flying a plane, driving a tank / on foot, and joining a friend's game. (Moderation tools and a public lobby were not picked.)

## Red Star clarity and comms
- Weakest point today: **unclear what to do**. Role guidance and prompts matter more than pacing or length.
- Most crews will play **in the same room** (voice in person), so in-game comms stay light: **text chat** only. No quick-message wheel or map pings needed for now.

## Risks
- One month is tight for feel work, Red Star roles and accounts together. If it slips, cut visuals first, then friends list.
- Accounts touch the relay, which can break multiplayer if rushed.

## Open questions
- Account storage: which database on the relay.

## Round 2 details (2026-11-07, late)

### Tanks
- Driving: **middle ground** (weighty but forgiving). Turret follows the mouse, hull separate.
- Spotting: **minimap blips** and **dust and tracks** that reveal movement.
- Damage: **more shots to kill** (no one-taps).

### Bots
- Behaviours: **retreat when hurt**, **target priorities**, **unpredictable routes** (on top of flank and cover).
- **Five difficulty levels.**
- RTS early income: undecided, **propose numbers to test** (faster early income, cheaper first buildings, early skirmish objectives).
- Match length **scales with the selectable battle size**.

### Red Star combat
- Flak: visible black bursts, the pilot can dodge, searchlights at night.
- Fighters: attack in passes from clock positions, break off when shot, a boss ace escort.
- Turrets: **selectable aim assist**.
- Failure: **debrief, then the crew chooses** (retry from the last act, or restart).

### Accounts, details
- Abuse protection: block reserved and impersonating names, and a ban list on the relay. (No rate limiting or report/mute chosen.)
- Saved: rank and XP, stats, keybinds and settings, unlocks (camos later).
- Short **password** per name. Player base is **mixed ages**, so keep names and chat clean.

### Multiplayer
- Max **8** players.
- **Host migration** if the host leaves (new work).
- Lag: not tested enough yet. **Playtest before tuning.**
- Relay hosting: undecided, **recommend options** (needs a look at the current host first).

### Audio and polish
- Audio: better weapon sounds, otherwise minimal (no music).
- Polish: **loading screen with tips**. Quality settings, bug report and What's new already exist.
- Sharing: keep it small (friends and their friends).
- **Success for the month:** Red Star runs smoothly with 4+ players.

## Updated open questions
- Account database and relay host (recommend).
- Host-migration design for Red Star and RTS.
- RTS early-economy numbers.

## Round 3 details (2026-11-07, night)

### RTS
- Early game: **scouts/recon, defensive towers, economy first.**
- Objectives: **capture points**, **resource nodes in the middle**, destroy the base.
- Win conditions: **selectable** by the host.
- Research: a **tiny tree (3 branches)** for launch; the full tree comes later.

### Arcade (beta)
- Vehicles needing work: fighters, bombers and A-10, tanks, helicopters and drones.
- Team size is **player-picked**. Respawns **cost points per vehicle**. Win by **both** ticket/kill targets and capture-and-hold zones.

### Scope and platforms
- **Nations:** balance the existing ones and give each **unique units**. No new nations yet.
- **Campaign:** yes, **after launch** (Operation Chain idea).
- **Platforms:** desktop only officially, **Chrome** must work. Phones are best effort.
- **Replays:** a **full replay system** is wanted eventually (this includes the kill cam). Post-launch.
- **Never change:** the blob art style (existing rules also keep the tester code hidden and old KICWARS- codes accepted).
- **Money:** free for now. Monetisation (ads, microtransactions) is a later idea once the game is popular. Revisit once there is an audience; the player base is mixed ages, so check consumer-protection rules for minors first.

## Round 4 details (2026-11-07, 28 questions)

### Red Star story and tone
- Opens with a **short comic briefing screen**. One route (New York) only.
- The **commissar is a Stalin blob AI** (not a player seat).
- Tone: it's for Finn's ~16 friends, so **fun rather than funny**: no corny Soviet jokes.
- More complications: engine fires and leaks, radar and missiles, crew trouble (drunk, panic).
- **Debrief:** who did what (damage, repairs), time and route accuracy, medals, rank XP gained. **Letter grade S to F.**
- Roles: **picked in-flight only** (free swapping), with the lobby role card as an explainer.

### Controls (trackpad)
- Aim assist on **on-foot shooting, plane guns and the tank turret**.
- Sensitivity **per mode** (foot, plane, tank).
- Key bindings: **presets plus full rebinding.**
- Two-finger scroll: **zoom in RTS, switch weapons in direct control** (context).

### On foot
- Weapons: rifle and pistol, grenades, rocket launcher, melee, **and more cool ones**.
- Health: **no regen**. Xaviers stay default-off, but add **healing items**.
- Climbing: **falls through terrain** is a bug to fix; otherwise polish.
- **Jump plus auto-vault over low walls.**

### Tutorial
- **Friendly short prompts**, **under 3 minutes**, skippable and replayable from the menu, **reward: unlock a vehicle.**

### Ranks, chat, rooms
- Ranks unlock **vehicles, camos, titles and badges.**
- Name tags: **colour by team, just the name.**
- Chat: **unfiltered text.** Note: the player base is mixed ages and usernames get a profanity filter, so decide later whether to filter chat too.
- Rooms: the **host picks private or public** per lobby. A public room browser is needed.

### Performance
- Target: **mid laptop with integrated graphics**, **adaptive quality** (hold the frame rate by dropping detail), trade only far-away detail, **under 5 seconds to the menu.**

## Corrections (checked against the in-game What's new list)
Some earlier sections described things as missing that already exist. Treat these as **polish, not new builds**:
- **Tutorial**, **research trees**, **campaign**, **Harbor Havoc naval/carrier mode**, **tank armour and ricochets**, **bug report and ideas button**, **sound and graphics settings**, **platoons**, **kill feed** and **Xaviers** all exist. The "tiny research tree" and "build a tutorial" items mean *review and improve the existing ones*, and the "guided tutorial mission" means checking what the current tutorial covers.
- **Multiplayer rooms** (host, name, Join list) and **usernames with name tags** exist.

## Round 5 details (2026-11-07): new ideas only
- **Social:** squad/clan tags, emotes and quick taunts. No spectating, match history or challenges; instead an **achievements list**.
- **Host rules:** starting resources and income, friendly fire on/off, unit and building limits, time limit. **Bot teammates fill gaps** instead of handicaps.
- **Environment:** day/night cycle, rain and fog that affect visibility, snow and storms, wind that affects flight and shells.
- **Destruction:** buildings collapse in chunks.
- **Vehicles:** colour/camo choice, loadouts, upgrade modules bought with XP. **Eject, then parachute and fight on foot** from arcade planes.
- **Practice:** shooting range, flight school with gates, tank proving ground, free sandbox with a spawn menu. A **simple map editor**. **Autosave on exit.** **Vote between three maps** before arcade battles.
- **RTS controls:** shift-click waypoint queues, rally points, team map pings, saved build orders. **Veterancy:** units rank up from kills.
- **Ammo and vehicle supply** as a **lobby option**. **Fog of war** toggle.
- **Accessibility and polish:** UI scale slider; photo mode with hidden HUD and free camera. English only, no gamepad.
- **Content:** a **guerrilla/stealth nation** and **one superweapon per nation**. New battle types: **capture the flag on foot** and **survival waves vs bots**.
- **Group size:** the group is ~16, so **two 8-player teams** is wanted. The relay cap is 8 per room today, so this needs a **relay change** (or linked rooms).
- **Trust and data:** not worried about cheating yet, **trust the clients**, **basic anonymous analytics**. Privacy policy and terms: "not yet". Note: once passwords and usernames are stored, a privacy policy becomes necessary; revisit before accounts ship.

## Updated open questions
- Raise the relay cap from 8 to 16 for team modes?
- Which of the ~40 new ideas fit the one-month window (almost certainly few of them)? Needs a ranked cut list.

## Round 6 details (2026-11-07): scope, time and more new ideas

### Scope reality check
- Time available: **under 5 hours a week.** The list in this doc is far larger than that allows in a month.
- **Must make the first month:** trackpad plane controls, accounts and usernames, tank collision and smarter bots.
- **After launch:** map editor, day/night and weather, replay system.
- Not picked as must-haves (so they slip unless time remains): Red Star Navigator and Bombardier, the rest of the long list below.
- Conflict to resolve: earlier rounds called "Red Star runs smoothly with 4+" the success measure, but Red Star roles did not make the must-have list. Decide which is the true month-one goal.

### 16 players
- **Two linked rooms** (8 + 8 sharing one match) for team modes. Needs a relay design.

### Social
- Achievements: combat feats, Red Star feats, silly ones, progress milestones.
- Emotes: **radial wheel (hold a key).** Clan tags: **created by a leader with invites.**
- Bot teammates: **auto-fill and replace leavers**, with a toggle to turn off.

### Environment and destruction (post-launch)
- Red Star storms: turbulence and icing events. Wind: subtle drift. Collapsed buildings leave **rubble that gives cover.**
- Night maps: headlights/flashlights/flares, night vision toggle, and searchlights/illumination rounds (all three).

### Vehicles
- Loadouts: spawn screen, garage with a point budget, and preset kits (all).
- XP modules: **ammo types.**
- Camos: presets plus **custom camos with resizable flag stickers that other players can see on your vehicle.** (Needs the design to sync over the relay.)
- Eject: **the parachute can be shot**, land and fight on foot, or skip to respawn.

### Practice and tools
- Shooting range: moving targets, every weapon unlocked, an aim-assist test.
- Flight school: takeoff and landing, dogfight a target drone, bombing run.
- Sandbox spawn menu: anyone, **offline only.**
- Map editor (post-launch): paint heights, place bases and capture points, place trees and rocks, share by code.

### New content
- Guerrilla nation: jungle fighters inspired by Vietnam-era guerrillas (name and look to be decided, as the other nations are fictional): hidden units in forests, traps and mines, sabotage and spies.
- Superweapons: **game-ending, like ICBMs**, one per nation.
- Capture the flag on foot: **small bases on a new map.**
- Survival waves: more infantry, tanks and planes later, bosses, supply drops between waves.

### Polish
- Photo mode: pause and orbit camera, save as image. UI scale applies to everything.
- Analytics: players per day, mode popularity, session length, drop-off points.
- Supply option: **ammo trucks and depots only.**

## Round 7 details (2026-11-07): final priorities (supersedes earlier ordering)

### The one thing for month one
**Accounts and usernames** come first. Order: **accounts, then trackpad plane controls, then tank collision and smarter bots**. Friends' top complaint is **"too easy / boring"**, so the bot work matters a lot.

### How we work
Under 5 hours a week: **bigger batches, Finn reviews weekly.**

### Accounts, simplified (supersedes the earlier "short password" decision)
- **No password to start.** An account is just a **username**, and progress is tied to it. Add a password later if impersonation becomes a problem.
- Risk to note: anyone can type another player's name and take over or overwrite their progress. The relay should at least refuse a second *simultaneous* session for the same name and keep a history of changes so a bad overwrite can be rolled back.
- Names may contain **spaces and symbols**, but still need a length limit and the blocked-names and profanity checks decided earlier.
- On first sign-in, **upload local XP and stats.** Cap or sanity-check the upload, since clients are trusted.
- Sign-up is one box. No recovery flow (the name is the account).

### Plane controls
- Mouse-aim cursor lag: **light**, the plane catches up quickly.
- A **small centre deadzone** where the plane flies straight.

### Tanks and bots
- Ramming: **big tanks push small ones** (weight-based collision).
- Bot difficulty shown as **numbers 1 to 5.**

## Round 8 details (2026-11-07): final decisions
- Same account name used twice at once: **the relay refuses the second session.**
- "Too easy" bot fixes start with **tank bots, infantry bots and air bots.** Difficulty 5 is **beatable by a good player.**
- Weekly update from Claude: a **short summary of what changed.**
- Docs stay in this single file. **First thing next session: re-read this doc for errors** (it was written across many rounds and has some superseded entries; later rounds win).
- **First coding task next session: design the accounts schema** (usernames, progress, history, one-session rule, local-save import), then build the relay account store.

## Round 9 details (2026-11-07, morning)

### Accounts schema inputs
- Store per username: **XP, rank, stats; keybinds and settings; unlocked vehicles and camos; achievements and clan tag.**
- Save **every minute during play.** If the relay is down: **play with local saves and sync later** (needs a merge rule: take the higher XP, never lower it).
- **Database: recommendation.** The relay is a **Cloudflare Worker with Durable Objects** (`relay/worker.js`, `relay/wrangler.toml`, about 130 lines). Best fit: **Cloudflare D1** (SQLite) bound to the same Worker. It has a free tier, needs no extra host, and handles name lookups, history rows and the one-session rule well. A Durable Object holding the account directory is the alternative, but D1 is simpler for queries.

### Bot "too easy" details
- Tank bots first: **stop lining up in a column.**
- Infantry bots: they stand still, poor aim, don't use grenades, don't call for help.
- Air bots: predictable turns, never use missiles well, don't dodge.
- Level 1 to 5 scale on: **aim and reaction time, tactics (flank/cover), numbers and teamwork, use of special weapons.**

## How Claude should work (decided 2026-11-07)
- **Accounts:** build a **minimal version straight away** (sign-in, load, save), then iterate. **Deploy to the live relay if tests pass.** Test with **short scripted checks against a local Worker.**
- **Check-ins:** ask (with click options) **only for risky or irreversible** choices; otherwise pick the recommended option and note it.
- **Plane controls:** the **new scheme is the default, the old one stays as an option.** Sensible defaults from other games **plus sliders** so Finn can tune.
- **Bots:** short headless pokes to check behaviour; Finn playtests to judge.
- **Records after each session:** an in-game **What's new** line, an update to this doc's status, and a short end-of-chat summary.
- Note on live deploys: an account bug can lock players out of progress. Keep local saves as the fallback and never let a failed save overwrite a higher stored XP.
