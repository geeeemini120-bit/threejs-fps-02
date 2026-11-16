// The bots: four Vanguard teammates and five Crimson enemies. Each bot is a small
// state machine — route, hold, engage, investigate, plant, defuse — steering along
// the map's waypoints with the same collision body the player uses, and shooting
// hitscan bursts with a reaction time, so duels are won by aim, not by reflex alone.
import * as THREE from 'three';
import { createBody } from './physics.js';
import { PALETTE } from './palette.js';
import { pick, range, gauss } from './rng.js';

const NAMES = {
  vanguard: ['Falco', 'Rook', 'Ivy', 'Sable'],
  crimson: ['Vex', 'Onyx', 'Havoc', 'Mira', 'Dagger'],
};
const BOT_SPEED = 3.4;
const INVESTIGATE_SPEED = 4.6;
const STRAFE_SPEED = 2.2;

const sharedGeo = {
  body: new THREE.CylinderGeometry(0.34, 0.38, 1.0, 10),
  head: new THREE.SphereGeometry(0.22, 10, 8),
  gun: new THREE.BoxGeometry(0.08, 0.1, 0.62),
  visor: new THREE.BoxGeometry(0.3, 0.08, 0.05),
  ring: new THREE.RingGeometry(0.42, 0.52, 20),
};
const sharedMat = {
  helmet: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.7, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#14100d'), roughness: 0.8, metalness: 0.1 }),
  vanguard: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.team), roughness: 0.75, metalness: 0.1 }),
  crimson: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.75, metalness: 0.1 }),
  ringV: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.team), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  ringC: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemy), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
};

function sphereHit(origin, dir, center, radius) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

