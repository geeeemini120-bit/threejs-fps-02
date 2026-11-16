// The player: acceleration, friction, gravity, crouch, jump and sprint, on the
// shared physics body, so the same collision rules move the player and the bots.
// Health and armour live here too; money and rounds live in state.js.
import * as THREE from 'three';
import { createBody } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 6.8;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const body = createBody(colliders, spawn[0], spawn[1], STAND_HEIGHT);
  const state = {
    position: body.position,
    velocity: body.velocity,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: 0,
    alive: true,
    hasBomb: false,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching && !body.overlapsAt(state.position.x, state.position.y, state.position.z, STAND_HEIGHT)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && forward > 0 && !state.crouching;
    const speed = state.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      state.velocity.y = JUMP_SPEED;
    }
    body.move(dt, GRAVITY);
  }

  // Damage first eats armour (half of each hit while any is left), then health.
  function damage(amount) {
    if (!state.alive) return 0;
    let left = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, left * 0.5);
      state.armor -= absorbed;
      left -= absorbed;
    }
    state.health -= left;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
    return left;
  }

  function reset(spawnPoint, keepBomb) {
    state.position.set(spawnPoint[0], 0, spawnPoint[1]);
    state.velocity.set(0, 0, 0);
    state.yaw = 0;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.crouching = false;
    state.height = STAND_HEIGHT;
    state.health = 100;
    state.armor = 0;
    state.alive = true;
    state.hasBomb = keepBomb;
  }

  return {
    state,
    step,
    look,
    recoil,
    damage,
    reset,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
