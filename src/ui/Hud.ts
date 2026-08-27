import { WeaponDef, isMeleeWeapon } from "../../shared/weapons";
import { CONFIG } from "../../shared/config";
import {
  KILL_STREAK_REWARDS,
  killStreakKeyLabel,
  nextKillStreakReward,
} from "../../shared/killStreaks";
import { rankForXp, rankIconUrl } from "../../shared/ranks";

/** Linha do placar (dados vêm do estado do servidor). */
export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
  isHost?: boolean;
  /** XP de carreira — define a insígnia exibida ao lado do nome. */
  xp: number;
  team?: string;
  /** Id da conta (0 = convidado/bot) — menu do Social no placar. */
  userId?: number;
  isBot?: boolean;
}

/** Resumo de gold exibido na tela de fim de partida. */
export interface EndGoldSummary {
  earned: number;
  /** Detalhamento: uma linha por fonte de gold (participação, kills...). */
  lines: Array<{ label: string; gold: number }>;
}

/** Resumo de XP exibido na tela de fim de partida. */
export interface EndXpSummary {
  earned: number;
  rankName: string;
  rankIcon: string;
  rankedUp: boolean;
  /** Detalhamento: uma linha por fonte de XP (participação, kills...). */
  lines: Array<{ label: string; xp: number }>;
  /** Gold ganho na partida (base + desempenho + vitória). */
  gold?: EndGoldSummary;
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
  private readonly healthPanel = el<HTMLDivElement>("healthPanel");
  private readonly healthFill = el<HTMLDivElement>("healthFill");
  private readonly healthText = el<HTMLSpanElement>("healthText");
  private readonly ammoMag = el<HTMLSpanElement>("ammoMag");
  private readonly ammoReserve = el<HTMLSpanElement>("ammoReserve");
  private readonly weaponName = el<HTMLDivElement>("weaponName");
  private readonly weaponSlots = el<HTMLDivElement>("weaponSlots");
  private readonly killCount = el<HTMLSpanElement>("killCount");
  private readonly killsPanelFfa = el<HTMLSpanElement>("killsPanelFfa");
  private readonly killsPanelTdm = el<HTMLSpanElement>("killsPanelTdm");
  private readonly killsPanelZombies = el<HTMLSpanElement>("killsPanelZombies");
  private readonly zombieRoundHud = el<HTMLSpanElement>("zombieRoundHud");
  private readonly zombieLeftHud = el<HTMLSpanElement>("zombieLeftHud");
  private readonly zombieBanner = el<HTMLDivElement>("zombieBanner");
  private readonly zombieBannerTitle = el<HTMLDivElement>("zombieBannerTitle");
  private readonly zombieBannerSub = el<HTMLDivElement>("zombieBannerSub");
  private readonly revivePrompt = el<HTMLDivElement>("revivePrompt");
  private readonly reviveBar = el<HTMLDivElement>("reviveBar");
  private readonly reviveBarFill = el<HTMLDivElement>("reviveBarFill");
  private readonly bossHpBar = el<HTMLDivElement>("bossHpBar");
  private readonly bossHpName = el<HTMLDivElement>("bossHpName");
  private readonly bossHpFill = el<HTMLDivElement>("bossHpFill");
  private readonly bossHpText = el<HTMLDivElement>("bossHpText");
  private zombieBannerTimer = 0;
  private readonly teamKillsAlphaEl = el<HTMLSpanElement>("teamKillsAlpha");
  private readonly teamKillsEchoEl = el<HTMLSpanElement>("teamKillsEcho");
  private readonly teamKillsTargetEl = el<HTMLSpanElement>("teamKillsTarget");
  private readonly killFeed = el<HTMLDivElement>("killFeed");
  private readonly scoreboard = el<HTMLDivElement>("scoreboard");
  private readonly scoreboardBody = el<HTMLTableSectionElement>("scoreboardBody");
  private readonly scoreboardFfaTable = el<HTMLTableElement>("scoreboardFfaTable");
  private readonly scoreboardTdm = el<HTMLDivElement>("scoreboardTdm");
  private readonly scoreboardAlphaBody = el<HTMLTableSectionElement>("scoreboardAlphaBody");
  private readonly scoreboardEchoBody = el<HTMLTableSectionElement>("scoreboardEchoBody");
  private readonly scoreAlphaTotal = el<HTMLSpanElement>("scoreAlphaTotal");
  private readonly scoreEchoTotal = el<HTMLSpanElement>("scoreEchoTotal");
  private readonly scoreboardSwitchTeam = el<HTMLButtonElement>("scoreboardSwitchTeam");
  /** Posição original do placar no DOM (ele entra no fluxo da tela de fim). */
  private scoreboardHome: { parent: HTMLElement; next: ChildNode | null } | null = null;
  private readonly deathScreen = el<HTMLDivElement>("deathScreen");
  private readonly deathInfo = el<HTMLDivElement>("deathInfo");
  private readonly deathWeapon = el<HTMLDivElement>("deathWeapon");
  private readonly deathKillerHp = el<HTMLDivElement>("deathKillerHp");
  private readonly deathKillerHpFill = el<HTMLDivElement>("deathKillerHpFill");
  private readonly deathKillerHpText = el<HTMLSpanElement>("deathKillerHpText");
  private readonly deathCount = el<HTMLDivElement>("deathCount");
  private readonly deathTimer = el<HTMLDivElement>("deathTimer");
  private lastDeathSecond = -1;
  private readonly endScreen = el<HTMLDivElement>("endScreen");
  private readonly endTitle = el<HTMLDivElement>("endTitle");
  private readonly endXpSummary = el<HTMLDivElement>("endXpSummary");
  private readonly hitmarker = el<HTMLDivElement>("hitmarker");
  private readonly killBadge = el<HTMLDivElement>("killBadge");
  private readonly killStars = el<HTMLDivElement>("killStars");
  private readonly killBadgeLabel = el<HTMLSpanElement>("killBadgeLabel");
  private readonly lowHealthVignette = el<HTMLDivElement>("lowHealthVignette");
  private readonly damageVignette = el<HTMLDivElement>("damageVignette");
  private readonly damageDirection = el<HTMLDivElement>("damageDirection");
  private readonly wallhackVignette = el<HTMLDivElement>("wallhackVignette");
  private readonly predatorVignette = el<HTMLDivElement>("predatorVignette");
  private readonly hudRoot = el<HTMLDivElement>("hud");
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
  private readonly streakTimeline = el<HTMLDivElement>("streakTimeline");
  private killStreaksEnabled = true;

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
  /** Streaks liberados aguardando ativação (ids vindos do servidor). */
  private availableStreakIds: string[] = [];
  private activeStreakId = "";
  private devUnlockStreaks = false;
  private predatorHud = false;

