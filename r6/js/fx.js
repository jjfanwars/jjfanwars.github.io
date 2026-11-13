// Visual effects: particles, debris chunks, tracers, bullet decals, flash lights.
import * as THREE from 'three';

const NP = 700, ND = 260, NDEC = 300, NT = 40;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1), _c = new THREE.Color();

export class FX {
  constructor(scene) {
    this.scene = scene;
    // particles
    const g = new THREE.BufferGeometry();
    this.pp = new Float32Array(NP * 3).fill(-999); this.pc = new Float32Array(NP * 4); this.ps = new Float32Array(NP);
    g.setAttribute('position', new THREE.BufferAttribute(this.pp, 3));
    g.setAttribute('col', new THREE.BufferAttribute(this.pc, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.ps, 1));
    this.pv = new Float32Array(NP * 3); this.pl = new Float32Array(NP); this.pm = new Float32Array(NP); this.pg = new Float32Array(NP); this.pa = new Float32Array(NP);
    this.pi = 0;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float size; attribute vec4 col; varying vec4 vC; void main(){ vC=col; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*600./max(.1,-mv.z); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.1,d); gl_FragColor=vec4(vC.rgb,vC.a*a); }',
    }));
    this.points.frustumCulled = false; scene.add(this.points);
    // debris
    this.deb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.05, 0.09), new THREE.MeshStandardMaterial({ roughness: 1 }), ND);
    this.deb.frustumCulled = false; this.deb.castShadow = true;
    this.dd = []; for (let i = 0; i < ND; i++) { this.dd.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }); this.deb.setMatrixAt(i, _m.makeScale(0, 0, 0)); this.deb.setColorAt(i, _c.set(0xffffff)); }
    this.di = 0; scene.add(this.deb);
    // decals
    this.dec = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 8), new THREE.MeshBasicMaterial({ color: 0x0b0a09, polygonOffset: true, polygonOffsetFactor: -4 }), NDEC);
    this.dec.frustumCulled = false; for (let i = 0; i < NDEC; i++) this.dec.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.deci = 0; scene.add(this.dec);
    // tracers
    this.tr = [];
    const tg = new THREE.BoxGeometry(0.012, 0.012, 1), tm = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.7 });
    for (let i = 0; i < NT; i++) { const m = new THREE.Mesh(tg, tm); m.visible = false; m.frustumCulled = false; scene.add(m); this.tr.push({ m, life: 0 }); }
    this.ti = 0;
    // lights
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffc070, 0, 14, 1.8); scene.add(l); this.lights.push({ l, life: 0, max: 1, pow: 0 }); }
    this.li = 0;
  }

  clear() {
    this.pp.fill(-999); this.pl.fill(0);
    for (let i = 0; i < ND; i++) { this.dd[i].life = 0; this.deb.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
    for (let i = 0; i < NDEC; i++) this.dec.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.deb.instanceMatrix.needsUpdate = this.dec.instanceMatrix.needsUpdate = true;
  }

  puff(x, y, z, color, n = 6, speed = 1, size = 0.12, life = 0.6, grav = -0.5, alpha = 0.6, nx = 0, ny = 0, nz = 0) {
    _c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.pi = (this.pi + 1) % NP;
      this.pp[i * 3] = x; this.pp[i * 3 + 1] = y; this.pp[i * 3 + 2] = z;
      this.pv[i * 3] = (Math.random() - 0.5 + nx) * speed; this.pv[i * 3 + 1] = (Math.random() - 0.3 + ny) * speed; this.pv[i * 3 + 2] = (Math.random() - 0.5 + nz) * speed;
      const s = 0.8 + Math.random() * 0.4;
      this.pc[i * 4] = _c.r * s; this.pc[i * 4 + 1] = _c.g * s; this.pc[i * 4 + 2] = _c.b * s; this.pc[i * 4 + 3] = alpha;
      this.pa[i] = alpha; this.ps[i] = size * (0.6 + Math.random() * 0.8); this.pl[i] = this.pm[i] = life * (0.6 + Math.random() * 0.8); this.pg[i] = grav;
    }
  }

  debris(x, y, z, color, n = 3) {
    for (let k = 0; k < n; k++) {
      const i = this.di = (this.di + 1) % ND, d = this.dd[i];
      d.p.set(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2);
      d.v.set((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      d.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10); d.r.set(0, 0, 0); d.life = 4;
      this.deb.setColorAt(i, _c.copy(color).multiplyScalar(0.7 + Math.random() * 0.3));
    }
    this.deb.instanceColor.needsUpdate = true;
    this.puff(x, y, z, 0xcfc8b8, 2, 0.8, 0.22, 0.9, -0.2, 0.35);
  }

  decal(x, y, z, nx, ny, nz) {
    const i = this.deci = (this.deci + 1) % NDEC;
    _v.set(nx, ny, nz); _q.setFromUnitVectors(Z, _v);
    _m.compose(_v.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004), _q, _s.set(1, 1, 1));
    this.dec.setMatrixAt(i, _m); this.dec.instanceMatrix.needsUpdate = true;
  }

  tracer(ax, ay, az, bx, by, bz) {
    const t = this.tr[this.ti = (this.ti + 1) % NT], len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1.5) return;
    t.m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    t.m.lookAt(bx, by, bz); t.m.scale.set(1, 1, len); t.m.visible = true; t.life = 0.05;
  }

  flash(x, y, z, pow = 30, life = 0.06, color = 0xffc070) {
    const f = this.lights[this.li = (this.li + 1) % this.lights.length];
    f.l.position.set(x, y, z); f.l.color.set(color); f.life = f.max = life; f.pow = pow;
  }

  explosion(x, y, z, big = 1) {
    this.flash(x, y + 0.3, z, 400 * big, 0.35, 0xffa040);
    this.puff(x, y + 0.2, z, 0xffb050, 14, 7 * big, 0.5, 0.25, 0, 0.9);
    this.puff(x, y + 0.3, z, 0x3a3632, 26, 4 * big, 0.9, 1.8, 0.6, 0.55);
    this.puff(x, y + 0.2, z, 0x9a9488, 16, 6 * big, 0.5, 1.2, -1, 0.45);
  }

  update(dt) {
    for (let i = 0; i < NP; i++) {
      if (this.pl[i] <= 0) continue;
      this.pl[i] -= dt;
      if (this.pl[i] <= 0) { this.pp[i * 3 + 1] = -999; continue; }
      this.pv[i * 3 + 1] += this.pg[i] * dt * 4;
      const dr = 1 - dt * 2.5;
      this.pv[i * 3] *= dr; this.pv[i * 3 + 2] *= dr;
      this.pp[i * 3] += this.pv[i * 3] * dt; this.pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      this.pc[i * 4 + 3] = this.pa[i] * (this.pl[i] / this.pm[i]); this.ps[i] += dt * 0.15;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.col.needsUpdate = g.attributes.size.needsUpdate = true;
    let any = false;
    for (let i = 0; i < ND; i++) {
      const d = this.dd[i];
      if (d.life <= 0) continue;
      any = true; d.life -= dt;
      if (d.p.y > 0.03) { d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt); if (d.p.y <= 0.03) { d.p.y = 0.03; if (Math.abs(d.v.y) > 1.5) { d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.p.y = 0.031; } } }
      const sc = d.life <= 0 ? 0 : Math.min(1, d.life * 2);
      _m.compose(d.p, _q.setFromEuler(_e.set(d.r.x, d.r.y, d.r.z)), _s.set(sc, sc, sc));
      this.deb.setMatrixAt(i, _m);
    }
    if (any) this.deb.instanceMatrix.needsUpdate = true;
    for (const t of this.tr) if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.m.visible = false; }
    for (const f of this.lights) { if (f.life > 0) { f.life -= dt; f.l.intensity = f.pow * Math.max(0, f.life / f.max); } else f.l.intensity = 0; }
  }
}