export function createBots(scene, map, random, hooks) {
  const colliders = map.colliders;
  const bots = [];

  function makeBot(team, index, name) {
    const group = new THREE.Group();
    const bodyMesh = new THREE.Mesh(sharedGeo.body, sharedMat[team]);
    bodyMesh.position.y = 0.95;
    const head = new THREE.Mesh(sharedGeo.head, sharedMat.helmet);
    head.position.y = 1.58;
    const visor = new THREE.Mesh(sharedGeo.visor, sharedMat[team]);
    visor.position.set(0, 1.58, -0.2);
    const gun = new THREE.Mesh(sharedGeo.gun, sharedMat.dark);
    gun.position.set(0.2, 1.15, -0.35);
    const ring = new THREE.Mesh(sharedGeo.ring, team === 'vanguard' ? sharedMat.ringV : sharedMat.ringC);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(bodyMesh, head, visor, gun, ring);
    group.visible = false;
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      group,
      body: createBody(colliders, 0, 0, 1.72),
      health: 100,
      alive: false,
      state: 'route',
      yaw: 0,
      route: [],
      routeIndex: 0,
      holdPoint: null,
      holdJitter: 0,
      target: null,
      targetPos: new THREE.Vector3(),
      reaction: 0,
      burstLeft: 0,
      burstTimer: 0,
      betweenTimer: 0,
      strafeDir: 1,
      strafeTimer: 0,
      investigatePos: null,
      stuckTimer: 0,
      lastPos: new THREE.Vector3(),
      channel: null, // { kind: 'plant'|'defuse', left: number, site: string }
      hasBomb: false,
      speed: BOT_SPEED,
      eyeY: 1.5,
    };
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('vanguard', i, NAMES.vanguard[i]);
  for (let i = 0; i < 5; i += 1) makeBot('crimson', i, NAMES.crimson[i]);

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const aimDir = new THREE.Vector3();

  function bodyCenter(bot) {
    return { x: bot.body.position.x, y: bot.body.position.y + 1.05, z: bot.body.position.z };
  }
  function headCenter(bot) {
    return { x: bot.body.position.x, y: bot.body.position.y + 1.58, z: bot.body.position.z };
  }

  function eyePos(bot) {
    eye.set(bot.body.position.x, bot.body.position.y + bot.eyeY, bot.body.position.z);
    return eye;
  }

  // The nearest living enemy the bot can actually see.
  function acquire(bot, player, now) {
    let best = null;
    let bestDist = 46;
    const candidates = [];
    if (player.state.alive) candidates.push({ kind: 'player', pos: player.state.position, eye: player.state.eye, ref: player });
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) {
        candidates.push({ kind: 'bot', pos: other.body.position, eye: 1.5, ref: other });
      }
    }
    for (const c of candidates) {
      const dx = c.pos.x - bot.body.position.x;
      const dz = c.pos.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) continue;
      // Bots only notice what is in front of them, unless it just fired nearby.
      const facing = { x: -Math.sin(bot.yaw), z: -Math.cos(bot.yaw) };
      const dot = (dx * facing.x + dz * facing.z) / (dist || 1);
      const heard = c.ref === player ? now - (player.lastShotAt || -99) < 0.4 && dist < 22 : false;
      if (dot < 0.2 && !heard) continue;
      const from = eyePos(bot);
      const to = new THREE.Vector3(c.pos.x, c.pos.y + c.eye, c.pos.z);
      if (!bot.body.hasLineOfSight(from, to)) continue;
      best = c;
      bestDist = dist;
    }
    return best;
  }

  function damage(bot, amount, isHead, attacker) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.channel) bot.channel = null;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.channel = null;
      bot.group.rotation.x = -Math.PI / 2;
      bot.group.position.y = 0.25;
      if (bot.hasBomb) {
        bot.hasBomb = false;
        hooks.onBombDrop({ x: bot.body.position.x, y: 0, z: bot.body.position.z });
      }
      hooks.onKill(attacker, bot, isHead);
    }
  }

  function fireAt(bot, target, now) {
    const from = eyePos(bot).clone();
    const isHead = random() < 0.12;
    const aim = isHead
      ? { x: target.pos.x, y: target.pos.y + 1.58, z: target.pos.z }
      : { x: target.pos.x, y: target.pos.y + 1.05, z: target.pos.z };
    const dist = from.distanceTo(new THREE.Vector3(aim.x, aim.y, aim.z));
    const targetSpeed = target.kind === 'player' ? Math.hypot(target.ref.state.velocity.x, target.ref.state.velocity.z) : 2;
    const spread = 0.014 + dist * 0.0006 + targetSpeed * 0.002;
    aimDir.set(aim.x - from.x, aim.y - from.y, aim.z - from.z).normalize();
    aimDir.x += gauss(random) * spread;
    aimDir.y += gauss(random) * spread;
    aimDir.z += gauss(random) * spread;
    aimDir.normalize();
    const to = from.clone().addScaledVector(aimDir, 80);
    hooks.onShot(bot, from, to, bot.team);
    // World first: a wall between bot and target eats the round.
    const wallHit = hooks.rayWorld(from, aimDir);
    // Then the target's own spheres.
    const bodyT = sphereHit(from, aimDir, aim.y > target.pos.y + 1.4 ? { x: aim.x, y: aim.y, z: aim.z } : { x: target.pos.x, y: target.pos.y + 1.05, z: target.pos.z }, 0.5);
    const headT = sphereHit(from, aimDir, { x: target.pos.x, y: target.pos.y + 1.58, z: target.pos.z }, 0.24);
    let t = -1;
    let head = false;
    if (headT >= 0 && (t < 0 || headT < t)) {
      t = headT;
      head = true;
    }
    if (bodyT >= 0 && (t < 0 || bodyT < t)) {
      t = bodyT;
      head = false;
    }
    if (t >= 0 && (wallHit < 0 || t < wallHit)) {
      const falloff = dist < 10 ? 1 : dist > 40 ? 0.6 : 1 - (dist - 10) * 0.0133;
      const dmg = (head ? 26 : 13) * falloff;
      if (target.kind === 'player') hooks.onPlayerDamage(dmg, bot, head);
      else damage(target.ref, dmg, head, bot);
      hooks.onHitConfirm(bot, target, head);
    }
  }

  function steer(bot, tx, tz, speed, dt) {
    const dx = tx - bot.body.position.x;
    const dz = tz - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    bot.body.velocity.x = (dx / dist) * speed;
    bot.body.velocity.z = (dz / dist) * speed;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.body.move(dt, 20);
    // Stuck: no progress for a while, sidestep around the obstacle.
    const moved = Math.hypot(bot.body.position.x - bot.lastPos.x, bot.body.position.z - bot.lastPos.z);
    if (moved < 0.05) {
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 1.2) {
        bot.stuckTimer = 0;
        bot.body.velocity.x = (-dz / dist) * speed * (random() < 0.5 ? 1 : -1);
        bot.body.velocity.z = (dx / dist) * speed * (random() < 0.5 ? 1 : -1);
        bot.body.move(dt, 20);
      }
    } else {
      bot.stuckTimer = 0;
    }
    bot.lastPos.copy(bot.body.position);
    return dist < 0.9;
  }

  function stepBot(bot, dt, world, now) {
    if (!bot.alive) return;
    const { player } = world;

    // Acquire a target first: combat overrides everything but a channel.
    const seen = acquire(bot, player, now);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reaction = 0.25 + random() * 0.35 + Math.hypot(seen.pos.x - bot.body.position.x, seen.pos.z - bot.body.position.z) * 0.004;
        bot.burstLeft = 0;
        bot.betweenTimer = 0;
      }
      bot.state = 'engage';
      bot.channel = null;
    } else if (bot.state === 'engage') {
      bot.target = null;
      bot.state = bot.investigatePos ? 'investigate' : 'route';
    }

    if (bot.state === 'engage' && bot.target) {
      const tp = bot.target.pos;
      bot.targetPos.set(tp.x, tp.y + 1.05, tp.z);
      toTarget.set(tp.x - bot.body.position.x, 0, tp.z - bot.body.position.z);
      bot.yaw = Math.atan2(-toTarget.x, -toTarget.z);
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.7 + random() * 0.8;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const strafe = bot.strafeDir * STRAFE_SPEED;
      const fx = -Math.sin(bot.yaw);
      const fz = -Math.cos(bot.yaw);
      bot.body.velocity.x = -fz * strafe;
      bot.body.velocity.z = fx * strafe;
      bot.body.move(dt, 20);
      if (bot.reaction > 0) {
        bot.reaction -= dt;
      } else if (bot.burstLeft > 0) {
        bot.burstTimer -= dt;
        if (bot.burstTimer <= 0) {
          bot.burstTimer = 0.09;
          bot.burstLeft -= 1;
          fireAt(bot, bot.target, now);
        }
      } else {
        bot.betweenTimer -= dt;
        if (bot.betweenTimer <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.betweenTimer = 0.5 + random() * 0.4;
        }
      }
    } else if (bot.state === 'investigate' && bot.investigatePos) {
      if (steer(bot, bot.investigatePos.x, bot.investigatePos.z, INVESTIGATE_SPEED, dt)) {
        bot.investigatePos = null;
        bot.state = 'route';
      }
    } else if (bot.state === 'hold' && bot.holdPoint) {
      // A planted bomb pulls every defender off their angle and onto the site.
      if (bot.team === 'crimson' && world.bombPlanted) {
        bot.state = 'route';
        bot.route = [];
        bot.routeIndex = 0;
      } else {
        bot.holdJitter -= dt;
        if (bot.holdJitter <= 0) {
          bot.holdJitter = 2 + random() * 3;
          bot.yaw = range(random, 0, Math.PI * 2);
        }
        bot.body.velocity.x = 0;
        bot.body.velocity.z = 0;
        bot.body.move(dt, 20);
      }
    } else if (bot.state === 'plant' || bot.state === 'defuse') {
      bot.body.velocity.x = 0;
      bot.body.velocity.z = 0;
      bot.body.move(dt, 20);
      if (bot.channel) {
        bot.channel.left -= dt;
        if (bot.channel.kind === 'plant') hooks.onPlantProgress(bot.channel.left);
        else hooks.onDefuseProgress(bot.channel.left);
        if (bot.channel.left <= 0) {
          const done = bot.channel;
          bot.channel = null;
          if (done.kind === 'plant') hooks.onPlantDone(done.site);
          else hooks.onDefuseDone();
          bot.state = 'route';
        }
      } else {
        bot.state = 'route';
      }
    } else {
      // Route: walk the waypoint list. A dropped bomb overrides the route for
      // Vanguard: the nearest living teammate goes and picks it up.
      if (bot.team === 'vanguard' && !bot.hasBomb && world.bombDropped) {
        if (steer(bot, world.bombDropped.x, world.bombDropped.z, INVESTIGATE_SPEED, dt)) {
          bot.hasBomb = true;
          hooks.onBombPickup(bot);
        }
      } else if (bot.routeIndex < bot.route.length) {
        const node = map.waypoints[bot.route[bot.routeIndex]];
        if (steer(bot, node[0], node[1], bot.speed, dt)) bot.routeIndex += 1;
      } else if (bot.team === 'vanguard' && bot.hasBomb) {
        // At the site with the bomb: plant it.
        const site = world.bombSite;
        if (site && map.sites[site].zone.containsPoint(new THREE.Vector3(bot.body.position.x, 0.5, bot.body.position.z))) {
          bot.state = 'plant';
          bot.channel = { kind: 'plant', left: 3, site };
          hooks.onPlantStart(site, bot);
        }
      } else if (bot.team === 'crimson' && world.bombPlanted) {
        // Bomb is down: push the site and defuse it.
        const site = map.sites[world.bombSite];
        if (site.zone.containsPoint(new THREE.Vector3(bot.body.position.x, 0.5, bot.body.position.z))) {
          bot.state = 'defuse';
          bot.channel = { kind: 'defuse', left: 5, site: world.bombSite };
          hooks.onDefuseStart(bot);
        } else {
          steer(bot, site.center.x, site.center.z, INVESTIGATE_SPEED, dt);
        }
      }
    }

    // Face movement direction when not engaging.
    bot.group.position.copy(bot.body.position);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    damage,
    bodyCenter,
    headCenter,
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    hearShot(pos, shooterTeam, now) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === shooterTeam || bot.state === 'engage') continue;
        const d = Math.hypot(bot.body.position.x - pos.x, bot.body.position.z - pos.z);
        if (d < 25) {
          bot.investigatePos = { x: pos.x + range(random, -2, 2), z: pos.z + range(random, -2, 2) };
          if (bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'investigate';
        }
      }
    },
    spawnRound(strategy, bombCarrier) {
      // strategy: 'A' | 'B' | 'mid' — the site Vanguard pushes this round.
      for (const bot of bots) {
        bot.alive = true;
        bot.health = 100;
        bot.state = 'route';
        bot.target = null;
        bot.channel = null;
        bot.hasBomb = false;
        bot.investigatePos = null;
        bot.group.rotation.x = 0;
        bot.group.position.y = 0;
        bot.group.visible = true;
        bot.speed = BOT_SPEED;
      }
      const vSpawns = map.spawns.vanguard;
      const cSpawns = map.spawns.crimson;
      bots.filter((b) => b.team === 'vanguard').forEach((bot, i) => {
        const s = vSpawns[i + 1];
        bot.body.position.set(s[0], 0, s[1]);
        bot.body.velocity.set(0, 0, 0);
        bot.lastPos.copy(bot.body.position);
        bot.yaw = 0;
        const route = strategy === 'A' ? map.routes.A : strategy === 'B' ? map.routes.B : map.routes.mid;
        bot.route = [...route];
        if (strategy === 'mid') {
          // Mid push splits: half peel to A, half to B after midTop.
          bot.route.push(...(i % 2 === 0 ? ['aEntry', 'aSite'] : ['bEntry', 'bSite']));
        }
        bot.routeIndex = 0;
      });
      bots.filter((b) => b.team === 'crimson').forEach((bot, i) => {
        const s = cSpawns[i];
        bot.body.position.set(s[0], 0, s[1]);
        bot.body.velocity.set(0, 0, 0);
        bot.lastPos.copy(bot.body.position);
        bot.yaw = Math.PI;
        // Two hold A, two hold B, one roams mid.
        if (i < 2) {
          bot.state = 'hold';
          bot.holdPoint = map.waypoints[i === 0 ? 'cA' : 'cAhold'];
          bot.body.position.set(map.waypoints[i === 0 ? 'cA' : 'cAhold'][0], 0, map.waypoints[i === 0 ? 'cA' : 'cAhold'][1]);
          bot.route = [];
        } else if (i < 4) {
          bot.state = 'hold';
          bot.holdPoint = map.waypoints[i === 2 ? 'cB' : 'cBhold'];
          bot.body.position.set(map.waypoints[i === 2 ? 'cB' : 'cBhold'][0], 0, map.waypoints[i === 2 ? 'cB' : 'cBhold'][1]);
          bot.route = [];
        } else {
          bot.state = 'hold';
          bot.holdPoint = map.waypoints.cMid;
          bot.body.position.set(map.waypoints.cMid[0], 0, map.waypoints.cMid[1]);
          bot.route = [];
        }
        bot.routeIndex = 0;
      });
      if (bombCarrier && bombCarrier !== 'player') {
        const carrier = bots.find((b) => b.id === bombCarrier);
        if (carrier) carrier.hasBomb = true;
      }
    },
    step(dt, world, now) {
      for (const bot of bots) stepBot(bot, dt, world, now);
    },
  };
}
