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
import { SkinPreview } from "./ui/SkinPreview";
import {
  listRooms,
  createRoom,
  joinRoomById,
  forEachPlayer,
  getMatchSnapshot,
  PlayerSnapshot,
  RoomListing,
  CreateRoomOptions,
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
  DEFAULT_LOADOUT,
  LoadoutSlots,
  WeaponCategory,
  WeaponDef,
  WeaponId,
  getWeapon,
  isMeleeWeapon,
  weaponMoveSpeedMult,
  weaponsForCategory,
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
const botsSettingRow = document.getElementById("botsSettingRow") as HTMLDivElement;
const botsHostHint = document.getElementById("botsHostHint") as HTMLParagraphElement;
const volSlider = document.getElementById("volSlider") as HTMLInputElement;
const volValue = document.getElementById("volValue") as HTMLSpanElement;
const reticleSelect = document.getElementById("reticleSelect") as HTMLSelectElement;
const debugModeToggle = document.getElementById("debugModeToggle") as HTMLInputElement;
const roomListEl = document.getElementById("roomList") as HTMLDivElement;
const refreshRoomsButton = document.getElementById("refreshRoomsButton") as HTMLButtonElement;
const createRoomButton = document.getElementById("createRoomButton") as HTMLButtonElement;
const createRoomModal = document.getElementById("createRoomModal") as HTMLDivElement;
const createRoomForm = document.getElementById("createRoomForm") as HTMLFormElement;
const createRoomName = document.getElementById("createRoomName") as HTMLInputElement;
const createMaxPlayers = document.getElementById("createMaxPlayers") as HTMLInputElement;
const createMaxPlayersValue = document.getElementById(
  "createMaxPlayersValue"
) as HTMLSpanElement;
const createBots = document.getElementById("createBots") as HTMLInputElement;
const createBotsValue = document.getElementById("createBotsValue") as HTMLSpanElement;
const createRoomCancel = document.getElementById("createRoomCancel") as HTMLButtonElement;
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
const skinPreviewCanvas = document.getElementById("skinPreviewCanvas") as HTMLCanvasElement;

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  stencil: true,
  antialias: true,
});

const scene = createScene(engine);
scene.setRenderingAutoClearDepthStencil(1, true, true, false);
scene.setRenderingAutoClearDepthStencil(2, true, true, false);
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

const SENS_STORAGE_KEY = "fps.sensitivity";

function loadSensitivity(): void {
  const saved = parseFloat(localStorage.getItem(SENS_STORAGE_KEY) ?? "1");
  const value = Number.isFinite(saved) ? Math.min(2, Math.max(0.05, saved)) : 1;
  sensSlider.value = String(value);
  applySensitivity(value);
}

let baseSensitivity = 1;
let adsAmount = 0;
const ADS_SENS_SCALE = 0.38;

function applySensitivity(value: number): void {
  baseSensitivity = value;
  player.setSensitivity(value * (1 - adsAmount * (1 - ADS_SENS_SCALE)));
  sensValue.textContent = value.toFixed(2);
}

sensSlider.addEventListener("input", () => {
  const value = parseFloat(sensSlider.value);
  applySensitivity(value);
  localStorage.setItem(SENS_STORAGE_KEY, String(value));
});

loadSensitivity();

const BOTS_STORAGE_KEY = "fps.bots";

function loadBotsSetting(): void {
  const saved = parseInt(localStorage.getItem(BOTS_STORAGE_KEY) ?? "7", 10);
  const value = Number.isFinite(saved) ? Math.min(7, Math.max(0, saved)) : 7;
  botsSlider.value = String(value);
  botsValue.textContent = String(value);
}

function isLocalHost(): boolean {
  if (!room) return false;
  const { hostId } = getMatchSnapshot(room);
  return hostId === room.sessionId;
}

function syncRoomSettingsUi(): void {
  if (!room) {
    botsSlider.disabled = false;
    botsSettingRow.classList.remove("is-locked");
    botsHostHint.textContent = "Define quantos bots preenchem a sala.";
    return;
  }

  const snap = getMatchSnapshot(room);
  const maxBots = Math.max(0, snap.maxPlayers - 1);
  botsSlider.max = String(maxBots);
  const bots = Math.min(maxBots, Math.max(0, snap.desiredBots));
  botsSlider.value = String(bots);
  botsValue.textContent = String(bots);

  const host = isLocalHost();
  botsSlider.disabled = !host;
  botsSettingRow.classList.toggle("is-locked", !host);
  botsHostHint.textContent = host
    ? "Você é o líder — só você altera os bots desta sala."
    : "Apenas o líder da sala pode alterar.";
}

