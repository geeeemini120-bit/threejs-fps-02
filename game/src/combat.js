// Combat effects and resolution: the player's hitscan ray, pooled tracers and
// impact sparks, and the thrown grenade. No new objects in the hot loops: the
// tracer pool and the spark pool are allocated once and reused.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_MAX = 24;
const SPARK_MAX = 240;

export function createCombat(scene, shootables, colliders) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;

  // Tracers: thin stretched boxes, one per shot, fading over 70 ms.
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, left: 0 });
  }
  let tracerIndex = 0;

  // Sparks: one Points cloud, positions rewritten per burst.
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_MAX * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0.95, depthWrite: false });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkVel = new Float32Array(SPARK_MAX * 3);
  let sparkHead = 0;
  let sparkLife = 0;

  const tmpDir = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();

  function fireTracer(from, to) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_MAX;
    const len = from.distanceTo(to);
    tmpMid.addVectors(from, to).multiplyScalar(0.5);
    t.mesh.position.copy(tmpMid);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.max(len, 0.1));
    t.mesh.visible = true;
    t.left = 0.07;
  }

  function burstSparks(point, count, color = null) {
    if (color) sparkMat.color.set(color);
    for (let i = 0; i < count; i += 1) {
      const j = sparkHead * 3;
      sparkPos[j] = point.x;
      sparkPos[j + 1] = point.y;
      sparkPos[j + 2] = point.z;
      sparkVel[j] = (Math.random() - 0.5) * 4;
      sparkVel[j + 1] = Math.random() * 3;
      sparkVel[j + 2] = (Math.random() - 0.5) * 4;
      sparkHead = (sparkHead + 1) % SPARK_MAX;
    }
    sparkLife = 0.4;
    sparkGeo.attributes.position.needsUpdate = true;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.left > 0) {
        t.left -= dt;
        if (t.left <= 0) t.mesh.visible = false;
      }
    }
    if (sparkLife > 0) {
      sparkLife -= dt;
      for (let i = 0; i < SPARK_MAX; i += 1) {
        const j = i * 3;
        sparkPos[j] += sparkVel[j] * dt;
        sparkPos[j + 1] += sparkVel[j + 1] * dt;
        sparkPos[j + 2] += sparkVel[j + 2] * dt;
        sparkVel[j + 1] -= 9 * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkMat.opacity = Math.max(0, sparkLife / 0.4) * 0.95;
    }
  }

  // The player's shot: ray against the world, then against each living bot's
  // head and body spheres. Returns { hit, bot, head, point, wallDist }.
  function shoot(origin, direction, bots) {
    scene.updateMatrixWorld(true);
    raycaster.set(origin, direction);
    const wallHit = raycaster.intersectObjects(shootables, false)[0];
    const wallDist = wallHit ? wallHit.distance : Infinity;
    let best = null;
    let bestDist = wallDist;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const px = bot.body.position.x;
      const py = bot.body.position.y;
      const pz = bot.body.position.z;
      for (const [cy, r, head] of [[py + 1.58, 0.24, true], [py + 1.05, 0.5, false]]) {
        tmpDir.set(px - origin.x, cy - origin.y, pz - origin.z);
        const tca = tmpDir.dot(direction);
        if (tca < 0) continue;
        const d2 = tmpDir.lengthSq() - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t > 0 && t < bestDist) {
          bestDist = t;
          best = { bot, head, point: origin.clone().addScaledVector(direction, t) };
        }
      }
    }
    const end = origin.clone().addScaledVector(direction, Math.min(bestDist, 90));
    fireTracer(origin, end);
    if (best) return { hit: true, ...best, wallDist };
    if (wallHit) {
      burstSparks(wallHit.point, 6);
      return { hit: false, point: wallHit.point, wallDist };
    }
    return { hit: false, point: end, wallDist };
  }

  // A thrown grenade: gravity, one bounce off the world, then a fuse pop.
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, vel: new THREE.Vector3(), fuse: 0, bounced: false });
  }

  function throwGrenade(origin, direction) {
    const g = grenades.find((x) => !x.active);
    if (!g) return false;
    g.active = true;
    g.fuse = 2.5;
    g.bounced = false;
    g.mesh.visible = true;
    g.mesh.position.copy(origin);
    g.vel.copy(direction).multiplyScalar(16);
    g.vel.y += 3.5;
    return true;
  }

  // Returns the explosion point when a fuse pops, else null.
  function stepGrenades(dt, onExplode) {
    for (const g of grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      const p = g.mesh.position;
      const nx = p.x + g.vel.x * dt;
      const nz = p.z + g.vel.z * dt;
      const ny = p.y + g.vel.y * dt;
      let bounced = false;
      for (const c of colliders) {
        if (nx > c.min.x - 0.09 && nx < c.max.x + 0.09 && ny > c.min.y - 0.09 && ny < c.max.y + 0.09 && nz > c.min.z - 0.09 && nz < c.max.z + 0.09) {
          bounced = true;
          break;
        }
      }
      if (bounced) {
        if (g.bounced) {
          g.fuse = Math.min(g.fuse, 0.4);
        } else {
          g.bounced = true;
          g.vel.multiplyScalar(0.45);
          g.vel.y = Math.abs(g.vel.y) * 0.5 + 1.5;
        }
      } else {
        p.x = nx;
        p.z = nz;
        p.y = Math.max(ny, 0.09);
        if (ny < 0.09) {
          g.vel.y = Math.abs(g.vel.y) * 0.4;
          if (!g.bounced) g.bounced = true;
        }
      }
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        onExplode(p.clone());
      }
    }
  }

  return { step, shoot, fireTracer, burstSparks, throwGrenade, stepGrenades };
}
