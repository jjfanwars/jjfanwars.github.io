// World: geometry, colliders, destructible soft walls, barricades, raycasts, nav grid.
import * as THREE from 'three';

export const CELL = 0.25, ROWS = 12, WALL_H = 3, PANEL = 8, SOFT_T = 0.14;
const TS = { concrete: 2, plaster: 2, brick: 2, woodFloor: 2, tiles: 2, carpet: 1, ceiling: 2, planks: 1, asphalt: 4, grass: 4, crate: 1, fabric: 0.5, metal: 1 };
const NAV = { ox: -32, oz: -27, nx: 128, nz: 108, s: 0.5 };
const FLOOR = { kind: 'floor', alive: true };
const hit = { t: 0, c: null, nx: 0, ny: 0, nz: 0 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function boxGeo(w, h, d, s) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s);
  }
  return g;
}

export function rayBox(c, ox, oy, oz, ix, iy, iz, maxT) {
  let t1 = (c.x0 - ox) * ix, t2 = (c.x1 - ox) * ix;
  let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1;
  t1 = (c.y0 - oy) * iy; t2 = (c.y1 - oy) * iy;
  let a = t1 < t2 ? t1 : t2, b = t1 < t2 ? t2 : t1;
  if (a > tmin) tmin = a; if (b < tmax) tmax = b;
  t1 = (c.z0 - oz) * iz; t2 = (c.z1 - oz) * iz;
  a = t1 < t2 ? t1 : t2; b = t1 < t2 ? t2 : t1;
  if (a > tmin) tmin = a; if (b < tmax) tmax = b;
  if (tmax < 0 || tmin > tmax || tmin > maxT) return -1;
  return tmin < 0 ? 0 : tmin;
}

function pushOut(p, r, x0, z0, x1, z1) {
  const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
  else {
    const l = p.x - x0, rr = x1 - p.x, n = p.z - z0, f = z1 - p.z, m = Math.min(l, rr, n, f);
    if (m === l) p.x = x0 - r; else if (m === rr) p.x = x1 + r; else if (m === n) p.z = z0 - r; else p.z = z1 + r;
  }
  return true;
}

