import { WeaponDef, isMeleeWeapon } from "../../shared/weapons";
import { CONFIG } from "../../shared/config";
import {
  KILL_STREAK_REWARDS,
  nextKillStreakReward,
} from "../../shared/killStreaks";

/** Linha do placar (dados vêm do estado do servidor). */
export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
  isHost?: boolean;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Camada DOM do HUD: vida, munição, kill feed, placar, morte, vitória. */
export class Hud {
  private readonly healthFill = el<HTMLDivElement>("healthFill");
  private readonly healthText = el<HTMLSpanElement>("healthText");
  private readonly ammoMag = el<HTMLSpanElement>("ammoMag");
  private readonly ammoReserve = el<HTMLSpanElement>("ammoReserve");
  private readonly weaponName = el<HTMLDivElement>("weaponName");
  private readonly weaponSlots = el<HTMLDivElement>("weaponSlots");
  private readonly killCount = el<HTMLSpanElement>("killCount");
  private readonly killFeed = el<HTMLDivElement>("killFeed");
  private readonly scoreboard = el<HTMLDivElement>("scoreboard");
  private readonly scoreboardBody = el<HTMLTableSectionElement>("scoreboardBody");
  private readonly deathScreen = el<HTMLDivElement>("deathScreen");
  private readonly deathInfo = el<HTMLDivElement>("deathInfo");
  private readonly deathTimer = el<HTMLDivElement>("deathTimer");
  private readonly endScreen = el<HTMLDivElement>("endScreen");
  private readonly endTitle = el<HTMLDivElement>("endTitle");
  private readonly hitmarker = el<HTMLDivElement>("hitmarker");
  private readonly killBadge = el<HTMLDivElement>("killBadge");
  private readonly killStars = el<HTMLDivElement>("killStars");
  private readonly killBadgeLabel = el<HTMLSpanElement>("killBadgeLabel");
  private readonly damageVignette = el<HTMLDivElement>("damageVignette");
  private readonly damageDirection = el<HTMLDivElement>("damageDirection");
  private readonly wallhackVignette = el<HTMLDivElement>("wallhackVignette");
  private readonly invincibleVignette = el<HTMLDivElement>("invincibleVignette");
  private readonly streakActivePanel = el<HTMLDivElement>("streakActivePanel");
  private readonly streakActiveBar = el<HTMLDivElement>("streakActiveBar");
  private readonly streakTimeText = el<HTMLSpanElement>("streakTimeText");
  private readonly streakActiveTitle = el<HTMLDivElement>("streakActiveTitle");
  private readonly streakActiveIcon = el<HTMLDivElement>("streakActiveIcon");
  private readonly streakToastContainer = el<HTMLDivElement>("streakToastContainer");
  private readonly streakTlCount = el<HTMLSpanElement>("streakTlCount");
  private readonly streakTlFill = el<HTMLDivElement>("streakTlFill");
  private readonly streakTlNodes = el<HTMLDivElement>("streakTlNodes");
  private readonly streakTlHint = el<HTMLDivElement>("streakTlHint");

  private hitmarkerTimeout = 0;
  private vignetteTimeout = 0;
  private killBadgeTimeout = 0;
  /** Sequências de multi-kill por id (janela de 5s). */
  private readonly playerStreaks = new Map<
    string,
    { count: number; timeout: number }
  >();
  private activeWeaponIndex = 0;
  private loadoutWeapons: WeaponDef[] = [];
  private currentKillStreak = 0;

  private static readonly KILL_STREAK_WINDOW_MS = 5000;
  private static readonly KILL_BADGE_VISIBLE_MS = 2200;
  private static readonly KILL_LABELS = [
    "KILL",
    "DOUBLE KILL",
    "TRIPLE KILL",
    "QUADRA KILL",
    "MULTI KILL",
  ] as const;

  constructor() {
    this.renderStreakTimeline(0);
  }

  setHealth(current: number): void {
    const pct = Math.max(0, Math.min(1, current / CONFIG.playerMaxHealth));
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthFill.style.background =
      pct > 0.5 ? "#6fd66f" : pct > 0.25 ? "#e8c14a" : "#e05545";
    this.healthText.textContent = String(Math.ceil(current));
  }

  /** Atualiza os 3 slots do kit (principal / secundária / melee). */
  setLoadoutWeapons(weapons: WeaponDef[], activeIndex = 0): void {
    this.loadoutWeapons = weapons;
    this.setWeapon(activeIndex);
  }

  setAmmo(mag: number, reserve: number, reloading: boolean): void {
    const weapon = this.loadoutWeapons[this.activeWeaponIndex];
    if (weapon && isMeleeWeapon(weapon)) {
      this.ammoMag.textContent = "—";
      this.ammoReserve.textContent = "melee";
      this.ammoMag.classList.remove("low");
      return;
    }
    this.ammoMag.textContent = reloading ? "--" : String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle("low", !reloading && mag <= 5);
  }

  setWeapon(index: number): void {
    this.activeWeaponIndex = index;
    const weapon = this.loadoutWeapons[index];
    this.weaponName.textContent = weapon?.name ?? "—";
    this.renderWeaponSlots(index);
  }

