// DUSTLINE: boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate; the match (state.js) is the only store of rounds, money and the
// bomb, and main.js wires the player, the bots, the weapons and the HUD together.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createWeaponRig, WEAPONS, GRENADE, ARMOR } from './weapons.js';
import { createCombat } from './combat.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createMatch, ROUND_TIME, BUY_TIME, BOMB_FUSE } from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#241a12');
scene.fog = new THREE.Fog(new THREE.Color('#241a12'), 26, 72);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const match = createMatch();
const audio = createAudio();
const hud = createHud();
const player = createPlayer(map.colliders, map.spawns.vanguard[0]);
player.state.hasBomb = true;
const weapon = createWeaponRig(camera);
weapon.equip('pistol');
const combat = createCombat(scene, map.shootables, map.colliders);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let ownedPrimary = null;
let plantProgress = 0;
let plantingSite = null;
let spectateBot = null;
let shake = 0;
let beepTimer = 0;
let buyOpen = false;
let lastDryFire = -1;

const world = {
  player,
  bombPlanted: false,
  bombSite: null,
  bombDropped: null,
};

// --- bot hooks: the bots report, main.js decides what it means. ---
const hooks = {
  onShot(bot, from, to) {
    combat.fireTracer(from, to);
    audio.shot('enemy');
    bots.hearShot(from, bot.team, elapsed);
  },
  onKill(killer, victim, headshot) {
    const killerName = killer === 'player' ? 'You' : killer.name;
    hud.feedKill(killerName, victim.name, headshot, killer === 'player' || killer.team === 'vanguard' ? 'vanguard' : 'crimson');
    if (killer === 'player') {
      match.addMoney(300);
      match.state.kills += 1;
      audio.kill();
    }
  },
  onHitConfirm() {},
  onPlayerDamage(amount, attacker, head) {
    const dealt = player.damage(amount);
    if (dealt > 0) {
      hud.damageFlash();
      audio.hurt();
    }
    if (!player.state.alive) onPlayerDeath(attacker, head);
  },
  onPlantStart(site, bot) {
    hud.showBanner(`Spike planted at ${site}`, `${bot.name} planted the spike — defend it.`, true);
    audio.plantDone();
  },
  onPlantProgress(left) {
    hud.setPlant(1 - left / 3);
  },
  onPlantDone(site) {
    match.state.bomb = { state: 'planted', site, timer: BOMB_FUSE, carrier: null, pos: null };
    world.bombPlanted = true;
    world.bombSite = site;
    match.state.plants += 1;
    audio.plantDone();
  },
  onDefuseStart(bot) {
    hud.showBanner('Spike being defused', `${bot.name} is defusing the spike — stop them!`, false);
  },
  onDefuseProgress(left) {
    hud.setPlant(1 - left / 5);
  },
  onDefuseDone() {
    match.state.bomb = { state: 'defused', site: null, timer: 0, carrier: null, pos: null };
    world.bombPlanted = false;
    world.bombSite = null;
    match.state.defuses += 1;
    endRound('crimson', 'Spike defused');
  },
  onBombDrop(pos) {
    match.state.bomb = { state: 'dropped', site: null, timer: 0, carrier: null, pos };
    world.bombDropped = pos;
  },
  onBombPickup(bot) {
    match.state.bomb = { state: 'carried', site: null, timer: 0, carrier: bot.id, pos: null };
    world.bombDropped = null;
    hud.showBanner(`${bot.name} has the spike`, 'The spike is moving again.', true);
  },
  rayWorld(from, dir) {
    scene.updateMatrixWorld(true);
    raycaster.set(from, dir);
    const hit = raycaster.intersectObjects(map.shootables, false)[0];
    return hit ? hit.distance : -1;
  },
};
const bots = createBots(scene, map, random, hooks);

