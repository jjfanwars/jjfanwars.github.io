// Boot: renderer, lighting, post-processing, menu, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeTextures } from './textures.js';
import { makeEmblemCanvas } from './soldier.js';
import { AudioSys } from './audio.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Game } from './game.js';
import { PlayerCtl } from './player.js';
import { World } from './world.js';
import { buildMap } from './map.js';

const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const lowQ = qs.has('low');
renderer.setPixelRatio(Math.min(devicePixelRatio, lowQ ? 1 : 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8f9aa3, 45, 140);
const camera = new THREE.PerspectiveCamera(76, 1, 0.04, 300);
scene.add(camera);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

// sky dome
scene.add(new THREE.Mesh(new THREE.SphereGeometry(250, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, fog: false, depthWrite: false,
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'varying vec3 vP; void main(){ float h=clamp(vP.y,0.,1.); vec3 c=mix(vec3(.56,.62,.67),vec3(.24,.36,.52),pow(h,.55)); float s=pow(max(0.,dot(vP,normalize(vec3(.5,.75,.36)))),40.); gl_FragColor=vec4(c+vec3(1.,.85,.6)*s*.8,1.); }',
})));
const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
sun.position.set(26, 40, 19); sun.castShadow = true;
sun.shadow.mapSize.set(lowQ ? 2048 : 4096, lowQ ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 5, far: 110 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, new THREE.HemisphereLight(0xc4d2e0, 0x5a5348, 1.15));

const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: lowQ ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
if (!lowQ) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.6, 0.92));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+time)*43758.5453); }
    void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float l=dot(c,vec3(.299,.587,.114));
      c=mix(vec3(l),c,.86); c=(c-.5)*1.07+.5; c*=vec3(1.0,.99,.965);
      vec2 d=vUv-.5; c*=1.-dot(d,d)*.75; c+=(h(vUv*800.)-.5)*.022; gl_FragColor=vec4(c,1.); }`,
});
composer.addPass(grade);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const audio = new AudioSys(), fx = new FX(scene), hud = new HUD(camera);
const tex = makeTextures(renderer.capabilities.getMaxAnisotropy());
{ // the generated metal texture is very dark; lift it so tint colours read
  const c = tex.metal.map.image, x = c.getContext('2d'); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-over'; tex.metal.map.needsUpdate = true;
}
const game = new Game({ scene, camera, tex, fx, audio, hud });
const pc = game.pc = new PlayerCtl(game, camera, canvas);
window.__game = game;

// menu
let team = 0, paused = false;
const auto = qs.has('auto');
document.querySelectorAll('.fac').forEach((b, i) => {
  b.prepend(makeEmblemCanvas(i ? 'communist' : 'fascist', 96));
  b.onclick = () => { team = i; document.querySelectorAll('.fac').forEach((o, j) => o.classList.toggle('sel', j === i)); audio.resume(); audio.play('ui_click'); };
});
function start() {
  audio.resume();
  $('menu').style.display = 'none'; $('again').style.display = 'none'; hud.show(true);
  game.startMatch(team);
  if (auto) pc.fake = true; else canvas.requestPointerLock();
}
$('play').onclick = start;
$('again').onclick = () => { document.exitPointerLock(); game.phase = 'menu'; hud.show(false); $('menu').style.display = 'flex'; $('again').style.display = 'none'; $('banner').style.opacity = 0; };
$('pause').onclick = () => canvas.requestPointerLock();
canvas.onclick = () => { if (game.phase !== 'menu' && !pc.locked()) canvas.requestPointerLock(); };
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  paused = !locked && game.phase !== 'menu' && game.phase !== 'matchEnd' && !auto;
  $('pause').style.display = paused ? 'flex' : 'none';
});
$('sens').oninput = e => { pc.sens = 0.0022 * e.target.value; };
$('vol').oninput = e => audio.setVolume(+e.target.value);
if (auto) { team = +(qs.get('team') || 0); start(); }

// menu backdrop camera
let last = performance.now(), mt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game.phase === 'menu') {
    mt += dt * 0.08;
    camera.position.set(Math.cos(mt) * 30, 11, Math.sin(mt) * 30); camera.lookAt(0, 1.5, 0);
    if (!game.world) { game.world = new World(scene, tex, fx, audio); game.map = buildMap(game.world, scene); }
  } else if (!paused) game.update(dt);
  const f = new THREE.Vector3(); camera.getWorldDirection(f);
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z);
  grade.uniforms.time.value = now * 0.001 % 10;
  composer.render();
}
requestAnimationFrame(frame);
