# jjfanwars log

## Start here
- **Play:** https://jjfanwars.github.io/
- **Fastest start:** open the link, press **Quick Battle: jump in**, pick a unit, and play it. Just move the mouse to aim, **Space** fires, **Alt** frees the cursor, **F** switches to commanding your army. Or press *Play vs Bots* to choose nations and opponents.
- **With a friend (no extra server, works over github.io only):**
  1. You: open the link, press **Play with a Friend: host**, then **1. Make invite code** and **Copy code** (or **Copy link**).
  2. Send it to your friend in any chat. They open the game, press **Join a Friend**, paste it, press **Join** (or they just open your link). They get a **reply code**: they copy it and send it back.
  3. You paste the reply in step 3 and press **Connect**. Their nation appears in your lobby. Press **Start War**.
  - If it says the direct link failed, your networks block peer-to-peer. Try both on the same Wi-Fi or a phone hotspot, or use **GitHub relay** (slower, each player pastes their own GitHub token with only the *gist* scope; the on-screen text explains how).
  - Two tabs on one computer: host in one tab, then in the other tab Join a Friend and type the 5-letter room code shown in the lobby.
- Single-file copy: https://jjfanwars.github.io/warsim.html (save it and open from disk).

## Log (newest first, Sydney time)

### 2026-11-05 — Playtest fixes: tutorial, gritty look, forts, hardening, balance
- **Tutorial:** a guided 18-step first battle from the main menu (camera, selecting, building, training, fuel, trenches, hardening, scouting, the War Room, fighting in person). The training bot does not attack until the tutorial ends.
- **Gritty look:** realistic soldiers in muted field uniforms (nation colour on helmet bands and armbands) with striding legs, gloved hands and sleeves in first person, real blood, bodies that fall and bleed. A war-film colour grade over everything: muted colours, contrast, vignette, film grain, lens fringing on foot. Overcast sky, earthier ground and trees. Both can be turned off in Controls and settings.
- **Workers build in order:** a worker given a new site while building finishes the first one, then does the next, in the order you placed them. Half-built sites nobody is working on get picked back up.
- **Fortifications:** Trench (troops walk through it), Sandbag Wall and Pillbox (garrison 3). Infantry in or beside them take 55% less damage.
- **Hardening:** select any finished building and press V. For a big steel and fuel cost it is rebuilt in concrete over 25 s, then takes 65% less damage (80% less from artillery, bombs and missiles).
- **Valentinos:** infantry charge into bayonet range and stab for heavy damage; the Rally Flag also draws a knife in first person. New **Trattoria** (Valentinos only): each one, up to 3, gives the whole army +5% health and +5% fire rate (morale) and heals troops nearby.
- **Nation balance:** Dhruvs no longer get everything (now vision +30%, research −35%, damage +5%, health +5%). Licases gain +12% steel and 15% faster training. Jethroes damage +10%, costs −8%. Toms health +12%, damage +8%, costs +12%. Valentinos health +5%.
- **Campaign:** 10 levels (new: The Trench Line, Air Cavalry, Avanti!, Armoured Spearhead). Budgets now scale with the enemy army and its nation's bonuses, from generous to just under even. The last level was impossible (budget 2300 against 2930 of tougher troops) and is now beatable with the right counters.
- **Scouts where you want:** capital → Scout to… (L) and click anywhere, or click the War Room map table. Scouts on missions show as dashed lines on the table.
- **Stats screen (F7, also at the end of every game):** kills, troops and buildings destroyed, losses, trained, built, steel mined, army value, K/D, and graphs of army, economy and kills over time.