function onPlayerDeath(attacker, head) {
  match.state.deaths += 1;
  const name = attacker ? attacker.name : 'Crimson';
  hud.feedKill(name, 'You', head, 'crimson');
  audio.roundLose();
  if (player.state.hasBomb) {
    player.state.hasBomb = false;
    hooks.onBombDrop({ x: player.state.position.x, y: 0, z: player.state.position.z });
  }
  spectateBot = bots.bots.find((b) => b.alive && b.team === 'vanguard') || null;
  hud.showBanner('You are down', spectateBot ? `Spectating ${spectateBot.name} — your team fights on.` : 'Your team fights on.', false);
  if (document.pointerLockElement) document.exitPointerLock();
}

function teamAlive(team) {
  if (team === 'vanguard') return (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard');
  return bots.aliveCount('crimson');
}

function endRound(winner, reason) {
  if (!match.endRound(winner, reason)) return;
  hud.setPlant(null);
  hud.showBuy(false);
  buyOpen = false;
  const good = winner === 'vanguard';
  hud.showBanner(
    good ? 'Round won' : 'Round lost',
    `${reason} — Vanguard ${match.state.score.vanguard} : ${match.state.score.crimson} Crimson.`,
    good,
  );
  if (good) audio.roundWin();
  else audio.roundLose();
}

function startRoundNow() {
  const strategy = match.state.strategy;
  const carrier = player.state.alive ? 'player' : null;
  bots.spawnRound(strategy, carrier);
  player.reset(map.spawns.vanguard[0], true);
  player.state.hasBomb = carrier === 'player';
  spectateBot = null;
  plantProgress = 0;
  plantingSite = null;
  world.bombPlanted = false;
  world.bombSite = null;
  world.bombDropped = null;
  weapon.equip(ownedPrimary || 'pistol');
  weapon.refillAmmo();
  weapon.state.grenades = 0;
  hud.setPlant(null);
  hud.showBuy(true);
  buyOpen = true;
}

function beginRoundNow() {
  match.beginRound();
  hud.showBuy(false);
  buyOpen = false;
  hud.showBanner(`Round ${match.state.round}`, match.state.strategy === 'mid' ? 'Push mid — split to a site.' : `Push site ${match.state.strategy}.`, true);
}

function buyItem(id) {
  if (match.state.phase !== 'buy') {
    audio.denied();
    return;
  }
  if (id === 'rifle' || id === 'smg') {
    if (!match.spend(WEAPONS[id].price)) {
      audio.denied();
      return;
    }
    ownedPrimary = id;
    weapon.equip(id);
    weapon.refillAmmo();
  } else if (id === 'armor') {
    if (player.state.armor >= ARMOR.value || !match.spend(ARMOR.price)) {
      audio.denied();
      return;
    }
    player.state.armor = ARMOR.value;
  } else if (id === 'grenade') {
    if (weapon.state.grenades >= GRENADE.maxCarry || !match.spend(GRENADE.price)) {
      audio.denied();
      return;
    }
    weapon.state.grenades += 1;
  }
  audio.buy();
  hud.markBought(id);
}

hud.onBuy((id) => buyItem(id));

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'menu') {
    match.startMatch();
    startRoundNow();
    hud.hideOverlay();
    input.requestLock();
  } else if (match.state.phase === 'matchEnd') {
    match.startMatch();
    startRoundNow();
    hud.hideOverlay();
    input.requestLock();
  } else if (match.state.phase === 'roundEnd') {
    // The next round starts on its own timer; the button just re-locks.
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase === 'menu') {
    hud.showOverlay('start');
  } else if (match.state.phase === 'matchEnd') {
    // Leave the end screen up.
  } else if (!player.state.alive) {
    // Spectating: no overlay, the round plays on.
  } else {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  if (!player.state.alive && spectateBot) {
    const b = spectateBot.body.position;
    camera.position.set(b.x, b.y + 1.5, b.z);
    camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
    return;
  }
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.rotation.x += (random() - 0.5) * shake * 0.06;
    camera.rotation.y += (random() - 0.5) * shake * 0.06;
  }
}

