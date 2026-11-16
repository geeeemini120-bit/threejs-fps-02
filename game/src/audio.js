// Sound, synthesized live with WebAudio: no audio files, no network, nothing to
// load. Every effect is a short node graph built once per play and thrown away.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, filterType, freq, gain, when = 0, sweepTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, when = 0, slideTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      // kind: 'pistol' | 'smg' | 'rifle' | 'enemy'
      if (kind === 'rifle') {
        noise(0.09, 'lowpass', 1800, 0.5, 0, 300);
        tone(160, 0.07, 'square', 0.22, 0, 60);
      } else if (kind === 'smg') {
        noise(0.06, 'bandpass', 2400, 0.35, 0, 900);
        tone(190, 0.05, 'square', 0.15, 0, 70);
      } else if (kind === 'pistol') {
        noise(0.08, 'lowpass', 1400, 0.45, 0, 250);
        tone(130, 0.06, 'square', 0.2, 0, 50);
      } else {
        noise(0.09, 'lowpass', 1200, 0.28, 0, 220);
      }
    },
    dryFire() {
      tone(1400, 0.03, 'square', 0.12);
    },
    reload() {
      tone(900, 0.04, 'square', 0.1);
      tone(600, 0.04, 'square', 0.1, 0.18);
      tone(1100, 0.05, 'square', 0.12, 0.55);
    },
    hit() {
      tone(2200, 0.05, 'sine', 0.2);
    },
    kill() {
      tone(1800, 0.06, 'sine', 0.22);
      tone(2600, 0.08, 'sine', 0.2, 0.06);
    },
    hurt() {
      tone(140, 0.12, 'sawtooth', 0.25, 0, 70);
      noise(0.1, 'lowpass', 500, 0.2);
    },
    grenadeThrow() {
      noise(0.15, 'bandpass', 900, 0.15, 0, 400);
    },
    explosion() {
      noise(0.7, 'lowpass', 900, 0.9, 0, 90);
      tone(70, 0.6, 'sine', 0.7, 0, 30);
      noise(0.25, 'highpass', 3000, 0.25);
    },
    plantBeep(final = false) {
      tone(final ? 1600 : 1100, 0.07, 'square', 0.16);
    },
    plantDone() {
      tone(880, 0.1, 'square', 0.18);
      tone(1320, 0.14, 'square', 0.18, 0.1);
    },
    defuseBeep() {
      tone(1500, 0.05, 'square', 0.14);
    },
    roundWin() {
      tone(523, 0.12, 'triangle', 0.25);
      tone(659, 0.12, 'triangle', 0.25, 0.12);
      tone(784, 0.22, 'triangle', 0.28, 0.24);
    },
    roundLose() {
      tone(392, 0.14, 'triangle', 0.22);
      tone(330, 0.14, 'triangle', 0.22, 0.14);
      tone(262, 0.26, 'triangle', 0.24, 0.28);
    },
    buy() {
      tone(1000, 0.05, 'square', 0.14);
      tone(1400, 0.06, 'square', 0.14, 0.05);
    },
    denied() {
      tone(220, 0.12, 'square', 0.16);
    },
    click() {
      tone(1200, 0.03, 'square', 0.1);
    },
  };
}
