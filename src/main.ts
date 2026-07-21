import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math";
import type { Room } from "colyseus.js";

import { createScene } from "./scene/createScene";
import { FpsController } from "./player/FpsController";
import { ViewModel } from "./player/ViewModel";
import { WeaponSystem } from "./game/WeaponSystem";
import { EffectsManager } from "./game/effects";
import { Hud, ScoreRow } from "./ui/Hud";
import { RemotePlayer } from "./net/RemotePlayer";
import { joinDeathmatch, forEachPlayer, PlayerSnapshot } from "./net/NetworkClient";
import { CONFIG } from "../shared/config";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const playButton = document.getElementById("playButton") as HTMLButtonElement;
const restartButton = document.getElementById("restartButton") as HTMLButtonElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const statusEl = document.getElementById("connectionStatus") as HTMLParagraphElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const sensSlider = document.getElementById("sensSlider") as HTMLInputElement;
const sensValue = document.getElementById("sensValue") as HTMLSpanElement;
const botsSlider = document.getElementById("botsSlider") as HTMLInputElement;
const botsValue = document.getElementById("botsValue") as HTMLSpanElement;

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

const scene = createScene(engine);
const effects = new EffectsManager(scene);
const hud = new Hud();

const player = new FpsController(scene, canvas, {
  spawnPosition: new Vector3(0, 0, -18),
});
scene.activeCamera = player.camera;

const viewModel = new ViewModel(scene, player.camera);
const weapons = new WeaponSystem(scene, player.camera, effects, "self");
viewModel.setWeapon(weapons.weapon);

// --- Configurações (sensibilidade persistida) ---
const SENS_STORAGE_KEY = "fps.sensitivity";

function loadSensitivity(): void {
  const saved = parseFloat(localStorage.getItem(SENS_STORAGE_KEY) ?? "1");
  const value = Number.isFinite(saved) ? Math.min(3, Math.max(0.1, saved)) : 1;
  sensSlider.value = String(value);
  applySensitivity(value);
}

function applySensitivity(value: number): void {
  player.setSensitivity(value);
  sensValue.textContent = value.toFixed(2);
}

sensSlider.addEventListener("input", () => {
  const value = parseFloat(sensSlider.value);
  applySensitivity(value);
  localStorage.setItem(SENS_STORAGE_KEY, String(value));
});

loadSensitivity();

// --- Configuração: bots na sala ---
const BOTS_STORAGE_KEY = "fps.bots";

function loadBotsSetting(): void {
  const saved = parseInt(localStorage.getItem(BOTS_STORAGE_KEY) ?? "7", 10);
  const value = Number.isFinite(saved) ? Math.min(7, Math.max(0, saved)) : 7;
  botsSlider.value = String(value);
  botsValue.textContent = String(value);
}

botsSlider.addEventListener("input", () => {
  const value = parseInt(botsSlider.value, 10);
  botsValue.textContent = String(value);
  localStorage.setItem(BOTS_STORAGE_KEY, String(value));
  room?.send("setBots", { count: value });
});

loadBotsSetting();

// --- Estado da sessão ---
let room: Room | null = null;
const remotePlayers = new Map<string, RemotePlayer>();
let ownInitialized = false;
let lastKnownHealth: number = CONFIG.playerMaxHealth;
let playerDead = false;
let deathCountdown = 0;
let endScreenShown = false;
/** Ping medido pelo cliente (ms), para o indicador no HUD. */
let pingMs: number | null = null;

// --- Conexão ---
async function connect(): Promise<void> {
  playButton.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = "Conectando ao servidor…";

  const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;

  try {
    room = await joinDeathmatch(name);
  } catch {
    statusEl.classList.add("error");
    statusEl.textContent =
      "Servidor offline. Rode `npm run server` e tente de novo.";
    playButton.textContent = "Tentar novamente";
    playButton.disabled = false;
    playButton.onclick = () => connect();
    return;
  }

  statusEl.textContent = "Conectado!";
  playButton.textContent = "Clique para jogar";
  playButton.disabled = false;
  playButton.onclick = () => player.requestPointerLock();

  // Prediction: cada passo fixo local vira um input enviado ao servidor.
  player.onInput = (input) => {
    if (ownInitialized) room?.send("input", input);
  };

  setupRoom(room);
}