### 2026-11-05 — Big maps, Stalingrad, War Room, transports, team deathmatch
- **Build without selecting workers:** with nothing selected, the command card shows every building. Place one and the nearest workers go and build it, then go back to mining.
- **New maps and sizes:** Middle East Desert, Strait of Hormuz, Stalingrad (a ruined city on a street grid by the Volga, in winter), and Pacific War (an island chain, at least Massive size). Sizes now go up to Huge and Massive. Highways and causeways link every capital, so everything can be reached on foot.
- **Bigger capitals:** gatehouses, towers, a palace keep, a cathedral, a market square and streets of houses.
- **War Room:** select your capital and press G to walk inside as the general. It has a live map table with what you can see and every scout sighting, a strategic wall map, a scout dispatch desk and a reports board. **Scouts** (capital: J, auto: K) ride out, note every enemy group, and report numbers and positions when they return. Sightings also show on the Tab map.
- **Fog of war reworked:** soft edges, sharper on big maps, faster updates, high ground sees further, and explored ground stays readable.
- **Swimming:** infantry can swim slowly. After 12 s (player) or 22 s (AI) they start to drown. You get a breath bar.
- **New units:** Troop Truck (8 troops), Supply Truck (repairs), Hovercraft (amphibious, MG, 6 troops), Landing Craft (12 troops), Patrol Boat, C-130 Transport (arrives with 10 paratroopers), Chinook (10 troops, door gun) and AWACS (huge vision, spots aircraft). To load, select infantry and right click a transport. Unload with B, or "Unload at..." (N); U unloads in first person.
- **ICBMs:** the nuclear sub's missile now cold-launches out of the water, boosts straight up, drops its first stage and comes down glowing. In a piloted nuclear sub, E fires it at the nearest enemy capital.
- **FPS:** two team deathmatch arenas (Stalingrad Streets, Desert Mesas). Gunplay for every gun: recoil patterns you pull down against, FOV punch and shake, floating damage numbers, headshot and multikill banners, and a faster tactical reload with a round chambered.

### 2026-11-05 — FPS beach landings, diplomacy, patrols, new maps and cockpit
- **FPS Battles (main menu):** *D-Day: Omaha Beach* and *Pacific: Island Landing*. Ride the landing craft in as one soldier among waves of troops, with destroyers offshore and fighters or gunships flying in. Capture four objectives in turn. Each soldier costs a reinforcement ticket; capturing an objective moves your respawn forward and gives 15 more. When you die, pick your class (1 to 7).
- **Diplomacy (F6):** ceasefires (4 min), alliances, tribute demands, trades and gifts. Bots judge by army strength, gifts and grudges, sue for peace when losing and gang up on a runaway leader. Allies win together.
- **Select-all buttons:** F1 workers, F2 ground, F3 air, F4 naval (also clickable on the right).
- **Auto patrol:** your troops walk a beat around wherever you last sent them. *Patrol area (U)* sets a new one; Stop (T) makes them stand still.
- **Kill confirmation:** ENEMY DOWNED / VEHICLE DESTROYED banner with streak counter when you kill something yourself; alerts when your forces shoot down enemy aircraft.
- **Maps:** choose Island, Continent, Archipelago or Highlands. Every map has highways (with causeways over water) linking the capitals, plus a rich central plateau, *the Crown*. Fewer impassable rocks. **Tab** opens a big tactical map.
- **New cockpit:** canopy frame, radar scope with sweep and contacts, attitude ball, stores page with ammo and chaff, throttle gauge, warning lights and a moving stick.
- **Balance:** commander powers bar removed (airstrikes, barrages, drone swarms) for you and the bots. Steel is much easier (more to start, higher tax, bigger loads, richer nodes). Bots wait longer before attacking, build far fewer aircraft and drones, and only hard bots nuke, late. Bots pick weaker or hated targets, pull back broken waves, build AA against air and rockets against armour, and help allies.
- Fixed: the PULL UP warning stuck on after leaving a plane.

