// UNDERGROWTH: first-person controller.
// Owns the camera transform. Handles stance, movement, collision, water, tunnels,
// health/stamina, stealth visibility, footstep noise, fall/explosion damage and death.

import * as THREE from 'three';
import { WORLD, clamp, lerp, smoothstep, noise2D, events as sharedEvents } from './util.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const EYE = { stand: 1.65, crouch: 1.0, prone: 0.4 };
const BODY_H = { stand: 1.8, crouch: 1.2, prone: 0.55 };
const HEAD_GAP = 0.16;             // eye kept this far under dug earth above
const UG_ENTER = 0.45;             // eye this far under the surface, with earth above: underground
const UG_LEAVE = 0.15;

const SPEED = {
  walk: 4.1, sprint: 6.8, crouch: 2.5, prone: 1.1,
  crawl: 2.2, tunnelProne: 1.1, chamber: 3.0, swim: 1.8,
};

const RADIUS = 0.35;
const DUG_RADIUS = 0.28;           // against dug earth walls
const STEP_UP = 0.45;              // box tops this far above feet can be stepped onto
const GRAVITY = 14.0;
const JUMP_V = 4.6;
const FALL_SAFE = 8.5;             // m/s impact before damage
const FALL_DMG = 14;               // hp per m/s over the safe speed
const MAX_GRADE = 1.15;            // terrain grade (rise/run) the player cannot walk up
const SWIM_DEPTH = 1.35;           // water depth at which the player floats
const SWIM_FEET_BELOW = 1.42;      // feet below water surface while swimming

const STAMINA = { sprintDrain: 9, swimDrain: 3, jumpCost: 10, regenIdle: 15, regenMove: 9, regenDelay: 0.9, recover: 30 };
const REGEN = { delay: 5, rate: 7 };

const FADE_OUT = 0.28;
const FADE_IN = 0.42;
const HATCH_RANGE = 1.5;
const DEATH_TIME = 1.3;

const LOOK_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

// Collision spatial hash
const HCELL = 8;
const HOFF = WORLD.half + 32;
const HDIM = Math.ceil((WORLD.size + 64) / HCELL);
const hCoord = (v) => clamp(Math.floor((v + HOFF) / HCELL), 0, HDIM - 1);