function setupRoom(r: Room): void {
  r.onStateChange(() => reconcile(r));

  r.onMessage("kill", (e: { killerName: string; victimName: string; weaponName: string }) => {
    hud.addKillFeedEntry(e.killerName, e.victimName, e.weaponName);
  });

  r.onMessage("died", (e: { killerName: string; weaponName: string }) => {
    playerDead = true;
    deathCountdown = CONFIG.respawnDelay;
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
    hud.showDeathScreen(e.killerName, e.weaponName);
  });

  r.onMessage("respawn", (e: { x: number; z: number }) => {
    player.teleport(new Vector3(e.x, 0, e.z));
    weapons.refillAll();
    weapons.setEnabled(true);
    player.setMovementEnabled(true);
    playerDead = false;
    hud.hideDeathScreen();
  });

  // Tiros dos bots (server-side).
  r.onMessage("shot", (e: {
    shooterId: string;
    targetId: string;
    hit: boolean;
    endX: number;
    endY: number;
    endZ: number;
  }) => {
    const from = shooterHead(e.shooterId);
    if (!from) return;
    const end = new Vector3(e.endX, e.endY, e.endZ);
    effects.spawnTracer(from, end);
    effects.spawnImpact(end, e.hit);
  });

  // Tiros de outros humanos (retransmitidos pelo servidor).
  r.onMessage("remoteShots", (e: {
    shooterId: string;
    ends: Array<{ x: number; y: number; z: number }>;
  }) => {
    const from = shooterHead(e.shooterId);
    if (!from) return;
    for (const end of e.ends) {
      effects.spawnTracer(from, new Vector3(end.x, end.y, end.z));
    }
  });

  r.onMessage("matchEnd", () => {
    // Tratado via estado no reconcile (matchOver), aqui só trava input.
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
  });

  // Medição de RTT do servidor (usada no rewind da lag compensation).
  r.onMessage("sping", (msg: { t: number }) => {
    r.send("spong", msg);
  });

  // Ping do cliente (indicador no HUD): eco a cada 2s.
  r.onMessage("cpong", (msg: { t: number }) => {
    pingMs = Math.max(0, Math.round(performance.now() - msg.t));
  });
  const pingInterval = window.setInterval(() => {
    r.send("cping", { t: performance.now() });
  }, 2000);
  r.send("cping", { t: performance.now() });

  // Aplica a configuração de bots salva.
  r.send("setBots", { count: parseInt(botsSlider.value, 10) });

  r.onMessage("matchReset", () => {
    endScreenShown = false;
    document.getElementById("endScreen")!.classList.add("hidden");
    hud.setScoreboardVisible(false);
    hud.setKills(0);
  });

  r.onLeave(() => {
    window.clearInterval(pingInterval);
    pingMs = null;
    statusEl.classList.add("error");
    statusEl.textContent = "Desconectado do servidor.";
    playButton.textContent = "Reconectar";
    playButton.onclick = () => window.location.reload();
    overlay.classList.remove("hidden");
  });
}

/** Origem dos tracers de tiros remotos: cabeça do atirador. */
function shooterHead(shooterId: string): Vector3 | null {
  const rp = remotePlayers.get(shooterId);
  if (rp) return rp.getHead();
  if (room && shooterId === room.sessionId) return null; // meus tiros já têm tracer
  return null;
}

/** Sincroniza o estado do servidor com as entidades locais. */
function reconcile(r: Room): void {
  const seen = new Set<string>();

  forEachPlayer(r, (p: PlayerSnapshot, id: string) => {
    seen.add(id);

    if (id === r.sessionId) {
      handleOwnState(p);
      return;
    }

    let rp = remotePlayers.get(id);
    if (!rp) {
      rp = new RemotePlayer(scene, id, p.name);
      remotePlayers.set(id, rp);
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive);
      rp.snapToTarget();
    } else {
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive);
    }
  });

  for (const [id, rp] of remotePlayers) {
    if (!seen.has(id)) {
      rp.dispose();
      remotePlayers.delete(id);
    }
  }

  const state = r.state as { matchOver?: boolean; winnerName?: string };
  if (state.matchOver && !endScreenShown) {
    endScreenShown = true;
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
    const own = getOwnSnapshot(r);
    hud.showEndScreen(
      state.winnerName ?? "?",
      state.winnerName === own?.name,
      scoreboardRows(r)
    );
    document.exitPointerLock();
  }
}