function aimAt(point) {
  const p = player.state;
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function playerShoot() {
  if (!weapon.takeRound()) {
    if (weapon.state.reserve > 0) {
      if (weapon.reload()) audio.reload();
    } else {
      audio.dryFire();
    }
    return;
  }
  const def = weapon.def();
  camera.getWorldDirection(shootDir);
  const spread = weapon.spread(player.groundSpeed());
  shootDir.x += (random() * 2 - 1) * spread;
  shootDir.y += (random() * 2 - 1) * spread;
  shootDir.z += (random() * 2 - 1) * spread;
  shootDir.normalize();
  muzzle.copy(camera.position);
  const result = combat.shoot(muzzle, shootDir, bots.bots);
  player.lastShotAt = elapsed;
  bots.hearShot(player.state.position, 'vanguard', elapsed);
  audio.shot(def.id);
  weapon.pullTrigger();
  player.recoil(def.kick * (0.9 + random() * 0.2), (random() * 2 - 1) * def.kick * 0.35);
  if (result.hit) {
    const dmg = def.damage * (result.head ? def.headMult : 1);
    const wasAlive = result.bot.alive;
    bots.damage(result.bot, dmg, result.head, 'player');
    if (wasAlive) {
      hud.hitMarker(!result.bot.alive, 120);
      if (result.bot.alive) audio.hit();
    }
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
}

function throwPlayerGrenade() {
  if (weapon.state.grenades <= 0 || match.state.phase !== 'round') return;
  camera.getWorldDirection(shootDir);
  muzzle.copy(camera.position);
  if (combat.throwGrenade(muzzle, shootDir)) {
    weapon.state.grenades -= 1;
    audio.grenadeThrow();
  }
}

function explodeGrenade(point) {
  combat.burstSparks(point, 40);
  audio.explosion();
  shake = 1;
  const radius = 6;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.body.position.x - point.x, bot.body.position.z - point.z);
    if (d < radius) {
      const dmg = 90 - (d / radius) * 65;
      bots.damage(bot, dmg, false, 'player');
    }
  }
  const pd = Math.hypot(player.state.position.x - point.x, player.state.position.z - point.z);
  if (player.state.alive && pd < radius) {
    player.damage(90 - (pd / radius) * 65);
    hud.damageFlash();
    if (!player.state.alive) onPlayerDeath(null, false);
  }
  bots.hearShot(point, 'vanguard', elapsed);
}