export class World {
  constructor(scene, tex, fx, audio) {
    this.scene = scene; this.tex = tex; this.fx = fx; this.audio = audio;
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = []; this.walls = []; this.openings = []; this.panels = [];
    this.cells = []; this.mats = new Map(); this.pillars = new Set();
    this.navDirty = false; this.navT = 0;
    this.onNoise = null;
  }

  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.root);
  }

  mat(key, color = 0xffffff, metalness = 0, rough = 1) {
    const id = key + color + '_' + metalness;
    let m = this.mats.get(id);
    if (!m) {
      const t = this.tex[key];
      m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color, roughness: rough, metalness });
      this.mats.set(id, m);
    }
    return m;
  }

  // Axis-aligned textured box. opts: color, collide(true), vault, kind, metal, noShadow
  addBox(x0, y0, z0, x1, y1, z1, texKey, o = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const mesh = new THREE.Mesh(boxGeo(w, h, d, TS[texKey] || 1), this.mat(texKey, o.color, o.metal || 0));
    mesh.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2);
    mesh.castShadow = !o.noShadow; mesh.receiveShadow = true;
    this.root.add(mesh);
    let c = null;
    if (o.collide !== false) {
      c = { x0, y0, z0, x1, y1, z1, kind: o.kind || 'hard', alive: true, vault: !!o.vault, mesh };
      this.colliders.push(c);
    }
    return c;
  }

  addFloor(x0, z0, x1, z1, texKey, y = 0.01, color = 0xffffff, down = false) {
    const w = x1 - x0, d = z1 - z0, s = TS[texKey] || 1;
    const g = new THREE.PlaneGeometry(w, d), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / s, uv.getY(i) * d / s);
    const m = new THREE.Mesh(g, this.mat(texKey, color));
    m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    m.position.set(x0 + w / 2, y, z0 + d / 2);
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  _abox(axis, a0, a1, f, t, y0, y1, tex, o) {
    if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
    const lin = o.lining; // exterior wall: outer skin + inner plaster skin
    const parts = lin ? [[f - t / 2, f + t / 2 - 0.1, lin > 0 ? tex : 'plaster', lin > 0 ? o.color : 0xd8d2c4], [f + t / 2 - 0.1, f + t / 2, lin > 0 ? 'plaster' : tex, lin > 0 ? 0xd8d2c4 : o.color]] : [[f - t / 2, f + t / 2, tex, o.color]];
    if (lin < 0) { parts[0][1] = f - t / 2 + 0.1; parts[1][0] = f - t / 2 + 0.1; parts[0][2] = 'plaster'; parts[0][3] = 0xd8d2c4; parts[1][2] = tex; parts[1][3] = o.color; }
    for (const [f0, f1, tx, col] of parts) {
      const oo = { color: col, vault: o.vault };
      if (axis === 'x') this.addBox(a0, y0, f0, a1, y1, f1, tx, oo);
      else this.addBox(f0, y0, a0, f1, y1, a1, tx, oo);
    }
  }

  _pillar(x, z) {
    const k = x + ',' + z;
    if (this.pillars.has(k)) return;
    this.pillars.add(k);
    this.addBox(x - 0.16, 0, z - 0.16, x + 0.16, WALL_H, z + 0.16, 'concrete', { color: 0xb9b6ae });
  }

  // type: 'hard' | 'soft'. ops: [{at, w, kind:'door'|'window'|'arch', barricaded}]
  wall(type, x1, z1, x2, z2, ops = [], o = {}) {
    const axis = z1 === z2 ? 'x' : 'z';
    const a0 = axis === 'x' ? Math.min(x1, x2) : Math.min(z1, z2), a1 = axis === 'x' ? Math.max(x1, x2) : Math.max(z1, z2);
    const f = axis === 'x' ? z1 : x1;
    ops = ops.slice().sort((p, q) => p.at - q.at);
    const opn = ops.map(op => {
      const kind = op.kind || 'door', w = op.w || (kind === 'window' ? 1.5 : 1);
      const y0 = kind === 'window' ? 1 : 0, y1 = kind === 'window' ? 2.25 : kind === 'arch' ? 2.5 : 2;
      const t = type === 'soft' ? SOFT_T : (o.t || 0.2);
      const od = { id: this.openings.length, axis, at: op.at, f, w, y0, y1, kind, t, x: axis === 'x' ? op.at : f, z: axis === 'x' ? f : op.at, barricade: null, canBarricade: kind !== 'arch', exterior: !!o.lining };
      this.openings.push(od);
      return od;
    });
    if (type === 'hard') {
      const t = o.t || 0.2, tex = o.tex || 'concrete';
      let cur = a0;
      for (const op of opn) {
        this._abox(axis, cur, op.at - op.w / 2, f, t, 0, WALL_H, tex, o);
        this._abox(axis, op.at - op.w / 2, op.at + op.w / 2, f, t, op.y1, WALL_H, tex, o);
        if (op.y0 > 0) this._abox(axis, op.at - op.w / 2, op.at + op.w / 2, f, t, 0, op.y0, tex, { ...o, vault: true });
        cur = op.at + op.w / 2;
      }
      this._abox(axis, cur, a1, f, t, 0, WALL_H, tex, o);
    } else {
      const cols = Math.round((a1 - a0) / CELL);
      const wl = { axis, a0, a1, f, cols, grid: new Array(cols * ROWS).fill(null), cells: [], color: new THREE.Color(o.color || 0xd9d3c3), panels: [] };
      wl.b = axis === 'x' ? { x0: a0, x1: a1, z0: f - SOFT_T / 2, z1: f + SOFT_T / 2, y0: 0, y1: WALL_H } : { x0: f - SOFT_T / 2, x1: f + SOFT_T / 2, z0: a0, z1: a1, y0: 0, y1: WALL_H };
      for (let c = 0; c < cols; c++) {
        const ac = a0 + (c + 0.5) * CELL, pi = Math.floor(c / PANEL);
        let pn = wl.panels[pi];
        if (!pn) {
          const pa = a0 + Math.min((pi + 0.5) * PANEL * CELL, (pi * PANEL * CELL + (a1 - a0)) / 2);
          pn = wl.panels[pi] = { wall: wl, idx: pi, cells: [], hasDoor: false, reinforced: false, c0: c, c1: c, x: axis === 'x' ? pa : f, z: axis === 'x' ? f : pa };
          this.panels.push(pn);
        }
        pn.c1 = c;
        const door = opn.find(op => Math.abs(ac - op.at) < op.w / 2);
        if (door) pn.hasDoor = true;
        for (let r = 0; r < ROWS; r++) {
          if (door && r * CELL < door.y1 - 0.01) continue;
          const y0 = r * CELL, lo = ac - CELL / 2, hi = ac + CELL / 2;
          const cell = axis === 'x'
            ? { x0: lo, x1: hi, z0: wl.b.z0, z1: wl.b.z1, y0, y1: y0 + CELL }
            : { x0: wl.b.x0, x1: wl.b.x1, z0: lo, z1: hi, y0, y1: y0 + CELL };
          cell.kind = 'cell'; cell.alive = true; cell.hp = 2; cell.wall = wl; cell.col = c; cell.row = r; cell.panel = pn; cell.reinforced = false; cell.idx = this.cells.length;
          wl.grid[c * ROWS + r] = cell; wl.cells.push(cell); pn.cells.push(cell); this.cells.push(cell);
        }
      }
      this.walls.push(wl);
    }
    if (!o.noPillar) { this._pillar(x1, z1); this._pillar(x2, z2); }
    for (const op of opn) if (ops[opn.indexOf(op)].barricaded) this.deployBarricade(op, true);
    return opn;
  }

  finalize() {
    const n = this.cells.length;
    const g = new THREE.BoxGeometry(CELL, CELL, SOFT_T), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.125, uv.getY(i) * 0.125);
    const im = this.cellMesh = new THREE.InstancedMesh(g, this.mat('plaster'), n);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const m = new THREE.Matrix4(), rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    for (const c of this.cells) {
      m.makeTranslation((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2);
      if (c.wall.axis === 'z') m.multiply(rot);
      im.setMatrixAt(c.idx, m);
      im.setColorAt(c.idx, c.wall.color);
    }
    this.root.add(im);
    this.buildNav();
  }

  _hideCell(c) {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    this.cellMesh.setMatrixAt(c.idx, m);
    this.cellMesh.instanceMatrix.needsUpdate = true;
  }

  damageCell(c, n = 1) {
    if (!c.alive || c.reinforced) return false;
    c.hp -= n;
    if (c.hp <= 0) { this.destroyCell(c); return true; }
    const col = c.wall.color.clone().multiplyScalar(0.55);
    this.cellMesh.setColorAt(c.idx, col); this.cellMesh.instanceColor.needsUpdate = true;
    return false;
  }

  destroyCell(c, quiet) {
    if (!c.alive || c.reinforced) return;
    c.alive = false; this._hideCell(c); this.navDirty = true;
    if (!quiet) this.fx.debris((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2, c.wall.color, 3);
  }

  destroySphere(x, y, z, r) {
    let n = 0;
    for (const w of this.walls) {
      const b = w.b;
      if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
      for (const c of w.cells) {
        if (!c.alive || c.reinforced) continue;
        const dx = (c.x0 + c.x1) / 2 - x, dy = (c.y0 + c.y1) / 2 - y, dz = (c.z0 + c.z1) / 2 - z;
        if (dx * dx + dy * dy + dz * dz < r * r) { this.destroyCell(c, n++ % 3 !== 0); }
      }
    }
    for (const op of this.openings) if (op.barricade && Math.hypot(op.x - x, op.z - z) < r + 0.6) this.damageBarricade(op, 999);
    return n;
  }

  reinforce(pn) {
    if (pn.reinforced || pn.hasDoor) return false;
    pn.reinforced = true;
    for (const c of pn.cells) { c.alive = true; c.reinforced = true; this._hideCell(c); }
    const w = pn.wall, lo = w.a0 + pn.c0 * CELL, hi = w.a0 + (pn.c1 + 1) * CELL, t = 0.2;
    const geo = w.axis === 'x' ? new THREE.BoxGeometry(hi - lo, WALL_H, t) : new THREE.BoxGeometry(t, WALL_H, hi - lo);
    const tm = this.tex.metalPlate;
    let mm = this.mats.get('plate');
    if (!mm) { mm = new THREE.MeshStandardMaterial({ map: tm.map, normalMap: tm.normalMap, roughnessMap: tm.roughnessMap, metalness: 0.75, roughness: 0.9 }); this.mats.set('plate', mm); }
    const mesh = new THREE.Mesh(geo, mm);
    mesh.position.set(w.axis === 'x' ? (lo + hi) / 2 : w.f, WALL_H / 2, w.axis === 'x' ? w.f : (lo + hi) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    this.navDirty = true;
    return true;
  }

  deployBarricade(op, quiet) {
    if (op.barricade || !op.canBarricade) return false;
    const y0 = op.y0 + (op.kind === 'door' ? 0.22 : 0), t = 0.06, lo = op.at - op.w / 2, hi = op.at + op.w / 2;
    const c = op.axis === 'x'
      ? { x0: lo, x1: hi, z0: op.f - t, z1: op.f + t, y0, y1: op.y1 }
      : { x0: op.f - t, x1: op.f + t, z0: lo, z1: hi, y0, y1: op.y1 };
    c.kind = 'barricade'; c.alive = true; c.op = op;
    const grp = new THREE.Group(), planks = [];
    const n = Math.floor((op.y1 - y0) / 0.22);
    const mat = this.mat('planks', 0xb99a6b);
    for (let i = 0; i < n; i++) {
      const g = op.axis === 'x' ? boxGeo(op.w + 0.12, 0.18, 0.035, 1) : boxGeo(0.035, 0.18, op.w + 0.12, 1);
      const m = new THREE.Mesh(g, mat);
      m.position.set(op.x, y0 + 0.11 + i * 0.22, op.z);
      m.rotation[op.axis === 'x' ? 'z' : 'x'] = (Math.sin(i * 12.9898 + op.id) * 0.5) * 0.05;
      m.castShadow = m.receiveShadow = true;
      grp.add(m); planks.push(m);
    }
    this.root.add(grp);
    op.barricade = { hp: 100, col: c, grp, planks, n };
    this.colliders.push(c);
    this.navDirty = true;
    if (!quiet) this.audio.play('barricade_build', { pos: [op.x, 1.2, op.z] });
    return true;
  }

  damageBarricade(op, dmg) {
    const b = op.barricade;
    if (!b) return;
    b.hp -= dmg;
    const keep = Math.max(0, Math.ceil(b.hp / 100 * b.n));
    while (b.planks.length > keep) {
      const i = (Math.random() * b.planks.length) | 0, p = b.planks.splice(i, 1)[0];
      this.fx.debris(p.position.x, p.position.y, p.position.z, new THREE.Color(0x9a7a4c), 4);
      b.grp.remove(p); p.geometry.dispose();
    }
    if (b.hp <= 0) {
      b.col.alive = false;
      this.colliders.splice(this.colliders.indexOf(b.col), 1);
      this.root.remove(b.grp);
      op.barricade = null; this.navDirty = true;
      this.audio.play('barricade_break', { pos: [op.x, 1.2, op.z] });
    } else this.audio.play('barricade_hit', { pos: [op.x, 1.2, op.z] });
  }

  // Nearest hit along ray, or null. flags: 1 = ignore barricades
  raycast(ox, oy, oz, dx, dy, dz, maxT, flags = 0) {
    if (Math.abs(dx) < 1e-9) dx = 1e-9; if (Math.abs(dy) < 1e-9) dy = 1e-9; if (Math.abs(dz) < 1e-9) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxT, bc = null;
    const cs = this.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if ((flags & 1) && c.kind === 'barricade') continue;
      const t = rayBox(c, ox, oy, oz, ix, iy, iz, best);
      if (t >= 0 && t < best) { best = t; bc = c; }
    }
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (rayBox(w.b, ox, oy, oz, ix, iy, iz, best) < 0) continue;
      const wc = w.cells;
      for (let j = 0; j < wc.length; j++) {
        const c = wc[j];
        if (!c.alive) continue;
        const t = rayBox(c, ox, oy, oz, ix, iy, iz, best);
        if (t >= 0 && t < best) { best = t; bc = c; }
      }
    }
    if (dy < 0) { const t = -oy * iy; if (t >= 0 && t < best) { best = t; bc = FLOOR; } }
    if (!bc) return null;
    hit.t = best; hit.c = bc; hit.nx = hit.ny = hit.nz = 0;
    if (bc === FLOOR) hit.ny = 1;
    else {
      const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best, e = 1e-3;
      if (Math.abs(px - bc.x0) < e) hit.nx = -1; else if (Math.abs(px - bc.x1) < e) hit.nx = 1;
      else if (Math.abs(pz - bc.z0) < e) hit.nz = -1; else if (Math.abs(pz - bc.z1) < e) hit.nz = 1;
      else if (Math.abs(py - bc.y1) < e) hit.ny = 1; else if (Math.abs(py - bc.y0) < e) hit.ny = -1;
      else { hit.nx = -Math.sign(dx) * (Math.abs(dx) > Math.abs(dz) ? 1 : 0); hit.nz = -Math.sign(dz) * (Math.abs(dx) > Math.abs(dz) ? 0 : 1); }
    }
    return hit;
  }

  los(ox, oy, oz, tx, ty, tz) {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz, d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return true;
    return !this.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d - 0.05);
  }

  // Push a vertical cylinder (circle r in XZ, spanning yLo..yHi) out of solids.
  collide(p, r, yLo, yHi, ignoreVault) {
    for (let it = 0; it < 2; it++) {
      const cs = this.colliders;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.y1 <= yLo || c.y0 >= yHi || (ignoreVault && c.vault)) continue;
        if (p.x < c.x0 - r || p.x > c.x1 + r || p.z < c.z0 - r || p.z > c.z1 + r) continue;
        pushOut(p, r, c.x0, c.z0, c.x1, c.z1);
      }
      const r0 = Math.max(0, Math.floor(yLo / CELL)), r1 = Math.min(ROWS - 1, Math.floor((yHi - 1e-4) / CELL));
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i], b = w.b;
        if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
        const pa = w.axis === 'x' ? p.x : p.z;
        const c0 = Math.max(0, Math.floor((pa - r - w.a0) / CELL)), c1 = Math.min(w.cols - 1, Math.floor((pa + r - w.a0) / CELL));
        for (let c = c0; c <= c1; c++) {
          let solid = false;
          for (let rr = r0; rr <= r1; rr++) { const ce = w.grid[c * ROWS + rr]; if (ce && ce.alive) { solid = true; break; } }
          if (!solid) continue;
          const lo = w.a0 + c * CELL, hi = lo + CELL;
          if (w.axis === 'x') pushOut(p, r, lo, b.z0, hi, b.z1); else pushOut(p, r, b.x0, lo, b.x1, hi);
        }
      }
    }
    p.x = clamp(p.x, NAV.ox + 0.6, -NAV.ox - 0.6); p.z = clamp(p.z, NAV.oz + 0.6, -NAV.oz - 0.6);
  }

  // ---------- navigation ----------
  buildNav() {
    const { nx, nz, ox, oz, s } = NAV, N = nx * nz;
    const bl = this.blocked = this.blocked || new Uint8Array(N), co = this.cost = this.cost || new Uint8Array(N);
    bl.fill(0); co.fill(0);
    const mark = (x0, z0, x1, z1, arr, v, R) => {
      const i0 = Math.max(0, Math.ceil((x0 - R - ox) / s - 0.5)), i1 = Math.min(nx - 1, Math.floor((x1 + R - ox) / s - 0.5));
      const j0 = Math.max(0, Math.ceil((z0 - R - oz) / s - 0.5)), j1 = Math.min(nz - 1, Math.floor((z1 + R - oz) / s - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) arr[i + j * nx] = v;
    };
    for (const c of this.colliders) {
      if (c.kind === 'barricade') mark(c.x0, c.z0, c.x1, c.z1, co, 5, 0.26);
      else if (c.vault) mark(c.x0, c.z0, c.x1, c.z1, co, 9, 0.26);
      else if (c.y0 < 1.7 && c.y1 > 0.35) mark(c.x0, c.z0, c.x1, c.z1, bl, 1, 0.3);
    }
    for (const w of this.walls) for (let c = 0; c < w.cols; c++) {
      let solid = false;
      for (let r = 1; r <= 6; r++) { const ce = w.grid[c * ROWS + r]; if (ce && ce.alive) { solid = true; break; } }
      if (!solid) continue;
      const lo = w.a0 + c * CELL, hi = lo + CELL;
      if (w.axis === 'x') mark(lo, w.b.z0, hi, w.b.z1, bl, 1, 0.3); else mark(w.b.x0, lo, w.b.x1, hi, bl, 1, 0.3);
    }
    for (let i = 0; i < nx; i++) { bl[i] = bl[i + (nz - 1) * nx] = 1; }
    for (let j = 0; j < nz; j++) { bl[j * nx] = bl[nx - 1 + j * nx] = 1; }
    this.navDirty = false; this.navVersion = (this.navVersion || 0) + 1;
  }

  update(dt) {
    this.navT -= dt;
    if (this.navDirty && this.navT <= 0) { this.buildNav(); this.navT = 0.4; }
  }

  _node(x, z) {
    const { nx, nz, ox, oz, s } = NAV;
    let i = clamp(Math.floor((x - ox) / s), 0, nx - 1), j = clamp(Math.floor((z - oz) / s), 0, nz - 1);
    if (!this.blocked[i + j * nx]) return i + j * nx;
    let best = -1, bd = 1e9;
    for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || this.blocked[a + b * nx]) continue;
      const cx = ox + (a + 0.5) * s - x, cz = oz + (b + 0.5) * s - z, d = cx * cx + cz * cz;
      if (d < bd) { bd = d; best = a + b * nx; }
    }
    return best;
  }

  navFree(x, z) {
    const { nx, nz, ox, oz, s } = NAV;
    const i = Math.floor((x - ox) / s), j = Math.floor((z - oz) / s);
    return i >= 0 && j >= 0 && i < nx && j < nz && !this.blocked[i + j * nx] && !this.cost[i + j * nx];
  }

  navLineClear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.2);
    for (let k = 1; k <= n; k++) { const t = k / n; if (!this.navFree(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }

  findPath(sx, sz, tx, tz) {
    const { nx, nz, ox, oz, s } = NAV, N = nx * nz;
    const st = this._node(sx, sz), go = this._node(tx, tz);
    if (st < 0 || go < 0) return null;
    if (!this._g) { this._g = new Float32Array(N); this._from = new Int32Array(N); this._stamp = new Uint32Array(N); this._closed = new Uint32Array(N); this._sid = 0; }
    const g = this._g, from = this._from, stamp = this._stamp, closed = this._closed, sid = ++this._sid;
    const gi = go % nx, gj = (go / nx) | 0;
    const heap = [], hf = [];
    const push = (n, f) => { let i = heap.length; heap.push(n); hf.push(f); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; } heap[i] = n; hf[i] = f; };
    const pop = () => {
      const top = heap[0], ln = heap.pop(), lf = hf.pop(), len = heap.length;
      if (len) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= len) break; if (c + 1 < len && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; heap[i] = heap[c]; hf[i] = hf[c]; i = c; } heap[i] = ln; hf[i] = lf; }
      return top;
    };
    const h = (i, j) => { const a = Math.abs(i - gi), b = Math.abs(j - gj); return (a + b) + (1.4142 - 2) * Math.min(a, b); };
    g[st] = 0; stamp[st] = sid; from[st] = -1; push(st, 0);
    let found = false, iter = 0;
    const bl = this.blocked, co = this.cost;
    while (heap.length && iter++ < 20000) {
      const n = pop();
      if (n === go) { found = true; break; }
      if (closed[n] === sid) continue;
      closed[n] = sid;
      const i = n % nx, j = (n / nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const m = a + b * nx;
        if (bl[m] || closed[m] === sid) continue;
        if (di && dj && (bl[i + di + j * nx] || bl[i + (j + dj) * nx])) continue;
        const ng = g[n] + (di && dj ? 1.4142 : 1) + co[m];
        if (stamp[m] !== sid || ng < g[m]) { g[m] = ng; stamp[m] = sid; from[m] = n; push(m, ng + h(a, b)); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let n = go; n !== -1; n = from[n]) out.push({ x: ox + (n % nx + 0.5) * s, z: oz + (((n / nx) | 0) + 0.5) * s });
    out.reverse();
    return out;
  }
}
