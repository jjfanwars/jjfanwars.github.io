// Map "Archive": single-storey ministry building in a walled compound.
import * as THREE from 'three';

export function buildMap(world, scene) {
  const W = world;
  const EXT = { t: 0.3, tex: 'brick', color: 0xffffff };
  const win = (at, b = true) => ({ at, kind: 'window', barricaded: b });
  const door = (at, w = 1, b = false) => ({ at, w, kind: 'door', barricaded: b });

  // ground
  W.addFloor(-32, -27, 32, 27, 'grass', 0, 0xffffff);
  W.addFloor(-21, -16, 21, 16, 'asphalt', 0.005, 0xffffff);
  // exterior walls (lining: which side is indoors)
  W.wall('hard', -15, -10, 15, -10, [win(-11.25), win(-4.25), win(3.25)], { ...EXT, lining: 1 });
  W.wall('hard', -15, 10, 15, 10, [door(-10.25, 1.5, true), win(-2.25), win(2.75), win(8.25), door(12.25, 1, true)], { ...EXT, lining: -1 });
  W.wall('hard', -15, -10, -15, 10, [win(-6.25), door(-0.25, 1, true), win(5.75)], { ...EXT, lining: 1 });
  W.wall('hard', 15, -10, 15, 10, [door(-0.25, 1, true), win(5.75)], { ...EXT, lining: -1 });
  // interior
  const P1 = 0xd9d3c3, P2 = 0xc9d2c4, P3 = 0xc8cdd6, P4 = 0xd8c9b4;
  W.wall('soft', -15, -2, -8, -2, [door(-11.25)], { color: P1 });
  W.wall('soft', -8, -2, -1, -2, [door(-4.25)], { color: P1 });
  W.wall('soft', -1, -2, 8, -2, [door(1.25)], { color: P2 });
  W.wall('hard', 8, -2, 15, -2, [door(10.25)], { color: 0xc9c6bd });
  W.wall('hard', -15, 1, -6, 1, [{ at: -10.25, w: 2.5, kind: 'arch' }], { color: 0xc9c6bd });
  W.wall('soft', -6, 1, 5, 1, [door(-0.75)], { color: P4 });
  W.wall('soft', 5, 1, 15, 1, [door(9.25)], { color: P3 });
  W.wall('soft', -8, -10, -8, -2, [], { color: P1 });
  W.wall('soft', -1, -10, -1, -2, [], { color: P2 });
  W.wall('soft', 8, -10, 8, -2, [door(-4.25)], { color: P2 });
  W.wall('hard', -6, 1, -6, 10, [door(6.25)], { color: 0xc9c6bd });
  W.wall('soft', 5, 1, 5, 10, [door(4.25)], { color: P3 });
  // floors
  W.addFloor(-15, -10, -8, -2, 'carpet');
  W.addFloor(-8, -10, -1, -2, 'woodFloor');
  W.addFloor(-1, -10, 8, -2, 'concrete', 0.01, 0xb0aca4);
  W.addFloor(8, -10, 15, -2, 'tiles', 0.01, 0xaab0b8);
  W.addFloor(-15, -2, 15, 1, 'tiles');
  W.addFloor(-15, 1, -6, 10, 'tiles', 0.01, 0xe6dccb);
  W.addFloor(-6, 1, 5, 10, 'woodFloor');
  W.addFloor(5, 1, 15, 10, 'tiles', 0.01, 0xd6d6d0);
  // ceiling + roof
  W.addFloor(-15, -10, 15, 10, 'ceiling', 2.995, 0xffffff, true);
  W.addBox(-15.5, 3, -10.5, 15.5, 3.35, 10.5, 'concrete', { color: 0x8d8a84 });

  // props: [x0,z0,x1,z1,h,tex,color,y0,metal]
  const WOOD = 0x8a6238, props = [
    [-13.5, -7.5, -11.5, -6.6, 0.78, 'woodFloor', WOOD], [-9.2, -9.6, -8.3, -7.6, 1.4, 'metal', 0x6f7a80],
    [-6, -6.6, -3, -5.4, 0.76, 'woodFloor', 0x6e4a2a],
    [0.6, -9.2, 1.1, -5.2, 2.2, 'metal', 0x58626a], [6.2, -9.2, 6.7, -5.5, 2.2, 'metal', 0x58626a],
    [2.6, -3.7, 3.6, -2.9, 1.0, 'crate'], [3.7, -3.6, 4.4, -2.9, 0.7, 'crate'],
    [9.5, -9.4, 10.3, -6.4, 2.1, 'metal', 0x2c3136], [11.7, -9.4, 12.5, -6.4, 2.1, 'metal', 0x2c3136], [13.9, -9.4, 14.7, -6.4, 2.1, 'metal', 0x2c3136],
    [-9.5, 3.5, -7, 4.4, 1.1, 'woodFloor', 0x5b3d22], [-14.6, 7.5, -14.0, 9.3, 0.45, 'woodFloor', WOOD],
    [-4.5, 7, -2.3, 7.9, 0.8, 'fabric', 0x5a3b33], [0.5, 7, 2.7, 7.9, 0.8, 'fabric', 0x5a3b33], [-1.6, 7.1, -0.4, 7.8, 0.42, 'woodFloor', 0x4a321c],
    [2.2, 2.2, 4.4, 2.9, 1.1, 'woodFloor', 0x4a321c],
    [14.2, 2, 14.84, 4.6, 0.92, 'metal', 0x9aa0a4], [8.5, 5.2, 11, 6.3, 0.92, 'metal', 0x9aa0a4], [5.3, 8.4, 6.2, 9.6, 1.9, 'metal', 0xc8ccd0],
    [3.4, 0.1, 4.2, 0.85, 0.9, 'crate'],
    // outside
    [-3, 16.5, -0.6, 22, 2.6, 'metal', 0x4a5338], [6, 14, 7.2, 15.2, 1.1, 'crate'], [7.3, 14.2, 8.3, 15.2, 1.0, 'crate'],
    [-14, 15, -11, 15.5, 1.0, 'concrete'], [-22, -4, -20.8, -2.8, 1.1, 'crate'], [-20, 3, -19.5, 6, 1.0, 'concrete'],
    [20, -8, 22.5, -2, 2.6, 'metal', 0x7a3b2a], [19, 4, 19.5, 7, 1.0, 'concrete'], [-2, -16, 2, -15.5, 1.0, 'concrete'], [9, -15, 10.2, -13.8, 1.1, 'crate'],
  ];
  for (const [x0, z0, x1, z1, h, tex, col] of props) W.addBox(x0, 0, z0, x1, h, z1, tex, { color: col ?? 0xffffff, kind: 'prop' });
  // perimeter
  for (const [x0, z0, x1, z1] of [[-32, -27, 32, -26.6], [-32, 26.6, 32, 27], [-32, -27, -31.6, 27], [31.6, -27, 32, 27]])
    W.addBox(x0, 0, z0, x1, 3.2, z1, 'concrete', { color: 0x9a968e });

  // bomb sites
  const sites = [
    { name: 'A', x: 4.6, z: -6, plant: { x: 4.6, z: -4.6 }, atkHold: [[2, -4], [5.4, -8.6], [0.2, -3.2]] },
    { name: 'B', x: 13.1, z: -3.9, plant: { x: 11.6, z: -3.6 }, atkHold: [[9, -5.2], [13.2, -8.8], [14.2, -2.8]] },
  ];
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x3a3f36, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2200, emissiveIntensity: 2 });
  for (const s of sites) {
    W.addBox(s.x - 0.3, 0, s.z - 0.3, s.x + 0.3, 0.9, s.z + 0.3, 'metal', { color: 0x59604c, kind: 'prop' });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lampMat);
    lamp.position.set(s.x, 0.95, s.z); W.root.add(lamp);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), bombMat);
    can.position.set(s.x + 0.12, 1.1, s.z - 0.1); can.rotation.z = Math.PI / 2; can.castShadow = true; W.root.add(can);
  }

  // room lights
  const rooms = [[-11.5, -6, 0xfff1dc], [-4.5, -6, 0xfff1dc], [3.5, -6, 0xe8f0ff], [11.5, -6, 0xcfe0ff], [-9, -0.5, 0xfff4e6], [0, -0.5, 0xfff4e6], [9, -0.5, 0xfff4e6], [-10.5, 5.5, 0xfff1dc], [-0.5, 5.5, 0xffe9cc], [10, 5.5, 0xf2f6ff]];
  const fixGeo = new THREE.BoxGeometry(1.2, 0.05, 0.3);
  for (const [x, z, col] of rooms) {
    const l = new THREE.PointLight(col, 14, 13, 1.6); l.position.set(x, 2.6, z); W.root.add(l);
    const f = new THREE.Mesh(fixGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 1.6 }));
    f.position.set(x, 2.96, z); W.root.add(f);
  }
  W.finalize();

  return {
    sites,
    atkSpawns: [
      { name: 'South yard', pts: [[2, 24], [4, 24.5], [6, 24], [3, 25.5], [5, 25.5]], yaw: 0 },
      { name: 'West gate', pts: [[-29, -2], [-29.5, 0], [-29, 2], [-30.5, -1], [-30.5, 1]], yaw: -Math.PI / 2 },
      { name: 'East gate', pts: [[29, -2], [29.5, 0], [29, 2], [30.5, -1], [30.5, 1]], yaw: Math.PI / 2 },
    ],
    defSpawns: [[3, -4.5], [6.5, -4], [10, -4.5], [12, -5.2], [5, -7.5]],
    // attacker entry routes: outside staging point, then inside point
    entries: [
      [[-10.25, 12.5], [-10.25, 6]], [[12.25, 12.5], [11, 8]], [[-17.5, -0.25], [-12, -0.5]],
      [[17.5, -0.25], [13, -0.5]], [[3.25, -12.5], [3.25, -8.2]], [[-2.25, 12.5], [-2.25, 8.6]], [[-4.25, -12.5], [-4.25, -8]],
    ],
    breaches: [
      { x: -1, z: -6.6, stand: [-1.75, -6.75], retreat: [-5.25, -8.25], site: 0 },
      { x: 12.25, z: 1, stand: [12.25, 1.75], retreat: [9.25, 4.25], site: 1 },
    ],
    reinforce: [[-1, -6.6], [-1, -8.5], [4, -2], [6.6, -2], [12.25, 1], [8, -8]],
    defBarricade: [[1.25, -2], [10.25, -2], [-4.25, -2], [9.25, 1]],
    holds: [
      [[6.9, -3], [1.25, -2]], [[7.2, -8.6], [3.25, -10]], [[13.2, -9.2], [10.25, -2]],
      [[14.3, -3], [10.25, -2]], [[14, -0.5], [-15, -0.5]], [[9, -3], [8, -4.25]],
    ],
    patrol: [[-1, 5], [-10.5, 5.5], [10, 4], [-4.5, -4], [-11.5, -4.5], [0, -0.5], [8, 7.5]],
  };
}
