'use strict';
// Lucas Space Program places to visit (26 Nov 2026): landmarks with a "?" marker and missions. Home: the summit cairn on the western peaks.
// Rust: the old rover "Rusty". Frost: ice geysers. Ember (volcanic moon, game.js): Fire Mountain. Pebble (asteroid, game.js): just land on it.
// Loaded after station.js, before polish.js (which calls boot()).

const LM = []; // {id, b, name, pos (body-fixed), up, g, r (visit radius), hint, flag}
const _lq = new Q4(), _l1 = new V3(), _l2 = new V3();
function lmFlat(b, center, spread, tries = 48) { // flattest of a few spots around a direction (body-fixed unit vector)
  const e = new V3(0, 1, 0).cross(center); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); const n = center.clone().cross(e).normalize(); let best = center.clone(), bs = 1e9; const k = 4 / b.R;
  for (let i = 0; i < tries; i++) { const a = (i % 8 - 3.5) / 3.5 * spread, c = (Math.floor(i / 8) - 2.5) / 2.5 * spread, d = center.clone().addScaledVector(e, a).addScaledVector(n, c).normalize(), h0 = heightAt(b, d.x, d.y, d.z);
    let sl = 0; for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = d.clone().addScaledVector(e, x * k).addScaledVector(n, y * k).normalize(); sl += Math.abs(heightAt(b, q.x, q.y, q.z) - h0); } if (sl < bs) { bs = sl; best = d; } }
  return best; }
function lmAdd(id, b, dir, name, r, hint, build) { const pos = dir.clone().multiplyScalar(b.R + heightAt(b, dir.x, dir.y, dir.z)), g = new THREE.Group(); g.position.copy(pos).addScaledVector(dir, -.1); g.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
  b.group.add(g); const L = {id, b, name, pos, up: dir.clone(), g, r, hint}; if (build) build(g, L); g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); LM.push(L); return L; }
const LMM = {grey: new THREE.MeshStandardMaterial({color: 0x8a8d92, roughness: .5, metalness: .6}), dark: new THREE.MeshStandardMaterial({color: 0x26282c, roughness: .6, metalness: .3}),
  white: new THREE.MeshStandardMaterial({color: 0xe8e6df, roughness: .45, metalness: .1}), gold: new THREE.MeshStandardMaterial({color: 0xc9962e, roughness: .35, metalness: .9}),
  stone: new THREE.MeshStandardMaterial({color: 0x77736c, roughness: .95}), orange: new THREE.MeshStandardMaterial({color: 0xff7a1e, roughness: .7, side: THREE.DoubleSide}),
  solar: new THREE.MeshStandardMaterial({color: 0x1b2d5a, roughness: .3, metalness: .6}), dust: new THREE.MeshStandardMaterial({color: 0x9a5a36, roughness: 1}), ice: new THREE.MeshStandardMaterial({color: 0xbcd6ea, roughness: .25, metalness: .1})};
