# YeShip (`space/`): notes for Claude

Read `CLAUDE.md` first (shared rules) and the design in `docs/plans/yeship.md`. Keep this file up to date when you change the game.

## Build steps (agreed order; say what was done after each)
1. Planet + physics, space centre, walking. **Done 20 Nov 2026.**
2. Rocket + flying (staging, drag, SAS helpers, map view, host warp, re-entry glow, explosions + ragdolls).
3. Builder (console editor + first-person grabbing from the hangar shelves).
4. Cabin + crew stations (Pilot, Navigator, Engineer), seat swapping, zero-g.
5. EVA, moon (craters, secret, fuel), lunar rover.
6. Multiplayer (5 players, tuned for 2-3; relay like the other games).
7. Stations, assisted docking, base parts, world save.
Sandbox only to start. Astronauts are thrown out only when the ship explodes.

## Code map (space/game.js)
- **Frames:** inertial world with the planet centre at 0 and a fixed sun direction `SUN`. Bodies (`PLANET`, `MOON` in `BODIES`) have `c` (centre) and `q` (rotation) from `bodyState(b, t)`. The planet spins about +Y (`PLANET.day` = 3600 s). The moon is on rails (`MOON.orbit` 400 km), tidally locked.
- **Floating origin:** the camera is always at 0. `G.O` = camera inertial position; each body group sits at `b.c - G.O`. Never put big coordinates in vertex data.
- **Scale:** planet R 60 km, g 9.81, air `atmo` 18 km; moon R 20 km, g 1.63. About 4 minutes to orbit.
- **Terrain:** `heightAt(b, x, y, z)` (unit direction, body-fixed) and `colorAt` (also fills `_wt`, material weights grass/sand/rock/snow). Cube-sphere quadtree (`Node`, `updateTree`, `updateTerrain(budgetMs)`), 32x32 chunks with skirts, baked AO from neighbour heights, sea mesh per chunk. `terrMat` shader blends 4 textures (colour as a detail ratio on top of the vertex colour, plus normal maps on High). UVs are chunk-local, snapped to 512 m so they stay small.
- **Space centre:** `SITE` direction (equator), `buildSite()`. Site frame: x east, y up, z south; `siteToBody`/`bodyToSite`. Terrain under it is a true flat plane (`SITE_H + d²/2R`). Collision boxes in `site.boxes`; launch pads in `site.pads`. Helpers: `box`, `cyl`, `mergeGeos`/`beamGeo`/`boxGeo` (one draw call for lattices), `signTex`/`logo`/`decal` (canvas signs).
- **Render:** log depth buffer, HalfFloat target with depth texture. Post: `atmoM` ray-marched single scattering (Rayleigh + Mie, planet shadow) uses scene depth for aerial perspective; then bloom and ACES (`compM`). View rays use the near plane (far-plane unprojection is NaN with this near/far). `sunColour` = CPU transmittance for the sun light colour. `updateEnv` = PMREM sky reflections every 2 s.
- **Player:** `P` (body-fixed pos/vel, `fwd` tangent kept by parallel transport, pitch), `stepPlayer`, `placeCamera`. `[` `]` change time speed (test).
- **Testing:** `YE.placeAt(x, y, z, yaw, pitch)` in site coords. Headless Chromium is slow with this renderer: take one screenshot at a time with a long screenshot timeout.
- Textures: `space/tex/` (CC0 Poly Haven, see `space/THIRD_PARTY.md`).