botsSlider.addEventListener("input", () => {
  const value = parseInt(botsSlider.value, 10);
  botsValue.textContent = String(value);
  localStorage.setItem(BOTS_STORAGE_KEY, String(value));
  if (room && isLocalHost()) {
    room.send("setBots", { count: value });
  }
});

loadBotsSetting();

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

let room: Room | null = null;
let inGame = false;
const remotePlayers = new Map<string, RemotePlayer>();
let ownInitialized = false;
let lastKnownHealth: number = CONFIG.playerMaxHealth;
let playerDead = false;
let deathCountdown = 0;
let endScreenShown = false;
let chatTyping = false;
let loadoutPicking = false;
let loadoutPickInMatch = false;
let awaitingSpawn = false;
let freeSpectating = false;
let preSpawnKitReady = false;
let lastWeaponIndex = 1;
let pingMs: number | null = null;
let serverRttMs = 0;
let skinPreview: SkinPreview | null = null;

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
    const safeName = r.name.replace(/[<>&]/g, (c) =>
      c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
    );
    info.innerHTML =
      `<b>${safeName}</b><br />` +
      `<span class="room-meta">${r.clients}/${r.maxClients} jogadores · ${r.bots} bots · Mapa: ${r.map}</span>`;

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Entrar";
    joinBtn.addEventListener("click", () => beginJoinFlow(r.roomId));

    row.append(info, joinBtn);
    roomListEl.appendChild(row);
  }
}

let pendingCreateOptions: CreateRoomOptions | null = null;

function syncCreateRoomForm(): void {
  const maxPlayers = parseInt(createMaxPlayers.value, 10);
  createMaxPlayersValue.textContent = String(maxPlayers);
  createBots.max = String(Math.max(0, maxPlayers - 1));
  const bots = Math.min(parseInt(createBots.value, 10), maxPlayers - 1);
  createBots.value = String(Math.max(0, bots));
  createBotsValue.textContent = createBots.value;
}

function openCreateRoomModal(): void {
  if (authEnabled && !session) {
    statusEl.classList.add("error");
    statusEl.textContent = "Entra na conta para jogar.";
    navigate("/login");
    return;
  }
  const savedBots = parseInt(localStorage.getItem(BOTS_STORAGE_KEY) ?? "7", 10);
  createRoomName.value = createRoomName.value.trim() || `Sala de ${playerName()}`;
  createMaxPlayers.value = "8";
  createBots.value = String(
    Number.isFinite(savedBots) ? Math.min(7, Math.max(0, savedBots)) : 7
  );
  syncCreateRoomForm();
  createRoomModal.classList.remove("hidden");
  createRoomName.focus();
  createRoomName.select();
}

function closeCreateRoomModal(): void {
  createRoomModal.classList.add("hidden");
}

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

  const createOpts = pendingCreateOptions;
  pendingCreateOptions = null;

  try {
    room = roomId
      ? await joinRoomById(roomId, playerName())
      : await createRoom(
          playerName(),
          createOpts ?? { roomName: "Sala", bots: 7, maxPlayers: 8 }
        );
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

function beginJoinFlow(roomId: string | null): void {
  if (authEnabled && !session) {
    statusEl.classList.add("error");
    statusEl.textContent = "Entra na conta para jogar.";
    navigate("/login");
    return;
  }
  void joinLobbyRoom(roomId);
}

createMaxPlayers.addEventListener("input", syncCreateRoomForm);
createBots.addEventListener("input", syncCreateRoomForm);

createRoomForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const roomName = createRoomName.value.trim().slice(0, 24) || "Sala";
  const maxPlayers = Math.min(
    CONFIG.roomSize,
    Math.max(2, parseInt(createMaxPlayers.value, 10) || 8)
  );
  const bots = Math.min(
    maxPlayers - 1,
    Math.max(0, parseInt(createBots.value, 10) || 0)
  );
  localStorage.setItem(BOTS_STORAGE_KEY, String(bots));
  pendingCreateOptions = { roomName, bots, maxPlayers };
  closeCreateRoomModal();
  beginJoinFlow(null);
});