function inSiteZone() {
  const p = player.state.position;
  for (const name of ['A', 'B']) {
    if (map.sites[name].zone.containsPoint(tmpVec.set(p.x, 0.5, p.z))) return name;
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;

  if (phase === 'buy') {
    match.state.timer -= dt;
    player.step(dt, input.state.keys);
    weapon.step(dt);
    if (match.state.timer <= 0) beginRoundNow();
  } else if (phase === 'round') {
    match.state.timer -= dt;
    // Planting: hold E inside a site while carrying the spike.
    const site = player.state.alive && player.state.hasBomb ? inSiteZone() : null;
    if (site && input.state.keys.has('KeyE')) {
      if (plantingSite !== site) {
        plantingSite = site;
        plantProgress = 0;
      }
      plantProgress += dt;
      hud.setPlant(plantProgress / 3);
      if (plantProgress >= 3) {
        plantProgress = 0;
        plantingSite = null;
        hud.setPlant(null);
        player.state.hasBomb = false;
        match.state.bomb = { state: 'planted', site, timer: BOMB_FUSE, carrier: null, pos: null };
        world.bombPlanted = true;
        world.bombSite = site;
        match.state.plants += 1;
        audio.plantDone();
        hud.showBanner(`Spike planted at ${site}`, 'Defend it for 35 seconds.', true);
      }
    } else {
      plantingSite = null;
      plantProgress = 0;
      if (match.state.bomb.state !== 'planted') hud.setPlant(null);
    }

    if (match.state.bomb.state === 'planted') {
      match.state.bomb.timer -= dt;
      beepTimer -= dt;
      if (beepTimer <= 0) {
        beepTimer = match.state.bomb.timer < 10 ? 0.45 : 1;
        audio.plantBeep(match.state.bomb.timer < 10);
      }
      if (match.state.bomb.timer <= 0) {
        const sitePos = map.sites[match.state.bomb.site].center;
        explodeGrenade(new THREE.Vector3(sitePos.x, 1, sitePos.z));
        endRound('vanguard', 'Spike detonated');
      }
    }

    if (player.state.alive) {
      player.step(dt, input.state.keys);
      const look = input.takeLook();
      player.look(look.x, look.y);
      if (input.state.firing) {
        if (weapon.ready()) playerShoot();
        else if (weapon.state.mag === 0 && weapon.state.reloadLeft === 0) {
          // An empty magazine reloads on the trigger pull instead of going silent:
          // ready() gates on mag > 0, so without this the auto-reload inside
          // playerShoot would never be reached.
          if (weapon.state.reserve > 0) {
            if (weapon.reload()) audio.reload();
          } else if (elapsed - lastDryFire > 0.4) {
            lastDryFire = elapsed;
            audio.dryFire();
          }
        }
      }
      if (input.pressed('KeyR') && weapon.reload()) audio.reload();
      if (input.pressed('Digit1') && ownedPrimary) {
        weapon.equip(ownedPrimary);
        audio.click();
      }
      if (input.pressed('Digit2')) {
        weapon.equip('pistol');
        audio.click();
      }
      if (input.pressed('KeyG')) throwPlayerGrenade();
    } else if (spectateBot && !spectateBot.alive) {
      spectateBot = bots.bots.find((b) => b.alive && b.team === 'vanguard') || null;
    }
    weapon.step(dt);
    bots.step(dt, world, elapsed);
    combat.stepGrenades(dt, explodeGrenade);

    // Round end conditions, checked after the world moves.
    if (match.state.phase === 'round') {
      if (teamAlive('crimson') === 0) endRound('vanguard', 'Enemy team eliminated');
      else if (teamAlive('vanguard') === 0) endRound('crimson', 'Your team was eliminated');
      else if (match.state.timer <= 0 && match.state.bomb.state !== 'planted') endRound('crimson', 'Time expired — the spike was never planted');
    }
  } else if (phase === 'roundEnd') {
    match.state.timer -= dt;
    weapon.step(dt);
    bots.step(dt, world, elapsed);
    if (match.state.timer <= 0) {
      if (match.matchOver()) {
        const winner = match.matchWinner();
        match.endMatch(winner);
        const v = match.state.score.vanguard;
        const c = match.state.score.crimson;
        hud.showOverlay('matchEnd', {
          title: winner === 'vanguard' ? 'Vanguard takes the match' : 'Crimson takes the match',
          copy: `Final score Vanguard ${v} : ${c} Crimson.`,
          sub: `Kills ${match.state.kills} · Deaths ${match.state.deaths} · Plants ${match.state.plants} · Defuses ${match.state.defuses}`,
        });
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        match.startRound();
        startRoundNow();
      }
    }
  }

  if (input.pressed('KeyB')) {
    if (match.state.phase === 'buy') {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen);
      audio.click();
    } else {
      audio.denied();
    }
  }
  if (match.state.phase === 'buy' && input.pressed('Digit1')) buyItem('rifle');
  if (match.state.phase === 'buy' && input.pressed('Digit2')) buyItem('smg');
  if (match.state.phase === 'buy' && input.pressed('Digit3')) buyItem('armor');
  if (match.state.phase === 'buy' && input.pressed('Digit4')) buyItem('grenade');

  combat.step(dt);
  shake = Math.max(0, shake - dt * 2.5);
  input.drainPressed();
  syncHud();
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function syncHud() {
  const m = match.state;
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(player.state.health, player.state.armor);
  hud.setMoney(m.money);
  hud.setScore(m.score.vanguard, m.score.crimson, m.round);
  if (m.phase === 'buy') hud.setTimer(`BUY ${fmtTime(m.timer)}`, false);
  else if (m.phase === 'round') {
    if (m.bomb.state === 'planted') hud.setTimer(fmtTime(m.bomb.timer), true);
    else hud.setTimer(fmtTime(m.timer), m.timer < 15);
  } else hud.setTimer('--:--', false);
  if (m.phase === 'menu' || m.phase === 'matchEnd') hud.setBomb(null, 0);
  else if (m.bomb.state === 'planted') hud.setBomb(`SPIKE PLANTED — ${fmtTime(m.bomb.timer)}`, m.bomb.timer / BOMB_FUSE);
  else if (m.bomb.state === 'carried' && player.state.hasBomb) hud.setBomb('YOU CARRY THE SPIKE — PLANT AT A OR B (HOLD E)', 1);
  else if (m.bomb.state === 'dropped') hud.setBomb('SPIKE DROPPED — A TEAMMATE WILL RECOVER IT', 1);
  else hud.setBomb(null, 0);
  const gap = 6 + weapon.spread(player.groundSpeed()) * 500 + player.groundSpeed() * 1.1;
  hud.setCrosshairGap(gap);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  if (name === 'start') {
    match.startMatch();
    startRoundNow();
    // A vista down mid: the two mid blocks, the silos, a bot crossing.
    player.state.position.set(0, 0, 12);
    player.state.yaw = 0;
    player.state.pitch = 0.02;
    settle(30);
    hud.showOverlay('start');
  } else if (name === 'play') {
    match.startMatch();
    startRoundNow();
    match.beginRound();
    hud.showBuy(false);
    player.state.position.set(0, 0, 4);
    player.state.yaw = 0;
    player.state.pitch = 0;
    const foes = bots.bots.filter((b) => b.team === 'crimson');
    foes[0].body.position.set(0, 0, -4);
    foes[0].body.velocity.set(0, 0, 0);
    foes[1].body.position.set(3.5, 0, -7);
    foes[1].body.velocity.set(0, 0, 0);
    foes[2].body.position.set(-3.5, 0, -6);
    foes[2].body.velocity.set(0, 0, 0);
    settle(8);
    // Fire until the nearest foe drops, then hold the frame on the hitmarker.
    for (let i = 0; i < 12 && foes[0].alive; i += 1) {
      const target = foes[0].alive ? foes[0] : foes[1];
      aimAt(new THREE.Vector3(target.body.position.x, target.body.position.y + 1.2, target.body.position.z));
      if (weapon.ready()) playerShoot();
      settle(6);
    }
    settle(6);
    aimAt(new THREE.Vector3(foes[1].body.position.x, foes[1].body.position.y + 1.2, foes[1].body.position.z));
  } else if (name === 'buy') {
    match.startMatch();
    startRoundNow();
    player.state.position.set(0, 0, 12);
    player.state.yaw = 0;
    settle(20);
    hud.showBuy(true);
  } else if (name === 'end') {
    match.startMatch();
    match.state.score.vanguard = 5;
    match.state.score.crimson = 2;
    match.state.round = 7;
    match.state.kills = 11;
    match.state.deaths = 4;
    match.state.plants = 2;
    match.endMatch('vanguard');
    player.state.position.set(4, 0, 10);
    player.state.yaw = 0.6;
    settle(20);
    hud.showOverlay('matchEnd', {
      title: 'Vanguard takes the match',
      copy: 'Final score Vanguard 5 : 2 Crimson.',
      sub: 'Kills 11 · Deaths 4 · Plants 2 · Defuses 0',
    });
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