const lmBox = (g, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
function lmBuild() {
  // Home: the highest point of the western mountains, with a cairn and a flag
  { let best = null, bh = -1e9; for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) { const d = siteToBody(new V3(-3000 - i * 260, 0, -3400 + j * 260), new V3()).normalize(), h = heightAt(PLANET, d.x, d.y, d.z); if (h > bh) { bh = h; best = d; } }
    // walk uphill a little to the true top
    for (let it = 0; it < 30; it++) { const e = new V3(0, 1, 0).cross(best).normalize(), n = best.clone().cross(e), st = 25 / PLANET.R; let moved = false;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = best.clone().addScaledVector(e, a * st).addScaledVector(n, c * st).normalize(), h = heightAt(PLANET, q.x, q.y, q.z); if (h > bh) { bh = h; best = q; moved = true; } } if (!moved) break; }
    lmAdd('peak', PLANET, best, 'Summit cairn', 14, 'The cairn has a tin box. Inside, a note: "Nice climb. The view is better from orbit."', g => {
      for (let k = 0; k < 9; k++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(.55 - k * .04, 0), LMM.stone); s.position.set(Math.sin(k * 2.3) * (.5 - k * .05), .3 + k * .32, Math.cos(k * 2.3) * (.5 - k * .05)); s.rotation.set(k, k * 1.7, k * .3); g.add(s); }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 4.4, 8), LMM.grey); pole.position.y = 2.6; g.add(pole);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .8, 6, 2), LMM.orange); fl.position.set(.72, 4.3, 0); g.add(fl); g.userData.flag = fl; }); }
  // Rust: the old rover, its tracks fading behind it
  { const near = RUST.c.clone().negate().normalize().applyQuaternion(RUST.q.clone().invert()), side = new V3(0, 1, 0).cross(near).normalize(), dir = lmFlat(RUST, near.clone().addScaledVector(side, .35).normalize(), .02);
    lmAdd('rover', RUST, dir, 'Rover Rusty', 10, 'Rover Rusty. Odometer: 45.2 km. Last message home: "Wheels tired. Very red here. Send oil."', g => {
      lmBox(g, 2.4, .5, 1.6, LMM.white, 0, 1.1, 0); lmBox(g, 2.6, .06, 1.9, LMM.solar, 0, 1.4, 0); lmBox(g, .5, .35, .9, LMM.gold, -.7, 1.55, 0);
      const mast = lmBox(g, .1, 1.3, .1, LMM.grey, .9, 2.0, .5); const cam2 = lmBox(g, .4, .2, .25, LMM.dark, .9, 2.7, .5); cam2.rotation.y = .5;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(.45, 16, 8, 0, 6.283, 0, 1.1), LMM.white); dish.position.set(-.6, 2.0, -.5); dish.rotation.x = -.8; g.add(dish);
      for (const x of [-1, 0, 1]) for (const z of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .3, 16), LMM.dark); w.rotation.x = Math.PI / 2; w.position.set(x * .95, .36, z * 1.05); g.add(w); lmBox(g, .08, .6, .08, LMM.grey, x * .95, .75, z * .9); }
      const arm = lmBox(g, 1.3, .08, .08, LMM.grey, 1.7, .9, 0); arm.rotation.z = -.4; lmBox(g, 2.5, .5, 1.7, LMM.dust, 0, 1.38, 0).scale.set(1, .06, 1); // a coat of red dust on the deck
      for (let k = 1; k < 40; k++) for (const z of [-1.05, 1.05]) { const t = lmBox(g, .5, .02, .3, LMM.dark, -1.6 - k * .9, .01, z + Math.sin(k * .2) * .8); t.material = new THREE.MeshStandardMaterial({color: 0x3a1c12, roughness: 1, transparent: true, opacity: Math.max(0, .6 - k * .015)}); } }); }
  // Frost: geysers (vents that throw ice into space)
  { const near = FROST.c.clone().negate().normalize().applyQuaternion(FROST.q.clone().invert()), side = new V3(0, 1, 0).cross(near).normalize(), dir = lmFlat(FROST, near.clone().addScaledVector(side, -.3).normalize(), .02);
    lmAdd('geyser', FROST, dir, 'Ice geysers', 60, 'The ground hums. Ice crystals sparkle as they shoot up into space and never come back down.', (g, L) => { L.vents = [];
      for (const [x, z] of [[0, 0], [24, 10], [-18, 20]]) { const v = new THREE.Mesh(new THREE.ConeGeometry(4, 2.2, 18, 1, true), LMM.ice); v.position.set(x, .8, z); g.add(v); const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), LMM.dark); hole.rotation.x = -Math.PI / 2; hole.position.set(x, 1.85, z); g.add(hole); L.vents.push(new V3(x, 2, z)); } }); }
  // Ember: Fire Mountain's caldera rim (the mountain is in the terrain)
  { const f = EMBER.fm, e = new V3(0, 1, 0).cross(f).normalize(), dir = f.clone().addScaledVector(e, 2750 / EMBER.R).normalize();
    lmAdd('fire', EMBER, dir, 'Fire Mountain', 150, 'You stand on the rim of Fire Mountain. Far below, the lava lake glows and churns.', g => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 3.6, 8), LMM.grey); pole.position.y = 1.8; g.add(pole); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .7, 6, 2), LMM.orange); fl.position.set(.62, 3.2, 0); g.add(fl); }); }
}

// ---------------- marker, visits, geyser spray
const lmTag = document.createElement('div'); lmTag.id = 'lmTag'; lmTag.className = 'hidden'; document.body.appendChild(lmTag);

