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
- **Visual pass (20 Nov 2026, owner wants realistic and stunning above all):**
  - `bakeSky()`: Milky Way (band, bulge, dust lanes, red/blue nebulae) + 3 star layers baked into a HalfFloat cube map, one face per frame (`G.skyBake`), used as `scene.background`. Fades in daylight via `scene.backgroundIntensity`.
  - Shared GLSL: `GLSL_ATMO` (`rs`, `scatter`) and `GLSL_NOISE` (`h31`, `vn`, `fbm3`); `atmoU()` gives the uniforms. `SUN_I` = sun irradiance in the same units as the directional light (3.4); keep them matched or the sky washes out the ground.
  - Sun: limb-darkened disc + glow in `atmoM`; glare, starburst and 6 lens ghosts in `compM` (visibility from depth taps around the sun).
  - Eye adaptation: `lumM` -> `avgM` (log average, centre weighted, eased) in `POST.ad0/ad1`; exposure = .16 / adapted, clamped .02..3.
  - Bloom at 1/4 and 1/16 res. SSAO (`ssaoM`, half res, 12 taps, High only) multiplies the scene before the atmosphere pass.
  - `updateEnv`: PMREM sky reflections from the real scattering (`envMat`), every 1.5 s.
  - Clouds: `makeClouds` shell at `CLOUD_H` 2.6 km, child of the planet group. Two passes: depth only where thick (`DEPTHONLY`, c > .6), then colour with no depth writes. Per-pixel sunlight through the air (sunset colours) and planet shadow.
  - Ocean: `waveTex` (tileable wave normals made at load), 3 scrolling samples in `waterMat`, UVs per chunk (/64 m).
  - Moon: `CRATERS` (700, power-law sizes, `young` ones with ray streaks), `mareAt` (dark basalt plains), `microCraters` (3 scales, 2x2x2 cells). `CR_NEAR` = craters near the chunk being built (speed). `moonMat` = grey-only texture detail (`customProgramCacheKey` 'moon').
  - Test hooks: `YE.prebuild(ms)` builds terrain synchronously; `G.noGrav` freezes the player.
- **Photo-matching pass (20 Nov 2026):** compared with NASA photos (ISS limb, sun glint, Apollo surface, Earth from lunar orbit). Thin atmosphere (`atmo` 7.5 km, HR 950, HM 190, Earth-like column density) so the limb is a crisp band; clouds at 1.5 km; lower relief (mountains ~2 km, snow 1.35 km+). Metering floor .012 so a lit planet isn't blown out next to black space; stars dimmed so they only show when you look away from bright things. Cloud shadows on ground + sea (`cloudShadow`, `CLOUDU`, `bd` attribute = body direction), broader far glint. Moon warmer and with a 4th micro-crater scale; no fill light in space. Shadow map +-260 m, texel snapped.
  - Ocean too light (owner): the cause was exposure, not the water. Auto exposure re-normalises everything, so tweaks to water/air looked identical; exposure key is now .1 (was .16), which keeps clouds unclipped and the sea dark. Water also has a dark deep sea floor, opacity .97, and its sky reflection scaled x.12 in the shader (`radiance`/`iblIrradiance`; three ignores `envMapIntensity` with `scene.environment`). Check exposure first when something looks too bright or dark.
  - Open question for the owner: the 60 km planet curves far more than Earth in photos; a bigger planet looks more real but makes flights longer.
- **Render:** log depth buffer, HalfFloat target with depth texture. Post: `atmoM` ray-marched single scattering (Rayleigh + Mie, planet shadow) uses scene depth for aerial perspective; then bloom and ACES (`compM`). View rays use the near plane (far-plane unprojection is NaN with this near/far). `sunColour` = CPU transmittance for the sun light colour. `updateEnv` = PMREM sky reflections every 2 s.
- **Player:** `P` (body-fixed pos/vel, `fwd` tangent kept by parallel transport, pitch), `stepPlayer`, `placeCamera`. `[` `]` change time speed (test).
- **Testing:** `YE.placeAt(x, y, z, yaw, pitch)` in site coords. Headless Chromium is slow with this renderer: take one screenshot at a time with a long screenshot timeout.
- Textures: `space/tex/` (CC0 Poly Haven, see `space/THIRD_PARTY.md`).
