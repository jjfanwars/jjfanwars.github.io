# YeShip: co-op rocket game (design, 20 Nov 2026)

Standalone game at `/space/`, its own code (Three.js r170 from `../three-r170.js`, the jjfanwars relay for multiplayer). Status: design agreed with the owner, not built yet.

## Pillars
- Semi-real orbital physics (apoapsis, burns, staging) on a small spinning planet with day/night; launching east helps. One moon to land on.
- Stylised cartoon look in the spirit of classic rocket-builder games, but all our own: own astronauts, parts and art, no copied characters or style.
- Tone: chill wonder (calm, pretty views, light humour). Sound effects only, no music.
- Laptop trackpad first. Avoid: too much reading, fiddly menus. Keep UI minimal.
- Graphics: pretty by default, quality toggle (Low) for weak laptops.

## Players and co-op
- Up to 5 players, tuned for 2-3. Host controls time warp for everyone.
- Customisable astronauts (suit colour, helmet, face, hats). Name tags, text chat, emotes/waves.
- Build together in the hangar: first-person grab parts from shelves and snap them on, plus a builder console (editor view with parts list and snapping) for precision. Free builder but simple: stacks, side boosters, radial parts.
- Ride one rocket together. Walkable cabin that grows with parts (each crew module adds a room, joined by hatches, float in zero-g).
- Stations: Pilot (steer, throttle), Navigator (map, burn planning, guides the crew; solo players get a helper), Engineer (fuel flow, power, fixes). Anyone can swap seats.
- EVA with jetpack, walk on the moon, plant flags.
- Joining mid-flight spawns you in the ship with the crew.

## Flight
- Controls: keys (WASD pitch/yaw, Q/E roll, Shift/Ctrl throttle, Space stage) plus SAS helper buttons (hold prograde / retrograde / up etc.).
- Scale: about 4 minutes to orbit.
- Re-entry heat is visual only.
- Crashes: big explosions, ragdoll astronauts, then respawn at the space centre.
- Random failures (leak, stuck stage, power) for the engineer: a settings toggle, off by default.
- Docking: assisted (get close and slow, it aligns and snaps).

## World
- Home planet: space centre (hangar, launch pads, runway, mission control to walk around), oceans and land (splashdowns, islands, mountains), landmarks and easter eggs to find.
- Moon: craters and low gravity (bouncy walking), a secret to find (anomaly, old lander), resources (mine fuel to refuel bases and ships).
- Station and base parts: docking ports, habitats (walk-in rooms that join up), solar panels and batteries (power matters), fuel depots, fun stuff (cupola window, gym, telescope).

## Modes and saving
- Sandbox (all parts) and Missions (reach space -> orbit -> moon -> station, each unlocks parts).
- Save the world: stations and bases stay in orbit for the host's next session, plus designs and unlocks.

## First version
Rough pass at everything, then polish.