const LM_MIS = {peak: 'peak', rover: 'rover', geyser: 'geyser', fire: 'fire'};
const lmWorld = (L, out) => out.copy(L.pos).applyQuaternion(L.b.q).add(L.b.c);
let geyAcc = 0;
function lmStep(dt) {
  if (!G.on || !LM.length) return; const me = R.on ? R.pos : _l1.copy(P.pos).applyQuaternion(P.body.q).add(P.body.c), myB = domBody(me);
  // which landmark to point at: the current mission's, else one on the world you are at (within 300 km)
  let show = null; for (const L of LM) { if (MIS.cur === LM_MIS[L.id] && !MIS.done[MIS.cur]) { show = L; break; } } if (!show) { let bd = 3e5; for (const L of LM) { if (L.b !== myB) continue; const d = lmWorld(L, _l2).distanceTo(me); if (d < bd) { bd = d; show = L; } } }
  if (show && !MAPV.on && !(typeof BLD !== 'undefined' && BLD.on)) { const w = lmWorld(show, _l2), d = w.distanceTo(me), p = w.sub(G.O).project(cam), ok = d > 15 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1; lmTag.classList.toggle('hidden', !ok);
    if (ok) { lmTag.style.transform = 'translate(' + ((p.x * .5 + .5) * innerWidth).toFixed(1) + 'px,' + ((-p.y * .5 + .5) * innerHeight).toFixed(1) + 'px) translate(-50%,-120%)'; const t = show.name + ' · ' + fmtD(d); if (lmTag._t !== t) { lmTag._t = t; lmTag.textContent = t; } } }
  else lmTag.classList.add('hidden');
  // visits: on foot within the radius, or landed close (FLOG flags for the missions)
  for (const L of LM) { if (!R.on && P.body === L.b) { const d = P.pos.distanceTo(L.pos); if (d < L.r) { FLOG[L.id] = true; if (!L.read) { L.read = true; showHint(L.hint, 7000); sfx && SND.c && warnTone(880, 1); } } else if (d > L.r * 3) L.read = false; if (d < 1500) FLOG[L.id + 'Near'] = true; }
    if (R.st === 'landed' && R.body === L.b && R.lp.distanceTo(L.pos) < (L.id === 'fire' ? 6000 : 3000)) FLOG[L.id + 'Land'] = true; }
  // flags flutter
  for (const L of LM) { const f = L.g.userData.flag; if (f && L.b === PLANET) { const pa = f.geometry.attributes.position, t = G.t * 4; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) + .7; pa.setZ(i, Math.sin(x * 4 - t) * .12 * x); } pa.needsUpdate = true; } }
  // geysers: ice spray while you are near
  const gy = LM.find(L => L.id === 'geyser'); if (gy && G.O.distanceTo(lmWorld(gy, _l2)) < 25000 && G.warp <= 10) { geyAcc += dt * 45; const vg = groundVel(gy.b, _l2, G.t, new V3()), upW = gy.up.clone().applyQuaternion(gy.b.q);
    while (geyAcc > 1) { geyAcc--; const vent = gy.vents[Math.random() * gy.vents.length | 0], p = vent.clone().applyQuaternion(gy.g.quaternion).add(gy.g.position).applyQuaternion(gy.b.q).add(gy.b.c), sp = 25 + Math.random() * 45;
      puff(p, vg.clone().addScaledVector(upW, sp).add(new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(5)), {life: 4 + Math.random() * 4, s: 1.2, gr: 2.5, heat: 0, drag: 0, tone: 1.15}); } }
}
// map: the current mission's landmark
{ const mr = mapRender; mapRender = function (dt) { mr(dt); const L = LM.find(l => MIS.cur === LM_MIS[l.id] && !MIS.done[MIS.cur]); if (!L) return; const x = MAPV.x, p = lmWorld(L, _l2).multiplyScalar(.001).project(MAPV.cam); if (p.z > 1) return;
  const sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight; x.font = '700 13px Archivo, sans-serif'; x.fillStyle = '#ff9dd2'; x.textAlign = 'center'; x.fillText('? ' + L.name, sx, sy - 6); x.textAlign = 'left'; }; }

// ---------------- test menu jumps
function lmWalk(id, off = 40) { const L = LM.find(l => l.id === id); if (!L) return; onFoot(); const e = new V3(0, 1, 0).cross(L.up).normalize(), d = L.up.clone().addScaledVector(e, off / L.b.R).normalize(); P.body = L.b; P.pos.copy(d).multiplyScalar(L.b.R + heightAt(L.b, d.x, d.y, d.z) + 2); P.vel.set(0, 0, 0);
  P.fwd.copy(L.pos).sub(P.pos); P.fwd.addScaledVector(d, -P.fwd.dot(d)).normalize(); P.pitch = .05; showHint(L.name + ' on ' + L.b.name, 3000); }