  private renderWeaponSlots(activeIndex: number): void {
    this.weaponSlots.innerHTML = this.loadoutWeapons
      .map(
        (w, i) =>
          `<div class="slot${i === activeIndex ? " active" : ""}">${i + 1}·${w.name}</div>`
      )
      .join("");
  }

  private killsTarget: number = CONFIG.killsToWin;

  /** Define o total de kills para vencer (vem da config da sala). */
  setKillsTarget(target: number): void {
    this.killsTarget = target;
  }

  setKills(kills: number): void {
    this.killCount.textContent = `${kills} / ${this.killsTarget}`;
  }

  /** Atualiza a timeline de kill streaks (kills sem morrer). */
  setKillStreak(count: number): void {
    const streak = Math.max(0, Math.floor(count));
    if (streak === this.currentKillStreak) return;
    this.currentKillStreak = streak;
    this.renderStreakTimeline(streak);
  }

  private renderStreakTimeline(streak: number): void {
    this.streakTlCount.textContent = String(streak);

    const rewards = KILL_STREAK_REWARDS;
    const maxKills = rewards[rewards.length - 1]?.kills ?? 1;
    const fillPct = Math.max(0, Math.min(1, streak / maxKills)) * 100;
    this.streakTlFill.style.height = `${fillPct}%`;

    const next = nextKillStreakReward(streak);

    this.streakTlNodes.innerHTML = rewards
      .map((reward) => {
        const earned = streak >= reward.kills;
        const isNext = next?.id === reward.id;
        const remain = Math.max(0, reward.kills - streak);
        const classes = ["streak-tl-node"];
        if (earned) classes.push("earned");
        if (isNext) classes.push("next");

        const remainHtml =
          isNext && remain > 0
            ? `<div class="streak-tl-remain">faltam ${remain}</div>`
            : "";

        return (
          `<div class="${classes.join(" ")}">` +
          `<div class="streak-tl-dot">${earned ? "✓" : reward.kills}</div>` +
          `<div class="streak-tl-info">` +
          `<div class="streak-tl-req">${reward.icon} ${reward.kills} KILLS</div>` +
          `<div class="streak-tl-name">${reward.name}</div>` +
          remainHtml +
          `</div></div>`
        );
      })
      .join("");

    if (next) {
      const remain = next.kills - streak;
      this.streakTlHint.textContent =
        remain === 1
          ? `1 kill → ${next.name}`
          : `${remain} kills → ${next.name}`;
    } else if (rewards.length > 0) {
      this.streakTlHint.textContent = "Todos os streaks liberados";
    } else {
      this.streakTlHint.textContent = "";
    }
  }

  /**
   * Atualiza streaks, kill feed e (opcionalmente) a insignia local.
   * Retorna a sequência atual do killer (1–5).
   */
  handleKill(
    killerId: string,
    killerName: string,
    victimId: string | undefined,
    victimName: string,
    weapon: string,
    showLocalBadge: boolean
  ): number {
    if (victimId) this.clearPlayerStreak(victimId);
    const streak = this.bumpPlayerStreak(killerId);
    this.addKillFeedEntry(killerName, victimName, weapon, streak);
    if (showLocalBadge) this.showKillBadge(streak);
    return streak;
  }

  addKillFeedEntry(
    killer: string,
    victim: string,
    weapon: string,
    streak = 1
  ): void {
    const entry = document.createElement("div");
    const onStreak = streak >= 2;
    entry.className = onStreak
      ? `feed-entry streak streak-${Math.min(5, streak)}`
      : "feed-entry";
    const streakTag = onStreak
      ? `<span class="feed-streak">x${streak}</span>`
      : "";
    entry.innerHTML =
      `<b class="feed-killer">${killer}</b>` +
      ` <span class="feed-weapon">[${weapon}]</span> ${victim}` +
      streakTag;
    this.killFeed.prepend(entry);
    while (this.killFeed.children.length > 5) {
      this.killFeed.lastElementChild?.remove();
    }
    setTimeout(() => entry.remove(), 6000);
  }

  showHitmarker(headshot: boolean): void {
    this.hitmarker.classList.remove("show", "headshot");
    // Força reflow para reiniciar a animação.
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add("show");
    if (headshot) this.hitmarker.classList.add("headshot");
    clearTimeout(this.hitmarkerTimeout);
    this.hitmarkerTimeout = window.setTimeout(
      () => this.hitmarker.classList.remove("show", "headshot"),
      120
    );
  }

  /** Esconde a insignia local (ex.: ao morrer). */
  resetKillStreak(): void {
    clearTimeout(this.killBadgeTimeout);
    this.killBadge.classList.remove("show");
    this.setKillStreak(0);
  }

  /** Zera todas as sequências (fim de partida / saída). */
  clearAllKillStreaks(): void {
    for (const { timeout } of this.playerStreaks.values()) {
      clearTimeout(timeout);
    }
    this.playerStreaks.clear();
    this.resetKillStreak();
  }