createRoomCancel.addEventListener("click", () => closeCreateRoomModal());
createRoomModal.addEventListener("click", (e) => {
  if (e.target === createRoomModal) closeCreateRoomModal();
});

refreshRoomsButton.addEventListener("click", () => void refreshRooms());
createRoomButton.addEventListener("click", () => openCreateRoomModal());

onRouteChange((route) => applyRoute(route));

const LOADOUT_STORAGE_KEY = "fps.loadout";
const SLOT_DEFS: ReadonlyArray<{
  slot: keyof LoadoutSlots;
  label: string;
  category: WeaponCategory;
}> = [
  { slot: "primary", label: "1 · Principal", category: "primary" },
  { slot: "secondary", label: "2 · Secundária", category: "secondary" },
  { slot: "melee", label: "3 · Melee", category: "melee" },
];

function savedLoadout(): LoadoutSlots {
  const saved = localStorage.getItem(LOADOUT_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<LoadoutSlots>;
      const slots: LoadoutSlots = {
        primary: parsed.primary ?? DEFAULT_LOADOUT.primary,
        secondary: parsed.secondary ?? DEFAULT_LOADOUT.secondary,
        melee: parsed.melee ?? DEFAULT_LOADOUT.melee,
      };
      if (
        getWeapon(slots.primary) &&
        getWeapon(slots.secondary) &&
        getWeapon(slots.melee)
      ) {
        return slots;
      }
    } catch {
      const legacy: Record<string, LoadoutSlots["primary"]> = {
        recon: "sniper",
        rusher: "shotgun",
      };
      return {
        primary: legacy[saved] ?? DEFAULT_LOADOUT.primary,
        secondary: DEFAULT_LOADOUT.secondary,
        melee: DEFAULT_LOADOUT.melee,
      };
    }
  }
  return { ...DEFAULT_LOADOUT };
}

function weaponThumbHtml(w: WeaponDef): string {
  if (w.image) {
    return `<span class="weapon-thumb"><img src="${w.image}" alt="${w.name}"/></span>`;
  }
  const [r, g, b] = w.viewColor.map((c) => Math.round(c * 255));
  return `<span class="weapon-thumb placeholder" style="--wc: rgb(${r}, ${g}, ${b})">${w.name
    .slice(0, 1)
    .toUpperCase()}</span>`;
}

function weaponStatsLine(w: WeaponDef): string {
  if (isMeleeWeapon(w)) {
    const speedBonus = Math.round(((w.moveSpeedMult ?? 1) - 1) * 100);
    const speed = speedBonus > 0 ? ` · +${speedBonus}% velocidade` : "";
    return `Dano ${w.damageBody} · Alcance ${w.meleeRange}m${speed}`;
  }
  const rpm = Math.round(60 / w.fireInterval);
  const dmg = w.pellets > 1 ? `${w.damageBody}×${w.pellets}` : `${w.damageBody}`;
  return `Dano ${dmg} · Cadência ${rpm} · Pente ${w.magSize}`;
}

function weaponCurrentHtml(w: WeaponDef): string {
  return `
    ${weaponThumbHtml(w)}
    <span class="weapon-info">
      <span class="weapon-info-name">${w.name}</span>
      <span class="weapon-info-stats">${weaponStatsLine(w)}</span>
    </span>
    <span class="weapon-select-chevron">▾</span>
  `;
}

function weaponOptionHtml(w: WeaponDef, selected: boolean): string {
  return `
    ${weaponThumbHtml(w)}
    <span class="weapon-info">
      <span class="weapon-info-name">${w.name}</span>
      <span class="weapon-info-desc">${w.desc}</span>
      <span class="weapon-info-stats">${weaponStatsLine(w)}</span>
    </span>
    ${selected ? '<span class="weapon-option-check">✓</span>' : ""}
  `;
}