### 2026-11-04 — Planes, missiles, chaff, new troops and more
- **New aircraft (every nation, Airfield):** A-10 Thunderbolt II (GAU-8, Mavericks, Sidewinder), F/A-18 Super Hornet (Vulcan, AIM-9X, Mk 82 bombs), Eurofighter Typhoon (cannon, Meteor, IRIS-T).
- **Air-to-air missiles on every jet and the gunship.** Press **R** in a plane to fire the extra missile (hold the nose on a jet until the lock tone goes solid). Piloted jets now have radar: enemy aircraft within 70 m show up and can be locked beyond eyesight.
- **Chaff (Z):** 6 bundles per aircraft, +1 every 8 s. Pop it when the flashing *MISSILE INBOUND* warning appears and most missiles miss. Bots use chaff too, so your missiles can be spoofed.
- **New infantry (Barracks):** Machine Gunner, Grenadier, and Paratrooper (parachutes onto the Barracks rally point; set the rally point behind enemy lines).
- **Commanding:** red ground shows where a building cannot go; workers can **Excavate (L)** to flatten ground so you can build there; time controls (pause, ½×, 1×, 2×, 4×; `[` `]` and Backspace).
- **Campaign:** budget battles from the main menu (buy troops, place them, watch the fight).
- Tank, IFV and artillery barrels now raise and lower to the crosshair; SAM and MLRS launchers tilt. Toms special is now a Big Knife. Gilded Veil removed; nation cards show stats only.
- Tested in headless Chromium: all-bot war at 8×, an all-jets air battle with SAMs, paratrooper drops, missile lock and launch, chaff and the warning. Zero console errors. Not tested: real GPU, phones, two real players.

### 2026-11-05 — Walk around inside ships and subs
- In a destroyer or submarine, press **B** (rebindable) to leave the captain's chair and walk the rooms: bridge with real windows, mess, quarters, engine room and aft deck on destroyers; control room, torpedo room, bunks and reactor on subs, plus a missile bay on the Nuclear Sub. The ship coasts to a stop while nobody is at the helm. Walk back to the chair and press **B** again to take control.
- Every nation now gets a Naval Yard in Quick Battle, even with a capital far from the sea, so all can use destroyers and attack subs. Ships spawn pointing at open water.
- Tested with scripts in the browser, not played by hand and not in multiplayer.

### 2026-11-05 — Setup screen, all units, phones, aiming
- **Setup:** Quick Battle and Play vs Bots let you choose your nation, 1 to 5 bot enemies, and each enemy's nation, difficulty and team. *All units unlocked and free* gives human players every unit from every nation.
- **Deploy:** spawn in and play a unit, or just send it to your army. Ships now spawn in open water.
- **Phones:** on-screen stick, drag to look, and buttons for fire and other actions. Hold your phone sideways.
- **Aiming:** shells and rockets go to the crosshair and allow for drop, fast shots no longer pass through targets, and hit markers match real damage.
- **Keys:** rebinding swaps clashing keys, so Fire can go on F.
- Tested with scripts and simulated touch only, not on a real phone, not played by hand, and not in multiplayer.

### 2026-11-05 — Tracks, wheels and landing gear animate
- Tank, IFV, artillery and MLRS tracks and wheels now roll with real movement and counter-rotate when pivoting. SAM truck wheels spin. The MLRS got detailed running gear.
- All six jets have landing gear that retracts after leaving an airfield and lowers when low and slow.
- Replaces the tracks, wheels and landing-gear items under the rough edges in the entry below. Not yet tried by hand in real flight or on a real GPU.

### 2026-11-05 03:34 AEDT — Published and verified; pull request opened
- The latest build is live. I can't open github.io from here, so I checked it two other ways: the raw copy of index.html on GitHub matches what I pushed byte for byte, and GitHub's "pages build and deployment" run for commit 1884732 finished with **success**.
- Final test pass on the exact published file: two-player over WebRTC (0 errors), GitHub relay against a fake GitHub API (0 errors), first-five-minutes flow, every jet and the gunship driven by keyboard and mouse, and the fallback when the browser refuses to lock the mouse (moving the cursor off centre steers, and the view stops at centre).
- **Try first:** Quick Battle → Rifleman → aim with the mouse, Space to fire, G for your nation's special. Then try an F-16 or F-15 (W for throttle, the jet follows the mouse) and the tank (mouse turns the turret, A/D turn the hull). Then host a game, send a friend the invite, and play each other.
- **Known rough edges:** tank tracks and wheels don't visibly turn; jets have no landing-gear animation; frame rate on a real laptop GPU is untested (Graphics: Auto steps quality down if it's slow); the direct link may not work on strict networks, which is what the GitHub relay is for.

