import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math";
import type { Room } from "colyseus.js";

import { createScene } from "./scene/createScene";
import { FpsController } from "./player/FpsController";
import { ViewModel } from "./player/ViewModel";
import { WeaponSystem } from "./game/WeaponSystem";
import { EffectsManager } from "./game/effects";
import { Hud, ScoreRow } from "./ui/Hud";
import { AudioManager } from "./game/audio";
import { RemotePlayer } from "./net/RemotePlayer";
import {
  listRooms,
  createRoom,
  joinRoomById,
  forEachPlayer,
  PlayerSnapshot,
  RoomListing,
} from "./net/NetworkClient";
import { Minimap } from "./ui/Minimap";
import { CONFIG } from "../shared/config";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const mainMenu = document.getElementById("mainMenu") as HTMLDivElement;
const settingsModal = document.getElementById("settingsModal") as HTMLDivElement;
const settingsButton = document.getElementById("settingsButton") as HTMLButtonElement;
const resumeButton = document.getElementById("resumeButton") as HTMLButtonElement;
const quitButton = document.getElementById("quitButton") as HTMLButtonElement;
const closeSettingsButton = document.getElementById("closeSettingsButton") as HTMLButtonElement;
const restartButton = document.getElementById("restartButton") as HTMLButtonElement;
const menuButton = document.getElementById("menuButton") as HTMLButtonElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const statusEl = document.getElementById("connectionStatus") as HTMLParagraphElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const sensSlider = document.getElementById("sensSlider") as HTMLInputElement;
const sensValue = document.getElementById("sensValue") as HTMLSpanElement;
const botsSlider = document.getElementById("botsSlider") as HTMLInputElement;
const botsValue = document.getElementById("botsValue") as HTMLSpanElement;
const volSlider = document.getElementById("volSlider") as HTMLInputElement;
const volValue = document.getElementById("volValue") as HTMLSpanElement;
const debugModeToggle = document.getElementById("debugModeToggle") as HTMLInputElement;
const roomListEl = document.getElementById("roomList") as HTMLDivElement;
const refreshRoomsButton = document.getElementById("refreshRoomsButton") as HTMLButtonElement;
const createRoomButton = document.getElementById("createRoomButton") as HTMLButtonElement;
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

const scene = createScene(engine);
const effects = new EffectsManager(scene);
const hud = new Hud();
const audio = new AudioManager();
const minimap = new Minimap(minimapCanvas);

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

// --- Configuração: volume ---
const VOL_STORAGE_KEY = "fps.volume";

function applyVolume(value: number): void {
  audio.setVolume(value);
  volSlider.value = String(value);
  volValue.textContent = `${Math.round(value * 100)}%`;
}

volSlider.addEventListener("input", () => {
  const value = parseFloat(volSlider.value);
  applyVolume(value);
  localStorage.setItem(VOL_STORAGE_KEY, String(value));
});

const savedVol = parseFloat(localStorage.getItem(VOL_STORAGE_KEY) ?? "0.5");
applyVolume(Number.isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 0.5);

// --- Modo debug (a vida continua sendo aplicada pelo servidor) ---
const DEBUG_STORAGE_KEY = "fps.debugMode";
let debugMode = localStorage.getItem(DEBUG_STORAGE_KEY) === "true";
debugModeToggle.checked = debugMode;

function applyDebugMode(on: boolean): void {
  debugMode = on;
  debugModeToggle.checked = on;
  weapons.setInfiniteAmmo(on);
  for (const remote of remotePlayers.values()) remote.setDebugHitboxes(on);
  room?.send("setDebug", { enabled: on });
}

debugModeToggle.addEventListener("change", () => {
  applyDebugMode(debugModeToggle.checked);
  localStorage.setItem(DEBUG_STORAGE_KEY, String(debugModeToggle.checked));
});

// --- Estado da sessão ---
let room: Room | null = null;
/** True do momento em que entra numa sala até voltar ao menu. */
let inGame = false;
const remotePlayers = new Map<string, RemotePlayer>();
let ownInitialized = false;
let lastKnownHealth: number = CONFIG.playerMaxHealth;
let playerDead = false;
let deathCountdown = 0;
let endScreenShown = false;
/** Ping medido pelo cliente (ms), para o indicador no HUD. */
let pingMs: number | null = null;

// --- Lobby: lista de salas ---
let lobbyRefreshInterval = 0;

function playerName(): string {
  return nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
}

async function enterLobby(): Promise<void> {
  window.clearInterval(lobbyRefreshInterval);
  createRoomButton.disabled = false;
  refreshRoomsButton.disabled = false;
  await refreshRooms();
  lobbyRefreshInterval = window.setInterval(refreshRooms, 3000);
}

