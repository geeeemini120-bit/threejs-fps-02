// DUSTLINE: a desert outpost at dusk, three lanes between two bomb sites.
// Vanguard spawns south (z +), Crimson north (z -). Site A is west, site B east.
// Every box is a collider for players and bots and a surface a bullet stops on.
// Plain geometry only, no models, no textures: the palette does the work.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 4.5;

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {};
  for (const name of Object.keys(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.95,
      metalness: 0.02,
    });
  }
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.site),
    emissive: new THREE.Color(PALETTE.site),
    emissiveIntensity: 0.7,
    roughness: 0.6,
  });
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), fog: false });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat[material]);
    mesh.position.set(x, y, z);
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and outer walls: 46 x 34 m, open to the dusk sky.
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'concrete');
  box(46.4, WALL_H, 0.4, 0, WALL_H / 2, -17.2, 'surface');
  box(46.4, WALL_H, 0.4, 0, WALL_H / 2, 17.2, 'surface');
  box(0.4, WALL_H, 34.4, -23.2, WALL_H / 2, 0, 'surface');
  box(0.4, WALL_H, 34.4, 23.2, WALL_H / 2, 0, 'surface');

  // Mid structure: two blocks with a doorway between them and flanks around them.
  box(2.4, 3.2, 6, -3.2, 1.6, 0, 'slate');
  box(2.4, 3.2, 6, 3.2, 1.6, 0, 'slate');
  box(2.4, 0.5, 6, -3.2, 3.45, 0, 'rust');
  box(2.4, 0.5, 6, 3.2, 3.45, 0, 'rust');

  // Site A (west): raised pad, container wall, crates.
  box(6, 0.5, 5, -16, 0.25, -8, 'sand');
  box(3, 2.4, 1.2, -16, 1.2, -11.5, 'rust');
  box(1.2, 1.1, 1.2, -18.6, 0.55, -6, 'slate');
  box(1.2, 1.1, 1.2, -13.4, 0.55, -10, 'slate');
  box(1.2, 2.2, 1.2, -19.5, 1.1, -9.5, 'concrete');

  // Site B (east): container stack, crates.
  box(6, 0.5, 5, 16, 0.25, -8, 'sand');
  box(4, 2.4, 1.2, 16, 1.2, -11, 'rust');
  box(4, 1.2, 1.2, 16, 3.0, -11, 'slate');
  box(1.2, 1.1, 1.2, 18.6, 0.55, -6, 'slate');
  box(1.2, 1.1, 1.2, 13.4, 0.55, -10, 'slate');

  // Site entry cover walls: the corners you peek around.
  box(4, 3, 0.4, -6, 1.5, -10, 'surface');
  box(4, 3, 0.4, 6, 1.5, -10, 'surface');
  box(0.4, 3, 4, -12, 1.5, -4, 'surface');
  box(0.4, 3, 4, 12, 1.5, -4, 'surface');

  // Lane crates: crouch cover down both longs and mid.
  box(1.2, 1.1, 1.2, -19, 0.55, 4, 'slate');
  box(1.2, 1.1, 1.2, 19, 0.55, 4, 'slate');
  box(1.2, 1.1, 1.2, -9, 0.55, 6, 'slate');
  box(1.2, 1.1, 1.2, 9, 0.55, 6, 'slate');
  box(1.2, 1.1, 1.2, -9, 0.55, -4, 'slate');
  box(1.2, 1.1, 1.2, 9, 0.55, -4, 'slate');
  box(2.4, 0.9, 1.2, -2.4, 0.45, 10, 'slate');
  box(2.4, 0.9, 1.2, 2.4, 0.45, 10, 'slate');
  box(1.6, 0.7, 1.6, -19, 0.35, -12, 'concrete');
  box(1.6, 0.7, 1.6, 19, 0.35, -12, 'concrete');

  // Silos in the north corners: tall cylinders, boxy colliders.
  for (const sx of [-20, 20]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 6, 12), mat.slate);
    silo.position.set(sx, 3, -14);
    group.add(silo);
    colliders.push(new THREE.Box3(new THREE.Vector3(sx - 2, 0, -16), new THREE.Vector3(sx + 2, 6, -12)));
    shootables.push(silo);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 12), mat.rust);
    cap.position.set(sx, 6.1, -14);
    group.add(cap);
  }

  // Bomb pads: glowing strips on each site, plus corner posts so the site reads.
  const sites = {};
  for (const [name, cx] of [['A', -16], ['B', 16]]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 4.4), siteMat);
    pad.position.set(cx, 0.56, -8);
    group.add(pad);
    for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), siteMat);
      post.position.set(cx + px, 0.8, -8 + pz);
      group.add(post);
    }
    sites[name] = {
      center: new THREE.Vector3(cx, 0, -8),
      zone: new THREE.Box3(new THREE.Vector3(cx - 2.2, 0, -10.2), new THREE.Vector3(cx + 2.2, 3, -5.8)),
    };
  }

  // A low sun disc in the west sky: the dusk the palette is built on.
  const sun = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), sunMat);
  sun.position.set(-40, 9, -30);
  sun.lookAt(0, 2, 0);
  group.add(sun);

  // Light: warm low sun from the west, cool sky fill, no shadows (SwiftShader is slow).
  const sky = new THREE.HemisphereLight(new THREE.Color('#f2c98a'), new THREE.Color('#241a12'), 1.15);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffc27a'), 2.4);
  key.position.set(-18, 12, 6);
  key.target.position.set(0, 0, -4);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a8ba0'), 0.5);
  fill.position.set(10, 9, 12);
  scene.add(fill);

  // Waypoints: the routes bots walk. Keys are nodes, values are [x, z] on the floor.
  const waypoints = {
    vSpawn: [0, 14.5],
    vA: [-14, 10],
    vMid: [0, 8],
    vB: [14, 10],
    aLong: [-19, 4],
    aLong2: [-19, -4],
    aEntry: [-13, -5],
    aSite: [-16, -8],
    midBot: [0, 4],
    midTop: [0, -2],
    bLong: [19, 4],
    bLong2: [19, -4],
    bEntry: [13, -5],
    bSite: [16, -8],
    cSpawn: [0, -14.5],
    cA: [-12, -11],
    cB: [12, -11],
    cMid: [0, -7],
    cAhold: [-13, -6],
    cBhold: [13, -6],
  };
  const routes = {
    A: ['vSpawn', 'vA', 'aLong', 'aLong2', 'aEntry', 'aSite'],
    B: ['vSpawn', 'vB', 'bLong', 'bLong2', 'bEntry', 'bSite'],
    mid: ['vSpawn', 'vMid', 'midBot', 'midTop'],
  };

  return {
    colliders,
    shootables,
    sites,
    routes,
    waypoints,
    spawns: {
      vanguard: [[0, 14.5], [-4, 14.5], [-2, 14.5], [2, 14.5], [4, 14.5]],
      crimson: [[0, -14.5], [-4, -14.5], [-2, -14.5], [2, -14.5], [4, -14.5]],
    },
  };
}
