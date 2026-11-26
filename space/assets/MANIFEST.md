# Lucas Space Program asset manifest

Only files the game uses are kept (pruned 26 Nov 2026). All CC0; sources, authors and licence files: `space/THIRD_PARTY.md` and `space/assets/licenses/`.
Code: `space/models.js` (loader `space/gltf-r170.js`, three r170 GLTFLoader as a classic script).

## Loading notes

- Binary glTF (`.glb`), no Draco/Meshopt. Car and industrial kits use `KHR_mesh_quantization` (GLTFLoader reads it).
- `kenney-station/*.glb` reference `Textures/colormap.png`: keep the folder intact.
- Scale per kit (metres per unit) lives in `MDL.kit` in models.js: polyhaven 1, kenney-station 2.2, kenney-car 2, kenney-industrial 7.5. `mdlGet` puts each model's feet at y 0, centred.
- Sounds: OGG Vorbis, peak-normalised, so beds and room tones play quiet (gain 0.03-0.15). `*_loop.ogg` loop seamlessly.

## Models: kenney-car (10 files, 835 KB)

| File | KB | What |
|---|---|---|
| models/kenney-car/ambulance.glb | 95 | ambulance |
| models/kenney-car/cone.glb | 23 | cone |
| models/kenney-car/delivery.glb | 82 | delivery |
| models/kenney-car/firetruck.glb | 97 | firetruck |
| models/kenney-car/sedan.glb | 74 | sedan |
| models/kenney-car/suv.glb | 91 | suv |
| models/kenney-car/tractor-shovel.glb | 138 | tractor shovel |
| models/kenney-car/truck-flat.glb | 81 | truck flat |
| models/kenney-car/truck.glb | 77 | truck |
| models/kenney-car/van.glb | 77 | van |

## Models: kenney-industrial (4 files, 161 KB)

| File | KB | What |
|---|---|---|
| models/kenney-industrial/shipping-container-a.glb | 33 | shipping container a |
| models/kenney-industrial/shipping-container-b.glb | 34 | shipping container b |
| models/kenney-industrial/shipping-container-c.glb | 33 | shipping container c |
| models/kenney-industrial/solar-panel-landscape-group.glb | 61 | solar panel landscape group |

## Models: kenney-station (15 files, 201 KB)

| File | KB | What |
|---|---|---|
| models/kenney-station/bed-single.glb | 6 | bed single |
| models/kenney-station/chair-armrest-headrest.glb | 14 | chair armrest headrest |
| models/kenney-station/chair-cushion.glb | 8 | chair cushion |
| models/kenney-station/chair-headrest.glb | 11 | chair headrest |
| models/kenney-station/computer-screen.glb | 19 | computer screen |
| models/kenney-station/computer-system.glb | 17 | computer system |
| models/kenney-station/computer-wide.glb | 17 | computer wide |
| models/kenney-station/container-flat-open.glb | 13 | container flat open |
| models/kenney-station/container-tall.glb | 13 | container tall |
| models/kenney-station/container-wide.glb | 12 | container wide |
| models/kenney-station/container.glb | 9 | container |
| models/kenney-station/table-display-planet.glb | 16 | table display planet |
| models/kenney-station/table-display.glb | 24 | table display |
| models/kenney-station/table-inset.glb | 12 | table inset |
| models/kenney-station/table.glb | 10 | table |

## Models: polyhaven (32 files, 11109 KB)

