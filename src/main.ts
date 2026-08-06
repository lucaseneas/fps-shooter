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
import {
  AuthSession,
  AuthUser,
  clearStoredToken,
  fetchAuthStatus,
  fetchProfile,
  loginAccount,
  registerAccount,
  restoreSession,
} from "./net/authApi";
import { Minimap } from "./ui/Minimap";
import { CONFIG } from "../shared/config";
import {
  LOADOUTS,
  LoadoutId,
  getLoadout,
  getWeapon,
  weaponMoveSpeedMult,
} from "../shared/weapons";
import { AppRoute, navigate, onRouteChange } from "./app/router";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const pageLogin = document.getElementById("pageLogin") as HTMLDivElement;
const pageHome = document.getElementById("pageHome") as HTMLDivElement;
const settingsModal = document.getElementById("settingsModal") as HTMLDivElement;
const loadoutModal = document.getElementById("loadoutModal") as HTMLDivElement;
const loadoutOptions = document.getElementById("loadoutOptions") as HTMLDivElement;
const loadoutHint = document.getElementById("loadoutHint") as HTMLParagraphElement;
const loadoutCancelButton = document.getElementById(
  "loadoutCancelButton"
) as HTMLButtonElement;
const spawnButton = document.getElementById("spawnButton") as HTMLButtonElement;
const spectateButton = document.getElementById("spectateButton") as HTMLButtonElement;
const spectateBanner = document.getElementById("spectateBanner") as HTMLDivElement;
const hudRoot = document.getElementById("hud") as HTMLDivElement;
const settingsButton = document.getElementById("settingsButton") as HTMLButtonElement;
const homeSettingsButton = document.getElementById("homeSettingsButton") as HTMLButtonElement;
const resumeButton = document.getElementById("resumeButton") as HTMLButtonElement;
const quitButton = document.getElementById("quitButton") as HTMLButtonElement;
const closeSettingsButton = document.getElementById("closeSettingsButton") as HTMLButtonElement;
const restartButton = document.getElementById("restartButton") as HTMLButtonElement;
const menuButton = document.getElementById("menuButton") as HTMLButtonElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const guestPanel = document.getElementById("guestPanel") as HTMLDivElement;
const guestContinueButton = document.getElementById("guestContinueButton") as HTMLButtonElement;
const statusEl = document.getElementById("connectionStatus") as HTMLParagraphElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const debugSpreadCircle = document.getElementById("debug-spread-circle") as HTMLDivElement;
const chatLog = document.getElementById("chatLog") as HTMLDivElement;
const chatForm = document.getElementById("chatForm") as HTMLFormElement;
const chatInput = document.getElementById("chatInput") as HTMLInputElement;
const sensSlider = document.getElementById("sensSlider") as HTMLInputElement;
const sensValue = document.getElementById("sensValue") as HTMLSpanElement;
const botsSlider = document.getElementById("botsSlider") as HTMLInputElement;
const botsValue = document.getElementById("botsValue") as HTMLSpanElement;
const volSlider = document.getElementById("volSlider") as HTMLInputElement;
const volValue = document.getElementById("volValue") as HTMLSpanElement;
const reticleSelect = document.getElementById("reticleSelect") as HTMLSelectElement;
const debugModeToggle = document.getElementById("debugModeToggle") as HTMLInputElement;
const roomListEl = document.getElementById("roomList") as HTMLDivElement;
const refreshRoomsButton = document.getElementById("refreshRoomsButton") as HTMLButtonElement;
const createRoomButton = document.getElementById("createRoomButton") as HTMLButtonElement;
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
const authTabLogin = document.getElementById("authTabLogin") as HTMLButtonElement;
const authTabRegister = document.getElementById("authTabRegister") as HTMLButtonElement;
const authForm = document.getElementById("authForm") as HTMLFormElement;
const authUsername = document.getElementById("authUsername") as HTMLInputElement;
const authPassword = document.getElementById("authPassword") as HTMLInputElement;
const authSubmit = document.getElementById("authSubmit") as HTMLButtonElement;
const authStatus = document.getElementById("authStatus") as HTMLParagraphElement;
const logoutButton = document.getElementById("logoutButton") as HTMLButtonElement;
const homeDisplayName = document.getElementById("homeDisplayName") as HTMLElement;
const homeMemberSince = document.getElementById("homeMemberSince") as HTMLElement;
const statKills = document.getElementById("statKills") as HTMLElement;
const statDeaths = document.getElementById("statDeaths") as HTMLElement;
const statWins = document.getElementById("statWins") as HTMLElement;
const statMatches = document.getElementById("statMatches") as HTMLElement;
const statKd = document.getElementById("statKd") as HTMLElement;
const statWinRate = document.getElementById("statWinRate") as HTMLElement;

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
  const value = Number.isFinite(saved) ? Math.min(2, Math.max(0.05, saved)) : 1;
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

