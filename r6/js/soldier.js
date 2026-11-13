// Procedural animated third-person soldier models (three.js primitives only).
// Model origin at the feet (y = 0), facing -Z, ~1.8 m tall.
import * as THREE from 'three';

const UP_LEG = 0.44, LO_LEG = 0.42, FOOT_H = 0.08, HIP_H = UP_LEG + LO_LEG + FOOT_H;
const ARM1 = 0.30, ARM2 = 0.30;
const CROUCH_THIGH = 1.33, CROUCH_KNEE = 2.08, CROUCH_BEND = 0.25;
const DOWN = new THREE.Vector3(0, -1, 0);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- caches
const CTORS = {
  box: THREE.BoxGeometry, cyl: THREE.CylinderGeometry, cap: THREE.CapsuleGeometry,
  sph: THREE.SphereGeometry, circ: THREE.CircleGeometry,
};
const geoCache = new Map();
function g(type, ...a) {
  const key = type + ':' + a.join(',');
  let geo = geoCache.get(key);
  if (!geo) { geo = new CTORS[type](...a); geoCache.set(key, geo); }
  return geo;
}
function starShape(ro, ri) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro, a = Math.PI / 2 + i * Math.PI / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}
function starGeo() {
  let geo = geoCache.get('star');
  if (!geo) { geo = new THREE.ShapeGeometry(starShape(0.026, 0.011)); geoCache.set('star', geo); }
  return geo;
}

const matCache = {};
function std(color, roughness, metalness = 0, extra) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function getMats(faction) {
  if (matCache[faction]) return matCache[faction];
  const com = faction === 'communist';
  const tex = new THREE.CanvasTexture(makeEmblemCanvas(faction, 128));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const M = {
    uniform: std(com ? 0x6a6a44 : 0x2b2d31, 0.92),
    vest: std(com ? 0x97835c : 0x131416, 0.85),
    gear: std(com ? 0x77684a : 0x1d1e21, 0.88),
    helmet: std(com ? 0x41592f : 0x41454b, com ? 0.7 : 0.5, com ? 0.1 : 0.45, { side: THREE.DoubleSide }),
    boot: std(com ? 0x1c1611 : 0x0e0e0f, 0.7),
    glove: std(com ? 0x3b3325 : 0x161617, 0.8),
    skin: std(com ? 0xc79673 : 0xb98a6c, 0.75),
    fabric: std(0x18191b, 0.95),
    metal: std(0x1b1d20, 0.42, 0.65),
    furn: std(com ? 0x6b4222 : 0x1a1b1d, com ? 0.6 : 0.7),
    red: std(0xa3141b, 0.8, 0, { side: THREE.DoubleSide }),
    glass: std(0x0b0f12, 0.18, 0.3),
    eye: std(0x120f0d, 0.5),
    emblem: std(0xffffff, 0.8, 0, { map: tex, transparent: true, alphaTest: 0.4 }),
  };
  matCache[faction] = M;
  return M;
}

// ---------------------------------------------------------------- emblem
export function makeEmblemCanvas(faction, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const s = size, h = s / 2;
  x.clearRect(0, 0, s, s);
  if (faction === 'communist') {
    x.fillStyle = '#b3141c';
    x.beginPath(); x.arc(h, h, s * 0.47, 0, TAU); x.fill();
    x.fillStyle = '#f0c12e';
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = s * (i % 2 ? 0.145 : 0.36), a = -Math.PI / 2 + i * Math.PI / 5;
      const px = h + Math.cos(a) * r, py = h * 1.03 + Math.sin(a) * r;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  } else {
    // original invented emblem: white disc, three black vertical bars of stepped height
    x.fillStyle = '#0c0c0d';
    x.beginPath(); x.arc(h, h, s * 0.47, 0, TAU); x.fill();
    x.fillStyle = '#f1f1ee';
    x.beginPath(); x.arc(h, h, s * 0.42, 0, TAU); x.fill();
    x.fillStyle = '#0c0c0d';
    const bw = s * 0.115, base = s * 0.73;
    [[0.33, 0.26], [0.5, 0.40], [0.67, 0.54]].forEach(([cx, bh]) => {
      x.fillRect(s * cx - bw / 2, base - s * bh, bw, s * bh);
    });
  }
  return c;
}