| File | KB | What |
|---|---|---|
| models/polyhaven/barrel_01.glb | 246 | Steel oil drum, worn |
| models/polyhaven/cardboard_box_01.glb | 255 | Cardboard box |
| models/polyhaven/classic_laptop.glb | 368 | Old laptop, open |
| models/polyhaven/fern_02.glb | 205 | Fern clump |
| models/polyhaven/fire_alarm.glb | 237 | Wall fire-alarm call point |
| models/polyhaven/flood_lights.glb | 839 | Floodlight mast head (4 lamps) |
| models/polyhaven/hand_truck.glb | 426 | Two-wheel hand truck (sack barrow) |
| models/polyhaven/industrial_storage_cart.glb | 340 | Industrial storage cart / trolley |
| models/polyhaven/korean_fire_extinguisher_01.glb | 452 | Fire extinguisher |
| models/polyhaven/ladder_sectioned_01.glb | 449 | Aluminium extension ladder |
| models/polyhaven/metal_jerrycan.glb | 337 | Metal jerrycan |
| models/polyhaven/metal_stool_01.glb | 230 | Metal shop stool |
| models/polyhaven/metal_toolbox.glb | 322 | Metal toolbox |
| models/polyhaven/modern_arm_chair_01.glb | 271 | Modern armchair |
| models/polyhaven/moon_rock_01.glb | 482 | Moon rock (photoscan, real size ~20 cm) |
| models/polyhaven/moon_rock_02.glb | 388 | Moon rock (photoscan, ~25 cm) |
| models/polyhaven/moon_rock_04.glb | 417 | Moon rock, flat (photoscan, ~17 cm) |
| models/polyhaven/moon_rock_06.glb | 166 | Moon rock (photoscan, ~9 cm) |
| models/polyhaven/old_military_crate.glb | 255 | Long military crate (1.8 m) |
| models/polyhaven/portable_generator.glb | 541 | Portable generator |
| models/polyhaven/portable_welding_cart.glb | 459 | Welding cart with gas bottles |
| models/polyhaven/potted_plant_04.glb | 324 | Small potted succulent |
| models/polyhaven/projector_screen.glb | 309 | Standing projector screen |
| models/polyhaven/propane_tank.glb | 263 | Small gas bottle |
| models/polyhaven/retro_multimeter.glb | 236 | Retro multimeter |
| models/polyhaven/security_camera_01.glb | 279 | Wall security camera |
| models/polyhaven/shrub_03.glb | 218 | Low shrub |
| models/polyhaven/tool_cart.glb | 450 | Green rolling tool cart |
| models/polyhaven/utility_box_01.glb | 242 | Electrical utility cabinet |
| models/polyhaven/vintage_spacecraft_instrument.glb | 769 | Vintage spacecraft instrument panel |
| models/polyhaven/wetfloorsign_01.glb | 105 | Wet-floor sign |
| models/polyhaven/wooden_crate_01.glb | 229 | Wooden crate |

## Textures

| File | KB |
|---|---|
| tex/painted_metal_c.jpg | 29 |
| tex/painted_metal_n.jpg | 15 |
| tex/painted_metal_r.jpg | 12 |

## Sounds

| File | KB |
|---|---|
| sfx/airlock_hiss.ogg | 14 |
| sfx/booster_crackle.ogg | 159 |
| sfx/control_room_hum_loop.ogg | 309 |
| sfx/dock_clunk.ogg | 19 |
| sfx/dock_clunk_light.ogg | 11 |
| sfx/explosion_big.ogg | 102 |
| sfx/fluorescent_buzz_loop.ogg | 109 |
| sfx/footstep_dust_000.ogg | 7 |
| sfx/footstep_dust_001.ogg | 7 |
| sfx/footstep_dust_002.ogg | 7 |
| sfx/footstep_dust_003.ogg | 7 |
| sfx/footstep_dust_004.ogg | 7 |
| sfx/hangar_ambience_loop.ogg | 374 |
| sfx/liftoff_rumble.ogg | 265 |
| sfx/rocket_engine_loop.ogg | 36 |
| sfx/rocket_thrust_loop.ogg | 163 |
| sfx/scifi_hum_loop.ogg | 95 |
| sfx/space_ambience_loop.ogg | 501 |
| sfx/staging_thud.ogg | 29 |
| sfx/station_ambience_loop.ogg | 144 |
| sfx/wind_loop.ogg | 376 |
| sfx/kenney/explosionCrunch_002.ogg | 47 |
| sfx/kenney/footstep_carpet_000.ogg | 6 |
| sfx/kenney/footstep_carpet_001.ogg | 6 |
| sfx/kenney/footstep_carpet_002.ogg | 6 |
| sfx/kenney/footstep_carpet_003.ogg | 6 |
| sfx/kenney/footstep_carpet_004.ogg | 6 |
| sfx/kenney/footstep_concrete_000.ogg | 6 |
| sfx/kenney/footstep_concrete_001.ogg | 6 |
| sfx/kenney/footstep_concrete_002.ogg | 6 |
| sfx/kenney/footstep_concrete_003.ogg | 6 |
| sfx/kenney/footstep_concrete_004.ogg | 6 |
| sfx/kenney/footstep_snow_000.ogg | 8 |
| sfx/kenney/footstep_snow_001.ogg | 8 |
| sfx/kenney/footstep_snow_002.ogg | 8 |
| sfx/kenney/footstep_snow_003.ogg | 8 |
| sfx/kenney/footstep_snow_004.ogg | 7 |
| sfx/kenney/impactMetal_light_000.ogg | 7 |
| sfx/kenney/impactMetal_light_001.ogg | 7 |
| sfx/kenney/impactMetal_light_002.ogg | 7 |
| sfx/kenney/impactPlate_heavy_001.ogg | 9 |
| sfx/kenney/lowFrequency_explosion_000.ogg | 14 |