function renderLoadoutOptions(): void {
  const selected = weapons.loadout;
  loadoutOptions.innerHTML = "";

  for (const def of SLOT_DEFS) {
    const current = getWeapon(selected[def.slot])!;
    const container = document.createElement("div");
    container.className = "weapon-select";

    const label = document.createElement("span");
    label.className = "weapon-select-label";
    label.textContent = def.label;

    const currentBtn = document.createElement("button");
    currentBtn.type = "button";
    currentBtn.className = "weapon-select-current";
    currentBtn.innerHTML = weaponCurrentHtml(current);

    const panel = document.createElement("div");
    panel.className = "weapon-select-panel hidden";

    for (const w of weaponsForCategory(def.category)) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `weapon-option${w.id === current.id ? " selected" : ""}`;
      option.innerHTML = weaponOptionHtml(w, w.id === current.id);
      option.addEventListener("click", () => {
        selectSlotWeapon(container, def.slot, w.id);
      });
      panel.appendChild(option);
    }

    currentBtn.addEventListener("click", () => {
      const willOpen = panel.classList.contains("hidden");
      closeWeaponSelectPanels();
      if (willOpen) {
        panel.classList.remove("hidden");
        container.classList.add("open");
      }
    });

    container.appendChild(label);
    container.appendChild(currentBtn);
    container.appendChild(panel);
    loadoutOptions.appendChild(container);
  }
}

function closeWeaponSelectPanels(): void {
  loadoutOptions
    .querySelectorAll(".weapon-select-panel")
    .forEach((el) => el.classList.add("hidden"));
  loadoutOptions
    .querySelectorAll(".weapon-select.open")
    .forEach((el) => el.classList.remove("open"));
}

function selectSlotWeapon(
  container: HTMLElement,
  slot: keyof LoadoutSlots,
  id: WeaponId
): void {
  applySelectedLoadout({ ...weapons.loadout, [slot]: id });
  exitAds();

  const w = getWeapon(id)!;
  const currentBtn = container.querySelector(".weapon-select-current");
  if (currentBtn) currentBtn.innerHTML = weaponCurrentHtml(w);
  container.querySelectorAll(".weapon-option").forEach((el) => {
    const isSel = el.querySelector(".weapon-info-name")?.textContent === w.name;
    el.classList.toggle("selected", isSel);
    el.querySelector(".weapon-option-check")?.remove();
    if (isSel) {
      el.insertAdjacentHTML(
        "beforeend",
        '<span class="weapon-option-check">✓</span>'
      );
    }
  });
  container.querySelector(".weapon-select-panel")?.classList.add("hidden");
  container.classList.remove("open");
}

function applySelectedLoadout(slots: LoadoutSlots): void {
  weapons.applyLoadout(slots, true);
  localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(slots));
  lastWeaponIndex = 1;
  hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
  hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, weapons.isReloading);
  viewModel.setWeapon(weapons.weapon);
  player.setSpeedMult(weaponMoveSpeedMult(weapons.weapon));
}

function enterPreSpawn(): void {
  awaitingSpawn = true;
  applySelectedLoadout(savedLoadout());
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
      "Troca as armas nos slots — aplica na hora. ESC ou Confirmar para voltar.";
    loadoutCancelButton.textContent = "Confirmar";
    loadoutCancelButton.classList.remove("hidden");
    spawnButton.classList.add("hidden");
    spectateButton.classList.add("hidden");
    loadoutModal.classList.remove("prespawn");
  } else {
    loadoutHint.textContent = freeSpectating
      ? "Escolhe as armas e Spawn para jogar · ou ESC para continuar a voar."
      : "Escolhe uma arma por slot e Spawn, ou entra só a observar. Na partida, I troca as armas.";
    loadoutCancelButton.textContent = "Cancelar";
    loadoutCancelButton.classList.toggle("hidden", !freeSpectating);
    loadoutModal.classList.add("prespawn");
    spawnButton.classList.toggle("hidden", !preSpawnKitReady);
    spawnButton.disabled = false;
    spectateButton.classList.toggle("hidden", freeSpectating);
    if (freeSpectating && player.isPointerLocked) {
      player.releasePointerLock();
    }
  }

  if (skinPreview) skinPreview.start();

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

  if (skinPreview) skinPreview.stop();

  if (freeSpectating) {
    player.setLookEnabled(true);
    player.setMovementEnabled(false);
    if (relock && inGame && !endScreenShown) {
      player.requestPointerLock();
    }
    return;
  }

  if (awaitingSpawn) {
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

  if (skinPreview) skinPreview.stop();

  player.enterFreeFlySpectator();
  player.requestPointerLock();
}

loadoutCancelButton.addEventListener("click", () => cancelLoadoutPick());
spawnButton.addEventListener("click", () => requestPlayerSpawn());
spectateButton.addEventListener("click", () => enterFreeSpectate());