async function refreshRooms(): Promise<void> {
  let rooms: RoomListing[];
  try {
    rooms = await listRooms();
  } catch {
    statusEl.classList.add("error");
    statusEl.textContent = "Servidor offline. Rode `npm run server`.";
    roomListEl.innerHTML = `<p class="no-rooms">Sem conexão com o servidor.</p>`;
    return;
  }
  statusEl.classList.remove("error");
  statusEl.textContent = "";
  renderRoomList(rooms);
}

function renderRoomList(rooms: RoomListing[]): void {
  if (rooms.length === 0) {
    roomListEl.innerHTML = `<p class="no-rooms">Nenhuma sala disponível.<br />Crie a primeira!</p>`;
    return;
  }

  roomListEl.innerHTML = "";
  for (const r of rooms) {
    const row = document.createElement("div");
    row.className = "room-row";

    const info = document.createElement("div");
    info.className = "room-info";
    info.innerHTML =
      `<b>Sala ${r.roomId.slice(0, 6)}</b><br />` +
      `<span class="room-meta">${r.clients}/${r.maxClients} jogadores · Mapa: ${r.map}</span>`;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Entrar";
    joinBtn.addEventListener("click", () => void joinLobbyRoom(r.roomId));

    row.append(info, joinBtn);
    roomListEl.appendChild(row);
  }
}

/** Entra numa sala existente (roomId) ou cria uma nova (null). */
async function joinLobbyRoom(roomId: string | null): Promise<void> {
  window.clearInterval(lobbyRefreshInterval);
  createRoomButton.disabled = true;
  refreshRoomsButton.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = roomId ? "Entrando na sala…" : "Criando sala…";

  try {
    room = roomId
      ? await joinRoomById(roomId, playerName())
      : await createRoom(playerName());
  } catch {
    statusEl.classList.add("error");
    statusEl.textContent = roomId
      ? "Não foi possível entrar (sala cheia ou fechada)."
      : "Não foi possível criar a sala.";
    createRoomButton.disabled = false;
    refreshRoomsButton.disabled = false;
    await refreshRooms();
    lobbyRefreshInterval = window.setInterval(refreshRooms, 3000);
    return;
  }

  statusEl.textContent = "";
  createRoomButton.disabled = false;
  refreshRoomsButton.disabled = false;
  startGame(room);
}

refreshRoomsButton.addEventListener("click", () => void refreshRooms());
createRoomButton.addEventListener("click", () => void joinLobbyRoom(null));

// --- Entrar / sair do jogo 3D ---
function startGame(r: Room): void {
  inGame = true;
  mainMenu.classList.add("hidden");
  settingsModal.classList.add("hidden");

  // Prediction: cada passo fixo local vira um input enviado ao servidor.
  player.onInput = (input) => {
    if (ownInitialized) room?.send("input", input);
  };

  setupRoom(r);
  applyDebugMode(debugMode);

  audio.resume();
  player.requestPointerLock();
  // Se o navegador negar o lock (gesto "gasto" pelo await do join),
  // mostra o modal de pausa como porta de entrada.
  window.setTimeout(() => {
    if (inGame && !player.isPointerLocked) openPauseModal();
  }, 400);
}

/** Volta ao menu inicial, limpando todo o estado da partida. */
function resetToMenu(errorMsg?: string): void {
  inGame = false;
  room = null;
  ownInitialized = false;
  playerDead = false;
  endScreenShown = false;
  lastKnownHealth = CONFIG.playerMaxHealth;
  pingMs = null;

  for (const rp of remotePlayers.values()) rp.dispose();
  remotePlayers.clear();

  weapons.setTrigger(false);
  weapons.refillAll();
  weapons.setEnabled(true);
  player.setMovementEnabled(true);

  hud.hideDeathScreen();
  hud.setScoreboardVisible(false);
  hud.setHealth(CONFIG.playerMaxHealth);
  hud.setKills(0);
  document.getElementById("endScreen")!.classList.add("hidden");

  settingsModal.classList.add("hidden");
  document.exitPointerLock();
  mainMenu.classList.remove("hidden");

  if (errorMsg) {
    statusEl.classList.add("error");
    statusEl.textContent = errorMsg;
  }
  void enterLobby();
}

// --- Modal de configurações / pausa ---
function openPauseModal(): void {
  settingsModal.classList.remove("hidden", "menu-mode");
  settingsModal.classList.add("pause-mode");
}

function openMenuSettings(): void {
  settingsModal.classList.remove("hidden", "pause-mode");
  settingsModal.classList.add("menu-mode");
}

settingsButton.addEventListener("click", openMenuSettings);
closeSettingsButton.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});
resumeButton.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
  audio.resume();
  player.requestPointerLock();
});
quitButton.addEventListener("click", () => {
  // O onLeave da sala chama resetToMenu().
  void room?.leave();
});