// --- Retícula ---
const RETICLE_STORAGE_KEY = "fps.reticle";
const RETICLE_TYPES = new Set(["cross", "dot", "ring", "chevron"]);

function applyReticle(type: string): void {
  const selected = RETICLE_TYPES.has(type) ? type : "cross";
  document.getElementById("crosshair")!.dataset.style = selected;
  reticleSelect.value = selected;
}

applyReticle(localStorage.getItem(RETICLE_STORAGE_KEY) ?? "cross");
reticleSelect.addEventListener("change", () => {
  applyReticle(reticleSelect.value);
  localStorage.setItem(RETICLE_STORAGE_KEY, reticleSelect.value);
});

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
let chatTyping = false;
/** Overlay de seleção de kit aberto (pré-spawn ou tecla I). */
let loadoutPicking = false;
/** true = troca a meio da partida (pode cancelar). */
let loadoutPickInMatch = false;
/** Na sala, ainda não pediu spawn (espectador top-down ou freefly). */
let awaitingSpawn = false;
/** Em câmera livre no mapa (invisível, sem arma). */
let freeSpectating = false;
/** Kit já escolhido nesta sessão de pré-spawn (habilita o botão Spawn). */
let preSpawnKitReady = false;
/** Última arma antes da troca atual — Q alterna entre as duas. */
let lastWeaponIndex = 1;
/** Ping medido pelo cliente (ms), para o indicador no HUD. */
let pingMs: number | null = null;

// --- Auth / páginas ---
let authEnabled = false;
let authMode: "login" | "register" = "login";
let session: AuthSession | null = null;
let guestAllowed = false;
let lobbyRefreshInterval = 0;