Object.assign(TESTS, {emberOrbit() { satOrbit(EMBER); }, pebbleOrbit() { satOrbit(PEBBLE); }, emberWalk() { lmWalk('fire', 400); }, pebbleWalk() { satWalk(PEBBLE); }, peakWalk() { lmWalk('peak', 60); }, roverWalk() { lmWalk('rover', 30); }, geyserWalk() { lmWalk('geyser', 90); }});
{ const grid = document.querySelector('#test .tg'); if (grid) for (const [k, t] of [['emberOrbit', 'Ember orbit'], ['emberWalk', 'Fire Mountain rim'], ['pebbleOrbit', 'Pebble orbit'], ['pebbleWalk', 'Walk on Pebble'], ['peakWalk', 'Summit cairn'], ['roverWalk', 'Rover Rusty'], ['geyserWalk', 'Frost geysers']]) {
    const b = document.createElement('button'); b.dataset.t = k; b.textContent = t; b.onclick = e => { e.stopPropagation(); TESTS[k](); testMenu(false); }; grid.insertBefore(b, grid.querySelector('[data-t="deck"]')); } }

// ---------------- missions
MISD.push(
  {id: 'peak', name: 'Peak bagger', d: 'No rocket needed: climb the highest peak in the mountains west of the space centre.', bonus: true, steps: [
    ['Walk west into the mountains (follow the pink ? marker)', F => F.peakNear || F.peak], ['Stand by the summit cairn', F => F.peak]], done: F => F.peak},
  {id: 'pebble', name: 'Pebble hop', d: 'Land on Pebble, the little asteroid 3,400 km up, and step outside.', steps: [
    ['Get into orbit', F => F.orbit || F.pebbleSOI], ['In the map pick Pebble (Tab) and press Transfer, then burn', F => F.pebbleSOI || (NODE && NAVT.b === PEBBLE)], ['Coast into Pebble\'s pull and match its speed (3 retrograde)', F => F.pebbleSOI],
    ['Touch down gently: there is almost no gravity', F => F.pebbleLanded], ['Step outside (a big jump could send you to space!)', F => F.pebbleWalk]], done: F => F.pebbleWalk},
  {id: 'ember', name: 'Fire world', d: 'Fly to Ember (20,000 km), the volcanic moon, and land on its black plains.', steps: [
    ['Get into orbit', F => F.orbit || F.emberSOI], ['Pick Ember in the map (Tab), press Transfer and burn', F => F.emberSOI || (NODE && NAVT.b === EMBER)], ['Coast into Ember\'s pull', F => F.emberSOI], ['Land on Ember (keep off the glowing lava)', F => F.emberLanded]], done: F => F.emberLanded},
  {id: 'fire', name: 'Fire Mountain', d: 'Land near the top of Fire Mountain, Ember\'s 7 km volcano, and walk to the caldera rim.', steps: [
    ['Reach Ember', F => F.emberSOI || F.fireLand], ['Land within 6 km of the summit (the pink ? marker)', F => F.fireLand], ['Walk to the flag on the caldera rim', F => F.fire]], done: F => F.fire},
  {id: 'rover', name: "Rusty's last drive", d: 'Find the old rover on Rust and walk up to it.', steps: [
    ['Reach Rust', F => F.rustSOI || F.roverLand], ['Land within 3 km of the rover (pink ? marker)', F => F.roverLand || F.rover], ['Walk up to Rusty', F => F.rover]], done: F => F.rover},
  {id: 'geyser', name: 'Ice fountains', d: 'Visit the geysers on Frost that spray ice into space.', steps: [
    ['Reach Frost', F => F.frostSOI || F.geyserLand], ['Land within 3 km of the geysers', F => F.geyserLand || F.geyser], ['Walk to the vents', F => F.geyser]], done: F => F.geyser});

{ const v0 = FLIGHT.visuals; FLIGHT.visuals = function (dt) { v0(dt); lmStep(dt); }; }
{ const b0 = boot; boot = function () { b0(); lmBuild(); }; }
Object.assign(window.YE, {LM, lmWalk, EMBER, PEBBLE});
