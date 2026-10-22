/** Синтезированные звуки на WebAudio — без внешних файлов. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  volume = 0.7;
  muted = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume * 0.55;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.55;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume * 0.55;
  }

  private noiseBurst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filter).connect(g).connect(p).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(g).connect(p).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  /** k — вид события, dist — расстояние до источника, pan — -1..1. */
  play(k: string, dist = 0, pan = 0) {
    if (this.muted) return;
    const now = performance.now();
    const minGap = k === 'hit' || k === 'chvak' ? 18 : 32;
    const prev = this.last.get(k) ?? 0;
    if (now - prev < minGap) return;
    this.last.set(k, now);
    this.init();
    if (!this.ctx || !this.master) return;
    const att = 1 / (1 + Math.max(0, dist) / 430);
    if (att < 0.045) return;

    switch (k) {
      case 'shot_pistol':
        this.noiseBurst(0.11, 2400, 0.5 * att, 'bandpass', pan);
        this.tone(150, 0.1, 0.32 * att, 'square', 60, pan);
        break;
      case 'shot_smg':
        this.noiseBurst(0.075, 3000, 0.34 * att, 'bandpass', pan);
        this.tone(190, 0.06, 0.2 * att, 'square', 80, pan);
        break;
      case 'shot_shotgun':
        this.noiseBurst(0.24, 1500, 0.7 * att, 'lowpass', pan);
        this.tone(95, 0.2, 0.45 * att, 'sawtooth', 45, pan);
        break;
      case 'shot_rifle':
        this.noiseBurst(0.16, 3800, 0.55 * att, 'bandpass', pan);
        this.tone(130, 0.14, 0.4 * att, 'square', 50, pan);
        break;
      case 'hit': // «чвак» по плоти
        this.noiseBurst(0.17, 780, 0.85 * att, 'lowpass', pan);
        this.tone(165, 0.16, 0.5 * att, 'sine', 52, pan);
        break;
      case 'kill':
        this.noiseBurst(0.3, 520, 0.9 * att, 'lowpass', pan);
        this.tone(120, 0.34, 0.55 * att, 'sine', 38, pan);
        this.tone(58, 0.4, 0.35 * att, 'triangle', 30, pan);
        break;
      case 'bleed':
        this.noiseBurst(0.22, 600, 0.35 * att, 'lowpass', pan);
        break;
      case 'reload':
        this.tone(1300, 0.035, 0.22, 'square', 700, pan);
        setTimeout(() => this.tone(760, 0.05, 0.18, 'square', 420, pan), 90);
        break;
      case 'pickup':
        this.tone(640, 0.07, 0.3, 'triangle', 980, pan);
        break;
      case 'use':
        this.tone(420, 0.09, 0.26, 'sine', 620, pan);
        break;
      case 'unlock':
        this.noiseBurst(0.1, 2200, 0.3, 'bandpass', pan);
        this.tone(880, 0.12, 0.25, 'triangle', 1240, pan);
        break;
      case 'extract':
        this.tone(330, 0.5, 0.4, 'triangle', 660, pan);
        this.tone(495, 0.55, 0.22, 'sine', 990, pan);
        break;
      case 'death':
        this.tone(220, 0.7, 0.45, 'sawtooth', 55, pan);
        this.noiseBurst(0.5, 400, 0.3, 'lowpass', pan);
        break;
      case 'step':
        this.noiseBurst(0.05, 500, 0.06, 'lowpass', pan);
        break;
      case 'ui':
        this.tone(520, 0.05, 0.18, 'sine', 720);
        break;
      default:
        break;
    }
  }
}

export const sfx = new Sfx();
