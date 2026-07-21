import { WEAPONS } from "../../shared/weapons";
import { CONFIG } from "../../shared/config";

/** Linha do placar (dados vêm do estado do servidor). */
export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
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
  private readonly damageVignette = el<HTMLDivElement>("damageVignette");

  private hitmarkerTimeout = 0;
  private vignetteTimeout = 0;

  constructor() {
    this.renderWeaponSlots(0);
  }

  setHealth(current: number): void {
    const pct = Math.max(0, Math.min(1, current / CONFIG.playerMaxHealth));
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthFill.style.background =
      pct > 0.5 ? "#6fd66f" : pct > 0.25 ? "#e8c14a" : "#e05545";
    this.healthText.textContent = String(Math.ceil(current));
  }

  setAmmo(mag: number, reserve: number, reloading: boolean): void {
    this.ammoMag.textContent = reloading ? "--" : String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle("low", !reloading && mag <= 5);
  }

  setWeapon(index: number): void {
    this.weaponName.textContent = WEAPONS[index].name;
    this.renderWeaponSlots(index);
  }

  private renderWeaponSlots(activeIndex: number): void {
    this.weaponSlots.innerHTML = WEAPONS.map(
      (w, i) =>
        `<div class="slot${i === activeIndex ? " active" : ""}">${i + 1}·${w.name}</div>`
    ).join("");
  }

  setKills(kills: number): void {
    this.killCount.textContent = `${kills} / ${CONFIG.killsToWin}`;
  }

  addKillFeedEntry(killer: string, victim: string, weapon: string): void {
    const entry = document.createElement("div");
    entry.className = "feed-entry";
    entry.innerHTML = `<b>${killer}</b> <span class="feed-weapon">[${weapon}]</span> ${victim}`;
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

  flashDamage(): void {
    this.damageVignette.classList.add("show");
    clearTimeout(this.vignetteTimeout);
    this.vignetteTimeout = window.setTimeout(
      () => this.damageVignette.classList.remove("show"),
      250
    );
  }

  setScoreboardVisible(on: boolean, rows?: ScoreRow[]): void {
    this.scoreboard.classList.toggle("hidden", !on);
    if (on && rows) this.renderScoreboard(rows);
  }

  renderScoreboard(rows: ScoreRow[]): void {
    this.scoreboardBody.innerHTML = rows
      .map(
        (c) => `
      <tr class="${c.isPlayer ? "me" : ""}">
        <td>${c.name}${c.isPlayer ? " (você)" : ""}</td>
        <td>${c.kills}</td>
        <td>${c.deaths}</td>
      </tr>`
      )
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
}
