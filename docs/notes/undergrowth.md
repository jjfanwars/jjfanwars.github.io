# Undergrowth (`viet/`)

First-person jungle shooter, Củ Chi 1968: a Viet Cong guerrilla digs tunnels, ambushes US patrols and raids a firebase (blow the ammo dump with a satchel charge, get back underground). Live at /viet.

- Source of truth is a separate local project; this folder is a copy of its `index.html` + `src/*.js` (Three.js r170 from jsDelivr via importmap, plain ES modules, no build step). Edit there and copy over, not here.
- Modules: `world.js` (terrain, foliage, firebase, baked lighting), `tunnels.js` (underground grid, hatches, punji traps), `player.js`, `weapons.js` (Type 56, shovel, satchel, grenades, traps), `enemies.js` (US soldiers AI, Huey), `audio.js` (all procedural), `hud.js`, `main.js` (loop, input, mission, post-processing, quality presets).
- Controls: WASD, Shift sprint, C crouch, Z prone, V jump, F hatch, 1-5 / wheel items, LMB or Space fire/use, RMB or Q aim, R reload, G grenade, M map, Esc pause. Rifle and shovel both work underground.
- Models: `assets/hand.glb` (CC0) and `assets/type56.glb` (CC BY 4.0, crwde), loaded by weapons.js with the built-in hands/rifle as fallback; credits in `viet/CREDITS.md`.
- Debug: `?debug=1` exposes `window.__game`, `__step(n)`, `__stats()`; `&underground=1`, `&pos=x,z`.