### 2026-11-05 03:20 AEDT — Big update: fight in first person, real planes, detailed tanks
**What's new**
- **Quick Battle: jump in** on the main menu: starts a 1 v 1 against a bot with a ready-made base on both sides and opens the unit chooser. Pick any soldier, vehicle, plane, drone or ship, choose Capital or Front line, and you spawn in. When you die the chooser comes back; a rifleman respawn is always free every 15 s.
- **First person by default, V for third person** (remembered). Your own blob hands and gun are drawn in front of you, never clipping. Tanks get a gunner sight, jets a cockpit with HUD, FPV drones goggles.
- **No clicking needed:** the mouse locks to the view as soon as you spawn; just move it to aim. **Space fires**, E secondary, Q aim/scope, R reload, X jump, C sprint (and hold breath in a scope), G national special, T cycle missile lock, H help. **Alt frees the cursor** (a panel with Aim again / Chooser / Command / Settings appears), Alt again to aim. If the browser refuses the mouse lock, moving the cursor away from the centre steers instead. Window blur and Alt+Tab clear held keys.
- **Gunplay:** shots go exactly where the crosshair is (also in third person: an orange X shows when a hill blocks your gun). Hits are checked against each body, with a weak spot on top of a blob's head ("BONK" crits). Recoil, spread that grows when moving, aim-down-sights, reloads, hit markers, damage numbers, kill feed, red arrows showing where damage came from, low-health glow, muzzle flash, ejected casings, impacts. Each weapon is different: battle rifle + frag grenades, shotgun + sticky bombs, flamethrower + napalm, rocket launcher, scoped sniper with hold-breath, SMG + heal burst, alpha-wolf bite.
- **Real projectiles** you can watch: tank shells, rockets, grenades that bounce, artillery with an arc preview and range readout (Q switches direct fire), MLRS ripple salvos, homing missiles with lock-on, bombs with an impact marker, torpedoes.
- **Planes fly freely in 3D**: mouse-aim flight (the jet banks and pulls toward where you point), W/S throttle, A/D roll, stall and pull-up warnings, crash if you hit the ground, afterburner. Bot aircraft now climb, dive on strafing runs and follow terrain instead of flying at one height.
- **National specials (G):** Licases Peloton Dash, Dhruvs Smart Scan, Valentinos Rally Flag, Jethroes Alpha Howl (turn into a wolf blob), Toms Flex (half damage), Veil Pocket Bribe.
- **Looks:** new detailed aircraft (F-16, F-15, F-35, Rafale-style fighter, F-14-style interceptor, B-52-style bomber, Apache-style gunship, FPV quad, loitering drone) with shiny canopies, moving stabilators, afterburner flames, contrails and a simple version for distance. New tanks (reactive armour, road wheels, tracks, blob commander in the hatch), IFV, self-propelled howitzer, SAM truck, MLRS, Arleigh Burke-style destroyer, Virginia and Ohio-style subs.
- **New unit: MLRS rocket artillery** (War Factory).
- **Controls and settings** screen (main menu and in-game Menu): sensitivity, invert, aim assist (off by default), auto-fire, start in third person, and every key can be rebound. Graphics now has **Auto**, which lowers quality if your laptop struggles.
- Trackpad and touch in command view: two-finger scroll pans, pinch zooms, two-finger tap or long press gives orders, tap selects.

