# BREACHLINE

Browser 5v5 tactical breach-and-defend shooter (Fascists vs Communists) with destructible walls, barricades, reinforcements, drones and bots. No build step.

Run: serve this folder (`python3 -m http.server`) and open `index.html`. Works on GitHub Pages as-is.

Status: early work in progress. Operators/agents not added yet.

## 24 Nov 2026 polish
- Pause screen has a Leave match button (back to the menu) and a clearer layout.
- Sensitivity and volume are remembered between visits (localStorage `bl-sens`, `bl-vol`).

## 24 Nov 2026 polish (second pass)
- Bomb site and defuser markers stay on screen: when the spot is off screen or behind you, the marker is pinned to the nearest edge (dimmed) with its distance.