  private static readonly KILL_STREAK_WINDOW_MS = 5000;
  private static readonly KILL_BADGE_VISIBLE_MS = 2200;
  private static readonly KILL_LABELS = [
    "KILL",
    "DOUBLE KILL",
    "TRIPLE KILL",
    "QUADRA KILL",
    "MULTI KILL",
  ] as const;

  onSwitchTeam: (() => void) | null = null;
  onScoreboardPlayerMenu:
    | ((
        target: { userId: number; name: string; isBot?: boolean },
        x: number,
        y: number
      ) => void)
    | null = null;

  constructor() {
    this.renderStreakTimeline(0);
    this.scoreboardSwitchTeam.addEventListener("click", () => this.onSwitchTeam?.());
    this.scoreboard.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const tr = (e.target as HTMLElement).closest("tr[data-score-player]");
      if (!tr || !this.scoreboard.contains(tr) || tr.classList.contains("me")) return;
      this.onScoreboardPlayerMenu?.(
        {
          userId: Number(tr.getAttribute("data-user-id") ?? "0") || 0,
          name: tr.getAttribute("data-player-name") ?? "",
          isBot: tr.getAttribute("data-is-bot") === "1",
        },
        e.clientX,
        e.clientY
      );
    });
  }

  setHealth(current: number, max: number = CONFIG.playerMaxHealth): void {
    const cap = Math.max(1, max);
    const pct = Math.max(0, Math.min(1, current / cap));
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthFill.style.setProperty(
      "--hp-color",
      max > CONFIG.playerMaxHealth
        ? pct > 0.5
          ? "#d4a017"
          : pct > 0.25
            ? "#c07832"
            : "#c44a3a"
        : pct > 0.5
          ? "#7aab45"
          : pct > 0.25
            ? "#c4a04a"
            : "#c44a3a"
    );
    this.healthText.textContent = String(Math.ceil(current));
    this.healthPanel.classList.toggle("heli", max > CONFIG.playerMaxHealth);
    this.updateLowHealthVignette(max > CONFIG.playerMaxHealth ? 1 : pct);
  }

  setPredatorHud(on: boolean): void {
    this.predatorHud = on;
    this.healthPanel.classList.toggle("heli", on);
    this.hudRoot.classList.toggle("predator", on);
    this.predatorVignette.classList.toggle("hidden", !on);
    if (on) {
      this.weaponName.textContent = "Minigun";
      this.ammoMag.textContent = "∞";
      this.ammoReserve.textContent = "heli";
      this.ammoMag.classList.remove("low");
    }
  }

  /** Escurece/avermelha a tela conforme a vida cai (efeito de sangue). */
  private updateLowHealthVignette(healthPct: number): void {
    const startAt = 0.65;
    const maxOpacity = 0.78;

    if (healthPct >= startAt) {
      this.lowHealthVignette.style.opacity = "0";
      this.lowHealthVignette.classList.remove("critical");
      return;
    }

    const t = (startAt - healthPct) / startAt;
    const opacity = t * t * maxOpacity;
    this.lowHealthVignette.style.opacity = String(opacity);
    this.lowHealthVignette.classList.toggle("critical", healthPct < 0.25);
  }

  /** Atualiza os 3 slots do kit (principal / secundária / melee). */
  setLoadoutWeapons(weapons: WeaponDef[], activeIndex = 0): void {
    this.loadoutWeapons = weapons;
    this.setWeapon(activeIndex);
  }

  setAmmo(mag: number, reserve: number, reloading: boolean): void {
    if (this.predatorHud) {
      this.weaponName.textContent = "Minigun";
      this.ammoMag.textContent = "∞";
      this.ammoReserve.textContent = "heli";
      this.ammoMag.classList.remove("low");
      return;
    }
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
  private teamScoreAlpha = 0;
  private teamScoreEcho = 0;

  /** Define o total de kills para vencer (vem da config da sala). */
  setKillsTarget(target: number): void {
    this.killsTarget = target;
    this.teamKillsTargetEl.textContent = String(target);
  }

  setScoreMode(mode: "ffa" | "tdm" | "zombies"): void {
    this.killsPanelFfa.classList.toggle("hidden", mode !== "ffa");
    this.killsPanelTdm.classList.toggle("hidden", mode !== "tdm");
    this.killsPanelZombies.classList.toggle("hidden", mode !== "zombies");
    this.setKillStreaksEnabled(mode !== "zombies");
  }

  private setKillStreaksEnabled(on: boolean): void {
    if (on === this.killStreaksEnabled) return;
    this.killStreaksEnabled = on;
    this.streakTimeline.classList.toggle("hidden", !on);
    if (!on) {
      this.streakActivePanel.classList.add("hidden");
      this.resetKillStreak();
    } else {
      this.renderStreakTimeline(this.currentKillStreak);
    }
  }

  setZombieHud(round: number, left: number): void {
    this.zombieRoundHud.textContent = String(round);
    this.zombieLeftHud.textContent = String(left);
  }

  setBossHealth(hp: number, max: number, name = "Zumbi Boss"): void {
    const on = max > 0;
    this.bossHpBar.classList.toggle("hidden", !on);
    if (!on) return;
    this.bossHpName.textContent = name.toUpperCase();
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    this.bossHpFill.style.width = `${pct}%`;
    this.bossHpText.textContent = `${Math.max(0, Math.ceil(hp))} / ${Math.ceil(max)}`;
  }

  showZombieBanner(title: string, sub = "", seconds = 3): void {
    this.zombieBannerTitle.textContent = title;
    this.zombieBannerSub.textContent = sub;
    this.zombieBanner.classList.remove("hidden");
    window.clearTimeout(this.zombieBannerTimer);
    this.zombieBannerTimer = window.setTimeout(() => {
      this.zombieBanner.classList.add("hidden");
    }, seconds * 1000);
  }

  hideZombieBanner(): void {
    window.clearTimeout(this.zombieBannerTimer);
    this.zombieBanner.classList.add("hidden");
  }

  setRevivePrompt(on: boolean, progress = 0): void {
    this.revivePrompt.classList.toggle("hidden", !on);
    this.reviveBar.classList.toggle("hidden", !on || progress <= 0);
    this.reviveBarFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  setKills(kills: number): void {
    this.killCount.textContent = `${kills} / ${this.killsTarget}`;
  }

  setTeamScores(alpha: number, echo: number): void {
    this.teamScoreAlpha = alpha;
    this.teamScoreEcho = echo;
    this.teamKillsAlphaEl.textContent = String(alpha);
    this.teamKillsEchoEl.textContent = String(echo);
    this.scoreAlphaTotal.textContent = String(alpha);
    this.scoreEchoTotal.textContent = String(echo);
  }

  /** Atualiza a timeline de kill streaks (kills sem morrer). */
  setKillStreak(count: number): void {
    if (!this.killStreaksEnabled) return;
    const streak = Math.max(0, Math.floor(count));
    if (streak === this.currentKillStreak) return;
    this.currentKillStreak = streak;
    this.renderStreakTimeline(streak);
  }

  setDevUnlockStreaks(on: boolean): void {
    if (on === this.devUnlockStreaks) return;
    this.devUnlockStreaks = on;
    this.renderStreakTimeline(this.currentKillStreak);
  }

  /**
   * Sincroniza os streaks liberados (aguardando tecla) e o streak ativo.
   * Re-renderiza a timeline apenas quando algo muda.
   */
  updateAvailableStreaks(ids: string[], activeId: string): void {
    if (!this.killStreaksEnabled) return;
    const changed =
      activeId !== this.activeStreakId ||
      ids.length !== this.availableStreakIds.length ||
      ids.some((id, i) => id !== this.availableStreakIds[i]);
    if (!changed) return;
    this.availableStreakIds = ids;
    this.activeStreakId = activeId;
    this.renderStreakTimeline(this.currentKillStreak);
  }

  private renderStreakTimeline(streak: number): void {
    if (!this.killStreaksEnabled) return;
    this.streakTlCount.textContent = String(streak);

    const rewards = KILL_STREAK_REWARDS;
    const maxKills = rewards[rewards.length - 1]?.kills ?? 1;
    const fillPct = Math.max(0, Math.min(1, streak / maxKills)) * 100;
    this.streakTlFill.style.height = `${fillPct}%`;

    const next = nextKillStreakReward(streak);

    this.streakTlNodes.innerHTML = rewards
      .map((reward) => {
        const unlocked = this.devUnlockStreaks || streak >= reward.kills;
        const available = this.devUnlockStreaks
          ? !this.activeStreakId
          : this.availableStreakIds.includes(reward.id);
        const active = this.activeStreakId === reward.id;
        const isNext = next?.id === reward.id;
        const remain = Math.max(0, reward.kills - streak);
        const key = killStreakKeyLabel(reward.id);
        const classes = ["streak-tl-node"];
        if (unlocked) classes.push("earned");
        if (isNext && !available && !active) classes.push("next");
        if (available) classes.push("available");
        if (active) classes.push("active");

        let dot: string | number = reward.kills;
        if (active) dot = "▶";
        else if (available) dot = key;
        else if (unlocked) dot = "✓";

        let statusHtml = "";
        if (active) {
          statusHtml = `<div class="streak-tl-active-tag">ATIVO</div>`;
        } else if (available) {
          statusHtml = `<div class="streak-tl-press">pressione ${key}</div>`;
        } else if (isNext && remain > 0) {
          statusHtml = `<div class="streak-tl-remain">faltam ${remain}</div>`;
        }

        return (
          `<div class="${classes.join(" ")}">` +
          `<div class="streak-tl-dot">${dot}</div>` +
          `<div class="streak-tl-info">` +
          `<div class="streak-tl-req">${reward.icon} ${reward.kills} KILLS</div>` +
          `<div class="streak-tl-name">${reward.name}</div>` +
          statusHtml +
          `</div></div>`
        );
      })
      .join("");

    if (this.devUnlockStreaks && !this.activeStreakId) {
      const hints = KILL_STREAK_REWARDS.map((r) => {
        return `[${killStreakKeyLabel(r.id)}] ${r.name}`;
      });
      this.streakTlHint.textContent = `Dev — Ativar: ${hints.join(" · ")}`;
    } else if (this.availableStreakIds.length > 0) {
      const hints = this.availableStreakIds.map((id) => {
        const name =
          KILL_STREAK_REWARDS.find((r) => r.id === id)?.name ?? id;
        return `[${killStreakKeyLabel(id)}] ${name}`;
      });
      this.streakTlHint.textContent = `Ativar: ${hints.join(" · ")}`;
    } else if (next) {
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
    const streak = this.killStreaksEnabled
      ? this.bumpPlayerStreak(killerId)
      : 1;
    this.addKillFeedEntry(killerName, victimName, weapon, streak);
    if (showLocalBadge && this.killStreaksEnabled) this.showKillBadge(streak);
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

  /** Esconde a insignia local (ex.: ao morrer) e limpa a pilha de streaks. */
  resetKillStreak(): void {
    clearTimeout(this.killBadgeTimeout);
    this.killBadge.classList.remove("show");
    this.availableStreakIds = [];
    this.activeStreakId = "";
    this.setKillStreak(0);
    // setKillStreak não re-renderiza quando o streak já era 0.
    this.renderStreakTimeline(this.currentKillStreak);
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

  setScoreboardVisible(on: boolean, rows?: ScoreRow[], showSwitch = false): void {
    if (!on) this.restoreScoreboard();
    this.scoreboard.classList.toggle("hidden", !on);
    this.scoreboardSwitchTeam.classList.toggle(
      "hidden",
      !on || !showSwitch || this.scoreboard.classList.contains("end-mode")
    );
    if (on && rows) this.renderScoreboard(rows);
  }

  /** Tira o placar do fluxo da tela de fim e o devolve ao HUD in-game. */
  private restoreScoreboard(): void {
    if (!this.scoreboard.classList.contains("end-mode")) return;
    this.scoreboard.classList.remove("end-mode");
    const home = this.scoreboardHome;
    if (home) {
      const anchor =
        home.next && home.next.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(this.scoreboard, anchor);
    }
  }

  renderScoreboard(rows: ScoreRow[]): void {
    const tdm = rows.some((r) => r.team === "alpha" || r.team === "echo");
    this.scoreboardFfaTable.classList.toggle("hidden", tdm);
    this.scoreboardTdm.classList.toggle("hidden", !tdm);
    if (!tdm) {
      this.scoreboardBody.innerHTML = rows.map((c) => this.scoreRowHtml(c)).join("");
      return;
    }
    const alpha = rows.filter((r) => r.team === "alpha");
    const echo = rows.filter((r) => r.team === "echo");
    this.scoreAlphaTotal.textContent = String(this.teamScoreAlpha);
    this.scoreEchoTotal.textContent = String(this.teamScoreEcho);
    this.scoreboardAlphaBody.innerHTML =
      alpha.length > 0
        ? alpha.map((c) => this.scoreRowHtml(c)).join("")
        : `<tr><td colspan="4" class="score-empty">Ninguém nesta equipe</td></tr>`;
    this.scoreboardEchoBody.innerHTML =
      echo.length > 0
        ? echo.map((c) => this.scoreRowHtml(c)).join("")
        : `<tr><td colspan="4" class="score-empty">Ninguém nesta equipe</td></tr>`;
  }

  private scoreRowHtml(c: ScoreRow): string {
    const tags = [
      c.isHost ? `<span class="score-tag host">Líder</span>` : "",
      c.isPlayer ? `<span class="score-tag you">você</span>` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const rank = rankForXp(c.xp);
    const classes = [c.isPlayer ? "me" : "", c.isHost ? "host" : ""]
      .filter(Boolean)
      .join(" ");
    return `
      <tr class="${classes}" data-score-player="1" data-user-id="${c.userId ?? 0}" data-player-name="${escapeHtml(c.name)}" data-is-bot="${c.isBot ? "1" : "0"}">
        <td><img class="score-rank" src="${rankIconUrl(rank)}" alt="${rank.name}" title="${rank.name}" /></td>
        <td>${escapeHtml(c.name)}${tags ? ` ${tags}` : ""}</td>
        <td>${c.kills}</td>
        <td>${c.deaths}</td>
      </tr>`;
  }

  showDeathScreen(
    killerName: string,
    weaponName: string,
    killerHealth = 0,
    downed = false
  ): void {
    if (!this.endScreen.classList.contains("hidden")) return;
    this.deathInfo.textContent = killerName || "?";
    this.deathWeapon.textContent = weaponName ? `[${weaponName}]` : "";
    const hp = Math.max(0, Math.round(killerHealth));
    const pct = Math.max(0, Math.min(1, hp / CONFIG.playerMaxHealth));
    this.deathKillerHpFill.style.width = `${pct * 100}%`;
    this.deathKillerHpFill.style.setProperty(
      "--hp-color",
      pct > 0.5 ? "#7aab45" : pct > 0.25 ? "#c4a04a" : "#c44a3a"
    );
    this.deathKillerHpText.textContent = `${hp} HP`;
    this.deathKillerHp.classList.toggle("hidden", !killerName);
    this.lastDeathSecond = -1;
    this.deathCount.classList.toggle("hidden", downed);
    this.deathTimer.textContent = downed
      ? "Aguarde um aliado · Segure F no corpo"
      : "Reinserção…";
    this.deathScreen.classList.remove("hidden");
  }

  updateDeathTimer(seconds: number): void {
    if (this.deathCount.classList.contains("hidden")) return;
    const n = Math.max(0, Math.ceil(seconds));
    this.deathCount.textContent = String(n);
    this.deathTimer.textContent = n > 0 ? "Reinserção…" : "";
    if (n !== this.lastDeathSecond) {
      this.lastDeathSecond = n;
      this.deathCount.classList.remove("pop");
      void this.deathCount.offsetWidth;
      this.deathCount.classList.add("pop");
    }
  }

  hideDeathScreen(): void {
    this.deathScreen.classList.add("hidden");
    this.deathCount.classList.remove("hidden");
    this.lastDeathSecond = -1;
  }

  showEndScreen(
    winnerName: string,
    playerWon: boolean,
    rows: ScoreRow[],
    xp?: EndXpSummary
  ): void {
    this.hideDeathScreen();
    this.setRevivePrompt(false);
    this.endTitle.textContent = playerWon
      ? "Missão cumprida"
      : winnerName.startsWith("Round")
        ? `Derrota — ${winnerName}`
        : `${winnerName} venceu a partida`;
    if (xp && xp.earned > 0) {
      const gold = xp.gold;
      const hasGold = gold !== undefined && gold.earned > 0;
      const xpLinesHtml =
        xp.lines.length > 0
          ? `<div class="end-xp-lines">` +
            xp.lines
              .map(
                (l) =>
                  `<div class="end-xp-line"><span>${escapeHtml(l.label)}</span><span>+${l.xp}</span></div>`
              )
              .join("") +
            `</div>`
          : "";
      const goldLinesHtml =
        hasGold && gold.lines.length > 0
          ? `<div class="end-xp-lines end-gold-lines">` +
            gold.lines
              .map(
                (l) =>
                  `<div class="end-xp-line end-gold-line"><span>${escapeHtml(l.label)}</span><span>+${l.gold}</span></div>`
              )
              .join("") +
            `</div>`
          : "";
      const totalsHtml = hasGold
        ? `<div class="end-totals"><div class="end-xp">+${xp.earned} XP</div><div class="end-gold">+${gold.earned} Gold</div></div>`
        : `<div class="end-xp">+${xp.earned} XP</div>`;
      // XP e Gold lado a lado: reduz a altura do resumo na tela de fim.
      const linesHtml =
        xpLinesHtml && goldLinesHtml
          ? `<div class="end-rewards">${xpLinesHtml}${goldLinesHtml}</div>`
          : xpLinesHtml + goldLinesHtml;
      this.endXpSummary.innerHTML =
        totalsHtml +
        linesHtml +
        (xp.rankedUp
          ? `<div class="end-rankup">` +
            `<img src="${xp.rankIcon}" alt="${xp.rankName}" />` +
            `<span>Promovido a <b>${xp.rankName}</b></span>` +
            `</div>`
          : "");
      this.endXpSummary.classList.remove("hidden");
    } else {
      this.endXpSummary.innerHTML = "";
      this.endXpSummary.classList.add("hidden");
    }
    // Placar entra no fluxo da tela de fim (entre o resumo e os botões),
    // assim o resumo de XP/Gold nunca fica por cima dele.
    if (!this.scoreboardHome) {
      this.scoreboardHome = {
        parent: this.scoreboard.parentElement ?? document.body,
        next: this.scoreboard.nextSibling,
      };
    }
    this.endScreen.insertBefore(
      this.scoreboard,
      this.endScreen.querySelector(".end-actions")
    );
    this.scoreboard.classList.add("end-mode");
    this.endScreen.classList.remove("hidden");
    this.setScoreboardVisible(true, rows);
  }

  /** Esconde a tela de fim e devolve o placar ao overlay do HUD. */
  hideEndScreen(): void {
    this.endScreen.classList.add("hidden");
    this.setScoreboardVisible(false);
  }

  updateActiveStreak(streakName: string, timeLeft: number): void {
    if (!this.killStreaksEnabled) {
      this.streakActivePanel.classList.add("hidden");
      this.wallhackVignette.classList.add("hidden");
      this.predatorVignette.classList.add("hidden");
      return;
    }
    if (streakName) {
      this.streakActivePanel.classList.remove("hidden");
      this.streakActiveTitle.textContent = streakName.replace("_", " ").toUpperCase();
      this.streakTimeText.textContent = `${Math.ceil(timeLeft)}s`;
      
      const reward = KILL_STREAK_REWARDS.find((r) => r.id === streakName);
      const duration = reward?.duration ?? 15;
      const pct = Math.max(0, Math.min(100, (timeLeft / duration) * 100));
      this.streakActiveBar.style.width = `${pct}%`;

      this.streakActiveIcon.textContent = reward?.icon ?? "⚡";

      if (streakName === "wall_hacker") {
        this.wallhackVignette.classList.remove("hidden");
      } else {
        this.wallhackVignette.classList.add("hidden");
      }
      this.predatorVignette.classList.toggle("hidden", streakName !== "predator");
    } else {
      this.streakActivePanel.classList.add("hidden");
      this.wallhackVignette.classList.add("hidden");
      this.predatorVignette.classList.add("hidden");
    }
  }

  /** Blur dourado nas bordas enquanto o jogador local está invencível. */
  setInvincibleVignette(on: boolean): void {
    this.invincibleVignette.classList.toggle("hidden", !on);
  }

  showKillstreakToast(message: string): void {
    if (!this.killStreaksEnabled) return;
    const toast = document.createElement("div");
    toast.className = "streak-toast";
    toast.textContent = message;
    this.streakToastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }
}
