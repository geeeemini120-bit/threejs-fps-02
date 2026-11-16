// Collision and sight, shared by the player and every bot so the same rules move
// both: a capsule approximated by a box, resolved one axis at a time against the
// map's axis-aligned boxes, and a segment test for line of sight.
import * as THREE from 'three';

const RADIUS = 0.34;

// A moving body: feet position, velocity, height. move() slides it along walls.
export function createBody(colliders, x, z, height = 1.72) {
  const position = new THREE.Vector3(x, 0, z);
  const velocity = new THREE.Vector3();
  const probe = new THREE.Box3();
  let onGround = true;

  function overlaps(px, py, pz, h, lift) {
    probe.min.set(px - RADIUS, py + lift, pz - RADIUS);
    probe.max.set(px + RADIUS, py + h - lift, pz + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  return {
    position,
    velocity,
    height,
    get onGround() {
      return onGround;
    },
    // Horizontal move with wall sliding; vertical move lands on floors and ceilings.
    move(dt, gravity) {
      const nx = position.x + velocity.x * dt;
      if (!overlaps(nx, position.y, position.z, height, 0.04)) position.x = nx;
      else velocity.x = 0;
      const nz = position.z + velocity.z * dt;
      if (!overlaps(position.x, position.y, nz, height, 0.04)) position.z = nz;
      else velocity.z = 0;
      velocity.y -= gravity * dt;
      position.y += velocity.y * dt;
      onGround = false;
      const hit = overlaps(position.x, position.y, position.z, height, 0);
      if (hit && velocity.y <= 0) {
        position.y = hit.max.y;
        velocity.y = 0;
        onGround = true;
      } else if (hit) {
        position.y = hit.min.y - height;
        velocity.y = 0;
      }
      if (position.y < 0) {
        position.y = 0;
        velocity.y = 0;
        onGround = true;
      }
      velocity.y = Math.max(-30, velocity.y);
    },
    // True when nothing solid stands between the two points (eye to eye).
    hasLineOfSight(from, to) {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      if (len < 0.001) return true;
      dir.multiplyScalar(1 / len);
      // Slab test, segment against each box: cheap and exact enough for sight.
      for (let i = 0; i < colliders.length; i += 1) {
        const b = colliders[i];
        let tmin = 0;
        let tmax = len;
        let hit = true;
        const o = [from.x, from.y, from.z];
        const d = [dir.x, dir.y, dir.z];
        const mn = [b.min.x, b.min.y, b.min.z];
        const mx = [b.max.x, b.max.y, b.max.z];
        for (let a = 0; a < 3; a += 1) {
          if (Math.abs(d[a]) < 1e-9) {
            if (o[a] < mn[a] || o[a] > mx[a]) {
              hit = false;
              break;
            }
          } else {
            let t1 = (mn[a] - o[a]) / d[a];
            let t2 = (mx[a] - o[a]) / d[a];
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
            }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) {
              hit = false;
              break;
            }
          }
        }
        if (hit) return false;
      }
      return true;
    },
    overlapsAt(x, y, z, h) {
      return overlaps(x, y, z, h, 0.02);
    },
  };
}
