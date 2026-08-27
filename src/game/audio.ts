/**
 * Áudio procedural via WebAudio — sem assets externos.
 * Tiros usam síntese em camadas; sons remotos (tiros/passos) usam stereo pan
 * + atenuação por distância relativos à câmera do jogador local.
 */
export interface SpatialListener {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface SpatialMix {
  pan: number;
  gain: number;
  /** +1 à frente, -1 atrás. */
  forward: number;
}

interface TrackedVoice {
  src: AudioBufferSourceNode;
  pan: StereoPannerNode;
  spatialGain: GainNode;
  fadeGain: GainNode;
  filter: BiquadFilterNode;
  x: number;
  z: number;
  baseGain: number;
}

const ZOMBIE_CLIP = {
  groan1: "/sounds/zombie/zombie1.mp3",
  groan2: "/sounds/zombie/zombie2.mp3",
  hit: "/sounds/zombie/zombie-hit.mp3",
  boss: "/sounds/zombie/zombie-boss1.mp3",
  /** Nome do arquivo no repo (typo original). */
  ambience: "/sounds/zombie/zombie-backgroud.mp3",
} as const;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.5;
  private listener: SpatialListener | null = null;
  private heliRotor: {
    osc: OscillatorNode;
    noise: AudioBufferSourceNode;
    gain: GainNode;
  } | null = null;
  private readonly clipBuffers = new Map<string, AudioBuffer>();
  private readonly clipLoading = new Map<string, Promise<AudioBuffer | null>>();
  private zombieAmbienceOn = false;
  private zombieAmbienceAcc = 0;
  private zombieAmbienceWait = 6;
  private zombieAmbienceSource: AudioBufferSourceNode | null = null;

  /** Deve ser chamado num gesto do usuário (clique) para liberar o áudio. */
  resume(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

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

  private readonly zombieVoices = new Map<string, TrackedVoice>();
  private readonly zombieVoiceEpoch = new Map<string, number>();

  /** Posição/orientação do ouvinte (câmera local) — atualizar a cada frame in-game. */
  setListener(listener: SpatialListener): void {
    this.listener = listener;
    for (const v of this.zombieVoices.values()) this.applyTrackedSpatial(v);
  }

  /** Pan stereo (-1 esq … 1 dir) + gain por distância horizontal. */
  private computeSpatial(
    sourceX: number,
    sourceZ: number,
    maxDist: number,
    falloff = 14
  ): SpatialMix | null {
    if (!this.listener) return { pan: 0, gain: 1, forward: 1 };

    const dx = sourceX - this.listener.x;
    const dz = sourceZ - this.listener.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) return null;

    const yaw = this.listener.yaw;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let pan = 0;
    let forward = 1;
    let behind = 1;
    if (dist > 0.05) {
      const nx = dx / dist;
      const nz = dz / dist;
      pan = nx * rightX + nz * rightZ;
      forward = nx * fwdX + nz * fwdZ;
      if (forward < 0) behind = 0.72 + 0.28 * (1 + forward);
    }

    const gain = behind / (1 + dist / falloff);
    return {
      pan: Math.max(-1, Math.min(1, pan)),
      gain,
      forward,
    };
  }

  private connectOutput(gainNode: GainNode, pan?: number): void {
    if (!this.master) return;
    if (pan === undefined) {
      gainNode.connect(this.master);
      return;
    }
    const panner = this.ctx!.createStereoPanner();
    panner.pan.value = pan;
    gainNode.connect(panner).connect(this.master);
  }

  // --- Blocos de síntese ---