const skinButtons = document.querySelectorAll<HTMLButtonElement>(".skin-btn");
skinButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    skinButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const skinId = btn.dataset.skin;
    if (skinId) {
      if (room) room.send("change_skin", skinId);
      if (skinPreview) skinPreview.setSkin(skinId);
    }
  });
});

document.addEventListener("click", (e) => {
  if (loadoutModal.classList.contains("hidden")) return;
  if (!(e.target as HTMLElement).closest(".weapon-select")) {
    closeWeaponSelectPanels();
  }
});

applySelectedLoadout(savedLoadout());

function startGame(r: Room): void {
  inGame = true;
  pageLogin.classList.add("hidden");
  pageHome.classList.add("hidden");
  settingsModal.classList.add("hidden");
  navigate("/play");

  player.onInput = (input) => {
    if (ownInitialized && !awaitingSpawn) room?.send("input", input);
  };

  setupRoom(r);
  applyDebugMode(debugMode);

  audio.resume();
  enterPreSpawn();
}

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
  serverRttMs = 0;
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
  viewModel.setInvincible(false);
  hud.setInvincibleVignette(false);

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
  hud.clearAllKillStreaks();
  document.getElementById("endScreen")!.classList.add("hidden");

  settingsModal.classList.add("hidden");
  closeCreateRoomModal();
  player.exitImmersive();
  syncRoomSettingsUi();

  if (errorMsg) {
    statusEl.classList.add("error");
    statusEl.textContent = errorMsg;
  }
  navigate("/home");
}

function openPauseModal(): void {
  weapons.setTrigger(false);
  syncRoomSettingsUi();
  settingsModal.classList.remove("hidden", "menu-mode");
  settingsModal.classList.add("pause-mode");
}

function openMenuSettings(): void {
  syncRoomSettingsUi();
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
    victimId?: string;
    victimName: string;
    weaponName: string;
  }) => {
    const isLocal = e.killerId === r.sessionId;
    const streak = hud.handleKill(
      e.killerId,
      e.killerName,
      e.victimId,
      e.victimName,
      e.weaponName,
      isLocal
    );
    if (isLocal) audio.killConfirm(streak);
  });

  r.onMessage("killstreakEarned", (e: { playerName: string; streakName: string }) => {
    hud.showKillstreakToast(`${e.playerName} ativou o kill streak [${e.streakName}]!`);
  });

  r.onMessage("hitConfirm", (e: { headshot: boolean }) => {
    hud.showHitmarker(e.headshot);
    audio.hitmarker(e.headshot);
  });

  r.onMessage("damaged", (e: { x: number; y: number; z: number }) => {
    const feet = player.getFeet();
    const dx = e.x - feet.x;
    const dz = e.z - feet.z;
    const worldAngle = Math.atan2(dx, dz);
    let relative = worldAngle - player.getYaw();
    while (relative > Math.PI) relative -= Math.PI * 2;
    while (relative < -Math.PI) relative += Math.PI * 2;
    hud.showDirectionalDamage(relative);
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
    hud.resetKillStreak();
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
    player.setMovementEnabled(false);
    weapons.setEnabled(false);
  });

  r.onMessage("sping", (msg: { t: number }) => {
    r.send("spong", msg);
  });
  r.onMessage("srtt", (msg: { rtt: number }) => {
    if (typeof msg?.rtt === "number" && Number.isFinite(msg.rtt)) {
      serverRttMs = Math.max(0, msg.rtt);
      pingMs = Math.round(serverRttMs);
    }
  });

  r.onMessage("cpong", (msg: { t: number }) => {
    if (serverRttMs <= 0) {
      pingMs = Math.max(0, Math.round(performance.now() - msg.t));
    }
  });
  const pingInterval = window.setInterval(() => {
    r.send("cping", { t: performance.now() });
  }, 2000);
  r.send("cping", { t: performance.now() });

  syncRoomSettingsUi();
  let lastHostId = "";
  let lastDesiredBots = -1;
  let lastMaxPlayers = -1;
  r.onStateChange(() => {
    const snap = getMatchSnapshot(r);
    if (
      snap.hostId === lastHostId &&
      snap.desiredBots === lastDesiredBots &&
      snap.maxPlayers === lastMaxPlayers
    ) {
      return;
    }
    lastHostId = snap.hostId;
    lastDesiredBots = snap.desiredBots;
    lastMaxPlayers = snap.maxPlayers;
    syncRoomSettingsUi();
  });

  r.send("setDebug", { enabled: debugMode });

  r.onMessage("matchReset", () => {
    endScreenShown = false;
    document.getElementById("endScreen")!.classList.add("hidden");
    hud.setScoreboardVisible(false);
    hud.setKills(0);
    hud.clearAllKillStreaks();
  });

  r.onLeave((code) => {
    window.clearInterval(pingInterval);
    resetToMenu(code > 1000 ? "Desconectado do servidor." : undefined);
  });
}

