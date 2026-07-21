/**
 * Áudio procedural via WebAudio — sem assets externos.
 * Tiros, hitmarker, dano, kill, morte, reload e passos são sintetizados
 * com osciladores e rajadas de ruído filtrado.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.5;

  /** Deve ser chamado num gesto do usuário (clique) para liberar o áudio. */
  resume(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      // Buffer de ruído branco compartilhado (0.5s).
      const length = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  // --- Blocos de síntese ---

  private tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = "sine",
    slideTo?: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
    }
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    filterFreq: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // --- Eventos do jogo ---

  shoot(weaponId: string): void {
    switch (weaponId) {
      case "pistol":
        this.noise(0.1, 0.4, "bandpass", 1000);
        this.tone(170, 0.08, 0.3, "square", 70);
        break;
      case "rifle":
        this.noise(0.07, 0.35, "bandpass", 1500);
        this.tone(220, 0.06, 0.25, "square", 100);
        break;
      case "shotgun":
        this.noise(0.24, 0.6, "lowpass", 600);
        this.tone(95, 0.16, 0.4, "square", 45);
        break;
    }
  }

  /** Tiro de outro combatente — volume cai com a distância. */
  remoteShot(distance: number): void {
    const gain = 0.3 / (1 + distance / 12);
    if (gain < 0.01) return;
    this.noise(0.08, gain, "bandpass", 1200);
  }

  hitmarker(headshot: boolean): void {
    this.tone(headshot ? 1750 : 1300, 0.05, 0.22, "sine");
    if (headshot) this.tone(2100, 0.05, 0.18, "sine", undefined, 0.05);
  }

  damaged(): void {
    this.tone(110, 0.16, 0.3, "sawtooth", 60);
    this.noise(0.1, 0.15, "lowpass", 400);
  }

  killConfirm(): void {
    this.tone(520, 0.08, 0.2, "triangle");
    this.tone(780, 0.1, 0.2, "triangle", undefined, 0.08);
  }

  death(): void {
    this.tone(300, 0.5, 0.28, "sawtooth", 70);
  }

  respawn(): void {
    this.tone(600, 0.14, 0.16, "sine", 950);
  }

  reload(): void {
    this.tone(700, 0.03, 0.18, "square", undefined, 0);
    this.tone(500, 0.03, 0.18, "square", undefined, 0.13);
  }

  footstep(): void {
    this.noise(0.05, 0.09, "lowpass", 320);
  }
}