  private bumpPlayerStreak(playerId: string): number {
    const prev = this.playerStreaks.get(playerId);
    if (prev) clearTimeout(prev.timeout);
    const count = Math.min(5, (prev?.count ?? 0) + 1);
    const timeout = window.setTimeout(() => {
      this.playerStreaks.delete(playerId);
    }, Hud.KILL_STREAK_WINDOW_MS);
    this.playerStreaks.set(playerId, { count, timeout });
    return count;
  }

  private clearPlayerStreak(playerId: string): void {
    const prev = this.playerStreaks.get(playerId);
    if (!prev) return;
    clearTimeout(prev.timeout);
    this.playerStreaks.delete(playerId);
  }

  private showKillBadge(streak: number): void {
    const level = Math.max(1, Math.min(5, streak));
    this.killBadge.dataset.streak = String(level);
    this.killBadgeLabel.textContent = Hud.KILL_LABELS[level - 1];
    this.killStars.innerHTML = Array.from(
      { length: level },
      () => `<span class="kill-star"></span>`
    ).join("");

    this.killBadge.classList.remove("show");
    void this.killBadge.offsetWidth;
    this.killBadge.classList.add("show");

    clearTimeout(this.killBadgeTimeout);
    this.killBadgeTimeout = window.setTimeout(() => {
      this.killBadge.classList.remove("show");
    }, Hud.KILL_BADGE_VISIBLE_MS);
  }

  flashDamage(): void {
    this.damageVignette.classList.add("show");
    clearTimeout(this.vignetteTimeout);
    this.vignetteTimeout = window.setTimeout(
      () => this.damageVignette.classList.remove("show"),
      250
    );
  }

  /**
   * Marca de sangue na borda da tela na direção do ataque.
   * relativeYaw: 0 = frente (topo), ±π = costas (baixo), +π/2 = direita.
   */
  showDirectionalDamage(relativeYaw: number): void {
    const ring = document.createElement("div");
    ring.className = "damage-dir-ring";
    ring.style.transform = `rotate(${relativeYaw}rad)`;

    const mark = document.createElement("div");
    mark.className = "damage-dir-mark";
    ring.appendChild(mark);
    this.damageDirection.appendChild(ring);

    // Força reflow para reiniciar a animação.
    void mark.offsetWidth;
    mark.classList.add("show");

    window.setTimeout(() => ring.remove(), 900);
  }

  setScoreboardVisible(on: boolean, rows?: ScoreRow[]): void {
    this.scoreboard.classList.toggle("hidden", !on);
    if (on && rows) this.renderScoreboard(rows);
  }

  renderScoreboard(rows: ScoreRow[]): void {
    this.scoreboardBody.innerHTML = rows
      .map((c) => {
        const tags = [
          c.isHost ? `<span class="score-tag host">Líder</span>` : "",
          c.isPlayer ? `<span class="score-tag you">você</span>` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `
      <tr class="${c.isPlayer ? "me" : ""}${c.isHost ? " host" : ""}">
        <td>${escapeHtml(c.name)}${tags ? ` ${tags}` : ""}</td>
        <td>${c.kills}</td>
        <td>${c.deaths}</td>
      </tr>`;
      })
      .join("");
  }

  showDeathScreen(killerName: string, weaponName: string): void {
    this.deathInfo.textContent = `Morto por ${killerName} [${weaponName}]`;
    this.deathScreen.classList.remove("hidden");
  }

  updateDeathTimer(seconds: number): void {
    this.deathTimer.textContent = `Renascendo em ${Math.ceil(seconds)}…`;
  }

  hideDeathScreen(): void {
    this.deathScreen.classList.add("hidden");
  }

  showEndScreen(winnerName: string, playerWon: boolean, rows: ScoreRow[]): void {
    this.endTitle.textContent = playerWon
      ? "🏆 Você venceu!"
      : `${winnerName} venceu a partida`;
    this.endScreen.classList.remove("hidden");
    this.setScoreboardVisible(true, rows);
  }

  updateActiveStreak(streakName: string, timeLeft: number): void {
    if (streakName) {
      this.streakActivePanel.classList.remove("hidden");
      this.streakActiveTitle.textContent = streakName.replace("_", " ").toUpperCase();
      this.streakTimeText.textContent = `${Math.ceil(timeLeft)}s`;
      
      const pct = Math.max(0, Math.min(100, (timeLeft / 15) * 100));
      this.streakActiveBar.style.width = `${pct}%`;

      const reward = KILL_STREAK_REWARDS.find((r) => r.id === streakName);
      this.streakActiveIcon.textContent = reward?.icon ?? "⚡";

      if (streakName === "wall_hacker") {
        this.wallhackVignette.classList.remove("hidden");
      } else {
        this.wallhackVignette.classList.add("hidden");
      }
    } else {
      this.streakActivePanel.classList.add("hidden");
      this.wallhackVignette.classList.add("hidden");
    }
  }

  /** Blur dourado nas bordas enquanto o jogador local está invencível. */
  setInvincibleVignette(on: boolean): void {
    this.invincibleVignette.classList.toggle("hidden", !on);
  }

  showKillstreakToast(message: string): void {
    const toast = document.createElement("div");
    toast.className = "streak-toast";
    toast.textContent = message;
    this.streakToastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }
}