function shooterHead(shooterId: string): Vector3 | null {
  const rp = remotePlayers.get(shooterId);
  if (rp) return rp.getHead();
  if (room && shooterId === room.sessionId) return null;
  return null;
}

function reconcile(r: Room): void {
  const seen = new Set<string>();
  const ownSnapshot = getOwnSnapshot(r);
  const ownHasWallhack = ownSnapshot?.activeStreak === "wall_hacker";

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
    rp.setSkin(p.skinId || "skin_default");
    rp.setWallhack(ownHasWallhack);
    rp.setInvincible((p.invincibleTimeLeft ?? 0) > 0);
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
    return;
  }

  if (!ownInitialized) {
    ownInitialized = true;
    player.teleport(new Vector3(p.x, p.y, p.z));
  }

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
  hud.setKillStreak(p.killStreak);
  hud.updateActiveStreak(p.activeStreak, p.streakTimeLeft);
  weapons.setNoRecoil(p.activeStreak === "no_recoil");
  const invincible = (p.invincibleTimeLeft ?? 0) > 0;
  viewModel.setInvincible(invincible);
  hud.setInvincibleVignette(invincible);
}

function getOwnSnapshot(r: Room): PlayerSnapshot | null {
  let own: PlayerSnapshot | null = null;
  forEachPlayer(r, (p, id) => {
    if (id === r.sessionId) own = p;
  });
  return own;
}