// ---------------------------------------------------------------- IK scratch
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
function solveArm(arm, S, T, pole) {
  _d.subVectors(T, S);
  const d = Math.min(_d.length(), (ARM1 + ARM2) * 0.995);
  _d.normalize();
  const a = (ARM1 * ARM1 - ARM2 * ARM2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ARM1 * ARM1 - a * a));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(S).addScaledVector(_d, a).addScaledVector(_p, h);
  arm.upper.position.copy(S);
  arm.upper.quaternion.setFromUnitVectors(DOWN, _t.subVectors(_e, S).normalize());
  arm.lower.position.copy(_e);
  _t.copy(S).addScaledVector(_d, d).sub(_e).normalize();
  arm.lower.quaternion.setFromUnitVectors(DOWN, _t);
}

// ---------------------------------------------------------------- soldier
export function createSoldier(faction) {
  const com = faction === 'communist';
  const M = getMats(com ? 'communist' : 'fascist');
  const meshes = [];
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    m.userData.baseMat = mat;
    parent.add(m);
    meshes.push(m);
    return m;
  };
  const grp = (parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const group = new THREE.Group();
  const root = grp(group);
  const hips = grp(root, 0, HIP_H, 0);

  // pelvis + belt
  add(hips, g('box', 0.33, 0.18, 0.21), M.uniform, 0, 0.02, 0);
  add(hips, g('box', 0.35, 0.05, 0.23), M.gear, 0, 0.1, 0);
  add(hips, g('box', 0.06, 0.14, 0.11), M.gear, 0.195, -0.03, 0.01);   // holster / dump pouch
  add(hips, g('box', 0.05, 0.1, 0.09), M.gear, -0.195, 0.0, 0.03);

  // legs: [left(-X), right(+X)]
  const legs = [-1, 1].map((side) => {
    const thigh = grp(hips, side * 0.095, 0, 0);
    add(thigh, g('cap', 0.08, 0.29, 4, 10), M.uniform, 0, -0.21, 0);
    const knee = grp(thigh, 0, -UP_LEG, 0);
    add(knee, g('cap', 0.062, 0.27, 4, 10), M.uniform, 0, -0.2, 0);
    add(knee, g('box', 0.11, 0.12, 0.05), M.gear, 0, -0.01, -0.058);     // knee pad
    const foot = grp(knee, 0, -LO_LEG, 0);
    add(foot, g('box', 0.105, 0.17, 0.13), M.boot, 0, 0.005, 0.005);     // boot shaft
    add(foot, g('box', 0.11, 0.08, 0.28), M.boot, 0, -0.04, -0.055);     // boot foot / sole
    return { thigh, knee, foot };
  });

  // spine (leans / pitches), chest is bladed slightly so the support arm reaches the handguard
  const spine = grp(hips, 0, 0.06, 0);
  const chest = grp(spine);
  const CHEST_YAW = -0.26;
  chest.rotation.y = CHEST_YAW;
  add(chest, g('cap', 0.115, 0.25, 4, 12), M.uniform, 0, 0.2, 0).scale.set(1.5, 1, 1);
  add(chest, g('box', 0.36, 0.33, 0.275), M.vest, 0, 0.235, 0);                 // plate carrier
  add(chest, g('box', 0.07, 0.05, 0.25), M.vest, -0.11, 0.41, 0);               // shoulder straps
  add(chest, g('box', 0.07, 0.05, 0.25), M.vest, 0.11, 0.41, 0);
  for (let i = -1; i <= 1; i++) add(chest, g('box', 0.078, 0.13, 0.05), M.gear, i * 0.092, 0.14, -0.155);
  add(chest, g('box', 0.1, 0.07, 0.04), M.gear, -0.09, 0.32, -0.15);            // admin pouch
  add(chest, g('box', 0.05, 0.11, 0.04), M.metal, 0.11, 0.33, -0.15);           // radio handset
  add(chest, g('box', com ? 0.3 : 0.26, com ? 0.34 : 0.28, 0.13), M.gear, 0, 0.25, 0.195);  // backpack
  add(chest, g('box', 0.2, 0.1, 0.06), M.gear, 0, 0.13, 0.27);
  if (com) add(chest, g('cyl', 0.035, 0.035, 0.3, 10), M.uniform, 0, 0.445, 0.2, 0, 0, Math.PI / 2); // bedroll
  else add(chest, g('cyl', 0.004, 0.004, 0.34, 5), M.metal, 0.1, 0.55, 0.22);   // radio antenna
  const SH = [-1, 1].map((s) => new THREE.Vector3(s * 0.205, 0.4, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), CHEST_YAW));
  SH.forEach((p) => add(spine, g('sph', 0.075, 12, 10), M.uniform, p.x, p.y, p.z));

  // neck + head
  add(spine, g('cyl', 0.05, 0.058, 0.1, 10), com ? M.skin : M.fabric, 0, 0.47, 0);
  const head = grp(spine, 0, 0.5, 0);
  head.name = 'head';
  add(head, g('sph', 0.1, 16, 12), M.skin, 0, 0.12, 0).scale.set(0.9, 1.12, 1);
  add(head, g('box', 0.024, 0.012, 0.012), M.eye, -0.035, 0.137, -0.089);
  add(head, g('box', 0.024, 0.012, 0.012), M.eye, 0.035, 0.137, -0.089);
  if (com) {
    add(head, g('box', 0.022, 0.04, 0.026), M.skin, 0, 0.11, -0.098);                       // nose
    add(spine, g('cyl', 0.06, 0.072, 0.05, 10), M.uniform, 0, 0.435, 0);                    // collar
  } else {
    add(head, g('sph', 0.104, 16, 8, 0, TAU, Math.PI * 0.5, Math.PI * 0.5), M.fabric, 0, 0.122, 0).scale.set(0.92, 1.12, 1.02); // balaclava
    add(head, g('box', 0.15, 0.048, 0.03), M.glass, 0, 0.215, -0.118, 0.35);                // goggles on helmet
  }
  add(head, g('sph', 0.122, 16, 8, 0, TAU, 0, Math.PI * 0.5), M.helmet, 0, 0.16, 0).scale.set(1, 1, 1.1);
  if (com) {
    add(head, g('cyl', 0.125, 0.127, 0.022, 16), M.helmet, 0, 0.165, 0).scale.set(1, 1, 1.1);
    add(head, starGeo(), M.red, 0, 0.215, -0.123, 0.42, Math.PI, 0);
  } else {
    // flared skirt covering ears and nape
    add(head, g('cyl', 0.123, 0.142, 0.07, 16, 1, true, -Math.PI * 0.68, Math.PI * 1.36), M.helmet, 0, 0.127, 0).scale.set(1, 1, 1.1);
    add(head, g('cyl', 0.124, 0.127, 0.02, 16), M.helmet, 0, 0.162, 0).scale.set(1, 1, 1.1);
  }

  // aim group: arms + rifle, carries most of the pitch
  const AIM_Y = 0.38, AIM_Z = 0;
  const aim = grp(spine, 0, AIM_Y, AIM_Z);
  const shoulders = SH.map((p) => new THREE.Vector3(p.x, p.y - AIM_Y - 0.01, p.z));
  const arms = [0, 1].map((i) => {
    const upper = grp(aim), lower = grp(aim);
    add(upper, g('cap', 0.05, 0.2, 4, 8), M.uniform, 0, -0.15, 0);
    add(lower, g('cap', 0.043, 0.19, 4, 8), M.uniform, 0, -0.13, 0);
    add(lower, g('box', 0.075, 0.095, 0.085), M.glove, 0, -0.285, 0);
    if (i === 0) {
      add(upper, g('cyl', 0.055, 0.055, 0.085, 12), M.red, 0, -0.13, 0);         // armband
      add(upper, g('circ', 0.036, 20), M.emblem, -0.058, -0.13, 0, -Math.PI / 2, -Math.PI / 2, 0);
    }
    return { upper, lower };
  });
  const POLES = [new THREE.Vector3(-0.55, -1, 0.1), new THREE.Vector3(0.75, -1, 0.3)];

  // rifle: origin at top of pistol grip, barrel along -Z
  const RIFLE_POS = new THREE.Vector3(0.085, -0.045, -0.36);
  const rifle = grp(aim, RIFLE_POS.x, RIFLE_POS.y, RIFLE_POS.z);
  add(rifle, g('box', 0.045, 0.065, 0.22), M.metal, 0, 0.033, -0.02);            // receiver
  add(rifle, g('box', 0.042, 0.05, 0.2), M.furn, 0, 0.035, -0.23);               // handguard
  add(rifle, g('cyl', 0.01, 0.01, 0.24, 8), M.metal, 0, 0.042, -0.44, Math.PI / 2);   // barrel
  add(rifle, g('cyl', 0.016, 0.016, 0.055, 8), M.metal, 0, 0.042, -0.575, Math.PI / 2); // muzzle device
  add(rifle, g('box', 0.032, 0.09, 0.04), com ? M.furn : M.metal, 0, -0.04, 0.05, -0.3); // grip
  if (com) {
    add(rifle, g('box', 0.04, 0.075, 0.21), M.furn, 0, 0.012, 0.19, -0.1);       // wood stock
    add(rifle, g('box', 0.028, 0.09, 0.06), M.metal, 0, -0.045, -0.078, 0.15);   // curved magazine
    add(rifle, g('box', 0.028, 0.1, 0.057), M.metal, 0, -0.125, -0.108, 0.55);
    add(rifle, g('cyl', 0.009, 0.009, 0.2, 6), M.metal, 0, 0.072, -0.23, Math.PI / 2); // gas tube
    add(rifle, g('box', 0.02, 0.022, 0.035), M.metal, 0, 0.076, -0.1);           // rear sight
    add(rifle, g('box', 0.012, 0.05, 0.014), M.metal, 0, 0.065, -0.52);          // front sight post
  } else {
    add(rifle, g('box', 0.03, 0.035, 0.2), M.metal, 0, 0.045, 0.19);             // straight tube stock
    add(rifle, g('box', 0.036, 0.085, 0.03), M.furn, 0, 0.025, 0.295);           // butt pad
    add(rifle, g('box', 0.028, 0.16, 0.052), M.metal, 0, -0.08, -0.075, 0.08);   // straight magazine
    add(rifle, g('box', 0.03, 0.012, 0.36), M.metal, 0, 0.071, -0.14);           // top rail
    add(rifle, g('box', 0.036, 0.042, 0.1), M.metal, 0, 0.098, -0.03);           // optic
    add(rifle, g('box', 0.026, 0.07, 0.03), M.furn, 0, -0.02, -0.27, 0.15);      // foregrip
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.042, -0.61);
  rifle.add(muzzle);
  const HAND_R = new THREE.Vector3(0.005, -0.05, 0.05);
  const HAND_L = new THREE.Vector3(-0.005, com ? -0.02 : -0.035, com ? -0.19 : -0.21);
  const HAND_MAG = new THREE.Vector3(-0.01, -0.17, -0.08);
  const _hl = new THREE.Vector3(), _hr = new THREE.Vector3();

  // ------------------------------------------------------------ state
  const tgt = { speed: 0, crouch: 0, pitch: 0, lean: 0, firing: false, reloading: false };
  const cur = { speed: 0, crouch: 0, pitch: 0, lean: 0, fire: 0, reload: 0 };
  let phase = 0, time = Math.random() * 10, dead = false, deathT = 0;
  const deathAxis = new THREE.Vector3(1, 0, 0);

  function setPose(p) {
    if (!p) return;
    if (p.speed !== undefined) tgt.speed = Math.max(0, +p.speed || 0);
    if (p.crouch !== undefined) tgt.crouch = THREE.MathUtils.clamp(+p.crouch || 0, 0, 1);
    if (p.pitch !== undefined) tgt.pitch = THREE.MathUtils.clamp(+p.pitch || 0, -1.4, 1.4);
    if (p.lean !== undefined) tgt.lean = THREE.MathUtils.clamp(+p.lean || 0, -1, 1);
    if (p.firing !== undefined) tgt.firing = !!p.firing;
    if (p.reloading !== undefined) tgt.reloading = !!p.reloading;
  }

  function applyPose() {
    const t = deathT;
    const limp = dead ? t * t * (3 - 2 * t) : 0;
    const sp = Math.min(cur.speed, 7);
    const move = Math.min(1, cur.speed / 0.8);
    const c = Math.min(1, cur.crouch + (dead ? Math.sin(Math.PI * t) * 0.35 : 0));
    const A = move * (0.3 + 0.065 * sp) * (1 - 0.35 * c);
    const s = Math.sin(phase), co = Math.cos(phase);
    const breath = Math.sin(time * 1.7);

    // legs
    let ext = 0;
    for (let i = 0; i < 2; i++) {
      const sgn = i ? -1 : 1;
      const lift = Math.max(0, co * sgn);
      const th = A * s * sgn + c * CROUCH_THIGH + limp * (i ? 0.4 : -0.12);
      const kn = -move * (0.12 + lift * (0.55 + 0.1 * sp)) - c * CROUCH_KNEE - limp * (i ? 0.75 : 0.15);
      const L = legs[i];
      L.thigh.rotation.x = th;
      L.thigh.rotation.z = (i ? 1 : -1) * (0.035 + 0.12 * limp);
      L.knee.rotation.x = kn;
      L.foot.rotation.x = (-(th + kn) - lift * 0.4 * move) * (1 - limp) - 0.5 * limp;
      ext = Math.max(ext, UP_LEG * Math.cos(th) + LO_LEG * Math.cos(th + kn));
    }
    const hipY = THREE.MathUtils.lerp(ext + FOOT_H, HIP_H, limp);
    const zc = UP_LEG * Math.sin(c * CROUCH_THIGH) + LO_LEG * Math.sin(c * (CROUCH_THIGH - CROUCH_KNEE));
    hips.position.set(Math.sin(phase) * 0.018 * move, hipY, zc * (1 - limp));
    hips.rotation.y = s * 0.09 * move;

    // upper body
    const fwd = c * CROUCH_BEND + Math.min(0.2, 0.035 * cur.speed);
    const twist = -s * 0.14 * move;
    spine.rotation.set(0.4 * cur.pitch - fwd + breath * 0.006, twist, -cur.lean * 0.35 + 0.25 * limp);
    chest.position.y = breath * 0.003;
    head.rotation.set(0.45 * cur.pitch + fwd * 0.9 - 0.3 * limp, -twist * 0.6, cur.lean * 0.17 + 0.4 * limp);

    const kick = cur.fire * (0.5 + 0.5 * Math.sin(time * 78));
    const ax = 0.6 * cur.pitch + fwd + breath * 0.008 + Math.sin(phase * 2) * 0.015 * move + kick * 0.014 - cur.reload * 0.12;
    aim.rotation.set(THREE.MathUtils.lerp(ax, -1.2, limp), -twist * 0.5, 0);
    aim.position.set(0, AIM_Y + breath * 0.003, AIM_Z + kick * 0.014);

    const r = cur.reload;
    rifle.rotation.set(0.28 * r, 0.12 * r, -0.45 * r);
    rifle.position.copy(RIFLE_POS);
    _hr.copy(HAND_R).applyQuaternion(rifle.quaternion).add(rifle.position);
    _hl.copy(HAND_MAG);
    _hl.y -= 0.09 * (0.5 + 0.5 * Math.sin(time * 6.5));
    _hl.lerpVectors(HAND_L, _hl, r).applyQuaternion(rifle.quaternion).add(rifle.position);
    solveArm(arms[0], shoulders[0], _hl, POLES[0]);
    solveArm(arms[1], shoulders[1], _hr, POLES[1]);

    // death fall
    if (dead) {
      const u = t / 0.82;
      const e = u < 1 ? u * u : 1 - 0.035 * Math.sin((t - 0.82) / 0.18 * Math.PI);
      root.quaternion.setFromAxisAngle(deathAxis, e * Math.PI * 0.5);
      root.position.y = 0.2 * Math.min(1, e);
    } else {
      root.quaternion.identity();
      root.position.y = 0;
    }
  }

  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const k = 1 - Math.exp(-dt * 12);
    time += dt;
    if (dead) deathT = Math.min(1, deathT + dt / 0.6);
    cur.speed += ((dead ? 0 : tgt.speed) - cur.speed) * k;
    cur.crouch += ((dead ? 0 : tgt.crouch) - cur.crouch) * k;
    cur.pitch += ((dead ? 0 : tgt.pitch) - cur.pitch) * k;
    cur.lean += ((dead ? 0 : tgt.lean) - cur.lean) * k;
    cur.fire += ((!dead && tgt.firing ? 1 : 0) - cur.fire) * Math.min(1, k * 2);
    cur.reload += ((!dead && tgt.reloading ? 1 : 0) - cur.reload) * k * 0.7;
    if (cur.speed > 0.05) phase = (phase + dt * TAU * (0.75 + 0.17 * Math.min(cur.speed, 7))) % TAU;
    applyPose();
  }

  // dirX/dirZ: world-space horizontal direction (e.g. towards the shooter); the body falls away from it.
  function die(dirX = 0, dirZ = -1) {
    if (dead) return;
    _t.set(-dirX, 0, -dirZ);
    if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
    group.getWorldQuaternion(_q).invert();
    _t.applyQuaternion(_q);
    _t.y = 0;
    _t.normalize();
    deathAxis.set(_t.z, 0, -_t.x);      // up x fallDir
    dead = true;
    deathT = 0;
  }

  function reset() {
    dead = false;
    deathT = 0;
    phase = 0;
    Object.assign(tgt, { speed: 0, crouch: 0, pitch: 0, lean: 0, firing: false, reloading: false });
    Object.assign(cur, { speed: 0, crouch: 0, pitch: 0, lean: 0, fire: 0, reload: 0 });
    applyPose();
  }

  // per-soldier highlight: swap shared materials for lazily created private clones
  const hlMats = new Map();
  function setHighlight(hex) {
    for (const m of meshes) {
      const base = m.userData.baseMat;
      if (hex === null || hex === undefined) { m.material = base; continue; }
      let c = hlMats.get(base);
      if (!c) { c = base.clone(); hlMats.set(base, c); }
      c.emissive.set(hex);
      c.emissiveIntensity = 0.4;
      m.material = c;
    }
  }

  applyPose();
  return { group, setPose, update, die, reset, muzzle, setHighlight };
}