function handleOwnState(p: PlayerSnapshot): void {
  if (!ownInitialized) {
    ownInitialized = true;
    player.teleport(new Vector3(p.x, p.y, p.z));
  }

  // Reconciliação: replay dos inputs pendentes sobre o estado autoritativo.
  if (!playerDead) {
    player.reconcile({
      x: p.x,
      y: p.y,
      z: p.z,
      vy: p.vy,
      grounded: p.grounded,
      lastSeq: p.lastSeq,
    });
  }

  if (p.health !== lastKnownHealth) {
    if (p.health < lastKnownHealth) hud.flashDamage();
    hud.setHealth(p.health);
    lastKnownHealth = p.health;
  }
  hud.setKills(p.kills);
}

function getOwnSnapshot(r: Room): PlayerSnapshot | null {
  let own: PlayerSnapshot | null = null;
  forEachPlayer(r, (p, id) => {
    if (id === r.sessionId) own = p;
  });
  return own;
}

function scoreboardRows(r: Room): ScoreRow[] {
  const rows: ScoreRow[] = [];
  forEachPlayer(r, (p, id) => {
    rows.push({
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      isPlayer: id === r.sessionId,
    });
  });
  return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

// --- Wiring: armas ---
// O cliente envia origem + direções; o SERVIDOR decide o acerto e o dano
// (hitscan com lag compensation). O hitmarker local é otimista.
weapons.onFire = (data) => {
  if (!room) return;
  room.send("fire", {
    weaponId: weapons.weapon.id,
    ox: data.origin.x,
    oy: data.origin.y,
    oz: data.origin.z,
    dirs: data.dirs.map((d) => ({ x: d.x, y: d.y, z: d.z })),
  });

  if (data.localHits.length > 0) {
    hud.showHitmarker(data.localHits.some((h) => h.part === "head"));
  }
};

weapons.onRecoil = (kick) => {
  player.applyRecoil(kick);
  viewModel.triggerKick(kick / 0.01);
};

weapons.onStateChanged = () => {
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  hud.setWeapon(weapons.weaponIndex);
  viewModel.setReloading(weapons.isReloading);
};

// --- Input de combate ---
canvas.addEventListener("mousedown", (e) => {
  if (!player.isPointerLocked) return;
  if (e.button === 0) weapons.setTrigger(true);
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) weapons.setTrigger(false);
});
window.addEventListener("wheel", (e) => {
  if (!player.isPointerLocked) return;
  weapons.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  viewModel.setWeapon(weapons.weapon);
});
window.addEventListener("keydown", (e) => {
  if (!player.isPointerLocked) return;
  if (e.code === "KeyR") weapons.startReload();
  if (e.code === "Digit1") switchTo(0);
  if (e.code === "Digit2") switchTo(1);
  if (e.code === "Digit3") switchTo(2);
  if (e.code === "Tab") {
    e.preventDefault();
    if (room) hud.setScoreboardVisible(true, scoreboardRows(room));
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Tab" && !endScreenShown) {
    hud.setScoreboardVisible(false);
  }
});

function switchTo(index: number): void {
  weapons.switchWeapon(index);
  viewModel.setWeapon(weapons.weapon);
}

// --- Overlay / Pointer Lock ---
restartButton.addEventListener("click", () => {
  document.getElementById("endScreen")!.classList.add("hidden");
  hud.setScoreboardVisible(false);
  player.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  if (player.isPointerLocked) {
    overlay.classList.add("hidden");
  } else if (!endScreenShown) {
    overlay.classList.remove("hidden");
  }
});

// --- Render loop ---
let debugAccumulator = 0;

hud.setHealth(CONFIG.playerMaxHealth);
hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, false);
hud.setWeapon(0);
hud.setKills(0);

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;

  player.update(dt);
  weapons.update(dt);
  viewModel.update(dt);
  for (const rp of remotePlayers.values()) rp.update(dt);

  // Contagem da tela de morte.
  if (playerDead) {
    deathCountdown = Math.max(0, deathCountdown - dt);
    hud.updateDeathTimer(deathCountdown);
  }

  scene.render();

  debugAccumulator += dt;
  if (debugAccumulator > 0.2) {
    debugAccumulator = 0;
    const conn = room
      ? `ping ${pingMs !== null ? `${pingMs}ms` : "--"}`
      : "offline";
    debugEl.textContent = `${engine.getFps().toFixed(0)} fps · ${conn}\n${player.getDebugInfo()}`;
  }
});

window.addEventListener("resize", () => engine.resize());

connect();
