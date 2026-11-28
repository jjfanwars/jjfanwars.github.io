// UNDERGROWTH: raid.js
// The raid loop: several targets inside the firebase, destroyed in any order with grenades
// (the ammo dump needs the satchel), and tunnels that resupply whoever is hiding in them.

import * as THREE from 'three';
import { WORLD, canvasTexture, clamp } from './util.js';

const RESUPPLY_HOLD = 2.5;     // seconds underground before the runners reach you
const RESUPPLY_GAP = 25;       // seconds between resupplies
const FULL = { grenades: 4, traps: 4, reserve: 210 };

export function createRaid(ctx) {
  const ev = ctx.events;
  const scene = ctx.scene;
  const heightAt = (x, z) => ctx.world?.heightAt?.(x, z) ?? 0;
  const fb = WORLD.firebase;

  // ---------- targets ----------
  const targets = [];
  const add = (id, label, x, z, r, extra = {}) => targets.push({ id, label, x, z, y: heightAt(x, z), r, done: false, ...extra });
  const pits = ctx.world?.firebase?.gunPits;
  const guns = Array.isArray(pits) && pits.length ? pits.map((p) => [p.x, p.z]) : [[fb.x + 9, fb.z + 19], [fb.x + 19, fb.z + 6], [fb.x - 10, fb.z - 19]];
  guns.forEach(([x, z], i) => add('gun' + (i + 1), 'Howitzer ' + (i + 1), x, z, 5.5));
  add('fuel', 'Fuel store', fb.x - 4, fb.z - 9, 5.5, { chain: true });
  add('toc', 'Command post', fb.x - 9, fb.z - 3, 6);
  add('dump', 'Ammo dump', WORLD.ammoDump.x, WORLD.ammoDump.z, 0, { satchel: true });

  // ---------- fire and smoke on wrecks ----------
  const puff = canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, { repeat: false });
  const fires = [];
  function light(t) {
    const grp = new THREE.Group();
    grp.position.set(t.x, t.y, t.z);
    const flames = [], smoke = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.SpriteMaterial({ map: puff, color: i % 2 ? 0xff7a1c : 0xffc24a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
      const s = new THREE.Sprite(m);
      s.userData = { ph: Math.random() * 6.28, ox: (Math.random() - 0.5) * 1.6, oz: (Math.random() - 0.5) * 1.6 };
      grp.add(s); flames.push(s);
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.SpriteMaterial({ map: puff, color: 0x15120f, depthWrite: false, transparent: true, fog: true });
      const s = new THREE.Sprite(m);
      s.userData = { t: i / 6, ox: (Math.random() - 0.5) * 1.2, oz: (Math.random() - 0.5) * 1.2 };
      grp.add(s); smoke.push(s);
    }
    scene.add(grp);
    fires.push({ grp, flames, smoke, age: 0 });
  }
  function updateFires(dt) {
    const time = ctx.time;
    for (const f of fires) {
      f.age += dt;
      const burn = clamp(1.15 - f.age / 240, 0.35, 1);       // dies down over a few minutes
      for (const s of f.flames) {
        const u = s.userData, k = 0.75 + 0.25 * Math.sin(time * 11 + u.ph) + 0.15 * Math.sin(time * 23 + u.ph * 2);
        const sc = 2.4 * k * burn;
        s.scale.set(sc, sc * 1.5, 1);
        s.position.set(u.ox, 0.6 + sc * 0.55, u.oz);
        s.material.opacity = 0.85 * burn;
      }
      for (const s of f.smoke) {
        const u = s.userData;
        u.t += dt * 0.13;
        if (u.t > 1) u.t -= 1;
        const sc = 2 + u.t * 7;
        s.scale.set(sc, sc, 1);
        s.position.set(u.ox + u.t * u.t * 5, 1.5 + u.t * 16, u.oz + u.t * 1.5);
        s.material.opacity = 0.55 * Math.sin(Math.min(1, u.t * 1.15) * Math.PI);
      }
    }
  }

  // ---------- checklist on the HUD ----------
  const host = document.getElementById('hud');
  const style = document.createElement('style');
  style.textContent = `
.ug-raid{position:absolute;left:22px;top:84px;padding:6px 14px 6px 14px;background:rgba(12,14,10,.42);font:500 10.5px/1.75 ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  letter-spacing:.12em;text-transform:uppercase;color:rgba(215,209,188,.82);opacity:0;transition:opacity .5s;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.ug-raid.on{opacity:1}
.ug-raid div::before{content:"";display:inline-block;width:6px;height:6px;margin:0 9px 1px 0;border:1px solid rgba(201,169,101,.9);transform:rotate(45deg)}
.ug-raid div.done{color:rgba(215,209,188,.34);text-decoration:line-through}
.ug-raid div.done::before{background:rgba(201,113,74,.9);border-color:transparent}
.ug-raid div.near{color:#e4c98a}
@media (max-width:700px){.ug-raid{top:96px;font-size:9.5px}}`;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.className = 'ug-raid';
  const rows = new Map();
  for (const t of targets) {
    const r = document.createElement('div');
    r.textContent = t.satchel ? t.label + ' · satchel' : t.label;
    box.appendChild(r); rows.set(t.id, r);
  }
  host?.appendChild(box);

  // ---------- kits: picked on the title screen ----------
  const kitStyle = document.createElement('style');
  kitStyle.textContent = `
#ug-kits{position:absolute;left:max(24px,env(safe-area-inset-left));bottom:calc(max(22px,env(safe-area-inset-bottom)) + 40px);z-index:5;
  display:none;pointer-events:auto;padding:2px;border:1px solid rgba(215,209,188,.18);border-radius:3px;background:rgba(10,12,9,.55);backdrop-filter:blur(4px)}
body[data-state="menu"] #ug-kits{display:inline-flex}
#ug-kits button{appearance:none;border:0;margin:0;padding:6px 12px;border-radius:2px;cursor:pointer;background:transparent;color:rgba(215,209,188,.5);
  font:600 10px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;transition:color .15s,background-color .15s}
#ug-kits button:hover{color:rgba(215,209,188,.85)}
#ug-kits button[aria-checked="true"]{background:rgba(215,209,188,.13);color:#d7d1bc}
#ug-scope{position:fixed;inset:0;z-index:9;pointer-events:none;opacity:0;
  background:radial-gradient(circle at 50% 50%,transparent 0,transparent 33vh,rgba(0,0,0,.55) 33.6vh,#000 35vh)}
#ug-scope::before,#ug-scope::after{content:"";position:absolute;background:rgba(0,0,0,.85)}
#ug-scope::before{left:50%;top:calc(50% - 34vh);width:1px;height:68vh}
#ug-scope::after{top:50%;left:calc(50% - 34vh);height:1px;width:68vh}`;
  document.head.appendChild(kitStyle);
  const scopeEl = document.createElement('div');
  scopeEl.id = 'ug-scope';
  document.body.appendChild(scopeEl);
  const kitEl = document.createElement('div');
  kitEl.id = 'ug-kits';
  kitEl.setAttribute('role', 'radiogroup');
  kitEl.setAttribute('aria-label', 'Kit');
  function pickKit(name) {
    const w = ctx.weapons;
    if (!w?.setKit || ctx.mission?.started) return;
    const got = w.setKit(name);
    try { localStorage.setItem('ug-kit', got); } catch (e) { /* private mode */ }
    for (const b of kitEl.children) b.setAttribute('aria-checked', String(b.dataset.kit === got));
  }
  for (const name of Object.keys(ctx.weapons?.kits || {})) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.kit = name; b.setAttribute('role', 'radio');
    b.textContent = ctx.weapons.kits[name].label;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pickKit(name); });
    kitEl.appendChild(b);
  }
  const menuEl = document.getElementById('menu');
  const mountKits = () => { if (menuEl && kitEl.parentNode !== menuEl) menuEl.appendChild(kitEl); };
  mountKits();
  if (menuEl && typeof MutationObserver === 'function') new MutationObserver(mountKits).observe(menuEl, { childList: true });
  let savedKit = 'rifleman';
  try { savedKit = new URLSearchParams(location.search).get('kit') || localStorage.getItem('ug-kit') || 'rifleman'; } catch (e) { /* private mode */ }
  pickKit(savedKit);
  function updateScope() {
    const w = ctx.weapons;
    if (!w) return;
    const on = !!w.scope && w.current === 'rifle' && ctx.state === 'playing';
    const k = on ? clamp((w.ads - 0.7) / 0.25, 0, 1) : 0;
    scopeEl.style.opacity = k ? String(k) : '0';
    if (w.viewRoot) w.viewRoot.visible = k < 0.5;
    w.lookScale = k > 0.5 ? 0.28 : 1;
  }

  // ---------- state ----------
  const api = {
    targets,
    get total() { return targets.length; },
    get destroyed() { return targets.filter((t) => t.done).length; },
    get remaining() { return targets.length - api.destroyed; },
    nearest: null,
    destroy, update,
  };
  ctx.raid = api;

  const pending = [];          // delayed secondary explosions
  function destroy(t, by) {
    if (!t || t.done) return false;
    t.done = true;
    rows.get(t.id)?.classList.add('done');
    light(t);
    const left = api.remaining;
    try { ctx.hud?.toast?.(left ? `${t.label} destroyed · ${left} left` : `${t.label} destroyed`, 3200); } catch (e) { /* optional */ }
    try { ctx.audio?.play?.('alarm', new THREE.Vector3(fb.x, t.y, fb.z), { loop: false }); } catch (e) { /* optional */ }
    if (t.chain) {
      for (let i = 0; i < 3; i++) pending.push({ at: ctx.time + 0.35 + i * 0.5, x: t.x + (i - 1) * 1.4, z: t.z + (i % 2) * 1.2, y: t.y + 0.6 });
    }
    ev.emit('targetDestroyed', { id: t.id, label: t.label, pos: new THREE.Vector3(t.x, t.y, t.z), left, by });
    ev.emit('raidProgress', { done: api.destroyed, total: targets.length });
    if (!left) ev.emit('raidComplete', {});
    return true;
  }
  ev.on('explosion', (x) => {
    if (!x || !x.pos || x.by !== 'player') return;
    for (const t of targets) {
      if (t.done || t.satchel) continue;
      if (Math.hypot(x.pos.x - t.x, x.pos.z - t.z) <= t.r && Math.abs(x.pos.y - t.y) < 6) destroy(t, x.weapon);
    }
  });
  ev.on('dumpDestroyed', () => destroy(targets.find((t) => t.id === 'dump'), 'satchel'));

  // ---------- resupply in the tunnels ----------
  let underFor = 0, lastSupply = -1e9;
  function resupply() {
    const w = ctx.weapons;
    if (!w) return false;
    let got = false;
    const F = w.kitFull || FULL;
    if (w.grenades < F.grenades) { w.grenades = F.grenades; got = true; }
    if (w.traps < F.traps) { w.traps = F.traps; got = true; }
    if (w.ammo && w.ammo.reserve < F.reserve) { w.ammo.reserve = F.reserve; got = true; }
    const dump = targets.find((t) => t.id === 'dump');
    if (dump && !dump.done && w.satchels < 1 && !w.satchelPlanted) { w.satchels = 1; got = true; }
    return got;
  }

  function update(dt) {
    const p = ctx.player, m = ctx.mission;
    if (!p?.position) return;
    // secondary explosions
    for (let i = pending.length - 1; i >= 0; i--) {
      if (ctx.time < pending[i].at) continue;
      const e = pending[i]; pending.splice(i, 1);
      ev.emit('explosion', { pos: new THREE.Vector3(e.x, e.y, e.z), radius: 12, damage: 200, by: 'player', weapon: 'cookoff' });
    }
    updateFires(dt);
    updateScope();

    // nearest standing target drives the compass marker and the checklist highlight
    const raiding = !!m && m.stage === 1 && m.shown === 1;
    let best = null, bd = Infinity;
    for (const t of targets) {
      if (t.done) continue;
      const d = Math.hypot(t.x - p.position.x, t.z - p.position.z);
      if (d < bd) { bd = d; best = t; }
    }
    api.nearest = best;
    if (m) m.marker = raiding && best ? best : null;
    box.classList.toggle('on', raiding && ctx.state === 'playing');
    for (const t of targets) rows.get(t.id)?.classList.toggle('near', raiding && t === best && bd < 60);

    // runners bring supplies through the tunnels
    underFor = p.underground && p.alive !== false ? underFor + dt : 0;
    if (underFor > RESUPPLY_HOLD && ctx.time - lastSupply > RESUPPLY_GAP) {
      if (resupply()) {
        lastSupply = ctx.time;
        try { ctx.hud?.toast?.('Resupplied', 2200); } catch (e) { /* optional */ }
        ev.emit('resupply', {});
      } else lastSupply = ctx.time - RESUPPLY_GAP + 3;
    }
  }

  return api;
}
