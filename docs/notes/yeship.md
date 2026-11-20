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
- **Scale (owner picked 10x, 20 Nov 2026):** planet R 600 km, g 9.81, orbit speed ~2.4 km/s (~10 min to orbit), day 6 h (`day` 21600), air top `atmo` 22 km (HR 2500, HM 500, Rayleigh x3.2 Earth, ozone layer `BO` centred 7.8 km). Moon R 200 km, g 1.63, orbit 12,000 km (~38 h period). `FAR` 6e7. Terrain `maxL` 15 (planet) / 14 (moon). Clouds at 2.2 km.
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
  - Sun matched to ISS photos: small blown-out white disc, tight halo, two faint thin spike pairs (no big starburst).
  - Sunset: ozone absorption (pink/violet twilight); clouds get a pink-violet twilight term; ground exposure capped at dusk (`EMAX` 3.5 in the air, 14 in space).
  - Per-pixel sunlight on terrain + sea (`sunTrans` in the `cloudShadow` injection): reddened through the air and cut at the terminator; the lights loop multiplies `directLight.color` by `gSunT` = sunTrans / camera transmittance (`CLOUDU.camT`).
- **Nebula + light rays (owner: "Interstellar type", 20 Nov 2026):** emission nebula in `bakeSky` (centred on inertial dir (-.42,.5,.76), tilted ellipse, nested domain warping, pink H-alpha / teal OIII / gold, bright rims, dust, faint cluster). Light shafts: `raysM` at 1/4 res (56-step radial march from each pixel toward the sun over sky pixels, jittered then blurred twice), added in `compM` (`rOn`, `tR`); strength 1.8 in air, .4 in space; High only. Sun bloom capped (bright pass clamps at 6) so the sun can't wash the screen white.
- **Shadow square fix:** `THREE.ShaderChunk.shadowmap_pars_fragment` is patched at the top of game.js so shadows fade out toward the shadow-map edge (the 520 m shadow square no longer shows).
- **Render:** log depth buffer, HalfFloat target with depth texture. Post: `atmoM` ray-marched single scattering (Rayleigh + Mie, planet shadow) uses scene depth for aerial perspective; then bloom and ACES (`compM`). View rays use the near plane (far-plane unprojection is NaN with this near/far). `sunColour` = CPU transmittance for the sun light colour. `updateEnv` = PMREM sky reflections every 2 s.
- **Player:** `P` (body-fixed pos/vel, `fwd` tangent kept by parallel transport, pitch), `stepPlayer`, `placeCamera`. `[` `]` change time speed (test).
- **Testing:** `YE.placeAt(x, y, z, yaw, pitch)` in site coords. Headless Chromium is slow with this renderer: take one screenshot at a time with a long screenshot timeout.
- Textures: `space/tex/` (CC0 Poly Haven, see `space/THIRD_PARTY.md`).
