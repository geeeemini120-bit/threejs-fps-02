// The match, kept in one place: phase, round, score, money, timer and the bomb.
// Everything that reads the match reads it here; nothing else keeps a copy.
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const BOMB_FUSE = 35;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 9;

export function createMatch() {
  const state = {
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    round: 0,
    score: { vanguard: 0, crimson: 0 },
    money: 800,
    timer: 0,
    bomb: { state: 'carried', site: null, timer: 0, carrier: 'player', pos: null },
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    strategy: 'A',
    lastReason: '',
    winner: null,
  };

  return {
    state,
    startMatch() {
      state.phase = 'buy';
      state.round = 0;
      state.score.vanguard = 0;
      state.score.crimson = 0;
      state.money = 800;
      state.kills = 0;
      state.deaths = 0;
      state.plants = 0;
      state.defuses = 0;
      state.winner = null;
      state.lastReason = '';
      this.startRound();
    },
    startRound() {
      state.round += 1;
      state.phase = 'buy';
      state.timer = BUY_TIME;
      state.bomb = { state: 'carried', site: null, timer: 0, carrier: 'player', pos: null };
      state.strategy = ['A', 'B', 'mid'][Math.floor(Math.random() * 3)];
    },
    beginRound() {
      state.phase = 'round';
      state.timer = ROUND_TIME;
    },
    endRound(winner, reason) {
      if (state.phase !== 'round') return false;
      state.phase = 'roundEnd';
      state.timer = 4;
      state.score[winner] += 1;
      state.lastReason = reason;
      state.money += winner === 'vanguard' ? 3250 : 1900;
      return true;
    },
    endMatch(winner) {
      state.phase = 'matchEnd';
      state.winner = winner;
    },
    matchOver() {
      return state.score.vanguard >= ROUNDS_TO_WIN || state.score.crimson >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS;
    },
    matchWinner() {
      if (state.score.vanguard > state.score.crimson) return 'vanguard';
      if (state.score.crimson > state.score.vanguard) return 'crimson';
      return null;
    },
    addMoney(amount) {
      state.money = Math.max(0, state.money + amount);
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
  };
}
