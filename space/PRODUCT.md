# Product

<!-- impeccable:product-schema 1 -->

Scope: YeShip only (`/space/`). The rest of the repo holds other games with their own notes.

## Platform

web

## Users
The owner and two or three friends, mostly on laptops (trackpad first), playing in a browser tab. Sessions mix calm stretches (coasting, warping, walking the Moon) with tense moments (launch, staging, landing, docking) where they need numbers at a glance while their eyes stay on the rocket.

## Product Purpose
A co-op rocket builder and flight game: build a rocket from parts, fly semi-real orbital physics on a small spinning planet, reach the Moon and other worlds, launch station modules and assemble stations in orbit. Success is "we got there": a landing, a docking, a station that grew.

## Positioning
A browser game with KSP-style building and real orbits, but rendered for wonder (photo-matched sky, volumetric clouds, walkable cabin and space centre) and tuned for a few friends playing together from a link, no install.

## Operating Context
- Fullscreen WebGL canvas; every piece of UI floats over the live 3D view, so UI competes with the scene for attention.
- Modes the UI must serve: main menu, on foot (space centre, other worlds), flight (pilot seat or chase view), map view with burn nodes, builder (own full-screen editor), pause card, mission list, test menu.
- Keyboard-first controls with mouse look; time warp up to ×100000.

## Capabilities and Constraints
- Plain HTML/CSS/JS, Three.js r170 classic build, no framework, no build step. Hosted on GitHub Pages.
- 30 rocket parts, side boosters, paint schemes, cargo-bay station modules, assisted docking, 23+ missions, worlds: Home, Moon, Rust, Frost, Ember, Pebble.
- Co-op rooms over the relay (space/net.js): one shared rocket flown by whoever has the Pilot seat.
- Assets must be free to ship publicly (CC0 preferred); record every third-party asset in `space/THIRD_PARTY.md`.

## Brand Commitments
- Name: YeShip. Tone from the design plan: chill wonder, calm and pretty, light humour; sound effects only, no music.
- Look and parts are our own; no copied characters or style from other rocket games.

## Evidence on Hand
- Textures in `space/tex/` (Poly Haven, CC0). No logo file; the name is set in type.
- No real players' quotes or stats; never invent them.

## Product Principles
1. The view comes first: UI gets out of the way of the rocket, the planet and the sky.
2. Numbers you need, when you need them: fewer words, more glanceable state.
3. Calm by default, loud only for real danger (crash speed, low fuel, staging with fuel left).
4. Every control is reachable by keyboard and shown where it applies, not in walls of help text.

## Accessibility & Inclusion
Readable over bright and dark scenes (sky, snow, night side); text must keep contrast against a moving 3D background.
