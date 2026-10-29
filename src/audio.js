// Sound effects are synthesised with WebAudio: no sound files. The music is
// Steven's own tracks, played from main.js.

export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxVol = 8;
  }

  // Browsers only allow sound after a key press or tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.setSfxVolume(this.sfxVol);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'square', vol = 0.2, slide = null, delay = 0, out = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, sweep = null, out = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // Sound for one simulation event. `listener` is the spy whose ears we use;
  // things happening to the other spy elsewhere are played quieter.
  play(e, state, listener) {
    if (!this.ctx) return;
    const me = state.spies[listener];
    const mine = e.spy === listener;
    const nearby = e.room !== undefined ? e.room === me.room : mine;
    const v = mine || nearby ? 1 : 0.35;
    switch (e.type) {
      case 'search': if (mine) this.noise(0.35, { vol: 0.12 * v, freq: 2500, q: 0.8, sweep: 900 }); break;
      case 'empty': if (mine) { this.tone(330, 0.1, { vol: 0.1 }); this.tone(220, 0.16, { vol: 0.1, delay: 0.1 }); } break;
      case 'pickup':
        if (mine) [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { vol: 0.12, delay: i * 0.06, type: 'triangle' }));
        break;
      case 'trapset': if (mine) [0, 0.12, 0.24].forEach((d) => this.tone(1320, 0.07, { vol: 0.1, delay: d })); break; // three beeps [manual]
      case 'ui': if (mine) this.tone(900, 0.04, { vol: 0.08 }); break;
      case 'denied': if (mine) this.tone(110, 0.15, { vol: 0.12, type: 'sawtooth' }); break;
      case 'door': if (mine) this.noise(0.18, { vol: 0.08, freq: 400, sweep: 1600, q: 2 }); break;
      case 'meet':
        [196, 233, 277].forEach((f) => this.tone(f, 0.5, { vol: 0.07, type: 'sawtooth' }));
        break;
      case 'swing': if (nearby || mine) this.noise(e.heavy ? 0.22 : 0.1, { vol: 0.1, freq: 3000, sweep: 600, q: 1.5 }); break;
      case 'hit':
        this.tone(e.heavy ? 140 : 200, 0.15, { vol: 0.3 * v, type: 'sine', slide: 50 });
        this.noise(0.08, { vol: 0.2 * v, freq: 900 });
        break;
      case 'trap': this.trapSound(e.trap, v); break;
      case 'explode': this.trapSound('bomb', v); break;
      case 'tick': if (e.room === me.room) this.tone(e.left <= 3 ? 1500 : 1000, 0.04, { vol: 0.1, type: 'square' }); break;
      case 'death':
        [0, 1, 2, 3, 4, 5].forEach((i) => this.tone(523 * Math.pow(1.122, i * 2), 0.25, { vol: 0.06 * v, delay: 0.5 + i * 0.07, type: 'triangle' }));
        break;
      case 'hide': if (mine) { this.tone(500, 0.08, { vol: 0.1, type: 'triangle' }); this.tone(380, 0.12, { vol: 0.1, type: 'triangle', delay: 0.08 }); } break;
      case 'defuse': if (mine) { this.tone(880, 0.08, { vol: 0.1 }); this.tone(1320, 0.12, { vol: 0.1, delay: 0.08 }); } break;
      case 'guard':
        this.noise(0.12, { vol: 0.3 * v, freq: 300, type: 'lowpass' });
        this.tone(900, 0.5, { vol: 0.08 * v, type: 'sine', slide: 300, delay: 0.05 });
        break;
      case 'laugh': {
        // A wheezy "heh-heh-heh": your own laugh, or the rival's taunting you
        const lv = mine ? 0.13 : 0.08;
        const base = e.spy === 0 ? 330 : 260;
        for (let i = 0; i < 5; i++) {
          this.tone(base - i * 12, 0.11, { vol: lv, delay: i * 0.17, type: 'sawtooth', slide: (base - i * 12) * 0.8 });
          this.noise(0.09, { vol: lv * 0.6, freq: 1400, q: 2, delay: i * 0.17 });
        }
        break;
      }
      case 'lowtime': if (mine) this.tone(1760, 0.06, { vol: 0.06 }); break;
      case 'map': if (mine) this.noise(0.15, { vol: 0.08, freq: 5000, q: 0.5 }); break;
      case 'ko': this.tone(400, 0.6, { vol: 0.12 * v, type: 'square', slide: 80 }); break;
      case 'escape': if (mine) [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { vol: 0.12, delay: i * 0.12, type: 'square' })); break;
      case 'gameover':
        if (e.winner !== listener) [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.35, { vol: 0.1, delay: 0.4 + i * 0.3, type: 'sawtooth' }));
        break;
    }
  }

  trapSound(type, v) {
    switch (type) {
      case 'bomb':
        this.noise(1.2, { vol: 0.6 * v, freq: 800, type: 'lowpass', sweep: 60 });
        this.tone(90, 0.8, { vol: 0.4 * v, type: 'sine', slide: 30 });
        break;
      case 'spring':
        this.tone(200, 0.5, { vol: 0.2 * v, type: 'sine', slide: 900 });
        this.tone(900, 0.3, { vol: 0.12 * v, type: 'sine', slide: 300, delay: 0.25 });
        break;
      case 'bucket':
        this.noise(0.6, { vol: 0.35 * v, freq: 3000, type: 'highpass', sweep: 800 });
        this.tone(300, 0.15, { vol: 0.15 * v, type: 'triangle', slide: 120 });
        break;
      case 'gun':
        this.noise(0.3, { vol: 0.6 * v, freq: 1800, type: 'lowpass', sweep: 200 });
        break;
    }
  }

  // Sounds for the ending scene: engine starting, taxiing and climbing away, then a jingle with the rank.
  // won: true if the listener escaped, false if the rival did, null if nobody did.
  ending(won, E) {
    if (!this.ctx || won === null) return;
    const v = won ? 1 : 0.5;
    const start = E.board[1] + 0.2;
    this.tone(40, 0.6, { type: 'sawtooth', vol: 0.05 * v, slide: 70, delay: start });
    this.tone(70, E.takeoff[1] - start, { type: 'sawtooth', vol: 0.06 * v, slide: 190, delay: start + 0.5 });
    this.noise(E.takeoff[1] - start, { vol: 0.05 * v, freq: 300, type: 'lowpass', sweep: 900, delay: start + 0.5 });
    if (won) [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, { vol: 0.1, delay: E.rankAt + i * 0.11, type: 'triangle' }));
  }

  // Effects volume, 0 to 10. 8 is the original loudness.
  setSfxVolume(v) {
    this.sfxVol = v;
    if (this.sfx) this.sfx.gain.value = (v / 8) ** 2;
  }
}
