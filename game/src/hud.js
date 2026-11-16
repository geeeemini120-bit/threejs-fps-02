// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// bomb status, buy menu and every overlay. It never touches the simulation; main.js
// pushes numbers in and reads callbacks out. All updates are cached, so a steady
// frame writes nothing to the DOM.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

const BUY_ITEMS = [
  { id: 'rifle', key: '1', name: 'AR-77 Longshot', desc: 'Rifle · 30/90 · high damage', price: WEAPONS.rifle.price },
  { id: 'smg', key: '2', name: 'VK-9 Ripper', desc: 'SMG · 28/84 · fast fire', price: WEAPONS.smg.price },
  { id: 'armor', key: '3', name: 'Plated Vest', desc: 'Absorbs half of each hit', price: ARMOR.price },
  { id: 'grenade', key: '4', name: 'Frag Grenade', desc: 'Thrown · 90 damage in 5 m', price: GRENADE.price },
];

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const sub = el('overlay-sub');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammo = el('ammo');
  const weaponName = el('weapon-name');
  const healthFill = el('health-fill');
  const healthNum = el('health-num');
  const armorRow = el('armor-row');
  const armorNum = el('armor-num');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreV = el('score-v');
  const scoreC = el('score-c');
  const roundValue = el('round-value');
  const feed = el('feed');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const bombRow = el('bomb-row');
  const bombText = el('bomb-text');
  const bombBar = el('bomb-bar');
  const plantBar = el('plant-bar');
  const plantFill = el('plant-fill');
  const damageVignette = el('damage-vignette');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const buyList = el('buy-list');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastWeapon = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;

  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-item';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
    buyList.appendChild(row);
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        ammo.classList.toggle('empty', mag === 0);
      }
      if (name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
    },
    setHealth(health, armor) {
      if (health !== lastHealth) {
        lastHealth = health;
        healthFill.style.width = `${Math.max(0, health)}%`;
        healthNum.textContent = String(Math.ceil(health));
        healthFill.classList.toggle('low', health <= 30);
      }
      if (armor !== lastArmor) {
        lastArmor = armor;
        armorRow.style.display = armor > 0 ? 'flex' : 'none';
        armorNum.textContent = String(Math.ceil(armor));
      }
    },
    setMoney(value) {
      if (value !== lastMoney) {
        lastMoney = value;
        moneyValue.textContent = `$${value}`;
        buyMoney.textContent = `$${value}`;
      }
    },
    setTimer(text, danger) {
      if (text !== lastTimer) {
        lastTimer = text;
        timerValue.textContent = text;
        timerValue.classList.toggle('danger', danger);
      }
    },
    setScore(v, c, round) {
      const key = `${v}-${c}-${round}`;
      if (key !== lastScore) {
        lastScore = key;
        scoreV.textContent = String(v);
        scoreC.textContent = String(c);
        roundValue.textContent = `ROUND ${round}`;
      }
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageVignette.classList.remove('on'), 220);
    },
    feedKill(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<span class="${killerTeam === 'vanguard' ? 'feed-team' : 'feed-enemy'}">${killer}</span><span class="feed-x">${headshot ? '◉' : '✕'}</span><span class="${victim === 'You' ? 'feed-team' : 'feed-enemy'}">${victim}</span>`;
      feed.prepend(row);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => row.classList.add('fade'), 4200);
      setTimeout(() => row.remove(), 5000);
    },
    showBanner(titleText, subText, good) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.toggle('good', good);
      banner.classList.toggle('bad', !good);
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), 3400);
    },
    setBomb(text, frac) {
      bombRow.style.display = text ? 'flex' : 'none';
      if (text) {
        bombText.textContent = text;
        bombBar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      }
    },
    setPlant(frac) {
      if (frac === null) {
        plantBar.style.display = 'none';
        return;
      }
      plantBar.style.display = 'block';
      plantFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    showBuy(open) {
      buyMenu.hidden = !open;
      for (const row of buyList.children) {
        row.classList.toggle('afford', Number(row.querySelector('.buy-price').textContent.slice(1)) <= lastMoney);
      }
    },
    markBought(itemId) {
      const row = buyList.querySelector(`[data-item="${itemId}"]`);
      if (!row) return;
      row.classList.add('bought');
      setTimeout(() => row.classList.remove('bought'), 500);
    },
    showOverlay(mode, data) {
      const texts = {
        start: ['DUSTLINE', 'A desert outpost at dusk. Plant the spike, or wipe the other team. First to 5 rounds takes the match.', 'Click to play'],
        paused: ['Paused', 'Click to resume the round.', 'Click to resume'],
        roundEnd: [data?.title || 'Round over', data?.copy || '', 'Next round'],
        matchEnd: [data?.title || 'Match over', data?.copy || '', 'Play again'],
      };
      const [t, c, action] = texts[mode];
      title.textContent = t;
      copy.textContent = c;
      sub.textContent = data?.sub || '';
      play.textContent = action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyList.addEventListener('click', (event) => {
        const row = event.target.closest('.buy-item');
        if (row) handler(row.dataset.item);
      });
    },
  };
}