function setAuthMessage(text: string, isError = false): void {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", isError);
}

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Membro desde ${d.toLocaleDateString("pt-BR")}`;
}

function renderProfile(user: AuthUser): void {
  homeDisplayName.textContent = user.username;
  homeMemberSince.textContent = formatMemberSince(user.createdAt);
  statKills.textContent = String(user.kills);
  statDeaths.textContent = String(user.deaths);
  statWins.textContent = String(user.wins);
  statMatches.textContent = String(user.matches);
  const kd = user.deaths > 0 ? user.kills / user.deaths : user.kills;
  statKd.textContent = kd.toFixed(2);
  const winRate = user.matches > 0 ? Math.round((user.wins / user.matches) * 100) : 0;
  statWinRate.textContent = `${winRate}%`;
}

function setAuthMode(mode: "login" | "register"): void {
  authMode = mode;
  authTabLogin.classList.toggle("active", mode === "login");
  authTabRegister.classList.toggle("active", mode === "register");
  authSubmit.textContent = mode === "login" ? "Entrar" : "Criar conta";
  authPassword.autocomplete =
    mode === "login" ? "current-password" : "new-password";
  setAuthMessage("");
}

function showPages(route: AppRoute): void {
  const onLogin = route === "/login";
  const onHome = route === "/home";
  pageLogin.classList.toggle("hidden", !onLogin);
  pageHome.classList.toggle("hidden", !onHome);
}

function applyRoute(route: AppRoute): void {
  if (route === "/play") {
    if (!inGame) {
      navigate(session || guestAllowed ? "/home" : "/login", true);
      return;
    }
    pageLogin.classList.add("hidden");
    pageHome.classList.add("hidden");
    return;
  }

  if (route === "/home") {
    if (inGame) {
      void room?.leave();
      return;
    }
    if (authEnabled && !session && !guestAllowed) {
      navigate("/login", true);
      return;
    }
    showPages("/home");
    void enterHome();
    return;
  }

  // /login
  if (inGame) {
    void room?.leave();
    return;
  }
  if (authEnabled && session) {
    navigate("/home", true);
    return;
  }
  if (!authEnabled && guestAllowed) {
    navigate("/home", true);
    return;
  }
  showPages("/login");
  window.clearInterval(lobbyRefreshInterval);
}

authTabLogin.addEventListener("click", () => setAuthMode("login"));
authTabRegister.addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void (async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    authSubmit.disabled = true;
    setAuthMessage(authMode === "login" ? "A entrar…" : "A criar conta…");

    const result =
      authMode === "login"
        ? await loginAccount(username, password)
        : await registerAccount(username, password);

    authSubmit.disabled = false;
    if (!result.ok) {
      setAuthMessage(result.error, true);
      return;
    }

    session = result.session;
    guestAllowed = false;
    authPassword.value = "";
    setAuthMessage("");
    navigate("/home");
  })();
});

guestContinueButton.addEventListener("click", () => {
  guestAllowed = true;
  navigate("/home");
});

logoutButton.addEventListener("click", () => {
  clearStoredToken();
  session = null;
  guestAllowed = false;
  window.clearInterval(lobbyRefreshInterval);
  navigate("/login");
  setAuthMessage("Sessão terminada.");
});

async function initAuth(): Promise<void> {
  authEnabled = await fetchAuthStatus();
  guestPanel.classList.toggle("hidden", authEnabled);
  authForm.classList.toggle("hidden", !authEnabled);
  document.querySelector(".auth-tabs")?.classList.toggle("hidden", !authEnabled);

  if (authEnabled) {
    session = await restoreSession();
  } else {
    session = null;
  }
}

function playerName(): string {
  if (session) return session.user.username;
  return nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
}

async function enterHome(): Promise<void> {
  window.clearInterval(lobbyRefreshInterval);
  if (session) {
    const profile = await fetchProfile();
    if (profile) {
      session = { ...session, user: profile };
      renderProfile(profile);
    } else {
      renderProfile(session.user);
    }
  } else {
    homeDisplayName.textContent = playerName();
    homeMemberSince.textContent = "Modo convidado";
    statKills.textContent = "—";
    statDeaths.textContent = "—";
    statWins.textContent = "—";
    statMatches.textContent = "—";
    statKd.textContent = "—";
    statWinRate.textContent = "—";
  }
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
    joinBtn.addEventListener("click", () => beginJoinFlow(r.roomId));

    row.append(info, joinBtn);
    roomListEl.appendChild(row);
  }
}

/** Entra numa sala existente (roomId) ou cria uma nova (null). */
async function joinLobbyRoom(roomId: string | null): Promise<void> {
  if (authEnabled && !session) {
    statusEl.classList.add("error");
    statusEl.textContent = "Entra na conta para jogar.";
    navigate("/login");
    return;
  }

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
      ? "Não foi possível entrar (sala cheia, fechada ou sem login)."
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

/** Abre a escolha de kit e só depois entra/cria a sala. */
function beginJoinFlow(roomId: string | null): void {
  if (authEnabled && !session) {
    statusEl.classList.add("error");
    statusEl.textContent = "Entra na conta para jogar.";
    navigate("/login");
    return;
  }
  void joinLobbyRoom(roomId);
}

refreshRoomsButton.addEventListener("click", () => void refreshRooms());
createRoomButton.addEventListener("click", () => beginJoinFlow(null));

onRouteChange((route) => applyRoute(route));

// --- Kit de armamento (Assault / Recon / Rusher) ---
const LOADOUT_STORAGE_KEY = "fps.loadout";
const SLOT_LABELS = ["1 Principal", "2 Secundária", "3 Melee"] as const;

function savedLoadoutId(): LoadoutId {
  const saved = localStorage.getItem(LOADOUT_STORAGE_KEY);
  return getLoadout(saved ?? "")?.id ?? "assault";
}

function renderLoadoutOptions(): void {
  const selected = weapons.loadout;
  loadoutOptions.innerHTML = "";
  for (const kit of LOADOUTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `loadout-option${kit.id === selected ? " selected" : ""}`;
    const slots = [kit.primary, kit.secondary, kit.melee]
      .map((id, i) => {
        const name = getWeapon(id)?.name ?? id;
        return `<span>${SLOT_LABELS[i]} — ${name}</span>`;
      })
      .join("");
    btn.innerHTML = `
      <span class="loadout-option-name">${kit.name}</span>
      <span class="loadout-option-blurb">${kit.blurb}</span>
      <span class="loadout-option-slots">${slots}</span>
    `;
    btn.addEventListener("click", () => confirmLoadout(kit.id));
    loadoutOptions.appendChild(btn);
  }
}

function applySelectedLoadout(id: LoadoutId): void {
  weapons.setLoadoutById(id, true);
  localStorage.setItem(LOADOUT_STORAGE_KEY, id);
  lastWeaponIndex = 1;
  hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  viewModel.setWeapon(weapons.weapon);
  player.setSpeedMult(weaponMoveSpeedMult(weapons.weapon));
}

/** Entra na sala em espectador (topo) até escolher kit e clicar Spawn. */
function enterPreSpawn(): void {
  awaitingSpawn = true;
  // Já há um kit guardado — basta confirmar com Spawn (pode trocar antes).
  applySelectedLoadout(savedLoadoutId());
  preSpawnKitReady = true;
  ownInitialized = false;
  playerDead = false;
  weapons.setTrigger(false);
  weapons.setEnabled(false);
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  viewModel.setVisible(false);
  player.enterSpectatorOverview();
  hudRoot.classList.add("prespawn");
  openLoadoutModal(false);
}

function exitPreSpawn(): void {
  awaitingSpawn = false;
  preSpawnKitReady = false;
  freeSpectating = false;
  hudRoot.classList.remove("prespawn", "freefly");
  loadoutModal.classList.remove("prespawn");
  spawnButton.classList.add("hidden");
  spawnButton.disabled = false;
  spectateButton.classList.add("hidden");
  spectateBanner.classList.add("hidden");
  player.exitSpectatorOverview();
  viewModel.setVisible(true);
  viewModel.setWeapon(weapons.weapon);
}

function openLoadoutModal(inMatch: boolean): void {
  loadoutPicking = true;
  loadoutPickInMatch = inMatch;
  weapons.setTrigger(false);
  settingsModal.classList.add("hidden");

  if (inMatch) {
    player.setMovementEnabled(false);
    player.setLookEnabled(false);
    if (player.isPointerLocked) player.releasePointerLock();
    loadoutHint.textContent =
      "Troca o kit agora. 1 Principal · 2 Secundária · 3 Melee. ESC cancela.";
    loadoutCancelButton.classList.remove("hidden");
    spawnButton.classList.add("hidden");
    spectateButton.classList.add("hidden");
    loadoutModal.classList.remove("prespawn");
  } else {
    loadoutHint.textContent = freeSpectating
      ? "Escolhe o kit e Spawn para jogar · ou ESC para continuar a voar."
      : "Escolhe um kit e Spawn, ou entra só a observar. Na partida, I troca o kit.";
    loadoutCancelButton.classList.toggle("hidden", !freeSpectating);
    loadoutModal.classList.add("prespawn");
    spawnButton.classList.toggle("hidden", !preSpawnKitReady);
    spawnButton.disabled = false;
    spectateButton.classList.toggle("hidden", freeSpectating);
    if (freeSpectating && player.isPointerLocked) {
      player.releasePointerLock();
    }
  }

  renderLoadoutOptions();
  loadoutModal.classList.remove("hidden");
}

function closeLoadoutModal(relock: boolean): void {
  if (!loadoutPicking) return;
  loadoutPicking = false;
  loadoutPickInMatch = false;
  loadoutModal.classList.add("hidden");
  loadoutModal.classList.remove("prespawn");
  loadoutCancelButton.classList.add("hidden");
  spawnButton.classList.add("hidden");
  spectateButton.classList.add("hidden");

  if (freeSpectating) {
    player.setLookEnabled(true);
    player.setMovementEnabled(false);
    if (relock && inGame && !endScreenShown) {
      player.requestPointerLock();
    }
    return;
  }

  if (awaitingSpawn) {
    // Pré-spawn overview: mantém câmera de cima até Spawn / Espectador.
    player.setLookEnabled(false);
    player.setMovementEnabled(false);
    return;
  }

  player.setLookEnabled(true);
  player.setMovementEnabled(!playerDead && !endScreenShown);
  if (relock && inGame && !playerDead && !endScreenShown) {
    player.requestPointerLock();
  }
}

function confirmLoadout(id: LoadoutId): void {
  applySelectedLoadout(id);
  exitAds();
  renderLoadoutOptions();

  // Pré-spawn / freefly: só marca o kit; precisa clicar em Spawn.
  if (awaitingSpawn && !loadoutPickInMatch) {
    preSpawnKitReady = true;
    spawnButton.classList.remove("hidden");
    spawnButton.disabled = false;
    if (!freeSpectating) spectateButton.classList.remove("hidden");
    return;
  }

  // Troca a meio da partida (tecla I).
  closeLoadoutModal(true);
}

function cancelLoadoutPick(): void {
  if (!loadoutPicking) return;
  if (loadoutPickInMatch || freeSpectating) {
    closeLoadoutModal(true);
  }
}

function requestPlayerSpawn(): void {
  if (!awaitingSpawn || !preSpawnKitReady || !room) return;
  spawnButton.disabled = true;
  room.send("requestSpawn");
}

/** Entra no mapa invisível, sem arma, câmera livre. */
function enterFreeSpectate(): void {
  if (!awaitingSpawn) return;
  freeSpectating = true;
  loadoutPicking = false;
  loadoutModal.classList.add("hidden");
  loadoutModal.classList.remove("prespawn");
  spawnButton.classList.add("hidden");
  spectateButton.classList.add("hidden");
  loadoutCancelButton.classList.add("hidden");

  hudRoot.classList.remove("prespawn");
  hudRoot.classList.add("freefly");
  spectateBanner.classList.remove("hidden");
  viewModel.setVisible(false);
  weapons.setTrigger(false);
  weapons.setEnabled(false);
  settingsModal.classList.add("hidden");

  player.enterFreeFlySpectator();
  player.requestPointerLock();
}

loadoutCancelButton.addEventListener("click", () => cancelLoadoutPick());
spawnButton.addEventListener("click", () => requestPlayerSpawn());
spectateButton.addEventListener("click", () => enterFreeSpectate());

// Aplica o último kit guardado (ou Assault) ao arrancar.
applySelectedLoadout(savedLoadoutId());

// --- Entrar / sair do jogo 3D ---
function startGame(r: Room): void {
  inGame = true;
  pageLogin.classList.add("hidden");
  pageHome.classList.add("hidden");
  settingsModal.classList.add("hidden");
  navigate("/play");

  // Prediction: cada passo fixo local vira um input enviado ao servidor.
  player.onInput = (input) => {
    if (ownInitialized && !awaitingSpawn) room?.send("input", input);
  };

  setupRoom(r);
  applyDebugMode(debugMode);

  audio.resume();
  enterPreSpawn();
}

/** Volta ao /home, limpando todo o estado da partida. */
function resetToMenu(errorMsg?: string): void {
  inGame = false;
  room = null;
  ownInitialized = false;
  playerDead = false;
  endScreenShown = false;
  awaitingSpawn = false;
  preSpawnKitReady = false;
  freeSpectating = false;
  lastKnownHealth = CONFIG.playerMaxHealth;
  pingMs = null;
  closeChat(false);
  chatLog.replaceChildren();
  if (loadoutPicking) {
    loadoutPicking = false;
    loadoutPickInMatch = false;
    loadoutModal.classList.add("hidden");
    loadoutModal.classList.remove("prespawn");
    loadoutCancelButton.classList.add("hidden");
    spawnButton.classList.add("hidden");
    spectateButton.classList.add("hidden");
  }
  hudRoot.classList.remove("prespawn", "freefly");
  spectateBanner.classList.add("hidden");
  player.exitSpectatorOverview();
  viewModel.setVisible(true);

  for (const rp of remotePlayers.values()) rp.dispose();
  remotePlayers.clear();

  weapons.setTrigger(false);
  weapons.refillAll();
  weapons.setEnabled(true);
  player.setMovementEnabled(true);
  player.setLookEnabled(true);

  hud.hideDeathScreen();
  hud.setScoreboardVisible(false);
  hud.setHealth(CONFIG.playerMaxHealth);
  hud.setKills(0);
  document.getElementById("endScreen")!.classList.add("hidden");

  settingsModal.classList.add("hidden");
  player.exitImmersive();

  if (errorMsg) {
    statusEl.classList.add("error");
    statusEl.textContent = errorMsg;
  }
  navigate("/home");
}

// --- Modal de configurações / pausa ---
function openPauseModal(): void {
  weapons.setTrigger(false);
  settingsModal.classList.remove("hidden", "menu-mode");
  settingsModal.classList.add("pause-mode");
}

function openMenuSettings(): void {
  settingsModal.classList.remove("hidden", "pause-mode");
  settingsModal.classList.add("menu-mode");
}

function openChat(): void {
  if (!inGame || playerDead || endScreenShown || chatTyping) return;
  chatTyping = true;
  weapons.setTrigger(false);
  player.setMovementEnabled(false);
  player.setLookEnabled(false);
  document.exitPointerLock();
  chatForm.classList.add("active");
  chatInput.value = "";
  chatInput.focus();
}

function closeChat(relock: boolean): void {
  if (!chatTyping) return;
  chatTyping = false;
  chatForm.classList.remove("active");
  chatInput.value = "";
  chatInput.blur();
  player.setLookEnabled(true);
  player.setMovementEnabled(!playerDead && !endScreenShown);
  if (relock && inGame && !playerDead && !endScreenShown) {
    player.requestPointerLock();
  }
}

function addChatMessage(name: string, text: string): void {
  const entry = document.createElement("div");
  entry.className = "chat-entry";
  const sender = document.createElement("span");
  sender.className = "chat-name";
  sender.textContent = `${name}: `;
  entry.append(sender, document.createTextNode(text));
  chatLog.append(entry);
  while (chatLog.childElementCount > 100) chatLog.firstElementChild?.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

settingsButton.addEventListener("click", openMenuSettings);
homeSettingsButton.addEventListener("click", openMenuSettings);
closeSettingsButton.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});
resumeButton.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
  audio.resume();
  if (awaitingSpawn) {
    if (freeSpectating) {
      if (!loadoutPicking) player.requestPointerLock();
      return;
    }
    if (!loadoutPicking) openLoadoutModal(false);
    return;
  }
  player.requestPointerLock();
});
quitButton.addEventListener("click", () => {
  // O onLeave da sala chama resetToMenu().
  void room?.leave();
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) room?.send("chat", { text });
  closeChat(true);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    e.preventDefault();
    closeChat(true);
  }
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

  // O servidor confirma que o dano foi aplicado antes de exibir o hitmarker.
  r.onMessage("hitConfirm", (e: { headshot: boolean }) => {
    hud.showHitmarker(e.headshot);
    audio.hitmarker(e.headshot);
  });

  r.onMessage("chat", (e: { name: string; text: string }) => {
    addChatMessage(e.name, e.text);
  });

  r.onMessage("died", (e: { killerName: string; weaponName: string }) => {
    closeChat(false);
    playerDead = true;
    deathCountdown = CONFIG.respawnDelay;
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
    exitAdsImmediate();
    hud.showDeathScreen(e.killerName, e.weaponName);
    audio.death();
  });

  r.onMessage("respawn", (e: { x: number; z: number }) => {
    const wasPreSpawn = awaitingSpawn;
    if (wasPreSpawn) {
      loadoutPicking = false;
      loadoutPickInMatch = false;
      loadoutModal.classList.add("hidden");
      loadoutModal.classList.remove("prespawn");
      loadoutCancelButton.classList.add("hidden");
      exitPreSpawn();
    }

    player.teleport(new Vector3(e.x, 0, e.z));
    ownInitialized = true;
    weapons.refillAll();
    weapons.setEnabled(true);
    player.setMovementEnabled(true);
    player.setLookEnabled(true);
    playerDead = false;
    hud.hideDeathScreen();
    audio.respawn();

    if (wasPreSpawn) {
      settingsModal.classList.add("hidden");
      player.requestPointerLock();
    }
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
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive, Boolean(p.crouch));
      rp.snapToTarget();
    } else {
      rp.applyState(p.x, p.y, p.z, p.yaw, p.alive, Boolean(p.crouch));
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
  if (awaitingSpawn) {
    // Ainda em espectador: não teleporta nem reconcilia no mapa.
    return;
  }

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
// (hitscan com lag compensation), incluindo a confirmação do hitmarker.
weapons.onFire = (data) => {
  if (!room) return;
  room.send("fire", {
    weaponId: weapons.weapon.id,
    ox: data.origin.x,
    oy: data.origin.y,
    oz: data.origin.z,
    dirs: data.dirs.map((d) => ({ x: d.x, y: d.y, z: d.z })),
  });

  audio.shoot(weapons.weapon.id);
};

weapons.onRecoil = (pitchKick, yawKick) => {
  player.applyRecoil(pitchKick, yawKick);
  viewModel.triggerKick(pitchKick / 0.01);
};

let wasReloading = false;
weapons.onStateChanged = () => {
  hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  viewModel.setReloading(weapons.isReloading);
  if (weapons.isReloading && !wasReloading) audio.reload();
  wasReloading = weapons.isReloading;
};

// --- Scope / ADS (sniper, botão direito = toggle) ---
const HIP_FOV = 1.15;
const SCOPE_FOV = 0.42; // zoom um pouco mais forte; overlay largo ainda mostra periferia
const ADS_SENS_SCALE = 0.38;
const scopeOverlay = document.getElementById("scopeOverlay")!;
const crosshairEl = document.getElementById("crosshair")!;

/** Scope por clique. Sai só no 2º RMB ou troca de arma (morte/unlock forçam saída). */
let adsToggled = false;
let adsAmount = 0;

function canAds(): boolean {
  return (
    player.isPointerLocked &&
    weapons.weapon.id === "sniper" &&
    !playerDead
  );
}

function refreshAds(): void {
  if (adsToggled && !canAds()) adsToggled = false;
  weapons.setAiming(adsToggled && canAds());
}

/** Sai do scope com lerp (RMB / troca de arma). */
function exitAds(): void {
  adsToggled = false;
  weapons.setAiming(false);
}

function exitAdsImmediate(): void {
  adsToggled = false;
  adsAmount = 0;
  weapons.setAiming(false);
  player.camera.fov = HIP_FOV;
  viewModel.setVisible(true);
  scopeOverlay.classList.remove("active");
  crosshairEl.classList.remove("scoped");
  const baseSens = parseFloat(sensSlider.value);
  if (Number.isFinite(baseSens)) player.setSensitivity(baseSens);
}

function updateAds(dt: number): void {
  if (awaitingSpawn) {
    viewModel.setVisible(false);
    return;
  }

  refreshAds();
  const target = weapons.isAiming ? 1 : 0;
  adsAmount += (target - adsAmount) * Math.min(1, dt * 14);

  if (adsAmount < 0.01) adsAmount = 0;
  if (adsAmount > 0.99) adsAmount = 1;

  player.camera.fov = HIP_FOV + (SCOPE_FOV - HIP_FOV) * adsAmount;
  viewModel.setVisible(adsAmount < 0.45);
  scopeOverlay.classList.toggle("active", adsAmount > 0.5);
  crosshairEl.classList.toggle("scoped", adsAmount > 0.35);

  const baseSens = parseFloat(sensSlider.value);
  if (Number.isFinite(baseSens)) {
    player.setSensitivity(baseSens * (1 - adsAmount * (1 - ADS_SENS_SCALE)));
  }
}

// --- Input de combate ---
canvas.addEventListener("mousedown", (e) => {
  if (!player.isPointerLocked) return;
  if (e.button === 0) weapons.setTrigger(true);
  if (e.button === 2) {
    e.preventDefault();
    // Sempre permite fechar; só abre se ainda puder usar ADS.
    if (adsToggled) {
      exitAds();
      return;
    }
    if (!canAds()) return;
    adsToggled = true;
    refreshAds();
  }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) weapons.setTrigger(false);
});
canvas.addEventListener("contextmenu", (e) => {
  if (player.isPointerLocked) e.preventDefault();
});
window.addEventListener("wheel", (e) => {
  if (!player.isPointerLocked) return;
  const from = weapons.weaponIndex;
  weapons.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  rememberWeaponSwitch(from);
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && inGame && player.isPointerLocked) {
    e.preventDefault();
    openChat();
    return;
  }
  if (loadoutPicking) return;
  if (!player.isPointerLocked) return;
  if (e.code === "KeyI") {
    e.preventDefault();
    if (awaitingSpawn) {
      // Em freefly: abre kit para spawnar. Em overview o modal já está aberto.
      if (freeSpectating && !loadoutPicking) openLoadoutModal(false);
      return;
    }
    if (!playerDead && !endScreenShown) openLoadoutModal(true);
    return;
  }
  if (e.code === "KeyR") weapons.startReload();
  if (e.code === "KeyQ") {
    e.preventDefault();
    switchTo(lastWeaponIndex);
  }
  // 1 principal · 2 secundária · 3 melee
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

/** Última arma antes da troca atual — Q alterna entre as duas. */
function rememberWeaponSwitch(fromIndex: number): void {
  if (weapons.weaponIndex === fromIndex) return;
  lastWeaponIndex = fromIndex;
  viewModel.setWeapon(weapons.weapon);
  player.setSpeedMult(weaponMoveSpeedMult(weapons.weapon));
  exitAds();
}

function switchTo(index: number): void {
  const from = weapons.weaponIndex;
  weapons.switchWeapon(index);
  rememberWeaponSwitch(from);
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
  if (
    inGame &&
    (!awaitingSpawn || freeSpectating) &&
    !player.isPointerLocked &&
    settingsModal.classList.contains("hidden") &&
    !loadoutPicking &&
    !chatTyping
  ) {
    player.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (player.isPointerLocked) {
    audio.resume();
    settingsModal.classList.add("hidden");
  } else if (inGame && !endScreenShown) {
    exitAdsImmediate();
    if (chatTyping || loadoutPicking) return;
    // Overview pré-spawn: sem pointer lock; não abre pausa por isso.
    if (awaitingSpawn && !freeSpectating) return;
    openPauseModal();
  }
});

// ESC: destrava o mouse e abre configurações (necessário com Keyboard Lock).
window.addEventListener(
  "keydown",
  (e) => {
    if (e.code !== "Escape" || endScreenShown) return;

    // Troca de kit a meio da partida, ou kit aberto no freefly: ESC cancela.
    if (loadoutPicking && (loadoutPickInMatch || freeSpectating)) {
      e.preventDefault();
      cancelLoadoutPick();
      return;
    }

    if (!inGame) return;

    if (chatTyping) {
      e.preventDefault();
      closeChat(true);
      return;
    }

    // Pré-spawn overview: ESC abre pausa (Sair) por cima da escolha de kit.
    if (awaitingSpawn && !freeSpectating) {
      e.preventDefault();
      if (
        !settingsModal.classList.contains("hidden") &&
        settingsModal.classList.contains("pause-mode")
      ) {
        settingsModal.classList.add("hidden");
        if (!loadoutPicking) openLoadoutModal(false);
      } else {
        openPauseModal();
      }
      return;
    }

    // Freefly / jogando: ESC solta o mouse e abre pausa.
    if (player.isPointerLocked) {
      e.preventDefault();
      player.releasePointerLock();
      openPauseModal();
      return;
    }

    // Já na pausa: ESC fecha e retoma.
    if (
      !settingsModal.classList.contains("hidden") &&
      settingsModal.classList.contains("pause-mode")
    ) {
      e.preventDefault();
      settingsModal.classList.add("hidden");
      audio.resume();
      if (awaitingSpawn && !freeSpectating) {
        if (!loadoutPicking) openLoadoutModal(false);
      } else {
        player.requestPointerLock();
      }
    }
  },
  true
);
// --- Render loop ---
let debugAccumulator = 0;
let footstepAccumulator = 0;
let minimapAccumulator = 0;

hud.setHealth(CONFIG.playerMaxHealth);
hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, false);
hud.setKills(0);

engine.runRenderLoop(() => {
  // No menu inicial nada é simulado nem renderizado.
  if (!inGame) return;

  const dt = engine.getDeltaTime() / 1000;

  player.update(dt);
  player.updateRecoil(dt, weapons.isShooting);
  weapons.setCrouching(player.isCrouching);
  weapons.setAirborne(!player.isGrounded);
  weapons.setMoving(player.isMovingOnGround);
  weapons.setRunning(player.isRunning);
  weapons.update(dt);
  updateAds(dt);
  viewModel.update(dt);

  if (debugMode) {
    const canvasHeight = canvas.clientHeight;
    const spreadRad = (weapons.currentSpread * Math.PI) / 180;
    const fov = player.camera.fov;
    const diameter = canvasHeight * Math.tan(spreadRad) / Math.tan(fov / 2);
    debugSpreadCircle.style.width = `${diameter}px`;
    debugSpreadCircle.style.height = `${diameter}px`;
    debugSpreadCircle.style.display = "block";
  } else {
    debugSpreadCircle.style.display = "none";
  }

  for (const rp of remotePlayers.values()) rp.update(dt);

  // Som de passos.
  if (player.isMovingOnGround) {
    footstepAccumulator += dt;
    const interval = player.isCrouching
      ? 0.55
      : player.isRunning
        ? 0.3
        : 0.42;
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

void (async () => {
  await initAuth();
  if (session) navigate("/home", true);
  else navigate("/login", true);
})();