function setupRoom(r: Room): void {
  r.onStateChange(() => reconcile(r));

  r.onMessage("kill", (e: {
    killerId: string;
    killerName: string;
    victimName: string;
    weaponName: string;
  }) => {
    hud.addKillFeedEntry(e.killerName, e.victimName, e.weaponName);
    if (e.killerId === r.sessionId) audio.killConfirm();
  });

  r.onMessage("died", (e: { killerName: string; weaponName: string }) => {
    playerDead = true;
    deathCountdown = CONFIG.respawnDelay;
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
    hud.showDeathScreen(e.killerName, e.weaponName);
    audio.death();
  });

  r.onMessage("respawn", (e: { x: number; z: number }) => {
    player.teleport(new Vector3(e.x, 0, e.z));
    weapons.refillAll();
    weapons.setEnabled(true);
    player.setMovementEnabled(true);
    playerDead = false;
    hud.hideDeathScreen();
    audio.respawn();
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
    audio.remoteShot(Vector3.Distance(from, player.getHead()));
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
    audio.remoteShot(Vector3.Distance(from, player.getHead()));
  });

  r.onMessage("debugShot", (e: {
    origin: { x: number; y: number; z: number };
    ends: Array<{ x: number; y: number; z: number }>;
  }) => {
    if (!debugMode) return;
    const origin = new Vector3(e.origin.x, e.origin.y, e.origin.z);
    for (const end of e.ends) {
      effects.spawnDebugTracer(origin, new Vector3(end.x, end.y, end.z));
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
  r.send("setDebug", { enabled: debugMode });

  r.onMessage("matchReset", () => {
    endScreenShown = false;
    document.getElementById("endScreen")!.classList.add("hidden");
    hud.setScoreboardVisible(false);
    hud.setKills(0);
  });

  r.onLeave((code) => {
    window.clearInterval(pingInterval);
    // 1000 = saída consentida (botão "Sair para o menu"); acima disso é queda.
    resetToMenu(code > 1000 ? "Desconectado do servidor." : undefined);
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
      rp.setDebugHitboxes(debugMode);
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
    if (p.health < lastKnownHealth) {
      hud.flashDamage();
      audio.damaged();
    }
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
    const headshot = data.localHits.some((h) => h.part === "head");
    hud.showHitmarker(headshot);
    audio.hitmarker(headshot);
  }
  audio.shoot(weapons.weapon.id);
};

weapons.onRecoil = (kick) => {
  player.applyRecoil(kick);
  viewModel.triggerKick(kick / 0.01);
};

let wasReloading = false;
weapons.onStateChanged = () => {
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  hud.setWeapon(weapons.weaponIndex);
  viewModel.setReloading(weapons.isReloading);
  if (weapons.isReloading && !wasReloading) audio.reload();
  wasReloading = weapons.isReloading;
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

menuButton.addEventListener("click", () => {
  void room?.leave();
});

// WebAudio precisa de um gesto do usuário para tocar.
restartButton.addEventListener("click", () => audio.resume());

// Clique no jogo (fora do lock) retoma o pointer lock.
canvas.addEventListener("click", () => {
  if (inGame && !player.isPointerLocked && settingsModal.classList.contains("hidden")) {
    player.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (player.isPointerLocked) {
    audio.resume();
    settingsModal.classList.add("hidden");
  } else if (inGame && !endScreenShown) {
    // ESC no jogo → modal de pausa (configurações + sair para o menu).
    openPauseModal();
  }
});

// --- Render loop ---
let debugAccumulator = 0;
let footstepAccumulator = 0;
let minimapAccumulator = 0;

hud.setHealth(CONFIG.playerMaxHealth);
hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, false);
hud.setWeapon(0);
hud.setKills(0);

engine.runRenderLoop(() => {
  // No menu inicial nada é simulado nem renderizado.
  if (!inGame) return;

  const dt = engine.getDeltaTime() / 1000;

  player.update(dt);
  player.updateRecoil(dt, weapons.isShooting);
  weapons.update(dt);
  viewModel.update(dt);
  for (const rp of remotePlayers.values()) rp.update(dt);

  // Som de passos.
  if (player.isMovingOnGround) {
    footstepAccumulator += dt;
    const interval = player.isRunning ? 0.3 : 0.42;
    if (footstepAccumulator >= interval) {
      footstepAccumulator = 0;
      audio.footstep();
    }
  } else {
    footstepAccumulator = 0;
  }

  // Contagem da tela de morte.
  if (playerDead) {
    deathCountdown = Math.max(0, deathCountdown - dt);
    hud.updateDeathTimer(deathCountdown);
  }

  // Minimapa (~15 Hz é suficiente).
  minimapAccumulator += dt;
  if (minimapAccumulator >= 1 / 15) {
    minimapAccumulator = 0;
    const feet = player.getFeet();
    minimap.draw(feet.x, feet.z, player.getYaw());
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

void enterLobby();