function scoreboardRows(r: Room): ScoreRow[] {
  const { hostId } = getMatchSnapshot(r);
  const rows: ScoreRow[] = [];
  forEachPlayer(r, (p, id) => {
    rows.push({
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      isPlayer: id === r.sessionId,
      isHost: id === hostId,
    });
  });
  return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

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

const HIP_FOV = 1.15;
const SCOPE_FOV = 0.42;
const scopeOverlay = document.getElementById("scopeOverlay")!;
const scopeOverlayCanvas = document.getElementById(
  "scopeOverlayCanvas",
) as HTMLCanvasElement;
const crosshairEl = document.getElementById("crosshair")!;

let adsToggled = false;
let adsOverlayOn = false;
let adsCrosshairScoped = false;
let lastAdsFov = HIP_FOV;

function canAds(): boolean {
  return (
    player.isPointerLocked &&
    weapons.weapon.id === "sniper" &&
    !playerDead
  );
}

function refreshAds(): void {
  if (adsToggled && !canAds()) adsToggled = false;
  if (weapons.isAiming !== adsToggled) weapons.setAiming(adsToggled);
}

function setScopeOverlay(on: boolean): void {
  if (adsOverlayOn === on) return;
  adsOverlayOn = on;
  scopeOverlay.classList.toggle("active", on);
}

function setCrosshairScoped(on: boolean): void {
  if (adsCrosshairScoped === on) return;
  adsCrosshairScoped = on;
  crosshairEl.classList.toggle("scoped", on);
}

function paintScopeOverlay(): void {
  const cssW = Math.max(1, window.innerWidth);
  const cssH = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (scopeOverlayCanvas.width !== w || scopeOverlayCanvas.height !== h) {
    scopeOverlayCanvas.width = w;
    scopeOverlayCanvas.height = h;
  }

  const ctx = scopeOverlayCanvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const lensCss = Math.min(Math.min(cssW, cssH) * 0.92, 780);
  const r = (lensCss * 0.5) * dpr;
  const cx = w * 0.5;
  const cy = h * 0.5;

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(20, 20, 20, 0.85)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

function exitAds(): void {
  adsToggled = false;
  weapons.setAiming(false);
}

function exitAdsImmediate(): void {
  adsToggled = false;
  adsAmount = 0;
  weapons.setAiming(false);
  lastAdsFov = HIP_FOV;
  player.camera.fov = HIP_FOV;
  viewModel.setVisible(true);
  setScopeOverlay(false);
  setCrosshairScoped(false);
  player.setSensitivity(baseSensitivity);
}

function updateAds(dt: number): void {
  if (awaitingSpawn) {
    viewModel.setVisible(false);
    return;
  }

  refreshAds();
  const aiming = weapons.isAiming;
  const target = aiming ? 1 : 0;
  const prevAmount = adsAmount;
  const step = Math.min(1, dt * 8.5);
  if (target > adsAmount) adsAmount = Math.min(target, adsAmount + step);
  else if (target < adsAmount) adsAmount = Math.max(target, adsAmount - step);

  if (adsAmount < 0.001) adsAmount = 0;
  if (adsAmount > 0.999) adsAmount = 1;

  const fov = aiming || adsAmount > 0.5 ? SCOPE_FOV : HIP_FOV;
  if (fov !== lastAdsFov) {
    lastAdsFov = fov;
    player.camera.fov = fov;
  }

  if (adsAmount === prevAmount && adsAmount === target) return;

  viewModel.setVisible(adsAmount < 0.45);
  setScopeOverlay(adsAmount > 0.5);
  setCrosshairScoped(adsAmount > 0.35);
  player.setSensitivity(
    baseSensitivity * (1 - adsAmount * (1 - ADS_SENS_SCALE)),
  );
}

canvas.addEventListener("mousedown", (e) => {
  if (!player.isPointerLocked) return;
  if (e.button === 0) weapons.setTrigger(true);
  if (e.button === 2) {
    e.preventDefault();
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

restartButton.addEventListener("click", () => {
  document.getElementById("endScreen")!.classList.add("hidden");
  hud.setScoreboardVisible(false);
  player.requestPointerLock();
});

menuButton.addEventListener("click", () => {
  void room?.leave();
});

restartButton.addEventListener("click", () => audio.resume());

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
    if (awaitingSpawn && !freeSpectating) return;
    openPauseModal();
  }
});

window.addEventListener(
  "keydown",
  (e) => {
    if (e.code !== "Escape" || endScreenShown) return;

    if (!inGame && !createRoomModal.classList.contains("hidden")) {
      e.preventDefault();
      closeCreateRoomModal();
      return;
    }

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

    if (player.isPointerLocked) {
      e.preventDefault();
      player.releasePointerLock();
      openPauseModal();
      return;
    }

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

let debugAccumulator = 0;
let footstepAccumulator = 0;
let minimapAccumulator = 0;
let frameMaxMs = 0;
let frameMaxShownMs = 0;
let frameMaxWindowStart = 0;

hud.setHealth(CONFIG.playerMaxHealth);
hud.setLoadoutWeapons(weapons.loadoutWeapons, weapons.weaponIndex);
hud.setAmmo(weapons.magAmmo, weapons.reserveAmmo, false);
hud.setKills(0);

if (skinPreviewCanvas) {
  skinPreview = new SkinPreview(skinPreviewCanvas);
}

engine.runRenderLoop(() => {
  if (!inGame) return;

  const dt = engine.getDeltaTime() / 1000;

  const nowMs = performance.now();
  if (nowMs - frameMaxWindowStart >= 1000) {
    frameMaxShownMs = frameMaxMs;
    frameMaxMs = 0;
    frameMaxWindowStart = nowMs;
  }
  if (dt * 1000 > frameMaxMs) frameMaxMs = dt * 1000;

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

  for (const rp of remotePlayers.values()) {
    rp.update(dt, serverRttMs > 0 ? serverRttMs : pingMs ?? 0);
  }

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
    debugEl.textContent = `${engine.getFps().toFixed(0)} fps · frame máx ${frameMaxShownMs.toFixed(0)}ms · ${conn}\n${player.getDebugInfo()}`;
  }
});

window.addEventListener("resize", () => {
  engine.resize();
  paintScopeOverlay();
});

// Pinta o scope fora do combate (evita hitch no 1º RMB).
paintScopeOverlay();
requestAnimationFrame(() => paintScopeOverlay());

void (async () => {
  await initAuth();
  if (session) navigate("/home", true);
  else navigate("/login", true);
})();
