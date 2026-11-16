// The arsenal: four buyable items with their own feel, and the grenade. A weapon
// is data plus a view model; main.js owns the ray, combat.js owns the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 2, price: 0,
    mag: 12, reserve: 36, damage: 24, headMult: 2, gap: 0.16, reload: 1.3,
    spreadStill: 0.003, spreadMove: 0.02, auto: false, kick: 0.006, range: 60,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', slot: 1, price: 1500,
    mag: 28, reserve: 84, damage: 20, headMult: 2, gap: 0.075, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.034, auto: true, kick: 0.004, range: 45,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', slot: 1, price: 2700,
    mag: 30, reserve: 90, damage: 34, headMult: 2, gap: 0.096, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, auto: true, kick: 0.009, range: 80,
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, maxCarry: 2 };
export const ARMOR = { id: 'armor', name: 'Plated Vest', price: 650, value: 50 };

export function createWeaponRig(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.25 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  // One view model per weapon, built from boxes; only the active one shows.
  function rifleModel() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    add(0.09, 0.1, 0.42, 0, 0, 0, light);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.38, dark);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.3, dark);
    add(0.02, 0.05, 0.06, 0, 0.07, -0.1, amber);
    return g;
  }
  function smgModel() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    add(0.08, 0.11, 0.34, 0, 0, 0, dark);
    add(0.04, 0.04, 0.3, 0, 0.02, -0.3, light);
    add(0.05, 0.14, 0.06, 0, -0.11, 0.05, dark);
    add(0.02, 0.04, 0.05, 0, 0.06, -0.08, amber);
    return g;
  }
  function pistolModel() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    add(0.05, 0.07, 0.24, 0, 0, 0, dark);
    add(0.045, 0.12, 0.06, 0, -0.08, 0.08, dark);
    add(0.015, 0.03, 0.04, 0, 0.05, -0.06, amber);
    return g;
  }

  const models = { rifle: rifleModel(), smg: smgModel(), pistol: pistolModel() };
  for (const key of Object.keys(models)) {
    models[key].position.set(0.24, -0.2, -0.42);
    models[key].visible = false;
    camera.add(models[key]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    mag: 12, reserve: 36,
    cooldown: 0, reloadLeft: 0, reloadTotal: 1,
    flash: 0, kick: 0, grenades: 0,
  };

  function equip(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    for (const key of Object.keys(models)) models[key].visible = key === id;
    state.current = id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    return true;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, ((state.reloadTotal - state.reloadLeft) / state.reloadTotal) * 2);
      if (state.reloadLeft === 0) {
        const def = WEAPONS[state.current];
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    step,
    equip,
    def() {
      return WEAPONS[state.current];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      state.reloadTotal = def.reload;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[state.current];
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    refillAmmo() {
      const def = WEAPONS[state.current];
      state.mag = def.mag;
      state.reserve = def.reserve;
    },
  };
}