const WATCH_KEYS = ['KeyC', 'KeyZ', 'KeyV', 'KeyF'];
const KEYS = {
  fwd: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: 'KeyC', prone: 'KeyZ', jump: 'KeyV', use: 'KeyF',
};

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function parseDebugPos(p) {
  if (p == null) return null;
  let x, z;
  if (typeof p === 'string') {
    const a = p.split(',').map((s) => parseFloat(s));
    x = a[0]; z = a[1];
  } else if (Array.isArray(p)) {
    x = +p[0]; z = +p[1];
  } else if (typeof p === 'object') {
    x = +p.x; z = +(p.z ?? p.y);
  }
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'yes';

// ---------------------------------------------------------------------------

export function createPlayer(ctx) {
  const ev = ctx.events || sharedEvents;
  const camera = ctx.camera || new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1200);
  camera.rotation.order = 'YXZ';
  if (!camera.parent && ctx.scene) ctx.scene.add(camera); // viewmodels hang off the camera

  const object = new THREE.Object3D();
  object.name = 'player';
  object.rotation.order = 'YXZ';
  ctx.scene?.add(object);

  // ---- scratch (no per-frame allocation) ----
  const probe = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const fadePayload = { t: 0 };

  // ---- internal state ----
  let time = 0;
  let eyeCur = EYE.stand;           // smoothed eye height above feet
  let visFeetY = 0;                 // smoothed feet height for the camera
  let bobPhase = 0, bobAmp = 0, bobRollAmp = 0, bobStride = 0.8;
  let stepIndex = 0;
  let roll = 0;
  let landOff = 0, landVel = 0;
  let trauma = 0;
  let recoilP = 0, recoilY = 0;
  let hitPunchP = 0, hitPunchY = 0;
  let lastDrainTime = -10;
  let maxEyeHere = EYE.stand;
  let headroom = Infinity;          // dug earth above the feet (Infinity: open sky / no digging)
  let carvedHere = false;           // standing in or next to dug ground
  let ugTimer = 0;
  const mantle = { active: false, t: 0, dur: 0.55, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0 };
  let waterSurf = 0;
  let wasWet = false;
  let exposure = 0;                 // muzzle flash exposure, decays
  let alertLevel = 0;
  let deathT = 0, gameOverSent = false, deathRollDir = 1;
  let visCached = 1;
  let pendingUnderground = false;
  let lastStanceNoise = -10;
  let fadeShown = 0;
  let isAimingCached = false;
  let godMode = false;
  const dbg = ctx.debug;
  const isDebug = () => !!dbg && (dbg === true || truthy(dbg.debug) || truthy(dbg.enabled) ||
    (typeof window !== 'undefined' && window.__game === ctx));
  const prevDown = new Set();
  const trans = { active: false, phase: 'out', t: 0, kind: 'enter', hatch: null };

  const self = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eyeHeight: EYE.stand,
    stance: 'stand',
    health: 100,
    maxHealth: 100,
    stamina: 100,
    underground: false,
    alive: true,
    inWater: false,
    // additions
    object,
    radius: RADIUS,
    grounded: true,
    moving: false,
    sprinting: false,
    swimming: false,
    exhausted: false,
    speed: 0,
    waterDepth: 0,
    nearHatch: null,
    transitioning: false,
    suppression: 0,
    noise: 0,
    lastDamageTime: -1e9,
    inCombat: false,
    frozen: false,
    eyePosition: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    surface: 'grass',
    deathReason: null,
    update, damage, visibility, heal, respawnAt,
    addRecoil, shake, toggleHatch, setStance, getEyePosition, getForward, dispose,
  };

  // -------------------------------------------------------------------------
  // World queries
  // -------------------------------------------------------------------------

  function terrainH(x, z) {
    const w = ctx.world;
    if (w && w.heightAt) {
      const h = w.heightAt(x, z);
      if (Number.isFinite(h)) return h;
    }
    return 0;
  }

  // circle colliders hash
  let circSrc = null, circLen = -1, circBuckets = null;
  function syncCircles() {
    const src = ctx.world?.colliders;
    if (!Array.isArray(src)) { circSrc = null; circBuckets = null; circLen = -1; return; }
    if (src === circSrc && src.length === circLen) return;
    circSrc = src; circLen = src.length;
    circBuckets = new Array(HDIM * HDIM).fill(null);
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const r = Number.isFinite(c.r) ? c.r : 0.5;
      const x0 = hCoord(c.x - r), x1 = hCoord(c.x + r), z0 = hCoord(c.z - r), z1 = hCoord(c.z + r);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const k = iz * HDIM + ix;
        (circBuckets[k] || (circBuckets[k] = [])).push(i);
      }
    }
  }

  // AABB colliders hash
  let boxSrc = null, boxLen = -1, boxBuckets = null;
  function syncBoxes() {
    const src = ctx.world?.boxColliders;
    if (!Array.isArray(src)) { boxSrc = null; boxBuckets = null; boxLen = -1; return; }
    if (src === boxSrc && src.length === boxLen) return;
    boxSrc = src; boxLen = src.length;
    boxBuckets = new Array(HDIM * HDIM).fill(null);
    for (let i = 0; i < src.length; i++) {
      const b = src[i];
      if (!b || !b.min || !b.max) continue;
      const x0 = hCoord(b.min.x), x1 = hCoord(b.max.x), z0 = hCoord(b.min.z), z1 = hCoord(b.max.z);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const k = iz * HDIM + ix;
        (boxBuckets[k] || (boxBuckets[k] = [])).push(i);
      }
    }
  }

  // Dug ground near (x, z)?
  function carvedAt(x, z) {
    const t = ctx.tunnels;
    return !!(t && typeof t.carvedNear === 'function' && t.carvedNear(x, z));
  }

  // Terrain height (or the dug floor), or the top of a box the feet can stand on.
  function groundAt(x, z, feetY) {
    const t = ctx.tunnels;
    if (t && typeof t.groundAt === 'function' && carvedAt(x, z)) {
      const g = t.groundAt(x, feetY, z, STEP_UP);
      if (g !== null && Number.isFinite(g)) return g;
    }
    let h = terrainH(x, z);
    if (boxBuckets) {
      const bucket = boxBuckets[hCoord(z) * HDIM + hCoord(x)];
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const b = boxSrc[bucket[i]];
          if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
          const top = b.max.y;
          if (top > h && feetY >= top - STEP_UP) h = top;
        }
      }
    }
    return h;
  }

  function killVelocityInto(nx, nz) {
    const v = self.velocity;
    const vn = v.x * nx + v.z * nz;
    if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; }
  }

  // Circle-vs-circle and circle-vs-AABB push-out on the XZ plane.
  function resolveCollisions(R, bodyH) {
    const p = self.position;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      const x0 = hCoord(p.x - R), x1 = hCoord(p.x + R), z0 = hCoord(p.z - R), z1 = hCoord(p.z + R);

      if (circBuckets) {
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
          const bucket = circBuckets[iz * HDIM + ix];
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const c = circSrc[bucket[i]];
            if (c.top !== undefined && p.y >= c.top - STEP_UP) continue;
            const cr = Number.isFinite(c.r) ? c.r : 0.5;
            let dx = p.x - c.x, dz = p.z - c.z;
            const rr = R + cr;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-5) { dx = Math.cos(self.yaw); dz = -Math.sin(self.yaw); d = 1; }
            else { dx /= d; dz /= d; }
            const push = rr - (d2 < 1e-10 ? 0 : d);
            p.x += dx * push; p.z += dz * push;
            killVelocityInto(dx, dz);
            hit = true;
          }
        }
      }

      if (boxBuckets) {
        const headY = p.y + bodyH;
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
          const bucket = boxBuckets[iz * HDIM + ix];
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const b = boxSrc[bucket[i]];
            if (p.y >= b.max.y - STEP_UP || headY <= b.min.y) continue;
            const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
            let dx = p.x - cx, dz = p.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= R * R) continue;
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              dx /= d; dz /= d;
              const push = R - d;
              p.x += dx * push; p.z += dz * push;
              killVelocityInto(dx, dz);
            } else {
              // centre inside the box: leave along the shortest axis
              const l = p.x - b.min.x, r = b.max.x - p.x, n = p.z - b.min.z, f = b.max.z - p.z;
              const m = Math.min(l, r, n, f);
              if (m === l) { p.x = b.min.x - R; killVelocityInto(-1, 0); }
              else if (m === r) { p.x = b.max.x + R; killVelocityInto(1, 0); }
              else if (m === n) { p.z = b.min.z - R; killVelocityInto(0, -1); }
              else { p.z = b.max.z + R; killVelocityInto(0, 1); }
            }
            hit = true;
          }
        }
      }
      if (!hit) break;
    }
    const lim = WORLD.playable - 0.5;
    if (p.x < -lim) { p.x = -lim; killVelocityInto(1, 0); } else if (p.x > lim) { p.x = lim; killVelocityInto(-1, 0); }
    if (p.z < -lim) { p.z = -lim; killVelocityInto(0, 1); } else if (p.z > lim) { p.z = lim; killVelocityInto(0, -1); }
  }

  // Water depth at x,z given ground height. Writes waterSurf, returns depth (0 if dry).
  function sampleWater(x, z, ground) {
    const w = ctx.world;
    if (!w || typeof w.isWater !== 'function' || !w.isWater(x, z)) return 0;
    let surf = typeof w.waterLevelAt === 'function' ? w.waterLevelAt(x, z)
      : typeof w.waterHeightAt === 'function' ? w.waterHeightAt(x, z) : w.waterLevel;
    if (!Number.isFinite(surf) || surf - ground < 0.03) surf = ground + 0.18; // paddies, shallows
    waterSurf = surf;
    return surf - ground;
  }

  function surfaceType(x, z) {
    if (self.underground) return 'tunnel';
    if (carvedHere && self.position.y < terrainH(x, z) - 0.2) return 'dirt';
    if (self.waterDepth > 0.05) return 'water';
    const custom = ctx.world?.surfaceAt?.(x, z);
    if (typeof custom === 'string') return custom;
    const fb = WORLD.firebase;
    const dx = x - fb.x, dz = z - fb.z;
    if (dx * dx + dz * dz < (fb.radius + 6) * (fb.radius + 6)) return 'dirt';
    const cover = ctx.world?.coverAt?.(x, z) ?? 0;
    if (cover > 0.55) return 'leaves';
    if (cover < 0.12) return 'mud';
    return 'grass';
  }

  // -------------------------------------------------------------------------
  // Tunnels
  // -------------------------------------------------------------------------

  function tunnelFloor(x, z, y) {
    const t = ctx.tunnels;
    if (!t || typeof t.floorAt !== 'function') return null;
    const f = t.floorAt(x, z, y);
    return Number.isFinite(f) ? f : null;
  }

  // Dug earth above the feet, or Infinity.
  function headroomAt(x, feetY, z) {
    const t = ctx.tunnels;
    if (!t || typeof t.ceilingAbove !== 'function' || !carvedAt(x, z)) return Infinity;
    const c = t.ceilingAbove(x, feetY + 0.25, z);
    return Number.isFinite(c) && c < feetY + 40 ? c - feetY : Infinity;
  }

  // Stance and eye limits for the room above the feet.
  function fitStance() {
    if (headroom === Infinity) { maxEyeHere = EYE.stand; return; }
    maxEyeHere = clamp(headroom - HEAD_GAP, 0.3, EYE.stand);
    if (self.stance === 'stand' && headroom < BODY_H.stand) self.stance = headroom >= BODY_H.crouch - 0.05 ? 'crouch' : 'prone';
    else if (self.stance === 'crouch' && headroom < BODY_H.crouch - 0.05) self.stance = 'prone';
  }

  function findHatch(maxDist) {
    const t = ctx.tunnels;
    if (!t) return null;
    const p = self.position;
    let h = null;
    if (typeof t.nearestHatch === 'function') {
      probe.copy(p);
      h = t.nearestHatch(probe, maxDist) || null;
    }
    if (!h && Array.isArray(t.hatches)) {
      let best = maxDist * maxDist;
      for (let i = 0; i < t.hatches.length; i++) {
        const c = t.hatches[i];
        if (!c) continue;
        const dx = c.x - p.x, dz = c.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 <= best) { best = d2; h = c; }
      }
    }
    return h;
  }

  function setUndergroundState(b) {
    self.underground = b;
    try { ctx.world?.setUnderground?.(b); } catch (e) { console.error('[player] world.setUnderground', e); }
    try { ctx.audio?.setUnderground?.(b); } catch (e) { console.error('[player] audio.setUnderground', e); }
  }

  function placeInTunnelAtHatch(h) {
    const t = ctx.tunnels;
    let x = h.x, z = h.z, y = null;
    if (Number.isFinite(h.floorY)) {
      const g = t?.groundAt?.(x, h.floorY + 0.3, z, 0.2);
      self.position.set(x, Number.isFinite(g) ? g : h.floorY, z);
      return;
    }
    if (Number.isFinite(h.cx) && Number.isFinite(h.cz) && t?.cellCenter) {
      const c = t.cellCenter(h.cx, h.cz);
      if (c && Number.isFinite(c.x)) { x = c.x; z = c.z; if (Number.isFinite(c.y)) y = c.y; }
    }
    const f = tunnelFloor(x, z);
    if (f != null) y = f;
    if (y == null) y = terrainH(x, z) - WORLD.tunnelDepth;
    self.position.set(x, y, z);
  }

  function emitFade(a) {
    fadePayload.t = a;
    fadeShown = a;
    ev.emit('fade', fadePayload);
    try { ctx.hud?.fade?.(a); } catch (e) { /* hud optional */ }
  }

  // Enter or leave through the nearest hatch. Returns true if a transition started.
  function toggleHatch() {
    if (!self.alive || trans.active) return false;
    const h = findHatch(HATCH_RANGE);
    if (!h) return false;
    if (!self.underground && !self.grounded && !self.swimming) return false;
    trans.active = true; trans.phase = 'out'; trans.t = 0;
    trans.kind = self.underground ? 'exit' : 'enter';
    trans.hatch = h;
    self.transitioning = true;
    ev.emit('hatch', { pos: new THREE.Vector3(h.x, terrainH(h.x, h.z), h.z), entering: trans.kind === 'enter', hatch: h });
    emitNoise(0.22, 'hatch', 'wood', h.x, terrainH(h.x, h.z), h.z);
    return true;
  }

  function finishSwitch() {
    const h = trans.hatch;
    const p = self.position;
    self.velocity.set(0, 0, 0);
    if (trans.kind === 'enter') {
      placeInTunnelAtHatch(h);
      setUndergroundState(true);
      ugTimer = 0;
      if (self.stance === 'stand') self.stance = 'crouch';
      carvedHere = carvedAt(p.x, p.z);
      headroom = headroomAt(p.x, p.y, p.z);
      fitStance();
      eyeCur = Math.min(EYE[self.stance], maxEyeHere);
      self.grounded = true;
      ev.emit('enterTunnel', { hatch: h, pos: p.clone() });
    } else {
      const fx = -Math.sin(self.yaw), fz = -Math.cos(self.yaw);
      p.set(h.x + fx * 0.6, 0, h.z + fz * 0.6);
      setUndergroundState(false);
      ugTimer = 0;
      p.y = groundAt(p.x, p.z, terrainH(p.x, p.z) + 0.5);
      resolveCollisions(RADIUS, BODY_H.crouch);
      p.y = groundAt(p.x, p.z, p.y + 0.3);
      if (self.stance === 'stand') self.stance = 'crouch';
      eyeCur = EYE[self.stance];
      self.grounded = true;
      ev.emit('exitTunnel', { hatch: h, pos: p.clone() });
    }
    visFeetY = p.y;
    bobAmp = 0;
  }

  function updateTransition(dt) {
    if (!trans.active) return;
    if (trans.phase === 'out') {
      trans.t = Math.min(1, trans.t + dt / FADE_OUT);
      emitFade(trans.t);
      if (trans.t >= 1) {
        finishSwitch();
        trans.phase = 'in';
      }
    } else {
      trans.t = Math.max(0, trans.t - dt / FADE_IN);
      emitFade(trans.t);
      if (trans.t <= 0) {
        trans.active = false;
        trans.hatch = null;
        self.transitioning = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Events out
  // -------------------------------------------------------------------------

  function emitNoise(loudness, kind, surface, x, y, z) {
    const l = clamp(loudness * (self.underground && kind !== 'hatch' ? 0.25 : 1), 0, 1);
    if (l <= 0.005) return;
    const pos = new THREE.Vector3(x ?? self.position.x, (y ?? self.position.y) + 0.1, z ?? self.position.z);
    self.noise = Math.max(self.noise, l);
    ev.emit('noise', { pos, loudness: l, source: 'player', kind, surface, underground: self.underground });
  }

  function footstep(speed) {
    const surf = surfaceType(self.position.x, self.position.z);
    self.surface = surf;
    const st = self.stance;
    let loud;
    if (self.sprinting) loud = 0.7;
    else if (st === 'prone') loud = 0.06;
    else if (st === 'crouch') loud = 0.15;
    else loud = 0.35;
    loud *= 0.55 + 0.45 * clamp(speed / SPEED.walk, 0, 1.6);
    const cover = ctx.world?.coverAt?.(self.position.x, self.position.z) ?? 0;
    if (!self.underground && st !== 'prone') loud += cover * 0.12 * clamp(speed / SPEED.walk, 0, 1.5); // brushing foliage
    const wet = self.waterDepth > 0.05 && !self.underground;
    if (wet) loud = loud * 1.6 + 0.15;
    if (surf === 'leaves') loud *= 1.1;
    const kind = st === 'prone' || (self.underground && st !== 'stand') ? 'crawl' : 'footstep';
    const pos = new THREE.Vector3(self.position.x, self.position.y, self.position.z);
    ev.emit('footstep', {
      pos, surface: surf, loudness: clamp(loud, 0, 1), speed, stance: st,
      sprint: self.sprinting, underground: self.underground, water: self.waterDepth, kind,
    });
    if (wet) ev.emit('splash', { pos: pos.clone(), strength: clamp(0.25 + speed / 8 + self.waterDepth * 0.4, 0, 1), depth: self.waterDepth });
    emitNoise(loud, kind, surf);
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  function addRecoil(pitchKick = 0.01, yawKick = 0) {
    recoilP += pitchKick * 0.6;
    recoilY += yawKick * 0.6;
    self.pitch = clamp(self.pitch + pitchKick * 0.4, -PITCH_LIMIT, PITCH_LIMIT);
    self.yaw += yawKick * 0.4;
  }

  function shake(amount = 0.3) {
    trauma = clamp(trauma + amount, 0, 1);
  }

  function getEyePosition(target) {
    return (target || new THREE.Vector3()).copy(self.eyePosition);
  }

  function getForward(target) {
    return (target || new THREE.Vector3()).copy(self.forward);
  }

  function canStandHere() {
    return headroom >= BODY_H.stand;
  }

  function setStance(s) {
    if (!EYE[s] || !self.alive) return false;
    if (s === 'stand' && !canStandHere()) s = headroom >= BODY_H.crouch - 0.05 ? 'crouch' : 'prone';
    if (s === 'crouch' && headroom < BODY_H.crouch - 0.05) s = 'prone';
    if (s === 'prone' && self.waterDepth > 0.35 && !self.underground) s = 'crouch';
    if (self.swimming) s = 'stand';
    if (s === self.stance) return false;
    const prev = self.stance;
    self.stance = s;
    ev.emit('stance', { stance: s, prev });
    if (time - lastStanceNoise > 0.4) {
      lastStanceNoise = time;
      emitNoise(s === 'prone' ? 0.12 : 0.05, 'stance', self.surface);
    }
    return true;
  }

  function heal(n) {
    if (!self.alive) return;
    self.health = clamp(self.health + (Number(n) || 0), 0, self.maxHealth);
  }

  function damage(amount, fromPos, reason) {
    amount = Number(amount) || 0;
    if (!self.alive || amount <= 0 || self.frozen) return;
    if (godMode) return;
    self.health = Math.max(0, self.health - amount);
    self.lastDamageTime = time;
    shake(clamp(0.18 + amount / 70, 0, 0.8));
    const s = clamp(amount / 40, 0.15, 1);
    hitPunchP += (0.02 + Math.random() * 0.02) * s;
    hitPunchY += (Math.random() - 0.5) * 0.04 * s;
    ev.emit('playerHit', { damage: amount, fromPos: fromPos || null, health: self.health, reason: reason || 'gunfire' });
    if (self.health <= 0) die(reason);
  }

  function die(reason) {
    if (!self.alive) return;
    self.alive = false;
    self.sprinting = false;
    self.moving = false;
    deathT = 0;
    gameOverSent = false;
    deathRollDir = Math.random() < 0.5 ? -1 : 1;
    self.deathReason = reason === 'fall' ? 'Fell' : reason === 'explosion' ? 'Killed by explosion' : 'Killed in action';
    ev.emit('playerDied', { pos: self.position.clone(), reason: self.deathReason });
  }

  function respawnAt(x, z) {
    const p = self.position;
    if (self.underground) setUndergroundState(false);
    if (trans.active) { trans.active = false; trans.hatch = null; self.transitioning = false; emitFade(0); }
    p.set(x, 0, z);
    p.y = groundAt(x, z, terrainH(x, z) + 0.5);
    syncCircles(); syncBoxes();
    resolveCollisions(RADIUS, BODY_H.stand);
    p.y = groundAt(p.x, p.z, p.y + 0.3);
    self.velocity.set(0, 0, 0);
    self.health = self.maxHealth;
    self.stamina = 100;
    self.exhausted = false;
    self.alive = true;
    self.frozen = false;
    self.stance = 'stand';
    self.grounded = true;
    self.lastDamageTime = -1e9;
    deathT = 0; gameOverSent = false;
    eyeCur = EYE.stand;
    visFeetY = p.y;
    roll = 0; trauma = 0; recoilP = recoilY = hitPunchP = hitPunchY = 0;
    landOff = landVel = 0;
    applyCamera(0);
  }

  function visibility() {
    return visCached;
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  function onExplosion(e) {
    if (!e || !e.pos) return;
    const ep = e.pos;
    const R = Number.isFinite(e.radius) ? e.radius : 6;
    const dmg = Number.isFinite(e.damage) ? e.damage : 100;
    const p = self.position;
    const dx = p.x - ep.x, dy = p.y + 0.9 - ep.y, dz = p.z - ep.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const expUnder = ep.y < terrainH(ep.x, ep.z) - 1.2;
    const separated = expUnder !== self.underground; // a layer of earth in between
    const shakeR = R * 5;
    if (d < shakeR) shake((1 - d / shakeR) * (separated ? 0.45 : 1) * clamp(R / 6 + 0.35, 0.4, 1.2));
    if (!self.alive) return;
    if (d < R) {
      let f = 1 - d / R;
      f = Math.pow(f, 1.3);
      let amount = dmg * f;
      if (separated) amount *= 0.12;
      if (amount > 0.5) damage(amount, ep, 'explosion');
    }
    if (!separated && !self.underground && d < R * 1.5 && d > 0.01) {
      const k = (1 - d / (R * 1.5)) * 7;
      const hl = Math.hypot(dx, dz) || 1;
      self.velocity.x += (dx / hl) * k;
      self.velocity.z += (dz / hl) * k;
      if (self.grounded && k > 2) { self.velocity.y = k * 0.35; self.grounded = false; }
    }
  }

  function onShot(e) {
    if (!e) return;
    if (e.by === 'player') { exposure = 1; return; }
    if (e.by !== 'enemy' || !e.pos || !e.dir || self.underground) return;
    const dl = Math.hypot(e.dir.x, e.dir.y, e.dir.z) || 1;
    const ux = e.dir.x / dl, uy = e.dir.y / dl, uz = e.dir.z / dl;
    const eye = self.eyePosition;
    const wx = eye.x - e.pos.x, wy = eye.y - 0.4 - e.pos.y, wz = eye.z - e.pos.z;
    const t = wx * ux + wy * uy + wz * uz;
    if (t <= 0) return;
    const cx = wx - ux * t, cy = wy - uy * t, cz = wz - uz * t;
    const miss = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (miss < 2.5) {
      const s = 1 - miss / 2.5;
      self.suppression = clamp(self.suppression + s * 0.45, 0, 1);
      shake(s * 0.12);
    }
  }

  function onAlert(e) { if (e && Number.isFinite(e.level)) alertLevel = e.level; }
  function onGameOver(e) {
    if (e && e.won) self.frozen = true;
  }

  ev.on('explosion', onExplosion);
  ev.on('shot', onShot);
  ev.on('alert', onAlert);
  ev.on('gameOver', onGameOver);

  function dispose() {
    ev.off('explosion', onExplosion);
    ev.off('shot', onShot);
    ev.off('alert', onAlert);
    ev.off('gameOver', onGameOver);
    object.parent?.remove(object);
  }

  // -------------------------------------------------------------------------
  // Input helpers
  // -------------------------------------------------------------------------

  function down(codes, keys) {
    if (!keys) return false;
    if (typeof codes === 'string') return keys.has(codes);
    for (let i = 0; i < codes.length; i++) if (keys.has(codes[i])) return true;
    return false;
  }

  function justPressed(code, input) {
    if (input?.pressed?.has?.(code)) return true;
    return !!input?.keys?.has?.(code) && !prevDown.has(code);
  }

  function rememberKeys(keys) {
    prevDown.clear();
    if (!keys) return;
    for (let i = 0; i < WATCH_KEYS.length; i++) if (keys.has(WATCH_KEYS[i])) prevDown.add(WATCH_KEYS[i]);
  }

  function isAiming(input) {
    const w = ctx.weapons;
    if (w) {
      if (typeof w.aiming === 'boolean') return w.aiming;
      if (typeof w.ads === 'boolean') return w.ads;
      if (typeof w.isAiming === 'function') return !!w.isAiming();
    }
    return !!input?.mouse?.right;
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  let jumpQueued = false;

  function handleStanceInput(input) {
    if (justPressed(KEYS.crouch, input)) setStance(self.stance === 'crouch' ? 'stand' : 'crouch');
    if (justPressed(KEYS.prone, input)) setStance(self.stance === 'prone' ? (self.underground ? 'crouch' : 'stand') : 'prone');
    if (justPressed(KEYS.jump, input)) {
      if (self.stance === 'prone') setStance('crouch');
      else if (self.stance === 'crouch') setStance('stand');
      else if (carvedHere && tryMantle()) jumpQueued = false;
      else if (!self.underground) jumpQueued = true;
    }
    if (justPressed(KEYS.use, input)) toggleHatch();
  }

  // Climb out of a dug hole: a ledge of firm ground ahead, up to about chest-and-arms height.
  function tryMantle() {
    const t = ctx.tunnels;
    if (!t || typeof t.groundAt !== 'function' || mantle.active || !self.grounded) return false;
    const p = self.position;
    const fx = -Math.sin(self.yaw), fz = -Math.cos(self.yaw);
    for (const d of [0.5, 0.75, 1.0]) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const top = groundAt(x, z, p.y + 1.85);
      const rise = top - p.y;
      if (!(rise > STEP_UP && rise < 2.25)) continue;
      if (headroomAt(x, top, z) < BODY_H.crouch) continue;
      if (headroomAt(p.x, p.y, p.z) < rise + 0.9) continue;
      mantle.active = true; mantle.t = 0; mantle.dur = 0.35 + rise * 0.2;
      mantle.fx = p.x; mantle.fy = p.y; mantle.fz = p.z;
      mantle.tx = x; mantle.ty = top; mantle.tz = z;
      if (self.stance === 'prone') self.stance = 'crouch';
      self.velocity.set(0, 0, 0);
      emitNoise(0.15, 'climb', 'dirt');
      ev.emit('mantle', { rise });
      return true;
    }
    return false;
  }
  function updateMantle(dt) {
    const p = self.position;
    prevPos.copy(p);
    mantle.t = Math.min(1, mantle.t + dt / mantle.dur);
    const k = mantle.t;
    const up = smoothstep(0, 0.65, k), fw = smoothstep(0.35, 1, k);
    p.set(lerp(mantle.fx, mantle.tx, fw), lerp(mantle.fy, mantle.ty + 0.05, up), lerp(mantle.fz, mantle.tz, fw));
    if (k >= 1) {
      mantle.active = false;
      p.y = groundAt(p.x, p.z, p.y);
      self.grounded = true;
    }
    self.velocity.set(0, 0, 0);
    carvedHere = carvedAt(p.x, p.z);
    headroom = carvedHere ? headroomAt(p.x, p.y, p.z) : Infinity;
  }

  function moveSurface(dt, ix, iz, wantSprint, aiming, controlled) {
    const p = self.position, v = self.velocity;
    prevPos.copy(p);
    const yaw = self.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    let wx = fx * iz + rx * ix, wz = fz * iz + rz * ix;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const hasInput = wl > 0.01 && controlled;

    // dug ground: headroom decides the stance
    carvedHere = carvedAt(p.x, p.z);
    headroom = carvedHere ? headroomAt(p.x, p.y, p.z) : Infinity;
    fitStance();

    // water at current spot
    const g0 = terrainH(p.x, p.z);
    self.waterDepth = carvedHere && p.y < g0 - 0.3 ? 0 : sampleWater(p.x, p.z, g0);
    self.inWater = self.waterDepth > 0.05;
    self.swimming = self.waterDepth > SWIM_DEPTH;
    if (self.swimming && self.stance !== 'stand') self.stance = 'stand';
    if (self.stance === 'prone' && self.waterDepth > 0.35) self.stance = 'crouch';

    // sprint
    if (wantSprint && iz > 0 && hasInput && self.stance === 'crouch') setStance('stand');
    const canSprint = wantSprint && hasInput && iz > 0 && self.stance === 'stand' && !self.exhausted &&
      self.stamina > 0 && !aiming && !self.swimming && self.waterDepth < 0.6 && self.grounded && headroom > BODY_H.stand + 0.2;
    self.sprinting = canSprint;

    let speed;
    if (self.swimming) speed = SPEED.swim;
    else if (self.stance === 'prone') speed = SPEED.prone;
    else if (self.stance === 'crouch') speed = headroom < 1.6 ? SPEED.crawl : SPEED.crouch;
    else speed = canSprint ? SPEED.sprint : headroom < 2.4 ? SPEED.chamber : SPEED.walk;

    if (iz < 0) speed *= 0.72; else if (iz === 0 && ix !== 0) speed *= 0.88;
    if (aiming) speed *= 0.6;
    if (Math.abs(eyeCur - EYE[self.stance]) > 0.25) speed *= 0.55; // mid-transition
    if (!self.swimming) speed *= 1 - smoothstep(0.1, 1.1, self.waterDepth) * 0.55;
    speed *= 1 - self.suppression * 0.15;

    let tvx = hasInput ? wx * speed : 0;
    let tvz = hasInput ? wz * speed : 0;

    // slope: slow uphill, block cliffs (dug ground: walls do the blocking)
    const e = 0.6;
    const gx = carvedHere ? 0 : (terrainH(p.x + e, p.z) - terrainH(p.x - e, p.z)) / (2 * e);
    const gz = carvedHere ? 0 : (terrainH(p.x, p.z + e) - terrainH(p.x, p.z - e)) / (2 * e);
    const steep = Math.hypot(gx, gz);
    if (hasInput && !self.swimming) {
      const tl = Math.hypot(tvx, tvz) || 1;
      const uphill = (tvx * gx + tvz * gz) / tl;
      const sf = uphill > 0 ? clamp(1 - uphill * 0.8, 0.3, 1) : clamp(1 - uphill * 0.12, 1, 1.12);
      tvx *= sf; tvz *= sf;
      if (steep > MAX_GRADE) {
        const nx = gx / steep, nz = gz / steep;
        const c = tvx * nx + tvz * nz;
        if (c > 0) {
          const k = smoothstep(MAX_GRADE, MAX_GRADE + 0.35, steep);
          tvx -= nx * c * k; tvz -= nz * c * k;
        }
      }
    }
    if (steep > MAX_GRADE + 0.35 && self.grounded && !self.swimming) {
      // slide off very steep ground
      const s = (steep - MAX_GRADE - 0.35) * 3;
      tvx -= (gx / steep) * s; tvz -= (gz / steep) * s;
    }

    // acceleration
    let accel;
    if (!self.grounded && !self.swimming) accel = 1.5;
    else if (hasInput) accel = canSprint ? 9 : 12;
    else accel = 14;
    if (self.inWater) accel *= self.swimming ? 0.35 : 1 - smoothstep(0.2, 1.2, self.waterDepth) * 0.5;
    const a = damp(accel, dt);
    v.x += (tvx - v.x) * a;
    v.z += (tvz - v.z) * a;

    p.x += v.x * dt;
    p.z += v.z * dt;

    resolveCollisions(RADIUS, BODY_H[self.stance]);
    const t = ctx.tunnels;
    if (t && typeof t.collide === 'function' && (carvedHere || carvedAt(p.x, p.z))) {
      const bx = p.x, bz = p.z;
      if (t.collide(p, DUG_RADIUS, Math.min(BODY_H[self.stance], headroom - 0.02))) {
        const dx = p.x - bx, dz = p.z - bz, dl = Math.hypot(dx, dz);
        if (dl > 1e-5) killVelocityInto(dx / dl, dz / dl);
      }
      const lim = WORLD.playable - 0.5;
      p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
    }

    // vertical
    const hs = Math.hypot(v.x, v.z);
    let ground = groundAt(p.x, p.z, p.y);
    const tH = terrainH(p.x, p.z);
    const depthHere = carvedHere && ground < tH - 0.3 ? 0 : sampleWater(p.x, p.z, tH);
    const swimHere = depthHere > SWIM_DEPTH;

    if (swimHere) {
      const floatY = Math.max(ground, waterSurf - SWIM_FEET_BELOW);
      p.y += (floatY - p.y) * damp(self.grounded ? 8 : 4, dt);
      if (Math.abs(floatY - p.y) < 0.05) p.y = floatY;
      if (!self.grounded && v.y < -3) land(-v.y, true);
      v.y = 0;
      self.grounded = true;
      jumpQueued = false;
    } else if (self.grounded) {
      if (jumpQueued && self.stamina >= 4 && depthHere < 0.8 && headroom > BODY_H.stand + 0.5) {
        v.y = JUMP_V * (depthHere > 0.3 ? 0.7 : 1);
        self.grounded = false;
        self.stamina = Math.max(0, self.stamina - STAMINA.jumpCost);
        lastDrainTime = time;
        emitNoise(0.18 + (depthHere > 0.05 ? 0.2 : 0), 'jump', self.surface);
        ev.emit('jump', { pos: p.clone() });
      } else {
        const snap = Math.max(0.25, hs * dt * 1.6 + 0.05);
        if (ground >= p.y - snap) { p.y = ground; v.y = 0; }
        else { self.grounded = false; v.y = Math.min(v.y, 0); }
      }
    }
    jumpQueued = false;
    if (!self.grounded) {
      v.y -= GRAVITY * dt;
      p.y += v.y * dt;
      ground = groundAt(p.x, p.z, p.y - v.y * dt);
      if (carvedHere && v.y > 0) {
        const hr = headroomAt(p.x, p.y, p.z);
        if (hr < BODY_H[self.stance]) v.y = 0;
      }
      if (p.y <= ground) {
        const impact = -v.y;
        p.y = ground;
        v.y = 0;
        self.grounded = true;
        land(impact, depthHere > 0.6);
      }
    }

    // water state after move
    self.waterDepth = depthHere;
    self.inWater = depthHere > 0.05;
    self.swimming = swimHere;
    if (self.inWater && !wasWet && hs > 1.5) {
      ev.emit('splash', { pos: p.clone(), strength: clamp(hs / 5, 0.3, 1), depth: depthHere });
      emitNoise(clamp(0.3 + hs / 10, 0, 0.8), 'splash', 'water');
    }
    wasWet = self.inWater;
  }

  function land(impact, cushioned) {
    if (impact > 2.5) {
      landVel -= Math.min(impact * 0.32, 2.6);
      emitNoise(clamp(impact / 11, 0.1, 0.8), 'land', self.surface);
      ev.emit('land', { pos: self.position.clone(), impact, surface: surfaceType(self.position.x, self.position.z) });
    }
    if (!cushioned && impact > FALL_SAFE) {
      shake(clamp((impact - FALL_SAFE) / 6, 0.2, 0.8));
      damage((impact - FALL_SAFE) * FALL_DMG, null, 'fall');
    }
  }

  // Underground: the eye is under the surface with dug earth above it (hysteresis + a
  // short hold so a tunnel mouth does not flicker the lighting).
  function updateUnderground(dt) {
    const t = ctx.tunnels;
    if (trans.active || !self.alive || !t || typeof t.coveredAt !== 'function') return;
    const p = self.position;
    const eyeY = p.y + eyeCur;
    const surf = typeof t.meshHeight === 'function' ? t.meshHeight(p.x, p.z) : terrainH(p.x, p.z);
    const depth = surf - eyeY;
    if (!self.underground) {
      const want = carvedHere && depth > UG_ENTER && t.coveredAt(p.x, eyeY, p.z);
      ugTimer = want ? ugTimer + dt : 0;
      if (ugTimer > 0.12) {
        ugTimer = 0;
        setUndergroundState(true);
        ev.emit('undergroundChange', { underground: true, walk: true, pos: p });
      }
    } else {
      const leave = !carvedHere || depth < UG_LEAVE || !t.coveredAt(p.x, eyeY, p.z);
      ugTimer = leave ? ugTimer + dt : 0;
      if (ugTimer > 0.12) {
        ugTimer = 0;
        setUndergroundState(false);
        ev.emit('undergroundChange', { underground: false, walk: true, pos: p });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Camera / feel
  // -------------------------------------------------------------------------

  function updateBob(dt, dist, hs) {
    const st = self.stance;
    let amp, stride, rollA;
    if (self.underground) {
      if (st === 'prone') { amp = 0.018; stride = 0.42; rollA = 0.03; }
      else if (st === 'stand') { amp = 0.032; stride = 0.7; rollA = 0.006; }
      else if (headroom >= 1.6) { amp = 0.026; stride = 0.6; rollA = 0.01; }
      else { amp = 0.03; stride = 0.52; rollA = 0.028; }
    } else if (self.swimming) { amp = 0.05; stride = 1.4; rollA = 0.012; }
    else if (st === 'prone') { amp = 0.02; stride = 0.48; rollA = 0.028; }
    else if (st === 'crouch') { amp = 0.026; stride = 0.62; rollA = 0.008; }
    else if (self.sprinting) { amp = 0.068; stride = 1.12; rollA = 0.012; }
    else { amp = 0.04; stride = 0.8; rollA = 0.006; }
    if (self.inWater && !self.swimming) { amp *= 1.25; stride *= 0.85; }

    const moving = hs > 0.25 && self.grounded;
    const k = clamp(hs / Math.max(0.5, SPEED.walk * 0.6), 0, 1.2);
    bobAmp += ((moving ? amp * k : 0) - bobAmp) * damp(8, dt);
    bobRollAmp += ((moving ? rollA * k : 0) - bobRollAmp) * damp(6, dt);
    bobStride += (stride - bobStride) * damp(4, dt);

    if (self.grounded) {
      bobPhase += (dist / bobStride) * Math.PI;
      const idx = Math.floor(bobPhase / Math.PI);
      if (idx !== stepIndex) {
        stepIndex = idx;
        if (moving) footstep(hs);
      }
    }
  }

  function applyCamera(dt) {
    const p = self.position;
    const yaw = self.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    // bob offsets
    const c = Math.cos(bobPhase);
    const bobY = -bobAmp * (0.5 + 0.5 * Math.cos(2 * bobPhase));
    const bobX = bobAmp * 0.55 * c;
    const bobRoll = bobRollAmp * c;

    // breathing / idle sway
    const fatigue = 1 - self.stamina / 100;
    const swayK = (isAimingCached ? 0.35 : 1) * (1 + fatigue * 2.5 + self.suppression * 2);
    const swayP = (Math.sin(time * 1.35) * 0.0022 + Math.sin(time * 0.53 + 1.7) * 0.001) * swayK;
    const swayY = (Math.sin(time * 0.71 + 0.4) * 0.0016) * swayK;

    // shake
    const s2 = trauma * trauma;
    const shP = s2 * 0.05 * noise2D(time * 22, 3.1);
    const shY = s2 * 0.05 * noise2D(time * 22, 17.7);
    const shR = s2 * 0.04 * noise2D(time * 18, 41.3);
    const shPos = s2 * 0.06;

    // death
    let deathDrop = 0, deathRoll = 0;
    if (!self.alive) {
      const e = smoothstep(0, DEATH_TIME * 0.8, deathT);
      deathDrop = e;
      deathRoll = e * 1.2 * deathRollDir;
    }

    const eyeH = lerp(eyeCur, 0.22, deathDrop);
    let ey = visFeetY + eyeH + bobY + landOff;

    // transition dip: sink into / rise out of the shaft
    if (trans.active) {
      const t = trans.t;
      ey += trans.kind === 'enter' ? (trans.phase === 'out' ? -0.55 * t : 0.25 * t) : (trans.phase === 'out' ? 0.3 * t : -0.25 * t);
    }

    // keep the eye out of the ground / under the ceiling / above water
    if (carvedHere) {
      if (headroom !== Infinity) ey = Math.min(ey, p.y + headroom - 0.08);
      ey = Math.max(ey, p.y + 0.2);
    } else if (self.underground) {
      ey = Math.max(ey, p.y + 0.2);
    } else {
      const g = terrainH(p.x, p.z);
      ey = Math.max(ey, g + 0.15);
      if (self.swimming) ey = Math.max(ey, waterSurf + 0.12);
    }

    self.eyeHeight = eyeH;
    self.eyePosition.set(p.x + rx * bobX, ey, p.z + rz * bobX);

    const pitch = self.pitch;
    const viewPitch = deathDrop > 0 ? lerp(pitch, 0.12, deathDrop) : pitch;
    camera.position.copy(self.eyePosition);
    if (shPos > 0.0005) {
      camera.position.x += shPos * noise2D(time * 25, 7.3);
      camera.position.y += shPos * noise2D(time * 25, 11.9);
    }
    camera.rotation.set(
      clamp(viewPitch + recoilP + hitPunchP + swayP + shP, -PITCH_LIMIT, PITCH_LIMIT),
      yaw + recoilY + hitPunchY + swayY + shY,
      roll + bobRoll + shR + deathRoll,
    );

    object.position.copy(self.eyePosition);
    object.rotation.set(pitch, yaw, 0);
    object.updateMatrixWorld();

    const cp = Math.cos(pitch);
    self.forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  function computeVisibility(hs) {
    if (!self.alive || self.underground) { visCached = 0; return; }
    const p = self.position;
    // stance from the actual eye height so transitions blend
    const h = clamp((eyeCur - EYE.prone) / (EYE.stand - EYE.prone), 0, 1);
    const base = 0.28 + 0.72 * h;
    const moveF = hs < 0.2 ? 0.72 : 0.78 + 0.22 * clamp(hs / SPEED.walk, 0, 1) + (self.sprinting ? 0.25 : 0);
    const cover = clamp(ctx.world?.coverAt?.(p.x, p.z) ?? 0, 0, 1);
    let conceal = cover * (0.45 + 0.47 * (1 - h));
    conceal *= 1 - 0.35 * clamp(hs / SPEED.sprint, 0, 1);
    const submerge = self.inWater ? clamp(self.waterDepth / Math.max(0.3, eyeCur + 0.1), 0, 0.85) : 0;
    let vis = base * moveF * (1 - conceal) * (1 - submerge * 0.55);
    vis += (1 - vis) * exposure * 0.8;
    if (trans.active) vis *= trans.kind === 'enter' ? 1 - trans.t * (trans.phase === 'out' ? 0.7 : 1) : 1;
    visCached = clamp(vis, 0, 1);
  }

  // -------------------------------------------------------------------------
  // Debug spawn
  // -------------------------------------------------------------------------

  function spawnUndergroundNear(x, z) {
    const t = ctx.tunnels;
    if (t && typeof t.spawnPoint === 'function') {
      const sp = t.spawnPoint(x, z);
      if (!sp) return false;
      self.position.copy(sp);
      self.velocity.set(0, 0, 0);
      setUndergroundState(true);
      self.stance = 'crouch';
      carvedHere = carvedAt(sp.x, sp.z);
      headroom = headroomAt(sp.x, sp.y, sp.z);
      fitStance();
      eyeCur = Math.min(EYE[self.stance], maxEyeHere);
      visFeetY = self.position.y;
      prevPos.copy(self.position);
      ev.emit('enterTunnel', { hatch: null, pos: self.position.clone(), debug: true });
      return true;
    }
    if (!t || typeof t.dugCells !== 'function' || typeof t.cellCenter !== 'function') return false;
    let best = Infinity, bx = 0, by = 0, bz = 0, found = false;
    for (const cell of t.dugCells()) {
      if (!cell) continue;
      const c = t.cellCenter(cell.cx, cell.cz);
      if (!c) continue;
      const dx = c.x - x, dz = c.z - z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bx = c.x; by = c.y; bz = c.z; found = true; }
    }
    if (!found) return false;
    const f = tunnelFloor(bx, bz);
    self.position.set(bx, f ?? by, bz);
    self.velocity.set(0, 0, 0);
    setUndergroundState(true);
    self.stance = 'crouch';
    headroom = headroomAt(bx, self.position.y, bz);
    fitStance();
    eyeCur = Math.min(EYE.crouch, maxEyeHere);
    visFeetY = self.position.y;
    ev.emit('enterTunnel', { hatch: null, pos: self.position.clone(), debug: true });
    return true;
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    time += dt;
    const input = ctx.input;
    const keys = input?.keys;

    syncCircles();
    syncBoxes();

    if (pendingUnderground) {
      pendingUnderground = false;
      const d = ctx.debug;
      const pos = parseDebugPos(d?.pos) || { x: self.position.x, z: self.position.z };
      spawnUndergroundNear(pos.x, pos.z);
    }

    const controlled = self.alive && !self.frozen && !trans.active;

    // look
    if (controlled && input?.mouse && (input.locked || isDebug())) {
      const aimK = isAimingCached ? 0.55 : 1;
      const sens = LOOK_SENS * aimK * (Number(ctx.settings?.sensitivity) || 1);
      self.yaw -= (input.mouse.dx || 0) * sens;
      self.pitch -= (input.mouse.dy || 0) * sens;
    }
    if (self.yaw > Math.PI * 4 || self.yaw < -Math.PI * 4) self.yaw %= Math.PI * 2;
    const minP = self.stance === 'prone' && !self.underground ? -0.75 : -PITCH_LIMIT;
    if (self.pitch < minP) self.pitch += (minP - self.pitch) * damp(10, dt);
    self.pitch = clamp(self.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    isAimingCached = controlled && isAiming(input);
    if (controlled) handleStanceInput(input);
    else jumpQueued = false;

    // movement axes
    let ix = 0, iz = 0;
    if (controlled && keys) {
      if (down(KEYS.fwd, keys)) iz += 1;
      if (down(KEYS.back, keys)) iz -= 1;
      if (down(KEYS.right, keys)) ix += 1;
      if (down(KEYS.left, keys)) ix -= 1;
    }
    const wantSprint = controlled && down(KEYS.sprint, keys);

    updateTransition(dt);

    if (self.alive) {
      if (mantle.active) updateMantle(dt);
      else moveSurface(dt, ix, iz, wantSprint && !self.underground, isAimingCached, controlled && !trans.active);
    } else {
      // dead: slump, keep gravity on the surface
      const v = self.velocity;
      v.x *= 1 - damp(6, dt); v.z *= 1 - damp(6, dt);
      const p = self.position;
      p.x += v.x * dt; p.z += v.z * dt;
      if (!self.underground) {
        const g = groundAt(p.x, p.z, p.y);
        if (p.y > g + 0.01) { v.y -= GRAVITY * dt; p.y = Math.max(g, p.y + v.y * dt); } else { p.y = g; v.y = 0; }
      }
      deathT += dt;
      if (deathT >= DEATH_TIME && !gameOverSent) {
        gameOverSent = true;
        ev.emit('gameOver', { won: false, reason: self.deathReason || 'Killed in action' });
      }
    }

    const p = self.position, v = self.velocity;
    const dxm = p.x - prevPos.x, dzm = p.z - prevPos.z;
    let dist = Math.sqrt(dxm * dxm + dzm * dzm);
    if (dist > 2) dist = 0; // teleport
    const hs = Math.hypot(v.x, v.z);
    self.speed = hs;
    self.moving = hs > 0.25;

    // eye height
    let targetEye = Math.min(EYE[self.stance], maxEyeHere);
    const rate = targetEye < eyeCur ? (self.stance === 'prone' ? 6 : 10) : (eyeCur < EYE.crouch - 0.1 ? 4.5 : 8);
    eyeCur += (targetEye - eyeCur) * damp(eyeCur > maxEyeHere ? 20 : rate, dt);
    if (self.alive) updateUnderground(dt);

    // smoothed feet height for the camera
    const fy = p.y;
    if (Math.abs(fy - visFeetY) > 0.9 || !self.grounded) visFeetY = fy;
    else visFeetY += (fy - visFeetY) * damp(self.underground ? 14 : 24, dt);

    // landing spring
    landVel += (-110 * landOff - 15 * landVel) * dt;
    landOff += landVel * dt;
    if (landOff < -0.3) { landOff = -0.3; landVel = Math.max(0, landVel); }

    // strafe roll
    const rx = Math.cos(self.yaw), rz = -Math.sin(self.yaw);
    const lateral = v.x * rx + v.z * rz;
    const rollTarget = self.alive ? -lateral * (self.underground ? 0.004 : 0.0065) : 0;
    roll += (rollTarget - roll) * damp(6, dt);

    if (self.alive) updateBob(dt, dist, hs);
    else { bobAmp *= 1 - damp(6, dt); bobRollAmp *= 1 - damp(6, dt); }

    // recoil/hit recovery, shake decay
    recoilP *= 1 - damp(9, dt);
    recoilY *= 1 - damp(9, dt);
    hitPunchP *= 1 - damp(7, dt);
    hitPunchY *= 1 - damp(7, dt);
    trauma = Math.max(0, trauma - dt * 1.3);
    self.suppression = Math.max(0, self.suppression - dt * 0.35);
    exposure = Math.max(0, exposure - dt * 0.8);
    self.noise = Math.max(0, self.noise - dt * 0.9);

    // stamina
    if (self.alive) {
      if (self.sprinting && hs > 1) {
        self.stamina = Math.max(0, self.stamina - STAMINA.sprintDrain * dt);
        lastDrainTime = time;
      } else if (self.swimming && hs > 0.3) {
        self.stamina = Math.max(0, self.stamina - STAMINA.swimDrain * dt);
        lastDrainTime = time;
      } else if (time - lastDrainTime > STAMINA.regenDelay) {
        const r = hs > 0.3 ? STAMINA.regenMove : STAMINA.regenIdle;
        self.stamina = Math.min(100, self.stamina + r * (self.stance === 'stand' ? 1 : 1.15) * dt);
      }
      if (self.stamina <= 0.01) self.exhausted = true;
      else if (self.exhausted && self.stamina >= STAMINA.recover) self.exhausted = false;
    }

    // health regen out of combat
    const level = Number.isFinite(ctx.enemies?.alertLevel) ? ctx.enemies.alertLevel : alertLevel;
    self.inCombat = level >= 2 || time - self.lastDamageTime < REGEN.delay;
    if (self.alive && !self.inCombat && self.health < self.maxHealth) {
      const ramp = clamp((time - self.lastDamageTime - REGEN.delay) / 4, 0, 1);
      self.health = Math.min(self.maxHealth, self.health + REGEN.rate * ramp * dt);
    }

    // context
    self.nearHatch = self.alive && !trans.active ? findHatch(HATCH_RANGE) : null;

    computeVisibility(hs);
    applyCamera(dt);
    rememberKeys(keys);
  }

  // -------------------------------------------------------------------------
  // Initial placement
  // -------------------------------------------------------------------------

  {
    const d = ctx.debug;
    const dp = d ? parseDebugPos(d.pos) : null;
    const sx = dp ? dp.x : WORLD.playerStart.x;
    const sz = dp ? dp.z : WORLD.playerStart.z;
    syncCircles();
    syncBoxes();
    self.position.set(sx, 0, sz);
    self.position.y = groundAt(sx, sz, terrainH(sx, sz) + 0.5);
    resolveCollisions(RADIUS, BODY_H.stand);
    self.position.y = groundAt(self.position.x, self.position.z, self.position.y + 0.3);
    prevPos.copy(self.position);
    visFeetY = self.position.y;

    // face the firebase from wherever we start
    const fb = WORLD.firebase;
    self.yaw = Math.atan2(-(fb.x - sx), -(fb.z - sz));
    if (d && Number.isFinite(parseFloat(d.yaw))) self.yaw = parseFloat(d.yaw);
    self.pitch = 0;
    if (d && truthy(d.underground)) pendingUnderground = true;
    godMode = !!(d && truthy(d.god));

    applyCamera(0);
  }

  return self;
}

export default createPlayer;