  private tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = "sine",
    slideTo?: number,
    delay = 0,
    spatial?: SpatialMix
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
    const vol = spatial ? gain * spatial.gain : gain;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    this.connectOutput(g, spatial?.pan);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    filterFreq: number,
    delay = 0,
    filterSlideTo?: number,
    q = 1,
    spatial?: SpatialMix
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(filterFreq, t0);
    if (filterSlideTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, filterSlideTo),
        t0 + duration
      );
    }
    const g = this.ctx.createGain();
    const vol = spatial ? gain * spatial.gain : gain;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(g);
    this.connectOutput(g, spatial?.pan);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /**
   * Disparo em camadas: estalo agudo (transiente), corpo filtrado com decay
   * longo, sub-grave opcional e clique mecânico do ferrolho.
   */
  private gunshot(
    profile: {
      attackGain: number;
      bodyGain: number;
      attackMs: number;
      bodyMs: number;
      attackFreq: number;
      bodyFreq: number;
      bodyEndFreq: number;
      subFreq?: number;
      subGain?: number;
      subMs?: number;
      mechFreq?: number;
      mechGain?: number;
      mechDelay?: number;
    },
    gainScale = 1,
    spatial?: SpatialMix
  ): void {
    const mix: SpatialMix | undefined = spatial
      ? { pan: spatial.pan, gain: spatial.gain * gainScale, forward: spatial.forward }
      : gainScale === 1
        ? undefined
        : { pan: 0, gain: gainScale, forward: 1 };

    const jitter = 0.92 + Math.random() * 0.16;
    const attackS = profile.attackMs / 1000;
    const bodyS = profile.bodyMs / 1000;

    this.noise(
      attackS,
      profile.attackGain * jitter,
      "highpass",
      profile.attackFreq * jitter,
      0,
      profile.attackFreq * 0.55,
      1,
      mix
    );

    this.noise(
      bodyS,
      profile.bodyGain,
      "bandpass",
      profile.bodyFreq * jitter,
      attackS * 0.35,
      profile.bodyEndFreq,
      0.85,
      mix
    );

    if (profile.subFreq && profile.subGain && profile.subMs) {
      this.tone(
        profile.subFreq * jitter,
        profile.subMs / 1000,
        profile.subGain,
        "sine",
        profile.subFreq * 0.55,
        attackS * 0.2,
        mix
      );
    }

    if (profile.mechFreq && profile.mechGain) {
      this.tone(
        profile.mechFreq,
        0.018,
        profile.mechGain,
        "square",
        profile.mechFreq * 0.7,
        profile.mechDelay ?? attackS * 0.5,
        mix
      );
    }
  }

  private gunshotForWeapon(
    weaponId: string,
    gainScale = 1,
    spatial?: SpatialMix
  ): void {
    switch (weaponId) {
      case "usp":
      case "pistol":
        this.gunshot(
          {
            attackGain: 0.55,
            bodyGain: 0.32,
            attackMs: 12,
            bodyMs: 95,
            attackFreq: 2800,
            bodyFreq: 1400,
            bodyEndFreq: 420,
            subFreq: 95,
            subGain: 0.14,
            subMs: 70,
            mechFreq: 920,
            mechGain: 0.06,
          },
          gainScale,
          spatial
        );
        break;
      case "magnum":
        this.gunshot(
          {
            attackGain: 0.72,
            bodyGain: 0.48,
            attackMs: 16,
            bodyMs: 180,
            attackFreq: 2200,
            bodyFreq: 900,
            bodyEndFreq: 280,
            subFreq: 62,
            subGain: 0.32,
            subMs: 140,
            mechFreq: 780,
            mechGain: 0.08,
            mechDelay: 0.012,
          },
          gainScale,
          spatial
        );
        break;
      case "m4a1":
      case "rifle":
        this.gunshot(
          {
            attackGain: 0.58,
            bodyGain: 0.38,
            attackMs: 10,
            bodyMs: 110,
            attackFreq: 3200,
            bodyFreq: 1700,
            bodyEndFreq: 480,
            subFreq: 88,
            subGain: 0.18,
            subMs: 85,
            mechFreq: 1100,
            mechGain: 0.05,
          },
          gainScale,
          spatial
        );
        break;
      case "ak47":
        this.gunshot(
          {
            attackGain: 0.64,
            bodyGain: 0.44,
            attackMs: 11,
            bodyMs: 130,
            attackFreq: 2600,
            bodyFreq: 1200,
            bodyEndFreq: 360,
            subFreq: 72,
            subGain: 0.26,
            subMs: 105,
            mechFreq: 980,
            mechGain: 0.07,
          },
          gainScale,
          spatial
        );
        break;
      case "scarh":
        this.gunshot(
          {
            attackGain: 0.62,
            bodyGain: 0.42,
            attackMs: 11,
            bodyMs: 125,
            attackFreq: 2700,
            bodyFreq: 1350,
            bodyEndFreq: 400,
            subFreq: 78,
            subGain: 0.22,
            subMs: 100,
            mechFreq: 1020,
            mechGain: 0.06,
          },
          gainScale,
          spatial
        );
        break;
      case "mp5":
        this.gunshot(
          {
            attackGain: 0.48,
            bodyGain: 0.28,
            attackMs: 9,
            bodyMs: 80,
            attackFreq: 3600,
            bodyFreq: 1900,
            bodyEndFreq: 520,
            subFreq: 110,
            subGain: 0.1,
            subMs: 60,
            mechFreq: 1250,
            mechGain: 0.04,
          },
          gainScale,
          spatial
        );
        break;
      case "minigun":
        this.gunshot(
          {
            attackGain: 0.62,
            bodyGain: 0.4,
            attackMs: 7,
            bodyMs: 70,
            attackFreq: 2400,
            bodyFreq: 900,
            bodyEndFreq: 280,
            subFreq: 55,
            subGain: 0.28,
            subMs: 85,
            mechFreq: 1480,
            mechGain: 0.08,
          },
          gainScale * 0.85,
          spatial
        );
        break;
      case "vector":
        this.gunshot(
          {
            attackGain: 0.5,
            bodyGain: 0.3,
            attackMs: 9,
            bodyMs: 85,
            attackFreq: 3400,
            bodyFreq: 1750,
            bodyEndFreq: 500,
            subFreq: 102,
            subGain: 0.12,
            subMs: 65,
            mechFreq: 1180,
            mechGain: 0.045,
          },
          gainScale,
          spatial
        );
        break;
      case "shotgun":
        this.gunshot(
          {
            attackGain: 0.85,
            bodyGain: 0.62,
            attackMs: 18,
            bodyMs: 240,
            attackFreq: 1800,
            bodyFreq: 700,
            bodyEndFreq: 180,
            subFreq: 48,
            subGain: 0.42,
            subMs: 190,
            mechFreq: 640,
            mechGain: 0.1,
            mechDelay: 0.02,
          },
          gainScale,
          spatial
        );
        break;
      case "awp":
      case "sniper":
        this.gunshot(
          {
            attackGain: 0.78,
            bodyGain: 0.55,
            attackMs: 20,
            bodyMs: 280,
            attackFreq: 2000,
            bodyFreq: 820,
            bodyEndFreq: 220,
            subFreq: 52,
            subGain: 0.38,
            subMs: 210,
            mechFreq: 720,
            mechGain: 0.09,
            mechDelay: 0.025,
          },
          gainScale,
          spatial
        );
        break;
      case "knife":
        this.noise(0.08, 0.22 * gainScale, "highpass", 1800, 0, undefined, 1, spatial);
        this.tone(420, 0.06, 0.12 * gainScale, "triangle", 180, 0, spatial);
        break;
      default:
        this.gunshot(
          {
            attackGain: 0.55,
            bodyGain: 0.35,
            attackMs: 12,
            bodyMs: 100,
            attackFreq: 2800,
            bodyFreq: 1500,
            bodyEndFreq: 450,
            subFreq: 90,
            subGain: 0.16,
            subMs: 80,
          },
          gainScale,
          spatial
        );
        break;
    }
  }

  // --- Eventos do jogo ---

  shoot(weaponId: string): void {
    this.gunshotForWeapon(weaponId);
  }

  /** Tiro de outro combatente — pan stereo + volume por distância. */
  remoteShot(source: { x: number; y: number; z: number }): void {
    const spatial = this.computeSpatial(source.x, source.z, 58, 16);
    if (!spatial || spatial.gain < 0.012) return;
    this.gunshot(
      {
        attackGain: 0.5,
        bodyGain: 0.34,
        attackMs: 12,
        bodyMs: 120,
        attackFreq: 2600,
        bodyFreq: 1300,
        bodyEndFreq: 380,
        subFreq: 80,
        subGain: 0.14,
        subMs: 90,
      },
      0.55,
      spatial
    );
  }

  /** Passo de outro combatente — pan stereo + volume por distância. */
  remoteFootstep(source: { x: number; y: number; z: number }): void {
    const spatial = this.computeSpatial(source.x, source.z, 36, 12);
    if (!spatial || spatial.gain < 0.02) return;
    this.noise(
      0.05,
      0.18,
      "lowpass",
      280 + Math.random() * 90,
      0,
      undefined,
      1,
      spatial
    );
  }

  hitmarker(headshot: boolean): void {
    this.tone(headshot ? 1750 : 1300, 0.05, 0.22, "sine");
    if (headshot) this.tone(2100, 0.05, 0.18, "sine", undefined, 0.05);
  }

  damaged(): void {
    this.tone(110, 0.16, 0.3, "sawtooth", 60);
    this.noise(0.1, 0.15, "lowpass", 400);
  }

  killConfirm(streak = 1): void {
    const level = Math.max(1, Math.min(5, streak));
    this.noise(0.08, 0.18, "bandpass", 900);
    this.tone(180, 0.12, 0.28, "sawtooth", 90);
    this.tone(660, 0.09, 0.22, "triangle");
    this.tone(990, 0.12, 0.24, "triangle", undefined, 0.07);

    if (level >= 2) {
      this.tone(1320, 0.14, 0.2, "sine", undefined, 0.14);
      this.tone(440, 0.1, 0.12, "square", 660, 0.12);
    }
    if (level >= 3) {
      this.tone(1760, 0.16, 0.18, "sine", undefined, 0.22);
      this.tone(880, 0.18, 0.14, "triangle", 1320, 0.2);
      this.noise(0.1, 0.12, "highpass", 2200, 0.18);
    }
    if (level >= 4) {
      this.tone(1980, 0.14, 0.16, "sine", undefined, 0.28);
      this.tone(550, 0.12, 0.14, "square", 880, 0.26);
    }
    if (level >= 5) {
      this.tone(2200, 0.18, 0.2, "sine", undefined, 0.34);
      this.tone(1100, 0.2, 0.16, "triangle", 1760, 0.32);
      this.noise(0.14, 0.14, "bandpass", 2800, 0.3);
    }
  }

  death(): void {
    this.tone(300, 0.5, 0.28, "sawtooth", 70);
  }

  explosion(): void {
    this.noise(0.55, 0.7, "lowpass", 420);
    this.tone(90, 0.7, 0.45, "sawtooth", 28);
    this.tone(180, 0.35, 0.22, "square", 50, 0.04);
  }

  startHeliRotor(): void {
    this.resume();
    this.stopHeliRotor();
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 48;
    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.22;
    osc.connect(oscGain).connect(gain);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 280;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.35;
    noise.connect(filter).connect(noiseGain).connect(gain);

    const t0 = this.ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.45);
    osc.start();
    noise.start();
    this.heliRotor = { osc, noise, gain };
  }

  stopHeliRotor(): void {
    if (!this.heliRotor || !this.ctx) return;
    const { osc, noise, gain } = this.heliRotor;
    const t0 = this.ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(gain.gain.value, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      try {
        osc.stop();
        noise.stop();
      } catch {
        /* already stopped */
      }
      gain.disconnect();
    }, 400);
    this.heliRotor = null;
  }

  respawn(): void {
    this.tone(600, 0.14, 0.16, "sine", 950);
  }

  reload(): void {
    this.tone(700, 0.03, 0.18, "square", undefined, 0);
    this.tone(500, 0.03, 0.18, "square", undefined, 0.13);
  }

  footstep(): void {
    this.noise(0.05, 0.14, "lowpass", 320);
  }

  startZombieAmbience(): void {
    this.resume();
    this.zombieAmbienceOn = true;
    this.zombieAmbienceAcc = 0;
    this.zombieAmbienceWait = 4 + Math.random() * 8;
    void this.preloadZombieClips();
  }

  stopZombieAmbience(): void {
    this.zombieAmbienceOn = false;
    this.stopZombieAmbienceSource();
    this.stopAllZombieVoices();
  }

  /**
   * Fundo da horda só enquanto houver zumbi vivo.
   * `aliveCount === 0` (intermissão / wipe) corta na hora.
   */
  tickZombieAmbience(dt: number, aliveCount: number): void {
    if (!this.zombieAmbienceOn) return;
    if (aliveCount <= 0) {
      this.stopZombieAmbienceSource();
      this.stopAllZombieVoices();
      this.zombieAmbienceAcc = 0;
      return;
    }
    if (this.zombieAmbienceSource) return;
    this.zombieAmbienceAcc += dt;
    if (this.zombieAmbienceAcc >= this.zombieAmbienceWait) {
      this.zombieAmbienceAcc = 0;
      this.playZombieAmbienceClip();
    }
  }

  /** Corta o gemido daquele zumbi (morte / sumiu do mapa). */
  stopZombieVoice(id: string): void {
    this.zombieVoiceEpoch.set(id, (this.zombieVoiceEpoch.get(id) ?? 0) + 1);
    const voice = this.zombieVoices.get(id);
    if (!voice) return;
    this.zombieVoices.delete(id);
    try {
      voice.src.stop();
    } catch {
      /* already stopped */
    }
  }

  /** Atualiza o pan do gemido com a pose atual (zumbi anda, jogador gira). */
  updateZombieVoice(id: string, x: number, z: number): void {
    const voice = this.zombieVoices.get(id);
    if (!voice) return;
    voice.x = x;
    voice.z = z;
    this.applyTrackedSpatial(voice);
  }

  /**
   * Gemido stereo na direção do jogo (mesmo eixo dos tiros remotos).
   * Pan é reforçado e atualizado a cada frame.
   */
  zombieGroan(
    id: string,
    source: { x: number; y: number; z: number },
    boss = false
  ): void {
    if (this.zombieVoices.has(id)) return;
    if (!this.listener) return;
    const spatial = this.computeSpatial(source.x, source.z, boss ? 58 : 42, boss ? 16 : 11);
    if (!spatial) return;
    if (!boss && this.zombieVoices.size >= 5) return;

    const url = boss
      ? ZOMBIE_CLIP.boss
      : hashStr(id) % 2 === 0
        ? ZOMBIE_CLIP.groan1
        : ZOMBIE_CLIP.groan2;
    const rate = boss ? 0.84 : 0.9 + (hashStr(id) % 21) / 100;
    const dur = boss ? 2.8 : 2.15;
    this.playDirectedClip(url, source, boss ? 0.85 : 0.7, {
      id,
      playbackRate: rate,
      maxDuration: dur,
    });
  }

  /** Impacto melee no jogador — vem da posição do zumbi. */
  zombieAttack(source: { x: number; y: number; z: number }): void {
    this.playDirectedClip(ZOMBIE_CLIP.hit, source, 0.88, { maxDuration: 1.4 });
  }

  /** Passo arrastado, no mesmo pan stereo dos outros combatentes. */
  zombieFootstep(source: { x: number; y: number; z: number }): void {
    const spatial = this.computeSpatial(source.x, source.z, 32, 10);
    if (!spatial || spatial.gain < 0.02) return;
    const mix: SpatialMix = {
      pan: exaggeratePan(spatial.pan),
      gain: spatial.gain,
      forward: spatial.forward,
    };
    this.noise(0.08, 0.24, "lowpass", spatial.forward < 0 ? 160 : 220, 0, 90, 1, mix);
    this.tone(70 + Math.random() * 18, 0.07, 0.09, "sine", 40, 0, mix);
  }

  private preloadZombieClips(): void {
    for (const url of Object.values(ZOMBIE_CLIP)) {
      void this.ensureClip(url);
    }
  }

  private playZombieAmbienceClip(): void {
    void this.ensureClip(ZOMBIE_CLIP.ambience).then((buf) => {
      if (!buf || !this.ctx || !this.master || !this.zombieAmbienceOn) return;
      if (this.zombieAmbienceSource) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.14;
      src.connect(g);
      g.connect(this.master);
      src.onended = () => {
        if (this.zombieAmbienceSource === src) this.zombieAmbienceSource = null;
        this.zombieAmbienceWait = 12 + Math.random() * 20;
        this.zombieAmbienceAcc = 0;
      };
      this.zombieAmbienceSource = src;
      try {
        src.start();
      } catch {
        this.zombieAmbienceSource = null;
      }
    });
  }

  private stopZombieAmbienceSource(): void {
    const src = this.zombieAmbienceSource;
    this.zombieAmbienceSource = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }

  stopAllZombieVoices(): void {
    for (const id of [...this.zombieVoices.keys()]) this.stopZombieVoice(id);
  }

  private playDirectedClip(
    url: string,
    source: { x: number; y: number; z: number },
    gain: number,
    opts: { id?: string; playbackRate?: number; maxDuration?: number } = {}
  ): void {
    const epoch = opts.id ? this.zombieVoiceEpoch.get(opts.id) ?? 0 : 0;
    void this.ensureClip(url).then((buf) => {
      if (!buf || !this.ctx || !this.master) return;
      if (opts.id) {
        if ((this.zombieVoiceEpoch.get(opts.id) ?? 0) !== epoch) return;
        if (this.zombieVoices.has(opts.id)) return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = opts.playbackRate ?? 1;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 14000;
      const fadeGain = this.ctx.createGain();
      fadeGain.gain.value = 1;
      const spatialGain = this.ctx.createGain();
      spatialGain.gain.value = gain;
      const pan = this.ctx.createStereoPanner();
      src.connect(filter).connect(fadeGain).connect(spatialGain).connect(pan).connect(this.master);

      const voice: TrackedVoice = {
        src,
        pan,
        spatialGain,
        fadeGain,
        filter,
        x: source.x,
        z: source.z,
        baseGain: gain,
      };
      this.applyTrackedSpatial(voice);
      if (opts.id) {
        this.zombieVoices.set(opts.id, voice);
        src.onended = () => {
          if (this.zombieVoices.get(opts.id!)?.src === src) this.zombieVoices.delete(opts.id!);
        };
      }
      try {
        src.start();
        const cap = opts.maxDuration;
        if (cap && cap > 0) {
          const t0 = this.ctx.currentTime;
          const fade = Math.min(0.18, cap * 0.2);
          fadeGain.gain.setValueAtTime(1, t0 + Math.max(0, cap - fade));
          fadeGain.gain.linearRampToValueAtTime(0.001, t0 + cap);
          src.stop(t0 + cap + 0.02);
        }
      } catch {
        if (opts.id) this.zombieVoices.delete(opts.id);
      }
    });
  }

  private applyTrackedSpatial(voice: TrackedVoice): void {
    const spatial = this.computeSpatial(voice.x, voice.z, 52, 12);
    if (!spatial) {
      voice.spatialGain.gain.value = 0.0001;
      return;
    }
    voice.pan.pan.value = exaggeratePan(spatial.pan);
    voice.spatialGain.gain.value = voice.baseGain * Math.max(0.06, spatial.gain);
    voice.filter.frequency.value = spatial.forward < 0.12 ? 780 : 14000;
  }

  private ensureClip(url: string): Promise<AudioBuffer | null> {
    const cached = this.clipBuffers.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = this.clipLoading.get(url);
    if (pending) return pending;
    const job = this.fetchClip(url);
    this.clipLoading.set(url, job);
    return job;
  }

  private async fetchClip(url: string): Promise<AudioBuffer | null> {
    this.resume();
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.clipBuffers.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      this.clipLoading.delete(url);
    }
  }
}

function hashStr(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Empurra o pan para as orelhas — 30° ao lado já some quase todo num canal. */
function exaggeratePan(pan: number): number {
  const mag = Math.min(1, Math.pow(Math.abs(pan), 0.42));
  return (pan < 0 ? -1 : 1) * mag;
}
