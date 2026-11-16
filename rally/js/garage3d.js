'use strict';
// Menu garage: a turntable preview of the selected car in its own small renderer (stops while a stage runs).
const Garage3D = {
  init(canvas) {
    let R; try { R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { return; }
    this.R = R; R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.95; R.outputColorSpace = THREE.SRGBColorSpace;
    const sc = this.scene = new THREE.Scene();
    // soft studio environment for the clearcoat paint
    const env = new THREE.Scene(), sky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    const cols = [], pos = sky.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10, k = y > 0 ? 0.08 + y * 0.7 : 0.02; cols.push(k, k * 0.97, k * 0.9); }
    sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); env.add(sky);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(14, 2), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(0, 7, 0); strip.rotation.x = Math.PI / 2; env.add(strip);
    const pm = new THREE.PMREMGenerator(R); sc.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
    sc.add(new THREE.HemisphereLight(0xfff4e0, 0x202018, 1.2 * Math.PI * 0.35));
    const key = new THREE.DirectionalLight(0xffe7c4, 2.2 * Math.PI * 0.35); key.position.set(4, 6, 3); sc.add(key);
    const rim = new THREE.DirectionalLight(0xf2b632, 1.4 * Math.PI * 0.35); rim.position.set(-5, 2, -4); sc.add(rim);
    // floor disc with a soft contact shadow
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const x = fc.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(0.45, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = -0.62; sc.add(sh);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.05, 3.12, 96), new THREE.MeshBasicMaterial({ color: 0xf2b632, transparent: true, opacity: 0.35 })); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.615; sc.add(ring);
    this.cam = new THREE.PerspectiveCamera(30, 2, 0.1, 100);
    this.rot = 0.75; this.spin = 0.35; this.drag = null; this.on = true;
    canvas.addEventListener('pointerdown', e => { this.drag = e.clientX; this.idle = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (this.drag === null) return; this.rot += (e.clientX - this.drag) * 0.012; this.drag = e.clientX; });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.idle = 9; this.last = performance.now();
    const loop = now => { requestAnimationFrame(loop); this.frame(now); }; requestAnimationFrame(loop);
  },
  show(look, color) {
    if (!this.R) return;
    if (this.view) { this.scene.remove(this.view.g); this.view.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    try { const ci = CARS.findIndex(c => c.look === look); if (ci >= 0) applyCar(ci); this.view = new CarView(this.scene, { color, remote: true, look }); } catch (e) { this.view = null; return; }
    for (const k of ['drv', 'nav']) if (this.view.crew && this.view.crew[k]) this.view.crew[k].g.visible = false;
    // wheels at ride height, and the car lowered or raised so its tyres sit on the turntable
    const v = this.view; let ground = 0; for (const w of v.wheels || []) { w.g.position.set(w.a.x, w.a.y - (v.crest - 0.12) - (v.cr - w.rv), w.a.z); w.g.rotation.y = 0; ground = w.a.y - (v.crest - 0.12) - v.cr; } this.lift = -0.66 - ground;
    this.pop = 0;
  },
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (!this.R || !this.on || !this.view) return;
    const c = this.R.domElement, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    if (c.width !== Math.round(w * this.R.getPixelRatio()) || c.height !== Math.round(h * this.R.getPixelRatio())) { this.R.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
    this.idle += dt; if (this.drag === null && this.idle > 1.5) this.rot += dt * this.spin;
    this.pop = Math.min(1, (this.pop || 0) + dt * 3); const p = 1 - (1 - this.pop) ** 3;
    this.view.g.rotation.y = this.rot; this.view.g.position.y = (1 - p) * 0.25 + (this.lift || 0); this.view.g.scale.setScalar((0.92 + p * 0.08) * Math.min(1, 2.45 / Math.max(2.06, CAR.hl)));
    const d = 7.4; this.cam.position.set(0, 1.35, d); this.cam.lookAt(0, 0.1, 0);
    this.R.render(this.scene, this.cam);
  }
};