**Pacing (measured with a simulated player in tools/pacing.js, 12 fights each)**
- Rifle vs 1 bot rifleman at 10 m: first kill about 1.6 s. Vs 3 riflemen at 12 m: all three down in about 6 s; on hard you die in about 7 s if you stand still, about 14 s if you strafe. Easy bots rarely kill you.
- Shotgun at 5 m: 2 kills in about 4 s. Flamethrower vs 3 at 4 m: about 4.5 s, wins every time. Sniper vs 2 at 20 m: about 4 s, out of their range.
- Rocket trooper vs a tank: about 10 s to kill it, and you die in about half the fights. Tank vs tank: about 11 s (was 21 s; cannon damage raised).
- Bots: reaction 0.5 s (hard) to 1.2 s (easy), hit chance 32% / 46% / 60% by difficulty, worse when you move or when you have just shot near them. Hard bots prefer to target you.
- Commander bot-vs-bot (tools/balance.js, every nation pair): first kill about 3 min, first big battle about 4 min, match median about 17 min. A sudden-death rule after 30 minutes means no match stalls. Win rates per nation 40-73%; the spread looks like map luck rather than traits (removing the Valentinos' traits did not change their result), see the later entry for a second seed set.

**Tested here:** two-player over WebRTC in two separate browser profiles (invite, reply, lobby, orders, sync, win/lose), the GitHub relay against a local fake GitHub API, the first-five-minutes flow (Quick Battle, chooser, spawn, mouse-only look, Alt, blur, V, rebinding, death), and driving rifle, sniper, flamer, rocket, scout, tank, IFV, artillery, MLRS, F-16, F-15, gunship, FPV and destroyer with keyboard and mouse. Zero console errors.
**Not testable here:** a real GPU's frame rate, your network, real GitHub tokens, phones.
- Balance re-run on a second set of 60 bot matches: every nation won 40-60%, no match went past 40 minutes, median 18.5 min.
- The GitHub relay now passes a full match test against a local stand-in for GitHub's gist API (join, orders, Victory/Defeat). With real GitHub it should behave the same, but I could not try real tokens.

### 2026-11-05 02:35 AEDT — Two player now needs only GitHub; blob troops
- Removed PeerJS (it needed an outside broker server). Multiplayer now uses a direct WebRTC link set up by copy-pasting an invite code and a reply code (about 560 characters each), or an invite link. No server is involved; the page asks Google's public STUN server for your public address if it can reach it, and works without it on the same network.
- Fallback: a GitHub relay through secret gists. Each player pastes their own token with only the gist scope; it is stored only in their browser (if they tick remember) and only sent to api.github.com. It updates every few seconds, so it suits commanding more than flying. I could not test this one because it needs real tokens.
- Tested: two separate browser profiles on a local server serving the exact published file: invite, reply, join, nation pick, the friend's move orders run on the host, unit counts and positions stay in sync, Victory for the host and Defeat for the friend. Zero console errors. Not testable here: your home network, two real computers.
- Every soldier is now a round blob guy (eyes, hands, feet that step, squash and stretch, flinch when hit, pop-and-splat deaths). Toms are short, wide and buff with sunglasses, Dhruvs have big glasses, Licases ride road bikes, Valentinos wear the tricolour sash and a moustache, Jethroes are red/white/blue, Veil are gold with a veil. Alpha wolves are wolf blobs with a bandana. Capital villagers are blobs too.
- Next: first-person direct control with precise gunplay, then planes.

### 2026-11-05 01:52 AEDT — Run started, early build published
- Fetched `v2` and `wip-snapshot` of the source repo: they are identical, so nothing needed merging. Source work is on branch `claude/warsim-overnight`.
- The game from the last session exists and runs: menu with a live bot battle, lobby, command view, direct control, deploy chooser.
- Published that build here as-is so there is something to play straight away. Its online mode still uses an outside server (PeerJS), which your network probably blocks; replacing that is the top job tonight.
- I cannot open github.io from my environment, so I check publishing through GitHub's API instead.
